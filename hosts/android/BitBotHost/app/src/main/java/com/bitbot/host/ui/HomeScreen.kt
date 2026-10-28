package com.bitbot.host.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/**
 * 首屏（唯一一屏）。状态全部由 MainActivity 灌进来，所以这一屏可以在 JVM 上被真渲染、
 * 真断言 —— 旧版把状态埋在 setContent 的 lambda 里，UI 因此无法验证。
 */
data class ChatLine(val role: String, val text: String, val raw: String? = null)

/** 已配对却没有对话时给的提示键：把「不知道说什么」这一步替用户迈出去。 */
val BitBotSuggestions =
  listOf(
    "今天有什么热点",
    "帮我把这篇稿子改一版标题",
    "把最新的稿子推到邮箱",
  )

@Composable
fun HomeScreen(
  lines: List<ChatLine>,
  busy: Boolean,
  input: String,
  onInputChange: (String) -> Unit,
  onSend: () -> Unit,
  onSendSuggestion: (String) -> Unit,
  deliveryLabels: List<String>,
  paired: Boolean,
  hostLabel: String?,
  onOpenPairing: () -> Unit,
  onOpenCredentials: () -> Unit,
  onOpenMenu: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier
      .fillMaxSize()
      .background(MaterialTheme.colorScheme.surface),
    // 键盘避让只在 manifest 里用 windowSoftInputMode="adjustResize" 做一次。
    // 这里再叠 .imePadding() 会变成双重补偿：键盘弹起时输入框被顶出一段空白。
  ) {
    AppTopBar(
      paired = paired,
      hostLabel = hostLabel,
      onOpenStatus = { if (paired) onOpenCredentials() else onOpenPairing() },
      onOpenMenu = onOpenMenu,
    )

    Box(
      Modifier
        .weight(1f)
        .fillMaxWidth(),
    ) {
      if (lines.isEmpty()) {
        Column(
          Modifier
            .align(Alignment.Center)
            .verticalScroll(rememberScrollState())
            .padding(vertical = BitBotSpace.xxxl),
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          EmptyHero(
            paired = paired,
            onConnect = onOpenPairing,
            onOpenCredentials = onOpenCredentials,
            suggestions = BitBotSuggestions,
            onPickSuggestion = onSendSuggestion,
          )
        }
      } else {
        ChatListView(
          lines = lines,
          busy = busy,
          modifier = Modifier.fillMaxSize(),
        )
      }
    }

    DeliveryStrip(deliveryLabels)
    ComposerBar(
      value = input,
      onValueChange = onInputChange,
      onSend = onSend,
      enabled = !busy,
    )
  }
}
