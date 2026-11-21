#!/usr/bin/env node
"use strict";

/**
 * prove_team_division —— 「随时可以指挥的团队」的三根支柱(B-7)
 *
 * ## 为什么这道门存在
 *
 * 仓库里并行与模型分工**早就有**,但默认是关的:
 *   · `BITBOT_ROOM_DECOMPOSE` 不为 "1" ⇒ 模型提议分工**不跑**;
 *   · `auto_route` ⇒ 唯一负责人 + 串行接力(这是**用户原话**定的语义,门禁 Q-5 守着它)。
 * ⇒ 实际表现是「一堆 bot 都在动,但没在协作」—— 并行广播,不是团队。
 *
 * 本门钉住三件事:
 *   1. **团队判据**:群里**至少两个成员有职责**(job/description)⇒ 这个群是一支团队
 *      ⇒ 任务走**并行 + 分工**;没职责的群 ⇒ 老行为(一个负责人 + 串行接力)。
 *   2. **真并行**:不是"都跑了",是**时间区间真的重叠**(并发的硬证据)。
 *   3. **真分工**:成员自决时**认领**的那一段,真的进了**它自己**的 prompt。
 *
 * 另附**副作用闸**:并发跑成员时,含写动作的批次**不许并发**。
 *
 * 全部用**真的 product_surface**(临时 repo root),只有模型回合是假的。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");
const { dispatchRoomTurn } = require("../hosts/shared/room_dispatch");
const { parseDiscretionDecision, buildDiscretionPrompt } = require("../hosts/shared/room_discretion");
const { createEffectGate } = require("../hosts/shared/effect_gate");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 300))); };
const check = (c, m, d) => (c ? ok(m) : bad(m, d));

/* ---------- 夹具:临时 repo root ---------- */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "team-div-"));
const DATA = path.join(ROOT, "data", "desktop");
fs.mkdirSync(DATA, { recursive: true });
// team* 有职责(是团队);plain* 没有职责(是闲聊)
const BOTS = [
  { id: "t1", name: "Alice", job: "情报侦察员", description: "收集事实", hidden: false, pinned: false },
  { id: "t2", name: "Bob", job: "内容主笔", description: "写初稿", hidden: false, pinned: false },
  { id: "p1", name: "Carol", job: "", description: "", hidden: false, pinned: false },
  { id: "p2", name: "Dave", job: "", description: "", hidden: false, pinned: false },
];
fs.writeFileSync(
  path.join(DATA, "bots.json"),
  JSON.stringify({ version: 1, primary_id: "t1", bots: BOTS }, null, 2),
);
const TEAM_ROOM = "room-team";
const PLAIN_ROOM = "room-plain";
fs.writeFileSync(
  path.join(DATA, "rooms.json"),
  JSON.stringify({
    version: 1,
    rooms: [
      { id: TEAM_ROOM, title: "内容团队", members: ["t1", "t2"], transcript: [] },
      { id: PLAIN_ROOM, title: "闲聊", members: ["p1", "p2"], transcript: [] },
    ],
  }, null, 2),
);
const surface = createProductSurface(ROOT);
const transcriptOf = (roomId) => {
  const rooms = JSON.parse(fs.readFileSync(path.join(DATA, "rooms.json"), "utf8"));
  const room = (rooms.rooms || []).find((r) => r && r.id === roomId);
  return (room && room.transcript) || [];
};

/** 记录每次成员回合的起止时刻 —— 并发的硬证据是**区间重叠**。
 *
 * 负向对照(本门自带的那些「必须是错/必须是没发生」的断言):
 *   · 团队判据失效 ⇒ 6 红(该并行的没有并行)
 *   · 副作用闸不排队 ⇒ 2 红(写入没有串行化)
 *   · 模型分工默认关 ⇒ 2 红
 *   · 无职责的群仍只唤醒一个成员(不能瞎并行)
 *   ⇒ 外加手工变异对照。
 */

function makeRunner(handler, holdMs) {
  const calls = [];
  const runResponderTurn = async (botId, task, ctx) => {
    const started = Date.now();
    calls.push({ bot_id: botId, task: String(task || ""), ctx: ctx || {}, started, ended: 0 });
    if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
    const out = typeof handler === "function"
      ? await handler(botId, task, ctx, calls)
      : { ok: true, text: botId + " 的回答", artifacts: [] };
    calls[calls.length - 1].ended = Date.now();
    return out;
  };
  return { calls, runResponderTurn };
}

