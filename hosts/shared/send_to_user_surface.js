"use strict";

/**
 * CHARTER Delivery — shared SendToUser surface helper for Desktop/iOS/Android Hosts.
 * Summarizes Host turn JSON into delivery type chips + concrete attachment paths
 * without inventing content.
 */

function pickAttachmentPath(kind, p, h) {
  const candidates = [
    p.media_path,
    p.frame_path,
    p.html_path,
    p.receipt_path,
    p.pptx_path,
    p.ics_path,
    p.eml_path,
    p.reply_media_path,
    p.skill_path,
    p.export_path,
    p.artifact_path,
  ];
  for (const c of candidates) {
    if (c && String(c).trim()) return String(c).trim();
  }
  const path = (p.path || h.path || "").trim();
  if (!path) return "";
  // Prefer openable / previewable file extensions over JSON snap paths.
  if (
    /\.(png|jpe?g|gif|webp|wav|mp3|mp4|webm|html?|pptx|ics|eml|md|json)$/i.test(
      path,
    )
  ) {
    return path;
  }
  // Media / purchase / slides / skills often put the real file in path already.
  if (
    kind === "generate_image" ||
    kind === "generate_video" ||
    kind === "structured_chart" ||
    kind === "slides_pptx" ||
    kind === "purchase" ||
    kind === "skill_write" ||
    kind === "export_pack"
  ) {
    return path;
  }
  return path;
}

/** Honesty residual chip suffix from Host payload (never invents residuals). */
function residualSuffix(p) {
  if (!p || typeof p !== "object") return "";
  const keys = [
    "live_mail_residual",
    "live_x_residual",
    "live_job_residual",
    "live_finance_residual",
    "live_paid_residual",
    "live_calendar_residual",
    "live_slack_residual",
    "live_teams_residual",
    "live_meeting_residual",
    "live_channel_residual",
    "box_doctor_bin_residual",
    "box_chrome_bin_residual",
    "long_lived_cron_residual",
    "remote_cloud_residual",
    "remote_cloud_artifact_residual",
    "code_apply_residual",
    "git_commit_residual",
    "screenshot_residual",
    "remote_pr_residual",
    "gh_pr_create_residual",
    "public_fallback_residual",
    "ocr_residual",
    "os_window_automation_residual",
    "interactive_oauth_residual",
    "true_device_os_dialog_residual",
    "credential_browser_fill_residual",
    "inbound_turn_residual",
    "device_capture_residual",
    "device_tool_residual",
    "product_tool_residual",
    "voice_stt_residual",
    "voice_tts_residual",
    "cross_machine_copy_residual",
    "live_sms_residual",
    "live_webhook_residual",
    "live_voice_residual",
    "live_mail_claim_residual",
    "inbound_push_residual",
    "signin_fill_residual",
  ];
  const parts = [];
  for (const k of keys) {
    if (p[k] === true) parts.push("/" + k);
  }
  // CM-1104 honesty chip (not a residual key): surface when Host stripped widgets.
  if (p.widget_degraded === true) parts.push("/widget_degraded");
  // Nested CU outcome / vision residuals (append all open, like Desktop chips).
  const oc = p.outcome || {};
  if (oc.live_paid_residual === true && !parts.includes("/live_paid_residual"))
    parts.push("/live_paid_residual");
  if (oc.ocr_residual === true && !parts.includes("/ocr_residual"))
    parts.push("/ocr_residual");
  if (
    oc.os_window_automation_residual === true &&
    !parts.includes("/os_window_automation_residual")
  )
    parts.push("/os_window_automation_residual");
  if (
    oc.credential_browser_fill_residual === true &&
    !parts.includes("/credential_browser_fill_residual")
  )
    parts.push("/credential_browser_fill_residual");
  if (
    oc.signin_fill_residual === true &&
    !parts.includes("/signin_fill_residual")
  )
    parts.push("/signin_fill_residual");
  const g = p.gui || {};
  if (
    g.os_window_automation_residual === true &&
    !parts.includes("/os_window_automation_residual")
  )
    parts.push("/os_window_automation_residual");
  const vp = g.vision_plan || {};
  if (vp.ocr_residual === true && !parts.includes("/ocr_residual"))
    parts.push("/ocr_residual");
  // Do not conflate dry-run gate with remote_pr_residual (Host sets those separately).
  const rp = p.remote_pr || {};
  if (
    rp.real_create_gated === true &&
    p.remote_pr_residual !== true &&
    !parts.includes("/real_create_gated")
  ) {
    parts.push("/real_create_gated");
  }
  if (
    String(rp.mode || p.mode || "").includes("gh_pr_create_residual") &&
    p.remote_pr_residual !== true &&
    !parts.includes("/gh_pr_create_residual") &&
    !parts.includes("/remote_pr_residual")
  ) {
    parts.push("/gh_pr_create_residual");
  }
  return parts.join("");
}

