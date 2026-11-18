package com.bitbot.host.ui

import com.bitbot.host.ApprovalClient
import com.bitbot.host.ApprovalDecision
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * 手机上的**审批面板**(B-6)。
 *
 * 之前手机只能**显示**审批卡(`approval_card` widget),点不动 ——
 * 用户用手机发指令、Bot 要外发 ⇒ 审批卡弹在手机上 ⇒ 人得跑到电脑前点。
 * 这一屏把「批」这件事放回手机上。
 *
 * 四个动作的语义(与 CLI `scripts/approve.js`、iOS 侧、内核同一套):
 *   · 允许一次 —— 只批这一次
 *   · 总是允许 —— 以后**同一件**不再问(默认写**作用域**规则,窄)
 *   · 总是允许这一类 —— 宽授权,要再确认一次(它授权的是那台机器)
 *   · 拒绝
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalSheet(
  client: ApprovalClient?,
  onDismiss: () -> Unit,
) {
  val state = rememberModalBottomSheetState()
  var rows by remember { mutableStateOf<List<ApprovalClient.Pending>>(emptyList()) }
  var busy by remember { mutableStateOf(false) }
  var message by remember { mutableStateOf("") }
  var wideConfirm by remember { mutableStateOf<ApprovalClient.Pending?>(null) }

  fun decide(row: ApprovalClient.Pending, decision: String, wide: Boolean) {
    val c = client ?: return
    busy = true
    c.decide(row.id, decision, wide) { result ->
      result
        .onSuccess { done ->
          message = if (done.persistedPattern.isEmpty()) {
            "已${decision}:${row.kind}"
          } else {
            "已${decision},写下的规则:${done.persistedPattern}"
          }
          c.pending { inner ->
            inner.onSuccess { rows = it }
            busy = false
          }
        }
        .onFailure { err ->
          message = err.message ?: "决定没送出去"
          busy = false
        }
    }
  }

  BitBotSheet(onDismiss = onDismiss, sheetState = state) {
    SheetHeader(
      title = "待批准",
      subtitle = if (client == null) "还没配对,或这台设备没有设备身份" else "批准写进的是那台机器的队列和规则",
      onClose = onDismiss,
    )
    Spacer(Modifier.height(BitBotSpace.xs))
    if (client == null) {
      Text(
        "先在「凭证」里配对 Desktop,并让这台设备拿到设备身份,再来批。",
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.padding(horizontal = BitBotSpace.md),
      )
    } else if (rows.isEmpty()) {
      Text(
        if (busy) "正在读…" else "没有等着批的操作",
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.padding(horizontal = BitBotSpace.md),
      )
    } else {
      Column(
        Modifier.padding(horizontal = BitBotSpace.md),
        verticalArrangement = Arrangement.spacedBy(BitBotSpace.sm),
      ) {
        rows.forEach { row ->
          Column(Modifier.fillMaxWidth()) {
            Text(row.kind, style = MaterialTheme.typography.titleSmall)
            Text(
              row.command,
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
              horizontalArrangement = Arrangement.spacedBy(BitBotSpace.xs),
              modifier = Modifier.padding(top = BitBotSpace.xs),
            ) {
              TextButton(onClick = { decide(row, ApprovalDecision.ALLOW_ONCE, false) }) {
                Text("允许一次")
              }
              TextButton(onClick = { decide(row, ApprovalDecision.ALWAYS, false) }) {
                Text("总是允许")
              }
              TextButton(onClick = { decide(row, ApprovalDecision.DENY, false) }) {
                Text("拒绝")
              }
            }
            // 宽授权不在列表里直接点 —— 它授权的是那台机器以后做这一类事。
            TextButton(onClick = { wideConfirm = row }) {
              Text("总是允许这一类(宽)")
            }
          }
        }
      }
    }
    if (message.isNotEmpty()) {
      Text(
        message,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.padding(horizontal = BitBotSpace.md, vertical = BitBotSpace.xs),
      )
    }
  }

  val pendingWide = wideConfirm
  if (pendingWide != null) {
    AlertDialog(
      onDismissRequest = { wideConfirm = null },
      title = { Text("宽授权") },
      text = {
        Text("这等于授权那台机器以后做**这一类**事都不再问你。默认的「总是允许」只授权同一件。")
      },
      confirmButton = {
        TextButton(onClick = {
          wideConfirm = null
          decide(pendingWide, ApprovalDecision.ALWAYS, true)
        }) {
          Text("确认:以后这一类都不再问")
        }
      },
      dismissButton = {
        TextButton(onClick = { wideConfirm = null }) { Text("取消") }
      },
    )
  }

  LaunchedEffect(Unit) {
    val c = client ?: return@LaunchedEffect
    busy = true
    c.pending { result ->
      result
        .onSuccess { rows = it }
        .onFailure { message = it.message ?: "读不到待批准的清单" }
      busy = false
    }
  }
}
