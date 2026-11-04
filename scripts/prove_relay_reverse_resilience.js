#!/usr/bin/env node
"use strict";
/* prove_relay_reverse_resilience.js — A3-9 门禁（RR-01..RR-09）
 *
 * 要证的一件事：**反向隧道在真实网络里活得下去**（关 R-A3-8a 里本机能做的两条）。
 *
 * A3-8 交付的 reverse 有两个只在真实网络才咬人的洞，都写进了 §8.73.6 / R-A3-8a：
 *
 *  ① **半开连接**：NAT 映射过期后 TCP 两端都以为还连着，relay 的 registry 里留着
 *     一台叫不醒的盒子 —— ACCEPT 发不出去，手机只能等 2.5s 拿 NOBOX，而且每次都这样。
 *     闭法：BIND 长连接加应用层 PING/PONG，连续 N 次不回就清 registry 并断链。
 *     下面用「只 BIND、绝不回 PONG 的假盒子」等价建模；同时用真盒子做**反真空正控**
 *     —— 不能是「谁都踢」。
 *
 *  ② **等 ATTACH 的窗口里 relay 会暂存业务字节**：`c.pending` 分支把手机提前发来的
 *     字节攒进用户态 buf，没有上限，大附件能撑爆内存。闭法：`clientSock.pause()`
 *     让 TCP 接收缓冲替 relay 持有，relay 用户态零持有，ATTACH 到了由 pipe 自然 resume。
 *     门里先轮询 `activeStreams === 1` 确认真的进入 pending（不靠 sleep 猜状态），
 *     再灌 32KB canary，然后查 `pendingBufferBytes === 0`。
 *
 * 另外顺带把「relay 重启 → 盒子自动重连回来 → 手机再 200 OK」做**断网注入实测**：
 * A3-8 写了 `reconnectMs` 但从没证明过它真的会把 registry 带回来。
 *
 * 反真空通过的三处正控：RR-01（reverse 本来就是通的）、RR-02b（真盒子不被误踢）、
 * RR-05c（canary 确实写进去了，否则「查无明文」是空断言）。
 *
 * 跑法：node scripts/prove_relay_reverse_resilience.js
 */

const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const RELAY = path.join(REPO, "hosts/shared/relay/relay_server.js");
const BOX = path.join(REPO, "hosts/shared/relay/relay_box_client.js");
const KEYS = path.join(REPO, "hosts/shared/relay/relay_keys.js");
const CONFIG = path.join(REPO, "hosts/shared/relay/relay_config.js");
const INBOUND = path.join(REPO, "hosts/shared/cn_inbound_server.js");
const PAIRING = path.join(REPO, "hosts/shared/desktop_pairing.js");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

/* ---------------------------------------------------------------- 小工具 */

/** 一条 socket 一个**常驻**行读取器（A3-8 的教训：合并 chunk 会吞掉第二行）。 */
function createTunnelReader(socket) {
  let buf = "";
  let waiters = [];
  let done = false;
  function failAll(err) {
    const ws = waiters;
    waiters = [];
    for (const w of ws) {
      clearTimeout(w.timer);
      if (w.kind === "headers") w.resolve("(closed before headers)");
      else w.reject(err);
    }
  }
  function pump() {
    while (waiters.length) {
      const w = waiters[0];
      const hit = w.kind === "line" ? buf.indexOf("\n") : buf.indexOf("\r\n\r\n");
      if (hit < 0) return;
      waiters.shift();
      clearTimeout(w.timer);
      if (w.kind === "line") {
        const line = buf.slice(0, hit).trim();
        buf = buf.slice(hit + 1);
        w.resolve({ line, rest: buf });
      } else {
        const status = buf.slice(0, buf.indexOf("\r\n"));
        buf = buf.slice(hit + 4);
        w.resolve(status);
      }
    }
  }
  const onData = (d) => { buf += d.toString("latin1"); pump(); };
  const onErr = (e) => failAll(e);
  const onClose = () => failAll(new Error("socket closed before reply"));
  socket.on("data", onData);
  socket.on("error", onErr);
  socket.on("close", onClose);
  function wait(kind, timeoutMs) {
    if (done) return Promise.reject(new Error("reader closed"));
    return new Promise((resolve, reject) => {
      const w = { kind, resolve, reject, timer: null };
      w.timer = setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error(kind === "line" ? "read line timeout" : "http over tunnel timeout"));
      }, timeoutMs || 8000);
      waiters.push(w);
      pump();
    });
  }
  return {
    socket,
    readLine: (ms) => wait("line", ms),
    readHttpHeaders: (ms) => wait("headers", ms),
    write: (s) => socket.write(s),
    close() {
      done = true;
      socket.removeListener("data", onData);
      socket.removeListener("error", onErr);
      socket.removeListener("close", onClose);
      failAll(new Error("reader closed"));
      try { socket.destroy(); } catch (_) {}
    },
  };
}

