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

  function botsCreate({ name, job, description }) {
    const data = loadBots();
    const bot = {
      id: generateBotId(),
      // §2.3: a skipped name still yields the official "New Bot" placeholder.
      name: String(name || "").trim() || "New Bot",
      job: String(job || "").trim(),
      description: String(description || "").trim(),
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

  function botsUpdate({ bot_id, name, job, description, avatar, tags }) {
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
      const rooms = loadRooms();
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
    const allowed = new Set(["appearance", "language", "timezone", "timezone_explicit", "local_execution", "route_traffic", "notify", "unread", "sidebar_collapsed", "dev_mode"]);
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
  function loadRooms() {
    return readJson(ROOMS_PATH, { version: 1, rooms: [] });
  }

  function saveRooms(data) {
    atomicWrite(ROOMS_PATH, JSON.stringify(data, null, 2));
  }

  function roomCreate(bots_csv, title) {
    const data = loadBots();
    const botsList = data.bots;

    // Parse bots_csv
    const memberIds = String(bots_csv || "").split(",").map(s => s.trim()).filter(Boolean);

    // Resolve member IDs/names
    const resolved = [];
    for (const idOrName of memberIds) {
      // Accept "bit" as alias for "agent-bit"
      if (idOrName === "bit" || idOrName === "agent-bit") {
        const bot = botsList.find(b => b.id === "agent-bit");
        if (bot) resolved.push(bot.id);
        continue;
      }
      const bot = botsList.find(b => b.id === idOrName || b.name === idOrName);
      if (bot) resolved.push(bot.id);
    }

    if (resolved.length < 2 || resolved.length > 6) {
      return {
        ok: false,
        error: "members_2_to_6",
        mode: "host_group_chat"
      };
    }

    // Generate title if empty
    if (!title || !title.trim()) {
      const names = resolved.map(id => {
        const bot = botsList.find(b => b.id === id);
        return bot ? bot.name : id;
      });
      title = `Group · ${names[0]} + ${names[1]}`;
    }

    const rooms = loadRooms();
    const room = {
      id: "room-" + Date.now().toString(36),
      title: title.trim(),
      members: resolved,
      created_at: nowIso()
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
    const rooms = loadRooms();
    const room = rooms.rooms.find(r => r.id === room_id);
    if (!room) {
      return { ok: false, error: "room_not_found", mode: "host_room_turn" };
    }

    const botsData = loadBots();
    const members = room.members.map(id => {
      const bot = botsData.bots.find(b => b.id === id);
      return bot ? { id: bot.id, name: bot.name } : { id, name: id };
    });

    // Parse mentions
    let responders = members;
    let responder_policy = "bot_discretion";
    let mentionMatch = null;
    if (/^@/.test(text)) {
      // Member names may contain spaces ("市场 分析员") — try full member
      // names first (longest match wins), then fall back to the single-token
      // form so "@everyone" and space-free names keep their GP-51 semantics.
      const after = text.slice(1);
      const named = members
        .filter((m) => m.name && after.startsWith(m.name))
        .sort((a, b) => String(b.name).length - String(a.name).length)[0];
      const token = after.match(/^(\S+)\s/);
      const hit = named || (token ? { name: token[1] } : null);
      if (hit) mentionMatch = [null, hit.name];
    }
    if (mentionMatch) {
      const mention = mentionMatch[1];
      if (mention === "everyone") {
        responder_policy = "all";
      } else {
        // Find specific bot
        const target = members.find(m => m.name === mention || m.id === mention);
        if (target) {
          responders = [target];
          responder_policy = "mentioned_only";
        } else {
          // Mention doesn't resolve to a room member — don't fake a directed
          // route; let members decide (GP-51 no-mention semantics).
          responder_policy = "bot_discretion";
        }
      }
    } else {
      responder_policy = "bot_discretion";
    }

    const transcript_entry = {
      room_id,
      text,
      responders: responders.map(r => r.id),
      responder_policy,
      at: now || nowIso()
    };

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
    const rooms = loadRooms();
    const room = rooms.rooms.find(r => r.id === room_id);
    if (!room) return { ok: false, error: "room_not_found" };
    if (!Array.isArray(room.transcript)) room.transcript = [];
    room.transcript.push(entry);
    if (room.transcript.length > 200) room.transcript = room.transcript.slice(-200);
    saveRooms(rooms);
    return { ok: true, mode: "host_room_transcript_append" };
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
    const rooms = loadRooms();
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
    handoffTask,
    appendRoomTranscript,
    loadRooms,

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
