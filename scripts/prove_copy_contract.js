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

/* ── CC-10 静态区:每段中文可见文本,都得落在挂了 data-i18n 的元素里 ──────────
 *
 * 合同 §1:「每个带文案的元素必须有 data-i18n/…，boot 时由语言扫描统一刷新
 * （en 界面下不得残留任何静态中文）」。
 *
 * 判据取**最内层**元素祖先,不是外层:<div>同一份 <code>.env.local</code>；…</div>
 * 这种带 <code>/<a> 的,直接给 div 挂 data-i18n 会 textContent 覆盖 —— 把子元素
 * 抹掉。正确做法是把文本包进 <span data-i18n>，那 span 才是最内层祖先。
 *
 * ⚠️ 这里**不能用**上面那个 tagSpans:它只记开标签的区间,不记元素的完整范围,
 * 文本节点几乎永远找不到祖先 ⇒ 判据恒绿（假绿）。所以另写一个带栈的元素解析。
 */
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "param", "source", "track", "wbr"]);
function parseElements(src) {
  const elems = [], stack = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    const nxt = src[lt + 1];
    if (nxt === "!") {
      // DOCTYPE 不是注释! 之前一律当注释处理,indexOf("-->") 会找到文件后面
      // 某个 '-->',把 DOCTYPE 到那儿整块吞掉 ⇒ 那一大段根本没被检查(静默失效)。
      if (!src.startsWith("<!--", lt)) {
        const e = src.indexOf(">", lt);
        i = e < 0 ? src.length : e + 1;
        continue;
      }
      // 注释不是可见文案 —— 记下区间,切文本片段时跳过
      const e = src.indexOf("-->", lt);
      const cend = e < 0 ? src.length : e + 3;
      (elems.comments || (elems.comments = [])).push([lt, cend]);
      i = cend; continue;
    }
    // style / script 是 raw-text 元素:里面的 '<' 不是标签。本文件的 CSS 注释里
    // 就有 "57 < composer 58 < modal" 这种写法,不跳的话元素树会整个错位
    // (真元素的闭合标签会配到假标签上,判据就空了)。
    const mraw = /^<(style|script)\b/i.exec(src.slice(lt, lt + 20));
    if (mraw) {
      // 必须 new RegExp 拼出来 —— 直接写在正则字面量里的 "%s" 永远不匹配,
      // 于是 <style> 会一路吞到文件末尾。
      const close = new RegExp("<\\/\\s*" + mraw[1] + "\\s*>", "i").exec(src.slice(lt));
      const cend = close ? lt + close.index + close[0].length : src.length;
      // 注意:要**向前**找 '>'。lastIndexOf 会抓到 <style> 之前那个 '>',
      // 标记区间会横跨整个 body ⇒ 后面的文本全被吞掉 ⇒ 判据静悄悄失效。
      const g = src.indexOf(">", lt);
      const raw = src.slice(lt, g < 0 ? cend : g + 1);
      const mt2 = /^<([A-Za-z][\w:-]*)/.exec(raw);
      if (mt2) {
        const el = { tag: mt2[1].toLowerCase(), raw, openStart: lt,
          openEnd: g < 0 ? cend : g + 1, contentStart: g < 0 ? cend : g + 1,
          contentEnd: cend, closeStart: cend - (close ? close[0].length : 0),
          closeEnd: cend };
        elems.push(el);
      }
      (elems.comments || (elems.comments = [])).push([lt, cend]);   // 内容不是可见文案
      i = cend; continue;
    }
    if (!(nxt && /[a-zA-Z/]/.test(nxt))) { i = lt + 1; continue; }
    let j = lt + 1, q = null, end = -1;
    for (; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === ">") { end = j; break; }
    }
    if (end < 0) break;
    const raw = src.slice(lt, end + 1);
    if (nxt === "/") {
      const mt = /^<\/\s*([A-Za-z][\w:-]*)/.exec(raw);
      if (mt) {
        const tag = mt[1].toLowerCase();
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tag === tag) {
            for (let z = k; z < stack.length; z++) {
              stack[z].contentEnd = lt;              // 内容结束于闭合标签之前
              stack[z].closeStart = lt;
              stack[z].closeEnd = end + 1;
            }
            stack.length = k;
            break;
          }
        }
      }
      i = end + 1; continue;
    }
    const mt = /^<([A-Za-z][\w:-]*)/.exec(raw);
    if (!mt) { i = end + 1; continue; }
    const tag = mt[1].toLowerCase();
    const selfClose = /\/\s*>$/.test(raw);
    const el = { tag, raw, openStart: lt, openEnd: end + 1, contentStart: end + 1,
      contentEnd: end + 1, closeStart: -1, closeEnd: -1 };
    elems.push(el);
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(el);
    i = end + 1;
  }
  return elems;
}
function staticTextWithoutI18n(src) {
  const elems = parseElements(src);
  /* 文本片段 = 标签之外的部分。**只按标签边界切** —— 不能用元素的
     [openEnd, contentEnd] 区间,否则外层元素会把内层的文本一起吞掉
     (那样内层文本根本切不出来,判据就空了)。 */
  const marks = [];
  for (const el of elems) {
    marks.push([el.openStart, el.openEnd]);
    if (el.closeStart >= 0) marks.push([el.closeStart, el.closeEnd]);
  }
  // 注释整段当一个 mark:它的内部就不会被切成文本片段
  for (const c of (elems.comments || [])) marks.push([c[0], c[1]]);
  marks.sort((a, b) => a[0] - b[0]);
  const segs = [];
  let cur = 0;
  for (const [a, b] of marks) {
    if (a > cur) segs.push([cur, a, src.slice(cur, a)]);
    cur = Math.max(cur, b);
  }
  if (cur < src.length) segs.push([cur, src.length, src.slice(cur)]);
  const comments = elems.comments || [];
  const leaks = [];
  for (const [a, b, seg] of segs) {
    if (!seg.trim() || !CJK.test(seg)) continue;
    if (comments.some((c) => a >= c[0] && a < c[1])) continue;   // 注释不是可见文案
    // 最内层祖先 = openStart 最大的那个包含它的元素
    let host = null;
    for (const el of elems) {
      if (el.openStart < a && a < el.contentEnd) {
        if (!host || el.openStart > host.openStart) host = el;
      }
    }
    if (!host) continue;
    if (host.tag === "title") continue;            // document.title 走 appTitle，单独判
    if (/(^|\s)data-i18n\s*=/.test(host.raw)) continue;
    leaks.push(`${host.raw.slice(0, 42).replace(/\s+/g, " ")} ← ${seg.trim().slice(0, 24)}`);
  }
  return leaks;
}
/* 合同 §4 的豁免:allowlist 内条目(逐项:text + where + reason)。
   「语言下拉显示母语名」就是典型 —— 用户可能读不懂当前界面语言,
   得能按自己的母语认出那一项,所以那两个字**必须保持原样**。 */
