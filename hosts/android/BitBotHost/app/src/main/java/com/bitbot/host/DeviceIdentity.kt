package com.bitbot.host

import android.content.Context
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.Base64

/**
 * 这台设备上的一份账号（W3 / 路线 A「账号 = 设备」）。
 *
 * 形状与服务端同源（hosts/shared/device_keys.js）：
 *   · 一对 ed25519 密钥；**私钥永不出设备**，配对时只把公钥（SPKI PEM）交给桌面；
 *   · 签的内容是 `deviceId + "\n" + ts + "\n" + nonce + "\n" + body` 这四段拼出来的字节 ——
 *     换 id、换时间戳、换 nonce、改请求体，服务端全部验不过；
 *   · 身份（`deviceId`）**由桌面在配对回执里派发**（服务端从公钥指纹派生），手机不许自报。
 *
 * 为什么不是「拿 bearer 就够了」：bearer 是一把共享静态令牌，桌面只知道「拿着它的人」，
 * 不知道来的是哪台设备 —— 于是不能单独吊销（换令牌会踢掉所有设备），也不能把「谁下的单」
 * 与「谁该看见进度」绑到机器身份上。这三件都是远程控制自己的机器这件事的前提。
 *
 * 存哪、怎么存：只落 `context.filesDir` 一个文件（应用私有目录，不进外部存储），
 * 内容里就是种子 + 公钥 + 桌面派发的那个 id。诚实边界：Android 沙箱外的可读性
 * （root 设备、允许 backup 的备份）这一层管不了，登记在 §8.64 残留。
 */
data class DeviceCredentials(
  /** 32 字节 ed25519 种子（私钥的源头）。只在内存与 filesDir 里出现。 */
  val seed: ByteArray,
  /** SPKI 公钥 PEM —— 逐字符等于 Node `crypto` 导出的那串（配对时发给桌面登记）。 */
  val publicKeyPem: String,
  /** 桌面派发的设备身份；没配对成功时为 null ⇒ 这台设备还不会签名。 */
  val deviceId: String?,
  val name: String,
  val kind: String,
  val createdAt: String,
) {
  override fun equals(other: Any?): Boolean =
    other is DeviceCredentials &&
      seed.contentEquals(other.seed) &&
      publicKeyPem == other.publicKeyPem &&
      deviceId == other.deviceId &&
      name == other.name &&
      kind == other.kind

  override fun hashCode(): Int =
    seed.contentHashCode() * 31 + publicKeyPem.hashCode()
}

/** 一次请求要挂的四个设备凭证头（服务端口径：x-bitbot-device / timestamp / nonce / signature）。 */
data class DeviceRequestHeaders(
  val deviceId: String,
  val timestamp: String,
  val nonce: String,
  /** base64（标准字母表，与服务端 Buffer.from(sig,"base64") 同一个）。 */
  val signature: String,
)

object DeviceIdentity {
  private const val FILE_NAME = "device-identity.json"
  private const val SEED_BYTES = 32

  /** X.509 SubjectPublicKeyInfo 的固定外壳：SEQUENCE{ SEQUENCE{ OID 1.3.6.1.4.1.1902 } } + BIT STRING(32)。 */
  private val SPKI_PREFIX = byteArrayOf(
    0x30, 0x2A, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65, 0x70, 0x03, 0x21, 0x00,
  )

  @Volatile private var cache: DeviceCredentials? = null
  @Volatile private var cacheLoaded = false

  /** 单测用：把进程级缓存清掉（每个用例从盘上重新读一份身份）。 */
  fun resetForTest() {
    cache = null
    cacheLoaded = false
  }

  fun identityFile(context: Context): File = File(context.filesDir, FILE_NAME)

  /* ------------------------------------------------------------------ 密码学 */

  /**
   * 被签的那串字节 —— 必须与服务端 `device_keys.js:signingPayload` 逐字节相同。
   * 这是整个 W3 最细的一条线：差一个换行，真机上就是永久 401，而两边的单测都会绿着。
   * 所以它同时被三处钉住：端上金标（DeviceIdentityTest DI-02/DI-04）、
   * Node 侧（prove_w3_device_trust WD-10 重算金标）、真发一次（DeviceTrustWiringTest DT-01）。
   */
  fun signingPayload(deviceId: String, timestamp: String, nonce: String, body: ByteArray): ByteArray =
    (deviceId + "\n" + timestamp + "\n" + nonce + "\n").toByteArray(Charsets.UTF_8) + body

