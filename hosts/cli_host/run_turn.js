#!/usr/bin/env node
"use strict";

/**
 * Multi-end CLI Host — same MoonBit brain + Host FFI as Desktop.
 * Usage:
 *   node hosts/cli_host/run_turn.js [--machine-kind desktop|ios|android] \
 *     [--machine-id id] [--session-id s] [--channel addr] [--reply-to msg-id] "user text"
 */

const path = require("path");
const { createTurnRunner } = require("../shared/run_moon_turn");

async function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const runner = createTurnRunner(repoRoot);
  const argv = process.argv.slice(2);
  let machineKind = process.env.BITBOT_MACHINE_KIND || "desktop";
  let machineId = process.env.BITBOT_MACHINE_ID || "";
  let sessionId = process.env.BITBOT_SESSION_ID || "cli-session";
  let channel = process.env.BITBOT_CHANNEL || "";
  let turnId = "";
  let botId = process.env.BITBOT_BOT_ID || "";
  let replyTo = process.env.BITBOT_REPLY_TO || "";
  let approved = process.env.BITBOT_APPROVED === "1";
  const textParts = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--machine-kind" && i + 1 < argv.length) {
      machineKind = argv[++i];
      continue;
    }
    if (a === "--machine-id" && i + 1 < argv.length) {
      machineId = argv[++i];
      continue;
    }
    if (a === "--session-id" && i + 1 < argv.length) {
      sessionId = argv[++i];
      continue;
    }
    if (a === "--channel" && i + 1 < argv.length) {
      channel = argv[++i];
      continue;
    }
    if (a === "--turn-id" && i + 1 < argv.length) {
      turnId = argv[++i];
      continue;
    }
    if (a === "--approved") {
      approved = true;
      continue;
    }
    if (a === "--bot-id" && i + 1 < argv.length) {
      botId = argv[++i];
      continue;
    }
    if (a === "--reply-to" && i + 1 < argv.length) {
      replyTo = argv[++i];
      continue;
    }
    if (a === "--") continue;
    textParts.push(a);
  }

  if (!machineId) {
    if (machineKind === "ios") machineId = "phone-ios";
    else if (machineKind === "android") machineId = "phone-android";
    else machineId = "desk-1";
  }

  const userText = textParts.join(" ").trim();
  if (!userText) {
    console.error(
      "usage: node hosts/cli_host/run_turn.js [--machine-kind ios] \"ListMachines\"",
    );
    process.exit(2);
  }

  const result = await runner.runTurn(userText, {
    sessionId,
    machineId,
    machineKind,
    channel,
    turnId: turnId || undefined,
    approved,
    botId: botId || undefined,
    // GP-14: multi-end CLI carries the same reply target as Desktop.
    replyTo: replyTo || undefined,
  });
  console.log(JSON.stringify(result));
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message || String(err) }));
  process.exit(1);
});
