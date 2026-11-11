#!/usr/bin/env node
"use strict";

/**
 * prove_cursor_subscribe.mjs — KP-06 / T1-09：游标续订「任意 seq 完整、有序」。
 *
 * 对标需求（docs/grok-desktop-parity/kernel-mechanism-parity.md §4 KP-06）的原话是
 * `GET /v1/events?since=<seq>`，完成定义（docs/next-target-requirements.md:265 T1-09）
 * 是「任意 seq 续订事件完整、有序」。这一门断的是那一句，不是「路由存在」。
 *
 * 它同时把「手机与桌面共用」从口号变成断言：桌面的进程内读面（readAfter）、手机的
 * SSE 面、终端 curl 的一次性 JSON 面，三条路读的是同一个 seq 空间，同一个游标给出的
 * 序列逐条相同（CS-06）。
 *
 * 反向对照（N1..N3）改坏的是**服务端源码的副本**，不是这里的期望值：摘掉 `since` 的
 * 解析、把续读的 fromSeq 写死成 0、把 has_more 探测写死成 false —— 对应那条断言必须
 * 翻红。翻不了红说明断言是空的。
 *
 * 零 Electron、零外网：起的是本进程的 cn_inbound 服务，事件写在临时目录的库里。
 */

import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { spawnSync, exec } from "node:child_process";import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SHARED = path.join(ROOT, "hosts", "shared");
// 改坏副本里 `require("./p0_security")` 这类相对引入必须按服务端文件的目录解析
const requireFromShared = createRequire(path.join(SHARED, "cn_inbound_server.js"));

let pass = 0;
let fail = 0;
let skip = 0;
const ok = (n, d) => { pass += 1; console.log("ok " + n + (d ? " — " + d : "")); };
const bad = (n, d) => { fail += 1; console.error("FAIL " + n + (d ? " — " + d : "")); };
const skipped = (n, d) => { skip += 1; console.log("skip " + n + (d ? " — " + d : "")); };
const check = (c, n, d) => (c ? ok(n, d) : bad(n, d));

/* 没有 node:sqlite 就没有事件库（系统老 Node 的 CLI 运行时）。本机真跑，老运行时里
   诚实跳过并说明 —— SKIP 不计进 PASS。 */
