/* prove_event_read_model.mjs — T1-04 读切换门禁（RM-01..RM-08）
 *
 * 需求原文（docs/next-target-requirements.md T1-04）：
 *   产品读路径改读事件日志（sessions/rooms/approvals），读模型不可用时诚实降级回 JSON。
 *   完成定义：BITBOT_EVENT_READ=1 时产品读到的状态与 JSON 快照逐字段相等；
 *   降级路径不静默、不崩、不造假空态。
 *
 * 这把尺子怎么才算「证明」了那句话：
 *
 *   RM-01 开关默认关：不设 BITBOT_EVENT_READ 时 readSurfaces 直接 read_disabled，
 *          event_log 不被加载，产品行为与改造前逐字段一致（这是「换读不换写」的边界）。
 *   RM-02 开着、没库：双写从没开过 → 没有库文件 → no_db，**不顺手建库**
 *          （读路径建库会把消费方变成写者），产品回退 JSON 读且结果与关掉时一致。
 *   RM-03 开着、有库：双写跑一轮真实写入后，READ=1 时产品 API（list/get/loadRooms/
 *          pendingApprovals）读到的状态与磁盘 JSON 逐字段相等——读切换不是「换个地方读个大概」。
 *   RM-04 读写闭环：READ=1 的世界里继续写（load→改→save 全链路现在以 fold 结果为起点），
 *          每写一步，事件读出来的状态仍与 JSON 相等。这是 T1-04 真正的棘轮：
 *          读起点换成 fold 之后，任何一次漂移都会被下一步的对比当场点名。
 *   RM-05 缓存语义：同一 lastSeq 二次读命中缓存（cached:true）且内容一致；
 *          写入后 lastSeq 变化 → 缓存失效、读到新状态；返回的是深拷贝，
 *          调用方（read-modify-write）原地改它绝不能污染下一次读。
 *   RM-06 日志坏了要说话：库文件塞垃圾 / fold 出 anomaly 时，产品回退 JSON 读，
 *          stderr 有一行说人话的降级说明，返回状态与 JSON 一致——
 *          绝不把半折叠状态或空态当真。
 *   RM-07 没库不建库：READ=1 + 无库时 readSurfaces 之后 dataRoot 里仍然没有
 *          任何 sqlite 文件（对照 RM-02，防「先读后写」路径顺带建库）。
 *   RM-08 老运行时起得来：没有 node:sqlite 时（同 DW-10 的伪装手法），
 *          READ=1 的 require 链照样不炸——读模型模块顶层不碰 event_log，
 *          懒加载防御和 T1-03 是同一条命。
 *
 * 全部跑在临时 dataRoot 上，绝不碰仓库里的 data/。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
const ok = (id, msg) => {
  console.log(`ok ${id} — ${msg}`);
  pass += 1;
};
const bad = (id, msg) => {
  console.log(`FAIL ${id} — ${msg}`);
  fail += 1;
};

console.log(`== 运行时 == node ${process.version} @ ${process.execPath}`);

const eventMirror = require("../hosts/shared/event_mirror.js");
const eventReadModel = require("../hosts/shared/event_read_model.js");
const { createSessionStore } = require("../hosts/desktop/sessions.js");
const { createProductSurface } = require("../hosts/desktop/product_surface.js");

const SESSIONS_FILE = "desktop/sessions.json";
const ROOMS_FILE = "desktop/rooms.json";
const PENDING_FILE = "desktop/pending-approvals.jsonl";

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function diskSessions(dataRoot) {
  const text = readText(path.join(dataRoot, SESSIONS_FILE));
  return text ? JSON.parse(text) : null;
}
function diskRooms(dataRoot) {
  const text = readText(path.join(dataRoot, ROOMS_FILE));
  return text ? JSON.parse(text) : null;
}
function diskApprovals(dataRoot) {
  const text = readText(path.join(dataRoot, PENDING_FILE)) || "";
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
}

function dbFileFor(dataRoot) {
  return path.join(dataRoot, "events", "desktop-events.sqlite");
}

/* 把产品读到的状态和磁盘 JSON 归一后逐字段比。产品 API 是派生视图
   （list() 有 preview/message_count），所以两边都用同一把尺子算派生字段。 */
