/*
 * event_read_model.js — T1-04 读切换：把「读」从 JSON 快照搬到事件日志上。
 *
 * 契约真源是 docs/events.md §7/§8：日志完整记账 sessions/rooms/approvals 三张面，
 * T1-03 的真机对账已证明 fold(events) == JSON 快照逐字段相等。这一步把
 * 「对账时才 fold」升级成「产品读的时候也 fold」。
 *
 * 四条设计决定，每条都有代价，写清楚：
 *
 * 1) 开关默认关。BITBOT_EVENT_READ=1 才走这条路；关着时本模块一个字节都不碰
 *    （连 require event_log 都不发生）——Electron 之外的运行时（系统老 Node 的
 *    CLI host）没有 node:sqlite，event_log 是「加载即抛」，顶层 require 会把
 *    未开开关的进程也炸掉。这是 event_mirror.js openEventLogLazy 同一条防御。
 * 2) 库不存在 = 读不到，不是「顺手建一个」。读路径建库会把「只读消费方」
 *    变成「写者」，和 actor 单写者（T1-06）的计划直接冲突。no_db 就老实
 *    降级回 JSON 读，不静默、不装作读到了空状态。
 * 3) 任何异常都诚实降级：ok:false + reason，调用方回退现有 JSON 读并打一行
 *    说明。读切换的价值建立在 T1-03 的对账上，但对账不是不变的真理——
 *    日志坏了还硬读就是拿用户数据冒险。
 * 4) 折叠结果带缓存：load() 是热路径（sessions 每次操作都过它），每次都
 *    全量开库 + 全量 fold 会把 O(操作) 变成 O(事件总数)。缓存按 lastSeq
 *    失效——这张日志只追加、从不删行（docs/events.md §3「seq 不复用」），
 *    lastSeq 没动 = 状态没动。返回给调用方前深拷贝：调用方（read-modify-write）
 *    会原地改这份状态，绝不能把缓存本体交出去。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const READ_FLAG = "BITBOT_EVENT_READ";

/* 单次折叠的取数窗口与总量护栏（#83）。窗口只决定「一次往内存里读多少行」；
   **折完的判据是「有一页没读满」，不是「读满了一个上限」**。默认口径以前是一次
   `limit: 100000` 的读：读满就把它当整份日志 —— 探针（scripts/probe_read_model_row_cap.mjs）
   在 25 行的库上喂 limit=5 量到：`ok:true`、12 条会话只剩 3 条、已 `entity_removed` 的那条
   复活，而且这份截断状态按**真实 lastSeq** 写进缓存，同进程之后不管放开多大上限都是
   `cached:true` —— 一次截断、永久失真，调用方（片11 的提交时基底）会拿它去合并。
   日志行数不是会话数决定的：回合流 turn_started/progress/turn_ended（§5.2，A1-2 同库）
   和每条 message_committed 都算行，10 万行是「天天用几个月」量级，不是理论值。 */
const FOLD_PAGE_ROWS = 50000;
const FOLD_BUDGET_ROWS = 500000;

/**
 * 从 `fromSeq` 起分页把日志折进 `base`（base 为 null 即从 BASELINE 全量折）。
 * 只在「读到一页不满」时宣布看完；护栏咬住就如实报 `truncated:true`，调用方必须拒。
 * 分页续折用的就是 #82 的 `fromState`，等值性由 RM-10/L 组钉着，不是假定。
 */
function foldPages(log, opts = {}) {
  const page = Number(opts.pageSize) > 0 ? Number(opts.pageSize) : FOLD_PAGE_ROWS;
  const budget = Number(opts.maxRows || opts.limit) > 0 ? Number(opts.maxRows || opts.limit) : FOLD_BUDGET_ROWS;
  const { foldEvents } = require("./event_mirror");
  let folded = opts.base || null;
  let cursor = Number(opts.fromSeq) || 0;
  let rows = 0;
  for (;;) {
    /* 单页取数按剩余额度夹紧：护栏必须是「行数上限」，不能只是「分页上限」——
       否则预算 5 行、页 50000 行时一次就把整份日志读走，护栏形同不存在（第一版踩过）。 */
    const want = Math.min(page, budget - rows);
    if (want <= 0) return { folded, rows, cursor, truncated: true, budget };
    const chunk = log.readAfter({ fromSeq: cursor, limit: want });
    rows += chunk.length;
    if (chunk.length) {
      folded = folded ? foldEvents(chunk, { fromState: folded }) : foldEvents(chunk);
      cursor = Number(chunk[chunk.length - 1].seq);
    }
    if (chunk.length < want) return { folded, rows, cursor, truncated: false, budget };
    if (rows >= budget) return { folded, rows, cursor: cursor, truncated: true, budget };
  }
}

function eventReadEnabled(env) {
  const e = env || process.env;
  // EVENT_ONLY 隐含「读事件」：事件库是唯一真源，读必然走折叠。
  return e[READ_FLAG] === "1" || e.BITBOT_EVENT_ONLY === "1";
}

function dbFilePath(dataRoot) {
  return path.join(path.resolve(dataRoot), "events", "desktop-events.sqlite");
}

/* 每个库文件一个缓存槽：{ log, lastSeq, folded }。进程内复用，进程退出即释放。 */
const cacheByFile = new Map();

function dropCache(file) {
  const slot = cacheByFile.get(file);
  if (slot) {
    try { slot.log.close(); } catch (_e) { /* 已关或已坏，不追究 */ }
    cacheByFile.delete(file);
  }
}

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

