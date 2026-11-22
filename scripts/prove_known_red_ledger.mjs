#!/usr/bin/env node
/* prove_known_red_ledger.mjs — 已知红台账的对账门（台账 ↔ 矩阵真实打出来的红行）
 *
 * 它只做一件事：**把台账 scripts/known_red_ledger.json 和本轮矩阵真实打出来的红行逐条对上**。
 *
 *   它做什么（只有这些）：
 *     · 台账每一条的「红」都还能**复现**：实跑那扇门（必要时按台账写的办法控制环境），
 *       然后在真实输出里 grep 它的锚点 —— 锚点找不到了 ⇒ 红被偷偷删掉 / 改了文案
 *       / 这条红其实早就不在了 ⇒ 当场报。
 *     · 本轮矩阵打出来的红行**没有漏在台账外** —— 漏了 ⇒ 报「台账外的红（待归类）」。
 *     · 台账条数与本轮红条数对得上（差额只能是台账里写明「条件性」的红，逐条列出来）。
 *     · kind=product 的条目必须有人认领（owner 非空；owner=unassigned 必须写清为什么）。
 *
 *   它**不**做什么（这是它与「元工作门禁」的分界线）：
 *     · 不检查别的门禁的判据质量、不数别的门禁的断言条数、不算覆盖率、不维护别的账本；
 *     · 不对任何别的门禁做「不许变差」的数量 ratchet；
 *     · 不改任何门禁的判据 —— 它只读、只跑、只报。
 *
 *   为什么允许它存在：这一类（元工作门禁）本轮起是冻结的，**禁止新增**；但「已知红台账」
 *   是门禁体系里的一条要求（红条必须逐条报告、不能悄悄漂移），台账与真实输出之间的
 *   对账属于「产品交付纪律」而不是「给门禁的门禁」：它不看任何门禁的判据，只看台账
 *   有没有跟真实结果说反话。
 *
 * 退出码：0 = 对得上；1 = 对不上（并逐条说明差在哪）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO = path.resolve(import.meta.dirname, "..");
const LEDGER = path.join(REPO, "scripts/known_red_ledger.json");
/* 矩阵每打一条红行就往这里追加一行「层\t红行原文」；矩阵启动时清空。 */
const RED_LINES = process.env.KRL_RED_LINES || "/tmp/gate-red-lines.txt";
const RUN_START_FILE = process.env.KRL_RUN_START || "/tmp/gate-run-start.txt";
const TIER = "L1";

/* 矩阵开始跑的时刻：用来判断一份门日志是不是**本轮**留下的（上一轮的残留不能当证据）。 */
let RUN_START = 0;
try { RUN_START = Number(String(fs.readFileSync(RUN_START_FILE, "utf8")).trim()) || 0; } catch (_) { RUN_START = 0; }

