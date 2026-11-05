package com.bitbot.host

import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import org.json.JSONObject

/**
 * A3-5 中转（relay）传输层 —— 手机这一侧的客户端（残留 R-A3-3a）。
 *
 * 为什么需要这个文件：中继服务端 A3-1/A3-2 早已交付（`hosts/shared/relay/relay_server.js`，
 * 含「内容不可见」的审计日志实证），但**端上没有客户端**。于是手机离开同一局域网就连不上
 * —— `DesktopPairing.scanForDesktops` 只枚举同 /24 网段、`redeemCode` 只 POST 局域网地址，
 * 跨网这件事在产品里根本没有路径。本文件补的就是缺的那一半。
 *
 * 线协议逐字对齐 relay（`relay_server.js:141-199` handleControl）：
 *   →  AUTH <token>\n          中继校验成员凭证（relay_keys，角色 client）
 *   ←  OK\n                  / DENY\n（凭证不对，或未鉴权就发命令）
 *   →  CONNECT <boxId>\n       要一条到某台桌面的隧道
 *   ←  TUNNEL <host:port>\n   / NOBOX\n（这台机没在中继上登记）/ BADCMD\n
 *   之后这条 socket 就是**端到端不透明的字节流**，由 [TunnelHttp] 在上面跑 HTTP。
 *
 * 刻意不做的事（与中继那侧同一口径）：
 *  - 不解析数据面内容、不缓存、不落盘；
 *  - 不把「凭证错了」说成「网络不好」—— 五种失败各有各的人话（[OpenFailure]）。
 *
 * 这个 object **不引用任何 Android 类**：它跑在普通 JVM 单测里（真 ServerSocket 假中继），
 * 不需要 emulator，也不需要真机就能红绿。
 */
object RelayTunnel {

  /** 一整套中转参数：四栏齐了才算配好。 */
  data class RelayConfig(
    val host: String,
    val port: Int,
    val token: String,
    val boxId: String,
  ) {
    val complete: Boolean
      get() = host.isNotBlank() && port in 1..65535 && token.isNotBlank() && boxId.isNotBlank()

    /** 只用于显示/日志，不含 token。 */
    val endpoint: String get() = "$host:$port"
  }

  /**
   * 打开隧道失败。每一种都带一句能直接贴到界面上的话 ——
   * 「中转不认凭证」和「连不上中转」是两件事，混成一句用户就只能瞎试。
   */
  sealed class OpenFailure(val userMessage: String) : Exception(userMessage) {
    /** 四栏没配齐：这时候不该去连，先让用户把凭证填完。 */
    object NotConfigured : OpenFailure("还没配中转：手机离开同一个 Wi-Fi 就连不上桌面")

    /** 中继回 DENY：凭证不对，或未鉴权就发了命令。 */
    object Denied : OpenFailure("中转不认这个凭证（DENY）：去桌面重新复制一次中转凭证")

    /** 中继回 NOBOX：这台桌面没在中继上登记。 */
    object BoxNotRegistered : OpenFailure("中转上没有这台桌面（NOBOX）：桌面那边要先接入同一个中转并完成登记")

    /** 中继回 BADCMD（或认不得的应答）：两端版本对不上。 */
    object BadCommand : OpenFailure("中转听不懂这条命令（BADCMD）：中转与手机的协议版本可能不一致")

    /** 传输层没通：DNS/拒绝/超时。 */
    data class Transport(val reason: String) : OpenFailure("连不上中转：$reason")
  }

  /** 一条已建立的隧道：socket 已进入数据面，[boxEndpoint] 只是中继告知的目标，信息用。 */
  data class Tunnel(val socket: Socket, val boxEndpoint: String) : java.io.Closeable {
    override fun close() = closeQuietly(socket)

    /**
     * 独占这条隧道的整段生命周期：**不论正常结束还是抛异常，都必须关掉**。
     *
     * 只给「借出去就不还池」的那类场景用（事件流长连接）。池子里的短请求不要用它 ——
     * 那些走 `RelayTunnelPool.borrow/release`，归还而不是关闭。
     *
     * 为什么要有这个原语，而不是每处自己写 try/finally：这个坑已经踩过一次。
     * `EventStreamClient.readViaRelay` 原来是「开 → 存字段 → 读流」，读流抛异常时
     * 异常直接冒到重试循环，那条 socket 既没还池也没关；重连一次就多一条，
     * 中继上于是挂着一条永远不会有数据的连接。**管住归属，而不是管住某一条路径。**
     *
     * 与 `close()` 并发是安全的：关一个已关的 socket 不抛，所以界面线程调 `close()`
     * 和这里 `finally` 撞车也不要紧。
     */
    fun <T> withOwnership(block: (Tunnel) -> T): T =
      try {
        block(this)
      } finally {
        close()
      }
  }

  sealed class AuthReply {
    object Ok : AuthReply()
    object Denied : AuthReply()
    data class Unknown(val raw: String) : AuthReply()
  }

  sealed class ConnectReply {
    data class Tunneled(val endpoint: String) : ConnectReply()
    object NoBox : ConnectReply()
    object BadCmd : ConnectReply()
    data class Unknown(val raw: String) : ConnectReply()
  }

  /* ------------------------------------------------------------ 纯逻辑（可单测） */

  fun authLine(token: String): String = "AUTH " + token.trim()

  fun connectLine(boxId: String): String = "CONNECT " + boxId.trim()

