#!/usr/bin/env node
"use strict";

/**
 * prove_m52_archive_bottom — M52 两项真机缺口
 *
 * 一、「回到底部」（Grok 真机：滚离底部后输入卡上沿浮起一枚圆形 ↓）
 *     契约不是「有个按钮」，而是：
 *       1. 默认藏着（短对话不该永远挂一颗没用的钮）；
 *       2. 判据是「离底距离 > 240px」，不是 scrollTop === 0 —— 后者在短对话里
 *          永远成立，钮就常亮了；
 *       3. 三个触发点都接：用户滚动、新消息追加（可能不伴随 scroll 事件）、
 *          窗口改尺寸；
 *       4. 点下去是真的平滑滚到底（scrollTo behavior:smooth），不是只改了变量。
 *
 * 二、「定时任务归档」（真机：Tasks you archive show up here）
 *     归档必须**两件事一起做**：暂停 + 打标记。只打标记会出现最坏的一种错位
 *     ——面板里看不见它了，它却还在后台按 cron 发消息。所以这里的硬断言是
 *     「归档之后到期真的不触发」，而不是「列表里少了一行」。
 *
 * 每条静态断言都配负向对照：把实现抹掉之后断言必须翻假，否则就是恒真的假绿。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const REPO = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
const FFI_SRC = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");

console.log("prove_m52_archive_bottom — 回到底部 + 定时任务归档");

/* ================= 一、回到底部 ================= */

/* T1 按钮本体：藏在 composer 里、默认 hidden、有 i18n（三语） */
{
  const has =
    HTML.includes('id="to-bottom"') &&
    /id="to-bottom"[^>]*hidden/.test(HTML) &&
    HTML.includes('data-i18n-title="toBottom"') &&
    HTML.includes('data-i18n-aria="toBottom"');
  has
    ? ok("T1 #to-bottom 在 composer 里、默认 hidden、title/aria 都走 i18n")
    : bad("T1 回到底部的按钮本体不成立（缺 id / hidden / i18n 之一）");
}

/* T2 定位：absolute 贴输入卡上沿，不占流 */
{
  const css = HTML.includes("bottom: calc(100% + 10px);") &&
    HTML.includes("#composer .row { position: relative; }") &&
    /#to-bottom\s*\{[^}]*position: absolute;/.test(HTML) &&
    HTML.includes("#to-bottom[hidden] { display: none; }");
  css
    ? ok("T2 它是 absolute 浮在输入卡上沿（不占流，输入卡不会因为它多一行）")
    : bad("T2 定位不成立：要么占了流，要么定位上下文没设");
}

/* T3 判据是「离底距离」，不是 scrollTop */
{
  const logic = /const TO_BOTTOM_GAP = (\d+);/.test(HTML) &&
    HTML.includes("const gap = log.scrollHeight - log.scrollTop - log.clientHeight;") &&
    HTML.includes("btn.hidden = !(gap > TO_BOTTOM_GAP);");
  const gap = (HTML.match(/const TO_BOTTOM_GAP = (\d+);/) || [])[1];
  logic && Number(gap) === 240
    ? ok("T3 判据是离底距离（gap > 240px），短对话不会永远亮着一颗没用的钮")
    : bad("T3 判据不对（可能是 scrollTop === 0，短对话恒亮）", gap);
}

/* T4 三个触发点 + 真的平滑滚到底 */
{
  const wired =
    HTML.includes('log.addEventListener("scroll", syncToBottomBtn, { passive: true });') &&
    HTML.includes('window.addEventListener("resize", syncToBottomBtn);') &&
    HTML.includes("new MutationObserver(syncToBottomBtn).observe(log, { childList: true });") &&
    HTML.includes('log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });');
  wired
    ? ok("T4 滚动 / 追加 / 改尺寸三个触发点都接上了，点一下真滚（smooth）")
    : bad("T4 触发点或缺：漏了追加（MutationObserver）就会出现「新消息来了键不出现」");
}

