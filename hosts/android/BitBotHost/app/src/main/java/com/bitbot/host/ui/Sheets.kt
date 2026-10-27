package com.bitbot.host.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp

/**
 * 四个面板：更多 / 凭证 / 能力 / 配对。
 *
 * 统一规则（旧版是四个面板各写各的，样式、间距、标题全不一样）：
 *   - 同一个 SheetHeader；
 *   - 输入框一律带人话 label + 一行的「去哪儿拿这个值」；
 *   - 主行动只有一颗胶囊键；
 *   - 令牌默认打码，可以点亮眼睛看，明文不落屏。
 */

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BitBotSheet(
  onDismiss: () -> Unit,
  sheetState: SheetState,
  content: @Composable () -> Unit,
) {
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
    containerColor = MaterialTheme.colorScheme.surface,
    contentColor = MaterialTheme.colorScheme.onSurface,
    shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
  ) {
    Column(
      Modifier
        .fillMaxWidth()
        .verticalScroll(rememberScrollState())
        .padding(bottom = BitBotSpace.xxl),
    ) { content() }
  }
}

/** 更多：把「凭证」「能力」这两个裸文字入口收进来，顶栏只留状态和一个键。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MenuSheet(
  paired: Boolean,
  hostLabel: String?,
  onCredentials: () -> Unit,
  onCapabilities: () -> Unit,
  onPairing: () -> Unit,
  onClearChat: () -> Unit,
  onDismiss: () -> Unit,
) {
  val state = rememberModalBottomSheetState()
  BitBotSheet(onDismiss = onDismiss, sheetState = state) {
    SheetHeader(title = "Bit Bot", subtitle = if (paired) "已配对 · ${hostLabel ?: "桌面"}" else "还没配对桌面大脑", onClose = onDismiss)
    Spacer(Modifier.height(BitBotSpace.xs))
    SheetActionRow(title = "凭证", detail = "配对地址与配对令牌", onClick = onCredentials)
    SheetActionRow(title = "能力", detail = "国内渠道 / 设备 / 定时", onClick = onCapabilities)
    SheetActionRow(
      title = if (paired) "重新配对" else "连接 Desktop",
      detail = "局域网自动发现，输 6 位配对码",
      onClick = onPairing,
    )
    // 对话现在会留在本机（转屏、重开都还在），所以「清掉」也得留在界面上：
    // 只加持久化不给出口，等于把这台机器上的聊天变成删不掉的东西。
    SheetActionRow(title = "清空对话", detail = "本机这段记录，不碰配对与凭证", onClick = onClearChat)
  }
}

@Composable
private fun BitBotField(
  value: String,
  onValueChange: (String) -> Unit,
  placeholder: String,
  singleLine: Boolean = true,
  masked: Boolean = false,
  trailing: @Composable (() -> Unit)? = null,
) {
  val scheme = MaterialTheme.colorScheme
  OutlinedTextField(
    value = value,
    onValueChange = onValueChange,
    placeholder = { Text(placeholder, style = MaterialTheme.typography.bodyMedium) },
    singleLine = singleLine,
    textStyle = MaterialTheme.typography.bodyLarge,
    shape = RoundedCornerShape(BitBotRadius.card),
    visualTransformation = if (masked) PasswordVisualTransformation() else VisualTransformation.None,
    trailingIcon = trailing,
    colors =
      OutlinedTextFieldDefaults.colors(
        focusedBorderColor = scheme.primary,
        unfocusedBorderColor = scheme.outline,
        focusedLabelColor = scheme.primary,
        cursorColor = scheme.primary,
      ),
    modifier = Modifier.fillMaxWidth(),
  )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CredentialsSheet(
  hostDraft: String,
  onHostChange: (String) -> Unit,
  tokenDraft: String,
  onTokenChange: (String) -> Unit,
  endpointPreview: String?,
  missingHint: String?,
  onSave: () -> Unit,
  onOpenPairing: () -> Unit,
  onDismiss: () -> Unit,
) {
  val scheme = MaterialTheme.colorScheme
  var reveal by remember { mutableStateOf(false) }
  val state = rememberModalBottomSheetState()
  BitBotSheet(onDismiss = onDismiss, sheetState = state) {
    SheetHeader(
      title = "凭证",
      subtitle = "模型 key 和国内渠道都在桌面「凭证」里配；这台手机只填配对地址与配对令牌",
      onClose = onDismiss,
    )
    Column(Modifier.padding(horizontal = BitBotSpace.lg), verticalArrangement = Arrangement.spacedBy(BitBotSpace.md)) {
      Column {
        FieldLabel("配对地址", "桌面「设置 → 凭证 → 手机配对」里那一串，或 192.168.1.10:18765")
        BitBotField(value = hostDraft, onValueChange = onHostChange, placeholder = "192.168.1.10:18765")
      }
      Column {
        FieldLabel("配对令牌", "同一屏里点「显示配对令牌」再复制，整串粘过来")
        BitBotField(
          value = tokenDraft,
          onValueChange = onTokenChange,
          placeholder = "从桌面复制的那一串",
          masked = !reveal,
          trailing = {
            // 眼睛图标属于 material-icons-extended（整包几百个图标，为它增大 APK 不值）：
            // 这里用两颗文字键，语义和 contentDescription 一样能断言。
            TextButton(onClick = { reveal = !reveal }) {
              Text(
                if (reveal) "隐藏" else "显示",
                style = MaterialTheme.typography.labelMedium,
                color = scheme.primary,
              )
            }
          },
        )
      }
      val broken = missingHint != null || endpointPreview == null
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
          Modifier
            .size(8.dp)
            .clip(CircleShape)
            .background(if (broken) scheme.error else scheme.primary),
        )
        Spacer(Modifier.size(BitBotSpace.sm))
        Text(
          when {
            missingHint != null -> "发送一定会失败：$missingHint（另一栏已经填了）"
            endpointPreview != null -> "实际调用：$endpointPreview"
            else -> "未配对：填好这两栏之前，发送一定会失败"
          },
          style = MaterialTheme.typography.bodySmall,
          color = if (broken) scheme.error else scheme.onSurfaceVariant,
        )
      }
      PrimaryPillButton(text = "保存并热加载", onClick = onSave, fillWidth = true)
      TextButton(onClick = onOpenPairing) {
        Text("不想抄地址？用 6 位配对码连接", style = MaterialTheme.typography.labelMedium)
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CapabilitiesSheet(
  actions: List<Pair<String, String>>,
  enabled: Boolean,
  onPick: (String) -> Unit,
  onDismiss: () -> Unit,
) {
  val state = rememberModalBottomSheetState()
  BitBotSheet(onDismiss = onDismiss, sheetState = state) {
    SheetHeader(
      title = "能力",
      subtitle = "点了就把这一句发给桌面大脑；没接上的会如实报错，不假装成功",
      onClose = onDismiss,
    )
    Column(Modifier.padding(horizontal = BitBotSpace.sm)) {
      actions.forEach { (label, turn) ->
        SheetActionRow(title = label, detail = turn, enabled = enabled, onClick = { onPick(turn) })
      }
    }
  }
}

/** 桌面卡片：选中的那台用 accent 描边，没生成配对码的直接标红说明。 */
@Composable
private fun DesktopCard(
  name: String,
  address: String,
  codeActive: Boolean,
  selected: Boolean,
  onClick: () -> Unit,
) {
  val scheme = MaterialTheme.colorScheme
  Column(
    Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(BitBotRadius.card))
      .background(if (selected) scheme.primaryContainer else scheme.surfaceVariant)
      .clickable(onClick = onClick)
      .padding(BitBotSpace.md),
    verticalArrangement = Arrangement.spacedBy(BitBotSpace.xxs),
  ) {
    Text(
      name,
      style = MaterialTheme.typography.titleMedium,
      color = if (selected) scheme.onPrimaryContainer else scheme.onSurface,
    )
    Text(
      address,
      style = BitBotMonoStyle,
      color = if (selected) scheme.onPrimaryContainer else scheme.onSurfaceVariant,
    )
    if (!codeActive) {
      Text(
        "桌面还没生成配对码",
        style = MaterialTheme.typography.labelSmall,
        color = scheme.error,
      )
    }
  }
}

