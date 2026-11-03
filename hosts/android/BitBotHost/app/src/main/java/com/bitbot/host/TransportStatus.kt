package com.bitbot.host

/**
 * A3-6：**这一台手机上一次到底是怎么连上桌面的**。
 *
 * 为什么不能让界面自己猜：`ConnectionStrategy` 判定的是「探针通不通」，而界面要回答的是
 * 「这条消息走的是哪条路」。两者在跨网那一刻会分叉 —— 直连探针可能通（TCP 连得上），
 * 但回合实际走了中转（HTTP 层没成）。所以这里记的是**真实发生过的事**：谁把回包带回来的。
 *
 * 口径三条：
 *  1. 只记「上次实际成功的那条路」+ 耗时，不预测、不猜测；
 *  2. 两条都断 ⇒ 回到 NONE（界面不显示延迟，也不claim「中转中」）；
 *  3. 文案统一走 `ConnectionStrategy.describe`，与桌面同一套三语（G-81 的单一事实源）。
 *
 * 纯内存、不引用任何 Android 类（可在普通 JVM 单测里断言）。
 */
object TransportStatus {

  @Volatile private var mode: ConnectionStrategy.Mode = ConnectionStrategy.Mode.NONE
  @Volatile private var latency: Long = 0L

  /** 记一次**已经成功**的连接：哪条路 + 花了多久。负延迟归 0（时钟回拨也不显示 -3ms）。 */
  fun record(mode: ConnectionStrategy.Mode, latencyMs: Long) {
    this.mode = mode
    this.latency = if (latencyMs < 0L) 0L else latencyMs
  }

  fun reset() {
    mode = ConnectionStrategy.Mode.NONE
    latency = 0L
  }

  fun mode(): ConnectionStrategy.Mode = mode

  fun latencyMs(): Long = latency

  /** 给调试/门禁用：「中转 · 320ms」。没连过就是「未连接」。 */
  fun label(lang: String?): String = ConnectionStrategy.describe(snapshot(), lang)

  /**
   * 给界面用：没连过就回 null —— 让状态条保持原样（「未配对」/「已配对 · 地址」），
   * 不要多出一段「未连接」把「其实已经配对了」这件事盖掉。
   */
  fun labelOrNull(lang: String?): String? =
    if (mode == ConnectionStrategy.Mode.NONE) null else label(lang)

  fun snapshot(): ConnectionStrategy.Resolution =
    ConnectionStrategy.Resolution(
      mode = mode,
      latencyMs = latency,
      directTried = mode == ConnectionStrategy.Mode.DIRECT,
      relayTried = mode == ConnectionStrategy.Mode.RELAY,
      reason = null,
    )
}
