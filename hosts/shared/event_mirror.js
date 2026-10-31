/*
 * event_mirror.js — T1-03 双写旁路：把「快照的一次变化」翻成可逆的增量事件。
 *
 * 契约真源是 docs/events.md §5.4（这一节就是照着它写的，代码里不再各立一套 kind）。
 * 三条设计决定，每条都有代价，写清楚：
 *
 * 1) 只在三个收敛点挂钩（sessions 的 save、rooms 的 saveRooms/atomicWrite、
 *    审批的 appendJsonl/atomicWrite），不改任何调用点的行为：镜像失败也绝不冒回
 *    调用点，只计数 + stderr 一行。「旧客户端仍能连」靠的就是这一条。
 * 2) 派的是**增量**，不是整只快照。列表（messages/transcript/审批条目）走
 *    message_committed / message_removed / history_pruned；标量与非列表字段走
 *    entity_state_changed / store_state_changed。于是 fold 要相等就必须
 *    「每个被改的字段都有人认领」——这正是 AC-T1-3 想要的棘轮：新字段没人认领就红。
 * 3) 默认关。BITBOT_EVENT_DUAL_WRITE=1 才写库；关掉时连库都不开，
 *    用户数据目录里不会多出一个 sqlite 文件，连 event_log 都不会被 require
 *    （Electron 里的 Node 没有 node:sqlite，加载即抛 —— 见 openEventLogLazy）。
 *    运行时撑不起来时 getSharedMirror 返回一个「接口一样、一个字都不写」的替身，
 *    主进程照常启动；开关开着会打印一行降级说明，关着就完全静默。
 *
 * 这条旁路证明的是「事件日志能完整记账当前的 JSON 快照」，
 * 不证明「产品已经改读事件」——那是 T1-04。
 */

"use strict";

const fs = require("fs");
const path = require("path");

/* event_log 刻意**不在顶层 require**：它在没有 node:sqlite 的运行时里是「加载即抛」
   （event_log.js:22 起）。桌面端已升到 Electron 37（Node 22.21，node:sqlite 可用），
   但这条防御不撤：打包产物可能被丢回旧运行时、CLI host 可能在系统老 Node 上跑——
   顶层 require 会让主进程连启动都到不了，开关还没读到就崩，「不改任何调用点的行为」
   当场作废。所以把它压到真正要开库的那一刻，失败由 handle() 咽下并降级。 */
function openEventLogLazy(opts) {
  return require("./event_log").openEventLog(opts);
}

/** 三张面的基线——fold 从空开始，第一次写入必须把它记满。 */
const BASELINE = {
  sessions: { version: 1, active_id: "", sessions: [] },
  rooms: { version: 1, rooms: [] },
  approvals: [],
};

/**
 * 哪些文件算哪张面。按 basename 认，因为 dataRoot 在打包态是
 * `<userData>/data`、dev 态是 `<repo>/data`，只有文件名是稳定的。
 */
const SURFACE_BY_BASENAME = new Map([
  ["sessions.json", { surface: "sessions", shape: "store" }],
  ["rooms.json", { surface: "rooms", shape: "store" }],
  ["pending-approvals.jsonl", { surface: "approvals", shape: "jsonl" }],
]);

/* 实体里「不算列表」的字段：sessions.messages / rooms.transcript 才是列表。 */
const LIST_FIELD = { sessions: "messages", rooms: "transcript" };

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function isList(x) {
  return Array.isArray(x);
}

/** 标量 = 不是对象也不是数组；entity_state_changed 只认领这些和非列表集合。 */
function isPlainScalar(v) {
  return v === null || (typeof v !== "object");
}

function msgIdOf(m) {
  if (!m || typeof m !== "object") return null;
  return m.id != null ? String(m.id) : null;
}

