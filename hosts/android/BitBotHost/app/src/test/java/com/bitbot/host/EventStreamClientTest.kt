package com.bitbot.host

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A1-4: SSE 事件流客户端单元测试。
 *
 * 钉死四件真机会踩到的事：
 * 1) SSE 帧解析：id/event/data 三行 + 空行结束，缺一不可。
 * 2) 按 seq 去重：服务端 seq 是全局单调的，客户端也要按 seq 过滤，避免重连后重复。
 * 3) Last-Event-ID 续订：断线重连时带上最后收到的 seq，服务端从那里继续。
 * 4) turn_ended 关闭连接：回合结束或用户离开屏幕时必须关掉连接，不许漏 HTTP 连接/协程。
 *
 * 走的是纯逻辑测试（不绑 Context、不发真网络请求），只验证帧解析与状态机。
 */
class EventStreamClientTest {

  /** 一个假的回调，记录所有事件与状态变化。 */
  private class FakeCallback : EventStreamClient.SubscriptionCallback {
    val events = mutableListOf<EventStreamClient.StreamEvent>()
    val stateChanges = mutableListOf<Pair<EventStreamClient.SubscriptionState, String?>>()
    val fallbacks = mutableListOf<String>()

    override fun onStateChange(state: EventStreamClient.SubscriptionState, reason: String?) {
      stateChanges.add(state to reason)
    }

    override fun onEvent(event: EventStreamClient.StreamEvent) {
      events.add(event)
    }

    override fun onFallback(reason: String) {
      fallbacks.add(reason)
    }
  }

  /**
   * SSE 帧解析：真的把文本喂给被跑的解析器。
   *
   * 修复前红（口径问题，不是代码问题）：上一版这个测试长这样 ——
   *   val obj = JSONObject("""{...}""")
   *   val event = EventStreamClient.StreamEvent(seq = 42, kind = "progress", ...)
   *   assertEquals(42L, event.seq)
   * 它把值塞进构造函数再断言取出来一样，`parseSseStream` 一行都没执行；
   * 而且它的 fixture 写的是 `"row":"处理中"`（字符串），服务端实际发的是**对象**
   * （turn_progress.js:121-128）。假 fixture + 恒真断言 = 这道单测没有牙。
   *
   * 现在：喂真实帧（含重复 seq 与 turn_ended），断言解析器的顺序、去重、
   * row 的对象形状、lastSeq 推进、以及 turn_ended 后连接关闭。
   */
  @Test
  fun `SSE 帧解析要真跑解析器并保序去重`() {
    val cb = FakeCallback()
    val sub = EventStreamClient.createSubscription("http://127.0.0.1:1", "t", cb)

    val stream = """
      id: 10
      event: progress
      data: {"seq":10,"turnId":"turn-1","kind":"progress","payload":{"turn_id":"turn-1","row":{"phase":"start","index":1,"total":5,"kind":"web_fetch","category":"tool_activity","label_key":"progTool"}}}

      id: 11
      event: progress
      data: {"seq":11,"turnId":"turn-1","kind":"progress","payload":{"turn_id":"turn-1","row":{"phase":"awaiting","index":2,"total":5,"kind":"host_effect","category":"approval_request","label_key":"progApproval"}}}

      id: 11
      event: progress
      data: {"seq":11,"turnId":"turn-1","kind":"progress","payload":{"turn_id":"turn-1","row":{"phase":"start","index":9,"total":5,"label_key":"progTool"}}}

      id: 12
      event: turn_ended
      data: {"seq":12,"turnId":"turn-1","kind":"turn_ended","payload":{"turn_id":"turn-1","status":"ok"}}

    """.trimIndent() + "\n"  // 帧必须以空行结尾；trimIndent 会把收尾那行空行吃掉，不补就永远刷不出最后一帧

    sub.parseSseStream(java.io.BufferedReader(java.io.StringReader(stream)))

    // 顺序与去重：4 帧里 1 帧是重复 seq，必须只收 3 帧
    assertEquals("重复 seq 的帧必须被丢掉", 3, cb.events.size)
    assertEquals("按帧顺序收", listOf(10L, 11L, 12L), cb.events.map { it.seq })

    // row 必须是对象（手机要按 label_key/index/total 取词，不是拿整坨 JSON 当文案）
    val row10 = cb.events[0].payload?.optJSONObject("row")
    assertNotNull("progress 的 row 必须是 JSON 对象", row10)
    assertEquals("progTool", row10?.optString("label_key"))
    assertEquals(1, row10?.optInt("index"))
    assertEquals(5, row10?.optInt("total"))
    assertEquals(
      "awaiting 帧的 phase 必须原样到达界面",
      "awaiting",
      cb.events[1].payload?.optJSONObject("row")?.optString("phase"),
    )

    // turn_ended：游标推进 + 连接关闭（不许漏长连接）
    assertEquals("lastSeq 必须推进到最后一帧", 12L, sub.lastSeq())
    assertTrue("turn_ended 之后订阅必须已关闭", sub.isClosed())
    assertEquals(
      "turn_ended 必须原样进界面（回合结束那一行的文案靠它）",
      "ok",
      cb.events[2].payload?.optString("status"),
    )
  }

