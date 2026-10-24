"use strict";

/**
 * PP1–PP7. Labels are isomorphic with
 * docs/agent-core/01-agent-loop-production-provider.md §4.
 * Not an I promotion. Does not close AR-01/02/03/15.
 * Does not claim Desktop Agent Loop MVP.
 * Legacy BITBOT_LEGACY_CHAT_EFFECT=1 is not evidence.
 * No key or forced offline exits NEEDS_LIVE or BLOCKED, never a stub PASS.
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const p0 = require("../hosts/shared/p0_security");
const { createHostFfi } = require("../hosts/shared/host_ffi");
const { createTurnRunner, moonProcessEnv } = require("../hosts/shared/run_moon_turn");

const ROOT = path.resolve(__dirname, "..");
const DOC = path.join(ROOT, "docs/agent-core/01-agent-loop-production-provider.md");
const SELF = path.join(ROOT, "scripts/prove_production_provider.js");
const DUMMY_OFFLINE_KEY = "pp-offline-not-a-live-key";
const OFFLINE_HOST = "bitbot-pp-offline.invalid";

const BINDING = [
  ["PP1", "live AgentLoop llm_chat hits external base_url (entry=AgentLoop::run)"],
  ["PP2", "first request tools non-empty"],
  ["PP3", "tool_calls → Kernel Call/exec_tool (not Host self-loop second llm_chat)"],
  ["PP4", "after Observe, next provider request includes fence/untrusted observation (or Finish without dropping observation)"],
  ["PP5", "tee/artifact/printenv child has no key plaintext; Authorization redacted"],
  ["PP6", "no key / forced offline → NEEDS_LIVE or BLOCKED, exit ≠ 0"],
  ["PP7", "regression note — A/WP/EG/P0/AU/SK not regressed; P0-3 still U-only; no MVP claim"],
];

let pass = 0;
let fail = 0;
const seen = new Set();
let section4 = "";

function secretValues() {
  const out = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (
      name === "BITBOT_LLM_API_KEY" ||
      /^BITBOT_LLM_.+(?:_KEY|_TOKEN|_SECRET)$/i.test(name)
    ) {
      out.push(String(value));
    }
  }
  return out;
}

function leaks(text) {
  const s = String(text == null ? "" : text);
  if (s.includes(DUMMY_OFFLINE_KEY)) return true;
  return secretValues().some((value) => value && s.includes(value));
}

function say(line) {
  const text = String(line);
  if (leaks(text)) {
    process.stdout.write("FAIL PP5 refused to print a secret\n");
    process.exit(1);
  }
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

function ok(line) {
  pass += 1;
  seen.add(String(line).split(/\s+/)[0]);
  say("ok " + line);
}

function bad(line) {
  fail += 1;
  seen.add(String(line).split(/\s+/)[0]);
  say("FAIL " + line);
}

function note(line) {
  say("note " + line);
}

function assert(cond, message) {
  if (!cond) throw new Error(message || "assertion failed");
}

function bindingLine(id) {
  const row = BINDING.find((item) => item[0] === id);
  const line = row[0] + " " + row[1];
  if (!section4.includes(line)) throw new Error("Binding §4 missing " + line);
  return line;
}

function isLoopback(host) {
  const h = String(host || "").toLowerCase();
  return (
    h === "127.0.0.1" ||
    h === "localhost" ||
    h === "::1" ||
    h === "[::1]" ||
    h === "0.0.0.0"
  );
}

function hostOf(base) {
  const raw = String(base || "").trim();
  const withProto = raw.includes("://") ? raw : "https://" + raw;
  return new URL(withProto).hostname.toLowerCase();
}

function stripLlmKeys(env) {
  for (const name of Object.keys(env)) {
    if (
      name === "BITBOT_LLM_API_KEY" ||
      /^BITBOT_LLM_.+(?:_KEY|_TOKEN|_SECRET)$/i.test(name)
    ) {
      delete env[name];
    }
  }
}

function tapHttp(records) {
  for (const mod of [http, https]) {
    if (mod.request && mod.request.__ppTap) continue;
    const orig = mod.request;
    function wrapped(options, callback) {
      const opts = options && typeof options === "object" ? options : {};
      const rec = {
        host: String(opts.hostname || opts.host || "")
          .replace(/:\d+$/, "")
          .toLowerCase(),
        path: String(opts.path || ""),
        protocol: String(opts.protocol || ""),
        authorization: "Bearer [redacted]",
        body: "",
      };
      records.push(rec);
      const req = orig.call(mod, options, callback);
      const origWrite = req.write;
      req.write = function (chunk, enc, cb) {
        try {
          if (chunk != null) {
            rec.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
          }
        } catch (_) {
          /* forwarding still happens */
        }
        return origWrite.call(req, chunk, enc, cb);
      };
      return req;
    }
    wrapped.__ppTap = true;
    mod.request = wrapped;
  }
}

