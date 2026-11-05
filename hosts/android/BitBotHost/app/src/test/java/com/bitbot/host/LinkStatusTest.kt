package com.bitbot.host

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A3-17 门禁：**「已配对」是历史，「连得上」才是现在**。
 *
 * 现场三条，逐条钉：
 *  ① 状态条写着「已配对」，发消息却 401 —— 因为 `paired` 只看 prefs 里两个字符串非空；
 *  ② 失败原因里夹着 `missing mobile_host runner at /data/.../hosts/mobile_host/run.js`，
 *    那是开发机的概念，真机上永远不存在；
 *  ③ invalid_token 的提示把人引去「重抄一遍令牌」，而真正该做的是重新配对。
 *
 * 全部纯 JVM：`LinkStatus` / `LinkProbe` 都不引用 Android 类。
 */
class LinkStatusTest {

  @After fun tearDown() = LinkStatus.reset()

  /* ---------------------------------------------------------------- LS-01 */

  @Test
  fun `LS-01 没探过就是不说话 —— 不许凭空显示在线`() {
    LinkStatus.reset()
    // 配了对，但一次都没探过：只能说「已配对」，不能加任何在线/离线结论。
    assertEquals("已配对", LinkStatus.label(paired = true, nowMs = 1_000))
    assertEquals("idle", LinkStatus.tone(paired = true, nowMs = 1_000))
    // 没配对：让调用方自己写「未配对」，这层不出声
    assertNull(LinkStatus.label(paired = false, nowMs = 1_000))
  }

  /* ---------------------------------------------------------------- LS-02 */

  @Test
  fun `LS-02 探到在线才算在线，且结论会过期`() {
    LinkStatus.reset()
    LinkStatus.online(nowMs = 10_000)
    assertEquals("已配对 · 在线", LinkStatus.label(paired = true, nowMs = 10_000 + 5_000))
    assertTrue(LinkStatus.snapshot().isReachable(10_000 + 5_000))

    // 超过保鲜期：不能还挂着绿灯骗人
    val stale = 10_000L + LinkStatus.STALE_AFTER_MS + 1
    assertEquals("已配对 · 待确认", LinkStatus.label(paired = true, nowMs = stale))
    assertFalse("过期的在线不能算连得上", LinkStatus.snapshot().isReachable(stale))
  }

  /* ---------------------------------------------------------------- LS-03 */

  @Test
  fun `LS-03 探活失败说人话，不甩「未知错误」`() {
    LinkStatus.reset()
    LinkStatus.offline("桌面没在跑或端口不对", nowMs = 1)
    assertEquals("已配对 · 桌面未响应（桌面没在跑或端口不对）", LinkStatus.label(paired = true, nowMs = 1))
    assertEquals("error", LinkStatus.tone(paired = true, nowMs = 1))
    // 没有原因时就只说未响应，不编一句「未知错误」
    LinkStatus.offline(null, nowMs = 1)
    assertEquals("已配对 · 桌面未响应", LinkStatus.label(paired = true, nowMs = 1))
  }

  /* ---------------------------------------------------------------- LS-04 */

  @Test
  fun `LS-04 401 是「桌面在线但凭证被拒」，不是掉线`() {
    LinkStatus.reset()
    LinkStatus.authRejected("invalid_token", nowMs = 5)
    val snap = LinkStatus.snapshot()
    // 能收到 401 就证明对面活着 —— 这条是旧实现最容易搞反的地方
    assertEquals(LinkStatus.Presence.ONLINE, snap.presence)
    assertEquals(LinkStatus.Auth.REJECTED, snap.auth)
    assertTrue(LinkStatus.label(paired = true, nowMs = 5)!!.startsWith("已配对 · 凭证被拒"))
    assertTrue(LinkStatus.label(paired = true, nowMs = 5)!!.contains("invalid_token"))
    assertEquals("error", LinkStatus.tone(paired = true, nowMs = 5))
  }

  /* ---------------------------------------------------------------- LS-05 */

