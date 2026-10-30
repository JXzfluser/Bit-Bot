/* prove_event_dual_write.mjs — T1-03 双写旁路门禁（DW-01..DW-10）
 *
 * 需求原文（docs/next-target-requirements.md T1-03）：
 *   双写旁路：现有写入点同时写 events（不改行为）
 *   完成定义：fold(events) 与 JSON 快照逐字段相等（sessions/rooms/approvals）
 *
 * 这把尺子怎么才算「证明」了那句话：
 *
 *   DW-01 不改行为：开关关掉时不建库、不产生任何额外文件；开着时同一串写入
 *          落出来的快照**结构**与关掉时逐字段同形（id/时间戳这类每次都变的值
 *          按形状归一，不比字面）
 *   DW-02 逐步对拍：不是「最后比一次」，而是**每一步写入后**都把日志从头折叠
 *          一遍和磁盘上的 JSON 比 —— 哪一个写入点没记账，当场就露出来
 *   DW-03 覆盖面自报：把 20 个写入点按名字列出来，逐个点名它到底派了哪几类
 *          kind；一个都没派而快照变了，就是漏账（红）；反过来「跑了一遍但快照
 *          没改」的空步也不许留在清单里（roomLibraryAdd 曾经就是这样混过去的）；
 *          镜像自报的「没人认领」条目必须逐字打出来并当场红
 *   DW-04 反向对照：对库里出现的**每一类**事件都真删（删临时副本），然后把
 *          20 步对拍按 seq 前缀整轮重放，必须至少有一步因此变红 —— 删了没反应
 *          的就是死词。只比最终态不够：一个后来被删掉的会话，它当年的事件对最终
 *          快照毫无贡献，会被误判成死词
 *   DW-05 幂等在哪：镜像事件**不带** idem_key（DW-05b 是这条决定的反向对照：
 *          同一个目标被激活两次必须在库里有两行，否则 fold 折不回真实的 active_id）；
 *          幂等落在 diff 上——内容没变的重复写一条都不派（DW-05c），
 *          逐字相同的两条行必须都在（DW-05a）
 *   DW-06 失败隔离：镜像开库失败（库路径被一个目录占了）时，快照写入必须照常
 *          成功、内容一字不改，且失败被计数 + 说人话，不是悄悄吞掉
 *   DW-07 词表脱节要报：往库里塞一条折叠器不认识的 kind，fold 必须点名，
 *          不能「忽略未知的就当没看见」
 *   DW-08 seq 账：双写出来的行 seq 严格递增、三张面共用同一条流，
 *          镜像自报条数 == 库里由它写的行数（两个数必须讲同一件事）
 *   DW-09 兜底网：store 顶层冒出/消失一个陌生字段、以及 active_id 归零
 *          （product_surface.js:486 那条绕过 store 的级联会造出这个形状）
 *          都要被认领、能折回来、且不许记失败
 *   DW-10 起得来：运行时没有 node:sqlite（Electron 33 = Node 20.18.3）时，
 *          开关关着必须完全静默地照常启动与落盘，开着要说人话一句「已降级为不写」
 *          ——接线第一天就是在这条上把主进程打死的（见 DW-10z 的对照）
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
const { openEventLog } = require("../hosts/shared/event_log.js");
const { DatabaseSync } = require("node:sqlite");

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

function surfaceSnapshot(dataRoot) {
  const sessions = JSON.parse(readText(path.join(dataRoot, SESSIONS_FILE)) || "null");
  const rooms = JSON.parse(readText(path.join(dataRoot, ROOMS_FILE)) || "null");
  const approvals = (readText(path.join(dataRoot, PENDING_FILE)) || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  /* 「这个文件还没被写过」和「里面是空的 store」在 fold 语义里同形：
     fold 的基线就是空 store（event_mirror.BASELINE），日志里也不会有它的痕迹。
     这不是把差异抹平——差异如果出现在 store 内容上，deepDiff 照样点名。 */
  return {
    sessions: sessions === null ? eventMirror.BASELINE.sessions : sessions,
    rooms: rooms === null ? eventMirror.BASELINE.rooms : rooms,
    approvals,
  };
}

/** 形状归一：把每次运行都会变的 id/时间戳压成同一个记号，好让 DW-01 比结构。 */
function skel(v) {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map(skel);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = skel(v[k]);
    return out;
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return "<iso>";
    if (/^sess-[0-9a-f]{8}$/.test(v)) return "<sess-id>";
    if (/^msg-[0-9a-f]{8}$/.test(v)) return "<msg-id>";
    if (/^room-[0-9a-z]+$/.test(v)) return "<room-id>";
    if (/^approval-[0-9a-z]+$/.test(v)) return "<approval-id>";
    if (/^bot-[0-9a-f]+$/.test(v)) return "<bot-id>";
    if (/^lib-[0-9a-z]+-[a-z0-9]+$/.test(v)) return "<lib-id>";
  }
  return v;
}

function eventsFromFile(file) {
  const h = openEventLog({ file, actor: "reader" });
  try {
    return h.readAfter({ fromSeq: 0, limit: 100000 }).map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  } finally {
    h.close();
  }
}

function foldFrom(file) {
  return eventMirror.foldEvents(eventsFromFile(file));
}

/** fold 出来的三张面和磁盘快照逐字段比（deepDiff 会点名第一条差异路径）。 */
function compareFold(dataRoot, file, where) {
  const folded = foldFrom(file);
  const snap = surfaceSnapshot(dataRoot);
  const out = [];
  eventMirror.deepDiff(snap.sessions, folded.sessions, "sessions", out);
  eventMirror.deepDiff(snap.rooms, folded.rooms, "rooms", out);
  eventMirror.deepDiff(snap.approvals, folded.approvals, "approvals", out);
  const anomalies = folded.anomalies || [];
  if (anomalies.length) for (const a of anomalies) out.push(`anomaly: ${a}`);
  return { out, folded, snap };
}

