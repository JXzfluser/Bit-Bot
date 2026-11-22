import Foundation

/// 手机端「指挥」客户端(P1 批 5):让**手机**也能指挥这台机器上的团队。
///
/// 桌面指挥台早就有插话 / 改向 / 刹停 / 换人四件套,但它们只挂在 Electron 的 IPC 上
/// (`hosts/desktop/preload.js` 的 rooms.steerTask / replanTask / cancelTask / reassignTask)
/// —— 手机够不着。批 4 把这四件事开成了 HTTP 路由(只认设备签名),
/// 这一份客户端就是手机侧的那一半。
///
/// 端点(与服务端 `hosts/shared/cn_inbound_server.js` **逐条一致**):
///   GET  {host}/v1/tasks                       → 任务清单
///   POST {host}/v1/tasks/<task_sig>/steer     → 插话
///   POST {host}/v1/tasks/<task_sig>/replan    → 改向
///   POST {host}/v1/tasks/<task_sig>/cancel    → 刹停
///   POST {host}/v1/tasks/<task_sig>/swap      → 换人
///
/// 鉴权:**只认设备签名**(`DeviceIdentity.requestHeaders`)—— 与 /v1/approvals、
/// /v1/tasks 同一套口径。不回落 bearer:指挥那台机器上的团队,权限比发一轮对话重。
///
/// 形状照抄 `ApprovalClient.swift`(同 URL 拼装、同 `x-bitbot-*` 头、同错误映射口径)。
///
/// 三条不许越过的线:
///   ① **不另起数据源**:清单**只**从 `GET /v1/tasks` 读;能不能点**只**看服务端给的
///      `can.*`(端上不许自己猜「在跑没在跑」—— 那会让手机与桌面对不上账)。
///   ② **不发明端点与字段**:路径、字段名、词表全部与服务端源码对齐,
///      由 `scripts/prove_mobile_task_client.js` 逐条钉住。
///   ③ **不换鉴权**:设备签名,别的都不要。

/// 路由与词表 —— 端上抄的**契约**。
///
/// 每一项都必须与服务端源码**逐字一致**:
///   · `list` ↔ `cn_inbound_server.js` 的 `p === "/v1/tasks"`;
///   · `commandPrefix` + `actions` ↔ `hosts/shared/task_view.js` 的
///     `TASK_SIG_ROUTE_RE = /^\/v1\/tasks\/([^/]+)\/(steer|replan|cancel|swap)$/`;
///   · `buckets` ↔ `task_view.js` 的 `aggregateCommandTasks` 里那四个桶。
enum TaskCommandRoute {
    /// GET {host}/v1/tasks —— 任务清单。
    static let list = "v1/tasks"

    /// POST {host}/v1/tasks/<encodeURIComponent(task_sig)>/<action> —— 四条指挥路由。
    static let commandPrefix = "v1/tasks/"

    /// 四个动作的**词表** —— 与服务端那条正则里的 `(steer|replan|cancel|swap)` 逐字一致。
    static let actions = ["steer", "replan", "cancel", "swap"]

    /// 四个桶的**词表** —— 与服务端 `aggregateCommandTasks` 一致。
    static let buckets = ["needs_you", "working", "waiting", "closed"]
}

/// `task_sig` 的编码 —— 必须与服务端 `hosts/shared/task_view.js` 的 `encodeTaskSig`
/// (即 JS 的 `encodeURIComponent`)**逐字同一套**。
///
/// 为什么不用 `addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)` 图省事:
/// 那套字符集放过 `/` —— 一个 `task_sig` 里若带 `/`,路径段就断了,
/// 服务端那条正则 `([^/]+)` 永远匹配不上。
enum TaskCommandCodec {
    /// `encodeURIComponent` 放行的字符(unreserved + `!~*'()`)。
    private static let safe = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

