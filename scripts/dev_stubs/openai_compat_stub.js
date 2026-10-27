#!/usr/bin/env node
/** Local OpenAI-compatible stub for Host llm_chat pipe proof (NOT product DeepSeek). */
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const port = Number(process.env.BITBOT_STUB_PORT || 8787);
const mode = process.env.BITBOT_STUB_MODE || "ok"; // ok | block | authfail | toolcall

/* C-1 proof hook: a scripted tool-call sequence.
   BITBOT_STUB_TOOL_SCRIPT is a JSON array of steps, one per llm_chat request:
     [{"tool_calls":[{"id":"c1","name":"create_routine","arguments":{...}}]},
      {"content":"done"}]
   The kernel asks again after each tool result, so the script is consumed in
   order; once it runs out the stub falls back to a plain reply. This is what
   lets a gate prove the whole chain — model asks for a tool, the kernel
   dispatches it, the product tool runs, the effect comes out — without a
   real provider. It proves the TOOL PATH, not the model. */
const TOOL_SCRIPT = (() => {
  const raw = String(process.env.BITBOT_STUB_TOOL_SCRIPT || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
})();
let toolScriptIdx = 0;

function nextToolStep() {
  if (toolScriptIdx >= TOOL_SCRIPT.length) return null;
  const step = TOOL_SCRIPT[toolScriptIdx];
  toolScriptIdx += 1;
  return step && typeof step === "object" ? step : null;
}

/* 用户旅程验收（J1–J4）需要的证据面：把 provider 真收到的请求如实记下来。
   BITBOT_STUB_RECORD=<jsonl 路径> 时开启，默认关闭（不影响任何现有门禁）。
   记的是「能力是否真到 provider」的证据，不是密钥：Authorization 只留
   scheme / 长度 / sha256 前缀，正文里的密钥形状串在落盘前先打码。 */
const RECORD_PATH = String(process.env.BITBOT_STUB_RECORD || "").trim();
const SECRET_SHAPE_RE = /sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}/g;
let recordSeq = 0;
function record(entry) {
  if (!RECORD_PATH) return;
  try {
    fs.appendFileSync(RECORD_PATH, JSON.stringify(entry) + "\n");
  } catch (_) {
    /* 记录失败绝不能影响 stub 应答（证据缺了如实报，不能假造） */
  }
}
function recordRequest(req, body, auth) {
  let parsed = null;
  try { parsed = JSON.parse(body || "{}"); } catch (_) { parsed = null; }
  const scheme = /^Bearer(\s|$)/i.test(auth) ? "Bearer" : (auth ? "other" : "none");
  record({
    seq: ++recordSeq,
    at: new Date().toISOString(),
    port,
    method: req.method,
    url: String(req.url || ""),
    auth_scheme: scheme,
    auth_len: auth.length,
    auth_sha256: crypto.createHash("sha256").update(auth).digest("hex").slice(0, 16),
    model: parsed && parsed.model ? String(parsed.model) : "",
    stream: Boolean(parsed && parsed.stream),
    messages: parsed && Array.isArray(parsed.messages)
      ? parsed.messages.map((m) => ({
          role: String((m && m.role) || ""),
          chars: String((m && m.content) || "").length,
          // 打码后仍保留人设/群上下文等证据串，断言直接写在正文上
          content: String((m && m.content) || "").replace(SECRET_SHAPE_RE, "[redacted-secret]"),
        }))
      : [],
    raw_chars: String(body || "").length,
    // C-1: the tool catalog the kernel sent. If the product tools are not in
    // here, the model was never offered them — the model cannot call a tool
    // it was never shown. This is the evidence that closes that loop.
    tool_names:
      parsed && Array.isArray(parsed.tools)
        ? parsed.tools.map((t) =>
            String(
              (t && t.function && t.function.name) ||
                (t && t.name) ||
                "",
            ),
          )
        : [],
  });
}