try {
  require("node:sqlite");
} catch {
  console.log("prove_cursor_subscribe: SKIP node:sqlite（本机 Node 没有内置 sqlite，游标 API 依赖事件库）");
  console.log("prove_cursor_subscribe: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

process.env.BITBOT_EVENT_DUAL_WRITE = "1";

const evMod = require(path.join(SHARED, "event_mirror"));
const turnEvents = require(path.join(SHARED, "turn_event_emitter"));
const { createCnInboundServer } = require(path.join(SHARED, "cn_inbound_server"));
const CN_SRC = fs.readFileSync(path.join(SHARED, "cn_inbound_server.js"), "utf8");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kp06-cursor-"));
const EMPTY_ROOT = path.join(TMP, "no-event-db");
const DATA_ROOT = path.join(TMP, "data");
const TURN_TOKEN = "kp06-cursor-token";

const mirror = evMod.getSharedMirror(DATA_ROOT, { actor: "kp06-desktop" });
const log = mirror.readHandle();

/* ---- 造事件：两个 session 交替，模拟「桌面本地 + 手机」共用一条流 ---- */
function round(sessionId, turnId, progresses) {
  turnEvents.emitTurnStarted(mirror, { sessionId, turnId, initiator: sessionId + ":user:desktop" });
  for (let i = 0; i < progresses; i++) {
    turnEvents.emitProgress(mirror, { sessionId, turnId, row: { index: i + 1, total: progresses, kind: "web_search" } });
  }
  turnEvents.emitTurnEnded(mirror, { sessionId, turnId, status: "ok" });
}

const DESK = "kp06-desk";
const PHONE = "kp06-phone";
round(DESK, "t-d1", 2);
round(PHONE, "t-p1", 1);
round(DESK, "t-d2", 3);

const fullSeqs = () => log.readAfter({ fromSeq: 0, limit: 100000 }).map((r) => Number(r.seq));

const asc = (a) => a.every((v, i) => i === 0 || Number(v) > Number(a[i - 1]));
const uniq = (a) => new Set(a).size === a.length;

/* ---- 三条核心判据：正控与负控共用同一份实现 ---- */
/** 「不丢」：从 c 起续订的序列 === 桌面面里所有 >c 的序列（截到 limit） */
const judgeComplete = (pageSeqs, c, baselineSeqs, limit) => {
  const want = baselineSeqs.filter((s) => s > c).slice(0, limit);
  return pageSeqs.join(",") === want.join(",");
};
/** 「不重」：不出现 <=c 的帧，也不出现重复 seq */
const judgeNoReplay = (pageSeqs, c) => pageSeqs.every((s) => s > c) && uniq(pageSeqs);
const judgeOrdered = (pageSeqs) => asc(pageSeqs);

/* ---- HTTP 面 ---- */
function startServer({ eventLog, repoRoot }) {
  return new Promise((resolve, reject) => {
    const api = createCnInboundServer({
      repoRoot: repoRoot || TMP,
      port: 0,
      devicesPath: path.join(repoRoot || TMP, "no-devices-here.json"),
      eventLog,
      turnToken: TURN_TOKEN,
    });
    api
      .start()
      .then((info) => resolve({ api, port: Number((info && info.port) || 0) }))
      .catch(reject);
  });
}

/**
 * mode: "json" → ?format=json；"curl" → Accept 为通配（curl 的默认值，走一次性 JSON）；
 * "sse" → Accept: text/event-stream。opts.stopAtSeq：SSE 读到那条就关连接。
 */
function request(port, p, opts = {}) {
  const mode = opts.mode || "json";
  const headers = { Authorization: "Bearer " + TURN_TOKEN };
  if (mode === "sse") headers.Accept = "text/event-stream";
  if (mode === "curl") headers.Accept = "*/*";
  return new Promise((resolve) => {
    let raw = "";
    let settled = false;
    let req;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: lastStatus, ct: lastCt, raw });
      try { req.destroy(); } catch (_) {}
    };
    let lastStatus = 0;
    let lastCt = "";
    const timer = setTimeout(finish, opts.ms || 8000);
    req = http.request({ host: "127.0.0.1", port, method: "GET", path: p, headers }, (res) => {
      lastStatus = res.statusCode;
      lastCt = res.headers["content-type"] || "";
      res.on("data", (c) => {
        raw += c;
        if (mode === "sse" && opts.stopAtSeq != null && raw.includes('"seq":' + opts.stopAtSeq)) finish();
      });
      res.on("end", finish);
    });
    req.on("error", finish);
    req.end();
  });
}

const seqsOf = (body) => (body.events || []).map((e) => Number(e.seq));
const jsonOf = (raw) => {
  try { return JSON.parse(raw); } catch { return { events: [] }; }
};
/** SSE 帧 → 与 JSON 面同形状的数组（用来证明两面同源） */
function parseSse(raw) {
  const out = [];
  for (const block of String(raw).split("\n\n")) {
    const line = block.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    try { out.push(JSON.parse(line.slice(6))); } catch (_) { /* 半帧忽略 */ }
  }
  return out;
}

/** 一路翻到底：返回拼起来的完整序列 */
async function walkAll(port, c0, limit) {
  const merged = [];
  let cursor = c0;
  for (let i = 0; i < 60; i++) {
    const r = await request(port, `/v1/events?since=${cursor}&format=json&limit=${limit}`);
    if (r.status !== 200) return { error: "status=" + r.status + " " + r.raw.slice(0, 120) };
    const j = jsonOf(r.raw);
    const seqs = seqsOf(j);
    merged.push(...seqs);
    if (!j.has_more) return { seqs: merged, pages: i + 1 };
    if (!seqs.length) return { error: "has_more=true 但这一页是空的（会死循环）" };
    cursor = Number(j.next_seq);
  }
  return { error: "60 页还没翻完" };
}

/* ---- 反向对照：把源码改坏，在内存里实例化（不落临时文件，不污染仓库）---- */
function loadMutated(src) {
  const m = { exports: {} };
  const fn = new Function("require", "module", "exports", "__dirname", "__filename", src);
  fn(requireFromShared, m, m.exports, SHARED, path.join(SHARED, "cn_inbound_server.js"));
  return m.exports;
}