async function phoneConnect(port, clientToken, boxId, timeoutMs) {
  const s = net.connect(port, "127.0.0.1");
  const reader = createTunnelReader(s);
  try {
    await new Promise((res, rej) => { s.once("connect", res); s.once("error", rej); });
    reader.write("AUTH " + clientToken + "\nCONNECT " + boxId + "\n");
    const auth = await reader.readLine(timeoutMs || 8000);
    if (auth.line !== "OK") {
      reader.close();
      return { ok: false, error: "auth=" + auth.line, socket: null, reader: null };
    }
    const reply = await reader.readLine(timeoutMs || 8000);
    return { ok: true, auth, reply, socket: s, reader };
  } catch (e) {
    reader.close();
    return { ok: false, error: (e && e.message) || String(e), socket: null, reader: null };
  }
}

/** 只写 AUTH+CONNECT、不读应答：用于往 pending 窗口里灌字节。 */
async function phoneRawConnect(port, clientToken, boxId) {
  const s = net.connect(port, "127.0.0.1");
  const reader = createTunnelReader(s);
  await new Promise((res, rej) => { s.once("connect", res); s.once("error", rej); });
  reader.write("AUTH " + clientToken + "\nCONNECT " + boxId + "\n");
  // 必须先把 AUTH 的 `OK` 行消费掉：否则后面读到的第一行是 OK，
  // 会把「超时后明确 NOBOX」误判成红（这是门的错，不是产品的错）。
  try {
    const auth = await reader.readLine(2000);
    if (auth.line !== "OK") throw new Error("auth=" + auth.line);
  } catch (e) {
    throw new Error("raw connect auth failed: " + ((e && e.message) || e));
  }
  return reader;
}

function httpOverTunnel(reader, pathname) {
  reader.write("GET " + pathname + " HTTP/1.1\r\nHost: box\r\nConnection: close\r\n\r\n");
  return reader.readHttpHeaders(8000);
}

function diag(relay) {
  try { return relay.getDiagnosticState() || {}; } catch (_) { return {}; }
}

async function waitFor(predicate, tries, stepMs) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return Boolean(predicate());
}

