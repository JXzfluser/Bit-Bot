#!/usr/bin/env node
"use strict";

/**
 * prove_m38_copy — Wave M38「复制按钮 + 悬浮工具条 + welcome 品牌渐变」
 * （2026-11 Grok parity 迭代后形状断言已翻转：白底药丸 → ghost 图标条）
 *
 * 静态层：
 *   1) attachMessageActions 里在 Reply / React 之后加 Copy 按钮；
 *      - 图标化：四个按钮走 iconActionBtn（↩ 😊 ⧉ ↺），文字进 title
 *        （dataset.i18nTitle 走 i18n 静态扫描）；
 *      - makeCopyActionBtn：navigator.clipboard.writeText 优先；
 *        不可用时回退 textarea + execCommand("copy")；失败静默、不 throw；
 *   2) 三语文案 copyAction / copyDone / copyFailed 齐备（title/反馈消费）；
 *   3) ghost 条形状（ui_chrome.css）：assistant 操作条容器透明 + 无 blur，
 *      且被 grid 放到气泡右侧（grid-column: 2）——旧「pill + backdrop-filter」
 *      断言已删：它在给已退场的形状背书（MC-10 同款教训）；
 *   4) 群消息 copy-only 条：attachRoomCopyAction 挂在群用户消息与群 Bot
 *      回复上（无 mid，不冒领回复/反应/重新生成），与 DM 共用复制工厂；
 *   5) welcome .w-brand 使用渐变（linear-gradient + background-clip: text）。
 *
 * 负向对照：
 *   a) 抹掉 bar.appendChild(cp) → Copy 按钮装配断言翻假；
 *   b) 抹掉 ui_chrome 的 grid-column: 2 → ghost 位置断言翻假。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("M38 copy / hover-bar / welcome proof");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* 从 start 附近的大括号开始配平，取出整个对象字面量。
   跳过字符串里的 { }（字典里全是 "{n}" 这类占位符，不跳就会提前收尾）。 */
function sliceObject(src, start) {
  const open = src.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  let quote = "";
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

/* ---------- 1) attachMessageActions 图标化 + Copy 工厂 ---------- */
const fn = html.match(/function\s+attachMessageActions[\s\S]{0,8000}?\n\s{4}\}/);
if (fn
  && /const\s+cp\s*=\s*makeCopyActionBtn\(String\(text \|\| ""\)\)/.test(fn[0])
  && /bar\.appendChild\(cp\)/.test(fn[0])
  && /iconActionBtn\("↩",\s*"replyAction"\)/.test(fn[0])
  && /iconActionBtn\("😊",\s*"reactAction"\)/.test(fn[0])
  && /iconActionBtn\("↺",\s*"regenerateAction"\)/.test(fn[0])) {
  ok("attachMessageActions：↩/😊/⧉/↺ ghost 图标条，Copy 走 makeCopyActionBtn 工厂");
} else {
  bad("copy button wiring", "not present or missing icon buttons");
}
{
  const mkb = html.match(/function\s+makeCopyActionBtn[\s\S]{0,3000}?\n\s{4}\}/);
  const iab = html.match(/function\s+iconActionBtn[\s\S]{0,1200}?\n\s{4}\}/);
  if (mkb && iab
    && /dataset\.i18nTitle\s*=\s*i18nKey/.test(iab[0])
    && /navigator\.clipboard\s*&&\s*navigator\.clipboard\.writeText/.test(mkb[0])
    && /document\.execCommand\("copy"\)/.test(mkb[0])
    && /copyDone/.test(mkb[0]) && /copyFailed/.test(mkb[0])) {
    ok("makeCopyActionBtn：clipboard 有 execCommand 回退，title 走 i18n（copyDone/copyFailed 反馈可达）");
  } else {
    bad("copy factory", "missing fallback or i18n title wiring");
  }
}

/* ---------- 2) 三语 copy* keys ---------- */
for (const sec of ["zh-CN", "zh-TW"]) {
  const zStart = html.indexOf('"' + sec + '": {');
  if (zStart < 0) { bad("i18n slice " + sec, "section marker not found"); continue; }
  const nextMarker = sec === "zh-CN" ? '"zh-TW": {' : "\n      en: {";
  const zEnd = html.indexOf(nextMarker, zStart + 5);
  const seg = html.slice(zStart, zEnd);
  if (/copyAction:/.test(seg) && /copyDone:/.test(seg) && /copyFailed:/.test(seg)) {
    ok("i18n " + sec + "：copyAction / copyDone / copyFailed 齐备");
  } else {
    bad("i18n " + sec + " copy keys", "missing");
  }
}
{
  const ztStart = html.indexOf('"zh-TW": {');
  const enStart = html.indexOf("\n      en: {", ztStart);
  /* 原来这里是 `slice(enStart, enStart + 30000)` —— 一个写死的窗口。字典每加几
     个键就往后推，窗口一旦够不着 copyAction，断言就变成假红（实测：加完
     mcAppTitle / mcAppNote 之后 en 段涨到 30947 字符，正好越过 30k）。
     改成按大括号配平取出整个 en 对象：窗口不再随内容增长而失效。 */
  const enSeg = sliceObject(html, enStart);
  if (/copyAction:\s*"Copy"/.test(enSeg)
    && /copyDone:\s*"Copied"/.test(enSeg)
    && /copyFailed:\s*"Copy failed"/.test(enSeg)) {
    ok("i18n en：Copy / Copied / Copy failed 齐备");
  } else {
    bad("i18n en copy keys", "missing");
  }
}

