#!/usr/bin/env node
"use strict";

/**
 * prove_m41_cn — Wave M41「收尾中英混排：动态 meta 标签 + 内部枚举外泄」
 *
 * 目标：扫描清单 m37-scan.md 里 M37 batch 1/2 未覆盖的"低频可见英文"，
 *      收掉 4 条动态 meta 前缀与 1 条内部枚举外泄；不破坏既有 i18n。
 *
 * 断言：
 *   1) chMeta 前缀 workflows · → 工作流 ·
 *   2) boxMeta 前缀 env · → 运行环境 ·
 *   3) webhook meta 前缀 copied → 已复制
 *   4) dmeta 前缀 last: → 最近：
 *   5) cloud-meta 默认值 local_worker · → 本地代理 ·（内部枚举不外泄）
 *   6) 排除项仍保留：ADR 0002 / ICS / example.com 属技术引用，不强译
 *   7) 负向对照：把 workflows · 塞回 → 第 1 条翻假
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M41 CN residual cleanup proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* ---------- 1) channels meta ---------- */
if (/chMeta\.textContent = "工作流 · " \+ \(p\.count \|\| 0\)/.test(html)) {
  ok("channels-meta 前缀本地化：workflows · → 工作流 ·");
} else { bad("channels meta", "still 'workflows ·'"); }

/* ---------- 2) box meta ---------- */
if (/boxMeta\.textContent = "运行环境 · " \+ \(p\.runtime \|\| "\?"\)/.test(html)) {
  ok("box-meta 前缀本地化：env · → 运行环境 ·");
} else { bad("box meta", "still 'env ·'"); }

/* ---------- 3) webhook copied ---------- */
if (/meta\.textContent = "已复制 " \+ \(p\.what \|\| ""\)/.test(html)) {
  ok("webhook meta 前缀本地化：copied → 已复制");
} else { bad("webhook copied", "still English"); }

/* ---------- 4) delivery last ---------- */
if (/dmeta\.textContent = "最近： " \+ \[\.\.\.new Set\(types\)\]\.join/.test(html)) {
  ok("delivery meta 前缀本地化：last: → 最近：");
} else { bad("delivery last", "still 'last:'"); }

/* ---------- 5) cloud-meta enum leak ---------- */
if (/<div class="meta" id="cloud-meta">本地代理 · 交付产物<\/div>/.test(html)) {
  ok("cloud-meta 默认值不再外泄内部枚举 local_worker");
} else { bad("cloud-meta", "still local_worker leak"); }

/* ---------- 6) 保留技术引用（不硬译） ---------- */
if (/ADR 0002/.test(html) && /\bICS\b/.test(html)) {
  ok("技术引用保留：ADR 0002 / ICS（文件规范名，不强译，符合扫描排除规则）");
} else { bad("technical refs", "unexpectedly translated"); }

/* ---------- 7) 负向对照 ---------- */
const broken = html.replace("chMeta.textContent = \"工作流 · \"", "chMeta.textContent = \"workflows · \"");
if (!/chMeta\.textContent = "工作流 · "/.test(broken)) {
  ok("负向对照：塞回 workflows · → 本地化断言翻假（非恒真）");
} else { bad("negative control", "assertion still holds after revert"); }

console.log("\nprove_m41_cn: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
