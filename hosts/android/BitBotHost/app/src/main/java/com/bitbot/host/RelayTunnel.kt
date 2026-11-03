package com.bitbot.host

import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket

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
    // A3-5 修复前：这一层还没有实现（门禁 RT-04..RT-08 真红）。
    throw UnsupportedOperationException("A3-5 未实现：中转隧道握手（AUTH/CONNECT/TUNNEL）")
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
