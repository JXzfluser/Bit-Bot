#!/usr/bin/env node
"use strict";

/**
 * import_grok_bot — 直接从本机已安装的 Grok Bot 里把「Bot / 群 / 线程」搬进本项目。
 *
 * 为什么这条路比"抄清单"准：Grok Bot 桌面版本地就有一份客户端持久化
 * （`~/Library/Application Support/Grok Bot/sand-client-persistence/*.blob`），
 * 键名是 base32 编码的 `sand.client.slice.account.<account>.xxx`。里面有三样东西正好是
 * 我们要的：
 *   - `roster.last-roster`            → 全部 Bot 行（名字、人设/职责、头像色、创建时间、
 *                                       isGroup + memberIds 就是"群与成员"）
 *   - `transcript.replicas.<id>`      → 每个 Bot/群的对话条目（user / assistant / 控件）
 *   - `cloud-agents.infos`            → 云端 agent 元信息（本脚本不用，留着备查）
 *
 * 搬过去的东西（全部走产品自己的创建通道，不手写 JSON）：
 *   - 单 Bot → `botsCreate`（name / job / description）
 *   - 群     → `roomCreate`（成员按迁移后的 Bot id 落，叫不出名字就整群不建）
 *   - 线程   → 会话（`sessions.create` + `appendMessages`），标题加 `Grok · ` 前缀
 *
 * 三条硬规矩：
 *   1. **只读本机**：不登录、不联网、不碰云端；数据不出你的机器。
 *   2. **默认预演**：`--apply` 才写；写之前把 bots/rooms/sessions 三个文件备份到
 *      `data/import-backup-<时间>/`。
 *   3. **幂等**：迁移过一次的 Grok id 记在 `data/desktop/grok-import-map.json`，
 *      再跑只报「已迁移」，不会再建一份；也不会覆盖你库里已有的行。
 *
 * 搬不过来的：正在跑的那一次执行（云端进程）、Grok 侧的文件产物、通知设置、
 * 以及控件类消息（会被转成文字，转不了的如实计入 skipped 并说明原因）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.join(__dirname, "..");
const DEFAULT_SOURCE = path.join(
  os.homedir(),
  "Library/Application Support/Grok Bot/sand-client-persistence",
);

/* ---------- 读本机的客户端持久化 ---------- */

/** base32（无填充、小写）→ 原始键名。解不开就返回 null（不猜）。 */
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

// 同上：没有原始时间就留空，不拿"现在"顶上（否则 planMigration 不是纯函数）
const isoFrom = (ms) => (Number(ms) > 0 ? new Date(Number(ms)).toISOString() : "");

/**
 * roster + 线程 → 迁移计划。纯函数：不写盘，供 --json / 门禁 / 预演共用。
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

/* ---------- 落库（走产品自己的创建通道 + 幂等台账） ---------- */

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

