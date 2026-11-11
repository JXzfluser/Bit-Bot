#!/usr/bin/env node
"use strict";

/**
 * KP-07 广播 diff —— 结构门（纯计算，不起 Electron）。
 *
 * 要证的不是「diff 算得出来」，而是四件事：
 *   ① 该 diff 的时候只带变化（且带的是**对的那几个字段**）；
 *   ② 不该 diff 的时候老实退回整份（形状不认 / 没有基线 / 改动面太大）——
 *      宁可多发，也不许少发；
 *   ③ 完全没变就不发（noop），白名单外的字段变化不算变（否则「preview 没变也重画」）；
 *   ④ 对着**真 store 的真快照**算，字段名漂了当场翻红，而不是等用户在侧栏看见旧标题。
 *
 * 反向对照（N1..N4）改坏被测模块本体，断言必须跟着翻假 —— 绿的成色靠这个，不靠条数。
 *
 * 数据纪律：临时 dataRoot（os.tmpdir），绝不往仓库 data/ 写夹具。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const MODULE = path.join(REPO, "hosts/desktop/broadcast_diff.js");
const SRC = fs.readFileSync(MODULE, "utf8");

let PASS = 0;
let FAIL = 0;
const RULES = [];
const TARGETS = [];

function ok(msg, extra) {
  PASS++;
  console.log("  ✓ " + msg + (extra ? " · " + extra : ""));
}
function bad(msg, extra) {
  FAIL++;
  console.log("  ✗ " + msg + (extra ? " · " + extra : ""));
}
function rule(name, desc) {
  RULES.push(name + "=" + desc);
}
function line(id, cond, desc, extra) {
  TARGETS.push(id);
  if (cond) ok(id + " " + desc, extra);
  else bad(id + " " + desc, extra);
}

function loadFrom(src) {
  const m = { exports: {} };
  const fn = new Function("require", "module", "exports", "__dirname", "__filename", src);
  fn(require, m, m.exports, path.dirname(MODULE), MODULE);
  return m.exports;
}
const T = loadFrom(SRC);

/* ---------- 夹具：小形状，够把每条判据分开 ---------- */

const sess = (id, title, preview, updated, count) => ({
  id,
  title,
  preview,
  updated_at: updated,
  message_count: count,
});
const sessionsPayload = (activeId, rows, extra) =>
  Object.assign({ ok: true, active_id: activeId, sessions: rows, path: "/tmp/x.json" }, extra || {});

const bot = (id, name, updated, group) => ({
  id,
  name,
  updated_at: updated,
  group: group || "",
  pinned: false,
  description: "d",
  job: "j",
  tags: ["t"],
  avatar_data_url: "data:image/svg+xml;base64,AAAA",
});
const botsPayload = (visible, hidden, primaryId) => ({
  ok: true,
  bots: visible,
  hidden_bots: hidden || [],
  primary_id: primaryId || "b1",
});

rule("noop", "两份快照逐字段相同 → 一个字节都不发");
rule("exact-fields", "changed_fields 只含真变的白名单字段，不多不少");
rule("whitelist", "白名单外字段（path / model）变化不算变化");
rule("full-on-unknown-shape", "形状不认（ok:false / 不是数组 / id 重复）→ 整份");
rule("full-on-no-baseline", "没有基线（第一次广播）→ 整份");
rule("full-on-churn", "改动行数超阈值 → 整份，且带 reason=churn_over_limit");
rule("order", "只换顺序 → diff 带 order，changed 为空");
rule("bucket-move", "Bot 从可见移到隐藏 → changed 带 moved_bucket，不带别的字段");
rule("scalars", "active_id / primary_id 变化 → 落 scalars，不落 changed");
rule("real-store-shape", "真 sessions.list() / surface.listViews() 的形状本模块认，且字段名对得上");
rule("smaller-than-full", "真 store 上 diff 的字节数必须显著小于整份（否则这刀没意义）");
rule("rev", "每次发送带单调 rev，渲染端能据此发现跳号");

console.log("KP-07 广播 diff（broadcast_diff）结构门");

/* ---------- ① 该 diff 时只带变化 ---------- */

