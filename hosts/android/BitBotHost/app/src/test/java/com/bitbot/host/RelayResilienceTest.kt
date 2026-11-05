package com.bitbot.host

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.Socket
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * R-A3-6b / R-A3-5c / R-A3-5b / R-A3-6c 的行为用例。
 *
 * 为什么单独一个文件：这三块（隧道池、chunked 惰性解码、连接统计）都是**纯 JVM**
 * 的东西 —— 不需要 emulator、不需要真机、不需要真 relay。把能在这里钉住的东西
 * 钉住，剩下的「真机上到底快不快」才是唯一必须上设备的残留。
 *
 * 三个共同的病，这三组用例都是冲着它们来的：
 *  1. **只测成功路径**。池子如果「永远不复用」也能让所有成功用例绿 ——
 *     所以每组都有一个「反真空」用例：证明它**真的**在复用/真的在算分母。
 *  2. **闸门只查代码写了没有**。写了但没接上（`borrow` 定义了没人调）在真机上
 *     表现为「跟以前一样慢」，不报错。所以这里断言的是**可观测的计数**。
 *  3. **不会失败的分母**。统计最容易变成自我安慰：只记成功 → 永远 100%。
 *     所以 TC-01 专门钉「0 样本时不许显示 100%，要说还没有样本」。
 */
class RelayResilienceTest {

  private fun cfg(host: String = "relay.example.com", token: String = "tok-a") =
    RelayTunnel.RelayConfig(host = host, port = 18766, token = token, boxId = "box-1")

  /** 一条「看起来正常」的隧道：未连接的 Socket 就够用（`isClosed` 是池子唯一关心的状态）。 */
  private fun tunnel(): RelayTunnel.Tunnel = RelayTunnel.Tunnel(Socket(), "10.0.0.1:18765")

  @After
  fun tearDown() {
    RelayTunnelPool.resetForTest()
    ConnectionStats.reset()
  }

  /* ---------------------------------------------------------------- 隧道池 */

  @Test
  fun `TP-01 还回来的隧道下一回合真的被复用（不是每回合都新开）`() {
    var opened = 0
    val open = { _: RelayTunnel.RelayConfig ->
      opened++
      tunnel()
    }
    val first = RelayTunnelPool.borrow(cfg(), nowMs = 1_000L, open = open)
    assertEquals("第一次必然新开", 1, opened)
    RelayTunnelPool.release(first, nowMs = 1_100L)

    val second = RelayTunnelPool.borrow(cfg(), nowMs = 1_200L, open = open)
    assertSame("同一个配置下应当拿回同一条隧道", first, second)
    assertEquals("复用就不该再开新的", 1, opened)
    assertEquals(1, RelayTunnelPool.stats()["reused"])
    assertEquals("借出去之后池里应该是空的", 0, RelayTunnelPool.stats()["idle"])
  }

  @Test
  fun `TP-02 空闲太久的隧道不重用，直接关掉（留一条死连接比新建还慢）`() {
    val stale = tunnel()
    var opened = 0
    val open = { _: RelayTunnel.RelayConfig ->
      opened++
      tunnel()
    }
    RelayTunnelPool.release(RelayTunnelPool.borrow(cfg(), nowMs = 1_000L, open = { stale }), nowMs = 1_000L)
    val later = RelayTunnelPool.borrow(cfg(), nowMs = 1_000L + RelayTunnelPool.IDLE_TIMEOUT_MS + 1, open = open)
    assertTrue("超时后不该复用旧隧道", later !== stale)
    assertTrue("旧隧道必须被真的关掉", stale.socket.isClosed)
    assertEquals("超时后要新开一条", 1, opened)
    assertTrue((RelayTunnelPool.stats()["evicted"] ?: 0) >= 1)
  }

  @Test
  fun `TP-03 配置一变整池作废 —— 不许拿旧隧道连新地方`() {
    val old = tunnel()
    var opened = 0
    val open = { _: RelayTunnel.RelayConfig ->
      opened++
      tunnel()
    }
    RelayTunnelPool.release(RelayTunnelPool.borrow(cfg(token = "tok-a"), nowMs = 1_000L, open = { old }))
    val after = RelayTunnelPool.borrow(cfg(token = "tok-b"), nowMs = 1_100L, open = open)
    assertTrue("换了凭证还复用旧隧道 ＝ 改了配置却连老地方", after !== old)
    assertTrue("旧隧道要关掉", old.socket.isClosed)
    assertEquals(1, opened)
  }

  @Test
  fun `TP-04 已经关掉的隧道不许回到池里`() {
    val dead = tunnel()
    dead.socket.close()
    RelayTunnelPool.release(dead, nowMs = 1_000L)
    assertEquals("坏隧道不该占着空闲位", 0, RelayTunnelPool.stats()["idle"])
    var opened = 0
    val t = RelayTunnelPool.borrow(cfg(), nowMs = 1_100L, open = { _ -> opened++; tunnel() })
    assertNotNull(t)
    assertEquals(1, opened)
  }

