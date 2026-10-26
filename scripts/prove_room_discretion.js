#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { buildDiscretionPrompt, parseDiscretionReply } = require("../hosts/shared/room_discretion");

let pass = 0;
let fail = 0;
const ok = (message) => { pass++; console.log("  ✓ " + message); };
const bad = (message, detail) => {
  fail++;
  console.log("  ✗ " + message + (detail ? " — " + String(detail).slice(0, 240) : ""));
};

console.log("prove_room_discretion — AR-08 per-bot decision");

{
  const prompt = buildDiscretionPrompt({
    bot: { name: "Researcher", job: "research", description: "find facts" },
    task: "summarize this quarter",
  });
  (prompt.includes("summarize this quarter") && prompt.includes("Researcher") &&
    prompt.includes("职责：research") && prompt.includes("只输出 YES 或 NO"))
    ? ok("decision prompt carries task + member role + strict YES/NO output")
    : bad("decision prompt", prompt.slice(0, 300));
}

for (const [raw, want] of [
  ["YES", true],
  ["yes.", true],
  ["是", true],
  ["答案：YES", true],
  ["NO", false],
  ["no, not my job", false],
  ["否", false],
  ["不应答", false],
  ["maybe", null],
  ["", null],
]) {
  const got = parseDiscretionReply(raw);
  got === want
    ? ok("parse " + JSON.stringify(raw) + " -> " + String(want))
    : bad("parse " + JSON.stringify(raw), "got=" + String(got));
}

{
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "hosts", "desktop", "main.js"), "utf8");
  // 成员自决也搬到共享层(hosts/shared/room_runtime.js):没有 @ 的时候
  // 「谁该回」是每个成员自己决定的 —— 这个决定不能只在桌面做。
  const runtimeSrc = fs.readFileSync(
    path.join(__dirname, "..", "hosts", "shared", "room_runtime.js"),
    "utf8",
  );
  (runtimeSrc.includes('require("./room_discretion")') &&
    /async function runDiscretionTurn\(/.test(runtimeSrc) &&
    /async function selectResponders\(/.test(runtimeSrc) &&
    /fail_open: true/.test(runtimeSrc) &&
    /selectResponders: selectRoomResponders/.test(mainSrc))
    ? ok("共享 room runtime 的成员自决接进了 orchestrateRoom deps")
    : bad("shared room runtime discretion wiring missing");
}

{
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "hosts", "desktop", "package.json"), "utf8"));
  const files = (((pkg || {}).build || {}).files || []);
  const sharedCopied = Array.isArray(files) && files.some(
    (f) => f && typeof f === "object" && f.from === "../shared",
  );
  const sharedHasIt = fs.existsSync(
    path.join(__dirname, "..", "hosts", "shared", "room_discretion.js"),
  );
  (sharedCopied && sharedHasIt)
    ? ok("electron-builder ships room_discretion.js via the shared/ copy")
    : bad("room_discretion.js would be missing from the packaged app");
}

{
  const surfSrc = fs.readFileSync(path.join(__dirname, "..", "hosts", "desktop", "product_surface.js"), "utf8");
  (/responders_are_candidates = true/.test(surfSrc) &&
    /discretion_selector_required/.test(surfSrc) &&
    /skipped: true/.test(surfSrc) &&
    /discretion_fail_open/.test(surfSrc) &&
    /responderPolicy === "bot_discretion"/.test(surfSrc))
    ? ok("roomTurn marks candidates; orchestrateRoom requires a real selector and records skips")
    : bad("product_surface discretion contract missing");
}

{
  const html = fs.readFileSync(path.join(__dirname, "..", "hosts", "desktop", "index.html"), "utf8");
  (/roomReportSkipped/.test(html) && /roomReportNone/.test(html) &&
    /roomReportFailOpen/.test(html) && /discretion_fail_open/.test(html) &&
    /const skipped = Boolean\(e\.skipped\)/.test(html))
    ? ok("UI renders skipped reports and discloses fail-open decisions")
    : bad("skipped/fail-open report UI missing");
}

console.log("prove_room_discretion pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
