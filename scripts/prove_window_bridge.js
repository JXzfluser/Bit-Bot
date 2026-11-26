#!/usr/bin/env node
"use strict";

/**
 * prove_window_bridge — 跨作用域桥接的「声明—引用」对账门（批次 14）
 *
 * 背景：index.html 里有**嵌套的 IIFE**（4475 那个装着 openRoomChat / openRoomRail /
 * runUserTurn，26630 那个装着 cmdOpen / cmdClose），两个作用域**互相看不见**。
 * ⇒ 跨作用域的动作一律走 window 桥（window.__appRailCtx / window.__bitbotCommand）。
 *
 * 而 window 桥有个**致命特性**：它是**一次性赋值**。
 *   window.__bitbotCommand = { open: cmdOpen, close: cmdClose, … };
 * 只要其中**任何一个引用在运行时是 undefined**，整行就抛 ReferenceError
 * ⇒ **整个桥不存在** ⇒ 所有跨作用域功能**同时**静默失效
 * ⇒ 页面没有红、没有崩，只是「点了没反应」。
 *
 * 真实事故（2026-11-26，批次 14）：编辑 index.html 时一个块注释**没有闭合**，
 * 注释一路吞掉 appRailBind / cmdSetView / cmdUpdateBadge / cmdOpen / cmdClose
 * **五个函数声明**。
 *   · 那**不是语法错误** ⇒ node --check 全绿 ⇒ 任何语法级门禁都看不见；
 *   · `window.__bitbotCommand = { … cmdOpen … }` 抛 ReferenceError ⇒ 桥没了；
 *   · 外层那个大 try/catch 又把异常吞掉 ⇒ 用户只看到「点了『指挥』毫无反应」。
 *
 * ⇒ 本门在**静态层**把这件事钉死（纯读文件，不起进程、不联网 ⇒ L1 秒级）：
 *
 *   WB-1 桥接对象里引用的每一个标识符，都必须在**剥掉注释后**的源码里有声明
 *        （function / var / let / const / class）⇒ 少一个 ⇒ 判红
 *        （**这条就是那次事故的精确签名**：cmdOpen 的声明被注释吞了，
 *          桥接里还引用着它 ⇒ 桥接赋值必抛 ReferenceError）
 *   WB-2 某个函数声明被注释吞了、而**别处仍在引用它** ⇒ 判红
 *        （刻意注释掉的旧代码**不算**违规 —— 那是有意的，WB-2 只抓
 *          「注释里没了、别处还在用」的那一种）
 *   WB-3 tokenizer 自检：剥完注释的每个 script 块必须仍然能通过语法解析
 *        ⇒ tokenizer 失准时**如实报红**，不许拿一把失准的尺子去量别人
 *   WB-4 负向对照 ①：把桥接里的一个引用改成未声明的标识符 ⇒ WB-1 必须判红
 *   WB-5 负向对照 ②：把一个被桥接引用的函数声明吞进注释里 ⇒ WB-1/WB-2 必须判红
 *
 * 口径说明：
 *   · 只扫 **inline <script>**（有 src 属性的外链脚本不在本门范围内）。
 *   · 注释**等长**替换成空格（保留换行）⇒ 原文与剥注释版的偏移**逐一对应**
 *     ⇒ WB-2 才能做「同位置比对」，不会因为空白差异而误判。
 *   · 变异只发生在**临时副本**上，源文件一个字节都不动。
 *   · 本门**不判断业务**，只判断「跨作用域的桥接在源码层面是接得上的」。
 *
 * 用法：node scripts/prove_window_bridge.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
const HTML = path.join(REPO, "hosts", "desktop", "index.html");

let pass = 0,
  fail = 0;
const ok = (m) => {
  pass++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  fail++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : ""));
};
const check = (c, m, d) => (c ? ok(m) : bad(m, d));

/* ── 词法：把 JS 注释等长替换成空格 ─────────────────────────────────────
 *
 * 只处理 JS 真正认识的两种注释（行注释与块注释），字符串与正则整体跳过。
 * 为什么要自己写而不是用现成 parser：仓库里没有 acorn/esprima，
 * 而现成 parser 也**不告诉**我们注释的位置 —— 我们要的正是「哪些声明藏在注释里」。
 *
 * 正则字面量 vs 除号：用「上一个 token」判断（identifier/数字/)/] ⇒ 除号；
 * 关键字（return/typeof/case…）/运算符/行首 ⇒ 正则）。index.html 里只有个位数
 * 的正则字面量，且都不含注释起始序列，所以这个启发式在本文件上是安全的；
 * 万一失准，WB-3 的语法自检会当场把它揪出来（而不是默默判错）。
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await", "throw", "default",
]);

function stripJsComments(src) {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  let prevTok = "";
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    if (c === "/" && c2 === "/") {
      const s = i;
      while (i < n && src[i] !== "\n") i++;
      blank(s, i);
      continue;
    }
    if (c === "/" && c2 === "*") {
      const s = i;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i < n) i += 2;
      blank(s, i);
      prevTok = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      prevTok = "str";
      continue;
    }
    if (c === "/") {
      const isRegex =
        prevTok === "" ||
        prevTok === "str" ||
        REGEX_PRECEDING_KEYWORDS.has(prevTok) ||
        /[({[,;:=!&|?+\-*%^~<>]/.test(prevTok);
      if (isRegex) {
        i++;
        let inClass = false;
        while (i < n) {
          const d = src[i];
          if (d === "\\") {
            i += 2;
            continue;
          }
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) {
            i++;
            break;
          } else if (d === "\n") break;
          i++;
        }
        while (i < n && /[a-z]/.test(src[i])) i++;
        prevTok = "regex";
        continue;
      }
      i++;
      prevTok = "op";
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const s = i;
      while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
      prevTok = src.slice(s, i);
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (i < n && /[0-9a-fA-FxXoObBnE._]/.test(src[i])) i++;
      prevTok = "num";
      continue;
    }
    if (!/\s/.test(c)) prevTok = c;
    i++;
  }
  return out.join("");
}

/** 抽出所有 inline <script>（没有 src 属性）的内容。
 *  每块返回 { start, raw, stripped }，start 是内容在**整个文件**里的偏移。 */
