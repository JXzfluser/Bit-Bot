"use strict";

/**
 * Shared room runtime — the responder / discretion turns of a group chat.
 *
 * Q-6: 「CLI / 移动端发的群消息没人回,而且不报错」。
 * 扇出这一步原先只在 hosts/desktop/main.js 的 Electron IPC handler 里;
 * 别的端(CLI、移动端、cn_inbound 的 /v1/turn、任何走内核 room_turn effect
 * 的调用)根本没有这一步。消息落盘了,没人回,也没报错。
 *
 * 这份实现把「谁该回 → 每个成员真的跑一个内核回合 → 汇总」从桌面搬下来,
 * 桌面和别的端用同一份代码 —— 一条路径,不会一个端回、另一个端不回。
 *
 * 需要注入的只有三样:
 *   runTurn        —— 跑一个 Bot 回合(桌面用 runner.runTurn,CLI 用同一个 runner)
 *   surface        —— 群/成员/转录的读写
 *   secretProtocol —— 脱敏规则(可空;空则只做调试行过滤)
 */

const path = require("path");
const { buildRoomContext: buildRoomContextData } = require("./room_context");
const { buildDiscretionPrompt, parseDiscretionReply } = require("./room_discretion");
const { resolveMachineId } = require("./machine_identity");

/** 调试/协议行不进共享转录。与桌面同一条规则。 */
const ROOM_DEBUG_RE =
  /(收到，正在用 MoonBit 内核处理|\[host\] ADR 0002|booting MoonBit|moon run cmd\/|Host effect planned|已计划 Host 效果|已计划群聊（GP-\d+|非 LocalBrain|BITBOT_LLM_[A-Z0-9_]*|token_refused|needs_host_ffi|__bb)|^已计划[^\n]*(Host |GP-|CM-|BITBOT_)/;

function roomSafeText(raw, secretProtocol) {
  let s = String(raw == null ? "" : raw);
  // token 形状的文本永远不进共享转录。
  if (secretProtocol && Array.isArray(secretProtocol.TOKEN_RULES)) {
    for (const rule of secretProtocol.TOKEN_RULES) {
      if (rule && rule.re) s = s.replace(new RegExp(rule.re.source, "g"), secretProtocol.REDACTED);
    }
  }
  return s
    .split("\n")
    .filter((line) => !ROOM_DEBUG_RE.test(line))
    .join("\n")
    .trim();
}

/**
 * @param {object} o
 * @param {Function} o.runTurn        (text, ctx) => Promise<result>
 * @param {object} o.surface
 * @param {object} [o.secretProtocol]
 * @param {Function} [o.onProgress]    (row) => void
 * @param {string}  [o.machineId]
 * @param {string}  [o.machineKind]
 * @param {number}  [o.discretionTimeoutMs]
 */
