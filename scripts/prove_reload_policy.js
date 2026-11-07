#!/usr/bin/env node
/* prove_reload_policy — ⌘R 该重载界面还是重启进程（G-112）
 *
 * 现场：改完群编排，用户按 ⌘R，界面文案变了（新的），行为还是旧的（全员开路 + 群综合），
 * 于是问「为什么还是这样」。界面 HTML 是启动那一刻读进内存的，reload 就够；但
 * product_surface.js 这类主进程模块是 require 进来的，缓存跟进程走 —— 只有重启才读盘。
 * 所以菜单里的「重新载入」改成看代码时间戳：变了就整进程重启，没变才只是重载。
 *
 * 判据：
 *   A 只有 .html 变 → reload（改样式不该把进程重启一遍）
 *   B 主进程 .js 变 → restart
 *   C 负向对照：启动戳已经是最新的 → reload（不能退化成「每次都重启」）
 *   D 目录读不到 → 0，不抛（一个坏 dir 不能挡住重载）
 *   E 源码面：菜单里不再有 `role: "reload"`，而是走 reloadDecision 再决定
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const { codeStamp, reloadDecision } = require(path.join(REPO, "hosts/desktop/reload_policy.js"));

let PASS = 0;
let FAIL = 0;
function ok(msg) { PASS += 1; console.log("  ✓ " + msg); }
function bad(msg, detail) {
  FAIL += 1;
  console.log("  ✗ " + msg + (detail === undefined ? "" : " — " + String(detail)));
}

console.log("prove_reload_policy — ⌘R：代码变了才重启，没变只重载");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bb-reload-"));
const JS = path.join(TMP, "product_surface.js");
const HTML = path.join(TMP, "index.html");
fs.writeFileSync(JS, "// code\n");
fs.writeFileSync(HTML, "<html></html>");
const base = codeStamp([TMP]);

/* ---------- A. 只有界面变了 ---------- */
{
  const later = new Date(base + 5000);
  fs.utimesSync(HTML, later, later);
  const d = reloadDecision(base, [TMP]);
  d.action === "reload"
    ? ok("A 只有 index.html 变（+5s）→ 只重载界面，不为改样式把进程重启")
    : bad("A html only", JSON.stringify(d));
}

/* ---------- B. 主进程代码变了 ---------- */
{
  const later = new Date(base + 10000);
  fs.utimesSync(JS, later, later);
  const d = reloadDecision(base, [TMP]);
  d.action === "restart" && d.now > d.boot
    ? ok("B 主进程 .js 变（+10s）→ 整进程重启（" + Math.round((d.now - d.boot) / 1000) + "s 的差）")
    : bad("B js changed", JSON.stringify(d));
}

/* ---------- C. 负向对照：已经是最新 ---------- */
{
  const now = codeStamp([TMP]);
  const d = reloadDecision(now, [TMP]);
  d.action === "reload"
    ? ok("C 负向对照：启动戳已经是最新 → 仍然是轻量重载（没有退化成「每次都重启」）")
    : bad("C never restart", JSON.stringify(d));
}

/* ---------- D. 目录读不到 ---------- */
{
  const missing = path.join(TMP, "does-not-exist");
  const stamp = codeStamp([missing, TMP]);
  const d = reloadDecision(codeStamp([TMP]), [missing, TMP]);
  Number.isFinite(stamp) && d.action === "reload"
    ? ok("D 不存在的主进程目录被跳过，不抛异常（一个坏 dir 不能挡住重载）")
    : bad("D missing dir", JSON.stringify({ stamp, d }));
}

/* ---------- E. 源码面：菜单不再直接 role: reload ---------- */
{
  const src = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
  const stillRole = /role:\s*"reload"/.test(src);
  const wired = /reloadDecision\(MAIN_CODE_STAMP_AT_BOOT,\s*MAIN_CODE_DIRS\)/.test(src) &&
    /app\.relaunch\(\)/.test(src);
  !stillRole && wired
    ? ok("E 菜单的「重新载入」真的接上了判断（没有 role: \"reload\" 的旁路，relaunch 在同一条路径上）")
    : bad("E menu wiring", JSON.stringify({ stillRole, wired }));
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
console.log("\nprove_reload_policy: PASS=" + PASS + " FAIL=" + FAIL);
process.exit(FAIL > 0 ? 1 : 0);
