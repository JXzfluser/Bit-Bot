package com.bitbot.host

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.After
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * 按了发送、回信还在路上，这时候转个身 —— 那句话不能就当没发生过。
 *
 * 为什么这是这一轮最该修的一条：自媒体博主在手机上最典型的一条链是「发一句让它排稿子 /
 * 出标题」，桌面大脑回这句要几秒到几十秒。这几秒里手机一转、切个后台，旧实现把整件事
 * 掐死了 —— 不是「回复还没显示」，而是**回复永远不会来**：跑这一回合的协程属于
 * composition（`rememberCoroutineScope()`），recreate 取消 composition 就取消它。
 * 用户那边看到的是：我发出去的那句话孤零零挂在屏幕上，没有转圈，没有回复，发送键又是亮的，
 * 于是再按一次 —— 对「定时发文」这类有副作用的动作，这就是重复发。
 *
 * 修复前红（HEAD 产品代码 + 本文件同一份断言真跑出来的输出；TF-01..05 是这里的编号，
 * 不是用例名，逐字 XML 原文对 report §8.29②）：
 *   TF-01 转身后「正在想」还得在   -> 红：屏幕上没有「正在想」（忙状态跟着 composition 死了）
 *   TF-02 转身后回信仍然上屏       -> 红：等不到（假桌面已收到=1 已放信=是，屏幕只剩用户那句）
 *   TF-03 转身后回信要落到盘上     -> 红：盘上只有用户那句
 *   TF-04 转身后手一抖再按发送     -> 红：假桌面收到 2 封（同一件事被办了两遍）
 *   TF-05 证据条也要活过转身       -> 红：等不到回信，证据条无从谈起
 *   tests="5" failures="5" / gradle 控制台：5 tests completed, 5 failed
 *
 * 三个自己踩出来的坑（都写进代码里了，别改回去）：
 *   1) 假桌面的请求体要按**字节**读满。第一版按字符读 Content-Length 个，而这句话里有中文
 *      （字节数 ≠ 字符数），假桌面自己卡在读体上，四条全红，看起来完全像「产品还没修好」。
 *      现在 `server.error` 与各条断言把「假桌面先坏了」和「产品没修好」分开。
 *   2) `compose.waitUntil` 的超时走的是 Compose 测试的虚拟时钟，这一轮的链路要过真 socket
 *      与真文件两跳，那条时间轴上不够用（实测：轮询里看到的文件永远是 72 字节那一句，
 *      紧接着 dump 出来的文件已经两句都在了）。所以这里等的是**墙上时间**，每一轮顺手
 *      `waitForIdle()` 把主线程队列泵一下。
 *   3) TF-04 第一版断的是「再按发送时键是关着的」，在 HEAD 上是**绿的**：那个键的可用性还兼着
 *      「输入框空就关着」，转屏后输入框正好是空的；改用 SemanticsActions.OnClick 判可点又被
 *      编译器提示恒真。所以这条量的是「假桌面收到几封」——见 sendAgainAndCountExtra 的注释。
 *
 * 诚实边界：
 *   - 本环境没有 KVM，起不了 emulator；「转屏」走 Activity.recreate()（同实例重走 onCreate，
 *     composition 是新的）。这条恰恰是**能**在 JVM 上分清真假的：旧代码在同一个 JVM 里
 *     协程也会被取消，所以红不是靠「实例复用」蒙出来的。
 *   - 真机旋转是新建实例；「回合归进程管、屏幕只是文件的一个视图」这条归属仍要在设备上验一次。
 *   - 进程被系统杀掉这一档本轮不管：回合还没回完就被杀，就是没回完（不假装能续上）。
 *   - 这里不截图、不验观感。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TurnInFlightRecreationTest {
  @get:Rule
  val compose = createAndroidComposeRule<MainActivity>()

  private val servers = mutableListOf<FakeTurnServer>()

  @Before
  fun `把本地 dev runner 那条后门关掉`() {
    // 同 ChatThreadPersistenceTest：user.dir 指到空目录，回退路径必败，
    // 手机就只能打真 socket 上那台假桌面，回合的快慢由测试说了算。
    val empty = File(System.getProperty("java.io.tmpdir"), "bitbot-inflight-no-repo-${System.nanoTime()}")
    empty.mkdirs()
    System.setProperty("user.dir", empty.absolutePath)
    TurnBridge.bind(RuntimeEnvironment.getApplication())
    TurnCoordinator.resetForProcessRestart()
  }

  @After
  fun `放行并关掉假桌面`() {
    // 不放行会留一堆阻塞线程；不关掉会占着端口；statics 更要清，否则下一条用例
    // 会带着上一条的「还在等回信」上台（真机上每次冷启动都是干净的）。
    servers.forEach { runCatching { it.close() } }
    servers.clear()
    TurnCoordinator.resetForProcessRestart()
  }

  private fun sendButtonMatcher() =
    hasContentDescription("发送").or(hasText("发送")) and hasClickAction()

  /**
   * 按真实墙上时间等一件事成立。见类头 2)：`waitUntil` 那条虚拟时钟不够这一轮用。
   */
  private fun awaitReal(
    timeoutMs: Long = 15_000,
    condition: () -> Boolean,
  ): Boolean {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      val ok = runCatching(condition).getOrDefault(false)
      compose.waitForIdle()
      if (ok) return true
      Thread.sleep(25)
    }
    return runCatching(condition).getOrDefault(false)
  }

  private fun screenHas(text: String): Boolean =
    compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()

  /** 起一台假桌面（回信扣在手里没放），把「凭证」指过去，然后真按一次发送。 */
  private fun sendIntoHeldTurn(body: String = REPLY_BODY): FakeTurnServer {
    val server = FakeTurnServer(body)
    servers += server
    TurnBridge.setHostUrl("http://127.0.0.1:${server.port}")
    TurnBridge.setTurnToken("inflight-turn-token")
    compose.onNode(hasSetTextAction()).performTextInput(USER_TEXT)
    compose.onNode(sendButtonMatcher()).performClick()
    // 这句话确实发出去了（用户气泡上屏），此时回信还扣在假桌面手里
    assertTrue(
      "用户那句得先上屏（连这句都没上屏，说明这条链根本没跑起来）；假桌面=${server.describe()}",
      awaitReal { screenHas(USER_TEXT) },
    )
    return server
  }

  private fun diskText(): String {
    val dir = RuntimeEnvironment.getApplication().filesDir
    return dir.listFiles()?.filter { it.isFile }?.joinToString("\n") { runCatching { it.readText() }.getOrDefault("") }
      ?: ""
  }

  /**
   * 转身后真的再打一句并按发送，返回「假桌面多收到几封」。
   * 为什么量的是收信数而不是界面的可用性：发送键是 `clickable(enabled = active)`，
   * 第一版这里写的是 `assertIsNotEnabled`，跑出来在旧代码上是**绿的** —— 那个键的可用性
   * 还兼着「输入框是空的就关着」，转屏后输入框正好是空的，红不了；后来想用
   * `config[SemanticsActions.OnClick] != null` 判可点，编译器直接提示恒真（那个 key 非空类型），
   * 又是一条假断言。真用户在意的是「这件事会不会被办两遍」，那就数假桌面收到几封。
   */
  private fun sendAgainAndCountExtra(text: String): Int {
    val before = servers.last().requests.get()
    runCatching { compose.onNode(hasSetTextAction()).performTextInput(text) }
    runCatching { compose.onNode(hasContentDescription("发送")).performClick() }
    compose.waitForIdle()
    return servers.last().requests.get() - before
  }

  @Test
  fun 转个身正在等回信这件事还得看得见() {
    val server = sendIntoHeldTurn()
    compose.onNodeWithText(WAITING_TEXT).assertExists()
    compose.activity.recreate()
    compose.waitForIdle()
    // 回合还在路上：屏幕上必须仍然看得见「正在想」，不能假装这一句已经有了结果
    assertTrue(
      "转个身之后屏幕上没有「正在想」（回合还在路上，忙状态却跟着上一屏死了）；假桌面=${server.describe()}",
      screenHas(WAITING_TEXT),
    )
  }

  @Test
  fun 转个身之后那封回信仍然要上屏() {
    val server = sendIntoHeldTurn()
    compose.activity.recreate()
    compose.waitForIdle()
    server.releaseReply()
    // 回的是给**这个进程**的，不是给某一屏的：转屏后的新组合照样要收到
    assertTrue(
      "转个身之后这封回信永远没上屏；假桌面=${server.describe()} 屏幕=${screenDump()}",
      awaitReal { screenHas(REPLY_TEXT) },
    )
    assertNull("假桌面自己不能先坏（否则这条绿红都不成立）", server.error)
  }

  @Test
  fun 转个身之后那封回信还要留在盘上() {
    val server = sendIntoHeldTurn()
    compose.activity.recreate()
    compose.waitForIdle()
    server.releaseReply()
    assertTrue(
      "回信要落进 filesDir（进程被杀重开也还在）；假桌面=${server.describe()} 盘上=${diskText()}",
      awaitReal { diskText().contains(REPLY_TEXT) },
    )
    assertNull("假桌面自己不能先坏：它一挂住就会被误读成「产品还没修好」", server.error)
    assertTrue("用户那句也要在盘上", diskText().contains(USER_TEXT))
  }

  @Test
  fun 等回信的时候转个身再按发送不许把同一件事发两遍() {
    val server = sendIntoHeldTurn()
    compose.activity.recreate()
    compose.waitForIdle()
    // 回合还在路上。这时候用户再打一句并按发送，旧实现会让它真的再发一遍 ——
    // 不是因为多写了一条逻辑，而是因为「正在等」这件事本身跟着上一屏死了（busy 没了）。
    val extra = sendAgainAndCountExtra(SECOND_TEXT)
    server.releaseReply()
    assertTrue(
      "第一句的回信还是要回来；假桌面=${server.describe()}",
      awaitReal { screenHas(REPLY_TEXT) },
    )
    // 这里不写「刚按下去那一瞬间没多收」那种断言：请求是后台线程发出去的，那一刻常常还是 0，
    // 在 HEAD 上也会绿（实测过）。只看这一回合彻底跑完之后，假桌面到底收了几封。
    assertTrue(
      "还在等回信时再按了一次发送，同一件事被办了两遍：假桌面收到 ${server.requests.get()} 封" +
        "（按下那一刻已观察到多收 $extra 封），只该收到 1 封；${server.describe()}",
      server.requests.get() == 1,
    )
  }

  @Test
  fun 消息留住了证据条也得不跟着丢() {
    val server = sendIntoHeldTurn(DELIVERED_BODY)
    compose.activity.recreate()
    compose.waitForIdle()
    server.releaseReply()
    assertTrue(
      "转个身之后回信要上屏；假桌面=${server.describe()}",
      awaitReal { screenHas(REPLY_TEXT) },
    )
    compose.onNodeWithText(REPLY_TEXT).assertExists()
    // 「这句真的发到邮件那一步了」的证据，不该在转个身之后单独消失
    compose.onNodeWithText(DELIVERY_LABEL).assertExists()
  }

  private fun screenDump(): String =
    listOf(USER_TEXT, WAITING_TEXT, REPLY_TEXT, DELIVERY_LABEL).joinToString(" ") { t ->
      "${t.take(12)}=${if (screenHas(t)) "在" else "没"}"
    }

  /**
   * 最小真 HTTP 服务：只回一封 /v1/turn 的包，什么时候放由测试决定。
   * 用 JDK 自带 ServerSocket（同 PairingIntegrationTest），不引新依赖。
   */
  private class FakeTurnServer(private val body: String) : AutoCloseable {
    val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
    val port: Int = socket.localPort
    val requests = AtomicInteger(0)

    @Volatile
    var error: String? = null

    private val release = CountDownLatch(1)

    @Volatile
    private var running = true

    init {
      val t =
        Thread {
          while (running) {
            val client =
              try {
                socket.accept()
              } catch (e: Exception) {
                return@Thread
              }
            Thread {
              try {
                answer(client)
              } catch (e: Throwable) {
                error = "${e::class.simpleName}: ${e.message}"
              }
            }.start()
          }
        }
      t.isDaemon = true
      t.start()
    }

    /** 收到的请求是一行行 ASCII，读满 Content-Length 个**字节**才算收完。 */
    private fun readLine(raw: InputStream): String? {
      val sb = StringBuilder()
      while (true) {
        val b = raw.read()
        if (b < 0) return if (sb.isEmpty()) null else sb.toString()
        if (b == '\n'.code) return sb.toString().trimEnd('\r')
        sb.append(b.toChar())
      }
    }

    private fun answer(client: Socket) {
      client.use { s ->
        val raw = s.getInputStream()
        var len = 0
        while (true) {
          val line = readLine(raw) ?: break
          if (line.isEmpty()) break
          if (line.lowercase().startsWith("content-length:")) {
            len = line.substringAfter(":").trim().toIntOrNull() ?: 0
          }
        }
        val buf = ByteArray(len.coerceAtLeast(0))
        var off = 0
        while (off < len) {
          val n = raw.read(buf, off, len - off)
          if (n < 0) break
          off += n
        }
        requests.incrementAndGet()
        if (!release.await(60, TimeUnit.SECONDS)) return
        val bytes = body.toByteArray(Charsets.UTF_8)
        val out = s.getOutputStream()
        val head =
          "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        out.write(head.toByteArray(Charsets.UTF_8))
        out.write(bytes)
        out.flush()
      }
    }

    fun releaseReply() {
      release.countDown()
    }

    /** 失败信息里带上假桌面自己的状态：「它没放信」和「产品没接住」是两件事。 */
    fun describe(): String = "收到=${requests.get()} 已放信=${if (release.count == 0L) "是" else "否"} 自身故障=${error ?: "无"}"

    override fun close() {
      release.countDown()
      running = false
      runCatching { socket.close() }
    }
  }

  companion object {
    private const val USER_TEXT = "帮我把今天这三条热点排成一篇稿"
    private const val SECOND_TEXT = "顺便再给一版标题"
    private const val REPLY_TEXT = "已经排好：三条热点按热度倒序，标题给你两版。"
    private const val WAITING_TEXT = "Bit Bot 正在想…"
    private const val DELIVERY_LABEL = "SendToUser:email"
    private const val REPLY_BODY = """{"ok":true,"messages":[{"role":"assistant","text":"$REPLY_TEXT"}]}"""
    private const val DELIVERED_BODY =
      """{"ok":true,"messages":[{"role":"assistant","text":"$REPLY_TEXT"}],""" +
        """"host_results":[{"kind":"delivery","ok":true,"stdout":"{\"type\":\"email\"}"}]}"""
  }
}
