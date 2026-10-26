"use strict";

/**
 * Tool policy — the Host side of K-2 / C-3.
 *
 * The Host OWNS the policy; the kernel ENFORTS it (ADR 0011's sibling rule:
 * a check that only lives in the Host can be bypassed by any other caller).
 *
 * The Host knows things the kernel cannot:
 *   - which DEVICE the turn came from (desktop / mobile / remote inbound)
 *   - the user's own settings
 *   - the auto-review rules
 *
 * The kernel knows things the Host cannot:
 *   - the actual tool arguments (so it can check the filesystem scope)
 *   - that it is the one place a tool really runs
 *
 * So the Host builds a policy object and hands it over once per turn; the
 * kernel decides with it.
 *
 * Device trust:
 *   "trusted"  — the desktop, the CLI, the user's own box
 *   "limited"  — a mobile client or a remote inbound turn. Fewer tools run
 *                without asking, because the person asking is not sitting at
 *                the machine.
 */

const READ_ONLY_SAFE_TOOLS = ["Read", "fs_read", "read", "web_search", "describe_schedule"];

function splitList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function toolDenylist() {
  return splitList(process.env.BITBOT_TOOL_DENY || "");
}

function toolApprovalList() {
  return splitList(process.env.BITBOT_TOOL_APPROVAL || "");
}

function toolPathRoots() {
  return splitList(process.env.BITBOT_TOOL_PATH_ROOTS || "");
}

/**
 * @param {object} opts
 * @param {string} opts.deviceTrust  "trusted" | "limited"
 * @param {string} opts.subject      the bot / room the turn belongs to
 */
function buildToolPolicy(opts) {
  const o = opts || {};
  const trust = o.deviceTrust === "limited" ? "limited" : "trusted";
  const limited = [];
  if (trust === "limited") {
    // A limited device may still use the read-only tools freely; anything
    // that reaches outward or changes state has to be approved by the person
    // who IS at the machine.
    limited.push(
      "Shell",
      "shell",
      "send_mail",
      "web_fetch",
      "create_teammate",
      "create_routine",
      "room_turn",
      "handoff_task",
      "send_to_agent",
    );
  }
  return {
    subject: String(o.subject || ""),
    device_trust: trust,
    deny_tools: toolDenylist(),
    need_approval: toolApprovalList(),
    limited_needs_approval: limited,
    path_roots: toolPathRoots(),
  };
}

module.exports = {
  READ_ONLY_SAFE_TOOLS,
  buildToolPolicy,
  splitList,
};
