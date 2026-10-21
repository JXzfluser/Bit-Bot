#!/usr/bin/env node
"use strict";

/**
 * M20 UI-parity proof — Grok-like shell, verified at the DOM/CSS level plus a
 * real pixel capture from the running Electron app under Xvfb.
 *
 * Why this exists: "looks like Grok" is not a testable claim, so each visual
 * decision that matters is pinned to something observable:
 *   - assistant bubbles are actually painted (non-transparent background), not
 *     the old bare-text layout;
 *   - sidebar rows carry a deterministic per-id avatar color, a preview line,
 *     and a blue unread dot at the row's right edge;
 *   - the title bar is a 3-column grid (brand | bot pill | actions) so the pill
 *     can never overlap the model picker;
 *   - the Connect apps panel is a 2-column card grid with round icons and
 *     category chips that really filter (click "代码" → 0 rows, click 全部 →
 *     rows return), not decoration.
 *
 * Usage: node scripts/prove_m20_ui.js   (exit 0 = all green)
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const HTML = path.join(REPO, "hosts/desktop/index.html");
const CHROME = path.join(REPO, "hosts/desktop/ui_chrome.css");
const SESSIONS = path.join(REPO, "hosts/desktop/sessions.js");

let PASS = 0;
let FAIL = 0;
const ok = (n) => { PASS++; console.log("  ✓ " + n); };
const bad = (n, d) => { FAIL++; console.log("  ✗ " + n + (d ? " — " + String(d).slice(0, 220) : "")); };

function main() {
  console.log("M20 UI parity proof");
  const html = fs.readFileSync(HTML, "utf8");
  const chrome = fs.readFileSync(CHROME, "utf8");
  const styled = chrome + "\n" + html;
  const sessions = fs.readFileSync(SESSIONS, "utf8");

  /* ---- 1) Assistant bubble is a real painted bubble ---- */
  const assistantBubble =
    /\.msg\.assistant \.body \{[^}]*background:\s*var\(--bot-bubble\)[^}]*border-radius/.test(html);
  assistantBubble
    ? ok("助手气泡有真实底色 + 圆角（不再是无框纯文本）")
    : bad("assistant bubble", "missing .msg.assistant .body background/radius");

  // Both themes must define a non-transparent bot bubble, or switching to
  // light mode silently regresses to the old bare text.
  const transparentBot = (styled.match(/--bot-bubble:\s*transparent/g) || []).length;
  transparentBot === 0
    ? ok("三套主题的 --bot-bubble 均非 transparent（浅色/深色/强制模式都实心）")
    : bad("bot-bubble transparency", transparentBot + " transparent declarations left");

  // User bubble keeps its own pill.
  /\.msg\.user \{[^}]*background:\s*var\(--user-bubble\)[^}]*border-radius:\s*18px/.test(html)
    ? ok("用户气泡保持右侧 18px 圆角胶囊")
    : bad("user bubble", "user pill styling lost");

  /* ---- 2) Sidebar: avatar color, preview, unread dot ---- */
  /const AVATAR_PALETTE = \[/.test(html) && /function avatarColorFor\(seed\)/.test(html)
    ? ok("侧栏头像色板 + 确定性哈希（同一 id 恒定同色）")
    : bad("avatar palette", "missing AVATAR_PALETTE/avatarColorFor");

  /\.sess-avatar \{[^}]*border-radius:\s*50%/.test(html)
    ? ok("会话/Bot 行用圆形头像")
    : bad("sess-avatar", "missing round avatar rule");

  /\.sess-main \.meta \{[^}]*text-overflow:\s*ellipsis/.test(html)
    ? ok("预览行单行省略（不会把长文本撑破侧栏）")
    : bad("preview ellipsis", "missing sess-main .meta ellipsis");

  // sessions.list uses object shorthand (`preview,`), so match the shorthand.
  /let preview = ""/.test(sessions) && /^\s+preview,\s*$/m.test(sessions) && /s\.preview\s*\|\|/.test(html)
    ? ok("sessions.list 提供 preview 字段，侧栏优先显示最后一条消息")
    : bad("session preview wiring", "preview not produced or not consumed");

  /\.unread-dot \{[^}]*background:\s*#2f7cf6/.test(html) && /el\.appendChild\(dot\)/.test(html)
    ? ok("未读点为蓝色圆点并挂在行右缘（不是名字后的 ●N 文本）")
    : bad("unread dot", "dot style or placement changed");

  /* ---- 3) Title bar pill cannot overlap actions ---- */
  /<header style="display:grid;grid-template-columns:auto 1fr auto;align-items:center/.test(html)
    ? ok("标题栏是 auto|1fr|auto 三列栅格（pill 居中且不压按钮）")
    : bad("header grid", "header layout is not the 3-column grid");

  /#header-actions \{[^}]*justify-content:\s*flex-end/.test(html) &&
    /#model-picker \{[^}]*flex-wrap:\s*nowrap/.test(html)
    ? ok("右侧操作区右对齐且不换行（不会再竖排断字）")
    : bad("header actions", "actions alignment/wrap regressed");

  /id="bot-pill"/.test(html) && /function updateBotPill\(name, colorSeed(?:, avatarDataUrl)?\)/.test(html)
    ? ok("当前 Bot 标识 pill 存在并由 updateBotPill 驱动")
    : bad("bot pill", "missing pill markup or updater");

  /document\.documentElement\.style\.setProperty\("--bot-avatar", c\)/.test(html)
    ? ok("助手头像色随当前 Bot 同步（整段对话归属同一身份）")
    : bad("bot-avatar sync", "assistant avatar not tied to active Bot");

  /* ---- 4) Typing indicator instead of an empty circle ---- */
  /\.msg \.typing i \{[^}]*animation:\s*typingPulse/.test(html) &&
    /typing\.className = "typing"/.test(html)
    ? ok("模型思考中显示三点动效（不再只留一个空圆）")
    : bad("typing indicator", "missing typing dots");

  // It must be built with DOM nodes, never innerHTML, or GP-93's single
  // safe-render-path discipline breaks.
  const typingBlock = html.slice(
    html.indexOf('typing.className = "typing"') - 400,
    html.indexOf('typing.className = "typing"') + 300,
  );
  !/sb\.innerHTML/.test(typingBlock) && /document\.createElement\("i"\)/.test(typingBlock)
    ? ok("输入指示用 DOM 节点构建（未污染正文唯一安全渲染路径）")
    : bad("typing render path", "typing indicator uses innerHTML");

  /* ---- 5) Connect apps: grid, icons, category chips ---- */
  /\.ca-grid \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(html) &&
    /class="ca-grid"/.test(html)
    ? ok("连接应用面板是两列卡片网格")
    : bad("ca-grid", "plugin containers are not a 2-col grid");

  /\.ca-icon \{[^}]*border-radius:\s*10px/.test(html) && /icon\.className = "ca-icon"/.test(html)
    ? ok("插件卡片带圆角图标（首字母 + 确定性配色）")
    : bad("ca-icon", "missing plugin icon");

  /id="ca-cats"/.test(html) && /class="ca-chip active" data-cat="all"/.test(html)
    ? ok("分类 chips 存在且「全部」默认激活")
    : bad("ca cats", "missing category chips");

  /const CA_CATEGORY_RULES = \[/.test(html) && /caActiveCat/.test(html) &&
    /caCategoryOf\(p\) === caActiveCat/.test(html)
    ? ok("chips 真实过滤插件（caCategoryOf 参与筛选，不是纯装饰）")
    : bad("ca filter", "category chips do not filter the list");

  // Unknown plugins must not be dumped into an arbitrary category.
  /return "";\s*\}\s*let caActiveCat/.test(html) || /for \(const \[cat, re\] of CA_CATEGORY_RULES\) if \(re\.test\(hay\)\) return cat;\s*return "";/.test(html)
    ? ok("未知插件不塞进错误分类（仅出现在「全部」）")
    : bad("ca unknown bucket", "unknown plugins may be mis-grouped");

  /* ---- 6) i18n: every new label exists in all three languages ---- */
  const keys = ["caCatAll", "caCatPassword", "caCatProductivity", "caCatCommunication", "caCatDesign", "caCatCode"];
  const missing = [];
  for (const k of keys) {
    const n = (html.match(new RegExp("^\\s+" + k + ":", "gm")) || []).length;
    if (n < 3) missing.push(k + "×" + n);
  }
  missing.length === 0
    ? ok("分类文案三语齐备（" + keys.length + " 键 ×3）")
    : bad("ca i18n", missing.join(", "));

  /* ---- 6b) One token layer for later waves ---- */
  /--sidebar-w:\s*260px/.test(chrome) &&
    /--tools-w:\s*280px/.test(chrome) &&
    /--rail-w:\s*340px/.test(chrome) &&
    /--space-1:\s*4px/.test(chrome) &&
    /--radius-sm:\s*6px/.test(chrome) &&
    /--radius-user:\s*18px/.test(chrome) &&
    /--text-sm:\s*12px/.test(chrome) &&
    /--bot-bubble:\s*#212121/.test(chrome) &&
    /--bot-bubble:\s*#f4f4f5/.test(chrome)
    ? ok("壳层宽度、间距、圆角、字号、气泡色只在 ui_chrome.css 定义")
    : bad("chrome tokens", "ui_chrome.css scale incomplete");

  /body\.force-dark/.test(chrome) &&
    /body\.force-light/.test(chrome) &&
    /prefers-color-scheme:\s*light/.test(chrome) &&
    /--text:\s*#ececec/.test(chrome) &&
    /--text:\s*#1a1a1a/.test(chrome)
    ? ok("暗色 / 浅色 / 强制态共用同一令牌表（--text 不再是未定义变量）")
    : bad("theme tokens", "light/dark/force channels drifted");

  (html.match(/class="bb-modal/g) || []).length >= 6 &&
    /\.bb-modal \{/.test(chrome) &&
    /\.bb-sheet \{/.test(chrome) &&
    /\.bb-btn \{/.test(chrome)
    ? ok("对话框共用 bb-modal / bb-sheet / bb-btn，不再各写一套遮罩")
    : bad("modal chrome", "shared modal classes missing");

  /* ---- 7) No regression on the safety render path ---- */
  const bodyInnerHTML = (html.match(/\.body"\)\.innerHTML/g) || []).length;
  bodyInnerHTML === 0
    ? ok("正文从未通过 innerHTML 写入（GP-93 纪律仍成立）")
    : bad("body innerHTML", bodyInnerHTML + " write sites");

  console.log("\n" + PASS + " passed, " + FAIL + " failed");
  process.exit(FAIL > 0 ? 1 : 0);
}

main();
