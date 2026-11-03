package com.bitbot.host

/**
 * A3-5 手机端连接策略：直连优先 → 直连全失败且配了中转才回落 → 全不可达就诚实离线。
 *
 * 这段语义的单一事实源是 `hosts/shared/connection_strategy.js`（A3-3，接矩阵 G-81）。
 * 端上必须复用同一套判定，否则「桌面说直连、手机说中转」这种对不上的话会直接出现在界面上。
 *
 * 三条不许退让的口径：
 *  1. **直连一旦可达就短路** —— 不再碰后面的候选，也不碰中转（省时且行为确定）；
 *  2. **只有直连全失败才看中转** —— 中转不是「更好的连接」，是「退路」；
 *  3. **都失败就回 NONE** —— 不许把「连不上」包装成「中转中」。
 *
 * 纯逻辑、探针可注入，不引用任何 Android 类。
 */
object ConnectionStrategy {

  enum class Mode { DIRECT, RELAY, NONE }

  data class Resolution(
    val mode: Mode,
    val latencyMs: Long,
    val directTried: Boolean,
    val relayTried: Boolean,
    val reason: String?,
  ) {
    val connected: Boolean get() = mode == Mode.DIRECT || mode == Mode.RELAY
  }

  /* 与 connection_strategy.js:164-168 的 MODE_LABELS 一字不差（zh / zh-TW / en）。 */
  private val LABELS: Map<Mode, Map<String, String>> =
    mapOf(
      // 端上 locale 是 "zh-CN"（EventStreamMessages.localeFrom），这里直接收，
      // 不再在调用方加一层映射 —— 两处各写一份映射，早晚会有一处忘改。
      Mode.DIRECT to mapOf("zh" to "直连", "zh-CN" to "直连", "zh-TW" to "直連", "en" to "Direct"),
      Mode.RELAY to mapOf("zh" to "中转", "zh-CN" to "中转", "zh-TW" to "中轉", "en" to "Relay"),
      Mode.NONE to mapOf("zh" to "未连接", "zh-CN" to "未连接", "zh-TW" to "未連線", "en" to "Offline"),
    )

  /** 界面文案：连接方式（连上时再拼 ` · Nms`）。AC-T4-5「界面显示连接方式与延迟」。 */
  fun describeMode(mode: Mode, lang: String?): String {
    val table = LABELS[mode] ?: LABELS.getValue(Mode.NONE)
    return table[lang] ?: table["zh"] ?: "未连接"
  }

  fun describe(res: Resolution, lang: String?): String {
    val label = describeMode(res.mode, lang)
    return if (res.connected) "$label · ${res.latencyMs}ms" else label
  }

  /**
   * 判定一次连接方式。
   *
   * @param direct 直连探针（可多次按候选顺序调用）。null = 没有直连候选。
   * @param relay  中转探针。null = 没配中转。
   * @param now    时间源（注入是为了让「延迟」在测试里可断言，不用 sleep）。
   */
  fun resolve(
    direct: (() -> Boolean)?,
    relay: (() -> Boolean)?,
    now: () -> Long = { System.currentTimeMillis() },
  ): Resolution {
    val started = now()

    if (direct != null) {
      val directOk =
        try {
          direct()
        } catch (_: Exception) {
          false
        }
      if (directOk) {
        return Resolution(
          mode = Mode.DIRECT,
          latencyMs = now() - started,
          directTried = true,
          relayTried = false,
          reason = null,
        )
      }
    }

    val afterDirect = now()
    if (relay == null) {
      return Resolution(
        mode = Mode.NONE,
        latencyMs = afterDirect - started,
        directTried = direct != null,
        relayTried = false,
        reason = if (direct == null) "no_candidate" else "direct_unreachable",
      )
    }

    var relayReason: String? = null
    val relayOk =
      try {
        relay()
      } catch (e: Exception) {
        relayReason = e.message ?: "error"
        false
      }
    val end = now()
    return if (relayOk) {
      Resolution(
        mode = Mode.RELAY,
        latencyMs = end - started,
        directTried = direct != null,
        relayTried = true,
        reason = null,
      )
    } else {
      Resolution(
        mode = Mode.NONE,
        latencyMs = end - started,
        directTried = direct != null,
        relayTried = true,
        reason = relayReason ?: "relay_unreachable",
      )
    }
  }
}
