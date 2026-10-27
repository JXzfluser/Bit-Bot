package com.bitbot.host

import android.util.TypedValue
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.bitbot.host.ui.BitBotPalette
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * 窗口层主题（状态栏 / 导航栏 / 窗口底色）。
 *
 * Compose 的设计系统只管画布以内；状态栏归 framework theme 管。旧版 manifest 直接挂
 * `@android:style/Theme.Material.Light.NoActionBar`，于是深色模式下 Compose 画近黑、
 * 状态栏却还是系统浅色 —— 一半深一半浅，正是「没做完」的观感。
 *
 * 断言的是「activity 的 theme 真解析出什么」，不是「文件写了没」。Robolectric 默认浅色
 * 配置，所以这四条走的是 values/；深色版（values-night）由 prove_android_build 的 AB-12
 * 直接读资源文本兜住 —— 没有 KVM，JVM 上换不了 config 也看不到像素，这点如实记着。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UiWindowThemeTest {
  @get:Rule val compose = createAndroidComposeRule<MainActivity>()

  private fun resolve(attr: Int): TypedValue {
    val out = TypedValue()
    val activity = compose.activity
    assertTrue("主题里解析不到 attr=$attr（窗口层根本没配）", activity.theme.resolveAttribute(attr, out, true))
    return out
  }

  private fun colorOf(attr: Int): Int {
    val out = resolve(attr)
    val activity = compose.activity
    return if (out.resourceId != 0) {
      activity.getColor(out.resourceId)
    } else {
      out.data
    }
  }

  @Test
  fun `窗口底色必须是设计系统的画布 不是框架自带的灰白`() {
    val canvas = BitBotPalette.CanvasLight.toArgb()
    val window = colorOf(android.R.attr.windowBackground)
    println("WINDOW windowBackground = " + Integer.toHexString(window) + " 设计画布 = " + Integer.toHexString(canvas))
    assertEquals("窗口底色没跟设计系统同色：冷启动和键盘收起那一瞬会闪一层不属于我们的灰", canvas, window)
  }

  @Test
  fun `状态栏底色与画布同色 顶栏不留一条别人的颜色`() {
    val canvas = BitBotPalette.CanvasLight.toArgb()
    val status = colorOf(android.R.attr.statusBarColor)
    println("WINDOW statusBarColor = " + Integer.toHexString(status))
    assertEquals("状态栏还顶着 framework 的颜色（深色模式下半屏深半屏浅）", canvas, status)
  }

  @Test
  fun `导航栏底色也与画布同色 底部不留第二条色带`() {
    val canvas = BitBotPalette.CanvasLight.toArgb()
    val nav = colorOf(android.R.attr.navigationBarColor)
    println("WINDOW navigationBarColor = " + Integer.toHexString(nav))
    assertEquals(canvas, nav)
  }

  @Test
  fun `浅色画布上状态栏图标必须是深色`() {
    val out = resolve(android.R.attr.windowLightStatusBar)
    println("WINDOW windowLightStatusBar type=" + out.type + " data=" + out.data)
    assertTrue("白底配白图标：状态栏时间电量看不见", out.data != 0)
  }
}
