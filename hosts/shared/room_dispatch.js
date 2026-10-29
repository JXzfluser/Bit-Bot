"use strict";

/**
 * Shared room dispatch — the ONE path a user message takes into a room.
 *
 * Q-6: 「CLI / 移动端发的群消息没人回,而且不报错」。
 *
 * 根因不在内核,在于**扇出这一步只在桌面 Electron 的 IPC handler 里**:
 *   hosts/desktop/main.js  →  bitbot:rooms:orchestrate
 *     → surface.roomTurn + appendRoomTranscript + surface.orchestrateRoom(扇出)
 * 而所有非桌面路径(CLI、移动端、cn_inbound 的 /v1/turn、任何走内核 effect 的
 * 调用)落到 host_ffi.js 的 `room_turn` effect 执行分支时,只做了
 * roomTurn + appendRoomTranscript —— **没有 orchestrateRoom**。
 * 消息落盘了,没人回,也没报错。
 *
 * 所以这里把「路由 → 落转录 → 扇出 → 汇总」收成��个函数,桌面和别的端都调它。
 * 一条路径 ⇒ 不会一个端回、另一个端不回。
 *
 * 诚实性:任何一步失败都**如实返回错误**,绝不把「没回话」演成「回好了」。
 */

const nowIso = () => new Date().toISOString();

/** 每次进入 = 一条新消息 = 一个新 id。渠道侧有稳定投递 id 时由调用方传入。 */
function newMessageId(prefix) {
  const p = String(prefix || "msg");
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {object} o
 * @param {object} o.surface      product surface (rooms/bots/transcript)
 * @param {string} o.roomId
 * @param {string} o.text
 * @param {string} [o.messageId]  投递 id:同一次投递重试 ⇒ 同一个 id ⇒ 幂等;
 *                               用户再发一遍 ⇒ 新 id ⇒ 新的任务
 * @param {object} [o.deps]       扇出依赖(runResponderTurn / selectResponders / synthesize …)
 * @param {boolean} [o.force]     显式重跑:忽略幂等命中
 * @param {string} [o.now]
 */
async function dispatchRoomTurn(o) {
  const opts = o || {};
  const surface = opts.surface;
  const roomId = String(opts.roomId || "").trim();
  const text = String(opts.text || "").trim();
  const now = opts.now || nowIso();

  if (!surface || typeof surface.roomTurn !== "function") {
    return { ok: false, error: "room_surface_unavailable", mode: "host_room_dispatch" };
  }
  if (!roomId) {
    return { ok: false, error: "room_and_text_required", mode: "host_room_dispatch" };
  }
  if (!text) {
    return { ok: false, error: "room_and_text_required", mode: "host_room_dispatch" };
  }

  // 幂等键:投递 id 优先,没有就现生成一个(新的一次投递 = 新的任务)。
  const messageId = String(opts.messageId || "").trim() || newMessageId("room-msg");

  // 1) 路由:谁该回、怎么回,由 roomTurn 决定(@点名 / 全员 / 成员自决)。
  let routed;
  try {
    routed = surface.roomTurn(roomId, text, now, messageId);
  } catch (e) {
    return {
      ok: false,
      error: "rooms_store_unreadable",
      detail: String((e && e.message) || e),
      mode: "host_room_dispatch",
      room_id: roomId,
    };
  }
  if (!routed || !routed.ok) {
    // 群不存在 / 转录不可读 —— 如实报错。**不假装消息送到了。**
    return {
      ok: false,
      error: (routed && routed.error) || "route_failed",
      mode: "host_room_dispatch",
      room_id: roomId,
      message_id: messageId,
    };
  }

  const entry = routed.transcript_entry || {};

  // 2) 落转录(单一写入点)。
  if (typeof surface.appendRoomTranscript === "function") {
    try {
      const app = surface.appendRoomTranscript(roomId, entry);
      if (app && app.ok === false) {
        return {
          ok: false,
          error: app.error || "rooms_store_unreadable",
          mode: "host_room_dispatch",
          room_id: roomId,
          message_id: messageId,
        };
      }
    } catch (e) {
      return {
        ok: false,
        error: "rooms_store_unreadable",
        detail: String((e && e.message) || e),
        mode: "host_room_dispatch",
        room_id: roomId,
        message_id: messageId,
      };
    }
  }

  // 3) 扇出 + 汇总。没有这一步,消息就是石沉大海(Q-6 的正身)。
  if (typeof surface.orchestrateRoom !== "function") {
    return {
      ok: false,
      error: "orchestrator_unavailable",
      mode: "host_room_dispatch",
      room_id: roomId,
      message_id: messageId,
      note: "the message was routed and recorded, but nothing was asked to answer",
    };
  }

  let res;
  try {
    res = await surface.orchestrateRoom({
      room: roomId,
      task: text,
      to: entry.responders || [],
      policy: entry.responder_policy || "",
      message_id: messageId,
      force: Boolean(opts.force),
      report: opts.report,
      deps: opts.deps || {},
    });
  } catch (e) {
    return {
      ok: false,
      error: "orchestrate_failed",
      detail: String((e && e.message) || e),
      mode: "host_room_dispatch",
      room_id: roomId,
      message_id: messageId,
    };
  }

  if (!res || res.ok === false) {
    return {
      ok: false,
      error: (res && res.error) || "orchestrate_failed",
      mode: "host_room_dispatch",
      room_id: roomId,
      message_id: messageId,
      detail: res && res.detail,
      note: res && res.note,
      returned: (res && res.returned) || 0,
      total: (res && res.total) || 0,
    };
  }

  // 4) 顺手捡起「受理成立但这轮没答上」的转交凭据（GP-166）。
  //    放在用户那句话已经落盘、本轮扇出已经跑完之后：捡起是搭同一班车，不是插队。
  //    它失败不能把用户这轮的答案判成「没回」—— 但捡了几笔、有没有又卡住，
  //    必须原样带在回包里（新增**可选**字段 handoff_retry，既有契约字段一个不动）。
  let handoffRetry = null;
  if (typeof surface.retryPendingHandoffs === "function") {
    try {
      handoffRetry = await surface.retryPendingHandoffs({ room: roomId, deps: opts.deps || {} });
    } catch (e) {
      handoffRetry = {
        ok: false,
        mode: "host_handoff_retry",
        error: "handoff_retry_failed",
        detail: String((e && e.message) || e),
      };
    }
  }

  // 5) 如实汇总:N/总,不是「成功」。
  const total = Number(res.total || 0);
  const returned = Number(res.returned || 0);
  return {
    ok: true,
    mode: "host_room_dispatch",
    room_id: roomId,
    message_id: messageId,
    responder_policy: entry.responder_policy || "",
    // GP-53 契约：审批/Secret 卡不进群 transcript，只进对应 Bot 私聊。
    // roomTurn 把这个决定写在 escalations 上，扇出结果必须原样带出去——
    // 否则桌面/CLI/移动端读到的路由信息里，唯独「升级去哪」没了，契约成了空话。
    escalations: routed.escalations || "",
    responders: entry.responders || [],
    total,
    returned,
    partial: Boolean(res.partial) || returned < total,
    deduped: Boolean(res.deduped),
    skipped: Boolean(res.skipped),
    final_report: res.final_report || null,
    handoff_retry: handoffRetry,
  };
}

module.exports = { dispatchRoomTurn, newMessageId };
