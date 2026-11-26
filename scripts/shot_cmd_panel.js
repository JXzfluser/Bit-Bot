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

/* 演示数据：**只写进这个隔离根**（BITBOT_DATA_ROOT 指向它），
   用户真 data/ 一个字节都不动。
   为什么需要它：指挥台绑定「当前会话」⇒ 空根里没有群 ⇒ 成员区是空的，
   截出来的图看不出设计长什么样。
   用的就是门禁 prove_command_panel 里那三份事实（三个群、成员各不相同）——
   形态与真数据一致，不是凭空捏的。 */
function writeDemoFixture() {
  const desktop = path.join(DATA, "desktop");
  fs.mkdirSync(desktop, { recursive: true });
  const bots = {
    bots: [
      { id: "t1", name: "情报侦察员", job: "找线索、核来源", description: "找线索" },
      { id: "t2", name: "选题策划师", job: "挑值得做的题", description: "选题" },
      { id: "t3", name: "内容主笔", job: "把题写成稿", description: "写作" },
      { id: "p1", name: "Carol", job: "", description: "" },
    ],
    primary_id: "t1",
  };
  const rooms = {
    version: 1,
    rooms: [
      {
        id: "r-content", title: "自媒体内容团队", members: ["t1", "t2", "t3"],
        transcript: [
          { kind: "bot_reply", room_id: "r-content", speaker: "t1", bot_id: "t1", name: "情报侦察员", text: "园区光伏这条最值得做", at: "2026-11-25T09:10:00.000Z" },
          {
            kind: "final_report", room_id: "r-content", task: "整理今日热点稿",
            task_title: "整理今日热点稿", task_sig: "sig-content-1",
            responders: ["t1", "t2", "t3"], total: 3, returned: 2, partial: true,
            sections: [], artifacts: [], at: "2026-11-25T09:30:00.000Z",
          },
          {
            kind: "confirm_request", room_id: "r-content", speaker: "host", stage: "route",
            question: "这一轮有两个题都能做。你选哪个？还是两个都做？",
            candidates: [{ id: "t2", name: "选题策划师" }], task: "整理今日热点稿",
            task_sig: "sig-content-2", at: "2026-11-25T09:40:00.000Z",
          },
        ],
      },
      {
        id: "r-chat", title: "闲聊群", members: ["p1"],
        transcript: [
          { kind: "bot_reply", room_id: "r-chat", speaker: "p1", bot_id: "p1", name: "Carol", text: "在的", at: "2026-11-25T08:00:00.000Z" },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(desktop, "bots.json"), JSON.stringify(bots, null, 2));
  fs.writeFileSync(path.join(desktop, "rooms.json"), JSON.stringify(rooms, null, 2));
}
try { writeDemoFixture(); } catch (e) { console.log("[演示数据写入失败]", String(e).slice(0, 120)); }

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

  // 1.5) 进一个群（指挥台绑定当前会话 ⇒ 得先有会话）
  try {
    const entered = await win.evaluate(async () => {
      const api = window.bitbot && window.bitbot.rooms && window.bitbot.rooms.list;
      if (typeof api !== "function") return null;
      const res = await api();
      const payload = (res && res.rooms) || {};
      const rows = Array.isArray(payload) ? payload : payload.rooms || [];
      if (!rows.length) return null;
      const hit = rows[0];
      if (window.__bitbotCommand && window.__bitbotCommand.enterRoom) {
        return await window.__bitbotCommand.enterRoom(hit.id);
      }
      return null;
    });
    console.log("[enterRoom]", JSON.stringify(entered));
  } catch (e) { console.log("[enterRoom 失败]", String(e).slice(0, 120)); }

  // 2) 打开指挥台
  await win.evaluate(() => {
    const b = document.getElementById("app-rail-command");
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
    const b = document.getElementById("app-rail-command");
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
