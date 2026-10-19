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
    ("Take photo", "take photo"),
    ("Record video", "record video"),
    ("Create reminder", "create reminder id=desk-rem cron=@daily prompt=ios reminder"),
    ("Version info", "version info"),
    ("Mute channel", "mute channel"),
    ("Toggle theme", "toggle theme"),
    ("Open terminal", "open terminal"),
    ("Share screen", "share screen"),
    ("Ping host", "ping host"),
    ("List scheduled", "list scheduled"),
    ("Create canvas", "create canvas page"),
    ("Do not disturb", "do not disturb"),
    ("Export chat", "export chat"),
    ("Open identity", "open identity"),
    ("Edit message", "edit message"),
    ("React message", "react message"),
    ("Pin message", "pin message"),
    ("Clear chat", "clear chat"),
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
    ("Connect gmail", "connect gmail"),
    ("Connect outlook", "connect outlook"),
    ("List connectors", "list connectors"),
    ("Setup slack", "setup slack"),
    ("Identity browser", "identity browser"),
    ("Book flight", "book flight google.com/flights"),
    ("Journal append", "journal date=2026-10-17 id=e1 body=hello journal"),
    ("Personal DM", "personal slack dm owner=Uowner text=ping"),
    ("Channel plan", "channel plan body=stay in chat only"),
    ("Bare chrome", "launch bare chrome"),
    ("Install npm", "install package npm left-pad@1.3.0"),
    ("Members group", "open members group=group-1"),
    ("Journal range", "query journal from=2026-10-01 to=2026-10-31"),
    ("Box doctor", "box doctor"),
    ("Box env", "box env"),
    ("Box clock", "box clock"),
    ("Chrome probe", "box chrome probe"),
    ("Copy from box", "copy from box machine=phone-ios box=/workspace/uploads/README.mbt.md dest=/workspace/uploads/out-README.mbt.md"),
    ("Voice relay", "voice relay ios-voice :: hello from ios"),
    ("Voice end", "voice end ios-voice"),
    ("Gen video", "generate video ios clip wave"),
    ("Webhook panel", "open webhook panel"),
    ("Copy webhook url", "copy webhook url"),
    ("Auto review", "auto review settings"),
    ("Search mail", "search mail Invoice"),
    ("Fire routine", "fire routine desk-r"),
    ("Shared mem put", "shared memory put scope=ios key=panel value=1"),
    ("Shared mem read", "shared memory read scope=ios key=panel"),
    ("Open settings", "open settings"),
    ("Source control", "source control github"),
    ("Create PR plan", "source control create_pr"),
    ("Load skill", "load skill slides presentation"),
    ("Install plugin", "install plugin plugin-slides"),
    ("Uninstall plugin", "uninstall plugin plugin-slides"),
    ("Copy webhook key", "copy webhook key"),
    ("Tool-read webhook", "tool-read webhook key"),
    ("Webhook wake", "webhook wake id=evt-ios summary=POST /hooks received"),
    ("Members panel", "members panel"),
    ("Recall", "recall"),
    ("Reset computer", "reset computer"),
    ("Local exec off", "local execution off"),
    ("Guide permission", "guide permission kind=needs-auth ns=user-Gmail"),
    ("Watch video", "watch video agent-tools/gen-video-desktop-1.mp4"),
    ("Shop", "shop target.com headphones"),
    ("Code changes", "code changes README.mbt.md"),
    ("Send to agent", "send to agent asst-parity :: ping from ios host"),
    ("Set notify", "set notify assistant=asst-alpha toggle=sound enabled=0"),
    ("Inbound reaction", "[inbound] reaction :+1:"),
    ("Agent info", "open agent info agent=agent-bit"),
    ("Delete agent", "delete agent agent-bit"),
    ("Confirm delete", "confirm delete agent agent-bit"),
    ("Create routine", "create routine id=desk-r cron=@hourly prompt=ios tick"),
    ("Create teammate", "create teammate id=asst-parity name=MobileMate role=executor"),
    ("Room", "room ios :: hello teammates from ios"),
    ("Cloud artifact", "deliver cloud artifact artifact=bc-1 dest=ios-report.md"),
    ("Teams send", "teams send tsmoke :: hello host chat"),
    ("Slack thread", "reply via slack:Cios thread_ts=1710000000.000001 :: ios thread"),
    ("Outlook draft", "draft outlook mail to=bob@example.com subject=hi body=hello"),
    ("Slack claim", "reply via slack:Cios :: claim rehearsal"),
    ("Teams claim", "reply via teams:Tios :: sandbox claim"),
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
