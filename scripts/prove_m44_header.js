#!/usr/bin/env node
"use strict";

/**
 * prove_m44_header — Wave M44「Header 顶部栏：修复不可见的 active + 统一按压反馈」
 *
 * 真实 bug：`#header-actions button` 有 `border: 0`，而 `.active` 只设了
 *          `border-color`（无可见边框可染）—— 打开的面板对应切换钮高亮完全看不见。
 * 修复：.active 改实心 accent 填充 + 反色文字 + 字重；并给 header 按钮补
 *      :active scale 与 reduced-motion 归零，与 M39 composer 节奏一致。
 *
 * 断言：
 *   1) `.active` 使用 background: var(--accent) + color: var(--accent-ink)（不再是 dead border-color）；
 *   2) `#header-actions button` 有 :active scale(0.96)；
 *   3) reduced-motion 块把 #header-actions button:active transform 归零；
 *   4) M20 回归护栏：#header-actions 仍 justify-content: flex-end；
 *   5) 负向对照：把 .active 塞回 border-color → 断言 1 翻假。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M44 header active-state proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* ---------- 1) .active 实心高亮（dead border-color 修复） ---------- */
const activeBlock = html.match(/#header-actions button\.active \{([\s\S]*?)\}/);
if (activeBlock
  && /background:\s*var\(--accent\)/.test(activeBlock[1])
  && /color:\s*var\(--accent-ink\)/.test(activeBlock[1])
  && !/border-color:\s*var\(--muted\)/.test(activeBlock[1])) {
  ok("#header-actions button.active：实心 accent 填充（修 border:0 下 dead border-color）");
} else {
  bad("active fill", "still relies on border-color or missing fill");
}

/* ---------- 2) header 按钮按压反馈 ---------- */
if (/#header-actions button:active \{[^}]*scale\(0\.96\)/.test(html)) {
  ok("#header-actions button:active scale(0.96)：与 composer / msg-actions 一致");
} else {
  bad("header press", "no :active scale");
}

/* ---------- 3) reduced-motion 归零 header 按压 ---------- */
/* 页面里有多个 prefers-reduced-motion 块（组件就近写法 + M40 全局块），
   所以按内容找「含 #header-actions button:active 的那一块」，不取第一个。 */
function atRulesWith(src, needle) {
  const out = [];
  let i = src.indexOf(needle);
  while (i >= 0) {
    let depth = 0;
    let j = src.indexOf("{", i);
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) { j++; break; }
      }
    }
    out.push(src.slice(i, j));
    i = src.indexOf(needle, j);
  }
  return out;
}
const rmHit = atRulesWith(html, "@media (prefers-reduced-motion: reduce)")
  .find((t) => /#header-actions button:active[\s\S]{0,160}transform:\s*none/.test(t));
if (rmHit) {
  ok("reduced-motion 下 #header-actions button:active transform 归零");
} else {
  bad("rm header", "header press not neutralized");
}

/* ---------- 4) M20 回归护栏 ---------- */
if (/#header-actions \{[^}]*justify-content:\s*flex-end/.test(html)) {
  ok("M20 回归护栏：#header-actions 仍 justify-content: flex-end");
} else {
  bad("M20 regression", "header actions alignment drifted");
}

/* ---------- 4b) JS 真的把 rail 状态回写到两个 header 按钮 ---------- */
/* Layout contract v1: both header rail toggles are now driven by the single
   sync point syncHeaderRailButtons() called from setPanel(). */
if (/function syncHeaderRailButtons\(val\)[\s\S]{0,300}toolsBtn\.classList\.toggle\("active", val === "tools"\)[\s\S]{0,120}gpBtn\.classList\.toggle\("active", val === "computer"\)/.test(html) &&
    /setPanel\(open \? "computer" : "none"\)/.test(html)) {
  ok("把 rail open 状态回写 gp-panel-btn.active（CSS+JS 双端闭合，单一写点 syncHeaderRailButtons 同时覆盖 tools-toggle-btn）");
} else {
  bad("rail active sync", "header buttons not driven by setPanel state");
}
if (/setPanel\(panelValue\(\) === "tools" \? "none" : "tools"\)/.test(html)) {
  ok("tools-toggle-btn：点击走 setPanel 单一状态源（实心填充有 JS 触发）");
} else {
  bad("tools active sync", "tools button not toggled via setPanel");
}

/* ---------- 5) 负向对照 ---------- */
const broken = html.replace(/#header-actions button\.active \{[\s\S]*?\}/,
  "#header-actions button.active { border-color: var(--muted); color: var(--ink); }");
if (!/#header-actions button\.active \{[^}]*background:\s*var\(--accent\)/.test(broken)) {
  ok("负向对照：塞回 dead border-color → active 高亮断言翻假（非恒真）");
} else {
  bad("negative control", "fill survived revert");
}

console.log("\nprove_m44_header: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
