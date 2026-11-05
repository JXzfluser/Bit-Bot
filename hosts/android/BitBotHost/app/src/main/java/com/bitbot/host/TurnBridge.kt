package com.bitbot.host

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * ADR 0002 Host bridge.
 * Product path: POST Desktop shared-brain `/v1/turn` (open-config 配对地址：
 * 应用内「凭证」> BITBOT_HOST_URL / BITBOT_TURN_URL > -Dbitbot.host.url)。
 * 一个都没配 = 未配对：不写死任何地址，直接把「去凭证配对」说清楚。
 * 地址归一在 normalizeHostUrl 里做：少协议补 http://，/v1/turn 只拼一次。
 * Dev fallback: `node hosts/mobile_host/run.js` when repo + node present.
 */
object TurnBridge {
  private const val PREFS = "bitbot_host"
  private const val KEY_HOST_URL = "BITBOT_HOST_URL"
  private const val KEY_TURN_TOKEN = "BITBOT_TURN_TOKEN"
  private const val KEY_DESKTOP_PORT = "BITBOT_DESKTOP_PORT"
  private const val DEFAULT_DESKTOP_PORT = 18765

  // A3-5：中转参数四栏。与「配对地址/令牌」同一份 prefs，但刻意用独立键 ——
  // 中转是**退路**，不是配对地址的替代品：直连先试，通了就不碰中转。
  private const val KEY_RELAY_HOST = "BITBOT_RELAY_HOST"
  private const val KEY_RELAY_PORT = "BITBOT_RELAY_PORT"
  private const val KEY_RELAY_TOKEN = "BITBOT_RELAY_TOKEN"
  private const val KEY_RELAY_BOX = "BITBOT_RELAY_BOX_ID"

  @Volatile private var appContext: Context? = null

  fun bind(context: Context) {
    appContext = context.applicationContext
  }

  /** 配对那一步要往本地身份文件里写服务端派发的 id —— 给它同一个应用上下文，别再传一份。 */
  fun context(): Context? = appContext

  /**
   * 给同模块的统计/诊断层用的 prefs 句柄。
   *
   * 刻意包一层而不是让每个调用方自己 `getSharedPreferences("bitbot_host", ...)`：
   * 文件名字符串散在四处，改一次就漏一处，最后表现为「统计有时不涨」。
   */
  fun prefs(): android.content.SharedPreferences? =
    appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun hostUrl(): String? {
    val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val fromPrefs = prefs?.getString(KEY_HOST_URL, null)?.trim().orEmpty()
    if (fromPrefs.isNotEmpty()) return normalizeHostUrl(fromPrefs)
    val fromEnv = System.getenv("BITBOT_HOST_URL") ?: System.getenv("BITBOT_TURN_URL")
    if (!fromEnv.isNullOrBlank()) return normalizeHostUrl(fromEnv)
    val fromProp = System.getProperties().getProperty("bitbot.host.url")
    if (!fromProp.isNullOrBlank()) return normalizeHostUrl(fromProp)
    // 没配对就是没配对。以前这里回一个写死的 emulator 地址（http://10.0.2.2:18765），
    // 真机上的表现是「发出去一定失败」，用户看到的是转圈加一句网络错误，
    // 而不是「去凭证配对」；写死的端口本身也违反「开放配置，不写死」。
    return null
  }

  /**
   * 配对地址归一：手敲 `192.168.1.10:18765` 是最常见的填法，直接喂给 java.net.URL
   * 会抛 MalformedURLException: no protocol，旧实现把这次失败咽掉退到本机 node
   * runner（真机上根本没有），最后一句都说不清是地址写错了。少了协议就补 http://，
   * 已经是 https 的不动。
   */
  fun normalizeHostUrl(raw: String?): String? {
    val v = raw?.trim().orEmpty()
    if (v.isEmpty()) return null
    val withScheme =
      when {
        v.startsWith("http://", ignoreCase = true) -> v
        v.startsWith("https://", ignoreCase = true) -> v
        v.startsWith("//") -> "http:$v"
        else -> "http://$v"
      }
    return withScheme.trimEnd('/')
  }

