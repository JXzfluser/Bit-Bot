"use strict";

/**
 * AE-* metrics.
 *
 * 口径（写在这里，文档里也抄一份）：
 *   - 任务成功率 task_success_rate = 核心场景（gate=true）里通过的比例。
 *     live 场景与观测场景（gate=false）不混进这个分母。
 *   - 工具选择正确率 tool_selection_accuracy = 「断言了工具选择的检查项」里
 *     通过的比例。离线模式下模型是脚本，所以这个指标衡量的是
 *     「系统的工具调用契约」，不是模型的智能。
 *   - 工具调用成功率 tool_call_success_rate = 模型发起的工具调用里，
 *     拿到非错误观察的比例。
 *   - 平均步数/任务 = 核心场景的 agent_steps 均值（含上限场景，会拉高均值，
 *     所以同时给 p50 / max）。
 *   - token 估算 = 最后一个 llm 请求里的消息字符数 + 交付文本字符数，再除以 4。
 *     **这是估算，不是 provider 真实 usage**；provider 返回 usage 时以 usage 为准。
 *   - 时延 = 每个场景从 spawn 到内核结束的墙钟时间。
 *   - 失败可归因性 = 每条失败都必须落到一个具体的 check / step / tool 上。
 */

const ERROR_MARKERS = [
  "unknown tool:",
  "missing required arg:",
  "missing required field:",
  "approval denied:",
  "read: path not found",
  "exec refused:",
  "not found:",
];

function isErrorObservation(body) {
  const text = String(body || "");
  if (!text) return false;
  return ERROR_MARKERS.some((m) => text.includes(m));
}

/** Which step / tool does a failing check belong to? */
function attribute(trace, check) {
  const out = { step: null, tool: null, tool_arguments: null };
  if (!trace) return out;
  const name = String((check && check.name) || "");
  const execs = trace.tool_execs || [];
  const calls = trace.model_tool_calls || [];
  const lower = name.toLowerCase();
  let hit = null;
  for (const e of execs) {
    const n = String(e.name || "").toLowerCase();
    if (n && lower.includes(n)) {
      hit = e;
      break;
    }
  }
  if (!hit) {
    for (const c of calls) {
      const n = String(c.name || "").toLowerCase();
      if (n && lower.includes(n)) {
        hit = { name: c.name, arguments_raw: c.arguments_raw };
        break;
      }
    }
  }
  if (hit) {
    out.tool = hit.name;
    out.tool_arguments = hit.arguments_raw || null;
  }
  if (trace.llm_calls && trace.llm_calls.length) {
    out.step = trace.llm_calls.length;
  }
  return out;
}

function estimateTokens(trace) {
  const llm = trace.llm_calls || [];
  let chars = 0;
  if (llm.length) {
    const last = llm[llm.length - 1];
    for (const m of last.messages || []) chars += String((m && m.content) || "").length;
    chars += String((last && last.content) || "").length;
  }
  for (const d of trace.deliveries || []) chars += String((d && d.text) || "").length;
  return { chars, tokens: Math.ceil(chars / 4) };
}

function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 10000) / 10000;
}

