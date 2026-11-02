package com.bitbot.host

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import com.bitbot.host.ui.ChatLine

/**
 * 一回合的命不该拴在一屏上。
 *
 * 旧实现把发送后的整段协程跑在 `rememberCoroutineScope()` 上 —— 那个 scope 属于
 * composition，屏幕一旋（Activity.recreate，Compose 组合重建）就把它连根取消：
 * 请求已经发出去了，桌面大脑正在写的回信永远不会上屏，也永远不会落盘；连「还在等」
 * 这个状态都跟着死了，于是发送键重新亮起，用户再按一次 —— 对「发到群 / 定时发文」
 * 这类有副作用的动作，这就是同一件事发两遍。
 *
 * 这一层做的事只有一件：**把回合、忙状态、投递证据与落盘动作搬到 composition 之外**。
 * 屏幕上的列表仍然按文件重读（revision 变了就重读），所以「文件是唯一事实源」这条
 * §8.27/§8.28 立起来的规矩没变；改的只是「谁跑这段协程」「忙与证据存在哪」。
 *
 * 边界（诚实）：
 *   - 它是进程级的：进程被系统杀掉，还没回完的回合就是没回完，不假装能续上；
 *   - 投递证据条存在这里（活过转屏），没落盘（活不过进程被杀），与消息不同 —— 见 report §8.29 残留；
 *   - 桌面要问的权限挪成「回来再说」：转屏时人不在屏幕上，新组合起来后补问，不静默吞掉。
 */
object TurnCoordinator {
  /** 进程级 scope：不随 composition 取消。 */
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  private val saveLock = Mutex()

  private var store: ChatHistoryStore? = null

  /** 已经落盘了几批：屏幕按这个版本号从文件重读，而不是自己攒一份会随组合死掉的状态。 */
  var revision by mutableIntStateOf(0)
    private set

  /** 还在等桌面回信的回合数（>0 就是「正在想」）。 */
  var inFlight by mutableIntStateOf(0)
    private set

  /** 这一轮「真的发到哪儿了」的证据，和消息一起活过转屏。 */
  var delivery by mutableStateOf(SendToUserSurface.Summary())
    private set

  /** 桌面中途要问的权限：转屏时不一定有人在屏幕上，攒着等新组合起来再问。 */
  var permissionGeneration by mutableIntStateOf(0)
    private set

  private var pendingPermissions: List<String> = emptyList()

  /** A1-4: 当前活跃的 SSE 订阅（用于进度显示）。 */
  private var currentSubscription: EventStreamClient.Subscription? = null

  /**
   * A1-4: 用户切到别的 app 再回来时，这一轮还要接着看。
   * ON_STOP 关掉长连接（挂着不放就是一条后台常连），ON_START 用这两个字段续订：
   * 机器类别决定订哪个会话，游标决定不重复渲染已经看见的帧。
   */
  private var streamMachineKind: String = ""
  private var lastStreamSeq: Long = 0L

  /** A1-4: 实时进度行（收到 progress 事件时更新）。 */
  var progressLines by mutableStateOf<List<String>>(emptyList())
    private set

  /** A1-4: 回退提示（401/503/网络失败时显示）。 */
  var fallbackMessage by mutableStateOf<String?>(null)
    private set

  /** 每个 Activity 实例 onCreate 时 bind 一次：文件路径是同一份，协程与状态只有一份。 */
  fun bind(context: Context) {
    store = ChatHistoryStore(context)
  }

  val busy: Boolean get() = inFlight > 0

  /** 取走待问的权限（一次取完，避免新组合反复问同一个）。 */
  fun takePendingPermissions(): List<String> {
    val need = pendingPermissions
    pendingPermissions = emptyList()
    return need
  }

  fun askPermissions(permissions: List<String>) {
    if (permissions.isEmpty()) return
    pendingPermissions = permissions
    permissionGeneration++
  }

  fun recordDelivery(summary: SendToUserSurface.Summary) {
    delivery = summary
  }

  /**
   * 把一条消息写进文件，并让屏幕上所有活着的组合重读一次。
   * 写失败不改屏幕上的事实（同 §8.27：那句话已经发出去了，不能因为文件写不进就当没发生）。
   */
  suspend fun appendLine(line: ChatLine) {
    val s = store ?: return
    runCatching {
      withContext(Dispatchers.IO) {
        saveLock.withLock { s.save(s.load() + line) }
      }
    }
    revision++
  }

  /** 「清空对话」：屏幕与盘一起清（协程同样不能拴在某一屏上）。 */
  fun clearAll() {
    val s = store ?: return
    scope.launch {
      runCatching {
        withContext(Dispatchers.IO) {
          saveLock.withLock { s.save(emptyList()) }
        }
      }
      delivery = SendToUserSurface.Summary()
      revision++
    }
  }

  /**
   * 跑一整个回合。busy 由这里加减，屏幕读的是它 —— 于是转屏之后「还在等」这件事还在。
   * 用户那句先落盘（立刻上屏），再去等桌面的回信。
   * A1-4: 同时启动 SSE 订阅，接收实时进度。
   */
  fun submitTurn(
    machineKind: String,
    text: String,
    onBody: suspend (String) -> Unit,
  ) {
    inFlight++
    progressLines = emptyList()
    fallbackMessage = null
    lastStreamSeq = 0L
    streamMachineKind = machineKind

    scope.launch {
      try {
        // A1-4: 先发起订阅，再发回合 —— 服务端不带游标时从「订阅那一刻的队尾」开始推，
        // 所以先订上的那一半决定本轮能不能看见自己的帧。
        // 这里**不等连接建立**：等过一次，用户那句话就要多憋 3 秒才发得出去
        // （单测实测：配对到一个连不上的地址时，发送被 SSE 的退避重连拖住，
        // 界面在 busy 期间拒绝输入）。消息必须立刻走，实时进度只是加成。
        // 代价（诚实残留 R-A1-4a）：桌面极快时 turn_started 可能早于连接建立，
        // 本轮少最前一两帧；真机要不要补，看设备验收。
        startEventStreamSubscription(machineKind, 0L)
        appendLine(ChatLine("user", text))
        val body =
          withContext(Dispatchers.IO) {
            runCatching { TurnBridge.runTurn(text, machineKind = machineKind) }
              .fold(onSuccess = { it }, onFailure = { "! ${it.message}" })
          }
        onBody(body)
      } finally {
        inFlight--
        // A1-4: 回合结束，关闭订阅（如果还没关的话）
        stopEventStreamSubscription()
      }
    }
  }

