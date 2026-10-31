#!/usr/bin/env node
// Contract-layer gate.
//
// A "contract layer" file is a capability implementation that:
//
//   1. is a real, matrix-evidenced capability (some matrix row's evidence test
//      exercises it), AND
//   2. has NO production consumer — nothing on the product path calls it.
//
// Those files are not dead code (deleting them would turn matrix PASS rows into
// false claims), but they are also not *delivered*: the capability exists as a
// contract and a passing test, and cannot be reached by a user.
//
// The inventory lives in docs/qa/contract-layer.md. This gate keeps the two in
// sync, so a newly unwired capability cannot appear silently and a wired-up one
// cannot keep lingering in the list.
//
//   CL1  every contract-layer file is declared in the doc
//   CL2  every file declared in the doc still qualifies (or is a known exception)
//   CL3  the doc's line counts match the files on disk
//
// Exit code 1 on any failure.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'docs/qa/contract-layer.md');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === '.git' || e === '_build' || e === 'node_modules' || e === '.moon' || e === 'artifacts') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const allFiles = walk(ROOT);
const rel = (p) => relative(ROOT, p);
const mbtFiles = allFiles.filter((f) => f.endsWith('.mbt'));

// ---- matrix evidence files ----
const matrix = readFileSync(join(ROOT, 'docs/capability-matrix.md'), 'utf8');
const evidenceFiles = new Set();
for (const line of matrix.split('\n')) {
  const ev = line.match(/`([A-Za-z0-9_\-./]+\.mbt)`\s*::\s*([A-Za-z0-9_\-]+)/);
  if (ev) evidenceFiles.add(ev[1]);
}

// ---- symbol index ----
const typeOwner = new Map(), methodOwner = new Map(), fnOwner = new Map();
for (const f of mbtFiles) {
  const src = readFileSync(f, 'utf8');
  for (const line of src.split('\n')) {
    let m;
    if ((m = line.match(/^(?:pub(?:\([a-z]+\))?\s+)?(?:struct|enum|type|trait)\s+([A-Za-z_][A-Za-z0-9_]*)/)))
      if (!typeOwner.has(m[1])) typeOwner.set(m[1], rel(f));
    if ((m = line.match(/^(?:pub(?:\([a-z]+\))?\s+)?fn\s+([A-Z][A-Za-z0-9_]*)::([a-z_][A-Za-z0-9_]*)/)))
      methodOwner.set(`${m[1]}::${m[2]}`, rel(f));
    if ((m = line.match(/^(?:pub(?:\([a-z]+\))?\s+)?fn\s+([a-z_][A-Za-z0-9_]*)\s*\(/)))
      if (!fnOwner.has(m[1])) fnOwner.set(m[1], rel(f));
  }
}
const owned = new Map();
for (const f of mbtFiles) {
  const r = rel(f);
  const s = new Set();
  for (const [sym, o] of methodOwner) if (o === r) s.add(sym);
  for (const [sym, o] of typeOwner) if (o === r) s.add(sym);
  for (const [sym, o] of fnOwner) if (o === r) s.add(sym);
  owned.set(r, s);
}
const symToFile = new Map();
for (const [r, s] of owned) for (const sym of s) if (!symToFile.has(sym)) symToFile.set(sym, r);
// bare method-name aliases (instance calls have no `Type::` prefix)
const methodNameOwner = new Map(), ambiguous = new Set();
for (const [sym, o] of methodOwner) {
  const bare = sym.split('::')[1];
  if (methodNameOwner.has(bare) && methodNameOwner.get(bare) !== o) ambiguous.add(bare);
  else methodNameOwner.set(bare, o);
}
for (const b of ambiguous) methodNameOwner.delete(b);
for (const [bare, o] of methodNameOwner) if (!symToFile.has(bare)) symToFile.set(bare, o);

// ---- reference scan ----
const isTest = (p) => p.endsWith('_test.mbt') || p.endsWith('_wbtest.mbt');
const IDENT = /\b[A-Za-z_][A-Za-z0-9_]*(?:::[a-z_][A-Za-z0-9_]*)?\b/g;
const consumers = new Map();
for (const f of mbtFiles) consumers.set(rel(f), new Set());
for (const cf of allFiles.filter((f) => /\.(mbt|mjs|js)$/.test(f))) {
  const src = readFileSync(cf, 'utf8');
  const cr = rel(cf);
  for (const mm of src.matchAll(IDENT)) {
    const target = symToFile.get(mm[0]);
    if (!target || target === cr) continue;
    consumers.get(target).add(cr);
  }
}

// ---- contract layer set ----
const contractLayer = new Map(); // file -> { lines, cmIds }
for (const f of mbtFiles) {
  const r = rel(f);
  if (isTest(r)) continue;
  const cs = [...consumers.get(r)];
  if (cs.length === 0) continue;                    // truly unused -> should be deleted, not declared
  if (cs.some((c) => !isTest(c))) continue;        // has a production consumer -> wired up
  const ev = cs.filter((c) => evidenceFiles.has(c));
  if (ev.length === 0) continue;                    // test-only but not matrix-evidenced -> dead
  const lines = readFileSync(join(ROOT, r), 'utf8').split('\n').length;
  contractLayer.set(r, { lines, evidence: ev });
}

// ---- doc parsing ----
const failures = [];
const listMode = process.argv.includes('--list');
if (!existsSync(DOC) && !listMode) {
  console.error(`prove_contract_layer: missing ${DOC}`);
  process.exit(1);
}
const docText = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';
const declared = new Map(); // file -> declared lines
for (const line of docText.split('\n')) {
  const m = line.match(/^\|\s*`([^`]+\.mbt)`\s*\|\s*(\d+)\s*\|/);
  if (m) declared.set(m[1], parseInt(m[2], 10));
}

// CL1
for (const [f] of contractLayer) {
  if (!declared.has(f)) failures.push(`CL1 not declared in contract-layer.md: ${f}`);
}
// CL2 + CL3
for (const [f, lines] of declared) {
  if (!contractLayer.has(f)) {
    // It may have been wired up (good) or deleted (good) — both mean the doc is stale.
    failures.push(`CL2 declared but no longer qualifies: ${f}`);
    continue;
  }
  if (contractLayer.get(f).lines !== lines) {
    failures.push(`CL3 line count mismatch for ${f}: doc=${lines} disk=${contractLayer.get(f).lines}`);
  }
}

const totalLines = [...contractLayer.values()].reduce((a, b) => a + b.lines, 0);
console.log(`prove_contract_layer: ${contractLayer.size} files / ${totalLines} lines are contract-layer (matrix-evidenced, not wired to production)`);

// `--list` emits the inventory table (used to regenerate the doc).
if (listMode) {
  const cmOf = new Map();
  for (const line of matrix.split('\n')) {
    const id = line.match(/^\|\s*(CM-\d+)\s*\|/);
    const ev = line.match(/`([A-Za-z0-9_\-./]+\.mbt)`\s*::\s*([A-Za-z0-9_\-]+)/);
    if (!id || !ev) continue;
    if (!cmOf.has(ev[1])) cmOf.set(ev[1], []);
    cmOf.get(ev[1]).push(id[1]);
  }
  const rows = [...contractLayer.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [f, info] of rows) {
    const ids = new Set();
    for (const e of info.evidence) for (const id of cmOf.get(e) || []) ids.add(id);
    console.log(`| \`${f}\` | ${info.lines} | ${[...ids].sort().join(' ')} |`);
  }
  process.exit(0);
}
if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('CL1 all contract-layer files declared  OK');
console.log('CL2 no stale declarations              OK');
console.log('CL3 line counts match                  OK');