function llmRecords(records) {
  return records.filter((rec) => String(rec.path || "").includes("chat/completions"));
}

function loadBinding() {
  const bindingDoc = fs.readFileSync(DOC, "utf8");
  const secAt = bindingDoc.indexOf("## 4. Binding");
  const secEnd = bindingDoc.indexOf("\n## ", secAt + 4);
  section4 = bindingDoc.slice(secAt, secEnd === -1 ? undefined : secEnd);
  assert(secAt >= 0 && section4.includes("PP7 "), "Binding §4 missing");
  for (const row of BINDING) bindingLine(row[0]);
}

function assertProductSources() {
  const wire = fs.readFileSync(
    path.join(ROOT, "hosts/shared/agent_loop_product_wire.js"),
    "utf8",
  );
  const native = fs.readFileSync(
    path.join(ROOT, "cmd/desktop_turn/agent_loop_product_native.mbt"),
    "utf8",
  );
  const runner = fs.readFileSync(path.join(ROOT, "hosts/shared/run_moon_turn.js"), "utf8");
  const host = fs.readFileSync(path.join(ROOT, "hosts/shared/host_ffi.js"), "utf8");
  assert(wire.includes("executeLlmChat"), "product wire missing executeLlmChat");
  assert(!/\bwhile\s*\(/.test(wire), "product wire loops the model");
  assert(native.includes("AgentLoop::run"), "kernel entry missing");
  assert(native.includes("open_turn"), "open_turn missing");
  assert(native.includes("BITBOT_LEGACY_CHAT_EFFECT"), "legacy flag missing");
  assert(runner.includes("createProductSession"), "runner missing product session");
  assert(runner.includes("moonProcessEnv"), "moon child env helper missing");
  assert(host.includes("providerHttpWitness"), "redacted provider witness missing");
  assert(host.includes('authorization: "Bearer [redacted]"'), "auth not redacted");

  const planted = "planted-key-value-0123456789";
  const moonEnv = moonProcessEnv({
    HOME: "/tmp",
    PATH: "/usr/bin",
    BITBOT_LLM_API_KEY: planted,
    BITBOT_LLM_QWEN_API_KEY: "qwen-planted-key-0123456789",
    BITBOT_TZ: "Asia/Shanghai",
  });
  assert(!moonEnv.BITBOT_LLM_API_KEY, "moon child kept BITBOT_LLM_API_KEY");
  assert(!moonEnv.BITBOT_LLM_QWEN_API_KEY, "moon child kept the qwen key");
  assert(moonEnv.BITBOT_TZ === "Asia/Shanghai", "moon child dropped a non-secret");

  const childEnv = p0.shellChildEnv({
    PATH: process.env.PATH || "/usr/bin",
    HOME: process.env.HOME || "/tmp",
    BITBOT_LLM_API_KEY: planted,
    BITBOT_TURN_TOKEN: "turn-planted-token-0123456789",
  });
  const printed = execFileSync("/bin/bash", ["-lc", "printenv"], {
    env: childEnv,
    encoding: "utf8",
  });
  assert(!printed.includes(planted), "printenv child kept the planted key");
  assert(!printed.includes("BITBOT_LLM_API_KEY"), "printenv child kept the key name");
  assert(!printed.includes("turn-planted-token-0123456789"), "printenv child kept the turn token");
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (st.isFile()) out.push(full);
  }
  return out;
}