function sseChunk(delta) {
  return (
    "data: " +
    JSON.stringify({
      id: "stub-stream",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
    }) +
    "\n\n"
  );
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const auth = String(req.headers.authorization || "");
    // 先记账再判定：401 / 500 这些「真到过 provider」的痕同样是旅程证据。
    recordRequest(req, body, auth);
    if (mode === "authfail" || !auth.includes("Bearer")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "Authentication Fails (stub)" } }),
      );
      return;
    }
    if (!String(req.url || "").includes("/chat/completions")) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    // GP-143 acceptance hook: fail exactly the requests that carry a marker in
    // the payload (e.g. one Bot's persona name), so a group run can be shown to
    // degrade to an honest partial instead of a fabricated reply. Test-only.
    const failMarker = String(process.env.BITBOT_STUB_FAIL_CONTAINS || "");
    if (failMarker && body.includes(failMarker)) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "stub provider failure for " + failMarker } }),
      );
      return;
    }
    let user = "";
    let wantStream = false;
    try {
      const j = JSON.parse(body || "{}");
      wantStream = Boolean(j.stream);
      const msgs = j.messages || [];
      // GP-14 proof: echo the WHOLE message stack (not just the last user turn)
      // so a test can assert the quoted reply target actually reached the
      // provider payload. Off by default to keep normal stub replies verbatim.
      if (process.env.BITBOT_STUB_ECHO_ALL === "1") {
        user = msgs.map((m) => m.role + "<" + (m.content || "") + ">").join("|");
      } else {
        user = (msgs[msgs.length - 1] && msgs[msgs.length - 1].content) || "";
      }
    } catch (_) {
      /* ignore */
    }
    // echo-all 模式下要看得下整条 message stack（引用场景 120 字会截掉 quoted 行）
    const echoWidth =
      process.env.BITBOT_STUB_ECHO_ALL === "1"
        ? Number(process.env.BITBOT_STUB_ECHO_WIDTH || 600)
        : 120;
    // GP-93 proof hook: reply with fixed provider text (e.g. a bare URL) so a
    // test can watch the kernel normalize it to [url](url) before delivery.
    const fixed = process.env.BITBOT_STUB_REPLY;
    const content =
      mode === "block"
        ? "请勿制作炸弹，这是审核测试回复。"
        : fixed
          ? String(fixed)
          : "Bit Bot stub reply: " + String(user).slice(0, echoWidth);

    // GP-97 proof hook: hold the provider reply open for N ms so a test can see
    // the Host's effect-boundary progress events arrive *while* the turn is
    // still running (a fast provider would resolve before any paint).
    // Synchronous on purpose: blocking the stub's event loop keeps the HTTP
    // response header unsent, so the client really does wait.
    const latency = Number(process.env.BITBOT_STUB_LATENCY_MS || 0);
    if (latency > 0) {
      try {
        require("child_process").execFileSync("sleep", [String(latency / 1000)], {
          stdio: "ignore",
        });
      } catch (_) {
        /* ignore */
      }
    }

    if (wantStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      // Emit a few incremental tokens then done.
      const parts = content.match(/.{1,8}/g) || [content];
      for (const p of parts) {
        res.write(sseChunk(p));
      }
      res.write(
        "data: " +
          JSON.stringify({
            id: "stub-stream",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }) +
          "\n\n",
      );
      // GP-130: final usage chunk (stream_options.include_usage shape) so
      // the Host's weekly usage store is exercised end to end.
      res.write(
        "data: " +
          JSON.stringify({
            id: "stub-stream",
            object: "chat.completion.chunk",
            choices: [],
            usage: { prompt_tokens: 11, completion_tokens: 7 },
          }) +
          "\n\n",
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    // C-1: a scripted tool call wins over the plain reply — the kernel then
    // dispatches it and asks again, which is exactly the chain we want to
    // prove. Only the non-streaming path carries tool calls (the kernel's
    // tool loop is non-streaming by construction).
    const toolStep = mode === "toolcall" ? nextToolStep() : null;
    if (toolStep && Array.isArray(toolStep.tool_calls)) {
      res.end(
        JSON.stringify({
          id: "stub-tool",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: String(toolStep.content || ""),
                tool_calls: toolStep.tool_calls.map((c, idx) => ({
                  id: String((c && c.id) || "call-" + idx),
                  type: "function",
                  function: {
                    name: String((c && c.name) || ""),
                    arguments: JSON.stringify(
                      (c && c.arguments) !== undefined ? c.arguments : {},
                    ),
                  },
                })),
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        id: "stub-1",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `[stub-llm] http://127.0.0.1:${port}/v1 mode=${mode}\n`,
  );
});
