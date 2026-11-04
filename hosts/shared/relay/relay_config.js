"use strict";
/**
 * relay_config.js — 桌面「我接在哪个中转上」的**唯一事实源**（A3-7 / 关 R-A3-6d）
 *
 * 为什么要单独一个模块：A3-6 把「有配置就下发」做完了，但配置从哪来没人回答 ——
 * `main.js` 从不传 `relayHandoff`，唯一来源是终端里 export 环境变量。普通用户双击打开
 * 桌面，回执里永远没有 `relay`，手机也就仍然只在同一个 Wi-Fi 能用。
 *
 * 这一层只做三件事：**读**（文件 / 环境变量）、**归一**（半套一律不认）、**给手机的那四栏**
 * （`toHandoff`）。它不连接、不登记 —— 那是 `relay_box_client.js` 的活。
 *
 * 两把钥匙，别混：
 *   - `box_token`（role=box）：**桌面自己**拿去 REGISTER 的准入凭证，只在本机磁盘上，绝不下发；
 *   - `client_token`（role=client）：**手机**拿去 CONNECT 的准入凭证，随配对回执下发。
 * 用同一把会同时放大泄露面（手机会拿到桌面的登记权）。
 *
 * 配置形状（`data/desktop/relay.json`）：
 *   { "host": "relay.example.com", "port": 18766,
 *     "box_id": "box-home", "box_token": "<role=box 凭证>", "client_token": "<role=client 凭证>",
 *     "endpoint": "192.168.1.20:41000",   // 可选：relay 拨得回来的地址
 *     "enabled": true }
 *
 * `endpoint` 为什么单独一栏：relay 的转发是**它自己拨**到 box 登记的那个 `host:port`。
 * 缺省值只能是 `127.0.0.1:<inbound 端口>` —— 那要求 relay 和桌面在同一个宿主上（docker
 * sidecar 就是这样跑的）。relay 在别的机器上时，不显式写这一栏，登记的地址就是 relay
 * 永远拨不到的回环地址，症状是手机侧 `NOBOX`/超时而不是「配置错」。
 *
 * 口径与 A3-6 的 `normalizeRelayHandoff` 一致：**缺一栏就当没配**。给一半比不给更坏 ——
 * 手机拿半套去连，报出来的是一个查不出来的错。
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_REL = path.join("data", "desktop", "relay.json");

/** 默认配置文件位置（桌面仓库根下的 data/desktop/relay.json）。 */
function defaultRelayConfigPath(repoRoot) {
  return path.join(String(repoRoot || process.cwd()), DEFAULT_REL);
}

/**
 * 把任意来源的原始对象归一成内部配置；**半套 / 非法一律 null**，不猜、不补默认值。
 * `enabled === false` 视为「用户明确关掉了」，与「没配」同一个结果（但不填半套）。
 */
function normalizeRelayConfig(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.enabled === false) return null;
  const host = String(raw.host || "").trim();
  const port = Number(raw.port);
  const boxId = String(raw.box_id || raw.boxId || "").trim();
  const boxToken = String(raw.box_token || raw.boxToken || "").trim();
  const clientToken = String(raw.client_token || raw.clientToken || "").trim();
  // 可选：中转**拨回来**的地址。缺省时由 main.js 用 `127.0.0.1:<inbound 实际端口>` 填，
  // 那只在「relay 与桌面同网络命名空间的宿主进程」时成立；relay 在容器（桥接网络）
  // 或别的机器里就必须显式写这里 —— `127.0.0.1` 在容器里指的是容器自己。
  // （见 R-A3-6g：云端 relay 拨不进 NAT 后的盒子）。
  const endpoint = String(raw.endpoint || "").trim();
  if (!host) return null;
  // `Number("abc")` 是 NaN，`18766.5` 也不是端口 —— 两者都必须在这里挡住，
  // 否则端上会拿一个连不上的端口去建连，用户看到的是「网络不好」。
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (!boxId || !boxToken || !clientToken) return null;
  return { host, port, boxId, boxToken, clientToken, endpoint };
}

function relayConfigFromEnv(env) {
  const e = env || {};
  return normalizeRelayConfig({
    host: e.BITBOT_RELAY_HOST,
    port: e.BITBOT_RELAY_PORT,
    box_id: e.BITBOT_RELAY_BOX_ID,
    box_token: e.BITBOT_RELAY_BOX_TOKEN,
    client_token: e.BITBOT_RELAY_CLIENT_TOKEN,
  });
}

/**
 * 读配置。优先级：**文件 > 环境变量**（文件是用户显式写下的意图，环境变量只是运维逃生口）。
 *  - `opts.file` 给了但不存在 / 不是合法 JSON / 半套 ⇒ 落到环境变量再看一眼；
 *  - `opts.env` 显式传 `{}` ⇒ 不读进程环境（门禁用它确定地扮演「没配」）。
 * 任何异常都不抛：**配置读不出来不该把桌面拖死**，最坏结果就是「这轮没有跨网参数」。
 */
function loadRelayConfig(opts) {
  const o = opts || {};
  const file = o.file ? String(o.file) : defaultRelayConfigPath(o.repoRoot);
  let fromFile = null;
  try {
    if (fs.existsSync(file)) {
      fromFile = normalizeRelayConfig(JSON.parse(fs.readFileSync(file, "utf8")));
    }
  } catch (_) {
    fromFile = null; // 坏 JSON / 权限不足：当作没配，不抛
  }
  if (fromFile) return fromFile;
  const env = o.env === undefined ? process.env : o.env;
  return relayConfigFromEnv(env);
}

/**
 * 交给手机的**四栏**（A3-6 的 `relay` 字段就是这个形状）。
 * 注意：这里刻意**不**包含 `box_token` —— 那是桌面自己的钥匙，下发等于把登记权交给手机。
 */
function toHandoff(cfg) {
  const c = normalizeRelayConfig(cfg);
  if (!c) return null;
  return { host: c.host, port: c.port, box_id: c.boxId, client_token: c.clientToken };
}

module.exports = {
  defaultRelayConfigPath,
  normalizeRelayConfig,
  relayConfigFromEnv,
  loadRelayConfig,
  toHandoff,
};
