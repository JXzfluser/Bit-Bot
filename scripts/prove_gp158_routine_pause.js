#!/usr/bin/env node
"use strict";

/**
 * prove_gp158_routine_pause — 场景验收（自媒体日更）· 群里的定时任务要「管得了」
 *
 * GP-154 把排程搬进了群资料面板，但只做到了「看得见 + 加得了」。用户说
 * 「最近先别发」的时候，面板上没有任何按钮可以按：Host 侧其实早就有
 * routine_pause / routine_resume（内核 `pause routine <id>` 走的就是它），
 * 只是界面接不上。面板标题写着「管理」，实际只能添加，这就是「看起来有了」。
 *
 * 契约（先立红，修完必须全绿）：
 *   1. 面板能对一条任务按「暂停」：行变 enabled=false / lifecycle=paused，
 *      并且留下可审计的 pause 工件。
 *   2. 暂停之后 sweep 不再认领它（不是靠界面隐藏）。
 *   3. 「继续」把行恢复成 active，并且 next_due 重新有效（不能停在 null 上饿死）。
 *   4. 恢复后到期真的会再跑一次 —— 证明恢复的不是一个装饰性开关。
 *   5. 跨群不能管：别的群的任务 → 如实拒绝，且一行都不许被改。
 *   6. 不存在的 id → 如实拒绝，绝不能凭空 upsert 出一条幽灵任务。
 *   7. 已经跑完的一次性任务不能被「继续」复活成循环触发。
 *   8. Host / IPC / 界面三段都真接上了（lifecycle 通道 + 面板按钮 + 三语文案）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp158-"));
const REPO = path.join(__dirname, "..");
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
const draftsFor = (id) => {
  try {
    return fs.readdirSync(DRAFT_DIR).filter((f) => f.startsWith("routine-" + id + "-") && f.endsWith(".json"));
  } catch { return []; }
};
const setRow = (id, patch) => {
  const rows = readRows();
  const hit = rows.find((r) => r && r.id === id);
  if (!hit) return false;
  Object.assign(hit, patch);
  fs.writeFileSync(ROUTES, JSON.stringify(rows, null, 2));
  return true;
};

async function schedule(id, cron, prompt, roomId) {
  const r = await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|" + cron + "|" + prompt }],
    { sessionId: "gp158", roomId: roomId || "room-gp158" },
  );
  setRow(id, { room_id: roomId || "room-gp158" });
  return (r || []).find((x) => x && x.kind === "routine_schedule");
}
async function tick() {
  const r = await ffi.executeHostEffects([{ kind: "routine_tick", command: "wake-due" }], { sessionId: "gp158" });
  const hit = (r || []).find((x) => x && (x.kind === "routine_tick" || x.kind === "routine_wake")) || {};
  let out = {};
  try { out = JSON.parse(hit.stdout || "{}"); } catch { out = {}; }
  return { ok: hit.ok === true, out };
}
function lifecycle(roomId, id, action) {
  if (typeof ffi.routineLifecycle !== "function") {
    return Promise.resolve({ ok: false, error: "api_missing" });
  }
  return Promise.resolve(ffi.routineLifecycle({ roomId, id, action }));
}
// 能力还不存在时，「拒绝类」断言不能靠 api_missing 空过——那会把红测成绿。
const realRefusal = (res) => Boolean(res && res.ok !== true && res.error && res.error !== "api_missing");

(async () => {
  console.log("prove_gp158_routine_pause — 群资料面板里的定时任务能不能真的暂停 / 继续");

  fs.mkdirSync(D("desktop"), { recursive: true });
  fs.writeFileSync(D("desktop/rooms.json"), JSON.stringify({
    rooms: [
      { id: "room-gp158", title: "日更流水线", transcript: [{ kind: "final_report", text: "标题：暂停也要能管", at: new Date().toISOString() }] },
      { id: "room-other", title: "别的小组", transcript: [] },
    ],
  }, null, 2));

  /* ---- 1：暂停 ---- */
  await schedule("gp158-daily", "0 9 * * *", "每天早上9点把审核通过的稿子发到 news@example.com");
  const p1 = await lifecycle("room-gp158", "gp158-daily", "pause");
  const r1 = rowOf("gp158-daily");
  p1 && p1.ok && r1 && r1.enabled === false && r1.lifecycle === "paused"
    ? ok("T1 面板按「暂停」后行真的停了（enabled=false / lifecycle=paused）")
    : bad("T1 暂停没生效或没有这个能力", JSON.stringify({ api: typeof ffi.routineLifecycle, res: p1, row: r1 && { e: r1.enabled, l: r1.lifecycle } }));

  const pauseArt = (() => { try { return fs.readdirSync(D("routines")).filter((f) => /^pause-gp158-daily-.*\.json$/.test(f)); } catch { return []; } })();
  pauseArt.length >= 1 ? ok("T2 留下可审计的暂停工件（" + pauseArt[0] + "）")
    : bad("T2 暂停只在内存里改了个标志，磁盘上没有可回看的一步", JSON.stringify(pauseArt));

  /* 暂停只是停，不是改时间：cron / next_due 必须原样留着，否则「暂停一下」
     会变成「悄悄挪到别的钟点」（旧 upsertRoutine 的 cron 兜底就干过这件事）。 */
  {
    const rp = rowOf("gp158-daily");
    rp && rp.cron === "0 9 * * *" && rp.next_due
      ? ok("T2b 暂停没有偷改排程（cron 仍是 " + rp.cron + "，next_due 仍在）")
      : bad("T2b 暂停改写了排程", JSON.stringify(rp && { cron: rp.cron, next_due: rp.next_due }));
  }

  /* ---- 2：暂停后 sweep 不认领 ---- */
  {
    const rows = readRows();
    const hit = rows.find((r) => r && r.id === "gp158-daily");
    if (hit) { hit.next_due = new Date(Date.now() - 60 * 1000).toISOString(); fs.writeFileSync(ROUTES, JSON.stringify(rows, null, 2)); }
  }
  const beforeP = draftsFor("gp158-daily").length;
  await tick();
  draftsFor("gp158-daily").length === beforeP
    ? ok("T3 暂停期间到期也不触发（sweep 真的不认领它，不是界面藏起来）")
    : bad("T3 暂停了还在触发", JSON.stringify({ before: beforeP, after: draftsFor("gp158-daily").length }));

  /* ---- 3 / 4：继续 ---- */
  const p2 = await lifecycle("room-gp158", "gp158-daily", "resume");
  const r2 = rowOf("gp158-daily");
  p2 && p2.ok && r2 && r2.enabled === true && r2.lifecycle === "active" && r2.next_due && r2.cron === "0 9 * * *"
    ? ok("T4 恢复后行回到 active 且有下次时间（" + String(r2.next_due).slice(0, 16) + "Z）")
    : bad("T4 恢复没有重建可运行的排程", JSON.stringify({ res: p2, row: r2 && { e: r2.enabled, l: r2.lifecycle, n: r2.next_due } }));

  {
    const rows = readRows();
    const hit = rows.find((r) => r && r.id === "gp158-daily");
    if (hit) { hit.next_due = new Date(Date.now() - 60 * 1000).toISOString(); fs.writeFileSync(ROUTES, JSON.stringify(rows, null, 2)); }
  }
  const beforeR = draftsFor("gp158-daily").length;
  await tick();
  p2 && p2.ok && draftsFor("gp158-daily").length === beforeR + 1
    ? ok("T5 恢复后到期真的再跑一次（按钮不是装饰）")
    : bad("T5 恢复之后再也不触发", JSON.stringify({ before: beforeR, after: draftsFor("gp158-daily").length }));

  /* ---- 5：跨群不能管 ---- */
  await schedule("gp158-other", "@daily", "别的小组的定时任务", "room-other");
  const before = rowOf("gp158-other");
  const px = await lifecycle("room-gp158", "gp158-other", "pause");
  const after = rowOf("gp158-other");
  realRefusal(px) && JSON.stringify(after) === JSON.stringify(before)
    ? ok("T6 管不了别的群的任务，如实拒绝（" + px.error + "）且原行一字未动")
    : bad("T6 跨群越权或被静默接受", JSON.stringify({ res: px, changed: JSON.stringify(after) !== JSON.stringify(before) }));

  /* ---- 6：不存在的 id 不能造幽灵行 ---- */
  const ghost = await lifecycle("room-gp158", "gp158-ghost", "pause");
  rowOf("gp158-ghost") === null && realRefusal(ghost)
    ? ok("T7 不存在的任务如实拒绝（" + (ghost && ghost.error) + "），没有 upsert 出幽灵行")
    : bad("T7 暂停一个不存在的 id 竟然凭空建了一条", JSON.stringify({ res: ghost, row: rowOf("gp158-ghost") }));

  /* ---- 7：跑完的一次性任务不能被复活 ---- */
  await schedule("gp158-once", "@now", "现在发一次就够了");
  await tick();
  const oneBefore = draftsFor("gp158-once").length;
  const opPause = await lifecycle("room-gp158", "gp158-once", "pause");
  const opResume = await lifecycle("room-gp158", "gp158-once", "resume");
  await tick();
  const oneAfter = draftsFor("gp158-once").length;
  opPause && opPause.ok && opResume && opResume.ok && oneAfter === oneBefore
    ? ok("T8 已触发的一次性任务暂停再恢复也不会重跑（" + oneAfter + " 份）")
    : bad("T8 恢复把一次性任务复活成了会重跑的任务", JSON.stringify({ oneBefore, oneAfter, opPause, opResume }));

  /* ---- 8：三段接线 ---- */
  const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
  const preload = fs.readFileSync(path.join(REPO, "hosts/desktop/preload.js"), "utf8");
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  const wired = /bitbot:routines:lifecycle/.test(mainJs) && /bitbot:routines:lifecycle/.test(preload);
  wired ? ok("T9 main.js + preload 都暴露了 bitbot:routines:lifecycle")
    : bad("T9 IPC 没接上", JSON.stringify({ main: /bitbot:routines:lifecycle/.test(mainJs), preload: /bitbot:routines:lifecycle/.test(preload) }));
  /riPause/.test(html) && /riResume/.test(html) ? ok("T10 面板有暂停 / 继续的文案与入口")
    : bad("T10 面板按钮文案缺失", JSON.stringify({ riPause: /riPause/.test(html), riResume: /riResume/.test(html) }));

  console.log("prove_gp158_routine_pause: PASS=" + pass + " FAIL=" + fail);
  console.log("范围说明：本探针覆盖 Host 能力 + IPC/界面接线（静态）；真按钮的点击行为由 e2e_desktop_room_orchestration 的真实渲染覆盖。");
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* keep */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("probe crashed: " + ((e && e.stack) || e));
  console.log("prove_gp158_routine_pause: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
