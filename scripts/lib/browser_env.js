"use strict";

/**
 * 共享:找 playwright-core 与 Chromium。
 *
 * 为什么抽出来:门禁若把浏览器路径**写死**,在 CI 上就永远跑不了 ——
 * 而「跑不了的门」等于「不存在的门」(AC-07 就是盯这个的)。
 *
 * 查找顺序:
 *   playwright-core: $PLAYWRIGHT_CORE_PATH → hosts/desktop/node_modules → node_modules
 *   Chromium: $BITBOT_CHROMIUM → $PLAYWRIGHT_CHROMIUM_EXECUTABLE
 *            → playwright 自带 → ~/.cache/ms-playwright 下的 chromium-* 目录
 *
 * 找不到就返回 null ⇒ 调用方**如实 SKIP**(rc=2),不假装 PASS。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");

function loadPlaywright() {
  const cands = [
    path.join(REPO, "hosts", "desktop", "node_modules", "playwright-core"),
    path.join(REPO, "node_modules", "playwright-core"),
  ];
  if (process.env.PLAYWRIGHT_CORE_PATH) cands.unshift(process.env.PLAYWRIGHT_CORE_PATH);
  for (const c of cands) {
    try { return require(c); } catch (_) { /* 试下一个 */ }
  }
  return null;
}

function findChromium(pw) {
  const envs = [process.env.BITBOT_CHROMIUM, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE];
  for (const e of envs) if (e && fs.existsSync(e)) return e;
  if (pw) {
    try {
      const p = pw.chromium.executablePath();
      if (p && fs.existsSync(p)) return p;
    } catch (_) { /* 没装浏览器 */ }
  }
  const roots = [
    path.join(process.env.HOME || "", ".cache", "ms-playwright"),
    path.join(REPO, "node_modules", "playwright-core", ".local-browsers"),
  ];
  for (const root of roots) {
    try {
      const dirs = fs.readdirSync(root).filter((d) => d.startsWith("chromium-"));
      for (const d of dirs) {
        for (const rel of ["chrome-linux64/chrome", "chrome-win/chrome.exe", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
          const p = path.join(root, d, rel);
          if (fs.existsSync(p)) return p;
        }
      }
    } catch (_) { /* 没有这个目录 */ }
  }
  return null;
}

/**
 * 一次性拿到 { pw, exe }。
 * @returns {{pw:object|null, exe:string|null, reason:string}}
 */
function resolveBrowser() {
  const pw = loadPlaywright();
  if (!pw) return { pw: null, exe: null, reason: "没有 playwright-core" };
  const exe = findChromium(pw);
  if (!exe) return { pw, exe: null, reason: "没有 Chromium" };
  return { pw, exe, reason: "" };
}

module.exports = { REPO, loadPlaywright, findChromium, resolveBrowser };