/**
 * 配对面板：自动发现 + 6 位码。逻辑与 pairing-v1 完全不变，这里只重排版面。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairingSheet(
  scanState: PairingScanState,
  discovered: List<PairingDesktop>,
  selected: PairingDesktop?,
  onSelect: (PairingDesktop) -> Unit,
  codeInput: String,
  onCodeChange: (String) -> Unit,
  portInput: String,
  onPortChange: (String) -> Unit,
  redeemState: PairingRedeemState,
  onScan: () -> Unit,
  onRedeem: () -> Unit,
  onOpenCredentials: () -> Unit,
  onDismiss: () -> Unit,
) {
  val scheme = MaterialTheme.colorScheme
  val state = rememberModalBottomSheetState()
  BitBotSheet(onDismiss = onDismiss, sheetState = state) {
    SheetHeader(
      title = "连接 Desktop",
      subtitle = "同一 Wi-Fi 里自动找，找到就点一下，再输桌面上那 6 位码",
      onClose = onDismiss,
    )
    Column(Modifier.padding(horizontal = BitBotSpace.lg), verticalArrangement = Arrangement.spacedBy(BitBotSpace.md)) {
      when (scanState) {
        PairingScanState.Idle -> {
          Column {
            FieldLabel("桌面端口", "桌面没改过就留默认 18765")
            BitBotField(
              value = portInput,
              onValueChange = { v -> onPortChange(v.filter { it.isDigit() }.take(5)) },
              placeholder = "18765",
            )
          }
          PrimaryPillButton(text = "开始扫描", onClick = onScan, fillWidth = true)
        }

        PairingScanState.Scanning -> Text(
          "正在扫描局域网…",
          style = MaterialTheme.typography.bodyMedium,
          color = scheme.onSurfaceVariant,
        )

        is PairingScanState.Done ->
          if (discovered.isEmpty()) {
            Text(
              "同一 Wi-Fi 里没找到 Desktop：桌面上先点一下「生成配对码」，再重新扫描。",
              style = MaterialTheme.typography.bodyMedium,
              color = scheme.error,
            )
            PrimaryPillButton(text = "重新扫描", onClick = onScan, fillWidth = true)
          } else {
            Text(
              "找到 ${discovered.size} 台桌面，点一台：",
              style = MaterialTheme.typography.bodyMedium,
            )
            discovered.forEach { d ->
              DesktopCard(
                name = d.name,
                address = "${d.ip}:${d.port}",
                codeActive = d.codeActive,
                selected = selected == d,
                onClick = { onSelect(d) },
              )
            }
          }

        is PairingScanState.Error -> {
          Text(
            scanState.message,
            style = MaterialTheme.typography.bodyMedium,
            color = scheme.error,
          )
          PrimaryPillButton(text = "重试", onClick = onScan, fillWidth = true)
        }
      }

      if (selected != null && scanState is PairingScanState.Done) {
        Column {
          FieldLabel("配对码", "桌面上那六个数字，5 分钟内有效，用一次就作废")
          BitBotField(
            value = codeInput,
            onValueChange = { v -> onCodeChange(v.filter { it.isDigit() }.take(6)) },
            placeholder = "6 位数字",
          )
        }
        when (redeemState) {
          is PairingRedeemState.Error -> Text(
            redeemState.message,
            style = MaterialTheme.typography.bodySmall,
            color = scheme.error,
          )
          is PairingRedeemState.Success -> Text(
            redeemState.message,
            style = MaterialTheme.typography.bodySmall,
            color = scheme.primary,
          )
          else -> {}
        }
        PrimaryPillButton(
          text = if (redeemState is PairingRedeemState.Redeeming) "配对中…" else "配对",
          onClick = onRedeem,
          enabled = codeInput.length == 6 && redeemState !is PairingRedeemState.Redeeming,
          fillWidth = true,
        )
      }

      TextButton(onClick = onOpenCredentials) {
        Text("高级：手动填写配对地址和令牌", style = MaterialTheme.typography.labelMedium)
      }
    }
  }
}
