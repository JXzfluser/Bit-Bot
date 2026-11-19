/*
 * surface_parity.js — #81 对账尺：把「两条取数路径的偏差」量成可比较的计数，而不是一个布尔。
 *
 * 对标口径来自 §8.159：Grok 的 transcript_store_parity 比的是**同一段数据的两个来源**
 * （`xee(vEe(gatewayPage), serverPage.entries)`），产出 `matched/mismatched/missing/extra/staleTail`
 * 加一个单值 `readReason` 标签，非零即 warn 级。我们没有那两个来源，我们的两条路径是
 * **fold(events)** 与 **旁路 JSON** —— 双写模式下两边都该是同一份事实，这正是漂移最贵的那一种
 * （片10/10b 之后写口对「读不到的折叠」直接拒绝，可 JSON 与日志一旦分开，今天没有任何东西会说出来）。
 *
 * 三条刻意不照抄的地方（都是 §8.159 逐字作废过的）：
 *   1. 不搬 `missing`/`extra` 这两个反向词 —— Grok 的 `missing` 是「较新的那侧有、另一侧没有」。
 *      这里改成两个具名字段，读的人不需要记住方向约定。
 *   2. `painted` 不接受写死 —— Grok 那个产生点是 `painted:!0` 硬编码。我们从渲染端拿不到
 *      「实际画了哪几行」，所以如实置 null 并带原因；宁可缺一档读数，不造一个恒真的字段。
 *   3. `tailGap`（对应 staleTail）需要两侧都有游标；旁路 JSON 没有游标，同样如实置 null。
 *
 * 「没有读数」与「读数为 0」是两个态（§8.159 的 `e.length===0?null:…` 那条形状）。
 * 这条直接决定反向对照夹具怎么写：拿空目录当「一致」会把恒真断言请回来。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { dbFilePath, foldPages } = require("./event_read_model");
const { openEventLog } = require("./event_log");

/** 这条尺比的那一对是谁 —— 单值标签，语义照 §8.159：给「配对」命名，不是「走了哪条读路」。 */
const READ_REASON = "fold_vs_json";

/** 旁路面在 `<dataRoot>/desktop/` 下（与 prove_event_dual_write.mjs:70-72 同一份路径口径），
 *  日志库在 `<dataRoot>/events/`。少一层 desktop/ 会把三张面全读成 no_reading —— 假干净的反面。 */
const SURFACES = [
  { surface: "sessions", file: "desktop/sessions.json", shape: "store", listKey: "sessions" },
  { surface: "rooms", file: "desktop/rooms.json", shape: "store", listKey: "rooms" },
  { surface: "approvals", file: "desktop/pending-approvals.jsonl", shape: "jsonl", listKey: null },
];

function entityKeyOf(entity, index) {
  if (entity && typeof entity === "object") {
    for (const k of ["id", "approval_id", "session_id", "room_id"]) {
      if (typeof entity[k] === "string" && entity[k]) return entity[k];
    }
  }
  return `#${index}`;
}

/** 一侧的实体数组；文件读不到/形状不认识时返回 null（→ 这条面是 no_reading，不是 0）。 */
function jsonSideList(dataRoot, def) {
  const full = path.join(dataRoot, def.file);
  let text;
  try {
    text = fs.readFileSync(full, "utf8");
  } catch (_e) {
    return null;
  }
  if (def.shape === "jsonl") {
    const out = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch (_e) {
        return null; // 半行撕裂：这侧的读数不作数，如实 no_reading
      }
    }
    return out;
  }
  let store;
  try {
    store = JSON.parse(text);
  } catch (_e) {
    return null;
  }
  const list = store && store[def.listKey];
  return Array.isArray(list) ? list : null;
}

/** 一侧的实体数组；日志侧折不出这张面时返回 null（→ no_reading）。 */
function foldSideList(surface, folded) {
  if (!folded) return null;
  if (surface === "approvals") return Array.isArray(folded.approvals) ? folded.approvals : null;
  const listKey = surface === "sessions" ? "sessions" : "rooms";
  const obj = folded[surface];
  return obj && Array.isArray(obj[listKey]) ? obj[listKey] : null;
}

/** 两侧同一实体的字段是否一致；返回第一条不一致的路径，一致则 null。 */
function firstDiffPath(a, b) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa === sb) return null;
  const pa = a && typeof a === "object" ? a : {};
  const pb = b && typeof b === "object" ? b : {};
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  for (const k of keys) {
    if (JSON.stringify(pa[k]) !== JSON.stringify(pb[k])) return k;
  }
  return "(形状)";
}

/**
 * 对一张面出一条读数。
 * @returns {object} `{kind:"reading"|"no_reading", ...}`；`no_reading` 一定带 `why`，
 *   且**绝不**同时带零计数 —— 调用方不能把两者混成一个「看起来干净」。
 */