function restoreActive(active, backup, moved) {
  if (!moved) return false;
  try {
    if (fs.existsSync(backup)) fs.renameSync(backup, active);
  } catch (_) {
    /* caller still exits */
  }
  return false;
}

async function noKeyMode() {
  stripLlmKeys(process.env);
  delete process.env.BITBOT_LEGACY_CHAT_EFFECT;
  const active = path.join(ROOT, "data/llm/active.json");
  const backup = active + ".pp-nokey-bak";
  let moved = false;
  if (fs.existsSync(active)) {
    fs.renameSync(active, backup);
    moved = true;
  }
  try {
    const records = [];
    tapHttp(records);
    const ffi = createHostFfi(ROOT);
    const cfg = ffi.resolveLlmConfig();
    if (cfg.key_configured || cfg.api_key) {
      moved = restoreActive(active, backup, moved);
      say("FAIL no-key gate still configured source=" + String(cfg.key_source || ""));
      process.exit(1);
    }
    const res = await ffi.executeLlmChat("ping", { agentLoopTools: true });
    const dumped = JSON.stringify(res || {});
    if (leaks(dumped) || (res && res.ok) || String((res && res.stdout) || "").length) {
      moved = restoreActive(active, backup, moved);
      say("FAIL no-key executeLlmChat pretended a reply");
      process.exit(1);
    }
    if (llmRecords(records).length) {
      moved = restoreActive(active, backup, moved);
      say("FAIL no-key mode sent provider HTTP");
      process.exit(1);
    }
  } catch (err) {
    moved = restoreActive(active, backup, moved);
    if (!leaks(err && err.stack)) say("FAIL no-key mode " + (err && err.message ? err.message : "error"));
    else say("FAIL no-key mode");
    process.exit(1);
  }
  moved = restoreActive(active, backup, moved);
  say("NEEDS_LIVE");
  process.exit(2);
}

async function offlineMode() {
  stripLlmKeys(process.env);
  process.env.BITBOT_LLM_PROVIDER = "deepseek";
  process.env.BITBOT_LLM_BASE_URL = "https://" + OFFLINE_HOST + "/v1";
  process.env.BITBOT_LLM_API_KEY = DUMMY_OFFLINE_KEY;
  process.env.BITBOT_LLM_TIMEOUT_MS = "8000";
  process.env.BITBOT_LLM_STREAM = "0";
  delete process.env.BITBOT_LEGACY_CHAT_EFFECT;
  const trace = path.join(os.tmpdir(), "pp-offline-" + process.pid + ".jsonl");
  process.env.BITBOT_LLM_HTTP_TRACE = trace;
  const records = [];
  tapHttp(records);
  const ffi = createHostFfi(ROOT);
  let res;
  try {
    res = await ffi.executeLlmChat("ping", { agentLoopTools: true });
  } catch (err) {
    if (!leaks(err && err.message)) say("FAIL offline executeLlmChat threw");
    else say("FAIL offline executeLlmChat threw");
    process.exit(1);
  }
  const dumped = JSON.stringify(res || {});
  const traceText = fs.existsSync(trace) ? fs.readFileSync(trace, "utf8") : "";
  let artifactText = "";
  if (res && res.artifact_path && fs.existsSync(res.artifact_path)) {
    artifactText = fs.readFileSync(res.artifact_path, "utf8");
  }
  const blob = dumped + "\n" + traceText + "\n" + artifactText;
  try {
    fs.unlinkSync(trace);
  } catch (_) {
    /* temp trace is best-effort */
  }
  if (leaks(blob) || /Bearer\s+(?!\[redacted\])\S+/i.test(artifactText + traceText)) {
    say("FAIL offline artifact leaked key");
    process.exit(1);
  }
  const hits = llmRecords(records);
  if (!hits.length || hits.some((rec) => isLoopback(rec.host) || rec.host !== OFFLINE_HOST)) {
    say("FAIL offline did not hit the forced external host");
    process.exit(1);
  }
  if (!res || res.ok || String(res.stdout || "").length) {
    say("FAIL offline executeLlmChat returned a completion");
    process.exit(1);
  }
  if (artifactText && !artifactText.includes("Bearer [redacted]")) {
    say("FAIL offline artifact missing redacted Authorization");
    process.exit(1);
  }
  if (artifactText && artifactText.includes('"pretend_completion": true')) {
    say("FAIL offline artifact pretended a completion");
    process.exit(1);
  }
  say("BLOCKED");
  process.exit(3);
}

