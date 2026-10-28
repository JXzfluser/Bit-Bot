package com.bitbot.host

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pairing v1 纯逻辑单测 —— 钉住 /24 枚举、应答解析、码校验、错误映射。
 *
 * 修复前红（编译期红 —— 函数还不存在，unresolved reference: enumerateSubnet24 等）：
 *   所有 @Test 在 DesktopPairing object 创建前都无法编译。
 *
 * 修复后绿：以下每条测试在实现完成后全部通过。
 *
 * 诚实边界：
 *   - 网络扫描（scanForDesktops / probeDesktop）需要真机 Wi-Fi，JVM 单测不覆盖；
 *   - redeemCode / completePairing 需要真桌面服务在跑，JVM 单测不覆盖；
 *   - 桌面侧 /v1/pair 端点可能还没上（另一个 agent 正在改桌面侧），
 *     集成部分留一句诚实残留。
 */
class PairingDiscoveryTest {

  // ========== /24 枚举 ==========

  @Test
  fun `枚举同 _24 子网候选主机 1 到 254 排除 _0 和 _255`() {
    val candidates = DesktopPairing.enumerateSubnet24("192.168.1.100")
    assertEquals(254, candidates.size)
    assertEquals("192.168.1.1", candidates.first())
    assertEquals("192.168.1.254", candidates.last())
    assertFalse("不许包含 .0", candidates.any { it.endsWith(".0") })
    assertFalse("不许包含 .255", candidates.any { it.endsWith(".255") })
  }

  @Test
  fun `枚举不同子网前缀`() {
    val candidates = DesktopPairing.enumerateSubnet24("10.0.2.15")
    assertEquals(254, candidates.size)
    assertTrue(candidates.all { it.startsWith("10.0.2.") })
    assertEquals("10.0.2.1", candidates.first())
    assertEquals("10.0.2.254", candidates.last())
  }

  @Test
  fun `非法 IP 返回空列表`() {
    assertTrue(DesktopPairing.enumerateSubnet24("").isEmpty())
    assertTrue(DesktopPairing.enumerateSubnet24("not.an.ip").isEmpty())
    assertTrue(DesktopPairing.enumerateSubnet24("192.168.1").isEmpty())
    assertTrue(DesktopPairing.enumerateSubnet24("192.168.1.1.5").isEmpty())
    assertTrue(DesktopPairing.enumerateSubnet24("256.168.1.1").isEmpty())
    assertTrue(DesktopPairing.enumerateSubnet24("192.168.1.-1").isEmpty())
    assertTrue(DesktopPairing.enumerateSubnet24("192.168.1.abc").isEmpty())
  }

  @Test
  fun `不猜别的网段只枚举同 _24`() {
    val candidates = DesktopPairing.enumerateSubnet24("172.16.5.200")
    assertTrue(candidates.all { it.startsWith("172.16.5.") })
    assertFalse("不许枚举 172.16.4.x", candidates.any { it.startsWith("172.16.4.") })
    assertFalse("不许枚举 172.16.6.x", candidates.any { it.startsWith("172.16.6.") })
  }

  // ========== 6 位码校验 ==========

  @Test
  fun `合法 6 位数字码通过校验`() {
    assertTrue(DesktopPairing.isValidPairingCode("482913"))
    assertTrue(DesktopPairing.isValidPairingCode("000000"))
    assertTrue(DesktopPairing.isValidPairingCode("999999"))
    assertTrue(DesktopPairing.isValidPairingCode(" 123456 "))
  }

  @Test
  fun `非法码不通过校验`() {
    assertFalse(DesktopPairing.isValidPairingCode(""))
    assertFalse(DesktopPairing.isValidPairingCode("12345"))
    assertFalse(DesktopPairing.isValidPairingCode("1234567"))
    assertFalse(DesktopPairing.isValidPairingCode("abcdef"))
    assertFalse(DesktopPairing.isValidPairingCode("12345a"))
    assertFalse(DesktopPairing.isValidPairingCode("12 345"))
  }

  // ========== discover 应答解析 ==========

  @Test
  fun `解析合法的 discover 应答`() {
    val json = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("name", "ZFL-PC")
      .put("version", 1)
      .put("port", 18765)
      .put("pairing", JSONObject()
        .put("code_active", true)
        .put("expires_in_ms", 214377))
      .toString()

    val result = DesktopPairing.parseDiscoverResponse(json, "192.168.1.10")
    assertNotNull(result)
    assertEquals("ZFL-PC", result!!.name)
    assertEquals("192.168.1.10", result.ip)
    assertEquals(18765, result.port)
    assertTrue(result.codeActive)
    assertEquals(214377L, result.expiresInMillis)
  }

  @Test
  fun `code_active 为 false 时 expires_in_ms 为 0`() {
    val json = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("name", "MyPC")
      .put("port", 18765)
      .put("pairing", JSONObject()
        .put("code_active", false)
        .put("expires_in_ms", 0))
      .toString()

    val result = DesktopPairing.parseDiscoverResponse(json, "10.0.0.5")
    assertNotNull(result)
    assertFalse(result!!.codeActive)
    assertEquals(0L, result.expiresInMillis)
  }

  @Test
  fun `缺少必要字段返回 null`() {
    // 缺 name
    val noName = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("port", 18765)
      .put("pairing", JSONObject().put("code_active", true))
      .toString()
    assertNull(DesktopPairing.parseDiscoverResponse(noName, "1.2.3.4"))

    // 缺 port
    val noPort = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("name", "PC")
      .put("pairing", JSONObject().put("code_active", true))
      .toString()
    assertNull(DesktopPairing.parseDiscoverResponse(noPort, "1.2.3.4"))

    // 缺 pairing
    val noPairing = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("name", "PC")
      .put("port", 18765)
      .toString()
    assertNull(DesktopPairing.parseDiscoverResponse(noPairing, "1.2.3.4"))
  }

