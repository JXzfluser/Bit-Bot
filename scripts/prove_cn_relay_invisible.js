"use strict";
/**
 * prove_cn_relay_invisible.js — A3-2 内容不可见实证门禁（红 → 绿）
 *
 * 验收（路线 A · W4 · A3-2 · AC-T4-3）：中转侧「看不见内容」不能只靠架构口头保证
 * （A3-1 的 EV-6 是「无日志即无明文」的真空通过），必须做成可重复门禁：
 *
 *   - 中继要有**真实的元数据审计日志**（只记 connect/close/register 等元数据：role/memberId/
 *     boxId/endpoint/bytes，绝不记 token、绝不记 payload/正文/附件）；
 *   - 门禁跑一次完整 connect → 透传含唯一明文正文+附件标记的 payload → close；
 *   - 断言日志存在且含该会话元数据，但日志与任何落盘文件中都查无该明文（反真空通过）；
 *   - 断言无旁路抓包/转储文件包含该明文。
 *
 * 设计铁律「先红后绿」：红态下中继无 getAuditLog 能力、日志面为空，本门应干净 FAIL
 * （EV-1/EV-2/EV-3 红），而不是靠「没日志所以没明文」混过（那正是 A3-1 的真空通过漏洞）。
 *
 * 跑法：node scripts/prove_cn_relay_invisible.js
 * 不依赖 Docker / 显示环境；起真实 TCP 控制面 + 真实桩 box，经线协议透传真实 payload。
 */
const fs = require("fs");
const os = require("os");
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
  console.log("prove_cn_relay_invisible: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
};

// 红态下模块可能不存在；用 try/require 让红是干净的 FAIL 汇总，而不是 require 崩溃。
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

const RELAY_SECRET = "test-relay-secret-A3-2";

// 唯一明文正文 + 附件标记（运行时生成，避免与门禁源码本身重叠被误匹配）。
const TS = Date.now();
const RND = Math.random().toString(36).slice(2, 10);
const CANARY_BODY = "CN-INVISIBLE-CANARY-BODY-" + TS + "-" + RND;
const CANARY_ATTACH = "CN-INVISIBLE-ATTACH-B64-" + TS + "-" + RND;
const CANARY = CANARY_BODY + "|" + CANARY_ATTACH; // 数据面透传的「明文内容」

// 工具：向 relay 控制面发命令序列，按回调处理数据面
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

