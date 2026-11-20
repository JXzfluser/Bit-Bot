#!/usr/bin/env node
/* prove_anchor_coverage.mjs — 矩阵锚点的覆盖尺（AC-01..AC-06）
 *
 * 缘起：§8.173 的 G-41 锚点恒红（grep 的句子门从来没打印过）、§8.174 的 M41-03/04 与
 * M44-06 是「门在打印、矩阵没人看守」。这两件事原本只能逐族人工读出来。这条尺把静态可判
 * 的那一半变成数 —— 并把口径写准：口径写错的话首测读出的「漏钉 959 条」会把人带偏。
 *
 *   门自己的 exit 已经看守「断言变红」：任一 FAIL 就让 status 那行红。所以锚点不是拿来
 *   抓失败的，是拿来抓「断言消失了 / 条数变了 / 判据被做成恒真」的。一条门的断言被整段删掉
 *   时，PASS 从 38 掉到 37、FAIL=0、exit=0，矩阵照绿。拦得住这件事的只有两种看守：
 *     (A) 逐条锚点 —— 每条断言各有一条 grep 锚点（散文或 [XX-0N] 编号），且锚点数 >= 断言数；
 *     (B) 计数锚点 —— 矩阵对这份日志的 ✓ 条数或 PASS=n 做了数值比较；
 *     (C) 两者都没有 —— 只有 exit 看守，删断言不痛不痒。AC-03 的 ratchet 钉 C 的份数。
 *
 *   仍然测不出来的（别把这条尺读成「锚点全对」）：
 *     - 恒红方向：锚点串是否真出现在门输出里，要跑门才知道。这里只在 AC-02 用「编号族的
 *       锚点数必须等于编号数」按住最容易恒红的那个形状，其余靠 §8.173 那类逐案复核。
 *     - 判据恒真方向：那是各门自己的负向对照负责的事，AC-06 只数哪些门连负向对照都没有。
 *
 *   尺自己踩过的坑（写在这里免得下一条尺再踩）：编号族的 ID 前缀本身带数字（M41-01），
 *   早先三处正则都写成 [A-Z]+-\d+，整族读出 0 条 —— AC-02 因此连报五版 SKIP。
 *   前缀必须是 [A-Z][A-Z0-9]*-\d+。
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const MATRIX = "scripts/smoke_grok_desktop_parity.sh";

/* AC-03 的 ratchet：C 类（只有 exit 看守）的份数上限。只许往下改。 */
const PINNED_C_GATES = 88; /* 2026-11-20 实测：编号族认出后 101→98，`_a` 族按条目数补足后 88 */
/* AC-06 的 ratchet：完全没有负向/反向对照的份数上限。同样只许往下改。 */
const PINNED_NO_NEGCTRL = 48; /* 2026-11-20 实测 48 份 */
/* AC-07 的 ratchet：任何 CI 路径都不跑的门数上限。只许往下改。 */
const PINNED_ORPHAN_GATES = 77; /* 2026-11-20 首测 86；接回 G-46 的 8 条真渲染门后 78；再接回 G-127 的 spec 门后 77 */

let pass = 0, fail = 0, skip = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const sk = (m, d) => { skip++; console.log("  - SKIP " + m + (d ? " — " + String(d) : "")); };
const all = process.argv.includes("--all");

const s0 = fs.readFileSync(path.join(REPO, MATRIX), "utf8");
const lines = s0.split("\n");

const logs = new Map();
const ensure = (k) => {
  if (!logs.has(k)) logs.set(k, { gates: new Set(), anchors: 0, ids: null, idLoop: false, countPin: 0 });
  return logs.get(k);
};