async function applyPlan(plan, opts) {
  const { createProductSurface } = require(path.join(REPO, "hosts/desktop/product_surface"));
  const { createSessionStore } = require(path.join(REPO, "hosts/desktop/sessions"));
  const dataRoot = opts.dataRoot;
  const surface = createProductSurface(REPO, { dataRoot });
  const sessions = createSessionStore(REPO, { dataRoot });
  const ledgerPath = path.join(dataRoot, "desktop", "grok-import-map.json");
  const ledger = loadLedger(ledgerPath);

  const result = { bots: [], rooms: [], sessions: [], reused: 0, failed: [] };

  // 备份只在「真要写第一个东西」之前做一次。
  // 反例：以前无论有没有新内容都先备一份，第二遍空跑会在 data/ 下留一堆一模一样的
  // import-backup-* 目录 —— 空跑不该产生任何痕迹，否则「有没有动过数据」就看不出来了。
  let backup = null;
  const ensureBackup = () => {
    if (backup) return backup;
    if (typeof opts.backup === "function") backup = opts.backup();
    return backup;
  };

  // 1) Bot
  for (const b of plan.bots) {
    if (ledger.bots[b.grok_id]) { result.reused += 1; continue; }
    ensureBackup();
    const res = surface.botsCreate({ name: b.name, job: b.job, description: b.description });
    if (!res || !res.ok || !res.bot) { result.failed.push({ kind: "bot", grok_id: b.grok_id, error: (res && res.error) || "create_failed" }); continue; }
    ledger.bots[b.grok_id] = res.bot.id;
    result.bots.push({ grok_id: b.grok_id, local_id: res.bot.id, name: b.name });
  }

  // 2) 群（成员必须先映射好；叫不出名字的成员不硬凑，如实记账）
  for (const r of plan.rooms) {
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
    if (!res || !res.ok || !res.room) { result.failed.push({ kind: "room", grok_id: r.grok_id, error: (res && res.error) || "create_failed" }); continue; }
    ledger.rooms[r.grok_id] = res.room.id;
    result.rooms.push({ grok_id: r.grok_id, local_id: res.room.id, title: r.title, members: members.length, reused: Boolean(res.existing) });
  }

  // 3) 线程 → 会话
  for (const s of plan.sessions) {
    if (ledger.sessions[s.grok_id]) { result.reused += 1; continue; }
    ensureBackup();
    const made = sessions.create(s.title);
    if (!made || !made.ok || !made.session) { result.failed.push({ kind: "session", grok_id: s.grok_id, error: "create_failed" }); continue; }
    const id = made.session.id;
    if (s.messages.length) sessions.appendMessages(id, s.messages);
    ledger.sessions[s.grok_id] = id;
    result.sessions.push({ grok_id: s.grok_id, local_id: id, title: s.title, messages: s.messages.length });
  }

  const wroteSomething = result.bots.length + result.rooms.length + result.sessions.length > 0;
  if (wroteSomething) saveLedger(ledgerPath, ledger);
  return { ...result, ledger_path: ledgerPath, backup, wrote: wroteSomething };
}

/* ---------- CLI ---------- */