function computeMetrics(results) {
  const executed = results.filter((r) => r.verdict === "pass" || r.verdict === "fail");
  const skipped = results.filter((r) => r.verdict === "skip");
  const gate = results.filter((r) => r.gate === true && (r.verdict === "pass" || r.verdict === "fail"));
  const gatePass = gate.filter((r) => r.verdict === "pass");
  const observed = results.filter((r) => r.gate === false && (r.verdict === "pass" || r.verdict === "fail"));
  const live = results.filter((r) => r.live === true);

  let toolChecks = 0;
  let toolChecksPassed = 0;
  let totalCalls = 0;
  let okCalls = 0;
  const steps = [];
  let totalTokens = 0;
  let totalMs = 0;
  let maxMs = 0;
  const failures = [];
  const gaps = [];
  const perScenario = [];

  for (const r of results) {
    if (r.verdict === "skip") {
      perScenario.push({ id: r.id, status: "skip", reason: r.skip_reason || "" });
      continue;
    }
    const trace = r.trace || {};
    for (const c of r.checks || []) {
      if (/tool|工具|参数|argument/i.test(String(c.name || ""))) {
        toolChecks += 1;
        if (c.ok) toolChecksPassed += 1;
      }
    }
    const callCount = (trace.model_tool_calls || []).length;
    const okObs = (trace.observations || []).filter((o) => !isErrorObservation(o.body)).length;
    totalCalls += callCount;
    okCalls += Math.min(okObs, callCount || okObs);
    if (typeof (trace.turn || {}).agent_steps === "number") {
      steps.push(trace.turn.agent_steps);
    }
    const tok = estimateTokens(trace);
    totalTokens += tok.tokens;
    const ms = Number(trace.duration_ms || 0);
    totalMs += ms;
    if (ms > maxMs) maxMs = ms;
    perScenario.push({
      id: r.id,
      status: r.verdict,
      category: r.category,
      steps: (trace.turn || {}).agent_steps === undefined ? null : trace.turn.agent_steps,
      llm_calls: (trace.llm_calls || []).length,
      tool_calls: callCount,
      execs: (trace.tool_execs || []).length,
      tokens_estimate: tok.tokens,
      duration_ms: ms,
    });
    for (const f of r.failures || []) {
      const a = attribute(trace, f);
      failures.push({
        scenario_id: r.id,
        scenario_name: r.name,
        category: r.category,
        gate: r.gate === true,
        gap: r.gap || null,
        check: f.name,
        detail: f.detail || "",
        step: a.step,
        tool: a.tool,
        tool_arguments: a.tool_arguments,
      });
    }
    if (r.gate === false && r.verdict === "fail") {
      gaps.push({
        scenario_id: r.id,
        scenario_name: r.name,
        tracked_gap: r.gap || null,
        failing_checks: (r.failures || []).map((f) => f.name),
      });
    }
  }

  const sortedSteps = steps.slice().sort((a, b) => a - b);
  const p50 = sortedSteps.length ? sortedSteps[Math.floor(sortedSteps.length / 2)] : null;

  return {
    totals: {
      scenarios: results.length,
      executed: executed.length,
      pass: results.filter((r) => r.verdict === "pass").length,
      fail: results.filter((r) => r.verdict === "fail").length,
      skip: skipped.length,
      gate_total: gate.length,
      gate_pass: gatePass.length,
      gate_fail: gate.length - gatePass.length,
      observed_total: observed.length,
      live_total: live.length,
      live_skip: live.filter((r) => r.verdict === "skip").length,
    },
    task_success_rate: pct(gatePass.length, gate.length),
    tool_selection_accuracy: pct(toolChecksPassed, toolChecks),
    tool_selection_checks: { total: toolChecks, passed: toolChecksPassed },
    tool_call_success_rate: pct(okCalls, totalCalls),
    tool_calls: { total: totalCalls, ok: okCalls },
    steps_per_task: {
      avg: steps.length ? Math.round((steps.reduce((a, b) => a + b, 0) / steps.length) * 100) / 100 : null,
      p50,
      max: steps.length ? steps[steps.length - 1] : null,
      samples: steps.length,
    },
    token_estimate: {
      total: totalTokens,
      method: "chars/4 over the last llm_chat request + delivered text (estimate, not provider usage)",
    },
    latency_ms: {
      total: totalMs,
      avg: results.length ? Math.round((totalMs / Math.max(1, executed.length)) * 100) / 100 : 0,
      max: maxMs,
    },
    failures,
    gaps,
    per_scenario: perScenario,
  };
}

module.exports = {
  computeMetrics,
  estimateTokens,
  isErrorObservation,
  attribute,
};
