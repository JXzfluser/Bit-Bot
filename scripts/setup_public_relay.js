#!/usr/bin/env node
"use strict";
/**
 * setup_public_relay.js — A3-15 公网跨网接线器
 *
 * 一条命令把「桌面这一侧」全部配好：
 *   1. 生成 / 复用 relay-secret（data/desktop/relay-secret，mode 0600）；
 *   2. 用它签发两把角色不同的凭证（box / client，绝不混用）；
 *   3. 通过已有的 secret_vault 写入**安全格式** relay.json
 *      （只留 *_token_ref、mode=reverse、mode 0600，A3-12）；
 *   4. 输出掩码视图与「服务端该用同一个 secret 启动」的命令。
 *
 * A3-17/18 起多了 --auto：先探测本机公网出口 IP，若发现自己在 NAT 后面，
 * 再尝试用 UPnP 自动开 TCP 18766，然后把探到的 IP 当作 --host 继续原流程。
 * 显式给 --host 时**不探测、不映射**，原行为一字不变。
 *
 * 用法：
 *   node scripts/setup_public_relay.js --host 14.155.111.69
 *   node scripts/setup_public_relay.js --host relay.example.com --port 18766 --box-id my-desktop
 *   node scripts/setup_public_relay.js --auto
 *   node scripts/setup_public_relay.js --auto --no-upnp
 *
 * 注意：--host 必须是**手机在蜂窝网下也够得到**的地址。填 127.0.0.1 / 局域网 IP
 * 会让配对回执把一个手机连不上的地址下发出去，比不配更糟 —— 脚本会明确拒绝。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = path.resolve(__dirname, "..");
const { issueRelayCredential } = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));
const { writeRelayConfigSecure } = require(path.join(REPO, "hosts/shared/relay/relay_secrets.js"));
const { readRelaySettings } = require(path.join(REPO, "hosts/shared/relay/relay_settings.js"));
const { createSecretVault } = require(path.join(REPO, "hosts/desktop/secret_vault.js"));
const { detectPublicIPv4 } = require(path.join(__dirname, "detect_public_ip.js"));
const { addPortMapping } = require(path.join(__dirname, "upnp_map.js"));

function parseArgs(argv) {
  const o = {
    host: "",
    port: 18766,
    boxId: "my-desktop",
    connectHost: "127.0.0.1",
    auto: false,
    noUpnp: false,
    externalPort: 0,
    internalPort: 0,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--host") o.host = String(argv[++i] || "").trim();
    else if (argv[i] === "--port") o.port = Number(argv[++i]);
    else if (argv[i] === "--box-id") o.boxId = String(argv[++i] || "").trim();
    else if (argv[i] === "--connect-host") o.connectHost = String(argv[++i] || "").trim();
    else if (argv[i] === "--auto") o.auto = true;
    else if (argv[i] === "--no-upnp") o.noUpnp = true;
    else if (argv[i] === "--external-port") o.externalPort = Number(argv[++i]);
    else if (argv[i] === "--internal-port") o.internalPort = Number(argv[++i]);
    else if (argv[i] === "--help" || argv[i] === "-h") o.help = true;
  }
  return o;
}

function isLoopbackOrPrivate(host) {
  const h = String(host).toLowerCase();
  if (h === "localhost" || h.startsWith("127.") || h === "::1" || h === "0.0.0.0") return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

/** 只有「--auto 且没显式 --host」才探测；显式 host 永远走原路径。 */
function shouldAutoDetect(o) {
  return Boolean(o && o.auto) && !String(o.host || "").trim();
}

/** NAT 之后才需要映射；--no-upnp 明确拒绝自动改路由器。 */
function shouldAttemptUpnp(o, natDetected) {
  return Boolean(natDetected) && !(o && o.noUpnp);
}

function portOr(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : fallback;
}

/**
 * 探测 + 可选映射。返回的 publicPort 是**手机该填的端口**（可能因外部端口而变），
 * internalPort 是**relay 实际监听的端口**（start_public_relay.sh 用）。
 * deps 只给门禁注入用；产品路径不传。
 */
