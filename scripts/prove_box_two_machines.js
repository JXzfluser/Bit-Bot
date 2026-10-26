#!/usr/bin/env node
"use strict";

/**
 * B-1 gate: a packed Box actually answers a turn from another machine.
 *
 * The user's premise for the daily-热点 scenario is 「机器常开」. B-1 packages
 * Bit Bot into such a machine; this gate proves the package is real:
 *
 *   1. pack-box.sh produces a flat, self-contained tree (kernel binary + Host)
 *   2. a device is registered in the Box's registry (PUBLIC key only)
 *   3. the Box starts from the PACKED tree (not from the repo)
 *   4. a "phone" signs a turn with its own private key and sends it
 *   5. the Box runs a REAL kernel turn and answers
 *   6. the Box's own data dir shows the session/context actually landed
 *
 * No stubs in the product path: the provider is a local stub, but the kernel,
 * the Host FFI, the tool loop and the packaging are all real.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const deviceKeys = require(path.join(ROOT, "hosts/shared/device_keys"));

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log("ok", n); };
const bad = (n, d) => { fail += 1; console.error("FAIL", n, d || ""); };
const check = (c, n, d) => (c ? ok(n) : bad(n, d));

const ANSWER = "Box 在。收到你从手机发来的消息。";

function sseText(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}

function jsonText(text) {
  return JSON.stringify({
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  });
}

/**
 * 真 provider 两种传输都支持:请求里 `stream:true` 回 SSE,否则回 JSON。
 * Box 是 headless 的 —— 没有渲染层可流式消费 ⇒ 走非流式那条。
 * (桌面那条有 `setLlmStreamHandler`,走的是流式。)
 */
function startStub() {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch (_) { parsed = {}; }
      posts.push(parsed);
      const wantStream = parsed && parsed.stream === true;
      if (wantStream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseText(ANSWER));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(jsonText(ANSWER));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, posts, port: server.address().port });
    });
  });
}

function postSigned(port, device, text) {
  const body = Buffer.from(JSON.stringify({ text, machine_kind: "desktop" }), "utf8");
  const ts = String(Date.now());
  const nonce = "n-" + Math.random().toString(36).slice(2) + Date.now();
  const sig = deviceKeys.signTurn(device.private_key_pem, device.id, ts, nonce, body);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/v1/turn",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bitbot-device": device.id,
          "x-bitbot-timestamp": ts,
          "x-bitbot-nonce": nonce,
          "x-bitbot-signature": sig,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let parsed = {};
          try { parsed = JSON.parse(raw || "{}"); } catch (_) { parsed = {}; }
          resolve({ status: res.statusCode, body: parsed, raw });
        });
      },
    );
    req.on("error", (e) => resolve({ status: 0, body: { error: String(e) }, raw: "" }));
    req.write(body);
    req.end();
  });
}

