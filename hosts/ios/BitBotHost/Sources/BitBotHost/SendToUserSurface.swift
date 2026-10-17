import Foundation
import SwiftUI

/// CHARTER Delivery — native iOS Host SendToUser surface.
/// Mirrors `hosts/shared/send_to_user_surface.js`: summarize Host turn JSON into
/// delivery type chips without inventing content or live channel posts.
enum SendToUserSurface {
  struct Summary {
    var types: [String] = []
    var labels: [String] = []
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
  ]

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
      let pathSuffix: String = {
        if let path = p["path"] as? String, !path.isEmpty {
          return "/snap"
        }
        if let path = h["path"] as? String, !path.isEmpty {
          return "/snap"
        }
        return ""
      }()
      if kind == "delivery", let t = p["type"] as? String, !t.isEmpty {
        typeSet.insert(t)
        summary.labels.append("SendToUser:" + t)
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
      } else if kind == "voice_session" || kind == "voice_relay" || kind == "voice_end_write" {
        typeSet.insert("voice")
        summary.labels.append(kind + pathSuffix)
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
    return "\n[SendToUser \(types)] \(labels)"
  }
}

/// Compact chip row for native iOS Host transcript (CHARTER Delivery types).
struct SendToUserChipRow: View {
  let summary: SendToUserSurface.Summary

  var body: some View {
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
      .accessibilityLabel("SendToUser \(summary.types.joined(separator: " "))")
    }
  }
}
