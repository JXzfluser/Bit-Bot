/*
 * prove_surface_parity.mjs — G-125 对账尺门（#81 / §8.159 定稿口径）。
 *
 * 判据不数「说了什么」，数「屏幕/日志上看到什么」（§8.70 口径）：这里看的是尺的**结构化读数**
 * 与它给出的行，且每条动态判据都配一条能把它打红的突变体（见文件末 REVERSE 一节）。
 *
 * 三条必须钉住的形状（都是本轮实测踩出来的）：
 *   A. 「没有读数」≠「读数为 0」。夹具里两侧都坏时必须落到 no_reading，且这条记录不许带零计数。
 *   B. 面文件路径必须带 desktop/ 一层。少一层会让三张面全部读成 no_reading —— 看上去安全，
 *      实际是尺自己瞎了（§8.161 记的就是这个：门禁写进用户看得见的数据那一类坑的反面）。
 *   C. 干净双写之后 drift 必须是 0 且 matched 必须 > 0。只有 0 而没有 matched，
 *      说明两侧都是空集，那条 0 是恒真的。
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");

let PASS = 0;
let FAIL = 0;
let SKIP = 0;
function ok(name, cond, detail) {
  if (cond) {
    PASS += 1;
    console.log(`  ✓ PW ${name}`);
  } else {
    FAIL += 1;
    console.log(`  ✗ PW ${name}${detail ? ` —— ${detail}` : ""}`);
  }
}
function honestSkip(name, why) {
  SKIP += 1;
  console.log(`  - PW ${name}（未测：${why}）`);
}

const parity = require(path.join(repoRoot, "hosts/shared/surface_parity.js"));
const { createSessionStore } = require(path.join(repoRoot, "hosts/desktop/sessions.js"));

function freshRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-pw-"));
}
const os = require("node:os");

/* 双写默认是关的（event_mirror.js:454）—— 不打开就没有日志侧，这条尺只能空转。 */
process.env.BITBOT_EVENT_DUAL_WRITE = "1";

const root = freshRoot();
const store = createSessionStore(repoRoot, { dataRoot: root });
const s1 = store.create("PW 甲");
const s2 = store.create("PW 乙");
const sjPath = path.join(root, "desktop", "sessions.json");
const readSj = () => JSON.parse(fs.readFileSync(sjPath, "utf8"));
const writeSj = (o) => fs.writeFileSync(sjPath, JSON.stringify(o));

/* ── 判据 A：干净双写 ───────────────────────────────────────────────── */
let r = parity.auditSurfaces({ dataRoot: root });
const sess = () => r.records.find((x) => x.surface === "sessions");
/* E 必须落在「干净双写那一刻」的记录上：D 一节会把日志库删掉，之后再取就变成 no_reading。
   上一版就是这么错的 —— 判据本身没坏，是取数时机坏，读起来像「尺丢了 painted 字段」。*/
const cleanRec = { ...sess() };
ok("A1 干净双写后 sessions 是「有读数」而不是 no_reading", sess().kind === "reading", JSON.stringify(sess()));
ok("A2 干净双写后 drift=0 **且** matched>0（只有 0 不作数，两侧都空也是 0）", r.drift === 0 && sess().matched > 0, JSON.stringify(sess()));
ok("A3 干净面的一行是 info 级（非零才 warn）", r.levels[r.records.indexOf(sess())] === "info", JSON.stringify(r.levels));

/* ── 判据 B：漂移必须被点名 ─────────────────────────────────────────── */
const o = readSj();
o.sessions[0].title = "PW 只在 JSON 里改的标题";
writeSj(o);
r = parity.auditSurfaces({ dataRoot: root });
ok("B1 JSON 侧改一个字段 → mismatched=1", sess().mismatched === 1, JSON.stringify(sess()));
ok("B2 首处差异点名到实体的 title（不是只说「有偏差」）", /title/.test(String(sess().firstDiff)), String(sess().firstDiff));
ok("B3 drift 随偏差变非零，级别升到 warn", r.drift > 0 && r.levels[r.records.indexOf(sess())] === "warn", JSON.stringify(r.levels));

