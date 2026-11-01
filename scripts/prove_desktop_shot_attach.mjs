#!/usr/bin/env node
/**
 * prove_desktop_shot_attach — 输入框的「截图」真的进得来、也真的会被限额挡住
 *
 * 用户要的是「输入框里加个截图」，最容易糊弄的两种做法都不该过：
 *   ① 只在渲染层画个相机图标，点了什么都不发生；
 *   ② 抓到了图，但绕开附件规则直接塞进待发送列表（第 7 个也照塞）。
 *
 * 所以这里起真 app，量的是「一条真 PNG 从系统抓屏走到待发送附件」的整条线：
 *   S-01 composer 工具栏里真有一颗可见的相机键（不是隐藏的摆设）。
 *   S-02 window.bitbot.screenshot.capture() 回来一条真实路径，且是真的 PNG。
 *   S-03 这条路径落在 uploads/<session>/ 里 —— 走的是附件的 staging，不是 tmp 直引。
 *   S-04 抓完窗口要自己回来（藏起来不回来 = 用户以为应用没了）。
 *   S-05 临时帧不留残留（temp 里没有 bitbot-shot-*）。
 *   S-06 已经有 6 个附件时再截，回的是 too_many_attachments（同一个上限，不放行第 7 个）。
 *   S-07 点「整屏截图」菜单项 → 待发送条上真的多一个带缩略图的 chip。
 *   S-08 静态：渲染层不直接碰 ipcRenderer，能力只在 preload 里开口。
 *
 * 说明：默认的「框选」走 macOS 的系统交互（screencapture -i），需要真人框，
 * 自动化里不能点 —— 那样会卡住等人。这里量的是它背后的同一条 staging 通道
 * 与整屏分支；框选分支只差一个「从哪里取像素」。
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import {
  electronLaunchEnv,
  electronUserDataDir,
  isolatedRepoRoot,
  gateAppEnv,
} from "./electron_env.mjs";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const NOW = new Date().toISOString();
const FIXTURE = {
  "bots.json": {
    version: 1,
    primary_id: "bot-bitbot",
    bots: [{
      id: "bot-bitbot", name: "Bit Bot", job: "通用助手", description: "你是 Bit Bot。",
      avatar: "", hidden: false, pinned: true, created_at: NOW, updated_at: NOW,
    }],
  },
  "rooms.json": { version: 1, rooms: [] },
};

function shotTemps() {
  try {
    return fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("bitbot-shot-"));
  } catch {
    return [];
  }
}

(async () => {
  console.log("prove_desktop_shot_attach — 截图键：真出图、真进附件、真守限额");

  const root = isolatedRepoRoot(REPO, "shot-attach", FIXTURE);
  const before = shotTemps();
  let app = null;

  try {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [
        path.join(DESKTOP, "main.js"),
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--user-data-dir=" + electronUserDataDir("shot-attach"),
      ],
      cwd: REPO,
      env: electronLaunchEnv(gateAppEnv(root)),
    });
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(1200);

    // S-01 相机键是真按钮，不是摆设
    const btn = await win.evaluate(() => {
      const b = document.getElementById("shot-btn");
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        title: b.getAttribute("title") || "",
        aria: b.getAttribute("aria-label") || "",
        disabled: !!b.disabled,
      };
    });
    btn && btn.w >= 20 && btn.h >= 20 && btn.title && btn.aria
      ? ok("S-01 composer 工具栏有可见的相机键（" + btn.w + "×" + btn.h + "，「" + btn.title + "」）")
      : bad("S-01 相机键不存在或不可见", JSON.stringify(btn));

    // S-02 走整屏分支拿一张真图（框选分支需要真人框，自动化里会卡住等人）
    const cap = await win.evaluate(async () => {
      try {
        return await window.bitbot.screenshot.capture({ mode: "screen" });
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    });
    const capPath = cap && Array.isArray(cap.paths) ? cap.paths[0] : "";
    let header = "";
    let bytes = 0;
    try {
      header = fs.readFileSync(capPath).subarray(0, 4).toString("hex");
      bytes = fs.statSync(capPath).size;
    } catch { /* 下面按失败判 */ }
    cap && cap.ok && header === "89504e47" && bytes > 1024
      ? ok("S-02 抓到的是一条真 PNG（" + Math.round(bytes / 1024) + "KB，头 " + header + "）")
      : bad("S-02 没拿到真实 PNG", JSON.stringify({ cap, header, bytes }));

    // S-03 落点必须是 uploads/<session>/ —— 说明走的是附件 staging，不是直接引用 tmp
    capPath && /[\\/]uploads[\\/]/.test(capPath)
      ? ok("S-03 截图落在 uploads/<session>/ 里（和附件同一条 staging 通道）")
      : bad("S-03 截图没进 uploads 目录", capPath);

    // S-04 藏起来的窗口要自己回来
    const visible = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return !!(w && w.isVisible());
    });
    visible ? ok("S-04 抓完窗口自己回来了（没有留在隐藏状态）") : bad("S-04 窗口没回来");

    // S-05 临时帧不残留
    const leaked = shotTemps().filter((f) => !before.includes(f));
    leaked.length === 0
      ? ok("S-05 临时帧清干净了（temp 里没有 bitbot-shot-* 残留）")
      : bad("S-05 临时帧残留", JSON.stringify(leaked));

    // S-06 同一个上限：已有 6 个就不许再加第 7 个
    const over = await win.evaluate(async () => {
      try {
        return await window.bitbot.screenshot.capture({ mode: "screen", existing: 6 });
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    });
    const code = String((over && (over.code || over.error)) || "");
    !over.ok && code.startsWith("too_many")
      ? ok("S-06 已有 6 个附件时再截被同一条限额挡住（" + code + "）")
      : bad("S-06 第 7 个附件没被挡住", JSON.stringify(over));

    // S-07 菜单项点下去 → 待发送条多一个带缩略图的 chip
    const strip = await win.evaluate(async () => {
      document.getElementById("attach-btn").click();
      await new Promise((r) => setTimeout(r, 150));
      const item = document.getElementById("shot-screen-btn");
      if (!item) return { missing: true };
      item.click();
      await new Promise((r) => setTimeout(r, 2500));
      const box = document.getElementById("attachment-strip");
      return {
        chips: box.querySelectorAll(".attach-chip").length,
        thumb: !!box.querySelector("img.attach-thumb"),
        busy: document.getElementById("shot-btn").classList.contains("is-busy"),
      };
    });
    strip && !strip.missing && strip.chips >= 1 && strip.thumb && !strip.busy
      ? ok("S-07 点「整屏截图」→ 待发送条出现带缩略图的附件（" + strip.chips + " 个）")
      : bad("S-07 截图没变成待发送附件", JSON.stringify(strip));

    // S-08 能力只在 preload 里开口
    const preload = fs.readFileSync(path.join(DESKTOP, "preload.js"), "utf8");
    const rendererLeak = /\bipcRenderer\b/.test(
      fs.readFileSync(path.join(DESKTOP, "index.html"), "utf8"),
    );
    /screenshot:\s*\{/.test(preload) && /attachPaths:/.test(preload) && !rendererLeak
      ? ok("S-08 渲染层不直接碰 ipcRenderer；screenshot.capture 与 attachments.attachPaths 只在 preload 开口")
      : bad("S-08 preload/渲染层的边界不对", JSON.stringify({
          hasCapture: /screenshot:\s*\{/.test(preload),
          hasAttachPaths: /attachPaths:/.test(preload),
          rendererLeak,
        }));
  } catch (e) {
    bad("gate crashed", (e && (e.stack || e.message)) || e);
  } finally {
    if (app) {
      try { await app.close(); } catch { /* 已经退出 */ }
    }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 临时目录残留不影响判定 */ }
  }

  console.log("\nprove_desktop_shot_attach: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})();
