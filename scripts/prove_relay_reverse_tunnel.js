#!/usr/bin/env node
"use strict";
/* prove_relay_reverse_tunnel.js — A3-8 门禁（RV-01..RV-13）
 *
 * 要证的一件事：**公网 relay + NAT 后面的桌面，也能把这条隧道打通**（关 R-A3-6g）。
 *
 * 为什么必须做：A3-1 锁定的转发模型是「relay 主动拨 box 登记的 host:port」
 * （relay_server.js 的 openBox() → net.connect，旧文档按当时行号写的 :89，A3-8 后已下移）。
 * 公网 relay 拨不进 192.168.x / 运营商 NAT 后面的机器 ——
 * 这不是配置错，是拓扑不成立。A3-7 把「桌面自己读配置、自己登记、自己心跳」补齐了，
 * 但在这种最常见的部署下，手机仍然只会拿到 NOBOX 或者一个永远拨不通的隧道。
 *
 * 这一刀的转发模型（**手机端协议零改动**）：
 *
 *   box   →  relay : AUTH <box_token> / BIND <boxId>   → BOUND（这条**长连接**保持不关）
 *   phone →  relay : AUTH <client_token> / CONNECT <boxId>
 *   relay →  box   : ACCEPT <streamId>                  （走上面那条长连接）
 *   box   →  relay : 新开一条出站 TCP，AUTH / ATTACH <streamId>  ← 出站，NAT 友好
 *   box   :          ATTACH 连接 ⇄ 本地 cn_inbound 双向 pipe（最后一跳在盒子里完成）
 *   relay →  phone : TUNNEL <label>                      （ATTACH 到了才回，避免手机卡死）
 *   relay :          phone socket ⇄ ATTACH socket 双向 pipe，仍是盲转发
 *
 * 旧的 REGISTER + 主动拨模式**一字不动地保留**：A3-1..A3-7 的门全部依赖它。
 *
 * 反真空通过的两处正控，写在这里免得后来把门改松：
 *   ① RV-01 先用**旧模式**真打通一次 —— 门本身能跑，不是「新功能不存在所以全红」；
 *   ② RV-05 先证「relay 拨不到不可达端点时确实会断」，再证 reverse 用**同一个不可达端点**照样通，
 *      并且 dialAttempts 在 reverse 全程不变（先在旧模式里确认这个计数器真的会动）。
 *
 * 诚实边界：本机同宿主造不出真 NAT，用「不可达 endpoint = 192.0.2.1:1」等价建模；
 * 真公网 + 真 NAT 仍归 R-A3-8a。本门证的是「relay 零主动拨且数据面端到端通」。
 *
 * 跑法：node scripts/prove_relay_reverse_tunnel.js
 */

const fs = require("fs");
const os = require("os");
const net = require("net");
const http = require("http");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const RELAY = path.join(REPO, "hosts/shared/relay/relay_server.js");
const BOX = path.join(REPO, "hosts/shared/relay/relay_box_client.js");
const KEYS = path.join(REPO, "hosts/shared/relay/relay_keys.js");
const INBOUND = path.join(REPO, "hosts/shared/cn_inbound_server.js");
const PAIRING = path.join(REPO, "hosts/shared/desktop_pairing.js");
const CONFIG = path.join(REPO, "hosts/shared/relay/relay_config.js");
const MAINJS = path.join(REPO, "hosts/desktop/main.js");

let PASS = 0;
let FAIL = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : ""));
};
const skipBlock = (m) => {
  FAIL++;
  console.log("  ✗ " + m);
};

/* ---------------------------------------------------------------- 小工具 */

/**
 * 一条 socket 一个**常驻**行读取器。
 *
 * 为什么不能「读一行挂一次 data 监听」：AUTH+CONNECT 是同一次 write，
 * relay 回的 `OK\nTUNNEL ...\n` 常常落在同一个 TCP chunk 里。若第一次读把
 * 剩下的字节留在局部 buf 后就 removeListener，那些字节永远进不了第二次读，
 * 第二次只能干等到超时 —— 门禁自己先挂，产品是好是坏都看不出来。
 * 这里改成：唯一的 data 监听常驻，buf 是这条连接共享的状态，
 * readLine / readHttpHeaders 都从同一个 buf 顺序消费。
 */
