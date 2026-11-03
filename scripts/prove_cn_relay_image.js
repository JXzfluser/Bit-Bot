"use strict";
/**
 * prove_cn_relay_image.js — A3-1 中转镜像门禁（红 → 绿）
 *
 * 验收（路线 A · W4 · A3-1）：交付一个「哑」中转镜像——成员凭证签发、公钥/端点登记、
 * 盲转发、健康检查。转发模型已锁定为 **TCP/TLS 透传**：控制面用 relay-secret 鉴权，
 * 数据面纯透传，不解析应用层、不落内容、不存密钥。
 *
 * 本门证四件事：
 *  1. relay_keys 能签发 + 校验成员凭证（box / client 两类角色）；
 *  2. relay 启动后健康检查端口返回 OK；
 *  3. Box 登记后 registry 含该 box 的端点，且盲转发真的把字节送到桩 box 并回显；
 *  4. 数据面不落明文（转发后 relay 内部诊断态不含 payload 字节）—— A3-2 内容不可见的先手实证。
 *
 * 跑法：node scripts/prove_cn_relay_image.js
 * 不依赖 Docker / 显示环境；起真实 TCP 控制面 + 真实桩 box 做端到端转发断言。
 */
const fs = require("fs");
const net = require("net");
const http = require("http");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const RELAY = path.join(REPO, "hosts", "shared", "relay", "relay_server.js");
const RELAY_KEYS = path.join(REPO, "hosts", "shared", "relay", "relay_keys.js");

let PASS = 0,
  FAIL = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : ""));
};
const done = () => {
  console.log("prove_cn_relay_image: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
};

// 红态下模块不存在；用 try/require 让红是干净的 FAIL 汇总，而不是 require 崩溃。
let relay = null;
let relayKeys = null;
try {
  relay = require(RELAY);
} catch (_) {
  relay = null;
}
try {
  relayKeys = require(RELAY_KEYS);
} catch (_) {
  relayKeys = null;
}

const RELAY_SECRET = "test-relay-secret-A3-1";

// 工具：向 relay 控制面发一行命令，收一行响应
function controlRoundtrip(controlPort, lines, onData) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(controlPort, "127.0.0.1", () => {
      sock.write(lines.join("\n") + "\n");
    });
    let buf = "";
    sock.on("data", (c) => {
      buf += c.toString();
      if (onData) onData(sock, buf);
    });
    sock.on("error", reject);
    sock.on("close", () => resolve(buf));
  });
}