async function main() {
  let relayMod = null, boxMod = null, keysMod = null, inboundMod = null, pairingMod = null, configMod = null;
  for (const [name, p] of [["relay_server", RELAY], ["relay_box_client", BOX], ["relay_keys", KEYS],
                           ["cn_inbound_server", INBOUND], ["desktop_pairing", PAIRING], ["relay_config", CONFIG]]) {
    try {
      const m = require(p);
      if (name === "relay_server") relayMod = m;
      else if (name === "relay_box_client") boxMod = m;
      else if (name === "relay_keys") keysMod = m;
      else if (name === "cn_inbound_server") inboundMod = m;
      else if (name === "desktop_pairing") pairingMod = m;
      else configMod = m;
    } catch (e) { bad("RR-00 " + name + " 加载失败", e && e.message); }
  }
  if (!relayMod || !boxMod || !keysMod || !inboundMod || !pairingMod || !configMod) {
    console.log("prove_relay_reverse_resilience: PASS=" + PASS + " FAIL=" + FAIL);
    process.exit(1);
  }

  const SECRET = "resilience-secret-for-gate";
  const BOX_ID = "box-reverse-live";
  const UNREACHABLE = "192.0.2.1:1";
  const CANARY = "RESILIENCE-CANARY-" + "X".repeat(32768);
  const boxToken = keysMod.issueRelayCredential(SECRET, "desktop-live", "box");
  const clientToken = keysMod.issueRelayCredential(SECRET, "phone-live", "client");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-resilience-"));
  const pairingMgr = pairingMod.createPairingCodeManager();
  const inbound = inboundMod.createCnInboundServer({
    repoRoot: tmp, port: 0, host: "0.0.0.0", pairingManager: pairingMgr,
    turnToken: "t-resilience-0123456789",
    onTurn: async () => ({ ok: true, messages: [], host_results: [], stdout: "" }),
  });
  const inboundInfo = await inbound.start();
  const localEndpoint = "127.0.0.1:" + inboundInfo.port;
  const sockets = [];
  const track = (s) => { sockets.push(s); return s; };

  // 门里把保活调快：真产品默认 5s / 连续 2 次，这里 150ms / 1 次。
  const relayOpts = () => ({
    relaySecret: SECRET, bindHost: "127.0.0.1",
    pingIntervalMs: 150, pingMissLimit: 1, attachTimeoutMs: 700,
  });
  // 跨 relay 重启累积审计：半开盒子是在第一台 relay 上被踢的，
  // 若只看最后那台的日志，「保活真的动过手」就证不出来。
  const allAudit = [];
  let relay = relayMod.createRelayServer(relayOpts());
  let relayInfo = await relay.start();
  const controlPort = relayInfo.controlPort;

  const newBox = () => boxMod.createRelayBoxClient({
    host: "127.0.0.1", port: controlPort, boxId: BOX_ID, boxToken,
    endpoint: UNREACHABLE, localEndpoint, mode: "reverse",
    heartbeatMs: 0, reconnectMs: 120,
  });
  let box = newBox();
  box.start();
  await waitFor(() => Boolean(relay.getRegistry()[BOX_ID]), 60, 25);

  /* RR-01 反真空正控：reverse 本来就是通的 —— 后面「自愈后还能通」才有意义。 */
  {
    const p = await phoneConnect(controlPort, clientToken, BOX_ID);
    let status = "";
    if (!p.ok) bad("RR-01 正控失败：连握手都没过", p.error);
    else {
      track(p.socket);
      try { status = await httpOverTunnel(p.reader, "/v1/pair/discover"); }
      catch (e) { status = "(error) " + e.message; }
      if (!/^HTTP\/1\.1 200/.test(status)) bad("RR-01 正控失败：reverse 本来就不通", status);
      else ok("RR-01 正控：BIND 后真 HTTP 端到端 200 OK（" + localEndpoint + "）");
      p.reader.close();
    }
  }

  /* RR-02 半开检测：只 BIND、绝不回 PONG 的假盒子要被清掉；真盒子不能被误踢。 */
  {
    const silentId = "box-halfopen";
    const silent = track(net.connect(controlPort, "127.0.0.1"));
    const sr = createTunnelReader(silent);
    await new Promise((res, rej) => { silent.once("connect", res); silent.once("error", rej); });
    sr.write("AUTH " + boxToken + "\nBIND " + silentId + "\n");
    const bound = await waitFor(() => Boolean(relay.getRegistry()[silentId]), 40, 25);
    const evictionsBefore = diag(relay).livenessEvictions;
    // 等 5 个保活周期：真盒子会一直回 PONG，假盒子不该还在表里。
    await new Promise((r) => setTimeout(r, 900));
    const reg = relay.getRegistry();
    const evictionsAfter = diag(relay).livenessEvictions;
    if (!bound) {
      bad("RR-02 前置失败：假盒子 BIND 没登记上");
    } else if (!reg[BOX_ID]) {
      bad("RR-02b 反真空正控失败：真盒子也被踢了（这是「谁都踢」，不是活体检测）", JSON.stringify(reg));
    } else if (reg[silentId]) {
      bad("RR-02 半开盒子没被清掉（真 NAT 下 registry 会一直留着叫不醒的盒子）", JSON.stringify(Object.keys(reg)));
    } else if (typeof evictionsBefore !== "number" || typeof evictionsAfter !== "number") {
      bad("RR-02 没有 livenessEvictions 诊断（「清掉了」缺少可观测证据）", evictionsBefore + " → " + evictionsAfter);
    } else if (evictionsAfter - evictionsBefore !== 1) {
      // 真盒子被误踢后 120ms 就自动重连回来，光看「窗口结束时还在表里」根本看不出来。
      // 第一版负向对照 M03 就是这么绿着混过去的：必须数「这一窗口只踢了那一台」。
      bad("RR-02c 保活误踢了不止一台（真盒子被踢后自动重连会掩盖这件事）", evictionsBefore + " → " + evictionsAfter);
    } else {
      ok("RR-02 半开检测：只清掉不回 PONG 的那一台（livenessEvictions " + evictionsBefore + " → " + evictionsAfter + "），真盒子没被误踢");
    }
    sr.close();
  }

  /* RR-03 断网注入：relay 重启（端口不变）→ 盒子自动重连 → registry 回来 → 手机再 200 OK。 */
  {
    const attemptsBefore = box.getState().attempts;
    allAudit.push(...relay.getAuditLog());
    await relay.stop();
    relay = relayMod.createRelayServer(Object.assign(relayOpts(), { controlPort }));
    relayInfo = await relay.start();
    const emptyAfterRestart = !relay.getRegistry()[BOX_ID]; // 反真空：新表确实是空的
    const cameBack = await waitFor(() => Boolean(relay.getRegistry()[BOX_ID]), 60, 40);
    const attemptsAfter = box.getState().attempts;
    let status = "";
    if (cameBack) {
      const p = await phoneConnect(controlPort, clientToken, BOX_ID);
      if (p.ok) {
        track(p.socket);
        try { status = await httpOverTunnel(p.reader, "/v1/pair/discover"); }
        catch (e) { status = "(error) " + e.message; }
        p.reader.close();
      } else status = "(no connect) " + p.error;
    }
    if (!emptyAfterRestart) {
      bad("RR-03 反真空前置失败：relay 重启后 registry 竟然不空", JSON.stringify(relay.getRegistry()));
    } else if (!cameBack) {
      bad("RR-03 relay 重启后盒子没自己回来（真环境等于跨网永久断）", JSON.stringify(relay.getRegistry()));
    } else if (!(attemptsAfter > attemptsBefore)) {
      bad("RR-03 registry 回来了，但盒子没有重新发起连接（可能是旧条目残留）", attemptsBefore + " → " + attemptsAfter);
    } else if (!/^HTTP\/1\.1 200/.test(status)) {
      bad("RR-03 名字回来了但数据面不通", status);
    } else {
      ok("RR-03 relay 重启 → 自动重连（attempts " + attemptsBefore + " → " + attemptsAfter + "）→ 手机再 200 OK");
    }
  }

  /* RR-04 stop() 之后不许再偷偷重连（否则中转上永远留一台盒子）。 */
  {
    box.stop();
    allAudit.push(...relay.getAuditLog());
    await relay.stop();
    relay = relayMod.createRelayServer(Object.assign(relayOpts(), { controlPort }));
    relayInfo = await relay.start();
    await new Promise((r) => setTimeout(r, 500)); // > 3 × reconnectMs
    if (relay.getRegistry()[BOX_ID]) {
      bad("RR-04 box.stop() 之后仍然重连了（中转上会留一台没人管的盒子）", JSON.stringify(relay.getRegistry()));
    } else {
      ok("RR-04 box.stop() 之后 500ms 内没有重连，registry 保持为空");
    }
  }

  /* RR-05 pending 窗口零驻留：假盒子只 BIND 不 ATTACH（但回 PONG 保活），灌 32KB canary。 */
  {
    const pendingId = "box-pending";
    const fake = track(net.connect(controlPort, "127.0.0.1"));
    const fr = createTunnelReader(fake);
    await new Promise((res, rej) => { fake.once("connect", res); fake.once("error", rej); });
    // 这条假盒子**回 PONG**（活着），但**绝不 ATTACH** —— 正是「NAT 半开之后的下一秒」。
    fr.socket.on("data", (d) => {
      for (const line of d.toString("latin1").split("\n")) {
        if (line.startsWith("PING ")) fr.write("PONG " + line.slice(5).trim() + "\n");
      }
    });
    fr.write("AUTH " + boxToken + "\nBIND " + pendingId + "\n");
    await waitFor(() => Boolean(relay.getRegistry()[pendingId]), 40, 25);

    const pr = await phoneRawConnect(controlPort, clientToken, pendingId);
    track(pr.socket);
    // 不靠 sleep 猜：轮询到 relay 真的进入 pending，再灌字节。
    const inPending = await waitFor(() => diag(relay).activeStreams === 1, 40, 25);
    const written = pr.write(CANARY);
    await new Promise((r) => setTimeout(r, 120));

    const held = diag(relay).pendingBufferBytes;
    const audit = relay.getAuditLog().map((r) => JSON.stringify(r)).join("\n");
    const captured = relay.getCapturedPayloads();
    const canarySent = CANARY.length > 30000 && written !== false;

    if (!inPending) {
      bad("RR-05 前置失败：relay 没进入 pending（activeStreams 不是 1）", JSON.stringify(diag(relay)));
    } else if (!canarySent) {
      bad("RR-05c 反真空正控失败：canary 没写进去（「查无明文」会是空断言）", CANARY.length + " / " + written);
    } else if (typeof held !== "number") {
      bad("RR-05 没有 pendingBufferBytes 诊断（无法证「用户态零持有」）", JSON.stringify(diag(relay)));
    } else if (diag(relay).pendingSocketsPaused !== 1) {
      // 「0 字节」不等于「零驻留」：也可能是字节被 flowing socket 读走丢了。
      // 第一版负向对照 M04 摘掉 pause() 后门仍全绿，就是栽在这个盲断言上。
      bad("RR-05 pending 的手机 socket 没被 pause（字节会被读走丢弃，不是由 TCP 缓冲持有）", JSON.stringify(diag(relay)));
    } else if (held !== 0) {
      bad("RR-05 relay 在等 ATTACH 时把业务字节攒进了用户态缓冲（大附件会撑爆内存）", held + " bytes");
    } else if (captured && captured.length) {
      bad("RR-05 getCapturedPayloads 不再是空的（A3-2 被破坏）");
    } else if (audit.includes(CANARY.slice(0, 40)) || audit.includes(boxToken) || audit.includes(clientToken)) {
      bad("RR-05 审计里出现了 canary / 凭证（A3-2「内容不可见」被破坏）");
    } else {
      ok("RR-05 pending 窗口零驻留：灌入 " + CANARY.length + " 字节 canary，pendingBufferBytes=0、缓存空、审计查无明文");
    }

    /* RR-06 pause 不许把手机卡死：没人 ATTACH 仍要明确 NOBOX。 */
    let reply = "(no reply)";
    try { const line = await pr.readLine(2500); reply = line.line; }
    catch (e) { reply = "(error) " + e.message; }
    if (reply !== "NOBOX") bad("RR-06 pause 之后没人接 ACCEPT 时手机没拿到明确 NOBOX", reply);
    else ok("RR-06 没人接 ACCEPT → 明确 NOBOX（pause 没把数据面卡死）");
    pr.close();
    fr.close();
  }

  /* RR-07 向后兼容：旧 dial 路径仍然通。 */
  {
    relay.registerBox("box-legacy-dial", localEndpoint);
    const p = await phoneConnect(controlPort, clientToken, "box-legacy-dial");
    let status = "";
    if (p.ok) {
      track(p.socket);
      try { status = await httpOverTunnel(p.reader, "/v1/pair/discover"); }
      catch (e) { status = "(error) " + e.message; }
      p.reader.close();
    } else status = "(no connect) " + p.error;
    if (!/^HTTP\/1\.1 200/.test(status)) bad("RR-07 旧 REGISTER + 主动拨被改坏了", status);
    else ok("RR-07 旧 dial 路径一字未动，仍 200 OK");
  }

  /* RR-08 审计：保活与重连留元数据，且查无凭证 / canary（反真空：日志非空）。 */
  {
    const audit = allAudit.concat(relay.getAuditLog()).map((r) => JSON.stringify(r)).join("\n");
    const hasLiveness = audit.includes('"event":"liveness-timeout"');
    if (!audit.length) {
      bad("RR-08 审计日志为空（「查无明文」在空日志上是真空通过）");
    } else if (!hasLiveness) {
      bad("RR-08 审计里没有保活元数据（半开被清这件事不可观测）", audit.slice(-200));
    } else if (audit.includes(CANARY.slice(0, 40)) || audit.includes(boxToken) || audit.includes(clientToken)) {
      bad("RR-08 审计里出现了 canary / 凭证");
    } else {
      ok("RR-08 审计有保活元数据且查无凭证与 canary（日志非空，反真空成立）");
    }
  }

  /* RR-09 手机四栏不变：这一片加的所有参数都只是桌面/relay 内部，不下发。 */
  {
    const cfgFile = path.join(tmp, "relay.json");
    fs.writeFileSync(cfgFile, JSON.stringify({
      host: "127.0.0.1", port: controlPort, box_id: BOX_ID,
      box_token: boxToken, client_token: clientToken,
      mode: "reverse", local_endpoint: localEndpoint,
    }));
    const cfg = configMod.loadRelayConfig({ file: cfgFile, env: {} });
    const h = configMod.toHandoff(cfg);
    const keys = Object.keys(h || {}).sort().join(",");
    if (keys !== "box_id,client_token,host,port") bad("RR-09 toHandoff 被撑大了", keys);
    else if (JSON.stringify(h).includes(boxToken)) bad("RR-09 四栏里夹带 box_token");
    else ok("RR-09 手机四栏仍是 host/port/box_id/client_token（保活参数不外发、不含 box_token）");
  }

  try { box.stop(); } catch (_) {}
  for (const s of sockets) { try { s.destroy(); } catch (_) {} }
  await relay.stop();
  await inbound.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("prove_relay_reverse_resilience: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_relay_reverse_resilience: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