/* T5 三语各一条 */
{
  const zh = HTML.includes('toBottom: "回到底部"');
  const tw = HTML.includes('toBottom: "回到最底"');
  const en = HTML.includes('toBottom: "Scroll to bottom"');
  zh && tw && en
    ? ok("T5 toBottom 在 zh-CN / zh-TW / en 各一条")
    : bad("T5 三语缺条", JSON.stringify({ zh, tw, en }));
}

/* T6 负向对照 a：抹掉 hidden → T1 的「默认藏」翻假 */
{
  const broken = HTML.replace('id="to-bottom" hidden', 'id="to-bottom"');
  const stillHidden = /id="to-bottom"[^>]*hidden/.test(broken);
  broken !== HTML && !stillHidden
    ? ok("T6 负向对照 a：抹掉 hidden → 「默认藏」断言翻假（非恒真）")
    : bad("T6 负向对照 a 恒真：抹掉 hidden 之后断言还成立", JSON.stringify({ changed: broken !== HTML, stillHidden }));
}

/* T7 负向对照 b：把 MutationObserver 换成空回调 → T4 翻假 */
{
  const broken = HTML.replace(
    "new MutationObserver(syncToBottomBtn).observe(log, { childList: true });",
    "new MutationObserver(() => {}).observe(log, { childList: true });",
  );
  const wired = broken.includes("new MutationObserver(syncToBottomBtn).observe(log, { childList: true });");
  !wired
    ? ok("T7 负向对照 b：断开追加触发 → T4 翻假（非恒真）")
    : bad("T7 负向对照 b 恒真");
}

/* ================= 二、定时任务归档 ================= */

/* T8 面板：归档区容器 + 两处入口 + 计数标题 */
{
  const ui =
    HTML.includes('<div id="ri-routine-archived" hidden></div>') &&
    HTML.includes("function renderRoomRailArchived(") &&
    HTML.includes('archiveRoomRoutine(r.id, "archive"') &&
    HTML.includes('archiveRoomRoutine(r.id, "unarchive"') &&
    HTML.includes('t("riArchivedCount"');
  ui
    ? ok("T8 面板有归档区容器、归档/取消归档两个入口、标题带条数")
    : bad("T8 归档区在界面上没接全");
}

/* T9 常用列表必须把归档行剔出去（否则归档等于没归） */
{
  const split = HTML.includes("const liveRows = rows.filter((r) => !r || r.archived !== true);") &&
    HTML.includes("const archRows = rows.filter((r) => r && r.archived === true);");
  split
    ? ok("T9 常用列表只留未归档行，归档行进折叠区")
    : bad("T9 没做拆分：归档行还混在常用列表里");
}

/* T10 九个归档文案 × 三语 */
{
  const keys = ["riArchive", "riArchiveHint", "riUnarchive", "riUnarchiveHint",
    "riArchiveFailed", "riUnarchiveFailed", "riArchived", "riArchivedCount", "riArchivedAt"];
  const missing = [];
  for (const k of keys) {
    const n = (HTML.match(new RegExp("^\\s*" + k + ": ", "gm")) || []).length;
    if (n !== 3) missing.push(k + "×" + n);
  }
  missing.length === 0
    ? ok("T10 归档相关 9 个键在 zh-CN / zh-TW / en 各一条（9×3）")
    : bad("T10 三语不齐", missing.join(", "));
}

