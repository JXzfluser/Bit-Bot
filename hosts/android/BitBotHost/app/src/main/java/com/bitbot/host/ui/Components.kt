package com.bitbot.host.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.Canvas
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll

/**
 * 首屏外壳（顶栏 + 内容 + 输入区）与各组件。
 *
 * 全部状态从外面灌进来：这样单测能在 JVM 上直接渲染「已配对空屏」「有一屏对话」「正在等回包」
 * 三种真实状态，而不是必须真发一次网络请求才看得到。旧版把状态全写在 setContent 里，
 * UI 因此不可验证 —— 这正是「说改了但没人能证明」的来源。
 */

/** 品牌标：一颗四角星，纯 Canvas 画，不引外部图片资源。 */
@Composable
fun BitBotMark(
  size: androidx.compose.ui.unit.Dp,
  modifier: Modifier = Modifier,
  tint: Color = MaterialTheme.colorScheme.primary,
) {
  Box(
    modifier = modifier.size(size),
    contentAlignment = Alignment.Center,
  ) {
    Canvas(modifier = Modifier.size(size)) {
      val cx = this.size.width / 2f
      val cy = this.size.height / 2f
      val outer = this.size.minDimension / 2f
      val inner = outer * 0.34f
      val path = Path()
      // 四角星：上下左右四个外尖 + 四个内收点
      path.moveTo(cx, cy - outer)
      path.quadraticBezierTo(cx + inner, cy - inner, cx + outer, cy)
      path.quadraticBezierTo(cx + inner, cy + inner, cx, cy + outer)
      path.quadraticBezierTo(cx - inner, cy + inner, cx - outer, cy)
      path.quadraticBezierTo(cx - inner, cy - inner, cx, cy - outer)
      path.close()
      drawPath(path, color = tint)
    }
  }
}

/** 字标：标 + Bit Bot。顶栏和空屏共用同一颗标，视觉上才是一个产品。 */
@Composable
fun BitBotWordmark(modifier: Modifier = Modifier) {
  Row(modifier, verticalAlignment = Alignment.CenterVertically) {
    BitBotMark(size = 22.dp)
    Spacer(Modifier.width(BitBotSpace.xs))
    Text(
      "Bit Bot",
      style = MaterialTheme.typography.titleLarge,
      color = MaterialTheme.colorScheme.onSurface,
    )
  }
}

