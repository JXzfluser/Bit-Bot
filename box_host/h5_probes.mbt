///|
/// H5 probe skeleton (CM-1601/1602/1603/2157/1807/2131/2101/2128/2103) — Wave H5 media/cards/pixels.
/// Authority: docs/host-integration-interface-gaps.md §6 (H5).
/// Kernel-facing: schedules/records intents against Mock or Live.
/// Does NOT claim host-integration I-PASS — Bit验证 promotes from Host smoke artifacts.
/// Real evidence: scripts/host_h5_smoke.sh → docs/qa/artifacts/cm-XXXX-*/.
/// Residuals (honest, not in wave table): CM-0806 NOT_READY; CM-0705 platform_subset only.

///|
pub(all) enum H5Intent {
  Cm1601GenerateImage
  Cm1602GenerateVideo
  Cm1603WatchVideo
  Cm2157StructuredChart
  Cm1807Pptx
  Cm2131CursorAgentCard
  Cm2101ReactToMessage
  Cm2128OutboundReactEndTurn
  Cm2103MathMermaid
} derive(Eq, Debug)

///|
pub extend H5Intent with Eq::{equal, not_equal}

///|
pub extend H5Intent with Debug::{to_repr}

///|
pub fn H5Intent::cm_id(self : H5Intent) -> String {
  match self {
    Cm1601GenerateImage => "CM-1601"
    Cm1602GenerateVideo => "CM-1602"
    Cm1603WatchVideo => "CM-1603"
    Cm2157StructuredChart => "CM-2157"
    Cm1807Pptx => "CM-1807"
    Cm2131CursorAgentCard => "CM-2131"
    Cm2101ReactToMessage => "CM-2101"
    Cm2128OutboundReactEndTurn => "CM-2128"
    Cm2103MathMermaid => "CM-2103"
  }
}

///|
pub fn H5Intent::artifact_subdir(self : H5Intent) -> String {
  match self {
    Cm1601GenerateImage => "cm-1601-generate-image"
    Cm1602GenerateVideo => "cm-1602-generate-video"
    Cm1603WatchVideo => "cm-1603-watch-video"
    Cm2157StructuredChart => "cm-2157-structured-chart"
    Cm1807Pptx => "cm-1807-pptx"
    Cm2131CursorAgentCard => "cm-2131-cursor-agent-card"
    Cm2101ReactToMessage => "cm-2101-react-pill"
    Cm2128OutboundReactEndTurn => "cm-2128-react-end-turn"
    Cm2103MathMermaid => "cm-2103-math-mermaid"
  }
}

///|
/// Media intents (Pillow / ffmpeg / pptx) vs Host UI pixel intents.
pub fn H5Intent::is_media(self : H5Intent) -> Bool {
  match self {
    Cm1601GenerateImage
    | Cm1602GenerateVideo
    | Cm1603WatchVideo
    | Cm2157StructuredChart
    | Cm1807Pptx => true
    _ => false
  }
}

///|
pub fn H5Intent::is_ui(self : H5Intent) -> Bool {
  match self {
    Cm2131CursorAgentCard
    | Cm2101ReactToMessage
    | Cm2128OutboundReactEndTurn
    | Cm2103MathMermaid => true
    _ => false
  }
}

///|
fn h5_evidence_cmd_hint(intent : H5Intent) -> String {
  match intent {
    Cm1601GenerateImage =>
      "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1601"
    Cm1602GenerateVideo =>
      "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1602"
    Cm1603WatchVideo =>
      "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1603"
    Cm2157StructuredChart =>
      "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2157"
    Cm1807Pptx =>
      "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1807"
    Cm2131CursorAgentCard =>
      "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2131"
    Cm2101ReactToMessage =>
      "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2101"
    Cm2128OutboundReactEndTurn =>
      "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2128"
    Cm2103MathMermaid =>
      "bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2103"
  }
}

///|
/// Live-only media/UI evidence record (G-H5-1). i_claimed always false here.
pub(all) struct H5MediaEvidence {
  cm_id : String
  intent : H5Intent
  backend_kind : String
  /// CM-1601 / 2157 — PNG under /workspace/agent-tools/
  image_path : String?
  png_magic_ok : Bool?
  /// CM-1602 — encoded mp4
  video_path : String?
  video_complete_notified : Bool?
  /// CM-1603 — frame extract from mp4
  frame_path : String?
  /// CM-1807 — host-openable pptx (PK zip)
  pptx_path : String?
  pptx_pk_magic_ok : Bool?
  /// CM-2131
  cursor_agent_url : String?
  cursor_agent_opened : Bool?
  /// CM-2101 / 2128
  react_emoji : String?
  pill_visible : Bool?
  end_turn_left_pill : Bool?
  /// CM-2103
  math_rendered : Bool?
  mermaid_rendered : Bool?
  /// Shared
  artifact_dir : String
  evidence_cmd_hint : String
  audit_span_id : String
  /// Always false from this skeleton — only Bit验证 may mark I-PASS.
  i_claimed : Bool
  note : String
} derive(Eq, Debug)

///|
pub extend H5MediaEvidence with Eq::{equal, not_equal}

///|
pub extend H5MediaEvidence with Debug::{to_repr}

///|
pub fn H5MediaEvidence::asserts_i_not_claimed(self : H5MediaEvidence) -> Bool {
  !self.i_claimed
}

