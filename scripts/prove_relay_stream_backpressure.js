#!/usr/bin/env node
"use strict";
/* prove_relay_stream_backpressure.js — A3-13 门禁（BP-01..BP-09）
 *
 * 要证的一件事：**等 ATTACH 的 stream 有上界，超限明确回 NOBOX**（关 R-A3-8a 里
 * 本机可做的「stream 并发上限 / 泄漏」那半条，见 report §8.73.6 ④）。
 *
 * A3-9 已经让 pending 窗口的用户态字节为零（pause），但「同时能挂多少条 pending」
 * 一直没上限：一堆没人接的 CONNECT 会各自挂一个 2.5s 定时器 + 一条暂停的 socket，
 * 内存与 fd 都不封顶。这一刀给 relay 加 maxPendingStreams。
 *
 * 反真空三处：BP-01（上限内确实进 pending，不是「什么都拒」）、
 * BP-03（把上限调大后同样 5 条**全部**进 pending）、
 * BP-04（超时释放后新的 CONNECT 还能进，说明是动态上限不是一次性熔断）。
 *
 * 跑法：node scripts/prove_relay_stream_backpressure.js
 */
const net = require("net");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const RELAY = require(path.join(REPO, "hosts/shared/relay/relay_server.js"));
const KEYS = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, tries, stepMs) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await sleep(stepMs);
  }
  return Boolean(fn());
}

/** 手机只写 AUTH+CONNECT，不读应答；返回可持续观察的 socket + 累积文本。 */
async function phoneRaw(port, clientToken, boxId) {
  const s = net.connect(port, "127.0.0.1");
  const rec = { socket: s, text: "" };
  await new Promise((res, rej) => { s.once("connect", res); s.once("error", rej); });
  s.on("data", (d) => { rec.text += d.toString("latin1"); });
  s.on("error", () => {});
  s.on("close", () => {});
  s.write("AUTH " + clientToken + "\nCONNECT " + boxId + "\n");
  return rec;
}

/** 假盒子：BIND 后回 PONG 保活，但**绝不 ATTACH** —— 制造 pending 窗口。 */
async function silentBox(port, boxToken, boxId) {
  const s = net.connect(port, "127.0.0.1");
  const rec = { socket: s, text: "" };
  await new Promise((res, rej) => { s.once("connect", res); s.once("error", rej); });
  let buf = "";
  s.on("data", (d) => {
    buf += d.toString("latin1");
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("PING ")) s.write("PONG " + line.slice(5).trim() + "\n");
    }
  });
  s.on("error", () => {});
  s.write("AUTH " + boxToken + "\nBIND " + boxId + "\n");
  return rec;
}

