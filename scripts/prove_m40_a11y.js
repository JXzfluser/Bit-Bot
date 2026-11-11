#!/usr/bin/env node
"use strict";

/**
 * prove_m40_a11y — Wave M40「无障碍：键盘焦点环 + prefers-reduced-motion」
 *
 * 静态层：
 *   1) `:focus { outline: none }` + `:focus-visible { outline: 2px solid
 *      var(--accent) }` —— 只有键盘用户看到焦点环，鼠标点击不闪环；
 *   2) `@media (prefers-reduced-motion: reduce)` 全局把 animation /
 *      transition duration 压到 ~0；
 *   3) reduced-motion 下 .msg-actions / composer 的 transform 归零，
 *      sess-row 的色带渐变也关掉（列表行本来就只变色、不位移）；
 *   4) M39 的 opacity 淡入契约仍在（本波只加无障碍，不回退微交互）。
 *
 * 负向对照：抹掉 :focus-visible 规则 → 焦点环断言翻假。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M40 accessibility proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* ---------- 1) focus-visible ring ---------- */
if (/:focus\s*\{\s*outline:\s*none\s*;?\s*\}/.test(html)) {
  ok(":focus { outline: none } —— 去掉默认环，交给 focus-visible");
} else {
  bad("focus reset", "no :focus outline:none");
}
/* 焦点环判据只写一次：断言用它的原文，负向对照用同一份去证「抹掉它就会翻假」。
   两边分开写迟早漂移 —— 上一次红就是判据认 --accent、对照抹的是 --accent-ink 那条。 */
const RING = /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)[^}]*outline-offset:\s*2px/;
if (RING.test(html)) {
  ok(":focus-visible 焦点环：2px solid accent + offset 2px（仅键盘可见）");
} else {
  bad("focus-visible ring", "not defined");
}

/* ---------- 2) reduced-motion global ---------- */
/* 页面里现在有多个 prefers-reduced-motion 块：组件旁边就近写的小块（如
   #room-rail 关掉进场动画）和本波 M40 的全局块。断言针对全局块，所以按
   「内容特征 + 括号配平」定位，不能取第一个出现的位置。 */
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
    out.push({ idx: i, text: src.slice(i, j) });
    i = src.indexOf(needle, j);
  }
  return out;
}
const rmBlocks = atRulesWith(html, "@media (prefers-reduced-motion: reduce)");
const rmGlobal = rmBlocks.find(
  (b) => /transition-duration:\s*0\.001ms\s*!important/.test(b.text) &&
    /animation-duration:\s*0\.001ms\s*!important/.test(b.text),
);
if (rmGlobal) {
  ok("@media (prefers-reduced-motion: reduce)：全局 transition/animation duration 压到 ~0");
} else {
  bad("reduced-motion", "global block missing or not forcing duration");
}

/* ---------- 3) transform 归零覆盖 ---------- */
if (rmGlobal && /#composer #send:active[\s\S]{0,260}transform:\s*none/.test(rmGlobal.text)) {
  ok("reduced-motion 下 composer send:active transform 归零（保留颜色反馈）");
} else {
  bad("rm send", "send:active not neutralized");
}
if (rmGlobal && /\.sess-row\s*\{\s*transition:\s*none/.test(rmGlobal.text)) {
  ok("reduced-motion 下 sess-row 色带渐变关闭（行不再动）");
} else {
  bad("rm sess-row", "row transition not neutralized");
}

/* ---------- 4) M39 契约保持 ---------- */
const actionsBlock = html.match(/\.msg \.msg-actions \{([\s\S]*?)\}/);
if (actionsBlock
  && /opacity:\s*0/.test(actionsBlock[1])
  && /pointer-events:\s*none/.test(actionsBlock[1])) {
  ok("M39 msg-actions 淡入契约仍在（本波未回退微交互）");
} else {
  bad("M39 regression", "fade contract lost");
}

/* ---------- 5) 顺序正确：M40 全局块在主样式之后、</style> 之前 ---------- */
const mainActionsIdx = html.indexOf(".msg .msg-actions {\n    position: absolute");
const rmIdx = rmGlobal ? rmGlobal.idx : -1;
if (mainActionsIdx > 0 && rmIdx > mainActionsIdx) {
  ok("reduced-motion 全局块位于主 .msg-actions 规则之后（不遮蔽主选择器）");
} else {
  bad("ordering", "reduced-motion global block placed before main rules");
}

/* ---------- 6) 负向对照 ---------- */
/* 原来抹「文件里第一处 :focus-visible 块」，但页面里现在有多条：
   `#to-bottom:focus-visible`（用 --accent-ink）排在前面，全局那条焦点环
   （用 --accent）在后头 —— 于是抹掉的是没被断言的那条，断言照旧为真，
   负向对照当场失效（和上面第 2 节踩过的同一个坑：取第一处 ≠ 取断言命中的那处）。
   改成按内容特征定位「断言 1 真正命中的那块」，并先证明它确实被抹掉了：
   替换后文本没变短就判红，免得哪天又变成「抹了个空气」。 */
const fvBlocks = atRulesWith(html, ":focus-visible {");
const fvRing = fvBlocks.find(
  (b) => /outline:\s*2px solid var\(--accent\)[^}]*outline-offset:\s*2px/.test(b.text),
);
if (!fvRing) {
  bad("negative control", "定位不到断言 1 命中的 :focus-visible 块（焦点环写法又飘了）");
} else {
  const broken =
    html.slice(0, fvRing.idx) + "/* stripped */" + html.slice(fvRing.idx + fvRing.text.length);
  if (broken.length >= html.length) bad("negative control", "strip 没有真的删掉那段规则");
  else if (RING.test(broken)) bad("negative control", "focus-visible survived strip");
  else ok("负向对照：抹掉断言命中的那条 :focus-visible 焦点环 → 断言翻假（非恒真）");
}

console.log("\nprove_m40_a11y: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
