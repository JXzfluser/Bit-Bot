#!/usr/bin/env node
"use strict";
/**
 * detect_public_ip.js — A3-17 公网出口探测
 *
 * 为什么需要它：setup_public_relay.js 要一个「手机在蜂窝网下够得到」的 host，
 * 但这台桌面在 NAT 后面，公网出口 IP 并不在任何一张网卡上。让用户自己去
 * 搜索「我的 IP」再手抄，是最容易抄错的环节之一。
 *
 * 这里做三件小事：
 *   1. 依次问多个公共回显源，取第一个返回**合法 IPv4** 的结果；
 *   2. 读本机网卡 IPv4，用 relay_host_audit.classifyHost 的口径判断出口 IP
 *      是否就落在某张网卡上（在 = 没有 NAT；不在 = 需要端口映射）；
 *   3. 全部失败时**不编造**，把每个源的失败原因原样带回去。
 *
 * 纯 Node、无依赖。网络请求走 http/https（不依赖全局 fetch，老 Node 也能跑），
 * 每个源 3 秒超时；门禁通过 opts.fetchImpl 注入替身，完全离线。
 *
 * 用法：
 *   node scripts/detect_public_ip.js
 *   node scripts/detect_public_ip.js --json --timeout 2000
 *
 * 可被 require：require("./detect_public_ip.js").detectPublicIPv4({ fetchImpl })
 */
const os = require("os");
const http = require("http");
const https = require("https");
const path = require("path");

const { classifyHost, localIPv4List } = require(path.join(__dirname, "../hosts/shared/relay/relay_host_audit.js"));

/** 回显源按「通常最快 / 最稳定」排；每个都只回一行纯文本。 */
const SOURCES = [
  "https://api.ipify.org",
  "https://ifconfig.me/ip",
  "https://icanhazip.com",
  "http://ip.3322.net",
];

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_BODY_BYTES = 512;

/** 严格 IPv4：四段十进制、每段 0..255，且整体就是这一个 token。 */
function isIPv4(s) {
  const v = String(s || "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) &&
    v.split(".").every((p) => Number(p) >= 0 && Number(p) <= 255);
}

/**
 * 从响应体里取 IP。
 * 允许多一个行尾换行（icanhazip / ifconfig.me 都带），但**多行 / HTML / JSON /
 * 空 body 一律不认** —— 被运营商劫持成门户页时，绝不能把页面里的数字当 IP。
 */
function parseIPv4Body(body) {
  const lines = String(body == null ? "" : body)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 1) return "";
  return isIPv4(lines[0]) ? lines[0] : "";
}

/** 默认网络实现：GET 纯文本，带连接 + 响应总超时，永远 resolve。 */
function httpGetText(url, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let req = null;
    let timer = null;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };

    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      finish({ ok: false, status: 0, error: "bad_url" });
      return;
    }
    const mod = parsed.protocol === "https:" ? https : http;
    try {
      req = mod.get(parsed, {
        headers: { "user-agent": "bitbot-detect-public-ip/1", accept: "text/plain" },
      }, (res) => {
        const status = Number(res.statusCode) || 0;
        if (status < 200 || status >= 300) {
          res.resume();
          finish({ ok: false, status, error: "http_" + status });
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => {
          body += d;
          if (body.length > MAX_BODY_BYTES) {
            try { res.destroy(); } catch (_) {}
            finish({ ok: false, status, error: "body_too_large" });
          }
        });
        res.on("end", () => finish({ ok: true, status, body }));
        res.on("error", (e) => finish({ ok: false, status, error: String((e && e.message) || e) }));
      });
    } catch (e) {
      finish({ ok: false, status: 0, error: String((e && e.message) || e) });
      return;
    }

    timer = setTimeout(() => {
      try { if (req) req.destroy(); } catch (_) {}
      finish({ ok: false, status: 0, error: "timeout" });
    }, timeoutMs);
    req.on("error", (e) => finish({ ok: false, status: 0, error: String((e && e.message) || e) }));
    // 连接阶段的空闲超时（DNS / TCP / TLS 都可能卡住）。
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(); } catch (_) {}
      finish({ ok: false, status: 0, error: "timeout" });
    });
  });
}

/** 把注入的 fetchImpl 的多种返回形状归一成 { ok, status, body|error }。 */
async function callFetch(fetchImpl, url, timeoutMs) {
  let r;
  try {
    r = await fetchImpl(url, timeoutMs);
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  }
  if (r == null) return { ok: false, status: 0, error: "no_response" };
  if (typeof r === "string") return { ok: true, status: 200, body: r };
  if (typeof r !== "object") return { ok: false, status: 0, error: "unsupported_response" };

  const status = Number(r.status) || 0;
  if (r.ok === false) {
    return { ok: false, status, error: r.error ? String(r.error) : "http_" + (status || "error") };
  }
  if (typeof r.text === "function") {
    try {
      return { ok: true, status: status || 200, body: String(await r.text()) };
    } catch (e) {
      return { ok: false, status, error: String((e && e.message) || e) };
    }
  }
  if (typeof r.body === "string") return { ok: true, status: status || 200, body: r.body };
  if (r.body != null) return { ok: true, status: status || 200, body: String(r.body) };
  return { ok: false, status: 0, error: "unsupported_response" };
}

