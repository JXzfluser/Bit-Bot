"use strict";

/**
 * B-1 — the Box entry point.
 *
 * 一台**常开的机器**:一个 Node 进程,里面跑着 MoonBit 内核(编译好的原生二进制)
 * 和 Host FFI。它接收别的机器(手机、桌面、钉钉、飞书)发来的回合,真的跑,
 * 真的回话。
 *
 * 这不是新东西 —— `cn_inbound_server.js` 早就是 daemon 了。
 * B-1 做的事是把它**打包成一台机器**:平铺布局 + 自带内核二进制 +
 * 一个 start 脚本 + 一份 manifest(说清楚这台机器是什么、装了什么)。
 *
 * 机器身份(B-4a):`data/host/devices.json` 里登记的设备公钥。
 * **Box 上没有私钥** —— 别的机器用自己那对密钥来证明「我是我」。
 *
 * 用法:
 *   BITBOT_KERNEL_BIN=<box>/bin/desktop_turn node shared/box_main.js
 */

const path = require("path");
const fs = require("fs");
const { createCnInboundServer } = require("./cn_inbound_server");
const { createTurnRunner } = require("./run_moon_turn");
const { createRoutineScheduler } = require("./routine_scheduler");

async function main() {
  const boxRoot = path.resolve(__dirname, "..");
  const port = Number(process.env.BITBOT_CN_INBOUND_PORT || 18765);
  const devicesPath =
    String(process.env.BITBOT_DEVICES_PATH || "") ||
    path.join(boxRoot, "data", "host", "devices.json");

  // 内核必须是随包走的二进制。没有它这台机器就只有 Host 没有脑。
  const kernelBin =
    String(process.env.BITBOT_KERNEL_BIN || "") ||
    path.join(boxRoot, "bin", process.platform === "win32" ? "desktop_turn.exe" : "desktop_turn");
  if (!fs.existsSync(kernelBin)) {
    console.error(
      "[box] FATAL: no kernel binary at " + kernelBin +
        " — this machine has a Host but no brain. Run scripts/pack-box.sh first.",
    );
    process.exit(1);
  }
  process.env.BITBOT_KERNEL_BIN = kernelBin;

  const server = createCnInboundServer({ repoRoot: boxRoot, port, devicesPath });
  const info = await server.start();

  // 排程调度器:这台机器自己到点醒。
  // 「机器常开」的第一半 —— 到点得有人醒。第二半是跨端审批(见 /v1/approvals)。
  const sweepMs = Number(process.env.BITBOT_ROUTINE_SWEEP_MS || 60000);
  let scheduler = null;
  if (sweepMs > 0) {
    const runner = createTurnRunner(boxRoot);
    scheduler = createRoutineScheduler({
      runTurn: (text, ctx) => runner.runTurn(text, ctx),
      dataRoot: path.join(boxRoot, "data"),
      intervalMs: sweepMs,
    });
    scheduler.start();
  }

  const manifestPath = path.join(boxRoot, "manifest.json");
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (_) {
    manifest = null;
  }

  console.log(
    "[box] machine up — kernel=" + kernelBin +
      " devices=" + devicesPath +
      (manifest ? " name=" + (manifest.machine_name || manifest.machine_id || "") : ""),
  );
  console.log("[box] routes:", JSON.stringify(info && info.routes ? info.routes : {}, null, 0));
  console.log(
    "[box] routine scheduler: " +
      (scheduler
        ? "on (every " + scheduler.intervalMs + "ms, 到点只备草稿;自动执行要用户的常驻授权)"
        : "off (BITBOT_ROUTINE_SWEEP_MS=0)"),
  );
  console.log(
    "[box] turn auth: " +
      (fs.existsSync(devicesPath) && (JSON.parse(fs.readFileSync(devicesPath, "utf8")).devices || []).length
        ? "device keys (per-machine, revocable)"
        : "shared turn token (legacy) — run: node scripts/device-keys.js init"),
  );

  const shutdown = async () => {
    try {
      if (scheduler) scheduler.stop();
    } catch (_) {
      /* 停不掉调度器也不能挂住进程 */
    }
    try {
      await server.stop();
    } catch (_) {
      /* 关不干净也不能挂住进程 */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[box] FATAL: " + String((e && e.stack) || e));
  process.exit(1);
});
