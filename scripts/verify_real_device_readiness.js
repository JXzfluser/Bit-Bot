#!/usr/bin/env node
"use strict";
/**
 * verify_real_device_readiness.mjs — 真机验收前的 30 秒自检（A3-10 / R-A3-8a）
 *
 * 用途：**别带着半套配置上真机**。现场最常踩的不是产品 bug，是「mode 没写 reverse」、
 * 「两把钥匙混成一把」、「relay 只绑了 127.0.0.1」、「桌面 app 根本没在跑」。
 * 这些在手机上看起来都长成「连不上」，查起来最费时间。
 *
 * 与门禁的区别（重要，别混）：
 *   - `prove_relay_reverse_tunnel.js` / `prove_relay_reverse_resilience.js` 是**产品门**，
 *     自己起 relay 与 cn_inbound，证协议与能力；
 *   - 本脚本连的是**你真要用的那台 relay 和那台桌面**，证「这一套现场配置真的能开工」。
 *   - 两者都不能替代 §5 的真机打勾：真公网 + 真 NAT + 蜂窝网手机要人肉跑。
 *
 * 自检项 RD-01..RD-08 全是硬断言：连不上就红，不许 SKIP 当绿、不许静态锚点冒充。
 * RD-06/RD-07 是**真握手**（client_token AUTH / box_token BIND），不是「文件里有这个字段」。
 *
 * 用法：
 *   BITBOT_RELAY_SECRET='<你的 secret>' node scripts/verify_real_device_readiness.js
 *   node scripts/verify_real_device_readiness.js --config /path/relay.json --secret '...' \
 *        --inbound-port 18765
 *
 * 自证（可挂 CI，自己起本地 relay + 临时配置，不依赖外网/真机）：
 *   node scripts/verify_real_device_readiness.js --self-test
 */

const fs = require("fs");
const os = require("os");
const net = require("net");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const CONFIG_MOD = require(path.join(REPO, "hosts/shared/relay/relay_config.js"));
const KEYS = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));
const RELAY_MOD = require(path.join(REPO, "hosts/shared/relay/relay_server.js"));

function parseArgs(argv) {
  const out = { config: null, secret: null, inboundPort: null, selfTest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") out.selfTest = true;
    else if (a === "--config") out.config = argv[++i];
    else if (a === "--secret") out.secret = argv[++i];
    else if (a === "--inbound-port") out.inboundPort = Number(argv[++i]);
  }
  return out;
}

/** 一条 socket 一个常驻行读取器（A3-8 教训：OK 与下一行常挤在同一 chunk）。 */
function socketLines(sock, timeoutMs) {
  let buf = "";
  let waiters = [];
  const onData = (d) => {
    buf += d.toString("latin1");
    while (waiters.length) {
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const w = waiters.shift();
      clearTimeout(w.timer);
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      w.resolve(line);
    }
  };
  const failAll = (e) => {
    const ws = waiters;
    waiters = [];
    for (const w of ws) {
      clearTimeout(w.timer);
      w.reject(e);
    }
  };
  sock.on("data", onData);
  sock.on("error", failAll);
  sock.on("close", () => failAll(new Error("socket closed before reply")));
  return {
    write: (s) => sock.write(s),
    next(ms) {
      return new Promise((resolve, reject) => {
        const w = { resolve, reject, timer: null };
        w.timer = setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error("read line timeout"));
        }, ms || timeoutMs || 4000);
        waiters.push(w);
        if (buf.indexOf("\n") >= 0) onData(Buffer.alloc(0));
      });
    },
    close() {
      sock.removeListener("data", onData);
      failAll(new Error("reader closed"));
      try { sock.destroy(); } catch (_) {}
    },
  };
}

function connect(host, port, ms) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, host);
    const t = setTimeout(() => { s.destroy(); reject(new Error("tcp connect timeout")); }, ms || 4000);
    s.once("connect", () => { clearTimeout(t); resolve(s); });
    s.once("error", (e) => { clearTimeout(t); reject(e); });
  });
}

