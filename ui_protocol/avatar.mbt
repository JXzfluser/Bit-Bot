///|
/// CM-0202: UpdateAvatar — avatar file previewable; invalid path rejected.

///|
pub(all) struct AvatarPreview {
  agent_id : String
  path : String
  previewable : Bool
  mime : String
} derive(Eq, Debug)

///|
pub extend AvatarPreview with Eq::{equal, not_equal}

///|
pub extend AvatarPreview with Debug::{to_repr}

///|
fn avatar_ext_ok(path : String) -> Bool {
  let lower = path.to_lower()
  lower.has_suffix(".png") ||
  lower.has_suffix(".jpg") ||
  lower.has_suffix(".jpeg") ||
  lower.has_suffix(".webp") ||
  lower.has_suffix(".gif")
}

///|
fn avatar_mime_for(path : String) -> String {
  let lower = path.to_lower()
  if lower.has_suffix(".png") {
    "image/png"
  } else if lower.has_suffix(".jpg") || lower.has_suffix(".jpeg") {
    "image/jpeg"
  } else if lower.has_suffix(".webp") {
    "image/webp"
  } else if lower.has_suffix(".gif") {
    "image/gif"
  } else {
    "application/octet-stream"
  }
}

///|
/// Shape-validate an avatar path (reuse attachment roots; require image ext).
pub fn validate_avatar_path(path : String) -> Result[Unit, String] {
  match validate_path(path) {
    Err(e) => Err("invalid avatar path: " + e)
    Ok(_) =>
      if avatar_ext_ok(path) {
        Ok(())
      } else {
        Err(
          "invalid avatar path: must be an image (.png/.jpg/.jpeg/.webp/.gif)",
        )
      }
  }
}

///|
/// CM-0202: UpdateAvatar — path must validate and exist on mock FS to be previewable.
pub fn update_avatar(
  agent_id~ : String,
  path~ : String,
  fs~ : MockFS,
) -> Result[AvatarPreview, String] {
  match validate_avatar_path(path) {
    Err(e) => Err(e)
    Ok(_) =>
      if fs.exists(path) {
        Ok({ agent_id, path, previewable: true, mime: avatar_mime_for(path), })
      } else {
        Err("invalid avatar path: file does not exist")
      }
  }
}

///|
pub fn AvatarPreview::is_previewable(self : AvatarPreview) -> Bool {
  self.previewable
}
