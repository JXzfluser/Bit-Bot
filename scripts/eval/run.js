#!/usr/bin/env node
"use strict";

/**
 * AE-* agent behaviour eval CLI.
 *
 *   node scripts/eval/run.js                     # all offline scenarios
 *   node scripts/eval/run.js --scenario AE-07    # one scenario
 *   node scripts/eval/run.js --category group    # one category
 *   node scripts/eval/run.js --json              # machine-readable result on stdout
 *   node scripts/eval/run.js --live              # also run the live (real model) scenarios
 *   node scripts/eval/run.js --list              # scenario table
 *
 * Exit codes:
 *   0  every executed scenario passed
 *   1  at least one scenario failed
 *   2  NEEDS_LIVE / infrastructure missing (e.g. --live without a provider key,
 *      or no `moon` on PATH) — never reported as a pass.
 *
 * 口径：AE 绿 = 行为达标。WP/EG/PP/AU/SK 绿 = 接线达标。两者不能互相替代，
 * AE 绿也不代表 AR-01/02/03 已升裁。
 */

const fs = require("fs");
const path = require("path");

const { SCENARIOS, CATEGORIES, byId, select } = require("./scenarios");
const { executeScenario, judgeScenario, liveProviderConfig } = require("./harness");
const { computeMetrics } = require("./metrics");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const out = {
    ids: [],
    category: null,
    json: false,
    live: false,
    list: false,
    out: null,
    timeoutMs: 120000,
    moonBin: process.env.MOON_BIN || "moon",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scenario" || a === "-s") {
      const v = argv[++i] || "";
      for (const part of String(v).split(",")) {
        const id = part.trim();
        if (id) out.ids.push(id);
      }
    } else if (a.startsWith("--scenario=")) {
      for (const part of a.slice("--scenario=".length).split(",")) {
        const id = part.trim();
        if (id) out.ids.push(id);
      }
    } else if (a === "--category" || a === "-c") {
      out.category = String(argv[++i] || "").trim() || null;
    } else if (a.startsWith("--category=")) {
      out.category = a.slice("--category=".length).trim() || null;
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "--live") {
      out.live = true;
    } else if (a === "--list") {
      out.list = true;
    } else if (a === "--out") {
      out.out = String(argv[++i] || "");
    } else if (a.startsWith("--out=")) {
      out.out = a.slice("--out=".length);
    } else if (a === "--timeout") {
      out.timeoutMs = Number(argv[++i]) || out.timeoutMs;
    } else if (a === "--moon-bin") {
      out.moonBin = String(argv[++i] || "moon");
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (!a.startsWith("-")) {
      out.ids.push(a);
    }
  }
  return out;
}

function usage() {
  console.log(
    [
      "AE-* agent behaviour eval",
      "",
      "  node scripts/eval/run.js [--scenario AE-07] [--category group] [--json] [--live] [--list]",
      "",
      "  --scenario <id[,id]>  only these scenarios",
      "  --category <name>     single_tool | multi_step | failure_recovery | group | security | live",
      "  --json                machine-readable JSON on stdout (human summary goes to stderr)",
      "  --live                also run the live scenarios (needs a real provider key)",
      "  --out <file>          write the JSON result to a file",
      "  --timeout <ms>        per-scenario kernel timeout (default 120000)",
      "",
      "exit: 0 all executed scenarios passed | 1 a scenario failed | 2 NEEDS_LIVE / infra missing",
    ].join("\n"),
  );
}

function listScenarios() {
  console.log("ID     CATEGORY         GATE  LIVE  NAME");
  for (const s of SCENARIOS) {
    console.log(
      [
        s.id.padEnd(6),
        String(s.category).padEnd(17),
        (s.gate ? "yes" : "obs").padEnd(5),
        (s.live ? "yes" : "no").padEnd(5),
        s.name,
      ].join(" "),
    );
  }
  console.log(`\n${SCENARIOS.length} scenarios.`);
}

