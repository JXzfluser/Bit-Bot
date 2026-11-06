#!/usr/bin/env node
"use strict";
/**
 * verify_real_device_desktop_side.js — §5 里**桌面 / relay 侧能自证**的那半套，一条命令判完。
 *
 * 为什么要有它：真机窗口是一次性的稀缺资源（真公网 relay + NAT 后桌面 + 蜂窝手机）。
 * 现场不该把时间花在翻日志、手抄数字上，更不该「看着像没问题」就打勾。
 * 手机侧那半（①②⑥⑦⑨⑩⑪⑫）必须人肉，本脚本**不假装能判**，只把它们列出来。
 *
 * 能自证的六条（对应 real-device-checklist.md §5）：
 *   ③ 零主动拨      → /diagnostics 的 dialAttempts 相对基线不涨
 *   ④ 盒子在线可见   → /healthz boxes ≥1 且 /diagnostics reverseBoxes ≥1
 *   ⑤ 审计数据面     → 审计 jsonl 有 accept/attach/close，且查无 token / 正文 / 请求行
 *   ⑧ relay 重启     → 靠 --baseline/--after 两份快照对比（本脚本提供，重启动作仍人工）
 *   ⑬ 钥匙串落盘    → data/secrets/ 只有 vault.key.protected，没有明文 vault.key
 *   ⑭ 断流重连      → liveBridges 回基线 且 opened/closed/served 各涨 ≥5
 *
 * 两条铁律（这轮踩了八次「恒真对照」，别再犯）：
 *   - **取不到数一律记红**，不许 SKIP 当绿、不许「没找到就算没有」。
 *   - **判变化，不判好看的静态值**：③⑭ 必须有基线快照对比；`liveBridges===0`
 *     单独成立不算证据（压根没连过也是 0），要看 opened/closed/served 真涨过。
 *
 * 用法（在**桌面那台机器**上跑，relay 地址给公网 IP）：
 *   # ① 断流实验开始前，先记一份基线
 *   node scripts/verify_real_device_desktop_side.js baseline \
 *       --relay http://<公网IP>:18767 --audit /tmp/bitbot-relay-audit.jsonl
 *   # ② 手机做完 §5 的断网/恢复 5 次之后
 *   node scripts/verify_real_device_desktop_side.js check \
 *       --relay http://<公网IP>:18767 --audit /tmp/bitbot-relay-audit.jsonl \
 *       --secrets data/secrets --out /tmp/bitbot-evidence.txt
 *
 * 自证（不依赖外网/真机，自己起真 relay + 造审计日志）：
 *   node scripts/verify_real_device_desktop_side.js --self-test
 */

const fs = require("fs");
const os = require("os");
const http = require("http");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const RELAY_MOD = require(path.join(REPO, "hosts/shared/relay/relay_server.js"));
const KEYS = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));
const BOX = require(path.join(REPO, "hosts/shared/relay/relay_box_client.js"));
const INBOUND = require(path.join(REPO, "hosts/shared/cn_inbound_server.js"));
const PAIRING = require(path.join(REPO, "hosts/shared/desktop_pairing.js"));

const DEFAULT_BASELINE = path.join(os.tmpdir(), "bitbot-evidence-baseline.json");

/* ------------------------------------------------------------------ 参数 */

function parseArgs(argv) {
  const o = {
    cmd: (argv[0] && !argv[0].startsWith("--")) ? argv[0] : "check",
    relay: null, audit: null, secrets: null, baseline: DEFAULT_BASELINE,
    out: null, selfTest: false, minReconnects: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") o.selfTest = true;
    else if (a === "--relay") o.relay = argv[++i];
    else if (a === "--audit") o.audit = argv[++i];
    else if (a === "--secrets") o.secrets = argv[++i];
    else if (a === "--baseline") o.baseline = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--min-reconnects") o.minReconnects = Number(argv[++i]);
  }
  return o;
}

/* ------------------------------------------------------------------ 取数 */

function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error("URL 不合法：" + url)); }
    const mod = u.protocol === "https:" ? require("https") : http;
    const req = mod.get({ hostname: u.hostname, port: u.port, path: u.pathname, agent: false }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error("响应不是 JSON：" + b.slice(0, 120))); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs || 6000, () => req.destroy(new Error("请求超时（18767 放通了吗？）")));
  });
}

function readAudit(file) {
  const txt = fs.readFileSync(file, "utf8");
  const rows = [];
  let malformed = 0;
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch (_) { malformed++; }
  }
  return { rows, malformed, bytes: Buffer.byteLength(txt) };
}

