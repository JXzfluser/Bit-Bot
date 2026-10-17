///|
/// CM-2112 / I-batch CM-2113–2126: policy engine — short refuse, no steps/PoC/methods.

///|
pub(all) enum PolicyCategory {
  ChildSex
  WeaponsDualUseBio
  CrimeAssistance
  SelfHarm
  OffensiveCyber
  Copyright
  Allowed
  OtherDisallowed
} derive(Eq, Debug)

///|
pub extend PolicyCategory with Eq::{equal, not_equal}

///|
pub extend PolicyCategory with Debug::{to_repr}

///|
pub(all) enum PolicyVerdict {
  /// Short refuse text; never includes steps, PoC, or methods.
  Refuse(message~ : String, category~ : PolicyCategory)
  Allow
} derive(Eq, Debug)

///|
pub extend PolicyVerdict with Eq::{equal, not_equal}

///|
pub extend PolicyVerdict with Debug::{to_repr}

///|
pub fn PolicyVerdict::is_refuse(self : PolicyVerdict) -> Bool {
  match self {
    Refuse(_) => true
    Allow => false
  }
}

///|
pub fn PolicyVerdict::message(self : PolicyVerdict) -> String {
  match self {
    Refuse(message~, ..) => message
    Allow => ""
  }
}

///|
pub fn PolicyVerdict::category(self : PolicyVerdict) -> PolicyCategory {
  match self {
    Refuse(category~, ..) => category
    Allow => Allowed
  }
}

///|
/// ChildSex verdicts are a terminal stop (no continue/help).
pub fn PolicyVerdict::is_terminal_stop(self : PolicyVerdict) -> Bool {
  match self {
    Refuse(category~, ..) => category is ChildSex
    Allow => false
  }
}

///|
fn has_policy_tag(ask : String, tag : String) -> Bool {
  ask.contains("[policy:" + tag + "]")
}

///|
fn looks_child_sex(ask : String) -> Bool {
  if has_policy_tag(ask, "child_sex") {
    return true
  }
  // Safe category-id markers only (never graphic content).
  let keys = ["child_sex", "CSAM", "CSE"]
  for k in keys {
    if ask.contains(k) {
      break true
    }
  } nobreak {
    false
  }
}

///|
fn looks_weapons_dual_use_bio(ask : String) -> Bool {
  if has_policy_tag(ask, "weaponization") ||
    has_policy_tag(ask, "dual_use_bio") ||
    has_policy_tag(ask, "weapons") {
    return true
  }
  let keys = [
    "weaponization", "dual_use_bio", "pathogen-enhancement", "pathogen_enhancement",
    "chem_weapons", "nuclear_weapons",
  ]
  for k in keys {
    if ask.contains(k) {
      break true
    }
  } nobreak {
    false
  }
}

///|
fn looks_crime_assistance(ask : String) -> Bool {
  if has_policy_tag(ask, "crime_help") ||
    has_policy_tag(ask, "crime_assistance") {
    return true
  }
  let keys = ["crime_help", "crime_assistance", "phishing kit", "scam script"]
  for k in keys {
    if ask.contains(k) {
      break true
    }
  } nobreak {
    false
  }
}

///|
fn looks_self_harm(ask : String) -> Bool {
  if has_policy_tag(ask, "self_harm") {
    return true
  }
  let keys = ["self_harm", "self-harm"]
  for k in keys {
    if ask.contains(k) {
      break true
    }
  } nobreak {
    false
  }
}

///|
fn looks_offensive_cyber(ask : String) -> Bool {
  if has_policy_tag(ask, "exploit_poc") ||
    has_policy_tag(ask, "offensive_cyber") {
    return true
  }
  let keys = [
    "CTF", "ctf", "exploit", "PoC", "poc", "pwn", "unauthorized access", "buffer overflow payload",
    "write malware", "keylogger", "ransomware", "sql injection exploit", "reverse shell",
    "hack into", "crack password hash",
  ]
  for k in keys {
    if ask.contains(k) {
      break true
    }
  } nobreak {
    false
  }
}

///|
fn child_sex_refuse_message() -> String {
  "illegal — I must stop. I cannot help with this."
}

///|
fn weapons_refuse_message() -> String {
  "I can't help with weaponization or dual-use bio abuse."
}

///|
fn crime_refuse_message() -> String {
  "I can't help with crime assistance."
}

///|
fn self_harm_care_message() -> String {
  "I'm concerned about you. Please reach out for care — call or text 988 (US)."
}

///|
fn offensive_cyber_refuse_message() -> String {
  "I can't help with offensive cyber, exploits, CTF attack steps, or unauthorized access."
}

