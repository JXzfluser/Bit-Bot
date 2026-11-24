#!/usr/bin/env node
/**
 * export_team_run.mjs — 把一次团队运行的**完整过程**导出成可读文档。
 *
 * 为什么要有这个：
 *   用户要看的不是「我们做了什么」的报告，而是**团队内部那段对话本身** ——
 *   谁接了活、谁交了什么、验收过没过、最后产出是什么。
 *   这些信息本来就在 `rooms.json` 的 room.transcript 里（真源），
 *   但它是给界面渲染用的 JSON，不是给人读的。
 *   ⇒ 这里把**同一个真源**渲染成一份 markdown 过程文档。
 *
 * 纪律：
 *   1. **不新建数据源** —— 全部从 rooms.json 的 transcript + 交付目录读，
 *      和界面、指挥台读的是同一份。
 *   2. **不美化** —— 被驳回的那一棒、失败原因、耗时，全部如实写出来。
 *      只导出「成功」的过程文档等于造假。
 *   3. **产物必须是成员交上来的正文** —— 附的产物内容直接读交付目录里的
 *      文件（Host 代写落盘的那个），不是转述。
 *
 * 用法：
 *   node scripts/export_team_run.mjs --data <DATA_ROOT> --room <room_id|title> \
 *        --out <输出.md>
 *   node scripts/export_team_run.mjs --data <DATA_ROOT> --room <id> --json
 */

import fs from "node:fs";
import path from "node:path";

function argOf(name, dflt) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--" + name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const pref = "--" + name + "=";
  const hit = argv.find((a) => a.startsWith(pref));
  if (hit) return hit.slice(pref.length);
  return dflt;
}
const hasFlag = (name) => process.argv.includes("--" + name);

const DATA = path.resolve(argOf("data", path.join(process.cwd(), "data")));
const OUT = argOf("out", "");
const ROOM_KEY = argOf("room", "");
const AS_JSON = hasFlag("json");

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };

const ROOMS = path.join(DATA, "desktop/rooms.json");
const BOTS = path.join(DATA, "desktop/bots.json");

const roomsData = readJson(ROOMS, { rooms: [] });
const rooms = Array.isArray(roomsData.rooms) ? roomsData.rooms : [];
if (!rooms.length) {
  console.error("export_team_run: 没读到任何群（" + ROOMS + "）");
  process.exit(2);
}

const botsData = readJson(BOTS, { bots: [] });
const botName = (id) => {
  const b = (botsData.bots || []).find((x) => x && x.id === id);
  return b ? String(b.name || b.id) : String(id || "");
};
const botJob = (id) => {
  const b = (botsData.bots || []).find((x) => x && x.id === id);
  return b ? String(b.job || b.description || "") : "";
};

let room = null;
if (ROOM_KEY) {
  room = rooms.find((r) => r && (r.id === ROOM_KEY || String(r.title || "") === ROOM_KEY ||
    String(r.title || "").includes(ROOM_KEY))) || null;
  if (!room) {
    console.error("export_team_run: 找不到群「" + ROOM_KEY + "」");
    console.error("可用的群：" + rooms.map((r) => String(r.title || r.id)).join(" / "));
    process.exit(2);
  }
} else {
  // 默认：最近有活动（转录最新）的那一个群
  const scored = rooms.map((r) => {
    const tx = Array.isArray(r && r.transcript) ? r.transcript : [];
    const last = tx.length ? String(tx[tx.length - 1].at || "") : "";
    return { r, last };
  }).sort((a, b) => String(b.last).localeCompare(String(a.last)));
  room = scored.length ? scored[0].r : null;
}
if (!room) { console.error("export_team_run: 没有可导出的群"); process.exit(2); }

const tx = Array.isArray(room.transcript) ? room.transcript : [];

/* ---------- 交付目录：产物必须读成员交上来的那个文件 ---------- */
const DELIV = path.join(DATA, "desktop/room-deliverables", String(room.id || ""));
function listDeliveries() {
  const out = [];
  const walk = (dir, rel) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names.sort()) {
      const full = path.join(dir, n);
      let st = null;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, rel ? rel + "/" + n : n);
      else if (n.endsWith(".md") || n.endsWith(".txt")) {
        let content = "";
        try { content = fs.readFileSync(full, "utf8"); } catch { /* ignore */ }
        out.push({ rel: rel ? rel + "/" + n : n, path: full, bytes: st.size, content });
      }
    }
  };
  walk(DELIV, "");
  return out;
}
const deliveries = listDeliveries();