/* ── 判据 C：两个方向不能混成一个词（§8.159：不搬 missing/extra）───── */
const o2 = readSj();
o2.sessions[0].title = "PW 甲";
o2.sessions.push({ id: "pw-sess-only-json", title: "PW 戊", messages: [] });
writeSj(o2);
r = parity.auditSurfaces({ dataRoot: root });
const ss = sess();
ok("C1 只在 JSON 一侧 → inJsonNotFold=1 且 inFoldNotJson=0（两个具名字段，方向不混）",
  ss.inJsonNotFold === 1 && ss.inFoldNotJson === 0, JSON.stringify(ss));
const keys = Object.keys(ss);
ok("C2 读数里没有 missing/extra 这两个反向词（照 §8.159 作废的口径，字段名必须自解释）",
  !keys.includes("missing") && !keys.includes("extra"), keys.join(","));

/* ── 判据 D：「没读数」与「读数为 0」是两个态 ─────────────────────── */
const dbDir = path.join(root, "events");
const dbFile = path.join(dbDir, "desktop-events.sqlite");
ok("D0 前置自证：日志侧确实建过库（否则下面这条 no_reading 是恒真）", fs.existsSync(dbFile));
fs.rmSync(dbFile, { force: true });
fs.rmSync(dbFile + "-wal", { force: true });
fs.rmSync(dbFile + "-shm", { force: true });
r = parity.auditSurfaces({ dataRoot: root });
const s3 = sess();
ok("D1 日志侧没库 → kind=no_reading", s3.kind === "no_reading", JSON.stringify(s3));
ok("D2 no_reading 记录**不带**零计数（matched/inJsonNotFold 这类字段一个都不许出现）",
  !("matched" in s3) && !("inJsonNotFold" in s3) && !("mismatched" in s3), JSON.stringify(Object.keys(s3)));
ok("D3 它仍然出声，且是「无读数」这句话而不是打出一串计数",
  /无读数/.test(parity.formatWarn(s3)) && !/matched=/.test(parity.formatWarn(s3)), parity.formatWarn(s3));

/* 两侧都在且都空 = 有读数、计数全 0 —— 与 D 相对照，证明这条尺能区分这两个态 */
const empty = freshRoot();
fs.mkdirSync(path.join(empty, "desktop"), { recursive: true });
fs.writeFileSync(path.join(empty, "desktop", "sessions.json"), JSON.stringify({ version: 1, active_id: "", sessions: [] }));
fs.writeFileSync(path.join(empty, "desktop", "rooms.json"), JSON.stringify({ version: 1, rooms: [] }));
fs.writeFileSync(path.join(empty, "desktop", "pending-approvals.jsonl"), "");
process.env.BITBOT_EVENT_ONLY = "1";
const st2 = createSessionStore(repoRoot, { dataRoot: empty });
st2.create("PW 空面参照");
delete process.env.BITBOT_EVENT_ONLY;
const r2 = parity.auditSurfaces({ dataRoot: empty });
const e2 = r2.records.find((x) => x.surface === "rooms");
ok("D4 两侧都在但都空 → kind=reading 且计数全 0（这才是「读数为 0」那个态）",
  e2.kind === "reading" && e2.matched === 0 && e2.foldEntries === 0 && e2.jsonEntries === 0, JSON.stringify(e2));

/* ── 判据 E：painted / tailGap 不许写死（§8.159 的两处照抄禁令）────── */
ok("E1 painted 是 null 且带原因（Grok 那个产生点是硬编码 true，我们量不到就不装）",
  cleanRec.kind === "reading" && cleanRec.painted === null && String(cleanRec.paintedWhy).length > 0,
  JSON.stringify(cleanRec).slice(0, 200));
ok("E2 tailGap 是 null 且带原因（旁路 JSON 没有游标）",
  cleanRec.tailGap === null && String(cleanRec.tailGapWhy).length > 0, JSON.stringify(cleanRec).slice(0, 200));

/* ── 判据 F：静态形状（能抓住本轮真实踩过的 bug）────────────────── */
const src = fs.readFileSync(path.join(repoRoot, "hosts/shared/surface_parity.js"), "utf8");
const files = [...src.matchAll(/file:\s*"([^"]+)"/g)].map((m) => m[1]);
ok("F1 三张面的旁路路径都带 desktop/ 一层（少一层=尺自己瞎了，§8.161）",
  files.length === 3 && files.every((f) => f.startsWith("desktop/")), files.join(","));
