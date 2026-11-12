#!/usr/bin/env node
"use strict";
/* KP-09 片1..3：事件面只剩一个写者、读写同源，且多进程写同一张面不许互相抹掉。
 *
 * 先有的红（修复前实测，临时 dataRoot、真代码路径，见 §8.123）：
 *   EVENT_ONLY 下删 Bot 的级联自己 readJson + atomicWrite sessions.json，
 *   而这张面在 EVENT_ONLY 里唯一的真源是事件库 —— 于是它读的是一份永不更新的
 *   陈旧副本：`sessions_deleted=0`、`sessions_cascaded=false`，Bot 从列表里没了，
 *   它的 DM 会话在侧栏与事件 fold 里都还在，而且一声不吭。
 *   JSON 模式看着"没毛病"只是因为那条路恰好每次调用都重新 load 文件。
 *
 * 覆盖：
 *   SW-01 JSON 模式级联三面一致（回执 / store / 盘上文件都不再有那条 DM）
 *   SW-02 唯一写者（静态账）：除了 sessions store，产品代码里不许再有写
 *          sessions.json 的调用点 —— 这条是 KP-09 的棘轮，数字只许降不许升
 *   SW-03 EVENT_ONLY 级联：store 与事件 fold 都没那条 DM、且 fold 无 anomalies
 *          （修复前这条必红，且红在"幽灵会话还在"）
 *   SW-04 级联不许扩大打击面：非 DM 标题的会话仍在
 *   SW-05 读写同源：一个进程里同一 dataRoot 只有一个 store 实例，
 *          surface 的 Bot 详情读的就是 store 刚写的那张面（陈旧副本再也骗不到人）
 *   SW-06 读侧同账（片2，path-aware）：除了面的持有者，产品代码里不许再有
 *          直接读事件面文件的调用点；多一层目录的（data/voice/sessions.json）不是面
 *   SW-07 定时任务→邮件端到端（EVENT_ONLY）：邮件正文取到群里的 final_report
 *          （修复前它读盘上 rooms.json，那张面在 EVENT_ONLY 里根本没有文件 → 正文只剩任务原话）
 *   SW-08 前提自证：SW-07 的场景里 rooms.json 确实不在盘上（否则 SW-07 什么都没证明）
 *   SW-09 反向对照：盘上放一份写着**另一种稿子**的遗留 rooms.json，
 *          邮件正文仍取事件里的 —— 证明 SW-07 认的是读源，不是恰好没文件
 *   SW-NEG 反向对照：拿"旧写法"（绕过 store 直写 JSON）做同样的级联，
 *          事件 fold 必须仍然留着那条 DM —— 证明 SW-03 认的是写者，不是运气
 *   SW-NEGR 尺子的反向对照：拿修复前 host_ffi 那行原样读法 + voice 诱饵做夹具，
 *          尺子必须点中旁路、且不把 data/voice/sessions.json 误判成面
 *
 *   —— 片3（多进程写同一张面，先有的红都在临时 dataRoot + 真代码路径）——
 *   SW-10 3 个真进程同时冷启同一个空事件库、各写 12 条待批准：必须 36 行全折回。
 *          修前两种红：①事件库开不了（`database is locked`，busy_timeout 排在 WAL 之后 +
 *          deferred 迁移撞车）→ 那一侧整批动作没了；②审批追加的双读 prev → diff 派出一串
 *          entity_removed 把**别的进程刚写的行**从唯一真源删掉，子进程零报错、fold 少 1~6 行
 *   SW-11 同一毫秒里 3 个进程各写 bots.json：不许有 ENOENT rename（tmp 名带 pid 之前的实测）
 *   SW-12 残账，不判绿红：3 进程各建 3 个群，事件 fold 里剩几个（store 面仍是跨进程多写者）
 *   SW-13 tmp 命名静态账（棘轮，只许降）+ 旧写法夹具反向对照
 *   SW-14 开库并发四件事静态账（busy 先于 WAL / IMMEDIATE / 无 deferred / 撞车重读版本）+ 旧顺序夹具
 *
 * 全部跑在临时目录，绝不碰仓库里的 data/。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { getSessionStore } = require(path.join(REPO, "hosts/desktop/sessions.js"));
const { createProductSurface } = require(path.join(REPO, "hosts/desktop/product_surface.js"));
const eventMirror = require(path.join(REPO, "hosts/desktop/event_mirror_ref.js")).loadEventMirror();
const eventReadModel = require(path.join(REPO, "hosts/shared/event_read_model.js"));
const eventMirrorMod = require(path.join(REPO, "hosts/shared/event_mirror.js"));
const { createHostFfi } = require(path.join(REPO, "hosts/shared/host_ffi.js"));

let PASS = 0;
let FAIL = 0;
let swWriters = [];
let swStoreWriters = 0;
let swReaders = 0;
let xpRows = 0, xpPrefixes = 0, xpStoreRooms = 0, xpTmpSites = 0, xpTmpBad = -1, xpOrderBad = -1, xpKidsOk = false;
const ok = (id, msg) => { PASS++; console.log(`  ✓ ${id} ${msg}`); };
const bad = (id, msg, extra) => { FAIL++; console.log(`  ✗ ${id} ${msg}${extra ? " — " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : ""}`); };

function freshRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kp09-${tag}-`));
  const dataRoot = path.join(root, "data");
  fs.mkdirSync(path.join(dataRoot, "desktop"), { recursive: true });
  return { root, dataRoot };
}

/** 建一个 Bot + 它的 DM 会话（会话由 store 自己创建，和渲染端一样），再落一句话。 */
function seed(root, dataRoot, store, surface) {
  const bot = surface.botsCreate({ name: "级联尺子", job: "", description: "" }).bot;
  const sess = store.create(bot.name + " · DM").session;
  store.appendMessages(sess.id, [{ role: "user", text: "级联前落的一句" }]);
  // 另一条不属于任何 Bot 的普通会话：级联不许把它一起删掉
  const other = store.create("我的其它对话").session;
  return { bot, sess, other };
}

