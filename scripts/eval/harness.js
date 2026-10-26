"use strict";

/**
 * AE-* agent behaviour eval harness.
 *
 * What this file is:
 *   - a behaviour probe for the REAL kernel agent loop. The kernel backend
 *     spawns `moon run cmd/desktop_turn --target native` and pumps the
 *     `BITBOT_FFI` line protocol the same way hosts/shared/run_moon_turn.js
 *     does. The loop under test is runtime/agent_loop.mbt `AgentLoop::run`
 *     (see cmd/desktop_turn/agent_loop_product_native.mbt `run_agent_loop_chat`).
 *   - a Host role that is scriptable: the provider answers from a structured
 *     expected sequence (or a context-sensitive policy), the tool host serves
 *     fixtures, the approval host answers with a fixed verdict.
 *
 * What this file is NOT:
 *   - not a second agent loop and not a copy of the kernel state machine.
 *   - not a wiring-invariant check. `trace.kernel_ops === trace.node_ops` proves
 *     the plumbing, not the behaviour. Every assertion in scripts/eval/scenarios.js
 *     is about behaviour: which tool was picked, with which arguments, whether
 *     the observation came back to the model, whether the run terminated, and
 *     whether a failure was reported honestly.
 *
 * Three backends:
 *   kernel : the real kernel via cmd/desktop_turn (needs `moon`).
 *   wire   : Host product wire (hosts/shared/agent_loop_product_wire.js) with a
 *            fake FFI — approval / refusal / provider-error honesty.
 *   group  : Host group orchestration (hosts/desktop/product_surface.js
 *            orchestrateRoom + handoffTask) with injected responder turns.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Kernel observation fence: runtime/agent_loop.mbt `fence_untrusted`. */
const FENCE_RE = /^<cursor_untrusted_data source="([^"]*)">([\s\S]*)<\/cursor_untrusted_data>$/;