function extractInlineScripts(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const raw = m[2] || "";
    /* `<script` 是 7 个字符，后面是属性，再后面是 `>`（1 个字符）⇒ 内容起点。 */
    const start = m.index + 7 + attrs.length + 1;
    blocks.push({ start, raw, stripped: stripJsComments(raw) });
  }
  return blocks;
}

/** 文件里声明过的名字（只看剥掉注释后的源码）。 */
function collectDeclared(stripped) {
  const names = new Set();
  const res = [
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g,
    /\bclass\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const re of res) {
    let m;
    while ((m = re.exec(stripped))) if (m[1]) names.add(m[1]);
  }
  return names;
}

/** 剥掉注释后的源码里被**真正引用**的标识符（排除属性名 `.x` 与对象键 `x:`）。 */
function collectReferenced(stripped) {
  const refs = new Set();
  const re = /(^|[^\w$.:])([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(stripped))) {
    const word = m[2];
    if (["function", "class", "var", "let", "const"].includes(word)) continue;
    /* `function X(` / `class X` 里的 X 是**声明**，不是引用 ⇒ 不算。 */
    const idStart = m.index + m[1].length;
    const before = stripped.slice(Math.max(0, idStart - 12), idStart);
    if (/\b(?:function|class|get|set)\s+$/.test(before)) continue;
    refs.add(word);
  }
  return refs;
}

/** 找出所有 `window.__X = { … }` 桥接对象，返回 [{name, members:[…]}]。
 *  只认**对象字面量**（标量赋值不在此列 —— 它们不构成「整体失效」）。 */
