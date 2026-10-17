///|
/// CM-1006: send via connected user account; multi-account must pick which.
pub(all) struct MailAccount {
  id : String
  address : String
} derive(Eq, Debug)

///|
pub extend MailAccount with Eq::{equal, not_equal}

///|
pub extend MailAccount with Debug::{to_repr}

///|
pub(all) struct SendOnBehalf {
  accounts : Array[MailAccount]
}

///|
pub fn SendOnBehalf::new(accounts : Array[MailAccount]) -> SendOnBehalf {
  { accounts, }
}

///|
pub fn SendOnBehalf::send(
  self : SendOnBehalf,
  account_id~ : String?,
  to_~ : String,
  subject~ : String,
  body~ : String,
) -> Result[String, String] {
  let _ = body
  if self.accounts.length() == 0 {
    return Err("no connected mail account")
  }
  if self.accounts.length() > 1 && account_id is None {
    return Err("multiple accounts: ask which account to send from")
  }
  let acct = match account_id {
    Some(id) =>
      for a in self.accounts {
        if a.id == id {
          break Some(a)
        }
      } nobreak {
        None
      }
    None => Some(self.accounts[0])
  }
  match acct {
    None => Err("unknown account_id")
    Some(a) =>
      Ok("sent from=" + a.address + " to=" + to_ + " subject=" + subject)
  }
}
