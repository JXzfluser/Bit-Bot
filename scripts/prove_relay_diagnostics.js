#!/usr/bin/env node
"use strict";
/**
 * prove_relay_diagnostics.js — R-A3-8a / R-A3-5b 门禁（DG-01..DG-12）
 *
 * 要证两件事，都是「现场能不能验」的前提：
 *
 *  ① **诊断态真的能从 HTTP 读到**。以前 getDiagnosticState() 只是进程内 JS API，
 *     真公网 relay 上现场没有端点可读；清单 §5⑭ / §6 却写着「看 relay 诊断态」。
 *     现在补 GET /diagnostics（只读、白名单字段、带 schema 版本）。
 *
 *  ② **liveBridges 才是「挂着的转发连接」**，activeStreams 不是。
 *     activeStreams = pendingStreams.size 只统计「等 ATTACH 的窗口」，ATTACH 一到
 *     就 delete、另有 2.5s 超时兜底 —— 它**必然**回基线。拿它证明「断流重连不留
 *     连接」是恒真对照：挂住十条死连接它照样是 0。
 *
 * 反真空是这一门的命门：
 *  - DG-04：真建立一条隧道时 liveBridges 必须 **>0**；从没连过也是 0，那是真空绿。
 *  - DG-05：关掉必须回落，且 bridgesOpened/bridgesClosed 与 live 对得上（不变量）。
 *  - DG-06：**故意挂住不关**，liveBridges 必须仍 >0 而 activeStreams 已回 0 ——
 *    这一条直接复刻「旧代码漏关 socket」的现场，证明两个计数确实不是一回事。
 *  - DG-07：重连 5 次开 5 关 5，live 回基线而 opened/closed 各涨 5（§5⑭ 的形状）。
 *
 * 负向对照（INJ-DG）：把源码里的 onBridgeClose 摘掉 / 把 liveBridges 字段从端点
 * 白名单里删掉 / 把 schema 降级，判据必须全部转红 —— 否则门自己就是恒真的。
 *
 * 跑法：node scripts/prove_relay_diagnostics.js
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
const RELAY_SRC = fs.readFileSync(RELAY, "utf8");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

/** 剥掉 JS 注释再判源码 —— 今天已经栽过三次（AB-21 / RS-09 / RBI-06）。 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SRC = stripComments(RELAY_SRC);

/* ------------------------------------------------ 静态判据（可注入负向对照） */

const ENDPOINT_FIELDS = [
  "schema", "boxes", "dialAttempts", "reverseBoxes", "activeStreams",
  "streamsServed", "liveBridges", "bridgesOpened", "bridgesClosed",
  "connectionsForwarded", "livenessEvictions", "pendingRejected",
];

