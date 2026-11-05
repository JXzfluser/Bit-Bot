#!/usr/bin/env node
"use strict";
/**
 * upnp_map.js — A3-18 UPnP IGD 自动端口映射
 *
 * 公网入口缺的最后一跳是「路由器把 TCP 18766 翻进来」。大多数家用路由器默认
 * 开着 UPnP IGD，所以这一步可以自动做，不必让用户登录管理页手点。
 *
 * 纯 Node、无依赖，协议用 dgram + http 手写：
 *   1. SSDP：UDP 组播 239.255.255.250:1900，发 M-SEARCH 找 InternetGatewayDevice；
 *   2. 取响应里的 LOCATION，GET 设备描述 XML；
 *   3. 从 XML 里找 WANIPConnection / WANPPPConnection 的 controlURL；
 *   4. SOAP AddPortMapping（也支持 DeletePortMapping / GetExternalIPAddress）。
 *
 * 设计约束（都是踩过的坑）：
 *   - **绝不 throw 到调用方**：路由器没开 UPnP、拒绝、超时都是正常结果，
 *     返回结构化 reason（no_igd / soap_error:<code> / timeout / http_error）；
 *   - 所有网络调用都有超时：SSDP 收包、HTTP GET、SOAP POST 各自 setTimeout；
 *   - XML 解析只做最小正则提取，但认命名空间前缀（<controlURL> 与 <u:controlURL>）；
 *   - discoverImpl / soapImpl 可注入，门禁离线跑，不真发 SSDP。
 *
 * 用法：
 *   node scripts/upnp_map.js                 # 映射 18766/TCP
 *   node scripts/upnp_map.js --get-external-ip
 *   node scripts/upnp_map.js --delete --external-port 18766
 */
const dgram = require("dgram");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

const { localIPv4List } = require(path.join(__dirname, "../hosts/shared/relay/relay_host_audit.js"));

const SSDP_HOST = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_ST = "urn:schemas-upnp-org:device:InternetGatewayDevice:1";
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_SSDP_TIMEOUT_MS = 2000;
const DEFAULT_SOAP_TIMEOUT_MS = 5000;
const MAX_XML_BYTES = 256 * 1024;

function portOf(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : fallback;
}

function errText(e) {
  return String((e && e.message) || e);
}

/* ---------------------------------------------------------------- XML ---- */

function xmlDecode(s) {
  return String(s == null ? "" : s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 取某个标签的文本。`(?:[\w.-]+:)?` 那段就是命名空间前缀兼容：
 * 有的 IGD 回 `<controlURL>`，有的回 `<u:controlURL>`，都要认。
 */
function tagText(block, tag) {
  const re = new RegExp(
    "<(?:[A-Za-z0-9_.-]+:)?" + tag + "\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?" + tag + "\\s*>",
    "i"
  );
  const m = String(block == null ? "" : block).match(re);
  return m ? xmlDecode(m[1]).trim() : "";
}

function serviceBlocks(xml) {
  const out = [];
  // `service\b` 不会误吃 <serviceList>（e 与 L 之间没有词边界）。
  const re = /<(?:[A-Za-z0-9_.-]+:)?service\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?service\s*>/gi;
  const text = String(xml == null ? "" : xml);
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function resolveUrl(u, base) {
  const raw = String(u || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, base || undefined).toString();
  } catch (_) {
    return raw;
  }
}

/**
 * 从设备描述 XML 里挑控制地址。
 * 优先 WANIPConnection（最常见的 IGD 服务），其次 WANPPPConnection；
 * 都没有就退回全文第一个 controlURL（有些设备的 serviceType 写得不标准）。
 *
 * @returns {{controlUrl:string, serviceType:string}}
 */
function parseIgd(xml, location) {
  const blocks = serviceBlocks(xml);
  let best = null;
  let bestScore = -1;
  for (const b of blocks) {
    const controlUrl = tagText(b, "controlURL");
    if (!controlUrl) continue;
    const serviceType = tagText(b, "serviceType");
    let score = 0;
    if (/WANIPConnection/i.test(serviceType)) score = 2;
    else if (/WANPPPConnection/i.test(serviceType)) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = { controlUrl, serviceType };
    }
  }
  if (!best) {
    const controlUrl = tagText(xml, "controlURL");
    if (controlUrl) best = { controlUrl, serviceType: tagText(xml, "serviceType") };
  }
  if (!best) return { controlUrl: "", serviceType: "" };
  return {
    controlUrl: resolveUrl(best.controlUrl, location),
    serviceType: best.serviceType || "urn:schemas-upnp-org:service:WANIPConnection:1",
  };
}

/** SSDP 响应里的 `LOCATION:` 头（大小写不敏感）。 */
function parseLocation(text) {
  const m = String(text == null ? "" : text).match(/^location\s*:\s*(\S+)\s*$/im);
  return m ? m[1].trim() : "";
}

/** SOAP Fault / UPnPError 的 errorCode，读不到回 0。 */
function parseSoapError(body) {
  const m = String(body == null ? "" : body).match(
    /<(?:[A-Za-z0-9_.-]+:)?errorCode\b[^>]*>\s*(\d+)\s*</i
  );
  return m ? Number(m[1]) : 0;
}

function parseExternalIp(body) {
  const v = tagText(body, "NewExternalIPAddress");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) &&
    v.split(".").every((p) => Number(p) >= 0 && Number(p) <= 255)
    ? v
    : "";
}

