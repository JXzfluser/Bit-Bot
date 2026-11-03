package com.bitbot.host

import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A3-5 门禁：手机侧中转传输层真的会握手、真的能在隧道上跑 HTTP。
 *
 * 这一层为什么必须有门禁：relay 服务端早就绿了（G-80/G-81），但手机侧一直没有客户端
 * （R-A3-3a）。「服务端能转发」和「客户端能接上」是两件事 —— 中间的线协议（AUTH/CONNECT/
 * TUNNEL 三行、DENY/NOBOX/BADCMD 三种拒绝）只要有一处对不上，真机上就是「配对好了但跨网发不出去」，
 * 而且**局域网下永远复现不出来**。所以这里用真 ServerSocket 搭假中继/假桌面，逐条钉。
 *
 * 全部是普通 JVM 单测（java.net + JUnit4），不需要 emulator、不需要真机。
 */
class RelayTransportTest {

  /* ---------------------------------------------------------------- RT-01 */

  @Test
  fun `RT-01 中转配置四栏缺一即不成立`() {
    val ok = RelayTunnel.parseConfig("relay.example.com", 18766, "tok-abc", "box-1")
    assertNotNull(ok)
    assertEquals("relay.example.com", ok!!.host)
    assertEquals(18766, ok.port)
    assertTrue(ok.complete)
    assertEquals("relay.example.com:18766", ok.endpoint)

    // 四栏任一缺失/非法 → null（不猜、不补默认值）
    assertNull(RelayTunnel.parseConfig(null, 18766, "tok", "box"))
    assertNull(RelayTunnel.parseConfig("", 18766, "tok", "box"))
    assertNull(RelayTunnel.parseConfig("relay", null, "tok", "box"))
    assertNull(RelayTunnel.parseConfig("relay", 0, "tok", "box"))
    assertNull(RelayTunnel.parseConfig("relay", 70000, "tok", "box"))
    assertNull(RelayTunnel.parseConfig("relay", 18766, "  ", "box"))
    assertNull(RelayTunnel.parseConfig("relay", 18766, "tok", ""))
  }

  /* ---------------------------------------------------------------- RT-02 */

  @Test
  fun `RT-02 AUTH 应答只认 OK 与 DENY，其余如实标未知`() {
    assertTrue(RelayTunnel.parseAuthReply("OK") is RelayTunnel.AuthReply.Ok)
    assertTrue(RelayTunnel.parseAuthReply("OK\r\n") is RelayTunnel.AuthReply.Ok)
    assertTrue(RelayTunnel.parseAuthReply("DENY") is RelayTunnel.AuthReply.Denied)
    // 认不得的应答不许当 OK（当 OK 就等于「凭证校验被跳过」）
    val u = RelayTunnel.parseAuthReply("WHATEVER")
    assertTrue(u is RelayTunnel.AuthReply.Unknown)
    assertEquals("WHATEVER", (u as RelayTunnel.AuthReply.Unknown).raw)
    assertEquals("AUTH tok-abc", RelayTunnel.authLine(" tok-abc "))
  }

  /* ---------------------------------------------------------------- RT-03 */

  @Test
  fun `RT-03 CONNECT 应答解析出目标端点与两种拒绝`() {
    val t = RelayTunnel.parseConnectReply("TUNNEL 10.0.0.7:18765")
    assertTrue(t is RelayTunnel.ConnectReply.Tunneled)
    assertEquals("10.0.0.7:18765", (t as RelayTunnel.ConnectReply.Tunneled).endpoint)

    assertTrue(RelayTunnel.parseConnectReply("NOBOX") is RelayTunnel.ConnectReply.NoBox)
    assertTrue(RelayTunnel.parseConnectReply("BADCMD") is RelayTunnel.ConnectReply.BadCmd)
    // "TUNNEL" 后面空着 / 认不得 → Unknown，不当成「连上了」
    assertTrue(RelayTunnel.parseConnectReply("TUNNEL ") is RelayTunnel.ConnectReply.Unknown)
    assertTrue(RelayTunnel.parseConnectReply("TUNNELED") is RelayTunnel.ConnectReply.Unknown)
    assertEquals("CONNECT box-1", RelayTunnel.connectLine("box-1"))
  }

