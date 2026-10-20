"use strict";

/*
 * GP-94 — single implementation of "open this link in the system browser".
 *
 * main.js wires this to the real shell.openExternal; scripts/prove_gp93_links.js
 * wires it to a spy. Same validation, same audit record, same refusal shape —
 * so a passing probe is evidence about the shipped handler, not a copy of it.
 *
 * Audit file: data/desktop/links.jsonl (gitignored). Every click is recorded,
 * including refusals, because "检查目标" (§5.6) is only honest if the attempt
 * that was blocked leaves a trace.
 */

const fs = require("fs");
const path = require("path");
const { parseExternalUrl } = require("./link_discipline");

function createLinkOpen(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const openExternal =
    typeof opts.openExternal === "function" ? opts.openExternal : async () => ({ ok: false, error: "no openExternal wired" });
  const auditPath = opts.auditPath
    ? path.resolve(opts.auditPath)
    : path.join(repoRoot, "data", "desktop", "links.jsonl");
  const now = opts.now || (() => new Date().toISOString());

  function record(row) {
    try {
      fs.mkdirSync(path.dirname(auditPath), { recursive: true });
      fs.appendFileSync(auditPath, JSON.stringify(row) + "\n");
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * open(rawUrl, meta) -> { ok, url?, scheme, hostname, decision, opened, error?, audit }
   * decision: "open_external" | "refused"
   */
  async function open(rawUrl, meta) {
    const m = meta || {};
    const parsed = parseExternalUrl(rawUrl);
    const base = {
      at: now(),
      href: String(rawUrl == null ? "" : rawUrl).slice(0, 512),
      scheme: (parsed.ok ? parsed.scheme : String(parsed.scheme || (String(rawUrl || "").split(":")[0] || "")).replace(/:$/, "")) || "",
      hostname: parsed.ok ? parsed.hostname : "",
      decision: parsed.ok ? "open_external" : "refused",
      source: String(m.source || "renderer-link"),
      session_id: String(m.sessionId || ""),
    };
    if (!parsed.ok) {
      const row = Object.assign({}, base, { ok: false, opened: false, error: parsed.error });
      row.audit = record(row);
      return Object.assign({ opened: false }, row);
    }
    let result;
    try {
      result = await openExternal(parsed.url);
    } catch (e) {
      result = { ok: false, error: String((e && e.message) || e) };
    }
    const row = Object.assign({}, base, {
      ok: Boolean(result && result.ok),
      opened: Boolean(result && result.ok),
      url: parsed.url,
      error: result && result.ok ? "" : String((result && result.error) || "openExternal failed"),
    });
    row.audit = record(row);
    return Object.assign({ url: parsed.url, scheme: parsed.scheme, hostname: parsed.hostname, decision: "open_external" }, row);
  }

  return { open, auditPath, record };
}

module.exports = { createLinkOpen };
