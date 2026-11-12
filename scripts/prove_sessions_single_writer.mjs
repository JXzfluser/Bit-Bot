#!/usr/bin/env node
"use strict";
/* KP-09 片1..4：事件面只剩一个写者、读写同源，且多进程写同一张面不许互相抹掉。
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
 *   SW-15..17 三个真进程同时写 bots.json：谁的 Bot 都不许从盘上消失、谁的建群都不许被打死、
 *     事件里折出来的群数必须等于进程数（KP-09 片4：bots 面的读-改-写 + 跨进程锁）
 *   SW-13 tmp 命名静态账（棘轮，只许降）+ 旧写法夹具反向对照
 *   SW-14 开库并发四件事静态账（busy 先于 WAL / IMMEDIATE / 无 deferred / 撞车重读版本）+ 旧顺序夹具
 *   SW-18 全新裸目录（dataRoot 和 data/desktop 都不存在）首次建 Bot + 建群：20s 墙钟内必须返回
 *     —— 本片新加的跨进程锁第一版在这里死循环（mkdir 的 ENOENT 被当成「有人持锁」），修完 6ms 返回
 *   SW-19 自旋出口静态四判据（分辨 EEXIST / 无裸 catch{continue} / 先建面目录 / 有 deadline）+ 踩坑版夹具反向对照
 *   SW-20 把交错钉死在 load 与 save 之间的三方合并尺子：别人删的不复活 / 我的改名不被盖回 /
 *          别人新加的不抹掉；反向夹具 = 同一份模块摘掉合并那层，必须判红 3 条
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
let xpBotsLost = -1, xpBotsOk = -1, xpBotsRooms = -1, xpBotsSynced = false;
let xpSpinMs = -1, xpSpinOk = false, xpSpinBad = -1, xpSw20 = -1, xpSw20Neg = -1;
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

/* KP-09 片4 的子进程：先和另外两个进程对齐到同一时刻，再各写 K 轮 Bot，
   写完再对齐一次，然后用**自己刚建的**两个 Bot 建群。两次 barrier 把
   「读到同一份基底 → 各自整份写回」这个窗口按到最宽，不靠交错运气。 */
function xpBotsChildSource() {
  const q = JSON.stringify(REPO);
  return [
    '"use strict";',
    "const fs=require('fs'), path=require('path');",
    "const dataRoot=process.argv[2], N=Number(process.argv[3]||3), K=Number(process.argv[4]||6);",
    "process.env.BITBOT_EVENT_ONLY='1';",
    `const R=${q};`,
    "const {getSessionStore}=require(path.join(R,'hosts/desktop/sessions.js'));",
    "const {createProductSurface}=require(path.join(R,'hosts/desktop/product_surface.js'));",
    "const tag='kid'+process.pid;",
    "const out={tag,botIds:[],rooms:[],fails:[],errs:[],sync:true};",
    "const bar=path.join(dataRoot,'bar-'+N);",
    "const sync=(n,ph)=>{fs.mkdirSync(bar,{recursive:true});fs.writeFileSync(path.join(bar,tag+'.'+ph),'1');",
    "  const cnt=()=>fs.readdirSync(bar).filter((x)=>String(x).endsWith('.'+ph)).length;",
    "  const dl=Date.now()+60000;",
    "  while(cnt()<n&&Date.now()<dl){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}",
    "  out.sync=out.sync&&cnt()>=n;};",
    "try{",
    "  const store=getSessionStore(dataRoot,{dataRoot});",
    "  const s=createProductSurface(dataRoot,{dataRoot,sessions:store});",
    "  sync(N,'go');",
    "  let b1=null,b2=null;",
    "  for(let k=0;k<K;k++){",
    "    b1=s.botsCreate({name:tag+'-甲'+k,model:'m'}).bot;",
    "    b2=s.botsCreate({name:tag+'-乙'+k,model:'m'}).bot;",
    "    out.botIds.push(b1.id,b2.id);",
    "  }",
    "  sync(N,'made');",
    "  const r=s.roomCreate([b1.id,b2.id].join(','),tag+'-群');",
    "  const id=(r&&r.room&&r.room.id)||(r&&r.id);",
    "  if(id){out.rooms.push(id);}else{out.fails.push(String((r&&r.error)||'?')+':'+JSON.stringify((r&&r.names_not_found)||[]).slice(0,120));}",
    "}catch(e){out.errs.push(String((e&&e.message)||e).slice(0,200));}",
    "process.stdout.write(JSON.stringify(out)+'\\n');",
  ].join("\n");
}

