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
    "连不上 Desktop 大脑。桌面那边报：${httpReason ?: "unknown"}；" +
      "本机 dev runner 也失败：${localReason ?: "unknown"}。" +
      "在「凭证」核对配对地址与配对令牌（桌面：设置 → 凭证 → 手机配对；同一 Wi-Fi 先点「允许手机连接」）"

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
      return runCatching { runTurnHttp(hostUrl, text, machineKind) }
        .getOrElse { httpErr ->
          // Fall through to local node only if repo is available
          runCatching { runTurnLocal(text, machineKind) }
            .getOrElse { localErr -> error(pairingHint(httpErr.message, localErr.message)) }
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
