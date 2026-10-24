#!/usr/bin/env node
"use strict";

/**
 * prove_gp163_room_attribution — 场景验收（自媒体日更）· 群里说出来的排程要归这个群管
 *
 * 现场推演（真实用户旅程，接着 GP-161/162 往下走）：
 *   群资料面板的「＋添加定时任务」走 routines:op，那条路径会把 roomId 交给内核
 *   （P4 已验证：行带 room_id，面板列得到、暂停删除都够得着）。
 *   但用户更自然的动作是直接在群里发一句话：「@编辑 每天晚上10点把当天的热点汇总
 *   发到 news@example.com」。这句话走的是 rooms:orchestrate → runRoomResponderTurn
 *   → runTurn，而那里的 opts 只有 roomContext，没有 roomId —— 内核照样产出
 *   routine_schedule，Host 照样落盘，可 room_id 是空的。
 *   结果是一条会按时触发、会挂待批准邮件的活任务，在任何群的面板里都不存在：
 *   listRoomRoutines 按 room_id 过滤，lifecycle 又要求 roomId，暂停和删除都够不着。
 *   用户只看得到邮件在发，却找不到是谁排的——这正是「定时任务在群内部」没做完的那半。
 *
 *   顺带把归属的边界钉住：任务 id 由原话推导，所以另一个群说同一句话会命中同一行。
 *   现在的写法是「谁后写谁拥有」，第二个群不声不响就把别群的任务抢走了，前一个群
 *   的用户只会看到它凭空消失（而且没有任何删除记录）。
 *
 * 契约（先立红，修完必须全绿）：
 *   1. 群回合必须把本群 id 交给效果执行（runRoomResponderTurn → runTurn opts.roomId）。
 *   2. 已有归属的行，别的群不能静默抢走：如实拒绝 room_taken + 落 refuse 工件，
 *      原行的 room_id / cron / 原话 / next_due 一个字节都不许变。
 *   3. 同一个群重排同一句话照常允许（这是改时间，不是抢归属）。
 *   4. 还没有归属的行（DM / CLI / daemon 建的），群里说一句话就认领到本群，
 *      让它从此管得了 —— 认领不是抢，因为原来没有主人。
 *   5. 行形状不新增字段（id/enabled/lifecycle/updated_at/cron/prompt/next_due/room_id）。
 *   6. 拒绝走的是既有 refuse 快照口径（stored:false），不是把行藏起来、也不是假装成功。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp163-"));
const REPO = path.join(__dirname, "..");
const ffi = createHostFfi(root);
const D = (...p) => path.join(root, "data", ...p);
const ROUTES = D("routines/host-routines.json");

const readRows = () => {
  try { const j = JSON.parse(fs.readFileSync(ROUTES, "utf8")); return Array.isArray(j) ? j : (j.routines || []); } catch { return []; }
};
const rowOf = (id) => readRows().find((r) => r && r.id === id) || null;
const refuseArts = () => {
  try { return fs.readdirSync(D("routines")).filter((f) => /^refuse-.*\.json$/.test(f)); } catch { return []; }
};
const listIn = (roomId) => ((ffi.listRoomRoutines(roomId).routines) || []).map((r) => r.id);

async function schedule(id, cron, prompt, roomId) {
  const res = await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|" + cron + "|" + prompt }],
    { sessionId: "gp163", roomId: roomId || "" },
  );
  return (res || []).find((x) => x && x.kind === "routine_schedule") || {};
}

(async () => {
  console.log("prove_gp163_room_attribution — 群里说一句话排的程，到底归谁管");

  const SENTENCE = "每天晚上10点把当天的热点汇总发到 news@example.com";

  /* T0 现状：群回合这条路径到底有没有把 room 交给效果执行（静态接线） */
  const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
  const responderBlock = (mainJs.match(/async function runRoomResponderTurn[\s\S]{0,2200}?\n    \}/) || [""])[0];
  const threadsRoom = /\n\s*roomId\s*:/.test(responderBlock);
  threadsRoom
    ? ok("T0 群回合把本群 id 交给了效果执行（runTurn opts.roomId 在位）")
    : bad("T0 群回合没把 room 交下去：群里说出来的排程落得了盘，却不属于任何群", JSON.stringify({
        responderBlockLen: responderBlock.length,
        hasRoomContext: /roomContext:/.test(responderBlock),
        hasRoomId: threadsRoom,
      }));

  /* T1 面板路径（带 roomId）本来就是对的 —— 修完不能把它改坏 */
  const a = await schedule("gp163-eve", "0 22 * * *", SENTENCE, "room-a");
  rowOf("gp163-eve") && rowOf("gp163-eve").room_id === "room-a" && listIn("room-a").includes("gp163-eve")
    ? ok("T1 带归属的排程照常落盘，本群面板列得到")
    : bad("T1 带 roomId 的排程没被本群认领", JSON.stringify({ res: { ok: a.ok }, row: rowOf("gp163-eve") }).slice(0, 300));

  /* T2 别的群说同一句话：不能静默抢走 */
  const before = rowOf("gp163-eve");
  const beforeKeys = JSON.stringify(before);
  const artsBefore = refuseArts().length;
  const b = await schedule("gp163-eve", "0 22 * * *", SENTENCE, "room-b");
  const after = rowOf("gp163-eve");
  b && b.ok !== true && String(b.error || "") === "room_taken" &&
    after && JSON.stringify(after) === beforeKeys && !listIn("room-b").includes("gp163-eve")
    ? ok("T2 别群不能静默抢走这条任务：如实 room_taken，原行一个字节没变，B 群面板也列不到")
    : bad("T2 同一句话在别的群被接受 / 或把归属改写了（前一个群的任务会凭空消失）", JSON.stringify({
        res: { ok: b && b.ok, error: b && b.error }, still: JSON.stringify(after) === beforeKeys,
        roomB: listIn("room-b"), row: after && after.room_id,
      }).slice(0, 320));

  const artsAfter = refuseArts();
  const taken = artsAfter.filter((f) => {
    try { const j = JSON.parse(fs.readFileSync(D("routines", f), "utf8")); return j.error === "room_taken"; } catch { return false; }
  });
  let takenArt = {};
  try { takenArt = JSON.parse(fs.readFileSync(D("routines", taken[0]), "utf8")); } catch { takenArt = {}; }
  artsAfter.length === artsBefore + 1 && taken.length === 1 && takenArt.stored === false &&
    takenArt.room_id === "room-b" && takenArt.owner_room_id === "room-a"
    ? ok("T3 拒绝留了可核对的小票（stored:false，写着来的是哪个群、现在属于哪个群）")
    : bad("T3 抢归属被拒但没有诚实的小票", JSON.stringify({
        added: artsAfter.length - artsBefore, taken, art: { stored: takenArt.stored, room: takenArt.room_id, owner: takenArt.owner_room_id },
      }).slice(0, 300));

  /* T4 同一个群重排同一句话照常允许（改时间不是抢归属） */
  const c = await schedule("gp163-eve", "0 21 * * *", SENTENCE, "room-a");
  const after4 = rowOf("gp163-eve");
  c && c.ok === true && after4 && after4.cron === "0 21 * * *" && after4.room_id === "room-a"
    ? ok("T4 本群重排同一句话仍然生效（cron 改成 21:00，归属不变）")
    : bad("T4 本群改自己的任务被误伤", JSON.stringify({ ok: c && c.ok, error: c && c.error, row: after4 && { c: after4.cron, r: after4.room_id } }).slice(0, 300));

  /* T5 没有归属的旧行：群里说一句话就认领过来，从此管得了 */
  await schedule("gp163-orphan", "@daily", "每天凌晨汇总一次", "");
  const orphanBefore = rowOf("gp163-orphan");
  const adopted = await schedule("gp163-orphan", "0 8 * * *", "每天凌晨汇总一次", "room-c");
  const orphanAfter = rowOf("gp163-orphan");
  orphanBefore && !orphanBefore.room_id && adopted && adopted.ok === true &&
    orphanAfter && orphanAfter.room_id === "room-c" && listIn("room-c").includes("gp163-orphan")
    ? ok("T5 无归属的历史行被本群认领（认领不是抢：原来没有主人），面板从此列得到")
    : bad("T5 无归属的行认领不了，群里的面板还是看不见它", JSON.stringify({
        before: orphanBefore && orphanBefore.room_id, ok: adopted && adopted.ok, after: orphanAfter && orphanAfter.room_id,
      }).slice(0, 300));
  const lc = ffi.routineLifecycle({ roomId: "room-c", id: "gp163-orphan", action: "pause" });
  lc && lc.ok === true
    ? ok("T6 认领之后真的管得了：面板的暂停对这条行生效（修复前这类行谁都碰不到）")
    : bad("T6 认领后仍然暂停不了", JSON.stringify(lc).slice(0, 250));

  /* T7 形状纪律：不往行里塞新字段 */
  const keys = Object.keys(rowOf("gp163-eve") || {}).sort();
  const allowed = ["cron", "enabled", "id", "last_fired_at", "lifecycle", "next_due", "once_done", "prompt", "room_id", "schedule_error", "updated_at"];
  const extra = keys.filter((k) => allowed.indexOf(k) < 0);
  extra.length === 0
    ? ok("T7 行形状没被扩容（本群这条行的键：" + keys.join(", ") + "）")
    : bad("T7 往既有行里加了新字段", JSON.stringify({ keys, extra }));

  /* T8 界面要把 room_taken 说成人话（面板添加路径复用 routines:op 的拒绝上报） */
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  const copyHits = (html.match(/riErrTaken:/g) || []).length;
  /room_taken/.test(html) && copyHits >= 3
    ? ok("T8 面板认得 room_taken 并且三语都有说法（" + copyHits + " 处）")
    : bad("T8 room_taken 到了界面上只会变成一句含糊的「发起失败」", JSON.stringify({
        wired: /room_taken/.test(html), hits: copyHits,
      }));

  console.log("prove_gp163_room_attribution: PASS=" + pass + " FAIL=" + fail);
  console.log("范围说明：本探针覆盖 Host 归属判定 + 接线（静态）；群里发一句话真的建成本群任务由 e2e_desktop_creator_pipeline P12 真实渲染覆盖。");
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* keep */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("probe crashed: " + ((e && e.stack) || e));
  console.log("prove_gp163_room_attribution: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