function auditSurface(dataRoot, def, folded) {
  const jsonList = jsonSideList(dataRoot, def);
  const foldList = foldSideList(def.surface, folded);
  if (jsonList === null || foldList === null) {
    const why = [];
    if (foldList === null) why.push("日志侧不可读（没库 / 折不动）");
    if (jsonList === null) why.push("旁路 JSON 侧不可读（没文件 / 解析不了）");
    return { kind: "no_reading", surface: def.surface, readReason: READ_REASON, why: why.join(" + ") };
  }
  const foldById = new Map();
  foldList.forEach((e, i) => foldById.set(entityKeyOf(e, i), e));
  const jsonById = new Map();
  jsonList.forEach((e, i) => jsonById.set(entityKeyOf(e, i), e));

  let inFoldNotJson = 0;
  let inJsonNotFold = 0;
  let matched = 0;
  let mismatched = 0;
  let firstDiff = null;
  for (const [key, entity] of foldById) {
    if (!jsonById.has(key)) {
      inFoldNotJson += 1;
      if (!firstDiff) firstDiff = `${def.surface}:${key} 只在日志侧`;
      continue;
    }
    const dp = firstDiffPath(entity, jsonById.get(key));
    if (dp === null) matched += 1;
    else {
      mismatched += 1;
      if (!firstDiff) firstDiff = `${def.surface}:${key}.${dp}`;
    }
  }
  for (const key of jsonById.keys()) if (!foldById.has(key)) inJsonNotFold += 1;

  return {
    kind: "reading",
    surface: def.surface,
    readReason: READ_REASON,
    foldEntries: foldById.size,
    jsonEntries: jsonById.size,
    matched,
    mismatched,
    inFoldNotJson,
    inJsonNotFold,
    // 这两档今天量不到，如实置 null（不是 0）：见文件头第 2、3 条。
    painted: null,
    paintedWhy: "渲染端没有把「实际画出的行」回传 Host，不接受写死 true",
    tailGap: null,
    tailGapWhy: "旁路 JSON 没有游标，单侧 seq 差不成立",
    firstDiff,
  };
}

/** 非零即 warn，零读数是 info —— 级别照 §8.159 的 `mismatched>0||missing>0||extra>0 ? warn : info`。 */
function formatWarn(rec) {
  if (rec.kind === "no_reading") {
    return `[surface-parity] ${rec.surface} 无读数（${rec.why}）—— 这不是「一致」，别当干净读`;
  }
  const drift = rec.mismatched + rec.inFoldNotJson + rec.inJsonNotFold;
  const head =
    `[surface-parity] ${rec.surface} ${drift > 0 ? "偏差" : "一致"}：` +
    `日志 ${rec.foldEntries} 条 / JSON ${rec.jsonEntries} 条 · ` +
    `matched=${rec.matched} mismatched=${rec.mismatched} ` +
    `只在日志=${rec.inFoldNotJson} 只在JSON=${rec.inJsonNotFold} · ${rec.readReason}`;
  return drift > 0 ? `${head}${rec.firstDiff ? ` · 首处：${rec.firstDiff}` : ""}` : head;
}

/** 级别上屏用（warn / info），本模块不自己碰 console，方便门禁直接拿结构化读数。 */
function levelOf(rec) {
  return rec.kind === "no_reading" || rec.mismatched + rec.inFoldNotJson + rec.inJsonNotFold > 0
    ? "warn"
    : "info";
}

/** 增量折叠缓存槽：`{ lastSeq, folded }`（#82 / §8.165：尺和产品读路径付的是同一次全量折，
 *  2000 会话实测 330ms，接进任何反复调用的入口前必须先让它只折新行）。
 *  只缓存**折干净**的结果；带 anomalies 的起点会往下毒，`foldEvents` 现在也会直接拒。 */
const foldCacheByFile = new Map();

/* 缓存本体绝不交出去：调用方（以及下面的逐实体比较）可能原地改它。 */
function cloneFold(v) {
  return JSON.parse(JSON.stringify(v));
}

/** 测试用：清掉增量缓存（避免下一条判据读到上一条的槽）。 */
function resetFoldCache() {
  foldCacheByFile.clear();
}

/* 尺子的折叠同样必须「看完才报」（#83）：读满上限时旧实现拿前 N 行当整份日志算集合差，
   报出来的 drift 是**截断造成的假偏差**（少掉的那批实体会同时进「只在 JSON」侧）。
   现在分页折到底；护栏咬住就 foldMode="truncated" 且不折（→ 三张面如实 no_reading）。 */