/**
 * 片4 的锁自己踩过的坑（本轮实测）：withBotsLock 的 mkdir 失败原因不分辨，
 * 「面目录 data/desktop 还不存在」这种 ENOENT 也被当成「别人持着锁」，于是
 * statSync 又抛 → continue → 100% CPU 死循环，botsCreate 永不返回。
 * HEAD 没锁所以没事，加了锁就把首次落盘打死 —— 这把尺子先红过一次才立起来。
 * 子进程跑真模块、真首次落盘，父进程只给它墙钟：卡死必须判红，不许拖死门。
 */
function sw18ChildSource() {
  const q = JSON.stringify(REPO);
  return [
    '"use strict";',
    "const fs=require('fs'), path=require('path');",
    "const dataRoot=process.argv[2];",
    "process.env.BITBOT_EVENT_ONLY='1';",
    `const R=${q};`,
    "const {createProductSurface}=require(path.join(R,'hosts/desktop/product_surface.js'));",
    "const t0=Date.now();",
    "const out={ok:false,ms:0,onDisk:0,err:''};",
    "try{",
    "  const s=createProductSurface(R,{dataRoot});",
    "  const a=s.botsCreate({name:'裸目录甲',model:'m'}).bot;",
    "  const b=s.botsCreate({name:'裸目录乙',model:'m'}).bot;",
    "  const r=s.roomCreate(a.id+','+b.id,'裸目录群');",
    "  out.ok=!!((r&&r.room&&r.room.id)||(r&&r.id));",
    "  out.onDisk=(JSON.parse(fs.readFileSync(path.join(dataRoot,'desktop','bots.json'),'utf8')).bots||[]).length;",
    "  out.ms=Date.now()-t0;",
    "}catch(e){out.err=String((e&&e.message)||e).slice(0,160);out.ms=Date.now()-t0;}",
    "process.stdout.write(JSON.stringify(out)+'\\n');",
  ].join("\n");
}

/* SW-20 的确定性交错：把「别的写者」正好钉在我的 load 和 save 之间。
   SW-15..17 撞的是跨进程的随机窗口，这条不用撞运气 —— 拦住 B 读基底的那第一口
   readFileSync(BOTS_PATH)，在同一刻用 A 的实例做三件事：删掉一个两边都认得的 Bot、
   把另一个改名、再新建一个，然后才让 B 把自己那份写回去。
   把合并摘掉的那份代码上实测三条全红（§8.127④：连修好的第一版也只挡住两条，
   「别人删的被我复活」是这把尺子自己量出来的第三个缺口）。 */
function sw20ChildSource() {
  return [
    '"use strict";',
    "const fs=require('fs'), path=require('path');",
    "const dataRoot=process.argv[2], R=process.argv[3];",
    "delete process.env.BITBOT_EVENT_ONLY;",
    "const BOTS=path.join(dataRoot,'desktop','bots.json');",
    "const {createProductSurface}=require(path.join(R,'hosts/desktop/product_surface.js'));",
    "const a=createProductSurface(R,{dataRoot});",
    "const b=createProductSurface(R,{dataRoot});",
    "const bx=a.botsCreate({name:'甲一',model:'m'}).bot;",
    "const by=a.botsCreate({name:'共同的',model:'m'}).bot;",
    "b.botsCreate({name:'乙零',model:'m'});",
    "let armed=true;",
    "const orig=fs.readFileSync;",
    "fs.readFileSync=function(p,...rest){",
    "  const out=orig.call(fs,p,...rest);",
    "  if(armed&&String(p)===BOTS){armed=false;a.botsDelete(by.id,'yes');a.botsUpdate({bot_id:bx.id,name:'甲改过名的'});a.botsCreate({name:'甲插进来的',model:'m'});}",
    "  return out;",
    "};",
    "const cz=b.botsCreate({name:'乙一',model:'m'}).bot;",
    "fs.readFileSync=orig;",
    "const rows=JSON.parse(orig.call(fs,BOTS,'utf8')).bots||[];",
    "const has=(id)=>rows.some((x)=>x.id===id);",
    "const nameOf=(id)=>{const r=rows.find((x)=>x.id===id);return r?r.name:'(没了)';};",
    "const v=[];",
    "if(has(by.id))v.push('A 删掉的 Bot 被 B 的写复活了');",
    "if(nameOf(bx.id)!=='甲改过名的')v.push('A 的改名被 B 盖回：'+nameOf(bx.id));",
    "if(!rows.some((x)=>x.name==='甲插进来的'))v.push('A 在交错窗口里新建的 Bot 被 B 整份写抹掉了');",
    "if(!has(cz.id))v.push('B 自己新建的 Bot 也没了');",
    "process.stdout.write(JSON.stringify({rows:rows.length,v})+'\\n');",
  ].join("\n");
}

