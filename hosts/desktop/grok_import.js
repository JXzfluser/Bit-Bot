"use strict";

/**
 * grok_import — 从本机已安装的 Grok Bot 把「Bot / 群 / 对话」搬进本项目（Host 侧唯一实现）。
 *
 * 为什么放在 hosts/desktop/ 而不是 scripts/：打包白名单只带 hosts/desktop 与 hosts/shared，
 * scripts/ 不进 app。界面入口要在打包后的 app 里用，所以核心必须住在这里；
 * `scripts/import_grok_bot.js` 只是一层 CLI 壳，避免"命令行能跑、界面是另一套逻辑"。
 *
 * 数据从哪来：Grok Bot 桌面版本地有一份客户端持久化
 * （`~/Library/Application Support/Grok Bot/sand-client-persistence/*.blob`），
 * **文件名是键名的 base32 编码**，内容是 `{"schemaVersion":1,"value":{…}}`。有用的两个键：
 *   - `roster.last-roster`       → 全部 Bot 行（名字、人设、isGroup + memberIds 就是"群与成员"）
 *   - `transcript.replicas.<id>` → 每个 Bot/群的对话条目（message / send-message）
 *
 * 搬过去的东西全部走产品自己的创建通道（botsCreate / roomCreate / sessions.create +
 * appendMessages），不手写 JSON：
 *   - 单 Bot → `botsCreate`（name / job / description）
 *   - 群     → `roomCreate`（成员按迁移后的 Bot id 落；叫不出名字或不足 2 人就不建）
 *   - 线程   → 会话（标题加 `Grok · ` 前缀，保留原始时间）
 *
 * 硬规矩（每条都是踩过的坑）：
 *   1. **只读本机**：不登录、不联网、不碰云端。
 *   2. **转不了就记 skip**：附件/事件/私钥请求不写空消息 —— 空消息让对话看起来"断了"，
 *      用户无法判断是迁移丢的还是本来就没有。
 *   3. **幂等**：迁过的 Grok id 记在 `data/desktop/grok-import-map.json`。
 *   4. **空跑不留痕**：备份惰性（真要写第一个东西之前才做）。
 *   5. **算好的时间必须落地**：消息带原始 `at`，appendMessages 会用它。
 *   6. **纯函数**：`planMigration` 里不许出现 `new Date()` —— 否则预演看到的计划和
 *      `--apply` 写进去的不是同一份。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const DEFAULT_SOURCE = path.join(
  os.homedir(),
  "Library/Application Support/Grok Bot/sand-client-persistence",
);

/* ---------- 读本机的客户端持久化 ---------- */

/** base32（无填充、大小写不敏感）→ 原始键名。解不开就返回 null（不猜、不给乱码）。 */
function decodeKey(b64ish) {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const s = String(b64ish || "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    const idx = table.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  try {
    return Buffer.from(out).toString("utf8");
  } catch {
    return null;
  }
}

/** 扫一个目录，返回 { 键名 → 解析后的 JSON }。坏文件跳过并计数。 */
function readStore(dir) {
  const out = { dir, values: new Map(), bad: 0, files: 0 };
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".blob"));
  } catch {
    return { ...out, error: "source_not_found" };
  }
  out.files = names.length;
  for (const f of names) {
    const key = decodeKey(f.replace(/\.blob$/i, ""));
    if (!key) { out.bad += 1; continue; }
    try {
      out.values.set(key, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    } catch {
      out.bad += 1;
    }
  }
  return out;
}

const pickKey = (store, suffix) => {
  for (const k of store.values.keys()) if (k.endsWith(suffix)) return k;
  return null;
};

/** roster 行：只留我们要用的字段，别把整份隐私快照搬进内存。 */
function readRoster(store) {
  const key = pickKey(store, ".roster.last-roster");
  if (!key) return { rows: [], error: "roster_not_found" };
  const doc = store.values.get(key);
  const rows = (doc && doc.value && doc.value.rows) || [];
  return {
    rows: rows.filter((r) => r && r.id).map((r) => ({
      grok_id: String(r.id),
      name: String(r.name || r.title || "").trim(),
      description: String(r.description || "").trim(),
      avatar_color: String(r.avatarColor || ""),
      created_ms: Number(r.createdAt) || 0,
      updated_ms: Number(r.updatedAt) || 0,
      is_group: Boolean(r.isGroup) || (Array.isArray(r.memberIds) && r.memberIds.length > 0),
      member_ids: Array.isArray(r.memberIds) ? r.memberIds.map(String) : [],
    })),
  };
}