  /* ---------------------------------------------------------------- RT-04 */

  @Test
  fun `RT-04 真握手三行之后 socket 进入数据面（AUTH 与 CONNECT 逐字正确）`() {
    FakeRelay(authReply = "OK", connectReply = "TUNNEL 127.0.0.1:19999", echoDataPlane = true).use { relay ->
      val cfg = RelayTunnel.RelayConfig("127.0.0.1", relay.port, "tok-abc", "box-1")
      RelayTunnel.open(cfg).use { tunnel ->
        assertEquals("AUTH tok-abc", relay.sawAuth)
        assertEquals("CONNECT box-1", relay.sawConnect)
        assertEquals("127.0.0.1:19999", tunnel.boxEndpoint)

        // 数据面必须干净：控制面的行不许被带进数据面，第一句写进去的是我们自己的字节。
        tunnel.socket.soTimeout = 5000
        val out = tunnel.socket.getOutputStream()
        out.write("ping\n".toByteArray(Charsets.ISO_8859_1))
        out.flush()
        val echoed = readLineFrom(tunnel.socket.getInputStream())
        assertEquals("echo:ping", echoed)
      }
    }
  }

  /* ---------------------------------------------------------------- RT-05 */

  @Test
  fun `RT-05 DENY 说人话：是凭证不对，不是网络不好`() {
    FakeRelay(authReply = "DENY", connectReply = null).use { relay ->
      val cfg = RelayTunnel.RelayConfig("127.0.0.1", relay.port, "wrong-token", "box-1")
      val err = runCatching { RelayTunnel.open(cfg) }.exceptionOrNull()
      assertTrue("应当抛 OpenFailure，实际: $err", err is RelayTunnel.OpenFailure)
      val failure = err as RelayTunnel.OpenFailure
      assertTrue("DENY 必须落到 Denied：${failure.userMessage}", failure is RelayTunnel.OpenFailure.Denied)
      assertTrue("要把「凭证」两个字摆在用户眼前：${failure.userMessage}", failure.userMessage.contains("中转凭证"))
    }
  }

  /* ---------------------------------------------------------------- RT-06 */

  @Test
  fun `RT-06 NOBOX 说人话：这台桌面没在中转上登记`() {
    FakeRelay(authReply = "OK", connectReply = "NOBOX").use { relay ->
      val cfg = RelayTunnel.RelayConfig("127.0.0.1", relay.port, "tok", "box-unknown")
      val err = runCatching { RelayTunnel.open(cfg) }.exceptionOrNull()
      assertTrue(err is RelayTunnel.OpenFailure.BoxNotRegistered)
      val msg = (err as RelayTunnel.OpenFailure).userMessage
      assertTrue("NOBOX 要指向「桌面那边没登记」：$msg", msg.contains("登记"))
    }
  }

  /* ---------------------------------------------------------------- RT-07 */

  @Test
  fun `RT-07 隧道上的 POST：请求行 头 体与回包都对`() {
    val payload = "{\"ok\":true,\"text\":\"hi\"}"
    val response =
      "HTTP/1.1 200 OK\r\n" +
        "Content-Type: application/json; charset=utf-8\r\n" +
        "Content-Length: ${payload.toByteArray(Charsets.UTF_8).size}\r\n\r\n" +
        payload
    FakeBox(response).use { box ->
      Socket("127.0.0.1", box.port).use { sock ->
        val tunnel = RelayTunnel.Tunnel(sock, "127.0.0.1:${box.port}")
        val body = "{\"text\":\"ping\"}".toByteArray(Charsets.UTF_8)
        val resp =
          TunnelHttp.post(
            tunnel = tunnel,
            path = "/v1/turn",
            hostHeader = "127.0.0.1:${box.port}",
            headers =
              listOf(
                "Content-Type" to "application/json; charset=utf-8",
                "Authorization" to "Bearer t-1",
                "x-bitbot-device" to "dev-9",
              ),
            body = body,
          )
        assertEquals(200, resp.status)
        assertEquals(payload, resp.body)
        assertEquals("application/json; charset=utf-8", resp.headers["content-type"])

        val head = box.requestHead
        assertTrue("请求行要带方法/路径/版本：$head", head.startsWith("POST /v1/turn HTTP/1.1"))
        assertTrue("Host 必须指向桌面而不是中转：$head", head.contains("Host: 127.0.0.1:${box.port}"))
        assertTrue(head.contains("Authorization: Bearer t-1"))
        assertTrue(head.contains("x-bitbot-device: dev-9"))
        assertEquals("{\"text\":\"ping\"}", box.requestBody)
      }
    }
  }