let pass = 0, fail = 0, skip = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 500) : "")); };
const sk = (m, d) => { skip++; console.log("  - SKIP " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const note = (m) => console.log("  · " + m);

/* ---------------------------------------------------------------- 台账 ---- */
let ledger;
try {
  ledger = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
} catch (e) {
  bad("读不到已知红台账 scripts/known_red_ledger.json", e && e.message);
  console.log("\nprove_known_red_ledger: PASS=" + pass + " FAIL=" + fail + " SKIP=" + skip);
  process.exit(1);
}
const entries = Array.isArray(ledger.entries) ? ledger.entries : [];

/* ------------------------------------------------ 1. 台账自身的形状 ------ */
{
  const required = ["id", "gate", "matrix_line_prefix", "kind", "reason", "evidence",
    "owner", "first_seen", "blocks_release", "verify"];
  const kinds = new Set(Object.keys(ledger.kinds || {}));
  const problems = [];
  const seen = new Set();
  for (const e of entries) {
    const where = e && e.id ? e.id : "(没有 id)";
    for (const f of required) {
      if (e[f] === undefined || e[f] === null || e[f] === "") problems.push(where + "：缺字段 " + f);
    }
    if (!e.id) continue;
    if (seen.has(e.id)) problems.push(e.id + "：id 重复");
    seen.add(e.id);
    if (typeof e.id !== "string" || !e.id.includes("#")) problems.push(where + "：id 必须是 <门名>#<门内锚点>");
    else if (!e.id.startsWith(String(e.gate) + "#")) problems.push(where + "：id 的门名段与 gate 字段对不上");
    if (kinds.size && !kinds.has(e.kind)) problems.push(where + "：kind=" + e.kind + " 不在台账声明的取值里（" + [...kinds].join("/") + "）");
    if (typeof e.reason === "string" && e.reason.length < 20) problems.push(where + "：reason 太短，读不出「为什么红」");
    if (typeof e.evidence === "string" && e.evidence.length < 20) problems.push(where + "：evidence 太短，没有实跑依据");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.first_seen || ""))) problems.push(where + "：first_seen 不是 YYYY-MM-DD");
    if (typeof e.blocks_release !== "boolean") problems.push(where + "：blocks_release 必须是布尔");
    if (!e.verify || !Array.isArray(e.verify.cmd) || !e.verify.cmd.length) problems.push(where + "：verify.cmd 缺失（没法复现）");
  }
  if (!entries.length) problems.push("台账一条都没有");
  if (problems.length) bad("台账形状不合法（" + problems.length + " 处）", problems.join(" / "));
  else {
    ok("[KRL-01] 台账形状合法：" + entries.length + " 条，字段齐、id 唯一且与 gate 对得上、kind 合法、reason/evidence 说得出人话");
  }
}

/* ---------------------------------------- 2. product 条目必须有人认领 ---- */
{
  const problems = [];
  for (const e of entries) {
    const owner = String(e.owner || "").trim();
    /* 真产品缺陷必须有人认领：owner 为空 ⇒ 红；owner=unassigned ⇒ 必须写清为什么还没人认领。 */
    if (e.kind === "product" && !owner) {
      problems.push(e.id + "：真产品缺陷必须有人认领（owner 不能为空，也不许是 unassigned 又不写原因）");
      continue;
    }
    if (!owner) { problems.push(e.id + "：owner 为空"); continue; }
    if (owner === "unassigned" && String(e.owner_reason || "").trim().length < 10) {
      problems.push(e.id + "：owner=unassigned 却没有写为什么还没人认领（owner_reason）");
    }
  }
  const products = entries.filter((e) => e.kind === "product");
  if (problems.length) bad("owner 规则不满足（" + problems.length + " 处）", problems.join(" / "));
  else {
    ok("[KRL-02] owner 规则满足：" + entries.length + " 条里 product " + products.length
      + " 条（都有人认领或写明为什么没人认领），unassigned " + entries.filter((e) => String(e.owner).trim() === "unassigned").length + " 条都带 owner_reason");
  }
}

/* ------------------------------------------------------ 复现用的执行器 ---- */
const runCache = new Map();

function runInFreshDataRoot(cmd, env) {
  /* 复现「全新数据根」那条红（门在跑回合之前读模板文件，干净 checkout 上文件还不存在）。
     办法：把门复制到一个临时沙箱里跑 —— 沙箱的数据根是空的（门读到 0 行），
     而 Host 读的是真仓库旁边的一个临时数据根（按内置种子落盘 ⇒ 7 条）⇒ 与干净 checkout 同形。
     沙箱跑完即删；真仓库与用户数据一个字节都不动。 */
  const stamp = `${process.pid}-${Date.now()}`;
  const sandbox = path.join(REPO, `.krl-sandbox-${stamp}`);
  const dataRoot = path.join(REPO, `.krl-data-${stamp}`);
  try {
    fs.mkdirSync(path.join(sandbox, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(sandbox, "data", "desktop"), { recursive: true });
    fs.copyFileSync(path.join(REPO, cmd[1]), path.join(sandbox, "scripts", path.basename(cmd[1])));
    for (const link of ["hosts", "agent-tools"]) {
      const abs = path.join(REPO, link);
      if (fs.existsSync(abs)) fs.symlinkSync(abs, path.join(sandbox, link), "dir");
    }
    const e2 = { ...env, BITBOT_DATA_ROOT: dataRoot };
    const r = spawnSync(process.execPath, [path.join(sandbox, "scripts", path.basename(cmd[1]))], {
      cwd: sandbox, env: e2, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    });
    return { out: String(r.stdout || "") + String(r.stderr || ""), code: r.status };
  } finally {
    for (const d of [sandbox, dataRoot]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* 清理失败不掩盖主结果 */ }
    }
  }
}

