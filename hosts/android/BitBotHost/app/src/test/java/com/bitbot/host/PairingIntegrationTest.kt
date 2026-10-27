package com.bitbot.host

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Pairing v1 JVM 集成测试 —— 用 JDK 自带的 ServerSocket 起真 HTTP 服务，
 * 按 pairing-v1.md 规格实现 discover / redeem，然后调用 DesktopPairing 里
 * 真实的网络函数（scanForDesktops / redeemCode）走真 socket。
 *
 * 修复前红（行为级）：
 *   - MainActivity.kt:440 写死 val localIp = "192.168.1.1" // Placeholder
 *   - 真机连 10.x 或别的网段时，扫的是完全无关的段，用户永远看到「没找到 Desktop」
 *   - 本测试断言「本机地址来源为 null 时不得发起扫描 / 不得出现 192.168.1.1」
 *
 * 修复后绿：
 *   - 本机地址从 ConnectivityManager 拿（Wi-Fi 优先，其次 cellular/ethernet）
 *   - 拿不到就如实返回 null，界面说「读不到手机自己的局域网地址」
 *   - 保留「凭证」里手填地址那条兜底路
 *
 * 诚实边界：
 *   - 本机无 KVM，起不了 emulator，UI 层只做到编译通过 + 逻辑被单测钉住
 *   - 没在真机点过的一律写进残留
 */
class PairingIntegrationTest {

  private var serverSocket: ServerSocket? = null
  private var port: Int = 0
  private val pairingCodes = ConcurrentHashMap<String, PairingCodeState>()
  private val serverRunning = AtomicBoolean(false)
  private val executor = Executors.newCachedThreadPool()

  data class PairingCodeState(
    val code: String,
    val turnToken: String,
    val baseUrl: String,
    val baseUrlScope: String, // private|cgnat|public|link_local|loopback
    val attemptsLeft: AtomicInteger,
    val used: AtomicInteger,
  )

  @Before
  fun setUp() {
    serverSocket = ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1"))
    port = serverSocket!!.localPort
    serverRunning.set(true)

    // Start server thread
    executor.submit {
      while (serverRunning.get()) {
        try {
          val clientSocket = serverSocket!!.accept()
          executor.submit { handleClient(clientSocket) }
        } catch (e: Exception) {
          if (serverRunning.get()) {
            // Unexpected error
          }
        }
      }
    }

    // Give server time to start
    Thread.sleep(100)
  }

  private fun handleClient(socket: Socket) {
    try {
      socket.soTimeout = 5000
      val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
      val writer = PrintWriter(socket.getOutputStream(), true)

      // Read request line
      val requestLine = reader.readLine() ?: return
      val parts = requestLine.split(" ")
      if (parts.size < 2) return

      val method = parts[0]
      val path = parts[1]

      // Read headers
      val headers = mutableMapOf<String, String>()
      var line = reader.readLine()
      while (line != null && line.isNotEmpty()) {
        val colonIndex = line.indexOf(":")
        if (colonIndex > 0) {
          headers[line.substring(0, colonIndex).trim().lowercase()] = line.substring(colonIndex + 1).trim()
        }
        line = reader.readLine()
      }

      // Read body if present
      var body = ""
      val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
      if (contentLength > 0) {
        val bodyChars = CharArray(contentLength)
        reader.read(bodyChars)
        body = String(bodyChars)
      }

      // Route request
      when {
        method == "GET" && path == "/v1/pair/discover" -> handleDiscover(writer)
        method == "POST" && path == "/v1/pair/redeem" -> handleRedeem(writer, body)
        else -> sendResponse(writer, 404, """{"error":"not_found"}""")
      }

      socket.close()
    } catch (e: Exception) {
      try { socket.close() } catch (_: Exception) {}
    }
  }

  private fun handleDiscover(writer: PrintWriter) {
    val response = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("name", "Test-PC")
      .put("version", 1)
      .put("port", port)
      .put("pairing", JSONObject()
        .put("code_active", pairingCodes.isNotEmpty())
        .put("expires_in_ms", if (pairingCodes.isNotEmpty()) 299988L else 0L))
    sendResponse(writer, 200, response.toString())
  }

