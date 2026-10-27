package com.bitbot.host

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Pairing v1: LAN auto-discovery + 6-digit pairing code.
 *
 * Wire protocol: docs/design/desktop-target/pairing-v1.md
 *
 * Pure logic (testable without Android runtime):
 * - /24 subnet candidate enumeration
 * - GET /v1/pair/discover response parsing
 * - 6-digit code validation
 * - POST /v1/pair/redeem failure mapping to human-readable messages
 *
 * Network logic (requires real device/emulator):
 * - Concurrent scanning (32 threads, 350ms timeout per host)
 * - Redeem POST and prefs storage via TurnBridge
 */
object DesktopPairing {

  /**
   * Discovered Desktop candidate from GET /v1/pair/discover.
   * Fields are optional per spec — missing/invalid fields are discarded, not invented.
   */
  data class DiscoveredDesktop(
    val name: String,
    val ip: String,
    val port: Int,
    val codeActive: Boolean,
    val expiresInMillis: Long,
  )

  /**
   * Redeem success: contains base_url, turn_token, and base_url_scope per pairing-v1.md.
   * base_url_scope: private|cgnat|public|link_local|loopback
   * Non-private scopes mean the phone likely can't reach the Desktop.
   */
  data class RedeemSuccess(
    val baseUrl: String,
    val turnToken: String,
    val baseUrlScope: String,
  ) {
    /** True when the Desktop gave a non-private address the phone likely can't reach. */
    val isNonPrivateScope: Boolean get() = baseUrlScope != "private"

    /** Human-readable warning for non-private scopes. */
    val scopeWarning: String?
      get() = when (baseUrlScope) {
        "private" -> null
        "public" -> "桌面给的是公网地址，手机大概率连不通，需要在桌面上点「允许手机连接」并确认同一 Wi-Fi"
        "cgnat" -> "桌面给的是覆盖网（CGNAT）地址，手机大概率连不通，需要在桌面上点「允许手机连接」并确认同一 Wi-Fi"
        "link_local" -> "桌面给的是 link-local 地址，手机大概率连不通，需要在桌面上点「允许手机连接」并确认同一 Wi-Fi"
        "loopback" -> "桌面给的是 loopback 地址，手机连不通，需要在桌面上点「允许手机连接」并确认同一 Wi-Fi"
        else -> "桌面给的地址类型未知（$baseUrlScope），手机可能连不通，请确认同一 Wi-Fi"
      }
  }

  /**
   * Redeem failure reasons per pairing-v1.md §2.
   * Each maps to a distinct human-readable message.
   */
  sealed class RedeemFailure(val userMessage: String) : Exception(userMessage) {
    /** 400 invalid_code: code wrong/missing/expired/already used */
    data class InvalidCode(val attemptsLeft: Int? = null) : RedeemFailure(
      if (attemptsLeft != null) "配对码不对，还剩 $attemptsLeft 次机会"
      else "配对码不对"
    )

    /** 400 attempts_exceeded: this code has been tried too many times */
    object AttemptsExceeded : RedeemFailure("配对码已失效，回桌面重新生成一个")

    /** 400 bad_request: missing code or malformed JSON */
    object BadRequest : RedeemFailure("请求格式不对，请重试")

    /** 409 pairing_not_open: Desktop hasn't enabled LAN access */
    object PairingNotOpen : RedeemFailure("桌面那边还没点「允许手机连接」")

    /** Network/transport error */
    data class NetworkError(val reason: String) : RedeemFailure("连不上桌面：$reason")
  }

  /**
   * Compute /24 subnet candidates from a given IPv4 address.
   * Returns list of IPs from .1 to .254 (excluding .0 and .255).
   *
   * Example: "192.168.1.100" → ["192.168.1.1", "192.168.1.2", ..., "192.168.1.254"]
   */
  fun enumerateSubnet24(localIp: String): List<String> {
    val parts = localIp.trim().split(".")
    if (parts.size != 4) return emptyList()
    val octets = parts.mapNotNull { it.toIntOrNull() }
    if (octets.size != 4) return emptyList()
    if (octets.any { it < 0 || it > 255 }) return emptyList()

    val prefix = "${octets[0]}.${octets[1]}.${octets[2]}"
    return (1..254).map { "$prefix.$it" }
  }

