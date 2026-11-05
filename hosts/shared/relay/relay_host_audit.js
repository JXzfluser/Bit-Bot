"use strict";
/**
 * relay_host_audit.js — A3-16 中转地址自检（部分关 R-A3-8a）
 *
 * 为什么要有这一层：桌面上会同时出现**两个地址**，它们来自完全不同的地方，
 * 用户看到「对不上」是对的，不是错觉：
 *
 *   1. 配对地址 `pair_base` —— `pairingState()` 每次现读网卡算出来的
 *      `http://<本机局域网 IPv4>:18765`，只对同一个 Wi-Fi 有效；
 *   2. 中转地址 `relay.json.host` —— 用户（或某次脚本）手填的值，随配对回执
 *      `relay.host` 下发给手机，端口是 18766。
 *
 * 这两个值本来就该不一样。真正的坑在于：**设置面从不校验第 2 个字**
 * （A3-14 的 `saveRelaySettings()` 只查非空/端口范围），于是一个
 * 「不在本机任何网段、也不是公网」的私网地址能安安稳稳写进 relay.json，
 * 再随回执下发给手机 —— 手机照着连，连不上，界面还显示「已配置」。
 * `scripts/setup_public_relay.js` 早就会拒绝私网 host，但它是**脚本**，
 * 走界面的用户绕过去了。A3-16 把判定抽到这里，让脚本、设置面、界面提示
 * 用同一套口径，顺便把「这个地址到底谁能敲到」明明白白说出来。
 *
 * 纯函数 + 注入网卡表，门禁不需要真网络也能跑。
 */

const os = require("os");

/** 把用户可能贴进来的 `http://host:port/path` 收拾成裸 host。 */
function normalizeHost(raw) {
  let h = String(raw == null ? "" : raw).trim();
  if (!h) return "";
  h = h.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, ""); // 去 scheme
  h = h.replace(/[/?#].*$/, ""); // 去 path / query
  if (h.startsWith("[")) {
    // [::1]:18766
    const end = h.indexOf("]");
    h = end > 0 ? h.slice(1, end) : h.slice(1);
  } else if ((h.match(/:/g) || []).length === 1) {
    h = h.replace(/:\d+$/, ""); // host:port（IPv6 裸写有多个冒号，不动）
  }
  return h.replace(/\.$/, "").toLowerCase();
}

function isIPv4(h) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) &&
    h.split(".").every((p) => Number(p) >= 0 && Number(p) <= 255);
}

function isIPv6(h) {
  return h.includes(":") && /^[0-9a-f:.]+$/i.test(h);
}

/**
 * 给 host 分类。`kind` 只说「这个字符串是什么」，
 * 不掺「能不能连」——那是 auditRelayHost 的事。
 */
function classifyHost(raw) {
  const host = normalizeHost(raw);
  if (!host) return { kind: "empty", host: "" };
  if (isIPv4(host)) {
    if (/^127\./.test(host) || host === "0.0.0.0") return { kind: "loopback", host };
    if (/^169\.254\./.test(host)) return { kind: "link_local", host };
    if (/^10\./.test(host)) return { kind: "private", host };
    if (/^192\.168\./.test(host)) return { kind: "private", host };
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return { kind: "private", host };
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return { kind: "cgnat", host };
    return { kind: "public", host };
  }
  if (isIPv6(host)) {
    if (host === "::1" || host === "::") return { kind: "loopback", host };
    if (/^fe[89ab]/.test(host)) return { kind: "link_local", host };
    if (/^f[cd]/.test(host)) return { kind: "private", host };
    return { kind: "public", host };
  }
  if (/\.local$/.test(host)) return { kind: "mdns", host };
  if (host === "localhost") return { kind: "loopback", host };
  // 域名：有没有点都要认，单标签域名在内网反解里常见
  return { kind: "hostname", host };
}

