import Foundation

/// 跨端审批客户端(B-6):让**手机**也能决定"这台机器上等着批的操作"。
///
/// 现状:手机端只能**显示**审批卡(`approval_card` widget),点不动。
/// 用户用手机发指令、Bot 要外发 ⇒ 审批卡弹在手机上 ⇒ 人得跑到电脑前点。
/// ⇒ 手机场景断在这里。
///
/// 这份客户端把决定送回**那台常开的机器**(Box / 桌面):
///   GET  {host}/v1/approvals                    → 待批准清单
///   POST {host}/v1/approvals/{id}/decide        → 决定
///
/// 鉴权用**设备签名**(B-4a),与 Android 的 `DeviceIdentity.requestHeaders`、
/// 服务端 `device_keys.js` 同一套口径 —— 账号 = 设备密钥,没有别的身份。
///
/// 决定的三档(与 CLI `scripts/approve.js`、内核 `ApprovalClass` 同一套语义):
///   · `allow_once` —— 只批这一次
///   · `always`     —— 以后**同一件**不再问(默认写**作用域**规则,窄)
///   · `always` + `scope:"wide"` —— 以后**这一类**都不问(宽)—— 必须显式确认
///   · `deny`       —— 拒绝
///
/// ⚠️ 「总是允许」在手机上的分量比在电脑上重:它授权的是**那台机器**以后
/// 不再逐次问你。所以宽授权必须走一次显式确认。
/// 决定词表 —— 必须与服务端 `hosts/desktop/product_surface.js` 里那行
/// `["allow_once", "always", "deny"]` **逐字一致**。
/// 放在一处而不是散在调用点:UI 点错了词,服务端会拒(409),这里先挡住。
enum ApprovalDecision: String {
    /// 只批这一次。
    case allowOnce = "allow_once"
    /// 以后**同一件**不再问(默认写**作用域**规则,窄)。
    case always = "always"
    /// 拒绝。
    case deny = "deny"

    static let all: [ApprovalDecision] = [.allowOnce, .always, .deny]
}

struct ApprovalClient {
    let baseURL: URL
    let identity: DeviceIdentity

    /// 待批准的一条。
    struct Pending: Identifiable {
        let id: String
        let kind: String
        /// 命令摘要(服务端已截到 240 字)—— 够人判断这是什么。
        let command: String
        let source: String
        let requestedAt: String
        let expiresAt: String
        let status: String
    }

    /// 决定的结果。
    struct DecisionResult {
        let ok: Bool
        let decision: String
        /// 写下的规则(`always` 才有)—— 让人知道到底授权了什么。
        let persistedPattern: String
        /// 规则的作用域:scoped=窄规则 / kind=一类 / 空=没写规则。
        let persistedScope: String
        let message: String
    }

    enum ClientError: Error {
        case notPaired
        case http(Int, String)
        case badResponse
    }

    /// 列出那台机器上等着批的操作。
    func pending() async throws -> [Pending] {
        let url = baseURL.appendingPathComponent("v1/approvals")
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
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let rows = root["pending"] as? [[String: Any]]
        else {
            throw ClientError.badResponse
        }
        return rows.map { row in
            Pending(
                id: String(row["id"] ?? ""),
                kind: String(row["kind"] ?? ""),
                command: String(row["command"] ?? ""),
                source: String(row["source"] ?? ""),
                requestedAt: String(row["requested_at"] ?? ""),
                expiresAt: String(row["expires_at"] ?? ""),
                status: String(row["status"] ?? "pending")
            )
        }
    }

    /// 做出决定。
    /// - Parameter wide: true = 「以后**这一类**都不问」(宽授权,需显式确认)。
    func decide(
        id: String,
        decision: String,
        wide: Bool = false
    ) async throws -> DecisionResult {
        guard !id.isEmpty else { throw ClientError.badResponse }
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
            ?? id
        var url = baseURL.appendingPathComponent("v1/approvals")
        url.appendPathComponent(encoded)
        url.appendPathComponent("decide")

        var payload: [String: Any] = ["decision": decision]
        // scope:"wide" ⇒ 「总是允许」按**类**放行(kind:*)。
        // 不带 scope ⇒ 走**作用域**规则(kind:<作用域>),窄得多。
        if wide && decision == "always" {
            payload["scope"] = "wide"
        }
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
        return DecisionResult(
            ok: (root["ok"] as? Bool) ?? false,
            decision: String(root["decision"] ?? decision),
            persistedPattern: String(root["persisted_pattern"] ?? ""),
            persistedScope: String(root["persisted_scope"] ?? ""),
            message: String(root["note"] ?? "")
        )
    }

    /// 把四个设备签名头挂上(与 Android 同一套口径)。
    private func applySignature(_ request: inout URLRequest, body: Data) {
        guard let headers = identity.requestHeaders(body: body) else { return }
        for (field, value) in headers.headerFields {
            request.setValue(value, forHTTPHeaderField: field)
        }
    }
}