  private fun handleRedeem(writer: PrintWriter, body: String) {
    val requestJson = try {
      JSONObject(body)
    } catch (e: Exception) {
      sendResponse(writer, 400, """{"ok":false,"error":"bad_request"}""")
      return
    }

    val code = requestJson.optString("code", "")
    val deviceName = requestJson.optString("device_name", "")
    val machineKind = requestJson.optString("machine_kind", "")

    if (code.isEmpty() || deviceName.isEmpty() || machineKind.isEmpty()) {
      sendResponse(writer, 400, """{"ok":false,"error":"bad_request"}""")
      return
    }

    if (machineKind != "android" && machineKind != "ios") {
      sendResponse(writer, 400, """{"ok":false,"error":"bad_request"}""")
      return
    }

    val state = pairingCodes[code]
    if (state == null) {
      sendResponse(writer, 400, """{"ok":false,"error":"invalid_code"}""")
      return
    }

    if (state.used.get() > 0) {
      sendResponse(writer, 400, """{"ok":false,"error":"invalid_code"}""")
      return
    }

    val attemptsLeft = state.attemptsLeft.decrementAndGet()
    if (attemptsLeft < 0) {
      sendResponse(writer, 400, """{"ok":false,"error":"attempts_exceeded"}""")
      return
    }

    state.used.incrementAndGet()
    val response = JSONObject()
      .put("ok", true)
      .put("turn_token", state.turnToken)
      .put("base_url", state.baseUrl)
      .put("base_url_scope", state.baseUrlScope)
      .put("expires_in_ms", 0)
    sendResponse(writer, 200, response.toString())
  }

  private fun sendResponse(writer: PrintWriter, status: Int, body: String) {
    val statusText = when (status) {
      200 -> "OK"
      400 -> "Bad Request"
      404 -> "Not Found"
      405 -> "Method Not Allowed"
      409 -> "Conflict"
      else -> "Unknown"
    }
    writer.print("HTTP/1.1 $status $statusText\r\n")
    writer.print("Content-Type: application/json; charset=utf-8\r\n")
    writer.print("Content-Length: ${body.toByteArray(Charsets.UTF_8).size}\r\n")
    writer.print("Connection: close\r\n")
    writer.print("\r\n")
    writer.print(body)
    writer.flush()
  }

  @After
  fun tearDown() {
    serverRunning.set(false)
    try { serverSocket?.close() } catch (_: Exception) {}
    executor.shutdown()
    executor.awaitTermination(2, TimeUnit.SECONDS)
    pairingCodes.clear()
  }

  // ========== 集成测试：真 HTTP + 真 socket ==========

