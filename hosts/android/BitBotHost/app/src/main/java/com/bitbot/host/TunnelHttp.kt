package com.bitbot.host

import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * A3-5 在隧道上跑 HTTP/1.1。
 *
 * 为什么非要自己写一个极小的 HTTP 客户端：中继是**TCP 透传**（relay 只看得到字节数，
 * 看不到内容）。手机上的 `HttpURLConnection` 只认 Host/端口，不会把请求塞进一条现成的
 * socket 里；要让 `/v1/turn` 走隧道，就得自己在 socket 上写请求行/头/体，再把响应读回来。
 *
 * 只做这件事需要的最小集合（不追求做一个通用 HTTP 库）：
 *  - 请求：`POST <path> HTTP/1.1` + `Host` + `Content-Length` + `Connection: close` + 调用方头；
 *  - 响应：状态行 → 头 → 体，体按 `Transfer-Encoding: chunked` / `Content-Length` / 读到 EOF
 *    三种情形分别处理（桌面的 `/v1/turn` 是定长 JSON，事件流是 chunked）。
 *
 * 这个 object **不引用任何 Android 类**，纯 JVM 单测里配一个假 box 就能红绿。
 */
object TunnelHttp {

  /** 一次响应。body 按 UTF-8 解码（桌面的回包全是 JSON）。 */
  data class Response(
    val status: Int,
    val body: String,
    val headers: Map<String, String>,
  )

  /* ------------------------------------------------------------ 纯逻辑（可单测） */

  /** `HTTP/1.1 200 OK` → 200；认不得回 null（不猜）。 */
  fun parseStatusLine(line: String?): Int? {
    val v = line?.trim().orEmpty()
    if (!v.startsWith("HTTP/")) return null
    val parts = v.split(" ")
    if (parts.size < 2) return null
    val code = parts[1].trim().toIntOrNull() ?: return null
    return if (code in 100..599) code else null
  }

