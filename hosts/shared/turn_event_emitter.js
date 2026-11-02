"use strict";

/*
 * turn_event_emitter.js — A1-2 桥：把回合广播（bitbot:llm-stream /
 * bitbot:turn-progress，docs/events.md §8 的映射）翻成持久化事件
 * （§5.2：turn_started / progress / turn_ended）。
 *
 * 设计决定（每条都有代价，写清楚）：
 *  - 复用 event_mirror 的共享句柄（getSharedMirror）：回合流与快照镜像落同一份库、
 *    同一进程单写者，手机端 SSE（A1-1 路由）读的就是这份库。这也是 A1-1 路由
 *    「不再 503」的接线片 —— 桌面把这份句柄喂给 createCnInboundServer 的 eventLog。
 *  - 关默认（BITBOT_EVENT_DUAL_WRITE / BITBOT_EVENT_ONLY 都没开）时 mirror.emit 是
 *    no-op，一个字都不写、连库都不开；A1-1 的 SSE 路由因此继续诚实 503、零足迹。
 *  - 回合流事件不进快照 fold：foldEvents 显式跳过这些 kind（见 event_mirror.js）。
 *  - 三个 emit 都吞异常：回合事件绝不能把回合本身带崩。
 */

const { getSharedMirror } = require("./event_mirror");

/** 拿到（或共享）与 sessions/product_surface 同一个镜像句柄。dataRoot 必须与它们
 *  一致（dev 态 = <repo>/data），否则路由读的是另一份库。 */
function getMirror(dataRoot, opts) {
  return getSharedMirror(dataRoot, opts || {});
}

function emitTurnStarted(mirror, { sessionId, turnId, initiator }) {
  if (!mirror || typeof mirror.emit !== "function") return false;
  return mirror.emit({
    sessionId: String(sessionId || "system"),
    turnId: String(turnId || ""),
    kind: "turn_started",
    payload: { turn_id: String(turnId || ""), initiator: String(initiator || "") },
  });
}

function emitProgress(mirror, { sessionId, turnId, row }) {
  if (!mirror || typeof mirror.emit !== "function") return false;
  const r = Object.assign({}, row || {});
  if (turnId) r.turn_id = String(turnId);
  return mirror.emit({
    sessionId: String(sessionId || "system"),
    turnId: String(turnId || ""),
    kind: "progress",
    payload: { turn_id: String(turnId || ""), row: r },
  });
}

function emitTurnEnded(mirror, { sessionId, turnId, status, usage }) {
  if (!mirror || typeof mirror.emit !== "function") return false;
  const p = { turn_id: String(turnId || ""), status: String(status || "ok") };
  if (usage !== undefined && usage !== null) p.usage = usage;
  return mirror.emit({
    sessionId: String(sessionId || "system"),
    turnId: String(turnId || ""),
    kind: "turn_ended",
    payload: p,
  });
}

module.exports = { getMirror, emitTurnStarted, emitProgress, emitTurnEnded };
