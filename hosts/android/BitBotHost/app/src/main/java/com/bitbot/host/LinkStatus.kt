package com.bitbot.host

/**
 * A3-17：**「已配对」不等于「连得上」**。
 *
 * 现场来由：手机状态条写着「已配对」，用户发消息却报 `invalid_token`。
 * 旧实现里 `paired` 只有一处判断（`MainActivity.pairedNow()`）：
 * `TurnBridge.hostUrl() != null && TurnBridge.turnToken() != null` ——
 * 也就是说，只要 prefs 里那两个字符串非空，界面就敢写「已配对」。
 * 那证明的是**你曾经填过**，不是**现在连得通**。用户看到的是「连上了」，
 * 实际发生的是「什么都没问过」。
 *
 * 这一层把「桌面在不在」与「凭证认不认」拆成两件事分别记：
 *
 *  - `presence` 回答「桌面这台机器此刻有没有响应」—— 由主动探活写入；
 *  - `auth` 回答「桌面认不认这台手机的凭证」—— 只有真的发过一次带凭证的请求才知道。
 *
 * 为什么必须分开：探活打的是 `/healthz`（不需要凭证），它通只说明网络和进程在；
 * 而 401 是业务面的结论。把两者合成一个布尔值，就会出现「健康检查通过、
 * 发消息全 401」这种最误导人的组合 —— 正是用户踩的那个坑。
 *
 * 纯数据 + 纯函数，不引用任何 Android 类，JVM 单测能直接断言。
 */
object LinkStatus {

  /** 桌面在不在。 */
  enum class Presence { UNKNOWN, PROBING, ONLINE, OFFLINE }

  /** 桌面认不认这台手机的凭证。 */
  enum class Auth { UNKNOWN, ACCEPTED, REJECTED }

  /**
   * 一次快照。
   *
   * @param detail 人话原因（探活失败/被拒的机器码），没话可说时为 null ——
   *               宁可不说，也不要拿「未知错误」占位。
   * @param checkedAtMs 上次探活时刻（0 = 从没探过）。界面用它判断结论是否过期。
   */
  data class Snapshot(
    val presence: Presence = Presence.UNKNOWN,
    val auth: Auth = Auth.UNKNOWN,
    val detail: String? = null,
    val checkedAtMs: Long = 0L,
  ) {
    /** 结论是否还新鲜。超过 [STALE_AFTER_MS] 就不该再当「在线」显示。 */
    fun isFresh(nowMs: Long): Boolean =
      checkedAtMs > 0L && (nowMs - checkedAtMs) in 0..STALE_AFTER_MS

    /** 只有「探到且新鲜且凭证没被拒」才算真的连得上。 */
    fun isReachable(nowMs: Long): Boolean = presence == Presence.ONLINE && isFresh(nowMs) && auth != Auth.REJECTED
  }

  /** 探活结论的保鲜期：超过就降回「待确认」，避免把十分钟前的绿灯当现在的。 */
  const val STALE_AFTER_MS: Long = 60_000L

  @Volatile private var snap = Snapshot()

  fun snapshot(): Snapshot = snap

  fun reset() {
    snap = Snapshot()
  }

  /** 开始探活：先把状态推到 PROBING，界面就能显示「检测中」而不是继续挂着旧结论。 */
  fun probing(nowMs: Long = System.currentTimeMillis()) {
    snap = snap.copy(presence = Presence.PROBING, detail = keepRejectDetail(), checkedAtMs = nowMs)
  }

  /** 探活成功：桌面在。**不动 auth** —— 健康检查通过不代表凭证被接受。 */
  fun online(nowMs: Long = System.currentTimeMillis()) {
    snap = snap.copy(presence = Presence.ONLINE, detail = keepRejectDetail(), checkedAtMs = nowMs)
  }

  /**
   * 探活这一步该不该把 `detail` 清掉。
   *
   * 曾经这里直接写 `detail = null`，于是「先被拒、再探活通过」会把被拒的原因（`invalid_token`）
   * 抹成「已配对 · 凭证被拒」五个字 —— 用户只知道自己被拒，不知道为什么。
   * 探活与凭证是两件事，探活只该改 presence，不该碰凭证那半边的话。
   */
  private fun keepRejectDetail(): String? = if (snap.auth == Auth.REJECTED) snap.detail else null

  /** 探活失败：桌面不在（或网络不通）。原因原样留着，别换成「未知错误」。 */
  fun offline(reason: String?, nowMs: Long = System.currentTimeMillis()) {
    snap = snap.copy(presence = Presence.OFFLINE, detail = reason, checkedAtMs = nowMs)
  }

