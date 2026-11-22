import SwiftUI

/// 手机上的**指挥面板**(P1 批 5)。
///
/// 桌面指挥台早就有插话 / 改向 / 刹停 / 换人四件套,但它们只挂在 Electron 的 IPC 上 ——
/// 手机够不着。批 4 把这四件事开成了 HTTP 路由(只认设备签名),这一屏是手机侧的那一半。
///
/// 版面(方案 §3.4「手机端的界面形态」):
///   顶部两个计数(要你拍板 N / 在跑 N)→ 任务卡列表 → 每卡一句输入 + 四个动作。
///
/// 与 Android 侧**同形**:同端点、同字段名、同决定词表。
///
/// 三条不许越过的线:
///   ① 清单**只**从 `GET /v1/tasks` 读 —— 端上不存第二份真相;
///   ② 能不能点**只**看服务端给的 `can.*` —— 端上不自己猜「在跑没在跑」;
///   ③ 动作的语义一个字不改(插话=下一棒看得见 / 换人=下一棒生效 / 刹停=只停这一个)。
///
/// 诚实的边界:这一屏**打开时**读一次,另外有一个「刷新」键。
/// Android 侧还接了 `turn_ended`(那一轮跑完了,卡上的状态才变);
/// iOS 这边还没有事件流客户端(仓里 `hosts/ios/` 下没有 EventStreamClient),
/// 所以自动刷新这一档在 iOS 上**还没有** —— 如实记着,不是忘了。
struct TaskCommandSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var tasks: [TaskCommandClient.TaskSummary] = []
    @State private var busy = false
    @State private var message = ""
    /// 每张卡一句输入(桌面也是一张卡一个输入框,插话 / 改向 / 换人共用)。
    @State private var drafts: [String: String] = [:]

    var body: some View {
        NavigationStack {
            Group {
                if tasks.isEmpty {
                    VStack(spacing: 10) {
                        Text(busy ? TaskCommandMessages.loading() : TaskCommandMessages.empty())
                            .foregroundStyle(.secondary)
                        Text(TaskCommandMessages.subtitle())
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        Section {
                            HStack {
                                Text(TaskCommandMessages.needsYouCount(tasks.count { $0.bucket == "needs_you" }))
                                Text(TaskCommandMessages.workingCount(tasks.count { $0.bucket == "working" }))
                            }
                        }
                        ForEach(tasks) { task in
                            taskCard(task)
                        }
                    }
                }
            }
            .navigationTitle(TaskCommandMessages.title())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(TaskCommandMessages.refresh()) { Task { await load() } }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(TaskCommandMessages.close()) { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    /// 一张任务卡:标题 / 群 / 成员 / 谁干了什么 + 一句输入 + 四个动作。
    @ViewBuilder
    private func taskCard(_ task: TaskCommandClient.TaskSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(task.title.isEmpty ? task.task : task.title)
                .font(.headline)
            Text(
                TaskCommandMessages.bucketLabel(task.bucket) + " · "
                    + (task.roomTitle.isEmpty ? task.roomId : task.roomTitle)
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            if let needs = task.needsYou, !needs.question.isEmpty {
                Text(TaskCommandMessages.questionLabel() + "：" + needs.question)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            if !task.members.isEmpty {
                Text(TaskCommandMessages.membersLabel() + "：" + task.members.joined(separator: "、"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            // 谁干了什么:并行时用户得看得见每一棒,不然只是一堆 bot 在动。
            ForEach(Array(task.steps.enumerated()), id: \.offset) { _, step in
                HStack {
                    Text(step.name.isEmpty ? TaskCommandMessages.someone() : step.name)
                        .font(.caption)
                    Text(step.text.isEmpty ? step.error : step.text)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    // 换人挂在成员行上(与桌面同一套规则):没有 bot_id 的那一棒换不了。
                    if task.can.swap && !step.botId.isEmpty {
                        Button(TaskCommandMessages.swap()) {
                            let to = (drafts[task.taskSig] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                            if !to.isEmpty {
                                Task { await swap(task, fromBot: step.botId, toBot: to) }
                            }
                        }
                        .font(.caption2)
                        .buttonStyle(.borderless)
                    }
                }
            }
            TextField(
                TaskCommandMessages.inputPlaceholder(),
                text: Binding(
                    get: { drafts[task.taskSig] ?? "" },
                    set: { drafts[task.taskSig] = $0 }
                )
            )
            .textFieldStyle(.roundedBorder)
            .font(.caption)
            HStack {
                Button(TaskCommandMessages.steer()) {
                    let text = (drafts[task.taskSig] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty { Task { await steer(task, text: text) } }
                }
                .disabled(!task.can.steer)
                Button(TaskCommandMessages.replan()) {
                    let text = (drafts[task.taskSig] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    if !text.isEmpty { Task { await replan(task, text: text) } }
                }
                .disabled(!task.can.replan)
                // 刹停只给「真在跑」的那张卡 —— 没有在跑的按下去只会得到 no_running_task,
                // 与桌面同一套规则(桌面是直接不渲染这个按钮,不是给一个按不动的)。
                if task.can.cancel {
                    Button(TaskCommandMessages.cancel()) {
                        Task { await cancel(task) }
                    }
                    .foregroundStyle(.red)
                }
            }
            .buttonStyle(.borderless)
            .font(.caption)
            // 插话的诚实边界常驻小字:下一棒看得见,**当前这一轮看不见**。
            Text(TaskCommandMessages.steerScopeHint())
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    // MARK: - 真源

    private func client() -> TaskCommandClient? {
        guard
            let raw = TurnBridge.configuredHostURL(),
            let url = URL(string: raw),
            let identity = DeviceIdentity.load()
        else {
            return nil
        }
        return TaskCommandClient(baseURL: url, identity: identity)
    }

    private func load() async {
        guard let client = client() else {
            message = TaskCommandMessages.notPaired()
            return
        }
        busy = true
        do {
            let list = try await client.list()
            tasks = list.tasks
        } catch {
            tasks = []
            message = String(describing: error)
        }
        busy = false
    }

    // MARK: - 四个动作

    private func steer(_ task: TaskCommandClient.TaskSummary, text: String) async {
        guard let client = client() else { message = TaskCommandMessages.notPaired(); return }
        busy = true
        do {
            _ = try await client.steer(taskSig: task.taskSig, roomId: task.roomId, text: text)
            drafts[task.taskSig] = ""
            message = TaskCommandMessages.steered()
            await load()
        } catch {
            message = TaskCommandMessages.failed(String(describing: error))
        }
        busy = false
    }

    private func replan(_ task: TaskCommandClient.TaskSummary, text: String) async {
        guard let client = client() else { message = TaskCommandMessages.notPaired(); return }
        busy = true
        do {
            _ = try await client.replan(taskSig: task.taskSig, roomId: task.roomId, task: text)
            drafts[task.taskSig] = ""
            message = TaskCommandMessages.replanned()
            await load()
        } catch {
            message = TaskCommandMessages.failed(String(describing: error))
        }
        busy = false
    }

    private func cancel(_ task: TaskCommandClient.TaskSummary) async {
        guard let client = client() else { message = TaskCommandMessages.notPaired(); return }
        busy = true
        do {
            let done = try await client.cancel(taskSig: task.taskSig, roomId: task.roomId)
            message = TaskCommandMessages.cancelled(done.cancelled)
            await load()
        } catch {
            message = TaskCommandMessages.failed(String(describing: error))
        }
        busy = false
    }

    private func swap(
        _ task: TaskCommandClient.TaskSummary,
        fromBot: String,
        toBot: String
    ) async {
        guard let client = client() else { message = TaskCommandMessages.notPaired(); return }
        busy = true
        do {
            _ = try await client.swap(
                taskSig: task.taskSig, roomId: task.roomId, fromBot: fromBot, toBot: toBot
            )
            drafts[task.taskSig] = ""
            message = TaskCommandMessages.swapped()
            await load()
        } catch {
            message = TaskCommandMessages.failed(String(describing: error))
        }
        busy = false
    }
}

/// 这一屏的**可见文案**(三语:zh-CN / zh-TW / en)。
///
/// 为什么单独一个对象而不是直接写字符串:批 5 的验收里有一条「端上不新增可见文案硬编码」。
/// 语言口径与 Android 侧 `TaskCommandMessages` **同一套三档**,两边对得上账。
enum TaskCommandMessages {
    /// 当前语言 —— 与 Android 侧 `EventStreamMessages.currentLocale` 同一套归一规则。
    static var currentLocale: String = {
        let raw = (Locale.preferredLanguages.first ?? "zh-CN").lowercased()
        if raw.hasPrefix("en") { return "en" }
        if raw.hasPrefix("zh") {
            if raw.contains("tw") || raw.contains("hk") || raw.contains("mo") { return "zh-TW" }
            return "zh-CN"
        }
        return "en"
    }()

    static func title() -> String {
        switch currentLocale {
        case "zh-TW": return "指揮任務"
        case "en": return "Command tasks"
        default: return "指挥任务"
        }
    }

    static func subtitle() -> String {
        switch currentLocale {
        case "zh-TW": return "這台機器上正在跑、要你拍板的任務"
        case "en": return "Tasks running on this machine, and the ones waiting for you"
        default: return "这台机器上正在跑、要你拍板的任务"
        }
    }

    static func notPaired() -> String {
        switch currentLocale {
        case "zh-TW": return "還沒配對，或這台裝置沒有裝置身分"
        case "en": return "Not paired, or this device has no identity yet"
        default: return "还没配对，或这台设备没有设备身份"
        }
    }

    static func loading() -> String {
        switch currentLocale {
        case "zh-TW": return "正在讀…"
        case "en": return "Loading…"
        default: return "正在读…"
        }
    }

    static func empty() -> String {
        switch currentLocale {
        case "zh-TW": return "這台機器上現在沒有任務"
        case "en": return "No tasks on this machine right now"
        default: return "这台机器上现在没有任务"
        }
    }

    static func needsYouCount(_ n: Int) -> String {
        switch currentLocale {
        case "zh-TW": return "要你拍板 \(n)"
        case "en": return "Needs you: \(n)"
        default: return "要你拍板 \(n)"
        }
    }

    static func workingCount(_ n: Int) -> String {
        switch currentLocale {
        case "zh-TW": return "在跑 \(n)"
        case "en": return "Running: \(n)"
        default: return "在跑 \(n)"
        }
    }

    /// 四个桶的标签(桶本身是服务端算的,这里只给它一个名字)。
    static func bucketLabel(_ bucket: String) -> String {
        if !TaskCommandRoute.buckets.contains(bucket) {
            switch currentLocale {
            case "zh-TW": return "未知"
            case "en": return "Unknown"
            default: return "未知"
            }
        }
        switch currentLocale {
        case "zh-TW":
            switch bucket {
            case "needs_you": return "要你拍板"
            case "working": return "在跑"
            case "waiting": return "等一等"
            case "closed": return "已完"
            default: return "未知"
            }
        case "en":
            switch bucket {
            case "needs_you": return "Needs you"
            case "working": return "Running"
            case "waiting": return "Waiting"
            case "closed": return "Done"
            default: return "Unknown"
            }
        default:
            switch bucket {
            case "needs_you": return "要你拍板"
            case "working": return "在跑"
            case "waiting": return "等一等"
            case "closed": return "已完"
            default: return "未知"
            }
        }
    }

    static func questionLabel() -> String {
        switch currentLocale {
        case "zh-TW": return "要你拍板"
        case "en": return "Needs you"
        default: return "要你拍板"
        }
    }

    static func membersLabel() -> String {
        switch currentLocale {
        case "zh-TW": return "成員"
        case "en": return "Members"
        default: return "成员"
        }
    }

    static func someone() -> String {
        switch currentLocale {
        case "zh-TW": return "某個成員"
        case "en": return "Someone"
        default: return "某个成员"
        }
    }

    static func steer() -> String {
        switch currentLocale {
        case "zh-TW": return "插話"
        case "en": return "Steer"
        default: return "插话"
        }
    }

    static func replan() -> String {
        switch currentLocale {
        case "zh-TW": return "改向"
        case "en": return "Replan"
        default: return "改向"
        }
    }

    static func cancel() -> String {
        switch currentLocale {
        case "zh-TW": return "煞停"
        case "en": return "Stop"
        default: return "刹停"
        }
    }

    static func swap() -> String {
        switch currentLocale {
        case "zh-TW": return "換人"
        case "en": return "Swap"
        default: return "换人"
        }
    }

    static func inputPlaceholder() -> String {
        switch currentLocale {
        case "zh-TW": return "說一句：插話是給下一棒的話，改向是新的任務目標"
        case "en": return "Say something: a steer reaches the next relay, a replan sets a new goal"
        default: return "说一句：插话是给下一棒的话，改向是新的任务目标"
        }
    }

    static func steerScopeHint() -> String {
        switch currentLocale {
        case "zh-TW": return "插話只有下一棒看得見，當前這一回合看不見。"
        case "en": return "A steer is seen by the next relay — not by the turn that is running now."
        default: return "插话只有下一棒看得见，当前这一回合看不见。"
        }
    }

    static func steered() -> String {
        switch currentLocale {
        case "zh-TW": return "已插話（下一棒看得見）"
        case "en": return "Steered (the next relay sees it)"
        default: return "已插话（下一棒看得见）"
        }
    }

    static func replanned() -> String {
        switch currentLocale {
        case "zh-TW": return "已改向，正在重跑"
        case "en": return "Replanned, restarting now"
        default: return "已改向，正在重跑"
        }
    }

    static func cancelled(_ n: Int) -> String {
        switch currentLocale {
        case "zh-TW": return "已煞停 \(n) 條"
        case "en": return "Stopped \(n)"
        default: return "已刹停 \(n) 条"
        }
    }

    static func swapped() -> String {
        switch currentLocale {
        case "zh-TW": return "已換人（下一棒生效）"
        case "en": return "Swapped (effective on the next relay)"
        default: return "已换人（下一棒生效）"
        }
    }

    static func failed(_ detail: String) -> String {
        switch currentLocale {
        case "zh-TW": return "沒成功：\(detail)"
        case "en": return "Didn't work: \(detail)"
        default: return "没成功：\(detail)"
        }
    }

    static func refresh() -> String {
        switch currentLocale {
        case "zh-TW": return "刷新"
        case "en": return "Refresh"
        default: return "刷新"
        }
    }

    static func close() -> String {
        switch currentLocale {
        case "zh-TW": return "關閉"
        case "en": return "Close"
        default: return "关闭"
        }
    }
}
