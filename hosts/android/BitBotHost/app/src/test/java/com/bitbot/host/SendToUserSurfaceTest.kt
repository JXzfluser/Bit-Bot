package com.bitbot.host

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 手机端「SendToUser 投递条」——和 hosts/shared/send_to_user_surface.js 同一套语义。
 * 手机看不到桌面那条侧栏，投递证据就只剩这排标签，所以它必须：
 *   - 有实体文件时点名 snap/路径；
 *   - 有 residual（真实未通的能力）时把 chip 一起带上，不许只报「成功」。
 */
class SendToUserSurfaceTest {

  private fun turn(vararg results: JSONObject, ok: Boolean = true, channelDelivery: String = ""): String {
    val hrs = JSONArray()
    results.forEach { hrs.put(it) }
    val obj =
      JSONObject()
        .put("ok", ok)
        .put("machine_kind", "android")
        .put("messages", JSONArray().put(JSONObject().put("role", "assistant").put("text", "好了")))
        .put("host_results", hrs)
    if (channelDelivery.isNotEmpty()) obj.put("channel_delivery", channelDelivery)
    return obj.toString()
  }

  private fun result(kind: String, stdout: JSONObject, ok: Boolean = true): JSONObject {
    val o = JSONObject().put("kind", kind).put("ok", ok)
    o.put("stdout", stdout.toString())
    return o
  }

  @Test
  fun `投递条认出附件并标成 attachment`() {
    val r =
      result(
        "mail_send",
        JSONObject()
          .put("path", "/tmp/bitbot/mail-1.eml")
          .put("live_mail_residual", true),
      )
    val s = SendToUserSurface.extract(turn(r))
    assertTrue("labels 应含 mail_send，实际：${s.labels}", s.labels.any { it.startsWith("mail_send") })
    assertTrue("residual 必须一起显示", s.labels.any { it.contains("live_mail_residual") })
    assertEquals(1, s.attachments.size)
    assertEquals("openable", s.attachments[0].role)
    assertEquals("android", s.machineKind)
    assertTrue(s.ok)
  }

  @Test
  fun `失败的 host 结果不会伪装成投递`() {
    val r = result("slides_pptx", JSONObject().put("path", "/tmp/x.pptx"), ok = false)
    val s = SendToUserSurface.extract(turn(r))
    assertEquals(emptyList<String>(), s.labels)
    assertEquals(emptyList<SendToUserSurface.Attachment>(), s.attachments)
  }

  @Test
  fun `Honest OAuth NeedsAuth 仍然进投递条`() {
    val r =
      result(
        "oauth",
        JSONObject()
          .put("status", "NeedsAuth")
          .put("connected", false)
          .put("pretend_connected", false),
        ok = false,
      )
    val s = SendToUserSurface.extract(turn(r))
    assertTrue("oauth NeedsAuth 要显示，实际：${s.labels}", s.labels.any { it.startsWith("oauth:NeedsAuth") })
    assertTrue(s.types.contains("widget"))
  }

  @Test
  fun `device_permission 卡片带工具名`() {
    val r =
      result(
        "device_permission",
        JSONObject().put("tool", "microphone").put("path", "/tmp/bitbot/card.json"),
      )
    val s = SendToUserSurface.extract(turn(r))
    assertTrue(s.labels.any { it.contains("widget:device_permission:microphone") })
  }

  @Test
  fun `secret-request 不落附件`() {
    val r = result("credential_fill", JSONObject().put("vault_id", "vault-7").put("path", "/tmp/leak.json"))
    val s = SendToUserSurface.extract(turn(r))
    assertTrue(s.types.contains("secret-request"))
    assertEquals(emptyList<SendToUserSurface.Attachment>(), s.attachments)
    assertFalse(s.labels.any { it.contains("leak.json") })
  }

  @Test
  fun `非 JSON 输入返回空摘要而不是崩`() {
    val s = SendToUserSurface.extract("! turn HTTP 401")
    assertEquals(emptyList<String>(), s.labels)
    assertEquals("", s.machineKind)
  }

  @Test
  fun `channel_delivery 也算一次投递`() {
    val s = SendToUserSurface.extract(turn(channelDelivery = "dingtalk:cid-android"))
    assertTrue(s.types.contains("text"))
    assertTrue(s.labels.any { it == "channel_delivery:dingtalk:cid-android" })
  }
}
