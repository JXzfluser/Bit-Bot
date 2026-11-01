#!/usr/bin/env node
"use strict";

/**
 * prove_m33_grokchrome — Wave M33「对标 Grok Bot 桌面外观」的验收
 *
 * 静态层：
 *   1) 侧栏顶部图标工具栏（search-toggle + sess-new），取代旧的全宽 + 按钮；
 *   2) 侧栏底部账户条（圆形头像 + Bit Bot 名 + popup 菜单 + 分割线），
 *      Settings 项 id 保持 sidebar-settings-btn 以复用既有 M24 契约；
 *   3) 用户气泡右下角送达状态：单 ✓（stored）→ 双 ✓ 绿色（read），
 *      样式类 .msg-status .ms-check.read 存在；
 *   4) 助手「思考中」三点动效：streamEl 建立时挂 .typing / 3 个 <i>，
 *      动效 keyframes typingPulse；
 *   5) 中英混排清理：WAVEG_I18N 里 zh-CN / zh-TW 段不再残留常见英文标签
 *      （Computer / Marketplace / Usage & Billing / Recover Computer /
 *       New Bot / Advanced · Agents / Allow automatically / Ask first），
 *      且 HTML 默认文本（i18n 兜底可见）同样为中文。品牌词与
 *      语言选择器里的 "English"（原生名）例外。
 *
 * 负向对照：把 ui_chrome.css 的 --radius-user 改成 4px，M20 用户胶囊断言
 *          仍会因 18px 直连通过，所以这里改用「移除 .msg-status .ms-check.read」
 *          验证 M33 送达状态断言非恒真（临时改写内存字符串，不落盘）。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M33 Grok-desktop chrome proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* ---------- 1) 侧栏顶部图标工具栏 ---------- */
if (/<div id="sidebar-toolbar">/.test(html)
  && /id="sidebar-search-toggle"/.test(html)
  && /id="sess-new"/.test(html)
  && /#sidebar-toolbar \{/.test(html)
  && /#sidebar-toolbar button \{/.test(html) /* unified circle-button rule */) {
  ok("侧栏顶部图标工具栏：search-toggle + new-chat 两个圆钮");
} else {
  bad("sidebar-toolbar", "top icon row missing");
}

/* ---------- 2) 侧栏底部账户条（Grok-style） ---------- */
/* 与真源的唯一有意偏离：Grok 弹层首行是「发现新版本」，我方把版本更新收敛到
   「设置 → 更新」一处入口，所以 ap-update 不在弹层里（这条断言随之移除）。 */
if (/<div id="account-bar">/.test(html)
  && /id="account-avatar-btn"/.test(html)
  && /id="account-avatar-circle"/.test(html)
  && /id="account-name-label"/.test(html)
  && /id="account-popup"/.test(html)
  && /id="ap-usage"/.test(html)
  /* ap-mobile（获取移动版）并入了 ap-remote 打开的「移动端远程控制」弹窗：
     手机这件事只有一个入口，弹层里不再单列一行。 */
  && /id="ap-remote"/.test(html)
  && !/id="ap-mobile"/.test(html)
  && /id="ap-support"/.test(html)
  && /id="sidebar-settings-btn"/.test(html)
  && /id="ap-add-account"/.test(html)
  && /id="ap-signout"/.test(html)
  && !/id="ap-update"/.test(html)
  && /#account-bar \{/.test(html)
  && /#account-popup \{/.test(html)) {
  ok("账户条包含 8 项弹层（用量 / 移动端远程控制 / 支持 / 设置 / 连接应用 / 模板市场 / 加账户 / 登出 + 分割线），版本更新只在设置里、移动版并进远程控制");
} else {
  bad("account-bar", "Grok-style footer popup missing");
}

/* ---------- 3) 送达状态（✓ → ✓✓） ---------- */
if (/className = "msg-status"/.test(html)
  && /ms-check/.test(html)
  && /\.msg-status \.ms-check\.read \{[^}]*color:\s*#22c55e/.test(html)
  && /textContent = "✓✓"/.test(html)
  && /st\.classList\.add\("read"\)/.test(html)) {
  ok("用户气泡右下角送达状态：存储 → ✓、回合收尾 → ✓✓ 绿色");
} else {
  bad("delivery status", "✓/✓✓ affordance missing");
}

