package com.bitbot.host.ui

import com.bitbot.host.RelayBootstrap
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
  /**
   * R-A3-6c：真机连接统计一行（`ConnectionStats.describe()`）。
   * 默认 null = 不显示，老调用点与既有 UI 单测一字不用改。
   */
  statsLine: String? = null,
  /** R-A3-6c：清零统计。默认 null = 不显示清零入口。 */
  onResetStats: (() -> Unit)? = null,
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
      // R-A3-6c：真机统计。只在有数据时出现；null 时整块不渲染。
      if (statsLine != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(
            statsLine,
            style = BitBotMonoStyle,
            color = scheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
          )
          if (onResetStats != null) {
            TextButton(onClick = onResetStats) {
              Text("清零", style = MaterialTheme.typography.labelMedium, color = scheme.primary)
            }
          }
        }
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
  templates: List<String> = emptyList(),
  onPickTemplate: (String) -> Unit = {},
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
      if (templates.isNotEmpty()) {
        Spacer(Modifier.height(BitBotSpace.md))
        Text(
          "全部指令模板（${templates.size}）",
          style = MaterialTheme.typography.titleMedium,
          modifier = Modifier.padding(horizontal = BitBotSpace.lg, vertical = BitBotSpace.xs),
        )
        Text(
          "点一条填进输入框；带 = 或空格的模板还要补参数，不直接发",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.padding(horizontal = BitBotSpace.lg, vertical = BitBotSpace.xs),
        )
        templates.forEach { template ->
          SheetActionRow(
            title = template,
            detail = "填入输入框",
            enabled = enabled,
            onClick = { onPickTemplate(template) },
          )
        }
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
  /**
   * A3-18：跨网配对。手机不在同一个 Wi-Fi 时扫不到桌面，只能靠用户把桌面生成的
   * 那段「跨网配对串」粘进来，兑换走 relay 隧道。
   *
   * 全部给了默认值，是为了不打爆既有调用点与既有 UI 单测 —— 不传就是老版面。
   */
  bootstrapInput: String = "",
  onBootstrapChange: (String) -> Unit = {},
  bootstrapState: PairingRedeemState = PairingRedeemState.Idle,
  onRedeemViaRelay: () -> Unit = {},
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

      // 配对码这一段现在有两个入口：局域网选中的那台，或者跨网配对串。
      // 两者都用同一个 6 位码（桌面只认一个码），所以输入框复用。
      val relayParsed = RelayBootstrap.parse(bootstrapInput)
      val relayReady = relayParsed is RelayBootstrap.Parsed.Ok
      if ((selected != null && scanState is PairingScanState.Done) || bootstrapInput.isNotBlank()) {
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
        if (selected != null && scanState is PairingScanState.Done) {
          PrimaryPillButton(
            text = if (redeemState is PairingRedeemState.Redeeming) "配对中…" else "配对",
            onClick = onRedeem,
            enabled = codeInput.length == 6 && redeemState !is PairingRedeemState.Redeeming,
            fillWidth = true,
          )
        }
      }

      /**
       * A3-18 跨网配对区。
       *
       * 为什么把它放在配对面板底部而不是「凭证」里：用户的心智是「我要连上这台桌面」，
       * 不是「我要配中转」。摆在配对这条路上，他才找得到。
       */
      Column {
        FieldLabel(
          "跨网配对（不在同一 Wi-Fi）",
          "桌面「中转设置 → 生成跨网配对串」，把整段粘到这里；手机走蜂窝也能配上",
        )
        BitBotField(
          value = bootstrapInput,
          onValueChange = onBootstrapChange,
          placeholder = "bitbot-relay://v1?h=…&p=…&b=…&t=…",
          singleLine = false,
        )
        // 解析结论如实说：缺哪栏就说缺哪栏，别只丢一句「格式不对」。
        val hint =
          when (relayParsed) {
            is RelayBootstrap.Parsed.Incomplete -> "还缺：" + relayParsed.missing.joinToString("、")
            is RelayBootstrap.Parsed.NotBootstrap -> "这不像配对串（要以 bitbot-relay://v1? 开头）"
            is RelayBootstrap.Parsed.Ok -> RelayBootstrap.describe(relayParsed.config)
            RelayBootstrap.Parsed.Empty -> null
          }
        if (!hint.isNullOrBlank()) {
          Text(
            hint,
            style = MaterialTheme.typography.bodySmall,
            color = if (relayReady) scheme.primary else scheme.error,
          )
        }
        when (bootstrapState) {
          is PairingRedeemState.Error -> Text(
            bootstrapState.message,
            style = MaterialTheme.typography.bodySmall,
            color = scheme.error,
          )
          is PairingRedeemState.Success -> Text(
            bootstrapState.message,
            style = MaterialTheme.typography.bodySmall,
            color = scheme.primary,
          )
          else -> {}
        }
        PrimaryPillButton(
          text = if (bootstrapState is PairingRedeemState.Redeeming) "经中转配对中…" else "经中转配对",
          onClick = onRedeemViaRelay,
          enabled = relayReady && codeInput.length == 6 && bootstrapState !is PairingRedeemState.Redeeming,
          fillWidth = true,
        )
      }

      TextButton(onClick = onOpenCredentials) {
        Text("高级：手动填写配对地址和令牌", style = MaterialTheme.typography.labelMedium)
      }
    }
  }
}
