/*
 * probe_checkpoint_save_cost.mjs — 把 CHECKPOINT_STRIDE 从「拍脑袋的 2000」变成量出来的数。
 *
 * 节流两侧都是钱：落一次盘 = 把整面 JSON 序列化 + 原子写；不落 = 下个冷进程多折「距上次落盘新增的行」。
 * 所以 stride 的正确问法是：**一次落盘值多少行重折**。本脚本在同一颗热槽上交替跑两组读数，
 * 每组每轮先 append 一条事件再读一次（折 1 行，两组完全同形）：
 *   A 组传 checkpointStride:1 → 每次读都落盘；
 *   B 组传 checkpointStride:1e9 → 一次都不落盘。
 * 两组每轮耗时之差 = 单次落盘的价钱。再拿冷折的每行价钱（同脚本量：整面重折耗时 / 行数）除一下，
 * 就得到「每多少行落一次盘才不亏」。只在临时根里跑，绝不碰仓库 data/。
 *
 * 用法：node scripts/probe_checkpoint_save_cost.mjs [会话数=500] [轮数=25]
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readModel = require(path.join(ROOT, "hosts/shared/event_read_model.js"));

const SESSIONS = Number(process.argv[2] || 500);
const ROUNDS = Number(process.argv[3] || 25);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-ckcost-"));
process.env.BITBOT_EVENT_DUAL_WRITE = "1";
process.env.BITBOT_EVENT_READ = "1";

const ms = (fn) => {
  const t0 = process.hrtime.bigint();
  const out = fn();
  return [Number(process.hrtime.bigint() - t0) / 1e6, out];
};

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

try {
  const { createSessionStore } = require(path.join(ROOT, "hosts/desktop/sessions.js"));
  const store = createSessionStore(ROOT, { dataRoot: root });
  const [buildMs] = ms(() => {
    for (let i = 0; i < SESSIONS; i += 1) store.create(`cost 会话 ${i}`);
  });
  const dbFile = readModel.dbFilePath(root);
  const ckFile = readModel.checkpointPathFor(dbFile);
  readModel.closeAll();

  /* 冷折每行价钱：同一颗库，从盘上重来折整面。
     必须先删检查点：build 那趟已经把检查点写到 ~lastSeq，不删的话这里量到的是「续折 501 行」
     的边际价钱却当成整面价钱用，换算出来的 stride 会小一个数量级（第一版就是这么错的）。 */
  fs.rmSync(ckFile, { force: true });
  const [coldMs, cold] = ms(() => readModel.readSurfaces(root, { env: process.env, checkpointStride: 1e9 }));
  if (!cold.ok) {
    console.log(`冷读失败：${JSON.stringify({ reason: cold.reason })}`);
    process.exit(1);
  }
  if (cold.foldPath !== "full" || cold.count < cold.lastSeq) {
    console.log(`冷读没折整面（path=${cold.foldPath} 读 ${cold.count} 行 / lastSeq ${cold.lastSeq}）—— 每行价钱不成立，先修夹具`);
    process.exit(1);
  }
  const perRow = coldMs / cold.count;

  const openLog = require(path.join(ROOT, "hosts/shared/event_log.js")).openEventLog;
  const h = openLog({ file: dbFile, actor: "ck-cost" });
  const saveA = [];
  const saveB = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    h.append({ sessionId: "system", kind: "session_created", payload: { surface: "sessions", session: { id: `sess-costB${i}`, title: `B 组 ${i}` } } });
    const [bMs, b] = ms(() => readModel.readSurfaces(root, { env: process.env, checkpointStride: 1e9 }));
    if (!b.ok) { console.log(`B 组读失败 ${JSON.stringify({ reason: b.reason })}`); process.exit(1); }
    saveB.push(bMs);
    h.append({ sessionId: "system", kind: "session_created", payload: { surface: "sessions", session: { id: `sess-costA${i}`, title: `A 组 ${i}` } } });
    const [aMs, a] = ms(() => readModel.readSurfaces(root, { env: process.env, checkpointStride: 1 }));
    if (!a.ok) { console.log(`A 组读失败 ${JSON.stringify({ reason: a.reason })}`); process.exit(1); }
    saveA.push(aMs);
  }
  h.close();
  const saveCost = median(saveA) - median(saveB);
  const ckBytes = fs.existsSync(ckFile) ? fs.statSync(ckFile).size : 0;
  const rowsWorth = saveCost / perRow;
  console.log(`建 ${SESSIONS} 会话 ${buildMs.toFixed(0)}ms · 冷折整面 ${coldMs.toFixed(1)}ms / ${cold.count} 行 = ${perRow.toFixed(4)}ms/行`);
  console.log(`热读中位数：不落盘 ${median(saveB).toFixed(2)}ms · 每读必落 ${median(saveA).toFixed(2)}ms → 一次落盘 ${saveCost.toFixed(2)}ms（面 ${(ckBytes / 1024).toFixed(0)}KB）`);
  console.log(`纯时间盈亏平衡：一次落盘 = ${rowsWorth.toFixed(0)} 行的重折价钱（低于这个 stride 就是净亏：热路径付得比冷启动省下的还多）`);
  console.log(`stride 候选（冷启最坏重折 / 摊到每行的落盘钱 / 每行写放大）：`);
  for (const s of [64, 128, 256, 512, 1000, 2000]) {
    console.log(`  ${String(s).padStart(4)} 行 → 冷启多折 ${(s * perRow).toFixed(1)}ms · 每行 ${(saveCost / s).toFixed(4)}ms · 每行写 ${(ckBytes / s / 1024).toFixed(2)}KB`);
  }
  console.log(`现值 CHECKPOINT_STRIDE=${readModel.CHECKPOINT_STRIDE} → 冷启最坏多折 ${(readModel.CHECKPOINT_STRIDE * perRow).toFixed(1)}ms`);
  console.log(`注：perRow 是对当前库大小 N 的**平均**折价，折叠是超线性的（§8.168 指数 ~1.8），所以 N 越大 lag 的价钱越高 —— 换库量级要重跑本脚本。`);
  readModel.closeAll();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