function createRoomRuntime(o) {
  const opts = o || {};
  const runTurn = opts.runTurn;
  const surface = opts.surface;
  const secretProtocol = opts.secretProtocol || null;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  // B-2: 机器身份不再写死(默认仍是 desk-1,单机行为不变)。
  const machineId = resolveMachineId({ kind: opts.machineKind, explicit: opts.machineId });
  const machineKind = String(opts.machineKind || "desktop");
  const discretionTimeoutMs = Number(
    opts.discretionTimeoutMs || process.env.BITBOT_ROOM_DISCRETION_TIMEOUT_MS || 30000,
  );

  const safe = (raw) => roomSafeText(raw, secretProtocol);

  function bots() {
    try {
      return (surface && surface.loadBots && surface.loadBots().bots) || [];
    } catch (_) {
      return [];
    }
  }

  function findBot(id) {
    const want = String(id || "").trim();
    if (!want) return null;
    return bots().find((b) => b && (b.id === want || b.name === want)) || null;
  }

  /** 群上下文:群名 + 成员 + 本轮被 @ 的人 + 最近 N 条转录。DM 路径不调它。 */
  function buildRoomContext(roomId, botId, ctx, task) {
    const rid = String(roomId || "").trim();
    if (!rid || !surface) return null;
    let room = null;
    try {
      const st = surface.roomsStoreStatus();
      if (!st || !st.ok) return null;
      room = ((st.rooms && st.rooms.rooms) || []).find((r) => r && r.id === rid) || null;
    } catch (_) {
      return null;
    }
    if (!room) return null;
    return buildRoomContextData({
      room,
      bots: bots(),
      botId,
      mentionedNames: (ctx && ctx.mentioned_names) || [],
      selfName: (ctx && ctx.name) || "",
      currentTask: task,
      sanitize: safe,
      maxField: 80,
      maxTotal: Number(process.env.BITBOT_ROOM_CONTEXT_MAX || 4000),
      maxRecent: Number(process.env.BITBOT_ROOM_RECENT_MAX || 6),
      maxLine: Number(process.env.BITBOT_ROOM_RECENT_LINE_MAX || 320),
    });
  }

  /** 成员回合:一个 Bot 真的跑一轮,回话就是它的答案。 */
  async function runResponderTurn(botId, task, ctx) {
    const id = String(botId || "").trim();
    if (!id) return { ok: false, error: "responder_missing", text: "", artifacts: [] };
    const bot = findBot(id);
    if (!bot) return { ok: false, error: "bot_not_found", text: "", artifacts: [] };
    const room = String((ctx && ctx.room) || "room");
    const rows = [];
    try {
      const result = await runTurn(String(task || ""), {
        sessionId: "room-" + room + "-" + id,
        machineId,
        machineKind,
        channel: "",
        // 编排不改变审批语义:群回合同样必须过原审批门。
        approved: false,
        botId: id,
        // 群里说出来的排程要归这个群管。
        roomId: room,
        roomContext: buildRoomContext(room, id, ctx, task),
        cancelPromise: (ctx && ctx.cancelPromise) || undefined,
        onProgress: (ev) => {
          const row = Object.assign({}, ev, { bot_id: id, room_id: room });
          rows.push(row);
          if (onProgress) {
            try {
              onProgress(row);
            } catch (_) {
              /* 进度广播不能影响回合 */
            }
          }
        },
      });
      const host = result && Array.isArray(result.host_results) ? result.host_results : [];
      const failed = host.filter((h) => h && h.ok === false);
      const assistants = ((result && result.messages) || [])
        .filter((m) => m && m.role === "assistant" && m.text)
        .map((m) => safe(m.text))
        .filter(Boolean);
      const artifacts = host
        .filter((h) => h && h.ok !== false && h.artifact_path)
        .map((h) => ({ name: path.basename(String(h.artifact_path)), path: String(h.artifact_path) }));
      if (result && result.ok === false) {
        return {
          ok: false,
          error: safe((result && result.error) || (failed[0] && failed[0].error) || "turn_failed"),
          text: assistants.join("\n"),
          artifacts,
        };
      }
      if (failed.length) {
        const f = failed.find((h) => h.kind === "llm_chat") || failed[0];
        return { ok: false, error: safe(f.error || "host_effect_failed"), text: assistants.join("\n"), artifacts };
      }
      if (!assistants.length) return { ok: false, error: "no_reply", text: "", artifacts };
      try {
        if (surface && typeof surface.touchBotActivity === "function") surface.touchBotActivity(id);
        if (typeof opts.onBotActivity === "function") opts.onBotActivity(id);
      } catch (_) {
        /* 活跃度戳是尽力而为 */
      }
      return { ok: true, text: assistants.join("\n"), artifacts, progress: rows.length };
    } catch (err) {
      return { ok: false, error: safe((err && err.message) || String(err)), text: "", artifacts: [] };
    }
  }

  /** 自决回合:「我这轮要不要应答」。 */
  async function runDiscretionTurn(botId, task, ctx) {
    const id = String(botId || "").trim();
    if (!id) return { ok: false, error: "responder_missing", text: "" };
    const bot = findBot(id);
    if (!bot) return { ok: false, error: "bot_not_found", text: "" };
    const roomId = String((ctx && ctx.room) || "room");
    const decisionCtx = Object.assign({}, ctx, { mentioned_names: [] });
    try {
      const result = await runTurn(buildDiscretionPrompt({ bot, task }), {
        sessionId: "room-" + roomId + "-" + id + "-discretion",
        machineId,
        machineKind,
        channel: "",
        approved: false,
        botId: id,
        roomId,
        roomContext: buildRoomContext(roomId, id, decisionCtx, task),
      });
      if (!result || result.ok === false) {
        return {
          ok: false,
          error: safe((result && result.error) || "discretion_turn_failed"),
          text: "",
        };
      }
      const text = ((result.messages || [])
        .filter((m) => m && m.role === "assistant" && m.text)
        .map((m) => String(m.text))
        .join("\n"));
      const respond = parseDiscretionReply(text);
      if (respond === null) {
        return { ok: false, error: "discretion_unclear", text: safe(text).slice(0, 200) };
      }
      return { ok: true, respond, text: safe(text).slice(0, 200) };
    } catch (err) {
      return { ok: false, error: safe((err && err.message) || String(err)), text: "" };
    }
  }

  /**
   * 成员自决:每个候选成员真的跑一轮自决回合。
   * 失败 → 失败开放(respond: true)并记下原因 —— **不许静默跳过成员**。
   */
  async function selectResponders({ room, task, candidates }) {
    const list = Array.isArray(candidates) ? candidates : [];
    const withTimeout = (promise, ms) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("discretion_timeout")), ms);
        Promise.resolve(promise).then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          },
        );
      });
    const decisions = await Promise.all(
      list.map(async (candidate) => {
        const ctx = {
          room,
          bot_id: candidate.id,
          name: candidate.name,
          job: candidate.job,
          description: candidate.description,
          mentioned_names: [],
        };
        try {
          const out = await withTimeout(runDiscretionTurn(candidate.id, task, ctx), discretionTimeoutMs);
          if (out && out.ok && typeof out.respond === "boolean") {
            return { bot_id: candidate.id, name: candidate.name, respond: out.respond };
          }
          return {
            bot_id: candidate.id,
            name: candidate.name,
            respond: true,
            fail_open: true,
            error: safe((out && out.error) || "discretion_failed"),
          };
        } catch (err) {
          return {
            bot_id: candidate.id,
            name: candidate.name,
            respond: true,
            fail_open: true,
            error: safe((err && err.message) || String(err)),
          };
        }
      }),
    );
    return {
      ok: true,
      responders: decisions.filter((d) => d.respond).map((d) => d.bot_id),
      decisions,
    };
  }

  return {
    buildRoomContext,
    runResponderTurn,
    runDiscretionTurn,
    selectResponders,
    roomSafeText: safe,
  };
}

module.exports = { createRoomRuntime, roomSafeText, ROOM_DEBUG_RE };
