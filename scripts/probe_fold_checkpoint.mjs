/*
 * probe_fold_checkpoint.mjs — 量 #82 后半（检查点）到底把冷启动省掉多少，用**真两个进程**量。
 *
 * 为什么必须换进程：`readSurfaces` 的进程内缓存按 lastSeq 失效，同进程里 closeAll 再读
 * 只能证明「模块状态清空了」，证明不了冷进程从盘上那份检查点起手的真实价钱
 * （开库、读文件、JSON.parse 全在那一格）。所以本脚本按 root 复用来跑两趟：
 *   第 1 趟 build —— 真 store 建 N 条会话（双写落日志），然后冷读一次（应当 foldPath=full）；
 *   第 2 趟 reuse —— 同一 root、新进程，只冷读一次（应当 foldPath=checkpoint）。
 * 两趟都打印耗时、读到的行数、检查点文件大小与库大小 —— 省下的时间要用「多读了一份几 MB 的
 * JSON」这个代价换，不写代价的读数不作数。
 *
 * 用法：node scripts/probe_fold_checkpoint.mjs <dataRoot> [build|reuse] [会话数]
 * 只在临时目录里跑，绝不碰仓库 data/。
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readModel = require(path.join(ROOT, "hosts/shared/event_read_model.js"));

const argRoot = process.argv[2];
const mode = process.argv[3] || "build";
const SESSIONS = Number(process.argv[4] || 1500);
const root = argRoot ? path.resolve(argRoot) : fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-ckpt-"));
fs.mkdirSync(root, { recursive: true });
const marker = path.join(root, ".probe-built.json");

process.env.BITBOT_EVENT_DUAL_WRITE = "1";
process.env.BITBOT_EVENT_READ = "1";

const ms = (fn) => {
  const t0 = process.hrtime.bigint();
  const out = fn();
  return [Number(process.hrtime.bigint() - t0) / 1e6, out];
};

let built = null;
if (mode === "build") {
  const { createSessionStore } = require(path.join(ROOT, "hosts/desktop/sessions.js"));
  const store = createSessionStore(ROOT, { dataRoot: root });
  const [buildMs] = ms(() => {
    for (let i = 0; i < SESSIONS; i += 1) store.create(`ckpt 会话 ${i}`);
  });
  built = { sessions: SESSIONS, buildMs: Number(buildMs.toFixed(1)) };
  fs.writeFileSync(marker, JSON.stringify(built));
  console.log(`[build] 建 ${SESSIONS} 条会话耗时 ${buildMs.toFixed(0)}ms（双写落日志）`);
} else {
  try {
    built = JSON.parse(fs.readFileSync(marker, "utf8"));
  } catch {
    console.log("[reuse] 没有 .probe-built.json —— 先跑 build 那趟，否则这一趟量的是空库");
    process.exit(2);
  }
}

const dbFile = readModel.dbFilePath(root);
const ckFile = readModel.checkpointPathFor(dbFile);
const sizeOf = (f) => (fs.existsSync(f) ? (fs.statSync(f).size / 1024 / 1024).toFixed(2) : "0.00");

const [readMs, r] = ms(() => readModel.readSurfaces(root, { env: process.env }));
if (!r.ok) {
  console.log(`[${mode}] 冷读失败：reason=${r.reason} —— 检查点没有把读变成「敢宣布状态」的口径变化，先看这条`);
  process.exit(1);
}
const [hitMs] = ms(() => readModel.readSurfaces(root, { env: process.env }));
console.log(
  `[${mode}] 冷读 ${readMs.toFixed(1)}ms（foldPath=${r.foldPath} 新读 ${r.count} 行 lastSeq=${r.lastSeq}）` +
    ` → 二读 ${hitMs.toFixed(1)}ms · 会话 ${r.sessions.sessions.length} 条` +
    ` · 库 ${sizeOf(dbFile)}MB / 检查点 ${sizeOf(ckFile)}MB`,
);
if (mode === "reuse") {
  const all = readModel.foldPages ? "(foldPages 可用)" : "";
  console.log(`[reuse] 结论：新进程冷启不再从 seq=1 折全量；${all} 代价是把检查点那份 JSON 读进内存再解析。`);
}
if (!argRoot) fs.rmSync(root, { recursive: true, force: true });
