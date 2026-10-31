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
import androidx.compose.runtime.LaunchedEffect
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
import kotlinx.coroutines.withContext

/**
 * AI 助手式产品外壳 —— 聊天为主屏。
 *
 * 这一版做的是「版面重构 + 设计系统」，配对走 pairing-v1，
 * turn 走 ADR 0008 的 bearer，MoonBit (`cmd/desktop_turn`) → Host `llm_chat` (ADR 0005)；
 * 状态与真流程留在这个文件里，画的东西全在 ui/ 包，
 * 于是 UI 第一次可以在 JVM 上被真渲染、真断言（见 UiDesignSystemTest）。
 * 后来补的只有三类：回执呈现层交给 HostReply（见 §8.23），对话历史落到本机 filesDir
 * 并且能在菜单里清掉（见 ChatHistoryStore 与 §8.27），没发出去的半稿走同一份盘（§8.28）；
 * 而「发出去之后正在等回信」这件事本身不再属于某一屏，交给 TurnCoordinator（§8.29）——
 * 协议、store 形状与 /v1/turn 的 JSON 都没动。
 */
class MainActivity : ComponentActivity() {
  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { /* Host only */ }

  /** 聊天历史的本机落盘（filesDir 下一个有界 JSON，见 ChatHistoryStore）。 */
  private val chatStore by lazy { ChatHistoryStore(this) }

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

  /**
   * 桌面快捷指令的全部词表（与 scripts/verify_native_shells.sh 同源）。
   * 点一条只是填进输入框：像 "room " / "cold mail to=" 还差参数，不能假装一句话能发。
   */
  private val commandTemplates =
    listOf(
      "list plugins",
      "get plugin plugin-slides",
      "generate image",
      "structured chart",
      "voice start",
      "box doctor",
      "box chrome probe",
      "make slides",
      "draft mail",
      "schedule meeting",
      "purchase item",
      "reply via slack:",
      "reply via teams:",
      "finance get_balance",
      "job search",
      "x search moonbit",
      "list workflows",
      "list credentials",
      "react message",
      "screenshot agent=executor",
      "launch cloud agent",
      "listdir docs",
      "webfetch https://example.com",
      "computer use open",
      "shell echo",
      "cold mail to=",
      "send on behalf to=",
      "claim inbox",
      "author skill name=",
      "export bot template id=",
      "record video",
      "create reminder id=desk-rem",
      "version info",
      "mute channel",
      "toggle theme",
      "open terminal",
      "share screen",
      "ping host",
      "list scheduled",
      "create canvas page",
      "do not disturb",
      "export chat",
      "open identity",
      "edit message",
      "pin message",
      "clear chat",
      "journal query hello",
      "copy to box machine=",
      "mcp discover",
      "mcp call user-Gmail.search_threads",
      "spawn subagent summarize inbox",
      "travel expedia.com",
      "order food doordash.com",
      "package install cowsay",
      "list agents",
      "hide agent research",
      "notify settings assistant=asst-alpha",
      "update computer",
      "shared box fs",
      "section post group=g1",
      "meeting chat body=stand-up",
      "learn from demo title=Checkout",
      "fill credential domain=login.example.test",
      "read mail t-invoice-1",
      "pause routine smoke-r",
      "resume routine smoke-r",
      "add section group=g1",
      "connect finance",
      "book flight google.com/flights",
      "journal date=2026-10-17",
      "personal slack dm owner=Uowner",
      "channel plan body=stay in chat only",
      "launch bare chrome",
      "install package npm left-pad@1.3.0",
      "open members group=group-1",
      "query journal from=2026-10-01",
      "connect gmail",
      "connect outlook",
      "list connectors",
      "setup slack",
      "identity browser",
      "box clock",
      "copy from box machine=",
      "voice relay",
      "voice end",
      "generate video",
      "open webhook panel",
      "copy webhook url",
      "auto review settings",
      "search mail Invoice",
      "fire routine desk-r",
      "shared memory put",
      "shared memory read",
      "open settings",
      "source control github",
      "source control create_pr",
      "load skill slides presentation",
      "install plugin plugin-slides",
      "uninstall plugin plugin-slides",
      "copy webhook key",
      "tool-read webhook key",
      "webhook wake id=",
      "members panel",
      "recall",
      "reset computer",
      "local execution off",
      "guide permission kind=needs-auth",
      "watch video",
      "shop target.com",
      "code changes README.mbt.md",
      "send to agent asst-parity",
      "set notify assistant=asst-alpha",
      "[inbound] reaction :+1:",
      "open agent info agent=agent-bit",
      "delete agent agent-bit",
      "confirm delete agent",
      "create routine id=desk-r",
      "create teammate id=",
      "room ",
      "post to room ",
      "join room ",
      "list members",
      "list channels",
      "start huddle",
      "end huddle",
      "open canvas",
      "focus mode on",
      "todo write ",
      "list todos",
      "open thread",
      "start screen share",
      "list skills",
      "attach file ",
      "journal query",
      "open identity browser",
      "x post ",
      "open plugins",
      "pin agent ",
      "browser open ",
      "share bot",
      "record audio",
      "scan document",
      "vault list",
      "clipboard read",
      "note create ",
      "list calendar",
      "export pdf",
      "export markdown",
      "deliver cloud artifact artifact=",
      "teams send tsmoke",
      "thread_ts=",
      "draft outlook mail",
      "claim rehearsal",
      "sandbox claim",
    )

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    TurnBridge.bind(this)
    // 回合本身活在进程级的那一层（转屏取消 composition 不该取消已经在路上的这一回合）。
    TurnCoordinator.bind(this)
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
    // 「正在等回信」与「这句真的发到哪儿了」都存在进程级那一层：转屏取消了这一屏，
    // 不该把这两件事一起取消（旧代码里它们是 remember 的，recreate 之后回不来）。
    val busy = TurnCoordinator.busy
    val delivery = TurnCoordinator.delivery
    var paired by remember { mutableStateOf(pairedNow()) }
    var hostLabel by remember { mutableStateOf(hostLabelNow()) }
    var showMenu by remember { mutableStateOf(false) }
    var showCapabilities by remember { mutableStateOf(false) }
    var showCredentials by remember { mutableStateOf(false) }
    var showPairing by remember { mutableStateOf(false) }
    var hostDraft by remember { mutableStateOf(TurnBridge.hostUrl().orEmpty()) }
    var tokenDraft by remember { mutableStateOf(TurnBridge.turnToken().orEmpty()) }

