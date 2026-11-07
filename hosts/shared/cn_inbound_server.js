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
const crypto = require("crypto"); // A2-1：算设备公钥指纹（device id 由它派生）
const { URL } = require("url");
const p0 = require("./p0_security");
const deviceKeys = require("./device_keys");
const { createProductSurfaceRef } = require("./product_surface_ref");
const { createPairingCodeManager } = require("./desktop_pairing");

/**
 * A2-4：把设备鉴权的失败码翻成一句给用户看的话。
 * 只**加**字段，不改 `error` 本身 —— 既有门禁与客户端都按 `error` 分支。
 */
function describeDeviceAuthFailure(code, req) {
  const hasBearer = Boolean(req && req.headers && /^Bearer /i.test(String(req.headers.authorization || "")));
  const base = {
    no_devices_registered: "这台机器还没有登记任何设备",
    missing_device_credential: hasBearer
      ? "这台机器现在只认设备签名，Bearer 令牌不再够（配对成功的手机需要重新配对以登记公钥）"
      : "请求缺少设备凭证头（x-bitbot-device / timestamp / nonce / signature）",
    unknown_device: "登记表里没有这台设备（可能已吊销，或配到了另一台机器）",
    stale_timestamp: "设备时间戳与本机相差太大",
    nonce_reused: "这个 nonce 被用过（重放保护）",
    bad_signature: "设备签名验不过",
  }[String(code || "")];
  return base || "设备凭证校验未通过：" + String(code || "unauthorized");
}

/**
 * A2-4（同一口径延伸到 redeem）：公钥被拒时，只给机器码的话手机只能贴「请求格式不对，请重试」，
 * 而这几种情况用户必须分得清：手机钥匙文件坏了 / 桌面版本不认这种钥匙 / 桌面登记表根本写不进去。
 * 仍然只**加**字段：`error` 的取值一字不动（WD-05 与手机都在按它分支）。
 */
function describeRedeemDeviceKeyFailure(code) {
  const m = {
    bad_device_public_key: [
      "手机交来的公钥读不成（PEM 或格式不对）",
      "在手机「凭证」里清掉本机设备身份后重新配对一次；若仍失败，请把手机与桌面两侧的版本一起报出来",
    ],
    device_key_not_ed25519: [
      "手机交来的公钥不是 ed25519 密钥",
      "这台桌面只接受 ed25519 设备钥匙：请更新手机端配对实现，或先在桌面「设备」里吊销这台设备再重新配对",
    ],
    device_store_unreadable: [
      "桌面的设备登记表读不出来",
      "这是桌面侧的问题：请检查 data/desktop/devices.json 是否被改坏或权限不可读",
    ],
    device_store_unwritable: [
      "桌面的设备登记表写不进去",
      "这是桌面侧的问题：设备登记不上，配对不会成；请检查桌面数据目录的写权限后重试",
    ],
  }[String(code || "")];
  if (!m) return {};
  return { error_description: m[0], next_step: m[1] };
}

/** A2-2：登记表文件的 mtime（毫秒）。文件不存在/读不到 → -1，与「有文件」天然区分。 */
function statMtime(file) {
  try {
    return Math.floor(fs.statSync(file).mtimeMs);
  } catch (_) {
    return -1;
  }
}
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

/* ── 手机端「关联机器人」页（扫码打开的就是这一页）─────────────────────
 * 为什么是普通 <form> 而不是 fetch：这一页的 CSP 是 default-src 'none'，
 * 没有脚本可跑；而且手机浏览器/内置 WebView 关掉 JS 的情况下也该能用。
 * 表单 POST 是唯一在「无 JS + 无第三方脚本」下还能工作的提交通道。
 * 页面里没有任何厂商 SDK，也不放二维码 —— 它是被扫的那一头。 */
function bindFormFieldsHtml(fields, values) {
  const v = values || {};
  return (fields || [])
    .map((f) => {
      const name = escHtml(f.env);
      const label = escHtml(f.label);
      const type = f.type === "password" ? "password" : "text";
      const hint = f.hint ? '<p class="hint">' + escHtml(f.hint) + "</p>" : "";
      const req = f.required ? ' required' : "";
      const cur = v[f.env] != null ? escHtml(String(v[f.env])) : "";
      /* 密码类不回填：提交失败重渲染时把用户刚粘的凭据再吐回 DOM 没必要。 */
      const val = type === "password" || !cur ? "" : ' value="' + cur + '"';
      return (
        "<label><span>" + label + (f.required ? ' <em>必填</em>' : " <i>可选</i>") + "</span>" +
        '<input type="' + type + '" name="' + name + '"' + val + req +
        ' autocomplete="off" autocapitalize="off" spellcheck="false">' +
        hint +
        "</label>"
      );
    })
    .join("");
}

