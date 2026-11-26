#!/usr/bin/env node
"use strict";

/**
 * prove_design_language — 「好看」这件事也得上门禁（批次 13）
 *
 * 背景：项目的 CSS 其实**有**完整的 scale（--space-1..9 / --radius-* / --text-*），
 * 但代码**绕过它**：
 *   · 行内样式 149 处（其中一堆随手写的 font-size / 颜色）
 *   · padding 写了 7px / 9px / 14px / 20px —— 这些值**不在任何 scale 里**
 *   · border-radius 手写 9px / 10px（不在 scale 里）
 *   · 组件自造颜色 token（--g-card / --lightbox-btn / …）⇒ 每个功能长得不一样
 *   · emoji 当图标用（👍 🖼 📷 📎 🎧）
 * ⇒ 这就是「堆了功能反而看着很丑、很 AI 味」的**可量化根因**：
 *   名义上有设计系统，实际上每个功能各写各的。
 *
 * 这个门禁守住四条：
 *   R1 不许行内样式（只允许 CSS 变量赋值 / cursor:pointer）
 *   R2 不许硬编码颜色（必须走语义 token）
 *   R3 不许硬编码字号（必须走 --text-*）
 *   R4 不许硬编码间距（必须走 --space-*）
 *   R5 不许硬编码圆角（必须走 --radius-*）
 *   R6 不许 emoji 当图标（✓ ✗ 这类语义符号放行）
 *
 * 【为什么用债务台账而不是直接判死】
 * 直接判死 ⇒ 门禁一上来就红一片 ⇒ 没有人在乎它 ⇒ 白建。
 * ⇒ 现有违规登记进 scripts/design_debt.json（按「文件+规则+内容+出现次数」记指纹），
 *   台账里的**不判红**（存量慢慢还），**新增的判红**（增量必须干净）。
 *   指纹不含行号 ⇒ 改一行代码不会让台账整体失效。
 *
 * 【判据必须有牙】
 * 本门禁自带变异对照：故意注入一条违规 ⇒ 必须判红（连台账都绕不过去）。
 *
 * 用法：node scripts/prove_design_language.js
 *      node scripts/prove_design_language.js --refresh-debt   # 重新登记存量债务
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts", "desktop");
const DEBT_PATH = path.join(__dirname, "design_debt.json");

/* ── 合法值（来自 ui_chrome.css 里已有的 scale）─────────────────────────
 * 改 scale 时这里要跟着改 —— 但**只能加不能减**（减了会让存量代码突然变红）。 */
const SPACE_OK = new Set([0, 4, 6, 8, 10, 12, 14, 16, 18, 24]);
const RADIUS_OK = new Set([0, 4, 6, 8, 10, 12, 14, 18, 22, 999]);
const FONT_OK = new Set([10, 11, 12, 13, 14, 15, 16, 32]);

/* ── 扫描目标 ─────────────────────────────────────────────────────── */
const TARGETS = [
  { file: path.join(DESKTOP, "index.html"), kind: "html" },
  { file: path.join(DESKTOP, "ui_chrome.css"), kind: "css" },
];

/* 行内样式的白名单：只允许 CSS 变量赋值（--av: 颜色）—— 它是运行时才有的值。 */
const INLINE_ALLOW = /^(?:\s*--[a-z0-9-]+\s*:[^;]+;?)+$/i;
const INLINE_ALLOW_CURSOR = /^(?:\s*--[a-z0-9-]+\s*:[^;]+;?\s*)*\s*cursor\s*:\s*pointer\s*;?$/i;

/* emoji（pictographic）检测区间 —— ✓ ✗ 这类不在范围内。 */
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
/* 明确放行的语义符号（这些不是"emoji 当图标"，是符号）。 */
const SYMBOL_OK = new Set(["✓", "✗", "×", "→", "←", "↑", "↓", "•", "·", "—", "…"]);

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

/** 指纹：文件相对路径 + 规则 + 归一化内容。**不含行号** —— 改代码不该让台账整体失效。 */
function fingerprint(rel, rule, content) {
  const norm = String(content).replace(/\s+/g, " ").trim();
  return rel + "|" + rule + "|" + norm;
}