    fun refreshPairing() {
      paired = pairedNow()
      hostLabel = hostLabelNow()
    }

    /**
     * 屏幕上的对话是文件的一个视图：回合每落一批（revision 变了）就重读一次，
     * 而不是由某一屏自己攒一份 —— 攒的那份会随 composition 死掉，而落盘的那份不会。
     * 读放在 IO 线程，不在组合里现读文件。
     */
    val revision = TurnCoordinator.revision
    LaunchedEffect(revision) {
      val snapshot =
        withContext(Dispatchers.IO) { runCatching { chatStore.load() }.getOrDefault(emptyList()) }
      lines.clear()
      lines.addAll(snapshot)
    }

    /**
     * 桌面中途要问的权限：转屏的时候人不一定在屏幕上，旧代码那一句 launch 会连着
     * composition 一起被取消，等于静默吞掉这次请求。攒到进程级那一层，新组合起来再问。
     */
    val permissionGeneration = TurnCoordinator.permissionGeneration
    LaunchedEffect(permissionGeneration) {
      val need = TurnCoordinator.takePendingPermissions()
      if (need.isNotEmpty()) permissionLauncher.launch(need.toTypedArray())
    }

    /** 「清空对话」：屏幕与盘一起清，只清一个的话转个身旧话又回来了。 */
    fun clearChat() {
      TurnCoordinator.clearAll()
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
      input = ""
      // 交出去了就不再是草稿：立刻清盘（等 ON_PAUSE 再清的话，中途被系统回收会把
      // 已发送的这句又摆回输入框，用户会再按一次发送）。
      draftNow = ""
      chatStore.saveDraft("")
      // 回合交出去之后就不再属于这一屏了：谁在不在屏幕上，都不该决定这封回信回不回得来。
      TurnCoordinator.submitTurn(machineKind = "android", text = trimmed) { body ->
        val cards = DevicePermissionHost.cardsFromTurnJson(this@MainActivity, body)
        TurnCoordinator.askPermissions(cards.mapNotNull { it.androidPermission }.distinct())
        TurnCoordinator.recordDelivery(SendToUserSurface.extract(body))
        // 内核回的是给机器看的事实（围栏 JSON、绝对路径、变量名）。手机上默认读人话，
        // 原文留一处展开 —— 呈现层做翻译，不改 /v1/turn 的形状。
        val shown = HostReply.display(body)
        val assistant =
          if (shown.text.isNotBlank()) shown.text
          else "! " + (
            TurnBridge.failureText(body)
              ?: "桌面大脑没有返回可见回复（HTTP 正常，但 assistant 文本为空）"
          )
        TurnCoordinator.appendLine(ChatLine("assistant", assistant, shown.raw))
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
        templates = commandTemplates,
        enabled = !busy,
        onPick = {
          showCapabilities = false
          runProductTurn(it)
        },
        onPickTemplate = {
          showCapabilities = false
          input = it
          draftNow = it
          chatStore.saveDraft(it)
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
        // 兜异常是因为这一步会被框架打回（缺 ACCESS_NETWORK_STATE 时 ConnectivityService
        // 直接抛 SecurityException）—— 那样点「扫描」就是崩，用户连下面的手动填地址都够不着。
        val localIp = runCatching { getLocalWifiIp(this@MainActivity) }.getOrNull()
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
