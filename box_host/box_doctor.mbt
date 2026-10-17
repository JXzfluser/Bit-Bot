///|
/// CM-0607: box-doctor self-check — PASS/FAIL lines parsable; log at /tmp/box-doctor.log.

///|
pub fn box_doctor_log_path() -> String {
  "/tmp/box-doctor.log"
}

///|
pub(all) enum DoctorLineKind {
  Pass
  Fail
  Summary
  Other
} derive(Eq, Debug)

///|
pub extend DoctorLineKind with Eq::{equal, not_equal}

///|
pub extend DoctorLineKind with Debug::{to_repr}

///|
pub(all) struct DoctorLine {
  raw : String
  kind : DoctorLineKind
  check_name : String
} derive(Eq, Debug)

///|
pub extend DoctorLine with Eq::{equal, not_equal}

///|
pub extend DoctorLine with Debug::{to_repr}

///|
fn trim_owned(s : String) -> String {
  s.trim().to_owned()
}

///|
/// Parse one box-doctor log line: "PASS <name>" | "FAIL <name>" | "SUMMARY ..."
pub fn parse_doctor_line(raw : String) -> DoctorLine {
  let trimmed = trim_owned(raw)
  if trimmed.has_prefix("PASS ") {
    {
      raw: trimmed,
      kind: Pass,
      check_name: trim_owned(trimmed[5:].to_owned()),
    }
  } else if trimmed.has_prefix("FAIL ") {
    {
      raw: trimmed,
      kind: Fail,
      check_name: trim_owned(trimmed[5:].to_owned()),
    }
  } else if trimmed.has_prefix("SUMMARY") {
    { raw: trimmed, kind: Summary, check_name: "", }
  } else {
    { raw: trimmed, kind: Other, check_name: "", }
  }
}

///|
pub(all) struct BoxDoctorReport {
  log_path : String
  lines : Array[DoctorLine]
  raw_log : String
  overall_pass : Bool
} derive(Eq, Debug)

///|
pub extend BoxDoctorReport with Eq::{equal, not_equal}

///|
pub extend BoxDoctorReport with Debug::{to_repr}

///|
pub fn BoxDoctorReport::failure_names(self : BoxDoctorReport) -> Array[String] {
  let out : Array[String] = []
  for ln in self.lines {
    if ln.kind == Fail {
      out.push(ln.check_name)
    }
  }
  out
}

///|
pub fn BoxDoctorReport::failures_reportable(self : BoxDoctorReport) -> Bool {
  self.failure_names().length() > 0 || !self.overall_pass
}

///|
/// Injectable check outcomes for kernel-contract mock (no real Host probe).
pub(all) struct BoxDoctorCheck {
  name : String
  pass : Bool
} derive(Eq, Debug)

///|
pub extend BoxDoctorCheck with Eq::{equal, not_equal}

///|
pub extend BoxDoctorCheck with Debug::{to_repr}

///|
/// Run box-doctor: write /tmp/box-doctor.log on HostAbi FS; return parsable report.
pub fn HostAbi::run_box_doctor(
  self : HostAbi,
  checks~ : Array[BoxDoctorCheck],
) -> BoxDoctorReport {
  let log_path = box_doctor_log_path()
  let lines : Array[DoctorLine] = []
  let mut raw = ""
  let mut all_pass = true
  for c in checks {
    let prefix = if c.pass { "PASS " } else { "FAIL " }
    if !c.pass {
      all_pass = false
    }
    let raw_line = prefix + c.name
    raw = raw + raw_line + "\n"
    lines.push(parse_doctor_line(raw_line))
  }
  let summary = if all_pass {
    "SUMMARY overall=PASS"
  } else {
    "SUMMARY overall=FAIL"
  }
  raw = raw + summary + "\n"
  lines.push(parse_doctor_line(summary))
  self.fs.set(log_path, raw)
  self.effects.push("box-doctor:" + log_path)
  { log_path, lines, raw_log: raw, overall_pass: all_pass, }
}

///|
/// Read back the log written by box-doctor (must exist after run).
pub fn HostAbi::read_box_doctor_log(self : HostAbi) -> Result[String, String] {
  let log_path = box_doctor_log_path()
  match self.fs.get(log_path) {
    Some(c) => Ok(c)
    None => Err("box-doctor log missing: " + log_path)
  }
}