/* --------------------------------------------------------------- HTTP ---- */

/** GET 一段文本（设备描述 XML），带总超时；永远 resolve。 */
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
      finish({ ok: false, status: 0, error: "bad_url", body: "" });
      return;
    }
    const mod = parsed.protocol === "https:" ? https : http;
    try {
      req = mod.get(parsed, { headers: { "user-agent": "bitbot-upnp/1" } }, (res) => {
        const status = Number(res.statusCode) || 0;
        if (status < 200 || status >= 300) {
          res.resume();
          finish({ ok: false, status, error: "http_" + status, body: "" });
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => {
          body += d;
          if (body.length > MAX_XML_BYTES) {
            try { res.destroy(); } catch (_) {}
            finish({ ok: false, status, error: "body_too_large", body: "" });
          }
        });
        res.on("end", () => finish({ ok: true, status, body }));
        res.on("error", (e) => finish({ ok: false, status, error: errText(e), body: "" }));
      });
    } catch (e) {
      finish({ ok: false, status: 0, error: errText(e), body: "" });
      return;
    }

    timer = setTimeout(() => {
      try { if (req) req.destroy(); } catch (_) {}
      finish({ ok: false, status: 0, error: "timeout", body: "" });
    }, timeoutMs);
    req.on("error", (e) => finish({ ok: false, status: 0, error: errText(e), body: "" }));
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(); } catch (_) {}
      finish({ ok: false, status: 0, error: "timeout", body: "" });
    });
  });
}

/** SOAP POST，带总超时；永远 resolve。 */
function soapPost(url, serviceType, action, params, timeoutMs) {
  return new Promise((resolve) => {
    const body = buildSoapEnvelope(serviceType, action, params);
    const buf = Buffer.from(body, "utf8");
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
      finish({ ok: false, status: 0, error: "bad_url", body: "" });
      return;
    }
    const mod = parsed.protocol === "https:" ? https : http;
    const opts = {
      method: "POST",
      headers: {
        "content-type": 'text/xml; charset="utf-8"',
        "content-length": buf.length,
        soapaction: '"' + serviceType + "#" + action + '"',
        "user-agent": "bitbot-upnp/1",
      },
    };
    try {
      req = mod.request(parsed, opts, (res) => {
        const status = Number(res.statusCode) || 0;
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (d) => {
          text += d;
          if (text.length > MAX_XML_BYTES) {
            try { res.destroy(); } catch (_) {}
            finish({ ok: false, status, error: "body_too_large", body: "" });
          }
        });
        res.on("end", () => finish({ ok: status >= 200 && status < 300, status, body: text }));
        res.on("error", (e) => finish({ ok: false, status, error: errText(e), body: "" }));
      });
    } catch (e) {
      finish({ ok: false, status: 0, error: errText(e), body: "" });
      return;
    }

    timer = setTimeout(() => {
      try { if (req) req.destroy(); } catch (_) {}
      finish({ ok: false, status: 0, error: "timeout", body: "" });
    }, timeoutMs);
    req.on("error", (e) => finish({ ok: false, status: 0, error: errText(e), body: "" }));
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(); } catch (_) {}
      finish({ ok: false, status: 0, error: "timeout", body: "" });
    });
    req.write(buf);
    req.end();
  });
}

