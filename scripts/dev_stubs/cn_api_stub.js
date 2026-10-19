#!/usr/bin/env node
/**
 * Local CN channel API stub — DingTalk / Feishu / WeCom response shapes.
 * Proves Host live_post HTTP path. NOT 钉钉/飞书/企微云验收.
 */
const http = require("http");
const fs = require("fs");
const port = Number(process.env.BITBOT_CN_STUB_PORT || 8788);
const logPath = process.env.BITBOT_CN_STUB_LOG || "/tmp/bitbot-cn-webhook.jsonl";

function log(row) {
  fs.appendFileSync(logPath, JSON.stringify(row) + "\n");
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = String(req.url || "");
    const row = {
      at: new Date().toISOString(),
      method: req.method,
      url,
      auth: String(req.headers.authorization || "").slice(0, 24),
      body: body.slice(0, 2000),
    };
    log(row);

    res.setHeader("Content-Type", "application/json");
    // DingTalk robot
    if (url.startsWith("/robot/send")) {
      res.writeHead(200);
      res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
      return;
    }
    // Feishu open-apis
    if (url.includes("/im/v1/messages")) {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          code: 0,
          msg: "success",
          data: { message_id: "stub-feishu-msg" },
        }),
      );
      return;
    }
    // WeCom cgi-bin
    if (url.includes("/message/send")) {
      res.writeHead(200);
      res.end(JSON.stringify({ errcode: 0, errmsg: "ok", msgid: "stub-wecom" }));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: "unknown stub route", url }));
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `[stub-cn-api] http://127.0.0.1:${port} (dingtalk/feishu/wecom) log=${logPath}\n`,
  );
});
