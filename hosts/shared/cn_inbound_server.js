"use strict";

/**
 * Domestic CN channel inbound HTTP server (钉钉 / 飞书 / 企微).
 * Product path — not a stub: parses real callback shapes, enqueues Host turns,
 * optionally runs BITBOT_INBOUND_TURN=1. Live cloud proof still needs public
 * URL + channel app credentials (honest residual until then).
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

function defaultRepoRoot() {
  return path.resolve(__dirname, "../..");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function appendJsonl(file, row) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(row) + "\n");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function extractDingTalkText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.text && payload.text.content != null) {
    return String(payload.text.content).trim();
  }
  if (payload.msgtype === "richText" && payload.content && payload.content.richText) {
    return payload.content.richText
      .map((x) => (x && x.text ? String(x.text) : ""))
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}

function extractFeishuText(payload) {
  if (!payload || typeof payload !== "object") return "";
  // Event v2: event.message.message_type + content JSON string
  const msg = payload.event && payload.event.message ? payload.event.message : null;
  if (msg) {
    if (msg.message_type === "text" && msg.content) {
      try {
        const c = typeof msg.content === "string" ? JSON.parse(msg.content) : msg.content;
        return String((c && c.text) || "").trim();
      } catch (_) {
        return String(msg.content).trim();
      }
    }
  }
  // Older challenge / flat
  if (payload.text && payload.text.content) return String(payload.text.content).trim();
  return "";
}

function extractWecomText(payload) {
  if (!payload || typeof payload !== "object") return "";
  // JSON mode (modern)
  if (payload.MsgType === "text" && payload.Content != null) {
    return String(payload.Content).trim();
  }
  if (payload.msgtype === "text" && payload.text && payload.text.content != null) {
    return String(payload.text.content).trim();
  }
  // XML already parsed externally — Content field
  if (payload.Content != null && (payload.MsgType === "text" || !payload.MsgType)) {
    return String(payload.Content).trim();
  }
  return "";
}

function postJson(urlStr, bodyObj) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const body = JSON.stringify(bodyObj);
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 15000,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              body: data.slice(0, 1000),
            });
          });
        },
      );
      req.on("error", (err) => {
        resolve({ ok: false, error: String(err && err.message ? err.message : err) });
      });
      req.write(body);
      req.end();
    } catch (err) {
      resolve({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });
}

/**
 * @param {{
 *   repoRoot?: string,
 *   port?: number,
 *   host?: string,
 *   onTurn?: (prompt: string, meta: object) => Promise<object>,
 * }} opts
 */