  /* ---------------------------------------------------------------- RT-08 */

  @Test
  fun `RT-08 隧道上的 chunked 回包要拼回原文`() {
    val response =
      "HTTP/1.1 200 OK\r\n" +
        "Transfer-Encoding: chunked\r\n\r\n" +
        "5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n"
    FakeBox(response).use { box ->
      Socket("127.0.0.1", box.port).use { sock ->
        val resp =
          TunnelHttp.post(
            tunnel = RelayTunnel.Tunnel(sock, "127.0.0.1:${box.port}"),
            path = "/v1/events",
            hostHeader = "127.0.0.1:${box.port}",
            headers = emptyList(),
            body = ByteArray(0),
          )
        assertEquals(200, resp.status)
        assertEquals("hello world", resp.body)
      }
    }
  }

  /* ---------------------------------------------------------------- RT-09 */

  @Test
  fun `RT-09 策略：直连优先且不碰中转，直连全败才回落，都败就诚实离线`() {
    // 1) 直连可达 → DIRECT，中转一次都不许调用（中转是退路，不是并行候选）
    var relayCalled = false
    val direct =
      ConnectionStrategy.resolve(
        direct = { true },
        relay = {
          relayCalled = true
          true
        },
        now = { 0L },
      )
    assertEquals(ConnectionStrategy.Mode.DIRECT, direct.mode)
    assertTrue(direct.connected)
    assertFalse("直连通了还去碰中转，就是白花用户的时间", relayCalled)
    assertFalse(direct.relayTried)

    // 2) 直连失败 + 中转可达 → RELAY
    val viaRelay = ConnectionStrategy.resolve(direct = { false }, relay = { true }, now = { 0L })
    assertEquals(ConnectionStrategy.Mode.RELAY, viaRelay.mode)
    assertTrue(viaRelay.directTried)
    assertTrue(viaRelay.relayTried)

    // 3) 两条都不通 → NONE，且两条都试过（不许把「连不上」包装成「中转中」）
    val offline = ConnectionStrategy.resolve(direct = { false }, relay = { false }, now = { 0L })
    assertEquals(ConnectionStrategy.Mode.NONE, offline.mode)
    assertFalse(offline.connected)
    assertTrue(offline.directTried)
    assertTrue(offline.relayTried)
    assertNotNull(offline.reason)

    // 4) 没有中转配置 → 直连失败就是 NONE，reason 说清是「直连不通」而不是「中转不通」
    val noRelay = ConnectionStrategy.resolve(direct = { false }, relay = null, now = { 0L })
    assertEquals(ConnectionStrategy.Mode.NONE, noRelay.mode)
    assertFalse(noRelay.relayTried)
    assertEquals("direct_unreachable", noRelay.reason)
  }

  /* ---------------------------------------------------------------- RT-10 */

  @Test
  fun `RT-10 连接方式三语与延迟文案（与桌面同一套口径）`() {
    assertEquals("直连", ConnectionStrategy.describeMode(ConnectionStrategy.Mode.DIRECT, "zh"))
    assertEquals("直連", ConnectionStrategy.describeMode(ConnectionStrategy.Mode.DIRECT, "zh-TW"))
    assertEquals("Direct", ConnectionStrategy.describeMode(ConnectionStrategy.Mode.DIRECT, "en"))
    assertEquals("中转", ConnectionStrategy.describeMode(ConnectionStrategy.Mode.RELAY, "zh"))
    assertEquals("中轉", ConnectionStrategy.describeMode(ConnectionStrategy.Mode.RELAY, "zh-TW"))
    assertEquals("Relay", ConnectionStrategy.describeMode(ConnectionStrategy.Mode.RELAY, "en"))
    assertEquals("未连接", ConnectionStrategy.describeMode(ConnectionStrategy.Mode.NONE, "zh"))
    assertEquals("Offline", ConnectionStrategy.describeMode(ConnectionStrategy.Mode.NONE, "en"))

    val relayed =
      ConnectionStrategy.Resolution(
        mode = ConnectionStrategy.Mode.RELAY,
        latencyMs = 42,
        directTried = true,
        relayTried = true,
        reason = null,
      )
    assertEquals("中转 · 42ms", ConnectionStrategy.describe(relayed, "zh"))

    val offline =
      ConnectionStrategy.Resolution(
        mode = ConnectionStrategy.Mode.NONE,
        latencyMs = 9,
        directTried = true,
        relayTried = true,
        reason = "relay_unreachable",
      )
    // 没连上就不许显示延迟（`未连接 · 9ms` 会让用户以为连上了）
    assertEquals("未连接", ConnectionStrategy.describe(offline, "zh"))
  }

