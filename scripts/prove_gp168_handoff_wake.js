#!/usr/bin/env node
"use strict";

/**
 * prove_gp168_handoff_wake — 「定时唤醒」这一班车到底接不接挂账的转交
 *
 * 断点（§8.32 自己记下的那条残留）：GP-166 把 pending 转交凭据的下游补上了，
 * 但捡起只搭「下一次群回合」这班车。自媒体的真实用法是：08:00 定时发文内部转交
 * 给审核 Bot，provider 挂了 → 凭据落盘、标 pending；之后一整天群里没人再发消息，
 * 这笔任务就永远睡着。定时 sweep（`routine_tick`）是唯一必然每天发生的唤醒，
 * 所以它必须也来捡一次。
 *
 * 契约（先立红，修完必须全绿；只加可选入参与可选字段，不动既有语义）：
 *   W-01 一次 routine_tick 之后，效果行带得出 handoff_retry（scope=all_rooms，真的扫了）
 *   W-02 内核被跳过（nest depth≥1 的 nested_skipped）时**不许演成「它答上了」**：
 *        挂账保持非终态，群转录里不得出现该 Bot 的 bot_reply
 *   W-03 有界：到上限（3）如实 stuck + 群里一条 handoff_stuck 的失败行
 *   W-04 终态不再自激：stuck 之后再 sweep 不新增任何一行
 *   W-05 群之间不串：A 间的挂账答案不许写进 B 间
 *   W-06 一次唤醒有上限：挂账多时单次 sweep 最多捡 5 笔，剩下的如实报 pending
 *   W-07 all_rooms 模式接上 runner 时真的能交付答案（两间群各一条 bot_reply，各归各群）
 *   W-08 不偏心：到期任务照常 fired / 草稿照常落盘，捡起是同班车顺路做的事
 *   W-09 单群模式语义未变（只处理那间群）
 *   W-10 没给 room 又没开 all_rooms → 如实拒绝，不自作主张扫全部
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d === undefined ? "" : " — " + String(d).slice(0, 300))); };
const check = (c, m, d) => (c ? ok(m) : bad(m, d));

/* 临时 root：不碰仓库 data/。内核用 nest depth 短路（见 W-02），不起真编译。 */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "gp168-"));
const DATA = path.join(ROOT, "data");
const DESKTOP = path.join(DATA, "desktop");
const HO_DIR = path.join(DATA, "agents", "handoffs");
fs.mkdirSync(DESKTOP, { recursive: true });

const BOTS = [
  { id: "w1", name: "Write", job: "writing", description: "draft", hidden: false },
  { id: "w2", name: "Review", job: "review", description: "check", hidden: false },
];
fs.writeFileSync(path.join(DESKTOP, "bots.json"), JSON.stringify({ version: 1, primary_id: "w1", bots: BOTS }, null, 2));
const ROOMS_PATH = path.join(DESKTOP, "rooms.json");
const mkRoom = (id, title) => ({ id, title, members: ["w1", "w2"], transcript: [] });
fs.writeFileSync(ROOMS_PATH, JSON.stringify({ version: 1, rooms: [mkRoom("roomA", "日更群"), mkRoom("roomB", "另一个群")] }, null, 2));

const readRooms = () => { try { return JSON.parse(fs.readFileSync(ROOMS_PATH, "utf8")); } catch (_) { return { rooms: [] }; } };
const rowsIn = (roomId, kind, botId) => {
  const r = (readRooms().rooms || []).find((x) => x && x.id === roomId) || {};
  return (r.transcript || []).filter((e) => e && e.kind === kind && (!botId || e.bot_id === botId));
};

/* 凭据由产品入口产出（不手搓形状）：handoffTaskAsync + 一个答不上的 runner，
   落盘形状与 host_ffi 的 handoff_task 分支逐字一致（{...res, inbox_path, path}）。 */
