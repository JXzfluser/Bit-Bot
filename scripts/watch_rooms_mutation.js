#!/usr/bin/env node
"use strict";

/**
 * watch_rooms_mutation — 抓「谁把群面写空了」的**时间线**
 *
 * 现场（真 provider 第 8/9 轮）：一键成队后群整批消失
 * （rooms.json 变成 {"version":1,"rooms":[]}），而成员答过的话还在转录里。
 * ⇒ 已有假设（并发写丢更新）**解释不了**：合并后的产物已被实测保住群。
 * ⇒ 那就**别猜**，看事实：每 100ms 记一次群面签名变化，
 *   并且**同时盯住 .lock 目录里的 pid**（写侧持锁人）⇒ 写者是谁，事后可知。
 *
 * 用法：node scripts/watch_rooms_mutation.js <隔离数据根> [输出文件]
 */

const fs = require("fs");
const path = require("path");

const root = process.argv[2] || "";
const outFile = process.argv[3] || path.join(root, "rooms-watch.jsonl");
if (!root) {
  console.error("用法: watch_rooms_mutation.js <隔离数据根> [输出文件]");
  process.exit(1);
}
const ROOMS = path.join(root, "data", "desktop", "rooms.json");
const LOCK = ROOMS + ".lock";
const PID = path.join(LOCK, "pid");

let lastSig = null;
let lastPid = null;
const t0 = Date.now();
const at = () => ((Date.now() - t0) / 1000).toFixed(2);

function write(rec) {
  try {
    fs.appendFileSync(outFile, JSON.stringify(rec) + "\n");
  } catch { /* 记不下来就算了，不能因为记日志把探针搞崩 */ }
}

write({ t: at(), kind: "start", rooms: ROOMS });

const timer = setInterval(() => {
  /* 持锁人（写侧在 atomicWrite 前会 mkdir rooms.json.lock 并写下自己的 pid）。 */
  let pid = null;
  try { pid = String(fs.readFileSync(PID, "utf8")).trim(); } catch { /* 没锁 = 此刻没人持锁 */ }
  if (pid && pid !== lastPid) {
    lastPid = pid;
    write({ t: at(), kind: "lock", pid });
  }
  let sig = null;
  let size = -1;
  try {
    const raw = fs.readFileSync(ROOMS, "utf8");
    size = raw.length;
    const j = JSON.parse(raw);
    const rooms = Array.isArray(j.rooms) ? j.rooms : [];
    sig = rooms.map((r) => String((r && r.id) || "?")).join(",");
  } catch (err) {
    write({ t: at(), kind: "read_err", err: String((err && err.message) || err).slice(0, 80) });
    return;
  }
  if (sig !== lastSig) {
    lastSig = sig;
    write({ t: at(), kind: "rooms", n: sig ? sig.split(",").length : 0, size, sig });
  }
}, 100);

process.on("SIGTERM", () => { clearInterval(timer); write({ t: at(), kind: "stop" }); process.exit(0); });
process.on("SIGINT", () => { clearInterval(timer); write({ t: at(), kind: "stop" }); process.exit(0); });

console.log("监视中：" + ROOMS + " → " + outFile);
