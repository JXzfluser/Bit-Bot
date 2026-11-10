#!/usr/bin/env node
"use strict";

/**
 * prove_turn_cancel_receipt — KP-02：停止要给回执，群回合必须真能取消。
 *
 * 对标缺口（docs/grok-desktop-parity/kernel-mechanism-parity.md §4 KP-02）：
 *   Grok 的 InterruptGrokBotAgentRun 回 had_active_run；我们的 bitbot:turn:cancel
 *   原来无条件 return {ok:true}，群聊处理器全程不碰取消句柄 —— 按了「停止」，
 *   界面不知道停没停，群里那条 Bot 还在烧 token。
 *
 * 这份门走**产品路径**（dispatchRoomTurn → orchestrateRoom → roomCancelScope），
 * 只把「跑一个模型回合」换成一个挂起、直到取消信号到来才收尾的假 runner：
 *
 *   C1 无在跑回合：cancelActiveRoomTurns 回 0（had_active_turn 应为 false）。
 *   C2 有在跑回合：群回合开跑后 cancelActiveRoomTurns 回 ≥1，假 runner 的
 *      ctx.cancelPromise 真被 resolve（取消信号传到了执行层，不是只 reject 外层）。
 *   C3 取消后转录落下 cancelled 那一行（bot_reply_error，error/text 含 cancelled）。
 *   C4 回合收尾后 scope 自摘：再 cancel 一次回 0（不是一直算「在跑」）。
 *   C5 Host 契约：main.js 的 had_active_turn 是算出来的，不是写死 true。
 *
 * 负向对照（必须能红）：--inject-fake-receipt 把 cancelActiveRoomTurns 换成
 *   恒回 0 的假回执，C2/C3 立刻翻红 —— 证明这条门量的是真取消，不是漂亮字符串。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");
const { dispatchRoomTurn } = require("../hosts/shared/room_dispatch");

const INJECT = process.argv.includes("--inject-fake-receipt");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const BOTS = {
  version: 1, primary_id: "b1",
  bots: [{ id: "b1", name: "脚本撰写", job: "脚本", description: "把选题写成短视频口播脚本，控制节奏与时长", hidden: false }],
};
const ROOMS = {
  version: 1,
  rooms: [{ id: "room-cancel", title: "取消取证群", members: ["b1"], created_at: "t", transcript: [] }],
};

function mkSurface() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cancel-receipt-"));
  const dir = path.join(root, "data", "desktop");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bots.json"), JSON.stringify(BOTS));
  fs.writeFileSync(path.join(dir, "rooms.json"), JSON.stringify(ROOMS));
  const surface = createProductSurface(root);
  if (INJECT) {
    // 假回执：永远说「没取消到东西」。真门必须因此翻红。
    surface.cancelActiveRoomTurns = () => 0;
  }
  return { surface, root };
}
const txOf = (surface) =>
  (surface.loadRooms().rooms.find((r) => r.id === "room-cancel") || {}).transcript || [];
const tick = () => new Promise((r) => setTimeout(r, 20));
async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) { if (fn()) return true; await tick(); }
  return false;
}

(async () => {
  console.log("prove_turn_cancel_receipt — KP-02 停止回执 + 群回合真取消" + (INJECT ? "（注入对照：假回执）" : ""));

  /* C1 无在跑回合 → 0 */
  {
    const { surface } = mkSurface();
    const n = surface.cancelActiveRoomTurns("user_stop");
    n === 0 ? ok("C1 没有在跑的群回合时，取消回执是 0（had_active_turn=false）")
      : bad("C1 idle cancel should be 0", String(n));
  }

  /* C2/C3/C4 有在跑回合 → 真取消 + 转录 cancelled + 收尾自摘 */
  {
    const { surface } = mkSurface();
    let started = false;
    let sawCancel = false;
    let cancelResolve = null;
    const runnerBlocked = new Promise((r) => { cancelResolve = r; });
    // 安全阀：注入对照里假回执不会真取消，runner 不能把门挂死。1.5s 后自行收尾，
    // 并如实报「没被取消」—— 这样注入态下 C2/C3 翻红而不是超时。
    const safety = setTimeout(() => cancelResolve(), 1500);
    const runResponderTurn = (botId, prompt, ctx) => {
      started = true;
      // 执行层真的收到了取消通道：cancelPromise 到来才收尾。
      if (ctx && ctx.cancelPromise && typeof ctx.cancelPromise.then === "function") {
        ctx.cancelPromise.then(() => { sawCancel = true; clearTimeout(safety); cancelResolve(); });
      }
      return runnerBlocked.then(() => ({
        ok: false, error: sawCancel ? "cancelled" : "still_running_no_cancel", text: "",
      }));
    };
    const dispatch = dispatchRoomTurn({
      surface, roomId: "room-cancel",
      text: "写一条关于绿色低碳的短视频脚本，3分钟以内",
      deps: { runResponderTurn },
    });
    const reached = await waitFor(() => started);
    if (!reached) {
      bad("C2 群回合没能开跑（假 runner 未被调用）", "started=false");
    } else {
      const n = surface.cancelActiveRoomTurns("user_stop");
      n >= 1 ? ok("C2 有在跑回合时，取消回执 ≥1（had_active_turn=true，真停下了 " + n + " 条）")
        : bad("C2 active cancel should be >=1", String(n));
      await dispatch;
      sawCancel ? ok("C2 取消信号传到了执行层（runner 的 ctx.cancelPromise 真被 resolve）")
        : bad("C2 cancel signal never reached the runner", "sawCancel=false");
      const row = txOf(surface).find((e) => e && (e.kind === "bot_reply_error" || e.kind === "bot_reply") &&
        (/cancelled/i.test(String(e.error || "")) || /cancelled/i.test(String(e.text || ""))));
      row ? ok("C3 取消后转录落下 cancelled 那一行（kind=" + row.kind + "）")
        : bad("C3 no cancelled transcript row", JSON.stringify(txOf(surface).map((e) => e && e.kind)));
      const after = surface.cancelActiveRoomTurns("user_stop");
      after === 0 ? ok("C4 回合收尾后 scope 自摘：再按停止回 0（不是一直算在跑）")
        : bad("C4 scope should be forgotten after settle", String(after));
    }
  }

  /* C5 Host 契约：had_active_turn 是算出来的 */
  {
    const main = fs.readFileSync(path.join(__dirname, "..", "hosts/desktop/main.js"), "utf8");
    const handler = main.slice(main.indexOf('ipcMain.handle("bitbot:turn:cancel"'));
    const block = handler.slice(0, handler.indexOf("});") + 3);
    const computed = /had_active_turn\s*:/.test(block) &&
      /releaseActiveTurnCancel/.test(block) && /cancelActiveRoomTurns/.test(block);
    const hardcoded = /had_active_turn\s*:\s*true\b/.test(block);
    computed && !hardcoded
      ? ok("C5 Host 的 had_active_turn 由单会话句柄 + 群取消计数算出，不是写死 true")
      : bad("C5 cancel receipt must be computed", JSON.stringify({ computed, hardcoded }));
  }

  console.log("prove_turn_cancel_receipt: PASS=" + pass + " FAIL=" + fail + (INJECT ? "（注入对照）" : ""));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("prove_turn_cancel_receipt: 异常 " + (e && e.stack || e)); process.exit(1); });