/** 从 os.networkInterfaces() 里拿所有非回环 IPv4。 */
function localIPv4List(interfaces) {
  const src = interfaces && typeof interfaces === "object" ? interfaces : os.networkInterfaces() || {};
  const out = [];
  Object.keys(src).forEach((name) => {
    (src[name] || []).forEach((a) => {
      if (!a || a.internal) return;
      const fam = typeof a.family === "string" ? a.family : a.family === 4 ? "IPv4" : "IPv6";
      if (fam !== "IPv4") return;
      if (!a.address) return;
      out.push({ address: String(a.address), name: String(name) });
    });
  });
  return out;
}

const HINTS = {
  host_missing: "没填中转地址，手机在蜂窝网下无从连起。",
  host_loopback: "回环地址只在这台机器内部有效，手机永远敲不到。",
  host_link_local: "链路本地地址（169.254/fe80）只在同一段链路里有效，手机敲不到。",
  host_private_local: "这是这台桌面的局域网地址。同一个 Wi-Fi 下能用，切到蜂窝就断了。",
  host_private_other: "私网地址，而且不在本机任何网段上 —— 既不是公网入口，也不是这台机器。",
  host_cgnat: "运营商大内网地址（100.64/10），出不了运营商，手机连不到。",
  host_mdns: "`.local` 靠局域网组播解析，蜂窝网下解析不了。",
  host_own_public_ip: "这是本机公网出口 IP。要在路由器上把这个端口映射到本机才通，且 NAT 回环（自己连自己）常常不通。",
  host_public: "公网地址，手机在蜂窝网下够得到（前提是端口已放通）。",
  host_hostname: "域名：解析与端口放通都取决于你的 DNS / 防火墙，这里无法替你验证。",
};

/**
 * 审一次中转地址。
 *
 * @param {object} o
 * @param {string} o.host        配置里的 host（可以是 URL 形式，会自动收拾）
 * @param {number} [o.port]      配置里的端口，仅用于文案
 * @param {string} [o.mode]      "reverse" | "dial"
 * @param {object} [o.interfaces] 注入的网卡表（门禁用），默认读本机
 * @returns {{level,code,kind,host,port,mode,reachableFromCellular,isLocalInterface,note}}
 */
function auditRelayHost(o) {
  const opt = o || {};
  const c = classifyHost(opt.host);
  const locals = localIPv4List(opt.interfaces);
  const isLocalInterface = c.host ? locals.some((a) => a.address === c.host) : false;
  const base = {
    kind: c.kind,
    host: c.host,
    port: Number(opt.port) || 0,
    mode: String(opt.mode || "reverse").toLowerCase() === "dial" ? "dial" : "reverse",
    isLocalInterface,
  };
  const make = (level, code, reachable) =>
    Object.assign({}, base, {
      level,
      code,
      reachableFromCellular: Boolean(reachable),
      note: HINTS[code] || "",
    });

  switch (c.kind) {
    case "empty":
      return make("error", "host_missing", false);
    case "loopback":
      return make("error", "host_loopback", false);
    case "link_local":
      return make("error", "host_link_local", false);
    case "mdns":
      return make("error", "host_mdns", false);
    case "cgnat":
      return make("error", "host_cgnat", false);
    case "private":
      // 关键区分：是本机网卡上的私网地址，还是别处捡来的私网地址。
      return make("error", isLocalInterface ? "host_private_local" : "host_private_other", false);
    case "public":
      // 本机公网出口 IP：不是错的，但需要端口映射 + NAT 回环，实测常不通。
      return isLocalInterface
        ? make("ok", "host_public", true)
        : make("warn", "host_own_public_ip", true);
    case "hostname":
    default:
      return make("warn", "host_hostname", true);
  }
}

/**
 * 设置面保存前的准入判定。
 * reverse 模式 = 「手机走公网回来」，此时私网/回环地址**必须拒**，
 * 否则就是把一个连不上的地址写进配置、再下发给手机（A3-16 之前就是这样）。
 * dial 模式 = 同网部署，局域网地址是合法的，只给 warn。
 */
function shouldRejectSave(audit) {
  if (!audit) return false;
  if (audit.level !== "error") return false;
  return audit.mode === "reverse";
}

module.exports = {
  normalizeHost,
  classifyHost,
  localIPv4List,
  auditRelayHost,
  shouldRejectSave,
  HINTS,
};
