#!/usr/bin/env node
"use strict";

/**
 * prove_m38_copy — Wave M38「复制按钮 + 悬浮 pill 工具条 + welcome 品牌渐变」
 *
 * 静态层：
 *   1) attachMessageActions 里在 Reply / React 之后加 Copy 按钮；
 *      - navigator.clipboard.writeText 优先；
 *      - 不可用时回退 textarea + execCommand("copy")；
 *      - 失败静默、不 throw（沙箱 & file:// 场景 clipboard API 可能拒）；
 *   2) 三语文案 copyAction / copyDone / copyFailed 齐备；
 *   3) msg-actions 视觉升级：pill 容器 + backdrop-filter，按钮去边框；
 *   4) welcome .w-brand 使用渐变（linear-gradient + background-clip: text）。
 *
 * 负向对照：抹掉 bar.appendChild(cp) → Copy 按钮装配断言翻假。
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

/* ---------- 1) attachMessageActions 加 Copy 按钮 ---------- */
const fn = html.match(/function\s+attachMessageActions[\s\S]{0,8000}?\n\s{4}\}/);
if (fn
  && /cp\.dataset\.i18n\s*=\s*"copyAction"/.test(fn[0])
  && /navigator\.clipboard\s*&&\s*navigator\.clipboard\.writeText/.test(fn[0])
  && /document\.execCommand\("copy"\)/.test(fn[0])
  && /bar\.appendChild\(cp\)/.test(fn[0])) {
  ok("attachMessageActions：Reply / React 后追加 Copy，clipboard 有 execCommand 回退");
} else {
  bad("copy button wiring", "not present or missing fallback");
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

/* ---------- 3) pill hover bar CSS ---------- */
if (/\.msg\s+\.msg-actions\s*\{[^}]*border-radius:\s*999px[^}]*\}/.test(html)
  && /\.msg\s+\.msg-actions\s*\{[^}]*backdrop-filter:\s*blur\(4px\)/.test(html)) {
  ok("msg-actions：pill 容器 + backdrop-filter blur(4px)");
} else {
  bad("pill bar", "not upgraded to rounded container");
}
if (/\.msg\s+\.msg-actions\s+button\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*\}/.test(html)) {
  ok("msg-actions button：无边框、透明底，hover 才上 accent-soft");
} else {
  bad("pill button", "still boxed style");
}

/* ---------- 4) welcome brand gradient ---------- */
if (/#welcome\s+\.w-brand\s*\{[^}]*background:\s*linear-gradient\([^}]*\)[^}]*background-clip:\s*text/.test(html)) {
  ok("welcome .w-brand：linear-gradient + background-clip: text，与 Grok 品牌字重呼应");
} else {
  bad("welcome brand", "no gradient text treatment");
}

/* ---------- 5) 负向对照 ---------- */
const broken = html.replace("bar.appendChild(cp);", "/* removed */");
const survived = /function\s+attachMessageActions[\s\S]{0,3000}bar\.appendChild\(cp\)/.test(broken);
if (!survived) ok("负向对照：抹掉 bar.appendChild(cp) → Copy 装配断言翻假（非恒真）");
else bad("negative control", "call survived strip");

console.log("\nprove_m38_copy: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
