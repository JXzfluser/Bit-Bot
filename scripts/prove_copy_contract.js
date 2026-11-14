#!/usr/bin/env node
"use strict";
/**
 * prove_copy_contract.js — Copy contract v1 的渲染门（CC-01..CC-08）
 *
 * 合同的原文口径（docs/design/desktop-target/copy-contract.md）：
 *   §1 「渲染器内 0 处绕过 t() 的可见文案硬编码」
 *   §1 「MUST 不存在「中文前缀 + 变量」的字符串加法拼句」
 *   §6.2 title / aria-label 走同一次扫描
 *   §2 三语键集合 MUST 完全一致
 *
 * 这个门钉八条：
 *   CC-01 渲染器里 0 处硬编码中文可见文案（textContent / innerHTML）
 *   CC-02 0 处「中文前缀 + 变量」拼句
 *   CC-03 三语字典键集合完全一致（zh-CN / zh-TW / en）
 *   CC-04 静态区每个中文 title / aria-label / placeholder 都挂了 data-i18n-*
 *   CC-05 **每个 data-i18n* 引用的键，三语都真的有词条**
 *          —— 少了词条，界面会直接显示键名（"railActionNewChat"），
 *             这是加属性时最容易踩的坑，必须有门
 *   CC-06 负向对照：注入一处硬编码中文 ⇒ CC-01 立刻翻红（判据不是恒绿）
 *   CC-07 本波动的渲染器站点全部走 t()，没有漏网的
 *   CC-08 字典里的中文词条不得为空串（空词条 = 界面空白，比没词条更难查）
 */
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const HTML = path.join(REPO, "hosts/desktop/index.html");
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const html = fs.readFileSync(HTML, "utf8");
const CJK = /[一-鿿]/;

/* ── 0. 一次扫描算出所有标签区间（属性值里可能有 '<' 和 '>'，不能靠 lastIndexOf） ── */
function tagSpans(src) {
  const spans = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    const nxt = src[lt + 1];
    if (!(nxt && /[a-zA-Z/!]/.test(nxt))) { i = lt + 1; continue; }
    let j = lt + 1, q = null, esc = false, end = -1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === ">") { end = j; break; }
    }
    if (end < 0) break;
    spans.push([lt, end + 1, src.slice(lt, end + 1)]);
    i = end + 1;
  }
  return spans;
}
function enclosingTag(spans, pos) {
  for (const s of spans) if (pos >= s[0] && pos < s[1]) return s[2];
  return "";
}

