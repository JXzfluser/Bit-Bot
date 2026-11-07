#!/usr/bin/env node
"use strict";

/**
 * import_grok_tasks — 把你在 Grok（grok.com/tasks）里跑着的任务搬进本项目的定时任务。
 *
 * 为什么需要"搬"而不是"同步"：Grok 那边**没有稳定的导出格式**可依赖
 * （官方只在 Tasks 面板里逐条看；X 账户的数据归档是否含 tasks 也随版本变）。
 * 所以这里不假装能直连，而是把「带进来」这半段做扎实：
 * 你给一份清单（JSON 或纯文本，一行一条），它按产品真实的建任务路径落库。
 *
 * 输入
 *   --from <file>   清单文件。.json 或 .txt/.md 都行。
 *   --room <name|id> 归属到某个群（不给 = 私聊任务，和你 Grok 里的一样挂在账号上）。
 *   --apply         真写。默认 dry-run，只打印「会建什么 / 会跳过什么 / 哪条看不懂」。
 *   --json          机器可读输出（给门禁和自动化用）。
 *
 * 文本行格式（`|` 或 Tab 分隔，`#` 开头是注释）
 *   每天 09:00 | 搜 X 上我关注领域的 24 小时热点，挑 3 条并说明为什么值得看
 *   每周一 10:00 | 汇总上周竞品动态
 *   每月 1 日 09:00 | 月度行业趋势简报
 *   每年 1 月 1 日 09:00 | 年度回顾
 *   0 9 * * * | 也可以直接给 cron
 * JSON 则逐条找 prompt/text/instruction + schedule/when/frequency。
 *
 * 三条硬规矩
 *   1. **看不懂就不写**（unparsed）。没有「默认 09:00」这种兜底 —— 猜出来的时间比没建更糟：
 *      用户以为它在跑，其实跑在错的时间。
 *   2. **走产品路径建**：`executeHostEffects({kind:"routine_schedule"})`，cron 校验、5 分钟
 *      间隔下限、next_due 都交给真实解析器，不在脚本里重写一套。
 *   3. **幂等**：同 (群, cron, 原话) 只留一行；跑第二遍只报 skipped。
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = path.join(__dirname, "..");

/* ---------- 时间表达 → cron（Grok 的 daily/weekly/monthly/yearly 全在这四个形状里） ---------- */

const WEEKDAY = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0,
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
};
const MONTH = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** 取 `HH:MM` / `H点M分` / `9am` 里的时间；没有就返回 null（**绝不默认**）。 */
function parseClock(text) {
  const s = String(text || "");
  // 中文数字的钟点：七点 / 九点半 / 十点一刻 —— 用户抄清单时常常这么写
  const cn = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  let m = /(十一|十二|十|[一二三四五六七八九])\s*点\s*(半|一刻|三刻|(\d{1,2})\s*分)?/.exec(s);
  if (m) {
    const h = cn[m[1]];
    const rest = m[2] || "";
    const mi = rest === "半" ? 30 : rest === "一刻" ? 15 : rest === "三刻" ? 45 : Number(m[3] || 0);
    if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return { h, mi };
  }
  m = /(\d{1,2})[:：](\d{2})/.exec(s);
  if (m) {
    const h = Number(m[1]), mi = Number(m[2]);
    return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? { h, mi } : null;
  }
  m = /(\d{1,2})\s*(?:点|時|时)\s*(?:(\d{1,2})\s*分)?/.exec(s);
  if (m) {
    const h = Number(m[1]), mi = m[2] ? Number(m[2]) : 0;
    return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? { h, mi } : null;
  }
  m = /(\d{1,2})\s*(am|pm)\b/i.exec(s);
  if (m) {
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[2])) h += 12;
    return { h, mi: 0 };
  }
  return null;
}

/**
 * 一条时间描述 → cron。返回 `{cron, kind}` 或 `{error}`。
 * 只认这四种节奏（Grok Tasks 面板里的全部选项），外加直给 5 段 cron。
 */
