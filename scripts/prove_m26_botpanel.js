#!/usr/bin/env node
"use strict";

/**
 * prove_m26_botpanel — G-22 Bot 设置右栏（官方 spec §2.1 右侧面板 / §4.5 头像 / §4.6 通知）
 *
 * 静态层：#bot-rail 结构、互斥 CSS/JS、入口接线、三语 i18n、Host IPC。
 * 行为层：真实 product_surface botDetail / botNotifySet 打到真实 store，
 *         加一条负向对照（砍掉 botDetail 的记忆计数 → 变红）。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.log("  ✗ " + m); };

console.log("M26 §2.1/§4.6 Bot 设置右栏 proof");

/* ---------- 1) 静态层 ---------- */
const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/<aside id="bot-rail">/.test(html)
  ? ok("#bot-rail 面板存在（右侧可选面板之一）")
  : bad("bot-rail markup missing");

/id="br-name"/.test(html) && /id="br-job"/.test(html) && /id="br-tags"/.test(html) && /id="br-desc"/.test(html) &&
  /id="br-stats"/.test(html) && /id="br-actions"/.test(html) && /id="br-notify"/.test(html)
  ? ok("面板含 资料 / 工作方式 / 通知开关 / 统计 / 操作 全部区块（GP-125/126/127）")
  : bad("bot-rail sections missing");

// Layout contract v1: all rail surfaces share grid-area "rail" via the group rule.
/#machines\s*\{[^}]*grid-area:\s*rail/.test(html) && /body\[data-panel="bot"\] #bot-rail \{ display: block; \}/.test(html)
  ? ok("#bot-rail 与 Computer 预览共用同一右栏列（grid-area: rail，data-panel 驱动，GP-124）")
  : bad("bot-rail grid placement wrong");

/if \(open\) closeBotRail\(\); \/\/ one optional right panel at a time/.test(html) && /botRailId = id;\s*\n\s*setPanel\("bot"\)/.test(html)
  ? ok("面板状态单一来源：openBotRail 走 setPanel(\"bot\")，保证 bot-open 与 computer-open 互斥（GP-124）")
  : bad("mutual exclusion missing");

/\[wavegT\("menuBotSettings"\), \(\) => openBotRail\(bot\.id\)\]/.test(html)
  ? ok("Bot 右键菜单有「Bot 设置」入口（复用既有菜单，不新增第二份菜单）")
  : bad("menu entry missing");

/window\.bitbot\.bots\.detail\(botRailId\)/.test(html) && /window\.bitbot\.bots\.notify\(botRailId, want\)/.test(html)
  ? ok("面板数据全部经 bots.detail / bots.notify IPC（渲染层不直写 store）")
  : bad("panel bypasses IPC");

/wavegT\("brUnknown"\)/.test(html) && /bot_not_found/.test(html)
  ? ok("未知 Bot 显示「未找到」而不是伪造资料（GP-125）")
  : bad("unknown-bot state missing");

/if \(botRailId === id\) closeBotRail\(\)/.test(html)
  ? ok("删除确认后关闭该 Bot 的右栏（GP-127）")
  : bad("delete-close wiring missing");

