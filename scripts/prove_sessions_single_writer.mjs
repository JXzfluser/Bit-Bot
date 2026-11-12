#!/usr/bin/env node
"use strict";
/* KP-09 片1：sessions.json 这张面只剩一个写者。
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
 *   SW-NEG 反向对照：拿"旧写法"（绕过 store 直写 JSON）做同样的级联，
 *          事件 fold 必须仍然留着那条 DM —— 证明 SW-03 认的是写者，不是运气
 *
 * 全部跑在临时目录，绝不碰仓库里的 data/。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { getSessionStore } = require(path.join(REPO, "hosts/desktop/sessions.js"));
const { createProductSurface } = require(path.join(REPO, "hosts/desktop/product_surface.js"));
const eventMirror = require(path.join(REPO, "hosts/desktop/event_mirror_ref.js")).loadEventMirror();
const eventReadModel = require(path.join(REPO, "hosts/shared/event_read_model.js"));
const eventMirrorMod = require(path.join(REPO, "hosts/shared/event_mirror.js"));

let PASS = 0;
let FAIL = 0;
let swWriters = [];
let swStoreWriters = 0;
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

function main() {
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

  console.log(`\nSW_METRICS mode=${process.env.NEG_CONTROL === "1" ? "neg" : "prod"} pass=${PASS} fail=${FAIL} writers=${swWriters.length} store_writers=${swStoreWriters}`);
  console.log("prove_sessions_single_writer: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error("prove_sessions_single_writer fatal:", (e && e.stack) || e);
  process.exit(1);
}
