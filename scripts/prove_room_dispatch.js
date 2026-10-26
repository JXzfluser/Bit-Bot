#!/usr/bin/env node
"use strict";

/**
 * prove_room_dispatch — 群消息**真的有人回**(Q-6),以及幂等认「投递」不认「文字」(Q-5)。
 *
 * Q-6: 「CLI / 移动端发的群消息没人回,而且不报错」。
 *   扇出这一步原先只在 hosts/desktop/main.js 的 Electron IPC handler 里;
 *   所有非桌面路径走到 host_ffi.js 的 `room_turn` effect 分支时,只做了
 *   路由 + 落转录 —— **没有 orchestrateRoom**。消息落盘,没人回,也没报错。
 *   现在两边都走 hosts/shared/room_dispatch.js 的 dispatchRoomTurn。
 *
 * Q-5: 幂等键原来是 `room.id + "|" + task.toLowerCase()` —— 认的是「文字」。
 *   于是用户把同一句话再发一遍,被当成同一次投递直接去重,第二次根本不跑。
 *   正确的语义:幂等保护的是**同一次投递被重复处理**,不是「同样的字」。
 *   幂等键改成 `room.id + "|" + 投递 id`。
 *
 * 这个门禁用**真的** product_surface(临时 repo root),只有模型回合是假的。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");
const { dispatchRoomTurn } = require("../hosts/shared/room_dispatch");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => {
  fail++;
  console.log("  ✗ " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 300)));
};
const check = (c, m, d) => (c ? ok(m) : bad(m, d));

/* ---------- 夹具:临时 repo root ---------- */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "room-dispatch-"));
const DATA = path.join(ROOT, "data", "desktop");
fs.mkdirSync(DATA, { recursive: true });
const BOTS = [
  { id: "b1", name: "Alice", job: "research", description: "collect facts", hidden: false, pinned: false },
  { id: "b2", name: "Bob", job: "writing", description: "draft prose", hidden: false, pinned: false },
];
fs.writeFileSync(
  path.join(DATA, "bots.json"),
  JSON.stringify({ version: 1, primary_id: "b1", bots: BOTS }, null, 2),
);
const ROOM_ID = "room-dispatch-1";
const ROOM2_ID = "room-dispatch-2";
fs.writeFileSync(
  path.join(DATA, "rooms.json"),
  JSON.stringify({
    version: 1,
    rooms: [
      { id: ROOM_ID, title: "Dispatch Room", members: ["b1", "b2"], transcript: [] },
      { id: ROOM2_ID, title: "Second Room", members: ["b1"], transcript: [] },
    ],
  }, null, 2),
);

const surface = createProductSurface(ROOT);
const readRooms = () => JSON.parse(fs.readFileSync(path.join(DATA, "rooms.json"), "utf8"));
const transcriptOf = (roomId) => {
  const room = (readRooms().rooms || []).find((r) => r && r.id === roomId);
  return (room && room.transcript) || [];
};

/** 记录每次成员回合的假 runner。 */
function makeRunner(handler) {
  const calls = [];
  const runResponderTurn = async (botId, task, ctx) => {
    calls.push({ bot_id: botId, task: String(task || ""), ctx: ctx || {} });
    if (typeof handler === "function") return handler(botId, task, ctx, calls);
    return { ok: true, text: botId + " 的原话回答", artifacts: [] };
  };
  return { calls, runResponderTurn };
}

console.log("prove_room_dispatch — 群消息真的有人回(Q-6)+ 幂等认投递(Q-5)");

