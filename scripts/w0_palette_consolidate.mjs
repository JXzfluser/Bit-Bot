/* w0_palette_consolidate.mjs — 把 ui_chrome.css 的重复调色块机械收敛成「原语 + 映射」
 *
 * 为什么要它：W0 是整个对齐的前置（腾 ratchet 预算），但它宣称「视觉零变化」，
 * 这句话必须能被证明，不能靠人眼看。本脚本不直接改源码，而是从当前 CSS **读出**
 * 全部主题变量，生成两份可在运行时注入的覆盖表：
 *   /tmp/w0a.css —— 只做去重（同一份色抽成 --p-lt-* / --p-dk-* 原语，映射回同名 token）。
 *                   预期：所有 token 的 resolved 值逐字节不变。
 *   /tmp/w0b.css —— 在 0a 之上再折掉第二套 token 家族（--ui-* / --text-ink / --text-sub /
 *                   --g-* → 指向 :root 规范 token）。预期：只有 --g-* 一族发生小幅灰移。
 *
 * 用法：node scripts/w0_palette_consolidate.mjs
 * 校验：node scripts/prove_w0_no_visual_change.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const CSS = path.join(REPO, "hosts/desktop/ui_chrome.css");

const src = fs.readFileSync(CSS, "utf8");
const lines = src.split("\n");

// 5 个调色块的确切行范围（起始行由块首 selector 校验，防止源码位移后静默采错）
const BLOCKS = [
  { key: "root", sel: ":root", from: 14, to: 118 },
  { key: "mLt", sel: "@media (prefers-color-scheme: light)", from: 119, to: 151 },
  { key: "mDk", sel: "@media (prefers-color-scheme: dark)", from: 152, to: 186 },
  { key: "fDk", sel: "body.force-dark", from: 187, to: 219 },
  { key: "fLt", sel: "body.force-light", from: 220, to: 252 },
];
for (const b of BLOCKS) {
  if (!lines[b.from - 1].includes(b.sel)) {
    console.error(`w0_palette_consolidate: 行号漂移 —— L${b.from} 不是 ${b.sel}。先更新 BLOCKS。`);
    process.exit(1);
  }
}

function decls(from, to) {
  const out = {};
  for (let i = from - 1; i < to; i++) {
    const m = lines[i].match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const D = Object.fromEntries(BLOCKS.map((b) => [b.key, decls(b.from, b.to)]));
const hexRe = /#[0-9a-fA-F]{3,8}\b/;
const countHex = (o) => Object.values(o).reduce((a, v) => a + (v.match(new RegExp(hexRe, "g")) || []).length, 0);

const shared = Object.keys(D.mLt).filter((n) => D.mDk[n] && D.fDk[n] && D.fLt[n]);
// 零漂移校验：4 个主题块必须在每个共享变量上逐字相同，否则 0a 就不是纯去重。
const drift = [];
for (const n of shared) {
  if (D.mLt[n] !== D.fLt[n]) drift.push(`${n}: media-light ${D.mLt[n]} / force-light ${D.fLt[n]}`);
  if (D.mDk[n] !== D.fDk[n]) drift.push(`${n}: media-dark ${D.mDk[n]} / force-dark ${D.fDk[n]}`);
}

// 只在暗色侧（或缺亮色侧）出现的主题变量：单独走一侧原语
const darkOnly = Object.keys(D.mDk).filter((n) => !shared.includes(n) && hexRe.test(D.mDk[n]));
const lightOnly = Object.keys(D.fLt).filter((n) => !shared.includes(n) && hexRe.test(D.fLt[n]) && !darkOnly.includes(n));

const prim = (mode, name) => `--p-${mode}-${name.slice(2)}`;
const primDecl = (mode, name, val) => `  ${prim(mode, name)}: ${val};`;

const primLines = [];
for (const n of shared) {
  primLines.push(primDecl("lt", n, D.mLt[n]));
  primLines.push(primDecl("dk", n, D.mDk[n]));
}
for (const n of lightOnly) primLines.push(primDecl("lt", n, D.fLt[n]));
for (const n of darkOnly) primLines.push(primDecl("dk", n, D.mDk[n]));

// 映射：token -> 按当前主题块选择原语。0a 的覆盖表必须与「当前生效的那一块」等价，
// 因此这里保持与源码同样的选择器结构（:root 用亮原语，dark 侧用暗原语）。
const mapLines = (mode, names) => names.map((n) => `  ${n}: var(${prim(mode, n)});`);
const allMapped = [...shared, ...lightOnly, ...darkOnly];

const w0a = `/* 生成物：node scripts/w0_palette_consolidate.mjs（勿手改）
 * 只映射「被抽成原语」的变量；未列出的（--code-bg/--fill 这类 var() 派生色）
 * 留给原块，注入表与源码同选择器时后写胜出，值完全一致。 */
