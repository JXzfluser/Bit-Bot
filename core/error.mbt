///|
pub(all) enum BitError {
  InvalidArgument(message~ : String)
  NotFound(message~ : String)
  Denied(message~ : String)
  HostFailure(message~ : String)
  Internal(message~ : String)
} derive(Eq, Debug)

///|
pub extend BitError with Eq::{equal, not_equal}

///|
pub extend BitError with Debug::{to_repr}

///|
pub fn BitError::message(self : BitError) -> String {
  match self {
    InvalidArgument(message~) => message
    NotFound(message~) => message
    Denied(message~) => message
    HostFailure(message~) => message
    Internal(message~) => message
  }
}
