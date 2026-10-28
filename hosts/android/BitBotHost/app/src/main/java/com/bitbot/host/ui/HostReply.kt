package com.bitbot.host.ui

import org.json.JSONArray
import org.json.JSONObject

/**
 * 桌面内核回包 → 手机上给人读的那一行。
 *
 * 为什么要有这一层：能力面板九个动作打出去，`/v1/turn` 最后一条 assistant 消息长这样 ——
 * `Host FFI results applied (MoonBit kernel / ADR 0002): - ok kind=routine_list cmd=...`
 * 后面跟一段围栏里的 JSON，里面是绝对路径、`BITBOT_*` 变量名、`pretend_*` 这类内核字段。
 * 直接贴到聊天里，用户看到的就是数据库转储，这正是「完全没法看」剩下的那一半。
 *
 * 这一层只做呈现：内核、store、IPC、`/v1/turn` 的 JSON 形状一个字都没改，原始回执照旧
 * 给得出来（[HostReplyDisplay.raw]，界面上「看原始回执」）。认不得的 kind 一律原样给出来，
 * 不编摘要 —— 宁可难看，也不许把事实猜错。
 */
data class HostReplyDisplay(val kind: String, val text: String, val raw: String?)

object HostReply {
  /** kind：`normal` 普通对话 / 具体内核 kind 名 / `unknown` 认不得的倾倒。 */
  fun display(body: String): HostReplyDisplay {
    val dump = lastAssistant(body) ?: return HostReplyDisplay("normal", body.trim(), null)
    if (!dump.startsWith("Host FFI results applied")) return HostReplyDisplay("normal", dump, null)

    val results = RESULT_LINE.findAll(dump).map { it.groupValues[1] to it.groupValues[2] }.toList()
    val payload = fenced(dump)
    if (results.isEmpty()) return HostReplyDisplay("unknown", dump, dump)
    // 认得的 kinds 逐条翻译；一条都不认得就整坨原样给出去 —— 呈现层不猜。
    val known = results.filter { LABELS.containsKey(it.second) }.distinctBy { it.second }
    if (known.isEmpty()) return HostReplyDisplay("unknown", dump, dump)
    val extras = results.filter { !LABELS.containsKey(it.second) }.distinctBy { it.second }
    val lines = known.map { (status, kind) -> line(kind, status, payload, dump) } +
      extras.map { (_, kind) -> "· 还有一条 `$kind` 回执没接进摘要，原文在下方展开。" }
    return HostReplyDisplay(known.first().second, lines.joinToString("\n"), dump)
  }

  /** 最后一条非空 assistant 文本：抽取逻辑只有 TurnBridge 一份，这里只加呈现。 */
  private fun lastAssistant(body: String): String? = com.bitbot.host.TurnBridge.assistantText(body)

  private val RESULT_LINE = Regex("^- (ok|fail) kind=([a-zA-Z_]+)", RegexOption.MULTILINE)

  /** 围栏里的内核原文；llm 那条是文本块，其他是 JSON。 */
  private fun fenced(dump: String): String {
    val open = dump.indexOf("```")
    if (open < 0) return ""
    val close = dump.indexOf("```", open + 3)
    if (close < 0) return ""
    return dump.substring(open + 3, close).trim()
  }

  private val LABELS =
    mapOf(
      "machines_list" to "设备花名册",
      "llm_list_models" to "模型服务商",
      "device_tools_list" to "这台设备上的工具",
      "routine_list" to "定时任务",
      "routine_tick" to "到点轮询",
      "check_updates" to "检查更新",
      "device_permission" to "设备权限",
      "approval_card" to "审批卡片",
    )

  private val CHANNELS =
    mapOf("dingtalk" to "钉钉", "feishu" to "飞书", "wecom" to "企业微信", "email" to "邮箱", "wps" to "WPS")

  private fun line(kind: String, status: String, payload: String, dump: String): String {
    val label = LABELS[kind] ?: kind
    if (status == "fail") return "· $label：内核报了失败，这条没当成成功。"
    return when (kind) {
      "machines_list" -> machines(payload)
      "llm_list_models" -> models(payload)
      "device_tools_list" -> tools(payload)
      "routine_list" -> routines(payload)
      "routine_tick" -> tick(payload)
      "check_updates" -> updates(payload)
      "device_permission" -> permission(payload)
      "approval_card" -> approval(dump)
      else -> "· $label：已执行。"
    }
  }

  private fun json(payload: String): JSONObject? = runCatching { JSONObject(payload) }.getOrNull()

  private fun machines(payload: String): String {
    val obj = json(payload) ?: return "· 设备花名册：已执行。"
    val machines = obj.optJSONArray("machines") ?: JSONArray()
    if (machines.length() == 0) return "· 设备花名册：${obj.optInt("count")} 台，但名单是空的。"
    val sb = StringBuilder("已注册 ${machines.length()} 台设备：")
    for (i in 0 until machines.length()) {
      val m = machines.optJSONObject(i) ?: continue
      val name = CHANNELS[m.optString("kind")] ?: KIND_NAMES[m.optString("kind")] ?: m.optString("kind")
      val online = m.optString("status") == "connected"
      sb.append("\n· ").append(name).append(" ").append(m.optString("id")).append(if (online) " 在线" else " 不在线")
    }
    return sb.toString()
  }

  private val KIND_NAMES = mapOf("desktop" to "桌面", "ios" to "iPhone", "android" to "安卓")