/** 一条对话条目 → 我们的一行消息。转不了就返回 {skip}，绝不硬塞。 */
function convertEntry(e) {
  const ms = Number(e && (e.timestampMs || e.at || e.createdAt)) || 0;
  // 没记时间就留空 —— 不要编一个"现在"。编出来的时间会让 2024 年的对话
  // 显示成今天发的，而且让这个函数不再是纯函数（两次调用结果不同，
  // 预演看到的计划和 --apply 写进去的就不是同一份）。
  const at = ms ? new Date(ms).toISOString() : "";

  if (!e || typeof e !== "object") return { skip: "entry_not_object" };

  if (e.kind === "message") {
    const role = String(e.role || "");
    if (role !== "user" && role !== "assistant" && role !== "system") return { skip: "unknown_role" };
    const text = typeof e.content === "string" ? e.content : blocksToText(e.content);
    if (!String(text || "").trim()) return { skip: "empty_text" };
    // 我们的会话只有 user / assistant 两种；system 归到 assistant 但保留原话
    return { msg: { role: role === "user" ? "user" : "assistant", text: String(text), at } };
  }

  if (e.kind === "send-message") {
    const m = (e && e.message) || {};
    if (m.type === "text" && typeof m.content === "string" && m.content.trim()) {
      return { msg: { role: "assistant", text: m.content, at } };
    }
    if (m.type === "widget" && m.widget) {
      // 控件（选项卡片）转成一段可读的文字，而不是丢掉 —— 它往往是"下一步该干什么"的线索
      const opts = Array.isArray(m.widget.options) ? m.widget.options : [];
      const lines = [String(m.widget.prompt || "").trim()].filter(Boolean);
      for (const o of opts) {
        const label = String((o && o.label) || "").trim();
        if (label) lines.push("· " + label);
      }
      if (!lines.length) return { skip: "empty_widget" };
      return { msg: { role: "assistant", text: lines.join("\n"), at }, converted: "widget" };
    }
    return { skip: "message_type_" + String(m.type || "unknown") };
  }

  return { skip: "kind_" + String((e && e.kind) || "unknown") };
}

/** 富文本块 → 纯文本（只取文字，图片/附件标成占位，不假装有内容）。 */
function blocksToText(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (typeof b.text === "string") parts.push(b.text);
    else if (b.type === "image" || b.type === "attachment") parts.push("[附件]");
  }
  return parts.join("\n");
}

// 没有原始时间就留空，不拿"现在"顶上（否则 planMigration 不是纯函数）
const isoFrom = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString() : "");

/**
 * roster + 线程 → 迁移计划。纯函数：不写盘，供预览 / CLI / 门禁共用。
 * 群成员只认「也在 roster 里、且不是群」的行；叫不出来的成员单独记账，不静默丢弃。
 */
