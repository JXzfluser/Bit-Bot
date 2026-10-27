"use strict";

/**
 * B-2 — 这台机器叫什么。
 *
 * 原来 `machine_id` 在 73 处写死成 `"desk-1"`。单看没毛病,但在多机场景下
 * **两台机器会撞名** —— 桌面和 Box 都叫 desk-1,于是状态/记忆/上下文会串。
 *
 * 身份从哪来(优先级从高到低):
 *   1. 调用方显式给的值
 *   2. `BITBOT_MACHINE_ID` 环境变量 —— 运维给这台机器定的名字
 *   3. **设备密钥的 id** —— 这台机器登记过设备时用它的 id
 *      (B-4a:账号 = 设备密钥 ⇒ 机器的身份就是那把钥匙的身份)
 *   4. 按 kind 的稳定默认(`desk-1` / `phone-ios` / `phone-android`)
 *
 * 第 4 条保持既有行为不变 ⇒ **单机零回归**。多机时用 2 或 3 区分。
 */

const DEFAULTS = {
  desktop: "desk-1",
  ios: "phone-ios",
  android: "phone-android",
  box: "box-local",
  mobile: "phone-mobile",
};

function normalizeKind(kind) {
  const k = String(kind || "desktop").trim().toLowerCase();
  if (k === "ios" || k === "iphone") return "ios";
  if (k === "android" || k === "pixel") return "android";
  if (k === "box" || k === "cloud") return "box";
  if (k === "mobile") return "mobile";
  return "desktop";
}

/**
 * @param {object} o
 * @param {string} [o.explicit]   调用方给的值
 * @param {string} [o.kind]       机器类型
 * @param {string} [o.deviceId]   这台机器的设备密钥 id
 * @param {object} [o.env]        读环境用(默认 process.env)
 */
function resolveMachineId(o) {
  const opts = o || {};
  const env = opts.env || process.env;
  const explicit = String(opts.explicit || "").trim();
  if (explicit) return explicit;
  const fromEnv = String(env.BITBOT_MACHINE_ID || "").trim();
  if (fromEnv) return fromEnv;
  const deviceId = String(opts.deviceId || "").trim();
  if (deviceId) return deviceId;
  const kind = normalizeKind(opts.kind);
  return DEFAULTS[kind] || DEFAULTS.desktop;
}

/**
 * 入站回合的机器身份:**用设备密钥的 id**。
 * 入站请求本来就必须出示设备凭证(B-4a),所以「谁发来的」是确定的 ——
 * 不该再去信 payload 里自称的 machine_kind。
 */
function machineIdForInbound(o) {
  const opts = o || {};
  return resolveMachineId({
    explicit: opts.explicit,
    kind: opts.kind,
    deviceId: opts.deviceId,
    env: opts.env,
  });
}

module.exports = { resolveMachineId, machineIdForInbound, normalizeKind, DEFAULTS };
