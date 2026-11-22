package com.bitbot.host

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 手机端「指挥」客户端的**纯逻辑**单测(P1 批 5)。
 *
 * 这三条不需要 emulator、不需要真机、不需要网络 —— 它们量的是最容易在真机上
 * 出事、而两边单测都会绿着的那几处:
 *   ① `task_sig` 的编码与服务端 `encodeURIComponent` 逐字一致(差一个字符,真机上就是永久 404);
 *   ② 错误码 → HTTP 状态的映射与服务端 `taskCommandStatus` 一致(否则界面会说错话);
 *   ③ 清单的字段名与服务端 `toTaskListItem` 一一对上(字段漂了 = 界面上一片空白)。
 *
 * 渲染那一层在 `TaskCommandUiWiringTest`(真 HTTP + 真 Compose 语义树)。
 */
class TaskCommandClientTest {

  /**
   * TC-01 `task_sig` 的编码。
   *
   * 服务端 `hosts/shared/task_view.js` 的 `encodeTaskSig` 就是 JS 的 `encodeURIComponent`:
   * 放行 `A-Za-z0-9-_.!~*'()`,其余一律 `%XX`(大写十六进制、UTF-8 字节)。
   */
  @Test
  fun `task_sig 的编码要和服务端的 encodeURIComponent 逐字一致`() {
    // 真正的形状:<room_id>|<message_id> —— 那个 `|` 不编码就会把路径段切坏。
    assertEquals("room-a%7Cmsg-1", TaskCommandCodec.encodeTaskSig("room-a|msg-1"))
    // 空格:java.net.URLEncoder 会编成 `+`,而服务端用 decodeURIComponent 解 —— 那样就丢了。
    assertEquals("a%20b", TaskCommandCodec.encodeTaskSig("a b"))
    // 非 ASCII:按 UTF-8 字节逐个编。
    assertEquals("%E4%B8%AD%E6%96%87", TaskCommandCodec.encodeTaskSig("中文"))
    // encodeURIComponent 放行的那几个符号。
    assertEquals("-_.!~*'()", TaskCommandCodec.encodeTaskSig("-_.!~*'()"))
    // 空串不炸。
    assertEquals("", TaskCommandCodec.encodeTaskSig(""))
  }

  /**
   * TC-02 错误码 → HTTP 状态。
   *
   * 与服务端 `hosts/shared/cn_inbound_server.js` 的 `taskCommandStatus()` 同一套:
   * 参数缺失 400 / 找不到 404 / 业务失败 409。
   */
  @Test
  fun `错误码到状态的映射要和服务端一致`() {
    assertEquals(400, TaskCommandStatus.statusOf("task_sig_required"))
    assertEquals(400, TaskCommandStatus.statusOf("room_id_required"))
    assertEquals(400, TaskCommandStatus.statusOf("text_required"))
    assertEquals(400, TaskCommandStatus.statusOf("task_required"))
    assertEquals(400, TaskCommandStatus.statusOf("from_bot_required"))
    assertEquals(400, TaskCommandStatus.statusOf("to_bot_required"))
    assertEquals(404, TaskCommandStatus.statusOf("room_not_found"))
    assertEquals(404, TaskCommandStatus.statusOf("bot_not_found"))
    assertEquals(409, TaskCommandStatus.statusOf("same_bot"))
    assertEquals(409, TaskCommandStatus.statusOf("bot_not_in_room"))
    assertEquals(409, TaskCommandStatus.statusOf("no_running_task"))
    // 服务端没登记过的码按 409 算(那是服务端的兜底档),不许自己编一个 500。
    assertEquals(409, TaskCommandStatus.statusOf("something_new"))
  }

