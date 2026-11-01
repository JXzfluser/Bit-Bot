#!/usr/bin/env node
"use strict";

/**
 * TN — tool name alias contract gate.
 *
 * The kernel canonicalizes tool names ONCE at the model boundary
 * (`core/tool_names.mbt` → `canonical_tool_id`). Everything downstream
 * matches on exact strings: the registry lookup, the policy approval list,
 * the deny list, the Host's router.
 *
 * That makes the alias table a LOAD-BEARING contract, not a convenience.
 * When the kernel's copy and the Host's copy drifted apart, the observable
 * failures were:
 *   - `createRoom` was unknown to the kernel copy → a registered tool
 *     became "unknown tool" and the call never ran;
 *   - the policy check ran against the RAW model name, so `sendMail`
 *     missed the approval rule written for `send_mail` — a tool could skip
 *     its approval just by being spelled differently.
 *
 * This gate makes that class of drift impossible to merge:
 *   1. the kernel table and the Host table must be row-for-row identical;
 *   2. every tool the kernel registers must appear in the table as a
 *      canonical id (a new tool that nobody can spell is a tool nobody
 *      can call).
 *
 * Usage:
 *   node scripts/prove_tool_names.mjs
 *
 * Exit code 0 = the contract holds. Non-zero = the contract is broken.
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CORE_TABLE = path.join(ROOT, "core", "tool_names.mbt");
const HOST_WIRE = path.join(ROOT, "hosts", "shared", "agent_loop_product_wire.js");
const PRODUCT_TOOLS = path.join(ROOT, "cmd", "desktop_turn", "agent_loop_product_tools.mbt");

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

/**
 * Pull the literal rows out of a `tool_alias_rows()` / `TOOL_NAME_ALIAS_ROWS`
 * block. Both sides use the flat `canonical|alias|alias` format precisely
 * so this parser is trivial and cannot mis-read a table shape.
 *
 * The opening bracket is located by "a `[` followed by a newline and a
 * quoted row" — so the `[` in a return type annotation (`-> Array[String]`)
 * can never be mistaken for the array literal.
 */
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

function canonicalIds(rows) {
  return rows.map((r) => r.split("|")[0]);
}

// ---------------------------------------------------------------- TN1
const coreSource = read(CORE_TABLE);
const coreRows = extractRows(coreSource, "tool_alias_rows");
if (!coreRows || coreRows.length === 0) {
  bad("TN1", "cannot read the kernel alias table from core/tool_names.mbt");
} else {
  ok("TN1", "kernel alias table: " + coreRows.length + " canonical ids");
}

// ---------------------------------------------------------------- TN2
const hostSource = read(HOST_WIRE);
const hostRows = extractRows(hostSource, "TOOL_NAME_ALIAS_ROWS");
if (!hostRows || hostRows.length === 0) {
  bad("TN2", "cannot read the Host alias table from agent_loop_product_wire.js");
} else {
  ok("TN2", "Host alias table: " + hostRows.length + " canonical ids");
}

// ---------------------------------------------------------------- TN3
if (coreRows && hostRows) {
  const coreSet = new Set(coreRows);
  const hostSet = new Set(hostRows);
  const onlyCore = coreRows.filter((r) => !hostSet.has(r));
  const onlyHost = hostRows.filter((r) => !coreSet.has(r));
  if (onlyCore.length === 0 && onlyHost.length === 0) {
    ok("TN3", "kernel and Host alias tables are identical");
  } else {
    bad(
      "TN3",
      "alias tables drifted — kernel-only: [" +
        onlyCore.join(", ") +
        "] Host-only: [" +
        onlyHost.join(", ") +
        "]",
    );
  }
}

// ---------------------------------------------------------------- TN4
// Every tool the kernel registers must be spellable. A registered tool with
// no canonical id in the table is a tool the model can only reach by an
// exact spelling it is very unlikely to guess.
const productSource = read(PRODUCT_TOOLS);
const specBlock = productSource.slice(productSource.indexOf("pub fn product_tool_specs"));
const specIds = [];
if (specBlock) {
  const re = /id:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(specBlock)) !== null) specIds.push(m[1]);
}
const known = new Set(coreRows ? canonicalIds(coreRows) : []);
known.add("Read");
known.add("Shell");
known.add("TodoWrite");
const missing = specIds.filter((id) => !known.has(id));
if (specIds.length === 0) {
  bad("TN4", "cannot read product_tool_specs() ids");
} else if (missing.length === 0) {
  ok("TN4", "all " + specIds.length + " registered product tools are in the alias table");
} else {
  bad("TN4", "registered tools missing from the alias table: " + missing.join(", "));
}

// ---------------------------------------------------------------- TN5
// A canonical id must not also be listed as one of its own aliases — that
// would let the two sides disagree about which spelling wins.
if (coreRows) {
  const selfAliased = coreRows.filter((r) => {
    const parts = r.split("|");
    return parts.slice(1).indexOf(parts[0]) >= 0;
  });
  if (selfAliased.length === 0) {
    ok("TN5", "no canonical id is repeated inside its own alias list");
  } else {
    bad("TN5", "self-aliased rows: " + selfAliased.join(", "));
  }
}

// ---------------------------------------------------------------- TN6
// No alias may map to two different canonical ids. That would make the
// canonicalization order-dependent.
if (coreRows) {
  const owner = new Map();
  const conflicts = [];
  for (const row of coreRows) {
    const parts = row.split("|");
    for (const alias of parts.slice(1)) {
      if (owner.has(alias) && owner.get(alias) !== parts[0]) {
        conflicts.push(alias + " → " + owner.get(alias) + " and " + parts[0]);
      } else {
        owner.set(alias, parts[0]);
      }
    }
  }
  if (conflicts.length === 0) {
    ok("TN6", "no alias maps to two canonical ids");
  } else {
    bad("TN6", "ambiguous aliases: " + conflicts.join("; "));
  }
}

if (failures > 0) {
  console.log("");
  console.log("tool name contract: " + failures + " FAIL");
  process.exit(1);
}
console.log("");
console.log("tool name contract: all green");
process.exit(0);
