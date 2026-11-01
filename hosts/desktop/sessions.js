"use strict";

/**
 * Durable Desktop chat sessions (Grok-style conversation list).
 * Stored under data/desktop/sessions.json — Host-side only, not LocalBrain.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const eventMirror = require("./event_mirror_ref").loadEventMirror();
const eventReadModel = require("./event_mirror_ref").loadEventReadModel();

function createSessionStore(repoRoot, opts = {}) {
  const root = path.resolve(repoRoot);
  /* Sessions are user data: packaged builds keep them in the OS user-data
     dir, not inside the (read-only, replace-on-upgrade) app bundle. */
  const dataRoot = opts.dataRoot ? path.resolve(opts.dataRoot) : path.join(root, "data");
  const dir = path.join(dataRoot, "desktop");
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

  // T1-03 双写旁路：默认关（BITBOT_EVENT_DUAL_WRITE=1 才开），开也只是在同一
  // 次落盘后多追加几条事件；镜像失败不改这次写入的结果。
  const mirror = () => eventMirror.getSharedMirror(dataRoot);

  function writeStore(text) {
    const m = mirror();
    const token = m.capture(storePath);
    fs.writeFileSync(storePath, text);
    m.commit(storePath, token, text);
  }

  /* ===== T1-05 EVENT_ONLY（BITBOT_EVENT_ONLY=1）=====
     事件库成为唯一写路径与读真源；sessions.json 一个字节都不再写。
     diff 的左半边不再是「盘上文件」，而是内存里最后一次读到的状态文本
     （lastLoadedText，load() 的每条路都负责刷新它）——这就是「prev 从盘上
     搬进内存」。读模型的降级路在这里只用于「读」，写侧一律 fail loud：
     JSON 不再是备份，写失败吞掉就是静默丢数据（commitText 会往外抛）。 */
  const eventOnly = () => process.env.BITBOT_EVENT_ONLY === "1";
  let lastLoadedText = null;
  /* 遗留基底标记：load() 从遗留 JSON 读来且库还没有这张面的账时置位。
     delta diff 只记增量——基底（旧会话们）从没进过库，直接落 delta 会让
     顺序事件指向幽灵实体（EO-05 抓出来的）。所以首次写必须先从 BASELINE
     把基底导进去（与导入脚本同一语义），再落 delta。 */
  let legacyBasePending = false;
  const eventOnlySaid = new Set();
  function sayOnce(key, line) {
    if (eventOnlySaid.has(key)) return;
    eventOnlySaid.add(key);
    process.stderr.write(line);
  }

  function saveEventOnly(state) {
    const nextText = JSON.stringify(state, null, 2);
    const def = eventMirror.surfaceOf(storePath);
    const m = mirror();
    if (legacyBasePending) {
      m.commitText(def, null, lastLoadedText); // 基底导入（从 BASELINE，prevText=null）
      legacyBasePending = false;
    }
    m.commitText(def, lastLoadedText, nextText);
    lastLoadedText = nextText;
  }

  /** EVENT_ONLY 的「从 BASELINE 播种」：与导入脚本共用同一语义（prevText=null）。 */
  function seedEventOnly() {
    const seed = empty();
    mirror().commitText(eventMirror.surfaceOf(storePath), null, JSON.stringify(seed, null, 2));
    lastLoadedText = JSON.stringify(seed, null, 2);
    return seed;
  }

  /** 从 JSON 文本恢复 store（EVENT_ONLY 的遗留数据 / 降级路共用），并刷新 prev。 */
  function stateFromJsonText(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return empty();
    }
    if (!raw || !Array.isArray(raw.sessions) || !raw.sessions.length) {
      return empty();
    }
    if (!raw.active_id) raw.active_id = raw.sessions[0].id;
    lastLoadedText = text;
    return ensureMessageIds(raw);
  }

  // T1-04 读切换：BITBOT_EVENT_READ=1 时优先从事件日志折叠出 sessions 面。
  // 读模型不可用（没开双写→没有库 / 日志坏 / 折叠有 anomaly）就老实回退 JSON
  // 读，并打一行说明——绝不静默，也绝不把读失败当成「没有会话」。
  // 写侧照旧（JSON + 双写镜像），这条路只换「读」，这就是 T1-04 的边界。
  // 降级说明的「只说一次」闸：READ=1 时开机的头几次 load() 落在双写建库之前，
  // no_db 是预期状态，不能每次读都刷一行；但换一种失败原因（库坏 / anomaly）
  // 必须重新开口。RM-02/RM-06 断言的就是这第一行。
  const degradedSaid = new Set();

  function readFromEvents() {
    const hit = eventReadModel.readSurfaces(dataRoot);
    if (hit.ok && !hit.anomalies.length) {
      return { state: hit.sessions, source: "events", count: hit.count };
    }
    if (hit.ok) {
      // fold 有 anomaly 但 ok —— readSurfaces 已把这种情况降级为 ok:false，
      // 这里理论上到不了；到了就当作不可用处理。
      return { state: null, source: "events_anomalies", detail: hit.anomalies.join("; ") };
    }
    return { state: null, source: hit.reason, detail: hit.error || "" };
  }

  function load() {
    fs.mkdirSync(dir, { recursive: true });
    if (eventOnly()) {
      const hit = eventReadModel.readSurfaces(dataRoot);
      if (hit.ok && !hit.anomalies.length && hit.count > 0) {
        const raw = hit.sessions;
        if (!Array.isArray(raw.sessions) || !raw.sessions.length) {
          return seedEventOnly(); // 库里有事件但还没有会话：从 BASELINE 播种
        }
        if (!raw.active_id) raw.active_id = raw.sessions[0].id;
        lastLoadedText = JSON.stringify(raw);
        return ensureMessageIds(raw);
      }
      /* 库空（count===0）或读模型不可用：看有没有遗留 JSON。
         有 → 读它并说一句话（首次写入会把它增量带进事件库，即「自导入」；
         更稳妥是先跑导入脚本）；没有 → 正常播种。 */
      const legacyText = (() => {
        try {
          const j = JSON.parse(fs.readFileSync(storePath, "utf8"));
          return j && Array.isArray(j.sessions) && j.sessions.length ? fs.readFileSync(storePath, "utf8") : null;
        } catch {
          return null;
        }
      })();
      if (legacyText) {
        sayOnce(
          "legacy-sessions",
          "[sessions] BITBOT_EVENT_ONLY：事件库为空但存在遗留 sessions.json（未导入）——暂以 JSON 为读真源，" +
            "首次写入会把它增量带进事件库；建议先跑 scripts/import_json_to_events.mjs。\n",
        );
        legacyBasePending = true;
        return stateFromJsonText(legacyText);
      }
      if (hit.ok && hit.anomalies.length) {
        sayOnce("ano-sessions", `[sessions] BITBOT_EVENT_ONLY：事件折叠有异常（${hit.anomalies[0]}）——按空库处理，写入继续\n`);
      } else if (!hit.ok && hit.reason !== "no_db" && hit.reason !== "read_disabled") {
        sayOnce(`rm-sessions-${hit.reason}`, `[sessions] BITBOT_EVENT_ONLY：事件读模型不可用（${hit.reason}${hit.error ? ": " + hit.error : ""}）——按空库处理，写入继续\n`);
      }
      return seedEventOnly();
    }
    if (!fs.existsSync(storePath)) {
      const seed = empty();
      writeStore(JSON.stringify(seed, null, 2));
      return seed;
    }
    if (eventReadModel.eventReadEnabled()) {
      const hit = readFromEvents();
      if (hit.state) {
        const raw = hit.state;
        if (!Array.isArray(raw.sessions) || !raw.sessions.length) {
          return empty();
        }
        if (!raw.active_id) raw.active_id = raw.sessions[0].id;
        lastLoadedText = JSON.stringify(raw);
        return ensureMessageIds(raw);
      }
      if (!degradedSaid.has(hit.source)) {
        degradedSaid.add(hit.source);
        process.stderr.write(
          `[sessions] BITBOT_EVENT_READ 已开但事件读模型不可用（${hit.source}` +
            (hit.detail ? `: ${hit.detail}` : "") + "），本次回退 JSON 读。\n",
        );
      }
    }
    try {
      const text = fs.readFileSync(storePath, "utf8");
      const raw = JSON.parse(text);
      if (!raw || !Array.isArray(raw.sessions) || !raw.sessions.length) {
        lastLoadedText = text;
        return empty();
      }
      if (!raw.active_id) raw.active_id = raw.sessions[0].id;
      lastLoadedText = text;
      return ensureMessageIds(raw);
    } catch {
      return empty();
    }
  }

  function save(state) {
    if (eventOnly()) {
      saveEventOnly(state);
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    writeStore(JSON.stringify(state, null, 2));
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

  // Replica C3: delete a single stored message so a regenerated reply can
  // replace the old one atomically (reload never shows duplicates).
  function removeMessage(sessionId, messageId) {
    const sid = String(sessionId || "").trim();
    const mid = String(messageId || "").trim();
    if (!sid || !mid) return { ok: false, error: "invalid_message" };
    const state = load();
    const sess = (state.sessions || []).find((s) => s && s.id === sid);
    if (!sess) return { ok: false, error: "session_not_found", session_id: sid };
    const before = (sess.messages || []).length;
    sess.messages = (sess.messages || []).filter((m) => !(m && String(m.id) === mid));
    if (sess.messages.length === before) {
      return { ok: false, error: "message_not_found", message_id: mid };
    }
    sess.updated_at = new Date().toISOString();
    save(state);
    return { ok: true, session_id: sid, removed: mid };
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
    removeMessage,
  };
}

module.exports = { createSessionStore };
