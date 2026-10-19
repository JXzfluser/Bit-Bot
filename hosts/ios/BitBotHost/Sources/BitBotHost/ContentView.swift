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
  @State private var delivery = SendToUserSurface.Summary()
  @State private var statusHint =
    "MoonBit 内核 · 配对 Desktop BITBOT_HOST_URL · DeepSeek key 在 Desktop Settings"

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
          Button("能力") { showCapabilities.toggle() }
        }
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
        ?? "(empty assistant — check BITBOT_LLM_API_KEY for Chat)"
      lines.append(ChatLine(role: "assistant", text: assistant))
      if trimmed.lowercased() == "listmachines" {
        statusHint = "MachineKind=ios · shared MoonBit HostAbi"
      }
    } catch {
      lines.append(ChatLine(role: "assistant", text: "错误：\(error.localizedDescription)"))
    }
  }
}
