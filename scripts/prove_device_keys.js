#!/usr/bin/env node
"use strict";

/**
 * B-4a gate: a machine is identified by ITS key, not by a shared secret.
 *
 * The old contract: one static `BITBOT_TURN_TOKEN` for everything. Whoever
 * holds it IS any device — no "who is who", no per-device revocation, and
 * `machine_kind` came from the PAYLOAD (so a caller could claim to be a
 * desktop).
 *
 * This gate starts the real inbound server and drives it with real
 * ed25519-signed requests:
 *   - a valid device signature is accepted, and the server learns WHICH device
 *   - the machine kind comes from the CREDENTIAL, not from the payload
 *   - a tampered signature is refused
 *   - a replayed nonce is refused
 *   - a signature replayed under another device id is refused
 *   - a revoked device is refused
 *   - with an empty registry the legacy turn token still works
 *   - the registry holds PUBLIC KEYS only
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { createCnInboundServer } = require(path.join(ROOT, "hosts/shared/cn_inbound_server"));
const deviceKeys = require(path.join(ROOT, "hosts/shared/device_keys"));

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log("ok", n); };
const bad = (n, d) => { fail += 1; console.error("FAIL", n, d || ""); };
const check = (c, n, d) => (c ? ok(n) : bad(n, d));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-devkey-"));
const DEVICES_PATH = path.join(TMP, "devices.json");

function makeDevice(kind, name) {
  const d = deviceKeys.generateDeviceKey({ kind, name });
  const store = deviceKeys.loadDevices(DEVICES_PATH);
  store.devices = store.devices || [];
  store.devices.push({
    id: d.id,
    name: d.name,
    kind: d.kind,
    public_key_pem: d.public_key_pem,
    created_at: d.created_at,
    revoked_at: null,
  });
  deviceKeys.saveDevices(DEVICES_PATH, store);
  return d;
}

/** 带设备凭证发一个回合。 */
function postTurn(port, opts) {
  const o = opts || {};
  const body = Buffer.from(JSON.stringify(o.payload || { text: "你好" }), "utf8");
  const headers = { "Content-Type": "application/json" };
  if (o.device) {
    const ts = String(Date.now());
    const nonce = o.nonce || ("n-" + Math.random().toString(36).slice(2) + Date.now());
    const sig = deviceKeys.signTurn(o.device.private_key_pem, o.deviceId || o.device.id, ts, nonce, body);
    headers["x-bitbot-device"] = o.deviceId || o.device.id;
    headers["x-bitbot-timestamp"] = ts;
    headers["x-bitbot-nonce"] = nonce;
    headers["x-bitbot-signature"] = sig;
  } else if (o.bearer) {
    headers["Authorization"] = "Bearer " + o.bearer;
  }
  return new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/v1/turn", method: "POST", headers },
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

function startServer(opts) {
  return new Promise((resolve, reject) => {
    const server = createCnInboundServer({
      repoRoot: TMP,
      port: 0,
      devicesPath: DEVICES_PATH,
      turnToken: (opts && opts.turnToken) || "legacy-turn-token",
      onTurn: async (prompt, meta) => ({
        ok: true,
        messages: [{ role: "assistant", text: "收到:" + String(prompt || "").slice(0, 20) }],
        host_results: [],
        stdout: "",
        machine_kind: meta && meta.machine_kind,
      }),
    });
    server.start().then((info) => {
      resolve({ server, port: Number(info && info.port) || 0, info });
    }).catch((e) => {
      reject(e);
    });
  });
}

function closeServer(api) {
  return new Promise((resolve) => {
    try {
      if (api && typeof api.stop === "function") {
        api.stop().then(() => resolve()).catch(() => resolve());
        return;
      }
      if (api && typeof api.close === "function") {
        api.close(() => resolve());
        return;
      }
      resolve();
    } catch (_) {
      resolve();
    }
  });
}

(async function main() {
  // ---- 设备 A(手机)与设备 B(桌面) --------------------------------------
  const phone = makeDevice("mobile", "我的手机");
  const desk = makeDevice("desktop", "我的桌面");

  // ---- DK-1: 登记表里只有公钥 -----------------------------------------
  const registryRaw = fs.readFileSync(DEVICES_PATH, "utf8");
  check(
    !registryRaw.includes("PRIVATE KEY"),
    "DK-1 登记表里没有私钥(Box 上只有公钥)",
    registryRaw.slice(0, 200),
  );
  check(
    registryRaw.includes("PUBLIC KEY"),
    "DK-1 登记表里有公钥",
  );

  const s1 = await startServer();
  try {
    // ---- DK-2: 有效签名被接受,而且服务端知道是哪台设备 ----------------
    const ok1 = await postTurn(s1.port, {
      device: phone,
      payload: { text: "手机发来的", machine_kind: "desktop" },
    });
    check(ok1.status === 200, "DK-2 有效设备签名 → 200", ok1.status + " " + ok1.raw.slice(0, 160));
    check(
      ok1.body && ok1.body.device_id === phone.id,
      "DK-2 服务端知道来的是哪台设备",
      JSON.stringify(ok1.body || {}).slice(0, 200),
    );
    check(
      ok1.body && ok1.body.machine_kind === "mobile",
      "DK-2 机器身份来自**凭证**,不是 payload(自称 desktop 无效)",
      JSON.stringify(ok1.body || {}).slice(0, 200),
    );

    // ---- DK-3: 签名被改 → 拒绝 -----------------------------------------
    const bad = await postTurn(s1.port, {
      device: phone,
      payload: { text: "篡改过的" },
    });
    check(bad.status === 200, "DK-3 基准请求本身能通", bad.status);
    // 直接手改签名头
    const tampered = await new Promise((resolve) => {
      const body = Buffer.from(JSON.stringify({ text: "x" }), "utf8");
      const ts = String(Date.now());
      const nonce = "n-tamper";
      const sig = deviceKeys.signTurn(phone.private_key_pem, phone.id, ts, nonce, body);
      const req = http.request(
        {
          host: "127.0.0.1", port: s1.port, path: "/v1/turn", method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-bitbot-device": phone.id,
            "x-bitbot-timestamp": ts,
            "x-bitbot-nonce": nonce,
            "x-bitbot-signature": sig.slice(0, -4) + "AAAA",
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => { raw += c; });
          res.on("end", () => resolve({ status: res.statusCode, raw }));
        },
      );
      req.write(body);
      req.end();
    });
    check(tampered.status === 401, "DK-3 被改过的签名 → 401", tampered.status);

    // ---- DK-4: 换个 device_id 重放 → 拒绝(签名把 id 签进去了) ---------
    const swapped = await postTurn(s1.port, {
      device: phone,
      deviceId: desk.id,
      payload: { text: "换了个 id" },
    });
    check(swapped.status === 401, "DK-4 换 device_id 重放 → 401", swapped.status);

    // ---- DK-5: nonce 重放 → 拒绝 ----------------------------------------
    const nonce = "n-replay";
    const r1 = await postTurn(s1.port, { device: phone, nonce, payload: { text: "第一次" } });
    const r2 = await postTurn(s1.port, { device: phone, nonce, payload: { text: "第一次" } });
    check(r1.status === 200, "DK-5 第一次投递 → 200", r1.status);
    check(r2.status === 401, "DK-5 同一个 nonce 重放 → 401", r2.status);

    // ---- DK-6: 另一台设备自己的密钥当然能用 ----------------------------
    const deskTurn = await postTurn(s1.port, { device: desk, payload: { text: "桌面发来的" } });
    check(deskTurn.status === 200, "DK-6 另一台设备用自己的密钥 → 200", deskTurn.status);
    check(
      deskTurn.body && deskTurn.body.machine_kind === "desktop",
      "DK-6 那台设备的机器身份是它自己的",
      JSON.stringify(deskTurn.body || {}).slice(0, 160),
    );
  } finally {
    await closeServer(s1.server);
  }

  // ---- DK-7: 吊销一台设备 → 只有那一台断了 ------------------------------
  {
    const store = deviceKeys.loadDevices(DEVICES_PATH);
    const res = deviceKeys.revokeDevice(store, phone.id);
    check(res.ok === true, "DK-7 吊销成功", JSON.stringify(res));
    deviceKeys.saveDevices(DEVICES_PATH, store);

    const s2 = await startServer();
    try {
      const revoked = await postTurn(s2.port, { device: phone, payload: { text: "还在吗" } });
      check(revoked.status === 401, "DK-7 被吊销的设备 → 401", revoked.status);
      const stillOk = await postTurn(s2.port, { device: desk, payload: { text: "我还在" } });
      check(stillOk.status === 200, "DK-7 另一台设备不受影响(只吊销一台)", stillOk.status);
    } finally {
      await closeServer(s2.server);
    }
  }

  // ---- DK-8: 登记表为空 → 回落既有的 turn token 合同 -------------------
  {
    deviceKeys.saveDevices(DEVICES_PATH, { version: 1, devices: [] });
    const s3 = await startServer({ turnToken: "legacy-turn-token" });
    try {
      const legacy = await postTurn(s3.port, { bearer: "legacy-turn-token", payload: { text: "老路径" } });
      check(legacy.status === 200, "DK-8 没有登记设备时,既有 turn token 仍然能用(不回归)", legacy.status);
      const wrong = await postTurn(s3.port, { bearer: "wrong-token", payload: { text: "老路径" } });
      check(wrong.status === 401, "DK-8 错误的 token 仍然被拒", wrong.status);
    } finally {
      await closeServer(s3.server);
    }
  }

  console.log("prove_device_keys pass=" + pass + " fail=" + fail);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_device_keys crashed — " + String((e && e.stack) || e));
  console.log("prove_device_keys pass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