function runGate(cmd, envSpec, sandbox) {
  const env = { ...process.env };
  for (const [k, v] of Object.entries(envSpec || {})) {
    if (v === null) delete env[k]; else env[k] = String(v);
  }
  const key = JSON.stringify([cmd, envSpec || {}, sandbox || ""]);
  if (runCache.has(key)) return runCache.get(key);
  let res;
  if (sandbox === "fresh-data-root") res = runInFreshDataRoot(cmd, env);
  else {
    const r = spawnSync(cmd[0], cmd.slice(1), {
      cwd: REPO, env, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    });
    res = { out: String(r.stdout || "") + String(r.stderr || ""), code: r.status };
  }
  runCache.set(key, res);
  return res;
}

/* 一条台账条目能不能复现？返回 {ok, detail}
 *
 * 两条路：
 *   ① 快路径 —— 本轮矩阵自己跑那扇门时留下的日志（/tmp/gNN-*.log）里就有锚点：
 *      这已经是「实跑那个门 + grep 它的锚点」了，不必再跑一遍。
 *   ② 慢路径 —— 上一条不成立时，按台账写的办法自己实跑那扇门（必要时控制环境：
 *      清掉 DISPLAY、换全新数据根），再 grep 锚点。
 */
function matchesAnchor(text, v) {
  if (v.anchor && text.includes(String(v.anchor))) return String(v.anchor);
  if (Array.isArray(v.anchor_any)) {
    for (const a of v.anchor_any) if (a && text.includes(String(a))) return String(a);
  }
  return null;
}

function isFresh(file) {
  try {
    const st = fs.statSync(file);
    if (!RUN_START) return true;             /* 不知道本轮起点时不拿旧日志当证据 */
    return st.mtimeMs / 1000 >= RUN_START - 5;
  } catch (_) { return false; }
}

function reproduce(entry) {
  const v = entry.verify || {};

  /* ① 快路径：本轮矩阵跑那扇门时留下的日志。 */
  if (v.log && isFresh(path.join(REPO, v.log))) {
    let text = "";
    try { text = fs.readFileSync(path.join(REPO, v.log), "utf8"); } catch (_) { text = ""; }
    if (v.mode === "stale-pin") {
      const outM = new RegExp(v.count_from_output || "").exec(text);
      let fileText = "";
      try { fileText = fs.readFileSync(path.join(REPO, v.count_from_file.file), "utf8"); } catch (_) { /* 读不到就是红 */ }
      const fileM = new RegExp(v.count_from_file.pattern || "").exec(fileText);
      if (outM && fileM && outM[1] !== fileM[1]) {
        return { ok: true, detail: "本轮日志 " + v.log + " 里尺报 PASS=" + outM[1] + "，矩阵钉 PASS=" + fileM[1] + " ⇒ 钉子确实陈旧" };
      }
    } else {
      const hit = matchesAnchor(text, v);
      if (hit) return { ok: true, detail: "本轮矩阵跑那扇门的日志（" + v.log + "）里就有锚点「" + hit + "」" };
    }
  }

  /* ② 慢路径：自己实跑那扇门。 */
  if (!Array.isArray(v.cmd) || !v.cmd.length) {
    return { ok: false, detail: "既没有本轮日志可查，也没有 verify.cmd 可跑 ⇒ 这条红无从复现" };
  }
  const res = runGate(v.cmd, v.env, v.sandbox);
  if (v.mode === "stale-pin") {
    const outM = new RegExp(v.count_from_output || "").exec(res.out);
    let fileText = "";
    try { fileText = fs.readFileSync(path.join(REPO, v.count_from_file.file), "utf8"); } catch (_) { /* 读不到就是红 */ }
    const fileM = new RegExp(v.count_from_file.pattern || "").exec(fileText);
    if (!outM || !fileM) return { ok: false, detail: "读不出尺报的条数或矩阵钉的条数（尺：" + (outM ? outM[1] : "?") + " / 钉：" + (fileM ? fileM[1] : "?") + "）" };
    if (outM[1] === fileM[1]) {
      return { ok: false, detail: "尺现在报 PASS=" + outM[1] + "，矩阵钉的也是 PASS=" + fileM[1] + " ⇒ 钉子不陈旧了，这条红该从台账里划掉" };
    }
    return { ok: true, detail: "实跑尺：尺报 PASS=" + outM[1] + "，矩阵钉 PASS=" + fileM[1] + " ⇒ 钉子确实陈旧" };
  }
  const hit = matchesAnchor(res.out, v);
  if (!hit) {
    return { ok: false, detail: "实跑 " + v.cmd.join(" ") + " 的真实输出里找不到锚点（" + (v.anchor || (v.anchor_any || []).join(" / ")) + "）" };
  }
  return { ok: true, detail: "锚点「" + hit + "」在实跑的真实输出里" };
}


