///|
/// CM-1010: send-on-behalf tone matching — first proxy-write offers recent-message
/// samples so the draft can match context register.
pub(all) struct ToneSample {
  id : String
  preview : String
  /// Informal / formal / terse / warm, etc.
  register_ : String
} derive(Eq, Debug)

///|
pub extend ToneSample with Eq::{equal, not_equal}

///|
pub extend ToneSample with Debug::{to_repr}

///|
pub(all) enum ToneOfferPhase {
  /// First proxy-write: must offer samples before drafting.
  OfferSamples
  /// User picked a sample / register; drafting may proceed.
  Matched(register_~ : String)
  Drafted(body~ : String, register_~ : String)
} derive(Eq, Debug)

///|
pub extend ToneOfferPhase with Eq::{equal, not_equal}

///|
pub extend ToneOfferPhase with Debug::{to_repr}

///|
pub(all) struct SendOnBehalfToneSession {
  recent : Array[ToneSample]
  mut phase : ToneOfferPhase
  mut first_proxy_write_done : Bool
}

///|
pub fn SendOnBehalfToneSession::new(
  recent : Array[ToneSample],
) -> SendOnBehalfToneSession {
  { recent, phase: OfferSamples, first_proxy_write_done: false, }
}

///|
/// First proxy-write: offer recent-message samples (do not draft yet).
pub fn SendOnBehalfToneSession::begin_first_proxy_write(
  self : SendOnBehalfToneSession,
) -> Result[Array[ToneSample], String] {
  if self.recent.length() == 0 {
    return Err("no recent messages to sample for tone")
  }
  self.phase = OfferSamples
  self.first_proxy_write_done = true
  let out : Array[ToneSample] = []
  for s in self.recent {
    out.push(s)
  }
  Ok(out)
}

///|
pub fn SendOnBehalfToneSession::offered_samples(
  self : SendOnBehalfToneSession,
) -> Bool {
  match self.phase {
    OfferSamples => self.first_proxy_write_done
    Matched(_) | Drafted(_) => true
  }
}

///|
/// User selects a sample — lock register for matching context.
pub fn SendOnBehalfToneSession::pick_sample(
  self : SendOnBehalfToneSession,
  sample_id~ : String,
) -> Result[String, String] {
  if !self.first_proxy_write_done {
    return Err("must offer tone samples on first proxy-write before pick")
  }
  for s in self.recent {
    if s.id == sample_id {
      self.phase = Matched(register_=s.register_)
      return Ok(s.register_)
    }
  }
  Err("unknown tone sample: " + sample_id)
}

///|
/// Draft only after samples offered and register matched.
pub fn SendOnBehalfToneSession::draft_matching_register(
  self : SendOnBehalfToneSession,
  body~ : String,
) -> Result[String, String] {
  match self.phase {
    OfferSamples =>
      Err("first proxy-write must offer samples and pick register first")
    Matched(register_~) => {
      // Body must reflect the chosen register (context cue).
      if !body.contains(register_) && !body_matches_register(body, register_) {
        return Err("draft must match context register: " + register_)
      }
      self.phase = Drafted(body~, register_~)
      Ok(body)
    }
    Drafted(body~, register_~) => {
      let _ = register_
      Ok(body)
    }
  }
}

///|
fn body_matches_register(body : String, register_ : String) -> Bool {
  // Accept common register cues embedded or labeled.
  body.contains("[" + register_ + "]") ||
  body.has_prefix(register_ + ":") ||
  (
    register_ == "formal" &&
    (body.contains("Dear") || body.contains("Sincerely"))
  ) ||
  (
    register_ == "informal" &&
    (body.contains("Hey") || body.contains("Thanks!"))
  ) ||
  (register_ == "terse" && body.length() < 80) ||
  (
    register_ == "warm" &&
    (body.contains("hope") || body.contains("appreciate"))
  )
}

///|
pub fn SendOnBehalfToneSession::matched_register(
  self : SendOnBehalfToneSession,
) -> String? {
  match self.phase {
    Matched(register_~) => Some(register_)
    Drafted(body~, register_~) => {
      let _ = body
      Some(register_)
    }
    OfferSamples => None
  }
}
