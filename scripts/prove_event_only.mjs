/* prove_event_only.mjs — T1-05 停写 JSON 门禁（EO-01..EO-07）
 *
 * 需求原文（docs/next-target-requirements.md T1-05）：
 *   停写 JSON：事件库成为三张面（sessions/rooms/approvals）的唯一真源。
 *   完成定义：BITBOT_EVENT_ONLY=1 时三张面 JSON 一个字节都不再被写；
 *   同样的操作序列，事件世界与双写世界折叠出同形的状态；遗留 JSON 经
 *   幂等导入后无缝接管；写失败喊出来（JSON 不再是备份，吞错 = 丢数据）。
 *
 * 这把尺子怎么才算「证明」了那句话：
 *
 *   EO-01 停写：EVENT_ONLY 世界跑完整个操作序列，三张面 JSON 的字节数
 *          == 操作前（存在则原样，不存在则仍不存在）。bots.json /
 *          approvals.log.jsonl 照常落盘（不在三张面里，docs/events.md §7）。
 *   EO-02 行为对照：同一串操作，EVENT_ONLY 世界与双写世界（DUAL_WRITE=1）
 *          的 fold(events) 按形状归一后逐字段相等——停写没有改变「世界是什么样」。
 *   EO-03 导入幂等：导入脚本跑两遍，第二遍 0 新增（idem_key 按
 *          文件内容哈希生成）；导入后 EVENT_ONLY 读到的状态 == 原 JSON。
 *   EO-04 遗留数据接管（读）：库空 + JSON 有内容 + EVENT_ONLY → 读 JSON
 *          + 一行横幅，且纯读不建库、不写任何东西。
 *   EO-05 遗留数据接管（写）：同上状态做一次写入 → 遗留状态被增量带进
 *          事件库（自导入），随后读事件 == 期望状态，JSON 仍一字未写。
 *   EO-06 fail loud：EVENT_ONLY + 库文件损坏 → 写入必须抛错（对照：双写
 *          世界同样的损坏是吞掉并照常写 JSON——两者的差别就是「备份在不在」）。
 *   EO-07 老运行时：没有 node:sqlite + EVENT_ONLY → 写入当场报错且说人话
 *          （EVENT_ONLY 下没有可静默的降级），读回退遗留 JSON。
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

const SURFACE_FILES = ["desktop/sessions.json", "desktop/rooms.json", "desktop/pending-approvals.jsonl"];

function makeStores(dataRoot) {
  return {
    ss: createSessionStore(ROOT, { dataRoot }),
    ps: createProductSurface(ROOT, { dataRoot }),
  };
}

function cleanupFlags() {
  delete process.env.BITBOT_EVENT_ONLY;
  delete process.env.BITBOT_EVENT_DUAL_WRITE;
  delete process.env.BITBOT_EVENT_READ;
}

/** 同一串操作，两个世界各跑一遍（EO-02 的对照序）。返回留给断言的上下文。 */
function runSequence(stores) {
  const { ss, ps } = stores;
  const ctx = {};
  ctx.a = ss.create("对照甲").session.id;
  ss.appendMessages(ctx.a, [{ role: "user", text: "第一条" }, { role: "assistant", text: "回一条" }]);
  ctx.b = ss.create("对照乙").session.id;
  ss.setActive(ctx.a);
  ss.rename(ctx.a, "对照甲·改名");
  ss.react(ctx.a, ss.get(ctx.a).session.messages[0].id, "👍", true);
  ss.remove(ctx.b);
  ctx.bot1 = ps.createBot({ name: "对照 Bot 甲" }).bot?.id;
  ctx.bot2 = ps.createBot({ name: "对照 Bot 乙" }).bot?.id;
  ctx.room = ps.roomCreate(`${ctx.bot1},${ctx.bot2}`, "对照群").room?.id;
  ps.appendRoomTranscript(ctx.room, { kind: "user", room_id: ctx.room, speaker: "u", text: "群里第一句", at: "2026-01-01T00:00:00.000Z" });
  const ap = ps.appendPendingApproval({ source: "chat", kind: "shell_exec", command: "echo hi" }).id;
  ps.approvalDecide(ap, "deny");
  const ap2 = ps.appendPendingApproval({ source: "chat", kind: "mail_send", command: "send", expires_at: new Date(Date.now() - 60000).toISOString() }).id;
  ctx.ap2 = ap2;
  return ctx;
}