function makeSurface(dataRoot) {
  const { createProductSurface } = require("../hosts/desktop/product_surface.js");
  return createProductSurface(ROOT, { dataRoot });
}
function makeSessions(dataRoot) {
  const { createSessionStore } = require("../hosts/desktop/sessions.js");
  return createSessionStore(ROOT, { dataRoot });
}

/* ===== 场景：把真实写入点逐个走一遍 =====
   每一步都标了它动的是哪个写入点（DW-03 的覆盖面清单就来自这里）。 */
function scenario(dataRoot) {
  const ps = makeSurface(dataRoot);
  const ss = makeSessions(dataRoot);
  const steps = [];
  const ctx = {};

  const step = (site, fn) => steps.push({ site, fn });

  step("sessions.load 首次播种（sessions.js:64）", () => {
    ss.list();
    return true;
  });
  step("sessions.create（sessions.js:133）", () => {
    ctx.a = ss.create("双写甲").session.id;
    return true;
  });
  step("sessions.appendMessages（sessions.js:177）", () => {
    ss.appendMessages(ctx.a, [{ role: "user", text: "第一条" }]);
    ss.appendMessages(ctx.a, [{ role: "assistant", text: "回第一条" }]);
    return true;
  });
  step("sessions.setActive（sessions.js:142）", () => {
    ctx.b = ss.create("双写乙").session.id;
    ss.setActive(ctx.a);
    return true;
  });
  step("sessions.rename（sessions.js:213）", () => {
    ss.rename(ctx.a, "改过名的甲");
    return true;
  });
  step("sessions.react（sessions.js:256）", () => {
    const msgs = ss.get(ctx.a).session.messages;
    ss.react(ctx.a, msgs[0].id, "👍", true);
    return true;
  });
  step("sessions.removeMessage（sessions.js:275）", () => {
    const msgs = ss.get(ctx.a).session.messages;
    ss.removeMessage(ctx.a, msgs[msgs.length - 1].id);
    return true;
  });
  step("sessions.remove（sessions.js:230）", () => {
    ss.remove(ctx.b);
    return true;
  });
  step("sessions.remove 删到最后一条（store 当场补一条新的「新对话」，sessions.js:235）", () => {
    /* 这一步的形状：删掉最后一条时 remove() 不会把 store 留空，而是用 empty()
       现造一条随机的「新对话」并落盘 —— 于是同一批里既有 entity_removed、又有
       session_created、还有 entity_order_changed / entity_activated。四类都在这
       一步被 fold 检验（少记任何一类，这一步的对拍就红）。 */
    const c = ss.create("双写丙").session.id;
    ss.setActive(c);
    for (const s of ss.list().sessions) ss.remove(s.id);
    const after = ss.list();
    return after.sessions.length === 1 && after.sessions[0].title === "新对话";
  });
  step("bots.create ×2（roomCreate 要 2–6 个成员，一个都建不出群）", () => {
    ctx.bot = ps.createBot({ name: "双写测试甲" }).bot?.id || null;
    ctx.bot2 = ps.createBot({ name: "双写测试乙" }).bot?.id || null;
    ctx.dm = ss.create("双写测试甲 · DM").session.id;
    return !!ctx.bot && !!ctx.bot2 && !!ctx.dm;
  });
  step("rooms.roomCreate（product_surface.js:1617）", () => {
    const r = ps.roomCreate(`${ctx.bot},${ctx.bot2}`, "双写测试群");
    ctx.room = r.room?.id || null;
    return r.ok === true && !!ctx.room;
  });
  step("rooms.appendRoomTranscript（product_surface.js:1721）", () => {
    ps.appendRoomTranscript(ctx.room, { kind: "user", room_id: ctx.room, speaker: "u", text: "群里第一句", at: new Date().toISOString() });
    ps.appendRoomTranscript(ctx.room, { kind: "system", room_id: ctx.room, speaker: "system", text: "回执", at: new Date().toISOString() });
    return true;
  });
  step("rooms 同一次调用里追加两条逐字相同的行（幂等键不能把它们并成一条）", () => {
    const same = { kind: "user", room_id: ctx.room, speaker: "u", text: "重复句", at: "2026-01-01T00:00:00.000Z" };
    const r = ps.appendRoomTranscript(ctx.room, same);
    ps.appendRoomTranscript(ctx.room, same);
    return r.ok === true;
  });
  step("rooms.roomMembersUpdate（product_surface.js:1491）", () => {
    const third = ps.createBot({ name: "双写第三 Bot" }).bot?.id;
    const r = ps.roomMembersUpdate({ room: ctx.room, bot_id: third, action: "add" });
    ctx.bot3 = third;
    return r.ok === true;
  });
  step("rooms.roomLibraryAdd（product_surface.js:1353）", () => {
    /* 条目必须带 title，path 还得落在仓库内（roomLibraryAdd 用 openArtifact 那把
       尺子量它）。之前这里传的是 {kind,text}，函数走了 added:0 的分支：写点是走了，
       但一个字都没落盘 —— 「跑过了」不等于「写过了」，所以断言 added===1。 */
    const r = ps.roomLibraryAdd(ctx.room, [
      { title: "双写素材", kind: "doc", path: path.join(ROOT, "docs", "events.md") },
    ]);
    return r.ok === true && r.added === 1;
  });
  step("rooms.transcript 截断（appendRoomTranscript 的 200 上限，product_surface.js:1718）", () => {
    for (let i = 0; i < 205; i++) {
      ps.appendRoomTranscript(ctx.room, { kind: "user", room_id: ctx.room, speaker: "u", text: `刷到上限 ${i}`, at: `2026-01-02T00:00:${String(i).padStart(5, "0")}Z` });
    }
    const hit = roomFromDisk(dataRoot, ctx.room);
    return !!hit && (hit.transcript || []).length === 200;
  });
  step("approvals.appendPendingApproval（product_surface.js:786）", () => {
    const r = ps.appendPendingApproval({ source: "chat", kind: "shell_exec", command: "echo hi" });
    ctx.ap = r.id;
    return r.ok === true && !!r.id;
  });
  step("approvals.approvalDecide（product_surface.js:862/865）", () => {
    const r = ps.approvalDecide(ctx.ap, "allow_once");
    return r.ok === true;
  });
  step("approvals 第二条 + logApprovalDeny（product_surface.js:905）", () => {
    const r = ps.appendPendingApproval({ source: "loop", kind: "mail_send", command: "send report" });
    const d = ps.logApprovalDeny({ id: r.id, kind: "mail_send", command: "send report", reason: "手动拒" });
    return !!r.id && d !== undefined;
  });
  step("bots.delete 级联改 sessions.json（product_surface.js:478 那个绕过 store 的写入点）", () => {
    const r = ps.deleteBot(ctx.bot, "yes");
    return r.ok === true;
  });

  return { steps, ps, ss, ctx };
}

