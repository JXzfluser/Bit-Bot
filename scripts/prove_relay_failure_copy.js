#!/usr/bin/env node
"use strict";
/**
 * prove_relay_failure_copy.js — §5⑫ 启动日志说人话（FC-01..FC-14）
 *
 * 起点是**真机启动日志**里刷屏的一行：
 *
 *   [relay-box] reverse failed: transport endpoint=127.0.0.1:18765   ← 每 2s 一条
 *
 * 三个毛病：只有 "transport" 四个字；把 reverse 下「只作展示、从不被连接」的
 * endpoint 摆成失败点（现场会去 ping 一个明明回 200 的端口）；永不收敛把日志刷爆。
 *
 * 这一门钉四件事：
 *  1. errno 真的从 socket error 里带出来了（**真连一个没人监听的端口**，不是看字符串）；
 *  2. 人话指向真正的目标（relay host:port），且不把 endpoint 当失败点；
 *  3. 连续同类失败收敛、换原因立刻重新详报、恢复能清账；
 *  4. 不改协议契约：`lastError` 取值、reason 分类、重连节奏（不做指数退避）全保留。
 *
 * 负向对照（INJ-FC）：吞 errno / 用 endpoint 冒充目标 / 不收敛 / 恢复不清账 /
 * 写死重试间隔，逐个摘要被抓到 —— 否则门自己就是恒真的。
 *
 * 跑法：node scripts/prove_relay_failure_copy.js
 */

const fs = require("fs");
const net = require("net");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const COPY = path.join(REPO, "hosts/shared/relay/relay_failure_copy.js");
const BOX = path.join(REPO, "hosts/shared/relay/relay_box_client.js");
const MAIN = path.join(REPO, "hosts/desktop/main.js");
const KEYS = path.join(REPO, "hosts/shared/relay/relay_keys.js");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const copy = require(COPY);
const boxMod = require(BOX);
const keysMod = require(KEYS);
const COPY_SRC = fs.readFileSync(COPY, "utf8");
const BOX_SRC = stripComments(fs.readFileSync(BOX, "utf8"));
const MAIN_SRC = stripComments(fs.readFileSync(MAIN, "utf8"));

/* ------------------------------------------------ 静态判据（可注入负向对照） */

