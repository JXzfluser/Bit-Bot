/*
 * client_core/reducer.js — KP-08 / T3-03：折叠 events → 三张面的那份纯逻辑。
 *
 * 位置就是这条设计的边界，先说清楚为什么不是仓库根上的 `client-core/`：
 * 打包时 `hosts/shared/**` 整目录进 `app.asar/shared`（hosts/desktop/package.json 的
 * build.files），根目录的 client-core/ 不在任何一条 filter 里 —— 桌面端一旦 require 它，
 * 开发态跑得好、包内直接找不到模块。放在 shared 下面，dev 与包内的相对路径
 * （`hosts/desktop/*` → `../shared/client_core/…`，`hosts/shared/*` → `./client_core/…`）
 * 天然同形，渲染层将来也能直接 `<script>` 读它。计划里的「client-core/」在这里
 * 落成 `hosts/shared/client_core/`，含义不变：**没有 DOM、没有 Electron、没有 fs，
 * Node 与浏览器都能跑**。
 *
 * 一条红线：这份折叠是**唯一口径**。`hosts/shared/event_mirror.js` 里原来那段
 * foldEvents 整块搬到这里，那边改成委派 —— 双写旁路（T1-03）和客户端核心（T3-03）
 * 从此共用同一个函数，不存在「桌面 fold 出来和 Host fold 出来不一样」这种分叉。
 * 新增 kind 必须同时进 `schema.js` 的词表和这里的分支，否则 fold 会记 anomaly
 * （「折叠器不认识 kind」），门的棘轮会把它抓住。
 */