/* T11 Host 侧：lifecycle 白名单扩了 archive / unarchive，且走同一条改库路径 */
{
  const src = FFI_SRC;
  const whitelist =
    src.includes('act !== "archive" && act !== "unarchive"') &&
    src.includes('if (act === "archive" || act === "unarchive") return archiveRoomRoutine(want, rid, act);');
  const pauseFirst = /function archiveRoomRoutine\([\s\S]{0,1200}?executeRoutineEffect\("routine_pause", rid\)/.test(src);
  whitelist && pauseFirst
    ? ok("T11 host_ffi：lifecycle 收 archive/unarchive，且归档先走既有 routine_pause")
    : bad("T11 归档没有复用 pause 路径（会出现「看不见却在跑」）", JSON.stringify({ whitelist, pauseFirst }));
}

/* T12 listRoomRoutines 把归档态报出来（旧读取方按缺省 = 未归档） */
{
  const m = FFI_SRC.includes("archived: Boolean(r.archived_at),") &&
    FFI_SRC.includes("archived_at: r.archived_at || null,");
  m
    ? ok("T12 listRoomRoutines 回传 archived / archived_at（可选新字段）")
    : bad("T12 界面拿不到归档态");
}

/* T13 负向对照 c：抹掉拆分 → T9 翻假 */
{
  const broken = HTML.replace("const archRows = rows.filter((r) => r && r.archived === true);",
    "const archRows = rows.filter(() => false);");
  const split = broken.includes("const archRows = rows.filter((r) => r && r.archived === true);");
  !split
    ? ok("T13 负向对照 c：抹掉归档拆分 → T9 翻假（非恒真）")
    : bad("T13 负向对照 c 恒真");
}

/* ================= 三、真机行为（起真 ffi，走真 store） ================= */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "m52-"));
const ffi = createHostFfi(root);
const D = (...p) => path.join(root, "data", ...p);
const ROUTES = D("routines/host-routines.json");
const DRAFT_DIR = D("routines/drafts");

const readRows = () => {
  try {
    const j = JSON.parse(fs.readFileSync(ROUTES, "utf8"));
    return Array.isArray(j) ? j : (j.routines || []);
  } catch { return []; }
};
const rowOf = (id) => readRows().find((r) => r && r.id === id) || null;
const setRow = (id, patch) => {
  const rows = readRows();
  const hit = rows.find((r) => r && r.id === id);
  if (!hit) return false;
  Object.assign(hit, patch);
  fs.writeFileSync(ROUTES, JSON.stringify(rows, null, 2));
  return true;
};
const draftsFor = (id) => {
  try {
    return fs.readdirSync(DRAFT_DIR).filter((f) => f.startsWith("routine-" + id + "-") && f.endsWith(".json"));
  } catch { return []; }
};
async function schedule(id, cron, prompt, roomId) {
  await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|" + cron + "|" + prompt }],
    { sessionId: "m52", roomId: roomId || "room-m52" },
  );
  setRow(id, { room_id: roomId || "room-m52" });
}
async function tick() {
  const r = await ffi.executeHostEffects([{ kind: "routine_tick", command: "wake-due" }], { sessionId: "m52" });
  return (r || []).find((x) => x && (x.kind === "routine_tick" || x.kind === "routine_wake")) || {};
}
const lifecycle = (roomId, id, action) => Promise.resolve(ffi.routineLifecycle({ roomId, id, action }));

