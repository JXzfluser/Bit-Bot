package com.bitbot.host

import android.content.Context
import com.bitbot.host.ui.ChatLine
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 聊天记录的本机落盘 —— 只做三件事：读回来、存下去、有界。
 *
 * 为什么要这一层：`HomeShell` 的 `lines` 是 `remember { mutableStateListOf() }`，
 * 组合一散就没（转屏），进程被杀重开更没。用户在手机上打了一句话、转个身就回到空态，
 * 这是「完全不知道如何使用」里最难看的一种。
 *
 * 为什么是 filesDir 下一个 JSON 而不是 SharedPreferences：对话本来就是「一整段有序文本」，
 * 键值存储会把整段历史塞进一个字符串里，语义还是这个文件的事；filesDir 是应用私有目录，
 * 外部存储上的文件别的 app（以及不拔 USB 线的人）也能读到，聊天记录不该放那儿
 * —— 这一条由 ChatThreadPersistenceTest CP-03 断着。
 *
 * 安全边界：这里只落用户自己说的话与呈现层已经决定给人看的文本。配对令牌、Authorization
 * 一概不写进来（CP-04 断着），因为这份文件会留在机器上，而凭证不该多一处副本。
 *
 * 失败语义：读不出（文件不在 / 半个 JSON / 目录占位）就当没有历史；写不进（磁盘满 / 路径被占）
 * 只回 false。落盘是附赠的，不能反过来把「发送」这条路拦住。
 */
class ChatHistoryStore(
  context: Context,
  private val maxLines: Int = DEFAULT_MAX_LINES,
) {
  private val appContext = context.applicationContext

  /** 路径是公开的一条：测试按它查，产品按它写，不许两处各猜一个名字。 */
  val file: File = File(appContext.filesDir, "chat-history.json")

  /** 读回来。坏文件与缺失都回空表，绝不抛 —— 首屏不能因为一个坏历史文件黑屏。 */
  fun load(): List<ChatLine> {
    val text = runCatching { if (file.isFile) file.readText() else "" }.getOrDefault("")
    if (text.isBlank()) return emptyList()
    val arr = runCatching { JSONArray(text) }.getOrNull() ?: return emptyList()
    val out = ArrayList<ChatLine>(arr.length())
    for (i in 0 until arr.length()) {
      val obj = arr.optJSONObject(i) ?: continue
      val role = obj.optString("role")
      val body = obj.optString("text")
      if (role.isEmpty() || body.isEmpty()) continue
      val raw =
        if (obj.isNull("raw")) null
        else obj.optString("raw").takeIf { it.isNotEmpty() }
      out.add(ChatLine(role, body, raw))
    }
    return if (out.size > maxLines) out.takeLast(maxLines) else out
  }

  /** 整段覆盖式写入：先落临时文件再改名，读侧不会看到半截 JSON。 */
  fun save(lines: List<ChatLine>): Boolean {
    val keep = if (lines.size > maxLines) lines.takeLast(maxLines) else lines
    val arr = JSONArray()
    for (line in keep) {
      val obj = JSONObject().put("role", line.role).put("text", line.text)
      if (line.raw != null) obj.put("raw", line.raw)
      arr.put(obj)
    }
    val payload = arr.toString()
    return runCatching {
      val parent = file.parentFile
      if (parent != null && !parent.isDirectory) parent.mkdirs()
      val tmp = File(file.parentFile, file.name + ".tmp")
      tmp.writeText(payload)
      if (tmp.renameTo(file)) return@runCatching true
      tmp.delete()
      // 改名不可用（跨设备 / 目标被占）时退直接写；再不行就是真失败
      file.writeText(payload)
      true
    }.getOrDefault(false)
  }

  companion object {
    /** 有界：只留最近这么多条。不界的写法早晚会把这台机器上的对话全留在盘上。 */
    const val DEFAULT_MAX_LINES = 300
  }
}