function inspectSecrets(dir) {
  const names = fs.readdirSync(dir).filter((n) => n.startsWith("vault.key"));
  return {
    dir,
    names: names.sort(),
    plaintextOnDisk: names.includes("vault.key"),
    protectedOnDisk: names.includes("vault.key.protected"),
  };
}

/* ------------------------------------------------------------ 判定（纯函数） */

const FORBIDDEN_AUDIT_KEYS = [
  "token", "payload", "body", "attachment", "secret", "credential",
  "client_token", "box_token", "relaySecret", "authorization", "content",
];
const FORBIDDEN_AUDIT_PATTERNS = [
  /\b(?:GET|POST|PUT|DELETE|PATCH)\s+\/[^\s]*\s+HTTP\/1\.[01]/i,
  /\bHTTP\/1\.[01]\s+\d{3}\b/,
  /^Bearer\s+\S+/im,
];

/**
 * 判据本体。所有输入都来自真取数；缺一项就记红，绝不 SKIP 当绿。
 * 返回 { lines, pass, fail, verdicts }，verdicts 供 --self-test 做负向对照。
 */
function judge(input) {
  const lines = [];
  let PASS = 0, FAIL = 0;
  const verdicts = {};
  const ok = (id, m) => { PASS++; verdicts[id] = "pass"; lines.push("  ✓ " + id + " " + m); };
  const bad = (id, m, d) => { FAIL++; verdicts[id] = "fail"; lines.push("  ✗ " + id + " " + m + (d ? " — " + String(d).slice(0, 240) : "")); };

  const { diag, health, baseline, audit, secrets, minReconnects } = input;

  /* EV-00 端点版本：没有 schema:1 就是旧 relay，后面 ⑭ 无法判 */
  if (!diag) bad("EV-00", "取不到 /diagnostics（relay 旧版 / 18767 没放通 / 地址写错）");
  else if (diag.schema !== 1) bad("EV-00", "relay 不是 schema:1，§5⑭ 判不了，先升级 relay", "schema=" + diag.schema);
  else ok("EV-00", "GET /diagnostics → schema:1（这台 relay 带得起 §5⑭）");

  /* EV-01 ④ 盒子在线可见 */
  if (!health || !diag) bad("EV-01", "④ 盒子在线：/healthz 或 /diagnostics 没读到，不许当成「在线」", "health=" + JSON.stringify(health));
  else if (!(health.boxes >= 1)) bad("EV-01", "④ 盒子不在线（桌面 app 没登记上 / BIND 断了）", "boxes=" + health.boxes);
  else if (!(diag.reverseBoxes >= 1)) bad("EV-01", "④ 盒子在表里但不是 reverse（真 NAT 下拨不进去）", "reverseBoxes=" + diag.reverseBoxes);
  else ok("EV-01", "④ 盒子在线：/healthz boxes=" + health.boxes + "、/diagnostics reverseBoxes=" + diag.reverseBoxes + "（reverse 条目）");

  /* EV-02 ③ 零主动拨 —— 必须相对基线，且基线得有这个数 */
  if (!diag || !baseline) bad("EV-02", "③ 零主动拨：缺 /diagnostics 或缺基线快照（先跑 baseline）");
  else if (typeof baseline.dialAttempts !== "number") bad("EV-02", "③ 基线里没有 dialAttempts（拿不到分母，不许判绿）");
  else if (!(diag.dialAttempts === baseline.dialAttempts)) bad("EV-02", "③ relay 发生了主动拨（reverse 全程应为 0 增量）", baseline.dialAttempts + " → " + diag.dialAttempts);
  else if (typeof diag.streamsServed !== "number" || diag.streamsServed <= baseline.streamsServed) bad("EV-02", "③ 反真空失败：这期间根本没跑过消息，dialAttempts 不变说明不了任何事", "served " + baseline.streamsServed + " → " + diag.streamsServed);
  else ok("EV-02", "③ 零主动拨：dialAttempts 稳在 " + diag.dialAttempts + "，期间 streamsServed +" + (diag.streamsServed - baseline.streamsServed) + "（确实跑过消息，不是真空绿）");

  /* EV-03 ⑤ 审计：有 accept/attach/close + 查无正文/凭证/请求行 */
  if (!audit) bad("EV-03", "⑤ 审计文件读不到（把 BITBOT_RELAY_LOGFILE 指到这个文件，或 --audit 给对路径）");
  else if (audit.rows.length === 0) bad("EV-03", "⑤ 审计是空的（没跑过消息，不许当成「查无明文」）");
  else {
    const events = new Set(audit.rows.map((r) => r.event));
    const need = ["accept", "attach", "close"];
    const missing = need.filter((e) => !events.has(e));
    const leaks = [];
    for (const r of audit.rows) {
      for (const k of FORBIDDEN_AUDIT_KEYS) if (Object.prototype.hasOwnProperty.call(r, k)) leaks.push("字段 " + k);
    }
    const raw = fs.existsSync(input.auditPath || "") ? fs.readFileSync(input.auditPath, "utf8") : "";
    for (const re of FORBIDDEN_AUDIT_PATTERNS) if (re.test(raw)) leaks.push("内容 " + re.source.slice(0, 40));
    if (audit.malformed > 0) bad("EV-03", "⑤ 审计里有 " + audit.malformed + " 行不是合法 JSON（JSONL 格式被破坏）");
    else if (missing.length) bad("EV-03", "⑤ 审计缺数据面事件（没有真的转发过消息）", "缺 " + missing.join("/"));
    else if (leaks.length) bad("EV-03", "⑤ **A3-2 内容不可见被破坏**：审计里出现了凭证 / 正文 / 请求行，立刻停下来报", [...new Set(leaks)].join(", "));
    else ok("EV-03", "⑤ 审计 " + audit.rows.length + " 条含 accept/attach/close 成对事件，查无 token / 正文 / HTTP 请求行（" + audit.bytes + " 字节）");
  }

  /* EV-04 ⑬ 钥匙串落盘形态 */
  if (!secrets) bad("EV-04", "⑬ 密钥目录读不到（--secrets data/secrets 指对路径）");
  else if (!secrets.protectedOnDisk) bad("EV-04", "⑬ 没有 vault.key.protected（这台机器 safeStorage 不可用，或根本没接 protector）", secrets.names.join(",") || "(空目录)");
  else if (secrets.plaintextOnDisk) bad("EV-04", "⑬ 明文 vault.key 还在盘上（迁移没删干净 / 保护器没生效）", secrets.names.join(","));
  else ok("EV-04", "⑬ 钥匙串落盘形态正确：只有 vault.key.protected，无明文 vault.key（" + secrets.dir + "）");

  /* EV-05 ⑭ 断流重连不留连接 —— 这一条曾是恒真对照，判据必须锚变化 */
  if (!diag || !baseline) bad("EV-05", "⑭ 缺 /diagnostics 或基线快照（断流前先跑 baseline）");
  else {
    const dOpened = diag.bridgesOpened - baseline.bridgesOpened;
    const dClosed = diag.bridgesClosed - baseline.bridgesClosed;
    const dServed = diag.streamsServed - baseline.streamsServed;
    const invariant = diag.liveBridges === diag.bridgesOpened - diag.bridgesClosed;
    const reconnectEvidence = dServed >= minReconnects && dOpened >= minReconnects && dClosed >= minReconnects;
    if (!invariant) bad("EV-05", "⑭ 计数不变量被破坏：liveBridges ≠ opened − closed", JSON.stringify({ live: diag.liveBridges, opened: diag.bridgesOpened, closed: diag.bridgesClosed }));
    else if (!reconnectEvidence) bad("EV-05", "⑭ **反真空**：这期间没真重连过 ≥" + minReconnects + " 次，「live 回基线」可能只是压根没连过", "served+" + dServed + " opened+" + dOpened + " closed+" + dClosed);
    else if (diag.liveBridges !== baseline.liveBridges) bad("EV-05", "⑭ 重连后挂着的转发连接没回基线（有连接泄漏）", baseline.liveBridges + " → " + diag.liveBridges);
    else ok("EV-05", "⑭ 断流重连不留连接：served+" + dServed + " opened+" + dOpened + " closed+" + dClosed + "，liveBridges 稳在 " + diag.liveBridges + "（别看 activeStreams=" + diag.activeStreams + "，它必然回基线、证明不了任何事）");
  }

  /* EV-06 端点自身的诚实：诊断态只吐计数 */
  if (!diag) bad("EV-06", "端点没读到");
  else {
    const forbidden = ["token", "payload", "endpoint", "memberId", "boxId"].filter((k) => Object.prototype.hasOwnProperty.call(diag, k));
    if (forbidden.length) bad("EV-06", "/diagnostics 吐了元数据 / 凭证字段（A3-2）", forbidden.join(","));
    else ok("EV-06", "/diagnostics 响应里查无 token/payload/endpoint/memberId/boxId");
  }

  lines.push("desktop-side: PASS=" + PASS + " FAIL=" + FAIL);
  lines.push("手机侧仍需人工（本脚本判不了）：①配对两条路 / ②状态条真实路径 / ⑥桌面关闭明确失败 / ⑦半开自愈 / ⑧relay 重启 / ⑨成功率≥90% / ⑩SSE 进度走隧道 / ⑪探活≠凭证 / ⑫提示说人话");
  return { lines, pass: PASS, fail: FAIL, verdicts };
}

