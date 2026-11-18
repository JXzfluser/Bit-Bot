package com.bitbot.host

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * 跨端审批客户端(B-6):让**手机**也能决定"这台机器上等着批的操作"。
 *
 * 现状:手机端只能**显示**审批卡(`approval_card` widget),点不动。
 * 用户用手机发指令、Bot 要外发 ⇒ 审批卡弹在手机上 ⇒ 人得跑到电脑前点。
 * ⇒ 手机场景断在这里。
 *
 * 这份客户端把决定送回**那台常开的机器**(Box / 桌面):
 *   GET  {host}/v1/approvals                    → 待批准清单
 *   POST {host}/v1/approvals/{id}/decide        → 决定
 *
 * 鉴权用**设备签名**(B-4a),与 iOS 的 `DeviceIdentity.requestHeaders`、
 * 服务端 `device_keys.js` 同一套口径 —— 账号 = 设备密钥,没有别的身份。
 *
 * 决定的三档(与 CLI `scripts/approve.js`、iOS 侧、内核 `ApprovalClass` 同一套语义):
 *   · `allow_once` —— 只批这一次
 *   · `always`     —— 以后**同一件**不再问(默认写**作用域**规则,窄)
 *   · `always` + `scope:"wide"` —— 以后**这一类**都不问(宽)—— 必须显式确认
 *   · `deny`       —— 拒绝
 */
/** 决定词表 —— 必须与服务端 `hosts/desktop/product_surface.js` 里那行
 * `["allow_once", "always", "deny"]` **逐字一致**。 */
object ApprovalDecision {
    /** 只批这一次。 */
    const val ALLOW_ONCE = "allow_once"
    /** 以后**同一件**不再问(默认写**作用域**规则,窄)。 */
    const val ALWAYS = "always"
    /** 拒绝。 */
    const val DENY = "deny"

    val ALL = listOf(ALLOW_ONCE, ALWAYS, DENY)
}

class ApprovalClient(private val context: Context, private val hostUrl: String) {

    /** 待批准的一条。 */
    data class Pending(
        val id: String,
        val kind: String,
        /** 命令摘要(服务端已截到 240 字)—— 够人判断这是什么。 */
        val command: String,
        val source: String,
        val requestedAt: String,
        val expiresAt: String,
        val status: String,
    )

    /** 决定的结果。 */
    data class DecisionResult(
        val ok: Boolean,
        val decision: String,
        /** 写下的规则(`always` 才有)—— 让人知道到底授权了什么。 */
        val persistedPattern: String,
        /** 规则的作用域:scoped=窄规则 / kind=一类 / 空=没写规则。 */
        val persistedScope: String,
        val message: String,
    )

    private val io = Executors.newSingleThreadExecutor()

    /** 列出那台机器上等着批的操作。 */
    fun pending(callback: (Result<List<Pending>>) -> Unit) {
        io.execute {
            val result = runCatching {
                val body = ByteArray(0)
                val response = request("GET", "/v1/approvals", body)
                val rows = response.optJSONArray("pending") ?: JSONArray()
                (0 until rows.length()).map { i ->
                    val row = rows.getJSONObject(i)
                    Pending(
                        id = row.optString("id"),
                        kind = row.optString("kind"),
                        command = row.optString("command"),
                        source = row.optString("source"),
                        requestedAt = row.optString("requested_at"),
                        expiresAt = row.optString("expires_at"),
                        status = row.optString("status", "pending"),
                    )
                }
            }
            callback(result)
        }
    }

    /**
     * 做出决定。
     * @param wide true = 「以后**这一类**都不问」(宽授权,需显式确认)。
     */
    fun decide(
        id: String,
        decision: String,
        wide: Boolean = false,
        callback: (Result<DecisionResult>) -> Unit,
    ) {
        io.execute {
            val result = runCatching {
                val payload = JSONObject()
                payload.put("decision", decision)
                // scope:"wide" ⇒ 「总是允许」按**类**放行(kind:*)。
                // 不带 scope ⇒ 走**作用域**规则(kind:<作用域>),窄得多。
                if (wide && decision == "always") {
                    payload.put("scope", "wide")
                }
                val body = payload.toString().toByteArray(Charsets.UTF_8)
                val response = request(
                    "POST",
                    "/v1/approvals/" + java.net.URLEncoder.encode(id, "UTF-8") + "/decide",
                    body,
                )
                DecisionResult(
                    ok = response.optBoolean("ok", false),
                    decision = response.optString("decision", decision),
                    persistedPattern = response.optString("persisted_pattern"),
                    persistedScope = response.optString("persisted_scope"),
                    message = response.optString("note"),
                )
            }
            callback(result)
        }
    }

    /** 发一次带设备签名的请求(与 iOS、服务端同一套口径)。 */
    private fun request(method: String, path: String, body: ByteArray): JSONObject {
        val base = hostUrl.trimEnd('/')
        val connection = (URL(base + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15000
            readTimeout = 30000
            setRequestProperty("Accept", "application/json")
            if (method == "POST") {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        DeviceIdentity.requestHeaders(context, body)?.let { headers ->
            connection.setRequestProperty("x-bitbot-device", headers.deviceId)
            connection.setRequestProperty("x-bitbot-timestamp", headers.timestamp)
            connection.setRequestProperty("x-bitbot-nonce", headers.nonce)
            connection.setRequestProperty("x-bitbot-signature", headers.signature)
        }
        if (method == "POST") {
            connection.outputStream.use { it.write(body) }
        }
        val code = connection.responseCode
        val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
            ?.bufferedReader()
            ?.use { it.readText() }
            ?: ""
        if (code !in 200..299) {
            throw IllegalStateException("approval HTTP $code: $text")
        }
        return if (text.isBlank()) JSONObject() else JSONObject(text)
    }
}