/* 异步跑一条 shell：服务在本进程里，同步 spawn 会钉死事件循环（curl 永远等不到响应）。 */
function runShell(cmd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? Number(err.code || 1) : 0, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function summary() {
  console.log("\nprove_cursor_subscribe: PASS=" + pass + " FAIL=" + fail + " SKIP=" + skip);
  try { evMod.closeAllMirrors(); } catch (_) {}
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
}

(async function main() {
  /* ---- CS-00 前置：库里确有这些事件 ---- */
  const base = fullSeqs();
  if (base.length < 10 || !asc(base)) {
    bad("CS-00 前置：造出来的事件日志不足或不稠密", JSON.stringify(base));
    return summary();
  }
  ok("CS-00 前置：" + DESK + "/" + PHONE + " 交替写入 " + base.length + " 条，seq 全局严格递增 " + base.join(","));

  const s = await startServer({ eventLog: log });
  try {
    /* ---- CS-01 一次性 JSON 面：since=0 全量、有序、读得完就关 ---- */
    const r1 = await request(s.port, "/v1/events?since=0&format=json");
    if (r1.status !== 200 || !r1.ct.includes("application/json")) {
      bad("CS-01 GET /v1/events?since=0&format=json → 200 application/json", r1.status + " ct=" + r1.ct + " " + r1.raw.slice(0, 120));
    } else {
      const j = jsonOf(r1.raw);
      const seqs = seqsOf(j);
      check(
        j.ok === true && seqs.length === base.length && asc(seqs) && Number(j.next_seq) === base[base.length - 1] && j.has_more === false,
        "CS-01 一次性 JSON 面读通：count=" + j.count + " next_seq=" + j.next_seq + "，events[].seq 严格递增 " + seqs.join(","),
      );
      check(
        (j.events || []).every((e) => Number.isInteger(e.seq) && typeof e.kind === "string" && e.sessionId && typeof e.ts === "number"),
        "CS-01b 每帧都带 seq/kind/sessionId/ts —— 游标 API 不许给出「读不出下一条在哪」的帧",
      );
    }

    /* ---- CS-02 since 与旧名 from_seq 同义 ---- */
    const mid = base[3];
    const a = await request(s.port, `/v1/events?since=${mid}&format=json`);
    const b = await request(s.port, `/v1/events?from_seq=${mid}&format=json`);
    check(
      a.status === 200 && b.status === 200 && a.raw === b.raw,
      "CS-02 since=" + mid + " 与旧名 from_seq=" + mid + " 逐字节相同（一个语义两个名字，老客户端一字不改也能连）",
    );

    /* ---- CS-03/04 任意 seq 续订：不丢 + 不重 + 有序 ---- */
    const cursors = [0, base[0], base[2], base[4], base[base.length - 2], base[base.length - 1], base[base.length - 1] + 7];
    let completeOk = true;
    let noReplayOk = true;
    let orderedOk = true;
    const detail = [];
    for (const c of cursors) {
      const r = await request(s.port, `/v1/events?since=${c}&format=json`);
      if (r.status !== 200) { completeOk = false; detail.push(c + ":status" + r.status); continue; }
      const seqs = seqsOf(jsonOf(r.raw));
      if (!judgeComplete(seqs, c, base, 5000)) completeOk = false;
      if (!judgeNoReplay(seqs, c)) noReplayOk = false;
      if (!judgeOrdered(seqs)) orderedOk = false;
      detail.push(c + "→[" + seqs.join(",") + "]");
    }
    check(completeOk, "CS-03 任意 seq 续订「不丢」（" + cursors.length + " 个游标逐个对过桌面面里 >c 的全集）", detail.join(" "));
    check(noReplayOk, "CS-04 任意 seq 续订「不重」（无 <=游标 的帧、无重复 seq）", detail.join(" "));
    check(orderedOk, "CS-04b 每个游标给出的序列都严格递增");

    /* ---- CS-05 断线续订：后台期间的新事件，回来只补新的 ---- */
    {
      const seen = Number(jsonOf((await request(s.port, "/v1/events?since=0&format=json")).raw).next_seq);
      round(PHONE, "t-p2", 2); // App 在后台这段时间里产生的事件
      const back = await request(s.port, `/v1/events?since=${seen}&format=json`);
      const seqs = seqsOf(jsonOf(back.raw));
      const newBase = fullSeqs();
      const expect = newBase.filter((x) => x > seen);
      check(
        back.status === 200 && seqs.join(",") === expect.join(",") && seqs.length > 0 && judgeNoReplay(seqs, seen),
        "CS-05 断线-产新-重连：游标 " + seen + " 之后补到 " + seqs.length + " 条（" + seqs.join(",") + "），之前看过的 " + seen + " 条一条没重",
        back.raw.slice(0, 140),
      );
      const wholeRaw = await request(s.port, "/v1/events?since=0&format=json");
      const whole = seqsOf(jsonOf(wholeRaw.raw));
      check(whole.join(",") === newBase.join(","), "CS-05b 重连前后合起来 === 桌面面全量（" + newBase.length + " 条，无空洞）", "whole=" + whole.join(","));
      base.length = 0;
      base.push(...newBase);
    }

    /* ---- CS-06 三面同源：SSE（手机）= 一次性 JSON（curl）= 进程内 readAfter（桌面）---- */
    {
      const c = base[1];
      const last = base[base.length - 1];
      const sse = await request(s.port, `/v1/events?from_seq=${c}`, { mode: "sse", stopAtSeq: last, ms: 12000 });
      const jsn = await request(s.port, `/v1/events?since=${c}&format=json`);
      const curl = await request(s.port, `/v1/events?since=${c}`, { mode: "curl" });
      const sseSeqs = parseSse(sse.raw).map((e) => Number(e.seq));
      const jsonSeqs = seqsOf(jsonOf(jsn.raw));
      const curlSeqs = seqsOf(jsonOf(curl.raw));
      const deskSeqs = log.readAfter({ fromSeq: c, limit: 100000 }).map((r) => Number(r.seq));
      check(
        sseSeqs.length > 0 &&
          sseSeqs.join(",") === jsonSeqs.join(",") &&
          jsonSeqs.join(",") === deskSeqs.join(",") &&
          curlSeqs.join(",") === jsonSeqs.join(","),
        "CS-06 同一游标三面同源：SSE(手机)=JSON(format)=JSON(Accept:*/*)=桌面 readAfter，" + deskSeqs.length + " 条 " + deskSeqs.join(","),
        "sse=" + sseSeqs.join(",") + " curl=" + curlSeqs.join(","),
      );
      const frameKeys = Object.keys(parseSse(sse.raw)[0] || {}).sort().join(",");
      const jsonKeys = Object.keys((jsonOf(jsn.raw).events || [])[0] || {}).sort().join(",");
      check(frameKeys.length > 0 && frameKeys === jsonKeys, "CS-06b 两个面的字段集合一字相同（" + frameKeys + "）", "json=" + jsonKeys);
    }

    /* ---- CS-07 分页 + 会话过滤：limit=2 一路 next_seq 走完全程 ---- */
    {
      const walk = await walkAll(s.port, 0, 2);
      check(
        !walk.error && walk.seqs.join(",") === base.join(","),
        "CS-07 limit=2 分页游标走完全程：" + (walk.seqs || []).length + " 条 / " + (walk.pages || 0) + " 页 === 全量，不重不丢",
        walk.error || "",
      );
      const j = jsonOf((await request(s.port, "/v1/events?since=0&format=json&limit=2")).raw);
      check(
        (j.events || []).length === 2 && j.has_more === true && Number(j.next_seq) === seqsOf(j)[1],
        "CS-07b has_more / next_seq 说的是实话（截断页：" + j.events.length + " 条 has_more=" + j.has_more + " next_seq=" + j.next_seq + "）",
      );
      const jp = jsonOf((await request(s.port, `/v1/events?since=0&format=json&session_id=${PHONE}`)).raw);
      const wantP = log.readAfter({ sessionId: PHONE, fromSeq: 0, limit: 100000 }).map((r) => Number(r.seq));
      check(
        (jp.events || []).every((e) => e.sessionId === PHONE) && seqsOf(jp).join(",") === wantP.join(","),
        "CS-07c ?session_id= 只给这一个会话（" + wantP.length + " 条），与桌面按会话读的结果相同",
      );
    }

    /* ---- CS-08 坏游标不静默变全量；不带游标的两种面各按各的口径 ---- */
    {
      const cases = ["/v1/events?since=abc&format=json", "/v1/events?since=-1&format=json", "/v1/events?from_seq=1.5&format=json"];
      const got = [];
      let allOk = true;
      for (const p of cases) {
        const r = await request(s.port, p);
        let code = "";
        try { code = JSON.parse(r.raw).error || ""; } catch (_) {}
        got.push(p.split("?")[1] + "→" + r.status + "/" + (code || "-"));
        if (r.status !== 400 || code !== "cursor_invalid") allOk = false;
      }
      check(allOk, "CS-08 坏游标直接说清楚（" + got.join("  ") + "）：不再当 0 = 全量重放");
      const tailSse = await request(s.port, "/v1/events", { mode: "sse", ms: 3000 });
      const tailFrames = parseSse(tailSse.raw);
      check(
        tailSse.status === 200 && tailFrames.length === 0,
        "CS-08b 不带游标的 SSE 仍是「从队尾起推实况」（" + tailFrames.length + " 帧历史都不倒灌，RP-09 的口径没被这次改动破坏）",
      );
      const jAll = jsonOf((await request(s.port, "/v1/events?format=json")).raw);
      check(
        (jAll.events || []).length === base.length,
        "CS-08c 一次性读没有「实况」可跟：不带游标 = 从头读（" + jAll.events.length + " 条），与文档口径一致",
      );
    }

    /* ---- CS-09 终端可证：对标需求那条 curl|jq 命令原样敲得出来 ---- */
    {
      const has = (c) => spawnSync("/bin/sh", ["-c", "command -v " + c], { encoding: "utf8" }).status === 0;
      if (!has("curl") || !has("jq")) {
        skipped("CS-09 终端命令（本机缺 curl 或 jq）", "游标语义已由 CS-01..08 在 Node 侧断言；这一条证的「人敲得出来」那面");
      } else {
        /* 必须异步起子进程：服务就在本进程里，spawnSync 会把事件循环钉住，
           curl 的请求永远排不到响应（实测挂到超时）。 */
        const cmd =
          'curl -sS -H "Authorization: Bearer ' + TURN_TOKEN + '" "http://127.0.0.1:' + s.port + '/v1/events?since=0" | jq -c "[.events[].seq]"';
        const out = await runShell(cmd, 20000);
        const text = String(out.stdout || "").trim();
        let arr = null;
        try { arr = JSON.parse(text); } catch (_) {}
        check(
          out.code === 0 && Array.isArray(arr) && arr.length === base.length && asc(arr) && arr.join(",") === base.join(","),
          "CS-09 终端命令（不带 format，Accept 是 curl 默认的通配）：" + cmd,
          "→ " + (text || out.stderr || "").slice(0, 160),
        );
        const sseCmd =
          'curl -sS -N -H "Accept: text/event-stream" -H "Authorization: Bearer ' + TURN_TOKEN + '" ' +
          '"http://127.0.0.1:' + s.port + '/v1/events?since=' + base[1] + '" >/tmp/kp06-sse.txt 2>/dev/null & CP=$!; sleep 3; kill $CP 2>/dev/null; cat /tmp/kp06-sse.txt';
        const sseOut = await runShell(sseCmd, 20000);
        const sseText = String(sseOut.stdout || "");
        const lines = parseSse(sseText).map((e) => Number(e.seq));
        check(
          lines.length > 0 && asc(lines),
          "CS-09b 同一地址显式要 text/event-stream 就还是流（" + lines.length + " 帧，seq " + lines.join(",") + "）：Accept 决定面，手机那条老路径不受影响",
          sseText.slice(0, 50).replace(/\n/g, "\\n"),
        );
        try { fs.rmSync("/tmp/kp06-sse.txt", { force: true }); } catch (_) {}
      }
    }

    /* ---- CS-10 没库仍诚实 503（不许把「读不到」演成「没有事件」）---- */
    {
      fs.mkdirSync(EMPTY_ROOT, { recursive: true });
      const s2 = await startServer({ eventLog: null, repoRoot: EMPTY_ROOT });
      try {
        const r = await request(s2.port, "/v1/events?since=0&format=json");
        check(
          r.status === 503 && /event_log_unavailable/.test(r.raw),
          "CS-10 没有可读事件库 → 503 event_log_unavailable（不是一句空 200 糊过去）",
          r.status + " " + r.raw.slice(0, 100),
        );
      } finally {
        try { await s2.api.stop(); } catch (_) {}
      }
    }

    /* ================= 反向对照：改坏服务端，断言必须翻红 ================= */

    // N1：摘掉 `since` 的解析（只剩旧名）→ 续订带回旧事件
    {
      const src = CN_SRC.replace(/const cursorParam =\s*sinceParam[^;]*;/, "const cursorParam = fromSeqParam;");
      if (src === CN_SRC) bad("N1 没找到 since 解析源行（负控不可信）");
      else {
        const m = loadMutated(src);
        const s3 = await new Promise((res, rej) => {
          const api = m.createCnInboundServer({ repoRoot: TMP, port: 0, devicesPath: path.join(TMP, "n1.json"), eventLog: log, turnToken: TURN_TOKEN });
          api.start().then((i) => res({ api, port: Number(i.port) })).catch(rej);
        });
        try {
          const seen = base[base.length - 1];
          const seqs = seqsOf(jsonOf((await request(s3.port, `/v1/events?since=${seen}&format=json`)).raw));
          check(
            seqs.length > 0 && !judgeNoReplay(seqs, seen),
            "N1 负向对照真红：摘掉 `since` 解析 → 从 " + seen + " 续订拿到 " + seqs.length + " 条（含 <=游标 的旧帧），CS-04 判红",
            "seqs=" + seqs.slice(0, 6).join(","),
          );
        } finally {
          try { await s3.api.stop(); } catch (_) {}
        }
      }
    }

    // N2：一次性读的 fromSeq 写死成 0 → 「不丢」的对偶「不多」必须判红
    {
      const src = CN_SRC.replace(/page = log\.readAfter\(\{\s*fromSeq: from,/, "page = log.readAfter({\n              fromSeq: 0,");
      if (src === CN_SRC) bad("N2 没找到一次性读的游标实参源行（负控不可信）");
      else {
        const m = loadMutated(src);
        const s4 = await new Promise((res, rej) => {
          const api = m.createCnInboundServer({ repoRoot: TMP, port: 0, devicesPath: path.join(TMP, "n2.json"), eventLog: log, turnToken: TURN_TOKEN });
          api.start().then((i) => res({ api, port: Number(i.port) })).catch(rej);
        });
        try {
          const c = base[Math.floor(base.length / 2)];
          const seqs = seqsOf(jsonOf((await request(s4.port, `/v1/events?since=${c}&format=json`)).raw));
          check(
            seqs.length > 0 && !judgeComplete(seqs, c, base, 5000),
            "N2 负向对照真红：游标写死成 0 → 从 " + c + " 续订拿到 " + seqs.length + " 条（应只有 " + base.filter((x) => x > c).length + " 条），CS-03 判红",
            "seqs=" + seqs.slice(0, 6).join(","),
          );
        } finally {
          try { await s4.api.stop(); } catch (_) {}
        }
      }
    }

    // N3：has_more 探测写死 false → 分页必须停在第一页（会丢）
    {
      const src = CN_SRC.replace("const hasMore = page.length > limit;", "const hasMore = false;");
      if (src === CN_SRC) bad("N3 没找到 has_more 源行（负控不可信）");
      else {
        const m = loadMutated(src);
        const s5 = await new Promise((res, rej) => {
          const api = m.createCnInboundServer({ repoRoot: TMP, port: 0, devicesPath: path.join(TMP, "n3.json"), eventLog: log, turnToken: TURN_TOKEN });
          api.start().then((i) => res({ api, port: Number(i.port) })).catch(rej);
        });
        try {
          const walk = await walkAll(s5.port, 0, 2);
          check(
            (walk.seqs || []).length < base.length,
            "N3 负向对照真红：has_more 写死 false → 翻页只走到 " + (walk.seqs || []).length + "/" + base.length + " 条，CS-07 判红",
            walk.error || "",
          );
        } finally {
          try { await s5.api.stop(); } catch (_) {}
        }
      }
    }
  } finally {
    try { await s.api.stop(); } catch (_) {}
  }

  summary();
})().catch((err) => {
  bad("unexpected error", err && (err.stack || err.message));
  summary();
});