/* ---------- 3) ghost 条形状（ui_chrome.css）----------
   旧断言是「pill 容器 + backdrop-filter」——它检查的 index.html 基础规则在
   grok-ui 下早已被覆盖成透明，断言在给一个用户看不见的形状背书。翻转成
   检查真正生效的 ghost 覆盖 + grid 位置。 */
const chromeCss = fs.readFileSync(path.join(REPO, "hosts/desktop/ui_chrome.css"), "utf8");
{
  const ghost = chromeCss.match(/body\.grok-ui \.msg\.assistant \.msg-actions\s*\{[^}]*\}/);
  const grid = chromeCss.match(/body\.grok-ui \.msg\.assistant:not\([^)]*\)(?:[^{}]*:not\([^)]*\))*\s*>\s*\.msg-actions\s*\{[^}]*\}/);
  if (ghost
    && /background:\s*transparent/.test(ghost[0])
    && /backdrop-filter:\s*none/.test(ghost[0])
    && /position:\s*static/.test(ghost[0])) {
    ok("msg-actions：ghost 容器（assistant 透明、无 blur、static 脱离悬浮）");
  } else {
    bad("ghost bar", "assistant actions not ghosted in ui_chrome.css");
  }
  if (grid && /grid-column:\s*2/.test(grid[0]) && /align-self:\s*end/.test(grid[0])) {
    ok("msg-actions：grid-column: 2 + align-self: end（气泡右侧、底部对齐）");
  } else {
    bad("ghost bar placement", "not placed beside bubble via grid");
  }
}

/* ---------- 4) 群消息 copy-only 条 ---------- */
{
  const fac = html.match(/function\s+attachRoomCopyAction[\s\S]{0,1200}?\n\s{4}\}/);
  const ru = html.match(/function\s+renderRoomUser[\s\S]{0,4000}?\n\s{4}\}/);
  const rb = html.match(/function\s+renderRoomBotReply[\s\S]{0,4000}?\n\s{4}\}/);
  if (fac && /makeCopyActionBtn/.test(fac[0]) && /"msg-actions"/.test(fac[0])
    && ru && /attachRoomCopyAction\(el,\s*String\(e\.text \|\| ""\)\)/.test(ru[0])
    && rb && /if\s*\(!isError\)\s*attachRoomCopyAction\(el,\s*full\)/.test(rb[0])) {
    ok("attachRoomCopyAction：群用户消息 + 群 Bot 回复挂 copy-only ghost 条（失败卡不挂）");
  } else {
    bad("room copy-only bar", "not wired on both room paths");
  }
}

/* ---------- 5) welcome brand gradient ---------- */
if (/#welcome\s+\.w-brand\s*\{[^}]*background:\s*linear-gradient\([^}]*\)[^}]*background-clip:\s*text/.test(html)) {
  ok("welcome .w-brand：linear-gradient + background-clip: text，与 Grok 品牌字重呼应");
} else {
  bad("welcome brand", "no gradient text treatment");
}

/* ---------- 6) 负向对照 ---------- */
const broken = html.replace("bar.appendChild(cp);", "/* removed */");
const survived = /function\s+attachMessageActions[\s\S]{0,3000}bar\.appendChild\(cp\)/.test(broken);
if (!survived) ok("负向对照 a：抹掉 bar.appendChild(cp) → Copy 装配断言翻假（非恒真）");
else bad("negative control a", "call survived strip");
{
  const brokenCss = chromeCss.replace("grid-column: 2;", "/* removed */");
  const ghostGone = brokenCss.match(/body\.grok-ui \.msg\.assistant:not\([^)]*\)(?:[^{}]*:not\([^)]*\))*\s*>\s*\.msg-actions\s*\{[^}]*\}/);
  const stillClaims = ghostGone && /grid-column:\s*2/.test(ghostGone[0]);
  if (!stillClaims) ok("负向对照 b：抹掉 grid-column: 2 → ghost 位置断言翻假（非恒真）");
  else bad("negative control b", "placement claim survived strip");
}

console.log("\nprove_m38_copy: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