function bindPageHtml(info) {
  const host = escHtml(info.host || "Desktop");
  const chName = escHtml(info.channel_name || "");
  const token = escHtml(info.token || "");
  const channel = escHtml(info.channel || "");
  const ttlMin = Math.max(1, Math.round((Number(info.ttl_left_ms) || 0) / 60000));
  const problems = Array.isArray(info.problems) ? info.problems : [];
  const problemHtml = problems.length
    ? '<section class="bad"><h2>这几栏还要改</h2><ul class="plain">' +
      problems
        .map((p) => "<li><b>" + escHtml(p.field) + "</b>：" + escHtml(p.message) + "</li>")
        .join("") +
      "</ul></section>"
    : "";
  return (
    "<!doctype html>\n" +
    '<html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    "<title>关联 " + chName + " · " + host + "</title>" +
    "<style>" +
    ":root{color-scheme:light dark}" +
    "body{margin:0;padding:24px 18px 40px;background:#f6f6f4;color:#1c1c1a;" +
    "font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}" +
    "main{max-width:520px;margin:0 auto}" +
    "h1{font-size:19px;margin:0 0 4px}" +
    ".sub{margin:0 0 18px;color:#6b6b66;font-size:14px}" +
    "section{background:#fff;border:1px solid #e2e2dd;border-radius:12px;padding:16px;margin-bottom:12px}" +
    "section.bad{background:#fdf1f0;border-color:#e8bdb8}" +
    "h2{font-size:14px;margin:0 0 8px}" +
    "label{display:block;margin:0 0 14px}" +
    "label>span{display:block;font-size:13px;color:#3c3c38;margin-bottom:5px}" +
    "label em{font-style:normal;color:#b3261e;font-size:11px;margin-left:4px}" +
    "label i{font-style:normal;color:#8a8a84;font-size:11px;margin-left:4px}" +
    "input{width:100%;box-sizing:border-box;padding:11px 12px;font-size:16px;" +
    "border:1px solid #d8d8d2;border-radius:9px;background:#fff;color:#1c1c1a}" +
    "input:focus{outline:2px solid #1c1c1a;outline-offset:1px}" +
    ".hint{margin:5px 0 0;font-size:12px;color:#7a7a74;line-height:1.45}" +
    "button{width:100%;padding:13px;font-size:16px;font-weight:600;border:0;border-radius:10px;" +
    "background:#1c1c1a;color:#fff}" +
    ".plain{list-style:none;margin:0;padding:0;font-size:13px}" +
    ".plain li{margin:4px 0}" +
    ".note{margin:14px 0 0;font-size:12px;color:#7a7a74;line-height:1.5}" +
    "@media (prefers-color-scheme:dark){body{background:#141412;color:#eceae6}" +
    "section{background:#1d1d1b;border-color:#2c2c29}section.bad{background:#2a1b19;border-color:#5a2f2a}" +
    "label>span{color:#c9c5be}input{background:#141412;border-color:#3a3a35;color:#eceae6}" +
    "button{background:#eceae6;color:#141412}.sub,.hint,.note{color:#9a978f}}" +
    "</style></head><body><main>" +
    "<h1>关联 " + chName + "</h1>" +
    '<p class="sub">这台桌面是 <strong>' + host + "</strong> · 这一页 " + ttlMin + " 分钟内有效</p>" +
    problemHtml +
    "<section><h2>把凭据填在这里</h2>" +
    '<form method="post" action="/v1/bind/claim">' +
    '<input type="hidden" name="t" value="' + token + '">' +
    '<input type="hidden" name="ch" value="' + channel + '">' +
    bindFormFieldsHtml(info.fields, info.values) +
    "<button type=\"submit\">保存并关联</button></form>" +
    '<p class="note">提交后桌面那边会自动变成「已关联」，不用回去再点一次。' +
    "凭据只写进这台桌面的本地配置，不经过任何第三方；提交一次这条链接就失效。</p>" +
    "</section></main></body></html>"
  );
}

function bindResultHtml(info) {
  const ok = info.ok === true;
  const host = escHtml(info.host || "Desktop");
  const chName = escHtml(info.channel_name || "");
  const msg = escHtml(info.message || "");
  return (
    "<!doctype html>\n" +
    '<html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + (ok ? "已关联" : "没有保存") + " · " + host + "</title>" +
    "<style>" +
    ":root{color-scheme:light dark}" +
    "body{margin:0;padding:40px 20px;background:#f6f6f4;color:#1c1c1a;" +
    "font:15px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}" +
    "main{max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e2dd;" +
    "border-radius:12px;padding:22px}" +
    "h1{font-size:18px;margin:0 0 8px}" +
    "p{margin:0 0 8px;color:#4a4a45;font-size:14px}" +
    ".k{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;" +
    "border:1px solid #d8d8d2;color:#6b6b66;margin-bottom:12px}" +
    "@media (prefers-color-scheme:dark){body{background:#141412;color:#eceae6}" +
    "main{background:#1d1d1b;border-color:#2c2c29}p{color:#bdb9b2}.k{border-color:#3a3a35;color:#9a978f}}" +
    "</style></head><body><main>" +
    '<div class="k">' + (ok ? "已关联" : "未保存") + "</div>" +
    "<h1>" + (ok ? chName + " 已关联到这台桌面" : "这次没有保存成功") + "</h1>" +
    "<p>" + msg + "</p>" +
    "<p>" + (ok ? "可以回到桌面了：那一栏会自己变成「已关联」。" : "回桌面重新生成二维码再扫一次。") + "</p>" +
    "</main></body></html>"
  );
}

