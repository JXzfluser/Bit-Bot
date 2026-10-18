package com.bitbot.host

import org.json.JSONArray
import org.json.JSONObject

/**
 * CHARTER Delivery — native Android Host SendToUser surface.
 * Mirrors `hosts/shared/send_to_user_surface.js`: summarize Host turn JSON into
 * delivery type chips + concrete attachment paths without inventing content.
 */
object SendToUserSurface {
  data class Attachment(
    val kind: String,
    val path: String,
    val role: String,
  )

  data class Summary(
    val types: List<String> = emptyList(),
    val labels: List<String> = emptyList(),
    val attachments: List<Attachment> = emptyList(),
    val ok: Boolean = false,
    val machineKind: String = "",
    val channelDelivery: String = "",
  )

  private val attachmentKinds = setOf(
    "mail_send", "mail_draft", "mail_search", "mail_read",
    "slides_pptx", "skill_write", "export_pack", "schedule_meeting",
    "purchase", "mcp_call", "mcp_discover", "mcp_namespace",
    "credential_list", "credential_fill", "code_changes",
    "section_add", "section_post", "source_control", "workflow_list",
    "x_search", "job_search", "finance_call", "copy_to_box", "copy_from_box",
    "shared_memory_put", "shared_memory_read", "journal_append", "journal_query",
    "connectors_probe", "device_tools_list", "device_tool", "device_permission",
    "skill_load", "mail_claim_inbox", "cloud_artifact_deliver", "teammate_create",
    "shell", "computer_use",
    "generate_image", "generate_video", "watch_video", "structured_chart",
    "box_doctor", "box_env", "box_clock",
    "webhook_panel", "webhook_copy", "webhook_tool_read_key", "webhook_wake",
    "settings_open", "agent_info_panel", "delete_agent", "package_install",
    "shared_box_fs", "hide_agent", "list_agents_sidebar", "members_panel",
    "notify_settings", "set_notify", "update_computer", "reset_computer",
    "local_execution", "guide_permission", "render_markdown", "react_message",
    "screenshot", "check_updates", "auto_review_settings", "box_chrome_probe",
    "mcp_uninstall", "mcp_get_plugin", "mcp_list_plugins",
    // Multi-end parity with hosts/shared/send_to_user_surface.js
    "fs_list", "fs_read", "webfetch", "machines_list",
    "routine_schedule", "routine_list", "routine_fire", "routine_tick",
    "routine_pause", "routine_resume",
  )

  private fun pickAttachmentPath(kind: String, p: JSONObject, h: JSONObject): String {
    val keys = listOf(
      "media_path", "frame_path", "html_path", "receipt_path",
      "pptx_path", "ics_path", "eml_path", "reply_media_path",
      "skill_path", "export_path", "artifact_path",
    )
    for (k in keys) {
      val v = p.optString(k)
      if (v.isNotBlank()) return v
    }
    return p.optString("path").ifBlank { h.optString("path") }
  }

  private fun attachmentRole(kind: String, filePath: String): String {
    val ext = filePath.substringAfterLast('.', "").lowercase()
    if (ext in setOf("png", "jpg", "jpeg", "gif", "webp", "wav", "mp3", "mp4", "webm")) {
      return "media"
    }
    if (ext in setOf("html", "htm")) return "html"
    if (ext in setOf("pptx", "ics", "eml")) return "openable"
    if (kind == "render_markdown" || kind == "purchase") return "html"
    if (kind in setOf(
        "generate_image", "generate_video", "watch_video", "structured_chart",
        "screenshot", "voice_session", "voice_relay",
      )
    ) {
      return "media"
    }
    if (kind in setOf(
        "slides_pptx", "schedule_meeting", "mail_send", "mail_draft",
        "skill_write", "export_pack",
      )
    ) {
      return "openable"
    }
    return "snap"
  }