:root {
${primLines.join("\n")}
}
:root {
${mapLines("lt", [...shared, ...lightOnly]).join("\n")}
}
@media (prefers-color-scheme: dark) {
  :root {
${mapLines("dk", [...shared, ...darkOnly]).join("\n")}
  }
}
body.force-dark {
${mapLines("dk", [...shared, ...darkOnly]).join("\n")}
}
body.force-light {
${mapLines("lt", [...shared, ...lightOnly]).join("\n")}
}
`;

// 0b：把第二套家族折到规范 token（值会小幅移动，必须单独证明）
const GFOLD = {
  "--text-ink": "var(--text)",
  "--text-sub": "var(--muted)",
  "--ui-border": "var(--line)",
  "--ui-fill": "var(--fill)",
  "--ui-card": "var(--surface)",
  "--ui-pill": "var(--user-bubble)",
};
const gDecl = (name, target) => `  ${name}: ${target};`;
const gFold = Object.entries(GFOLD).map(([k, v]) => gDecl(k, v)).join("\n");
const w0b = `/* 生成物 0b：折掉 body.grok-ui 的第二套 token 家族（--ui-* / --text-ink/--text-sub 退役，
 * --g-* 直接指向 :root 规范 token）。这一步必然带来小幅灰移，由 prove_w0_no_visual_change 量化。 */
body.grok-ui {
${gFold}
  --g-ink: var(--text);
  --g-sub: var(--muted);
  --g-line: var(--line);
  --g-soft: var(--fill);
  --g-card: var(--surface);
  --g-pill: var(--user-bubble);
}
@media (prefers-color-scheme: dark) {
  body.grok-ui:not(.force-light) {
${gFold}
  }
}
body.grok-ui.force-dark,
body.grok-ui.force-light {
${gFold}
}
`;

fs.writeFileSync("/tmp/w0a.css", w0a);
fs.writeFileSync("/tmp/w0b.css", w0b);

// --land：把 0a 落进源码。映射表与 /tmp/w0a.css 完全同源，替换是机械的：
// 5 个块里被抽原语的变量改为 var()，原语块插在 :root 之前。禁止跑两次。
if (process.argv.includes("--land")) {
  if (src.includes("--p-lt-bg0")) {
    console.error("已落地过（发现 --p-lt-bg0），拒绝重复落地。");
    process.exit(1);
  }
  const repl = (from, to, mode, names) => {
    let n = 0;
    for (let i = from - 1; i < to; i++) {
      const m = lines[i].match(/^(\s*)(--[\w-]+)\s*:\s*([^;]+);$/);
      if (m && names.includes(m[2])) { lines[i] = `${m[1]}${m[2]}: var(${prim(mode, m[2])});`; n++; }
    }
    return n;
  };
  const nRoot = repl(14, 118, "lt", [...shared, ...lightOnly]);
  const nMLt = repl(119, 151, "lt", [...shared, ...lightOnly]);
  const nMDk = repl(152, 186, "dk", [...shared, ...darkOnly]);
  const nFDk = repl(187, 219, "dk", [...shared, ...darkOnly]);
  const nFLt = repl(220, 252, "lt", [...shared, ...lightOnly]);
  const primBlock =
    "/* ---- W0-0a 调色原语：每个色值全仓只写一次（scripts/w0_palette_consolidate.mjs --land 生成）----\n" +
    " * 规则：调色块内不得再出现字面色值，新增颜色先进这里。 */\n" +
    ":root {\n" + primLines.join("\n") + "\n}\n\n";
  lines.splice(13, 0, primBlock);
  fs.writeFileSync(CSS, lines.join("\n"));
  console.log(`已落地 0a：替换 root ${nRoot} / mLt ${nMLt} / mDk ${nMDk} / fDk ${nFDk} / fLt ${nFLt} 条，插入原语 ${primLines.length} 条。`);
  console.log("校验：node scripts/prove_w0_no_visual_change.mjs && node scripts/prove_ui_tokens.js");
  process.exit(0);
}

const before = BLOCKS.reduce((a, b) => a + countHex(D[b.key]), 0);
const after = primLines.reduce((a, l) => a + ((l.match(new RegExp(hexRe, "g")) || []).length), 0);
console.log("零漂移变量数:", shared.length, "| 漂移:", drift.length ? drift : "无（0a 可证明纯去重）");
console.log("只在暗色侧:", darkOnly.join(",") || "-");
console.log("只在亮色侧:", lightOnly.join(",") || "-");
console.log(`5 块内 hex 出现次数: before ${before} -> after ${after}（原语只写一遍）`);
console.log("生成: /tmp/w0a.css", w0a.split("\n").length, "行 |  /tmp/w0b.css", w0b.split("\n").length, "行");
console.log("0b 折叠映射:", JSON.stringify(GFOLD));