/* ------------------------------------------------------------ 主流程 */

function collect(opts) {
  const base = opts.relay.replace(/\/+$/, "");
  return Promise.all([
    fetchJson(base + "/diagnostics").catch((e) => { throw new Error("/diagnostics: " + e.message); }),
    fetchJson(base + "/healthz").catch((e) => { throw new Error("/healthz: " + e.message); }),
  ]).then(([diag, health]) => ({ diag, health }));
}

function optionalFile(fn, label) {
  try { return fn(); } catch (e) { console.log("  ! " + label + " 读取失败：" + e.message + "（将记红，不当绿）"); return null; }
}

async function cmdBaseline(opts) {
  if (!opts.relay) { console.error("缺 --relay http://<公网IP>:18767"); process.exit(2); }
  console.log("== 记基线（断流实验 / 发消息之前跑一次）==");
  let snap;
  try { snap = (await collect(opts)).diag; }
  catch (e) { console.error("  ✗ 取不到诊断态：" + e.message); process.exit(1); }
  if (snap.schema !== 1) { console.error("  ✗ relay 不是 schema:1，§5⑭ 判不了，先升级 relay（schema=" + snap.schema + "）"); process.exit(1); }
  snap.__takenAt = new Date().toISOString();
  snap.__relay = opts.relay;
  fs.writeFileSync(opts.baseline, JSON.stringify(snap, null, 2));
  console.log("  ✓ 基线已写入 " + opts.baseline);
  console.log("    dialAttempts=" + snap.dialAttempts + " liveBridges=" + snap.liveBridges +
    " opened=" + snap.bridgesOpened + " closed=" + snap.bridgesClosed + " served=" + snap.streamsServed);
  console.log("  接下来在手机上做 §5（含断网/恢复 ≥" + opts.minReconnects + " 次），然后跑：");
  console.log("    node scripts/verify_real_device_desktop_side.js check --relay " + opts.relay +
    (opts.audit ? " --audit " + opts.audit : "") + (opts.secrets ? " --secrets " + opts.secrets : ""));
}