/* ---------- 分组转录 ---------- */
const report = tx.filter((e) => e && e.kind === "final_report").pop() || null;
const stageRows = tx.filter((e) => e && e.kind === "stage_done");
const replies = tx.filter((e) => e && (e.kind === "bot_reply" || e.kind === "bot_reply_error"));
const systems = tx.filter((e) => e && e.kind === "system");

const fmtAt = (t) => {
  const d = new Date(t);
  if (!t || Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
};
const fmtDur = (ms) => {
  const n = Number(ms || 0);
  if (!n) return "";
  if (n < 1000) return n + "ms";
  const s = Math.round(n / 100) / 10;
  return s >= 60 ? Math.floor(s / 60) + "分" + Math.round(s % 60) + "秒" : s + "秒";
};

const stageOf = (row) => {
  if (!row) return null;
  const sr = (report && Array.isArray(report.stage_results))
    ? report.stage_results.find((s) => s && s.bot_id === row.bot_id && s.hop === row.hop)
    : null;
  const sec = (report && Array.isArray(report.sections))
    ? report.sections.find((s) => s && s.bot_id === row.bot_id)
    : null;
  return {
    pass: row.pass !== undefined ? !!row.pass : !!(sr && sr.pass),
    duration_ms: row.duration_ms != null ? row.duration_ms : (sr ? sr.duration_ms : 0),
    reason: row.reason || (sr ? sr.reason : "") || "",
    code: (row.error_code || (sr && sr.code) || ""),
    rejected: !!(sr && sr.rejected),
    reject_reason: (sr && sr.reject_reason) || "",
    warn: (sec && sec.stage && sec.stage.warn) || "",
    artifact_path: (sec && sec.stage && sec.stage.artifact_path) || "",
  };
};

if (AS_JSON) {
  const payload = {
    room: { id: room.id, title: room.title, members: room.members || [] },
    generated_at: new Date().toISOString(),
    transcript: tx,
    stage_results: report && report.stage_results ? report.stage_results : [],
    deliveries: deliveries.map((d) => ({ path: d.rel, bytes: d.bytes, content: d.content })),
  };
  const text = JSON.stringify(payload, null, 2);
  if (OUT) { fs.writeFileSync(OUT, text); console.log("导出 JSON → " + OUT + "（" + text.length + " 字节）"); }
  else process.stdout.write(text);
  process.exit(0);
}

/* ---------- 渲染 markdown ---------- */
const L = [];
const title = String(room.title || "团队运行");
L.push("# " + title + " · 团队内部完整过程");
L.push("");
L.push("> 本文件由 `scripts/export_team_run.mjs` 从**真实转录**导出（`data/desktop/rooms.json` 的 room.transcript + 交付目录）。");
L.push("> 没有第二套数据源，也没有美化：驳回、失败、耗时都按实际发生的样子写。");
L.push("");

L.push("## 一句话");
L.push("");
const totalStages = stageRows.length;
const passed = stageRows.filter((r) => stageRows && stageOf(r) && stageOf(r).pass).length;
const rejected = stageRows.filter((r) => { const s = stageOf(r); return s && (s.rejected || !s.pass); }).length;
const wallMs = stageRows.reduce((a, r) => a + Number(r.duration_ms || 0), 0);
L.push(rejected === 0 && totalStages > 0
  ? `群内 **${totalStages} 棒**全部通过验收（累计 ${fmtDur(wallMs)}），产出 **${deliveries.length}** 份产物。`
  : `群内 ${totalStages} 棒：通过 ${passed}，**未通过 ${rejected}**（累计 ${fmtDur(wallMs)}）。`);
L.push("");

L.push("## 群成员");
L.push("");
const members = (room.members || []).map((id) => ({ id, name: botName(id), job: botJob(id) }));
for (const m of members) L.push(`- **${m.name}**${m.job ? " —— " + m.job : ""}`);
L.push("");

if (report && report.task) {
  L.push("## 群里这件事");
  L.push("");
  L.push("> " + String(report.task).split("\n").join("\n> "));
  L.push("");
}

L.push("## 过程时间线");
L.push("");
L.push("每一棒都记了：谁做的、做了多久、验收过没过。**没过的也在这里。**");
L.push("");
L.push("| # | 成员 | 耗时 | 验收 | 说明 |");
L.push("|---|------|------|------|------|");
const rows = stageRows.length ? stageRows : replies.map((r) => Object.assign({}, r, { duration_ms: 0 }));
rows.forEach((r, i) => {
  const s = stageOf(r) || {};
  const nm = r.name || botName(r.bot_id);
  const pass = s.pass === undefined ? "—" : (s.pass ? "✅ 过" : "❌ 未过");
  const why = String(s.reject_reason || s.reason || s.warn || "").replace(/\s+/g, " ").trim();
  L.push(`| ${i + 1} | ${nm} | ${fmtDur(s.duration_ms) || "—"} | ${pass} | ${why || "—"} |`);
});
L.push("");

L.push("## 团队内部对话（原文）");
L.push("");
if (!replies.length) {
  L.push("（这一轮没有成员发言。）");
  L.push("");
} else {
  for (const r of replies) {
    const nm = r.name || botName(r.bot_id);
    const job = botJob(r.bot_id);
    const s = stageOf(r) || {};
    const okMark = r.kind === "bot_reply_error" ? "❌" : "✅";
    L.push(`### ${okMark} ${nm}${job ? "（" + job + "）" : ""}`);
    L.push("");
    L.push(`*${fmtAt(r.at)}${s.duration_ms ? " · 耗时 " + fmtDur(s.duration_ms) : ""}${s.pass === false ? " · 验收未通过" : ""}*`);
    L.push("");
    const body = String(r.text || "");
    if (body.trim()) {
      L.push(body.trim());
    } else {
      L.push("> （这一棒没有交出正文。）");
    }
    L.push("");
    if (s.reason && r.kind === "bot_reply_error") {
      L.push("> **失败原因**：" + s.reason);
      L.push("");
    }
  }
}

if (systems.length) {
  L.push("## 群里其它发生了什么");
  L.push("");
  for (const s of systems) {
    L.push(`- ${fmtAt(s.at)} ${String(s.text || "")}`);
  }
  L.push("");
}

L.push("## 最终产出");
L.push("");
if (!deliveries.length) {
  L.push("**没有产出文件。**");
  L.push("");
  L.push("原因见上面的「过程时间线」和「验收」列 —— 不通过就不落盘，这是有意为之：宁可交出「没有」，也不要交一个半成品或一句转述。");
  L.push("");
} else {
  L.push("产物是成员**交上来的正文**（Host 代写落盘），不是对成果的转述。下面按文件列出全文。");
  L.push("");
  for (const d of deliveries) {
    L.push(`### \`${d.rel}\`（${d.bytes} 字节）`);
    L.push("");
    L.push(d.content.trim() || "（空文件）");
    L.push("");
  }
}

if (report && Array.isArray(report.stage_results) && report.stage_results.length) {
  L.push("## 验收明细");
  L.push("");
  for (const s of report.stage_results) {
    const nm = s.name || botName(s.bot_id);
    const verdict = s.pass ? "通过" : "**未通过**";
    L.push(`- 第 ${(s.hop || 0) + 1} 棒 · ${nm} · ${verdict} · ${fmtDur(s.duration_ms) || "耗时未知"}`);
    if (s.reason) L.push(`  - 原因：${s.reason}`);
    if (s.code) L.push(`  - 机器码：\`${s.code}\``);
  }
  L.push("");
}

const text = L.join("\n");
if (OUT) {
  fs.writeFileSync(OUT, text, "utf8");
  console.log("导出完成 → " + OUT);
  console.log("  群：" + title);
  console.log("  棒数：" + totalStages + "（过 " + passed + " / 未过 " + rejected + "）");
  console.log("  产物：" + deliveries.length + " 份");
  console.log("  字节：" + text.length);
} else {
  process.stdout.write(text);
}