  /* ---------------------------------------------------------------- 假件 */

  /** 假中继：按 relay_server.js 的行协议应答，可选在数据面回显一行。 */
  private class FakeRelay(
    private val authReply: String,
    private val connectReply: String?,
    private val echoDataPlane: Boolean = false,
  ) : java.io.Closeable {
    private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = server.localPort

    @Volatile var sawAuth: String? = null
    @Volatile var sawConnect: String? = null

    private val worker =
      Thread {
        try {
          server.accept().use { s ->
            val inp = s.getInputStream()
            val out = s.getOutputStream()
            sawAuth = readLineFrom(inp)
            out.write((authReply + "\n").toByteArray(Charsets.ISO_8859_1))
            out.flush()
            if (connectReply != null) {
              sawConnect = readLineFrom(inp)
              out.write((connectReply + "\n").toByteArray(Charsets.ISO_8859_1))
              out.flush()
              if (echoDataPlane) {
                val line = readLineFrom(inp)
                if (line != null) {
                  out.write(("echo:" + line + "\n").toByteArray(Charsets.ISO_8859_1))
                  out.flush()
                }
                // 让客户端先把回显读走再关，避免 RST 把数据吃掉
                Thread.sleep(80)
              }
            }
          }
        } catch (_: Exception) {
        }
      }.apply {
        isDaemon = true
        start()
      }

    override fun close() {
      try {
        server.close()
      } catch (_: Exception) {
      }
    }
  }

  /** 假桌面：收一次完整 HTTP 请求，按预置原文回一次响应。 */
  private class FakeBox(private val response: String) : java.io.Closeable {
    private val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = server.localPort

    @Volatile var requestHead: String = ""
    @Volatile var requestBody: String = ""

    private val worker =
      Thread {
        try {
          server.accept().use { s ->
            val inp = s.getInputStream()
            val out = s.getOutputStream()
            val lines = mutableListOf<String>()
            while (true) {
              val l = readLineFrom(inp) ?: break
              if (l.isEmpty()) break
              lines += l
            }
            requestHead = lines.joinToString("\r\n")
            val declared =
              lines
                .firstOrNull { it.lowercase().startsWith("content-length:") }
                ?.substringAfter(":")
                ?.trim()
                ?.toIntOrNull()
                ?: 0
            if (declared > 0) {
              val buf = ByteArray(declared)
              var off = 0
              while (off < declared) {
                val n = inp.read(buf, off, declared - off)
                if (n < 0) break
                off += n
              }
              requestBody = String(buf, 0, off, Charsets.UTF_8)
            }
            out.write(response.toByteArray(Charsets.ISO_8859_1))
            out.flush()
            Thread.sleep(80)
          }
        } catch (_: Exception) {
        }
      }.apply {
        isDaemon = true
        start()
      }

    override fun close() {
      try {
        server.close()
      } catch (_: Exception) {
      }
    }
  }

}

/** 逐字节读一行（与控制面同一口径：只读必需的那几个字节，不预读数据面）。
 *  放文件级而不是类成员 —— 假件是嵌套类，拿不到外层实例成员。 */
private fun readLineFrom(input: InputStream): String? {
  val sb = StringBuilder()
  while (true) {
    val b = input.read()
    if (b < 0) return if (sb.isEmpty()) null else sb.toString()
    if (b == '\n'.code) return sb.toString()
    if (b != '\r'.code) sb.append(b.toChar())
    if (sb.length > 8192) return sb.toString()
  }
}
