package com.bitbot.host

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * A1-4: SSE 回退提示文案单元测试（三语：zh-CN / zh-TW / en）。
 *
 * 钉死一件事：回退提示必须三语齐全，缺一门就红。
 * 这是 AE-05 结构门的单元测试版本。
 *
 * 修复前红：旧实现只有英文提示，或者根本没有提示（静默回退）。
 */
class EventStreamMessagesTest {

  /** currentLocale 是进程级全局，用例之间必须回到同一起点，否则顺序一变就假红/假绿。 */
  @Before
  fun resetLocale() {
    EventStreamMessages.currentLocale = "zh-CN"
  }

  /**
   * zh-CN 文案不能是空的。
   */
  @Test
  fun `zh-CN 回退提示不能为空`() {
    EventStreamMessages.currentLocale = "zh-CN"

    val unavailable = EventStreamMessages.eventStreamUnavailable()
    val unauthorized = EventStreamMessages.eventStreamUnauthorized()
    val httpError = EventStreamMessages.eventStreamHttpError(500)
    val networkError = EventStreamMessages.eventStreamNetworkError()

    assertTrue("zh-CN unavailable 不能为空", unavailable.isNotEmpty())
    assertTrue("zh-CN unauthorized 不能为空", unauthorized.isNotEmpty())
    assertTrue("zh-CN httpError 不能为空", httpError.isNotEmpty())
    assertTrue("zh-CN networkError 不能为空", networkError.isNotEmpty())

    // 要包含「实时进度」或「进度」关键词
    assertTrue("zh-CN 提示要说「进度」",
      unavailable.contains("进度") || unauthorized.contains("进度") ||
        httpError.contains("进度") || networkError.contains("进度"))
  }

  /**
   * zh-TW 文案不能是空的，且要用繁体字。
   */
  @Test
  fun `zh-TW 回退提示不能為空且要用繁體`() {
    EventStreamMessages.currentLocale = "zh-TW"

    val unavailable = EventStreamMessages.eventStreamUnavailable()
    val unauthorized = EventStreamMessages.eventStreamUnauthorized()
    val httpError = EventStreamMessages.eventStreamHttpError(500)
    val networkError = EventStreamMessages.eventStreamNetworkError()

    assertTrue("zh-TW unavailable 不能為空", unavailable.isNotEmpty())
    assertTrue("zh-TW unauthorized 不能為空", unauthorized.isNotEmpty())
    assertTrue("zh-TW httpError 不能為空", httpError.isNotEmpty())
    assertTrue("zh-TW networkError 不能為空", networkError.isNotEmpty())

    // 要包含「即時進度」或「進度」關鍵詞（繁體）
    assertTrue("zh-TW 提示要說「進度」",
      unavailable.contains("進度") || unauthorized.contains("進度") ||
        httpError.contains("進度") || networkError.contains("進度"))

    // 要包含至少一個繁體特徵字（「暫」「時」「進」「度」之一）
    val hasTraditional = unavailable.contains("暫") || unavailable.contains("時") ||
      unauthorized.contains("暫") || unauthorized.contains("時")
    assertTrue("zh-TW 要有繁體特徵字", hasTraditional)
  }

  /**
   * en 文案不能是空的，且要用英文。
   */
  @Test
  fun `en fallback message must not be empty and must be in English`() {
    EventStreamMessages.currentLocale = "en"

    val unavailable = EventStreamMessages.eventStreamUnavailable()
    val unauthorized = EventStreamMessages.eventStreamUnauthorized()
    val httpError = EventStreamMessages.eventStreamHttpError(500)
    val networkError = EventStreamMessages.eventStreamNetworkError()

    assertTrue("en unavailable must not be empty", unavailable.isNotEmpty())
    assertTrue("en unauthorized must not be empty", unauthorized.isNotEmpty())
    assertTrue("en httpError must not be empty", httpError.isNotEmpty())
    assertTrue("en networkError must not be empty", networkError.isNotEmpty())

    // 要包含 "progress" 或 "turn" 關鍵詞（英文）
    assertTrue("en message must mention 'progress' or 'turn'",
      unavailable.contains("progress") || unauthorized.contains("progress") ||
        httpError.contains("progress") || networkError.contains("progress") ||
        unavailable.contains("turn") || unauthorized.contains("turn"))
  }

  /**
   * fallbackMessage 要根据 reason 分发到正确的文案。
   */
  @Test
  fun `fallbackMessage 要根據 reason 分發`() {
    EventStreamMessages.currentLocale = "zh-CN"

    val unavailable = EventStreamMessages.fallbackMessage("event_stream_unavailable")
    val unauthorized = EventStreamMessages.fallbackMessage("event_stream_unauthorized")
    val network = EventStreamMessages.fallbackMessage("event_stream_network_error")
    val http500 = EventStreamMessages.fallbackMessage("event_stream_http_500")

    assertTrue("unavailable 要說事件庫", unavailable.contains("事件库") || unavailable.contains("事件庫"))
    assertTrue("unauthorized 要說凭证", unauthorized.contains("凭证") || unauthorized.contains("凭证"))
    assertTrue("network 要說網路", network.contains("网络") || network.contains("網路"))
    assertTrue("http500 要說 HTTP", http500.contains("HTTP"))
  }