async function autoEntry(o, deps) {
  const d = deps || {};
  const detect = typeof d.detect === "function" ? d.detect : detectPublicIPv4;
  const map = typeof d.addMapping === "function" ? d.addMapping : addPortMapping;

  const internalPort = portOr(o.internalPort, o.port);
  const externalPort = portOr(o.externalPort, o.port);
  const det = (await detect()) || {};

  const entry = {
    ok: Boolean(det.ok),
    ip: String(det.ip || ""),
    source: String(det.source || ""),
    localInterfaces: Array.isArray(det.localInterfaces) ? det.localInterfaces : [],
    natDetected: Boolean(det.natDetected),
    tried: Array.isArray(det.tried) ? det.tried : [],
    internalPort,
    publicPort: o.port,
    upnp: { attempted: false, ok: false, reason: "" },
  };
  if (!entry.ok) {
    entry.reason = "detect_failed";
    return entry;
  }

  entry.publicPort = internalPort;
  if (!shouldAttemptUpnp(o, entry.natDetected)) {
    entry.upnp.reason = entry.natDetected ? "disabled_by_no_upnp" : "not_needed";
    return entry;
  }

  entry.upnp.attempted = true;
  const mapped = await map({
    externalPort,
    internalPort,
    internalClient: d.internalClient || undefined,
  });
  entry.upnp = {
    attempted: true,
    ok: Boolean(mapped && mapped.ok),
    reason: String((mapped && mapped.reason) || ""),
    externalIp: String((mapped && mapped.externalIp) || ""),
  };
  if (entry.upnp.ok) entry.publicPort = externalPort;
  return entry;
}

function printEntryStatus(entry, o) {
  console.log("");
  console.log("== 入口状态 ==");
  if (!entry) {
    console.log("  显式 --host：" + o.host + "（未做公网探测 / 未做 UPnP 映射）");
    return;
  }
  console.log("  探测到的 IP     : " + entry.ip + "（" + entry.source + "）");
  const ifaces = entry.localInterfaces.length
    ? entry.localInterfaces.map((a) => a.name + "=" + a.address).join(", ")
    : "(无)";
  console.log("  本机网卡        : " + ifaces);
  if (!entry.natDetected) {
    console.log("  NAT             : 出口 IP 就在本机网卡上 → 不需要端口映射");
  } else {
    console.log("  NAT             : 出口 IP 不在本机网卡上 → 需要端口映射");
    if (entry.upnp.attempted) {
      console.log("  UPnP 映射       : " + (entry.upnp.ok ? "成功" : "失败") +
        "（" + (entry.upnp.reason || "ok") + "）");
    } else {
      console.log("  UPnP 映射       : 未尝试（" + (entry.upnp.reason || "unknown") + "）");
    }
  }

  if (entry.natDetected && !entry.upnp.ok) {
    const lan = entry.localInterfaces.length
      ? entry.localInterfaces[0].address
      : "<本机局域网IP>";
    console.log("");
    console.log("  自动映射没成功（" + (entry.upnp.reason || "unknown") + "），请手工完成：");
    console.log("    1. 浏览器打开路由器管理页（常见 192.168.1.1 / 192.168.0.1）；");
    console.log("    2. 找到「端口转发 / 虚拟服务器 / NAT」；");
    console.log("    3. 新建规则：协议 TCP，外部端口 " + entry.publicPort +
      " → 内部 " + lan + ":" + entry.internalPort + "；");
    console.log("    4. 保存后用手机流量打开 http://" + o.host + ":18767/healthz 。");
    console.log("  注：路由器禁用 UPnP、或光猫+路由双 NAT 时，自动映射无能为力。");
  }
}

const HELP = [
  "用法: node scripts/setup_public_relay.js --host <公网IP或域名> [选项]",
  "      node scripts/setup_public_relay.js --auto [选项]",
  "",
  "  --host <h>           手机在蜂窝网下够得到的公网 IP / 域名（显式给出则不探测）",
  "  --port <n>           手机连的端口（默认 18766）",
  "  --box-id <id>        box_id（默认 my-desktop）",
  "  --connect-host <h>   桌面自己连 relay 的地址（默认 127.0.0.1）",
  "  --auto               自动探测公网 IP；NAT 后尝试 UPnP 映射 18766",
  "  --no-upnp            只探测，不自动改路由器",
  "  --external-port <n>  公网侧端口（默认同 --port）",
  "  --internal-port <n>  relay 实际监听端口（默认同 --port）",
  "  --help               显示本帮助",
].join("\n");

