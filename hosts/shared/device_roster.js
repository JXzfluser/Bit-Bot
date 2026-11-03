"use strict";
/**
 * device_roster.js — 设备花名册数据层（A2-5）
 *
 * 把 data/host/devices.json 读成「桌面花名册 UI 要的那几列」。纯数据、无副作用，
 * 不碰私钥、不碰公钥原文（UI 用不到）。吊销走 deviceKeys.revokeDevice + saveDevices，
 * 与入站服务的登记表写盘路径完全一致（同一份文件）。
 *
 * 注意：本模块只读 devices.json，不负责写 last_seen_at；last_seen_at 由
 * deviceKeys.touchDevice 在鉴权成功后落盘（见 device_keys.js）。两边读同一份文件，
 * 所以 UI 看到的「最近活跃」就是真实的最后一次鉴权时间。
 */
const deviceKeys = require("./device_keys");

/**
 * @param {string} file devices.json 路径
 * @returns {Array<{id:string,name:string,kind:string,created_at:string,last_seen_at:?string,revoked_at:?string,revoked:boolean}>}
 */
function listRoster(file) {
  const store = deviceKeys.loadDevices(file);
  return (store.devices || []).map((d) => ({
    id: String(d.id),
    name: String(d.name || d.id),
    kind: String(d.kind || "mobile"),
    created_at: String(d.created_at || ""),
    last_seen_at: d.last_seen_at ? String(d.last_seen_at) : null,
    revoked_at: d.revoked_at ? String(d.revoked_at) : null,
    revoked: Boolean(d.revoked_at),
  }));
}

/**
 * 在花名册里吊销一台设备。
 * @param {string} file
 * @param {string} deviceId
 * @returns {{ok:boolean, error?:string, device_id?:string, revoked_at?:string}}
 */
function revokeInRoster(file, deviceId) {
  const id = String(deviceId || "").trim();
  if (!id) return { ok: false, error: "device_id_required" };
  let store;
  try {
    store = deviceKeys.loadDevices(file);
  } catch (e) {
    return { ok: false, error: "devices_unreadable", detail: String((e && e.message) || e) };
  }
  const r = deviceKeys.revokeDevice(store, id);
  if (!r.ok) return r;
  try {
    deviceKeys.saveDevices(file, store);
  } catch (e) {
    return { ok: false, error: "devices_write_failed", detail: String((e && e.message) || e) };
  }
  return r;
}

module.exports = { listRoster, revokeInRoster };