/* 失败原因说人话，且不泄漏「哪个 token 存在过」——未知 / 过期 / 用过
 * 对使用者是同一件事：回桌面重新生成。 */
function bindErrorCopy(error) {
  switch (String(error || "")) {
    case "bind_token_unknown":
    case "bind_token_expired":
    case "bind_token_used":
      return "这条关联链接已经失效（过期或已用过一次）。回桌面重新生成二维码再扫。";
    case "bind_channel_mismatch":
      return "这条链接不是给这个渠道的。回桌面重新生成二维码。";
    case "bind_channel_not_bindable":
      return "这个渠道不支持扫码关联。";
    case "bind_field_invalid":
      return "有几栏还要改，改完再提交一次。";
    default:
      return "没有保存成功（" + String(error || "unknown") + "）。回桌面重新生成二维码再试。";
  }
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

  /* A3-6：配对成功时把这台桌面的**中转四栏**交给手机 —— 这就是「跨网参数从哪来」的答案。
   *
   * 为什么由桌面下发、而不是让用户手填：中转地址/boxId/客户端凭证三样都不该由用户记；
   * 桌面本来就知道自己接在哪个中转上。手机在局域网里配一次对，之后离开这个 Wi-Fi 也能找回桌面。
   *
   * 三条约束（都对着门禁 PH-01..PH-05）：
   *  1. **没配就不出现** —— `relay` 是可选新增字段，老客户端与老门禁读到的回执一字不变；
   *  2. **四栏缺一整体不下发** —— 给一半比不给更坏：手机拿半套去连，报一个查不出来的错；
   *  3. **只放四栏** —— 不夹带 turn_token / relay-secret，跨网不复用配对令牌。
   *
   * `opts.relayHandoff` 一旦给出就以它为准（函数返回 null 或对象本身就是 null ⇒ 不下发），
   * 只有调用方根本没提这件事时才读环境变量。这样门禁能确定地扮演「没配 / 配齐 / 配半套」，
   * 不会被开发机上恰好存在的环境变量污染。 */
  function normalizeRelayHandoff(raw) {
    if (!raw || typeof raw !== "object") return null;
    const host = String(raw.host || "").trim();
    const port = Number(raw.port);
    const boxId = String(raw.boxId || raw.box_id || "").trim();
    const clientToken = String(raw.clientToken || raw.client_token || "").trim();
    if (!host) return null;
    // port 必须是真的端口：`Number("abc")` 是 NaN，`18766.5` 也不是端口。
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    if (!boxId || !clientToken) return null;
    return { host, port, box_id: boxId, client_token: clientToken };
  }

  function relayHandoffFromEnv() {
    return normalizeRelayHandoff({
      host: process.env.BITBOT_RELAY_HOST,
      port: process.env.BITBOT_RELAY_PORT,
      boxId: process.env.BITBOT_RELAY_BOX_ID,
      clientToken: process.env.BITBOT_RELAY_CLIENT_TOKEN,
    });
  }

  function currentRelayHandoff() {
    try {
      if (opts.relayHandoff !== undefined) {
        const raw =
          typeof opts.relayHandoff === "function" ? opts.relayHandoff() : opts.relayHandoff;
        return normalizeRelayHandoff(raw);
      }
      return relayHandoffFromEnv();
    } catch (_e) {
      // 下发失败不能拖垮配对：宁可这次不给中转参数，也要让局域网配对上。
      return null;
    }
  }

  const nonceStore = p0.createNonceStore();
  // B-4a:设备登记表。**只有公钥**。登记了设备 ⇒ 入站回合必须出示设备凭证
  // (ADR 0008 的共享 turn token 不再授予设备身份);没登记 ⇒ 沿用既有
  // turn token 合同,现有部署不受影响。
  const devicesPath =
    String(opts.devicesPath || process.env.BITBOT_DEVICES_PATH || "") ||
    path.join(repoRoot, "data", "host", "devices.json");
  // A2-2（W3）：登记表必须**热生效**。上一版这里只在启动时 loadDevices() 一次，
  // 于是「配对即登记」「桌面点吊销」都要重启桌面才成立 —— 而用户看到的是
  // 「手机上明明配对了，机器却说没这台设备」。
  //
  // 做法是**按请求惰性重载**，而不是 setInterval 轮询：
  //   · 门禁脚本里那些「起服务、跑断言、退出」的 Node 测试不会被一个活定时器拖住
  //     （要定时器也得 unref()，那是给门禁加不必要的寿命）；
  //   · 真正的代价只有一个 TTL 窗口：默认 2s，最大 30s 的验收线（WD-03/04）远远够；
  //   · 到期就重读整份表（登记表只有几行 JSON），**不**拿 mtime 当「没变就不用读」的依据 ——
  //     那版优化被实测否掉了，原因写在 deviceStoreNow 里。
  // 自己写盘的那条路（redeem 登记）必须**立刻**让缓存失效，否则刚登记完就发回合会 401。
  let deviceStore = deviceKeys.loadDevices(devicesPath);
  let deviceStoreMtime = statMtime(devicesPath);
  let deviceStoreCheckedAt = Date.now();
  const DEVICE_RELOAD_TTL_MS = Math.max(
    0,
    Number(process.env.BITBOT_DEVICES_RELOAD_TTL_MS || 2000),
  );
  /** 本轮登记/吊销之后强制重读（不等 TTL）。 */
  function invalidateDeviceStore() {
    deviceStoreCheckedAt = 0;
  }
  function deviceStoreNow() {
    const now = Date.now();
    if (now - deviceStoreCheckedAt < DEVICE_RELOAD_TTL_MS) return deviceStore;
    deviceStoreCheckedAt = now;
    // 「先比 mtime、变了才重读」是这一刀的第一版，它被实测否掉了：
    // 这块盘上两次写入落在同一个毫秒里（statSync 的 mtimeMs 一模一样，而文件大小从 26 变 124），
    // 于是 mtime 永远「没变」，WD-03 那条「加设备后 ≤30s 热生效」一直红。
    // 登记表就几行 JSON，稳态每 TTL 读一次不是负担；而漏掉一次吊销是安全问题。
    // 结论：**到期就重读**，不做「看起来没变」的优化 —— 优化不能把正确性押在时钟精度上。
    deviceStoreMtime = statMtime(devicesPath);
    deviceStore = deviceKeys.loadDevices(devicesPath);
    return deviceStore;
  }
  /**
   * A2-1：把 redeem 收到的公钥登进设备表。
   * 只存公钥；id 由公钥指纹派生（同 key 重复配对 → 同一个 id，幂等，不产生第二行）。
   * 写盘走既有的 deviceKeys.saveDevices —— 登记表 JSON 的形状一字不改。
   */
  function registerDeviceFromRedeem(input) {
    const pem = String((input && input.publicKeyPem) || "").trim();
    const kind = String((input && input.kind) || "mobile");
    if (!pem) return { ok: false, error: "no_device_public_key" };
    let der = null;
    try {
      const key = crypto.createPublicKey(pem);
      if (key.asymmetricKeyType !== "ed25519") {
        return { ok: false, error: "device_key_not_ed25519" };
      }
      der = key.export({ type: "spki", format: "der" });
    } catch (_) {
      return { ok: false, error: "bad_device_public_key" };
    }
    const fingerprint = crypto.createHash("sha256").update(der).digest("hex").slice(0, 12);
    const id = "dev-" + kind + "-" + fingerprint;
    let store;
    try {
      store = deviceKeys.loadDevices(devicesPath);
    } catch (_) {
      return { ok: false, error: "device_store_unreadable" };
    }
    const list = Array.isArray(store.devices) ? store.devices : [];
    const existing = list.find((d) => d && d.id === id);
    const record = {
      id,
      name: String((input && input.name) || id),
      kind,
      public_key_pem: pem,
      created_at: (existing && existing.created_at) || new Date().toISOString(),
      revoked_at: null,
    };
    if (existing) list[list.indexOf(existing)] = record;
    else list.push(record);
    try {
      deviceKeys.saveDevices(devicesPath, { version: store.version, devices: list });
    } catch (_) {
      return { ok: false, error: "device_store_unwritable" };
    }
    // 自己刚写的盘必须立刻可见：否则「配对成功 → 马上发回合」这条最短的路会 401。
    invalidateDeviceStore();
    return { ok: true, device: record };
  }

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

  /* 渠道「扫码关联」：由桌面注入（同一实例要能被 IPC 签发、被这里的 HTTP 消费）。
   * 没注入时相关路由如实 404，不假装有这能力。 */
  const channelBind = opts.channelBind || null;

  // W2/A1-1: 跨端事件流（SSE）的可读句柄。优先用调用方注入的（活路径——
  // 桌面把双写库句柄传进来）；没注入时，仅当默认事件库文件已存在才懒加载它。
  // §5.4 规则4：开关没开时绝不在「加载期」require event_log（旧 Electron 运行时
  // 加载即抛）；这里延到命中路由、且文件确实存在那一刻才 require，并全程 try/catch，
  // 因此非 Node≥22.5 的运行时只会落到 503，不会拖垮整个模块链。
  const eventLog = opts.eventLog || null;
  const eventsDbPath = opts.eventsDbPath
    ? path.resolve(opts.eventsDbPath)
    : path.join(repoRoot, "data", "events", "desktop-events.sqlite");
  let eventLogResolved = false;
  function resolveEventLog() {
    if (eventLog) return eventLog;
    if (eventLogResolved) return null;
    eventLogResolved = true;
    try {
      if (!fs.existsSync(eventsDbPath)) return null; // 没库 = 没事件，诚实 503
      const { openEventLog } = require("./event_log");
      return openEventLog({ file: eventsDbPath, actor: "cn-inbound-sse", busyTimeoutMs: 5000 });
    } catch (_) {
      return null; // node:sqlite 不可用或库打不开 → 路由层转 503，不崩进程
    }
  }

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
      /* 手机端「关联机器人」页是一个无脚本 <form>，提交上来是 urlencoded。
         这里必须单开一支：走下面的 JSON 分支会 parse 失败，页面就永远报错。
         formPost 只是用来决定回执形态（HTML 页 vs JSON），不影响鉴权。 */
      let formPost = false;
      const ct = String(req.headers["content-type"] || "");
      if (raw.length && ct.includes("application/x-www-form-urlencoded")) {
        formPost = true;
        try {
          const sp = new URLSearchParams(raw.toString("utf8"));
          payload = {};
          for (const [k, v] of sp) payload[k] = v;
        } catch (_) {
          payload = null;
        }
      } else if (raw.length && ct.includes("json")) {
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
        const auth = deviceKeys.verifyDeviceTurn(deviceStoreNow(), req, raw, { nonceStore });
        // A2-5：设备密钥鉴权成功 → 落「最近活跃」。失败/legacy token 路径不碰。
        if (auth.ok && auth.device_id) deviceKeys.touchDevice(devicesPath, auth.device_id);
        if (!auth.ok) {
          json(res, 401, {
            ok: false,
            error: auth.error || "unauthorized",
            ...(auth.error_description ? { error_description: auth.error_description } : {}),
            ...(auth.next_step ? { next_step: auth.next_step } : {}),
            ...(auth.device_error ? { device_error: auth.device_error } : {}),
          });
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

      /* ── 扫码关联机器人：手机扫码打开的那一页 + 表单提交 ──────────────
       * 「扫码」在这里的真实含义是**把填凭据这件事搬到手机上**，不是
       * 去厂商那边换授权（钉钉/飞书/企微 没有这种公开能力）。
       * 安全口径：token 一次性 + 5 分钟 + 单渠道；页面无脚本、无第三方资源；
       * 密码类输入不回填；日志不记 token 也不记提交值。 */
      if (p === "/bind" && (req.method === "GET" || req.method === "HEAD")) {
        if (!channelBind) {
          html(res, 404, bindResultHtml({ ok: false, host: os.hostname(), message: "这台桌面没开渠道关联。" }));
          return;
        }
        const tok = String(urlObj.searchParams.get("t") || "");
        const chId = String(urlObj.searchParams.get("ch") || "");
        const pk = channelBind.peek(tok, chId);
        if (!pk.ok) {
          html(res, 410, bindResultHtml({ ok: false, host: os.hostname(), message: bindErrorCopy(pk.error) }));
          return;
        }
        html(
          res,
          200,
          bindPageHtml({
            host: os.hostname(),
            token: tok,
            channel: pk.channel,
            channel_name: pk.name,
            fields: pk.fields,
            ttl_left_ms: pk.ttl_left_ms,
          }),
        );
        return;
      }

      if (p === "/v1/bind/claim" && req.method === "POST") {
        if (!channelBind) {
          json(res, 404, { ok: false, error: "bind_unavailable" });
          return;
        }
        const body = payload && typeof payload === "object" ? payload : {};
        const tok = String(body.t || "");
        const chId = String(body.ch || "");
        const values = {};
        for (const k of Object.keys(body)) {
          if (k !== "t" && k !== "ch") values[k] = body[k];
        }
        const r = await channelBind.claim(tok, { channel: chId, values });
        if (formPost) {
          const hostname = os.hostname();
          if (r.ok) {
            html(
              res,
              200,
              bindResultHtml({
                ok: true,
                host: hostname,
                channel_name: r.name,
                message: "凭据已存进这台桌面的本地配置（" + (r.saved_keys || []).length + " 项）。",
              }),
            );
            return;
          }
          if (r.error === "bind_field_invalid") {
            /* 校验失败不消费 token：改一栏再提交，不该被判过期。 */
            const pk = channelBind.peek(tok, chId);
            if (pk.ok) {
              html(
                res,
                400,
                bindPageHtml({
                  host: hostname,
                  token: tok,
                  channel: pk.channel,
                  channel_name: pk.name,
                  fields: pk.fields,
                  ttl_left_ms: pk.ttl_left_ms,
                  problems: r.problems,
                  values,
                }),
              );
              return;
            }
          }
          html(
            res,
            400,
            bindResultHtml({ ok: false, host: hostname, message: bindErrorCopy(r.error) }),
          );
          return;
        }
        json(res, r.ok ? 200 : 400, r);
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
        // A2-1（W3 / 账号=设备）：配对码换来的不只是「一把共享令牌」，还应把**这台设备**登记上。
        // 只收公钥（私钥永远不出设备），id 由公钥指纹派生 —— 不是客户端自己填的，
        // 否则任何一台 LAN 设备都能声称自己是 phone-desktop-x（身份来自凭证这件事就白做了）。
        // 可选字段：不带 device_public_key 的老客户端行为一字不变（继续只发 turn_token）。
        const devicePublicKey = String(payload.device_public_key || "").trim();
        let deviceReg = null;
        if (devicePublicKey) {
          const reg = registerDeviceFromRedeem({
            publicKeyPem: devicePublicKey,
            kind: machineKind,
            name: deviceName || machineKind + " 设备",
          });
          if (!reg.ok) {
            // 坏公钥 = 配对这件事**没做成**，整体拒（400），不发 bearer。
            // 第一版这里是 200 + device.registered:false + 一个 reason 字段，看着更「兼容」，
            // 实际是把失败推后：设备以为自己配对成功了，拿着 bearer 走进
            // 「登记表非空 ⇒ 只认设备签名」那颗地雷，用户看到的是配好了却什么都干不了。
            // 既然设备明确表达了要当一台设备（带了公钥），失败就必须当场说清楚。
            json(res, 400, {
              ok: false,
              error: reg.error || "bad_device_public_key",
              ...describeRedeemDeviceKeyFailure(reg.error),
            });
            return;
          }
          deviceReg = reg.device;
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
        // 地雷（A2-4）：登记表一旦非空，入站就**只认设备凭证**（:854 那条口径）。
        // 这时候还发一把 bearer 给没登记成功的设备，等于让用户走进一个
        // 「配对了但下不了单、连自己下的单也看不见」的洞 —— 回执必须把这件事说在前面。
        const registryNonEmpty = (deviceStoreNow().devices || []).length > 0;
        const requiresDevice = registryNonEmpty && !deviceReg;
        const redeemBody = {
          ok: true,
          turn_token: turnToken,
          base_url: baseUrl,
          base_url_scope: baseScope,
          expires_in_ms: 0,
          // 以下全是**可选新增字段**，既有形状一字未动（ADR 0008 的 bearer 合同照旧）。
          device: deviceReg
            ? { registered: true, id: deviceReg.id, kind: deviceReg.kind, name: deviceReg.name }
            : { registered: false, reason: "no_device_public_key" },
          requires_device_credential: requiresDevice,
        };
        // A3-6：中转四栏只在**配齐**时出现（PH-01/PH-02/PH-04），且只在成功回执里（PH-05）。
        const handoff = currentRelayHandoff();
        if (handoff) redeemBody.relay = handoff;
        json(res, 200, redeemBody);
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
        const store = deviceStoreNow();
        const hasDevices = (store.devices || []).length > 0;
        const auth = hasDevices
          ? deviceKeys.verifyDeviceTurn(store, req, raw, { nonceStore })
          : p0.verifyTurnAuth(req, raw, turnToken, nonceStore);
        // A2-5：设备密钥鉴权成功 → 落「最近活跃」（legacy token 路径无 device_id，跳过）。
        if (auth.ok && auth.via === "device_key" && auth.device_id) deviceKeys.touchDevice(devicesPath, auth.device_id);
        // A2-4：把这颗地雷说人话。
        // 登记表一非空，这台机器就**只认设备凭证**（B-4a 的口径，代码本身是对的）；
        // 坏的是回执：老客户端手里只有 bearer，它收到的是一串它读不懂的码，
        // 于是用户看到「配对成功了但什么都做不了」。error 字段一字不改（既有合同），
        // 只加 error_description / next_step —— 让手机与桌面能直接把它显示给用户。
        // 注意：既有 `error` 的映射（下面那段三元）一字不改 —— 那是别的门与客户端在分支的字段。
        // 真原因放在**新增字段**里：device_error / error_description / next_step。
        if (!auth.ok && hasDevices) {
          auth.device_error = auth.error || "unauthorized";
          auth.error_description = describeDeviceAuthFailure(auth.error, req);
          auth.next_step =
            auth.error === "missing_device_credential"
              ? "重新配对一次，让这台设备把公钥登记到机器上（之后请求要带设备签名）"
              : auth.error === "unknown_device"
                ? "这台设备不在这台机器的登记表里（可能被吊销或配到了另一台机器），请重新配对"
                : auth.error === "stale_timestamp"
                  ? "设备与这台机器的时间差太大，请校准系统时间后重试"
                  : auth.error === "nonce_reused"
                    ? "这个请求号已经被用过，请重试一次（每次请求要换新 nonce）"
                    : auth.error === "bad_signature"
                      ? "签名验不过：私钥与登记的公钥不是同一对，请重新配对"
                      : "请重新配对这台设备";
        }
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
          json(res, 401, {
            ok: false,
            error,
            // A2-4：既有 error 的映射一字不改，真原因与下一步放新增字段里。
            ...(auth.device_error && auth.device_error !== error
              ? { device_error: auth.device_error }
              : {}),
            ...(auth.error_description ? { error_description: auth.error_description } : {}),
            ...(auth.next_step ? { next_step: auth.next_step } : {}),
          });
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
      // ===== W2 / A1-1: 跨端事件流（SSE，只读）================================
      // 手机/网页订阅这台机器的事件（本地事件库），看得见「现在在干什么」。
      // 鉴权**与 /v1/turn 完全同构**（同一段 hasDevices ? 设备签名 : 共享 bearer）：
      //   配对回给手机的是共享 bearer turn_token（/v1/pair/redeem），手机手里没有
      //   设备私钥；这里只认设备签名的话，真机一连就 401，而两条 Node 门全绿也看不见
      //   （report.md §8.62 的 RP-02 红原文）。同构意味着**不弱于 /v1/turn**：
      //   /v1/turn 拒绝的凭证，这里一样拒绝；登记表非空时 bearer 在两边一起失效（W3/A2-4）。
      // 内容不落云：这里只把本机已落库的事件往外推（后续经 W4 中转也只转发密文）。
      // 没有可读事件库 ⇒ 诚实 503 event_log_unavailable，绝不假装空流通过。
      if (p === "/v1/events") {
        if (req.method !== "GET") {
          json(res, 405, { ok: false, error: "method_not_allowed", allow: "GET" });
          return;
        }
        const store = deviceStoreNow();
        const hasDevices = (store.devices || []).length > 0;
        const auth = hasDevices
          ? deviceKeys.verifyDeviceTurn(store, req, raw, { nonceStore })
          : p0.verifyTurnAuth(req, raw, turnToken, nonceStore);
        // A2-5：设备密钥鉴权成功 → 落「最近活跃」（legacy token 路径无 device_id，跳过）。
        if (auth.ok && auth.via === "device_key" && auth.device_id) deviceKeys.touchDevice(devicesPath, auth.device_id);
        // A2-4：把这颗地雷说人话。
        // 登记表一非空，这台机器就**只认设备凭证**（B-4a 的口径，代码本身是对的）；
        // 坏的是回执：老客户端手里只有 bearer，它收到的是一串它读不懂的码，
        // 于是用户看到「配对成功了但什么都做不了」。error 字段一字不改（既有合同），
        // 只加 error_description / next_step —— 让手机与桌面能直接把它显示给用户。
        // 注意：既有 `error` 的映射（下面那段三元）一字不改 —— 那是别的门与客户端在分支的字段。
        // 真原因放在**新增字段**里：device_error / error_description / next_step。
        if (!auth.ok && hasDevices) {
          auth.device_error = auth.error || "unauthorized";
          auth.error_description = describeDeviceAuthFailure(auth.error, req);
          auth.next_step =
            auth.error === "missing_device_credential"
              ? "重新配对一次，让这台设备把公钥登记到机器上（之后请求要带设备签名）"
              : auth.error === "unknown_device"
                ? "这台设备不在这台机器的登记表里（可能被吊销或配到了另一台机器），请重新配对"
                : auth.error === "stale_timestamp"
                  ? "设备与这台机器的时间差太大，请校准系统时间后重试"
                  : auth.error === "nonce_reused"
                    ? "这个请求号已经被用过，请重试一次（每次请求要换新 nonce）"
                    : auth.error === "bad_signature"
                      ? "签名验不过：私钥与登记的公钥不是同一对，请重新配对"
                      : "请重新配对这台设备";
        }
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
          json(res, 401, {
            ok: false,
            error,
            // A2-4：既有 error 的映射一字不改，真原因与下一步放新增字段里。
            ...(auth.device_error && auth.device_error !== error
              ? { device_error: auth.device_error }
              : {}),
            ...(auth.error_description ? { error_description: auth.error_description } : {}),
            ...(auth.next_step ? { next_step: auth.next_step } : {}),
          });
          return;
        }
        const log = resolveEventLog();
        if (!log || typeof log.readAfter !== "function") {
          json(res, 503, {
            ok: false,
            error: "event_log_unavailable",
            note: "这台机器没有可读的事件库（双写没开或库还没建）。开了之后这里才有流。",
          });
          return;
        }
        // 游标三档，缺一档就有人在手机上连上一轮都看不见：
        //   1) Last-Event-ID —— 断线重连，从那条之后接着推；
        //   2) ?from_seq= —— 显式要历史（门禁、回放、对账用的就是这一档）；
        //   3) 两个都不带 —— **从当前队尾开始，只推订阅之后的新事件**。
        // 第 3 档以前是 from_seq=0（全量重放），那是个真 bug：手机每个回合都是
        // 「先订阅、再发回合」，重放会先把**上一回合**的 turn_started/progress/
        // turn_ended 倒灌进来 —— 客户端按契约在 turn_ended 时关流，于是第二轮起
        // 用户看到的是上一轮的进度，而这一轮的帧一条都收不到。
        // 这也是 SSE 的常规语义：不带游标 = 订阅实况，要历史请显式带游标。
        const lastEventId = String(req.headers["last-event-id"] || "").trim();
        const fromSeqParam = urlObj.searchParams.get("from_seq");
        let fromSeq = Number(fromSeqParam || 0);
        let cursorGiven = fromSeqParam !== null && fromSeqParam !== "";
        if (/^[0-9]+$/.test(lastEventId)) {
          fromSeq = Number(lastEventId);
          cursorGiven = true;
        }
        if (!Number.isFinite(fromSeq) || fromSeq < 0) fromSeq = 0;
        if (!cursorGiven) {
          // 队尾：log.lastSeq() 是 MAX(seq)，没有事件时是 0（首次使用不受影响）。
          fromSeq = typeof log.lastSeq === "function" ? Number(log.lastSeq()) : 0;
          if (!Number.isFinite(fromSeq) || fromSeq < 0) fromSeq = 0;
        }
        // A1-3 附带：可选 session 过滤。库里 readAfter 早就支持 sessionId，这里只是把
        // 它接出来 —— 不传时**行为与之前一字不变**（全量），传了才只推这一个 session。
        // 为什么必须有：同一台大脑上多个 session 是常态（桌面本地 + 手机 + 网页），
        // 手机订自己的回合却看到别人的对话行，那是跨会话泄漏，不是「便利」。
        // 注意这只解决「看得见谁」，没解决「谁有权订」—— 后者是账号=设备（W3/A2-3）的活。
        const onlySession = String(urlObj.searchParams.get("session_id") || "").trim();

        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write("retry: 3000\n\n");
        let closed = false;
        let lastSent = fromSeq;
        const sendEv = (ev) => {
          if (closed) return;
          const seq = Number(ev.seq);
          let payload = ev.payload;
          if (typeof payload === "string") {
            try { payload = JSON.parse(payload); } catch (_) { /* 保留原串 */ }
          }
          res.write("id: " + seq + "\n");
          if (ev.kind) res.write("event: " + ev.kind + "\n");
          res.write(
            "data: " +
              JSON.stringify({
                seq,
                sessionId: ev.sessionId,
                turnId: ev.turnId,
                kind: ev.kind,
                payload,
                actor: ev.actor,
                ts: ev.ts,
              }) +
              "\n\n",
          );
          if (seq > lastSent) lastSent = seq;
        };
        const snapshot = () => {
          try {
            const batch = log.readAfter({
              fromSeq: lastSent,
              limit: 5000,
              ...(onlySession ? { sessionId: onlySession } : {}),
            });
            for (const ev of batch) sendEv(ev);
          } catch (e) {
            if (!closed) res.write(": read error: " + String((e && e.message) || e) + "\n\n");
          }
        };
        snapshot();
        const heartbeat = setInterval(() => {
          if (closed) return;
          try { res.write(": ping " + Date.now() + "\n\n"); } catch (_) {}
        }, 15000);
        const tail = setInterval(() => {
          if (closed) return;
          snapshot();
        }, 1500);
        const cleanup = () => {
          if (closed) return;
          closed = true;
          try { clearInterval(heartbeat); } catch (_) {}
          try { clearInterval(tail); } catch (_) {}
          try { res.end(); } catch (_) {}
        };
        req.on("close", cleanup);
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
          "GET /v1/events（SSE 事件流，需设备凭证）",
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

  /**
   * 强制下次读设备表时重盘（A2-5 吊销一台设备后让入口立即热生效，不等 TTL）。
   * deviceStoreNow 内部有 TTL 兜底，这里只是把倒计时清零，不是另起一条加载路径。
   */
  function refreshDeviceStore() {
    deviceStoreCheckedAt = 0;
  }

  return { start, stop, status, server, pairingManager, refreshDeviceStore };
}

module.exports = { createCnInboundServer };
