"use strict";
/**
 * relay_box_client.js — 桌面以 **box 角色**把自己登记到中转上（A3-7 / 关 R-A3-6e）
 *                        A3-8 增加 reverse 模式（关 R-A3-6g）
 *
 * 为什么必须补这一块：A3-1 交付的是中转**服务端**（`relay_server.js`），仓库里能 REGISTER 的
 * 只有测试用的进程内 `registerBox()`。也就是说 —— 手机拿着正确的四栏、中转也活着，真发一条
 * `CONNECT` 仍然只会拿到 `NOBOX`，因为**没有任何进程把「这台盒子在线」这件事告诉过中转**。
 *
 * ── 两种模式 ────────────────────────────────────────────────────────────
 *
 * ① dial（默认，A3-1..A3-7 原样保留）：
 *
 *     AUTH <box_token>            → OK | DENY
 *     REGISTER <boxId> <host:port>→ REGISTERED | BADREG | BADCMD
 *
 *   一次 REGISTER 一条短连接（relay 收下就 `sock.end()`），30s 心跳重登记。
 *   前提：登记的端点对 relay **可达** —— 公网 relay 拨不进 NAT 后面的桌面。
 *
 * ② reverse（本片新增）：
 *
 *     AUTH <box_token> / BIND <boxId>        → OK / BOUND <boxId>（**长连接，不断**）
 *     relay → box : ACCEPT <streamId>
 *     box   → relay: 新开一条**出站** TCP，AUTH / ATTACH <streamId>
 *     box   :         ATTACH 连接 ⇄ localEndpoint（本机 cn_inbound）双向 pipe
 *
 *   relay 全程零主动拨；盒子只发起出站连接，NAT 后面的机器也能被服务。
 *   `endpoint` 在 reverse 下**只作展示**，从不被连接（门禁故意传一个不可达地址来证明这点）。
 *
 * 三个设计点，每个都有代价：
 *  1. **一次 REGISTER 一条短连接**：relay 收下 `REGISTER` 后立刻 `sock.end()`（它只要这条记录），
 *     所以 dial 模式不做长连接复用 —— 复用反而会出现「以为还登记着、其实 relay 已换进程」的假象。
 *  2. **必须周期重登记 / 断线重连**：registry 是 relay 的**内存表**，relay 重启/换机器就空了；
 *     reverse 的控制长连接断了，registry 也会被 relay 立刻清掉。dial 用 heartbeatMs 周期重登记，
 *     reverse 用 reconnectMs 重连，都不搞指数退避 —— 这类失败通常是「relay 还没起来」，
 *     退避只会让恢复更慢。
 *  3. **失败不抛**：这是后台常驻任务，抛出去没人接；但 `getState()` 必须说真话
 *     （`not-configured` / `denied` / `badreg` / `badcmd` / `transport` 各自区分）—— 把「凭证不对」说成
 *     「网络不好」，用户就只能瞎试。
 *
 * 这个模块只依赖 `net`，可被门禁直接拿真 relay 跑（`scripts/prove_relay_box_registration.js`
 * / `scripts/prove_relay_reverse_tunnel.js`）。
 */

const net = require("net");

const REASON_NOT_CONFIGURED = "not-configured";
const REASON_DENIED = "denied";
const REASON_BADREG = "badreg";
const REASON_BADCMD = "badcmd";
const REASON_TRANSPORT = "transport";
const REASON_BAD_CONFIG = "bad_config";

/** "host:port" → {host, port}；不合法回 null（与 relay 侧同一套判定）。 */
function parseEndpoint(s) {
  if (typeof s !== "string") return null;
  const idx = s.lastIndexOf(":");
  if (idx <= 0) return null;
  const host = s.slice(0, idx).trim();
  const port = Number(s.slice(idx + 1));
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}

