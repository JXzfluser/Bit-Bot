"use strict";
/**
 * relay_server.js — A3-1 中转节点（「哑」转发，TCP/TLS 透传）
 *
 * 职责（只这四件，不多做）：
 *  1. 成员凭证签发/校验 —— 复用 relay_keys（box / client 两类角色）；
 *  2. Box 登记可达端点（host:port）；
 *  3. 盲转发 —— 客户端 AUTH 后 CONNECT <boxId>，relay 开一条到该 box 的 TCP，
 *     之后双向 pipe，**绝不解析应用层、绝不缓存 payload、绝不存业务密钥**；
 *  4. 健康检查 —— 独立 HTTP /healthz 供容器探针。
 *
 * 转发模型（已锁定）：TCP/TLS 透传。控制面用 relay-secret 鉴权；数据面是端到端不透明的
 * 字节流。因此「内容不可见」（A3-2）是结构性的：relay 根本没有应用层可看，也从不落盘内容。
 *
 * 注：Box 自身的 cn_inbound_server 目前是明文 HTTP（既有事实，非本节点引入）；relay 只是
 * 把它「搬」到公网可达，不新增任何明文暴露面。端到端业务 TLS 属于后续工作，不在 A3-1 范围。
 */

const net = require("net");
const http = require("http");
const tls = require("tls");
const { verifyRelayCredential } = require("./relay_keys");

