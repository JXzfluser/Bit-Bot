#!/usr/bin/env node
"use strict";

/**
 * prove_gp138_routine_interval — GP-138（§6.2）Routine 最小间隔 ≥5 分钟
 *
 * 官方：Routine 间隔至少 5 分钟。Host 在持久化点校验 cron 的分钟粒度：
 * 每小时都触发且相邻触发间隔 <5 分钟 → ok:false / interval_too_short，
 * 不写 host-routines.json（不假装已建）；@now/@once 与 <1 次/5 分的写法放行。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp138-"));
const ffi = createHostFfi(root);
const routinesPath = path.join(root, "data", "routines", "host-routines.json");

async function schedule(id, cron) {
  const res = await ffi.executeHostEffects([
    { kind: "routine_schedule", command: `${id}|${cron}|do the thing` },
  ]);
  const hit = (res || []).find((r) => r && r.kind === "routine_schedule");
  let payload = {};
  try { payload = JSON.parse((hit && hit.stdout) || "{}"); } catch (_) { payload = {}; }
  return { hit: hit || {}, payload };
}

function storedIds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(routinesPath, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : parsed.routines || [];
    return rows.map((r) => r.id);
  } catch (_) {
    return [];
  }
}

(async () => {
  console.log("prove_gp138_routine_interval — Routine 最小间隔（GP-138）");

  const rejects = [
    ["every-minute", "* * * * *"],
    ["every-2-min", "*/2 * * * *"],
    ["every-4-min", "*/4 * * * *"],
    ["minute-list-gap-2", "0,2 * * * *"],
    ["minute-list-gap-1", "0,1,30 * * * *"],
  ];
  for (const [id, cron] of rejects) {
    const { hit, payload } = await schedule(id, cron);
    const good =
      hit.ok === false &&
      hit.error === "interval_too_short" &&
      payload.stored === false &&
      payload.min_interval_minutes === 5;
    good ? ok(`${cron} → interval_too_short（不落库）`) : bad(`${cron} 应拒绝`, JSON.stringify(hit).slice(0, 200));
  }
  const refused = storedIds().filter((id) => id.startsWith("every-") || id.includes("gap"));
  if (!refused.length) ok("被拒例程未写入 host-routines.json");
  else bad("被拒例程仍落库", refused.join(","));

  const accepts = [
    ["every-5-min", "*/5 * * * *"],
    ["minute-list-gap-5", "0,5,10 * * * *"],
    ["hourly-at-9", "0 9 * * *"],
    ["hour-restricted", "0,1 9 * * *"],
    ["named-hourly", "@hourly"],
    ["one-shot", "@now"],
  ];
  for (const [id, cron] of accepts) {
    const { hit, payload } = await schedule(id, cron);
    const good = hit.ok === true && payload.stored === true;
    good ? ok(`${cron} → 接受并落库`) : bad(`${cron} 应接受`, JSON.stringify(hit).slice(0, 200));
  }
  const ids = storedIds();
  const missing = accepts.map(([id]) => id).filter((id) => !ids.includes(id));
  if (!missing.length) ok("放行例程均写入 host-routines.json（含 @now/@hourly）");
  else bad("放行例程缺失", missing.join(","));

  // 拒绝时留下可审计的 refusal 快照，且不伪造 stored。
  const refDir = path.join(root, "data", "routines");
  const refFiles = fs.readdirSync(refDir).filter((f) => f.startsWith("refuse-"));
  if (refFiles.length === rejects.length) ok(`拒绝快照 ${refFiles.length} 份（可审计）`);
  else bad("拒绝快照数量", refFiles.length + " want " + rejects.length);
  const one = refFiles.length ? JSON.parse(fs.readFileSync(path.join(refDir, refFiles[0]), "utf8")) : {};
  if (one.stored === false && one.min_interval_minutes === 5 && one.error === "interval_too_short") {
    ok("拒绝快照含 stored:false / min_interval_minutes:5");
  } else {
    bad("拒绝快照字段", JSON.stringify(one));
  }

  console.log(`\nprove_gp138_routine_interval: PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("prove_gp138_routine_interval crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