function isInfraMissing(trace) {
  const err = String((trace && trace.error) || "");
  return /spawn_failed|ENOENT|kernel_spawn_error/.test(err);
}

/** Trimmed trace for the JSON payload (the full trace stays in memory for metrics). */
function summarizeTrace(trace) {
  const t = trace || {};
  return {
    duration_ms: t.duration_ms || 0,
    llm_calls: (t.llm_calls || []).map((c) => ({
      index: c.index,
      messages: (c.messages || []).map((m) => ({ role: m.role, content: String(m.content || "").slice(0, 600) })),
      content: String(c.content || "").slice(0, 400),
      calls: c.calls || [],
      error: c.error || null,
    })),
    model_tool_calls: (t.model_tool_calls || []).map((c) => ({
      name: c.name,
      arguments_raw: c.arguments_raw,
      arguments_valid_json: c.arguments_valid_json,
    })),
    observations: (t.observations || []).map((o) => ({
      source: o.source,
      fenced: o.fenced,
      body: String(o.body || "").slice(0, 400),
    })),
    deliveries: (t.deliveries || []).map((d) => String(d.text || "").slice(0, 400)),
    tool_execs: (t.tool_execs || []).map((e) => ({
      name: e.name,
      arguments_raw: e.arguments_raw,
      output: String(e.output || "").slice(0, 200),
    })),
    approvals: t.approvals || [],
    provider_errors: t.provider_errors || [],
    kernel_ops: t.kernel_ops || [],
    wire_ops: t.wire_ops || [],
    session_state: t.session_state || null,
    group: t.group ? { ok: t.group.ok, error: t.group.error || null, returned: t.group.returned, total: t.group.total, partial: t.group.partial, final_report: t.group.final_report || null } : null,
    handoff: t.handoff || null,
    responder_calls: t.responder_calls || [],
    turn: t.turn || null,
    llm_failed: t.llm_failed === true,
    error: t.error || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  if (args.list) {
    listScenarios();
    return 0;
  }

  let scenarios = select({ ids: args.ids, category: args.category });
  if (args.ids.length) {
    const missing = args.ids.filter((id) => !byId(id));
    if (missing.length) {
      console.error(`unknown scenario(s): ${missing.join(", ")}`);
      return 2;
    }
  }
  if (!scenarios.length) {
    console.error("no scenario matched the filter");
    return 2;
  }

  const liveCfg = liveProviderConfig(process.env);
  const liveRequested = args.live;
  const liveAvailable = liveCfg.ready;
  const results = [];
  let infraMissing = false;
  let liveBlocked = false;

  for (const s of scenarios) {
    if (s.live && !liveRequested) {
      results.push({
        id: s.id,
        name: s.name,
        category: s.category,
        backend: s.backend,
        gate: s.gate,
        live: true,
        verdict: "skip",
        skip_reason: "needs_live (use --live with a real provider key)",
        checks: [],
        failures: [],
      });
      if (!args.json) console.log(`skip ${s.id} ${s.name} — needs_live`);
      continue;
    }
    if (s.live && liveRequested && !liveAvailable) {
      liveBlocked = true;
      results.push({
        id: s.id,
        name: s.name,
        category: s.category,
        backend: s.backend,
        gate: s.gate,
        live: true,
        verdict: "skip",
        skip_reason: "NEEDS_LIVE: no provider key/base_url configured",
        checks: [],
        failures: [],
      });
      if (!args.json) console.log(`skip ${s.id} ${s.name} — NEEDS_LIVE`);
      continue;
    }

    const trace = await executeScenario(s, {
      live: liveRequested && s.live === true,
      env: process.env,
      timeoutMs: args.timeoutMs,
      moonBin: args.moonBin,
    });
    const judged = judgeScenario(s, trace);
    const record = {
      id: s.id,
      name: s.name,
      category: s.category,
      difficulty: s.difficulty,
      behavior: s.behavior,
      backend: s.backend,
      gate: s.gate,
      live: s.live === true,
      gap: s.gap || null,
      verdict: judged.verdict,
      checks: judged.checks,
      failures: judged.failures,
      error: trace.error || null,
      trace,
    };
    if (s.live && liveRequested) {
      record.live_provider = { base_url: liveCfg.base, model: liveCfg.model, key_configured: liveCfg.key.length > 0 };
    }
    results.push(record);

    if (trace.error && isInfraMissing(trace)) {
      infraMissing = true;
    }
    if (!args.json) {
      if (judged.verdict === "pass") {
        console.log(`ok ${s.id} ${s.name}`);
      } else {
        console.log(`FAIL ${s.id} ${s.name}`);
        for (const f of judged.failures) {
          console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`);
        }
        if (trace.error) console.log(`  - harness: ${trace.error}`);
      }
    }
  }

  const metrics = computeMetrics(results);
  const payload = {
    schema: "ae-eval/1",
    generated_at: new Date().toISOString(),
    repo_root: REPO_ROOT,
    live_requested: liveRequested,
    live_provider_configured: liveAvailable,
    scenarios: results.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      difficulty: r.difficulty,
      behavior: r.behavior,
      backend: r.backend,
      gate: r.gate,
      live: r.live,
      gap: r.gap,
      verdict: r.verdict,
      skip_reason: r.skip_reason || null,
      error: r.error || null,
      checks: (r.checks || []).map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
      failures: (r.failures || []).map((f) => ({ name: f.name, detail: f.detail })),
      trace: summarizeTrace(r.trace),
    })),
    metrics,
  };

  const jsonText = JSON.stringify(payload, null, 2);
  if (args.out) {
    const abs = path.isAbsolute(args.out) ? args.out : path.join(REPO_ROOT, args.out);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, jsonText + "\n");
  }
  if (args.json) {
    process.stdout.write(jsonText + "\n");
  }

  const t = metrics.totals;
  const summary = [
    "",
    `AE eval: pass=${t.pass} fail=${t.fail} skip=${t.skip}  (gate ${t.gate_pass}/${t.gate_total} pass, observed ${t.observed_total}, live ${t.live_total})`,
    `task_success_rate=${metrics.task_success_rate} tool_selection_accuracy=${metrics.tool_selection_accuracy} tool_call_success_rate=${metrics.tool_call_success_rate}`,
    `steps/task avg=${metrics.steps_per_task.avg} p50=${metrics.steps_per_task.p50} max=${metrics.steps_per_task.max}  tokens(est)=${metrics.token_estimate.total}  latency avg=${metrics.latency_ms.avg}ms max=${metrics.latency_ms.max}ms`,
  ];
  if (metrics.gaps.length) {
    summary.push(`known gaps (not gating): ${metrics.gaps.map((g) => `${g.scenario_id}${g.tracked_gap ? `(${g.tracked_gap})` : ""}`).join(", ")}`);
  }
  if (metrics.failures.length) {
    summary.push("failures (attributed):");
    for (const f of metrics.failures) {
      summary.push(
        `  ${f.scenario_id} ${f.check}${f.tool ? ` [tool=${f.tool}]` : ""}${f.step ? ` [step=${f.step}]` : ""}${f.detail ? ` — ${f.detail}` : ""}`,
      );
    }
  }
  summary.push("AE green = behaviour gate only. WP/EG/PP/AU/SK green = wiring gate only. They do not substitute for each other.");
  const summaryText = summary.join("\n");
  if (args.json) {
    process.stderr.write(summaryText + "\n");
  } else {
    console.log(summaryText);
  }

  if (t.fail > 0) return 1;
  if (liveBlocked) {
    console.error("NEEDS_LIVE: --live was requested but no provider key/base_url is configured. Not a pass.");
    return 2;
  }
  if (infraMissing) {
    console.error("infra missing: the MoonBit toolchain could not run the kernel. Not a pass.");
    return 2;
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("eval harness crashed:", err && err.stack ? err.stack : err);
    process.exitCode = 2;
  });
