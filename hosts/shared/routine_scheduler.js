"use strict";

/**
 * B-1 补: the Box's own routine scheduler.
 *
 * 「机器常开」的第一半:到点得有人醒。
 *
 * 现状:`scripts/host_routine_daemon.sh` 能 tick 排程,但它
 *   - 是 bash + python,不是这台机器的一部分;
 *   - 假设仓库布局(`node hosts/cli_host/run_turn.js`),打包后的 Box 里没有;
 *   - 要 systemd 单元才能关掉 `long_lived_cron_residual`。
 *
 * **Box 自己就是那个 daemon** —— 它本来就是常驻进程,再外挂一个守护脚本是
 * 多余的一层。所以这一份直接长在 Host 里:
 *
 *   - 每隔 intervalMs 跑一个回合「tick routines」——**走产品路径**
 *     (内核意图 → routine_tick effect → Host 唤醒到期任务),不调内部函数,
 *     所以和桌面那条是同一条路。
 *   - 写 `data/routines/daemon-status.json`(`long_lived: true`)
 *     ⇒ `long_lived_cron_residual` 关闭 ⇒ 界面可以**如实**说「排程已武装」。
 *   - sweep 结果落 `data/routines/daemon-sweeps.jsonl`,可回看。
 *
 * 诚实边界:
 *   - **到点默认仍然只备草稿**(GP-108「先读后执行」)。机器常开 ≠ 机器自己乱发邮件。
 *     自动执行要靠**用户的常驻授权**(`BITBOT_ROUTINE_AUTO_EXECUTE`),不在这里默认开。
 *   - sweep 失败**不影响下一次** —— 一次失败只是没扫到,不是停摆。
 *   - 一次 sweep 只跑一个回合;到期任务多的时候,一个回合里 Host 会全部处理。
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_INTERVAL_MS = 60000;

function appendJsonl(file, row) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + "\n");
  } catch (_) {
    /* 记录写不下去也不能让排程停摆 */
  }
}

/**
 * @param {object} o
 * @param {Function} o.runTurn        (text, ctx) => Promise<result>  —— 真 runner
 * @param {string} o.dataRoot
 * @param {number} [o.intervalMs]
 * @param {string} [o.sessionId]
 */
function createRoutineScheduler(o) {
  const opts = o || {};
  const runTurn = opts.runTurn;
  const dataRoot = opts.dataRoot;
  const intervalMs = Math.max(
    1000,
    Number(opts.intervalMs || process.env.BITBOT_ROUTINE_SWEEP_MS || DEFAULT_INTERVAL_MS),
  );
  const sessionId = String(opts.sessionId || "box-routine-sweeper");
  const routinesDir = path.join(dataRoot, "routines");
  const statusPath = path.join(routinesDir, "daemon-status.json");
  const sweepsPath = path.join(routinesDir, "daemon-sweeps.jsonl");

  let timer = null;
  let running = false;
  let stopped = false;
  const state = {
    started_at: null,
    sweeps: 0,
    ok: 0,
    fail: 0,
    last_error: "",
    last_sweep_at: "",
    last_due_count: 0,
    interval_ms: intervalMs,
  };

  /**
   * 写 daemon-status.json。
   * `long_lived: true` 是**真的** —— 这个进程确实常驻、确实在定期扫。
   * 这不是「假装武装」,是让 `routine_schedule` 那边的 residual 判定
   * 有一个诚实的事实依据。
   */
  function writeStatus(extra) {
    const status = {
      daemon: true,
      long_lived: true,
      systemd_unit: false,
      systemd_unit_installed: false,
      systemd_unit_active: false,
      systemd_scope: null,
      sweeps: state.sweeps,
      ok: state.ok,
      fail: state.fail,
      interval_ms: state.interval_ms,
      started_at: state.started_at,
      last_sweep_at: state.last_sweep_at,
      last_error: state.last_error,
      note:
        "Box 内置排程调度器(共享层 Host)。到点只备草稿;自动执行要用户的常驻授权。",
      at: new Date().toISOString(),
      ...(extra || {}),
    };
    try {
      fs.mkdirSync(routinesDir, { recursive: true });
      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
      try {
        fs.chmodSync(statusPath, 0o600);
      } catch (_) {
        /* 权限收紧失败不致命 */
      }
    } catch (_) {
      /* 状态写不下去也不致命 */
    }
    return status;
  }

  /** 跑一次 sweep。返回 {ok, due_count, fired_count, error}。 */
  async function sweepOnce(reason) {
    if (running || stopped) return { ok: false, error: "sweep_in_progress" };
    running = true;
    const at = new Date().toISOString();
    try {
      const result = await runTurn("tick routines", {
        sessionId,
        machineId: String(process.env.BITBOT_BOX_MACHINE_ID || "box-local"),
        machineKind: "desktop",
        channel: "",
        turnId: "routine-sweep-" + Date.now().toString(36),
        // 排程自己触发的回合不是「用户点了允许」——审批语义不变。
        approved: false,
      });
      const ok = Boolean(result && result.ok !== false);
      const hostResults = (result && result.host_results) || [];
      const tick = hostResults.find((h) => h && h.kind === "routine_tick");
      let payload = {};
      try {
        payload = JSON.parse(String((tick && tick.stdout) || "{}")) || {};
      } catch (_) {
        payload = {};
      }
      state.sweeps += 1;
      if (ok) state.ok += 1;
      else state.fail += 1;
      state.last_sweep_at = at;
      state.last_error = ok ? "" : String((result && result.error) || "sweep_failed");
      state.last_due_count = Number(payload.due_count || 0);
      const row = {
        at,
        reason: String(reason || "interval"),
        ok,
        due_count: Number(payload.due_count || 0),
        fired_count: Number(payload.fired_count || 0),
        fired_ids: Array.isArray(payload.fired_ids) ? payload.fired_ids : [],
        error: state.last_error,
      };
      appendJsonl(sweepsPath, row);
      writeStatus();
      return { ok, ...row };
    } catch (err) {
      state.sweeps += 1;
      state.fail += 1;
      state.last_sweep_at = at;
      state.last_error = String((err && err.message) || err);
      appendJsonl(sweepsPath, { at, reason: String(reason || "interval"), ok: false, error: state.last_error });
      writeStatus();
      return { ok: false, error: state.last_error };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return { ok: true, already: true };
    stopped = false;
    state.started_at = new Date().toISOString();
    writeStatus();
    // 先立刻扫一次:机器刚起来时可能有已经到点的排程。
    const kick = setTimeout(() => {
      sweepOnce("startup").catch(() => {});
    }, 50);
    timer = setInterval(() => {
      sweepOnce("interval").catch(() => {});
    }, intervalMs);
    if (timer.unref) timer.unref();
    if (kick.unref) kick.unref();
    return { ok: true, interval_ms: intervalMs, status_path: statusPath };
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    writeStatus({ long_lived: false, note: "调度器已停 —— residual 重新打开(诚实)。" });
    return { ok: true };
  }

  return {
    start,
    stop,
    sweepOnce,
    state,
    statusPath,
    sweepsPath,
    intervalMs,
  };
}

module.exports = { createRoutineScheduler, DEFAULT_INTERVAL_MS };
