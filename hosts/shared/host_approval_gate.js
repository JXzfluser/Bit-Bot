"use strict";

/**
 * One-shot approval grants for a single turn and a single action.
 * Tool arguments named approved are not a grant.
 */

function canonTool(name) {
  const n = String(name || "");
  if (n === "shell" || n === "Shell") return "Shell";
  return n;
}

function stripApproved(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "approved") continue;
    out[k] = v;
  }
  return out;
}

function parseArgs(args) {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args;
}

function canonicalAction(name, args) {
  const clean = stripApproved(parseArgs(args));
  const stable = {};
  for (const k of Object.keys(clean).sort()) stable[k] = clean[k];
  return canonTool(name) + ":" + JSON.stringify(stable);
}

function actionFromKind(kind, command) {
  const k = String(kind || "");
  if (k === "shell" || k === "Shell") {
    return canonicalAction("Shell", { command: String(command || "") });
  }
  return canonicalAction(k, { command: String(command || "") });
}

function createApprovalGate() {
  const grants = [];
  let seq = 0;
  return {
    record({ turnId, action, source }) {
      const row = {
        id: "grant-" + (++seq).toString(36),
        turnId: String(turnId || ""),
        action: String(action || ""),
        source: String(source || ""),
        used: false,
      };
      if (!row.turnId || !row.action) return null;
      if (row.source !== "ui" && row.source !== "cli" && row.source !== "saved_rule") {
        return null;
      }
      grants.push(row);
      return row;
    },
    peek(turnId, action) {
      const t = String(turnId || "");
      const a = String(action || "");
      return grants.find((g) => !g.used && g.turnId === t && g.action === a) || null;
    },
    consume(turnId, action) {
      const hit = this.peek(turnId, action);
      if (!hit) return null;
      hit.used = true;
      return hit;
    },
  };
}

module.exports = {
  canonTool,
  stripApproved,
  canonicalAction,
  actionFromKind,
  createApprovalGate,
};
