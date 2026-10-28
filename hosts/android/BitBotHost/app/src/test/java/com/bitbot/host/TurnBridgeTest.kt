package com.bitbot.host

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TurnBridge 里能脱离 Android 运行时验证的两件事：
 * 1) 手机怎么从 /v1/turn 的回复里取「要说给用户看的那句话」；
 * 2) 取不到时，手机说的是不是 Host/内核真正报的原因。
 * 用的是真线路的 JSON 形状（messages + host_results + stdout + error），
 * 不是为测试编出来的形状。
 */
class TurnBridgeTest {

  /** Desktop /v1/turn 成功回包（结构取自真机线路实测）。 */
  private fun turnJson(
    ok: Boolean,
    assistant: String?,
    error: String? = null,
    hostResults: JSONArray = JSONArray(),
  ): String {
    val messages = JSONArray()
    messages.put(JSONObject().put("role", "user").put("text", "ListMachines"))
    if (assistant != null) {
      messages.put(JSONObject().put("role", "assistant").put("text", assistant))
    }
    val obj =
      JSONObject()
        .put("ok", ok)
        .put("machine_kind", "android")
        .put("session_id", "android-app")
        .put("messages", messages)
        .put("host_results", hostResults)
        .put("stdout", "")
    if (error != null) obj.put("error", error) else obj.put("error", JSONObject.NULL)
    return obj.put("brain", "shared_desktop_host").toString()
  }

  @Test
  fun `取最后一条非空 assistant`() {
    val raw = turnJson(true, "deviceLocalTools on android/phone-android: 3") +
      "\n[HostAbi machine_kind=android ok]"
    assertEquals("deviceLocalTools on android/phone-android: 3", TurnBridge.assistantText(raw))
  }

  @Test
  fun `空 assistant 不算回复`() {
    val raw = turnJson(true, "")
    assertNull(TurnBridge.assistantText(raw))
  }

  @Test
  @Throws(Exception::class)
  fun `401 回包不会被当成正常回复`() {
    val raw = JSONObject().put("ok", false).put("error", "invalid_token").toString()
    assertNull(TurnBridge.assistantText(raw))
    assertEquals("invalid_token", TurnBridge.failureText(raw))
  }

  @Test
  @Throws(Exception::class)
  fun `失败回包说的是 Host 报的原因，不是写死的甩锅话术`() {
    val hrs = JSONArray()
    hrs.put(JSONObject().put("kind", "mail_send").put("ok", false).put("error", "smtp_auth_failed"))
    val raw = turnJson(false, null, "host_llm_failed", hrs)
    assertEquals("host_llm_failed", TurnBridge.failureText(raw))

    val noTopError = turnJson(false, null, null, hrs)
    val text = TurnBridge.failureText(noTopError)
    assertTrue("应点名失败的 host kind，实际：$text", text != null && text.contains("mail_send=smtp_auth_failed"))
  }

  @Test
  fun `HTTP 层错误原文保留`() {
    // runTurnHttp 抛出的 "turn HTTP 401: …" 会被 MainActivity 前缀成 "! …"
    val raw = "! turn HTTP 401: {\"ok\":false,\"error\":\"invalid_token\"}"
    val text = TurnBridge.failureText(raw)
    assertTrue("要原样带上 HTTP 状态码，实际：$text", text != null && text.startsWith("turn HTTP 401"))
  }

  @Test
  fun `成功回包不会被标成失败`() {
    val raw = turnJson(true, "收到")
    assertNull(TurnBridge.failureText(raw))
  }
}