  /**
   * 四栏 → 配置。任何一栏缺失/非法都回 null（不猜、不补默认值）——
   * 猜出来的中转地址只会让用户在「连不上」和「凭证不对」之间来回试。
   */
  fun parseConfig(host: String?, port: Int?, token: String?, boxId: String?): RelayConfig? {
    val h = host?.trim().orEmpty()
    val p = port ?: return null
    val t = token?.trim().orEmpty()
    val b = boxId?.trim().orEmpty()
    if (h.isEmpty() || p !in 1..65535 || t.isEmpty() || b.isEmpty()) return null
    return RelayConfig(host = h, port = p, token = t, boxId = b)
  }

  fun parseAuthReply(line: String?): AuthReply =
    when (line?.trim().orEmpty()) {
      "OK" -> AuthReply.Ok
      "DENY" -> AuthReply.Denied
      else -> AuthReply.Unknown(line?.trim().orEmpty())
    }

  fun parseConnectReply(line: String?): ConnectReply {
    val v = line?.trim().orEmpty()
    if (v == "NOBOX") return ConnectReply.NoBox
    if (v == "BADCMD") return ConnectReply.BadCmd
    if (v.startsWith("TUNNEL ")) {
      val ep = v.removePrefix("TUNNEL ").trim()
      if (ep.isNotEmpty()) return ConnectReply.Tunneled(ep)
    }
    return ConnectReply.Unknown(v)
  }

  /**
   * A3-6：从**配对回执**里认中转四栏（桌面在 `redeem` 成功回执里下发，见
   * `cn_inbound_server.js` 的 `currentRelayHandoff`）。
   *
   * 三种输入三种结果，一个都不许猜：
   *  - 桌面没配中转 → 回执里**没有** `relay` 键 → null（跨网这条路就是不存在，不是「可能配错」）；
   *  - 有 `relay` 但四栏不齐（老桌面/写坏了）→ 也回 null。给一半比不给更坏：拿半套去连，
   *    用户看到的是一个查不出来的错；
   *  - 回包不是 JSON / 解析炸了 → null，不抛。
   */
  fun parseRelayHandoff(body: String?): RelayConfig? {
    val text = body?.trim().orEmpty()
    if (text.isEmpty()) return null
    return try {
      val relay = JSONObject(text).optJSONObject("relay") ?: return null
      parseConfig(
        relay.optString("host", ""),
        relay.optInt("port", 0),
        relay.optString("client_token", ""),
        relay.optString("box_id", ""),
      )
    } catch (_: Exception) {
      null
    }
  }

  /* ------------------------------------------------------------ 真连接 */

  /**
   * 连中继 → 鉴权 → 要隧道。成功后返回的 socket 已在数据面（soTimeout 归 0，交给 HTTP 读超时管）。
   * 失败时一律关掉 socket 再抛 —— 不留半开连接。
   */
  fun open(
    config: RelayConfig?,
    connectTimeoutMs: Int = 8000,
    replyTimeoutMs: Int = 8000,
  ): Tunnel {
    if (config == null || !config.complete) throw OpenFailure.NotConfigured
    val socket = Socket()
    try {
      socket.connect(InetSocketAddress(config.host, config.port), connectTimeoutMs)
      // 控制面是**行协议**，每条应答都必须有上限：不设 soTimeout 时中继一旦不回话，
      // 界面就永远停在「连接中」—— 那比报错更坏。
      socket.soTimeout = replyTimeoutMs
      val out = socket.getOutputStream()
      val inp = socket.getInputStream()

      sendLine(out, authLine(config.token))
      // 认不得的应答一律按拒绝处理：把 Unknown 当 OK，等于跳过凭证校验。
      if (parseAuthReply(readLine(inp)) !is AuthReply.Ok) throw OpenFailure.Denied

      sendLine(out, connectLine(config.boxId))
      when (val reply = parseConnectReply(readLine(inp))) {
        is ConnectReply.Tunneled -> {
          // 进入数据面：控制面的超时到此为止，之后的长短由 HTTP 自己管
          // （/v1/turn 可能跑几十秒，用 8 秒的连接超时去卡它会把正常回合掐死）。
          socket.soTimeout = 0
          return Tunnel(socket, reply.endpoint)
        }
        is ConnectReply.NoBox -> throw OpenFailure.BoxNotRegistered
        else -> throw OpenFailure.BadCommand
      }
    } catch (e: OpenFailure) {
      closeQuietly(socket)
      throw e
    } catch (e: Exception) {
      closeQuietly(socket)
      throw OpenFailure.Transport(e.message ?: e.javaClass.simpleName)
    }
  }

  /* ------------------------------------------------------------ 内部 */

  internal fun sendLine(out: OutputStream, line: String) {
    out.write((line + "\n").toByteArray(Charsets.ISO_8859_1))
    out.flush()
  }

  /**
   * 逐字节读到 `\n`（去掉 `\r`）。中继的控制面是**行协议**，用带缓冲的 Reader 去读会
   * 把紧随 `TUNNEL` 之后的数据面首字节一起吞进缓冲区 —— 那正是「握手成功但消息不通」的经典坑。
   * 这里只读必需的那几个字节。
   */
  internal fun readLine(input: InputStream): String? {
    val sb = StringBuilder()
    while (true) {
      val b = input.read()
      if (b < 0) return if (sb.isEmpty()) null else sb.toString()
      if (b == '\n'.code) return sb.toString()
      if (b != '\r'.code) sb.append(b.toChar())
      if (sb.length > 4096) return sb.toString()
    }
  }

  internal fun closeQuietly(socket: Socket?) {
    try {
      socket?.close()
    } catch (_: Exception) {
    }
  }
}