/**
 * 一条消息列表的变化 → 事件。problems 表示「这个形状没人认领」，调用方把它记进
 * unattributed，绝不能装作发过了。
 *
 * 分成两条路，因为这两张面的列表根本不是一个形状：
 *
 * A) 有 id 的列表（sessions.messages，load() 会补齐 id）——按 id 对齐：
 *      · 消失的 id 全在队首且连续 → history_pruned{count}（只说「丢了几个」）
 *      · 其余消失 → message_removed{message_id}（removeMessage 就是这个）
 *      · 新增 → message_committed{message}
 *      · 同 id 但内容变了 → message_updated{message_id, fields}（react 改 reactions）
 *      · id 的相对顺序被打乱 → 不认领（今天没有这种代码，出现了就是新形状）
 *
 * B) 没有 id 的列表（rooms.transcript，行是 {kind,speaker,text,at}）——只认
 *    「队首丢弃 k 行 + 队尾追加」这一个形状，也就是 appendRoomTranscript 的
 *    200 上限真正做的事。其它形状一律记 problem，不猜。
 */
function diffList(sessionId, listName, prevRaw, nextRaw, refEntityId) {
  const out = [];
  const problems = [];
  const prev = isList(prevRaw) ? prevRaw : [];
  const next = isList(nextRaw) ? nextRaw : [];
  if (!isList(prevRaw) && prevRaw != null) problems.push(`${refEntityId}.${listName}: 旧值不是列表`);
  if (!isList(nextRaw) && nextRaw != null) problems.push(`${refEntityId}.${listName}: 新值不是列表`);
  if (!prev.length && !next.length) return { out, problems };

  const prevIds = prev.map(msgIdOf);
  const nextIds = next.map(msgIdOf);
  const hasIds = prevIds.every((x) => x !== null) && nextIds.every((x) => x !== null);

  if (hasIds) {
    const prevIndex = new Map(prevIds.map((id, i) => [id, i]));
    const nextIndex = new Map(nextIds.map((id, i) => [id, i]));
    const gone = prevIds.filter((id) => !nextIndex.has(id));
    const born = nextIds.filter((id) => !prevIndex.has(id));
    /* 相对顺序必须保持：next 里留下的 id 应当仍按 prev 里的先后出现 */
    const keptInPrev = prevIds.filter((id) => nextIndex.has(id));
    const keptInNext = nextIds.filter((id) => prevIndex.has(id));
    if (!sameSeq(keptInPrev, keptInNext)) {
      problems.push(`${refEntityId}.${listName}: 留下的行被重排了（${keptInPrev.join(",")} → ${keptInNext.join(",")}），镜像不认领重排`);
      return { out, problems };
    }
    /* 队首连续丢弃：gone 的 id 恰好是 prev 的前 k 行，且顺序就是它们 */
    const frontPrune = gone.length > 0 && sameSeq(gone, prevIds.slice(0, gone.length));
    if (frontPrune) {
      out.push({ kind: "history_pruned", sessionId, payload: { count: gone.length } });
    } else {
      for (const id of gone) {
        out.push({ kind: "message_removed", sessionId, payload: { message_id: id } });
      }
    }
    for (let i = 0; i < next.length; i++) {
      const id = nextIds[i];
      if (!prevIndex.has(id)) {
        out.push({
          kind: "message_committed",
          sessionId,
          payload: { message: clone(next[i]) },
        });
        continue;
      }
      const before = prev[prevIndex.get(id)];
      if (sameEntry(before, next[i])) continue;
      const fields = changedScalars(before, next[i], ["id"]);
      const rm = keysRemoved(before, next[i]);
      if (Object.keys(fields).length || rm.length) {
        out.push({
          kind: "message_updated",
          sessionId,
          payload: { message_id: id, fields: clone(fields), removed: rm },
        });
      }
    }
    /* born 里的 id 一定在 next 里被上面遍历到了；这里只是兜住「id 重复」这种怪形状 */
    if (new Set(born).size !== born.length) problems.push(`${refEntityId}.${listName}: 新增里有重复 id，镜像不认领`);
    return { out, problems };
  }

  /* B) 无 id：找偏移 k，让 prev.slice(k) 与 next 的开头对齐。
     对齐上了就只可能有两种账：队首丢了 k 行（history_pruned）+ 队尾追加了若干行
     （message_committed），两者可以只有其一。对不上就不猜——但要把「对不上在哪」
     说清楚，否则这条 problem 没法读。 */
  const ph = prev.map((x) => JSON.stringify(x));
  const nh = next.map((x) => JSON.stringify(x));
  let aligned = -1;
  for (let k = 0; k <= prev.length; k++) {
    const tail = ph.length - k;
    if (tail > nh.length) continue;
    let okRun = true;
    for (let j = 0; j < tail; j++) {
      if (ph[k + j] !== nh[j]) {
        okRun = false;
        break;
      }
    }
    if (okRun) {
      aligned = k;
      break;
    }
  }
  if (aligned < 0) {
    const detail = describeIdlessMismatch(ph, nh);
    problems.push(`${refEntityId}.${listName}: 既不是「队首丢弃+队尾追加」也不是纯追加，镜像不猜（prev ${prev.length} 行 → next ${next.length} 行；${detail}）`);
    return { out, problems };
  }
  if (aligned > 0) out.push({ kind: "history_pruned", sessionId, payload: { count: aligned } });
  const kept = ph.length - aligned;
  for (let i = kept; i < nh.length; i++) {
    out.push({ kind: "message_committed", sessionId, payload: { message: clone(next[i]) } });
  }
  return { out, problems };
}

