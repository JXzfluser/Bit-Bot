/* prove_event_read_model.mjs — T1-04 读切换门禁（RM-01..RM-09）
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
 *   RM-09 关双写后「删 JSON 列表还在」（= parity 文档 KP-05 可感面）：EVENT_ONLY 下
 *          删掉 sessions.json，重启读到的是从 fold(events) 重建的会话；反向对照——
 *          同一个库、同样没有 JSON，但关掉事件读 → 读到空，证明「还在」只可能是事件折叠给的。
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

/* ===== RM-10：增量折叠必须和全量折出同一份面（#82 / §8.165 的「写后读 330ms」那一格）=====
 * 这条门只回答一个问题：读模型为了省时间改成「上次干净状态 ⊕ 新行」之后，
 * 交出去的面有没有和从头折的不一样。等值不成立时，省下的时间不作数。 */
{
  cleanupFlags();
  const incRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-inc-"));
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  eventReadModel.closeAll();
  const ssI = makeSessions(incRoot);
  const fi = dbFileFor(incRoot);
  for (let i = 0; i < 3; i += 1) ssI.create(`增量 ${i}`);
  process.env.BITBOT_EVENT_READ = "1";
  const cold = eventReadModel.readSurfaces(incRoot, { file: fi });
  const c4 = ssI.create("增量 3");
  const inc = eventReadModel.readSurfaces(incRoot, { file: fi });
  eventReadModel.closeAll();
  const full = eventReadModel.readSurfaces(incRoot, { file: fi });
  const keyOf = (r) => JSON.stringify({ s: r.sessions, r: r.rooms, a: r.approvals });
  if (!c4.ok) bad("RM-10", "第四步写入没成（夹具是空的，不判绿）");
  else if (!cold.ok || cold.foldPath !== "full") bad("RM-10", `冷读不该是增量：${JSON.stringify({ ok: cold.ok, path: cold.foldPath })}`);
  else if (inc.foldPath !== "incremental") bad("RM-10", `写一条之后没走增量（foldPath=${inc.foldPath}）`);
  else if (!(inc.count > 0 && inc.count < cold.count)) bad("RM-10", `增量那次读了 ${inc.count} 行，全量是 ${cold.count} 行 —— 没真的少读`);
  else if (keyOf(inc) !== keyOf(full)) bad("RM-10", "增量折出来的面与全量不等：省下的时间不作数");
  else ok("RM-10", `冷读 full(${cold.count} 行) → 写一条走 incremental(新读 ${inc.count} 行) → 与 closeAll 之后全量折逐字段相等`);

  /* 脏起点不许当基底：折干净是续折的前提，带 anomalies 的 fromState 必须被 foldEvents 拒掉，
     否则毒面会被缓存藏起来（臂6 那套「库有账但折不动」的证据就永远出不了缓存）。 */
  const fold = require(path.join(ROOT, "hosts/shared/event_mirror.js")).foldEvents;
  let dirtyErr = null;
  try {
    fold([], { fromState: { sessions: { sessions: [] }, rooms: { rooms: [] }, approvals: [], anomalies: ["脏"] } });
  } catch (err) {
    dirtyErr = String((err && err.message) || err);
  }
  if (!dirtyErr || !/anomalies/.test(dirtyErr)) bad("RM-10b", `带 anomalies 的起点没被拒：${dirtyErr}`);
  else ok("RM-10b", "折不干净的起点被 foldEvents 当场拒绝（毒面不许进缓存当前缀）");

  cleanupFlags();
  eventMirror.closeAllMirrors();
  eventReadModel.closeAll();
  try {
    fs.rmSync(incRoot, { recursive: true, force: true });
  } catch {
    /* 临时目录清不掉不影响结论 */
  }
}

