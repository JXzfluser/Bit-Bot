///|
/// CM-1601: GenerateImage — text-to-image; artifact on disk; deliverable as attachment.

///|
/// Mock Host media surface (no real diffusion).
pub(all) struct MediaHost {
  /// Paths written by GenerateImage (mock FS).
  artifacts : Array[String]
  /// Raw bytes / magic placeholders keyed by path.
  files : Map[String, String]
}

///|
pub fn MediaHost::mock() -> MediaHost {
  { artifacts: [], files: Map([]), }
}

///|
fn png_magic_bytes() -> String {
  let sb = StringBuilder()
  sb.write_char('\u{89}')
  sb.write_string("PNG")
  sb.write_char('\r')
  sb.write_char('\n')
  sb.write_char('\u{1a}')
  sb.write_char('\n')
  sb.write_string("BITBOT-GEN-IMAGE")
  sb.to_string()
}

///|
/// Result of GenerateImage: path on disk under /workspace.
pub(all) struct GeneratedImageArtifact {
  path : String
  prompt : String
  mime : String
  /// True when mock FS holds PNG magic bytes.
  on_disk : Bool
} derive(Eq, Debug)

///|
pub extend GeneratedImageArtifact with Eq::{equal, not_equal}

///|
pub extend GeneratedImageArtifact with Debug::{to_repr}

///|
/// CM-1601: generate image from prompt → artifact under /workspace/agent-tools/.
pub fn MediaHost::generate_image(
  self : MediaHost,
  prompt~ : String,
  name~ : String = "generated.png",
) -> Result[GeneratedImageArtifact, String] {
  if prompt.length() == 0 {
    return Err("GenerateImage requires a prompt")
  }
  // Refuse forging real-person photos (NG-009 kernel hint).
  let lower = prompt.to_lower()
  if lower.contains("real person photo") ||
    lower.contains("photograph of a real") {
    return Err("GenerateImage must not forge real-person photos")
  }
  let path = "/workspace/agent-tools/" + name
  let bytes = png_magic_bytes()
  self.files.set(path, bytes)
  self.artifacts.push(path)
  Ok({ path, prompt, mime: "image/png", on_disk: true, })
}

///|
pub fn MediaHost::exists(self : MediaHost, path : String) -> Bool {
  match self.files.get(path) {
    Some(_) => true
    None => false
  }
}

///|
/// CM-1601: turn on-disk artifact into a deliverable AttachmentRef via ui_protocol.
pub fn deliver_generated_image(
  host : MediaHost,
  artifact : GeneratedImageArtifact,
) -> Result[@ui_protocol.AttachmentRef, String] {
  if !artifact.on_disk || !host.exists(artifact.path) {
    return Err("GenerateImage artifact not on disk")
  }
  let fs = @ui_protocol.MockFS::new([artifact.path])
  @ui_protocol.deliverable_attachment(
    fs,
    "generated-image.png",
    artifact.mime,
    artifact.path,
  )
}

///|
/// CM-1603: video frame extracted for grounding (mock).
pub(all) struct VideoFrame {
  index : Int32
  /// Short caption / OCR / scene label from the frame.
  caption : String
  timestamp_ms : Int32
} derive(Eq, Debug)

///|
pub extend VideoFrame with Eq::{equal, not_equal}

///|
pub extend VideoFrame with Debug::{to_repr}

///|
/// Extract mock frames from a video path (kernel-contract; Host does real decode).
pub fn extract_video_frames(
  video_path~ : String,
  max_frames~ : Int32 = 4,
) -> Result[Array[VideoFrame], String] {
  if video_path.length() == 0 {
    return Err("extract_video_frames: empty video path")
  }
  if !(video_path.has_prefix("/workspace/") ||
    video_path.has_suffix(".mp4") ||
    video_path.has_suffix(".webm") ||
    video_path.has_suffix(".mov")) {
    return Err("extract_video_frames: invalid video path")
  }
  let frames : Array[VideoFrame] = []
  let n = if max_frames < 1 { 1 } else { max_frames }
  let mut i = 0
  while i < n {
    frames.push({
      index: i,
      caption: "frame-" + i.to_string() + " scene from " + video_path,
      timestamp_ms: i * 1000,
    })
    i = i + 1
  }
  Ok(frames)
}

///|
/// Build an answer string grounded in frame captions (must cite at least one frame).
pub fn answer_from_frames(
  question~ : String,
  frames : Array[VideoFrame],
) -> Result[String, String] {
  if frames.length() == 0 {
    return Err("answer_from_frames: no frames")
  }
  if question.length() == 0 {
    return Err("answer_from_frames: empty question")
  }
  let sb = StringBuilder()
  sb.write_string("answer grounded in frames for: ")
  sb.write_string(question)
  sb.write_string("; saw ")
  sb.write_string(frames[0].caption)
  if frames.length() > 1 {
    sb.write_string(" and ")
    sb.write_string(frames[1].caption)
  }
  Ok(sb.to_string())
}
