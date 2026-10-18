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
  }

  private static let attachmentKinds: Set<String> = [
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
  ]

  private static func pickAttachmentPath(kind: String, p: [String: Any], h: [String: Any]) -> String {
    let keys = [
      "media_path", "frame_path", "html_path", "receipt_path",
      "pptx_path", "ics_path", "eml_path", "reply_media_path", "artifact_path",
    ]
    for k in keys {
      if let v = p[k] as? String, !v.isEmpty { return v }
    }
    let path = (p["path"] as? String) ?? (h["path"] as? String) ?? ""
    return path
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
    if ["slides_pptx", "schedule_meeting", "mail_send", "mail_draft"].contains(kind) {
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
      guard (h["ok"] as? Bool) != false else { continue }
      let kind = (h["kind"] as? String) ?? ""
      var p: [String: Any] = [:]
      if let stdout = h["stdout"] as? String,
         let sdata = stdout.data(using: .utf8),
         let obj = try? JSONSerialization.jsonObject(with: sdata) as? [String: Any] {
        p = obj
      }
      let filePath = pickAttachmentPath(kind: kind, p: p, h: h)
      let pathSuffix: String = filePath.isEmpty ? "" : "/snap"
      if kind == "delivery", let t = p["type"] as? String, !t.isEmpty {
        typeSet.insert(t)
        summary.labels.append("SendToUser:" + t)
        if !filePath.isEmpty {
          summary.attachments.append(
            Attachment(kind: "delivery", path: filePath, role: attachmentRole(kind: "delivery", filePath: filePath))
          )
        }
      } else if kind == "inbound_reaction" {
        typeSet.insert("reaction")
        let emoji = (p["emoji"] as? String) ?? "👍"
        summary.labels.append("reaction:" + emoji)
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
      } else if kind == "oauth" {
        typeSet.insert("widget")
        let mode = (p["mode"] as? String) ?? (p["status"] as? String) ?? "card"
        summary.labels.append("oauth:" + mode + pathSuffix)
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
