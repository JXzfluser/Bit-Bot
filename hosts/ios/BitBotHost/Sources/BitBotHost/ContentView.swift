import SwiftUI

struct ContentView: View {
  @State private var input = "ListMachines"
  @State private var transcript = "Bit Bot iOS Host\nMachineKind=ios\nMoonBit brain via TurnBridge.\n"
  @State private var busy = false
  @State private var delivery = SendToUserSurface.Summary()

  /// Multi-end product quick actions — mirrors Desktop Plugins/Media/Voice/Box panels.
  /// Host only; MoonBit remains the product brain (ADR 0005).
  private let productActions: [(label: String, turn: String)] = [
    ("ListMachines", "ListMachines"),
    ("List plugins", "list plugins"),
    ("Get plugin", "get plugin plugin-slides"),
    ("Gen image", "generate image ios aurora"),
    ("Chart", "structured chart {\"alpha\":3,\"beta\":5}"),
    ("Voice start", "voice start ios-voice"),
    ("Box doctor", "box doctor"),
    ("Box env", "box env"),
    ("Chrome probe", "box chrome probe"),
  ]

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Bit Bot")
        .font(.largeTitle.bold())
      Text("iOS Host · MoonBit turn v:1")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      SendToUserChipRow(summary: delivery)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(productActions, id: \.label) { action in
            Button(action.label) {
              Task { await sendTurn(text: action.turn) }
            }
            .buttonStyle(.bordered)
            .disabled(busy)
          }
        }
      }
      TextEditor(text: $transcript)
        .font(.system(.body, design: .monospaced))
        .disabled(true)
      HStack {
        TextField("Turn text", text: $input)
          .textFieldStyle(.roundedBorder)
        Button(busy ? "…" : "Send") {
          Task { await sendTurn(text: input) }
        }
        .disabled(busy || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .padding()
  }

  @MainActor
  private func sendTurn(text: String) async {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    busy = true
    defer { busy = false }
    input = trimmed
    do {
      let json = try await TurnBridge.runTurn(text: trimmed, machineKind: "ios")
      let summary = SendToUserSurface.extract(fromTurnJSON: json)
      delivery = summary
      let strip = SendToUserSurface.formatStrip(summary)
      transcript += "\n> \(trimmed)\n\(json)\(strip)\n"
    } catch {
      transcript += "\n! \(error.localizedDescription)\n"
    }
  }
}
