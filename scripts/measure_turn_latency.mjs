#!/usr/bin/env node
/*
 * measure_turn_latency.mjs — KP-04 可感面：把每回合的三段延迟打出来。
 *
 *   node scripts/measure_turn_latency.mjs            # 今天最近 20 条
 *   node scripts/measure_turn_latency.mjs --limit 5  # 只看最近 5 条
 *   node scripts/measure_turn_latency.mjs --day 2026-11-11
 *   node scripts/measure_turn_latency.mjs --turn <turn_id>   # 从日志反查某一条
 *
 * 它只做一件事：读 data/latency/*.jsonl，用**唯一**的 turn_latency.js 派生并打印
 *   「回车→发送 X ms · 发送→首字 Y ms · 首字→落库 Z ms」。
 * 数字与验收门里断言的是同一段公式、同一份模块——不在这里再算一遍。
 * 没测到的段显示「—」，绝不显示 0；一条都没有时明说「0 条」（不许 0 条也算成功）。
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const req = createRequire(import.meta.url);
const T = req(path.join(REPO, "hosts/shared/turn_latency.js"));

function dataRoot() {
  if (process.env.BITBOT_DATA_ROOT) return process.env.BITBOT_DATA_ROOT;
  if (process.env.BITBOT_REPO_ROOT) return path.join(process.env.BITBOT_REPO_ROOT, "data");
  return path.join(REPO, "data");
}

// 极简参数解析：--limit N / --day YYYY-MM-DD / --turn ID
function parseArgs(argv) {
  const a = { limit: 20, day: "", turn: "" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--limit") a.limit = Number(argv[++i]) || a.limit;
    else if (k === "--day") a.day = String(argv[++i] || "");
    else if (k === "--turn") a.turn = String(argv[++i] || "");
  }
  return a;
}

function main() {
  const root = dataRoot();
  const opts = parseArgs(process.argv.slice(2));
  const recs = T.readRecords(root, { day: opts.day || undefined, limit: opts.limit });

  console.log(`data/latency 根：${T.latencyDir(root)}`);

  if (opts.turn) {
    const one = T.findByTurnId(recs, opts.turn);
    if (!one) {
      console.log(`未找到 turn_id=${opts.turn} 的记录。`);
      process.exit(1);
    }
    console.log(T.format(one));
    const v = T.validateOrder(one);
    if (!v.ok) console.log("  自洽性问题：" + v.problems.join("；"));
    return;
  }

  if (recs.length === 0) {
    console.log("0 条样本（还没跑过带计时的回合）——这不是成功，是「没测到」。");
    console.log("发一条桌面私聊消息后，再运行本脚本。");
    process.exit(1);
  }

  for (const r of recs) {
    const line = T.format(r);
    const v = T.validateOrder(r);
    console.log(v.ok ? line : line + "   [!] " + v.problems.join("；"));
  }

  const m = T.measure(recs);
  const q = (arr, p) => {
    if (!arr.length) return "—";
    const s = arr.slice().sort((x, y) => x - y);
    return String(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
  };
  console.log(
    `\n样本 ${m.n} 条 · 「发送→首字」量到 ${m.send_to_first.length} 条 · 各不相同 ${m.distinct} 个\n` +
      `  p50 ${q(m.send_to_first, 0.5)} ms · p95 ${q(m.send_to_first, 0.95)} ms`,
  );
}

main();
