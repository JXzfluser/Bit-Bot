"use strict";
/**
 * relay_server.js — A3-1 中转节点（「哑」转发，TCP/TLS 透传）；A3-8 增加反向模式
 *
 * 职责（只这五件，不多做）：
 *  1. 成员凭证签发/校验 —— 复用 relay_keys（box / client 两类角色）；
 *  2. Box 登记可达端点（host:port）或挂一条反向控制长连接；
 *  3. 盲转发 —— 客户端 AUTH 后 CONNECT <boxId>，relay 把两端接起来，
 *     之后双向 pipe，**绝不解析应用层、绝不缓存 payload、绝不存业务密钥**；
 *  4. 健康检查 —— 独立 HTTP /healthz 供容器探针；
 *  5. 元数据审计日志（可选 logFile）—— 只记 auth/register/bind/connect/accept/attach/close
 *     的元数据（role/memberId/boxId/endpoint/bytes/streamId），
 *     **绝不记 token、绝不记 payload/正文/附件**。
 *     这是 A3-2「内容不可见」的实证面：日志存在且查无明文，比「无日志即无明文」更硬。
 *
 * 转发模型（已锁定）：TCP/TLS 透传。控制面用 relay-secret 鉴权；数据面是端到端不透明的
 * 字节流。因此「内容不可见」（A3-2）是结构性的：relay 根本没有应用层可看，也从不落盘内容。
 *
 * ── A3-8：两种转发模型并存 ──────────────────────────────────────────────
 *
 *  ① dial（A3-1 原样保留）：REGISTER <boxId> <host:port>，client CONNECT 时 relay 主动
 *     `net.connect` 到该端点。要求端点对 relay **可达** —— 公网 relay 拨不进 NAT 后面的桌面。
 *
 *  ② reverse（本片新增，关 R-A3-6g）：
 *
 *       box   → relay : AUTH <box_token> / BIND <boxId>      → BOUND（长连接，不关）
 *       phone → relay : AUTH <client_token> / CONNECT <boxId>
 *       relay → box   : ACCEPT <streamId>                    （沿上面那条长连接）
 *       box   → relay : 新开一条**出站** TCP，AUTH / ATTACH <streamId>  ← NAT 友好
 *       box   :         ATTACH 连接 ⇄ 本地 cn_inbound 双向 pipe（最后一跳在盒子里完成）
 *       relay → phone : TUNNEL <label>                       （ATTACH 到了才回，不空转）
 *       relay :         phone socket ⇄ ATTACH socket 双向 pipe，仍是盲转发
 *
 *     relay 全程**零主动拨**；盒子的 endpoint 只作展示/审计，不被连接。手机端看到的仍是
 *     一行 `TUNNEL <非空 token>`，因此 RelayTunnel.kt 零改动、APK 不用重打。
 *
 * 注：Box 自身的 cn_inbound_server 目前是明文 HTTP（既有事实，非本节点引入）；relay 只是
 * 把它「搬」到公网可达，不新增任何明文暴露面。端到端业务 TLS 属于后续工作，不在 A3-1 范围。
 */

