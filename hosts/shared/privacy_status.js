"use strict";

/**
 * GP-106/107 — Privacy Mode (official Grok spec §8.5).
 *
 * Grok's Privacy Mode is enforced **server-side by the account provider**; the
 * desktop app can only report what the account says, and must not pretend to
 * toggle it locally. There are exactly three honest outcomes:
 *
 *   verified    a real account/provider signal says "no training"
 *   unavailable no signal at all (fresh install, no account, no env)
 *   legacy      a legacy privacy mode exists but this product cannot use it
 *
 * "Cannot verify" resolves to `training_use: disabled_by_default`, never to a
 * claimed verified state — the spec's "无法验证时默认不训练".
 */

const TRAINING_DISABLED_BY_DEFAULT = "disabled_by_default";

/**
 * @param {{env?: object, account?: object}} ctx
 *   env     process.env (BITBOT_PRIVACY_MODE may carry an account-issued value)
 *   account local profile object from the account panel (`privacy_mode` field)
 */
function computePrivacyStatus(ctx = {}) {
  const env = ctx.env || {};
  const account = ctx.account || {};

  // Only an account-issued claim counts as "verified". An env var alone is a
  // local configuration file, not proof the provider enforced anything.
  const accountClaim = String(account.privacy_mode || "").trim().toLowerCase();
  const envClaim = String(env.BITBOT_PRIVACY_MODE || "").trim().toLowerCase();
  const verified = Boolean(account.privacy_verified === true) && accountClaim === "on";

  const legacy = accountClaim === "legacy" || envClaim === "legacy";

  const mode = verified ? "on" : legacy ? "legacy" : "unavailable";
  return {
    ok: true,
    mode,
    // Where the answer came from — the UI shows this verbatim.
    source: verified ? "account" : legacy ? "account:legacy" : envClaim ? "env" : "none",
    // §8.5: the status is managed in account settings, never in this app.
    managed_by: "account",
    local_toggle_supported: false,
    training_use: verified ? "disabled_verified" : TRAINING_DISABLED_BY_DEFAULT,
    training_disabled_verified: verified,
    legacy_privacy_mode: legacy ? "unsupported" : "not_configured",
    legacy_reason: legacy
      ? "Legacy Privacy Mode requires cloud data storage and cannot be used by this client."
      : "",
    // The honest headline the Settings row renders.
    label: verified
      ? "Privacy Mode: on (account-verified)"
      : legacy
        ? "Privacy Mode: legacy (unsupported)"
        : "Privacy Mode: unavailable · managed by account",
    pretend_enabled: false,
    note: verified
      ? "Account reports Privacy Mode on; training use disabled."
      : "No verifiable account signal. Training use stays disabled by default; the switch lives in account settings.",
  };
}

module.exports = { computePrivacyStatus, TRAINING_DISABLED_BY_DEFAULT };
