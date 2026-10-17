package com.bitbot.host

import org.json.JSONArray
import org.json.JSONObject

/**
 * CHARTER Delivery — native Android Host SendToUser surface.
 * Mirrors `hosts/shared/send_to_user_surface.js`: summarize Host turn JSON into
 * delivery type chips without inventing content or live channel posts.
 */
object SendToUserSurface {
  data class Summary(
    val types: List<String> = emptyList(),
    val labels: List<String> = emptyList(),
    val ok: Boolean = false,
    val machineKind: String = "",
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
    "generate_image", "generate_video", "watch_video",
  )

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
      for (i in 0 until hrs.length()) {
        val h = hrs.optJSONObject(i) ?: continue
        if (h.has("ok") && !h.optBoolean("ok", true)) continue
        val kind = h.optString("kind")
        var p = JSONObject()
        val stdout = h.optString("stdout")
        if (stdout.isNotBlank()) {
          runCatching { p = JSONObject(stdout) }
        }
        val pathSuffix =
          if (p.optString("path").isNotBlank() || h.optString("path").isNotBlank()) "/snap"
          else ""
        when {
          kind == "delivery" && p.optString("type").isNotBlank() -> {
            typeSet += p.optString("type")
            labels += "SendToUser:" + p.optString("type")
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
          }
          kind == "voice_session" || kind == "voice_relay" || kind == "voice_end_write" -> {
            typeSet += "voice"
            labels += kind + pathSuffix
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
      Summary(
        types = typeSet.sorted(),
        labels = labels,
        ok = turn.optBoolean("ok", false),
        machineKind = turn.optString("machine_kind"),
      )
    }.getOrDefault(Summary())
  }

  fun formatStrip(summary: Summary): String {
    if (summary.labels.isEmpty()) return ""
    val types = summary.types.joinToString("|")
    val labels = summary.labels.take(12).joinToString(", ")
    return "\n[SendToUser $types] $labels"
  }
}
