/*
 * GP-99/100/101/102 — secure secret input (official Grok spec §8.3).
 *
 * A secret typed into a *connection* is masked, stored Host-side, and never
 * added to the conversation. "What does a credential look like?" has to be
 * answered the SAME way everywhere that has to decide:
 *
 *   - kernel  `core/secret_shapes.mbt` → paste_token_into_chat,
 *     redact_secrets (the model-facing truth: `[REDACTED]`, never the value).
 *   - Host    main.js submits through .env.local (mode 0600) / the vault file.
 *   - renderer this file: decides "this paste is a credential, not a message"
 *     before any turn is created.
 *
 * The rule table below IS the kernel's table — same rows, same order. It
 * used to be a separate regex list, and the two drifted: the kernel's copy
 * was narrower, so `API_KEY=…`, `api-key=…` and `xoxs-…` were caught here
 * but not by the kernel — and the kernel is the backstop that keeps
 * plaintext out of the transcript for CLI and API callers, which have no
 * renderer at all.
 *
 * `scripts/prove_secret_shapes.mjs` compares the two tables row by row and
 * fails CI when they differ.
 */
(function () {
  "use strict";

  /* Row format: id|kind|a|b|c|d — identical to `core/secret_shapes.mbt`.
   *   prefix : contains `a` followed by >= `b` token chars (A-Z a-z 0-9 _ -)
   *   assign : the word `a` (not glued to a preceding word char), optional
   *            spaces, then `b`, optional spaces, then >= `c` non-space chars
   *   bearer : like assign, but the word `c` must follow the separator
   *   phrase : contains both `a` and `b`
   * The minimum body length is deliberate: "task-2136" must not look like
   * an `sk-` key, but "sk-proj-…{16+}" must. */
  var SECRET_SHAPE_ROWS = [
    "ghp|prefix|ghp_|20|-|-",
    "gho|prefix|gho_|20|-|-",
    "ghu|prefix|ghu_|20|-|-",
    "ghs|prefix|ghs_|20|-|-",
    "ghr|prefix|ghr_|20|-|-",
    "github_pat|prefix|github_pat_|20|-|-",
    "sk|prefix|sk-|16|-|-",
    "sk_live|prefix|sk_live_|10|-|-",
    "xoxa|prefix|xoxa-|10|-|-",
    "xoxb|prefix|xoxb-|10|-|-",
    "xoxo|prefix|xoxo-|10|-|-",
    "xoxp|prefix|xoxp-|10|-|-",
    "xoxs|prefix|xoxs-|10|-|-",
    "akia|prefix|AKIA|16|-|-",
    "aiza|prefix|AIza|30|-|-",
    "api_key|assign|api_key|=|1|-",
    "apikey|assign|apikey|=|1|-",
    "api_dash_key|assign|api-key|=|1|-",
    "authorization|bearer|authorization|:|bearer|1",
    "cookie_eq|assign|cookie|=|1|-",
    "cookie_colon|assign|cookie|:|1|-",
    "pem|phrase|-----BEGIN |PRIVATE KEY-----|-|-",
  ];

  var TOKEN_CHARS = "[A-Za-z0-9_-]";
  var WORD_BOUNDARY_BEFORE = "(?<![A-Za-z0-9_])";
  var SPACES = "[ \\t\\r\\n]*";

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* Build the matcher for one row. The kernel implements the same three
   * kinds over the same rows, so both sides answer identically. */
  function ruleFor(row) {
    var parts = row.split("|");
    if (parts.length < 6) return null;
    var id = parts[0];
    var kind = parts[1];
    var a = parts[2];
    var b = parts[3];
    var c = parts[4];
    var d = parts[5];
    if (kind === "prefix") {
      return {
        id: id,
        re: new RegExp(escapeRe(a) + TOKEN_CHARS + "{" + b + ",}"),
      };
    }
    if (kind === "assign") {
      return {
        id: id,
        re: new RegExp(
          WORD_BOUNDARY_BEFORE +
            escapeRe(a) +
            SPACES +
            escapeRe(b) +
            SPACES +
            "\\S{" +
            c +
            "}",
          "i",
        ),
      };
    }
    if (kind === "bearer") {
      return {
        id: id,
        re: new RegExp(
          WORD_BOUNDARY_BEFORE +
            escapeRe(a) +
            SPACES +
            escapeRe(b) +
            SPACES +
            escapeRe(c) +
            SPACES +
            "\\S{" +
            d +
            "}",
          "i",
        ),
      };
    }
    if (kind === "phrase") {
      return { id: id, needs: [a, b] };
    }
    return null;
  }

  var TOKEN_RULES = [];
  for (var r = 0; r < SECRET_SHAPE_ROWS.length; r++) {
    var built = ruleFor(SECRET_SHAPE_ROWS[r]);
    if (built) TOKEN_RULES.push(built);
  }

  function looksLikeToken(text) {
    var s = String(text == null ? "" : text);
    if (!s) return false;
    for (var i = 0; i < TOKEN_RULES.length; i++) {
      var rule = TOKEN_RULES[i];
      if (rule.re) {
        if (rule.re.test(s)) return true;
      } else if (rule.needs) {
        if (s.indexOf(rule.needs[0]) >= 0 && s.indexOf(rule.needs[1]) >= 0) {
          return true;
        }
      }
    }
    return false;
  }

  /* Visible stand-in. The kernel uses the exact same string, so a bubble that
   * shows this is provably the redaction path, not a truncated value. */
  var REDACTED = "[REDACTED]";

  var ENV_KEY_RE = /^BITBOT_[A-Z0-9_]+$/;

  /* Masking used for display only: never derived from anything but length+tail. */
  function mask(value) {
    var s = String(value == null ? "" : value);
    if (!s) return "";
    if (s.length <= 4) return "****";
    return "****" + s.slice(-4);
  }

  /* Submit payload validation shared by the IPC handler and the probe. */
  function validateSubmit(payload) {
    var p = payload && typeof payload === "object" ? payload : {};
    var name = String(p.name || "").trim();
    var label = String(p.label || "").trim();
    var value = String(p.value == null ? "" : p.value);
    var envKey = String(p.env_key || "").trim();
    var errors = [];
    if (!name) errors.push("missing name");
    if (!value) errors.push("empty secret");
    if (envKey && !ENV_KEY_RE.test(envKey)) errors.push("env_key must look like BITBOT_*");
    return {
      ok: errors.length === 0,
      errors: errors,
      name: name,
      label: label || name,
      value: value,
      env_key: envKey,
    };
  }

  var api = {
    TOKEN_RULES: TOKEN_RULES,
    SECRET_SHAPE_ROWS: SECRET_SHAPE_ROWS,
    REDACTED: REDACTED,
    ENV_KEY_RE: ENV_KEY_RE,
    looksLikeToken: looksLikeToken,
    mask: mask,
    validateSubmit: validateSubmit,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.__bitbotSecret = api;
})();
