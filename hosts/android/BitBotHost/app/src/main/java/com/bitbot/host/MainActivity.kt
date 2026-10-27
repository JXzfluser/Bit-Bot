package com.bitbot.host

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.bitbot.host.ui.BitBotTheme
import com.bitbot.host.ui.CapabilitiesSheet
import com.bitbot.host.ui.ChatLine
import com.bitbot.host.ui.CredentialsSheet
import com.bitbot.host.ui.HomeScreen
import com.bitbot.host.ui.HostReply
import com.bitbot.host.ui.MenuSheet
import com.bitbot.host.ui.PairingDesktop
import com.bitbot.host.ui.PairingRedeemState
import com.bitbot.host.ui.PairingScanState
import com.bitbot.host.ui.PairingSheet
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * AI 助手式产品外壳 —— 聊天为主屏。
 *
 * 这一版做的是「版面重构 + 设计系统」，配对走 pairing-v1，
 * turn 走 ADR 0008 的 bearer，MoonBit (`cmd/desktop_turn`) → Host `llm_chat` (ADR 0005)；
 * 状态与真流程留在这个文件里，画的东西全在 ui/ 包，
 * 于是 UI 第一次可以在 JVM 上被真渲染、真断言（见 UiDesignSystemTest）。
 * 后来补的只有两类：回执呈现层交给 HostReply（见 §8.23），对话历史落到本机 filesDir
 * 并且能在菜单里清掉（见 ChatHistoryStore 与 §8.27）——协议与 store 形状都没动。
 */
class MainActivity : ComponentActivity() {
  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { /* Host only */ }

  /** 聊天历史的本机落盘（filesDir 下一个有界 JSON，见 ChatHistoryStore）。 */
  private val chatStore by lazy { ChatHistoryStore(this) }

  /** 落盘要串起来：一条 turn 会写两次快照，清空是另一条协程，两处各写各的会互相盖掉。 */
  private val chatSaveLock = Mutex()

  /** onCreate 一次性读回来的历史；不放进 Composable 里现读文件。 */
  private var startupLines: List<ChatLine> = emptyList()

