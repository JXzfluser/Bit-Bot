#!/usr/bin/env node
"use strict";

/**
 * prove_room_progress_wiring — 群进度死线到底接活没有（KP-01，静态层）
 *
 * 修之前的实际状态：main.js 的 roomRuntime.onProgress 一直在广播
 * `bitbot:room-turn-progress`，但 preload 里**没有对应通道**、渲染侧**没有 handler** ——
 * 一条死线。群里 @ 一个 Bot 干活，名字旁边永远只有静态「工作中…」，整段沉默到回复落地。
 *
 * 这条静态门把「线接上了」钉成纯函数判据（源文本进、布尔出），负向对照复用同一段：
 *   W1 preload 暴露 onRoomTurnProgress，且真绑到 "bitbot:room-turn-progress"（含解绑）
 *   W2 渲染侧 applyRoomProgress 用**共享协议**（window.__bitbotProgress.createProgressState）
 *      + 同一张标签表（progressLabel），把当前步写进 .rw-text —— 不是第二份协议副本
 *   W3 渲染侧真订阅 rooms.onRoomTurnProgress → applyRoomProgress
 *   W4 renderRoomWorking 给文本 span 打了 .rw-text 标记并存了 bot 名字（进度帧有落点）
 *   W5 Host 侧广播源行还在（roomRuntime.onProgress → broadcast）
 *   N1..N4 负向对照：抹掉 preload 通道 / 抹掉订阅 / 抹掉 Host 广播 / 把标签写死 ——
 *      对应断言必须翻假，否则它量的是漂亮字符串不是真接线。
 *
 * 真渲染层（帧真的推到渲染进程、名字旁真的出现当前步）由 e2e_desktop_room_progress.mjs
 * 钉，注入对照（摘掉 W5 那行 → e2e 收不到帧）由 G-115 驱动。静态 + 真渲染各管一段。
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

/* ---- 每条判据都是纯函数，负向对照才能复用同一段 ---- */