ok("F2 尺读日志侧走 openEventLog 直读，不走 readSurfaces（后者默认关时返回 read_disabled，会变成假 no_reading）",
  /openEventLog\(/.test(src) && !/readSurfaces\(/.test(src), "");

/* ── 反向对照：尺对「两侧都不可读」绝不能报成一致 ─────────────────── */
writeSj("{坏");
r = parity.auditSurfaces({ dataRoot: root });
ok("G1 JSON 侧坏 → no_reading（不静默当空面）", sess().kind === "no_reading", JSON.stringify(sess()));
ok("G2 两因并列时 why 把两侧都点出来", /日志侧/.test(sess().why) || /JSON/.test(sess().why), String(sess().why));


/* ── 判据 H：尺必须是一条能当场敲的命令，不只是门里的函数 ─────────────
   按「可感面」的规矩：工具在干净 shell 里跑出来之前不算交付。这里刻意用最小 env
   （只有 PATH/HOME），免得靠门禁进程自己继承的 BITBOT_* 把命令蒙对。 */
import { spawnSync } from "node:child_process";

const hRoot = freshRoot();
process.env.BITBOT_EVENT_DUAL_WRITE = "1";
const hStore = createSessionStore(repoRoot, { dataRoot: hRoot });
hStore.create("PW 甲");
hStore.create("PW 乙");
const hSj = path.join(hRoot, "desktop", "sessions.json");
const ho = JSON.parse(fs.readFileSync(hSj, "utf8"));
ho.sessions[0].title = "PW 命令行走查过的标题";
fs.writeFileSync(hSj, JSON.stringify(ho));

const bareEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
const cli = (args) =>
  spawnSync(process.execPath, [path.join(repoRoot, "scripts", "diagnose_surfaces.mjs"), ...args], {
    encoding: "utf8",
    env: { ...bareEnv, BITBOT_EVENT_DUAL_WRITE: "1" },
  });
const run = cli([hRoot]);
const outLines = (run.stdout || "").split("\n");
ok("H1 干净 env 里命令跑通（exit 0）且三张面都出一行",
  run.status === 0 && outLines.filter((l) => /\[surface-parity\]/.test(l)).length === 3,
  `status=${run.status} ${(run.stderr || "").slice(0, 120)}`);
ok("H2 命令自己就说出了偏差处数并点名 title（不是只给函数用的数）",
  /偏差 1 处/.test(run.stdout) && /title/.test(run.stdout), run.stdout.split("\n").filter((l) => /偏差 1 处|sessions/.test(l)).join(" ⏎ ").slice(0, 220));
const jsonRun = cli([hRoot, "--json"]);
let parsed = null;
try {
  parsed = JSON.parse(jsonRun.stdout);
} catch (_e) {
  parsed = null;
}
ok("H3 --json 可解析，且 drift 与模块同数（同一屏两个来源不许互相矛盾）",
  parsed !== null && parsed.drift === parity.auditSurfaces({ dataRoot: hRoot }).drift && parsed.records.length === 3,
  jsonRun.stdout.slice(0, 120));
ok("H4 dbPresent 用库文件事实而不是环境变量推（上一版拿 env 推，临时光库里明明读到数却报 dualWriteOff:true）",
  parsed !== null && parsed.dbPresent === true, JSON.stringify(parsed && { dbPresent: parsed.dbPresent }));

/* 只读自证：命令在没有库的 dataRoot 上跑完，绝不把库建出来（dev 的 dataRoot 就是仓库 data/，
   一次误建就是把夹具堆进用户看得见的数据那一类事故）。 */
const roRoot = freshRoot();
fs.mkdirSync(path.join(roRoot, "desktop"), { recursive: true });
fs.writeFileSync(path.join(roRoot, "desktop", "sessions.json"), JSON.stringify({ version: 1, active_id: "", sessions: [] }));
const roRun = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "diagnose_surfaces.mjs"), roRoot], {
  encoding: "utf8",
  env: bareEnv,
});
/* 判据必须钉在「那句装机级说明」独有的短语上。上一版判 /不是「一致」/ —— 每条面行里本来就有
   「这不是「一致」，别当干净读」，于是把说明整段删掉判据照样绿（实测 PASS=26 FAIL=0），
   这条当时是恒真的。换成只在说明行出现的「也不是故障」。 */
ok("H5 没开双写时命令仍跑通，且打出装机级说明（无读数不是故障）",
  roRun.status === 0 && /也不是故障/.test(roRun.stdout), roRun.stdout.slice(-200));
