"use strict";
/**
 * connection_strategy.js — 客户端连接策略（A3-3 · AC-T4-5）
 *
 * 职责（纯逻辑，可注入 probe 单测，默认走真实 TCP）：
 *  1. 直连优先 —— 按候选顺序逐个探测（局域网 / 覆盖网地址），任一可达即用直连；
 *  2. 失败回落中转 —— 直连全不可达且配了中转端点时，探中转，可达则用中转；
 *  3. 模式与延迟 —— 返回 mode(direct/relay/none) + latencyMs，供界面显示「直连/中转 · Nms」；
 *  4. 诚实离线 —— 全不可达且无中转时回 ok:false/mode:none，绝不假装直连。
 *
 * 设计要点：
 *  - probe 可注入：测试用真实 socket 或桩函数；生产用 defaultProbe（net.connect + 超时）。
 *  - 直连候选按优先级短路：一旦某个可达即返回，**不再**去碰后面的候选或中转（省时且行为确定）。
 *  - 全部直连失败才看中转；中转失败也如实回 none，不把「连不上」包装成「中转中」。
 *
 * 与移动端的关系：Android（Kotlin）/ iOS（Swift）客户端的网络层应复用同一套判定语义
 * （直连优先→超时→回落中转→模式上报）。本模块是这段语义的单一事实源与门禁靶子。
 */

const net = require("net");

const DEFAULT_TIMEOUT_MS = 800;

/** "host:port" → {host, port}，非法返回 null（与 relay 的 parseEndpoint 同口径） */
function parseEndpoint(s) {
  if (typeof s !== "string") return null;
  const idx = s.lastIndexOf(":");
  if (idx < 0) return null;
  const host = s.slice(0, idx).trim();
  const port = Number(s.slice(idx + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

/**
 * 默认探针：TCP 连一下，成功回 {ok:true, latencyMs}；超时/拒绝/错误回 {ok:false, reason}。
 * 只探「能不能连通」，不发送任何业务字节、不鉴权——连通性是这一层唯一的判据。
 * @returns {Promise<{ok:boolean, latencyMs?:number, reason?:string}>}
 */
function defaultProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const sock = net.connect({ host, port });
    const finish = (okFlag, reason) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch (_) {}
      resolve(okFlag ? { ok: true, latencyMs: Date.now() - started } : { ok: false, reason: reason || "error" });
    };
    try {
      sock.setTimeout(timeoutMs, () => finish(false, "timeout"));
    } catch (_) {}
    sock.on("connect", () => finish(true));
    sock.on("error", (e) => finish(false, (e && e.code) || "error"));
  });
}

/** 安全探一次：probe 抛错一律当失败，不让单点异常打断整体策略 */
async function safeProbe(probe, host, port, timeoutMs) {
  try {
    const r = await probe(host, port, timeoutMs);
    return r && typeof r === "object" ? r : { ok: false, reason: "bad_probe_result" };
  } catch (e) {
    return { ok: false, reason: (e && e.code) || "probe_throw" };
  }
}

/**
 * 直连优先、失败回落中转。
 * @param {object} opts
 *   - directCandidates: string[]   直连候选 "host:port"（按优先级，前一个通就不用后面的）
 *   - relay: string|null          中转端点 "host:port"
 *   - timeoutMs?: number          单次探测超时（默认 800ms）
 *   - probe?: (host,port,timeoutMs)=>Promise<{ok,latencyMs?,reason?}>  可注入
 * @returns {Promise<{
 *   ok:boolean, mode:'direct'|'relay'|'none',
 *   endpoint:string|null, latencyMs:number|null,
 *   directTried:Array<{endpoint:string, ok:boolean, latencyMs?:number, reason?:string}>,
 *   relayTried:null|{endpoint:string, ok:boolean, latencyMs?:number, reason?:string},
 *   reason?:string
 * }>}
 */
async function resolveConnection(opts) {
  const o = opts || {};
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : DEFAULT_TIMEOUT_MS;
  const probe = typeof o.probe === "function" ? o.probe : defaultProbe;
  const candidates = Array.isArray(o.directCandidates) ? o.directCandidates.slice() : [];
  const directTried = [];

  // 1) 直连优先：按序短路
  for (const cand of candidates) {
    const ep = parseEndpoint(cand);
    if (!ep) {
      directTried.push({ endpoint: String(cand), ok: false, reason: "bad_endpoint" });
      continue;
    }
    const r = await safeProbe(probe, ep.host, ep.port, timeoutMs);
    const row = { endpoint: cand, ok: Boolean(r.ok), latencyMs: r.latencyMs, reason: r.reason };
    directTried.push(row);
    if (r.ok) {
      return {
        ok: true,
        mode: "direct",
        endpoint: cand,
        latencyMs: Number.isFinite(r.latencyMs) ? r.latencyMs : null,
        directTried,
        relayTried: null, // 直连成功即止，不碰中转
      };
    }
  }

  // 2) 回落中转：仅当直连全失败且配了中转
  const relayEp = o.relay ? parseEndpoint(o.relay) : null;
  if (o.relay && !relayEp) {
    return {
      ok: false,
      mode: "none",
      endpoint: null,
      latencyMs: null,
      directTried,
      relayTried: { endpoint: String(o.relay), ok: false, reason: "bad_endpoint" },
      reason: "bad_relay_endpoint",
    };
  }
  if (relayEp) {
    const r = await safeProbe(probe, relayEp.host, relayEp.port, timeoutMs);
    const relayTried = { endpoint: o.relay, ok: Boolean(r.ok), latencyMs: r.latencyMs, reason: r.reason };
    if (r.ok) {
      return {
        ok: true,
        mode: "relay",
        endpoint: o.relay,
        latencyMs: Number.isFinite(r.latencyMs) ? r.latencyMs : null,
        directTried,
        relayTried,
      };
    }
    return {
      ok: false,
      mode: "none",
      endpoint: null,
      latencyMs: null,
      directTried,
      relayTried,
      reason: "relay_unreachable",
    };
  }

  // 3) 全不可达且无中转：诚实离线，不造假
  return {
    ok: false,
    mode: "none",
    endpoint: null,
    latencyMs: null,
    directTried,
    relayTried: null,
    reason: "no_relay_configured",
  };
}

const MODE_LABELS = {
  direct: { zh: "直连", "zh-TW": "直連", en: "Direct" },
  relay: { zh: "中转", "zh-TW": "中轉", en: "Relay" },
  none: { zh: "未连接", "zh-TW": "未連線", en: "Offline" },
};

/**
 * 界面文案：连接方式 + 延迟。AC-T4-5「界面显示直连」/ T4a-FR4「显示连接方式与延迟」。
 * @param {object|string} result  resolveConnection 的结果，或直接传 mode 字符串
 * @param {string} [lang]         "zh" | "zh-TW" | "en"
 * @returns {string}              如 "直连 · 12ms" / "中转 · 40ms" / "未连接"
 */
function describeMode(result, lang) {
  const mode = typeof result === "string" ? result : result && result.mode;
  const lat =
    result && typeof result === "object" && Number.isFinite(result.latencyMs) ? Math.round(result.latencyMs) : null;
  const table = MODE_LABELS[mode] || MODE_LABELS.none;
  const label = table[lang] || table.zh || MODE_LABELS.none.zh;
  const isConnected = mode === "direct" || mode === "relay";
  return isConnected && lat != null ? label + " · " + lat + "ms" : label;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  parseEndpoint,
  defaultProbe,
  resolveConnection,
  describeMode,
};
