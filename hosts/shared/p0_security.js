"use strict";

/**
 * ADR 0008 — remote turn auth, loopback bind, shell sandbox, webhook
 * signatures, body limit, secret scrub. Host-only. Does not promote CM
 * rows from U to I.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const TURN_SKEW_MS = 5 * 60 * 1000;
const SHELL_TIMEOUT_MS = 30 * 1000;
const SHELL_MAX_BUFFER = 256 * 1024;
const SHELL_OUTPUT_CAP = 8000;

/**
 * Child env for /bin/bash -lc. Secrets never cross this list.
 * `LC_*` is allowed by prefix (LC_ALL and LC_CTYPE are the common names).
 * A name that matches the secret suffix is dropped even if it is listed.
 */
const SHELL_ENV_ALLOW = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "SHELL",
  "TERM",
  "BITBOT_TZ",
];

const SECRET_KEY_RE = /(?:_KEY|_TOKEN|_SECRET|_PASSWORD|_WEBHOOK)$/i;
const LC_ENV_RE = /^LC_[A-Z0-9_]+$/;
const MOBILE_LLM_KEY_RE = /^BITBOT_LLM_.+(?:_KEY|_TOKEN|_SECRET)$/i;

function isLoopbackHost(host) {
  const h = String(host || "").trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

/**
 * Default bind is loopback. LAN only when the operator names a host or
 * sets BITBOT_BIND_LAN=1. `env` is injectable so tests do not depend on
 * the process environment.
 */
function resolveInboundBind(opts = {}, env = process.env) {
  const e = env || {};
  const optHost = opts && opts.host != null ? String(opts.host).trim() : "";
  if (optHost) {
    const lan = !isLoopbackHost(optHost);
    return { host: optHost, lan, warn: lan, source: "opts" };
  }
  const fromEnv =
    e.BITBOT_CN_INBOUND_HOST != null ? String(e.BITBOT_CN_INBOUND_HOST).trim() : "";
  if (fromEnv) {
    const lan = !isLoopbackHost(fromEnv);
    return { host: fromEnv, lan, warn: lan, source: "env" };
  }
  if (String(e.BITBOT_BIND_LAN || "") === "1") {
    return { host: "0.0.0.0", lan: true, warn: true, source: "BITBOT_BIND_LAN" };
  }
  return { host: "127.0.0.1", lan: false, warn: false, source: "default" };
}

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash("sha256").update(String(a == null ? "" : a), "utf8").digest();
  const hb = crypto.createHash("sha256").update(String(b == null ? "" : b), "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

function secretValues(env = process.env) {
  const source = env && typeof env === "object" ? env : {};
  const values = [];
  for (const [k, v] of Object.entries(source)) {
    const val = v == null ? "" : String(v);
    if (val.length < 8) continue;
    if (k === "BITBOT_LLM_API_KEY" || SECRET_KEY_RE.test(k)) values.push(val);
  }
  values.sort((x, y) => y.length - x.length);
  return values;
}

function scrubSecrets(text, env = process.env) {
  let s = text == null ? "" : String(text);
  for (const v of secretValues(env)) {
    if (s.includes(v)) s = s.split(v).join("[redacted]");
  }
  return s;
}

function scrubDeep(value, env = process.env) {
  if (value == null) return value;
  if (typeof value === "string") return scrubSecrets(value, env);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, env));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v, env);
    return out;
  }
  return value;
}

function readBodyLimited(req, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const limit = Number(maxBytes) > 0 ? Number(maxBytes) : DEFAULT_MAX_BODY_BYTES;
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers && req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      const err = new Error("payload_too_large");
      err.status = 413;
      err.error = "payload_too_large";
      // Drain so the client can read the 413 that the caller writes.
      req.on("data", () => {});
      req.resume();
      reject(err);
      return;
    }
    const chunks = [];
    let total = 0;
    let settled = false;
    function finish(err, buf) {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(buf);
    }
    req.on("data", (c) => {
      if (settled) return;
      total += c.length;
      if (total > limit) {
        const err = new Error("payload_too_large");
        err.status = 413;
        err.error = "payload_too_large";
        finish(err);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => finish(null, Buffer.concat(chunks)));
    req.on("error", (e) => finish(e));
  });
}

function resolveTurnToken(repoRoot, env = process.env, opts = {}) {
  if (opts && opts.turnToken != null && String(opts.turnToken).trim()) {
    return { token: String(opts.turnToken).trim(), source: "opts" };
  }
  const fromEnv = String((env && env.BITBOT_TURN_TOKEN) || "").trim();
  if (fromEnv) return { token: fromEnv, source: "env" };
  const file = path.join(repoRoot, "data", "host", "turn-token");
  try {
    if (fs.existsSync(file)) {
      const t = fs.readFileSync(file, "utf8").trim();
      if (t) return { token: t, source: "file" };
    }
  } catch (_) {
    /* fall through and generate */
  }
  const token = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, token + "\n", { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch (_) {
      /* platform may ignore mode */
    }
    return { token, source: "generated", file };
  } catch (_) {
    return { token, source: "ephemeral" };
  }
}

