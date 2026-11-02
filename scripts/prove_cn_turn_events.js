"use strict";

/**
 * prove_cn_turn_events.js — W2 / A1-2 事件面最小集门禁。
 *
 * 这一刀把「回合广播」接进事件库：bitbot:llm-stream（phase=start/end）与
 * bitbot:turn-progress 经由 turn_event_emitter 桥翻成持久化事件
 * （docs/events.md §5.2：turn_started / progress / turn_ended，带 seq）。
 *
 * 它同时是 A1-1 路由「不再 503」的接线片：桌面进程拿到 event_mirror 的读句柄，
 * 喂给 createCnInboundServer 的 eventLog —— 路由从「没有库」变成「读得到真库」。
 *
 * 真值来源：docs/events.md §5.2（kind 定义）、§8（广播→kind 映射）。
 * 默认关（BITBOT_EVENT_DUAL_WRITE / BITBOT_EVENT_ONLY 都没开）时桥是 no-op、
 * 连库都不开，路由继续诚实 503、零足迹 —— 这一条由本门的红态证明。
 *
 * 铁律：先写红（桥不存在 / 路由 503）→ 留原文 → 再修 → 留绿原文。
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

// 必须先置位开关再碰 event_mirror（createMirror 在首次 getSharedMirror 时读 env）。
process.env.BITBOT_EVENT_DUAL_WRITE = "1";

const ROOT = path.resolve(__dirname, "..");
const { createCnInboundServer } = require(path.join(ROOT, "hosts/shared/cn_inbound_server"));
const deviceKeys = require(path.join(ROOT, "hosts/shared/device_keys"));

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log("ok " + n); };
const bad = (n, d) => { fail += 1; console.error("FAIL " + n, d || ""); };
const check = (c, n, d) => (c ? ok(n) : bad(n, d));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-turnev-"));
const DEVICES_PATH = path.join(TMP, "devices.json");

// turn_event_emitter 是本刀新增的桥；红态下它尚未存在，require 会失败。
let turnEvents = null;
try {
  turnEvents = require(path.join(ROOT, "hosts/shared/turn_event_emitter"));
} catch (_e) {
  turnEvents = null;
}
const evMod = require(path.join(ROOT, "hosts/shared/event_mirror"));

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

function getEvents(port, opts) {
  const o = opts || {};
  const headers = {};
  if (o.device) {
    const ts = String(Date.now());
    const nonce = "n-" + Math.random().toString(36).slice(2) + Date.now();
    const sig = deviceKeys.signTurn(
      o.device.private_key_pem,
      o.device.id,
      ts,
      nonce,
      Buffer.from(""),
    );
    headers["x-bitbot-device"] = o.device.id;
    headers["x-bitbot-timestamp"] = ts;
    headers["x-bitbot-nonce"] = nonce;
    headers["x-bitbot-signature"] = sig;
  }
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/v1/events?from_seq=" + (o.fromSeq != null ? o.fromSeq : 0),
        method: "GET",
        headers,
      },
      (res) => {
        let raw = "";
        let done = false;
        const finish = (reason) => {
          if (done) return;
          done = true;
          resolve({ status: res.statusCode, contentType: res.headers["content-type"] || "", raw, reason });
          try { req.destroy(); } catch (_) {}
        };
        res.on("data", (c) => {
          raw += c;
          if (o.expectSeq != null && raw.includes("data:") && raw.includes('"seq":' + o.expectSeq)) finish("saw");
        });
        res.on("end", () => finish("end"));
        setTimeout(() => finish("timeout"), 4000);
      },
    );
    req.on("error", (e) => resolve({ status: 0, contentType: "", raw: "", reason: "error:" + e }));
    req.end();
  });
}

function startServer(opts) {
  return new Promise((resolve, reject) => {
    const server = createCnInboundServer(
      Object.assign({ repoRoot: TMP, port: 0, devicesPath: DEVICES_PATH }, opts || {}),
    );
    server.start().then((info) => resolve({ server, port: Number((info && info.port) || 0) })).catch(reject);
  });
}

function closeServer(api) {
  return new Promise((r) => {
    try {
      if (api && typeof api.stop === "function") return api.stop().then(r).catch(r);
    } catch (_) {}
    r();
  });
}

(async function main() {
  const phone = makeDevice("mobile", "我的手机");

  // 拿到桌面会用的那个共享镜像句柄（dataRoot 与 sessions/product_surface 一致）。
  const dataRoot = path.join(TMP, "data");
  const mirror = evMod.getSharedMirror(dataRoot, { actor: "prove-cn-turn" });

  // EV-1：桥模块存在且导出 emitTurnStarted（红态下失败）。
  check(
    turnEvents && typeof turnEvents.emitTurnStarted === "function",
    "EV-1 turn_event_emitter 桥存在且导出 emitTurnStarted",
    turnEvents ? "ok" : "模块缺失（A1-2 桥尚未落地）",
  );

  // EV-2：镜像句柄带 emit（turn-lifecycle → event-log 桥，红态下 undefined）。
  const emitOk = typeof mirror.emit === "function";
  check(emitOk, "EV-2 镜像句柄带 emit（回合流落库桥）", emitOk ? "ok" : "mirror.emit 不存在");

  let turnLast = -1;
  const kinds = [];
  if (emitOk && turnEvents) {
    const turnId = "t-prove-1";
    const sid = "s-prove";
    turnEvents.emitTurnStarted(mirror, { sessionId: sid, turnId, initiator: sid + ":user:desktop" });
    turnEvents.emitProgress(mirror, { sessionId: sid, turnId, row: { index: 1, total: 3, kind: "web_search" } });
    turnEvents.emitTurnEnded(mirror, { sessionId: sid, turnId, status: "ok" });
    const h = mirror.readHandle();
    const rows = h ? h.readAfter({ fromSeq: 0 }) : [];
    for (const r of rows) kinds.push(r.kind);
    turnLast = rows.reduce((m, r) => Math.max(m, r.seq), -1);

    check(kinds.includes("turn_started"), "EV-3 日志含 turn_started", JSON.stringify(kinds));
    check(kinds.includes("progress"), "EV-4 日志含 progress", JSON.stringify(kinds));
    check(kinds.includes("turn_ended"), "EV-5 日志含 turn_ended", JSON.stringify(kinds));
    const seqs = rows.map((r) => r.seq);
    const asc = seqs.every((v, i, a) => i === 0 || v > a[i - 1]);
    check(seqs.length === 3 && asc, "EV-6 三条事件 seq 严格递增", JSON.stringify(seqs));
  } else {
    bad("EV-3 日志含 turn_started", "桥未就绪");
    bad("EV-4 日志含 progress", "桥未就绪");
    bad("EV-5 日志含 turn_ended", "桥未就绪");
    bad("EV-6 三条事件 seq 严格递增", "桥未就绪");
  }

  // EV-7/8：把同一个镜像句柄喂给 A1-1 路由 —— 路由应当从 503 变成 200 并流出 turn_started。
  // 红态下镜像没有 readHandle（桥未落地），路由拿不到库 → 诚实 503。
  if (typeof mirror.readHandle !== "function") {
    bad("EV-7 路由读到镜像句柄 → 200（不再 503）", "mirror.readHandle 不存在（桥未落地）");
    bad("EV-8 流里带 event: turn_started", "桥未落地，路由仍 503");
  } else {
    const rh = mirror.readHandle();
    const s = await startServer({ eventLog: rh });
    try {
      const r = await getEvents(s.port, { device: phone, fromSeq: 0, expectSeq: turnLast > 0 ? turnLast : 999999 });
      check(r.status === 200, "EV-7 路由读到镜像句柄 → 200（不再 503）", r.status + " " + r.raw.slice(0, 120));
      if (r.status === 200) {
        check(r.raw.includes("event: turn_started"), "EV-8 流里带 event: turn_started", "");
      } else {
        bad("EV-8 流里带 event: turn_started", "路由未就绪（" + r.status + "）");
      }
    } finally {
      await closeServer(s.server);
    }
  }

  console.log("\nprove_cn_turn_events: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