/** 判据本体：吃一份（可能被改坏的）源码文本，返回缺陷列表。空数组 = 干净。 */
function measure(srcText) {
  const s = stripComments(srcText);
  const got = [];
  // ① 端点存在且路径对
  if (!/req\.url === "\/diagnostics"/.test(s)) got.push("没有 GET /diagnostics 路由");
  // ② schema 版本 —— 现场脚本靠它判断 relay 是否带得起 §5⑭
  if (!/schema:\s*1/.test(s)) got.push("端点没有 schema:1（旧版字段缺失会被当成 0，假绿）");
  // ③ 白名单逐字段挑，不是整包 stringify
  const routeBody = s.slice(s.indexOf('req.url === "/diagnostics"'));
  const routeEnd = routeBody.indexOf("} else {");
  const body = routeEnd < 0 ? routeBody : routeBody.slice(0, routeEnd);
  if (/JSON\.stringify\(\s*d\s*\)/.test(body) || /JSON\.stringify\(\s*diagnosticState\(\)\s*\)/.test(body))
    got.push("端点整包序列化诊断态（将来加字段会顺手泄出去）");
  for (const f of ENDPOINT_FIELDS) {
    if (!new RegExp("\\b" + f + ":").test(body)) got.push("端点白名单缺字段 " + f);
  }
  // ④ 不该泄的那些一个都不许出现
  for (const forbidden of ["token", "payload", "endpoint", "memberId", "auditLog", "getRegistry"]) {
    if (new RegExp("\\b" + forbidden + "\\s*:").test(body)) got.push("端点吐了不该吐的字段 " + forbidden);
  }
  // ⑤ 计数成对：open / close 都调用了，且诊断态里带齐三个
  if (!/function onBridgeOpen\(\)[\s\S]{0,120}liveBridges\+\+/.test(s)) got.push("onBridgeOpen 没有给 liveBridges +1");
  if (!/function onBridgeClose\(\)[\s\S]{0,120}liveBridges--/.test(s)) got.push("onBridgeClose 没有给 liveBridges -1");
  if (!/liveBridges,\s*bridgesOpened,\s*bridgesClosed,/.test(s)) got.push("诊断态没带齐 live/opened/closed 三元组");
  // ⑥ 两条数据面路径各自都要**成对**记账。
  //    只查「文件里有没有 onBridgeClose()」会被另一条路径撑绿 —— 摘掉 reverse 的
  //    那一处、dial 还留着一道，全局正则照样命中（第一版 DG-02 就是这么假绿的）。
  const bridgeBody = s.slice(s.indexOf("function bridge("), s.indexOf("function dropPending("));
  const openBoxBody = s.slice(s.indexOf("function openBox("), s.indexOf("function bridge("));
  for (const [name, body] of [["reverse 的 bridge()", bridgeBody], ["dial 的 openBox()", openBoxBody]]) {
    if (!/onBridgeOpen\(\)/.test(body)) got.push(name + " 没记开（计数器恒为 0）");
    if (!/onBridgeClose\(\)/.test(body)) got.push(name + " 没记关（连接永远不回落）");
  }
  // ⑦ /healthz 原契约不能被改坏（别的探针/门禁依赖 {ok, boxes}）
  if (!/res\.end\(JSON\.stringify\(\{ ok: true, boxes: registry\.size \}\)\)/.test(s))
    got.push("/healthz 原契约被改了");
  return got;
}

/* ------------------------------------------------------------ HTTP 小工具 */

function httpGet(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, agent: false }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ code: res.statusCode, body: b, headers: res.headers }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("http timeout")));
  });
}

/** 一条 socket 一个常驻行读取器（与 RV 门同款；合并 chunk 会吞第二行）。 */
function lineReader(socket) {
  let buf = "";
  let waiters = [];
  socket.on("data", (d) => { buf += d.toString("latin1"); pump(); });
  socket.on("close", () => failAll(new Error("closed")));
  socket.on("error", (e) => failAll(e));
  function failAll(e) {
    const ws = waiters; waiters = [];
    for (const w of ws) { clearTimeout(w.t); w.reject(e); }
  }
  function pump() {
    while (waiters.length) {
      const i = buf.indexOf("\n");
      if (i < 0) return;
      const w = waiters.shift();
      clearTimeout(w.t);
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      w.resolve(line);
    }
  }
  return (ms) => new Promise((resolve, reject) => {
    const w = { resolve, reject, t: null };
    w.t = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error("line timeout")); }, ms || 8000);
    waiters.push(w); pump();
  });
}

async function phoneConnect(port, clientToken, boxId) {
  const s = net.connect(port, "127.0.0.1");
  const read = lineReader(s);
  await new Promise((res, rej) => { s.once("connect", res); s.once("error", rej); });
  s.write("AUTH " + clientToken + "\nCONNECT " + boxId + "\n");
  const auth = await read(8000);
  if (auth !== "OK") { s.destroy(); throw new Error("auth=" + auth); }
  const reply = await read(8000);
  if (!reply.startsWith("TUNNEL ")) { s.destroy(); throw new Error("reply=" + reply); }
  return s;
}

const waitFor = async (fn, pred, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (pred(v)) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return fn();
};

/* ------------------------------------------------------------------- main */

