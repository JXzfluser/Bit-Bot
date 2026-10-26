"use strict";

/**
 * K-6 gate: a turn leaves a replayable trace.
 *
 * The kernel already recorded every tool call (`runtime.AgentToolTrace`).
 * What was missing: a durable per-turn record, and a way to prove the record
 * is faithful. This gate does both:
 *
 *   1. the turn writes data/traces/<turn_id>.json (tools, args, results, stop)
 *   2. replaying that record — driving a fresh kernel turn with the recorded
 *      tool calls instead of asking the model — produces the SAME tool
 *      sequence
 *
 * The honest scope: the MODEL's decision is recorded but not re-derived
 * (a provider is not deterministic). What is replayable is the TOOL SEQUENCE.
 * So the gate replays the tool sequence and asserts the second trace matches.
 *
 * The provider is a local stub; the kernel and the Host are the real ones.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { createTurnRunner } = require(path.join(ROOT, "hosts/shared/run_moon_turn"));

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log("ok", n); };
const bad = (n, d) => { fail += 1; console.error("FAIL", n, d || ""); };
const check = (c, n, d) => (c ? ok(n) : bad(n, d));

const SECRET = "sk-live-0123456789abcdef";

function sseText(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}

function sseTool(name, args, id) {
  const payload = {
    choices: [
      {
        delta: {
          tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args } }],
        },
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

/** 工具观测在 wire 上的 role 是 "tool"(runtime/agent_context.mbt:AgentRole::wire)。 */
function toolObservations(body) {
  return (Array.isArray(body.messages) ? body.messages : []).filter(
    (m) => m && String(m.role || "") === "tool",
  ).length;
}

function lastUserText(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m && String(m.role || "") === "user") return String(m.content || "");
  }
  return "";
}

let replayPlan = null; // [{name, arguments}]

function classify(body) {
  const seen = toolObservations(body);
  const last = lastUserText(body);
  if (last.includes("TRACE-REPLAY")) {
    if (!replayPlan || seen >= replayPlan.length) {
      return { kind: "text", text: "回放完成" };
    }
    const step = replayPlan[seen];
    return { kind: "tool", name: step.name, arguments: step.arguments, id: `c-replay-${seen}` };
  }
  // 原始回合:先问一次排程,拿到结果再收尾。
  if (last.includes("TRACE-SECRET-TOOL")) {
    // 密钥出现在**工具参数**里 —— trace 是 artifact,不许原样落盘。
    if (seen === 0) {
      return {
        kind: "tool",
        name: "describe_schedule",
        arguments: JSON.stringify({ description: "我的密钥是 " + SECRET }),
        id: "c-secret",
      };
    }
    return { kind: "text", text: "记下了" };
  }
  if (last.includes("TRACE-ORIGINAL")) {
    if (seen === 0) {
      return {
        kind: "tool",
        name: "describe_schedule",
        arguments: JSON.stringify({ description: "每天早上8点" }),
        id: "c-orig",
      };
    }
    return { kind: "text", text: "记下了:每天早上8点" };
  }
  // 别的场景:一句话就收尾,不调工具。
  return { kind: "text", text: "好" };
}

function startStub() {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch (_) { parsed = {}; }
      posts.push(parsed);
      const scene = classify(parsed);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(scene.kind === "tool" ? sseTool(scene.name, scene.arguments, scene.id) : sseText(scene.text));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, posts, port: server.address().port });
    });
  });
}

function findKernelBinary() {
  const env = String(process.env.BITBOT_KERNEL_BIN || "").trim();
  if (env && fs.existsSync(env)) return env;
  for (const profile of ["debug", "release"]) {
    for (const name of ["desktop_turn", "desktop_turn.exe"]) {
      const p = path.join(ROOT, "_build", "native", profile, "build", "cmd", "desktop_turn", name);
      if (fs.existsSync(p)) return p;
    }
  }
  return "";
}

function readTrace(dataRoot, turnId) {
  const file = path.join(dataRoot, "traces", String(turnId).replace(/[^A-Za-z0-9._-]/g, "_") + ".json");
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
}

