#!/usr/bin/env node
"use strict";

/**
 * Mobile Host entry — same MoonBit brain + Host FFI as Desktop.
 * Defaults to ios; use --machine-kind android for Pixel-class hosts.
 * Surfaces deviceLocalTools on phone kinds (CM-0705).
 */

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
process.exit(r.status === null ? 1 : r.status);