function spawnMode(mode) {
  const env = { ...process.env };
  delete env.BITBOT_PP_MODE;
  delete env.BITBOT_LLM_HTTP_TRACE;
  delete env.BITBOT_LEGACY_CHAT_EFFECT;
  delete env.BITBOT_LOOP_READ_JSON;
  stripLlmKeys(env);
  if (mode === "no-key") {
    env.BITBOT_PP_MODE = "no-key";
  } else {
    env.BITBOT_PP_MODE = "offline";
    env.BITBOT_LLM_PROVIDER = "deepseek";
    env.BITBOT_LLM_BASE_URL = "https://" + OFFLINE_HOST + "/v1";
    env.BITBOT_LLM_API_KEY = DUMMY_OFFLINE_KEY;
    env.BITBOT_LLM_TIMEOUT_MS = "8000";
    env.BITBOT_LLM_STREAM = "0";
  }
  return spawnSync(process.execPath, [SELF], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 25000,
  });
}

function childProves(mode, res) {
  const out = String((res && res.stdout) || "");
  const err = String((res && res.stderr) || "");
  const blob = out + "\n" + err;
  if (leaks(blob)) return false;
  if (out.includes("ok PP1") || out.includes("pass=7")) return false;
  if (mode === "no-key") {
    return res.status === 2 && /(^|\n)NEEDS_LIVE(\n|$)/.test(out);
  }
  return (
    res.status !== 0 &&
    res.status !== null &&
    /(^|\n)BLOCKED(\n|$)/.test(out) &&
    !/(^|\n)NEEDS_LIVE(\n|$)/.test(out)
  );
}

function proveNegativeChildren() {
  const noKey = spawnMode("no-key");
  const offline = spawnMode("offline");
  const noKeyOk = childProves("no-key", noKey);
  const offlineOk = childProves("offline", offline);
  if (!noKeyOk || !offlineOk) {
    say(
      "FAIL PP6 children no-key=" +
        String(noKey && noKey.status) +
        " offline=" +
        String(offline && offline.status),
    );
    return false;
  }
  note("PP6 no-key child exit=" + noKey.status + " NEEDS_LIVE");
  note("PP6 offline child exit=" + offline.status + " BLOCKED");
  return true;
}

function gateOf(cfg) {
  if (!cfg || !cfg.key_configured || !cfg.api_key) return { code: "NEEDS_LIVE", exit: 2 };
  let host = "";
  try {
    host = hostOf(cfg.base_url);
  } catch (_) {
    host = "";
  }
  if (!host || isLoopback(host)) return { code: "BLOCKED", exit: 3 };
  return null;
}

function readNewArtifacts(beforeTurns, chatsBefore) {
  const dir = path.join(ROOT, "data/llm/turns");
  const files = listFiles(dir).filter((file) => !beforeTurns.has(file));
  const chats = path.join(ROOT, "data/llm/chats.jsonl");
  let chatSlice = "";
  if (fs.existsSync(chats)) {
    const raw = fs.readFileSync(chats, "utf8");
    chatSlice = raw.slice(chatsBefore);
  }
  return { files, chatSlice };
}