/* 两个世界里「产品读到的状态」的形状归一（id/时间戳压记号，同 DW-01 的手法）。 */
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
    if (/^room-[0-9a-z-]+$/.test(v)) return "<room-id>";
    if (/^approval-[0-9a-z-]+$/.test(v)) return "<approval-id>";
    if (/^bot-[0-9a-f]+$/.test(v)) return "<bot-id>";
  }
  return v;
}

function surfaceBytes(dataRoot) {
  const out = {};
  for (const rel of SURFACE_FILES) {
    const p = path.join(dataRoot, rel);
    out[rel] = fs.existsSync(p) ? fs.readFileSync(p).toString("utf8") : null;
  }
  return out;
}

/* ===== EO-01 + EO-02：EVENT_ONLY 世界 vs 双写世界，同一串操作 ===== */
const eoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eo-on-"));
const dwRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eo-dw-"));
let eoCtx, dwCtx;
{
  cleanupFlags();
  process.env.BITBOT_EVENT_ONLY = "1";
  eventMirror.closeAllMirrors();
  eventReadModel.closeAll();
  const eoStores = makeStores(eoRoot);
  const bytesBefore = surfaceBytes(eoRoot);
  eoCtx = runSequence(eoStores);
  const bytesAfter = surfaceBytes(eoRoot);

  // EO-01：三张面一个字节都没被写
  const written = SURFACE_FILES.filter((rel) => bytesBefore[rel] !== bytesAfter[rel] ||
    (bytesBefore[rel] === null && bytesAfter[rel] !== null));
  const botsKept = fs.existsSync(path.join(eoRoot, "desktop", "bots.json"));
  const auditKept = fs.existsSync(path.join(eoRoot, "desktop", "approvals.log.jsonl"));
  if (written.length) bad("EO-01", `EVENT_ONLY 下这些三张面文件被写了：${written.join(" / ")}`);
  else if (!botsKept) bad("EO-01", "bots.json 没落盘（它不在三张面里，照常落盘才算对）");
  else if (!auditKept) bad("EO-01", "approvals.log.jsonl 没落盘（审计流水不在三张面里，照常落盘才算对）");
  else ok("EO-01", `EVENT_ONLY：三张面 JSON 零落盘（操作前 ${SURFACE_FILES.every((r) => bytesBefore[r] === null) ? "全不存在" : "已存在"} → 操作后原样），bots.json 与审计流水照常落盘`);

  // 双写世界跑同一串
  cleanupFlags();
  process.env.BITBOT_EVENT_DUAL_WRITE = "1";
  eventMirror.closeAllMirrors();
  eventReadModel.closeAll();
  dwCtx = runSequence(makeStores(dwRoot));

  // EO-02：fold(events) 按形状归一后逐字段相等（两个世界都直连 DB 折叠，
  // 不经读模型的开关——双写世界没开 READ，readSurfaces 会拒读）
  const foldOf = (dataRoot) => {
    const { openEventLog } = require("../hosts/shared/event_log.js");
    const f = path.join(dataRoot, "events", "desktop-events.sqlite");
    const h = openEventLog({ file: f, actor: "eo-compare" });
    try {
      const rows = h.readAfter({ fromSeq: 0, limit: 100000 });
      return { ...eventMirror.foldEvents(rows), count: rows.length };
    } finally {
      h.close();
    }
  };
  const rmEo = foldOf(eoRoot);
  const rmDw = foldOf(dwRoot);
  const out = [];
  eventMirror.deepDiff(skel(rmEo.sessions), skel(rmDw.sessions), "sessions", out);
  eventMirror.deepDiff(skel(rmEo.rooms), skel(rmDw.rooms), "rooms", out);
  const dwApprovals = rmDw.approvals.map((e) => ({ ...e, id: "approval-x" }));
  const eoApprovals = rmEo.approvals.map((e) => ({ ...e, id: "approval-x" }));
  eventMirror.deepDiff(skel(eoApprovals), skel(dwApprovals), "approvals", out);
  if (out.length) bad("EO-02", `两个世界的 fold 不等：${out.slice(0, 5).join(" / ")}`);
  else if (rmEo.anomalies.length || rmDw.anomalies.length) bad("EO-02", `折叠有异常：EO=${JSON.stringify(rmEo.anomalies)} DW=${JSON.stringify(rmDw.anomalies)}`);
  else ok("EO-02", `同一串操作：EVENT_ONLY 世界（${rmEo.count} 事件）与双写世界（${rmDw.count} 事件）折叠出的三张面按形状归一后逐字段相等`);
}