function fold(dataRoot) {
  return eventReadModel.readSurfaces(dataRoot, process.env);
}

/** 关掉镜像句柄，让下一个阶段从自己的 dataRoot 重新开库。 */
function closeMirrors() {
  try { eventMirrorMod.closeAllMirrors(); } catch (_) { /* 没开过库时无所谓 */ }
}

/* ===== 读侧尺子（SW-06 / SW-NEGR）=====
   一张事件面在 EVENT_ONLY 里的真源是事件库，落盘文件永不更新：任何直接 readFileSync
   这张面文件的代码，读到的都是陈旧副本。所以「面只有一个持有者」这条纪律，
   读侧也要算账 —— 而且这把尺子必须 path-aware：
   hosts/shared/host_ffi.js 里的 data/desktop/voice/sessions.json 是**录音面**，
   不是会话面（上一轮按文件名扫把它误判过一次，这条规则就是从那次误判来的）。 */
const FACE_OWNER = {
  "rooms.json": "hosts/desktop/product_surface.js",
  "sessions.json": "hosts/desktop/sessions.js",
  "pending-approvals.jsonl": "hosts/desktop/product_surface.js",
};
const READ_CALL_RE = /(fs\.readFileSync|readJson|fs\.existsSync)\s*\(/;

function joinExprs(line) {
  const out = [];
  const key = "path.join(";
  for (let i = line.indexOf(key); i >= 0; i = line.indexOf(key, i + 1)) {
    let depth = 0;
    for (let j = i + key.length - 1; j < line.length; j += 1) {
      const c = line[j];
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) { out.push(line.slice(i, j + 1)); i = j; break; }
      }
    }
  }
  return out;
}

function constsOf(text) {
  const m = new Map();
  const re = /const\s+([A-Za-z0-9_$]+)\s*=\s*(path\.(?:join|resolve)\([\s\S]*?\)\s*);/g;
  let hit;
  while ((hit = re.exec(text))) m.set(hit[1], hit[2]);
  return m;
}

function segs(expr, consts, depth) {
  const out = [];
  const inner = expr.replace(/^path\.(?:join|resolve)\s*\(\s*/, "").replace(/\)\s*$/, "");
  for (let part of inner.split(",")) {
    part = part.trim();
    if (!part) continue;
    const lit = part.match(/^["'](.+?)["']$/);
    if (lit) { out.push(lit[1]); continue; }
    if (/^["']/.test(part)) { out.push(part.replace(/["']/g, "")); continue; }
    if (depth < 5 && consts.has(part)) { out.push(...segs(consts.get(part), consts, depth + 1)); continue; }
    out.push("<" + part + ">");
  }
  return out;
}

/** 展开后的路径段 → 命中的事件面（多一层目录的不算面，如 desktop/voice/sessions.json） */
function faceFromSegs(s) {
  const last = s[s.length - 1];
  if (!Object.prototype.hasOwnProperty.call(FACE_OWNER, last)) return null;
  const parent = String(s[s.length - 2] || "");
  if (parent === "desktop" || /(^|\/)desktop$/.test(parent)) return last;
  return null;
}

function scanReadBypass(rel, text) {
  const consts = constsOf(text);
  const hits = [];
  let inBlock = false;
  text.split("\n").forEach((line, i) => {
    if (inBlock) { if (line.includes("*/")) inBlock = false; return; }
    const open = line.indexOf("/*");
    if (open >= 0 && line.indexOf("*/", open + 2) < 0) { inBlock = true; return; }
    const t = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "").trim();
    if (!t || t.startsWith("*") || t.startsWith("//")) return;
    if (!READ_CALL_RE.test(t)) return;
    const found = new Set();
    for (const j of joinExprs(t)) {
      const f = faceFromSegs(segs(j, consts, 0));
      if (f) found.add(f);
    }
    for (const name of (t.match(/\b[A-Z][A-Z0-9_]*\b/g) || [])) {
      if (!consts.has(name)) continue;
      const f = faceFromSegs(segs(consts.get(name), consts, 0));
      if (f) found.add(f);
    }
    for (const f of found) if (rel !== FACE_OWNER[f]) hits.push({ face: f, line: i + 1, code: t.slice(0, 120) });
  });
  return hits;
}

function listHostJs() {
  const out = [];
  for (const dir of ["hosts/desktop", "hosts/shared", "hosts/cli_host", "hosts/mobile_host"]) {
    const p = path.join(REPO, dir);
    if (!fs.existsSync(p)) continue;
    for (const name of fs.readdirSync(p)) if (name.endsWith(".js")) out.push(path.posix.join(dir, name));
  }
  return out;
}

/* ===== 定时任务 → 邮件这一段（SW-07/08/09）===== */
async function fireRoutineMail(ffi, id, prompt) {
  await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: `${id}|0 9 * * *|${prompt}` }],
    { sessionId: "kp09-sw07" },
  );
  return id;
}