/** W1: preload 把这条通道接到渲染层（订阅 + 解绑都要有） */
function preloadChannel(src) {
  const bind = /onRoomTurnProgress:[\s\S]{0,260}?ipcRenderer\.on\(\s*"bitbot:room-turn-progress"/.test(src);
  const unbind = /removeListener\(\s*"bitbot:room-turn-progress"/.test(src);
  return { bind, unbind, all: bind && unbind };
}

/** W2: 渲染侧 handler 用共享协议 + 同一张标签表，把当前步写进 .rw-text */
function rendererHandler(src) {
  const m = src.match(/function applyRoomProgress\(ev\)\s*\{[\s\S]*?\n    \}/);
  if (!m) return { found: false, all: false };
  const body = m[0];
  const usesShared = /window\.__bitbotProgress/.test(body);
  const reducer = /createProgressState\(\)/.test(body) && /store\.apply\(ev\)/.test(body);
  const label = /progressLabel\(st\)/.test(body);
  const lands = /querySelector\("\.rw-text"\)/.test(body) && /txt\.textContent\s*=/.test(body);
  return { found: true, usesShared, reducer, label, lands, all: usesShared && reducer && label && lands };
}

/** W3: 渲染侧真订阅了这条通道 */
function rendererSubscribe(src) {
  const sub = /onRoomTurnProgress\(\(ev\)\s*=>\s*applyRoomProgress\(ev\)\)/.test(src);
  return { sub, all: sub };
}

/** W4: working 卡给进度帧留了落点（.rw-text 标记 + bot 名字） */
function workingRowLanding(src) {
  const tag = /txt\.className\s*=\s*"rw-text"/.test(src);
  const name = /el\.dataset\.roomBotName\s*=/.test(src);
  return { tag, name, all: tag && name };
}

/** W5: Host 侧广播源行还在 */
function hostBroadcast(src) {
  const line = /onProgress:\s*\(row\)\s*=>\s*broadcast\(\s*"bitbot:room-turn-progress",\s*row\s*\)/.test(src);
  return { line, all: line };
}

/* ---- 正向：现在必须全真 ---- */
{
  const r = preloadChannel(PRELOAD);
  r.all ? ok("W1 preload 暴露 onRoomTurnProgress，真绑 bitbot:room-turn-progress（含解绑）")
    : bad("W1 preload 没把群进度通道接到渲染层", JSON.stringify(r));
}
{
  const r = rendererHandler(INDEX);
  r.all ? ok("W2 applyRoomProgress 用共享协议 createProgressState + 同一张 progressLabel，把当前步写进 .rw-text（不是第二份副本）")
    : bad("W2 渲染侧 handler 没接共享协议或没落到 .rw-text", JSON.stringify(r));
}
{
  const r = rendererSubscribe(INDEX);
  r.all ? ok("W3 渲染侧订阅 rooms.onRoomTurnProgress → applyRoomProgress")
    : bad("W3 渲染侧没订阅群进度通道", JSON.stringify(r));
}
{
  const r = workingRowLanding(INDEX);
  r.all ? ok("W4 renderRoomWorking 给文本 span 打 .rw-text 标记并存 bot 名字（进度帧有落点）")
    : bad("W4 working 卡没给进度帧留落点", JSON.stringify(r));
}
{
  const r = hostBroadcast(MAIN);
  r.all ? ok("W5 Host 侧 roomRuntime.onProgress → broadcast(bitbot:room-turn-progress) 源行还在")
    : bad("W5 Host 侧广播源行不在", JSON.stringify(r));
}

/* ---- 负向对照：抹掉实现，断言必须翻假 ---- */
{
  // ① 把 preload 绑的通道改成别的 —— W1 必须翻假（死通道复现）
  const broken = PRELOAD.replace(/"bitbot:room-turn-progress"/g, '"bitbot:room-orchestrating"');
  preloadChannel(broken).all === false
    ? ok("N1 负向对照：preload 改绑别的通道 → W1 翻假（不是恒真）")
    : bad("N1 负向对照恒真：通道被抹掉仍判真");
}
{
  // ② 抹掉渲染侧订阅 —— W3 必须翻假（线接了但没人订阅）
  const broken = INDEX.replace("window.bitbot.rooms.onRoomTurnProgress((ev) => applyRoomProgress(ev));", "");
  rendererSubscribe(broken).all === false
    ? ok("N2 负向对照：删掉渲染侧订阅 → W3 翻假")
    : bad("N2 负向对照恒真：订阅被抹掉仍判真");
}
{
  // ③ 摘掉 Host 广播源行 —— W5 必须翻假（这正是 e2e 注入对照摘的那一行）
  const broken = MAIN.replace('  onProgress: (row) => broadcast("bitbot:room-turn-progress", row),\n', "");
  hostBroadcast(broken).all === false
    ? ok("N3 负向对照：摘掉 Host 广播行 → W5 翻假（与 e2e 注入对照同一行）")
    : bad("N3 负向对照恒真：广播行被摘掉仍判真");
}
{
  // ④ 把 handler 里的标签写死成「工作中」（不用共享标签表）—— W2 必须翻假。
  //    只在 applyRoomProgress 函数体内替换，单回合那份 progressLabel 不动，
  //    证明 W2 量的是这个 handler 真用了协议标签，而不是别处碰巧有这个词。
  const broken = INDEX.replace(
    /(function applyRoomProgress\(ev\)\s*\{[\s\S]*?)progressLabel\(st\)/,
    '$1"工作中"',
  );
  rendererHandler(broken).all === false
    ? ok("N4 负向对照：handler 标签写死「工作中」→ W2 翻假（复现修之前的静态卡）")
    : bad("N4 负向对照恒真：标签写死仍判真");
}

console.log("\nprove_room_progress_wiring: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);