  /** 真正要打的那个端点：已经带 /v1/turn 就不重复拼。 */
  fun turnEndpoint(raw: String?): String? {
    val base = normalizeHostUrl(raw) ?: return null
    return if (base.endsWith("/v1/turn")) base else "$base/v1/turn"
  }

  /**
   * A3-17：**本机 dev runner 不存在**。
   *
   * `hosts/mobile_host/run.js` 只在仓库检出里存在。真机装了 APK 之后那个路径
   * 压根不存在 —— 这不是错误，是**正常情况**。旧实现把它当成一次真实失败，
   * 于是用户为「连不上桌面」看到的原因里夹着一句
   * `本机 dev runner 也不可用：missing mobile_host runner at /data/.../hosts/mobile_host/run.js`。
   * 那既解释不了任何事，又把内部路径泄漏到了正式界面。
   *
   * 现在把它做成一个**可识别**的类型：调用方据此完全不再提 dev runner，
   * 而不是靠去匹配 message 里的字符串（那样改一句文案就漏）。
   */
  class DevRunnerUnavailable : Exception("dev runner unavailable")

  /**
   * dev runner 那句话要不要说、怎么说。
   *
   * 口径只有一条：**它在才算数**。仓库里跑（`run.js` 存在）时开发同学需要这条线索；
   * 装了 APK 的真机上它根本不存在，提它只会让用户以为是自己的问题。
   */
  private fun devRunnerClause(localErr: Throwable?): String {
    if (localErr == null || localErr is DevRunnerUnavailable) return ""
    val msg = localErr.message?.trim().orEmpty()
    if (msg.isEmpty()) return ""
    // 兜底：即便哪天又被别处包装成普通异常，也不把内部路径念出来。
    if (msg.contains("mobile_host")) return ""
    return "（本机开发通道也失败：$msg）"
  }

  /** 未配对时说什么：点名去「凭证」填什么、去哪儿拿，不甩锅网络。 */
  fun unpairedText(localReason: String?): String {
    val head =
      "还没有配对 Desktop 大脑：点「凭证」填写桌面配对地址与配对令牌" +
        "（桌面：设置 → 凭证 → 手机配对，两项都能复制）。"
    val clause = devRunnerClause(localReason?.let { Exception(it) })
    return if (clause.isEmpty()) head else head + clause
  }

  /** 配了但连不上：桌面自己的原因留着，并把下一步说在人话前面。 */
  fun pairingHint(httpReason: String?, localReason: String?): String =
    "连不上 Desktop 大脑。桌面那边报：${explainHttpReason(httpReason)}。" +
      devRunnerClause(localReason?.let { Exception(it) }) +
      "在「凭证」里核对配对地址与配对令牌（桌面：设置 → 凭证 → 手机配对；同一 Wi-Fi 先点「允许手机连接」）。"

  /** ADR 0008 签名鉴权那几个码 —— 手机配对走的不是这条路，说清楚别让用户去找密钥。 */
  private val SIGNATURE_CODES =
    setOf("missing_signature", "bad_signature", "stale_timestamp", "nonce_reused")

