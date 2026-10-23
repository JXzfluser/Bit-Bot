#!/usr/bin/env node
"use strict";

/**
 * prove_gp161_routine_remove — 场景验收（自媒体日更）· 建错的定时任务要能真的删掉
 *
 * GP-158 把「暂停 / 继续」接上了，但面板仍然只有加、停，没有删。真实用户第一
 * 反应不是「暂停」：收件人邮箱写错、换选题不再需要这条日更、手滑建了两条一样
 * 的——他要的是把这条清除出去。现在的界面对此无路可走（内核也根本没有
 * RemoveRoutine 意图），面板会越堆越长，用户只能对着永远停不掉的一列表格。
 *
 * 删除是不可逆动作，所以这个探针把「不可逆」这件事拆成必须同时成立的约束：
 *   1. 行从 store 消失，listRoomRoutines 不再返回它；
 *   2. 删除本身留下一份可回看的工件，里面是被删掉的整行（cron/prompt/room_id）——
 *      用户可以照着重建，删除不等于把用户说过的话销毁；
 *   3. 这条任务的历史草稿 / 触发记录一个文件都不许动（§0：不清用户数据）；
 *   4. 删完再 sweep，不能复活，也不能凭空多出新草稿；
 *   5. 跨群不能删（room_mismatch），不存在的不能删（not_found），且都不落工件；
 *   6. 暂停过的行也要能删干净（不能只能暂停不能清除）；
 *   7. IPC 仍走既有 bitbot:routines:lifecycle，只是多接受一个 action 值；
 *      内核 effect 表不新增 kind（内核没有 RemoveRoutine，先不造没人发的契约）；
 *   8. 界面必须两次点击才删：第一下只武装（「确认删除」），第二下才动手——
 *      单点即删在桌面端迟早毁掉一条日更。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp161-"));
const REPO = path.join(__dirname, "..");
const ffi = createHostFfi(root);
const D = (...p) => path.join(root, "data", ...p);
const ROUTES = D("routines/host-routines.json");
const DRAFT_DIR = D("routines/drafts");
const FIRES = D("routines/fires.jsonl");

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
const removeArts = () => {
  try {
    return fs.readdirSync(D("routines")).filter((f) => /^remove-.*\.json$/.test(f));
  } catch { return []; }
};
const fireLinesFor = (id) => {
  try {
    return fs.readFileSync(FIRES, "utf8").split("\n").filter((l) => l.includes('"' + id + '"')).length;
  } catch { return 0; }
};

async function schedule(id, cron, prompt, roomId) {
  await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|" + cron + "|" + prompt }],
    { sessionId: "gp161", roomId: roomId || "room-gp161" },
  );
  const rows = readRows();
  const hit = rows.find((r) => r && r.id === id);
  if (hit) { hit.room_id = roomId || "room-gp161"; fs.writeFileSync(ROUTES, JSON.stringify(rows, null, 2)); }
}
async function tick() {
  const r = await ffi.executeHostEffects([{ kind: "routine_tick", command: "wake-due" }], { sessionId: "gp161" });
  const hit = (r || []).find((x) => x && (x.kind === "routine_tick" || x.kind === "routine_wake")) || {};
  let out = {};
  try { out = JSON.parse(hit.stdout || "{}"); } catch { out = {}; }
  return { ok: hit.ok === true, out };
}
function remove(roomId, id) {
  if (typeof ffi.routineLifecycle !== "function") return Promise.resolve({ ok: false, error: "api_missing" });
  return Promise.resolve(ffi.routineLifecycle({ roomId, id, action: "remove" }));
}
function pause(roomId, id) {
  return Promise.resolve(typeof ffi.routineLifecycle === "function"
    ? ffi.routineLifecycle({ roomId, id, action: "pause" }) : { ok: false, error: "api_missing" });
}

(async () => {
  console.log("prove_gp161_routine_remove — 建错的定时任务能不能真的删掉，且删得不销毁历史");

  fs.mkdirSync(D("desktop"), { recursive: true });
  fs.writeFileSync(D("desktop/rooms.json"), JSON.stringify({
    rooms: [
      { id: "room-gp161", title: "日更流水线", transcript: [{ kind: "final_report", text: "标题：删除也要讲规矩", at: new Date().toISOString() }] }],
  }, null, 2));

  /* 先让它跑过几轮，攒出历史工件，再来删 */
  await schedule("gp161-daily", "0 9 * * *", "每天早上9点把审核通过的稿子发到 news@example.com");
  {
    const rows = readRows();
    const hit = rows.find((r) => r && r.id === "gp161-daily");
    if (hit) { hit.next_due = new Date(Date.now() - 60000).toISOString(); fs.writeFileSync(ROUTES, JSON.stringify(rows, null, 2)); }
  }
  await tick();
  const draftsBefore = draftsFor("gp161-daily").length;
  const firesBefore = fireLinesFor("gp161-daily");
  draftsBefore === 1 && firesBefore >= 1
    ? ok("T0 这条任务已经跑过一轮（历史草稿 " + draftsBefore + " 份 / 触发记录 " + firesBefore + " 行）")
    : bad("T0 前置历史没攒出来，测不到「删了但不销毁历史」", JSON.stringify({ draftsBefore, firesBefore }));

  const artsBefore = removeArts().length;
  const res = await remove("room-gp161", "gp161-daily");
  res && res.ok && rowOf("gp161-daily") === null
    ? ok("T1 删除后这条行真的从 store 消失")
    : bad("T1 删除没生效或没有这个能力", JSON.stringify({ api: typeof ffi.routineLifecycle, res, row: rowOf("gp161-daily") }));

  const artsAfter = removeArts();
  const mine = artsAfter.filter((f) => f.startsWith("remove-gp161-daily-"));
  let art = {};
  try { art = JSON.parse(fs.readFileSync(path.join(D("routines"), mine[0]), "utf8")); } catch { art = {}; }
  artsAfter.length === artsBefore + 1 && mine.length === 1 &&
    art.cron === "0 9 * * *" && /news@example\.com/.test(String(art.prompt || "")) && art.room_id === "room-gp161"
    ? ok("T2 删除留了一份可回看的工件，里面是被删掉的整行（cron / 原话 / 归属群都在，能照着重建）")
    : bad("T2 删除没有留下可恢复的证据", JSON.stringify({ added: artsAfter.length - artsBefore, art }).slice(0, 300));

  const draftsAfter = draftsFor("gp161-daily").length;
  const firesAfter = fireLinesFor("gp161-daily");
  draftsAfter === draftsBefore && firesAfter === firesBefore
    ? ok("T3 这条任务的历史草稿 " + draftsAfter + " 份、触发记录 " + firesAfter + " 行一个没动（删任务不等于毁档案）")
    : bad("T3 删除顺手清了历史数据", JSON.stringify({ drafts: [draftsBefore, draftsAfter], fires: [firesBefore, firesAfter] }));

  const listed = (ffi.listRoomRoutines("room-gp161").routines || []).find((r) => r.id === "gp161-daily");
  !listed ? ok("T4 面板再也读不到这条（不是隐藏，是真没了）")
    : bad("T4 listRoomRoutines 还在返回已删除的行", JSON.stringify(listed).slice(0, 200));

  const dAfterSweep = draftsFor("gp161-daily").length;
  await tick();
  await tick();
  draftsFor("gp161-daily").length === dAfterSweep && rowOf("gp161-daily") === null
    ? ok("T5 删完再 sweep 两轮：不复活、不再冒新草稿")
    : bad("T5 删掉的行又被扫出来跑了", JSON.stringify({ row: rowOf("gp161-daily"), drafts: draftsFor("gp161-daily").length }));

  /* 暂停过的行也要能删干净 */
  await schedule("gp161-paused", "@hourly", "每小时汇总一次热点");
  const pr = await pause("room-gp161", "gp161-paused");
  const rm = await remove("room-gp161", "gp161-paused");
  pr && pr.ok && rm && rm.ok && rowOf("gp161-paused") === null
    ? ok("T6 暂停过的任务能直接删除（不用先把暂停撤回来）")
    : bad("T6 暂停态的行删不掉", JSON.stringify({ pr: pr && pr.ok, rm, row: rowOf("gp161-paused") }));

  /* 跨群 / 不存在：都拒绝，且不落删除工件 */
  await schedule("gp161-other", "@daily", "别的小组的定时任务", "room-other");
  const artsMid = removeArts().length;
  const cross = await remove("room-gp161", "gp161-other");
  const ghost = await remove("room-gp161", "gp161-ghost");
  cross && cross.ok !== true && cross.error === "room_mismatch" && rowOf("gp161-other") !== null
    ? ok("T7 删不了别的群的任务（room_mismatch），原行还在")
    : bad("T7 跨群删除越权或被静默接受", JSON.stringify({ cross, row: rowOf("gp161-other") !== null }));
  ghost && ghost.ok !== true && ghost.error === "not_found" && removeArts().length === artsMid
    ? ok("T8 删不存在的任务如实拒绝（not_found），而且不凭空落工件")
    : bad("T8 不存在的 id 删除行为不符", JSON.stringify({ ghost, arts: removeArts().length - artsMid }));

  /* 接线 + 契约边界 */
  const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
  const hostSrc = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  const kernelSrc = fs.readFileSync(path.join(REPO, "cmd/desktop_turn/turn_json.mbt"), "utf8");
  const intentsSrc = fs.readFileSync(path.join(REPO, "cmd/desktop_turn/parity_intents.mbt"), "utf8");
  const kernelKinds = hostSrc.match(/kind === "routine_[a-z_]+"/g) || [];
  const kindNames = [...new Set(kernelKinds.map((s) => s.replace(/.*"(routine_[a-z_]+)"/, "$1")))].sort();
  /bitbot:routines:lifecycle/.test(mainJs)
    ? ok("T9 IPC 仍复用既有 bitbot:routines:lifecycle（没有为删除另开通道）")
    : bad("T9 IPC 通道不在");
  const noNewKernelKind =
    !kernelKinds.some((s) => /remove|delete/.test(s)) &&
    !/routine_remove:/.test(hostSrc) &&
    !/host_routine_remove/.test(kernelSrc) &&
    !/host_routine_remove/.test(intentsSrc);
  noNewKernelKind
    ? ok("T10 可派发 kind 集合没被扩容（Host 侧 routine_* 仍只有 " + kindNames.join(", ") +
        "；内核 turn_json / parity_intents 里也没有 host_routine_remove）——删除只是 Host 本地的一次改库")
    : bad("T10 往内核契约面加了当前没人发的 kind", JSON.stringify({
        kinds: kernelKinds,
        hit: /host_routine_remove/.test(kernelSrc) || /host_routine_remove/.test(intentsSrc),
      }));
  /riRemove/.test(html) && /riRemoveConfirm/.test(html)
    ? ok("T11 面板有「删除」和「确认删除」两段文案（两下才删）")
    : bad("T11 面板删除文案缺失", JSON.stringify({ riRemove: /riRemove/.test(html), riRemoveConfirm: /riRemoveConfirm/.test(html) }));
  /riRemoved\b/.test(html) && html.includes("riRemoveHint")
    ? ok("T12 删除结果有回执文案与说明（title 里写清历史草稿不跟着销毁）")
    : bad("T12 删除后界面没有说法", JSON.stringify({ riRemoved: /riRemoved\b/.test(html), hint: html.includes("riRemoveHint") }));

  console.log("prove_gp161_routine_remove: PASS=" + pass + " FAIL=" + fail);
  console.log("范围说明：本探针覆盖 Host + IPC/界面接线（静态）；两下才删的真点击由 e2e_desktop_creator_pipeline P10 覆盖。");
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* keep */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("probe crashed: " + ((e && e.stack) || e));
  console.log("prove_gp161_routine_remove: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