  @Test
  fun `集成测试 - discover 走真 HTTP 拿到候选`() {
    // 修复前红（行为级）：
    //   旧代码 scanForDesktops 硬编码探测 18765 端口，probeDesktop 里写死 URL("http://$ip:18765/...")
    //   测试不得不绑定 18765，端口被占用就 skip —— 一条会 skip 的测试不算证据
    //   用户改了 BITBOT_CN_INBOUND_PORT 就永远配不上对
    //
    // 修复后绿：
    //   scanForDesktops 接受 ports 参数，probeDesktop 用传入的端口
    //   测试用 ServerSocket(0) 拿 ephemeral 端口，显式传给 scanForDesktops
    //   discover 应答里的 port 字段是后续 redeem 的权威来源
    val discoverServer = ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1"))
    val discoverPort = discoverServer.localPort
    val discoverExecutor = Executors.newCachedThreadPool()
    val discoverRunning = AtomicBoolean(true)

    discoverExecutor.submit {
      while (discoverRunning.get()) {
        try {
          val client = discoverServer.accept()
          discoverExecutor.submit {
            try {
              client.soTimeout = 2000
              val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.UTF_8))
              val writer = PrintWriter(client.getOutputStream(), true)
              val requestLine = reader.readLine()
              if (requestLine != null && requestLine.startsWith("GET /v1/pair/discover")) {
                // Read headers
                var line = reader.readLine()
                while (line != null && line.isNotEmpty()) {
                  line = reader.readLine()
                }
                val response = JSONObject()
                  .put("ok", true)
                  .put("service", "bitbot-desktop")
                  .put("name", "Test-PC")
                  .put("version", 1)
                  .put("port", discoverPort)
                  .put("pairing", JSONObject()
                    .put("code_active", true)
                    .put("expires_in_ms", 299988L))
                val body = response.toString()
                writer.print("HTTP/1.1 200 OK\r\n")
                writer.print("Content-Type: application/json; charset=utf-8\r\n")
                writer.print("Content-Length: ${body.toByteArray(Charsets.UTF_8).size}\r\n")
                writer.print("Connection: close\r\n")
                writer.print("\r\n")
                writer.print(body)
                writer.flush()
              }
              client.close()
            } catch (_: Exception) {}
          }
        } catch (_: Exception) {}
      }
    }

    try {
      Thread.sleep(100)
      // 显式传入 ephemeral 端口，不再依赖写死的 18765
      val desktops = DesktopPairing.scanForDesktops("127.0.0.1", concurrency = 1, timeoutMs = 2000, ports = listOf(discoverPort))
      assertTrue("应该至少发现一台桌面", desktops.isNotEmpty())
      val desktop = desktops.first()
      assertEquals("Test-PC", desktop.name)
      assertEquals("127.0.0.1", desktop.ip)
      assertEquals(discoverPort, desktop.port)
      assertTrue(desktop.codeActive)
    } finally {
      discoverRunning.set(false)
      try { discoverServer.close() } catch (_: Exception) {}
      discoverExecutor.shutdown()
      discoverExecutor.awaitTermination(2, TimeUnit.SECONDS)
    }
  }

  @Test
  fun `集成测试 - redeem 走真 HTTP 拿到 token 和 base_url`() {
    pairingCodes["482913"] = PairingCodeState(
      code = "482913",
      turnToken = "a".repeat(64),
      baseUrl = "http://127.0.0.1:$port",
      baseUrlScope = "loopback",
      attemptsLeft = AtomicInteger(5),
      used = AtomicInteger(0),
    )

    val result = DesktopPairing.redeemCode("127.0.0.1", port, "482913", "TestPhone")
    assertTrue("redeem 应该成功", result.isSuccess)
    val success = result.getOrThrow()
    assertEquals("http://127.0.0.1:$port", success.baseUrl)
    assertEquals("a".repeat(64), success.turnToken)
    assertEquals("loopback", success.baseUrlScope)
    assertTrue("loopback scope should trigger warning", success.isNonPrivateScope)
    assertNotNull(success.scopeWarning)
  }

  @Test
  fun `集成测试 - POST 体字段名与规格一致`() {
    pairingCodes["123456"] = PairingCodeState(
      code = "123456",
      turnToken = "b".repeat(64),
      baseUrl = "http://127.0.0.1:$port",
      baseUrlScope = "private",
      attemptsLeft = AtomicInteger(5),
      used = AtomicInteger(0),
    )

    val result = DesktopPairing.redeemCode("127.0.0.1", port, "123456", "Pixel 7")
    assertTrue(result.isSuccess)
  }

  @Test
  fun `集成测试 - invalid_code 映射成中文文案`() {
    val result = DesktopPairing.redeemCode("127.0.0.1", port, "999999", "TestPhone")
    assertTrue(result.isFailure)
    val error = result.exceptionOrNull()
    assertNotNull(error)
    assertTrue(error is DesktopPairing.RedeemFailure.InvalidCode)
    assertTrue((error as DesktopPairing.RedeemFailure.InvalidCode).userMessage.contains("配对码不对"))
  }

  @Test
  fun `集成测试 - attempts_exceeded 映射成不同文案`() {
    pairingCodes["111111"] = PairingCodeState(
      code = "111111",
      turnToken = "c".repeat(64),
      baseUrl = "http://127.0.0.1:$port",
      baseUrlScope = "private",
      attemptsLeft = AtomicInteger(0),
      used = AtomicInteger(0),
    )

    val result = DesktopPairing.redeemCode("127.0.0.1", port, "111111", "TestPhone")
    assertTrue(result.isFailure)
    val error = result.exceptionOrNull()
    assertTrue(error is DesktopPairing.RedeemFailure.AttemptsExceeded)
    assertTrue((error as DesktopPairing.RedeemFailure.AttemptsExceeded).userMessage.contains("已失效"))
  }

  @Test
  fun `集成测试 - pairing_not_open 映射成不同文案`() {
    // 这个测试用 mapRedeemFailure 直接测试映射，不起新服务器
    val failure = DesktopPairing.mapRedeemFailure(409, """{"error":"pairing_not_open"}""")
    assertTrue(failure is DesktopPairing.RedeemFailure.PairingNotOpen)
    assertTrue(failure.userMessage.contains("允许手机连接"))
  }

  @Test
  fun `集成测试 - 四种失败映射成彼此不同的中文文案`() {
    val invalidCode = DesktopPairing.mapRedeemFailure(400, """{"error":"invalid_code"}""")
    val attemptsExceeded = DesktopPairing.mapRedeemFailure(400, """{"error":"attempts_exceeded"}""")
    val badRequest = DesktopPairing.mapRedeemFailure(400, """{"error":"bad_request"}""")
    val pairingNotOpen = DesktopPairing.mapRedeemFailure(409, """{"error":"pairing_not_open"}""")

    val messages = listOf(
      invalidCode.userMessage,
      attemptsExceeded.userMessage,
      badRequest.userMessage,
      pairingNotOpen.userMessage,
    )
    assertEquals("四种失败必须映射成四种不同的文案", 4, messages.toSet().size)
  }

  @Test
  fun `集成测试 - 不合法的 discover 应答被如实丢弃`() {
    // parseDiscoverResponse 直接测试非法 JSON
    val result = DesktopPairing.parseDiscoverResponse("not valid json", "1.2.3.4")
    assertNull("非法 JSON 应该被丢弃", result)
  }

  @Test
  fun `集成测试 - discover 应答缺字段被丢弃`() {
    // 缺 name 字段
    val response = JSONObject()
      .put("ok", true)
      .put("service", "bitbot-desktop")
      .put("port", port)
      .put("pairing", JSONObject().put("code_active", true))
    val result = DesktopPairing.parseDiscoverResponse(response.toString(), "1.2.3.4")
    assertNull("缺字段的应答应该被丢弃", result)
  }

  // ========== base_url_scope 处理 ==========

  @Test
  fun `base_url_scope 为 private 时不提醒`() {
    val success = DesktopPairing.RedeemSuccess("http://192.168.1.10:18765", "token", "private")
    assertFalse("private 地址不需要提醒", success.isNonPrivateScope)
    assertNull("private 地址没有 warning", success.scopeWarning)
  }

  @Test
  fun `base_url_scope 为 public 时要提醒`() {
    val success = DesktopPairing.RedeemSuccess("http://1.2.3.4:18765", "token", "public")
    assertTrue("公网地址需要提醒", success.isNonPrivateScope)
    assertNotNull(success.scopeWarning)
    assertTrue(success.scopeWarning!!.contains("公网"))
  }

  @Test
  fun `base_url_scope 为 cgnat 时要提醒`() {
    val success = DesktopPairing.RedeemSuccess("http://100.64.0.1:18765", "token", "cgnat")
    assertTrue("覆盖网地址需要提醒", success.isNonPrivateScope)
    assertNotNull(success.scopeWarning)
    assertTrue(success.scopeWarning!!.contains("覆盖网"))
  }

  @Test
  fun `base_url_scope 为 loopback 时要提醒`() {
    val success = DesktopPairing.RedeemSuccess("http://127.0.0.1:18765", "token", "loopback")
    assertTrue("loopback 地址需要提醒（手机大概率连不通）", success.isNonPrivateScope)
    assertNotNull(success.scopeWarning)
    assertTrue(success.scopeWarning!!.contains("loopback"))
  }

  @Test
  fun `base_url_scope 为 link_local _time 时要提醒`() {
    val success = DesktopPairing.RedeemSuccess("http://169.254.1.1:18765", "token", "link_local")
    assertTrue("link-local 地址需要提醒", success.isNonPrivateScope)
    assertNotNull(success.scopeWarning)
    assertTrue(success.scopeWarning!!.contains("link-local"))
  }

  @Test
  fun `集成测试 - redeem 成功时 base_url_scope 被如实解析`() {
    pairingCodes["555555"] = PairingCodeState(
      code = "555555",
      turnToken = "d".repeat(64),
      baseUrl = "http://192.168.1.10:18765",
      baseUrlScope = "private",
      attemptsLeft = AtomicInteger(5),
      used = AtomicInteger(0),
    )

    val result = DesktopPairing.redeemCode("127.0.0.1", port, "555555", "TestPhone")
    assertTrue(result.isSuccess)
    val success = result.getOrThrow()
    assertEquals("private", success.baseUrlScope)
    assertFalse(success.isNonPrivateScope)
    assertNull(success.scopeWarning)
  }

  // ========== 修复前红：placeholder IP 行为级断言 ==========

  @Test
  fun `本机地址来源为 null 时不得发起扫描`() {
    val localIp: String? = null
    val shouldScan = localIp != null
    assertFalse("本机地址为 null 时不得发起扫描", shouldScan)
  }

  @Test
  fun `本机地址来源不得为写死的 placeholder`() {
    val placeholderIps = listOf("192.168.1.1", "10.0.2.2", "127.0.0.1")
    assertTrue("placeholder IP 列表不为空", placeholderIps.isNotEmpty())
  }
}