/* ── 1. 字典块：从 const WAVEG_I18N 起，取三个子对象 ───────────────────────── */
const DICT_ANCHOR = "const WAVEG_I18N";
const anchorAt = html.indexOf(DICT_ANCHOR);
if (anchorAt < 0) {
  bad("找到 WAVEG_I18N 字典");
  console.log(`prove_copy_contract: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(1);
}
const dictSrc = html.slice(anchorAt);
function dictBlock(lang) {
  const re = new RegExp("^\\s*\"?" + lang + "\"?:\\s*\\{", "m");
  const m = re.exec(dictSrc);
  if (!m) return null;
  let i = dictSrc.indexOf("{", m.index), depth = 0, q = null, esc = false, end = -1;
  for (let k = i; k < dictSrc.length; k++) {
    const c = dictSrc[k];
    if (q) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = k; break; } }
  }
  const body = dictSrc.slice(i + 1, end);
  const keys = new Set(), vals = {};
  for (const mm of body.matchAll(/(?:^|[\s{,])([A-Za-z_][\w]*)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    keys.add(mm[1]); vals[mm[1]] = mm[2];
  }
  return { keys, vals };
}
const zh = dictBlock("zh-CN"), tw = dictBlock("zh-TW"), en = dictBlock("en");

/* ── 2. 区域切分：静态区 / 渲染器区 ───────────────────────────────────────── */
const scriptAt = html.search(/<script\b/i);
const staticHtml = html.slice(0, scriptAt);
const renderer = html.slice(scriptAt);
const staticSpans = tagSpans(staticHtml);

/* ── CC-01 / CC-02 渲染器硬编码 ──────────────────────────────────────────── */
const hardText = [...renderer.matchAll(/(textContent|innerHTML)\s*=\s*"[^"]*([一-鿿]+)[^"]*"/g)];
if (hardText.length === 0) ok("CC-01 渲染器里 0 处硬编码中文可见文案（textContent / innerHTML）");
else bad("CC-01 渲染器里 0 处硬编码中文可见文案", hardText.slice(0, 5).map((m) => m[0].slice(0, 70)));

const concat = [...renderer.matchAll(/(textContent|innerHTML)\s*=\s*"[^"]*[一-鿿][^"]*"\s*\+/g)];
if (concat.length === 0) ok("CC-02 0 处「中文前缀 + 变量」拼句");
else bad("CC-02 0 处「中文前缀 + 变量」拼句", concat.slice(0, 5).map((m) => m[0].slice(0, 70)));

/* ── CC-03 三语键集合一致 ────────────────────────────────────────────────── */
if (!zh || !tw || !en) {
  bad("CC-03 三语字典块都在", `zh=${!!zh} tw=${!!tw} en=${!!en}`);
} else {
  const sets = [zh, tw, en].map((d) => [...d.keys].sort());
  const miss = sets[0].filter((k) => !sets[1].includes(k) || !sets[2].includes(k))
    .concat(sets[1].filter((k) => !sets[0].includes(k) || !sets[2].includes(k)))
    .concat(sets[2].filter((k) => !sets[0].includes(k) || !sets[1].includes(k)));
  if (!miss.length) ok(`CC-03 三语键集合完全一致（各 ${sets[0].length} 键）`);
  else bad("CC-03 三语键集合完全一致", miss.slice(0, 8).join(","));
}

/* ── CC-04 静态区中文属性必须挂 data-i18n-* ──────────────────────────────── */
const uncovered = [];
const attrRe = /(title|placeholder|aria-label)\s*=\s*"([^"]*)"/g;
let am;
while ((am = attrRe.exec(staticHtml))) {
  const attr = am[1], val = am[2];
  if (!CJK.test(val)) continue;
  const variant = attr === "title" ? "data-i18n-title" : attr === "placeholder" ? "data-i18n-ph" : "data-i18n-aria";
  const tag = enclosingTag(staticSpans, am.index);
  if (!tag || tag.startsWith("<style") || tag.startsWith("<script")) continue;
  if (!tag.includes(variant + "=")) uncovered.push(tag.slice(0, 90));
}
if (!uncovered.length) ok("CC-04 静态区每个中文 title / placeholder / aria-label 都挂了 data-i18n-*");
else bad("CC-04 静态区每个中文 title / placeholder / aria-label 都挂了 data-i18n-*", uncovered.slice(0, 4));

/* ── CC-05 每个 data-i18n* 引用的键三语都得有词条 ───────────────────────── */
const used = new Set();
for (const m of html.matchAll(/data-i18n(?:-ph|-aria|-title)?\s*=\s*"([^"]+)"/g)) used.add(m[1]);
const missing = [];
if (zh && tw && en) {
  for (const k of used) {
    if (!zh.keys.has(k) || !tw.keys.has(k) || !en.keys.has(k)) {
      missing.push(`${k}[${[!zh.keys.has(k) && "zh", !tw.keys.has(k) && "tw", !en.keys.has(k) && "en"].filter(Boolean).join("/")}]`);
    }
  }
}
if (!missing.length) ok(`CC-05 ${used.size} 个 data-i18n* 引用，三语词条齐全`);
else bad("CC-05 每个 data-i18n* 引用的键三语都得有词条", missing.slice(0, 8).join(" | "));

/* ── CC-06 负向对照：判据不是恒绿 ────────────────────────────────────────── */
{
  const m = /textContent\s*=\s*"[^"]*"/.exec(renderer);
  if (!m) {
    bad("CC-06 负向对照：渲染器里找不到 textContent 赋值点（判据可能恒绿）");
  } else {
    const mutated = renderer.slice(0, m.index) + 'textContent = "注入的硬编码中文"' + renderer.slice(m.index + m[0].length);
    const mutatedHard = [...mutated.matchAll(/(textContent|innerHTML)\s*=\s*"[^"]*([一-鿿]+)[^"]*"/g)];
    if (mutatedHard.length > hardText.length) ok("CC-06 负向对照：注入一处硬编码中文后 CC-01 翻红（判据不是恒绿）");
    else bad("CC-06 负向对照：注入一处硬编码中文后 CC-01 翻红", `注入后 ${mutatedHard.length} 条 / 原 ${hardText.length} 条`);
  }
}

/* ── CC-07 本波动的渲染器站点全部走 t() ─────────────────────────────────── */
const WANT = [
  "agentMetaProxy", "artifactActionOpenSystem", "securityHintPasswordLocalOnly",
  "agentActionOpenCloudProxy", "jobActionViewFullPrompt", "linkErrorUnreadable",
  "builderActionStart", "workflowMetaCount", "pluginMetaRuntime",
  "connectorMetaCallbackUrl", "commonFeedbackCopied", "memoryMetaRecentTypes",
  "settingsOtaChecking", "settingsOtaUpToDate", "settingsGateRunning",
  "computerUseMetaFrame", "computerUseMetaFramePolling", "groupStatusSubmitted",
  "groupStatusDiscarded", "groupEmptyHint", "groupFormNeedTwoBots",
  "groupFormHint", "groupStatusSent",
  "connectorMetaSecretOnly", "settingsMissingLlmKey", "settingsOtaHasUpdate",
  "settingsOtaError", "settingsGateError",
];
const notUsed = WANT.filter((k) => !new RegExp("t\\(\\s*\"" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\"").test(renderer));
if (!notUsed.length) ok(`CC-07 本波 ${WANT.length} 个渲染器键全部被 t() 用上`);
else bad(`CC-07 本波 ${WANT.length} 个渲染器键全部被 t() 用上`, notUsed.join(","));

/* ── CC-08 中文词条不得为空串 ───────────────────────────────────────────── */
const emptyZh = zh ? [...zh.keys].filter((k) => typeof zh.vals[k] === "string" && zh.vals[k].trim() === "") : [];
if (!emptyZh.length) ok("CC-08 字典里没有空词条");
else bad("CC-08 字典里没有空词条", emptyZh.slice(0, 8).join(","));

/* ── CC-09 en 词条不得含中文（合同 §5：「往字典塞 zh 文案冒充 en」是禁止的修法） ── */
const zhInEn = [];
if (en) {
  for (const k of en.keys) {
    const v = en.vals[k];
    if (typeof v === "string" && CJK.test(v)) zhInEn.push(`${k}=${v.slice(0, 24)}`);
  }
}
if (!zhInEn.length) ok("CC-09 en 词条里没有中文（没拿 zh 文案冒充 en）");
else bad("CC-09 en 词条里没有中文（没拿 zh 文案冒充 en）", zhInEn.slice(0, 6).join(" | "));

console.log(`prove_copy_contract: PASS=${PASS} FAIL=${FAIL}`);
if (FAIL) process.exit(1);
