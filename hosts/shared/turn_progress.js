"use strict";

/**
 * GP-96/97/98 — 进度更新 (official Grok spec §5.7).
 *
 * The official list of what the conversation stream must show is exactly:
 * 工具活动 / Computer 使用 / 创建的文件 / 问题 / 审批请求 / 语音消息, with
 * acceptance signals 「实时显示 Bot 工作进度」and「长时间任务有中间更新」.
 *
 * This module is the single place that turns a Host effect (and its real
 * result) into such a progress event. It is used by
 * hosts/shared/host_ffi.js (emission) and hosts/desktop/main.js /
 * hosts/cli_host/run_turn.js (transport), and asserted directly by
 * scripts/prove_gp96_progress.js — so the categories shown in the UI are the
 * categories the Host actually executed, never a scripted animation.
 *
 * Honesty rules baked in here:
 *  - `total` comes from the real effect array length, not a guess.
 *  - a `done` event only exists because an effect actually finished (or was
 *    actually refused/blocked) — refusals are reported, not swallowed.
 *  - a `path` is only attached when the file exists on disk right now.
 */

const fs = require("fs");
const path = require("path");

/*
 * The category vocabulary and the kind→category table live in ONE pure file —
 * progress_protocol.js — which the sandboxed renderer also loads as a classic
 * script. Re-declaring them here would let Host and UI drift while both look
 * green.
 */
let protocol;
try { protocol = require("../desktop/progress_protocol"); }
catch { try { protocol = require("../progress_protocol"); } catch { protocol = null; } }

if (!protocol) {
  // Missing policy would silently drop progress rows; fail loudly at load.
  throw new Error("progress_protocol.js not found (host/desktop shared policy)");
}

const CATEGORY_TOOL = protocol.CATEGORY_TOOL;
const CATEGORY_COMPUTER = protocol.CATEGORY_COMPUTER;
const CATEGORY_FILES = protocol.CATEGORY_FILES;
const CATEGORY_QUESTION = protocol.CATEGORY_QUESTION;
const CATEGORY_APPROVAL = protocol.CATEGORY_APPROVAL;
const CATEGORY_VOICE = protocol.CATEGORY_VOICE;
const CATEGORY_MODEL = protocol.CATEGORY_MODEL;

const categorizeEffect = protocol.categorizeEffect;

/** Pull a real, currently-existing path out of a Host result (GP-98). */
function existingPathFromResult(result, repoRoot) {
  if (!result) return "";
  const candidates = [];
  const push = (v) => {
    const s = String(v || "").trim();
    if (s && !candidates.includes(s)) candidates.push(s);
  };
  push(result.path);
  push(result.dest);
  push(result.saved_path);
  push(result.file_path);
  // Many Host results embed their JSON payload in stdout.
  const out = String(result.stdout || "");
  if (out && out.length < 400000) {
    try {
      const j = JSON.parse(out);
      if (j && typeof j === "object") {
        push(j.path);
        push(j.dest);
        push(j.saved_path);
        push(j.file_path);
      }
    } catch (_) {
      /* stdout is not JSON — no path claim */
    }
  }
  for (const c of candidates) {
    try {
      const abs = c.startsWith("/") ? c : path.resolve(repoRoot || ".", c);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    } catch (_) {
      /* unstatable path is not evidence of a created file */
    }
  }
  return "";
}

/**
 * createProgressEmitter({ onProgress, total, turnId, sessionId, repoRoot })
 * -> { start(index, effect), done(index, effect, result), raw(event) }
 *
 * `onProgress` may be absent (tests/CLI quiet mode) — then every method is a
 * no-op and execution is byte-for-byte unchanged.
 */
function createProgressEmitter(opts) {
  const o = opts || {};
  const onProgress = typeof o.onProgress === "function" ? o.onProgress : null;
  const total = Number(o.total) || 0;
  const base = {
    turn_id: String(o.turnId || ""),
    session_id: String(o.sessionId || ""),
    total,
  };
  const repoRoot = o.repoRoot || "";

  function emit(ev) {
    if (!onProgress) return;
    try {
      onProgress(ev);
    } catch (_) {
      /* progress is observational; a broken listener must never break a turn */
    }
  }

  function frame(phase, index, effect, result) {
    const kind = String((effect && effect.kind) || "");
    const category = categorizeEffect(kind, result);
    const row = {
      phase,
      index,
      total,
      kind,
      category,
      label_key: protocol.labelKeyFor(category),
      command: String((effect && effect.command) || "").slice(0, 160),
      at: new Date().toISOString(),
    };
    if (phase === "done" && result) {
      row.ok = Boolean(result.ok);
      if (result.needs_approval === true) row.awaiting = "approval";
      else if (result.needs_confirm === true || result.awaiting_confirm === true)
        row.awaiting = "question";
      else if (!result.ok) row.awaiting = "";
      const err = String(result.error || result.refused || "").trim();
      if (!result.ok) {
        const stderr = String(result.stderr || "").trim();
        row.error = (err || stderr || "effect_failed").slice(0, 200);
      }
      const p = existingPathFromResult(result, repoRoot);
      if (p) row.path = p;
    }
    return Object.assign({}, base, row);
  }

  return {
    start(index, effect) {
      emit(frame("start", index, effect, null));
    },
    done(index, effect, result) {
      emit(frame("done", index, effect, result));
    },
    raw(ev) {
      emit(Object.assign({}, base, ev));
    },
    enabled: Boolean(onProgress),
  };
}

module.exports = {
  CATEGORY_TOOL,
  CATEGORY_COMPUTER,
  CATEGORY_FILES,
  CATEGORY_QUESTION,
  CATEGORY_APPROVAL,
  CATEGORY_VOICE,
  CATEGORY_MODEL,
  categorizeEffect,
  existingPathFromResult,
  createProgressEmitter,
};