function buildSoapEnvelope(serviceType, action, params) {
  const st = serviceType || "urn:schemas-upnp-org:service:WANIPConnection:1";
  const args = (params || [])
    .map(([k, v]) => "<" + k + ">" + xmlEscape(v) + "</" + k + ">")
    .join("");
  return '<?xml version="1.0"?>\n' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    "<s:Body><u:" + action + ' xmlns:u="' + st + '">' + args +
    "</u:" + action + "></s:Body></s:Envelope>";
}

/* --------------------------------------------------------------- SSDP ---- */

/** SSDP 发现：发 M-SEARCH，收 LOCATION，超时后返回已收集到的列表。 */
function ssdpDiscover(opts) {
  const o = opts || {};
  const timeoutMs = Number(o.ssdpTimeoutMs) > 0 ? Number(o.ssdpTimeoutMs) : DEFAULT_SSDP_TIMEOUT_MS;
  return new Promise((resolve) => {
    let socket;
    let settled = false;
    let timer = null;
    const locations = [];
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { if (socket) socket.close(); } catch (_) {}
      resolve(r);
    };

    try {
      socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    } catch (e) {
      resolve({ ok: false, reason: "dgram_error", error: errText(e), locations: [] });
      return;
    }

    timer = setTimeout(() => finish({ ok: true, reason: "timeout", locations }), timeoutMs);

    socket.on("message", (msg) => {
      const loc = parseLocation(msg.toString("utf8"));
      if (loc && locations.indexOf(loc) < 0) locations.push(loc);
    });
    socket.on("error", (e) => {
      finish({ ok: false, reason: "dgram_error", error: errText(e), locations });
    });

    socket.bind(() => {
      const msg = Buffer.from(
        "M-SEARCH * HTTP/1.1\r\n" +
        "HOST: " + SSDP_HOST + ":" + SSDP_PORT + "\r\n" +
        'MAN: "ssdp:discover"\r\n' +
        "MX: 1\r\n" +
        "ST: " + SSDP_ST + "\r\n" +
        "\r\n",
        "utf8"
      );
      try {
        socket.send(msg, 0, msg.length, SSDP_PORT, SSDP_HOST, (e) => {
          if (e) finish({ ok: false, reason: "dgram_error", error: errText(e), locations });
        });
      } catch (e) {
        finish({ ok: false, reason: "dgram_error", error: errText(e), locations });
      }
    });
  });
}

/** 找 IGD 并拿到 controlURL。可注入 discoverImpl / httpGetImpl。 */
async function discoverGateway(opts) {
  const o = opts || {};
  const fail = (reason) => ({
    ok: false,
    reason: reason || "no_igd",
    location: "",
    xml: "",
    controlUrl: "",
    serviceType: "",
  });

  // 门禁注入：直接给 { location, xml }，或 null 表示「没有 IGD」。
  if (typeof o.discoverImpl === "function") {
    let r;
    try {
      r = await o.discoverImpl(o);
    } catch (e) {
      return fail("no_igd");
    }
    if (!r) return fail("no_igd");
    if (r.ok === false) return fail(r.reason || "no_igd");
    const xml = String(r.xml || r.body || "");
    const location = String(r.location || "");
    const igd = parseIgd(xml, location);
    if (!igd.controlUrl) return fail("no_igd");
    return { ok: true, reason: "", location, xml, controlUrl: igd.controlUrl, serviceType: igd.serviceType };
  }

  const found = await ssdpDiscover(o);
  if (!found.ok) return fail(found.reason || "timeout");
  if (!found.locations.length) return fail("no_igd");

  const get = typeof o.httpGetImpl === "function" ? o.httpGetImpl : httpGetText;
  const httpTimeout = Number(o.httpTimeoutMs) > 0 ? Number(o.httpTimeoutMs) : DEFAULT_TIMEOUT_MS;
  let sawTimeout = false;
  for (const location of found.locations) {
    const r = await get(location, httpTimeout);
    if (!r || !r.ok) {
      if (r && r.error === "timeout") sawTimeout = true;
      continue;
    }
    const igd = parseIgd(r.body, location);
    if (igd.controlUrl) {
      return { ok: true, reason: "", location, xml: r.body, controlUrl: igd.controlUrl, serviceType: igd.serviceType };
    }
  }
  return fail(sawTimeout ? "timeout" : "no_igd");
}

