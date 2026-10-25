#!/usr/bin/env node
"use strict";

/**
 * prove_m29_roomchat — G-25 群聊入口（官方 spec §2.4 / GP-119 + GP-143/144/146）
 *
 * 静态层：#room-banner 结构、侧栏群组行 → openRoomChat、composer → Host
 *         rooms.orchestrate IPC（roomTurn 单一写入点）、Host responder 接线、
 *         transcript 按条目渲染、退出恢复 placeholder、空群「不造历史」、20 键三语。
 * 行为层：真实 product_surface roomCreate/roomTurn/appendRoomTranscript/
 *         loadRooms —— 建群（成员 2–6 门）、@Name 定向路由、@A @B 多点名、
 *         @everyone、无 @ bot_discretion、用户行带 kind=user、
 *         transcript 真落 rooms.json（渲染层读的就是它）。
 * 负向对照：摘掉群聊发送调用 → 静态断言变红；html 在 finally 恢复。
 */

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m) => { fail++; console.log("  ✗ " + m); };

console.log("M29 §2.4 群聊入口 proof");

/* ---------- 1) 静态层 ---------- */
const htmlPath = path.join(REPO, "hosts/desktop/index.html");
const html = fs.readFileSync(htmlPath, "utf8");

/id="room-banner"/.test(html) && /id="room-banner-title"/.test(html) &&
  /id="room-banner-meta"/.test(html) && /id="room-banner-exit"/.test(html)
  ? ok("#room-banner 结构齐全（标题 / 路由提示 / 退出）")
  : bad("room-banner markup missing");

/openRoomChat\(rm\)/.test(html) && /let composerRoom = null/.test(html) &&
  /function openRoomChat\(rm\)/.test(html) && /function exitRoomChat\(\)/.test(html)
  ? ok("侧栏群组行点击 → openRoomChat（composer 对准群聊，无第二消息面）")
  : bad("room entry wiring missing");

/* GP-143/146: the group composer no longer builds a kernel phrase (that would
   double-write the transcript). It calls the Host orchestration IPC, which runs
   the same real RoomTurn routing and then the responder fan-out. */
