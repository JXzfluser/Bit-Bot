package com.bitbot.host

import java.net.HttpURLConnection
import java.net.URL

/**
 * A3-17：主动探活 —— 回答「桌面这台机器此刻在不在」。
 *
 * 只做一件事：GET `<配对地址>/healthz`，短超时。不解析 body、不带凭证、
 * 不写任何状态（状态归 [LinkStatus]），这样 JVM 单测能靠注入一个假的
 * [Transport] 断言全部分支，不需要 emulator。
 *
 * 三个刻意的选择：
 *  1. **打 /healthz 而不是 /v1/turn**：回合接口会真跑一次推理，探活不该有副作用、
 *     也不该几十秒才回。健康检查是桌面专门为这件事留的。
 *  2. **超时压到 2.5 秒**：探活的全部价值在于「快」。等 15 秒才说连不上，
 *     用户早就去查 Wi-Fi 了。
 *  3. **不把 401 当掉线**（见 [LinkStatus.classifyProbe]）：401 证明对面活着。
 */
object LinkProbe {

  /** 探活结果的原始形状：状态码或异常名，二选一。纯数据，方便断言。 */
  data class Raw(val statusCode: Int?, val errorName: String?)

  /** 传输层抽象：门禁/单测注入替身，产品里用 [httpGet]。 */
  fun interface Transport {
    fun get(url: String, timeoutMs: Int): Raw
  }

  /** 探活默认超时。比回合的 15s 短一个量级 —— 探活慢就等于没探活。 */
  const val DEFAULT_TIMEOUT_MS: Int = 2500

  /**
   * 从配对地址推出 /healthz 地址。
   *
   * 配对地址可能已经带 `/v1/turn`（用户从桌面复制完整端点时就是这样），
   * 所以先归一成 base 再拼 —— 直接 `$hostUrl/healthz` 会拼出
   * `.../v1/turn/healthz`，那一定是 404，然后被误判成「桌面不在」。
   */
  fun healthUrl(hostUrl: String?): String? {
    val base = TurnBridge.normalizeHostUrl(hostUrl) ?: return null
    val trimmed =
      when {
        base.endsWith("/v1/turn") -> base.removeSuffix("/v1/turn")
        else -> base
      }
    return trimmed.trimEnd('/') + "/healthz"
  }

  /**
   * 探一次并把结论写进 [LinkStatus]。
   *
   * @return 探活后的快照（调用方要立即刷新界面，不用再读一次全局状态）
   */
  fun probe(
    hostUrl: String?,
    timeoutMs: Int = DEFAULT_TIMEOUT_MS,
    transport: Transport = Transport { url, t -> httpGet(url, t) },
    nowMs: Long = System.currentTimeMillis(),
  ): LinkStatus.Snapshot {
    val url = healthUrl(hostUrl)
    if (url == null) {
      // 没配对就别探：这不是「离线」，是「还没配对」，两件事不能混。
      LinkStatus.reset()
      return LinkStatus.snapshot()
    }
    LinkStatus.probing(nowMs)
    val raw =
      try {
        transport.get(url, timeoutMs)
      } catch (e: Exception) {
        Raw(null, e.javaClass.simpleName + ": " + (e.message ?: ""))
      }
    val (presence, detail) = LinkStatus.classifyProbe(raw.statusCode, raw.errorName)
    if (presence == LinkStatus.Presence.ONLINE) LinkStatus.online(nowMs) else LinkStatus.offline(detail, nowMs)
    return LinkStatus.snapshot()
  }

  /**
   * 真发一次 GET。只读状态行 —— body 一个字都不读（探活不需要，读它反而可能被
   * 一个慢响应拖住）。`Connection: close` 避免在移动网络上留半开连接。
   */
  fun httpGet(url: String, timeoutMs: Int): Raw {
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = timeoutMs
        readTimeout = timeoutMs
        instanceFollowRedirects = false
        setRequestProperty("Connection", "close")
        // 健康检查不需要内容：HEAD 语义下有些服务端不回状态地直接断，
        // 所以仍然用 GET，只是不读 body。
        doInput = true
      }
      Raw(conn.responseCode, null)
    } catch (e: Exception) {
      Raw(null, e.javaClass.simpleName + ": " + (e.message ?: ""))
    } finally {
      try {
        conn?.disconnect()
      } catch (_: Exception) {
      }
    }
  }
}