  /**
   * 没发出去的那半稿：真机旋转是**新建实例**，所以它必须走盘（chat-draft.txt），
   * 不能只挂在实例字段上 —— 挂字段在 Robolectric 的 recreate() 下也会「过」，那是假绿。
   */
  private var draftNow = ""

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

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    TurnBridge.bind(this)
    // 转屏 / 进程被杀重开之前打过的那句话得回到屏幕上。读不出就是没有历史，
    // 不抛也不猜（ChatHistoryStore 的失败语义）。
    startupLines = runCatching { chatStore.load() }.getOrDefault(emptyList())
    // 没发出去的那半稿同理从盘上读回来（不是从实例字段）。
    draftNow = runCatching { chatStore.loadDraft() }.getOrDefault("")
    // 交出去之前不许丢：每次离开前台存一次（旋转、切后台、被系统回收前都会走到这里）。
    // 不在每次按键时写盘 —— 那是在主线程上按字符次数放大 IO。
    lifecycle.addObserver(
      LifecycleEventObserver { _, event ->
        if (event == Lifecycle.Event.ON_PAUSE) chatStore.saveDraft(draftNow)
      }
    )
    setContent { BitBotTheme { HomeShell() } }
  }

  /** 配对状态：只在真的保存/配对成功后刷新，不在 Composable 里现读全局。 */
  private fun pairedNow(): Boolean = TurnBridge.hostUrl() != null && TurnBridge.turnToken() != null

  /** 状态点旁边那串字：只显示主机部分，端口在凭证里看。 */
  private fun hostLabelNow(): String? =
    TurnBridge.hostUrl()?.let { url ->
      Regex("https?://([^/]+)").find(url)?.groupValues?.get(1) ?: url
    }

  @Composable
  private fun HomeShell() {
    var input by remember { mutableStateOf(draftNow) }
    // 上一次留下的对话要回到这一屏：remember 只活过一次组合，转屏就没了，
    // 所以初始值来自 onCreate 读回来的文件（见 ChatHistoryStore）。
    val lines = remember { mutableStateListOf<ChatLine>().also { it.addAll(startupLines) } }
    var busy by remember { mutableStateOf(false) }
    var delivery by remember { mutableStateOf(SendToUserSurface.Summary()) }
    var paired by remember { mutableStateOf(pairedNow()) }
    var hostLabel by remember { mutableStateOf(hostLabelNow()) }
    var showMenu by remember { mutableStateOf(false) }
    var showCapabilities by remember { mutableStateOf(false) }
    var showCredentials by remember { mutableStateOf(false) }
    var showPairing by remember { mutableStateOf(false) }
    var hostDraft by remember { mutableStateOf(TurnBridge.hostUrl().orEmpty()) }
    var tokenDraft by remember { mutableStateOf(TurnBridge.turnToken().orEmpty()) }
    val scope = rememberCoroutineScope()

    fun refreshPairing() {
      paired = pairedNow()
      hostLabel = hostLabelNow()
    }

    /**
     * 上屏 + 落盘，一次一条。落盘走 IO 线程，写失败不改屏幕上的事实：
     * 用户那句话已经发出去了，不能因为一个文件写不进去就当它没发生。
     */
    suspend fun addLine(line: ChatLine) {
      lines.add(line)
      val snapshot = lines.toList()
      withContext(Dispatchers.IO) {
        chatSaveLock.withLock { chatStore.save(snapshot) }
      }
    }

    /** 「清空对话」：屏幕与盘一起清，只清一个的话转个身旧话又回来了。 */
    fun clearChat() {
      scope.launch {
        withContext(Dispatchers.IO) {
          chatSaveLock.withLock { chatStore.save(emptyList()) }
        }
        lines.clear()
        delivery = SendToUserSurface.Summary()
      }
    }

    fun openCredentials() {
      hostDraft = TurnBridge.hostUrl().orEmpty()
      tokenDraft = TurnBridge.turnToken().orEmpty()
      showMenu = false
      showCredentials = true
    }

    fun runProductTurn(text: String) {
      val trimmed = text.trim()
      if (trimmed.isEmpty()) return
      scope.launch {
        busy = true
        input = ""
        // 交出去了就不再是草稿：立刻清盘（等 ON_PAUSE 再清的话，中途被系统回收会把
        // 已发送的这句又摆回输入框，用户会再按一次发送）。
        draftNow = ""
        chatStore.saveDraft("")
        addLine(ChatLine("user", trimmed))
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
        // 内核回的是给机器看的事实（围栏 JSON、绝对路径、变量名）。手机上默认读人话，
        // 原文留一处展开 —— 呈现层做翻译，不改 /v1/turn 的形状。
        val shown = HostReply.display(body)
        val assistant =
          if (shown.text.isNotBlank()) shown.text
          else "! " + (
            TurnBridge.failureText(body)
              ?: "桌面大脑没有返回可见回复（HTTP 正常，但 assistant 文本为空）"
          )
        addLine(ChatLine("assistant", assistant, shown.raw))
        busy = false
      }
    }

    // 旧版这条带的条件多一个 attachments.isEmpty 的边角：有实体文件却没标签时整排证据就没了。
    // 这里保持「有证据就必须看得见」，没标签时退回显示文件路径本身。
    val deliveryLabels =
      if (delivery.labels.isNotEmpty()) delivery.labels
      else delivery.attachments.map { it.path }

    HomeScreen(
      lines = lines.toList(),
      busy = busy,
      input = input,
      onInputChange = {
        input = it
        draftNow = it
      },
      onSend = { runProductTurn(input) },
      onSendSuggestion = { runProductTurn(it) },
      deliveryLabels = deliveryLabels,
      paired = paired,
      hostLabel = hostLabel,
      onOpenPairing = { showMenu = false; showPairing = true },
      onOpenCredentials = { openCredentials() },
      onOpenMenu = { showMenu = true },
    )

    if (showMenu) {
      MenuSheet(
        paired = paired,
        hostLabel = hostLabel,
        onCredentials = { openCredentials() },
        onCapabilities = { showMenu = false; showCapabilities = true },
        onPairing = { showMenu = false; showPairing = true },
        onClearChat = { showMenu = false; clearChat() },
        onDismiss = { showMenu = false },
      )
    }

    if (showCredentials) {
      CredentialsSheet(
        hostDraft = hostDraft,
        onHostChange = { hostDraft = it },
        tokenDraft = tokenDraft,
        onTokenChange = { tokenDraft = it },
        endpointPreview = TurnBridge.turnEndpoint(hostDraft),
        // 归一后的结果当场显示出来：用户敲「192.168.1.10:18765」也要看得见真正会打的端点。
        // 只缺一栏时要说清缺的是哪一栏 —— 「填了地址忘填令牌」和「没配对」是两个不同动作。
        missingHint =
          TurnBridge.pairingMissingHint(
            hostSet = hostDraft.isNotBlank(),
            tokenSet = tokenDraft.isNotBlank(),
          ),
        onSave = {
          TurnBridge.setHostUrl(hostDraft)
          TurnBridge.setTurnToken(tokenDraft)
          hostDraft = TurnBridge.hostUrl().orEmpty()
          refreshPairing()
          showCredentials = false
        },
        onOpenPairing = { showCredentials = false; showPairing = true },
        onDismiss = { showCredentials = false },
      )
    }

    if (showCapabilities) {
      CapabilitiesSheet(
        actions = productActions,
        enabled = !busy,
        onPick = {
          showCapabilities = false
          runProductTurn(it)
        },
        onDismiss = { showCapabilities = false },
      )
    }

    if (showPairing) {
      PairingController(
        onPaired = {
          showPairing = false
          refreshPairing()
        },
        onOpenCredentials = { openCredentials() },
        onDismiss = { showPairing = false },
      )
    }
  }

  /**
   * 配对流程的「真」那半边：扫描、选台、redeem 全在这里；
   * 长什么样交给 ui/Sheets.kt 的 PairingSheet（那边可以直接灌状态做单测）。
   */
  @Composable
  private fun PairingController(
    onPaired: () -> Unit,
    onOpenCredentials: () -> Unit,
    onDismiss: () -> Unit,
  ) {
    var scanState by remember { mutableStateOf<PairingScanState>(PairingScanState.Idle) }
    val found = remember { mutableStateListOf<DesktopPairing.DiscoveredDesktop>() }
    var selected by remember { mutableStateOf<DesktopPairing.DiscoveredDesktop?>(null) }
    var codeInput by remember { mutableStateOf("") }
    var redeemState by remember { mutableStateOf<PairingRedeemState>(PairingRedeemState.Idle) }
    var portInput by remember { mutableStateOf(TurnBridge.desktopPort().toString()) }
    val scope = rememberCoroutineScope()

    fun startScan() {
      scope.launch {
        scanState = PairingScanState.Scanning
        found.clear()
        selected = null
        codeInput = ""
        redeemState = PairingRedeemState.Idle

        // 修复前红（行为级，见 PairingDiscoveryTest / 报告 §8.16）：
        //   旧代码写死 localIp 为某个 192.168.x.x 的 placeholder，
        //   真机连 10.x 或别的网段时扫的是完全无关的段，用户永远看到「没找到 Desktop」。
        // 现在：从 ConnectivityManager 拿真本机 IPv4，拿不到就如实说，不猜默认值。
        val localIp = getLocalWifiIp(this@MainActivity)
        if (localIp == null) {
          scanState =
            PairingScanState.Error(
              "读不到手机自己的局域网地址：确认手机连着 Wi-Fi（不是仅移动数据）。" +
                "也可以用下方「高级」手动填写桌面地址。"
            )
          return@launch
        }

        val result =
          withContext(Dispatchers.IO) {
            val userPort = portInput.toIntOrNull()
            val candidatePorts = buildList {
              if (userPort != null && userPort in 1..65535) add(userPort)
              if (!contains(18765)) add(18765)
            }
            if (userPort != null && userPort in 1..65535) {
              TurnBridge.setDesktopPort(userPort)
            }
            runCatching { DesktopPairing.scanForDesktops(localIp, ports = candidatePorts) }
          }

        result.fold(
          onSuccess = { desktops ->
            found.addAll(desktops)
            scanState = PairingScanState.Done(desktops.size)
          },
          onFailure = { error ->
            scanState = PairingScanState.Error(error.message ?: "扫描失败")
          }
        )
      }
    }

    fun redeem() {
      val desktop = selected ?: return
      if (!DesktopPairing.isValidPairingCode(codeInput)) {
        redeemState = PairingRedeemState.Error(DesktopPairing.RedeemFailure.BadRequest.userMessage)
        return
      }
      scope.launch {
        redeemState = PairingRedeemState.Redeeming
        val deviceName = android.os.Build.MODEL ?: "Android Device"
        val result =
          withContext(Dispatchers.IO) {
            DesktopPairing.completePairing(desktop, codeInput, deviceName)
          }
        result.fold(
          onSuccess = { ok ->
            val warning = ok.scopeWarning
            redeemState =
              PairingRedeemState.Success(
                if (warning != null) "配对成功，但注意：$warning" else "配对成功！现在可以开始对话了",
                warning,
              )
            delay(1200)
            onPaired()
          },
          onFailure = { error ->
            redeemState =
              PairingRedeemState.Error(
                if (error is DesktopPairing.RedeemFailure) error.userMessage
                else error.message ?: "配对失败"
              )
          }
        )
      }
    }

    PairingSheet(
      scanState = scanState,
      discovered = found.map { PairingDesktop(it.name, it.ip, it.port, it.codeActive) },
      selected = selected?.let { PairingDesktop(it.name, it.ip, it.port, it.codeActive) },
      onSelect = { d ->
        selected = found.firstOrNull { it.name == d.name && it.ip == d.ip && it.port == d.port }
        codeInput = ""
        redeemState = PairingRedeemState.Idle
      },
      codeInput = codeInput,
      onCodeChange = { codeInput = it },
      portInput = portInput,
      onPortChange = { portInput = it },
      redeemState = redeemState,
      onScan = { startScan() },
      onRedeem = { redeem() },
      onOpenCredentials = onOpenCredentials,
      onDismiss = onDismiss,
    )
  }
}

/**
 * 取手机自己的 site-local IPv4：Wi-Fi 优先，其次 ethernet/cellular 的 link addresses。
 * 拿不到返回 null —— 调用方不许猜一个默认地址。
 *
 * 修复前红 / 修复后绿见 MainActivity.PairingController 里的注释与 PairingDiscoveryTest。
 */
private fun getLocalWifiIp(context: Context): String? {
  val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
    ?: return null

  val activeNetwork: Network = cm.activeNetwork ?: return null
  val capabilities = cm.getNetworkCapabilities(activeNetwork) ?: return null

  val isWifi = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
  val isEthernet = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
  val isCellular = capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)

  if (!isWifi && !isEthernet && !isCellular) return null

  val linkProperties = cm.getLinkProperties(activeNetwork) ?: return null

  for (linkAddress in linkProperties.linkAddresses) {
    val addr = linkAddress.address
    if (addr is java.net.Inet4Address && addr.isSiteLocalAddress) {
      return addr.hostAddress
    }
  }

  for (linkAddress in linkProperties.linkAddresses) {
    val addr = linkAddress.address
    if (addr is java.net.Inet4Address && !addr.isLoopbackAddress) {
      return addr.hostAddress
    }
  }

  return null
}