  /**
   * A1-4: 启动 SSE 事件流订阅。
   * 收到 progress 事件时更新 progressLines，收到 turn_ended 时自动关闭。
   * 401/503/网络失败时显示回退提示并退回整轮模式。
   */
  private fun startEventStreamSubscription(machineKind: String, initialSeq: Long) {
    val baseUrl = TurnBridge.hostUrl() ?: return
    val token = TurnBridge.turnToken() ?: return

    // A1-4: 会话边界 —— 与服务端默认值同一套规则：
    //   cn_inbound_server.js:902-903  sessionId = payload.session_id || `mobile-${machineKind}`
    // 手机这一轮就落在那个会话里，所以订 ?session_id= 只会看见自己的帧，
    // 不会把桌面上别人（或本机 UI）的进度串进来。服务端过滤已由 RP-06 钉住。
    // 代价/残留：这里靠「与服务端默认同规则」推导，没读 /v1/turn 回包里的 session_id；
    // 以后若允许 payload 指定会话（W3），这里必须改成用回包真值。
    // 本轮修的是：回合 body 那边原本写死 android-app，与这里对不上 ⇒ 手机一条帧都收不到。
    // 现在两边共用 TurnBridge.sessionFor(...)，「同一个会话」由构造保证而不是靠注释提醒。
    val sessionId = TurnBridge.sessionFor(machineKind)

    val callback = object : EventStreamClient.SubscriptionCallback {
      override fun onStateChange(state: EventStreamClient.SubscriptionState, reason: String?) {
        // 状态变化可用于调试，这里不处理
      }

      override fun onEvent(event: EventStreamClient.StreamEvent) {
        when (event.kind) {
          "progress" -> {
            // A1-4: row 是**对象**（turn_progress.js:121-128），必须取结构化字段。
            // 之前这里写 optString("row")，把整个对象当字符串塞进气泡 —— 手机上
            // 显示的是 {"phase":"start","index":1,...}，等于把调试面板给用户看。
            val line = EventStreamMessages.progressUpdate(event.payload?.optJSONObject("row"))
            progressLines = progressLines + line
          }
          "turn_started" -> {
            // initiator 可能是空串（turn_event_emitter.js:32），归一成「不显示」交给文案层
            val line = EventStreamMessages.turnStarted(event.payload?.optString("initiator"))
            progressLines = progressLines + line
          }
          "turn_ended" -> {
            // 回合结束，显示状态并关闭订阅
            val status = event.payload?.optString("status")?.takeIf { it.isNotEmpty() }
            val line = EventStreamMessages.turnEnded(status)
            progressLines = progressLines + line
            stopEventStreamSubscription()
          }
        }
      }

      override fun onFallback(reason: String) {
        // SSE 不可用，显示回退提示并退回整轮模式
        fallbackMessage = EventStreamMessages.fallbackMessage(reason)
        stopEventStreamSubscription()
      }
    }

    currentSubscription =
      EventStreamClient.createSubscription(baseUrl, token, callback, sessionId, initialSeq)

    // 在 IO 线程启动订阅（阻塞调用）
    scope.launch {
      withContext(Dispatchers.IO) {
        currentSubscription?.start()
      }
    }
  }

  /**
   * A1-4: 停止 SSE 事件流订阅（释放连接）。
   * 用户离开屏幕或回合结束时调用。
   */
  fun stopEventStreamSubscription() {
    val sub = currentSubscription ?: return
    // 游标要留下来：回来时从这个编号之后接着订，否则要么漏一段、要么重复一段。
    if (sub.lastSeq() > lastStreamSeq) lastStreamSeq = sub.lastSeq()
    sub.close()
    currentSubscription = null
  }

  /**
   * A1-4: 界面回到前台（ON_START）时续订 —— 只在「这一轮还在路上」时才有意义。
   * 回合早就结束的话什么都不做，不凭空挂一条常连。
   */
  fun resumeEventStreamSubscription() {
    if (inFlight <= 0) return
    if (currentSubscription != null) return
    if (streamMachineKind.isEmpty()) return
    startEventStreamSubscription(streamMachineKind, lastStreamSeq)
  }

  /**
   * 等价于「进程被重启」：丢掉没跑完的回合，状态回到空。
   * 只给测试用（Robolectric 里 statics 会跨用例活着，真机上每次冷启动都是新的），
   * 产品代码里没有任何路径调用它 —— 真机上这件事由系统杀进程完成。
   */
  fun resetForProcessRestart() {
    scope.coroutineContext.job.cancelChildren()
    inFlight = 0
    delivery = SendToUserSurface.Summary()
    pendingPermissions = emptyList()
    progressLines = emptyList()
    fallbackMessage = null
    stopEventStreamSubscription()
    streamMachineKind = ""
    lastStreamSeq = 0L
    revision++
  }
}