  /**
   * 桌面 /v1/turn 的失败只有几种稳定形状（ADR 0008 + cn_inbound_server）：
   * `turn HTTP 401: {"ok":false,"error":"invalid_token"}`、404/405 的 HTML 页面、
   * 以及本机网络异常。原样贴给用户有两个害处：把鉴权问题伪装成网络问题，
   * 以及把整页 HTML 倒进聊天框。这里翻成人话，但**机器码一定留着** —— 报障时
   * 它是唯一能和桌面日志对上的东西。认得的码不再附原文（翻得准，而且原文要么是
   * 刚解析过的 JSON、要么是没用的 HTML 页）；认不得的才留截断原文，那是唯一线索。
   */
  fun explainHttpReason(raw: String?): String {
    val text = raw?.trim().orEmpty()
    if (text.isEmpty()) return "unknown"
    val status = Regex("turn HTTP (\\d{3})").find(text)?.groupValues?.get(1)
    if (status == null) return explainTransport(text)
    val code = Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1).orEmpty()
    // A2-4：桌面在设备凭证那条路上已经把「为什么」和「下一步做什么」写在回包里了
    // （error_description / next_step，都是**新增可选字段**）。产品都替用户想好了，
    // 端上就不该再自己编一句 —— 用它的，并保留机器码，报障时还能和桌面日志对上。
    val nextStep = Regex("\"next_step\"\\s*:\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1).orEmpty()
    val why = Regex("\"error_description\"\\s*:\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1).orEmpty()
    if (nextStep.isNotBlank()) {
      val tail = if (why.isNotBlank()) "（$why）" else ""
      return "桌面说：$nextStep$tail" + if (code.isNotBlank()) "［$code］" else ""
    }
    val sign = if (code.isEmpty()) status else "$status/$code"
    return when {
      // A3-17：这句原来写的是「配对令牌不对 → 去桌面重抄一遍整串」，方向是错的。
      // invalid_token 证明的是**桌面收到了请求、活着、并且拒绝了这个凭证** ——
      // 不是网络问题，也不一定是「你抄错了」。A2-3 之后手机自己会签，
      // 桌面一旦有登记表就忽略 bearer；此时出现 invalid_token 说明这次请求
      // 根本没走设备签名那条路（=这台设备没登记上），真正该做的是**重新配对**，
      // 而不是让用户去对着 60 多个字符逐个比对。
      status == "401" && code == "invalid_token" ->
        "桌面收到了请求但拒绝了这个凭证（invalid_token）—— 这不是网络问题。" +
          "先在这台手机的「凭证」里重新配对一次（配对会把本机的设备公钥重新登记到桌面，" +
          "之后请求改走设备签名，不再依赖那串长令牌）。" +
          "如果桌面版本较旧、还不支持设备签名，再去桌面「设置 → 凭证 → 手机配对 → 显示配对令牌」整串重抄一遍。"
      status == "401" && code == "unauthorized" ->
        "桌面没收到配对凭证（unauthorized）：「凭证」里配对令牌那一栏很可能是空的，" +
          "去桌面「设置 → 凭证 → 手机配对 → 显示配对令牌」复制整串。"
      status == "401" && code == "turn_token_unconfigured" ->
        "桌面那边还没生成配对令牌（turn_token_unconfigured）：手机怎么改都没用，" +
          "先在桌面上打开「设置 → 凭证 → 手机配对」，并点「允许手机连接」。"
      // 这句原来写的是「手机配对走的是配对令牌那条路，重抄一遍令牌再试」—— A2-3 之后它是**错的**：
      // 手机已经会自己签了，出现这几个码说明的是「这台设备的签名桌面不认」，
      // 真正该做的是重新配对（或让桌面把这台设备重新登记），不是重抄令牌。
      status == "401" && code in SIGNATURE_CODES ->
        "桌面不认这台手机的签名（$code）：先在手机「凭证」里重新配对一次，把这台设备的公钥重新登记上；" +
          "若桌面版本较旧还不支持设备签名，再重抄一遍配对令牌。"
      status == "404" ->
        "地址连上了，但这个端口上没有 /v1/turn（404）：确认填的是 Desktop 的入站端口" +
          "（默认 18765），别填成路由器页面或别的服务。"
      status == "405" -> "/v1/turn 只收 POST（405）：这个地址大概率指向了别的服务。"
      status == "401" -> "桌面拒绝了这个请求（$sign）：先在「凭证」重抄一遍配对令牌。原文：${abbreviate(text)}"
      else -> "桌面返回 HTTP $sign（未识别的状态码，不猜原因）：${abbreviate(text)}"
    }
  }

  /** 没走到 HTTP 层就报传输原因：地址解析不到、端口没人监听、超时，三种给三种说法。 */
  private fun explainTransport(text: String): String {
    val lower = text.lowercase()
    return when {
      lower.contains("unknownhost") || lower.contains("no such") || lower.contains("name or service") ->
        "这个配对地址手机解析不到（UnknownHost）：同一 Wi-Fi 下要填的是桌面那台机器的局域网 IP，不是机器名。"
      lower.contains("connection refused") ->
        "地址能到，但那个端口没人监听（Connection refused）：Desktop 没在跑，或者端口填错（默认 18765）。"
      lower.contains("timeout") || lower.contains("timed out") ->
        "连过去但没有回包（超时）：手机和桌面多半不在同一个 Wi-Fi，或桌面防火墙挡了入站端口。"
      else -> abbreviate(text)
    }
  }

  /** 缺哪一栏就只说哪一栏：一栏都没有归「未配对」管，不在这里重复报。 */
  fun pairingMissingHint(hostSet: Boolean, tokenSet: Boolean): String? =
    when {
      hostSet && !tokenSet -> "缺配对令牌"
      !hostSet && tokenSet -> "缺配对地址"
      else -> null
    }

  /**
   * 地址填了、令牌空着：不用发包就知道一定失败（ADR 0008 无 bearer 直接 401）。
   * 提前说清楚，用户才不会把「401」当成网络问题去查 Wi-Fi。
   */
  fun tokenPrecheck(hostUrl: String?, token: String?): String? {
    if (hostUrl.isNullOrBlank()) return null
    if (!token.isNullOrBlank()) return null
    return "配对地址填了，但配对令牌是空的：桌面会直接拒绝没有令牌的请求，这不是网络问题。" +
      "去桌面「设置 → 凭证 → 手机配对 → 显示配对令牌」复制整串，粘到「凭证」的配对令牌那一栏。"
  }

  /** 正文只留前 160 个字符，HTML 标签一律去掉 —— 聊天框不是日志查看器。 */
  private fun abbreviate(raw: String): String {
    val flat = raw.replace(Regex("<[^>]*>"), " ").replace(Regex("\\s+"), " ").trim()
    val cut =
      if (flat.length <= 160) flat
      else flat.substring(0, 160) + "…"
    return if (cut.isEmpty()) "空回包" else cut
  }


  fun setHostUrl(url: String?) {
    val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return
    val normalized = normalizeHostUrl(url).orEmpty()
    prefs.edit().apply {
      if (normalized.isEmpty()) remove(KEY_HOST_URL) else putString(KEY_HOST_URL, normalized)
      apply()
    }
  }

  /**
   * 手机这一回合落在哪个会话里 —— **POST 的 body 与 SSE 订阅必须用同一个值**。
   *
   * 规则与服务端默认一致（`cn_inbound_server.js:902-903`：
   * `sessionId = payload.session_id || ` + "`mobile-${machineKind}`" + `），
   * 因为服务端事件流按 `?session_id=` 过滤（`cn_inbound_server.js:1069-1072` →
   * `event_log.js:233` 那条 SQL）：订的会话与回合落的会话不是同一个，
   * 手机就**一条帧都收不到**（不是少几条）。
   *
   * 这一行是本轮修掉的真 bug：回合 body 一直写死 `android-app`，而订阅写的是
   * `mobile-android`，两者从来没对上过 —— 结构门与旧 fixture 把帧的会话写成测试自己的常量，
   * 于是「两条路径各用一个字符串」被撑绿。红原文见 report.md §8.63.10。
   */
  fun sessionFor(machineKind: String): String = "mobile-" + machineKind

  /**
   * A3-17：把一次回合的结局记进 [LinkStatus]。
   *
   * 为什么回合结果比探活更该被记：探活只证明「端口有人应」，回合才证明
   * 「桌面认这台手机」。一条成功的回合理所当然说明两件事都成立；
   * 一条 401/403 说明桌面在线但凭证被拒 —— 那是最需要被界面看见的状态。
   * 只认 401/403；404/405 是「端口上不是桌面」，属于找错门，不算凭证问题。
   */
  fun recordTurnOutcome(rawMessage: String?) {
    val text = rawMessage?.trim().orEmpty()
    if (text.isEmpty()) return
    if (!text.contains("turn HTTP")) return
    val status = Regex("turn HTTP (\\d{3})").find(text)?.groupValues?.get(1)?.toIntOrNull() ?: return
    val code = Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1).orEmpty()
    when {
      status in 200..299 -> LinkStatus.authAccepted()
      status == 401 || status == 403 -> {
        LinkStatus.authRejected(code.ifBlank { "HTTP $status" })
        // R-A3-6c：凭证被拒单独计数 —— 它不是「连接失败」，混进失败率会得出
        // 「跨网很差」这种错误结论（其实网络好好的，只是钥匙不对）。
        ConnectionStats.recordAuthRejected()
      }
      else -> Unit // 404/405 之类：不改凭证结论，否则会把「找错端口」说成「凭证被拒」
    }
  }

