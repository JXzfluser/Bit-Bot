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
const os = require("os");
const { URL } = require("url");
const p0 = require("./p0_security");
const deviceKeys = require("./device_keys");
const { createProductSurfaceRef } = require("./product_surface_ref");
const { createPairingCodeManager } = require("./desktop_pairing");
const { rankLanIPv4, classifyScope } = require("./lan_candidates");

function defaultRepoRoot() {
  return path.resolve(__dirname, "../..");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function appendJsonl(file, row) {
  ensureDir(path.dirname(file));
  // ADR 0008: logs must not persist BITBOT_LLM_API_KEY and other secrets.
  const safe = p0.scrubDeep(row, process.env);
  fs.appendFileSync(file, JSON.stringify(safe) + "\n");
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

/* ---------- 配对落地页（只读）----------
 * 桌面弹窗里那颗按钮叫「复制配对链接」。既然叫链接，点开就必须是一页纸 ——
 * 以前它回的是 unknown_cn_inbound_route 的 JSON 404，用户粘到微信里就是一条
 * 打不开的死链接（半真）。这一页只讲三件事：这是哪台桌面、手机下一步该干什么、
 * 现在到底能不能连。
 *
 * 三条不许越过的线：
 *   1. 不含任何凭证：64 位令牌、配对码原文都不在这里（页面未鉴权，局域网里谁都敲得开）。
 *   2. 不是第二个 redeem 面：没有表单、不 fetch /v1/pair/redeem —— 谁在浏览器里
 *      输 6 位码，bearer 就落到那个浏览器里，那不是配对的客户端，是白送一个令牌。
 *   3. 不引外部资源：主机名和内网地址不许顺带发给第三方；走 cloudflared 公网隧道时
 *      也不被索引、不被缓存（noindex / no-store）。
 */
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

/* 网卡范围 → 人话。口径与桌面弹窗同一份真源（hosts/shared/lan_candidates.js），
   两处不许各说各话。 */
const PAIR_SCOPE_NOTE = {
  private: "同一 Wi-Fi / 局域网里的地址，手机能走到。",
  cgnat: "覆盖网地址（Tailscale 一类），不是同一个 Wi-Fi 的局域网地址 —— 手机没加入同一个覆盖网走不到。",
  public: "公网地址（云主机常见）—— 手机在 Wi-Fi 里通常走不到，需要同一局域网里的地址或内网穿透。",
  link_local: "169.254 地址 = 这块网卡没配上 DHCP，手机敲它一定失败 —— 先让桌面真正连上 Wi-Fi。",
  loopback: "只有桌面自己这台机器能连。",
};

function pairPageHtml(info) {
  const name = escHtml(info.name || "Desktop");
  const port = escHtml(info.port || "");
  const rows = info.lanOpen
    ? (info.lan || []).map((it) => {
        const ip = escHtml(it.ip || "");
        const note = PAIR_SCOPE_NOTE[it.scope] || PAIR_SCOPE_NOTE.loopback;
        return (
          '<li><span class="ip">' + ip + "</span><span class=\"scope\">" +
          escHtml(it.name || it.scope || "") + "</span><p>" + escHtml(note) + "</p></li>"
        );
      }).join("")
    : "";
  const stateLine = info.lanOpen
    ? rows
      ? "局域网已放开。手机要能连上，得和这台机器在同一个 Wi-Fi / 局域网里："
      : "局域网已放开，但没读到本机 IPv4 —— 手机上要手填桌面的局域网地址。"
    : "局域网没放开：只在桌面自己这台机器上开着（127.0.0.1:" +
      info.port +
      "）。要手机连，在桌面点「账户 → 移动端远程控制 → 允许手机连接」。";
  const codeLine = info.codeActive
    ? "配对码：现在有一个有效的 6 位码（不在这一页显示，只在桌面上显示，5 分钟内有效、用过一次即作废）。"
    : "配对码：桌面上还没生成。生成后再回来看这一页不会有变化 —— 码只显示在桌面上。";
  return (
    "<!doctype html>\n" +
    '<html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Bit Bot Desktop · " + name + "</title>" +
    "<style>" +
    ":root{color-scheme:light dark}" +
    "body{margin:0;padding:32px 20px;background:#f6f6f4;color:#1c1c1a;" +
    "font:15px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}" +
    "main{max-width:620px;margin:0 auto}" +
    "h1{font-size:20px;margin:0 0 4px}" +
    ".sub{margin:0 0 24px;color:#6b6b66}" +
    "section{background:#fff;border:1px solid #e2e2dd;border-radius:12px;padding:16px 18px;margin-bottom:14px}" +
    "h2{font-size:15px;margin:0 0 10px}" +
    "ol{margin:0;padding-left:20px}li{margin:4px 0}" +
    "ul{list-style:none;margin:0;padding:0}" +
    "ul li{padding:10px 0;border-top:1px solid #eeece8}" +
    "ul li:first-child{border-top:0}" +
    ".ip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-right:8px}" +
    ".scope{color:#6b6b66;font-size:13px}" +
    "ul p{margin:2px 0 0;font-size:13px;color:#6b6b66}" +
    ".note{margin:12px 0 0;font-size:13px;color:#6b6b66}" +
    ".en{color:#6b6b66;font-size:13px;margin:18px 0 0}" +
    "@media (prefers-color-scheme:dark){body{background:#141412;color:#eceae6}" +
    "section{background:#1d1d1b;border-color:#2c2c29}.sub,.scope,ul p,.note,.en{color:#9a978f}}" +
    "</style></head><body><main>" +
    "<h1>Bit Bot Desktop</h1>" +
    '<p class="sub">这台是 <strong>' + name + "</strong> · 端口 " + port + "</p>" +
    "<section><h2>手机下一步做什么</h2><ol>" +
    "<li>在手机上打开 Bit Bot App</li>" +
    "<li>点「连接 Desktop」</li>" +
    "<li>输入桌面上「移动端远程控制」里那 6 位配对码</li>" +
    "</ol>" +
    '<p class="note">这一页不需要你填任何东西：配对码只在 App 里输，' +
    "令牌由手机端自己换到，不经过浏览器。</p></section>" +
    "<section><h2>现在能不能连</h2>" +
    "<p>" + escHtml(stateLine) + "</p>" +
    (info.lanOpen && rows ? "<ul>" + rows + "</ul>" : "") +
    "<p>" + escHtml(codeLine) + "</p></section>" +
    '<p class="en">Read-only landing page. Nothing here is a credential, and this page ' +
    "never asks you for one. / 只读说明页，不含凭证。</p>" +
    "</main></body></html>"
  );
}

function html(res, code, body) {
  const buf = Buffer.from(body, "utf8");
  res.writeHead(code, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": buf.length,
    /* 走 cloudflared 公网隧道时这一页是全网可见的：不缓存、不嗅探、不被索引。 */
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(buf);
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
  // `port: 0` is a real request (ephemeral). `||` would collapse it to 18765.
  const port =
    opts.port != null && opts.port !== ""
      ? Number(opts.port)
      : Number(process.env.BITBOT_CN_INBOUND_PORT || 18765);
  const bind = p0.resolveInboundBind(opts, process.env);
  const host = bind.host;
  const turnAuth = p0.resolveTurnToken(repoRoot, process.env, opts);
  const turnToken = turnAuth.token;
  const maxBody = Number(
    opts.maxBodyBytes || process.env.BITBOT_INBOUND_MAX_BODY || p0.DEFAULT_MAX_BODY_BYTES,
  );
  const nonceStore = p0.createNonceStore();
  // B-4a:设备登记表。**只有公钥**。登记了设备 ⇒ 入站回合必须出示设备凭证
  // (ADR 0008 的共享 turn token 不再授予设备身份);没登记 ⇒ 沿用既有
  // turn token 合同,现有部署不受影响。
  const devicesPath =
    String(opts.devicesPath || process.env.BITBOT_DEVICES_PATH || "") ||
    path.join(repoRoot, "data", "host", "devices.json");
  const deviceStore = deviceKeys.loadDevices(devicesPath);
  // 跨端审批的队列住在 surface 里(pending-approvals.jsonl)。
  const surface = createProductSurfaceRef(repoRoot, path.join(repoRoot, "data"));
  const logDir = ensureDir(path.join(repoRoot, "data", "routines", "webhooks", "cn-inbound"));
  const pendingPath = path.join(
    repoRoot,
    "data",
    "routines",
    "webhooks",
    "pending-turns.jsonl",
  );

  // Pairing code manager (pairing-v1 spec). If caller provides one, use it;
  // otherwise create a default one. The desktop main.js creates a shared
  // instance so IPC and HTTP routes see the same codes.
  const pairingManager = opts.pairingManager || createPairingCodeManager();

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
    // ADR 0008: signature is mandatory. Missing secret or a bad sign does not wake.
    const secret = String(
      (opts.dingtalkSecret != null ? opts.dingtalkSecret : process.env.BITBOT_DINGTALK_APP_SECRET) || "",
    ).trim();
    const verdict = p0.verifyDingTalkSignature(req, secret);
    if (!verdict.ok) {
      json(res, 401, {
        ok: false,
        error: verdict.error,
        errcode: 401,
        errmsg: verdict.error,
      });
      return;
    }
    state.counts.dingtalk += 1;
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
    const secret = String(
      (opts.feishuSecret != null
        ? opts.feishuSecret
        : process.env.BITBOT_FEISHU_ENCRYPT_KEY || process.env.BITBOT_FEISHU_VERIFICATION_TOKEN) || "",
    ).trim();
    const verdict = p0.verifyFeishuSignature(req, raw, secret);
    if (!verdict.ok) {
      json(res, 401, { ok: false, error: verdict.error });
      return;
    }
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
    const secret = String(
      (opts.wecomSecret != null
        ? opts.wecomSecret
        : process.env.BITBOT_WECOM_CALLBACK_TOKEN || process.env.BITBOT_WECOM_TOKEN) || "",
    ).trim();
    const verdict = p0.verifyWecomSignature(req, urlObj, secret, raw);
    if (!verdict.ok) {
      json(res, 401, { ok: false, error: verdict.error, errcode: 401 });
      return;
    }
    state.counts.wecom += 1;
    // GET verify: echostr only after the signature matches.
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
      let raw;
      try {
        raw = await p0.readBodyLimited(req, maxBody);
      } catch (err) {
        if (err && (err.status === 413 || err.error === "payload_too_large")) {
          json(res, 413, { ok: false, error: "payload_too_large" });
          return;
        }
        throw err;
      }
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

      // ===== 跨端审批(B-6)================================================
      // 这台机器(常开的 Box)上待批准的请求,让**另一台已登记设备**来看和决定。
      // 鉴权与 /v1/turn 同一套设备密钥(B-4a)—— 账号 = 设备密钥,没有别的身份。
      //
      // 语义要点:决定写进的是**这台机器**的队列和规则,所以在手机上点「总是允许」
      // 等于授权这台机器以后做这类事。这是重决策,回执要说清楚。
      if (p === "/v1/approvals" || p.startsWith("/v1/approvals/")) {
        const auth = deviceKeys.verifyDeviceTurn(deviceStore, req, raw, { nonceStore });
        if (!auth.ok) {
          json(res, 401, { ok: false, error: auth.error || "unauthorized" });
          return;
        }
        if (!surface) {
          json(res, 503, { ok: false, error: "approval_queue_unavailable" });
          return;
        }
        // GET /v1/approvals → 待批准的清单
        if (p === "/v1/approvals" && req.method === "GET") {
          let pending = [];
          try {
            pending = surface.pendingApprovals() || [];
          } catch (e) {
            json(res, 500, { ok: false, error: "approval_queue_unreadable" });
            return;
          }
          const rows = pending.map((e) => ({
            id: String(e.id || ""),
            kind: String(e.kind || ""),
            // 命令里可能带收件人/正文 —— 只给前 240 字,够人判断是什么。
            command: String(e.command || "").slice(0, 240),
            source: String(e.source || ""),
            requested_at: String(e.requested_at || ""),
            expires_at: String(e.expires_at || ""),
            status: String(e.status || "pending"),
          }));
          json(res, 200, {
            ok: true,
            device_id: auth.device_id,
            count: rows.length,
            pending: rows,
            note: "这些是这台机器上等着人批的操作。批准写进的是这台机器。",
          });
          return;
        }
        // POST /v1/approvals/<id>/decide → 决定
        const decideMatch = p.match(/^\/v1\/approvals\/([^/]+)\/decide$/);
        if (decideMatch && req.method === "POST") {
          const id = decodeURIComponent(decideMatch[1] || "");
          const decision = String(
            (payload && (payload.decision || payload.decision_kind)) || "",
          ).trim();
          // 注意别把局部变量叫 res —— 那会盖掉 HTTP 响应对象。
          let decisionResult = null;
          try {
            decisionResult = surface.approvalDecide(id, decision);
          } catch (e) {
            json(res, 500, { ok: false, error: "approval_decide_failed" });
            return;
          }
          if (!decisionResult || decisionResult.ok !== true) {
            json(res, 409, {
              ok: false,
              error: (decisionResult && decisionResult.error) || "approval_decide_failed",
              id,
              decision,
            });
            return;
          }
          appendJsonl(path.join(logDir, "events.jsonl"), {
            channel: "v1_approvals",
            device_id: auth.device_id,
            approval_id: id,
            decision,
            kind: decisionResult.kind,
            at: new Date().toISOString(),
          });
          json(res, 200, {
            ok: true,
            id,
            decision,
            kind: decisionResult.kind || "",
            // "always" 会写一条 allow 规则 —— 这是**授权这台机器**以后做这类事。
            persisted_pattern: decisionResult.persisted_pattern || "",
            device_id: auth.device_id,
            note:
              decision === "always"
                ? "已记下规则:这台机器以后做这类事不再逐次问你。"
                : decision === "deny"
                  ? "已拒绝。什么也没执行。"
                  : "已批准这一次。",
          });
          return;
        }
        json(res, 404, { ok: false, error: "approval_route_not_found" });
      }
      // 配对落地页（只读）：桌面「复制配对链接」复制出去的就是这一页。
      // GET / 与 GET /pair 同页 —— 用户常常只粘得到裸地址，别让他撞 404。
      if (
        (p === "/pair" || p === "/pair/" || p === "/") &&
        (req.method === "GET" || req.method === "HEAD")
      ) {
        const ps = pairingManager.status();
        const isLanOpen = bind.lan === true || host === "0.0.0.0";
        const actualPort = state.port || port;
        let lanRows = [];
        if (isLanOpen) {
          try {
            const ifacesFn =
              typeof opts.networkInterfaces === "function" ? opts.networkInterfaces : () => os.networkInterfaces() || {};
            lanRows = rankLanIPv4(ifacesFn());
          } catch (_) {
            /* 读不到网卡 ≠ 没有网卡：页面照出，列表留空，由 stateLine 说「没读到本机 IPv4」。 */
            lanRows = [];
          }
        }
        html(
          res,
          200,
          pairPageHtml({
            name: os.hostname(),
            port: actualPort,
            lanOpen: isLanOpen,
            lan: lanRows,
            codeActive: Boolean(ps.code_active),
          }),
        );
        return;
      }

      // Pairing-v1: discover (no auth, no token leakage).
      if (p === "/v1/pair/discover" && req.method === "GET") {
        const ps = pairingManager.status();
        json(res, 200, {
          ok: true,
          service: "bitbot-desktop",
          name: os.hostname(),
          version: 1,
          port: state.port || port,
          pairing: {
            code_active: Boolean(ps.code_active),
            expires_in_ms: ps.code_active ? Number(ps.expires_in_ms) || 0 : 0,
          },
        });
        return;
      }

      // Pairing-v1: redeem (no bearer, but requires valid 6-digit code).
      if (p === "/v1/pair/redeem" && req.method === "POST") {
        // LAN must be open for redeem to succeed (409 if not).
        const isLanOpen = bind.lan === true || host === "0.0.0.0";
        if (!isLanOpen) {
          json(res, 409, { ok: false, error: "pairing_not_open" });
          return;
        }
        // Parse body.
        if (!payload || typeof payload !== "object") {
          json(res, 400, { ok: false, error: "bad_request" });
          return;
        }
        const code = String(payload.code || "").trim();
        const deviceName = String(payload.device_name || "").trim();
        const machineKind = String(payload.machine_kind || "").trim();
        if (!code) {
          json(res, 400, { ok: false, error: "bad_request" });
          return;
        }
        if (machineKind !== "android" && machineKind !== "ios") {
          json(res, 400, { ok: false, error: "bad_request" });
          return;
        }
        const redeemResult = pairingManager.redeem(code);
        if (!redeemResult.ok) {
          json(res, 400, { ok: false, error: redeemResult.error });
          return;
        }
        // Success: return the existing 64-char turn token + base_url.
        // Use lan_candidates ranking (192.168 > 10/8 > 172.16/12, docker0/virtual last,
        // 169.254 bottom) instead of raw os.networkInterfaces() enumeration order.
        const actualPort = state.port || port;
        const localHost = host === "0.0.0.0" ? "127.0.0.1" : host;
        let baseUrl = `http://${localHost}:${actualPort}`;
        let baseScope = "loopback";
        try {
          const ifacesFn = typeof opts.networkInterfaces === "function" ? opts.networkInterfaces : () => os.networkInterfaces() || {};
          const ranked = rankLanIPv4(ifacesFn());
          if (ranked.length) {
            baseUrl = `http://${ranked[0].ip}:${actualPort}`;
            baseScope = ranked[0].scope || classifyScope(ranked[0].ip);
          }
        } catch (_) { /* fallback to loopback */ }
        json(res, 200, {
          ok: true,
          turn_token: turnToken,
          base_url: baseUrl,
          base_url_scope: baseScope,
          expires_in_ms: 0,
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
        // ADR 0008: no Authorization and no valid signature → 401, no wake.
        // B-4a:登记了设备就走设备凭证(带机器身份);没登记才回落共享 turn token。
        const hasDevices = (deviceStore.devices || []).length > 0;
        const auth = hasDevices
          ? deviceKeys.verifyDeviceTurn(deviceStore, req, raw, { nonceStore })
          : p0.verifyTurnAuth(req, raw, turnToken, nonceStore);
        if (!auth.ok) {
          const error =
            auth.error === "invalid_token" ||
            auth.error === "bad_signature" ||
            auth.error === "missing_signature" ||
            auth.error === "stale_timestamp" ||
            auth.error === "nonce_reused" ||
            auth.error === "turn_token_unconfigured"
              ? auth.error
              : "unauthorized";
          json(res, 401, { ok: false, error });
          return;
        }
        const text =
          (payload && (payload.text || payload.message || payload.prompt)) ||
          raw.toString("utf8").trim();
        // 机器身份来自**凭证**,不是 payload —— payload 说自己是桌面也没用。
        const machineKind =
          (auth && auth.kind) ||
          (payload && (payload.machine_kind || payload.machineKind)) ||
          "mobile";
        const sessionId =
          (payload && (payload.session_id || payload.sessionId)) ||
          `mobile-${machineKind}`;
        if (!String(text || "").trim()) {
          json(res, 400, { ok: false, error: "empty text" });
          return;
        }
        state.counts.other += 1;
        // 过了鉴权的回合 = 这台设备真实存在的证据（内核的 seed 花名册不知道这事）。
        // 401 走不到这里，所以扫端口的人点不亮花名册。
        try {
          const { seedMachineId } = require("./cn_inbound_product_on_turn");
          require("./machine_presence").recordMachinePresence(repoRoot, {
            machineId: seedMachineId(machineKind),
            machineKind,
            source: "v1_turn",
          });
        } catch {
          /* 记账失败不改变这次回合的结果 */
        }
        const enq = await enqueueTurn(machineKind, String(text), {
          session_id: sessionId,
          source: "v1_turn",
          machine_kind: machineKind,
          // B-2 + B-4a: 机器身份来自凭证(设备 id),不是 payload。
          device_id: (auth && auth.device_id) || "",
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
          // B-4a:回执带上设备身份(来自凭证)。
          device_id: (auth && auth.device_id) || "",
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
          "GET /pair（配对说明页）",
          "POST /dingtalk/callback",
          "POST /feishu/event",
          "GET|POST /wecom/callback",
          "POST /v1/turn",
          "GET /v1/pair/discover",
          "POST /v1/pair/redeem",
          "GET /health",
        ],
      });
    } catch (err) {
      json(res, 500, {
        ok: false,
        error: p0.scrubSecrets(String(err && err.message ? err.message : err), process.env),
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
        const addr = server.address();
        if (addr && typeof addr === "object" && addr.port) state.port = addr.port;
        state.listening = true;
        state.started_at = new Date().toISOString();
        process.stdout.write(
          `[cn-inbound] http://${host}:${state.port} /dingtalk|/feishu|/wecom (product; cloud residual until public URL)\n`,
        );
        if (bind.warn) {
          process.stderr.write(
            `[cn-inbound] WARNING: bind ${host} is not loopback. /v1/turn requires a bearer token. ` +
              "Set BITBOT_BIND_LAN=1 only when LAN pairing is intentional.\n",
          );
        }
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
    const shownPort = state.port || port;
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
        dingtalk: `${publicUrl || `http://${localHost}:${shownPort}`}/dingtalk/callback`,
        feishu: `${publicUrl || `http://${localHost}:${shownPort}`}/feishu/event`,
        wecom: `${publicUrl || `http://${localHost}:${shownPort}`}/wecom/callback`,
        turn: `${publicUrl || `http://${localHost}:${shownPort}`}/v1/turn`,
      },
      pretend_cloud: false,
      bind_source: bind.source,
      lan: bind.lan,
      turn_auth: "bearer",
      turn_token_source: turnAuth.source,
      max_body_bytes: maxBody,
      residual: publicUrl
        ? "public tunnel up — still need BITBOT_*_POST=1 + channel console config"
        : "needs public HTTPS URL (scripts/cn_inbound_tunnel.sh) + channel app credentials",
    };
  }

  return { start, stop, status, server, pairingManager };
}

module.exports = { createCnInboundServer };
