#!/usr/bin/env node
"use strict";

/**
 * prove_room_orchestrator — 群编排「真团队」合同自证。
 *
 * 覆盖：handoff 真执行 / lead 综合 / 共享任务板回读 / 分工 / 预算闸门 /
 * 真取消 / fail-open 有界降级 / 重复劳动率。
 *
 * ── main.js 需要接的改动（本脚本不改 main.js，只把合同钉在这里）────────────
 *  1) hosts/desktop/main.js `runRoomResponderTurn(botId, task, ctx)`（约 L1671）：
 *     runner.runTurn 的 opts 里加三行 —— 否则超时只是外层 reject，内核回合会
 *     继续跑、继续烧 token：
 *       cancelPromise: ctx && ctx.cancelPromise,   // 群编排的取消通道
 *       isCancelled:  ctx && ctx.isCancelled,       // 内核每步问一次
 *       timeoutMs:     ctx && ctx.timeoutMs,        // 到点 SIGKILL 子进程
 *  2) hosts/desktop/main.js `bitbot:rooms:orchestrate` 的 deps（约 L1845）：
 *       deps: {
 *         runResponderTurn: runRoomResponderTurn,
 *         selectResponders: selectRoomResponders,
 *         synthesize: runRoomResponderTurn,   // ← lead 综合回合（多一次模型调用，
 *                                            //   同样吃团队预算与取消通道）
 *         timeoutMs,
 *         maxTurns, maxWallMs, maxTokens,     // 团队预算（不传用默认值）
 *         concurrency, maxFailOpen,           // 并发度 / fail-open 降级上限
 *       }
 *     （synthesize 不接就没有 lead 综合层，report.synthesis.reason 会如实写
 *      synthesizer_not_configured —— 不假装有综合。）
 *  3) hosts/desktop/main.js 第 456 行 `const surface = createProductSurface(REPO_ROOT);`
 *     之后加：
 *       surface.setRoomRuntimeDeps({ runResponderTurn: runRoomResponderTurn, timeoutMs });
 *     这样 host_ffi.js:24608 的同步 handoff_task 效果也会**真的**执行交接
 *     （同步入口只受理排队，目标 Bot 的回执随后落进群转录）。
 *     想同步拿到结果就直接调：
 *       const res = await surface.handoffTaskAsync(args, { runResponderTurn: runRoomResponderTurn });
 *  4) hosts/desktop/main.js `buildRoomContext(roomId, botId, ctx, task)`（约 L1694）：
 *     可选把共享任务板带进系统上下文（成员 prompt 里已经有了，这里是第二条路径）：
 *       sharedBoard: (ctx && ctx.shared_board) || ""
 *  5) hosts/desktop/main.js `selectRoomResponders`（约 L1775）：可选把板子透传给
 *     discretion 回合：签名改成 ({ room, task, candidates, board })，再把 board
 *     传进 runRoomDiscretionTurn → buildDiscretionPrompt({ bot, task, board })。
 * ─────────────────────────────────────────────────────────────────────────
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { createProductSurface } = require("../hosts/desktop/product_surface");
const roomOrchestrator = require("../hosts/desktop/room_orchestrator");
const { asarPathOf } = require("./lib_pack_manifest.js");

let pass = 0;
let fail = 0;
const ok = (message) => { pass++; console.log("  ✓ " + message); };
const bad = (message, detail) => {
  fail++;
  console.log("  ✗ " + message + (detail === undefined || detail === null ? "" : " — " + String(detail).slice(0, 300)));
};
const check = (cond, message, detail) => (cond ? ok(message) : bad(message, detail));

/* ---------- 夹具：临时 repo root（rooms.json / bots.json / 共享任务板） ---------- */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "room-orch-"));
const DATA = path.join(ROOT, "data", "desktop");
fs.mkdirSync(DATA, { recursive: true });
const BOTS = [
  { id: "b1", name: "Alice", job: "research", description: "collect facts", hidden: false, pinned: false },
  { id: "b2", name: "Bob", job: "writing", description: "draft prose", hidden: false, pinned: false },
  { id: "b3", name: "Carol", job: "review", description: "check numbers", hidden: false, pinned: false },
];
fs.writeFileSync(
  path.join(DATA, "bots.json"),
  JSON.stringify({ version: 1, primary_id: "b1", bots: BOTS }, null, 2),
);
const ROOM_ID = "room-orch-1";
fs.writeFileSync(
  path.join(DATA, "rooms.json"),
  JSON.stringify({
    version: 1,
    rooms: [{ id: ROOM_ID, title: "Orch Room", members: ["b1", "b2", "b3"], transcript: [] }],
  }, null, 2),
);

const surface = createProductSurface(ROOT);
const readRooms = () => JSON.parse(fs.readFileSync(path.join(DATA, "rooms.json"), "utf8"));
const transcript = () => {
  const room = (readRooms().rooms || []).find((r) => r && r.id === ROOM_ID);
  return (room && room.transcript) || [];
};
const boardPath = path.join(ROOT, "data", "agents", "sections", ROOM_ID + ".json");
const readBoard = () => {
  try {
    return JSON.parse(fs.readFileSync(boardPath, "utf8"));
  } catch (_) {
    return null;
  }
};

