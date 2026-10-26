"use strict";

/**
 * B-4a — device keys: the "account" of a machine.
 *
 * 用户的口径(拍板):**手机 = 自己那台机器,云端 Box 是可选的「另一台机器」,
 * 账号 = 设备密钥对,不做 SaaS 账号体系。**
 *
 * 现状的问题:`/v1/turn` 的鉴权是**一把共享静态密钥**(`BITBOT_TURN_TOKEN`)。
 * 拿着它的人就是**任何**设备:
 *  - 没有「谁是谁」—— 收了请求也不知道来的是手机还是桌面;
 *  - 不能单独吊销 —— 换一把,所有设备全断;
 *  - `machine_kind` 来自 **payload** ⇒ 可以随便说(说是 desktop 就是 desktop)。
 *
 * 这一层改成**每台机器一对 ed25519 密钥**:
 *  - 设备持有私钥,Box 只存公钥 ⇒ **Box 被读走也不泄露任何设备密钥**;
 *  - 签名把 device_id / 时间戳 / nonce / 请求体**一起**签进去
 *    ⇒ 换 device_id、换时间戳、重放、改请求体,全部验不过;
 *  - 吊销 = 删掉登记表里的一行,只影响那一台;
 *  - **机器身份来自凭证,不是来自 payload** —— payload 说自己是桌面也没用。
 *
 * 向后兼容:登记表为空时,回落到既有的 turn token 合同(ADR 0008),
 * 现有部署不受影响。登记表非空时,**必须**是设备凭证。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEVICES_VERSION = 1;
const SKEW_MS = Number(process.env.BITBOT_TURN_SKEW_MS || 5 * 60 * 1000);

/* ---------------------------------------------------------------- 登记表 */

/** 读设备登记表。读不了就当空(没有设备 = 回落 turn token)。 */
function loadDevices(file) {
  try {
    if (!fs.existsSync(file)) return { version: DEVICES_VERSION, devices: [] };
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(raw && raw.devices) ? raw.devices : [];
    return {
      version: Number(raw && raw.version) || DEVICES_VERSION,
      devices: list
        .filter((d) => d && d.id && d.public_key_pem)
        .map((d) => ({
          id: String(d.id),
          name: String(d.name || d.id),
          kind: String(d.kind || "mobile"),
          public_key_pem: String(d.public_key_pem),
          created_at: String(d.created_at || ""),
          revoked_at: d.revoked_at ? String(d.revoked_at) : null,
        })),
    };
  } catch (_) {
    return { version: DEVICES_VERSION, devices: [] };
  }
}

/** 写设备登记表。**只写公钥** —— 私钥永远不落在 Box 上。 */
function saveDevices(file, store) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: DEVICES_VERSION,
    devices: (store && Array.isArray(store.devices) ? store.devices : []).map((d) => ({
      id: String(d.id),
      name: String(d.name || d.id),
      kind: String(d.kind || "mobile"),
      public_key_pem: String(d.public_key_pem),
      created_at: String(d.created_at || ""),
      revoked_at: d.revoked_at || null,
    })),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  try {
    fs.chmodSync(file, 0o600);
  } catch (_) {
    /* 权限收紧失败不致命,但要说出来 */
  }
  return payload;
}

/* ---------------------------------------------------------------- 密钥 */

/** 生成一台新设备:ed25519 密钥对。**私钥只在这里出现一次。 */
function generateDeviceKey(opts) {
  const o = opts || {};
  const kind = String(o.kind || "mobile");
  const id =
    String(o.id || "").trim() ||
    "dev-" + kind + "-" + crypto.randomBytes(6).toString("hex");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    id,
    name: String(o.name || id),
    kind,
    public_key_pem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    private_key_pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    created_at: new Date().toISOString(),
  };
}

/** 私钥 → 一个可以放在设备上的文件(0600)。 */
function deviceCredentialFile(device) {
  return JSON.stringify(
    {
      v: 1,
      id: device.id,
      name: device.name,
      kind: device.kind,
      public_key_pem: device.public_key_pem,
      private_key_pem: device.private_key_pem,
      created_at: device.created_at,
    },
    null,
    2,
  );
}

/* ---------------------------------------------------------------- 签名 */

/** 被签名的内容:device_id 也进去 ⇒ 换 id 一定验不过。 */
function signingPayload(deviceId, ts, nonce, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""), "utf8");
  return Buffer.concat([
    Buffer.from(String(deviceId) + "\n" + String(ts) + "\n" + String(nonce) + "\n", "utf8"),
    buf,
  ]);
}

/** 设备侧:用私钥签名。 */
function signTurn(privateKeyPem, deviceId, ts, nonce, body) {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, signingPayload(deviceId, ts, nonce, body), key);
  return sig.toString("base64");
}

/**
 * Box 侧:验一台设备的签名。
 *
 * @returns {{ok: boolean, error?: string, device_id?: string, kind?: string, via?: string}}
 */
function verifyDeviceTurn(store, req, rawBody, opts) {
  const o = opts || {};
  const devices = (store && Array.isArray(store.devices) ? store.devices : []).filter(
    (d) => d && !d.revoked_at,
  );
  if (!devices.length) {
    return { ok: false, error: "no_devices_registered" };
  }
  const headers = (req && req.headers) || {};
  const deviceId = String(headers["x-bitbot-device"] || "").trim();
  const ts = String(headers["x-bitbot-timestamp"] || "");
  const nonce = String(headers["x-bitbot-nonce"] || "");
  const sig = String(headers["x-bitbot-signature"] || "");
  if (!deviceId || !ts || !nonce || !sig) {
    return { ok: false, error: "missing_device_credential" };
  }
  const rec = devices.find((d) => d.id === deviceId);
  if (!rec) {
    // 分不清「没这台设备」和「这台被吊销了」也不想分 —— 对外一律 unknown_device。
    return { ok: false, error: "unknown_device" };
  }
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > (o.skewMs || SKEW_MS)) {
    return { ok: false, error: "stale_timestamp" };
  }
  const nonceStore = o.nonceStore;
  if (nonceStore && typeof nonceStore.has === "function" && nonceStore.has(nonce)) {
    return { ok: false, error: "nonce_reused" };
  }
  let ok = false;
  try {
    const key = crypto.createPublicKey(rec.public_key_pem);
    ok = crypto.verify(
      null,
      signingPayload(deviceId, ts, nonce, rawBody),
      key,
      Buffer.from(sig, "base64"),
    );
  } catch (_) {
    ok = false;
  }
  if (!ok) return { ok: false, error: "bad_signature" };
  if (nonceStore && typeof nonceStore.add === "function") nonceStore.add(nonce, t);
  return {
    ok: true,
    via: "device_key",
    device_id: rec.id,
    kind: rec.kind,
    name: rec.name,
  };
}

/** 吊销一台设备(只影响这一台)。 */
function revokeDevice(store, deviceId) {
  const id = String(deviceId || "").trim();
  if (!id) return { ok: false, error: "device_id_required" };
  const list = store && Array.isArray(store.devices) ? store.devices : [];
  const hit = list.find((d) => d && d.id === id);
  if (!hit) return { ok: false, error: "unknown_device" };
  hit.revoked_at = new Date().toISOString();
  return { ok: true, device_id: id, revoked_at: hit.revoked_at };
}

module.exports = {
  DEVICES_VERSION,
  loadDevices,
  saveDevices,
  generateDeviceKey,
  deviceCredentialFile,
  signingPayload,
  signTurn,
  verifyDeviceTurn,
  revokeDevice,
};
