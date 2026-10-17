#!/usr/bin/env node
"use strict";

/**
 * Mobile Host entry — same MoonBit brain + Host FFI as Desktop.
 * Defaults to ios; use --machine-kind android for Pixel-class hosts.
 * Surfaces deviceLocalTools on phone kinds (CM-0705).
 * device_permission effects are journaled as OS permission-card / Settings-guide
 * Host actions (never pretend-granted without --approved).
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
if (!args.includes("--machine-kind")) {
  args.unshift("--machine-kind", process.env.BITBOT_MACHINE_KIND || "ios");
}

const r = spawnSync(
  process.execPath,
  [path.join(root, "hosts/cli_host/run_turn.js"), ...args],
  { cwd: root, encoding: "utf8", env: process.env },
);
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);

// CM-0705: device_permission is executed by shared Host FFI into
// data/device/permission-cards.jsonl (pretend_granted=false). Mirror a
// mobile-specific OS-card note when the Host result is present.
try {
  const out = String(r.stdout || "");
  const line = out.trim().split("\n").filter(Boolean).pop() || "";
  if (line.startsWith("{")) {
    const turn = JSON.parse(line);
    const hrs = Array.isArray(turn.host_results) ? turn.host_results : [];
    const perm =
      hrs.find((h) => h && h.kind === "device_permission") ||
      (Array.isArray(turn.effects)
        ? turn.effects.find((e) => e && e.kind === "device_permission")
        : null);
    if (perm) {
      const journal = path.join(root, "data/journal/host-delivery.jsonl");
      fs.mkdirSync(path.dirname(journal), { recursive: true });
      fs.appendFileSync(
        journal,
        JSON.stringify({
          kind: "device_permission_os_card",
          machine_kind: turn.machine_kind || "ios",
          command: perm.command,
          pretend_granted: false,
          host_ok: perm.ok !== false,
          at: new Date().toISOString(),
          note: "Host raises OS permission dialog / Settings guide; not pretend-connected",
        }) + "\n",
      );
    }
  }
} catch {
  // non-JSON turn output — ignore
}

process.exit(r.status === null ? 1 : r.status);