    /// 把 `task_sig` 编成 URL 路径段(与服务端 `encodeTaskSig` 同一套)。
    static func encodeTaskSig(_ sig: String) -> String {
        var out = ""
        for byte in Array(sig.utf8) {
            let scalar = Unicode.Scalar(byte)
            if safe.contains(scalar) {
                out.append(Character(scalar))
            } else {
                out += String(format: "%%%02X", UInt32(byte))
            }
        }
        return out
    }
}

/// 错误码 → HTTP 状态 —— 与服务端 `hosts/shared/cn_inbound_server.js` 的
/// `taskCommandStatus()` **逐条一致**:
///   · 参数缺失(`*_required`)⇒ 400;
///   · 找不到那间群 / 那个人 ⇒ 404;
///   · 其余业务失败(同一个人 / 不在群里 / 没有在跑的)⇒ 409。
enum TaskCommandStatus {
    static let badRequest = 400
    static let notFound = 404
    static let conflict = 409

    /// 服务端的错误码 → HTTP 状态。
    static let byError: [String: Int] = [
        "task_sig_required": badRequest,
        "room_id_required": badRequest,
        "text_required": badRequest,
        "task_required": badRequest,
        "from_bot_required": badRequest,
        "to_bot_required": badRequest,
        "room_not_found": notFound,
        "bot_not_found": notFound,
        "same_bot": conflict,
        "bot_not_in_room": conflict,
        "no_running_task": conflict,
    ]

    /// 某个错误码对应的 HTTP 状态(没登记过的按 409 算 —— 那是服务端的兜底档)。
    static func status(of code: String) -> Int {
        return byError[code] ?? conflict
    }
}

/// 手机端「指挥」客户端。
struct TaskCommandClient {
    let baseURL: URL
    let identity: DeviceIdentity

    /// 谁干了什么(一批里的一步)。
    struct Step {
        let name: String
        let botId: String
        let ok: Bool
        let text: String
        let error: String
        let at: String
    }

    /// 「要你拍板」的那一句。
    struct NeedsYou {
        let question: String
        let candidates: [String]
        let at: String
    }

    /// 四个动作现在能不能点 —— **服务端算的**。
    struct Can {
        let steer: Bool
        let replan: Bool
        let swap: Bool
        let cancel: Bool
    }

    /// 清单里的一条任务。字段与服务端 `toTaskListItem` 的返回对象一一对应。
    struct TaskSummary: Identifiable {
        let taskSig: String
        let roomId: String
        let roomTitle: String
        /// 四个桶之一:needs_you / working / waiting / closed。
        let bucket: String
        /// Task 实体的状态;没有实体记录就是空串(**不编**一个状态出来)。
        let state: String
        let title: String
        let task: String
        let members: [String]
        let steps: [Step]
        let needsYou: NeedsYou?
        let total: Int
        let returned: Int
        let partial: Bool
        let running: Bool
        let at: String
        let updatedAt: String
        let can: Can

        var id: String { return taskSig }
    }

    /// 一次读回来的清单。
    struct TaskList {
        let ok: Bool
        let deviceId: String
        let count: Int
        let tasks: [TaskSummary]
    }

    /// 一次指挥的结果。
    struct CommandResult {
        let ok: Bool
        let action: String
        let taskSig: String
        let roomId: String
        /// 插话 / 换人的诚实边界:`next_hop` = 下一棒看得见,当前这一轮看不见。
        let scope: String
        /// 插话专用:当前这一轮看不见插话(true = 看得见)。
        let currentTurnSees: Bool
        /// 刹停专用:真停掉了几条。
        let cancelled: Int
        /// 改向专用:服务端说已经重跑了。
        let restarted: Bool
        let fromBot: String
        let toBot: String
        let toBotName: String
    }

    enum ClientError: Error {
        case notPaired
        case http(Int, String)
        case badResponse
    }

    // MARK: - 读

    /// 读那台机器上的任务清单。**只读** `GET /v1/tasks` —— 端上不存第二份真相。
    func list() async throws -> TaskList {
        guard let url = listURL() else { throw ClientError.badResponse }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        applySignature(&request, body: Data())
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let text = String(data: data, encoding: .utf8) ?? ""
        guard (200..<300).contains(code) else {
            throw ClientError.http(code, text)
        }
        return try parseTaskList(data)
    }

