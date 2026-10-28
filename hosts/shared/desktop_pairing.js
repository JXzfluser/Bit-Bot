"use strict";

/**
 * desktop_pairing.js — 6-digit pairing code lifecycle (pairing-v1 spec).
 *
 * Security contract (from docs/design/desktop-target/pairing-v1.md §安全口径):
 *   1. 6-digit numeric, crypto.randomInt (never Math.random)
 *   2. Default TTL 5 minutes
 *   3. One-shot: redeemed once → immediately void
 *   4. Max 5 attempts per code (brute-force cap)
 *   5. Constant-time compare (crypto.timingSafeEqual)
 *   6. Failure reason unified: "invalid_code" (no distinction between missing/expired)
 *
 * This module is pure logic — no HTTP, no Electron. The HTTP routes in
 * cn_inbound_server.js call into it; the desktop IPC handler in main.js
 * calls issue/revoke directly.
 */

const crypto = require("crypto");

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;

/**
 * Create a fresh pairing code manager.
 * @param {{ now?: () => number, ttlMs?: number }} [opts]
 *   now — injectable clock for tests (returns epoch ms). Defaults to Date.now.
 *   ttlMs — override default TTL (tests use short values to avoid sleeping).
 */
function createPairingCodeManager(opts) {
  const nowFn = (opts && typeof opts.now === "function") ? opts.now : () => Date.now();
  const ttlMs = (opts && opts.ttlMs != null) ? Number(opts.ttlMs) : DEFAULT_TTL_MS;

  // Single active code at a time. null when no code is issued.
  let active = null; // { code: string, createdAt: number, expiresAt: number, attempts: number, redeemed: boolean }

  function generateCode() {
    // 6-digit numeric: 100000..999999 inclusive.
    return String(crypto.randomInt(100000, 1000000));
  }

  function issue() {
    const now = nowFn();
    const code = generateCode();
    active = {
      code,
      createdAt: now,
      expiresAt: now + ttlMs,
      attempts: 0,
      redeemed: false,
    };
    return status();
  }

  function revoke() {
    active = null;
    return { ok: true, code: "" };
  }

  function status() {
    if (!active) {
      return {
        ok: true,
        code: "",
        expires_in_ms: 0,
        attempts_left: 0,
        code_active: false,
      };
    }
    const now = nowFn();
    if (now >= active.expiresAt) {
      // Expired — treat as no active code.
      active = null;
      return {
        ok: true,
        code: "",
        expires_in_ms: 0,
        attempts_left: 0,
        code_active: false,
      };
    }
    return {
      ok: true,
      code: active.code,
      expires_in_ms: active.expiresAt - now,
      attempts_left: MAX_ATTEMPTS - active.attempts,
      code_active: true,
    };
  }

  /**
   * Attempt to redeem a code.
   * Returns { ok: true, ... } on success or { ok: false, error: "..." } on failure.
   * Error values per spec: "invalid_code", "attempts_exceeded", "bad_request".
   */
  function redeem(inputCode) {
    const now = nowFn();

    // No active code or expired → invalid_code (unified).
    if (!active || now >= active.expiresAt) {
      if (active && now >= active.expiresAt) active = null;
      return { ok: false, error: "invalid_code" };
    }

    // Already redeemed (one-shot).
    if (active.redeemed) {
      return { ok: false, error: "invalid_code" };
    }

    // Increment attempt counter.
    active.attempts += 1;

    // Constant-time comparison: pad both to same length.
    const expected = Buffer.from(active.code, "utf8");
    const provided = Buffer.from(String(inputCode || ""), "utf8");
    // timingSafeEqual requires same-length buffers; pad shorter with zeros.
    const maxLen = Math.max(expected.length, provided.length);
    const a = Buffer.alloc(maxLen);
    const b = Buffer.alloc(maxLen);
    expected.copy(a);
    provided.copy(b);
    const match = crypto.timingSafeEqual(a, b);

    if (!match) {
      // Check if attempts exhausted.
      if (active.attempts >= MAX_ATTEMPTS) {
        // Code is now void.
        active = null;
        return { ok: false, error: "attempts_exceeded" };
      }
      return { ok: false, error: "invalid_code" };
    }

    // Success — mark redeemed (one-shot).
    active.redeemed = true;
    const redeemedCode = active;
    active = null; // void immediately
    return { ok: true, redeemed_at: now };
  }

  return {
    issue,
    revoke,
    status,
    redeem,
    get active() { return active; },
  };
}

module.exports = {
  createPairingCodeManager,
  DEFAULT_TTL_MS,
  MAX_ATTEMPTS,
};