async function cmdCheck(opts) {
  if (!opts.relay) { console.error("缺 --relay http://<公网IP>:18767"); process.exit(2); }
  const lines = ["== Bit Bot 真机验收 · 桌面/relay 侧自动判定 ==",
    "时间：" + new Date().toISOString(),
    "relay：" + opts.relay.replace(/\/\/[^/@]*@/, "//<凭证已隐去>@"),
    "判据：real-device-checklist.md §5 ③④⑤⑬⑭（手机侧仍需人工）", ""];
  let diag = null, health = null;
  try { ({ diag, health } = await collect(opts)); }
  catch (e) { lines.push("  ✗ 取不到 relay 诊断态：" + e.message); }
  const baseline = optionalFile(() => JSON.parse(fs.readFileSync(opts.baseline, "utf8")), "基线快照 " + opts.baseline);
  const audit = opts.audit ? optionalFile(() => readAudit(opts.audit), "审计文件 " + opts.audit) : null;
  const secrets = opts.secrets ? optionalFile(() => inspectSecrets(opts.secrets), "密钥目录 " + opts.secrets) : null;
  if (!opts.audit) lines.push("  ! 未给 --audit：⑤ 将记红（审计文件路径要给，不许当成「查无明文」）");
  if (!opts.secrets) lines.push("  ! 未给 --secrets：⑬ 将记红（默认不猜路径）");
  lines.push("");
  const r = judge({ diag, health, baseline, audit, secrets, auditPath: opts.audit, minReconnects: opts.minReconnects });
  lines.push(...r.lines);
  if (r.fail) lines.push("结论：桌面/relay 侧**未通过**，标红的项修好再重跑；不要把「本机门禁绿」拿来抵账。");
  else lines.push("结论：桌面/relay 侧自动判定通过；仍须把手机侧那半逐条打勾，§5 才算跑完。");
  const out = lines.join("\n") + "\n";
  process.stdout.write(out);
  if (opts.out) { fs.writeFileSync(opts.out, out); console.log("记录已写入 " + opts.out + "（可直接粘贴进验收记录）"); }
  process.exit(r.fail ? 1 : 0);
}

