package com.bitbot.host.ui

/**
 * 配对面板的状态模型（纯数据，不碰 Context、不碰网络）。
 *
 * 为什么要和 UI 分开：旧版把扫描、选台、redeem 全写在 Composable 里，
 * 于是「配对走到哪一步界面该长什么样」这件事在 JVM 上根本没法断言。
 * 状态提到这一层之后，MainActivity 负责跑真流程，Sheets.kt 负责画，
 * 单测可以直接把三种状态灌进真组件里看结果。
 */
sealed class PairingScanState {
  object Idle : PairingScanState()
  object Scanning : PairingScanState()
  data class Done(val count: Int) : PairingScanState()
  data class Error(val message: String) : PairingScanState()
}

/** 一台被发现的桌面（渲染视图，字段来自 DesktopPairing.DiscoveredDesktop）。 */
data class PairingDesktop(
  val name: String,
  val ip: String,
  val port: Int,
  val codeActive: Boolean,
)

sealed class PairingRedeemState {
  object Idle : PairingRedeemState()
  object Redeeming : PairingRedeemState()
  data class Success(val message: String, val scopeWarning: String? = null) : PairingRedeemState()
  data class Error(val message: String) : PairingRedeemState()
}
