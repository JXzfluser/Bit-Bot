"use strict";

/**
 * Durable Desktop chat sessions (Grok-style conversation list).
 * Stored under data/desktop/sessions.json — Host-side only, not LocalBrain.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createSessionStore(repoRoot) {
  const root = path.resolve(repoRoot);
  const dir = path.join(root, "data", "desktop");
  const storePath = path.join(dir, "sessions.json");

  function empty() {
    const id = "sess-" + crypto.randomBytes(4).toString("hex");
    const at = new Date().toISOString();
    return {
      version: 1,
      active_id: id,
      sessions: [
        {
          id,
          title: "新对话",
          created_at: at,
          updated_at: at,
          messages: [],
        },
      ],
    };
  }

  function newMessageId() {
    return "msg-" + crypto.randomBytes(4).toString("hex");
  }

  // GP-14: every stored message needs a stable id so Reply can point at one.
  // One-shot backfill for rows written before this wave (load is the single
  // entry point, so both reads and later writes see the same ids).
  function ensureMessageIds(state) {
    let changed = false;
    for (const s of state.sessions || []) {
      if (!Array.isArray(s.messages)) s.messages = [];
      for (const m of s.messages) {
        if (m && !m.id) {
          m.id = newMessageId();
          changed = true;
        }
      }
    }
    if (changed) save(state);
    return state;
  }

  function load() {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(storePath)) {
      const seed = empty();
      fs.writeFileSync(storePath, JSON.stringify(seed, null, 2));
      return seed;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
      if (!raw || !Array.isArray(raw.sessions) || !raw.sessions.length) {
        return empty();
      }
      if (!raw.active_id) raw.active_id = raw.sessions[0].id;
      return ensureMessageIds(raw);
    } catch {
      return empty();
    }
  }

  function save(state) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(state, null, 2));
  }

  function list() {
    const state = load();
    return {
      ok: true,
      active_id: state.active_id,
      sessions: state.sessions.map((s) => {
        // Grok-parity sidebar shows a one-line preview of the latest message.
        const msgs = Array.isArray(s.messages) ? s.messages : [];
        let preview = "";
        for (let i = msgs.length - 1; i >= 0; i--) {
          const t = String((msgs[i] && msgs[i].text) || "").replace(/\s+/g, " ").trim();
          if (t) { preview = t.slice(0, 40); break; }
        }
        return {
          id: s.id,
          title: s.title || "对话",
          updated_at: s.updated_at,
          message_count: msgs.length,
          preview,
        };
      }),
      path: storePath,
    };
  }

  function get(id) {
    const state = load();
    const want = String(id || state.active_id || "");
    const hit = state.sessions.find((s) => s.id === want) || state.sessions[0];
    return {
      ok: Boolean(hit),
      session: hit || null,
      active_id: state.active_id,
    };
  }

  function create(title) {
    const state = load();
    const at = new Date().toISOString();
    const id = "sess-" + crypto.randomBytes(4).toString("hex");
    const sess = {
      id,
      title: String(title || "新对话").trim() || "新对话",
      created_at: at,
      updated_at: at,
      messages: [],
    };
    state.sessions.unshift(sess);
    state.active_id = id;
    save(state);
    return { ok: true, session: sess, active_id: id };
  }

  function setActive(id) {
    const state = load();
    const hit = state.sessions.find((s) => s.id === String(id || ""));
    if (!hit) return { ok: false, error: "unknown session" };
    state.active_id = hit.id;
    save(state);
    return { ok: true, session: hit, active_id: hit.id };
  }

  function appendMessages(id, messages) {
    const state = load();
    const want = String(id || state.active_id || "");
    const hit = state.sessions.find((s) => s.id === want);
    if (!hit) return { ok: false, error: "unknown session" };
    if (!Array.isArray(hit.messages)) hit.messages = [];
    const at = new Date().toISOString();
    for (const m of messages || []) {
      if (!m || !m.role) continue;
      const row = {
        id: m.id || newMessageId(),
        role: String(m.role),
        text: String(m.text || ""),
        at,
      };
      // GP-14: keep the replied-to id in the transcript row so the quote
      // survives a reload instead of only living in this turn's memory.
      if (m.reply_to) row.reply_to = String(m.reply_to);
      // GP-102: a secret placeholder row keeps only the Host vault handle, so a
      // reload can rebuild `[REDACTED]` without ever storing the value.
      if (m.secret_handle) row.secret_handle = String(m.secret_handle);
      hit.messages.push(row);
    }
    const DEFAULT_TITLES = ["新对话", "对话", "New chat", "新對話", "工作"];
    if (DEFAULT_TITLES.indexOf(hit.title) >= 0) {
      const firstUser = hit.messages.find((m) => m.role === "user");
      if (firstUser && firstUser.text) {
        hit.title = firstUser.text.trim().slice(0, 28) || hit.title;
      }
    }
    hit.updated_at = at;
    save(state);
    return { ok: true, session: hit, active_id: state.active_id };
  }

  function activeId() {
    return load().active_id;
  }

  /** GP-14: resolve a message id (any session) → { id, session_id, role, text }. */
  function findMessage(messageId) {
    const want = String(messageId || "").trim();
    if (!want) return { ok: false, error: "empty message id" };
    const state = load();
    for (const s of state.sessions || []) {
      const hit = (s.messages || []).find((m) => m && String(m.id) === want);
      if (hit) {
        return {
          ok: true,
          id: hit.id,
          session_id: s.id,
          role: hit.role,
          text: String(hit.text || ""),
        };
      }
    }
    return { ok: false, error: "message_not_found", message_id: want };
  }

  function rename(id, title) {
    const state = load();
    const hit = state.sessions.find((s) => s.id === String(id || ""));
    if (!hit) return { ok: false, error: "unknown session" };
    const t = String(title || "").trim();
    if (!t) return { ok: false, error: "empty title" };
    hit.title = t.slice(0, 60);
    hit.updated_at = new Date().toISOString();
    save(state);
    return { ok: true, session: hit };
  }

  function remove(id) {
    const state = load();
    const want = String(id || "");
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((s) => s.id !== want);
    if (state.sessions.length === before) return { ok: false, error: "unknown session" };
    if (!state.sessions.length) {
      const fresh = empty();
      state.sessions = fresh.sessions;
      state.active_id = fresh.active_id;
    } else if (state.active_id === want) {
      state.active_id = state.sessions[0].id;
    }
    save(state);
    return { ok: true, active_id: state.active_id, removed: want };
  }

  // GP-M31 (§5.1 消息反应): toggle a reaction on a stored message. The store
  // is the single source of truth (single-user desktop → per-emoji counter);
  // reload renders the same chips from these rows.
  function react(sessionId, messageId, emoji, on) {
    const sid = String(sessionId || "").trim();
    const mid = String(messageId || "").trim();
    const emo = String(emoji || "").trim();
    if (!sid || !mid || !emo) return { ok: false, error: "invalid_reaction" };
    if (Array.from(emo).length > 8) return { ok: false, error: "invalid_reaction" };
    const want = on !== false;
    const state = load();
    const sess = (state.sessions || []).find((s) => s && s.id === sid);
    if (!sess) return { ok: false, error: "session_not_found", session_id: sid };
    const hit = (sess.messages || []).find((m) => m && String(m.id) === mid);
    if (!hit) return { ok: false, error: "message_not_found", message_id: mid };
    if (!hit.reactions || typeof hit.reactions !== "object" || Array.isArray(hit.reactions)) {
      hit.reactions = {};
    }
    const cur = Number(hit.reactions[emo]) || 0;
    const next = cur + (want ? 1 : -1);
    if (next > 0) hit.reactions[emo] = next;
    else delete hit.reactions[emo];
    save(state);
    return { ok: true, id: mid, session_id: sid, reactions: hit.reactions };
  }

  return {
    storePath,
    list,
    get,
    create,
    setActive,
    appendMessages,
    findMessage,
    activeId,
    rename,
    remove,
    react,
  };
}

module.exports = { createSessionStore };
