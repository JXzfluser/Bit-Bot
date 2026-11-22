package com.bitbot.host

import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onAllNodes
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.bitbot.host.ui.BitBotTheme
import com.bitbot.host.ui.TaskCommandSheet
import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList

/**
 * P1 批 5 的最后一寸:**服务端那份 JSON 要真的变成手机屏幕上的那几行**。
 *
 * 为什么这一文件必须在:
 *   · `scripts/prove_mobile_task_client.js` 是**结构门**(读源码,证明端上抄的端点/字段没漂);
 *   · 上一条(结构门)证明不了「点下去真的打到了那条路由」——
 *     端上把 `room_id` 拼错字段名、把 task_sig 忘了编码,结构门看得见字面量,
 *     但看得见不等于**发得出去**。
 *   ⇒ 这里起一个**真 HTTP 假桌面**(真的监听 127.0.0.1、真的收 body),
 *     让真的 `TaskCommandClient` 打过去,再用真的 Compose 语义树断言屏幕上出现了对应行。
 *
 * 覆盖(TCU-01..TCU-04):
 *   TCU-01 清单里那条任务要真的上屏(标题 + 两个计数 + 「要你拍板」那一句);
 *   TCU-02 四个动作按钮要真的在屏上;
 *   TCU-03 插话要真的打到 `/v1/tasks/<encodeURIComponent(task_sig)>/steer`,
 *          body 里带 `room_id` 与 `text`;
 *   TCU-04 「没有在跑的」那张卡不该给刹停 —— 能不能点**只**看服务端的 `can.*`。
 *
 * 诚实边界:
 *   - 本机无 KVM,跑的是 Robolectric(真 socket + 真 Compose 渲染树,不是真设备);
 *   - 这里不截图、不验观感、不验动画;
 *   - 假桌面**不验设备签名**(端上没配对时就没有签名头)——
 *     签名那一层由 `prove_mobile_approval_client.js` / `prove_ios_device_identity.js` 守着。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TaskCommandUiWiringTest {
  @get:Rule
  val compose = createComposeRule()

  private var server: HttpServer? = null

  /** 假桌面收到的每一条请求：「路径 + body」。 */
  private val received = CopyOnWriteArrayList<String>()

  /**
   * 把界面语言**钉死**在简体上。
   *
   * 为什么必须钉：`EventStreamMessages.currentLocale` 是进程级全局，而本类用的是
   * `createComposeRule()`（不启动 MainActivity）⇒ 那条赋值链不跑，语言就停在默认值上。
   * 同一个 JVM 里别的用例（EventStreamUiWiringTest / EventStreamMessagesTest）会改它 ——
   * 不钉住，期望的简体文案就可能变成假红。
   */
  @Before
  fun 把语言钉在简体上() {
    EventStreamMessages.currentLocale = "zh-CN"
  }

  @After
  fun 关掉假桌面() {
    server?.stop(0)
    server = null
    received.clear()
    EventStreamMessages.currentLocale = "zh-CN"
  }

  /** 起一个**真 HTTP**的假桌面:监听随机端口,按路径回不同的 JSON。 */
  private fun startFakeDesktop(): Int {
    val s = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    s.createContext("/") { ex ->
      // rawPath:要的是**编码后**的那一段(端上漏了编码,这里就看得见差别)。
      val path = ex.requestURI.rawPath ?: ""
      val body = ex.requestBody.readBytes().toString(Charsets.UTF_8)
      received.add(path + " " + body)
      val payload =
        when {
          path == "/v1/tasks" -> TASKS_JSON
          path.endsWith("/steer") -> STEER_OK_JSON
          else -> """{"ok":false,"error":"task_command_not_found"}"""
        }
      val bytes = payload.toByteArray(Charsets.UTF_8)
      ex.responseHeaders.add("Content-Type", "application/json; charset=utf-8")
      ex.sendResponseHeaders(200, bytes.size.toLong())
      ex.responseBody.use { it.write(bytes) }
    }
    s.start()
    server = s
    return s.address.port
  }

  private fun renderSheet(port: Int) {
    val app = RuntimeEnvironment.getApplication()
    compose.setContent {
      BitBotTheme(darkTheme = false) {
        TaskCommandSheet(
          client = TaskCommandClient(app, "http://127.0.0.1:$port"),
          epoch = 0,
          onDismiss = {},
        )
      }
    }
    compose.waitForIdle()
  }

  private fun screenHas(text: String): Boolean =
    compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()

  private fun awaitReal(timeoutMs: Long = 20_000, condition: () -> Boolean): Boolean {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      val ok = runCatching { condition() }.getOrDefault(false)
      compose.waitForIdle()
      if (ok) return true
      Thread.sleep(25)
    }
    return runCatching { condition() }.getOrDefault(false)
  }

  /** TCU-01 清单里那条任务要真的上屏。 */
  @Test
  fun 清单里那条任务要真的上屏() {
    val port = startFakeDesktop()
    renderSheet(port)
    assertTrue(
      "任务标题必须真的变成屏幕上的一行（红 = 手机是一张空屏）；收到=${received.toList()}",
      awaitReal { screenHas(TITLE) },
    )
    compose.onNodeWithText("要你拍板 1").assertExists()
    compose.onNodeWithText("在跑 1").assertExists()
    compose.onNodeWithText(QUESTION).assertExists()
  }

  /** TCU-02 四个动作按钮要真的在屏上。 */
  @Test
  fun 四个动作按钮要真的在屏上() {
    val port = startFakeDesktop()
    renderSheet(port)
    assertTrue(awaitReal { screenHas(TITLE) })
    compose.onAllNodesWithText("插话").fetchSemanticsNodes()
    compose.onAllNodesWithText("改向").fetchSemanticsNodes()
    compose.onAllNodesWithText("刹停").fetchSemanticsNodes()
    compose.onAllNodesWithText("换人").fetchSemanticsNodes()
    assertTrue(
      "四个动作按钮至少各有一个（收到=${received.toList()}）",
      compose.onAllNodesWithText("插话").fetchSemanticsNodes().isNotEmpty() &&
        compose.onAllNodesWithText("改向").fetchSemanticsNodes().isNotEmpty() &&
        compose.onAllNodesWithText("刹停").fetchSemanticsNodes().isNotEmpty() &&
        compose.onAllNodesWithText("换人").fetchSemanticsNodes().isNotEmpty(),
    )
  }

  /** TCU-03 插话要真的打到那条路由(路径带编码后的 task_sig,body 带 room_id 与 text)。 */
  @Test
  fun 插话要真的打到服务端那条路由() {
    val port = startFakeDesktop()
    renderSheet(port)
    assertTrue(awaitReal { screenHas(TITLE) })
    compose.onAllNodes(hasSetTextAction())[0].performTextInput("换个角度")
    compose.waitForIdle()
    compose.onAllNodesWithText("插话")[0].performClick()
    assertTrue(
      "插话必须真的打到 /v1/tasks/<encodeURIComponent(task_sig)>/steer；收到=${received.toList()}",
      awaitReal { received.any { it.startsWith("/v1/tasks/room-a%7Cmsg-1/steer") } },
    )
    assertTrue(
      "body 里必须带 room_id 与 text（端上把字段名抄错 ⇒ 服务端 400）；收到=${received.toList()}",
      received.any { it.contains("\"room_id\"") && it.contains("\"text\"") },
    )
  }

  /** TCU-04 「没有在跑的」那张卡不该给刹停(can.cancel 是服务端算的)。 */
  @Test
  fun 没有在跑的那张卡不给刹停() {
    val port = startFakeDesktop()
    renderSheet(port)
    assertTrue(awaitReal { screenHas(TITLE) })
    // 清单里两条:第一条 can.cancel=false,第二条 can.cancel=true ⇒ 屏上只该有一个「刹停」。
    assertTrue(
      "「刹停」只该出现在服务端说 can.cancel 的那张卡上；收到=${received.toList()}",
      awaitReal { compose.onAllNodesWithText("刹停").fetchSemanticsNodes().size == 1 },
    )
  }

  companion object {
    private const val TITLE = "写一篇稿子"
    private const val QUESTION = "用哪个角度？"

    /** 与服务端 `toTaskListItem` 的返回对象**逐字同形**的两条清单。 */
    private const val TASKS_JSON = """
      {"ok":true,"device_id":"dev-test","count":2,"tasks":[
        {"task_sig":"room-a|msg-1","room_id":"room-a","room_title":"内容团队",
         "bucket":"needs_you","state":"waiting","title":"写一篇稿子","task":"写一篇稿子",
         "members":["Alice","Bob"],
         "steps":[{"name":"Alice","bot_id":"b1","ok":true,"text":"我先去找资料","error":"",
                   "at":"2026-11-21T10:00:00.000Z"}],
         "needs_you":{"question":"用哪个角度？","candidates":["A","B"],
                      "at":"2026-11-21T10:00:00.000Z"},
         "total":2,"returned":1,"partial":true,"running":false,
         "at":"2026-11-21T10:00:00.000Z","updated_at":"2026-11-21T10:01:00.000Z",
         "can":{"steer":true,"replan":true,"swap":true,"cancel":false}},
        {"task_sig":"room-b|msg-2","room_id":"room-b","room_title":"市场小组",
         "bucket":"working","state":"","title":"盯一下热点","task":"盯一下热点",
         "members":["Bob"],
         "steps":[{"name":"Bob","bot_id":"b2","ok":true,"text":"在看","error":"",
                   "at":"2026-11-21T10:02:00.000Z"}],
         "needs_you":null,"total":1,"returned":0,"partial":false,"running":true,
         "at":"2026-11-21T10:02:00.000Z","updated_at":"2026-11-21T10:02:00.000Z",
         "can":{"steer":true,"replan":true,"swap":true,"cancel":true}}]}
    """

    private const val STEER_OK_JSON = """
      {"ok":true,"device_id":"dev-test","action":"steer","task_sig":"room-a|msg-1",
       "room_id":"room-a","scope":"next_hop","current_turn_sees":false}
    """
  }
}