  fun runTurn(text: String, machineKind: String = "android"): String {
    val hostUrl = hostUrl()
    if (hostUrl != null) {
      // 地址有了但令牌是空的：桌面一定会拒（ADR 0008 无 bearer 直接 401），
      // 那就不必把这件事伪装成一次网络失败。dev runner 仍然会试一次，
      // 试不成就只报「缺令牌」，不说「连不上」。
      val missingToken = tokenPrecheck(hostUrl, turnToken())
      val attempted =
        if (missingToken != null) Result.failure<String>(IllegalStateException(missingToken))
        else runCatching { runTurnHttp(hostUrl, text, machineKind) }
      return attempted.getOrElse { httpErr ->
        // A3-17：先记账再说话 —— 界面上的「凭证被拒」靠这一行，不靠用户猜。
        recordTurnOutcome(httpErr.message)
        // Fall through to local node only if repo is available
        runCatching { runTurnLocal(text, machineKind) }
          .getOrElse { localErr ->
            // A3-17：dev runner 不存在（真机上的常态）时不留任何痕迹 ——
            // 「没这条通道」不是一条失败原因，说出来只会误导。
            val localReason = if (localErr is DevRunnerUnavailable) null else localErr.message
            error(
              if (missingToken != null) missingToken + devRunnerClause(localErr)
              else pairingHint(httpErr.message, localReason)
            )
          }
      }
    }
    // 一个地址都没配：先试 dev runner（仓库里跑 host 的情况），失败就老实说「未配对」，
    // 不拿一个写死的 emulator 地址假装有机会连上。
    return runCatching { runTurnLocal(text, machineKind) }
      .getOrElse { error(unpairedText(if (it is DevRunnerUnavailable) null else it.message)) }
  }