async function main(argv) {
  const o = parseArgs(argv || []);
  if (o.help) {
    console.log(HELP);
    return;
  }

  let entry = null;
  if (shouldAutoDetect(o)) {
    entry = await autoEntry(o);
    if (!entry.ok) {
      console.error("自动探测公网 IP 失败（没有编造地址）：");
      entry.tried.forEach((t) => console.error("  - " + t.url + " → " + t.error));
      console.error("请改用 --host <公网IP或域名> 显式指定。");
      process.exit(2);
    }
    o.host = entry.ip;
    o.port = entry.publicPort;
  }

  if (!o.host) {
    console.error("缺 --host：必须是手机蜂窝网下够得到的公网 IP / 域名");
    process.exit(2);
  }
  if (isLoopbackOrPrivate(o.host)) {
    console.error("拒绝：" + o.host + " 是回环/私网地址，手机在蜂窝网下连不到。");
    console.error("请填公网出口 IP 或域名（并确保 TCP " + o.port + " 已映射到这台桌面）。");
    process.exit(2);
  }
  if (!Number.isInteger(o.port) || o.port <= 0 || o.port > 65535) {
    console.error("端口不合法：" + o.port);
    process.exit(2);
  }

  const secretFile = path.join(REPO, "data", "desktop", "relay-secret");
  fs.mkdirSync(path.dirname(secretFile), { recursive: true, mode: 0o700 });
  let secret;
  let secretSource;
  if (fs.existsSync(secretFile)) {
    secret = fs.readFileSync(secretFile, "utf8").trim();
    secretSource = "reused";
  } else {
    secret = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(secretFile, secret + "\n", { mode: 0o600 });
    try { fs.chmodSync(secretFile, 0o600); } catch (_) {}
    secretSource = "generated";
  }
  if (!secret) { console.error("relay-secret 为空"); process.exit(2); }

  const boxToken = issueRelayCredential(secret, o.boxId + "-box", "box");
  const clientToken = issueRelayCredential(secret, o.boxId + "-client", "client");
  const vault = createSecretVault(REPO);
  const written = writeRelayConfigSecure({
    repoRoot: REPO,
    vault,
    cfg: {
      host: o.host, port: o.port, box_id: o.boxId,
      box_token: boxToken, client_token: clientToken, mode: "reverse",
      connect_host: o.connectHost,
    },
  });
  if (!written.ok) {
    console.error("写入 relay.json 失败：" + JSON.stringify(written));
    process.exit(1);
  }

  const view = readRelaySettings({ repoRoot: REPO, vault, env: {} });
  console.log("== 公网中转接线完成 ==");
  console.log("  relay host      : " + o.host + ":" + o.port + "（下发给手机）");
  console.log("  connect_host    : " + (view.connectHost || "(同 host)") + "（桌面连它）");
  console.log("  mode            : " + view.mode + "（反向隧道，盒子只发起出站连接）");
  console.log("  box_id          : " + view.boxId);
  console.log("  relay-secret    : " + secretSource + " → data/desktop/relay-secret (0600)");
  console.log("  box_token       : " + view.boxTokenMask + "（只进 vault，绝不下发）");
  console.log("  client_token    : " + view.clientTokenMask + "（随配对回执下发手机）");
  console.log("  relay.json      : 安全格式、查无明文、mode 0600");
  console.log("  配置热生效      : A3-11 观察器 ≤2s 自动重新登记，不用重启桌面 app");
  console.log("  若 relay 在另一台公网机器：改用 --connect-host <那台机器地址>（勿留 127.0.0.1）");
  console.log("");
  console.log("服务端必须用**同一个 secret**启动（本机或公网机器）：");
  console.log("  bash scripts/start_public_relay.sh");
  console.log("");

  if (entry && entry.upnp.ok) {
    console.log("端口映射已由 UPnP 自动完成（TCP " + entry.publicPort + " → 本机 " +
      entry.internalPort + "）。");
    if (entry.internalPort !== entry.publicPort) {
      console.log("注意：relay 需监听 " + entry.internalPort +
        "，启动时设 BITBOT_RELAY_CONTROL_PORT=" + entry.internalPort + "。");
    }
    console.log("若路由器重启或租约被清理，重跑本条命令即可重新映射。");
    console.log("手机蜂窝网下验证：http://" + o.host + ":18767/healthz 。");
  } else {
    console.log("还差一步（基础设施，代码做不了）：把 TCP " + o.port + " 映射到跑 relay 的那台机器，");
    console.log("并确认手机蜂窝网下能打开 http://" + o.host + ":18767/healthz 。");
  }

  printEntryStatus(entry, o);
}

module.exports = {
  parseArgs,
  isLoopbackOrPrivate,
  shouldAutoDetect,
  shouldAttemptUpnp,
  autoEntry,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error("SETUP-FAIL: " + ((e && e.stack) || e));
    process.exit(2);
  });
}
