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
    /// Host FFI per-card JSON path when present (`data/device/permission-cards/`).
    let cardPath: String?
    let trueDeviceOsDialogResidual: Bool
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
  static func raiseCard(
    command: String,
    cardPath: String? = nil,
    pretendGranted: Bool = false,
    trueDeviceOsDialogResidual: Bool = true
  ) -> Card {
    let parsed = parseCommand(command)
    let status = probeStatus(tool: parsed.tool)
    return Card(
      machineId: parsed.machineId,
      tool: parsed.tool,
      permission: parsed.permission,
      pretendGranted: pretendGranted,
      status: status,
      settingsGuide: "Open iOS Settings → Bit Bot → enable \(parsed.tool)",
      cardPath: cardPath,
      trueDeviceOsDialogResidual: trueDeviceOsDialogResidual,
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
    // Prefer first JSON object line (HostAbi trailers may follow).
    let line =
      jsonLine
      .split(whereSeparator: \.isNewline)
      .map(String.init)
      .first(where: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("{") })
      ?? jsonLine
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [] }
    var cards: [Card] = []
    func collect(_ key: String) {
      guard let rows = obj[key] as? [[String: Any]] else { return }
      for h in rows where (h["kind"] as? String) == "device_permission" {
        guard let c = h["command"] as? String else { continue }
        var cardPath: String? = nil
        var pretend = false
        var residual = true
        if let stdout = h["stdout"] as? String,
           let sdata = stdout.data(using: .utf8),
           let payload = try? JSONSerialization.jsonObject(with: sdata) as? [String: Any] {
          cardPath = payload["path"] as? String
          pretend = (payload["pretend_granted"] as? Bool) ?? false
          residual = (payload["true_device_os_dialog_residual"] as? Bool) ?? true
        }
        cards.append(
          raiseCard(
            command: c,
            cardPath: cardPath,
            pretendGranted: pretend,
            trueDeviceOsDialogResidual: residual
          )
        )
      }
    }
    collect("host_results")
    if cards.isEmpty { collect("effects") }
    return cards
  }
}
