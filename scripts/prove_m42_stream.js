#!/usr/bin/env node
"use strict";

/**
 * prove_m42_stream — Wave M42「消息流排版：居中对齐 + 气泡尾角 + 连续回合分组」
 *
 * 断言：
 *   1) #log 单列居中（max-width var(--content-max)=760 + margin auto），修 user 贴右视口、
 *      assistant 卡片止于 760 的左右不对称；
 *   2) user 气泡保留 `border-radius: 18px`（M20 契约）且新增
 *      `border-bottom-right-radius: 6px` 尾角；
 *   3) assistant `.body` 保留 `var(--bot-bubble)` + `border-radius` 且新增
 *      `border-top-left-radius: 8px` 尾角（朝头像）；
 *   4) 连续 assistant 行隐藏重复头像 + margin-top 收紧凑；
 *   5) M20 用户胶囊正则未被破坏（回归护栏）。
 *
 * 负向对照：抹掉 max-width 居中 → 第 1 条翻假。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M42 message-stream layout proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* ---------- 1) #log 居中列 ---------- */
const logBlock = html.match(/#log \{([\s\S]*?)\}/);
if (logBlock
  && /max-width:\s*var\(--content-max\)/.test(logBlock[1])
  && /margin-left:\s*auto/.test(logBlock[1])
  && /margin-right:\s*auto/.test(logBlock[1])) {
  ok("#log 单列居中（max-width var(--content-max)=760 + margin auto）—— user/assistant 对齐同一列");
} else {
  bad("#log center", "not centered single column");
}

/* ---------- 2) user 气泡尾角 + M20 契约 ---------- */
const userBlock = html.match(/\.msg\.user \{([\s\S]*?)\}/);
if (userBlock
  && /background:\s*var\(--user-bubble\)/.test(userBlock[1])
  && /border-radius:\s*18px/.test(userBlock[1])
  && /border-bottom-right-radius:\s*6px/.test(userBlock[1])) {
  ok("user 气泡：保留 18px 圆角（M20）+ 新增右下 6px 尾角");
} else {
  bad("user tail", "radius contract or tail missing");
}

/* ---------- 3) assistant 气泡尾角 + bot-bubble ---------- */
const botBlock = html.match(/\.msg\.assistant \.body \{([\s\S]*?)\}/);
if (botBlock
  && /background:\s*var\(--bot-bubble\)/.test(botBlock[1])
  && /border-top-left-radius:\s*8px/.test(botBlock[1])) {
  ok("assistant 气泡：var(--bot-bubble) + 左上 8px 尾角（朝头像）");
} else {
  bad("assistant tail", "bot-bubble or tail radius missing");
}

/* ---------- 4) 连续 assistant 分组 ---------- */
if (/\.msg\.assistant \+ \.msg\.assistant::before \{\s*visibility:\s*hidden\s*;?\s*\}/.test(html)) {
  ok("连续 assistant 行隐藏重复头像（相邻选择器）");
} else {
  bad("grouping avatar", "consecutive assistant ::before not hidden");
}
if (/\.msg\.assistant \+ \.msg\.assistant \{\s*margin-top:\s*-6px\s*;?\s*\}/.test(html)) {
  ok("连续 assistant 行 margin-top 收紧（-6px）形成同一条对话流节奏");
} else {
  bad("grouping gap", "no tightener for consecutive assistants");
}

/* ---------- 5) M20 用户胶囊正则护栏 ---------- */
const m20 = /\.msg\.user \{[^}]*background:\s*var\(--user-bubble\)[^}]*border-radius:\s*18px/.test(html);
if (m20) ok("M20 用户胶囊正则仍匹配（本波未破历史验收）");
else bad("M20 regression", "user pill regex broken by M42");

/* ---------- 6) 负向对照：抹掉 max-width ---------- */
const broken = html.replace("max-width: var(--content-max);", "/* no width */");
if (!/#log \{[^}]*max-width:\s*var\(--content-max\)/.test(broken)) {
  ok("负向对照：抹掉 #log max-width → 居中列断言翻假（非恒真）");
} else {
  bad("negative control", "max-width survived strip");
}

console.log("\nprove_m42_stream: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