/** 读某一间房当前的 transcript（用来确认「真的被截到 200」）。 */
function roomFromDisk(dataRoot, roomId) {
  const text = readText(path.join(dataRoot, ROOMS_FILE));
  if (!text) return null;
  const parsed = JSON.parse(text);
  return (parsed.rooms || []).find((r) => String(r.id) === String(roomId)) || null;
}

function runScenario(dataRoot) {
  const { steps, ...rest } = scenario(dataRoot);
  const trail = [];
  for (const s of steps) {
    let raised = null;
    let result;
    try {
      result = s.fn();
    } catch (err) {
      raised = String((err && err.message) || err);
    }
    trail.push({ site: s.site, result, raised });
  }
  return { trail, ...rest };
}

function eventFileFor(dataRoot) {
  return path.join(dataRoot, "events", "desktop-events.sqlite");
}

/* ===== DW-01：关掉时不建库；开着时写入结果同形 ===== */
const offRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-dw-off-"));
delete process.env.BITBOT_EVENT_DUAL_WRITE;
eventMirror.closeAllMirrors();
{
  const off = runScenario(offRoot);
  const evDir = path.join(offRoot, "events");
  if (fs.existsSync(evDir)) bad("DW-01", `关掉开关却建了库目录：${evDir}`);
  else {
    const stray = walk(offRoot).filter((p) => /\.sqlite(-wal|-shm)?$/i.test(p));
    if (stray.length) bad("DW-01", `关掉开关却留下库文件：${stray.join(" / ")}`);
    else ok("DW-01a", `开关关掉：${off.trail.length} 步写入全部照常落盘，dataRoot 里没有任何 .sqlite`);
  }
  const reds = off.trail.filter((t) => t.raised);
  if (reds.length) bad("DW-01", `关掉开关时场景步骤抛错：${reds.map((r) => r.site + "→" + r.raised).join(" / ")}`);
  global.__offSnap = surfaceSnapshot(offRoot);
  eventMirror.closeAllMirrors();
}

/* 开着的那轮逐步走：每一步记下「派了哪些 kind」和「快照变了没有」。
   归属靠 seq 区间——这一路只有镜像一个写者，所以 (lastSeq, now] 就是这一步的账。 */
const onRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-dw-on-"));
const onTrail = [];
let onStats = null;
{
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  const mirrorOn = eventMirror.getSharedMirror(onRoot);
  const { steps } = scenario(onRoot);
  const file = eventFileFor(onRoot);
  let prevSnap = null;
  let lastSeq = 0;
  for (const s of steps) {
    let raised = null;
    let result;
    const probsBefore = mirrorOn.stats.unattributed.length;
    try {
      result = s.fn();
    } catch (err) {
      raised = String((err && err.message) || err);
    }
    const rows = fs.existsSync(file) ? eventsFromFile(file) : [];
    const mine = rows.filter((r) => Number(r.seq) > lastSeq);
    if (rows.length) lastSeq = Number(rows[rows.length - 1].seq);
    const snap = surfaceSnapshot(onRoot);
    const changed = prevSnap === null ? true : JSON.stringify(skel(prevSnap)) !== JSON.stringify(skel(snap));
    const { out } = compareFold(onRoot, file, s.site);
    onTrail.push({
      site: s.site,
      result,
      raised,
      kinds: mine.map((r) => r.kind),
      changed,
      diff: out,
      markSeq: lastSeq,
      snap,
      unclaimed: mirrorOn.stats.unattributed.slice(probsBefore),
    });
    prevSnap = snap;
  }
  eventMirror.closeAllMirrors();
  onStats = {
    unattributed: mirrorOn.stats.unattributed.slice(),
    duplicated: mirrorOn.stats.duplicated,
    emitted: mirrorOn.stats.emitted,
    failures: mirrorOn.stats.failures,
  };

  const broken = onTrail.filter((t) => t.raised);
  if (broken.length) bad("DW-02", `场景步骤抛错（双写不该改变行为）：${broken.map((b) => b.site + "→" + b.raised).join(" / ")}`);
  /* 每一步都得真的写成。有一步只是返回了 ok:false（比如成员数不够、房间没建出来），
     那「14 个写入点都覆盖了」这句话就是空的，所以这里当场红。 */
  const noops = onTrail.filter((t) => !t.raised && t.result !== true);
  if (noops.length) bad("DW-02", `有 ${noops.length} 步没真的写入，覆盖面清单不作数：${noops.map((n) => n.site + "→" + JSON.stringify(n.result)).join(" / ")}`);
  const firstBadStep = onTrail.find((t) => t.diff.length);
  if (firstBadStep) {
    bad("DW-02", `第一步跟不上的是「${firstBadStep.site}」：\n      ${firstBadStep.diff.slice(0, 6).join("\n      ")}`);
  } else if (!broken.length && !noops.length) {
    ok("DW-02", `${onTrail.length} 步写入，每一步之后 fold(events) 都与 JSON 快照逐字段相等（「文件还不存在」与「空 store」按 fold 基线同形处理）`);
  }

  /* DW-01 的后半句：开着与关着的写入结果同形。 */
  const onSnap = surfaceSnapshot(onRoot);
  const shape = eventMirror.deepDiff(skel(global.__offSnap), skel(onSnap), "$", []);
  if (shape.length) bad("DW-01", `开关开着改变了写入结果（形状差异）：${shape.slice(0, 5).join(" / ")}`);
  else ok("DW-01b", `开关开着落出来的快照与关掉时同形（id/时间戳按形状归一后逐字段一致）`);
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/* ===== DW-03：覆盖面自报 —— 快照变了就必须有账，逐个写入点点名 ===== */
{
  const unaccounted = onTrail.filter((t) => t.changed && t.kinds.length === 0 && !t.raised);
  const kindCounts = {};
  for (const t of onTrail) for (const k of t.kinds) kindCounts[k] = (kindCounts[k] || 0) + 1;
  const listed = onTrail
    .map((t) => `      ${t.changed ? "快照变了" : "快照没变"} | ${t.site} → ${t.kinds.length ? [...new Set(t.kinds)].join(",") : "（无事件）"}`)
    .join("\n");
  if (unaccounted.length) {
    bad("DW-03", `${unaccounted.length} 个写入点把快照改了却一条事件都没派：${unaccounted.map((u) => u.site).join(" / ")}`);
    console.log(listed);
  } else {
    ok("DW-03a", `${onTrail.length} 个写入点逐个点名：快照变了的都有账（漏一个就红）`);
    console.log(listed);
  }
  /* 反过来也要成立：清单里每一步都该真的把快照改了。「调用了写入点但内容没变」
     在上一版里混在绿账里（roomLibraryAdd 传错形状，added:0，什么都没落）。 */
  const idle = onTrail.filter((t) => !t.changed && !t.raised);
  if (idle.length) bad("DW-03", `有 ${idle.length} 步声称是写入点却没动快照（跑过 ≠ 写过，覆盖面清单里不许有这种）：${idle.map((t) => t.site).join(" / ")}`);
  else ok("DW-03e", `清单上 ${onTrail.length} 步每一步都真的改了快照，没有「走了一遍但一个字没落」的空步`);
  const expected = [
    "session_created",
    "message_committed",
    "entity_state_changed",
    "entity_activated",
    "entity_removed",
    "entity_order_changed",
    "message_updated",
    "message_removed",
    "history_pruned",
    "approval_requested",
    "approval_decided",
  ];
  const missing = expected.filter((k) => !kindCounts[k]);
  const note = Object.keys(kindCounts)
    .sort()
    .map((k) => `${k}=${kindCounts[k]}`)
    .join(" ");
  if (missing.length) bad("DW-03", `场景跑完了却没有这些 kind（对应写入点没走到，或走了没记账）：${missing.join(" / ")}`);
  else ok("DW-03b", `kind 计数：${note}`);
  const vocab = new Set([
    ...expected,
    "history_pruned",
    "store_state_changed",
    "turn_started",
    "turn_ended",
    "progress",
    "effect_started",
    "effect_finished",
    "job_started",
    "job_output",
    "job_ended",
    "presence_changed",
  ]);
  const invented = Object.keys(kindCounts).filter((k) => !vocab.has(k));
  if (invented.length) bad("DW-03", `出现了词表之外的 kind（代码自造词）：${invented.join(" / ")}`);
  else ok("DW-03c", `派出的每一条 kind 都在 docs/events.md §5.2/§5.4 的词表里`);
  /* 「没人认领」必须逐字打出来：它今天也许没让 fold 翻红（那一处变化恰好折得回去），
     但它就是「快照与日志开始分道」的第一笔账，不能只留一行 stderr。 */
  if (onStats.unattributed.length) {
    const where = onTrail.filter((t) => t.unclaimed.length).map((t) => `      ${t.site}\n${t.unclaimed.map((u) => "        · " + u).join("\n")}`);
    bad("DW-03", `有 ${onStats.unattributed.length} 处变化镜像没认领（当场红：这就是快照与日志分道的第一笔账）：\n${where.join("\n")}`);
  } else ok("DW-03d", `整轮下来 0 处「快照变了但没人认领」的变化`);
}

/* ===== DW-04：反向对照 —— 库里出现的每一类事件，删掉它必须有某一步 fold 跟不上 =====
   逐个 kind 在临时副本上真删，然后**按 seq 前缀**把每一步的对拍重放一遍：
   只看「最终状态」是不够的——一个后来被删掉的会话，它当年的 message_updated /
   entity_order_changed 对最终快照毫无贡献，那类事件就会被误判成死词；反过来，
   一个只在中间某步干活的事件如果只比最终态，也可能碰巧对上而蒙混过关。 */
{
  const src = eventFileFor(onRoot);
  const probe = path.join(path.dirname(src), "reverse-" + path.basename(src));
  const cleanProbe = () => [probe, probe + "-wal", probe + "-shm"].forEach((f) => fs.rmSync(f, { force: true }));
  const dbKinds = {};
  for (const r of eventsFromFile(src)) dbKinds[r.kind] = (dbKinds[r.kind] || 0) + 1;
  const deadWeight = [];
  for (const kind of Object.keys(dbKinds).sort()) {
    cleanProbe();
    fs.copyFileSync(src, probe);
    const db = new DatabaseSync(probe);
    const before = Number(db.prepare("SELECT COUNT(*) n FROM events WHERE kind = ?").get(kind).n);
    db.prepare("DELETE FROM events WHERE kind = ?").run(kind);
    db.close();
    // 副本的 -wal 必须只属于这一轮：上一次的残留会把「删掉」再演一遍，
    // 那这条反向对照就只是在读自己写的垃圾。
    const kept = eventsFromFile(probe);
    if (kept.length + before !== Object.keys(dbKinds).reduce((a, k) => a + dbKinds[k], 0))
      bad("DW-04", `删掉 ${kind} 后副本行数对不上账（剩 ${kept.length} + 删 ${before} ≠ 原 ${eventsFromFile(src).length}）`);
    cleanProbe();
    let hit = null;
    for (const t of onTrail) {
      const upto = kept.filter((r) => Number(r.seq) <= t.markSeq);
      const folded = eventMirror.foldEvents(upto);
      const out = [];
      eventMirror.deepDiff(t.snap.sessions, folded.sessions, "sessions", out);
      eventMirror.deepDiff(t.snap.rooms, folded.rooms, "rooms", out);
      eventMirror.deepDiff(t.snap.approvals, folded.approvals, "approvals", out);
      for (const a of folded.anomalies || []) out.push(`anomaly: ${a}`);
      if (out.length) {
        hit = { site: t.site, why: out[0], n: upto.length };
        break;
      }
    }
    if (hit) ok("DW-04", `删掉 ${kind}（${before} 条）→ 第「${hit.site}」步跟不上了（前 ${hit.n} 行折出来）：${hit.why}`);
    else {
      bad("DW-04", `删掉 ${kind} 的 ${before} 条事件后，${onTrail.length} 步对拍一步都没红 —— 这类事件没在为 fold 干活（DW-02 里有恒真的成分）`);
      deadWeight.push(kind);
    }
  }
  cleanProbe();
  if (deadWeight.length) bad("DW-04", `这 ${deadWeight.length} 类是死词：${deadWeight.join(" / ")}`);
  else ok("DW-04z", `库里的 ${Object.keys(dbKinds).length} 类事件逐个反向对照（每类都对全部 ${onTrail.length} 步重放）：没有死词，DW-02 不是恒真`);
}

/* ===== DW-05：幂等 —— 两条逐字相同的行要都在，同一次 delta 重放只算一次 ===== */
{
  const rows = eventsFromFile(eventFileFor(onRoot));
  const dupRows = rows.filter((r) => r.kind === "message_committed" && r.payload?.message?.text === "重复句");
  if (dupRows.length === 2) ok("DW-05a", `两次逐字相同的追加在库里是 2 行（镜像事件不带幂等键，真发生两次就记两次）`);
  else bad("DW-05", `「重复句」应该 2 行、实际 ${dupRows.length} 行——镜像把两次真追加当成了一次`);

  /* DW-05b 是这条决定的反向对照：曾经给镜像事件按内容哈希发 idem_key，于是
     「同一个值被来回切」的第二、三次撞约束被当成重复吞掉，库里只剩一行，
     fold 折回来的 active_id 就停在旧值上（快照明明变了）。现在按事实断：
     同一个目标被激活两次 → 库里两行同 payload 的 entity_activated 都要在。 */
  const flipRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-dw-flip-"));
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  const fm = eventMirror.getSharedMirror(flipRoot);
  const fs2 = makeSessions(flipRoot);
  fs2.list();
  const actA = fs2.create("来回切甲").session.id;
  const actB = fs2.create("来回切乙").session.id;
  fs2.setActive(actA);
  fs2.setActive(actB);
  fs2.setActive(actA);
  const flipFile = eventFileFor(flipRoot);
  eventMirror.closeAllMirrors();
  {
    const flipRows = eventsFromFile(flipFile);
    const onA = flipRows.filter((r) => r.kind === "entity_activated" && r.payload?.active_id === actA);
    const { out } = compareFold(flipRoot, flipFile, "flip");
    const withKey = flipRows.filter((r) => r.idemKey != null).length;
    if (onA.length < 2)
      bad("DW-05", `「先切到甲、再切回甲」在库里只有 ${onA.length} 行 entity_activated —— 同一条真实转换被并成了一次`);
    else if (out.length) bad("DW-05", `来回切之后 fold 与快照不等：${out[0]}`);
    else if (withKey > 0) bad("DW-05", `镜像给 ${withKey} 条事件发了 idem_key：按内容去重迟早会吞掉一次真转换`);
    else if (fm.stats.duplicated !== 0)
      bad("DW-05", `不发幂等键却出现 ${fm.stats.duplicated} 次 duplicated，说明库里另有写者`);
    else
      ok("DW-05b", `同一条转换真发生两次 → 库里 ${onA.length} 行都在；镜像写的 ${flipRows.length} 行 idem_key 全为 NULL、duplicated=${fm.stats.duplicated}（幂等不靠键，见 DW-05c）`);
  }

  /* DW-05c：幂等落在 diff 上——内容没变的重复写，一条都不派。
     这就是「不需要幂等键」的理由：prev 每次从盘上重读，写两次相同内容第二次 diff 为空。 */
  {
    const before = eventsFromFile(flipFile).length;
    const m2 = eventMirror.getSharedMirror(flipRoot);
    fs2.setActive(actA); // actA 当前就是激活项：整份快照逐字不变
    eventMirror.closeAllMirrors();
    const after = eventsFromFile(flipFile).length;
    const { out } = compareFold(flipRoot, flipFile, "noop");
    if (after !== before) bad("DW-05", `内容没变的重复写派了 ${after - before} 行（diff 本该为空）`);
    else if (out.length) bad("DW-05", `重复写后 fold 与快照不等：${out[0]}`);
    else if (m2.stats.emitted !== 0) bad("DW-05", `库里没多行，但镜像自报派了 ${m2.stats.emitted} 条——两个数又在讲两件事`);
    else ok("DW-05c", `内容不变的重复写：行数 ${before}→${after}（零新增），镜像自报 0 条，fold 仍与快照相等`);
  }
  fs.rmSync(flipRoot, { recursive: true, force: true });
}

/* ===== DW-06：镜像开库失败时，快照写入照常 ===== */
{
  const failRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-dw-fail-"));
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  // 把库路径占成一个目录：openEventLog 必然失败
  fs.mkdirSync(path.join(failRoot, "events"), { recursive: true });
  fs.mkdirSync(path.join(failRoot, "events", "desktop-events.sqlite"), { recursive: true });
  const stderr = [];
  const m = eventMirror.getSharedMirror(failRoot, { log: (line) => stderr.push(line) });
  const ss = makeSessions(failRoot);
  const id = ss.create("镜像坏了也要写下去").session.id;
  ss.appendMessages(id, [{ role: "user", text: "照旧落盘" }]);
  eventMirror.closeAllMirrors();
  const snap = surfaceSnapshot(failRoot);
  const wroteOk = Array.isArray(snap.sessions?.sessions) && snap.sessions.sessions.some((s) => s.id === id);
  const messagesOk = (snap.sessions.sessions.find((s) => s.id === id)?.messages || []).length >= 1;
  if (!wroteOk || !messagesOk) bad("DW-06", `镜像坏了，快照却没写全：sessions=${wroteOk} messages=${messagesOk}`);
  else if (m.stats.failures < 1) bad("DW-06", "镜像失败了却没有被计数（吞异常）");
  else if (!stderr.some((l) => /开库失败|派事件失败/.test(l))) bad("DW-06", `失败没用人话说出来，只计数：${stderr.join(" / ")}`);
  else ok("DW-06", `库路径被目录占用：快照照常落盘（会话与消息都在），镜像记了 ${m.stats.failures} 次失败并打印「开库失败」`);
  void id;
}

/* ===== DW-07：词表脱节必须点名，不能当没看见 ===== */
{
  const f = eventFileFor(onRoot);
  const h = openEventLog({ file: f, actor: "probe" });
  h.append({ sessionId: "sess-probe", kind: "totally_unknown_kind", payload: { x: 1 } });
  h.close();
  const folded = foldFrom(f);
  const hit = (folded.anomalies || []).find((a) => /不认识 kind=totally_unknown_kind/.test(a));
  if (hit) ok("DW-07", `塞一条词表外的 kind，fold 点名了：${hit}`);
  else bad("DW-07", `fold 对未知 kind 一声不吭（anomalies=${JSON.stringify(folded.anomalies)}）`);
  // 这条探针事件留在临时库里不影响后面的断言（三张面里没有 sess-probe）
}

/* ===== DW-08：三张面共用同一条 seq 流 ===== */
{
  const f = eventFileFor(onRoot);
  const rows = eventsFromFile(f);
  const seqs = rows.map((r) => Number(r.seq));
  const strictInc = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
  const db = new DatabaseSync(f);
  const n = db.prepare("SELECT COUNT(*) n FROM events").get().n;
  db.close();
  const touched = {
    sessions: rows.some((r) => /^sess-/.test(String(r.sessionId))),
    rooms: rows.some((r) => /^room-/.test(String(r.sessionId))),
    approvals: rows.some((r) => /^approval-/.test(String(r.sessionId))),
  };
  const missing = Object.keys(touched).filter((k) => !touched[k]);
  const fromMirror = rows.filter((r) => r.actor !== "probe").length;
  if (!strictInc) bad("DW-08", "双写出来的 seq 不是严格递增");
  else if (Number(n) !== rows.length) bad("DW-08", `读到的行数 ${rows.length} ≠ 库里的 ${n}`);
  else if (missing.length) bad("DW-08", `这三张面本该共用一条流，但库里没有它的事件：${missing.join(" / ")}`);
  else if (onStats.emitted !== fromMirror)
    bad("DW-08", `镜像自报派了 ${onStats.emitted} 条，库里由它写的只有 ${fromMirror} 行（总行数 ${rows.length}，duplicated=${onStats.duplicated}）—— 两个数在讲两件事`);
  else ok("DW-08", `${rows.length} 条事件、seq 严格递增、sessions/rooms/approvals 同一条流（镜像自报 ${onStats.emitted} 条 = 库里的 ${fromMirror} 行）`);
}

/* ===== DW-09：兜底词表 —— store 顶层冒出/消失一个陌生字段 =====
   今天没有写入点会改 sessions.json 的顶层字段（除了 active_id），所以
   store_state_changed 不在 DW-04 的「库里的 kind」里。它是镜像的兜底网：
   明天的写入点加了字段，必须被它认领且能折回来；漏了就是 DW-02 那种漂移，
   只不过这次的字段在顶层，deepDiff 只会说「只在一边有」。 */
{
  const netRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-dw-net-"));
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  const nm = eventMirror.getSharedMirror(netRoot);
  const nss = makeSessions(netRoot);
  nss.list();
  nss.create("兜底网").session.id;
  const netFile = path.join(netRoot, SESSIONS_FILE);
  const dbFile = eventFileFor(netRoot);
  const withField = (() => {
    const o = JSON.parse(fs.readFileSync(netFile, "utf8"));
    o.sync_cursor = 7;
    return JSON.stringify(o, null, 2);
  })();
  let token = nm.capture(netFile);
  fs.writeFileSync(netFile, withField);
  nm.commit(netFile, token, withField);
  token = nm.capture(netFile);
  const after = JSON.parse(withField);
  delete after.sync_cursor;
  const without = JSON.stringify(after, null, 2);
  fs.writeFileSync(netFile, without);
  nm.commit(netFile, token, without);
  eventMirror.closeAllMirrors();
  {
    const rows = eventsFromFile(dbFile).filter((r) => r.kind === "store_state_changed");
    const added = rows.find((r) => r.payload?.fields?.sync_cursor === 7);
    const removed = rows.find((r) => (r.payload?.removed || []).includes("sync_cursor"));
    const snap = JSON.parse(fs.readFileSync(netFile, "utf8"));
    const folded = foldFrom(dbFile);
    const drift = eventMirror.deepDiff(folded.sessions, snap, "$", []);
    if (!added) bad("DW-09", `顶层加了 sync_cursor 却没有 store_state_changed{fields.sync_cursor}（库里这类事件 ${rows.length} 条）`);
    else if (!removed) bad("DW-09", `顶层删掉 sync_cursor 没有记账（changedScalars 只看得到新键，少了什么必须靠 removed）`);
    else if (drift.length) bad("DW-09", `兜底网认领了但折不回来：${drift.slice(0, 3).join(" / ")}`);
    else ok("DW-09", `store 顶层字段冒出→消失都被 store_state_changed 认领（${added.seq}/${removed.seq} 两行），fold 与快照仍逐字段相等`);
  }

  /* 半个字段都不许漏：active_id 变成 "" 是 product_surface.js:486 那条绕过 store 的
     级联写法会造出来的形状（删掉最后一个「· DM」会话时）。镜像曾经拿它当 session_id
     去 append，适配器按「需要 sessionId」当场拒收，异常被咽下后同一批剩下的事件一起丢，
     于是日志与快照从此分道、还一声不吭。 */
  {
    const cur = JSON.parse(fs.readFileSync(netFile, "utf8"));
    cur.active_id = "";
    const emptied = JSON.stringify(cur, null, 2);
    const tk = nm.capture(netFile);
    fs.writeFileSync(netFile, emptied);
    nm.commit(netFile, tk, emptied);
    eventMirror.closeAllMirrors();
    const rows2 = eventsFromFile(dbFile);
    const act = rows2.filter((r) => r.kind === "entity_activated" && String(r.payload?.active_id) === "");
    const lost = rows2.filter((r) => r.actor === "probe").length;
    const snap2 = JSON.parse(fs.readFileSync(netFile, "utf8"));
    const folded2 = foldFrom(dbFile);
    const drift2 = eventMirror.deepDiff(folded2.sessions, snap2, "$", []);
    if (!act.length) bad("DW-09", `active_id 归零没有记账（镜像大概率又把 "" 当 session_id 送去 append 然后整批丢了）`);
    else if (act.some((r) => r.sessionId !== "system"))
      bad("DW-09", `entity_activated 用了 session_id="${act[0].sessionId}"：空字符串会被适配器拒收，同批事件会一起消失`);
    else if (drift2.length) bad("DW-09", `active_id 归零后 fold 与快照不等：${drift2.slice(0, 3).join(" / ")}`);
    else if (nm.stats.failures !== 0) bad("DW-09", `镜像记了 ${nm.stats.failures} 次失败（这条路径本该一次都不失败）`);
    else ok(`DW-09b`, `active_id 归零：事件落在保留的 "system" 流上（第 ${act[0].seq} 行），fold 仍逐字段相等、失败计数 0（探针行 ${lost} 条除外）`);
  }
  fs.rmSync(netRoot, { recursive: true, force: true });
}

/* ===== DW-10：运行时撑不起来时，主进程必须照样起得来 =====
   T1-03 的接线（sessions.js / product_surface.js 顶层 require event_mirror）
   曾经把 event_log 的「加载即抛」一起带进了 require 链：Electron 33 里那颗
   Node 是 20.18.3，没有 node:sqlite —— 于是双写开关明明关着，桌面端却连窗口都
   开不出来，G-16 往后所有 Electron 门一起红。本门跑在 Node 22 上看不见这件事，
   所以这里把 node:sqlite 伪装成「不存在」，跑真实的两个模块：

     DW-10a 开关关：sessions.js + product_surface.js require 得动、store 建得动、
            写盘照常，且 event_log 一次都没被加载（这才是当年崩的那一句）、
            一个字节都不写、一句降级话都不说
     DW-10b 开关开：同样不崩，快照照常落盘，库目录不出现，
            但要说人话——一行「已降级为不写」，别让开着开关却找不到库的人猜
     DW-10z 对照：同一份伪装下直接 require event_log 必须抛（证明伪装真的生效，
            也证明修复前主进程死的正是这一句）
   产品侧的真实开机由矩阵的 Electron 门（G-16/G-46）盯，这里盯的是机制。 */
{
  const PROBE = `
const Module = require("module");
const fs = require("fs");
const path = require("path");
const ROOT = process.env.DW10_REPO;
const dataRoot = process.env.DW10_DATA;
const mode = process.env.DW10_MODE;
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
if (mode === "on") process.env.BITBOT_EVENT_DUAL_WRITE = "1";
else delete process.env.BITBOT_EVENT_DUAL_WRITE;
let threw = null;
let snap = false;
let eventsDir = false;
let evCached = false;
let tries = 0;
let mirror = null;
try {
  require(path.join(ROOT, "hosts/desktop/sessions.js"));
  require(path.join(ROOT, "hosts/desktop/product_surface.js"));
  const em = require(path.join(ROOT, "hosts/shared/event_mirror.js"));
  const { createSessionStore } = require(path.join(ROOT, "hosts/desktop/sessions.js"));
  const store = createSessionStore(ROOT, { dataRoot });
  store.list();
  store.create("老运行时").session.id;
  mirror = em.getSharedMirror(dataRoot);
  snap = fs.existsSync(path.join(dataRoot, "desktop", "sessions.json"));
  eventsDir = fs.existsSync(path.join(dataRoot, "events"));
  evCached = Object.keys(require.cache).some((p) => p.endsWith("event_log.js"));
  tries = sqliteTries;
} catch (err) {
  threw = String((err && err.message) || err);
  evCached = Object.keys(require.cache).some((p) => p.endsWith("event_log.js"));
  tries = sqliteTries;
}
console.log("__DW10__" + JSON.stringify({ mode, threw, snap, eventsDir, evCached, tries, enabled: mirror ? mirror.enabled : null, stub: mirror ? !!mirror.unavailable : null, failures: mirror ? mirror.stats.failures : null }));
`;
  const runProbe = (mode) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-dw10-"));
    const r = spawnSync(process.execPath, ["-e", PROBE], {
      env: { ...process.env, DW10_REPO: ROOT, DW10_DATA: dir, DW10_MODE: mode },
      encoding: "utf8",
      timeout: 120000,
    });
    const line = String(r.stdout || "")
      .split("\n")
      .find((l) => l.startsWith("__DW10__"));
    const out = line ? JSON.parse(line.slice("__DW10__".length)) : null;
    fs.rmSync(dir, { recursive: true, force: true });
    return { out, stderr: String(r.stderr || ""), rc: r.status };
  };

  const off10 = runProbe("off");
  if (!off10.out) bad("DW-10a", `探针子进程没出结果（rc=${off10.rc}）：${off10.stderr.slice(0, 160)}`);
  else if (off10.out.threw) bad("DW-10a", `开关关着、运行时没有 node:sqlite，主进程链却起不来：${off10.out.threw}`);
  else if (off10.out.evCached) bad("DW-10a", "开关关着却把 event_log 加载了（老运行时里加载即抛，主进程就是这么死的）");
  else if (!off10.out.snap) bad("DW-10a", "伪装成老运行时之后，会话快照没落盘——写入行为被改动了");
  else if (off10.out.eventsDir) bad("DW-10a", "开关关着却建了库目录");
  else if (off10.out.tries > 1) bad("DW-10a", `开关关着却探测了 ${off10.out.tries} 次 node:sqlite（只许镜像可用性那一次）`);
  else if (/已降级为不写/.test(off10.stderr)) bad("DW-10a", "开关关着却打印了降级说明（默认路径必须完全静默）");
  else
    ok(
      "DW-10a",
      `没有 node:sqlite 的运行时 + 开关关：sessions/product_surface 照常 require、会话照常落盘（探测 ${off10.out.tries} 次、event_log 未被加载、库目录不存在、无一句多余输出）`,
    );

  const on10 = runProbe("on");
  if (!on10.out) bad("DW-10b", `探针子进程没出结果：${on10.stderr.slice(0, 160)}`);
  else if (on10.out.threw) bad("DW-10b", `开关开着、运行时没有 node:sqlite，写入路径却抛了：${on10.out.threw}`);
  else if (!on10.out.snap) bad("DW-10b", "开关开着但快照没落盘——降级把行为改坏了");
  else if (on10.out.eventsDir) bad("DW-10b", "老运行时里居然建出了库目录");
  else if (on10.out.enabled !== false || on10.out.stub !== true)
    bad("DW-10b", `拿到的不是「接口一样的不写替身」（enabled=${on10.out.enabled} stub=${on10.out.stub}）`);
  else if (!/已降级为不写/.test(on10.stderr))
    bad("DW-10b", `开着开关却一个字都没说，用户只会看见「库不见了」：${on10.stderr.slice(0, 160) || "（stderr 全空）"}`);
  else ok(`DW-10b`, `老运行时 + 开关开：快照照常落盘、库目录不出现，说了人话一句「已降级为不写」（失败计数 ${on10.out.failures}）`);

  /* 伪装本身的对照：直接 require event_log 必须在这份伪装下抛。
     不抛就说明 hook 没生效，DW-10a/b 全是恒真。 */
  const ctrl = spawnSync(
    process.execPath,
    [
      "-e",
      `const Module=require("module");const o=Module._load;Module._load=function(r,...x){if(r==="node:sqlite"){const e=new Error("Cannot find module 'node:sqlite'");e.code="MODULE_NOT_FOUND";throw e;}return o.call(this,r,...x);};try{require(process.env.DW10_REPO+"/hosts/shared/event_log.js");console.log("__DW10__no-throw");}catch(err){console.log("__DW10__"+JSON.stringify({threw:String((err&&err.message)||err)}));}`,
    ],
    { env: { ...process.env, DW10_REPO: ROOT }, encoding: "utf8", timeout: 60000 },
  );
  const ctrlLine = String(ctrl.stdout || "")
    .split("\n")
    .find((l) => l.startsWith("__DW10__"));
  const ctrlOut = ctrlLine ? ctrlLine.slice("__DW10__".length) : "";
  if (!ctrlOut || ctrlOut === "no-throw")
    bad("DW-10z", `伪装没生效：这份 hook 没能拦住 require("node:sqlite")，DW-10a/b 是恒真`);
  else ok("DW-10z", `对照：同一份伪装下直接 require event_log 当场抛「${JSON.parse(ctrlOut).threw.split("。")[0]}」——修复前主进程死的就是这一句`);
}

console.log(`\nprove_event_dual_write: PASS=${pass} FAIL=${fail}`);
try {
  fs.rmSync(offRoot, { recursive: true, force: true });
  fs.rmSync(onRoot, { recursive: true, force: true });
} catch {
  /* 临时目录清不掉不影响结论 */
}
process.exit(fail ? 1 : 0);