/** 连接状态：一眼看得见连没连上，点一下就去配对。旧版这里什么都没有。 */
@Composable
fun ConnectionStatusChip(
  paired: Boolean,
  hostLabel: String?,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val scheme = MaterialTheme.colorScheme
  val dot = if (paired) scheme.primary else LocalBitBotExtras.current.dotIdle
  val label =
    when {
      !paired -> "未配对"
      hostLabel.isNullOrBlank() -> "已配对"
      else -> "已配对 · $hostLabel"
    }
  Row(
    modifier =
      modifier
        .clip(CircleShape)
        .background(scheme.surfaceVariant)
        .clickable(onClick = onClick)
        .padding(horizontal = BitBotSpace.md, vertical = BitBotSpace.xs + 2.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(BitBotSpace.xs + 2.dp),
  ) {
    Box(
      Modifier
        .size(8.dp)
        .clip(CircleShape)
        .background(dot)
    )
    Text(
      label,
      style = MaterialTheme.typography.labelMedium,
      color = scheme.onSurfaceVariant,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/** 顶栏：左边字标，中间状态，右边一个「更多」。不再是两个裸文字按钮。 */
@Composable
fun AppTopBar(
  paired: Boolean,
  hostLabel: String?,
  onOpenStatus: () -> Unit,
  onOpenMenu: () -> Unit,
) {
  Row(
    Modifier
      .fillMaxWidth()
      .padding(horizontal = BitBotSpace.md, vertical = BitBotSpace.sm),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    BitBotWordmark()
    Spacer(Modifier.width(BitBotSpace.sm))
    ConnectionStatusChip(
      paired = paired,
      hostLabel = hostLabel,
      onClick = onOpenStatus,
      modifier = Modifier.weight(1f, fill = false),
    )
    Spacer(Modifier.weight(1f))
    IconButton(onClick = onOpenMenu) {
      Icon(
        Icons.Filled.MoreVert,
        contentDescription = "更多",
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

/** 空屏：一个主行动（连接）+ 一个次级入口（手填，兜底路不删）。 */
@Composable
fun EmptyHero(
  paired: Boolean,
  onConnect: () -> Unit,
  onOpenCredentials: () -> Unit,
  suggestions: List<String>,
  onPickSuggestion: (String) -> Unit,
) {
  Column(
    Modifier
      .fillMaxWidth()
      .padding(horizontal = BitBotSpace.xxxl),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    BitBotMark(size = 56.dp)
    Spacer(Modifier.height(BitBotSpace.lg))
    Text("Bit Bot", style = MaterialTheme.typography.displaySmall)
    Spacer(Modifier.height(BitBotSpace.sm))
    Text(
      "连着桌面大脑的局域网 AI 助手",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(BitBotSpace.xxl))
    if (!paired) {
      PrimaryPillButton(text = "连接 Desktop", onClick = onConnect, fillWidth = true)
      Spacer(Modifier.height(BitBotSpace.sm))
      Text(
        "自动发现局域网里的桌面，输入桌面上那 6 位配对码就行",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      TextButton(onClick = onOpenCredentials) {
        Text("手动填配对地址", style = MaterialTheme.typography.labelMedium)
      }
    } else {
      Text(
        "已经连上了，说一句试试",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Spacer(Modifier.height(BitBotSpace.lg))
      Row(
        Modifier
          .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(BitBotSpace.sm),
      ) {
        suggestions.forEach { s ->
          SuggestionChip(text = s, onClick = { onPickSuggestion(s) })
        }
      }
    }
  }
}

@Composable
fun SuggestionChip(
  text: String,
  onClick: () -> Unit,
) {
  val scheme = MaterialTheme.colorScheme
  Text(
    text,
    style = MaterialTheme.typography.labelLarge,
    color = scheme.onSurfaceVariant,
    modifier =
      Modifier
        .clip(CircleShape)
        .border(1.dp, scheme.outlineVariant, CircleShape)
        .clickable(onClick = onClick)
        .padding(horizontal = BitBotSpace.md, vertical = BitBotSpace.sm),
  )
}

/** 主行动键：胶囊、accent 实底、白字。 */
@Composable
fun PrimaryPillButton(
  text: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  fillWidth: Boolean = false,
) {
  val scheme = MaterialTheme.colorScheme
  val bg = if (enabled) scheme.primary else scheme.surfaceVariant
  val fg = if (enabled) scheme.onPrimary else scheme.onSurfaceVariant
  Box(
    modifier =
      modifier
        .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
        .height(48.dp)
        .clip(CircleShape)
        .background(bg)
        .clickable(enabled = enabled, onClick = onClick)
        .semantics { contentDescription = text },
    contentAlignment = Alignment.Center,
  ) {
    Text(
      text,
      style = MaterialTheme.typography.labelLarge,
      color = fg,
      modifier = Modifier.padding(horizontal = BitBotSpace.xl),
    )
  }
}

/**
 * 一屏对话。
 *
 * 说话人不靠「你」「Bit Bot」两个小标签区分，靠位置 + 底色：用户是右侧 accent 气泡，
 * 助手直接铺在画布上（和主流 AI 助手一样，正文是主角，不套气泡框）。
 */
@Composable
fun ChatListView(
  lines: List<ChatLine>,
  busy: Boolean,
  modifier: Modifier = Modifier,
) {
  val listState = rememberLazyListState()
  androidx.compose.runtime.LaunchedEffect(lines.size, busy) {
    val target = if (busy) lines.size else lines.size - 1
    if (target >= 0 && lines.isNotEmpty()) listState.animateScrollToItem(target.coerceAtMost(lines.size - 1))
  }
  LazyColumn(
    state = listState,
    modifier = modifier.fillMaxWidth(),
    contentPadding = androidx.compose.foundation.layout.PaddingValues(
      horizontal = BitBotSpace.lg,
      vertical = BitBotSpace.md,
    ),
    verticalArrangement = Arrangement.spacedBy(BitBotSpace.lg),
  ) {
    items(lines) { line -> ChatRow(line) }
    if (busy) {
      item { WaitingRow() }
    }
  }
}

@Composable
private fun ChatRow(line: ChatLine) {
  val scheme = MaterialTheme.colorScheme
  val extras = LocalBitBotExtras.current
  if (line.role == "user") {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
      Text(
        line.text,
        style = MaterialTheme.typography.bodyLarge,
        color = extras.onUserBubble,
        modifier =
          Modifier
            // 86% 上限：窄屏不会顶到边，宽屏不会出现一整行只有一句话贴在右边。
            .fillMaxWidth(0.86f)
            .clip(RoundedCornerShape(BitBotRadius.bubble))
            .background(extras.userBubble)
            .padding(horizontal = BitBotSpace.md, vertical = BitBotSpace.sm + 2.dp),
      )
    }
  } else {
    Column(Modifier.widthIn(max = 640.dp)) {
      Text(
        line.text,
        style = MaterialTheme.typography.bodyLarge,
        color = scheme.onSurface,
      )
      // 内核的原始回执照旧给得出来：默认读人话，愿意看事实的人一处展开。
      if (line.raw != null) {
        var open by remember { mutableStateOf(false) }
        TextButton(onClick = { open = !open }) {
          Text(
            if (open) "收起原始回执" else "看原始回执",
            style = MaterialTheme.typography.labelLarge,
            color = scheme.onSurfaceVariant,
          )
        }
        if (open) {
          Text(
            line.raw,
            style = BitBotMonoStyle,
            color = scheme.onSurfaceVariant,
            modifier =
              Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(BitBotRadius.card))
                .background(scheme.surfaceVariant)
                .padding(BitBotSpace.md),
          )
        }
      }
    }
  }
}

/** 等回包：一行说明 + 一条极细进度条。不用无限动画（会拖住测试的空闲判定）。 */
@Composable
private fun WaitingRow() {
  Column(
    Modifier
      .fillMaxWidth()
      .widthIn(max = 640.dp),
  ) {
    Text(
      "Bit Bot 正在想…",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(BitBotSpace.sm))
    Row(horizontalArrangement = Arrangement.spacedBy(BitBotSpace.xs)) {
      // 三颗静止的 accent 点：观感上有「在等」，但不引入无限动画
      repeat(3) {
        Box(
          Modifier
            .size(6.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.45f))
        )
      }
    }
  }
}

/** 投递证据条：SendToUserSurface 的 chips，收成中性小胶囊，不再是 tonal 面。 */
@Composable
fun DeliveryStrip(labels: List<String>) {
  if (labels.isEmpty()) return
  val scheme = MaterialTheme.colorScheme
  Row(
    Modifier
      .fillMaxWidth()
      .horizontalScroll(rememberScrollState())
      .padding(horizontal = BitBotSpace.lg, vertical = BitBotSpace.xs),
    horizontalArrangement = Arrangement.spacedBy(BitBotSpace.sm),
  ) {
    labels.take(8).forEach { label ->
      Text(
        label,
        style = BitBotMonoStyle,
        color = scheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier =
          Modifier
            .clip(RoundedCornerShape(BitBotRadius.chip))
            .background(scheme.surfaceVariant)
            .padding(horizontal = BitBotSpace.sm + 2.dp, vertical = BitBotSpace.xs + 2.dp),
      )
    }
  }
}

/** 输入区：胶囊输入框 + 圆形上箭头发送键。 */
@Composable
fun ComposerBar(
  value: String,
  onValueChange: (String) -> Unit,
  onSend: () -> Unit,
  enabled: Boolean,
) {
  val scheme = MaterialTheme.colorScheme
  Row(
    Modifier
      .fillMaxWidth()
      .padding(horizontal = BitBotSpace.md, vertical = BitBotSpace.sm)
      .padding(bottom = BitBotSpace.xs),
    verticalAlignment = Alignment.Bottom,
    horizontalArrangement = Arrangement.spacedBy(BitBotSpace.sm),
  ) {
    TextField(
      value = value,
      onValueChange = onValueChange,
      enabled = enabled,
      placeholder = { Text("给 Bit Bot 发消息…", style = MaterialTheme.typography.bodyLarge) },
      textStyle = MaterialTheme.typography.bodyLarge,
      maxLines = 5,
      shape = RoundedCornerShape(BitBotRadius.field),
      keyboardOptions = KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Send),
      keyboardActions = KeyboardActions(onSend = { if (canSend(enabled, value)) onSend() }),
      colors =
        TextFieldDefaults.colors(
          focusedContainerColor = scheme.surfaceVariant,
          unfocusedContainerColor = scheme.surfaceVariant,
          disabledContainerColor = scheme.surfaceVariant,
          focusedIndicatorColor = scheme.primary,
          unfocusedIndicatorColor = Color.Transparent,
          disabledIndicatorColor = Color.Transparent,
          cursorColor = scheme.primary,
          focusedTextColor = scheme.onSurface,
          unfocusedTextColor = scheme.onSurface,
          disabledTextColor = scheme.onSurfaceVariant,
        ),
      modifier =
        Modifier
          .weight(1f)
          .heightIn(min = 48.dp, max = 140.dp),
    )
    val active = canSend(enabled, value)
    Box(
      Modifier
        .size(48.dp)
        .clip(CircleShape)
        .background(if (active) scheme.primary else scheme.surfaceVariant)
        .clickable(enabled = active, onClick = onSend)
        .semantics { contentDescription = "发送" },
      contentAlignment = Alignment.Center,
    ) {
      Icon(
        Icons.Filled.KeyboardArrowUp,
        contentDescription = null,
        tint = if (active) scheme.onPrimary else scheme.onSurfaceVariant,
      )
    }
  }
}

private fun canSend(enabled: Boolean, value: String): Boolean = enabled && value.isNotBlank()

/** 面板标题行：标题 + 副标题 + 关闭。三个面板共用一个头部，不再各写各的。 */
@Composable
fun SheetHeader(
  title: String,
  subtitle: String? = null,
  onClose: () -> Unit,
) {
  Row(
    Modifier
      .fillMaxWidth()
      .padding(horizontal = BitBotSpace.lg, vertical = BitBotSpace.sm),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f)) {
      Text(title, style = MaterialTheme.typography.titleLarge)
      if (subtitle != null) {
        Text(
          subtitle,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
    IconButton(onClick = onClose) {
      Icon(
        Icons.Filled.Close,
        contentDescription = "关闭",
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

/** 面板里的一行可点项。 */
@Composable
fun SheetActionRow(
  title: String,
  detail: String? = null,
  onClick: () -> Unit,
  enabled: Boolean = true,
) {
  val scheme = MaterialTheme.colorScheme
  Column(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(BitBotRadius.card))
      .clickable(enabled = enabled, onClick = onClick)
      .padding(horizontal = BitBotSpace.md, vertical = BitBotSpace.sm + 4.dp),
  ) {
    Text(
      title,
      style = MaterialTheme.typography.bodyLarge,
      color = if (enabled) scheme.onSurface else scheme.onSurfaceVariant,
    )
    if (detail != null) {
      Text(
        detail,
        style = MaterialTheme.typography.bodySmall,
        color = scheme.onSurfaceVariant,
      )
    }
  }
}

/** 面板里的一块可选内容（卡片底）。 */
@Composable
fun SheetCard(
  modifier: Modifier = Modifier,
  shape: Shape = RoundedCornerShape(BitBotRadius.card),
  content: @Composable () -> Unit,
) {
  Box(
    modifier =
      modifier
        .fillMaxWidth()
        .clip(shape)
        .background(MaterialTheme.colorScheme.surfaceVariant)
        .padding(BitBotSpace.md),
  ) { content() }
}

/** 输入框标签：人话标签 + 可选说明，绝不再把环境变量名当 label。 */
@Composable
fun FieldLabel(
  text: String,
  hint: String? = null,
) {
  Column(Modifier.padding(bottom = BitBotSpace.xs + 2.dp)) {
    Text(text, style = MaterialTheme.typography.labelLarge)
    if (hint != null) {
      Text(
        hint,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