/** 逐字节读到一行 —— 带缓冲的 Reader 会把后续字节吞进缓冲区，那正是「握手成功但消息不通」的老坑。
 *  dial 路径一字未动：它分两次 write，每次只有一行应答，不存在合并包问题。 */
function readLine(socket) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d) => {
      buf += d.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        cleanup();
        resolve(buf.slice(0, nl).trim());
      }
    };
    const onErr = (e) => {
      cleanup();
      reject(e);
    };
    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onErr);
    };
    socket.on("data", onData);
    socket.on("error", onErr);
  });
}

/**
 * reverse 控制长连接专用的**常驻**行泵。
 * 与上面 readLine 的区别是刻意的：`OK\nBOUND …\nACCEPT …\nACCEPT …\n` 会陆续到达、
 * 也可能挤在同一个 chunk 里。若每读一行就摘监听，剩下的行会永久丢失。
 */
function createLinePump(socket, onLine) {
  let buf = "";
  socket.on("data", (d) => {
    buf += d.toString("latin1");
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(line);
    }
  });
}

function createRelayBoxClient(opts) {
  const o = opts || {};
  const host = String(o.host || "").trim();
  const port = Number(o.port);
  const boxId = String(o.boxId || o.box_id || "").trim();
  const boxToken = String(o.boxToken || o.box_token || "").trim();
  const endpoint = String(o.endpoint || "").trim();
  // reverse：最后一跳连的是**本机** cn_inbound；dial：该字段不使用。
  const localEndpoint = String(o.localEndpoint || o.local_endpoint || "").trim();
  const mode = String(o.mode || "dial").trim() === "reverse" ? "reverse" : "dial";
  const connectTimeoutMs = Number(o.connectTimeoutMs || 8000);
  const replyTimeoutMs = Number(o.replyTimeoutMs || 8000);
  // 0 / 负数 = 不心跳（只登记一次）。门禁需要这个开关来证明「回来的是心跳，不是别的」。
  const heartbeatMs = Number(o.heartbeatMs === undefined ? 30000 : o.heartbeatMs);
  // reverse 控制长连接意外断开后的重连间隔；stop() 之后绝不重连。
  const reconnectMs = Number(o.reconnectMs === undefined ? 2000 : o.reconnectMs);
  const log = typeof o.log === "function" ? o.log : null;

  const state = {
    ok: false,
    boxId,
    endpoint,
    mode,
    heartbeatMs,
    attempts: 0,
    registeredAt: 0,
    streamsServed: 0,
    lastError: REASON_NOT_CONFIGURED,
    lastErrorAt: 0,
  };
  let timer = null;
  let reconnectTimer = null;
  let stopped = true;
  let controlSock = null;
  const streamSockets = new Set();

  function setError(reason) {
    state.ok = false;
    state.lastError = reason;
    state.lastErrorAt = Date.now();
    if (log) log(reason);
  }

  /** 本地能判死的就别发出去：`REGISTER <空 id>` 只会换回一个 BADREG，白花一条连接。 */
  function precheck() {
    if (!host) return REASON_NOT_CONFIGURED;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return REASON_NOT_CONFIGURED;
    if (!boxId || !boxToken) return REASON_NOT_CONFIGURED;
    if (!parseEndpoint(endpoint)) return REASON_BAD_CONFIG;
    return null;
  }

  /**
   * 登记一次。返回 `{ok:true, endpoint}` 或 `{ok:false, reason}` —— **不抛**，
   * 调用方（心跳）与门禁都靠这个返回值判断，不靠异常。
   * A3-8 未改动此函数：旧 REGISTER 线协议路径一字未动。
   */
  function registerOnce() {
    const pre = precheck();
    if (pre) {
      setError(pre);
      return Promise.resolve({ ok: false, reason: pre });
    }
    state.attempts++;
    return new Promise((resolve) => {
      const sock = new net.Socket();
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        try {
          sock.destroy();
        } catch (_) {}
        if (v.ok) {
          state.ok = true;
          state.registeredAt = Date.now();
          state.lastError = null;
        } else {
          setError(v.reason);
        }
        resolve(v);
      };

      sock.setTimeout(connectTimeoutMs, () => finish({ ok: false, reason: REASON_TRANSPORT }));
      sock.once("error", () => finish({ ok: false, reason: REASON_TRANSPORT }));
      sock.connect(port, host, async () => {
        try {
          sock.setTimeout(replyTimeoutMs);
          sock.write("AUTH " + boxToken + "\n");
          const auth = await readLine(sock);
          if (auth !== "OK") {
            // DENY 是「中转不认这个凭证」，不是网络问题 —— 两者对用户意味着完全不同的下一步。
            finish({ ok: false, reason: auth === "DENY" ? REASON_DENIED : REASON_BADCMD });
            return;
          }
          sock.write("REGISTER " + boxId + " " + endpoint + "\n");
          const reply = await readLine(sock);
          if (reply === "REGISTERED") finish({ ok: true, endpoint });
          else if (reply === "BADREG") finish({ ok: false, reason: REASON_BADREG });
          else finish({ ok: false, reason: REASON_BADCMD });
        } catch (_) {
          finish({ ok: false, reason: REASON_TRANSPORT });
        }
      });
    });
  }

  function tick() {
    if (stopped) return;
    registerOnce().then(() => {
      if (stopped || !(heartbeatMs > 0)) return;
      timer = setTimeout(tick, heartbeatMs);
      if (timer.unref) timer.unref();
    });
  }

  /* ─────────────────────────── reverse 模式 ─────────────────────────── */

  /** 一条 stream：新开**出站** ATTACH 连接 ⇄ 本机 cn_inbound，两端都是盒子主动发起的。 */
  function serveStream(streamId) {
    const localEp = parseEndpoint(localEndpoint);
    if (!localEp) return; // startReverse 已判过；这里再挡一次，绝不拿坏地址去连
    const attachSock = net.connect(port, host);
    const localSock = net.connect(localEp.port, localEp.host);
    streamSockets.add(attachSock);
    streamSockets.add(localSock);
    let attachConnected = false;
    let localConnected = false;
    let handshakeDone = false;
    let hsBuf = "";
    let piped = false;
    let dead = false;
    const kill = () => {
      if (dead) return;
      dead = true;
      streamSockets.delete(attachSock);
      streamSockets.delete(localSock);
      try { attachSock.destroy(); } catch (_) {}
      try { localSock.destroy(); } catch (_) {}
    };
    for (const s of [attachSock, localSock]) {
      s.once("error", kill);
      s.once("close", kill);
    }

    /**
     * ATTACH 连接**复用作数据面**，但 relay 对它的 AUTH 仍会回一行 `OK\n`。
     * 这行是控制面应答，绝不能 pipe 进 cn_inbound —— 否则 HTTP 服务把 `OK` 当请求行，
     * 直接回 400 Bad Request（本机实测：RV-04/RV-08 拿 400 就是这个）。
     * 旧的 REGISTER 是独立短连接，从来不会把控制应答混进数据面，所以这个坑只在 reverse 出现。
     */
    const onHandshake = (d) => {
      hsBuf += d.toString("latin1");
      const nl = hsBuf.indexOf("\n");
      if (nl < 0) return;
      const line = hsBuf.slice(0, nl).trim();
      const rest = hsBuf.slice(nl + 1);
      attachSock.removeListener("data", onHandshake);
      attachSock.pause(); // 摘掉最后一个 data 监听后必须显式暂停，否则 pipe 前的字节会在 flowing 态丢失
      handshakeDone = true;
      if (line !== "OK") return kill();
      // 同一 chunk 里粘连的、属于数据面的首字节，先按序喂给本地服务，再交给 pipe。
      if (rest) localSock.write(rest, "latin1");
      maybePipe();
    };
    attachSock.on("data", onHandshake);

    const maybePipe = () => {
      if (dead || piped || !(attachConnected && localConnected && handshakeDone)) return;
      piped = true;
      // 三件事都就绪才接通：两端连上 + 控制应答已剥掉，避免半条 stream 吞字节。
      attachSock.pipe(localSock);
      localSock.pipe(attachSock);
      state.streamsServed++;
    };
    attachSock.once("connect", () => {
      attachSock.write("AUTH " + boxToken + "\nATTACH " + streamId + "\n");
      attachConnected = true;
      maybePipe();
    });
    localSock.once("connect", () => {
      localConnected = true;
      maybePipe();
    });
  }

  function startReverse() {
    if (stopped) return;
    const localEp = parseEndpoint(localEndpoint);
    if (!host || !Number.isInteger(port) || !boxId || !boxToken || !localEp) {
      setError(localEp ? REASON_NOT_CONFIGURED : REASON_BAD_CONFIG);
      return;
    }
    state.attempts++;
    const sock = net.connect(port, host);
    controlSock = sock;
    let handshook = false;

    const dead = (reason) => {
      if (controlSock !== sock) return;
      controlSock = null;
      setError(reason);
      try { sock.destroy(); } catch (_) {}
      scheduleReconnect();
    };

    createLinePump(sock, (line) => {
      if (line === "OK") {
        // AUTH 通过，等 BOUND
      } else if (line === "DENY") {
        dead(REASON_DENIED);
      } else if (line.startsWith("BOUND ")) {
        if (line.slice(6).trim() !== boxId) return dead(REASON_BADCMD);
        handshook = true;
        sock.setTimeout(0); // 长连接空闲是正常的，握手完就撤掉读超时
        state.ok = true;
        state.registeredAt = Date.now();
        state.lastError = null;
      } else if (line.startsWith("ACCEPT ")) {
        const streamId = line.slice(7).trim();
        if (streamId && handshook) serveStream(streamId);
      } else {
        dead(REASON_BADCMD);
      }
    });

    sock.setTimeout(connectTimeoutMs, () => { if (!handshook) dead(REASON_TRANSPORT); });
    sock.once("error", () => { if (!handshook) dead(REASON_TRANSPORT); });
    sock.once("connect", () => {
      sock.setTimeout(replyTimeoutMs);
      sock.write("AUTH " + boxToken + "\nBIND " + boxId + "\n");
    });
    sock.once("close", () => {
      if (controlSock !== sock) return;
      controlSock = null;
      if (!stopped) {
        state.ok = false;
        state.lastError = REASON_TRANSPORT;
        state.lastErrorAt = Date.now();
        scheduleReconnect();
      }
    });
  }

  function scheduleReconnect() {
    if (stopped || !(reconnectMs > 0) || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) startReverse();
    }, reconnectMs);
    if (reconnectTimer.unref) reconnectTimer.unref();
  }

  /** 开始常驻登记：先立刻试一次（别让用户等一个心跳周期），之后按 heartbeatMs 重复。 */
  function start() {
    if (!stopped) return state;
    stopped = false;
    if (mode === "reverse") startReverse();
    else tick();
    return state;
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const cs = controlSock;
    controlSock = null; // 先置空：close 回调看到它不等于自己，就不会触发重连
    if (cs) {
      try { cs.destroy(); } catch (_) {}
    }
    for (const s of Array.from(streamSockets)) {
      try { s.destroy(); } catch (_) {}
    }
    streamSockets.clear();
    state.ok = false;
    return state;
  }

  function getState() {
    return Object.assign({}, state, { running: !stopped });
  }

  return { start, stop, registerOnce, getState };
}

module.exports = {
  createRelayBoxClient,
  parseEndpoint,
  REASON_NOT_CONFIGURED,
  REASON_DENIED,
  REASON_BADREG,
  REASON_BADCMD,
  REASON_TRANSPORT,
  REASON_BAD_CONFIG,
};