/**
 * 探测公网出口 IPv4。
 *
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl]   注入 (url, timeoutMs) => {ok,status,body|text()}
 * @param {string[]} [opts.sources]     覆盖默认回显源（门禁用）
 * @param {object}   [opts.interfaces]  注入 os.networkInterfaces() 形状（门禁用）
 * @param {number}   [opts.timeoutMs]   单源超时，默认 3000
 * @returns {Promise<{ok:boolean, ip:string, source:string,
 *   localInterfaces:Array<{address:string,name:string}>, natDetected:boolean,
 *   tried:Array<{url:string,error:string}>, ipKind:string, onLocalInterface:boolean,
 *   reason?:string}>}
 */
async function detectPublicIPv4(opts) {
  const o = opts || {};
  const sources = Array.isArray(o.sources) && o.sources.length
    ? o.sources.map(String)
    : SOURCES.slice();
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const interfaces = o.interfaces && typeof o.interfaces === "object"
    ? o.interfaces
    : os.networkInterfaces() || {};
  const locals = localIPv4List(interfaces);
  const fetchImpl = typeof o.fetchImpl === "function" ? o.fetchImpl : httpGetText;

  const tried = [];
  let ip = "";
  let source = "";

  for (const url of sources) {
    const r = await callFetch(fetchImpl, url, timeoutMs);
    if (!r.ok) {
      tried.push({ url, error: r.error || "http_error" });
      continue;
    }
    const got = parseIPv4Body(r.body);
    if (!got) {
      tried.push({ url, error: "invalid_body" });
      continue;
    }
    ip = got;
    source = url;
    break;
  }

  const kind = ip ? classifyHost(ip).kind : "empty";
  const onNic = Boolean(ip) && locals.some((a) => a.address === ip);
  const out = {
    ok: Boolean(ip),
    ip,
    source,
    localInterfaces: locals,
    // 有出口 IP 且它不在本机任何网卡上，才是「路由器后面」。
    natDetected: Boolean(ip) && !onNic,
    tried,
    ipKind: kind,
    onLocalInterface: onNic,
  };
  if (!ip) out.reason = "all_sources_failed";
  return out;
}

const HELP = [
  "用法: node scripts/detect_public_ip.js [--json] [--timeout <ms>]",
  "",
  "  依次询问 " + SOURCES.length + " 个回显源，取第一个合法 IPv4；",
  "  再和本机网卡比对，判断出口 IP 是否需要路由器端口映射。",
  "  全部失败时如实列出每个源的原因，不编造 IP。",
].join("\n");

function formatHuman(r) {
  const lines = ["== 公网出口探测 =="];
  if (!r.ok) {
    lines.push("  结果      : 失败（没有取到合法 IPv4，未编造地址）");
    r.tried.forEach((t) => lines.push("  - " + t.url + " → " + t.error));
    return lines.join("\n");
  }
  const ifaces = r.localInterfaces.length
    ? r.localInterfaces.map((a) => a.name + "=" + a.address).join(", ")
    : "(无)";
  lines.push("  出口 IP   : " + r.ip + "  [" + r.ipKind + "]");
  lines.push("  来源      : " + r.source);
  lines.push("  本机网卡  : " + ifaces);
  if (r.natDetected) {
    lines.push("  判定      : 出口 IP 不在本机网卡上 → 处于 NAT 后面，需要 TCP 端口映射");
  } else {
    lines.push("  判定      : 出口 IP 就在本机网卡上 → 无需端口映射（公网直连 / 桥接）");
  }
  if (r.tried.length) {
    lines.push("  先前失败  : " + r.tried.map((t) => t.url + "(" + t.error + ")").join(", "));
  }
  return lines.join("\n");
}

async function cli(argv) {
  const args = argv || [];
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const timeoutAt = args.indexOf("--timeout");
  const timeoutMs = timeoutAt >= 0 ? Number(args[timeoutAt + 1]) : DEFAULT_TIMEOUT_MS;
  const r = await detectPublicIPv4({ timeoutMs });
  if (args.includes("--json")) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(formatHuman(r));
  }
  return r.ok ? 0 : 1;
}

module.exports = {
  detectPublicIPv4,
  parseIPv4Body,
  isIPv4,
  httpGetText,
  SOURCES,
  DEFAULT_TIMEOUT_MS,
};

if (require.main === module) {
  cli(process.argv.slice(2)).then((code) => process.exit(code)).catch((e) => {
    console.error("SETUP-FAIL: " + ((e && e.stack) || e));
    process.exit(2);
  });
}