/if \(composerRoom\) \{[\s\S]{0,700}await sendRoomTurn\(finalText\)/.test(html) &&
  /window\.bitbot\.rooms\.orchestrate\(\{ room_id: roomId, text \}\)/.test(html) &&
  !/finalText = "room " \+ composerRoom\.id/.test(html)
  ? ok("composer 群聊提交走 Host rooms.orchestrate IPC（roomTurn 单一写入点，不再拼 kernel 短语）")
  : bad("composer room orchestrate path missing");

const mainSrc = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
const preloadSrc = fs.readFileSync(path.join(REPO, "hosts/desktop/preload.js"), "utf8");
/ipcMain\.handle\("bitbot:rooms:orchestrate"/.test(mainSrc) &&
  /surface\.roomTurn\(roomId, text/.test(mainSrc) &&
  /surface\.appendRoomTranscript\(roomId, routed\.transcript_entry\)/.test(mainSrc) &&
  /surface\.orchestrateRoom\(\{/.test(mainSrc) &&
  /deps: \{\s*runResponderTurn: runRoomResponderTurn/.test(mainSrc)
  ? ok("Host IPC 真接线：roomTurn → appendRoomTranscript → orchestrateRoom(runResponderTurn)")
  : bad("Host orchestrate IPC wiring missing");
/function runRoomResponderTurn\(botId, task, ctx\)[\s\S]{0,1600}runner\.runTurn\(String\(task \|\| ""\), \{[\s\S]{0,400}botId: id/.test(mainSrc) &&
  /const sessionId = "room-" \+ String\(\(ctx && ctx\.room\) \|\| "room"\) \+ "-" \+ id/.test(mainSrc)
  ? ok("responder 回合用自己的 botId（记忆/persona/审批作用域）与独立 room sessionId（不污染 DM）")
  : bad("responder turn is not per-Bot or shares the DM session");

/* GP-143 安全合同：编排不得成为自动放行通道（审批门与 DM 完全同源）。 */
const roomFnStart = mainSrc.indexOf("async function runRoomResponderTurn");
const roomFn = roomFnStart < 0 ? "" : mainSrc.slice(roomFnStart, mainSrc.indexOf("\n}", roomFnStart) + 2);
/approved: false/.test(roomFn) && !/approved: true/.test(roomFn)
  ? ok("responder 回合固定 approved:false —— 群回合不因「在编排」而自动放行敏感动作")
  : bad("room responder does not pin approved:false");
!/approvals\.decide|auto_approved|approveAll/.test(roomFn)
  ? ok("群回合路径不写审批决定（审批仍由用户在原审批面上做）")
  : bad("room path touches approval decisions");
/secretProtocol\.TOKEN_RULES/.test(mainSrc) && /secretProtocol\.REDACTED/.test(mainSrc) &&
  /function roomSafeText\(raw\)/.test(mainSrc) && /ROOM_DEBUG_RE/.test(mainSrc) &&
  /text: assistants\.join\("\\n"\)/.test(mainSrc)
  ? ok("回执入转录前过密钥脱敏 + 内核/Host 调试行过滤（转录卫生在 Host 侧收口）")
  : bad("transcript sanitization missing");

/* GP-145：群 composer 是独占态，点开 Bot / 会话必须让位回私聊。 */
/function selectBotForChat\(b\)[\s\S]{0,400}if \(composerRoom\) exitRoomChat\(\);/.test(html) &&
  /el\.addEventListener\("click", async \(\) => \{\s*\n\s*\/\/ 群聊 composer 是独占态[\s\S]{0,200}if \(composerRoom\) exitRoomChat\(\);/.test(html)
  ? ok("点开 Bot 私聊或切会话时退出群 composer（消息不会误发进群）")
  : bad("room composer does not yield to DM surfaces");
/orchestrate: \(payload\) => ipcRenderer\.invoke\("bitbot:rooms:orchestrate"/.test(preloadSrc) &&
  /onRoomOrchestrating:/.test(preloadSrc) && /onRoomUpdated:/.test(preloadSrc) &&
  /onRoomsChanged:/.test(preloadSrc) && /"bitbot:rooms-changed"/.test(preloadSrc)
  ? ok("preload 暴露 rooms.orchestrate + 三个群回合事件（运行态/新行/目录变化，渲染层不自己拼状态）")
  : bad("preload rooms API missing");

/* GP-146 持久层有界：共享转录的每个字段都要有上限，长内容不得重复落盘。 */
const surfSrc = fs.readFileSync(path.join(REPO, "hosts/desktop/product_surface.js"), "utf8");
/const ROOM_TEXT_MAX = Math\.max\(/.test(surfSrc) &&
  /ROOM_SUMMARY_MAX = 240/.test(surfSrc) && /ROOM_REASON_MAX = 200/.test(surfSrc) &&
  /function clipRoomText\(raw, max\)/.test(surfSrc) &&
  /entry\.text_truncated = true/.test(surfSrc) && /entry\.error_truncated = true/.test(surfSrc)
  ? ok("房间转录字段落盘前统一截断（正文/摘要/原因各自有界 + 如实标 truncated）")
  : bad("bounded transcript contract missing");
{
  const engStart = surfSrc.indexOf("function orchestrateRoom(");
  const eng = engStart < 0 ? "" : surfSrc.slice(engStart, surfSrc.indexOf("\n  }", engStart) + 4);
  const dedupeAt = eng.indexOf("deduped: true");
  const fanoutAt = eng.indexOf("deps.onFanout");
  dedupeAt >= 0 && fanoutAt >= 0 && fanoutAt > dedupeAt
    ? ok("「工作中」态在 engine 真扇出时才发（幂等命中/护栏拒绝不闪假运行态）")
    : bad("onFanout is not emitted strictly after the dedupe guard");
  /responder_policy: responderPolicy/.test(eng)
    ? ok("final_report 落 responder_policy（重开窗口仍能说明这次谁该答）")
    : bad("final_report loses responder_policy");
}
{
  const bcast = (mainSrc.match(/bitbot:room-orchestrating/g) || []).length;
  bcast === 1 && /onFanout: \(ev\) => \{[\s\S]{0,240}broadcast\("bitbot:room-orchestrating"/.test(mainSrc)
    ? ok("main 只在 onFanout 回调里发运行态（IPC 里没有第二条广播路径）")
    : bad("room-orchestrating broadcast not single-sourced: " + bcast);
}

/* GP-146 存储故障诚实：坏掉的 rooms.json 既不能演成「一个群都没有」，也不能
 * 被一次写入覆盖成空目录（那是数据丢失，不是降级）。读侧如实报，写侧 fail closed。 */
/function requireWritableRooms\(\)/.test(surfSrc) && /rooms_store_unreadable/.test(surfSrc) &&
  /function roomsStoreStatus\(\)/.test(surfSrc) &&
  (surfSrc.match(/const rooms = requireWritableRooms\(\);/g) || []).length >= 5 &&
  !/const rooms = loadRooms\(\);/.test(surfSrc)
  ? ok("rooms.json 坏掉时写侧 fail closed（建群/回合/编排/转录都拒，不落空目录覆盖历史）")
  : bad("rooms store not fail-closed on corruption");
/roomsStoreStatus\(\)/.test(mainSrc) &&
  /rooms_store_unreadable/.test(mainSrc) &&
  !/return \{ ok: true, rooms: surface\.loadRooms\(\) \}/.test(mainSrc) &&
  /broadcast\("bitbot:rooms-changed", st\.ok \?/.test(mainSrc)
  ? ok("rooms:list 与 rooms-changed 都带 ok 标志：读不到就说读不到，不报「空目录」")
  : bad("rooms IPC still hides store failures");
/if \(res && res\.ok === false\) return null;/.test(html) &&
  /if \(entries === null\)/.test(html) && /roomTranscriptReadFail/.test(html) &&
  /room-list-readfail/.test(html) && /roomListReadFail/.test(html)
  ? ok("渲染层区分「空群」与「读不到」：转录与侧栏都不把存储故障演成历史消失")
  : bad("renderer conflates empty room with unreadable store");
const ffiSrc = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
/res = surface\.roomTurn\(hitRoom\.id/.test(ffiSrc) &&
  /surface\.appendRoomTranscript\(hitRoom\.id, res\.transcript_entry\)/.test(ffiSrc) &&
  (ffiSrc.match(/rooms_store_unreadable/g) || []).length >= 3
  ? ok("内核 effect 循环同样 fail closed：坏存储报错跳过，不让异常炸掉整批回合")
  : bad("host_ffi room effects not guarded against unreadable rooms store");
/window\.bitbot\.rooms\.onRoomsChanged/.test(html) &&
  /if \(!list\.some\(\(x\) => x && x\.id === composerRoom\.id\)\) exitRoomChat\(\);/.test(html) &&
  /onRoomsChanged\(\(ev\) => \{[\s\S]{0,700}exitRoomChat\(\);/.test(html)
  ? ok("目录里群已消失（成员掉到 2 人以下被丢弃）时诚实退出，不留空壳会话")
  : bad("renderer keeps a phantom room session after directory change");

/* GP-143/146：点名点到非成员 —— 不假装定向成功，如实告知处理方式。 */
/unknownMentions\.push\(/.test(surfSrc) && /unknown_mentions: unknownMentions\.length/.test(surfSrc)
  ? ok("roomTurn 记 unknown_mentions（Host 侧留痕，渲染层据此说明）")
  : bad("unknown_mentions not recorded in roomTurn");
/e\.unknown_mentions/.test(html) && /roomUnknownMention/.test(html)
  ? ok("渲染层把「提及不在本群」如实说给用户（不静默改判成全员应答）")
  : bad("renderer does not surface unknown mentions");

/* GP-146 产品态文案：失败原因说人话，协议码只在 dev-mode 追加；结果说明卡
 * 必须在整表重绘之后落位（重绘会清空 .room-thread，先画就等于「一闪就没」）。 */
/function roomFailReason\(raw\)/.test(html) && /function roomOpFailReason\(raw\)/.test(html) &&
  /return devModeOn\(\) \? label \+ " · " \+ s : label;/.test(html) &&
  /outcome = \{ kind: "error", reason: roomOpFailReason\(res && res\.error\) \}/.test(html) &&
  /await renderRoomTranscript\(roomId\);\s*\n\s*if \(outcome\) roomAppend\(roomOutcomeCard\(outcome\)\);/.test(html) &&
  !/why\.textContent = devModeOn\(\)/.test(html)
  ? ok("群聊失败卡走本地化语义，原始码仅 dev-mode 可见，且说明卡在重绘后落位")
  : bad("room failure copy not localized / outcome card not persisted");
/res\.deduped/.test(html) && /roomReportDeduped/.test(html)
  ? ok("幂等命中时如实说明「同一任务未重复执行」，不让人以为又跑了一遍")
  : bad("dedupe notice missing");

/* GP-146: transcript renders per entry, not one concatenated text blob. */
/async function renderRoomTranscript\(roomId\)/.test(html) &&
  /kind === "final_report"/.test(html) &&
  /kind === "bot_reply_error"/.test(html) &&
  /function renderRoomFinalReport\(e\)/.test(html) &&
  /function renderRoomBotReply\(e, isError\)/.test(html) &&
  !/lines\.join\("\\n"\)/.test(html)
  ? ok("群 transcript 按条目渲染（user / bot_reply / bot_reply_error / final_report 各有卡片，无纯文本拼接）")
  : bad("per-entry room transcript rendering missing");

/function renderRoomWorking\(ev\)/.test(html) &&
  /roomWorking\.set\(roomId \+ "\|" \+ r\.id, el\)/.test(html) &&
  /function clearRoomWorking\(\)/.test(html) &&
  /clearRoomWorking\(\);[\s\S]{0,200}await renderRoomTranscript\(roomId\)/.test(html)
  ? ok("运行中为每个 responder 显示「工作中」卡，收线后清理并回读 rooms.json")
  : bad("in-flight working state missing");

/roomExitBtn\.addEventListener\("click", exitRoomChat\)/.test(html) &&
  /COMPOSER_PLACEHOLDER_DEFAULT/.test(html)
  ? ok("退出群聊恢复 DM composer（banner 收起 + placeholder 复原）")
  : bad("exit wiring missing");

/roomTranscriptEmpty/.test(html) && /entries\.slice\(-ROOM_RENDER_CAP\)/.test(html) &&
  /found && Array\.isArray\(found\.transcript\) \? found\.transcript/.test(html)
  ? ok("打开群聊读 rooms.json 真实 transcript；空群明说「还没有消息」，不造历史")
  : bad("transcript read missing");

["roomExit", "roomRouteHint", "roomComposerPh", "roomTranscriptEmpty", "roomTranscriptHead",
  "roomMe", "roomWorking", "roomReplyFailed", "roomNoReason", "roomReportHead",
  "roomReportCount", "roomReportPartial", "roomReportComplete", "roomReportTask",
  "roomArtifactsLabel", "roomPolicyMentioned", "roomPolicyAll", "roomPolicyDiscretion",
  "roomStartFailed", "roomStartFailedHint", "roomFailTimeout", "roomFailNoReply",
  "roomFailRunner", "roomFailNotFound", "roomFailProvider", "roomFailTooMany",
  "roomFailNotMember", "roomFailRoomGone", "roomFailEmpty", "roomFailBusy",
  "roomTextClipped", "roomUnknownMention", "roomReportDeduped",
  "roomTranscriptReadFail", "roomListReadFail"]
  .every((k) => new RegExp(k + ': "').test(html))
  ? ok("35 个群聊文案在 zh-CN / zh-TW / en 三套 i18n 齐全")
  : bad("i18n keys missing in some locale");

/* ---------- 2) 行为层：真实 rooms store ---------- */
const ROOMS = path.join(REPO, "data/desktop/rooms.json");
const BOTS = path.join(REPO, "data/desktop/bots.json");
const roomsBefore = fs.existsSync(ROOMS) ? fs.readFileSync(ROOMS) : null;
const botsBefore = fs.existsSync(BOTS) ? fs.readFileSync(BOTS) : null;

const surface = require(path.join(REPO, "hosts/desktop/product_surface.js")).createProductSurface(REPO);

process.on("exit", () => {
  try {
    if (roomsBefore === null) fs.rmSync(ROOMS, { force: true });
    else fs.writeFileSync(ROOMS, roomsBefore);
  } catch (_) {}
  try {
    if (botsBefore === null) fs.rmSync(BOTS, { force: true });
    else fs.writeFileSync(BOTS, botsBefore);
  } catch (_) {}
  try { fs.writeFileSync(htmlPath, html); } catch (_) {}
});

(async () => {
  try {
    // Two fresh members (2–6 gate needs real bots).
    const mk = (name) => surface.botsCreate({ name, job: "m29 probe", description: "probe" });
    const b1 = mk("M29 探针甲");
    const b2 = mk("M29 探针乙");
    b1 && b1.ok && b2 && b2.ok
      ? ok("两个成员 Bot 真实落 bots.json")
      : bad("botsCreate failed: " + JSON.stringify([b1 && b1.error, b2 && b2.error]));

    /* GP-152：入口路径现在先解析名字，再查 2–6。
       - 只给一个「真实存在」的 Bot → 仍然必须撞 members_2_to_6（原断言的意图）；
       - 给一个不存在的名字 → 必须点名 names_not_found，且不落任何半成品群
         （§1 J2 负向：说清没找到谁，不假装成功）。两条分开测，谁也不替代谁。 */
    const oneReal = surface.createRoom(b1.bot.id, "独角戏");
    oneReal && oneReal.error === "members_2_to_6"
      ? ok("成员 <2 被拒（members_2_to_6 门仍在入口路径上）")
      : bad("2-6 gate missing: " + JSON.stringify(oneReal));

    const ghostName = surface.createRoom("solo-bot", "独角戏");
    const ghostRooms = (surface.loadRooms().rooms || []).filter((r) => r && r.title === "独角戏");
    ghostName && ghostName.ok === false && ghostName.error === "names_not_found" &&
      Array.isArray(ghostName.names_not_found) && ghostName.names_not_found.includes("solo-bot") &&
      ghostRooms.length === 0
      ? ok("不存在的名字被点名（names_not_found），且没有落半成品群")
      : bad("names_not_found 路径不对: " + JSON.stringify(ghostName));

    const created = surface.createRoom(
      [b1.bot.id, b2.bot.id].join(","),
      "M29 群聊探针",
    );
    created && created.ok && created.room && created.room.id
      ? ok("createRoom 真建群（rooms.json 落盘，title 成员齐全）")
      : bad("createRoom failed: " + JSON.stringify(created && created.error));

    const roomId = created.room.id;
    const at = new Date().toISOString();
    const directed = surface.roomTurn(roomId, "@" + b1.bot.name + " 帮我看下这个", at);
    directed.ok && directed.transcript_entry.responder_policy === "mentioned_only" &&
      JSON.stringify(directed.transcript_entry.responders) === JSON.stringify([b1.bot.id])
      ? ok("@Name → mentioned_only 且 responders 精确到被点名的 Bot（GP-51）")
      : bad("directed route wrong: " + JSON.stringify(directed.transcript_entry));
    const everyone = surface.roomTurn(roomId, "@everyone 都出个方案", at);
    everyone.ok && everyone.transcript_entry.responder_policy === "all"
      ? ok("@everyone → all")
      : bad("everyone route wrong");
    /* GP-144: several leading mentions run exactly the named members. */
    const multi = surface.roomTurn(roomId, "@" + b1.bot.name + " @" + b2.bot.name + " 一起出方案", at);
    multi.ok && multi.transcript_entry.responder_policy === "mentioned_only" &&
      multi.transcript_entry.responders.length === 2 &&
      multi.transcript_entry.responders.includes(b1.bot.id) &&
      multi.transcript_entry.responders.includes(b2.bot.id)
      ? ok("@A @B → mentioned_only 且只跑点名的 2 个成员（多点名）")
      : bad("multi-mention route wrong: " + JSON.stringify(multi && multi.transcript_entry));
    /* GP-146: a user row is typed, so the renderer can tell it apart from replies. */
    multi.ok && multi.transcript_entry.kind === "user" && multi.transcript_entry.speaker === "user"
      ? ok("roomTurn 落的用户行带 kind=user（按条目渲染的前提）")
      : bad("user row kind missing: " + JSON.stringify(multi && multi.transcript_entry));
    const discretion = surface.roomTurn(roomId, "随便聊聊", at);
    discretion.ok && discretion.transcript_entry.responder_policy === "bot_discretion" &&
      discretion.transcript_entry.responders_are_candidates === true &&
      discretion.transcript_entry.responders.length === 2
      ? ok("无 @ → bot_discretion，responders 是候选池（不是已确定发言者）")
      : bad("discretion route wrong: " + JSON.stringify(discretion && discretion.transcript_entry));
    const unknownRoom = surface.roomTurn("room-nope", "@x hi", at);
    unknownRoom && unknownRoom.error === "room_not_found"
      ? ok("未知群组 room_not_found（不造 transcript）")
      : bad("unknown room not refused");

    // The renderer reads rooms.list() — the same durable transcript.
    const saved = surface.appendRoomTranscript(roomId, directed.transcript_entry);
    saved.ok
      ? ok("appendRoomTranscript 真写 rooms.json（渲染层 openRoomChat 读的就是它）")
      : bad("appendRoomTranscript failed");
    const view = surface.loadRooms();
    const roomRow = (view.rooms || []).find((r) => r.id === roomId);
    /* GP-152：建房本身会先落一条 kind:"system" 的建群行（§1 J2 要求转录里能看到
       「这个群是这一轮建起来的」）。原来的「逐字一致」断言不能因此被削弱，所以
       改成：系统行在最前 + roomTurn 那条用户行按原文一字不差紧随其后。 */
    const txRows = Array.isArray(roomRow.transcript) ? roomRow.transcript : [];
    const sysRow = txRows.find((e) => e && e.kind === "system");
    const userIdx = txRows.findIndex(
      (e) => e && e.kind === "user" && e.text === "@" + b1.bot.name + " 帮我看下这个",
    );
    /* 注意：这行文案里「rooms.json transcript 与 roomTurn 逐字一致」是
       smoke_grok_desktop_parity.sh G-29 GP-119 的 grep 锚点，改字要同步改那边。 */
    txRows.length >= 2 && sysRow && /已创建群聊/.test(String(sysRow.text)) && userIdx >= 0
      ? ok("rooms.json transcript 与 roomTurn 逐字一致（建群系统行在前，按 at 落行）")
      : bad("transcript mismatch: " + JSON.stringify(roomRow && roomRow.transcript));

    /* ---------- 3) 负向对照：摘掉群聊发送调用 → 静态断言变红 ---------- */
    const marker = "await sendRoomTurn(finalText);";
    const broken = html.replace(marker, "// sabotaged");
    if (broken !== html) {
      fs.writeFileSync(htmlPath, broken);
      const fresh = fs.readFileSync(htmlPath, "utf8");
      !/if \(composerRoom\) \{[\s\S]{0,700}await sendRoomTurn\(finalText\)/.test(fresh)
        ? ok("负向对照：禁用群聊发送调用后 composer 不再路由到群聊（断言会红）")
        : bad("negative control did not change the file");
    } else {
      bad("negative control marker not found in index.html");
    }

    console.log("\nprove_m29_roomchat: PASS=" + pass + " FAIL=" + fail);
    process.exit(fail ? 1 : 0);
  } catch (err) {
    console.error("probe crashed:", err);
    process.exit(1);
  }
})();