/* 反向对照的夹具：同一份 product_surface，只把 saveBots 里那层合并摘掉（= 修复前的
   「整份写」形状），其余文件用符号链接指回仓库。这条夹具不成立，SW-20 就是假绿。 */
function mergeDisabledFarm() {
  const farm = fs.mkdtempSync(path.join(os.tmpdir(), "kp09-nomerge-"));
  const desk = path.join(farm, "hosts", "desktop");
  fs.mkdirSync(desk, { recursive: true });
  fs.symlinkSync(path.join(REPO, "hosts", "shared"), path.join(farm, "hosts", "shared"));
  for (const f of fs.readdirSync(path.join(REPO, "hosts", "desktop"))) {
    if (f === "product_surface.js") continue;
    fs.symlinkSync(path.join(REPO, "hosts", "desktop", f), path.join(desk, f));
  }
  const src = fs.readFileSync(path.join(REPO, "hosts/desktop/product_surface.js"), "utf8");
  const patched = src.replace(
    "atomicWrite(BOTS_PATH, JSON.stringify(mergeBotsAgainstDisk(data), null, 2))",
    "atomicWrite(BOTS_PATH, JSON.stringify(data, null, 2))");
  if (patched === src) return null;
  fs.writeFileSync(path.join(desk, "product_surface.js"), patched);
  return farm;
}

/* 静态账：锁的自旋必须有出口。四条各自可核实 ——
   ①mkdir 的失败按 err.code 分辨（只有 EEXIST 才等）；②没有裸 catch{continue} 的空转口；
   ③建锁前先保证面目录在；④等待路径上有 deadline 出口。 */