  /**
   * TC-03 清单的字段名逐条读对。
   *
   * 这份 JSON 的形状逐字照服务端 `toTaskListItem` 的返回对象
   * (`hosts/shared/task_view.js`):字段少一个,界面上就是少一块信息。
   */
  @Test
  fun `清单里的每一个字段都要读出来`() {
    val list = parseTaskCommandList(JSONObject(TASKS_JSON))
    assertTrue("ok 必须是 true", list.ok)
    assertEquals("device_id 要读出来", "dev-test", list.deviceId)
    assertEquals("count 要读出来", 1, list.count)
    assertEquals("清单里应该有 1 条", 1, list.tasks.size)

    val t = list.tasks[0]
    assertEquals("room-a|msg-1", t.taskSig)
    assertEquals("room-a", t.roomId)
    assertEquals("内容团队", t.roomTitle)
    assertEquals("needs_you", t.bucket)
    assertEquals("waiting", t.state)
    assertEquals("写一篇稿子", t.title)
    assertEquals("写一篇稿子", t.task)
    assertEquals(listOf("Alice", "Bob"), t.members)
    assertEquals(2, t.total)
    assertEquals(1, t.returned)
    assertTrue("partial 要读出来", t.partial)
    assertFalse("running 要读出来(这一条不在跑)", t.running)
    assertEquals("2026-11-21T10:00:00.000Z", t.at)
    assertEquals("2026-11-21T10:01:00.000Z", t.updatedAt)

    // 步（谁干了什么）
    assertEquals(1, t.steps.size)
    val step = t.steps[0]
    assertEquals("Alice", step.name)
    assertEquals("b1", step.botId)
    assertTrue("ok 要读出来", step.ok)
    assertEquals("我先去找资料", step.text)
    assertEquals("", step.error)
    assertEquals("2026-11-21T10:00:00.000Z", step.at)

    // 「要你拍板」
    assertEquals("用哪个角度？", t.needsYou?.question)
    assertEquals(listOf("A", "B"), t.needsYou?.candidates)
    assertEquals("2026-11-21T10:00:00.000Z", t.needsYou?.at)

    // 能不能点 —— **服务端算的**,端上不猜。
    assertTrue(t.can.steer)
    assertTrue(t.can.replan)
    assertTrue(t.can.swap)
    assertFalse("没有在跑的就不该能刹停", t.can.cancel)
  }

  /** TC-04 没有 needs_you 的任务,那一栏就该是 null(不许编一个空的出来)。 */
  @Test
  fun `没有要你拍板的那一条,needs_you 就是 null`() {
    val json = """{"ok":true,"device_id":"d","count":1,"tasks":[
      {"task_sig":"r|1","room_id":"r","room_title":"","bucket":"working","state":"",
       "title":"t","task":"t","members":[],"steps":[],"needs_you":null,"total":0,"returned":0,
       "partial":false,"running":true,"at":"","updated_at":"",
       "can":{"steer":true,"replan":true,"swap":false,"cancel":true}}]}"""
    val t = parseTaskCommandList(JSONObject(json)).tasks[0]
    assertNull("没有 needs_you 就该是 null", t.needsYou)
    assertTrue(t.running)
    assertTrue(t.can.cancel)
    assertFalse(t.can.swap)
  }

  companion object {
    /** 与服务端 `toTaskListItem` 的返回对象**逐字同形**的一份清单。 */
    const val TASKS_JSON = """
      {"ok":true,"device_id":"dev-test","count":1,"tasks":[
        {"task_sig":"room-a|msg-1","room_id":"room-a","room_title":"内容团队",
         "bucket":"needs_you","state":"waiting","title":"写一篇稿子","task":"写一篇稿子",
         "members":["Alice","Bob"],
         "steps":[{"name":"Alice","bot_id":"b1","ok":true,"text":"我先去找资料","error":"",
                   "at":"2026-11-21T10:00:00.000Z"}],
         "needs_you":{"question":"用哪个角度？","candidates":["A","B"],
                      "at":"2026-11-21T10:00:00.000Z"},
         "total":2,"returned":1,"partial":true,"running":false,
         "at":"2026-11-21T10:00:00.000Z","updated_at":"2026-11-21T10:01:00.000Z",
         "can":{"steer":true,"replan":true,"swap":true,"cancel":false}}]}
    """
  }
}
