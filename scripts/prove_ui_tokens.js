#!/usr/bin/env node
"use strict";

/**
 * prove_ui_tokens — 桌面 UI 单一源/去混乱门禁（ratchet）
 *
 * 目的：把 docs/design/desktop-target/ui-unified-spec.md 的规范钉成
 * “过不去就合不了”。基线是当前实测数字（高水位），随技术债收敛**只许下降**；
 * 任何让计数上涨的改动直接 FAIL。这是源码级正则 lint（LINT ONLY，target-v1.md §5），
 * 不替代 e2e_* 真实渲染门。
 *
 * 检查：
 *   T-1  ui_chrome.css `!important` 计数 ≤ 基线（唯一豁免 [hidden]{display:none!important}）
 *   T-2  原始色值（十六进制）计数 css+html ≤ 基线（token 定义块是唯一色值源，靠基线锁总量）
 *   T-3  index.html 行内 `style="…font-size` 计数 ≤ 基线（收敛目标 0）
 *   T-4  ui_chrome.css `[style*=` 属性反选补丁 ≤ 基线（收敛目标 0）
 *   T-5  几何单一源：`--sidebar-w` / `--header-h` 各只定义一次，且等于
 *        layout-contract §3 合同值 280px / 56px（钉死，禁止 body.grok-ui 248/0 复发）
 *
 * 用法：node scripts/prove_ui_tokens.js
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const CSS = path.join(REPO, "hosts/desktop/ui_chrome.css");
const HTML = path.join(REPO, "hosts/desktop/index.html");

/* ---- 高水位基线（收敛后请下调这些数字，禁止上调）---- */
const BASE = {
  cssImportant: 409,
  cssHex: 141,
  htmlHex: 28,
  htmlInlineFont: 25,
  cssAttrPatch: 5,
};

/* ---- 合同几何真值（与 layout-contract §3 对齐）---- */
const CONTRACT = { sidebarW: "280px", headerH: "56px" };

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

console.log("prove_ui_tokens — 桌面 UI 单一源 / 去混乱门禁 (LINT ONLY)");

const css = fs.readFileSync(CSS, "utf8");
const html = fs.readFileSync(HTML, "utf8");
/* strip /* … * / comments so prose (e.g. geometry notes) never trips regexes */
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");

const count = (s, re) => (s.match(re) || []).length;

/* ---------- T-1  !important ratchet ---------- */
{
  const n = count(cssCode, /!important/g);
  const hiddenOk = /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(cssCode);
  if (n <= BASE.cssImportant) ok(`T-1 !important ${n} ≤ 基线 ${BASE.cssImportant}（只许降）`);
  else bad(`T-1 !important ${n} > 基线 ${BASE.cssImportant}`, "新增了 !important，须改为挂基类正常样式");
  if (hiddenOk) ok("T-1b [hidden]{display:none!important} 豁免在位");
  else bad("T-1b [hidden] 兜底缺失", "layout-contract/ M37 依赖此兜底");
}

/* ---------- T-2  原始色值总量 ratchet ---------- */
{
  const cn = count(cssCode, /#[0-9a-fA-F]{3,8}\b/g);
  const hn = count(html, /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
  if (cn <= BASE.cssHex) ok(`T-2 css hex ${cn} ≤ 基线 ${BASE.cssHex}`);
  else bad(`T-2 css hex ${cn} > 基线 ${BASE.cssHex}`, "新增硬编码色值，须走 var(--token)");
  if (hn <= BASE.htmlHex) ok(`T-2 html hex ${hn} ≤ 基线 ${BASE.htmlHex}`);
  else bad(`T-2 html hex ${hn} > 基线 ${BASE.htmlHex}`, "内联/内联样式新增原始色值");
}

/* ---------- T-3  行内 font-size ratchet ---------- */
{
  const n = count(html, /style="[^"]*font-size/g);
  if (n <= BASE.htmlInlineFont) ok(`T-3 行内 font-size ${n} ≤ 基线 ${BASE.htmlInlineFont}`);
  else bad(`T-3 行内 font-size ${n} > 基线 ${BASE.htmlInlineFont}`, "字号须走类型阶 class，不写行内");
}

/* ---------- T-4  [style*=] 属性反选补丁 ratchet ---------- */
{
  const n = count(cssCode, /\[style\*=/g);
  if (n <= BASE.cssAttrPatch) ok(`T-4 [style*=] 补丁 ${n} ≤ 基线 ${BASE.cssAttrPatch}`);
  else bad(`T-4 [style*=] 补丁 ${n} > 基线 ${BASE.cssAttrPatch}`, "禁止用属性反选打补丁，须删内联 style 改基类");
}

/* ---------- T-5  几何单一源 + 合同真值 ---------- */
{
  const sb = cssCode.match(/--sidebar-w:\s*([^;]+);/g) || [];
  const hd = cssCode.match(/--header-h:\s*([^;]+);/g) || [];
  const oneVal = (arr) => arr.length === 1;
  const sbVal = sb[0] && sb[0].replace(/.*--sidebar-w:\s*/, "").replace(/;$/, "").trim();
  const hdVal = hd[0] && hd[0].replace(/.*--header-h:\s*/, "").replace(/;$/, "").trim();
  if (oneVal(sb) && sbVal === CONTRACT.sidebarW) ok(`T-5 --sidebar-w 单一源=${sbVal}（合同 ${CONTRACT.sidebarW}）`);
  else bad(`T-5 --sidebar-w 非单一源/偏离合同`, `defs=${sb.length} [${sb.join(" | ")}]`);
  if (oneVal(hd) && hdVal === CONTRACT.headerH) ok(`T-5 --header-h 单一源=${hdVal}（合同 ${CONTRACT.headerH}）`);
  else bad(`T-5 --header-h 非单一源/偏离合同`, `defs=${hd.length} [${hd.join(" | ")}]`);
  // 显式拦截 248 / 0 复发
  if (/--sidebar-w:\s*248px/.test(cssCode)) bad("T-5b 检测到 --sidebar-w:248px 复发", "grok-ui 旧覆盖不得回归");
  if (/--header-h:\s*0px/.test(cssCode)) bad("T-5b 检测到 --header-h:0px 复发", "grok-ui 旧覆盖不得回归");
}

console.log(`\nprove_ui_tokens: PASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
