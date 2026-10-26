package com.bitbot.host

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「桌面报了一串机器码」到「用户知道下一步做什么」之间的翻译层。
 *
 * 为什么值得单独钉：ADR 0008 的 /v1/turn 只回 `{"ok":false,"error":"invalid_token"}`
 * 这类稳定英文码，桌面开发者看得懂，手机用户看不懂。填错令牌是这条路上最容易犯的错
 * （64 位手工复制，多一个空格就废），而现在的界面把原文整段贴回聊天框。
 *
 * 断言为什么用「只有翻译层才会出现的那几个词」而不是「有没有提到令牌」：
 * `pairingHint` 的固定尾巴本来就有「在「凭证」核对配对地址与配对令牌」，用后者做断言
 * 会在没修的软件上直接绿 —— 那是假门禁（第一版就是这么写的，跑出来 23 条只红 1 条）。
 *
 * 修复前红（真跑出来的原文）：
 *   - T1 只有机器码，没有「重抄整串」这层指导；
 *   - T2 `turn HTTP 404: <!DOCTYPE html><html>…` 整段 HTML 进聊天框；
 *   - T3 `turn_token_unconfigured` 看不出问题在桌面那侧；
 *   - T4 没见过的状态码被当成已知情况糊过去。
 */
class TurnBridgeHttpErrorTest {

  @Test
  fun 令牌不对时要说要重抄整串而不是只给机器码() {
    val msg =
      TurnBridge.pairingHint(
        "turn HTTP 401: {\"ok\":false,\"error\":\"invalid_token\"}",
        "missing mobile_host runner",
      )
    assertTrue("要给出「重抄整串」这一层指导，实际：$msg", msg.contains("重抄") || msg.contains("重新复制"))
    assertTrue("机器码要留着（报障时唯一能对上的线索）", msg.contains("invalid_token"))
    assertTrue("要点名桌面「显示配对令牌」那个入口", msg.contains("显示配对令牌"))
  }

  @Test
  fun 页面四零四不许把HTML贴进聊天框() {
    val body = "<!DOCTYPE html><html><head><title>Not Found</title></head><body>" + "x".repeat(400) + "</body></html>"
    val msg = TurnBridge.pairingHint("turn HTTP 404: $body", "no node")
    assertFalse("聊天框里不许出现 HTML 标签，实际：${msg.take(160)}", msg.contains("<html") || msg.contains("<!DOCTYPE"))
    assertFalse("不许把整段回包正文搬进来，实际：${msg.take(160)}", msg.contains("xxxx"))
    assertTrue("要说清这个端口上没有 /v1/turn，实际：${msg.take(200)}", msg.contains("/v1/turn") || msg.contains("端口"))
    assertTrue("整句要收在可读长度内，实际长度：${msg.length}", msg.length < 400)
  }

  @Test
  fun 桌面没生成令牌要说问题在桌面侧不在手机() {
    val msg =
      TurnBridge.pairingHint(
        "turn HTTP 401: {\"ok\":false,\"error\":\"turn_token_unconfigured\"}",
        "no node",
      )
    assertTrue("要说「桌面那边还没生成」，实际：${msg.take(200)}", msg.contains("还没生成"))
    assertTrue("机器码要留着", msg.contains("turn_token_unconfigured"))
  }

  @Test
  fun 没见过的状态码要如实说未识别不许瞎猜() {
    val msg = TurnBridge.pairingHint("turn HTTP 418: {\"ok\":false,\"error\":\"teapot\"}", "no node")
    assertTrue("状态码要带着，实际：${msg.take(200)}", msg.contains("418"))
    assertTrue("要如实标未识别，实际：${msg.take(200)}", msg.contains("未识别"))
    assertFalse("没见过的码不许说成重抄令牌", msg.contains("重抄"))
  }

  @Test
  fun 端口没人监听要说端口而不是贴Java异常() {
    val msg = TurnBridge.pairingHint("java.net.ConnectException: Connection refused", "no node")
    assertTrue("要说端口没人监听，实际：${msg.take(220)}", msg.contains("没人监听"))
    assertTrue("要给出默认端口 18765", msg.contains("18765"))
    assertFalse("不许把 Java 异常类名整段贴进聊天框，实际：${msg.take(160)}", msg.contains("java.net.ConnectException"))
  }

  /* 下面两条钉的是「不用发包就知道会失败」的那一档：地址填了、令牌空着。
   * 修复前的红是编译期的 —— `unresolved reference: tokenPrecheck`（函数还不存在），
   * 行为层没有可跑的旧路径可对照，这点如实记在 report.md 8.17，不假装有运行时红。 */
  @Test
  fun 地址填了令牌空着要先说令牌而不是先发包() {
    val hint = TurnBridge.tokenPrecheck("http://192.168.1.10:18765", null)
    assertTrue("缺令牌要给出可执行的下一步，实际：$hint", hint != null && hint.contains("显示配对令牌"))
    assertTrue("不许把它说成连不上", hint != null && !hint.contains("连不上"))
    assertTrue("两项都齐时不该拦路", TurnBridge.tokenPrecheck("http://192.168.1.10:18765", "tok") == null)
    assertTrue("地址都没填归「未配对」管，这里不重复报", TurnBridge.tokenPrecheck(null, null) == null)
  }

  @Test
  fun 配对缺一栏时凭证页要说缺哪栏() {
    assertTrue("只缺令牌就只说令牌", TurnBridge.pairingMissingHint(true, false) == "缺配对令牌")
    assertTrue("只缺地址就只说地址", TurnBridge.pairingMissingHint(false, true) == "缺配对地址")
    assertTrue("两项都有不该提示", TurnBridge.pairingMissingHint(true, true) == null)
    assertTrue("两项都没有归「未配对」管", TurnBridge.pairingMissingHint(false, false) == null)
  }
}
