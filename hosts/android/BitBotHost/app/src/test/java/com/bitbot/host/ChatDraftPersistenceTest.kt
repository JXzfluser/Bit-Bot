package com.bitbot.host

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
 * 在手机上打了一半的稿子，转个身不许没。
 *
 * 这个 app 要服务的场景里，用户就在手机上写东西：一稿标题、一段待发的正文。
 * 输入框的内容和对话一样是 `remember { mutableStateOf("") }` —— 组合一散就清零。
 * 用户视角就是「我打了三分钟的一段话，转了一下屏，全没了」。对话历史本轮已经落盘（§8.27），
 * 这一条是同一件事剩下的那一半。
 *
 * 修复前红（HEAD 产品代码真渲染，最终这版断言跑出来的原文，逐条对 report §8.28）：
 *   DF-01 转屏后输入框里还是那半稿 -> 红：
 *         AssertionError: 转个身，打了半篇的稿子从输入框里消失了（读到「」）
 *   DF-02 那半稿落在filesDir的文件里 -> 红：
 *         AssertionError: filesDir 下找不到含这半稿的文件 —— 转屏靠的是实例复用，
 *         真机旋转（新建实例）照样丢（filesDir 条目数 0）
 *   合计 3 tests completed, 2 failed（DF-03 绿，见下面一段）
 *
 * 第一轮踩过的坑要记下来：DF-01/DF-03 一开始用 assertTextEquals 写，输入框空的时候它会连
 * placeholder 的 Text 一起比，DF-03 在还没实现的代码上「红」了 —— 那是要红的原因不对。
 * 改成直接读 EditableText 语义属性后重测，红才落在「稿子没了」这件事上。
 *
 * DF-03（发出去之后不许把已发送的那句当草稿摆回输入框）断的是本轮新加的这条链，
 * 修复前没有草稿落盘，谈不上「摆回来」，所以它不参与「修复前红」；牙齿由 §8.28 的负向对照给
 * （发送后不清草稿 -> DF-03 红）。
 *
 * DF-02 为什么坚持要「在盘上」而不是「还在内存里」：Robolectric 的 recreate() 复用同一个
 * Activity 实例，把草稿挂在实例字段上也能骗过 DF-01 —— 真机旋转是**新建实例**，那条假修复
 * 到了真机上照样丢。所以这里单独断一次「文件里真有」，断的是重建后读回来的那个来源。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ChatDraftPersistenceTest {
  @get:Rule
  val compose = createAndroidComposeRule<MainActivity>()

  @Before
  fun `关掉 dev runner 后门并配对到一个必然连不上的地址`() {
    val empty = File(System.getProperty("java.io.tmpdir"), "bitbot-draft-no-repo-${System.nanoTime()}")
    empty.mkdirs()
    System.setProperty("user.dir", empty.absolutePath)
    TurnBridge.bind(RuntimeEnvironment.getApplication())
    TurnBridge.setHostUrl("http://127.0.0.1:1")
    TurnBridge.setTurnToken("seed-draft-token-4m1p")
  }

  private fun composer() = compose.onNode(hasSetTextAction())

  /**
   * 直接读 EditableText 这个语义属性，不用 assertTextEquals：输入框空的时候
   * assertTextEquals("") 会连 placeholder 的 Text 一起比，红得莫名其妙（第一轮就踩了）。
   * 用户看得见的就是这一串，断它最贴。
   */
  private fun editableText(): String =
    composer().fetchSemanticsNode().config[SemanticsProperties.EditableText].text

  private fun type(text: String) {
    composer().performTextInput(text)
    compose.waitForIdle()
  }

  @Suppress("DEPRECATION")
  private fun recreate() {
    compose.activity.recreate()
    compose.waitForIdle()
  }

  /** DF-01 那半稿要还停在输入框里。 */
  @Test
  fun DF01_转屏后输入框里还是那半稿() {
    type(DRAFT)
    assertTrue("前置不成立：字没进输入框（读到「${editableText()}」）", editableText() == DRAFT)
    recreate()
    assertTrue("转个身，打了半篇的稿子从输入框里消失了（读到「${editableText()}」）", editableText() == DRAFT)
  }

  /**
   * DF-02 那半稿得在 filesDir 的文件里。
   * 内存字段能骗过 DF-01（Robolectric 复用实例），骗不过这条。
   */
  @Test
  fun DF02_那半稿落在filesDir的文件里() {
    type(DRAFT)
    recreate()
    val filesDir = RuntimeEnvironment.getApplication().filesDir
    val hit = filesDir.walkTopDown().filter { it.isFile && it.readText().contains(DRAFT) }.toList()
    assertTrue(
      "filesDir 下找不到含这半稿的文件 —— 转屏靠的是实例复用，真机旋转（新建实例）照样丢" +
        "（filesDir 条目数 ${filesDir.list()?.size ?: 0}）",
      hit.isNotEmpty(),
    )
  }

  /**
   * DF-03 发出去之后，这半稿不许又以「草稿」的样子回到输入框。
   * 用户按发送 = 这段话交出去了；重开还挂在框里，他会以为没发出去再按一次。
   */
  @Test
  fun DF03_发出去之后转屏输入框仍然是空的() {
    type(DRAFT)
    compose.onNode(hasContentDescription("发送").or(hasText("发送")) and hasClickAction()).performClick()
    compose.waitUntil(timeoutMillis = 10_000) {
      compose.onAllNodesWithText(DRAFT).fetchSemanticsNodes().isNotEmpty()
    }
    recreate()
    assertTrue(
      "已经发出去的那句又被当成草稿摆回输入框（读到「${editableText()}」）—— 用户会再按一次发送",
      editableText().isEmpty(),
    )
  }

  companion object {
    private const val DRAFT = "帮我把这篇稿子改一版标题，先写一半"
  }
}
