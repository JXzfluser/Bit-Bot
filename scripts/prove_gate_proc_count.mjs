#!/usr/bin/env node
"use strict";

/**
 * prove_gate_proc_count — 门禁「进程计数」这一把尺子本身的证明
 *
 * 为什么要单独证明它：两个真实 Electron 门禁（单实例、退出）都是靠「这个
 * user-data-dir 下还有几个进程」下结论的。旧写法是
 * `execSync("pgrep -f <UD>")`，而 execSync 会先起一个
 * `/bin/sh -c pgrep -f <UD>` —— 这个 shell 自己的命令行里就带着 <UD>，
 * 于是 pgrep 永远多算 1 个：1 个实例被读成 2（判「锁没生效」）、
 * 退出后 0 残留被读成 1（判「退不掉」）。**红的是尺子，不是产品。**
 *
 * 本脚本用假进程（argv 里刻意带上 main.js / UD）钉三件事：
 *   PC-1 修复前红：旧写法把不是主进程的东西也算成实例（只带 UD 的辅助进程
 *        一定被算进来；某些平台上连承载 pgrep 的那个 sh -c 也算）
 *   PC-2 修复后绿：countAppMains 只数「带 main.js + UD 的主进程」，
 *        Chromium 辅助进程（只带 UD）不计入
 *   PC-3 清场真有效：killGateProcs 之后两个计数都回 0
 * 不启动 Electron，几秒内跑完；exit 0 = 全绿。
 */

import path from "path";
import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";
import { countAppMains, countAllGateProcs, killGateProcs } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 造一个「看起来像 Electron 进程」的假进程。
 * 位置参数必须排在 --user-data-dir 前面：node 会把 `-e <脚本>` 之后紧跟的
 * `--xxx` 当成自己的 CLI 选项解析，未知选项直接 "bad option" 退出（实测辅助
 * 进程就是这么死的，于是「多进程」场景造不出来）。主进程带 main.js，
 * 辅助进程只带 UD —— 和真实 Electron 的命令行形状一致。 */
function fakeMain(ud, isMain) {
  const argv = [process.execPath, "-e", "setTimeout(()=>{},8000)", isMain ? "main.js" : "preload"];
  argv.push("--user-data-dir=" + ud);
  return spawn(argv[0], argv.slice(1), { stdio: "ignore" });
}

/* 旧写法（保留在这里，只用于负向对照，不进任何门禁）。 */
function legacyCount(pattern) {
  try {
    const out = execSync("pgrep -f " + JSON.stringify(pattern), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split(/\s+/).map((s) => Number(s.trim())).filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function main() {
  console.log("门禁进程计数 proof");
  const UD = path.join("/tmp", "bitbot-e2e-ud-count-" + process.pid);

  const mainProc = fakeMain(UD, true); // 主进程：main.js + UD
  const helperProc = fakeMain(UD, false); // 辅助进程：只有 UD
  await sleep(600);

  /* PC-1 修复前红：真实只有 1 个主进程（+1 个只带 UD 的辅助进程），
     旧写法数的是「命令行里出现 UD 的所有进程」——辅助进程必然被算成实例，
     在 pgrep 不自我排除的平台上（Linux CI 就是这么红的）连承载它自己的
     `/bin/sh -c pgrep -f <UD>` 也一起算进去。所以这条断言写成跨平台都成立的
     形式：legacy 严格大于真实主进程数，而不是「恰好比 2 多 1」。 */
  const legacy = legacyCount(UD);
  const realMains = countAppMains(UD);
  legacy > realMains
    ? ok("PC-1 修复前红：旧 execSync(pgrep -f UD) 数到 " + legacy + "，真实主进程只有 " + realMains + "（只带 UD 的辅助进程被当成实例；本机 pgrep 是否连 sh -c 一起数见平台差异）")
    : bad("PC-1 修复前红没有翻红", "legacy=" + legacy + "，realMains=" + realMains + " → 本证明的前提不成立");

  /* PC-2 修复后绿：主进程计数=1，辅助进程不计入实例数 */
  const mains = countAppMains(UD);
  const all = countAllGateProcs(UD);
  mains === 1
    ? ok("PC-2 countAppMains 只数主进程（main.js + UD）= 1，不被 shell 与辅助进程污染")
    : bad("PC-2 主进程计数错", mains);
  all >= 2
    ? ok("PC-2 countAllGateProcs 仍看得见辅助进程（" + all + " ≥ 2），残留不会被子串过滤藏掉")
    : bad("PC-2 全量计数漏了辅助进程", all);

  /* PC-3 清场真有效 */
  const killed = killGateProcs(UD);
  await sleep(300);
  const afterMain = countAppMains(UD);
  const afterAll = countAllGateProcs(UD);
  killed >= 2 && afterMain === 0 && afterAll === 0
    ? ok("PC-3 killGateProcs 发过 " + killed + " 次 SIGKILL 后两个计数都回 0（清场干净）")
    : bad("PC-3 清场不干净", JSON.stringify({ killed, afterMain, afterAll }));

  for (const p of [mainProc, helperProc]) {
    try { p.kill("SIGKILL"); } catch { /* ignore */ }
  }

  console.log("\nprove_gate_proc_count: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((err) => {
  bad("unexpected error", err && err.message);
  process.exit(1);
});