/* ===== RM-11 / RM-12：读必须「看完」才敢宣布状态（#83）=====
 * 旧实现是一次 `readAfter({limit: 100000})`：读满上限也当整份日志。探针
 * （scripts/probe_read_model_row_cap.mjs）在 25 行的库上喂 limit=5 量到 `ok:true` +
 * 12 条会话只剩 3 条 + 已删的那条复活，而且这份截断面按**真实 lastSeq** 进了缓存，
 * 之后同进程放开额度仍 `cached:true` —— 一次截断、永久失真。EVENT_ONLY 下写口的
 * 提交时基底（片11）走的就是这个口，所以这不是「显示少几条」而是会拿去合并。 */
{
  cleanupFlags();
  const capRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-cap-"));
  const capFile = path.join(capRoot, "events", "desktop-events.sqlite");
  fs.mkdirSync(path.dirname(capFile), { recursive: true });
  const openLog = require(path.join(ROOT, "hosts/shared/event_log.js")).openEventLog;
  const DELETED = "sess-del0000001";
  const TOTAL = 12;
  const h = openLog({ file: capFile, actor: "rm-cap" });
  for (let i = 0; i < TOTAL; i += 1) {
    const id = i === 0 ? DELETED : `sess-${String(i).padStart(10, "0")}`;
    h.append({ sessionId: "system", kind: "session_created", payload: { surface: "sessions", session: { id, title: `会话 ${i}` } } });
  }
  h.append({ sessionId: "system", kind: "entity_removed", payload: { surface: "sessions", entity_id: DELETED } });
  const rowsInDb = TOTAL + 1;
  h.close();
  process.env.BITBOT_EVENT_READ = "1";
  const envOnly = { BITBOT_EVENT_READ: "1" };

  /* RM-11：小页必须一页页折到底，结果与整份折完等值（分页不许丢行、不许把删除丢掉）。 */
  eventReadModel.closeAll();
  const paged = eventReadModel.readSurfaces(capRoot, { file: capFile, env: envOnly, pageSize: 4 });
  eventReadModel.closeAll();
  const single = eventReadModel.readSurfaces(capRoot, { file: capFile, env: envOnly });
  const idsOf = (r) => (r.sessions.sessions || []).map((s) => s.id).sort();
  if (!paged.ok) bad("RM-11", `分页读被拒（reason=${paged.reason}）——夹具不成立`);
  else if (paged.count !== rowsInDb) bad("RM-11", `pageSize=4 只读了 ${paged.count} 行，库里 ${rowsInDb} 行 —— 没折到底`);
  else if (idsOf(paged).length !== TOTAL - 1 || idsOf(paged).includes(DELETED)) bad("RM-11", `分页折出来的面不对：${idsOf(paged).length} 条（应 ${TOTAL - 1}）/ 已删那条在=${idsOf(paged).includes(DELETED)}`);
  else if (JSON.stringify(idsOf(paged)) !== JSON.stringify(idsOf(single))) bad("RM-11", "分页与整份折完不等值");
  else ok("RM-11", `pageSize=4 逐页折完 ${rowsInDb} 行 → ${TOTAL} 条会话、最后一条 entity_removed 生效，与整份折逐 id 相等`);

  /* RM-12：额度咬住 = 没看完 = 必须拒，且**热槽**上也不许留下任何痕迹。
     热槽才是历史上真被毒死的那一格：旧实现把截断折出来的面连同**真实 lastSeq** 写进缓存，
     之后同进程放开额度仍是 cached:true（探针 P2）。冷槽那条断言验不到这件事——
     第一版 RM-12 就是冷槽，突变体「删掉 truncated 分支」当场溜过（PASS=14 FAIL=0），照实记。 */
  eventReadModel.closeAll();
  const warm = eventReadModel.readSurfaces(capRoot, { file: capFile, env: envOnly });
  const h2 = openLog({ file: capFile, actor: "rm-cap-warm" });
  for (let i = 0; i < 3; i += 1) {
    h2.append({ sessionId: "system", kind: "session_created", payload: { surface: "sessions", session: { id: `sess-late${i}`, title: `迟到 ${i}` } } });
  }
  h2.close();
  const starved = eventReadModel.readSurfaces(capRoot, { file: capFile, env: envOnly, pageSize: 4, maxRows: 2 });
  const reopen = eventReadModel.readSurfaces(capRoot, { file: capFile, env: envOnly });
  const lateOf = (r) => (r.sessions.sessions || []).filter((s) => String(s.id).startsWith("sess-late")).length;
  if (!warm.ok) bad("RM-12", `焐热缓存那次读就失败（reason=${warm.reason}）——夹具不成立`);
  else if (starved.ok) bad("RM-12", `额度 2 行、拒读期间又落了 3 行却返回 ok:true —— 「读不全」又被翻译成「状态就是这样」`);
  else if (starved.reason !== "log_too_long") bad("RM-12", `拒读的理由不是 log_too_long：${starved.reason}`);
  else if (starved.rowsRead > starved.maxRows) bad("RM-12", `拒读那次读了 ${starved.rowsRead} 行，比额度 ${starved.maxRows} 还多 —— 额度不是内存护栏`);
  else if (!reopen.ok || reopen.cached) bad("RM-12", `拒完之后放开额度仍不重读（ok=${reopen.ok} cached=${reopen.cached}）—— 缓存没作废`);
  else if (lateOf(reopen) !== 3) bad("RM-12", `重读回来的面里有 ${lateOf(reopen)}/3 条拒读期间落库的新会话 —— 热槽被截断状态毒死了`);
  else if (reopen.count !== rowsInDb + 3 || idsOf(reopen).includes(DELETED)) bad("RM-12", `重读回来的面不完整（${reopen.count} 行 / 已删那条在=${idsOf(reopen).includes(DELETED)}）`);
  else ok("RM-12", `热槽 + 额度咬住 → ok:false/log_too_long（读 ${starved.rowsRead}/${starved.maxRows} 行，不超额）；放开额度重读回 ${reopen.count} 行、含拒读期间的 3 条新会话、已删那条仍不在`);

  cleanupFlags();
  eventReadModel.closeAll();
  try {
    fs.rmSync(capRoot, { recursive: true, force: true });
  } catch {
    /* 临时目录清不掉不影响结论 */
  }
}