(async () => {
  fs.mkdirSync(D("desktop"), { recursive: true });
  fs.writeFileSync(D("desktop/rooms.json"), JSON.stringify({
    rooms: [
      { id: "room-m52", title: "归档验证", transcript: [] },
      { id: "room-other", title: "别的组", transcript: [] },
    ],
  }, null, 2));

  await schedule("m52-daily", "0 9 * * *", "每天早上9点把稿子发到 news@example.com");
  const beforeArchive = rowOf("m52-daily");
  const beforeArchivedFlag = ((ffi.listRoomRoutines("room-m52").routines || [])[0] || {}).archived;

  /* T14 归档：ok + 真暂停 + 打标记 */
  const a1 = await lifecycle("room-m52", "m52-daily", "archive");
  const r1 = rowOf("m52-daily");
  const l1 = (ffi.listRoomRoutines("room-m52").routines || []).find((r) => r.id === "m52-daily") || {};
  a1 && a1.ok && r1 && r1.enabled === false && r1.archived_at && l1.archived === true
    ? ok("T14 归档 = 暂停 + 打标记（enabled=false、archived=true、archived_at 有值）")
    : bad("T14 归档没做到两件事一起", JSON.stringify({ res: a1, row: r1 && { e: r1.enabled, a: r1.archived_at }, listed: l1.archived }));

  /* T15 归档之前它本来是活的（否则 T14 的 enabled=false 可能是本来就假） */
  beforeArchive && beforeArchive.enabled !== false && beforeArchivedFlag === false
    ? ok("T15 负向对照：归档前这条是 enabled=true / archived=false（T14 不是恒真）")
    : bad("T15 归档前就是停的/已归档的，T14 说明不了问题",
      JSON.stringify({ e: beforeArchive && beforeArchive.enabled, a: beforeArchivedFlag }));

  /* T16 归档之后到期真的不触发 */
  setRow("m52-daily", { next_due: new Date(Date.now() - 60 * 1000).toISOString() });
  const beforeT = draftsFor("m52-daily").length;
  await tick();
  draftsFor("m52-daily").length === beforeT
    ? ok("T16 归档之后到期也不触发（sweep 真不认领，不是界面藏起来）")
    : bad("T16 归档了还在后台跑", JSON.stringify({ before: beforeT, after: draftsFor("m52-daily").length }));

  /* T17 取消归档：标记摘掉，但**不自动恢复排程** */
  const a2 = await lifecycle("room-m52", "m52-daily", "unarchive");
  const r2 = rowOf("m52-daily");
  a2 && a2.ok && r2 && !r2.archived_at && r2.enabled === false && a2.resumed === false
    ? ok("T17 取消归档只摘标记，仍是暂停态（不偷偷把排程开回来）")
    : bad("T17 取消归档的语义跑偏", JSON.stringify({ res: a2, row: r2 && { a: r2.archived_at, e: r2.enabled } }));

  /* T18 取消归档后按「继续」能真的恢复（两步分开但不瘸） */
  const a3 = await lifecycle("room-m52", "m52-daily", "resume");
  const r3 = rowOf("m52-daily");
  a3 && a3.ok && r3 && r3.enabled === true
    ? ok("T18 取消归档之后按「继续」能恢复排程（归档不是单向销毁）")
    : bad("T18 取消归档之后恢复不了", JSON.stringify({ res: a3, row: r3 && r3.enabled }));

  /* T19 跨群归档 → room_mismatch，且原行一字未动 */
  await schedule("m52-other", "@daily", "别的组的任务", "room-other");
  const beforeX = JSON.stringify(rowOf("m52-other"));
  const ax = await lifecycle("room-m52", "m52-other", "archive");
  ax && ax.ok === false && ax.error === "room_mismatch" && JSON.stringify(rowOf("m52-other")) === beforeX
    ? ok("T19 跨群归档如实拒绝（room_mismatch），别的组的行一字未动")
    : bad("T19 跨群越权或被静默接受", JSON.stringify({ res: ax }));

  /* T20 不存在的 id → not_found，不 upsert 幽灵行 */
  const ag = await lifecycle("room-m52", "m52-ghost", "archive");
  ag && ag.ok === false && ag.error === "not_found" && rowOf("m52-ghost") === null
    ? ok("T20 归档一个不存在的 id 如实拒绝（not_found），没有凭空建行")
    : bad("T20 归档不存在的 id 竟然建了一条", JSON.stringify({ res: ag }));

  /* T21 白名单没有因此变松：别的动作仍然不支持 */
  const ab = await lifecycle("room-m52", "m52-daily", "delete_forever");
  ab && ab.ok === false && ab.error === "action_unsupported"
    ? ok("T21 白名单只多了 archive/unarchive，其它动作仍然 action_unsupported")
    : bad("T21 白名单被放宽了", JSON.stringify(ab));

  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}

  console.log("\nprove_m52_archive_bottom: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})();