function createTunnelReader(socket) {
  let buf = "";
  let waiters = [];
  let done = false;

  function failAll(err) {
    const ws = waiters;
    waiters = [];
    for (const w of ws) {
      clearTimeout(w.timer);
      // 数据面对端直接断开是**合法的负向结果**（RV-05a 拨不通就是这么表现的），
      // 不该把它升级成门禁自身异常。控制面读行则必须响亮地失败。
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

  const onData = (d) => {
    buf += d.toString("latin1");
    pump();
  };
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
    detach() {
      done = true;
      socket.removeListener("data", onData);
      socket.removeListener("error", onErr);
      socket.removeListener("close", onClose);
      failAll(new Error("reader detached"));
    },
    close() {
      this.detach();
      try {
        socket.destroy();
      } catch (_) {}
    },
  };
}

/** 手机侧：连 relay、AUTH、CONNECT；返回 {ok, reply, socket, reader}。不认得的应答也原样带回。 */
async function phoneConnect(port, clientToken, boxId, timeoutMs) {
  const s = net.connect(port, "127.0.0.1");
  const reader = createTunnelReader(s);
  try {
    await new Promise((res, rej) => {
      s.once("connect", res);
      s.once("error", rej);
    });
    reader.write("AUTH " + clientToken + "\nCONNECT " + boxId + "\n");
    const auth = await reader.readLine(timeoutMs || 8000);
    if (auth.line !== "OK") {
      reader.close();
      return { ok: false, error: "auth=" + auth.line, socket: null, reader: null };
    }
    const reply = await reader.readLine(timeoutMs || 8000);
    return { ok: true, auth, reply, socket: s, reader };
  } catch (e) {
    // 握手失败是**被测行为**（NOBOX / 半截应答 / 直接断开），不是门禁崩掉的理由。
    reader.close();
    return { ok: false, error: (e && e.message) || String(e), socket: null, reader: null };
  }
}

/** 在一条已进入数据面的连接上跑一次真 HTTP，返回状态行（不解析 body）。 */
function httpOverTunnel(reader, pathname) {
  reader.write("GET " + pathname + " HTTP/1.1\r\nHost: box\r\nConnection: close\r\n\r\n");
  return reader.readHttpHeaders(8000);
}

function diag(relay) {
  try {
    return relay.getDiagnosticState() || {};
  } catch (_) {
    return {};
  }
}

async function main() {
  /* 模块缺失就干净记红（与 RB-00 同口径：不许悄悄跳过）。 */
  let relayMod = null;
  let boxMod = null;
  let keysMod = null;
  let inboundMod = null;
  let pairingMod = null;
  try { relayMod = require(RELAY); } catch (e) { skipBlock("RV-00 relay_server 加载失败：" + e.message); }
  try { boxMod = require(BOX); } catch (e) { skipBlock("RV-00 relay_box_client 加载失败：" + e.message); }
  try { keysMod = require(KEYS); } catch (e) { skipBlock("RV-00 relay_keys 加载失败：" + e.message); }
  try { inboundMod = require(INBOUND); } catch (e) { skipBlock("RV-00 cn_inbound_server 加载失败：" + e.message); }
  try { pairingMod = require(PAIRING); } catch (e) { skipBlock("RV-00 desktop_pairing 加载失败：" + e.message); }
  if (!relayMod || !boxMod || !keysMod || !inboundMod || !pairingMod) {
    console.log("prove_relay_reverse_tunnel: PASS=" + PASS + " FAIL=" + FAIL);
    process.exit(1);
  }

  const SECRET = "reverse-secret-for-gate";
  const BOX_ID = "box-reverse-home";
  const UNREACHABLE = "192.0.2.1:1"; // TEST-NET-1，故意拨不到 —— NAT 的等价模型
  const boxToken = keysMod.issueRelayCredential(SECRET, "desktop-rev", "box");
  const clientToken = keysMod.issueRelayCredential(SECRET, "phone-rev", "client");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-reverse-"));
  const pairingMgr = pairingMod.createPairingCodeManager();
  const inbound = inboundMod.createCnInboundServer({
    repoRoot: tmp,
    port: 0,
    host: "0.0.0.0",
    pairingManager: pairingMgr,
    turnToken: "t-reverse-0123456789",
    onTurn: async () => ({ ok: true, messages: [], host_results: [], stdout: "" }),
  });
  const inboundInfo = await inbound.start();
  const localEndpoint = "127.0.0.1:" + inboundInfo.port;

  const relay = relayMod.createRelayServer({ relaySecret: SECRET, bindHost: "127.0.0.1" });
  const relayInfo = await relay.start();
  const sockets = [];
  const track = (s) => { sockets.push(s); return s; };

  /* RV-01 反真空正控：**旧 dial 模式**在这一门里真打通一次。
   * 没有这条，后面「reverse 全红」和「门根本跑不起来」是分不开的。 */
  {
    relay.registerBox("box-legacy", localEndpoint);
    const p = await phoneConnect(relayInfo.controlPort, clientToken, "box-legacy");
    let status = "";
    if (!p.ok) {
      bad("RV-01 正控失败：旧模式连 AUTH 都没过（门自身跑不起来）", p.error);
    } else {
      track(p.socket);
      try {
        status = await httpOverTunnel(p.reader, "/v1/pair/discover");
      } catch (e) {
        status = "(error) " + e.message;
      }
      if (!/^HTTP\/1\.1 200/.test(status)) {
        bad("RV-01 正控失败：旧 REGISTER/dial 模式没打通（后面的红说明不了 reverse）", status);
      } else {
        ok("RV-01 正控：旧 REGISTER + 主动拨模式仍端到端打通（" + localEndpoint + " → 200 OK）");
      }
      p.socket.destroy();
    }
  }

  /* RV-05a 负向对照：relay 拨不到不可达端点时，这条隧道确实断 —— 这是 NAT 的等价模型。 */
  {
    relay.registerBox("box-unreachable", UNREACHABLE);
    const p = await phoneConnect(relayInfo.controlPort, clientToken, "box-unreachable");
    let status = "";
    if (!p.ok) {
      bad("RV-05a 前置失败：连 AUTH/CONNECT 都没走完", p.error);
    } else {
      track(p.socket);
      try {
        status = await httpOverTunnel(p.reader, "/v1/pair/discover");
      } catch (e) {
        status = "(error) " + e.message;
      }
      if (/^HTTP\/1\.1 200/.test(status)) {
        bad("RV-05a 负向对照失效：拨不到 192.0.2.1:1 竟然还返回 200（后面 reverse 的结论不成立）", status);
      } else {
        ok("RV-05a 负向对照：relay 主动拨 " + UNREACHABLE + " → 隧道断（" + status.slice(0, 60) + "）");
      }
      p.socket.destroy();
    }
  }

  const dialsBefore = diag(relay).dialAttempts;
  const hasDialCounter = typeof dialsBefore === "number";
  if (!hasDialCounter) {
    bad("RV-05c 反真空前置：getDiagnosticState 没有 dialAttempts 计数器（「恒为 0」会是真空绿）");
  } else if (!(dialsBefore > 0)) {
    bad("RV-05c 反真空前置：跑完 RV-01/RV-05a 后 dialAttempts 还是 0（计数器不会动，不能拿来证「零主动拨」）", dialsBefore);
  } else {
    ok("RV-05c 反真空前置：旧模式跑过之后 dialAttempts=" + dialsBefore + "（计数器确实会动）");
  }

  /* RV-02 reverse 能力在场：box 客户端认得 mode，relay 的反向下发能力也在。 */
  let box = null;
  {
    let state = null;
    try {
      box = boxMod.createRelayBoxClient({
        host: "127.0.0.1",
        port: relayInfo.controlPort,
        boxId: BOX_ID,
        boxToken,
        endpoint: UNREACHABLE, // 故意：reverse 不该依赖这个地址可达
        localEndpoint,
        mode: "reverse",
        heartbeatMs: 0, // 这条门先测通路；重连另说
      });
      box.start();
      state = box.getState();
    } catch (e) {
      bad("RV-02 createRelayBoxClient({mode:'reverse'}) 起不来", e && e.message);
    }
    if (state) {
      if (state.mode !== "reverse") {
        bad("RV-02 box 客户端没有进入 reverse 模式（" + JSON.stringify(state).slice(0, 160) + "）");
      } else if (typeof relay.getDiagnosticState !== "function" || typeof diag(relay).reverseBoxes !== "number") {
        bad("RV-02 relay 没暴露 reverseBoxes 诊断（无法证「盒子挂在长连接上」）", JSON.stringify(diag(relay)));
      } else {
        ok("RV-02 reverse 能力在场：box 客户端 mode=reverse、relay 有 reverseBoxes 诊断");
      }
    }
  }

  /* 给 BIND 长连接一点时间握手（真 socket，不靠 sleep 猜状态：轮询到 registry 出现为止）。 */
  let bound = false;
  for (let i = 0; i < 60 && !bound; i++) {
    if (relay.getRegistry()[BOX_ID]) bound = true;
    else await new Promise((r) => setTimeout(r, 50));
  }

  /* RV-03 BIND 握手：registry 里这台盒子是 reverse 条目，且 getRegistry 形状仍「只有端点/无内容」。 */
  {
    const reg = relay.getRegistry()[BOX_ID];
    if (!bound || !reg) {
      bad("RV-03 box 的 BIND 没登记上（真跨 NAT 会一直 NOBOX）", JSON.stringify(relay.getRegistry()));
    } else if (reg.kind !== "reverse") {
      bad("RV-03 registry 里这台盒子不是 reverse 条目", JSON.stringify(reg));
    } else if (JSON.stringify(relay.getRegistry()).includes(boxToken)) {
      bad("RV-03 registry 里出现了凭证原文（A3-2 口径：只许有端点元数据）");
    } else {
      ok("RV-03 AUTH + BIND 走通：registry[" + BOX_ID + "] 是 reverse 条目，且查无凭证");
    }
  }

  /* RV-04 端到端命门：手机 CONNECT → 真 HTTP 穿过反向隧道打到 cn_inbound。 */
  let tunnelLine = "";
  {
    const p = await phoneConnect(relayInfo.controlPort, clientToken, BOX_ID, 8000);
    let status = "";
    if (!p.ok) {
      bad("RV-04 手机侧连不上（" + p.error + "）");
    } else {
      track(p.socket);
      tunnelLine = p.reply.line;
      if (!tunnelLine.startsWith("TUNNEL ")) {
        bad("RV-04 CONNECT 没拿到 TUNNEL（手机端会当成 BADCMD）", tunnelLine);
      } else {
        try {
          status = await httpOverTunnel(p.reader, "/v1/pair/discover");
        } catch (e) {
          status = "(error) " + e.message;
        }
        if (!/^HTTP\/1\.1 200/.test(status)) {
          bad("RV-04 反向隧道没把请求送到 cn_inbound", status);
        } else {
          ok("RV-04 端到端：phone → relay → ACCEPT → box ATTACH → cn_inbound，GET /v1/pair/discover → " + status);
        }
      }
      p.socket.destroy();
    }
  }

  /* RV-05b/c 零主动拨：用**同一个不可达 endpoint** 却通了，且 dialAttempts 没涨。 */
  {
    const dialsAfter = diag(relay).dialAttempts;
    if (!hasDialCounter) {
      bad("RV-05b 缺 dialAttempts，无法证「relay 零主动拨」");
    } else if (dialsAfter !== dialsBefore) {
      bad("RV-05b reverse 期间 relay 仍然发起了主动拨", dialsBefore + " → " + dialsAfter);
    } else if (!/^TUNNEL /.test(tunnelLine)) {
      bad("RV-05b 前置不成立：RV-04 没拿到 TUNNEL，谈不上「不拨也通」", tunnelLine);
    } else {
      ok("RV-05b 同一个不可达端点 " + UNREACHABLE + "：dial 断、reverse 通，dialAttempts 全程 " + dialsBefore + " 不变");
    }
  }

  /* RV-06 盒子掉线 → registry 立刻清掉 → 再来一条 CONNECT 回 NOBOX（不是卡死）。 */
  {
    let boxStopped = false;
    try { box && box.stop(); boxStopped = true; } catch (e) { bad("RV-06 box.stop() 抛异常", e && e.message); }
    let gone = false;
    for (let i = 0; i < 60 && !gone; i++) {
      if (!relay.getRegistry()[BOX_ID]) gone = true;
      else await new Promise((r) => setTimeout(r, 50));
    }
    let reply = "";
    try {
      const p = await phoneConnect(relayInfo.controlPort, clientToken, BOX_ID, 4000);
      reply = p.ok ? p.reply.line : "(error) " + p.error;
      if (p.ok) { track(p.socket); p.socket.destroy(); }
    } catch (e) { reply = "(error) " + e.message; }
    if (!boxStopped) {
      /* 已在上面记红 */
    } else if (!gone) {
      bad("RV-06 控制通道断了，registry 里还留着这台盒子（手机会拿到一个拨不通的隧道）", JSON.stringify(relay.getRegistry()));
    } else if (reply !== "NOBOX") {
      bad("RV-06 盒子下线后 CONNECT 没回 NOBOX（手机端已有对应人话）", reply);
    } else {
      ok("RV-06 控制通道断开 → registry 立刻清空 → CONNECT 明确回 NOBOX");
    }
  }

  /* RV-07 ACCEPT 无人接：只 BIND 不 ATTACH 的假盒子，client 必须在 3s 内拿到 NOBOX，不许卡死。 */
  {
    const idleBoxId = "box-idle";
    const ctrl = track(net.connect(relayInfo.controlPort, "127.0.0.1"));
    const ctrlReader = createTunnelReader(ctrl);
    let boundReply2 = null;
    try {
      await new Promise((res, rej) => { ctrl.once("connect", res); ctrl.once("error", rej); });
      ctrlReader.write("AUTH " + boxToken + "\nBIND " + idleBoxId + "\n");
      const boundReply = await ctrlReader.readLine(4000);
      boundReply2 = boundReply.line === "OK" ? await ctrlReader.readLine(4000) : boundReply;
    } catch (e) {
      boundReply2 = { line: "(error) " + ((e && e.message) || e) };
    }
    let reply = "";
    const t0 = Date.now();
    try {
      const p = await phoneConnect(relayInfo.controlPort, clientToken, idleBoxId, 3500);
      reply = p.ok ? p.reply.line : "(error) " + p.error;
      if (p.ok) { track(p.socket); p.socket.destroy(); }
    } catch (e) { reply = "(error) " + e.message; }
    const ms = Date.now() - t0;
    if (boundReply2.line !== "BOUND " + idleBoxId) {
      bad("RV-07 前置失败：假盒子 BIND 没拿到 BOUND", boundReply2.line);
    } else if (reply !== "NOBOX") {
      bad("RV-07 没人接 ACCEPT 时，client 没拿到明确 NOBOX", reply);
    } else if (ms > 3000) {
      bad("RV-07 没人接 ACCEPT 时 client 等了 " + ms + "ms 才失败（界面会一直停在连接中）");
    } else {
      ok("RV-07 ACCEPT 无人接 → " + ms + "ms 内明确回 NOBOX（不卡死）");
    }
    ctrl.destroy();
  }

  /* RV-08 并发：两条 CONNECT 各自 streamId，不串线。 */
  {
    try {
      box = boxMod.createRelayBoxClient({
        host: "127.0.0.1", port: relayInfo.controlPort, boxId: BOX_ID, boxToken,
        endpoint: UNREACHABLE, localEndpoint, mode: "reverse", heartbeatMs: 0,
      });
      box.start();
      for (let i = 0; i < 60 && !relay.getRegistry()[BOX_ID]; i++) await new Promise((r) => setTimeout(r, 50));
      const before = diag(relay).activeStreams;
      const pair = await Promise.all([
        phoneConnect(relayInfo.controlPort, clientToken, BOX_ID, 8000),
        phoneConnect(relayInfo.controlPort, clientToken, BOX_ID, 8000),
      ]);
      const statuses = [];
      for (const p of pair) {
        track(p.socket);
        if (!p.ok || !p.reply.line.startsWith("TUNNEL ")) { statuses.push("(no tunnel)"); continue; }
        try { statuses.push(await httpOverTunnel(p.reader, "/v1/pair/discover")); }
        catch (e) { statuses.push("(error) " + e.message); }
        p.socket.destroy();
      }
      const state = box.getState();
      if (statuses.some((s) => !/^HTTP\/1\.1 200/.test(s))) {
        bad("RV-08 并发两条隧道没有都打通", JSON.stringify(statuses));
      } else if (!(state.streamsServed >= 2)) {
        bad("RV-08 box 侧没有分别服务两条 stream（可能串到同一条了）", JSON.stringify(state));
      } else if (typeof before !== "number") {
        bad("RV-08 relay 没暴露 activeStreams 诊断", JSON.stringify(diag(relay)));
      } else {
        ok("RV-08 并发两条 CONNECT 各自 200 OK，box streamsServed=" + state.streamsServed + "（streamId 不串）");
      }
    } catch (e) {
      bad("RV-08 并发用例自身异常", (e && e.stack || e).toString().slice(0, 240));
    }
  }

  /* RV-09 审计：有 accept/attach 事件 + 查无凭证/明文（反真空：日志必须非空）。 */
  {
    const audit = relay.getAuditLog().map((r) => JSON.stringify(r)).join("\n");
    const hasAccept = audit.includes('"event":"accept"');
    const hasAttach = audit.includes('"event":"attach"');
    const canary = "GET /v1/pair/discover";
    if (!audit.length) {
      bad("RV-09 审计日志为空（「查无明文」在空日志上是真空通过）");
    } else if (!hasAccept || !hasAttach) {
      bad("RV-09 审计里缺 accept/attach 事件（反向隧道的元数据没留痕）", audit.slice(-240));
    } else if (audit.includes(boxToken) || audit.includes(clientToken) || audit.includes(canary)) {
      bad("RV-09 审计里出现了凭证或 HTTP 明文（A3-2「内容不可见」被破坏）");
    } else {
      ok("RV-09 审计有 accept/attach 元数据且查无凭证与请求明文");
    }
  }

  /* RV-10 向后兼容：线协议 REGISTER 仍然能打通（不只进程内 registerBox）。 */
  {
    const legacy = boxMod.createRelayBoxClient({
      host: "127.0.0.1", port: relayInfo.controlPort, boxId: "box-wire-register",
      boxToken, endpoint: localEndpoint, heartbeatMs: 0,
    });
    let r = null;
    try { r = await legacy.registerOnce(); } catch (e) { r = { ok: false, reason: e.message }; }
    let status = "";
    if (r && r.ok) {
      const p = await phoneConnect(relayInfo.controlPort, clientToken, "box-wire-register", 8000);
      if (p.ok) {
        track(p.socket);
        try { status = await httpOverTunnel(p.reader, "/v1/pair/discover"); }
        catch (e) { status = "(error) " + e.message; }
        p.socket.destroy();
      } else status = "(no auth) " + p.error;
    } else status = "(register failed) " + JSON.stringify(r);
    legacy.stop();
    if (!/^HTTP\/1\.1 200/.test(status)) {
      bad("RV-10 旧 REGISTER 线协议被改坏了（A3-1..A3-7 会连坐）", status);
    } else {
      ok("RV-10 旧 REGISTER + 主动拨路径一字未动，仍 200 OK");
    }
  }

  /* RV-11 端上协议零改动：回给手机的仍是一行 `TUNNEL <非空 label>`，且不含凭证/换行。 */
  {
    const label = tunnelLine.startsWith("TUNNEL ") ? tunnelLine.slice(7) : "";
    if (!label || /\s/.test(label)) {
      bad("RV-11 TUNNEL 行不满足手机端 parseConnectReply 的 `TUNNEL <非空 token>`", tunnelLine);
    } else if (label.includes(boxToken) || label.includes(clientToken)) {
      bad("RV-11 TUNNEL label 里夹带了凭证");
    } else {
      ok("RV-11 回给手机的仍是 `TUNNEL " + label + "`（RelayTunnel.kt 零改动）");
    }
  }

  /* RV-12 配置面接线（A3-7 的教训）：模块能跑 ≠ 产品会用。
   * 运行时一半：真写一个 relay.json，走产品实际读的 loadRelayConfig，
   *   证 mode=reverse / localEndpoint 读得出来，且**手机那四栏一字不变**。
   * 静态一半：main.js 必须真把这两栏递给盒子客户端、改了 mode 要重建、警告按 mode 分流。
   * 少了任何一边都不闭合：光跑配置模块不知道桌面有没有接线，光看锚点会被注释骗过。
   */
  {
    let configMod = null;
    try { configMod = require(CONFIG); } catch (e) { bad("RV-12 relay_config 加载失败", e && e.message); }
    if (configMod) {
      const cfgFile = path.join(tmp, "relay.json");
      const fullCfg = {
        host: "127.0.0.1", port: relayInfo.controlPort, box_id: BOX_ID,
        box_token: boxToken, client_token: clientToken,
        mode: "reverse", local_endpoint: localEndpoint,
      };
      fs.writeFileSync(cfgFile, JSON.stringify(fullCfg));
      const cfg = configMod.loadRelayConfig({ file: cfgFile, env: {} });
      const h = configMod.toHandoff(cfg);
      const keys = Object.keys(h || {}).sort().join(",");
      const mainJs = fs.readFileSync(MAINJS, "utf8");
      const anchors = [
        [mainJs, "mode: cfg.mode,", "main.js 没把 mode 传给盒子客户端"],
        [mainJs, "localEndpoint,", "main.js 没把 localEndpoint 传给盒子客户端"],
        [mainJs, "[cfg.host, cfg.port, cfg.boxId, endpoint, mode, localEndpoint]", "改了 mode/localEndpoint 不会重建客户端"],
        [mainJs, 'if (mode === "dial" && loopbackHost', "拨不通的警告没按 mode 分流（reverse 会误导用户改错字段）"],
      ];
      const missing = anchors.filter(([src, needle]) => !src.includes(needle)).map(([, , why]) => why);
      if (!cfg) {
        bad("RV-12 写了 mode:reverse 的 relay.json 却读不出来", fs.readFileSync(cfgFile, "utf8"));
      } else if (cfg.mode !== "reverse" || cfg.localEndpoint !== localEndpoint) {
        bad("RV-12 配置里的 reverse/local_endpoint 没读到", JSON.stringify(cfg));
      } else if (keys !== "box_id,client_token,host,port") {
        bad("RV-12 toHandoff 被撑大了（拓扑字段不该下发给手机）", keys);
      } else if (JSON.stringify(h).includes(boxToken)) {
        bad("RV-12 四栏里夹带了 box_token");
      } else if (missing.length) {
        bad("RV-12 桌面接线缺了 " + missing.length + " 处：" + missing.join("；"));
      } else {
        ok("RV-12 配置面接通：relay.json 写 reverse → 读得出、四栏不变、main.js 四处接线都在");
      }
    }
  }

  /* RV-13 老配置不破：不写 mode 必须仍回落 dial（A3-7 的部署形态不能被动升级）。 */
  {
    const configMod = require(CONFIG);
    const cfgFile = path.join(tmp, "relay-legacy.json");
    fs.writeFileSync(cfgFile, JSON.stringify({
      host: "127.0.0.1", port: relayInfo.controlPort, box_id: BOX_ID,
      box_token: boxToken, client_token: clientToken,
    }));
    const cfg = configMod.loadRelayConfig({ file: cfgFile, env: {} });
    const h = configMod.toHandoff(cfg);
    if (!cfg || cfg.mode !== "dial" || cfg.localEndpoint !== "") {
      bad("RV-13 不写 mode 时没回落 dial（旧部署被静默切成另一种转发模型）", JSON.stringify(cfg));
    } else if (Object.keys(h || {}).sort().join(",") !== "box_id,client_token,host,port") {
      bad("RV-13 老配置的四栏形状被改了", JSON.stringify(h));
    } else {
      ok("RV-13 老配置不写 mode → 仍是 dial + 四栏不变（A3-7 形态不被静默升级）");
    }
  }

  /* 收尾：所有 socket 都关掉，绝不把 Node 进程挂住。 */
  try { box && box.stop(); } catch (_) {}
  for (const s of sockets) { try { s.destroy(); } catch (_) {} }
  await relay.stop();
  await inbound.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("prove_relay_reverse_tunnel: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_relay_reverse_tunnel: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
