package com.bitbot.host

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 配对地址怎么变成一次真实请求 —— 这一段在没有 emulator 的机器上也能红绿。
 *
 * 钉死两件真机会踩到的事：
 * 1) 没配对就是没配对。旧实现在什么都没配时回一个写死的 emulator 地址
 *    （http://10.0.2.2:18765），真机上表现为「发出去必失败」，用户看到的
 *    是转圈 + 一句网络错误，而不是「去凭证配对」；写死的端口也直接违反
 *    「开放配置，不写死」。
 *    修复前红：expected null, but was:<http://10.0.2.2:18765>
 * 2) 手写地址常常少了协议。java.net.URL("192.168.1.10:18765/v1/turn")
 *    抛 MalformedURLException: no protocol，旧实现把这次失败咽掉后
 *    退到本机 node runner（真机上根本没有），最后一句都说不清是地址写错了。
 *    修复前红：expected:<[http://]192.168.1.10:18765> but was:<[]192.168.1.10:18765>
 *
 * 走的是 JVM 单测能确定的输入：不绑 Context（prefs 为空）、不设 env、
 * 只用系统属性 bitbot.host.url 这条 dev 线路。
 */
class TurnBridgeAddressTest {

  @After
  fun clearProps() {
    System.clearProperty("bitbot.host.url")
  }

  @Test
  fun `未配对时不许回一个写死的地址`() {
    assertNull(
      "什么都没配 = 未配对（null），不能偷偷发往写死的 emulator 地址",
      TurnBridge.hostUrl(),
    )
  }

  @Test
  fun `手填地址少了协议要补全`() {
    System.setProperty("bitbot.host.url", "192.168.1.10:18765")
    assertEquals("http://192.168.1.10:18765", TurnBridge.hostUrl())
  }

  @Test
  fun `配对地址到 turn 端点只拼一次`() {
    assertEquals("http://192.168.1.10:18765/v1/turn", TurnBridge.turnEndpoint("192.168.1.10:18765"))
    assertEquals(
      "https://bot.example.com:18765/v1/turn",
      TurnBridge.turnEndpoint("https://bot.example.com:18765/v1/turn/"),
    )
    assertEquals("http://10.0.2.2:18765/v1/turn", TurnBridge.turnEndpoint("10.0.2.2:18765"))
    assertNull(TurnBridge.turnEndpoint("   "))
    assertNull(TurnBridge.turnEndpoint(null))
  }

  @Test
  fun `https 不能被降级成 http`() {
    System.setProperty("bitbot.host.url", "https://192.168.1.10:18765/v1/turn")
    assertEquals("https://192.168.1.10:18765/v1/turn", TurnBridge.hostUrl())
  }

  @Test
  fun `未配对的报错点名凭证入口而不是甩锅网络`() {
    val msg = TurnBridge.unpairedText("missing mobile_host runner")
    assertTrue("要说要干什么：实际「$msg」", msg.contains("凭证"))
    assertTrue("要点名配对地址与令牌：实际「$msg」", msg.contains("配对地址") && msg.contains("配对令牌"))
    assertTrue("dev runner 失败原因要留着：实际「$msg」", msg.contains("missing mobile_host runner"))
  }

  @Test
  fun `已配对但连不上时报错说清两次失败`() {
    val msg = TurnBridge.pairingHint("turn HTTP 401: invalid_token", "no node")
    assertTrue("要带上 HTTP 原文：实际「$msg」", msg.contains("turn HTTP 401"))
    assertTrue("要承认本机兜底也失败：实际「$msg」", msg.contains("no node"))
    assertTrue("要给下一步：实际「$msg」", msg.contains("允许手机连接"))
  }
}