function createCnInboundServer(opts = {}) {
  const repoRoot = opts.repoRoot || defaultRepoRoot();
  const port = Number(opts.port || process.env.BITBOT_CN_INBOUND_PORT || 18765);
  const host = opts.host || process.env.BITBOT_CN_INBOUND_HOST || "0.0.0.0";
  const logDir = ensureDir(path.join(repoRoot, "data", "routines", "webhooks", "cn-inbound"));
  const pendingPath = path.join(
    repoRoot,
    "data",
    "routines",
    "webhooks",
    "pending-turns.jsonl",
  );

  const state = {
    listening: false,
    port,
    host,
    started_at: null,
    last_event: null,
    counts: { dingtalk: 0, feishu: 0, wecom: 0, other: 0 },
    pretend_cloud: false,
  };

  async function enqueueTurn(channel, text, meta) {
    const at = new Date().toISOString();
    const prompt = String(text || "").trim().slice(0, 2000);
    const row = {
      channel,
      turn_prompt: prompt,
      status: "pending",
      pretend_turn: false,
      meta: meta || {},
      at,
    };
    appendJsonl(pendingPath, row);
    const hookPath = path.join(
      logDir,
      `hook-${channel}-${Date.now().toString(36)}.json`,
    );
    fs.writeFileSync(hookPath, JSON.stringify(row, null, 2));

    let turnResult = null;
    if (typeof opts.onTurn === "function" && prompt) {
      try {
        turnResult = await opts.onTurn(prompt, { channel, ...meta });
      } catch (err) {
        turnResult = {
          ok: false,
          error: String(err && err.message ? err.message : err),
        };
      }
    } else if (process.env.BITBOT_INBOUND_TURN === "1" && prompt) {
      // Fallback: defer to cli_host when Desktop onTurn not wired
      try {
        const { execFile } = require("child_process");
        const { promisify } = require("util");
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync(
          process.execPath,
          [path.join(repoRoot, "hosts", "cli_host", "run_turn.js"), "--approved", prompt],
          {
            cwd: repoRoot,
            timeout: 60000,
            env: { ...process.env, BITBOT_INBOUND_TURN: "0" },
            maxBuffer: 2 * 1024 * 1024,
          },
        );
        turnResult = JSON.parse(String(stdout || "{}"));
      } catch (err) {
        turnResult = {
          ok: false,
          error: String(err && err.message ? err.message : err),
        };
      }
    }

    state.last_event = {
      channel,
      prompt_prefix: prompt.slice(0, 80),
      at,
      turn_ok: Boolean(turnResult && turnResult.ok),
    };
    return { row, hookPath, turnResult };
  }

  async function handleDingTalk(req, res, raw, payload) {
    state.counts.dingtalk += 1;
    // Optional sign check when token configured
    const token = String(process.env.BITBOT_DINGTALK_APP_SECRET || "").trim();
    const ts = String(req.headers["timestamp"] || "");
    const sign = String(req.headers["sign"] || "");
    if (token && ts && sign) {
      const stringToSign = ts + "\n" + token;
      const expected = crypto
        .createHmac("sha256", token)
        .update(stringToSign)
        .digest("base64");
      if (expected !== sign) {
        json(res, 401, { errcode: 401, errmsg: "invalid sign" });
        return;
      }
    }
    const text = extractDingTalkText(payload);
    const enq = await enqueueTurn("dingtalk", text, {
      msgId: payload.msgId,
      senderNick: payload.senderNick,
      conversationId: payload.conversationId,
      sessionWebhook: payload.sessionWebhook,
    });
    // Best-effort session reply when live post armed and sessionWebhook present
    let reply = null;
    if (
      process.env.BITBOT_DINGTALK_POST === "1" &&
      payload.sessionWebhook &&
      enq.turnResult &&
      enq.turnResult.ok
    ) {
      const replyText =
        (enq.turnResult.stdout && String(enq.turnResult.stdout).slice(0, 1500)) ||
        (Array.isArray(enq.turnResult.messages) &&
          enq.turnResult.messages
            .map((m) => m && m.text)
            .filter(Boolean)
            .join("\n")
            .slice(0, 1500)) ||
        "Bit Bot 已收到";
      reply = await postJson(payload.sessionWebhook, {
        msgtype: "text",
        text: { content: replyText },
      });
    }
    appendJsonl(path.join(logDir, "events.jsonl"), {
      channel: "dingtalk",
      text_prefix: text.slice(0, 120),
      enqueue: true,
      reply,
      at: new Date().toISOString(),
      raw_bytes: raw.length,
    });
    json(res, 200, { errcode: 0, errmsg: "ok" });
  }

  async function handleFeishu(req, res, raw, payload) {
    state.counts.feishu += 1;
    // URL verification challenge
    if (payload && payload.type === "url_verification" && payload.challenge) {
      json(res, 200, { challenge: payload.challenge });
      return;
    }
    if (payload && payload.challenge && !payload.event) {
      json(res, 200, { challenge: payload.challenge });
      return;
    }
    const text = extractFeishuText(payload);
    await enqueueTurn("feishu", text, {
      event_type: payload && payload.header ? payload.header.event_type : null,
      message_id:
        payload && payload.event && payload.event.message
          ? payload.event.message.message_id
          : null,
    });
    appendJsonl(path.join(logDir, "events.jsonl"), {
      channel: "feishu",
      text_prefix: text.slice(0, 120),
      at: new Date().toISOString(),
      raw_bytes: raw.length,
    });
    json(res, 200, { code: 0, msg: "ok" });
  }

  async function handleWecom(req, res, raw, payload, urlObj) {
    state.counts.wecom += 1;
    // GET verify: echostr
    if (req.method === "GET") {
      const echo = urlObj.searchParams.get("echostr") || "";
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(echo);
      return;
    }
    const text = extractWecomText(payload || {});
    await enqueueTurn("wecom", text, {
      msgId: payload && (payload.MsgId || payload.msgid),
      from: payload && (payload.FromUserName || payload.touser),
    });
    appendJsonl(path.join(logDir, "events.jsonl"), {
      channel: "wecom",
      text_prefix: text.slice(0, 120),
      at: new Date().toISOString(),
      raw_bytes: raw.length,
    });
    // WeCom expects empty success or XML; JSON ok for modern apps
    json(res, 200, { errcode: 0, errmsg: "ok" });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const p = urlObj.pathname.replace(/\/+$/, "") || "/";
      const raw = await readBody(req);
      let payload = null;
      const ct = String(req.headers["content-type"] || "");
      if (raw.length && ct.includes("json")) {
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch (_) {
          payload = null;
        }
      } else if (raw.length) {
        try {
          payload = JSON.parse(raw.toString("utf8"));
        } catch (_) {
          // Minimal XML Content extract for WeCom plaintext
          const s = raw.toString("utf8");
          const m = s.match(/<Content><!\[CDATA\[([\s\S]*?)\]\]><\/Content>/) ||
            s.match(/<Content>([\s\S]*?)<\/Content>/);
          const t = s.match(/<MsgType><!\[CDATA\[([\s\S]*?)\]\]><\/MsgType>/) ||
            s.match(/<MsgType>([\s\S]*?)<\/MsgType>/);
          if (m) {
            payload = {
              Content: m[1],
              MsgType: t ? t[1] : "text",
            };
          }
        }
      }

      if (p === "/health" || p === "/cn/health" || p === "/v1/status") {
        json(res, 200, {
          ok: true,
          service: "bitbot-cn-inbound",
          listening: state.listening,
          counts: state.counts,
          turn_api: true,
          pretend_cloud: false,
        });
        return;
      }

      // Shared-brain turn API for iOS/Android product shells (LAN pair to Desktop).
      // POST /v1/turn { "text": "...", "machine_kind": "android"|"ios", "session_id": "..." }
      if (p === "/v1/turn" || p === "/turn") {
        if (req.method !== "POST") {
          json(res, 405, { ok: false, error: "POST required" });
          return;
        }
        const text =
          (payload && (payload.text || payload.message || payload.prompt)) ||
          raw.toString("utf8").trim();
        const machineKind =
          (payload && (payload.machine_kind || payload.machineKind)) || "mobile";
        const sessionId =
          (payload && (payload.session_id || payload.sessionId)) ||
          `mobile-${machineKind}`;
        if (!String(text || "").trim()) {
          json(res, 400, { ok: false, error: "empty text" });
          return;
        }
        state.counts.other += 1;
        const enq = await enqueueTurn(machineKind, String(text), {
          session_id: sessionId,
          source: "v1_turn",
          machine_kind: machineKind,
        });
        const turn = enq.turnResult || { ok: false, error: "no onTurn handler" };
        appendJsonl(path.join(logDir, "events.jsonl"), {
          channel: "v1_turn",
          machine_kind: machineKind,
          text_prefix: String(text).slice(0, 120),
          turn_ok: Boolean(turn && turn.ok),
          at: new Date().toISOString(),
        });
        json(res, 200, {
          ok: Boolean(turn && turn.ok),
          machine_kind: machineKind,
          session_id: sessionId,
          messages: (turn && turn.messages) || [],
          host_results: (turn && turn.host_results) || [],
          stdout: (turn && turn.stdout) || "",
          error: (turn && turn.error) || null,
          pretend_turn: false,
          brain: "shared_desktop_host",
        });
        return;
      }
      if (p.startsWith("/dingtalk") || p === "/robot/callback") {
        await handleDingTalk(req, res, raw, payload || {});
        return;
      }
      if (p.startsWith("/feishu") || p.startsWith("/lark")) {
        await handleFeishu(req, res, raw, payload || {});
        return;
      }
      if (p.startsWith("/wecom") || p.startsWith("/wework")) {
        await handleWecom(req, res, raw, payload || {}, urlObj);
        return;
      }
      state.counts.other += 1;
      json(res, 404, {
        ok: false,
        error: "unknown_cn_inbound_route",
        routes: [
          "POST /dingtalk/callback",
          "POST /feishu/event",
          "GET|POST /wecom/callback",
          "POST /v1/turn",
          "GET /health",
        ],
      });
    } catch (err) {
      json(res, 500, {
        ok: false,
        error: String(err && err.message ? err.message : err),
      });
    }
  });

  function start() {
    return new Promise((resolve, reject) => {
      if (state.listening) {
        resolve(status());
        return;
      }
      server.once("error", reject);
      server.listen(port, host, () => {
        state.listening = true;
        state.started_at = new Date().toISOString();
        process.stdout.write(
          `[cn-inbound] http://${host}:${port} /dingtalk|/feishu|/wecom (product; cloud residual until public URL)\n`,
        );
        resolve(status());
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      if (!state.listening) {
        resolve({ ok: true, stopped: false });
        return;
      }
      server.close(() => {
        state.listening = false;
        resolve({ ok: true, stopped: true });
      });
    });
  }

  function status() {
    return {
      ok: true,
      listening: state.listening,
      port: state.port,
      host: state.host,
      started_at: state.started_at,
      last_event: state.last_event,
      counts: { ...state.counts },
      routes: {
        dingtalk: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/dingtalk/callback`,
        feishu: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/feishu/event`,
        wecom: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/wecom/callback`,
        turn: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}/v1/turn`,
      },
      pretend_cloud: false,
      residual: "needs public HTTPS URL + channel app credentials for live cloud",
    };
  }

  return { start, stop, status, server };
}

module.exports = { createCnInboundServer };