function planMigration(store, opts = {}) {
  const roster = readRoster(store);
  if (roster.error) return { error: roster.error, bots: [], rooms: [], sessions: [], skipped: [] };

  const singles = roster.rows.filter((r) => !r.is_group);
  const groups = roster.rows.filter((r) => r.is_group);
  const byId = new Map(roster.rows.map((r) => [r.grok_id, r]));

  const bots = singles.map((r) => ({
    grok_id: r.grok_id,
    name: r.name || "Grok Bot " + r.grok_id.slice(0, 8),
    // job 是短职责标签：取人设第一行的前 24 字，没有就留空（不编）
    job: (r.description.split(/\r?\n/)[0] || "").trim().slice(0, 24),
    description: r.description,
    created_at: isoFrom(r.created_ms),
    updated_at: isoFrom(r.updated_ms || r.created_ms),
  }));

  const missingMembers = [];
  const rooms = groups.map((g) => {
    const members = [];
    let missing = 0;
    for (const mid of g.member_ids) {
      const hit = byId.get(mid);
      if (hit && !hit.is_group) members.push(hit.grok_id);
      else { missing += 1; missingMembers.push({ room: g.name || g.grok_id, member: mid }); }
    }
    return {
      grok_id: g.grok_id,
      title: g.name || "Grok 群 " + g.grok_id.slice(0, 8),
      member_grok_ids: members,
      // 分成两个数：对得上的 / 对不上的。合起来报「成员不足」会把
      // 「本来就只有 1 个人」说成「成员映射失败」，让人以为换个环境就能建成。
      missing_count: missing,
      created_at: isoFrom(g.created_ms),
    };
  });

  const sessions = [];
  const skipped = [];
  const converted = { widget: 0 };
  for (const row of roster.rows) {
    const key = pickKey(store, ".transcript.replicas." + row.grok_id);
    if (!key) continue;
    const doc = store.values.get(key);
    const entries = ((doc && doc.value && doc.value.entries) || []).slice();
    if (!entries.length) continue;
    entries.sort((a, b) => (Number(a.timestampMs) || 0) - (Number(b.timestampMs) || 0));
    const messages = [];
    for (const e of entries) {
      const got = convertEntry(e);
      if (got.skip) {
        skipped.push({ grok_id: row.grok_id, name: row.name, reason: got.skip });
        continue;
      }
      if (got.converted === "widget") converted.widget += 1;
      messages.push(got.msg);
    }
    if (!messages.length) continue;
    sessions.push({
      grok_id: row.grok_id,
      title: "Grok · " + (row.name || row.grok_id.slice(0, 8)),
      is_group: row.is_group,
      created_at: isoFrom(row.created_ms),
      messages,
    });
  }

  const reasonCount = {};
  for (const s of skipped) reasonCount[s.reason] = (reasonCount[s.reason] || 0) + 1;

  return {
    source: store.dir,
    stats: {
      roster_rows: roster.rows.length,
      bots: bots.length,
      rooms: rooms.length,
      sessions: sessions.length,
      messages: sessions.reduce((n, s) => n + s.messages.length, 0),
      skipped: skipped.length,
      widget_converted: converted.widget,
      missing_members: missingMembers.length,
      unreadable_files: store.bad,
    },
    skip_reasons: reasonCount,
    bots,
    rooms,
    sessions,
    skipped,
    missing_members: missingMembers,
    limit: opts.limit || 0,
  };
}

/* ---------- 幂等台账 ---------- */

const ledgerPath = (dataRoot) => path.join(dataRoot, "desktop", "grok-import-map.json");

function loadLedger(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return { version: 1, bots: {}, rooms: {}, sessions: {}, ...j };
  } catch {
    return { version: 1, bots: {}, rooms: {}, sessions: {} };
  }
}
function saveLedger(file, ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...ledger, updated_at: new Date().toISOString() }, null, 2));
}