  @Test
  fun `LS-05 探活通过不改凭证结论 —— 健康检查不代表桌面认这台手机`() {
    LinkStatus.reset()
    LinkStatus.authRejected("invalid_token", nowMs = 5)
    LinkStatus.online(nowMs = 9)
    // 桌面在、但凭证仍被拒：这句必须还在，否则用户会以为「探到在线就好了」
    assertEquals(LinkStatus.Auth.REJECTED, LinkStatus.snapshot().auth)
    assertEquals("已配对 · 凭证被拒（invalid_token）", LinkStatus.label(paired = true, nowMs = 9))
  }

  /* ---------------------------------------------------------------- LS-06 */

  @Test
  fun `LS-06 探活分类：2xx 与 401 都算桌面在；404 说明敲错了端口`() {
    assertEquals(LinkStatus.Presence.ONLINE, LinkStatus.classifyProbe(200, null).first)
    assertEquals(LinkStatus.Presence.ONLINE, LinkStatus.classifyProbe(401, null).first)
    assertEquals(LinkStatus.Presence.ONLINE, LinkStatus.classifyProbe(403, null).first)
    assertEquals(LinkStatus.Presence.OFFLINE, LinkStatus.classifyProbe(404, null).first)
    assertEquals("这个端口上没有 /healthz（404），可能不是 Desktop", LinkStatus.classifyProbe(404, null).second)
    // 异常也要翻人话
    assertEquals("桌面没在跑或端口不对", LinkStatus.classifyProbe(null, "java.net.ConnectException: Connection refused").second)
    assertEquals("没有回包", LinkStatus.classifyProbe(null, "java.net.SocketTimeoutException: timeout").second)
    assertEquals("地址解析不到", LinkStatus.classifyProbe(null, "java.net.UnknownHostException").second)
  }

  /* ---------------------------------------------------------------- LS-07 */

  @Test
  fun `LS-07 探活地址归一：已经带 v1-turn 的也要拼对 healthz`() {
    assertEquals("http://10.0.0.5:18765/healthz", LinkProbe.healthUrl("10.0.0.5:18765"))
    assertEquals("http://10.0.0.5:18765/healthz", LinkProbe.healthUrl("http://10.0.0.5:18765/v1/turn"))
    assertEquals("http://10.0.0.5:18765/healthz", LinkProbe.healthUrl("http://10.0.0.5:18765/"))
    assertNull(LinkProbe.healthUrl(null))
    assertNull(LinkProbe.healthUrl("   "))
  }

  /* ---------------------------------------------------------------- LS-08 */

  @Test
  fun `LS-08 探活用注入替身跑：成功置在线、异常置离线，且没配对时不探`() {
    LinkStatus.reset()
    // 没配对：不该发任何请求，也不该把状态写成离线
    var called = 0
    LinkProbe.probe(null, transport = { _, _ -> called++; LinkProbe.Raw(200, null) })
    assertEquals(0, called)
    assertEquals(LinkStatus.Presence.UNKNOWN, LinkStatus.snapshot().presence)

    // 配对且对端 200
    LinkProbe.probe("10.0.0.5:18765", transport = { _, _ -> LinkProbe.Raw(200, null) })
    assertEquals(LinkStatus.Presence.ONLINE, LinkStatus.snapshot().presence)

    // 抛异常 → 离线，原因来自异常分类
    LinkProbe.probe(
      "10.0.0.5:18765",
      transport = { _, _ -> throw java.net.ConnectException("Connection refused") },
    )
    assertEquals(LinkStatus.Presence.OFFLINE, LinkStatus.snapshot().presence)
    assertEquals("桌面没在跑或端口不对", LinkStatus.snapshot().detail)
  }

  /* ---------------------------------------------------------------- LS-09 */