{
  const a = sessionsPayload("s1", [sess("s1", "旧标题", "旧预览", "2026-11-11T00:00:00Z", 2), sess("s2", "另一条", "x", "2026-11-10T00:00:00Z", 1)]);
  const b = sessionsPayload("s1", [sess("s1", "旧标题", "新预览", "2026-11-11T00:00:05Z", 3), sess("s2", "另一条", "x", "2026-11-10T00:00:00Z", 1)]);
  const r = T.diffSurface("sessions", a, b, { rev: 1 });
  line("BD-01",
    r.mode === "diff" && r.payload.changed.length === 1 && r.payload.changed[0].entity_id === "s1",
    "一行改动 → diff 且只点名那一行", "changed=" + JSON.stringify(r.payload.changed.map((c) => c.entity_id)));
  const cf = r.payload.changed[0].changed_fields;
  line("BD-02",
    Object.keys(cf).sort().join(",") === "message_count,preview,updated_at" && !("title" in cf),
    "changed_fields 精确到字段：只报真变的三个，未变的 title 不在里面",
    Object.keys(cf).sort().join(","));
  line("BD-03", r.payload.count === 2 && r.payload.added.length === 0 && r.payload.removed.length === 0,
    "行口径带上（count=2）且没有假增删");
}

{
  const a = sessionsPayload("s1", [sess("s1", "T", "p", "2026-11-11T00:00:00Z", 1)]);
  const r = T.diffSurface("sessions", a, JSON.parse(JSON.stringify(a)), { rev: 7 });
  line("BD-04", r.mode === "noop", "逐字段相同 → noop（不发）", "mode=" + r.mode);
}

{
  const a = sessionsPayload("s1", [sess("s1", "T", "p", "2026-11-11T00:00:00Z", 1)], { path: "/tmp/old.json" });
  const b = sessionsPayload("s1", [sess("s1", "T", "p", "2026-11-11T00:00:00Z", 1)], { path: "/tmp/new.json" });
  const r = T.diffSurface("sessions", a, b, { rev: 2 });
  line("BD-05", r.mode === "noop", "白名单外的 path 字段变了也不算变（不因此重画侧栏）");
  const a2 = botsPayload([bot("b1", "N", "2026-11-11T00:00:00Z")], [], "b1");
  const b2 = botsPayload([Object.assign(bot("b1", "N", "2026-11-11T00:00:00Z"), { model: "gpt-x" })], [], "b1");
  const r2 = T.diffSurface("bots", a2, b2, { rev: 3 });
  line("BD-06", r2.mode === "noop", "Bot 的白名单外字段（model）变了同样不发");
}

/* ---------- ② 不该 diff 时退回整份 ---------- */

{
  const b = sessionsPayload("s1", [sess("s1", "T", "p", "2026-11-11T00:00:00Z", 1)]);
  const r = T.diffSurface("sessions", null, b, { rev: 1 });
  line("BD-07", r.mode === "full" && r.reason === "no_baseline" && r.payload.mode === "full",
    "第一次广播 → 整份");
  line("BD-08",
    Array.isArray(r.payload.sessions) && r.payload.active_id === "s1" && r.payload.rev === 1,
    "整份里原来的字段一字不动还在（旧渲染代码读得到 sessions/active_id），只多 mode/surface/rev");
}

{
  const bad1 = { ok: false, error: "store_unreadable" };
  const bad2 = sessionsPayload("s1", "不是数组");
  const dup = sessionsPayload("s1", [sess("s1", "T", "p", "x", 1), sess("s1", "T", "p", "x", 1)]);
  const good = sessionsPayload("s1", [sess("s1", "T", "p", "x", 1)]);
  const r1 = T.diffSurface("sessions", bad1, good, { rev: 1 });
  const r2 = T.diffSurface("sessions", good, bad2, { rev: 1 });
  const r3 = T.diffSurface("sessions", dup, good, { rev: 1 });
  line("BD-09", r1.mode === "full" && r2.mode === "full" && r3.mode === "full",
    "ok:false / sessions 不是数组 / id 重复 → 三种坏形状一律整份",
    [r1.mode, r2.mode, r3.mode].join("/"));
}

