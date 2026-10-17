"use strict";

/**
 * CHARTER Delivery — shared SendToUser surface helper for Desktop/iOS/Android Hosts.
 * Summarizes Host turn JSON into delivery type chips without inventing content.
 */

function extractDeliveryTypes(turnJsonText) {
  const types = [];
  const labels = [];
  try {
    const lines = String(turnJsonText || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    let raw = lines[lines.length - 1] || "";
    // Strip optional mobile permission-card trailer.
    const cut = raw.indexOf("/* bitbot_device_permission_cards */");
    if (cut >= 0) raw = raw.slice(0, cut).trim();
    if (!raw.startsWith("{")) {
      return { types, labels, ok: false };
    }
    const turn = JSON.parse(raw);
    const hrs = Array.isArray(turn.host_results) ? turn.host_results : [];
    for (const h of hrs) {
      if (!h || !h.ok) continue;
      let p = {};
      try {
        p = JSON.parse(h.stdout || "{}");
      } catch (_) {
        p = {};
      }
      if (h.kind === "delivery" && p.type) {
        types.push(p.type);
        labels.push("SendToUser:" + p.type);
      } else if (h.kind === "inbound_reaction") {
        types.push("reaction");
        labels.push("reaction:" + (p.emoji || "👍"));
      } else if (h.kind === "channel_send") {
        types.push(p.live_post ? "text" : "thread");
        labels.push("channel:" + (p.mode || p.scheme || "draft"));
      } else if (
        [
          "mail_send",
          "mail_search",
          "slides_pptx",
          "skill_write",
          "export_pack",
          "schedule_meeting",
          "purchase",
          "mcp_call",
          "credential_list",
          "code_changes",
          "section_add",
        ].includes(h.kind)
      ) {
        types.push("attachment");
        labels.push(h.kind);
      } else if (h.kind === "voice_session" || h.kind === "voice_relay") {
        types.push("voice");
        labels.push(h.kind);
      } else if (h.kind === "approval_card") {
        types.push("widget");
        labels.push("widget:approval");
      }
    }
    return {
      types: [...new Set(types)],
      labels,
      ok: Boolean(turn.ok),
      machine_kind: turn.machine_kind || "",
    };
  } catch (_) {
    return { types, labels, ok: false };
  }
}

function formatDeliveryStrip(summary) {
  if (!summary || !summary.labels || !summary.labels.length) {
    return "";
  }
  return (
    "\n[SendToUser " +
    (summary.types || []).join("|") +
    "] " +
    summary.labels.slice(0, 12).join(", ")
  );
}

module.exports = {
  extractDeliveryTypes,
  formatDeliveryStrip,
};
