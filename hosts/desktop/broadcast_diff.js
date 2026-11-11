"use strict";

/**
 * KP-07（广播改 diff）：把侧栏的两条「整份快照」广播
 * （`bitbot:sessions-changed` = sessions.list()、`bitbot:bots-changed` =
 * surface.listViews()）压成「哪一行、哪几个字段变了」。
 *
 * 这里只做纯计算，不碰 Electron、不读盘 —— 真值从调用方给的两份快照算：
 * 上一份实际发出去的（base）与这一份刚生成的（next）。
 *
 * 三条不能省的红线：
 * 1. 不认形状就退回整份（full）—— 宁可多发一次，也不许少发字段；
 * 2. 变化行数超过阈值（churn）也退回整份 —— diff 只在「改动是局部的」时才划算；
 * 3. 每次发送都带单调 `rev` —— 渲染端发现自己跳号（漏收 / 重载 / 新窗口）就
 *    自己去取整份重画，drift 必须自愈，不能靠「希望没人漏」。
 */

const SURFACES = {
  sessions: {
    channel: "bitbot:sessions-changed",
    listKey: "sessions",
    // 渲染层真正读的字段（title/preview/updated_at/message_count + 分组按
    // updated_at 算），白名单外的字段一律不参与比对，也不会进 diff。
    fields: ["title", "preview", "updated_at", "message_count"],
    scalars: ["active_id"],
    bucketKey: null,
  },
  bots: {
    channel: "bitbot:bots-changed",
    listKey: "bots",
    fields: [
      "name",
      "updated_at",
      "pinned",
      "group",
      "description",
      "job",
      "tags",
      "avatar_data_url",
    ],
    scalars: ["primary_id"],
    // 侧栏的隐藏区是同一批行的另一个桶；桶本身算一个可比字段，
    // 于是「隐藏/取消隐藏」在 diff 里就是一次 changed_fields，而不是拆行。
    hiddenListKey: "hidden_bots",
  },
};

/** 行内值归一：数组/对象走 JSON，其他保持原值 —— 比较和上屏用同一份口径。 */
function normValue(v) {
  if (v === undefined) return null;
  if (v === null) return null;
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  return v;
}

/**
 * 把一份快照摊成 { id → {bucket, values} } + 每个桶的 id 顺序。
 * 返回 null 表示「这份快照不是本模块认的形状」，调用方必须走 full。
 */
function indexRows(surfaceName, payload) {
  const spec = SURFACES[surfaceName];
  if (!spec) return null;
  if (!payload || payload.ok === false) return null;
  const main = payload[spec.listKey];
  if (!Array.isArray(main)) return null;
  const rows = new Map();
  const order = { main: [], hidden: [] };
  const push = (row, bucket) => {
    if (!row || typeof row !== "object") return false;
    const id = String(row.id == null ? "" : row.id);
    if (!id) return false;
    if (rows.has(id)) return false; // 同一份快照里 id 重复 = 形状不认，退回 full
    const values = {};
    for (const f of spec.fields) values[f] = normValue(row[f]);
    values.__bucket = bucket;
    rows.set(id, { id, bucket, values });
    order[bucket === "hidden" ? "hidden" : "main"].push(id);
    return true;
  };
  for (const r of main) if (!push(r, "visible")) return null;
  if (spec.hiddenListKey) {
    const hidden = payload[spec.hiddenListKey];
    if (hidden !== undefined && hidden !== null) {
      if (!Array.isArray(hidden)) return null;
      for (const r of hidden) if (!push(r, "hidden")) return null;
    }
  }
  return { rows, order };
}

function scalarValues(spec, payload) {
  const out = {};
  for (const k of spec.scalars || []) out[k] = normValue(payload[k]);
  return out;
}

