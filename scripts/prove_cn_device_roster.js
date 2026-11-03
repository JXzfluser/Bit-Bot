"use strict";
/**
 * prove_cn_device_roster.js — A2-5 设备花名册数据层门禁（红 → 绿）
 *
 * 验收（路线 A · W3 · A2-5）：桌面「移动端远程控制」弹窗要列出已登记设备
 * （名称 / 机器类 / 最近活跃 / 吊销按钮）。本门只证数据层——花名册能从
 * data/host/devices.json 读出、吊销能落盘、最近活跃（last_seen_at）能由鉴权
 * 成功后落盘。UI 渲染断言在 e2e_desktop_mobile_control.mjs（本机无显示会 SKIP，
 * CI 有显示才实跑）。
 *
 * 关键不变量：读花名册的设备表路径必须与入站服务写 last_seen 的路径一致
 * （data/host/devices.json），否则 UI 看到的永远是旧数据。
 *
 * 跑法：node scripts/prove_cn_device_roster.js
 * 不依赖 Electron / 显示环境。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const DEVICE_KEYS = path.join(REPO, "hosts", "shared", "device_keys.js");
const ROSTER = path.join(REPO, "hosts", "shared", "device_roster.js");

let PASS = 0,
  FAIL = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 280) : ""));
};
const done = () => {
  console.log("prove_cn_device_roster: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
};

const deviceKeys = require(DEVICE_KEYS);
// device_roster 是本次要新建的模块；红态下它不存在。用 try/require 让红是干净的
// FAIL 汇总，而不是 require 崩溃（崩溃会被误读成环境问题，不是产品缺口）。
let roster = null;
try {
  roster = require(ROSTER);
} catch (_) {
  roster = null;
}

// 种子一份临时设备表：两台有效设备（不同机器类）+ 一台已吊销。
function seed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-"));
  const file = path.join(dir, "devices.json");
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 3600 * 1000).toISOString();
  const store = {
    version: 1,
    devices: [
      {
        id: "dev-mob-aaa",
        name: "我的安卓",
        kind: "android",
        public_key_pem: "AAAA",
        created_at: old,
        revoked_at: null,
      },
      {
        id: "dev-ios-bbb",
        name: "我的 iPhone",
        kind: "ios",
        public_key_pem: "BBBB",
        created_at: now,
        revoked_at: null,
      },
      {
        id: "dev-old-ccc",
        name: "旧平板",
        kind: "mobile",
        public_key_pem: "CCCC",
        created_at: old,
        revoked_at: old,
      },
    ],
  };
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
  return file;
}

(async () => {
  const file = seed();
  try {
    /* EV-1 模块存在 —— 红态下这是第一个倒下的断言 */
    if (!roster) {
      bad("EV-1 device_roster 模块存在（花名册数据层尚未抽出）");
    } else {
      ok("EV-1 device_roster 模块存在");
    }

    /* EV-2 listRoster 返回三台、字段齐全、revoked 标记正确 */
    if (!roster) {
      bad("EV-2 listRoster 返回全部设备（含已吊销），字段含 name/kind/created_at/last_seen_at/revoked", "红：模块未实现");
    } else {
      const list = roster.listRoster(file);
      if (!Array.isArray(list) || list.length !== 3)
        bad("EV-2 listRoster 应返回 3 台（含 1 台已吊销）", "got " + (list && list.length));
      else if (!list.every((d) => "id" in d && "name" in d && "kind" in d && "created_at" in d && "last_seen_at" in d && "revoked" in d))
        bad("EV-2 每行缺字段（name/kind/created_at/last_seen_at/revoked 都要有）", JSON.stringify(list[0]));
      else if (list.filter((d) => d.revoked).length !== 1)
        bad("EV-2 revoked 标记应为 1（dev-old-ccc 已吊销）", JSON.stringify(list.map((d) => [d.id, d.revoked])));
      else if (list.find((d) => d.id === "dev-mob-aaa").kind !== "android")
        bad("EV-2 机器类应原样透传（android）", list.find((d) => d.id === "dev-mob-aaa").kind);
      else ok("EV-2 listRoster 返回 3 台、字段齐全、revoked 标记正确（android/ios/mobile 各一，1 台吊销）");
    }

    /* EV-3 吊销落盘：revokeInRoster 后重读，该设备 revoked_at 被填上 */
    if (!roster) {
      bad("EV-3 revokeInRoster 标记吊销并落盘", "红：模块未实现");
    } else {
      const r = roster.revokeInRoster(file, "dev-mob-aaa");
      if (!r || !r.ok) bad("EV-3 revokeInRoster(dev-mob-aaa) 应 ok", JSON.stringify(r));
      else {
        const reread = JSON.parse(fs.readFileSync(file, "utf8"));
        const hit = reread.devices.find((d) => d.id === "dev-mob-aaa");
        if (!hit || !hit.revoked_at) bad("EV-3 吊销未落盘（dev-mob-aaa.revoked_at 仍为空）", JSON.stringify(hit));
        else ok("EV-3 revokeInRoster 标记吊销并落盘（dev-mob-aaa.revoked_at 已填）");
      }
    }

    /* EV-4 吊销后 listRoster 反映 revoked=true */
    if (!roster) {
      bad("EV-4 吊销后 listRoster 反映 revoked=true", "红：模块未实现");
    } else {
      const list = roster.listRoster(file);
      const target = list.find((d) => d.id === "dev-mob-aaa");
      if (!target || !target.revoked) bad("EV-4 吊销后 listRoster 应反映 dev-mob-aaa.revoked=true", JSON.stringify(target));
      else ok("EV-4 吊销后 listRoster 反映 dev-mob-aaa.revoked=true");
    }

    /* EV-5 last_seen_at 由 touchDevice 落盘 —— 这是「最近活跃」的数据源 */
    if (typeof deviceKeys.touchDevice !== "function") {
      bad("EV-5 device_keys.touchDevice 存在（鉴权成功落最近活跃）", "红：方法未实现");
    } else {
      const before = JSON.parse(fs.readFileSync(file, "utf8")).devices.find((d) => d.id === "dev-ios-bbb");
      if (before.last_seen_at) bad("EV-5 种子不应带 last_seen_at（红态前不该有）", JSON.stringify(before));
      const touched = deviceKeys.touchDevice(file, "dev-ios-bbb");
      if (!touched) bad("EV-5 touchDevice(dev-ios-bbb) 应返回该设备", "null");
      else {
        const after = JSON.parse(fs.readFileSync(file, "utf8")).devices.find((d) => d.id === "dev-ios-bbb");
        if (!after.last_seen_at) bad("EV-5 touchDevice 未把 last_seen_at 落盘", JSON.stringify(after));
        else ok("EV-5 touchDevice 把 last_seen_at 落盘（dev-ios-bbb.last_seen_at=" + after.last_seen_at.slice(0, 19) + "）");
      }
    }

    /* EV-6 touchDevice 不碰已吊销设备、不抛异常 */
    if (typeof deviceKeys.touchDevice !== "function") {
      bad("EV-6 touchDevice 对不存在/已吊销设备返回 null 且不抛", "红：方法未实现");
    } else {
      let threw = false;
      let r1 = null,
        r2 = null;
      try {
        r1 = deviceKeys.touchDevice(file, "dev-old-ccc"); // 已吊销
        r2 = deviceKeys.touchDevice(file, "dev-no-such"); // 不存在
      } catch (e) {
        threw = true;
      }
      if (threw) bad("EV-6 touchDevice 在异常输入下不应抛", "threw");
      else if (r1 !== null || r2 !== null) bad("EV-6 已吊销/不存在设备应返回 null", "r1=" + r1 + " r2=" + r2);
      else ok("EV-6 touchDevice 对已吊销/不存在设备返回 null 且不抛");
    }

    done();
  } finally {
    try {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    } catch (_) {}
  }
})();