function httpStatuses(files) {
  const rows = [];
  for (const file of files) {
    const parsed = readJsonSafe(file);
    if (parsed && parsed.mode === "host_llm_chat") rows.push(parsed);
  }
  return rows;
}

function networkFailure(rows) {
  if (!rows.length) return false;
  const net = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|ECONNRESET|timeout|socket/i;
  return rows.every((row) => !row.http_status) && rows.some((row) => net.test(String(row.error || "")));
}

function authRedacted(text) {
  const s = String(text || "");
  if (/Bearer\s+(?!\[redacted\])\S+/i.test(s)) return false;
  return s.includes("Bearer [redacted]");
}

function checkPp7() {
  const files = [
    ["docs/qa/agent-loop-a1-a8-gates.md", ["bash scripts/prove_agent_loop_a7_a8.sh", "未关 AR-15", "未宣称 Agent Loop MVP"]],
    ["docs/qa/agent-loop-wp1-wp8-gates.md", ["bash scripts/prove_agent_loop_product_wire.sh", "不得宣称 Desktop Agent Loop MVP", "未关 AR-15"]],
    ["docs/qa/electron-chat-agent-loop-gates.md", ["bash scripts/prove_agent_loop_electron_midrun.sh", "不宣称"]],
    ["docs/qa/p0-security-gates.md", ["P0-3", "不升 I", "U 已绿"]],
    ["docs/qa/host-approval-ui-gates.md", ["bash scripts/prove_host_approval_ui.sh", "P0-3 仍是 U"]],
    ["docs/agent-core/05-security-sandbox-secrets.md", ["ok SK1", "不关 AR-15", "P0-3 未升 I"]],
    ["docs/agent-core/01-agent-loop-production-provider.md", ["不关 AR-01", "不宣称 Desktop Agent Loop MVP", "NEEDS_LIVE"]],
  ];
  for (const [rel, needles] of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const needle of needles) {
      if (!text.includes(needle)) return "missing " + needle + " in " + rel;
    }
  }
  const p0doc = fs.readFileSync(path.join(ROOT, "docs/qa/p0-security-gates.md"), "utf8");
  if (!p0doc.includes("U 已绿，不升 I")) return "P0-3 is not U-only";
  const matrix = fs.readFileSync(path.join(ROOT, "docs/capability-matrix.md"), "utf8");
  if (/AR-0?1|AR-02|AR-03|AR-15/.test(matrix)) return "capability matrix mentions an AR row";
  if (matrix.includes("Desktop Agent Loop MVP")) return "capability matrix claims MVP";
  const readme = fs.readFileSync(path.join(ROOT, "docs/agent-core/README.md"), "utf8");
  for (const id of ["AR-01", "AR-02", "AR-03", "AR-15"]) {
    if (!readme.includes("| " + id + " |")) return "README dropped " + id;
  }
  if (readme.includes("关闭 AR-01") || readme.includes("AR-01 | 已关")) return "README closed AR-01";
  return "";
}