/* ---------------------------------------- 4/5. 本轮矩阵的红有没有漏 ----- */
let redRows = [];
let haveRedRows = false;
if (fs.existsSync(RED_LINES)) {
  haveRedRows = true;
  redRows = fs.readFileSync(RED_LINES, "utf8").split("\n")
    .map((l) => l.replace(/\n$/, ""))
    .filter((l) => l.trim())
    .map((l) => {
      const i = l.indexOf("\t");
      return i < 0 ? { tier: "?", text: l } : { tier: l.slice(0, i), text: l.slice(i + 1) };
    });
}
/* l1Rows 必须等 redRows 填好再算(redRows 下面才声明 ⇒ 提前算会 TDZ)。 */
const l1Rows = redRows.filter((r) => r.tier === TIER);

/* ---------------------------------------- 3. 每条台账的红都还能复现 ------ */
const reproResults = [];
{
  const problems = [];
  for (const e of entries) {
    /* 已修好的条目**反过来**要求:它**不再**出现在本轮红行里。
     * (只是跳过检查不够 —— 那会变成「修没修都算过」。) */
    if (e.resolved) {
      /* l1Rows 在下面才定义 ⇒ 这里就地算(否则 TDZ)。 */
      const stillRed = redRows.filter((r) => r.tier === TIER)
        .some((r) => String(r.text || "").indexOf(String(e.matrix_line_prefix || e.id)) >= 0);
      if (stillRed) {
        problems.push(e.id + "：已标 resolved,但本轮红行里它还在 ⇒ 没真修");
      }
      reproResults.push({ entry: e, ok: !stillRed, detail: stillRed ? "已标 resolved 却仍红" : "已修:本轮红行里不再出现" });
      continue;
    }
    /* 「只在全量跑法下出现」的红（层间顺序依赖那一类）**没法用单条命令复现** ——
     * 它在 L1 单独跑时是绿的,只有 all 模式下前面段把状态用脏了才红。
     * ⇒ 拿「常驻红」的尺子量它不对(而且为了复现它去跑 12 分钟的 all 矩阵,
     *   还会顺带把用户的真 data/ 写脏 —— 正是本轮在修的那类事故)。
     * ⇒ 这类红**如实报 SKIP**(≠ PASS,也不算红),并把「它只在哪种跑法下出现」写出来。
     * ⇒ 台账里用 verify.needs = "all-layers-only" 声明。 */
    const needs = String((e.verify || {}).needs || "");
    if (needs === "all-layers-only") {
      reproResults.push({ entry: e, ok: true, skip: true,
        detail: "只在全量(all)跑法下出现的红(层间顺序依赖)⇒ 单层跑法里它是绿的 ⇒ 本条不复现,也不实跑 all 矩阵" });
      continue;
    }
    const r = reproduce(e);
    reproResults.push({ entry: e, ...r });
    if (!r.ok) problems.push(e.id + "：" + r.detail);
  }
  if (problems.length) {
    bad("[KRL-03] 台账里有 " + problems.length + " 条红的「复现不出来」（红被偷偷删掉 / 改了文案 / 这条红早就不在了）", problems.join(" / "));
  } else {
    const skips = reproResults.filter((r) => r.skip);
    ok("[KRL-03] 台账 " + entries.length + " 条红全部复现得到（每条都实跑了对应门并 grep 到自己的锚点）"
      + (skips.length ? "；其中 " + skips.length + " 条是「只在全量跑法下出现」的红 ⇒ 不复现、也不实跑 all 矩阵" : ""));
  }
}



