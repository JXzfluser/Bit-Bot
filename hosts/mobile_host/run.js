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
const {
  extractDeliveryTypes,
  formatDeliveryStrip,
} = require("../shared/send_to_user_surface");

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
if (r.stdout) {
  process.stdout.write(r.stdout);
  // CHARTER Delivery: append SendToUser strip for mobile Host shells.
  const summary = extractDeliveryTypes(r.stdout);
  const strip = formatDeliveryStrip(summary);
  if (strip) process.stdout.write(strip + "\n");
  // Multi-end honesty: echo active machine_kind when Host results present.
  if (summary && summary.machine_kind) {
    process.stdout.write(
      "[HostAbi machine_kind=" +
        summary.machine_kind +
        (summary.ok ? " ok" : " err") +
        "]\n",
    );
  }
}
if (r.stderr) process.stderr.write(r.stderr);

// Multi-end Host mirrors: CM-0705 device_permission OS-card + delivery path
// echoes for channel_send / mail_send (shared FFI snaps; never invent live).
try {
  const out = String(r.stdout || "");
  // Prefer first-line JSON (mobile_host trailer may follow).
  const line =
    out
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("{")) || "";
  if (line.startsWith("{")) {
    const turn = JSON.parse(line);
    const hrs = Array.isArray(turn.host_results) ? turn.host_results : [];
    const machineKind = turn.machine_kind || "ios";
    const journal = path.join(root, "data/journal/host-delivery.jsonl");
    fs.mkdirSync(path.dirname(journal), { recursive: true });

    const perm =
      hrs.find((h) => h && h.kind === "device_permission") ||
      (Array.isArray(turn.effects)
        ? turn.effects.find((e) => e && e.kind === "device_permission")
        : null);
    if (perm) {
      let cardPath = null;
      let pretendGranted = false;
      let residual = true;
      try {
        const payload = JSON.parse(perm.stdout || "{}");
        cardPath = payload.path || null;
        pretendGranted = Boolean(payload.pretend_granted);
        residual = payload.true_device_os_dialog_residual !== false;
      } catch {
        /* ignore */
      }
      const mirrorDir = path.join(root, "data", "device", "mobile-mirrors");
      fs.mkdirSync(mirrorDir, { recursive: true });
      const mirrorPath = path.join(
        mirrorDir,
        `os-card-${Date.now().toString(36)}.json`,
      );
      const mirror = {
        kind: "device_permission_os_card",
        machine_kind: machineKind,
        command: perm.command,
        card_path: cardPath,
        pretend_granted: pretendGranted,
        true_device_os_dialog_residual: residual,
        host_ok: perm.ok !== false,
        at: new Date().toISOString(),
        note: "Host raises OS permission dialog / Settings guide; not pretend-connected",
      };
      fs.writeFileSync(mirrorPath, JSON.stringify(mirror, null, 2));
      fs.appendFileSync(
        journal,
        JSON.stringify({ ...mirror, path: mirrorPath }) + "\n",
      );
      process.stdout.write(
        "[HostAbi device_permission card=" +
          (cardPath || "(pending)") +
          " pretend_granted=" +
          String(pretendGranted) +
          " mirror=" +
          mirrorPath +
          "]\n",
      );
    }

    // Echo Host delivery snap paths for channel/mail so iOS/Android shells
    // share the same evidence trail as Desktop (CHARTER multi-end delivery).
    const deliveryMirrorDir = path.join(
      root,
      "data",
      "device",
      "mobile-delivery-mirrors",
    );
    for (const kind of [
      "channel_send",
      "mail_send",
      "mail_draft",
      "section_add",
      "section_post",
      "credential_fill",
      "purchase",
      "oauth",
      "mcp_call",
      "mcp_discover",
      "voice_relay",
      "voice_session",
      "voice_end_write",
      "credential_list",
      "x_search",
      "approval_card",
      "connectors_probe",
      "generate_image",
      "generate_video",
      "watch_video",
      "structured_chart",
      "box_doctor",
      "box_env",
      "box_clock",
      "webhook_panel",
      "webhook_copy",
      "webhook_tool_read_key",
      "webhook_wake",
    ]) {
      const hit = hrs.find((h) => h && h.kind === kind && h.ok !== false);
      if (!hit) continue;
      let payload = {};
      try {
        payload = JSON.parse(hit.stdout || "{}");
      } catch {
        payload = {};
      }
      if (!payload.path) continue;
      fs.mkdirSync(deliveryMirrorDir, { recursive: true });
      const mirrorPath = path.join(
        deliveryMirrorDir,
        `${kind}-${Date.now().toString(36)}.json`,
      );
      const mirror = {
        kind: kind + "_mobile_mirror",
        machine_kind: machineKind,
        host_kind: kind,
        host_path: payload.path,
        eml_path: payload.eml_path || null,
        mode: payload.mode || null,
        pretend_live: payload.pretend_live === true,
        pretend_sent: payload.pretend_sent === true,
        host_ok: hit.ok !== false,
        at: new Date().toISOString(),
        note: "Mobile Host mirrors Desktop Host delivery snap path — no invent",
      };
      fs.writeFileSync(mirrorPath, JSON.stringify(mirror, null, 2));
      fs.appendFileSync(
        journal,
        JSON.stringify({ ...mirror, path: mirrorPath }) + "\n",
      );
      process.stdout.write(
        "[HostAbi " +
          kind +
          " path=" +
          payload.path +
          " mirror=" +
          mirrorPath +
          "]\n",
      );
    }
  }
} catch {
  // non-JSON turn output — ignore
}

process.exit(r.status === null ? 1 : r.status);
