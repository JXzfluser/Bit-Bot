package com.bitbot.host

import java.util.concurrent.ConcurrentLinkedDeque

/**
 * R-A3-6b / R-A3-5c：**隧道复用**。
 *
 * 现状（A3-5/A3-6 的样子）：每一回合都 `AUTH → CONNECT → 干活 → 关`。
 * 一个回合只有一条请求，跨网时这条连接的建立成本（TCP 三次握手 + 中继鉴权 + 等 ATTACH）
 * 全摊在用户那句「发出去」的延迟里；连着发三条就是付三次。
 *
 * 这一层做的事很小：**留一条空闲隧道，下回合接着用**。三条纪律：
 *
 *  1. **只在配置没变时复用**。改了 relay 地址/凭证/盒子 ⇒ 池子整体作废 —— 拿旧隧道
 *     去连新配置，用户会看到一个「明明改了却还连老地方」的幽灵问题。
 *  2. **复用失败即废弃，且不静默重试**。对端已经关掉的隧道会抛
 *     [TunnelHttp.StaleTunnelException]，池子丢它、调用方重开一条；
 *     不在这里偷偷重试第二次，否则「网络在抖」和「隧道过期」就分不清了。
 *  3. **空闲超时归零**。留一条已经死了三十秒的连接比重新建一条更慢，
 *     而且会在中继上留一条看不见的连接。
 *
 * 没有 Android 依赖：普通 JVM 单测里配一个假 socket 就能断言借用/归还/废弃。
 */
object RelayTunnelPool {

  /** 空闲隧道最多留一条：多留只是在占中继的连接槽，收益递减。 */
  const val MAX_IDLE: Int = 1

  /** 空闲超过这个时间就丢掉：NAT 映射通常比它短。 */
  const val IDLE_TIMEOUT_MS: Long = 30_000L

  private data class Idle(val tunnel: RelayTunnel.Tunnel, val since: Long)

  private val idle = ConcurrentLinkedDeque<Idle>()

  /** 池子当前归属的配置指纹。配置一变，整池作废。 */
  @Volatile private var fingerprint: String = ""

  /** 诊断用：借出/复用/新建/废弃各多少次。门禁与真机统计都读它。 */
  @Volatile var reusedCount: Int = 0
    private set
  @Volatile var openedCount: Int = 0
    private set
  @Volatile var evictedCount: Int = 0
    private set

  private fun fp(cfg: RelayTunnel.RelayConfig): String =
    cfg.host + "|" + cfg.port + "|" + cfg.boxId + "|" + cfg.token.hashCode()

  /**
   * 借一条隧道。优先复用空闲的；没有（或已过期/配置变了）就新开一条。
   *
   * @param nowMs 注入时钟，门禁不依赖真实时间
   */
  fun borrow(
    cfg: RelayTunnel.RelayConfig,
    nowMs: Long = System.currentTimeMillis(),
    open: (RelayTunnel.RelayConfig) -> RelayTunnel.Tunnel = { RelayTunnel.open(it) },
  ): RelayTunnel.Tunnel {
    val want = fp(cfg)
    if (fingerprint != want) {
      // 配置变了：旧隧道连的是别的地方，一条都不能留。
      dropAll()
      fingerprint = want
    }
    val head = idle.pollFirst()
    if (head != null) {
      if (nowMs - head.since <= IDLE_TIMEOUT_MS && !head.tunnel.socket.isClosed) {
        reusedCount++
        return head.tunnel
      }
      evictedCount++
      RelayTunnel.closeQuietly(head.tunnel.socket)
    }
    openedCount++
    return open(cfg)
  }

  /**
   * 还一条用完了的隧道。还回来之前不清空缓冲 —— 调用方必须已经把这一轮响应读完
   * （`TunnelHttp.post` 会读完定长/chunked 体才返回，所以这里可以直接留）。
   */
  fun release(tunnel: RelayTunnel.Tunnel?, nowMs: Long = System.currentTimeMillis()) {
    if (tunnel == null) return
    if (tunnel.socket.isClosed) {
      evictedCount++
      return
    }
    if (idle.size >= MAX_IDLE) {
      // 已经有一条闲着的：多留一条没意义，直接关掉，别在中继上攒连接。
      evictedCount++
      RelayTunnel.closeQuietly(tunnel.socket)
      return
    }
    idle.addFirst(Idle(tunnel, nowMs))
  }

  /** 这条隧道坏了（超时/对端关闭/协议不对）：关掉，不留。 */
  fun invalidate(tunnel: RelayTunnel.Tunnel?) {
    if (tunnel == null) return
    evictedCount++
    RelayTunnel.closeQuietly(tunnel.socket)
  }

  /** 配置变更、切前后台、关中转时调用：把空闲的全关掉。 */
  fun dropAll() {
    while (true) {
      val it = idle.pollFirst() ?: break
      evictedCount++
      RelayTunnel.closeQuietly(it.tunnel.socket)
    }
  }

  /** 诊断快照（真机统计用；不含任何凭证）。 */
  fun stats(): Map<String, Int> =
    mapOf(
      "reused" to reusedCount,
      "opened" to openedCount,
      "evicted" to evictedCount,
      "idle" to idle.size,
    )

  /** 仅测试用：把计数器清零。 */
  fun resetForTest() {
    dropAll()
    fingerprint = ""
    reusedCount = 0
    openedCount = 0
    evictedCount = 0
  }
}