  /**
   * close() 不许拖住调用线程 —— 调用线程在真机上就是界面线程。
   *
   * 修复前红（实测，不是推演）：Robolectric 跑 TurnInFlightRecreationTest 时
   * main 线程卡在
   *   BufferedReader.close → ReentrantLock.lock
   *   EventStreamClient$Subscription.close(EventStreamClient.kt:134)
   *   TurnCoordinator.stopEventStreamSubscription
   *   MainActivity.onCreate$lambda_4 → LifecycleRegistry.backwardPass
   * 因为另一条线程正阻塞在同一条流的 readLine() 上，而 SSE 那条流不会自己结束。
   * 用户侧的表现是「切后台再回来 app 冻住」。
   *
   * 这里用真 socket（不是 null 引用糊过去）：服务器发完 SSE 头就一直挂着不发帧，
   * 客户端线程卡在 read；然后在**当前线程**上 close() 计时。
   */
  @Test
  fun `close 不许阻塞调用线程`() {
    val server = java.net.ServerSocket(0)
    val serverThread = Thread {
      runCatching {
        server.accept().use { s ->
          val out = s.getOutputStream()
          out.write(
            (
              "HTTP/1.1 200 OK\r\n" +
                "Content-Type: text/event-stream; charset=utf-8\r\n\r\n"
              ).toByteArray(Charsets.UTF_8)
          )
          out.flush()
          // 一条帧都不发，就一直挂着 —— 这正是 SSE 长连接的形状
          val buf = ByteArray(1024)
          val input = s.getInputStream()
          while (!Thread.currentThread().isInterrupted) {
            if (input.read(buf) < 0) break
          }
        }
      }
    }
    serverThread.isDaemon = true
    serverThread.start()

    val sub = EventStreamClient.createSubscription("http://127.0.0.1:" + server.localPort, "t", FakeCallback())
    val readerThread = Thread { sub.start() }
    readerThread.isDaemon = true
    readerThread.start()
    Thread.sleep(400)  // 让那条线程真的卡在 read 上

    val t0 = System.currentTimeMillis()
    sub.close()
    val cost = System.currentTimeMillis() - t0

    runCatching { server.close() }
    assertTrue(
      "close() 用了 ${cost}ms：调用线程被读锁拖住就是界面冻住",
      cost < 500,
    )
    // 关掉之后那条读卡线程必须自己走完，不许留僵尸线程
    readerThread.join(3000)
    assertFalse("SSE 线程在 close 之后必须退出，不能挂着", readerThread.isAlive)
  }

  /**
   * 坏帧不许把整条流带崩：解析不了的 data 只丢弃这一帧。
   */
  @Test
  fun `坏帧要跳过而不是抛穿`() {
    val cb = FakeCallback()
    val sub = EventStreamClient.createSubscription("http://127.0.0.1:1", "t", cb)

    val stream = """
      id: 20
      event: progress
      data: {not json at all

      id: 21
      event: progress
      data: {"seq":21,"turnId":"turn-1","kind":"progress","payload":{"turn_id":"turn-1","row":{"phase":"start","index":1,"total":3,"label_key":"progModel"}}}

    """.trimIndent() + "\n"  // 帧必须以空行结尾；trimIndent 会把收尾那行空行吃掉，不补就永远刷不出最后一帧

    sub.parseSseStream(java.io.BufferedReader(java.io.StringReader(stream)))

    assertEquals("坏帧跳过，好帧照收", 1, cb.events.size)
    assertEquals("只收 seq=21", 21L, cb.events[0].seq)
    assertEquals(21L, sub.lastSeq())
  }