function deriveSessionRows(store) {
  return (store.sessions || []).map((s) => {
    const msgs = Array.isArray(s.messages) ? s.messages : [];
    let preview = "";
    for (let i = msgs.length - 1; i >= 0; i--) {
      const t = String((msgs[i] && msgs[i].text) || "").replace(/\s+/g, " ").trim();
      if (t) { preview = t.slice(0, 40); break; }
    }
    return { id: s.id, title: s.title || "对话", updated_at: s.updated_at, message_count: msgs.length, preview };
  });
}

function compareSessionReads(dataRoot, ss, label) {
  const out = [];
  const disk = diskSessions(dataRoot);
  const listed = ss.list();
  eventMirror.deepDiff(deriveSessionRows(disk || { sessions: [] }), listed.sessions, `${label}.list`, out);
  if ((disk && disk.active_id) !== listed.active_id) out.push(`${label}.active_id: 磁盘=${disk && disk.active_id} 产品=${listed.active_id}`);
  // get() 回全量会话（含 messages），和磁盘上同一条比
  const want = listed.active_id;
  const got = ss.get(want);
  const diskHit = (disk?.sessions || []).find((s) => s.id === want) || null;
  eventMirror.deepDiff(diskHit, got.session, `${label}.get(${want})`, out);
  return out;
}

function compareRoomReads(dataRoot, ps, label) {
  const out = [];
  const disk = diskRooms(dataRoot) || { version: 1, rooms: [] };
  const read = ps.loadRooms();
  eventMirror.deepDiff(disk, read, `${label}.loadRooms`, out);
  return out;
}

function compareApprovalReads(dataRoot, ps, label) {
  const out = [];
  const now = Date.now();
  const disk = diskApprovals(dataRoot).map((e) => {
    const c = JSON.parse(JSON.stringify(e));
    if (c.status === "pending" && new Date(c.expires_at).getTime() < now) c.status = "expired";
    return c;
  });
  const read = ps.pendingApprovals();
  eventMirror.deepDiff(disk, read, `${label}.pendingApprovals`, out);
  return out;
}

function captureStderr(fn) {
  const lines = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  try {
    return { result: fn(), stderr: lines };
  } finally {
    process.stderr.write = orig;
  }
}

function makeSessions(dataRoot) {
  return createSessionStore(ROOT, { dataRoot });
}
function makeSurface(dataRoot) {
  return createProductSurface(ROOT, { dataRoot });
}

function cleanupFlags() {
  delete process.env.BITBOT_EVENT_READ;
  delete process.env.BITBOT_EVENT_DUAL_WRITE;
}

/* ===== RM-01：开关默认关，行为与改造前一致，event_log 不被加载 ===== */
{
  cleanupFlags();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-off-"));
  const ss = makeSessions(root);
  const id = ss.create("默认关").session.id;
  ss.appendMessages(id, [{ role: "user", text: "hello" }]);
  const evCached = Object.keys(require.cache).some((p) => p.endsWith("event_log.js"));
  const hit = eventReadModel.readSurfaces(root);
  if (hit.reason !== "read_disabled") bad("RM-01", `开关没开，readSurfaces 却不是 read_disabled：${JSON.stringify(hit)}`);
  else if (evCached) bad("RM-01", "开关没开却把 event_log 加载了（老运行时里它加载即抛）");
  else {
    const disk = diskSessions(root);
    const good = disk && (disk.sessions || []).some((s) => s.id === id) && (disk.sessions.find((s) => s.id === id).messages || []).length === 1;
    if (!good) bad("RM-01", "开关没开时写入结果变了（JSON 里找不到刚写的会话/消息）");
    else ok("RM-01", `开关默认关：read_disabled + event_log 未加载 + JSON 写入照常（1 会话 1 消息）`);
  }
  eventReadModel.closeAll();
  eventMirror.closeAllMirrors();
  fs.rmSync(root, { recursive: true, force: true });
}

