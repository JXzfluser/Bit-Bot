"use strict";

/**
 * A7: Host streaming must keep tool_calls (not only delta.content).
 * A8: content-only stream and non-stream replies still come back intact.
 *
 * Drives the real executeHostEffects → executeLlmChat → httpJsonStream path
 * against a local stub. No model loop.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { createHostFfi } = require(path.join(ROOT, "hosts/shared/host_ffi"));
const agentLoopFfi = require(path.join(ROOT, "hosts/shared/agent_loop_ffi"));

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

function writeChunks(res, text, size) {
  let i = 0;
  function more() {
    if (i >= text.length) {
      res.end();
      return;
    }
    const n = Math.min(size, text.length - i);
    res.write(text.slice(i, i + n));
    i += n;
    setImmediate(more);
  }
  more();
}

function sse(lines) {
  return lines.join("\n") + "\n";
}

function startStub() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      let user = "";
      try {
        const parsed = JSON.parse(body || "{}");
        const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
        const last = msgs[msgs.length - 1] || {};
        user = String(last.content || "");
      } catch (_) {
        user = "";
      }
      if (user === "A7-SPLIT") {
        const payload = sse([
          'data: {"choices":[{"delta":{"content":"Hi","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Read","arguments":"{\\"pa"}}]}}]}',
          "",
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.txt\\"}"}}]}}]}',
          "",
          'data: {"usage":{"prompt_tokens":2,"completion_tokens":3}}',
          "",
          "data: [DONE]",
          "",
        ]);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        writeChunks(res, payload, 9);
        return;
      }
      if (user === "A7-TOOLS-ONLY") {
        const payload = sse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","function":{"name":"Read","arguments":"{}"}}]}}]}',
          "",
          "data: [DONE]",
          "",
        ]);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        writeChunks(res, payload, 7);
        return;
      }
      if (user === "A8-CONTENT") {
        const payload = sse([
          'data: {"choices":[{"delta":{"content":"Hello "}}]}',
          "",
          'data: {"choices":[{"delta":{"content":"world"}}]}',
          "",
          "data: [DONE]",
          "",
        ]);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        writeChunks(res, payload, 8);
        return;
      }
      if (user === "A8-NONSTREAM") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { role: "assistant", content: "plain answer" },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        );
        return;
      }
      if (user === "A7-NONSTREAM-TOOLS") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_2",
                      type: "function",
                      function: {
                        name: "Shell",
                        arguments: '{"command":"echo hi"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("unexpected user text: " + user);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

async function chat(ffi, command, stream) {
  if (stream) {
    delete process.env.BITBOT_LLM_STREAM;
    ffi.setLlmStreamHandler(() => {});
  } else {
    process.env.BITBOT_LLM_STREAM = "0";
    ffi.setLlmStreamHandler(null);
  }
  const rows = await ffi.executeHostEffects([{ kind: "llm_chat", command }], {});
  return rows.find((r) => r && r.kind === "llm_chat") || null;
}

async function main() {
  const hostSrc = fs.readFileSync(path.join(ROOT, "hosts/shared/host_ffi.js"), "utf8");
  check(
    !hostSrc.includes("obj.choices[0].delta.content"),
    "A7 source does not read only delta.content",
  );
  check(
    hostSrc.includes("consumeSseDataLine"),
    "A7 source feeds SSE lines through the tool_call accumulator",
  );
  check(agentLoopFfi.implicitHostLoop === false, "A7 module does not run a host loop");
  check(typeof agentLoopFfi.runAgentLoop !== "function", "A7 no runAgentLoop export");
  check(
    agentLoopFfi.HOST_FFI_OPS.join(",") === "exec_tool,request_approval,deliver,llm_chat",
    "A7 host FFI ops are exec_tool/request_approval/deliver/llm_chat",
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-a7-"));
  const { server, port } = await startStub();
  process.env.BITBOT_LLM_BASE_URL = "http://127.0.0.1:" + port + "/v1";
  process.env.BITBOT_LLM_API_KEY = "a7-stub-key";
  process.env.BITBOT_LLM_MODEL = "a7-stub-model";
  delete process.env.BITBOT_LLM_PROVIDER;
  delete process.env.BITBOT_CONTENT_MODERATION;
  const ffi = createHostFfi(tmp);

  try {
    const split = await chat(ffi, "A7-SPLIT", true);
    check(Boolean(split && split.ok), "A7 split stream ok", JSON.stringify(split));
    const calls = (split && split.tool_calls) || [];
    check(calls.length === 1, "A7 split stream kept one tool_call", JSON.stringify(calls));
    check(calls[0] && calls[0].id === "call_1", "A7 tool_call id", JSON.stringify(calls[0]));
    check(calls[0] && calls[0].name === "Read", "A7 tool_call name", JSON.stringify(calls[0]));
    check(
      calls[0] && calls[0].arguments === '{"path":"a.txt"}',
      "A7 tool_call arguments joined across chunks",
      calls[0] && calls[0].arguments,
    );
    check(split && split.stdout === "Hi", "A7 content kept beside tool_calls", split && split.stdout);

    const toolsOnly = await chat(ffi, "A7-TOOLS-ONLY", true);
    check(Boolean(toolsOnly && toolsOnly.ok), "A7 tool-only stream is not an empty failure", JSON.stringify(toolsOnly));
    const only = (toolsOnly && toolsOnly.tool_calls) || [];
    check(only.length === 1 && only[0].name === "Read" && only[0].arguments === "{}", "A7 tool-only stream kept tool_calls", JSON.stringify(only));

    const content = await chat(ffi, "A8-CONTENT", true);
    check(Boolean(content && content.ok), "A8 content stream ok", JSON.stringify(content));
    check(content && content.stdout === "Hello world", "A8 content stream text", content && content.stdout);
    check(
      content && Array.isArray(content.tool_calls) && content.tool_calls.length === 0,
      "A8 content stream has empty tool_calls",
      JSON.stringify(content && content.tool_calls),
    );

    const plain = await chat(ffi, "A8-NONSTREAM", false);
    check(Boolean(plain && plain.ok && plain.stdout === "plain answer"), "A8 non-stream content", JSON.stringify(plain));
    check(
      plain && Array.isArray(plain.tool_calls) && plain.tool_calls.length === 0,
      "A8 non-stream content has empty tool_calls",
      JSON.stringify(plain && plain.tool_calls),
    );

    const nsTools = await chat(ffi, "A7-NONSTREAM-TOOLS", false);
    const ns = (nsTools && nsTools.tool_calls) || [];
    check(Boolean(nsTools && nsTools.ok), "A7 non-stream tool_calls ok", JSON.stringify(nsTools));
    check(
      ns.length === 1 && ns[0].name === "Shell" && ns[0].arguments === '{"command":"echo hi"}',
      "A7 non-stream kept tool_calls",
      JSON.stringify(ns),
    );
  } finally {
    server.close();
  }

  console.log("prove_agent_loop_a7_a8 pass=" + pass + " fail=" + fail);
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error("FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