  /** Prefer final assistant message (post Host llm_chat continue). */
  fun assistantText(raw: String): String? {
    val line =
      raw.lineSequence()
        .map { it.trim() }
        .firstOrNull { it.startsWith("{") }
        ?: raw.trim()
    return runCatching {
      val obj = JSONObject(line)
      val messages = obj.optJSONArray("messages") ?: return@runCatching null
      var last: String? = null
      for (i in 0 until messages.length()) {
        val m = messages.optJSONObject(i) ?: continue
        if (m.optString("role") == "assistant") {
          val t = m.optString("text")
          if (t.isNotEmpty()) last = t
        }
      }
      last
    }.getOrNull()
  }

  /** ADR 0008: Desktop `/v1/turn` rejects requests with no bearer. */
  fun turnToken(): String? {
    val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val fromPrefs = prefs?.getString(KEY_TURN_TOKEN, null)?.trim().orEmpty()
    if (fromPrefs.isNotEmpty()) return fromPrefs
    val env = System.getenv("BITBOT_TURN_TOKEN")?.trim().orEmpty()
    return env.ifEmpty { null }
  }

  fun setTurnToken(token: String?) {
    val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return
    val trimmed = token?.trim().orEmpty()
    prefs.edit().apply {
      if (trimmed.isEmpty()) remove(KEY_TURN_TOKEN) else putString(KEY_TURN_TOKEN, trimmed)
      apply()
    }
  }

