#!/usr/bin/env node
"use strict";

/**
 * prove_gp157_once_not_loop — 场景验收（自媒体日更）· 一次性任务不能被反复触发
 *
 * 现场证据：data/routines/drafts/ 里 `routine-m22-r-*`（cron=@now）攒了 70 份草稿，
 * 而同一批里 `0 9 * * *` 的任务只有 2 份。原因是 GP-153 之后仍留着的两处旧口径：
 *   - routine_fire 重排时用 nextDueFromCron 的结果写回 next_due，而 @now/@once 的
 *     「下一次」就是「现在」，于是写回去的还是一个已过期的时间点；
 *   - routine_tick 的到期判定写着 `if (!r.next_due) return true` —— 「没有下次
 *     时间」被当成「现在就该跑」。
 * 两条叠起来，一次性的定时任务每一次 sweep 都会重新触发一次：用户说「现在发一次」，
 * 实际得到的是每隔一轮发一次，而且每次都会往审批队列挂一条新的邮件批准（GP-156 之后
 * 更明显）。这在真实 Electron 里就是「定时发文刷屏」。
 *
 * 契约（先立红，修完必须全绿）：
 *   1. @now 的任务 sweep 一次就够：跑完停车，再来 sweep 不新增草稿。
 *   2. 停车的行长这样：next_due=null、once_done=true、last_fired_at 有值。
 *   3. @once 与 @now 同义，同样只跑一次。
 *   4. 普通 cron（每天 9 点）到期触发后必须重新排到「下一个 09:00」，不能停车。
 *   5. 重新排上之后紧接着再 sweep，不应该又被认领（next_due 在未来）。
 *   6. 半点任务（星斜三十）照常每半点触发 —— 别把循环任务也一起停掉。
 *   7. 老数据里从没排过次的行（无 next_due、无 last_fired_at）第一次仍要被认领。
 *   8. 群资料面板对「已触发的一次性任务」说「已于 … 触发」，不说「还没排上」。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp157-"));
const ffi = createHostFfi(root);
const D = (...p) => path.join(root, "data", ...p);
const ROUTES = D("routines/host-routines.json");
const DRAFT_DIR = D("routines/drafts");

const readRaw = () => { try { return fs.readFileSync(ROUTES, "utf8"); } catch { return null; } };
const readRows = () => {
  const raw = readRaw();
  if (raw == null) return [];
  try {
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : (j.routines || []);
  } catch { return []; }
};
// 顶层数组还是 {routines:[…]} 由 Host 自己决定，探针不擅自改形状。
const writeRows = (rows) => {
  const raw = readRaw();
  let shaped = rows;
  try { const j = raw == null ? null : JSON.parse(raw); if (j && !Array.isArray(j)) shaped = { ...j, routines: rows }; } catch { /* 新写数组 */ }
  fs.writeFileSync(ROUTES, JSON.stringify(shaped, null, 2));
};
const rowOf = (id) => readRows().find((r) => r && r.id === id) || null;
const draftsFor = (id) => {
  try {
    return fs.readdirSync(DRAFT_DIR).filter((f) => f.startsWith("routine-" + id + "-") && f.endsWith(".json"));
  } catch { return []; }
};

async function schedule(id, cron, prompt) {
  const r = await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|" + cron + "|" + prompt }],
    { sessionId: "gp157" },
  );
  return (r || []).find((x) => x && x.kind === "routine_schedule");
}
/** 群归属是 GP-154 的可选字段：探针里手动补上，等价于在群里建任务那条路径。 */
function assignRoom(id) {
  const rows = readRows();
  const hit = rows.find((r) => r && r.id === id);
  if (hit) hit.room_id = "room-gp157";
  writeRows(rows);
  return Boolean(hit);
}
async function tick() {
  const r = await ffi.executeHostEffects(
    [{ kind: "routine_tick", command: "wake-due" }],
    { sessionId: "gp157" },
  );
  const hit = (r || []).find((x) => x && (x.kind === "routine_tick" || x.kind === "routine_wake")) || {};
  let out = {};
  try { out = JSON.parse(hit.stdout || "{}"); } catch { out = {}; }
  return { ok: hit.ok === true, out };
}

