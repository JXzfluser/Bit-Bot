"use strict";

/**
 * client_core/diff_apply.js — KP-08（T3-03 + T3-05）：diff → 状态 + 「该怎么上屏」
 *
 * 这一份是现网 KP-07 那两个 applySessionsDiff / applyBotsDiff 的**纯计算半**：
 * 认 rev、改哪一行、算不算结构变化、要不要挪位置。DOM 一律不留在这里 ——
 * 渲染端只把 effects 翻译成节点操作，自己不再判「这条 diff 能不能就地应用」。
 *
 * 为什么必须只有一份：diff 上屏的规则一共三条（rev 连续才就地应用、diff 带新值
 * 所以重复应用幂等、只改字段就改字、结构真变了用本地缓存整份重画）。写在渲染端
 * 里，Host 的 fold 与它迟早对不上；写在核心里，门能直接喂合成 diff 逐条断言。
 *
 * 三条口径原样保留，包括两个容易被「顺手优化」掉的细节：
 *   · `updated_at` 变了但日期桶没变 → 就地改字；换了桶 → 整份重画（行要挪窝）。
 *   · 排序数组和现有行数对不上（少一行/多一行）→ 不许按数组画，交给整份重画，
 *     否则侧栏会悄悄丢行。
 *
 * 这里没有 require、没有 fs、没有 DOM；末尾那段 globalThis 汇总只让浏览器
 * <script> 直接拿到同一份实现（G-120 CC-01 扫的就是这条红线）。
 */

/* effects 的闭集。渲染端遇到不认识的效果必须当作契约漂移报出来，
   不许静默忽略——静默忽略就是「diff 来了屏幕不动」的那种红。 */
/* 同 schema.js / reducer.js：三个文件在同一个 realm 里被当 classic script 加载，
   顶层声明必须各自封闭，否则第二个 `const API` 会把整页打回未定义。 */