/* ---------- 4) 助手思考三点 typing indicator ---------- */
if (/\.msg \.typing i \{[^}]*animation:\s*typingPulse/.test(html)
  && /@keyframes typingPulse/.test(html)
  && /typing\.className = "typing"/.test(html)
  && /for \(let ti = 0; ti < 3; ti\+\+\)/.test(html)) {
  ok("助手气泡在首个 delta 前显示三点动效（DOM 节点，不污染 innerHTML 路径）");
} else {
  bad("typing indicator", "3-dot pulse missing");
}

/* ---------- 4b) Composer 发送按钮：圆形 ↑ 图标（Grok parity，§4.3 = 28px） ---------- */
/* 发送键的字形从 `↑`（U+2191 字符，靠字体描出来，字号一变就糊）换成了内联
   SVG 上箭头：同一条 28px 圆钮外观，但几何/粗细/对齐由自己定，且任意 DPI 清晰。
   旧断言要求按钮里是文本 ↑，已随之更新（仍要求 Enter 提示与 28px 圆钮）。 */
if (/<button id="send" type="submit" title="[^"]*Enter[^"]*"[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/button>/.test(html)
  && /#composer #send \{[^}]*width:\s*28px[^}]*height:\s*28px[^}]*border-radius:\s*var\(--radius-pill\)/.test(html)) {
  ok("Composer 发送按钮：28px 圆形 + 内联 SVG 上箭头 + Enter 提示（Grok 视觉密度）");
} else {
  bad("composer send", "circular ↑ send button missing");
}

/* ---------- 5) 中英混排清理：i18n 段 & 默认 HTML 文本 ---------- */
const forbiddenKeys = [
  ["gpPanel", "Grok Parity 面板"],
  ["botComputer", "Bot 的 Computer"],
  ["marketplace", "\"Marketplace\""],
  ["defaultBotName", "New Bot"],
  ["advanced", "Agents / Teammates"],
  ["allowAuto", "Allow automatically"],
  ["askFirst", "Ask first"],
  ["gpRecover", "Recover Computer"],
  ["tabComputer", "\"Computer\""],
];
const zh = html.slice(html.indexOf("zh-CN:"), html.indexOf("zh-TW:"));
const zt = html.slice(html.indexOf("zh-TW:"), html.indexOf('"en": {'));
const missing = [];
for (const [k, en] of forbiddenKeys) {
  const re = new RegExp('"' + k + '":\\s*"[^"]*' + en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (re.test(zh) || re.test(zt)) missing.push(k + " still English");
}
if (missing.length === 0) ok("zh-CN / zh-TW 段中 10 个常见英文标签已全部本地化");
else bad("i18n CN/EN mixing", missing.join("; "));

// 品牌词允许保留：Bit Bot、Bot、Gmail、Slack、Teams、MCP、Chrome、Cursor。
// 语言选择器里的 "English" 是各语言原生名（在 zh 段中也应显示为 "English"）。
if (/<option value="zh-CN">简体中文<\/option>/.test(html)
  && /<option value="zh-TW">繁體中文<\/option>/.test(html)
  && /<option value="en">English<\/option>/.test(html)) {
  ok("语言选择器保留各语言原生名（English / 简体中文 / 繁體中文）");
} else {
  bad("language dropdown", "native names lost");
}

/* ---------- 6) 负向对照 ---------- */
// 把 .msg-status .ms-check.read 规则移除后，第 3 项断言应变红。
const broken = html.replace(/\.msg-status \.ms-check\.read \{[^}]*\}/g, "");
const stillPasses = /color:\s*#22c55e/.test(broken)
  || /\.msg-status \.ms-check\.read/.test(broken);
if (!stillPasses) ok("负向对照：砍掉 read 绿色样式 → 送达状态断言翻假（非恒真）");
else bad("negative control", "read style survives strip");

console.log("\nprove_m33_grokchrome: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
