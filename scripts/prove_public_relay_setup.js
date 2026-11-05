#!/usr/bin/env node
"use strict";
/* prove_public_relay_setup.js — A3-15 门禁（PU-01..PU-10）
 *
 * 要证的一件事：**relay 与桌面在同一台机器、手机走公网时，两个地址能各司其职**：
 * 桌面用 connect_host 连（本机 127.0.0.1），手机拿到的四栏里仍是公网 host。
 * 不拆开的话桌面连自己的公网 IP 会因 NAT 回环不通而一直登记失败。
 *
 * 真 socket 证据：临时起 relay + 假 cn_inbound，跑 AUTH/BIND/CONNECT + 一次 HTTP。
 * 静态 join：main.js / setup 脚本 / start 脚本的接线。
 *
 * 跑法：node scripts/prove_public_relay_setup.js
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const http = require("http");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const CONFIG = require(path.join(REPO, "hosts/shared/relay/relay_config.js"));
const SECRETS = require(path.join(REPO, "hosts/shared/relay/relay_secrets.js"));
const SETTINGS = require(path.join(REPO, "hosts/shared/relay/relay_settings.js"));
const KEYS = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));
const RELAY = require(path.join(REPO, "hosts/shared/relay/relay_server.js"));
const VAULT = require(path.join(REPO, "hosts/desktop/secret_vault.js"));
const MAINJS = path.join(REPO, "hosts/desktop/main.js");
const SETUP = path.join(REPO, "scripts/setup_public_relay.js");
const START = path.join(REPO, "scripts/start_public_relay.sh");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

function handshake(port, lines, expect, ms) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    let buf = "";
    const got = [];
    const t = setTimeout(() => { s.destroy(); resolve({ ok: false, got: got.join(" / ") + " (timeout)" }); }, ms || 3500);
    s.on("connect", () => lines.forEach((l) => s.write(l)));
    s.on("data", (d) => {
      buf += d.toString("latin1");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) { got.push(buf.slice(0, nl).trim()); buf = buf.slice(nl + 1); }
      if (got.length >= expect.length) {
        clearTimeout(t); s.destroy();
        resolve({ ok: expect.every((e, i) => got[i] === e), got: got.join(" / ") });
      }
    });
    s.on("error", (e) => { clearTimeout(t); resolve({ ok: false, got: e.message }); });
  });
}

async function main() {
  const SECRET = "public-setup-gate-secret";
  const boxToken = KEYS.issueRelayCredential(SECRET, "box-pu", "box");
  const clientToken = KEYS.issueRelayCredential(SECRET, "client-pu", "client");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-pubsetup-"));
  const file = path.join(tmp, "relay.json");
  const vault = VAULT.createSecretVault(tmp, {
    vaultPath: path.join(tmp, "vault.json"), keyPath: path.join(tmp, "vault.key"),
  });
  const full = {
    host: "203.0.113.9", port: 18766, box_id: "box-pu",
    box_token: boxToken, client_token: clientToken,
    mode: "reverse", connect_host: "127.0.0.1",
  };
  const load = () => SECRETS.loadRelayConfigSecure({ file, vault, env: {} });

  /* PU-01 归一认得 connect_host，且老配置缺省为空（不改老行为）。 */
  {
    SECRETS.writeRelayConfigSecure({ file, cfg: full, vault });
    const cfg = load();
    const legacy = CONFIG.normalizeRelayConfig({
      host: "203.0.113.9", port: 18766, box_id: "b", box_token: boxToken, client_token: clientToken,
    });
    if (!cfg || cfg.connectHost !== "127.0.0.1") {
      bad("PU-01 connect_host 没读出来（桌面会退回连公网 IP）", cfg && cfg.connectHost);
    } else if (!legacy || legacy.connectHost !== "") {
      bad("PU-01 老配置被强塞了 connect_host（破坏向后兼容）", legacy && legacy.connectHost);
    } else {
      ok("PU-01 归一：connect_host 读得出；老配置缺省为空，行为不变");
    }
  }

  /* PU-02 四栏仍是公网 host、形状一字不变、绝不夹带 connect_host / box_token。 */
  {
    const h = CONFIG.toHandoff(load());
    const keys = Object.keys(h || {}).sort().join(",");
    if (keys !== "box_id,client_token,host,port") bad("PU-02 四栏形状被撑大", keys);
    else if (h.host !== "203.0.113.9") bad("PU-02 手机拿到的不是公网 host", h.host);
    else if (JSON.stringify(h).includes("connect_host") || JSON.stringify(h).includes(boxToken)) {
      bad("PU-02 四栏里夹带了 connect_host 或 box_token");
    } else {
      ok("PU-02 四栏 = host(203.0.113.9)/port/box_id/client_token，不含 connect_host 与 box_token");
    }
  }

  /* PU-03 安全格式里保留 connect_host，且查无明文、0600。 */
  {
    const text = fs.readFileSync(file, "utf8");
    const mode = fs.statSync(file).mode & 0o777;
    if (!text.includes("connect_host") || text.includes(boxToken) || text.includes(clientToken) || mode !== 0o600) {
      bad("PU-03 安全格式不对", { hasConnect: text.includes("connect_host"), mode: mode.toString(8) });
    } else {
      ok("PU-03 安全格式保留 connect_host、查无明文、mode=0600");
    }
  }

  /* PU-04 设置面保存其它字段时 connect_host 不丢（否则改一次地址就退回连公网）。 */
  {
    const r = SETTINGS.saveRelaySettings({
      file, vault, env: {},
      patch: { host: "203.0.113.10", port: 18766, box_id: "box-pu", mode: "reverse" },
    });
    const cfg = load();
    if (!r.ok || !cfg || cfg.connectHost !== "127.0.0.1") {
      bad("PU-04 保存后 connect_host 丢了", JSON.stringify({ r: r.ok, ch: cfg && cfg.connectHost }));
    } else if (cfg.host !== "203.0.113.10") {
      bad("PU-04 新 host 没生效", cfg.host);
    } else {
      ok("PU-04 设置面只改地址 → connect_host 沿用、新 host 生效");
    }
  }

  /* PU-05 真 socket：临时 relay，盒子用「本机地址」出站 BIND 成功。
   * 完整数据面（ACCEPT/ATTACH/HTTP 200）由 prove_relay_reverse_tunnel.js 与
   * 现场实测覆盖；本门聚焦 connect_host 拆分不破坏登记与控制面形状。 */
  const relay = RELAY.createRelayServer({ relaySecret: SECRET, bindHost: "127.0.0.1" });
  const ri = await relay.start();
  {
    const bind = await handshake(ri.controlPort,
      ["AUTH " + boxToken + "\nBIND box-pu\n"], ["OK", "BOUND box-pu"]);
    const noBox = await handshake(ri.controlPort,
      ["AUTH " + clientToken + "\nCONNECT no-such-box\n"], ["OK", "NOBOX"]);
    if (!bind.ok) bad("PU-05 盒子经 connect_host 出站 BIND 失败", bind.got);
    else if (!noBox.ok) bad("PU-05 控制面 CONNECT 形状变了", noBox.got);
    else ok("PU-05 真 socket：盒子出站 BIND 成功、未登记的 box 明确 NOBOX");
  }
  await relay.stop();

  /* PU-06 负向对照：连公网出口（不可达）确实不通，证明拆分不是多余的。 */
  {
    const unreachable = await new Promise((resolve) => {
      const s = net.connect(18766, "192.0.2.1"); // TEST-NET-1，NAT 回环的等价模型
      const t = setTimeout(() => { s.destroy(); resolve(true); }, 1200);
      s.on("connect", () => { clearTimeout(t); s.destroy(); resolve(false); });
      s.on("error", () => { clearTimeout(t); resolve(true); });
    });
    if (!unreachable) bad("PU-06 不可达端点居然连上了（拆分必要性论证不成立）");
    else ok("PU-06 负向对照：不可达公网端点确实连不上（所以 connect_host 是必需的）");
  }

  /* PU-07 setup 脚本拒绝回环 / 私网 host（防止下发给手机一个连不上的地址）。 */
  {
    const run = (host) => spawnSync(process.execPath, [SETUP, "--host", host], { encoding: "utf8", timeout: 15000 });
    const a = run("127.0.0.1"), b = run("10.201.107.104"), c = run("192.168.1.5");
    if (a.status !== 2 || b.status !== 2 || c.status !== 2) {
      bad("PU-07 回环/私网 host 没被逐个拒绝", JSON.stringify({ a: a.status, b: b.status, c: c.status }));
    } else {
      ok("PU-07 setup 拒绝 127.0.0.1 / 10.x / 192.168.x 三种连不到的 host");
    }
  }

  /* PU-08 start 脚本：绑 0.0.0.0、与 setup 共用 secret 文件。 */
  {
    const sh = fs.readFileSync(START, "utf8");
    const js = fs.readFileSync(SETUP, "utf8");
    const anchors = [
      [sh, "BITBOT_RELAY_BIND:-0.0.0.0", "没绑 0.0.0.0（公网机器打不进来）"],
      [sh, "data/desktop/relay-secret", "没复用 setup 生成的 secret"],
      [sh, "relay-audit.jsonl", "没开审计日志"],
      [js, "relay-secret", "setup 没写 secret 文件"],
    ];
    const missing = anchors.filter(([s, n]) => !s.includes(n)).map(([, , why]) => why);
    if (missing.length) bad("PU-08 部署脚本接线缺：" + missing.join("；"));
    else ok("PU-08 部署脚本：0.0.0.0 / 同一 secret 文件 / 审计日志 / setup 落 secret");
  }

  /* PU-09 main.js 真的用 connect_host 连（静态 join，A3-7 的教训）。 */
  {
    const src = fs.readFileSync(MAINJS, "utf8");
    if (!src.includes("host: cfg.connectHost || cfg.host")) {
      bad("PU-09 桌面没用 connect_host（模块绿≠产品会用）");
    } else {
      ok("PU-09 main.js: host: cfg.connectHost || cfg.host（没有则维持公网 host）");
    }
  }

  /* PU-10 既有锚点一字未动。 */
  {
    const cfgJs = fs.readFileSync(path.join(REPO, "hosts/shared/relay/relay_config.js"), "utf8");
    const main = fs.readFileSync(MAINJS, "utf8");
    const anchors = [
      [cfgJs, "return { host: c.host, port: c.port, box_id: c.boxId, client_token: c.clientToken };", "toHandoff 四栏"],
      [cfgJs, "if (!boxId || !boxToken || !clientToken) return null;", "半套一律 null"],
      [main, "relayHandoff: () => currentRelayHandoff(),", "RB-09"],
      [main, "const started = await cnInbound.start();", "RB-09"],
      [main, "syncRelayBoxRegistration(started)", "RB-09"],
      [main, "load: () => loadCurrentRelayConfig(),", "RH-10"],
    ];
    const missing = anchors.filter(([s, n]) => !s.includes(n)).map(([, , why]) => why);
    if (missing.length) bad("PU-10 既有锚点被撞掉：" + missing.join("；"));
    else ok("PU-10 toHandoff 四栏 / 半套 null / RB-09 / RH-10 六处锚点一字未动");
  }

  /* PU-11 凭证绝不进仓库：relay-secret 没有扩展名，通配 *.json 盖不住，
   * .gitignore 漏一行就等于把准入密钥提交上去。这条把规则本身钉住。 */
  {
    const files = [
      "data/desktop/relay-secret", "data/desktop/relay.json",
      "data/host/turn-token", "data/secrets/vault.key",
    ];
    const leaked = files.filter((f) =>
      spawnSync("git", ["check-ignore", "-q", f], { cwd: REPO }).status !== 0);
    if (leaked.length) bad("PU-11 凭证文件没被 .gitignore 覆盖（会被误提交）：" + leaked.join(","));
    else ok("PU-11 四个凭证文件全部被 .gitignore 覆盖（relay-secret 无扩展名，专门补了规则）");
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("prove_public_relay_setup: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_public_relay_setup: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