/* ===== RM-02 + RM-07：开着、没库 —— 诚实降级、不顺手建库 ===== */
{
  cleanupFlags();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-nodb-"));
  const ss = makeSessions(root);
  // 先在关着的世界里播种 store（写侧行为不变），再开 READ——
  // 这样 load() 才会真正走到事件读分支，而不是在播种分支就返回。
  ss.list();
  eventMirror.closeAllMirrors();
  process.env.BITBOT_EVENT_READ = "1";
  const { result: listed, stderr } = captureStderr(() => ss.list());
  const hit = eventReadModel.readSurfaces(root);
  const stray = fs.existsSync(path.join(root, "events")) ? fs.readdirSync(path.join(root, "events")) : [];
  if (hit.ok || hit.reason !== "no_db") bad("RM-02", `没库时 readSurfaces 应 no_db：${JSON.stringify(hit)}`);
  else if (fs.existsSync(dbFileFor(root))) bad("RM-02", "读模型把库文件建出来了（读路径绝不写）");
  else if (stray.some((f) => /\.sqlite/i.test(f))) bad("RM-02", `events/ 里冒出库文件：${stray.join(",")}`);
  else if (!Array.isArray(listed.sessions) || listed.sessions.length !== 1) bad("RM-02", `no_db 降级后产品读不对：${JSON.stringify(listed.sessions?.length)} 条`);
  else if (!stderr.length || !stderr.join("").includes("事件读模型不可用")) bad("RM-02", `降级没说话（stderr 应有一行说明）：${JSON.stringify(stderr)}`);
  else ok("RM-02", `READ=1 + 没库：no_db → 回退 JSON 读（种子会话还在），stderr 说了一行人话，库文件没被建出来`);
  eventReadModel.closeAll();
  eventMirror.closeAllMirrors();
  fs.rmSync(root, { recursive: true, force: true });
  cleanupFlags();
}

