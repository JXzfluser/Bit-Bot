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
      "settings_open",
      "agent_info_panel",
      "delete_agent",
      "package_install",
      "shared_box_fs",
      "hide_agent",
      "list_agents_sidebar",
      "members_panel",
      "notify_settings",
      "set_notify",
      "update_computer",
      "reset_computer",
      "local_execution",
      "guide_permission",
      "render_markdown",
      "react_message",
      "screenshot",
      "check_updates",
      "auto_review_settings",
      "box_chrome_probe",
      "mcp_namespace",
      "mcp_uninstall",
      "mcp_get_plugin",
      "mcp_list_plugins",
      "teammate_create",
      "schedule_meeting",
      "mail_search",
      "mail_read",
      "finance_call",
      "job_search",
      "workflow_list",
      "slides_pptx",
      "skill_write",
      "export_pack",
      "inbound_reaction",
      "cloud_agent_launch",
      "cloud_artifact_deliver",
      "routine_schedule",
      "routine_list",
      "routine_fire",
      "routine_tick",
      "auto_review_settings",
      "shell",
      "fs_list",
      "fs_read",
      "webfetch",
      "computer_use",
      "shared_memory_put",
      "shared_memory_read",
      "memory_update",
      "memory_recall",
      "code_changes",
      "source_control",
      "machines_list",
      "mail_claim_inbox",
      "device_tools_list",
      "device_tool",
      "delivery",
      "journal_query",
      "skill_load",
      "copy_to_box",
      "copy_from_box",
      "subagent_run",
      "room_turn",
      "send_to_agent",
      "routine_pause",
      "routine_resume",
      "journal_append",
    ]) {
      const hit = hrs.find((h) => {
        if (!h || h.kind !== kind) return false;
        if (h.ok !== false) return true;
        // Honest OAuth NeedsAuth still mirrors when Host ok=false.
        if (kind !== "oauth") return false;
        try {
          const p = JSON.parse(h.stdout || "{}");
          return (
            p.status === "NeedsAuth" ||
            p.mode === "live_needs_auth" ||
            p.mode === "live_remote_browser_open" ||
            (p.connected === false && p.pretend_connected === false)
          );
        } catch {
          return false;
        }
      });
      if (!hit) continue;
      let payload = {};
      try {
        payload = JSON.parse(hit.stdout || "{}");
      } catch {
        payload = {};
      }
      // Prefer durable snap path; fall back to media/frame/html for SendToUser attachments.
      const hostPath =
        payload.artifact_path ||
        payload.path ||
        payload.media_path ||
        payload.frame_path ||
        payload.html_path ||
        payload.receipt_path ||
        payload.pptx_path ||
        payload.ics_path ||
        payload.eml_path ||
        payload.skill_path ||
        payload.export_path ||
        payload.reply_media_path ||
        null;
      if (!hostPath) continue;
      fs.mkdirSync(deliveryMirrorDir, { recursive: true });
      const mirrorPath = path.join(
        deliveryMirrorDir,
        `${kind}-${Date.now().toString(36)}.json`,
      );
      const oc = payload.outcome || {};
      const vp = (payload.gui && payload.gui.vision_plan) || {};
      const gui = payload.gui || {};
      const mirror = {
        kind: kind + "_mobile_mirror",
        machine_kind: machineKind,
        host_kind: kind,
        host_path: hostPath,
        media_path: payload.media_path || null,
        frame_path: payload.frame_path || null,
        html_path: payload.html_path || null,
        eml_path: payload.eml_path || null,
        mode: payload.mode || null,
        pretend_live: payload.pretend_live === true,
        pretend_sent: payload.pretend_sent === true,
        pretend_connected: payload.pretend_connected === true,
        live_mail_residual: payload.live_mail_residual === true,
        live_mail_claim_residual: payload.live_mail_claim_residual === true,
        live_channel_residual: payload.live_channel_residual === true,
        widget_degraded: payload.widget_degraded === true,
        inbound_push_residual: payload.inbound_push_residual === true,
        live_slack_residual: payload.live_slack_residual === true,
        live_teams_residual: payload.live_teams_residual === true,
        live_meeting_residual: payload.live_meeting_residual === true,
        live_sms_residual: payload.live_sms_residual === true,
        live_webhook_residual: payload.live_webhook_residual === true,
        live_voice_residual: payload.live_voice_residual === true,
        live_x_residual: payload.live_x_residual === true,
        live_job_residual: payload.live_job_residual === true,
        live_finance_residual: payload.live_finance_residual === true,
        live_calendar_residual: payload.live_calendar_residual === true,
        voice_stt_residual: payload.voice_stt_residual === true,
        voice_tts_residual: payload.voice_tts_residual === true,
        inbound_turn_residual: payload.inbound_turn_residual === true,
        credential_browser_fill_residual:
          payload.credential_browser_fill_residual === true,
        signin_fill_residual: payload.signin_fill_residual === true,
        cross_machine_copy_residual:
          payload.cross_machine_copy_residual === true,
        device_capture_residual: payload.device_capture_residual === true,
        device_tool_residual: payload.device_tool_residual === true,
        product_tool_residual: payload.product_tool_residual === true,
        live_paid_residual:
          payload.live_paid_residual === true ||
          oc.live_paid_residual === true,
        box_doctor_bin_residual: payload.box_doctor_bin_residual === true,
        box_chrome_bin_residual: payload.box_chrome_bin_residual === true,
        long_lived_cron_residual: payload.long_lived_cron_residual === true,
        remote_cloud_residual: payload.remote_cloud_residual === true,
        remote_cloud_artifact_residual:
          payload.remote_cloud_artifact_residual === true,
        code_apply_residual: payload.code_apply_residual === true,
        git_commit_residual: payload.git_commit_residual === true,
        screenshot_residual: payload.screenshot_residual === true,
        remote_pr_residual: payload.remote_pr_residual === true,
        public_fallback_residual: payload.public_fallback_residual === true,
        interactive_oauth_residual:
          payload.interactive_oauth_residual === true,
        true_device_os_dialog_residual:
          payload.true_device_os_dialog_residual === true,
        gh_pr_create_residual:
          payload.gh_pr_create_residual === true ||
          String(
            (payload.remote_pr && payload.remote_pr.mode) ||
              payload.mode ||
              "",
          ).includes("gh_pr_create_residual"),
        ocr_residual:
          payload.ocr_residual === true ||
          oc.ocr_residual === true ||
          vp.ocr_residual === true,
        os_window_automation_residual:
          payload.os_window_automation_residual === true ||
          oc.os_window_automation_residual === true ||
          gui.os_window_automation_residual === true,
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
          hostPath +
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