    // MARK: - 指挥

    /// 插话:说一句,落**共享板** ⇒ **下一棒**看得见,**当前这一轮看不见**。
    func steer(taskSig: String, roomId: String, text: String) async throws -> CommandResult {
        let payload = steerPayload(roomId: roomId, text: text)
        return try await command(taskSig: taskSig, action: "steer", payload: payload)
    }

    /// 改向:换任务目标,服务端会**立刻重跑同一批**(幂等键不变)。
    func replan(taskSig: String, roomId: String, task: String) async throws -> CommandResult {
        let payload = replanPayload(roomId: roomId, task: task)
        return try await command(taskSig: taskSig, action: "replan", payload: payload)
    }

    /// 刹停:停掉**这一个** `task_sig`(不是全停)。
    func cancel(taskSig: String, roomId: String, reason: String = "user_stop") async throws -> CommandResult {
        let payload = cancelPayload(roomId: roomId, reason: reason)
        return try await command(taskSig: taskSig, action: "cancel", payload: payload)
    }

    /// 换人:把某个成员换成另一个人,**下一棒**生效。
    ///
    /// - Parameter fromBot: 要换掉的那个人的 id(桌面是挂在成员行上的那个 `bot_id`)。
    /// - Parameter toBot: 新人 —— 服务端按 **id 或名字** 都认。
    func swap(taskSig: String, roomId: String, fromBot: String, toBot: String) async throws -> CommandResult {
        let payload = swapPayload(roomId: roomId, fromBot: fromBot, toBot: toBot)
        return try await command(taskSig: taskSig, action: "swap", payload: payload)
    }

    // MARK: - 请求体(字段名与服务端读的**逐字一致**)

    /// 插话的请求体:服务端读 `body.room_id` 与 `body.text`。
    private func steerPayload(roomId: String, text: String) -> [String: Any] {
        return ["room_id": roomId, "text": text]
    }

    /// 改向的请求体:服务端读 `body.room_id` 与 `body.task`。
    private func replanPayload(roomId: String, task: String) -> [String: Any] {
        return ["room_id": roomId, "task": task]
    }

    /// 刹停的请求体:服务端读 `body.room_id` 与 `body.reason`。
    private func cancelPayload(roomId: String, reason: String) -> [String: Any] {
        return ["room_id": roomId, "reason": reason]
    }

    /// 换人的请求体:服务端读 `body.room_id` / `body.from_bot` / `body.to_bot`。
    private func swapPayload(roomId: String, fromBot: String, toBot: String) -> [String: Any] {
        return ["room_id": roomId, "from_bot": fromBot, "to_bot": toBot]
    }

    // MARK: - 传输

    /// 一次指挥:POST `/v1/tasks/<encodeURIComponent(task_sig)>/<action>`。
    private func command(taskSig: String, action: String, payload: [String: Any]) async throws -> CommandResult {
        guard TaskCommandRoute.actions.contains(action) else { throw ClientError.badResponse }
        guard let url = commandURL(taskSig: taskSig, action: action) else { throw ClientError.badResponse }
        let body = try JSONSerialization.data(withJSONObject: payload)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        applySignature(&request, body: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let text = String(data: data, encoding: .utf8) ?? ""
        guard (200..<300).contains(code) else {
            throw ClientError.http(code, text)
        }
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw ClientError.badResponse
        }
        return CommandResult(
            ok: (root["ok"] as? Bool) ?? false,
            action: String(root["action"] ?? action),
            taskSig: String(root["task_sig"] ?? ""),
            roomId: String(root["room_id"] ?? ""),
            scope: String(root["scope"] ?? ""),
            currentTurnSees: (root["current_turn_sees"] as? Bool) ?? false,
            cancelled: (root["cancelled"] as? Int) ?? 0,
            restarted: (root["restarted"] as? Bool) ?? false,
            fromBot: String(root["from_bot"] ?? ""),
            toBot: String(root["to_bot"] ?? ""),
            toBotName: String(root["to_bot_name"] ?? "")
        )
    }

