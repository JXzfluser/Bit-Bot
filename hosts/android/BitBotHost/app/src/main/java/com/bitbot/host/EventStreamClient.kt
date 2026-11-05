package com.bitbot.host

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * A1-4: Android 端只读 SSE 订阅 + 进度可见 + 诚实回退。
 *
 * 设计决定（每条都有代价）：
 *  - 只读：只订阅 GET /v1/events，绝不碰 /v1/turn 的请求/响应形状。
 *  - 按 seq 去重：服务端 seq 是全局单调的，客户端也要按 seq 过滤，避免重连后重复。
 *  - Last-Event-ID 续订：断线重连时带上最后收到的 seq，服务端从那里继续。
 *  - 退避重连：1s/2s/4s/8s/10s（封顶），避免打爆服务端。
 *  - 诚实回退：401/503/网络失败/超时 → 退回现有整轮模式，界面明说为什么没实时进度。
 *  - 连接生命周期：turn_ended 或用户离开屏幕时必须关掉连接，不许漏 HTTP 连接/协程。
 *
 * 事件帧格式（来自 hosts/shared/cn_inbound_server.js:988-1026）：
 *   id: <seq>
 *   event: <kind>
 *   data: <json>
 *
 * kind 取值（来自 hosts/shared/turn_event_emitter.js）：
 *   - turn_started: {turn_id, initiator}
 *   - progress: {turn_id, row}
 *   - turn_ended: {turn_id, status, usage?}
 *
 * 鉴权与 /v1/turn 同一套：先看是否登记过设备（deviceStore.devices 非空走设备凭证签名），
 * 否则走共享 bearer turn_token。未鉴权 → 401 {ok:false,error:"unauthorized"}。
 *
 * 事件库不可用（双写开关没开）→ 路由诚实返回 503，error:"event_log_unavailable"。
 * 这时候客户端必须回退，不许静默。
 */
object EventStreamClient {
  /** 一个 SSE 事件。 */
  data class StreamEvent(
    val seq: Long,
    val kind: String,
    val turnId: String?,
    val payload: JSONObject?,
  )

  /** 订阅状态。 */
  enum class SubscriptionState {
    IDLE,           // 未订阅
    CONNECTING,     // 正在连接
    CONNECTED,      // 已连接，正在接收事件
    RECONNECTING,   // 断线重连中
    FALLBACK,       // 回退到整轮模式（SSE 不可用）
    CLOSED,         // 已关闭
  }

  /** 订阅回调。 */
  interface SubscriptionCallback {
    fun onStateChange(state: SubscriptionState, reason: String?)
    fun onEvent(event: StreamEvent)
    fun onFallback(reason: String)  // SSE 不可用，回退到整轮模式
  }