/** 真握手：写完若干控制行，按顺序读回若干应答行。 */
async function handshake(host, port, writes, expected, ms) {
  let sock;
  try {
    sock = await connect(host, port, ms);
  } catch (e) {
    return { ok: false, got: "(connect) " + e.message };
  }
  const r = socketLines(sock, ms);
  try {
    for (const w of writes) r.write(w);
    const got = [];
    for (let i = 0; i < expected.length; i++) got.push(await r.next(ms));
    const ok = expected.every((e, i) => got[i] === e);
    return { ok, got: got.join(" / ") };
  } catch (e) {
    return { ok: false, got: "(reply) " + e.message };
  } finally {
    r.close();
  }
}

/** 桌面入站真 HTTP 探活（不是只连端口）。 */
function probeInbound(port, ms) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/v1/pair/discover", agent: false },
      (res) => {
        res.resume();
        resolve({ ok: res.statusCode === 200, got: "HTTP/1.1 " + res.statusCode });
      },
    );
    req.setTimeout(ms || 4000, () => { req.destroy(); resolve({ ok: false, got: "http timeout" }); });
    req.on("error", (e) => resolve({ ok: false, got: e.message }));
  });
}

async function runReadiness(opts) {
  const lines = [];
  let PASS = 0;
  let FAIL = 0;
  const ok = (id, m) => { PASS++; lines.push("  ✓ " + id + " " + m); };
  const bad = (id, m, d) => { FAIL++; lines.push("  ✗ " + id + " " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

  const cfgPath = opts.config || CONFIG_MOD.defaultRelayConfigPath(REPO);
  const secret = opts.secret || process.env.BITBOT_RELAY_SECRET || "";
  const inboundPort = Number(opts.inboundPort || process.env.BITBOT_INBOUND_PORT || 18765);

  /* RD-01 配置文件在、是合法 JSON —— 后面的断言都建立在它上面。 */
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    ok("RD-01", "配置文件存在且 JSON 合法（" + cfgPath + "）");
  } catch (e) {
    bad("RD-01", "配置文件读不出来 / 不是合法 JSON", e.message);
  }

  /* RD-02 归一认得（五栏齐）+ 必须是 reverse —— 真 NAT 场景 dial 拨不进去。 */
  let cfg = null;
  {
    cfg = raw ? CONFIG_MOD.normalizeRelayConfig(raw) : null;
    if (!cfg) {
      bad("RD-02", "配置半套 / 非法，loadRelayConfig 一律当没配", cfgPath);
    } else if (cfg.mode !== "reverse") {
      bad("RD-02", "mode 不是 reverse（真 NAT 下 relay 拨不进盒子）", "mode=" + cfg.mode);
    } else {
      ok("RD-02", "五栏齐且 mode=reverse（box=" + cfg.boxId + "）");
    }
  }

  /* RD-03 两把钥匙角色正确、不能混、且能用同一个 secret 验签。 */
  if (!secret) {
    bad("RD-03", "没给 BITBOT_RELAY_SECRET（无法验证钥匙是不是这台 relay 认的）");
  } else if (!cfg) {
    bad("RD-03", "配置没读出来，钥匙无从验起");
  } else {
    const b = KEYS.verifyRelayCredential(secret, cfg.boxToken);
    const c = KEYS.verifyRelayCredential(secret, cfg.clientToken);
    if (!b.ok || !c.ok) {
      bad("RD-03", "钥匙验签不过（secret 和 relay 那台不一致 / 字段写错）", "box=" + b.ok + " client=" + c.ok);
    } else if (b.role !== "box" || c.role !== "client") {
      bad("RD-03", "两把钥匙角色不对（手机会拿到桌面的登记权）", "box=" + b.role + " client=" + c.role);
    } else if (cfg.boxToken === cfg.clientToken) {
      bad("RD-03", "两把钥匙是同一把");
    } else {
      ok("RD-03", "box_token=box / client_token=client，两把不同且与 secret 一致");
    }
  }

  /* RD-04 下发给手机的必须正好四栏 —— 拓扑字段和 box_token 都不许外泄。 */
  {
    const h = cfg ? CONFIG_MOD.toHandoff(cfg) : null;
    const keys = Object.keys(h || {}).sort().join(",");
    if (keys !== "box_id,client_token,host,port") {
      bad("RD-04", "toHandoff 不是正好四栏", keys || "(空)");
    } else if (JSON.stringify(h).includes(cfg.boxToken)) {
      bad("RD-04", "四栏里夹带了 box_token");
    } else {
      ok("RD-04", "回执四栏 = host/port/box_id/client_token，不含 box_token / mode");
    }
  }

  const host = cfg ? cfg.host : null;
  const port = cfg ? cfg.port : null;

  /* RD-05 relay 控制端口真连得上（不是 ping、不是静态配置）。 */
  if (!host || !port) {
    bad("RD-05", "没有 relay 地址，跳过不了 —— 记红");
  } else {
    try {
      const s = await connect(host, port, 4000);
      s.destroy();
      ok("RD-05", "relay 控制端口 " + host + ":" + port + " TCP 可达");
    } catch (e) {
      bad("RD-05", "relay 控制端口连不上（查 BITBOT_RELAY_BIND=0.0.0.0 / 安全组 / 端口映射）", e.message);
    }
  }

  /* RD-06 client_token 真 AUTH —— 证 secret 与 relay 一致，且手机那把钥匙能用。 */
  if (!host || !port || !cfg) {
    bad("RD-06", "前置不成立，无法做真握手");
  } else {
    const r = await handshake(host, port, ["AUTH " + cfg.clientToken + "\n"], ["OK"], 4000);
    if (r.ok) ok("RD-06", "client_token 真 AUTH → OK（relay 认得这把钥匙）");
    else bad("RD-06", "client_token 真 AUTH 失败", r.got);
  }

  /* RD-07 box_token 真 BIND —— 用完立刻断，relay 会自行清表，不留幽灵盒子。 */
  if (!host || !port || !cfg) {
    bad("RD-07", "前置不成立，无法做真握手");
  } else {
    const probeId = "readiness-probe-" + Date.now().toString(36);
    const r = await handshake(
      host, port,
      ["AUTH " + cfg.boxToken + "\nBIND " + probeId + "\n"],
      ["OK", "BOUND " + probeId], 4000,
    );
    if (r.ok) ok("RD-07", "box_token 真 BIND → BOUND（探针盒子已断开，registry 自动清）");
    else bad("RD-07", "box_token 真 BIND 失败（桌面登记会拿不到 BOUND）", r.got);
  }

  /* RD-08 桌面入站真在接待 —— 只连端口不算，要 /v1/pair/discover 回 200。 */
  {
    const r = await probeInbound(inboundPort, 4000);
    if (r.ok) ok("RD-08", "桌面入站 127.0.0.1:" + inboundPort + " /v1/pair/discover → 200 OK");
    else bad("RD-08", "桌面入站没在接待（把 Bit Bot 桌面 app 打开、点「允许手机连接」）", r.got);
  }

  lines.push("readiness: PASS=" + PASS + " FAIL=" + FAIL);
  if (FAIL) {
    lines.push("不要开始：先把上面标红的补齐，再跑 §2.5。半套配置在手机上只长成「连不上」，查不出原因。");
  } else {
    lines.push("可以开始：同一 Wi-Fi 先配对 → 关 Wi-Fi 切蜂窝 → 状态条应显示「中转 · Nms」。");
    lines.push("现场记得看 relay 审计里有没有 accept/attach/close，且查无 token 与请求正文。");
  }
  return { pass: PASS, fail: FAIL, lines };
}

/* ────────────────────────── --self-test：用真 relay 自证自检工具 ────────────────────────── */

async function selfTest() {
  const secret = "readiness-self-test-secret";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-readiness-"));
  const cfgPath = path.join(tmp, "relay.json");
  const boxToken = KEYS.issueRelayCredential(secret, "desktop-selftest", "box");
  const clientToken = KEYS.issueRelayCredential(secret, "phone-selftest", "client");
  const wrongToken = KEYS.issueRelayCredential("another-secret", "phone-selftest", "client");
  const wrongBox = KEYS.issueRelayCredential("another-secret", "desktop-selftest", "box");

  const relay = RELAY_MOD.createRelayServer({ relaySecret: secret, bindHost: "127.0.0.1" });
  const relayInfo = await relay.start();
  const inbound = http.createServer((_req, res) => { res.writeHead(200); res.end("{}"); });
  await new Promise((resolve) => inbound.listen(0, "127.0.0.1", resolve));
  const inboundPort = inbound.address().port;

  const full = {
    host: "127.0.0.1", port: relayInfo.controlPort,
    box_id: "desktop-selftest", box_token: boxToken, client_token: clientToken,
    mode: "reverse",
  };
  const writeCfg = (obj) => fs.writeFileSync(cfgPath, JSON.stringify(obj));
  // 必须**异步** spawn：relay 与假桌面入站都跑在本进程的事件循环里，
  // 用 spawnSync 会把父进程整个阻塞，TCP 握手能由内核完成、应用层却永远没人应答
  // （首跑 RD-06/07/08 全 timeout 就是这个，不是产品也不是门的问题）。
  const run = (extra) => new Promise((resolve) => {
    const args = [
      __filename, "--config", cfgPath, "--secret", secret,
      "--inbound-port", String(extra && extra.inboundPort ? extra.inboundPort : inboundPort),
    ];
    const child = spawn(process.execPath, args);
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d) => { out += d.toString("utf8"); });
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_) {} }, 30000);
    child.on("close", (code) => { clearTimeout(t); resolve({ code, out }); });
  });

  let PASS = 0;
  let FAIL = 0;
  const cases = [
    ["ST-01 完整配置 → 自检全绿（正控）", () => writeCfg(full), (r) => r.code === 0 && /PASS=8 FAIL=0/.test(r.out), "自检在不该绿的时候绿了 / 该绿没绿"],
    ["ST-02 去掉 mode → RD-02 红", () => { const c = { ...full }; delete c.mode; writeCfg(c); }, (r) => r.code === 1 && /✗ RD-02/.test(r.out), "mode 缺失没被抓到"],
    ["ST-03 两把钥匙混成一把 → RD-03 红", () => writeCfg({ ...full, client_token: boxToken }), (r) => r.code === 1 && /✗ RD-03/.test(r.out), "钥匙混用没被抓到"],
    ["ST-04 半套配置 → RD-02 红", () => { const c = { ...full }; delete c.client_token; writeCfg(c); }, (r) => r.code === 1 && /✗ RD-02/.test(r.out), "半套配置被当成了完整配置"],
    ["ST-05 client_token 不是这台 relay 的 → RD-06 红", () => writeCfg({ ...full, client_token: wrongToken }), (r) => r.code === 1 && /✗ RD-06/.test(r.out), "错 client 钥匙没被真握手抓到"],
    ["ST-06 box_token 不是这台 relay 的 → RD-07 红", () => writeCfg({ ...full, box_token: wrongBox }), (r) => r.code === 1 && /✗ RD-07/.test(r.out), "错 box 钥匙没被真 BIND 抓到"],
    ["ST-07 relay 端口没监听 → RD-05 红", () => writeCfg({ ...full, port: 1 }), (r) => r.code === 1 && /✗ RD-05/.test(r.out), "relay 连不上却报了绿"],
    ["ST-08 桌面入站没起 → RD-08 红", () => { writeCfg(full); return { inboundPort: 1 }; }, (r) => r.code === 1 && /✗ RD-08/.test(r.out), "桌面没在接待却报了绿"],
  ];

  console.log("== --self-test：用真 relay + 临时配置自证自检工具（不依赖外网/真机） ==");
  try {
    for (const [label, setup, expect, why] of cases) {
      const extra = setup();
      const r = await run(extra);
      if (expect(r)) {
        PASS++;
        console.log("  ✓ " + label);
      } else {
        FAIL++;
        console.log("  ✗ " + label + " — " + why + "；exit=" + r.code + "；" + r.out.trim().slice(-260).replace(/\n/g, " | "));
      }
    }
  } finally {
    await relay.stop();
    await new Promise((resolve) => inbound.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log("self-test: PASS=" + PASS + " FAIL=" + FAIL);
  console.log(FAIL ? "自检工具本身不可信，别拿它验真机。" : "自检工具可信；但 §5 的真公网 + 真 NAT + 蜂窝网十条仍需人工逐条打勾。");
  process.exit(FAIL ? 1 : 0);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) return selfTest();
  console.log("== 真机验收前自检（A3-10 / R-A3-8a；只证「可以开工」，不证跨网可用） ==");
  const r = await runReadiness(opts);
  for (const l of r.lines) console.log(l);
  process.exit(r.fail ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 自检工具自身异常：" + ((e && e.stack) || e));
  console.log("readiness: PASS=0 FAIL=1");
  process.exit(1);
});
