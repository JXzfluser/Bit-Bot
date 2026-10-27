///|
/// AgentContext 的跨回合持久化。
///
/// 背景(ADR 0002 的边界):**内核不碰文件**。它每回合一个新进程,进程一死
/// `AgentContext` 就没了 —— 这正是 AR-03/AR-04 记的「能力齐但未接线」:
/// `runtime/agent_context.mbt` 的 encode/decode 一直只有内核自己的测试在调,
/// 产品路径一次都没调,于是用户仍然感觉不到「多轮不失忆」。
///
/// 所以上下文的**搬运**必须跨进程,而**语义**仍然在内核:
///   内核 → Host:`load_context`  要一份编码后的上下文
///   内核 → Host:`save_context`  把更新后的上下文交回去落盘
/// Host 只存字节,不懂内容;encode/decode 都在内核。
///
/// 落点:**按 Bot 分槽**(与 `botMemorySlot` 同构)。一个 Bot 一份会话状态。
///
/// 兼容性:Host 不认识这两个 op 时回 `unknown op`,内核据此当作「没有历史」继续跑 ——
/// 旧 Host 配新内核不会炸,只是没有跨回合记忆。

///|
/// 上下文的槽位 key:**per (Bot, 会话)**。
///
/// 为什么不是只按 Bot:桌面端有多个会话(对话),用户新开一个对话时**不该**
/// 带着上个对话的记忆 —— 那是「串味」,不是「记得我」。
/// 而房间回合的 session id 本来就是 `room-<roomId>-<botId>`
/// (`hosts/desktop/main.js` 的 `runRoomResponderTurn`),所以 (Bot, 会话)
/// 这个键跟产品既有的用法完全吻合:同一房间的同一个 Bot 记得自己说过什么,
/// 换个房间或换个 Bot 就不记得。
///
/// 长期记忆(事实/偏好)是另一回事,那个是 per-Bot 的(`botMemorySlot`)。
pub fn agent_context_slot(
  bot_id : String,
  session_id : String,
) -> String {
  let bot = bot_id.trim().to_owned()
  let session = session_id.trim().to_owned()
  let b = if bot == "" { "agent-bit" } else { bot }
  let s = if session == "" { "default" } else { session }
  b + "__" + s
}

///|
/// FFI 请求:load_context / save_context。两者同一形状,少一个字段而已。
pub fn encode_context_request(
  op : String,
  slot : String,
  text : String,
) -> String {
  "{\"op\":\"" +
  escape_json_string(op) +
  "\",\"slot\":\"" +
  escape_json_string(slot) +
  "\",\"text\":\"" +
  escape_json_string(text) +
  "\"}"
}

///|
/// 从 FFI 响应里取出上下文文本。空串 = 没有可用历史(第一次回合,或 Host 不支持)。
pub fn parse_context_reply(raw : String) -> String {
  match json_string_value(raw, "output") {
    Some(s) => s
    None => ""
  }
}

///|
/// 解码回来的上下文,把 session id 对齐到当前回合。
/// 槽位是按 Bot 分的,session id 是「这段对话属于哪次会话」——
/// 两者不是一回事,别混。
pub fn agent_context_aligned(
  decoded : @runtime.AgentContext,
  session_id : String,
) -> @runtime.AgentContext {
  if decoded.session() == session_id {
    decoded
  } else {
    { ..decoded, session_id: session_id, }
  }
}
