/* w0_prove_token_equiv.mjs — 用确定性级联求解证明 0a 是「纯去重」
 *
 * 为什么不用真 app 像素对比：宿主是活的（会话行/日志/计时器会在两次采样之间改 DOM），
 * 逐元素指纹的 key 会漂移、截图永远不可能逐字节相同 —— 那种「✗ 有差异」是自证工具的噪声，
 * 不是结论。能在 W0 这一层真正改变结果的只有 **token 解析值**，所以把它当成纯函数算出来。
 *
 * 做法：把 5 个调色块读成变量表，按 CSS 真实优先级合成每种主题场景下的生效值
 *   force-* 类 (0,1,1) > 匹配的 @media :root (0,1,0，源码序后者胜) > :root (0,1,0)
 * 再递归展开 var() 链到字面量，逐 token 比较「仅源码」vs「源码 + /tmp/w0a.css」。
 * 0b 单独跑：它**应当**有差异，脚本把差异量化成 RGB 通道偏移，供对照稿引用。
 *
 * 用法：node scripts/w0_prove_token_equiv.mjs [--with-0b]
 *
 * 基准固定：0a 的等价性只对「落地当时那份调色」成立。W1 起 token 已换值，
 * 而 /tmp/w0a.css 里写的是旧色，直接读工作树会把手写值还原成旧色、必然报红。
 * 因此本脚本默认读 W0 落地提交 f3a4fc7 的 ui_chrome.css；可用 W0_BASE 覆盖。
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const CSS = path.join(REPO, "hosts/desktop/ui_chrome.css");
const BASE_REF = process.env.W0_BASE || "f3a4fc7";
let cssText;
try {
  cssText = execSync(`git show ${BASE_REF}:hosts/desktop/ui_chrome.css`, { cwd: REPO, encoding: "utf8" });
} catch {
  console.warn(`无法读取 ${BASE_REF}，回退到工作树（W1 后 0a 必然不等价）`);
  cssText = fs.readFileSync(CSS, "utf8");
}
const lines = cssText.split("\n");

// 2026-10-24 0a 已落地（scripts/w0_palette_consolidate.mjs --land）：原语块并入 :root(16-70)，
// 语义 :root 为 71-175。此后本脚本变成回归保护：落地源 + 注入表 必须 0 差异。
const BLOCKS = [
  { key: "root", sel: ":root", from: 16, to: 184 },
  { key: "mLt", sel: "@media (prefers-color-scheme: light)", from: 185, to: 217 },
  { key: "mDk", sel: "@media (prefers-color-scheme: dark)", from: 218, to: 252 },
  { key: "fDk", sel: "body.force-dark", from: 253, to: 285 },
  { key: "fLt", sel: "body.force-light", from: 286, to: 318 },
];
for (const b of BLOCKS) {
  if (!lines[b.from - 1].includes(b.sel)) {
    console.error(`行号漂移：L${b.from} 不是 ${b.sel}。先更新 BLOCKS。`);
    process.exit(1);
  }
}

// ---- 解析：源码块 + 生成物块，一律读成 { scopeKey: { var: value } } ----
function parseRange(from, to) {
  const out = {};
  for (let i = from - 1; i < to; i++) {
    const m = lines[i].match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const SRC = Object.fromEntries(BLOCKS.map((b) => [b.key, parseRange(b.from, b.to)]));

// 生成物按「选择器行」切段，段名与源码 scope 同名才能套同一优先级。
// 行扫描而不是一个大正则：媒体查询里的嵌套 :root、跨行选择器列表都要正确归段。
function parseOverlay(file) {
  const text = fs.readFileSync(file, "utf8");
  const scopes = { root: {}, mLt: {}, mDk: {}, fDk: {}, fLt: {}, grokLt: {}, grokDk: {} };
  let inMedia = null; // "light" | "dark" | null
  let mediaDepth = 0;
  let cur = null; // 当前段名
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (l.startsWith("/*") || l.startsWith("*") || l.startsWith("*/")) { if (!l.includes("{")) continue; }
    if (!l) continue;
    const med = l.match(/^@media\s*\(prefers-color-scheme:\s*(light|dark)\)/);
    if (med) { inMedia = med[1]; mediaDepth = 0; continue; }
    const selMatch = l.match(/^([^{}]+?)\s*\{$/);
    if (selMatch) {
      const sel = selMatch[1].trim();
      if (inMedia) {
        cur = /:root/.test(sel) ? (inMedia === "dark" ? "mDk" : "mLt")
          : /force-dark/.test(sel) ? (inMedia === "dark" ? "grokDk" : null)
          : /force-light/.test(sel) ? (inMedia === "light" ? "grokLt" : null)
          : null;
      } else {
        cur = /force-dark/.test(sel) ? "fDk"
          : /force-light/.test(sel) ? "fLt"
          : /:root/.test(sel) ? "root"
          : /grok-ui/.test(sel) ? "grokLt"
          : null;
      }
      continue;
    }
    if (l === "}" || l === "}") { if (cur) cur = null; if (inMedia && l === "}") { inMedia = null; } continue; }
    if (!cur) continue;
    for (const d of l.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) scopes[cur][d[1]] = d[2].trim();
  }
  return scopes;
}
const W0A = parseOverlay("/tmp/w0a.css");
const W0B = fs.existsSync("/tmp/w0b.css") ? parseOverlay("/tmp/w0b.css") : null;

// ---- 级联合成 ----
function cascade(base, overlay) {
  // 同名 scope 合并（overlay 在源码之后，故同 scope 内后写胜出）
  const s = {};
  for (const k of Object.keys(base)) s[k] = { ...base[k], ...(overlay?.[k] || {}) };
  return s;
}

