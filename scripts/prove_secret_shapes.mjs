#!/usr/bin/env node
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

/**
 * SS — secret shape contract gate.
 *
 * "What does a credential look like?" has to be answered the same way
 * everywhere that has to decide. It used to be answered four times, and the
 * copies drifted: the kernel's copy was NARROWER than the Host's, so
 * `API_KEY=…`, `api-key=…` and `xoxs-…` were caught by the Host but not by
 * the kernel. The kernel is the backstop that keeps plaintext out of the
 * transcript for CLI and API callers — which have no renderer at all — so
 * "the Host catches it" was not enough.
 *
 * This gate proves three things:
 *   SS1  the kernel's rule table and the Host's rule table are row-for-row
 *        identical;
 *   SS2  the two sides reach the SAME VERDICT for a corpus of credential
 *        shapes and ordinary text — checked by asking the real kernel
 *        binary (`--secret-probe`) and the real Host rule table;
 *   SS3  the corpus expectations themselves hold (credentials are caught,
 *        ordinary text is not).
 *
 * Usage:
 *   node scripts/prove_secret_shapes.mjs
 *   BITBOT_KERNEL_BIN=/path/to/desktop_turn node scripts/prove_secret_shapes.mjs
 *
 * Exit code 0 = the contract holds. Non-zero = it is broken.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CORE_TABLE = path.join(ROOT, "core", "secret_shapes.mbt");
const HOST_PROTOCOL = path.join(ROOT, "hosts", "desktop", "secret_protocol.js");

let failures = 0;
function ok(id, msg) {
  console.log("ok " + id + " — " + msg);
}
function bad(id, msg) {
  console.log("FAIL " + id + " — " + msg);
  failures += 1;
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

/** Rows are `id|kind|a|b|c|d`; extract the literal row list. */
function extractRows(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const rest = source.slice(start);
  const openMatch = rest.match(/\[\s*\n\s*"[^"]*\|/);
  if (!openMatch) return null;
  const open = rest.indexOf("[", openMatch.index);
  const close = rest.indexOf("]", open);
  if (close < 0) return null;
  const block = rest.slice(open, close);
  const rows = [];
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    if (m[1].indexOf("|") > 0) rows.push(m[1]);
  }
  return rows;
}

// The corpus. `secret: true` = must be treated as a credential.
const CORPUS = [
  // Real credential shapes.
  { secret: true, text: "ghp_abcdefghijklmnopqrstuvwxyz012345" },
  { secret: true, text: "gho_abcdefghijklmnopqrstuvwxyz012345" },
  { secret: true, text: "ghu_abcdefghijklmnopqrstuvwxyz012345" },
  { secret: true, text: "ghs_abcdefghijklmnopqrstuvwxyz012345" },
  { secret: true, text: "ghr_abcdefghijklmnopqrstuvwxyz012345" },
  { secret: true, text: "github_pat_abcdefghijklmnopqrstuvwxyz" },
  { secret: true, text: "sk-proj-abcdefghijklmnop" },
  { secret: true, text: "sk_live_abcdefghij" },
  { secret: true, text: "xoxa-abcdefghij" },
  { secret: true, text: "xoxb-abcdefghij" },
  { secret: true, text: "xoxo-abcdefghij" },
  { secret: true, text: "xoxp-abcdefghij" },
  { secret: true, text: "xoxs-abcdefghij" },
  { secret: true, text: "AKIAIOSFODNN7EXAMPLE" },
  { secret: true, text: "AIzaSyA1234567890abcdefghijklmnopqrstuv" },
  { secret: true, text: "api_key=abcdef123456" },
  { secret: true, text: "apikey=abcdef123456" },
  { secret: true, text: "api-key=abcdef123456" },
  { secret: true, text: "API_KEY=abcdef123456" },
  { secret: true, text: "Authorization: Bearer abcdef123456" },
  { secret: true, text: "authorization:bearer abcdef123456" },
  { secret: true, text: "cookie=abcdef123456" },
  { secret: true, text: "Cookie: abcdef123456" },
  { secret: true, text: "-----BEGIN RSA PRIVATE KEY-----" },
  { secret: true, text: "-----BEGIN PRIVATE KEY-----" },

  // Ordinary text — the false-positive guards. The old kernel rule flagged
  // EVERY string of 32+ characters without spaces (a bare UUID, a git SHA,
  // a base64 blob): a false-positive machine, not a safety feature.
  { secret: false, text: "task-2136" },
  { secret: false, text: "sk-" },
  { secret: false, text: "hello team" },
  { secret: false, text: "550e8400-e29b-41d4-a716-446655440000" },
  { secret: false, text: "please schedule a meeting tomorrow" },
  { secret: false, text: "the quick brown fox jumps over the lazy dog" },
  { secret: false, text: "https://example.com/some/path?query=1" },
  { secret: false, text: "aGVsbG8gd29ybGQgdGhpcyBpcyBiYXNlNjQ=" },
  { secret: false, text: "cookie recipe: chocolate chip" },
  { secret: false, text: "the api key is missing" },
];