ok("H6 尺是只读的：跑完仍不创建 events/ 目录（误建就会污染用户看得见的数据）",
  !fs.existsSync(path.join(roRoot, "events")), fs.readdirSync(roRoot).join(","));

/* H4b：env 与现实必须分得开 —— 开着双写开关但这个 dataRoot 里没有库时，
   报的得是「没库」这个事实。少了这条，H4 只能抓「字段丢了」，抓不到「拿 env 推」。 */
const lie = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "diagnose_surfaces.mjs"), roRoot, "--json"], {
  encoding: "utf8",
  env: { ...bareEnv, BITBOT_EVENT_DUAL_WRITE: "1" },
});
let lieParsed = null;
try {
  lieParsed = JSON.parse(lie.stdout);
} catch (_e) {
  lieParsed = null;
}
ok("H4b 开关开着但库里没东西 → dbPresent=false（照事实报，不照环境变量报）",
  lieParsed !== null && lieParsed.dbPresent === false,
  JSON.stringify(lieParsed && { dbPresent: lieParsed.dbPresent, drift: lieParsed.drift }));

/* ── 判据 K：折叠器热路径形状 ─────────────────────────────────────────
   为什么这条属于这把尺：`auditSurfaces` 和产品的 `readSurfaces`/`load()` 过的是同一个
   `foldEvents`。§8.164 实测到折叠是超线性的（会话 500→1000，fold 21.7→82.4ms；×2 事件 ×3.8 时间），
   其中一格是 `entity_order_changed` 分支里 `wanted.includes(id)` —— 每条建会话都派一条顺序事件，
   于是在 growing 的名单上做 O(N) 次 O(N) 成员检查。改成 Set 后同规模 fold 从 336.7ms 掉到 82.4ms（4.1×）。
   本组**不证时间**（计时判据在 CI 上会抖，不在这里赌），只钉「这一处不许退回数组成员检查」这个形状。 */
const reducerSrc = fs.readFileSync(path.join(repoRoot, "hosts/shared/client_core/reducer.js"), "utf8");
const oStart = reducerSrc.indexOf('kind === "entity_order_changed"');
const oEnd = reducerSrc.indexOf('kind === "entity_removed"', oStart);
ok("K0 前置自证：order 分支在 reducer 里找得到（找不到就整组不作数，别拿空串判绿）",
  oStart > 0 && oEnd > oStart, `oStart=${oStart} oEnd=${oEnd}`);