/* 编号族的循环不在这儿认 —— 由下面的 parseFams 逐行配对（它同时喂 AC-02 与 AC-05）。 */
for (const ln of lines) {
  const gate = /node\s+(\S*(?:prove|diagnose)[\w.-]*\.m?js)[^>]*>\s*(\/tmp\/[\w.-]+\.log)/.exec(ln);
  if (gate) ensure(gate[2]).gates.add(gate[1]);

  /* 编号循环的 grep 必须先判：否则下面那条散文正则会把 "\[$g41_id\]" 当普通字面量吞掉
     （首测就是这样让编号族整族空转的）。 */
  const anchId = /grep\s+-q\s+"\\\[\$g(\w+)_id\\\]"\s+(\/tmp\/[\w.-]+\.log)/.exec(ln);
  if (anchId) { ensure(anchId[2]).idLoop = true; continue; }

  const anch = /grep\s+-q\s+"((?:[^"\\]|\\.)*)"\s+(\/tmp\/[\w.-]+\.log)/.exec(ln);
  if (anch) { ensure(anch[2]).anchors++; continue; }

  /* 计数锚点：这份日志的 ✓ 条数或 PASS= 数值被拿去做比较。
     注意 `$(grep -c '✓' …)` 只是印在 ok 的消息里，不算看守 —— 只认出现在比较里的。 */
  const cmp = /\[\s*"?\$\(\s*grep\s+-c/.test(ln)
    || /grep\s+-q\s+"PASS=\d+/.test(ln)
    || /\$\(\s*grep\s+-c[^\n]*\)\s*(-ge|-le|-eq|-gt|-lt)/.test(ln);
  if (cmp) {
    const lg = /(\/tmp\/[\w.-]+\.log)/.exec(ln);
    if (lg) ensure(lg[1]).countPin++;
  }
}

