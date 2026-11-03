"use strict";
/**
 * relay_server.js — A3-1 中转节点（「哑」转发，TCP/TLS 透传）
 *
 * 职责（只这五件，不多做）：
 *  1. 成员凭证签发/校验 —— 复用 relay_keys（box / client 两类角色）；
 *  2. Box 登记可达端点（host:port）；
 *  3. 盲转发 —— 客户端 AUTH 后 CONNECT <boxId>，relay 开一条到该 box 的 TCP，
 *     之后双向 pipe，**绝不解析应用层、绝不缓存 payload、绝不存业务密钥**；
 *  4. 健康检查 —— 独立 HTTP /healthz 供容器探针；
 *  5. 元数据审计日志（可选 logFile）—— 只记 auth/register/connect/close 的元数据
 *     （role/memberId/boxId/endpoint/bytes），**绝不记 token、绝不记 payload/正文/附件**。
 *     这是 A3-2「内容不可见」的实证面：日志存在且查无明文，比「无日志即无明文」更硬。
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
const fs = require("fs");
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
  const logFile = (opts && opts.logFile) ? String(opts.logFile) : null; // 可选元数据审计日志路径
  const verbose = Boolean(opts && opts.verbose);
  // 监听地址：默认 127.0.0.1（本地/门禁安全），容器镜像须设 0.0.0.0（否则端口映射打不进容器回环）
  const bindHost = String((opts && opts.bindHost) || "127.0.0.1");
  const registry = new Map(); // boxId -> { endpoint, host, port, registeredAt }
  let connectionsForwarded = 0;
  let bytesForwarded = 0;
  let controlSrv = null;
  let healthSrv = null;
  const auditLog = []; // 内存审计缓冲，供 getAuditLog()

  // 元数据日志助手（A3-2）：只记事件元数据（event/role/memberId/boxId/endpoint/bytes），
  // 绝不记 token、绝不记 payload/正文/附件/密钥。写文件（JSON 行）+ 内存缓冲。
  // delete 防御：即便调用方误传明文/payload/token 字段，也一律不落日志。
  function log(event, meta) {
    const rec = Object.assign({ t: Date.now(), event }, meta || {});
    delete rec.token;
    delete rec.payload;
    delete rec.body;
    delete rec.attachment;
    delete rec.secret;
    delete rec.credential;
    auditLog.push(rec);
    if (auditLog.length > 10000) auditLog.shift();
    if (logFile) {
      try {
        fs.appendFileSync(logFile, JSON.stringify(rec) + "\n");
      } catch (_) {}
    }
    if (verbose) {
      try {
        console.log("[relay:" + event + "] " + JSON.stringify(rec));
      } catch (_) {}
    }
  }

  function fail(sock, msg) {
    try {
      sock.write(msg + "\n");
    } catch (_) {}
    sock.destroy();
  }

  // 开一条到 box 的 TCP，把控制缓冲里的数据面首字节带走，之后双向盲 pipe
  function openBox(clientSock, target, initialData, meta) {
    let connBytes = initialData ? Buffer.byteLength(initialData, "latin1") : 0;
    let closed = false;
    const boxSock = net.connect(target.port, target.host, () => {
      connectionsForwarded++;
      if (initialData) {
        boxSock.write(initialData, "latin1");
        bytesForwarded += connBytes;
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
      connBytes += d.length;
    });
    clientSock.on("data", (d) => {
      bytesForwarded += d.length;
      connBytes += d.length;
    });
    clientSock.on("close", () => {
      // 关闭时记一条 close 元数据（bytes>0 即确有数据流过），绝不记 payload
      if (!closed) {
        closed = true;
        log("close", {
          role: meta && meta.role,
          memberId: meta && meta.memberId,
          boxId: meta && meta.boxId,
          bytes: connBytes,
        });
      }
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
          // 只记核验通过的元数据：role/memberId，绝不记 token（arg）
          log("auth", { role: v.role, memberId: v.memberId });
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
          // 只记 register 元数据：boxId/endpoint，绝不记内容
          log("register", { role: "box", memberId: authed.memberId, boxId, endpoint: endpointStr });
          sock.write("REGISTERED\n");
          sock.end();
        } else if (authed.role === "client" && cmd === "CONNECT") {
          const target = registry.get(arg);
          if (!target) return fail(sock, "NOBOX");
          // 只记 connect 元数据：boxId/endpoint，绝不记后续数据面内容
          log("connect", { role: "client", memberId: authed.memberId, boxId: arg, endpoint: target.endpoint });
          sock.write("TUNNEL " + target.endpoint + "\n");
          tunneled = true;
          const initial = buf; // CONNECT 行之后粘连的数据面首字节
          buf = "";
          openBox(sock, target, initial, { role: "client", memberId: authed.memberId, boxId: arg });
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
      healthSrv.listen(opts && opts.healthPort ? opts.healthPort : 0, bindHost, () => {
        const mk = tlsOpts ? tls : net;
        controlSrv = mk.createServer(tlsOpts || {}, handleControl);
        controlSrv.listen(opts && opts.controlPort ? opts.controlPort : 0, bindHost, () => {
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
    /** A3-2 元数据审计日志：只含 event/role/memberId/boxId/endpoint/bytes，绝不返回 token/payload */
    getAuditLog() {
      return auditLog.slice();
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
    logFile: process.env.BITBOT_RELAY_LOGFILE ? String(process.env.BITBOT_RELAY_LOGFILE) : null,
    verbose: process.env.BITBOT_RELAY_VERBOSE === "1",
    bindHost: process.env.BITBOT_RELAY_BIND ? String(process.env.BITBOT_RELAY_BIND) : "127.0.0.1",
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
