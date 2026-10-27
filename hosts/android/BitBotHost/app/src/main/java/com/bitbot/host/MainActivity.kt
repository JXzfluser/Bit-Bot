package com.bitbot.host

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.Composable
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
        var showPairingFlow by remember { mutableStateOf(false) }
        var hostUrlDraft by remember { mutableStateOf(TurnBridge.hostUrl().orEmpty()) }
        var tokenDraft by remember { mutableStateOf(TurnBridge.turnToken().orEmpty()) }
        var delivery by remember { mutableStateOf(SendToUserSurface.Summary()) }
        val scope = rememberCoroutineScope()
        val listState = rememberLazyListState()
        val sheetState = rememberModalBottomSheetState()
        val credSheetState = rememberModalBottomSheetState()
        val pairingSheetState = rememberModalBottomSheetState()

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
              val isPaired = TurnBridge.hostUrl() != null && TurnBridge.turnToken() != null
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
                Spacer(Modifier.height(16.dp))
                if (!isPaired) {
                  Button(onClick = { showPairingFlow = true }) {
                    Text("连接 Desktop")
                  }
                  Spacer(Modifier.height(8.dp))
                  Text(
                    "自动发现局域网内的桌面，输入 6 位配对码即可连接",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                } else {
                  Text(
                    "已配对 Desktop，可以开始对话",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                  )
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
              placeholder = { Text("例 http://192.168.1.10:18765（桌面「手机配对」里复制）") },
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
            // 归一后的结果当场显示出来：用户敲「192.168.1.10:18765」也要看得见
            // 真正会打的端点，没配对就直说会失败，不用等「发送」转圈。
            // 只缺一栏时要说清缺的是哪一栏 —— 「填了地址忘填令牌」和「没配对」
            // 是两个不同的动作，混成一句话用户会去检查 Wi-Fi。
            val missing =
              TurnBridge.pairingMissingHint(
                hostSet = hostUrlDraft.isNotBlank(),
                tokenSet = tokenDraft.isNotBlank(),
              )
            Text(
              when {
                missing != null -> "发送一定会失败：$missing（另一栏已经填了）"
                else ->
                  TurnBridge.turnEndpoint(hostUrlDraft)
                    ?.let { "实际调用：$it" }
                    ?: "未配对：填好配对地址与配对令牌前，发送一定会失败"
              },
              style = MaterialTheme.typography.labelSmall,
              color =
                if (missing != null || TurnBridge.turnEndpoint(hostUrlDraft) == null) {
                  MaterialTheme.colorScheme.error
                } else {
                  MaterialTheme.colorScheme.onSurfaceVariant
                },
              modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            Button(
              onClick = {
                TurnBridge.setHostUrl(hostUrlDraft)
                TurnBridge.setTurnToken(tokenDraft)
                hostUrlDraft = TurnBridge.hostUrl().orEmpty()
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

        if (showPairingFlow) {
          PairingFlowSheet(
            sheetState = pairingSheetState,
            onDismiss = { showPairingFlow = false },
            onPairingComplete = {
              showPairingFlow = false
            },
            onOpenCredentials = {
              showPairingFlow = false
              hostUrlDraft = TurnBridge.hostUrl().orEmpty()
              tokenDraft = TurnBridge.turnToken().orEmpty()
              showCredentials = true
            },
            context = this@MainActivity,
          )
        }
      }
    }
  }
}

/**
 * Pairing flow sheet: scan → list → code input → redeem.
 * Implements the zero-typing pairing experience per pairing-v1.md.
 */

private sealed class ScanState {
  object Idle : ScanState()
  object Scanning : ScanState()
  data class Done(val count: Int) : ScanState()
  data class Error(val message: String) : ScanState()
}

private sealed class RedeemState {
  object Idle : RedeemState()
  object Redeeming : RedeemState()
  data class Success(val message: String, val scopeWarning: String? = null) : RedeemState()
  data class Error(val failure: DesktopPairing.RedeemFailure) : RedeemState()
}

/**
 * Get the phone's own site-local IPv4 address from the current active network.
 * Wi-Fi is preferred; falls back to cellular/ethernet link addresses.
 * Returns null if no suitable address can be found — caller must NOT guess a default.
 *
 * 修复前红（行为级）：
 *   - 旧代码在 startScan() 里写死 localIp 为某个 192.168.x.x 的 placeholder
 *   - 真机连 10.x 或别的网段时，扫的是完全无关的段，用户永远看到「没找到 Desktop」
 *
 * 修复后绿：
 *   - 从 ConnectivityManager 拿真本机 IPv4（Wi-Fi 优先，其次 cellular/ethernet 的 linkaddresses）
 *   - 拿不到就如实返回 null，界面说「读不到手机自己的局域网地址」
 *   - 保留「凭证」里手填地址那条兜底路
 */
private fun getLocalWifiIp(context: Context): String? {
  val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    ?: return null

  // Try active network first (Wi-Fi typically)
  val activeNetwork: Network = cm.activeNetwork ?: return null
  val capabilities = cm.getNetworkCapabilities(activeNetwork) ?: return null

  // Prefer Wi-fi, but accept ethernet/cellular as fallback
  val isWifi = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
  val isEthernet = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
  val isCellular = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)

  if (!isWifi && !isEthernet && !isCellular) return null

  val linkProperties = cm.getLinkProperties(activeNetwork) ?: return null

  // Look for site-local IPv4 (10.x, 172.16-31.x, 192.168.x)
  for (linkAddress in linkProperties.linkAddresses) {
    val addr = linkAddress.address
    if (addr is java.net.Inet4Address && addr.isSiteLocalAddress) {
      return addr.hostAddress
    }
  }

  // If no site-local found, return any IPv4 from link addresses
  for (linkAddress in linkProperties.linkAddresses) {
    val addr = linkAddress.address
    if (addr is java.net.Inet4Address && !addr.isLoopbackAddress) {
      return addr.hostAddress
    }
  }

  return null
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairingFlowSheet(
  sheetState: androidx.compose.material3.SheetState,
  onDismiss: () -> Unit,
  onPairingComplete: () -> Unit,
  onOpenCredentials: () -> Unit,
  context: Context,
) {
  var scanState by remember { mutableStateOf<ScanState>(ScanState.Idle) }
  val discoveredDesktops = remember { mutableStateListOf<DesktopPairing.DiscoveredDesktop>() }
  var selectedDesktop by remember { mutableStateOf<DesktopPairing.DiscoveredDesktop?>(null) }
  var codeInput by remember { mutableStateOf("") }
  var redeemState by remember { mutableStateOf<RedeemState>(RedeemState.Idle) }
  var desktopPortInput by remember { mutableStateOf(TurnBridge.desktopPort().toString()) }
  val scope = rememberCoroutineScope()

  fun startScan() {
    scope.launch {
      scanState = ScanState.Scanning
      discoveredDesktops.clear()
      selectedDesktop = null
      codeInput = ""
      redeemState = RedeemState.Idle

      // 修复前红（行为级）：
      //   旧代码写死 localIp 为某个 192.168.x.x 的 placeholder
      //   真机连 10.x 或别的网段时，扫的是完全无关的段，用户永远看到「没找到 Desktop」
      //
      // 修复后绿：
      //   从 ConnectivityManager 拿真本机 IPv4（Wi-Fi 优先，其次 cellular/ethernet）
      //   拿不到就如实返回 null，界面说「读不到手机自己的局域网地址」
      //   保留「凭证」里手填地址那条兜底路
      val localIp = getLocalWifiIp(context)

      if (localIp == null) {
        scanState = ScanState.Error("读不到手机自己的局域网地址：确认手机连着 Wi-Fi（不是仅移动数据）。也可以用下方「高级」手动填写桌面地址。")
        return@launch
      }

      val result = withContext(Dispatchers.IO) {
        // Build candidate ports: user-specified port + default 18765 (deduplicated)
        val userPort = desktopPortInput.toIntOrNull()
        val candidatePorts = buildList {
          if (userPort != null && userPort in 1..65535) add(userPort)
          if (!contains(18765)) add(18765)
        }
        // Persist the user-specified port
        if (userPort != null && userPort in 1..65535) {
          TurnBridge.setDesktopPort(userPort)
        }
        runCatching { DesktopPairing.scanForDesktops(localIp, ports = candidatePorts) }
      }

      result.fold(
        onSuccess = { desktops ->
          discoveredDesktops.addAll(desktops)
          scanState = ScanState.Done(desktops.size)
        },
        onFailure = { error ->
          scanState = ScanState.Error(error.message ?: "扫描失败")
        }
      )
    }
  }

  fun redeemCode() {
    val desktop = selectedDesktop ?: return
    if (!DesktopPairing.isValidPairingCode(codeInput)) {
      redeemState = RedeemState.Error(DesktopPairing.RedeemFailure.BadRequest)
      return
    }

    scope.launch {
      redeemState = RedeemState.Redeeming
      val deviceName = android.os.Build.MODEL ?: "Android Device"

      val result = withContext(Dispatchers.IO) {
        DesktopPairing.completePairing(desktop, codeInput, deviceName)
      }

      result.fold(
        onSuccess = { redeemSuccess ->
          val scopeWarning = redeemSuccess.scopeWarning
          val message = if (scopeWarning != null) {
            "配对成功，但注意：$scopeWarning"
          } else {
            "配对成功！现在可以开始对话了"
          }
          redeemState = RedeemState.Success(message, scopeWarning)
          // Delay briefly to show success message, then close
          kotlinx.coroutines.delay(1500)
          onPairingComplete()
        },
        onFailure = { error ->
          if (error is DesktopPairing.RedeemFailure) {
            redeemState = RedeemState.Error(error)
          } else {
            redeemState = RedeemState.Error(
              DesktopPairing.RedeemFailure.NetworkError(error.message ?: "unknown")
            )
          }
        }
      )
    }
  }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Text(
        "连接 Desktop",
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
      )

      when (scanState) {
        is ScanState.Idle -> {
          Text(
            "点击下方按钮扫描局域网内的桌面",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          OutlinedTextField(
            value = desktopPortInput,
            onValueChange = { desktopPortInput = it.filter { c -> c.isDigit() }.take(5) },
            label = { Text("桌面端口") },
            placeholder = { Text("18765") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
          )
          Button(
            onClick = { startScan() },
            modifier = Modifier.fillMaxWidth(),
          ) {
            Text("开始扫描")
          }
        }

        is ScanState.Scanning -> {
          Text(
            "正在扫描局域网…",
            style = MaterialTheme.typography.bodyMedium,
          )
          androidx.compose.material3.CircularProgressIndicator(
            modifier = Modifier.align(Alignment.CenterHorizontally),
          )
        }

        is ScanState.Done -> {
          if (discoveredDesktops.isEmpty()) {
            Text(
              "同一 Wi-Fi 里没找到 Desktop，桌面上点一下「生成配对码」",
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.error,
            )
            Button(
              onClick = { startScan() },
              modifier = Modifier.fillMaxWidth(),
            ) {
              Text("重新扫描")
            }
          } else {
            Text(
              "找到 ${discoveredDesktops.size} 台桌面，选择一台：",
              style = MaterialTheme.typography.bodyMedium,
            )
            discoveredDesktops.forEach { desktop ->
              Surface(
                modifier = Modifier
                  .fillMaxWidth()
                  .clickable {
                    selectedDesktop = desktop
                    codeInput = ""
                    redeemState = RedeemState.Idle
                  },
                shape = RoundedCornerShape(8.dp),
                tonalElevation = if (selectedDesktop == desktop) 4.dp else 1.dp,
              ) {
                Column(
                  modifier = Modifier.padding(12.dp),
                ) {
                  Text(
                    desktop.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                  )
                  Text(
                    "${desktop.ip}:${desktop.port}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                  )
                  if (!desktop.codeActive) {
                    Text(
                      "桌面还没生成配对码",
                      style = MaterialTheme.typography.labelSmall,
                      color = MaterialTheme.colorScheme.error,
                    )
                  }
                }
              }
            }
          }
        }

        is ScanState.Error -> {
          Text(
            "扫描失败：${(scanState as ScanState.Error).message}",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
          )
          Button(
            onClick = { startScan() },
            modifier = Modifier.fillMaxWidth(),
          ) {
            Text("重试")
          }
        }
      }

      if (selectedDesktop != null && scanState is ScanState.Done) {
        Spacer(Modifier.height(8.dp))
        Text(
          "输入桌面上的 6 位配对码：",
          style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedTextField(
          value = codeInput,
          onValueChange = { codeInput = it.filter { c -> c.isDigit() }.take(6) },
          label = { Text("配对码") },
          placeholder = { Text("6 位数字") },
          modifier = Modifier.fillMaxWidth(),
          singleLine = true,
          enabled = redeemState !is RedeemState.Redeeming,
        )

        when (val state = redeemState) {
          is RedeemState.Error -> {
            Text(
              state.failure.userMessage,
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.error,
            )
          }
          is RedeemState.Success -> {
            Text(
              state.message,
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.primary,
            )
          }
          else -> {}
        }

        Button(
          onClick = { redeemCode() },
          modifier = Modifier.fillMaxWidth(),
          enabled = codeInput.length == 6 && redeemState !is RedeemState.Redeeming,
        ) {
          Text(
            when (redeemState) {
              is RedeemState.Redeeming -> "配对中…"
              else -> "配对"
            }
          )
        }
      }

      Spacer(Modifier.height(8.dp))
      TextButton(
        onClick = onOpenCredentials,
        modifier = Modifier.fillMaxWidth(),
      ) {
        Text("高级：手动填写配对地址和令牌")
      }
    }
  }
}
