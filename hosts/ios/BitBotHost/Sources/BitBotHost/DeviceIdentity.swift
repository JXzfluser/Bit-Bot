import Foundation
import CryptoKit
import Security

/// iOS 端的设备身份与请求签名(B-6)。
///
/// **为什么 iOS 原来接不进来**:Android 侧一直有设备密钥签名
/// (`DeviceIdentity.requestHeaders`),iOS 侧只发一个共享 `Bearer`
/// ⇒ 桌面/Box 的设备登记表一旦非空,iOS 的请求直接 401。
/// 共享 Bearer 是"一把钥匙开所有门",设备密钥才是"这把钥匙只开这台手机的门"。
///
/// **口径必须与服务端逐字节相同**(`hosts/shared/device_keys.js`):
///   签名载荷 = `deviceId\ntimestamp\nnonce\n` + body
///   签名算法 = ed25519,签名值 = 标准 base64
///   四个头   = x-bitbot-device / x-bitbot-timestamp / x-bitbot-nonce / x-bitbot-signature
///
/// 差一个换行,真机上就是**永久 401**,而两边的单测都会绿着 ——
/// 所以 `scripts/prove_ios_device_identity.js` 把这一条钉在门禁里。
struct DeviceIdentity {
    /// 设备密钥 id(桌面配对时下发;没配对时为空 ⇒ 这台设备还不会签名)。
    let deviceId: String
    /// 32 字节 ed25519 种子(私钥的源头)。只在内存与 Keychain 里出现。
    let seed: Data
    let name: String
    let kind: String
    let createdAt: String

    /// X.509 SubjectPublicKeyInfo 的固定外壳:
    /// SEQUENCE{ SEQUENCE{ OID 1.3.6.1.4.1.1902 } } + BIT STRING(32)。
    /// 与 Node `crypto.export({type:"spki",format:"pem"})` 产出的 DER 完全一致。
    static let spkiPrefix: [UInt8] = [
        0x30, 0x2A, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65, 0x70, 0x03, 0x21, 0x00,
    ]

    /// 一次请求要挂的四个设备凭证头。
    struct RequestHeaders {
        let deviceId: String
        let timestamp: String
        let nonce: String
        /// base64(标准字母表,与服务端 Buffer.from(sig,"base64") 同一个)。
        let signature: String

        /// 头名 —— 必须与服务端读取的名字一致。
        var headerFields: [String: String] {
            [
                "x-bitbot-device": deviceId,
                "x-bitbot-timestamp": timestamp,
                "x-bitbot-nonce": nonce,
                "x-bitbot-signature": signature,
            ]
        }
    }

    /// 私钥(CryptoKit 的 ed25519 就是 Curve25519.Signing)。
    var privateKey: Curve25519.Signing.PrivateKey? {
        try? Curve25519.Signing.PrivateKey(rawRepresentation: seed)
    }

    /// SPKI 公钥 PEM —— 逐字符等于 Node 导出的那串(配对时发给桌面登记)。
    var publicKeyPem: String {
        guard let key = privateKey else { return "" }
        let der = Data(DeviceIdentity.spkiPrefix) + key.publicKey.rawRepresentation
        let b64 = der.base64EncodedString()
        var folded = ""
        var index = b64.startIndex
        while index < b64.endIndex {
            let end = b64.index(index, offsetBy: 64, limitedBy: b64.endIndex) ?? b64.endIndex
            folded += b64[index..<end] + "\n"
            index = end
        }
        return "-----BEGIN PUBLIC KEY-----\n" + folded + "-----END PUBLIC KEY-----\n"
    }

    /// 被签的那串字节 —— 必须与服务端 `device_keys.js:signingPayload` 逐字节相同。
    static func signingPayload(deviceId: String, timestamp: String, nonce: String, body: Data) -> Data {
        let head = Data((deviceId + "\n" + timestamp + "\n" + nonce + "\n").utf8)
        return head + body
    }

    /// 构造四个签名头。没配对(没有 deviceId)⇒ 返回 nil ⇒ 这台设备还不会签名。
    func requestHeaders(body: Data) -> RequestHeaders? {
        let trimmed = deviceId.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        guard let key = privateKey else { return nil }
        let timestamp = String(Int(Date().timeIntervalSince1970 * 1000))
        let nonce = "ios-" + DeviceIdentity.randomHex(12)
        let payload = DeviceIdentity.signingPayload(
            deviceId: trimmed, timestamp: timestamp, nonce: nonce, body: body
        )
        guard let signature = try? key.signature(for: payload) else { return nil }
        return RequestHeaders(
            deviceId: trimmed,
            timestamp: timestamp,
            nonce: nonce,
            signature: Data(signature).base64EncodedString()
        )
    }

    static func randomHex(_ byteCount: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - 存储

    private static let service = "com.bitbot.host.device-identity"
    private static let account = "seed"

    /// 存进 Keychain —— 私钥不进 UserDefaults、不进日志、不进任何明文文件。
    static func save(_ identity: DeviceIdentity) {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = identity.seed
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(query as CFDictionary, nil)
        UserDefaults.standard.set(identity.deviceId, forKey: "bitbot.device.id")
        UserDefaults.standard.set(identity.name, forKey: "bitbot.device.name")
        UserDefaults.standard.set(identity.kind, forKey: "bitbot.device.kind")
        UserDefaults.standard.set(identity.createdAt, forKey: "bitbot.device.createdAt")
    }

    /// 读出来。没配对过 ⇒ nil。
    static func load() -> DeviceIdentity? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let seed = item as? Data,
              seed.count == 32 else { return nil }
        let defaults = UserDefaults.standard
        return DeviceIdentity(
            deviceId: defaults.string(forKey: "bitbot.device.id") ?? "",
            seed: seed,
            name: defaults.string(forKey: "bitbot.device.name") ?? "iPhone",
            kind: defaults.string(forKey: "bitbot.device.kind") ?? "ios",
            createdAt: defaults.string(forKey: "bitbot.device.createdAt") ?? ""
        )
    }

    /// 桌面配对成功时下发 deviceId(和 Android 的 `DeviceIdentity.save(issuedDeviceId)` 同一件事)。
    static func adoptIssuedDeviceId(_ issued: String, name: String = "iPhone") -> DeviceIdentity? {
        guard var identity = load() else { return nil }
        let updated = DeviceIdentity(
            deviceId: issued,
            seed: identity.seed,
            name: name,
            kind: "ios",
            createdAt: identity.createdAt
        )
        save(updated)
        return updated
    }

    /// 首次启动:本地生成种子。**还没配对**(deviceId 为空)⇒ 发不了签名头。
    static func loadOrCreate() -> DeviceIdentity {
        if let existing = load() { return existing }
        let identity = DeviceIdentity(
            deviceId: "",
            seed: randomBytes(32),
            name: "iPhone",
            kind: "ios",
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
        save(identity)
        return identity
    }

    static func randomBytes(_ count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes)
    }
}
