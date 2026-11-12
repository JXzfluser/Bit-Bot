#!/usr/bin/env node
"use strict";

/**
 * prove_client_core.js — G-120（KP-08 / T3-01..03 与 T3-04/06 核心侧的静态与对拍层）
 *
 * 门要回答的是五个「不跑就没人知道」的问题：
 *   CC-01 核心是不是真的干净（无 fs / Electron / DOM）—— Node 能加载 **且** 在
 *         **同一个 vm realm 里按 <script src> 顺序**装配三份文件也能跑，才算浏览器里
 *         真能用：realm 没有模块系统，而且 classic script 共享顶层词法作用域，
 *         撞名/漏守卫都会当场红（N8/N9 就是拿这两种写法验这把尺子有牙）。
 *   CC-02 fold 是不是**唯一口径** —— event_mirror 导出的 foldEvents 必须与
 *         核心里那个是同一个函数引用，两份实现迟早折出不一样；
 *   CC-04/05 词表是不是和 docs/events.md、ui_protocol/types.mbt **逐字**对得上，
 *         不是「大概齐」：门自己解析那两个文件，多一个少一个都红；
 *   CC-07 折叠对拍（T3-03 完成定义的机器版）—— 用写侧真函数从空快照派事件，
 *         fold 回来必须与快照逐字段相等，三张面各来一遍。
 *   CC-08 负向对照 —— 摘掉 fold 的 history_pruned 分支、往词表塞一个 fold 不认的
 *         kind，判据必须翻红；不翻红说明上面那些断言是空的。
 *   CC-16..CC-23 transport（T3-04 接口 + T3-06 去重）—— 乐观命令的四种结局、
 *         回执字段词表与 schema 逐字一致、同面帧排队/去重/跳号取整份、
 *         `surface.read` 信封只认 .payload。这些判据要 await，挂在收尾之前跑。
 *   CC-24..CC-26 T3-04 **接线**（判据搬进页面之后，门盯的是接线本身）——
 *         渲染端每块内联脚本要过 JS 解析器（一块语法错 = 整块静默不执行，页面照开）、
 *         送达标记只由台账状态画（身份在请求前铸好、成功/异常两路都回执、finally 不产勾）、
 *         Host 只按 `^cm-[0-9a-z]{16}$` 采纳渲染端 id 并回显 `echo_entry_id`、
 *         存储层撞 id 时另发新 id（让界面判成 unmatched，而不是悄悄覆盖）。
 *
 * 负向对照 15 条（N1..N15）：每条都是「把产品侧那段判据摘掉，这条必须翻红」，
 * 并且 N11/N12/N13 还要求摘掉之后出现看得见的危害（丢改名 / 半截上屏 / 帧被盖掉），
 * 只让计数变化不算对照。
 *
 * 输出末尾自证覆盖面（规则数 + 目标文件 + 各自命中），这是「绿要能自证」的口径。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const REPO = path.resolve(__dirname, "..");
const CORE = path.join(REPO, "hosts/shared/client_core");

let PASS = 0;
let FAIL = 0;
const notes = [];
function ok(id, msg) {
  PASS++;
  notes.push(id);
  console.log("  ✓ " + id + " — " + msg);
}
function bad(id, msg) {
  FAIL++;
  console.log("  ✗ " + id + " — " + msg);
}

const reducerSrc = fs.readFileSync(path.join(CORE, "reducer.js"), "utf8");
const schemaSrc = fs.readFileSync(path.join(CORE, "schema.js"), "utf8");
const diffSrc = fs.readFileSync(path.join(CORE, "diff_apply.js"), "utf8");
const transportSrc = fs.readFileSync(path.join(CORE, "transport.js"), "utf8");
const core = require(path.join(CORE, "reducer.js"));
const schema = require(path.join(CORE, "schema.js"));
const diffCore = require(path.join(CORE, "diff_apply.js"));
const transport = require(path.join(CORE, "transport.js"));

/* 核心目录里到底有几份纯逻辑文件 —— CC-01/CC-01b/N8 都按这份列表扫，
   免得「加了第四份文件、门还在测三份」这种半截覆盖。页面引了几份是另一件事，
   由 CC-14 单独点名：T3-04 接线后四份全都上页面，任何一份掉出页面引用来都会红。 */
const CORE_FILES = ["schema.js", "reducer.js", "diff_apply.js", "transport.js"];
const CORE_SRC = { "schema.js": schemaSrc, "reducer.js": reducerSrc, "diff_apply.js": diffSrc, "transport.js": transportSrc };
const PAGE_SCRIPTS = ["schema.js", "reducer.js", "diff_apply.js", "transport.js"];
let assembled = { error: "装配未执行", growth: [], ns: {} };

/* ---------- CC-01 干净：没有 fs / Electron / DOM ---------- */
/* 扫的是代码不是散文：这两份文件的注释里本来就写着「没有 fs / Electron / DOM」，
   不剥掉注释的话门会把自己的说明当成依赖。 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/* 在一个 vm realm 里按给定顺序跑完这几份源码 —— 这就是浏览器 <script src> 的形状：
   没有模块系统（realm 里没有 module），而且所有 classic script 共享同一份顶层词法
   作用域（第二份再声明一次同名 const 会当场 SyntaxError）。返回 {ns, growth, error}。 */
