"use strict";

/**
 * prove_cn_events_sse.js — W2 / A1-1 跨端事件流（SSE，只读）门禁。
 *
 * 这条路由是「手机/网页看得见这台机器在干什么」的通道本体：
 *   GET /v1/events?from_seq=<n>  →  text/event-stream
 *   - 鉴权**与 /v1/turn 完全同构**（EV-5..EV-7 钉住）：登记表为空 → 共享 bearer
 *     turn_token（配对 `/v1/pair/redeem` 回给手机的就是这把）；登记表非空 → 设备签名。
 *     2026-11-02 之前这里只认设备签名，而 Node 侧门把 server 和 deviceStore 分开注入，
 *     于是「真机一连就 401」它结构上看不见（report.md §8.62 的 RP-02 红原文）。
 *   - 没有可读事件库 ⇒ 诚实 503 event_log_unavailable，绝不假装空流通过。
 *   - 有库 ⇒ 先推游标之后的快照，再保持连接（心跳 + 轮询新事件）。
 *   - 游标三态：?from_seq=（首订）、Last-Event-ID:（断线重连）、?session_id=（会话隔离）。
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
  // 配对手机手里只有共享 bearer（/v1/pair/redeem 回的就是这个），没有设备私钥。
  if (o.bearer) headers["Authorization"] = "Bearer " + o.bearer;
  // 断线重连：浏览器 EventSource 用的是 Last-Event-ID 头。
  if (o.lastEventId != null) headers["Last-Event-ID"] = String(o.lastEventId);
  return new Promise((resolve) => {
    let qpath = "/v1/events?from_seq=" + (o.fromSeq != null ? o.fromSeq : 0);
    if (o.sessionId) qpath += "&session_id=" + encodeURIComponent(o.sessionId);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: qpath,
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

  // ---- EV-5：登记表为空时，配对手机那把共享 bearer 必须订得到 --------------
  // 这就是本轮补的洞：`/v1/pair/redeem` 回给手机的只有 bearer turn_token，
  // 手机侧没有设备私钥；路由只认设备签名 ⇒ 真机一连就 401。
  // 诚实登记：这条是**新增覆盖**（不是先红后绿的回归），代码此前不支持，
  // 先跑证明「加断言的当下它就是红的」，改完才绿 —— 红/绿原文都进 report.md §8.62。
  const EMPTY_DEVICES = path.join(TMP, "no-devices-yet.json");
  const BEARER = "sse-gate-bearer-secret";
  const s5 = await startServer({ eventLog: evLog, devicesPath: EMPTY_DEVICES, turnToken: BEARER });
  try {
    const r = await getEvents(s5.port, { bearer: BEARER, fromSeq: 0, expectSeq: lastSeq });
    check(r.status === 200, "EV-5 配对手机的 bearer（无设备登记）→ 200", r.status + " " + r.raw.slice(0, 160));
    check(/text\/event-stream/i.test(r.contentType), "EV-5 bearer 也是 text/event-stream", r.contentType);
    const wrong = await getEvents(s5.port, { bearer: "wrong-secret", fromSeq: 0 });
    check(wrong.status === 401, "EV-5 bearer 错了仍是 401（同构不等于放宽）", wrong.status + " " + wrong.raw.slice(0, 120));
    check(/invalid_token/.test(wrong.raw), "EV-5 错 bearer 报 invalid_token（与 /v1/turn 同一套原因码）", wrong.raw.slice(0, 160));
    const none = await getEvents(s5.port, { fromSeq: 0 });
    check(none.status === 401, "EV-5 裸连（什么凭证都不带）→ 401", none.status + " " + none.raw.slice(0, 120));
  } finally {
    await closeServer(s5.server);
  }

  // ---- EV-6：Last-Event-ID 续订从那条之后开始，不重复已读的（A1-3） --------
  const s6 = await startServer({ eventLog: evLog });
  try {
    const r = await getEvents(s6.port, { device: phone, lastEventId: firstSeq });
    // 首帧断言：游标优先 Last-Event-ID（否则会被 ?from_seq=0 覆盖成全量）。
    const ids = [];
    for (const line of r.raw.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const o = JSON.parse(line.slice(6));
          if (Number.isFinite(o.seq)) ids.push(o.seq);
        } catch (_) { /* 跳过 */ }
      }
    }
    check(ids.length > 0, "EV-6 带 Last-Event-ID 仍有流（没被当成非法头）", r.status + " " + JSON.stringify(ids));
    check(ids.every((v) => v > firstSeq), "EV-6 Last-Event-ID 之后的事件才推（已读的不重复）", JSON.stringify({ firstSeq, ids }));
    check(ids.indexOf(firstSeq) < 0, "EV-6 首条（=Last-Event-ID 本身）不重复推", JSON.stringify(ids));
  } finally {
    await closeServer(s6.server);
  }

  // ---- EV-7：登记表非空时 bearer 一律失效，且与 /v1/turn 的口径一致 --------
  // 这条钉的是「同构」而不是「宽松」：两把路由在同一个状态下必须给同一个答案，
  // 否则手机会出现「能下单、看不见自己下的单」这种更难看的不一致。
  // A2-4（可读的 401 文案 + 桌面侧提示）仍未做，登记在 cross-end-roadmap-a.md。
  const s7 = await startServer({ eventLog: evLog, turnToken: BEARER }); // devicesPath 默认 = 有 phone
  try {
    const ev = await getEvents(s7.port, { bearer: BEARER, fromSeq: 0 });
    const tu = await new Promise((resolve) => {
      const body = JSON.stringify({ text: "hi", session_id: "ev7" });
      const req = http.request(
        {
          host: "127.0.0.1",
          port: s7.port,
          path: "/v1/turn",
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + BEARER },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => resolve({ status: res.statusCode, raw }));
        },
      );
      req.on("error", () => resolve({ status: 0, raw: "" }));
      req.end(body);
    });
    check(ev.status === 401 && tu.status === 401, "EV-7 登记了设备后 bearer 在 events/turn 两路一起 401（口径一致）", JSON.stringify({ events: ev.status, turn: tu.status }));
    const dev = await getEvents(s7.port, { device: phone, fromSeq: 0, expectSeq: lastSeq });
    check(dev.status === 200, "EV-7 同状态下设备签名订得到（说明差异来自凭证种类而非库）", dev.status);
  } finally {
    await closeServer(s7.server);
  }

  // ---- EV-8：?session_id= 只推这个会话（不传时行为一字不变）----------------
  const EV2_DB = path.join(TMP, "events-session-filter.sqlite");
  const evLog2 = openEventLog({ file: EV2_DB, actor: "test-sse-filter" });
  const a1 = evLog2.append({ sessionId: "keep-me", kind: "turn_started", payload: { a: 1 } }).seq;
  const b1 = evLog2.append({ sessionId: "other-one", kind: "turn_started", payload: { a: 2 } }).seq;
  const a2 = evLog2.append({ sessionId: "keep-me", kind: "turn_ended", payload: { a: 3 } }).seq;
  const s8 = await startServer({ eventLog: evLog2, devicesPath: EMPTY_DEVICES, turnToken: BEARER });
  try {
    const filtered = await getEvents(s8.port, { bearer: BEARER, sessionId: "keep-me" });
    const all = await getEvents(s8.port, { bearer: BEARER, fromSeq: 0 });
    const fIds = [];
    for (const line of filtered.raw.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const o = JSON.parse(line.slice(6));
          if (Number.isFinite(o.seq)) fIds.push(o.seq);
        } catch (_) { /* 跳过 */ }
      }
    }
    check(filtered.status === 200, "EV-8 带 session_id 订阅 → 200", filtered.status + " " + filtered.raw.slice(0, 120));
    check(
      fIds.length >= 1 && fIds.every((v) => v === a1 || v === a2),
      "EV-8 过滤后只含本会话的事件",
      JSON.stringify({ fIds, keep: [a1, a2], other: b1 }),
    );
    check(fIds.indexOf(b1) < 0, "EV-8 别的会话没漏进来", JSON.stringify(fIds));
    const allIds = [];
    for (const line of all.raw.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const o = JSON.parse(line.slice(6));
          if (Number.isFinite(o.seq)) allIds.push(o.seq);
        } catch (_) { /* 跳过 */ }
      }
    }
    check(allIds.indexOf(b1) >= 0, "EV-8 对照：不带 session_id 时那条别会话的事件在流里（证明过滤真在起作用）", JSON.stringify(allIds));
  } finally {
    await closeServer(s8.server);
    try { evLog2.close(); } catch (_) { /* 关不掉不影响结论 */ }
  }

  console.log("\nprove_cn_events_sse: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail === 0 ? 0 : 1);
})();
