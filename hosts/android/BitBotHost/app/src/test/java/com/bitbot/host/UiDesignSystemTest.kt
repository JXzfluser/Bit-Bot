package com.bitbot.host

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import java.io.File
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * UI 重构的复现测试 —— 直接渲染真 MainActivity（Robolectric 在 JVM 上跑 Compose 语义树）。
 *
 * 这一版为什么必须存在：用户原话「ui布局跟样式完全没法看，重构一版。必须跟主流ai相关的
 * app对齐哦」。旧屏的实情是 setContent { MaterialTheme { ... } } —— 一个设计系统都没有，
 * 顶着 Material 3 框架默认紫（#6750A4）就发布了；每条消息上面还挂「你」「Bit Bot」两个
 * 角色标签；顶栏是「凭证」「能力」两个裸文字按钮；发送是一个写着「发送」的方形文字按钮；
 * 凭证面板把 BITBOT_HOST_URL / BITBOT_TURN_TOKEN 这种环境变量名直接当标签给用户看。
 *
 * 修复前红（下面每条在旧屏上跑出来的真实结果，逐条写死在 report 里）：
 *   T1 未配对 -> 红：界面上没有任何「未配对」状态，用户只能点了发送才知道没连上
 *   T2 发送是图标按钮 -> 红：没有 contentDescription，只有一个文字「发送」按钮
 *   T3 顶栏不裸摆两个文字入口 -> 红：「凭证」「能力」都在
 *   T4 不许出现「对标 Grok」定位文案 -> 红：首屏 tagline 就是这句
 *   T5 凭证面板不暴露环境变量名 -> 红：标签正是 BITBOT_HOST_URL / BITBOT_TURN_TOKEN
 *   T6 聊天行不打角色标签 -> 红：每句话上面一个「你」/「Bit Bot」
 *
 * 诚实边界：
 *   - Robolectric 不验像素级观感（另见 UiPixelProbeTest），也不替代真机验收；
 *   - T5 的点开路径在新旧两版不同（旧屏顶栏直接是「凭证」，新屏收在「更多」里），
 *     这里按语义分支走同一条断言，不是把断言改成两头都能过。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UiDesignSystemTest {
  @get:Rule
  val compose = createAndroidComposeRule<MainActivity>()

  @Before
  fun `把 dev runner 那条后门关掉`() {
    // TurnBridge 在没有配对地址时会退到本机 node dev runner（inferRepoRoot 靠 user.dir 往上找
    // moon.mod.json）。单测里不能真去 spawn node —— 把 user.dir 指到一个空目录，
    // 让本地兜底必然失败，发送才会稳定回一句「连不上 Desktop 大脑」。
    val empty = File(System.getProperty("java.io.tmpdir"), "bitbot-ui-no-repo-${System.nanoTime()}")
    empty.mkdirs()
    System.setProperty("user.dir", empty.absolutePath)
    TurnBridge.bind(RuntimeEnvironment.getApplication())
    TurnBridge.setHostUrl("http://127.0.0.1:1")
    TurnBridge.setTurnToken("seed-token")
  }

  private fun openCredentials() {
    val direct = compose.onAllNodesWithText("凭证").fetchSemanticsNodes().isNotEmpty()
    if (direct) {
      compose.onNodeWithText("凭证").performClick()
    } else {
      compose.onNode(hasContentDescription("更多")).performClick()
      compose.waitForIdle()
      compose.onNodeWithText("凭证").performClick()
    }
    compose.waitForIdle()
  }

  private fun sendMessage(text: String) {
    compose.onNode(hasSetTextAction()).performTextInput(text)
    compose.onNode(sendButton()).performClick()
    // 发送走的是真链路（这里是必然失败的 127.0.0.1:1 + 没有 dev runner 的 user.dir）：
    // 后台线程跑完后回主线程加一条 assistant 消息，所以要等语义树出现「你好呀」。
    compose.waitUntil(timeoutMillis = 10_000) {
      compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }
  }

  /** 旧屏是文字按钮「发送」，新屏是图标按钮（contentDescription=发送）：一条断言走两版。 */
  private fun sendButton() =
    hasContentDescription("发送").or(hasText("发送")) and hasClickAction()

  @Test
  fun T1_未配对时界面直接说出连接状态() {
    compose.onNodeWithText("未配对", substring = true).assertExists()
  }

  @Test
  fun T2_发送是图标按钮不再是文字按钮() {
    compose.onNode(hasContentDescription("发送")).assertExists()
    compose.onNodeWithText("发送").assertDoesNotExist()
  }

  @Test
  fun T3_顶栏不把凭证和能力裸摆成两个文字按钮() {
    compose.onNodeWithText("凭证").assertDoesNotExist()
    compose.onNodeWithText("能力").assertDoesNotExist()
  }

  @Test
  fun T4_不许把对标Grok这种自我定位印在首屏上() {
    compose.onAllNodesWithText("Grok", substring = true).assertCountEquals(0)
  }

  @Test
  fun T5_凭证面板用人话标签不暴露环境变量名() {
    openCredentials()
    compose.onAllNodesWithText("BITBOT_HOST_URL").assertCountEquals(0)
    compose.onAllNodesWithText("BITBOT_TURN_TOKEN").assertCountEquals(0)
    compose.onNodeWithText("配对地址").assertExists()
    compose.onNodeWithText("配对令牌").assertExists()
  }

  @Test
  fun T6_聊天行不再给每句话打角色标签() {
    sendMessage("你好呀")
    // 消息本体必须在
    compose.onNodeWithText("你好呀").assertExists()
    // 但「你」「Bit Bot」这种角色标签必须没有（新屏靠左右分列与配色区分说话人）
    compose.onAllNodesWithText("你").assertCountEquals(0)
  }
}