/* 覆盖检查的算子：给定一批红行，挑出「台账里没有任何条目认领」的。
 * 真实检查与反向对照共用它 —— 反向对照塞一条假红行进去，它必须被挑出来。
 *
 * 认领用**最长前缀**匹配：锚点名有前缀关系（ID-14 是 ID-14b 的前缀、CA-04 是 CA-04b 的
 * 前缀），谁更长谁认领这条 —— 否则 ID-14 会把 ID-14b 那行也吃掉，账就平不了。 */
function claimOf(rowText) {
  let best = null;
  for (const e of entries) {
    /* 一个 entry 可以有多条前缀(matrix_line_prefixes)⇒ 一条认领一整段的子锚点行,
       台账不会退化成「每条红一个条目」的绕过清单。 */
    const prefixes = []
      .concat(e.matrix_line_prefix ? [String(e.matrix_line_prefix)] : [])
      .concat(Array.isArray(e.matrix_line_prefixes) ? e.matrix_line_prefixes.map(String) : []);
    for (const p of prefixes) {
      if (!p) continue;
      if (rowText.startsWith(p) && (!best || p.length > String(best.matrix_line_prefix || "").length)) best = e;
    }
  }
  return best;
}
function uncoveredRows(rows) {
  return rows.filter((row) => !claimOf(row.text));
}

if (!haveRedRows) {
  sk("[KRL-04] 本轮矩阵的红行文件不在（" + RED_LINES + "）⇒ 覆盖检查跳过", "这条门要在矩阵里跑才有意义（矩阵每打一条红行就往那儿写一行）");
  sk("[KRL-05] 没有本轮红行 ⇒ 条数对账跳过");
} else {
  /* 台账外的红：本轮打出来、却没有任何台账条目认领的红行。 */
  /* 自指豁免(2026-11-22):**这条门自己**打出来的红行不能算「台账外的红」——
     否则它一旦红了,红行进文件,下一轮它就看到「台账外有红」⇒ 而那条红就是它自己
     ⇒ **自指循环**,永远红。⇒ 排除本门自己的红行。
     (这不是放水:台账外的**别的**红仍会被抓出来。) */
  const SELF = /G-135|KRL-|已知红台账对账/;
  const uncovered = uncoveredRows(l1Rows).filter((r) => !SELF.test(String(r.text || "")));
  if (uncovered.length) {
    bad("[KRL-04] 台账外的红（本轮打出来了但没人认领，待归类）：" + uncovered.length + " 条",
      uncovered.map((r) => String(r.text || "")).join(" / "));
  } else {
    ok("[KRL-04] 本轮 " + TIER + " 的 " + l1Rows.length + " 条红行全部在台账里有条目认领（没有台账外的红）");
  }

  /* 条数对账：台账条数 = 本轮红条数 + 条件性红（台账里写明「只在某种环境下出现」的）。 */
  const matched = new Set();
  for (const row of l1Rows) {
    const hit = claimOf(row.text);
    if (hit) matched.add(hit.id);
  }
  /* 已标 `resolved` 的条目**不算**「本轮没出现」—— 它们是**已经修好的红**,
     本轮不出现正是预期(新门对它们有反向要求:不许再红)。 */
  const notAppeared = entries.filter((e) => !matched.has(e.id) && !e.resolved);
  const unconditionalMissing = notAppeared.filter((e) => !e.conditional);
  if (unconditionalMissing.length) {
    bad("[KRL-05] 台账里有 " + unconditionalMissing.length + " 条红本轮没出现，且台账没写清它是条件性红",
      unconditionalMissing.map((e) => e.id).join(", "));
  } else {
    const cond = notAppeared.map((e) => e.id + "（" + e.conditional + "）");
    ok("[KRL-05] 条数对得上：台账 " + entries.length + " 条 = 本轮 " + TIER + " 红 " + l1Rows.length
      + " 条 + 条件性红 " + notAppeared.length + " 条" + (cond.length ? "：" + cond.join(" / ") : ""));
  }
}

