package com.bitbot.host

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.util.Base64

/**
 * A2-3：手机上这把钥匙，得真的能签出服务端认得的那串字节。
 *
 * 为什么单独一类：W3 服务端那三件（配对即登记 / 热生效 / 401 说人话）都在 Node 层验过了，
 * 但**端上不会签名的话，那三件对用户是零收益** —— 手机仍然只拿得到 bearer，
 * 登记表永远空着，「账号 = 设备」就是一句设计文档。
 *
 * 判据为什么是金标（DeviceSignatureVectors.kt，由 scripts/gen_device_signature_vectors.mjs 生成）：
 * 两边各测各的最容易坏在约定上（分隔符、UTF-8、空 body、base64）。ed25519 是确定性签名
 * （RFC 8032，无随机数），所以「Node 签出来的是这串」与「手机签出来的必须是同一串」
 * 之间没有等价空间 —— 逐字节比对是唯一诚实的判据。
 *
 * 覆盖：
 *   DI-01 同一个 seed 必须推出与 Node 完全一致的 SPKI 公钥 PEM（逐字符，含结尾换行）
 *   DI-02 三条金标 payload 必须签出逐字节相同的签名（ASCII / 中文多字节 / 空 body）
 *   DI-03 验签有牙：改 body、改 deviceId、改 ts、改 nonce 都必须验不过
 *   DI-04 签名内容（那串字节）必须等于 device\n ts\n nonce\n body —— 与服务端 device_keys.js:123 同形
 *   DI-05 身份要活得过重启：读回来是同一把种子，不重复生成，只落一个文件
 *   DI-06 私钥只落在应用私有目录（filesDir），不进外部存储；文件里也不许出现公钥以外的秘密外泄
 *   DI-07 文件在但读坏了 ⇒ 不许悄悄换一把新钥匙（那等于把已登记的设备弄丢），如实回「没有可用身份」
 *   DI-08 服务端没派发身份之前不签名（否则真机上是一串永远 401 的 unknown_device）
 *   DI-09 nonce 每次必须新（重放保护靠它）；同一请求重签两次不许撞 nonce
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DeviceIdentityTest {

  private lateinit var filesDir: File

  @Before
  fun `每个用例从干净的身份开始`() {
    DeviceIdentity.resetForTest()
    val ctx = RuntimeEnvironment.getApplication()
    filesDir = ctx.filesDir
    filesDir.listFiles()?.forEach { it.delete() }
  }

  @After
  fun `收尾也清干净`() {
    DeviceIdentity.resetForTest()
    filesDir.listFiles()?.forEach { it.delete() }
  }

  private fun keyFromGoldenSeed(): DeviceCredentials {
    // 金标里的 seed 是 hex（Node 侧 sha256 派生后 hex 表示），这里直接转回字节；
    // 两边各抄一种表示法（一个 hex 一个 base64）正是最容易悄悄错开的地方。
    val seed = hexToBytes(DeviceSignatureVectors.SEED_HEX)
    assertEquals("金标 seed 必须是 32 字节", 32, seed.size)
    return DeviceIdentity.fromSeed(seed, name = "golden", kind = "android")
  }

  private fun hexToBytes(hex: String): ByteArray =
    ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

  @Test
  fun `DI-01 同一个 seed 必须推出与 Node 一致的 SPKI 公钥 PEM`() {
    val creds = keyFromGoldenSeed()
    assertEquals(
      "公钥 PEM 必须逐字符等于 Node crypto 导出的那串（服务端拿它验签；差一个换行就是 bad_signature）",
      DeviceSignatureVectors.PUBLIC_KEY_PEM,
      creds.publicKeyPem,
    )
    assertTrue("PEM 必须是 SPKI 公钥外壳", creds.publicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----"))
  }

  @Test
  fun `DI-02 三条金标必须签出逐字节相同的签名`() {
    val creds = keyFromGoldenSeed()
    for (v in DeviceSignatureVectors.VECTORS) {
      val payload = DeviceIdentity.signingPayload(
        DeviceSignatureVectors.DEVICE_ID,
        DeviceSignatureVectors.TIMESTAMP,
        DeviceSignatureVectors.NONCE,
        v.body.toByteArray(Charsets.UTF_8),
      )
      val sig = Base64.getEncoder().encodeToString(DeviceIdentity.signPayload(creds.seed, payload))
      assertEquals("「${v.label}」的签名必须与 Node 逐字节相同（ed25519 是确定性的，不存在等价但不同）", v.signatureBase64, sig)
    }
  }

  @Test
  fun `DI-03 验签必须有牙：动一个字节就不许过`() {
    val creds = keyFromGoldenSeed()
    val v = DeviceSignatureVectors.VECTORS.first()
    val sig = Base64.getDecoder().decode(v.signatureBase64)

    val good = DeviceIdentity.signingPayload(
      DeviceSignatureVectors.DEVICE_ID, DeviceSignatureVectors.TIMESTAMP, DeviceSignatureVectors.NONCE,
      v.body.toByteArray(Charsets.UTF_8),
    )
    assertTrue("金标自身必须验得过（否则 fixtures 是死的）", DeviceIdentity.verify(creds.publicKeyPem, good, sig))

    // 改 body 一字节
    val tamperedBody = v.body.dropLast(1) + "X"
    assertFalse(
      "改一个字节必须验不过",
      DeviceIdentity.verify(
        creds.publicKeyPem,
        DeviceIdentity.signingPayload(DeviceSignatureVectors.DEVICE_ID, DeviceSignatureVectors.TIMESTAMP, DeviceSignatureVectors.NONCE, tamperedBody.toByteArray(Charsets.UTF_8)),
        sig,
      ),
    )
    // 换 deviceId / ts / nonce —— 三段前缀都在签名内容里，任何一段变了都验不过
    for (mutate in listOf(
      DeviceIdentity.signingPayload("other-device", DeviceSignatureVectors.TIMESTAMP, DeviceSignatureVectors.NONCE, v.body.toByteArray(Charsets.UTF_8)),
      DeviceIdentity.signingPayload(DeviceSignatureVectors.DEVICE_ID, "1730000000001", DeviceSignatureVectors.NONCE, v.body.toByteArray(Charsets.UTF_8)),
      DeviceIdentity.signingPayload(DeviceSignatureVectors.DEVICE_ID, DeviceSignatureVectors.TIMESTAMP, "nonce-a23-0002", v.body.toByteArray(Charsets.UTF_8)),
    )) {
      assertFalse("换 id / 换时间戳 / 换 nonce 都必须验不过", DeviceIdentity.verify(creds.publicKeyPem, mutate, sig))
    }
  }

  @Test
  fun `DI-04 签的那串字节必须与服务端同形`() {
    val p = DeviceIdentity.signingPayload("dev-x", "1700000000000", "n1", "hi".toByteArray(Charsets.UTF_8))
    assertEquals(
      "deviceId\\nts\\nnonce\\n + body —— 与 hosts/shared/device_keys.js 的 signingPayload 一字不差",
      "dev-x\n1700000000000\nn1\nhi",
      String(p, Charsets.UTF_8),
    )
    val empty = DeviceIdentity.signingPayload("dev-x", "1700000000000", "n1", ByteArray(0))
    assertEquals("空 body（GET /v1/events）只许有三行前缀", "dev-x\n1700000000000\nn1\n", String(empty, Charsets.UTF_8))
  }

  @Test
  fun `DI-05 身份活得过重启，且只落一个文件`() {
    val ctx = RuntimeEnvironment.getApplication()
    val first = DeviceIdentity.loadOrCreate(ctx)
    assertNotNull("第一次必须能拿到身份", first)
    val again = DeviceIdentity.loadOrCreate(ctx)
    assertNotNull(again)
    assertEquals("第二次必须读回同一把种子（重复生成等于换了台设备）", first!!.seed.toList(), again!!.seed.toList())
    assertEquals(first.publicKeyPem, again.publicKeyPem)
    val identityFiles = filesDir.listFiles()?.filter { it.name.startsWith("device-identity") } ?: emptyList()
    assertEquals("身份只许一个文件，多了说明写了备份或写了外部目录", 1, identityFiles.size)
  }

  @Test
  fun `DI-06 私钥只落在应用私有目录`() {
    val ctx = RuntimeEnvironment.getApplication()
    val creds = DeviceIdentity.loadOrCreate(ctx)
    val file = DeviceIdentity.identityFile(ctx)
    assertTrue("身份文件必须在 filesDir 下：${file.absolutePath}", file.absolutePath.startsWith(ctx.filesDir.absolutePath))
    assertFalse(
      "不许落到外部存储（外部存储对其他应用与 adb backup 更可达）",
      file.absolutePath.contains("external", ignoreCase = true) ||
        file.absolutePath.startsWith("/sdcard") ||
        file.absolutePath.contains("Download"),
    )
    val text = file.readText(Charsets.UTF_8)
    assertTrue("文件里要有私钥种子（它就是设备的账号）", text.contains("seed_b64"))
    assertTrue("文件里要有公钥 PEM（配对时要发给桌面）", text.contains("public_key_pem"))
    // 诚实登记：这一层只能保证「不落外部目录」；Android 上 filesDir 的私密性由应用沙箱提供，
    // root 设备与 adb backup（若允许）仍是残留，见 report.md §8.64 残留。
    assertNotNull(creds)
  }

  @Test
  fun `DI-07 文件在但读坏了不许悄悄换一把新钥匙`() {
    val ctx = RuntimeEnvironment.getApplication()
    val file = DeviceIdentity.identityFile(ctx)
    file.parentFile?.mkdirs()
    val garbage = "{ 这不是 JSON, 而且缺 seed"
    file.writeText(garbage, Charsets.UTF_8)

    val creds = DeviceIdentity.loadOrCreate(ctx)
    assertNull("读不动就是没有可用身份（回落 bearer），不许当成「新设备」重新生成一把", creds)
    assertEquals("坏文件必须原样留着 —— 悄悄覆盖它等于把用户已登记的设备抹了，且不留任何线索", garbage, file.readText(Charsets.UTF_8))
  }

  @Test
  fun `DI-08 服务端派发身份之前不签名`() {
    val ctx = RuntimeEnvironment.getApplication()
    val creds = DeviceIdentity.loadOrCreate(ctx)!!
    assertNull(
      "刚生成本地钥匙时还没有 device.id：这时候签出来的头服务端只会回 unknown_device，不如先不签",
      DeviceIdentity.requestHeaders(ctx, ByteArray(0)),
    )

    val withId = creds.copy(deviceId = "dev-android-7fefcf233fb5")
    DeviceIdentity.save(ctx, withId)
    val headers = DeviceIdentity.requestHeaders(ctx, "{\"text\":\"hi\"}".toByteArray(Charsets.UTF_8))
    assertNotNull("拿到服务端派发的 id 之后就必须签", headers)
    assertEquals("签的身份必须是服务端派发那一个", withId.deviceId, headers!!.deviceId)
    assertTrue(headers.nonce.isNotBlank())
    assertTrue(headers.signature.isNotBlank())
    assertEquals("时间戳必须是毫秒数字（服务端按 5 分钟偏差判）", true, headers.timestamp.toLongOrNull()?.let { it > 0 } ?: false)
  }

  @Test
  fun `DI-09 nonce 每次必须新`() {
    val ctx = RuntimeEnvironment.getApplication()
    DeviceIdentity.save(ctx, DeviceIdentity.loadOrCreate(ctx)!!.copy(deviceId = "dev-android-nonce-test"))
    val seen = mutableSetOf<String>()
    repeat(50) {
      val h = DeviceIdentity.requestHeaders(ctx, ByteArray(0))
      assertNotNull(h)
      seen += h!!.nonce
    }
    assertEquals(
      "50 次请求 50 个 nonce —— 服务端有重放保护（nonce_reused），撞一次就是一条 401",
      50, seen.size,
    )
  }
}
