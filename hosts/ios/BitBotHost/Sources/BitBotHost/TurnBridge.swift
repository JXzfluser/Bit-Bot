import Foundation

/// ADR 0002 Host bridge: shells to repo `hosts/mobile_host/run.js` (same MoonBit brain as Desktop).
/// App Store builds embed this process boundary; device permissions stay in the Host.
enum TurnBridge {
  struct BridgeError: Error, LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  static func runTurn(text: String, machineKind: String = "ios") async throws -> String {
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
    return stdout.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func inferRepoRoot() -> String {
    // Dev: walk up from bundle / cwd looking for moon.mod.json
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
}