function backupData(dataRoot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(dataRoot, "import-backup-" + stamp);
  fs.mkdirSync(dir, { recursive: true });
  const copied = [];
  for (const rel of ["desktop/bots.json", "desktop/rooms.json", "desktop/sessions.json"]) {
    const src = path.join(dataRoot, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(dir, rel.replace("/", "__"));
    fs.copyFileSync(src, dst);
    copied.push(dst);
  }
  return { dir, copied };
}

/* ---------- 给界面用的「计划 + 现状」 ---------- */

/**
 * 计划 → 界面可渲染的清单（不含消息正文：1466 条正文过 IPC 没有意义，
 * 界面只需要"几条、什么时候开始、能不能建"）。渲染层拿到 id 就够了，
 * 写入时 Host 重新算一遍计划 —— 不让渲染层传计划内容上来。
 */
function describe(plan, dataRoot) {
  const ledger = loadLedger(ledgerPath(dataRoot));
  const bots = plan.bots.map((b) => ({
    grok_id: b.grok_id,
    name: b.name,
    job: b.job,
    already: Boolean(ledger.bots[b.grok_id]),
    local_id: ledger.bots[b.grok_id] || null,
  }));
  const rooms = plan.rooms.map((r) => {
    const buildable = r.member_grok_ids.length >= 2;
    return {
      grok_id: r.grok_id,
      title: r.title,
      members: r.member_grok_ids.length,
      member_grok_ids: r.member_grok_ids,
      missing: r.missing_count,
      // 能不能建 + 为什么不能，两个都要给 —— 只给 false 等于让人猜
      buildable,
      block_reason: buildable
        ? null
        : (r.missing_count ? "members_unmapped" : "members_too_few"),
      already: Boolean(ledger.rooms[r.grok_id]),
      local_id: ledger.rooms[r.grok_id] || null,
    };
  });
  const sessions = plan.sessions.map((s) => {
    const ats = s.messages.map((m) => Date.parse(m.at || "")).filter((n) => !Number.isNaN(n));
    return {
      grok_id: s.grok_id,
      title: s.title,
      is_group: Boolean(s.is_group),
      count: s.messages.length,
      first_at: ats.length ? new Date(Math.min(...ats)).toISOString() : "",
      last_at: ats.length ? new Date(Math.max(...ats)).toISOString() : "",
      already: Boolean(ledger.sessions[s.grok_id]),
      local_id: ledger.sessions[s.grok_id] || null,
    };
  });
  return { bots, rooms, sessions };
}

/**
 * 选择归一化：{ bots:[], rooms:[], sessions:[] } → Set。
 * **选了群就自动带上它的成员**：本机建群必须 ≥2 个已存在的 Bot，让用户自己去勾
 * "顺便还要勾上哪几个成员"是把实现细节当成交互负担。带上了会在结果里如实说明。
 */
function normalizeSelection(selection, plan) {
  if (!selection || (!selection.bots && !selection.rooms && !selection.sessions)) return null;
  const pick = (v) => new Set((Array.isArray(v) ? v : []).map(String));
  const sel = { bots: pick(selection.bots), rooms: pick(selection.rooms), sessions: pick(selection.sessions) };
  const autoBots = [];
  if (sel.rooms.size) {
    const byId = new Map(plan.rooms.map((r) => [r.grok_id, r]));
    for (const rid of sel.rooms) {
      const room = byId.get(rid);
      if (!room) continue;
      for (const bid of room.member_grok_ids) {
        if (!sel.bots.has(bid)) { sel.bots.add(bid); autoBots.push(bid); }
      }
    }
  }
  return { ...sel, auto_bots: autoBots };
}

/* ---------- 落库（走产品自己的创建通道） ---------- */

/**
 * 把一个计划（可选地只写其中一部分）落到库里。
 *
 * opts.surface / opts.sessions 由调用方注入：Host 必须复用 main.js 里那两个实例，
 * 否则同一个 sessions.json 会被两个 store 交替 load/save 而丢更新。
 * CLI 没有 Host 实例，才自己造一份。
 */
function applyPlan(plan, opts) {
  const dataRoot = opts.dataRoot;
  const surface = opts.surface;
  const sessions = opts.sessions;
  if (!surface || !sessions) return { ok: false, error: "surface_or_sessions_missing", bots: [], rooms: [], sessions: [], failed: [] };

  const file = ledgerPath(dataRoot);
  const ledger = loadLedger(file);
  const sel = normalizeSelection(opts.selection, plan);
  const want = (kind, id) => !sel || sel[kind].has(id);

  const result = {
    bots: [], rooms: [], sessions: [], reused: 0, failed: [],
    auto_bots: sel ? sel.auto_bots : [],
    backup: null,
  };

  // 备份只在「真要写第一个东西」之前做一次。
  // 反例：曾经无论有没有新内容都先备一份，第二遍空跑会在 data/ 下留一堆一模一样的
  // import-backup-* —— 空跑不该产生任何痕迹，否则「有没有动过数据」就看不出来了。
  const ensureBackup = () => {
    if (result.backup) return result.backup;
    if (typeof opts.backup === "function") result.backup = opts.backup(dataRoot);
    return result.backup;
  };

  // 1) Bot
  for (const b of plan.bots) {
    if (!want("bots", b.grok_id)) continue;
    if (ledger.bots[b.grok_id]) { result.reused += 1; continue; }
    ensureBackup();
    const res = surface.botsCreate({ name: b.name, job: b.job, description: b.description });
    if (!res || !res.ok || !res.bot) {
      result.failed.push({ kind: "bot", grok_id: b.grok_id, title: b.name, error: (res && res.error) || "create_failed" });
      continue;
    }
    ledger.bots[b.grok_id] = res.bot.id;
    result.bots.push({ grok_id: b.grok_id, local_id: res.bot.id, name: b.name });
  }

  // 2) 群（成员必须先映射好；叫不出名字的成员不硬凑，如实记账）
  for (const r of plan.rooms) {
    if (!want("rooms", r.grok_id)) continue;
    if (ledger.rooms[r.grok_id]) { result.reused += 1; continue; }
    const members = r.member_grok_ids.map((id) => ledger.bots[id]).filter(Boolean);
    if (members.length < 2) {
      result.failed.push({
        kind: "room",
        grok_id: r.grok_id,
        title: r.title,
        // 人不够 ≠ 人对不上。前者是 Grok 那边本来只有 1 人，换台机器也建不成；
        // 后者是 roster 里叫不出名字，可能是键名解错了。混成一个原因会掩盖真问题。
        error: r.missing_count ? "members_unmapped" : "members_too_few",
        members: members.length,
        missing: r.missing_count,
      });
      continue;
    }
    ensureBackup();
    const res = surface.roomCreate(members.join(","), r.title);
    if (!res || !res.ok || !res.room) {
      result.failed.push({ kind: "room", grok_id: r.grok_id, title: r.title, error: (res && res.error) || "create_failed" });
      continue;
    }
    ledger.rooms[r.grok_id] = res.room.id;
    result.rooms.push({ grok_id: r.grok_id, local_id: res.room.id, title: r.title, members: members.length, reused: Boolean(res.existing) });
  }

  // 3) 线程 → 会话
  for (const s of plan.sessions) {
    if (!want("sessions", s.grok_id)) continue;
    if (ledger.sessions[s.grok_id]) { result.reused += 1; continue; }
    ensureBackup();
    const made = sessions.create(s.title);
    if (!made || !made.ok || !made.session) {
      result.failed.push({ kind: "session", grok_id: s.grok_id, title: s.title, error: "create_failed" });
      continue;
    }
    const id = made.session.id;
    if (s.messages.length) sessions.appendMessages(id, s.messages);
    ledger.sessions[s.grok_id] = id;
    result.sessions.push({ grok_id: s.grok_id, local_id: id, title: s.title, messages: s.messages.length });
  }

  const wroteSomething = result.bots.length + result.rooms.length + result.sessions.length > 0;
  if (wroteSomething) saveLedger(file, ledger);
  return { ok: true, ...result, ledger_path: file, wrote: wroteSomething };
}

/** 一步到位：读源 → 出计划（含现状）。界面与 CLI 的预演共用。 */
function scan(opts = {}) {
  const source = opts.source || DEFAULT_SOURCE;
  const store = readStore(source);
  if (store.error) return { ok: false, error: "source_not_found", source };
  const plan = planMigration(store, { limit: opts.limit || 0 });
  if (plan.error) return { ok: false, error: plan.error, source };
  const dataRoot = opts.dataRoot;
  const view = describe(plan, dataRoot);
  return {
    ok: true,
    source,
    data_root: dataRoot,
    stats: plan.stats,
    skip_reasons: plan.skip_reasons,
    missing_members: plan.missing_members,
    ...view,
  };
}

module.exports = {
  REPO,
  DEFAULT_SOURCE,
  decodeKey,
  readStore,
  readRoster,
  convertEntry,
  blocksToText,
  planMigration,
  describe,
  normalizeSelection,
  applyPlan,
  scan,
  backupData,
  loadLedger,
  saveLedger,
  ledgerPath,
};