function scheduleToCron(raw) {
  const text = String(raw || "").trim();
  if (!text) return { error: "no_schedule" };
  const low = text.toLowerCase();

  // 直接给 cron：5 或 6 段（6 段的第一段是秒，Grok 用不到，照样接受但要在回执里说）
  if (/^[\d*/,\-\s]+$/.test(text) && /[*/]|\d+\s+\d+/.test(text)) {
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length === 5) return { cron: parts.join(" "), kind: "cron" };
    if (parts.length === 6) return { cron: parts.slice(1).join(" "), kind: "cron6" };
  }

  const clock = parseClock(text);

  const isDaily = /每天|每日|daily|every\s*day/i.test(low);
  const isWeekly = /每周|每星期|weekly|every\s*week/i.test(low);
  const isMonthly = /每月|monthly|every\s*month/i.test(low);
  const isYearly = /每年|yearly|annually|every\s*year/i.test(low);

  // 一周里的第几天：周一/星期日/monday/Tues…
  const wd = (() => {
    const m = /(?:周|星期|礼拜)\s*([一二三四五六日天])/.exec(text);
    if (m && WEEKDAY[m[1]] !== undefined) return WEEKDAY[m[1]];
    const e = /\b(monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)\b/i.exec(text);
    return e && WEEKDAY[e[1].toLowerCase()] !== undefined ? WEEKDAY[e[1].toLowerCase()] : null;
  })();

  // 几号 / 几月几号（英文写法 `Mar 3` 没有日/号后缀，单独认一次）
  const dom = (() => {
    const m = /(\d{1,2})\s*(?:日|号|st|nd|rd|th)/i.exec(text);
    const n = m ? Number(m[1]) : NaN;
    if (n >= 1 && n <= 31) return n;
    const en = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i.exec(text);
    const d2 = en ? Number(en[2]) : NaN;
    return d2 >= 1 && d2 <= 31 ? d2 : null;
  })();
  const mon = (() => {
    const m = /(\d{1,2})\s*月/.exec(text);
    if (m) {
      const n = Number(m[1]);
      return n >= 1 && n <= 12 ? n : null;
    }
    const c = /(十一|十二|十|[一二三四五六七八九])\s*月/.exec(text);
    if (c && MONTH[c[1]] !== undefined) return MONTH[c[1]];
    const e = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.exec(text);
    return e ? MONTH[e[1].toLowerCase()] : null;
  })();

  if (isYearly) {
    if (!clock) return { error: "no_time" };
    if (mon === null || dom === null) return { error: "no_month_day" };
    return { cron: `${clock.mi} ${clock.h} ${dom} ${mon} *`, kind: "yearly" };
  }
  if (isMonthly) {
    if (!clock) return { error: "no_time" };
    if (dom === null) return { error: "no_day_of_month" };
    return { cron: `${clock.mi} ${clock.h} ${dom} * *`, kind: "monthly" };
  }
  if (isWeekly) {
    if (!clock) return { error: "no_time" };
    if (wd === null) return { error: "no_weekday" };
    return { cron: `${clock.mi} ${clock.h} * * ${wd}`, kind: "weekly" };
  }
  if (isDaily) {
    if (!clock) return { error: "no_time" };
    return { cron: `${clock.mi} ${clock.h} * * *`, kind: "daily" };
  }
  return { error: "unknown_schedule" };
}