/* ===== RM-03 + RM-04 + RM-05：双写写一轮 → READ=1 读出来逐字段相等 → 继续写不漂移 ===== */
const onRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-on-"));
{
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  const ss = makeSessions(onRoot);
  const ps = makeSurface(onRoot);

  // 先写一轮（READ 关着，纯双写世界）
  ss.list();
  const a = ss.create("读切换甲").session.id;
  ss.appendMessages(a, [{ role: "user", text: "切换前的消息" }, { role: "assistant", text: "切换前的回复" }]);
  const b = ss.create("读切换乙").session.id;
  ss.setActive(a);
  ss.rename(a, "读切换甲·改名");
  const bot1 = ps.createBot({ name: "读切换 Bot 甲" }).bot?.id;
  const bot2 = ps.createBot({ name: "读切换 Bot 乙" }).bot?.id;
  const bot3 = ps.createBot({ name: "读切换 Bot 丙" }).bot?.id;
  const room = ps.roomCreate(`${bot1},${bot2}`, "读切换测试群").room?.id;
  ps.appendRoomTranscript(room, { kind: "user", room_id: room, speaker: "u", text: "群里第一句", at: new Date().toISOString() });
  const ap = ps.appendPendingApproval({ source: "chat", kind: "shell_exec", command: "echo hi" }).id;
  ps.approvalDecide(ap, "allow_once");
  ps.appendPendingApproval({ source: "chat", kind: "mail_send", command: "send report", expires_at: new Date(Date.now() - 1000).toISOString() });
  ss.appendMessages(b, [{ role: "user", text: "给乙也留一句话" }]);
  eventMirror.closeAllMirrors();
  global.__rmBot3 = bot3;

  /* RM-03：READ=1 打开，产品 API 读到的事件状态 == 磁盘 JSON */
  process.env.BITBOT_EVENT_READ = "1";
  eventMirror.closeAllMirrors();
  const ssR = makeSessions(onRoot);
  const psR = makeSurface(onRoot);
  const sOut = compareSessionReads(onRoot, ssR, "RM-03.sessions");
  const rOut = compareRoomReads(onRoot, psR, "RM-03.rooms");
  const aOut = compareApprovalReads(onRoot, psR, "RM-03.approvals");
  const allOut = [...sOut, ...rOut, ...aOut];
  if (allOut.length) bad("RM-03", `READ=1 的产品读与磁盘 JSON 不等：${allOut.slice(0, 5).join(" / ")}`);
  else ok("RM-03", `READ=1：list/get/loadRooms/pendingApprovals 读到的状态与磁盘 JSON 逐字段相等（含过期审批的读时语义）`);
  global.__rmRoom = room;
  global.__rmSessA = a;
  global.__rmSessB = b;

  /* RM-04：READ=1 的世界里继续写——每一步之后事件读 == JSON，棘轮不许漂移 */
  const steps = [
    ["create", () => ssR.create("切换后新建").session.id],
    ["appendMessages", () => ssR.appendMessages(global.__rmSessA, [{ role: "user", text: "切换后写的消息" }])],
    ["setActive", () => ssR.setActive(global.__rmSessB)],
    ["react", () => ssR.react(global.__rmSessB, ssR.get(global.__rmSessB).session.messages[0]?.id || "", "👍", true)],
    ["remove", () => ssR.remove(global.__rmSessB)],
    ["roomTranscript", () => psR.appendRoomTranscript(global.__rmRoom, { kind: "user", room_id: global.__rmRoom, speaker: "u", text: "切换后群里的话", at: new Date().toISOString() })],
    ["roomMembers", () => psR.roomMembersUpdate({ room: global.__rmRoom, bot_id: global.__rmBot3, action: "add" })],
    ["approvalDecide", () => psR.approvalDecide(psR.pendingApprovals().find((x) => x.status !== "decided")?.id, "deny")],
  ];
  let firstBad = null;
  const trail = [];
  for (const [name, fn] of steps) {
    let raised = null;
    let result;
    try { result = fn(); } catch (err) { raised = String((err && err.message) || err); }
    const out = [
      ...compareSessionReads(onRoot, ssR, `RM-04.${name}`),
      ...compareRoomReads(onRoot, psR, `RM-04.${name}`),
      ...compareApprovalReads(onRoot, psR, `RM-04.${name}`),
    ];
    trail.push({ name, raised, result, out });
    if ((raised || out.length) && !firstBad) firstBad = { name, raised, out };
  }
  if (firstBad) bad("RM-04", `READ=1 下继续写，第「${firstBad.name}」步后读模型漂了：${firstBad.raised || firstBad.out.slice(0, 4).join(" / ")}`);
  else {
    const deadSteps = trail.filter((t) => t.result && t.result.ok === false);
    if (deadSteps.length) bad("RM-04", `有步骤没真的写成（棘轮是空的）：${deadSteps.map((d) => d.name).join(",")}`);
    else ok("RM-04", `READ=1 下继续写 ${steps.length} 步，每步之后事件读都与 JSON 逐字段相等——读起点换成 fold 后没有漂移`);
  }

  /* RM-05：缓存语义。RM-04 的对比已经把缓存焐热了，先 closeAll 回到冷态再断言。 */
  const f = dbFileFor(onRoot);
  eventReadModel.closeAll();
  const r1 = eventReadModel.readSurfaces(onRoot, { file: f });
  const r2 = eventReadModel.readSurfaces(onRoot, { file: f });
  const mutated = r2.sessions;
  if (mutated.sessions) mutated.sessions.push({ id: "injected", title: "毒" });
  const r3 = eventReadModel.readSurfaces(onRoot, { file: f });
  const wrote = ssR.appendMessages(global.__rmSessA, [{ role: "user", text: "缓存失效探测" }]);
  const r4 = eventReadModel.readSurfaces(onRoot, { file: f });
  if (r1.cached) bad("RM-05", "第一次读就报 cached:true（缓存是冷的）");
  else if (!r2.cached) bad("RM-05", "同一 lastSeq 二次读没命中缓存");
  else if (r3.sessions.sessions.some((s) => s.id === "injected")) bad("RM-05", "调用方改了返回值，缓存被污染了（返回的不是深拷贝）");
  else if (!wrote.ok) bad("RM-05", "写入步骤没成功，缓存失效断言是恒真");
  else if (r4.cached || r4.lastSeq <= r3.lastSeq) bad("RM-05", `写入后 lastSeq 没动（${r3.lastSeq} → ${r4.lastSeq}），缓存不会失效`);
  else if (!JSON.stringify(r4.sessions).includes("缓存失效探测")) bad("RM-05", "写入后读模型没读到新消息");
  else ok("RM-05", `冷读→命中缓存→返回值可变但不污染→写入后 lastSeq ${r3.lastSeq}→${r4.lastSeq} 失效并读到新消息`);
}

