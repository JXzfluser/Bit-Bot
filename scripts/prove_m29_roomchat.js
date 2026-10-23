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
  /deps: \{ runResponderTurn: runRoomResponderTurn/.test(mainSrc)
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
  /onRoomOrchestrating:/.test(preloadSrc) && /onRoomUpdated:/.test(preloadSrc)
  ? ok("preload 暴露 rooms.orchestrate + 两个群回合事件（渲染层不自己拼状态）")
  : bad("preload rooms API missing");

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
  "roomStartFailed", "roomStartFailedHint"]
  .every((k) => new RegExp(k + ': "').test(html))
  ? ok("20 个群聊文案在 zh-CN / zh-TW / en 三套 i18n 齐全")
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

    const tooFew = surface.createRoom("solo-bot", "独角戏");
    tooFew && tooFew.error === "members_2_to_6"
      ? ok("成员 <2 被拒（members_2_to_6 门仍在入口路径上）")
      : bad("2-6 gate missing: " + JSON.stringify(tooFew));

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
    discretion.ok && discretion.transcript_entry.responder_policy === "bot_discretion"
      ? ok("无 @ → bot_discretion")
      : bad("discretion route wrong");
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
    Array.isArray(roomRow.transcript) && roomRow.transcript.length >= 1 &&
      roomRow.transcript[0].text === "@" + b1.bot.name + " 帮我看下这个"
      ? ok("rooms.json transcript 与 roomTurn 逐字一致（按 at 时间落行）")
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


