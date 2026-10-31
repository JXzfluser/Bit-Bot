///|
/// CM-0304: recall by key_prefix + limit; empty when no match.
test "acceptance_CM-0304_recall_prefix_and_limit" {
  let store = @memory.InMemoryStore::new()
  store.update(@memory.UpdateOp::{
    scope: @memory.Profile,
    key: "favorite_color",
    value: "blue",
  })
  store.update(@memory.UpdateOp::{
    scope: @memory.Profile,
    key: "favorite_food",
    value: "rice",
  })
  store.update(@memory.UpdateOp::{
    scope: @memory.Profile,
    key: "timezone",
    value: "Asia/Shanghai",
  })
  let hits = store.recall(@memory.RecallQuery::{
    scope: @memory.Profile,
    key_prefix: Some("favorite"),
    limit: 10,
  })
  assert_eq(hits.length(), 2)
  let limited = store.recall(@memory.RecallQuery::{
    scope: @memory.Profile,
    key_prefix: Some("favorite"),
    limit: 1,
  })
  assert_eq(limited.length(), 1)
  let empty = store.recall(@memory.RecallQuery::{
    scope: @memory.Profile,
    key_prefix: Some("zzz"),
    limit: 10,
  })
  assert_eq(empty.length(), 0)
}

///|
/// CM-0305: update upserts (idempotent replace) then forget removes.
test "acceptance_CM-0305_update_upsert" {
  let store = @memory.InMemoryStore::new()
  store.update(@memory.UpdateOp::{
    scope: @memory.Journal,
    key: "day1",
    value: "started",
  })
  store.update(@memory.UpdateOp::{
    scope: @memory.Journal,
    key: "day1",
    value: "finished",
  })
  let hits = store.recall(@memory.RecallQuery::{
    scope: @memory.Journal,
    key_prefix: Some("day"),
    limit: 10,
  })
  assert_eq(hits.length(), 1)
  assert_eq(hits[0].value, "finished")
  assert_true(store.forget_by_key(@memory.Journal, "day1"))
  let after = store.recall(@memory.RecallQuery::{
    scope: @memory.Journal,
    key_prefix: Some("day"),
    limit: 10,
  })
  assert_eq(after.length(), 0)
}

///|
/// CM-0305: upsert idempotent; wrong/unsupported scope classification observable.
test "acceptance_CM-0305_unsupported_scope_classification" {
  assert_true(@memory.classify_scope("profile") is Ok(@memory.Profile))
  assert_true(@memory.classify_scope("journal") is Ok(@memory.Journal))
  assert_true(@memory.classify_scope("shared") is Ok(@memory.Shared))
  match @memory.classify_scope("secrets_vault") {
    Err(msg) => {
      assert_true(msg.contains("unsupported"))
      assert_true(msg.contains("secrets_vault"))
    }
    Ok(_) => fail("unsupported scope must be Err")
  }
  match @memory.classify_scope("not-a-scope") {
    Err(_) => ()
    Ok(_) => fail("wrong classification must be observable Err")
  }
  // Idempotent upsert still holds.
  let store = @memory.InMemoryStore::new()
  store.update(@memory.UpdateOp::{
    scope: @memory.Profile,
    key: "k",
    value: "v1",
  })
  store.update(@memory.UpdateOp::{
    scope: @memory.Profile,
    key: "k",
    value: "v2",
  })
  let hits = store.recall(@memory.RecallQuery::{
    scope: @memory.Profile,
    key_prefix: Some("k"),
    limit: 10,
  })
  assert_eq(hits.length(), 1)
  assert_eq(hits[0].value, "v2")
}
