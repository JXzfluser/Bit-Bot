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
import org.json.JSONObject
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
 * A1-4 的最后一寸：**帧要变成屏幕上的那一行**。
 *
 * 为什么这一文件必须在：在它之前，仓里没有任何一条用例证明「SSE 帧 → 界面看得见」。
 * `TurnInFlightRecreationTest` 那台假桌面虽然记了 `sseConnections`，但**没有任何断言读过它**；
 * `prove_android_event_stream` 是结构门（读 Kotlin 源码），只说「代码在渲染路径上」，
 * 不说「帧真的渲染出来了」。按唯一口径（用户在真机里能否走通），这两者之间隔着的正是本轮。
 *
 * 覆盖（ES-01..ES-08）：
 *   ES-01 简体设备上 progress 帧要真的渲染成屏幕上的一行（不是 JSON、不是空气泡）
 *   ES-02 计数前缀要在（`1/7 正在执行工具调用`）—— 桌面同源，手机不许丢掉进度感
 *   ES-03 繁体设备上同一批帧要说繁体（三语接到**渲染结果**，不只是字符串层）
 *   ES-04 英文设备上同一批帧要说英文
 *   ES-05 `turn_started`/`turn_ended` 也要上屏（首尾各一行，用户知道这轮开始与结束）
 *   ES-06 订的是自己那个会话（`?session_id=mobile-android`，与服务端默认同规则）
 *   ES-07 回合结束后连接要真的关掉（不许在手机上挂一条后台长连接）
 *   ES-08 拿不到流（503）时屏幕上要有回退提示，而不是空屏
 *
 * 判据有牙怎么证的（不是写完就宣称有效）：
 *   1) 把 MainActivity 往 HomeScreen 传进度行那条参数删掉（`progressLines = progressLines,`）
 *      单跑本类 → ES-01/02/03/04/05 五条红（状态里有一行、屏幕上没有）；恢复后回绿。原文见 §8.63.9。
 *   2) 把假桌面改成照服务端规则推会话并按 ?session_id= 过滤之后，本类当场红 6 条 —— 照出的是
 *      产品真 bug（回合写死 android-app、订阅另算 mobile-android）。原文见 §8.63.10。
 *
 * 诚实边界：
 *   - 本机无 KVM，跑的是 Robolectric（真 socket + 真 Compose 渲染树，但不是真设备）。
 *   - 这里不截图、不验观感、不验动画。
 *   - 极快回合少首帧这一档（R-A1-4a）本文件不掩盖：正因为不等连接建立，
 *     这里的假桌面**先挂着回合回执再放帧**，量的才是「帧到了屏幕」而不是「运气好赶上」。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class EventStreamUiWiringTest {
  @get:Rule
  val compose = createAndroidComposeRule<MainActivity>()

  private val servers = mutableListOf<FakeSseDesktop>()

  @Before
  fun `把本地 dev runner 那条后门关掉`() {
    val empty = File(System.getProperty("java.io.tmpdir"), "bitbot-esui-no-repo-${System.nanoTime()}")
    empty.mkdirs()
    System.setProperty("user.dir", empty.absolutePath)
    TurnBridge.bind(RuntimeEnvironment.getApplication())
    TurnCoordinator.resetForProcessRestart()
  }

  @After
  fun `放行并关掉假桌面`() {
    servers.forEach { runCatching { it.close() } }
    servers.clear()
    TurnCoordinator.resetForProcessRestart()
    // currentLocale 是进程级全局（同 EventStreamMessagesTest 的 @Before 复位一个道理）：
    // 这一类每条各钉一种语言，不复位就会把期望泄漏到下一条、下一类。
    EventStreamMessages.currentLocale = "zh-CN"
  }

  private fun sendButtonMatcher() =
    hasContentDescription("发送").or(hasText("发送")) and hasClickAction()

  private fun awaitReal(timeoutMs: Long = 20_000, condition: () -> Boolean): Boolean {
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
    compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()

  /**
   * 起假桌面、把界面语言钉住、发一句、等用户那句上屏。
   *
   * 为什么在这里显式钉 locale：Robolectric 的默认 locale 是 `en-US`，
   * 于是 MainActivity 的 `localeFrom(...)` 会把界面推进英文分支 —— 这不是 bug，
   * 但它会让「简体期望」变成假红（本轮第一跑就红在这里，dump 原文
   * `progressLines=[Turn started, Running a tool, Running a tool, Turn ended]`，
   * 帧其实已经上屏）。系统 locale 那条赋值链路由 AE-07 结构门与
   * `EventStreamMessagesTest` 的 `localeFrom` 用例钉；这里钉的是**渲染结果**，
   * 所以三语各来一次（ES-01/02/03），一句话都不许靠默认值蒙。
   */
  private fun sendIntoHeldTurn(
    pushFrames: Boolean,
    locale: String = "zh-CN",
    burst: Boolean = false,
  ): FakeSseDesktop {
    val server = FakeSseDesktop(pushFrames = pushFrames, burst = burst)
    servers += server
    TurnBridge.setHostUrl("http://127.0.0.1:${server.port}")
    TurnBridge.setTurnToken("esui-turn-token")
    EventStreamMessages.currentLocale = locale
    compose.onNode(hasSetTextAction()).performTextInput(USER_TEXT)
    compose.onNode(sendButtonMatcher()).performClick()
    assertTrue(
      "用户那句得先上屏，否则这条链根本没跑起来；假桌面=${server.describe()}",
      awaitReal { screenHas(USER_TEXT) },
    )
    return server
  }

  @Test
  fun 简体设备上progress帧要渲染成桌面上那句话() {
    val server = sendIntoHeldTurn(pushFrames = true, locale = "zh-CN")
    assertTrue(
      "帧必须真的变成屏幕上的一行（红 = 手机是一张空屏）；" +
        "progressLines=${TurnCoordinator.progressLines} busy=${TurnCoordinator.busy} 假桌面=${server.describe()}",
      awaitReal { screenHas(PROGRESS_ZH) },
    )
    assertNull("假桌面自己不能先坏（否则绿红都不成立）", server.error)
    server.releaseReply()
  }

  @Test
  fun 进度行要带着第几跳的计数() {
    val server = sendIntoHeldTurn(pushFrames = true, locale = "zh-CN")
    assertTrue(
      "手机要像桌面一样说「1/7 正在执行工具调用」，光秃秃一行没有进度感；" +
        "progressLines=${TurnCoordinator.progressLines} 假桌面=${server.describe()}",
      awaitReal { screenHas("1/7 $PROGRESS_ZH") },
    )
    server.releaseReply()
  }

  @Test
  fun 繁体设备上同一批帧要说繁体() {
    val server = sendIntoHeldTurn(pushFrames = true, locale = "zh-TW")
    assertTrue(
      "同一批帧在繁体设备上必须渲染繁体文案（这条钉的是「三语接上了系统 locale」，不是只改了字符串层）；" +
        "progressLines=${TurnCoordinator.progressLines} 假桌面=${server.describe()}",
      awaitReal { screenHas(PROGRESS_ZH_TW) },
    )
    server.releaseReply()
  }

  @Test
  fun 英文设备上同一批帧要说英文() {
    val server = sendIntoHeldTurn(pushFrames = true, locale = "en")
    assertTrue(
      "同一批帧在英文设备上必须渲染英文文案；progressLines=${TurnCoordinator.progressLines} 假桌面=${server.describe()}",
      awaitReal { screenHas(PROGRESS_EN) },
    )
    server.releaseReply()
  }

  @Test
  fun 回合首尾各要有一行让用户知道这轮开始和结束() {
    val server = sendIntoHeldTurn(pushFrames = true, locale = "zh-CN")
    assertTrue(
      "turn_started 要上屏；progressLines=${TurnCoordinator.progressLines} 假桌面=${server.describe()}",
      awaitReal { screenHas("回合开始") },
    )
    // turn_ended 是客户端按契约关流的依据，它那一行也要看得见
    assertTrue(
      "turn_ended 要上屏成「回合完成」；progressLines=${TurnCoordinator.progressLines} 假桌面=${server.describe()}",
      awaitReal { screenHas("回合完成") },
    )
    server.releaseReply()
  }

  @Test
  fun 订阅订的是自己那个会话() {
    val server = sendIntoHeldTurn(pushFrames = true)
    assertTrue(
      "客户端真的发起过 /v1/events 订阅（一次都没有 = 界面拿不到帧）；假桌面=${server.describe()}",
      awaitReal { server.sseConnections.get() >= 1 },
    )
    assertTrue(
      "订阅必须带 session_id=mobile-android，否则会看见别人的会话帧；path=${server.ssePath}",
      server.ssePath.contains("session_id=mobile-android"),
    )
    server.releaseReply()
  }

  @Test
  fun 回合结束后这条长连接要真的关掉() {
    val server = sendIntoHeldTurn(pushFrames = true)
    assertTrue(
      "先等到进度行上屏，连接才算真开过；假桌面=${server.describe()}",
      awaitReal { server.sseConnections.get() >= 1 },
    )
    server.releaseReply()
    // turn_ended 一到客户端就该收线；挂着不放是手机上的电量与连接泄漏
    assertTrue(
      "回合结束后假桌面必须观察到订阅被挂断（live 仍 >0 就是客户端漏连接）；假桌面=${server.describe()}",
      awaitReal(timeoutMs = 20_000) { server.liveSse.get() == 0 },
    )
  }

  @Test
  fun 连发的进度帧一条都不许丢() {
    val server = sendIntoHeldTurn(pushFrames = true, burst = true)
    // 12 帧连发（中间不 sleep）：这一条量的不是「有没有显示」，
    // 而是「读-改-写在另一条线程上时，会不会把别人刚加的那行吃掉」。
    // 丢帧在真机上的样子是进度条跳号、看起来像卡住 —— 正是这一刀要钉死的东西。
    assertTrue(
      "12 帧必须一条不丢；实际收到=${TurnCoordinator.progressLines} 假桌面=${server.describe()}",
      awaitReal(timeoutMs = 20_000) {
        TurnCoordinator.progressLines.count { it.contains("/12 ") } == BURST
      },
    )
    server.releaseReply()
  }

  @Test
  fun 拿不到事件流时屏幕上要有回退提示而不是空屏() {
    val server = sendIntoHeldTurn(pushFrames = false, locale = "zh-CN")
    assertTrue(
      "503 要说人话：界面上必须有「实时进度暂时不可用」这一行；" +
        "fallback=${TurnCoordinator.fallbackMessage} busy=${TurnCoordinator.busy} 假桌面=${server.describe()}",
      awaitReal { screenHas("实时进度暂时不可用") },
    )
    assertNull("假桌面自己不能先坏", server.error)
    server.releaseReply()
  }

  /**
   * ES-09 回合落的会话与订阅的会话必须是**同一个值**。
   *
   * 这条钉的是本轮修掉的真 bug：`TurnBridge.runTurnHttp` 的 body 一直写死
   * `session_id = "android-app"`，而订阅按服务端默认规则算出 `mobile-android`
   * —— 两边从来没对上。服务端的事件流是**按会话过滤**的
   * （`cn_inbound_server.js:1069-1072` → `event_log.js:233` 那条 SQL），
   * 所以后果不是「少几帧」而是**一条都收不到**：手机发得出回合、界面永远是空的。
   *
   * 为什么这条必须存在（而不是靠前面那几条顺带发现）：上一版 fixture 把帧的
   * `sessionId` 写成测试自己的常量，等于把「回合落哪个会话」和「订哪个会话」
   * 糊成同一件事 —— 真 bug 被 fixture 撑绿。现在 fixture 逐字照服务端推会话，
   * 这条再把两边钉在一起，坏在任何一边都会红。
   */
  @Test
  fun 回合的会话与订阅的会话必须是同一个() {
    val server = sendIntoHeldTurn(pushFrames = true)
    assertTrue(
      "先要真订上，否则比较没有意义；假桌面=${server.describe()}",
      awaitReal { server.sseConnections.get() >= 1 },
    )
    // 订阅那一刻就发出去了，回合随后落地；等服务端规则把本轮会话定下来
    assertTrue(
      "回合必须落地（假桌面要从 POST body 推出会话）；假桌面=${server.describe()}",
      awaitReal { server.turnSession().isNotEmpty() },
    )
    val posted = server.turnSession()
    val subscribed = server.sseRequestedSession
    assertTrue(
      "POST 的 session_id 与订阅的 session_id 必须是同一个值，否则服务端按会话过滤后手机一条帧都收不到；" +
        "回合=$posted 订阅=$subscribed 假桌面=${server.describe()}",
      posted.isNotEmpty() && posted == subscribed,
    )
    assertTrue(
      "被会话规则滤掉的帧必须是 0；被滤=${server.filteredFrames.get()} 回合=$posted 订阅=$subscribed",
      server.filteredFrames.get() == 0,
    )
    server.releaseReply()
  }

  /**
   * 最小真 HTTP 假桌面：`/v1/events` 按 SSE 侍候并**真的往里面推帧**，
   * `/v1/turn` 的回执扣在手里由测试放（这样断言窗口一定落在 busy 期间 ——
   * `ProgressRow`/`FallbackRow` 只在 busy 时渲染）。
   */
  private class FakeSseDesktop(
    private val pushFrames: Boolean,
    private val burst: Boolean = false,
  ) : AutoCloseable {
    val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
    val port: Int = socket.localPort
    val requests = AtomicInteger(0)
    val sseConnections = AtomicInteger(0)

    @Volatile
    var ssePath: String = ""

    /** 当前还开着的订阅数：客户端关线时这里会掉回 0。 */
    val liveSse = AtomicInteger(0)

    /**
     * 这一回合**实际落在哪个会话里** —— 由 POST /v1/turn 的 body 决定，规则逐字照服务端
     * （`cn_inbound_server.js:902-903`：`sessionId = payload.session_id || \`mobile-${machineKind}\``）。
     *
     * 为什么要假桌面记这个：客户端是「先开订阅、再发回合」，所以真服务端在订阅那一刻
     * 还不知道本轮会话名 —— 帧是回合跑起来才写进事件库、再被 tail 推下去的。
     * 上一版本 fixture 把帧的 `sessionId` 写死成测试自己的常量，于是
     * 「订阅的会话」与「回合落的会话」这两件事被 fixture 糊成了同一件事 ——
     * 客户端两条路径各用一个字符串、互相对不上的真 bug 就这么被撑绿了。
     * 现在：帧的 sessionId 只认 POST body 推出来的那个，并按服务端的规则做 `?session_id=` 过滤。
     */
    @Volatile
    private var turnSessionId: String? = null

    /** 因为会话不匹配而被服务端规则滤掉的帧数（真机上这就是「手机上什么都没有」）。 */
    val filteredFrames = AtomicInteger(0)

    @Volatile
    var sseRequestedSession: String = ""

    /** 本轮真正落地的那个会话（等 POST 才知道）。 */
    @Volatile
    private var frameSessionId: String = ""

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
            }.apply { isDaemon = true }.start()
          }
        }
      t.isDaemon = true
      t.start()
    }

    private fun readLine(raw: InputStream): String? {
      val sb = StringBuilder()
      while (true) {
        val b = raw.read()
        if (b < 0) return if (sb.isEmpty()) null else sb.toString()
        if (b == '\n'.code) return sb.toString().trimEnd('\r')
        sb.append(b.toChar())
      }
    }

    /**
     * 一帧的原样字节。
     *
     * 这里是**照抄服务端**（`cn_inbound_server.js:1043-1064` 的 `sendEv`）：
     * `id: <seq>` / `event: <kind>` / `data: {"seq","sessionId","turnId","kind","payload","actor","ts"}`。
     * 本文件第一版把 `turn_id`/`row` 直接写在 data 顶层，于是 8 条里红 2 条 ——
     * 客户端读的是 `data.turnId` 与 `data.payload`（`EventStreamClient.parseEvent`），
     * 顶层字段在它眼里等于没有字段。又一次「fixture 自己先坏，看着完全像产品没接上」
     * （同类的还有把 ui/ 两个文件复制到错目录那次）。改 fixture 之前先对过源码形状。
     */
    private fun frame(
      seq: Int,
      kind: String,
      payload: String,
    ): String =
      "id: $seq\nevent: $kind\n" +
        "data: {\"seq\":$seq,\"sessionId\":\"$frameSessionId\",\"turnId\":\"esui-1\",\"kind\":\"$kind\"," +
        "\"payload\":$payload,\"actor\":\"mobile\",\"ts\":1730500000000}\n\n"

    private fun answer(client: Socket) {
      client.use { s ->
        val raw = s.getInputStream()
        var len = 0
        var method = ""
        var path = ""
        while (true) {
          val line = readLine(raw) ?: break
          if (line.isEmpty()) break
          if (line.lowercase().startsWith("content-length:")) {
            len = line.substringAfter(":").trim().toIntOrNull() ?: 0
          }
          if (method.isEmpty() && line.matches(Regex("^[A-Z]+ /.* HTTP/.*"))) {
            val parts = line.split(" ")
            if (parts.size >= 2) {
              method = parts[0]
              path = parts[1]
            }
          }
        }
        val buf = ByteArray(len.coerceAtLeast(0))
        var off = 0
        while (off < len) {
          val n = raw.read(buf, off, len - off)
          if (n < 0) break
          off += n
        }

        if (method == "POST" && path == "/v1/turn") {
          requests.incrementAndGet()
          // 服务端就是从这里定本轮会话的（cn_inbound_server.js:902-903）—— 假桌面照同一条规则。
          val bodyText = String(buf, 0, off, Charsets.UTF_8)
          turnSessionId =
            runCatching {
              val o = JSONObject(bodyText)
              val s = o.optString("session_id")
              if (s.isNotEmpty()) s else "mobile-" + o.optString("machine_kind", "mobile")
            }.getOrDefault("mobile-android")
          // 真服务端在回合落地那一刻就知道会话名（事件行就是这么打的），这里同步记下，
          // 免得断言窗口比 SSE handler 快一步时 dump 出现「本轮会话=未落地」这种误导人的快照。
          frameSessionId = turnSessionId ?: ""
          if (!release.await(60, TimeUnit.SECONDS)) return
          val bytes = REPLY_BODY.toByteArray(Charsets.UTF_8)
          val out = s.getOutputStream()
          out.write(
            (
              "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n" +
                "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
              ).toByteArray(Charsets.UTF_8),
          )
          out.write(bytes)
          out.flush()
          return
        }

        if (method == "GET" && path.startsWith("/v1/events")) {
          sseConnections.incrementAndGet()
          liveSse.incrementAndGet()
          ssePath = path
          sseRequestedSession = path.substringAfter("session_id=", "").substringBefore("&")
          try {
            val out = s.getOutputStream()
            if (!pushFrames) {
              // 事件库没开 —— 真实桌面的原样回法（cn_inbound_server.js 的 503 分支）
              val body = """{"ok":false,"error":"event_log_unavailable"}""".toByteArray(Charsets.UTF_8)
              out.write(
                (
                  "HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json; charset=utf-8\r\n" +
                    "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n"
                  ).toByteArray(Charsets.UTF_8),
              )
              out.write(body)
              out.flush()
              return
            }
            out.write(
              (
                "HTTP/1.1 200 OK\r\n" +
                  "Content-Type: text/event-stream; charset=utf-8\r\n" +
                  "Cache-Control: no-cache\r\n" +
                  "Connection: keep-alive\r\n\r\n"
                ).toByteArray(Charsets.UTF_8),
            )
            out.flush()
            // 真服务端是 tail：帧由回合写进事件库，订阅这边按 ?session_id= 过滤后一轮一轮推。
            // 假桌面照同一套顺序 —— 先等本轮落地拿到它的会话名，再按服务端规则决定推不推。
            val frameSession = awaitTurnSession()
            if (frameSession == null) {
              error = "等 20s 没等到 POST /v1/turn：回合没发出去，这条链没跑起来"
              return
            }
            frameSessionId = frameSession
            val mine = sseRequestedSession.isEmpty() || sseRequestedSession == frameSession
            if (!mine) {
              // cn_inbound_server.js:1069-1072 → event_log.js:233 的那条 SQL 过滤：
              // 订错会话就是**一条都收不到**，不是「少几条」。连接照真服务端那样挂着空转。
              filteredFrames.addAndGet(if (burst) BURST + 1 else 4)
            } else if (burst) {
              // 连发：一句 sleep 都不插，12 帧一起灌下去（真机上的 AgentLoop 就是这个节奏）
              val sb = StringBuilder()
              for (i in 1..BURST) {
                sb.append(
                  frame(
                    i,
                    "progress",
                    """{"turn_id":"esui-1","row":{"phase":"start","index":$i,"total":$BURST,"kind":"tool",""" +
                      """"category":"tool_activity","label_key":"progTool","command":"step_$i","at":1730500000000}}""",
                  ),
                )
              }
              sb.append(frame(BURST + 1, "turn_ended", """{"turn_id":"esui-1","status":"ok"}"""))
              out.write(sb.toString().toByteArray(Charsets.UTF_8))
              out.flush()
            } else {
              // 帧的形状逐字照服务端：turn_event_emitter.js:26-58 + turn_progress.js:121-128
              out.write(frame(1, "turn_started", """{"turn_id":"esui-1","initiator":"android"}""").toByteArray(Charsets.UTF_8))
            out.flush()
            Thread.sleep(120)
            out.write(
              frame(
                2,
                "progress",
                """{"turn_id":"esui-1","row":{"phase":"start","index":1,"total":7,"kind":"tool",""" +
                  """"category":"tool_activity","label_key":"progTool","command":"rank_topics","at":1730500000000}}""",
              ).toByteArray(Charsets.UTF_8),
            )
            out.flush()
            Thread.sleep(120)
            out.write(
              frame(
                3,
                "progress",
                """{"turn_id":"esui-1","row":{"phase":"done","index":1,"total":7,"kind":"tool",""" +
                  """"category":"tool_activity","label_key":"progTool","command":"rank_topics","at":1730500000200,"ok":true}}""",
              ).toByteArray(Charsets.UTF_8),
            )
            out.flush()
            Thread.sleep(120)
            out.write(frame(4, "turn_ended", """{"turn_id":"esui-1","status":"ok"}""").toByteArray(Charsets.UTF_8))
            out.flush()
            }
          } catch (e: Throwable) {
            error = "写帧失败 ${e::class.simpleName}: ${e.message}"
          } finally {
            // 客户端关线时这边 read() 返回 -1；一直读到 EOF 才把 live 计数控回来
            runCatching {
              val until = System.currentTimeMillis() + 25_000L
              while (running && System.currentTimeMillis() < until && raw.read() >= 0) {}
            }
            liveSse.decrementAndGet()
          }
          return
        }
      }
    }

    /** 订阅先开、回合后发（真机就是这个顺序），所以这里要等本轮落地。 */
    private fun awaitTurnSession(): String? {
      val until = System.currentTimeMillis() + 20_000L
      while (System.currentTimeMillis() < until) {
        val v = turnSessionId
        if (v != null) return v
        Thread.sleep(25)
      }
      return null
    }

    /** 本轮 body 推出来的会话名（测试要拿它对订阅的会话做比较）。 */
    fun turnSession(): String = turnSessionId ?: ""

    fun releaseReply() {
      release.countDown()
    }

    fun describe(): String =
      "POST回合=${requests.get()} SSE连接=${sseConnections.get()} 在线=${liveSse.get()} 本轮会话=${frameSessionId.ifEmpty { "未落地" }} 订阅会话=${sseRequestedSession.ifEmpty { "无" }} 被滤掉的帧=${filteredFrames.get()} 自身故障=${error ?: "无"}"

    override fun close() {
      release.countDown()
      running = false
      runCatching { socket.close() }
    }
  }

  companion object {
    private const val USER_TEXT = "把今天这三条热点排个序"
    private const val REPLY_BODY = """{"ok":true,"messages":[{"role":"assistant","text":"排好了。"}]}"""

    /** 桌面同源的那句 progTool（`index.html` 三语表里的 else 分支）。 */
    private const val PROGRESS_ZH = "正在执行工具调用"
    private const val PROGRESS_ZH_TW = "正在執行工具呼叫"
    private const val PROGRESS_EN = "Running a tool"

    /** 与服务端默认同规则的会话名（`cn_inbound_server.js:902-903`）。 */
    private const val SESSION = "mobile-android"

    /** 连发帧数：够大到让「另一条线程上的读-改-写」丢一到两行。 */
    private const val BURST = 12
  }
}