///|
/// Schedule/run H5 intent. Mock and Live both leave i_claimed=false.
/// Live records an audit span pointing at the artifacts dir.
/// Field slots are probe plan values; Host smoke fills real media/UI evidence.
pub fn HostAbi::run_h5_probe(
  self : HostAbi,
  intent : H5Intent,
) -> H5MediaEvidence {
  let sub = intent.artifact_subdir()
  let artifact_dir = host_artifacts_dir() + "/" + sub
  let backend_kind = self.backend_kind()
  let note = match self.backend {
    Mock =>
      "Mock backend — kernel-contract only; I not claimed (run Host H5 smoke for I evidence)"
    Live(_) =>
      if intent.is_media() {
        "Live backend — Host H5 smoke must prove real Pillow/ffmpeg/pptx artifacts; I not claimed here"
      } else {
        "Live backend — Host H5 smoke must prove Host UI C′ frames (pills/math/cursor-agent); I not claimed"
      }
  }
  let span_id = "h5:" + intent.cm_id() + ":" + backend_kind
  self.effects.push("h5_probe:" + intent.cm_id() + ":" + backend_kind)
  match self.backend {
    Live(_) =>
      self.record_audit(
        AuditSpan::make(
          "h5_probe:" + intent.cm_id(),
          artifact_path=Some(artifact_dir),
          ok=true,
          detail=note,
        ),
      )
    Mock => ()
  }
  let mut image_path : String? = None
  let png_magic_ok : Bool? = None
  let mut video_path : String? = None
  let mut video_complete_notified : Bool? = None
  let mut frame_path : String? = None
  let mut pptx_path : String? = None
  let pptx_pk_magic_ok : Bool? = None
  let mut cursor_agent_url : String? = None
  let cursor_agent_opened : Bool? = None
  let mut react_emoji : String? = None
  let mut pill_visible : Bool? = None
  let mut end_turn_left_pill : Bool? = None
  let mut math_rendered : Bool? = None
  let mut mermaid_rendered : Bool? = None
  match intent {
    Cm1601GenerateImage => {
      image_path = Some("/workspace/agent-tools/h5-cm1601-generate.png")
    }
    Cm1602GenerateVideo => {
      video_path = Some("/workspace/agent-tools/h5-cm1602-generate.mp4")
      video_complete_notified = Some(true)
    }
    Cm1603WatchVideo => {
      video_path = Some("/workspace/agent-tools/h5-cm1602-generate.mp4")
      frame_path = Some("/workspace/agent-tools/h5-cm1603-frame.png")
    }
    Cm2157StructuredChart => {
      image_path = Some("/workspace/agent-tools/h5-cm2157-chart.png")
    }
    Cm1807Pptx => {
      pptx_path = Some("/workspace/agent-tools/h5-cm1807-deck.pptx")
    }
    Cm2131CursorAgentCard => {
      cursor_agent_url = Some("https://cursor.com/agents/h5-throwaway-agent")
    }
    Cm2101ReactToMessage => {
      react_emoji = Some("👍")
      pill_visible = Some(true)
    }
    Cm2128OutboundReactEndTurn => {
      react_emoji = Some("🎉")
      pill_visible = Some(true)
      end_turn_left_pill = Some(true)
    }
    Cm2103MathMermaid => {
      math_rendered = Some(true)
      mermaid_rendered = Some(true)
    }
  }
  {
    cm_id: intent.cm_id(),
    intent,
    backend_kind,
    image_path,
    png_magic_ok,
    video_path,
    video_complete_notified,
    frame_path,
    pptx_path,
    pptx_pk_magic_ok,
    cursor_agent_url,
    cursor_agent_opened,
    react_emoji,
    pill_visible,
    end_turn_left_pill,
    math_rendered,
    mermaid_rendered,
    artifact_dir,
    evidence_cmd_hint: h5_evidence_cmd_hint(intent),
    audit_span_id: span_id,
    i_claimed: false,
    note,
  }
}

///|
/// Run all nine H5 intents; I never claimed by this helper.
pub fn HostAbi::run_h5_wave(self : HostAbi) -> Array[H5MediaEvidence] {
  let intents : Array[H5Intent] = [
    Cm1601GenerateImage,
    Cm1602GenerateVideo,
    Cm1603WatchVideo,
    Cm2157StructuredChart,
    Cm1807Pptx,
    Cm2131CursorAgentCard,
    Cm2101ReactToMessage,
    Cm2128OutboundReactEndTurn,
    Cm2103MathMermaid,
  ]
  let out : Array[H5MediaEvidence] = []
  for intent in intents {
    out.push(self.run_h5_probe(intent))
  }
  out
}

///|
/// Media subset only (1601/1602/1603/2157/1807).
pub fn HostAbi::run_h5_media(self : HostAbi) -> Array[H5MediaEvidence] {
  let intents : Array[H5Intent] = [
    Cm1601GenerateImage,
    Cm1602GenerateVideo,
    Cm1603WatchVideo,
    Cm2157StructuredChart,
    Cm1807Pptx,
  ]
  let out : Array[H5MediaEvidence] = []
  for intent in intents {
    out.push(self.run_h5_probe(intent))
  }
  out
}

///|
/// UI subset only (2131/2101/2128/2103).
pub fn HostAbi::run_h5_ui(self : HostAbi) -> Array[H5MediaEvidence] {
  let intents : Array[H5Intent] = [
    Cm2131CursorAgentCard,
    Cm2101ReactToMessage,
    Cm2128OutboundReactEndTurn,
    Cm2103MathMermaid,
  ]
  let out : Array[H5MediaEvidence] = []
  for intent in intents {
    out.push(self.run_h5_probe(intent))
  }
  out
}

///|
/// True iff every record leaves I unclaimed (skeleton invariant).
pub fn h5_wave_i_unclaimed(records : Array[H5MediaEvidence]) -> Bool {
  for r in records {
    if r.i_claimed {
      return false
    }
  }
  true
}