function measure(srcs) {
  const got = [];
  const { copySrc, boxSrc, mainSrc } = srcs;
  const c = stripComments(copySrc);
  const b = stripComments(boxSrc);
  const m = stripComments(mainSrc);

  // ① socket error 必须接住 err，不许 `once("error", () => ...)` 整个吞掉
  const errorHandlers = b.match(/once\("error",\s*\(([^)]*)\)/g) || [];
  if (!errorHandlers.length) got.push("box client 没有 socket error 监听");
  else if (!errorHandlers.some((h) => /\(err\)|\(e\)/.test(h))) got.push("socket error 回调没接 err（errno 被吞）");
  if (!/codeOf\(err\)/.test(b)) got.push("没有 codeOf(err) 提取 errno");
  if (!/detailOf\(/.test(b)) got.push("没有 detailOf 结构化细节");
  if (!/lastErrorDetail/.test(b)) got.push("state 没带 lastErrorDetail");
  if (!/onRecovery/.test(b)) got.push("没有 onRecovery（收敛器无法清账）");

  // ② 人话必须点名真目标，不许把 endpoint 当失败点。
  //    只查 /d\.target/ 会被别处的引用撑绿（第一版 FC-02 就假绿），要钉「拼进句子」这一形状。
  const descBody = (() => {
    const i = c.indexOf("function describeFailure(");
    const j = c.indexOf("function createFailureLog(");
    return i < 0 ? "" : c.slice(i, j < 0 ? undefined : j);
  })();
  if (!/const target = d\.target \|\| "relay"/.test(descBody)) got.push("describeFailure 没有从 detail.target 取真目标");
  if (!/目标 \$\{target\}/.test(descBody)) got.push("describeFailure 没把真目标拼进人话");
  if (!/endpointIsDisplayOnly/.test(c)) got.push("没有「endpoint 只是展示字段」的说明");
  if (!/CODE_HINT|ECONNREFUSED/.test(c)) got.push("没有 errno → 人话映射");
  // 重试间隔不许写死：必须有 reconnectMs 参数且不带硬编码 2000/2s
  if (!/reconnectMs/.test(c)) got.push("汇聚行没有 reconnectMs 参数（会写死 2s 说谎）");
  if (/每次 2s 重试|每次 \$\{2\}/.test(c)) got.push("日志里仍有写死的「每次 2s 重试」");
  // 纯函数自己也要截断长错误串（UI 会直接调，不能依赖调用方 scrub）
  if (!/String\(d\.message\)[\s\S]{0,80}slice\(0, 160\)/.test(descBody))
    got.push("describeFailure 没截断原始错误串（长 message 会刷爆日志）");

  // ③ 收敛：首次必须详报、之后要抑制、恢复要清账。
  //    `sig = ""` 在**变量声明**里也有，全文件查会恒真 —— 必须按 onRecover 函数体切片查。
  if (!/count === 1/.test(c)) got.push("收敛器没有「首次必报」分支");
  if (!/repeatEvery === 0|% repeatEvery/.test(c)) got.push("收敛器没有周期汇总");
  if (!/nextSig !== sig/.test(c)) got.push("收敛器没按签名变化重新详报（换了目标会一直吞）");
  const recoverBody = (() => {
    const i = c.indexOf("function onRecover(");
    const j = c.indexOf("function stats(");
    return i < 0 ? "" : c.slice(i, j < 0 ? undefined : j);
  })();
  if (!/sig = ""/.test(recoverBody) || !/count = 0/.test(recoverBody))
    got.push("onRecover 没清账（恢复后签名还挂着，下次失败会被吞）");

  // ④ main.js 真的接线了，不是留个孤儿模块
  if (!/relayFailureCopy\.createFailureLog/.test(m)) got.push("main.js 没接收敛器");
  if (!/onRecovery:/.test(m)) got.push("main.js 没接 onRecovery");
  if (!/log: \(reason, detail\)/.test(m)) got.push("main.js 的 log 回调没收 detail");
  // 旧日志形状不许回来
  if (/failed: \$\{reason\} endpoint=/.test(m)) got.push("旧的误导日志形状还在");

  // ⑤ 老契约没被改坏
  if (!/lastError = reason/.test(b)) got.push("lastError 赋值被改了（门禁靠它分类）");
  if (!/if \(stopped \|\| !\(reconnectMs > 0\) \|\| reconnectTimer\) return/.test(b))
    got.push("重连调度被改了（不做指数退避是刻意设计）");
  return got;
}

const BASE = { copySrc: COPY_SRC, boxSrc: BOX_SRC, mainSrc: MAIN_SRC };

/* ------------------------------------------------------------------- main */

async function main() {
  console.log("relay failure copy proof (FC-01..FC-14)");

  /* ---------- 静态段 ---------- */
  {
    const problems = measure(BASE);
    if (problems.length) bad("FC-01 说人话/收敛/接线没接齐", problems.slice(0, 6).join(" | "));
    else ok("FC-01 errno 提取 + 结构化 detail + 人话映射 + 收敛器 + main 接线 + 老契约保留");

    const muts = [
      ["吞 errno", (s) => ({ ...s, boxSrc: s.boxSrc.replace(/codeOf\(err\)/g, '""') })],
      ["人话不提真目标", (s) => ({ ...s, copySrc: s.copySrc.replace(/const target = d\.target \|\| "relay"/, 'const target = "relay"') })],
      ["删掉 endpoint 展示说明", (s) => ({ ...s, copySrc: s.copySrc.replace(/if \(ctx && ctx\.endpointIsDisplayOnly[\s\S]*?\n  \}\n/, "") })],
      ["收敛器不抑制", (s) => ({ ...s, copySrc: s.copySrc.replace(/if \(count % repeatEvery === 0\) \{/g, "if (false) {").replace(/return \{ emitted: false, suppressed: count - 1 \};/g, "return { emitted: true, suppressed: 0 };") })],
      ["恢复不清账", (s) => ({ ...s, copySrc: s.copySrc.replace(/sig = "";\n    count = 0;\n    firstAt = 0;/, "") })],
      ["main 没接线", (s) => ({ ...s, mainSrc: s.mainSrc.replace(/relayFailureCopy\.createFailureLog/g, "Object.freeze") })],
      ["旧误导日志形状回来", (s) => ({ ...s, mainSrc: s.mainSrc + '\nprocess.stderr.write(`[relay-box] ${mode} failed: ${reason} endpoint=${endpoint}\\n`);\n' })],
      // 必须注入**真代码**：第一版往源码尾部塞了句注释，判前 stripComments 直接剥掉，
      // 于是「负向对照」自己被剥没了 —— 与 AB-21 / RS-09 / CF-05 同型，本轮第四次。
      ["写死重试间隔", (s) => ({ ...s, copySrc: s.copySrc.replace(
        /write\(`\[relay-box\] 仍在失败/,
        'write(`每次 2s 重试 " + `[relay-box] 仍在失败',
      ) })],
    ];
    const undetected = muts.filter(([, f]) => !measure(f(BASE)).length).map(([n]) => n);
    if (undetected.length) bad("FC-02 负向对照失效：这些走偏尺子抓不到", undetected.join("；"));
    else ok("FC-02 八组负向对照（吞 errno / 不提真目标 / 删展示说明 / 不抑制 / 不清账 / 不接线 / 旧日志 / 写死间隔）全被抓到");
  }

  /* ---------- 纯函数段：人话 ---------- */
  {
    const d = { target: "192.168.1.5:18766", code: "ECONNREFUSED", phase: "connect", mode: "reverse", message: "connect ECONNREFUSED 192.168.1.5:18766" };
    const line = copy.describeFailure("transport", d, { endpoint: "127.0.0.1:18765", endpointIsDisplayOnly: true });
    if (!line.includes("192.168.1.5:18766")) bad("FC-03 人话没点名真正的 relay 目标", line);
    else if (!line.includes("ECONNREFUSED") || !line.includes("relay 进程没起")) bad("FC-03 人话没给 errno 与下一步", line);
    else if (!line.includes("只是展示字段")) bad("FC-03 没点破 endpoint 是展示字段（现场仍会查错方向）", line);
    else ok("FC-03 说人话：目标 / errno / 该查什么 / 「别查 endpoint」四样齐");

    const leaked = copy.describeFailure("denied", { target: "x:1", message: "AUTH SECRET-TOKEN-123" }, {});
    if (!leaked.includes("凭证")) bad("FC-04 凭证类错误没被单独说清（会被误判成网络问题）", leaked);
    else ok("FC-04 denied 与 transport 分开说（凭证不对 ≠ 网络不好）");

    const bounded = copy.describeFailure("transport", { target: "h:1", code: "ETIMEDOUT", message: "AUTH AB" + "C".repeat(500) }, {});
    if (bounded.length > 500) bad("FC-05 原始信息没截断（长错误串会刷爆日志）", bounded.length);
    else ok("FC-05 原始错误信息有长度上限（" + bounded.length + " 字）");
  }

  /* ---------- 纯函数段：收敛（反真空在这里最要紧） ---------- */
  {
    const lines = [];
    let t = 1000;
    const L = copy.createFailureLog({
      write: (l) => lines.push(l), now: () => t, repeatEvery: 3, reconnectMs: 2000,
    });
    const d = { target: "192.168.1.5:18766", code: "ECONNREFUSED", phase: "connect" };
    for (let i = 0; i < 9; i++) { t += 2000; L.onFailure("transport", d, {}); }
    const rec = L.onRecover({ target: d.target });
    if (lines.length === 0) bad("FC-06 反真空失败：9 次失败一行日志都没有（把「没打」当「收敛成功」）");
    else if (lines.length >= 9) bad("FC-06 收敛失效：9 次失败打了 " + lines.length + " 行", lines.length);
    else if (!lines[0].includes("登记失败") || !lines[0].includes("ECONNREFUSED")) bad("FC-06 首条不是详报（把第一次失败吞了）", lines[0]);
    else if (!lines.some((l) => l.includes("已连续"))) bad("FC-06 没有周期汇总（信息被静默丢掉）");
    else if (!rec.wasFailing || !lines[lines.length - 1].includes("已恢复")) bad("FC-06 恢复没清账/没报", JSON.stringify(rec));
    else ok("FC-06 9 次失败 → " + lines.length + " 行（首条详报 + 周期汇总 + 恢复清账），信息没丢也没刷屏");

    if (!lines.some((l) => l.includes("每 2s 重试"))) bad("FC-07 汇总行没写重试间隔");
    else ok("FC-07 汇总行带真实重试间隔（reconnectMs 从调用方传，不写死）");

    // 换了原因/目标必须立刻重新详报，不能被「连续」吞掉
    const lines2 = [];
    const L2 = copy.createFailureLog({ write: (l) => lines2.push(l), repeatEvery: 100 });
    L2.onFailure("transport", d, {});
    L2.onFailure("transport", { ...d, code: "ETIMEDOUT" }, {});
    if (lines2.length !== 2) bad("FC-08 errno 变了却没重新详报（新故障被当成老故障的第 N 次）", lines2.length);
    else ok("FC-08 失败签名一变立刻重新详报（换了目标/errno 不会被吞）");

    const lines3 = [];
    const L3 = copy.createFailureLog({ write: (l) => lines3.push(l), reconnectMs: 8000 });
    for (let i = 0; i < 5; i++) L3.onFailure("transport", d, {});
    if (lines3.some((l) => l.includes("每 2s"))) bad("FC-09 调用了 8s 重连却仍写 2s（日志说谎）", lines3.join(" | "));
    else ok("FC-09 不传/改 reconnectMs 时日志不写死间隔（宁可少说，不可说错）");
  }

  /* ---------- 真 socket 段：errno 必须是真带出来的 ---------- */
  {
    // 真起一个没人监听的端口：连它必然 ECONNREFUSED。
    // 用一个临时 server 拿到「保证空闲」的端口再关掉，避免撞上别的服务。
    const probe = net.createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));

    const secret = "fc-secret";
    const boxToken = keysMod.issueRelayCredential(secret, "fc-desktop", "box");
    const events = [];
    const box = boxMod.createRelayBoxClient({
      host: "127.0.0.1", port, boxId: "fc-box", boxToken,
      endpoint: "127.0.0.1:18765", localEndpoint: "127.0.0.1:18765",
      mode: "reverse", heartbeatMs: 0, reconnectMs: 0, // 不重连，只测第一次
      log: (reason, detail) => events.push({ reason, detail }),
      onRecovery: (info) => events.push({ recovered: info }),
    });
    box.start();
    // 用轮询等真 socket 的 error 回来，不靠 sleep 猜
    for (let i = 0; i < 100 && !events.length; i++) await new Promise((r) => setTimeout(r, 20));
    box.stop();

    const e = events.find((x) => x.reason);
    if (!e) bad("FC-10 真连不可达端口却没触发失败日志（门自身没跑起来）");
    else if (e.reason !== "transport") bad("FC-10 reason 取值被改了（老契约）", e.reason);
    else if (!e.detail) bad("FC-10 失败没带 detail（errno 仍然丢了）");
    else if (e.detail.code !== "ECONNREFUSED") bad("FC-10 errno 不是真的 ECONNREFUSED", JSON.stringify(e.detail));
    else if (e.detail.target !== "127.0.0.1:" + port) bad("FC-10 detail.target 不是真正连接的目标", e.detail.target);
    else if (e.detail.target === "127.0.0.1:18765") bad("FC-10 detail.target 竟然是展示用的 endpoint（误导没修掉）");
    else ok("FC-10 真 socket：连 " + e.detail.target + " → errno=" + e.detail.code + "（不是从字符串猜的）");

    const st = box.getState();
    if (st.lastError !== "transport") bad("FC-11 getState().lastError 契约被改", st.lastError);
    else if (!st.lastErrorDetail || st.lastErrorDetail.code !== "ECONNREFUSED") bad("FC-11 state 里没有结构化细节");
    else ok("FC-11 getState() 老字段不变 + 新增 lastErrorDetail（UI 以后也能说人话）");

    // 凭证绝不许进 detail / 人话
    const all = JSON.stringify(events);
    if (all.includes(boxToken)) bad("FC-12 detail 里泄了 box_token（A3-2）");
    else {
      const line = copy.describeFailure("transport", e && e.detail, { endpoint: "127.0.0.1:18765", endpointIsDisplayOnly: true });
      if (line.includes(boxToken)) bad("FC-12 人话日志里泄了 box_token");
      else ok("FC-12 结构化细节与人话日志查无凭证");
    }
  }

  /* ---------- 真 relay 起来后能恢复（反真空：不能只测失败） ---------- */
  {
    const RELAY = require(path.join(REPO, "hosts/shared/relay/relay_server.js"));
    const secret = "fc-recover";
    const boxToken = keysMod.issueRelayCredential(secret, "fc-desktop", "box");
    const relay = RELAY.createRelayServer({ relaySecret: secret, bindHost: "127.0.0.1" });
    const info = await relay.start();
    const events = [];
    const box = boxMod.createRelayBoxClient({
      host: "127.0.0.1", port: info.controlPort, boxId: "fc-ok", boxToken,
      endpoint: "192.0.2.1:1", localEndpoint: "127.0.0.1:18765",
      mode: "reverse", heartbeatMs: 0, reconnectMs: 0,
      log: (reason, detail) => events.push({ reason, detail }),
      onRecovery: (i) => events.push({ recovered: i }),
    });
    box.start();
    for (let i = 0; i < 100 && !events.some((x) => x.recovered); i++) await new Promise((r) => setTimeout(r, 20));
    const recovered = events.find((x) => x.recovered);
    if (!recovered) bad("FC-13 真 relay 起来了却没有 onRecovery（收敛器永远清不了账）", JSON.stringify(events));
    else if (recovered.recovered.target !== "127.0.0.1:" + info.controlPort) bad("FC-13 恢复通知的目标不对", JSON.stringify(recovered));
    else ok("FC-13 真 relay BIND 成功 → onRecovery 带真目标（失败日志能报「已恢复」）");
    try { box.stop(); } catch (_) {}
    try { await relay.stop(); } catch (_) {}
  }

  /* ---------- CF 门同源精神：文档/清单别再把旧日志写回去 ---------- */
  {
    const CHECKLIST = path.join(REPO, "docs/design/desktop-target/real-device-checklist.md");
    const doc = fs.readFileSync(CHECKLIST, "utf8");
    if (/reverse failed: transport endpoint=/.test(doc))
      bad("FC-14 清单里还留着旧的误导日志样例（现场照着查错方向）");
    else ok("FC-14 清单没把旧的误导日志形状写成「正常长相」");
  }

  /* ---------- FC-15 两个地址不一样时必须点破（A3-15） ----------
   * 真实启动日志里同时出现「-> 192.168.1.5:18766」和「目标 127.0.0.1:18766」，
   * 那是连接地址与下发地址分离的**设计**，不是配置错。不解释，现场会去改对的字段。 */
  {
    if (!/连接地址与下发地址分离/.test(MAIN_SRC))
      bad("FC-15 启动日志没解释「下发地址 ≠ 实际连接地址」（现场会误判成地址对不上）");
    else if (!/cfg\.connectHost !== cfg\.host/.test(MAIN_SRC))
      bad("FC-15 说明分支没有按 connectHost 差异触发（会无条件刷一行废话）");
    else ok("FC-15 connectHost 与 host 不同时才打一行说明，点破 A3-15 的地址分离");
  }

  console.log("prove_relay_failure_copy: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
