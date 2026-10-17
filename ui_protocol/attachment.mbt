///|
/// Reference to a file the UI may deliver as an attachment (CM-0106).
pub(all) struct AttachmentRef {
  name : String
  mime : String
  path : String
} derive(Eq, Debug)

///|
pub extend AttachmentRef with Eq::{not_equal, equal}

///|
pub extend AttachmentRef with Debug::{to_repr}

///|
fn path_has_scheme(path : String) -> Bool {
  // Invented / non-box schemes: anything with "://" before a path separator.
  match path.find("://") {
    None => false
    Some(idx) => {
      // Reject if scheme marker appears (e.g. file://, http://, s3://).
      // Absolute box paths never contain "://".
      let _ = idx
      true
    }
  }
}

///|
fn path_is_allowed_root(path : String) -> Bool {
  path.has_prefix("/workspace") || path.has_prefix("/home/box")
}

///|
/// Shape-validate an attachment path: no FS probe.
/// Reject empty, ".." segments, and invented schemes; accept /workspace and /home/box.
pub fn validate_path(path : String) -> Result[Unit, String] {
  if path.length() == 0 {
    return Err("attachment path must not be empty")
  }
  if path.contains("..") {
    return Err("attachment path must not contain '..'")
  }
  if path_has_scheme(path) {
    return Err("attachment path must not use a scheme")
  }
  if !path_is_allowed_root(path) {
    return Err("attachment path must be under /workspace or /home/box")
  }
  Ok(())
}

///|
pub fn AttachmentRef::validate(self : AttachmentRef) -> Result[Unit, String] {
  if self.name.length() == 0 {
    return Err("attachment name must not be empty")
  }
  validate_path(self.path)
}

///|
/// In-test filesystem: only listed paths "exist" (CM-0106).
pub(all) struct MockFS {
  existing : Array[String]
}

///|
pub fn MockFS::new(paths : Array[String]) -> MockFS {
  { existing: paths, }
}

///|
pub fn MockFS::exists(self : MockFS, path : String) -> Bool {
  for p in self.existing {
    if p == path {
      return true
    }
  }
  false
}

///|
/// CM-0106: deliver only when path shape is valid AND present in mock FS.
/// Hallucinated (shape-ok but missing) paths are rejected.
pub fn deliverable_attachment(
  fs : MockFS,
  name : String,
  mime : String,
  path : String,
) -> Result[AttachmentRef, String] {
  match validate_path(path) {
    Err(e) => Err(e)
    Ok(_) =>
      if fs.exists(path) {
        Ok({ name, mime, path, })
      } else {
        Err("hallucinated path: file does not exist")
      }
  }
}

///|
/// CM-2137: inbound user attachments attached to a turn opening.
pub(all) struct InboundAttachmentBag {
  refs : Array[AttachmentRef]
} derive(Eq, Debug)

///|
pub extend InboundAttachmentBag with Eq::{equal, not_equal}

///|
pub extend InboundAttachmentBag with Debug::{to_repr}

///|
pub fn InboundAttachmentBag::empty() -> InboundAttachmentBag {
  { refs: [], }
}

///|
/// CM-2137: open turn with user-attached image/file → AttachmentRef readable.
pub fn collect_inbound_attachments(
  fs : MockFS,
  items : Array[(String, String, String)],
) -> Result[InboundAttachmentBag, String] {
  let refs : Array[AttachmentRef] = []
  for it in items {
    let (name, mime, path) = it
    match deliverable_attachment(fs, name, mime, path) {
      Err(e) => return Err(e)
      Ok(r) => refs.push(r)
    }
  }
  Ok({ refs, })
}

///|
/// True when every inbound AttachmentRef validates and is present on mock FS.
pub fn InboundAttachmentBag::all_readable(
  self : InboundAttachmentBag,
  fs : MockFS,
) -> Bool {
  if self.refs.length() == 0 {
    return false
  }
  for r in self.refs {
    match r.validate() {
      Err(_) => return false
      Ok(_) => if !fs.exists(r.path) { return false }
    }
  }
  true
}

///|
pub fn InboundAttachmentBag::first_ref(
  self : InboundAttachmentBag,
) -> AttachmentRef? {
  if self.refs.length() == 0 {
    None
  } else {
    Some(self.refs[0])
  }
}