/* ===== RM-06：日志坏了要说话（垃圾字节 + anomaly 两条路） ===== */
{
  // 6a：库文件塞垃圾 → open/read 失败 → 回退 JSON，stderr 有说明
  const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-bad-"));
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  const ssW = makeSessions(badRoot);
  ssW.list();
  ssW.create("坏库前").session.id;
  eventMirror.closeAllMirrors();
  eventReadModel.closeAll();
  process.env.BITBOT_EVENT_READ = "1";
  fs.writeFileSync(dbFileFor(badRoot), Buffer.from("this is not a sqlite database at all........", "utf8"));
  const ssBad = makeSessions(badRoot);
  const { result: listed6a, stderr: err6a } = captureStderr(() => ssBad.list());
  const diskOk6a = (diskSessions(badRoot).sessions || []).some((s) => s.title === "坏库前");
  const readOk6a = Array.isArray(listed6a.sessions) && listed6a.sessions.some((s) => s.title === "坏库前");
  const said6a = err6a.join("").includes("事件读模型不可用");
  if (!diskOk6a) bad("RM-06", "6a 前置失败：JSON 快照里没有那会话");
  else if (!readOk6a) bad("RM-06", `坏库时产品读没回退 JSON：${JSON.stringify(listed6a).slice(0, 120)}`);
  else if (!said6a) bad("RM-06", `坏库降级没说话：${JSON.stringify(err6a)}`);
  else ok("RM-06a", `库文件是垃圾字节：产品回退 JSON 读（会话还在），stderr 说了一行人话`);
  eventReadModel.closeAll();
  eventMirror.closeAllMirrors();
  fs.rmSync(badRoot, { recursive: true, force: true });

  // 6b：日志能开但 fold 有 anomaly（未知 kind）→ 拒读、回退、说话
  const anoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-ano-"));
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  const ssW2 = makeSessions(anoRoot);
  ssW2.list();
  ssW2.create("anomaly 前").session.id;
  eventMirror.closeAllMirrors();
  eventReadModel.closeAll();
  const { openEventLog } = require("../hosts/shared/event_log.js");
  const h = openEventLog({ file: dbFileFor(anoRoot), actor: "probe" });
  h.append({ sessionId: "sess-probe", kind: "totally_unknown_kind", payload: { x: 1 } });
  h.close();
  process.env.BITBOT_EVENT_READ = "1";
  const psAno = makeSurface(anoRoot);
  const { result: rooms6b, stderr: err6b } = captureStderr(() => psAno.loadRooms());
  const direct = eventReadModel.readSurfaces(anoRoot);
  if (direct.ok || direct.reason !== "fold_anomalies") bad("RM-06", `未知 kind 应该 fold_anomalies：${JSON.stringify({ ok: direct.ok, reason: direct.reason })}`);
  else if (!Array.isArray(rooms6b.rooms)) bad("RM-06", "anomaly 时 loadRooms 没回退成可用状态");
  else if (!err6b.join("").includes("事件读模型不可用")) bad("RM-06", `anomaly 降级没说话：${JSON.stringify(err6b)}`);
  else ok("RM-06b", `fold 出 anomaly：readSurfaces 拒读（fold_anomalies），loadRooms 回退 JSON 并说了一行人话`);
  eventReadModel.closeAll();
  fs.rmSync(anoRoot, { recursive: true, force: true });
  cleanupFlags();
}