function patchRoutineRoom(dataRoot, id, roomId) {
  const p = path.join(dataRoot, "routines", "host-routines.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.routines || [];
  const hit = rows.find((r) => r && r.id === id);
  if (hit) hit.room_id = roomId;
  fs.writeFileSync(p, JSON.stringify(Array.isArray(raw) ? rows : raw, null, 2));
  return !!hit;
}

async function runRoutineFire(ffi, id) {
  const res = await ffi.executeHostEffects([{ kind: "routine_fire", command: id }], { sessionId: "kp09-sw07" });
  return (res || []).find((x) => x && x.kind === "routine_fire");
}

/** EVENT_ONLY 下 pending-approvals 也是事件面：读它得折事件库，不能读 jsonl 文件。 */
function queuedRoutineMail(dataRoot) {
  const hit = eventReadModel.readSurfaces(dataRoot, process.env);
  const a = hit.approvals;
  const rows = Array.isArray(a) ? a : ((a && a.approvals) || []);
  return rows.filter((e) => e && e.kind === "mail_send" && e.source === "routine");
}

/* ===== 片3（多进程）的尺子 ===== */

/**
 * tmp 文件名的构造行必须带 process.pid。
 * 只带 Date.now() 时，同一毫秒里两个进程（桌面主进程 + 定时守护 run_turn.js）
 * 给同一张面算出**同一个** tmp 名：先 rename 的那家把文件搬走，后一家
 * renameSync 直接 ENOENT —— 用户那次「建 Bot / 建群」整个抛错（实测 3 进程冷启 2/3 挂）。
 * 注释行不算：这把尺子和 SW-02 一样，先把注释剥掉再判。
 */
function tmpNameViolations(texts) {
  const bad = [];
  for (const t of texts) {
    t.text.split("\n").forEach((line, i) => {
      const s = line.trim();
      if (!s || s.startsWith("//") || s.startsWith("*") || s.startsWith("/*")) return;
      if (!/\.tmp\./.test(s)) return;
      if (!/tmp\s*=|tmp=\$\{/.test(s) && !/writeFileSync|renameSync/.test(s)) return;
      if (/process\.pid/.test(s)) return;
      bad.push(`${t.name}:${i + 1}`);
    });
  }
  return bad;
}

/**
 * openEventLog 的冷启并发四件事，缺一条就是「另一个进程正在建库时我打不开库」：
 *   1) busy_timeout 必须排在 journal_mode 之前（改 WAL 要拿写锁，顺序反了 SQLITE_BUSY 当场抛）；
 *   2) 迁移用 BEGIN IMMEDIATE（deferred 的 BEGIN 到 CREATE 才升级，升级失败不排队）；
 *   3) 不许留 deferred 的 db.exec("BEGIN;")；
 *   4) 迁移撞「already exists」时重读版本，版本到位就当别人做过了。
 */
function openOrderViolations(text) {
  const at = text.indexOf("function openEventLog");
  if (at < 0) return ["找不到 openEventLog（尺子失效）"];
  const body = text.slice(at, at + 4000);
  const iBusy = body.indexOf("PRAGMA busy_timeout");
  const iWal = body.indexOf("PRAGMA journal_mode = WAL");
  const v = [];
  if (!(iBusy >= 0 && iWal >= 0 && iBusy < iWal)) v.push("busy_timeout 不在 journal_mode 之前");
  if (!/BEGIN IMMEDIATE;/.test(body)) v.push("迁移不是 BEGIN IMMEDIATE");
  if (/db\.exec\("BEGIN;"\)/.test(body)) v.push("还留着 deferred 的 BEGIN");
  if (!(/already exists/i.test(body) && /readLogVersion\(db\)\s*>=\s*m\.id/.test(body)))
    v.push("迁移撞车后没有「重读版本再认」的容忍路");
  return v;
}

/** 子进程要跑的脚本：真代码路径，EVENT_ONLY，往三张面各写一批。 */
function xpChildSource() {
  const q = JSON.stringify(REPO);
  return [
    '"use strict";',
    "const path=require('path');",
    "const dataRoot=process.argv[2];",
    "const n=Number(process.argv[3]||12);",
    "process.env.BITBOT_EVENT_ONLY='1';",
    `const R=${q};`,
    "const {getSessionStore}=require(path.join(R,'hosts/desktop/sessions.js'));",
    "const {createProductSurface}=require(path.join(R,'hosts/desktop/product_surface.js'));",
    "const tag='kid'+process.pid;",
    "const out={tag,appr:0,bots:0,rooms:0,errs:[]};",
    "try{",
    "  const store=getSessionStore(dataRoot,{dataRoot});",
    "  const s=createProductSurface(dataRoot,{dataRoot,sessions:store});",
    "  // 每条都换一个**新的 surface 实例**：prev 缓存按实例算，一个实例只有第一条写才走「冷启读」，",
    "  // 3 进程 × 1 个窗口抓不到什么；换成每进程 n 个窗口才有稳定的红（KP-09 片3 的尺子）。",
    "  for(let i=0;i<n;i++){const sN=createProductSurface(dataRoot,{dataRoot,sessions:store});sN.appendPendingApproval({source:'chat',kind:'shell',command:tag+'|x'+i});out.appr++;}",
    "  const b1=s.botsCreate({name:tag+'-甲',model:'m'}).bot;",
    "  const b2=s.botsCreate({name:tag+'-乙',model:'m'}).bot;",
    "  out.bots=(b1&&b2)?2:0;",
    "  for(let i=0;i<3;i++){",
    "    const r=s.roomCreate([b1.id,b2.id].join(','),tag+'-群'+i);",
    "    const id=(r&&r.room&&r.room.id)||(r&&r.id);",
    "    if(id){s.appendRoomTranscript(id,{kind:'final_report',text:tag+' 的成稿',bot_id:b1.id});out.rooms++;}",
    "  }",
    "}catch(e){out.errs.push(String((e&&e.message)||e).slice(0,200));}",
    "process.stdout.write(JSON.stringify(out)+'\\n');",
  ].join("\n");
}

function spawnXpChild(childPath, dataRoot, n) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [childPath, dataRoot, String(n)], { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    let eb = "";
    p.stdout.on("data", (c) => { buf += String(c); });
    p.stderr.on("data", (c) => { eb += String(c); });
    p.on("error", (e) => res({ code: -1, out: "", err: String((e && e.message) || e) }));
    p.on("close", (code) => res({ code, out: buf, err: eb }));
  });
}

