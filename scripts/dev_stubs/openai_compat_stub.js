#!/usr/bin/env node
/** Local OpenAI-compatible stub for Host llm_chat pipe proof (NOT product DeepSeek). */
const http = require("http");
const port = Number(process.env.BITBOT_STUB_PORT || 8787);
const mode = process.env.BITBOT_STUB_MODE || "ok"; // ok | block | authfail

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