/* --------------------------------------------------------------- SOAP ---- */

function soapCall(opts, controlUrl, serviceType, action, params) {
  const o = opts || {};
  const timeoutMs = Number(o.soapTimeoutMs) > 0 ? Number(o.soapTimeoutMs) : DEFAULT_SOAP_TIMEOUT_MS;
  return (async () => {
    let r;
    try {
      r = typeof o.soapImpl === "function"
        ? await o.soapImpl(controlUrl, serviceType, action, params, o)
        : await soapPost(controlUrl, serviceType, action, params, timeoutMs);
    } catch (e) {
      return { ok: false, reason: "http_error", body: "" };
    }
    if (!r || typeof r !== "object") return { ok: false, reason: "http_error", body: "" };
    const body = String(r.body || "");
    const code = parseSoapError(body);
    if (code) return { ok: false, reason: "soap_error:" + code, body };
    if (!r.ok) {
      return { ok: false, reason: r.error === "timeout" ? "timeout" : "http_error", body };
    }
    return { ok: true, reason: "", body };
  })();
}

function result(fields) {
  return Object.assign(
    { ok: false, reason: "no_igd", upnpFound: false, controlUrl: "", externalIp: "" },
    fields || {}
  );
}

function defaultInternalClient() {
  const list = localIPv4List(os.networkInterfaces() || {});
  return list.length ? list[0].address : "";
}

/* ------------------------------------------------------------- public ---- */

/**
 * 添加端口映射。
 * @param {object} [opts]
 * @param {number} [opts.externalPort=18766]
 * @param {number} [opts.internalPort=externalPort]
 * @param {string} [opts.internalClient]  默认取本机第一张非回环 IPv4
 * @param {string} [opts.protocol="TCP"]
 * @param {number} [opts.leaseDuration=0]  0 = 永久（直到路由器重启/租约策略清理）
 * @returns {Promise<{ok:boolean,reason:string,upnpFound:boolean,controlUrl:string,externalIp:string}>}
 */
async function addPortMapping(opts) {
  const o = opts || {};
  const externalPort = portOf(o.externalPort, 18766);
  const internalPort = portOf(o.internalPort, externalPort);
  const protocol = String(o.protocol || "TCP").toUpperCase();
  const leaseDuration = Number.isFinite(Number(o.leaseDuration)) ? Number(o.leaseDuration) : 0;

  try {
    const gw = await discoverGateway(o);
    if (!gw.ok) return result({ reason: gw.reason || "no_igd" });
    const client = String(o.internalClient || defaultInternalClient() || "");
    if (!client) return result({ reason: "no_internal_client", upnpFound: true, controlUrl: gw.controlUrl });

    const r = await soapCall(o, gw.controlUrl, gw.serviceType, "AddPortMapping", [
      ["NewRemoteHost", ""],
      ["NewExternalPort", String(externalPort)],
      ["NewProtocol", protocol],
      ["NewInternalPort", String(internalPort)],
      ["NewInternalClient", client],
      ["NewEnabled", "1"],
      ["NewPortMappingDescription", String(o.description || "bitbot-relay")],
      ["NewLeaseDuration", String(leaseDuration)],
    ]);
    if (!r.ok) {
      return result({ reason: r.reason || "http_error", upnpFound: true, controlUrl: gw.controlUrl });
    }
    return result({ ok: true, reason: "", upnpFound: true, controlUrl: gw.controlUrl });
  } catch (e) {
    return result({ reason: "http_error" });
  }
}