{
  const rowsA = [];
  const rowsB = [];
  for (let i = 0; i < 8; i++) {
    rowsA.push(sess("s" + i, "T" + i, "p", "2026-11-1" + i + "T00:00:00Z", i));
    rowsB.push(sess("s" + i, "T" + i, "改了", "2026-11-1" + i + "T00:00:01Z", i + 1));
  }
  const r = T.diffSurface("sessions", sessionsPayload("s0", rowsA), sessionsPayload("s0", rowsB), { rev: 4 });
  line("BD-10", r.mode === "full" && r.reason === "churn_over_limit",
    "8 行全改 → 超过阈值，整份（diff 只在局部改动时划算）",
    "touched=" + r.touched + " limit=" + r.churn_limit);
  const few = T.diffSurface("sessions", sessionsPayload("s0", rowsA),
    sessionsPayload("s0", [rowsB[0]].concat(rowsA.slice(1))), { rev: 5 });
  line("BD-11", few.mode === "diff" && few.payload.changed.length === 1,
    "同规模只改 1 行 → 仍然 diff", "touched=1");
}

/* ---------- ③ 顺序 / 桶 / 标量 ---------- */

{
  const a = sessionsPayload("s1", [sess("s1", "A", "p", "2026-11-11T00:00:00Z", 1), sess("s2", "B", "q", "2026-11-10T00:00:00Z", 1)]);
  const b = sessionsPayload("s1", [sess("s2", "B", "q", "2026-11-10T00:00:00Z", 1), sess("s1", "A", "p", "2026-11-11T00:00:00Z", 1)]);
  const r = T.diffSurface("sessions", a, b, { rev: 6 });
  line("BD-12",
    r.mode === "diff" && r.payload.changed.length === 0 && r.payload.added.length === 0 &&
    r.payload.removed.length === 0 && r.payload.order &&
    r.payload.order.visible.join(",") === "s2,s1",
    "只换顺序 → diff 只带 order（渲染端据此移动既有节点，不重建）");
}

{
  const a = botsPayload([bot("b1", "N1", "2026-11-11T00:00:00Z")], [bot("b2", "N2", "2026-11-11T00:00:00Z")], "b1");
  const b = botsPayload([bot("b1", "N1", "2026-11-11T00:00:00Z"), bot("b2", "N2", "2026-11-11T00:00:00Z")], [], "b1");
  const r = T.diffSurface("bots", a, b, { rev: 8 });
  const c = (r.payload.changed || []).find((x) => x.entity_id === "b2");
  line("BD-13",
    r.mode === "diff" && c && c.moved_bucket === true && c.bucket === "visible" &&
    Object.keys(c.changed_fields).length === 0,
    "取消隐藏 → moved_bucket + 新桶，不带任何字段改动（名字没变就别重画名字）",
    JSON.stringify(c && { bucket: c.bucket, f: Object.keys(c.changed_fields) }));
  line("BD-14", r.payload.order && r.payload.order.hidden.length === 0 && r.payload.order.visible.join(",") === "b1,b2",
    "桶变了 → order 两个桶都给出新序");
}

{
  const a = sessionsPayload("s1", [sess("s1", "T", "p", "x", 1), sess("s2", "U", "q", "y", 1)]);
  const b = sessionsPayload("s2", [sess("s1", "T", "p", "x", 1), sess("s2", "U", "q", "y", 1)]);
  const r = T.diffSurface("sessions", a, b, { rev: 9 });
  line("BD-15",
    r.mode === "diff" && r.payload.scalars && r.payload.scalars.active_id === "s2" &&
    r.payload.changed.length === 0,
    "active_id 变了 → 落 scalars，changed 为空（切会话不该重画行内容）");
  const a2 = botsPayload([bot("b1", "N", "x")], [], "b1");
  const b2 = botsPayload([bot("b1", "N", "x")], [], "b2");
  const r2 = T.diffSurface("bots", a2, b2, { rev: 10 });
  line("BD-16",
    r2.mode === "diff" && r2.payload.scalars.primary_id === "b2" && r2.payload.changed.length === 0,
    "primary_id 变了 → 落 scalars");
}