/* ===== RM-13..RM-17：折检查点是**派生态**，不是第二份真源（#82 后半 / §8.168）=====
 * 检查点存在的唯一理由：冷进程不再从 seq=1 重折全量（真两进程实测 1501 会话 / 4502 行：
 * 195.9ms → 3.4ms）。代价与风险是「盘上多了一份面」，所以判据按四条钉：
 * 等值、坏/外来/超前的一律不用、只读消费方不建库、脏面绝不落盘。 */
{
  cleanupFlags();
  const ckRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-ckpt-"));
  const ckDb = path.join(ckRoot, "events", "desktop-events.sqlite");
  fs.mkdirSync(path.dirname(ckDb), { recursive: true });
  const openLog2 = require(path.join(ROOT, "hosts/shared/event_log.js")).openEventLog;
  const envRead = { BITBOT_EVENT_READ: "1" };
  const hc = openLog2({ file: ckDb, actor: "rm-ckpt" });
  for (let i = 0; i < 6; i += 1) {
    hc.append({ sessionId: "system", kind: "session_created", payload: { surface: "sessions", session: { id: `sess-ck${i}`, title: `检查点 ${i}` } } });
  }
  const ckSeq = hc.lastSeq();
  hc.close();
  const cacheFile = eventReadModel.checkpointPathFor(ckDb);
  const keyOfFace = (r) => JSON.stringify(r.ok ? { s: r.sessions, r2: r.rooms, a: r.approvals } : { bad: r.reason });

  /* RM-13：落下检查点 → 新进程起手必须续折、等值、真少读，且第二次读仍是进程内 cached。 */
  eventReadModel.closeAll();
  fs.rmSync(cacheFile, { force: true });
  const first = eventReadModel.readSurfaces(ckRoot, { file: ckDb, env: envRead, checkpointStride: 1 });
  const wrote = fs.existsSync(cacheFile);
  eventReadModel.closeAll();
  const seeded = eventReadModel.readSurfaces(ckRoot, { file: ckDb, env: envRead, checkpointStride: 1 });
  const seeded2 = eventReadModel.readSurfaces(ckRoot, { file: ckDb, env: envRead, checkpointStride: 1 });
  fs.rmSync(cacheFile, { force: true });
  eventReadModel.closeAll();
  const fromScratch = eventReadModel.readSurfaces(ckRoot, { file: ckDb, env: envRead });
  if (first.foldPath !== "full" || !wrote) bad("RM-13", `首读没走全量或没落检查点（path=${first.foldPath} 落盘=${wrote}）——后面每条都是恒真`);
  else if (seeded.foldPath !== "checkpoint") bad("RM-13", `新进程起手没走检查点（foldPath=${seeded.foldPath}）`);
  else if (keyOfFace(seeded) !== keyOfFace(fromScratch)) bad("RM-13", "检查点续折出来的面与全量折不等值");
  else if (!(seeded.count < fromScratch.count)) bad("RM-13", `续折那次读了 ${seeded.count} 行、全量 ${fromScratch.count} 行 —— 没真的少读`);
  else if (!seeded2.cached) bad("RM-13", "同进程第二次读没走进程内缓存（seeded 标记没清 = 每次都说自己是检查点起手）");
  else ok("RM-13", `落检查点 → 新进程 foldPath=checkpoint 只读 ${seeded.count}/${fromScratch.count} 行、面与全量逐字段相等、第二次读 cached:true`);

  /* RM-14：检查点是垃圾 → 当它不存在。缓存坏了绝不能变成拒读。 */
  fs.writeFileSync(cacheFile, "{ 这不是 JSON");
  eventReadModel.closeAll();
  const corrupt = eventReadModel.readSurfaces(ckRoot, { file: ckDb, env: envRead });
  if (!corrupt.ok || corrupt.foldPath !== "full" || keyOfFace(corrupt) !== keyOfFace(fromScratch)) bad("RM-14", `垃圾检查点没被无视：ok=${corrupt.ok} path=${corrupt.foldPath}`);
  else ok("RM-14", "检查点是半截 JSON → 当它不存在，照样全量折出同一份面（派生态坏了不升级成读不到）");

  /* RM-15：外来的面 / 比库还新的游标，两种都不许用；且读完落回真实游标（不许永久毒死这条路）。 */
  fs.writeFileSync(cacheFile, JSON.stringify({
    dbFile: "/tmp/别的库.sqlite",
    lastSeq: 1,
    folded: { sessions: { version: 1, active_id: "", sessions: [] }, rooms: { version: 1, rooms: [] }, approvals: [], anomalies: [] },
  }));
  eventReadModel.closeAll();
  const foreign = eventReadModel.readSurfaces(ckRoot, { file: ckDb, env: envRead, checkpointStride: 1 });
  const afterForeign = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  good_lastSeq_bump: {
    const good = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    good.lastSeq = 999999;
    fs.writeFileSync(cacheFile, JSON.stringify(good));
  }
  eventReadModel.closeAll();
  const future = eventReadModel.readSurfaces(ckRoot, { file: ckDb, env: envRead, checkpointStride: 1 });
  const afterFuture = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  if (foreign.foldPath !== "full" || keyOfFace(foreign) !== keyOfFace(fromScratch)) bad("RM-15", `别的数据根的检查点被当成本库的面用了（path=${foreign.foldPath}）`);
  else if (future.foldPath !== "full" || keyOfFace(future) !== keyOfFace(fromScratch)) bad("RM-15", `比库还新的检查点被用了（path=${future.foldPath}）`);
  else if (afterForeign.lastSeq !== ckSeq || afterFuture.lastSeq !== ckSeq) bad("RM-15", `读完之后检查点没退回真实游标：${afterForeign.lastSeq}/${afterFuture.lastSeq} vs ${ckSeq} —— 一次错位就永久不再落盘`);
  else ok("RM-15", `外来 dbFile 与 lastSeq=999999 两种检查点都被拒，面按全量折出、落盘退回真实游标 ${ckSeq}`);

  /* RM-16：只读消费方不建库（no_db 那格在碰检查点之前就返回）。 */
  const noDbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-nodeb-"));
  const noDbFile = path.join(noDbRoot, "events", "desktop-events.sqlite");
  const miss = eventReadModel.readSurfaces(noDbRoot, { file: noDbFile, env: envRead, checkpointStride: 1 });
  if (miss.ok || miss.reason !== "no_db") bad("RM-16", `没库时读数不对：${JSON.stringify(miss)}`);
  else if (fs.existsSync(noDbFile) || fs.existsSync(eventReadModel.checkpointPathFor(noDbFile))) bad("RM-16", "读路径把库或检查点建出来了 —— 只读消费方变成了写者");
  else ok("RM-16", "没库 → no_db，且不建库、不建检查点文件（读路径仍不是写者）");

  /* RM-17：顺序是语义 —— 折出不干净的那次绝不落盘。 */
  const src = fs.readFileSync(path.join(ROOT, "hosts/shared/event_read_model.js"), "utf8");
  const iAnom = src.indexOf('reason: "fold_anomalies"');
  const iSave = src.indexOf("if (lastSeq - slot.persistedSeq >= stride");
  if (!(iAnom > 0 && iSave > iAnom)) bad("RM-17", "落检查点那一格排在了 fold_anomalies 拒绝之前 —— 毒面会被写进盘上缓存");
  else ok("RM-17", `落检查点排在 fold_anomalies 之后（第 ${iAnom} 字符 vs 第 ${iSave} 字符），折不干净那次不落盘`);

  cleanupFlags();
  eventReadModel.closeAll();
  for (const d of [ckRoot, noDbRoot]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉不影响结论 */
    }
  }
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

