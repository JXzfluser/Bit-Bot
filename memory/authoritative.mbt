///|
/// CM-2145: Memory API is authoritative for profile writes; box ordinary files are NOT.

///|
pub(all) enum ProfileWriteSource {
  /// Official Memory API / store update path.
  MemoryApi
  /// Ordinary file under the box filesystem (e.g. /workspace/notes.txt) — not authoritative.
  BoxOrdinaryFile(path~ : String)
} derive(Eq, Debug)

///|
pub extend ProfileWriteSource with Eq::{equal, not_equal}

///|
pub extend ProfileWriteSource with Debug::{to_repr}

///|
pub fn ProfileWriteSource::is_authoritative(self : ProfileWriteSource) -> Bool {
  match self {
    MemoryApi => true
    BoxOrdinaryFile(_) => false
  }
}

///|
pub(all) struct AuthoritativeProfileWrite {
  key : String
  value : String
  source : ProfileWriteSource
} derive(Eq, Debug)

///|
pub extend AuthoritativeProfileWrite with Eq::{equal, not_equal}

///|
pub extend AuthoritativeProfileWrite with Debug::{to_repr}

///|
/// Gate: only MemoryApi may authoritatively write profile facts.
pub fn accept_profile_write_source(
  source : ProfileWriteSource,
) -> Result[Unit, String] {
  match source {
    MemoryApi => Ok(())
    BoxOrdinaryFile(path~) =>
      Err("box ordinary file is not authoritative profile source: " + path)
  }
}

///|
/// Write profile via Memory API (authoritative) or refuse box-file source.
pub fn ProfileMemoryStore::write_profile_authoritative(
  self : ProfileMemoryStore,
  source : ProfileWriteSource,
  key~ : String,
  value~ : String,
) -> Result[AuthoritativeProfileWrite, String] {
  match accept_profile_write_source(source) {
    Err(e) => Err(e)
    Ok(_) => {
      self.update_profile(key~, value~)
      Ok({ key, value, source, })
    }
  }
}

///|
/// Scanning box ordinary files must not be treated as profile authority.
pub fn box_ordinary_file_is_profile_authority(path : String) -> Bool {
  let _ = path
  false
}