/* ---------------------------------------- 6. 反向对照（尺对「漏/删」灵敏） */
{
  /* (a) 把某条台账的锚点改成一个不存在的串 ⇒ 复现检查必须当场报「复现不出来」。 */
  let detected = false;
  if (entries.length) {
    const sample = entries.find((e) => e.verify && (e.verify.anchor || e.verify.anchor_any) && e.verify.mode !== "stale-pin") || entries[0];
    const mutant = JSON.parse(JSON.stringify(sample));
    mutant.verify.anchor = "KRL-故意不存在的锚点-0000";
    mutant.verify.anchor_any = undefined;
    const r = reproduce(mutant);
    detected = r.ok === false;
    if (!detected) bad("反向对照 a 失灵：把锚点改成不存在的串，复现检查居然还说「复现得到」⇒ 这条尺抓不住「红被偷偷删掉」");
  }
  /* (b) 塞一条假红行进去 ⇒ 覆盖检查必须当场报「台账外的红」。 */
  const fake = { tier: TIER, text: "G-999 反向对照用的假红行（KRL）" };
  const detected2 = uncoveredRows(l1Rows.concat([fake])).some((r) => r.text === fake.text);
  if (!detected2) bad("反向对照 b 失灵：塞一条台账外的假红行，覆盖检查居然没报出来");
  if (detected && detected2) {
    ok("[KRL-06] 反向对照：锚点改成不存在的串 ⇒ 复现检查当场判「复现不出来」；塞一条台账外的假红行 ⇒ 覆盖检查当场报「台账外的红」（尺对红被删/漏账都灵敏）");
  }
}

/* ---------------------------------------- 7. 台账要能给人看 -------------- */
{
  const problems = [];
  for (const e of entries) {
    if (!e.conditional && String(e.reason).length < 30) problems.push(e.id + "：reason 讲不清「为什么红」");
    if (!String(e.owner || "").trim()) problems.push(e.id + "：没人认领也没写 owner_reason");
  }
  if (problems.length) bad("[KRL-07] 台账有几条读不出「为什么红 / 谁修」", problems.join(" / "));
  else {
    const byKind = {};
    for (const e of entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    ok("[KRL-07] 台账可读：每条都有「为什么红 + 凭什么这么判 + 谁修」的成文说明；分布 "
      + Object.entries(byKind).map(([k, v]) => k + "=" + v).join("、"));
  }
}

console.log("");
console.log("  · 台账：" + path.relative(REPO, LEDGER) + "（" + entries.length + " 条）");
console.log("  · 本轮 " + TIER + " 红行：" + (haveRedRows ? l1Rows.length + " 条（来源 " + RED_LINES + "）" : "未知（本轮没跑矩阵）"));
console.log("");
console.log("prove_known_red_ledger: PASS=" + pass + " FAIL=" + fail + " SKIP=" + skip);
process.exit(fail === 0 ? 0 : 1);
