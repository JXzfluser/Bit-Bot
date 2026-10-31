import SwiftUI

/// Grok-style iOS product shell — chat first; MoonBit → Host llm_chat (ADR 0005).
struct ContentView: View {
  struct ChatLine: Identifiable {
    let id = UUID()
    let role: String
    let text: String
  }

  @State private var input = ""
  @State private var lines: [ChatLine] = []
  @State private var busy = false
  @State private var showCapabilities = false
  @State private var showCredentials = false
  @State private var hostUrlDraft = TurnBridge.configuredHostURL() ?? ""
  @State private var delivery = SendToUserSurface.Summary()
  @State private var statusHint =
    "MoonBit 内核 · 点「凭证」配对 Desktop（开放配置）· DeepSeek key 在 Desktop Settings"

  /// Compact product actions (CN channels + essentials). Full matrix stays on Desktop lab.
  private let productActions: [(label: String, turn: String)] = [
    ("ListMachines", "ListMachines"),
    ("钉钉", "reply via dingtalk:cid-ios :: Bit Bot iOS 钉钉"),
    ("飞书", "reply via feishu:oc_ios :: Bit Bot iOS 飞书"),
    ("企微", "reply via wecom:BitBotIos :: Bit Bot iOS 企微"),
    ("List models", "list models"),
    ("Device tools", "device tools"),
    ("Take photo", "take photo"),
    ("Routines", "list routines"),
    ("Tick routines", "tick routines"),
    ("Check updates", "check updates"),
  ]