  @Test
  fun `LS-09 回合结果记账：200 记接受、401 记被拒、404 不动凭证结论`() {
    LinkStatus.reset()
    TurnBridge.recordTurnOutcome("turn HTTP 200: {}")
    assertEquals(LinkStatus.Auth.ACCEPTED, LinkStatus.snapshot().auth)

    LinkStatus.reset()
    TurnBridge.recordTurnOutcome("turn HTTP 401: {\"ok\":false,\"error\":\"invalid_token\"}")
    assertEquals(LinkStatus.Auth.REJECTED, LinkStatus.snapshot().auth)
    assertEquals("invalid_token", LinkStatus.snapshot().detail)

    LinkStatus.reset()
    // 404 = 这个端口上不是桌面，属于找错门，不该被说成「凭证被拒」
    TurnBridge.recordTurnOutcome("turn HTTP 404: <html>not found</html>")
    assertEquals(LinkStatus.Auth.UNKNOWN, LinkStatus.snapshot().auth)

    // 不是 HTTP 层面的错（传输异常）：什么都不记
    LinkStatus.reset()
    TurnBridge.recordTurnOutcome("java.net.ConnectException: refused")
    assertEquals(LinkStatus.Auth.UNKNOWN, LinkStatus.snapshot().auth)
  }

  /* ---------------------------------------------------------------- LS-10 */

  @Test
  fun `LS-10 dev runner 不存在时，正式文案里不许出现它的路径`() {
    // 真机常态：没有仓库，就没有 mobile_host/run.js
    val text = TurnBridge.unpairedText("missing mobile_host runner at /data/app/hosts/mobile_host/run.js")
    assertFalse("未配对文案泄漏了 dev runner 路径：$text", text.contains("mobile_host"))
    assertFalse("未配对文案还在提 dev runner：$text", text.contains("dev runner"))
    assertTrue("该说的还是要说", text.contains("还没有配对"))

    val hint = TurnBridge.pairingHint(
      "turn HTTP 500: {}",
      "missing mobile_host runner at /data/app/hosts/mobile_host/run.js",
    )
    assertFalse("连不上文案泄漏了 dev runner 路径：$hint", hint.contains("mobile_host"))
    assertTrue("桌面自己的原因必须保留", hint.contains("桌面那边报"))
  }

  /* ---------------------------------------------------------------- LS-11 */

  @Test
  fun `LS-11 invalid_token 的提示指向重新配对，而不是只让人重抄令牌`() {
    val msg = TurnBridge.explainHttpReason("turn HTTP 401: {\"ok\":false,\"error\":\"invalid_token\"}")
    assertTrue("必须保留机器码，报障时才能和桌面日志对上：$msg", msg.contains("invalid_token"))
    assertTrue("第一步应该是重新配对：$msg", msg.contains("重新配对"))
    assertFalse("不能把原因说成网络问题：$msg", msg.contains("网络不好"))
    // 老桌面（不认设备签名）那条退路仍要留着，否则这类用户无解
    assertTrue("桌面版本旧时仍需重抄令牌的退路：$msg", msg.contains("显示配对令牌"))
  }
}

/**
 * A3-18 门禁：跨网配对串的解析必须**宽容但不含糊**。
 *
 * 宽容：用户可能只复制了 query 部分、参数顺序也可能乱。
 * 不含糊：缺任何一栏都不许猜 —— 半套参数拿去连只会让用户在
 * 「连不上中转」和「凭证不对」之间瞎试。
 */
class RelayBootstrapTest {

  private fun cfg(host: String, port: Int, box: String, token: String) =
    RelayTunnel.RelayConfig(host, port, token, box)

  /* ---------------------------------------------------------------- RB-01 */

  @Test
  fun `RB-01 生成与解析严格对称`() {
    val c = cfg("relay.example.com", 18766, "my-desktop", "tok-abcdef")
    val text = RelayBootstrap.encode(c)
    assertTrue("必须带协议前缀：$text", text.startsWith(RelayBootstrap.SCHEME))
    // 绝不带 box_token 之类的东西：只允许这四个键
    assertFalse("串里不该出现 box_token：$text", text.contains("box"))
    val parsed = RelayBootstrap.parse(text)
    assertTrue(parsed is RelayBootstrap.Parsed.Ok)
    assertEquals(c, (parsed as RelayBootstrap.Parsed.Ok).config)
  }

