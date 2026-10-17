import SwiftUI

struct ContentView: View {
  @State private var input = "ListMachines"
  @State private var transcript = "Bit Bot iOS Host\nMachineKind=ios\nMoonBit brain via TurnBridge.\n"
  @State private var busy = false
  @State private var delivery = SendToUserSurface.Summary()

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Bit Bot")
        .font(.largeTitle.bold())
      Text("iOS Host · MoonBit turn v:1")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      SendToUserChipRow(summary: delivery)
      TextEditor(text: $transcript)
        .font(.system(.body, design: .monospaced))
        .disabled(true)
      HStack {
        TextField("Turn text", text: $input)
          .textFieldStyle(.roundedBorder)
        Button(busy ? "…" : "Send") {
          Task { await sendTurn() }
        }
        .disabled(busy || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .padding()
  }

  @MainActor
  private func sendTurn() async {
    busy = true
    defer { busy = false }
    do {
      let json = try await TurnBridge.runTurn(text: input, machineKind: "ios")
      let summary = SendToUserSurface.extract(fromTurnJSON: json)
      delivery = summary
      let strip = SendToUserSurface.formatStrip(summary)
      transcript += "\n> \(input)\n\(json)\(strip)\n"
    } catch {
      transcript += "\n! \(error.localizedDescription)\n"
    }
  }
}
