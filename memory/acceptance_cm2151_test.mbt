///|
/// CM-2151: SetUserAttribute — persist user job; Given state job When Set Then readable back.
test "acceptance_CM-2151_set_user_attribute_job_persists" {
  let store = @memory.ProfileMemoryStore::new()
  store.open_session(@memory.SessionId::{ value: "sess-2151", })
  assert_eq(@memory.user_attribute_job_key(), "job")
  match store.set_user_attribute(key="job", value="Staff Engineer") {
    Err(e) => fail(e)
    Ok(_) => ()
  }
  match store.get_user_attribute(key="job") {
    Err(e) => fail(e)
    Ok(v) => assert_eq(v, "Staff Engineer")
  }
  // Persists across session boundary (profile scope).
  store.open_session(@memory.SessionId::{ value: "sess-2151-b", })
  match store.get_user_attribute(key="job") {
    Err(e) => fail(e)
    Ok(v) => assert_eq(v, "Staff Engineer")
  }
  // Convenience set_user_job round-trip.
  match store.set_user_job(job="Product Manager") {
    Err(e) => fail(e)
    Ok(v) => assert_eq(v, "Product Manager")
  }
  match store.get_user_attribute(key="job") {
    Err(e) => fail(e)
    Ok(v) => assert_eq(v, "Product Manager")
  }
  match store.set_user_attribute(key="", value="x") {
    Err(m) => assert_true(m.contains("key"))
    Ok(_) => fail("empty key must Err")
  }
  match store.set_user_attribute(key="job", value="") {
    Err(m) => assert_true(m.contains("value"))
    Ok(_) => fail("empty value must Err")
  }
  match store.get_user_attribute(key="no-such-attr") {
    Err(m) => assert_true(m.contains("not found"))
    Ok(_) => fail("missing attribute must Err")
  }
}