  /**
   * progressUpdate 必须按 label_key + phase + 计数取词，而且**不许吐 JSON**。
   *
   * 修复前红（真机才会露出来的那条）：旧实现是
   *   fun progressUpdate(row: String?) = "进度：${row ?: "处理中"}"
   * 调用点写 `optString("row")`，而服务端 `row` 是对象（turn_progress.js:121-128），
   * 于是真机上那一行是 `进度：{"phase":"start","index":1,"total":5,...}`。
   * 那不叫「看得见进度」，那叫把调试面板甩给用户。
   */
  @Test
  fun `progressUpdate 取 label_key 不许吐 JSON`() {
    EventStreamMessages.currentLocale = "zh-CN"
    val row = JSONObject()
      .put("phase", "start")
      .put("index", 3)
      .put("total", 7)
      .put("kind", "web_fetch")
      .put("category", "tool_activity")
      .put("label_key", "progTool")

    val msg = EventStreamMessages.progressUpdate(row)

    assertEquals("计数 + 桌面同款措辞", "3/7 正在执行工具调用", msg)
    assertFalse("不许把 row 当 JSON 吐给用户: $msg", msg.contains("{"))
    assertFalse("不许出现机器码: $msg", msg.contains("label_key") || msg.contains("tool_activity"))
  }

  /** 七类 label_key 在三种语言下都必须有词，不许退化成空白或 key 本身。 */
  @Test
  fun `七类进度标签三语都要有词`() {
    val keys = listOf(
      "progTool", "progComputer", "progFiles", "progQuestion",
      "progApproval", "progVoice", "progModel",
    )
    for (locale in listOf("zh-CN", "zh-TW", "en")) {
      EventStreamMessages.currentLocale = locale
      for (key in keys) {
        val msg = EventStreamMessages.progressUpdate(
          JSONObject().put("phase", "start").put("label_key", key)
        )
        assertTrue("$locale/$key 不能是空", msg.isNotBlank())
        assertFalse("$locale/$key 不许直接吐 key: $msg", msg.contains(key))
        // 没有 index/total 时不该冒出 "0/0"
        assertFalse("$locale/$key 无计数时不许出现 0/0: $msg", msg.startsWith("0/0"))
      }
    }
  }

  /** phase 的三种后缀必须与桌面同一套话（awaiting / failed / continuing）。 */
  @Test
  fun `progressUpdate 的 phase 后缀要对齐桌面`() {
    EventStreamMessages.currentLocale = "zh-CN"
    val awaiting = EventStreamMessages.progressUpdate(
      JSONObject().put("phase", "awaiting").put("label_key", "progApproval")
    )
    assertTrue("awaiting 要说等回应: $awaiting", awaiting.contains("等你审批") && awaiting.contains("等待你的回应"))

    val failed = EventStreamMessages.progressUpdate(
      JSONObject().put("phase", "failed").put("label_key", "progFiles").put("error", "disk full")
    )
    assertTrue("failed 要带真实原因: $failed", failed.contains("正在生成文件") && failed.contains("disk full"))

    val failedNoReason = EventStreamMessages.progressUpdate(
      JSONObject().put("phase", "failed").put("label_key", "progFiles")
    )
    assertTrue("没原因时也要说未完成: $failedNoReason", failedNoReason.contains("未完成"))

    // continuing 桌面是不带计数的独立一句，手机照抄，不许拼成 "2/5 内核继续下一步"
    val continuing = EventStreamMessages.progressUpdate(
      JSONObject().put("phase", "continuing").put("index", 2).put("total", 5).put("label_key", "progTool")
    )
    assertEquals("内核继续下一步", continuing)
  }

  /** row 整个缺失（坏帧）时不许显示空白，用户会以为卡死。 */
  @Test
  fun `progressUpdate 缺 row 也要有话`() {
    EventStreamMessages.currentLocale = "zh-CN"
    assertTrue(EventStreamMessages.progressUpdate(null).isNotBlank())
    assertTrue(
      "未知 label_key 必须回落到通用工具措辞",
      EventStreamMessages.progressUpdate(JSONObject().put("phase", "start").put("label_key", "progNothing"))
        .contains("正在执行工具调用")
    )
  }

