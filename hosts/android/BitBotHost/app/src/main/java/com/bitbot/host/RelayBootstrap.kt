package com.bitbot.host

/**
 * A3-18：**跨网配对串** —— 让手机不用先连同一个 Wi-Fi 就能配对。
 *
 * 现场的死结：`redeemCode` 只 POST 局域网地址（`DesktopPairing.redeemCode` 拼的是
 * `http://<ip>:18765/v1/pair/redeem`），而配对回执里那四栏中转参数**只有在配对成功之后**
 * 才会下发。于是「手机在蜂窝网下配对」这件事在结构上不可能完成 ——
 * 必须先回同一个 Wi-Fi 配一次，才拿得到跨网参数。R-A3-6a 记的就是这一条。
 *
 * 破法：让桌面把中转四栏**提前**交给用户，以一段可复制的字符串形式（就是这里）。
 * 手机粘一次，之后 redeem 走 relay 隧道（`DesktopPairing.redeemCodeViaRelay`），
 * 全程不需要同一网段。
 *
 * 形状（有意做成单行、无空格、可直接微信/隔空投送传）：
 *
 * ```
 * bitbot-relay://v1?h=<relayHost>&p=<relayPort>&b=<boxId>&t=<clientToken>
 * ```
 *
 * 三个刻意的决定：
 *  1. **只带 client_token，绝不带 box_token**：box 那把是桌面自己向 relay 登记用的，
 *     给了手机等于把「我可以冒充这台桌面」交出去（`toHandoff` 也一直遵守这条）。
 *  2. **解析失败一律回 null**，不猜、不补默认值。半套参数拿去连只会让用户
 *     在「连不上中转」和「凭证不对」之间瞎试。
 *  3. **不做长度校验以外的校验**：relay 主机可能是域名也可能是 IP，端上无权裁决。
 *
 * 纯逻辑，无 Android 依赖，JVM 单测可断言。
 */
object RelayBootstrap {

  /** 协议前缀。改这个字符串等于改线格式，必须同步桌面侧的生成器。 */
  const val SCHEME = "bitbot-relay://v1"

  /** 一次解析的结果 —— 把「解析出来了」与「为什么没解析出来」分开，界面才能说人话。 */
  sealed class Parsed {
    data class Ok(val config: RelayTunnel.RelayConfig) : Parsed()
    object Empty : Parsed()
    /** 前缀不对 / 不是我们的串：多半是用户粘错了东西。 */
    object NotBootstrap : Parsed()
    /** 是我们的串，但缺栏 —— 报出缺了哪几栏，别只说「格式不对」。 */
    data class Incomplete(val missing: List<String>) : Parsed()
  }

  /**
   * 解析用户粘进来的东西。
   *
   * 宽容一点的两个地方（都是有意的）：允许没有协议前缀（用户可能只复制了 `h=..&p=..`），
   * 也允许参数顺序任意 —— 但**不接受缺栏**。
   */
  fun parse(raw: String?): Parsed {
    val text = raw?.trim().orEmpty()
    if (text.isEmpty()) return Parsed.Empty
    // 允许「bitbot-relay://v1?...」也可以「?...」甚至裸「h=..&p=..」
    val query =
      when {
        text.startsWith(SCHEME + "?") -> text.removePrefix(SCHEME + "?")
        text.startsWith(SCHEME) -> text.removePrefix(SCHEME).removePrefix("?").removePrefix("&")
        text.startsWith("?") -> text.removePrefix("?")
        // 认不出协议、也没有我们那四个键里的任何一个 ⇒ 不是配对串
        else -> if (text.contains("h=") || text.contains("p=")) text else return Parsed.NotBootstrap
      }
    val map = LinkedHashMap<String, String>()
    query.split("&").forEach { pair ->
      val idx = pair.indexOf('=')
      if (idx <= 0) return@forEach
      val k = pair.substring(0, idx).trim().lowercase()
      val v = pair.substring(idx + 1).trim()
      if (k.isNotEmpty()) map[k] = v
    }
    val host = unesc(map["h"].orEmpty())
    val port = map["p"]?.toIntOrNull() ?: 0
    val box = unesc(map["b"].orEmpty())
    // accept 两个字母的别名，纯粹因为「t」和「token」都有人会手抄
    val token = unesc(map["t"]?.takeIf { it.isNotEmpty() } ?: map["token"].orEmpty())

    val missing = ArrayList<String>()
    if (host.isEmpty()) missing += "relay 地址"
    if (port !in 1..65535) missing += "端口"
    if (box.isEmpty()) missing += "盒子 ID"
    if (token.isEmpty()) missing += "手机凭证"
    if (missing.isNotEmpty()) return Parsed.Incomplete(missing)

    val cfg = RelayTunnel.parseConfig(host, port, token, box)
      ?: return Parsed.Incomplete(listOf("参数不合法"))
    return Parsed.Ok(cfg)
  }

  /** 生成：桌面侧用它拼出可复制的一段（与 [parse] 严格对称）。 */
  fun encode(config: RelayTunnel.RelayConfig): String =
    "$SCHEME?h=${esc(config.host)}&p=${config.port}&b=${esc(config.boxId)}&t=${esc(config.token)}"

  /**
   * 给界面看的一行摘要 —— **永远不含 token**。
   * 用户需要确认「粘的是这台桌面吗」，但不需要在屏幕上看见凭证明文。
   */
  fun describe(config: RelayTunnel.RelayConfig?): String =
    if (config == null) "未配置跨网配对" else "${config.endpoint} · ${config.boxId}"

  /** 极简百分号转义：只处理会破坏 query 的三个字符，避免出现「粘过去少了半截」。 */
  private fun esc(v: String): String =
    v.replace("%", "%25").replace("&", "%26").replace("#", "%23")

  private fun unesc(v: String): String =
    v.replace("%23", "#").replace("%26", "&").replace("%25", "%")
}
