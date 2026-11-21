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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

/**
 * 手机上的聊天记录必须活过「转个身」和「重新打开」。
 *
 * 用户报的是「完全不知道如何使用」，而这一条是它最难堪的形式：打了一句话、屏幕一旋
 * （或系统把后台的 app 杀掉重开），刚才那句话和助手的回复全没了，首屏回到空态。
 * 主流 AI app 没有把这个行为留给用户的。
 *
 * 修复前红（HEAD 产品代码真跑出来的输出，逐条对 report §8.27）：
 *   CP-01 转屏后那句话还在 -> 红：屏幕上 0 个节点，首屏是空态（今天有什么热点 在）
 *   CP-02 回复那条也在、首屏不再是空态 -> 红：同上，两条都没了
 *   CP-03 对话落在 filesDir 下 -> 红：filesDir 里一个文件都没有，那句话只活在内存里
 *   CP-04 盘上没有凭证 -> 红：连「有没有文件」这一步都过不去，断不了任何内容
 *   CP-05 菜单里有「清空对话」并且屏幕与盘一起清 -> 红：这一行压根不存在
 *
 * 「存盘这一步坏掉不许影响发送」「文件被写坏了不许崩」两条在 ChatHistoryStoreTest 里，
 * 用目录占位这种与文件系统权限无关的方式造故障（沙箱里跑的是 root，chmod 拦不住写，
 * 拿权限位造故障会得到一条永远假的绿）。
 *
 * 诚实边界：
 *   - 本环境没有 KVM，起不了 emulator。这里用 Robolectric 真渲染 Compose 语义树，
 *     「转屏」走 Activity.recreate()（同一实例重走 onCreate，Compose 组合是新的）；
 *     「进程被杀后重开」是全新实例 + 全新内存，语义树在 JVM 上够不到第二个实例，
 *     所以那半边由 CP-03「那句话确实在盘上、且在 filesDir 里」来断 —— 全新进程
 *     第一次读的就是它。真机旋转与厂商杀后台仍要在设备上验一次（残留里写着）。
 *   - 这里不截图、不验观感。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ChatThreadPersistenceTest {
  @get:Rule
  val compose = createAndroidComposeRule<MainActivity>()

  @Before
  fun `关掉 dev runner 那条后门并配对到一个必然连不上的地址`() {
    // 同 UiDesignSystemTest：user.dir 指到空目录，本地兜底必败，发送稳定回
    // 一句「连不上 Desktop 大脑」，助手那条才有可预期的文本可等。
    val empty = File(System.getProperty("java.io.tmpdir"), "bitbot-persist-no-repo-${System.nanoTime()}")
    empty.mkdirs()
    System.setProperty("user.dir", empty.absolutePath)
    TurnBridge.bind(RuntimeEnvironment.getApplication())
    TurnBridge.setHostUrl("http://127.0.0.1:1")
    TurnBridge.setTurnToken(SEED_TOKEN)
  }

  private fun sendButtonMatcher() =
    hasContentDescription("发送").or(hasText("发送")) and hasClickAction()

  /** 真走一遍用户动作：打字、点发送、等屏幕上出现那句话。 */
  private fun send(text: String) {
    compose.onNode(hasSetTextAction()).performTextInput(text)
    compose.onNode(sendButtonMatcher()).performClick()
    compose.waitUntil(timeoutMillis = 10_000) {
      compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }
  }

  private fun waitAssistant() {
    compose.waitUntil(timeoutMillis = 15_000) {
      compose.onAllNodes(hasText("连不上 Desktop 大脑", substring = true)).fetchSemanticsNodes().isNotEmpty()
    }
  }

  private fun nodeCount(text: String) =
    compose.onAllNodesWithText(text).fetchSemanticsNodes().size

  /** CP-01 转个身，刚才那句话还在屏幕上（并且只有一条，不是旧树没拆干净）。 */
  @Test
  fun CP01_转屏后那句话还在屏幕上() {
    send(SENTENCE)
    assertTrue("前置不成立：发送后屏幕上就没有那句话", nodeCount(SENTENCE) >= 1)
    recreate()
    compose.waitForIdle()
    compose.onNodeWithText(SENTENCE).assertExists()
    compose.onAllNodesWithText(SENTENCE).assertCountEquals(1)
  }

  /** CP-02 用户条与回复条都在，顺序还在，首屏不许退回「还没有对话」的空态。 */
  @Test
  fun CP02_转屏后两条都还在且首屏不是空态() {
    send(SENTENCE)
    waitAssistant()
    recreate()
    compose.waitForIdle()
    compose.onNodeWithText(SENTENCE).assertExists()
    compose.onAllNodes(hasText("连不上 Desktop 大脑", substring = true)).assertCountEquals(1)
    // 空态那三个建议键只在 lines.isEmpty() 时出现；还在 = 历史其实没读回来
    compose.onAllNodesWithText("今天有什么热点").assertCountEquals(0)
  }

  /**
   * CP-03 那句话得真的在盘上，而且在 filesDir 里。
   * 这是「进程被杀后重开」那一半的证据：全新进程没有内存状态，第一次读的就是这个文件。
   */
  @Test
  fun CP03_对话落在filesDir下的一个文件里() {
    send(SENTENCE)
    val filesDir = RuntimeEnvironment.getApplication().filesDir
    val hit = filesDir.walkTopDown().filter { it.isFile && it.readText().contains(SENTENCE) }.toList()
    assertTrue("filesDir 下找不到含那句话的文件——历史只活在内存里，重开必丢（发现 ${filesDir.list()?.size ?: 0} 个条目）", hit.isNotEmpty())
    // 不许把聊天记录放到外部存储：那是别的 app（以及 adb 不拔线）能读到的地方
    val external = RuntimeEnvironment.getApplication().getExternalFilesDir(null)
    val leaked =
      external?.walkTopDown()?.filter { it.isFile && it.readText().contains(SENTENCE) }?.toList()
        ?: emptyList()
    assertTrue("聊天记录被写到了外部目录 ${leaked.map { it.path }}", leaked.isEmpty())
  }

  /** CP-04 盘上的对话文件里不许有配对令牌，也不许有 Authorization/Bearer 字样。 */
  @Test
  fun CP04_存下来的对话不含凭证() {
    send(SENTENCE)
    val f = chatFileOrNull()
    assertTrue("还没有对话文件可查（CP-03 已红），这条不得当绿用", f != null)
    val body = f!!.readText()
    assertTrue("对话文件里出现了配对令牌", !body.contains(SEED_TOKEN))
    assertTrue("对话文件里出现了 Bearer", !body.contains("Bearer", ignoreCase = false))
    assertTrue("对话文件里出现了 Authorization", !body.contains("Authorization"))
  }

  /**
   * CP-05 既然历史会留在机器上，「清掉」就必须是个看得见按得动的动作，而且屏幕与盘一起清。
   * 修复前红：菜单里根本没有「清空对话」这一行（节点数 0），断不到后面的行为。
   */
  @Test
  fun CP05_清空对话后屏幕与盘都干净且转屏不回来() {
    send(SENTENCE)
    compose.onNode(hasContentDescription("更多")).performClick()
    compose.waitForIdle()
    compose.onNodeWithText("清空对话").assertExists()
    compose.onNodeWithText("清空对话").performClick()
    compose.waitUntil(timeoutMillis = 10_000) {
      compose.onAllNodesWithText(SENTENCE).fetchSemanticsNodes().isEmpty()
    }
    assertTrue("点了清空，盘上那句话还在", chatFileOrNull() == null)
    recreate()
    compose.waitForIdle()
    compose.onAllNodesWithText(SENTENCE).assertCountEquals(0)
  }

  /** 同一实例重走 onCreate（Compose 组合全新）= 用户转屏时实际发生的事。 */
  @Suppress("DEPRECATION")
  private fun recreate() {
    compose.activity.recreate()
  }

  private fun chatFileOrNull(): File? {
    val filesDir = RuntimeEnvironment.getApplication().filesDir
    return filesDir.walkTopDown().firstOrNull { it.isFile && it.readText().contains(SENTENCE) }
  }

  companion object {
    private const val SENTENCE = "转个身就该还在的一句话"
    private const val SEED_TOKEN = "seed-turn-token-9f2k"
  }
}
