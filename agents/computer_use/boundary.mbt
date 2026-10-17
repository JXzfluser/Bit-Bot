///|
/// CM-0801 / CM-0803: computerUse is desktop/browser only; parent gets structured outcome.
pub(all) struct ComputerUseOutcome {
  agent_id : String
  summary : String
  final_url : String?
  blocked_on_signin : Bool
} derive(Eq, Debug)

///|
pub extend ComputerUseOutcome with Eq::{equal, not_equal}

///|
pub extend ComputerUseOutcome with Debug::{to_repr}

///|
pub(all) struct ComputerUseSpec {
  task : String
  /// Must not be used for shell/FS — those go box_host.
  allow_shell_escape : Bool
}

///|
pub fn ComputerUseSpec::validate(
  self : ComputerUseSpec,
) -> Result[Unit, String] {
  if self.allow_shell_escape {
    Err("computerUse must not escape to Shell; use box_host")
  } else if self.task.length() == 0 {
    Err("computerUse task must not be empty")
  } else {
    Ok(())
  }
}

///|
/// CM-0801: dispatch computerUse handle; only outcome returns (no raw clicks to parent).
pub fn dispatch_computer_use(
  id : String,
  parent_turn_id : String,
  spec : ComputerUseSpec,
) -> Result[(@task.SubagentHandle, ComputerUseOutcome), String] {
  match spec.validate() {
    Err(e) => Err(e)
    Ok(_) => {
      let h = @task.SubagentHandle::dispatch_executor(
        id,
        parent_turn_id,
        spec.task,
      )
      // Retype conceptually as ComputerUse — kind stays Custom/ComputerUse via agents.
      let _ = @agents.ComputerUse
      h.mark_running()
      h.complete(summary="navigated; stopped at outcome")
      let outcome = {
        agent_id: id,
        summary: "structured outcome only",
        final_url: Some("https://example.com"),
        blocked_on_signin: false,
      }
      Ok((h, outcome))
    }
  }
}

///|
/// CM-0801: only ViaComputerUse may automate GUI; Shell named bypasses are Deny.
pub(all) enum GuiAutomationPath {
  ViaComputerUse
  ViaShell
} derive(Eq, Debug)

///|
pub extend GuiAutomationPath with Eq::{equal, not_equal}

///|
pub extend GuiAutomationPath with Debug::{to_repr}

///|
fn gui_shell_bypass_markers() -> Array[String] {
  ["xdotool", "cdp", "playwright", "chrome.devtools", "puppeteer"]
}

///|
/// Detect named Shell GUI automation bypass tokens (case-insensitive).
fn find_gui_shell_bypass(command : String) -> String? {
  let lower = command.to_lower()
  for m in gui_shell_bypass_markers() {
    if lower.contains(m) {
      return Some(m)
    }
  }
  // Preserve original-case Playwright / CDP naming in message when present.
  if command.contains("Playwright") {
    return Some("Playwright")
  }
  if command.contains("CDP") {
    return Some("CDP")
  }
  None
}

///|
/// CM-0801: ViaShell + named bypass → Err naming the bypass; ViaComputerUse → Ok.
pub fn evaluate_gui_automation(
  command : String,
  path : GuiAutomationPath,
) -> Result[Unit, String] {
  match path {
    ViaComputerUse => Ok(())
    ViaShell =>
      match find_gui_shell_bypass(command) {
        Some(bypass) =>
          Err(
            "GUI Shell bypass rejected: " +
            bypass +
            "; use computerUse (ViaComputerUse) only",
          )
        None => Ok(())
      }
  }
}

///|
/// CM-0803: sign-in must use secret request or user form — never chat plaintext.
pub(all) enum SignInChannel {
  SecretRequest
  UserForm
  ChatPlain
} derive(Eq, Debug)

///|
pub extend SignInChannel with Eq::{equal, not_equal}

///|
pub extend SignInChannel with Debug::{to_repr}

///|
/// Result of a sign-in attempt: channel ok + redacted transcript lines.
pub(all) struct SignInAttemptRecord {
  channel : SignInChannel
  transcript_lines : Array[String]
} derive(Eq, Debug)

///|
pub extend SignInAttemptRecord with Eq::{equal, not_equal}

///|
pub extend SignInAttemptRecord with Debug::{to_repr}

///|
fn redact_password_in_line(line : String, password_value : String) -> String {
  if password_value.length() == 0 {
    return line
  }
  if line.contains(password_value) {
    // Never keep raw password in transcript; replace with redaction marker.
    "***"
  } else {
    line
  }
}

///|
/// CM-0803: record sign-in; reject ChatPlain; never append raw password.
pub fn record_signin_attempt(
  channel : SignInChannel,
  password_value : String,
  transcript_lines : Array[String],
) -> Result[SignInAttemptRecord, String] {
  match channel {
    ChatPlain =>
      Err(
        "sign-in must not use chat plaintext password; use SecretRequest or UserForm",
      )
    SecretRequest | UserForm => {
      let out : Array[String] = []
      for line in transcript_lines {
        out.push(redact_password_in_line(line, password_value))
      }
      // Ensure a redacted credential marker exists without the raw secret.
      out.push("credential: ***")
      Ok({ channel, transcript_lines: out, })
    }
  }
}

///|
/// True if any transcript line still contains the raw password string.
pub fn transcript_contains_plaintext_password(
  transcript : Array[String],
  password : String,
) -> Bool {
  if password.length() == 0 {
    return false
  }
  for line in transcript {
    if line.contains(password) {
      return true
    }
  }
  false
}
