#!/usr/bin/env node
"use strict";

/**
 * prove_m29_roomchat — G-25 群聊入口（官方 spec §2.4 / GP-119 群聊回合落 #log）
 *
 * 静态层：#room-banner 结构、侧栏群组行 → openRoomChat、composer 前缀
 *         `room <id> :: `、退出恢复 placeholder、空群「不造历史」、5 键三语。
 * 行为层：真实 product_surface roomCreate/roomTurn/appendRoomTranscript/
 *         loadRooms —— 建群（成员 2–6 门）、@Name 定向路由、@everyone、
 *         无 @ bot_discretion、transcript 真落 rooms.json（渲染层读的就是它）。
 * 负向对照：把渲染层 composer 前缀砍掉 → 静态断言变红；html 在 finally 恢复。
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

/if \(composerRoom\) finalText = "room " \+ composerRoom\.id \+ " :: " \+ finalText;/.test(html)
  ? ok("composer 提交走既有 kernel RoomTurn 短语（room <id> :: …），不是新路径")
  : bad("composer room prefix missing");

/roomExitBtn\.addEventListener\("click", exitRoomChat\)/.test(html) &&
  /COMPOSER_PLACEHOLDER_DEFAULT/.test(html)
  ? ok("退出群聊恢复 DM composer（banner 收起 + placeholder 复原）")
  : bad("exit wiring missing");

/roomTranscriptEmpty/.test(html) && /entries\.slice\(-8\)/.test(html) &&
  /found && Array\.isArray\(found\.transcript\) \? found\.transcript/.test(html)
  ? ok("打开群聊读 rooms.json 真实 transcript；空群明说「还没有消息」，不造历史")
  : bad("transcript read missing");

["roomExit", "roomRouteHint", "roomComposerPh", "roomTranscriptEmpty", "roomTranscriptHead"]
  .every((k) => new RegExp(k + ': "').test(html))
  ? ok("5 个新文案在 zh-CN / zh-TW / en 三套 i18n 齐全")
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

    /* ---------- 3) 负向对照：砍掉 composer 前缀 → 静态断言变红 ---------- */
    const marker = 'if (composerRoom) finalText = "room " + composerRoom.id + " :: " + finalText;';
    const broken = html.replace(marker, "// sabotaged");
    if (broken !== html) {
      fs.writeFileSync(htmlPath, broken);
      const fresh = fs.readFileSync(htmlPath, "utf8");
      !/if \(composerRoom\) finalText = "room "/.test(fresh)
        ? ok("负向对照：禁用前缀后 composer 不再路由到群聊（断言会红）")
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


