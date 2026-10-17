///|
/// CM-1807: slides / office-pptx — produce an openable pptx artifact.
/// Kernel-contract: artifact path + magic/openable flag (Host opens real PPTX).

///|
/// PPTX is OOXML (ZIP); magic starts with PK\x03\x04.
fn pptx_zip_magic() -> String {
  let sb = StringBuilder()
  sb.write_string("PK")
  sb.write_char('\u{03}')
  sb.write_char('\u{04}')
  sb.write_string("BITBOT-MOCK-PPTX")
  sb.to_string()
}

///|
pub(all) struct PptxArtifact {
  path : String
  title : String
  /// True when path is under /workspace and magic present.
  openable : Bool
  /// Leading magic bytes recorded for contract checks.
  magic_prefix : String
} derive(Eq, Debug)

///|
pub extend PptxArtifact with Eq::{equal, not_equal}

///|
pub extend PptxArtifact with Debug::{to_repr}

///|
/// Mock FS holding generated pptx bytes.
pub(all) struct SlidesHost {
  files : Map[String, String]
}

///|
pub fn SlidesHost::mock() -> SlidesHost {
  { files: Map([]), }
}

///|
pub fn SlidesHost::exists(self : SlidesHost, path : String) -> Bool {
  match self.files.get(path) {
    Some(_) => true
    None => false
  }
}

///|
/// CM-1807: generate slides → openable pptx under /workspace.
pub fn SlidesHost::generate_pptx(
  self : SlidesHost,
  title~ : String,
  slides~ : Array[String] = ["Title", "Agenda", "Thanks"],
  filename~ : String = "deck.pptx",
) -> Result[PptxArtifact, String] {
  if title.length() == 0 {
    return Err("slides: title required")
  }
  if slides.length() == 0 {
    return Err("slides: need at least one slide")
  }
  let path = "/workspace/agent-tools/" + filename
  let magic = pptx_zip_magic()
  let mut body = magic
  body = body + "|title=" + title
  for s in slides {
    body = body + "|slide:" + s
  }
  self.files.set(path, body)
  let openable = path.has_prefix("/workspace/") && body.has_prefix("PK")
  Ok({ path, title, openable, magic_prefix: "PK", })
}

///|
pub fn slides_skill_name() -> String {
  "slides"
}

///|
pub fn office_pptx_skill_name() -> String {
  "office-pptx"
}
