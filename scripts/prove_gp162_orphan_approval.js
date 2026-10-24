#!/usr/bin/env node
"use strict";

/**
 * prove_gp162_orphan_approval — 场景验收（自媒体日更）· 删掉的任务，它挂着的待批准邮件要看得见
 *
 * 现场推演（真实用户旅程，接着 GP-161 往下走）：
 *   「每天早上9点把审核通过的稿子发到 news@example.com」→ 09:00 触发，Host 按
 *   GP-156 挂出一条 mail_send 待批准（GP-159 的窗口最长 48 小时）。用户 10 点
 *   打开应用，发现收件人写错了，于是在群资料面板里把这条任务删掉（GP-161）。
 *   删除之后：任务没了，但那条「发送邮件 · 发给 news@example.com」还大喇喇地躺在
 *   审批队列里，来源写着「定时任务」，看不出它的主人已经被删了。用户顺手点了
 *   「本次允许」——那封他刚刚判定为错误的邮件就真的发出去了，而且是外部动作，收不回。
 *
 * 这一条不能靠「删任务时顺手把批准也 deny 掉」来修：那等于替用户做一个不可逆的
 * 决定（今天这份稿子可能仍然要发）。正确的做法是把事实说清楚 —— 队列那一行必须
 * 如实标明「来源的定时任务已删除」，批不批仍然是用户的事。
 *
 * 契约（先立红，修完必须全绿）：
 *   1. 这个事实必须从 store 推出来：fires.jsonl 的 approval_id → host-routines.json
 *      里这条行还在不在。不是靠界面猜，也不是把行藏起来。
 *   2. 不误报：任务还在（哪怕已暂停）不标；聊天来源不标；关联不到的历史行不标。
 *   3. 不改变既有形状：listPending 的返回只加可选新字段 routine_gone。
 *   4. 不替用户决定：孤立批准行仍留在队列里、仍可被 allow_once / deny。
 *   5. 历史不动：删除任务不许清掉这条任务的 fires 行与 drafts 文件（GP-161 纪律）。
 *   6. 界面要有三语人话（apOwnerGone），并且是显示出来、不是 display:none。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp162-"));
const REPO = path.join(__dirname, "..");
const ffi = createHostFfi(root);
const surf = createProductSurface(root);
const D = (...p) => path.join(root, "data", ...p);
const PEND = D("desktop/pending-approvals.jsonl");
const ROUTES = D("routines/host-routines.json");
const FIRES = D("routines/fires.jsonl");
const DRAFT_DIR = D("routines/drafts");

const readJsonl = (p) => {
  try {
    return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
};
const readRows = () => {
  try { const j = JSON.parse(fs.readFileSync(ROUTES, "utf8")); return Array.isArray(j) ? j : (j.routines || []); } catch { return []; }
};
const pendingRows = () => readJsonl(PEND);
const draftsFor = (id) => {
  try { return fs.readdirSync(DRAFT_DIR).filter((f) => f.startsWith("routine-" + id + "-") && f.endsWith(".json")); } catch { return []; }
};
const fireLinesFor = (id) => readJsonl(FIRES).filter((l) => l && l.id === id).length;

async function schedule(id, cron, prompt, roomId) {
  await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|" + cron + "|" + prompt }],
    { sessionId: "gp162", roomId: roomId || "room-gp162" },
  );
  const rows = readRows();
  const hit = rows.find((r) => r && r.id === id);
  if (hit) { hit.room_id = roomId || "room-gp162"; fs.writeFileSync(ROUTES, JSON.stringify(rows, null, 2)); }
}
async function fire(id) {
  const r = await ffi.executeHostEffects([{ kind: "routine_fire", command: id }], { sessionId: "gp162" });
  const hit = (r || []).find((x) => x && x.kind === "routine_fire") || {};
  // 触发结果在 effect 的 stdout 里（approval_id 在那份 JSON 里），不是 effect 顶层。
  try { return JSON.parse(hit.stdout || "{}"); } catch { return {}; }
}
function owners() {
  if (typeof ffi.routineApprovalOwners !== "function") return null;
  return ffi.routineApprovalOwners();
}

(async () => {
  console.log("prove_gp162_orphan_approval — 任务删了，它挂着的待批准邮件在队列里得说清来路");

  fs.mkdirSync(D("desktop"), { recursive: true });
  fs.writeFileSync(D("desktop/rooms.json"), JSON.stringify({
    rooms: [{
      id: "room-gp162", title: "日更流水线",
      transcript: [{ kind: "final_report", text: "标题：删掉的任务不该再发信", at: new Date().toISOString() }],
    }],
  }, null, 2));

  /* 两条一样的任务，一条删掉、一条留着（留着的那条还故意暂停，测误报） */
  await schedule("gp162-gone", "0 9 * * *", "每天早上9点把审核通过的稿子发到 gone@example.com");
  await schedule("gp162-alive", "0 10 * * *", "每天上午10点把审核通过的稿子发到 alive@example.com");
  const goneFire = await fire("gp162-gone");
  const aliveFire = await fire("gp162-alive");
  const goneId = String((goneFire && goneFire.approval_id) || "");
  const aliveId = String((aliveFire && aliveFire.approval_id) || "");
  if (!goneId || goneId === "null") {
    bad("前置：删除对象那条任务没有挂出待批准（GP-156 链路本身坏了）", JSON.stringify(goneFire).slice(0, 300));
    console.log("prove_gp162_orphan_approval: PASS=" + pass + " FAIL=" + (fail + 1));
    process.exit(1);
  }
  const qGone = pendingRows().find((e) => e && e.id === goneId);
  qGone && qGone.source === "routine" && String(qGone.command || "").includes("gone@example.com")
    ? ok("前置：定时触发挂出了待批准行（来源=routine，收件人 gone@example.com）")
    : bad("前置：待批准行不符合预期，后面测不出真问题", JSON.stringify(qGone).slice(0, 300));

  const del = await ffi.routineLifecycle({ roomId: "room-gp162", id: "gp162-gone", action: "remove" });
  const pause = await ffi.routineLifecycle({ roomId: "room-gp162", id: "gp162-alive", action: "pause" });
  del && del.ok === true && pause && pause.ok === true
    ? ok("前置：一条已删除、一条已暂停（暂停 ≠ 删除，不能一起误标）")
    : bad("前置：删除 / 暂停没有做成", JSON.stringify({ del, pause }).slice(0, 300));

  const idx = owners();
  if (!idx || idx.ok !== true || !idx.by_approval) {
    bad("T1 Host 推不出「这条待批准来自哪个任务、那个任务还在不在」", JSON.stringify({ api: typeof ffi.routineApprovalOwners, idx }).slice(0, 200));
  } else {
    const hit = idx.by_approval[goneId];
    hit && String(hit.routine_id) === "gp162-gone" && hit.alive === false
      ? ok("T1 已删除任务的待批准被认出来了：这条批准出自 gp162-gone，而该行已不在 store（alive=false）")
      : bad("T1 认不出孤立批准行（用户还会照着已删的任务点批准）", JSON.stringify({ hit, keys: Object.keys(idx.by_approval) }).slice(0, 300));
  }

  if (!idx || !idx.by_approval) {
    bad("T2 没有可核对的索引，无法确认「不误报」", "依赖 T1");
  } else {
    const aliveHit = idx.by_approval[aliveId];
    const aliveOk = aliveId && aliveHit && aliveHit.alive === true;
    aliveOk
      ? ok("T2 还在的任务（这里还特意暂停）没有被标成孤立 — 暂停 ≠ 删除")
      : bad("T2 把还存在的任务标成已删除（误报会吓到用户）", JSON.stringify({ aliveId, aliveHit }).slice(0, 300));
    const stray = surf.appendPendingApproval({ source: "chat", kind: "mail_send", command: ["gmail", "chat@example.com", "聊天里的一封", "正文"].join("|") });
    const strayId = stray && stray.id ? String(stray.id) : "";
    const strayHit = strayId && idx.by_approval[strayId];
    !strayHit
      ? ok("T3 聊天来源的批准行不进这张表（不牵连别的路径）")
      : bad("T3 聊天来源被错误地关联到了定时任务", JSON.stringify(strayHit).slice(0, 200));
  }

  const firesGone = fireLinesFor("gp162-gone");
  const draftsGone = draftsFor("gp162-gone").length;
  const rowStill = pendingRows().find((e) => e && e.id === goneId);
  firesGone >= 1 && draftsGone >= 1 && rowStill && rowStill.status === "pending"
    ? ok("T4 删除没有清掉历史（fires " + firesGone + " 行 / drafts " + draftsGone + " 份），批准行也还留在队列里等用户决定")
    : bad("T4 删除顺手清了历史，或者替用户把批准撤掉了", JSON.stringify({ firesGone, draftsGone, rowStill }).slice(0, 300));

  const decided = surf.approvalDecide(goneId, "allow_once");
  decided && decided.ok === true
    ? ok("T5 孤立的批准行仍然可以「本次允许」——发不发是用户的事，Host 不替他做不可逆决定")
    : bad("T5 孤立批准行不再可决定（等于把用户仅剩的选择也拿走了）", JSON.stringify(decided).slice(0, 250));

  const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  const enrich = /bitbot:approvals:listPending[\s\S]{0,1400}routine_gone/.test(mainJs)
    || /routine_gone/.test(mainJs);
  enrich
    ? ok("T6 队列出口带上了 routine_gone（既有 listPending 只加可选新字段，形状不动）")
    : bad("T6 待批准出口没有这个事实，界面再怎么写都是猜");
  const renderWired = /routine_gone/.test(html) && /apOwnerGone/.test(html);
  const hidden = /\.ap-orphan\s*\{[^}]*display\s*:\s*none/.test(html);
  renderWired && !hidden
    ? ok("T7 队列行按 routine_gone 显示「来源任务已删除」，且不是靠 display:none 糊过去")
    : bad("T7 界面没有这个说法", JSON.stringify({ wired: renderWired, hidden }).slice(0, 250));

  const i18nHits = (html.match(/apOwnerGone:/g) || []).length;
  i18nHits >= 3
    ? ok("T8 apOwnerGone 三语齐全（" + i18nHits + " 处，简 / 繁 / 英）")
    : bad("T8 缺语言的文案（D-C-03 三语一致会红）", JSON.stringify({ hits: i18nHits }));

  const pendShape = Object.keys(pendingRows().find((e) => e && e.source === "chat") || {})
    .filter((k) => ["id", "source", "kind", "command", "requested_at", "expires_at", "status"].indexOf(k) < 0);
  pendShape.length === 0
    ? ok("T9 待批准行的磁盘形状没有新增字段（routine_gone 只在出口派生，不写进 jsonl）")
    : bad("T9 往 store 行里塞了新字段，改的是既有契约", JSON.stringify(pendShape));

  console.log("prove_gp162_orphan_approval: PASS=" + pass + " FAIL=" + fail);
  console.log("范围说明：本探针覆盖 Host 派生索引 + 出口/界面接线（静态）；队列行真渲染由 e2e_desktop_creator_pipeline P11 覆盖。");
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* keep */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("probe crashed: " + ((e && e.stack) || e));
  console.log("prove_gp162_orphan_approval: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