async function main() {
  const SECRET = "backpressure-secret";
  const BOX_ID = "box-backpressure";
  const boxToken = KEYS.issueRelayCredential(SECRET, "desktop-bp", "box");
  const clientToken = KEYS.issueRelayCredential(SECRET, "phone-bp", "client");
  const sockets = [];
  const track = (s) => { sockets.push(s); return s; };

  const relay = RELAY.createRelayServer({
    relaySecret: SECRET, bindHost: "127.0.0.1",
    maxPendingStreams: 3, attachTimeoutMs: 500,
    pingIntervalMs: 1000, pingMissLimit: 1,
  });
  const info = await relay.start();
  const box = await silentBox(info.controlPort, boxToken, BOX_ID);
  track(box.socket);
  const bound = await waitFor(() => Boolean(relay.getRegistry()[BOX_ID]), 40, 25);

  /* BP-01 反真空正控：上限内的 CONNECT 确实进 pending（不是「什么都拒」）。 */
  const five = [];
  {
    if (!bound) bad("BP-01 前置失败：假盒子 BIND 没登记上", JSON.stringify(relay.getRegistry()));
    for (let i = 0; i < 5; i++) {
      const p = await phoneRaw(info.controlPort, clientToken, BOX_ID);
      five.push(p);
      track(p.socket);
    }
    await sleep(120);
    const d = relay.getDiagnosticState();
    if (d.activeStreams !== 3) {
      bad("BP-01 上限内的 CONNECT 没进 pending（activeStreams 不对）", JSON.stringify(d));
    } else {
      ok("BP-01 正控：5 条 CONNECT 中前 3 条进入 pending（activeStreams=3，上限=3）");
    }
  }

  /* BP-02 超限的两条必须明确回 NOBOX，且可观测。 */
  {
    const rejected = five.filter((p) => p.text.includes("NOBOX"));
    const d = relay.getDiagnosticState();
    if (rejected.length !== 2) {
      bad("BP-02 超限的 CONNECT 没都拿到明确 NOBOX", "收到 NOBOX 的条数=" + rejected.length);
    } else if (d.pendingRejected !== 2) {
      bad("BP-02 没有 pendingRejected 诊断或计数不对", d.pendingRejected);
    } else if (d.maxPendingStreams !== 3) {
      bad("BP-02 诊断里没暴露上限", d.maxPendingStreams);
    } else {
      ok("BP-02 超限 2 条 → 明确 NOBOX，pendingRejected=2、maxPendingStreams=3 可观测");
    }
  }

  /* BP-03 反真空：把上限调大，同样 5 条应全部进 pending（证不是「一律拒绝」）。 */
  {
    const wide = RELAY.createRelayServer({
      relaySecret: SECRET, bindHost: "127.0.0.1",
      maxPendingStreams: 8, attachTimeoutMs: 500,
      pingIntervalMs: 1000, pingMissLimit: 1,
    });
    const wi = await wide.start();
    const wb = await silentBox(wi.controlPort, boxToken, BOX_ID);
    track(wb.socket);
    await waitFor(() => Boolean(wide.getRegistry()[BOX_ID]), 40, 25);
    const ps = [];
    for (let i = 0; i < 5; i++) {
      const p = await phoneRaw(wi.controlPort, clientToken, BOX_ID);
      ps.push(p);
      track(p.socket);
    }
    await sleep(120);
    const d = wide.getDiagnosticState();
    // 用 > 0 而不是 !== 0：基线里字段还不存在（undefined），那不该被算成「发生过拒绝」。
    if (d.activeStreams !== 5 || d.pendingRejected > 0) {
      bad("BP-03 上限调大后仍被拒（说明拒绝逻辑不是按上限来的）", JSON.stringify(d));
    } else {
      ok("BP-03 反真空：上限调到 8 后 5 条全部进 pending、pendingRejected=0");
    }
    await wide.stop();
  }

  /* BP-04 动态释放：超时清空后新的 CONNECT 还能进，不是一次性熔断。 */
  {
    const cleared = await waitFor(() => relay.getDiagnosticState().activeStreams === 0, 40, 25);
    const again = await phoneRaw(info.controlPort, clientToken, BOX_ID);
    track(again.socket);
    await sleep(100);
    const d = relay.getDiagnosticState();
    if (!cleared) {
      bad("BP-04 前置失败：pending 一直没释放（stream 泄漏）", JSON.stringify(d));
    } else if (d.activeStreams !== 1) {
      bad("BP-04 释放后新的 CONNECT 进不去（上限被当成一次性熔断）", JSON.stringify(d));
    } else {
      ok("BP-04 超时释放（activeStreams 3→0）后新 CONNECT 又能进 pending（动态上限，无泄漏）");
    }
  }

  /* BP-05 零主动拨：这一片不许把 reverse 退回 dial。 */
  {
    const d = relay.getDiagnosticState();
    if (d.dialAttempts !== 0) bad("BP-05 出现了主动拨（reverse 的零拨保证被破坏）", d.dialAttempts);
    else ok("BP-05 全程 dialAttempts=0（加并发上限没有退回主动拨）");
  }

  /* BP-06/07 审计：有 stream-reject 元数据、日志非空、查无凭证与明文。 */
  {
    const audit = relay.getAuditLog().map((r) => JSON.stringify(r)).join("\n");
    if (!audit.length) {
      bad("BP-07 审计日志为空（「查无凭证」在空日志上是真空通过）");
    } else if (!audit.includes('"event":"stream-reject"')) {
      bad("BP-06 审计里没有 stream-reject 元数据（拒绝这件事不可观测）", audit.slice(-200));
    } else if (audit.includes(boxToken) || audit.includes(clientToken)) {
      bad("BP-06 审计里出现了凭证");
    } else {
      ok("BP-06/07 审计非空、有 stream-reject 元数据且查无两把凭证");
    }
  }

  /* BP-08 旧 dial 路径不受影响（用桩 box 回一段 HTTP 200）。 */
  {
    const stub = net.createServer((s) => {
      s.on("data", () => {
        s.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        s.end();
      });
      s.on("error", () => {});
    });
    await new Promise((res) => stub.listen(0, "127.0.0.1", res));
    relay.registerBox("box-dial-bp", "127.0.0.1:" + stub.address().port);
    const p = await phoneRaw(info.controlPort, clientToken, "box-dial-bp");
    track(p.socket);
    await waitFor(() => p.text.includes("TUNNEL "), 30, 20);
    p.socket.write("GET / HTTP/1.1\r\nHost: box\r\n\r\n");
    const got = await waitFor(() => p.text.includes("HTTP/1.1 200"), 30, 20);
    if (!got) bad("BP-08 旧 REGISTER + 主动拨被改坏了", p.text.slice(0, 160));
    else ok("BP-08 旧 dial 路径仍端到端 200 OK（并发上限只作用于 reverse 的 pending 窗口）");
    await new Promise((res) => stub.close(res));
  }

  /* BP-09 上限是配置而不是硬编码。 */
  {
    const strict = RELAY.createRelayServer({
      relaySecret: SECRET, bindHost: "127.0.0.1",
      maxPendingStreams: 1, attachTimeoutMs: 500, pingIntervalMs: 1000,
    });
    const si = await strict.start();
    const d0 = strict.getDiagnosticState();
    if (d0.maxPendingStreams !== 1 || relay.getDiagnosticState().maxPendingStreams !== 3) {
      bad("BP-09 上限不是按实例配置的（可能被写成全局常量）", d0.maxPendingStreams + " / " + relay.getDiagnosticState().maxPendingStreams);
    } else {
      ok("BP-09 maxPendingStreams 是每实例可配（1 与 3 互不干扰）");
    }
    await strict.stop();
  }

  for (const s of sockets) { try { s.destroy(); } catch (_) {} }
  await relay.stop();
  console.log("prove_relay_stream_backpressure: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_relay_stream_backpressure: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
