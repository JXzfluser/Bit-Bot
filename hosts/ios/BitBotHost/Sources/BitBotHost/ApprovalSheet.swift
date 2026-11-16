import SwiftUI

/// 手机上的**审批面板**(B-6)。
///
/// 之前手机只能**显示**审批卡(`approval_card` widget),点不动 ——
/// 用户用手机发指令、Bot 要外发 ⇒ 审批卡弹在手机上 ⇒ 人得跑到电脑前点。
/// 这一屏把「批」这件事放回手机上。
///
/// 三个按钮的语义(与 CLI `scripts/approve.js`、Android 侧、内核同一套):
///   · 允许一次 —— 只批这一次
///   · 总是允许 —— 以后**同一件**不再问(默认写**作用域**规则,窄)
///   · 总是允许(这一类) —— 宽授权,必须再确认一次(它授权的是那台机器)
///   · 拒绝
///
/// ⚠️ 「宽授权」在手机上格外重:它授权的是**那台常开的机器**以后做这类事。
/// 所以它不在列表里直接点,要点两次。
struct ApprovalSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [ApprovalClient.Pending] = []
    @State private var busy = false
    @State private var message = ""
    @State private var wideConfirm: ApprovalClient.Pending?

    var body: some View {
        NavigationStack {
          Group {
            if rows.isEmpty {
              VStack(spacing: 10) {
                Text(busy ? "正在读…" : "没有等着批的操作")
                  .foregroundStyle(.secondary)
                Text("批准写进的是**那台机器**的队列和规则。")
                  .font(.caption)
                  .foregroundStyle(.tertiary)
              }
              .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
              List {
                ForEach(rows) { row in
                  VStack(alignment: .leading, spacing: 6) {
                    Text(row.kind)
                      .font(.headline)
                    Text(row.command)
                      .font(.caption)
                      .foregroundStyle(.secondary)
                    HStack {
                      Button("允许一次") { decide(row, .allowOnce, wide: false) }
                      Button("总是允许") { decide(row, .always, wide: false) }
                      Button("拒绝") { decide(row, .deny, wide: false) }
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    Button("总是允许这一类(宽)") {
                      wideConfirm = row
                    }
                    .buttonStyle(.borderless)
                    .font(.caption)
                    .foregroundStyle(.orange)
                  }
                }
              }
            }
          }
          .navigationTitle("待批准")
          .navigationBarTitleDisplayMode(.inline)
          .toolbar {
            ToolbarItem(placement: .topBarLeading) {
              Button("刷新") { Task { await load() } }
            }
            ToolbarItem(placement: .topBarTrailing) {
              Button("关闭") { dismiss() }
            }
          }
          .task { await load() }
          .alert("宽授权", isPresented: Binding(
            get: { wideConfirm != nil },
            set: { if !$0 { wideConfirm = nil } }
          )) {
            Button("取消", role: .cancel) { wideConfirm = nil }
            Button("确认:以后这一类都不再问", role: .destructive) {
              if let row = wideConfirm {
                decide(row, .always, wide: true)
              }
              wideConfirm = nil
            }
          } message: {
            Text("这等于授权那台机器以后做**这一类**事都不再问你。默认的「总是允许」只授权同一件。")
          }
        }
      }

    private func client() -> ApprovalClient? {
      guard
        let raw = TurnBridge.configuredHostURL(),
        let url = URL(string: raw),
        let identity = DeviceIdentity.load()
      else {
        return nil
      }
      return ApprovalClient(baseURL: url, identity: identity)
    }

    private func load() async {
      guard let client = client() else {
        message = "还没配对,或这台设备没有设备身份(先配对 Desktop)。"
        return
      }
      busy = true
      do {
        rows = try await client.pending()
      } catch {
        rows = []
        message = String(describing: error)
      }
      busy = false
    }

    private func decide(
      _ row: ApprovalClient.Pending,
      _ decision: ApprovalDecision,
      wide: Bool
    ) {
      guard let client = client() else {
        message = "还没配对,或这台设备没有设备身份(先配对 Desktop)。"
        return
      }
      busy = true
      Task {
        do {
          let result = try await client.decide(
            id: row.id, decision: decision.rawValue, wide: wide
          )
          message = result.persistedPattern.isEmpty
            ? "已\(decision.rawValue):\(row.kind)"
            : "已\(decision.rawValue),写下的规则:\(result.persistedPattern)"
          await load()
        } catch {
          message = String(describing: error)
        }
        busy = false
      }
    }
}
