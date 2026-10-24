/* grok_delta_report.mjs — 把 Grok 真源实测与我方同量纲实测逐字段对照。
 *
 * 为什么存在：对照稿里每一格数值都必须能重跑复现（P1 真源唯一），手抄 JSON 到文档
 * 会抄错、也会悄悄把过期值留在文档里。这个脚本只做一件事：读两份 json，
 * 按同名路径逐项比，输出 markdown 差量表。
 *
 * Usage: node scripts/grok_delta_report.mjs [--md out.md]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF = path.join(REPO, "docs/design/desktop-target/reference");
const GROK = process.env.GROK_SPEC || path.join(REF, "grok-real-spec.json");
const BB = process.env.BB_SPEC || path.join(REF, "bb-real-spec.json");

/* 数值归一：真源把尺寸写成 "28px"、我方写成 28；rgba 空格数不定。 */
function norm(v) {
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  if (typeof v !== "string") return JSON.stringify(v);
  const s = v.trim().toLowerCase().replace(/\s+/g, " ");
  const px = s.match(/^(-?[\d.]+)px$/);
  return px ? String(Math.round(parseFloat(px[1]) * 100) / 100) : s;
}

function flatten(o, prefix, out) {
  for (const [k, v] of Object.entries(o || {})) {
    const p = prefix ? `${prefix}/${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, p, out);
    else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") flatten(item, `${p}[${i}]`, out);
        else out.set(`${p}[${i}]`, item);
      });
    } else out.set(p, v);
  }
  return out;
}

/* 对照时没意义的字段：选择器、说明、selector 串、时间戳、DOM 文本。 */
const SKIP = /(^|\/)(selector|note|text|capturedAt|source|script|url|title|meta|counts?|rows|count)$/i;
const isSkip = (p) => SKIP.test(p) || /selector$/i.test(p.split("/").pop() || "");

function load(file) {
  if (!fs.existsSync(file)) return null;
  return flatten(JSON.parse(fs.readFileSync(file, "utf8")), "", new Map());
}

const g = load(GROK);
const b = load(BB);
if (!g) {
  console.error(`缺少真源文件：${GROK}\n先跑 node scripts/grok_real_spec_capture.mjs`);
  process.exit(1);
}
if (!b) {
  console.error(`缺少我方文件：${BB}\n先跑 node scripts/bb_spec_capture.mjs`);
  process.exit(1);
}

const rows = [];
let same = 0;
for (const [p, gv] of g) {
  if (isSkip(p)) continue;
  if (!b.has(p)) continue;
  const bv = b.get(p);
  if (bv === null || bv === undefined) continue;
  if (norm(gv) === norm(bv)) {
    same++;
    continue;
  }
  rows.push({ path: p, grok: norm(gv), bb: norm(bv) });
}

/* 只有 Grok 有、我方结构里根本没有的字段 = 界面缺件（例如底部独立「连接应用」胶囊）。 */
const onlyGrok = [...g.keys()].filter((p) => !isSkip(p) && !b.has(p));
const onlyBb = [...b.keys()].filter((p) => !isSkip(p) && !g.has(p));

function section(prefix) {
  const sel = rows.filter((r) => r.path.startsWith(prefix + "/"));
  if (!sel.length) return "";
  const md = [`### ${prefix}`, "", "| 字段 | Grok 真源 | 我方现状 |", "|------|-----------|----------|"];
  for (const r of sel) {
    md.push(`| \`${r.path.split("/").slice(1).join("/")}\` | ${r.grok} | ${r.bb} |`);
  }
  md.push("");
  return md.join("\n");
}

const regions = [...new Set(rows.map((r) => r.path.split("/")[0]))];
const body = [
  `# Grok 真源差量表（自动生成，勿手改）`,
  ``,
  `- 真源：\`${path.relative(REPO, GROK)}\` · 我方：\`${path.relative(REPO, BB)}\``,
  `- 同值 **${same}** 项 · 差值 **${rows.length}** 项 · 仅真源有 **${onlyGrok.length}** 项 · 仅我方有 **${onlyBb.length}** 项`,
  ``,
  `> 数值由 \`scripts/grok_real_spec_capture.mjs\` 与 \`scripts/bb_spec_capture.mjs\` 实测产出；`,
  `> 重跑：\`node scripts/grok_real_spec_capture.mjs && node scripts/bb_spec_capture.mjs && node scripts/grok_delta_report.mjs --md docs/design/desktop-target/alignment-delta-tables.md\``,
  ``,
  ...regions.map(section),
  `### 仅真源存在（我方结构缺件，需产品裁决是否补）`,
  ``,
  onlyGrok.length ? onlyGrok.map((p) => `- \`${p}\``).join("\n") : "（无）",
  ``,
  `### 仅我方存在（真源没有的形态，对齐时考虑退役或降级）`,
  ``,
  onlyBb.length ? onlyBb.map((p) => `- \`${p}\``).join("\n") : "（无）",
  ``,
].join("\n");

const outArg = process.argv.indexOf("--md");
const out = outArg > -1 ? process.argv[outArg + 1] : "";
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(REPO, out)), { recursive: true });
  fs.writeFileSync(path.resolve(REPO, out), body);
  console.log(`差量表 → ${out}（同值 ${same} · 差值 ${rows.length}）`);
} else {
  console.log(body);
}