  /// 桌面快捷指令的全部词表（与 scripts/verify_native_shells.sh 同源）。
  /// 点一条只是填进输入框：像 "room " / "cold mail to=" 这种还差参数，
  /// 不能假装一句话就能发出去。
  private let commandTemplates: [String] = [
    "list plugins",
    "get plugin plugin-slides",
    "generate image",
    "structured chart",
    "voice start",
    "box doctor",
    "box chrome probe",
    "make slides",
    "draft mail",
    "schedule meeting",
    "purchase item",
    "reply via slack:",
    "reply via teams:",
    "finance get_balance",
    "job search",
    "x search moonbit",
    "list workflows",
    "list credentials",
    "react message",
    "screenshot agent=executor",
    "launch cloud agent",
    "listdir docs",
    "webfetch https://example.com",
    "computer use open",
    "shell echo",
    "cold mail to=",
    "send on behalf to=",
    "claim inbox",
    "author skill name=",
    "export bot template id=",
    "record video",
    "create reminder id=desk-rem",
    "version info",
    "mute channel",
    "toggle theme",
    "open terminal",
    "share screen",
    "ping host",
    "list scheduled",
    "create canvas page",
    "do not disturb",
    "export chat",
    "open identity",
    "edit message",
    "pin message",
    "clear chat",
    "journal query hello",
    "copy to box machine=",
    "mcp discover",
    "mcp call user-Gmail.search_threads",
    "spawn subagent summarize inbox",
    "travel expedia.com",
    "order food doordash.com",
    "package install cowsay",
    "list agents",
    "hide agent research",
    "notify settings assistant=asst-alpha",
    "update computer",
    "shared box fs",
    "section post group=g1",
    "meeting chat body=stand-up",
    "learn from demo title=Checkout",
    "fill credential domain=login.example.test",
    "read mail t-invoice-1",
    "pause routine smoke-r",
    "resume routine smoke-r",
    "add section group=g1",
    "connect finance",
    "book flight google.com/flights",
    "journal date=2026-10-17",
    "personal slack dm owner=Uowner",
    "channel plan body=stay in chat only",
    "launch bare chrome",
    "install package npm left-pad@1.3.0",
    "open members group=group-1",
    "query journal from=2026-10-01",
    "connect gmail",
    "connect outlook",
    "list connectors",
    "setup slack",
    "identity browser",
    "box clock",
    "copy from box machine=",
    "voice relay",
    "voice end",
    "generate video",
    "open webhook panel",
    "copy webhook url",
    "auto review settings",
    "search mail Invoice",
    "fire routine desk-r",
    "shared memory put",
    "shared memory read",
    "open settings",
    "source control github",
    "source control create_pr",
    "load skill slides presentation",
    "install plugin plugin-slides",
    "uninstall plugin plugin-slides",
    "copy webhook key",
    "tool-read webhook key",
    "webhook wake id=",
    "members panel",
    "recall",
    "reset computer",
    "local execution off",
    "guide permission kind=needs-auth",
    "watch video",
    "shop target.com",
    "code changes README.mbt.md",
    "send to agent asst-parity",
    "set notify assistant=asst-alpha",
    "[inbound] reaction :+1:",
    "open agent info agent=agent-bit",
    "delete agent agent-bit",
    "confirm delete agent",
    "create routine id=desk-r",
    "create teammate id=",
    "room ",
    "post to room ",
    "join room ",
    "list members",
    "list channels",
    "start huddle",
    "end huddle",
    "open canvas",
    "focus mode on",
    "todo write ",
    "list todos",
    "open thread",
    "start screen share",
    "list skills",
    "attach file ",
    "journal query",
    "open identity browser",
    "x post ",
    "open plugins",
    "pin agent ",
    "browser open ",
    "share bot",
    "record audio",
    "scan document",
    "vault list",
    "clipboard read",
    "note create ",
    "list calendar",
    "export pdf",
    "export markdown",
    "deliver cloud artifact artifact=",
    "teams send tsmoke",
    "thread_ts=",
    "draft outlook mail",
    "claim rehearsal",
    "sandbox claim",
  ]

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        if lines.isEmpty {
          VStack(spacing: 12) {
            Text("Bit Bot")
              .font(.system(size: 40, weight: .bold, design: .serif))
            Text("对标 Grok 的国产助手 · iOS Host")
              .font(.subheadline)
              .foregroundStyle(.secondary)
              .multilineTextAlignment(.center)
            Text(statusHint)
              .font(.caption)
              .foregroundStyle(.tertiary)
              .multilineTextAlignment(.center)
              .padding(.horizontal)
            Button("配置 Desktop 配对凭证") {
              hostUrlDraft = TurnBridge.configuredHostURL() ?? ""
              showCredentials = true
            }
            .buttonStyle(.borderedProminent)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          ScrollViewReader { proxy in
            ScrollView {
              LazyVStack(alignment: .leading, spacing: 10) {
                ForEach(lines) { line in
                  chatBubble(line)
                    .id(line.id)
                }
              }
              .padding()
            }
            .onChange(of: lines.count) { _ in
              if let last = lines.last {
                withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
              }
            }
          }
        }

        if delivery.labels.isEmpty == false {
          SendToUserChipRow(summary: delivery)
            .padding(.horizontal)
            .padding(.bottom, 4)
        }

        HStack(spacing: 8) {
          TextField("给 Bit Bot 发消息…", text: $input, axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .lineLimit(1...4)
          Button {
            Task { await sendTurn(text: input) }
          } label: {
            Text(busy ? "…" : "发送")
              .fontWeight(.semibold)
          }
          .buttonStyle(.borderedProminent)
          .disabled(busy || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding()
      }
      .navigationTitle("Bit Bot")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("凭证") {
            hostUrlDraft = TurnBridge.configuredHostURL() ?? ""
            showCredentials = true
          }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button("能力") { showCapabilities.toggle() }
        }
      }
      .sheet(isPresented: $showCredentials) {
        NavigationStack {
          Form {
            Section {
              Text("产品凭证 · 开放配置（不写死）")
                .font(.headline)
              Text("DeepSeek / 渠道 key 在 Desktop「凭证」；本机只配配对地址。")
                .font(.caption)
                .foregroundStyle(.secondary)
              TextField("BITBOT_HOST_URL", text: $hostUrlDraft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
            }
            Section {
              Button("保存并热加载") {
                TurnBridge.setHostURL(hostUrlDraft)
                statusHint = "已配对 \(TurnBridge.configuredHostURL() ?? "（空）")"
                showCredentials = false
              }
            }
          }
          .navigationTitle("凭证")
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button("关闭") { showCredentials = false }
            }
          }
        }
        .presentationDetents([.medium])
      }
      .sheet(isPresented: $showCapabilities) {
        NavigationStack {
          List {
            Section("国内渠道 / 设备") {
              ForEach(productActions, id: \.label) { action in
                Button(action.label) {
                  showCapabilities = false
                  Task { await sendTurn(text: action.turn) }
                }
                .disabled(busy)
              }
            }

            Section("全部指令模板（\(commandTemplates.count)）") {
              NavigationLink("浏览全部模板") {
                List(commandTemplates, id: \.self) { template in
                  Button {
                    input = template
                    showCapabilities = false
                  } label: {
                    Text(template)
                      .font(.system(.body, design: .monospaced))
                      .textSelection(.enabled)
                  }
                }
                .navigationTitle("指令模板")
              }
            }
          }
          .navigationTitle("能力")
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button("关闭") { showCapabilities = false }
            }
          }
        }
        .presentationDetents([.medium, .large])
      }
    }
  }

  @ViewBuilder
  private func chatBubble(_ line: ChatLine) -> some View {
    HStack {
      if line.role == "user" { Spacer(minLength: 40) }
      VStack(alignment: .leading, spacing: 4) {
        Text(line.role == "user" ? "你" : "Bit Bot")
          .font(.caption2)
          .foregroundStyle(.secondary)
        Text(line.text)
          .font(.body)
          .textSelection(.enabled)
      }
      .padding(10)
      .background(
        RoundedRectangle(cornerRadius: 12)
          .fill(line.role == "user" ? Color.accentColor.opacity(0.18) : Color(.secondarySystemBackground))
      )
      if line.role != "user" { Spacer(minLength: 40) }
    }
  }

  @MainActor
  private func sendTurn(text: String) async {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    busy = true
    defer { busy = false }
    input = ""
    lines.append(ChatLine(role: "user", text: trimmed))
    do {
      let json = try await TurnBridge.runTurn(text: trimmed, machineKind: "ios")
      let summary = SendToUserSurface.extract(fromTurnJSON: json)
      delivery = summary
      let assistant = TurnBridge.assistantText(fromTurnJSON: json)
        ?? "(empty assistant — model credential stays on Desktop)"
      lines.append(ChatLine(role: "assistant", text: assistant))
      if trimmed.lowercased() == "listmachines" {
        statusHint = "MachineKind=ios · shared MoonBit HostAbi"
      }
    } catch {
      lines.append(ChatLine(role: "assistant", text: "错误：\(error.localizedDescription)"))
    }
  }
}