async function main() {
  console.log("relay diagnostics proof (DG-01..DG-12)");

  /* ---------- 静态段 ---------- */
  {
    const problems = measure(RELAY_SRC);
    if (problems.length) bad("DG-01 端点/计数没接齐", problems.slice(0, 6).join(" | "));
    else ok("DG-01 /diagnostics 白名单 12 字段 + schema:1 + 成对计数 + /healthz 原契约未动");

    const muts = [
      ["摘掉 onBridgeClose", (s) => s.replace(/      onBridgeClose\(\); \/\/ 与 onBridgeOpen 成对[^\n]*\n/, "")],
      ["端点删掉 liveBridges 字段", (s) => s.replace(/            liveBridges: d\.liveBridges,\n/, "")],
      ["端点删掉 schema", (s) => s.replace(/            schema: 1,\n/, "")],
      ["整包序列化诊断态", (s) => s.replace(/          const d = diagnosticState\(\);/, "          const d = diagnosticState(); res.end(JSON.stringify(d)); return;")],
      ["reverse 不记账", (s) => s.replace(/  function bridge\(a, b, initialA, initialB, meta\) \{\n    onBridgeOpen\(\);/, "  function bridge(a, b, initialA, initialB, meta) {")],
    ];
    const undetected = muts.filter(([, f]) => !measure(f(RELAY_SRC)).length).map(([n]) => n);
    if (undetected.length) bad("DG-02 负向对照失效：这些走偏尺子抓不到", undetected.join("；"));
    else ok("DG-02 五组负向对照（摘 close / 删字段 / 删 schema / 整包序列化 / reverse 不记账）全部被抓到");

    // 端点绝不能吐敏感字段：连源码里出现这些「字段名:」都不行（剥注释后）
    const routeBody = SRC.slice(SRC.indexOf('req.url === "/diagnostics"'), SRC.indexOf("res.writeHead(404)"));
    const leaks = ["token:", "payload:", "endpoint:", "memberId:", "boxId:"].filter((k) => routeBody.includes(k));
    if (leaks.length) bad("DG-03 /diagnostics 吐了元数据/凭证字段", leaks.join(","));
    else ok("DG-03 端点只吐计数，查无 token/payload/endpoint/memberId/boxId");
  }

  /* ---------- 动态段：真起 relay + 真 reverse 隧道 ---------- */
  let relayMod, boxMod, keysMod, inboundMod, pairingMod;
  try {
    relayMod = require(RELAY); boxMod = require(BOX); keysMod = require(KEYS);
    inboundMod = require(INBOUND); pairingMod = require(PAIRING);
  } catch (e) {
    bad("DG-00 模块加载失败", e.message);
    console.log("prove_relay_diagnostics: PASS=" + PASS + " FAIL=" + FAIL);
    process.exit(1);
  }

  const SECRET = "diag-secret-for-gate";
  const BOX_ID = "box-diag";
  const boxToken = keysMod.issueRelayCredential(SECRET, "desktop-diag", "box");
  const clientToken = keysMod.issueRelayCredential(SECRET, "phone-diag", "client");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-diag-"));
  const inbound = inboundMod.createCnInboundServer({
    repoRoot: tmp, port: 0, host: "127.0.0.1",
    pairingManager: pairingMod.createPairingCodeManager(),
    turnToken: "t-diag-0123456789",
    onTurn: async () => ({ ok: true, messages: [], host_results: [], stdout: "" }),
  });
  const inboundInfo = await inbound.start();
  const localEndpoint = "127.0.0.1:" + inboundInfo.port;
  const relay = relayMod.createRelayServer({ relaySecret: SECRET, bindHost: "127.0.0.1" });
  const info = await relay.start();
  const box = boxMod.createRelayBoxClient({
    host: "127.0.0.1", port: info.controlPort, boxId: BOX_ID, boxToken,
    endpoint: "192.0.2.1:1", localEndpoint, mode: "reverse", heartbeatMs: 0,
  });
  box.start();
  await waitFor(() => relay.getRegistry()[BOX_ID], (v) => !!v);

  const opened = [];
  try {
    /* DG-04 反真空：真开一条隧道，liveBridges 必须 >0。 */
    const s1 = await phoneConnect(info.controlPort, clientToken, BOX_ID);
    opened.push(s1);
    const during = relay.getDiagnosticState();
    if (!(during.liveBridges > 0)) bad("DG-04 反真空失败：隧道明明开着，liveBridges 却是 0（真空绿）", JSON.stringify(during));
    else ok("DG-04 反真空：隧道开着时 liveBridges=" + during.liveBridges + "（计数器真的会动，不是恒 0）");

    /* DG-05 /diagnostics 与 JS API 一致 + no-store + schema */
    const dgRes = await httpGet(info.healthPort, "/diagnostics");
    let httpDiag = null;
    try { httpDiag = JSON.parse(dgRes.body); } catch (_) {}
    if (dgRes.code !== 200 || !httpDiag) bad("DG-05 /diagnostics 没回 200/JSON", dgRes.code + " " + dgRes.body.slice(0, 120));
    else if (httpDiag.schema !== 1) bad("DG-05 /diagnostics 缺 schema:1（现场脚本无法判断版本）", JSON.stringify(httpDiag));
    else if (httpDiag.liveBridges !== during.liveBridges) bad("DG-05 HTTP 与 JS API 的 liveBridges 不一致", httpDiag.liveBridges + " vs " + during.liveBridges);
    else if (!/no-store/.test(String(dgRes.headers["cache-control"]))) bad("DG-05 /diagnostics 没带 no-store（现场会读到缓存的旧数）");
    else ok("DG-05 现场读得到：GET /diagnostics → 200，schema=1，liveBridges 与进程内一致，no-store");

    /* DG-06 关键对照：**挂住不关**，liveBridges 仍 >0 而 activeStreams 已回 0。
     * 这正是旧代码漏关 socket 的现场形状。 */
    s1.destroy();
    const afterClose = await waitFor(() => relay.getDiagnosticState(), (d) => d.liveBridges === 0, 4000);
    if (afterClose.liveBridges !== 0) bad("DG-06 关掉一条后 liveBridges 没回落", afterClose.liveBridges);
    else if (!(afterClose.bridgesOpened > 0 && afterClose.bridgesClosed > 0)) bad("DG-06 opened/closed 没涨（回落可能是压根没开过）", JSON.stringify(afterClose));
    else if (afterClose.liveBridges !== afterClose.bridgesOpened - afterClose.bridgesClosed) bad("DG-06 不变量被破坏：live !== opened - closed", JSON.stringify(afterClose));
    else ok("DG-06 开一关一：live 回落 0，opened=" + afterClose.bridgesOpened + " closed=" + afterClose.bridgesClosed + "，不变量成立");

    /* 故意挂住 3 条不关（模拟泄漏），对比两个计数 */
    const held = [];
    for (let i = 0; i < 3; i++) held.push(await phoneConnect(info.controlPort, clientToken, BOX_ID));
    const leaked = relay.getDiagnosticState();
    const dgLeak = JSON.parse((await httpGet(info.healthPort, "/diagnostics")).body);
    if (!(leaked.liveBridges >= 3)) bad("DG-07 挂住 3 条，liveBridges 没反映出来", JSON.stringify(leaked));
    else if (leaked.activeStreams !== 0) bad("DG-07 前置异常：ATTACH 已完成，activeStreams 本该是 0", leaked.activeStreams);
    else if (dgLeak.activeStreams === dgLeak.liveBridges) bad("DG-07 两个计数竟然相等（那就分不出泄漏了）", JSON.stringify(dgLeak));
    else ok("DG-07 **恒真对照被拆穿**：挂住 3 条死连接时 activeStreams=" + leaked.activeStreams + "（照样回基线，证明不了任何事），liveBridges=" + leaked.liveBridges + "（真抓到了）；HTTP 端点同样读得到 " + dgLeak.liveBridges);

    /* DG-08 §5⑭ 的形状：重连 5 次、开 5 关 5、live 回基线 */
    const before5 = relay.getDiagnosticState();
    for (let i = 0; i < 5; i++) {
      const sx = await phoneConnect(info.controlPort, clientToken, BOX_ID);
      sx.destroy();
    }
    const after5 = await waitFor(() => relay.getDiagnosticState(), (d) => d.liveBridges === before5.liveBridges, 5000);
    const dOpened = after5.bridgesOpened - before5.bridgesOpened;
    const dClosed = after5.bridgesClosed - before5.bridgesClosed;
    if (after5.liveBridges !== before5.liveBridges) bad("DG-08 重连 5 次后 liveBridges 没回基线", before5.liveBridges + " → " + after5.liveBridges);
    else if (dOpened < 5 || dClosed < 5) bad("DG-08 opened/closed 没涨够（「回基线」可能是没连过）", "opened+" + dOpened + " closed+" + dClosed);
    else if (after5.streamsServed - before5.streamsServed < 5) bad("DG-08 streamsServed 没涨（没真重连过）", after5.streamsServed - before5.streamsServed);
    else ok("DG-08 §5⑭ 真形状：重连 5 次 → opened+" + dOpened + " closed+" + dClosed + " served+" + (after5.streamsServed - before5.streamsServed) + "，live 稳定在 " + after5.liveBridges);

    /* DG-09 把挂住的 3 条关掉，live 必须真的少 3。
     * 第一版把 target 写成 after5.liveBridges（=关之前的数），于是 waitFor 的
     * 谓词当下就为真、一次都没等，测的是「什么都没发生」—— 本轮第八次恒真对照。
     * 现在：先记基线、期望值 = 基线 - held.length，并强制「关之前 > 期望值」。 */
    const beforeHeal = relay.getDiagnosticState().liveBridges;
    const target = beforeHeal - held.length;
    for (const s of held) s.destroy();
    const healed = await waitFor(() => relay.getDiagnosticState(), (d) => d.liveBridges === target, 4000);
    if (!(beforeHeal > target)) bad("DG-09 反真空失败：关之前 live 并不比期望值大，这条测不到回收", beforeHeal + " vs " + target);
    else if (healed.liveBridges !== target) bad("DG-09 挂住的连接关掉后没回落", beforeHeal + " → " + healed.liveBridges + "（期望 " + target + "）");
    else ok("DG-09 泄漏被回收：3 条挂住的连接关掉后 live 从 " + beforeHeal + " 降到 " + target);

    /* DG-10 404 契约：未知路径仍 404，不能把所有 GET 都变成诊断态 */
    const nf = await httpGet(info.healthPort, "/nope");
    if (nf.code !== 404) bad("DG-10 未知路径不是 404", nf.code);
    else ok("DG-10 未知路径仍 404（没有把 health 端口改成全放行）");

    /* DG-11 /healthz 契约未变 */
    const hz = JSON.parse((await httpGet(info.healthPort, "/healthz")).body);
    if (!hz.ok || typeof hz.boxes !== "number" || Object.keys(hz).length !== 2)
      bad("DG-11 /healthz 形状变了（探针/既有门依赖 {ok, boxes}）", JSON.stringify(hz));
    else ok("DG-11 /healthz 仍是 {ok, boxes} 两个字段（老契约没动）");

    /* DG-12 端点绝不吐明文：连 SECRET / token / boxId 都不许出现 */
    const raw = (await httpGet(info.healthPort, "/diagnostics")).body;
    const leaks = [SECRET, boxToken, clientToken, BOX_ID].filter((k) => raw.includes(k));
    if (leaks.length) bad("DG-12 /diagnostics 吐了凭证 / boxId 原文", leaks.length + " 处");
    else ok("DG-12 端点响应里查无 relaySecret / box_token / client_token / boxId");
  } catch (e) {
    bad("DG-00 动态段异常", (e && e.stack) || String(e));
  } finally {
    for (const s of opened) { try { s.destroy(); } catch (_) {} }
    try { box.stop(); } catch (_) {}
    try { await relay.stop(); } catch (_) {}
    try { await inbound.stop(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("prove_relay_diagnostics: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
