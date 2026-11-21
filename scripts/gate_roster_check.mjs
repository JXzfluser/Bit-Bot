#!/usr/bin/env node
/* gate_roster_check.mjs — runner 的**清单自检**（不是门禁）
 *
 * 它做什么（只有这一件事）：
 *   保证「分层清单 scripts/gate_tiers.json ↔ scripts/ 磁盘 ↔ 孤门基线」三者一致。
 *   - scripts/ 下多出一个门禁文件（没人登记）      ⇒ 红：新门禁必须先在清单里落一行
 *     （层 / 是否阻塞 / 为什么），否则它就是「没人跑、没人知道它存在」的东西。
 *   - 清单里登记了、磁盘上却没有                    ⇒ 红：清单过期了。
 *   - 孤门数（按 AC-07 同一口径算出来的）与基线不符 ⇒ 红：基线跟清单对不上。
 *
 * 它**不**做什么（这是它与「元工作门禁」的分界线）：
 *   - 不检查任何一条门禁的判据质量（那是门自己的事）；
 *   - 不数行数、不算覆盖率、不维护任何账本；
 *   - 不新增任何阻塞项 —— 它只是让清单不会悄悄过期。
 *
 * 为什么要有它：元工作门禁本轮被**冻结**（仍跑、只报告、不再阻塞）。冻结的尺会失重，
 * 所以「清单与磁盘一致」这件事改由 runner 自己兜着 —— runner 每次 L1 跑都会问一遍。
 *
 * 退出码：0 = 一致；1 = 不一致（并逐条说明差在哪）。
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const SCRIPTS = path.join(REPO, "scripts");
const MATRIX = path.join(SCRIPTS, "smoke_grok_desktop_parity.sh");
const MANIFEST = path.join(SCRIPTS, "gate_tiers.json");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : "")); };

/* ---- 清单 ---------------------------------------------------------------- */
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
} catch (e) {
  console.log("  ✗ 读不到分层清单 scripts/gate_tiers.json — " + (e && e.message));
  console.log("\ngate_roster_check: PASS=0 FAIL=1 SKIP=0");
  process.exit(1);
}

const roster = manifest.gates.filter((g) => !g.retired);
const rosterFiles = roster.map((g) => g.file);
const onDisk = fs.readdirSync(SCRIPTS)
  .filter((f) => /^(prove|e2e|diagnose)_[\w.-]+\.(mjs|js|sh)$/.test(f))
  .sort();

/* ---- 1. 清单 ↔ 磁盘 ------------------------------------------------------- */
const missingOnDisk = rosterFiles.filter((f) => !fs.existsSync(path.join(SCRIPTS, f)));
const notRegistered = onDisk.filter((f) => !rosterFiles.includes(f));
if (missingOnDisk.length) {
  bad("清单里登记了、磁盘上没有的门", missingOnDisk.join(", "));
} else ok("清单登记的 " + rosterFiles.length + " 条门禁都在磁盘上");
if (notRegistered.length) {
  bad("磁盘上有、清单里没登记的门（新增门禁必须先在 gate_tiers.json 落一行：层/是否阻塞/为什么）",
    notRegistered.join(", "));
} else ok("磁盘上的 " + onDisk.length + " 个门禁文件全部在清单里登记了");

/* ---- 2. 冻结清单：份数只许往下，不许往上 --------------------------------- */
const frozenOnDisk = roster.filter((g) => g.frozen).map((g) => g.file).sort();
const pinned = Number(manifest.frozen_policy && manifest.frozen_policy.frozen_count);
if (!Number.isFinite(pinned)) {
  bad("清单里没有 frozen_policy.frozen_count（冻结份数必须钉住）");
} else if (frozenOnDisk.length > pinned) {
  bad("冻结的元工作门禁份数不得超过 " + pinned + "（本轮起禁止新增这一类）",
    "实测 " + frozenOnDisk.length + "：" + frozenOnDisk.join(", "));
} else if (frozenOnDisk.length < pinned) {
  ok("冻结的元工作门禁 " + frozenOnDisk.length + " < 钉住值 " + pinned);
} else {
  ok("冻结的元工作门禁 " + frozenOnDisk.length + " = 钉住值 " + pinned + "（这一类已冻结，禁止再新增）");
}

/* ---- 3. 孤门基线：与 AC-07 同一口径 --------------------------------------- *
 * 接线口径（与 prove_anchor_coverage.mjs 的 AC-07 一致）：
 *   矩阵里字面出现 `node scripts/X` / `bash scripts/X`；
 *   或 workflow / package.json 里出现；
 *   或某个已接线的门在**非注释行**里按文件名调它（传递接线）。
 */
