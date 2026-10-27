package com.bitbot.host.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 内核回排放到手机上该长什么样（fixture 是真抓的，不是编的）。
 *
 * 来由：用户说「ui 布局跟样式完全没法看」。画布、顶栏、输入框重构完之后，手机上真正
 * 会「一屏看不懂」的是剩下那一条：能力面板九个动作打出去，桌面内核回的是
 * `Host FFI results applied … kind=routine_list … ```{ …绝对路径、BITBOT_* 变量名… }``` `
 * —— TurnBridge.assistantText 取最后一条 assistant 消息，于是这坨原始倾倒被原样贴进
 * 聊天。主流 AI app 不会把数据库转储当回复读给用户。
 *
 * 八个 fixture 全部来自本机真跑：`node hosts/cli_host/run_turn.js "<phrase>"`，
 * 存在 app/src/test/resources/hostfix/。这里只断言「用户看得见什么」，
 * 不改内核、不改 store/IPC/`/v1/turn` 的 JSON 形状 —— 原始回执照旧可以展开来看。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HostReplySummaryTest {
  private fun fixture(kind: String): String =
    javaClass.getResourceAsStream("/hostfix/$kind.json").use { input ->
      requireNotNull(input) { "fixture 不在 classpath 上：hostfix/$kind.json" }.readBytes().toString(Charsets.UTF_8)
    }

  private fun summary(kind: String): HostReplyDisplay = HostReply.display(fixture(kind))

  /** 每条都要过的底线：不许有代码围栏、不许有沙箱绝对路径、不许把环境变量名贴回界面。 */
  private fun assertReadableAsHuman(kind: String) {
    val text = summary(kind).text
    assertTrue("[$kind] 还在往聊天里贴代码围栏：" + text, !text.contains("```"))
    assertTrue("[$kind] 还在往聊天里贴沙箱绝对路径：" + text, !Regex("/data/|/root/|/app/").containsMatchIn(text))
    assertTrue("[$kind] 还在往聊天里贴 BITBOT_* 环境变量名：" + text, !text.contains("BITBOT_"))
    assertTrue("[$kind] 空摘要等于什么都没告诉用户：" + text, text.isNotBlank())
  }

  @Test
  fun `九个能力回执没有一个还在贴原始倾倒`() {
    for (kind in listOf("machines_list", "llm_list_models", "device_tools_list", "routine_list", "routine_tick", "check_updates", "device_permission", "approval_card")) {
      assertReadableAsHuman(kind)
    }
  }

  @Test
  fun `设备列表说清几台、哪台在线`() {
    val text = summary("machines_list").text
    println("SUMMARY machines_list -> $text")
    assertTrue(text, text.contains("3 台"))
    assertTrue("在线的那台要点名：" + text, text.contains("desk-1") && text.contains("在线"))
    assertTrue("不在线的要说清，不许假装连着：" + text, text.contains("不在线"))
  }

  @Test
  fun `模型列表如实说没配密钥`() {
    val text = summary("llm_list_models").text
    println("SUMMARY llm_list_models -> $text")
    assertTrue(text, text.contains("3 家"))
    assertTrue("三家都缺密钥就必须说没配，不许含糊：" + text, text.contains("没配") || text.contains("未配"))
    assertTrue("当前生效的模型可以告诉用户：" + text, text.contains("deepseek"))
  }

  @Test
  fun `设备工具为 0 时说没有可用工具`() {
    val text = summary("device_tools_list").text
    println("SUMMARY device_tools_list -> $text")
    assertTrue(text, Regex("没有可用工具|0 个").containsMatchIn(text))
  }

  @Test
  fun `定时任务列表给出条数`() {
    val text = summary("routine_list").text
    println("SUMMARY routine_list -> $text")
    assertTrue(text, text.contains("定时任务"))
    assertTrue("0 条要写 0 条，不许省略：" + text, text.contains("0 条"))
  }

  @Test
  fun `到点轮转报出到期与触发数量`() {
    val text = summary("routine_tick").text
    println("SUMMARY routine_tick -> $text")
    assertTrue(text, text.contains("到点") && Regex("0").containsMatchIn(text))
  }

  @Test
  fun `检查更新不许把备案占位藏起来`() {
    val text = summary("check_updates").text
    println("SUMMARY check_updates -> $text")
    assertTrue("通道是事实：" + text, text.contains("stable"))
    assertTrue("feed 还没接上、备案还是空的 —— 这两条残留必须看得见：" + text, text.contains("还没接上") && text.contains("备案"))
  }

  @Test
  fun `相机权限这条不许说成已授权`() {
    val text = summary("device_permission").text
    println("SUMMARY device_permission -> $text")
    assertTrue("unavailable 就是不可用：" + text, text.contains("不可用"))
    assertTrue("pretend_granted=false + 真机弹窗没验过，这两件事要说：" + text, text.contains("没验"))
    assertTrue("不许写成已经授权：" + text, !text.contains("已授权"))
  }

  @Test
  fun `审批卡片要说清没有自动执行`() {
    val text = summary("approval_card").text
    println("SUMMARY approval_card -> $text")
    assertTrue(text, text.contains("确认"))
    assertTrue("pending 就是没执行：" + text, text.contains("没有自动执行"))
    assertTrue("往哪个通道发要看得见：" + text, text.contains("钉钉"))
  }

  @Test
  fun `原始回执仍然给得出来（不许为了好看把事实藏了）`() {
    val d = summary("routine_list")
    assertTrue("展开必须还能看到内核原文：" + d.raw, d.raw != null && d.raw!!.contains("Host FFI results applied"))
    assertTrue("原文里的 kind 还在：" + d.raw, d.raw!!.contains("kind=routine_list"))
  }

  @Test
  fun `认不得的 kind 不许编摘要`() {
    val body =
      """{"ok":true,"messages":[{"role":"assistant","text":"Host FFI results applied (MoonBit kernel / ADR 0002):\n- ok kind=some_new_kernel_thing cmd=`x`\n```\n{\"a\":1}\n```"}]}"""
    val d = HostReply.display(body)
    println("SUMMARY unknown -> " + d.text.replace("\n", " | "))
    assertEquals("认不得的 kind 必须原样给出来，不猜", "unknown", d.kind)
    assertTrue("原文得在：" + d.text, d.text.contains("some_new_kernel_thing"))
  }

  @Test
  fun `不是能力回执的普通对话不动它`() {
    val body = """{"ok":true,"messages":[{"role":"assistant","text":"今天有三条热点，先给你两条。"}]}"""
    val d = HostReply.display(body)
    assertEquals("normal", d.kind)
    assertEquals("今天有三条热点，先给你两条。", d.text)
    assertTrue("普通对话没有原始倾倒要藏：" + d.raw, d.raw == null)
  }
}
