"use strict";

/**
 * Product Surface — Wave G Host data layer
 * CommonJS module, no Electron dependency.
 * API aligned with main.js/preload.js expectations.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function createProductSurface(repoRoot) {
  const REPO_ROOT = path.resolve(repoRoot);
  const DESKTOP_DIR = path.join(REPO_ROOT, "data", "desktop");
  const BOTS_PATH = path.join(DESKTOP_DIR, "bots.json");
  const APPROVAL_RULES_PATH = path.join(DESKTOP_DIR, "approval-rules.json");
  const PENDING_APPROVALS_PATH = path.join(DESKTOP_DIR, "pending-approvals.jsonl");
  const APPROVALS_LOG_PATH = path.join(DESKTOP_DIR, "approvals.log.jsonl");
  const SETTINGS_PATH = path.join(DESKTOP_DIR, "settings.json");
  const COMPUTER_PATH = path.join(DESKTOP_DIR, "computer.json");
  const LLM_USAGE_PATH = path.join(DESKTOP_DIR, "llm-usage.json");
  const ROOMS_PATH = path.join(DESKTOP_DIR, "rooms.json");
  const SESSIONS_PATH = path.join(DESKTOP_DIR, "sessions.json");
  const MEMORY_DIR = path.join(REPO_ROOT, "data", "memory");
  const MEMORY_STORE_PATH = path.join(MEMORY_DIR, "desktop-host.json");
  const PROFILE_VAULT_PATH = path.join(MEMORY_DIR, "profile-vault.json");
  const ACCOUNT_PROFILE_PATH = path.join(DESKTOP_DIR, "account-profile.json");
  const ROUTINES_DIR = path.join(REPO_ROOT, "data", "routines");
  const WORKSPACE_UPLOADS_DIR = path.join(REPO_ROOT, "data", "workspace", "uploads");
  const VOICE_DIR = path.join(DESKTOP_DIR, "voice");
  const FRAMES_DIR = path.join(DESKTOP_DIR, "frames");

  // Atomic write helper: tmp + rename
  function atomicWrite(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + ".tmp." + Date.now();
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  }

  function readJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return fallback;
    }
  }

  function appendJsonl(filePath, entry) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
  }

  function generateBotId() {
    return "bot-" + Math.random().toString(16).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ===== BOTS STORE =====
  function builtinAgentBit(now) {
    return {
      id: "agent-bit",
      name: "Bit Bot",
      job: "通用助手",
      description: "Bit Bot 默认智能体",
      avatar: "",
      hidden: false,
      pinned: true,
      created_at: now,
      updated_at: now,
    };
  }

  function loadBots() {
    // Missing file AND a half-written file (bots present, builtin row absent)
    // both have to come back with agent-bit. G-1b / G-6 / G-26 address that
    // id directly; seeding only when the file is absent leaves the row out
    // as soon as anything else creates bots.json first.
    let data = readJson(BOTS_PATH, null);
    let dirty = false;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      data = { version: 1, primary_id: "agent-bit", bots: [] };
      dirty = true;
    }
    if (!Array.isArray(data.bots)) {
      data.bots = [];
      dirty = true;
    }
    if (!data.bots.some((b) => b && b.id === "agent-bit")) {
      data.bots.unshift(builtinAgentBit(nowIso()));
      dirty = true;
    }
    if (!data.primary_id) {
      data.primary_id = "agent-bit";
      dirty = true;
    }
    if (!data.version) {
      data.version = 1;
      dirty = true;
    }
    if (dirty) atomicWrite(BOTS_PATH, JSON.stringify(data, null, 2));
    return data;
  }

  function saveBots(data) {
    atomicWrite(BOTS_PATH, JSON.stringify(data, null, 2));
  }

  /* §2.2 tags: comma-separated in the product phrase, stored as a small array.
     "-" is the explicit "clear tags" signal (an empty value cannot be sent
     through key=value phrases without reading as "unchanged"). */
  function normalizeTags(value) {
    if (Array.isArray(value)) {
      return value.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 8);
    }
    const raw = String(value == null ? "" : value).trim();
    if (raw === "-" || raw === "") return [];
    return raw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8);
  }

  /* G-28 · Bot 分组（Grok Bot 的侧栏把 Bot 按分组折叠，右侧显示数量）。
     分组只是**展示归属**，不是产品策略：不参与权限、审批、记忆与回合路由，
     所以它和 settings 一样由 Host 存储直写，不走 kernel 意图链。
     空字符串 = 未分组（侧栏渲染成「未分组」一节）。 */
  function normalizeGroup(value) {
    const raw = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (raw === "-") return "";
    return raw.slice(0, 24);
  }

  /* §2.2 avatar: a stored path is displayed as a data URL so the renderer never
     needs file:// access. Unreadable / oversized files are simply not shown. */
  function avatarDataUrl(bot) {
    const p = String((bot && bot.avatar) || "").trim();
    if (!p) return "";
    try {
      const abs = path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 512 * 1024) return "";
      const ext = path.extname(abs).toLowerCase();
      const mime =
        ext === ".png" ? "image/png"
          : ext === ".webp" ? "image/webp"
            : ext === ".gif" ? "image/gif"
              : "image/jpeg";
      return "data:" + mime + ";base64," + fs.readFileSync(abs).toString("base64");
    } catch (_) {
      return "";
    }
  }

  function botsCreate({ name, job, description, group }) {
    const data = loadBots();
    const bot = {
      id: generateBotId(),
      // §2.3: a skipped name still yields the official "New Bot" placeholder.
      name: String(name || "").trim() || "New Bot",
      job: String(job || "").trim(),
      description: String(description || "").trim(),
      group: normalizeGroup(group),
      avatar: "",
      tags: [],
      hidden: false,
      pinned: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    data.bots.push(bot);
    saveBots(data);
    return {
      ok: true,
      mode: "host_bot_create",
      pretend_saved: false,
      bot
    };
  }

  function botsUpdate({ bot_id, name, job, description, avatar, tags, group }) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_bot_update" };
    }

    // Validate avatar if provided. "-" clears the avatar; empty/undefined
    // means "leave unchanged" (the kernel omits the field in that case).
    if (avatar !== undefined && avatar !== null && avatar !== "") {
      if (avatar === "-") {
        bot.avatar = "";
      } else {
        const avatarPath = path.isAbsolute(avatar) ? avatar : path.join(REPO_ROOT, avatar);
        if (!fs.existsSync(avatarPath)) {
          return { ok: false, error: "invalid_avatar", mode: "host_bot_update" };
        }
        bot.avatar = avatar;
      }
    }

    if (tags !== undefined) bot.tags = normalizeTags(tags);
    // G-28: 分组走 "-"=清空 / 未提供=不变 的同一约定（kernel 省略字段时不动）。
    if (group !== undefined) bot.group = normalizeGroup(group);
    if (name !== undefined) bot.name = String(name || "").trim() || bot.name;
    if (job !== undefined) bot.job = String(job || "").trim();
    if (description !== undefined) bot.description = String(description || "").trim();
    bot.updated_at = nowIso();

    saveBots(data);
    return {
      ok: true,
      mode: "host_bot_update",
      pretend_saved: false,
      bot
    };
  }

  /* G-28 · 分组直写通道（渲染器右键菜单「移动到分组」）。分组是展示偏好，
     不经过 kernel 意图链——与 settings 一样的存储级 UI 状态。 */
  function botsSetGroup({ bot_id, group }) {
    const id = String(bot_id || "").trim();
    if (!id) return { ok: false, error: "bot_not_found", mode: "host_bot_group" };
    const data = loadBots();
    const bot = data.bots.find(b => b && b.id === id);
    if (!bot) return { ok: false, error: "bot_not_found", mode: "host_bot_group" };
    bot.group = normalizeGroup(group);
    bot.updated_at = nowIso();
    saveBots(data);
    const visible = (data.bots || []).filter(b => b && !b.hidden);
    const hidden = (data.bots || []).filter(b => b && b.hidden);
    return {
      ok: true,
      mode: "host_bot_group",
      pretend_saved: false,
      bot: decorateBot(bot),
      bots: visible.map(decorateBot),
      hidden_bots: hidden.map(decorateBot),
      primary_id: data.primary_id || (visible[0] && visible[0].id) || ""
    };
  }

  function botsDuplicate(bot_id) {
    const data = loadBots();
    const source = data.bots.find(b => b.id === bot_id);
    if (!source) {
      return { ok: false, error: "bot_not_found", mode: "host_bot_duplicate" };
    }
    // Generate unique name: "<name> copy", "<name> copy 2", etc.
    let baseName = source.name;
    let newName = baseName + " copy";
    let counter = 2;
    while (data.bots.some(b => b.name === newName)) {
      newName = baseName + " copy " + counter;
      counter++;
    }

    const duplicate = {
      id: generateBotId(),
      name: newName,
      job: source.job,
      description: source.description,
      avatar: source.avatar,
      tags: Array.isArray(source.tags) ? source.tags.slice() : [],
      hidden: false,
      pinned: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    data.bots.push(duplicate);
    saveBots(data);

    return {
      ok: true,
      mode: "host_bot_duplicate",
      pretend_saved: false,
      bot: duplicate
    };
  }

  function botsPin(bot_id, pinned) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_bot_pin" };
    }
    bot.pinned = Boolean(pinned);
    bot.updated_at = nowIso();
    saveBots(data);
    return {
      ok: true,
      mode: "host_bot_pin",
      pretend_saved: false,
      bot
    };
  }

  function botsSetPrimary(bot_id) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_bot_set_primary" };
    }
    data.primary_id = bot_id;
    saveBots(data);
    return {
      ok: true,
      mode: "host_bot_set_primary",
      pretend_saved: false,
      primary_id: bot_id
    };
  }

  function botsHide(bot_id) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_hide_bot" };
    }
    bot.hidden = true;
    bot.updated_at = nowIso();
    saveBots(data);
    return {
      ok: true,
      mode: "host_hide_bot",
      pretend_saved: false,
      bot
    };
  }

  function botsUnhide(bot_id) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_unhide_bot" };
    }
    bot.hidden = false;
    bot.updated_at = nowIso();
    saveBots(data);
    return {
      ok: true,
      mode: "host_unhide_bot",
      pretend_saved: false,
      bot
    };
  }

  /* GP-114: drop one Bot's memory slot from both memory files (store + vault),
     leaving every other Bot's slot untouched. Never throws: a missing or
     malformed store must not block the delete cascade. */
  function dropBotMemorySlot(botId) {
    const id = String(botId || "").trim();
    if (!id) return { dropped: false };
    let storeDropped = false;
    let vaultDropped = false;
    try {
      const store = readJson(MEMORY_STORE_PATH, null);
      if (store && store.bots && store.bots[id]) {
        delete store.bots[id];
        atomicWrite(MEMORY_STORE_PATH, JSON.stringify(store, null, 2));
        storeDropped = true;
      }
    } catch (_) { /* memory store missing or malformed, skip */ }
    try {
      const vault = readJson(PROFILE_VAULT_PATH, null);
      if (vault && vault.bots && vault.bots[id]) {
        delete vault.bots[id];
        atomicWrite(PROFILE_VAULT_PATH, JSON.stringify(vault, null, 2));
        vaultDropped = true;
      }
    } catch (_) { /* profile vault missing or malformed, skip */ }
    return { dropped: storeDropped || vaultDropped, store: storeDropped, vault: vaultDropped };
  }

  function botsDelete(bot_id, confirm) {
    if (confirm !== "yes") {
      return {
        ok: false,
        needs_confirm: true,
        advise_hide_first: true,
        bot_id,
        mode: "host_delete_bot"
      };
    }

    const data = loadBots();
    const botIndex = data.bots.findIndex(b => b.id === bot_id);
    if (botIndex === -1) {
      return { ok: false, error: "bot_not_found", mode: "host_delete_bot" };
    }

    // Never delete agent-bit
    if (bot_id === "agent-bit") {
      return { ok: false, error: "cannot_delete_builtin", mode: "host_delete_bot" };
    }

    const bot = data.bots[botIndex];
    data.bots.splice(botIndex, 1);
    let primaryReassigned = false;
    if (data.primary_id === bot_id) {
      data.primary_id = "agent-bit";
      primaryReassigned = true;
    }
    saveBots(data);

    // GP-07: routines bound to this bot must stop firing. The daemon sweeps
    // data/routines/host-routines.json, so remove bound rows *there* (plus
    // schedule artifacts), not just per-bot files under ROUTINES_DIR.
    let routines_deleted = 0;
    const ROUTINES_JSON_PATH = path.join(ROUTINES_DIR, "host-routines.json");
    try {
      const rows = readJson(ROUTINES_JSON_PATH, null);
      if (Array.isArray(rows)) {
        const bound = (r) =>
          r &&
          (String(r.id || "").includes(bot_id) ||
            String(r.prompt || "").includes(bot_id));
        const kept = rows.filter((r) => !bound(r));
        routines_deleted += rows.length - kept.length;
        if (kept.length !== rows.length) {
          atomicWrite(ROUTINES_JSON_PATH, JSON.stringify(kept, null, 2));
        }
      }
    } catch {
      // routines store missing or malformed, skip
    }
    try {
      if (fs.existsSync(ROUTINES_DIR)) {
        const files = fs.readdirSync(ROUTINES_DIR);
        for (const file of files) {
          if (!/^(schedule|list)-.*\.json$/.test(file)) continue;
          const filePath = path.join(ROUTINES_DIR, file);
          try {
            const content = fs.readFileSync(filePath, "utf8");
            if (content.includes(`owner=${bot_id}`) || file.includes(bot_id) ||
              (JSON.parse(content).prompt || "").includes(bot_id)) {
              fs.unlinkSync(filePath);
              routines_deleted++;
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // routines dir missing, skip
    }

    // GP-07: cascade sessions. sessions.json is {version, active_id, sessions:[]}
    // and DM sessions are titled "<bot name> · DM" (renderer convention),
    // with no per-bot field on the row itself.
    let sessions_deleted = 0;
    try {
      const store = readJson(SESSIONS_PATH, null);
      if (store && Array.isArray(store.sessions)) {
        const dmTitles = new Set([bot.name || bot_id, bot_id].map((x) => String(x) + " · DM"));
        const kept = store.sessions.filter(
          (s) => !(s && dmTitles.has(String(s.title || "")))
        );
        sessions_deleted = store.sessions.length - kept.length;
        if (sessions_deleted > 0) {
          store.sessions = kept;
          if (!kept.length) {
            store.active_id = "";
          } else if (kept.every((s) => s.id !== store.active_id)) {
            store.active_id = kept[0].id;
          }
          atomicWrite(SESSIONS_PATH, JSON.stringify(store, null, 2));
        }
      }
    } catch {
      // sessions.json missing or malformed, skip
    }

    // GP-07: remove the bot from rooms; drop rooms that fall below 2 members.
    let rooms_removed = 0;
    try {
      const rooms = requireWritableRooms();
      if (Array.isArray(rooms.rooms)) {
        for (const r of rooms.rooms) {
          if (Array.isArray(r.bot_ids)) r.bot_ids = r.bot_ids.filter((x) => x !== bot_id);
          if (Array.isArray(r.members)) r.members = r.members.filter((x) => x !== bot_id);
          if (Array.isArray(r.bots)) r.bots = r.bots.filter((x) => x !== bot_id);
        }
        const before = rooms.rooms.length;
        rooms.rooms = rooms.rooms.filter((r) => {
          const n = (r.bot_ids && r.bot_ids.length) || (r.members && r.members.length) || (r.bots && r.bots.length) || 0;
          return n >= 2;
        });
        rooms_removed = before - rooms.rooms.length;
        saveRooms(rooms);
      }
    } catch {
      // rooms store missing, skip
    }

    // Count workspace files kept
    let workspace_files_kept = 0;
    try {
      const workspaceDir = path.join(REPO_ROOT, "data", "workspace");
      if (fs.existsSync(workspaceDir)) {
        const countFiles = (dir) => {
          let count = 0;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              count += countFiles(fullPath);
            } else {
              count++;
            }
          }
          return count;
        };
        workspace_files_kept = countFiles(workspaceDir);
      }
    } catch {
      // workspace dir missing
    }

    // GP-114 (§4.2): memory is per Bot, so exactly one slot goes away with the
    // Bot. Other Bots' learned context is not ours to delete.
    const memory_dropped = dropBotMemorySlot(bot_id).dropped;

    return {
      ok: true,
      mode: "host_delete_bot",
      pretend_saved: false,
      sessions_cascaded: sessions_deleted > 0,
      sessions_deleted,
      memory_dropped,
      routines_deleted,
      rooms_removed,
      primary_reassigned: primaryReassigned,
      workspace_files_kept
    };
  }

  function decorateBot(bot) {
    return Object.assign({}, bot, {
      tags: Array.isArray(bot.tags) ? bot.tags : [],
      group: typeof bot.group === "string" ? bot.group : "",
      avatar_data_url: avatarDataUrl(bot),
    });
  }

  /* GP-124..127 (§2.1 right panel, §4.6 notifications): every field of the Bot
     settings panel is read from the store that actually owns it — profile from
     bots.json, memory count from this Bot's memory slot, routines by the same
     binding convention the delete cascade uses (id/prompt contains bot_id),
     sessions by the existing "<name> · DM" title convention. Nothing is
     synthesised: a missing store simply reports 0. */
  function botDetail(botId) {
    const id = String(botId || "").trim();
    if (!id) return { ok: false, error: "bot_not_found", bot_id: id, mode: "host_bot_detail" };
    const data = loadBots();
    const bot = (data.bots || []).find((b) => b && b.id === id);
    if (!bot) return { ok: false, error: "bot_not_found", bot_id: id, mode: "host_bot_detail" };

    let memoryEntries = 0;
    try {
      const store = readJson(MEMORY_STORE_PATH, null);
      const slot = store && store.bots && store.bots[id];
      if (slot && Array.isArray(slot.entries)) memoryEntries = slot.entries.length;
    } catch (_) { /* memory store missing → 0 entries */ }

    let routineCount = 0;
    let routineActive = 0;
    try {
      const rows = readJson(path.join(ROUTINES_DIR, "host-routines.json"), null);
      if (Array.isArray(rows)) {
        const bound = (r) => r && (String(r.id || "").includes(id) || String(r.prompt || "").includes(id));
        const hits = rows.filter(bound);
        routineCount = hits.length;
        routineActive = hits.filter((r) => r.enabled !== false && r.lifecycle !== "paused").length;
      }
    } catch (_) { /* routines store missing → 0 */ }

    let sessionCount = 0;
    let lastSessionAt = "";
    try {
      const store = readJson(SESSIONS_PATH, null);
      if (store && Array.isArray(store.sessions)) {
        const titles = new Set([String(bot.name || id) + " · DM", id + " · DM"]);
        const hits = store.sessions.filter((s) => s && titles.has(String(s.title || "")));
        sessionCount = hits.length;
        for (const s of hits) {
          if (String(s.updated_at || "") > lastSessionAt) lastSessionAt = String(s.updated_at || "");
        }
      }
    } catch (_) { /* sessions store missing → 0 */ }

    let roomCount = 0;
    try {
      const rooms = readJson(ROOMS_PATH, null);
      const rows = Array.isArray(rooms) ? rooms : (rooms && Array.isArray(rooms.rooms) ? rooms.rooms : []);
      roomCount = rows.filter((r) => Array.isArray(r && r.members) && r.members.includes(id)).length;
    } catch (_) { /* rooms store missing → 0 */ }

    const settings = loadSettings();
    const notifyMap = settings && settings.notify && typeof settings.notify === "object" ? settings.notify : {};
    return {
      ok: true,
      mode: "host_bot_detail",
      bot: decorateBot(bot),
      primary_id: data.primary_id || "",
      is_primary: String(data.primary_id || "") === id,
      notifications: notifyMap[id] !== false,
      notify_explicit: Object.prototype.hasOwnProperty.call(notifyMap, id),
      memory_entries: memoryEntries,
      routines_total: routineCount,
      routines_active: routineActive,
      sessions_total: sessionCount,
      last_session_at: lastSessionAt,
      rooms_total: roomCount,
    };
  }

  /* GP-126: one Bot's notification toggle must not clobber the other Bots'
     settings, and only a real boolean is accepted. */
  function botNotifySet(botId, on) {
    const id = String(botId || "").trim();
    if (!id) return { ok: false, error: "bot_not_found", mode: "host_bot_notify" };
    const data = loadBots();
    if (!(data.bots || []).some((b) => b && b.id === id)) {
      return { ok: false, error: "bot_not_found", bot_id: id, mode: "host_bot_notify" };
    }
    if (typeof on !== "boolean") {
      return { ok: false, error: "invalid_value", bot_id: id, mode: "host_bot_notify" };
    }
    const settings = loadSettings();
    const notify = settings.notify && typeof settings.notify === "object" ? settings.notify : {};
    notify[id] = on;
    settings.notify = notify;
    saveSettings(settings);
    return { ok: true, mode: "host_bot_notify", bot_id: id, notifications: on, notify_map: notify };
  }

  function listViews() {
    const data = loadBots();
    const visible = data.bots
      .filter(b => !b.hidden)
      .sort((a, b) => {
        // GP-117 (§2.1): pinned Bots are fixed at the top regardless of age,
        // then the list is ordered by real activity (updated_at).
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // Then by updated_at desc
        return new Date(b.updated_at) - new Date(a.updated_at);
      });
    const hidden = data.bots.filter(b => b.hidden);
    return {
      ok: true,
      bots: visible.map(decorateBot),
      hidden_bots: hidden.map(decorateBot),
      primary_id: data.primary_id
    };
  }

  /* GP-117: a Bot's position in the list comes from real activity, so the Host
     stamps updated_at whenever a turn belongs to that Bot. Cheap and idempotent:
     an unknown id is ignored rather than inventing a row. */
  function touchBotActivity(botId) {
    const id = String(botId || "").trim();
    if (!id) return { ok: false, error: "empty bot id" };
    const data = loadBots();
    const bot = (data.bots || []).find((b) => b && b.id === id);
    if (!bot) return { ok: false, error: "bot_not_found", bot_id: id };
    bot.updated_at = nowIso();
    saveBots(data);
    return { ok: true, bot_id: id, updated_at: bot.updated_at };
  }

  // ===== APPROVAL RULES =====
  function loadApprovalRules() {
    return readJson(APPROVAL_RULES_PATH, { version: 1, rules: [] });
  }

  function saveApprovalRules(data) {
    atomicWrite(APPROVAL_RULES_PATH, JSON.stringify(data, null, 2));
  }

  function approvalRuleUpsert({ pattern, decision, source }) {
    const data = loadApprovalRules();
    const existing = data.rules.find(r => r.pattern === pattern);
    if (existing) {
      if (existing.locked) {
        return { ok: false, error: "rule_locked", mode: "host_approval_rule" };
      }
      existing.decision = decision;
    } else {
      data.rules.push({
        pattern,
        decision,
        source: source || "personal",
        locked: source === "team",
        created_at: nowIso()
      });
    }
    saveApprovalRules(data);
    return {
      ok: true,
      rule: data.rules.find(r => r.pattern === pattern)
    };
  }

  function approvalRuleList() {
    const data = loadApprovalRules();
    return {
      ok: true,
      rules: data.rules
    };
  }

  // GP-73: personal rules removable; team/locked rows are not.
  function approvalRuleRemove(pattern) {
    const data = loadApprovalRules();
    const idx = data.rules.findIndex(r => r.pattern === pattern);
    if (idx < 0) return { ok: false, error: "rule_not_found", mode: "host_approval_rule_remove" };
    if (data.rules[idx].locked) return { ok: false, error: "rule_locked", mode: "host_approval_rule_remove" };
    const removed = data.rules.splice(idx, 1)[0];
    saveApprovalRules(data);
    return { ok: true, removed, mode: "host_approval_rule_remove" };
  }

  function approvalRuleMatch(kind, command) {
    const data = loadApprovalRules();
    const testPattern = `${kind}:${command || ""}`;
    
    // GP-22: ask takes priority over allow
    let askMatch = null;
    let allowMatch = null;

    for (const rule of data.rules) {
      if (matchPattern(rule.pattern, testPattern)) {
        if (rule.decision === "ask" && !askMatch) {
          askMatch = rule;
        } else if (rule.decision === "allow" && !allowMatch) {
          allowMatch = rule;
        }
      }
    }

    // ask takes priority
    if (askMatch) return "ask";
    if (allowMatch) return "allow";
    return null;
  }

  function matchPattern(rulePattern, testPattern) {
    // kind:* matches kind:anything
    if (rulePattern.endsWith(":*")) {
      const prefix = rulePattern.slice(0, -2);
      return testPattern.startsWith(prefix + ":");
    }
    // kind:prefix* matches kind:prefixAnything
    if (rulePattern.endsWith("*")) {
      const prefix = rulePattern.slice(0, -1);
      return testPattern.startsWith(prefix);
    }
    // Exact match
    return rulePattern === testPattern;
  }

  // ===== PENDING APPROVALS =====
  function appendPendingApproval({ source, kind, command, expires_at }) {
    const entry = {
      id: "approval-" + Date.now().toString(36),
      source: source || "chat",
      kind,
      command,
      requested_at: nowIso(),
      expires_at: expires_at || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      status: "pending"
    };
    appendJsonl(PENDING_APPROVALS_PATH, entry);
    return { ok: true, id: entry.id, mode: "host_pending_approval" };
  }

  function pendingApprovals(nowIsoParam) {
    try {
      if (!fs.existsSync(PENDING_APPROVALS_PATH)) {
        return [];
      }
      const lines = fs.readFileSync(PENDING_APPROVALS_PATH, "utf8").split("\n").filter(Boolean);
      const now = nowIsoParam ? new Date(nowIsoParam).getTime() : Date.now();
      return lines.map(line => {
        try {
          const entry = JSON.parse(line);
          // Calculate status based on expires_at
          if (entry.status === "pending" && new Date(entry.expires_at).getTime() < now) {
            entry.status = "expired";
          }
          return entry;
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  function approvalDecide(id, decision, nowIsoParam) {
    if (!["allow_once", "always", "deny"].includes(decision)) {
      return { ok: false, error: "invalid_decision", mode: "host_approval_decide" };
    }

    // Load all pending approvals
    let entries = [];
    try {
      if (fs.existsSync(PENDING_APPROVALS_PATH)) {
        const lines = fs.readFileSync(PENDING_APPROVALS_PATH, "utf8").split("\n").filter(Boolean);
        entries = lines.map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
      }
    } catch {
      return { ok: false, error: "read_failed", mode: "host_approval_decide" };
    }

    const entry = entries.find(e => e.id === id);
    if (!entry) {
      return { ok: false, error: "approval_not_found", mode: "host_approval_decide" };
    }
    if (entry.status === "decided") {
      return { ok: false, error: "already_decided", decision: entry.decision, id, mode: "host_approval_decide" };
    }
    // GP-23: expired background approvals still allow always-allow / deny, but not allow_once.
    const nowMs = nowIsoParam ? new Date(nowIsoParam).getTime() : Date.now();
    const isExpired =
      entry.status === "pending" &&
      entry.expires_at &&
      new Date(entry.expires_at).getTime() < nowMs;
    if (isExpired && decision === "allow_once") {
      return {
        ok: false,
        error: "approval_expired",
        id,
        kind: entry.kind,
        command: entry.command,
        mode: "host_approval_decide",
      };
    }
    // GP-23: expired approvals still allow always-allow / deny (rule persist below).

    entry.status = "decided";
    entry.decision = decision;
    entry.decided_at = nowIsoParam || nowIso();

    // Rewrite pending approvals file
    atomicWrite(PENDING_APPROVALS_PATH, entries.map(e => JSON.stringify(e)).join("\n") + "\n");

    // Log decision
    appendJsonl(APPROVALS_LOG_PATH, {
      id,
      decision,
      kind: entry.kind,
      command: entry.command,
      decided_at: entry.decided_at
    });

    let persisted_pattern;
    // If "always", upsert allow rule; pattern form `<kind>:*` so the host gate
    // (matchApprovalRule(kind) → "kind:") actually matches it (GP-21).
    if (decision === "always") {
      persisted_pattern = entry.kind + ":*";
      approvalRuleUpsert({ pattern: persisted_pattern, decision: "allow", source: "personal" });
    }

    return {
      ok: true,
      id,
      decision,
      kind: entry.kind,
      command: entry.command,
      item: entry,
      persisted_pattern,
      mode: "host_approval_decide"
    };
  }

  // GP-21: chat-sourced Deny receipt — append-only audit line, nothing executed.
  function logApprovalDeny({ source, kind, command }) {
    const entry = {
      id: "deny-" + Date.now().toString(36),
      source: source || "chat",
      decision: "deny",
      kind,
      command,
      decided_at: nowIso(),
      executed: false,
      pretend_executed: false
    };
    appendJsonl(APPROVALS_LOG_PATH, entry);
    return { ok: true, entry, mode: "host_approval_deny_receipt" };
  }

  // ===== SETTINGS =====
  // Timezone default = SYSTEM timezone (not hardcoded UTC). Priority:
  //   1. BITBOT_TZ (explicit, also drives the routine daemon)
  //   2. Intl resolved zone (Node/OS)
  //   3. TZ env
  //   4. "UTC" only as a last resort when the system really reports UTC.
  function systemTimezone() {
    try {
      const explicit = String(process.env.BITBOT_TZ || "").trim();
      if (explicit) return explicit;
      if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) return tz;
      }
      const tzEnv = String(process.env.TZ || "").trim();
      if (tzEnv) return tzEnv;
    } catch (_) { /* ignore */ }
    return "UTC";
  }

  function loadSettings() {
    const data = readJson(SETTINGS_PATH, {
      version: 1,
      appearance: "system",
      language: "zh-CN",
      timezone: systemTimezone(),
      timezone_explicit: false,
      local_execution: "ask",
      route_traffic: false,
      sidebar_collapsed: false,
      notify: {},
      unread: {}
    });
    // Migration: a legacy store that never had an explicit choice but shows the
    // old hardcoded "UTC" default is re-seeded to the system timezone. A UTC the
    // user actually picked (timezone_explicit === true) is preserved untouched.
    if (
      data &&
      (data.timezone === "UTC" || data.timezone == null) &&
      data.timezone_explicit !== true
    ) {
      data.timezone = systemTimezone();
      if (data.timezone_explicit === undefined) data.timezone_explicit = false;
    }
    return data;
  }

  function saveSettings(data) {
    atomicWrite(SETTINGS_PATH, JSON.stringify(data, null, 2));
  }

  function settingsGet() {
    return loadSettings();
  }

  function settingsPatch(patch) {
    const data = loadSettings();
    // Replica C4: search_default 是 composer「联网搜索」开关的持久位。不在白名单里
    // 会被静默 ignored —— 开关点了能亮、重启就忘。
    const allowed = new Set(["appearance", "language", "timezone", "timezone_explicit", "local_execution", "route_traffic", "notify", "unread", "sidebar_collapsed", "dev_mode", "search_default"]);
    const ignored = [];
    
    for (const key of Object.keys(patch)) {
      if (allowed.has(key)) {
        data[key] = patch[key];
      } else {
        ignored.push(key);
      }
    }
    
    saveSettings(data);
    return {
      ok: true,
      settings: data,
      ignored
    };
  }

  // ===== COMPUTER =====
  function loadComputer() {
    return readJson(COMPUTER_PATH, {
      version: 1,
      state: "ready",
      last_update_at: null,
      last_reset_at: null,
      last_recover_at: null,
      screens: {},
      takeover: { active: false }
    });
  }

  function saveComputer(data) {
    atomicWrite(COMPUTER_PATH, JSON.stringify(data, null, 2));
  }

  // GP-31: per-Bot screen state. Host computer-use/screenshot/takeover runs
  // record real frames + actions here so the right-side preview reflects the
  // Bot's actual activity (click / type / navigate / current state).
  // GP-30: one computer-use task at a time per Bot (spec §2.3). The lock is a
  // real file so separate Host processes (CLI smoke, Electron main) contend on
  // the same state; a hold is only trusted while fresh (< TTL) — a crashed
  // process's lock expires instead of blocking the Bot forever.
  const CU_LOCK_DIR = path.join(REPO_ROOT, "data", "desktop", "cu-locks");
  const CU_LOCK_TTL_MS = Number(process.env.BITBOT_CU_LOCK_TTL_MS || 120000);

  function cuLockPath(bot_id) {
    return path.join(CU_LOCK_DIR, String(bot_id || "agent-bit") + ".json");
  }

  function cuLockAcquire(bot_id, task) {
    const id = String(bot_id || "agent-bit");
    fs.mkdirSync(CU_LOCK_DIR, { recursive: true });
    const p = cuLockPath(id);
    const now = Date.now();
    try {
      if (fs.existsSync(p)) {
        const held = JSON.parse(fs.readFileSync(p, "utf8"));
        const age = now - (Date.parse(held.at || "") || 0);
        if (Number.isFinite(age) && age < CU_LOCK_TTL_MS) {
          return {
            ok: false,
            busy: true,
            held_by: id,
            held_since: held.at,
            held_task: String(held.task || "").slice(0, 120),
            age_ms: age,
            mode: "host_computer_use_lock",
          };
        }
      }
    } catch {
      // corrupt lock file — treat as expired and take over
    }
    const entry = { bot_id: id, task: String(task || "").slice(0, 200), at: new Date(now).toISOString(), pid: process.pid };
    atomicWrite(p, JSON.stringify(entry, null, 2));
    return { ok: true, mode: "host_computer_use_lock", lock_path: p, entry };
  }

  function cuLockRelease(bot_id) {
    const p = cuLockPath(bot_id);
    let released = false;
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        released = true;
      }
    } catch {
      // best-effort; TTL will expire it
    }
    return { ok: true, released, mode: "host_computer_use_lock" };
  }

  function cuLockStatus() {
    const out = [];
    try {
      if (fs.existsSync(CU_LOCK_DIR)) {
        for (const f of fs.readdirSync(CU_LOCK_DIR)) {
          if (!f.endsWith(".json")) continue;
          try {
            out.push(JSON.parse(fs.readFileSync(path.join(CU_LOCK_DIR, f), "utf8")));
          } catch { /* skip corrupt */ }
        }
      }
    } catch { /* no locks dir */ }
    return { ok: true, holds: out, mode: "host_computer_use_lock" };
  }

  function recordComputerAction({ bot_id, action, detail, frame_path, status }) {
    const id = String(bot_id || "agent-bit");
    const data = loadComputer();
    if (!data.screens || typeof data.screens !== "object") data.screens = {};
    const prev = data.screens[id] || { actions: [] };
    const at = nowIso();
    const entry = {
      action: String(action || "observe"),
      detail: String(detail || "").slice(0, 200),
      frame_path: frame_path && fs.existsSync(String(frame_path)) ? String(frame_path) : null,
      at,
    };
    const actions = Array.isArray(prev.actions) ? prev.actions : [];
    actions.push(entry);
    data.screens[id] = {
      status: String(status || prev.status || "active"),
      frame_path: entry.frame_path || prev.frame_path || null,
      last_action: entry.action,
      last_detail: entry.detail,
      updated_at: at,
      actions: actions.slice(-12),
    };
    saveComputer(data);
    return { ok: true, mode: "host_computer_screen_record", screen: data.screens[id] };
  }

  // GP-140 (§3.1): the Computer's browser profile is ONE durable user-data-dir
  // shared by every Bot (official: a site a Bot signed into stays available to
  // the others). Login *markers* live in computer.json so any Bot can read
  // them; real cookie contents / cloud microVM remain external (honest residual).
  function sharedBrowserState() {
    const data = loadComputer();
    const sb =
      data.shared_browser && typeof data.shared_browser === "object"
        ? data.shared_browser
        : {};
    const profileDir = path.join(
      REPO_ROOT,
      "data",
      "connectors",
      "identity",
      "chrome-user-data",
    );
    return {
      data,
      shared_browser: {
        user_data_dir: sb.user_data_dir || profileDir,
        shared_across_bots: true,
        sites: sb.sites && typeof sb.sites === "object" ? sb.sites : {},
      },
    };
  }

  function recordSharedBrowserSession({ bot_id, site, signed_in = true, detail }) {
    const name = String(site || "").trim();
    if (!name) return { ok: false, error: "site_required", mode: "host_computer_shared_session" };
    const id = String(bot_id || "agent-bit");
    const at = nowIso();
    const { data, shared_browser } = sharedBrowserState();
    try {
      fs.mkdirSync(shared_browser.user_data_dir, { recursive: true });
    } catch (_) {
      /* profile dir is best-effort on read-only hosts */
    }
    shared_browser.sites[name] = {
      signed_in: signed_in !== false,
      by_bot: id,
      at,
      detail: String(detail || "").slice(0, 160),
    };
    data.shared_browser = shared_browser;
    saveComputer(data);
    return {
      ok: true,
      mode: "host_computer_shared_session",
      site: name,
      by_bot: id,
      shared_browser,
      visible_to_bots: "all",
      pretend_cookies: false,
      real_cloud_vm: false,
      at,
    };
  }

  function readSharedBrowserSession({ bot_id } = {}) {
    const { shared_browser } = sharedBrowserState();
    const sites = shared_browser.sites;
    return {
      ok: true,
      mode: "host_computer_shared_session",
      asker_bot: String(bot_id || "agent-bit"),
      shared_across_bots: true,
      user_data_dir: shared_browser.user_data_dir,
      sites,
      signed_in_sites: Object.keys(sites).filter((s) => sites[s] && sites[s].signed_in),
      visible_to_bots: "all",
      pretend_cookies: false,
      real_cloud_vm: false,
      cookie_sandbox_residual: true,
      note: "共享登录标记可跨 Bot 读取；真实 Cookie/云 microVM 属外部依赖（诚实残留）。",
    };
  }

  function computerFrame(botId) {
    // Look for latest frame for this bot
    try {
      if (!fs.existsSync(FRAMES_DIR)) {
        return { path: null, at: null, residual: "no_frame" };
      }
      const files = fs.readdirSync(FRAMES_DIR)
        .filter(f => f.endsWith(".png") && (!botId || f.includes(botId)))
        .map(f => ({
          name: f,
          path: path.join(FRAMES_DIR, f),
          mtime: fs.statSync(path.join(FRAMES_DIR, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);
      
      if (files.length === 0) {
        return { path: null, at: null, residual: "no_frame" };
      }
      
      const latest = files[0];
      return {
        path: latest.path,
        at: new Date(latest.mtime).toISOString(),
        residual: null
      };
    } catch {
      return { path: null, at: null, residual: "no_frame" };
    }
  }

  function takeoverBegin({ bot_id, reason, session_id }) {
    const data = loadComputer();
    data.takeover = {
      active: true,
      bot_id: bot_id || "user",
      reason: reason || "",
      session_id: session_id || null,
      started_at: nowIso()
    };
    saveComputer(data);
    
    // Try to capture screenshot if DISPLAY available
    let frame_path = null;
    try {
      const display = process.env.DISPLAY;
      if (display) {
        fs.mkdirSync(FRAMES_DIR, { recursive: true });
        const frameFile = path.join(FRAMES_DIR, `takeover-${bot_id || "user"}-${Date.now()}.png`);
        // Try scrot or import
        try {
          execFileSync("scrot", [frameFile], { timeout: 3000, stdio: "ignore" });
          if (fs.existsSync(frameFile)) frame_path = frameFile;
        } catch {
          try {
            execFileSync("import", ["-window", "root", frameFile], { timeout: 3000, stdio: "ignore" });
            if (fs.existsSync(frameFile)) frame_path = frameFile;
          } catch { /* no screenshot tool */ }
        }
      }
    } catch { /* screenshot failed */ }
    
    return {
      ok: true,
      mode: "host_takeover_begin",
      pretend_saved: false,
      takeover: data.takeover,
      frame_path
    };
  }

  function takeoverEnd({ bot_id, handback_at }) {
    const data = loadComputer();
    data.takeover = {
      active: false,
      bot_id: bot_id || data.takeover.bot_id,
      handback_at: handback_at || nowIso()
    };
    saveComputer(data);
    return {
      ok: true,
      mode: "host_takeover_end",
      pretend_saved: false,
      takeover: data.takeover
    };
  }

  function recoverComputer(now, force) {
    const data = loadComputer();
    if (data.state !== "error" && !force) {
      return {
        ok: false,
        error: "recover only from error state",
        advise: "update_computer",
        mode: "host_recover_computer"
      };
    }

    // Count workspace files
    let workspace_files_kept = 0;
    try {
      const workspaceDir = path.join(REPO_ROOT, "data", "workspace");
      if (fs.existsSync(workspaceDir)) {
        const countFiles = (dir) => {
          let count = 0;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              count += countFiles(fullPath);
            } else {
              count++;
            }
          }
          return count;
        };
        workspace_files_kept = countFiles(workspaceDir);
      }
    } catch {
      // workspace dir missing
    }

    data.state = "ready";
    data.last_recover_at = now || nowIso();
    saveComputer(data);

    return {
      ok: true,
      mode: "host_recover_computer",
      pretend_saved: false,
      workspace_files_kept,
      computer: data
    };
  }

  // ===== ROOMS =====
  /* 群资料库（room.library）——
     条目 = {id, title, kind, path?, added_at}。path 只允许落在 repo 内
     （与 openArtifact 同一把尺子），所以资料库里存的路径永远真的能打开。
     写侧 fail closed：rooms.json 读不出来就不写，绝不把用户的群聊历史覆盖成空。 */
  const ROOM_LIBRARY_MAX = 50;
  function roomLibraryItems(room) {
    const raw = room && Array.isArray(room.library) ? room.library : [];
    return raw
      .filter((x) => x && typeof x === "object" && String(x.title || "").trim())
      .map((x) => ({
        id: String(x.id || ""),
        title: String(x.title || "").trim(),
        kind: String(x.kind || "doc"),
        path: String(x.path || ""),
        added_at: String(x.added_at || ""),
      }));
  }
  function roomLibraryList(roomId) {
    const rid = String(roomId || "").trim();
    if (!rid) return { ok: false, error: "room_id_required", items: [] };
    const hit = parseRoomsRaw();
    if (hit.unreadable) return { ok: false, error: ROOMS_UNREADABLE + ":" + hit.reason, items: [] };
    const rooms = Array.isArray(hit.data.rooms) ? hit.data.rooms : [];
    const room = rooms.find((r) => r && String(r.id) === rid);
    if (!room) return { ok: false, error: "room_not_found", items: [] };
    return { ok: true, room_id: rid, items: roomLibraryItems(room) };
  }
  function roomLibraryAdd(roomId, entries) {
    const rid = String(roomId || "").trim();
    if (!rid) return { ok: false, error: "room_id_required", items: [] };
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return { ok: false, error: "no_entries", items: [] };
    let data = null;
    try {
      data = requireWritableRooms(); // 坏文件直接抛，绝不写成空目录
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), items: [] };
    }
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    const room = rooms.find((r) => r && String(r.id) === rid);
    if (!room) return { ok: false, error: "room_not_found", items: [] };
    const items = roomLibraryItems(room);
    const seen = new Set(items.map((x) => x.path).filter(Boolean));
    const added = [];
    for (const e of list) {
      const title = String((e && e.title) || "").trim();
      if (!title) continue;
      const p = String((e && e.path) || "").trim();
      if (p) {
        // 路径必须在 repo 内 —— 与 openArtifact 同一把尺子，否则资料库里会
        // 出现「点了打不开」的条目。
        const resolved = path.resolve(p);
        const root = path.resolve(REPO_ROOT);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
          return { ok: false, error: "path_outside_repo", items: items.concat(added) };
        }
        if (seen.has(resolved)) continue;
        seen.add(resolved);
      }
      if (items.length + added.length >= ROOM_LIBRARY_MAX) {
        return { ok: false, error: "library_full", max: ROOM_LIBRARY_MAX, items: items.concat(added) };
      }
      added.push({
        id: "lib-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
        title,
        kind: String((e && e.kind) || "doc"),
        path: p,
        added_at: nowIso(),
      });
    }
    if (!added.length) return { ok: true, added: 0, items };
    room.library = items.concat(added);
    saveRooms(data);
    return { ok: true, added: added.length, items: roomLibraryItems(room) };
  }

  function loadRooms() {
    return readJson(ROOMS_PATH, { version: 1, rooms: [] });
  }

  // GP-146：rooms.json 坏掉时 readJson 会静默回落成「空目录」。读侧把这种状态
  // 如实报出来（渲染层才能区分「群里没消息」和「我读不到」）；写侧必须 fail
  // closed —— 落一次空目录就把用户全部群聊历史覆盖没了，这是数据丢失，不是降级。
  const ROOMS_UNREADABLE = "rooms_store_unreadable";
  function parseRoomsRaw() {
    let raw;
    try { raw = fs.readFileSync(ROOMS_PATH, "utf8"); }
    catch (e) { return { unreadable: true, reason: "rooms_file_unreadable" }; }
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return { unreadable: true, reason: "rooms_json_parse_failed" }; }
    if (!data || typeof data !== "object" || !Array.isArray(data.rooms)) {
      return { unreadable: true, reason: "rooms_shape_invalid" };
    }
    return { data, unreadable: false, reason: "" };
  }
  function roomsStoreStatus() {
    if (!fs.existsSync(ROOMS_PATH)) return { ok: true, rooms: { version: 1, rooms: [] } };
    const hit = parseRoomsRaw();
    if (hit.unreadable) return { ok: false, error: ROOMS_UNREADABLE + ":" + hit.reason };
    return { ok: true, rooms: hit.data };
  }
  // 只给「要落盘」的路径用：文件不存在可以当空目录开（还没有群），坏文件不行。
  function requireWritableRooms() {
    if (!fs.existsSync(ROOMS_PATH)) return { version: 1, rooms: [] };
    const hit = parseRoomsRaw();
    if (hit.unreadable) { const err = new Error(ROOMS_UNREADABLE + ":" + hit.reason); err.code = ROOMS_UNREADABLE; throw err; }
    return hit.data;
  }

  function saveRooms(data) {
    atomicWrite(ROOMS_PATH, JSON.stringify(data, null, 2));
  }

  /* G-28 #4「团队详情抽屉 · 成员管理」的 Host 落点。
     群成员是 2–6 人的硬边界（与 roomCreate 同一条尺子），所以两侧都先验后写：
       · 加人 —— Bot 必须真实存在于 bots.json，且还不在群里，加完不超过 6；
       · 移人 —— 必须是当前成员，移完不少于 2。
     拒绝时点名返回原因（room_not_found / bot_not_found / already_member /
     not_member / members_2_to_6），ok:true 只代表 store 真落了盘。
     成功时追加一条 kind:"system" transcript —— 群里看得见「谁进谁出」，
     而不是 members 数组在背后悄悄变了。 */
  const ROOM_MEMBERS_MIN = 2;
  const ROOM_MEMBERS_MAX = 6;
  function roomBotName(botId) {
    try {
      const data = loadBots();
      const b = (data.bots || []).find(x => x && x.id === botId);
      return b ? String(b.name || b.id) : String(botId);
    } catch (_) { return String(botId); }
  }
  function roomMembersUpdate(input) {
    const opts = input || {};
    const roomKey = String(opts.room || "").trim();
    const botId = String(opts.bot_id || "").trim();
    const act = String(opts.action || "").trim();
    if (!roomKey || !botId) return { ok: false, error: "members_need_room_and_bot" };
    if (act !== "add" && act !== "remove") return { ok: false, error: "action_unsupported" };
    let rooms;
    try { rooms = requireWritableRooms(); }
    catch (err) { return { ok: false, error: String((err && err.code) || "rooms_store_unreadable") }; }
    const hit = (rooms.rooms || []).find(r => r && (r.id === roomKey || r.title === roomKey));
    if (!hit) return { ok: false, error: "room_not_found", room: roomKey };
    if (!Array.isArray(hit.members)) hit.members = [];
    const isMember = hit.members.indexOf(botId) >= 0;
    if (act === "add") {
      let known;
      try {
        const bots = loadBots();
        known = (bots.bots || []).some(x => x && x.id === botId);
      } catch (_) {
        return { ok: false, error: "bots_store_unreadable" };
      }
      if (!known) return { ok: false, error: "bot_not_found", bot: botId };
      if (isMember) return { ok: false, error: "already_member", bot: botId, members: hit.members.slice() };
      if (hit.members.length + 1 > ROOM_MEMBERS_MAX) {
        return { ok: false, error: "members_2_to_6", max: ROOM_MEMBERS_MAX, members: hit.members.slice() };
      }
      hit.members.push(botId);
    } else {
      if (!isMember) return { ok: false, error: "not_member", bot: botId, members: hit.members.slice() };
      if (hit.members.length - 1 < ROOM_MEMBERS_MIN) {
        return { ok: false, error: "members_2_to_6", min: ROOM_MEMBERS_MIN, members: hit.members.slice() };
      }
      hit.members = hit.members.filter(x => x !== botId);
    }
    const name = roomBotName(botId);
    const at = nowIso();
    if (!Array.isArray(hit.transcript)) hit.transcript = [];
    hit.transcript.push({
      kind: "system",
      room_id: hit.id,
      speaker: "system",
      text: act === "add" ? `＋ ${name} 加入了群聊。` : `－ ${name} 离开了群聊。`,
      at
    });
    if (hit.transcript.length > 200) hit.transcript = hit.transcript.slice(-200);
    saveRooms(rooms);
    return {
      ok: true,
      mode: "host_room_members_update",
      action: act,
      room: hit.id,
      title: hit.title,
      bot: botId,
      members: hit.members.slice(),
      at
    };
  }

  /**
   * GP-148 §1-J2：自然语言建房的 Host 落点。三条硬要求：
   *  1) 名字认不出来就点名返回 names_not_found，绝不建「少一个人的残群」，
   *     也绝不返回 ok:true 假装成功；
   *  2) 同成员 + 同群名在短窗内重复 → 返回既有群（幂等），不新建第二个；
   *  3) 建房成功时在 transcript 落一条确定的 kind:"system" 回执行（带群名与
   *     成员名单），用户在同一次回合里就能看见「群真的建出来了」，侧栏也有成员数。
   * 既有返回形状 {ok,mode,pretend_saved,room} 不变，只新增可选字段。
   */
  const ROOM_DUP_WINDOW_MS = Number(process.env.BITBOT_ROOM_DUP_WINDOW_MS || 10 * 60 * 1000);
  function roomCreate(bots_csv, title) {
    const data = loadBots();
    const botsList = data.bots;
    const nameOf = (id) => {
      const b = botsList.find(x => x && x.id === id);
      return b ? String(b.name || b.id) : String(id);
    };

    // Parse bots_csv
    const memberIds = String(bots_csv || "").split(",").map(s => s.trim()).filter(Boolean);

    // Resolve member IDs/names
    const resolved = [];
    const names_not_found = [];
    for (const idOrName of memberIds) {
      // Accept "bit" as alias for "agent-bit"
      if (idOrName === "bit" || idOrName === "agent-bit") {
        const bot = botsList.find(b => b.id === "agent-bit");
        if (bot) {
          if (!resolved.includes(bot.id)) resolved.push(bot.id);
        } else if (!names_not_found.includes(idOrName)) {
          names_not_found.push(idOrName);
        }
        continue;
      }
      const bot = botsList.find(b => b.id === idOrName || b.name === idOrName);
      if (bot) {
        if (!resolved.includes(bot.id)) resolved.push(bot.id);
      } else if (!names_not_found.includes(idOrName)) {
        names_not_found.push(idOrName);
      }
    }

    // 负例优先：只要有一个点名说不出来，就不建残群（哪怕剩下的人数已经够 2 个）。
    if (names_not_found.length) {
      return {
        ok: false,
        error: "names_not_found",
        names_not_found,
        resolved_names: resolved.map(nameOf),
        mode: "host_group_chat",
        pretend_saved: false
      };
    }

    if (resolved.length < 2 || resolved.length > 6) {
      return {
        ok: false,
        error: "members_2_to_6",
        resolved_count: resolved.length,
        names_not_found: [],
        mode: "host_group_chat",
        pretend_saved: false
      };
    }

    // Generate title if empty
    if (!title || !title.trim()) {
      const names = resolved.map(nameOf);
      title = `Group · ${names[0]} + ${names[1]}`;
    }
    const finalTitle = title.trim();
    const setKey = resolved.slice().sort().join(",");

    const rooms = requireWritableRooms();

    // 幂等：同成员同群名在短窗内重复 → 直接把既有群还给调用方，不新建。
    const dupMs = Number.isFinite(ROOM_DUP_WINDOW_MS) && ROOM_DUP_WINDOW_MS > 0
      ? ROOM_DUP_WINDOW_MS : 10 * 60 * 1000;
    const existing = (rooms.rooms || []).find(r => {
      if (!r || String(r.title || "") !== finalTitle) return false;
      if ((r.members || []).slice().sort().join(",") !== setKey) return false;
      const at = Date.parse(String(r.created_at || ""));
      return Number.isNaN(at) ? false : Date.now() - at <= dupMs;
    });
    if (existing) {
      return {
        ok: true,
        mode: "host_group_chat",
        existing: true,
        pretend_saved: false,
        room: existing
      };
    }

    const at = nowIso();
    const names = resolved.map(nameOf);
    const roomId = "room-" + Date.now().toString(36);
    const room = {
      id: roomId,
      title: finalTitle,
      members: resolved,
      created_at: at,
      // 确定的建房回执：内核不参与措辞，Host 一次写好，渲染层按 kind 渲染。
      transcript: [{
        kind: "system",
        room_id: roomId,
        speaker: "system",
        text: `已创建群聊「${finalTitle}」，成员 ${names.length} 人：${names.join("、")}。`,
        at
      }]
    };
    rooms.rooms.push(room);
    saveRooms(rooms);

    return {
      ok: true,
      mode: "host_group_chat",
      pretend_saved: false,
      room
    };
  }

  function roomTurn(room_id, text, now) {
    const rooms = requireWritableRooms();
    const room = rooms.rooms.find(r => r.id === room_id);
    if (!room) {
      return { ok: false, error: "room_not_found", mode: "host_room_turn" };
    }

    const botsData = loadBots();
    const members = room.members.map(id => {
      const bot = botsData.bots.find(b => b.id === id);
      return bot ? { id: bot.id, name: bot.name } : { id, name: id };
    });

    // Parse mentions — GP-51 semantics kept (@Name directed / @everyone all /
    // no @ = members decide), GP-144 extends it to several leading mentions so
    // "@A @B task" runs exactly the named members. Member names may contain
    // spaces ("市场 分析员") — at each position the longest member name wins,
    // then the single-token form, so both spellings keep routing.
    let responders = members;
    let responder_policy = "bot_discretion";
    const namedResponders = [];
    const unknownMentions = [];
    let wantsAll = false;
    let rest = String(text || "");
    while (/^@/.test(rest)) {
      const after = rest.slice(1);
      const hitMember = members
        .filter((m) => m.name && after.startsWith(m.name))
        .sort((a, b) => String(b.name).length - String(a.name).length)[0];
      const tokenMatch = after.match(/^[^\s]+/);
      const token = tokenMatch ? tokenMatch[0] : "";
      if (!hitMember && token === "everyone") {
        wantsAll = true;
        rest = after.slice(token.length).replace(/^\s*/, "");
        continue;
      }
      const name = hitMember ? hitMember.name : token;
      if (!name) break;
      const target = members.find((m) => m.name === name || m.id === name);
      if (target && !namedResponders.some((x) => x.id === target.id)) {
        namedResponders.push(target);
      } else if (!target && !wantsAll && unknownMentions.length < 5) {
        // 打错了 / 不在本群：不能假装定向成功，渲染层要如实说明「按未点名处理」。
        unknownMentions.push(String(name).slice(0, 40));
      }
      rest = after.slice(name.length).replace(/^\s*/, "");
    }
    if (wantsAll) {
      responder_policy = "all";
    } else if (namedResponders.length) {
      responders = namedResponders;
      responder_policy = "mentioned_only";
    }
    // A typed mention that resolves to no member leaves the GP-51 default
    // untouched: members decide, the Host never invents a directed route.

    const transcript_entry = {
      // GP-146: the durable transcript now renders per entry, so a user row is
      // explicitly typed. Rows written before this have no `kind` — the renderer
      // keeps showing them as user lines instead of dropping them.
      kind: "user",
      speaker: "user",
      room_id,
      text,
      responders: responders.map(r => r.id),
      responder_policy,
      unknown_mentions: unknownMentions.length ? unknownMentions : undefined,
      at: now || nowIso()
    };
    // AR-08：无 @ 时 responders 是候选池，不是已确定的发言者；真正的选择由
    // 每个 Bot 的 discretion 回合决定，final_report.responders 才是结果。
    if (responder_policy === "bot_discretion") transcript_entry.responders_are_candidates = true;

    return {
      ok: true,
      mode: "host_room_turn",
      pretend_saved: false,
      transcript_entry,
      escalations: "dm-only"
    };
  }

  // GP-51/52: persist the routed line into the room's durable transcript (capped at 200).
  function appendRoomTranscript(room_id, entry) {
    const rooms = requireWritableRooms();
    const room = rooms.rooms.find(r => r.id === room_id);
    if (!room) return { ok: false, error: "room_not_found" };
    if (!Array.isArray(room.transcript)) room.transcript = [];
    room.transcript.push(entry);
    if (room.transcript.length > 200) room.transcript = room.transcript.slice(-200);
    saveRooms(rooms);
    return { ok: true, mode: "host_room_transcript_append" };
  }

  // GP-143/144: orchestrate one task across room responders, then aggregate a
  // `final_report`. The per-responder LLM turn is *injected* (`deps.runResponderTurn`)
  // because in production it is executed by the MoonBit turn runner; this engine
  // owns routing, guards, the transcript schema and honest N/总 aggregation so it
  // is unit-testable without a kernel. Guards (per plan G-E): membership, budget
  // ≤6, recursion depth (a responder turn must not re-enter orchestration),
  // idempotency (one final_report per task), per-responder timeout.
  const _orchInflight = new Set();

  // GP-146 持久层有界合同：房间转录是共享面，任何一行都不能无界增长——完整正文
  // 已经由那条 bot_reply 行承载，final_report 的分区/任务只留摘要，失败原因截断。
  // 上限可由环境收紧（默认与渲染合同一致，渲染层不再自己裁长度）。
  const ROOM_TEXT_MAX = Math.max(200, Number(process.env.BITBOT_ROOM_TEXT_MAX || 4000));
  const ROOM_SUMMARY_MAX = 240;
  const ROOM_REASON_MAX = 200;
  const ROOM_TASK_MAX = 240;
  function clipRoomText(raw, max) {
    const s = String(raw == null ? "" : raw);
    const limit = Number(max) > 0 ? Number(max) : ROOM_TEXT_MAX;
    if (s.length <= limit) return { text: s, truncated: false };
    return { text: s.slice(0, limit) + "…", truncated: true };
  }
  function orchestrateRoom(input) {
    const opts = input || {};
    const deps = opts.deps || {};
    const roomKey = String(opts.room || "").trim();
    const task = String(opts.task || "").trim();
    if (!roomKey || !task) {
      return { ok: false, error: "orchestrate_needs_room_and_task", mode: "host_orchestrate_room" };
    }
    const rooms = requireWritableRooms();
    const room = (rooms.rooms || []).find(r => r.id === roomKey || r.title === roomKey);
    if (!room) return { ok: false, error: "room_not_found", room: roomKey, mode: "host_orchestrate_room" };

    const bots = (loadBots().bots) || [];
    const resolve = (idOrName) => {
      const b = bots.find(x => x.id === idOrName || x.name === idOrName);
      return b ? { id: b.id, name: b.name, job: b.job || "", description: b.description || "" } : null;
    };
    const memberIds = room.members || [];
    const toList = Array.isArray(opts.to)
      ? opts.to
      : String(opts.to || "").split(",").map(s => s.trim()).filter(Boolean);
    let responders;
    if (toList.length) {
      responders = [];
      for (const t of toList) {
        const r = resolve(t);
        if (!r) return { ok: false, error: "responder_not_found", responder: t, mode: "host_orchestrate_room" };
        if (!memberIds.includes(r.id)) return { ok: false, error: "responder_not_member", responder: r.id, mode: "host_orchestrate_room" };
        if (!responders.some(x => x.id === r.id)) responders.push(r);
      }
    } else {
      responders = memberIds.map(resolve).filter(Boolean);
    }
    if (responders.length < 1) return { ok: false, error: "no_responders", mode: "host_orchestrate_room" };
    if (responders.length > 6) return { ok: false, error: "too_many_responders", count: responders.length, max: 6, mode: "host_orchestrate_room" };
    const responderPolicy = String(opts.policy || (toList.length ? "mentioned_only" : "bot_discretion")).trim();

    const taskSig = room.id + "|" + task.toLowerCase();
    if (_orchInflight.has(taskSig)) {
      return { ok: false, error: "orchestrate_recursion", depth: 1, mode: "host_orchestrate_room" };
    }
    const prior = (room.transcript || []).find(e => e && e.kind === "final_report" && e.task_sig === taskSig);
    if (prior && !opts.force) {
      // 幂等命中：不扇出、不起新回合，只回既有汇报。渲染层据此说明「未重复执行」，
      // 不能让人以为刚刚又跑了一遍。
      return {
        ok: true, mode: "host_orchestrate_room", deduped: true,
        returned: prior.returned, total: prior.total, partial: prior.partial,
        responder_policy: prior.responder_policy || opts.policy || "", final_report: prior,
      };
    }
    if (typeof deps.runResponderTurn !== "function") {
      return {
        ok: false, error: "responder_runner_required", mode: "host_orchestrate_room",
        note: "GP-143 responder turn is run by the MoonBit runner; inject deps.runResponderTurn",
      };
    }
    if (responderPolicy === "bot_discretion" && typeof deps.selectResponders !== "function") {
      return {
        ok: false, error: "discretion_selector_required", mode: "host_orchestrate_room",
        note: "bot_discretion must be a real per-member decision; inject deps.selectResponders",
      };
    }

    const timeoutMs = Number(deps.timeoutMs || 120000);
    const decisionTimeoutMs = Number(deps.discretionTimeoutMs || Math.min(timeoutMs, 30000));
    const at = nowIso();
    const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("responder_timeout")), ms);
      Promise.resolve(promise).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
    const candidates = responders.slice();
    const cleanDecisions = (list) => {
      if (!Array.isArray(list)) return undefined;
      return list.slice(0, 6).map((d) => {
        const id = String((d && d.bot_id) || "").trim();
        if (!id) return null;
        const out = {
          bot_id: id,
          name: clipRoomText((d && d.name) || "", 80).text,
          respond: Boolean(d && d.respond),
        };
        if (d && d.fail_open) out.fail_open = true;
        if (d && d.error) out.error = clipRoomText(d.error, ROOM_REASON_MAX).text;
        return out;
      }).filter(Boolean);
    };

    _orchInflight.add(taskSig);
    return (async () => {
      let selected = candidates;
      let discretion;
      if (responderPolicy === "bot_discretion") {
        let picked;
        try {
          picked = await withTimeout(deps.selectResponders({
            room: room.id,
            task,
            candidates: candidates.map((r) => Object.assign({}, r)),
            member_count: memberIds.length,
          }), decisionTimeoutMs);
        } catch (e) {
          return {
            ok: false, error: "discretion_failed",
            detail: String((e && e.message) || e), mode: "host_orchestrate_room",
          };
        }
        if (!picked || picked.ok === false) {
          return {
            ok: false, error: (picked && picked.error) || "discretion_failed",
            mode: "host_orchestrate_room",
          };
        }
        if (!Array.isArray(picked.responders)) {
          return { ok: false, error: "discretion_result_invalid", mode: "host_orchestrate_room" };
        }
        const ids = new Set(picked.responders.map((id) => String(id)));
        selected = candidates.filter((r) => ids.has(r.id));
        discretion = cleanDecisions(picked.decisions);
      }
      const discretionFailOpen = Array.isArray(discretion)
        ? discretion.filter((d) => d && d.fail_open).length
        : 0;
      if (!selected.length) {
        const final_report = {
          kind: "final_report", room_id: room.id, responder_policy: responderPolicy,
          task: clipRoomText(task, ROOM_TASK_MAX).text,
          task_sig: taskSig,
          task_title: clipRoomText(String(opts.report || task).trim() || task, ROOM_TASK_MAX).text,
          responders: [], total: 0, returned: 0, partial: false, skipped: true,
          sections: [], artifacts: [], discretion,
          discretion_fail_open: discretionFailOpen || undefined, at,
        };
        appendRoomTranscript(room.id, final_report);
        return {
          ok: true, mode: "host_orchestrate_room", skipped: true,
          returned: 0, total: 0, partial: false, final_report,
        };
      }
      // 「工作中」态只在真的扇出时给出（dedupe / 护栏拒绝 / 全员弃权都不会闪假状态）。
      if (typeof deps.onFanout === "function") {
        try {
          deps.onFanout({
            room: room.id, task, responders: selected, candidates,
            policy: responderPolicy, member_count: memberIds.length, discretion,
          });
        } catch (_) {
          /* 进度提示是 best effort，不能拖垮编排 */
        }
      }
      const settled = await Promise.allSettled(selected.map(async (r) => {
        // GP-148 §1-J3：除身份之外，把「本轮被 @ 的是谁」也带给 Host —— 这是
        // provider 群上下文里唯一无法从 rooms.json 反推的事实（路由已经算好了）。
        const ctx = {
          room: room.id,
          bot_id: r.id,
          name: r.name,
          job: r.job,
          description: r.description,
          mentioned_names: responderPolicy === "bot_discretion"
            ? []
            : selected.map((x) => String((x && x.name) || "")).filter(Boolean),
        };
        try {
          const out = await withTimeout(deps.runResponderTurn(r.id, task, ctx), timeoutMs);
          return { bot_id: r.id, name: r.name, ok: !!(out && out.ok !== false), text: String((out && out.text) || ""), artifacts: (out && out.artifacts) || [], error: (out && out.error) || null };
        } catch (e) {
          return { bot_id: r.id, name: r.name, ok: false, text: "", artifacts: [], error: String((e && e.message) || e) };
        }
      }));
      const sections = settled.map((res, i) => res.status === "fulfilled" ? res.value : { bot_id: selected[i].id, name: selected[i].name, ok: false, text: "", artifacts: [], error: String(res.reason || "unknown") });
      for (const s of sections) {
        // 共享转录的每一行都有界：正文由 bot_reply 行承载，汇报里只留摘要；
        // 失败原因截断后再落盘，不把整段 provider 负载抄进 rooms.json。
        const body = clipRoomText(s.text, ROOM_TEXT_MAX);
        const entry = {
          kind: s.ok ? "bot_reply" : "bot_reply_error",
          room_id: room.id, speaker: s.bot_id, bot_id: s.bot_id, name: s.name,
          text: body.text, at,
        };
        if (body.truncated) entry.text_truncated = true;
        if (!s.ok) {
          const why = clipRoomText(s.error || "no_reply", ROOM_REASON_MAX);
          entry.error = why.text;
          if (why.truncated) entry.error_truncated = true;
        }
        appendRoomTranscript(room.id, entry);
      }
      const returned = sections.filter(s => s.ok).length;
      const total = sections.length;
      const final_report = {
        kind: "final_report", room_id: room.id, responder_policy: responderPolicy,
        task: clipRoomText(task, ROOM_TASK_MAX).text,
        task_sig: taskSig,
        task_title: clipRoomText(String(opts.report || task).trim() || task, ROOM_TASK_MAX).text,
        responders: selected.map(r => r.id), total, returned,
        partial: returned < total,
        sections: sections.map(s => {
          const sum = clipRoomText(s.ok ? s.text : `(${s.error || "no reply"})`, ROOM_SUMMARY_MAX);
          return {
            bot_id: s.bot_id, name: s.name, ok: s.ok,
            summary: sum.text, summary_truncated: sum.truncated || undefined,
            artifacts: s.artifacts,
          };
        }),
        artifacts: sections.flatMap(s => s.artifacts || []),
        discretion,
        discretion_fail_open: discretionFailOpen || undefined,
        at,
      };
      appendRoomTranscript(room.id, final_report);
      return { ok: true, mode: "host_orchestrate_room", returned, total, partial: final_report.partial, final_report };
    })().catch((e) => {
      return { ok: false, error: "orchestrate_failed", detail: String((e && e.message) || e), mode: "host_orchestrate_room" };
    }).finally(() => {
      _orchInflight.delete(taskSig);
    });
  }

  // GP-52: Bot→Bot task ownership transfer inside a product room. Both sides
  // must be real room members (or the user), the room must exist — otherwise
  // refuse honestly instead of inventing a transfer.
  function handoffTask({ room, from_bot, to_bot, task }) {
    const roomId = String(room || "").trim();
    const toId = String(to_bot || "").trim();
    const fromId = String(from_bot || "user").trim() || "user";
    const taskText = String(task || "").trim();
    if (!roomId || !toId || !taskText) {
      return { ok: false, error: "handoff_needs_room_to_task", mode: "host_handoff_task" };
    }
    const rooms = requireWritableRooms();
    const hit = (rooms.rooms || []).find(r => r.id === roomId || r.title === roomId);
    if (!hit) {
      return { ok: false, error: "room_not_found", room: roomId, mode: "host_handoff_task" };
    }
    const botsData = loadBots();
    const resolve = (idOrName) => {
      const b = (botsData.bots || []).find(x => x.id === idOrName || x.name === idOrName);
      return b ? b.id : idOrName;
    };
    const toResolved = resolve(toId);
    const fromResolved = fromId === "user" ? "user" : resolve(fromId);
    const isMember = (id) => (hit.members || []).includes(id);
    if (!isMember(toResolved)) {
      return {
        ok: false,
        error: "to_bot_not_member",
        room: hit.id,
        to_bot: toResolved,
        members: hit.members || [],
        mode: "host_handoff_task",
        pretend_transferred: false
      };
    }
    if (fromResolved !== "user" && !isMember(fromResolved)) {
      return {
        ok: false,
        error: "from_bot_not_member",
        room: hit.id,
        from_bot: fromResolved,
        members: hit.members || [],
        mode: "host_handoff_task",
        pretend_transferred: false
      };
    }
    const nameOf = (id) => {
      const b = (botsData.bots || []).find(x => x.id === id);
      return b ? b.name : id;
    };
    const at = nowIso();
    const entry = {
      room_id: hit.id,
      kind: "handoff",
      text: `↪ task handed off: ${nameOf(fromResolved)} → ${nameOf(toResolved)} :: ${taskText}`,
      from_bot: fromResolved,
      to_bot: toResolved,
      task: taskText,
      responders: [toResolved],
      responder_policy: "handoff_target",
      at
    };
    if (!Array.isArray(hit.transcript)) hit.transcript = [];
    hit.transcript.push(entry);
    if (hit.transcript.length > 200) hit.transcript = hit.transcript.slice(-200);
    saveRooms(rooms);
    return {
      ok: true,
      mode: "host_handoff_task",
      pretend_transferred: false,
      room: hit.id,
      title: hit.title,
      from_bot: fromResolved,
      to_bot: toResolved,
      task: taskText,
      transcript_entry: entry,
      at
    };
  }

  // ===== ACCOUNT (GP-74) =====
  // Local-profile semantics only: the desktop app has no remote Bit Bot account
  // to talk to, so "signed in" always means a local profile row plus the real
  // credential sources that back it. Never fabricate a remote identity.
  function loadAccountProfile() {
    const d = readJson(ACCOUNT_PROFILE_PATH, null);
    if (!d || typeof d !== "object" || !Array.isArray(d.accounts)) {
      return { version: 1, active: null, accounts: [] };
    }
    return d;
  }

  function saveAccountProfile(data) {
    atomicWrite(ACCOUNT_PROFILE_PATH, JSON.stringify(data, null, 2));
  }

  // Truth table of the credential sources that actually exist on this machine.
  // Checks process.env AND the gitignored .env.local files, so CLI smoke and the
  // Electron main process report the same configured state.
  function envFileKeys() {
    const keys = new Set();
    for (const f of [
      path.join(REPO_ROOT, "hosts", "desktop", ".env.local"),
      path.join(REPO_ROOT, ".env.local"),
    ]) {
      try {
        if (!fs.existsSync(f)) continue;
        for (const line of fs.readFileSync(f, "utf8").split("\n")) {
          const m = /^([A-Z0-9_]+)=.+$/.exec(line.trim());
          if (m) keys.add(m[1]);
        }
      } catch (_) { /* unreadable env file counts as unset */ }
    }
    return keys;
  }

  function credentialSourceTruth() {
    const env = process.env;
    const fileKeys = envFileKeys();
    const src = (name, keys, file) => {
      const fromEnv = keys.map(k => String(env[k] || "").trim()).filter(Boolean);
      const inFile = keys.some(k => fileKeys.has(k));
      const onDisk = file ? fs.existsSync(path.join(REPO_ROOT, file)) : false;
      return { name, configured: fromEnv.length > 0 || inFile || onDisk, env_keys: keys, file: file || null };
    };
    return [
      src("llm", ["BITBOT_LLM_API_KEY"]),
      src("slack", ["SLACK_BOT_TOKEN", "BITBOT_SLACK_TOKEN"], "data/connectors/slack_token.json"),
      src("gmail", ["BITBOT_GMAIL_TOKEN"], "data/connectors/gmail_token.json"),
      src("outlook", ["BITBOT_OUTLOOK_TOKEN"], "data/connectors/outlook_token.json"),
      src("dingtalk", ["BITBOT_DINGTALK_WEBHOOK", "BITBOT_DINGTALK_TOKEN"]),
      src("feishu", ["BITBOT_FEISHU_TOKEN"]),
      src("wecom", ["BITBOT_WECOM_TOKEN"]),
    ];
  }

  function accountStatus() {
    const data = loadAccountProfile();
    const sources = credentialSourceTruth();
    const configured = sources.filter(s => s.configured).map(s => s.name);
    const active = data.active
      ? (data.accounts || []).find(a => a.label === data.active) || null
      : null;
    return {
      ok: true,
      mode: "host_account_status",
      signed_in: Boolean(active),
      // Honesty flags: we never claim a remote session we cannot verify.
      pretend_signed_in: false,
      remote_verified: false,
      scope: "local-profile",
      active: active
        ? {
            label: active.label,
            created_at: active.created_at,
            last_used_at: active.last_used_at,
            backed_by: active.backed_by || [],
          }
        : null,
      accounts: (data.accounts || []).map(a => ({
        label: a.label,
        created_at: a.created_at,
        last_used_at: a.last_used_at,
      })),
      credential_sources: sources,
      configured_sources: configured,
      note: active
        ? configured.length
          ? "local profile «" + active.label + "» backed by: " + configured.join(", ")
          : "local profile «" + active.label + "» has NO configured credentials — features needing them stay off"
        : "not signed in (no local profile); configure credentials under Settings · Credentials",
      at: nowIso()
    };
  }

  function accountSignIn(label) {
    const name = String(label || "").trim();
    if (!name) return { ok: false, error: "account_needs_label", mode: "host_account_sign_in" };
    const data = loadAccountProfile();
    const at = nowIso();
    const configured = credentialSourceTruth().filter(s => s.configured).map(s => s.name);
    let hit = (data.accounts || []).find(a => a.label === name);
    if (!hit) {
      hit = { label: name, created_at: at, last_used_at: at, backed_by: configured };
      data.accounts.push(hit);
    } else {
      hit.last_used_at = at;
      hit.backed_by = configured;
    }
    data.active = name;
    saveAccountProfile(data);
    return {
      ok: true,
      mode: "host_account_sign_in",
      pretend_remote_login: false,
      scope: "local-profile",
      label: name,
      created: hit.created_at === at,
      backed_by: configured,
      credentials_missing: credentialSourceTruth()
        .filter(s => !s.configured)
        .map(s => s.name),
      at
    };
  }

  function accountSignOut() {
    const data = loadAccountProfile();
    const was = data.active || null;
    data.active = null;
    saveAccountProfile(data);
    return {
      ok: true,
      mode: "host_account_sign_out",
      pretend_remote_signout: false,
      scope: "local-profile",
      signed_out: was,
      // Credentials are env/file-backed on this machine — sign-out never deletes them.
      credentials_untouched: true,
      at: nowIso()
    };
  }

  function accountSwitch(label) {
    const name = String(label || "").trim();
    if (!name) return { ok: false, error: "account_needs_label", mode: "host_account_switch" };
    const data = loadAccountProfile();
    const hit = (data.accounts || []).find(
      a => a.label.toLowerCase() === name.toLowerCase()
    );
    if (!hit) {
      return {
        ok: false,
        error: "account_not_found",
        wanted: name,
        known: (data.accounts || []).map(a => a.label),
        mode: "host_account_switch",
        pretend_switched: false
      };
    }
    data.active = hit.label;
    hit.last_used_at = nowIso();
    saveAccountProfile(data);
    return {
      ok: true,
      mode: "host_account_switch",
      pretend_switched: false,
      scope: "local-profile",
      label: hit.label,
      at: hit.last_used_at
    };
  }

  // ===== LLM USAGE =====
  function loadLlmUsage() {
    return readJson(LLM_USAGE_PATH, { version: 1, week: "", rows: [] });
  }

  function saveLlmUsage(data) {
    atomicWrite(LLM_USAGE_PATH, JSON.stringify(data, null, 2));
  }

  function getIsoWeek(date) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }

  function recordUsage({ provider, model, prompt_tokens, completion_tokens, at }) {
    const data = loadLlmUsage();
    const week = getIsoWeek(at || new Date());

    if (data.week !== week) {
      data.week = week;
      data.rows = [];
    }

    // Find or create row for this provider/model
    let row = data.rows.find(r => r.provider === provider && r.model === model);
    if (!row) {
      row = {
        at: at || nowIso(),
        provider,
        model,
        prompt_tokens: 0,
        completion_tokens: 0,
        requests: 0
      };
      data.rows.push(row);
    }

    row.prompt_tokens += Number(prompt_tokens) || 0;
    row.completion_tokens += Number(completion_tokens) || 0;
    row.requests += 1;
    row.at = at || nowIso();

    saveLlmUsage(data);
    return { ok: true, mode: "host_llm_usage_record" };
  }

  function llmUsageWeekView() {
    const data = loadLlmUsage();
    
    // Calculate totals
    const totals = data.rows.reduce((acc, row) => ({
      requests: acc.requests + (row.requests || 0),
      prompt_tokens: acc.prompt_tokens + (row.prompt_tokens || 0),
      completion_tokens: acc.completion_tokens + (row.completion_tokens || 0)
    }), { requests: 0, prompt_tokens: 0, completion_tokens: 0 });
    
    return {
      week: data.week,
      rows: data.rows,
      totals
    };
  }

  // ===== STAGE ATTACHMENTS =====
  // GP-11 (official Grok spec §5.5 附件 / desktop limits): ≤6 per send,
  // doc/image/audio ≤25 MB, video ≤200 MB. existingCount is what the composer
  // already holds, so repeated picks cannot smuggle past the per-send cap.
  // GP-142 (§5.5): encrypted/corrupt attachments must be rejected honestly as
  // `unreadable` — never staged or fed to the kernel as if readable. Checks are
  // conservative: only definitively-bad content is rejected (image magic bytes,
  // PDF header/Encrypt/EOF, text NUL/invalid-UTF8); unknown binaries pass.
  function _readProbe(file, headLen = 8192, tailLen = 2048) {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const head = Buffer.alloc(Math.min(headLen, size));
      if (head.length) fs.readSync(fd, head, 0, head.length, 0);
      let tail = Buffer.alloc(0);
      if (size > head.length) {
        const tlen = Math.min(tailLen, size - head.length);
        tail = Buffer.alloc(tlen);
        fs.readSync(fd, tail, 0, tlen, size - tlen);
      }
      return { size, head, tail };
    } finally {
      fs.closeSync(fd);
    }
  }
  function _unreadableReason(file, ext, kind) {
    let p;
    try { p = _readProbe(file); } catch (_) { return "io_unreadable"; }
    if (p.size === 0) return "empty_file";
    const h = p.head;
    if (kind === "image") {
      const png = h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
      const jpg = h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
      const gif = h.length >= 4 && h.slice(0, 4).toString("latin1") === "GIF8";
      const webp = h.length >= 12 && h.slice(0, 4).toString("latin1") === "RIFF" && h.slice(8, 12).toString("latin1") === "WEBP";
      return (png || jpg || gif || webp) ? null : "not_a_valid_image";
    }
    if (ext === ".pdf") {
      if (h.length < 5 || h.slice(0, 5).toString("latin1") !== "%PDF-") return "not_a_pdf";
      if (Buffer.concat([h, p.tail]).includes(Buffer.from("/Encrypt"))) return "encrypted_pdf";
      if (!p.tail.includes(Buffer.from("%%EOF")) && !h.includes(Buffer.from("%%EOF"))) return "truncated_pdf";
      return null;
    }
    if (kind === "doc") {
      const TEXT = [".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".js", ".mjs", ".cjs", ".ts", ".html", ".htm", ".css", ".xml", ".yaml", ".yml", ".toml", ".ini", ".sh", ".py"];
      if (TEXT.includes(ext)) {
        if (h.includes(0x00)) return "binary_not_text";
        try { new TextDecoder("utf-8", { fatal: true }).decode(h, { stream: true }); }
        catch (_) { return "invalid_utf8"; }
      }
    }
    return null;
  }

  function stageAttachments(paths, sessionId, existingCount = 0) {
    const held = Number.isInteger(existingCount) && existingCount > 0 ? existingCount : 0;
    if (!Array.isArray(paths) || paths.length + held > 6) {
      return {
        ok: false,
        code: "too_many_attachments",
        error: "too_many_attachments",
        max_per_send: 6,
        already_staged: held
      };
    }

    const staged = [];
    const resultPaths = [];
    const sessionDir = path.join(WORKSPACE_UPLOADS_DIR, String(sessionId || "default"));
    fs.mkdirSync(sessionDir, { recursive: true });

    for (const srcPath of paths) {
      if (!srcPath) {
        // Paste/drop without a real filesystem path (clipboard blob, web view
        // file): refuse honestly instead of staging a hallucinated path (CM-0106).
        return {
          ok: false,
          code: "no_real_path",
          error: "no_real_path",
          note: "附件没有真实磁盘路径，已拒绝（不伪造路径）"
        };
      }
      try {
        const stat = fs.statSync(srcPath);
        const basename = path.basename(srcPath);
        const ext = path.extname(basename).toLowerCase();

        // Classify and check size
        let kind;
        let maxSize;
        if ([".mp4", ".webm", ".mov"].includes(ext)) {
          kind = "video";
          maxSize = 200 * 1024 * 1024;
        } else if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
          kind = "image";
          maxSize = 25 * 1024 * 1024;
        } else if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) {
          kind = "audio";
          maxSize = 25 * 1024 * 1024;
        } else {
          kind = "doc";
          maxSize = 25 * 1024 * 1024;
        }

        if (stat.size > maxSize) {
          return {
            ok: false,
            code: `too_large:${basename}`,
            error: `too_large:${basename}`,
            kind,
            bytes: stat.size,
            max_bytes: maxSize
          };
        }

        // GP-142: reject encrypted/corrupt content honestly (never stage it).
        const unreadable = _unreadableReason(srcPath, ext, kind);
        if (unreadable) {
          return {
            ok: false,
            code: `unreadable:${basename}`,
            error: "unreadable",
            reason: unreadable,
            kind,
            note: "文件不可解码（加密/损坏），已诚实拒绝，未进入上下文"
          };
        }

        // Copy with timestamp prefix if name conflict
        let destName = basename;
        let destPath = path.join(sessionDir, destName);
        if (fs.existsSync(destPath)) {
          destName = `${Date.now()}-${basename}`;
          destPath = path.join(sessionDir, destName);
        }

        fs.copyFileSync(srcPath, destPath);
        const absPath = path.resolve(destPath);
        resultPaths.push(absPath);
        staged.push({
          src: srcPath,
          dst: absPath,
          bytes: stat.size,
          kind
        });
      } catch (err) {
        return {
          ok: false,
          error: `copy_failed:${srcPath}`
        };
      }
    }

    return {
      ok: true,
      paths: resultPaths,
      staged
    };
  }

  // GP-M30 (§5.1 附件在发送前可预览): read a staged attachment for the
  // composer chips. Images ≤2MB get a real data-URL thumbnail; everything
  // else reports kind/bytes — never a fabricated preview.
  function attachmentPreview(p) {
    const src = String(p || "").trim();
    if (!src) return { ok: false, error: "preview_unavailable" };
    try {
      const stat = fs.statSync(src);
      const ext = path.extname(src).toLowerCase();
      const name = path.basename(src);
      let kind = "doc";
      if ([".mp4", ".mov", ".avi", ".mkv"].includes(ext)) kind = "video";
      else if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) kind = "image";
      else if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) kind = "audio";
      let dataUrl = null;
      if (kind === "image" && stat.size <= 2 * 1024 * 1024) {
        const mime =
          ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
          ext === ".png" ? "image/png" :
          ext === ".gif" ? "image/gif" : "image/webp";
        dataUrl = "data:" + mime + ";base64," + fs.readFileSync(src).toString("base64");
      }
      return {
        ok: true,
        mode: "host_attachment_preview",
        name,
        ext,
        kind,
        bytes: stat.size,
        data_url: dataUrl,
        residual: kind === "image" && stat.size > 2 * 1024 * 1024 ? "image_too_large_for_preview" : null,
      };
    } catch (err) {
      return { ok: false, error: "preview_unavailable", detail: String(err && err.message || err) };
    }
  }

  // ===== VOICE INGEST =====
  function voiceIngest({ wav_b64, session, transcript_provider }) {
    try {
      fs.mkdirSync(VOICE_DIR, { recursive: true });
      const wavPath = path.join(VOICE_DIR, `voice-${session || "default"}-${Date.now()}.wav`);
      const wavBuffer = Buffer.from(wav_b64, "base64");
      fs.writeFileSync(wavPath, wavBuffer);
      
      return {
        ok: true,
        wav_path: wavPath,
        bytes: wavBuffer.length,
        transcript: null,
        residual: "no_stt"
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message || "voice_ingest_failed"
      };
    }
  }

  return {
    // Bots (new API names)
    botsCreate,
    botsUpdate,
    botsSetGroup,
    botsDuplicate,
    botsPin,
    botsSetPrimary,
    botsHide,
    botsUnhide,
    botsDelete,
    listViews,
    botDetail,
    botNotifySet,
    loadBots,
    touchBotActivity,

    // Bots (legacy aliases for host_ffi.js)
    createBot: botsCreate,
    updateBot: botsUpdate,
    duplicateBot: botsDuplicate,
    pinBot: botsPin,
    setPrimaryBot: botsSetPrimary,
    hideBot: botsHide,
    unhideBot: botsUnhide,
    deleteBot: botsDelete,
    listBotsView: listViews,

    // Approval rules
    approvalRuleUpsert,
    approvalRuleList,
    approvalRuleRemove,
    approvalRuleMatch,
    
    // Legacy aliases
    upsertApprovalRule: approvalRuleUpsert,
    listApprovalRules: approvalRuleList,
    removeApprovalRule: approvalRuleRemove,
    matchApprovalRule: (pattern) => {
      const result = approvalRuleMatch(pattern.split(":")[0], pattern.split(":").slice(1).join(":"));
      if (result === null) return { matched: false };
      return { matched: true, decision: result };
    },

    // Pending approvals
    appendPendingApproval,
    pendingApprovals,
    approvalDecide,
    logApprovalDeny,
    
    // Legacy aliases
    listPendingApprovals: () => ({ ok: true, pending: pendingApprovals(), mode: "host_pending_approval_list" }),
    decideApproval: approvalDecide,
    denyApprovalReceipt: logApprovalDeny,

    // Settings
    settingsGet,
    settingsPatch,
    loadSettings,
    
    // Legacy aliases
    getSettings: () => ({ ok: true, mode: "host_settings_get", settings: settingsGet() }),
    patchSettings: (patch) => {
      const result = settingsPatch(patch);
      return { ...result, mode: "host_settings_patch", pretend_saved: false };
    },

    // Computer
    computerFrame,
    recordComputerAction,
    recordSharedBrowserSession,
    readSharedBrowserSession,
    cuLockAcquire,
    cuLockRelease,
    cuLockStatus,
    takeoverBegin,
    takeoverEnd,
    recoverComputer,
    loadComputer,
    
    // Legacy aliases
    getComputer: () => ({ ok: true, mode: "host_computer_get", computer: loadComputer() }),
    patchComputer: (patch) => {
      const data = loadComputer();
      Object.assign(data, patch);
      saveComputer(data);
      return { ok: true, mode: "host_computer_patch", pretend_saved: false, computer: data };
    },
    beginTakeover: (bot_id, reason) => takeoverBegin({ bot_id, reason }),
    endTakeover: () => takeoverEnd({}),

    // Rooms
    roomCreate,
    roomTurn,
    orchestrateRoom,
    handoffTask,
    appendRoomTranscript,
    loadRooms,
    roomsStoreStatus,
    roomLibraryList,
    roomLibraryAdd,
    roomMembersUpdate,

    // Account (GP-74) — local profile semantics only
    accountStatus,
    accountSignIn,
    accountSignOut,
    accountSwitch,
    
    // Legacy aliases
    createRoom: roomCreate,

    // LLM usage
    recordUsage,
    llmUsageWeekView,
    
    // Legacy aliases
    weekView: llmUsageWeekView,

    // Attachments
    stageAttachments,
    attachmentPreview,

    // Voice
    voiceIngest
  };
}

module.exports = { createProductSurface };
