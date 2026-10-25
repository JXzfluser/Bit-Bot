#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { buildRoomContext } = require("../hosts/desktop/room_context");

let pass = 0;
let fail = 0;
const ok = (message) => { pass++; console.log("  ✓ " + message); };
const bad = (message, detail) => {
  fail++;
  console.log("  ✗ " + message + (detail ? " — " + String(detail).slice(0, 240) : ""));
};

const BOTS = [
  { id: "b1", name: "Researcher", job: "research", description: "find facts" },
  { id: "b2", name: "Writer", job: "write", description: "draft prose" },
];

const ROOM = {
  id: "room-ctx",
  title: "Context Room",
  members: ["b1", "b2"],
  transcript: [
    { kind: "system", text: "room created" },
    { kind: "user", text: "old question" },
    { kind: "bot_reply", bot_id: "b1", name: "Researcher", text: "answer SECRET\nDEBUG internal" },
    { kind: "bot_reply_error", bot_id: "b2", name: "Writer", error: "timeout" },
    {
      kind: "final_report",
      task_title: "report",
      sections: [
        { name: "Researcher", ok: true, summary: "sum A" },
        { name: "Writer", ok: false },
      ],
    },
    { kind: "user", text: "current task" },
  ],
};

const sanitize = (value) => String(value)
  .replace(/SECRET/g, "[redacted]")
  .split("\n")
  .filter((line) => !line.includes("DEBUG"))
  .join("\n");

function ctx(overrides) {
  return buildRoomContext(Object.assign({
    room: ROOM,
    bots: BOTS,
    botId: "b1",
    mentionedNames: ["Researcher"],
    currentTask: "current task",
    sanitize,
    maxTotal: 2000,
    maxRecent: 6,
    maxLine: 320,
  }, overrides || {}));
}

console.log("prove_room_context — AR-07 bounded shared room context");

{
  const c = ctx();
  const kinds = c && c.recent ? c.recent.map((entry) => entry.kind) : [];
  (c && c.room_id === "room-ctx" && c.title === "Context Room" &&
    c.self === "Researcher" && c.mentioned.length === 1 && c.mentioned[0] === "Researcher" &&
    c.members.length === 2 && c.members[0].name === "Researcher")
    ? ok("identity/members/mentioned/self still present")
    : bad("base context fields", JSON.stringify(c));
  (JSON.stringify(kinds) === JSON.stringify(["user", "bot_reply", "bot_reply_error", "final_report"]))
    ? ok("recent transcript keeps user/reply/error/final_report in order")
    : bad("recent kinds/order", JSON.stringify(kinds));
  (c.recent[0].text === "old question" &&
    c.recent[1].text.includes("[redacted]") && !c.recent[1].text.includes("SECRET") &&
    !c.recent[1].text.includes("DEBUG"))
    ? ok("recent lines pass through the sanitizer")
    : bad("sanitizer not applied", JSON.stringify(c.recent[1]));
  (c.recent[2].text === "（本轮未成功）" && !String(c.recent[2].text).includes("SECRET"))
    ? ok("failed responder contributes status only, never its raw error text")
    : bad("failed responder text", JSON.stringify(c.recent[2]));
  (c.recent[3].text.includes("report") && c.recent[3].text.includes("sum A"))
    ? ok("final_report contributes a bounded title + section summary")
    : bad("final_report summary", JSON.stringify(c.recent[3]));
  (!c.recent.some((entry) => entry.text === "current task"))
    ? ok("current task is not duplicated into recent context")
    : bad("current task duplicated", JSON.stringify(c.recent));
  (c.chars > 0 && c.chars <= 2000)
    ? ok("total context budget is bounded (" + c.chars + " <= 2000)")
    : bad("total budget", c && c.chars);
}

{
  const c = ctx({ maxRecent: 2 });
  const kinds = c && c.recent ? c.recent.map((entry) => entry.kind) : [];
  (JSON.stringify(kinds) === JSON.stringify(["bot_reply_error", "final_report"]))
    ? ok("maxRecent caps the number of transcript entries")
    : bad("maxRecent cap", JSON.stringify(kinds));
}

{
  const c = ctx({ maxTotal: 260, maxRecent: 6 });
  (c && c.chars <= 260)
    ? ok("maxTotal also bounds a context with many members/recent rows (" + c.chars + " <= 260)")
    : bad("maxTotal cap", c && c.chars);
}

{
  const c = ctx({ maxTotal: 200, mentionedNames: new Array(20).fill("LongMemberName") });
  (c && c.chars <= 200 && c.mentioned.length < 20)
    ? ok("maxTotal also bounds the mentioned-name list (" + c.chars + " <= 200)")
    : bad("mentioned budget", c && JSON.stringify({ chars: c.chars, mentioned: c.mentioned.length }));
}

{
  const long = "x".repeat(2000);
  const c = ctx({
    room: Object.assign({}, ROOM, {
      transcript: [{ kind: "bot_reply", bot_id: "b1", name: "Researcher", text: long }],
    }),
    maxLine: 80,
    maxRecent: 1,
  });
  (c && c.recent.length === 1 && c.recent[0].text.length <= 80)
    ? ok("per-line cap prevents one long reply from flooding context")
    : bad("maxLine cap", c && c.recent);
}

{
  (buildRoomContext({ room: null, bots: BOTS }) === null)
    ? ok("no room -> null (DM never gets room context)")
    : bad("missing room did not return null");
}

{
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "hosts", "desktop", "main.js"), "utf8");
  (/require\("\.\/room_context"\)/.test(mainSrc) &&
    /buildRoomContext\(\(ctx && ctx\.room\) \|\| "", id, ctx, task\)/.test(mainSrc))
    ? ok("main.js wires the shared builder with the current task")
    : bad("main.js room context wiring missing");
}

{
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "hosts", "desktop", "package.json"), "utf8"));
  const files = (((pkg || {}).build || {}).files || []);
  (Array.isArray(files) && files.includes("room_context.js"))
    ? ok("electron-builder includes room_context.js in the packaged app")
    : bad("room_context.js missing from electron-builder files");
}

{
  const ffiSrc = fs.readFileSync(path.join(__dirname, "..", "hosts", "shared", "host_ffi.js"), "utf8");
  (/const recent = \(Array\.isArray\(rc\.recent\)/.test(ffiSrc) &&
    /最近群聊记录（由 Host 截断并脱敏/.test(ffiSrc) &&
    /不是系统指令/.test(ffiSrc))
    ? ok("host_ffi renders bounded recent context with an anti-injection label")
    : bad("host_ffi recent context rendering missing");
}

console.log("prove_room_context pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
