#!/usr/bin/env node
"use strict";

/**
 * prove_m39_micro — Wave M39「微交互精修：fade 悬浮条、按压反馈、侧栏行 hover」
 *
 * 静态层：
 *   1) `.msg .msg-actions` 从"硬切 display"改为"opacity + pointer-events 淡入"，
 *      让 transition 真正生效（`display: none` 阻断过渡是常见坑）；
 *   2) `.msg .msg-actions button:active` scale(0.96)，`.msg-actions button`
 *      transition 中包含 `transform 0.06s`；
 *   3) `.sess-row:hover` translateX(1px)、`.sess-row:active` 微缩放；
 *   4) `#composer #send:active` scale(0.94)，attach / voice 按钮同样反馈；
 *   5) 上一波 M38 pill / Copy / gradient 契约不破。
 *
 * 负向对照：抹掉 opacity 断言 → 断言 1 翻假。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M39 microinteraction proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* ---------- 1) msg-actions 淡入 ---------- */
const actionsBlock = html.match(/\.msg \.msg-actions \{([\s\S]*?)\}/);
if (actionsBlock
  && /display:\s*inline-flex/.test(actionsBlock[1])
  && /opacity:\s*0/.test(actionsBlock[1])
  && /pointer-events:\s*none/.test(actionsBlock[1])
  && /transition:[^;]*opacity[^;]*transform/.test(actionsBlock[1])) {
  ok("msg-actions：改用 opacity + pointer-events 淡入（display 常驻，让 transition 生效）");
} else {
  bad("msg-actions fade", "not using opacity transition");
}
if (/\.msg:hover \.msg-actions[^{]*\{[^}]*opacity:\s*1[^}]*pointer-events:\s*auto/.test(html)) {
  ok("hover / focus-within 展开态：opacity 1 + pointer-events auto");
} else {
  bad("actions open state", "hover rule drift");
}

/* ---------- 2) msg-actions button 按压 ---------- */
if (/\.msg \.msg-actions button:active\s*\{\s*transform:\s*scale\(0\.96\)/.test(html)) {
  ok("msg-actions button:active → scale(0.96)");
} else {
  bad("actions press", "no :active scale");
}
if (/\.msg \.msg-actions button \{[^}]*transition:[^}]*transform[^}]*\}/.test(html)) {
  ok("msg-actions button 的 transition 含 transform（scale 有缓动）");
} else {
  bad("button transition", "transform not in transition");
}

/* ---------- 3) sess-row hover / active ---------- */
if (/\.sess-row:hover \{[^}]*transform:\s*translateX\(1px\)/.test(html)) {
  ok("sess-row:hover translateX(1px) —— 侧栏行微滑，指向可点击");
} else {
  bad("sess-row hover", "no translateX feedback");
}
if (/\.sess-row:active \{[^}]*scale\(0\.995\)/.test(html)) {
  ok("sess-row:active scale(0.995) —— 极轻按压，避免视觉噪声");
} else {
  bad("sess-row active", "no scale feedback");
}

/* ---------- 4) composer send press ---------- */
if (/#composer #send:active \{[^}]*scale\(0\.94\)/.test(html)) {
  ok("#send:active scale(0.94) —— 发送键按压反馈");
} else {
  bad("send press", "no :active scale on send");
}
if (/#composer #attach-btn:active, #composer #voice-btn:active \{[^}]*scale\(0\.94\)/.test(html)) {
  ok("attach / voice 按钮 :active 同款 scale(0.94)，Composer 三个键反馈节奏一致");
} else {
  bad("composer side buttons press", "attach / voice :active drift");
}

/* ---------- 5) M38 契约保持 ---------- */
if (/navigator\.clipboard\s*&&\s*navigator\.clipboard\.writeText/.test(html)
  && /#welcome\s+\.w-brand\s*\{[^}]*background:\s*linear-gradient/.test(html)) {
  ok("M38 Copy 装配 + welcome 渐变契约保持（未被 M39 覆盖）");
} else {
  bad("M38 regression", "copy or gradient lost");
}

/* ---------- 6) 负向对照：抹掉 opacity ---------- */
const broken = html.replace(/\.msg \.msg-actions \{([\s\S]*?)opacity:\s*0;([\s\S]*?)\}/, ".msg .msg-actions {$1$2}");
const survived = /\.msg \.msg-actions \{[^}]*opacity:\s*0/.test(broken);
if (!survived) ok("负向对照：抹掉 opacity:0 → 淡入断言翻假（非恒真）");
else bad("negative control", "opacity survived strip");

console.log("\nprove_m39_micro: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
