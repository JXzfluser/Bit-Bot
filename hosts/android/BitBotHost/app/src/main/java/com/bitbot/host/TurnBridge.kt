package com.bitbot.host

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/**
 * ADR 0002 Host bridge.
 * Product path: POST Desktop shared-brain `/v1/turn` (open-config BITBOT_HOST_URL).
 * Prefer in-app「凭证」prefs over env; never hardcode secrets.
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
    if (fromPrefs.isNotEmpty()) return fromPrefs
    return System.getenv("BITBOT_HOST_URL")
      ?: System.getenv("BITBOT_TURN_URL")
      ?: defaultHostUrl()
  }

  fun setHostUrl(url: String?) {
    val prefs = appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return
    val trimmed = url?.trim().orEmpty()
    prefs.edit().apply {
      if (trimmed.isEmpty()) remove(KEY_HOST_URL) else putString(KEY_HOST_URL, trimmed)
      apply()
    }
  }

  fun runTurn(text: String, machineKind: String = "android"): String {
    val hostUrl = hostUrl()
    if (!hostUrl.isNullOrBlank()) {
      return runCatching { runTurnHttp(hostUrl, text, machineKind) }
        .getOrElse { httpErr ->
          // Fall through to local node only if repo is available
          runCatching { runTurnLocal(text, machineKind) }
            .getOrElse { localErr ->
              error(
                "HTTP turn failed (${httpErr.message}); local fallback failed (${localErr.message}). " +
                  "在「凭证」填写 BITBOT_HOST_URL（如 http://192.168.1.10:18765）",
              )
            }
        }
    }
    return runTurnLocal(text, machineKind)
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

  private fun defaultHostUrl(): String? {
    // Emulator loopback to host machine Desktop inbound
    val props = System.getProperties()
    val fromProp = props.getProperty("bitbot.host.url")
    if (!fromProp.isNullOrBlank()) return fromProp
    // 10.0.2.2 = Android emulator → host localhost
    return "http://10.0.2.2:18765"
  }

  private fun runTurnHttp(base: String, text: String, machineKind: String): String {
    val root = base.trimEnd('/')
    val url = URL(if (root.endsWith("/v1/turn")) root else "$root/v1/turn")
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