// ---------------------------------------------------------------- SS1
const coreRows = extractRows(read(CORE_TABLE), "secret_shape_rows");
const hostRows = extractRows(read(HOST_PROTOCOL), "SECRET_SHAPE_ROWS");
if (!coreRows || coreRows.length === 0) {
  bad("SS1", "cannot read the kernel rule table from core/secret_shapes.mbt");
} else if (!hostRows || hostRows.length === 0) {
  bad("SS1", "cannot read the Host rule table from hosts/desktop/secret_protocol.js");
} else if (coreRows.length !== hostRows.length) {
  bad(
    "SS1",
    "rule tables have different lengths — kernel " +
      coreRows.length +
      ", Host " +
      hostRows.length,
  );
} else {
  const diff = [];
  for (let i = 0; i < coreRows.length; i++) {
    if (coreRows[i] !== hostRows[i]) {
      diff.push("[" + coreRows[i] + "] vs [" + hostRows[i] + "]");
    }
  }
  if (diff.length === 0) {
    ok("SS1", "kernel and Host rule tables are identical (" + coreRows.length + " rules)");
  } else {
    bad("SS1", "rule tables differ: " + diff.join("; "));
  }
}

// ---------------------------------------------------------------- SS3
// The Host side's own verdicts on the corpus.
let hostProtocol = null;
try {
  const mod = await import("file://" + HOST_PROTOCOL);
  hostProtocol = mod.default || mod;
} catch (err) {
  bad("SS3", "cannot load hosts/desktop/secret_protocol.js: " + String(err && err.message));
}

if (hostProtocol && typeof hostProtocol.looksLikeToken === "function") {
  const wrong = CORPUS.filter(
    (c) => hostProtocol.looksLikeToken(c.text) !== c.secret,
  );
  if (wrong.length === 0) {
    ok("SS3", "Host verdicts match the corpus (" + CORPUS.length + " cases)");
  } else {
    bad(
      "SS3",
      "Host verdicts wrong for: " +
        wrong.map((c) => JSON.stringify(c.text)).join(", "),
    );
  }
}

// ---------------------------------------------------------------- SS2
// The real kernel binary answers the same question. This is the check that
// matters: the kernel is the backstop for callers that have no renderer.
//
// The binary is BUILT here rather than picked up from the tree: a stale
// artifact would answer with last week's rules and the gate would pass on
// a lie. `BITBOT_KERNEL_BIN` skips the build when the caller already has
// the binary it wants to check.
function buildKernel() {
  const built = spawnSync("moon", ["build", "--target", "native"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 900000,
    env: Object.assign({}, process.env, {
      PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
    }),
  });
  if (built.status !== 0) {
    bad("SS2", "kernel build failed:\n" + String(built.stderr || "").slice(-800));
    return null;
  }
  for (const name of ["desktop_turn", "desktop_turn.exe"]) {
    const p = path.join(
      ROOT,
      "_build/native/debug/build/cmd/desktop_turn",
      name,
    );
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findKernel() {
  if (process.env.BITBOT_KERNEL_BIN) return process.env.BITBOT_KERNEL_BIN;
  return buildKernel();
}

function kernelVerdict(kernel, text) {
  const res = spawnSync(kernel, ["--secret-probe", text], {
    encoding: "utf8",
    timeout: 20000,
  });
  return String(res.stdout || "").trim();
}

const kernel = findKernel();
if (!kernel) {
  bad("SS2", "no kernel binary available to ask");
} else {
  const mismatches = [];
  for (const c of CORPUS) {
    const out = kernelVerdict(kernel, c.text);
    if ((out === "secret=true") !== c.secret) {
      mismatches.push(JSON.stringify(c.text) + " → " + out.slice(0, 60));
    }
  }
  if (mismatches.length === 0) {
    ok("SS2", "kernel verdicts match the corpus (" + CORPUS.length + " cases)");
  } else {
    bad(
      "SS2",
      "kernel verdicts wrong for " +
        mismatches.length +
        " case(s): " +
        mismatches.slice(0, 5).join(", "),
    );
  }

  // SS2b: the kernel and the Host must agree with EACH OTHER, case by case.
  if (hostProtocol && typeof hostProtocol.looksLikeToken === "function") {
    const disagree = [];
    for (const c of CORPUS) {
      const out = kernelVerdict(kernel, c.text);
      const k = out === "secret=true";
      const h = hostProtocol.looksLikeToken(c.text);
      if (k !== h) {
        disagree.push(
          JSON.stringify(c.text) + " (kernel=" + k + ", host=" + h + ")",
        );
      }
    }
    if (disagree.length === 0) {
      ok("SS2b", "kernel and Host agree on every corpus case");
    } else {
      bad(
        "SS2b",
        "kernel and Host disagree on " +
          disagree.length +
          " case(s): " +
          disagree.slice(0, 5).join(", "),
      );
    }
  }
}

if (failures > 0) {
  console.log("");
  console.log("secret shape contract: " + failures + " FAIL");
  process.exit(1);
}
console.log("");
console.log("secret shape contract: all green");
process.exit(0);