function findBridges(stripped) {
  const out = [];
  const re = /window\s*\.\s*(__[A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(stripped))) {
    const open = stripped.indexOf("{", m.index);
    let depth = 0;
    let i = open;
    let inStr = null;
    for (; i < stripped.length; i++) {
      const ch = stripped[i];
      if (inStr) {
        if (ch === "\\") {
          i++;
          continue;
        }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ name: m[1], members: depth1ValueIdents(stripped.slice(open + 1, i)) });
  }
  return out;
}

/** 取对象字面量**第一层**里「作为值」出现的标识符（排除属性名与关键字）。 */
function depth1ValueIdents(body) {
  const res = [];
  let depth = 0;
  let i = 0;
  const n = body.length;
  let inStr = null;
  while (i < n) {
    const c = body[i];
    if (inStr) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      i++;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && /[A-Za-z_$]/.test(c)) {
      const s = i;
      while (i < n && /[A-Za-z0-9_$]/.test(body[i])) i++;
      const word = body.slice(s, i);
      let j = i;
      while (j < n && /\s/.test(body[j])) j++;
      const next = body[j] || "";
      if (next === ":") continue; /* 属性名，不是值 */
      if (["function", "async", "get", "set"].includes(word)) continue;
      if (["true", "false", "null", "undefined", "this", "new", "typeof", "void", "delete"].includes(word)) continue;
      res.push({ word, pos: s });
      continue;
    }
    i++;
  }
  return res;
}

/** 语法自检：剥完注释的每个 script 块必须仍然能解析。 */
function syntaxBad(html) {
  const bads = [];
  for (const b of extractInlineScripts(html)) {
    try {
      /* eslint-disable no-new */
      new vm.Script(b.stripped, { filename: "stripped.js" });
    } catch (e) {
      const msg = String((e && e.message) || e);
      /* 顶层 await 在 classic script 里不合法 —— 那不是我们剥坏了，是脚本本来如此。 */
      if (/await is only valid|await is not defined|outside a module/i.test(msg)) continue;
      bads.push(msg.split("\n")[0]);
    }
  }
  return bads;
}

/** 跑一遍「声明—引用」对账，返回问题列表（空数组 = 通过）。 */
function audit(html) {
  const problems = [];
  const blocks = extractInlineScripts(html);

  /* 所有剥注释后的源码拼起来（偏移无关的全局视图）。 */
  const strippedAll = blocks.map((b) => b.stripped).join("\n;\n");
  const declared = collectDeclared(strippedAll);
  const referenced = collectReferenced(strippedAll);

  /* WB-1：桥接对象里引用的标识符必须声明过。 */
  for (const b of findBridges(strippedAll)) {
    for (const mem of b.members) {
      if (!declared.has(mem.word)) {
        problems.push({ kind: "undeclared-ref", bridge: b.name, name: mem.word });
      }
    }
  }

  /* WB-2：函数声明被注释吞了、而别处仍在引用 ⇒ 判红。
   * （刻意注释掉的旧代码没人引用 ⇒ 不算违规。） */
  for (const b of blocks) {
    const rawRe = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
    const strOne = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/;
    let rm;
    while ((rm = rawRe.exec(b.raw))) {
      const at = rm.index;
      const stillThere = strOne.test(b.stripped.slice(at, at + rm[0].length + 2));
      if (stillThere) continue;
      const name = rm[1];
      if (referenced.has(name)) {
        problems.push({
          kind: "func-in-comment",
          name,
          line: countLines(html, b.start + at),
        });
      }
    }
  }
  return problems;
}