  /**
   * A3-5：中转四栏。prefs 优先，其次环境变量（dev/测试），四栏缺一即 null。
   * 回 null 的语义是「没配中转」—— 直连失败时就诚实报直连的错，不拿半套配置去连。
   */
  fun relayConfig(): RelayTunnel.RelayConfig? {
    val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val host = prefs?.getString(KEY_RELAY_HOST, null) ?: System.getenv("BITBOT_RELAY_HOST")
    val port =
      if (prefs != null && prefs.contains(KEY_RELAY_PORT)) prefs.getInt(KEY_RELAY_PORT, 0)
      else System.getenv("BITBOT_RELAY_PORT")?.trim()?.toIntOrNull()
    val token = prefs?.getString(KEY_RELAY_TOKEN, null) ?: System.getenv("BITBOT_RELAY_TOKEN")
    val boxId = prefs?.getString(KEY_RELAY_BOX, null) ?: System.getenv("BITBOT_RELAY_BOX_ID")
    return RelayTunnel.parseConfig(host, port, token, boxId)
  }

  /** 写中转四栏；四项全空 = 清掉（回到「只用直连」）。 */
  fun setRelayConfig(host: String?, port: Int?, token: String?, boxId: String?) {
    val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return
    val cfg = RelayTunnel.parseConfig(host, port, token, boxId)
    prefs.edit().apply {
      if (cfg == null) {
        remove(KEY_RELAY_HOST)
        remove(KEY_RELAY_PORT)
        remove(KEY_RELAY_TOKEN)
        remove(KEY_RELAY_BOX)
      } else {
        putString(KEY_RELAY_HOST, cfg.host)
        putInt(KEY_RELAY_PORT, cfg.port)
        putString(KEY_RELAY_TOKEN, cfg.token)
        putString(KEY_RELAY_BOX, cfg.boxId)
      }
      apply()
    }
  }

  /** Desktop port for pairing scan. Returns stored value or default 18765. */
  fun desktopPort(): Int {
    val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return DEFAULT_DESKTOP_PORT
    return prefs.getInt(KEY_DESKTOP_PORT, DEFAULT_DESKTOP_PORT)
  }

  /** Store desktop port for pairing scan. */
  fun setDesktopPort(port: Int) {
    val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return
    prefs.edit().apply {
      putInt(KEY_DESKTOP_PORT, port)
      apply()
    }
  }

