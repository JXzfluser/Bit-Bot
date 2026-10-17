///|
/// Extra Grok-parity intent classification (routines/agents/MCP/Teams/device).
pub fn classify_parity_intent(trimmed : String, low : String) -> TurnIntent? {
  if low == "list routines" || low == "routines" || low == "show routines" {
    return Some(ListRoutines)
  }
  if low.has_prefix("create routine ") || low.has_prefix("schedule ") {
    let rest = if low.has_prefix("create routine ") {
      trimmed[15:].to_owned()
    } else {
      trimmed[9:].to_owned()
    }
    let id = match extract_kv(rest, "id") {
      Some(v) => v
      None => "routine-1"
    }
    let cron = match extract_kv(rest, "cron") {
      Some(v) => v
      None => "@daily"
    }
    let prompt = match extract_kv(rest, "prompt") {
      Some(v) => v
      None => rest
    }
    if prompt != "" {
      return Some(CreateRoutine(id~, cron~, prompt~))
    }
  }
  if low.has_prefix("spawn subagent ") ||
      low.has_prefix("subagent ") ||
      low.has_prefix("dispatch agent ") {
    let prompt = if low.has_prefix("spawn subagent ") {
      trimmed[15:].trim().to_owned()
    } else if low.has_prefix("dispatch agent ") {
      trimmed[15:].trim().to_owned()
    } else {
      trimmed[9:].trim().to_owned()
    }
    if prompt != "" {
      return Some(SpawnSubagent(prompt~))
    }
  }
  if low.has_prefix("mcp discover") || low.has_prefix("discover mcp") {
    let ns = if low.has_prefix("mcp discover ") {
      trimmed[13:].trim().to_owned()
    } else if low.has_prefix("discover mcp ") {
      trimmed[13:].trim().to_owned()
    } else {
      ""
    }
    return Some(McpDiscover(namespace_=ns))
  }
  if low.has_prefix("mcp call ") {
    let rest = trimmed[9:].trim().to_owned()
    // mcp call user-Gmail.search_threads {"q":"a"}
    match split_once(rest, " ") {
      Some((tool, args)) => {
        match split_once(tool, ".") {
          Some((ns, name)) =>
            return Some(
              McpCall(
                namespace_=ns,
                name~,
                args_json=args.trim().to_owned(),
              ),
            )
          None => ()
        }
      }
      None => ()
    }
  }
  if low.has_prefix("computer use ") || low.has_prefix("computeruse ") {
    let task = if low.has_prefix("computer use ") {
      trimmed[13:].trim().to_owned()
    } else {
      trimmed[12:].trim().to_owned()
    }
    if task != "" {
      return Some(ComputerUse(task~))
    }
  }
  if low.has_prefix("teams send ") || low.has_prefix("send teams ") {
    let rest = if low.has_prefix("teams send ") {
      trimmed[11:].to_owned()
    } else {
      trimmed[11:].to_owned()
    }
    match split_once(rest, " :: ") {
      Some((scope, body)) => {
        let s = scope.trim().to_owned()
        let b = body.trim().to_owned()
        if s != "" && b != "" {
          return Some(TeamsSend(scope=s, body=b))
        }
      }
      None => ()
    }
  }
  if low == "device tools" ||
      low == "list device tools" ||
      low == "phone tools" {
    return Some(DeviceTools)
  }
  if low.has_prefix("device tool ") || low.has_prefix("invoke device ") {
    let tool = if low.has_prefix("device tool ") {
      trimmed[12:].trim().to_owned()
    } else {
      trimmed[14:].trim().to_owned()
    }
    if tool != "" {
      return Some(DeviceToolInvoke(tool~))
    }
  }
  if low.has_prefix("load skill ") || low.has_prefix("use skill ") {
    let task = if low.has_prefix("load skill ") {
      trimmed[11:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if task != "" {
      return Some(LoadSkill(task~))
    }
  }
  if low.has_prefix("voice start ") || low.has_prefix("start voice ") {
    let id = if low.has_prefix("voice start ") {
      trimmed[12:].trim().to_owned()
    } else {
      trimmed[12:].trim().to_owned()
    }
    if id != "" {
      return Some(VoiceStart(call_id=id))
    }
  }
  if low.has_prefix("voice relay ") {
    let rest = trimmed[12:].trim().to_owned()
    match split_once(rest, " :: ") {
      Some((cid, text)) => {
        let c = cid.trim().to_owned()
        let t = text.trim().to_owned()
        if c != "" && t != "" {
          return Some(VoiceRelay(call_id=c, text=t))
        }
      }
      None => ()
    }
  }
  if low.has_prefix("voice end ") || low.has_prefix("end voice ") {
    let id = if low.has_prefix("voice end ") {
      trimmed[10:].trim().to_owned()
    } else {
      trimmed[10:].trim().to_owned()
    }
    if id != "" {
      return Some(VoiceEnd(call_id=id))
    }
  }
  if low.has_prefix("create teammate ") || low.has_prefix("create agent ") {
    let rest = if low.has_prefix("create teammate ") {
      trimmed[16:].to_owned()
    } else {
      trimmed[13:].to_owned()
    }
    let id = match extract_kv(rest, "id") {
      Some(v) => v
      None => "asst-1"
    }
    let name = match extract_kv(rest, "name") {
      Some(v) => v
      None => id
    }
    let role = match extract_kv(rest, "role") {
      Some(v) => v
      None => "executor"
    }
    return Some(CreateTeammate(id~, name~, role~))
  }
  if low.has_prefix("room ") || @teammates.has_room_cue(trimmed) {
    if @teammates.has_room_cue(trimmed) {
      match @teammates.open_room_turn_from_cue(
        cue_and_body=trimmed,
        speaker_id="user",
      ) {
        Ok(rt) => return Some(RoomTurn(room=rt.room_name, body=rt.body))
        Err(_) => ()
      }
    }
    if low.has_prefix("room ") {
      let rest = trimmed[5:].to_owned()
      match split_once(rest, " :: ") {
        Some((room, body)) => {
          let r = room.trim().to_owned()
          let b = body.trim().to_owned()
          if r != "" && b != "" {
            return Some(RoomTurn(room=r, body=b))
          }
        }
        None => ()
      }
    }
  }
  if low.has_prefix("send to agent ") || low.has_prefix("message agent ") {
    let rest = if low.has_prefix("send to agent ") {
      trimmed[14:].to_owned()
    } else {
      trimmed[14:].to_owned()
    }
    match split_once(rest, " :: ") {
      Some((to_id, body)) => {
        let t = to_id.trim().to_owned()
        let b = body.trim().to_owned()
        if t != "" && b != "" {
          return Some(SendToAgent(to_id=t, body=b))
        }
      }
      None => ()
    }
  }
  None
}

///|
/// ApprovalGate for consequential product effects (Grok-like).
/// Returns Some(result) when the turn should stop at approval/deny.
pub fn gate_consequential(
  user_text : String,
  turn_id : String,
  intent : TurnIntent,
  ctx : DesktopTurnContext,
  class_ : @security.ApprovalClass,
  summary : String,
  irreversible~ : Bool = false,
) -> DesktopTurnResult? {
  if ctx.approved {
    return None
  }
  let gate = @security.ApprovalGate::default()
  let req : @security.ApprovalRequest = {
    id: turn_id + "-gate",
    class_,
    summary,
    payload_json: "{\"text\":\"" + escape_json_string(user_text) + "\"}",
    irreversible,
  }
  match gate.review(req) {
    @security.Allow => None
    @security.Deny(reason~) =>
      Some(fail_turn(user_text, turn_id, intent, reason, ctx, assistant=reason))
    @security.NeedUser(reason~) => {
      let effect : DesktopEffect = {
        kind: "approval_card",
        command: class_.label() + " :: " + summary + " :: " + reason,
        needs_host_ffi: true,
      }
      Some(
        deliver_ok(
          user_text,
          turn_id,
          "Approval required (" +
          class_.label() +
          "): " +
          reason +
          ". Re-run with Host --approved after user confirms.",
          intent,
          ctx~,
          effects=[effect],
          needs_host_ffi=true,
        ),
      )
    }
    @security.Escalate => {
      let effect : DesktopEffect = {
        kind: "approval_card",
        command: class_.label() + " :: escalate :: " + summary,
        needs_host_ffi: true,
      }
      Some(
        deliver_ok(
          user_text,
          turn_id,
          "Escalated for approval: " + summary,
          intent,
          ctx~,
          effects=[effect],
          needs_host_ffi=true,
        ),
      )
    }
  }
}
