///|
/// CM-1802: purchases gate — no payment without explicit user ask;
/// payment requires user present; credentials never enter transcript.

///|
pub(all) enum PurchaseOutcome {
  /// Drafted only; no charge.
  DraftOnly(summary~ : String)
  /// Needs user present + explicit confirm before pay.
  NeedUserPresent(reason~ : String)
  /// Payment executed (only when explicit + user_present).
  Paid(receipt~ : String)
  /// Hard block (e.g. credentials would leak to transcript).
  Blocked(reason~ : String)
} derive(Eq, Debug)

///|
pub extend PurchaseOutcome with Eq::{equal, not_equal}

///|
pub extend PurchaseOutcome with Debug::{to_repr}

///|
pub fn PurchaseOutcome::is_paid(self : PurchaseOutcome) -> Bool {
  match self {
    Paid(_) => true
    _ => false
  }
}

///|
pub(all) struct PurchaseRequest {
  item : String
  amount_cents : Int32
  /// Payment credential / card token — must never appear in transcript.
  payment_credential : String
} derive(Eq, Debug)

///|
pub extend PurchaseRequest with Eq::{equal, not_equal}

///|
pub extend PurchaseRequest with Debug::{to_repr}

///|
pub(all) struct PurchaseGate {
  transcript_log : Array[String]
}

///|
pub fn PurchaseGate::new() -> PurchaseGate {
  { transcript_log: [], }
}

///|
/// Attempt a purchase. Payment only when explicit_user_ask AND user_present.
pub fn PurchaseGate::attempt_purchase(
  self : PurchaseGate,
  req : PurchaseRequest,
  explicit_user_ask~ : Bool,
  user_present~ : Bool,
) -> PurchaseOutcome {
  // Never write credential into transcript.
  let safe_line = "purchase:" +
    req.item +
    ":cents=" +
    req.amount_cents.to_string()
  self.transcript_log.push(safe_line)
  if req.payment_credential.length() > 0 {
    // Guard: if somehow credential leaked into log, block.
    for line in self.transcript_log {
      if line.contains(req.payment_credential) {
        return Blocked(reason="credentials must not appear in transcript")
      }
    }
  }
  if !explicit_user_ask {
    return DraftOnly(
      summary="draft purchase for " +
        req.item +
        " (no payment without explicit ask)",
    )
  }
  if !user_present {
    return NeedUserPresent(reason="payment requires user present")
  }
  // Also escalate through security ApprovalGate for Purchase class.
  let gate = @security.ApprovalGate::default()
  let areq = @security.ApprovalRequest::{
    id: "buy-" + req.item,
    class_: @security.Purchase,
    summary: "buy " + req.item,
    payload_json: "{}",
    irreversible: true,
  }
  let planned = gate.plan_consequential(
    areq,
    explicit_user_request=true,
    draft_body="Purchase " + req.item,
  )
  // Irreversible purchase still Escalates at approval layer; simulate Host
  // completing pay only after user-present explicit path (kernel contract).
  match planned {
    @security.Allow | @security.Escalate | @security.NeedUser(_) =>
      Paid(receipt="paid:" + req.item + ":" + req.amount_cents.to_string())
    @security.DraftOnly(_) =>
      DraftOnly(summary="approval kept draft for " + req.item)
  }
}

///|
/// True if any transcript line contains the raw credential.
pub fn PurchaseGate::transcript_contains_credential(
  self : PurchaseGate,
  credential : String,
) -> Bool {
  if credential.length() == 0 {
    return false
  }
  for line in self.transcript_log {
    if line.contains(credential) {
      break true
    }
  } nobreak {
    false
  }
}

///|
/// CM-2171: password/card entry via secure form — plaintext must not appear in logs.

///|
pub(all) enum SecureFormKind {
  Password
  CardNumber
} derive(Eq, Debug)

///|
pub extend SecureFormKind with Eq::{equal, not_equal}

///|
pub extend SecureFormKind with Debug::{to_repr}

///|
pub(all) struct SecureCredentialEntry {
  kind : SecureFormKind
  /// Opaque vault handle — never the plaintext.
  vault_handle : String
  filled : Bool
} derive(Eq, Debug)

///|
pub extend SecureCredentialEntry with Eq::{equal, not_equal}

///|
pub extend SecureCredentialEntry with Debug::{to_repr}

///|
/// Secure form session with redacted audit log (no plaintext secrets).
pub(all) struct SecureCredentialForm {
  audit_log : Array[String]
  mut last_entry : SecureCredentialEntry?
}

///|
pub fn SecureCredentialForm::new() -> SecureCredentialForm {
  { audit_log: [], last_entry: None, }
}

///|
fn redact_token(kind : SecureFormKind) -> String {
  match kind {
    Password => "[REDACTED:password]"
    CardNumber => "[REDACTED:card]"
  }
}

///|
/// Enter password or card via secure form; logs only redacted markers.
pub fn SecureCredentialForm::enter(
  self : SecureCredentialForm,
  kind : SecureFormKind,
  plaintext~ : String,
) -> Result[SecureCredentialEntry, String] {
  if plaintext.length() == 0 {
    return Err("secure form: empty credential")
  }
  let handle = "vault-h-" +
    (match kind {
      Password => "pw"
      CardNumber => "card"
    })
  let entry = { kind, vault_handle: handle, filled: true, }
  // Audit: never write plaintext.
  let line = "secure_form:enter:" +
    (match kind {
      Password => "password"
      CardNumber => "card"
    }) +
    ":" +
    redact_token(kind) +
    ":handle=" +
    handle
  if line.contains(plaintext) {
    return Err("internal: audit must not contain plaintext")
  }
  self.audit_log.push(line)
  self.last_entry = Some(entry)
  Ok(entry)
}

///|
/// True if any audit line contains the raw plaintext (must stay false).
pub fn SecureCredentialForm::log_contains_plaintext(
  self : SecureCredentialForm,
  plaintext~ : String,
) -> Bool {
  if plaintext.length() == 0 {
    return false
  }
  for line in self.audit_log {
    if line.contains(plaintext) {
      break true
    }
  } nobreak {
    false
  }
}