  /**
   * Validate a 6-digit pairing code per spec.
   * Must be exactly 6 digits, no more, no less.
   */
  fun isValidPairingCode(code: String): Boolean {
    val trimmed = code.trim()
    if (trimmed.length != 6) return false
    return trimmed.all { it.isDigit() }
  }

  /**
   * Parse GET /v1/pair/discover response into DiscoveredDesktop.
   * Returns null if required fields are missing or invalid.
   *
   * Per spec: fields missing/invalid are discarded, not invented.
   */
  fun parseDiscoverResponse(json: String, sourceIp: String): DiscoveredDesktop? {
    return try {
      val obj = JSONObject(json.trim())
      if (!obj.optBoolean("ok", false)) return null
      if (obj.optString("service") != "bitbot-desktop") return null

      val name = obj.optString("name").trim()
      if (name.isEmpty()) return null

      val port = obj.optInt("port", -1)
      if (port < 1 || port > 65535) return null

      val pairing = obj.optJSONObject("pairing") ?: return null
      val codeActive = pairing.optBoolean("code_active", false)
      val expiresInMillis = pairing.optLong("expires_in_ms", 0L)

      DiscoveredDesktop(
        name = name,
        ip = sourceIp,
        port = port,
        codeActive = codeActive,
        expiresInMillis = expiresInMillis,
      )
    } catch (e: Exception) {
      null
    }
  }

  /**
   * Map redeem failure to human-readable message per pairing-v1.md §2.
   *
   * @param httpStatus HTTP status code (400, 409, etc.)
   * @param errorBody Response body (JSON with "error" field)
   * @param attemptsLeft Optional attempts remaining (for invalid_code)
   */
  fun mapRedeemFailure(httpStatus: Int, errorBody: String, attemptsLeft: Int? = null): RedeemFailure {
    val errorCode = try {
      JSONObject(errorBody.trim()).optString("error", "")
    } catch (e: Exception) {
      ""
    }

    return when {
      httpStatus == 400 && errorCode == "invalid_code" -> RedeemFailure.InvalidCode(attemptsLeft)
      httpStatus == 400 && errorCode == "attempts_exceeded" -> RedeemFailure.AttemptsExceeded
      httpStatus == 400 && errorCode == "bad_request" -> RedeemFailure.BadRequest
      httpStatus == 409 && errorCode == "pairing_not_open" -> RedeemFailure.PairingNotOpen
      httpStatus in 400..499 -> RedeemFailure.BadRequest
      else -> RedeemFailure.NetworkError("HTTP $httpStatus")
    }
  }

  /**
   * Scan LAN for Desktop candidates.
   *
   * @param localIp Phone's own IPv4 on the Wi-Fi
   * @param concurrency Max concurrent connections (default 32 per spec)
   * @param timeoutMs Per-host timeout (default 350ms per spec)
   * @param ports Candidate ports to probe (default [18765]). The discover response's
   *              `port` field is authoritative for subsequent redeem — if it differs
   *              from the probe port, the response port is used and logged.
   * @return List of discovered Desktops
   */
  fun scanForDesktops(
    localIp: String,
    concurrency: Int = 32,
    timeoutMs: Int = 350,
    ports: List<Int> = listOf(18765),
  ): List<DiscoveredDesktop> {
    val candidates = enumerateSubnet24(localIp)
    if (candidates.isEmpty()) return emptyList()

    val effectivePorts = ports.ifEmpty { listOf(18765) }
    val executor = Executors.newFixedThreadPool(concurrency)
    val results = mutableListOf<DiscoveredDesktop>()

    try {
      val futures = candidates.flatMap { ip ->
        effectivePorts.map { port ->
          executor.submit {
            try {
              val discovered = probeDesktop(ip, port, timeoutMs)
              if (discovered != null) {
                synchronized(results) {
                  results.add(discovered)
                }
              }
            } catch (e: Exception) {
              // Host unreachable or timeout — skip silently
            }
          }
        }
      }

      futures.forEach { it.get(timeoutMs.toLong() * 2, TimeUnit.MILLISECONDS) }
    } catch (e: Exception) {
      // Timeout or interruption — return what we have so far
    } finally {
      executor.shutdown()
      executor.awaitTermination(1, TimeUnit.SECONDS)
    }

    return results
  }