(function () {

const EFFECTS = [
  "ignored", // 回声/重发：rev 不比锚点新，内容早已生效，什么都不做
  "self_heal", // 跳号或没有基线 → 取整份（唯一允许发 IPC 的效果）
  "patch_row", // 就地改这一行的字段（节点身份保留）
  "remove_row", // 整份重画之前先把节点摘掉，保证 DOM 与状态不脱节
  "set_scalar", // 面级标量（active_id / primary_id）
  "reorder", // 顺序变了：能只移动站错位的那几行就只移动
  "summary_dirty", // 这一行的摘要变了，派生它的别处（Bot 次要行）要跟着刷
  "structural_rebuild", // 增删行 / 换桶 / 换组 / 改不动的字段 → 本地缓存整份重画
];

/* 结构变化的原因闭集：门按名字断言，不靠文案。 */
const REASONS = [
  "row_missing", // diff 指着一行状态里却没有
  "moved_bucket", // 换分组/换桶
  "field_not_patchable", // 字段不在就地更新白名单里
  "row_not_mounted", // 状态有这行，但屏上没有它的节点（渲染端注入的事实）
  "added",
  "removed",
  "day_bucket", // 会话换了「今天/昨天/更早」桶 → 行要挪窝
  "order_mismatch", // 排序数组和行数对不上
  "scalar", // 标量变了，弹层要按新 active_id 重画
];

/* 自愈的两条原因：渲染端只会「取整份」，但门要能分清是没锚点还是跳号。 */
const HEAL_REASONS = ["no_baseline", "rev_gap"];

function cloneRow(row) {
  return Object.assign({}, row);
}

/* 三张面之外，渲染端的状态就是这个形状。 */
function emptyState() {
  return { rev: null, buckets: { visible: [], hidden: [] }, scalars: {}, order: null };
}

/**
 * 整份快照 → 状态。渲染端拿到带 rev 的 list 回包时走这里，
 * 之后每条 diff 只在这个状态上前进，不再回头取整份。
 */
function snapshotToState(snapshot, spec) {
  const s = emptyState();
  const snap = snapshot || {};
  const rev = Number(snap.rev);
  s.rev = Number.isFinite(rev) ? rev : null;
  const buckets = (spec && spec.buckets) || ["visible"];
  const bucketKeys = (spec && spec.bucketKeys) || {};
  for (const b of buckets) {
    const key = bucketKeys[b] || b;
    const arr = Array.isArray(snap[key]) ? snap[key] : [];
    s.buckets[b] = arr.map(cloneRow);
  }
  for (const k of (spec && spec.scalars) || []) {
    if (k in snap) s.scalars[k] = snap[k];
  }
  s.order = Array.isArray(snap.order) ? snap.order.slice() : null;
  return s;
}

function idsOf(rows) {
  return (rows || []).map((r) => String(r && r.id));
}

/**
 * @param state 上一个状态（不会被就地改动）
 * @param diff  Host 的 broadcastSurface 载荷
 * @param spec  这张面的形状：buckets / scalars / 可 patch 字段 / 三个可选钩子
 * @returns {{state:object, effects:Array, noop:boolean}}
 */
function applyDiff(state, diff, spec) {
  const surface = (spec && spec.surface) || (diff && diff.surface) || "unknown";
  const buckets = (spec && spec.buckets) || ["visible"];
  const scalarKeys = spec && spec.scalars;
  const effects = [];
  const d = diff || {};
  const rev = Number(d.rev);
  const revKnown = Number.isFinite(rev);
  /* anchor 只认「真是个数」：Number(null)=0 也会被 Number.isFinite 放行，
     直接把 state.rev 拿去判会让冷启动（state=null）被当成锚点 0，
     于是 rev=1 的 diff 被就地应用在一屏空数据上。 */
  const anchor = state && Number.isFinite(Number(state.rev)) ? Number(state.rev) : null;

  /* 1) 认 rev。旧屏幕 + 半截 diff = 两个来源的数字互相矛盾，所以跳号只有一条路：自愈。 */
  if (revKnown && anchor !== null && rev <= anchor) {
    return { state, effects: [{ type: "ignored", reason: "rev_behind", surface, rev }], noop: true };
  }
  if (!Array.isArray(state && state.buckets && state.buckets.visible) || !revKnown || anchor === null || rev !== anchor + 1) {
    const reason = anchor === null ? "no_baseline" : "rev_gap";
    return { state, effects: [{ type: "self_heal", surface, reason, rev, anchor }], noop: true };
  }

  /* 2) 状态前进。行对象一律换成新副本，不改调用方传进来的那一份。 */
  const next = {
    rev,
    buckets: {},
    scalars: Object.assign({}, state.scalars),
    order: Array.isArray(state.order) ? state.order.slice() : null,
  };
  for (const b of buckets) next.buckets[b] = (state.buckets[b] || []).slice();
  for (const b of buckets) if (!next.buckets[b]) next.buckets[b] = [];

  let structural = false;
  const structuralReasons = new Set();
  const mark = (reason) => {
    structural = true;
    structuralReasons.add(reason);
  };

  const locate = (id) => {
    for (const b of buckets) {
      const at = next.buckets[b].findIndex((r) => r && String(r.id) === String(id));
      if (at >= 0) return { bucket: b, at };
    }
    return null;
  };

  for (const c of d.changed || []) {
    const cf = (c && c.changed_fields) || {};
    const hit = locate(c && c.entity_id);
    if (!hit) {
      mark("row_missing");
      continue;
    }
    const prev = next.buckets[hit.bucket][hit.at];
    const row = Object.assign({}, prev, cf);
    next.buckets[hit.bucket][hit.at] = row;

    /* 换桶/换组：行的位置或组头要变，就地改字画不出来。 */
    if (c.moved_bucket || (spec && spec.bucketField && spec.bucketField in cf)) {
      mark("moved_bucket");
      continue;
    }
    /* 会话：时间挪出了原来的日期桶，行要从「今天」搬到「昨天」。 */
    if (spec && spec.dayBucket && spec.dayField && spec.dayField in cf) {
      if (spec.dayBucket(prev[spec.dayField]) !== spec.dayBucket(row[spec.dayField])) {
        mark("day_bucket");
        continue;
      }
    }
    const patchable = spec && spec.patchFields;
    if (patchable && !Object.keys(cf).every((k) => patchable[k])) {
      mark("field_not_patchable");
      continue;
    }
    if (spec && typeof spec.isMounted === "function" && !spec.isMounted(c.entity_id)) {
      mark("row_not_mounted");
      continue;
    }
    effects.push({ type: "patch_row", surface, entity_id: String(c.entity_id), bucket: hit.bucket, changed_fields: cf, row });
    if (spec && spec.summaryFields) {
      const touched = Object.keys(cf).some((k) => spec.summaryFields.indexOf(k) >= 0);
      if (touched) effects.push({ type: "summary_dirty", surface, entity_id: String(c.entity_id), row });
    }
  }

  for (const a of d.added || []) {
    const bucket = buckets.indexOf(a && a.bucket) >= 0 ? a.bucket : buckets[0];
    const row = Object.assign({}, (a && a.row) || {}, { id: a && a.entity_id });
    const at = next.buckets[bucket].findIndex((r) => String(r && r.id) === String(a && a.entity_id));
    if (at >= 0) next.buckets[bucket][at] = row;
    else next.buckets[bucket].push(row);
    mark("added");
  }

  for (const id of d.removed || []) {
    for (const b of buckets) {
      next.buckets[b] = next.buckets[b].filter((r) => String(r && r.id) !== String(id));
    }
    effects.push({ type: "remove_row", surface, entity_id: String(id) });
    mark("removed");
  }

  for (const [k, v] of Object.entries(d.scalars || {})) {
    if (scalarKeys && scalarKeys.indexOf(k) < 0) continue; // 面上没声明的标量不进状态
    next.scalars[k] = v;
    effects.push({ type: "set_scalar", surface, key: k, value: v });
  }

  let orderApplied = null;
  if (d.order && Array.isArray(d.order.visible)) {
    const sorted = d.order.visible
      .map((id) => next.buckets[buckets[0]].find((r) => r && String(r.id) === String(id)))
      .filter(Boolean);
    if (sorted.length === next.buckets[buckets[0]].length) {
      next.buckets[buckets[0]] = sorted.map(cloneRow);
      next.order = idsOf(sorted);
      orderApplied = next.order.slice();
    } else {
      mark("order_mismatch");
    }
  }
  if (orderApplied) effects.push({ type: "reorder", surface, order: orderApplied });

  if (structural) {
    for (const reason of structuralReasons) effects.push({ type: "structural_rebuild", surface, reason });
  } else if (spec && spec.repaintOnScalar && Object.keys((d.scalars || {})).length) {
    effects.push({ type: "structural_rebuild", surface, reason: "scalar" });
  }

  return { state: next, effects, noop: false };
}

/** 这条 diff 会被渲染端认下来就地应用吗？门用它把「自愈」和「应用」分开断言。 */
function effectTypes(effects) {
  return (effects || []).map((e) => e.type);
}

const API = { EFFECTS, REASONS, HEAL_REASONS, emptyState, snapshotToState, applyDiff, effectTypes, idsOf };

if (typeof module !== "undefined" && module.exports) module.exports = API;
/* 浏览器侧：<script src> 没有模块系统，三个文件把自己的出口挂进同一个命名空间。
   globalThis 在 Node 与浏览器里同形，所以这里不出现 window/document。 */
if (typeof globalThis !== "undefined" && globalThis.__bitbotClientCore) {
  Object.assign(globalThis.__bitbotClientCore, API);
}
})();
