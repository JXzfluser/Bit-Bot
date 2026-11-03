package com.bitbot.host

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * A3-6 门禁：界面要显示的是**真实走过的路**（直连 / 中转 · Nms），不是探针推测。
 *
 * 为什么单独钉这一层：`ConnectionStrategy.resolve` 判定的是「探针通不通」，而用户要看到的是
 * 「这条消息是怎么回来的」。跨网那一刻两者会分叉 —— 直连 TCP 可能连得上，但 HTTP 没成、
 * 回合实际走的是中转。界面若按探针显示，就会出现「显示直连、其实经了中转」这种骗人的状态。
 *
 * 全部纯 JVM（`TransportStatus` 不引用 Android 类）。
 */
class TransportStatusTest {

  /* -------------------------------------------------------------- TS-01 */

  @Test
  fun `TS-01 没连过就不显示连接方式（别把「已配对」盖成「未连接」）`() {
    TransportStatus.reset()
    assertNull("没连过时状态条不该多出「未连接」", TransportStatus.labelOrNull("zh"))
    // label 本身仍要有话说（调试/日志用）
    assertEquals("未连接", TransportStatus.label("zh"))
    assertEquals(ConnectionStrategy.Mode.NONE, TransportStatus.mode())
    assertEquals(0L, TransportStatus.latencyMs())
  }

  /* -------------------------------------------------------------- TS-02 */

  @Test
  fun `TS-02 直连与中转各自带真实耗时，并会随下一次连接改变`() {
    TransportStatus.reset()
    TransportStatus.record(ConnectionStrategy.Mode.RELAY, 320)
    assertEquals("中转 · 320ms", TransportStatus.labelOrNull("zh"))
    assertEquals(ConnectionStrategy.Mode.RELAY, TransportStatus.mode())

    // 同一台手机换回直连（回到同一 Wi-Fi）：状态必须跟着变，不许停在「中转」
    TransportStatus.record(ConnectionStrategy.Mode.DIRECT, 12)
    assertEquals("直连 · 12ms", TransportStatus.labelOrNull("zh"))

    // 两条都断 ⇒ 回到「没有连接方式」，而不是继续显示上一次的中转
    TransportStatus.record(ConnectionStrategy.Mode.NONE, 80)
    assertNull(TransportStatus.labelOrNull("zh"))

    // 负延迟归 0：时钟回拨也不许显示「-3ms」
    TransportStatus.record(ConnectionStrategy.Mode.DIRECT, -3)
    assertEquals("直连 · 0ms", TransportStatus.labelOrNull("zh"))
  }

  /* -------------------------------------------------------------- TS-03 */

  @Test
  fun `TS-03 三语文案与桌面同一套口径`() {
    TransportStatus.reset()
    TransportStatus.record(ConnectionStrategy.Mode.RELAY, 42)
    assertEquals("中转 · 42ms", TransportStatus.labelOrNull("zh"))
    // 端上 locale 就是 "zh-CN"，别名要能直接用（否则界面会掉回默认那次映射）
    assertEquals("中转 · 42ms", TransportStatus.labelOrNull("zh-CN"))
    assertEquals("中轉 · 42ms", TransportStatus.labelOrNull("zh-TW"))
    assertEquals("Relay · 42ms", TransportStatus.labelOrNull("en"))
    // 认不得的语言回到中文，不显示空串
    assertEquals("中转 · 42ms", TransportStatus.labelOrNull("fr"))

    TransportStatus.reset()
    assertEquals("未連線", TransportStatus.label("zh-TW"))
  }
}