  /**
   * Probe a single host:port for GET /v1/pair/discover.
   * Returns null if host doesn't respond or response is invalid.
   * The port from the discover response is authoritative — if it differs from the
   * probe port, the response port is used (and logged via android.util.Log on Android).
   */
  private fun probeDesktop(ip: String, port: Int, timeoutMs: Int): DiscoveredDesktop? {
    val url = URL("http://$ip:$port/v1/pair/discover")
    val conn = url.openConnection() as HttpURLConnection
    conn.connectTimeout = timeoutMs
    conn.readTimeout = timeoutMs
    conn.requestMethod = "GET"
    conn.doInput = true

    return try {
      val responseCode = conn.responseCode
      if (responseCode != 200) return null

      val body = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { it.readText() }
      val discovered = parseDiscoverResponse(body, ip)
      // If the response port differs from the probe port, the response port is authoritative.
      // parseDiscoverResponse already reads the `port` field from the response, so
      // discovered.port reflects the actual bound port from the desktop.
      if (discovered != null && discovered.port != port) {
        try { android.util.Log.i("DesktopPairing", "Probe port $port != response port ${discovered.port}, using response port") } catch (_: Exception) {}
      }
      discovered
    } catch (e: Exception) {
      null
    } finally {
      conn.disconnect()
    }
  }

  /**
   * Redeem a pairing code with the Desktop.
   *
   * @param desktopIp IP address of the Desktop
   * @param desktopPort Port of the Desktop (from discover)
   * @param code 6-digit pairing code
   * @param deviceName Phone's device name (e.g., "Pixel 7")
   * @return RedeemSuccess with baseUrl, turnToken, baseUrlScope on success, or RedeemFailure on error
   */
  fun redeemCode(
    desktopIp: String,
    desktopPort: Int,
    code: String,
    deviceName: String,
  ): Result<RedeemSuccess> {
    if (!isValidPairingCode(code)) {
      return Result.failure(IllegalArgumentException("配对码必须是 6 位数字"))
    }

    val url = URL("http://$desktopIp:$desktopPort/v1/pair/redeem")
    val body = JSONObject()
      .put("code", code.trim())
      .put("device_name", deviceName)
      .put("machine_kind", "android")
      .toString()

    val conn = url.openConnection() as HttpURLConnection
    conn.connectTimeout = 10000
    conn.readTimeout = 10000
    conn.requestMethod = "POST"
    conn.doOutput = true
    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")

    return try {
      OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body) }

      val responseCode = conn.responseCode
      val stream = if (responseCode in 200..299) conn.inputStream else conn.errorStream
      val responseBody = BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }

      if (responseCode in 200..299) {
        val obj = JSONObject(responseBody.trim())
        if (!obj.optBoolean("ok", false)) {
          return Result.failure(RedeemFailure.BadRequest)
        }
        val turnToken = obj.optString("turn_token", "")
        val baseUrl = obj.optString("base_url", "")
        val baseUrlScope = obj.optString("base_url_scope", "private")
        if (turnToken.isEmpty() || baseUrl.isEmpty()) {
          return Result.failure(RedeemFailure.BadRequest)
        }
        Result.success(RedeemSuccess(baseUrl, turnToken, baseUrlScope))
      } else {
        Result.failure(mapRedeemFailure(responseCode, responseBody))
      }
    } catch (e: Exception) {
      Result.failure(RedeemFailure.NetworkError(e.message ?: "unknown"))
    } finally {
      conn.disconnect()
    }
  }

  /**
   * Complete the pairing flow: redeem code and store credentials in prefs.
   *
   * @param desktop The discovered Desktop to pair with
   * @param code 6-digit pairing code
   * @param deviceName Phone's device name
   * @return Success with RedeemSuccess (includes scope warning info), or failure with RedeemFailure
   */
  fun completePairing(
    desktop: DiscoveredDesktop,
    code: String,
    deviceName: String,
  ): Result<RedeemSuccess> {
    val result = redeemCode(desktop.ip, desktop.port, code, deviceName)
    return result.fold(
      onSuccess = { success ->
        TurnBridge.setHostUrl(success.baseUrl)
        TurnBridge.setTurnToken(success.turnToken)
        Result.success(success)
      },
      onFailure = { error ->
        if (error is RedeemFailure) {
          Result.failure(error)
        } else {
          Result.failure(RedeemFailure.NetworkError(error.message ?: "unknown"))
        }
      }
    )
  }
}