async function live(cfg) {
  const expectedHost = hostOf(cfg.base_url);
  const marker = "PP_OBS_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const rel = "data/tmp/pp-live-read.txt";
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, marker + "\n");
  const trace = path.join(os.tmpdir(), "pp-live-" + process.pid + ".jsonl");
  process.env.BITBOT_LLM_HTTP_TRACE = trace;
  delete process.env.BITBOT_LOOP_READ_JSON;
  delete process.env.BITBOT_MOBILE_HOST;
  process.env.BITBOT_PP_CAPTURE_STDERR = "1";
  const turnsDir = path.join(ROOT, "data/llm/turns");
  const beforeTurns = new Set(listFiles(turnsDir));
  const chatsPath = path.join(ROOT, "data/llm/chats.jsonl");
  const chatsBefore = fs.existsSync(chatsPath) ? fs.statSync(chatsPath).size : 0;
  const records = [];
  tapHttp(records);
  const ffi = createHostFfi(ROOT);
  ffi.setLlmStreamHandler(() => {});
  const runner = createTurnRunner(ROOT);
  const prompt =
    "Please use the Read tool exactly once on path " +
    rel +
    ". After the tool result arrives, reply with exactly DONE. Do not answer before the tool result.";
  let result;
  try {
    result = await runner.runTurn(prompt, { timeoutMs: 180000, turnId: "pp-live" });
  } catch (err) {
    const msg = String((err && err.message) || err);
    ffi.setLlmStreamHandler(null);
    try {
      fs.unlinkSync(abs);
    } catch (_) {
      /* fixture cleanup */
    }
    if (/ENOENT/.test(msg) && /moon/i.test(msg)) {
      say("BLOCKED");
      note("moon toolchain missing");
      say("prove_production_provider BLOCKED");
      process.exit(3);
    }
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|ECONNRESET/i.test(msg)) {
      say("BLOCKED");
      say("prove_production_provider BLOCKED");
      process.exit(3);
    }
    if (!leaks(msg)) say("FAIL live turn");
    else say("FAIL live turn");
    process.exit(1);
  }
  ffi.setLlmStreamHandler(null);
  try {
    fs.unlinkSync(abs);
  } catch (_) {
    /* fixture cleanup */
  }

  const fresh = readNewArtifacts(beforeTurns, chatsBefore);
  const rows = httpStatuses(fresh.files);
  if (networkFailure(rows)) {
    say("BLOCKED");
    say("prove_production_provider BLOCKED");
    process.exit(3);
  }
  const hits = llmRecords(records);
  const traceText = fs.existsSync(trace) ? fs.readFileSync(trace, "utf8") : "";
  try {
    fs.unlinkSync(trace);
  } catch (_) {
    /* temp trace */
  }

  const k = (result && result.loop_trace && result.loop_trace.kernel_ops) || [];
  const n = (result && result.loop_trace && result.loop_trace.node_ops) || [];
  const opsEqual = k.length === n.length && k.every((op, i) => op === n[i]);
  const llmOps = k.filter((op) => op === "llm_chat");
  const external =
    hits.length > 0 &&
    hits.every((rec) => rec.host === expectedHost && !isLoopback(rec.host));
  const traceAgrees =
    traceText.includes(expectedHost) &&
    !traceText.includes("127.0.0.1") &&
    !traceText.includes("localhost");
  const pp1 =
    result &&
    result.agent_loop === true &&
    result.agent_entry === "open_turn" &&
    result.loop_trace &&
    result.loop_trace.entry === true &&
    result.needs_host_ffi === false &&
    external &&
    traceAgrees &&
    rows.every((row) => row.pretend_completion === false && row.localbrain === false) &&
    rows.some((row) => row.http_status >= 200 && row.http_status < 300);

  let toolsOk = false;
  try {
    const first = JSON.parse(hits[0].body || "{}");
    toolsOk = Array.isArray(first.tools) && first.tools.length > 0;
  } catch (_) {
    toolsOk = false;
  }

  const execAt = k.indexOf("exec_tool");
  const firstLlm = k.indexOf("llm_chat");
  const pp3 =
    opsEqual &&
    execAt > firstLlm &&
    llmOps.length === hits.length &&
    llmOps.length >= 1;

  let llmIdx = -1;
  let seenExec = false;
  let nextHadFence = false;
  for (const op of k) {
    if (op === "llm_chat") {
      llmIdx += 1;
      if (seenExec && !nextHadFence) {
        const body = (hits[llmIdx] && hits[llmIdx].body) || "";
        nextHadFence =
          (body.includes("cursor_untrusted_data") || body.includes("untrusted")) &&
          body.includes(marker);
      }
    } else if (op === "exec_tool") {
      seenExec = true;
    }
  }
  const lastBody = (hits[hits.length - 1] && hits[hits.length - 1].body) || "";
  const finishKeeps =
    result.agent_stop !== "Final" ||
    ((lastBody.includes("cursor_untrusted_data") || lastBody.includes("untrusted")) &&
      lastBody.includes(marker));
  const pp4 = seenExec && nextHadFence && finishKeeps;

  const artifactBlob = fresh.files.map((file) => fs.readFileSync(file, "utf8")).join("\n") + fresh.chatSlice;
  const stderr = String((result && result.loop_trace && result.loop_trace.stderr) || "");
  const printed = execFileSync("/bin/bash", ["-lc", "printenv"], {
    env: p0.shellChildEnv(process.env),
    encoding: "utf8",
  });
  const pp5 =
    !leaks(artifactBlob) &&
    !leaks(traceText) &&
    !leaks(stderr) &&
    !leaks(printed) &&
    !printed.includes("BITBOT_LLM_API_KEY") &&
    authRedacted(artifactBlob) &&
    authRedacted(traceText) &&
    hits.every((rec) => rec.authorization === "Bearer [redacted]" && !leaks(rec.body));

  const pp7reason = checkPp7();
  const statuses = rows.map((row) => row.http_status);
  if (statuses.some((code) => code === 401 || code === 403)) {
    say("FAIL provider rejected the configured key");
    process.exit(1);
  }

  if (pp1) ok(bindingLine("PP1"));
  else bad(bindingLine("PP1"));
  if (toolsOk) ok(bindingLine("PP2"));
  else bad(bindingLine("PP2"));
  if (pp3) ok(bindingLine("PP3"));
  else bad(bindingLine("PP3"));
  if (pp4) ok(bindingLine("PP4"));
  else bad(bindingLine("PP4"));
  if (pp5) ok(bindingLine("PP5"));
  else bad(bindingLine("PP5"));
  ok(bindingLine("PP6"));
  if (!pp7reason) ok(bindingLine("PP7"));
  else bad(bindingLine("PP7") + " " + pp7reason);
}