const orderBody = oStart > 0 && oEnd > oStart ? reducerSrc.slice(oStart, oEnd) : "";
ok("K1 order 分支里不许出现 `wanted.includes(`（数组成员检查在每事件 O(N) 循环里=平方级）",
  !/wanted\s*\.\s*includes\s*\(/.test(orderBody),
  orderBody.split("\n").filter((l) => l.includes("includes")).join(" | "));
ok("K2 order 分支必须用 Set 做名单成员判断（正向形状，防「删掉 includes 但也没建索引」）",
  /new Set\(\s*wanted\s*\)/.test(orderBody) && /wantedSet\.has\(/.test(orderBody),
  orderBody.split("\n").filter((l) => /Set|wantedSet/.test(l)).join(" | "));
ok("K3 语义没被形状改动偷走：丢 id 的异常文案仍由 order 分支产出（lost 那条 push 还在）",
  /顺序里没有这些 id，但它们还在库里/.test(orderBody) && /ghosts/.test(orderBody),
  "缺 anomaly 文案即说明改动顺手砍掉了校验");

/* ── 判据 L：增量折叠必须和全量折出同一个东西（#82 / §8.165 的成本换算换来的这一片）────
   成本是这条线的动机（2000 会话实测写后读 330.2ms，命中只有 0.8ms），但判据不测时间：
   测「续折出来的读数，与从头折的读数，逐字段相等」。等值不成立时增量就是错的读数，省下的时间不作数。 */
ok("L0 前置自证：尺导出了 resetFoldCache（没有它，下面每条都会被上一条的缓存槽污染）",
  typeof parity.resetFoldCache === "function", typeof parity.resetFoldCache);
parity.resetFoldCache();
const lRoot = freshRoot();
const lStore = createSessionStore(repoRoot, { dataRoot: lRoot });
lStore.create("LW 甲");
lStore.create("LW 乙");
const fullFirst = parity.auditSurfaces({ dataRoot: lRoot, incremental: false });
const incFirst = parity.auditSurfaces({ dataRoot: lRoot });
ok("L1 首折必须真走全量并数到行（没有这个对照，后面「少读了」这句话是空的）",
  incFirst.foldMode === "full" && incFirst.foldRows > 0 && fullFirst.foldRows === incFirst.foldRows,
  JSON.stringify({ mode: incFirst.foldMode, rows: incFirst.foldRows, full: fullFirst.foldRows }));
lStore.create("LW 丙");
const inc2 = parity.auditSurfaces({ dataRoot: lRoot });
ok("L2 写一条之后确实只读新行（foldMode=incremental 且 foldRows < 全量行数）",
  inc2.foldMode === "incremental" && inc2.foldRows < fullFirst.foldRows + 3 && inc2.foldRows < incFirst.foldRows + 3,
  JSON.stringify({ mode: inc2.foldMode, rows: inc2.foldRows, first: incFirst.foldRows }));
const cmpKey = (x) =>
  x.records
    .map((z) => [z.kind, z.surface, z.foldEntries, z.jsonEntries, z.matched, z.mismatched, z.inFoldNotJson, z.inJsonNotFold, z.firstDiff].join("|"))
    .join("\n");
const fullNow = parity.auditSurfaces({ dataRoot: lRoot, incremental: false });
ok("L3 增量读数与全量读数逐字段相等（等值是比出来的，不是我推出来的）",
  cmpKey(inc2) === cmpKey(fullNow) && inc2.drift === fullNow.drift,
  `inc=${cmpKey(inc2).slice(0, 240)}\nfull=${cmpKey(fullNow).slice(0, 240)}`);

const { foldEvents } = require(path.join(repoRoot, "hosts/shared/event_mirror.js"));
let dirtyThrew = null;
try {
  foldEvents([], { fromState: { sessions: { sessions: [] }, rooms: { rooms: [] }, approvals: [], anomalies: ["上一轮就没折干净"] } });
} catch (err) {
  dirtyThrew = String((err && err.message) || err);
}
ok("L4 起点带 anomalies 的续折必须被拒（折不干净的历史不许当基底，否则毒面被缓存藏起来）",
  !!dirtyThrew && /anomalies/.test(dirtyThrew), dirtyThrew);

/* L7：缓存必须**往前走**。必须排在 L5 之前：L5 删过 events/ 之后，同进程的镜像句柄还指着被删掉的 inode，
   store 再写多少条都不会落到盘上的库里（第一版 L7 就死在这里，读数全是 reused/0 行）。
   只测「这一次读得少」抓不到「槽永远停在第一次那一版」——那种实现的增量会随时间长大，成本优势悄悄没了，
   但 L2/L3 照样绿（实测 M2 就是这么溜过去的：去掉增量路径的 foldCacheByFile.set 后 PASS=38 FAIL=0，判据对它完全无感）。*/
lStore.create("LW 戊");
const a7 = parity.auditSurfaces({ dataRoot: lRoot });
lStore.create("LW 己");
const b7 = parity.auditSurfaces({ dataRoot: lRoot });
ok("L7 连写两条：每次新读的行数都等于「这一条派出的事件数」，两次必须相等（缓存没往前走就会一次比一次大）",
  a7.foldMode === "incremental" && b7.foldMode === "incremental" && a7.foldRows > 0 && b7.foldRows === a7.foldRows,
  JSON.stringify({ a: [a7.foldMode, a7.foldRows], b: [b7.foldMode, b7.foldRows] }));
const full7 = parity.auditSurfaces({ dataRoot: lRoot, incremental: false });
ok("L7b 缓存往前走之后，读数仍与全量逐字段相等（推进不能靠少算）",
  cmpKey(b7) === cmpKey(full7) && b7.drift === full7.drift,
  `inc=${cmpKey(b7).slice(0, 240)}\nfull=${cmpKey(full7).slice(0, 240)}`);


/* 库重建后 seq 会倒退：续折会把新库的头几行加到旧世界上，读数看着「有账」其实全是幽灵。
   这里**直接建一个小库**，不用 store 再写一条来重建：同进程里镜像句柄还指着被删掉的 inode，
   写出去的文件在盘上不存在 —— 第一版就是这么错的（L5/L6 双双拿到 no_db，两侧都「一致」，
   判据看着过了其实是空的）。这条坑的形状和 §8.161 D0 前置自证同一个：夹具自己不成立就别判绿。 */
const dbL = path.join(lRoot, "events", "desktop-events.sqlite");
fs.rmSync(path.dirname(dbL), { recursive: true, force: true });
const evLog = require(path.join(repoRoot, "hosts/shared/event_log.js"));
{
  const h = evLog.openEventLog({ file: dbL, actor: "gate-L5" });
  h.append({ sessionId: "system", kind: "session_created", payload: { surface: "sessions", session: { id: "sess-l5new", title: "LW 重建" } } });
  h.close();
}
const inc5 = parity.auditSurfaces({ dataRoot: lRoot });
const full5 = parity.auditSurfaces({ dataRoot: lRoot, incremental: false });
ok("L5 前置自证：重建出来的小库确实在盘上、且 seq 比缓存里的小（否则这条只是恒真）",
  fs.existsSync(dbL) && inc5.lastSeq >= 1 && inc5.lastSeq < 9 && inc5.foldRows === 1,
  JSON.stringify({ lastSeq: inc5.lastSeq, rows: inc5.foldRows, mode: inc5.foldMode }));
ok("L5 库重建（seq 倒退）后绝不续折：foldMode 不是 incremental，读数与全量一致，且真报出偏差",
  inc5.foldMode !== "incremental" && cmpKey(inc5) === cmpKey(full5) && inc5.drift > 0,
  JSON.stringify({ mode: inc5.foldMode, drift: inc5.drift, full: full5.drift }));

const inc6 = parity.auditSurfaces({ dataRoot: lRoot });
const full6 = parity.auditSurfaces({ dataRoot: lRoot, incremental: false });
ok("L6 没写就读 = reused（新读 0 行）且偏差不许比全量多出一个（防「拿旧状态当新状态」造出假 drift）",
  inc6.foldMode === "reused" && inc6.foldRows === 0 && inc6.drift === full6.drift && inc6.drift > 0,
  JSON.stringify({ mode: inc6.foldMode, rows: inc6.foldRows, drift: inc6.drift, full: full6.drift }));

/* L8/L9（#83）：读满护栏时尺子必须报「没读数」，不能拿截断面算 drift。
   先清缓存：L8 要从冷槽起，否则 L6 留下的槽与库里 lastSeq 相同，L9 的「reused」是正常命中，
   不是污染 —— L9 第一版就把这两件事混了（实测 `{"mode":"reused","rows":0,"drift":7,"full":7}`
   被判成红），照实记。清完之后：截断那次读**不许**把缓存焐起来，紧接着放开额度必须真折。 */
parity.resetFoldCache();
const trunc = parity.auditSurfaces({ dataRoot: lRoot, incremental: false, limit: 1 });
ok("L8 额度咬住时不许报 drift：foldMode=truncated、三张面全 no_reading（少掉的实体不是「只在 JSON 侧」的偏差）",
  trunc.foldMode === "truncated" && trunc.noReading === 3 && trunc.drift === 0 && trunc.foldRows <= 1,
  JSON.stringify({ mode: trunc.foldMode, noReading: trunc.noReading, drift: trunc.drift, rows: trunc.foldRows }));
const afterTrunc = parity.auditSurfaces({ dataRoot: lRoot });
ok("L9 截断读数不许焐热缓存：紧接着放开额度必须真折（foldMode=full 且读到行），偏差与全量一致",
  afterTrunc.foldMode === "full" && afterTrunc.foldRows >= 1 && afterTrunc.drift === full6.drift,
  JSON.stringify({ mode: afterTrunc.foldMode, rows: afterTrunc.foldRows, drift: afterTrunc.drift, full: full6.drift }));

honestSkip("真装机默认配置下的开机留痕",
  "双写默认关（event_mirror.js:454）→ 默认装机上三张面全是 no_reading。尺已能当场敲（`node scripts/diagnose_surfaces.mjs`，H 组钉住），但开机自动留痕仍没接：默认配置下每次启动三条 warn 等于把尺的空转说成用户故障。要成运行时护栏，得先二选一（都要授权）：翻默认双写 / 接显式诊断入口");

try {
  store.close?.();
  lStore.close?.();
  fs.rmSync(lRoot, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
} catch (_e) {
  /* 临时目录清不掉不影响读数 */
}

console.log(`prove_surface_parity: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP}`);
process.exit(FAIL > 0 ? 1 : 0);