  /** 一个活跃的订阅。 */
  class Subscription internal constructor(
    private val baseUrl: String,
    private val token: String?,
    private val callback: SubscriptionCallback,
    private val sessionId: String? = null,
    initialSeq: Long = 0L,
    /**
     * A2-3：桌面登记过设备之后，事件流这条路也只认设备签名（bearer 不够）。
     * 每次**连接尝试**都要重新签一遍（新 nonce + 新时间戳）—— 重连抄上一次的头
     * 拿到的是 nonce_reused 401，然后按 401 走回退，用户看到的永远是「没有实时进度」。
     * 传 null（没有本地身份 / 老桌面）时行为一字不变：继续只挂 bearer。
     */
    private val identityContext: android.content.Context? = null,
  ) {
    // A1-4: initialSeq —— 用户切走再回来时，上一段已经看到的帧编号要带回来。
    // 不带就会从 0 重放，去重失效，同一批进度行在界面上重复出现。
    private val lastSeq = AtomicLong(initialSeq.coerceAtLeast(0L))
    private val state = AtomicReference(SubscriptionState.IDLE)
    private val closed = AtomicBoolean(false)
    private var connection: HttpURLConnection? = null
    private var reader: BufferedReader? = null
    /** R-A3-5b：走中转时的隧道。`close()` 必须把它一起关掉，否则切后台会漏一条连接。 */
    private var relayTunnel: RelayTunnel.Tunnel? = null

    /** 最后收到的 seq（用于断言与调试）。 */
    fun lastSeq(): Long = lastSeq.get()

    /** 当前状态。 */
    fun currentState(): SubscriptionState = state.get()

    /** 是否已关闭。 */
    fun isClosed(): Boolean = closed.get()

    /** 开始订阅（阻塞调用，应在 IO 线程跑）。 */
    fun start() {
      if (closed.get()) return
      setState(SubscriptionState.CONNECTING, null)

      var retryDelay = 1000L  // 1s
      val maxRetryDelay = 10000L  // 10s

      while (!closed.get()) {
        try {
          connectAndRead()
          // 正常结束（收到 turn_ended 或主动关闭）
          break
        } catch (e: Exception) {
          if (closed.get()) break

          // 判断是否应该回退
          val shouldFallback = shouldFallbackToWholeTurn(e)
          if (shouldFallback) {
            setState(SubscriptionState.FALLBACK, e.message)
            callback.onFallback(fallbackReason(e))
            close()
            break
          }

          // 退避重连
          setState(SubscriptionState.RECONNECTING, e.message)
          try {
            Thread.sleep(retryDelay)
          } catch (ie: InterruptedException) {
            Thread.currentThread().interrupt()
            break
          }
          retryDelay = (retryDelay * 2).coerceAtMost(maxRetryDelay)
        }
      }

      setState(SubscriptionState.CLOSED, null)
    }

    /**
     * 关闭订阅（释放连接与协程）。
     *
     * A1-4: 拆解必须离开调用线程。真机上 close() 是界面线程调的（ON_STOP、
     * turn_ended），而另一条线程正阻塞在同一条流的 readLine() 上 ——
     * `BufferedReader.close()` 要拿这把读锁，于是界面线程一直等到流自己结束，
     * 用户看到的就是「切后台再回来 app 冻住」。这里不是推测：Robolectric 跑
     * TurnInFlightRecreationTest 时 main 线程实测卡在
     * BufferedReader.close → ReentrantLock.lock（EventStreamClient.kt:134）。
     * 现在只置标志 + 摘引用（原子、不阻塞），socket 交给一条守护线程关。
     */
    fun close() {
      if (closed.getAndSet(true)) return
      val rdr = reader
      val conn = connection
      val tunnel = relayTunnel
      reader = null
      connection = null
      relayTunnel = null
      Thread {
        runCatching { conn?.disconnect() }
        // R-A3-5b：走中转的那条订阅没有 HttpURLConnection，只有一条裸 socket ——
        // 不关它就会在切后台之后一直挂着（用户看到的是「回来之后进度还是上次的」）。
        runCatching { tunnel?.let { RelayTunnel.closeQuietly(it.socket) } }
        // disconnect 之后 socket 已断，阻塞中的 read 会拿到 EOF/异常并退出；
        // 再关 reader 收尾（它可能仍在等那把锁）。
        runCatching { rdr?.close() }
      }.apply { isDaemon = true }.start()
    }

    private fun connectAndRead() {
      // 构造 URL：优先 Last-Event-ID 请求头，其次 ?from_seq=（服务端 :1004-1007 两个都认）。
      // A1-4: 再带 ?session_id= —— 服务端 :1009 起支持，只解决「看得见谁的帧」，
      // 不解决「谁有权订」（那是 W3 的设备授权边界）。
      val qs = ArrayList<String>(2)
      if (lastSeq.get() > 0) qs.add("from_seq=" + lastSeq.get())
      sessionId?.takeIf { it.isNotEmpty() }?.let {
        qs.add("session_id=" + URLEncoder.encode(it, "UTF-8"))
      }
      val path = "/v1/events" + (if (qs.isEmpty()) "" else "?" + qs.joinToString("&"))
      val urlStr = baseUrl + path

      // 每次连接尝试都现签：GET 没有请求体，签的就是「deviceId\nts\nnonce\n」这三行前缀
      // （服务端把空 body 直接拼进去，见 device_keys.js:signingPayload）。
      // 放在循环里而不是外面，是因为 nonce 用第二次就是 nonce_reused —— 401 之后走回退，
      // 用户看到的是「一直没有实时进度」，而日志里只有一条看不懂的码。
      val deviceHeaders = DeviceIdentity.requestHeaders(identityContext, ByteArray(0))

      // R-A3-5b：**直连优先，跨网回落隧道**。
      // 直连失败有两种，处理完全不同：
      //  · 传输层失败（连接被拒/超时）⇒ 说明手机不在同一局域网，这正是中转存在的理由，回落；
      //  · 桌面给了权威答复（401/503/其他 HTTP 码）⇒ 走中转也是同一句，回落只会把
      //    「凭证不对」拖成几十秒超时后再报同一件事，所以直接抛。
      var directErr: Exception? = null
      try {
        readViaDirect(urlStr, deviceHeaders)
        return
      } catch (e: SseUnauthorizedException) {
        throw e
      } catch (e: SseUnavailableException) {
        throw e
      } catch (e: SseHttpException) {
        throw e
      } catch (e: Exception) {
        directErr = e
      }

      val cfg = TurnBridge.relayConfig()
      if (cfg == null) throw directErr ?: IllegalStateException("直连失败且没有配中转")
      readViaRelay(cfg, path, deviceHeaders)
    }

    /** 老那条直连路径，行为一字未改（抽出来只为让跨网回落有个明确的接缝）。 */
    private fun readViaDirect(urlStr: String, deviceHeaders: DeviceRequestHeaders?) {
      val url = URL(urlStr)
      val conn = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 15000
        readTimeout = 0  // SSE 长连接，不设读超时
        doInput = true
        setRequestProperty("Accept", "text/event-stream")
        setRequestProperty("Cache-Control", "no-cache")
        if (lastSeq.get() > 0) {
          setRequestProperty("Last-Event-ID", lastSeq.get().toString())
        }
        token?.let { setRequestProperty("Authorization", "Bearer $it") }
        DeviceIdentity.applyHeaders({ k, v -> setRequestProperty(k, v) }, deviceHeaders)
      }

      this.connection = conn
      val code = conn.responseCode

      // 503 事件库不可用 → 诚实回退
      if (code == 503) {
        val body = try {
          BufferedReader(InputStreamReader(conn.errorStream, Charsets.UTF_8)).use { it.readText() }
        } catch (_: Exception) { "" }
        conn.disconnect()
        throw SseUnavailableException("event_log_unavailable", body)
      }

      // 401 未鉴权 → 回退
      if (code == 401) {
        val body = try {
          BufferedReader(InputStreamReader(conn.errorStream, Charsets.UTF_8)).use { it.readText() }
        } catch (_: Exception) { "" }
        conn.disconnect()
        throw SseUnauthorizedException("unauthorized", body)
      }

      // 其他非 200 → 回退
      if (code !in 200..299) {
        val body = try {
          BufferedReader(InputStreamReader(conn.errorStream, Charsets.UTF_8)).use { it.readText() }
        } catch (_: Exception) { "" }
        conn.disconnect()
        throw SseHttpException(code, body)
      }

      // 200 OK，开始读 SSE 流
      setState(SubscriptionState.CONNECTED, null)
      val rdr = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
      this.reader = rdr

      parseSseStream(rdr)
    }

