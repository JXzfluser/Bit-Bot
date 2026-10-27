"use strict";

/**
 * Which turn are we in?
 *
 * Since K-1/K-3 (ADR 0011) the agent context crosses the process boundary,
 * so a provider payload now carries the EARLIER turns' messages too. A gate
 * that identifies its scene by scanning the whole payload would answer every
 * scene with the OLDEST one — and then assert the wrong thing.
 *
 * So the rules are:
 *   - the SCENE marker comes from the LAST user message  (this turn's ask)
 *   - "did the tool already run?" comes from the messages AFTER it
 *     (this turn's tool results)
 *
 * History is evidence, not instruction.
 */

function lastUserText(body) {
  const msgs = Array.isArray(body && body.messages) ? body.messages : [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m && String(m.role || "") === "user") return String(m.content || "");
  }
  return "";
}

function turnTail(body) {
  const msgs = Array.isArray(body && body.messages) ? body.messages : [];
  let idx = -1;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m && String(m.role || "") === "user") {
      idx = i;
      break;
    }
  }
  if (idx < 0) return "";
  return JSON.stringify(msgs.slice(idx + 1));
}

function currentTurn(body) {
  return { last: lastUserText(body), tail: turnTail(body) };
}

module.exports = { lastUserText, turnTail, currentTurn };
