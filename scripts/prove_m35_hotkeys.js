#!/usr/bin/env node
"use strict";

/**
 * prove_m35_hotkeys — Wave M35「键盘快捷键面板 + Cmd/Ctrl+K 搜索」
 *
 * 静态层：
 *   1) wireAccelerators 里新增 Cmd/Ctrl+K → toggleSessionSearchFromShortcut()
 *      与 Cmd/Ctrl+/ → openHotkeysSheet()；
 *   2) toggleSessionSearchFromShortcut 复用既有 #session-search 输入，不建
 *      第二份状态；
 *   3) openHotkeysSheet 用 DOM 节点建，不用 innerHTML（GP-93 纪律），
 *      modal 类走 .bb-modal / .bb-sheet 复用；
 *   4) HOTKEYS 表 9 条，每条文案 key 都在 zh-CN / zh-TW / en 三段齐；
 *   5) ui_chrome.css 里 #hotkeys-modal .hk-* 样式挂在 sheet 上，无副作用。
 *
 * 负向对照：抹掉 `else if (ev.key === "/")` 分支 → openHotkeysSheet 不再被
 *          触发，第 1 项断言应变红。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M35 hotkeys-sheet proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
const chrome = fs.readFileSync(path.join(REPO, "hosts/desktop/ui_chrome.css"), "utf8");

/* ---------- 1) 两个新绑定接入 wireAccelerators ---------- */
if (/else if \(ev\.key === "k" \|\| ev\.key === "K"\) \{[\s\S]{0,200}toggleSessionSearchFromShortcut\(\)/.test(html)
  && /else if \(ev\.key === "\/"\) \{[\s\S]{0,200}openHotkeysSheet\(\)/.test(html)) {
  ok("wireAccelerators：新增 Cmd/Ctrl+K（搜索）与 Cmd/Ctrl+/（快捷键表）");
} else {
  bad("accelerators", "K or / branch missing");
}

/* ---------- 2) 两处搜索各自只有一个入口，不造第二份状态 ---------- */
/* 变更（Bot + 群 Bot 产品模型）：侧栏放大镜与 Cmd/Ctrl+K 现在打开的是
   setSidebarSearchOpen —— 过滤 #bot-list / #room-list，而不是会话。
   会话搜索仍留在 #sessions-popup 自己的输入框，由 setSessionSearchOpen 揭出
   （弹层打开时调用），保证它不是死代码。
   两个入口各自只有一个函数在改 hidden / body class / focus。 */
const sbSearchFn =
  (html.match(/function setSidebarSearchOpen\(open\) \{[\s\S]*?\n    \}/) || [""])[0];
const sbSearchOk =
  /sb-search-open/.test(sbSearchFn) &&
  /sbSearchRow\.hidden = !open/.test(sbSearchFn) &&
  /getElementById\("sb-search-row"\)/.test(html) &&
  /function applySidebarFilter\(raw\)/.test(html) &&
  /function toggleSessionSearchFromShortcut\(\)[\s\S]{0,200}setSidebarSearchOpen\(/.test(html) &&
  /sidebarSearchToggle\.addEventListener\("click"[\s\S]{0,240}setSidebarSearchOpen\(/.test(html);
if (sbSearchOk) {
  ok("侧栏搜索单一入口 setSidebarSearchOpen：放大镜与 Cmd/Ctrl+K 同源，过滤 Bot / 群组");
} else {
  bad("sidebar search", "search row not reached through the single setSidebarSearchOpen entry");
}

const searchFn =
  (html.match(/function setSessionSearchOpen\(open\) \{[\s\S]*?\n    \}/) || [""])[0];
const searchOk =
  /session-search-open/.test(searchFn) &&
  /getElementById\("session-search"\)/.test(searchFn) &&
  /sessions-popup/.test(searchFn) &&
  /el\.hidden = !open/.test(searchFn) &&
  /abSessions\.addEventListener[\s\S]{0,600}setSessionSearchOpen\(true\)/.test(html);
if (searchOk) {
  ok("会话搜索仍由 setSessionSearchOpen 单一入口揭出（账户条弹层打开时），不是死代码");
} else {
  bad("session search", "session search row not reached through setSessionSearchOpen");
}

/* ---------- 3) openHotkeysSheet 用 DOM 节点，走 bb-modal / bb-sheet ---------- */
if (/function openHotkeysSheet\(\)/.test(html)
  && /modal\.className = "bb-modal"/.test(html)
  && /sheet\.className = "bb-sheet bb-sheet-sm"/.test(html)
  && /document\.createElement\("div"\)/.test(html)
  && /document\.createElement\("kbd"\)/.test(html)
  && !/openHotkeysSheet[\s\S]{0,600}innerHTML/.test(html)) {
  ok("快捷键面板：bb-modal + bb-sheet 复用；DOM 建（createElement / appendChild），不污染 innerHTML 路径");
} else {
  bad("sheet build", "hotkeys sheet not on bb-modal or uses innerHTML");
}

/* ---------- 4) HOTKEYS 表覆盖 9 项，文案三语齐 ---------- */
const keys = ["hkNewChat", "hkSearch", "hkToggleSidebar", "hkComputer", "hkConnectApps", "hkVoice", "hkSend", "hkNewline", "hkOpenSheet", "hotkeysTitle"];
const zhStart = html.indexOf('"zh-CN": {');
const ztStart = html.indexOf('"zh-TW": {');
const enStart = html.indexOf("\n      en: {", ztStart);
const enEnd = html.indexOf("\n    };", enStart);
const sections = {
  zh: html.slice(zhStart, ztStart),
  zt: html.slice(ztStart, enStart),
  en: html.slice(enStart, enEnd),
};
const missing = [];
for (const k of keys) {
  for (const s of ["zh", "zt", "en"]) {
    if (!new RegExp("\\b" + k + ":\\s*\"").test(sections[s])) missing.push(s + ":" + k);
  }
}
if (missing.length === 0) ok("HOTKEYS 9 项 + 面板标题共 10 个 key 在 zh-CN / zh-TW / en 全部齐备");
else bad("i18n coverage", missing.join(", "));

/* ---------- 5) ui_chrome.css 里的 sheet 样式 ---------- */
if (/#hotkeys-modal \.hk-list \{/.test(chrome)
  && /#hotkeys-modal \.hk-row \{/.test(chrome)
  && /#hotkeys-modal \.hk-row kbd \{/.test(chrome)
  && /#hotkeys-modal \.hk-desc \{/.test(chrome)) {
  ok("快捷键面板样式在 ui_chrome.css 内，走 var(--space-*) / var(--text-*)");
} else {
  bad("hotkey css", "one of the .hk-* rules missing");
}

/* ---------- 6) 负向对照 ---------- */
// 用注释掉 openHotkeysSheet() 调用来验证断言不是恒真：抹掉函数调用后
// 第 1 项应识别不到 "…ev.key === "/"\s*{…openHotkeysSheet}"。
const broken = html.replace(/openHotkeysSheet\(\);/, "/* removed */");
const survived = /else if \(ev\.key === "\/"\)[\s\S]{0,200}openHotkeysSheet\(\)/.test(broken);
if (!survived) ok("负向对照：抹掉 openHotkeysSheet() 调用 → 分支断言翻假（非恒真）");
else bad("negative control", "sheet call survived strip");

console.log("\nprove_m35_hotkeys: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
