"use strict";

/**
 * 一轮结束后，把「真正落在磁盘上的产物」挑出来。
 *
 * 为什么要有这个文件：私聊的消息落库时只存 `{role, text}`，而这一轮生成的图片、
 * 视频、图表、ics、eml、skill.md、导出包全都只活在渲染层的内存里 —— 刷新一次
 * 就没了。没有「按消息归属的产物索引」，后面想做的产物画布连内容源都没有。
 *
 * 三条纪律：
 *   1. **只收磁盘上真的存在的文件**。host_results 里 ok:false 的、路径写空、
 *      文件已经被删掉的，一律不收 —— 存一条打不开的产比比不存更糟。
 *   2. **纯函数**。不进 electron，不写盘，可单测（判据见 scripts/prove_m52b_*）。
 *   3. **上限 24 条/轮**。产物索引是消息行的附属字段，不是文件系统清单。
 */

const fs = require("fs");
const path = require("path");

const MAX_PER_TURN = 24;

/** host 结果里「哪一类、哪个字段是产物路径」——与渲染层 collectHost*Paths 同源。 */
function pathsOf(kind, p) {
  switch (kind) {
    case "generate_image":
    case "structured_chart":
      return [p.media_path || p.path, kind];
    case "generate_video":
      return [p.media_path, kind];
    case "watch_video":
      return [p.frame_path, "watch_frame"];
    case "screenshot":
      return [p.has_frame ? p.frame_path : null, "screenshot"];
    case "voice_relay":
      return [p.reply_media_ok ? p.reply_media_path : null, "voice_reply"];
    case "voice_end_write":
      return [p.media_ok ? p.media_path : null, "voice_chat"];
    case "skill_write":
      return [p.skill_path || p.path, "skill_md"];
    case "schedule_meeting":
      return [p.ics_path, "schedule_ics"];
    case "mail_send":
    case "mail_draft":
      return [p.eml_path, kind + "_eml"];
    case "export_pack":
      return [p.export_path || p.path, "export_pack"];
    default:
      return [null, kind || "artifact"];
  }
}

function parseStdout(h) {
  try {
    const v = JSON.parse(h && h.stdout ? h.stdout : "{}");
    return v && typeof v === "object" ? v : {};
  } catch (_) {
    return {};
  }
}

/**
 * @param {Array} hostResults 一轮里 host effects 的真实执行结果
 * @returns {{artifacts: Array, skipped: number}} artifacts: [{path,name,kind,bytes}]
 */
function collectTurnArtifacts(hostResults) {
  const out = [];
  const seen = new Set();
  let skipped = 0;
  const rows = Array.isArray(hostResults) ? hostResults : [];
  for (const h of rows) {
    if (!h || h.ok === false) { skipped++; continue; }
    const p = parseStdout(h);
    const [raw, kind] = pathsOf(String(h.kind || ""), p);
    const fp = String(raw || "").trim();
    if (!fp || seen.has(fp)) { if (fp) skipped++; continue; }
    let bytes = null;
    try {
      const st = fs.statSync(fp);
      if (!st.isFile()) { skipped++; continue; }
      bytes = st.size;
    } catch (_) {
      // 文件不在（临时目录被清 / 用户删了）→ 不存，别留一条点不开的
      skipped++;
      continue;
    }
    seen.add(fp);
    out.push({ path: fp, name: path.basename(fp) || fp, kind, bytes });
    if (out.length >= MAX_PER_TURN) break;
  }
  return { artifacts: out, skipped };
}

module.exports = { collectTurnArtifacts, MAX_PER_TURN };
