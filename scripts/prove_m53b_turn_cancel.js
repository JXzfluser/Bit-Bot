#!/usr/bin/env node
"use strict";

/**
 * prove_m53b_turn_cancel — 「停止」这个动作到底存不存在（KP-02）
 *
 * 之前的实际状态是**假实现**，而且三条链上各断一处：
 *   1. `#turn-cancel` 在 DOM 里从一开始就有，但**没有任何人取消隐藏**
 *      → 用户根本没有停止可点（CSS 里连「顶掉麦克风」的位置都写好了，白写）；
 *   2. main 的取消回执调用 `surface.cancelActiveRoomTurns`，而引擎里那时连这个
 *      函数都还没有（更谈不上导出）→ undefined，群回合永远停不下来；
 *   3. 回执里的 `had_active_turn` 因此恒为 false → 明明有一条在跑，
 *      界面还会说「没有在执行的回合」。这是比「假装成功」更糟的一种谎。
 *   （第一次写这条门禁时就踩在这里：以为「没导出」，实际是「函数还不存在」。
 *    所以 T3 现在钉的是「导出唯一且真的在 return 里」，重复导出也算错。）
 *
 * 这一轮把三条接起来，并把判据钉在这里：
 *   T1 preload 两个口都在：`cancelTurn`（真发 IPC）与 `onTurnBusy`（订阅忙闲）
 *   T2 main 用**计数**而不是布尔，+1/−1 在两条入口（私聊回合、群回合）都配对，
 *      且只 0↔N 跃变时广播（否则每次并发都会闪一下按钮）
 *   T3 `cancelActiveRoomTurns` 确实被导出（不导出 = 死引用）
 *   T4 `had_active_turn` 由真信号算出来，不是字面量
 *   T5 渲染层：忙时显、闲时藏，且显隐来自 Host 信号而不是猜
 *   T6 负向对照三条：抹掉导出 / 把显隐写死 / 把回执写死 true —— 对应断言必须翻假
 */

const fs = require("fs");
const path = require("path");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const MAIN = read("hosts/desktop/main.js");
const PRELOAD = read("hosts/desktop/preload.js");
const INDEX = read("hosts/desktop/index.html");
const SURFACE = read("hosts/desktop/product_surface.js");

/* ---- 每条判据都写成纯函数（源文本进，布尔出），负向对照才能复用同一段 ---------- */

/** T1: preload 有没有两个口 */
function preloadWired(src) {
  const cancel = /cancelTurn:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*"bitbot:turn:cancel"\s*\)/.test(src);
  const busy = /onTurnBusy:[\s\S]{0,200}?ipcRenderer\.on\(\s*"bitbot:turn-busy"/.test(src);
  return { cancel, busy, all: cancel && busy };
}

