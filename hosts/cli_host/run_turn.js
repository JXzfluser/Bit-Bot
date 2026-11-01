#!/usr/bin/env node
"use strict";

/**
 * Multi-end CLI Host — same MoonBit brain + Host FFI as Desktop.
 * Usage:
 *   node hosts/cli_host/run_turn.js [--machine-kind desktop|ios|android] \
 *     [--machine-id id] [--session-id s] [--channel addr] [--reply-to msg-id] "user text"
 */

const path = require("path");
const { createTurnRunner } = require("../shared/run_moon_turn");
const { resolveMachineId } = require("../shared/machine_identity");

/* T1-07 把内核常驻设成了桌面宿主的默认（hosts/desktop/main.js:55），桌面退出时有
   before-quit / will-quit 两级钩子收尾；一次性 CLI 没有，所以开了常驻之后
   「那一行 JSON 已经打完了、进程就是不退」—— 命令行卡住不返回，
   scripts/host_routine_daemon.sh 每一轮真的敲的
   `node hosts/cli_host/run_turn.js "tick routines"` 也卡在第一轮 sweep 上，
   外层一被杀就留下 node + 内核两级孤儿（scripts/prove_kernel_resident.mjs KR-11）。
   补上 CLI 自己的收尾：先按池的语义关 stdin 让内核自己收摊，等不到再按池报的
   pid 强杀兜底。两条路都有上限，不把挂死换个地方再挂一次。 */
let runnerRef = null;

async function releaseKernel() {
  if (!runnerRef || typeof runnerRef.stopKernel !== "function") return;
  /* 池的 pids 要在 stop() 之前取：stop() 头一步就把槽位摘干净了，
     等它卡住再去问「有哪些进程」已经问不出来，兜底那一记就落空。 */
  let pids = [];
  try {
    const st = runnerRef.kernelStats();
    pids = (st && st.pids) || [];
  } catch (_) {
    pids = [];
  }
  let timer = null;
  const settled = Promise.resolve()
    .then(() => runnerRef.stopKernel())
    .then(() => "stopped")
    .catch(() => "stop_failed");
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), 8000);
  });
  const outcome = await Promise.race([settled, guard]);
  if (timer) clearTimeout(timer);
  if (outcome !== "timeout") return;
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch (_) {
      /* 已经没了 */
    }
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, "../..");
  const runner = createTurnRunner(repoRoot);
  runnerRef = runner;
  const argv = process.argv.slice(2);
  let machineKind = process.env.BITBOT_MACHINE_KIND || "desktop";
  let machineId = process.env.BITBOT_MACHINE_ID || "";
  let sessionId = process.env.BITBOT_SESSION_ID || "cli-session";
  let channel = process.env.BITBOT_CHANNEL || "";
  let turnId = "";
  let botId = process.env.BITBOT_BOT_ID || "";
  let replyTo = process.env.BITBOT_REPLY_TO || "";
  let approved = process.env.BITBOT_APPROVED === "1";
  const textParts = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--machine-kind" && i + 1 < argv.length) {
      machineKind = argv[++i];
      continue;
    }
    if (a === "--machine-id" && i + 1 < argv.length) {
      machineId = argv[++i];
      continue;
    }
    if (a === "--session-id" && i + 1 < argv.length) {
      sessionId = argv[++i];
      continue;
    }
    if (a === "--channel" && i + 1 < argv.length) {
      channel = argv[++i];
      continue;
    }
    if (a === "--turn-id" && i + 1 < argv.length) {
      turnId = argv[++i];
      continue;
    }
    if (a === "--approved") {
      approved = true;
      continue;
    }
    if (a === "--bot-id" && i + 1 < argv.length) {
      botId = argv[++i];
      continue;
    }
    if (a === "--reply-to" && i + 1 < argv.length) {
      replyTo = argv[++i];
      continue;
    }
    if (a === "--") continue;
    textParts.push(a);
  }

  // B-2: 机器身份不再写死。默认仍是 desk-1(单机行为不变),
  // 多机时用 BITBOT_MACHINE_ID 区分。
  machineId = resolveMachineId({ kind: machineKind, explicit: machineId });

  const userText = textParts.join(" ").trim();
  if (!userText) {
    console.error(
      "usage: node hosts/cli_host/run_turn.js [--machine-kind ios] \"ListMachines\"",
    );
    process.exit(2);
  }

  const result = await runner.runTurn(userText, {
    sessionId,
    machineId,
    machineKind,
    channel,
    turnId: turnId || undefined,
    approved,
    cliApproved: approved === true,
    botId: botId || undefined,
    // GP-14: multi-end CLI carries the same reply target as Desktop.
    replyTo: replyTo || undefined,
    // GP-96: parity with Desktop — the CLI prints the same §5.7 progress stream,
    // on stderr, so stdout stays the single machine-readable JSON line.
    onProgress:
      process.env.BITBOT_CLI_PROGRESS === "1"
        ? (ev) => {
            if (ev.phase === "start")
              console.error(`[progress ${ev.index}/${ev.total}] ${ev.kind} (${ev.category}) …`);
            else if (ev.phase === "done")
              console.error(
                `[progress ${ev.index}/${ev.total}] ${ev.kind} ${ev.ok ? "ok" : "fail"}` +
                  (ev.error ? `: ${String(ev.error).slice(0, 80)}` : ""),
              );
            else if (ev.phase === "host_continuing")
              console.error("[progress] kernel continue (ADR 0002) …");
          }
        : undefined,
  });
  console.log(JSON.stringify(result));
  // 常驻池不收尾，这个进程就停在「结果已经打完、终端还没回来」这一步（KR-11）。
  await releaseKernel();
  if (!result.ok) process.exit(1);
}

main().catch(async (err) => {
  console.error(JSON.stringify({ ok: false, error: err.message || String(err) }));
  await releaseKernel();
  process.exit(1);
});
