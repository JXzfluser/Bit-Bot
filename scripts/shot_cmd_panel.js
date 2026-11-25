#!/usr/bin/env node
"use strict";
/**
 * shot_cmd_panel.js — 给「团队指挥台」截几张图（现状取证，不改任何东西）
 * 用法：node scripts/shot_cmd_panel.js <输出目录>
 * 跑在**隔离根**里（BITBOT_DATA_ROOT 指向临时根）⇒ 不碰用户真数据。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const OUT = process.argv[2] || "/tmp/cmdshots";
const REPO = path.join(__dirname, "..");
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "cmdshot-"));
const DATA = path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
// 拷贝一份 data 快照（像 e2e 那样），让界面有东西可渲染
try { fs.cpSync(path.join(REPO, "data"), DATA, { recursive: true }); } catch { /* 没有就空着 */ }

(async () => {
  const { _electron } = require(path.join(REPO, "hosts/desktop/node_modules/playwright-core"));
  const electron = require(path.join(REPO, "hosts/desktop/node_modules/electron"));
  const app = await _electron.launch({
    executablePath: electron,
    args: [path.join(REPO, "hosts/desktop/main.js"), "--no-sandbox", "--disable-gpu",
      "--user-data-dir=" + path.join(ROOT, "ud")],
    cwd: REPO,
    env: Object.assign({}, process.env, {
      BITBOT_DATA_ROOT: DATA,
      BITBOT_NO_SECRET_SYNC: "1",
      BITBOT_DESKTOP_AUTOSTART: "0",
      TZ: "Asia/Shanghai",
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
      BITBOT_LLM_API_KEY: "shot",
      BITBOT_LLM_MODEL: "shot",
    }),
  });
  const win = await app.firstWindow();
  win.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text().slice(0, 200)); });
  win.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
  await win.waitForTimeout(3500);

  // 0) 先看页面活不活
  try {
    const st = await win.evaluate(() => ({
      bodyClass: document.body.className,
      children: Array.from(document.body.children).map((c) => c.id || c.tagName).slice(0, 12),
      mainRect: (() => { const m = document.getElementById("main"); const r = m && m.getBoundingClientRect(); return r ? [r.width, r.height] : null; })(),
      composerDisplay: (() => { const c = document.getElementById("composer"); return c ? getComputedStyle(c).display : null; })(),
    }));
    console.log("[state]", JSON.stringify(st));
  } catch (e) { console.log("[state 失败]", String(e).slice(0, 200)); }

  // 1) 默认视图（主区）
  await win.screenshot({ path: path.join(OUT, "01-main.png"), animations: "disabled", timeout: 20000 });

  // 2) 打开指挥台
  await win.evaluate(() => {
    const b = document.getElementById("cmd-open-btn");
    if (b) b.click();
  });
  await win.waitForTimeout(2200);
  await win.screenshot({ path: path.join(OUT, "02-cmd-open.png"), animations: "disabled", timeout: 20000 });

  // 3) 指挥台局部（看清它的排版）
  const el = await win.$("#command-panel");
  if (el) {
    try { await el.screenshot({ path: path.join(OUT, "03-cmd-only.png") }); } catch (e) { console.log("局部截图失败:", e.message); }
  }

  // 4) 右侧 rail 打开的样子（群资料），用来对比设计语言
  await win.evaluate(() => {
    const b = document.getElementById("cmd-open-btn");
    if (b) b.click();
    const r = document.querySelector('[data-action="open-room"], #room-open-btn, .room-rail-btn');
    if (r) r.click();
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, "04-room-rail.png"), animations: "disabled", timeout: 20000 });

  console.log("截图完成 →", OUT);
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* keep */ }
  process.exit(0);
})().catch((e) => {
  console.error("截图失败:", (e && e.stack) || e);
  process.exit(1);
});