  /**
   * 失败要看得见：把 Host / 内核真实报出的原因读出来，不写「大概是要配密钥」这种
   * 既兜底又甩锅的话术。Host 报什么就显示什么，报不出来就明说「没有可见回复」。
   */
  fun failureText(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.startsWith("!")) return trimmed.removePrefix("!").trim()
    val line = trimmed.lineSequence().map { it.trim() }.firstOrNull { it.startsWith("{") } ?: return null
    return runCatching {
      val obj = JSONObject(line)
      if (!obj.isNull("error") && obj.optString("error").isNotEmpty()) {
        return@runCatching obj.getString("error")
      }
      if (obj.optBoolean("ok", true)) return@runCatching null
      val failed = mutableListOf<String>()
      val hrs = obj.optJSONArray("host_results") ?: JSONArray()
      for (i in 0 until hrs.length()) {
        val h = hrs.optJSONObject(i) ?: continue
        if (h.has("ok") && !h.optBoolean("ok", true)) {
          val why = h.optString("error").ifBlank { h.optString("stderr").ifBlank { "host 未给出原因" } }
          failed += h.optString("kind", "host") + "=" + why
        }
      }
      if (failed.isNotEmpty()) "Host 执行失败：" + failed.joinToString("; ") else "内核 ok=false 且未给出原因"
    }.getOrNull()
  }

  private fun runTurnHttp(base: String, text: String, machineKind: String): String {
    val endpoint = turnEndpoint(base) ?: error("空配对地址")
    val url = URL(endpoint)
    val body =
      JSONObject()
        .put("text", text)
        .put("machine_kind", machineKind)
        .put("session_id", sessionFor(machineKind))
        .toString()
    // 先定字节，再签、再发 —— 顺序很重要：签「将要发的这串」与发「签过的那串」必须是同一份，
    // 差一个换行或一次 charset 改写，真机上就是一条 bad_signature 401（DT-01 钉的就是这件事）。
    val bodyBytes = body.toByteArray(Charsets.UTF_8)
    val deviceHeaders = DeviceIdentity.requestHeaders(appContext, bodyBytes)
    // 头先攒成一份：直连和中转必须发**完全相同**的字节与头 —— 签名算的是这份，
    // 两条路各拼一次就会出现「直连能发、中转 401」这种只在跨网时复现的坏味道。
    val headers =
      buildList {
        add("Content-Type" to "application/json; charset=utf-8")
        turnToken()?.let { add("Authorization" to "Bearer $it") }
        // bearer 与设备签名同时挂：桌面版本可能比手机旧（不认登记，只认 bearer），
        // 摘掉 bearer 就把这条路断了；登记表非空时桌面自己忽略 bearer。代价记在 §8.64（R-A2-2）。
        DeviceIdentity.applyHeaders({ k, v -> add(k to v) }, deviceHeaders)
      }
    // A3-5：直连优先（够快、不经第三方）；直连失败且配了中转才走隧道。
    // A3-6：这次到底走了哪条路，记进 TransportStatus —— 界面显示的是**真实发生过的事**，
    // 不是「探针大概能通」的推测（两者在跨网那一刻会分叉）。
    val startedAt = System.currentTimeMillis()
    val directResult = runCatching { postDirect(url, headers, bodyBytes) }
    directResult.getOrNull()?.let { out ->
      val ms = System.currentTimeMillis() - startedAt
      TransportStatus.record(ConnectionStrategy.Mode.DIRECT, ms)
      ConnectionStats.recordDirect(true, ms)
      // A3-17：一次成功往返是最硬的证据 —— 桌面在线 **且** 认这台手机的凭证。
      LinkStatus.online()
      LinkStatus.authAccepted()
      return out
    }
    // R-A3-6c：直连失败也要记 —— 只记成功的成功率永远是 100%，那不是统计是自我安慰。
    ConnectionStats.recordDirect(false, System.currentTimeMillis() - startedAt)
    val directErr = directResult.exceptionOrNull() ?: IllegalStateException("unknown")
    val viaRelay = runCatching { postViaRelay(url, headers, bodyBytes, directErr) }
    val out =
      viaRelay.getOrElse { err ->
        // 两条都不通：回到「未连接」，别让状态条还挂着上一次的「中转 · 320ms」。
        TransportStatus.record(ConnectionStrategy.Mode.NONE, System.currentTimeMillis() - startedAt)
        ConnectionStats.recordRelay(false, System.currentTimeMillis() - startedAt)
        throw err
      }
    val relayMs = System.currentTimeMillis() - startedAt
    TransportStatus.record(ConnectionStrategy.Mode.RELAY, relayMs)
    ConnectionStats.recordRelay(true, relayMs)
    LinkStatus.online()
    LinkStatus.authAccepted()
    return out
  }

  /** 直连：原有那条路，行为一字未改。 */
  private fun postDirect(url: URL, headers: List<Pair<String, String>>, bodyBytes: ByteArray): String {
    val conn = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 15000
      readTimeout = 120000
      doOutput = true
    }
    for ((k, v) in headers) conn.setRequestProperty(k, v)
    conn.outputStream.use { it.write(bodyBytes) }
    val code = conn.responseCode
    val stream = if (code in 200..299) conn.inputStream else conn.errorStream
    val out =
      BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
    if (code !in 200..299) {
      error("turn HTTP $code: $out")
    }
    return out.trim()
  }

  /**
   * 退路：经中转隧道发同一次 POST（A3-5，补 R-A3-3a 手机侧那一半）。
   *
   * 两条路都断时，**两句原因都要留着**：只报中转，用户会以为「直连是好的、只是中转坏了」，
   * 于是去查一个根本没配的东西。反过来也一样。
   */
  private fun postViaRelay(
    url: URL,
    headers: List<Pair<String, String>>,
    bodyBytes: ByteArray,
    directErr: Throwable,
  ): String {
    val cfg = relayConfig() ?: throw directErr
    val hostHeader = if (url.port > 0) url.host + ":" + url.port else url.host
    val path = url.path.takeIf { it.isNotEmpty() } ?: "/v1/turn"
    // R-A3-6b/5c：从池里借，而不是每次 CONNECT 一条新的。
    // 借不到（凭据被拒 / 中继上没有这台桌面）时的措辞必须区分开 ——
    // 这两种失败让用户做的事完全不同。
    val tunnel =
      try {
        RelayTunnelPool.borrow(cfg)
      } catch (e: RelayTunnel.OpenFailure) {
        throw IllegalStateException(
          e.userMessage + "（直连也没通：" + explainHttpReason(directErr.message) + "）",
          directErr,
        )
      }
    // 这条隧道还能不能还给池子：只有「请求-响应完整走完」才算健康。
    // HTTP 4xx/5xx 是**权威答复**（隧道本身是好的），照样可以归还；
    // 超时/对端关闭/协议错属于传输层坏死，必须丢弃。
    var healthy = false
    try {
      val resp =
        TunnelHttp.post(
          tunnel = tunnel,
          path = path,
          hostHeader = hostHeader,
          headers = headers,
          body = bodyBytes,
          keepAlive = true,
        )
      healthy = true
      if (resp.status !in 200..299) error("turn HTTP ${resp.status}: ${resp.body}")
      return resp.body.trim()
    } catch (e: TunnelHttp.StaleTunnelException) {
      // 池子里的那条被对端关了：丢掉，并如实告诉调用方（由它决定要不要再试一次）。
      // 这里不再自动重试 —— 偷偷重试会把「隧道过期」和「网络在抖」混成同一个现象。
      throw IllegalStateException("中转隧道已失效（复用连接被对端关闭），请再试一次", e)
    } finally {
      if (healthy) RelayTunnelPool.release(tunnel) else RelayTunnelPool.invalidate(tunnel)
    }
  }

  private fun runTurnLocal(text: String, machineKind: String): String {
    val repoRoot = System.getenv("BITBOT_REPO_ROOT") ?: inferRepoRoot()
    val runner = File(repoRoot, "hosts/mobile_host/run.js")
    // A3-17：不是「找不到就用原来的话术兜底」，而是明确告诉上层「这条通道不存在」。
    if (!runner.isFile) throw DevRunnerUnavailable()
    val pb =
      ProcessBuilder(
        "node",
        runner.absolutePath,
        "--machine-kind",
        machineKind,
        "--session-id",
        sessionFor(machineKind),
        text,
      )
    pb.directory(File(repoRoot))
    pb.redirectErrorStream(true)
    val proc = pb.start()
    val out = proc.inputStream.bufferedReader().readText()
    val code = proc.waitFor()
    if (code != 0) {
      error("turn failed ($code): $out")
    }
    return out.trim()
  }

  private fun inferRepoRoot(): String {
    var dir = File(System.getProperty("user.dir") ?: ".")
    repeat(8) {
      if (File(dir, "moon.mod.json").isFile) return dir.absolutePath
      dir = dir.parentFile ?: return dir.absolutePath
    }
    return File(".").absolutePath
  }
}