function attachmentRole(kind, filePath) {
  const ext = String(filePath || "")
    .split(".")
    .pop()
    .toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "media";
  if (["wav", "mp3", "mp4", "webm"].includes(ext)) return "media";
  if (["html", "htm"].includes(ext)) return "html";
  if (ext === "pptx" || ext === "ics" || ext === "eml") return "openable";
  if (kind === "render_markdown") return "html";
  if (kind === "purchase") return "html";
  if (
    kind === "generate_image" ||
    kind === "generate_video" ||
    kind === "watch_video" ||
    kind === "structured_chart" ||
    kind === "screenshot" ||
    kind === "voice_session" ||
    kind === "voice_relay"
  ) {
    return "media";
  }
  if (
    kind === "slides_pptx" ||
    kind === "schedule_meeting" ||
    kind === "mail_send" ||
    kind === "mail_draft" ||
    kind === "skill_write" ||
    kind === "export_pack"
  ) {
    return "openable";
  }
  return "snap";
}

function extractDeliveryTypes(turnJsonText) {
  const types = [];
  const labels = [];
  const attachments = [];
  try {
    const lines = String(turnJsonText || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let raw = lines[lines.length - 1] || "";
    // Strip optional mobile permission-card trailer.
    const cut = raw.indexOf("/* bitbot_device_permission_cards */");
    if (cut >= 0) raw = raw.slice(0, cut).trim();
    // Prefer first turn JSON when HostAbi trailers follow.
    const firstObj = lines.find((l) => l.startsWith("{"));
    if (firstObj) raw = firstObj;
    if (!raw.startsWith("{")) {
      return { types, labels, attachments, ok: false };
    }
    const turn = JSON.parse(raw);
    const hrs = Array.isArray(turn.host_results) ? turn.host_results : [];
    for (const h of hrs) {
      if (!h) continue;
      let p = {};
      try {
        p = JSON.parse(h.stdout || "{}");
      } catch (_) {
        p = {};
      }
      // CHARTER Delivery: honest OAuth NeedsAuth must still surface as a widget
      // even when Host ok=false (never pretend Connected).
      const oauthNeedsAuth =
        h.kind === "oauth" &&
        (p.status === "NeedsAuth" ||
          p.mode === "live_needs_auth" ||
          p.mode === "live_remote_browser_open" ||
          p.mode === "live_code_exchange_failed" ||
          p.mode === "live_remote_callback_pending" ||
          (p.connected === false && p.pretend_connected === false));
      const sharedMemoryRefuse =
        h.kind === "shared_memory_read" && p.refused_cross_scope === true;
      // Failed webfetch with public_fallback_residual must still surface honesty chips.
      const webfetchFallbackResidual =
        h.kind === "webfetch" && p.public_fallback_residual === true;
      if (
        h.ok === false &&
        !oauthNeedsAuth &&
        !sharedMemoryRefuse &&
        !webfetchFallbackResidual
      )
        continue;
      const filePath = pickAttachmentPath(h.kind || "", p, h);
      if (h.kind === "delivery" && p.type) {
        types.push(p.type);
        labels.push("SendToUser:" + p.type);
        if (p.path || filePath) {
          attachments.push({
            kind: "delivery",
            path: p.path || filePath,
            role: attachmentRole("delivery", p.path || filePath),
          });
        }
      } else if (h.kind === "inbound_reaction" || h.kind === "react_message") {
        types.push("reaction");
        labels.push(
          "reaction:" +
            (p.emoji || "👍") +
            (h.kind === "react_message" && p.visible_pill === false
              ? "/off"
              : ""),
        );
      } else if (h.kind === "channel_send") {
        const t = p.thread_ts ? "thread" : "text";
        types.push(t);
        labels.push(
          "channel:" +
            (p.mode || p.scheme || "draft") +
            residualSuffix(p),
        );
      } else if (
        h.kind === "section_post" ||
        h.kind === "send_to_agent" ||
        h.kind === "subagent_run" ||
        h.kind === "room_turn"
      ) {
        const t =
          h.kind === "room_turn"
            ? "thread"
            : (p.send_to_user && p.send_to_user.type) || "text";
        types.push(t);
        labels.push(h.kind + residualSuffix(p));
      } else if (h.kind === "cloud_agent_launch") {
        types.push("cursor-agent");
        labels.push("cursor-agent" + residualSuffix(p));
      } else if (
        h.kind === "shared_memory_read" &&
        p.refused_cross_scope === true
      ) {
        types.push("widget");
        labels.push("shared_memory_read/refused_cross_scope");
      } else if (
        [
          "mail_send",
          "mail_draft",
          "mail_search",
          "mail_read",
          "slides_pptx",
          "skill_write",
          "export_pack",
          "schedule_meeting",
          "purchase",
          "mcp_call",
          "mcp_discover",
          "mcp_namespace",
          "credential_list",
          "code_changes",
          "section_add",
          "section_post",
          "source_control",
          "workflow_list",
          "x_search",
          "job_search",
          "finance_call",
          "copy_to_box",
          "copy_from_box",
          "shared_memory_put",
          "shared_memory_read",
          "journal_append",
          "connectors_probe",
          "device_tools_list",
          "device_tool",
          "skill_load",
          "mail_claim_inbox",
          "cloud_artifact_deliver",
          "teammate_create",
          "shell",
          "computer_use",
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
          "screenshot",
          "check_updates",
          "auto_review_settings",
          "box_chrome_probe",
          "mcp_uninstall",
          "mcp_get_plugin",
          "mcp_list_plugins",
          "journal_query",
          "fs_list",
          "fs_read",
          "webfetch",
          "machines_list",
          "routine_schedule",
          "routine_list",
          "routine_fire",
          "routine_tick",
          "routine_pause",
          "routine_resume",
          "memory_update",
          "memory_recall",
        ].includes(h.kind)
      ) {
        types.push("attachment");
        labels.push(
          h.kind +
            (filePath || p.path || p.artifact_path || h.path ? "/snap" : "") +
            residualSuffix(p),
        );
        if (filePath) {
          attachments.push({
            kind: h.kind,
            path: filePath,
            role: attachmentRole(h.kind, filePath),
          });
        }
      } else if (
        h.kind === "voice_session" ||
        h.kind === "voice_relay" ||
        h.kind === "voice_end_write" ||
        h.kind === "voice_end"
      ) {
        types.push("voice");
        labels.push(
          h.kind +
            (p.path || p.end_artifact_path || p.reply_media_path ? "/snap" : "") +
            residualSuffix(p),
        );
        if (filePath) {
          attachments.push({
            kind: h.kind,
            path: filePath,
            role: "media",
          });
        }
      } else if (h.kind === "approval_card") {
        types.push("widget");
        labels.push("widget:approval" + (p.path || filePath ? "/snap" : ""));
        if (p.path || filePath) {
          attachments.push({
            kind: h.kind,
            path: p.path || filePath,
            role: "snap",
          });
        }
      } else if (h.kind === "credential_fill") {
        // CHARTER CM-1106: secret-request card — vault only, never attachment.
        types.push("secret-request");
        labels.push(
          "secret-request:" +
            (p.vault_id || p.fill_handle || p.domain || "vault") +
            residualSuffix(p),
        );
      } else if (h.kind === "device_permission") {
        // CHARTER CM-0705: permission card is a widget, not a file attachment.
        types.push("widget");
        labels.push(
          "widget:device_permission:" +
            (p.tool || p.permission || "card") +
            (p.path || filePath ? "/snap" : "") +
            residualSuffix(p),
        );
        if (filePath) {
          attachments.push({
            kind: h.kind,
            path: filePath,
            role: attachmentRole(h.kind, filePath),
          });
        }
      } else if (h.kind === "oauth") {
        types.push("widget");
        const oauthLabel =
          p.status === "NeedsAuth" || oauthNeedsAuth
            ? "NeedsAuth"
            : p.mode || p.status || "card";
        labels.push(
          "oauth:" +
            oauthLabel +
            (p.path || filePath ? "/snap" : "") +
            residualSuffix(p),
        );
        if (p.path || filePath) {
          attachments.push({
            kind: h.kind,
            path: p.path || filePath,
            role: "snap",
          });
        }
      }
    }
    // CHARTER Delivery: channel_delivery plans (in_app / external) even when
    // no Host FFI effects ran — still a SendToUser surface decision.
    const cd = String(turn.channel_delivery || "").trim();
    if (cd) {
      if (cd === "in_app" || cd.startsWith("in_app")) {
        types.push("text");
        labels.push("channel_delivery:in_app");
      } else if (cd.startsWith("external:")) {
        types.push("text");
        labels.push("channel_delivery:" + cd);
      } else {
        types.push("text");
        labels.push("channel_delivery:" + cd);
      }
    }
    return {
      types: [...new Set(types)],
      labels,
      attachments,
      ok: Boolean(turn.ok),
      machine_kind: turn.machine_kind || "",
      channel_delivery: cd || "",
    };
  } catch (_) {
    return { types, labels, attachments, ok: false };
  }
}

function formatDeliveryStrip(summary) {
  if (!summary || !summary.labels || !summary.labels.length) {
    return "";
  }
  let strip =
    "\n[SendToUser " +
    (summary.types || []).join("|") +
    "] " +
    summary.labels.slice(0, 12).join(", ");
  const atts = summary.attachments || [];
  if (atts.length) {
    strip +=
      "\n[SendToUser attachments] " +
      atts
        .slice(0, 8)
        .map((a) => (a.kind || "?") + ":" + String(a.path || "").split("/").slice(-1)[0])
        .join(", ");
  }
  return strip;
}

module.exports = {
  extractDeliveryTypes,
  formatDeliveryStrip,
  pickAttachmentPath,
  attachmentRole,
  residualSuffix,
};