    /**
     * R-A3-5b：**事件流走 relay 隧道**。
     *
     * 这条以前不存在，于是跨网时「回合能发出去、进度永远看不到」—— 界面看起来像卡死。
     * 隧道是 TCP 透传，所以在上面跑 GET + chunked 与局域网里没有区别；
     * 关键只在 [TunnelHttp.openEventStream] 要**惰性**解 chunked，否则要等到
     * 整条流结束才看得到第一帧（那就不是实时进度了）。
     *
     * 生命周期：隧道**不还池**。事件流是长连接，借出去就要等这条流自己结束
     * （turn_ended / 用户离开）。还池了下一回合会拿到一条还挂着上一个订阅的连接。
     */
    private fun readViaRelay(
      cfg: RelayTunnel.RelayConfig,
      path: String,
      deviceHeaders: DeviceRequestHeaders?,
    ) {
      val tunnel =
        try {
          RelayTunnel.open(cfg)
        } catch (e: RelayTunnel.OpenFailure) {
          throw SseTransportException(e.userMessage, e)
        }
      this.relayTunnel = tunnel
      val headers = buildList {
        add("Accept" to "text/event-stream")
        add("Cache-Control" to "no-cache")
        if (lastSeq.get() > 0) add("Last-Event-ID" to lastSeq.get().toString())
        token?.let { add("Authorization" to "Bearer $it") }
        DeviceIdentity.applyHeaders({ k, v -> add(k to v) }, deviceHeaders)
      }
      val resp =
        try {
          TunnelHttp.openEventStream(
            tunnel = tunnel,
            path = path,
            hostHeader = cfg.host,
            headers = headers,
            // 0 = 不限：SSE 本来就是等服务端推，设了超时会在安静的时候被误判成断线。
            readTimeoutMs = 0,
          )
        } catch (e: Exception) {
          RelayTunnel.closeQuietly(tunnel.socket)
          this.relayTunnel = null
          throw SseTransportException(e.message ?: "隧道上没有回包", e)
        }
      if (resp.status == 503) {
        RelayTunnel.closeQuietly(tunnel.socket)
        throw SseUnavailableException("event_log_unavailable", "")
      }
      if (resp.status == 401) {
        RelayTunnel.closeQuietly(tunnel.socket)
        throw SseUnauthorizedException("unauthorized", "")
      }
      if (resp.status !in 200..299) {
        RelayTunnel.closeQuietly(tunnel.socket)
        throw SseHttpException(resp.status, "")
      }
      setState(SubscriptionState.CONNECTED, null)
      this.reader = resp.reader
      parseSseStream(resp.reader)
    }

