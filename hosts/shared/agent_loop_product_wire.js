"use strict";

const fs = require("fs");
const path = require("path");

/**
 * One Host FFI op for the kernel AgentLoop.
 * The kernel owns think → call → observe. This file does not call the model
 * again when a reply contains tool calls.
 */

function readBounded(ffi, rel) {
  if (!ffi || !ffi.REPO_ROOT) return "read: path not found";
  const root = path.resolve(String(ffi.REPO_ROOT));
  const target = path.resolve(root, String(rel || ""));
  if (target !== root && !target.startsWith(root + path.sep)) {
    return "read: path not found";
  }
  try {
    return fs.readFileSync(target, "utf8");
  } catch (_) {
    return "read: path not found";
  }
}

function readFixtures() {
  try {
    const parsed = JSON.parse(process.env.BITBOT_LOOP_READ_JSON || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function approvalMode() {
  const mode = String(process.env.BITBOT_LOOP_APPROVAL || "deny");
  if (mode === "allow" || mode === "cancel") return mode;
  return "deny";
}

function execProductTool(req, state) {
  const name = String((req && req.name) || "");
  const argsJson = String((req && req.arguments) || "");
  let args = {};
  try {
    args = JSON.parse(argsJson || "{}");
  } catch (_) {
    args = {};
  }
  if (name === "Shell" || name === "shell") {
    if (!state.shellAllowed) {
      return { output: "shell refused: no approval grant" };
    }
    state.shellAllowed = false;
    return { output: "[product-shell] " + String(args.command || "") };
  }
  if (name === "Read" || name === "read" || name === "fs_read") {
    const rel = String(args.path || "");
    const fixture = readFixtures()[rel];
    if (typeof fixture === "string") return { output: fixture };
    return { output: readBounded(state.ffi, rel) };
  }
  return { output: "exec refused: " + name };
}

function decideApproval(state) {
  const verdict = approvalMode();
  if (verdict === "allow") state.shellAllowed = true;
  return { verdict };
}

function createProductSession(ffi, llmOpts) {
  const state = { shellAllowed: false, delivered: "", ffi };
  return {
    state,
    async dispatch(req) {
      const op = String((req && req.op) || "");
      if (op === "llm_chat") {
        const res = await ffi.executeLlmChat("agent-loop", {
          ...(llmOpts || {}),
          messages: Array.isArray(req.messages) ? req.messages : [],
          agentLoopTools: true,
        });
        const calls = Array.isArray(res.tool_calls) ? res.tool_calls : [];
        return {
          content: res.ok
            ? String(res.stdout || "")
            : String(res.error || res.stderr || ""),
          calls: calls.map((c) => ({
            id: String((c && c.id) || ""),
            name: String((c && c.name) || ""),
            arguments: String((c && (c.arguments || c.arguments_json)) || ""),
          })),
        };
      }
      if (op === "exec_tool") return execProductTool(req, state);
      if (op === "request_approval") return decideApproval(state);
      if (op === "deliver") {
        state.delivered = String((req && req.text) || "");
        return { ok: true };
      }
      return {
        error: "unknown op",
        content: "",
        calls: [],
        output: "",
        verdict: "deny",
      };
    },
  };
}

function legacyGuardedRerunEnabled(env) {
  return String((env || process.env).BITBOT_LEGACY_GUARDED_RERUN || "") === "1";
}

/**
 * Project one kernel loop line into an AgentStep.
 * The kernel owns the loop. Callers may display this object; they must not
 * start another model or tool loop from it.
 */
function projectAgentStep(line) {
  const text = String(line || "").trim();
  if (text === "BITBOT_LOOP entry=AgentLoop::run") {
    return {
      kind: "entry",
      entry: "AgentLoop::run",
      agent_entry: "open_turn",
    };
  }
  const prefix = "BITBOT_LOOP op=";
  if (!text.startsWith(prefix)) return null;
  const op = text.slice(prefix.length).trim();
  if (
    op !== "llm_chat" &&
    op !== "exec_tool" &&
    op !== "request_approval" &&
    op !== "deliver"
  ) {
    return null;
  }
  return { kind: "op", op };
}

module.exports = {
  createProductSession,
  execProductTool,
  decideApproval,
  legacyGuardedRerunEnabled,
  projectAgentStep,
};