  fun publicKeyFromSeed(seed: ByteArray): ByteArray =
    Ed25519PrivateKeyParameters(seed, 0).generatePublicKey().encoded

  /** SPKI PEM，逐字符对齐 Node 的 `export({type:"spki",format:"pem"})`：64 字符一折行、结尾一个换行。 */
  fun publicPemFromSeed(seed: ByteArray): String {
    val der = SPKI_PREFIX + publicKeyFromSeed(seed)
    val b64 = Base64.getEncoder().encodeToString(der)
    val folded = b64.chunked(64).joinToString("\n")
    return "-----BEGIN PUBLIC KEY-----\n$folded\n-----END PUBLIC KEY-----\n"
  }

  /** 从 SPKI PEM 取回 32 字节公钥；外壳不对就回 null（不猜、不修）。 */
  fun publicKeyFromPem(pem: String): ByteArray? =
    runCatching {
      val body = pem
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replace("\\s".toRegex(), "")
      val der = Base64.getDecoder().decode(body)
      if (der.size != SPKI_PREFIX.size + 32) return@runCatching null
      if (!der.copyOfRange(0, SPKI_PREFIX.size).contentEquals(SPKI_PREFIX)) return@runCatching null
      der.copyOfRange(SPKI_PREFIX.size, der.size)
    }.getOrNull()

  fun signPayload(seed: ByteArray, payload: ByteArray): ByteArray {
    val signer = Ed25519Signer()
    signer.init(true, Ed25519PrivateKeyParameters(seed, 0))
    signer.update(payload, 0, payload.size)
    return signer.generateSignature()
  }

  /** 端上自检用（也用于测试的反向对照）：验一个 PEM 与签名的配对。 */
  fun verify(publicKeyPem: String, payload: ByteArray, signature: ByteArray): Boolean {
    val pub = publicKeyFromPem(publicKeyPem) ?: return false
    return runCatching {
      val signer = Ed25519Signer()
      signer.init(false, Ed25519PublicKeyParameters(pub, 0))
      signer.update(payload, 0, payload.size)
      signer.verifySignature(signature)
    }.getOrDefault(false)
  }

  /* ------------------------------------------------------------------ 身份 */

  fun fromSeed(
    seed: ByteArray,
    name: String,
    kind: String = "android",
    deviceId: String? = null,
    createdAt: String = "",
  ): DeviceCredentials =
    DeviceCredentials(
      seed = seed.copyOf(),
      publicKeyPem = publicPemFromSeed(seed),
      deviceId = deviceId,
      name = name,
      kind = kind,
      createdAt = if (createdAt.isBlank()) nowIso() else createdAt,
    )

  /** 本地有没有一份身份 —— 不生成。签名路径只认这个（生成是配对那一步的事）。 */
  fun current(context: Context?): DeviceCredentials? {
    if (context == null) return null
    if (cacheLoaded) return cache
    val creds = readFrom(context)
    cache = creds
    cacheLoaded = true
    return creds
  }

  /**
   * 第一次配对时用（以及测试里）：没有就生成一把并落盘。
   *
   * 关键取舍：**文件存在但读坏了，绝不重新生成**。重新生成看起来「自愈」，实际是把
   * 桌面已经登记的那台设备悄悄丢掉 —— 用户下次看到的是 unknown_device，而且原来的种子
   * 已经被覆盖、无从追查。宁可如实回 null（这一层就是「这台手机现在没有可用身份」），
   * 让配对那一步去问用户。
   */
  fun loadOrCreate(context: Context): DeviceCredentials? {
    current(context)?.let { return it }
    if (identityFile(context).exists()) return null // 坏文件：不覆盖、不假装 healed
    val seed = ByteArray(SEED_BYTES).also { SecureRandom().nextBytes(it) }
    val creds = fromSeed(seed, name = defaultDeviceName(), kind = "android")
    save(context, creds)
    return creds
  }