  /* ---------------------------------------------------------------- RB-02 */

  @Test
  fun `RB-02 宽容：没有前缀、参数乱序、只有 query 都认`() {
    val a = RelayBootstrap.parse("bitbot-relay://v1?h=1.2.3.4&p=18766&b=box&t=tok")
    val b = RelayBootstrap.parse("h=1.2.3.4&p=18766&b=box&t=tok")
    val c = RelayBootstrap.parse("?h=1.2.3.4&p=18766&b=box&t=tok")
    val d = RelayBootstrap.parse("bitbot-relay://v1?t=tok&b=box&p=18766&h=1.2.3.4")
    listOf(a, b, c, d).forEach { assertTrue("应当都解析成功：$it", it is RelayBootstrap.Parsed.Ok) }
    val expect = cfg("1.2.3.4", 18766, "box", "tok")
    listOf(a, b, c, d).forEach {
      assertEquals(expect, (it as RelayBootstrap.Parsed.Ok).config)
    }
  }

  /* ---------------------------------------------------------------- RB-03 */

  @Test
  fun `RB-03 不含糊：缺哪栏就说缺哪栏，不猜默认值`() {
    val missingPort = RelayBootstrap.parse("bitbot-relay://v1?h=1.2.3.4&b=box&t=tok")
    assertTrue(missingPort is RelayBootstrap.Parsed.Incomplete)
    assertEquals(listOf("端口"), (missingPort as RelayBootstrap.Parsed.Incomplete).missing)

    val missingTwo = RelayBootstrap.parse("bitbot-relay://v1?h=1.2.3.4&t=tok")
    assertEquals(
      listOf("端口", "盒子 ID"),
      (missingTwo as RelayBootstrap.Parsed.Incomplete).missing,
    )

    // 端口越界也算缺（不是「用默认值补上」）
    val badPort = RelayBootstrap.parse("bitbot-relay://v1?h=1.2.3.4&p=70000&b=box&t=tok")
    assertTrue(badPort is RelayBootstrap.Parsed.Incomplete)
  }

  /* ---------------------------------------------------------------- RB-04 */

  @Test
  fun `RB-04 空串与「不是配对串」要分开报`() {
    assertTrue(RelayBootstrap.parse("") is RelayBootstrap.Parsed.Empty)
    assertTrue(RelayBootstrap.parse("   ") is RelayBootstrap.Parsed.Empty)
    // 用户粘错了东西（比如一段普通网址）——不能当成「缺栏」，那会让人以为差一步就好了
    assertTrue(RelayBootstrap.parse("https://example.com/abc") is RelayBootstrap.Parsed.NotBootstrap)
  }

  /* ---------------------------------------------------------------- RB-05 */

  @Test
  fun `RB-05 转义：值里带 & 与百分号也不会被截断`() {
    val c = cfg("relay.example.com", 18766, "box&id", "to%ken")
    val text = RelayBootstrap.encode(c)
    val parsed = RelayBootstrap.parse(text)
    assertTrue("转义后应仍可解析：$text", parsed is RelayBootstrap.Parsed.Ok)
    assertEquals(c, (parsed as RelayBootstrap.Parsed.Ok).config)
  }

  /* ---------------------------------------------------------------- RB-06 */

  @Test
  fun `RB-06 摘要只给端点和盒子名，绝不带 token`() {
    val d = RelayBootstrap.describe(cfg("relay.example.com", 18766, "my-desktop", "super-secret-token"))
    assertTrue(d.contains("relay.example.com:18766"))
    assertTrue(d.contains("my-desktop"))
    assertFalse("摘要泄漏了凭证：$d", d.contains("super-secret-token"))
    assertNotNull(RelayBootstrap.describe(null))
    assertFalse(RelayBootstrap.describe(null).contains("secret"))
  }
}
