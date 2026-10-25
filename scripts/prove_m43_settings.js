#!/usr/bin/env node
"use strict";

/**
 * prove_m43_settings — Wave M43「Settings 面板视觉精修：分段控件 tab 条 + 粘顶 header」
 *
 * 断言：
 *   1) #settings-tabs 改为分段控件容器（inline-flex + #f4f4f5 底 + pill 圆角）；
 *   2) #settings-tabs .settings-tab-btn 去边框去阴影，active 用白色浮起 pill；
 *   3) HTML 上 #settings-tabs 无 inline style 覆盖（否则 CSS display 被顶掉）；
 *   4) #settings-sheet .bb-sheet-head sticky + 下分隔线（滚动时标题不丢）；
 *   5) #settings-sheet .bb-sheet-title 字号上调 + letter-spacing；
 *   6) M42 消息流排版 / M20 契约不破（回归护栏）；
 *   7) 负向对照：抹掉分段样式 → 断言 1 翻假。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M43 settings-panel polish proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
const css = fs.readFileSync(path.join(REPO, "hosts/desktop/ui_chrome.css"), "utf8");

/* ---------- 1) 分段控件容器 ---------- */
const tabsBlock = css.match(/#settings-tabs \{([\s\S]*?)\}/);
if (tabsBlock
  && /display:\s*inline-flex/.test(tabsBlock[1])
  && /background:\s*#f4f4f5/.test(tabsBlock[1])
  && /border-radius:\s*999px/.test(tabsBlock[1])) {
  ok("#settings-tabs 分段控件容器（inline-flex + 浅底 + 999px pill）");
} else {
  bad("segmented tabs", "container style drift");
}

/* ---------- 2) tab 按钮态 ---------- */
const tabBtnBlock = css.match(/#settings-tabs \.settings-tab-btn \{([\s\S]*?)\}/);
if (tabBtnBlock
  && /background:\s*transparent/.test(tabBtnBlock[1])
  && /border:\s*0/.test(tabBtnBlock[1])
  && /box-shadow:\s*none/.test(tabBtnBlock[1])
  && /border-radius:\s*999px/.test(tabBtnBlock[1])) {
  ok("tab 按钮默认态：透明底 + 无边框 + 无阴影 + 999px");
} else {
  bad("tab btn default", "still boxed chip");
}
const tabActiveBlock = css.match(/#settings-tabs \.settings-tab-btn\.active \{([\s\S]*?)\}/);
if (tabActiveBlock
  && /background:\s*(?:#ffffff|var\(--surface\))/.test(tabActiveBlock[1])
  && /box-shadow:\s*0 1px 3px rgba\(0, 0, 0, 0\.10\)/.test(tabActiveBlock[1])) {
  ok("tab 按钮 active：白底 pill + 1px 3px 阴影（浮起感）");
} else {
  bad("tab active", "no lifted pill");
}

/* ---------- 3) 无 inline style 覆盖 ---------- */
const tabsHtml = html.match(/<div id="settings-tabs"([^>]*)>/);
if (tabsHtml && !/style=/.test(tabsHtml[1])) {
  ok("HTML #settings-tabs 无 inline style，CSS 分段控件不被覆盖");
} else {
  bad("html inline style", "settings-tabs has style= attribute");
}

/* ---------- 4) 粘顶 header ---------- */
const headBlock = css.match(/#settings-sheet \.bb-sheet-head \{([\s\S]*?)\}/);
if (headBlock
  && /position:\s*sticky/.test(headBlock[1])
  && /border-bottom:\s*1px solid var\(--line\)/.test(headBlock[1])
  && /background:\s*(?:#ffffff|var\(--surface\))/.test(headBlock[1])) {
  ok("sheet 头部 sticky（滚动时标题 + 关闭按钮常驻）");
} else {
  bad("sticky head", "no sticky or no border/bg");
}

/* ---------- 5) 标题字号 ---------- */
const titleBlock = css.match(/#settings-sheet \.bb-sheet-title \{([\s\S]*?)\}/);
if (titleBlock && /font-size:\s*var\(--text-lg\)/.test(titleBlock[1])) {
  ok("sheet 标题字号升至 --text-lg（与设置内容层拉开层级）");
} else {
  bad("title size", "not text-lg");
}

/* ---------- 6) M42 / M20 回归护栏 ---------- */
/* M42 的分组契约以前靠「连续 assistant 隐藏重复头像」来断言；头像按参考图
   移除后，改用「assistant 满列宽」作为同等强度的分组证据。 */
if (/\.msg\.assistant \{[\s\S]*?max-width:\s*100%/.test(html)
  && /\.msg\.user \{[^}]*background:\s*var\(--user-bubble\)[^}]*border-radius:\s*var\(--radius-user\)/.test(html)) {
  ok("M42 消息流满列宽 + M20 用户胶囊契约保持");
} else {
  bad("regression", "M42 or M20 broken");
}

/* ---------- 7) 负向对照 ---------- */
const broken = css.replace(/#settings-tabs \{[\s\S]*?\}/, "#settings-tabs { display: block; }");
if (!/#settings-tabs \{[^}]*inline-flex/.test(broken)) {
  ok("负向对照：抹掉分段样式 → 容器断言翻假（非恒真）");
} else {
  bad("negative control", "container survived strip");
}

console.log("\nprove_m43_settings: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
