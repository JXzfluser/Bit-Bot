"use strict";

/**
 * Host side of the agent-loop FFI (ADR 0002).
 *
 * The kernel owns think → call → observe. This module only:
 *   - parses one llm_chat payload (stream or not) without dropping tool_calls
 *   - exposes exec_tool / request_approval / deliver as single shots
 * It does not call the model again.
 */

const HOST_FFI_OPS = Object.freeze([
  "exec_tool",
  "request_approval",
  "deliver",
  "llm_chat",
]);

const implicitHostLoop = false;

function emptyCall() {
  return { id: "", name: "", arguments: "" };
}

function createAccumulator() {
  let content = "";
  const calls = [];
  return {
    addToolCallDelta(tc) {
      if (!tc || typeof tc !== "object") return;
      const idx = Number.isInteger(tc.index) ? tc.index : calls.length;
      while (calls.length <= idx) calls.push(emptyCall());
      const slot = calls[idx];
      if (typeof tc.id === "string" && tc.id) slot.id = tc.id;
      const fn = tc.function && typeof tc.function === "object" ? tc.function : {};
      if (typeof fn.name === "string" && fn.name) slot.name = fn.name;
      if (typeof fn.arguments === "string") slot.arguments += fn.arguments;
      if (typeof tc.name === "string" && tc.name && !slot.name) slot.name = tc.name;
      if (typeof tc.arguments === "string" && tc.arguments && !fn.arguments) {
        slot.arguments += tc.arguments;
      }
    },
    addDelta(delta) {
      if (!delta || typeof delta !== "object") return;
      if (typeof delta.content === "string") content += delta.content;
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) this.addToolCallDelta(tc);
      }
    },
    addMessage(message) {
      if (!message || typeof message !== "object") return;
      if (typeof message.content === "string") content += message.content;
      if (Array.isArray(message.tool_calls)) {
        message.tool_calls.forEach((tc, i) => {
          const idx = tc && Number.isInteger(tc.index) ? tc.index : i;
          this.addToolCallDelta(Object.assign({}, tc, { index: idx }));
        });
      }
    },
    snapshot() {
      return {
        content,
        tool_calls: calls
          .filter((c) => c.id || c.name || c.arguments)
          .map((c) => ({ id: c.id, name: c.name, arguments: c.arguments })),
      };
    },
  };
}

function consumeSseDataLine(data, acc) {
  if (!data || data === "[DONE]") return { usage: null };
  const obj = JSON.parse(data);
  const choice = obj && obj.choices && obj.choices[0];
  if (choice && choice.delta) acc.addDelta(choice.delta);
  if (choice && choice.message) acc.addMessage(choice.message);
  return { usage: (obj && obj.usage) || null };
}

function parseSseText(sseText) {
  const acc = createAccumulator();
  let usage = null;
  for (const line of String(sseText || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const meta = consumeSseDataLine(data, acc);
      if (meta && meta.usage && !usage) usage = meta.usage;
    } catch (_) {
      /* ignore a bad SSE line */
    }
  }
  return Object.assign(acc.snapshot(), { usage });
}

function parseCompletionJson(json) {
  const acc = createAccumulator();
  const choices = json && Array.isArray(json.choices) ? json.choices : [];
  if (choices.length) acc.addMessage(choices[0].message || {});
  return Object.assign(acc.snapshot(), {
    usage: (json && json.usage) || null,
    finish_reason: (choices[0] && choices[0].finish_reason) || null,
  });
}

function llmChatFromRaw(raw) {
  if (typeof raw === "string") return parseSseText(raw);
  return parseCompletionJson(raw);
}

function execTool(name, argsJson) {
  return {
    name: String(name || ""),
    arguments: String(argsJson || ""),
    ran: true,
  };
}

function requestApproval(name, argsJson, decider) {
  let forged = false;
  try {
    const parsed = JSON.parse(argsJson || "{}");
    forged = Boolean(parsed && (parsed.approved === true || parsed.approved === "true"));
  } catch (_) {
    forged = false;
  }
  const verdict = typeof decider === "function" ? decider(name, argsJson) : "deny";
  return {
    name: String(name || ""),
    verdict,
    forged_approved_ignored: true,
    forged,
  };
}

function deliver(text, sink) {
  const row = { text: String(text || "") };
  if (Array.isArray(sink)) sink.push(row);
  return row;
}

module.exports = {
  HOST_FFI_OPS,
  implicitHostLoop,
  createAccumulator,
  consumeSseDataLine,
  parseSseText,
  parseCompletionJson,
  llmChatFromRaw,
  execTool,
  requestApproval,
  deliver,
};
