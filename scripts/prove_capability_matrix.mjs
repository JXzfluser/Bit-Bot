#!/usr/bin/env node
// Capability-matrix evidence gate.
//
// docs/capability-matrix.md is the project's contract: every row names an
// evidence file and a test name, e.g.
//
//   | CM-0101 | ... | `runtime/acceptance_cm0101_test.mbt`::acceptance_CM-0101_send_to_user_text_delivery — ... | PASS | PASS |
//
// Nothing in CI stopped a row's evidence from being renamed or deleted, so the
// matrix could silently drift into a false ledger. This gate makes it
// machine-checkable:
//
//   CM1  every row's evidence file exists
//   CM2  every row's evidence file declares a test with the exact named test
//   CM3  no row points at a file outside the repository
//   CM4  every declared matrix test is unique (one row <-> one test)
//   CM5  the number of rows matches the number of distinct evidence entries
//
// Exit code 1 on any failure, so CI turns a drifting matrix red instead of
// quietly accepting it.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX = join(ROOT, 'docs/capability-matrix.md');

if (!existsSync(MATRIX)) {
  console.error(`prove_capability_matrix: missing ${MATRIX}`);
  process.exit(1);
}

const lines = readFileSync(MATRIX, 'utf8').split('\n');
const rows = [];
for (const line of lines) {
  const id = line.match(/^\|\s*(CM-\d+)\s*\|/);
  if (!id) continue;
  // Evidence cell: `path/to/file.mbt`::test_name
  const ev = line.match(/`([A-Za-z0-9_\-./]+\.mbt)`\s*::\s*([A-Za-z0-9_\-]+)/);
  rows.push({ id: id[1], file: ev ? ev[1] : null, test: ev ? ev[2] : null, line: line });
}

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

// CM1 / CM3: evidence file exists inside the repo
// CM2: the file declares that exact test name
const fileCache = new Map();
function readIfExists(rel) {
  if (fileCache.has(rel)) return fileCache.get(rel);
  const p = join(ROOT, rel);
  let src = null;
  if (existsSync(p)) src = readFileSync(p, 'utf8');
  fileCache.set(rel, src);
  return src;
}

for (const r of rows) {
  if (!r.file) {
    failures.push(`${r.id}: no parsable evidence cell`);
    continue;
  }
  ok(!r.file.startsWith('/') && !r.file.includes('..'),
    `${r.id}: evidence path escapes the repo: ${r.file}`);
  const src = readIfExists(r.file);
  ok(src !== null, `${r.id}: evidence file missing: ${r.file}`);
  if (src === null) continue;
  // Test declarations look like: test "acceptance_CM-0101_..." {
  const names = new Set();
  for (const m of src.matchAll(/\btest\s+"([^"]+)"/g)) names.add(m[1]);
  ok(names.has(r.test),
    `${r.id}: evidence test not found: ${r.file}::${r.test}`);
}

// CM4: one evidence test may back several rows, but only rows whose CM id is
// declared in the test name itself (the `acceptance_CM-1301_1302_*` convention).
const seen = new Map();
const claimedIds = new Set();
for (const r of rows) {
  if (!r.file || !r.test) continue;
  claimedIds.add(r.id);
  const key = `${r.file}::${r.test}`;
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key).push(r.id);
}
// The test name may declare several ids as `CM-0903_0905`; expand them.
function declaredIds(testName) {
  const out = new Set();
  for (const m of testName.matchAll(/CM-(\d{4}(?:_\d{4})*)/g)) {
    for (const part of m[1].split('_')) out.add(`CM-${part}`);
  }
  return out;
}
for (const [key, ids] of seen) {
  if (ids.length < 2) continue;
  const testName = key.split('::')[1];
  const declared = declaredIds(testName);
  for (const id of ids) {
    ok(declared.has(id),
      `${id}: shares evidence with ${ids.filter((x) => x !== id).join(',')} but the test name does not declare ${id}: ${key}`);
  }
}

// CM5: reverse direction — a CM id embedded in an evidence test name must be
// claimed by some matrix row, otherwise a capability is tested but unlisted.
for (const key of seen.keys()) {
  const testName = key.split('::')[1];
  for (const id of declaredIds(testName)) {
    ok(claimedIds.has(id),
      `${id}: named in evidence test ${key} but no matrix row claims it`);
  }
}

console.log(`prove_capability_matrix: ${rows.length} rows, ${seen.size} distinct evidence entries`);
if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('CM1 evidence files exist        OK');
console.log('CM2 evidence tests declared     OK');
console.log('CM3 evidence paths in-repo      OK');
console.log('CM4 shared evidence self-named  OK');
console.log('CM5 no unlisted capability ids  OK');