/* ===== RM-08：老运行时（没有 node:sqlite）READ=1 也起得来 ===== */
{
  const PROBE = `
const Module = require("module");
const fs = require("fs");
const path = require("path");
const ROOT = process.env.RM8_REPO;
const dataRoot = process.env.RM8_DATA;
const orig = Module._load;
let sqliteTries = 0;
Module._load = function (request, ...rest) {
  if (request === "node:sqlite") {
    sqliteTries += 1;
    const err = new Error("Cannot find module 'node:sqlite'");
    err.code = "MODULE_NOT_FOUND";
    throw err;
  }
  return orig.call(this, request, ...rest);
};
process.env.BITBOT_EVENT_READ = "1";
let threw = null;
let snap = false;
let evCached = false;
try {
  const { createSessionStore } = require(path.join(ROOT, "hosts/desktop/sessions.js"));
  const { createProductSurface } = require(path.join(ROOT, "hosts/desktop/product_surface.js"));
  const ss = createSessionStore(ROOT, { dataRoot });
  ss.create("老运行时 READ").session.id;
  const ps = createProductSurface(ROOT, { dataRoot });
  ps.loadRooms();
  snap = fs.existsSync(path.join(dataRoot, "desktop", "sessions.json"));
  evCached = Object.keys(require.cache).some((p) => p.endsWith("event_log.js"));
} catch (err) {
  threw = String((err && err.message) || err);
  evCached = Object.keys(require.cache).some((p) => p.endsWith("event_log.js"));
}
console.log("__RM8__" + JSON.stringify({ threw, snap, evCached, tries: sqliteTries }));
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm8-"));
  const r = spawnSync(process.execPath, ["-e", PROBE], {
    env: { ...process.env, RM8_REPO: ROOT, RM8_DATA: dir },
    encoding: "utf8",
    timeout: 120000,
  });
  const line = String(r.stdout || "").split("\n").find((l) => l.startsWith("__RM8__"));
  const out = line ? JSON.parse(line.slice("__RM8__".length)) : null;
  if (!out) bad("RM-08", `探针子进程没出结果：${String(r.stderr || "").slice(0, 160)}`);
  else if (out.threw) bad("RM-08", `没有 node:sqlite + READ=1，require 链炸了：${out.threw}`);
  else if (out.evCached) bad("RM-08", "event_log 在老运行时里被加载了（懒加载防御失守）");
  else if (!out.snap) bad("RM-08", "老运行时里 JSON 快照没落盘");
  else ok("RM-08", `没有 node:sqlite + READ=1：sessions/product_surface 照常工作、JSON 照常落盘、event_log 未被加载（探测 ${out.tries} 次）`);
  fs.rmSync(dir, { recursive: true, force: true });
}

/* 收尾：主干开关恢复成默认关 */
cleanupFlags();
eventReadModel.closeAll();
eventMirror.closeAllMirrors();

console.log(`\nprove_event_read_model: PASS=${pass} FAIL=${fail}`);
try {
  fs.rmSync(onRoot, { recursive: true, force: true });
} catch {
  /* 临时目录清不掉不影响结论 */
}
process.exit(fail ? 1 : 0);
