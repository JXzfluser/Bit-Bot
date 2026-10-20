/*
 * GP-103/104/105 — Untrusted Content (official Grok spec §8.4).
 *
 * External content (web pages, plugin results, command output) must reach the
 * reasoning surface *marked* as data, never as instruction. The kernel already
 * owns the fence grammar (`security/parse.mbt`: `<cursor_untrusted_data_1337
 * source="…">body</cursor_untrusted_data_1337>`), and `security/effect_planner`
 * refuses to emit ExternalSend from a Fenced slice. This file is the Host/UI
 * half of the same contract, so there is exactly one wrapping/dispatch rule:
 *
 *   - wrap(source, body)   Host-side: fence an external result before it is
 *                          absorbed by the kernel (idempotent, escapes an
 *                          attacker-supplied close tag so the fence cannot be
 *                          broken out of).
 *   - parse(text)          renderer-side: split delivered text into
 *                          trusted / fenced slices for the `untrusted` badge.
 *   - stripFences(text)    renderer-side: display text + the source list.
 *
 * Node (main process / probes) and the sandboxed renderer both load this file
 * (`module.exports` + `window.__bitbotUntrusted`), so the marker string can
 * never drift between the two halves.
 */
(function () {
  "use strict";

  var MARKER = "cursor_untrusted_data";
  var OPEN = "<" + MARKER + "_1337";
  var CLOSE = "</" + MARKER + "_1337>";

  /* Effect kinds whose payload originates outside the user/Host (GP-103). */
  var EXTERNAL_KINDS = {
    webfetch: true,
    mcp_call: true,
    mcp_discover: true,
    shell: true,
    computer_use: true,
    browser_open: true,
    web_search: true,
    read_mail_thread: true,
    search_mail: true,
    x_search: true,
    watch_video: true,
  };

  function isExternalKind(kind) {
    return !!EXTERNAL_KINDS[String(kind || "")];
  }

  function containsFence(text) {
    return String(text == null ? "" : text).indexOf(OPEN) >= 0;
  }

  /* An attacker-controlled body may itself contain our close tag; rewrite any
   * inner occurrence so the fence cannot be terminated early (fence escape). */
  function neutralize(body) {
    return String(body == null ? "" : body)
      .split(CLOSE)
      .join("<\\/" + MARKER + "_1337>")
      .split(OPEN)
      .join("<\\" + MARKER + "_1337");
  }

  /**
   * wrap(source, body) -> fenced text
   * Already-fenced input is returned untouched (one fence, never nested).
   */
  function wrap(source, body) {
    var s = String(source == null ? "" : source).replace(/["\r\n]/g, "");
    var b = String(body == null ? "" : body);
    if (containsFence(b)) return b;
    return OPEN + ' source="' + (s || "external") + '">' + neutralize(b) + CLOSE;
  }

  /* Split into [{kind:"trusted"|"fenced", source, text}] using the kernel's
   * grammar: open tag, attributes up to '>', body, close tag. */
  function parse(text) {
    var raw = String(text == null ? "" : text);
    var out = [];
    var i = 0;
    while (i < raw.length) {
      var at = raw.indexOf(OPEN, i);
      if (at < 0) {
        if (i < raw.length) out.push({ kind: "trusted", source: "", text: raw.slice(i) });
        break;
      }
      if (at > i) out.push({ kind: "trusted", source: "", text: raw.slice(i, at) });
      var tagEnd = raw.indexOf(">", at);
      var closeAt = raw.indexOf(CLOSE, at);
      if (tagEnd < 0 || closeAt < 0 || closeAt < tagEnd) {
        // Unterminated fence: treat the rest as data, never as instructions.
        out.push({ kind: "fenced", source: "unknown", text: raw.slice(at) });
        break;
      }
      var head = raw.slice(at, tagEnd);
      var m = /source\s*=\s*"([^"]*)"/.exec(head);
      out.push({
        kind: "fenced",
        source: (m && m[1]) || "external",
        text: raw.slice(tagEnd + 1, closeAt),
      });
      i = closeAt + CLOSE.length;
    }
    return out;
  }

  /** Display text (fence tags removed) + the ordered, unique source list. */
  function stripFences(text) {
    var slices = parse(text);
    var sources = [];
    var plain = [];
    for (var k = 0; k < slices.length; k++) {
      var sl = slices[k];
      if (sl.kind === "fenced") {
        if (sources.indexOf(sl.source) < 0) sources.push(sl.source);
        plain.push(sl.text);
      } else {
        plain.push(sl.text);
      }
    }
    return { text: plain.join(""), sources: sources, fenced: sources.length > 0 };
  }

  /** True when the text carries at least one fenced slice (GP-105 badge). */
  function hasUntrusted(text) {
    return parse(text).some(function (s) {
      return s.kind === "fenced";
    });
  }

  var api = {
    MARKER: MARKER,
    OPEN: OPEN,
    CLOSE: CLOSE,
    EXTERNAL_KINDS: EXTERNAL_KINDS,
    isExternalKind: isExternalKind,
    containsFence: containsFence,
    hasUntrusted: hasUntrusted,
    wrap: wrap,
    parse: parse,
    stripFences: stripFences,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.__bitbotUntrusted = api;
})();
