package com.bitbot.host

import java.net.Socket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * R-A3-5b 残留：**事件流那条隧道在断线重连时会被丢掉，但没被关掉**。
 *
 * 现场长这样：手机在蜂窝网下看进度，流断了 → 重试循环 sleep 一下重连（1s/2s/4s/8s/10s…）
 * → 每次都 `RelayTunnel.open` 一条新的，而 `this.relayTunnel` 只是**被覆盖**，
 * 上一条 socket 既没还池（它本来就不还池，长连接）也没关。中继那边于是挂着一条
 * 永远不会有数据的连接 —— 报告里「断线时会不会在中继上留一条看不见的连接」，
 * 答案是**会**，而且每重连一次多一条。
 *
 * 为什么之前没被发现：这条路径只在「走了中转 + 流断了」时才触发，本机门禁里
 * 事件流要么走直连、要么一次跑完不断线。**只有把「重连 N 次」显式造出来才看得见。**
 *
 * 这组用例的第一条（RL-01）是反真空证明：同一个场景用**旧写法**跑，必须漏。
 * 没有它的话，五个「关掉了」的断言可能只是因为压根没开。
 */
class TunnelOwnershipTest {

  /** 与生产同构的假隧道：未连接的 Socket 就够（`isClosed` 是唯一关心的状态）。 */
  private fun tunnel(): RelayTunnel.Tunnel = RelayTunnel.Tunnel(Socket(), "10.0.0.1:18765")

  /**
   * 旧写法（没有 try/finally）：块里抛异常时，socket 就留着了。
   *
   * 这个函数不参与生产，只用来证明「本组用例造的场景**真的**能暴露泄漏」。
   * 它和 `withOwnership` 的差别只有那一个 `finally` —— 别处一字不差。
   */
  private fun leakyRead(t: RelayTunnel.Tunnel, block: (RelayTunnel.Tunnel) -> Unit) {
    block(t)
    // 故意什么都不做：这正是修复前的 readViaRelay。
  }

  /* ============ RL-01 反真空：旧写法必须真的漏 ============ */

  @Test
  fun `RL-01 旧写法在流中断后留下未关闭的 socket（若不漏，这组用例测不出东西）`() {
    val t = tunnel()
    assertFalse("前提：刚开的 socket 是开着的", t.socket.isClosed)
    try {
      leakyRead(t) { throw java.io.IOException("stream interrupted") }
      fail("这里必须抛出去")
    } catch (_: java.io.IOException) {
      // 预期的：异常冒到重试循环
    }
    assertFalse(
      "旧写法就该漏在这里 —— 如果它不漏，说明本组用例造的场景压根没暴露问题",
      t.socket.isClosed,
    )
  }

  /* ============ RL-02 / RL-03 新原语：任何出口都关 ============ */

  @Test
  fun `RL-02 正常读完也关：流自己结束（turn_ended）不留连接`() {
    val t = tunnel()
    val n = t.withOwnership { 42 }
    assertEquals(42, n)
    assertTrue("流正常结束也要关 —— 否则下一轮开始时中继上还挂着上一条", t.socket.isClosed)
  }

  @Test
  fun `RL-03 块里抛异常也关，且异常原样上抛`() {
    val t = tunnel()
    val boom = java.io.IOException("broken pipe")
    try {
      t.withOwnership { throw boom }
      fail("异常必须原样传给重试循环，不能被吞")
    } catch (e: java.io.IOException) {
      assertSame("必须是同一个异常对象 —— 换一个会丢掉栈和类型", boom, e)
    }
    assertTrue("抛出去之前必须先关掉这一条", t.socket.isClosed)
  }

  /* ============ RL-04 真机现象复刻：重连 5 次，一条都不许留 ============ */

  @Test
  fun `RL-04 断线重连 5 次：开了 5 条、关了 5 条、零残留`() {
    val opened = ArrayList<RelayTunnel.Tunnel>()
    repeat(5) { i ->
      val t = tunnel()
      opened.add(t)
      try {
        t.withOwnership { throw java.io.IOException("retry #$i") }
      } catch (_: java.io.IOException) {
        // 重试循环在这里 sleep 之后再来一次
      }
    }
    assertEquals(5, opened.size)
    val leaked = opened.count { !it.socket.isClosed }
    assertEquals("重连 5 次必须零残留，实际残留 $leaked 条", 0, leaked)
  }

  /* ============ RL-05 幂等：关两次不出事 ============ */

  @Test
  fun `RL-05 已经关掉的再关一次不抛（界面线程 close 与 finally 会撞车）`() {
    val t = tunnel()
    t.withOwnership { Unit }
    assertTrue(t.socket.isClosed)
    // close() 再从另一条线程调一次：真机上 close() 是界面线程调的，会与 finally 并发。
    t.close()
    t.close()
    assertTrue("重复关闭不能抛，也不能把状态翻回去", t.socket.isClosed)
  }
}
