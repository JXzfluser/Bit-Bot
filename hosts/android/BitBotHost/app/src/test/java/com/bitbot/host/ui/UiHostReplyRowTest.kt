package com.bitbot.host.ui

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 能力回执从内核回包一路到屏幕上的样子（Robolectric 真渲染 Compose）。
 *
 * 断的是链，不是函数：喂进去的是本机真跑的 `/v1/turn` 回包（app/src/test/resources/hostfix/），
 * 屏幕上要读得出人话，且原始回执照旧展开得出来 —— 否则「好看」就是拿藏事实换的。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UiHostReplyRowTest {
  @get:Rule val compose = createComposeRule()

  private fun fixture(kind: String): String =
    javaClass.getResourceAsStream("/hostfix/$kind.json").use { input ->
      requireNotNull(input) { "fixture 不在 classpath 上：hostfix/$kind.json" }.readBytes().toString(Charsets.UTF_8)
    }

  private fun renderCapabilityTurn(kind: String): HostReplyDisplay {
    val shown = HostReply.display(fixture(kind))
    compose.setContent {
      BitBotTheme {
        HomeScreen(
          lines = listOf(ChatLine("user", "list routines"), ChatLine("assistant", shown.text, shown.raw)),
          busy = false,
          input = "",
          onInputChange = {},
          onSend = {},
          onSendSuggestion = {},
          deliveryLabels = emptyList(),
          paired = true,
          hostLabel = "192.168.1.10:18765",
          onOpenPairing = {},
          onOpenCredentials = {},
          onOpenMenu = {},
        )
      }
    }
    compose.waitForIdle()
    return shown
  }

  @Test
  fun `屏幕上读得出人话 默认看不到内核原文`() {
    val shown = renderCapabilityTurn("routine_list")
    compose.onNode(hasText(shown.text, substring = true)).assertExists()
    compose.onNode(hasText("看原始回执")).assertExists()
    val rawVisible = compose.onAllNodes(hasText("Host FFI results applied", substring = true)).fetchSemanticsNodes()
    assertTrue("默认不该展开着内核原文（$rawVisible）", rawVisible.isEmpty())
    val fence = compose.onAllNodes(hasText("```", substring = true)).fetchSemanticsNodes()
    assertTrue("围栏不该出现在屏幕上（$fence）", fence.isEmpty())
  }

  @Test
  fun `点一下看原始回执 内核原文就出来了`() {
    val shown = renderCapabilityTurn("routine_list")
    assertTrue("这条回包本该带原文：" + shown.raw, shown.raw != null)
    compose.onNode(hasText("看原始回执")).performClick()
    compose.waitForIdle()
    compose.onNode(hasText("Host FFI results applied", substring = true)).assertExists()
    compose.onNode(hasText("收起原始回执")).assertExists()
  }

  @Test
  fun `相机这条不许在屏幕上说成已授权`() {
    val shown = renderCapabilityTurn("device_permission")
    compose.onNode(hasText(shown.text, substring = true)).assertExists()
    val granted = compose.onAllNodes(hasText("已授权", substring = true)).fetchSemanticsNodes()
    assertTrue("内核写的是 unavailable，屏幕上不许出现「已授权」（$granted）", granted.isEmpty())
    assertTrue("屏幕上得看得见「不可用」：" + shown.text, shown.text.contains("不可用"))
  }

  @Test
  fun `回执渲染完 顶栏与输入区还在原位`() {
    renderCapabilityTurn("machines_list")
    compose.onNode(hasContentDescription("更多")).assertExists()
    compose.onNode(hasContentDescription("发送")).assertExists()
  }
}
