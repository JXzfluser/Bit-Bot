"use strict";

/**
 * Live Desktop/cmd chat path.
 * Default user text must enter Kernel AgentLoop::run inside one moon process.
 * Host answers one FFI op at a time. It does not start another llm_chat.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { createTurnRunner } = require(path.join(ROOT, "hosts/shared/run_moon_turn"));
const { createProductSession, legacyGuardedRerunEnabled } = require(
  path.join(ROOT, "hosts/shared/agent_loop_product_wire"),
);

let pass = 0;
let fail = 0;

function ok(name) {
  pass += 1;
  console.log("ok", name);
}

function bad(name, detail) {
  fail += 1;
  console.error("FAIL", name, detail || "");
}

function check(cond, name, detail) {
  if (cond) ok(name);
  else bad(name, detail);
}

function sseTool(name, args, id) {
  const payload = {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: { name, arguments: args },
            },
          ],
        },
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

function sseText(text) {
  const payload = { choices: [{ delta: { content: text } }] };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

function classify(body) {
  const blob = JSON.stringify(body.messages || []);
  if (blob.includes("LEGACY-CHAT")) return { kind: "text", text: "legacy once" };
  if (blob.includes("WP6-FINAL")) return { kind: "text", text: "plain final" };
  if (blob.includes("WP5-LOOP")) {
    return { kind: "tool", name: "Read", arguments: "{\"path\":\"a.txt\"}", id: "c-loop" };
  }
  if (blob.includes("WP4-SHELL") || blob.includes("WP4-ALLOW")) {
    if (blob.includes("[product-shell]")) return { kind: "text", text: "shell ran" };
    if (blob.includes("approval denied") || blob.includes("cursor_untrusted_data")) {
      return { kind: "text", text: "shell stayed off" };
    }
    return {
      kind: "tool",
      name: "Shell",
      arguments: "{\"command\":\"echo hi\",\"approved\":true}",
      id: "c-sh",
    };
  }
  if (blob.includes("cursor_untrusted_data")) return { kind: "text", text: "saw file" };
  if (blob.includes("WP1-READ") || blob.includes("WP2-STREAM")) {
    return { kind: "tool", name: "Read", arguments: "{\"path\":\"a.txt\"}", id: "c-read" };
  }
  return { kind: "text", text: "plain final" };
}

function startStub() {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (_) {
        parsed = {};
      }
      posts.push(parsed);
      const scene = classify(parsed);
      if (parsed.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          scene.kind === "tool"
            ? sseTool(scene.name, scene.arguments, scene.id)
            : sseText(scene.text),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (scene.kind === "tool") {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: scene.id,
                      type: "function",
                      function: { name: scene.name, arguments: scene.arguments },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: scene.text } }],
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, posts, port: addr.port });
    });
  });
}

function assistantText(result) {
  const msgs = (result && result.messages) || [];
  return msgs
    .filter((m) => m && m.role === "assistant")
    .map((m) => String(m.text || ""))
    .join("\n");
}

function sameOps(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function main() {
  const wireSrc = fs.readFileSync(
    path.join(ROOT, "hosts/shared/agent_loop_product_wire.js"),
    "utf8",
  );
  const pumpSrc = fs.readFileSync(path.join(ROOT, "hosts/shared/run_moon_turn.js"), "utf8");
  check(!/\bwhile\b/.test(wireSrc), "WP3 wire module has no while");
  const pumpFn = pumpSrc.slice(
    pumpSrc.indexOf("function pumpMoonFfi"),
    pumpSrc.indexOf("function lastJsonLine"),
  );
  check(pumpFn.includes("BITBOT_FFI "), "pump reads one FFI line");
  check(!pumpFn.includes("tool_calls"), "WP3 pump does not look at tool_calls");
  check(!pumpFn.includes("executeLlmChat"), "WP3 pump does not call the provider");
  check(legacyGuardedRerunEnabled({}) === false, "WP7 guarded re-run default off");
  check(
    legacyGuardedRerunEnabled({ BITBOT_LEGACY_GUARDED_RERUN: "1" }) === true,
    "WP7 guarded re-run flag on",
  );

  const forged = createProductSession({
    async executeLlmChat() {
      throw new Error("exec must not call the model");
    },
  });
  const refused = await forged.dispatch({
    op: "exec_tool",
    name: "Shell",
    arguments: "{\"command\":\"echo hi\",\"approved\":true}",
  });
  check(
    String(refused.output || "").includes("no approval grant"),
    "WP4 in-process forged approved does not run shell",
    refused.output,
  );

  const stub = await startStub();
  process.env.BITBOT_LLM_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
  process.env.BITBOT_LLM_API_KEY = "stub-key";
  process.env.BITBOT_LLM_MODEL = "stub-model";
  process.env.BITBOT_LLM_STREAM = "1";
  process.env.BITBOT_LOOP_READ_JSON = JSON.stringify({ "a.txt": "see b.txt" });
  delete process.env.BITBOT_LOOP_APPROVAL;
  delete process.env.BITBOT_LEGACY_CHAT_EFFECT;
  delete process.env.BITBOT_LEGACY_GUARDED_RERUN;

  const runner = createTurnRunner(ROOT);
  runner.ffi.setLlmStreamHandler(() => {});

  const beforeList = stub.posts.length;
  const listed = await runner.runTurn("ListMachines", { turnId: "wp-list", timeoutMs: 300000 });
  check(listed && listed.ok, "WP7 ListMachines ok", listed && listed.error);
  check(listed.intent === "list_machines", "WP7 ListMachines intent", listed.intent);
  check(listed.agent_loop !== true, "WP7 ListMachines stays off the agent loop");
  check(!(listed.loop_trace && listed.loop_trace.entry), "WP7 no AgentLoop entry");
  check(listed.auto_approved !== true, "WP7 live turn did not auto-approve");
  check(stub.posts.length === beforeList, "WP7 ListMachines did not call the provider");

  const beforeRead = stub.posts.length;
  const readTurn = await runner.runTurn("WP1-READ", { turnId: "wp1", timeoutMs: 180000 });
  const readPosts = stub.posts.slice(beforeRead);
  const trace = readTurn.loop_trace || {};
  check(readTurn.ok, "WP1 turn ok", readTurn.error || readTurn.stderr);
  check(trace.entry === true, "WP1 stderr entry=AgentLoop::run", JSON.stringify(trace));
  check(readTurn.agent_loop === true, "WP1 agent_loop json", readTurn.agent_loop);
  check(readTurn.agent_entry === "open_turn", "WP1 agent_entry open_turn", readTurn.agent_entry);
  check(readTurn.needs_host_ffi === false, "WP1 not a planned host effect");
  check(!Array.isArray(readTurn.effects) || readTurn.effects.length === 0, "WP1 no planned llm_chat effect");
  check(sameOps(trace.kernel_ops, trace.node_ops), "WP3 node ops match kernel ops", JSON.stringify(trace));
  check(
    (trace.kernel_ops || []).filter((op) => op === "llm_chat").length === readPosts.length,
    "WP3 provider calls equal kernel llm_chat ops",
    `posts=${readPosts.length} ops=${JSON.stringify(trace.kernel_ops)}`,
  );
  check(readPosts.length === 2, "WP1 two provider calls", String(readPosts.length));
  check(
    Array.isArray(readPosts[0] && readPosts[0].tools) &&
      JSON.stringify(readPosts[0].tools).includes("Read"),
    "WP1 first provider request carries tools",
  );
  check(
    JSON.stringify(readPosts[1] && readPosts[1].messages).includes("see b.txt") &&
      JSON.stringify(readPosts[1].messages).includes("cursor_untrusted_data"),
    "WP2 second provider call contains the tool observation",
  );
  check(assistantText(readTurn).includes("saw file"), "WP1 delivered final text", assistantText(readTurn));
  check(readTurn.agent_exec === 1, "WP1 one exec", String(readTurn.agent_exec));
  check((trace.kernel_ops || [])[0] === "llm_chat", "WP1 kernel asked for llm_chat first", JSON.stringify(trace.kernel_ops));
  check((trace.kernel_ops || []).includes("exec_tool"), "WP1 kernel asked exec_tool");
  check((trace.kernel_ops || []).includes("deliver"), "WP1 kernel asked deliver");

  const beforeFinal = stub.posts.length;
  const finalTurn = await runner.runTurn("WP6-FINAL", { turnId: "wp6" });
  const finalPosts = stub.posts.slice(beforeFinal);
  check(finalTurn.agent_loop === true && finalTurn.loop_trace && finalTurn.loop_trace.entry, "WP6 entered AgentLoop");
  check(finalPosts.length === 1, "WP6 one provider call", String(finalPosts.length));
  check(finalTurn.agent_exec === 0, "WP6 no exec", String(finalTurn.agent_exec));
  check(assistantText(finalTurn).includes("plain final"), "WP6 delivered assistant text", assistantText(finalTurn));
  check(
    (finalTurn.loop_trace.kernel_ops || []).join(",") === "llm_chat,deliver",
    "WP6 kernel ops",
    JSON.stringify(finalTurn.loop_trace),
  );

  const beforeDeny = stub.posts.length;
  const denyTurn = await runner.runTurn("WP4-SHELL", { turnId: "wp4d" });
  check(denyTurn.agent_exec === 0, "WP4 deny did not exec", String(denyTurn.agent_exec));
  check(denyTurn.agent_approval === 1, "WP4 deny requested approval", String(denyTurn.agent_approval));
  const denyOps = (denyTurn.loop_trace && denyTurn.loop_trace.kernel_ops) || [];
  check(
    !denyOps.includes("exec_tool"),
    "WP4 forged approved did not exec",
    JSON.stringify(denyTurn.loop_trace),
  );
  check(assistantText(denyTurn).includes("shell stayed off"), "WP4 deny final", assistantText(denyTurn));
  check(stub.posts.length === beforeDeny + 2, "WP4 deny two provider calls", String(stub.posts.length - beforeDeny));

  process.env.BITBOT_LOOP_APPROVAL = "allow";
  const allowTurn = await runner.runTurn("WP4-ALLOW", { turnId: "wp4a" });
  delete process.env.BITBOT_LOOP_APPROVAL;
  check(allowTurn.agent_exec === 1, "WP4 allow exec once", String(allowTurn.agent_exec));
  check(assistantText(allowTurn).includes("shell ran"), "WP4 allow final", assistantText(allowTurn));
  check(
    JSON.stringify(stub.posts[stub.posts.length - 1].messages || []).includes("[product-shell] echo hi"),
    "WP4 allow observation reached the provider",
  );

  const beforeLoop = stub.posts.length;
  const loopTurn = await runner.runTurn("WP5-LOOP", { turnId: "wp5", timeoutMs: 180000 });
  const loopPosts = stub.posts.length - beforeLoop;
  check(loopTurn.agent_stop === "MaxSteps", "WP5 stop MaxSteps", loopTurn.agent_stop);
  check(loopTurn.agent_exec === 64, "WP5 exec 64", String(loopTurn.agent_exec));
  check(loopTurn.agent_llm === 64, "WP5 llm 64", String(loopTurn.agent_llm));
  check(loopPosts === 64, "WP5 provider calls stop at 64", String(loopPosts));

  process.env.BITBOT_LEGACY_CHAT_EFFECT = "1";
  const legacy = await runner.runTurn("LEGACY-CHAT", { turnId: "legacy" });
  delete process.env.BITBOT_LEGACY_CHAT_EFFECT;
  check(!(legacy.loop_trace && legacy.loop_trace.entry), "legacy chat does not enter AgentLoop", JSON.stringify(legacy.loop_trace));
  check(legacy.agent_loop !== true, "legacy chat agent_loop false");
  check(
    Array.isArray(legacy.effects) && legacy.effects[0] && legacy.effects[0].kind === "llm_chat",
    "legacy chat still plans one llm_chat",
    JSON.stringify(legacy.effects),
  );

  await new Promise((resolve) => stub.server.close(resolve));
  console.log(`prove_agent_loop_product_wire pass=${pass} fail=${fail}`);
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error("FAIL harness", err && err.stack ? err.stack : err);
  process.exit(1);
});
