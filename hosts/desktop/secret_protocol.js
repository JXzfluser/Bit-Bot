/*
 * GP-99/100/101/102 — secure secret input (official Grok spec §8.3).
 *
 * A secret typed into a *connection* is masked, stored Host-side, and never
 * added to the conversation. Three things must agree on what "secret-shaped"
 * means, and they must agree exactly:
 *
 *   - kernel  `ui_protocol/secret_request.mbt` → paste_token_into_chat,
 *     redact_secrets (the model-facing truth: `[REDACTED]`, never the value).
 *   - Host    main.js submits through .env.local (mode 0600) / the vault file.
 *   - renderer this file: decides "this paste is a credential, not a message"
 *     before any turn is created.
 *
 * Keeping the list in one UMD file (like link_discipline.js /
 * progress_protocol.js) means the renderer and the probe cannot drift; the
 * kernel list is asserted against this one in scripts/prove_m21_trust.js.
 */
(function () {
  "use strict";

  /* Kernel `looks_like_token` markers (ui_protocol/secret_request.mbt) plus the
   * shapes users actually paste (PATs, cloud keys, PEM blocks). The bare
   * prefixes are matched with a minimum body length on purpose: "task-2136"
   * must not look like an `sk-` key, but "sk-proj-…{16+}" must. */
  var TOKEN_RULES = [
    { id: "BEGIN PRIVATE KEY", re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
    { id: "api_key=", re: /\bapi[_-]?key\s*=\s*\S+/i },
    { id: "Authorization: Bearer", re: /authorization\s*:\s*bearer\s+\S+/i },
    { id: "cookie=", re: /\bcookie\s*[:=]\s*\S+/i },
    { id: "ghp_", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
    { id: "github_pat_", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
    { id: "sk-", re: /\bsk-[A-Za-z0-9_-]{16,}/ },
    { id: "sk_live_", re: /\bsk_live_[A-Za-z0-9]{10,}/ },
    { id: "xoxb-", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
    { id: "AKIA", re: /\bAKIA[0-9A-Z]{16}\b/ },
    { id: "AIza", re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  ];

  function looksLikeToken(text) {
    var s = String(text == null ? "" : text);
    if (!s) return false;
    for (var i = 0; i < TOKEN_RULES.length; i++) {
      if (TOKEN_RULES[i].re.test(s)) return true;
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
    REDACTED: REDACTED,
    ENV_KEY_RE: ENV_KEY_RE,
    looksLikeToken: looksLikeToken,
    mask: mask,
    validateSubmit: validateSubmit,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.__bitbotSecret = api;
})();
