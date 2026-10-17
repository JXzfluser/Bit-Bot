///|
test "channel id and inbound" {
  let ch = @channels.ChannelId::{ kind: @channels.Chat, id: "main", }
  assert_eq(ch.render(), "chat:main")
  let msg = @channels.InboundMessage::{
    channel: ch,
    message_id: "m1",
    sender: "user",
    body: "hello",
    received_at_ms: 0L,
    thread_id: None,
  }
  assert_eq(msg.body, "hello")
}