///|
/// CM-2116 / CM-2125: copyright — forbid substantial / chapter verbatim; summary substitute.
fn looks_copyright(ask : String) -> Bool {
  if has_policy_tag(ask, "copyright") ||
    has_policy_tag(ask, "copyright_chapter") ||
    has_policy_tag(ask, "copyright_verbatim") {
    return true
  }
  let keys = [
    "copyright_verbatim", "copyright_chapter", "paste the whole chapter", "copy the entire book chapter",
    "reproduce substantial copyrighted text",
  ]
  for k in keys {
    if ask.contains(k) {
      break true
    }
  } nobreak {
    false
  }
}

///|
fn looks_copyright_chapter(ask : String) -> Bool {
  if has_policy_tag(ask, "copyright_chapter") {
    return true
  }
  let keys = [
    "copyright_chapter", "paste the whole chapter", "copy the entire book chapter",
    "verbatim chapter",
  ]
  for k in keys {
    if ask.contains(k) {
      break true
    }
  } nobreak {
    false
  }
}

///|
/// Abstract summary substitute only — never emits real copyrighted chunks.
fn copyright_refuse_summary_message(ask : String) -> String {
  if looks_copyright_chapter(ask) {
    "I can't reproduce a copyrighted chapter verbatim. Here's a short abstract summary instead: [ABSTRACT_FIXTURE] key themes only — no substantial quoted text."
  } else {
    "I can't provide substantial copyrighted text verbatim. Here's a short abstract summary instead: [ABSTRACT_FIXTURE] high-level overview only."
  }
}

///|
/// CM-2112 / I-batch: evaluate user ask against policy engine.
/// Detection order: ChildSex → SelfHarm → Weapons → Crime → OffensiveCyber → Copyright → Allow.
pub fn evaluate_policy(ask : String) -> PolicyVerdict {
  if looks_child_sex(ask) {
    Refuse(message=child_sex_refuse_message(), category=ChildSex)
  } else if looks_self_harm(ask) {
    Refuse(message=self_harm_care_message(), category=SelfHarm)
  } else if looks_weapons_dual_use_bio(ask) {
    Refuse(message=weapons_refuse_message(), category=WeaponsDualUseBio)
  } else if looks_crime_assistance(ask) {
    Refuse(message=crime_refuse_message(), category=CrimeAssistance)
  } else if looks_offensive_cyber(ask) {
    Refuse(message=offensive_cyber_refuse_message(), category=OffensiveCyber)
  } else if looks_copyright(ask) {
    Refuse(message=copyright_refuse_summary_message(ask), category=Copyright)
  } else {
    Allow
  }
}

///|
/// True when refuse text stays short and free of exploit steps / PoC body.
/// Applies to OffensiveCyber and other short-refuse categories (not SelfHarm care).
pub fn is_short_refuse_no_poc(verdict : PolicyVerdict) -> Bool {
  match verdict {
    Allow => false
    Refuse(message~, category~) => {
      match category {
        SelfHarm | Allowed => return false
        ChildSex
        | WeaponsDualUseBio
        | CrimeAssistance
        | OffensiveCyber
        | Copyright
        | OtherDisallowed => ()
      }
      let m = message
      // Short: under ~200 chars.
      if m.length() > 200 {
        return false
      }
      // Must not contain step/PoC instructional markers.
      let bad = [
        "step 1", "Step 1", "```", "payload =", "exploit code", "here is a PoC",
        "run this command", "nc -e", "/bin/sh",
      ]
      for b in bad {
        if m.contains(b) {
          break false
        }
      } nobreak {
        true
      }
    }
  }
}

///|
/// CM-2116 / CM-2125: copyright policy result with summary substitute.
pub(all) struct CopyrightPolicyResult {
  refuse_verbatim : Bool
  /// Abstract summary only — never substantial copyrighted text.
  summary_substitute : String
  is_chapter_request : Bool
  category : PolicyCategory
} derive(Eq, Debug)

///|
pub extend CopyrightPolicyResult with Eq::{equal, not_equal}

///|
pub extend CopyrightPolicyResult with Debug::{to_repr}

///|
/// Evaluate a copyright-related ask. Abstract fixtures only (no real copyrighted chunks).
pub fn evaluate_copyright_policy(ask : String) -> CopyrightPolicyResult {
  let chapter = looks_copyright_chapter(ask)
  let hit = looks_copyright(ask) || chapter
  if hit {
    {
      refuse_verbatim: true,
      summary_substitute: copyright_refuse_summary_message(ask),
      is_chapter_request: chapter,
      category: Copyright,
    }
  } else {
    {
      refuse_verbatim: false,
      summary_substitute: "",
      is_chapter_request: false,
      category: Allowed,
    }
  }
}

///|
/// True when result forbids verbatim and supplies a non-empty abstract summary.
pub fn CopyrightPolicyResult::uses_summary_not_verbatim(
  self : CopyrightPolicyResult,
) -> Bool {
  self.refuse_verbatim &&
  self.summary_substitute.length() > 0 &&
  self.summary_substitute.contains("ABSTRACT_FIXTURE") &&
  !self.summary_substitute.contains("SUBSTANTIAL_COPYRIGHTED_CHUNK")
}
