#!/usr/bin/env node
"use strict";

/**
 * B-4a — device key management.
 *
 * 「账号 = 设备密钥」的管理面:
 *   init    登记一台新设备,输出**给设备自己的**凭证文件(私钥在这一刻出现)
 *   list    看登记表(只有公钥)
 *   revoke  吊销一台设备(只影响这一台)
 *
 * 用法:
 *   node scripts/device-keys.js init --kind mobile --name "我的手机" [--id dev-a] [--out <dir>]
 *   node scripts/device-keys.js list
 *   node scripts/device-keys.js revoke --id dev-a
 *
 * 登记表默认在 <repo>/data/host/devices.json(0600)。
 * **登记表里只有公钥** —— 私钥写在 --out 指定的目录里,交给设备。
 */

const fs = require("fs");
const path = require("path");
const deviceKeys = require("../hosts/shared/device_keys");

const ROOT = path.resolve(__dirname, "..");
const DEVICES_PATH =
  String(process.env.BITBOT_DEVICES_PATH || "") ||
  path.join(ROOT, "data", "host", "devices.json");

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0 || i + 1 >= process.argv.length) return dflt;
  return String(process.argv[i + 1]);
}

const cmd = String(process.argv[2] || "list").trim();

if (cmd === "init") {
  const device = deviceKeys.generateDeviceKey({
    kind: arg("kind", "mobile"),
    name: arg("name", ""),
    id: arg("id", ""),
  });
  const store = deviceKeys.loadDevices(DEVICES_PATH);
  store.devices = (store.devices || []).filter((d) => d && d.id !== device.id);
  store.devices.push({
    id: device.id,
    name: device.name,
    kind: device.kind,
    public_key_pem: device.public_key_pem,
    created_at: device.created_at,
    revoked_at: null,
  });
  deviceKeys.saveDevices(DEVICES_PATH, store);

  const outDir = arg("out", "");
  const target = outDir
    ? path.join(outDir, device.id + ".credential.json")
    : path.join(ROOT, "data", "host", "credentials", device.id + ".credential.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, deviceKeys.deviceCredentialFile(device));
  try {
    fs.chmodSync(target, 0o600);
  } catch (_) {
    /* 权限收紧失败不致命 */
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        device_id: device.id,
        kind: device.kind,
        name: device.name,
        registry: DEVICES_PATH,
        credential_file: target,
        note: "私钥只在这个文件里;把它放到设备上,别留在 Box 上。",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (cmd === "list") {
  const store = deviceKeys.loadDevices(DEVICES_PATH);
  console.log(
    JSON.stringify(
      {
        ok: true,
        registry: DEVICES_PATH,
        devices: (store.devices || []).map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          created_at: d.created_at,
          revoked_at: d.revoked_at || null,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (cmd === "revoke") {
  const id = arg("id", "");
  const store = deviceKeys.loadDevices(DEVICES_PATH);
  const res = deviceKeys.revokeDevice(store, id);
  if (res.ok) deviceKeys.saveDevices(DEVICES_PATH, store);
  console.log(JSON.stringify({ ...res, registry: DEVICES_PATH }, null, 2));
  process.exit(res.ok ? 0 : 1);
}

console.error("usage: node scripts/device-keys.js [init|list|revoke] [--kind ...] [--name ...] [--id ...] [--out ...]");
process.exit(2);
