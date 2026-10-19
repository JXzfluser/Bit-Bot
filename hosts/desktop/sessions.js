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
      return raw;
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
      sessions: state.sessions.map((s) => ({
        id: s.id,
        title: s.title || "对话",
        updated_at: s.updated_at,
        message_count: Array.isArray(s.messages) ? s.messages.length : 0,
      })),
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
      hit.messages.push({
        role: String(m.role),
        text: String(m.text || ""),
        at,
      });
    }
    if (hit.title === "新对话" || hit.title === "对话") {
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

  return {
    storePath,
    list,
    get,
    create,
    setActive,
    appendMessages,
    activeId,
  };
}

module.exports = { createSessionStore };
