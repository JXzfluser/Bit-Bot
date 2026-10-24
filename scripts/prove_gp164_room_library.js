#!/usr/bin/env node
"use strict";

/**
 * prove_gp164_room_library — 群资料库的数据通路（读 / 加 / 守边界）
 *
 * 之前只补了资料库的「面」：渲染层画出了区块，但条目没有落点 —— kernel 侧
 * 没有 room.library 字段，区块永远只能显示「还没有资料」。Host 存储接上之后，
 * 下面这些契约必须写死（先红，修完必须全绿）：
 *   1. 读一个没有资料的群 → items: []（是「没有」，不是「读不到」）。
 *   2. 读一个不存在的群 → room_not_found（不假装有个空群）。
 *   3. 加一条 → 真落盘，条目带 id / added_at（能追溯是哪次加的）。
 *   4. 同一条（同一 path）重复加 → 不重复（不会攒出一堆同名条目）。
 *   5. repo 外的路径 → path_outside_repo（与 openArtifact 同一把尺子，
 *      资料库里不会出现「点了打不开」的条目）。
 *   6. 群不存在 → room_not_found，且不凭空造一个群出来。
 *   7. rooms.json 写坏 → 读如实报错；写必须 fail closed（不把用户的历史群聊
 *      覆盖成空目录 —— 那是数据丢失，不是降级）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0,
  fail = 0;
const ok = (m) => {
  pass++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  fail++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : ""));
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp164-"));
const surface = createProductSurface(root);
const ROOMS = path.join(root, "data", "desktop", "rooms.json");

const writeRooms = (obj) => {
  fs.mkdirSync(path.dirname(ROOMS), { recursive: true });
  fs.writeFileSync(ROOMS, JSON.stringify(obj, null, 2));
};
const readRooms = () => {
  try {
    return JSON.parse(fs.readFileSync(ROOMS, "utf8"));
  } catch {
    return null;
  }
};
const libOf = (roomId) => {
  const d = readRooms();
  const r = d && Array.isArray(d.rooms) ? d.rooms.find((x) => x && x.id === roomId) : null;
  return r && Array.isArray(r.library) ? r.library : [];
};

(async () => {
  console.log("prove_gp164_room_library — 群资料库：条目真的落得下去、且守得住边界");

  /* 一个还没有资料的群 */
  writeRooms({
    version: 1,
    rooms: [
      {
        id: "room-gp164",
        title: "内容生产战队",
        members: ["agent-bit", "bot-2"],
        created_at: new Date().toISOString(),
      },
    ],
  });

  const empty = surface.roomLibraryList("room-gp164");
  empty && empty.ok === true && Array.isArray(empty.items) && empty.items.length === 0
    ? ok("P1 没有资料的群 → items: []（是「没有」，不是「读不到」）")
    : bad("P1 空库的读法不对", JSON.stringify(empty));

  const noRoom = surface.roomLibraryList("room-nope");
  noRoom && noRoom.ok === false && noRoom.error === "room_not_found"
    ? ok("P2 群不存在 → room_not_found（不假装有个空群）")
    : bad("P2 群不存在时的返回不对", JSON.stringify(noRoom));

  /* 加一条真文件：路径必须在 repo 内 */
  const libDir = path.join(root, "data", "workspace", "uploads", "gp164");
  fs.mkdirSync(libDir, { recursive: true });
  const file = path.join(libDir, "品牌口径手册.md");
  fs.writeFileSync(file, "# 品牌口径手册\n");

  const added = surface.roomLibraryAdd("room-gp164", [
    { title: "品牌口径手册.md", kind: "doc", path: file },
  ]);
  const diskLib = libOf("room-gp164");
  added && added.ok === true && added.added === 1 && diskLib.length === 1 && diskLib[0].id && diskLib[0].added_at
    ? ok("P3 加一条真落盘，且带 id / added_at（能追溯是哪次加的）")
    : bad("P3 加的条目没落盘", JSON.stringify({ added, diskLib }));

  /* 同一 path 重复加 → 不重复 */
  const again = surface.roomLibraryAdd("room-gp164", [
    { title: "品牌口径手册.md", kind: "doc", path: file },
  ]);
  const lib2 = libOf("room-gp164");
  again && again.ok === true && again.added === 0 && lib2.length === 1
    ? ok("P4 同一 path 重复加 → 不重复（added=0，库里仍 1 条）")
    : bad("P4 重复加攒出了重复条目", JSON.stringify({ again, n: lib2.length }));

  /* repo 外的路径 → 拒绝 */
  const outside = surface.roomLibraryAdd("room-gp164", [
    { title: "越权", kind: "doc", path: "/etc/passwd" },
  ]);
  const lib3 = libOf("room-gp164");
  outside && outside.ok === false && outside.error === "path_outside_repo" && lib3.length === 1
    ? ok("P5 repo 外的路径 → path_outside_repo，且库里没被塞进脏条目")
    : bad("P5 越界路径没被挡住", JSON.stringify({ outside, n: lib3.length }));

  /* 群不存在 → 不静默建群 */
  const addNoRoom = surface.roomLibraryAdd("room-nope", [{ title: "x", kind: "doc" }]);
  const roomsAfter = readRooms();
  addNoRoom && addNoRoom.ok === false && addNoRoom.error === "room_not_found" && roomsAfter.rooms.length === 1
    ? ok("P6 加到不存在的群 → room_not_found，且没有凭空造一个群")
    : bad("P6 对不存在的群写入时的返回不对", JSON.stringify({ addNoRoom, n: roomsAfter.rooms.length }));

  /* rooms.json 写坏 → 读报错；写必须 fail closed（历史不丢） */
  const broken = '{ "version": 1, "rooms": [ BROKEN';
  fs.writeFileSync(ROOMS, broken);
  const readBroken = surface.roomLibraryList("room-gp164");
  readBroken && readBroken.ok === false && /rooms_store_unreadable/.test(String(readBroken.error))
    ? ok("P7 rooms.json 写坏 → 读如实报错（不演成「没有资料」）")
    : bad("P7 坏文件时的读法不对", JSON.stringify(readBroken));

  const writeBroken = surface.roomLibraryAdd("room-gp164", [{ title: "x", kind: "doc" }]);
  const stillBroken = fs.readFileSync(ROOMS, "utf8");
  writeBroken && writeBroken.ok === false && stillBroken === broken
    ? ok("P8 坏文件时的写 fail closed（没有把用户的群聊历史覆盖成空目录）")
    : bad("P8 坏文件时的写没有 fail closed", JSON.stringify({ writeBroken, still: stillBroken.slice(0, 120) }));

  console.log("prove_gp164_room_library: PASS=" + pass + " FAIL=" + fail);
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* keep */
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("probe crashed: " + ((e && e.stack) || e));
  console.log("prove_gp164_room_library: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
