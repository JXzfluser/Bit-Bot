"use strict";
/**
 * relay_box_client.js — 桌面以 **box 角色**把自己登记到中转上（A3-7 / 关 R-A3-6e）
 *
 * 为什么必须补这一块：A3-1 交付的是中转**服务端**（`relay_server.js`），仓库里能 REGISTER 的
 * 只有测试用的进程内 `registerBox()`。也就是说 —— 手机拿着正确的四栏、中转也活着，真发一条
 * `CONNECT` 仍然只会拿到 `NOBOX`，因为**没有任何进程把「这台盒子在线」这件事告诉过中转**。
 *
 * 线协议（与 `relay_server.js` 的控制面逐字对齐）：
 *
 *     AUTH <box_token>            → OK | DENY
 *     REGISTER <boxId> <host:port>→ REGISTERED | BADREG | BADCMD
 *
 * 三个设计点，每个都有代价：
 *  1. **一次 REGISTER 一条短连接**：relay 收下 `REGISTER` 后立刻 `sock.end()`（它只要这条记录），
 *     所以这里不做长连接复用 —— 复用反而会出现「以为还登记着、其实 relay 已换进程」的假象。
 *  2. **必须周期重登记**：registry 是 relay 的**内存表**，relay 重启/换机器就空了。心跳间隔默认
 *     30s（可配），失败也按同样节奏重试 —— 不搞指数退避：这类失败通常是「relay 还没起来」，
 *     退避只会让恢复更慢，而一条 AUTH+REGISTER 的成本只有两个短包。
 *  3. **失败不抛**：这是后台常驻任务，抛出去没人接；但 `getState()` 必须说真话
 *     （`not-configured` / `denied` / `badreg` / `transport` 各自区分）—— 把「凭证不对」说成
 *     「网络不好」，用户就只能瞎试。
 *
 * 这个模块只依赖 `net`，可被门禁直接拿真 relay 跑（`scripts/prove_relay_box_registration.js`）。
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

/** 逐字节读到一行 —— 带缓冲的 Reader 会把后续字节吞进缓冲区，那正是「握手成功但消息不通」的老坑。 */
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

function createRelayBoxClient(opts) {
  const o = opts || {};
  const host = String(o.host || "").trim();
  const port = Number(o.port);
  const boxId = String(o.boxId || o.box_id || "").trim();
  const boxToken = String(o.boxToken || o.box_token || "").trim();
  const endpoint = String(o.endpoint || "").trim();
  const connectTimeoutMs = Number(o.connectTimeoutMs || 8000);
  const replyTimeoutMs = Number(o.replyTimeoutMs || 8000);
  // 0 / 负数 = 不心跳（只登记一次）。门禁需要这个开关来证明「回来的是心跳，不是别的」。
  const heartbeatMs = Number(o.heartbeatMs === undefined ? 30000 : o.heartbeatMs);
  const log = typeof o.log === "function" ? o.log : null;

  const state = {
    ok: false,
    boxId,
    endpoint,
    heartbeatMs,
    attempts: 0,
    registeredAt: 0,
    lastError: REASON_NOT_CONFIGURED,
    lastErrorAt: 0,
  };
  let timer = null;
  let stopped = true;

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

  /** 开始常驻登记：先立刻试一次（别让用户等一个心跳周期），之后按 heartbeatMs 重复。 */
  function start() {
    if (!stopped) return state;
    stopped = false;
    tick();
    return state;
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
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