async function waitForHealth(port, ms) {
  const deadline = Date.now() + (ms || 30000);
  while (Date.now() < deadline) {
    const up = await new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/health", method: "GET" }, (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => resolve({ status: res.statusCode, raw }));
      });
      req.on("error", () => resolve({ status: 0, raw: "" }));
      req.end();
    });
    if (up.status === 200) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-box-"));
  const boxDir = path.join(tmp, "box");

  // ---- 1. 打包 ----------------------------------------------------------
  console.log("[gate] packing the box…");
  try {
    execFileSync("bash", [path.join(ROOT, "scripts", "pack-box.sh"), "--out", boxDir, "--profile", "debug"], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, PATH: `${process.env.HOME || ""}/.moon/bin:${process.env.PATH || ""}` },
    });
  } catch (e) {
    console.error("[gate] pack-box.sh failed: " + String((e && e.stdout) || e));
    console.log("prove_box_two_machines pass=" + pass + " fail=" + (fail + 1));
    process.exit(1);
  }

  check(fs.existsSync(path.join(boxDir, "bin", "desktop_turn")), "BX-1 打包产出了内核二进制");
  check(fs.existsSync(path.join(boxDir, "shared", "host_ffi.js")), "BX-1 打包产出了 Host");
  check(fs.existsSync(path.join(boxDir, "manifest.json")), "BX-1 打包产出了 manifest");
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(boxDir, "manifest.json"), "utf8")); } catch (_) {}
  check(
    !!manifest && manifest.kind === "bitbot-box" && !!manifest.machine_id,
    "BX-1 manifest 说清楚了这台机器是什么",
    JSON.stringify(manifest || {}).slice(0, 200),
  );

  // ---- 2. 登记一台设备(只有公钥进 Box) ----------------------------------
  const device = deviceKeys.generateDeviceKey({ kind: "mobile", name: "我的手机" });
  const registry = path.join(boxDir, "data", "host", "devices.json");
  deviceKeys.saveDevices(registry, {
    version: 1,
    devices: [
      {
        id: device.id,
        name: device.name,
        kind: device.kind,
        public_key_pem: device.public_key_pem,
        created_at: device.created_at,
        revoked_at: null,
      },
    ],
  });
  const registryRaw = fs.readFileSync(registry, "utf8");
  check(!registryRaw.includes("PRIVATE KEY"), "BX-2 Box 的登记表里没有私钥");

  // ---- 3. 起 Box(从打包目录,不是仓库) ----------------------------------
  const stub = await startStub();
  const port = 18700 + Math.floor(Math.random() * 400);
  const child = spawn("node", [path.join(boxDir, "shared", "box_main.js")], {
    cwd: boxDir,
    env: {
      ...process.env,
      BITBOT_KERNEL_BIN: path.join(boxDir, "bin", "desktop_turn"),
      BITBOT_CN_INBOUND_PORT: String(port),
      BITBOT_DEVICES_PATH: registry,
      BITBOT_LLM_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
      BITBOT_LLM_API_KEY: "stub-key",
      BITBOT_LLM_MODEL: "stub-model",
      BITBOT_LLM_STREAM: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boxLog = "";
  child.stdout.on("data", (c) => { boxLog += c; });
  child.stderr.on("data", (c) => { boxLog += c; });

  try {
    const up = await waitForHealth(port, 40000);
    check(up, "BX-3 Box 从打包目录起来了(/health 有应答)", boxLog.slice(-400));
    if (!up) {
      console.log("prove_box_two_machines pass=" + pass + " fail=" + (fail + 1));
      process.exit(1);
    }
    check(
      boxLog.includes("[box] machine up"),
      "BX-3 Box 报出了自己的身份",
      boxLog.slice(-300),
    );
    check(
      boxLog.includes("device keys"),
      "BX-3 Box 说清了入站用的是设备密钥(不是共享 token)",
      boxLog.slice(-300),
    );

    // ---- 4. 手机发一个真回合 ---------------------------------------------
    const res = await postSigned(port, device, "手机问:今天的 AI 热点有哪些?");
    check(res.status === 200, "BX-4 手机签名的回合 → 200", res.status + " " + res.raw.slice(0, 200));
    check(
      res.body && res.body.ok === true,
      "BX-4 Box 真的把这一轮跑成了",
      JSON.stringify(res.body || {}).slice(0, 300),
    );
    const answer = ((res.body && res.body.messages) || [])
      .filter((m) => m && m.role === "assistant")
      .map((m) => String(m.text || ""))
      .join("\n");
    check(
      answer.includes("Box 在"),
      "BX-4 回答真的来自模型(不是回声)",
      answer.slice(0, 200),
    );
    check(
      res.body && res.body.device_id === device.id,
      "BX-4 Box 知道是这台设备来的",
      JSON.stringify(res.body || {}).slice(0, 200),
    );
    check(
      res.body && res.body.machine_kind === "mobile",
      "BX-4 机器身份来自凭证(手机自称 desktop 无效)",
      JSON.stringify(res.body || {}).slice(0, 200),
    );

    // ---- 5. Box 自己的数据目录真的落了东西 -------------------------------
    const ctxDir = path.join(boxDir, "data", "agent-context");
    const ctxFiles = fs.existsSync(ctxDir) ? fs.readdirSync(ctxDir) : [];
    check(ctxFiles.length > 0, "BX-5 Box 落下了回合上下文(下一轮会记得)", JSON.stringify(ctxFiles));

    // ---- 6. 匿名请求被拒 ---------------------------------------------------
    const anon = await new Promise((resolve) => {
      const body = Buffer.from(JSON.stringify({ text: "没签名的" }), "utf8");
      const req = http.request(
        { host: "127.0.0.1", port, path: "/v1/turn", method: "POST", headers: { "Content-Type": "application/json" } },
        (r) => {
          let raw = "";
          r.on("data", (c) => { raw += c; });
          r.on("end", () => resolve({ status: r.statusCode, raw }));
        },
      );
      req.write(body);
      req.end();
    });
    check(anon.status === 401, "BX-6 没带设备凭证的请求 → 401", anon.status);
  } finally {
    try { child.kill("SIGTERM"); } catch (_) {}
    try { stub.server.close(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("prove_box_two_machines pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_box_two_machines crashed — " + String((e && e.stack) || e));
  console.log("prove_box_two_machines pass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
