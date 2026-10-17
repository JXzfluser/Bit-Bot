///|
test "store key" {
  assert_eq(@stores.StoreKey::new("/mem/a").path, "/mem/a")
}