function countLines(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

/** 在临时副本上做变异（源文件一个字节不动）。 */
function withMutated(mutator, fn) {
  const src = fs.readFileSync(HTML, "utf8");
  const mutated = mutator(src);
  if (mutated === src) return { skipped: true };
  const tmp = path.join(path.dirname(HTML), ".negative_control_window_bridge." + process.pid + ".html");
  fs.writeFileSync(tmp, mutated, "utf8");
  try {
    return fn(tmp);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (_) {
      /* ignore */
    }
  }
}

(async () => {
  console.log("prove_window_bridge — 跨作用域桥接的声明—引用对账");
  let html = "";
  try {
    html = fs.readFileSync(HTML, "utf8");
  } catch (e) {
    bad("读不到 hosts/desktop/index.html", String((e && e.message) || e));
    console.log(`\nprove_window_bridge: PASS=${pass} FAIL=${fail}`);
    process.exit(1);
  }

  /* WB-3 tokenizer 自检（先跑：尺子不准就别急着量别人） */
  const syntax = syntaxBad(html);
  if (syntax.length === 0) {
  ok("[WB-03] tokenizer 自检：剥掉注释后的 script 块仍能通过语法解析");
} else {
  bad("[WB-03] tokenizer 自检：剥掉注释后的 script 块仍能通过语法解析", JSON.stringify(syntax.slice(0, 3)));
};

  const problems = audit(html);
  const funcHidden = problems.filter((p) => p.kind === "func-in-comment");
  const undecl = problems.filter((p) => p.kind === "undeclared-ref");

  if (funcHidden.length === 0) {
  ok("[WB-02] 没有「别处还在用、声明却被注释吞掉」的函数");
} else {
  bad("[WB-02] 没有「别处还在用、声明却被注释吞掉」的函数", funcHidden.map((p) => `${p.name}@L${p.line}`).join(", "));
};
  if (undecl.length === 0) {
  ok("[WB-01] 桥接对象引用的每个标识符都有声明（function/var/let/const/class）");
} else {
  bad("[WB-01] 桥接对象引用的每个标识符都有声明（function/var/let/const/class）", undecl.map((p) => `${p.bridge}.${p.name}`).join(", "));
};

  /* ── WB-4 负向对照 ①：桥接里塞一个未声明的标识符 ⇒ 必须判红 ── */
  {
    const r = withMutated(
      (s) => s.replace(/(\n\s*aggregate:\s*)aggregateCommandTasks/, "$1aggregateCommandTasksTYPO"),
      (tmp) => {
        const probs = audit(fs.readFileSync(tmp, "utf8"));
        return probs.some((p) => p.kind === "undeclared-ref");
      }
    );
    if (r.skipped) bad("[WB-04] 负向对照跑不起来（注入点找不到：源码结构变了）");
    else if (r === true) {
  ok("[WB-04] 负向对照有牙：桥接引用改成不存在的标识符 ⇒ WB-1 判红");
} else {
  bad("[WB-04] 负向对照有牙：桥接引用改成不存在的标识符 ⇒ WB-1 判红");
};
  }

  /* ── WB-5 负向对照 ②：把一个被桥接引用的函数声明吞进注释里 ⇒ 必须判红 ──
   * 这就是 2026-11-26 那次事故的原样重演。 */
  {
    const r = withMutated(
      (s) => {
        const at = s.indexOf("    async function cmdRefresh() {");
        if (at < 0) return s;
        const end = s.indexOf("\n    }\n", at);
        if (end < 0) return s;
        const body = s.slice(at, end + 7);
        return s.slice(0, at) + "/*\n" + body + s.slice(end + 7);
      },
      (tmp) => {
        const probs = audit(fs.readFileSync(tmp, "utf8"));
        return probs.some((p) => p.kind === "undeclared-ref" || p.kind === "func-in-comment");
      }
    );
    if (r.skipped) bad("[WB-05] 负向对照跑不起来（注入点找不到：源码结构变了）");
    else if (r === true) {
  ok("[WB-05] 负向对照有牙：把被引用的函数声明吞进注释 ⇒ 判红（事故原样重演）");
} else {
  bad("[WB-05] 负向对照有牙：把被引用的函数声明吞进注释 ⇒ 判红（事故原样重演）");
};
  }

  console.log(`\nprove_window_bridge: PASS=${pass} FAIL=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