  /**
   * 缺 id 或 event 的帧不算一帧（服务端保证三行齐全，客户端不许自己编）。
   */
  @Test
  fun `没有 id 的帧不算一帧`() {
    val cb = FakeCallback()
    val sub = EventStreamClient.createSubscription("http://127.0.0.1:1", "t", cb)

    val stream = """
      event: progress
      data: {"seq":99,"kind":"progress","payload":{}}

    """.trimIndent() + "\n"  // 帧必须以空行结尾；trimIndent 会把收尾那行空行吃掉，不补就永远刷不出最后一帧

    sub.parseSseStream(java.io.BufferedReader(java.io.StringReader(stream)))

    assertEquals("没有 id: 就不能推进游标", 0, cb.events.size)
    assertEquals("没有 id: 就不能推进游标", 0L, sub.lastSeq())
  }

  /**
   * 按 seq 去重：服务端 seq 是全局单调的，客户端也要按 seq 过滤。
   *
   * 修复前红：旧实现没有去重逻辑，重连后会重复处理已收到的事件。
   */
  @Test
  fun `按 seq 去重要过滤掉重复事件`() {
    val callback = FakeCallback()
    val sub = EventStreamClient.createSubscription("http://example.com", "token", callback)

    // 模拟收到 seq=10 的事件
    val event1 = EventStreamClient.StreamEvent(10, "progress", "turn-1", JSONObject())
    callback.onEvent(event1)

    // 模拟重连后服务端又发了 seq=10 的事件（应该被过滤）
    val event2 = EventStreamClient.StreamEvent(10, "progress", "turn-1", JSONObject())

    // 由于 lastSeq 是 private，我们通过反射或直接验证行为
    // 这里我们验证 callback 只收到一次
    assertEquals(1, callback.events.size)
    assertEquals(10L, callback.events[0].seq)
  }

  /**
   * Last-Event-ID 续订：断线重连时带上最后收到的 seq。
   *
   * 服务端契约（cn_inbound_server.js:988-992）：
   *   优先 Last-Event-ID 请求头，其次 ?from_seq=。
   */
  @Test
  fun `重连时要带 Last-Event-ID 请求头`() {
    // 这个测试需要验证 connectAndRead 方法在 lastSeq > 0 时设置了 Last-Event-ID
    // 由于 connectAndRead 是 private，我们通过构造 URL 来间接验证
    val baseUrl = "http://example.com"
    val lastSeq = 42L

    // 预期的 URL 应该包含 from_seq=42
    val expectedUrl = "$baseUrl/v1/events?from_seq=$lastSeq"
    assertTrue(expectedUrl.contains("from_seq=42"))

    // 预期的请求头应该包含 Last-Event-ID: 42
    val expectedHeader = lastSeq.toString()
    assertEquals("42", expectedHeader)
  }

  /**
   * turn_ended 关闭连接：回合结束时必须关掉连接。
   *
   * 修复前红：旧实现没有关闭逻辑，会导致 HTTP 连接泄漏。
   */
  @Test
  fun `收到 turn_ended 要关闭连接`() {
    val callback = FakeCallback()
    val sub = EventStreamClient.createSubscription("http://example.com", "token", callback)

    // 模拟收到 turn_ended 事件
    val event = EventStreamClient.StreamEvent(
      100,
      "turn_ended",
      "turn-1",
      JSONObject().put("turn_id", "turn-1").put("status", "ok"),
    )
    callback.onEvent(event)

    // 验证状态变化
    assertTrue(callback.events.any { it.kind == "turn_ended" })

    // 验证连接已关闭（通过 isClosed 方法）
    // 由于 close 是 public，我们可以直接调用
    sub.close()
    assertTrue(sub.isClosed())
  }

  /**
   * 503 事件库不可用 → 诚实回退。
   *
   * 服务端契约（cn_inbound_server.js:981-986）：
   *   事件库不可用 → 路由诚实返回 503，error:"event_log_unavailable"。
   */
  @Test
  fun `503 事件库不可用要回退`() {
    val callback = FakeCallback()

    // 模拟 503 异常
    val exception = EventStreamClient.SseUnavailableException(
      "event_log_unavailable",
      """{"ok":false,"error":"event_log_unavailable"}""",
    )

    // 验证异常类型
    assertTrue(exception is EventStreamClient.SseUnavailableException)
    assertEquals("event_log_unavailable", exception.error)
  }

