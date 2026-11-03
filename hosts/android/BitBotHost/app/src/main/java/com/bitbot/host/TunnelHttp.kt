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
  ): String {
    val sb = StringBuilder()
    sb.append("POST ").append(path).append(" HTTP/1.1\r\n")
    sb.append("Host: ").append(hostHeader).append("\r\n")
    sb.append("Connection: close\r\n")
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
   */
  fun post(
    tunnel: RelayTunnel.Tunnel,
    path: String,
    hostHeader: String,
    headers: List<Pair<String, String>>,
    body: ByteArray,
    readTimeoutMs: Int = 120000,
  ): Response {
    // A3-5 修复前：这一层还没有实现（门禁 RT-07/RT-08 真红）。
    throw UnsupportedOperationException("A3-5 未实现：隧道上的 HTTP 请求/响应")
  }

  /* ------------------------------------------------------------ 内部 */

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