/** Tool schema advertised to a live provider — mirrors host_ffi agentLoopToolSchema. */
const AGENT_LOOP_TOOL_SCHEMA = [
  {
    type: "function",
    function: {
      name: "Read",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Shell",
      description: "Run a shell command",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
];

const LIVE_SYSTEM_PROMPT =
  "You are a tool-using agent for the BitBot product. " +
  "Use the provided tools when the task needs them, then answer in one short paragraph. " +
  "Never invent a tool result.";

/* ------------------------------------------------------------------ */
/* small assertion helpers used by scenarios.js                        */
/* ------------------------------------------------------------------ */

function chk(name, ok, detail) {
  return { name: String(name), ok: Boolean(ok), detail: detail === undefined || detail === null ? "" : String(detail) };
}

function chkEq(name, actual, expected, detail) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  return chk(name, a === e, detail === undefined ? `expected ${e}, got ${a}` : `${detail} (expected ${e}, got ${a})`);
}

function chkIncludes(name, haystack, needle, detail) {
  const h = String(haystack === undefined || haystack === null ? "" : haystack);
  const n = String(needle);
  return chk(name, h.includes(n), detail === undefined ? `missing ${JSON.stringify(n)} in ${JSON.stringify(h.slice(0, 240))}` : detail);
}

function chkNotIncludes(name, haystack, needle, detail) {
  const h = String(haystack === undefined || haystack === null ? "" : haystack);
  const n = String(needle);
  return chk(name, !h.includes(n), detail === undefined ? `unexpected ${JSON.stringify(n)}` : detail);
}

function chkAtMost(name, actual, limit, detail) {
  const n = Number(actual);
  return chk(name, Number.isFinite(n) && n <= limit, detail === undefined ? `${n} > ${limit}` : detail);
}

function chkAtLeast(name, actual, floor, detail) {
  const n = Number(actual);
  return chk(name, Number.isFinite(n) && n >= floor, detail === undefined ? `${n} < ${floor}` : detail);
}

/* ------------------------------------------------------------------ */
/* trace helpers                                                       */
/* ------------------------------------------------------------------ */

function parseFence(content) {
  const text = String(content === undefined || content === null ? "" : content);
  const m = FENCE_RE.exec(text);
  if (!m) return { fenced: false, source: "", body: text };
  return { fenced: true, source: m[1], body: m[2] };
}

/**
 * Reconstruct what the model actually did from the message lists the kernel
 * handed to the provider. The kernel pushes, per tool call:
 *   assistant : "<ToolName> <arguments_json>"
 *   tool      : "<cursor_untrusted_data source=...>observation</cursor_untrusted_data>"
 * so the transcript is the source of truth — not the stub that produced it.
 */
function deriveModelActions(llmCalls) {
  const toolCalls = [];
  const observations = [];
  // Every llm_chat carries the full (append-only) message list, so the longest
  // list is the whole transcript — counting per call would multiply the
  // same tool call by the number of later turns.
  let longest = [];
  let longestIndex = -1;
  for (const call of llmCalls || []) {
    const messages = call.messages || [];
    if (messages.length > longest.length) {
      longest = messages;
      longestIndex = call.index;
    }
  }
  for (const msg of longest) {
    const role = String((msg && msg.role) || "");
    const content = String((msg && msg.content) || "");
    if (role === "assistant") {
      const cut = content.indexOf(" ");
      const name = cut >= 0 ? content.slice(0, cut) : content;
      const argsRaw = cut >= 0 ? content.slice(cut + 1) : "";
      let args = null;
      try {
        args = JSON.parse(argsRaw);
      } catch (_) {
        args = null;
      }
      toolCalls.push({
        name,
        arguments_raw: argsRaw,
        arguments: args,
        arguments_valid_json: args !== null,
        llm_index: longestIndex,
      });
    } else if (role === "tool") {
      const f = parseFence(content);
      observations.push({
        source: f.source,
        body: f.body,
        fenced: f.fenced,
        raw: content,
        llm_index: longestIndex,
      });
    }
  }
  return { toolCalls, observations };
}

function allObservationText(trace) {
  return (trace.observations || []).map((o) => o.body).join("\n");
}

function assistantTexts(trace) {
  return (trace.deliveries || []).map((d) => d.text).join("\n");
}

/* ------------------------------------------------------------------ */
/* provider: structured expected sequence + context-sensitive policy   */
/* ------------------------------------------------------------------ */

function normalizeCall(call, index) {
  let args = "";
  if (typeof call.arguments === "string") args = call.arguments;
  else if (call.arguments && typeof call.arguments === "object") args = JSON.stringify(call.arguments);
  return {
    id: String(call.id || `ae-call-${index}`),
    name: String(call.name || ""),
    arguments: args,
  };
}

/**
 * The provider answers one llm_chat at a time.
 *   - scenario.provider.script : array of steps, consumed in order.
 *       { content?: string, calls?: [{name, arguments}] }
 *       { error?: "llm_http_500" } -> provider failed, no content, no calls.
 *   - scenario.provider.policy : (ctx) => step, may look at ctx.messages.
 *       This is what makes a multi-step scenario meaningful: if the kernel
 *       forgets to inject the observation, the policy takes another branch and
 *       the scenario fails for a real reason.
 */
function createProvider(scenario, trace, opts) {
  const cfg = scenario.provider || {};
  const live = opts && opts.live === true;
  const state = { callIndex: 0, live };

  async function next(messages) {
    const index = state.callIndex;
    state.callIndex += 1;
    let step = null;
    if (live) {
      step = await callLiveProvider(messages, opts);
      if (!step) step = { error: "live_provider_empty" };
    } else if (typeof cfg.policy === "function") {
      step = await cfg.policy({ messages, index, scenario, trace });
    } else {
      const script = Array.isArray(cfg.script) ? cfg.script : [];
      step = index < script.length ? script[index] : { content: "", calls: [] };
    }
    step = step || { content: "", calls: [] };
    const calls = Array.isArray(step.calls) ? step.calls.map(normalizeCall) : [];
    const out = {
      index,
      content: String(step.content === undefined || step.content === null ? "" : step.content),
      calls,
      error: step.error ? String(step.error) : null,
      cancel: step.cancel === true,
    };
    if (out.error) {
      // Host honesty rule (GP-165 shape): a provider failure is NOT an answer.
      out.content = "";
      out.calls = [];
      trace.provider_errors = trace.provider_errors || [];
      trace.provider_errors.push({ index, error: out.error });
    }
    return out;
  }

  return { next, state };
}

/* ------------------------------------------------------------------ */
/* live provider (OpenAI-compatible)                                   */
/* ------------------------------------------------------------------ */

function liveProviderConfig(env) {
  const e = env || process.env;
  const base = String(e.BITBOT_LLM_BASE_URL || "").trim();
  const key = String(e.BITBOT_LLM_API_KEY || "").trim();
  const model = String(e.BITBOT_LLM_MODEL || "gpt-4o-mini").trim();
  return { base, key, model, ready: Boolean(base && key) };
}

function postJson(url, body, headers, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const payload = JSON.stringify(body);
    const req = lib.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + (u.search || ""),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${headers.Authorization}`,
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: timeoutMs || 60000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("live provider timeout"));
    });
    req.on("error", (err) => resolve({ status: 0, body: "", error: String(err.message || err) }));
    req.write(payload);
    req.end();
  });
}

async function callLiveProvider(messages, opts) {
  const cfg = liveProviderConfig(opts && opts.env);
  if (!cfg.ready) return { error: "live_provider_not_configured" };
  const convo = [{ role: "system", content: LIVE_SYSTEM_PROMPT }];
  for (const m of messages || []) {
    const role = String((m && m.role) || "user");
    if (role === "assistant") {
      convo.push({ role: "assistant", content: String((m && m.content) || "") });
    } else if (role === "tool") {
      convo.push({ role: "user", content: `[tool result] ${String((m && m.content) || "")}` });
    } else {
      convo.push({ role: "user", content: String((m && m.content) || "") });
    }
  }
  const res = await postJson(
    `${cfg.base.replace(/\/+$/, "")}/chat/completions`,
    {
      model: cfg.model,
      messages: convo,
      temperature: 0,
      stream: false,
      tools: AGENT_LOOP_TOOL_SCHEMA,
    },
    { Authorization: cfg.key },
    (opts && opts.liveTimeoutMs) || 90000,
  );
  if (res.status < 200 || res.status >= 300) {
    return { error: `llm_http_${res.status || 0}` };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(res.body || "{}");
  } catch (_) {
    return { error: "live_provider_bad_json" };
  }
  const choice = (parsed.choices || [])[0] || {};
  const message = choice.message || {};
  const calls = [];
  for (const c of message.tool_calls || []) {
    calls.push({
      id: String((c && c.id) || `live-${calls.length}`),
      name: String((c && c.function && c.function.name) || ""),
      arguments: String((c && c.function && c.function.arguments) || "{}"),
    });
  }
  return { content: String(message.content || ""), calls };
}

/* ------------------------------------------------------------------ */
/* tool host + approval host                                           */
/* ------------------------------------------------------------------ */

function jsonArg(argsRaw, key) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(argsRaw || "{}"));
  } catch (_) {
    return "";
  }
  if (!parsed || typeof parsed !== "object") return "";
  const v = parsed[key];
  return v === undefined || v === null ? "" : String(v);
}

/**
 * The tool host. Read serves scenario fixtures; Shell echoes a marker.
 * A missing file is a tool ERROR, not a fake success — the observation must
 * say so, because "the agent recovers from a failing tool" is a scenario.
 */
function makeToolHost(scenario, trace) {
  const env = (scenario.env || {});
  const files = env.files || {};
  const outputs = env.tool_outputs || {};
  const errors = env.tool_errors || {};
  return {
    exec(name, argsRaw) {
      let out;
      if (Object.prototype.hasOwnProperty.call(errors, name)) {
        out = String(errors[name]);
      } else if (Object.prototype.hasOwnProperty.call(outputs, name)) {
        out = String(outputs[name]);
      } else if (name === "Read" || name === "read" || name === "fs_read") {
        const p = jsonArg(argsRaw, "path");
        if (Object.prototype.hasOwnProperty.call(files, p)) {
          out = String(files[p]);
        } else {
          out = `read: path not found: ${p}`;
        }
      } else if (name === "Shell" || name === "shell") {
        out = `[eval-shell] ${jsonArg(argsRaw, "command")}`;
      } else {
        out = `exec refused: ${name}`;
      }
      trace.tool_execs = trace.tool_execs || [];
      trace.tool_execs.push({ name, arguments_raw: String(argsRaw || ""), output: out });
      return out;
    },
  };
}

function makeApprovalHost(scenario, trace) {
  const env = scenario.env || {};
  const mode = String(env.approval || "allow");
  return {
    request(name, argsRaw) {
      const verdict = mode === "deny" ? "deny" : mode === "cancel" ? "cancel" : "allow";
      trace.approvals = trace.approvals || [];
      trace.approvals.push({ name, arguments_raw: String(argsRaw || ""), verdict });
      return verdict;
    },
  };
}

/* ------------------------------------------------------------------ */
/* backend: kernel (the real AgentLoop::run)                           */
/* ------------------------------------------------------------------ */

function moonEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  const home = process.env.HOME || "";
  env.PATH = `${home}/.moon/bin:${env.PATH || ""}`;
  // The product FFI is a C stub; the LLVM native backend does not link it.
  env.MOONBIT_NEW_NATIVE = "0";
  return env;
}

/**
 * Drive one real kernel turn.
 * Returns a trace with: llm_calls (what the model saw), model tool calls,
 * observations, deliveries, kernel op trace and the kernel's own counters.
 */
function runKernelScenario(scenario, opts) {
  const options = opts || {};
  const moonBin = options.moonBin || process.env.MOON_BIN || "moon";
  const timeoutMs = options.timeoutMs || 120000;
  const prompt = String(scenario.prompt || "").trim();
  const trace = {
    backend: "kernel",
    scenario_id: scenario.id,
    prompt,
    llm_calls: [],
    model_tool_calls: [],
    observations: [],
    deliveries: [],
    kernel_ops: [],
    tool_execs: [],
    approvals: [],
    provider_errors: [],
    turn: null,
    error: null,
  };
  if (!prompt) {
    trace.error = "empty_prompt";
    return Promise.resolve(trace);
  }
  const provider = createProvider(scenario, trace, options);
  const toolHost = makeToolHost(scenario, trace);
  const approvalHost = makeApprovalHost(scenario, trace);

  return new Promise((resolve) => {
    const args = [
      "run",
      "cmd/desktop_turn",
      "--target",
      options.moonTarget || "native",
      "--",
      "--turn-id",
      `eval-${scenario.id}`,
      prompt,
    ];
    let child;
    try {
      child = spawn(moonBin, args, {
        cwd: REPO_ROOT,
        env: moonEnv(options.env),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      trace.error = `spawn_failed: ${err.message || err}`;
      resolve(trace);
      return;
    }
    let stdout = "";
    let stderr = "";
    let buf = "";
    let settled = false;
    let chain = Promise.resolve();
    const started = Date.now();

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      trace.duration_ms = Date.now() - started;
      const lastJson = lastJsonLine(stdout);
      if (lastJson) {
        try {
          trace.turn = JSON.parse(lastJson);
        } catch (err) {
          trace.error = trace.error || `turn_json_invalid: ${err.message}`;
        }
      }
      for (const raw of String(stderr || "").split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith("BITBOT_LOOP op=")) {
          trace.kernel_ops.push(line.slice("BITBOT_LOOP op=".length).trim());
        } else if (line === "BITBOT_LOOP entry=AgentLoop::run") {
          trace.kernel_entry = true;
        }
      }
      const derived = deriveModelActions(trace.llm_calls);
      trace.model_tool_calls = derived.toolCalls;
      trace.observations = derived.observations;
      // Host honesty rule (GP-165 shape): a failed provider call must not be
      // reported as a successful turn.
      if (trace.provider_errors.length) {
        trace.llm_failed = true;
      }
      resolve(trace);
    };

    const timer = setTimeout(() => {
      trace.error = `kernel_timeout_after_${timeoutMs}ms`;
      try {
        child.kill("SIGKILL");
      } catch (_) {
        /* already gone */
      }
      finish();
    }, timeoutMs);

    const handleFfi = (payload) => {
      chain = chain.then(async () => {
        let res;
        try {
          const op = String((payload && payload.op) || "");
          if (op === "llm_chat") {
            const messages = Array.isArray(payload.messages) ? payload.messages : [];
            const step = await provider.next(messages);
            trace.llm_calls.push({
              index: trace.llm_calls.length,
              messages: messages.map((m) => ({ role: String((m && m.role) || ""), content: String((m && m.content) || "") })),
              content: step.content,
              calls: step.calls,
              error: step.error,
            });
            res = {
              content: step.content,
              calls: step.calls,
              cancel: step.cancel ? true : undefined,
            };
          } else if (op === "exec_tool") {
            const name = String((payload && payload.name) || "");
            const argsRaw = String((payload && payload.arguments) || "");
            res = { output: toolHost.exec(name, argsRaw) };
          } else if (op === "request_approval") {
            const name = String((payload && payload.name) || "");
            const argsRaw = String((payload && payload.arguments) || "");
            res = { verdict: approvalHost.request(name, argsRaw) };
          } else if (op === "deliver") {
            const text = String((payload && payload.text) || "");
            trace.deliveries.push({ text });
            res = { ok: true };
          } else {
            res = { content: "", calls: [], output: "", verdict: "deny", error: `unknown_op:${op}` };
          }
        } catch (err) {
          res = { content: "", calls: [], output: "", verdict: "deny", error: String((err && err.message) || err) };
        }
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.write(JSON.stringify(res) + "\n");
        }
      });
    };

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line.startsWith("BITBOT_FFI ")) {
          let payload = null;
          try {
            payload = JSON.parse(line.slice("BITBOT_FFI ".length));
          } catch (_) {
            payload = null;
          }
          if (payload) handleFfi(payload);
        } else {
          stdout += line + "\n";
        }
        nl = buf.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      trace.error = `kernel_spawn_error: ${err.message || err}`;
      finish();
    });
    child.on("close", (code) => {
      if (code !== 0 && !trace.error) {
        trace.error = `kernel_exit_${code}`;
      }
      chain.then(finish).catch(finish);
    });
  });
}

function lastJsonLine(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("{") && lines[i].endsWith("}")) return lines[i];
  }
  return "";
}

/* ------------------------------------------------------------------ */
/* backend: wire (Host product wire, fake FFI)                          */
/* ------------------------------------------------------------------ */

/**
 * Drive hosts/shared/agent_loop_product_wire.js directly with a fake FFI.
 * This is the Host contract: no approval grant means no shell, a forged
 * "approved": true in the arguments means nothing, an unknown tool is
 * refused, and a provider failure is reported as a failure.
 */
function runWireScenario(scenario, opts) {
  const options = opts || {};
  const trace = {
    backend: "wire",
    scenario_id: scenario.id,
    error: null,
    wire_ops: [],
    wire_llm: [],
    provider_errors: [],
  };
  let wire = null;
  try {
    wire = require(path.join(REPO_ROOT, "hosts", "shared", "agent_loop_product_wire.js"));
  } catch (err) {
    trace.error = `wire_module_unavailable: ${err.message || err}`;
    return Promise.resolve(trace);
  }
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eval-wire-"));
  const files = (scenario.env && scenario.env.files) || {};
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(body));
  }
  const providerCfg = (scenario.provider && scenario.provider.script) || [];
  let callIndex = 0;
  const ffi = {
    REPO_ROOT: tmpRoot,
    async executeLlmChat(command, llmOpts) {
      const step = providerCfg[callIndex] || { content: "", calls: [] };
      callIndex += 1;
      trace.wire_llm.push({ command, messages: (llmOpts && llmOpts.messages) || [] });
      if (step.error) {
        trace.provider_errors.push({ index: callIndex - 1, error: String(step.error) });
        return { ok: false, error: String(step.error), stdout: "", stderr: "", tool_calls: [] };
      }
      return {
        ok: true,
        stdout: String(step.content || ""),
        stderr: "",
        tool_calls: (step.calls || []).map((c, i) => ({
          id: String(c.id || `w${i}`),
          name: String(c.name || ""),
          arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments || {}),
        })),
      };
    },
  };
  const session = wire.createProductSession(ffi, {
    turnId: `eval-${scenario.id}`,
    requestApproval: async () => {
      const verdict = String((scenario.env && scenario.env.approval) || "allow");
      return { verdict: verdict === "cancel" ? "cancel" : verdict === "deny" ? "deny" : "allow" };
    },
  });
  const ops = Array.isArray(scenario.wire_ops) ? scenario.wire_ops : [];
  return (async () => {
    for (const op of ops) {
      const req = { op: op.op, name: op.name, arguments: op.arguments, text: op.text };
      let res;
      try {
        res = await session.dispatch(req);
      } catch (err) {
        res = { error: String((err && err.message) || err) };
      }
      trace.wire_ops.push({ request: req, response: res });
    }
    trace.session_state = {
      llmError: String((session.state && session.state.llmError) || ""),
      delivered: String((session.state && session.state.delivered) || ""),
      shellAllowed: Boolean(session.state && session.state.shellAllowed),
    };
    return trace;
  })()
    .catch((err) => {
      trace.error = `wire_error: ${err.message || err}`;
      return trace;
    })
    .finally(() => {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (_) {
        /* best effort */
      }
    });
}

/* ------------------------------------------------------------------ */
/* backend: group (Host group orchestration)                            */
/* ------------------------------------------------------------------ */

function makeGroupFixture(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eval-group-"));
  const desk = path.join(root, "data", "desktop");
  fs.mkdirSync(desk, { recursive: true });
  const bots = (scenario.group && scenario.group.bots) || [
    { id: "bot-a", name: "Alpha", job: "research" },
    { id: "bot-b", name: "Beta", job: "research" },
  ];
  const roomId = (scenario.group && scenario.group.room_id) || "room-eval";
  const members = (scenario.group && scenario.group.members) || bots.map((b) => b.id);
  fs.writeFileSync(
    path.join(desk, "bots.json"),
    JSON.stringify({ version: 1, primary_id: "agent-bit", bots }, null, 2),
  );
  fs.writeFileSync(
    path.join(desk, "rooms.json"),
    JSON.stringify(
      {
        version: 1,
        rooms: [
          {
            id: roomId,
            title: "eval-room",
            members,
            transcript: [],
            created_at: new Date().toISOString(),
          },
        ],
      },
      null,
      2,
    ),
  );
  return { root, roomId, bots, members };
}

/**
 * Drive hosts/desktop/product_surface.js orchestrateRoom / handoffTask with
 * injected responder turns. The engine owns routing, budget, timeout and
 * honest N/total aggregation; the responder turn is injected (same seam the
 * product uses).
 */
function runGroupScenario(scenario, opts) {
  const options = opts || {};
  const trace = {
    backend: "group",
    scenario_id: scenario.id,
    error: null,
    responder_calls: [],
    group: null,
    handoff: null,
  };
  let surface = null;
  try {
    surface = require(path.join(REPO_ROOT, "hosts", "desktop", "product_surface.js"));
  } catch (err) {
    trace.error = `product_surface_unavailable: ${err.message || err}`;
    return Promise.resolve(trace);
  }
  const fixture = makeGroupFixture(scenario);
  const plan = scenario.group || {};
  const responders = plan.responders || {};
  const inst = surface.createProductSurface(fixture.root);
  const deps = {
    timeoutMs: Number(plan.timeout_ms || 5000),
    discretionTimeoutMs: Number(plan.discretion_timeout_ms || 5000),
    async runResponderTurn(botId, task, ctx) {
      trace.responder_calls.push({ bot_id: botId, task, ctx });
      const r = responders[botId] || {};
      if (r.hang) {
        await new Promise((resolve) => setTimeout(resolve, (plan.timeout_ms || 5000) + 500));
      }
      if (r.fail) {
        return { ok: false, error: String(r.error || "responder_failed"), text: "" };
      }
      return { ok: true, text: String(r.text === undefined ? `${botId}: ${task}` : r.text), artifacts: r.artifacts || [] };
    },
    async selectResponders(input) {
      trace.discretion = { input, decided: plan.discretion || [] };
      const decided = plan.discretion || [];
      if (plan.discretion_fail) {
        return { ok: false, error: "discretion_failed" };
      }
      return {
        ok: true,
        responders: decided,
        decisions: (plan.discretion_decisions || []).map((d) => ({
          bot_id: d.bot_id,
          name: d.name || "",
          respond: Boolean(d.respond),
          fail_open: Boolean(d.fail_open),
          error: d.error || null,
        })),
      };
    },
  };
  const input = {
    room: fixture.roomId,
    task: String(plan.task || scenario.prompt || ""),
    policy: plan.policy,
    to: plan.to,
    report: plan.report,
    force: plan.force === true,
    deps,
  };
  return (async () => {
    if (plan.handoff) {
      const h = plan.handoff;
      // handoffTaskAsync is the EXECUTING path: the target bot really runs a
      // turn and its answer lands in the room transcript. The sync
      // handoffTask only records the request, so a gate on "the target bot
      // produced something" has to go through the async one.
      const handoffArgs = {
        room: fixture.roomId,
        from_bot: h.from_bot || "user",
        to_bot: h.to_bot,
        task: String(h.task || "do the thing"),
      };
      if (typeof inst.handoffTaskAsync === "function") {
        trace.handoff = await inst.handoffTaskAsync(handoffArgs, {
          runResponderTurn: deps.runResponderTurn,
          timeoutMs: deps.timeoutMs,
        });
      } else {
        trace.handoff = inst.handoffTask(handoffArgs);
      }
      if (plan.handoff_then_orchestrate) {
        trace.group = await inst.orchestrateRoom(input);
      }
    } else {
      trace.group = await inst.orchestrateRoom(input);
    }
    return trace;
  })()
    .catch((err) => {
      trace.error = `group_error: ${err.message || err}`;
      return trace;
    })
    .finally(() => {
      try {
        fs.rmSync(fixture.root, { recursive: true, force: true });
      } catch (_) {
        /* best effort */
      }
    });
}

/* ------------------------------------------------------------------ */
/* dispatch + judging                                                   */
/* ------------------------------------------------------------------ */

function executeScenario(scenario, opts) {
  const backend = String(scenario.backend || "kernel");
  if (backend === "kernel") return runKernelScenario(scenario, opts);
  if (backend === "wire") return runWireScenario(scenario, opts);
  if (backend === "group") return runGroupScenario(scenario, opts);
  return Promise.resolve({
    backend,
    scenario_id: scenario.id,
    error: `unknown_backend:${backend}`,
  });
}

/**
 * Judge one scenario. The judge returns a list of checks; a scenario passes
 * only if every check passes. A failing check carries the step/tool it is
 * about so a failure can be attributed.
 */
function judgeScenario(scenario, trace) {
  const checks = [];
  try {
    const produced = scenario.judge({ trace, scenario });
    if (Array.isArray(produced)) checks.push(...produced);
    else if (produced) checks.push(produced);
  } catch (err) {
    checks.push(chk("judge_executed", false, `judge threw: ${err.message || err}`));
  }
  const failures = checks.filter((c) => !c.ok);
  return {
    verdict: failures.length === 0 ? "pass" : "fail",
    checks,
    failures,
  };
}

module.exports = {
  REPO_ROOT,
  AGENT_LOOP_TOOL_SCHEMA,
  chk,
  chkEq,
  chkIncludes,
  chkNotIncludes,
  chkAtMost,
  chkAtLeast,
  parseFence,
  deriveModelActions,
  allObservationText,
  assistantTexts,
  liveProviderConfig,
  createProvider,
  runKernelScenario,
  runWireScenario,
  runGroupScenario,
  executeScenario,
  judgeScenario,
};