  private fun models(payload: String): String {
    val total = Regex("LLM providers \\((\\d+)\\)").find(payload)?.groupValues?.get(1)?.toIntOrNull()
      ?: Regex("\\n[*·] ").findAll(payload).count()
    val active = Regex("active=(\\S+)").find(payload)?.groupValues?.get(1)?.trimEnd()
    val missing = Regex("key=missing").findAll(payload).count()
    val configured = (total - missing).coerceAtLeast(0)
    val head = "模型服务商 $total 家，已配密钥 $configured 家"
    val tail = if (missing > 0) "。还有 $missing 家没配密钥，没配的那几家不会真回答。" else "。"
    val line = if (active != null) "\n当前指向 $active" else ""
    return head + tail + line
  }

  private fun tools(payload: String): String {
    val obj = json(payload) ?: return "· 设备工具：已执行。"
    val tools = obj.optJSONArray("tools") ?: JSONArray()
    val machine = obj.optString("machine_id")
    if (tools.length() == 0) return "· $machine 上没有可用工具（0 个）：内核没有把工具权限记成已授予。"
    val sb = StringBuilder("· $machine 上有 ${tools.length()} 个可用工具：")
    for (i in 0 until tools.length()) {
      val t = tools.optJSONObject(i)
      val name = if (t == null) tools.get(i).toString() else t.optString("name").ifEmpty { t.optString("tool") }.ifEmpty { t.toString() }
      sb.append("\n  - ").append(name)
    }
    return sb.toString()
  }

  private fun routines(payload: String): String {
    val obj = json(payload) ?: return "· 定时任务：已执行。"
    val count = obj.optInt("count")
    if (count == 0) return "定时任务 0 条：现在还没有到点会自动发的东西。"
    val sb = StringBuilder("定时任务 $count 条：")
    val rows = obj.optJSONArray("routines") ?: JSONArray()
    for (i in 0 until minOf(rows.length(), 5)) {
      val r = rows.optJSONObject(i) ?: continue
      val title = r.optString("label").ifEmpty { r.optString("title") }.ifEmpty { r.optString("id") }
      val when1 = r.optString("cron").ifEmpty { r.optString("schedule") }.ifEmpty { r.optString("at") }
      sb.append("\n· ").append(title)
      if (when1.isNotEmpty()) sb.append("（").append(when1).append("）")
    }
    if (rows.length() > 5) sb.append("\n…其余 ").append(rows.length() - 5).append(" 条见原始回执")
    return sb.toString()
  }

  private fun tick(payload: String): String {
    val obj = json(payload) ?: return "· 到点轮询：已执行。"
    val due = obj.optInt("due_count")
    val fired = obj.optInt("fired_count")
    return if (fired == 0) "这一轮到点的任务 $due 条，实际触发 $fired 条：现在没有该发的。"
    else "这一轮到点 $due 条，已触发 $fired 条。"
  }

  private fun updates(payload: String): String {
    val obj = json(payload) ?: return "· 检查更新：已执行。"
    val track = obj.optString("update_track").ifEmpty { "?" }
    val panel = if (obj.optBoolean("panel_open")) "桌面已经把更新面板打开" else "桌面没有打开更新面板"
    val feed = if (obj.isNull("feed_url") || obj.optBoolean("feed_residual")) "更新源还没接上（feed 未配置），这次查不到真版本" else "更新源已配置"
    val filing = obj.optJSONObject("filing")
    val icp = filing?.optString("icp").orEmpty()
    val algo = filing?.optString("algorithm").orEmpty()
    val filingLine =
      if (icp.isEmpty() || algo.isEmpty()) "ICP / 算法备案信息还没填，上线前是硬门槛"
      else "备案：$icp / $algo"
    return "更新通道 $track；$panel。\n更新源这一层：$feed。\n备案这一层：$filingLine。"
  }

  private fun permission(payload: String): String {
    val obj = json(payload) ?: return "· 设备权限：已执行。"
    val tool = TOOL_NAMES[obj.optString("tool")] ?: obj.optString("tool")
    val state = PERMISSION_STATE[obj.optString("permission")] ?: obj.optString("permission")
    val card = if (obj.optBoolean("os_card")) "桌面已经生成授权卡片" else "桌面没有生成授权卡片"
    val residual = if (obj.optBoolean("true_device_os_dialog_residual")) "真机系统弹窗这一层还没验过（这台机器没有模拟器）" else "真机授权已验证"
    return "$tool：$state（${obj.optString("machine_id")}）。$card；$residual。"
  }

  private val TOOL_NAMES = mapOf("camera" to "相机", "microphone" to "麦克风", "location" to "定位")
  private val PERMISSION_STATE = mapOf("unavailable" to "标记为不可用", "granted" to "已授予", "denied" to "被拒绝", "unknown" to "状态未知")

  /** 审批卡片：cmd 里带 external:<channel>:<id>，那才是「要往哪儿发」。 */
  private fun approval(dump: String): String {
    val channel = Regex("external:([a-zA-Z_]+):([^`\\s]+)").find(dump)
    val name = channel?.let { CHANNELS[it.groupValues[1]] ?: it.groupValues[1] }
    val target = if (name != null) "\n目标通道：$name · ${channel!!.groupValues[2]}" else ""
    return "这一步要人工确认，桌面已经生成审批卡片，没有自动执行。$target\n在桌面上点「批准」之后才会真发。"
  }
}