function fullFold(db, limit) {
  const handle = openEventLog({ file: db, actor: "surface-parity" });
  try {
    const r = foldPages(handle, { fromSeq: 0, maxRows: limit });
    if (r.truncated) return { folded: null, rowsRead: r.rows, lastSeq: handle.lastSeq(), mode: "truncated" };
    return { folded: r.folded, rowsRead: r.rows, lastSeq: handle.lastSeq(), mode: "full" };
  } finally {
    try {
      handle.close();
    } catch (_e) {
      /* 读数已经拿到，关不掉不动这条记录 */
    }
  }
}

function cachedFoldOf(db, limit) {
  const handle = openEventLog({ file: db, actor: "surface-parity" });
  try {
    const lastSeq = handle.lastSeq();
    const slot = foldCacheByFile.get(db);
    /* 库被换掉/重建时 seq 会倒退或错位：那种情况绝不续折，直接全量重来。 */
    const continuable = slot && slot.folded && Number.isFinite(lastSeq) && lastSeq >= slot.lastSeq;
    if (continuable && lastSeq === slot.lastSeq) {
      return { folded: slot.folded, rowsRead: 0, mode: "reused", lastSeq };
    }
    if (continuable) {
      try {
        const inc = foldPages(handle, { fromSeq: slot.lastSeq, base: slot.folded, maxRows: limit });
        if (inc.truncated) return fullFold(db, limit);
        if (inc.folded.anomalies && inc.folded.anomalies.length === 0) {
          foldCacheByFile.set(db, { lastSeq, folded: inc.folded });
          return { folded: inc.folded, rowsRead: inc.rows, mode: "incremental", lastSeq };
        }
        /* 增量报异常不用它下结论：退回全量折取完整名单（保守 = 让全量说话）。 */
      } catch (_e) {
        /* fromState 被拒或状态形状变了：同样退回全量 */
      }
    }
    const r = fullFold(db, limit);
    if (r.mode === "truncated") return { folded: null, rowsRead: r.rowsRead, mode: "truncated", lastSeq: r.lastSeq };
    if (r.folded.anomalies && r.folded.anomalies.length === 0) {
      foldCacheByFile.set(db, { lastSeq: r.lastSeq, folded: r.folded });
    } else {
      foldCacheByFile.delete(db);
    }
    return { folded: r.folded, rowsRead: r.rowsRead, mode: continuable ? "full_refold" : "full", lastSeq: r.lastSeq };
  } finally {
    try {
      handle.close();
    } catch (_e) {
      /* 读数已经拿到，关不掉不动这条记录 */
    }
  }
}

/**
 * 三条面各出一条读数。
 * @param {{dataRoot:string, limit?:number, incremental?:boolean}} opts
 *   `incremental:false` 强制每次全量折（等值判据用它做对照，不是留给用户的开关）。
 * @returns {{records:object[], warnLines:string[], levels:string[], drift:number, noReading:number,
 *            foldMode:string, foldRows:number, lastSeq:number}}
 */
function auditSurfaces(opts = {}) {
  const dataRoot = String(opts.dataRoot || "");
  if (!dataRoot) throw new Error("auditSurfaces: 需要 dataRoot");
  let folded = null;
  let foldMode = "no_db";
  let foldRows = 0;
  let lastSeq = -1;
  const db = dbFilePath(dataRoot);
  if (db && fs.existsSync(db)) {
    // 直读日志再折，不走 readSurfaces：那个口在没开 BITBOT_EVENT_READ 时直接返回
    // read_disabled —— 对账要的是「日志侧到底折出什么」，与读切换开关无关（判据 F2 钉的就是这条）。
    const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 100000;
    let res;
    if (opts.incremental === false) {
      res = fullFold(db, limit);
    } else {
      res = cachedFoldOf(db, limit);
    }
    /* 截断（读满护栏）与折不动一样：没有可信的面，三张面一律走 no_reading。
       绝不拿「前 N 行折出来的面」算集合差 —— 少掉的那批实体会被记成「只在 JSON 侧」的假偏差。 */
    folded = res.folded && (!res.folded.anomalies || res.folded.anomalies.length === 0) ? res.folded : null;
    foldMode = res.mode === "truncated" ? "truncated" : folded ? res.mode : "fold_anomalies";
    foldRows = res.rowsRead;
    lastSeq = res.lastSeq;
  }

  const records = SURFACES.map((def) => auditSurface(dataRoot, def, folded));
  const warnLines = records.map(formatWarn);
  const levels = records.map(levelOf);
  return {
    records,
    warnLines,
    levels,
    foldMode,
    foldRows,
    lastSeq,
    drift: records.reduce((n, r) => (r.kind === "reading" ? n + r.mismatched + r.inFoldNotJson + r.inJsonNotFold : n), 0),
    noReading: records.filter((r) => r.kind === "no_reading").length,
  };
}

module.exports = { READ_REASON, SURFACES, auditSurface, auditSurfaces, formatWarn, levelOf, resetFoldCache };
