package com.bitbot.host

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Grok-style Android product shell — chat first.
 * MoonBit (`cmd/desktop_turn`) → Host `llm_chat` (ADR 0005). No LocalBrain.
 */
class MainActivity : ComponentActivity() {
  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { /* Host only */ }

  data class ChatLine(val role: String, val text: String)

  private val productActions =
    listOf(
      "ListMachines" to "ListMachines",
      "钉钉" to "reply via dingtalk:cid-android :: Bit Bot Android 钉钉",
      "飞书" to "reply via feishu:oc_android :: Bit Bot Android 飞书",
      "企微" to "reply via wecom:BitBotAndroid :: Bit Bot Android 企微",
      "List models" to "list models",
      "Device tools" to "device tools",
      "Take photo" to "take photo",
      "Routines" to "list routines",
      "Tick routines" to "tick routines",
      "Check updates" to "check updates",
    )

  @OptIn(ExperimentalMaterial3Api::class)
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    TurnBridge.bind(this)
    setContent {
      MaterialTheme {
        var input by remember { mutableStateOf("") }
        val lines = remember { mutableStateListOf<ChatLine>() }
        var busy by remember { mutableStateOf(false) }
        var showCapabilities by remember { mutableStateOf(false) }
        var showCredentials by remember { mutableStateOf(false) }
        var hostUrlDraft by remember { mutableStateOf(TurnBridge.hostUrl().orEmpty()) }
        var tokenDraft by remember { mutableStateOf(TurnBridge.turnToken().orEmpty()) }
        var delivery by remember { mutableStateOf(SendToUserSurface.Summary()) }
        val scope = rememberCoroutineScope()
        val listState = rememberLazyListState()
        val sheetState = rememberModalBottomSheetState()
        val credSheetState = rememberModalBottomSheetState()

        fun runProductTurn(text: String) {
          val trimmed = text.trim()
          if (trimmed.isEmpty()) return
          scope.launch {
            busy = true
            input = ""
            lines.add(ChatLine("user", trimmed))
            val result =
              withContext(Dispatchers.IO) {
                runCatching { TurnBridge.runTurn(trimmed, machineKind = "android") }
              }
            val body =
              result.fold(
                onSuccess = { it },
                onFailure = { "! ${it.message}" },
              )
            val cards = DevicePermissionHost.cardsFromTurnJson(this@MainActivity, body)
            val need = cards.mapNotNull { it.androidPermission }.distinct().toTypedArray()
            if (need.isNotEmpty()) {
              permissionLauncher.launch(need)
            }
            delivery = SendToUserSurface.extract(body)
            val assistant =
              TurnBridge.assistantText(body)
                ?: if (body.startsWith("!")) body
                else "! " + (
                  TurnBridge.failureText(body)
                    ?: "桌面大脑没有返回可见回复（HTTP 正常，但 assistant 文本为空）"
                )
            lines.add(ChatLine("assistant", assistant))
            busy = false
          }
        }

        LaunchedEffect(lines.size) {
          if (lines.isNotEmpty()) {
            listState.animateScrollToItem(lines.lastIndex)
          }
        }

        Column(Modifier.fillMaxSize()) {
          TopAppBar(
            title = { Text("Bit Bot", fontWeight = FontWeight.Bold) },
            actions = {
              TextButton(onClick = {
                hostUrlDraft = TurnBridge.hostUrl().orEmpty()
                tokenDraft = TurnBridge.turnToken().orEmpty()
                showCredentials = true
              }) { Text("凭证") }
              TextButton(onClick = { showCapabilities = true }) { Text("能力") }
            },
          )

          Box(
            Modifier
              .weight(1f)
              .fillMaxWidth()
              .padding(horizontal = 12.dp),
          ) {
            if (lines.isEmpty()) {
              Column(
                Modifier.align(Alignment.Center).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
              ) {
                Text("Bit Bot", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text(
                  "对标 Grok 的国产助手 · Android Host",
                  style = MaterialTheme.typography.bodyMedium,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                  "配对 Desktop 大脑 — 点「凭证」填配对地址与配对令牌（桌面：设置 → 凭证 → 手机配对，可复制；开放配置，不写死）",
                  style = MaterialTheme.typography.labelMedium,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                Button(onClick = {
                  hostUrlDraft = TurnBridge.hostUrl().orEmpty()
                  tokenDraft = TurnBridge.turnToken().orEmpty()
                  showCredentials = true
                }) {
                  Text("配置 Desktop 配对凭证")
                }
              }
            } else {
              LazyColumn(
                state = listState,
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize().padding(vertical = 8.dp),
              ) {
                items(lines) { line ->
                  val isUser = line.role == "user"
                  Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
                  ) {
                    Column(
                      Modifier
                        .widthIn(max = 320.dp)
                        .background(
                          if (isUser) MaterialTheme.colorScheme.primaryContainer
                          else MaterialTheme.colorScheme.surfaceVariant,
                          RoundedCornerShape(12.dp),
                        )
                        .padding(10.dp),
                    ) {
                      Text(
                        if (isUser) "你" else "Bit Bot",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                      )
                      Text(line.text, style = MaterialTheme.typography.bodyMedium)
                    }
                  }
                }
              }
            }
          }

          if (delivery.labels.isNotEmpty() || delivery.attachments.isNotEmpty()) {
            Row(
              Modifier
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 4.dp),
            ) {
              delivery.labels.take(8).forEach { label ->
                Surface(
                  tonalElevation = 2.dp,
                  shape = MaterialTheme.shapes.small,
                  modifier = Modifier.padding(end = 6.dp),
                ) {
                  Text(
                    label,
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                  )
                }
              }
            }
          }

          Row(
            Modifier
              .fillMaxWidth()
              .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            OutlinedTextField(
              value = input,
              onValueChange = { input = it },
              placeholder = { Text("给 Bit Bot 发消息…") },
              modifier = Modifier.weight(1f).padding(end = 8.dp),
              enabled = !busy,
            )
            Button(
              enabled = !busy && input.isNotBlank(),
              onClick = { runProductTurn(input) },
            ) {
              Text(if (busy) "…" else "发送")
            }
          }
        }

        if (showCredentials) {
          ModalBottomSheet(
            onDismissRequest = { showCredentials = false },
            sheetState = credSheetState,
          ) {
            Text(
              "产品凭证 · 开放配置（不写死）",
              style = MaterialTheme.typography.titleMedium,
              modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            Text(
              "DeepSeek / 钉钉飞书企微 key 在 Desktop「凭证」配置；本机只配配对地址和配对令牌。",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              modifier = Modifier.padding(horizontal = 16.dp),
            )
            OutlinedTextField(
              value = hostUrlDraft,
              onValueChange = { hostUrlDraft = it },
              label = { Text("BITBOT_HOST_URL") },
              placeholder = { Text("http://10.0.2.2:18765") },
              modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
              singleLine = true,
            )
            // ADR 0008：/v1/turn 没带 bearer 一律 401。这里不配令牌，用户在手机上
            // 就没有任何自救入口 —— 只能看着「发送」永远转圈失败。
            OutlinedTextField(
              value = tokenDraft,
              onValueChange = { tokenDraft = it },
              label = { Text("BITBOT_TURN_TOKEN") },
              placeholder = { Text("Desktop「凭证」里那台大脑的配对令牌") },
              modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
              singleLine = true,
            )
            Button(
              onClick = {
                TurnBridge.setHostUrl(hostUrlDraft)
                TurnBridge.setTurnToken(tokenDraft)
                showCredentials = false
              },
              modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            ) {
              Text("保存并热加载")
            }
            Spacer(Modifier.height(24.dp))
          }
        }

        if (showCapabilities) {
          ModalBottomSheet(
            onDismissRequest = { showCapabilities = false },
            sheetState = sheetState,
          ) {
            Text(
              "能力 · 国内渠道 / 设备",
              style = MaterialTheme.typography.titleMedium,
              modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            productActions.forEach { (label, turn) ->
              TextButton(
                enabled = !busy,
                onClick = {
                  showCapabilities = false
                  runProductTurn(turn)
                },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp),
              ) {
                Text(label, modifier = Modifier.fillMaxWidth())
              }
            }
            Spacer(Modifier.height(24.dp))
          }
        }
      }
    }
  }
}
