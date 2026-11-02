package com.bitbot.host

import org.json.JSONObject

/**
 * A1-4: SSE 回退提示文案（三语：zh-CN / zh-TW / en）。
 *
 * 设计决定（每条都有代价）：
 *  - 不许只写英文：三语都要有，缺一门就红（见 prove_android_event_stream.mjs AE-05）。
 *  - 走现有 i18n/文案机制：直接返回字符串，由 UI 层显示（不引入新的资源文件格式）。
 *  - 用户可读：不说机器码，说清楚「为什么没有实时进度」+「现在会怎样」。
 *  - 不许静默丢事件：回退时必须明说，不许让提示变成 display:none 之类的假动作。
 */
object EventStreamMessages {
  /**
   * 当前语言。
   *
   * 上一版这个 `var` 从没被赋值过 —— 于是 zh-TW / en 两个分支是**死代码**，
   * 繁体和英文用户拿到的是简体字。现在由 MainActivity 在 onCreate 时用
   * 系统配置调用 [localeFrom] 赋值（AE-10 钉住这条）。
   */
  @Volatile
  var currentLocale: String = "zh-CN"

  /**
   * 把系统 locale 归一到本模块的三档。
   *
   * 决策：`zh` + （TW/HK/MO 或 script=Hant）→ zh-TW；`en` → en；
   * **其它语言 → en**（不是 zh-CN）：一个德语用户不该被迫读简体字。
   * 代价：本 app 其余界面文案目前仍是硬编码简体中文，非中英用户会看到
   * 「中文界面 + 英文进度行」的混搭 —— 这条已如实记进残留，不在本轮解决。
   */
  fun localeFrom(language: String, country: String, script: String): String {
    val lang = language.lowercase()
    return when {
      lang == "en" -> "en"
      lang == "zh" -> {
        if (country.uppercase() in setOf("TW", "HK", "MO") || script.contains("Hant")) "zh-TW" else "zh-CN"
      }
      else -> "en"
    }
  }

  /** SSE 不可用（503 事件库未开）。 */
  fun eventStreamUnavailable(): String = when (currentLocale) {
    "zh-TW" -> "即時進度暫時不可用：桌面那邊的事件庫還沒開啟。現在會等整輪結果回來，不會卡住。"
    "en" -> "Live progress is temporarily unavailable: the desktop event log hasn't been enabled yet. " +
      "We'll wait for the full turn result instead — it won't get stuck."
    else -> "实时进度暂时不可用：桌面那边的事件库还没开启。现在会等整轮结果回来，不会卡住。"
  }

  /** SSE 未鉴权（401）。 */
  fun eventStreamUnauthorized(): String = when (currentLocale) {
    "zh-TW" -> "即時進度無法顯示：桌面拒絕了這次訂閱（配對凭证不對）。現在會等整輪結果回來。" +
      "去「凭证」重新複製一遍配對令牌再試。"
    "en" -> "Live progress can't be shown: the desktop rejected this subscription (pairing credentials mismatch). " +
      "We'll wait for the full turn result instead. " +
      "Go to Credentials and re-copy the pairing token, then try again."
    else -> "实时进度无法显示：桌面拒绝了这次订阅（配对凭证不对）。现在会等整轮结果回来。" +
      "去「凭证」重新复制一遍配对令牌再试。"
  }

  /** SSE HTTP 错误（其他状态码）。 */
  fun eventStreamHttpError(code: Int): String = when (currentLocale) {
    "zh-TW" -> "即時進度連線失敗（HTTP $code）：桌面那邊出了點問題。現在會等整輪結果回來，不會卡住。"
    "en" -> "Live progress connection failed (HTTP $code): something went wrong on the desktop side. " +
      "We'll wait for the full turn result instead — it won't get stuck."
    else -> "实时进度连接失败（HTTP $code）：桌面那边出了点问题。现在会等整轮结果回来，不会卡住。"
  }

  /** SSE 网络错误（超时/断网等）。 */
  fun eventStreamNetworkError(): String = when (currentLocale) {
    "zh-TW" -> "即時進度連線中斷：網路不穩或桌面離線了。現在會等整輪結果回來。" +
      "確認手機和桌面在同一 Wi-Fi，桌面沒休眠。"
    "en" -> "Live progress connection lost: unstable network or desktop is offline. " +
      "We'll wait for the full turn result instead. " +
      "Make sure the phone and desktop are on the same Wi-Fi, and the desktop isn't asleep."
    else -> "实时进度连接中断：网络不稳或桌面离线了。现在会等整轮结果回来。" +
      "确认手机和桌面在同一 Wi-Fi，桌面没休眠。"
  }

  /** 通用回退提示（根据 reason 分发）。 */
  fun fallbackMessage(reason: String): String = when (reason) {
    "event_stream_unavailable" -> eventStreamUnavailable()
    "event_stream_unauthorized" -> eventStreamUnauthorized()
    "event_stream_network_error" -> eventStreamNetworkError()
    else -> {
      // 提取 HTTP 状态码（如果有）
      val codeMatch = Regex("event_stream_http_(\\d+)").find(reason)
      if (codeMatch != null) {
        val code = codeMatch.groupValues[1].toIntOrNull() ?: 0
        eventStreamHttpError(code)
      } else {
        eventStreamNetworkError()
      }
    }
  }

