///|
/// CM-2109: user-Finance connector surface — needsAuth finance namespace;
/// unauth cannot call; after auth usable (full tool set TBD). Kernel-contract.

///|
pub const USER_FINANCE_NAMESPACE : String = "user-Finance"

///|
/// Minimal finance tool stub (full set TBD per inventory).
pub(all) struct FinanceToolSpec {
  name : String
  description : String
  readonly_ : Bool
} derive(Eq, Debug)

///|
pub extend FinanceToolSpec with Eq::{equal, not_equal}

///|
pub extend FinanceToolSpec with Debug::{to_repr}

///|
/// user-Finance connector surface (needsAuth until authenticate).
pub(all) struct FinanceConnector {
  namespace_ : String
  mut status : ConnectorStatus
  tools : Array[FinanceToolSpec]
  /// Mock balances keyed by account id (available after auth).
  balances : Map[String, String]
}

///|
/// Fresh finance connector starts NeedsAuth — unusable until authenticate.
pub fn FinanceConnector::new() -> FinanceConnector {
  {
    namespace_: USER_FINANCE_NAMESPACE,
    status: NeedsAuth,
    tools: [],
    balances: Map([]),
  }
}

///|
pub fn FinanceConnector::auth_status(self : FinanceConnector) -> ConnectorStatus {
  self.status
}

///|
pub fn FinanceConnector::is_needs_auth(self : FinanceConnector) -> Bool {
  self.status is NeedsAuth
}

///|
pub fn FinanceConnector::is_usable(self : FinanceConnector) -> Bool {
  self.status.is_usable()
}

///|
/// Seed stub tool surface (full tool set TBD — kernel lists known stubs).
pub fn FinanceConnector::seed_stub_tools(self : FinanceConnector) -> Unit {
  self.tools.push({
    name: "list_accounts",
    description: "List linked finance accounts (read; full set TBD)",
    readonly_: true,
  })
  self.tools.push({
    name: "get_balance",
    description: "Get account balance (read; full set TBD)",
    readonly_: true,
  })
  self.tools.push({
    name: "list_transactions",
    description: "List recent transactions (read; full set TBD)",
    readonly_: true,
  })
}

///|
pub fn FinanceConnector::list_tool_names(self : FinanceConnector) -> Array[String] {
  let out : Array[String] = []
  for t in self.tools {
    out.push(t.name)
  }
  out
}

///|
pub fn FinanceConnector::has_tool(self : FinanceConnector, name : String) -> Bool {
  for t in self.tools {
    if t.name == name {
      return true
    }
  }
  false
}

///|
/// Mock authenticate — NeedsAuth → Ready.
pub fn FinanceConnector::authenticate(
  self : FinanceConnector,
) -> Result[Unit, String] {
  match self.status {
    NeedsAuth => {
      self.status = Ready
      Ok(())
    }
    Ready => Ok(())
    Loading => Err("finance still loading")
    NeedsGrant => Err("finance needs grant, not auth")
    Error(message~) => Err("finance error: " + message)
    Unavailable => Err("finance unavailable")
  }
}

///|
fn FinanceConnector::require_ready(
  self : FinanceConnector,
) -> Result[Unit, String] {
  if self.is_usable() {
    Ok(())
  } else {
    Err("user-Finance needsAuth: tools unavailable until authenticate")
  }
}

///|
/// Call a finance tool — Err while NeedsAuth; Ok after auth (stub result).
pub fn FinanceConnector::call_tool(
  self : FinanceConnector,
  name~ : String,
  account_id~ : String = "acct-1",
) -> Result[String, String] {
  match self.require_ready() {
    Err(e) => Err(e)
    Ok(_) => {
      if !self.has_tool(name) {
        return Err("unknown finance tool: " + name + " (full tool set TBD)")
      }
      match name {
        "list_accounts" => Ok("[\"acct-1\",\"acct-2\"]")
        "get_balance" =>
          match self.balances.get(account_id) {
            Some(b) => Ok(b)
            None => Ok("0.00")
          }
        "list_transactions" => Ok("[]")
        _ => Ok("ok")
      }
    }
  }
}

///|
pub fn FinanceConnector::seed_balance(
  self : FinanceConnector,
  account_id~ : String,
  balance~ : String,
) -> Unit {
  self.balances.set(account_id, balance)
}