  @Test
  fun `TP-05 最多只留一条空闲：多还的直接关掉，别在中继上攒连接`() {
    assertEquals(1, RelayTunnelPool.MAX_IDLE)
    val a = tunnel()
    val b = tunnel()
    RelayTunnelPool.release(a, nowMs = 1_000L)
    RelayTunnelPool.release(b, nowMs = 1_000L)
    assertEquals(1, RelayTunnelPool.stats()["idle"])
    assertTrue("多出来的那条必须被关掉", a.socket.isClosed || b.socket.isClosed)
    assertTrue((RelayTunnelPool.stats()["evicted"] ?: 0) >= 1)
  }

  @Test
  fun `TP-06 invalidate 立刻关掉且不留在池里`() {
    val t = tunnel()
    RelayTunnelPool.invalidate(t)
    assertTrue(t.socket.isClosed)
    assertEquals(0, RelayTunnelPool.stats()["idle"])
    assertTrue((RelayTunnelPool.stats()["evicted"] ?: 0) >= 1)
  }

  /* ------------------------------------------------------------ chunked 惰性 */

  @Test
  fun `SX-01 chunked 逐块拼回原文（两块加结束块）`() {
    val wire = "5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n"
    val out = readAll(TunnelHttp.ChunkedInputStream(ByteArrayInputStream(wire.toByteArray())))
    assertEquals("hello world", String(out))
  }

  /**
   * SX-02 是这一组里最重要的一条：SSE 走隧道时，如果 `ChunkedInputStream`
   * **等到整条流结束**才吐字节，手机上的进度行就会一直空着，直到回合结束才一次性出现
   * —— 那正是 R-A3-5b 要避免的形态（用户以为卡住了）。
   */
  @Test
  fun `SX-02 惰性：第一块到手时不许把整条流读完`() {
    var tailAsked = false
    val src =
      object : InputStream() {
        private val head = "5\r\nhello\r\n".toByteArray()
        private var i = 0

        override fun read(): Int {
          if (i < head.size) return head[i++].toInt() and 0xFF
          tailAsked = true
          return -1
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
          if (i >= head.size) {
            tailAsked = true
            return -1
          }
          val n = minOf(len, head.size - i)
          System.arraycopy(head, i, b, off, n)
          i += n
          return n
        }
      }
    val stream = TunnelHttp.ChunkedInputStream(src)
    val buf = ByteArray(5)
    val n = stream.read(buf, 0, 5)
    assertEquals(5, n)
    assertEquals("hello", String(buf))
    assertFalse("第一块还没读完就去问后面 —— 那就不是惰性解码了", tailAsked)
  }

  @Test
  fun `SX-03 空块立即结束，不挂住调用方`() {
    val out = readAll(TunnelHttp.ChunkedInputStream(ByteArrayInputStream("0\r\n\r\n".toByteArray())))
    assertEquals(0, out.size)
  }

  private fun readAll(input: InputStream): ByteArray {
    val buf = java.io.ByteArrayOutputStream()
    val tmp = ByteArray(64)
    while (true) {
      val n = input.read(tmp, 0, tmp.size)
      if (n < 0) break
      buf.write(tmp, 0, n)
    }
    return buf.toByteArray()
  }

  /* ---------------------------------------------------------------- 连接统计 */

  @Test
  fun `TC-01 一次都没试过时不许显示成功率 —— 分母为 0 就说还没有样本`() {
    val t = ConnectionStats.snapshot()
    assertEquals(0, t.attempts)
    assertNull("没有样本就没有成功率，不许编 0%", t.overallRate)
    assertNull("没走过中转就别说跨网成功率", t.relayRate)
    assertNull(t.avgMs)
    assertEquals("还没有连接样本", t.describe())
    assertFalse("描述里不许出现 100%", t.describe().contains("100%"))
  }

  @Test
  fun `TC-02 直连与中转分开记，中转成功率只算中转那部分`() {
    ConnectionStats.recordDirect(true, 100)
    ConnectionStats.recordDirect(false, 300)
    ConnectionStats.recordRelay(true, 500)
    val t = ConnectionStats.snapshot()
    assertEquals(2, t.directOk + t.directFail)
    assertEquals(1, t.relayOk)
    assertEquals(0, t.relayFail)
    assertEquals("中转 1/1", 1.0, t.relayRate!!, 0.0001)
    assertEquals("整体 2/3", 2.0 / 3.0, t.overallRate!!, 0.0001)
    assertEquals(300L, t.avgMs)
    assertTrue(t.describe().contains("跨网"))
  }

  @Test
  fun `TC-03 凭证被拒不算连接失败 —— 它是配置问题，混进成功率会得出错误结论`() {
    ConnectionStats.recordDirect(true, 100)
    ConnectionStats.recordAuthRejected()
    ConnectionStats.recordAuthRejected()
    val t = ConnectionStats.snapshot()
    assertEquals("被拒不进尝试次数", 1, t.attempts)
    assertEquals(2, t.authRejected)
    assertEquals("成功率不该被被拒拉低", 1.0, t.overallRate!!, 0.0001)
  }

  @Test
  fun `TC-04 清零真的归零，描述回到「还没有样本」`() {
    ConnectionStats.recordRelay(false, 900)
    assertTrue(ConnectionStats.snapshot().attempts > 0)
    ConnectionStats.reset()
    assertEquals(0, ConnectionStats.snapshot().attempts)
    assertEquals("还没有连接样本", ConnectionStats.describe())
  }
}