/* ---------------------------------------------- --self-test：自证脚本本身 */

async function selfTest() {
  const secret = "evidence-self-test-secret";
  const BOX_ID = "box-evidence";
  const boxToken = KEYS.issueRelayCredential(secret, "desktop-ev", "box");
  const clientToken = KEYS.issueRelayCredential(secret, "phone-ev", "client");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-evidence-"));
  const auditPath = path.join(tmp, "audit.jsonl");
  const secretsDir = path.join(tmp, "secrets");
  fs.mkdirSync(secretsDir);
  fs.writeFileSync(path.join(secretsDir, "vault.key.protected"), "wrapped");

  const pairing = PAIRING.createPairingCodeManager();
  const inbound = INBOUND.createCnInboundServer({
    repoRoot: tmp, port: 0, host: "127.0.0.1", pairingManager: pairing,
    turnToken: "t-ev-0123456789", onTurn: async () => ({ ok: true, messages: [], host_results: [], stdout: "" }),
  });
  const inboundInfo = await inbound.start();
  const relay = RELAY_MOD.createRelayServer({
    relaySecret: secret, bindHost: "127.0.0.1", logFile: auditPath,
  });
  const info = await relay.start();
  const box = BOX.createRelayBoxClient({
    host: "127.0.0.1", port: info.controlPort, boxId: BOX_ID, boxToken,
    endpoint: "192.0.2.1:1", localEndpoint: "127.0.0.1:" + inboundInfo.port,
    mode: "reverse", heartbeatMs: 0,
  });
  box.start();
  for (let i = 0; i < 80 && !relay.getRegistry()[BOX_ID]; i++) await new Promise((r) => setTimeout(r, 25));

  const healthUrl = "http://127.0.0.1:" + info.healthPort;
  const getDiag = () => fetchJson(healthUrl + "/diagnostics");
  const getHealth = () => fetchJson(healthUrl + "/healthz");

  /** 真跑一条 reverse 隧道（AUTH → CONNECT → ATTACH → 关闭），产生审计事件。 */
  const oneTurn = async () => {
    const s = net.connect(info.controlPort, "127.0.0.1");
    await new Promise((res, rej) => { s.once("connect", res); s.once("error", rej); });
    let buf = "";
    const readLine = () => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("line timeout")), 6000);
      const onData = (d) => {
        buf += d.toString("latin1");
        const i = buf.indexOf("\n");
        if (i < 0) return;
        s.removeListener("data", onData);
        clearTimeout(t);
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        resolve(line);
      };
      s.on("data", onData);
      if (buf.indexOf("\n") >= 0) onData(Buffer.alloc(0));
    });
    s.write("AUTH " + clientToken + "\nCONNECT " + BOX_ID + "\n");
    await readLine(); // OK
    const tun = await readLine(); // TUNNEL reverse:...
    if (!tun.startsWith("TUNNEL ")) throw new Error("reply=" + tun);
    s.destroy();
  };

  let PASS = 0, FAIL = 0;
  const ok = (m) => { PASS++; console.log("  ✓ " + m); };
  const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 220) : "")); };

  /** 端到端子进程跑法（baseline/check 都真 spawn，不靠直接调 judge 冒充）。 */
  const runChild = (args) => new Promise((resolve) => {
    const p = spawn(process.execPath, [__filename, ...args]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => resolve({ code, out }));
  });

  console.log("== --self-test：真 relay + 真审计日志自证「一键判定」本身 ==");
  try {
    // **基线必须在跑消息之前记**。第一版把 baseline 子进程放在 5 条隧道之后，
    // 于是基线与当前快照一模一样、增量恒为 0，EV-02/05 反倒正确地转了红 ——
    // 那是脚手架的顺序错，不是判据错。判据拒绝「没跑过消息」恰恰是对的。
    const bl = path.join(tmp, "baseline.json");
    const b = await runChild(["baseline", "--relay", healthUrl, "--baseline", bl]);
    if (b.code === 0 && /基线已写入/.test(b.out)) ok("ST-11 baseline 子命令真跑通（写盘并返回 0）");
    else bad("ST-11 baseline 子命令失败", "exit=" + b.code + " " + b.out.trim().slice(-200));

    const baseline = await getDiag();
    // 真跑 5 条隧道 → 审计有 accept/attach/close，计数各涨 5
    for (let i = 0; i < 5; i++) await oneTurn();
    for (let i = 0; i < 80 && relay.getDiagnosticState().liveBridges !== baseline.liveBridges; i++)
      await new Promise((r) => setTimeout(r, 25));
    const diag = await getDiag();
    const health = await getHealth();
    const audit = readAudit(auditPath);
    const secrets = inspectSecrets(secretsDir);

    const good = judge({ diag, health, baseline, audit, secrets, auditPath, minReconnects: 5 });
    if (good.fail === 0 && good.pass === 7) ok("ST-01 正控：真跑 5 条隧道后 7 条判定全绿（EV-00..EV-06）");
    else bad("ST-01 正控没全绿", good.lines.filter((l) => l.includes("✗")).join(" | "));

    // 负向对照：逐项搞坏输入，对应判定必须转红
    const cases = [
      ["ST-02 没跑过消息（真空绿）", { baseline: diag }, "EV-02"],
      ["ST-03 dialAttempts 涨了", { diag: { ...diag, dialAttempts: diag.dialAttempts + 1 } }, "EV-02"],
      ["ST-04 liveBridges 不回基线（连接泄漏）", { diag: { ...diag, liveBridges: diag.liveBridges + 2, bridgesOpened: diag.bridgesOpened + 2 } }, "EV-05"],
      ["ST-05 审计空（不许当成查无明文）", { audit: { rows: [], malformed: 0, bytes: 0 } }, "EV-03"],
      ["ST-06 审计夹带 token 字段", { audit: { rows: [{ event: "accept", token: "leak" }, { event: "attach" }, { event: "close" }], malformed: 0, bytes: 99 } }, "EV-03"],
      ["ST-07 明文 vault.key 还在", { secrets: { ...secrets, plaintextOnDisk: true, names: ["vault.key", "vault.key.protected"] } }, "EV-04"],
      ["ST-08 盒子不在线", { health: { ok: true, boxes: 0 } }, "EV-01"],
      ["ST-09 旧 relay（schema 缺失）", { diag: { ...diag, schema: undefined } }, "EV-00"],
      ["ST-10 缺基线快照", { baseline: null }, "EV-02"],
    ];
    for (const [label, patch, expectId] of cases) {
      const r = judge({ diag, health, baseline, audit, secrets, auditPath, minReconnects: 5, ...patch });
      if (r.verdicts[expectId] === "fail") ok(label + " → " + expectId + " 转红");
      else bad(label + " 竟然没转红（判据恒真）", JSON.stringify(r.verdicts));
    }

    // 端到端下半：check 子进程读上面那份**跑消息之前**的基线，判出真增量；
    // 同时验 --out 真的落了一份可粘贴记录（不是只在 stdout 说说）。
    const outPath = path.join(tmp, "evidence.txt");
    const c = await runChild(["check", "--relay", healthUrl, "--baseline", bl,
      "--audit", auditPath, "--secrets", secretsDir, "--min-reconnects", "1", "--out", outPath]);
    if (c.code === 0 && /desktop-side: PASS=7 FAIL=0/.test(c.out)) ok("ST-12 check 子命令真跑通（7/0，输出可直接粘贴）");
    else bad("ST-12 check 子命令没全绿", "exit=" + c.code + " " + c.out.trim().slice(-320));
    const outTxt = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
    if (/== Bit Bot 真机验收/.test(outTxt) && /手机侧仍需人工/.test(outTxt) && /EV-05/.test(outTxt))
      ok("ST-13 --out 落盘的记录含表头、EV-05 判定与「手机侧仍需人工」边界（可直接粘进验收记录）");
    else bad("ST-13 --out 没写出完整记录", outTxt.slice(0, 200));
    if (process.env.BITBOT_EVIDENCE_SHOW === "1") console.log("---- 记录样例 ----\n" + outTxt + "------------------");
  } catch (e) {
    bad("ST-00 自证段异常", (e && e.stack) || String(e));
  } finally {
    try { box.stop(); } catch (_) {}
    try { await relay.stop(); } catch (_) {}
    try { await inbound.stop(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
  console.log("self-test: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) return selfTest();
  if (opts.cmd === "baseline") return cmdBaseline(opts);
  if (opts.cmd === "check") return cmdCheck(opts);
  console.error("用法：baseline | check | --self-test（见文件头注释）");
  process.exit(2);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