/**
 * 从事件日志折叠出三张面的当前状态。
 * @param {string} dataRoot 与 event_mirror.getSharedMirror 同一个 dataRoot
 * @param {{env?:object, file?:string, actor?:string, limit?:number}} [opts]
 *   env 用于测试注入（不污染 process.env）；file 覆盖库路径（测试用）。
 * @returns {{ok:true, sessions:object, rooms:object, approvals:Array,
 *            anomalies:string[], count:number, lastSeq:number, file:string}
 *          |{ok:false, reason:string, error?:string, file?:string}}
 */
function readSurfaces(dataRoot, opts = {}) {
  if (!eventReadEnabled(opts.env)) {
    return { ok: false, reason: "read_disabled" };
  }
  const file = opts.file ? path.resolve(opts.file) : dbFilePath(dataRoot);
  if (!fs.existsSync(file)) {
    // 读路径绝不建库；no_db → 调用方降级回 JSON 读。
    return { ok: false, reason: "no_db", file };
  }

  /* 句柄按文件缓存复用：load() 是热路径，每次都 new DatabaseSync 会把
     「读一次」变成「开一次库」。同文件的 WAL 多连接没有问题——镜像用它自己
     的连接写，这里的连接只读，prepared statement 每次执行都能看到最新提交。 */
  let slot = cacheByFile.get(file);
  if (!slot) {
    let handle;
    try {
      handle = require("./event_log").openEventLog({
        file,
        actor: opts.actor || "event-read-model",
        busyTimeoutMs: opts.busyTimeoutMs,
      });
    } catch (err) {
      return {
        ok: false,
        reason: "open_failed",
        error: String((err && err.message) || err),
        file,
      };
    }
    slot = { log: handle, lastSeq: -1, folded: null, count: 0 };
    cacheByFile.set(file, slot);
  }

  try {
    const lastSeq = slot.log.lastSeq();
    if (slot.folded && slot.lastSeq === lastSeq) {
      return {
        ok: true,
        file,
        sessions: clone(slot.folded.sessions),
        rooms: clone(slot.folded.rooms),
        approvals: clone(slot.folded.approvals),
        anomalies: [],
        count: slot.count,
        lastSeq,
        cached: true,
      };
    }
    /* 折叠必须把游标之后的每一行都看完才敢宣布状态（#83）。
       增量（#82 / §8.165）：日志只追加、seq 不复用，所以「上次折干净的状态 ⊕ 之后的新行」
       与「从头折全部」必须得到同一份面。省下的正是每次操作那一格全量折（2000 会话实测 330ms）。
       只在 lastSeq 往前走时续折；库被换掉（seq 倒退/归零）就回全量。折出异常一律回全量确认，
       增量路径永远没有权力单独宣布「这份日志不干净」。 */
    let result = null;
    let incremental = false;
    if (slot.folded && lastSeq > slot.lastSeq) {
      result = foldPages(slot.log, {
        fromSeq: slot.lastSeq,
        base: slot.folded,
        pageSize: opts.pageSize,
        maxRows: opts.maxRows || opts.limit,
      });
      incremental = true;
      // 增量读不全或折出异常：不许下结论，退回全量确认（全量也读不全时由下面统一拒）。
      if (result.truncated || (result.folded.anomalies || []).length) result = null;
    }
    if (!result) {
      result = foldPages(slot.log, {
        fromSeq: 0,
        base: null,
        pageSize: opts.pageSize,
        maxRows: opts.maxRows || opts.limit,
      });
      incremental = false;
    }
    const folded = result.folded;
    if (result.truncated) {
      // 读满护栏 = 没看完，不是「这张面就这些」。缓存作废，调用方按读不到降级。
      slot.folded = null;
      slot.lastSeq = -1;
      return {
        ok: false,
        reason: "log_too_long",
        rowsRead: result.rows,
        maxRows: result.budget,
        lastSeq,
        file,
      };
    }
    const anomalies = folded.anomalies || [];
    if (anomalies.length) {
      // 日志折不干净：缓存作废，让调用方降级回 JSON。绝不把半折叠状态当真。
      slot.folded = null;
      slot.lastSeq = -1;
      return { ok: false, reason: "fold_anomalies", anomalies, count: result.rows, file };
    }
    const prevCount = slot.count;
    slot.folded = folded;
    slot.lastSeq = lastSeq;
    slot.count = incremental ? prevCount + result.rows : result.rows;
    slot.incremental = incremental;
    return {
      ok: true,
      file,
      sessions: clone(folded.sessions),
      rooms: clone(folded.rooms),
      approvals: clone(folded.approvals),
      anomalies,
      count: result.rows,
      lastSeq,
      foldPath: incremental ? "incremental" : "full",
    };
  } catch (err) {
    dropCache(file);
    return {
      ok: false,
      reason: "read_failed",
      error: String((err && err.message) || err),
      file,
    };
  }
}

/** 测试与关停用：关掉所有缓存句柄。 */
function closeAll() {
  for (const file of [...cacheByFile.keys()]) dropCache(file);
}

module.exports = {
  READ_FLAG,
  FOLD_PAGE_ROWS,
  FOLD_BUDGET_ROWS,
  eventReadEnabled,
  dbFilePath,
  foldPages,
  readSurfaces,
  closeAll,
};
