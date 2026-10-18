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
    "credential_list", "code_changes",
    "section_add", "section_post", "source_control", "workflow_list",
    "x_search", "job_search", "finance_call", "copy_to_box", "copy_from_box",
    "shared_memory_put", "shared_memory_read", "journal_append", "journal_query",
    "connectors_probe", "device_tools_list", "device_tool",
    "skill_load", "mail_claim_inbox", "cloud_artifact_deliver", "teammate_create",
    "shell", "computer_use",
    "generate_image", "generate_video", "watch_video", "structured_chart",
    "box_doctor", "box_env", "box_clock",
    "webhook_panel", "webhook_copy", "webhook_tool_read_key", "webhook_wake",
    "settings_open", "agent_info_panel", "delete_agent", "package_install",
    "shared_box_fs", "hide_agent", "list_agents_sidebar", "members_panel",
    "notify_settings", "set_notify", "update_computer", "reset_computer",
    "local_execution", "guide_permission", "render_markdown",
    "screenshot", "check_updates", "auto_review_settings", "box_chrome_probe",
    "mcp_uninstall", "mcp_get_plugin", "mcp_list_plugins",
    // Multi-end parity with hosts/shared/send_to_user_surface.js
    "fs_list", "fs_read", "webfetch", "machines_list",
    "routine_schedule", "routine_list", "routine_fire", "routine_tick",
    "routine_pause", "routine_resume",
    "memory_update", "memory_recall",
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

  private fun residualSuffix(p: JSONObject): String {
    val keys = listOf(
      "live_mail_residual", "live_x_residual", "live_job_residual",
      "live_finance_residual", "live_paid_residual", "live_calendar_residual",
      "live_slack_residual", "live_teams_residual", "live_meeting_residual",
      "live_channel_residual",
      "live_sms_residual", "live_webhook_residual", "live_voice_residual",
      "live_mail_claim_residual", "inbound_turn_residual", "inbound_push_residual",
      "box_doctor_bin_residual", "box_chrome_bin_residual",
      "long_lived_cron_residual", "remote_cloud_residual", "code_apply_residual",
      "screenshot_residual", "remote_pr_residual", "gh_pr_create_residual",
      "public_fallback_residual",
      "ocr_residual", "os_window_automation_residual",
      "interactive_oauth_residual", "true_device_os_dialog_residual",
      "credential_browser_fill_residual", "signin_fill_residual",
      "device_capture_residual", "device_tool_residual", "product_tool_residual",
      "voice_stt_residual", "voice_tts_residual", "cross_machine_copy_residual",
    )
    for (k in keys) {
      if (p.optBoolean(k, false)) {
        val base = "/$k"
        return if (p.optBoolean("widget_degraded", false)) "$base/widget_degraded" else base
      }
    }
    if (p.optBoolean("widget_degraded", false)) return "/widget_degraded"
    val oc = p.optJSONObject("outcome")
    if (oc != null) {
      if (oc.optBoolean("live_paid_residual", false)) return "/live_paid_residual"
      if (oc.optBoolean("ocr_residual", false)) return "/ocr_residual"
    }
    val g = p.optJSONObject("gui")
    if (g != null) {
      if (g.optBoolean("os_window_automation_residual", false)) {
        return "/os_window_automation_residual"
      }
      val vp = g.optJSONObject("vision_plan")
      if (vp != null && vp.optBoolean("ocr_residual", false)) {
        return "/ocr_residual"
      }
    }
    if (p.optBoolean("remote_pr_residual", false)) return "/remote_pr_residual"
    val rp = p.optJSONObject("remote_pr")
    val mode = (rp?.optString("mode") ?: p.optString("mode") ?: "")
    if (rp != null && rp.optBoolean("real_create_gated", false)) {
      return "/real_create_gated"
    }
    if (mode.contains("gh_pr_create_residual")) {
      return "/gh_pr_create_residual"
    }
    return ""
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
        val kind = h.optString("kind")
        var p = JSONObject()
        val stdout = h.optString("stdout")
        if (stdout.isNotBlank()) {
          runCatching { p = JSONObject(stdout) }
        }
        val oauthNeedsAuth =
          kind == "oauth" &&
            (p.optString("status") == "NeedsAuth" ||
              p.optString("mode") == "live_needs_auth" ||
              p.optString("mode") == "live_remote_browser_open" ||
              (!p.optBoolean("connected", true) && !p.optBoolean("pretend_connected", false)))
        if (h.has("ok") && !h.optBoolean("ok", true) && !oauthNeedsAuth) continue
        val filePath = pickAttachmentPath(kind, p, h)
        val pathSuffix = (if (filePath.isNotBlank()) "/snap" else "") + residualSuffix(p)
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
          kind == "inbound_reaction" || kind == "react_message" -> {
            typeSet += "reaction"
            val off = kind == "react_message" && p.has("visible_pill") && !p.optBoolean("visible_pill", true)
            labels += "reaction:" + p.optString("emoji", "👍") + if (off) "/off" else ""
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
            if (filePath.isNotBlank()) {
              attachments += Attachment(kind = kind, path = filePath, role = "snap")
            }
          }
          kind == "credential_fill" -> {
            // CHARTER CM-1106: secret-request — vault only, never attachment.
            typeSet += "secret-request"
            val handle = p.optString("vault_id").ifBlank {
              p.optString("fill_handle").ifBlank { p.optString("domain", "vault") }
            }
            labels += "secret-request:$handle$pathSuffix"
          }
          kind == "device_permission" -> {
            typeSet += "widget"
            val tool = p.optString("tool").ifBlank { p.optString("permission", "card") }
            labels += "widget:device_permission:$tool$pathSuffix"
            if (filePath.isNotBlank()) {
              attachments += Attachment(
                kind = kind,
                path = filePath,
                role = attachmentRole(kind, filePath),
              )
            }
          }
          kind == "oauth" -> {
            typeSet += "widget"
            val mode =
              if (p.optString("status") == "NeedsAuth" || oauthNeedsAuth) {
                "NeedsAuth"
              } else {
                p.optString("mode").ifBlank { p.optString("status", "card") }
              }
            labels += "oauth:$mode$pathSuffix"
            if (filePath.isNotBlank()) {
              attachments += Attachment(kind = kind, path = filePath, role = "snap")
            }
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
