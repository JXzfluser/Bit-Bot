///|
/// Draft host for AgentLoop::run. Same four calls as AgentLoopHost.
/// Shell and Read are recorded here; this file does not loop the model.
/// Not a second AgentLoop, and not an I-level HostAbi.

///|
pub(all) struct LoopHostAbi {
  replies : Array[LlmChatReply]
  mut reply_i : Int32
  repeat_last : Bool
  files : Map[String, String]
  execs : Array[String]
  approvals : Array[String]
  deliveries : Array[String]
  llm_seen : Array[String]
  deny_all : Bool
  cancel_on_approval : Bool
}

///|
pub fn LoopHostAbi::scripted(replies : Array[LlmChatReply]) -> LoopHostAbi {
  {
    replies,
    reply_i: 0,
    repeat_last: false,
    files: Map([]),
    execs: [],
    approvals: [],
    deliveries: [],
    llm_seen: [],
    deny_all: false,
    cancel_on_approval: false,
  }
}

///|
fn json_string_field(args : String, key : String) -> String? {
  let marker = "\"" + key + "\":\""
  if marker.length() > args.length() {
    return None
  }
  let last = args.length() - marker.length()
  let mut i = 0
  while i <= last {
    if args[i:i + marker.length()].to_owned() == marker {
      let start = i + marker.length()
      let mut end = start
      while end < args.length() {
        if args[end:end + 1].to_owned() == "\"" {
          break
        }
        end = end + 1
      }
      if end < args.length() && end >= start {
        return Some(args[start:end].to_owned())
      }
      return None
    }
    i = i + 1
  }
  None
}

///|
pub impl AgentLoopHost for LoopHostAbi with fn llm_chat(self, messages) {
  let mut blob = ""
  for m in messages {
    blob = blob + m.role + ":" + m.content + "\n"
  }
  self.llm_seen.push(blob)
  let i = self.reply_i
  self.reply_i = i + 1
  if self.replies.length() == 0 {
    { content: "", tool_calls: [], }
  } else if i < self.replies.length() {
    self.replies[i]
  } else if self.repeat_last {
    self.replies[self.replies.length() - 1]
  } else {
    { content: "", tool_calls: [], }
  }
}

///|
pub impl AgentLoopHost for LoopHostAbi with fn exec_tool(self, name, args) {
  self.execs.push(name + " " + args)
  if name == "Read" || name == "fs_read" || name == "read" {
    match json_string_field(args, "path") {
      None => "read: missing path"
      Some(path) =>
        match self.files.get(path) {
          None => "read: path not found: " + path
          Some(body) => body
        }
    }
  } else if name == "Shell" || name == "shell" {
    let shown = match json_string_field(args, "command") {
      Some(command) => command
      None => args
    }
    "[hostabi-shell] " + shown
  } else {
    "hostabi: no exec for " + name
  }
}

///|
/// Ignores `"approved"` inside args. The loop asks; this only answers.
pub impl AgentLoopHost for LoopHostAbi with fn request_approval(
  self,
  name,
  _args,
) {
  self.approvals.push(name)
  if self.cancel_on_approval {
    ApprovalCancel
  } else if self.deny_all {
    ApprovalDeny
  } else {
    ApprovalAllow
  }
}

///|
pub impl AgentLoopHost for LoopHostAbi with fn deliver(self, text) {
  self.deliveries.push(text)
}

///|
pub extend LoopHostAbi with AgentLoopHost::{
  llm_chat,
  exec_tool,
  request_approval,
  deliver,
}