  /**
   * A1-4: 进度行的三语文案。
   *
   * 这里的措辞**不是新造的**，逐条抄自桌面端 `hosts/desktop/index.html` 的
   * `progTool / progComputer / progFiles / progQuestion / progApproval / progVoice /
   * progModel`（简体中文 15924-15933、繁体中文 16718-16727、英文 17512-17521），
   * key 也沿用服务端的 `row.label_key`（`hosts/desktop/progress_protocol.js:81-88`）。
   * 同一件事在手机和桌面上必须是同一句话，否则两端对不上账，用户只能自己猜。
   */
  private fun progressLabel(key: String): String = when (currentLocale) {
    "zh-TW" -> when (key) {
      "progComputer" -> "正在操作電腦"
      "progFiles" -> "正在產生檔案"
      "progQuestion" -> "等你補充資訊"
      "progApproval" -> "等你核准"
      "progVoice" -> "正在處理語音"
      "progModel" -> "模型正在回覆"
      else -> "正在執行工具呼叫"
    }
    "en" -> when (key) {
      "progComputer" -> "Controlling the computer"
      "progFiles" -> "Creating files"
      "progQuestion" -> "Waiting for your input"
      "progApproval" -> "Waiting for your approval"
      "progVoice" -> "Processing voice"
      "progModel" -> "Model is replying"
      else -> "Running a tool"
    }
    else -> when (key) {
      "progComputer" -> "正在操作电脑"
      "progFiles" -> "正在生成文件"
      "progQuestion" -> "等你补充信息"
      "progApproval" -> "等你审批"
      "progVoice" -> "正在处理语音"
      "progModel" -> "模型正在回复"
      else -> "正在执行工具调用"
    }
  }

  /** 等待回应的后缀（桌面 progAwaiting）。 */
  private fun awaitingSuffix(): String = when (currentLocale) {
    "zh-TW" -> "等待你的回應"
    "en" -> "awaiting you"
    else -> "等待你的回应"
  }

  /** 失败后缀（桌面 progFailedSuffix）。 */
  private fun failedSuffix(): String = when (currentLocale) {
    "zh-TW" -> "未完成"
    "en" -> "not completed"
    else -> "未完成"
  }

  /** 「内核继续下一步」（桌面 progContinuing，这句不带计数）。 */
  private fun continuingLine(): String = when (currentLocale) {
    "zh-TW" -> "核心繼續下一步"
    "en" -> "Kernel continuing"
    else -> "内核继续下一步"
  }

  /** 进度区顶部的状态行。 */
  fun thinking(): String = when (currentLocale) {
    "zh-TW" -> "Bit Bot 正在想…"
    "en" -> "Bit Bot is thinking…"
    else -> "Bit Bot 正在想…"
  }

  /**
   * A1-4: 把一帧 progress 的 `row` 变成一行**人话**。
   *
   * 上一版这里是 `optString("row")` —— 服务端 `row` 是个对象
   * （`hosts/shared/turn_progress.js:121-128`：phase/index/total/kind/category/
   * label_key/command/at），`optString` 会把整个对象序列化成 JSON 文本，
   * 于是手机上显示 `进度：{"phase":"start","index":1,...}`。
   * 那不算「看得见进度」，那是把调试面板甩给用户。现在按 label_key + phase + 计数取词。
   */
  fun progressUpdate(row: JSONObject?): String {
    val phase = row?.optString("phase").orEmpty()
    if (phase == "continuing") return continuingLine()
    val base = progressLabel(row?.optString("label_key").orEmpty().ifEmpty { "progTool" })
    val text = when (phase) {
      "awaiting" -> "$base · ${awaitingSuffix()}"
      "failed" -> "$base · ${row?.optString("error").orEmpty().ifEmpty { failedSuffix() }}"
      else -> base
    }
    val index = row?.optInt("index") ?: 0
    val total = row?.optInt("total") ?: 0
    return if (total > 0 && index > 0) "$index/$total $text" else text
  }

  /** 回合开始提示（收到 turn_started 事件时显示）。 */
  fun turnStarted(initiator: String?): String {
    // 发起者缺失（服务端 turn_event_emitter.js:32 给的是空串，不是 null）时
    // 不许留下「回合开始（由  发起）」这种半截话 —— 空串在文案层就归一成「没有」。
    val who = initiator?.takeIf { it.isNotBlank() }
    return when (currentLocale) {
      "zh-TW" -> "回合開始${if (who != null) "（由 $who 發起）" else ""}"
      "en" -> "Turn started${if (who != null) " (initiated by $who)" else ""}"
      else -> "回合开始${if (who != null) "（由 $who 发起）" else ""}"
    }
  }

  /** 回合结束提示（收到 turn_ended 事件时显示）。 */
  fun turnEnded(status: String?): String = when (currentLocale) {
    "zh-TW" -> when (status) {
      "ok" -> "回合完成"
      "error" -> "回合出錯"
      "cancelled" -> "回合已取消"
      "awaiting_approval" -> "回合等待審批"
      else -> "回合結束"
    }
    "en" -> when (status) {
      "ok" -> "Turn completed"
      "error" -> "Turn failed"
      "cancelled" -> "Turn cancelled"
      "awaiting_approval" -> "Turn awaiting approval"
      else -> "Turn ended"
    }
    else -> when (status) {
      "ok" -> "回合完成"
      "error" -> "回合出错"
      "cancelled" -> "回合已取消"
      "awaiting_approval" -> "回合等待审批"
      else -> "回合结束"
    }
  }
}