// 工具：起一个桩 box（回显 + 打上标记），返回 { port, got }
function startStubBox(marker) {
  return new Promise((resolve) => {
    const srv = net.createServer((s) => {
      s.on("data", (c) => {
        const echo = marker + ":" + c.toString();
        s.write(echo);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve({ port: srv.address().port, srv }));
  });
}

function httpGet(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: pathname }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

(async () => {
  try {
    /* EV-1 模块存在 */
    if (!relay || typeof relay.createRelayServer !== "function") {
      bad("EV-1 relay_server 模块存在且导出 createRelayServer", "红：模块未实现");
    } else {
      ok("EV-1 relay_server 模块存在且导出 createRelayServer");
    }

    /* EV-2 成员凭证签发 + 校验 */
    if (!relayKeys || typeof relayKeys.issueRelayCredential !== "function") {
      bad("EV-2 relay_keys 能签发 + 校验成员凭证", "红：模块未实现");
    } else {
      const tok = relayKeys.issueRelayCredential(RELAY_SECRET, "box-1", "box");
      const v = relayKeys.verifyRelayCredential(RELAY_SECRET, tok);
      if (!v || !v.ok || v.memberId !== "box-1" || v.role !== "box")
        bad("EV-2 签发后 verify 应回 memberId=box-1/role=box", JSON.stringify(v));
      else {
        const badTok = tok.slice(0, -2) + "xx";
        const v2 = relayKeys.verifyRelayCredential(RELAY_SECRET, badTok);
        if (v2 && v2.ok) bad("EV-2 篡改的凭证应被拒", JSON.stringify(v2));
        else ok("EV-2 relay_keys 签发 + 校验成员凭证（box 角色，篡改即拒）");
      }
    }

    // 后续 EV 需要真实启动 relay；红态下 relay 为 null，直接记 FAIL 不崩。
    if (!relay || typeof relay.createRelayServer !== "function") {
      bad("EV-3 中继启动后健康检查返回 OK", "红：模块未实现");
      bad("EV-4 Box 登记后 registry 含端点", "红：模块未实现");
      bad("EV-5 盲转发把字节送到桩 box 并回显", "红：模块未实现");
      bad("EV-6 数据面不落明文（诊断态不含 payload）", "红：模块未实现");
      done();
      return;
    }

    const srv = relay.createRelayServer({
      controlPort: 0,
      healthPort: 0,
      relaySecret: RELAY_SECRET,
    });
    const info = await srv.start();
    const stub = await startStubBox("BOX-ECHO");

    /* EV-3 健康检查 */
    const hc = await httpGet(info.healthPort, "/healthz");
    if (hc.status !== 200 || !/ok/.test(hc.body))
      bad("EV-3 健康检查 /healthz 应返回 200 + ok", "status=" + hc.status + " body=" + hc.body.slice(0, 80));
    else ok("EV-3 中继启动后健康检查 /healthz 返回 200 OK");

    /* EV-4 Box 登记 */
    const reg = srv.registerBox("box-1", "127.0.0.1:" + stub.port);
    const registry = srv.getRegistry();
    if (!registry["box-1"] || registry["box-1"].endpoint !== "127.0.0.1:" + stub.port)
      bad("EV-4 Box 登记后 registry 应含 box-1 端点", JSON.stringify(registry));
    else ok("EV-4 Box 登记后 registry 含 box-1 端点（" + registry["box-1"].endpoint + "）");

    /* EV-5 盲转发（真实走控制面 CONNECT → 桩 box 回显） */
    const PAYLOAD = "HELLO-BOX-" + Date.now();
    const buf = await new Promise((resolve, reject) => {
      let echoed = "";
      let ctrlBuf = "";
      let tunneled = false;
      const sock = net.connect(info.controlPort, "127.0.0.1", () => {
        const tok = relayKeys.issueRelayCredential(RELAY_SECRET, "client-1", "client");
        sock.write("AUTH " + tok + "\nCONNECT box-1\n");
      });
      sock.on("data", (c) => {
        const s = c.toString();
        if (!tunneled) {
          ctrlBuf += s;
          let nl;
          while ((nl = ctrlBuf.indexOf("\n")) >= 0) {
            const line = ctrlBuf.slice(0, nl).trim();
            ctrlBuf = ctrlBuf.slice(nl + 1);
            if (!line) continue;
            if (line.startsWith("TUNNEL")) {
              tunneled = true;
              sock.write(PAYLOAD); // 数据面：把 payload 透传给桩 box
              echoed = ctrlBuf; // TUNNEL 行之后的数据面起始字节
              break;
            }
            // OK / 其他控制行忽略，继续等 TUNNEL
          }
        } else {
          echoed += s;
        }
        if (tunneled && echoed.includes("BOX-ECHO:" + PAYLOAD)) {
          sock.end();
          resolve(echoed);
        }
      });
      sock.on("error", reject);
      setTimeout(() => resolve(echoed), 2000);
    });
    if (!buf.includes("BOX-ECHO:" + PAYLOAD))
      bad("EV-5 盲转发应把字节送到桩 box 并回显", "echoed=" + buf.slice(0, 80));
    else ok("EV-5 盲转发把字节送到桩 box 并回显（数据面透传）");

    /* EV-6 数据面不落明文 */
    const diag = JSON.stringify(srv.getDiagnosticState ? srv.getDiagnosticState() : {});
    if (diag.includes(PAYLOAD))
      bad("EV-6 转发后 relay 诊断态不应含 payload 明文", "diag 含 " + PAYLOAD);
    else if (srv.getCapturedPayloads && srv.getCapturedPayloads().length)
      bad("EV-6 relay 不应缓存任何 payload", "captured=" + srv.getCapturedPayloads().length);
    else ok("EV-6 数据面不落明文（诊断态 / 缓存均不含 payload）");

    try {
      stub.srv.close();
    } catch (_) {}
    try {
      await srv.stop();
    } catch (_) {}
    done();
  } catch (e) {
    bad("门禁内部异常", String((e && e.stack) || e).slice(0, 200));
    done();
  }
})();
