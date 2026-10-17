import Foundation
#if canImport(AVFoundation)
import AVFoundation
#endif

/// CM-0705 Host-side OS permission card / Settings guide.
/// Never pretend-grants. True system dialogs require a device/simulator run.
enum DevicePermissionHost {
  struct Card: Codable {
    let machineId: String
    let tool: String
    let permission: String
    let pretendGranted: Bool
    let status: String
    let settingsGuide: String
    let at: String
  }

  /// Parse `machine|tool|permission` from MoonBit `device_permission` effect command.
  static func parseCommand(_ command: String) -> (machineId: String, tool: String, permission: String) {
    let parts = command.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
    return (
      parts.count > 0 ? parts[0] : "phone-ios",
      parts.count > 1 ? parts[1] : "unknown",
      parts.count > 2 ? parts[2] : "needs_permission"
    )
  }

  /// Probe OS auth status without elevating; returns a Host card (pretend_granted=false).
  static func raiseCard(command: String) -> Card {
    let parsed = parseCommand(command)
    let status = probeStatus(tool: parsed.tool)
    return Card(
      machineId: parsed.machineId,
      tool: parsed.tool,
      permission: parsed.permission,
      pretendGranted: false,
      status: status,
      settingsGuide: "Open iOS Settings → Bit Bot → enable \(parsed.tool)",
      at: ISO8601DateFormatter().string(from: Date())
    )
  }

  private static func probeStatus(tool: String) -> String {
    let t = tool.lowercased()
#if canImport(AVFoundation)
    if t.contains("camera") || t.contains("mic") || t.contains("microphone") {
      let media: AVMediaType = t.contains("mic") ? .audio : .video
      switch AVCaptureDevice.authorizationStatus(for: media) {
      case .authorized: return "authorized"
      case .denied: return "denied"
      case .restricted: return "restricted"
      case .notDetermined: return "not_determined"
      @unknown default: return "unknown"
      }
    }
#endif
    return "host_card_pending_system_prompt"
  }

  /// Extract device_permission effects/results from a turn JSON line and build cards.
  static func cards(fromTurnJSON jsonLine: String) -> [Card] {
    guard let data = jsonLine.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [] }
    var commands: [String] = []
    if let hrs = obj["host_results"] as? [[String: Any]] {
      for h in hrs where (h["kind"] as? String) == "device_permission" {
        if let c = h["command"] as? String { commands.append(c) }
      }
    }
    if commands.isEmpty, let effects = obj["effects"] as? [[String: Any]] {
      for e in effects where (e["kind"] as? String) == "device_permission" {
        if let c = e["command"] as? String { commands.append(c) }
      }
    }
    return commands.map { raiseCard(command: $0) }
  }
}
