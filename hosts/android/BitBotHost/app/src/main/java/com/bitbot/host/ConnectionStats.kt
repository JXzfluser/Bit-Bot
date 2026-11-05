package com.bitbot.host

/**
 * R-A3-6c / A2-1：**真机连接统计** —— 给「跨网成功率」一个真实分母。
 *
 * 为什么需要这一层：路线 A 的验收口径是「跨网成功率 ≥90%」，但之前这个数字
 * 没有任何来源 —— 只有门禁里造的桩，没有一次真实统计。用户报「连不上」时，
 * 我们连「这台手机一共试过几次、失败几次」都说不出来，只能靠猜。
 *
 * 口径（刻意窄，避免自欺）：
 *  - 只记**真实发生过的尝试**：一次 /v1/turn 走直连成功/失败、走中转成功/失败；
 *  - 探活（/healthz）**不记**：它不代表业务可用，混进来会把成功率抬高；
 *  - 失败里区分「传输失败」与「凭证被拒」：前者是网络，后者是配置，
 *    把它们混成一个「失败率」会得出「跨网很差」的错误结论。
 *
 * 存在进程内 + 落到 prefs（重启不清零），因为「这次安装以来一共多少次」比
 * 「本次打开 app 多少次」有用得多。不含任何地址、凭证、内容。
 */
object ConnectionStats {

  /** 一组计数。 */
  data class Tally(
    val directOk: Int = 0,
    val directFail: Int = 0,
    val relayOk: Int = 0,
    val relayFail: Int = 0,
    val authRejected: Int = 0,
    val totalMs: Long = 0L,
    val samples: Int = 0,
  ) {
    val attempts: Int get() = directOk + directFail + relayOk + relayFail

    /** 跨网（走中转）的成功率；分母为 0 时回 null —— **不编 0%，也不编 100%**。 */
    val relayRate: Double? get() = if (relayOk + relayFail == 0) null else relayOk.toDouble() / (relayOk + relayFail)

    /** 整体成功率（直连 + 中转）。 */
    val overallRate: Double? get() = if (attempts == 0) null else (directOk + relayOk).toDouble() / attempts

    val avgMs: Long? get() = if (samples == 0) null else totalMs / samples

    /**
     * 给界面的一行。**分母为 0 就说「还没有样本」**，不许显示 100%。
     */
    fun describe(): String {
      if (attempts == 0) return "还没有连接样本"
      val rate = overallRate?.let { (it * 100).toInt() } ?: 0
      val relayPart = relayRate?.let { " · 跨网 ${(it * 100).toInt()}%（${relayOk}/${relayOk + relayFail}）" } ?: " · 跨网还没试过"
      val avg = avgMs?.let { " · 平均 ${it}ms" } ?: ""
      return "成功率 $rate%（$attempts 次）$relayPart$avg"
    }
  }

  @Volatile private var tally = Tally()

  /** 从 prefs 载入（app 启动时调一次）。缺失/坏数据一律当 0，不抛。 */
  fun load() {
    val p = TurnBridge.prefs() ?: return
    tally =
      Tally(
        directOk = p.getInt("stats_direct_ok", 0),
        directFail = p.getInt("stats_direct_fail", 0),
        relayOk = p.getInt("stats_relay_ok", 0),
        relayFail = p.getInt("stats_relay_fail", 0),
        authRejected = p.getInt("stats_auth_rejected", 0),
        totalMs = p.getLong("stats_total_ms", 0L),
        samples = p.getInt("stats_samples", 0),
      )
  }

  private fun persist() {
    val p = TurnBridge.prefs() ?: return
    val t = tally
    p.edit().apply {
      putInt("stats_direct_ok", t.directOk)
      putInt("stats_direct_fail", t.directFail)
      putInt("stats_relay_ok", t.relayOk)
      putInt("stats_relay_fail", t.relayFail)
      putInt("stats_auth_rejected", t.authRejected)
      putLong("stats_total_ms", t.totalMs)
      putInt("stats_samples", t.samples)
      apply()
    }
  }

  /** 一次直连尝试的结局。 */
  @Synchronized
  fun recordDirect(ok: Boolean, latencyMs: Long) {
    tally =
      tally.copy(
        directOk = tally.directOk + if (ok) 1 else 0,
        directFail = tally.directFail + if (ok) 0 else 1,
        totalMs = tally.totalMs + latencyMs.coerceAtLeast(0L),
        samples = tally.samples + 1,
      )
    persist()
  }

  /** 一次中转尝试的结局。 */
  @Synchronized
  fun recordRelay(ok: Boolean, latencyMs: Long) {
    tally =
      tally.copy(
        relayOk = tally.relayOk + if (ok) 1 else 0,
        relayFail = tally.relayFail + if (ok) 0 else 1,
        totalMs = tally.totalMs + latencyMs.coerceAtLeast(0L),
        samples = tally.samples + 1,
      )
    persist()
  }

  /** 凭证被拒：**不算连接失败**，单独计数（它是配置问题，不是网络问题）。 */
  @Synchronized
  fun recordAuthRejected() {
    tally = tally.copy(authRejected = tally.authRejected + 1)
    persist()
  }

  fun snapshot(): Tally = tally

  fun describe(): String = tally.describe()

  /** 仅测试/设置页「清零」用。 */
  @Synchronized
  fun reset() {
    tally = Tally()
    persist()
  }
}