{
  const a = sessionsPayload("s1", [sess("s1", "T", "p", "x", 1), sess("s2", "U", "q", "y", 1)]);
  const b = sessionsPayload("s1", [sess("s1", "T", "p", "x", 1)]);
  const r = T.diffSurface("sessions", a, b, { rev: 11 });
  line("BD-17",
    r.mode === "diff" && r.payload.removed.join(",") === "s2" && r.payload.count === 1,
    "删一行 → removed 点名，count 更新");
  const r2 = T.diffSurface("sessions", b, a, { rev: 12 });
  line("BD-18",
    r2.mode === "diff" && r2.payload.added.length === 1 && r2.payload.added[0].entity_id === "s2" &&
    r2.payload.added[0].row.title === "U" && !("__bucket" in r2.payload.added[0].row),
    "增一行 → added 带整行内容（渲染端不用回头再取一次），且内部键 __bucket 不上线");
}

/* ---------- ④ 真 store 的真快照 ---------- */

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kp07-root-"));
const dataRoot = path.join(tmpRoot, "data");
fs.mkdirSync(dataRoot, { recursive: true });

let real = null;
try {
  const { createSessionStore } = require(path.join(REPO, "hosts/desktop/sessions.js"));
  const { createProductSurface } = require(path.join(REPO, "hosts/desktop/product_surface.js"));
  const store = createSessionStore(tmpRoot, { dataRoot });
  const surface = createProductSurface(tmpRoot, { dataRoot });
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const r = store.create("KP07 会话 " + i);
    const sid = r && r.session && r.session.id;
    if (!sid) continue;
    ids.push(sid);
    store.appendMessages(sid, [{ role: "user", text: "第一条 " + i }, { role: "assistant", text: "回复 " + i }]);
  }
  const botIds = [];
  for (let i = 0; i < 4; i++) {
    const r = surface.createBot({ name: "KP07 Bot " + i, job: "probe", description: "diff 门" });
    if (r && r.ok && r.bot && r.bot.id) botIds.push(r.bot.id);
  }
  // 一个进隐藏区，让桶这条路径也在真形状上跑到（真 API = surface.hideBot）
  let hidOk = false;
  if (botIds.length >= 2) {
    try {
      const h = surface.hideBot(botIds[1]);
      hidOk = !!(h && h.ok !== false);
    } catch (_) {
      hidOk = false;
    }
  }
  real = { store, surface, ids, botIds, hidOk };
} catch (e) {
  bad("BD-19 真 store 起不来", String(e && e.message ? e.message : e));
}