/* `_a` 族：矩阵最常用的逐条锚点形状是一行 grep 展开成 N 条 ——
 *   for gXX_a in "ID-01" "ID-02" …; do … grep -q "✓ $gXX_a" /tmp/….log …
 * 主循环只能看见那一条 grep 文本，会把 N 条锚点读成 1 条（首测就是这样把 26 条锚点的
 * 群当只有 1 条，整族落进 C）。这里按循环头的条目数补足。 */
{
  const reA = /^for\s+g(\w+)_a\s+in\b/;
  for (let i = 0; i < lines.length; i++) {
    const h = reA.exec(lines[i]);
    if (!h) continue;
    /* 条目可能用反斜杠续行（gp166/gp168 那几族）：把头往后拼到见到 `; do` 为止。 */
    let buf = "", k = i;
    for (; k < Math.min(lines.length, i + 20); k++) {
      buf += " " + lines[k].replace(/^for\s+g\w+_a\s+in\b/, " ");
      if (/;\s*do\s*$/.test(buf.trim())) break;
      if (!/\\\s*$/.test(lines[k])) break;
    }
    const n = (buf.match(/"[^"]*"/g) || []).length;
    if (!n || !/;\s*do\s*$/.test(buf.trim())) continue;
    const needle = 'grep -q "✓ $g' + h[1] + '_a"';
    for (let j = k; j < Math.min(lines.length, k + 6); j++) {
      if (!lines[j].includes(needle)) continue;
      const lg = /(\/tmp\/[\w.-]+\.log)/.exec(lines[j]);
      if (lg) ensure(lg[1]).anchors += n - 1; /* 主循环已按 1 条计入 */
      break;
    }
    i = k;
  }
}

function gateStats(rel) {
  const src = fs.readFileSync(path.join(REPO, rel), "utf8");
  const ids = new Set();
  for (const m of src.matchAll(/ok\("\[([A-Z][A-Z0-9]*-\d+)\]/g)) ids.add(m[1]);
  /* 编号也可能只以**实参**出现（prove_m41_cn.js 把 id 传给 localizedByKey）。
     只认逗号后面的位置实参：上一版认任意引号内的编号，结果这条尺把自己 AC-05 里
     引用的一句 p.includes("M41-07") 读成了「本门声明的编号」，把 8 条散文断言误判成 1 条编号断言。 */
  for (const m of src.matchAll(/,\s*"([A-Z][A-Z0-9]*-\d{2}[a-z]?)"/g)) ids.add(m[1]);
  let clauses, shape;
  if (ids.size) { clauses = ids.size; shape = "编号"; }
  else {
    const calls = (src.match(/\bok\(/g) || []).length;
    const defs = (src.match(/(?:const|let|function)\s+ok\s*[=(]/g) || []).length;
    clauses = Math.max(0, calls - defs); shape = "散文";
  }
  const negCtrl = /负向对照|反向对照|反向夹具|negative control|恒真/.test(src);
  return { clauses, shape, negCtrl, ids };
}

const rows = [];
for (const [log, rec] of [...logs].sort()) {
  if (!rec.gates.size) continue;
  let clauses = 0; const shapes = new Set(); const files = []; let neg = false; const famIds = new Set();
  for (const g of rec.gates) {
    const abs = path.join(REPO, g);
    if (!fs.existsSync(abs)) { files.push(path.basename(g) + "（文件不在）"); continue; }
    const c = gateStats(g);
    clauses += c.clauses; shapes.add(c.shape); neg = neg || c.negCtrl;
    for (const id of c.ids) famIds.add(id);
    files.push(path.basename(g) + "=" + c.clauses);
  }
  if (rec.idLoop) {
    /* 矩阵用的是 for gXX_id 循环：锚点条数 = 门声明的编号条数，一条 grep 行展开成 N 条锚点。
       编号集以门源码为准 —— 矩阵里那行循环文本不算契约。 */
    rec.ids = famIds.size ? famIds : null;
    rec.anchors = rec.ids ? rec.ids.size : rec.anchors;
  }
  const perClause = rec.anchors > 0 && rec.anchors >= clauses;
  const kind = perClause ? "A" : (rec.countPin > 0 ? "B" : "C");
  rows.push({ log, clauses, anchors: rec.anchors, countPin: rec.countPin, kind, neg,
    shape: [...shapes].join("+"), files, ids: rec.ids });
}

if (!rows.length) bad("[AC-01] 至少解析出一份带门的 probe 日志", "rows=0，先怀疑解析器自己");
else ok("[AC-01] 解析出 " + rows.length + " 份带门的 probe 日志（矩阵共 " + logs.size + " 份日志），"
  + "断言合计 " + rows.reduce((a, r) => a + r.clauses, 0)
  + "、逐条锚点合计 " + rows.reduce((a, r) => a + r.anchors, 0)
  + "、计数锚点合计 " + rows.reduce((a, r) => a + r.countPin, 0));

const byKind = { A: [], B: [], C: [] };
for (const r of rows) byKind[r.kind].push(r);
console.log("  · A 逐条锚点齐全 " + byKind.A.length + " 份 / B 只钉条数 " + byKind.B.length
  + " 份 / C 只有 exit 看守 " + byKind.C.length + " 份");

const fmt = (r) => "      " + r.kind + " " + r.log.replace(/^\/tmp\//, "").replace(/-probe\.log$/, "")
  + "：断言 " + r.clauses + "、锚点 " + r.anchors + "、计数钉 " + r.countPin + "（" + r.files.join(", ") + "）";
const listC = byKind.C.map(fmt);
console.log((all ? listC : listC.slice(0, 10).concat(byKind.C.length > 10
  ? ["      …另有 " + (byKind.C.length - 10) + " 份（--all 看全清单）"] : [])).join("\n"));
/* --all 也要看得见 A/B：否则「谁是 A」只能靠总数反推，这条尺就成了只给分数的黑盒。 */
if (all) {
  console.log("  · A 类清单：\n" + byKind.A.map(fmt).join("\n"));
  console.log("  · B 类清单：\n" + (byKind.B.length ? byKind.B.map(fmt).join("\n") : "      （空 —— 矩阵里没有任何计数锚点）"));
}

/* AC-02：编号族必须「门声明的编号」与「矩阵循环里的编号」一一对应。
   逐行配对：循环头行 → 同一个 case/esac 之后那条 [$gXX_id] 锚点行。
   之前用 indexOf 在整份文本里扫 "for g" 试了五版都空转（"_id in " 的定位会把上一族的
   尾部算成变量名），而矩阵的循环本来就是单行形状，逐行判既短又可读。 */
function parseFams(ls) {
  const out = [];
  const reHead = /^for\s+g(\w+)_id\s+in\s+(.+?);\s*do\s*$/;
  for (let i = 0; i < ls.length; i++) {
    const head = reHead.exec(ls[i]);
    if (!head) continue;
    const varName = head[1];
    const ids = head[2].trim().split(/\s+/).filter((x) => /^[A-Z][A-Z0-9]*-\d+$/.test(x));
    const needle = 'grep -q "\\[$g' + varName + '_id\\]"';
    for (let j = i + 1; j < Math.min(ls.length, i + 40); j++) {
      if (!ls[j].includes(needle)) continue;
      const lg = /(\/tmp\/[\w.-]+\.log)/.exec(ls[j]);
      if (lg && ids.length) out.push({ varName, ids, log: lg[1] });
      break;
    }
  }
  return out;
}

function famProblems(fams) {
  const probs = [];
  for (const f of fams) {
    const rec = logs.get(f.log);
    if (!rec || !rec.gates.size) { probs.push(f.log + "：找不到对应的门"); continue; }
    const declared = new Set();
    for (const g of rec.gates) {
      if (!fs.existsSync(path.join(REPO, g))) continue;
      for (const id of gateStats(g).ids) declared.add(id);
    }
    const missing = [...f.ids].filter((id) => !declared.has(id));
    const unwatched = [...declared].filter((id) => !f.ids.includes(id));
    if (missing.length) probs.push(f.log + "：矩阵锚了点上门里没有的号 " + missing.join(","));
    if (unwatched.length) probs.push(f.log + "：门声明了却没人锚 " + unwatched.join(","));
  }
  return probs;
}

const fams = parseFams(lines);
if (!fams.length) sk("[AC-02] 没找到任何编号族", "G-41/G-44 的循环形状若被改回散文，这条就该红 —— 现在先如实 SKIP");
else {
  const probs = famProblems(fams);
  if (probs.length) bad("[AC-02] 编号族的锚点与编号必须一一对应", probs.join(" / "));
  else ok("[AC-02] 编号族 " + fams.length + " 族一一对应："
    + fams.map((f) => f.log.replace(/^\/tmp\//, "").replace(/-probe\.log$/, "") + "(" + f.ids.length + ")").join(", "));
}

/* AC-03：C 类份数的 ratchet */
const cGates = byKind.C.length;
if (cGates > PINNED_C_GATES) bad("[AC-03] 只有 exit 看守的份数不得超过 " + PINNED_C_GATES,
  "实测 " + cGates + " —— 有新门的断言没配任何锚点");
else if (cGates < PINNED_C_GATES) ok("[AC-03] C 类 " + cGates + " < 上限 " + PINNED_C_GATES + "（把常量改成 " + cGates + " 钉住成果）");
else ok("[AC-03] C 类 " + cGates + " = 上限 " + PINNED_C_GATES + "（持平；每清一族往下调）");

/* AC-04：这条尺必须自己也被矩阵跑到，否则它对全量矩阵是零 */
{
  const registered = lines.some((l) => l.includes("prove_anchor_coverage"));
  if (!registered) bad("[AC-04] 这条尺没登记进矩阵", "smoke_grok_desktop_parity.sh 里找不到 prove_anchor_coverage 的调用 —— 尺再对，不跑就是零");
  else ok("[AC-04] 尺自己已登记进矩阵（全量跑会带上它）");
}

/* AC-05：反向对照 —— 少钉一个编号，AC-02 的解析器必须自己喊出来 */{
  const src = fs.readFileSync(path.join(REPO, MATRIX), "utf8").split("\n");
  const full = "for g41_id in M41-01 M41-02 M41-03 M41-04 M41-05 M41-06 M41-07; do";
  let hit = false;
  const mutated = src.map((l) => {
    if (l !== full) return l;
    hit = true;
    return "for g41_id in M41-01 M41-02 M41-03 M41-04 M41-05 M41-06; do";
  });
  if (!hit) bad("[AC-05] 反向对照没做成", "矩阵里找不到 G-41 编号循环原样，先确认锚点形状还在");
  else {
    const before = parseFams(src).find((f) => f.varName === "41");
    const after = parseFams(mutated).find((f) => f.varName === "41");
    const probs = famProblems(parseFams(mutated));
    if (!before || !after) bad("[AC-05] 反向对照没做成", "解析器读不到 G-41 族（before=" + !!before + " after=" + !!after + "）");
    else if (before.ids.length === 7 && after.ids.length === 6
      && probs.some((p) => p.includes("/tmp/g41-probe.log") && p.includes("M41-07"))) {
      ok("[AC-05] 反向对照：G-41 少钉一号 → 锚点 " + before.ids.length + " 掉到 " + after.ids.length
        + "，AC-02 当场报「门声明了却没人锚 M41-07」（尺对漏钉灵敏）");
    } else bad("[AC-05] 反向对照读数不对", "before=" + before.ids.length + " after=" + after.ids.length
      + " probs=" + (probs.join(" / ") || "空"));
  }
}

/* AC-06：连负向对照都没有的门（判据被做成恒真时没人抓） */
{
  const noNeg = rows.filter((r) => !r.neg);
  console.log("  · 无负向对照的 probe 日志 " + noNeg.length + " 份："
    + (all ? noNeg.map((r) => r.log.replace(/^\/tmp\//, "")).join(", ")
      : noNeg.slice(0, 8).map((r) => r.log.replace(/^\/tmp\//, "")).join(", ")
        + (noNeg.length > 8 ? " …（--all 看全）" : "")));
  if (noNeg.length > PINNED_NO_NEGCTRL) bad("[AC-06] 无负向对照的份数不得超过 " + PINNED_NO_NEGCTRL, "实测 " + noNeg.length);
  else if (noNeg.length < PINNED_NO_NEGCTRL) ok("[AC-06] 无负向对照 " + noNeg.length + " < 上限 " + PINNED_NO_NEGCTRL + "（往下调常量）");
  else ok("[AC-06] 无负向对照 " + noNeg.length + " = 上限 " + PINNED_NO_NEGCTRL);
}

/* AC-07：孤门 —— 门写了、报告里拿它当过证据，但任何 CI 路径都不跑它。
 *
 *   缘起（2026-11-20）：按字面文件名数「谁调用 e2e_*」读出 15 个孤门，实际是 10 个 ——
 *   G-46 的 `for g in … ; do node "scripts/e2e_desktop_$g.mjs"` 把 8 条门的文件名拼在变量里
 *   （token_parity/quit/command_channel/…），字面 grep 一条也看不见。所以这条尺必须自己
 *   展开循环，否则它给的不是「有没有人跑」而是「有没有人按某种写法跑」。
 *   同一条教训也说明 AC-01 的门发现正则（只认字面 prove|diagnose）对 27 条 e2e 门是瞎的 ——
 *   那一半的锚点覆盖仍未量，写在这里不当已知。
 *
 *   接线口径：矩阵里字面出现 / 循环展开后出现 / workflow 或 package.json 里出现 /
 *   被某个已接线的脚本在非注释行里按文件名调用（传递接线）。
 *   注释里提一句不算跑过 —— 上一版就是这样把 e2e_desktop_token_parity 当成「docs 引用」的。
 *
 * AC-08：反向对照 —— 把一条已知孤门假装塞进矩阵，孤门数必须 -1 且它自己出清单。 */
{
  const dir = path.join(REPO, "scripts");
  const gateNames = fs.readdirSync(dir).filter((f) => /^(prove|e2e|diagnose)_[\w.-]+\.(mjs|js|sh)$/.test(f));

  function wiredSet(matrixText) {
    const wired = new Set();
    for (const m of matrixText.matchAll(/node\s+"?([\w./-]*\/)?([\w.-]+\.(?:mjs|js|sh))"?/g)) {
      if (!m[2].includes("$")) wired.add(m[2]);
    }
    /* for VAR in a b c; do … node "scripts/pre$VAR.suf" … —— 在循环头之后 12 行内找拼名调用 */
    for (const m of matrixText.matchAll(/for\s+(\w+)\s+in\s+([^\n;]+);?\s*do\b/g)) {
      const v = m[1];
      const tail = matrixText.slice(m.index).split("\n").slice(0, 12).join("\n");
      const t = /node\s+"([^"]*\$\{?V\}?[^"]*\.(?:mjs|js|sh))"/.source.replace("V", v);
      const call = new RegExp(t).exec(tail);
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
  for (const f of fs.readdirSync(wfDir)) ciText += fs.readFileSync(path.join(wfDir, f), "utf8");

  /* 传递接线：从矩阵/workflow 直接接的门出发，看它们的源码里有没有按文件名跑别的门。
     只看非注释行，行首 /* 与 // 都不算。
     .sh 也要展开 —— 仓里成对写着的 prove_X.js + prove_X.sh 是「外壳调内层」的形状，
     上一版只走 .mjs/.js，结果接了 .sh 的那批 .js 全被读成孤门（首测 87 个里 30+ 是这样来的）。 */
  function expand(seed) {
    const queue = [...seed];
    const seen = new Set(queue);
    while (queue.length) {
      const n = queue.shift();
      const abs = path.join(REPO, "scripts", path.basename(n));
      if (!fs.existsSync(abs) || !/\.(mjs|js|sh)$/.test(n)) continue;
      for (const ln of fs.readFileSync(abs, "utf8").split("\n")) {
        if (/^\s*(\/\/|\*|\/\*|#)/.test(ln)) continue;
        for (const cand of gateNames) {
          if (seen.has(cand) || !ln.includes(cand)) continue;
          seen.add(cand);
          queue.push(cand);
        }
      }
    }
    return seen;
  }

  const wired = expand(new Set([...wiredSet(s0), ...gateNames.filter((n) => ciText.includes(n))]));
  const orphans = gateNames.filter((n) => !wired.has(n));
  const orphanClauses = orphans.reduce((a, n) => a + (fs.existsSync(path.join(dir, n)) ? gateStats("scripts/" + n).clauses : 0), 0);
  console.log("  · 矩阵+CI 接线的门 " + wired.size + " 个 / scripts 下共 " + gateNames.length
    + " 个 gate 形状文件；孤门 " + orphans.length + " 个、合计断言 " + orphanClauses + " 条");
  if (all) console.log("  · 孤门清单：" + (orphans.join(", ") || "（空）"));

  if (orphans.length > PINNED_ORPHAN_GATES) {
    bad("[AC-07] 没人跑的门不得超过 " + PINNED_ORPHAN_GATES,
      "实测 " + orphans.length + "：" + orphans.slice(0, 6).join(", ") + (orphans.length > 6 ? " …" : "")
      + " —— 这些门的绿灯不会让任何 CI 变红");
  } else if (orphans.length < PINNED_ORPHAN_GATES) {
    ok("[AC-07] 孤门 " + orphans.length + " < 上限 " + PINNED_ORPHAN_GATES + "（把常量改成 " + orphans.length + " 钉住成果）");
  } else {
    ok("[AC-07] 孤门 " + orphans.length + " = 上限 " + PINNED_ORPHAN_GATES + "（持平；每接一条往下调）");
  }

  /* AC-08 反向对照：拿清单里第一条真孤门，在矩阵文本上假装加一行 `node scripts/X.mjs`，
     它必须离开孤门集。上一版是把门名塞进 G-46 的 `for g in` 循环，但那个循环会给名字加
     e2e_desktop_ 前缀和 .mjs 后缀 —— 拿 diagnose_surfaces.mjs 去塞只拼出
     e2e_desktop_diagnose_surfaces.mjs.mjs，假装接线没做成，读出的还是 87。 */
  if (!orphans.length) sk("[AC-08] 没有孤门可做反向对照", "孤门清零后这条改判据：假装删一条已接线的门，它应当变孤门");
  else {
    const probe = orphans[0];
    const mutated = s0 + '\nnode scripts/' + probe + ' > /tmp/ac08-mutation.log 2>&1\n';
    const w2 = expand(new Set([...wiredSet(mutated), ...gateNames.filter((n) => ciText.includes(n))]));
    const o2 = gateNames.filter((n) => !w2.has(n));
    if (o2.length === orphans.length - 1 && !o2.includes(probe)) {
      ok("[AC-08] 反向对照：把 " + probe + " 假装接进矩阵 → 孤门 " + orphans.length + " 掉到 " + o2.length
        + "，且它自己出清单（尺对「没人跑」灵敏）");
    } else {
      bad("[AC-08] 反向对照读数不对", probe + " 接线后 orphans=" + o2.length + " 含" + probe + "=" + o2.includes(probe));
    }
  }
}

console.log("\nprove_anchor_coverage: PASS=" + pass + " FAIL=" + fail + " SKIP=" + skip);
process.exit(fail === 0 ? 0 : 1);