/** T2: +1/−1 的配对与跃变广播 */
function busyCounter(src) {
  const plus = (src.match(/setTurnActivity\(1\)/g) || []).length;
  const minus = (src.match(/setTurnActivity\(-1\)/g) || []).length;
  // 只在 0↔N 跃变时广播：两边的布尔值不同才发
  const edge = /const before = activeTurnCount > 0;[\s\S]{0,400}?if \(before !== after\)\s*broadcast\(\s*"bitbot:turn-busy"/.test(src);
  // 中途抛错时不能只 −1（会把别人的按钮一起收掉）：必须有 busyMarked 守卫
  const guarded = /if \(busyMarked\) setTurnActivity\(-1\)/.test(src);
  return { plus, minus, edge, guarded, all: plus >= 2 && minus >= 2 && edge && guarded };
}

/** T3: 引擎把取消句柄导出到返回值**且只导出一次**（重复键会让「改哪个」变得可疑） */
function surfaceExports(src) {
  const hits = (src.match(/^\s{4}cancelActiveRoomTurns,\s*$/gm) || []).length;
  return { hits, all: hits === 1 };
}

/** T4: 回执按真信号算 */
function cancelReceipt(src) {
  const real = /had_active_turn:\s*hadSingle\s*\|\|\s*roomCancelled\s*>\s*0/.test(src);
  const literal = /had_active_turn:\s*(true|false)\b/.test(src);
  const single = /const hadSingle = typeof releaseActiveTurnCancel === "function"/.test(src);
  const room = /roomCancelled = surface\.cancelActiveRoomTurns\(/.test(src);
  return { real, literal, single, room, all: real && !literal && single && room };
}

/** T5: 渲染层的显隐由 Host 信号驱动 */
function rendererToggle(src) {
  const defaultHidden = /id="turn-cancel"[^>]*\bhidden\b/.test(src);
  const assign = /turnCancelBtn\.hidden\s*=\s*!busy/.test(src);
  const subscribe = /onTurnBusy\(function|onTurnBusy\(\(/.test(src);
  // 显隐不能从流式片段推：群里不走 llm-stream，靠它判断在群里永远是「没有回合」
  return { defaultHidden, assign, subscribe, all: defaultHidden && assign && subscribe };
}

/* ---- 正向：现在必须全真 --------------------------------------------------------- */

{
  const r = preloadWired(PRELOAD);
  r.all ? ok("T1 preload 两个口都在：cancelTurn 真发 IPC、onTurnBusy 订阅 turn-busy")
    : bad("T1 preload 没把取消/忙闲接到渲染层", JSON.stringify(r));
}
{
  const r = busyCounter(MAIN);
  r.all ? ok("T2 计数配对：+1×" + r.plus + " / −1×" + r.minus + "，只在 0↔N 跃变广播，−1 有 busyMarked 守卫")
    : bad("T2 忙闲计数没配对或漏了守卫", JSON.stringify(r));
}
{
  const r = surfaceExports(SURFACE);
  r.all
    ? ok("T3 cancelActiveRoomTurns 挂在 surface 返回值上且只有一处（不导出 = main 里的调用是死引用）")
    : bad("T3 surface 没有导出 cancelActiveRoomTurns，或导出了 " + r.hits + " 次", JSON.stringify(r));
}
{
  const r = cancelReceipt(MAIN);
  r.all ? ok("T4 had_active_turn 由 releaseActiveTurnCancel + roomCancelled 算出，不是字面量")
    : bad("T4 取消回执还在写死或接不上", JSON.stringify(r));
}
{
  const r = rendererToggle(INDEX);
  r.all ? ok("T5 停止按钮默认藏、忙时显，显隐来自 onTurnBusy（不从流式片段猜）")
    : bad("T5 渲染层没把按钮显出来", JSON.stringify(r));
}

/* ---- 负向对照：抹掉实现，断言必须翻假 ------------------------------------------ */

{
  // ① 把导出那一行改成注释 —— T3 必须翻假
  const broken = SURFACE.replace(/^(\s{4})cancelActiveRoomTurns,\s*$/m, "$1// cancelActiveRoomTurns,");
  surfaceExports(broken).all === false
    ? ok("T6a 负向对照：注释掉导出 → T3 翻假（不是恒真）")
    : bad("T6a 负向对照恒真：导出被抹掉仍判真");
}
{
  // ② 把「按 busy 赋值」写成常量 false —— T5 必须翻假（正是修之前的状态）
  const broken = INDEX.replace("turnCancelBtn.hidden = !busy", "turnCancelBtn.hidden = false");
  rendererToggle(broken).all === false
    ? ok("T6b 负向对照：显隐写死 false → T5 翻假（复现修之前「按钮永远藏着」）")
    : bad("T6b 负向对照恒真：显隐写死仍判真");
}
{
  // ③ 把回执写死 true —— T4 必须翻假（「明明没停到也说停到了」）
  const broken = MAIN.replace(
    "had_active_turn: hadSingle || roomCancelled > 0",
    "had_active_turn: true",
  );
  cancelReceipt(broken).all === false
    ? ok("T6c 负向对照：回执写死 true → T4 翻假")
    : bad("T6c 负向对照恒真：回执写死仍判真");
}
{
  // ④ 少一个 −1（只 +1 不配对）—— T2 必须翻假，否则「按钮会永远亮着」这种回归不会被发现
  const broken = MAIN.replace("if (busyMarked) setTurnActivity(-1);", "");
  busyCounter(broken).all === false
    ? ok("T6d 负向对照：删掉 finally 里的 −1 → T2 翻假（按钮会永远亮着）")
    : bad("T6d 负向对照恒真：计数不配对仍判真");
}

console.log("\nprove_m53b_turn_cancel: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