/** 记录每次模型调用的假 runner。 */
function makeRunner(handler) {
  const calls = [];
  const runResponderTurn = async (botId, task, ctx) => {
    calls.push({ bot_id: botId, task: String(task || ""), ctx: ctx || {} });
    if (typeof handler === "function") return handler(botId, task, ctx, calls);
    return { ok: true, text: botId + " 的原话回答" };
  };
  return { calls, runResponderTurn };
}

console.log("prove_room_orchestrator — 群编排真团队合同");

(async function main() {

/* ───────────────────────── 1. handoff 真执行 ───────────────────────── */
  await (async () => {
  const runner = makeRunner(async (botId) => ({ ok: true, text: "目标 Bot 的真实产出：" + botId }));
  const res = await surface.handoffTaskAsync(
    { room: ROOM_ID, from_bot: "b1", to_bot: "b2", task: "把草稿写完" },
    { runResponderTurn: runner.runResponderTurn },
  );
  check(res.ok === true && res.accepted === true, "handoff：目标 Bot 跑成功 → 受理成立（ok）");
  check(res.replied === true && res.pending === false, "handoff：真答上了就不该挂着 pending");
  check(res.pretend_transferred === true, "handoff：真执行成功后 pretend_transferred 才为 true");
  check(String(res.target_reply || "").includes("目标 Bot 的真实产出"), "handoff：目标 Bot 真的产出了回复");
  check(runner.calls.length === 1 && runner.calls[0].bot_id === "b2", "handoff：真的触发了目标 Bot 的回合");
  const tx = transcript();
  check(tx.some((e) => e && e.kind === "handoff" && e.to_bot === "b2"), "handoff：交接行落进群转录");
  check(tx.some((e) => e && e.kind === "bot_reply" && e.bot_id === "b2"), "handoff：目标回复落进群转录（闭环可见）");

  // 承接方答不上（没配密钥 / 超时 / provider 挂了）时：所有权与凭据必须留下，
  // 「当场答上」这一项必须如实为 false。旧写法把整笔 ok 判 false，Host 就跳过
  // inbox 行与存根 —— 群转录写着「已转交」，收件箱里什么都没有。
  const failRunner = makeRunner(async () => ({ ok: false, error: "provider down" }));
  const bad = await surface.handoffTaskAsync(
    { room: ROOM_ID, from_bot: "b1", to_bot: "b3", task: "做一份核对" },
    { runResponderTurn: failRunner.runResponderTurn },
  );
  check(bad.ok === true && bad.accepted === true, "handoff：目标没答上，转交这笔仍然成立（凭据不得整笔跳过）");
  check(bad.transferred === false && bad.replied === false, "handoff：没答上就不能说已交接完成");
  check(bad.pretend_transferred === false, "handoff：失败时 pretend_transferred 仍是 false（不假装成功）");
<<<<<<< HEAD
  check(String(bad.error || "").length > 0, "handoff：失败原因可见");
  check(bad.accepted === true, "handoff：目标答不上来仍算已受理（宿主照常投递，任务不丢）");
=======
  check(bad.pending === true, "handoff：没答上必须标 pending（这件事还挂着，不是终态）");
  check(String(bad.reply_error || "") === "provider down", "handoff：没答上的原因可见（reply_error）");
  check(bad.error === "" || bad.error === undefined, "handoff：受理成立时不得再带 error（那是拒绝位）");
>>>>>>> e6091f685cc50ab4ab63b18dced6cbdeb9dfcf60
  check(
    transcript().some((e) => e && e.kind === "bot_reply_error" && e.bot_id === "b3"),
    "handoff：目标失败在群转录里如实可见",
  );

  // 因果一致：受理成立 ⇒ 必须能落凭据。这里按 Host 侧同一个判据（res.ok）验一遍，
  // 并把「写行却不排队」这种半态钉死。
  const queueable = (r) => r.ok === true && (r.replied === false ? r.pending === true : true);
  check(queueable(res) && queueable(bad), "handoff：受理成立的两种当场结果都满足「可落凭据」判据");

  const noRunner = await surface.handoffTaskAsync(
    { room: ROOM_ID, from_bot: "b1", to_bot: "b2", task: "没有 runner 的一句转交" },
    {},
  );
  check(
    noRunner.ok === true && noRunner.pending === true && noRunner.reply_error === "handoff_runner_required",
    "handoff：没有 runner 时 = 受理 + 排队，而不是整笔消失",
  );

  // 同步入口（host_ffi.js 走它）：只受理，不假装已交接。
  const sync = surface.handoffTask({ room: ROOM_ID, from_bot: "b1", to_bot: "b2", task: "同步入口" });
  check(sync.ok === true && sync.pending === true, "handoff 同步入口：受理并标 pending");
  check(sync.pretend_transferred === false && sync.executed === false, "handoff 同步入口：没有执行就不能说已交接");
  check(sync.accepted === true && sync.replied === false, "handoff 同步入口与异步入口同一套词汇（受理 / 答上）");

  const refuse = await surface.handoffTaskAsync(
    { room: ROOM_ID, from_bot: "b1", to_bot: "nobody", task: "x" },
    { runResponderTurn: runner.runResponderTurn },
  );
  check(refuse.ok === false && refuse.error === "to_bot_not_member", "handoff：非成员仍然拒绝（不发明转移）");
  check(refuse.accepted !== true, "handoff：被拒绝的转交标成未受理（宿主据此不会投递任务）");

  // 没有运行时依赖（CLI / 移动端 host 就是这种局面）：受理并排队，不是失败。
  // 2026-10-29 之前这一支返回 ok:false，于是 host_ffi 连 inbox 都不写，
  // 「转交」只剩一行转录——GP-52 的三项门禁红在这里，红的是产品不是脚本。
  const noRunner = await surface.handoffTaskAsync(
    { room: ROOM_ID, from_bot: "b1", to_bot: "b2", task: "没人接手也要留住任务" },
    {},
  );
  check(
    noRunner.ok === true && noRunner.accepted === true && noRunner.pending === true && noRunner.executed === false,
    "handoff：无 runner = 受理并排队（ok/accepted 为真，executed 仍为假）",
  );
  check(noRunner.pretend_transferred === false, "handoff：排队不假装已交接");
  check(noRunner.execution === "queued", "handoff：回执写明执行状态是 queued");
  const queuedSync = surface.handoffTask({ room: ROOM_ID, from_bot: "b1", to_bot: "b2", task: "同步入口的受理标记" });
  check(queuedSync.accepted === true, "handoff 同步入口：与异步入口共用 accepted 语义");
})();

/* ─────── 1b. pending 凭据的下游：捡起 / 幂等 / 有界重试（GP-166） ───────
   §8.30 之后凭据（inbox 行 + 存根）会诚实落盘，但全仓没有任何消费者 ——
   承接方这轮没答上，这笔任务就永远挂着。这一节把「下一轮必须真捡起重跑，
   而且只跑一次、跑不完要如实卡住」钉成合同。凭据形状照 host_ffi.js 的落盘
   段（{...res, inbox_path, path}），不另造一套。 */
  await (async () => {
  const HO_DIR = path.join(ROOT, "data", "agents", "handoffs");
  const stubPath = (id) => path.join(HO_DIR, id + ".json");
  const putStub = (id, res, extra) => {
    fs.mkdirSync(HO_DIR, { recursive: true });
    const body = Object.assign({}, res, { inbox_path: "", path: stubPath(id) }, extra || {});
    fs.writeFileSync(stubPath(id), JSON.stringify(body, null, 2));
    return body;
  };
  const getStub = (id) => {
    try { return JSON.parse(fs.readFileSync(stubPath(id), "utf8")); } catch (_) { return null; }
  };
  const rowsIn = (room, kind, botId) => {
    const r = (readRooms().rooms || []).find((x) => x && x.id === room) || {};
    return ((r.transcript || []).filter((e) => e && e.kind === kind && (!botId || e.bot_id === botId)));
  };
  const retry = async (o) => {
    if (typeof surface.retryPendingHandoffs !== "function") {
      return { __missing: true, attempted: 0, answered: 0, scanned: 0 };
    }
    try { return await surface.retryPendingHandoffs(o || {}); } catch (e) {
      return { __error: String((e && e.message) || e), attempted: 0, answered: 0, scanned: 0 };
    }
  };
  // 另开一间群，避免动主群的成员名单影响后面各节的计数
  const ROOM2 = "room-orch-2";
  // 自己造一笔「受理成立但当场没答上」的凭据（形状 = host_ffi 落盘的那份），
  // 不复用上文的夹具：那一节的局部变量在这一节的作用域里根本不存在。
  const pendSrc = makeRunner(async () => ({ ok: false, error: "provider down" }));
  const pend = await surface.handoffTaskAsync(
    { room: ROOM_ID, from_bot: "b1", to_bot: "b3", task: "做一份核对" },
    { runResponderTurn: pendSrc.runResponderTurn },
  );
  if (!(pend && pend.ok === true && pend.pending === true)) {
    check(false, "R-00 捡起这一节的前置夹具：先要有一笔「受理但没答上」的转交凭据", JSON.stringify({ ok: pend && pend.ok, pending: pend && pend.pending }));
  }
  const rr0 = readRooms();
  if (!(rr0.rooms || []).some((r) => r && r.id === ROOM2)) {
    rr0.rooms.push({ id: ROOM2, title: "Retry Room", members: ["b1", "b2"], transcript: [] });
    fs.writeFileSync(path.join(DATA, "rooms.json"), JSON.stringify(rr0, null, 2));
  }

  /* R-01 用户旅程那一跳：博主在群里再发一句话，挂着的那笔必须被捡起来重跑。
     走 dispatchRoomTurn（CLI / 移动端 / 桌面 IPC 共用的唯一入口），不是只调内部函数。 */
  const id1 = "handoff-b3-gp166a";
  putStub(id1, pend);
  const pickRunner = makeRunner(async (botId) => ({ ok: true, text: botId + " 捡起之后的真回答" }));
  const answeredBefore = rowsIn(ROOM_ID, "bot_reply", "b3").length;
  const dispatched = await require("../hosts/shared/room_dispatch").dispatchRoomTurn({
    surface,
    roomId: ROOM_ID,
    text: "@Bob 继续",
    deps: { runResponderTurn: pickRunner.runResponderTurn },
  });
  const retr = (dispatched && dispatched.handoff_retry) || null;
  check(
    Boolean(dispatched && dispatched.ok) && retr && Number(retr.attempted) >= 1,
    "R-01 新一条群消息真的把 pending 的转交捡起重跑（产品入口在 dispatchRoomTurn，不是只留一个内部函数）",
    retr ? JSON.stringify(retr) : (dispatched && dispatched.error) || "回包里根本没有 handoff_retry",
  );
  check(rowsIn(ROOM_ID, "bot_reply", "b3").length === answeredBefore + 1, "R-01b 捡起的答案真落进群转录（恰好多一条）");
  const s1 = getStub(id1) || {};
  check(s1.state === "answered" && Number(s1.attempts) === 1, "R-01c 凭据写下终态与次数（answered / attempts=1）", JSON.stringify({ state: s1.state, attempts: s1.attempts }));
  check(s1.to_bot === "b3" && s1.task === "做一份核对" && s1.room === ROOM_ID, "R-01d 回写不吞掉原凭据（谁、哪个群、哪件事还在）");

  /* R-02 幂等：已经终态的凭据不许再跑第二遍 —— 「定时发文 / 推邮箱」这类动作跑两遍就是事故 */
  const callsA = pickRunner.calls.length;
  const answeredNow = rowsIn(ROOM_ID, "bot_reply", "b3").length;
  const d2 = await require("../hosts/shared/room_dispatch").dispatchRoomTurn({
    surface,
    roomId: ROOM_ID,
    text: "@Bob 再说一句",
    deps: { runResponderTurn: pickRunner.runResponderTurn },
  });
  const retr2 = (d2 && d2.handoff_retry) || {};
  check(
    rowsIn(ROOM_ID, "bot_reply", "b3").length === answeredNow &&
      Number(retr2.attempted || 0) === 0 &&
      pickRunner.calls.length === callsA + 1,
    "R-02 同一笔凭据不重跑：答案不出现第二条，模型调用不多花一次（本轮只算新消息那一次）",
    JSON.stringify({ retr2, delta_calls: pickRunner.calls.length - callsA }),
  );

  /* R-03 有界重试：一直答不上 → attempts 递增到上限后如实卡住，并且不再自激 */
  const id3 = "handoff-b3-gp166c";
  putStub(id3, Object.assign({}, pend, { task: "核对数字（一直失败）" }));
  const flaky = makeRunner(async () => ({ ok: false, error: "provider down" }));
  const capProbe = await retry({ room: ROOM_ID, deps: flaky });
  const cap = Number((capProbe && capProbe.max_attempts) || 0);
  check(cap >= 1, "R-03a 捡起策略给得出重试上限（不是一句「会重试」）", JSON.stringify(capProbe));
  let seen = [capProbe];
  for (let i = 1; i < cap; i++) seen.push(await retry({ room: ROOM_ID, deps: flaky }));
  const s3 = getStub(id3) || {};
  check(
    s3.state === "stuck" && Number(s3.attempts) === cap,
    "R-03b 到上限就如实标 stuck（attempts 等于上限，不是悄悄挂到永远）",
    JSON.stringify({ state: s3.state, attempts: s3.attempts }),
  );
  check(
    rowsIn(ROOM_ID, "bot_reply_error", "b3").some((e) => /handoff_stuck/.test(String(e.error || e.text || ""))),
    "R-03c stuck 这件事在群转录里看得见，并点名承接方与原因",
  );
  const callsB = flaky.calls.length;
  const capAfter = await retry({ room: ROOM_ID, deps: flaky });
  check(
    Number(capAfter.attempted || 0) === 0 && flaky.calls.length === callsB,
    "R-03d 已经 stuck 的凭据不再烧模型（终态就是终态，不自激循环）",
    JSON.stringify({ attempted: capAfter.attempted, calls: flaky.calls.length - callsB }),
  );

  /* R-04 捡起的那一轮上下文与正常交接一致：交接目标身份 + 取消通道在 + 没有任何审批放行 */
  const id4 = "handoff-b3-gp166d";
  putStub(id4, Object.assign({}, pend, { task: "带上下文重跑" }));
  const ctxRunner = makeRunner(async () => ({ ok: true, text: "带上下文的答案" }));
  await retry({ room: ROOM_ID, deps: ctxRunner });
  const ctxRow = ctxRunner.calls[ctxRunner.calls.length - 1] || {};
  const ctx = ctxRow.ctx || {};
  check(
    ctxRow.bot_id === "b3" && ctx.role === "handoff_target" && typeof ctx.isCancelled === "function" &&
      (ctx.approved === undefined || ctx.approved === false),
    "R-04 捡起的一轮与被拒前那轮同一套上下文（role=handoff_target / 取消通道在 / 没有偷偷带审批放行）",
    JSON.stringify({ bot: ctxRow.bot_id, role: ctx.role, approved: ctx.approved }),
  );

  /* R-05 承接方已经被移出群：不能假装它答了，也不能把行写进那间群 */
  const id5 = "handoff-b2-gp166e";
  const handoffInRoom2 = await surface.handoffTaskAsync(
    { room: ROOM2, from_bot: "b1", to_bot: "b2", task: "被移出去之前的转交" },
    { runResponderTurn: makeRunner(async () => ({ ok: false, error: "provider down" })).runResponderTurn },
  );
  putStub(id5, handoffInRoom2);
  const rr2 = readRooms();
  const room2 = (rr2.rooms || []).find((r) => r && r.id === ROOM2);
  room2.members = ["b1"];
  fs.writeFileSync(path.join(DATA, "rooms.json"), JSON.stringify(rr2, null, 2));
  const repliesBefore = rowsIn(ROOM2, "bot_reply", "b2").length;
  const r5 = await retry({ room: ROOM2, deps: makeRunner(async () => ({ ok: true, text: "不该出现的回答" })) });
  const s5 = getStub(id5) || {};
  check(
    rowsIn(ROOM2, "bot_reply", "b2").length === repliesBefore &&
      s5.state === "stuck" && /not_member/.test(String(s5.last_error || "")),
    "R-05 承接方已不在群里 → 如实卡住（不产出任何「它答了」的行，原因点名 to_bot_not_member）",
    JSON.stringify({ attempted: r5.attempted, state: s5.state, last_error: s5.last_error }),
  );

  /* R-06 凭据文件坏掉：跳过它、不动它，别的凭据照常捡（不删用户数据） */
  fs.mkdirSync(HO_DIR, { recursive: true });
  const broken = path.join(HO_DIR, "handoff-b3-gp166f.json");
  const brokenRaw = "{ this is not json at all ]";
  fs.writeFileSync(broken, brokenRaw);
  const id6 = "handoff-b3-gp166g";
  putStub(id6, Object.assign({}, pend, { task: "坏文件旁边那笔正常的" }));
  const goodRunner = makeRunner(async () => ({ ok: true, text: "坏文件不影响我这笔" }));
  const r6 = await retry({ room: ROOM_ID, deps: goodRunner });
  check(
    !r6.__missing && !r6.__error && Number(r6.skipped_malformed) >= 1 && getStub(id6) && getStub(id6).state === "answered",
    "R-06 坏凭据被如实跳过并计数，同目录其它凭据照常处理（不因为一个坏文件整批放弃）",
    JSON.stringify({ skipped_malformed: r6.skipped_malformed, state: (getStub(id6) || {}).state }),
  );
  check(fs.readFileSync(broken, "utf8") === brokenRaw, "R-06b 坏文件原样留在原地（门禁不许覆盖或删除用户数据）");

  /* R-07 没有 pending 的群：一次零成本扫描（不能多花一次模型调用） */
  const idleRunner = makeRunner(async () => ({ ok: true, text: "idle" }));
  const r7 = await retry({ room: "room-does-not-exist", deps: idleRunner });
  check(
    Number(r7.attempted || 0) === 0 && idleRunner.calls.length === 0,
    "R-07 没有待捡的凭据时一次模型调用都不多发（扫描不是新的成本）",
    JSON.stringify(r7),
  );

  /* R-08 群之间不串：这轮的捡起只处理这间的凭据 */
  const id8 = "handoff-b1-gp166h";
  const room2Again = await surface.handoffTaskAsync(
    { room: ROOM2, from_bot: "b1", to_bot: "b1", task: "留给另一间的凭据" },
    { runResponderTurn: makeRunner(async () => ({ ok: false, error: "provider down" })).runResponderTurn },
  );
  putStub(id8, room2Again);
  const s8before = (getStub(id8) || {}).state;
  await retry({ room: ROOM_ID, deps: makeRunner(async () => ({ ok: true, text: "不该被别的群捡走" })) });
  check((getStub(id8) || {}).state === s8before, "R-08 主群的回合不碰另一间的 pending 凭据（隔离）", JSON.stringify({ state: (getStub(id8) || {}).state }));

  /* R-09 正在被别人跑的凭据（新鲜 claim）不重复跑；R-10 只有过期 claim 才允许接手 */
  const id9 = "handoff-b3-gp166i";
  putStub(id9, Object.assign({}, pend, { task: "正在跑的那笔" }), { state: "running", claimed_at: new Date().toISOString() });
  const claimRunner = makeRunner(async () => ({ ok: true, text: "重复跑会出现两条答案" }));
  const r9 = await retry({ room: ROOM_ID, deps: claimRunner });
  check(
    claimRunner.calls.filter((c) => c.bot_id === "b3").length === 0 && Number(r9.skipped_running || 0) >= 1,
    "R-09 新鲜 claim（另一个回合正在跑它）不会被第二次捡起 —— 两条答案就是重复劳动",
    JSON.stringify({ skipped_running: r9.skipped_running }),
  );
  const id10 = "handoff-b3-gp166j";
  putStub(id10, Object.assign({}, pend, { task: "跑一半宿主没了的那笔" }), {
    state: "running",
    claimed_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    attempts: 1,
  });
  const staleRunner = makeRunner(async () => ({ ok: true, text: "过期 claim 由下一个回合接手" }));
  await retry({ room: ROOM_ID, deps: staleRunner });
  const s10 = getStub(id10) || {};
  check(
    staleRunner.calls.some((c) => c.bot_id === "b3") && s10.state === "answered" && Number(s10.attempts) === 2,
    "R-10 claim 过期（宿主中途没了）才允许接手，并把次数累加上去（不是从零开始）",
    JSON.stringify({ state: s10.state, attempts: s10.attempts }),
  );
})();

/* ───────────────── 2. lead 综合 + 成员原话可分辨 ───────────────── */
  await (async () => {
  const runner = makeRunner(async (botId, task, ctx) => {
    if (ctx && ctx.role === "synthesis") {
      return { ok: true, text: "综合结论：先做数据收集，再写报告，最后核对。" };
    }
    return { ok: true, text: botId + " 的原话回答：" + botId };
  });
  const res = await surface.orchestrateRoom({
    room: ROOM_ID,
    task: "季度竞品结论；再写一段长文草稿",
    policy: "mentioned_only",
    to: ["b1", "b2"],
    deps: {
      runResponderTurn: runner.runResponderTurn,
      // 综合走独立依赖（main.js: synthesize: runRoomResponderTurn）。
      synthesize: runner.runResponderTurn,
    },
  });
  const fr = res.final_report || {};
  check(res.ok === true && res.total === 2 && res.returned === 2, "综合回合：成员 2/2 收齐");
  check(fr.synthesis && fr.synthesis.ok === true, "综合回合：真的调了一次模型产出综合答案");
  check(
    String(fr.synthesis.summary || "").includes("综合结论"),
    "综合回合：综合文本是 lead 写的，不是拼接",
  );
  check(
    fr.sections.every((s) => String(s.summary || "").includes("的原话回答")),
    "综合回合：成员原话仍在 sections 里（两层不混）",
  );
  check(
    fr.synthesis.summary !== fr.sections[0].summary && fr.synthesis.lead_bot_id === "b1",
    "综合回合：lead 综合与成员原话可分辨，lead 由宿主确定性选出",
  );
  check(
    String(fr.synthesis.summary || "").length <= 241,
    "综合回合：摘要仍受 240 字截断",
  );
  check(
    String(fr.synthesis.text || "").length > String(fr.synthesis.summary || "").length ||
      fr.synthesis.summary_truncated === undefined,
    "综合回合：完整正文保留在 transcript（summary 只是摘要）",
  );
  const synthCalls = runner.calls.filter((c) => c.ctx && c.ctx.role === "synthesis");
  check(synthCalls.length === 1, "综合回合：只多了一次模型调用");
  check(
    String(synthCalls[0].ctx.cancelPromise ? "yes" : "no") === "yes",
    "综合回合：综合调用也带取消通道",
  );
  check(
    transcript().some((e) => e && e.kind === "system" && String(e.text || "").includes("群综合")),
    "综合回合：lead 的答案在群转录里看得见（系统行）",
  );
})();

/* ───────────────── 3. 部分失败也要出综合，并标注缺口 ───────────────── */
  await (async () => {
  const runner = makeRunner(async (botId, task, ctx) => {
    if (ctx && ctx.role === "synthesis") return { ok: true, text: "综合：能做的先做，缺的如实写明。" };
    if (botId === "b2") return { ok: false, error: "provider 500" };
    return { ok: true, text: "b1 的原话回答" };
  });
  const res = await surface.orchestrateRoom({
    room: ROOM_ID,
    task: "一次部分失败的协作",
    policy: "mentioned_only",
    to: ["b1", "b2"],
    deps: {
      runResponderTurn: runner.runResponderTurn,
      synthesize: runner.runResponderTurn,
    },
  });
  const fr = res.final_report || {};
  check(res.ok === true && res.total === 2 && res.returned === 1 && res.partial === true, "部分失败：如实 1/2 partial");
  check(fr.synthesis && fr.synthesis.ok === true, "部分失败：仍然给出可用的综合结果");
  check(
    Array.isArray(fr.synthesis.gaps) && fr.synthesis.gaps.some((g) => String(g).includes("b2")),
    "部分失败：综合里标注了缺口（谁没成功）",
  );
})();

/* ───────────────── 4. 共享任务板：写 + 回读进 prompt ───────────────── */
  await (async () => {
  const runner = makeRunner(async (botId) => ({ ok: true, text: botId + " 完成自己那件" }));
  const res = await surface.orchestrateRoom({
    room: ROOM_ID,
    task: "收集竞品数据；写一段市场摘要",
    policy: "mentioned_only",
    to: ["b1", "b2"],
    // concurrency=1（放在 deps 里）：后被派到的成员必须能看到先完成者的进度。
    deps: { runResponderTurn: runner.runResponderTurn, concurrency: 1 },
  });
  const board = readBoard();
  check(board !== null, "共享任务板：文件真落盘（data/agents/sections/<room_id>.json）");
  check(board && board.group_id === ROOM_ID, "共享任务板：key 统一成 room id");
  check(
    board && Array.isArray(board.sections) && board.sections.length >= 2,
    "共享任务板：子任务被写上板",
  );
  check(
    board && board.sections.some((s) => s.owner && s.owner_name),
    "共享任务板：子任务有认领人（谁做哪件）",
  );
  check(
    board && board.sections.some((s) => s.status === "done"),
    "共享任务板：完成后状态回写（别人做到哪了）",
  );
  check(
    board && Array.isArray(board.messages) && board.messages.length >= 1,
    "共享任务板：进度消息可回读",
  );
  const second = runner.calls[1];
  check(
    second && String(second.task).includes("共享任务板"),
    "共享任务板：读回路径存在（板子进成员 prompt）",
  );
  check(
    second && String(second.task).includes("b1 完成自己那件"),
    "共享任务板：同轮里先完成的成员进度，后被派到的成员看得见",
  );
  check(
    second && second.ctx && second.ctx.shared_board && String(second.ctx.shared_board).includes("共享任务板"),
    "共享任务板：板子也通过 ctx 交给执行层（可进系统上下文）",
  );
  const prompts = runner.calls.map((c) => c.task);
  check(
    prompts[0] !== prompts[1] && prompts[0].includes("你的分工") && prompts[1].includes("你的分工"),
    "分工：不是同一份 task 广播 N 份，两个人拿到不同子任务",
  );
  check(
    res.final_report && res.final_report.subtasks && res.final_report.subtasks.length >= 2,
    "分工：final_report 如实带分工表",
  );
})();

/* ───────────────── 5. 预算：超了就停，并如实说明 ───────────────── */
  await (async () => {
  const runner = makeRunner(async (botId) => ({ ok: true, text: botId + " 的原话" }));
  const res = await surface.orchestrateRoom({
    room: ROOM_ID,
    task: "一次会超预算的协作",
    policy: "mentioned_only",
    to: ["b1", "b2", "b3"],
    deps: { runResponderTurn: runner.runResponderTurn, maxTurns: 1 },
  });
  const fr = res.final_report || {};
  check(res.ok === true, "预算：超预算不等于整轮失败");
  check(runner.calls.length === 1, "预算：只跑了预算内的回合（" + runner.calls.length + " 次调用）");
  check(res.total === 3 && res.returned === 1 && res.partial === true, "预算：没跑的人如实算缺口（1/3 partial）");
  check(fr.budget && fr.budget.exceeded === true, "预算：超预算如实标记");
  check(String(fr.budget.reason || "").includes("max_turns"), "预算：说清是哪条预算线（max_turns）");
  check(
    transcript().some((e) => e && e.kind === "system" && String(e.text || "").includes("预算")),
    "预算：停下来的事实在群转录里说明",
  );
  check(
    fr.sections.some((s) => s.ok === false),
    "预算：没跑的成员在 sections 里是失败而不是「参与」",
  );
})();

/* ───────────────── 6. fail-open 有界降级（不再全员扇出） ───────────────── */
  await (async () => {
  const runner = makeRunner(async (botId) => ({ ok: true, text: botId + " 的原话" }));
  const res = await surface.orchestrateRoom({
    room: ROOM_ID,
    task: "provider 挂掉时的一次协作",
    policy: "bot_discretion",
    deps: {
      runResponderTurn: runner.runResponderTurn,
      selectResponders: async () => ({
        ok: true,
        responders: ["b1", "b2", "b3"],
        decisions: [
          { bot_id: "b1", name: "Alice", respond: true, fail_open: true, error: "discretion timeout" },
          { bot_id: "b2", name: "Bob", respond: true, fail_open: true, error: "discretion timeout" },
          { bot_id: "b3", name: "Carol", respond: true, fail_open: true, error: "discretion timeout" },
        ],
      }),
    },
  });
  const fr = res.final_report || {};
  check(res.total <= 2, "fail-open：不再全员扇出（只带 " + res.total + " 人）");
  check(fr.degraded === true, "fail-open：降级如实标记");
  check(fr.degraded_reason === "discretion_fail_open", "fail-open：说清降级原因");
  check(
    Array.isArray(fr.discretion_excluded) && fr.discretion_excluded.length === 1,
    "fail-open：被跳过的成员如实记录（不是「参与」）",
  );
  check(fr.discretion_fail_open === res.total, "fail-open：fail_open 计数只数真进本轮的人");
  check(
    transcript().some((e) => e && e.kind === "system" && String(e.text || "").includes("选择失败")),
    "fail-open：降级说明在群转录里看得见",
  );
})();

/* ───────────────── 7. selector 整体失败 → 不扇出、不放大成本 ───────────────── */
  await (async () => {
  const runner = makeRunner(async (botId) => ({ ok: true, text: botId + " 的原话" }));
  const before = transcript().length;
  const res = await surface.orchestrateRoom({
    room: ROOM_ID,
    task: "selector 直接挂掉的一次协作",
    policy: "bot_discretion",
    deps: {
      runResponderTurn: runner.runResponderTurn,
      selectResponders: async () => { throw new Error("selector exploded"); },
    },
  });
  check(res.ok === false && res.error === "discretion_failed", "selector 整体失败：如实失败（不演成全员应答）");
  check(runner.calls.length === 0, "selector 整体失败：一个模型调用都没发生（成本没被放大）");
  check(transcript().length === before, "selector 整体失败：不写任何转录行");
})();

/* ───────────────── 7b. 未接综合依赖时，不偷偷多调模型 ───────────────── */
  await (async () => {
  const runner = makeRunner(async (botId) => ({ ok: true, text: botId + " 的原话" }));
  const res = await surface.orchestrateRoom({
    room: ROOM_ID,
    task: "没接综合依赖的一次协作",
    policy: "mentioned_only",
    to: ["b1", "b2"],
    deps: { runResponderTurn: runner.runResponderTurn },
  });
  const fr = res.final_report || {};
  check(runner.calls.length === 2, "未接综合依赖：只跑成员回合，不多花一次模型调用");
  check(
    fr.synthesis && fr.synthesis.skipped === true && fr.synthesis.reason === "synthesizer_not_configured",
    "未接综合依赖：如实说明「综合没接」（不假装有 lead 综合）",
  );
})();

/* ───────────────── 8. 真取消：超时要真的停掉执行层 ───────────────── */
  await (async () => {
  let cancelledSeen = false;
  const runner = makeRunner((botId, task, ctx) =>
    new Promise((resolve) => {
      const onCancel = ctx && ctx.cancelPromise;
      if (onCancel && typeof onCancel.then === "function") {
        onCancel.then(() => {
          cancelledSeen = true;
          resolve({ ok: false, error: "cancelled" });
        });
      }
    }),
  );
  const res = await surface.orchestrateRoom({
    room: ROOM_ID,
    task: "一次会超时的协作",
    policy: "mentioned_only",
    to: ["b1"],
    deps: { runResponderTurn: runner.runResponderTurn, timeoutMs: 60 },
  });
  check(cancelledSeen === true, "取消：超时时取消信号真的传到了执行层（不再只是外层 reject）");
  check(res.returned === 0 && res.partial === true, "取消：超时如实算失败");
  check(
    String(runner.calls[0].ctx.isCancelled || "").length > 0 || typeof runner.calls[0].ctx.isCancelled === "function",
    "取消：执行层拿到 isCancelled 探针",
  );
})();

/* ───────────────── 9. 重复劳动率（可测指标） ───────────────── */
  await (async () => {
  const same = "结论一致：市场集中度上升，建议聚焦头部客户。";
  const runner = makeRunner(async (botId) => ({ ok: true, text: same }));
  const res = await surface.orchestrateRoom({
    room: ROOM_ID,
    task: "两个成员说一模一样的话",
    policy: "mentioned_only",
    to: ["b1", "b2"],
    deps: { runResponderTurn: runner.runResponderTurn },
  });
  const dup = (res.final_report || {}).duplication || {};
  check(dup.rate === 1 && dup.duplicate_members === 2, "重复劳动率：两个相同回答被算出 100% 重复");
  check(Array.isArray(dup.groups) && dup.groups.length === 1, "重复劳动率：给出重复分组（谁和谁做了一样的事）");
})();

/* ───────────────── 10. 幂等 + 编排器纯函数合同 ───────────────── */
  await (async () => {
  const runner = makeRunner(async (botId) => ({ ok: true, text: botId + " 的原话" }));
  const task = "幂等检查用的一次任务";
  const first = await surface.orchestrateRoom({
    room: ROOM_ID, task, policy: "mentioned_only", to: ["b1"],
    deps: { runResponderTurn: runner.runResponderTurn },
  });
  const second = await surface.orchestrateRoom({
    room: ROOM_ID, task, policy: "mentioned_only", to: ["b1"],
    deps: { runResponderTurn: runner.runResponderTurn },
  });
  check(first.ok === true && second.deduped === true, "幂等：同任务再跑不重复执行（deduped）");
  check(runner.calls.length === 1, "幂等：没有第二次模型调用");

  // 纯函数：宿主确定性分工，模型无权指定
  const subs = roomOrchestrator.normalizeSubtaskProposal(
    { subtasks: ["调研", "调研", "", "写作"] },
    { maxCount: 3 },
  );
  check(subs.length === 2, "分工：模型建议被宿主形状校验（去重/去空）");
  const assigned = roomOrchestrator.assignSubtasks(subs, ["b1", "b2"]);
  check(
    assigned.get("b1")[0].title === "调研" && assigned.get("b2")[0].title === "写作",
    "分工：分配由宿主确定性轮转，不由模型指定",
  );
  check(
    roomOrchestrator.decomposeTask("买牛奶", { maxCount: 3 }).length === 0,
    "分工：拆不出子任务就诚实不拆（不假装分工）",
  );
  const scope = roomOrchestrator.createCancelScope();
  scope.cancel("x");
  check(scope.isCancelled() === true, "取消：通道本身可用");
})();

/* ───────────────── 11. 打包与接线静态检查 ───────────────── */
{
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "hosts", "desktop", "package.json"), "utf8"),
  );
  const files = (((pkg || {}).build || {}).files || []);
  check(
    asarPathOf(files, "room_orchestrator.js") === "desktop/room_orchestrator.js",
    "打包：electron-builder 带上 room_orchestrator.js（落在 desktop/）",
  );
  const surfSrc = fs.readFileSync(
    path.join(__dirname, "..", "hosts", "desktop", "product_surface.js"), "utf8",
  );
  check(
    /handoffTaskAsync/.test(surfSrc) && /setRoomRuntimeDeps/.test(surfSrc),
    "接线：surface 导出 handoffTaskAsync / setRoomRuntimeDeps",
  );
  check(
    /cancelPromise/.test(surfSrc) && /isCancelled/.test(surfSrc),
    "接线：编排层把取消通道交给执行层",
  );
}

})().then(() => {
  console.log("prove_room_orchestrator pass=" + pass + " fail=" + fail);
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch (_) {
    /* 临时目录清理失败不影响判定 */
  }
  process.exit(fail ? 1 : 0);
});