function parseArgv(argv) {
  const out = { source: DEFAULT_SOURCE, apply: false, json: false, list: false, limit: 0, dataRoot: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") out.source = argv[++i] || DEFAULT_SOURCE;
    else if (a === "--apply") out.apply = true;
    else if (a === "--json") out.json = true;
    else if (a === "--list") out.list = true;
    else if (a === "--limit") out.limit = Number(argv[++i]) || 0;
    else if (a === "--data-root") out.dataRoot = argv[++i] || "";
    else if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        "用法：node scripts/import_grok_bot.js [--list] [--apply] [--json] [--limit N] [--source <目录>]",
        "",
        "默认读本机 Grok Bot 的客户端持久化（~/Library/Application Support/Grok Bot/sand-client-persistence），",
        "预演不写盘；--apply 才写，写前把 bots/rooms/sessions 备份到 data/import-backup-<时间>/。",
        "幂等：迁过的 Grok id 记在 data/desktop/grok-import-map.json，再跑只报「已迁移」。",
      ].join("\n"),
    );
    process.exit(0);
  }

  const store = readStore(args.source);
  if (store.error) {
    console.error("找不到 Grok Bot 的本地数据目录：" + args.source);
    console.error("（请先确认 /Applications/Grok Bot.app 装过并至少登录打开过一次）");
    process.exit(2);
  }
  const plan = planMigration(store, { limit: args.limit });
  if (plan.error) {
    console.error("这份本地数据里没有 roster：" + plan.error + "（可能还没登录过）");
    process.exit(2);
  }

  const dataRoot = args.dataRoot || process.env.BITBOT_DATA_ROOT || path.join(REPO, "data");

  if (args.list) {
    console.log(`\n本机 Grok Bot：${plan.stats.roster_rows} 个条目（Bot ${plan.stats.bots} / 群 ${plan.stats.rooms} / 有内容的线程 ${plan.stats.sessions}）`);
    for (const b of plan.bots) console.log(`  · [Bot]  ${b.name}`);
    for (const r of plan.rooms) console.log(`  · [群]   ${r.title}（${r.member_grok_ids.length} 人）`);
    console.log("");
    process.exit(0);
  }

  if (args.json) {
    const out = { mode: args.apply ? "apply" : "dry_run", data_root: dataRoot, plan: {
      stats: plan.stats, skip_reasons: plan.skip_reasons,
      bots: plan.bots.map((b) => ({ grok_id: b.grok_id, name: b.name, job: b.job })),
      rooms: plan.rooms.map((r) => ({ grok_id: r.grok_id, title: r.title, members: r.member_grok_ids.length })),
      sessions: plan.sessions.map((s) => ({ grok_id: s.grok_id, title: s.title, messages: s.messages.length })),
    } };
    if (args.apply) {
      out.applied = await applyPlan(plan, { dataRoot, backup: () => backupData(dataRoot) });
      out.backup = out.applied.backup;
    }
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  console.log(`\n从本机 Grok Bot 迁到本项目（${args.apply ? "已写入" : "预演，未写入"}）`);
  console.log(`源：${plan.source}`);
  console.log(`库：${dataRoot}`);
  console.log(
    `读到 ${plan.stats.roster_rows} 个条目：Bot ${plan.stats.bots} / 群 ${plan.stats.rooms} / 线程 ${plan.stats.sessions}（共 ${plan.stats.messages} 条消息）`,
  );
  if (plan.stats.widget_converted) console.log(`  · 其中 ${plan.stats.widget_converted} 条是选项卡片，已转成文字（否则这些"下一步该选什么"会整段丢掉）`);
  if (plan.stats.skipped) {
    const detail = Object.entries(plan.skip_reasons).map(([k, n]) => `${k}×${n}`).join("、");
    console.log(`  · 跳过 ${plan.stats.skipped} 条（${detail}）`);
  }
  if (plan.stats.missing_members) console.log(`  · 有 ${plan.stats.missing_members} 个群成员在 roster 里叫不出名字（不会硬凑进群）`);

  console.log("\n要建的 Bot：");
  for (const b of plan.bots) console.log(`  · ${b.name}${b.job ? "　—　" + b.job : ""}`);
  if (plan.rooms.length) {
    console.log("\n要建的群：");
    for (const r of plan.rooms) console.log(`  · ${r.title}（${r.member_grok_ids.length} 人）`);
  }
  if (plan.sessions.length) {
    console.log("\n要建的会话（标题加 Grok · 前缀，方便和本机自己的对话分开）：");
    for (const s of plan.sessions.slice(0, 12)) console.log(`  · ${s.title}　${s.messages.length} 条`);
    if (plan.sessions.length > 12) console.log(`  · …另有 ${plan.sessions.length - 12} 个`);
  }

  if (!args.apply) {
    console.log("\n确认无误后加 --apply 真写（会先备份 bots/rooms/sessions）。");
    console.log("");
    process.exit(0);
  }

  const applied = await applyPlan(plan, { dataRoot, backup: () => backupData(dataRoot) });
  if (applied.backup) {
    console.log(`\n已备份：${applied.backup.dir}（${applied.backup.copied.length} 个文件）`);
  } else {
    console.log("\n没有新内容要写，未备份也未改盘（空跑不留痕迹）。");
  }
  console.log(`建好：Bot ${applied.bots.length} / 群 ${applied.rooms.length} / 会话 ${applied.sessions.length}；已存在跳过 ${applied.reused}`);
  if (applied.failed.length) {
    console.log("没建成（如实列出，没有假装成功）：");
    for (const f of applied.failed) {
      const title = f.title ? `「${f.title}」` : "";
      const detail = f.kind === "room"
        ? `（对得上 ${f.members} 人 / roster 里叫不出 ${f.missing} 人）`
        : "";
      const why = f.error === "members_too_few"
        ? "members_too_few —— Grok 那边这个群本来就只有 1 人，本机建群至少 2 人"
        : f.error;
      console.log(`  ✗ ${f.kind} ${f.grok_id.slice(0, 8)}…${title}　${why}${detail}`);
    }
  }
  console.log(`台账：${applied.ledger_path}`);
  console.log("");
}

module.exports = { decodeKey, readStore, readRoster, convertEntry, planMigration, blocksToText, DEFAULT_SOURCE };

if (require.main === module) {
  main().catch((e) => {
    console.error("import_grok_bot fatal:", e && e.message ? e.message : e);
    process.exit(1);
  });
}
