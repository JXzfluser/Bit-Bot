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
    let user = "";
    let wantStream = false;
    try {
      const j = JSON.parse(body || "{}");
      wantStream = Boolean(j.stream);
      const msgs = j.messages || [];
      user = (msgs[msgs.length - 1] && msgs[msgs.length - 1].content) || "";
    } catch (_) {
      /* ignore */
    }
    const content =
      mode === "block"
        ? "请勿制作炸弹，这是审核测试回复。"
        : "Bit Bot stub reply: " + String(user).slice(0, 120);

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
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `[stub-llm] http://127.0.0.1:${port}/v1 mode=${mode}\n`,
  );
});
