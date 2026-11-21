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
 *
 * ⚠️ 2026-11-14(M46 · Copy contract 第一波)——判据跟着真源改了形状：
 *   原来 1–4 条断言的是**字面源码形状**
 *   （`chMeta.textContent = "工作流 · " + (p.count || 0)`）。
 *   M46 把这 29 处硬编码文案搬进了 `WAVEG_I18N` 字典、改走 `t()`，
 *   那条字面形状自然不再存在 —— **不是产品退化了，是尺子与真源脱钩**。
 *   （仓库里同样的事干过：`381f509 fix(gates): 两道门禁跟上重构后的真源`、
 *    `2756c32 fix(gate): A3-5 的附带损伤——两条旧尺子与产品脱钩`。）
 *
 *   现在的判据**比原来更强**：不只要求「源码里有中文字面量」，
 *   而是要求「这个前缀来自字典的 zh-CN 词条」——
 *   也就是说它同时被本地化断言覆盖，**而且还能翻译**（原来那版只钉了中文）。
 *   负向对照也改成非恒真：把**字典词条**塞回英文枚举，第 1 条必须翻假。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M41 CN residual cleanup proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* 取 zh-CN 字典里某个键的词条。 */
function zhValue(src, key) {
  const anchor = src.indexOf("const WAVEG_I18N");
  if (anchor < 0) return null;
  const m = /"zh-CN":\s*\{/.exec(src.slice(anchor));
  if (!m) return null;
  const re = new RegExp("(?:^|[\\s{,])" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', "m");
  const mm = re.exec(src.slice(anchor));
  return mm ? mm[1] : null;
}

/* 一条「前缀必须来自字典、且 zh-CN 词条是中文」的断言。
   usage: 该键的**使用点**正则 —— 渲染器里可以走 t("key")，
   静态 HTML 里可以走 data-i18n="key"（M46 第二波把静态文案也挂上了字典）。 */
function localizedByKey(src, key, expectZh, label, usageRe) {
  const used = usageRe.test(src);
  const val = zhValue(src, key);
  if (used && val === expectZh) {
    ok(label + "（取自字典 " + key + "，可翻译）");
    return true;
  }
  bad(label, used ? ("字典词条不是 " + JSON.stringify(expectZh) + "，实际 " + JSON.stringify(val)) : ("这个键没被用上 " + key));
  return false;
}

/* 渲染器里走 t()，静态 HTML 里走 data-i18n —— 两种都算「用上了」。 */
const usedInRenderer = (key) => new RegExp('t\\(\\s*"' + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"');
const usedInMarkup = (key) => new RegExp('data-i18n="\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '\\s*"');
const usedAnywhere = (key) => new RegExp('(t\\(\\s*"|data-i18n=")' + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"');

/* ---------- 1) channels meta ---------- */
localizedByKey(html, "workflowMetaCount", "工作流 · {{count}}",
  "channels-meta 前缀本地化：workflows · → 工作流 ·", usedInRenderer("workflowMetaCount"));

/* ---------- 2) box meta ---------- */
localizedByKey(html, "pluginMetaRuntime", "运行环境 · {{runtime}}",
  "box-meta 前缀本地化：env · → 运行环境 ·", usedInRenderer("pluginMetaRuntime"));

/* ---------- 3) webhook copied ---------- */
localizedByKey(html, "commonFeedbackCopied", "已复制 {{what}}",
  "webhook meta 前缀本地化：copied → 已复制", usedInRenderer("commonFeedbackCopied"));

/* ---------- 4) delivery last ---------- */
localizedByKey(html, "memoryMetaRecentTypes", "最近：{{types}}",
  "delivery meta 前缀本地化：last: → 最近：", usedInRenderer("memoryMetaRecentTypes"));

/* ---------- 5) cloud-meta enum leak ---------- */
localizedByKey(html, "cloudMeta", "本地代理 · 交付产物",
  "cloud-meta 默认值不再外泄内部枚举 local_worker", usedAnywhere("cloudMeta"));

/* ---------- 6) 保留技术引用（不硬译） ---------- */
if (/ADR 0002/.test(html) && /\bICS\b/.test(html)) {
  ok("技术引用保留：ADR 0002 / ICS（文件规范名，不强译，符合扫描排除规则）");
} else { bad("technical refs", "unexpectedly translated"); }

/* ---------- 7) 负向对照：把字典词条塞回英文枚举 → 第 1 条必须翻假 ---------- */
const broken = html.replace(
  /workflowMetaCount:\s*"工作流 · \{\{count\}\}"/,
  'workflowMetaCount: "workflows · {{count}}"',
);
const brokenVal = zhValue(broken, "workflowMetaCount");
if (brokenVal === "workflows · {{count}}" && brokenVal !== "工作流 · {{count}}") {
  ok("负向对照：把字典词条塞回 workflows · → 本地化断言翻假（非恒真）");
} else { bad("negative control", "断言在退化后仍成立（恒真判据）"); }

console.log("\nprove_m41_cn: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
