///|
/// CM-1402: SendToAgent — delivery arrives; loop detection.
/// Messages are agent-to-agent (not user-visible unless marked).

///|
pub(all) struct AgentMessage {
  from_id : String
  to_id : String
  body : String
  user_visible : Bool
} derive(Eq, Debug)

///|
pub extend AgentMessage with Eq::{equal, not_equal}

///|
pub extend AgentMessage with Debug::{to_repr}

///|
/// Delivery bus with loop detection (A→B→A… / self-send).
pub(all) struct SendToAgentBus {
  inbox : Array[AgentMessage]
  /// Stack of (from,to) edges in the current fan-in path for loop detection.
  path_edges : Array[String]
  mut loop_detected : Bool
}

///|
pub fn SendToAgentBus::new() -> SendToAgentBus {
  { inbox: [], path_edges: [], loop_detected: false, }
}

///|
fn edge_key(from_id : String, to_id : String) -> String {
  from_id + "->" + to_id
}

///|
/// Deliver a message; reject self-send and cyclic A→…→A paths.
pub fn SendToAgentBus::send(
  self : SendToAgentBus,
  from_id~ : String,
  to_id~ : String,
  body~ : String,
  user_visible~ : Bool = false,
) -> Result[AgentMessage, String] {
  if from_id.length() == 0 || to_id.length() == 0 {
    return Err("SendToAgent requires from and to")
  }
  if body.length() == 0 {
    return Err("SendToAgent body required")
  }
  if from_id == to_id {
    self.loop_detected = true
    return Err("SendToAgent loop: self-send forbidden")
  }
  let key = edge_key(from_id, to_id)
  let reverse = edge_key(to_id, from_id)
  for e in self.path_edges {
    if e == key || e == reverse {
      self.loop_detected = true
      return Err("SendToAgent loop detected: " + key)
    }
  }
  // Also detect if to already sent to from earlier in inbox (simple cycle).
  for m in self.inbox {
    if m.from_id == to_id && m.to_id == from_id {
      self.loop_detected = true
      return Err(
        "SendToAgent loop detected between " + from_id + " and " + to_id,
      )
    }
  }
  self.path_edges.push(key)
  let msg = { from_id, to_id, body, user_visible, }
  self.inbox.push(msg)
  Ok(msg)
}

///|
pub fn SendToAgentBus::delivered_to(
  self : SendToAgentBus,
  to_id : String,
) -> Array[AgentMessage] {
  let out : Array[AgentMessage] = []
  for m in self.inbox {
    if m.to_id == to_id {
      out.push(m)
    }
  }
  out
}

///|
pub fn SendToAgentBus::has_loop(self : SendToAgentBus) -> Bool {
  self.loop_detected
}

///|
/// Clear path edges after a turn (keeps inbox history for delivery assert).
pub fn SendToAgentBus::end_turn(self : SendToAgentBus) -> Unit {
  // Drain path edges but keep inbox.
  while self.path_edges.length() > 0 {
    let _ = self.path_edges.pop()
  }
}

///|
/// CM-2141: fan-out plan — notify multiple assistants.
pub(all) enum FanoutPlan {
  /// Single recipient — no ask required.
  Single(to_id~ : String)
  /// Multiple recipients with explicit user ask.
  ExplicitFanout(to_ids~ : Array[String])
  /// Wanted multi notify without user ask — must ask first.
  MustAskUserFirst(to_ids~ : Array[String], reason~ : String)
} derive(Eq, Debug)

///|
pub extend FanoutPlan with Eq::{equal, not_equal}

///|
pub extend FanoutPlan with Debug::{to_repr}

///|
pub fn FanoutPlan::requires_ask_first(self : FanoutPlan) -> Bool {
  match self {
    MustAskUserFirst(_) => true
    Single(_) | ExplicitFanout(_) => false
  }
}

///|
/// Plan SendToAgent fan-out. Without explicit ask, multi-notify → ask user first.
pub fn plan_send_to_agent_fanout(
  to_ids : Array[String],
  user_explicitly_asked_fanout~ : Bool,
) -> FanoutPlan {
  if to_ids.length() == 0 {
    return MustAskUserFirst(
      to_ids=[],
      reason="SendToAgent fan-out requires at least one recipient",
    )
  }
  if to_ids.length() == 1 {
    return Single(to_id=to_ids[0])
  }
  if user_explicitly_asked_fanout {
    ExplicitFanout(to_ids~)
  } else {
    MustAskUserFirst(
      to_ids~,
      reason="ask user first before notifying multiple assistants",
    )
  }
}

///|
/// CM-2141: execute fan-out only when plan allows; otherwise Err ask-first.
pub fn SendToAgentBus::fanout(
  self : SendToAgentBus,
  from_id~ : String,
  to_ids~ : Array[String],
  body~ : String,
  user_explicitly_asked_fanout~ : Bool,
) -> Result[Array[AgentMessage], String] {
  match plan_send_to_agent_fanout(to_ids, user_explicitly_asked_fanout~) {
    MustAskUserFirst(reason~, ..) => Err(reason)
    Single(to_id~) =>
      match self.send(from_id~, to_id~, body~, user_visible=false) {
        Err(e) => Err(e)
        Ok(m) => Ok([m])
      }
    ExplicitFanout(to_ids~) => {
      let out : Array[AgentMessage] = []
      for to_id in to_ids {
        // Fresh path edges per recipient to avoid false loop across fan-out.
        self.end_turn()
        match self.send(from_id~, to_id~, body~, user_visible=false) {
          Err(e) => return Err(e)
          Ok(m) => out.push(m)
        }
      }
      Ok(out)
    }
  }
}