if (real) {
  const sFull0 = real.store.list();
  line("BD-19",
    T.indexRows("sessions", sFull0) !== null && sFull0.sessions.length >= 3,
    "真 sessions.list() 的形状本模块认（字段名漂了这里当场红）",
    "rows=" + sFull0.sessions.length);
  const bFull0 = real.surface.listViews();
  line("BD-20",
    T.indexRows("bots", bFull0) !== null && bFull0.bots.length >= 2 &&
    (!real.hidOk || (bFull0.hidden_bots || []).length >= 1),
    "真 surface.listViews() 的形状本模块认（含隐藏桶）",
    "bots=" + bFull0.bots.length + " hidden=" + (bFull0.hidden_bots || []).length + " hideBot=" + real.hidOk);

  // 真回合的形态：往一个会话追加一条长回复 → preview/count/updated_at 变，别的行不动
  const target = real.ids[0];
  real.store.appendMessages(target, [{ role: "assistant", text: "这是一条很长的流式回复，侧栏的预览要跟着换掉" }]);
  const sFull1 = real.store.list();
  const r = T.diffSurface("sessions", sFull0, sFull1, { rev: 1 });
  line("BD-21",
    r.mode === "diff" && r.payload.changed.length === 1 && r.payload.changed[0].entity_id === target,
    "真 store 上「一轮回复」= 只点名那一行", "changed=" + JSON.stringify(r.payload.changed.map((c) => c.entity_id)));
  const fullBytes = JSON.stringify(sFull1).length;
  const diffBytes = JSON.stringify(r.payload).length;
  line("BD-22", diffBytes * 3 < fullBytes,
    "真 store 上 diff 至少比整份小 3 倍（否则这刀白做）",
    "full=" + fullBytes + "B diff=" + diffBytes + "B 比例=" + (fullBytes / diffBytes).toFixed(1) + "×");

  real.surface.touchBotActivity(real.botIds[0]);
  const bFull1 = real.surface.listViews();
  const rb = T.diffSurface("bots", bFull0, bFull1, { rev: 2 });
  const touchedBots = (rb.payload && rb.payload.changed ? rb.payload.changed.length : 0);
  line("BD-23",
    (rb.mode === "diff" && touchedBots === 1 && rb.payload.changed[0].entity_id === real.botIds[0]) ||
    rb.mode === "full",
    "真 store 上「一轮 Bot 活动」= 点名那个 Bot（或老实整份）",
    "mode=" + rb.mode + " touched=" + touchedBots);
  if (rb.mode === "diff") {
    const fb = JSON.stringify(bFull1).length;
    const db = JSON.stringify(rb.payload).length;
    line("BD-24", db < fb,
      "Bot 面 diff 也比整份小（整份里每个 Bot 都带 avatar_data_url）",
      "full=" + fb + "B diff=" + db + "B");
  } else {
    ok("BD-24 Bot 面本轮走整份 → 字节对比不适用（顺序/桶变了），已如实记在 BD-23", "mode=full");
  }

  // 真 API 走一次「取消隐藏」：桶变了、字段没变 —— 这条只有真 store 才证得了
  if (real.hidOk) {
    const before = real.surface.listViews();
    real.surface.unhideBot(real.botIds[1]);
    const after = real.surface.listViews();
    const rh = T.diffSurface("bots", before, after, { rev: 3 });
    const c = rh.mode === "diff" && (rh.payload.changed || []).find((x) => x.entity_id === real.botIds[1]);
    const keys = c ? Object.keys(c.changed_fields) : [];
    // 真 store 的 unhideBot 会顺手盖 updated_at —— 那是真行为，diff 必须照报；
    // 要断的是「除时间以外一个字段不报」（名字/分组/头像没变就别重画）。
    line("BD-25",
      !!c && c.moved_bucket === true && c.bucket === "visible" && !!rh.payload.order &&
      keys.every((k) => k === "updated_at"),
      "真 store 取消隐藏 → 点名 moved_bucket + 新 order，字段只多真被盖的 updated_at",
      "mode=" + rh.mode + " entry=" + JSON.stringify(c && { b: c.bucket, f: keys }));
  } else {
    ok("BD-25 hideBot 在真 surface 上不可用 → 桶这条路径只在夹具里证（BD-13/14），已如实降级");
  }
}

/* ---------- 反向对照：改坏模块本体，断言必须翻假 ---------- */

function mutate(desc, from, to) {
  if (!SRC.includes(from)) {
    bad(desc + "：没找到要改坏的那一行（改动失效，负控不可信）");
    return null;
  }
  return SRC.replace(from, to);
}

