"use strict";

/**
 * Stream entry that used to fail closed (drop tool_calls, error
 * "tool_calls_fail_closed"). Real parsing lives in agent_loop_ffi.js.
 * This module only forwards one payload. It does not loop the model.
 */

const real = require("./agent_loop_ffi");

const FAIL_CLOSED_SENTINEL = "tool_calls_fail_closed";

function parseLlmStream(sseText) {
  const parsed = real.parseSseText(String(sseText || ""));
  const tool_calls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
  const content = typeof parsed.content === "string" ? parsed.content : "";
  const hasPayload = Boolean(content) || tool_calls.length > 0;
  return {
    ok: hasPayload,
    content,
    tool_calls,
    fail_closed: false,
    error: hasPayload ? null : "empty stream",
  };
}

module.exports = {
  FAIL_CLOSED_SENTINEL,
  failClosed: false,
  implicitHostLoop: false,
  createAccumulator: real.createAccumulator,
  consumeSseDataLine: real.consumeSseDataLine,
  parseSseText: real.parseSseText,
  parseCompletionJson: real.parseCompletionJson,
  parseLlmStream,
};