async function main() {
  /* ===== SW-01 / SW-04 / SW-05：JSON 模式（今天的默认） ===== */
  {
    delete process.env.BITBOT_EVENT_ONLY;
    const { root, dataRoot } = freshRoot("json");
    const store = getSessionStore(root, { dataRoot });
    const surface = createProductSurface(root, { dataRoot, sessions: store });
    const { bot, sess, other } = seed(root, dataRoot, store, surface);

    const detailBefore = surface.botDetail(bot.id);
    const r = surface.botsDelete(bot.id, "yes");
    const disk = JSON.parse(fs.readFileSync(path.join(dataRoot, "desktop", "sessions.json"), "utf8"));
    const listIds = (store.list().sessions || []).map((s) => s.id);
    const diskIds = (disk.sessions || []).map((s) => s.id);

    if (r.ok === true && r.sessions_deleted === 1 && r.sessions_cascaded === true)
      ok("SW-01", `JSON 模式级联真删了 1 条 DM（回执 sessions_deleted=${r.sessions_deleted}）`);
    else bad("SW-01", "JSON 模式级联没删对", { ok: r.ok, sessions_deleted: r.sessions_deleted, deferred: r.sessions_cascade_deferred });

    if (!listIds.includes(sess.id) && !diskIds.includes(sess.id))
      ok("SW-01b", "store 与盘上文件两面一致：那条 DM 真的不在了");
    else bad("SW-01b", "删掉的 DM 会话还在某一面里", { store: listIds.includes(sess.id), disk: diskIds.includes(sess.id) });

    if (listIds.includes(other.id) && diskIds.includes(other.id))
      ok("SW-04", `级联没扩大打击面：「${other.title}」仍在（会话面按 DM 标题精确匹配）`);
    else bad("SW-04", "级联把无关会话一起删了", { other: other.id, listIds });

    // SW-05 读写同源：Bot 详情里的会话数在删除前必须是 1（同一张面，不是陈旧副本）
    const cnt = detailBefore && detailBefore.sessions_total;
    if (store.list().sessions.length === 2 && getSessionStore(root, { dataRoot }) === store && cnt === 1)
      ok("SW-05", `同进程同 dataRoot 只有一个 store 实例；删除前 Bot 详情读到 session_count=${cnt}`);
    else bad("SW-05", "store 实例没收口，或 Bot 详情读的不是 store 刚写的那张面",
      { rows: store.list().sessions.length, same_instance: getSessionStore(root, { dataRoot }) === store, session_count: cnt });
  }

  /* ===== SW-03：EVENT_ONLY（真源是事件库） ===== */
  if (process.env.NEG_CONTROL !== "1") {
    process.env.BITBOT_EVENT_ONLY = "1";
    const { root, dataRoot } = freshRoot("eo");
    const store = getSessionStore(root, { dataRoot });
    const surface = createProductSurface(root, { dataRoot, sessions: store });
    const { bot, sess, other } = seed(root, dataRoot, store, surface);
    const r = surface.botsDelete(bot.id, "yes");
    closeMirrors();

    const fh = fold(dataRoot);
    const foldIds = ((fh.sessions && fh.sessions.sessions) || []).map((s) => s.id);
    const listIds = (store.list().sessions || []).map((s) => s.id);
    if (r.ok === true && r.sessions_deleted === 1)
      ok("SW-03a", `EVENT_ONLY 下级联真删 1 条（修复前实测 sessions_deleted=0：它读的是永不更新的陈旧 JSON）`);
    else bad("SW-03a", "EVENT_ONLY 下级联又变成空操作", { ok: r.ok, sessions_deleted: r.sessions_deleted, deferred: r.sessions_cascade_deferred });

    if (fh.ok && !fh.anomalies.length && !foldIds.includes(sess.id) && foldIds.includes(other.id))
      ok("SW-03", `事件 fold 里那条 DM 没了、别的会话在、无 anomalies（${fh.count} 条事件）`);
    else bad("SW-03", "事件库还留着被删的 DM（幽灵会话）或 fold 记账异常",
      { ok: fh.ok, anomalies: fh.anomalies, ghost: foldIds.includes(sess.id), kept_other: foldIds.includes(other.id) });

    if (!listIds.includes(sess.id))
      ok("SW-03b", `store 读到的与 fold 折出来的是同一张面（侧栏不会再把它画回来）`);
    else bad("SW-03b", "store 仍返回被删的 DM", { listIds });
    closeMirrors();
    delete process.env.BITBOT_EVENT_ONLY;
  }

  /* ===== SW-NEG：旧写法必须被 SW-03 那把尺子照出来 ===== */
  if (process.env.NEG_CONTROL === "1") {
    process.env.BITBOT_EVENT_ONLY = "1";
    const { root, dataRoot } = freshRoot("neg");
    const store = getSessionStore(root, { dataRoot });
    const surface = createProductSurface(root, { dataRoot, sessions: store });
    const { bot, sess } = seed(root, dataRoot, store, surface);
    closeMirrors();

    /* 复刻修复前那条绕过 store 的写法：读 JSON、剔掉 DM、再写回 JSON。
       EVENT_ONLY 下真源是事件库，这一写不改库 —— 正是今天红的原因。 */
    const sp = path.join(dataRoot, "desktop", "sessions.json");
    const cur = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, "utf8")) : { version: 1, active_id: "", sessions: [] };
    cur.sessions = (cur.sessions || []).filter((s) => s.id !== sess.id);
    fs.writeFileSync(sp, JSON.stringify(cur, null, 2));
    const fh = fold(dataRoot);
    const foldIds = ((fh.sessions && fh.sessions.sessions) || []).map((s) => s.id);
    if (foldIds.includes(sess.id))
      ok("SW-NEG", "旧写法（直写 JSON）被这把尺子照出来了：事件 fold 里那条 DM 还在 —— SW-03 认的是写者");
    else bad("SW-NEG", "反向对照失效：绕过 store 直写 JSON 也能让事件 fold 少一条，SW-03 是恒真断言", { foldIds });
    closeMirrors();
    delete process.env.BITBOT_EVENT_ONLY;
  }

  /* ===== SW-02：唯一写者（静态账，KP-09 的棘轮） ===== */
  {
    const dirs = [path.join(REPO, "hosts/desktop"), path.join(REPO, "hosts/shared")];
    const writers = [];
    for (const dir of dirs) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".js")) continue;
        const p = path.join(dir, name);
        const text = fs.readFileSync(p, "utf8");
        const lines = text.split("\n");
        let inBlock = false;
        lines.forEach((line, i) => {
          /* 注释里的 atomicWrite(SESSIONS_PATH) 不是写点：不剥掉注释，
             这把尺子会把「解释旧写法」的行判成旧写法本身（本轮实测踩过一次）。 */
          if (inBlock) {
            if (line.includes("*/")) inBlock = false;
            return;
          }
          const openBlock = line.indexOf("/*");
          if (openBlock >= 0 && line.indexOf("*/", openBlock + 2) < 0) { inBlock = true; return; }
          const t = line.replace(/\/\*.*?\*\//g, "").trim();
          if (t.startsWith("//") || t.startsWith("*")) return;
          /* 只有「写函数 + 目标这张面」才算写点：读（existsSync/readFileSync）
             与路径声明都不是 —— 否则这条棘尺子会把读点也记成写者。 */
          const isWriteCall = /fs\.writeFileSync\s*\(/.test(line) ||
            /atomicWrite\s*\(/.test(line) ||
            /writeStore\s*\(/.test(line) ||
            /fs\.renameSync\s*\([^,]*,\s*(SESSIONS_PATH|storePath)/.test(line);
          if (!isWriteCall) return;
          const targetsSessionsFace = /SESSIONS_PATH/.test(line) ||
            (/writeStore|atomicWrite\s*\(\s*storePath/.test(line)) ||
            /"sessions\.json"|'sessions\.json'/.test(line);
          if (!targetsSessionsFace) return;
          writers.push(`${path.relative(REPO, p)}:${i + 1}`);
        });
      }
    }
    swWriters = writers.slice();
    swStoreWriters = writers.filter((w) => w.startsWith("hosts/desktop/sessions.js")).length;
    const onlyStore = writers.length > 0 && swStoreWriters === writers.length;
    if (writers.length > 0 && onlyStore)
      ok("SW-02", `sessions.json 的写点全在 sessions store（${writers.length} 处：${writers.join(", ")}）—— KP-09 棘轮，只许降`);
    else bad("SW-02", "还有绕过 store 直写 sessions.json 的地方（或一条都没扫到，尺子失效）", { writers });
  }

  /* ===== SW-06：读侧账（静态、path-aware） ===== */
  {
    const files = listHostJs();
    const bypass = [];
    for (const rel of files) {
      for (const h of scanReadBypass(rel, fs.readFileSync(path.join(REPO, rel), "utf8"))) {
        bypass.push(`${rel}:${h.line}→${h.face}`);
      }
    }
    swReaders = bypass.length;
    if (bypass.length === 0)
      ok("SW-06", `三张事件面的读点全在面的持有者里（扫 ${files.length} 个文件，旁路 0 处）—— KP-09 读侧棘轮`);
    else bad("SW-06", "还有直接读事件面文件的地方（EVENT_ONLY 下那是一份永不更新的陈旧副本）", { bypass });
  }

  /* ===== SW-NEGR：读侧尺子自己的反向对照 =====
     夹具 = 修复前 host_ffi 那行原样读法 + 录音面诱饵 + 面持有者自己的合法读法。
     尺子必须点中旁路、放过诱饵、也放过持有者 —— 否则 SW-06 的 0 是恒真。 */
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kp09-ruler-"));
    const badRel = "hosts/shared/host_ffi_fixture.js";
    fs.mkdirSync(path.join(dir, "hosts/shared"), { recursive: true });
    fs.mkdirSync(path.join(dir, "hosts/desktop"), { recursive: true });
    fs.writeFileSync(path.join(dir, badRel), [
      'const DATA_ROOT = opts.dataRoot;',
      'const VOICE_DIR = path.join(DATA_ROOT, "desktop", "voice");',
      'function roomLatestReport(roomId) {',
      '  const j = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, "desktop", "rooms.json"), "utf8"));',
      '  const v = fs.readFileSync(path.join(VOICE_DIR, "sessions.json"), "utf8");',
      '  return j && v;',
      '}',
    ].join("\n"));
    const ownerRel = "hosts/desktop/product_surface_fixture.js";
    fs.writeFileSync(path.join(dir, ownerRel), 'const ROOMS_PATH = path.join(DESKTOP_DIR, "rooms.json");\nconst t = fs.readFileSync(ROOMS_PATH, "utf8");\n');
    const flagged = scanReadBypass(badRel, fs.readFileSync(path.join(dir, badRel), "utf8"));
    const ownerClean = scanReadBypass(ownerRel, fs.readFileSync(path.join(dir, ownerRel), "utf8"));
    const voiceClean = !flagged.some((h) => h.face === "sessions.json");
    if (flagged.length === 1 && flagged[0].face === "rooms.json" && ownerClean.length === 0 && voiceClean)
      ok("SW-NEGR", `尺子有效：旧读法被点中 1 处（${badRel}:${flagged[0].line}）、录音面 data/voice/sessions.json 没被误判、面持有者自己的读法不算旁路`);
    else bad("SW-NEGR", "读侧尺子失效（漏判旧读法 / 误判录音面 / 把持有者也算成旁路）", { flagged, ownerClean, voiceClean });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ===== SW-07 / SW-08 / SW-09：定时任务 → 邮件（EVENT_ONLY 端到端） ===== */
  if (process.env.NEG_CONTROL !== "1") {
    process.env.BITBOT_EVENT_ONLY = "1";
    const { root, dataRoot } = freshRoot("mail");
    const store = getSessionStore(root, { dataRoot });
    const surface = createProductSurface(root, { dataRoot, sessions: store });
    const b1 = surface.botsCreate({ name: "甲" }).bot;
    const b2 = surface.botsCreate({ name: "乙" }).bot;
    const created = surface.roomCreate([b1.id, b2.id].join(","), "日更流水线");
    const roomId = created && created.room && created.room.id;
    const REPORT = "群里的成稿：模型上下文又降价了";
    if (roomId) surface.appendRoomTranscript(roomId, { kind: "final_report", text: REPORT, bot_id: b1.id });
    closeMirrors();

    const roomsFile = path.join(dataRoot, "desktop", "rooms.json");
    if (roomId && !fs.existsSync(roomsFile))
      ok("SW-08", `前提自证：群里已有成稿，盘上却没有 desktop/rooms.json —— 旧读法在这里只能读到空`);
    else bad("SW-08", "前提不成立（群没建成，或这张面竟然落盘了）", { roomId, onDisk: fs.existsSync(roomsFile) });

    const ffi = createHostFfi(root, { dataRoot });
    const MAIL = "每天9点把审核通过的稿子发到 news@example.com";
    await fireRoutineMail(ffi, "kp09-daily", MAIL);
    const patched = patchRoutineRoom(dataRoot, "kp09-daily", roomId);
    const fired = await runRoutineFire(ffi, "kp09-daily");
    closeMirrors();
    const parts = String((queuedRoutineMail(dataRoot)[0] || {}).command || "").split("|");
    if (patched && fired && parts.length === 4 && parts[3].includes("降价") && !parts[3].includes("本群暂无可读到的成稿回执"))
      ok("SW-07", `EVENT_ONLY 下定时任务的待批准邮件正文取到了事件里的群成稿（修复前这里是「本群暂无可读到的成稿回执 + 任务原话」）`);
    else bad("SW-07", "邮件正文没拿到群里的事件成稿", { patched, fired: !!(fired && fired.ok), fields: parts.length, body: (parts[3] || "").slice(0, 70) });

    /* SW-09：盘上放一份写着**另一种稿子**的遗留 rooms.json。
       修复前它是唯一来源 → 那份假稿会被发出去；现在事件面赢。 */
    fs.writeFileSync(roomsFile, JSON.stringify({
      version: 1,
      rooms: [{ id: roomId, title: "日更流水线", transcript: [{ kind: "final_report", text: "遗留文件里的另一份稿子（不该被发出）" }] }],
    }, null, 2));
    await fireRoutineMail(ffi, "kp09-daily2", "每天9点半也把稿子发到 news@example.com");
    patchRoutineRoom(dataRoot, "kp09-daily2", roomId);
    await runRoutineFire(ffi, "kp09-daily2");
    closeMirrors();
    const mails = queuedRoutineMail(dataRoot);
    const last = String((mails[mails.length - 1] || {}).command || "").split("|");
    if (last.length === 4 && last[3].includes("降价") && !last[3].includes("不该被发出"))
      ok("SW-09", `反向对照：盘上塞一份假稿的遗留 rooms.json 后正文仍取事件成稿（${mails.length} 条待批准，读源认对了不是恰好没文件）`);
    else bad("SW-09", "遗留 JSON 仍能污染邮件正文（读的还是文件）", { body: (last[3] || "").slice(0, 70) });
    delete process.env.BITBOT_EVENT_ONLY;
  }

  /* ===== SW-10..12：多进程写同一张面（KP-09 片3） ===== */
  if (process.env.NEG_CONTROL !== "1") {
    const KID = 3, PER = 12;
    process.env.BITBOT_EVENT_ONLY = "1";
    const { root, dataRoot } = freshRoot("xp");
    const childPath = path.join(root, "xp-child.cjs");
    fs.writeFileSync(childPath, xpChildSource());
    const rs = await Promise.all(Array.from({ length: KID }, () => spawnXpChild(childPath, dataRoot, PER)));
    closeMirrors();
    const kids = rs.map((r) => {
      try { return JSON.parse(String(r.out).trim()); }
      catch { return { tag: "kid?" + r.code, appr: 0, bots: 0, rooms: 0, errs: ["子进程没吐 JSON（exit=" + r.code + "）：" + String(r.err).slice(0, 140)] }; }
    });
    const errs = kids.reduce((a, k) => a.concat(k.errs || []), []);
    const fh = fold(dataRoot);
    const rows = ((fh.approvals && fh.approvals.approvals) || (Array.isArray(fh.approvals) ? fh.approvals : []));
    const cmds = rows.map((e) => String(e.command || ""));
    const prefixes = new Set(cmds.map((c) => c.split("|")[0])).size;
    const roomsFolded = ((fh.rooms && fh.rooms.rooms) || []).length;
    xpKidsOk = errs.length === 0;
    xpRows = cmds.length;
    xpPrefixes = prefixes;
    xpStoreRooms = roomsFolded;

    if (xpKidsOk && cmds.length === KID * PER && prefixes === KID && fh.ok && !fh.anomalies.length)
      ok("SW-10", `${KID} 个真进程同时冷启同一个空事件库：每进程各写 ${PER} 条待批准全部落库（${cmds.length} 行、${prefixes} 个进程前缀、${fh.count} 条事件、无 anomalies）`);
    else bad("SW-10", "多进程冷启还有人写不进去（事件库开不了 = 那一侧的整批动作丢）",
      { errs: errs.slice(0, 2), rows: cmds.length, expect: KID * PER, prefixes, ok: fh.ok, anomalies: fh.anomalies });

    const collide = kids.reduce((a, k) => a.concat(k.errs || []), []).filter((e) => /ENOENT|rename/i.test(String(e)));
    if (collide.length === 0)
      ok("SW-11", `同一毫秒里 ${KID} 个进程各写 bots.json 没有一个 ENOENT rename（tmp 名带 pid；修前实测 3 家挂 2 家）`);
    else bad("SW-11", "atomicWrite 的 tmp 名还在跨进程撞车", collide.slice(0, 2));

    // store 形状的面（rooms/sessions）跨进程还是多写者：这一条只报数，不判绿也不判红，
    // 因为它测的是「本轮的交错运气」，而 T1-06 的边界目前只收到进程内（见 §8.125⑤）。
    console.log(`  · SW-12 残账（本轮实测）：${KID} 进程各建 3 个群，事件 fold 里 ${xpStoreRooms}/9 —— ` +
      "少于 9 就是跨进程的 store 面丢行：jsonl 面（审批）按行派事件所以精确（上面 36/36），" +
      "store 面按 prev→next 整份换，谁的 prev 陈旧谁就把别人刚建的群从自己那次 diff 里漏掉。" +
      "修前同形状实测过 6/9、7/9。T1-06「一张面一个写者」今天成立的范围是**一个进程内**，跨进程的 store 面仍是多写者。");

    /* 静态账：两处尺子的反向对照在夹具里真跑红，才允许这两条算绿 */
    const hostTexts = listHostJs().map((rel) => ({ name: rel, text: fs.readFileSync(path.join(REPO, rel), "utf8") }));
    const tmpBadRepo = tmpNameViolations(hostTexts);
    const tmpSites = hostTexts.reduce((a, t) => a + t.text.split("\n").filter((l) => /\.tmp\./.test(l) && /tmp\s*=/.test(l.trim())).length, 0);
    xpTmpBad = tmpBadRepo.length;
    xpTmpSites = tmpSites;
    const fixtureBad = tmpNameViolations([
      { name: "fixture_old.js", text: '  const tmp = filePath + ".tmp." + Date.now();\n    fs.renameSync(tmp, filePath);\n' },
      { name: "fixture_new.js", text: '  const tmp = filePath + ".tmp." + process.pid + "." + Date.now();\n' },
    ]);
    if (tmpSites > 0 && tmpBadRepo.length === 0 && fixtureBad.length === 1)
      ok("SW-13", `写快照的 ${tmpSites} 处 tmp 名全带 pid（静态账 0 违规），夹具反向对照只把「旧写法」那行判红（1 处）`);
    else bad("SW-13", "tmp 命名的尺子失效或仓库里还有旧写法", { sites: tmpSites, repoBad: tmpBadRepo, fixtureBad });

    const evText = fs.readFileSync(path.join(REPO, "hosts/shared/event_log.js"), "utf8");
    const orderRepo = openOrderViolations(evText);
    const orderOld = openOrderViolations([
      'function openEventLog(opts) {',
      '  db.exec("PRAGMA journal_mode = WAL;");',
      '  db.exec(`PRAGMA busy_timeout = 5000;`);',
      '  for (const m of MIGRATIONS) { db.exec("BEGIN;"); db.exec(m.sql);',
      '    } catch (err) { db.close(); throw new Error("迁移失败：" + err.message); } }',
      '  readLogVersion(db) >= m.id',
    ].join("\n"));
    xpOrderBad = orderRepo.length;
    if (orderRepo.length === 0 && orderOld.length >= 3)
      ok("SW-14", `开库的并发四件事都在（busy 先于 WAL / IMMEDIATE / 无 deferred BEGIN / 撞车重读版本），旧顺序夹具被判 ${orderOld.length} 条违规`);
    else bad("SW-14", "开库尺子失效或仓库里还缺并发该有的那几件事", { repo: orderRepo, oldFixture: orderOld.length });
    delete process.env.BITBOT_EVENT_ONLY;
  }

  console.log(`\nSW_METRICS mode=${process.env.NEG_CONTROL === "1" ? "neg" : "prod"} pass=${PASS} fail=${FAIL} writers=${swWriters.length} store_writers=${swStoreWriters} readers=${swReaders} xp_rows=${xpRows} xp_prefixes=${xpPrefixes} xp_store_rooms=${xpStoreRooms} tmp_sites=${xpTmpSites} tmp_bad=${xpTmpBad} order_bad=${xpOrderBad}`);
  console.log("prove_sessions_single_writer: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
}

try {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error("prove_sessions_single_writer fatal:", (e && e.stack) || e);
    process.exit(1);
  });
} catch (e) {
  console.error("prove_sessions_single_writer fatal:", (e && e.stack) || e);
  process.exit(1);
}