{
  // N1：去掉逐字段比较 —— 每行都当"全字段变了"
  const m = mutate("N1", "      if (prevRow.values[f] !== nextRow.values[f]) {", "      if (true) {");
  if (m) {
    const n1 = loadFrom(m);
    const a = sessionsPayload("s1", [sess("s1", "T", "p", "x", 1)]);
    const b = sessionsPayload("s1", [sess("s1", "T", "p2", "x", 1)]);
    const r = n1.diffSurface("sessions", a, b, { rev: 1 });
    const noop = n1.diffSurface("sessions", a, JSON.parse(JSON.stringify(a)), { rev: 1 });
    const wrongFields = r.mode === "diff" && "title" in (r.payload.changed[0] || {}).changed_fields;
    const noopBroken = noop.mode !== "noop";
    if (wrongFields || noopBroken) ok("N1 负向对照真红：拆掉逐字段比较 → BD-02 的「只报真变字段」和 BD-04 的 noop 都不成立");
    else bad("N1 负向对照没红：字段比较不是必需的（断言可能是假的）");
  }
}
{
  // N2：去掉 churn 守卫
  const m = mutate("N2", "  if (touched > churnLimit) {", "  if (false) {");
  if (m) {
    const n2 = loadFrom(m);
    const rowsA = [];
    const rowsB = [];
    for (let i = 0; i < 8; i++) {
      rowsA.push(sess("s" + i, "T" + i, "p", "x", i));
      rowsB.push(sess("s" + i, "T" + i, "改", "y", i + 1));
    }
    const r = n2.diffSurface("sessions", sessionsPayload("s0", rowsA), sessionsPayload("s0", rowsB), { rev: 1 });
    if (r.mode === "diff") ok("N2 负向对照真红：去掉 churn 守卫 → 全量改动也硬发 diff（BD-10 翻假）");
    else bad("N2 负向对照没红：整份仍成立，守卫可能不是必需的");
  }
}
{
  // N3：把 moved_bucket 探测拆掉（只比字段名，不比桶）
  const m = mutate("N3", "    const movedBucket = prevRow.bucket !== nextRow.bucket;", "    const movedBucket = false;");
  if (m) {
    const n3 = loadFrom(m);
    const a = botsPayload([bot("b1", "N1", "x")], [bot("b2", "N2", "y")], "b1");
    const b = botsPayload([bot("b1", "N1", "x"), bot("b2", "N2", "y")], [], "b1");
    const r = n3.diffSurface("bots", a, b, { rev: 1 });
    const c = r.mode === "diff" && (r.payload.changed || []).find((x) => x.entity_id === "b2");
    if (!c || !c.moved_bucket) ok("N3 负向对照真红：拆掉 moved_bucket → 取消隐藏不再被点名（BD-13 翻假，侧栏会漏一行）");
    else bad("N3 负向对照没红：桶移动仍被识别");
  }
}
{
  // N4：坏形状不再退回整份（形状不认也硬算 diff）
  const m = mutate("N4", "  if (forceFull || !nextIndex || !prevIndex) {", "  if (forceFull) {");
  if (m) {
    const n4 = loadFrom(m);
    const good = sessionsPayload("s1", [sess("s1", "T", "p", "x", 1)]);
    let verdict = "still-full";
    try {
      const r1 = n4.diffSurface("sessions", { ok: false, error: "x" }, good, { rev: 1 });
      const r2 = n4.diffSurface("sessions", good, sessionsPayload("s1", "不是数组"), { rev: 1 });
      verdict = r1.mode === "diff" || r2.mode === "diff" ? "diff-on-bad-shape" : r1.mode + "/" + r2.mode;
    } catch (e) {
      verdict = "throws:" + String(e && e.message ? e.message : e).slice(0, 40);
    }
    // 翻红的两种样子都算证明：硬发 diff（漏字段），或干脆算不出来（崩）——
    // 无论哪种，"坏形状稳落整份"这条保障都不存在了。
    if (verdict !== "still-full") ok("N4 负向对照真红：去掉形状守卫 → 坏快照不再稳落整份（BD-09 翻假）", verdict);
    else bad("N4 负向对照没红：整份兜底仍成立，守卫可能不是必需的", verdict);
  }
}

/* ---------- 覆盖面自证 ---------- */

const rulesRun = RULES.length;
const targetsRun = TARGETS.length;
line("BD-90", targetsRun >= 20, "本轮跑到的判据条数（覆盖面自证）",
  "判据 " + targetsRun + " 条 / 规则 " + rulesRun + " 条");
line("BD-91", new Set(TARGETS).size === TARGETS.length, "判据 id 不重复（条数不是凑出来的）",
  TARGETS.join(","));
line("BD-92", fs.existsSync(MODULE) && SRC.includes("churn_over_limit"),
  "被测的是仓库里这份真模块（含 churn 守卫源行）");

console.log(`自证：规则 ${rulesRun} 条 = ${RULES.join(" | ")}`);
console.log(`判据：${TARGETS.length} 条 = ${TARGETS.join(" ")}`);
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`prove_broadcast_diff: PASS=${PASS} FAIL=${FAIL}`);
process.exit(FAIL === 0 ? 0 : 1);
