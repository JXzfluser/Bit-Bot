#!/usr/bin/env node
/** Accepts DingTalk-style robot webhook POSTs for live_post path proof. */
const http = require("http");
const fs = require("fs");
const port = Number(process.env.BITBOT_CN_STUB_PORT || 8788);
const logPath = process.env.BITBOT_CN_STUB_LOG || "/tmp/bitbot-cn-webhook.jsonl";
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const row = {
      at: new Date().toISOString(),
      method: req.method,
      url: req.url,
      body: body.slice(0, 2000),
    };
    fs.appendFileSync(logPath, JSON.stringify(row) + "\n");
    // DingTalk success shape
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
  });
});
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[stub-cn] http://127.0.0.1:${port}/robot/send log=${logPath}\n`);
});