  /** 同一个 row 在三语下必须是三种语言 —— 上一版 currentLocale 从没被赋值，繁体/英文分支是死代码。 */
  @Test
  fun `同一个进度帧三语各说各的话`() {
    val row = JSONObject().put("phase", "start").put("index", 1).put("total", 2).put("label_key", "progModel")
    EventStreamMessages.currentLocale = "zh-CN"
    val cn = EventStreamMessages.progressUpdate(row)
    EventStreamMessages.currentLocale = "zh-TW"
    val tw = EventStreamMessages.progressUpdate(row)
    EventStreamMessages.currentLocale = "en"
    val en = EventStreamMessages.progressUpdate(row)

    assertEquals("1/2 模型正在回复", cn)
    assertEquals("1/2 模型正在回覆", tw)
    assertEquals("1/2 Model is replying", en)
    assertTrue("三语必须互不相同", cn != tw && cn != en && tw != en)
  }

  /** localeFrom：zh + TW/HK/MO/Hant → zh-TW；en → en；其它 → en（不许逼德语用户读简体）。 */
  @Test
  fun `localeFrom 归一系统 locale`() {
    assertEquals("zh-CN", EventStreamMessages.localeFrom("zh", "CN", ""))
    assertEquals("zh-TW", EventStreamMessages.localeFrom("zh", "TW", ""))
    assertEquals("zh-TW", EventStreamMessages.localeFrom("zh", "HK", ""))
    assertEquals("zh-TW", EventStreamMessages.localeFrom("zh", "MO", ""))
    assertEquals("zh-TW", EventStreamMessages.localeFrom("zh", "", "Hant"))
    assertEquals("zh-CN", EventStreamMessages.localeFrom("ZH", "cn", ""))
    assertEquals("en", EventStreamMessages.localeFrom("en", "US", ""))
    assertEquals("en", EventStreamMessages.localeFrom("de", "DE", ""))
    assertEquals("en", EventStreamMessages.localeFrom("", "", ""))
  }

  /** thinking 行也要三语（上一版这里是硬编码简体字符串）。 */
  @Test
  fun `thinking 行三语都有`() {
    val seen = mutableSetOf<String>()
    for (locale in listOf("zh-CN", "zh-TW", "en")) {
      EventStreamMessages.currentLocale = locale
      val t = EventStreamMessages.thinking()
      assertTrue("$locale thinking 不能为空", t.isNotBlank())
      seen.add(t)
    }
    assertTrue("en 必须与中文不同", seen.size >= 2)
  }

  /**
   * turnStarted 要显示发起者。
   */
  @Test
  fun `turnStarted 要顯示發起者`() {
    EventStreamMessages.currentLocale = "zh-CN"
    val msg = EventStreamMessages.turnStarted("android")
    assertTrue("要包含回合开始", msg.contains("回合开始"))
    assertTrue("要包含发起者", msg.contains("android"))
  }

  /** initiator 为空串时不许出现「回合开始（由  发起）」这种半截话。 */
  @Test
  fun `turnStarted 发起者缺失不许留半截括号`() {
    EventStreamMessages.currentLocale = "zh-CN"
    val msg = EventStreamMessages.turnStarted("")
    assertFalse("不该出现空的发起者: $msg", msg.contains("由"))
    assertTrue(msg.contains("回合开始"))
  }

  /**
   * turnEnded 要显示状态。
   */
  @Test
  fun `turnEnded 要顯示狀態`() {
    EventStreamMessages.currentLocale = "zh-CN"

    val ok = EventStreamMessages.turnEnded("ok")
    val error = EventStreamMessages.turnEnded("error")
    val cancelled = EventStreamMessages.turnEnded("cancelled")
    val awaiting = EventStreamMessages.turnEnded("awaiting_approval")

    assertTrue("ok 要說完成", ok.contains("完成"))
    assertTrue("error 要说出错", error.contains("出错"))
    assertTrue("cancelled 要說取消", cancelled.contains("取消"))
    assertTrue("awaiting 要說审批", awaiting.contains("审批"))
  }

  /**
   * 三语文案不能相同（避免复制粘贴错误）。
   */
  @Test
  fun `三語文案不能完全相同`() {
    val messages = mutableListOf<String>()

    EventStreamMessages.currentLocale = "zh-CN"
    messages.add(EventStreamMessages.eventStreamUnavailable())

    EventStreamMessages.currentLocale = "zh-TW"
    messages.add(EventStreamMessages.eventStreamUnavailable())

    EventStreamMessages.currentLocale = "en"
    messages.add(EventStreamMessages.eventStreamUnavailable())

    // 三条文案不能全相同
    assertFalse("三语文案不能完全相同",
      messages[0] == messages[1] && messages[1] == messages[2])
  }

  /**
   * HTTP 状态码要正确插入到文案中。
   */
  @Test
  fun `HTTP 狀態碼要正確插入`() {
    EventStreamMessages.currentLocale = "zh-CN"
    val msg404 = EventStreamMessages.eventStreamHttpError(404)
    val msg500 = EventStreamMessages.eventStreamHttpError(500)

    assertTrue("404 要插入到文案", msg404.contains("404"))
    assertTrue("500 要插入到文案", msg500.contains("500"))
    assertFalse("404 和 500 文案不能相同", msg404 == msg500)
  }
}
