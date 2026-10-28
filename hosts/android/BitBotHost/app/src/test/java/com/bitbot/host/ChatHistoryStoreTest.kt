package com.bitbot.host

import com.bitbot.host.ui.ChatLine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * ChatHistoryStore 的四条：读得回来、有界、坏文件不炸、写不进不假装成功。
 *
 * 这一组断的是**本轮新写的一层**，所以形式上不是「修复前红」，而是「负向对照给牙齿」
 * （report §8.27 逐个跑过：把 takeLast 摘掉 → HS-02 红；让坏 JSON 往外抛 → HS-03 红；
 * 把 save 的返回值改成恒定 true → HS-04 红）。用户能看见的那一半在
 * ChatThreadPersistenceTest（真渲染屏幕），这里只管这一层的边界。
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ChatHistoryStoreTest {
  private fun store(maxLines: Int = ChatHistoryStore.DEFAULT_MAX_LINES) =
    ChatHistoryStore(RuntimeEnvironment.getApplication(), maxLines)

  @Test
  fun HS01_存进去的按原顺序读得回来() {
    val s = store()
    val lines =
      listOf(
        ChatLine("user", "第一句"),
        ChatLine("assistant", "第二条回复", "内核原文"),
        ChatLine("user", "第三句"),
      )
    assertTrue("save 说它失败了", s.save(lines))
    val back = s.load()
    assertEquals("条数不对", 3, back.size)
    assertEquals(listOf("user", "assistant", "user").joinToString(), back.map { it.role }.joinToString())
    assertEquals("第三句", back.last().text)
    // raw 是给「看原始回执」用的，掉了就等于把功能删了
    assertEquals("内核原文", back[1].raw)
    assertTrue("没有 raw 的那条不该凭空多出原文", back[0].raw == null)
  }

  @Test
  fun HS02_只留最近这么多条() {
    val s = store(maxLines = 3)
    val all = (1..5).map { ChatLine("user", "第 $it 句") }
    s.save(all)
    val back = s.load()
    assertEquals("有界没生效：留了 ${back.size} 条", 3, back.size)
    // 丢的必须是**最旧**的，留最新那条之外还要保住顺序
    assertEquals(listOf("第 3 句", "第 4 句", "第 5 句"), back.map { it.text })
    val onDisk = s.file.readText()
    assertFalse("盘上写的还是全量：" + onDisk, onDisk.contains("第 1 句"))
  }

  @Test
  fun HS03_半截文件当没有历史而不是把首屏炸掉() {
    val s = store()
    s.file.parentFile?.mkdirs()
    s.file.writeText("[{\"role\":\"user\",\"text\":\"没写完的")
    val back = runCatching { s.load() }
    assertTrue("坏历史文件把 load 抛了：$back", back.isSuccess)
    assertEquals("坏文件应当读成空表", emptyList<ChatLine>(), back.getOrDefault(listOf(ChatLine("x", "y"))))
    // 读不出来不许顺手删用户文件：下一次 save 会覆盖，但不轮到这一步就先删是越界
    assertTrue("load 不许把用户文件顺手删掉", s.file.isFile)
  }

  @Test
  fun HS04_写不进去就老实回false不许抛也不许说成功() {
    val s = store()
    s.file.parentFile?.mkdirs()
    // 用「目标路径是一个目录」造一个与文件系统权限无关的写故障（沙箱里跑的是 root，
    // chmod 拦不住写，拿权限位造故障会得到一条永远绿的假守卫）
    assertTrue("目录占位没建起来，这条断不了", s.file.mkdir())
    val result = runCatching { s.save(listOf(ChatLine("user", "发出去了的一句话"))) }
    assertTrue("落盘失败把异常抛到了调用方：$result", result.isSuccess)
    assertFalse("写不进去却回了 true（发送路径会以为已经存下来了）", result.getOrDefault(true))
    assertTrue("写失败不许把占位的目录删掉用户的东西", s.file.isDirectory)
  }
}
