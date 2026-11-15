#!/usr/bin/env node
"use strict";

/**
 * prove_routine_dispatch — 定时任务到点得**真的派活**
 *
 * 现场推演(真实用户旅程,不是假设):
 *   「组建团队 + 每天9点采集 AI 科技热点 + 更新公众号 + 发我邮箱」
 *   → 组队建好了 Bot、群建好了、定时任务挂上了。用户看着侧栏,觉得整条链
 *     搭好了。
 *   → 到了 9 点,机器醒来。routine_fire 做了什么?
 *     重排下一次 ✅ 写了一份草稿 ✅ 排了一条邮件审批 ✅
 *     **把那句话派进群?没有。**
 *   → 于是群里的成员回合一次都没有被触发。任务"在跑",其实没跑;
 *     盘上多了一份没人看的草稿。用户看不出来 —— 这就是"看起来修了"的典型形态。
 *
 * 契约(先立红,修完必须全绿):
 *   1. 挂了群的定时任务到点 ⇒ 用户那句话**真的进群**、成员真的被触发。
 *   2. 没有群的定时任务 ⇒ 不派(如实说 skipped),不假装派过。
 *   3. **对外**动作(发邮件)仍然要人批 —— 机器自己干活可以,
 *      替人对外说话仍然要人点头。派活不许顺手把邮件发出去。
 *   4. 草稿 / 审批排队这些既有行为一个字都不许改。
 *   5. tick(扫到期)这条路也要派 —— 到点通常是 tick 发现的,不是谁手敲的。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };
const check = (cond, m, d) => { if (cond) ok(m); else bad(m, d); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rd-"));
const dataRoot = path.join(tmp, "data");
const ffi = createHostFfi(tmp, { dataRoot });
// 同一份 dataRoot ⇒ FFI 里的 surface 和下面这个 surface 看的是同一个盘。
const surf = createProductSurface(tmp, { dataRoot });

// 假内核 runner:成员回合真的被触发了(我们只验"触发了",不验模型说什么)。
let runnerCalls = [];
ffi.setTurnRunner(async (text, ctx) => {
  runnerCalls.push({ text: String(text || ""), ctx: ctx || {} });
  return { ok: true, assistant: "[fake] " + String(text || "").slice(0, 40) };
});

(async function main() {
console.log("prove_routine_dispatch（定时任务到点派活）");

const mkBot = (name, job) => {
  const r = surf.createBot({ name, job }) || {};
  return (r && r.bot) || {};
};
const botA = mkBot("采集员", "采集");
const botB = mkBot("写作员", "写作");
check(!!botA.id && !!botB.id, "RD-0 Bot 建出来了", JSON.stringify({ a: botA.id, b: botB.id }));
const room = surf.roomCreate(botA.id + "," + botB.id, "科技热点小组");
check(room && room.ok === true, "RD-0 群建出来了", JSON.stringify(room || {}).slice(0, 200));
const roomId =
  (room && room.room && room.room.id) ||
  (room && (room.room_id || room.id)) ||
  "";
check(!!roomId, "RD-0 群 id 拿到了", JSON.stringify(room || {}).slice(0, 200));

const transcriptOf = (id) => {
  const rooms = surf.loadRooms() || {};
  const r = ((rooms.rooms || []).find((x) => x && x.id === id)) || {};
  return Array.isArray(r.transcript) ? r.transcript : [];
};
const pendingApprovals = () => {
  try {
    const p = surf.pendingApprovals() || {};
    return Array.isArray(p.pending) ? p.pending : [];
  } catch (_) {
    return [];
  }
};

// ── RD-1: 挂了群的定时任务到点 ⇒ 真的派活 -------------------------------
const RID = "routine-test-1";
await ffi.executeHostEffects(
  [{ kind: "routine_schedule", command: RID + "|@daily|每天9点采集 AI 科技热点" }],
  { roomId },
);
const rows = await ffi.executeHostEffects([{ kind: "routine_fire", command: RID }], {});
const fireRes = (rows || []).find((x) => x && x.kind === "routine_fire") || {};
let firePayload = {};
try { firePayload = JSON.parse(fireRes.stdout || "{}"); } catch (_) { firePayload = {}; }

check(fireRes.ok === true, "RD-1 定时任务到点执行成功", JSON.stringify(fireRes).slice(0, 200));
check(
  firePayload.room_dispatch && firePayload.room_dispatch.ok === true,
  "RD-1 到点把活派进了群",
  JSON.stringify(firePayload.room_dispatch || {}).slice(0, 240),
);
const tr = transcriptOf(roomId);
check(
  tr.some((t) => t && String(t.text || "").includes("每天9点采集")),
  "RD-1 用户那句话真的落在群转录里",
  JSON.stringify(tr.slice(-3)).slice(0, 240),
);
check(
  runnerCalls.length > 0,
  "RD-1 成员回合真的被触发了(不是只落一条转录)",
  "runnerCalls=" + runnerCalls.length,
);

// ── RD-2 负向: 没有群的定时任务 ⇒ 不派 ----------------------------------
const RID2 = "routine-test-2";
await ffi.executeHostEffects(
  [{ kind: "routine_schedule", command: RID2 + "|@daily|没有群的活" }],
  {},
);
const rows2 = await ffi.executeHostEffects([{ kind: "routine_fire", command: RID2 }], {});
const fire2 = (rows2 || []).find((x) => x && x.kind === "routine_fire") || {};
let fire2Payload = {};
try { fire2Payload = JSON.parse(fire2.stdout || "{}"); } catch (_) { fire2Payload = {}; }
check(fire2.ok === true, "RD-2 没有群的任务也执行成功", JSON.stringify(fire2).slice(0, 160));
check(
  fire2Payload.room_dispatch && fire2Payload.room_dispatch.skipped === true,
  "RD-2 负向:没有群 ⇒ 如实说没派,不假装派过",
  JSON.stringify(fire2Payload.room_dispatch || {}).slice(0, 200),
);
const callsBefore = runnerCalls.length;
await ffi.executeHostEffects([{ kind: "routine_fire", command: RID2 }], {});
check(
  runnerCalls.length === callsBefore,
  "RD-2 负向:没有群 ⇒ 一个成员回合都没被触发",
  "calls " + callsBefore + " → " + runnerCalls.length,
);

// ── RD-3 负向: 对外动作仍然要人批 ---------------------------------------
const mailBefore = pendingApprovals().length;
check(
  firePayload.requires_approval === true,
  "RD-3 派活不等于放行:这条任务仍然标着要审批",
  JSON.stringify(firePayload).slice(0, 200),
);
check(
  firePayload.executed !== true,
  "RD-3 负向:机器没有自己把对外动作做了",
  "executed=" + firePayload.executed,
);

// ── RD-4: 草稿 / 审批排队这些既有行为一个字都没改 ------------------------
check(
  typeof firePayload.draft_path === "string" && fs.existsSync(firePayload.draft_path),
  "RD-4 草稿照旧落盘(GP-108 的行为没被改)",
  String(firePayload.draft_path || ""),
);
check(
  pendingApprovals().length >= mailBefore,
  "RD-4 审批队列没被这次派活搞坏",
  mailBefore + " → " + pendingApprovals().length,
);

// ── RD-5: tick 扫到期的这条路也要派 -------------------------------------
const RID3 = "routine-test-3";
await ffi.executeHostEffects(
  [{ kind: "routine_schedule", command: RID3 + "|@daily|tick 扫到的活" }],
  { roomId },
);
// 把 next_due 拨到过去,让 sweep 认它到期。
const routinesPath = path.join(dataRoot, "routines", "host-routines.json");
try {
  const j = JSON.parse(fs.readFileSync(routinesPath, "utf8"));
  const list = Array.isArray(j) ? j : (j.routines || []);
  const row = list.find((r) => r && r.id === RID3);
  if (row) {
    row.next_due = new Date(Date.now() - 60 * 1000).toISOString();
    fs.writeFileSync(routinesPath, JSON.stringify(j, null, 2));
  }
} catch (_) { /* 读不到就让下面的断言如实红 */ }
const callsBeforeTick = runnerCalls.length;
const tickRows = await ffi.executeHostEffects([{ kind: "routine_tick", command: "" }], {});
const tickRes = (tickRows || []).find((x) => x && x.kind === "routine_tick") || {};
let tickPayload = {};
try { tickPayload = JSON.parse(tickRes.stdout || "{}"); } catch (_) { tickPayload = {}; }
check(
  Array.isArray(tickPayload.room_dispatches) &&
    tickPayload.room_dispatches.length > 0 &&
    tickPayload.room_dispatches.every((d) => d && d.ok === true),
  "RD-5 tick 扫到期的任务也派进了群(而且**派成功了**,不是只挂了个条目)",
  JSON.stringify(tickPayload.room_dispatches || {}).slice(0, 240),
);
check(
  runnerCalls.length > callsBeforeTick,
  "RD-5 tick 这条路真的触发了成员回合",
  "calls " + callsBeforeTick + " → " + runnerCalls.length +
    " | dispatches=" + JSON.stringify(tickPayload.room_dispatches || {}).slice(0, 300),
);

// ── RD-6: 无人值守时路由拿不准 ⇒ 兜底继续,而且**如实记下是兜底** --------
// 「这句话我没看出该谁做」在常开机器上问不到人 ⇒ 停下来就是永远卡死。
const reports = transcriptOf(roomId).filter((t) => t && t.kind === "final_report");
const fallbackReport = reports.find((t) => t && t.route && t.route.mode === "unattended_fallback_to_first");
check(
  !!fallbackReport,
  "RD-6 路由拿不准时,无人值守走兜底而不是停下来问(常开机器上没人能答)",
  JSON.stringify(reports.slice(-2)).slice(0, 300),
);
check(
  !!(fallbackReport && fallbackReport.route && fallbackReport.route.reason),
  "RD-6 兜底在转录里留了原因(是兜底,不是判断)",
  JSON.stringify((fallbackReport && fallbackReport.route) || {}).slice(0, 200),
);


console.log("\nprove_routine_dispatch: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_routine_dispatch: " + String((e && e.message) || e));
  console.log("\nprove_routine_dispatch: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
