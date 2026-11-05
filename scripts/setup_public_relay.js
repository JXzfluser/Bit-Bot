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
 * 之所以要这个脚本：公网连接缺的是「一个公网可达的 relay 入口」这种基础设施，
 * 但桌面侧的配置、凭证、安全落盘、热生效（A3-11）全都是可以一次做完的。
 * 有了 host 之后不该再让用户手抄 JSON、手签 token、手 chmod。
 *
 * 用法：
 *   node scripts/setup_public_relay.js --host 14.155.111.69
 *   node scripts/setup_public_relay.js --host relay.example.com --port 18766 --box-id my-desktop
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

function parseArgs(argv) {
  const o = { host: "", port: 18766, boxId: "my-desktop", connectHost: "127.0.0.1" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--host") o.host = String(argv[++i] || "").trim();
    else if (argv[i] === "--port") o.port = Number(argv[++i]);
    else if (argv[i] === "--box-id") o.boxId = String(argv[++i] || "").trim();
    else if (argv[i] === "--connect-host") o.connectHost = String(argv[++i] || "").trim();
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

function main() {
  const o = parseArgs(process.argv.slice(2));
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
  console.log("还差一步（基础设施，代码做不了）：把 TCP " + o.port + " 映射到跑 relay 的那台机器，");
  console.log("并确认手机蜂窝网下能打开 http://" + o.host + ":18767/healthz 。");
}

main();