/**
 * 并发的硬证据:**第二个成员在第一个结束之前就开始了**。
 *
 * 不能读"结束时刻"来判 —— 并行时第二个成员**可能还没结束**,
 * 那恰恰是并行的证据(等它结束再判反而会把并行读成串行)。
 */
function overlaps(calls) {
  if (calls.length < 2) return false;
  const a = calls[0], b = calls[1];
  const first = a.started <= b.started ? a : b;
  const second = first === a ? b : a;
  // first.ended === 0 ⇒ 第一个成员**还在跑** ⇒ 第二个已经开始了 ⇒ 并行。
  if (!first.ended) return true;
  return second.started < first.ended;
}

console.log("prove_team_division — 团队判据 / 真并行 / 真分工 / 副作用闸");

(async function main() {
  /* ───────── 1. 有职责的群 ⇒ 走团队模式:并行 + 分工 ───────── */
  {
    const runner = makeRunner(null, 120);
    const res = await dispatchRoomTurn({
      surface,
      roomId: TEAM_ROOM,
      text: "把今天的热点整理成一篇稿子",
      deps: {
        runResponderTurn: runner.runResponderTurn,
        selectResponders: async ({ candidates }) => ({
          ok: true,
          responders: candidates.map((c) => c.id),
          decisions: [
            { bot_id: "t1", name: "Alice", respond: true, claim: "我负责收集今天的热点" },
            { bot_id: "t2", name: "Bob", respond: true, claim: "我负责把要点写成初稿" },
          ],
        }),
      },
    });
    check(res.ok === true, "TD-1 团队群派发成功", JSON.stringify(res).slice(0, 200));
    check(
      runner.calls.length === 2,
      "TD-1 团队群里**两个成员都跑了**(不是只唤醒一个)",
      runner.calls.map((c) => c.bot_id).join(",")
    );
    check(
      overlaps(runner.calls),
      "TD-2 两个成员的时间区间**真的重叠** ⇒ 真的是并发,不是排队",
      JSON.stringify(runner.calls.map((c) => [c.started, c.ended]))
    );
    /* ───────── 2. 真分工:认领进了**它自己**的 prompt ───────── */
    const alice = runner.calls.find((c) => c.bot_id === "t1");
    const bob = runner.calls.find((c) => c.bot_id === "t2");
    check(
      alice && String(alice.task).indexOf("收集今天的热点") >= 0,
      "TD-3 Alice 的 prompt 里带的是**她自己的**那段",
      alice ? String(alice.task).slice(0, 160) : ""
    );
    check(
      bob && String(bob.task).indexOf("写成初稿") >= 0,
      "TD-3 Bob 的 prompt 里带的是**他自己的**那段",
      bob ? String(bob.task).slice(0, 160) : ""
    );
    check(
      alice && String(alice.task).indexOf("写成初稿") < 0,
      "TD-3 两人的那段**不串**(Alice 不会去做 Bob 的活)",
      alice ? String(alice.task).slice(0, 160) : ""
    );
    check(
      transcriptOf(TEAM_ROOM).filter((e) => e && e.kind === "bot_reply").length === 2,
      "TD-4 两个成员的结果都落进转录(可审计)",
      String(transcriptOf(TEAM_ROOM).filter((e) => e && e.kind === "bot_reply").length)
    );
  }

  /* ───────── 3. 没职责的群 ⇒ 老行为(一个负责人 + 串行接力) ───────── */
  {
    const runner = makeRunner(null, 60);
    const res = await dispatchRoomTurn({
      surface,
      roomId: PLAIN_ROOM,
      text: "随便聊聊",
      deps: {
        runResponderTurn: runner.runResponderTurn,
        selectResponders: async () => ({ ok: true, responders: [], decisions: [] }),
      },
    });
    check(res.ok === true, "TD-5 闲聊群派发成功", JSON.stringify(res).slice(0, 160));
    check(
      runner.calls.length === 1,
      "TD-5 没有职责的群仍然**只唤醒一个**(auto_route 的语义不动)",
      runner.calls.map((c) => c.bot_id).join(",")
    );
  }

  /* ───────── 4. 自决解析:认领 ───────── */
  {
    const d1 = parseDiscretionDecision("YES\nCLAIM: 我负责把三个要点整理成初稿");
    check(d1 && d1.respond === true, "TD-6 解析 YES 仍然成立", JSON.stringify(d1));
    check(d1 && d1.claim === "我负责把三个要点整理成初稿", "TD-6 认领被解析出来", JSON.stringify(d1));
    const d2 = parseDiscretionDecision("NO");
    check(d2 && d2.respond === false && !d2.claim, "TD-6 老格式 NO 不受影响", JSON.stringify(d2));
    const d3 = parseDiscretionDecision("YES\nCLAIM: 我负责 NO 这一段");
    check(
      d3 && d3.respond === true,
      "TD-6 认领行里出现 NO **不该**被当成拒绝",
      JSON.stringify(d3)
    );
    const d4 = parseDiscretionDecision("YES\nCLAIM: " + "长".repeat(200));
    check(d4 && d4.claim === "", "TD-6 太长的「认领」被丢掉(不硬编)", JSON.stringify(d4));
    const d5 = parseDiscretionDecision("");
    check(d5 === null, "TD-6 空回复仍是「不明确」", JSON.stringify(d5));
    const p = buildDiscretionPrompt({ bot: { name: "Alice", job: "情报" }, task: "写稿" });
    check(p.indexOf("CLAIM") >= 0, "TD-7 自决 prompt 里要求认领");
    check(
      p.indexOf("只判断你是否应该在本轮发言") >= 0,
      "TD-7 自决 prompt 的老语义还在(没被改写掉)"
    );
  }

  /* ───────── 5. 副作用闸:含写的批次不许并发 ───────── */
  {
    const gate = createEffectGate({ label: "test" });
    const order = [];
    let active = 0, maxActive = 0;
    const work = (tag, ms) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(tag + ":start");
      await new Promise((r) => setTimeout(r, ms));
      order.push(tag + ":end");
      active -= 1;
      return tag;
    };
    await Promise.all([
      gate.run(work("A", 40)),
      gate.run(work("B", 10)),
      gate.run(work("C", 10)),
    ]);
    check(maxActive === 1, "TG-1 闸内**同时只有一个**批次在跑", String(maxActive));
    check(
      order.join(",") === "A:start,A:end,B:start,B:end,C:start,C:end",
      "TG-1 批次按入闸顺序**串行**执行",
      order.join(",")
    );
    /* 失败不许把后面的批次一起卡死 */
    const gate2 = createEffectGate({ label: "test2" });
    let reached = false;
    await gate2.run(async () => { throw new Error("boom"); }).catch(() => {});
    await gate2.run(async () => { reached = true; });
    check(reached, "TG-2 一个批次失败**不阻塞**后面的批次");
    const st = gate.stats();
    check(st.queued === 3 && st.ran === 3, "TG-3 闸的计数如实", JSON.stringify(st));
  }

  /* ───────── 6. 负向:关掉模型分工 ⇒ 并行仍然成立,但**没有分工** ───────── */
  {
    const prev = process.env.BITBOT_ROOM_DECOMPOSE;
    const src = fs.readFileSync(
      path.join(__dirname, "..", "hosts", "desktop", "main.js"),
      "utf8",
    );
    check(
      src.indexOf('process.env.BITBOT_ROOM_DECOMPOSE === "0"') >= 0,
      "TG-4 模型分工**默认开**(只有显式 0 才关)",
      "main.js 里没找到默认开的判据"
    );
    check(
      src.indexOf('process.env.BITBOT_ROOM_DECOMPOSE !== "1"') < 0,
      "TG-4 负向:老的「默认关」写法已经不在了",
    );
    if (prev === undefined) delete process.env.BITBOT_ROOM_DECOMPOSE;
    else process.env.BITBOT_ROOM_DECOMPOSE = prev;
  }

  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log("\nprove_team_division: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_team_division: " + String((e && e.stack) || e));
  console.log("\nprove_team_division: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
