"use strict";
/*
 * KP-04 — 回合计时：唯一 schema + 三段延迟派生。
 *
 * 为什么要一个共享模块：Host 写日志、`measure_turn_latency.mjs` 读日志、验收门算
 * 覆盖面，三处必须用**同一套**字段名和同一段差公式。第二份实现会让屏幕上打印的
 * 「发出→首字」和门里断言的「发出→首字」各算各的（沿用 failure_codes.js /
 * progress_protocol.js 的纪律）。纯逻辑与 IO 分开：`spans`/`validateOrder`/`format`
 * 是纯函数（门直接喂 fixture 就能测），`appendRecord`/`readRecords` 才碰文件系统。
 *
 * 一条记录（按回合，`accept` 即落库时写一行 jsonl）：
 *   enter_epoch_ms     渲染层按下回车的墙上时钟（Date.now）
 *   composed_at_ms     Host 开始构造这一回合（发出前）
 *   first_token_at_ms  这一回合第一个流式 token 到 Host 的时刻（没流式则 0）
 *   accepted_at_ms     这一回合结果落库/收线的时刻
 * 三段延迟：回车→发出 = composed-enter；发出→首字 = first-composed；
 * 首字→落库 = accepted-first。任一端点缺失或乱序 → 该段为 null（**没测到**，
 * 不是 0，门不许把 null 当绿）。
 */

const FIELD_ORDER = [
  "turn_id",
  "session_id",
  "bot_id",
  "enter_epoch_ms",
  "composed_at_ms",
  "first_token_at_ms",
  "accepted_at_ms",
];

function toMs(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// 一个正数时间戳对（b 不早于 a）才算得出延迟，否则 null = 没测到。
function diff(a, b) {
  return a > 0 && b >= a ? b - a : null;
}

/** spans(rec) → {enter_to_send, send_to_first, first_to_store}，每段是 ms 或 null。 */
function spans(rec) {
  const r = rec || {};
  const enter = toMs(r.enter_epoch_ms);
  const composed = toMs(r.composed_at_ms);
  const first = toMs(r.first_token_at_ms);
  const accepted = toMs(r.accepted_at_ms);
  return {
    enter_to_send: diff(enter, composed),
    send_to_first: diff(composed, first),
    first_to_store: diff(first, accepted),
  };
}

/** 三段里是否至少量到一段（用来把「全空记录」和「有数据记录」分开）。 */
function hasAnySpan(rec) {
  const s = spans(rec);
  return s.enter_to_send !== null || s.send_to_first !== null || s.first_to_store !== null;
}

/**
 * validateOrder(rec) → { ok, problems[] }
 * 只判**自洽性**（时间戳不能乱序、缺 turn_id），不判快慢。缺时间戳不算错——
 * 那只是某段没测到；但 enter 有值却 ≤0、或后一阶段早于前一阶段，是真异常。
 */
function validateOrder(rec) {
  const r = rec || {};
  const problems = [];
  if (!String(r.turn_id || "").trim()) problems.push("缺 turn_id");
  const enter = toMs(r.enter_epoch_ms);
  const composed = toMs(r.composed_at_ms);
  const first = toMs(r.first_token_at_ms);
  const accepted = toMs(r.accepted_at_ms);
  if (enter > 0 && composed > 0 && composed < enter) problems.push("composed 早于 enter（时钟乱序）");
  if (composed > 0 && first > 0 && first < composed) problems.push("first_token 早于 composed");
  if (first > 0 && accepted > 0 && accepted < first) problems.push("accepted 早于 first_token");
  return { ok: problems.length === 0, problems };
}

function msText(v) {
  return v === null ? "—" : v + " ms";
}

/** format(rec) → 可感面那一行：「回车→发出 X ms · 发出→首字 Y ms · 首字→落库 Z ms」。 */
function format(rec) {
  const s = spans(rec);
  const id = String((rec && rec.turn_id) || "?");
  return (
    id +
    " · 回车→发送 " +
    msText(s.enter_to_send) +
    " · 发送→首字 " +
    msText(s.send_to_first) +
    " · 首字→落库 " +
    msText(s.first_to_store)
  );
}

/** serialize → 稳定字段序的 JSON 行（去掉 0/空，读侧按缺字段=0 处理）。 */
function serialize(rec) {
  const out = {};
  for (const k of FIELD_ORDER) {
    const v = k.indexOf("_ms") >= 0 ? toMs(rec[k]) : String(rec[k] == null ? "" : rec[k]);
    if (k.indexOf("_ms") >= 0) {
      if (v > 0) out[k] = v;
    } else if (v) {
      out[k] = v;
    }
  }
  return JSON.stringify(out);
}

function deserialize(line) {
  try {
    const j = JSON.parse(line);
    if (!j || typeof j !== "object") return null;
    return {
      turn_id: String(j.turn_id || ""),
      session_id: String(j.session_id || ""),
      bot_id: String(j.bot_id || ""),
      enter_epoch_ms: toMs(j.enter_epoch_ms),
      composed_at_ms: toMs(j.composed_at_ms),
      first_token_at_ms: toMs(j.first_token_at_ms),
      accepted_at_ms: toMs(j.accepted_at_ms),
    };
  } catch (_) {
    return null;
  }
}

/* ---- 文件系统侧（Host 写、measure/gate 读） -------------------------------- */

function path_() {
  return require("path");
}
function fs_() {
  return require("fs");
}

// 按天分片：data/latency/<YYYY-MM-DD>.jsonl（UTC，跨天不乱序）。
function dayKey(epochMs) {
  const ms = toMs(epochMs) || Date.now();
  return new Date(ms).toISOString().slice(0, 10);
}

function latencyDir(dataRoot) {
  return path_().join(dataRoot, "latency");
}

function appendRecord(dataRoot, rec) {
  const fs = fs_(), path = path_();
  const dir = latencyDir(dataRoot);
  fs.mkdirSync(dir, { recursive: true });
  const key = dayKey(rec && rec.accepted_at_ms);
  const file = path.join(dir, key + ".jsonl");
  fs.appendFileSync(file, serialize(rec) + "\n");
  return file;
}

/** readRecords(dataRoot, {day, limit}) → 最近 limit 条（默认今天，跨到昨天补够）。 */
function readRecords(dataRoot, opts) {
  const fs = fs_(), path = path_();
  const o = opts || {};
  const dir = latencyDir(dataRoot);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  } catch (_) {
    return [];
  }
  const days = o.day ? [o.day] : names;
  const limit = Number(o.limit) > 0 ? Number(o.limit) : 0;
  const recs = [];
  for (let i = days.length - 1; i >= 0 && (limit === 0 || recs.length < limit); i--) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(dir, days[i]), "utf8");
    } catch (_) {
      continue;
    }
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let j = lines.length - 1; j >= 0 && (limit === 0 || recs.length < limit); j--) {
      const r = deserialize(lines[j]);
      if (r) recs.unshift(r);
    }
  }
  return recs;
}

