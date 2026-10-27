#!/usr/bin/env node
"use strict";

/**
 * B-2 — 这台机器叫什么。
 *
 * 原来 `machine_id` 在 73 处写死成 `"desk-1"`。单看没毛病,但多机场景下
 * **两台机器撞名** —— 桌面和 Box 都叫 desk-1,状态/记忆/上下文会串。
 *
 * 这个门禁钉住:
 *   - 默认仍是 desk-1 ⇒ **单机行为零变化**(这是不能破的)
 *   - `BITBOT_MACHINE_ID` 能覆盖
 *   - 显式值优先于环境
 *   - **设备密钥的 id 是身份的来源之一**(B-4a:账号 = 设备密钥)
 *   - 端到端:入站回合的 machine_id 是**那台设备的 id**,不是写死的 desk-1
 *   - 端到端:两台不同的机器 ⇒ 不同的 machine_id(不撞名)
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { resolveMachineId, machineIdForInbound, normalizeKind } = require(
  path.join(ROOT, "hosts/shared/machine_identity"),
);
const deviceKeys = require(path.join(ROOT, "hosts/shared/device_keys"));
const { createCnInboundServer } = require(path.join(ROOT, "hosts/shared/cn_inbound_server"));

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log("ok", n); };
const bad = (n, d) => { fail += 1; console.error("FAIL", n, d || ""); };
const check = (c, n, d) => (c ? ok(n) : bad(n, d));

function signedPost(port, device, bodyObj) {
  const body = Buffer.from(JSON.stringify(bodyObj || {}), "utf8");
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

(async function main() {
  // ---- 纯函数层 ------------------------------------------------------
  check(
    resolveMachineId({ kind: "desktop", env: {} }) === "desk-1",
    "MI-1 默认仍是 desk-1(单机行为零变化)",
    resolveMachineId({ kind: "desktop", env: {} }),
  );
  check(
    resolveMachineId({ kind: "ios", env: {} }) === "phone-ios" &&
      resolveMachineId({ kind: "android", env: {} }) === "phone-android",
    "MI-1 按 kind 的稳定默认",
  );
  check(
    resolveMachineId({ kind: "desktop", env: { BITBOT_MACHINE_ID: "box-a" } }) === "box-a",
    "MI-2 环境变量能改机器身份",
  );
  check(
    resolveMachineId({ kind: "desktop", explicit: "explicit-1", env: { BITBOT_MACHINE_ID: "box-a" } }) ===
      "explicit-1",
    "MI-2 显式值优先于环境",
  );
  check(
    resolveMachineId({ kind: "desktop", deviceId: "dev-abc", env: {} }) === "dev-abc",
    "MI-3 设备密钥的 id 就是机器身份(B-4a)",
  );
  check(
    machineIdForInbound({ kind: "mobile", deviceId: "dev-xyz", env: {} }) === "dev-xyz",
    "MI-3 入站用设备 id",
  );
  check(
    normalizeKind("iPhone") === "ios" && normalizeKind("pixel") === "android",
    "MI-1 kind 归一",
  );

  // ---- 端到端:入站回合的 machine_id ---------------------------------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-mid-"));
  const registry = path.join(tmp, "devices.json");
  const phone = deviceKeys.generateDeviceKey({ kind: "mobile", name: "我的手机" });
  const desk = deviceKeys.generateDeviceKey({ kind: "desktop", name: "我的桌面" });
  deviceKeys.saveDevices(registry, {
    version: 1,
    devices: [
      { id: phone.id, name: phone.name, kind: phone.kind, public_key_pem: phone.public_key_pem, created_at: phone.created_at, revoked_at: null },
      { id: desk.id, name: desk.name, kind: desk.kind, public_key_pem: desk.public_key_pem, created_at: desk.created_at, revoked_at: null },
    ],
  });

  const seen = [];
  const server = createCnInboundServer({
    repoRoot: tmp,
    port: 0,
    devicesPath: registry,
    onTurn: async (prompt, meta) => {
      seen.push(meta || {});
      return { ok: true, messages: [{ role: "assistant", text: "好" }], host_results: [] };
    },
  });
  const info = await server.start();
  const port = Number(info.port);

  try {
    const r1 = await signedPost(port, phone, { text: "手机来的", machine_kind: "desktop" });
    check(r1.status === 200, "MI-4 入站回合通了", r1.status + " " + r1.raw.slice(0, 150));
    check(
      seen[0] && seen[0].device_id === phone.id,
      "MI-4 meta 里带的是那台设备的 id",
      JSON.stringify(seen[0] || {}),
    );
    check(
      r1.body && r1.body.machine_kind === "mobile",
      "MI-4 机器类型来自凭证(payload 自称 desktop 无效)",
      JSON.stringify(r1.body || {}).slice(0, 200),
    );

    // 两台设备 ⇒ 两次入站是**两台不同的机器**
    const r2 = await signedPost(port, desk, { text: "桌面来的" });
    check(r2.status === 200, "MI-5 第二台设备也通", r2.status);
    check(
      seen[0] && seen[1] && seen[0].device_id !== seen[1].device_id,
      "MI-5 两台机器不撞名(各自的设备 id)",
      JSON.stringify(seen.map((s) => s && s.device_id)),
    );
  } finally {
    try { await server.stop(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("prove_machine_identity pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_machine_identity crashed — " + String((e && e.stack) || e));
  console.log("prove_machine_identity pass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
