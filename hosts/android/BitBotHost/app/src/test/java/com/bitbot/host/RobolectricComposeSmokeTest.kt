package com.bitbot.host

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 工具链自证：本环境没有 KVM，起不了 emulator —— 「UI 重构完了」这句话如果只能靠
 * 肉眼读代码，那它和「看起来修了」没有区别。这里用 Robolectric 在 JVM 上真渲染
 * Compose 语义树，先证明这条验证路本身是通的（能读到主题、能断言颜色），
 * 后面 UiDesignSystemTest 的每一条才有意义。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RobolectricComposeSmokeTest {
  @get:Rule
  val compose = createComposeRule()

  @Test
  fun `JVM 能真渲染 Compose 并读得出主题色`() {
    var primary = androidx.compose.ui.graphics.Color.Unspecified
    var defaultPurple = false
    compose.setContent {
      primary = MaterialTheme.colorScheme.primary
      defaultPurple = primary == androidx.compose.ui.graphics.Color(0xFF6650a4)
    }
    compose.waitForIdle()
    assertTrue("Robolectric 没渲染出主题色", primary != androidx.compose.ui.graphics.Color.Unspecified)
    println("SMOKE 框架默认 primary = $primary 是否 M3 基线紫 = $defaultPurple")
    assertTrue("读色没读到（渲染路不通）", primary.toString().isNotEmpty())
  }
}
