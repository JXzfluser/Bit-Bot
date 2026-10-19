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

function postJson(urlStr, bodyObj, extraHeaders) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const body = JSON.stringify(bodyObj);
      const lib = u.protocol === "https:" ? https : http;
      const headers = Object.assign(
        {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {},
      );
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          method: "POST",
          headers,
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

/** Prefer last assistant message from Host turn (never invent content). */
function assistantTextFromTurn(turnResult) {
  if (!turnResult || typeof turnResult !== "object") return "";
  if (Array.isArray(turnResult.messages)) {
    for (let i = turnResult.messages.length - 1; i >= 0; i--) {
      const m = turnResult.messages[i];
      if (m && m.role === "assistant" && m.text) {
        return String(m.text).slice(0, 1500);
      }
    }
  }
  if (turnResult.stdout) return String(turnResult.stdout).slice(0, 1500);
  return "";
}

async function maybeReplyCnChannel(channel, turnResult, meta) {
  if (!turnResult || !turnResult.ok) {
    return { attempted: false, ok: false, residual: "turn_not_ok" };
  }
  const text = assistantTextFromTurn(turnResult) || "Bit Bot 已收到";
  if (channel === "dingtalk") {
    const webhook =
      (meta && meta.sessionWebhook) ||
      String(process.env.BITBOT_DINGTALK_WEBHOOK || "").trim();
    if (process.env.BITBOT_DINGTALK_POST !== "1" || !webhook) {
      return {
        attempted: false,
        ok: false,
        residual: "dingtalk_draft — POST!=1 or missing webhook",
      };
    }
    const reply = await postJson(webhook, {
      msgtype: "text",
      text: { content: text },
    });
    return { attempted: true, ok: Boolean(reply && reply.ok), reply, pretend_live: false };
  }
  if (channel === "feishu") {
    const token = String(process.env.BITBOT_FEISHU_TOKEN || "").trim();
    const chatId =
      (meta && meta.chat_id) ||
      String(process.env.BITBOT_FEISHU_CHAT_ID || "").trim();
    if (process.env.BITBOT_FEISHU_POST !== "1" || !token || !chatId) {
      return {
        attempted: false,
        ok: false,
        residual: "feishu_draft — POST!=1 or missing token/chat_id",
      };
    }
    const base = (
      process.env.BITBOT_FEISHU_API_BASE ||
      "https://open.feishu.cn/open-apis"
    ).replace(/\/$/, "");
    const reply = await postJson(
      `${base}/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
      { Authorization: `Bearer ${token}` },
    );
    return { attempted: true, ok: Boolean(reply && reply.ok), reply, pretend_live: false };
  }
  if (channel === "wecom") {
    const token = String(process.env.BITBOT_WECOM_TOKEN || "").trim();
    const to =
      (meta && (meta.from || meta.touser)) ||
      String(process.env.BITBOT_WECOM_TOUSER || "").trim();
    const agentId = String(process.env.BITBOT_WECOM_AGENT_ID || "").trim();
    if (process.env.BITBOT_WECOM_POST !== "1" || !token || !to) {
      return {
        attempted: false,
        ok: false,
        residual: "wecom_draft — POST!=1 or missing token/touser",
      };
    }
    const base = (
      process.env.BITBOT_WECOM_API_BASE ||
      "https://qyapi.weixin.qq.com/cgi-bin"
    ).replace(/\/$/, "");
    const payload = {
      msgtype: "text",
      agentid: agentId ? Number(agentId) || agentId : undefined,
      text: { content: text },
      touser: to,
    };
    const reply = await postJson(
      `${base}/message/send?access_token=${encodeURIComponent(token)}`,
      payload,
    );
    return { attempted: true, ok: Boolean(reply && reply.ok), reply, pretend_live: false };
  }
  return { attempted: false, ok: false, residual: "unknown_channel" };
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
    } else if (prompt && process.env.BITBOT_INBOUND_ECHO !== "1") {
      // Product default: MoonBit + Host FFI (never tunnel-echo).
      try {
        if (!state._productOnTurn) {
          const { createProductOnTurn } = require("./cn_inbound_product_on_turn");
          state._productOnTurn = createProductOnTurn(repoRoot);
        }
        turnResult = await state._productOnTurn(prompt, { channel, ...meta });
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
    // Live outbound reply when POST armed (sessionWebhook or BITBOT_DINGTALK_WEBHOOK).
    const reply = await maybeReplyCnChannel("dingtalk", enq.turnResult, {
      sessionWebhook: payload.sessionWebhook,
    });
    appendJsonl(path.join(logDir, "events.jsonl"), {
      channel: "dingtalk",
      text_prefix: text.slice(0, 120),
      enqueue: true,
      reply,
      pretend_live: false,
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
    const chatId =
      (payload &&
        payload.event &&
        payload.event.message &&
        (payload.event.message.chat_id || payload.event.message.chatId)) ||
      null;
    const enq = await enqueueTurn("feishu", text, {
      event_type: payload && payload.header ? payload.header.event_type : null,
      message_id:
        payload && payload.event && payload.event.message
          ? payload.event.message.message_id
          : null,
      chat_id: chatId,
    });
    const reply = await maybeReplyCnChannel("feishu", enq.turnResult, {
      chat_id: chatId,
    });
    appendJsonl(path.join(logDir, "events.jsonl"), {
      channel: "feishu",
      text_prefix: text.slice(0, 120),
      reply,
      pretend_live: false,
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
    const from = payload && (payload.FromUserName || payload.touser);
    const enq = await enqueueTurn("wecom", text, {
      msgId: payload && (payload.MsgId || payload.msgid),
      from,
    });
    const reply = await maybeReplyCnChannel("wecom", enq.turnResult, {
      from,
      touser: from,
    });
    appendJsonl(path.join(logDir, "events.jsonl"), {
      channel: "wecom",
      text_prefix: text.slice(0, 120),
      reply,
      pretend_live: false,
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
    let publicUrl = null;
    try {
      const urlFile = path.join(
        repoRoot,
        "data",
        "routines",
        "webhooks",
        "cn-inbound",
        "public-url.txt",
      );
      if (fs.existsSync(urlFile)) {
        const line = fs.readFileSync(urlFile, "utf8").split(/\r?\n/)[0].trim();
        if (/^https:\/\//i.test(line)) publicUrl = line;
      }
    } catch (_) {
      /* ignore */
    }
    const localHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    return {
      ok: true,
      listening: state.listening,
      port: state.port,
      host: state.host,
      started_at: state.started_at,
      last_event: state.last_event,
      counts: { ...state.counts },
      public_url: publicUrl,
      routes: {
        dingtalk: `${publicUrl || `http://${localHost}:${port}`}/dingtalk/callback`,
        feishu: `${publicUrl || `http://${localHost}:${port}`}/feishu/event`,
        wecom: `${publicUrl || `http://${localHost}:${port}`}/wecom/callback`,
        turn: `${publicUrl || `http://${localHost}:${port}`}/v1/turn`,
      },
      pretend_cloud: false,
      residual: publicUrl
        ? "public tunnel up — still need BITBOT_*_POST=1 + channel console config"
        : "needs public HTTPS URL (scripts/cn_inbound_tunnel.sh) + channel app credentials",
    };
  }

  return { start, stop, status, server };
}

module.exports = { createCnInboundServer };
