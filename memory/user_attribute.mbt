///|
/// CM-2151: SetUserAttribute — persist user job etc; Given state job When Set Then readable back.

///|
/// Well-known profile attribute keys (job / title / role, …).
pub fn user_attribute_job_key() -> String {
  "job"
}

///|
/// CM-2151: SetUserAttribute on profile store.
pub fn ProfileMemoryStore::set_user_attribute(
  self : ProfileMemoryStore,
  key~ : String,
  value~ : String,
) -> Result[Unit, String] {
  if key.length() == 0 {
    return Err("SetUserAttribute requires key")
  }
  if value.length() == 0 {
    return Err("SetUserAttribute requires value")
  }
  self.update_profile(key~, value~)
  Ok(())
}

///|
/// Read back a user attribute previously set via SetUserAttribute.
pub fn ProfileMemoryStore::get_user_attribute(
  self : ProfileMemoryStore,
  key~ : String,
) -> Result[String, String] {
  if key.length() == 0 {
    return Err("get_user_attribute requires key")
  }
  let entries = self.recall_profile(key_prefix=Some(key), limit=32)
  for e in entries {
    if e.key == key {
      return Ok(e.value)
    }
  }
  Err("user attribute not found: " + key)
}

///|
/// Convenience: set job title/role and read it back (CM-2151 happy path shape).
pub fn ProfileMemoryStore::set_user_job(
  self : ProfileMemoryStore,
  job~ : String,
) -> Result[String, String] {
  match self.set_user_attribute(key=user_attribute_job_key(), value=job) {
    Err(e) => Err(e)
    Ok(_) => self.get_user_attribute(key=user_attribute_job_key())
  }
}
