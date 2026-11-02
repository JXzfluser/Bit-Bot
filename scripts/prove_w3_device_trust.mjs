#!/usr/bin/env node
/* prove_w3_device_trust.mjs — W3 "账号 = 设备" 门（WD-01..WD-11 + 11 把注入对照）
 *
 * 覆盖四件事：
 *   A2-1 配对即登记（WD-01/02/05/06/07）· A2-2 吊销热生效（WD-03/04）
 *   A2-4 地雷说人话（WD-08/09）· A2-3 手机真会签名（WD-10 金标 + WD-11 接线）
 *
 * Run: node scripts/prove_w3_device_trust.mjs            # 完整版（含注入对照，矩阵跑这个）
 *      node scripts/prove_w3_device_trust.mjs --no-inj   # 只跑主断言（子进程与快速自测用）
 *
 * ── 修复前红（修复前真实输出） ──────────────────────────────────────────
 * Before implementing device registration in redeem and hot-reload:
 *   WD-01: FAIL — redeem with device_public_key doesn't register the key
 *   WD-02: PASS — reverse control: current behavior without key works
 *   WD-03: FAIL — adding device to disk not reflected within 30s (no reload)
 *   WD-04: FAIL — removing device from disk not reflected within 30s (no reload)
 *   功能整块还没有时那一版的输出是 PASS=1 FAIL=9，逐字原文留在 report.md §8.64。
 *
 * 本轮补齐（W3 服务端三件）：
 *   WD-05 坏公钥必须把配对**整体拒掉**（400 bad_device_public_key），不许「配对成功但没登记」
 *   WD-06 同一台设备重复配对要幂等（一行，不产生第二条）；不同公钥必须是不同 id
 *   WD-07 登记成功后**立刻**能签名下单（不许等 TTL —— 自己写的盘必须立刻可见）
 *   WD-08 地雷要说人话：登记表非空时，只有 bearer 的老请求 401 必须带上
 *          error_description / next_step（既有 error 的取值一字不改）
 *   WD-09 五种设备失败各有各的话（万金油话术 = 没说），且既有 error 映射一字未改
 *
 * 端上那两件（A2-3）不能只让 Kotlin 自说自话，这里补两条腿：
 *   WD-10 跨语言金标：用 Node **现行**的 device_keys.signingPayload 重算公钥与三条签名，
 *          与已提交的 DeviceSignatureVectors.kt 逐字节比对；带反向对照（改一字节、换 deviceId 必须验不过）。
 *   WD-11 源码接线：回合 / 事件流 / 配对这三条路真的挂了签名 —— 金标只证明「这个类会签」，
 *          不证明「真发出去那趟车上有人签」。运行时那一层由 DeviceTrustWiringTest（真 ServerSocket）钉。
 *
 * 再加一段 INJ-*：**改坏产品副本、用同一判据重跑**（照 G-77 那条门的口径）。
 * WD-01..08 的红来自「功能还没有」，那种红只证明整块缺失；每把 WD 自己的分支是否真有牙，
 * 只能靠「把那一句单独弄坏，看它红不红」。做法：把 hosts/shared + 端上那几个源文件 + 本文件
 * 复制进临时目录，只改产品副本（门一字不动），子进程用同一判据跑，要求红的必须是**那一条**；
 * 补丁命中数对不上也算红 —— 跳过的对照比没有对照更危险。
 * 子进程带 --no-inj，避免无限递归。
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const SELF = fileURLToPath(import.meta.url);
const RUN_INJECTIONS = !process.argv.includes("--no-inj");
const require = createRequire(import.meta.url);

let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const skip = (m, d) => { SKIP++; console.log("  ⊘ " + m + (d ? " — SKIP: " + String(d).slice(0, 200) : "")); };
const done = () => {
  console.log("\nprove_w3_device_trust: PASS=" + PASS + " FAIL=" + FAIL + (SKIP ? " SKIP=" + SKIP : ""));
  process.exit(FAIL ? 1 : 0);
};

// ─── Dependencies ─────────────────────────────────────────────────────────────
const { createCnInboundServer } = require(path.join(REPO, "hosts/shared/cn_inbound_server.js"));
const { createPairingCodeManager } = require(path.join(REPO, "hosts/shared/desktop_pairing.js"));
const deviceKeys = require(path.join(REPO, "hosts/shared/device_keys.js"));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function httpPost(host, port, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request({
      host, port, path: urlPath, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": payload.length, ...headers },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => data += c);
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Test Setup ───────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-w3-device-trust-"));
const testToken = "w3-test-token-" + "a".repeat(48);

try {
  // ─── WD-01: Redeem with device_public_key should register it (RED) ─────────
  console.log("\n── WD-01: A2-1 配对即登记公钥 ──");
  {
    const devicesPath = path.join(TMP, "wd01-devices.json");
    const pairingMgr = createPairingCodeManager();
    const server = createCnInboundServer({
      repoRoot: TMP,
      port: 0,
      host: "0.0.0.0",
      devicesPath,
      pairingManager: pairingMgr,
      turnToken: testToken,
      onTurn: async (prompt) => ({
        ok: true,
        messages: [{ role: "assistant", text: "echo: " + prompt }],
        host_results: [],
        stdout: "echo: " + prompt,
      }),
    });

    const st = await server.start();
    const port = st.port;
    const host = "127.0.0.1";

    try {
      // Generate a device key pair
      const device = deviceKeys.generateDeviceKey({ kind: "android", name: "WD-01 Test Device" });

      // Issue pairing code
      const issued = pairingMgr.issue();
      const code = issued.code;

      // Redeem WITH device_public_key
      // 顺手带一个**诱饵 device_id**（客户端自己生成、名字很像内部机器 id）。
      // 产品必须完全无视它 —— 身份只能由服务端从公钥指纹派生。
      // 这一条不是装饰：INJ-WD_01（改成「payload.device_id 说了算」）会让 WD-01 立刻红，
      // 也就是说「任何一台 LAN 设备都能自称是别的设备」这条漏洞现在被门钉着，不是靠人记得。
      const redeemR = await httpPost(host, port, "/v1/pair/redeem", {
        code,
        device_name: device.name,
        machine_kind: "android",
        device_public_key: device.public_key_pem, // ← This field should trigger registration
        device_id: device.id, // ← 诱饵：客户端自报的身份，服务端不许照抄
      });

      if (redeemR.status !== 200) {
        bad("WD-01a redeem should return 200", "status=" + redeemR.status + " " + JSON.stringify(redeemR.json));
      } else if (!redeemR.json || !redeemR.json.ok) {
        bad("WD-01a redeem should return ok:true", JSON.stringify(redeemR.json));
      } else {
        // 登记表里必须出现这台设备。**按公钥找**，不按客户端自己生成的 id 找 ——
        // 身份必须来自服务端派发的记录（device_keys.js 的口径：机器身份来自凭证，不是来自 payload）；
        // 若允许客户端自报 id，任何 LAN 设备都能声称自己是 phone-desktop-x。
        const store = deviceKeys.loadDevices(devicesPath);
        // PEM 两端都 trim 再比：登记时服务端把进来的串 trim 过（那是写入规范，不是改内容），
        // Node 导出的 PEM 结尾带 \n —— 不 trim 就是「同一把钥匙两次字符串不同」，不是两把钥匙。
        const registered = store.devices.find(
          (d) => String(d.public_key_pem || "").trim() === device.public_key_pem.trim(),
        );

        if (!registered) {
          bad("WD-01a redeem with device_public_key should register the device",
              "device not found in store after redeem. Response: " + JSON.stringify(redeemR.json));
        } else if (String(registered.public_key_pem || "").trim() !== device.public_key_pem.trim()) {
          // 两边都用同一条归一规则比（上面查表已经 trim，这里漏了就是门的 bug，不是产品的红）。
          // 不能为了让它绿而放宽成「只要能查到就算」—— 那等于放弃「登记的就是这把钥匙」这件事本身。
          bad("WD-01a registered public key should match",
              "store=" + JSON.stringify(String(registered.public_key_pem).slice(-24)) +
              " local=" + JSON.stringify(device.public_key_pem.slice(-24)));
        } else if (registered.id === device.id) {
          bad("WD-01a 设备 id 必须由服务端派发，不许照抄客户端自报的",
              "registered.id 就是客户端那一个 " + device.id + " —— 身份变成 payload 说了算");
        } else if (!redeemR.json.device || redeemR.json.device.registered !== true) {
          bad("WD-01a redeem 回执要把登记结果如实告诉设备（device.registered / id）",
              JSON.stringify(redeemR.json.device));
        } else if (redeemR.json.device.id !== registered.id) {
          bad("WD-01a 回执里的 id 必须就是表里那一条",
              "resp=" + redeemR.json.device.id + " store=" + registered.id);
        } else {
          // 之后所有签名都用**服务端派发的那个 id**（签名内容里也包含它，见 device_keys.js signingPayload）
          const deviceId = registered.id;
          // Now try to make a signed /v1/turn request
          const ts = String(Date.now());
          const nonce = "n-wd01-" + Math.random().toString(36).slice(2);
          const body = JSON.stringify({ text: "test turn", machine_kind: "android", session_id: "wd01" });
          const bodyBuf = Buffer.from(body, "utf8");
          const sig = deviceKeys.signTurn(device.private_key_pem, deviceId, ts, nonce, bodyBuf);

          const turnR = await httpPost(host, port, "/v1/turn", {
            text: "test turn",
            machine_kind: "android",
            session_id: "wd01",
          }, {
            "x-bitbot-device": deviceId,
            "x-bitbot-timestamp": ts,
            "x-bitbot-nonce": nonce,
            "x-bitbot-signature": sig,
          });

          if (turnR.status !== 200) {
            bad("WD-01b device-signed /v1/turn should return 200",
                "status=" + turnR.status + " " + turnR.text.slice(0, 200));
          } else if (!turnR.json || !turnR.json.ok) {
            bad("WD-01b device-signed /v1/turn should return ok:true", JSON.stringify(turnR.json));
          } else {
            ok("WD-01 配对即登记公钥：redeem 带 device_public_key 后设备进登记表（id 由服务端派发），签名 turn 通过验签");
          }
        }
      }
    } finally {
      await server.stop();
    }
  }

  // ─── WD-02: Reverse control — current behavior without device_public_key (GREEN) ─
  console.log("\n── WD-02: A2-1 反向对照（不带 device_public_key 时行为不变） ──");
  {
    const devicesPath = path.join(TMP, "wd02-devices.json");
    const pairingMgr = createPairingCodeManager();
    const server = createCnInboundServer({
      repoRoot: TMP,
      port: 0,
      host: "0.0.0.0",
      devicesPath,
      pairingManager: pairingMgr,
      turnToken: testToken,
      onTurn: async (prompt) => ({
        ok: true,
        messages: [{ role: "assistant", text: "echo: " + prompt }],
        host_results: [],
        stdout: "echo: " + prompt,
      }),
    });

    const st = await server.start();
    const port = st.port;
    const host = "127.0.0.1";

    try {
      // Issue pairing code
      const issued = pairingMgr.issue();
      const code = issued.code;

      // Redeem WITHOUT device_public_key (current behavior)
      const redeemR = await httpPost(host, port, "/v1/pair/redeem", {
        code,
        device_name: "WD-02 Test",
        machine_kind: "android",
        // ← No device_public_key field
      });

      if (redeemR.status !== 200) {
        bad("WD-02a redeem without device_public_key should return 200",
            "status=" + redeemR.status + " " + JSON.stringify(redeemR.json));
      } else if (!redeemR.json || !redeemR.json.ok) {
        bad("WD-02a redeem should return ok:true", JSON.stringify(redeemR.json));
      } else if (redeemR.json.turn_token !== testToken) {
        bad("WD-02a redeem should return the shared turn_token", "token mismatch");
      } else {
        // Check that NO device was registered
        const store = deviceKeys.loadDevices(devicesPath);
        if (store.devices.length > 0) {
          bad("WD-02b redeem without device_public_key should NOT register any device",
              "found " + store.devices.length + " devices in store");
        } else {
          // Now try to use /v1/turn with the shared bearer token (current behavior)
          const turnR = await httpPost(host, port, "/v1/turn", {
            text: "test turn",
            machine_kind: "android",
          }, {
            "Authorization": "Bearer " + testToken,
          });

          if (turnR.status !== 200) {
            bad("WD-02c /v1/turn with shared bearer should return 200",
                "status=" + turnR.status + " " + turnR.text.slice(0, 200));
          } else if (!turnR.json || !turnR.json.ok) {
            bad("WD-02c /v1/turn with shared bearer should return ok:true", JSON.stringify(turnR.json));
          } else {
            ok("WD-02 反向对照：不带 device_public_key 时 redeem 成功、不登记设备、/v1/turn 仍走共享 bearer");
          }
        }
      }
    } finally {
      await server.stop();
    }
  }

  // ─── WD-03: Hot reload — adding device to disk should be reflected within 30s (RED) ─
  console.log("\n── WD-03: A2-2 吊销/登记 ≤30s 热生效（加设备） ──");
  {
    const devicesPath = path.join(TMP, "wd03-devices.json");
    // Start with empty device store
    fs.writeFileSync(devicesPath, JSON.stringify({ version: 1, devices: [] }));

    const pairingMgr = createPairingCodeManager();
    const server = createCnInboundServer({
      repoRoot: TMP,
      port: 0,
      host: "0.0.0.0",
      devicesPath,
      pairingManager: pairingMgr,
      turnToken: testToken,
      onTurn: async (prompt) => ({
        ok: true,
        messages: [{ role: "assistant", text: "echo: " + prompt }],
        host_results: [],
        stdout: "echo: " + prompt,
      }),
    });

    const st = await server.start();
    const port = st.port;
    const host = "127.0.0.1";

    try {
      // Generate a device key pair
      const device = deviceKeys.generateDeviceKey({ kind: "android", name: "WD-03 Hot Reload Device" });

      // Add device to disk (simulate external registration)
      const store = deviceKeys.loadDevices(devicesPath);
      store.devices.push({
        id: device.id,
        name: device.name,
        kind: device.kind,
        public_key_pem: device.public_key_pem,
        created_at: device.created_at,
        revoked_at: null,
      });
      deviceKeys.saveDevices(devicesPath, store);

      // Poll every 1s for up to 31s to see if the server accepts the device's signed turn
      let accepted = false;
      let lastError = "";
      const startTime = Date.now();
      const maxWait = 31000; // 31 seconds

      while (Date.now() - startTime < maxWait) {
        const ts = String(Date.now());
        const nonce = "n-wd03-" + Math.random().toString(36).slice(2);
        const body = JSON.stringify({ text: "hot reload test", machine_kind: "android", session_id: "wd03" });
        const bodyBuf = Buffer.from(body, "utf8");
        const sig = deviceKeys.signTurn(device.private_key_pem, device.id, ts, nonce, bodyBuf);

        const turnR = await httpPost(host, port, "/v1/turn", {
          text: "hot reload test",
          machine_kind: "android",
          session_id: "wd03",
        }, {
          "x-bitbot-device": device.id,
          "x-bitbot-timestamp": ts,
          "x-bitbot-nonce": nonce,
          "x-bitbot-signature": sig,
        });

        if (turnR.status === 200 && turnR.json && turnR.json.ok) {
          accepted = true;
          break;
        } else {
          lastError = "status=" + turnR.status + " " + (turnR.json ? turnR.json.error || "" : turnR.text.slice(0, 100));
        }

        await sleep(1000); // Wait 1s before next attempt
      }

      const elapsed = Date.now() - startTime;

      if (!accepted) {
        bad("WD-03 加设备后 ≤30s 热生效",
            "device added to disk but server didn't accept signed turn within 31s. Last error: " + lastError +
            " (这条红是真的缺功能：deviceStore 只在启动时 loadDevices() 一次，全仓无 reload/watch)");
      } else {
        ok("WD-03 加设备后 ≤30s 热生效：" + Math.round(elapsed / 1000) + "s 内服务器接受了新设备的签名 turn");
      }
    } finally {
      await server.stop();
    }
  }

  // ─── WD-04: Hot revoke — removing device from disk should be reflected within 30s (RED) ─
  console.log("\n── WD-04: A2-2 吊销/登记 ≤30s 热生效（删设备） ──");
  {
    const devicesPath = path.join(TMP, "wd04-devices.json");
    const device = deviceKeys.generateDeviceKey({ kind: "android", name: "WD-04 Hot Revoke Device" });

    // Start with device already registered
    const initialStore = {
      version: 1,
      devices: [{
        id: device.id,
        name: device.name,
        kind: device.kind,
        public_key_pem: device.public_key_pem,
        created_at: device.created_at,
        revoked_at: null,
      }],
    };
    deviceKeys.saveDevices(devicesPath, initialStore);

    const pairingMgr = createPairingCodeManager();
    const server = createCnInboundServer({
      repoRoot: TMP,
      port: 0,
      host: "0.0.0.0",
      devicesPath,
      pairingManager: pairingMgr,
      turnToken: testToken,
      onTurn: async (prompt) => ({
        ok: true,
        messages: [{ role: "assistant", text: "echo: " + prompt }],
        host_results: [],
        stdout: "echo: " + prompt,
      }),
    });

    const st = await server.start();
    const port = st.port;
    const host = "127.0.0.1";

    try {
      // First verify the device can sign a turn (should work initially)
      const ts1 = String(Date.now());
      const nonce1 = "n-wd04-init-" + Math.random().toString(36).slice(2);
      const body1 = JSON.stringify({ text: "initial test", machine_kind: "android", session_id: "wd04" });
      const bodyBuf1 = Buffer.from(body1, "utf8");
      const sig1 = deviceKeys.signTurn(device.private_key_pem, device.id, ts1, nonce1, bodyBuf1);

      const initR = await httpPost(host, port, "/v1/turn", {
        text: "initial test",
        machine_kind: "android",
        session_id: "wd04",
      }, {
        "x-bitbot-device": device.id,
        "x-bitbot-timestamp": ts1,
        "x-bitbot-nonce": nonce1,
        "x-bitbot-signature": sig1,
      });

      if (initR.status !== 200 || !initR.json || !initR.json.ok) {
        bad("WD-04 setup: device should be able to sign turn initially",
            "status=" + initR.status + " " + JSON.stringify(initR.json));
      } else {
        // Now remove the device from disk (simulate revocation)
        const store = deviceKeys.loadDevices(devicesPath);
        store.devices = store.devices.filter((d) => d.id !== device.id);
        deviceKeys.saveDevices(devicesPath, store);

        // Poll every 1s for up to 31s to see if the server rejects the device's signed turn
        let rejected = false;
        let lastStatus = "";
        const startTime = Date.now();
        const maxWait = 31000; // 31 seconds

        while (Date.now() - startTime < maxWait) {
          const ts = String(Date.now());
          const nonce = "n-wd04-" + Math.random().toString(36).slice(2);
          const body = JSON.stringify({ text: "after revoke test", machine_kind: "android", session_id: "wd04" });
          const bodyBuf = Buffer.from(body, "utf8");
          const sig = deviceKeys.signTurn(device.private_key_pem, device.id, ts, nonce, bodyBuf);

          const turnR = await httpPost(host, port, "/v1/turn", {
            text: "after revoke test",
            machine_kind: "android",
            session_id: "wd04",
          }, {
            "x-bitbot-device": device.id,
            "x-bitbot-timestamp": ts,
            "x-bitbot-nonce": nonce,
            "x-bitbot-signature": sig,
          });

          // After removal, server should reject with 401 (unknown_device or similar)
          if (turnR.status === 401) {
            rejected = true;
            break;
          } else {
            lastStatus = "status=" + turnR.status + " " + (turnR.json ? turnR.json.error || "" : "");
          }

          await sleep(1000); // Wait 1s before next attempt
        }

        const elapsed = Date.now() - startTime;

        if (!rejected) {
          bad("WD-04 删设备后 ≤30s 热生效",
              "device removed from disk but server still accepted signed turn after 31s. Last status: " + lastStatus +
              " (这条红是真的缺功能：deviceStore 只在启动时 loadDevices() 一次，全仓无 reload/watch)");
        } else {
          ok("WD-04 删设备后 ≤30s 热生效：" + Math.round(elapsed / 1000) + "s 内服务器拒绝了已删除设备的签名 turn");
        }
      }
    } finally {
      await server.stop();
    }
  }

  // ─── WD-05: 坏公钥必须把配对整体拒掉（不许「配对成功但没登记」这种半死状态）───
  console.log("\n── WD-05: A2-1 坏公钥 → redeem 整体失败 ──");
  {
    const devicesPath = path.join(TMP, "wd05-devices.json");
    fs.writeFileSync(devicesPath, JSON.stringify({ version: 1, devices: [] }));
    const pairingMgr = createPairingCodeManager();
    const server = createCnInboundServer({
      repoRoot: TMP, port: 0, host: "0.0.0.0", devicesPath,
      pairingManager: pairingMgr, turnToken: testToken,
      onTurn: async (prompt) => ({ ok: true, messages: [{ role: "assistant", text: "echo: " + prompt }], host_results: [], stdout: "echo: " + prompt }),
    });
    const st = await server.start();
    const port = st.port, host = "127.0.0.1";
    try {
      const issued = pairingMgr.issue();
      const r1 = await httpPost(host, port, "/v1/pair/redeem", {
        code: issued.code, device_name: "WD-05", machine_kind: "android",
        device_public_key: "-----BEGIN PUBLIC KEY-----\nnot-a-real-key\n-----END PUBLIC KEY-----",
      });
      const store = deviceKeys.loadDevices(devicesPath);
      if (r1.status === 400 && r1.json && r1.json.error === "bad_device_public_key" && store.devices.length === 0) {
        ok("WD-05a 坏公钥被整体拒（400 bad_device_public_key，登记表没被写脏）");
      } else {
        bad("WD-05a 坏公钥被整体拒",
            "status=" + r1.status + " body=" + JSON.stringify(r1.json) + " 表里条数=" + store.devices.length +
            "（红是真的缺功能：现在 redeem 根本不认识这个字段，坏钥匙进来也是 200，设备拿着 bearer 走进下一条地雷）");
      }

      // 能解析、但不是 ed25519 的公钥（RSA）也要拒 —— 验签那条路只认 ed25519
      const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
      const issued2 = pairingMgr.issue();
      const r2 = await httpPost(host, port, "/v1/pair/redeem", {
        code: issued2.code, device_name: "WD-05b", machine_kind: "android", device_public_key: rsa,
      });
      if (r2.status === 400 && r2.json && r2.json.error === "device_key_not_ed25519") {
        ok("WD-05b 非 ed25519 公钥被点名拒（device_key_not_ed25519），不是一句 bad_request 打发");
      } else {
        bad("WD-05b 非 ed25519 公钥要被点名拒",
            "status=" + r2.status + " body=" + JSON.stringify(r2.json));
      }
    } finally {
      await server.stop();
    }
  }

  // ─── WD-06: 重复配对幂等；不同公钥必须不同 id ───
  console.log("\n── WD-06: A2-1 同钥匙幂等、不同钥匙不同身份 ──");
  {
    const devicesPath = path.join(TMP, "wd06-devices.json");
    fs.writeFileSync(devicesPath, JSON.stringify({ version: 1, devices: [] }));
    const pairingMgr = createPairingCodeManager();
    const server = createCnInboundServer({
      repoRoot: TMP, port: 0, host: "0.0.0.0", devicesPath,
      pairingManager: pairingMgr, turnToken: testToken,
      onTurn: async (prompt) => ({ ok: true, messages: [{ role: "assistant", text: "echo: " + prompt }], host_results: [], stdout: "echo: " + prompt }),
    });
    const st = await server.start();
    const port = st.port, host = "127.0.0.1";
    try {
      const devA = deviceKeys.generateDeviceKey({ kind: "android", name: "WD-06 A" });
      const devB = deviceKeys.generateDeviceKey({ kind: "android", name: "WD-06 B" });

      const i1 = pairingMgr.issue();
      const r1 = await httpPost(host, port, "/v1/pair/redeem", { code: i1.code, device_name: devA.name, machine_kind: "android", device_public_key: devA.public_key_pem });
      const i2 = pairingMgr.issue();
      const r2 = await httpPost(host, port, "/v1/pair/redeem", { code: i2.code, device_name: devA.name + "（重连）", machine_kind: "android", device_public_key: devA.public_key_pem });
      const i3 = pairingMgr.issue();
      const r3 = await httpPost(host, port, "/v1/pair/redeem", { code: i3.code, device_name: devB.name, machine_kind: "android", device_public_key: devB.public_key_pem });

      const store = deviceKeys.loadDevices(devicesPath);
      const idA = r1.json && r1.json.device ? r1.json.device.id : null;
      const idA2 = r2.json && r2.json.device ? r2.json.device.id : null;
      const idB = r3.json && r3.json.device ? r3.json.device.id : null;

      // 断言顺序是**先身份、后行数**：第一版反过来，于是「id 不含公钥指纹」这把注入
      // 落在「表里 1 行」上（也红，但报的是别的因）。改成先比 id，两把注入各自红各自的分支，
      // 红才说得出真正坏掉的是哪件事。
      if (!idA || !idA2 || !idB) {
        bad("WD-06a 三次配对都要在回执里给出登记的 id",
            "idA=" + idA + " idA2=" + idA2 + " idB=" + idB);
      } else if (idA === idB) {
        bad("WD-06a 不同公钥必须是不同身份（id 由公钥指纹派生）",
            "两把不同的钥匙拿到同一个 id=" + idA + " —— 第二台设备会顶用第一台的身份");
      } else if (idA !== idA2) {
        bad("WD-06a 同一把钥匙重复配对要拿到同一个 id（幂等，不产生第二身份）",
            "id1=" + idA + " id2=" + idA2);
      } else if (store.devices.length !== 2) {
        bad("WD-06a 同一把公钥重复配对必须只留一行（不同公钥各一行）",
            "表里 " + store.devices.length + " 行，应为 2 行（A 两次 + B 一次）");
      } else {
        ok("WD-06 同钥匙幂等（同一个 id、表里不增行）、不同钥匙不同 id（" + idA + " / " + idB + "）");
      }
    } finally {
      await server.stop();
    }
  }

  // ─── WD-07: 登记成功后立刻能签名下单（自己写的盘必须立刻可见）───
  console.log("\n── WD-07: A2-2 配对后零等待即可签名下单 ──");
  {
    const devicesPath = path.join(TMP, "wd07-devices.json");
    fs.writeFileSync(devicesPath, JSON.stringify({ version: 1, devices: [] }));
    const pairingMgr = createPairingCodeManager();
    const server = createCnInboundServer({
      repoRoot: TMP, port: 0, host: "0.0.0.0", devicesPath,
      pairingManager: pairingMgr, turnToken: testToken,
      onTurn: async (prompt) => ({ ok: true, messages: [{ role: "assistant", text: "echo: " + prompt }], host_results: [], stdout: "echo: " + prompt }),
    });
    const st = await server.start();
    const port = st.port, host = "127.0.0.1";
    try {
      const dev = deviceKeys.generateDeviceKey({ kind: "android", name: "WD-07" });
      const issued = pairingMgr.issue();
      const redeemR = await httpPost(host, port, "/v1/pair/redeem", { code: issued.code, device_name: dev.name, machine_kind: "android", device_public_key: dev.public_key_pem });
      const id = redeemR.json && redeemR.json.device ? redeemR.json.device.id : dev.id;

      const ts = String(Date.now());
      const nonce = "n-wd07-" + Math.random().toString(36).slice(2);
      const body = JSON.stringify({ text: "刚配对完就发一条", machine_kind: "android", session_id: "wd07" });
      const sig = deviceKeys.signTurn(dev.private_key_pem, id, ts, nonce, Buffer.from(body, "utf8"));
      const t0 = Date.now();
      const turnR = await httpPost(host, port, "/v1/turn", JSON.parse(body), {
        "x-bitbot-device": id, "x-bitbot-timestamp": ts, "x-bitbot-nonce": nonce, "x-bitbot-signature": sig,
      });
      if (turnR.status === 200 && turnR.json && turnR.json.ok) {
        ok("WD-07 配对成功 → 立刻签名下单通过（零等待 " + (Date.now() - t0) + "ms，不等任何重载窗口）");
      } else {
        bad("WD-07 配对成功 → 立刻签名下单通过",
            "status=" + turnR.status + " " + (turnR.text || "").slice(0, 160) +
            "（红是真的缺功能：登记写盘与读盘之间只要有 TTL 缓存而不失效，最短的那条路「配完就发」就会 401）");
      }
    } finally {
      await server.stop();
    }
  }

  // ─── WD-08: 地雷要说人话（既有 error 一字不改，新增字段给出路）───
  console.log("\n── WD-08: A2-4 登记表非空时 bearer 的 401 必须说清楚 ──");
  {
    const devicesPath = path.join(TMP, "wd08-devices.json");
    const dev = deviceKeys.generateDeviceKey({ kind: "android", name: "WD-08" });
    deviceKeys.saveDevices(devicesPath, { version: 1, devices: [{ id: dev.id, name: dev.name, kind: dev.kind, public_key_pem: dev.public_key_pem, created_at: dev.created_at, revoked_at: null }] });

    const pairingMgr = createPairingCodeManager();
    const server = createCnInboundServer({
      repoRoot: TMP, port: 0, host: "0.0.0.0", devicesPath,
      pairingManager: pairingMgr, turnToken: testToken,
      onTurn: async (prompt) => ({ ok: true, messages: [{ role: "assistant", text: "echo: " + prompt }], host_results: [], stdout: "echo: " + prompt }),
    });
    const st = await server.start();
    const port = st.port, host = "127.0.0.1";
    try {
      const turnR = await httpPost(host, port, "/v1/turn", { text: "bearer only", machine_kind: "android", session_id: "wd08" }, {
        Authorization: "Bearer " + testToken,
      });
      const ev = await new Promise((resolve, reject) => {
        const req = http.request({ host, port, path: "/v1/events?session_id=wd08", method: "GET", headers: { Authorization: "Bearer " + testToken } }, (res) => {
          let d = ""; res.setEncoding("utf8"); res.on("data", (c) => { d += c; if (d.length > 400) res.destroy(); }); res.on("end", () => resolve({ status: res.statusCode, text: d }));
        });
        req.on("error", reject);
        req.setTimeout(4000, () => req.destroy(new Error("timeout")));
        req.end();
      });

      const explainOk = (o) => o && typeof o.error_description === "string" && o.error_description.length > 0 && typeof o.next_step === "string" && o.next_step.length > 0;
      if (turnR.status !== 401) {
        bad("WD-08a 登记表非空时 bearer 必须 401", "status=" + turnR.status);
      } else if (!explainOk(turnR.json)) {
        bad("WD-08a /v1/turn 的 401 要带 error_description / next_step（把地雷说人话）",
            JSON.stringify(turnR.json));
      } else if (turnR.json.device_error !== "missing_device_credential") {
        bad("WD-08a 401 要把真实原因带出来（device_error），error 本身仍照既有映射",
            JSON.stringify(turnR.json));
      } else {
        ok("WD-08a /v1/turn 的 401 会说人话：" + turnR.json.error_description + " / " + turnR.json.next_step);
      }

      let evJson = null;
      try { evJson = JSON.parse(ev.text); } catch (_) { /* SSE 头不是 JSON */ }
      if (ev.status !== 401) {
        bad("WD-08b /v1/events 同样只认设备凭证（本轮把地雷范围从「下不了单」扩到「看不见自己的单」）",
            "status=" + ev.status);
      } else if (!explainOk(evJson)) {
        bad("WD-08b /v1/events 的 401 也要带 error_description / next_step", ev.text.slice(0, 160));
      } else {
        ok("WD-08b /v1/events 的 401 也会说人话：" + evJson.error_description);
      }
    } finally {
      await server.stop();
    }
  }

  // ─── WD-09: 五类坏凭证各打一次 —— 码要对、话要各不相同（不许是一句万金油）───
  // A2-4 说「把地雷说人话」，说的是什么？如果五种失败都回同一句话，那句话等于没说：
  // 「重新配对」对时间漂移的用户是误导，「校准时间」对设备被吊销的用户是误导。
  // 所以这里的判据是 **五个 error_description / next_step 两两不同**，而不是「非空」。
  console.log("\n── WD-09: 五类设备凭证失败各有其码、各有其话 ──");
  {
    const devicesPath = path.join(TMP, "wd09-devices.json");
    const dev = deviceKeys.generateDeviceKey({ kind: "android", name: "WD-09" });
    deviceKeys.saveDevices(devicesPath, { version: 1, devices: [{ id: dev.id, name: dev.name, kind: dev.kind, public_key_pem: dev.public_key_pem, created_at: dev.created_at, revoked_at: null }] });
    const pairingMgr = createPairingCodeManager();
    const server = createCnInboundServer({
      repoRoot: TMP, port: 0, host: "0.0.0.0", devicesPath,
      pairingManager: pairingMgr, turnToken: testToken,
      onTurn: async (prompt) => ({ ok: true, messages: [{ role: "assistant", text: "echo: " + prompt }], host_results: [], stdout: "echo: " + prompt }),
    });
    const st = await server.start();
    const port = st.port, host = "127.0.0.1";
    try {
      const body = { text: "wd09", machine_kind: "android", session_id: "wd09" };
      const post = (headers) => httpPost(host, port, "/v1/turn", body, headers);

      // ① 什么都没带 → missing_device_credential
      const r1 = await post({});
      // ② 带了一张不存在的设备的签名（身份不在表里）→ unknown_device
      const ghost = deviceKeys.generateDeviceKey({ kind: "android", name: "WD-09 ghost" });
      const tsG = String(Date.now());
      const nG = "n-wd09-ghost-" + Math.random().toString(36).slice(2);
      const r2 = await post({
        "x-bitbot-device": ghost.id, "x-bitbot-timestamp": tsG, "x-bitbot-nonce": nG,
        "x-bitbot-signature": deviceKeys.signTurn(ghost.private_key_pem, ghost.id, tsG, nG, Buffer.from(JSON.stringify(body), "utf8")),
      });
      // ③ 时间戳漂到 10 分钟以后（签名本身是自洽的）→ stale_timestamp
      const tsS = String(Date.now() + 10 * 60 * 1000);
      const nS = "n-wd09-stale-" + Math.random().toString(36).slice(2);
      const r3 = await post({
        "x-bitbot-device": dev.id, "x-bitbot-timestamp": tsS, "x-bitbot-nonce": nS,
        "x-bitbot-signature": deviceKeys.signTurn(dev.private_key_pem, dev.id, tsS, nS, Buffer.from(JSON.stringify(body), "utf8")),
      });
      // ④ 先走一次正常请求把 nonce 用掉，再拿同一个 nonce 重放 → nonce_reused
      const tsN = String(Date.now());
      const nN = "n-wd09-replay-" + Math.random().toString(36).slice(2);
      const sigN = deviceKeys.signTurn(dev.private_key_pem, dev.id, tsN, nN, Buffer.from(JSON.stringify(body), "utf8"));
      const first = await post({ "x-bitbot-device": dev.id, "x-bitbot-timestamp": tsN, "x-bitbot-nonce": nN, "x-bitbot-signature": sigN });
      const r4 = await post({ "x-bitbot-device": dev.id, "x-bitbot-timestamp": tsN, "x-bitbot-nonce": nN, "x-bitbot-signature": sigN });
      // ⑤ 头都对，签名是乱填的 → bad_signature
      const tsB = String(Date.now());
      const nB = "n-wd09-badsig-" + Math.random().toString(36).slice(2);
      const r5 = await post({ "x-bitbot-device": dev.id, "x-bitbot-timestamp": tsB, "x-bitbot-nonce": nB, "x-bitbot-signature": Buffer.from("x".repeat(64)).toString("base64") });

      const cases = [
        ["WD-09a missing_device_credential", r1, "missing_device_credential"],
        ["WD-09b unknown_device", r2, "unknown_device"],
        ["WD-09c stale_timestamp", r3, "stale_timestamp"],
        ["WD-09d nonce_reused", r4, "nonce_reused"],
        ["WD-09e bad_signature", r5, "bad_signature"],
      ];
      const seenDesc = new Map();
      for (const [label, resp, code] of cases) {
        const j = resp.json || {};
        // 真实原因码的读法（这是**合同的形状**，不是门的宽松）：
        //   · error  = 既有映射（客户端与别的门在分支它，一字不许改）
        //   · device_error = 设备鉴权那条路的**真原因**，只有它与 error 不同才多发（去重）
        // 门的第一版在这里错了两次，都留了原文：
        //   ① 以为 device_error 必带 ⇒ stale_timestamp / nonce_reused / bad_signature 三条红
        //      （它们本来就在既有映射里，error 已经说了同一件事）；
        //   ② 改成「两个字段同时出现必须一致」⇒ missing_device_credential / unknown_device 两条红
        //      （这俩的 error 归 unauthorized，device_error 才是真原因 —— **不一致正是它的用途**）。
        // 钉的是「真原因优先从 device_error 读，读不到就用 error；两者都必须能对上那一个码」。
        const carried = j.device_error || j.error;
        if (resp.status !== 401) {
          bad(label + " 必须 401", "status=" + resp.status + " body=" + JSON.stringify(j) +
            (code === "nonce_reused" && first.status !== 200 ? "；另外那条「先走正常一次」也没成（status=" + first.status + "），重放对照不成立" : ""));
        } else if (carried !== code) {
          bad(label + " 真实原因码要能读出来（error 或 device_error 之一）",
              "error=" + j.error + " device_error=" + j.device_error + " body=" + JSON.stringify(j));
        } else if (!j.error_description || !j.next_step) {
          bad(label + " 必须带 error_description / next_step", JSON.stringify(j));
        } else {
          const dup = seenDesc.get(j.error_description);
          if (dup) {
            bad(label + " 的解释与「" + dup + "」一模一样（万金油话术 = 没说）", j.error_description);
          } else {
            seenDesc.set(j.error_description, label);
            ok(label + " 码与话都对：" + j.error_description + " → " + j.next_step);
          }
        }
      }
      // 既有 `error` 的取值一字未改：五个码里只有 bad_signature/stale_timestamp/nonce_reused
      // 在既有映射名单内（会原样透出），missing_device_credential / unknown_device 归 unauthorized。
      const errMap = { "WD-09a": "unauthorized", "WD-09b": "unauthorized", "WD-09c": "stale_timestamp", "WD-09d": "nonce_reused", "WD-09e": "bad_signature" };
      const legacy = [["WD-09a", r1], ["WD-09b", r2], ["WD-09c", r3], ["WD-09d", r4], ["WD-09e", r5]]
        .filter(([k, resp]) => resp.json && resp.json.error !== errMap[k]);
      if (legacy.length) {
        bad("WD-09f 既有 error 的映射一字不能改（别的门与客户端在分支这个字段）",
            legacy.map(([k, resp]) => k + " 得到 " + JSON.stringify(resp.json && resp.json.error)).join("；"));
      } else {
        ok("WD-09f 五个失败各自的 error 与既有映射完全一致（新增信息全在 device_error / error_description / next_step 里）");
      }
    } finally {
      await server.stop();
    }
  }

  // ─── WD-10 / WD-11 ─────────────────────────────────────────────────────────
  // 端上（Kotlin）这一层的证据分两条腿，缺一条都会假绿：
  //   WD-10 金标：**Node 现行代码**重算的公钥与三条签名，必须与已提交的 Kotlin 金标逐字节相同。
  //          ed25519 是确定性签名（RFC 8032）⇒ 「不一样」只有「实现错了」这一种解释，
  //          没有「等价但写法不同」的余地。改了 signingPayload 不打算改端上，这里必红。
  //   WD-11 接线：金标只证明「这个类会签」，不证明「真发出去那条路上有人去签」。
  //          这里钉的是源码接线（TurnBridge / EventStreamClient / DesktopPairing / MainActivity）。
  //          诚实边界：WD-11 是结构钉，不证明运行时；运行时由 DeviceTrustWiringTest（真 ServerSocket）钉，
  //          而「桌面真验得过这台手机的签名」由本门 WD-01..09（服务端真验）支撑。本机无 KVM，真机未验。
  const ANDROID_FILES = [
    "hosts/android/BitBotHost/app/src/test/java/com/bitbot/host/DeviceSignatureVectors.kt",
    "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnBridge.kt",
    "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/EventStreamClient.kt",
    "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnCoordinator.kt",
    "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/DesktopPairing.kt",
    "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/DeviceIdentity.kt",
    "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/MainActivity.kt",
  ];
  const readKt = (rel) => {
    try {
      return fs.readFileSync(path.join(REPO, rel), "utf8");
    } catch (_) {
      return null;
    }
  };
  const ktStr = (raw) =>
    raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  console.log("\n── WD-10: 跨语言金标（Node 重算 ≡ 已提交的 Kotlin 金标） ──");
  {
    const rel = "hosts/android/BitBotHost/app/src/test/java/com/bitbot/host/DeviceSignatureVectors.kt";
    const src = readKt(rel);
    if (!src) {
      bad("WD-10 金标文件不在了（端上就没有跨语言基线）", rel);
    } else {
      const grab = (name) => {
        const m = new RegExp("const val " + name + ": String = \"((?:[^\"\\\\]|\\\\.)*)\"").exec(src);
        return m ? ktStr(m[1]) : null;
      };
      const seedHex = grab("SEED_HEX");
      const goldenPem = grab("PUBLIC_KEY_PEM");
      const goldenDeviceId = grab("DEVICE_ID");
      const goldenTs = grab("TIMESTAMP");
      const goldenNonce = grab("NONCE");
      const vecs = [...src.matchAll(
        /label = "((?:[^"\\]|\\.)*)",\s*body = "((?:[^"\\]|\\.)*)",\s*signatureBase64 = "((?:[^"\\]|\\.)*)"/g,
      )].map((m) => ({ label: ktStr(m[1]), body: ktStr(m[2]), sig: ktStr(m[3]) }));
      const missing = [
        ["SEED_HEX", seedHex], ["PUBLIC_KEY_PEM", goldenPem], ["DEVICE_ID", goldenDeviceId],
        ["TIMESTAMP", goldenTs], ["NONCE", goldenNonce],
      ].filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) {
        bad("WD-10a 金标字段读不出来（文件形状变了，比对无从做起）", missing.join("、"));
      } else if (vecs.length !== 3) {
        // 不是「凑够三条」：0 条的金标文件一样能「绿」，那才是最难发现的假绿。
        bad("WD-10a 金标必须是三条（ASCII / 中文多字节 / 空 body），实到 " + vecs.length, "少了就是被删空，多了没人核对过");
      } else {
        const privPem =
          "-----BEGIN PRIVATE KEY-----\n" +
          Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seedHex, "hex")])
            .toString("base64").replace(/(.{64})/g, "$1\n") +
          "-----END PRIVATE KEY-----\n";
        const recomputedPem = crypto.createPublicKey(crypto.createPrivateKey(privPem))
          .export({ type: "spki", format: "pem" }).toString();
        if (recomputedPem !== goldenPem) {
          bad("WD-10b 同一个 seed 推出来的公钥与金标不一致（端上 SPKI 拼法或服务端密钥派生变了）",
              "Node=" + JSON.stringify(recomputedPem) + " 金标=" + JSON.stringify(goldenPem));
        } else {
          ok("WD-10b seed→SPKI 公钥逐字符相同（端上那套 DER 外壳与折行是对的）");
        }
        let same = 0, diff = [];
        for (const v of vecs) {
          const bodyBuf = Buffer.from(v.body, "utf8");
          const sig = crypto.sign(null, deviceKeys.signingPayload(goldenDeviceId, goldenTs, goldenNonce, bodyBuf),
            crypto.createPrivateKey(privPem)).toString("base64");
          if (sig === v.sig) same++;
          else diff.push(v.label + "（Node=" + sig.slice(0, 24) + "… 金标=" + v.sig.slice(0, 24) + "…）");
        }
        if (diff.length) {
          bad("WD-10c 被签的串或签名本身与金标不一致 —— 改了约定就必须两边一起改、一起留证据", diff.join(" / "));
        } else {
          ok("WD-10c 三条 payload 的签名逐字节相同（ASCII / 中文多字节 / 空 body 只有三行前缀）");
        }
        // 这条是**给上面那条加牙**：如果 verify 恒真，逐字节相同也说明不了什么。
        const tampered = vecs.map((v) => {
          const b = Buffer.from(v.body, "utf8");
          // 改第一个字节（ASCII 里 ^0x20 只是大小写互换，长度不变）；空 body 就加一字节。
          const mutated = b.length
            ? Buffer.concat([Buffer.from([b[0] ^ 0x20]), b.subarray(1)])
            : Buffer.from("x", "utf8");
          return crypto.verify(null, deviceKeys.signingPayload(goldenDeviceId, goldenTs, goldenNonce, mutated),
            crypto.createPublicKey(goldenPem), Buffer.from(v.sig, "base64"));
        });
        if (tampered.some((t) => t)) {
          bad("WD-10d 反向对照失效：改了 body 一个字节还能验过，上面那条「相同」就是摆设");
        } else {
          ok("WD-10d 反向对照有牙：三条改动一字节后全部验不过");
        }
        // 身份是签名的**输入**，不是可选注释：换 id 必须验不过（服务端 :854 那条口径的同一件事）。
        const swapped = crypto.verify(null,
          deviceKeys.signingPayload(goldenDeviceId + "-other", goldenTs, goldenNonce, Buffer.from(vecs[0].body, "utf8")),
          crypto.createPublicKey(goldenPem), Buffer.from(vecs[0].sig, "base64"));
        if (swapped) {
          bad("WD-10e 换 deviceId 还能验过 ⇒ 身份没有进签名，任何设备都能冒充别台");
        } else {
          ok("WD-10e 换 deviceId 验不过（身份在签名里，冒充别台设备签不出来）");
        }
      }
    }
  }

  console.log("\n── WD-11: 端上接线（源码里真挂上了，不是只有个会签的类） ──");
  {
    const tb = readKt("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnBridge.kt") || "";
    const esc = readKt("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/EventStreamClient.kt") || "";
    const tc = readKt("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnCoordinator.kt") || "";
    const dp = readKt("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/DesktopPairing.kt") || "";
    const di = readKt("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/DeviceIdentity.kt") || "";
    const ma = readKt("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/MainActivity.kt") || "";

    // a) POST 这条路：先定字节 → 按这串字节签 → 发的就是这串字节（顺序错了就是 bad_signature）。
    const a = tb.includes("DeviceIdentity.requestHeaders(appContext, bodyBytes)") &&
      /DeviceIdentity\.applyHeaders\(/.test(tb) &&
      tb.includes("it.write(bodyBytes)");
    if (a) ok("WD-11a /v1/turn 按「实际要发出去的那串字节」签名并挂头");
    else bad("WD-11a 回合这条路没接上签名（签的字节与发的字节可能不是同一份）",
      "requestHeaders=" + tb.includes("DeviceIdentity.requestHeaders(appContext, bodyBytes)") +
      " applyHeaders=" + /DeviceIdentity\.applyHeaders\(/.test(tb) + " write(bodyBytes)=" + tb.includes("it.write(bodyBytes)"));

    // b) SSE 这条路：GET 的 body 是空的，且**每次连接都要现签**（抄上一次 = nonce_reused）。
    const b = /connectAndRead[\s\S]{0,1400}?DeviceIdentity\.requestHeaders\(\s*identityContext,\s*ByteArray\(0\)/.test(esc) &&
      /DeviceIdentity\.applyHeaders\(/.test(esc);
    if (b) ok("WD-11b 事件流每次连接现签（空 body 也签），不会把上一次的头抄过来");
    else bad("WD-11b 事件流没在「每次连接」处签名（重连会拿旧 nonce，服务端直接 nonce_reused）",
      "connectAndRead 里找不到现签的调用");

    // c) 身份要从 Activity 一路传到订阅：断在这一环的表现是「POST 能签、SSE 不能签」。
    const c = tc.includes("TurnBridge.context()") && /identityContext/.test(esc);
    if (c) ok("WD-11c 订阅拿得到这台设备的身份（协调器把 context 传下去了）");
    else bad("WD-11c 订阅拿不到身份：回合签得了、事件流签不了（手机看不见自己下的单）",
      "TurnCoordinator 传 context=" + tc.includes("TurnBridge.context()") + " 订阅有参数=" + /identityContext/.test(esc));

    // d) 配对：公钥要交出去，身份**只认服务端派发的**（不许端上自己编一个 id 就当真登记上了）。
    const d = dp.includes("device_public_key") &&
      /if \(deviceRegistered && issuedDeviceId != null/.test(dp);
    if (d) ok("WD-11d redeem 发公钥，且只有桌面回执说登记了才写回派发 id");
    else bad("WD-11d 配对没把公钥交出去，或端上自己造身份（服务端派发的才算）",
      "发公钥=" + dp.includes("device_public_key") + " 只认回执=" + /if \(deviceRegistered && issuedDeviceId != null/.test(dp));

    // e) 老调用方不能被拖下水：没有 Context 时必须保持原形状（bearer-only）。
    const e = /identityContext: android\.content\.Context\? = TurnBridge\.context\(\)/.test(dp) &&
      /val identity = identityContext\?\.let \{ DeviceIdentity\.loadOrCreate\(it\) \}/.test(dp) &&
      di.includes("fun requestHeaders(context: Context?, body: ByteArray)");
    if (e) ok("WD-11e 身份参数可空：没有 Context（纯 JVM 测试、老调用方）就一个签名头都不挂");
    else bad("WD-11e 无 Context 的调用路径会被改成强制签名（或反之：有钥匙也不签）",
      "redeem 可空参=" + /identityContext: android\.content\.Context\? = TurnBridge\.context\(\)/.test(dp) +
      " 只读不生成=" + /val identity = identityContext\?\.let \{ DeviceIdentity\.loadOrCreate\(it\) \}/.test(dp));

    // f) 「登记没登记上」必须能被用户看见 —— 否则就是配好了却一路 401 的哑谜。
    const f = ma.includes("deviceTrustNotice");
    if (f) ok("WD-11f 配对结果里的设备登记状态会真的上屏");
    else bad("WD-11f 桌面回执说「没登记上」时界面什么都不说（下一步一定 401）");
  }

  // ─── INJ-*：改坏产品副本 → 用同一判据重跑，红必须落在对应那一条 WD 上 ───
  if (RUN_INJECTIONS) {
    console.log("\n── INJ: 注入对照（只改产品副本，门一字不动） ──");
    const INJ = [
      ["INJ-WD_01", "登记的身份改成「payload.device_id 说了算」",
        [['const id = "dev-" + kind + "-" + fingerprint;',
          'const id = String((input && input.selfReportedId) || "").trim() || ("dev-" + kind + "-" + fingerprint);', 1],
         ['            name: deviceName || machineKind + " 设备",',
          '            name: deviceName || machineKind + " 设备",\n            selfReportedId: String(payload.device_id || "").trim(),', 1]],
        ["设备 id 必须由服务端派发"]],
      ["INJ-WD_03_04", "去掉惰性重载（回到「只在启动时读一次表」）",
        [["    deviceStore = deviceKeys.loadDevices(devicesPath);\n    return deviceStore;", "    return deviceStore;", 1]],
        ["加设备后 ≤30s 热生效", "删设备后 ≤30s 热生效"]],
      ["INJ-WD_05", "坏公钥不再整体拒（回到 200 + registered:false）",
        [["          if (!reg.ok) {", "          if (false && !reg.ok) {", 1]],
        ["坏公钥被整体拒", "非 ed25519 公钥要被点名拒"]],
      ["INJ-WD_06a", "重复配对不覆盖旧行（同一把钥匙产生第二行）",
        [["    if (existing) list[list.indexOf(existing)] = record;\n    else list.push(record);", "    list.push(record);", 1]],
        ["同一把公钥重复配对必须只留一行"]],
      ["INJ-WD_06b", "id 里不含公钥指纹（不同钥匙撞成同一个身份）",
        [['const id = "dev-" + kind + "-" + fingerprint;', 'const id = "dev-" + kind;', 1]],
        ["不同公钥必须是不同身份"]],
      ["INJ-WD_06c", "id 里掺随机后缀（同一把钥匙第二次配对拿到另一个身份）",
        [['const id = "dev-" + kind + "-" + fingerprint;',
          'const id = "dev-" + kind + "-" + fingerprint + "-" + crypto.randomBytes(3).toString("hex");', 1]],
        ["同一把钥匙重复配对要拿到同一个 id"]],
      ["INJ-WD_07", "自己写完盘不失效缓存（配对完立刻下单要等 TTL）",
        [["    invalidateDeviceStore();", "    // invalidateDeviceStore();", 1]],
        ["配对成功 → 立刻签名下单通过"]],
      ["INJ-WD_08", "401 不再说人话（去掉 error_description / next_step）",
        [["          auth.error_description = describeDeviceAuthFailure(auth.error, req);", "          // (injected)", 2]],
        ["/v1/turn 的 401 要带 error_description", "/v1/events 的 401 也要带 error_description"]],
      ["INJ-WD_09", "五种失败回同一句话（万金油话术）",
        [['  }[String(code || "")];\n  return base || "设备凭证校验未通过：" + String(code || "unauthorized");',
         '  }[String(code || "")];\n  return "设备凭证校验未通过（请重新配对）";', 1]],
        ["一模一样（万金油话术 = 没说）"]],
      // WD-10 的对照改的是**共享的签名约定**（device_keys.js），不是某端的实现：
      // 服务端自己签、自己验，改了一致地坏在两边都看不见的地方 —— 金标就是为了让它藏不住。
      ["INJ-WD_10", "签名约定里少了 nonce 那一行（服务端自签自验仍然自洽）",
        [['    Buffer.from(String(deviceId) + "\\n" + String(ts) + "\\n" + String(nonce) + "\\n", "utf8"),',
          '    Buffer.from(String(deviceId) + "\\n" + String(ts) + "\\n", "utf8"),', 1]],
        ["WD-10c"], "hosts/shared/device_keys.js"],
      ["INJ-WD_11", "回合照旧签，但签名头不再挂上连接（真机上就是一条 401）",
        [["      DeviceIdentity.applyHeaders({ k, v -> setRequestProperty(k, v) }, deviceHeaders)",
          "      // (injected) 忘了挂头：只留 bearer", 1]],
        ["WD-11a"], "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnBridge.kt"],
    ];
    for (const [name, desc, edits, expect, targetRel] of INJ) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-w3-inj-"));
      try {
        fs.cpSync(path.join(REPO, "hosts", "shared"), path.join(tmp, "hosts", "shared"), { recursive: true });
        fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
        fs.copyFileSync(SELF, path.join(tmp, "scripts", path.basename(SELF)));
        // WD-10/WD-11 读的是端上那几个文件：不一起复制过去，子进程就会因为「文件找不到」红，
        // 那种红说明不了任何事。按相对路径搬同一批内容，注入才能只改「那一句」。
        for (const rel of ANDROID_FILES) {
          const src = path.join(REPO, rel);
          if (!fs.existsSync(src)) continue;
          const dst = path.join(tmp, rel);
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
        }
        const target = path.join(tmp, targetRel || "hosts/shared/cn_inbound_server.js");
        let src = fs.readFileSync(target, "utf8");
        let patchErr = "";
        for (const [oldStr, newStr, cnt] of edits) {
          const got = src.split(oldStr).length - 1;
          if (got !== cnt) {
            // 补丁对不上 = 产品那一句被改了或删了，注入本身失效。这必须红，
            // 不许悄悄跳过 —— 跳过的对照比没有对照更危险（它会一直「绿」）。
            patchErr = "找 " + cnt + " 处、实到 " + got + " 处：" + oldStr.slice(0, 48);
            break;
          }
          src = src.split(oldStr).join(newStr);
        }
        if (patchErr) {
          bad(name + " 注入补丁失效（产品那一句已不在，门与产品脱钩了）", patchErr);
          continue;
        }
        fs.writeFileSync(target, src);
        const r = spawnSync(process.execPath, [path.join(tmp, "scripts", path.basename(SELF)), "--no-inj"], {
          encoding: "utf8", timeout: 420000,
        });
        const out = (r.stdout || "") + (r.stderr || "");
        const reds = out.split("\n").filter((l) => l.trim().startsWith("✗")).map((l) => l.trim().slice(2));
        const summ = (out.match(/prove_w3_device_trust: PASS=\d+ FAIL=\d+/) || ["(子进程没有摘要)"])[0];
        const missed = expect.filter((e) => !reds.some((l) => l.includes(e)));
        if (missed.length) {
          bad(name + " 改坏这一句之后，对应的 WD 没有红（= 那条判据是摆设）",
              desc + " → 漏了：" + missed.join(" / ") + "；实际红：" + (reds.map((l) => l.split(" — ")[0]).join(" | ") || "全绿") + "；" + summ);
        } else {
          // 报的是「被点名的那一条」，不是「顺便红了几条」：级联红（别的 WD 也跟着坏）
          // 只说明这一处坏的影响更大，不能拿它当这条判据有牙的证据。
          const hit = reds.find((l) => l.includes(expect[0]));
          ok(name + " 注入对照有牙：" + desc + " → 红的正是「" + hit.split(" — ")[0] + "」" +
             (reds.length > expect.length ? "（另有 " + (reds.length - 1) + " 条级联红）" : "") + "（" + summ + "）");
        }
      } catch (e) {
        bad(name + " 注入跑不动", String(e && e.message ? e.message : e));
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
  } else {
    console.log("\n（--no-inj：跳过注入对照 —— 这是给子进程/快速自测用的，矩阵跑的是带注入的完整版）");
  }


} catch (err) {
  console.error("\n✗ Test suite error:", err);
  FAIL++;
} finally {
  // Cleanup temp directory
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (e) {
    console.error("Warning: failed to cleanup temp directory:", TMP);
  }
  done();
}