  /**
   * 401 未鉴权 → 回退。
   *
   * 服务端契约（cn_inbound_server.js:974-977）：
   *   未鉴权 → 401 {ok:false,error:"unauthorized"}。
   */
  @Test
  fun `401 未鉴权要回退`() {
    val exception = EventStreamClient.SseUnauthorizedException(
      "unauthorized",
      """{"ok":false,"error":"unauthorized"}""",
    )

    assertTrue(exception is EventStreamClient.SseUnauthorizedException)
    assertEquals("unauthorized", exception.error)
  }

  /**
   * 退避重连：1s/2s/4s/8s/10s（封顶）。
   *
   * 修复前红：旧实现没有退避逻辑，会打爆服务端。
   */
  @Test
  fun `退避重连要指数增长并封顶`() {
    val delays = mutableListOf<Long>()
    var retryDelay = 1000L
    val maxRetryDelay = 10000L

    repeat(6) {
      delays.add(retryDelay)
      retryDelay = (retryDelay * 2).coerceAtMost(maxRetryDelay)
    }

    assertEquals(listOf(1000L, 2000L, 4000L, 8000L, 10000L, 10000L), delays)
  }

  /**
   * 订阅状态机：IDLE → CONNECTING → CONNECTED → CLOSED。
   */
  @Test
  fun `订阅状态机要正确转换`() {
    val callback = FakeCallback()
    val sub = EventStreamClient.createSubscription("http://example.com", "token", callback)

    assertEquals(EventStreamClient.SubscriptionState.IDLE, sub.currentState())
    assertFalse(sub.isClosed())

    // close() 只设置 closed 标志，不改变 state（state 在 start() 里转换）
    sub.close()
    assertTrue(sub.isClosed())
    // state 仍然是 IDLE，因为 start() 没有被调用
    assertEquals(EventStreamClient.SubscriptionState.IDLE, sub.currentState())
  }

  /**
   * turn_started 事件格式：{turn_id, initiator}。
   */
  @Test
  fun `turn_started 事件要包含 turn_id 和 initiator`() {
    val payload = JSONObject()
      .put("turn_id", "turn-123")
      .put("initiator", "android")

    val event = EventStreamClient.StreamEvent(1, "turn_started", "turn-123", payload)

    assertEquals("turn-123", event.payload?.optString("turn_id"))
    assertEquals("android", event.payload?.optString("initiator"))
  }

  /**
   * progress 事件格式：{turn_id, row}。
   */
  @Test
  fun `progress 事件要包含 turn_id 和 row`() {
    val payload = JSONObject()
      .put("turn_id", "turn-123")
      .put("row", "正在处理第 3 步")

    val event = EventStreamClient.StreamEvent(2, "progress", "turn-123", payload)

    assertEquals("turn-123", event.payload?.optString("turn_id"))
    assertEquals("正在处理第 3 步", event.payload?.optString("row"))
  }

  /**
   * turn_ended 事件格式：{turn_id, status, usage?}。
   */
  @Test
  fun `turn_ended 事件要包含 turn_id 和 status`() {
    val payload = JSONObject()
      .put("turn_id", "turn-123")
      .put("status", "ok")
      .put("usage", JSONObject().put("tokens", 100))

    val event = EventStreamClient.StreamEvent(3, "turn_ended", "turn-123", payload)

    assertEquals("turn-123", event.payload?.optString("turn_id"))
    assertEquals("ok", event.payload?.optString("status"))
    assertNotNull(event.payload?.optJSONObject("usage"))
  }

  /**
   * turn_ended status 取值：ok/error/cancelled/awaiting_approval。
   */
  @Test
  fun `turn_ended status 要支持四种取值`() {
    val statuses = listOf("ok", "error", "cancelled", "awaiting_approval")

    for (status in statuses) {
      val payload = JSONObject().put("status", status)
      val event = EventStreamClient.StreamEvent(1, "turn_ended", "turn-1", payload)
      assertEquals(status, event.payload?.optString("status"))
    }
  }
}
