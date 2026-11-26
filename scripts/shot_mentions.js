#!/usr/bin/env node
"use strict";
/**
 * shot_mentions.js — 给「同名时 @ 点名长什么样」截一张图（现状取证，不改任何东西）
 * 用法：node scripts/shot_mentions.js <输出目录>
 *
 * 走**无头 Chromium**（和门禁 prove_bot_identity.js 同一套）⇒ 不用起 Electron，
 * 也不碰用户数据（注入的是内存里的夹具，一个字节都不落盘）。
 *
 * 为什么值得截图：这一批最容易被忽略的一条是「候选列表按**名字**去重 ⇒
 * 第二个同名 bot 根本不列出来」。截图里两个「助手」都在、标签各带职责，
 * 才是真的分得清。
 */
const fs = require("fs");
const path = require("path");
const { resolveBrowser } = require("./lib/browser_env");

const OUT = process.argv[2] || "/tmp/mentionshots";
const REPO = path.resolve(__dirname, "..");
const HTML = path.join(REPO, "hosts", "desktop", "index.html");

/* 演示数据：一个群里两个都叫「助手」（职责不同）+ 两个职责也撞的 + 一个独苗。
   形态与门禁 prove_bot_identity / prove_mention_disambiguation 里的夹具一致。 */
const BOTS = [
  { id: "dup-a", name: "助手", job: "销售", description: "外呼销售", group: "团队A" },
  { id: "dup-b", name: "助手", job: "支持", description: "客户支持", group: "团队A" },
  { id: "twin-a", name: "通用", job: "通用", description: "通用", group: "团队A" },
  { id: "twin-b", name: "通用", job: "通用", description: "通用", group: "团队A" },
  { id: "solo", name: "独苗", job: "研究", description: "研究", group: "团队A" },
];
const ROOM = {
  id: "r-dup",
  title: "同名群",
  members: ["dup-a", "dup-b", "twin-a", "twin-b", "solo"],
  transcript: [
    { kind: "bot_reply", room_id: "r-dup", speaker: "dup-a", bot_id: "dup-a", name: "助手", text: "我先做", task_sig: "sig-1", at: "2026-11-26T10:00:00.000Z" },
    { kind: "bot_reply", room_id: "r-dup", speaker: "dup-b", bot_id: "dup-b", name: "助手", text: "我也做", task_sig: "sig-1", at: "2026-11-26T10:01:00.000Z" },
  ],
};

(async () => {
  const benv = resolveBrowser();
  if (!benv.pw || !benv.exe) {
    console.log("shot_mentions: SKIP — " + benv.reason);
    process.exit(2);
  }
  const { chromium } = benv.pw;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: benv.exe,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
  await page.addInitScript((arg) => {
    window.bitbot = Object.assign(window.bitbot || {}, {
      bots: {
        list: async () => ({ version: 1, primary_id: "dup-a", bots: arg.bots }),
        detail: async (id) => {
          const hit = arg.bots.find((b) => b && b.id === id);
          return { ok: true, bot: hit || { id: id, name: id } };
        },
      },
      rooms: { list: async () => ({ rooms: { version: 1, rooms: [arg.room] } }) },
      sessions: { list: async () => ({ sessions: [] }) },
    });
  }, { bots: BOTS, room: ROOM });
  await page.goto("file://" + HTML, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  // 进群（@ 候选绑定「当前会话」）
  const entered = await page.evaluate(async () => {
    if (window.__bitbotCommand && window.__bitbotCommand.enterRoom) {
      return await window.__bitbotCommand.enterRoom("r-dup");
    }
    return null;
  });
  console.log("[enterRoom]", JSON.stringify(entered));
  await page.waitForTimeout(1200);

  // 敲一个 @ ⇒ 候选列表弹出来（真实用户动作）
  await page.click("#composer #text");
  await page.keyboard.type("@");
  await page.waitForTimeout(900);

  const items = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#mention-pop .mention-item")).map((el) => {
      const nm = el.querySelector(".m-name");
      return nm ? String(nm.textContent || "") : "";
    })
  );
  console.log("[候选]", JSON.stringify(items));

  await page.screenshot({ path: path.join(OUT, "01-mention-popup.png"), animations: "disabled", timeout: 20000 });
  const pop = await page.$("#mention-pop");
  if (pop) {
    try { await pop.screenshot({ path: path.join(OUT, "02-mention-only.png"), timeout: 20000 }); }
    catch (e) { console.log("局部截图失败:", e.message); }
  }
  console.log("截图完成 →", OUT);
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error("截图失败:", (e && e.stack) || e);
  process.exit(1);
});
