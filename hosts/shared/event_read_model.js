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

    const rows = slot.log.readAfter({ fromSeq: 0, limit: opts.limit || 100000 });
    const folded = require("./event_mirror").foldEvents(rows);
    const anomalies = folded.anomalies || [];
    if (anomalies.length) {
      // 日志折不干净：缓存作废，让调用方降级回 JSON。绝不把半折叠状态当真。
      slot.folded = null;
      slot.lastSeq = -1;
      return { ok: false, reason: "fold_anomalies", anomalies, count: rows.length, file };
    }
    slot.folded = folded;
    slot.lastSeq = lastSeq;
    slot.count = rows.length;
    return {
      ok: true,
      file,
      sessions: clone(folded.sessions),
      rooms: clone(folded.rooms),
      approvals: clone(folded.approvals),
      anomalies,
      count: rows.length,
      lastSeq,
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
  eventReadEnabled,
  dbFilePath,
  readSurfaces,
  closeAll,
};