const net = require("net");
const http = require("http");
const tls = require("tls");
const fs = require("fs");
const crypto = require("crypto");
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
  // 没人接 ACCEPT 时的等待上限：手机端要拿到明确 NOBOX，不能停在「连接中」。
  // 3s 是产品口径（见 prove_relay_reverse_tunnel.js RV-07），这里留 500ms 余量。
  const attachTimeoutMs = Number((opts && opts.attachTimeoutMs) || 2500);
  // A3-9 应用层保活：BIND 是长连接，NAT 映射过期会造成「TCP 还连着、盒子其实叫不醒」的半开。
  // relay 周期性发 PING，连续 pingMissLimit 次没收到 PONG 就清 registry 并断链。
  // 默认 5s / 2 次（10s 内发现）；门禁把它调快，不靠 sleep 猜状态。
  const pingIntervalMs = Number((opts && opts.pingIntervalMs) || 5000);
  const pingMissLimit = Math.max(1, Number((opts && opts.pingMissLimit) || 2));
  // A3-13：同时在等 ATTACH 的 stream 上限。没有它，一堆没人接的 CONNECT 会各自
  // 挂着一个 2.5s 定时器和一条暂停的 socket，内存/ fd 都无上界。超限明确回 NOBOX。
  const maxPendingStreams = Math.max(1, Number((opts && opts.maxPendingStreams) || 64));

  // boxId -> { kind:"dial"|"reverse", endpoint, host, port, registeredAt, control? }
  // control 是**进程内 socket 引用**，绝不进 getRegistry() 快照（会循环引用 / 泄元数据）。
  const registry = new Map();
  // streamId -> { clientSock, boxId, memberId, control, timer }
  const pendingStreams = new Map();
  const controls = new WeakMap(); // socket -> { authed, buf, tunneled, pending }
  const boundBoxId = new WeakMap(); // socket -> boxId（仅 BIND 控制长连接）
  const allSockets = new Set(); // stop() 要主动掐断，否则 server.close 会一直等长连接
  const liveness = new WeakMap(); // BIND socket -> { awaiting, nonce, missed, timer }
  let livenessEvictions = 0;
  let pendingRejected = 0; // A3-13：被并发上限挡掉的 CONNECT 数
  let connectionsForwarded = 0;
  let bytesForwarded = 0;
  let dialAttempts = 0; // 只有 openBox() 的 net.connect 会 +1：reverse 全程必须不变
  let streamsServed = 0;
  let controlSrv = null;
  let healthSrv = null;
  const auditLog = []; // 内存审计缓冲，供 getAuditLog()

  // 元数据日志助手（A3-2）：只记事件元数据（event/role/memberId/boxId/endpoint/bytes/streamId），
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

  /** 把一条控制面 socket 切成数据面：冻结解析，返回粘连的剩余字节。 */
  function toDataPlane(sock) {
    const c = controls.get(sock);
    if (!c) return "";
    const initial = c.buf;
    c.buf = "";
    c.pending = false;
    c.tunneled = true;
    return initial;
  }

  // 开一条到 box 的 TCP，把控制缓冲里的数据面首字节带走，之后双向盲 pipe
  function openBox(clientSock, target, initialData, meta) {
    dialAttempts++; // ← 唯一的主动拨计数点；reverse 路径绝不经过这里
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

  /** 两条已就绪的 socket 双向盲 pipe（reverse 用），initial* 是各自粘连的首字节。 */
  function bridge(a, b, initialA, initialB, meta) {
    let connBytes = 0;
    if (initialA) {
      try {
        b.write(initialA, "latin1");
        connBytes += Buffer.byteLength(initialA, "latin1");
      } catch (_) {}
    }
    if (initialB) {
      try {
        a.write(initialB, "latin1");
        connBytes += Buffer.byteLength(initialB, "latin1");
      } catch (_) {}
    }
    bytesForwarded += connBytes;
    connectionsForwarded++;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      log("close", {
        role: meta && meta.role,
        memberId: meta && meta.memberId,
        boxId: meta && meta.boxId,
        bytes: connBytes,
      });
      try {
        a.destroy();
      } catch (_) {}
      try {
        b.destroy();
      } catch (_) {}
    };
    a.on("data", (d) => {
      bytesForwarded += d.length;
      connBytes += d.length;
    });
    b.on("data", (d) => {
      bytesForwarded += d.length;
      connBytes += d.length;
    });
    a.on("error", close);
    b.on("error", close);
    a.on("close", close);
    b.on("close", close);
    // clientSock.pause() 在等 ATTACH 期间挡住读取；pipe() 会自行 resume 被暂停的
    // source。M06 负向对照实测：手写 a.resume() 摘掉后门仍全绿 ⇒ 那是冗余代码，已删，
    // 不留一个「门抓不到的锚点」。
    a.pipe(b);
    b.pipe(a);
  }

  /** 清掉一个还在等 ATTACH 的 stream，并给手机一个明确结果（绝不让它干等）。 */
  function dropPending(streamId, reply) {
    const p = pendingStreams.get(streamId);
    if (!p) return;
    clearTimeout(p.timer);
    pendingStreams.delete(streamId);
    if (reply) {
      try {
        p.clientSock.write(reply + "\n");
      } catch (_) {}
    }
    try {
      p.clientSock.destroy();
    } catch (_) {}
  }

  /** A3-9：给 BIND 长连接装应用层心跳。半开（NAT 映射过期）时 TCP 不报错，只能靠它发现。 */
  function startLiveness(sock, boxId) {
    const st = { awaiting: false, nonce: "", missed: 0, timer: null };
    liveness.set(sock, st);
    const tick = () => {
      if (sock.destroyed) return;
      if (st.awaiting) {
        st.missed++;
        if (st.missed >= pingMissLimit) {
          livenessEvictions++;
          log("liveness-timeout", { role: "box", boxId, missed: st.missed });
          const cur = registry.get(boxId);
          if (cur && cur.control === sock) registry.delete(boxId);
          try { sock.destroy(); } catch (_) {}
          return;
        }
      }
      st.nonce = crypto.randomBytes(4).toString("hex");
      st.awaiting = true;
      log("ping", { role: "box", boxId });
      try { sock.write("PING " + st.nonce + "\n"); } catch (_) {}
    };
    st.timer = setInterval(tick, pingIntervalMs);
    if (st.timer.unref) st.timer.unref();
  }

  /**
   * reverse 模式：先不回 TUNNEL，沿 BIND 长连接下发 ACCEPT，等盒子用一条**出站**连接
   * ATTACH 回来，才给手机回 TUNNEL 并 pipe。ATTACH 到了才回，是为了「TUNNEL 即通」。
   */
  function acceptReverse(clientSock, target, boxId, memberId) {
    // A3-13：先挡并发上限，别让一堆没人接的 CONNECT 各挂一条定时器 + 暂停 socket。
    // 拒绝时**不能** pause / 进 pending，直接明确回 NOBOX，手机端已有对应人话。
    if (pendingStreams.size >= maxPendingStreams) {
      pendingRejected++;
      log("stream-reject", {
        role: "client", memberId, boxId,
        active: pendingStreams.size, limit: maxPendingStreams,
      });
      return fail(clientSock, "NOBOX");
    }
    const cc = controls.get(clientSock);
    if (cc) cc.pending = true;
    // A3-9：绝不把业务字节攒进 relay 用户态。pause 让 TCP 接收缓冲替我们持有，
    // ATTACH 到了由 pipe 自然 resume；否则大附件在等 ATTACH 的窗口里能撑爆内存。
    clientSock.pause();
    const streamId = crypto.randomBytes(8).toString("hex"); // 16 hex，无空白、无凭证
    const control = target.control;
    const timer = setTimeout(() => dropPending(streamId, "NOBOX"), attachTimeoutMs);
    if (timer.unref) timer.unref();
    pendingStreams.set(streamId, { clientSock, boxId, memberId, control, timer });
    log("accept", { role: "client", memberId, boxId, streamId });
    if (!control || control.destroyed) {
      dropPending(streamId, "NOBOX");
      return;
    }
    try {
      control.write("ACCEPT " + streamId + "\n");
    } catch (_) {
      dropPending(streamId, "NOBOX");
    }
  }

  function handleControl(sock) {
    const c = { authed: null, buf: "", tunneled: false, pending: false };
    controls.set(sock, c);
    allSockets.add(sock);

    sock.on("data", (chunk) => {
      // 数据面由 pipe 接管：这里必须直接返回，绝不能把业务字节继续攒进 c.buf
      // （长连接会把整段 HTTP 乃至附件都堆进内存，既是泄漏也违反「不缓存 payload」）。
      if (c.tunneled) return;
      // pending（等 ATTACH）期间已 pause，这里不该再收到 data；
      // 万一收到也**绝不攒进 c.buf**（用户态零持有，见 pendingBufferBytes 诊断）。
      if (c.pending) return;
      c.buf += chunk.toString("latin1"); // latin1：逐字节切行，不解析应用层
      let nl;
      while ((nl = c.buf.indexOf("\n")) >= 0) {
        const line = c.buf.slice(0, nl).trim();
        c.buf = c.buf.slice(nl + 1);
        if (!line) continue;
        const sp = line.indexOf(" ");
        const cmd = sp < 0 ? line : line.slice(0, sp);
        const arg = sp < 0 ? "" : line.slice(sp + 1).trim();

        if (cmd === "AUTH") {
          const v = verifyRelayCredential(relaySecret, arg);
          if (!v.ok) return fail(sock, "DENY");
          c.authed = { memberId: v.memberId, role: v.role };
          // 只记核验通过的元数据：role/memberId，绝不记 token（arg）
          log("auth", { role: v.role, memberId: v.memberId });
          sock.write("OK\n");
        } else if (!c.authed) {
          return fail(sock, "DENY");
        } else if (c.authed.role === "box" && cmd === "REGISTER") {
          const sp2 = arg.indexOf(" ");
          const boxId = sp2 < 0 ? arg : arg.slice(0, sp2);
          const endpointStr = sp2 < 0 ? "" : arg.slice(sp2 + 1).trim();
          const ep = parseEndpoint(endpointStr);
          if (!boxId || !ep) return fail(sock, "BADREG");
          registry.set(boxId, { kind: "dial", endpoint: endpointStr, host: ep.host, port: ep.port, registeredAt: Date.now() });
          // 只记 register 元数据：boxId/endpoint，绝不记内容
          log("register", { role: "box", memberId: c.authed.memberId, boxId, endpoint: endpointStr });
          sock.write("REGISTERED\n");
          sock.end();
        } else if (c.authed.role === "box" && cmd === "BIND") {
          const boxId = arg.split(/\s+/)[0] || "";
          if (!boxId) return fail(sock, "BADREG");
          // 这条连接**不 end**：它是反向隧道的控制通道，活着才代表盒子在线。
          registry.set(boxId, {
            kind: "reverse",
            endpoint: "reverse:" + boxId, // 只作展示/审计，relay 从不拨它
            registeredAt: Date.now(),
            control: sock,
          });
          boundBoxId.set(sock, boxId);
          log("bind", { role: "box", memberId: c.authed.memberId, boxId, endpoint: "reverse:" + boxId });
          sock.write("BOUND " + boxId + "\n");
          startLiveness(sock, boxId);
        } else if (c.authed.role === "client" && cmd === "CONNECT") {
          const target = registry.get(arg);
          if (!target) return fail(sock, "NOBOX");
          // 只记 connect 元数据：boxId/endpoint，绝不记后续数据面内容
          log("connect", { role: "client", memberId: c.authed.memberId, boxId: arg, endpoint: target.endpoint });
          if (target.kind === "reverse") {
            acceptReverse(sock, target, arg, c.authed.memberId);
            return; // ← 绝不落到 openBox，这是「零主动拨」的结构保证
          }
          sock.write("TUNNEL " + target.endpoint + "\n");
          const initial = toDataPlane(sock); // CONNECT 行之后粘连的数据面首字节
          openBox(sock, target, initial, { role: "client", memberId: c.authed.memberId, boxId: arg });
          return;
        } else if (c.authed.role === "box" && cmd === "ATTACH") {
          const streamId = arg.split(/\s+/)[0] || "";
          const p = pendingStreams.get(streamId);
          if (!p) return fail(sock, "BADATTACH");
          clearTimeout(p.timer);
          pendingStreams.delete(streamId);
          streamsServed++;
          log("attach", { role: "box", memberId: c.authed.memberId, boxId: p.boxId, streamId });
          const cc2 = controls.get(p.clientSock);
          const clientInitial = cc2 ? cc2.buf : "";
          if (cc2) {
            cc2.buf = "";
            cc2.pending = false;
            cc2.tunneled = true;
          }
          const attachInitial = toDataPlane(sock);
          try {
            p.clientSock.write("TUNNEL reverse:" + p.boxId + "\n");
          } catch (_) {}
          bridge(p.clientSock, sock, clientInitial, attachInitial, {
            role: "client",
            memberId: p.memberId,
            boxId: p.boxId,
          });
          return;
        } else if (c.authed.role === "box" && cmd === "PONG") {
          const st = liveness.get(sock);
          // nonce 必须对得上，否则是噪声/重放，不算活。绝不回 BADCMD —— 那会误杀长连接。
          if (st && arg === st.nonce) {
            st.awaiting = false;
            st.missed = 0;
          }
        } else if (boundBoxId.has(sock)) {
          // BIND 长连接上出现未知行：记一条元数据即可。**不 destroy** ——
          // 断掉控制通道会让盒子「在线」状态瞬间消失，代价远大于忽略一行噪声。
          log("badcmd-on-bind", { role: "box", memberId: c.authed.memberId });
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
    sock.on("close", () => {
      allSockets.delete(sock);
      const lv0 = liveness.get(sock);
      if (lv0 && lv0.timer) clearInterval(lv0.timer);
      liveness.delete(sock);
      const bid = boundBoxId.get(sock);
      if (bid) {
        const cur = registry.get(bid);
        // 只有「登记仍指向这条连接」才删：旧连接晚到的 close 不能冲掉新登记。
        if (cur && cur.control === sock) {
          registry.delete(bid);
          log("unbind", { role: "box", boxId: bid });
        }
      }
      // 控制通道一断，挂在它上面等 ATTACH 的手机立刻拿到 NOBOX，不等超时。
      for (const [sid, p] of Array.from(pendingStreams)) {
        if (p.control === sock) dropPending(sid, "NOBOX");
      }
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
      // BIND 是长连接：不主动掐断的话 server.close() 会一直等，门禁/进程都退不干净。
      for (const [, p] of pendingStreams) clearTimeout(p.timer);
      pendingStreams.clear();
      for (const s of Array.from(allSockets)) {
        const lv = liveness.get(s);
        if (lv && lv.timer) clearInterval(lv.timer);
        try {
          s.destroy();
        } catch (_) {}
      }
      allSockets.clear();
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
    /** 进程内登记（测试 / 镜像预置用）；线协议走 REGISTER。保持 dial 语义不变。 */
    registerBox(boxId, endpoint) {
      const ep = parseEndpoint(endpoint);
      if (!boxId || !ep) return { ok: false };
      registry.set(boxId, { kind: "dial", endpoint, host: ep.host, port: ep.port, registeredAt: Date.now() });
      return { ok: true };
    },
    /** 快照：boxId -> { endpoint, registeredAt, kind }，绝不含 socket 引用/凭证/内容 */
    getRegistry() {
      const out = {};
      for (const [k, v] of registry) {
        out[k] = { endpoint: v.endpoint, registeredAt: v.registeredAt, kind: v.kind || "dial" };
      }
      return out;
    },
    /** 诊断态：仅计数，绝不带 payload */
    getDiagnosticState() {
      let reverseBoxes = 0;
      for (const v of registry.values()) if (v.kind === "reverse") reverseBoxes++;
      // A3-9：等 ATTACH 的窗口里 relay 用户态持有的业务字节数。
      // 改成 clientSock.pause() 后应恒为 0（CONNECT 行粘连的首包除外）。
      let pendingBufferBytes = 0;
      let pendingSocketsPaused = 0;
      for (const p of pendingStreams.values()) {
        const pc = controls.get(p.clientSock);
        if (pc) pendingBufferBytes += Buffer.byteLength(pc.buf, "latin1");
        // 「0 字节」有两种可能：内核缓冲替我们持有（对），或字节被读走丢了（错）。
        // 只看 pendingBufferBytes 会把后者当绿 —— 必须同时看 socket 真的处于 paused。
        if (p.clientSock && typeof p.clientSock.isPaused === "function" && p.clientSock.isPaused()) {
          pendingSocketsPaused++;
        }
      }
      return {
        boxes: registry.size,
        connectionsForwarded,
        bytesForwarded,
        dialAttempts,
        reverseBoxes,
        activeStreams: pendingStreams.size,
        streamsServed,
        livenessEvictions,
        pendingBufferBytes,
        pendingSocketsPaused,
        pendingRejected,
        maxPendingStreams,
      };
    },
    /** 数据面永不缓存内容 —— 恒返回空数组，供门禁证明不落明文 */
    getCapturedPayloads() {
      return [];
    },
    /** A3-2 元数据审计日志：只含 event/role/memberId/boxId/endpoint/bytes/streamId，绝不返回 token/payload */
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