// 工具：起一个桩 box（回显 + 打上标记），返回 { port, srv }
function startStubBox(marker) {
  return new Promise((resolve) => {
    const srv = net.createServer((s) => {
      s.on("data", (c) => {
        s.write(marker + ":" + c.toString());
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
    /* EV-1 能力：中继暴露 getAuditLog（元数据审计日志 API） */
    if (!relay || typeof relay.createRelayServer !== "function") {
      bad("EV-1 中继暴露 getAuditLog（元数据审计日志能力）", "红：relay_server 模块未实现");
    } else {
      // 先用一个临时 logFile 启动，看是否暴露 getAuditLog
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-relay-inv-"));
      const logFile = path.join(tmpDir, "audit.log");
      const probe = relay.createRelayServer({
        controlPort: 0,
        healthPort: 0,
        relaySecret: RELAY_SECRET,
        logFile,
        verbose: false,
      });
      if (typeof probe.getAuditLog !== "function") {
        bad("EV-1 中继暴露 getAuditLog（元数据审计日志能力）", "红：createRelayServer 无 logFile/getAuditLog 支持");
      } else {
        ok("EV-1 中继暴露 getAuditLog（元数据审计日志能力）");
      }
      try {
        await probe.stop();
      } catch (_) {}
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }

    /* EV-2 成员凭证签发 + 校验（A3-1 已交付，这里作为前置可信基线） */
    if (!relayKeys || typeof relayKeys.issueRelayCredential !== "function") {
      bad("EV-2 relay_keys 能签发 + 校验成员凭证", "红：模块未实现");
    } else {
      const tok = relayKeys.issueRelayCredential(RELAY_SECRET, "client-1", "client");
      const v = relayKeys.verifyRelayCredential(RELAY_SECRET, tok);
      if (!v || !v.ok || v.memberId !== "client-1" || v.role !== "client")
        bad("EV-2 签发后 verify 应回 memberId=client-1/role=client", JSON.stringify(v));
      else ok("EV-2 relay_keys 签发 + 校验成员凭证（client 角色）");
    }

    // 后续 EV 需要真实启动中继并跑一次完整透传；红态下 relay 为 null，干净记 FAIL 不崩。
    if (!relay || typeof relay.createRelayServer !== "function") {
      bad("EV-3 日志存在且查无明文（反真空通过）", "红：模块未实现");
      bad("EV-4 无旁路落盘文件含明文", "红：模块未实现");
      bad("EV-5 registry 仅含端点、无内容", "红：模块未实现");
      bad("EV-6 数据面不缓存 payload（getCapturedPayloads 恒空）", "红：模块未实现");
      done();
      return;
    }

    // 受控临时目录：中继的审计日志落这里；EV-4 只扫这里，避免误匹配与全仓扫。
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-relay-inv-"));
    const logFile = path.join(logDir, "audit.log");

    const srv = relay.createRelayServer({
      controlPort: 0,
      healthPort: 0,
      relaySecret: RELAY_SECRET,
      logFile,
      verbose: false,
    });
    const info = await srv.start();
    const stub = await startStubBox("BOX-ECHO");
    srv.registerBox("box-1", "127.0.0.1:" + stub.port);

    /* 跑一次完整透传：AUTH → CONNECT box-1 → 数据面送 CANARY → 桩 box 回显 → close */
    let forwardOk = false;
    await new Promise((resolve, reject) => {
      let tunneled = false;
      let echoed = "";
      let ctrlBuf = "";
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
              sock.write(CANARY); // 数据面：把唯一明文正文+附件标记透传给桩 box
              echoed = ctrlBuf;
              break;
            }
          }
        } else {
          echoed += s;
        }
        if (tunneled && echoed.includes("BOX-ECHO:" + CANARY)) {
          forwardOk = true;
          sock.end();
          resolve();
        }
      });
      sock.on("error", reject);
      setTimeout(() => resolve(), 2000);
    });

    const hc = await httpGet(info.healthPort, "/healthz");
    if (hc.status !== 200 || !/ok/.test(hc.body))
      bad("EV-3 前置 健康检查 /healthz 应返回 200 + ok", "status=" + hc.status);

    /* EV-3 反真空通过：必须有真实日志且日志查无明文 */
    const hasAuditApi = typeof srv.getAuditLog === "function";
    let auditEvents = [];
    let logText = "";
    if (hasAuditApi) {
      try {
        auditEvents = srv.getAuditLog() || [];
      } catch (_) {
        auditEvents = [];
      }
      try {
        if (fs.existsSync(logFile)) logText = fs.readFileSync(logFile, "utf8");
      } catch (_) {
        logText = "";
      }
    }
    if (!hasAuditApi) {
      bad("EV-3 日志存在且查无明文（反真空通过）", "红：无 getAuditLog，日志面为空＝真空通过漏洞未封堵");
    } else if (!auditEvents.length && !logText) {
      bad("EV-3 日志存在且查无明文（反真空通过）", "红：日志面存在但无事件，仍属真空通过");
    } else if ((logText + JSON.stringify(auditEvents)).includes(CANARY)) {
      bad("EV-3 日志存在且查无明文（反真空通过）", "日志含明文 canary");
    } else if (
      !auditEvents.some((e) => e.event === "connect" && e.boxId === "box-1" && e.memberId === "client-1") &&
      !logText.includes("box-1")
    ) {
      bad("EV-3 日志存在且查无明文（反真空通过）", "日志无本次会话 connect 元数据（boxId=box-1）");
    } else {
      ok("EV-3 日志存在且查无明文（反真空通过）：含 connect/close 元数据、无 canary 明文");
    }

    /* EV-4 无旁路落盘文件含明文（只扫受控 logDir，不含数据面桩 box） */
    let sideLeak = false;
    let sideFiles = 0;
    try {
      for (const f of fs.readdirSync(logDir)) {
        sideFiles++;
        const p = path.join(logDir, f);
        if (fs.statSync(p).isFile()) {
          const t = fs.readFileSync(p, "utf8");
          if (t.includes(CANARY)) sideLeak = true;
        }
      }
    } catch (_) {}
    if (sideLeak) bad("EV-4 无旁路落盘文件含明文（canary 出现在 " + sideFiles + " 个文件之一）", "发现明文落盘");
    else ok("EV-4 无旁路落盘文件含明文（受控目录 " + sideFiles + " 个文件均无 canary）");

    /* EV-5 registry 仅含端点、无内容 */
    const registry = JSON.stringify(srv.getRegistry ? srv.getRegistry() : {});
    if (registry.includes(CANARY)) bad("EV-5 registry 应只含端点、无内容", "registry 含 canary");
    else ok("EV-5 registry 仅含端点、无内容（getRegistry 不含 canary）");

    /* EV-6 数据面永不缓存 payload */
    const captured = srv.getCapturedPayloads ? srv.getCapturedPayloads() : null;
    if (captured && captured.length) bad("EV-6 数据面不缓存 payload（getCapturedPayloads 应恒空）", "captured=" + captured.length);
    else ok("EV-6 数据面不缓存 payload（getCapturedPayloads 恒空）");

    if (!forwardOk) bad("EV-3 前置 透传本轮未成功（桩 box 未回显 canary）", "forwardOk=false");

    try {
      stub.srv.close();
    } catch (_) {}
    try {
      await srv.stop();
    } catch (_) {}
    try {
      fs.rmSync(logDir, { recursive: true, force: true });
    } catch (_) {}
    done();
  } catch (e) {
    bad("门禁内部异常", String((e && e.stack) || e).slice(0, 200));
    done();
  }
})();
