///|
/// CM-1604: in-memory bytes for ReadEmailAttachment / UploadFile path contract.
pub(all) struct AttachmentBytes {
  name : String
  path : String
  size_bytes : Int32
  /// Content length equals size_bytes (no truncation).
  content_len : Int32
} derive(Eq, Debug)

///|
pub extend AttachmentBytes with Eq::{equal, not_equal}

///|
pub extend AttachmentBytes with Debug::{to_repr}

///|
pub(all) struct AttachmentStore {
  files : Array[AttachmentBytes]
}

///|
pub fn AttachmentStore::new() -> AttachmentStore {
  { files: [], }
}

///|
fn path_under_workspace(path : String) -> Bool {
  path.has_prefix("/workspace/") || path == "/workspace"
}

///|
/// CM-1604: ReadEmailAttachment — large file not truncated; path under /workspace.
pub fn AttachmentStore::read_email_attachment(
  self : AttachmentStore,
  attachment_id~ : String,
  path~ : String,
  size_bytes~ : Int32,
) -> Result[AttachmentBytes, String] {
  if !path_under_workspace(path) {
    return Err("ReadEmailAttachment path must be under /workspace: " + path)
  }
  if size_bytes < 0 {
    return Err("size_bytes must be non-negative")
  }
  // Contract: content_len == size_bytes (no truncation of large files).
  let bytes = {
    name: attachment_id,
    path,
    size_bytes,
    content_len: size_bytes,
  }
  self.files.push(bytes)
  Ok(bytes)
}

///|
/// CM-1604: UploadFile — destination path contract under /workspace; size preserved.
pub fn AttachmentStore::upload_file(
  self : AttachmentStore,
  source_path~ : String,
  dest_path~ : String,
  size_bytes~ : Int32,
) -> Result[AttachmentBytes, String] {
  if !path_under_workspace(dest_path) {
    return Err("UploadFile dest must be under /workspace: " + dest_path)
  }
  let _ = source_path
  if size_bytes < 0 {
    return Err("size_bytes must be non-negative")
  }
  let name = dest_path
  let bytes = { name, path: dest_path, size_bytes, content_len: size_bytes, }
  self.files.push(bytes)
  Ok(bytes)
}

///|
pub fn AttachmentBytes::was_truncated(self : AttachmentBytes) -> Bool {
  self.content_len != self.size_bytes
}