function authorizationBearer(req) {
  const h = String((req.headers && req.headers.authorization) || "");
  const m = h.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : "";
}

function createNonceStore() {
  const seen = new Map();
  return {
    has(nonce) {
      const exp = seen.get(nonce);
      if (!exp) return false;
      if (Date.now() > exp) {
        seen.delete(nonce);
        return false;
      }
      return true;
    },
    add(nonce, ts) {
      seen.set(String(nonce), Number(ts) + TURN_SKEW_MS);
    },
  };
}

/**
 * /v1/turn. Missing Authorization and missing signature headers → unauthorized.
 * A present bearer that does not match, or a bad HMAC, is also a reject.
 * Effect payloads cannot satisfy this check.
 */
function verifyTurnAuth(req, rawBody, token, nonceStore) {
  const secret = String(token || "").trim();
  if (!secret) return { ok: false, error: "turn_token_unconfigured" };
  const bearer = authorizationBearer(req);
  if (req.headers && req.headers.authorization) {
    if (bearer && timingSafeEqualStr(bearer, secret)) return { ok: true, via: "bearer" };
    return { ok: false, error: "invalid_token" };
  }
  const headers = (req && req.headers) || {};
  const ts = String(headers["x-bitbot-timestamp"] || "");
  const nonce = String(headers["x-bitbot-nonce"] || "");
  const sig = String(headers["x-bitbot-signature"] || "");
  if (!ts && !nonce && !sig) return { ok: false, error: "unauthorized" };
  if (!ts || !nonce || !sig) return { ok: false, error: "missing_signature" };
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > TURN_SKEW_MS) {
    return { ok: false, error: "stale_timestamp" };
  }
  if (nonceStore && nonceStore.has(nonce)) return { ok: false, error: "nonce_reused" };
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(ts + "\n" + nonce + "\n")
    .update(body)
    .digest("hex");
  if (!timingSafeEqualStr(sig, expected)) return { ok: false, error: "bad_signature" };
  if (nonceStore) nonceStore.add(nonce, t);
  return { ok: true, via: "signed_nonce" };
}

/** DingTalk robot sign. Secret and both headers are required. */
function verifyDingTalkSignature(req, secret) {
  const token = String(secret || "").trim();
  if (!token) return { ok: false, error: "webhook_secret_unset" };
  const headers = (req && req.headers) || {};
  const ts = String(headers.timestamp || "");
  const sign = String(headers.sign || "");
  if (!ts || !sign) return { ok: false, error: "missing_signature" };
  const expected = crypto
    .createHmac("sha256", token)
    .update(ts + "\n" + token)
    .digest("base64");
  if (!timingSafeEqualStr(expected, sign)) return { ok: false, error: "bad_signature" };
  return { ok: true };
}

/** Feishu/Lark: sha256(timestamp + nonce + encryptKey + rawBody), hex. */
function verifyFeishuSignature(req, raw, secret) {
  const key = String(secret || "").trim();
  if (!key) return { ok: false, error: "webhook_secret_unset" };
  const headers = (req && req.headers) || {};
  const ts = String(headers["x-lark-request-timestamp"] || "");
  const nonce = String(headers["x-lark-request-nonce"] || "");
  const sig = String(headers["x-lark-signature"] || "");
  if (!ts || !nonce || !sig) return { ok: false, error: "missing_signature" };
  const body = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "");
  const expected = crypto.createHash("sha256").update(ts + nonce + key + body).digest("hex");
  if (!timingSafeEqualStr(expected, sig)) return { ok: false, error: "bad_signature" };
  return { ok: true };
}

/**
 * WeCom callback: sha1 of the sorted token/timestamp/nonce/echostr-or-body.
 * Unsigned requests are rejected even when the rest of the payload parses.
 */
