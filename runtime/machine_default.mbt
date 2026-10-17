///|
/// CM-0706: Sent-from-machine default — message may carry source machineId;
/// when unspecified, default to the last-message machine.

///|
pub(all) struct InboundMachineNote {
  /// Explicit "[Sent from machine <id>]" when present.
  sent_from_machine : String?
  text : String
} derive(Eq, Debug)

///|
pub extend InboundMachineNote with Eq::{equal, not_equal}

///|
pub extend InboundMachineNote with Debug::{to_repr}

///|
pub fn InboundMachineNote::with_machine(
  machine_id : String,
  text~ : String = "",
) -> InboundMachineNote {
  { sent_from_machine: Some(machine_id), text, }
}

///|
pub fn InboundMachineNote::unspecified(
  text~ : String = "",
) -> InboundMachineNote {
  { sent_from_machine: None, text, }
}

///|
/// Session tracker: last inbound message's machine becomes the default.
pub(all) struct MachineDefaultSession {
  mut last_message_machine : String?
}

///|
pub fn MachineDefaultSession::new() -> MachineDefaultSession {
  { last_message_machine: None, }
}

///|
/// Resolve target machineId for tools when caller omits machineId.
/// - If message carries sent_from_machine → use it and update last.
/// - If unspecified → use last_message_machine (if any).
pub fn MachineDefaultSession::ingest(
  self : MachineDefaultSession,
  note : InboundMachineNote,
) -> String? {
  match note.sent_from_machine {
    Some(mid) => {
      self.last_message_machine = Some(mid)
      Some(mid)
    }
    None => self.last_message_machine
  }
}

///|
pub fn MachineDefaultSession::default_machine(
  self : MachineDefaultSession,
) -> String? {
  self.last_message_machine
}

///|
/// When tool call omits machineId, fall back to session default (CM-0706).
pub fn MachineDefaultSession::resolve_machine_id(
  self : MachineDefaultSession,
  explicit : String?,
) -> String? {
  match explicit {
    Some(mid) => Some(mid)
    None => self.last_message_machine
  }
}
