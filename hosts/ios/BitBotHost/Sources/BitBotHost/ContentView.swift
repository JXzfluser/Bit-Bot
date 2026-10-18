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
    ("Slides", "make slides title=iOSParity"),
    ("Markdown", "render markdown Inline \\(E=mc^2\\) and $$a^2+b^2=c^2$$"),
    ("Voice start", "voice start ios-voice"),
    ("Draft mail", "draft mail to=ios@example.com subject=Ping body=Hello"),
    ("Schedule", "schedule meeting title=iOSSync at=2026-11-01T10:00:00Z"),
    ("Purchase", "purchase item=iOSWidget cents=299"),
    ("Slack draft", "reply via slack:Cios :: ios draft"),
    ("Teams draft", "reply via teams:Tios :: ios teams draft"),
    ("Finance", "finance get_balance"),
    ("Jobs", "job search engineer"),
    ("X search", "x search moonbit"),
    ("Workflows", "list workflows"),
    ("Credentials", "list credentials"),
    ("React", "react message msg=msg-ios emoji=👍"),
    ("Screenshot", "screenshot agent=executor"),
    ("Check updates", "check updates"),
    ("Cloud launch", "launch cloud agent triage ios"),
    ("Routines", "list routines"),
    ("Tick routines", "tick routines"),
    ("Shell", "shell echo ios-tools"),
    ("Listdir", "listdir docs"),
    ("Read", "read README.mbt.md"),
    ("WebFetch", "webfetch https://example.com"),
    ("CU open", "computer use open https://example.com"),
    ("Remember", "remember ios_panel=ready"),
    ("Cold mail", "cold mail to=ios@example.com subject=Hi body=iOS cold unsubscribe=mailto:unsub@example.com"),
    ("On behalf", "send on behalf to=boss@example.com subject=Update body=iOS on-behalf"),
    ("Claim inbox", "claim inbox alpha"),
    ("Author skill", "author skill name=ios-skill description=demo body=Do the thing."),
    ("Export bot", "export bot template id=bot-ios name=iOSBot"),
    ("Device tools", "device tools"),
    ("Journal", "journal query hello"),
    ("Copy to box", "copy to box machine=phone-ios src=README.mbt.md dest=/workspace/uploads/README.mbt.md"),
    ("MCP discover", "mcp discover"),
    ("MCP call", "mcp call user-Gmail.search_threads {}"),
    ("Subagent", "spawn subagent summarize inbox"),
    ("Travel", "travel expedia.com"),
    ("Order food", "order food doordash.com"),
    ("Package install", "package install cowsay"),
    ("List agents", "list agents"),
    ("Hide agent", "hide agent research"),
    ("Notify", "notify settings assistant=asst-alpha"),
    ("Update computer", "update computer"),
    ("Shared box", "shared box fs"),
    ("Section post", "section post group=g1 section=sec-a from=asst-1 body=hello"),
    ("Meeting chat", "meeting chat body=stand-up update direct=1"),
    ("Learn demo", "learn from demo title=Checkout steps=click:Cart|type:email"),
    ("Fill credential", "fill credential domain=login.example.test"),
    ("Read mail", "read mail t-invoice-1"),
    ("Pause routine", "pause routine smoke-r"),
    ("Resume routine", "resume routine smoke-r"),
    ("Add section", "add section group=g1 id=sec-a title=alpha"),
    ("Connect finance", "connect finance"),
    ("Book flight", "book flight google.com/flights"),
    ("Journal append", "journal date=2026-10-17 id=e1 body=hello journal"),
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