(async () => {
  console.log("prove_gp157_once_not_loop — 一次性定时任务会不会每轮 sweep 都重跑");

  /* 群归属只影响第 8 项（面板），先把房间和回执摆好 */
  fs.mkdirSync(D("desktop"), { recursive: true });
  fs.writeFileSync(D("desktop/rooms.json"), JSON.stringify({
    rooms: [{ id: "room-gp157", title: "日更流水线", transcript: [
      { kind: "final_report", text: "标题：一次性任务不该刷屏\n审核结论：通过。", at: new Date().toISOString() },
    ] }],
  }, null, 2));

  /* ---- 1 / 2：@now 跑一次就停车 ---- */
  const s1 = await schedule("gp157-now", "@now", "现在把审核通过的稿子发到 once@example.com");
  s1 && s1.ok ? ok("T0 @now 任务建成（next_due 落在现在）")
    : bad("T0 @now 任务没建成", s1 && (s1.error || s1.stderr));
  assignRoom("gp157-now");

  const t1 = await tick();
  const d1 = draftsFor("gp157-now").length;
  t1.ok && d1 === 1 ? ok("T1 第一次 sweep 触发它（草稿 " + d1 + " 份）")
    : bad("T1 第一次 sweep 没触发 @now 任务", JSON.stringify({ ok: t1.ok, due: t1.out.due_count, fired: t1.out.fired_count, d1 }));

  await tick();
  await tick();
  const d2 = draftsFor("gp157-now").length;
  d2 === d1 ? ok("T2 连着再 sweep 两次仍然只有 " + d2 + " 份草稿（一次就是一次，不会刷屏）")
    : bad("T2 一次性任务被反复触发 —— 用户说「发一次」，实际每轮都发", JSON.stringify({ d1, d2 }));

  const rNow = rowOf("gp157-now");
  rNow && rNow.next_due === null && rNow.once_done === true && rNow.last_fired_at
    ? ok("T3 停车状态如实写进行里（next_due=null / once_done=true / last_fired_at 有值）")
    : bad("T3 一次性任务没有停车", JSON.stringify(rNow && { next_due: rNow.next_due, once_done: rNow.once_done, last_fired_at: rNow.last_fired_at }));

  /* ---- 3：@once 同义 ---- */
  await schedule("gp157-once", "@once", "跑一次就把结果发给我");
  await tick();
  const o1 = draftsFor("gp157-once").length;
  await tick();
  const o2 = draftsFor("gp157-once").length;
  o1 === 1 && o2 === 1 ? ok("T4 @once 同样只触发一次（" + o2 + " 份）")
    : bad("T4 @once 被反复触发", JSON.stringify({ o1, o2 }));

  /* ---- 4 / 5：普通 cron 到期后要重新排上下一个 09:00 ---- */
  const s4 = await schedule("gp157-daily", "0 9 * * *", "每天早上9点把审核通过的稿子发到 news@example.com");
  const r4 = rowOf("gp157-daily");
  s4 && s4.ok && r4 && r4.next_due ? ok("T5a 每天 9 点的任务建成并排上了（next_due=" + r4.next_due + "）")
    : bad("T5a 每天 9 点的任务没建成", JSON.stringify({ ok: s4 && s4.ok, row: r4 && r4.next_due }));
  assignRoom("gp157-daily");

  // 把 next_due 拨到过去，模拟「现在真的到点了」—— 否则它永远不被认领，测不到重排。
  {
    const rows = readRows();
    const hit = rows.find((r) => r && r.id === "gp157-daily");
    if (hit) { hit.next_due = new Date(Date.now() - 3600 * 1000).toISOString(); writeRows(rows); }
  }
  const t5 = await tick();
  const a1 = draftsFor("gp157-daily").length;
  const r5 = rowOf("gp157-daily");
  const list5 = ffi.listRoomRoutines("room-gp157");
  const dailyLabel = ((list5.routines || []).find((x) => x.id === "gp157-daily") || {}).next_due_label || "";
  t5.ok && a1 === 1 && r5 && r5.next_due && Date.parse(r5.next_due) > Date.now() && /09:00/.test(dailyLabel)
    ? ok("T5b 到期触发后重新排到下一个 09:00（" + dailyLabel + "），没有停车")
    : bad("T5b 循环任务触发后没排上下一次", JSON.stringify({ fired: t5.out.fired_count, a1, next: r5 && r5.next_due, label: dailyLabel }));

  const a2 = draftsFor("gp157-daily").length;
  await tick();
  const a3 = draftsFor("gp157-daily").length;
  a3 === a2 ? ok("T6 排好下次的循环任务不会被紧接着的 sweep 重复认领")
    : bad("T6 循环任务被重复认领", JSON.stringify({ a2, a3 }));

  /* ---- 6：半点任务照常 ---- */
  await schedule("gp157-half", "*/30 * * * *", "每半小时汇总一次热点");
  {
    const rows = readRows();
    const hit = rows.find((r) => r && r.id === "gp157-half");
    if (hit) { hit.next_due = new Date(Date.now() - 60 * 1000).toISOString(); writeRows(rows); }
  }
  await tick();
  const h1 = draftsFor("gp157-half").length;
  const rH = rowOf("gp157-half");
  h1 === 1 && rH && rH.next_due && !rH.once_done
    ? ok("T7 星斜三十的任务照常触发并排下一次（不能被一并停掉）")
    : bad("T7 循环任务被误停车", JSON.stringify({ h1, next: rH && rH.next_due, once_done: rH && rH.once_done }));

  /* ---- 7：老行（从没排过次）第一次仍要被认领 ---- */
  {
    const rows = readRows();
    rows.push({ id: "gp157-legacy", cron: "@daily", prompt: "旧版本建的任务，没有 next_due", enabled: true });
    writeRows(rows);
  }
  await tick();
  const l1 = draftsFor("gp157-legacy").length;
  l1 === 1 ? ok("T8 没有 next_due 也从没触发过的旧行第一次仍被认领（不饿死历史数据）")
    : bad("T8 旧行被饿死了", JSON.stringify({ l1 }));

  /* ---- 8：面板说人话 ---- */
  const parked = ((ffi.listRoomRoutines("room-gp157").routines) || []).find((x) => x.id === "gp157-now") || {};
  const html = fs.readFileSync(path.join(__dirname, "..", "hosts/desktop/index.html"), "utf8");
  parked.once_done === true && parked.last_fired_label
    ? ok("T9a 面板读得到「已触发的一次性任务」（once_done=true，last_fired_label=" + parked.last_fired_label + "）")
    : bad("T9a listRoomRoutines 没把停车事实报给界面", JSON.stringify(parked));
  /riDoneAt/.test(html) && /已于/.test(html)
    ? ok("T9b 界面文案有「已于 … 触发」分支，不再把停车行说成「还没排上」")
    : bad("T9b 界面缺「已于 … 触发」文案", JSON.stringify({ riDoneAt: /riDoneAt/.test(html) }));

  console.log("prove_gp157_once_not_loop: PASS=" + pass + " FAIL=" + fail);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* keep */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("probe crashed: " + ((e && e.stack) || e));
  console.log("prove_gp157_once_not_loop: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
