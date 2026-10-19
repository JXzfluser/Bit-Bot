import Foundation
import SwiftUI

/// CHARTER Delivery — native iOS Host SendToUser surface.
/// Mirrors `hosts/shared/send_to_user_surface.js`: summarize Host turn JSON into
/// delivery type chips + concrete attachment paths without inventing content.
enum SendToUserSurface {
  struct Attachment: Identifiable, Equatable {
    let id = UUID()
    var kind: String
    var path: String
    var role: String
  }

  struct Summary {
    var types: [String] = []
    var labels: [String] = []
    var attachments: [Attachment] = []
    var ok: Bool = false
    var machineKind: String = ""
    var channelDelivery: String = ""
  }

  private static let attachmentKinds: Set<String> = [
    "mail_send", "mail_draft", "mail_search", "mail_read",
    "slides_pptx", "skill_write", "export_pack", "schedule_meeting",
    "purchase", "mcp_call", "mcp_discover", "mcp_namespace",
    "credential_list", "code_changes",
    "section_add", "section_post", "source_control", "workflow_list",
    "x_search", "x_post", "job_search", "finance_call", "copy_to_box", "copy_from_box",
    "shared_memory_put", "shared_memory_read", "journal_append", "journal_query",
    "connectors_probe", "device_tools_list", "device_tool",
    "skill_load", "list_skills", "mail_claim_inbox", "cloud_artifact_deliver", "teammate_create",
    "shell", "computer_use",
    "generate_image", "generate_video", "watch_video", "structured_chart",
    "box_doctor", "box_env", "box_clock", "todo_write",
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
  ]

  private static func pickAttachmentPath(kind: String, p: [String: Any], h: [String: Any]) -> String {
    let keys = [
      "media_path", "frame_path", "html_path", "receipt_path",
      "pptx_path", "ics_path", "eml_path", "reply_media_path",
      "skill_path", "export_path", "artifact_path",
    ]
    for k in keys {
      if let v = p[k] as? String, !v.isEmpty { return v }
    }
    let path = (p["path"] as? String) ?? (h["path"] as? String) ?? ""
    return path
  }

  private static func residualSuffix(_ p: [String: Any]) -> String {
    let keys = [
      "live_mail_residual", "live_x_residual", "live_x_post_residual", "live_job_residual",
      "live_finance_residual", "live_paid_residual", "live_calendar_residual",
      "live_slack_residual", "live_teams_residual", "live_meeting_residual",
      "live_channel_residual",
      "live_sms_residual", "live_webhook_residual", "live_voice_residual",
      "live_mail_claim_residual", "inbound_turn_residual", "inbound_push_residual",
      "box_doctor_bin_residual", "box_chrome_bin_residual",
      "long_lived_cron_residual", "remote_cloud_residual",
      "remote_cloud_artifact_residual", "code_apply_residual",
      "git_commit_residual", "git_push_residual",
      "screenshot_residual", "remote_pr_residual", "gh_pr_create_residual",
      "public_fallback_residual",
      "ocr_residual", "os_window_automation_residual",
      "interactive_oauth_residual", "true_device_os_dialog_residual",
      "credential_browser_fill_residual", "signin_fill_residual",
      "device_capture_residual", "device_tool_residual", "product_tool_residual",
      "voice_stt_residual", "voice_tts_residual", "voice_end_match_residual",
      "cross_machine_copy_residual",
    ]
    if let hit = keys.first(where: { (p[$0] as? Bool) == true }) {
      let base = "/" + hit
      if (p["widget_degraded"] as? Bool) == true {
        return base + "/widget_degraded"
      }
      return base
    }
    if (p["widget_degraded"] as? Bool) == true {
      return "/widget_degraded"
    }
    if let oc = p["outcome"] as? [String: Any] {
      if (oc["live_paid_residual"] as? Bool) == true { return "/live_paid_residual" }
      if (oc["ocr_residual"] as? Bool) == true { return "/ocr_residual" }
    }
    if let g = p["gui"] as? [String: Any] {
      if (g["os_window_automation_residual"] as? Bool) == true {
        return "/os_window_automation_residual"
      }
      if let vp = g["vision_plan"] as? [String: Any],
         (vp["ocr_residual"] as? Bool) == true {
        return "/ocr_residual"
      }
    }
    let rp = p["remote_pr"] as? [String: Any] ?? [:]
    let mode = String(describing: rp["mode"] ?? p["mode"] ?? "")
    if (p["remote_pr_residual"] as? Bool) == true {
      return "/remote_pr_residual"
    }
    if (rp["real_create_gated"] as? Bool) == true {
      return "/real_create_gated"
    }
    if mode.contains("gh_pr_create_residual") {
      return "/gh_pr_create_residual"
    }
    return ""
  }

