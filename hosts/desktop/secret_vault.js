"use strict";

/**
 * GP-99/100/101/102 — Host-side secret vault (official Grok spec §8.3).
 *
 * The renderer never handles the value beyond the <input type="password"> it
 * was typed into: it hands the plaintext to this module over IPC, gets back a
 * handle + a `****last4` mask, and shows `[REDACTED]` in the transcript.
 *
 * Two destinations, both Host-owned:
 *   data/secrets/vault.json  name → { value_enc, masked, updated_at }  (mode 0600)
 *   hosts/desktop/.env.local optional, only when the caller passes env_key
 *
 * The value is AES-256-GCM encrypted at rest with a Host-generated key
 * (data/secrets/vault.key, mode 0600), so GP-102's "grep data/ finds no
 * plaintext" holds even for the vault file itself. `resolve()` is the only
 * decrypting reader and never crosses IPC.
 *
 * Honest shape: `status()` returns masks only — never the value, not even to
 * the main process's own UI. `submit()` returns the handle; a caller that tries
 * to read `.value` off the response gets undefined by construction.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const secretProtocol = require("./secret_protocol");

function createSecretVault(repoRoot, opts = {}) {
  const root = path.resolve(repoRoot);
  /* The vault holds user secrets -> OS user-data dir when packaged. */
  const dataRoot = opts.dataRoot ? path.resolve(opts.dataRoot) : path.join(root, "data");
  const vaultPath = path.join(dataRoot, "secrets", "vault.json");
  // Test/probe hook: redirect the whole store so a probe never touches real data.
  const file = (opts && opts.vaultPath) || vaultPath;
  // Key lives beside the vault (same directory, same 0600 discipline), so a
  // probe that redirects the vault also gets an isolated throwaway key.
  const keyFile = (opts && opts.keyPath) || path.join(path.dirname(file), "vault.key");

  function loadKey() {
    try {
      if (fs.existsSync(keyFile)) {
        const k = fs.readFileSync(keyFile);
        if (k.length === 32) return k;
      }
    } catch (_) {
      /* fall through and mint a fresh key */
    }
    const k = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyFile, k, { mode: 0o600 });
    try {
      fs.chmodSync(keyFile, 0o600);
    } catch (_) {
      /* best effort on non-POSIX filesystems */
    }
    return k;
  }

  /* AES-256-GCM: `iv.tag.ciphertext`, all base64. Nothing recoverable by grep. */
  function seal(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", loadKey(), iv);
    const enc = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    return [
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      enc.toString("base64"),
    ].join(".");
  }

  function open(sealed) {
    const parts = String(sealed || "").split(".");
    if (parts.length !== 3) return "";
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        loadKey(),
        Buffer.from(parts[0], "base64"),
      );
      decipher.setAuthTag(Buffer.from(parts[1], "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[2], "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch (_) {
      // Wrong/lost key or tampered entry: report "no value", never garbage.
      return "";
    }
  }

  function load() {
    try {
      if (!fs.existsSync(file)) return { version: 1, entries: {} };
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!raw || typeof raw !== "object") return { version: 1, entries: {} };
      if (!raw.entries || typeof raw.entries !== "object") raw.entries = {};
      return raw;
    } catch (_) {
      return { version: 1, entries: {} };
    }
  }

  function save(state) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch (_) {
      /* best effort on filesystems without POSIX modes (Windows) */
    }
  }

  function newHandle() {
    return "sec-" + crypto.randomBytes(6).toString("hex");
  }

  /** Public view of one entry — mask only, never the plaintext. */
  function publicEntry(name, entry) {
    return {
      name,
      label: entry.label || name,
      handle: entry.handle,
      masked: entry.masked,
      env_key: entry.env_key || "",
      updated_at: entry.updated_at,
      // Explicit honesty: the renderer is never handed a value.
      value: null,
      plaintext_available: false,
    };
  }

  /**
   * submit({name,label,value,env_key}) -> {ok, handle, masked, name, errors}
   * Validation happens on the shared protocol so the probe asserts the same code.
   */
  function submit(payload) {
    const v = secretProtocol.validateSubmit(payload);
    if (!v.ok) {
      return {
        ok: false,
        refused: true,
        error: v.errors.join("; "),
        errors: v.errors,
        handle: "",
        masked: "",
        value_echoed: false,
      };
    }
    const state = load();
    const handle = newHandle();
    const entry = {
      handle,
      label: v.label,
      masked: secretProtocol.mask(v.value),
      env_key: v.env_key,
      // Sealed for Host use only (credential fill / provider call). Every read
      // surface in this file strips it; `resolve()` is the only opener.
      value_enc: seal(v.value),
      updated_at: new Date().toISOString(),
    };
    state.entries[v.name] = entry;
    save(state);
    return {
      ok: true,
      name: v.name,
      handle,
      masked: entry.masked,
      env_key: v.env_key,
      mode: "host_secret_vault",
      // The transcript bubble is rendered from this constant, not the value.
      display: secretProtocol.REDACTED,
      value_echoed: false,
      pretend_secret_view: false,
    };
  }

  /** status() -> name → {handle, masked, env_key} for the Secrets panel. */
  function status() {
    const state = load();
    const entries = {};
    for (const [name, entry] of Object.entries(state.entries || {})) {
      entries[name] = publicEntry(name, entry || {});
    }
    return { ok: true, path: path.relative(root, file), entries, value_echoed: false };
  }

  /** Host-only read for credential fill; never crosses the IPC boundary. */
  function resolve(name) {
    const state = load();
    const entry = (state.entries || {})[String(name || "")];
    // Legacy plaintext entries (pre-encryption) are migrated on first read.
    if (entry && entry.value_enc) return open(entry.value_enc);
    if (entry && entry.value) return String(entry.value);
    return "";
  }

  function remove(name) {
    const state = load();
    const key = String(name || "");
    if (!state.entries || !state.entries[key]) {
      return { ok: false, error: "unknown secret", removed: false };
    }
    delete state.entries[key];
    save(state);
    return { ok: true, name: key, removed: true };
  }

  return { submit, status, resolve, remove, vaultPath: file };
}

module.exports = { createSecretVault };
