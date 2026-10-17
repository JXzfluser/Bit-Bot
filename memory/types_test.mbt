///|
test "memory recall and update" {
  let store = @memory.InMemoryStore::new()
  store.update(@memory.UpdateOp::{
    scope: @memory.Profile,
    key: "name",
    value: "bitbot",
  })
  let hits = store.recall(@memory.RecallQuery::{
    scope: @memory.Profile,
    key_prefix: Some("na"),
    limit: 10,
  })
  assert_eq(hits.length(), 1)
  assert_eq(hits[0].value, "bitbot")
  assert_eq(store.scopes().length(), 3)
  assert_eq(@memory.Journal.label(), "journal")
}
