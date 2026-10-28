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
   */
  fun submitTurn(
    machineKind: String,
    text: String,
    onBody: suspend (String) -> Unit,
  ) {
    inFlight++
    scope.launch {
      try {
        appendLine(ChatLine("user", text))
        val body =
          withContext(Dispatchers.IO) {
            runCatching { TurnBridge.runTurn(text, machineKind = machineKind) }
              .fold(onSuccess = { it }, onFailure = { "! ${it.message}" })
          }
        onBody(body)
      } finally {
        inFlight--
      }
    }
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
    revision++
  }
}