async function main() {
  const kernelBin = findKernelBinary();
  if (!kernelBin) {
    console.error("FAIL K6-0 — no compiled kernel found. Run `moon build --target native`.");
    process.exit(1);
  }
  process.env.BITBOT_KERNEL_BIN = kernelBin;

  const stub = await startStub();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-k6-"));
  const dataRoot = path.join(tmpRoot, "data");
  fs.mkdirSync(dataRoot, { recursive: true });

  process.env.BITBOT_LLM_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
  process.env.BITBOT_LLM_API_KEY = "stub-key";
  process.env.BITBOT_LLM_MODEL = "stub-model";
  process.env.BITBOT_LLM_STREAM = "1";
  delete process.env.BITBOT_LEGACY_CHAT_EFFECT;

  const runner = createTurnRunner(ROOT, { dataRoot });
  runner.ffi.setLlmStreamHandler(() => {});

  // ---- K6-1: 回合留下了一条 trace ------------------------------------
  const T1 = "k6-turn-1";
  await runner.runTurn("TRACE-ORIGINAL 帮我把每天早上8点排上", {
    turnId: T1,
    botId: "bot-A",
    sessionId: "k6-sess-1",
    timeoutMs: 300000,
  });
  const t1 = readTrace(dataRoot, T1);
  check(!!t1, "K6-1 回合写出了 data/traces/<turn_id>.json");
  if (!t1) {
    console.log("prove_trace_replay pass=" + pass + " fail=" + (fail + 1));
    process.exit(1);
  }
  check(t1.tools.length === 1, "K6-1 trace 里有一次工具调用", t1.tools.length);
  check(
    t1.tools[0] && t1.tools[0].tool_name === "describe_schedule",
    "K6-1 trace 记下了工具名",
    JSON.stringify((t1.tools[0] || {}).tool_name),
  );
  check(
    String((t1.tools[0] || {}).args_json || "").includes("每天早上8点"),
    "K6-1 trace 记下了工具参数",
    String((t1.tools[0] || {}).args_json || ""),
  );
  check(t1.agent_stop !== "", "K6-1 trace 记下了停止原因", t1.agent_stop);
  check(String(t1.user_text || "").includes("TRACE-ORIGINAL"), "K6-1 trace 记下了这回合的输入");
  check(String(t1.assistant_text || "").length > 0, "K6-1 trace 记下了这回合的交付");

  // ---- K6-2: 拿这条 trace 回放,工具序列必须一样 -----------------------
  replayPlan = (t1.tools || []).map((t) => ({
    name: t.tool_name,
    arguments: t.args_json,
  }));
  const T2 = "k6-turn-2";
  await runner.runTurn("TRACE-REPLAY 重放上一回合", {
    turnId: T2,
    botId: "bot-A",
    // 换一个会话:否则上一回合的观测会混进 payload,计数就不对了。
    sessionId: "k6-sess-2",
    timeoutMs: 300000,
  });
  const t2 = readTrace(dataRoot, T2);
  check(!!t2, "K6-2 回放回合也写出了 trace");
  const seq1 = (t1.tools || []).map((t) => t.tool_name + " " + t.args_json).join(" | ");
  const seq2 = ((t2 && t2.tools) || []).map((t) => t.tool_name + " " + t.args_json).join(" | ");
  check(seq2 === seq1, "K6-2 回放出来的工具序列和原回合一致", seq2 + "  vs  " + seq1);

  // ---- K6-3: trace 记的是「真调用过什么」,不是「模型可能会调什么」 --
  // 把记录的参数改掉,回放出来的参数就跟着变 ⇒ 记录是事实,不是猜测。
  const tampered = JSON.parse(JSON.stringify(t1));
  tampered.tools[0].args_json = JSON.stringify({ description: "每周一9点" });
  replayPlan = tampered.tools.map((t) => ({ name: t.tool_name, arguments: t.args_json }));
  const T3 = "k6-turn-3";
  await runner.runTurn("TRACE-REPLAY 重放改过的记录", {
    turnId: T3,
    botId: "bot-A",
    sessionId: "k6-sess-3",
    timeoutMs: 300000,
  });
  const t3 = readTrace(dataRoot, T3);
  check(
    String(((((t3 && t3.tools) || [])[0] || {}).args_json) || "").includes("每周一9点"),
    "K6-3 trace 是事实记录:改了记录,回放就跟着变",
    String(((((t3 && t3.tools) || [])[0] || {}).args_json) || ""),
  );

  // ---- K6-4: trace 是 artifact —— 密钥不许原样落盘 --------------------
  // 密钥出现在工具参数里(用户消息里的密钥会被内核直接拒收 —— 那是另一道门)。
  const T4 = "k6-turn-4";
  await runner.runTurn("TRACE-SECRET-TOOL 帮我排个程", {
    turnId: T4,
    botId: "bot-A",
    sessionId: "k6-sess-4",
    timeoutMs: 300000,
  });
  const t4raw = fs.existsSync(path.join(dataRoot, "traces", T4 + ".json"))
    ? fs.readFileSync(path.join(dataRoot, "traces", T4 + ".json"), "utf8")
    : "";
  check(!!t4raw, "K6-4 第四个回合也写出了 trace");
  check(!t4raw.includes(SECRET), "K6-4 trace 里没有原样的密钥", t4raw.slice(0, 200));
  check(
    t4raw.includes("[REDACTED]"),
    "K6-4 密钥在 trace 里被替换成了占位符",
    t4raw.slice(0, 200),
  );

  // ---- K6-5: 没有工具调用的回合不写 trace(不产空壳文件) -------------
  const T5 = "k6-turn-5";
  const before5 = fs.existsSync(path.join(dataRoot, "traces", T5 + ".json"));
  await runner.runTurn("TRACE-PLAIN 随口一句", {
    turnId: T5,
    botId: "bot-A",
    sessionId: "k6-sess-5",
    timeoutMs: 300000,
  });
  const after5 = fs.existsSync(path.join(dataRoot, "traces", T5 + ".json"));
  check(!before5 && !after5, "K6-5 没有工具调用的回合不写 trace(不产空壳记录)");

  console.log("prove_trace_replay pass=" + pass + " fail=" + fail);
  try { stub.server.close(); } catch (_) {}
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("prove_trace_replay crashed — " + String((e && e.stack) || e));
  console.log("prove_trace_replay pass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
