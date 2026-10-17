///|
/// CM-0301: Update profile; Recall in a new session sees the fact.
test "acceptance_CM-0301_profile_update_recall_across_sessions" {
  let mem = @memory.ProfileMemoryStore::new()
  mem.open_session(@memory.SessionId::{ value: "session-1", })
  mem.update_profile(key="favorite_color", value="teal")
  mem.update_profile(key="timezone", value="Asia/Shanghai")
  let in_s1 = mem.recall_profile(key_prefix=Some("favorite"), limit=10)
  assert_eq(in_s1.length(), 1)
  assert_eq(in_s1[0].value, "teal")

  // New session — profile facts must still be recallable.
  mem.open_session(@memory.SessionId::{ value: "session-2", })
  assert_eq(mem.session_id(), Some(@memory.SessionId::{ value: "session-2", }))
  let in_s2 = mem.recall_profile(key_prefix=Some("favorite"), limit=10)
  assert_eq(in_s2.length(), 1)
  assert_eq(in_s2[0].key, "favorite_color")
  assert_eq(in_s2[0].value, "teal")
  let tz = mem.recall_profile(key_prefix=Some("timezone"), limit=5)
  assert_eq(tz.length(), 1)
  assert_eq(tz[0].value, "Asia/Shanghai")
}
