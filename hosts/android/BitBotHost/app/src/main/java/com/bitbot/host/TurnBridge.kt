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

  @Volatile private var appContext: Context? = null

  fun bind(context: Context) {
    appContext = context.applicationContext
  }

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

  /** 未配对时说什么：点名去「凭证」填什么、去哪儿拿，不甩锅网络。 */
  fun unpairedText(localReason: String?): String {
    val head =
      "还没有配对 Desktop 大脑：点「凭证」填写桌面配对地址与配对令牌" +
        "（桌面：设置 → 凭证 → 手机配对，两项都能复制）。"
    return if (localReason.isNullOrBlank()) head else "$head（本机 dev runner 也不可用：$localReason）"
  }

  /** 配了但连不上：两次失败的原因都要留着，并把下一步说在人话前面。 */
  fun pairingHint(httpReason: String?, localReason: String?): String =
    "连不上 Desktop 大脑。桌面那边报：${explainHttpReason(httpReason)}；" +
      "本机 dev runner 也失败：${localReason ?: "unknown"}。" +
      "在「凭证」核对配对地址与配对令牌（桌面：设置 → 凭证 → 手机配对；同一 Wi-Fi 先点「允许手机连接」）"

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
    val sign = if (code.isEmpty()) status else "$status/$code"
    return when {
      status == "401" && code == "invalid_token" ->
        "配对令牌不对（invalid_token）：去桌面「设置 → 凭证 → 手机配对 → 显示配对令牌」" +
          "整串重新复制一遍再粘过来，少一个字符或多一个空格都是这个结果。"
      status == "401" && code == "unauthorized" ->
        "桌面没收到配对凭证（unauthorized）：「凭证」里配对令牌那一栏很可能是空的，" +
          "去桌面「设置 → 凭证 → 手机配对 → 显示配对令牌」复制整串。"
      status == "401" && code == "turn_token_unconfigured" ->
        "桌面那边还没生成配对令牌（turn_token_unconfigured）：手机怎么改都没用，" +
          "先在桌面上打开「设置 → 凭证 → 手机配对」，并点「允许手机连接」。"
      status == "401" && code in SIGNATURE_CODES ->
        "桌面在要签名（$code），手机配对走的是配对令牌那条路：重抄一遍令牌再试。"
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
        // Fall through to local node only if repo is available
        runCatching { runTurnLocal(text, machineKind) }
          .getOrElse { localErr ->
            error(
              if (missingToken != null) "$missingToken（本机 dev runner 也不可用：${localErr.message}）"
              else pairingHint(httpErr.message, localErr.message)
            )
          }
      }
    }
    // 一个地址都没配：先试 dev runner（仓库里跑 host 的情况），失败就老实说「未配对」，
    // 不拿一个写死的 emulator 地址假装有机会连上。
    return runCatching { runTurnLocal(text, machineKind) }
      .getOrElse { error(unpairedText(it.message)) }
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
        .put("session_id", "android-app")
        .toString()
    val conn = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 15000
      readTimeout = 120000
      doOutput = true
      setRequestProperty("Content-Type", "application/json; charset=utf-8")
      turnToken()?.let { setRequestProperty("Authorization", "Bearer $it") }
    }
    OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body) }
    val code = conn.responseCode
    val stream = if (code in 200..299) conn.inputStream else conn.errorStream
    val out =
      BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
    if (code !in 200..299) {
      error("turn HTTP $code: $out")
    }
    return out.trim()
  }

  private fun runTurnLocal(text: String, machineKind: String): String {
    val repoRoot = System.getenv("BITBOT_REPO_ROOT") ?: inferRepoRoot()
    val runner = File(repoRoot, "hosts/mobile_host/run.js")
    require(runner.isFile) { "missing mobile_host runner at ${runner.absolutePath}" }
    val pb =
      ProcessBuilder(
        "node",
        runner.absolutePath,
        "--machine-kind",
        machineKind,
        "--session-id",
        "android-app",
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