    /// 清单的 URL:GET `{host}/v1/tasks`。
    private func listURL() -> URL? {
        return URL(string: baseString() + "/" + TaskCommandRoute.list)
    }

    /// 指挥路由的 URL:POST `{host}/v1/tasks/<encodeURIComponent(task_sig)>/<action>`。
    private func commandURL(taskSig: String, action: String) -> URL? {
        let path = baseString() + "/" + TaskCommandRoute.commandPrefix
            + TaskCommandCodec.encodeTaskSig(taskSig) + "/" + action
        return URL(string: path)
    }

    /// 去掉结尾的斜杠 —— 拼路径前先规整,免得出现 `//v1/tasks`。
    private func baseString() -> String {
        var base = baseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        return base
    }

    /// 把四个设备签名头挂上(与 Android 同一套口径)。
    private func applySignature(_ request: inout URLRequest, body: Data) {
        guard let headers = identity.requestHeaders(body: body) else { return }
        for (field, value) in headers.headerFields {
            request.setValue(value, forHTTPHeaderField: field)
        }
    }

    // MARK: - 解析(纯函数,便于单测)

    /// 把 `GET /v1/tasks` 的响应体解析成清单。
    ///
    /// 形状与服务端 `hosts/shared/task_view.js` 的 `toTaskListItem` **逐条对应**。
    static func parseTaskList(_ data: Data) throws -> TaskList {
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw ClientError.badResponse
        }
        let rows = root["tasks"] as? [[String: Any]] ?? []
        let tasks: [TaskSummary] = rows.map { row in
            let stepRows = row["steps"] as? [[String: Any]] ?? []
            let steps: [Step] = stepRows.map { s in
                Step(
                    name: String(s["name"] ?? ""),
                    botId: String(s["bot_id"] ?? ""),
                    ok: (s["ok"] as? Bool) ?? false,
                    text: String(s["text"] ?? ""),
                    error: String(s["error"] ?? ""),
                    at: String(s["at"] ?? "")
                )
            }
            var needs: NeedsYou? = nil
            if let n = row["needs_you"] as? [String: Any] {
                needs = NeedsYou(
                    question: String(n["question"] ?? ""),
                    candidates: (n["candidates"] as? [String]) ?? [],
                    at: String(n["at"] ?? "")
                )
            }
            var can = Can(steer: false, replan: false, swap: false, cancel: false)
            if let c = row["can"] as? [String: Any] {
                can = Can(
                    steer: (c["steer"] as? Bool) ?? false,
                    replan: (c["replan"] as? Bool) ?? false,
                    swap: (c["swap"] as? Bool) ?? false,
                    cancel: (c["cancel"] as? Bool) ?? false
                )
            }
            return TaskSummary(
                taskSig: String(row["task_sig"] ?? ""),
                roomId: String(row["room_id"] ?? ""),
                roomTitle: String(row["room_title"] ?? ""),
                bucket: String(row["bucket"] ?? ""),
                state: String(row["state"] ?? ""),
                title: String(row["title"] ?? ""),
                task: String(row["task"] ?? ""),
                members: (row["members"] as? [String]) ?? [],
                steps: steps,
                needsYou: needs,
                total: (row["total"] as? Int) ?? 0,
                returned: (row["returned"] as? Int) ?? 0,
                partial: (row["partial"] as? Bool) ?? false,
                running: (row["running"] as? Bool) ?? false,
                at: String(row["at"] ?? ""),
                updatedAt: String(row["updated_at"] ?? ""),
                can: can
            )
        }
        return TaskList(
            ok: (root["ok"] as? Bool) ?? false,
            deviceId: String(root["device_id"] ?? ""),
            count: (root["count"] as? Int) ?? 0,
            tasks: tasks
        )
    }
}