    /**
     * 解析 SSE 流。
     *
     * 帧格式（来自 cn_inbound_server.js:1010-1024）：
     *   id: <seq>
     *   event: <kind>
     *   data: <json>
     *   <blank line>
     *
     * A1-4: 这里是 `internal` 而不是 `private` —— 上一版的「解析测试」根本没调用它，
     * 而是自己 new 一个 StreamEvent 再断言它等于自己刚塞进去的值，恒真。
     * 开放给同模块单测，让真正被跑的代码被真正测到。
     */
    internal fun parseSseStream(rdr: BufferedReader) {
      var currentId: Long? = null
      var currentEvent: String? = null
      var currentData: StringBuilder? = null

      while (!closed.get()) {
        val line = rdr.readLine() ?: break  // EOF

        if (line.isEmpty()) {
          // 空行 = 帧结束
          if (currentId != null && currentEvent != null && currentData != null) {
            val event = parseEvent(currentId, currentEvent, currentData.toString())
            if (event != null) {
              // 按 seq 去重：只处理比 lastSeq 大的
              if (event.seq > lastSeq.get()) {
                lastSeq.set(event.seq)
                callback.onEvent(event)

                // turn_ended → 回合结束，关闭连接
                if (event.kind == "turn_ended") {
                  close()
                  return
                }
              }
            }
          }
          currentId = null
          currentEvent = null
          currentData = null
        } else if (line.startsWith("id:")) {
          currentId = line.substring(3).trim().toLongOrNull()
        } else if (line.startsWith("event:")) {
          currentEvent = line.substring(6).trim()
        } else if (line.startsWith("data:")) {
          if (currentData == null) currentData = StringBuilder()
          else currentData.append("\n")
          currentData.append(line.substring(5))
        } else if (line.startsWith(":")) {
          // 注释行（心跳），忽略
        }
      }
    }

    private fun parseEvent(id: Long, kind: String, data: String): StreamEvent? {
      return try {
        val obj = JSONObject(data)
        val turnId = obj.optString("turnId", null)
        val payload = obj.optJSONObject("payload")
        StreamEvent(id, kind, turnId, payload)
      } catch (_: Exception) {
        null
      }
    }

    private fun shouldFallbackToWholeTurn(e: Exception): Boolean {
      return e is SseUnavailableException ||
        e is SseUnauthorizedException ||
        (e is SseHttpException && e.code in listOf(401, 503))
      // R-A3-5b：SseTransportException **不算**该回退 —— 它说的是「这一条路没通」，
      // 而回退是把实时进度彻底关掉。跨网抖动几十秒就永久降级成整轮模式，
      // 用户会以为「跨网就是没有进度」，其实再连一次就好了。让它走退避重连。
    }

    private fun fallbackReason(e: Exception): String {
      return when (e) {
        is SseUnavailableException -> "event_stream_unavailable"
        is SseUnauthorizedException -> "event_stream_unauthorized"
        is SseHttpException -> "event_stream_http_${e.code}"
        // 跨网失败要说清楚是「中转这条路」，否则用户分不清是桌面没开会话还是手机没网。
        is SseTransportException -> "event_stream_transport"
        else -> "event_stream_error"
      }
    }

    private fun setState(newState: SubscriptionState, reason: String?) {
      state.set(newState)
      callback.onStateChange(newState, reason)
    }
  }

  /** SSE 不可用（503）。 */
  class SseUnavailableException(val error: String, body: String) :
    Exception("SSE unavailable: $error, body=$body")

  /** SSE 未鉴权（401）。 */
  class SseUnauthorizedException(val error: String, body: String) :
    Exception("SSE unauthorized: $error, body=$body")

  /** SSE HTTP 错误。 */
  class SseHttpException(val code: Int, body: String) :
    Exception("SSE HTTP $code, body=$body")

  /**
   * R-A3-5b：这一条**传输路**没通（直连断、或中转隧道打不开）。
   *
   * 与上面三种刻意分开：那三种是桌面给的权威答复（凭据不对/事件库没开），
   * 换条路重试也是同一句；这一种只是「这次没连上」，应该退避重连而不是
   * 把实时进度永久降级成整轮模式。
   */
  class SseTransportException(message: String, cause: Throwable? = null) :
    Exception(message, cause)

  /** 创建订阅（不启动）。 */
  fun createSubscription(
    baseUrl: String,
    token: String?,
    callback: SubscriptionCallback,
    sessionId: String? = null,
    initialSeq: Long = 0L,
    identityContext: android.content.Context? = null,
  ): Subscription {
    return Subscription(baseUrl, token, callback, sessionId, initialSeq, identityContext)
  }
}
