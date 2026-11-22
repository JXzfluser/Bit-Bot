package com.bitbot.host.ui

import com.bitbot.host.EventStreamMessages
import com.bitbot.host.TaskCommandClient
import com.bitbot.host.TaskCommandRoutes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * 手机上的**指挥面板**(P1 批 5)。
 *
 * 桌面指挥台早就有插话 / 改向 / 刹停 / 换人四件套,但它们只挂在 Electron 的 IPC 上 ——
 * 手机够不着。批 4 把这四件事开成了 HTTP 路由(只认设备签名),这一屏是手机侧的那一半。
 *
 * 版面(方案 §3.4「手机端的界面形态」):
 *   顶部两个计数(要你拍板 N / 在跑 N)→ 任务卡列表 → 每卡一句输入 + 四个动作。
 *
 * 三条不许越过的线:
 *   ① 清单**只**从 `GET /v1/tasks` 读 —— 端上不存第二份真相;
 *   ② 能不能点**只**看服务端给的 `can.*` —— 端上不自己猜「在跑没在跑」;
 *   ③ 动作的语义一个字不改(插话=下一棒看得见 / 换人=下一棒生效 / 刹停=只停这一个)。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskCommandSheet(
  client: TaskCommandClient?,
  /** 回合结束(turn_ended)时 +1 ⇒ 这一屏据此刷新一次任务清单。 */
  epoch: Int,
  onDismiss: () -> Unit,
) {
  var tasks by remember { mutableStateOf<List<TaskCommandClient.TaskSummary>>(emptyList()) }
  var busy by remember { mutableStateOf(false) }
  var message by remember { mutableStateOf("") }
  /** 每张卡一句输入(桌面也是一张卡一个输入框,插话 / 改向 / 换人共用)。 */
  val drafts = remember { mutableStateMapOf<String, String>() }

  fun reload() {
    val c = client ?: return
    busy = true
    c.list { result ->
      result
        .onSuccess { list ->
          tasks = list.tasks
          message = ""
        }
        .onFailure { err ->
          message = err.message ?: TaskCommandMessages.readFailed()
        }
      busy = false
    }
  }

  /** 一次指挥之后:清掉那句输入、刷新清单、把结果说清楚。 */
  fun afterCommand(ok: Boolean, okText: String, err: Throwable?) {
    message = if (ok) okText else TaskCommandMessages.failed(err?.message ?: "")
    reload()
  }

  BitBotSheet(onDismiss = onDismiss) {
    SheetHeader(
      title = TaskCommandMessages.title(),
      subtitle = if (client == null) {
        TaskCommandMessages.notPaired()
      } else {
        TaskCommandMessages.subtitle()
      },
      onClose = onDismiss,
    )
    Spacer(Modifier.height(BitBotSpace.xs))

    if (client == null) {
      Text(
        TaskCommandMessages.notPairedHint(),
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.padding(horizontal = BitBotSpace.md),
      )
    } else {
      // 两个计数:要你拍板 / 在跑。桶是服务端算的,端上只数一数。
      Row(
        horizontalArrangement = Arrangement.spacedBy(BitBotSpace.md),
        modifier = Modifier.padding(horizontal = BitBotSpace.md),
      ) {
        Text(
          TaskCommandMessages.needsYouCount(tasks.count { it.bucket == "needs_you" }),
          style = MaterialTheme.typography.titleSmall,
        )
        Text(
          TaskCommandMessages.workingCount(tasks.count { it.bucket == "working" }),
          style = MaterialTheme.typography.titleSmall,
        )
      }
      Spacer(Modifier.height(BitBotSpace.xs))

      if (tasks.isEmpty()) {
        Text(
          if (busy) TaskCommandMessages.loading() else TaskCommandMessages.empty(),
          style = MaterialTheme.typography.bodyMedium,
          modifier = Modifier.padding(horizontal = BitBotSpace.md),
        )
      } else {
        Column(
          Modifier.padding(horizontal = BitBotSpace.md),
          verticalArrangement = Arrangement.spacedBy(BitBotSpace.md),
        ) {
          tasks.forEach { task ->
            TaskCommandCard(
              task = task,
              draft = drafts[task.taskSig].orEmpty(),
              onDraftChange = { drafts[task.taskSig] = it },
              onSteer = { text ->
                client.steer(task.taskSig, task.roomId, text) { result ->
                  result
                    .onSuccess { afterCommand(true, TaskCommandMessages.steered(), null) }
                    .onFailure { err -> afterCommand(false, "", err) }
                }
              },
              onReplan = { text ->
                client.replan(task.taskSig, task.roomId, text) { result ->
                  result
                    .onSuccess { afterCommand(true, TaskCommandMessages.replanned(), null) }
                    .onFailure { err -> afterCommand(false, "", err) }
                }
              },
              onCancel = {
                client.cancel(task.taskSig, task.roomId, "user_stop") { result ->
                  result
                    .onSuccess { done ->
                      afterCommand(true, TaskCommandMessages.cancelled(done.cancelled), null)
                    }
                    .onFailure { err -> afterCommand(false, "", err) }
                }
              },
              onSwap = { fromBot, toBot ->
                client.swap(task.taskSig, task.roomId, fromBot, toBot) { result ->
                  result
                    .onSuccess { afterCommand(true, TaskCommandMessages.swapped(), null) }
                    .onFailure { err -> afterCommand(false, "", err) }
                }
              },
            )
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

  // 打开时读一次;回合结束(epoch +1)再读一次 —— 那一轮跑完了,卡上的状态才变。
  LaunchedEffect(epoch, client) {
    reload()
  }
}

/** 一张任务卡:标题 / 群 / 成员 / 谁干了什么 + 一句输入 + 四个动作。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TaskCommandCard(
  task: TaskCommandClient.TaskSummary,
  draft: String,
  onDraftChange: (String) -> Unit,
  onSteer: (String) -> Unit,
  onReplan: (String) -> Unit,
  onCancel: () -> Unit,
  onSwap: (String, String) -> Unit,
) {
  val scheme = MaterialTheme.colorScheme
  Column(
    Modifier
      .fillMaxWidth()
      .padding(vertical = BitBotSpace.xs),
    verticalArrangement = Arrangement.spacedBy(BitBotSpace.xs),
  ) {
    Text(task.title, style = MaterialTheme.typography.titleSmall)
    Text(
      TaskCommandMessages.bucketLabel(task.bucket) + " · " +
        (task.roomTitle.ifBlank { task.roomId }),
      style = MaterialTheme.typography.labelSmall,
      color = scheme.onSurfaceVariant,
    )
    if (task.needsYou != null && task.needsYou.question.isNotBlank()) {
      Text(
        TaskCommandMessages.questionLabel() + "：" + task.needsYou.question,
        style = MaterialTheme.typography.bodySmall,
        color = scheme.error,
      )
    }
    if (task.members.isNotEmpty()) {
      Text(
        TaskCommandMessages.membersLabel() + "：" + task.members.joinToString("、"),
        style = MaterialTheme.typography.labelSmall,
        color = scheme.onSurfaceVariant,
      )
    }
    // 谁干了什么:并行时用户得看得见每一棒,不然只是一堆 bot 在动。
    task.steps.forEach { step ->
      Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(BitBotSpace.xs),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          step.name.ifBlank { TaskCommandMessages.someone() },
          style = MaterialTheme.typography.labelMedium,
        )
        Text(
          step.text.ifBlank { step.error },
          style = MaterialTheme.typography.bodySmall,
          color = scheme.onSurfaceVariant,
          modifier = Modifier.weight(1f),
        )
        // 换人挂在成员行上(与桌面同一套规则):没有 bot_id 的那一棒换不了。
        if (task.can.swap && step.botId.isNotBlank()) {
          TextButton(
            onClick = {
              val to = draft.trim()
              if (to.isNotEmpty()) onSwap(step.botId, to)
            },
            enabled = task.can.swap,
          ) {
            Text(TaskCommandMessages.swap(), style = MaterialTheme.typography.labelMedium)
          }
        }
      }
    }

    OutlinedTextField(
      value = draft,
      onValueChange = onDraftChange,
      placeholder = { Text(TaskCommandMessages.inputPlaceholder()) },
      singleLine = true,
      textStyle = MaterialTheme.typography.bodyLarge,
      shape = RoundedCornerShape(BitBotRadius.card),
      colors =
        OutlinedTextFieldDefaults.colors(
          focusedBorderColor = scheme.primary,
          unfocusedBorderColor = scheme.outline,
          cursorColor = scheme.primary,
        ),
      modifier = Modifier.fillMaxWidth(),
    )

    Row(horizontalArrangement = Arrangement.spacedBy(BitBotSpace.xs)) {
      TextButton(
        onClick = { onSteer(draft.trim()) },
        enabled = task.can.steer && draft.isNotBlank(),
      ) {
        Text(TaskCommandMessages.steer())
      }
      TextButton(
        onClick = { onReplan(draft.trim()) },
        enabled = task.can.replan && draft.isNotBlank(),
      ) {
        Text(TaskCommandMessages.replan())
      }
      // 刹停只给「真在跑」的那张卡 —— 没有在跑的按下去只会得到 no_running_task,
      // 与桌面同一套规则(桌面是直接不渲染这个按钮,不是给一个按不动的)。
      if (task.can.cancel) {
        TextButton(onClick = onCancel) {
          Text(TaskCommandMessages.cancel(), color = scheme.error)
        }
      }
    }
    // 插话的诚实边界常驻小字:下一棒看得见,**当前这一轮看不见**。
    Text(
      TaskCommandMessages.steerScopeHint(),
      style = MaterialTheme.typography.labelSmall,
      color = scheme.onSurfaceVariant,
    )
  }
}

/**
 * 这一屏的**可见文案**(三语:zh-CN / zh-TW / en)。
 *
 * 为什么单独一个对象而不是直接写字符串:批 5 的验收里有一条「端上不新增可见文案硬编码」。
 * 语言口径与现有的 `EventStreamMessages` **同一套**(同一个 currentLocale),
 * 免得手机上一半简体一半繁体。
 */
object TaskCommandMessages {
  private val locale: String get() = EventStreamMessages.currentLocale

  fun title(): String =
    when (locale) {
      "zh-TW" -> "指揮任務"
      "en" -> "Command tasks"
      else -> "指挥任务"
    }

  fun subtitle(): String =
    when (locale) {
      "zh-TW" -> "這台機器上正在跑、要你拍板的任務"
      "en" -> "Tasks running on this machine, and the ones waiting for you"
      else -> "这台机器上正在跑、要你拍板的任务"
    }

  fun notPaired(): String =
    when (locale) {
      "zh-TW" -> "還沒配對，或這台裝置沒有裝置身分"
      "en" -> "Not paired, or this device has no identity yet"
      else -> "还没配对，或这台设备没有设备身份"
    }

  fun notPairedHint(): String =
    when (locale) {
      "zh-TW" -> "先在「憑證」裡配對 Desktop，並讓這台裝置拿到裝置身分，再來指揮。"
      "en" -> "Pair Desktop in Credentials first, and give this device an identity, then command."
      else -> "先在「凭证」里配对 Desktop，并让这台设备拿到设备身份，再来指挥。"
    }

  fun loading(): String =
    when (locale) {
      "zh-TW" -> "正在讀…"
      "en" -> "Loading…"
      else -> "正在读…"
    }

  fun empty(): String =
    when (locale) {
      "zh-TW" -> "這台機器上現在沒有任務"
      "en" -> "No tasks on this machine right now"
      else -> "这台机器上现在没有任务"
    }

  fun needsYouCount(n: Int): String =
    when (locale) {
      "zh-TW" -> "要你拍板 $n"
      "en" -> "Needs you: $n"
      else -> "要你拍板 $n"
    }

  fun workingCount(n: Int): String =
    when (locale) {
      "zh-TW" -> "在跑 $n"
      "en" -> "Running: $n"
      else -> "在跑 $n"
    }

  /** 四个桶的标签(桶本身是服务端算的,这里只给它一个名字)。 */
  fun bucketLabel(bucket: String): String {
    // 桶是服务端算的 —— 端上只**认字**:不在词表里的桶就当"不知道",
    // 不自己编一个桶出来(那会让手机与桌面对不上账)。
    if (bucket !in TaskCommandRoutes.BUCKETS) {
      return when (locale) {
        "zh-TW" -> "未知"
        "en" -> "Unknown"
        else -> "未知"
      }
    }
    return when (locale) {
      "zh-TW" ->
        when (bucket) {
          "needs_you" -> "要你拍板"
          "working" -> "在跑"
          "waiting" -> "等一等"
          "closed" -> "已完"
          else -> "未知"
        }
      "en" ->
        when (bucket) {
          "needs_you" -> "Needs you"
          "working" -> "Running"
          "waiting" -> "Waiting"
          "closed" -> "Done"
          else -> "Unknown"
        }
      else ->
        when (bucket) {
          "needs_you" -> "要你拍板"
          "working" -> "在跑"
          "waiting" -> "等一等"
          "closed" -> "已完"
          else -> "未知"
        }
    }
  }

  fun questionLabel(): String =
    when (locale) {
      "zh-TW" -> "要你拍板"
      "en" -> "Needs you"
      else -> "要你拍板"
    }

  fun membersLabel(): String =
    when (locale) {
      "zh-TW" -> "成員"
      "en" -> "Members"
      else -> "成员"
    }

  fun someone(): String =
    when (locale) {
      "zh-TW" -> "某個成員"
      "en" -> "Someone"
      else -> "某个成员"
    }

  fun steer(): String =
    when (locale) {
      "zh-TW" -> "插話"
      "en" -> "Steer"
      else -> "插话"
    }

  fun replan(): String =
    when (locale) {
      "zh-TW" -> "改向"
      "en" -> "Replan"
      else -> "改向"
    }

  fun cancel(): String =
    when (locale) {
      "zh-TW" -> "煞停"
      "en" -> "Stop"
      else -> "刹停"
    }

  fun swap(): String =
    when (locale) {
      "zh-TW" -> "換人"
      "en" -> "Swap"
      else -> "换人"
    }

  fun inputPlaceholder(): String =
    when (locale) {
      "zh-TW" -> "說一句：插話是給下一棒的話，改向是新的任務目標"
      "en" -> "Say something: a steer reaches the next relay, a replan sets a new goal"
      else -> "说一句：插话是给下一棒的话，改向是新的任务目标"
    }

  fun steerScopeHint(): String =
    when (locale) {
      "zh-TW" -> "插話只有下一棒看得見，當前這一回合看不見。"
      "en" -> "A steer is seen by the next relay — not by the turn that is running now."
      else -> "插话只有下一棒看得见，当前这一回合看不见。"
    }

  fun steered(): String =
    when (locale) {
      "zh-TW" -> "已插話（下一棒看得見）"
      "en" -> "Steered (the next relay sees it)"
      else -> "已插话（下一棒看得见）"
    }

  fun replanned(): String =
    when (locale) {
      "zh-TW" -> "已改向，正在重跑"
      "en" -> "Replanned, restarting now"
      else -> "已改向，正在重跑"
    }

  fun cancelled(n: Int): String =
    when (locale) {
      "zh-TW" -> "已煞停 $n 條"
      "en" -> "Stopped $n"
      else -> "已刹停 $n 条"
    }

  fun swapped(): String =
    when (locale) {
      "zh-TW" -> "已換人（下一棒生效）"
      "en" -> "Swapped (effective on the next relay)"
      else -> "已换人（下一棒生效）"
    }

  fun failed(detail: String): String =
    when (locale) {
      "zh-TW" -> "沒成功：$detail"
      "en" -> "Didn't work: $detail"
      else -> "没成功：$detail"
    }

  fun readFailed(): String =
    when (locale) {
      "zh-TW" -> "讀不到任務清單"
      "en" -> "Couldn't read the task list"
      else -> "读不到任务清单"
    }
}