  /** 业务请求被接受了 —— 这是比探活更硬的证据。 */
  fun authAccepted() {
    snap = snap.copy(auth = Auth.ACCEPTED, detail = null)
  }

  /**
   * 业务请求被拒（401/403）。**同时**把 presence 抬到 ONLINE：
   * 能收到 401，说明桌面确实在那儿、也回话了 —— 这比探活结果更可靠。
   * 旧实现把 401 归成「连不上」，于是用户去查 Wi-Fi，方向完全错了。
   */
  fun authRejected(code: String?, nowMs: Long = System.currentTimeMillis()) {
    snap = snap.copy(
      presence = Presence.ONLINE,
      auth = Auth.REJECTED,
      detail = code,
      checkedAtMs = if (nowMs > 0L) nowMs else snap.checkedAtMs,
    )
  }

  /**
   * 状态条上那句话。
   *
   * @param paired prefs 里有没有配对信息（**只是前提**，不再是结论）
   * @param nowMs  用于判断结论是否过期
   * @return null = 不要覆盖界面原有文案（未配对时由调用方自己写「未配对」）
   */
  fun label(paired: Boolean, nowMs: Long = System.currentTimeMillis()): String? {
    if (!paired) return null
    val s = snap
    return when {
      // 凭证被拒优先说 —— 这时「桌面在线」反而是坏消息，更需要被看见。
      s.auth == Auth.REJECTED -> "已配对 · 凭证被拒" + (s.detail?.takeIf { it.isNotBlank() }?.let { "（$it）" } ?: "")
      s.presence == Presence.PROBING -> "已配对 · 检测中"
      s.presence == Presence.OFFLINE -> "已配对 · 桌面未响应" + (s.detail?.takeIf { it.isNotBlank() }?.let { "（$it）" } ?: "")
      s.presence == Presence.ONLINE && s.isFresh(nowMs) -> "已配对 · 在线"
      // 探过但已过期：别继续骗人，降级成「待确认」。
      s.presence == Presence.ONLINE -> "已配对 · 待确认"
      else -> "已配对"
    }
  }

  /** 状态点该用什么颜色语义：ok / warn / error / idle。 */
  fun tone(paired: Boolean, nowMs: Long = System.currentTimeMillis()): String {
    if (!paired) return "idle"
    val s = snap
    return when {
      s.auth == Auth.REJECTED -> "error"
      s.presence == Presence.OFFLINE -> "error"
      s.presence == Presence.ONLINE && s.isFresh(nowMs) -> "ok"
      s.presence == Presence.PROBING -> "warn"
      else -> "idle"
    }
  }

  /**
   * 探活结果分类（纯函数，喂 HTTP 状态码/异常名就能断言）。
   *
   * 口径：**只回答「桌面在不在」**。401 也算 ONLINE —— 它证明对面活着并且在鉴权，
   * 把 401 归成掉线是旧实现最误导人的地方之一。
   */
  fun classifyProbe(statusCode: Int?, errorName: String?): Pair<Presence, String?> =
    when {
      statusCode != null && statusCode in 200..299 -> Presence.ONLINE to null
      statusCode != null && (statusCode == 401 || statusCode == 403) -> Presence.ONLINE to null
      statusCode != null && statusCode == 404 ->
        // 端口上确实有东西在听，但**它不是桌面**（或者是版本太旧、没有 /healthz 的桌面）。
        // 这种情况不能算 ONLINE：算在线的话界面会写「已配对 · 在线」，而用户发消息必然失败 ——
        // 那正是 A3-17 要消灭的那种「界面说好、实际不通」。回 OFFLINE 并把人话放进 detail。
        Presence.OFFLINE to "这个端口上没有 /healthz（404），可能不是 Desktop"
      statusCode != null -> Presence.OFFLINE to "HTTP $statusCode"
      errorName == null -> Presence.OFFLINE to null
      // 传输层异常翻人话，别把 Java 类名甩给用户。
      errorName.contains("refused", ignoreCase = true) ->
        Presence.OFFLINE to "桌面没在跑或端口不对"
      errorName.contains("timeout", ignoreCase = true) || errorName.contains("timed out", ignoreCase = true) ->
        Presence.OFFLINE to "没有回包"
      errorName.contains("unknownhost", ignoreCase = true) || errorName.contains("unresolved", ignoreCase = true) ->
        Presence.OFFLINE to "地址解析不到"
      errorName.contains("network", ignoreCase = true) || errorName.contains("unreachable", ignoreCase = true) ->
        Presence.OFFLINE to "网络不可达"
      else -> Presence.OFFLINE to null
    }
}