function verifyWecomSignature(req, urlObj, token, raw) {
  const secret = String(token || "").trim();
  if (!secret) return { ok: false, error: "webhook_secret_unset" };
  const q = urlObj && urlObj.searchParams;
  const headers = (req && req.headers) || {};
  const sig = String((q && q.get("msg_signature")) || headers.msg_signature || "");
  const ts = String((q && q.get("timestamp")) || "");
  const nonce = String((q && q.get("nonce")) || "");
  const echo = String((q && q.get("echostr")) || "");
  if (!sig || !ts || !nonce) return { ok: false, error: "missing_signature" };
  const parts = [secret, ts, nonce];
  if (echo) parts.push(echo);
  else if (raw && raw.length) parts.push(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
  parts.sort();
  const expected = crypto.createHash("sha1").update(parts.join("")).digest("hex");
  if (!timingSafeEqualStr(expected, sig)) return { ok: false, error: "bad_signature" };
  return { ok: true };
}

function shellEnvKeyAllowed(name) {
  const k = String(name || "");
  if (!k || SECRET_KEY_RE.test(k) || k === "BITBOT_LLM_API_KEY") return false;
  if (SHELL_ENV_ALLOW.includes(k)) return true;
  return LC_ENV_RE.test(k);
}

function shellChildEnv(env = process.env) {
  const source = env || {};
  const out = {};
  const names = new Set([...SHELL_ENV_ALLOW, ...Object.keys(source)]);
  for (const k of names) {
    if (!shellEnvKeyAllowed(k)) continue;
    if (source[k] == null || String(source[k]) === "") continue;
    out[k] = String(source[k]);
  }
  if (!out.PATH) out.PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  return out;
}

/** Phone / mobile host must not carry the Desktop model credential. */
function isMobileLlmKey(name) {
  const k = String(name || "");
  return k === "BITBOT_LLM_API_KEY" || MOBILE_LLM_KEY_RE.test(k);
}

function dropMobileLlmKeys(env) {
  const target = env && typeof env === "object" ? env : {};
  for (const k of Object.keys(target)) {
    if (isMobileLlmKey(k)) delete target[k];
  }
  return target;
}

function mobileHostEnv(env = process.env) {
  const source = env || {};
  const out = {};
  for (const [k, v] of Object.entries(source)) {
    if (isMobileLlmKey(k)) continue;
    out[k] = v;
  }
  out.BITBOT_MOBILE_HOST = "1";
  return out;
}

function pathIsInside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

function cwdAllowed(cwd, allowRoots) {
  let lexical;
  try {
    lexical = path.resolve(String(cwd || ""));
  } catch (_) {
    return { ok: false, error: "bad_cwd" };
  }
  if (!lexical) return { ok: false, error: "bad_cwd" };
  const roots = (Array.isArray(allowRoots) ? allowRoots : [])
    .map((r) => {
      try {
        return path.resolve(String(r));
      } catch (_) {
        return "";
      }
    })
    .filter(Boolean);
  if (!roots.length) return { ok: false, error: "cwd_allowlist_empty" };
  let real = "";
  try {
    real = fs.realpathSync(lexical);
  } catch (_) {
    return { ok: false, error: "bad_cwd" };
  }
  // Compare canonical paths only. A lexical prefix check would reject a
  // legitimate cwd under a symlinked root (macOS /var -> /private/var) and
  // would also accept a symlink that escapes the root. realpath on both sides
  // handles both cases.
  const realRoots = roots.map((root) => {
    try {
      return fs.realpathSync(root);
    } catch (_) {
      return root;
    }
  });
  if (!realRoots.some((root) => pathIsInside(root, real))) {
    return { ok: false, error: "cwd_not_allowlisted" };
  }
  return { ok: true, cwd: real };
}

function runSandboxedShell(command, opts = {}) {
  const env = opts.env || process.env;
  const allowRoots = opts.allowRoots && opts.allowRoots.length ? opts.allowRoots : [];
  const cwdCheck = cwdAllowed(opts.cwd, allowRoots);
  if (!cwdCheck.ok) {
    return Promise.resolve({
      ok: false,
      error: cwdCheck.error,
      stdout: "",
      stderr: "",
      ran: false,
    });
  }
  const timeout = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : SHELL_TIMEOUT_MS;
  const maxBuffer = Number(opts.maxBuffer) > 0 ? Number(opts.maxBuffer) : SHELL_MAX_BUFFER;
  const childEnv = shellChildEnv(env);
  return new Promise((resolve) => {
    execFile(
      "/bin/bash",
      ["-lc", String(command || "")],
      { cwd: cwdCheck.cwd, env: childEnv, timeout, maxBuffer },
      (err, stdout, stderr) => {
        const out = scrubSecrets(stdout || (err && err.stdout) || "", env).slice(0, SHELL_OUTPUT_CAP);
        const errText = scrubSecrets(stderr || (err && err.stderr) || "", env).slice(0, 2000);
        if (err) {
          resolve({
            ok: false,
            ran: true,
            error: scrubSecrets(err.message || String(err), env),
            stdout: out,
            stderr: errText,
            code: err.code,
          });
          return;
        }
        resolve({ ok: true, ran: true, stdout: out, stderr: errText, error: "" });
      },
    );
  });
}

module.exports = {
  DEFAULT_MAX_BODY_BYTES,
  SHELL_TIMEOUT_MS,
  SHELL_MAX_BUFFER,
  SHELL_OUTPUT_CAP,
  SHELL_ENV_ALLOW,
  isLoopbackHost,
  resolveInboundBind,
  timingSafeEqualStr,
  scrubSecrets,
  scrubDeep,
  readBodyLimited,
  resolveTurnToken,
  authorizationBearer,
  createNonceStore,
  verifyTurnAuth,
  verifyDingTalkSignature,
  verifyFeishuSignature,
  verifyWecomSignature,
  shellEnvKeyAllowed,
  shellChildEnv,
  isMobileLlmKey,
  dropMobileLlmKeys,
  mobileHostEnv,
  cwdAllowed,
  runSandboxedShell,
};