function finishSummary() {
  for (const row of BINDING) {
    if (!seen.has(row[0])) {
      fail += 1;
      say("FAIL " + row[0] + " missing");
    }
  }
  say(
    "PP evidence does not close AR-01/02/03/15. P0-3 stays U. not I. not Desktop Agent Loop MVP.",
  );
  say("prove_production_provider pass=" + pass + " fail=" + fail);
  process.exit(fail === 0 ? 0 : 1);
}

async function main() {
  loadBinding();
  assertProductSources();
  if (String(process.env.BITBOT_LEGACY_CHAT_EFFECT || "") === "1" && !process.env.BITBOT_PP_MODE) {
    say("FAIL legacy BITBOT_LEGACY_CHAT_EFFECT=1 is not PP evidence");
    process.exit(1);
  }
  if (process.env.BITBOT_PP_MODE === "no-key") {
    await noKeyMode();
    return;
  }
  if (process.env.BITBOT_PP_MODE === "offline") {
    await offlineMode();
    return;
  }

  const childrenOk = proveNegativeChildren();
  if (!childrenOk) {
    say("prove_production_provider pass=0 fail=1");
    process.exit(1);
  }
  const pp7reason = checkPp7();
  if (pp7reason) {
    say("FAIL PP7 " + pp7reason);
    say("prove_production_provider pass=0 fail=1");
    process.exit(1);
  }

  const ffi = createHostFfi(ROOT);
  const cfg = ffi.resolveLlmConfig();
  const gate = gateOf(cfg);
  if (gate) {
    if (gate.code === "BLOCKED") note("loopback base_url is not production provider evidence");
    say(gate.code);
    note("operator live PP1-PP4: docs/agent-core/01-agent-loop-production-provider.md");
    say("prove_production_provider " + gate.code);
    process.exit(gate.exit);
  }
  await live(cfg);
  finishSummary();
}

main().catch((err) => {
  const msg = String((err && err.stack) || err);
  if (!leaks(msg)) process.stderr.write(msg + "\n");
  else process.stderr.write("FAIL prove crashed\n");
  process.stdout.write("prove_production_provider pass=0 fail=1\n");
  process.exit(1);
});