/** 两条无 id 列表对不上时，把第一条差异点名出来（长度相同就是「某行被改写」）。 */
function describeIdlessMismatch(ph, nh) {
  const cut = (s) => (s.length > 120 ? s.slice(0, 120) + "…" : s);
  if (ph.length === nh.length) {
    const i = ph.findIndex((x, j) => x !== nh[j]);
    if (i >= 0) return `第 ${i} 行被就地改写：${cut(ph[i])} → ${cut(nh[i])}`;
    return "逐字相同（没有可记的变化）";
  }
  const i = ph.findIndex((x, j) => j >= nh.length || x !== nh[j]);
  return `从第 ${i} 行起对不上：${cut(ph[i] ?? "（prev 到此为止）")} → ${cut(nh[i] ?? "（next 到此为止）")}`;
}

function sameSeq(a, b) {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

function sameEntry(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function changedScalars(prevObj, nextObj, skipKeys) {
  const skip = new Set(skipKeys || []);
  const fields = {};
  for (const k of Object.keys(nextObj || {})) {
    if (skip.has(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(prevObj || {}, k) || !sameEntry(prevObj[k], nextObj[k])) {
      fields[k] = nextObj[k];
    }
  }
  return fields;
}

function keysRemoved(prevObj, nextObj) {
  const out = [];
  for (const k of Object.keys(prevObj || {})) {
    if (!Object.prototype.hasOwnProperty.call(nextObj || {}, k)) out.push(k);
  }
  return out;
}

/** 实体的标量 + 非列表字段变化（列表已经由 diffList 认领） */
function entityScalarFields(prevObj, nextObj, listKey, alreadyOwned) {
  const owned = new Set([listKey, "id"].concat(alreadyOwned || []));
  const fields = {};
  const problems = [];
  for (const k of Object.keys(nextObj || {})) {
    if (owned.has(k)) continue;
    if (Object.prototype.hasOwnProperty.call(prevObj || {}, k) && sameEntry(prevObj[k], nextObj[k])) continue;
    if (isPlainScalar(nextObj[k]) || Array.isArray(nextObj[k])) {
      fields[k] = nextObj[k];
    } else if (nextObj[k] && typeof nextObj[k] === "object") {
      // 嵌套对象（今天没有）：宁可当场说不认领，也不要悄悄塞进「标量补丁」
      problems.push(`实体字段 ${k} 是嵌套对象，镜像的补丁词表不覆盖它`);
    } else {
      fields[k] = nextObj[k];
    }
  }
  const gone = [];
  for (const k of Object.keys(prevObj || {})) {
    if (owned.has(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(nextObj || {}, k)) gone.push(k);
  }
  if (Object.keys(fields).length || gone.length) {
    return { fields, removed: gone, problems };
  }
  return null;
}

/* ===== 三张面的 diff（写入侧） ===== */

function diffStore(surface, prevRaw, nextRaw) {
  const events = [];
  const problems = [];
  const prevList = (prevRaw && prevRaw[surface === "rooms" ? "rooms" : "sessions"]) || [];
  const nextList = (nextRaw && nextRaw[surface === "rooms" ? "rooms" : "sessions"]) || [];
  const listKey = LIST_FIELD[surface];
  const prevById = new Map(prevList.map((e) => [String(e.id), e]));
  const nextById = new Map(nextList.map((e) => [String(e.id), e]));

  if (!prevRaw) {
    // 第一次看到这个 store：整只实体（含当时的列表）由创建事件带进来
  }

  for (const e of nextList) {
    if (prevById.has(String(e.id))) continue;
    events.push({
      kind: "session_created",
      sessionId: String(e.id),
      payload: { surface, session: clone(e) },
    });
  }
  for (const e of prevList) {
    if (!nextById.has(String(e.id))) {
      events.push({
        kind: "entity_removed",
        sessionId: String(e.id),
        payload: { surface, entity_id: String(e.id) },
      });
    }
  }
  /* 顺序也是状态：sessions.create 是 unshift（新会话排最前），fold 只会往尾上加，
     所以列表顺序和「按创建顺序排出来的样子」不一致时必须把整条顺序记一笔。 */
  const expectedOrder = prevList
    .map((e) => String(e.id))
    .filter((id) => nextById.has(id))
    .concat(nextList.map((e) => String(e.id)).filter((id) => !prevById.has(id)));
  const actualOrder = nextList.map((e) => String(e.id));
  if (!sameSeq(expectedOrder, actualOrder)) {
    events.push({ kind: "entity_order_changed", sessionId: "system", payload: { surface, ids: actualOrder } });
  }
  for (const e of nextList) {
    const before = prevById.get(String(e.id));
    if (!before) continue;
    const d = diffList(String(e.id), listKey, before[listKey], e[listKey], String(e.id));
    events.push(...d.out);
    problems.push(...d.problems);
    const owned = [];
    if (d.out.some((x) => x.kind === "message_committed" || x.kind === "message_updated")) owned.push(listKey);
    const patch = entityScalarFields(before, e, listKey, owned);
    if (patch) {
      if (patch.problems.length) problems.push(...patch.problems);
      if (Object.keys(patch.fields).length || patch.removed.length) {
        events.push({
          kind: "entity_state_changed",
          sessionId: String(e.id),
          payload: { surface, entity_id: String(e.id), fields: clone(patch.fields), removed: clone(patch.removed) },
        });
      }
    }
  }
  // store 级标量：sessions 的 version/active_id、rooms 的 version
  const skip = surface === "rooms" ? ["rooms"] : ["sessions", "version"];
  const fields = changedScalars(prevRaw || { version: BASELINE[surface].version }, nextRaw || {}, skip);
  /* store 顶层的键消失也要记账：changedScalars 只看 next 的键，少了什么它看不见，
     fold 就会把旧值留在原地——那是最难受的一种漂移（不报错，只是不对）。 */
  const storeGone = keysRemoved(prevRaw || BASELINE[surface], nextRaw || {}).filter(
    (k) => !skip.includes(k) && k !== "active_id",
  );
  if (surface === "sessions") {
    // active_id 由 session_activated 语义承载，但词表里它是 store 标量
    delete fields.active_id;
    const activeBefore = prevRaw ? prevRaw.active_id : BASELINE.sessions.active_id;
    if (nextRaw && String(nextRaw.active_id || "") !== String(activeBefore || "")) {
      /* sessionId 用保留值 "system"：这条事件讲的是「store 的激活项换了」，
         而且空快照时 active_id 是 ""——把 "" 当 session_id 写库会被适配器拒收
         （remove 掉最后一个会话就是这条路）。 */
      events.push({ kind: "entity_activated", sessionId: "system", payload: { surface, active_id: nextRaw.active_id } });
    }
  }
  if (Object.keys(fields).length || storeGone.length) {
    events.push({ kind: "store_state_changed", sessionId: "system", payload: { surface, fields: clone(fields), removed: clone(storeGone) } });
  }
  return { events, problems };
}

function diffApprovals(prevList, nextList) {
  const events = [];
  const problems = [];
  const prevById = new Map(prevList.map((e) => [String(e.id), e]));
  const nextById = new Map(nextList.map((e) => [String(e.id), e]));

  for (const e of nextList) {
    if (prevById.has(String(e.id))) continue;
    events.push({ kind: "approval_requested", sessionId: String(e.id), payload: { approval: clone(e) } });
  }
  for (const e of prevList) {
    if (!nextById.has(String(e.id))) {
      events.push({ kind: "entity_removed", sessionId: String(e.id), payload: { surface: "approvals", entity_id: String(e.id) } });
    }
  }
  const expectedOrder = prevList.map((e) => String(e.id)).filter((id) => nextById.has(id)).concat(nextList.map((e) => String(e.id)).filter((id) => !prevById.has(id)));
  const actualOrder = nextList.map((e) => String(e.id));
  if (!sameSeq(expectedOrder, actualOrder)) {
    events.push({ kind: "entity_order_changed", sessionId: "system", payload: { surface: "approvals", ids: actualOrder } });
  }
  for (const e of nextList) {
    const before = prevById.get(String(e.id));
    if (!before) continue;
    const patch = changedScalars(before, e, ["id"]);
    const gone = keysRemoved(before, e);
    /* 决定这个动作是语义事件，不能让补丁词表把它吃掉：doc §5.2 #7 要的就是这一条。 */
    if (Object.prototype.hasOwnProperty.call(patch, "decision")) {
      events.push({
        kind: "approval_decided",
        sessionId: String(e.id),
        payload: { approval_id: String(e.id), decision: clone(e.decision) },
      });
      delete patch.decision;
    }
    if (Object.keys(patch).length || gone.length) {
      events.push({
        kind: "entity_state_changed",
        sessionId: String(e.id),
        payload: { surface: "approvals", entity_id: String(e.id), fields: clone(patch), removed: clone(gone) },
      });
    }
  }
  return { events, problems };
}

function diffSurface(def, prevText, nextText) {
  let prevRaw = null;
  let nextRaw = null;
  if (def.shape === "jsonl") {
    prevRaw = parseJsonl(prevText);
    nextRaw = parseJsonl(nextText);
    return diffApprovals(prevRaw, nextRaw);
  }
  prevRaw = prevText == null ? null : safeParse(prevText);
  nextRaw = safeParse(nextText);
  if (nextRaw == null) return { events: [], problems: [`${def.surface}: 新快照不是合法 JSON，镜像不派事件`] };
  if (prevRaw == null && prevText != null) {
    return { events: [], problems: [`${def.surface}: 旧快照读不回（坏了），无法做增量`] };
  }
  return diffStore(def.surface, prevRaw, nextRaw);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

function parseJsonl(text) {
  if (text == null || text === "") return [];
  return String(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch (_e) {
        return null;
      }
    })
    .filter((x) => x !== null && x !== undefined);
}

/* ===== 折叠（读侧） ===== */

/**
 * 从事件行重建三张面。行形状是 event_log.readAfter 的返回值
 * （{seq, sessionId, kind, payload(JSON 文本), actor, ts, idemKey}）。
 *
 * 刻意不从 JSON 借任何东西：基线是 BASELINE，除此之外只有事件里写的。
 * @returns {{sessions:object, rooms:object, approvals:Array}}
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

function surfaceOfRow(state, sessionId) {
  if (findIn(state.rooms.rooms, sessionId)) return "rooms";
  if (findIn(state.sessions.sessions, sessionId)) return "sessions";
  return "sessions";
}

function findIn(arr, id) {
  return (arr || []).find((e) => String(e.id) === String(id));
}

/* ===== 挂到写入点上的那层 ===== */

function surfaceOf(filePath) {
  return SURFACE_BY_BASENAME.get(path.basename(String(filePath))) || null;
}

/**
 * 一个进程一个镜像句柄。open() 之后 capture/commit 成对使用；
 * 未开（默认）时两个函数都是 no-op，且不碰磁盘。
 */
function createMirror(opts = {}) {
  const env = opts.env || process.env;
  const dataRoot = path.resolve(opts.dataRoot || "");
  if (!dataRoot) throw new Error("createMirror: 需要 dataRoot");
  const file = opts.file ? path.resolve(opts.file) : path.join(dataRoot, "events", "desktop-events.sqlite");
  const actor = String(opts.actor || env.BITBOT_ACTOR || "desktop-" + process.pid);
  const enabled = opts.enabled !== undefined ? !!opts.enabled : String(env.BITBOT_EVENT_DUAL_WRITE || "") === "1";
  const log = opts.log || ((msg) => process.stderr.write(msg + "\n"));

  let logHandle = null;
  let openError = null;
  const stats = { emitted: 0, duplicated: 0, kinds: {}, unattributed: [], failures: 0, writes: 0 };

  function handle() {
    if (!enabled) return null;
    if (logHandle || openError) return logHandle;
    try {
      logHandle = openEventLogLazy({ file, actor, busyTimeoutMs: opts.busyTimeoutMs });
    } catch (err) {
      openError = err;
      stats.failures++;
      log(`[event-mirror] 开库失败，本轮镜像全部降级为不写：${err && err.message ? err.message : err}`);
      return null;
    }
    return logHandle;
  }

  /** 写入前调用：把旧内容读出来当 diff 的左半边。禁用时返回 null，零磁盘开销。 */
  function capture(filePath) {
    if (!enabled) return null;
    const def = surfaceOf(filePath);
    if (!def) return null;
    try {
      return { def, prev: fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null };
    } catch (err) {
      noteFailure(`capture(${filePath}) 读旧快照失败`, err);
      return null;
    }
  }

  /** 写入后调用：派事件、追加落库。任何异常都在这里咽下并计数——行为不变是硬要求。 */
  function commit(filePath, token, nextText) {
    if (!enabled || !token) return false;
    stats.writes++;
    try {
      const next = nextText != null ? nextText : fs.readFileSync(filePath, "utf8");
      const { events, problems } = diffSurface(token.def, token.prev, next);
      if (problems.length) {
        for (const p of problems) stats.unattributed.push(p);
        log(`[event-mirror] ${token.def.surface}: ${problems.length} 处变化没人认领（快照照常写了，但 fold 会跟不上）`);
      }
      const h = handle();
      if (!h) return false;
      for (const e of events) {
        // 刻意不发 idem_key：幂等在 diff 里（prev 每次都从盘上重读，内容没变就是
        // 空 delta），不在键里。按内容哈希当键会把「同一个值被来回切」的第二、三次
        // 当成重复吞掉，fold 折回来的 active_id 就停在旧值上——那是假的去重。
        const res = h.append({ sessionId: e.sessionId, kind: e.kind, payload: e.payload });
        if (res.duplicated) stats.duplicated++;
        stats.emitted++;
        stats.kinds[e.kind] = (stats.kinds[e.kind] || 0) + 1;
      }
      return events.length > 0;
    } catch (err) {
      noteFailure(`commit(${filePath}) 派事件失败`, err);
      return false;
    }
  }

  function noteFailure(where, err) {
    stats.failures++;
    const first = stats.failures === 1;
    if (first) log(`[event-mirror] ${where}：${err && err.message ? err.message : err}（后续同类失败只计数，不再刷屏）`);
  }

  return {
    enabled,
    file,
    stats,
    capture,
    commit,
    close() {
      if (logHandle) {
        try {
          logHandle.close();
        } catch (_e) {
          /* 已经关了 */
        }
        logHandle = null;
      }
    },
  };
}

/* ===== 进程内共享句柄 =====
   sessions.js 与 product_surface.js 用的是同一个 dataRoot，各自 open 会在同一个
   sqlite 文件上开两个连接；镜像只需要一条流，所以按库文件路径缓存一个句柄。
   门在换临时目录时要能把这些句柄关掉重来，故另有 closeAllMirrors()。 */

const SHARED = new Map();

/* ===== 运行时能不能撑得起这条旁路 =====
   探测只做一次并缓存。用 require 试探而不是看 process.versions.node：
   「有没有 node:sqlite」是唯一要紧的事实，版本号的门槛（22.5）会变，
   而且 Electron 的 Node 版本串与 feature 集并不总是对齐。 */
let sqliteSupport;
function hasNodeSqlite() {
  if (sqliteSupport === undefined) {
    try {
      require("node:sqlite");
      sqliteSupport = true;
    } catch (_err) {
      sqliteSupport = false;
    }
  }
  return sqliteSupport;
}

/** 镜像在这个运行时是否可能工作（门用它决定断言还是 SKIP）。 */
function isAvailable() {
  return hasNodeSqlite();
}

/** 撑不起来时的替身：接口一模一样，但一个字都不写。
   必须在 event_log 之外判断——它在老运行时里是「加载即抛」的，
   而这份镜像默认关：开关没开却被一次 require 打死主进程启动，
   是最贵的一种「改了行为」（Electron 33 = Node 20.18.3 时代踩到的；现桌面已升
   Electron 37 / Node 22.21，这条防御保留给旧运行时与老 CLI host）。 */
function createDisabledMirror(dataRoot, env) {
  const enabled = String((env || process.env).BITBOT_EVENT_DUAL_WRITE || "") === "1";
  if (enabled) {
    process.stderr.write(
      `[event-mirror] 已降级为不写：当前运行时没有内置 SQLite（node:sqlite，Node ${process.version}），` +
        `而双写开关是开着的（${path.join(dataRoot, "events", "desktop-events.sqlite")} 不会出现）。` +
        "快照写入不受影响。\n",
    );
  }
  const stats = { emitted: 0, duplicated: 0, kinds: {}, unattributed: [], failures: 0, writes: 0 };
  return {
    enabled: false,
    file: null,
    stats,
    unavailable: true,
    capture() {
      return null;
    },
    commit() {
      return false;
    },
    close() {},
  };
}

function getSharedMirror(dataRoot, opts = {}) {
  const root = path.resolve(dataRoot);
  const file = opts.file ? path.resolve(opts.file) : path.join(root, "events", "desktop-events.sqlite");
  const key = file;
  if (SHARED.has(key)) return SHARED.get(key);
  const m = hasNodeSqlite()
    ? createMirror({ ...opts, dataRoot: root, file })
    : createDisabledMirror(root, opts.env);
  SHARED.set(key, m);
  return m;
}

function closeAllMirrors() {
  for (const m of SHARED.values()) {
    try {
      m.close();
    } catch (_e) {
      /* 关不掉也别把调用方带崩 */
    }
  }
  SHARED.clear();
}

/** 深比较并报告第一条差异路径——门的红话要能指到字段。 */
function deepDiff(a, b, pathSoFar, out) {
  const where = pathSoFar || "$";
  if (out.length >= 12) return out;
  const ta = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const tb = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb) {
    out.push(`${where}: 类型 ${ta} ≠ ${tb}`);
    return out;
  }
  if (ta === "array") {
    if (a.length !== b.length) out.push(`${where}: 长度 ${a.length} ≠ ${b.length}`);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) deepDiff(a[i], b[i], `${where}[${i}]`, out);
    return out;
  }
  if (ta === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    for (const k of ka) {
      if (!kb.includes(k)) out.push(`${where}.${k}: 只在一边有（fold 里有、快照没有）`);
    }
    for (const k of kb) {
      if (!ka.includes(k)) out.push(`${where}.${k}: 只在一边有（快照里有、fold 跟不上）`);
    }
    for (const k of ka) {
      if (kb.includes(k)) deepDiff(a[k], b[k], `${where}.${k}`, out);
    }
    return out;
  }
  if (a !== b) out.push(`${where}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  return out;
}

module.exports = {
  BASELINE,
  SURFACE_BY_BASENAME,
  surfaceOf,
  diffSurface,
  foldEvents,
  createMirror,
  getSharedMirror,
  isAvailable,
  closeAllMirrors,
  deepDiff,
};
