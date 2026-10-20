/*
 * GP-93/94/95 — Markdown / 链接纪律 (official Grok spec §5.6).
 *
 * Single source of truth for two things the desktop shell must agree on:
 *   1. parseExternalUrl — which hrefs are allowed to leave the app.
 *   2. linkBodyToDom    — how a message body becomes DOM (markdown link →
 *                         clickable anchor, everything else literal text).
 *
 * Why a shared file instead of inline renderer code: the Electron renderer is
 * sandboxed (contextIsolation, no nodeIntegration) so the *policy* lives in the
 * main process, and a policy that is asserted by the smoke probe but never
 * actually used by the app is worthless. Both sides load this exact file.
 *
 * No innerHTML anywhere: text nodes are created with textContent, so a message
 * body can never inject markup. Only http(s) URLs become anchors.
 */
(function () {
  "use strict";

  var OPENABLE_SCHEMES = { "http:": true, "https:": true };

  /* ------------------------------------------------------------------
   * parseExternalUrl(raw) -> { ok, url, scheme, hostname, error }
   *
   * GP-94 acceptance: only http/https may reach shell.openExternal; the UI
   * renders a visible link for nothing else (a `javascript:` or `file:` href
   * is a navigation/injection risk, and `mailto:`/`data:` are not "the system
   * browser" targets). Rejects malformed URLs and missing hosts.
   * ------------------------------------------------------------------ */
  // The scheme + host of a URL are case-insensitive, but the *labels* shown to
  // a user are not — "HTTPS://EXAMPLE.COM" looks like a spoof, so a message
  // body is never rewritten by hand here. This helper only produces the value
  // that is handed to the URL parser / openExternal, and nothing is concatenated
  // into user-visible text.
  function normalizeUrlCase(raw) {
    var s = String(raw == null ? "" : raw);
    var m = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*)([\s\S]*)$/.exec(s);
    if (!m) return s;
    return m[1].toLowerCase() + m[2];
  }

  function parseExternalUrl(raw) {
    // WHATWG URL lowercases scheme+host itself, but we normalize first so the
    // "not openable" refusals below are compared against a canonical prefix —
    // an uppercase "HTTPS://" must not be treated as a different scheme.
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return { ok: false, error: "empty url" };
    // Whitespace/control characters inside a URL are a classic XSS carrier
    // ("java\tscript:alert(1)"); refuse rather than guess.
    if (/[\u0000-\u001f\s]/.test(s)) return { ok: false, error: "url contains whitespace or control chars" };
    var parsed;
    try {
      parsed = new URL(normalizeUrlCase(s));
    } catch (_e) {
      return { ok: false, error: "invalid url" };
    }
    if (!OPENABLE_SCHEMES[parsed.protocol]) {
      return { ok: false, error: "scheme_not_allowed", scheme: parsed.protocol };
    }
    if (!parsed.hostname) return { ok: false, error: "missing host" };
    return {
      ok: true,
      url: parsed.href,
      scheme: parsed.protocol.replace(/:$/, ""),
      hostname: parsed.hostname,
    };
  }

  /* ------------------------------------------------------------------
   * Markdown link scanner (renderer half of GP-93)
   *
   * The kernel guarantees CM-0111: every user-visible assistant body has its
   * URLs wrapped as [label](url) — turn_json.mbt runs linkify_bare_http_urls
   * before deliver, and deliver_text rejects bare http(s) outright. The
   * renderer therefore understands exactly two link shapes:
   *   [label](https://…)   -> anchor with the markdown label as text
   *   bare https://…       -> anchor with the URL as both text and href
   * Bare-URL support is defensive (a raw URL can still arrive from a user's
   * own message bubble), not a second source of truth.
   *
   * Returns { nodes, links, inert } — links carry { url, label, text } so a
   * caller can build a hover preview without re-parsing DOM.
   * ------------------------------------------------------------------ */
  // Mirrors url_terminator_at() in ui_protocol/markdown.mbt.
  function urlTerminator(c) {
    return (
      c === " " || c === "\n" || c === "\t" || c === "\r" || c === '"' ||
      c === "'" || c === "`" || c === ")" || c === "]" || c === "<" ||
      c === ">" || c === "," || c === ";"
    );
  }

  function readUrl(text, i) {
    // Scheme is case-insensitive per RFC 3986; normalize scheme+host only
    // (see normalizeUrlCase) so the URL we hand to the parser is canonical
    // without inventing a rewriting rule for message content.
    var scheme = null;
    var rest = text.slice(i);
    var lower = rest.toLowerCase();
    if (lower.indexOf("https://") === 0) scheme = "https://";
    else if (lower.indexOf("http://") === 0) scheme = "http://";
    if (!scheme) return null;
    var j = i + scheme.length;
    while (j < text.length && !urlTerminator(text.charAt(j))) j++;
    // Trim sentence punctuation the way the kernel does.
    var cut = j;
    while (cut > i + scheme.length && ".;:,".indexOf(text.charAt(cut - 1)) >= 0) cut--;
    if (cut === i + scheme.length) return null;
    // shown = what the user sees (verbatim from the message), url = what we open.
    return { end: cut, url: normalizeUrlCase(text.slice(i, cut)), shown: text.slice(i, cut) };
  }

  // Find "](" ... ")" for a label starting at text[i] === '['.
  function readMarkdownLink(text, i) {
    var close = text.indexOf("]", i + 1);
    if (close < 0 || text.charAt(close + 1) !== "(") return null;
    var open = close + 2;
    var end = text.indexOf(")", open);
    if (end < 0) return null;
    var label = text.slice(i + 1, close);
    var target = text.slice(open, end).trim();
    if (!label || !target) return null;
    return { end: end + 1, label: label, url: target };
  }

  function linkBodyToDom(text) {
    var body = String(text == null ? "" : text);
    var nodes = [];
    var links = [];
    var plain = "";
    var i = 0;

    function flush() {
      if (plain) {
        nodes.push({ node: { t: "text", text: plain } });
        plain = "";
      }
    }

    while (i < body.length) {
      var ch = body.charAt(i);
      if (ch === "[") {
        var md = readMarkdownLink(body, i);
        if (md) {
          var mdInfo = parseExternalUrl(md.url);
          if (mdInfo.ok) {
            flush();
            nodes.push({
              node: { t: "a", text: md.label, href: mdInfo.url },
            });
            links.push({ url: mdInfo.url, label: md.label, text: md.label, hostname: mdInfo.hostname, scheme: mdInfo.scheme });
            i = md.end;
            continue;
          }
          // Not openable: emit the raw markdown span as literal text so the
          // user still sees what the model wrote (never silently drop it).
          plain += body.slice(i, md.end);
          i = md.end;
          continue;
        }
      }
      var bare = readUrl(body, i);
      if (bare) {
        var bareInfo = parseExternalUrl(bare.url);
        if (bareInfo.ok) {
          flush();
          // Label stays exactly as written in the message; only the href is
          // the canonicalized URL we will actually open.
          nodes.push({ node: { t: "a", text: bare.shown, href: bareInfo.url } });
          links.push({ url: bareInfo.url, label: bare.shown, text: bare.shown, hostname: bareInfo.hostname, scheme: bareInfo.scheme });
          i = bare.end;
          continue;
        }
      }
      plain += ch;
      i++;
    }
    flush();
    return { nodes: nodes, links: links, inert: links.length === 0 };
  }

  /* ------------------------------------------------------------------
   * applyLinkBody(container, text, opts) — DOM side.
   *
   * container is a real element in the renderer (opts.createElement /
   * opts.createTextNode let the Node probe run the same code with a shim),
   * so the string→DOM translation asserted by the probe is the one shipped.
   * ------------------------------------------------------------------ */
  function applyLinkBody(container, text, opts) {
    var o = opts || {};
    var makeEl = o.createElement || null;
    var makeText = o.createTextNode || null;
    var parsed = linkBodyToDom(text);
    while (container.childNodes && container.childNodes.length) {
      container.removeChild(container.childNodes[0]);
    }
    for (var k = 0; k < parsed.nodes.length; k++) {
      var spec = parsed.nodes[k].node;
      if (spec.t === "text") {
        var tn = makeText ? makeText(spec.text) : { nodeName: "#text", textContent: spec.text };
        if (container.appendChild) container.appendChild(tn);
      } else {
        var a = makeEl ? makeEl("a") : { nodeName: "A", setAttribute: null };
        if (a.className !== undefined) a.className = "msg-link";
        if (a.setAttribute) {
          a.setAttribute("href", spec.href);
          a.setAttribute("rel", "noopener noreferrer");
          a.setAttribute("data-link", spec.href);
        }
        var labelNode = makeText ? makeText(spec.text) : { textContent: spec.text };
        if (a.appendChild) a.appendChild(labelNode);
        if (container.appendChild) container.appendChild(a);
      }
    }
    return parsed;
  }

  var api = {
    OPENABLE_SCHEMES: OPENABLE_SCHEMES,
    parseExternalUrl: parseExternalUrl,
    linkBodyToDom: linkBodyToDom,
    applyLinkBody: applyLinkBody,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.__bitbotLinks = api;
})();