function orderEquals(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * diffSurface(surfaceName, prevPayload, nextPayload, opts?)
 *   → { mode: "noop" }
 *   → { mode: "full", payload }                       // 原样整份 + mode/surface/rev
 *   → { mode: "diff", payload }                       // 只有变化
 */
function diffSurface(surfaceName, prevPayload, nextPayload, opts) {
  const spec = SURFACES[surfaceName];
  if (!spec) return { mode: "full", payload: nextPayload, reason: "unknown_surface" };
  const o = opts || {};
  const rev = Number(o.rev) || 0;
  const nextIndex = indexRows(surfaceName, nextPayload);
  const prevIndex = prevPayload === undefined || prevPayload === null
    ? null
    : indexRows(surfaceName, prevPayload);

  // ① 形状不认 / 没有基线 / 显式要求 → 整份。full 里的 payload 就是调用方原本
  //    要发的那一份，只是多了 mode/surface/rev 三个自述字段，旧渲染代码读得到
  //    原来的 sessions/bots 字段。
  const forceFull = Boolean(o.forceFull);
  if (forceFull || !nextIndex || !prevIndex) {
    return {
      mode: "full",
      payload: Object.assign({}, nextPayload, { mode: "full", surface: surfaceName, rev }),
      reason: forceFull ? "forced" : !nextIndex ? "shape_unrecognized" : "no_baseline",
    };
  }

  const changed = [];
  const removed = [];
  const added = [];
  for (const [id, nextRow] of nextIndex.rows) {
    const prevRow = prevIndex.rows.get(id);
    if (!prevRow) {
      const row = Object.assign({}, nextRow.values);
      delete row.__bucket; // 桶在上层 bucket 字段里，行内容不许混进内部比对键
      added.push({ entity_id: id, bucket: nextRow.bucket, row });
      continue;
    }
    const diffFields = {};
    let n = 0;
    for (const f of Object.keys(nextRow.values)) {
      if (f === "__bucket") continue; // 桶的变化用 bucket/moved_bucket 表达，不混进字段表
      if (prevRow.values[f] !== nextRow.values[f]) {
        diffFields[f] = nextRow.values[f];
        n++;
      }
    }
    const movedBucket = prevRow.bucket !== nextRow.bucket;
    if (n || movedBucket) {
      changed.push({
        entity_id: id,
        bucket: nextRow.bucket,
        changed_fields: diffFields,
        ...(movedBucket ? { moved_bucket: true } : {}),
      });
    }
  }
  for (const [id] of prevIndex.rows) {
    if (!nextIndex.rows.has(id)) removed.push(id);
  }

  const prevScalars = scalarValues(spec, prevPayload);
  const nextScalars = scalarValues(spec, nextPayload);
  const scalarDiff = {};
  for (const k of Object.keys(nextScalars)) {
    if (prevScalars[k] !== nextScalars[k]) scalarDiff[k] = nextScalars[k];
  }

  const mainMoved = !orderEquals(prevIndex.order.main, nextIndex.order.main);
  const hiddenMoved = !orderEquals(prevIndex.order.hidden, nextIndex.order.hidden);

  const touched = changed.length + added.length + removed.length;
  const total = nextIndex.rows.size;
  // 阈值默认「最多两行，或总数四成」取较大者：小列表（2-5 个 Bot）一次改 2 行
  // 还在划算范围内，大列表（几十条会话）改到四成就该整份重发。
  const churnLimit = Number.isFinite(o.churnLimit)
    ? Number(o.churnLimit)
    : Math.max(2, Math.floor(total * 0.4));
  const structural = mainMoved || hiddenMoved || Object.keys(scalarDiff).length > 0;
  if (touched > churnLimit) {
    return {
      mode: "full",
      payload: Object.assign({}, nextPayload, { mode: "full", surface: surfaceName, rev }),
      reason: "churn_over_limit",
      touched,
      churn_limit: churnLimit,
    };
  }
  if (!touched && !structural) return { mode: "noop", surface: surfaceName };

  const payload = {
    mode: "diff",
    surface: surfaceName,
    rev,
    changed,
    added,
    removed,
    scalars: scalarDiff,
    order: mainMoved || hiddenMoved
      ? { visible: nextIndex.order.main, hidden: nextIndex.order.hidden }
      : null,
    // 行数口径也带上：渲染端拿它自证「应用完以后行数对得上」，
    // 对不上就必须自己回去取整份，而不是把缺的行留在屏幕上。
    count: total,
  };
  return { mode: "diff", payload };
}

/** 该面在当前实现里由哪个 IPC 通道承载（门与文档都用这一个口径问）。 */
function channelFor(surfaceName) {
  const spec = SURFACES[surfaceName];
  return spec ? spec.channel : null;
}

function surfaces() {
  return Object.keys(SURFACES);
}

module.exports = { SURFACES, diffSurface, indexRows, channelFor, surfaces, normValue };