function assembleRealm(files) {
  const ctx = vm.createContext({});
  vm.runInContext("globalThis.__bitbotClientCore = {};", ctx, { filename: "namespace.js" });
  const growth = [];
  try {
    for (const [name, src] of files) {
      vm.runInContext(src, ctx, { filename: name });
      growth.push(name + ":" + vm.runInContext("Object.keys(globalThis.__bitbotClientCore).length", ctx));
    }
  } catch (e) {
    return { error: String((e && e.message) || e).split("\n")[0], growth, ns: {} };
  }
  return { error: "", growth, ns: vm.runInContext("globalThis.__bitbotClientCore", ctx) };
}
{
  const forbidden = [/\brequire\s*\(/, /\bimport\s/, /from ["']/, /\bdocument\b/, /\bwindow\b/, /electron/i, /\bfs\b/];
  const hits = [];
  for (const name of CORE_FILES) {
    const src = codeOnly(CORE_SRC[name]);
    for (const re of forbidden) if (re.test(src)) hits.push(name + " → " + re.source);
  }
  const lines = CORE_FILES.map((f) => CORE_SRC[f].split("\n").length).join("+");
  if (hits.length) bad("CC-01", "核心里出现了不该有的依赖：" + hits.join("、"));
  else ok("CC-01", CORE_FILES.length + " 份核心源码零 require / import / DOM / Electron（" + lines + " 行）");
}
{
  /* 浏览器侧加载法要**同形**地演：既没有模块系统，几份 <script> 还共享同一份顶层
     词法作用域。上一版这里给每份文件各套一个 new Function，作用域彼此封闭，结果
     「几份文件都在顶层写 const API」这种会让整页白屏的写法门照样绿 —— 2026-11-12
     桌面端真的就这么死过一次（侧栏空到 KD-01 等不到 .agent-item）。
     现在改成一个 vm realm 里按顺序执行各份源码：重复的顶层声明当场 SyntaxError，
     漏了模块守卫当场 ReferenceError，形状与浏览器一致。 */
  const realmFiles = CORE_FILES.map((f) => [f, CORE_SRC[f]]);
  assembled = assembleRealm(realmFiles);
  const need = ["foldEvents", "BASELINE", "COMMANDS", "applyDiff", "snapshotToState", "EFFECTS",
    "createLedger", "createSurfaceStream", "unwrapRead", "CMD_STATE"];
  const missing = assembled.error ? [] : need.filter((k) => !(k in assembled.ns));
  assembled.error
    ? bad("CC-01b", CORE_FILES.length + " 份核心文件在同一 realm 里装配失败：" + assembled.error)
    : missing.length
      ? bad("CC-01b", "无模块系统环境下按 <script> 顺序装配后命名空间缺 " + missing.join(",") + "（" + assembled.growth.join(" ") + "）")
      : ok("CC-01b", "同一个 realm（= 浏览器 <script> 的共享顶层作用域）顺序装配 " + CORE_FILES.length + " 份文件，"
          + need.length + " 个出口齐、无顶层声明冲突（" + assembled.growth.join(" → ") + "）");
  /* 「同一份代码不需要改写」不能只靠嘴说：把装配出来的那份 applyDiff 与
     Host require 出来的那份喂同一条 diff，状态和效果必须逐字节一样。
     哪天真出现两份实现（比如核心里又抄了一遍判据），这里会先分叉。 */
  if (!assembled.error) {
    const probeState = assembled.ns.snapshotToState({ rev: 3, sessions: [{ id: "s1", title: "a", updated_at: 1 }], active_id: "s1" }, {
      surface: "sessions", buckets: ["visible"], bucketKeys: { visible: "sessions" }, scalars: ["active_id"],
    });
    const probeDiff = { mode: "diff", surface: "sessions", rev: 4, changed: [{ entity_id: "s1", changed_fields: { title: "b" } }] };
    const probeSpec = { surface: "sessions", buckets: ["visible"], scalars: ["active_id"] };
    const viaBrowser = JSON.stringify(assembled.ns.applyDiff(probeState, probeDiff, probeSpec));
    const viaHost = JSON.stringify(diffCore.applyDiff(probeState, probeDiff, probeSpec));
    viaBrowser === viaHost && /"title":"b"/.test(viaBrowser) && /"rev":4/.test(viaBrowser)
      ? ok("CC-01c", "浏览器装配版与 Host require 版在同一条 diff 上给出同一状态（title→b，rev→4）")
      : bad("CC-01c", "两条加载路径的结果分叉：" + viaBrowser.slice(0, 160) + " ≠ " + viaHost.slice(0, 160));
  } else bad("CC-01c", "装配失败，无从对拍");
}

/* ---------- CC-02 fold 唯一口径 ---------- */
{
  const mirror = require(path.join(REPO, "hosts/shared/event_mirror.js"));
  mirror.foldEvents === core.foldEvents
    ? ok("CC-02", "event_mirror.foldEvents === client_core.foldEvents（同一函数引用，口径不重复）")
    : bad("CC-02", "两份 fold 并存：Host 与核心会各自漂移");
  JSON.stringify(mirror.BASELINE) === JSON.stringify(core.BASELINE) && mirror.BASELINE === core.BASELINE
    ? ok("CC-02b", "三张面基线也从核心取（不是各写一份）")
    : bad("CC-02b", "基线有两份来源");
}

/* ---------- CC-03 词表内部自洽 ---------- */
{
  const problems = schema.selfCheck();
  problems.length ? bad("CC-03", "词表自相矛盾：" + problems.join("；")) : ok("CC-03", "schema.selfCheck() 空（surfaces 三个、镜像复用 kind 都在回合词表里、command 幂等键齐）");
}

/* ---------- CC-04 docs/events.md 逐字对齐 ---------- */
{
  const doc = fs.readFileSync(path.join(REPO, "docs/events.md"), "utf8");
  const sec = (title) => {
    const i = doc.indexOf(title);
    const j = doc.indexOf("\n### ", i + 5);
    return i < 0 ? "" : doc.slice(i, j < 0 ? doc.length : j);
  };
  const tableKinds = (block) => [...block.matchAll(/^\|\s*(\d+)\s*\|\s*`([a-z_]+)`\s*\|/gm)].map((m) => m[2]);
  const turn = tableKinds(sec("### 5.2 event"));
  const mirrorRows = [...sec("### 5.4 镜像 kind").matchAll(/^\| `([a-z_]+)`（复用/gm)].map((m) => m[1]);
  const onlyRows = [...sec("### 5.4 镜像 kind").matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
  const cmdNames = [...sec("### 5.1 command").matchAll(/^\|\s*`([a-z_]+)`\s*\|/gm)].map((m) => m[1]);
  const missT = turn.filter((k) => !schema.TURN_EVENT_KINDS[k]);
  const extraT = schema.turnEventKinds().filter((k) => !turn.includes(k));
  const missC = cmdNames.filter((k) => !schema.COMMANDS[k]);
  const extraC = Object.keys(schema.COMMANDS).filter((k) => !cmdNames.includes(k));
  const missM = onlyRows.filter((k) => !schema.MIRROR_ONLY_KINDS.includes(k));
  const parts = [`文档回合流 ${turn.length} 条`, `文档 command ${cmdNames.length} 条`, `文档镜像新增 ${onlyRows.length} 条`, `复用 ${mirrorRows.length} 条`];
  if (turn.length !== 14) bad("CC-04", `§5.2 解析到 ${turn.length} 条，不是 14 —— 门自己先飘了`);
  else if (missT.length || extraT.length || missC.length || extraC.length || missM.length)
    bad("CC-04", `脱节：文档有核心无 ${missT.concat(missC, missM)}；核心有文档无 ${extraT.concat(extraC)}`);
  else ok("CC-04", "docs/events.md §5.1/§5.2/§5.4 的 kind 与 command 与 schema 一一对应（" + parts.join("，") + "）");
}

/* ---------- CC-05 ui_protocol 一一对应（T3-02 的完成定义） ---------- */
{
  const mbt = fs.readFileSync(path.join(REPO, "ui_protocol/types.mbt"), "utf8");
  const enumCtors = (name) => {
    const i = mbt.indexOf("enum " + name + " {");
    if (i < 0) return [];
    const j = mbt.indexOf("\n}", i);
    return [...mbt.slice(i, j).matchAll(/^\s*([A-Z][A-Za-z]*)(?:\(|\s*$)/gm)].map((m) => m[1]);
  };
  const kinds = enumCtors("MessageKind");
  const reasons = enumCtors("EndTurnReason");
  const labelOf = (c) => c.replace(/^([A-Z])/, (m, x) => x.toLowerCase());
  const miss = kinds.filter((k) => !schema.MESSAGE_KINDS[k]);
  const extra = Object.keys(schema.MESSAGE_KINDS).filter((k) => !kinds.includes(k));
  const rMiss = reasons.filter((k) => !(k in schema.END_TURN_STATUS));
  const rExtra = Object.keys(schema.END_TURN_STATUS).filter((k) => !reasons.includes(k));
  const labelWrong = kinds.filter((k) => schema.MESSAGE_KINDS[k] && schema.MESSAGE_KINDS[k].label !== labelOf(k));
  if (!kinds.length || miss.length || extra.length || rMiss.length || rExtra.length)
    bad("CC-05", `MessageKind 文档侧 ${kinds.length} 个：缺 ${miss} 多 ${extra}；EndTurnReason 缺 ${rMiss} 多 ${rExtra}`);
  else if (labelWrong.length) bad("CC-05", "label 与 MoonBit `MessageKind::label` 对不上：" + labelWrong.join(","));
  else ok("CC-05", `ui_protocol 的 MessageKind ${kinds.length} 个构造子 + EndTurnReason ${reasons.length} 个都有对应，label 口径与 MoonBit 一致`);
}

/* ---------- CC-06 每个词表 kind 都被 fold 认领 ---------- */
{
  const covered = (src) => schema.allEventKinds().filter((k) => src.includes('kind === "' + k + '"'));
  const c = covered(reducerSrc);
  const ignored = schema.allEventKinds().filter((k) => core.IGNORED_KINDS.has(k));
  /* delta 是唯一「不落库所以 fold 永远不该认」的 kind（§5.3），它的豁免由词表的
     durable:false 给，不写死在门的字符串里 —— 哪天有人给 delta 加了落库，
     durable 变 true 而 fold 没分支，这条就要红。 */
  const undurable = schema.allEventKinds().filter((k) => !schema.isDurableEvent(k));
  const loose = schema.allEventKinds().filter(
    (k) => !c.includes(k) && !ignored.includes(k) && !undurable.includes(k),
  );
  loose.length
    ? bad("CC-06", `fold 不认这些 kind（加了词表忘了折叠）：${loose.join(",")}`)
    : ok("CC-06", `词表 ${schema.allEventKinds().length} 个 kind：fold 分支认领 ${c.length} 个 + 回合流显式放行 ${ignored.length} 个 + 不落库豁免 ${undurable.join(",")}，无漏`);
}

/* ---------- CC-07 折叠对拍：写侧派的事件能折回快照（三张面各一遍） ---------- */
function snapshotToRows(surface, snap) {
  const mirror = require(path.join(REPO, "hosts/shared/event_mirror.js"));
  const def = { surface, shape: surface === "approvals" ? "jsonl" : "store" };
  const isJsonl = surface === "approvals";
  const r = mirror.diffSurface(def, isJsonl ? "" : null, isJsonl ? snapToText(surface, snap) : JSON.stringify(snap));
  if (r.problems && r.problems.length) throw new Error(surface + " 派事件带 problem：" + r.problems.join("；"));
  return r.events.map((e, i) => ({ seq: i + 1, sessionId: e.sessionId, kind: e.kind, payload: e.payload }));
}
function snapToText(surface, snap) {
  if (surface !== "approvals") return JSON.stringify(snap);
  return snap.map((x) => JSON.stringify(x)).join("\n") + "\n";
}
{
  const cases = [
    {
      surface: "sessions",
      snap: { version: 1, active_id: "s2", sessions: [
        { id: "s1", title: "对标 Grok", updated_at: 10, messages: [{ id: "m1", role: "user", text: "你好" }, { id: "m2", role: "assistant", text: "在", reactions: ["👍"] }] },
        { id: "s2", title: "群 · 内核", updated_at: 20, messages: [] },
      ] },
    },
    {
      surface: "rooms",
      snap: { version: 1, rooms: [
        { id: "r1", name: "自媒体日更", member_bot_ids: ["b1", "b2"], transcript: [{ kind: "user", speaker: "pane", text: "开工", at: 5 }] },
      ] },
    },
    { surface: "approvals", snap: [{ id: "a1", session_id: "s1", action: "mail_send", decision: "approve" }] },
  ];
  let allSame = true;
  const detail = [];
  for (const c of cases) {
    try {
      const rows = snapshotToRows(c.surface, c.snap);
      const folded = core.foldEvents(rows);
      const got = c.surface === "approvals" ? folded.approvals : folded[c.surface];
      const want = c.surface === "approvals" ? c.snap : Object.assign({}, c.snap, c.surface === "sessions" ? {} : {});
      const a = JSON.stringify(norm(got));
      const b = JSON.stringify(norm(want));
      if (a !== b) {
        allSame = false;
        detail.push(`${c.surface}: fold 出来 ${a.slice(0, 120)} ≠ 快照 ${b.slice(0, 120)}`);
      } else detail.push(`${c.surface}(${rows.length} 事件)`);
    } catch (err) {
      allSame = false;
      detail.push(c.surface + " 异常：" + err.message);
    }
  }
  allSame ? ok("CC-07", "写侧派事件 → 核心 fold → 与快照逐字段相等：" + detail.join("、")) : bad("CC-07", detail.join("；"));
}
function norm(x) {
  if (Array.isArray(x)) return x.map(norm);
  if (x && typeof x === "object") {
    const out = {};
    for (const k of Object.keys(x).sort()) out[k] = norm(x[k]);
    return out;
  }
  return x;
}

/* ---------- CC-09 diff 应用的三条规矩（认 rev / 幂等 / 结构变化整份重画） ---------- */
const sessSpec = (dayBucket) => ({
  surface: "sessions",
  buckets: ["visible"],
  bucketKeys: { visible: "sessions" },
  scalars: ["active_id"],
  dayField: "updated_at",
  dayBucket: dayBucket || ((iso) => (Number(iso) >= 100 ? "today" : "earlier")),
  summaryFields: ["title", "preview", "message_count"],
  repaintOnScalar: true,
});
const botSpec = (mounted) => ({
  surface: "bots",
  buckets: ["visible", "hidden"],
  bucketKeys: { visible: "bots", hidden: "hidden_bots" },
  scalars: ["primary_id"],
  bucketField: "group",
  patchFields: { name: 1, pinned: 1, description: 1, avatar_data_url: 1, job: 1, tags: 1, updated_at: 1 },
  isMounted: mounted || (() => true),
  repaintOnScalar: false,
});
const sessSnap = (rev) => ({
  rev,
  sessions: [
    { id: "s1", title: "对标 Grok", updated_at: 1, preview: "在", message_count: 2 },
    { id: "s2", title: "群 · 内核", updated_at: 200, preview: "", message_count: 0 },
  ],
  active_id: "s1",
});
const botSnap = (rev) => ({
  rev,
  bots: [{ id: "b1", name: "Moon", group: "", updated_at: 1 }, { id: "b2", name: "Ops", group: "运营", updated_at: 2 }],
  hidden_bots: [{ id: "b3", name: "Old", updated_at: 3 }],
  primary_id: "b1",
});
const types = (r) => diffCore.effectTypes(r.effects);
const reasons = (r) => r.effects.filter((e) => e.type === "structural_rebuild").map((e) => e.reason);

{
  const st = diffCore.snapshotToState(sessSnap(10), sessSpec());
  const frozen = JSON.stringify(st);
  const echo = diffCore.applyDiff(st, { mode: "diff", surface: "sessions", rev: 10, changed: [{ entity_id: "s1", changed_fields: { title: "旧值" } }] }, sessSpec());
  const gap = diffCore.applyDiff(st, { mode: "diff", surface: "sessions", rev: 12, changed: [{ entity_id: "s1", changed_fields: { title: "半截" } }] }, sessSpec());
  const cold = diffCore.applyDiff(null, { mode: "diff", surface: "sessions", rev: 1, changed: [] }, sessSpec());
  const echoOk = types(echo).join() === "ignored" && echo.noop && echo.state === st;
  const gapOk = types(gap).join() === "self_heal" && gap.noop && gap.effects[0].reason === "rev_gap" && gap.state === st;
  const coldOk = types(cold).join() === "self_heal" && cold.effects[0].reason === "no_baseline";
  const untouched = JSON.stringify(st) === frozen;
  echoOk && gapOk && coldOk && untouched
    ? ok("CC-09", "三条 rev 规矩：回声→ignored 且状态同一引用；跳号→self_heal(rev_gap) 且不糊半截 diff；无基线→self_heal(no_baseline)；入参状态没被就地改")
    : bad("CC-09", `rev 判据飘了：echo=${types(echo)} gap=${types(gap)}/${gap.effects[0] && gap.effects[0].reason} cold=${types(cold)} 入参被改=${!untouched}`);
}

/* ---------- CC-10 每个结构判定都要点名，且只走整份重画 ---------- */
{
  const cases = [];
  const S = () => diffCore.snapshotToState(sessSnap(10), sessSpec());
  const B = () => diffCore.snapshotToState(botSnap(10), botSpec());
  cases.push(["clean_patch", diffCore.applyDiff(S(), { rev: 11, changed: [{ entity_id: "s1", changed_fields: { title: "改名" } }] }, sessSpec()),
    (r) => types(r).includes("patch_row") && types(r).includes("summary_dirty") && !reasons(r).length]);
  cases.push(["row_missing", diffCore.applyDiff(S(), { rev: 11, changed: [{ entity_id: "s9", changed_fields: { title: "x" } }] }, sessSpec()),
    (r) => reasons(r).includes("row_missing")]);
  cases.push(["added", diffCore.applyDiff(S(), { rev: 11, added: [{ entity_id: "s3", row: { title: "新会话" } }] }, sessSpec()),
    (r) => reasons(r).includes("added") && r.state.buckets.visible.some((x) => x.id === "s3")]);
  cases.push(["removed", diffCore.applyDiff(S(), { rev: 11, removed: ["s2"] }, sessSpec()),
    (r) => reasons(r).includes("removed") && types(r).includes("remove_row") && !r.state.buckets.visible.some((x) => x.id === "s2")]);
  cases.push(["day_bucket", diffCore.applyDiff(S(), { rev: 11, changed: [{ entity_id: "s1", changed_fields: { updated_at: 500 } }] }, sessSpec()),
    (r) => reasons(r).includes("day_bucket") && !types(r).includes("patch_row")]);
  cases.push(["order_full", diffCore.applyDiff(S(), { rev: 11, order: { visible: ["s2", "s1"] } }, sessSpec()),
    (r) => types(r).includes("reorder") && !reasons(r).length && r.state.buckets.visible.map((x) => x.id).join() === "s2,s1"]);
  cases.push(["order_mismatch", diffCore.applyDiff(S(), { rev: 11, order: { visible: ["s1"] } }, sessSpec()),
    (r) => reasons(r).includes("order_mismatch")]);
  cases.push(["moved_bucket", diffCore.applyDiff(B(), { rev: 11, changed: [{ entity_id: "b1", changed_fields: { name: "n" }, moved_bucket: true }] }, botSpec()),
    (r) => reasons(r).includes("moved_bucket")]);
  cases.push(["group_field", diffCore.applyDiff(B(), { rev: 11, changed: [{ entity_id: "b1", changed_fields: { group: "新组" } }] }, botSpec()),
    (r) => reasons(r).includes("moved_bucket")]);
  cases.push(["field_not_patchable", diffCore.applyDiff(B(), { rev: 11, changed: [{ entity_id: "b1", changed_fields: { model: "gpt" } }] }, botSpec()),
    (r) => reasons(r).includes("field_not_patchable") && !types(r).includes("patch_row")]);
  cases.push(["row_not_mounted", diffCore.applyDiff(B(), { rev: 11, changed: [{ entity_id: "b1", changed_fields: { name: "n" } }] }, botSpec(() => false)),
    (r) => reasons(r).includes("row_not_mounted")]);
  cases.push(["scalar_sessions", diffCore.applyDiff(S(), { rev: 11, scalars: { active_id: "s2" } }, sessSpec()),
    (r) => types(r).includes("set_scalar") && reasons(r).includes("scalar") && r.state.scalars.active_id === "s2"]);
  cases.push(["scalar_bots", diffCore.applyDiff(B(), { rev: 11, scalars: { primary_id: "b2" } }, botSpec()),
    (r) => types(r).includes("set_scalar") && !reasons(r).length && r.state.scalars.primary_id === "b2"]);
  const bads = [];
  for (const [name, r, judge] of cases) if (!judge(r)) bads.push(name + "→" + types(r).join("/") + "[" + reasons(r).join(",") + "]");
  bads.length ? bad("CC-10", "结构判定不符：" + bads.join("；")) : ok("CC-10", `${cases.length} 条结构/字段/顺序/标量判定各归各位（整份重画都带 reason 名字，不靠文案）`);
}

/* ---------- CC-11 幂等 + 纯：连应用两次，第二次只可能是 ignored ---------- */
{
  const st = diffCore.snapshotToState(botSnap(10), botSpec());
  const d = { rev: 11, changed: [{ entity_id: "b1", changed_fields: { name: "MoonBit" } }], added: [{ entity_id: "b9", bucket: "hidden", row: { name: "New" } }] };
  const first = diffCore.applyDiff(st, d, botSpec());
  const second = diffCore.applyDiff(first.state, d, botSpec());
  const pure = (() => {
    const probe = diffCore.snapshotToState(botSnap(10), botSpec());
    const before = JSON.stringify(probe);
    diffCore.applyDiff(probe, d, botSpec());
    return JSON.stringify(probe) === before;
  })();
  const idem = types(second).join() === "ignored" && second.state === first.state;
  const once = first.state.buckets.visible[0].name === "MoonBit" && first.state.buckets.hidden.some((x) => x.id === "b9") && first.state.rev === 11;
  idem && pure && once
    ? ok("CC-11", "diff 带新值所以幂等：同一条第二次只出 ignored 且状态是同一对象；applyDiff 不改调用方传入的状态（深比较过）")
    : bad("CC-11", `idem=${idem} pure=${pure} once=${once} 第二次效果=${types(second)}`);
}

/* ---------- CC-12 效果闭集：渲染端不可能收到没登记过的类型/原因 ---------- */
{
  const fuzz = [];
  for (let i = 0; i < 60; i++) {
    const seed = { rev: 11 + (i % 3), changed: [], added: [], removed: [], scalars: {}, order: null };
    if (i % 2) seed.changed.push({ entity_id: ["b1", "b2", "b9"][i % 3], changed_fields: { name: "x", group: i % 4 ? "g" : "", zzz: 1 }, moved_bucket: i % 5 === 0 });
    if (i % 3 === 0) seed.added.push({ entity_id: "n" + i, bucket: i % 2 ? "hidden" : "visible", row: { name: "n" } });
    if (i % 4 === 0) seed.removed.push(["b1", "b2", "ghost"][i % 3]);
    if (i % 5 === 0) seed.scalars = { primary_id: "b2", bogus: 1 };
    if (i % 6 === 0) seed.order = { visible: ["b2", "b1"] };
    fuzz.push(diffCore.applyDiff(diffCore.snapshotToState(botSnap(10), botSpec(i % 7 !== 0)), seed, botSpec(i % 7 !== 0)));
    fuzz.push(diffCore.applyDiff(diffCore.snapshotToState(sessSnap(10), sessSpec()), Object.assign({}, seed, { scalars: { active_id: "s2" } }), sessSpec()));
  }
  const allTypes = new Set();
  const allReasons = new Set();
  const healReasons = new Set();
  const ignoreReasons = new Set();
  for (const r of fuzz) {
    for (const e of r.effects) {
      allTypes.add(e.type);
      if (e.type === "structural_rebuild") allReasons.add(e.reason);
      if (e.type === "self_heal") healReasons.add(e.reason);
      if (e.type === "ignored") ignoreReasons.add(e.reason);
    }
  }
  const unknownTypes = [...allTypes].filter((t) => !diffCore.EFFECTS.includes(t));
  const unknownReasons = [...allReasons].filter((t) => !diffCore.REASONS.includes(t));
  const unknownHeal = [...healReasons].filter((t) => !diffCore.HEAL_REASONS.includes(t));
  const unknownIgnore = [...ignoreReasons].filter((t) => t !== "rev_behind");
  const silent = fuzz.filter((r) => !r.noop && !r.effects.length);
  unknownTypes.length || unknownReasons.length || unknownHeal.length || unknownIgnore.length || silent.length
    ? bad("CC-12", `闭集漏了：未登记类型 ${unknownTypes}、结构原因 ${unknownReasons}、自愈原因 ${unknownHeal}、回声原因 ${unknownIgnore}、静默无效果的 diff ${silent.length} 条`)
    : ok("CC-12", `${fuzz.length} 条合成 diff：类型 ⊆ EFFECTS(${allTypes.size}/${diffCore.EFFECTS.length})、结构原因 ⊆ REASONS(${allReasons.size}/${diffCore.REASONS.length})、自愈原因 ⊆ HEAL_REASONS(${healReasons.size})，且没有「应用了却一个效果都不发」的静默路径`);
}

/* ---------- CC-13 渲染端只翻译效果：判据不能有第二套 ---------- */
const htmlSrc = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
const htmlBodies = {}; /* CC-13 取出的两个函数体，N6 复用 */
{
  const delegates = [/applySessionsDiff\(diff\)[\s\S]{0,200}clientCore\.applyDiff\(sessState, diff, SESS_SPEC\)/, /applyBotsDiff\(diff\)[\s\S]{0,240}clientCore\.applyDiff\(botState, diff, BOT_SPEC\)/];
  const notDelegated = delegates.filter((re) => !re.test(htmlSrc));
  const secondRevJudge = /\brev\s*===\s*anchor\s*\+\s*1\b|surfaceRev|botViewCache|sessRowsCache|patchBotRowText/.exec(htmlSrc);
  notDelegated.length || secondRevJudge
    ? bad("CC-13", notDelegated.length ? "渲染端还自己算 diff：" + notDelegated.map((x) => x.source.slice(0, 40)) : "渲染端还留着第二套 rev 锚点/旧缓存：" + secondRevJudge[0])
    : ok("CC-13", "两个 diff 应用函数都只调 clientCore.applyDiff，index.html 里没有第二套 rev 判据、没有旧缓存变量、没有本地字段白名单");
  /* 效果闭集要在两张面都被接住；漏一条 = diff 来了屏幕不动的那种红。
     Bot 面唯一合法的缺席是 summary_dirty：那张面的 spec 没有 summaryFields，
     核心对它不可能发这个效果（N6 会把这条豁免反过来验一遍）。 */
  const missing = [];
  for (const [fn, re] of [["runSessionEffects", /function runSessionEffects\(effects\)\s*\{[\s\S]*?\n    \}/], ["applyBotsDiff", /async function applyBotsDiff\(diff\)\s*\{[\s\S]*?\n    \}/]]) {
    const m = re.exec(htmlSrc);
    if (!m) { missing.push(fn + " 函数体取不到"); continue; }
    htmlBodies[fn] = m[0];
    for (const t of diffCore.EFFECTS) {
      if (fn === "applyBotsDiff" && t === "summary_dirty") continue;
      if (!new RegExp('["\']' + t + '["\']').test(m[0])) missing.push(fn + " 没接 " + t);
    }
    if (!/default:/.test(m[0])) missing.push(fn + " 没有 default 报警");
  }
  missing.length ? bad("CC-13b", "效果没被渲染端接住：" + missing.join(",")) : ok("CC-13b", `两张面都把核心能发的效果逐个接住（会话 ${diffCore.EFFECTS.length} 类全含、Bot 只豁免 summary_dirty），且都留了 default 报警`);
}

/* ---------- CC-14 打包可达：核心必须进 app.asar，路径两形 ---------- */
{
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "hosts/desktop/package.json"), "utf8"));
  const files = (pkg.build && pkg.build.files) || [];
  const sharedCopy = files.find((f) => f && f.from === "../shared");
  const desktopCopy = files.find((f) => f && f.from === ".");
  const coversSubdir = sharedCopy && sharedCopy.filter.some((g) => g.startsWith("**/*"));
  const notListed = desktopCopy && desktopCopy.filter.some((g) => /client_core/.test(g));
  const tagPairs = PAGE_SCRIPTS.flatMap((f) => [
    '<script src="../shared/client_core/' + f + '"></script>',
    'src="./shared/client_core/' + f + '"',
  ]);
  const missingTags = tagPairs.filter((s) => !htmlSrc.includes(s));
  const exists = CORE_FILES.filter((f) => !fs.existsSync(path.join(CORE, f)));
  const onDisk = fs.readdirSync(CORE).filter((f) => f.endsWith(".js")).sort();
  const notCovered = onDisk.filter((f) => !CORE_FILES.includes(f));
  const unwired = CORE_FILES.filter((f) => !PAGE_SCRIPTS.includes(f));
  const ok14 = coversSubdir && !notListed && !missingTags.length && !exists.length && !notCovered.length;
  ok14
    ? ok("CC-14", "packaged 路径可达：files 里 hosts/shared 用 **/*（含子目录）→ app.asar/shared/client_core/，页面引的 " + PAGE_SCRIPTS.length +
        " 个 <script> 的 dev(../shared) 与打包(./shared) 两形都写全；核心目录里 " + onDisk.length + " 份 .js 全在扫描名单内" +
        "（" + (unwired.length ? "未上页面的残账：" + unwired.join(",") : "四份核心全在页面上，页面上没有第二套判据可躲") + "）")
    : bad("CC-14", `shared 复制=${sharedCopy ? JSON.stringify(sharedCopy.filter) : "无"}；desktop 清单里不该出现 client_core=${!!notListed}；缺脚本=${missingTags.join(",")}；缺文件=${exists}；名单外的新文件=${notCovered}`);
}

/* ---------- CC-15 装配失败要看得见，不能白屏 ---------- */
{
  const flag = /window\.__bitbotClientCoreReady = !!\(/.test(htmlSrc) && /window\.__bitbotClientCore\.applyDiff/.test(htmlSrc);
  const boot = fs.readFileSync(path.join(REPO, "scripts/e2e_desktop_sidebar_diff.mjs"), "utf8");
  const seen = /__bitbotClientCoreReady/.test(boot);
  flag && seen
    ? ok("CC-15", "核心没装上时 window.__bitbotClientCoreReady=false，且 KD 门真的读了它（打包漏目录不会只留下空白侧栏）")
    : bad("CC-15", `index.html 暴露就绪位=${/window\.__bitbotClientCoreReady/.test(htmlSrc)}，e2e 读它=${seen}`);
}

/* ---------- CC-24 渲染端那份内联脚本本身要过 JS 解析器 ---------- */
/* 浏览器是「按块」执行 <script> 的：一块里有语法错，整块一声不响地不跑。
   2026-11-12 接线时差点带上线的就是这个形状 —— 一次编辑吞掉换行，把
   `function roomFailReason` 粘到了上一行 `//` 注释的尾巴上，页面照常开、
   侧栏照常画，发送这条链上的函数却全没了。这种红只有解析器认得。 */
function inlineScriptBlocks(src) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}
function parseInline(src) {
  const bad = [];
  const blocks = inlineScriptBlocks(src);
  blocks.forEach((b, i) => {
    if (!b.trim()) return;
    try {
      new Function(b);
    } catch (e) {
      bad.push("第" + (i + 1) + "块：" + String((e && e.message) || e).split("\n")[0]);
    }
  });
  return { blocks: blocks.length, bad };
}
{
  const r = parseInline(htmlSrc);
  r.bad.length
    ? bad("CC-24", "渲染端有内联 <script> 过不了解析器：" + r.bad.join(" / "))
    : ok("CC-24", `index.html 里 ${r.blocks} 块内联脚本逐块 new Function 解析通过，0 处语法错（一块错 = 整块静默不执行）`);
  // N14：把这次的真实翻车形状复制一遍（函数声明粘在注释行尾），判据必须当场红
  const glueRe = /\/\/[^\n]*\n([ \t]*)(function [A-Za-z_$][\w$]*\()/;
  const gm = glueRe.exec(htmlSrc);
  if (!gm) bad("CC-24-N14", "找不到「注释行紧接函数声明」的位置，对照无从做起");
  else {
    const broken = htmlSrc.slice(0, gm.index) + gm[0].replace("\n" + gm[1], "") + htmlSrc.slice(gm.index + gm[0].length);
    const rb = parseInline(broken);
    rb.bad.length
      ? ok("CC-24-N14", `摘掉那个换行后判据立刻点名（${rb.bad[0].slice(0, 56)}）—— 那整块里的函数当场不存在，页面却还是能打开的，CC-24 有牙`)
      : bad("CC-24-N14", "复制出「函数粘在注释行尾」的写法后解析器照样通过，CC-24 是空的");
  }
}

/* ---------- CC-25 送达标记只由回执换来（T3-04 渲染端接线） ---------- */
function sendMarkViolations(src) {
  const a = src.indexOf("async function runUserTurn(");
  const b = src.indexOf('approveBtn.addEventListener("click"', a + 1);
  if (a < 0 || b < 0) return ["runUserTurn 函数体取不到"];
  const body = src.slice(a, b);
  const fIdx = body.lastIndexOf("} finally {");
  if (fIdx < 0) return ["runUserTurn 里没有 finally 块"];
  const finallyBody = codeOnly(body.slice(fIdx));
  const bodyCode = codeOnly(body);
  const v = [];
  /* 身份必须在「请求之前」铸好并挂到节点上：这是可感面第一条（回车立刻上屏）
     和最后一条（对账不靠位置）的共同前提。判据扫的是代码不是说明 —— 那段
     finally 的注释里就写着「原来无条件打 ✓✓」，不剥注释这条会永远红。 */
  if (!/sendLedger\.begin\(\s*"user_message"/.test(bodyCode)) v.push("没有 sendLedger.begin(\"user_message\")：这条乐观消息没进台账");
  if (!/userEl\.dataset\.clientMid = String\(sendCmd\.client_msg_id\)/.test(bodyCode)) v.push("节点上没挂 data-client-mid：回执回来找不到那一行");
  const iBegin = bodyCode.indexOf("sendLedger.begin");
  const iTurn = bodyCode.indexOf("window.bitbot.turn(");
  if (!(iBegin >= 0 && iTurn >= 0 && iBegin < iTurn)) v.push(`身份/上屏不在请求之前（begin@${iBegin} turn@${iTurn}）`);
  if ((bodyCode.match(/settleSend\(\{/g) || []).length < 2) v.push("成功路和异常路没都走 settleSend");
  if (/✓✓/.test(finallyBody) || /classList\.add\(\s*["']read["']\s*\)/.test(finallyBody))
    v.push("finally 里还有无条件送达标记：抛异常也会亮成已送达");
  if (!/createLedger/.test(codeOnly(src))) v.push("页面没用 createLedger");
  const pm = /function paintSendState\([\s\S]*?\n    \}/.exec(src);
  if (!pm) v.push("paintSendState 取不到函数体");
  else {
    if (!/SEND_STATE\.Durable[\s\S]{0,120}✓✓/.test(pm[0])) v.push("✓✓ 不是由 Durable 状态画的");
    for (const st of ["Durable", "Rejected", "Unmatched", "Expired"])
      if (!new RegExp("SEND_STATE\\." + st + "\\b").test(pm[0])) v.push("paintSendState 没画 " + st);
  }
  const marks = (src.match(/textContent = "✓✓"/g) || []).length;
  if (marks !== 1) v.push(`页面上有 ${marks} 处把勾写成 ✓✓（只该有台账状态那一处）`);
  return v;
}
{
  const v = sendMarkViolations(htmlSrc);
  v.length ? bad("CC-25", "乐观命令的送达标记还不归回执管：" + v.join("、"))
    : ok("CC-25", "runUserTurn：身份在请求前铸好并挂上节点、成功/异常两路都走 settleSend、finally 里一个送达标记都不产，" +
        "✓✓ 只在 paintSendState 的 Durable 分支出现一次（全页 1 处），四态各有画法");
  // N15：把当年那句「流程走完就打勾」原样放回 finally
  const INJECT = [
    '      const _c = userEl && userEl.querySelector(".msg-status .ms-check");',
    '      if (_c) { _c.textContent = "✓✓"; _c.classList.add("read"); }',
  ].join("\n");
  const re15 = /\} finally \{\n([ \t]*)muteLlmStream = false;/;
  if (!re15.test(htmlSrc)) bad("CC-25-N15", "找不到 runUserTurn 的 finally 块，对照无从做起");
  else {
    const patched = htmlSrc.replace(re15, (s, ind) => "} finally {\n" + ind + INJECT.split("\n").join("\n" + ind) + "\n" + s.slice(("} finally {\n").length));
    const v15 = sendMarkViolations(patched);
    const marks15 = (patched.match(/textContent = "✓✓"/g) || []).length;
    v15.length
      ? ok("CC-25-N15", `把无条件 ✓✓ 放回 finally 后判据当场翻红（${v15[0]}；全页 ✓✓ 由 1 处变 ${marks15} 处）—— ` +
          "危害正是这套判据要防的那件事：发送抛异常，屏幕上还是「已送达」")
      : bad("CC-25-N15", `finally 里塞回无条件 ✓✓ 后判据照样绿（violations=${v15.length} marks=${marks15}），CC-25 是空的`);
  }
}

/* ---------- CC-26 Host 采纳身份 + 回显 echo + 落库不许撞 id ---------- */
{
  const mainSrc = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
  const storeSrc = fs.readFileSync(path.join(REPO, "hosts/desktop/sessions.js"), "utf8");
  const v = [];
  if (!/\^cm-\[0-9a-z\]\{16\}\$/.test(mainSrc)) v.push("Host 没按 ^cm-<16> 的形状采纳渲染端 id（乱传的 id 能直接进库）");
  if (!/userRow\.id = clientMsgId/.test(mainSrc)) v.push("Host 没把采纳的 id 挂到 userRow.id");
  const iEcho = mainSrc.indexOf("result.echo_entry_id");
  const iStored = mainSrc.indexOf("result.stored_ids");
  if (iEcho < 0) v.push("回包里不产 echo_entry_id（渲染端无从对账）");
  else if (iStored >= 0 && iEcho < iStored) v.push("echo_entry_id 在 stored_ids 之前赋值（取的是没落库前的 ids）");
  if (!/String\(r\.id\) === wanted/.test(storeSrc)) v.push("sessions.js 不再查重：两条消息可能共用一个 id");
  v.length ? bad("CC-26", "Host 侧的乐观身份没闭合：" + v.join("、"))
    : ok("CC-26", `main.js 只采纳形状为 ^cm-[0-9a-z]{16}$ 的 id 当落库行 id、回包按 stored_ids 之后回显 echo_entry_id；` +
        "sessions.js 撞 id 时另发新 id（那条会在界面判成 unmatched，而不是悄悄覆盖）");
}

/* ---------- CC-08 负向对照（不翻红就说明上面是空的） ---------- */

{
  // N1：摘掉 fold 的 history_pruned 分支 → fold 必须把它记成 anomaly
  const broken = reducerSrc.replace(
    '} else if (kind === "history_pruned") {',
    '} else if (false) {',
  );
  if (broken === reducerSrc) bad("CC-08-N1", "源码里找不到 history_pruned 分支，对照无从做起");
  else {
    const m = { exports: {} };
    const brokenCore = new Function("module", "exports", broken + "\nreturn module.exports;")(m, m.exports);
    const rows = [
      { seq: 1, sessionId: "s1", kind: "session_created", payload: { surface: "sessions", session: { id: "s1", messages: [{ id: "a" }, { id: "b" }] } } },
      { seq: 2, sessionId: "s1", kind: "history_pruned", payload: { count: 1 } },
    ];
    const f = brokenCore.foldEvents(rows);
    f.anomalies.length ? ok("CC-08-N1", `摘掉 history_pruned 分支后 fold 报 anomaly（${f.anomalies[0].slice(0, 40)}）—— CC-06/07 不是恒真`) : bad("CC-08-N1", "摘掉分支 fold 仍然不报错，断言是空的");
  }
  // N2：词表塞一个 fold 不认的 kind → CC-06 的算法必须点名它
  const fake = { TURN_EVENT_KINDS: Object.assign({ phantom_kind: { payload: [], durable: true } }, schema.TURN_EVENT_KINDS) };
  const loose = Object.keys(fake.TURN_EVENT_KINDS).filter((k) => !reducerSrc.includes('kind === "' + k + '"') && !core.IGNORED_KINDS.has(k));
  loose.includes("phantom_kind") ? ok("CC-08-N2", "塞进 fold 不认的 kind，CC-06 的判据能点名它（phantom_kind）") : bad("CC-08-N2", "CC-06 抓不到凭空加的 kind");
  // N3：fold 换成第二份实现 → CC-02 必须红
  {
    const mirror = require(path.join(REPO, "hosts/shared/event_mirror.js"));
    mirror.foldEvents !== core.foldEvents ? bad("CC-03-N3", "fold 竟然还是两份") : ok("CC-02-N3", "引用相等这条判据成立的前提：核心与 Host 指向同一函数（若哪天变成两份，它立刻红）");
  }
  /* N4：把「rev 必须等于 anchor+1」的跳号自愈摘掉 → CC-09 的 gap 判据必须翻红。
     这正是「半截 diff 糊在旧屏幕上」的那条路，尺子要能自己抓住它。 */
  {
    const brokenSrc = diffSrc.replace(
      /if \(!Array\.isArray\(state && state\.buckets && state\.buckets\.visible\) \|\| !revKnown \|\| anchor === null \|\| rev !== anchor \+ 1\) \{/,
      "if (false) {",
    );
    if (brokenSrc === diffSrc) bad("CC-09-N4", "找不到跳号自愈那段，对照无从做起");
    else {
      const m = { exports: {} };
      const broken = new Function("module", "exports", brokenSrc + "\nreturn module.exports;")(m, m.exports);
      const st = broken.snapshotToState(sessSnap(10), sessSpec());
      const gap = broken.applyDiff(st, { rev: 12, changed: [{ entity_id: "s1", changed_fields: { title: "半截" } }] }, sessSpec());
      const stillHeals = diffCore.effectTypes(gap.effects).join() === "self_heal";
      stillHeals ? bad("CC-09-N4", "摘掉跳号自愈后仍然报 self_heal —— CC-09 那条判据是空的")
        : ok("CC-09-N4", `摘掉跳号自愈后 rev=12 的 diff 被直接应用（${diffCore.effectTypes(gap.effects)}、title→${gap.state.buckets.visible[0].title}），CC-09 判据有牙`);
    }
    /* N5：把字段白名单那道判定摘掉 → CC-10 的 field_not_patchable 必须消失 */
    const broken5 = diffSrc.replace(/if \(patchable && !Object\.keys\(cf\)\.every\(\(k\) => patchable\[k\]\)\) \{/, "if (false) {");
    if (broken5 === diffSrc) bad("CC-10-N5", "找不到字段白名单判定，对照无从做起");
    else {
      const m5 = { exports: {} };
      const b5 = new Function("module", "exports", broken5 + "\nreturn module.exports;")(m5, m5.exports);
      const r = b5.applyDiff(b5.snapshotToState(botSnap(10), botSpec()), { rev: 11, changed: [{ entity_id: "b1", changed_fields: { model: "gpt" } }] }, botSpec());
      const reasons5 = r.effects.filter((e) => e.type === "structural_rebuild").map((e) => e.reason);
      reasons5.includes("field_not_patchable")
        ? bad("CC-10-N5", "摘掉白名单后仍报 field_not_patchable，CC-10 那条是空的")
        : ok("CC-10-N5", `摘掉白名单后未知字段 model 被当成能就地更新（效果 ${diffCore.effectTypes(r.effects)}、reason ${reasons5.length ? reasons5 : "无"}），CC-10 判据有牙`);
    }
  }
  /* N6：渲染端少接一个效果 → CC-13b 必须点名（把 runSessionEffects 里的 remove_row 分支抹掉再跑同一套判据）。 */
  {
    const body = htmlBodies.runSessionEffects;
    if (!body) bad("CC-13b-N6", "取不到 runSessionEffects 函数体，对照无从做起");
    else {
      const stripped = body.replace('case "remove_row": {', 'case "__removed_row_unused": {');
      const judge = (txt) => diffCore.EFFECTS.filter((t) => !new RegExp('["\']' + t + '["\']').test(txt));
      const before = judge(body);
      const after = judge(stripped);
      before.length === 0 && after.includes("remove_row")
        ? ok("CC-13b-N6", "抹掉 remove_row 分支后判据立刻点名（原 0 缺 → 现缺 " + after.join(",") + "）")
        : bad("CC-13b-N6", `对照没翻红：before=${before} after=${after}`);
    }
  }
  /* N7：核心不再产 scalar 类 structural_rebuild → CC-10 的 scalar_sessions 判据必须翻红。 */
  {
    const broken7 = diffSrc.replace('effects.push({ type: "structural_rebuild", surface, reason: "scalar" });', "0;");
    if (broken7 === diffSrc) bad("CC-10-N7", "找不到标量整份重画那行，对照无从做起");
    else {
      const m7 = { exports: {} };
      const b7 = new Function("module", "exports", broken7 + "\nreturn module.exports;")(m7, m7.exports);
      const r = b7.applyDiff(b7.snapshotToState(sessSnap(10), sessSpec()), { rev: 11, scalars: { active_id: "s2" } }, sessSpec());
      const reasons7 = r.effects.filter((e) => e.type === "structural_rebuild").map((e) => e.reason);
      reasons7.includes("scalar") ? bad("CC-10-N7", "摘掉后仍报 scalar，判据是空的") : ok("CC-10-N7", `摘掉 scalar 重画后 active_id 变了却不重画（reason ${reasons7.length ? reasons7 : "无"}）`);
    }
  }
  /* N8：CC-01b 那个 realm 会不会真的接住「顶层撞名」？把三份文件的 IIFE 外壳剥掉 ——
     那就是 2026-11-12 翻车时的形状（三份都在顶层写 const API）。第二次声明必须当场
     SyntaxError；接不住说明 CC-01b 只是在走过场（上一版正是这样：每份文件各自一个
     new Function 作用域，撞名根本传不进来）。 */
  {
    const leak = (src) => src.replace(/^\(function \(\) \{\n/m, "").replace(/\}\)\(\);\n?$/, "\n");
    const leaked = CORE_FILES.map((f) => [f, leak(CORE_SRC[f])]);
    if (leaked.every(([n, s], i) => s !== CORE_SRC[CORE_FILES[i]])) {
      const dup = assembleRealm(leaked);
      dup.error && /already been declared/i.test(dup.error)
        ? ok("CC-01b-N8", `剥掉 IIFE 外壳后同 realm 第二次声明 API 当场 ${dup.error.slice(0, 46)} —— CC-01b 的装配有牙`)
        : bad("CC-01b-N8", "剥掉外壳、" + CORE_FILES.length + " 份都声明顶层 const API 后装配照样通过（error=" + (dup.error || "无报错") + "），CC-01b 测不到撞名");
    } else bad("CC-01b-N8", "剥不掉 " + CORE_FILES.length + " 份文件的 IIFE 外壳，撞名对照无从做起");
  }
  /* N9：把 reducer.js 的模块守卫拆掉（就是 2026-11-12 那次真实翻车的写法），realm 里没有
     module → 必须 ReferenceError。不翻红说明「没有模块系统也能跑」这句是空的。 */
  {
    const bareExport = reducerSrc.replace('if (typeof module !== "undefined" && module.exports) module.exports = API;', "module.exports = API;");
    if (bareExport === reducerSrc) bad("CC-01b-N9", "找不到模块导出守卫，对照无从做起");
    else {
      const r9 = assembleRealm(CORE_FILES.map((f) => [f, f === "reducer.js" ? bareExport : CORE_SRC[f]]));
      r9.error ? ok("CC-01b-N9", `摘掉模块守卫后无模块系统的 realm 里当场 ${r9.error.slice(0, 40)}，侧栏会白屏 —— 判据能抓住`)
        : bad("CC-01b-N9", "摘掉守卫后照样装配成功，CC-01b 测不出「浏览器里没有 module」这件事");
    }
  }
}

/* ---------- CC-16..CC-23 transport：接口形状 + 乐观身份 + 去重排队（T3-04 / T3-06 核心侧） ---------- */
/* 这几条要 await：createSurfaceStream 存在的全部意义是「同一张面的帧排队折叠」，
   不真跑一轮挂起的异步链，测不出插队。所以整块挂在收尾打印之前跑。 */
async function runTransportRules() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const S = transport.CMD_STATE;
  /* rand 给自增序列：每条乐观消息的 id 必不同、又可预测（门不靠 Math.random 造身份）。 */
  const randSeq = () => { let k = 0; return () => String(++k); };
  const fullFrame = (rev) => Object.assign({ mode: "full", rev }, sessSnap(rev));
  const diffFrame = (rev, title) => ({ mode: "diff", rev, changed: [{ entity_id: "s1", changed_fields: { title } }] });
  const titleOf = (rep) => {
    const rows = rep.state && rep.state.buckets ? rep.state.buckets.visible : null;
    return rows && rows.length ? rows[0].title : "(没行)";
  };
  const snapWith = (rev, title) => {
    const s = JSON.parse(JSON.stringify(sessSnap(rev)));
    s.sessions[0].title = title;
    return s;
  };
  const loadSrc = (src) => {
    const m = { exports: {} };
    return new Function("module", "exports", src + "\nreturn module.exports;")(m, m.exports);
  };
  /* 摘掉 transport 里某段判据（负向对照用）。摘不到就红 —— 对照不许因为字符串漂移而假装通过。 */
  const mutate = (id, from, to) => {
    if (!transportSrc.includes(from)) {
      bad(id, "transport.js 里找不到要摘的那段判据：" + from.slice(0, 52));
      return null;
    }
    return loadSrc(transportSrc.replace(from, to));
  };

  /* CC-16 依赖注入的纯度 + 两条加载路径同一结果 */
  {
    const tCode = codeOnly(transportSrc);
    const named = ["applyDiff(", "snapshotToState(", "foldEvents(", "require("].filter((s) => tCode.includes(s));
    const receipts = new Set(Object.keys(schema.COMMANDS).flatMap((n) => schema.COMMANDS[n].receipt));
    const echoOk = transport.ECHO_FIELDS.length > 0 && transport.ECHO_FIELDS.every((f) => receipts.has(f));
    const codeOk = JSON.stringify(transport.REJECT_FIELDS) === JSON.stringify(schema.REJECTED_RECEIPT_FIELDS);
    const textOk = JSON.stringify(transport.REJECT_TEXT_FIELDS) === JSON.stringify(schema.REJECTED_RECEIPT_TEXT_FIELDS);
    const ids = new Set();
    for (let i = 0; i < 500; i++) ids.add(transport.makeClientId());
    const idOk = ids.size === 500 && [...ids].every((x) => /^cm-[0-9a-z]{16}$/.test(x));
    if (named.length || !echoOk || !codeOk || !textOk || !idOk)
      bad("CC-16", `transport 不干净：直接点了核心的名字 [${named}]；echo 字段不在 command receipt 词表里=${!echoOk}（${transport.ECHO_FIELDS}）；` +
          `码字段与 schema 脱节=${!codeOk}（${transport.REJECT_FIELDS} vs ${schema.REJECTED_RECEIPT_FIELDS}）；原文字段脱节=${!textOk}；id 形状/唯一性=${idOk}`);
    else if (assembled.error) bad("CC-16", "realm 装配失败，无从对拍 transport");
    else {
      const build = (ns, T) => {
        const painted = [];
        const s = T.createSurfaceStream({
          surface: "sessions",
          fold: (state, frame) => ns.applyDiff(state, frame, sessSpec()),
          full: (snap) => ns.snapshotToState(snap, sessSpec()),
          read: async () => ({ ok: true, rev: 12, payload: sessSnap(12) }),
          paint: (rep) => painted.push(rep.mode + ":" + rep.rev),
        });
        return { s, painted };
      };
      const viaBrowser = build(assembled.ns, assembled.ns);
      const viaHost = build(diffCore, transport);
      const frames = [fullFrame(10), diffFrame(11, "改名"), diffFrame(12, "半截")];
      for (const f of frames) await viaBrowser.s.intake(f);
      for (const f of frames) await viaHost.s.intake(f);
      const a = JSON.stringify(viaBrowser.s.state) + "|" + viaBrowser.painted.join(",") + "|" + JSON.stringify(viaBrowser.s.stats());
      const b = JSON.stringify(viaHost.s.state) + "|" + viaHost.painted.join(",") + "|" + JSON.stringify(viaHost.s.stats());
      a === b && viaHost.painted.join(",") === "full:10,diff:11,diff:12"
        ? ok("CC-16", "transport 只认注入的 fold/full/read/paint（不点核心函数名、不 require），" +
            "浏览器 realm 版与 Host require 版在同一串帧上给出同一状态 + 同一重画序列（" + viaHost.painted.join(",") + "）；" +
            "回执码/原文字段逐字等于 schema 的单点定义，echo 字段就是 command receipt 里那个，500 个 client_msg_id 无撞车")
        : bad("CC-16", "两条加载路径的 transport 分叉：" + a.slice(0, 160) + " ≠ " + b.slice(0, 160));
    }
  }

  /* CC-17 乐观命令的四种结局，每种都要能被界面区分画出来 */
  {
    const clock = { t: 1000 };
    const lg = transport.createLedger({ rand: randSeq(), now: () => clock.t });
    const a = lg.begin("user_message", { text: "已落库", session_id: "s1" });
    const b = lg.begin("user_message", { text: "还在等", session_id: "s1" });
    const c = lg.begin("user_message", { text: "被拒有码", session_id: "s1" });
    const d = lg.begin("user_message", { text: "被拒没码", session_id: "s1" });
    const e = lg.begin("user_message", { text: "回执没 echo", session_id: "s1" });
    const f = lg.begin("user_message", { text: "落库成别的了", session_id: "s1" });
    const g = lg.begin("user_message", { text: "Host写法的码", session_id: "s1" });
    const h = lg.begin("user_message", { text: "内核写法的码", session_id: "s1" });
    lg.settle(a.cmd.client_msg_id, { ok: true, echo_entry_id: a.cmd.client_msg_id });
    lg.settle(f.cmd.client_msg_id, { ok: true, echo_entry_id: "msg-777" });
    lg.settle(e.cmd.client_msg_id, { ok: true });
    lg.settle(c.cmd.client_msg_id, { ok: false, code: "turn_failed" });
    lg.settle(d.cmd.client_msg_id, { ok: false, error: "内核只给了自由文本" });
    lg.settle(g.cmd.client_msg_id, { ok: false, error_code: "provider_unconfigured", message: "没配 key" });
    lg.settle(h.cmd.client_msg_id, { ok: false, rejection_code: "turn_failed", error: "上游文案" });
    const late = lg.settle(a.cmd.client_msg_id, { ok: false, code: "LATE_NO_REVERT" });
    const pend = lg.pending().map((x) => x.text);
    const ann = (cmd) => cmd.anomalies.join("；");
    const checks = {
      durable: a.cmd.state === S.Durable && a.cmd.entry_id === a.cmd.client_msg_id,
      unmatchedEcho: f.cmd.state === S.Unmatched && /不是界面上这条/.test(ann(f.cmd)) && /msg-777/.test(ann(f.cmd)),
      noEcho: e.cmd.state === S.Unmatched && /没有 echo_entry_id/.test(ann(e.cmd)),
      rejectedWithCode: c.cmd.state === S.Rejected && c.cmd.code === "turn_failed" && !ann(c.cmd),
      rejectedNoCode: d.cmd.state === S.Rejected && !d.cmd.code && /KP-3|KP-03/.test(ann(d.cmd)),
      threeCodeSpellings: g.cmd.code === "provider_unconfigured" && h.cmd.code === "turn_failed" && !ann(g.cmd) && !ann(h.cmd),
      terminalFrozen: late.late === true && a.cmd.state === S.Durable && a.cmd.code === "",
      pendingOnly: pend.join() === "还在等",
    };
    const failed = Object.keys(checks).filter((k) => !checks[k]);
    failed.length
      ? bad("CC-17", "乐观命令结局不对：" + failed.join("、") + "（durable=" + a.cmd.state + " unmatched=" + f.cmd.state + "/" + ann(f.cmd).slice(0, 40) +
          " 无echo=" + e.cmd.state + " 拒绝码=" + JSON.stringify(c.cmd.code) + " 无码异常=" + ann(d.cmd).slice(0, 40) + " 终态回退=" + JSON.stringify(late) + " pending=" + pend + "）")
      : ok("CC-17", "台账四态闭环：echo 相等→durable；echo 不等→unmatched 且 anomaly 点名两个 id；无 echo→unmatched（不许亮成已送达）；" +
          "拒绝带码→rejected+码；拒绝没码→rejected+异常；终态不被迟到回执改回去（pending 只剩 " + pend.join() + "）");
  }

  /* N10：rand 太弱（定值）时两条乐观消息会拿到同一个身份。屏幕上表现为「第二条把
     第一条顶掉」——这种错必须当场响，不许静默覆盖，所以 nextClientId 有 8 次重试后抛错。 */
  {
    const lg = transport.createLedger({ rand: () => 0.42, now: () => 0 });
    lg.begin("user_message", { text: "第一条" });
    let threw = "";
    try { lg.begin("user_message", { text: "第二条" }); } catch (e) { threw = String(e.message); }
    const real = transport.makeClientId();
    threw.includes("撞车")
      ? ok("CC-18-N10", `定值 rand 下第二次 begin 当场抛「${threw.slice(0, 30)}…」（台账仍只有 ${lg.size()} 条，没顶掉第一条）；` +
          `生产用 Math.random 那条路照样出 ${real.slice(0, 19)} 形状`)
      : bad("CC-18-N10", `定值 rand 造出同一个 id 却没报错（threw="${threw}"，size=${lg.size()}）—— 乐观消息会被互相覆盖而无人知情`);
  }

  /* CC-18 幂等：同一个 idem_key 在等待期间重复 begin 不产生第二条乐观消息 */
  {
    const lg = transport.createLedger({ rand: randSeq(), now: () => 1 });
    const x = lg.begin("user_message", { text: "双击", session_id: "s1", idem_key: "k-1" });
    const y = lg.begin("user_message", { text: "双击", session_id: "s1", idem_key: "k-1" });
    const z = lg.begin("user_message", { text: "双击", session_id: "s1", idem_key: "k-2" });
    lg.settle(x.cmd.client_msg_id, { ok: true, echo_entry_id: x.cmd.client_msg_id });
    const w = lg.begin("user_message", { text: "双击", session_id: "s1", idem_key: "k-1" });
    const ok18 = y.reused && y.cmd === x.cmd && y.optimistic === x.optimistic &&
      !z.reused && z.cmd !== x.cmd && !w.reused && w.cmd !== x.cmd && lg.size() === 3;
    ok18
      ? ok("CC-18", "idem_key 命中还在等的命令→复用同一条（optimistic 都同一对象）；换键→新条目；落库后同键再发→新条目（台账 3 条）")
      : bad("CC-18", `幂等不对：reused=${y.reused} 同对象=${y.cmd === x.cmd} 换键=${z.reused} 终态后=${w.reused} size=${lg.size()}`);
  }

  /* CC-19 超时与上限：等太久的 pending 判 expired，淘汰只动终态 */
  {
    let t = 0;
    const lg = transport.createLedger({ rand: randSeq(), now: () => t });
    const a = lg.begin("user_message", { text: "已落库", session_id: "s1" });
    t = 10;
    const b = lg.begin("user_message", { text: "没人认", session_id: "s1" });
    lg.settle(a.cmd.client_msg_id, { ok: true, echo_entry_id: a.cmd.client_msg_id });
    t = 9000;
    const expired = lg.expire(5000);
    const noLimit = lg.expire(NaN);
    const big = transport.createLedger({ rand: randSeq(), now: () => 0 });
    const ids = [];
    for (let i = 0; i < transport.LEDGER_MAX + 64; i++) ids.push(big.begin("user_message", { text: "x" + i }).cmd.client_msg_id);
    ids.forEach((id, i) => { if (i % 4 !== 0) big.settle(id, { ok: true, echo_entry_id: id }); });
    big.begin("user_message", { text: "触发淘汰" });
    const ok19 = expired.length === 1 && expired[0] === b.cmd && b.cmd.state === S.Expired &&
      /回执超时/.test(b.cmd.anomalies.join()) && a.cmd.state === S.Durable && noLimit.length === 0 &&
      big.size() <= transport.LEDGER_MAX && big.pending().length === 81;
    ok19
      ? ok("CC-19", "expire 只把还在等的判成 expired（已落库那条不动，异常里写了 8990ms > 5000ms）；" +
          "台账上限 " + transport.LEDGER_MAX + " 条只淘汰终态，还在等的 " + big.pending().length + " 条一条没丢（size=" + big.size() + "）")
      : bad("CC-19", `超时/上限不对：expired=${expired.length}/${expired.map((x) => x.text)} a=${a.cmd.state} b=${b.cmd.state} NaN→${noLimit.length} size=${big.size()} pending=${big.pending().length}`);
  }

  /* CC-20 去重发生在核心：不比游标新的帧不改状态、不重画、也不把游标拖回去 */
  const dedupScenario = async (T) => {
    const painted = [];
    const stream = T.createSurfaceStream({
      surface: "sessions",
      fold: (state, frame) => diffCore.applyDiff(state, frame, sessSpec()),
      full: (snap) => diffCore.snapshotToState(snap, sessSpec()),
      read: async () => ({ ok: true, rev: 10, payload: sessSnap(10) }),
      paint: (rep) => painted.push(titleOf(rep)),
    });
    await stream.intake(fullFrame(10));
    await stream.intake(diffFrame(10, "回声"));
    await stream.intake(diffFrame(9, "重放的旧帧"));
    await stream.intake(diffFrame(11, "改名"));
    const s = stream.stats();
    return { cursor: s.cursor, paints: painted.length, dups: s.dups, resyncs: s.resyncs, titles: painted.join(">") };
  };
  const dedupJudge = (r) => r.cursor === 11 && r.paints === 2 && r.dups === 2 && r.resyncs === 0 && r.titles === "对标 Grok>改名";
  {
    const r20 = await dedupScenario(transport);
    dedupJudge(r20)
      ? ok("CC-20", "同一张面上 rev 不比游标新的两帧（回声 10、重放的 9）在 intake 就被丢：dups=2、只重画 2 次、游标没被拖回 9，" +
          "紧随其后的 11 仍算连续（resyncs=0）—— 去重在核心，不在渲染端")
      : bad("CC-20", "去重不对：" + JSON.stringify(r20));
    /* N11：摘掉 intake 的游标判定 → 上面那条判据必须翻红，且看得见伤害（游标倒退 + 多一次重画） */
    const badT = mutate("CC-20-N11", "if (Number.isFinite(rev) && Number.isFinite(st.cursor) && rev <= st.cursor) {", "if (false) {");
    if (badT) {
      const r = await dedupScenario(badT);
      const harm = !r.titles.includes("改名");
      dedupJudge(r)
        ? bad("CC-20-N11", "摘掉游标判定后判据照样绿 —— CC-20 是空的")
        : harm
          ? ok("CC-20-N11", `摘掉游标判定后同一串帧：游标被旧帧拖回 ${r.cursor}、重画 ${r.paints} 次、resyncs=${r.resyncs}，画出来 ${r.titles}` +
              " —— 真正改了名的那帧被当成跳号、整份重取盖掉，改名丢了，CC-20 判据有牙")
          : bad("CC-20-N11", `摘掉游标判定只是让计数变了（cursor=${r.cursor} paints=${r.paints} titles=${r.titles}），没造成看得见的丢帧，说明 CC-20 盯的不是危害`);
    }
  }

  /* CC-21 跳号那帧根本进不了折叠：半截 diff 不上屏，改成整份取数（带 from_seq） */
  const gapScenario = async (T, fold) => {
    const folds = [];
    const painted = [];
    const reads = [];
    const stream = T.createSurfaceStream({
      surface: "sessions",
      fold: (state, frame) => { folds.push(Number(frame && frame.rev)); return fold(state, frame); },
      full: (snap) => diffCore.snapshotToState(snap, sessSpec()),
      read: async (surface, fromSeq) => { reads.push(fromSeq); return { ok: true, rev: 12, payload: snapWith(12, "整份真值") }; },
      paint: (rep) => painted.push(titleOf(rep)),
    });
    await stream.intake(fullFrame(10));
    await stream.intake(diffFrame(12, "半截"));
    const s = stream.stats();
    return { folds: folds.length, resyncs: s.resyncs, heals: s.heals, cursor: s.cursor, reads, titles: painted.join(">") };
  };
  /* 故意用一个「不看 rev、来就改」的折叠器：真出这种折叠器时（渲染端自己 patch 字段就是这形状），
     跳号帧也不能落到屏上 —— 这条规则属于链，不属于某一份 fold。 */
  const naiveFold = (state, frame) => {
    const next = JSON.parse(JSON.stringify(state));
    for (const c of (frame.changed || [])) {
      const row = next.buckets.visible.find((x) => String(x.id) === String(c.entity_id));
      if (row) Object.assign(row, c.changed_fields);
    }
    return { state: next, effects: [{ type: "patch_row" }] };
  };
  const gapJudge = (r) => r.folds === 0 && r.resyncs === 1 && r.heals === 0 && r.cursor === 12 &&
    r.reads[0] === 10 && r.titles === "对标 Grok>整份真值";
  {
    const r21 = await gapScenario(transport, naiveFold);
    gapJudge(r21)
      ? ok("CC-21", "rev=12 落在游标 10 后面：链先判跳号，折叠器一次都没被叫到（哪怕它是「来就改」的那种），" +
          "半截 diff 没上过屏；改成带 from_seq=10 的整份取数，取回即新基线（cursor=12、heals=0）")
      : bad("CC-21", "跳号处理不对：" + JSON.stringify(r21));
    const badT = mutate("CC-21-N12", "const gap = Number.isFinite(st.cursor) && Number.isFinite(rev) && rev > st.cursor + 1;", "const gap = false;");
    if (badT) {
      const r = await gapScenario(badT, naiveFold);
      gapJudge(r)
        ? bad("CC-21-N12", "摘掉跳号判定后判据照样绿 —— CC-21 是空的")
        : ok("CC-21-N12", `摘掉跳号判定后那帧半截直接进折叠：画出来 ${r.titles}（folds=${r.folds}、resyncs=${r.resyncs}、cursor=${r.cursor}）` +
            " —— 屏上出现「模型改了名但中间三帧没见过」的状态，CC-21 判据有牙");
    }
  }

  /* CC-22 整份取数在途时，后到的帧排队，不作用在旧基线上 */
  const queueScenario = async (T) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const folds = [];
    const painted = [];
    const stream = T.createSurfaceStream({
      surface: "sessions",
      fold: (state, frame) => { folds.push(Number(frame && frame.rev)); return diffCore.applyDiff(state, frame, sessSpec()); },
      full: (snap) => diffCore.snapshotToState(snap, sessSpec()),
      read: async () => { await gate; return { ok: true, rev: 12, payload: snapWith(12, "整份真值") }; },
      paint: (rep) => painted.push(rep.mode + ":" + titleOf(rep)),
    });
    await stream.intake(fullFrame(10));
    const p1 = stream.intake(diffFrame(12, "跳号"));
    await wait(1);
    const p2 = stream.intake(diffFrame(13, "后来的那一帧"));
    await wait(2);
    const queuedWhileRead = stream.stats().queued;
    const foldsWhileRead = folds.length;
    release();
    await p1; await p2;
    const s = stream.stats();
    return { foldsWhileRead, queuedWhileRead, cursor: s.cursor, resyncs: s.resyncs, queued: s.queued, paints: painted.join(">") };
  };
  const queueJudge = (r) => r.foldsWhileRead === 0 && r.queuedWhileRead === 1 && r.cursor === 13 &&
    r.resyncs === 1 && r.queued === 0 && r.paints === "full:对标 Grok>full:整份真值>diff:后来的那一帧";
  {
    const r22 = await queueScenario(transport);
    queueJudge(r22)
      ? ok("CC-22", "整份取数挂起期间，rev=13 那帧只在链上排队（queued=1、fold 一次没被叫），" +
          "取回 rev=12 的基线后才折叠 → 顺序是 full→full→diff，游标 13、链已排空" +
          " —— 这就是今天 applyBotsDiff 里 await refreshBots() 抢跑的那条形")
      : bad("CC-22", "排队不对：" + JSON.stringify(r22));
    const badT = mutate("CC-22-N13", "st.chain = st.chain.then(() => handle(frame))", "st.chain = handle(frame)");
    if (badT) {
      const r = await queueScenario(badT);
      const harm = !r.paints.includes("后来的那一帧");
      queueJudge(r)
        ? bad("CC-22-N13", "摘掉链后判据照样绿 —— CC-22 是空的")
        : harm
          ? ok("CC-22-N13", `摘掉「排到链上」后 rev=13 那帧在旧基线（游标 10）上被判：queued=${r.queuedWhileRead}、folds=${r.foldsWhileRead}、` +
              `画出来 ${r.paints}、cursor=${r.cursor} —— 它被当成跳号，取数回来后整份盖掉，界面上那条永远不见了，CC-22 判据有牙`)
          : bad("CC-22-N13", `摘掉链后计数变了但那条帧还是上了屏（${r.paints}），CC-22 盯的不是危害`);
    }
  }

  /* CC-23 回包形状：只认成功信封里的 payload，绝不把信封当快照 */
  {
    const env = { ok: true, surface: "sessions", rev: 9, payload: sessSnap(9) };
    const good = transport.unwrapRead(env, "sessions");
    const rowsOfPayload = diffCore.snapshotToState(good.payload, sessSpec()).buckets.visible.length;
    const rowsOfEnvelope = diffCore.snapshotToState(env, sessSpec()).buckets.visible.length;
    const failed = transport.unwrapRead({ ok: false, error: "库锁住了" }, "sessions");
    const noPayload = transport.unwrapRead({ ok: true, rev: 3 }, "sessions");
    const arrayPayload = transport.unwrapRead({ ok: true, rev: 3, payload: [] }, "sessions");
    const notObj = transport.unwrapRead(null, "sessions");
    const strRev = transport.unwrapRead({ ok: true, rev: "7", payload: sessSnap(7) }, "sessions");
    const ok23 = good.ok && good.rev === 9 && rowsOfPayload === 2 && rowsOfEnvelope === 0 &&
      !failed.ok && /库锁住了/.test(failed.error) && !noPayload.ok && /payload 字段/.test(noPayload.error) &&
      !arrayPayload.ok && /不是快照对象/.test(arrayPayload.error) && !notObj.ok && strRev.rev === 7 && !Number.isNaN(strRev.rev);
    ok23
      ? ok("CC-23", `unwrapRead 只从成功信封取 .payload（${rowsOfPayload} 行），把信封整份喂折叠器是 ${rowsOfEnvelope} 行 —— ` +
          "就是 KD-11 对拍第一次栽的那个坑；失败/无 payload/payload 非对象/回包不是对象四种都有可读原因，rev 字符串也归数")
      : bad("CC-23", `信封拆法不对：good=${JSON.stringify(good)} 行数 payload=${rowsOfPayload}/信封=${rowsOfEnvelope} ` +
          `失败=${JSON.stringify(failed)} 无payload=${JSON.stringify(noPayload)} 数组=${JSON.stringify(arrayPayload)} null=${JSON.stringify(notObj)} rev="7"→${strRev.rev}`);
  }
}

runTransportRules()
  .catch((e) => bad("CC-16..23", "transport 规则自己炸了：" + String((e && e.stack) || e).split("\n").slice(0, 3).join(" / ")))
  .then(() => {
    console.log(
      "\n== 覆盖面自证 == 规则 " + notes.length + " 条（" + notes.join(",") + "）；" +
      "目标文件：hosts/shared/client_core/{" + CORE_FILES.join(",") + "}、hosts/shared/event_mirror.js、" +
      "hosts/desktop/index.html、hosts/desktop/main.js、hosts/desktop/sessions.js、hosts/desktop/package.json、docs/events.md、ui_protocol/types.mbt；" +
      CORE_FILES.map((f) => f + " " + CORE_SRC[f].split("\n").length + " 行").join(" / ") + "；效果闭集 " + diffCore.EFFECTS.length +
      " 类、结构原因闭集 " + diffCore.REASONS.length + " 类；乐观命令终态 " + Object.keys(transport.CMD_STATE).length +
      " 种；负向对照 15 条（N1..N15）"
    );
    console.log("\nprove_client_core: PASS=" + PASS + " FAIL=" + FAIL);
    process.exit(FAIL ? 1 : 0);
  });
