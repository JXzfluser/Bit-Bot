package com.bitbot.host

/**
 * GENERATED —— 由 `node scripts/gen_device_signature_vectors.mjs --write` 生成，不要手改。
 *
 * 这是 A2-3（端侧 ed25519 签名）的跨语言金标：Node 侧 hosts/shared/device_keys.js 是预言机。
 * 端上实现（DeviceIdentity.kt）必须用同一个 seed 推导出同样的公钥，并签出**逐字节相同**的签名。
 * ed25519 是确定性签名（RFC 8032），没有随机数：不一样就是实现错了，不存在「等价但不同」。
 *
 * 这个 seed 是测试派生的（sha256("bitbot-a23-device-signature-golden-seed")），不是任何真实设备的密钥。
 * prove_w3_device_trust 的 WD-10 会拿 Node 现行代码重算一遍并与此文件比对：
 * 改了签名约定却不打算改端上，这里就会红。
 */
object DeviceSignatureVectors {
  /** 32 字节 ed25519 seed（hex）。 */
  const val SEED_HEX: String = "d7f8b9db5d2d91677c3141560266a2ee18d862e5fcf2f499bc02b2adef96da1f"
  /** Node crypto 导出的 SPKI PEM —— 端上必须逐字符拼出同一串（含结尾换行）。 */
  const val PUBLIC_KEY_PEM: String = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA2j2OnYF+dUvruZtkwnQnPSi5pi0UT4zRNgO8r/weHm8=\n-----END PUBLIC KEY-----\n"
  const val DEVICE_ID: String = "dev-android-a23golden"
  const val TIMESTAMP: String = "1730000000000"
  const val NONCE: String = "nonce-a23-0001"

  /** 一条金标：请求体原文 + Node 用同一 seed 签出的 base64 签名。 */
  data class Vector(val label: String, val body: String, val signatureBase64: String)

  val VECTORS: List<Vector> = listOf(
    Vector(
      label = "POST /v1/turn —— 纯 ASCII 请求体",
      body = "{\"text\":\"hello\",\"machine_kind\":\"android\",\"session_id\":\"mobile-android\"}",
      signatureBase64 = "eQw31PHzVQNMgInS5JuvkdrgIMKU8f3mvz2/h/9Evd9sDoP2Xpf/b/wKpwWc8h6nNt6di5l1T7pa5GzmDkUADw==",
    ),
    Vector(
      label = "POST /v1/turn —— 中文多字节请求体（UTF-8 字节数 ≠ 字符数）",
      body = "{\"text\":\"帮我查一下今天的天气，并提醒我带伞\",\"machine_kind\":\"android\",\"session_id\":\"mobile-android\"}",
      signatureBase64 = "JGw5iJmd/aQemYPjhtEnyGNCoxF3nkztOAf2hXjSJcgXLhGI0E0BB8GYxt8MGoMsl1u4JFXYRjOLbm2UbfqqAw==",
    ),
    Vector(
      label = "GET /v1/events —— 空请求体（签的必须只有三行前缀）",
      body = "",
      signatureBase64 = "LTwy6U3ZOtds90QLdDFd3JekqsDdcmCuLl030ImeOOiWsR+TnJdumogw+k+e2hMi4AX7q3o34X7pNbI5LnESCg==",
    ),
  )
}
