package com.bitbot.host.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 设计系统本身 + 各面板/各状态的渲染测试。
 *
 * 修复前红（编译期红 —— 这一层在旧版根本不存在）：
 *   旧版只有 setContent { MaterialTheme { ... } }，没有 BitBotTheme、没有 token、
 *   没有可灌状态的 HomeScreen/PairingSheet（unresolved reference: BitBotTheme 等）。
 *   版面级的行为红另见 UiDesignSystemTest —— 那 6 条是拿旧 MainActivity 真渲染跑红的。
 *
 * 修复后绿：本文件每条都过。
 *
 * 为什么这里要单独测颜色数值：JVM 拿不到真像素（Robolectric NATIVE 模式下
 * captureToImage 2000ms 超时，见报告 §残留），所以「画面上到底是什么色」只能验到
 * 「送进渲染器的那个值是什么」这一层。它比读代码强（真的读了 MaterialTheme.colorScheme
 * 和对比度），但它不等于截图验收 —— 真机观感仍然是残留。
 *
 * 一条技术边界：Compose 测试规则里 setContent 每个用例只能调一次，所以
 * 「浅色一套、深色一套」「配对面板五个状态」都拆成独立用例，不是一个用例里连点五次。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UiTokensAndSheetsTest {
  @get:Rule
  val compose = createComposeRule()

  /** Material 3 框架基线紫：浅色 primary、深色 primary、浅色 primaryContainer、带紫调的白。 */
  private val BaselinePurple = Color(0xFF6750A4)
  private val BaselinePurpleDark = Color(0xFFD0BCFF)
  private val BaselineTint = Color(0xFFEADDFA)
  private val BaselineSurface = Color(0xFFFEF7FF)

  private fun scheme(dark: Boolean): ColorScheme {
    lateinit var out: ColorScheme
    compose.setContent {
      BitBotTheme(darkTheme = dark) { out = MaterialTheme.colorScheme }
    }
    compose.waitForIdle()
    return out
  }

  private fun luminance(c: Color): Float {
    fun ch(v: Float) =
      if (v <= 0.03928f) v / 12.92f else Math.pow(((v + 0.055) / 1.055).toDouble(), 2.4).toFloat()
    return 0.2126f * ch(c.red) + 0.7152f * ch(c.green) + 0.0722f * ch(c.blue)
  }

  private fun contrast(a: Color, b: Color): Float {
    val la = luminance(a)
    val lb = luminance(b)
    return (maxOf(la, lb) + 0.05f) / (minOf(la, lb) + 0.05f)
  }

  /** 中性色：三通道最大差不超过 6（带紫调的 #FEF7FF 差 8，判不过）。 */
  private fun isNeutral(c: Color): Boolean {
    val mx = maxOf(c.red, c.green, c.blue)
    val mn = minOf(c.red, c.green, c.blue)
    return (mx - mn) * 255f <= 6f
  }

  private fun assertSchemeIsNotFrameworkDefault(dark: Boolean) {
    val s = scheme(dark)
    val expectAccent = if (dark) BitBotPalette.AccentOnDark else BitBotPalette.Accent
    assertEquals("强调色必须是设计系统里那一条蓝", expectAccent, s.primary)
    assertTrue("primary 不许是框架默认紫", s.primary != if (dark) BaselinePurpleDark else BaselinePurple)
    assertTrue("底色不许是框架带紫调的白", s.background != BaselineSurface)
    assertTrue("画布必须中性，实际 = ${s.background}", isNeutral(s.background))
    assertTrue("抬起面必须中性，实际 = ${s.surfaceVariant}", isNeutral(s.surfaceVariant))
    assertTrue("描边必须中性，实际 = ${s.outline}", isNeutral(s.outline))
    // 单强调色：secondary / tertiary 并入同一条，不许再开出第二种品牌色
    assertEquals("secondary 必须并入同一强调色", s.primary, s.secondary)
    assertEquals("tertiary 必须并入同一强调色", s.primary, s.tertiary)
    val containers = listOf(s.primaryContainer, s.secondaryContainer, s.tertiaryContainer)
    assertTrue("任何 tonal 档都不许出现框架基线紫/紫底", containers.none { it == BaselineTint })
    // 可读性（WCAG 文字 4.5，色块/图标 3）
    assertTrue("正文对比度 ≥4.5，实测 ${contrast(s.onSurface, s.surface)}",
      contrast(s.onSurface, s.surface) >= 4.5f)
    assertTrue("次级文字对比度 ≥4.5，实测 ${contrast(s.onSurfaceVariant, s.surface)}",
      contrast(s.onSurfaceVariant, s.surface) >= 4.5f)
    assertTrue("主行动键上的字对比度 ≥4.5，实测 ${contrast(s.onPrimary, s.primary)}",
      contrast(s.onPrimary, s.primary) >= 4.5f)
    assertTrue("强调色在画布上 ≥3，实测 ${contrast(s.primary, s.surface)}",
      contrast(s.primary, s.surface) >= 3f)
  }

  @Test
  fun 浅色主题不许顶着框架默认紫() = assertSchemeIsNotFrameworkDefault(dark = false)

  @Test
  fun 深色主题不许顶着框架默认紫() = assertSchemeIsNotFrameworkDefault(dark = true)

  @Test
  fun 深色画布必须真的暗() {
    val s = scheme(true)
    assertTrue("深色画布亮度必须 <0.02，实测 ${luminance(s.background)}", luminance(s.background) < 0.02f)
  }

  private fun renderHome(
    lines: List<ChatLine> = emptyList(),
    busy: Boolean = false,
    paired: Boolean = false,
    hostLabel: String? = null,
  ) {
    compose.setContent {
      BitBotTheme(darkTheme = false) {
        HomeScreen(
          lines = lines,
          busy = busy,
          input = "",
          onInputChange = {},
          onSend = {},
          onSendSuggestion = {},
          deliveryLabels = emptyList(),
          paired = paired,
          hostLabel = hostLabel,
          onOpenPairing = {},
          onOpenCredentials = {},
          onOpenMenu = {},
        )
      }
    }
    compose.waitForIdle()
  }

  @Test
  fun 有对话时不再出现角色标签只靠位置和底色分人() {
    renderHome(
      lines = listOf(ChatLine("user", "今天有什么热点"), ChatLine("assistant", "三条：……")),
      paired = true,
      hostLabel = "192.168.1.10:18765",
    )
    compose.onNodeWithText("今天有什么热点").assertExists()
    compose.onNodeWithText("三条：……").assertExists()
    compose.onAllNodesWithText("你").assertCountEquals(0)
    compose.onAllNodesWithText("Bit Bot").assertCountEquals(1) // 只剩顶栏那一个字标
    compose.onNodeWithText("已配对 · 192.168.1.10:18765").assertExists()
  }

  @Test
  fun 等回包时有明确反馈() {
    renderHome(lines = listOf(ChatLine("user", "在吗")), busy = true, paired = true)
    compose.onNodeWithText("Bit Bot 正在想…").assertExists()
  }

  @Test
  fun 未配对空屏给状态给一个主行动给一条兜底路() {
    renderHome()
    compose.onNodeWithText("未配对").assertExists()
    compose.onNodeWithText("连接 Desktop").assertExists()
    compose.onNodeWithText("手动填配对地址").assertExists()
    compose.onNodeWithText("连着桌面大脑的局域网 AI 助手").assertExists()
    // 定位文案不许出现任何品牌对标字样
    compose.onAllNodesWithText("Grok", substring = true).assertCountEquals(0)
  }

  @Test
  fun 已配对空屏给提示键而不是再塞一个连接键() {
    renderHome(paired = true, hostLabel = "192.168.1.10:18765")
    compose.onNodeWithText("已配对 · 192.168.1.10:18765").assertExists()
    compose.onAllNodesWithText("连接 Desktop").assertCountEquals(0)
    BitBotSuggestions.forEach { compose.onNodeWithText(it).assertExists() }
  }

  private fun renderPairing(state: PairingScanState, selected: PairingDesktop? = null) {
    val found =
      if (state is PairingScanState.Done && state.count > 0) {
        listOf(
          PairingDesktop("DESKTOP-A1", "192.168.1.10", 18765, true),
          PairingDesktop("DESKTOP-B2", "192.168.1.21", 18765, false),
        )
      } else {
        emptyList()
      }
    compose.setContent {
      BitBotTheme(darkTheme = false) {
        PairingSheet(
          scanState = state,
          discovered = found,
          selected = selected,
          onSelect = {},
          codeInput = "",
          onCodeChange = {},
          portInput = "18765",
          onPortChange = {},
          redeemState = PairingRedeemState.Idle,
          onScan = {},
          onRedeem = {},
          onOpenCredentials = {},
          onDismiss = {},
        )
      }
    }
    compose.waitForIdle()
  }

  @Test
  fun 配对面板第一步就交代端口和扫描键() {
    renderPairing(PairingScanState.Idle)
    compose.onNodeWithText("开始扫描").assertExists()
    compose.onNodeWithText("桌面端口").assertExists()
    compose.onNodeWithText("高级：手动填写配对地址和令牌").assertExists()
  }

  @Test
  fun 配对面板扫描中说得清在干什么() {
    renderPairing(PairingScanState.Scanning)
    compose.onNodeWithText("正在扫描局域网…").assertExists()
  }

  @Test
  fun 配对面板读不到本机地址时给的是下一步不是报错码() {
    renderPairing(PairingScanState.Error("读不到手机自己的局域网地址：确认手机连着 Wi-Fi"))
    compose.onNodeWithText("读不到手机自己的局域网地址：确认手机连着 Wi-Fi").assertExists()
    compose.onNodeWithText("重试").assertExists()
  }

  @Test
  fun 配对面板没扫到时指给用户一个动作() {
    renderPairing(PairingScanState.Done(0))
    compose
      .onNodeWithText("同一 Wi-Fi 里没找到 Desktop：桌面上先点一下「生成配对码」，再重新扫描。")
      .assertExists()
  }

  @Test
  fun 配对面板列出候选并标出没开配对码的那台() {
    renderPairing(PairingScanState.Done(2), selected = PairingDesktop("DESKTOP-A1", "192.168.1.10", 18765, true))
    compose.onNodeWithText("找到 2 台桌面，点一台：").assertExists()
    compose.onNodeWithText("DESKTOP-B2").assertExists()
    compose.onNodeWithText("桌面还没生成配对码").assertExists()
    compose.onNodeWithText("配对码").assertExists()
  }

  @Test
  fun 凭证面板不再把环境变量名当标签() {
    compose.setContent {
      BitBotTheme(darkTheme = false) {
        CredentialsSheet(
          hostDraft = "",
          onHostChange = {},
          tokenDraft = "",
          onTokenChange = {},
          endpointPreview = null,
          missingHint = null,
          onSave = {},
          onOpenPairing = {},
          onDismiss = {},
        )
      }
    }
    compose.waitForIdle()
    compose.onNodeWithText("配对地址").assertExists()
    compose.onNodeWithText("配对令牌").assertExists()
    compose.onNodeWithText("未配对：填好这两栏之前，发送一定会失败").assertExists()
    compose.onAllNodes(hasText("BITBOT_", substring = true)).assertCountEquals(0)
  }

  @Test
  fun 凭证面板只缺一栏时点名缺哪一栏() {
    compose.setContent {
      BitBotTheme(darkTheme = false) {
        CredentialsSheet(
          hostDraft = "192.168.1.10:18765",
          onHostChange = {},
          tokenDraft = "",
          onTokenChange = {},
          endpointPreview = com.bitbot.host.TurnBridge.turnEndpoint("192.168.1.10:18765"),
          missingHint = "缺配对令牌",
          onSave = {},
          onOpenPairing = {},
          onDismiss = {},
        )
      }
    }
    compose.waitForIdle()
    compose.onNodeWithText("发送一定会失败：缺配对令牌（另一栏已经填了）").assertExists()
  }

  @Test
  fun 更多面板把两个入口收进去但功能一个不少() {
    compose.setContent {
      BitBotTheme(darkTheme = false) {
        MenuSheet(
          paired = false,
          hostLabel = null,
          onCredentials = {},
          onCapabilities = {},
          onPairing = {},
          onDismiss = {},
        )
      }
    }
    compose.waitForIdle()
    compose.onNodeWithText("凭证").assertExists()
    compose.onNodeWithText("能力").assertExists()
    compose.onNodeWithText("连接 Desktop").assertExists()
  }

  @Test
  fun 能力面板把每一点了会发什么写在下面() {
    compose.setContent {
      BitBotTheme(darkTheme = false) {
        CapabilitiesSheet(
          actions = listOf("钉钉" to "reply via dingtalk:cid-android :: Bit Bot Android 钉钉"),
          enabled = true,
          onPick = {},
          onDismiss = {},
        )
      }
    }
    compose.waitForIdle()
    compose.onNodeWithText("钉钉").assertExists()
    compose.onNodeWithText("reply via dingtalk:cid-android :: Bit Bot Android 钉钉").assertExists()
  }
}