  private static func attachmentRole(kind: String, filePath: String) -> String {
    let ext = (filePath as NSString).pathExtension.lowercased()
    if ["png", "jpg", "jpeg", "gif", "webp", "wav", "mp3", "mp4", "webm"].contains(ext) {
      return "media"
    }
    if ["html", "htm"].contains(ext) { return "html" }
    if ["pptx", "ics", "eml"].contains(ext) { return "openable" }
    if kind == "render_markdown" || kind == "purchase" { return "html" }
    if [
      "generate_image", "generate_video", "watch_video", "structured_chart",
      "screenshot", "voice_session", "voice_relay",
    ].contains(kind) {
      return "media"
    }
    if ["slides_pptx", "schedule_meeting", "mail_send", "mail_draft", "skill_write", "export_pack"].contains(kind) {
      return "openable"
    }
    return "snap"
  }

  static func extract(fromTurnJSON jsonText: String) -> Summary {
    var summary = Summary()
    let lines = jsonText
      .split(whereSeparator: \.isNewline)
      .map { String($0).trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    var raw = lines.last(where: { $0.hasPrefix("{") }) ?? ""
    if let cut = raw.range(of: "/* bitbot_device_permission_cards */") {
      raw = String(raw[..<cut.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    // Prefer the first turn JSON object when trailers follow.
    if let first = lines.first(where: { $0.hasPrefix("{") }) {
      raw = first
    }
    guard let data = raw.data(using: .utf8),
          let turn = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return summary }
    summary.ok = (turn["ok"] as? Bool) ?? false
    summary.machineKind = (turn["machine_kind"] as? String) ?? ""
    let hrs = (turn["host_results"] as? [[String: Any]]) ?? []
    var typeSet = Set<String>()
    for h in hrs {
      let kind = (h["kind"] as? String) ?? ""
      var p: [String: Any] = [:]
      if let stdout = h["stdout"] as? String,
         let sdata = stdout.data(using: .utf8),
         let obj = try? JSONSerialization.jsonObject(with: sdata) as? [String: Any] {
        p = obj
      }
      let oauthNeedsAuth =
        kind == "oauth" &&
        ((p["status"] as? String) == "NeedsAuth" ||
          (p["mode"] as? String) == "live_needs_auth" ||
          (p["mode"] as? String) == "live_remote_browser_open" ||
          ((p["connected"] as? Bool) == false && (p["pretend_connected"] as? Bool) != true))
      if (h["ok"] as? Bool) == false && !oauthNeedsAuth { continue }
      let filePath = pickAttachmentPath(kind: kind, p: p, h: h)
      let pathSuffix: String = (filePath.isEmpty ? "" : "/snap") + residualSuffix(p)
      if kind == "delivery", let t = p["type"] as? String, !t.isEmpty {
        typeSet.insert(t)
        summary.labels.append("SendToUser:" + t)
        if !filePath.isEmpty {
          summary.attachments.append(
            Attachment(kind: "delivery", path: filePath, role: attachmentRole(kind: "delivery", filePath: filePath))
          )
        }
      } else if kind == "inbound_reaction" || kind == "react_message" {
        typeSet.insert("reaction")
        let emoji = (p["emoji"] as? String) ?? "👍"
        let off = kind == "react_message" && (p["visible_pill"] as? Bool) == false
        summary.labels.append("reaction:" + emoji + (off ? "/off" : ""))
      } else if kind == "channel_send" {
        let t = (p["thread_ts"] as? String)?.isEmpty == false ? "thread" : "text"
        typeSet.insert(t)
        let mode = (p["mode"] as? String) ?? (p["scheme"] as? String) ?? "draft"
        summary.labels.append("channel:" + mode + pathSuffix)
      } else if kind == "section_post" || kind == "send_to_agent" || kind == "subagent_run" || kind == "room_turn" {
        let t = kind == "room_turn" ? "thread" : "text"
        typeSet.insert(t)
        summary.labels.append(kind + pathSuffix)
      } else if kind == "cloud_agent_launch" {
        typeSet.insert("cursor-agent")
        summary.labels.append("cursor-agent" + pathSuffix)
      } else if attachmentKinds.contains(kind) {
        typeSet.insert("attachment")
        summary.labels.append(kind + pathSuffix)
        if !filePath.isEmpty {
          summary.attachments.append(
            Attachment(kind: kind, path: filePath, role: attachmentRole(kind: kind, filePath: filePath))
          )
        }
      } else if kind == "voice_session" || kind == "voice_relay" || kind == "voice_end_write" {
        typeSet.insert("voice")
        summary.labels.append(kind + pathSuffix)
        if !filePath.isEmpty {
          summary.attachments.append(
            Attachment(kind: kind, path: filePath, role: "media")
          )
        }
      } else if kind == "approval_card" {
        typeSet.insert("widget")
        summary.labels.append("widget:approval" + pathSuffix)
        if !filePath.isEmpty {
          summary.attachments.append(
            Attachment(kind: kind, path: filePath, role: "snap")
          )
        }
      } else if kind == "credential_fill" {
        // CHARTER CM-1106: secret-request — vault only, never attachment.
        typeSet.insert("secret-request")
        let handle = (p["vault_id"] as? String)
          ?? (p["fill_handle"] as? String)
          ?? (p["domain"] as? String)
          ?? "vault"
        summary.labels.append("secret-request:" + handle + pathSuffix)
      } else if kind == "device_permission" {
        typeSet.insert("widget")
        let tool = (p["tool"] as? String) ?? (p["permission"] as? String) ?? "card"
        summary.labels.append("widget:device_permission:" + tool + pathSuffix)
        if !filePath.isEmpty {
          summary.attachments.append(
            Attachment(kind: kind, path: filePath, role: attachmentRole(kind: kind, filePath: filePath))
          )
        }
      } else if kind == "oauth" {
        typeSet.insert("widget")
        let mode: String
        if (p["status"] as? String) == "NeedsAuth" || oauthNeedsAuth {
          mode = "NeedsAuth"
        } else {
          mode = (p["mode"] as? String) ?? (p["status"] as? String) ?? "card"
        }
        summary.labels.append("oauth:" + mode + pathSuffix)
        if !filePath.isEmpty {
          summary.attachments.append(
            Attachment(kind: kind, path: filePath, role: "snap")
          )
        }
      }
    }
    // CHARTER Delivery: channel_delivery plans even without Host FFI effects.
    let cd = ((turn["channel_delivery"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    summary.channelDelivery = cd
    if !cd.isEmpty {
      typeSet.insert("text")
      if cd == "in_app" || cd.hasPrefix("in_app") {
        summary.labels.append("channel_delivery:in_app")
      } else {
        summary.labels.append("channel_delivery:" + cd)
      }
    }
    summary.types = Array(typeSet).sorted()
    return summary
  }

  static func formatStrip(_ summary: Summary) -> String {
    guard !summary.labels.isEmpty else { return "" }
    let types = summary.types.joined(separator: "|")
    let labels = summary.labels.prefix(12).joined(separator: ", ")
    var strip = "\n[SendToUser \(types)] \(labels)"
    if !summary.attachments.isEmpty {
      let atts = summary.attachments.prefix(8).map { att in
        let leaf = (att.path as NSString).lastPathComponent
        return "\(att.kind):\(leaf)"
      }.joined(separator: ", ")
      strip += "\n[SendToUser attachments] \(atts)"
    }
    return strip
  }
}

/// Compact chip row for native iOS Host transcript (CHARTER Delivery types + paths).
struct SendToUserChipRow: View {
  let summary: SendToUserSurface.Summary

  var body: some View {
    if !summary.labels.isEmpty || !summary.attachments.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        if !summary.labels.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
              ForEach(Array(summary.labels.prefix(12).enumerated()), id: \.offset) { _, label in
                Text(label)
                  .font(.caption.monospaced())
                  .padding(.horizontal, 8)
                  .padding(.vertical, 4)
                  .background(Color.secondary.opacity(0.15))
                  .clipShape(RoundedRectangle(cornerRadius: 6))
              }
            }
          }
        }
        if !summary.attachments.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
              ForEach(summary.attachments.prefix(8)) { att in
                let leaf = (att.path as NSString).lastPathComponent
                Text("\(att.role):\(leaf)")
                  .font(.caption2.monospaced())
                  .padding(.horizontal, 8)
                  .padding(.vertical, 4)
                  .background(Color.accentColor.opacity(0.12))
                  .clipShape(RoundedRectangle(cornerRadius: 6))
              }
            }
          }
          .accessibilityLabel("SendToUser attachments")
        }
      }
      .accessibilityLabel("SendToUser \(summary.types.joined(separator: " "))")
    }
  }
}