/** findByTurnId(recs, turnId) → 该 turn 的记录（门的「从日志反查到 turn_id」判据用）。 */
function findByTurnId(recs, turnId) {
  const id = String(turnId || "");
  if (!id) return null;
  return (recs || []).find((r) => r.turn_id === id) || null;
}

/**
 * measure(recs) → 覆盖面统计（门与 e2e 共用，绝不在两处各写一份）。
 *   n                记录条数
 *   send_to_first    量到「发出→首字」的样本值（ms）数组
 *   distinct         这些样本里去重后的个数（「连发三条各不相同」的可核对性）
 */
function measure(recs) {
  const send = [];
  for (const r of recs || []) {
    const s = spans(r).send_to_first;
    if (s !== null) send.push(s);
  }
  return {
    n: (recs || []).length,
    send_to_first: send,
    distinct: new Set(send).size,
  };
}

/**
 * coverageOk(recs, {minSamples, minSendToFirst}) → {ok, why[]}
 * 「不许 0 条也算绿」这条铁律的实现：样本数为 0 必须判**不 OK**。
 * minSendToFirst：至少这么多条要量到「发出→首字」（e2e 连发 3 条流式 → 要 3）。
 */
function coverageOk(recs, opts) {
  const o = opts || {};
  const minSamples = Number(o.minSamples) || 0;
  const minSend = Number(o.minSendToFirst) || 0;
  const m = measure(recs);
  const why = [];
  if (m.n === 0) why.push("样本数为 0（0 条不许算绿）");
  else if (m.n < minSamples) why.push(`样本数 ${m.n} < 要求 ${minSamples}`);
  if (m.send_to_first.length < minSend)
    why.push(`量到首字延迟的样本 ${m.send_to_first.length} < 要求 ${minSend}`);
  return { ok: why.length === 0, why, m };
}

module.exports = {
  FIELD_ORDER,
  toMs,
  spans,
  hasAnySpan,
  validateOrder,
  format,
  serialize,
  deserialize,
  dayKey,
  latencyDir,
  appendRecord,
  readRecords,
  findByTurnId,
  measure,
  coverageOk,
};