const preload = fs.readFileSync(path.join(REPO, "hosts/desktop/preload.js"), "utf8");
/detail: \(id\) => ipcRenderer\.invoke\("bitbot:bots:detail", id\)/.test(preload) &&
  /notify: \(botId, on\) => ipcRenderer\.invoke\("bitbot:bots:notify"/.test(preload)
  ? ok("preload 暴露 bots.detail / bots.notify")
  : bad("preload bridge missing");

const mainjs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
/ipcMain\.handle\("bitbot:bots:detail"/.test(mainjs) && /ipcMain\.handle\("bitbot:bots:notify"/.test(mainjs)
  ? ok("main 注册 bots:detail / bots:notify IPC")
  : bad("main IPC missing");

const i18nKeys = ["menuBotSettings", "brAbout", "brSettings", "brNotify", "brNotifyHint", "brActions",
  "brRailNote", "brMemories", "brRoutines", "brSessions", "brRooms", "brPrimary", "brUnknown",
  "brNotifySaved", "brNotifyFailed"];
let i18nOk = true;
for (const k of i18nKeys) {
  const re = new RegExp(k + ":\\s*\"");
  const hits = (html.match(new RegExp("        " + k + ":\\s*\"", "g")) || []).length;
  if (hits < 3) { i18nOk = false; console.log("      key " + k + " locales=" + hits); }
}
i18nOk
  ? ok("新增 15 个文案在 zh-CN / zh-TW / en 三套 i18n 里齐全")
  : bad("i18n keys missing");

/* ---------- 2) 行为层（真实 store，快照+恢复保证幂等） ---------- */
const DESKTOP = path.join(REPO, "data/desktop");
const snap = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const files = ["bots.json", "settings.json", "sessions.json", "rooms.json", "computer.json"];
const before = {};
for (const f of files) before[f] = snap(path.join(DESKTOP, f));
const memBefore = snap(path.join(REPO, "data/memory/desktop-host.json"));

const { createProductSurface } = require(path.join(REPO, "hosts/desktop/product_surface.js"));
const surface = createProductSurface(REPO);

const view = surface.listViews();
const probeBot = view.bots[0];
probeBot
  ? ok("Host listViews() 提供真实 Bot（" + probeBot.id + "）")
  : bad("no bots in store");

const d = surface.botDetail(probeBot.id);
d.ok === true
  ? ok("botDetail 返回 ok 且资料来自 bots.json（name=" + d.bot.name + "）")
  : bad("botDetail failed: " + JSON.stringify(d && d.error));

d.bot.id === probeBot.id && d.bot.name === probeBot.name &&
  JSON.stringify(d.bot.tags) === JSON.stringify(Array.isArray(probeBot.tags) ? probeBot.tags : []) &&
  d.bot.avatar_data_url === probeBot.avatar_data_url
  ? ok("面板资料逐项等于 bots.json（含 tags 与 avatar_data_url）")
  : bad("profile mismatch");

const dPrimary = surface.botDetail(view.primary_id || probeBot.id);
typeof dPrimary.is_primary === "boolean"
  ? ok("is_primary 来自 primary_id（" + dPrimary.is_primary + "），不是渲染层猜的")
  : bad("is_primary missing");

// 记忆计数 = memory 槽真实条数
let expectedMem = 0;
try {
  const store = JSON.parse(fs.readFileSync(path.join(REPO, "data/memory/desktop-host.json"), "utf8"));
  const slot = store.bots && store.bots[probeBot.id];
  if (slot && Array.isArray(slot.entries)) expectedMem = slot.entries.length;
} catch (_) { /* store absent → 0 */ }
d.memory_entries === expectedMem
  ? ok("记忆条数 = desktop-host.json 该 Bot 槽真实条数（" + d.memory_entries + "）")
  : bad("memory count mismatch: " + d.memory_entries + " vs " + expectedMem);

// 会话数 = DM 命名约定（与删除级联同一口径）
let expectedSess = 0;
try {
  const st = JSON.parse(fs.readFileSync(path.join(DESKTOP, "sessions.json"), "utf8"));
  const titles = new Set([probeBot.name + " · DM", probeBot.id + " · DM"]);
  expectedSess = (st.sessions || []).filter((s) => titles.has(String(s.title || ""))).length;
} catch (_) {}
d.sessions_total === expectedSess
  ? ok("会话数按「<name> · DM」约定统计（" + d.sessions_total + "），与删除级联同口径")
  : bad("session count mismatch: " + d.sessions_total + " vs " + expectedSess);

// 通知开关：off → settings.notify[bot]=false 且不被其它 Bot 覆盖；on → 恢复
const n1 = surface.botNotifySet(probeBot.id, false);
n1.ok && n1.notify_map[probeBot.id] === false
  ? ok("botNotifySet(false) 真写 settings.notify（" + probeBot.id + "=false）")
  : bad("notify off failed");
const stAfter = JSON.parse(fs.readFileSync(path.join(DESKTOP, "settings.json"), "utf8"));
stAfter.notify && stAfter.notify[probeBot.id] === false
  ? ok("settings.json 落盘 notify." + probeBot.id + "=false")
  : bad("settings.json not updated");
const dOff = surface.botDetail(probeBot.id);
dOff.notifications === false && dOff.notify_explicit === true
  ? ok("关掉后 botDetail 返回 notifications=false 且 notify_explicit=true")
  : bad("detail after off wrong");

const other = view.bots[1];
let otherOn = null;
if (other) {
  otherOn = surface.botNotifySet(other.id, true);
}
const n2 = surface.botNotifySet(probeBot.id, true);
n2.ok && n2.notify_map[probeBot.id] === true
  ? ok("botNotifySet(true) 恢复该 Bot 开关")
  : bad("notify on failed");
if (other) {
  const st2 = JSON.parse(fs.readFileSync(path.join(DESKTOP, "settings.json"), "utf8"));
  st2.notify[other.id] === true
    ? ok("开关是逐 Bot 合并写：另一个 Bot 的设置不被覆盖")
    : bad("notify map clobbered other bot");
  surface.botNotifySet(other.id, false); // 清掉另一个 Bot 的显式项，恢复原状
}
const st3 = JSON.parse(fs.readFileSync(path.join(DESKTOP, "settings.json"), "utf8"));
if (st3.notify) { delete st3.notify[probeBot.id]; }
if (st3.notify && other) { delete st3.notify[other.id]; }
fs.writeFileSync(path.join(DESKTOP, "settings.json"), JSON.stringify(st3, null, 2));
const nBad = surface.botNotifySet(probeBot.id, "yes");
nBad.ok === false && nBad.error === "invalid_value"
  ? ok("非布尔值被拒绝（invalid_value），不把字符串写进 settings")
  : bad("invalid notify value accepted");
const nUnknown = surface.botNotifySet("ghost-bot-xyz", true);
nUnknown.ok === false && nUnknown.error === "bot_not_found"
  ? ok("未知 Bot id 的通知开关被拒（bot_not_found）")
  : bad("unknown bot notify accepted");
const dUnknown = surface.botDetail("ghost-bot-xyz");
dUnknown.ok === false && dUnknown.error === "bot_not_found"
  ? ok("未知 Bot id 的详情被拒（bot_not_found），不造行")
  : bad("unknown bot detail accepted");

/* ---------- 3) 负向对照：砍掉记忆计数 → 变红 ---------- */
const surfPath = path.join(REPO, "hosts/desktop/product_surface.js");
const original = fs.readFileSync(surfPath, "utf8");
const probeMarker = "if (slot && Array.isArray(slot.entries)) memoryEntries = slot.entries.length;";
const BROKEN = "if (false && slot && Array.isArray(slot.entries)) memoryEntries = slot.entries.length;";
if (original.includes(probeMarker)) {
  try {
    // 负向对照用确定性的记忆槽：无论 store 现在是什么格式/内容，都先在
    // 该 Bot 槽种恰好 1 条（旧版扁平数组先包成 v2），结束统一恢复 memBefore。
    const memPath = path.join(REPO, "data/memory/desktop-host.json");
    // A clean run has no desktop-host.json (G-23 restores a missing store by
    // deleting the file). Start from an empty v2 document instead of throwing.
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(memPath, "utf8"));
    } catch (e) {
      if (!e || e.code !== "ENOENT") throw e;
      raw = { version: 2, bots: {} };
    }
    const store = Array.isArray(raw) ? { version: 2, bots: {} } : (raw || { version: 2, bots: {} });
    if (!store.bots || typeof store.bots !== "object" || Array.isArray(store.bots)) store.bots = {};
    store.version = 2;
    store.bots[probeBot.id] = { entries: [{ key: "m26-probe", value: "x", at: new Date().toISOString() }] };
    fs.mkdirSync(path.dirname(memPath), { recursive: true });
    fs.writeFileSync(memPath, JSON.stringify(store, null, 2));
    const healthy = surface.botDetail(probeBot.id);
    healthy.memory_entries === 1
      ? ok("种入一条记忆后 detail 计到 1（计数读的是真实槽）")
      : bad("seeded memory not counted");
    fs.writeFileSync(surfPath, original.replace(probeMarker, BROKEN));
    delete require.cache[require.resolve(path.join(REPO, "hosts/desktop/product_surface.js"))];
    // 必须重新 require：旧绑定仍指向修复前的模块闭包。
    const broken = require(path.join(REPO, "hosts/desktop/product_surface.js")).createProductSurface(REPO).botDetail(probeBot.id);
    broken.memory_entries === 0
      ? ok("负向对照：禁用记忆计数后 detail 返回 0（真实 1 条，断言会红）")
      : bad("negative control did not bite");
  } catch (e) {
    bad("negative control crashed: " + e.message);
  } finally {
    // 恢复代码与记忆 store（无论成功与否）
    const current = fs.readFileSync(surfPath, "utf8");
    if (current.includes(BROKEN)) {
      fs.writeFileSync(surfPath, current.replace(BROKEN, probeMarker));
    }
    delete require.cache[require.resolve(path.join(REPO, "hosts/desktop/product_surface.js"))];
    if (memBefore === null) {
      try { fs.unlinkSync(path.join(REPO, "data/memory/desktop-host.json")); } catch (_) {}
    } else {
      fs.writeFileSync(path.join(REPO, "data/memory/desktop-host.json"), memBefore);
    }
  }
} else {
  bad("negative control marker missing");
}

/* ---------- 4) 恢复快照（幂等） ---------- */
for (const f of files) {
  const p = path.join(DESKTOP, f);
  if (before[f] === null) { try { fs.unlinkSync(p); } catch (_) {} }
  else fs.writeFileSync(p, before[f]);
}

console.log("");
console.log("prove_m26_botpanel: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
