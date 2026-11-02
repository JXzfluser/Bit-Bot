package com.bitbot.host

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * A2-3 的接线证据：不是「DeviceIdentity 这个类会签名」，而是
 * **真发出去的那个请求带着真签名，签的就是这串被发出去的字节**。
 *
 * 为什么这两者差别很大：签名实现对错，金标已经钉死了；但「有没有挂上、挂在哪条路径上、
 * 挂的时候 body 是不是签的那一份」是另一类错误 —— 少挂一个头 = 真机 401，
 * 挂上但签的是另一份字节 = 真机 bad_signature，两种在纯密码学单测里都是绿的。
 *
 * 覆盖：
 *   DT-01 有身份时 POST /v1/turn 挂四个头，且签名对得上**实际发出的 body**
 *   DT-02 没有身份（或桌面还没派发 id）时：四个头一个都不许多出来，Bearer 行为一字不变
 *   DT-03 GET /v1/events 签的是空 body；重连的下一次必须换新 nonce（抄上一次 = nonce_reused 401）
 *   DT-04 配对 redeem 把公钥发出去、把服务端派发的身份写回本地（身份不是手机自己编的）
 *   DT-05 401 里产品给的那句 next_step 要真的上屏，而不是继续说「手机走的是配对令牌那条路」
 *
 * 诚实边界：本机无 KVM，跑的是 Robolectric + 真 ServerSocket（不是真设备、不是真桌面）。
 * 「桌面真的验得过这台手机的签名」这一条由 Node 侧 WD 系列与金标（DI-02 逐字节相同）合起来支撑，
 * 不由这里的一个假 HTTP 服务支撑 —— 这里只钉「端上确实把正确的字节签了并挂上去了」。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DeviceTrustWiringTest {

  private val fakes = mutableListOf<FakeDesktop>()

  @Before
  fun `干净的身份与仓库后门`() {
    DeviceIdentity.resetForTest()
    val ctx = RuntimeEnvironment.getApplication()
    ctx.filesDir.listFiles()?.forEach { it.delete() }
    // 关掉「本机 dev runner」那条后门：否则 TurnBridge 失败时会退去跑 node，掩盖真实的网络结果。
    val empty = File(System.getProperty("java.io.tmpdir"), "bitbot-dt-no-repo-${System.nanoTime()}")
    empty.mkdirs()
    System.setProperty("user.dir", empty.absolutePath)
    TurnBridge.bind(ctx)
  }

  @After
  fun `关掉假桌面并清身份`() {
    fakes.forEach { runCatching { it.close() } }
    fakes.clear()
    DeviceIdentity.resetForTest()
    val ctx = RuntimeEnvironment.getApplication()
    TurnBridge.setHostUrl(null)
    TurnBridge.setTurnToken(null)
    ctx.filesDir.listFiles()?.forEach { it.delete() }
  }

  /**
   * 记一条完整请求：请求行 + 头 + body 原文（body 按字节留着，签名要按字节比）。
   *
   * 这里有个踩过的坑，值得留在代码里：第一版用 `BufferedReader` 读头、再用同一个
   * `InputStream` 读 body —— BufferedReader 会一次吸满 8K，把 body 一起吞进自己的缓冲，
   * 于是服务端等在 socket 上读 body，客户端等在 socket 上读响应，**两边一起僵死到超时**
   * （表现是「连过去但没有回包」，看起来像产品没签名，其实是假桌面读错了）。
   * 现在头和 body 走同一个字节流：按字节读到空行为止，剩下的按 Content-Length 原样读，
   * 顺带保证「签名的字节」就是「发出来的字节」（这正是本类要钉的东西）。
   */
  private class FakeDesktop(private val script: (String, Map<String, String>, ByteArray) -> String) : AutoCloseable {
    val requests = CopyOnWriteArrayList<Triple<String, Map<String, String>, ByteArray>>()
    val count = AtomicInteger(0)
    private var server: ServerSocket? = null
    private val ready = CountDownLatch(1)
    private val stopped = java.util.concurrent.atomic.AtomicBoolean(false)

    /** 按字节读到 \r\n\r\n 为止（绝不提前多吸一个字节），返回 (请求行, 头)。 */
    private fun readHead(input: InputStream): Pair<String, Map<String, String>>? {
      val buf = ByteArrayOutputStream()
      while (true) {
        val b = input.read()
        if (b < 0) break
        buf.write(b)
        val bytes = buf.toByteArray()
        val n = bytes.size
        if (n >= 4 && bytes[n - 4] == 0x0D.toByte() && bytes[n - 3] == 0x0A.toByte() &&
          bytes[n - 2] == 0x0D.toByte() && bytes[n - 1] == 0x0A.toByte()
        ) {
          val text = String(bytes, 0, n - 2, Charsets.ISO_8859_1) // 去掉结尾那个 LF，留 CRLF 分隔
          val lines = text.split("\r\n")
          val requestLine = lines.firstOrNull() ?: return null
          val headers = mutableMapOf<String, String>()
          for (l in lines.drop(1)) {
            val idx = l.indexOf(':')
            if (idx > 0) headers[l.substring(0, idx).trim().lowercase()] = l.substring(idx + 1).trim()
          }
          return Pair(requestLine, headers.toMap())
        }
      }
      return null
    }

    fun start(): Int {
      val s = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
      server = s
      ready.countDown()
      Thread {
        while (!stopped.get()) {
          val sock = runCatching { s.accept() }.getOrNull() ?: break
          Thread {
            try {
              // 假桌面自己也带超时：产品哪里发歪了要**快速红**，不许让整轮测试挂两分钟。
              sock.soTimeout = 20000
              val input: InputStream = sock.getInputStream()
              val head = readHead(input) ?: return@Thread
              val requestLine = head.first
              val headers = head.second
              val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
              val body = if (contentLength > 0) {
                val buf = ByteArray(contentLength)
                var off = 0
                while (off < contentLength) {
                  val n = input.read(buf, off, contentLength - off)
                  if (n < 0) break
                  off += n
                }
                buf.copyOf(off)
              } else ByteArray(0)
              requests.add(Triple(requestLine, headers, body))
              val payload = script(requestLine, headers, body)
              val out: OutputStream = sock.getOutputStream()
              out.write(payload.toByteArray(Charsets.UTF_8))
              out.flush()
              count.incrementAndGet()
            } catch (_: Exception) {
            } finally {
              runCatching { sock.close() }
            }
          }.apply { isDaemon = true }.start()
        }
      }.apply { isDaemon = true }.start()
      return s.localPort
    }

    fun port(): Int { ready.await(5, TimeUnit.SECONDS); return server!!.localPort }

    override fun close() {
      stopped.set(true)
      runCatching { server?.close() }
    }
  }

  private val okTurnBody =
    "{\"ok\":true,\"messages\":[{\"role\":\"assistant\",\"text\":\"收到\"}],\"host_results\":[],\"stdout\":\"ok\"}"

  private fun json200(body: String): String =
    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " +
      body.toByteArray(Charsets.UTF_8).size + "\r\nConnection: close\r\n\r\n" + body

  private fun giveIdentity(deviceId: String? = "dev-android-abc123"): DeviceCredentials {
    val ctx = RuntimeEnvironment.getApplication()
    val creds = DeviceIdentity.loadOrCreate(ctx)!!
    val withId = if (deviceId == null) creds else creds.copy(deviceId = deviceId)
    DeviceIdentity.save(ctx, withId)
    return withId
  }

  @Test
  fun `DT-01 有身份时回合带着真签名，签的就是发出去的那串字节`() {
    val creds = giveIdentity("dev-android-signme")
    var capturedSig: ByteArray? = null
    var capturedPayload: ByteArray? = null
    val fake = FakeDesktop { _, headers, body ->
      val deviceId = headers["x-bitbot-device"] ?: ""
      val ts = headers["x-bitbot-timestamp"] ?: ""
      val nonce = headers["x-bitbot-nonce"] ?: ""
      capturedSig = headers["x-bitbot-signature"]?.let { Base64.getDecoder().decode(it) }
      capturedPayload = DeviceIdentity.signingPayload(deviceId, ts, nonce, body)
      json200(okTurnBody)
    }
    val port = fake.start()
    fakes += fake
    TurnBridge.setHostUrl("http://127.0.0.1:$port")
    TurnBridge.setTurnToken("bearer-still-there")

    val raw = TurnBridge.runTurn("hello", "android")
    assertTrue("假桌面没收到请求？回包：$raw", raw.contains("收到"))
    val req = fake.requests.first()
    val headers = req.second
    val body = req.third

    assertEquals("签名头里的身份必须是服务端派发那一个", "dev-android-signme", headers["x-bitbot-device"])
    assertNotNull("必须有时间戳头", headers["x-bitbot-timestamp"])
    assertNotNull("必须有 nonce 头", headers["x-bitbot-nonce"])
    assertNotNull("必须有签名头", headers["x-bitbot-signature"])
    // 核心：**验一遍**，用的公钥与真发出去的 body 都是这一条请求自己的。
    // 如果实现签了「将要发的串」而实际写出去的是另一串（例如补了换行、charset 改写），这里就验不过。
    assertTrue(
      "桌面按同一规则重算的 payload 必须验得过这台手机的公钥",
      DeviceIdentity.verify(creds.publicKeyPem, capturedPayload!!, capturedSig!!),
    )
    // 上面那条 verify 用的 body 就是**这一条请求实际收到的字节**（脚本里从 socket 读的），
    // 所以「签的 = 发的」这件事已经被它钉住了；不再加一条 body==body 的恒真断言。
    // 会话仍必须是同源的 mobile-android（W2 修的那条 bug 不许被这轮改动带回来）
    assertTrue(
      "body 里的会话仍是 sessionFor(machineKind)",
      JSONObject(String(body, Charsets.UTF_8)).optString("session_id") == "mobile-android",
    )
    // bearer 也还在：老桌面（不支持登记）只认 bearer，摘掉它就打不通了（代价见 §8.64）
    assertEquals("Bearer bearer-still-there", headers["authorization"])
  }

  @Test
  fun `DT-02 没有身份时一个签名头都不许多`() {
    val fake = FakeDesktop { _, _, _ -> json200(okTurnBody) }
    val port = fake.start()
    fakes += fake
    TurnBridge.setHostUrl("http://127.0.0.1:$port")
    TurnBridge.setTurnToken("only-bearer")

    TurnBridge.runTurn("hello", "android")
    val headers = fake.requests.first().second
    for (k in listOf("x-bitbot-device", "x-bitbot-timestamp", "x-bitbot-nonce", "x-bitbot-signature")) {
      assertFalse("没有身份就不该挂 $k（挂了也只是给老桌面添一条它看不懂的头）", headers.containsKey(k))
    }
    assertEquals("Bearer only-bearer", headers["authorization"])
  }

  @Test
  fun `DT-02b 本地有钥匙但桌面没派发身份时也不签`() {
    giveIdentity(deviceId = null) // 只有本地种子，没有服务端派发的 id
    val fake = FakeDesktop { _, _, _ -> json200(okTurnBody) }
    val port = fake.start()
    fakes += fake
    TurnBridge.setHostUrl("http://127.0.0.1:$port")
    TurnBridge.setTurnToken("t")
    TurnBridge.runTurn("hello", "android")
    assertNull(
      "自己编一个 id 去签，桌面只会回 unknown_device —— 宁可不签",
      fake.requests.first().second["x-bitbot-device"],
    )
  }

  @Test
  fun `DT-03 事件流签的是空 body，重连必须换 nonce`() {
    giveIdentity("dev-android-sse")
    // 第一次给 500（触发退避重连），第二次给两条帧 + turn_ended（正常收尾）
    val attempts = AtomicInteger(0)
    val fake = FakeDesktop { requestLine, _, body ->
      val n = attempts.getAndIncrement()
      if (requestLine.startsWith("GET") && body.isEmpty() && n == 0) {
        "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
      } else {
        val frames = buildString {
          append("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n")
          append("id: 1\nevent: turn_started\ndata: {\"turnId\":\"t1\",\"kind\":\"turn_started\",\"payload\":{\"initiator\":\"android\"}}\n\n")
          append("id: 2\nevent: turn_ended\ndata: {\"turnId\":\"t1\",\"kind\":\"turn_ended\",\"payload\":{\"status\":\"ok\"}}\n\n")
        }
        frames
      }
    }
    val port = fake.start()
    fakes += fake

    val got = CopyOnWriteArrayList<EventStreamClient.StreamEvent>()
    val states = CopyOnWriteArrayList<EventStreamClient.SubscriptionState>()
    val sub = EventStreamClient.createSubscription(
      baseUrl = "http://127.0.0.1:$port",
      token = "bearer",
      callback = object : EventStreamClient.SubscriptionCallback {
        override fun onStateChange(state: EventStreamClient.SubscriptionState, reason: String?) { states += state }
        override fun onEvent(event: EventStreamClient.StreamEvent) { got += event }
        override fun onFallback(reason: String) {}
      },
      sessionId = "mobile-android",
      identityContext = RuntimeEnvironment.getApplication(),
    )
    val t = Thread { sub.start() }
    t.start()
    t.join(15000)

    val sseReqs = fake.requests.filter { it.first.startsWith("GET") }
    assertEquals("订阅应当连了两次（第一次 500 触发重连）: " + sseReqs.size, 2, sseReqs.size)
    for (req in sseReqs) {
      val headers = req.second
      val body = req.third
      assertEquals("GET 的 body 必须是空的", 0, body.size)
      assertNotNull("事件流也要设备签名（桌面登记过之后 bearer 不够）", headers["x-bitbot-signature"])
      val creds = DeviceIdentity.current(RuntimeEnvironment.getApplication())!!
      val payload = DeviceIdentity.signingPayload(
        headers["x-bitbot-device"] ?: "", headers["x-bitbot-timestamp"] ?: "", headers["x-bitbot-nonce"] ?: "", body,
      )
      val sig = Base64.getDecoder().decode(headers["x-bitbot-signature"])
      assertTrue("空 body 的签名必须验得过（服务端就是这么验 GET 的）", DeviceIdentity.verify(creds.publicKeyPem, payload, sig))
    }
    val nonces = sseReqs.map { it.second["x-bitbot-nonce"] }
    assertEquals("重连不许抄上一次的 nonce（抄了就是 nonce_reused 401）", nonces.toSet().size, nonces.size)
    assertTrue("两帧都要收到（这条同时保证签名没把原有订阅逻辑弄坏）", got.size >= 2)
    assertTrue(
      "状态机要真的走到 CONNECTED：$states",
      states.contains(EventStreamClient.SubscriptionState.CONNECTED),
    )
  }

  @Test
  fun `DT-04 配对把公钥交出去，并把服务端派发的身份写回本地`() {
    val ctx = RuntimeEnvironment.getApplication()
    DeviceIdentity.resetForTest()
    val local = DeviceIdentity.loadOrCreate(ctx)!!
    assertNull("配对之前本地不该有服务端身份", DeviceIdentity.current(ctx)?.deviceId)

    val fake = FakeDesktop { _, _, body ->
      val obj = JSONObject(String(body, Charsets.UTF_8))
      val sent = obj.optString("device_public_key")
      val receipt = JSONObject()
        .put("ok", true)
        .put("turn_token", "bearer-from-desktop")
        .put("base_url", "http://127.0.0.1:1")
        .put("base_url_scope", "private")
        .put(
          "device",
          JSONObject()
            .put("registered", sent == local.publicKeyPem.trim())
            .put("id", if (sent == local.publicKeyPem.trim()) "dev-android-fp00000000" else JSONObject.NULL)
            .put("kind", "android")
            .put("name", obj.optString("device_name")),
        )
        .put("requires_device_credential", true)
      val text = receipt.toString()
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " +
        text.toByteArray(Charsets.UTF_8).size + "\r\nConnection: close\r\n\r\n" + text
    }
    val port = fake.start()
    fakes += fake

    val desktop = DesktopPairing.DiscoveredDesktop("桌面", "127.0.0.1", port, true, 60000)
    val r = DesktopPairing.completePairing(desktop, "123456", "Pixel 7", ctx)
    val success = r.getOrNull()
    assertNotNull("配对必须成：${r.exceptionOrNull()?.message}", success)
    val sentBody = JSONObject(String(fake.requests.first().third, Charsets.UTF_8))
    assertEquals("redeem 必须把这把公钥发出去（不发就永远登记不上）", local.publicKeyPem.trim(), sentBody.optString("device_public_key"))
    assertEquals("服务端派发的身份要写回本地，之后签名用的就是它", "dev-android-fp00000000", DeviceIdentity.current(ctx)?.deviceId)
    assertEquals("回执里的 id 也要如实带回给界面", "dev-android-fp00000000", success!!.deviceId)
    assertTrue("桌面说「这台机器只认设备签名」时必须如实带出来", success.requiresDeviceCredential)
    assertTrue("已登记这件事要能被界面看见", success.deviceRegistered)
  }

  @Test
  fun `DT-04b 老桌面不认 device_public_key 时不许假装登记成功`() {
    val ctx = RuntimeEnvironment.getApplication()
    val legacyReceipt = JSONObject()
      .put("ok", true)
      .put("turn_token", "t")
      .put("base_url", "http://127.0.0.1:1")
      .put("base_url_scope", "private")
      .toString() // 旧形状：连 device 字段都没有
    val fake = FakeDesktop { _, _, _ ->
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " +
        legacyReceipt.toByteArray(Charsets.UTF_8).size + "\r\nConnection: close\r\n\r\n" + legacyReceipt
    }
    val port = fake.start()
    fakes += fake
    val desktop = DesktopPairing.DiscoveredDesktop("老桌面", "127.0.0.1", port, true, 60000)
    val success = DesktopPairing.completePairing(desktop, "123456", "Pixel 7", ctx).getOrNull()
    assertNotNull(success)
    assertFalse("桌面没回执 device.registered 就是没登记上，不许替它说成成功", success!!.deviceRegistered)
    assertNull("本地不许凭空出现一个身份", DeviceIdentity.current(ctx)?.deviceId)
  }

  @Test
  fun `DT-05 401 里产品给的下一步要真的上屏`() {
    val raw = "turn HTTP 401: " + JSONObject()
      .put("ok", false)
      .put("error", "unauthorized")
      .put("device_error", "missing_device_credential")
      .put("error_description", "这台机器现在只认设备签名，Bearer 令牌不再够（配对成功的手机需要重新配对以登记公钥）")
      .put("next_step", "重新配对一次，让这台设备把公钥登记到机器上（之后请求要带设备签名）")
      .toString()
    val shown = TurnBridge.explainHttpReason(raw)
    assertTrue("产品已经给出下一步，界面就该用它：$shown", shown.contains("重新配对一次，让这台设备把公钥登记到机器上"))
    assertFalse(
      "旧那句「手机配对走的是配对令牌那条路」在这个分支上是错的（手机现在会签名），不许还贴出来",
      shown.contains("手机配对走的是配对令牌那条路"),
    )
    // 认不得的码仍要留机器码与原文（报障要和桌面日志对得上）
    val unknown = TurnBridge.explainHttpReason("turn HTTP 401: {\"ok\":false,\"error\":\"brand_new_code\"}")
    assertTrue("认不得的码必须把机器码留着：$unknown", unknown.contains("brand_new_code"))
  }
}