function spinLoopViolations(text) {
  const at = text.indexOf("function withBotsLock");
  if (at < 0) return ["找不到 withBotsLock（尺子失效）"];
  const body = text.slice(at, at + 2600);
  const v = [];
  if (!/EEXIST/.test(body)) v.push("mkdir 失败没分辨原因：不是「有人持锁」也照样进等待路径");
  if (/catch\s*\([^)]*\)\s*\{\s*continue\s*;?\s*\}/.test(body)) v.push("有 catch{continue} 的裸空转口");
  if (!/mkdirSync\(\s*path\.dirname\(/.test(body)) v.push("建锁前没保证面目录存在（首次落盘会 ENOENT）");
  if (!/Date\.now\(\)\s*>\s*deadline/.test(body)) v.push("等待路径没有 deadline 出口（拿不到锁就永远等）");
  return v;
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
      "少的那几行不是 diff 删掉的（取证：事件库里 entity_removed 一条都没有），而是那几家进程的 botsCreate " +
      "先把别人写的 Bot 整份覆盖掉，紧接着自己的 roomCreate 就报 names_not_found，群根本没建成。" +
      "那条已从写侧收口（SW-15..17），收口后连测 5 轮都是 9/9 —— 但这把尺子的交错窗口没测到 store 面的丢行，" +
      "不等于它不在：默认（非 EVENT_ONLY）模式下会话/群这两张面仍是整份文件写，" +
      "两个进程读到同一份基底时谁后写谁就把别人刚建的那行抹掉，跨进程还是多写者。");

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

    /* ===== SW-15..17：bots.json 跨进程读-改-写（KP-09 片4） =====
       bots 面不在事件词表里（docs/events.md §7），它一度是「最后写者赢」。修前实测
       （同一把尺子、4 轮）：3 进程各写 12 个 Bot，盘上只剩 1 家的，另两家紧接着
       用自己刚建的 Bot 建群被点名 names_not_found —— 屏幕上「Bot 建好了、群建不起来」。 */
    const BKID = 3, BROUND = 6;
    const botsRoot = freshRoot("botsxp");
    const botsChildPath = path.join(botsRoot.root, "xp-bots-child.cjs");
    fs.writeFileSync(botsChildPath, xpBotsChildSource());
    const botsSpawn = () => new Promise((res) => {
      const p = spawn(process.execPath, [botsChildPath, botsRoot.dataRoot, String(BKID), String(BROUND)],
        { stdio: ["ignore", "pipe", "pipe"] });
      let buf = "", eb = "";
      p.stdout.on("data", (c) => { buf += String(c); });
      p.stderr.on("data", (c) => { eb += String(c); });
      p.on("error", (e) => res({ code: -1, out: "", err: String((e && e.message) || e) }));
      p.on("close", (code) => res({ code, out: buf, err: eb }));
    });
    const brs = await Promise.all(Array.from({ length: BKID }, botsSpawn));
    closeMirrors();
    const bkids = brs.map((r) => {
      try { return JSON.parse(String(r.out).trim()); }
      catch { return { tag: "kid?" + r.code, botIds: [], rooms: [], fails: [], errs: ["子进程没吐 JSON（exit=" + r.code + "）：" + String(r.err).slice(0, 120)], sync: false }; }
    });
    const bErrs = bkids.reduce((a, k) => a.concat(k.errs || []), []);
    let bDisk = new Set();
    try {
      bDisk = new Set(((JSON.parse(fs.readFileSync(path.join(botsRoot.dataRoot, "desktop", "bots.json"), "utf8")).bots) || [])
        .map((b) => b && b.id).filter(Boolean));
    } catch (_) { /* 读不出来按 0 个算，让 SW-15 直接判红 */ }
    const bWanted = bkids.flatMap((k) => k.botIds || []);
    xpBotsSynced = bkids.every((k) => k.sync === true);
    xpBotsLost = bWanted.filter((id) => !bDisk.has(id)).length;
    xpBotsOk = bkids.filter((k) => (k.rooms || []).length === 1).length;
    const bfh = fold(botsRoot.dataRoot);
    xpBotsRooms = ((bfh.rooms && bfh.rooms.rooms) || []).length;
    if (xpBotsSynced && bErrs.length === 0 && xpBotsLost === 0 && bWanted.length === BROUND * 2 * BKID)
      ok("SW-15", `${BKID} 个真进程各写 ${BROUND * 2} 个 Bot（两次 barrier 对齐读写窗口）：${bWanted.length} 个 Bot 在盘上一个没丢`);
    else bad("SW-15", "跨进程写 bots.json 还有 Bot 从盘上消失", { synced: xpBotsSynced, lost: xpBotsLost, want: bWanted.length, onDisk: bDisk.size, errs: bErrs.slice(0, 2) });

    if (xpBotsOk === BKID)
      ok("SW-16", `每个进程随后用自己刚建的 Bot 建群，${xpBotsOk}/${BKID} 全部成功（修前 4 轮实测只有 1~2 家成得了）`);
    else bad("SW-16", "有进程的建群被别人的整份写覆盖打死（names_not_found）",
      { ok: xpBotsOk, expect: BKID, fails: bkids.map((k) => (k.fails || []).join(";")).filter(Boolean).slice(0, 2) });

    if (xpBotsRooms === BKID)
      ok("SW-17", `事件里折回 ${xpBotsRooms}/${BKID} 个群：Bot 面（文件真源）不再把群面（事件真源）的行拽掉`);
    else bad("SW-17", "群面折回来的群数少于进程数", { rooms: xpBotsRooms, expect: BKID });

    /* ===== SW-18/19：锁自己别把首次落盘打死（本片踩过的坑） =====
       bots 面的锁是新加的，加完的第一个动作就是它把 `data/desktop` 还不存在的
       首次写盘变成死循环（本轮实测：同一份 standalone 探针在修好的锁上 6ms 返回，
       在踩坑的锁上 30s 零输出被墙钟打死）。SW-18 是真模块 + 真裸目录 + 墙钟，
       SW-19 是那 4 条静态判据，且必须点中「踩坑版」那 15 行。 */
    const SPIN_LIMIT_MS = 20000;
    const bareBase = fs.mkdtempSync(path.join(os.tmpdir(), "kp09-bare-"));
    const bareData = path.join(bareBase, "nope", "data");   // dataRoot 和面目录都不存在
    const s18Path = path.join(bareBase, "sw18-child.cjs");
    fs.writeFileSync(s18Path, sw18ChildSource());
    const s18 = await new Promise((res) => {
      const p = spawn(process.execPath, [s18Path, bareData], { stdio: ["ignore", "pipe", "pipe"] });
      let buf = "", eb = "";
      p.stdout.on("data", (c) => { buf += String(c); });
      p.stderr.on("data", (c) => { eb += String(c); });
      const timer = setTimeout(() => {
        try { p.kill("SIGKILL"); } catch (_) { /* 已经没了 */ }
        res({ hang: true, out: buf, err: eb });
      }, SPIN_LIMIT_MS);
      p.on("error", (e) => { clearTimeout(timer); res({ hang: false, err: String((e && e.message) || e), out: "" }); });
      p.on("close", (code) => { clearTimeout(timer); res({ hang: false, code, out: buf, err: eb }); });
    });
    let s18j = null;
    try { s18j = JSON.parse(String(s18.out).trim()); } catch (_) { /* 没吐 JSON 按卡死算 */ }
    xpSpinMs = s18j ? Number(s18j.ms) : -1;
    xpSpinOk = !s18.hang && !!s18j && s18j.ok === true && s18j.onDisk === 3 && !s18j.err;
    if (xpSpinOk && xpSpinMs >= 0 && xpSpinMs < 5000)
      ok("SW-18", `全新裸目录（data/desktop 还不存在）里首次建 2 个 Bot + 1 个群：${xpSpinMs}ms 返回、盘上 ${s18j.onDisk} 行（我建的 2 个 + 内建 agent-bit）—— 锁没把首次落盘打死`);
    else bad("SW-18", s18.hang ? "首次落盘在 " + SPIN_LIMIT_MS + "ms 墙钟里没返回（自旋没有出口）" : "首次落盘结果不对",
      { hang: !!s18.hang, json: s18j, ms: xpSpinMs, err: String(s18.err || "").slice(0, 160) });
    try { fs.rmSync(bareBase, { recursive: true, force: true }); } catch (_) { /* 临时目录清不掉不影响判定 */ }

    const psText = fs.readFileSync(path.join(REPO, "hosts/desktop/product_surface.js"), "utf8");
    const spinRepo = spinLoopViolations(psText);
    const spinOld = spinLoopViolations([
      "  function withBotsLock(fn) {",
      "    const lock = BOTS_PATH + \".lock\";",
      "    const deadline = Date.now() + 5000;",
      "    let held = false;",
      "    while (!held) {",
      "      try { fs.mkdirSync(lock); held = true; } catch (_) { /* 已有人持锁，下面判断能不能接管 */ }",
      "      if (held) { fs.writeFileSync(path.join(lock, \"pid\"), String(process.pid)); break; }",
      "      let ageMs = Infinity, owner = 0;",
      "      try { ageMs = Date.now() - fs.statSync(lock).mtimeMs; } catch (_) { continue; }",
      "      if (ageMs > 5000) { fs.rmSync(lock, { recursive: true, force: true }); }",
      "      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);",
      "    }",
      "    try { return fn(); } finally { if (held) fs.rmSync(lock, { recursive: true, force: true }); }",
      "  }",
    ].join("\n"));
    xpSpinBad = spinRepo.length;
    if (spinRepo.length === 0 && spinOld.length >= 2)
      ok("SW-19", `自旋出口的四条静态判据在仓库里 0 违规，而刚踩过坑的那 15 行被判 ${spinOld.length} 条（${spinOld[0]}）`);
    else bad("SW-19", "空转尺子失效或仓库里还有没出口的自旋", { repo: spinRepo, oldFixture: spinOld });

    /* ===== SW-20：合并的三条语义，用一把不撞运气的交错尺子 =====
       片4 第一版的合并挡住了「别人新加的」和「我自己删的」，量不到第三种：
       别的写者删掉的那一行，我这份里还带着 —— 写回去就把它复活。这条尺子把
       交错钉死在 load 与 save 之间，修第一版当场红在复活那条（§8.127④）。 */
    {
      const sw20Base = fs.mkdtempSync(path.join(os.tmpdir(), "kp09-sw20-"));
      const sw20Path = path.join(sw20Base, "sw20-child.cjs");
      fs.writeFileSync(sw20Path, sw20ChildSource());
      const runSw20 = (repoRoot) => new Promise((res) => {
        const dRoot = fs.mkdtempSync(path.join(sw20Base, "d-"));
        fs.mkdirSync(path.join(dRoot, "desktop"), { recursive: true });
        const p = spawn(process.execPath, [sw20Path, dRoot, repoRoot], { stdio: ["ignore", "pipe", "pipe"] });
        let buf = "", eb = "";
        p.stdout.on("data", (c) => { buf += String(c); });
        p.stderr.on("data", (c) => { eb += String(c); });
        const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch (_) { /* 已经没了 */ } }, 30000);
        p.on("error", (e) => { clearTimeout(timer); res({ out: "", err: String((e && e.message) || e) }); });
        p.on("close", (code) => { clearTimeout(timer); res({ code, out: buf, err: eb }); });
      });
      const sw20Parse = (r) => { try { return JSON.parse(String(r.out).trim()); } catch (_) { return null; } };
      const real = sw20Parse(await runSw20(REPO));
      const farm = mergeDisabledFarm();
      const neg = farm ? sw20Parse(await runSw20(farm)) : null;
      xpSw20 = real && real.v ? real.v.length : -1;
      xpSw20Neg = neg && neg.v ? neg.v.length : -1;
      if (real && real.v && real.v.length === 0 && real.rows === 5 && neg && neg.v && neg.v.length === 3)
        ok("SW-20", `交错窗口里三条语义全守住（别人删的不复活 / 我的改名不被盖回 / 别人新加的不抹掉，盘上 ${real.rows} 行）；摘掉合并的夹具在同一条尺子上判红 3 条（${neg.v[0]}）`);
      else bad("SW-20", real && real.v && real.v.length ? "合并的交错语义有缺口" : "交错尺子或反向夹具失效",
        { real, neg, farmErr: farm ? "" : "夹具建不出来（合并那行不在了）", err: String((real && real.err) || "").slice(0, 160) });
      if (farm) { try { fs.rmSync(farm, { recursive: true, force: true }); } catch (_) { /* 清不掉不影响判定 */ } }
      try { fs.rmSync(sw20Base, { recursive: true, force: true }); } catch (_) { /* 清不掉不影响判定 */ }
    }

    delete process.env.BITBOT_EVENT_ONLY;
  }

  console.log(`\nSW_METRICS mode=${process.env.NEG_CONTROL === "1" ? "neg" : "prod"} pass=${PASS} fail=${FAIL} writers=${swWriters.length} store_writers=${swStoreWriters} readers=${swReaders} xp_rows=${xpRows} xp_prefixes=${xpPrefixes} xp_store_rooms=${xpStoreRooms} tmp_sites=${xpTmpSites} tmp_bad=${xpTmpBad} order_bad=${xpOrderBad} bots_lost=${xpBotsLost} bots_room_ok=${xpBotsOk} bots_rooms=${xpBotsRooms} spin_ms=${xpSpinMs} spin_bad=${xpSpinBad} sw20=${xpSw20} sw20_neg=${xpSw20Neg}`);
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