/* 同 schema.js：被渲染端当 classic script 加载，顶层声明必须自封闭。 */
(function () {
"use strict";

/** 三张面的基线——fold 从空开始，第一次写入必须把它记满。 */
const BASELINE = {
  sessions: { version: 1, active_id: "", sessions: [] },
  rooms: { version: 1, rooms: [] },
  approvals: [],
};

/* 实体里「不算列表」的字段：sessions.messages / rooms.transcript 才是列表。 */
const LIST_FIELD = { sessions: "messages", rooms: "transcript" };

/* §5.2 回合流 kind：它们是「刚刚发生了什么」的流水，由手机端 SSE 直接消费，
   不走快照 fold（fold 只重建 sessions/rooms/approvals 三张面）。识别但不折叠，
   避免被当成「折叠器不认识 kind」的 anomaly 污染读模型。A1-2 把回合事件写入了
   同一份库，所以必须显式放行，否则开了双写又跑了回合的库一旦被读模型 fold 就红。 */
const IGNORED_KINDS = new Set([
  "turn_started", "progress", "turn_ended",
  "job_started", "job_output", "job_ended",
  "effect_started", "effect_finished", "presence_changed",
]);

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function findIn(arr, id) {
  return (arr || []).find((e) => String(e.id) === String(id));
}

function surfaceOfRow(state, sessionId) {
  if (findIn(state.rooms.rooms, sessionId)) return "rooms";
  if (findIn(state.sessions.sessions, sessionId)) return "sessions";
  return "sessions";
}

/**
 * events（按 seq 的任意顺序都行）→ { sessions, rooms, approvals, anomalies }。
 * anomalies 非空即「这份日志折不干净」，调用方必须降级，绝不能把半折叠状态当真。
 */
function foldEvents(rows) {
  const state = {
    sessions: clone(BASELINE.sessions),
    rooms: clone(BASELINE.rooms),
    approvals: [],
  };
  const listName = (surface) => (surface === "rooms" ? "rooms" : "sessions");

  // approvals 这张面本身就是数组，sessions/rooms 是 {version, …:[…]} 的 store
  const bucket = (surface) => (surface === "approvals" ? state.approvals : state[surface][listName(surface)]);
  const setBucket = (surface, arr) => {
    if (surface === "approvals") state.approvals = arr;
    else state[surface][listName(surface)] = arr;
  };
  const find = (surface, id) => bucket(surface).find((e) => String(e.id) === String(id));
  const drop = (surface, id) => {
    const arr = bucket(surface);
    const i = arr.findIndex((e) => String(e.id) === String(id));
    if (i >= 0) arr.splice(i, 1);
  };

  const sorted = [...rows].sort((a, b) => Number(a.seq) - Number(b.seq));
  const anomalies = [];

  for (const row of sorted) {
    let p;
    try {
      p = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload || {};
    } catch (_e) {
      anomalies.push(`seq=${row.seq}: payload 不是合法 JSON`);
      continue;
    }
    const kind = row.kind;
    // 回合流事件不进快照 fold：识别但跳过，不当 anomaly（见 IGNORED_KINDS）。
    if (IGNORED_KINDS.has(kind)) continue;
    if (kind === "session_created") {
      const surface = p.surface === "rooms" ? "rooms" : "sessions";
      const ent = clone(p.session || {});
      if (find(surface, ent.id)) anomalies.push(`seq=${row.seq}: ${surface} 里的 ${ent.id} 被创建了两次`);
      else state[surface][listName(surface)].push(ent);
    } else if (kind === "approval_requested") {
      const ent = clone(p.approval || {});
      if (find("approvals", ent.id)) anomalies.push(`seq=${row.seq}: 审批 ${ent.id} 被创建了两次`);
      else state.approvals.push(ent);
    } else if (kind === "entity_order_changed") {
      const arr = bucket(p.surface) || [];
      const byId = new Map(arr.map((e) => [String(e.id), e]));
      const wanted = (p.ids || []).map(String);
      const reordered = wanted.map((id) => byId.get(id));
      const lost = [...byId.keys()].filter((id) => !wanted.includes(id));
      if (lost.length) anomalies.push(`seq=${row.seq}: ${p.surface} 的顺序里没有这些 id，但它们还在库里：${lost.join(",")}`);
      const ghosts = wanted.filter((id) => !byId.has(id));
      if (ghosts.length) anomalies.push(`seq=${row.seq}: ${p.surface} 的顺序指向不存在的实体：${ghosts.join(",")}`);
      setBucket(p.surface, reordered.filter((x) => x));
    } else if (kind === "entity_removed") {
      drop(p.surface, p.entity_id);
    } else if (kind === "entity_state_changed" || kind === "store_state_changed") {
      const surface = p.surface;
      const fields = p.fields || {};
      if (kind === "store_state_changed") {
        for (const k of p.removed || []) delete state[surface][k];
        Object.assign(state[surface], clone(fields));
      } else {
        const ent = find(surface, p.entity_id);
        if (!ent) {
          anomalies.push(`seq=${row.seq}: entity_state_changed 指向不存在的 ${surface}/${p.entity_id}`);
          continue;
        }
        for (const k of p.removed || []) delete ent[k];
        Object.assign(ent, clone(fields));
      }
    } else if (kind === "entity_activated") {
      state.sessions.active_id = p.active_id;
    } else if (kind === "message_committed") {
      const surface = surfaceOfRow(state, row.sessionId);
      const ent = find(surface, row.sessionId);
      if (!ent) {
        anomalies.push(`seq=${row.seq}: message_committed 指向的 ${row.sessionId} 不在任何一张面里`);
        continue;
      }
      const key = LIST_FIELD[surface];
      if (!Array.isArray(ent[key])) ent[key] = [];
      ent[key].push(clone(p.message));
    } else if (kind === "message_updated") {
      const surface = surfaceOfRow(state, row.sessionId);
      const ent = find(surface, row.sessionId);
      const msg = ent && Array.isArray(ent[LIST_FIELD[surface]]) ? ent[LIST_FIELD[surface]].find((m) => String(m && m.id) === String(p.message_id)) : null;
      if (!msg) {
        anomalies.push(`seq=${row.seq}: message_updated 找不到消息 ${p.message_id}`);
        continue;
      }
      for (const k of p.removed || []) delete msg[k];
      Object.assign(msg, clone(p.fields || {}));
    } else if (kind === "message_removed") {
      const surface = surfaceOfRow(state, row.sessionId);
      const ent = find(surface, row.sessionId);
      if (!ent) {
        anomalies.push(`seq=${row.seq}: message_removed 指向的 ${row.sessionId} 不存在`);
        continue;
      }
      const key = LIST_FIELD[surface];
      const i = (ent[key] || []).findIndex((m) => String(m && m.id) === String(p.message_id));
      if (i < 0) anomalies.push(`seq=${row.seq}: 要删的消息 ${p.message_id} 不在 ${row.sessionId} 里`);
      else ent[key].splice(i, 1);
    } else if (kind === "history_pruned") {
      const surface = surfaceOfRow(state, row.sessionId);
      const ent = find(surface, row.sessionId);
      if (!ent) {
        anomalies.push(`seq=${row.seq}: history_pruned 指向的 ${row.sessionId} 不存在`);
        continue;
      }
      const key = LIST_FIELD[surface];
      ent[key] = (ent[key] || []).slice(Number(p.count) || 0);
    } else if (kind === "approval_decided") {
      const ent = find("approvals", p.approval_id);
      if (!ent) anomalies.push(`seq=${row.seq}: approval_decided 指向不存在的审批 ${p.approval_id}`);
      else ent.decision = clone(p.decision);
    } else {
      // delta 不落库；其余未知 kind 说明词表和折叠器脱节了，必须点名
      anomalies.push(`seq=${row.seq}: 折叠器不认识 kind=${kind}`);
    }
  }
  state.anomalies = anomalies;
  return state;
}

const API = { BASELINE, LIST_FIELD, IGNORED_KINDS, foldEvents, surfaceOfRow, findIn, clone };

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof globalThis !== "undefined" && globalThis.__bitbotClientCore) {
  Object.assign(globalThis.__bitbotClientCore, API);
}
})();
