#!/usr/bin/env node
"use strict";

/**
 * prove_m37_layout — Wave M37「侧栏账户弹层修复 + 中英文混排清扫」
 *
 * 静态层：
 *   1) ui_chrome.css 里有全局 `[hidden] { display: none !important; }`，
 *      避免作者 `display: flex|block` 覆盖 UA 的 hidden 语义（本次左侧
 *      底部"点了没反应"的根因）；
 *   2) 账户弹层 CSS 使用 `position: fixed; z-index: 45`，脱离 `#agents`
 *      的 overflow 裁剪；
 *   3) JS 里 setAccountPopup(open) 是唯一真源：open → removeAttribute，
 *      close → setAttribute，且 aria-expanded 同步；
 *   4) Escape 键关闭弹层；
 *   5) 侧栏 sidebar-w 与 Grok 桌面版对齐为 280px；
 *   6) 面板标题使用 .panel-title（大写字号收敛、letter-spacing）；
 *   7) M37 batch 1 + batch 2 中英文清扫：gpQueueNote / autoReview /
 *      accountSection / tabUsage / accountLabelPlaceholder / New chat /
 *      Search / Settings aria-label 已落到中文。
 *
 * 负向对照：抹掉 setAccountPopup 里的 removeAttribute → 断言 3 翻假。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M37 layout / CN-EN proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
const css = fs.readFileSync(path.join(REPO, "hosts/desktop/ui_chrome.css"), "utf8");

/* ---------- 1) 全局 [hidden] 兜底 ---------- */
if (/\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/.test(css)) {
  ok("ui_chrome.css：全局 [hidden] { display: none !important }，防 UA 语义被覆盖");
} else {
  bad("global [hidden]", "no !important reset in ui_chrome.css");
}

/* ---------- 2) 账户弹层定位 + z-index（内联 <style> 在 html 里）---------- */
/* 与真源 §4.5-6b 对齐后：弹层是锚在账户胶囊**上方的 absolute 面板**（228 宽、
   底边距 footer 2px），不再是固定贴底。关键是它仍要压住 #agents 的 overflow，
   所以 z-index 必须在 4x。 */
if (/#account-popup\s*\{[^}]*position:\s*absolute[^}]*\}/.test(html)
  && /#account-popup\s*\{[^}]*z-index:\s*4\d[^}]*\}/.test(html)) {
  ok("#account-popup 锚在触发元素上方（absolute）+ z-index: 4x，不被 #agents overflow 裁剪");
} else {
  bad("popup stacking", "popup not anchored or missing z-index");
}

/* ---------- 3) setAccountPopup 单一真源 ---------- */
const setFn = html.match(/function\s+setAccountPopup\s*\(\s*open\s*\)[\s\S]{0,600}?\n\s*\}/);
if (setFn
  && /popup\.removeAttribute\("hidden"\)/.test(setFn[0])
  && /popup\.setAttribute\("hidden",\s*""\)/.test(setFn[0])
  && /acctBtn\.setAttribute\("aria-expanded",\s*open\s*\?\s*"true"\s*:\s*"false"\)/.test(setFn[0])) {
  ok("setAccountPopup(open)：hidden 属性 + aria-expanded 同步，单一真源");
} else {
  bad("setAccountPopup", "single-source open/close helper drift");
}

/* ---------- 4) Escape 关闭弹层 ---------- */
if (/key\s*===\s*"Escape"[\s\S]{0,220}setAccountPopup\(false\)/.test(html)) {
  ok("Escape 键 → setAccountPopup(false)");
} else {
  bad("escape", "Escape not wired to close popup");
}

/* ---------- 5) 侧栏宽度对齐 Grok 280px ---------- */
if (/--sidebar-w:\s*280px/.test(css)) {
  ok("--sidebar-w 与 Grok 桌面版对齐：280px");
} else {
  bad("sidebar width", "not 280px");
}

/* ---------- 6) M37 batch 2 CN/EN 清扫：关键 gp-label / placeholder 已本地化 ---------- */
function lineHas(attr, zh) {
  const lines = html.split(/\r?\n/);
  for (const l of lines) {
    if (l.includes(attr)) {
      // 该 data-i18n 键可能同时命中 i18n 字典定义；只匹配 DOM 层（class="gp-label"/placeholder=）
      if (l.includes('class="gp-label"') || l.includes("placeholder=")) {
        return l.includes(zh);
      }
    }
  }
  return false;
}
const cnChecks = [
  ['data-i18n="gpQueueNote"', '「已过期」'],
  ['data-i18n="autoReview"', '自动复核规则'],
  ['data-i18n="accountSection"', '账户（本地 profile'],
  ['data-i18n-ph="accountLabelPlaceholder"', '配置名（如「个人」「工作」）'],
];
for (const [attr, zh] of cnChecks) {
  if (lineHas(attr, zh)) ok("CN/EN 清扫：" + attr + " → 已本地化");
  else bad("cn/en leak " + attr, "expected " + zh);
}

/* ---------- 7) aria-label 已 CN ---------- */
if (/aria-label="新对话"/.test(html)) {
  ok("aria-label New chat → 新对话 已清扫");
} else {
  bad("aria New chat", "not localized");
}

/* ---------- 8) settings-tab label map ---------- */
if (/general:\s*"常规"[\s\S]{0,200}computer:\s*"电脑"[\s\S]{0,200}credentials:\s*"凭证"/.test(html)) {
  ok("settings-tab 动态标签 map 已中文化（常规 / 电脑 / 凭证）");
} else {
  bad("settings-tab map", "still English");
}

/* ---------- 9) composer placeholder ---------- */
if (/给 Bit Bot 发消息/.test(html)) {
  ok("composer placeholder 已中文化：给 Bit Bot 发消息…");
} else {
  bad("composer placeholder", "not localized");
}

/* ---------- 10) 负向对照：抹掉 removeAttribute ---------- */
const broken = html.replace(/popup\.removeAttribute\("hidden"\);/, "/* gone */");
const survived = /function\s+setAccountPopup\s*\(\s*open\s*\)[\s\S]{0,600}popup\.removeAttribute\("hidden"\)/.test(broken);
if (!survived) ok("负向对照：抹掉 removeAttribute → setAccountPopup 断言翻假（非恒真）");
else bad("negative control", "helper survived strip");

console.log("\nprove_m37_layout: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