/** 删除端口映射（清理时用）。 */
async function deletePortMapping(opts) {
  const o = opts || {};
  const externalPort = portOf(o.externalPort, 18766);
  const protocol = String(o.protocol || "TCP").toUpperCase();
  try {
    const gw = await discoverGateway(o);
    if (!gw.ok) return result({ reason: gw.reason || "no_igd" });
    const r = await soapCall(o, gw.controlUrl, gw.serviceType, "DeletePortMapping", [
      ["NewRemoteHost", ""],
      ["NewExternalPort", String(externalPort)],
      ["NewProtocol", protocol],
    ]);
    if (!r.ok) {
      return result({ reason: r.reason || "http_error", upnpFound: true, controlUrl: gw.controlUrl });
    }
    return result({ ok: true, reason: "", upnpFound: true, controlUrl: gw.controlUrl });
  } catch (e) {
    return result({ reason: "http_error" });
  }
}

/** 读公网 IP —— 顺带确认路由器自己看到的外部地址。 */
async function getExternalIPAddress(opts) {
  const o = opts || {};
  try {
    const gw = await discoverGateway(o);
    if (!gw.ok) return result({ reason: gw.reason || "no_igd" });
    const r = await soapCall(o, gw.controlUrl, gw.serviceType, "GetExternalIPAddress", []);
    if (!r.ok) {
      return result({ reason: r.reason || "http_error", upnpFound: true, controlUrl: gw.controlUrl });
    }
    const ip = parseExternalIp(r.body);
    if (!ip) {
      return result({ reason: "bad_response", upnpFound: true, controlUrl: gw.controlUrl });
    }
    return result({ ok: true, reason: "", upnpFound: true, controlUrl: gw.controlUrl, externalIp: ip });
  } catch (e) {
    return result({ reason: "http_error" });
  }
}

const HELP = [
  "用法: node scripts/upnp_map.js [选项]",
  "",
  "  --external-port <n>   外部端口（默认 18766）",
  "  --internal-port <n>   内部端口（默认同外部端口）",
  "  --client <ip>         内部客户端地址（默认本机第一张非回环 IPv4）",
  "  --protocol <tcp>      协议（默认 TCP）",
  "  --lease <秒>          租约（0 = 永久）",
  "  --get-external-ip     只读路由器看到的外部 IP",
  "  --delete              删除映射",
  "  --help                显示本帮助",
  "",
  "  路由器未开启 UPnP / 双 NAT 时，本脚本会如实返回 no_igd 等原因，不会抛异常。",
].join("\n");

function cli(argv) {
  const args = argv || [];
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const valueOf = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const opts = {
    externalPort: Number(valueOf("--external-port", 18766)),
    internalPort: Number(valueOf("--internal-port", 0)) || undefined,
    internalClient: valueOf("--client", ""),
    protocol: valueOf("--protocol", "TCP"),
    leaseDuration: Number(valueOf("--lease", 0)),
  };
  const action = args.includes("--get-external-ip")
    ? getExternalIPAddress
    : args.includes("--delete")
      ? deletePortMapping
      : addPortMapping;
  const title = action === getExternalIPAddress
    ? "UPnP 外部地址"
    : action === deletePortMapping
      ? "UPnP 删除映射"
      : "UPnP 添加映射";

  action(opts).then((r) => {
    console.log("== " + title + " ==");
    console.log("  IGD         : " + (r.upnpFound ? "找到" : "没找到"));
    if (r.controlUrl) console.log("  control URL : " + r.controlUrl);
    if (r.externalIp) console.log("  外部 IP     : " + r.externalIp);
    console.log("  结果        : " + (r.ok ? "成功" : "失败（" + r.reason + "）"));
    if (!r.ok && r.reason === "no_igd") {
      console.log("  说明        : 路由器未开启 UPnP，或本机与路由器之间有双 NAT。");
      console.log("                请手工在路由器做端口转发，或改用 --host 显式配置。");
    }
    process.exit(r.ok ? 0 : 1);
  }).catch((e) => {
    console.error("SETUP-FAIL: " + ((e && e.stack) || e));
    process.exit(2);
  });
}

module.exports = {
  addPortMapping,
  deletePortMapping,
  getExternalIPAddress,
  parseIgd,
  parseLocation,
  parseSoapError,
  parseExternalIp,
  ssdpDiscover,
  discoverGateway,
  buildSoapEnvelope,
  DEFAULT_TIMEOUT_MS,
};

if (require.main === module) {
  process.exitCode = cli(process.argv.slice(2));
}
