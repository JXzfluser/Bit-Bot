package com.bitbot.host

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * CM-0705 Host-side OS permission card / Settings guide.
 * Never pretend-grants. True system dialogs require Activity.requestPermissions on device.
 */
object DevicePermissionHost {
  data class Card(
    val machineId: String,
    val tool: String,
    val permission: String,
    val pretendGranted: Boolean = false,
    val status: String,
    val settingsGuide: String,
    val androidPermission: String?,
    /** Host FFI per-card JSON path when present (data/device/permission-cards/). */
    val cardPath: String? = null,
    val trueDeviceOsDialogResidual: Boolean = true,
    val at: String = Instant.now().toString(),
  )

  fun parseCommand(command: String): Triple<String, String, String> {
    val parts = command.split("|")
    return Triple(
      parts.getOrElse(0) { "phone-android" },
      parts.getOrElse(1) { "unknown" },
      parts.getOrElse(2) { "needs_permission" },
    )
  }

  fun androidPermissionFor(tool: String): String? {
    val t = tool.lowercase()
    return when {
      t.contains("camera") -> Manifest.permission.CAMERA
      t.contains("mic") || t.contains("microphone") || t.contains("audio") ->
        Manifest.permission.RECORD_AUDIO
      t.contains("location") -> Manifest.permission.ACCESS_FINE_LOCATION
      t.contains("photo") || t.contains("storage") || t.contains("file") ->
        if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES
        else Manifest.permission.READ_EXTERNAL_STORAGE
      else -> null
    }
  }

  fun raiseCard(context: Context?, command: String): Card {
    val (machineId, tool, permission) = parseCommand(command)
    val androidPerm = androidPermissionFor(tool)
    val status = when {
      context == null || androidPerm == null -> "host_card_pending_system_prompt"
      ContextCompat.checkSelfPermission(context, androidPerm) == PackageManager.PERMISSION_GRANTED ->
        "authorized"
      else -> "not_granted"
    }
    return Card(
      machineId = machineId,
      tool = tool,
      permission = permission,
      pretendGranted = false,
      status = status,
      settingsGuide = "Open Android Settings → Apps → Bit Bot → Permissions → $tool",
      androidPermission = androidPerm,
    )
  }

  fun cardsFromTurnJson(context: Context?, jsonLine: String): List<Card> {
    return runCatching {
      // Prefer first JSON object line (HostAbi trailers may follow).
      val line = jsonLine.trim().lineSequence().firstOrNull { it.trim().startsWith("{") }
        ?: jsonLine.trim().lineSequence().last { it.isNotBlank() }
      val obj = JSONObject(line.trim())
      val cards = mutableListOf<Card>()
      fun collect(arrName: String) {
        if (!obj.has(arrName)) return
        val arr: JSONArray = obj.getJSONArray(arrName)
        for (i in 0 until arr.length()) {
          val row = arr.optJSONObject(i) ?: continue
          if (row.optString("kind") != "device_permission") continue
          val c = row.optString("command")
          if (c.isBlank()) continue
          val base = raiseCard(context, c)
          var cardPath: String? = null
          var pretend = false
          var residual = true
          val stdout = row.optString("stdout")
          if (stdout.isNotBlank()) {
            runCatching {
              val payload = JSONObject(stdout)
              cardPath = payload.optString("path").ifBlank { null }
              pretend = payload.optBoolean("pretend_granted", false)
              residual = payload.optBoolean("true_device_os_dialog_residual", true)
            }
          }
          cards.add(
            base.copy(
              pretendGranted = pretend,
              cardPath = cardPath,
              trueDeviceOsDialogResidual = residual,
            ),
          )
        }
      }
      collect("host_results")
      if (cards.isEmpty()) collect("effects")
      cards
    }.getOrDefault(emptyList())
  }

  /** Permissions the Host may request via ActivityResultContracts (never auto-grant). */
  fun requiredManifestPermissions(): Array<String> = arrayOf(
    Manifest.permission.CAMERA,
    Manifest.permission.RECORD_AUDIO,
    Manifest.permission.ACCESS_FINE_LOCATION,
  )
}