const surface = createProductSurface(ROOT, { dataRoot: DATA });
const failRunner = { runResponderTurn: async () => ({ ok: false, error: "provider down", text: "", artifacts: [] }) };
let seq = 0;
async function makePendingHandoff(roomId, toBot, task) {
  const res = await surface.handoffTaskAsync({ room: roomId, from_bot: "w1", to_bot: toBot, task }, failRunner);
  if (!(res && res.ok === true && res.pending === true)) return { res, file: null };
  seq += 1;
  fs.mkdirSync(HO_DIR, { recursive: true });
  const file = path.join(HO_DIR, `handoff-${toBot}-${Date.now().toString(36)}-${seq}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...res, inbox_path: "", path: file }, null, 2));
  return { res, file, name: path.basename(file) };
}
const readStub = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; } };

/* 定时唤醒班车：走 host_ffi 的 routine_tick（daemon / CLI / 移动端都是它）。
   内核在这里被 nest depth 短路 —— 这正是「Host 拿不到真回合」的一种真实形状。 */
process.env.BITBOT_NEST_DEPTH = "1";
const ffi = createHostFfi(ROOT);
async function wake() {
  const r = await ffi.executeHostEffects([{ kind: "routine_tick", command: "wake-due" }], { sessionId: "gp168" });
  const hit = (r || []).find((x) => x && (x.kind === "routine_tick" || x.kind === "routine_wake")) || {};
  let out = {};
  try { out = JSON.parse(hit.stdout || "{}"); } catch (_) { out = {}; }
  return { row: hit, out };
}

(async () => {
  console.log("prove_gp168_handoff_wake — 定时唤醒必须也来捡挂账的转交");

  /* W-01 班车接线 */
  const a1 = await makePendingHandoff("roomA", "w2", "把稿子核一遍再发");
  check(a1.res && a1.res.pending === true, "W-00 前置：产品入口产出了一笔「受理但没答上」的转交凭据", JSON.stringify({ ok: a1.res && a1.res.ok, pending: a1.res && a1.res.pending }));
  const w1 = await wake();
  const retr1 = w1.row.handoff_retry || w1.out.handoff_retry || null;
  check(
    w1.row.ok === true && retr1 && retr1.mode === "host_handoff_retry" && retr1.scope === "all_rooms" && Number(retr1.scanned) >= 1,
    "W-01 routine_tick 之后效果行带得出 handoff_retry（定时唤醒真的扫了挂账）",
    retr1 ? JSON.stringify({ scanned: retr1.scanned, scope: retr1.scope }) : "唤醒回包里没有 handoff_retry（班车没接）",
  );

  /* W-02 内核被跳过时不许演成「它答上了」 */
  const s1 = readStub(a1.file) || {};
  const answeredRows = rowsIn("roomA", "bot_reply", "w2");
  check(
    s1.state !== "answered" && answeredRows.length === 0,
    "W-02 内核 nested_skipped 不算答上：挂账不得变 answered，群里不得出现「它答了」的行",
    JSON.stringify({ state: s1.state, last_error: s1.last_error, reply_rows: answeredRows.length, text: (answeredRows[0] || {}).text || "" }),
  );
  check(Number(s1.attempts) >= 1, "W-02b 捡起确实跑了一轮（attempts 递增、last_error 看得见）", JSON.stringify({ attempts: s1.attempts, last_error: s1.last_error }));

  /* W-03 有界重试 → stuck + 群里看得见 */
  await wake();
  const w3 = await wake();
  const s3 = readStub(a1.file) || {};
  const retr3 = w3.row.handoff_retry || w3.out.handoff_retry || {};
  check(
    s3.state === "stuck" && Number(s3.attempts) >= 3 && Number(retr3.stuck) >= 1 && Number(retr3.notified) >= 1,
    "W-03 到上限（3）如实 stuck，并在这一轮的回报里数得出 stuck/notified",
    JSON.stringify({ state: s3.state, attempts: s3.attempts, stuck: retr3.stuck, notified: retr3.notified }),
  );
  check(
    rowsIn("roomA", "bot_reply_error", "w2").some((e) => /handoff_stuck/.test(String(e.error || ""))),
    "W-03b stuck 在群转录里看得见（复用 bot_reply_error，不新增转录 kind）",
  );

  /* W-04 终态不再自激 */
  const errBefore = rowsIn("roomA", "bot_reply_error", "w2").length;
  const w4 = await wake();
  check(
    Number((w4.out.handoff_retry || {}).attempted || 0) === 0 &&
      rowsIn("roomA", "bot_reply_error", "w2").length === errBefore,
    "W-04 stuck 是终态：再唤醒不再重跑、不再往群里刷行",
    JSON.stringify({ attempted: (w4.out.handoff_retry || {}).attempted, rows: rowsIn("roomA", "bot_reply_error", "w2").length }),
  );

  /* W-05 群之间不串 */
  const b5 = await makePendingHandoff("roomB", "w2", "这间群的挂账只归这间");
  const rowsAbefore = rowsIn("roomA", "bot_reply", "w2").length;
  const rowsBbefore = rowsIn("roomB", "bot_reply", "w2").length;
  await wake();
  check(
    rowsIn("roomA", "bot_reply", "w2").length === rowsAbefore &&
      rowsIn("roomB", "bot_reply", "w2").length === rowsBbefore &&
      (readStub(b5.file) || {}).state !== "answered",
    "W-05 A 间的 sweep 不把 B 间的凭据算成 A 间的答案（跨群不串）",
    JSON.stringify({ a: rowsIn("roomA", "bot_reply", "w2").length, b: rowsIn("roomB", "bot_reply", "w2").length, state: (readStub(b5.file) || {}).state }),
  );

  /* W-06 一次唤醒有上限 */
  const many = [];
  for (let i = 0; i < 6; i++) many.push(await makePendingHandoff(i % 2 ? "roomA" : "roomB", "w1", "批量挂账 " + i));
  const w6 = await wake();
  const r6 = w6.out.handoff_retry || {};
  check(
    Number(r6.attempted) <= 5 && Number(r6.pending) >= 1,
    "W-06 单次唤醒最多捡 5 笔，剩下的如实报 pending（不是一次唤醒换来十次模型调用）",
    JSON.stringify({ attempted: r6.attempted, pending: r6.pending, scanned: r6.scanned }),
  );

  /* W-07 all_rooms 接上 runner 时真能交付（两间群各归各群） */
  const deliverRunner = { runResponderTurn: async (botId) => ({ ok: true, text: "定时唤醒后真的答上了：" + botId, artifacts: [] }) };
  const w7 = await surface.retryPendingHandoffs({ all_rooms: true, deps: deliverRunner });
  check(
    w7 && w7.ok === true && w7.scope === "all_rooms" && Number(w7.attempted) >= 1 && Number(w7.answered) >= 1,
    "W-07 all_rooms 模式能真的交付（attempted/answered 报得出）",
    JSON.stringify({ ok: w7 && w7.ok, error: w7 && w7.error, attempted: w7 && w7.attempted, answered: w7 && w7.answered }),
  );
  check(
    rowsIn("roomA", "bot_reply", "w1").length >= 1 &&
      rowsIn("roomB", "bot_reply", "w1").length >= 1 &&
      String((rowsIn("roomA", "bot_reply", "w1")[0] || {}).text || "").includes("定时唤醒后真的答上了"),
    "W-07b 交付的答案各归各群的转录（不写错房间）",
    JSON.stringify({ a: rowsIn("roomA", "bot_reply", "w1").length, b: rowsIn("roomB", "bot_reply", "w1").length }),
  );
  const answeredFiles = many.concat([b5]).filter((m) => (readStub(m.file) || {}).state === "answered");
  check(answeredFiles.length >= 1, "W-07c 交付过的凭据写下终态 answered（幂等键下一轮不再重跑）", JSON.stringify({ answered: answeredFiles.length }));

  /* W-08 不偏心：到期任务照常触发 */
  const ROUTES = path.join(DATA, "routines", "host-routines.json");
  fs.mkdirSync(path.dirname(ROUTES), { recursive: true });
  const dueIso = new Date(Date.now() - 60 * 1000).toISOString();
  fs.writeFileSync(ROUTES, JSON.stringify([{ id: "r-gp168", cron: "@daily", prompt: "每天 08:00 发今日稿", next_due: dueIso, enabled: true, room_id: "roomA" }], null, 2),
  );
  const w8 = await wake();
  check(
    w8.row.ok === true && Number(w8.out.due_count) >= 1 && Number(w8.out.fired_count) >= 1,
    "W-08 到期任务照常 fired（捡起是同班车顺路做的，不是把班车改了）",
    JSON.stringify({ due: w8.out.due_count, fired: w8.out.fired_count }),
  );
  const draftDir = path.join(DATA, "routines", "drafts");
  const drafts = (() => { try { return fs.readdirSync(draftDir).filter((f) => f.startsWith("routine-r-gp168-")); } catch (_) { return []; } })();
  check(drafts.length >= 1, "W-08b fire 仍按 §6.4 先准备草稿（requires_approval 边界没被顺手绕掉）", JSON.stringify({ drafts: drafts.length }));
  check(Boolean(w8.out.handoff_retry || w8.row.handoff_retry), "W-08c fired 与 handoff_retry 同时在场", JSON.stringify({ keys: Object.keys(w8.out) }));

  /* W-09 单群模式语义未变 */
  const c9 = await makePendingHandoff("roomA", "w2", "只该被 A 间的捡起处理");
  const aReplyBefore = rowsIn("roomA", "bot_reply", "w2").length;
  const c9Before = readStub(c9.file) || {};
  const w9 = await surface.retryPendingHandoffs({ room: "roomB", deps: { runResponderTurn: async () => ({ ok: true, text: "不该由 B 间捡走", artifacts: [] }) } });
  const c9After = readStub(c9.file) || {};
  check(
    w9.ok === true && w9.scope === "single_room" && w9.room === "roomB" &&
      Number(w9.skipped_other_room) >= 1 &&
      rowsIn("roomA", "bot_reply", "w2").length === aReplyBefore &&
      String(c9After.state || "pending") === String(c9Before.state || "pending") &&
      !Number(c9After.attempts) &&
      !/不该由 B 间捡走/.test(String(c9After.target_reply || "")),
    "W-09 {room} 模式仍只处理那间群：B 间的调用捡不走 A 间的挂账（新增 all_rooms 没改老语义）",
    JSON.stringify({ scope: w9.scope, room: w9.room, other: w9.skipped_other_room, before: c9Before, after: c9After }),
  );
  const w9b = await surface.retryPendingHandoffs({ room: "roomA", deps: { runResponderTurn: async () => ({ ok: true, text: "A 间自己捡", artifacts: [] }) } });
  check(Number(w9b.attempted) >= 1 && (readStub(c9.file) || {}).state === "answered", "W-09b A 间调用能把 A 间的挂账捡完", JSON.stringify({ attempted: w9b.attempted, state: (readStub(c9.file) || {}).state }));

  /* W-10 不给 room 又不开 all_rooms 必须拒绝 */
  const w10 = await surface.retryPendingHandoffs({ deps: { runResponderTurn: async () => ({ ok: true, text: "x", artifacts: [] }) } });
  check(
    w10.ok === false && w10.error === "handoff_retry_needs_room" && Number(w10.attempted) === 0,
    "W-10 没指定群也没开 all_rooms → 如实拒绝，不自作主张扫全部",
    JSON.stringify({ ok: w10.ok, error: w10.error, attempted: w10.attempted }),
  );

  console.log("\nprove_gp168_handoff_wake: pass=" + pass + " fail=" + fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log("  ✗ 门禁崩溃 — " + String((e && e.stack) || e).slice(0, 400));
  console.log("prove_gp168_handoff_wake: pass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