/* ---------- 清单 → 条目 ---------- */

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** 从任意 JSON 里翻出任务数组：不押宝某个键名，找到第一个「像任务」的数组就用它。 */
function findTaskArray(node, depth = 0) {
  if (depth > 6 || node == null) return null;
  if (Array.isArray(node)) {
    const looksLikeTasks = node.some(
      (it) => it && typeof it === "object" && (it.prompt || it.text || it.instruction || it.title || it.task),
    );
    if (looksLikeTasks) return node;
    for (const it of node) {
      const hit = findTaskArray(it, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === "object") {
    for (const k of ["tasks", "routines", "scheduled_tasks", "scheduledTasks", "items", "data"]) {
      if (node[k] !== undefined) {
        const hit = findTaskArray(node[k], depth + 1);
        if (hit) return hit;
      }
    }
    for (const v of Object.values(node)) {
      const hit = findTaskArray(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** 把 schedule 归一成一句话：字符串原样；对象则把频率/星期/几号/时间拼起来。 */
function flattenSchedule(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(flattenSchedule).filter(Boolean).join(" ");
  if (typeof v === "object") {
    const freq = v.frequency || v.cadence || v.repeat || v.recurrence || v.type || "";
    // 星期优先于「几号」：weekly 只说星期，monthly 只说几号，两个都写时都带上
    const wd = v.weekday || v.week_day || v.day_of_week || "";
    const dom = v.day_of_month || v.dayOfMonth || v.day || v.date || "";
    const time = v.time || v.at || v.hour_of_day || "";
    const clock = typeof time === "number" ? String(time).padStart(2, "0") + ":" + String(v.minute || 0).padStart(2, "0") : time;
    return [freq, wd, dom, clock && "at", clock].filter(Boolean).join(" ");
  }
  return "";
}

function fromJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { items: [], error: "json_parse_failed: " + String(e.message || e) };
  }
  const arr = findTaskArray(parsed);
  if (!arr) return { items: [], error: "no_task_array" };
  const items = arr.map((it) => ({
    schedule: norm(
      flattenSchedule(
        it.schedule || it.when || it.frequency || it.cadence || it.cron || it.recurrence || "",
      ),
    ),
    prompt: norm(it.prompt || it.text || it.instruction || it.task || it.title || it.name || ""),
    enabled: it.enabled === false || it.active === false || it.paused === true ? false : true,
    room: norm(it.room || it.room_title || it.group || ""),
  }));
  return { items };
}

function fromText(raw) {
  const items = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    // 兼容 `时间 | 任务`、`时间<Tab>任务`、`时间 - 任务`
    const m = /^(.*?)\s*(?:\||\t|—|–| - )\s*(.+)$/.exec(t);
    if (!m) {
      items.push({ schedule: "", prompt: t, enabled: true, room: "" });
      continue;
    }
    items.push({ schedule: norm(m[1]), prompt: norm(m[2]), enabled: true, room: "" });
  }
  return { items };
}

/**
 * 归一化成"要建什么"。看不懂的条目留在 `unparsed` 里带原文，
 * 绝不替用户选一个时间。
 */
function plan(items, defaultRoom) {
  const ready = [];
  const unparsed = [];
  for (const it of items) {
    const prompt = norm(it.prompt);
    if (!prompt) {
      unparsed.push({ reason: "no_prompt", raw: it });
      continue;
    }
    const cron = scheduleToCron(it.schedule);
    if (cron.error) {
      unparsed.push({ reason: cron.error, raw: it });
      continue;
    }
    ready.push({
      cron: cron.cron,
      kind: cron.kind,
      prompt,
      enabled: it.enabled !== false,
      room: norm(it.room) || norm(defaultRoom),
      // id 由内容决定：跑第二遍命中同一行（配合产品侧「群+cron+原话」的去重）
      id: "grok-" + crypto.createHash("sha1").update([norm(it.room) || norm(defaultRoom), cron.cron, prompt].join("\u0000")).digest("hex").slice(0, 10),
    });
  }
  return { ready, unparsed };
}

/* ---------- 落库（走产品路径） ---------- */

function loadRoomIndex(dataRoot) {
  const p = path.join(dataRoot, "desktop", "rooms.json");
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const rooms = Array.isArray(j) ? j : j.rooms || [];
    return rooms.filter((r) => r && r.id).map((r) => ({ id: String(r.id), title: String(r.title || "") }));
  } catch {
    return [];
  }
}

function resolveRoom(query, rooms) {
  const q = norm(query);
  if (!q) return { id: "" };
  const byId = rooms.find((r) => r.id === q);
  if (byId) return { id: byId.id, title: byId.title };
  const byTitle = rooms.filter((r) => norm(r.title) === q);
  if (byTitle.length === 1) return { id: byTitle[0].id, title: byTitle[0].title };
  if (byTitle.length > 1) return { error: "room_title_ambiguous" };
  return { error: "room_not_found" };
}

function loadRoutineRows(dataRoot) {
  const p = path.join(dataRoot, "routines", "host-routines.json");
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

const sameRoutine = (row, want) =>
  String(row.cron || "") === want.cron &&
  String(row.room_id || "") === want.room &&
  norm(row.prompt) === want.prompt;

async function apply(entries, opts) {
  const { createHostFfi } = require(path.join(REPO, "hosts/shared/host_ffi"));
  const ffi = createHostFfi(opts.repoRoot || REPO);
  const done = [];
  for (const e of entries) {
    const res = await ffi.executeHostEffects(
      [{ kind: "routine_schedule", command: [e.id, e.cron, e.prompt].join("|") }],
      { sessionId: "grok-import", roomId: e.room || "" },
    );
    const hit = (res || [])[0] || {};
    let payload = {};
    try {
      payload = JSON.parse(hit.stdout || "{}");
    } catch {
      payload = {};
    }
    const id = (payload && payload.id) || e.id;
    let ok = hit.ok === true && payload.stored !== false;
    let paused = false;
    /* 你在 Grok 里暂停着的任务，搬过来也必须是暂停的。
       建任务这条路径只认「启用」，所以建完立刻用同一条 lifecycle 通道按下去 ——
       不是改 JSON 假装暂停。暂停失败要如实说，不能报成功。 */
    if (ok && e.enabled === false && typeof ffi.routineLifecycle === "function") {
      const pr = ffi.routineLifecycle({ roomId: e.room || "", id, action: "pause" });
      paused = Boolean(pr && pr.ok);
      if (!paused) ok = false;
    }
    done.push({
      id,
      ok,
      paused,
      error: hit.error || payload.error || (ok ? "" : "pause_failed"),
      cron: (payload && payload.cron) || e.cron,
      next_due: (payload && payload.next_due) || "",
      room_id: (payload && payload.room_id) || e.room,
      prompt: e.prompt,
    });
  }
  return done;
}

/* ---------- CLI ---------- */

function parseArgv(argv) {
  const out = { from: "", room: "", apply: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") out.from = argv[++i] || "";
    else if (a === "--room") out.room = argv[++i] || "";
    else if (a === "--apply") out.apply = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  if (args.help || !args.from) {
    console.log(
      [
        "用法：node scripts/import_grok_tasks.js --from <清单.json|清单.txt> [--room 群名] [--apply] [--json]",
        "",
        "默认 dry-run：只打印会建什么、会跳过什么、哪条看不懂（看不懂的不写，也不替你选时间）。",
        "文本一行一条：`每天 09:00 | 任务原话`（也接受 `0 9 * * * | 任务原话`）。",
      ].join("\n"),
    );
    process.exit(args.from ? 0 : 2);
  }

  const raw = fs.readFileSync(args.from, "utf8");
  const isJson = /\.json$/i.test(args.from) || /^\s*[[{]/.test(raw);
  const parsed = isJson ? fromJson(raw) : fromText(raw);
  if (parsed.error) {
    console.error("读不懂这份清单：" + parsed.error);
    process.exit(2);
  }

  const dataRoot = process.env.BITBOT_DATA_ROOT || path.join(REPO, "data");
  const rooms = loadRoomIndex(dataRoot);
  const roomWanted = args.room ? resolveRoom(args.room, rooms) : { id: "" };
  if (roomWanted.error) {
    console.error(
      roomWanted.error === "room_not_found"
        ? `找不到群「${args.room}」；现有群：${rooms.map((r) => r.title || r.id).join(" / ") || "(空)"}`
        : `群「${args.room}」重名，请改用 room id：${rooms.filter((r) => norm(r.title) === norm(args.room)).map((r) => r.id).join(" / ")}`,
    );
    process.exit(2);
  }

  const { ready, unparsed } = plan(parsed.items, roomWanted.id);
  const existing = loadRoutineRows(dataRoot);
  const fresh = [];
  const skipped = [];
  for (const e of ready) {
    const dup = existing.find((row) => sameRoutine(row, e));
    if (dup) skipped.push({ ...e, existing_id: dup.id });
    else fresh.push(e);
  }

  const report = {
    mode: args.apply ? "apply" : "dry_run",
    data_root: dataRoot,
    room: roomWanted.id ? { id: roomWanted.id, title: roomWanted.title || "" } : null,
    counts: { input: parsed.items.length, ready: ready.length, fresh: fresh.length, skipped: skipped.length, unparsed: unparsed.length },
    fresh,
    skipped,
    unparsed,
    applied: [],
  };

  if (args.apply && fresh.length) {
    report.applied = await apply(fresh, { repoRoot: REPO });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.applied.some((a) => !a.ok) ? 1 : 0);
  }

  console.log(`\nGrok 任务清单 → 本机定时任务（${report.mode === "apply" ? "已写入" : "预演，未写入"}）`);
  console.log(`数据根：${dataRoot}${report.room ? `　归属群：${report.room.title || report.room.id}` : "　归属：账号级（私聊）"}`);
  console.log(
    `读到 ${report.counts.input} 条：可建 ${report.counts.fresh} / 已存在 ${report.counts.skipped} / 看不懂 ${report.counts.unparsed}`,
  );

  if (report.applied.length) {
    console.log("\n已建：");
    for (const a of report.applied) {
      console.log(
        `  ${a.ok ? "✓" : "✗"} ${a.cron}  ${a.prompt.slice(0, 48)}` +
          (a.paused ? "　(已按 Grok 里的状态设为暂停)" : "") +
          (a.ok ? `　下次 ${a.next_due || "?"}` : `　(${a.error})`),
      );
    }
  } else if (fresh.length) {
    console.log("\n会建：");
    for (const e of fresh) console.log(`  ${e.cron}  ${e.prompt.slice(0, 60)}`);
  }

  if (skipped.length) {
    console.log("\n已在库里（同群、同时间、同一句话），没重复建：");
    for (const s of skipped) console.log(`  ${s.cron}  ${s.prompt.slice(0, 48)}　→ ${s.existing_id}`);
  }

  if (unparsed.length) {
    console.log("\n看不懂，**没有**写入（补上确切时间再跑一次）：");
    for (const u of unparsed) {
      const raw = u.raw || {};
      console.log(`  · [${u.reason}] ${String(raw.schedule || "(没有时间)")} | ${String(raw.prompt || "").slice(0, 50)}`);
    }
  }

  if (!args.apply && fresh.length) console.log("\n确认无误后加 --apply 真写。");
  if (report.applied.length) {
    const armed = process.env.BITBOT_ROUTINE_AUTO_EXECUTE === "1";
    console.log(
      armed
        ? "\n这台机器已开常驻授权：到点会自己跑。"
        : "\n注意：这台机器**没有**开常驻授权（BITBOT_ROUTINE_AUTO_EXECUTE）。到点只会落下待办/草稿，「不会」真的替你去执行 —— 迁移过来的是「排程定义」，不是「已经在跑」。",
    );
  }
  console.log("");
}

module.exports = { scheduleToCron, parseClock, fromText, fromJson, plan, resolveRoom, sameRoutine, norm };

if (require.main === module) {
  main().catch((e) => {
    console.error("import_grok_tasks fatal:", e && e.message ? e.message : e);
    process.exit(1);
  });
}
