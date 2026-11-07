#!/usr/bin/env node
/* prove_room_rename.js — 群名必须改得动，且同名同成员不许再建第二个。
 *
 * 用户的三句抱怨对应这里的两条：
 *   ①「群不能修改名称？」—— 之前确实没有改名入口：名字只在建房那一刻由
 *     brief/模板定下来，之后界面上找不到任何地方能改。
 *   ②「这两个自媒体内容团队 切换对话都一样呢？」—— 侧栏两个同名群，
 *     点开一个有 22 行、一个只有 1 行，用户根本分不清。根源是建群去重只看
 *     10 分钟窗口（ROOM_DUP_WINDOW_MS）：隔一天再点「一键成队」就又多一个
 *     同群名同成员的群。
 *
 * 判据都在 Host 层真跑（临时 dataRoot），不动用户的 rooms.json：
 *   RR-01 改名成功：rooms.json 落盘、transcript 多一条 system 行
 *   RR-02 空名 / 纯空格 → title_empty，且不写盘
 *   RR-03 超过 40 字 → title_too_long，且不写盘
 *   RR-04 群不存在 → room_not_found
 *   RR-05 重名允许，但 duplicates 必须点出重名群的 id（不靠替用户改名掩盖冲突）
 *   RR-06 同群名 + 同成员再建群 → 复用既有群（existing:true），不新增
 *   RR-06b 注入对照：成员不同 → 必须真的新建（去重不能过度）
 *   RR-07 全程用户真库 sha256 不变
 *
 * 跑法：node scripts/prove_room_rename.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const { createProductSurface } = require(path.join(ROOT, "hosts/desktop/product_surface.js"));

let PASS = 0;
let FAIL = 0;
const ok = (id, msg) => { PASS++; console.log("  ✓ " + id + " " + msg); };
const bad = (id, msg, extra) => {
  FAIL++;
  console.log("  ✗ " + id + " " + msg + (extra !== undefined ? " — " + JSON.stringify(extra) : ""));
};
const sha = (p) => {
  try { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
  catch (_) { return null; }
};

const REAL_ROOMS = path.join(ROOT, "data/desktop/rooms.json");
const REAL_BOTS = path.join(ROOT, "data/desktop/bots.json");
const roomsShaBefore = sha(REAL_ROOMS);
const botsShaBefore = sha(REAL_BOTS);

const TMP = path.join(ROOT, ".rename-probe-" + process.pid);
const DESK = path.join(TMP, "desktop");

function seed() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(DESK, { recursive: true });
  fs.writeFileSync(path.join(DESK, "bots.json"), JSON.stringify({
    bots: [
      { id: "bot-a", name: "甲", job: "甲岗", description: "第一个。", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "bot-b", name: "乙", job: "乙岗", description: "第二个。", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "bot-c", name: "丙", job: "丙岗", description: "第三个。", created_at: "2026-01-01T00:00:00.000Z" },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(DESK, "rooms.json"), JSON.stringify({
    version: 1,
    rooms: [
      { id: "room-one", title: "自媒体内容团队", members: ["bot-a", "bot-b"], created_at: "2026-11-01T00:00:00.000Z", transcript: [] },
      { id: "room-two", title: "另一个群", members: ["bot-b", "bot-c"], created_at: "2026-11-02T00:00:00.000Z", transcript: [] },
    ],
  }, null, 2));
}

const readRooms = () => JSON.parse(fs.readFileSync(path.join(DESK, "rooms.json"), "utf8"));
const surface = () => createProductSurface(ROOT, { dataRoot: TMP });

try {
  seed();
  let s = surface();

  /* ---------------- 1) 改名成功能落盘，并留下可审计的系统行 ---------------- */
  const r1 = s.roomRename({ room: "room-one", title: "自媒体内容团队 · 正式" });
  const after = readRooms().rooms.find((x) => x.id === "room-one");
  const sysRow = (after.transcript || []).slice(-1)[0] || {};
  if (r1.ok && after.title === "自媒体内容团队 · 正式" && sysRow.kind === "system" && /群名称已改为/.test(sysRow.text || "")) {
    ok("RR-01", "改名落盘且落一条 system 行（" + sysRow.text + "）");
  } else {
    bad("RR-01", "改名没落盘或没留痕", { r1, title: after.title, sysRow });
  }

  /* ---------------- 2) 空名 / 纯空格：拒绝，且不写盘 ---------------- */
  const before2 = JSON.stringify(readRooms());
  const r2 = s.roomRename({ room: "room-one", title: "   " });
  const r2b = s.roomRename({ room: "room-one", title: "" });
  const unchanged2 = JSON.stringify(readRooms()) === before2;
  if (!r2.ok && r2.error === "title_empty" && !r2b.ok && unchanged2) {
    ok("RR-02", "空名 / 纯空格 → title_empty，且一个字节都没写");
  } else {
    bad("RR-02", "空名没有拦住", { r2, r2b, unchanged: unchanged2 });
  }

  /* ---------------- 3) 超长：拒绝（侧栏放不下一段话） ---------------- */
  const before3 = JSON.stringify(readRooms());
  const r3 = s.roomRename({ room: "room-one", title: "长".repeat(41) });
  if (!r3.ok && r3.error === "title_too_long" && JSON.stringify(readRooms()) === before3) {
    ok("RR-03", "41 字 → title_too_long（上限 40），未写盘");
  } else {
    bad("RR-03", "超长没有拦住", r3);
  }

  /* ---------------- 4) 群不存在：如实报，不新建 ---------------- */
  const r4 = s.roomRename({ room: "room-nope", title: "随便" });
  if (!r4.ok && r4.error === "room_not_found") ok("RR-04", "群不存在 → room_not_found");
  else bad("RR-04", "不存在的群竟被判成功", r4);

  /* ---------------- 5) 重名允许，但必须点出重名群 ---------------- */
  const r5 = s.roomRename({ room: "room-two", title: "自媒体内容团队 · 正式" });
  if (r5.ok && Array.isArray(r5.duplicates) && r5.duplicates.includes("room-one")) {
    ok("RR-05", "重名允许，duplicates 点出 " + JSON.stringify(r5.duplicates) + "（界面提示用户，而不是替他改名）");
  } else {
    bad("RR-05", "重名没有如实回报", r5);
  }

  /* ---------------- 6) 同群名 + 同成员再建群 → 复用 ----------------
     注意 RR-05 已经把 room-two 也改成了同名，所以这里不能拿「同名群个数」当
     判据 —— 要判的是**群总数没有增加**（复用而不是新建）。 */
  const before6 = readRooms().rooms.length;
  const r6 = s.roomCreate("bot-a,bot-b", "自媒体内容团队 · 正式");
  const after6 = readRooms().rooms.length;
  if (r6.ok && r6.existing === true && after6 === before6) {
    ok("RR-06", "同群名同成员再建 → 复用既有群（existing:true），群总数停在 " + after6 + "，没新增");
  } else {
    bad("RR-06", "又造了一个同名群", { existing: r6 && r6.existing, before: before6, after: after6 });
  }

  /* ---------------- 6b) 注入对照：成员不同必须真的新建 ---------------- */
  const before6b = readRooms().rooms.length;
  const r6b = s.roomCreate("bot-a,bot-c", "自媒体内容团队 · 正式");
  const after6b = readRooms().rooms.length;
  if (r6b.ok && !r6b.existing && after6b === before6b + 1) {
    ok("RR-06b", "对照：成员不同 → 真的新建（" + before6b + " → " + after6b + "，去重只看「同名 + 同成员」）");
  } else {
    bad("RR-06b", "去重过度或没生效", { existing: r6b && r6b.existing, before: before6b, after: after6b });
  }
} catch (e) {
  bad("RR-00", "自检抛错", String((e && e.stack) || e).slice(0, 400));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

if (sha(REAL_ROOMS) !== roomsShaBefore || sha(REAL_BOTS) !== botsShaBefore) {
  bad("RR-07", "自检改动了用户真库（rooms.json / bots.json 的 sha256 变了）");
} else {
  ok("RR-07", "自检全程没碰用户真库（rooms.json / bots.json 的 sha256 未变）");
}

console.log("\nprove_room_rename: PASS=" + PASS + " FAIL=" + FAIL);
process.exit(FAIL ? 1 : 0);
