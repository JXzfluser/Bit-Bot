"use strict";

/**
 * prove_cn_events_sse.js — W2 / A1-1 跨端事件流（SSE，只读）门禁。
 *
 * 这条路由是「手机/网页看得见这台机器在干什么」的通道本体：
 *   GET /v1/events?from_seq=<n>  →  text/event-stream
 *   - 鉴权与 /v1/approvals 同一套设备密钥（B-4a）：没登记的设备看不到（401）。
 *   - 没有可读事件库 ⇒ 诚实 503 event_log_unavailable，绝不假装空流通过。
 *   - 有库 ⇒ 先推 from_seq 之后的快照，再保持连接（心跳 + 轮询新事件）。
 *
 * 真值来源：hosts/shared/event_log.js 的 readAfter 契约（docs/events.md）。
 * 这里只验证「路由/鉴权/SSE 形态/游标」这层，事件库内部由 G-61/G-62 守。
 */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { createCnInboundServer } = require(path.join(ROOT, "hosts/shared/cn_inbound_server"));
const deviceKeys = require(path.join(ROOT, "hosts/shared/device_keys"));
const { openEventLog } = require(path.join(ROOT, "hosts/shared/event_log"));

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log("ok " + n); };
const bad = (n, d) => { fail += 1; console.error("FAIL " + n, d || ""); };
const check = (c, n, d) => (c ? ok(n) : bad(n, d));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-evsse-"));
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

// 真事件库：开库、落几条事件，拿首/末 seq 用于断言。
const EV_DB = path.join(TMP, "events.sqlite");
const evLog = openEventLog({ file: EV_DB, actor: "test-sse" });
const seqs = [
  evLog.append({ sessionId: "s1", kind: "turn_started", payload: { step: "begin" } }).seq,
  evLog.append({ sessionId: "s1", kind: "turn_progress", payload: { pct: 50 } }).seq,
  evLog.append({ sessionId: "s1", kind: "turn_finished", payload: { ok: true } }).seq,
];
const firstSeq = Math.min.apply(null, seqs);
const lastSeq = Math.max.apply(null, seqs);

/** 带设备凭证发一个 GET /v1/events（body 为空，签名把空 body 签进去）。 */
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
          resolve({
            status: res.statusCode,
            contentType: res.headers["content-type"] || "",
            raw,
            reason,
          });
          try { req.destroy(); } catch (_) {}
        };
        res.on("data", (c) => {
          raw += c;
          // 等到末条事件出现再收尾，保证快照整段已收到。
          if (o.expectSeq != null && raw.includes("data:") && raw.includes('"seq":' + o.expectSeq)) {
            finish("saw");
          }
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
    server.start().then((info) => resolve({ server, port: Number((info && info.port) || 0) }))
      .catch(reject);
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

  // ---- EV-1：无设备凭证 → 401（和 /v1/approvals 同一套鉴权）----------------
  const s1 = await startServer({ eventLog: evLog });
  try {
    const noAuth = await getEvents(s1.port, {});
    check(noAuth.status === 401, "EV-1 无设备凭证 GET /v1/events → 401", noAuth.status + " " + noAuth.raw.slice(0, 120));
  } finally {
    await closeServer(s1.server);
  }

  // ---- EV-2：有凭证 + 事件库 → 200 / SSE / 有序 seq ------------------------
  const s2 = await startServer({ eventLog: evLog });
  try {
    const r = await getEvents(s2.port, { device: phone, fromSeq: 0, expectSeq: lastSeq });
    check(r.status === 200, "EV-2 有效设备凭证 → 200", r.status + " / " + r.reason);
    check(/text\/event-stream/i.test(r.contentType), "EV-2 Content-Type 是 text/event-stream", r.contentType);
    check(r.raw.includes("id: " + firstSeq), "EV-2 流里含首条事件 id=" + firstSeq, r.raw.slice(0, 160));

    // 解析 data: 行，验证 seq 升序且覆盖首末。
    const seqsSeen = [];
    for (const line of r.raw.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const o = JSON.parse(line.slice(6));
          if (Number.isFinite(o.seq)) seqsSeen.push(o.seq);
        } catch (_) { /* 跳过非 JSON 行 */ }
      }
    }
    const asc = seqsSeen.every((v, i, a) => i === 0 || v > a[i - 1]);
    check(seqsSeen.length >= 3 && asc, "EV-2 至少 3 条事件且 seq 严格递增", JSON.stringify(seqsSeen));
    check(
      seqsSeen.indexOf(firstSeq) >= 0 && seqsSeen.indexOf(lastSeq) >= 0,
      "EV-2 含首末两条事件",
      JSON.stringify(seqsSeen),
    );
    check(r.raw.includes("event: turn_started"), "EV-2 带 kind 字段（event: <kind>）", "");
  } finally {
    await closeServer(s2.server);
  }

  // ---- EV-3：有凭证但没事件库 → 诚实 503（不假装空流）----------------------
  const s3 = await startServer({}); // 不注入 eventLog
  try {
    const r = await getEvents(s3.port, { device: phone });
    check(r.status === 503, "EV-3 无事件库 → 503（诚实降级）", r.status + " " + r.raw.slice(0, 160));
    check(/event_log_unavailable/.test(r.raw), "EV-3 报错 event_log_unavailable", r.raw.slice(0, 160));
  } finally {
    await closeServer(s3.server);
  }

  // ---- EV-4：游标 from_seq 真的从指定 seq 之后开始 -------------------------
  const s4 = await startServer({ eventLog: evLog });
  try {
    const r = await getEvents(s4.port, { device: phone, fromSeq: lastSeq, expectSeq: 999999 });
    // from_seq=lastSeq ⇒ 没有任何 seq>lastSeq 的事件，快照为空（连接保持，不会见末条）。
    // 用 timeout 兜底收尾，断言：流里不应含任何 data: 行（或只含心跳注释）。
    const dataLines = r.raw.split("\n").filter((l) => l.startsWith("data: ")).length;
    check(dataLines === 0, "EV-4 from_seq=末条 ⇒ 快照为空（不含已读事件）", "dataLines=" + dataLines + " raw=" + r.raw.slice(0, 120));
  } finally {
    await closeServer(s4.server);
  }

  console.log("\nprove_cn_events_sse: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
