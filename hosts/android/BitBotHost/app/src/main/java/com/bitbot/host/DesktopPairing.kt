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
   *
   * A2-3 新增的三个字段都是**回执原文里的**（device.registered / device.id /
   * requires_device_credential），端上不自己推断：
   *   · deviceRegistered —— 这台手机的公钥有没有真的登记进桌面那张表；
   *   · deviceId —— 登记上了的话，桌面派发的那个身份（之后签名用的就是它，不是手机自己编的）；
   *   · requiresDeviceCredential —— 桌面是否已进入「只认设备签名」的模式。
   * 后两个合起来才是那句要紧的话：**桌面只认设备签名，而这台手机没登记上** —— 配对看着成功，
   * 发消息却会一路 401。这一格必须能被界面看见，不许咽掉。
   */
  data class RedeemSuccess(
    val baseUrl: String,
    val turnToken: String,
    val baseUrlScope: String,
    val deviceRegistered: Boolean = false,
    val deviceId: String? = null,
    val requiresDeviceCredential: Boolean = false,
  ) {
    /** True when the Desktop gave a non-private address the phone likely can't reach. */
    val isNonPrivateScope: Boolean get() = baseUrlScope != "private"

    /**
     * 「这台设备以后签不签得了」的人话结论，给配对成功的界面直接用。
     * 三种情况三种说法，不许含糊：登记上了 / 没登记上但桌面还没启用设备签名（老桌面，还能走 bearer）/
     * 没登记上而桌面已经只认设备签名（下一步一定 401，得当场说清）。
     */
    val deviceTrustNotice: String?
      get() = when {
        deviceRegistered && deviceId != null -> "这台设备已在这台桌面上登记（$deviceId），之后的请求都带设备签名"
        requiresDeviceCredential ->
          "注意：这台桌面只认设备签名，但这次配对没能把公钥登记上" +
            "（桌面版本可能较旧，或手机上的设备身份文件不可用）—— 发消息可能被拒，请先更新桌面再重新配对"
        else -> null
      }

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

    /**
     * 400 bad_device_public_key / device_key_not_ed25519：手机带了公钥来，但桌面认不得它。
     * 这一条不能归进 BadRequest（「请求格式不对，请重试」）—— 重试一百次也不会变好，
     * 而且用户必须知道：**配对没成**（桌面这次不会发令牌），不是「配对成功但没登记」。
     */
    data class DeviceKeyRejected(val why: String, val nextStep: String?) : RedeemFailure(
      listOfNotNull("这台手机的设备公钥被桌面拒绝：$why", nextStep).joinToString("；"),
    )
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
   * org.json 的 `optString` 在值是 `JSONObject.NULL` 时会还回字符串 "null" —— 那正是
   * 「桌面这次没有派发身份」的形状。把它当合法 id 用，端上就会拿 "null" 去签名。
   * 这里统一按「没有」处理。
   */
  private fun JSONObject.field(key: String): String {
    val v = opt(key)
    if (v == null || v === JSONObject.NULL) return ""
    return v.toString().trim()
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
      httpStatus == 400 && errorCode == "bad_device_public_key" -> deviceKeyFailure(httpStatus, errorBody, errorCode)
      httpStatus == 400 && errorCode == "device_key_not_ed25519" -> deviceKeyFailure(httpStatus, errorBody, errorCode)
      httpStatus == 400 && errorCode == "device_store_unreadable" -> deviceKeyFailure(httpStatus, errorBody, errorCode)
      httpStatus == 400 && errorCode == "device_store_unwritable" -> deviceKeyFailure(httpStatus, errorBody, errorCode)
      httpStatus == 400 && errorCode == "bad_request" -> RedeemFailure.BadRequest
      httpStatus == 409 && errorCode == "pairing_not_open" -> RedeemFailure.PairingNotOpen
      httpStatus in 400..499 -> RedeemFailure.BadRequest
      else -> RedeemFailure.NetworkError("HTTP $httpStatus")
    }
  }

  /**
   * 公钥被拒：优先用**桌面自己写的** error_description / next_step（A2-4 那条口径：产品给的话就贴产品的话），
   * 桌面没给（老版本桌面）才回落到端上那句。
   */
  private fun deviceKeyFailure(httpStatus: Int, errorBody: String, errorCode: String): RedeemFailure {
    val obj = try {
      JSONObject(errorBody.trim())
    } catch (e: Exception) {
      JSONObject()
    }
    val why = obj.field("error_description").ifBlank {
      when (errorCode) {
        "device_key_not_ed25519" -> "桌面只接受 ed25519 设备公钥"
        "device_store_unreadable" -> "桌面的设备登记表读不出来"
        "device_store_unwritable" -> "桌面的设备登记表写不进去"
        else -> "桌面读不成这台手机交来的公钥"
      }
    }
    val next = obj.field("next_step").takeIf { it.isNotEmpty() }
      ?: when {
        httpStatus == 400 && errorCode.startsWith("device_store_") -> "这是桌面侧的问题，请在桌面上检查数据目录后重试"
        else -> "在手机「凭证」里清掉本机设备身份后重新配对一次"
      }
    return RedeemFailure.DeviceKeyRejected(why, next)
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
   * @param identityContext 用于取/建这台手机的设备身份；null（纯 JVM 测试、老调用方）= 完全保持原形状
   * @return RedeemSuccess with baseUrl, turnToken, baseUrlScope on success, or RedeemFailure on error
   */
  fun redeemCode(
    desktopIp: String,
    desktopPort: Int,
    code: String,
    deviceName: String,
    identityContext: android.content.Context? = TurnBridge.context(),
  ): Result<RedeemSuccess> {
    if (!isValidPairingCode(code)) {
      return Result.failure(IllegalArgumentException("配对码必须是 6 位数字"))
    }

    val url = URL("http://$desktopIp:$desktopPort/v1/pair/redeem")
    // A2-1/A2-3：配对这一步顺带把**这台手机的公钥**交出去（私钥永不出设备）。
    // 有 context 才做：没有身份文件时这里生成一把（生成只发生在配对，签名路径只读不生成）。
    // 身份文件存在但读坏了 ⇒ loadOrCreate 回 null ⇒ 不发公钥：宁可这次不登记设备，
    // 也不悄悄换一把钥匙把桌面上已登记的那台丢掉。
    val identity = identityContext?.let { DeviceIdentity.loadOrCreate(it) }
    val json = JSONObject()
      .put("code", code.trim())
      .put("device_name", deviceName)
      .put("machine_kind", "android")
    if (identity != null) json.put("device_public_key", identity.publicKeyPem.trim())
    val body = json.toString()

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
        // 设备这条只认**回执原文**：桌面说 registered 才算登记上，桌面派发的 id 才是身份。
        // 端上一律不许「自己配对成功 ⇒ 推断自己已经是设备」—— 那正是把这颗地雷咽掉的写法。
        val deviceObj = obj.optJSONObject("device")
        val deviceRegistered = deviceObj?.optBoolean("registered", false) ?: false
        val issuedDeviceId = deviceObj?.field("id")?.takeIf { it.isNotEmpty() }
        val requiresCredential = obj.optBoolean("requires_device_credential", false)
        if (deviceRegistered && issuedDeviceId != null && identity != null && identity.deviceId != issuedDeviceId) {
          identityContext?.let { DeviceIdentity.save(it, identity.copy(deviceId = issuedDeviceId)) }
        }
        Result.success(
          RedeemSuccess(
            baseUrl = baseUrl,
            turnToken = turnToken,
            baseUrlScope = baseUrlScope,
            deviceRegistered = deviceRegistered,
            deviceId = issuedDeviceId,
            requiresDeviceCredential = requiresCredential,
          ),
        )
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
    identityContext: android.content.Context? = TurnBridge.context(),
  ): Result<RedeemSuccess> {
    val result = redeemCode(desktop.ip, desktop.port, code, deviceName, identityContext)
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
