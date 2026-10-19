import Foundation

/// ADR 0002 Host bridge.
/// Product path: POST Desktop shared-brain `/v1/turn` (open-config BITBOT_HOST_URL).
/// Prefer UserDefaults「凭证」over env; never hardcode secrets.
/// Dev fallback: `node hosts/mobile_host/run.js` when repo is present on Mac.
enum TurnBridge {
  private static let hostUrlDefaultsKey = "BITBOT_HOST_URL"

  struct BridgeError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  static func configuredHostURL() -> String? {
    let prefs = UserDefaults.standard.string(forKey: hostUrlDefaultsKey)?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !prefs.isEmpty { return prefs }
    return hostBaseURLFromEnv()
  }

  static func setHostURL(_ url: String?) {
    let trimmed = (url ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      UserDefaults.standard.removeObject(forKey: hostUrlDefaultsKey)
    } else {
      UserDefaults.standard.set(trimmed, forKey: hostUrlDefaultsKey)
    }
  }

  static func runTurn(text: String, machineKind: String = "ios") async throws -> String {
    if let host = configuredHostURL() {
      do {
        return try await runTurnHttp(base: host, text: text, machineKind: machineKind)
      } catch {
        // Dev Mac with checkout: fall back to local node
        if FileManager.default.fileExists(
          atPath: URL(fileURLWithPath: inferRepoRoot())
            .appendingPathComponent("hosts/mobile_host/run.js").path
        ) {
          return try await runTurnLocal(text: text, machineKind: machineKind)
        }
        throw error
      }
    }
    return try await runTurnLocal(text: text, machineKind: machineKind)
  }

  private static func hostBaseURLFromEnv() -> String? {
    if let env = ProcessInfo.processInfo.environment["BITBOT_HOST_URL"], !env.isEmpty {
      return env
    }
    if let env = ProcessInfo.processInfo.environment["BITBOT_TURN_URL"], !env.isEmpty {
      return env
    }
    // Simulator → host Desktop inbound default
    #if targetEnvironment(simulator)
    return "http://127.0.0.1:18765"
    #else
    return nil
    #endif
  }

  private static func runTurnHttp(base: String, text: String, machineKind: String) async throws -> String {
    var root = base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if root.hasSuffix("/v1/turn") == false {
      root += "/v1/turn"
    }
    guard let url = URL(string: root.hasPrefix("http") ? root : "http://\(root)") else {
      throw BridgeError(message: "invalid BITBOT_HOST_URL")
    }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.timeoutInterval = 120
    let body: [String: Any] = [
      "text": text,
      "machine_kind": machineKind,
      "session_id": "ios-app",
    ]
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, resp) = try await URLSession.shared.data(for: req)
    let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
    let out = String(data: data, encoding: .utf8) ?? ""
    guard (200..<300).contains(code) else {
      throw BridgeError(message: "turn HTTP \(code): \(out)")
    }
    let trimmed = out.trimmingCharacters(in: .whitespacesAndNewlines)
    let cards = DevicePermissionHost.cards(fromTurnJSON: trimmed)
    if cards.isEmpty { return trimmed }
    if let encoded = try? JSONEncoder().encode(cards),
       let cardsJson = String(data: encoded, encoding: .utf8) {
      return trimmed + "\n/* bitbot_device_permission_cards */\n" + cardsJson
    }
    return trimmed
  }

  private static func runTurnLocal(text: String, machineKind: String) async throws -> String {
    let envRoot = ProcessInfo.processInfo.environment["BITBOT_REPO_ROOT"]
    let repoRoot = envRoot ?? inferRepoRoot()
    let runner = URL(fileURLWithPath: repoRoot)
      .appendingPathComponent("hosts/mobile_host/run.js").path

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = [
      "node", runner,
      "--machine-kind", machineKind,
      "--session-id", "ios-app",
      text,
    ]
    process.currentDirectoryURL = URL(fileURLWithPath: repoRoot)
    let out = Pipe()
    let err = Pipe()
    process.standardOutput = out
    process.standardError = err
    try process.run()
    process.waitUntilExit()
    let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    if process.terminationStatus != 0 {
      throw BridgeError(message: stderr.isEmpty ? "turn failed (\(process.terminationStatus))" : stderr)
    }
    let trimmed = stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    let cards = DevicePermissionHost.cards(fromTurnJSON: trimmed)
    if cards.isEmpty {
      return trimmed
    }
    if let data = try? JSONEncoder().encode(cards),
       let cardsJson = String(data: data, encoding: .utf8) {
      return trimmed + "\n/* bitbot_device_permission_cards */\n" + cardsJson
    }
    return trimmed
  }

  private static func inferRepoRoot() -> String {
    var url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    for _ in 0..<8 {
      let probe = url.appendingPathComponent("moon.mod.json")
      if FileManager.default.fileExists(atPath: probe.path) {
        return url.path
      }
      url.deleteLastPathComponent()
    }
    return FileManager.default.currentDirectoryPath
  }

  /// Prefer final assistant message from turn JSON (post Host llm_chat continue).
  static func assistantText(fromTurnJSON raw: String) -> String? {
    let line =
      raw
      .split(whereSeparator: \.isNewline)
      .map(String.init)
      .first(where: { $0.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{") })
      ?? raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let messages = obj["messages"] as? [[String: Any]]
    else { return nil }
    let assistants = messages.compactMap { m -> String? in
      guard (m["role"] as? String) == "assistant",
            let text = m["text"] as? String,
            !text.isEmpty
      else { return nil }
      return text
    }
    return assistants.last
  }
}