  /** 头名一律小写，值 trim；没有 `:` 的行丢弃（不编造）。 */
  fun parseHeaderLines(lines: List<String>): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    for (raw in lines) {
      val line = raw.trim()
      if (line.isEmpty()) continue
      val idx = line.indexOf(':')
      if (idx <= 0) continue
      val k = line.substring(0, idx).trim().lowercase()
      val v = line.substring(idx + 1).trim()
      if (k.isEmpty()) continue
      out[k] = if (out.containsKey(k)) out[k] + ", " + v else v
    }
    return out
  }

  /**
   * 请求头拼装。[contentLength] 与 [hostHeader] 由传输层自己算，
   * 调用方传进来的同名头一律忽略 —— 否则签名算的字节数和实际发的对不上（真机就是一条 bad_signature）。
   */
  fun buildRequestHead(
    path: String,
    hostHeader: String,
    headers: List<Pair<String, String>>,
    contentLength: Int,
    keepAlive: Boolean = false,
  ): String {
    val sb = StringBuilder()
    sb.append("POST ").append(path).append(" HTTP/1.1\r\n")
    sb.append("Host: ").append(hostHeader).append("\r\n")
    // R-A3-6b/5c：默认仍然 `close`（与 relay「一 CONNECT 一隧道」的老模型一致）；
    // 走隧道池时传 keepAlive=true，这条连接就要留给下一回合复用。
    sb.append("Connection: ").append(if (keepAlive) "keep-alive" else "close").append("\r\n")
    sb.append("Content-Length: ").append(contentLength).append("\r\n")
    for ((k, v) in headers) {
      val lower = k.trim().lowercase()
      if (lower == "host" || lower == "content-length" || lower == "connection") continue
      if (lower.isEmpty()) continue
      sb.append(k.trim()).append(": ").append(v).append("\r\n")
    }
    sb.append("\r\n")
    return sb.toString()
  }

  /**
   * R-A3-5b：**GET** 的请求头 —— 事件流（SSE）走隧道要用。
   *
   * 与 POST 那份分开写而不是加个 method 参数：SSE 没有请求体、不要 Content-Length，
   * 而且必须显式 `Accept: text/event-stream`，否则桌面那边会按普通请求回一个 JSON 就断。
   */
  fun buildGetHead(
    path: String,
    hostHeader: String,
    headers: List<Pair<String, String>>,
  ): String {
    val sb = StringBuilder()
    sb.append("GET ").append(path).append(" HTTP/1.1\r\n")
    sb.append("Host: ").append(hostHeader).append("\r\n")
    // 长连接：事件流本来就要持续读，写 close 会在服务端发完第一帧后就准备断开。
    sb.append("Connection: keep-alive\r\n")
    var hasAccept = false
    for ((k, v) in headers) {
      val lower = k.trim().lowercase()
      if (lower == "host" || lower == "content-length" || lower == "connection") continue
      if (lower.isEmpty()) continue
      if (lower == "accept") hasAccept = true
      sb.append(k.trim()).append(": ").append(v).append("\r\n")
    }
    if (!hasAccept) sb.append("Accept: text/event-stream\r\n")
    sb.append("\r\n")
    return sb.toString()
  }

  /** 读响应体：chunked → 定长 → 读到 EOF。三者都不猜，按头来。 */
  fun readBody(input: InputStream, headers: Map<String, String>): ByteArray {
    val te = headers["transfer-encoding"]?.lowercase().orEmpty()
    if (te.contains("chunked")) return readChunked(input)
    val declared = headers["content-length"]?.trim()?.toIntOrNull()
    if (declared != null && declared >= 0) return readExact(input, declared)
    return input.readBytes()
  }

  /* ------------------------------------------------------------ 发送 */

  /**
   * 在隧道上发一次 POST 并读完响应。socket 用完由调用方关（这条隧道一次请求一条，
   * 与 relay 的「一 CONNECT 一隧道」模型一致）。
   *
   * @param keepAlive true = 这条隧道之后还会被复用（[RelayTunnelPool]），
   *                  此时请求头写 keep-alive，且**不能**读完就关。
   */
  fun post(
    tunnel: RelayTunnel.Tunnel,
    path: String,
    hostHeader: String,
    headers: List<Pair<String, String>>,
    body: ByteArray,
    readTimeoutMs: Int = 120000,
    keepAlive: Boolean = false,
  ): Response {
    val socket = tunnel.socket
    // 桌面回包可能很慢（一个回合几十秒），但必须有上限：不然隧道断了就是无限等。
    socket.soTimeout = readTimeoutMs
    val out = socket.getOutputStream()
    val inp = socket.getInputStream()

    out.write(
      buildRequestHead(path, hostHeader, headers, body.size, keepAlive).toByteArray(Charsets.ISO_8859_1),
    )
    if (body.isNotEmpty()) out.write(body)
    out.flush()

    var statusLine: String? = RelayTunnel.readLine(inp)
    // 复用连接时，上一回合若刚好把响应读干净、服务端却已经决定关闭，这里会拿到 null。
    // 抛一个**可识别**的异常让池子丢掉这条隧道并重开 —— 不抛的话，
    // 用户看到的会是「每隔一回合失败一次」这种查不出来的抖动。
    if (statusLine == null && keepAlive) {
      throw StaleTunnelException("复用的隧道已被对端关闭")
    }
    if (statusLine == null) throw IllegalStateException("隧道上没有回包（中转或桌面把连接关了）")
    val status =
      parseStatusLine(statusLine) ?: throw IllegalStateException("回包状态行读不出来：$statusLine")

    val headerLines = ArrayList<String>()
    while (true) {
      val line = RelayTunnel.readLine(inp) ?: break
      if (line.isEmpty()) break
      headerLines += line
    }
    val parsed = parseHeaderLines(headerLines)
    val bytes = readBody(inp, parsed)
    return Response(status, String(bytes, Charsets.UTF_8), parsed)
  }

  /**
   * R-A3-5b：在隧道上开一条**流式**响应 —— 事件流用。
   *
   * 与 [post] 的区别只在最后一步：不把 body 读完，而是把 reader 交出去让调用方逐行读。
   * chunked 交给 [ChunkedInputStream] 惰性解码 —— 一次性 readBytes 会把 SSE 变成
   * 「等到连接关闭才看到第一帧」，那就不是实时进度了。
   */
  fun openEventStream(
    tunnel: RelayTunnel.Tunnel,
    path: String,
    hostHeader: String,
    headers: List<Pair<String, String>>,
    readTimeoutMs: Int = 0,
  ): StreamResponse {
    val socket = tunnel.socket
    socket.soTimeout = readTimeoutMs
    val out = socket.getOutputStream()
    val inp = socket.getInputStream()

    out.write(buildGetHead(path, hostHeader, headers).toByteArray(Charsets.ISO_8859_1))
    out.flush()

    val statusLine = RelayTunnel.readLine(inp)
      ?: throw IllegalStateException("隧道上没有回包（中转或桌面把连接关了）")
    val status = parseStatusLine(statusLine)
      ?: throw IllegalStateException("回包状态行读不出来：$statusLine")

    val headerLines = ArrayList<String>()
    while (true) {
      val line = RelayTunnel.readLine(inp) ?: break
      if (line.isEmpty()) break
      headerLines += line
    }
    val parsed = parseHeaderLines(headerLines)
    val te = parsed["transfer-encoding"]?.lowercase().orEmpty()
    val body: InputStream =
      if (te.contains("chunked")) ChunkedInputStream(inp) else inp
    return StreamResponse(status, parsed, java.io.BufferedReader(java.io.InputStreamReader(body, Charsets.UTF_8)))
  }

  /** 一条打开的流式响应。调用方负责 close（脚本是关 socket）。 */
  data class StreamResponse(
    val status: Int,
    val headers: Map<String, String>,
    val reader: java.io.BufferedReader,
  )

  /** 复用隧道时发现对端已关：池子据此丢弃它并新建一条，不是用户可见的错误。 */
  class StaleTunnelException(message: String) : Exception(message)

  /* ------------------------------------------------------------ 内部 */

  /**
   * 惰性 chunked 解码。**只解到这个位置为止** —— SSE 的价值在于「来一帧看一帧」，
   * 一次性把流读完等于把实时进度变成「结束后一次性出现」。
   */
  internal class ChunkedInputStream(private val src: InputStream) : InputStream() {
    private var left = 0          // 当前 chunk 还剩多少字节
    private var done = false
    private var started = false    // 是否已经读过第一个 chunk 头

    private fun nextChunk(): Boolean {
      if (done) return false
      if (started && left == 0) {
        // 吃掉上一块结尾的 CRLF
        RelayTunnel.readLine(src)
      }
      started = true
      val sizeLine = RelayTunnel.readLine(src) ?: run { done = true; return false }
      val size = sizeLine.trim().split(";")[0].trim().toIntOrNull(16) ?: run { done = true; return false }
      if (size == 0) {
        // trailer（可能没有），空行结束
        while (true) {
          val t = RelayTunnel.readLine(src) ?: break
          if (t.isEmpty()) break
        }
        done = true
        return false
      }
      left = size
      return true
    }

    override fun read(): Int {
      val one = ByteArray(1)
      val n = read(one, 0, 1)
      return if (n <= 0) -1 else (one[0].toInt() and 0xFF)
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (len == 0) return 0
      while (left == 0) {
        if (!nextChunk()) return -1
      }
      val n = src.read(b, off, minOf(len, left))
      if (n < 0) return -1
      left -= n
      return n
    }
  }

  internal fun readExact(input: InputStream, len: Int): ByteArray {
    val buf = ByteArrayOutputStream(len.coerceAtLeast(0))
    val chunk = ByteArray(4096)
    var left = len
    while (left > 0) {
      val n = input.read(chunk, 0, minOf(chunk.size, left))
      if (n < 0) break
      buf.write(chunk, 0, n)
      left -= n
    }
    return buf.toByteArray()
  }

  internal fun readChunked(input: InputStream): ByteArray {
    val out = ByteArrayOutputStream()
    while (true) {
      val sizeLine = RelayTunnel.readLine(input) ?: break
      val size = sizeLine.trim().split(";")[0].trim().toIntOrNull(16) ?: break
      if (size == 0) {
        // 吃掉 trailer（可能没有），空行结束
        while (true) {
          val t = RelayTunnel.readLine(input) ?: break
          if (t.isEmpty()) break
        }
        break
      }
      out.write(readExact(input, size))
      RelayTunnel.readLine(input) // 每块后面那个 CRLF
    }
    return out.toByteArray()
  }
}