let ALLOW = new Set();
try {
  const alPath = path.join(REPO, "docs/design/desktop-target/i18n-allowlist.json");
  for (const it of JSON.parse(fs.readFileSync(alPath, "utf8"))) {
    if (it && typeof it.text === "string") ALLOW.add(it.text.trim());
  }
} catch (e) { /* 没有 allowlist 就当没有豁免 */ }

const staticLeaks = staticTextWithoutI18n(staticHtml).filter((x) => {
  const t = (x.split("←")[1] || "").trim();
  return !ALLOW.has(t);
});
if (!staticLeaks.length) ok(`CC-10 静态区每段中文可见文本都挂在 data-i18n 的元素里（allowlist 豁免 ${ALLOW.size} 条）`);
else bad("CC-10 静态区每段中文可见文本都挂在 data-i18n 的元素里", staticLeaks.slice(0, 6).join(" | "));

/* ── CC-11 负向对照:摘掉一个 data-i18n ⇒ CC-10 必须翻红(判据不是恒绿) ── */
/* 注意:样本的正则**不能**把闭合标签的 '<' 一起吃掉 —— 否则替换后 HTML 畸形,
   判据会因「解析不出来」而假绿。用前瞻只取到闭合标签之前。 */
/* 样本要挑一个**不在 allowlist 里**的,否则摘掉属性也不会翻红(豁免把它盖住了)。 */
let mCjk = null;
for (const cand of staticHtml.matchAll(/<[^>]*data-i18n="[^"]*"[^>]*>([^<]*[一-鿿][^<]*)(?=<)/g)) {
  if (!ALLOW.has(cand[1].trim())) { mCjk = cand; break; }
}
if (mCjk) {
  const brokenStatic = staticHtml.replace(mCjk[0], mCjk[0].replace(/\s*data-i18n="[^"]*"/, ""));
  const brokenLeaks = staticTextWithoutI18n(brokenStatic).filter((x) => {
    const t = (x.split("←")[1] || "").trim();
    return !ALLOW.has(t);
  });
  if (brokenLeaks.length > staticLeaks.length) {
    ok("CC-11 负向对照：摘掉一个 data-i18n ⇒ CC-10 翻红（判据不是恒绿）");
  } else {
    bad("CC-11 负向对照：摘掉一个 data-i18n ⇒ CC-10 翻红（判据不是恒绿）", "退化后没翻红");
  }
} else {
  bad("CC-11 负向对照：摘掉一个 data-i18n ⇒ CC-10 翻红（判据不是恒绿）", "没找到可摘的样本");
}

/* ── CC-12 文档标题也走字典（合同 §4 的扫描口径含 title） ──────────────────── */
const appTitleZh = zh ? zh.vals["appTitle"] : null;
const appTitleEn = en ? en.vals["appTitle"] : null;
if (appTitleZh && appTitleEn && /document\.title\s*=\s*wavegT\(\s*"appTitle"\s*\)/.test(renderer)
    && !CJK.test(appTitleEn)) {
  ok("CC-12 文档标题走字典（appTitle），en 标题里没有汉字");
} else {
  bad("CC-12 文档标题走字典（appTitle），en 标题里没有汉字",
    `zh=${JSON.stringify(appTitleZh)} en=${JSON.stringify(appTitleEn)}`);
}

/* ── CC-13 带中文的 label:/hint: 必须配 labelKey:/hintKey ─────────────────
   这些字段所在的 const 是**脚本求值期**建的(LLM_PRESETS / CN_CHANNEL_ROWS),
   在那儿直接调 t() 会撞 TDZ —— 所以字面量留作 zh-CN 种子,另配一个键,
   消费点再翻译。
   少了 labelKey/hintKey ⇒ 英文界面会直接露出中文 ⇒ 必须有门。 */
const zhLabelHits = [...renderer.matchAll(/\b(label|hint)\s*:\s*"((?:[^"\\]|\\.)*[一-鿿](?:[^"\\]|\\.)*)"/g)];
const zhLabelNoKey = [];
for (const m of zhLabelHits) {
  const tail = renderer.slice(m.index, m.index + 420);
  const kind = m[1];
  const keyRe = new RegExp("\\b" + kind + "Key\\s*:");
  if (!keyRe.test(tail)) zhLabelNoKey.push(`${kind}: ${m[2].slice(0, 24)}`);
}
if (!zhLabelNoKey.length) ok(`CC-13 带中文的 label:/hint: 都配了对应的 labelKey:/hintKey:（${zhLabelHits.length} 处）`);
else bad("CC-13 带中文的 label:/hint: 都配了对应的 labelKey:/hintKey:", zhLabelNoKey.slice(0, 6).join(" | "));

console.log(`prove_copy_contract: PASS=${PASS} FAIL=${FAIL}`);
if (FAIL) process.exit(1);