  @Test
  fun `ok 为 false 返回 null`() {
    val json = JSONObject()
      .put("ok", false)
      .put("service", "bitbot-desktop")
      .put("name", "PC")
      .put("port", 18765)
      .put("pairing", JSONObject().put("code_active", true))
      .toString()
    assertNull(DesktopPairing.parseDiscoverResponse(json, "1.2.3.4"))
  }

  @Test
  fun `service 不是 bitbot-desktop 返回 null`() {
    val json = JSONObject()
      .put("ok", true)
      .put("service", "other-service")
      .put("name", "PC")
      .put("port", 18765)
      .put("pairing", JSONObject().put("code_active", true))
      .toString()
    assertNull(DesktopPairing.parseDiscoverResponse(json, "1.2.3.4"))
  }

  @Test
  fun `port 不合法返回 null`() {
    val json = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("name", "PC")
      .put("port", 0)
      .put("pairing", JSONObject().put("code_active", true))
      .toString()
    assertNull(DesktopPairing.parseDiscoverResponse(json, "1.2.3.4"))

    val json2 = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("name", "PC")
      .put("port", 70000)
      .put("pairing", JSONObject().put("code_active", true))
      .toString()
    assertNull(DesktopPairing.parseDiscoverResponse(json2, "1.2.3.4"))
  }

  @Test
  fun `字段缺失如实丢弃不脑补`() {
    // pairing 里缺 expires_in_ms，应该默认为 0 而不是脑补
    val json = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("name", "PC")
      .put("port", 18765)
      .put("pairing", JSONObject().put("code_active", true))
      .toString()

    val result = DesktopPairing.parseDiscoverResponse(json, "1.2.3.4")
    assertNotNull(result)
    assertEquals(0L, result!!.expiresInMillis)
  }

  @Test
  fun `非法 JSON 返回 null 不崩溃`() {
    assertNull(DesktopPairing.parseDiscoverResponse("not json", "1.2.3.4"))
    assertNull(DesktopPairing.parseDiscoverResponse("", "1.2.3.4"))
    assertNull(DesktopPairing.parseDiscoverResponse("{broken", "1.2.3.4"))
  }

  // ========== redeem 失败映射 ==========

  @Test
  fun `invalid_code 映射到人话`() {
    val failure = DesktopPairing.mapRedeemFailure(
      400,
      JSONObject().put("ok", false).put("error", "invalid_code").toString()
    )
    assertTrue(failure is DesktopPairing.RedeemFailure.InvalidCode)
    assertTrue(failure.userMessage.contains("配对码不对"))
  }

  @Test
  fun `invalid_code 带剩余次数`() {
    val failure = DesktopPairing.mapRedeemFailure(
      400,
      JSONObject().put("ok", false).put("error", "invalid_code").toString(),
      attemptsLeft = 3
    )
    assertTrue(failure is DesktopPairing.RedeemFailure.InvalidCode)
    assertTrue(failure.userMessage.contains("还剩 3 次机会"))
  }

  @Test
  fun `attempts_exceeded 映射到人话`() {
    val failure = DesktopPairing.mapRedeemFailure(
      400,
      JSONObject().put("ok", false).put("error", "attempts_exceeded").toString()
    )
    assertTrue(failure is DesktopPairing.RedeemFailure.AttemptsExceeded)
    assertTrue(failure.userMessage.contains("已失效"))
    assertTrue(failure.userMessage.contains("重新生成"))
  }

  @Test
  fun `bad_request 映射到人话`() {
    val failure = DesktopPairing.mapRedeemFailure(
      400,
      JSONObject().put("ok", false).put("error", "bad_request").toString()
    )
    assertTrue(failure is DesktopPairing.RedeemFailure.BadRequest)
    assertTrue(failure.userMessage.contains("格式"))
  }

  @Test
  fun `pairing_not_open 映射到人话`() {
    val failure = DesktopPairing.mapRedeemFailure(
      409,
      JSONObject().put("ok", false).put("error", "pairing_not_open").toString()
    )
    assertTrue(failure is DesktopPairing.RedeemFailure.PairingNotOpen)
    assertTrue(failure.userMessage.contains("允许手机连接"))
  }

  @Test
  fun `四种失败彼此能区分`() {
    val failures = listOf(
      DesktopPairing.mapRedeemFailure(400, """{"error":"invalid_code"}"""),
      DesktopPairing.mapRedeemFailure(400, """{"error":"attempts_exceeded"}"""),
      DesktopPairing.mapRedeemFailure(400, """{"error":"bad_request"}"""),
      DesktopPairing.mapRedeemFailure(409, """{"error":"pairing_not_open"}"""),
    )
    val messages = failures.map { it.userMessage }
    assertEquals(4, messages.toSet().size)
  }

  @Test
  fun `未知错误码归为 BadRequest`() {
    val failure = DesktopPairing.mapRedeemFailure(
      400,
      JSONObject().put("ok", false).put("error", "unknown_error").toString()
    )
    assertTrue(failure is DesktopPairing.RedeemFailure.BadRequest)
  }

  @Test
  fun `非 4xx 状态码归为 NetworkError`() {
    val failure = DesktopPairing.mapRedeemFailure(500, """{"error":"internal"}""")
    assertTrue(failure is DesktopPairing.RedeemFailure.NetworkError)
    assertTrue(failure.userMessage.contains("500"))
  }

  @Test
  fun `错误体不是合法 JSON 时不崩溃`() {
    val failure = DesktopPairing.mapRedeemFailure(400, "not json")
    assertTrue(failure is DesktopPairing.RedeemFailure.BadRequest)
  }
}