/** 剥掉注释 —— 注释里写「不要写 margin:-1px」不该被判成违规。
    （实测踩到：门禁把 CSS 注释里的示例值也扫进去了 ⇒ 假阳性。） */
function stripComments(src, kind) {
  if (kind === "css") return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}

/** 收集一个文件里的违规。 */
function collect(fileInfo, debt) {
  const src = stripComments(fs.readFileSync(fileInfo.file, "utf8"), fileInfo.kind);
  const rel = path.relative(REPO, fileInfo.file);
  const hits = [];
  const lines = src.split("\n");

  const push = (rule, content, lineNo) => {
    const fp = fingerprint(rel, rule, content);
    hits.push({ rule, content: String(content).replace(/\s+/g, " ").trim(), fp, line: lineNo, rel });
  };

  lines.forEach((line, i) => {
    const ln = i + 1;
    const isHtml = fileInfo.kind === "html";

    /* ── R1 行内样式 ── */
    if (isHtml) {
      const re = /style="([^"]*)"/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const v = String(m[1] || "").trim();
        if (!v) continue;
        if (INLINE_ALLOW.test(v) || INLINE_ALLOW_CURSOR.test(v)) continue;
        push("R1-inline-style", v, ln);
      }
    }

    /* ── R2 硬编码颜色 ── */
    const colorRe = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g;
    let cm;
    while ((cm = colorRe.exec(line)) !== null) {
      /* var(--x) 里的内容不算；这里匹配的是裸色值。 */
      push("R2-hardcoded-color", cm[0], ln);
    }

    /* ── R3 硬编码字号 ── */
    const fsRe = /font-size\s*:\s*(\d+(?:\.\d+)?)px/g;
    let fm;
    while ((fm = fsRe.exec(line)) !== null) {
      const v = Math.round(Number(fm[1]));
      if (!FONT_OK.has(v)) push("R3-hardcoded-font-size", fm[0], ln);
    }

    /* ── R4 硬编码间距 ── */
    const spRe = /(?:^|[;{\s])(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?\s*:\s*([^;]+)/g;
    let sm;
    while ((sm = spRe.exec(line)) !== null) {
      const decl = sm[0].trim();
      /* 已经是 var(--space-*) 的跳过。 */
      if (/var\(--space-/.test(decl)) continue;
      const pxRe = /(\d+(?:\.\d+)?)px/g;
      let pm;
      while ((pm = pxRe.exec(sm[3])) !== null) {
        const v = Math.round(Number(pm[1]));
        if (!SPACE_OK.has(v)) push("R4-hardcoded-space", decl, ln);
      }
    }

    /* ── R5 硬编码圆角 ── */
    const brRe = /border-radius\s*:\s*([^;]+)/g;
    let bm;
    while ((bm = brRe.exec(line)) !== null) {
      const decl = bm[0].trim();
      if (/var\(--radius-/.test(decl)) continue;
      const pxRe = /(\d+(?:\.\d+)?)px/g;
      let pm;
      while ((pm = pxRe.exec(bm[1])) !== null) {
        const v = Math.round(Number(pm[1]));
        if (!RADIUS_OK.has(v)) push("R5-hardcoded-radius", decl, ln);
      }
    }
  });

  /* ── R6 emoji 当图标 ── */
  lines.forEach((line, i) => {
    const ln = i + 1;
    for (const ch of line) {
      if (!EMOJI_RE.test(ch)) continue;
      if (SYMBOL_OK.has(ch)) continue;
      push("R6-emoji-icon", ch, ln);
      break; /* 同一行只报一次，够定位了 */
    }
  });

  return hits;
}

/** 台账里的指纹集合。 */
function loadDebt() {
  if (!fs.existsSync(DEBT_PATH)) return { entries: [] };
  try {
    const j = JSON.parse(fs.readFileSync(DEBT_PATH, "utf8"));
    return { entries: Array.isArray(j.entries) ? j.entries : [] };
  } catch (_) {
    return { entries: [] };
  }
}

function main() {
  const refresh = process.argv.includes("--refresh-debt");
  console.log("prove_design_language — 设计语言门禁（增量）");

  const debt = loadDebt();
  const debtMap = new Map();
  for (const e of debt.entries) debtMap.set(e.fp, e);

  const allHits = [];
  for (const t of TARGETS) {
    if (!fs.existsSync(t.file)) continue;
    for (const h of collect(t, debtMap)) allHits.push(h);
  }

  /* 按指纹聚合计数 —— 台账记的是「出现次数」。 */
  const byFp = new Map();
  for (const h of allHits) {
    if (!byFp.has(h.fp)) byFp.set(h.fp, { ...h, count: 0 });
    byFp.get(h.fp).count += 1;
  }

  /* 新增违规 = 台账里没有，或次数超过台账登记的次数。 */
  const fresh = [];
  const known = [];
  for (const [fp, h] of byFp) {
    const d = debtMap.get(fp);
    if (d && Number(d.count || 0) >= h.count) known.push(h);
    else fresh.push(h);
  }

  const byRule = {};
  for (const h of fresh) byRule[h.rule] = (byRule[h.rule] || 0) + 1;

  if (refresh) {
    const entries = [];
    for (const [fp, h] of byFp) {
      entries.push({
        fp,
        rule: h.rule,
        file: h.rel,
        content: h.content,
        count: h.count,
        note: "存量违规；还掉一条就从台账里删一条（ratchet）",
      });
    }
    entries.sort((a, b) => (a.fp < b.fp ? -1 : 1));
    fs.writeFileSync(
      DEBT_PATH,
      JSON.stringify(
        {
          说明:
            "设计语言债务台账：存量违规的指纹与出现次数。" +
            "台账里的不判红；新增的（指纹没有、或次数超标）判红。" +
            "指纹 = 相对路径|规则|归一化内容（不含行号 ⇒ 改代码不会让台账整体失效）。",
          entries,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    console.log("  · 已刷新债务台账：" + DEBT_PATH + "（" + entries.length + " 条指纹 / " + allHits.length + " 处）");
    console.log("\nprove_design_language: PASS=" + pass + " FAIL=0 SKIP=0");
    return;
  }

  ok(
    "扫描 " + TARGETS.length + " 个文件，" + allHits.length + " 处违规命中（其中 " +
    fresh.length + " 处是**新增**、必须判红；" + known.length + " 处是台账里的存量）"
  );
  for (const rule of Object.keys(byRule).sort()) {
    bad(
      "新增 " + rule + " 违规 " + byRule[rule] + " 处 ⇒ 增量代码必须走设计 token",
      fresh.filter((h) => h.rule === rule).slice(0, 3).map((h) => h.rel + ":" + h.line + " " + h.content).join(" | ")
    );
  }
  if (!fresh.length) ok("没有新增违规：设计 token 用得干净");

  /* ── 负向对照：注入一条违规 ⇒ 必须判红 ──
   * 变异只发生在**临时副本**上（源文件一个字节不动）。
   * 注入的行内样式刻意不在白名单里（既不是纯变量赋值，也不是 cursor:pointer）。 */
  {
    const tmp = path.join(DESKTOP, ".design_language_mutation.html");
    const src = fs.readFileSync(TARGETS[0].file, "utf8");
    const mutated = src.replace(
      "</body>",
      '<div style="font-size:13px;color:#ff0000;padding:7px">变异</div></body>',
    );
    let caught = false;
    try {
      fs.writeFileSync(tmp, mutated, "utf8");
      const mut = collect({ file: tmp, kind: "html" }, debtMap);
      const rel = path.relative(REPO, tmp);
      const freshMut = mut.filter((h) => {
        const d = debtMap.get(h.fp);
        return !(d && Number(d.count || 0) >= h.count);
      });
      const rules = new Set(freshMut.map((h) => h.rule));
      caught = rules.has("R1-inline-style") && rules.has("R2-hardcoded-color");
    } catch (e) {
      caught = false;
    } finally {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    }
    caught
      ? ok("负向对照有牙：注入行内样式+硬编码颜色 ⇒ R1/R2 判红（连台账都绕不过去）")
      : bad("负向对照**没咬到**", "注入违规后门禁没判红 ⇒ 判据失效");
  }

  console.log("\nprove_design_language: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail > 0 ? 1 : 0);
}

main();