function effectiveValue(scopes, mode, force, name) {
  const chain = [scopes.root];
  if (mode === "light" && scopes.mLt?.[name] !== undefined) chain.push(scopes.mLt);
  if (mode === "dark" && scopes.mDk?.[name] !== undefined) chain.push(scopes.mDk);
  if (force === "light" && scopes.fLt?.[name] !== undefined) chain.push(scopes.fLt);
  if (force === "dark" && scopes.fDk?.[name] !== undefined) chain.push(scopes.fDk);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i][name] !== undefined) return chain[i][name];
  }
  return undefined;
}

const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/;
function resolve(scopes, mode, force, name, depth = 0) {
  let v = effectiveValue(scopes, mode, force, name);
  if (v === undefined) return undefined;
  let guard = 0;
  while (guard++ < 12) {
    const m = v.match(VAR_RE);
    if (!m) return v;
    const inner = resolve(scopes, mode, force, m[1], depth + 1);
    const repl = inner !== undefined ? inner : (m[2] || "").trim();
    if (inner === undefined && !m[2]) return `UNRESOLVED(${m[1]})`;
    v = v.replace(m[0], repl);
    if (v.includes("var(")) continue;
    return v;
  }
  return `CYCLE(${name})`;
}

function tokenNames(scopes) {
  const set = new Set();
  for (const k of Object.keys(scopes)) for (const n of Object.keys(scopes[k])) if (n.startsWith("--")) set.add(n);
  return [...set].filter((n) => !n.startsWith("--p-")).sort();
}

function snapshot(scopes) {
  const out = {};
  for (const name of tokenNames(scopes)) {
    for (const mode of ["light", "dark"]) {
      for (const force of ["none", "light", "dark"]) {
        out[`${mode}/${force}::${name}`] = resolve(scopes, mode, force, name);
      }
    }
  }
  return out;
}

function rgbOf(s) {
  const t = String(s);
  const h = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (h) {
    let x = h[1];
    if (x.length === 3) x = x.split("").map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  }
  const n = t.match(/rgba?\(([^)]+)\)/i);
  if (n) return n[1].split(",").slice(0, 3).map((v) => parseFloat(v));
  return null;
}

function compare(before, after, label) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const diffs = [];
  for (const k of keys) {
    const b = before[k], a = after[k];
    if (b === a) continue;
    if (b === undefined || a === undefined) { diffs.push({ k, b, a, delta: null }); continue; }
    const B = rgbOf(b), A = rgbOf(a);
    const delta = B && A ? Math.max(...B.map((v, i) => Math.abs(v - A[i]))) : null;
    diffs.push({ k, b, a, delta });
  }
  const scenarioCount = new Set(diffs.map((d) => d.k.split("::")[0])).size;
  const tokenCount = new Set(diffs.map((d) => d.k.split("::")[1])).size;
  console.log(`\n=== ${label} ===`);
  console.log(`比较条目 ${keys.length} 条（token × 6 种主题场景）`);
  console.log(`差异 ${diffs.length} 条，涉及 ${tokenCount} 个 token / ${scenarioCount} 个场景`);
  const deltas = diffs.map((d) => d.delta).filter((x) => typeof x === "number");
  if (deltas.length) console.log(`RGB 通道最大偏移 ${Math.max(...deltas)} / 255`);
  diffs.slice(0, 20).forEach((d) => console.log(`   ${d.k}\n      before ${d.b}\n      after  ${d.a}${d.delta !== null ? `   Δch=${d.delta}` : ""}`));
  if (diffs.length > 20) console.log(`   …另有 ${diffs.length - 20} 条（全量见 --json）`);
  return diffs;
}

const base = SRC;
const with0a = cascade(SRC, W0A);
const with0ab = W0B ? cascade(with0a, W0B) : null;

const snapBase = snapshot(base);
const snapA = snapshot(with0a);

console.log(`调色块：${BLOCKS.length} 个 | token 总数 ${tokenNames(base).length} | 生成物 scope 命中 ` +
  Object.entries(W0A).filter(([, v]) => Object.keys(v).length).map(([k]) => k).join(","));

const d0a = compare(snapBase, snapA, "0a（纯去重）—— 期望 0 条差异");
if (d0a.length) {
  console.log("\n✗ 0a 不等价，不能宣称视觉零变化。");
  process.exit(1);
}
console.log("\n✓ 0a 在 6 种主题场景下逐 token 解析值完全一致 → 纯去重，可落地。");

// 顺带汇报 ratchet 预算：这是 W0 的唯一收益
const hexRe = new RegExp("#[0-9a-fA-F]{3,8}\\b", "g");
const countIn = (o) => Object.values(o).reduce((a, v) => a + ((String(v).match(hexRe) || []).length), 0);
const beforeHex = BLOCKS.reduce((a, b) => a + countIn(SRC[b.key]), 0);
const afterHex = countIn(W0A.root);
console.log(`块内硬编码色值：before ${beforeHex} → after ${afterHex}（原语只写一遍），腾出 ${beforeHex - afterHex} 个 ratchet 额度`);

if (process.argv.includes("--with-0b") && with0ab) compare(snapBase, snapshot(with0ab), "0a+0b（折第二套家族）—— 允许小灰移");

if (process.argv.includes("--json")) {
  fs.writeFileSync("/tmp/w0_token_equiv.json", JSON.stringify({ before: snapBase, after0a: snapA, diffs0a: d0a }, null, 2));
  console.log("全量解析表：/tmp/w0_token_equiv.json");
}
