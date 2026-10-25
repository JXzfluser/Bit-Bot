"use strict";

/**
 * 多端在线凭据（Host 侧唯一可信的来源）。
 *
 * 内核里的机器表是 seed() 出来的固定花名册（box_host/machines.mbt:87），
 * 它不知道此刻谁真的在说话 —— 知道这件事的只有 Host：手机每成功打一次
 * /v1/turn（ADR 0008 过了 bearer），就是一台设备真实存在的证据。
 *
 * 所以：
 *   - 只有**过了鉴权**的回合才记账（401 不记，否则任何路人扫端口都能点亮花名册）；
 *   - 「在线」= TTL 内有证据，不写「大概还开着」；过期就是过期；
 *   - 合并只标注有证据的行，不给内核凭空加机器。
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function presenceFile(repoRoot) {
  return path.join(path.resolve(repoRoot), "data", "machines", "presence.json");
}

function readPresence(repoRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(presenceFile(repoRoot), "utf8"));
    const machines = raw && raw.machines ? raw.machines : {};
    const out = {};
    for (const [id, row] of Object.entries(machines)) {
      if (!id || !row || typeof row !== "object") continue;
      out[String(id)] = {
        id: String(id),
        kind: String(row.kind || ""),
        last_seen: String(row.last_seen || ""),
        source: String(row.source || ""),
        turns: Number(row.turns || 0),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function seenWithin(row, nowMs, ttlMs) {
  const at = Date.parse(row && row.last_seen ? row.last_seen : "");
  return Number.isFinite(at) && nowMs - at >= 0 && nowMs - at <= ttlMs;
}

/**
 * 一次过了鉴权的远端回合 = 这台机器在线的证据。
 * @param {string} repoRoot
 * @param {{machineId: string, machineKind: string, source?: string}} ev
 */
function recordMachinePresence(repoRoot, ev) {
  const id = String((ev && ev.machineId) || "").trim();
  if (!id) return { ok: false, error: "empty_machine_id" };
  const file = presenceFile(repoRoot);
  let store = {};
  try {
    store = JSON.parse(fs.readFileSync(file, "utf8")).machines || {};
  } catch {
    store = {};
  }
  const prev = store[id] || {};
  const at = new Date().toISOString();
  store[id] = {
    id,
    kind: String((ev && ev.machineKind) || prev.kind || ""),
    last_seen: at,
    source: String((ev && ev.source) || prev.source || "v1_turn"),
    turns: Number(prev.turns || 0) + 1,
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ updated_at: at, machines: store }, null, 2));
    return { ok: true, path: file, machine: store[id] };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/**
 * 把证据并进内核花名册的 machines 行（可选新增字段 last_seen/presence_source）。
 * 不改 id、不改 kind、不新增机器。
 * @returns {{machines: Array<object>, online: string[]}}
 */
function mergePresenceIntoMachines(repoRoot, machines, opts = {}) {
  const nowMs = opts.now != null ? Number(opts.now) : Date.now();
  const ttlMs =
    opts.ttlMs != null
      ? Number(opts.ttlMs)
      : Number(process.env.BITBOT_PRESENCE_TTL_MS || DEFAULT_TTL_MS);
  const store = readPresence(repoRoot);
  const online = [];
  const rows = (Array.isArray(machines) ? machines : []).map((m) => {
    const row = { ...(m || {}) };
    const ev = store[row.id];
    if (!ev) return row;
    row.last_seen = ev.last_seen;
    row.presence_source = ev.source;
    if (seenWithin(ev, nowMs, ttlMs)) {
      row.status = "connected";
      row.presence_evidence = "seen_within_ttl";
      online.push(row.id);
    } else {
      row.presence_evidence = "stale";
    }
    return row;
  });
  return { machines: rows, online };
}

/** 给人看的一句话（桌面花名册 / 回执用）。 */
function presenceLine(repoRoot, opts = {}) {
  const nowMs = opts.now != null ? Number(opts.now) : Date.now();
  const ttlMs =
    opts.ttlMs != null ? Number(opts.ttlMs) : Number(process.env.BITBOT_PRESENCE_TTL_MS || DEFAULT_TTL_MS);
  const store = readPresence(repoRoot);
  const parts = [];
  for (const row of Object.values(store)) {
    const agoSec = Math.max(0, Math.round((nowMs - Date.parse(row.last_seen)) / 1000));
    if (seenWithin(row, nowMs, ttlMs)) parts.push(row.id + " 在线（" + agoSec + " 秒前有回合）");
    else parts.push(row.id + " 离线（最后证据 " + agoSec + " 秒前，超出 TTL）");
  }
  return parts.join("；");
}

module.exports = {
  DEFAULT_TTL_MS,
  presenceFile,
  readPresence,
  recordMachinePresence,
  mergePresenceIntoMachines,
  presenceLine,
};