/* ===== RM-09：KP-05 可感面「删掉 sessions.json 重启，会话列表还在」 =====
 * 关闭双写（切到 BITBOT_EVENT_ONLY=1，事件是唯一真源）后，把磁盘上的 JSON 快照删掉，
 * 产品读到的会话列表必须**照样在**——因为它是从 fold(events) 重建的，不是从那个文件读的。
 * 反向对照（同一个库 + 同样删了 JSON，但把事件读关掉）必须读到**空**：证明「列表还在」
 * 是事件折叠在起作用，不是缓存残留、也不是偷偷读到了别的地方的 JSON。 */
{
  cleanupFlags();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rm-killjson-"));
  // 先在双写世界写两轮：JSON 与事件库都留下痕迹。
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  const ssW = makeSessions(root);
  ssW.list();
  ssW.create("删档幸存甲").session.id;
  const sidB = ssW.create("删档幸存乙").session.id;
  ssW.appendMessages(sidB, [{ role: "user", text: "重启后也要在" }]);
  eventMirror.closeAllMirrors();
  const expectedTitles = ["删档幸存甲", "删档幸存乙"];

  // 关闭双写、切事件唯一真源；删掉 JSON 快照——这就是可感面那一步。
  delete process.env.BITBOT_EVENT_DUAL_WRITE;
  process.env.BITBOT_EVENT_ONLY = "1";
  eventReadModel.closeAll();
  eventMirror.closeAllMirrors();
  fs.rmSync(path.join(root, SESSIONS_FILE), { force: true });

  const ssAfter = makeSessions(root);
  const listed = ssAfter.list();
  const titles = (listed.sessions || []).map((s) => s.title);
  const survived = expectedTitles.every((t) => titles.includes(t));
  const stillNoJsonFile = !fs.existsSync(path.join(root, SESSIONS_FILE));
  if (!survived) bad("RM-09", `删 sessions.json + EVENT_ONLY 后列表没重建出来：读到 ${JSON.stringify(titles)}`);
  else if (!stillNoJsonFile) bad("RM-09", "EVENT_ONLY 读列表时把 sessions.json 又写了出来（读路径不该落 JSON）");
  else ok("RM-09", `删掉 sessions.json + 关双写(EVENT_ONLY)：重启后列表里那 ${titles.length} 条会话从 fold(events) 原样重建，JSON 文件仍未被读路径重建`);

  // 反向对照：同一个事件库、sessions.json 依旧不存在，但把事件读关掉 → 必须读空。
  // cleanupFlags 只关 READ/DUAL_WRITE；EVENT_ONLY 这条也得显式摘掉，否则读仍走 fold。
  delete process.env.BITBOT_EVENT_ONLY;
  cleanupFlags();
  eventReadModel.closeAll();
  eventMirror.closeAllMirrors();
  const ssBlind = makeSessions(root);
  const { result: blindList } = captureStderr(() => ssBlind.list());
  const blindTitles = (blindList.sessions || []).map((s) => s.title);
  const lost = !expectedTitles.some((t) => blindTitles.includes(t));
  if (!lost) bad("RM-09-neg", `关掉事件读后竟然还读到了会话（说明 fold 不是唯一来源）：${JSON.stringify(blindTitles)}`);
  else ok("RM-09-neg", `反向对照：同一个库、同样删了 JSON，但关掉事件读 → 列表是空的——「还在」确实只可能是 fold(events) 给的`);

  eventReadModel.closeAll();
  eventMirror.closeAllMirrors();
  fs.rmSync(root, { recursive: true, force: true });
  cleanupFlags();
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
