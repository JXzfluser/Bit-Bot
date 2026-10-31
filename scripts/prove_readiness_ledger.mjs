#!/usr/bin/env node
// Product-readiness ledger gate.
//
// docs/qa/product-readiness.md answers one question the capability matrix does
// NOT answer: "can a user reach this?" The matrix's PASS means "implemented and
// evidenced by a test"; it does not mean "wired to the product". The contract
// layer lists implementations with no production consumer, but a reader still
// has to cross-reference two documents by hand.
//
// This gate classifies every CM row into exactly one bucket, from two sources
// that are themselves gated:
//
//   docs/capability-matrix.md   evidence cell (+ "product Host" marker)
//   docs/qa/contract-layer.md   CMs touched by an unwired implementation
//
// Buckets:
//   user     evidence names a product Host path AND no unwired implementation
//   partial  names a product Host path, but also has an unwired implementation
//   test-only  unwired implementation and no product Host marker
//   wired    implementation has a production consumer, but the row names no
//            per-CM product Host path (reachable in code, entry not itemised)
//
// RD1  every matrix row lands in exactly one bucket
// RD2  the doc's summary line matches the computed numbers
// RD3  the doc lists every CM id of the two non-trivial buckets
//
// Exit 1 on any failure.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX = join(ROOT, 'docs/capability-matrix.md');
const CONTRACT = join(ROOT, 'docs/qa/contract-layer.md');
const DOC = join(ROOT, 'docs/qa/product-readiness.md');

if (!existsSync(DOC)) {
  console.error(`prove_readiness_ledger: missing ${DOC}`);
  process.exit(1);
}

const rows = new Map();
for (const line of readFileSync(MATRIX, 'utf8').split('\n')) {
  if (!/^\|\s*CM-\d+\s*\|/.test(line)) continue;
  const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  if (cells.length < 9) continue;
  rows.set(cells[0], { evidence: cells[6], u: cells[7], i: cells[8] });
}

const contractCMs = new Set();
for (const line of readFileSync(CONTRACT, 'utf8').split('\n')) {
  if (!line.startsWith('| `')) continue;
  for (const m of line.matchAll(/CM-\d+/g)) contractCMs.add(m[0]);
}

const buckets = { user: [], partial: [], 'test-only': [], wired: [] };
for (const [id, r] of rows) {
  const product = /product\s+Host/i.test(r.evidence);
  const unwired = contractCMs.has(id);
  if (product && !unwired) buckets.user.push(id);
  else if (product && unwired) buckets.partial.push(id);
  else if (unwired) buckets['test-only'].push(id);
  else buckets.wired.push(id);
}

const failures = [];
const total = Object.values(buckets).reduce((a, b) => a + b.length, 0);
if (total !== rows.size) failures.push(`RD1 classified ${total} rows, matrix has ${rows.size}`);

const doc = readFileSync(DOC, 'utf8');
const summary = doc.match(/账本：用户可达\s*(\d+)\s*·\s*部分可达\s*(\d+)\s*·\s*仅测试可达\s*(\d+)\s*·\s*内核接线未逐条点名\s*(\d+)\s*·\s*合计\s*(\d+)/);
if (!summary) {
  failures.push('RD2 summary line not found (expected 「账本：用户可达 N · 部分可达 N · 仅测试可达 N · 内核接线未逐条点名 N · 合计 N」)');
} else {
  const want = [buckets.user.length, buckets.partial.length, buckets['test-only'].length, buckets.wired.length, rows.size];
  const got = summary.slice(1).map(Number);
  for (let i = 0; i < want.length; i++) {
    if (want[i] !== got[i]) failures.push(`RD2 summary field ${i + 1}: doc=${got[i]} computed=${want[i]} (${['user', 'partial', 'test-only', 'wired', 'total'][i]})`);
  }
}

// The doc must actually name the CMs, not just count them — a number with no
// list is how "PASS=234" became a false comfort in the first place.
const missing = [];
for (const id of buckets.partial.concat(buckets['test-only'])) {
  if (!doc.includes('`' + id + '`')) missing.push(id);
}
if (missing.length) failures.push(`RD3 doc does not list ${missing.length} CMs: ${missing.slice(0, 12).join(', ')}`);

console.log(`prove_readiness_ledger: ${rows.size} CMs — user=${buckets.user.length} partial=${buckets.partial.length} test-only=${buckets['test-only'].length} wired=${buckets.wired.length}`);
if (failures.length) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('RD1 one bucket per row          OK');
console.log('RD2 summary matches             OK');
console.log('RD3 non-trivial buckets listed  OK');
if (process.argv.includes('--list')) {
  for (const k of ['user', 'partial', 'test-only', 'wired']) {
    console.log(`\n## ${k} (${buckets[k].length})\n${buckets[k].join(' ')}`);
  }
}