  fun extract(fromTurnJson: String): Summary {
    return runCatching {
      val lines = fromTurnJson.lineSequence()
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .toList()
      var raw = lines.lastOrNull { it.startsWith("{") } ?: ""
      val cut = raw.indexOf("/* bitbot_device_permission_cards */")
      if (cut >= 0) raw = raw.substring(0, cut).trim()
      // Prefer first turn JSON object when HostAbi trailers follow.
      lines.firstOrNull { it.startsWith("{") }?.let { raw = it }
      if (!raw.startsWith("{")) return Summary()
      val turn = JSONObject(raw)
      val hrs: JSONArray = turn.optJSONArray("host_results") ?: JSONArray()
      val typeSet = linkedSetOf<String>()
      val labels = mutableListOf<String>()
      val attachments = mutableListOf<Attachment>()
      for (i in 0 until hrs.length()) {
        val h = hrs.optJSONObject(i) ?: continue
        if (h.has("ok") && !h.optBoolean("ok", true)) continue
        val kind = h.optString("kind")
        var p = JSONObject()
        val stdout = h.optString("stdout")
        if (stdout.isNotBlank()) {
          runCatching { p = JSONObject(stdout) }
        }
        val filePath = pickAttachmentPath(kind, p, h)
        val pathSuffix = if (filePath.isNotBlank()) "/snap" else ""
        when {
          kind == "delivery" && p.optString("type").isNotBlank() -> {
            typeSet += p.optString("type")
            labels += "SendToUser:" + p.optString("type")
            if (filePath.isNotBlank()) {
              attachments += Attachment(
                kind = "delivery",
                path = filePath,
                role = attachmentRole("delivery", filePath),
              )
            }
          }
          kind == "inbound_reaction" -> {
            typeSet += "reaction"
            labels += "reaction:" + p.optString("emoji", "👍")
          }
          kind == "channel_send" -> {
            val t = if (p.optString("thread_ts").isNotBlank()) "thread" else "text"
            typeSet += t
            val mode = p.optString("mode").ifBlank { p.optString("scheme", "draft") }
            labels += "channel:$mode$pathSuffix"
          }
          kind == "section_post" || kind == "send_to_agent" ||
            kind == "subagent_run" || kind == "room_turn" -> {
            typeSet += if (kind == "room_turn") "thread" else "text"
            labels += kind + pathSuffix
          }
          kind == "cloud_agent_launch" -> {
            typeSet += "cursor-agent"
            labels += "cursor-agent$pathSuffix"
          }
          kind in attachmentKinds -> {
            typeSet += "attachment"
            labels += kind + pathSuffix
            if (filePath.isNotBlank()) {
              attachments += Attachment(
                kind = kind,
                path = filePath,
                role = attachmentRole(kind, filePath),
              )
            }
          }
          kind == "voice_session" || kind == "voice_relay" || kind == "voice_end_write" -> {
            typeSet += "voice"
            labels += kind + pathSuffix
            if (filePath.isNotBlank()) {
              attachments += Attachment(kind = kind, path = filePath, role = "media")
            }
          }
          kind == "approval_card" -> {
            typeSet += "widget"
            labels += "widget:approval$pathSuffix"
          }
          kind == "oauth" -> {
            typeSet += "widget"
            val mode = p.optString("mode").ifBlank { p.optString("status", "card") }
            labels += "oauth:$mode$pathSuffix"
          }
        }
      }
      // CHARTER Delivery: channel_delivery plans even without Host FFI effects.
      val cd = turn.optString("channel_delivery").trim()
      if (cd.isNotBlank()) {
        typeSet += "text"
        labels += if (cd == "in_app" || cd.startsWith("in_app")) {
          "channel_delivery:in_app"
        } else {
          "channel_delivery:$cd"
        }
      }
      Summary(
        types = typeSet.sorted(),
        labels = labels,
        attachments = attachments,
        ok = turn.optBoolean("ok", false),
        machineKind = turn.optString("machine_kind"),
        channelDelivery = cd,
      )
    }.getOrDefault(Summary())
  }

  fun formatStrip(summary: Summary): String {
    if (summary.labels.isEmpty()) return ""
    val types = summary.types.joinToString("|")
    val labels = summary.labels.take(12).joinToString(", ")
    var strip = "\n[SendToUser $types] $labels"
    if (summary.attachments.isNotEmpty()) {
      val atts = summary.attachments.take(8).joinToString(", ") { att ->
        val leaf = att.path.substringAfterLast('/')
        "${att.kind}:$leaf"
      }
      strip += "\n[SendToUser attachments] $atts"
    }
    return strip
  }
}