  fun save(context: Context, credentials: DeviceCredentials) {
    val obj = JSONObject()
      .put("v", 1)
      .put("seed_b64", Base64.getEncoder().encodeToString(credentials.seed))
      .put("public_key_pem", credentials.publicKeyPem)
      .put("kind", credentials.kind)
      .put("name", credentials.name)
      .put("created_at", credentials.createdAt)
    if (credentials.deviceId != null) obj.put("device_id", credentials.deviceId)
    val file = identityFile(context)
    file.parentFile?.mkdirs()
    file.writeText(obj.toString(2), Charsets.UTF_8)
    // 尽量收紧权限；失败不致命（应用私有目录本身已是沙箱内），但也不假装成功。
    runCatching {
      file.setReadable(false, false)
      file.setReadable(true, true)
      file.setWritable(false, false)
      file.setWritable(true, true)
    }
    cache = credentials
    cacheLoaded = true
  }

  private fun readFrom(context: Context): DeviceCredentials? =
    runCatching {
      val file = identityFile(context)
      if (!file.isFile) return@runCatching null
      val obj = JSONObject(file.readText(Charsets.UTF_8))
      val seed = Base64.getDecoder().decode(obj.getString("seed_b64"))
      if (seed.size != SEED_BYTES) return@runCatching null
      val pem = obj.optString("public_key_pem")
      if (pem.isBlank()) return@runCatching null
      // 自一致性：公钥必须由这把种子推出来。不一致说明文件被动过 —— 当作没有身份。
      if (publicPemFromSeed(seed) != pem) return@runCatching null
      DeviceCredentials(
        seed = seed,
        publicKeyPem = pem,
        deviceId = obj.optString("device_id").trim().ifEmpty { null },
        name = obj.optString("name").ifBlank { "android 设备" },
        kind = obj.optString("kind").ifBlank { "android" },
        createdAt = obj.optString("created_at"),
      )
    }.getOrNull()

  /* ------------------------------------------------------------------ 请求头 */

  /**
   * 为一次请求签四个头。没有身份 / 桌面还没派发身份 ⇒ 返回 null，调用方回落到 bearer。
   *
   * nonce 每次现取（服务端有重放保护，撞一次就是一条 nonce_reused），
   * 时间戳每次现取（服务端按 5 分钟偏差判）—— 所以重连一条 SSE 也必须重新签，
   * 不能把上一次的头抄过来。
   */
  fun requestHeaders(context: Context?, body: ByteArray): DeviceRequestHeaders? {
    val creds = current(context) ?: return null
    val deviceId = creds.deviceId?.trim()
    if (deviceId.isNullOrEmpty()) return null
    val ts = System.currentTimeMillis().toString()
    val nonce = "and-" + randomHex(12)
    val payload = signingPayload(deviceId, ts, nonce, body)
    val sig = Base64.getEncoder().encodeToString(signPayload(creds.seed, payload))
    return DeviceRequestHeaders(deviceId, ts, nonce, sig)
  }

  /** 把签名头挂到连接上（与 bearer 同时存在时，桌面按登记表决定信哪个）。 */
  fun applyHeaders(
    setter: (String, String) -> Unit,
    headers: DeviceRequestHeaders?,
  ): Boolean {
    if (headers == null) return false
    setter("x-bitbot-device", headers.deviceId)
    setter("x-bitbot-timestamp", headers.timestamp)
    setter("x-bitbot-nonce", headers.nonce)
    setter("x-bitbot-signature", headers.signature)
    return true
  }

  private fun randomHex(bytes: Int): String {
    val buf = ByteArray(bytes)
    SecureRandom().nextBytes(buf)
    return buf.joinToString("") { "%02x".format(it) }
  }

  private fun defaultDeviceName(): String =
    runCatching { android.os.Build.MODEL?.takeIf { it.isNotBlank() } ?: "android 设备" }
      .getOrDefault("android 设备")

  private fun nowIso(): String = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
    .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
    .format(java.util.Date())
}