/* ===== EO-03：导入幂等 + 导入后 EVENT_ONLY 无缝接管 ===== */
{
  // 用双写世界的 JSON（dwRoot）当遗留数据，导进一个只有库没有 JSON 的新 root？
  // 不——导入的方向是「有 JSON、有库、库空」。构造：把 dwRoot 的三个 JSON 拷进
  // impRoot，再用导入脚本灌进 impRoot 的事件库（脚本要求库存在，先开一次双写播种空库）。
  const impRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eo-imp-"));
  for (const rel of SURFACE_FILES) {
    const src = path.join(dwRoot, rel);
    const dst = path.join(impRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
  // 建一个空库（EVENT_ONLY 下读一次即播种？不行——那会写进种子会话。
  // 用 openEventLog 直接建库：库在、0 事件，正是「导入前」的状态。）
  const { openEventLog } = require("../hosts/shared/event_log.js");
  const boot = openEventLog({ file: path.join(impRoot, "events", "desktop-events.sqlite"), actor: "imp-boot" });
  boot.close();

  const run = (extra) => spawnSync(process.execPath, ["scripts/import_json_to_events.mjs", "--dataRoot", impRoot, ...(extra || [])], {
    cwd: ROOT, encoding: "utf8", timeout: 120000,
  });
  const r1 = run();
  const r2 = run();
  const parse = (t) => {
    const m = String(t).match(/新增 (\d+)，重复 (\d+)/);
    return m ? { added: Number(m[1]), dup: Number(m[2]) } : null;
  };
  const s1 = parse(r1.stdout);
  const s2 = parse(r2.stdout);
  if (!s1 || !r1.stdout.includes("新增 0，重复 0") === false) { /* 占位，下面统一判 */ }
  if (r1.status !== 0) bad("EO-03", `导入第一遍就失败：${String(r1.stderr).slice(0, 200)}`);
  else if (!s1 || s1.added === 0) bad("EO-03", `第一遍导入 0 条新增（${r1.stdout.trim().split("\n").pop()}）——导入没干活`);
  else if (!s2 || s2.added !== 0 || s2.dup !== s1.added) bad("EO-03", `第二遍导入不幂等：第一遍 ${JSON.stringify(s1)}，第二遍 ${JSON.stringify(s2)}（应 0 新增、全部撞键）`);
  else {
    // 导入后 EVENT_ONLY 读到的状态 == 原 JSON（直接比 fold 与磁盘，不走派生视图）
    cleanupFlags();
    process.env.BITBOT_EVENT_ONLY = "1";
    eventMirror.closeAllMirrors();
    eventReadModel.closeAll();
    const hit = eventReadModel.readSurfaces(impRoot);
    const diskSess = JSON.parse(fs.readFileSync(path.join(impRoot, "desktop/sessions.json"), "utf8"));
    const diskRooms = JSON.parse(fs.readFileSync(path.join(impRoot, "desktop/rooms.json"), "utf8"));
    const out = [];
    eventMirror.deepDiff(skel(diskSess), skel(hit.sessions), "sessions", out);
    eventMirror.deepDiff(skel(diskRooms), skel(hit.rooms), "rooms", out);
    if (!hit.ok) bad("EO-03", `导入后读模型不可用：${JSON.stringify(hit).slice(0, 200)}`);
    else if (out.length) bad("EO-03", `导入后 EVENT_ONLY 读到的状态与原 JSON 不等：${out.slice(0, 4).join(" / ")}`);
    else if (hit.anomalies.length) bad("EO-03", `导入后的库折出异常：${hit.anomalies[0]}`);
    else ok("EO-03", `导入幂等：第一遍 ${s1.added} 条新增，第二遍 0 新增 / ${s2.dup} 全部撞键；导入后 EVENT_ONLY 读到的 sessions/rooms 与原 JSON 逐字段相等（id/时间戳按形状归一）`);
  }
  fs.rmSync(impRoot, { recursive: true, force: true });
}

/* ===== EO-04 + EO-05：遗留数据接管（读不写、写自导入） ===== */
{
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eo-legacy-"));
  // 用双写世界的最终 JSON 当遗留数据
  for (const rel of SURFACE_FILES) {
    const src = path.join(dwRoot, rel);
    const dst = path.join(legacyRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
  cleanupFlags();
  process.env.BITBOT_EVENT_ONLY = "1";
  eventMirror.closeAllMirrors();
  eventReadModel.closeAll();

  const lines = [];
  const origWrite = process.stderr.write;
  process.stderr.write = (c) => { lines.push(String(c)); return true; };
  let listed = null;
  try {
    const { ss, ps } = makeStores(legacyRoot);
    listed = { sessions: ss.list(), rooms: ps.loadRooms() };
  } finally {
    process.stderr.write = origWrite;
  }
  const noDb = !fs.existsSync(path.join(legacyRoot, "events"));
  const said = lines.join("").includes("遗留 sessions.json");
  const dwSessCount = eventReadModel.readSurfaces(dwRoot).sessions.sessions.length;
  if (listed.sessions.sessions.length !== dwSessCount) bad("EO-04", `遗留读不对：EO 读到 ${listed.sessions.sessions.length} 个会话，双写世界有 ${dwSessCount} 个`);
  else if (!noDb) bad("EO-04", "纯读把事件库建出来了");
  else if (!said) bad("EO-04", `没打遗留横幅：${lines.join("").slice(0, 200)}`);
  else ok("EO-04", `库空 + 遗留 JSON + EVENT_ONLY：读到全部 ${dwSessCount} 个会话与 rooms，一行横幅说清「暂以 JSON 为读真源」，纯读没有建库`);

  // EO-05：写一次 → 自导入
  const bytesBefore = surfaceBytes(legacyRoot);
  const { ss } = makeStores(legacyRoot);
  const newId = ss.create("EO-05 新会话").session.id;
  const bytesAfter = surfaceBytes(legacyRoot);
  const rmEo = eventReadModel.readSurfaces(legacyRoot);
  const titles = rmEo.ok ? rmEo.sessions.sessions.map((s) => s.title) : [];
  const unchanged = SURFACE_FILES.every((rel) => bytesBefore[rel] === bytesAfter[rel]);
  const changedFiles = SURFACE_FILES.filter((rel) => bytesBefore[rel] !== bytesAfter[rel]);
  if (!rmEo.ok) bad("EO-05", `写入后读不到事件：${JSON.stringify(rmEo).slice(0, 160)}`);
  else if (!titles.includes("EO-05 新会话") || !titles.includes("对照甲·改名")) bad("EO-05", `自导入不完整：${titles.join("|")}`);
  else if (rmEo.anomalies.length) bad("EO-05", `自导入产生折叠异常：${rmEo.anomalies[0]}`);
  else if (!unchanged) bad("EO-05", `自导入顺带写了 JSON（违背停写）：${changedFiles.map((rel) => rel + " " + (bytesBefore[rel] === null ? "(none→" + bytesAfter[rel].length + "B)" : bytesBefore[rel].length + "→" + bytesAfter[rel].length + "B")).join(", ")}`);
  else if (ss.list().sessions.length !== dwSessCount + 1) bad("EO-05", `写后读不对：${ss.list().sessions.length}（期望 ${dwSessCount + 1}）`);
  else if (ss.get(newId).session?.title !== "EO-05 新会话") bad("EO-05", "新会话读不回来");
  else ok("EO-05", `首次写入把遗留状态增量带进事件库（自导入）：${rmEo.count} 条事件、无异常，会话 ${dwSessCount}→${dwSessCount + 1}，JSON 仍一字未写`);
}

/* ===== EO-06：EVENT_ONLY + 库坏 → 写入必须喊出来 ===== */
{
  const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eo-bad-"));
  cleanupFlags();
  process.env.BITBOT_EVENT_ONLY = "1";
  eventMirror.closeAllMirrors();
  eventReadModel.closeAll();
  // 先让库正常存在，再把它写坏
  const { ss: ssSeed } = makeStores(badRoot);
  ssSeed.list();
  eventMirror.closeAllMirrors();
  eventReadModel.closeAll();
  fs.writeFileSync(path.join(badRoot, "events", "desktop-events.sqlite"), Buffer.from("not a database at all......"));
  const { ss } = makeStores(badRoot);
  let threw = null;
  try {
    ss.create("库坏了也要知道").session.id;
  } catch (err) {
    threw = String((err && err.message) || err);
  }
  if (!threw) bad("EO-06", "EVENT_ONLY + 库坏，写入没抛错（吞错 = 静默丢数据——JSON 已不是备份）");
  else ok("EO-06", `库文件损坏：EVENT_ONLY 的写入当场抛「${threw.slice(0, 80)}」——对照双写世界的吞错，差别就是备份在不在`);
}

/* ===== EO-07：老运行时（没有 node:sqlite）EVENT_ONLY 写入报错且说人话 ===== */
{
  const PROBE = `
const Module = require("module");
const fs = require("fs");
const path = require("path");
const ROOT = process.env.EO7_REPO;
const dataRoot = process.env.EO7_DATA;
const orig = Module._load;
Module._load = function (request, ...rest) {
  if (request === "node:sqlite") {
    const err = new Error("Cannot find module 'node:sqlite'");
    err.code = "MODULE_NOT_FOUND";
    throw err;
  }
  return orig.call(this, request, ...rest);
};
process.env.BITBOT_EVENT_ONLY = "1";
let readOk = null, writeThrew = null, said = false;
const lines = [];
const ow = process.stderr.write;
process.stderr.write = (c) => { lines.push(String(c)); return true; };
try {
  const { createSessionStore } = require(path.join(ROOT, "hosts/desktop/sessions.js"));
  // 先放好遗留 JSON 再读（老运行时没有库，纯读走遗留路）
  fs.mkdirSync(path.join(dataRoot, "desktop"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "desktop", "sessions.json"), JSON.stringify({ version: 1, active_id: "s1", sessions: [{ id: "s1", title: "老运行时的会话", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", messages: [] }] }, null, 2));
  const ss = createSessionStore(ROOT, { dataRoot });
  const listed = ss.list();
  readOk = listed.sessions.length === 1 && listed.sessions[0].title === "老运行时的会话";
  try { ss.create("写不进").session.id; } catch (err) { writeThrew = String((err && err.message) || err); }
} catch (err) {
  writeThrew = writeThrew || ("outer: " + String((err && err.message) || err));
}
process.stderr.write = ow;
said = lines.join("").includes("已降级为不写") || lines.join("").includes("EVENT_ONLY");
console.log("__EO7__" + JSON.stringify({ readOk, writeThrew, said }));
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eo7-"));
  const r = spawnSync(process.execPath, ["-e", PROBE], {
    env: { ...process.env, EO7_REPO: ROOT, EO7_DATA: dir },
    encoding: "utf8",
    timeout: 120000,
  });
  const line = String(r.stdout || "").split("\n").find((l) => l.startsWith("__EO7__"));
  const out = line ? JSON.parse(line.slice("__EO7__".length)) : null;
  if (!out) bad("EO-07", `探针子进程没出结果：${String(r.stderr || "").slice(0, 160)}`);
  else if (!out.readOk) bad("EO-07", "老运行时 EVENT_ONLY 连遗留 JSON 都读不到");
  else if (!out.writeThrew) bad("EO-07", "老运行时 EVENT_ONLY 的写入没报错（静默丢数据）");
  else if (!out.said) bad("EO-07", "报错了但没说人话");
  else ok("EO-07", `没有 node:sqlite + EVENT_ONLY：遗留 JSON 读得到（${out.readOk ? "1 会话" : "?"}），写入当场抛「${String(out.writeThrew).slice(0, 60)}」且说清这是 EVENT_ONLY 的硬失败`);
  fs.rmSync(dir, { recursive: true, force: true });
}

/* 收尾：开关全部恢复默认关 */
cleanupFlags();
eventReadModel.closeAll();
eventMirror.closeAllMirrors();

console.log(`\nprove_event_only: PASS=${pass} FAIL=${fail}`);
try {
  fs.rmSync(eoRoot, { recursive: true, force: true });
  fs.rmSync(dwRoot, { recursive: true, force: true });
} catch {
  /* 临时目录清不掉不影响结论 */
}
process.exit(fail ? 1 : 0);