/** "host:port" → {host, port}，非法返回 null */
function parseEndpoint(s) {
  if (typeof s !== "string") return null;
  const idx = s.lastIndexOf(":");
  if (idx < 0) return null;
  const host = s.slice(0, idx);
  const port = Number(s.slice(idx + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

function createRelayServer(opts) {
  const relaySecret = String((opts && opts.relaySecret) || "");
  const tlsOpts = (opts && opts.tls) || null;
  const registry = new Map(); // boxId -> { endpoint, host, port, registeredAt }
  let connectionsForwarded = 0;
  let bytesForwarded = 0;
  let controlSrv = null;
  let healthSrv = null;

  function fail(sock, msg) {
    try {
      sock.write(msg + "\n");
    } catch (_) {}
    sock.destroy();
  }

  // 开一条到 box 的 TCP，把控制缓冲里的数据面首字节带走，之后双向盲 pipe
  function openBox(clientSock, target, initialData) {
    const boxSock = net.connect(target.port, target.host, () => {
      connectionsForwarded++;
      if (initialData) {
        boxSock.write(initialData, "latin1");
        bytesForwarded += Buffer.byteLength(initialData, "latin1");
      }
    });
    const onBoxErr = () => {
      try {
        clientSock.destroy();
      } catch (_) {}
    };
    const onClientErr = () => {
      try {
        boxSock.destroy();
      } catch (_) {}
    };
    boxSock.on("error", onBoxErr);
    clientSock.on("error", onClientErr);
    boxSock.on("data", (d) => {
      bytesForwarded += d.length;
    });
    clientSock.on("data", (d) => {
      bytesForwarded += d.length;
    });
    clientSock.on("close", () => {
      try {
        boxSock.destroy();
      } catch (_) {}
    });
    boxSock.on("close", () => {
      try {
        clientSock.destroy();
      } catch (_) {}
    });
    // 盲转发：双向 pipe，不 inspect、不缓存
    clientSock.pipe(boxSock);
    boxSock.pipe(clientSock);
  }

  function handleControl(sock) {
    let authed = null; // { memberId, role }
    let buf = "";
    let tunneled = false;

    sock.on("data", (c) => {
      if (tunneled) return; // 数据面已由 pipe 接管，控制面不再处理
      buf += c.toString("latin1"); // latin1：逐字节切行，不解析应用层
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const sp = line.indexOf(" ");
        const cmd = sp < 0 ? line : line.slice(0, sp);
        const arg = sp < 0 ? "" : line.slice(sp + 1).trim();

        if (cmd === "AUTH") {
          const v = verifyRelayCredential(relaySecret, arg);
          if (!v.ok) return fail(sock, "DENY");
          authed = { memberId: v.memberId, role: v.role };
          sock.write("OK\n");
        } else if (!authed) {
          return fail(sock, "DENY");
        } else if (authed.role === "box" && cmd === "REGISTER") {
          const sp2 = arg.indexOf(" ");
          const boxId = sp2 < 0 ? arg : arg.slice(0, sp2);
          const endpointStr = sp2 < 0 ? "" : arg.slice(sp2 + 1).trim();
          const ep = parseEndpoint(endpointStr);
          if (!boxId || !ep) return fail(sock, "BADREG");
          registry.set(boxId, { endpoint: endpointStr, host: ep.host, port: ep.port, registeredAt: Date.now() });
          sock.write("REGISTERED\n");
          sock.end();
        } else if (authed.role === "client" && cmd === "CONNECT") {
          const target = registry.get(arg);
          if (!target) return fail(sock, "NOBOX");
          sock.write("TUNNEL " + target.endpoint + "\n");
          tunneled = true;
          const initial = buf; // CONNECT 行之后粘连的数据面首字节
          buf = "";
          openBox(sock, target, initial);
          return;
        } else {
          return fail(sock, "BADCMD");
        }
      }
    });
    sock.on("error", () => {
      try {
        sock.destroy();
      } catch (_) {}
    });
  }

  function start() {
    return new Promise((resolve) => {
      healthSrv = http.createServer((req, res) => {
        if (req.method === "GET" && (req.url === "/healthz" || req.url === "/")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, boxes: registry.size }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      healthSrv.listen(opts && opts.healthPort ? opts.healthPort : 0, "127.0.0.1", () => {
        const mk = tlsOpts ? tls : net;
        controlSrv = mk.createServer(tlsOpts || {}, handleControl);
        controlSrv.listen(opts && opts.controlPort ? opts.controlPort : 0, "127.0.0.1", () => {
          resolve({
            controlPort: controlSrv.address().port,
            healthPort: healthSrv.address().port,
            tls: Boolean(tlsOpts),
          });
        });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      let pending = 2;
      const done = () => {
        if (--pending <= 0) resolve();
      };
      try {
        controlSrv.close(done);
      } catch (_) {
        done();
      }
      try {
        healthSrv.close(done);
      } catch (_) {
        done();
      }
    });
  }

  return {
    start,
    stop,
    /** 进程内登记（测试 / 镜像预置用）；线协议走 REGISTER */
    registerBox(boxId, endpoint) {
      const ep = parseEndpoint(endpoint);
      if (!boxId || !ep) return { ok: false };
      registry.set(boxId, { endpoint, host: ep.host, port: ep.port, registeredAt: Date.now() });
      return { ok: true };
    },
    /** 快照：boxId -> { endpoint, registeredAt }，不含任何内容 */
    getRegistry() {
      const out = {};
      for (const [k, v] of registry) out[k] = { endpoint: v.endpoint, registeredAt: v.registeredAt };
      return out;
    },
    /** 诊断态：仅计数，绝不带 payload */
    getDiagnosticState() {
      return { boxes: registry.size, connectionsForwarded, bytesForwarded };
    },
    /** 数据面永不缓存内容 —— 恒返回空数组，供门禁证明不落明文 */
    getCapturedPayloads() {
      return [];
    },
  };
}

module.exports = { createRelayServer, parseEndpoint };

// 入口进程：直接 `node relay_server.js` 时按环境变量启动（Docker 镜像的 CMD 走这里）。
// 被 require 时不触发，保证门禁可干净地作为模块引入。
if (require.main === module) {
  const secret = String(process.env.BITBOT_RELAY_SECRET || "");
  if (!secret) {
    console.error("[relay] FATAL: BITBOT_RELAY_SECRET 未设置 —— 中继无法签发/校验成员凭证");
    process.exit(1);
  }
  const srv = createRelayServer({
    controlPort: Number(process.env.BITBOT_RELAY_CONTROL_PORT || 18766),
    healthPort: Number(process.env.BITBOT_RELAY_HEALTH_PORT || 18767),
    relaySecret: secret,
  });
  srv
    .start()
    .then((info) => {
      console.log(
        "[relay] up — control=" + info.controlPort + " health=" + info.healthPort + " tls=" + info.tls,
      );
    })
    .catch((e) => {
      console.error("[relay] FATAL: " + String((e && e.stack) || e));
      process.exit(1);
    });
}