(async function main() {
  /* ───────── 1. Q-6:一条群消息真的被扇出,而且回话落进转录 ───────── */
  {
    const runner = makeRunner(async (botId) => ({ ok: true, text: botId + " 说:收到" }));
    const res = await dispatchRoomTurn({
      surface,
      roomId: ROOM_ID,
      text: "@Alice @Bob 一起看看这个",
      deps: { runResponderTurn: runner.runResponderTurn },
    });
    check(res.ok === true, "Q-6 群消息派发成功", JSON.stringify(res).slice(0, 200));
    check(runner.calls.length === 2, "Q-6 两个被点名的成员都真的跑了回合", runner.calls.length);
    check(res.total === 2 && res.returned === 2, "Q-6 汇总如实是 2/2", res.returned + "/" + res.total);
    check(
      transcriptOf(ROOM_ID).filter((e) => e && e.kind === "bot_reply").length === 2,
      "Q-6 两份回话都落进群转录",
    );
    check(
      transcriptOf(ROOM_ID).some((e) => e && e.kind === "final_report"),
      "Q-6 群转录里有 final_report",
    );
  }

  /* ───────── 2. Q-6 负例:群不存在 ⇒ 如实报错,且什么都没发生 ───────── */
  {
    const runner = makeRunner();
    const before = transcriptOf(ROOM_ID).length;
    const res = await dispatchRoomTurn({
      surface,
      roomId: "no-such-room",
      text: "有人吗",
      deps: { runResponderTurn: runner.runResponderTurn },
    });
    check(res.ok === false, "Q-6 群不存在 → 如实失败(不是假成功)");
    check(String(res.error || "").length > 0, "Q-6 失败原因可见", res.error);
    check(runner.calls.length === 0, "Q-6 群不存在时没有任何成员被叫起来");
    check(transcriptOf(ROOM_ID).length === before, "Q-6 群不存在时转录没有多出任何一行");
  }

  /* ───────── 3. Q-5:同样的字再发一遍 ⇒ 是两个任务,不是一次 ───────── */
  {
    const runner = makeRunner();
    const a = await dispatchRoomTurn({
      surface,
      roomId: ROOM2_ID,
      text: "@Alice 再跑一次这个",
      deps: { runResponderTurn: runner.runResponderTurn },
    });
    const b = await dispatchRoomTurn({
      surface,
      roomId: ROOM2_ID,
      text: "@Alice 再跑一次这个",
      deps: { runResponderTurn: runner.runResponderTurn },
    });
    check(a.ok === true && b.ok === true, "Q-5 两次都派发成功");
    check(
      runner.calls.length === 2,
      "Q-5 用户把同一句话再发一遍 ⇒ 第二次真的又跑了(不再是「未重复执行」)",
      runner.calls.length,
    );
    check(b.deduped !== true, "Q-5 第二次没有被当成重复投递去重");
  }

  /* ───────── 4. Q-5 幂等:同一个投递 id 重试 ⇒ 不重复执行 ───────── */
  {
    const runner = makeRunner();
    const mid = "dingtalk-msg-0001";
    const a = await dispatchRoomTurn({
      surface,
      roomId: ROOM2_ID,
      text: "@Alice 这条只该跑一次",
      messageId: mid,
      deps: { runResponderTurn: runner.runResponderTurn },
    });
    const b = await dispatchRoomTurn({
      surface,
      roomId: ROOM2_ID,
      text: "@Alice 这条只该跑一次",
      messageId: mid,
      deps: { runResponderTurn: runner.runResponderTurn },
    });
    check(a.ok === true, "Q-5 第一次投递成功");
    check(b.ok === true, "Q-5 重试也算成功(幂等命中不是错误)");
    check(b.deduped === true, "Q-5 同一个投递 id 重试 ⇒ 幂等命中", JSON.stringify(b).slice(0, 160));
    check(
      runner.calls.length === 1,
      "Q-5 同一个投递 id 重试 ⇒ 成员只被叫了一次",
      runner.calls.length,
    );
  }

  /* ───────── 5. 诚实聚合:一个成员失败 ⇒ 1/2 且 partial,不是「成功」 ───────── */
  {
    const runner = makeRunner(async (botId) =>
      botId === "b2"
        ? { ok: false, error: "provider down" }
        : { ok: true, text: botId + " 答了" },
    );
    const res = await dispatchRoomTurn({
      surface,
      roomId: ROOM_ID,
      text: "@Alice @Bob 这次会有人挂",
      deps: { runResponderTurn: runner.runResponderTurn },
    });
    check(res.ok === true, "Q-5 派发本身成功(有一个成员回了)");
    check(res.total === 2, "Q-5 总数如实是 2", res.total);
    check(res.returned === 1, "Q-5 成功数如实是 1", res.returned);
    check(res.partial === true, "Q-5 部分失败如实标 partial");
    check(
      transcriptOf(ROOM_ID).some((e) => e && e.kind === "bot_reply_error"),
      "Q-5 失败成员的失败行落进转录(不假装都答了)",
    );
  }

  /* ───────── 6. 成员自决(没有 @):每个成员真的跑一轮自决 ───────── */
  {
    const decisions = [];
    const runner = makeRunner();
    const res = await dispatchRoomTurn({
      surface,
      roomId: ROOM2_ID,
      text: "这个要不要一起看",
      deps: {
        runResponderTurn: runner.runResponderTurn,
        selectResponders: async ({ room, task, candidates }) => {
          decisions.push({ room, task, candidates: (candidates || []).map((c) => c.id) });
          return { ok: true, responders: ["b1"], decisions: [{ bot_id: "b1", name: "Alice", respond: true }] };
        },
      },
    });
    check(res.ok === true, "Q-5 自决路径派发成功", JSON.stringify(res).slice(0, 200));
    check(decisions.length === 1, "Q-5 自决真的跑了一轮(不是默认全员)", decisions.length);
    check(
      decisions[0] && decisions[0].candidates.length === 1,
      "Q-5 自决拿到的是候选成员",
      JSON.stringify(decisions[0] || {}),
    );
  }

  /* ───────── 7. 接线:桌面和别的端走的是同一个函数 ───────── */
  {
    const ffiSrc = fs.readFileSync(
      path.join(__dirname, "..", "hosts", "shared", "host_ffi.js"),
      "utf8",
    );
    const mainSrc = fs.readFileSync(
      path.join(__dirname, "..", "hosts", "desktop", "main.js"),
      "utf8",
    );
    check(
      /if \(kind === "room_turn" && surface\)[\s\S]{0,900}dispatchRoomTurn\(/.test(ffiSrc),
      "host_ffi 的 room_turn effect 分支真的调 dispatchRoomTurn(Q-6 的正身)",
    );
    check(
      /ipcMain\.handle\("bitbot:rooms:orchestrate"[\s\S]{0,900}dispatchRoomTurn\(/.test(mainSrc),
      "桌面 IPC 也调 dispatchRoomTurn(一条路径,不会一个端回一个端不回)",
    );
    check(
      !/async function runRoomResponderTurn\(/.test(mainSrc),
      "桌面不再自带一份 responder 实现(不会跟共享实现分叉)",
    );
    const runtimeSrc = fs.readFileSync(
      path.join(__dirname, "..", "hosts", "shared", "room_runtime.js"),
      "utf8",
    );
    check(
      /async function runResponderTurn[\s\S]{0,1200}?await runTurn\(/.test(runtimeSrc),
      "共享 room runtime 真的用注入的 runner 跑成员回合",
    );
    const surfSrc = fs.readFileSync(
      path.join(__dirname, "..", "hosts", "desktop", "product_surface.js"),
      "utf8",
    );
    check(
      /const sigKey = String\(opts\.message_id/.test(surfSrc),
      "幂等键认投递 id(product_surface)",
    );
  }

  console.log("prove_room_dispatch pass=" + pass + " fail=" + fail);
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log("prove_room_dispatch crashed — " + String((e && e.stack) || e));
  console.log("prove_room_dispatch pass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