const matrixText = fs.readFileSync(MATRIX, "utf8");
function wiredSet(text) {
  const wired = new Set();
  for (const m of text.matchAll(/(?:node|bash|sh)\s+"?([\w./-]*\/)?([\w.-]+\.(?:mjs|js|sh))"?/g)) {
    if (!m[2].includes("$")) wired.add(m[2]);
  }
  for (const m of text.matchAll(/for\s+(\w+)\s+in\s+([^\n;]+);?\s*do\b/g)) {
    const v = m[1];
    const tail = text.slice(m.index).split("\n").slice(0, 12).join("\n");
    const t = new RegExp('node\\s+"([^"]*\\$\\{?' + v + '\\}?[^"]*\\.(?:mjs|js|sh))"');
    const call = t.exec(tail);
    if (!call) continue;
    for (const it of m[2].trim().split(/\s+/)) {
      wired.add(path.basename(call[1].replace(new RegExp("\\$\\{?" + v + "\\}?"), it)));
    }
  }
  return wired;
}
let ciText = "";
for (const pj of ["package.json", "hosts/desktop/package.json"]) {
  const abs = path.join(REPO, pj);
  if (fs.existsSync(abs)) ciText += fs.readFileSync(abs, "utf8");
}
const wfDir = path.join(REPO, ".github/workflows");
if (fs.existsSync(wfDir)) {
  for (const f of fs.readdirSync(wfDir)) ciText += fs.readFileSync(path.join(wfDir, f), "utf8");
}
function expand(seed) {
  const queue = [...seed];
  const seen = new Set(queue);
  const gateSet = new Set(onDisk);
  while (queue.length) {
    const n = queue.shift();
    const base = path.basename(n);
    if (!gateSet.has(base)) continue; /* 只往门形状的文件里走（矩阵自身不是门） */
    const abs = path.join(SCRIPTS, base);
    if (!fs.existsSync(abs) || !/\.(mjs|js|sh)$/.test(n)) continue;
    for (const ln of fs.readFileSync(abs, "utf8").split("\n")) {
      if (/^\s*(\/\/|\*|\/\*|#)/.test(ln)) continue;
      for (const m of ln.matchAll(/[\w.-]+\.(?:mjs|js|sh)\b/g)) {
        const cand = m[0];
        if (!gateSet.has(cand) || seen.has(cand)) continue;
        seen.add(cand);
        queue.push(cand);
      }
    }
  }
  return seen;
}
const wired = expand(new Set([...wiredSet(matrixText), ...onDisk.filter((n) => ciText.includes(n))]));
const orphans = onDisk.filter((n) => !wired.has(n));
const baseline = Number(manifest.orphan_baseline);
if (!Number.isFinite(baseline)) {
  bad("清单里没有 orphan_baseline（孤门基线必须钉住）");
} else if (orphans.length > baseline) {
  bad("孤门不得超过 " + baseline + "（每一条孤门都要么字面接进矩阵，要么明确退役并写明理由）",
    "实测 " + orphans.length + "：" + orphans.join(", "));
} else if (orphans.length < baseline) {
  ok("孤门 " + orphans.length + " < 基线 " + baseline);
} else {
  ok("孤门 " + orphans.length + " = 基线 " + baseline + "（每个门都有去处：字面接进矩阵或明确退役）");
}

/* ---- 4. 清单里写死的「孤门逐个处置」必须与磁盘对得上 --------------------- *
 * disposition = wired   ⇒ 文件必须还在磁盘上，且**确实被接线**（不是只在清单里写了一句）
 * disposition = retired ⇒ 文件必须已经不在 scripts/ 顶层（退役要落地，不能只是口头退役） */
const disp = manifest.orphan_dispositions || [];
const badWired = [], badRetired = [], notWired = [];
for (const d of disp) {
  const onDiskNow = fs.existsSync(path.join(SCRIPTS, d.file));
  if (d.disposition === "retired") {
    if (onDiskNow) badRetired.push(d.file);
  } else {
    if (!onDiskNow) badWired.push(d.file);
    else if (!wired.has(d.file)) notWired.push(d.file);
  }
}
if (badRetired.length) bad("清单写着「已退役」但文件还在 scripts/ 顶层（退役要落地）", badRetired.join(", "));
if (badWired.length) bad("清单写着「已接线」但文件不在 scripts/ 顶层", badWired.join(", "));
if (notWired.length) bad("清单写着「已接线」但 AC-07 口径读出来它**没人跑**", notWired.join(", "));
if (!badRetired.length && !badWired.length && !notWired.length) {
  ok("清单里逐个处置的 " + disp.length + " 条孤门与磁盘对得上（"
    + disp.filter((d) => d.disposition === "wired").length + " 条接线、"
    + disp.filter((d) => d.disposition === "retired").length + " 条退役）");
}

console.log("\ngate_roster_check: PASS=" + pass + " FAIL=" + fail + " SKIP=0");
process.exit(fail === 0 ? 0 : 1);
