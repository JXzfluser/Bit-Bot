/* e2e_desktop_sweep_timer.mjs — GP-170：装着 Bit Bot 的电脑自己会醒
 *
 * 用户场景（自媒体博主）：08:00 定时发文、发完把稿子转交给审核 Bot、晚上定时
 * 推邮箱。这些「到点了该动」的事，只有 daemon 在跑才会发生。
 *
 * 断点（为什么要这一门）：
 *   1. hosts/desktop/main.js 没有任何 setInterval —— 唤醒完全外包给
 *      scripts/host_routine_daemon.sh（bash + 仓库里才有的一份脚本）。
 *   2. hosts/desktop/package.json 的 build.files 里没有 scripts/ —— 装到
 *      用户机器上的 app **根本找不到**那份脚本；Windows 上连 /bin/bash 都没有。
 *      于是「装好 App、电脑开着、群里没人说话」时，定时任务与挂账转交都不会醒。
 *   3. 既有的所有 Electron 门禁都设 BITBOT_ROUTINE_DAEMON_AUTOSTART=0
 *      （避免污染），也就是说这条路径从来没有一篇门禁真的跑过。
 *
 * 所以本门禁**故意**在 daemon 关闭（= 装机后的真实布局）下启动 App，只认
 * 「App 自己有没有在走 routine_tick」：
 *   S-01 启动后 last-tick.json 出现，且时间在本次启动之后
 *   S-02 tick payload 标了 desktop_sweep:true、daemon:false、long_lived:false
 *   S-03 连续两轮以上（不是启动时打一枪就停）
 *   S-04 desktop-sweep.jsonl 每行都带 handoff_retry（转交挂账搭同一班车）
 *   S-05 sweep 自身有开始/结束时间且不嵌套（single-flight）
 *   S-06 退出之后不再产生新的 tick（定时器真的停了）
 *
 * 时间尺度：BITBOT_DESKTOP_SWEEP_MS=250，产品默认 60000。
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import {
  electronLaunchEnv,
  electronUserDataDir,
  isolatedRepoRoot,
  gateAppEnv,
  hasDisplay,
} from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);

let PASS = 0,
  FAIL = 0,
  SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : ""));
};
const skip = (m, why) => {
  SKIP++;
  console.log("  - " + m + " (SKIP: " + why + ")");
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_sweep_timer: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_sweep_timer: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_sweep_timer: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_sweep_timer: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "sweep", {
  "bots.json": {
    bots: [
      {
        id: "b1",
        name: "发文助手",
        job: "定时发文",
        description: "",
        group: "",
        pinned: false,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    primary: "b1",
  },
  "settings.json": { notify: {} },
  "sessions.json": { sessions: [] },
});
const UD = electronUserDataDir("sweep");
const ROUTINES = path.join(root, "data", "routines");
const TICK = path.join(ROUTINES, "last-tick.json");
const SWEEP_LOG = path.join(ROUTINES, "desktop-sweep.jsonl");
const SWEEP_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return null;
  }
}
function readLines(p) {
  try {
    return fs
      .readFileSync(p, "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(100);
  }
  return null;
}

let app = null;

(async () => {
  try {
    const startedAt = Date.now();
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [
        path.join(DESKTOP, "main.js"),
        "--no-sandbox",
        "--disable-gpu",
        "--user-data-dir=" + UD,
      ],
      cwd: REPO,
      env: electronLaunchEnv(
        gateAppEnv(root, {
          /* 装机后的真实布局：没有 scripts/host_routine_daemon.sh 可拉。
             本门禁就是要在「daemon 关掉」的前提下证明 App 自己会醒。 */
          BITBOT_ROUTINE_DAEMON_AUTOSTART: "0",
          BITBOT_DESKTOP_SWEEP_MS: String(SWEEP_MS),
          BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
          BITBOT_LLM_API_KEY: "gate-no-call",
          BITBOT_LLM_MODEL: "gate-no-call",
          BITBOT_LLM_STREAM: "0",
        }),
      ),
    });
    const win = await app.firstWindow();
    if (process.env.BITBOT_GATE_DEBUG === "1") {
      app.process().stdout.on("data", (d) => process.stdout.write("[app] " + d));
      app.process().stderr.on("data", (d) => process.stderr.write("[app!] " + d));
    }
    await win.waitForSelector("#composer #text", { timeout: 30000 });

    /* ---------- S-01 启动后自己走 tick ---------- */
    const t1 = await waitFor(() => {
      const j = readJson(TICK);
      return j && j.at ? j : null;
    }, 8000);
    if (!t1) {
      bad("S-01 daemon 关闭时，App 自己也会跑 routine_tick（last-tick.json 出现）", "8s 内没有 " + TICK);
    } else if (Date.parse(t1.at) < startedAt - 2000) {
      bad("S-01 tick 时间在本次启动之后", "at=" + t1.at);
    } else {
      ok("S-01 daemon 关闭时，App 自己会跑 routine_tick（at=" + t1.at + "）");
    }

    /* ---------- S-02 payload 要说清是谁在扫 ---------- */
    if (!t1) {
      bad("S-02 tick payload 标 desktop_sweep:true / daemon:false", "没有 tick");
    } else if (t1.desktop_sweep !== true) {
      bad("S-02 tick payload 标 desktop_sweep:true", JSON.stringify(t1).slice(0, 260));
    } else if (t1.daemon !== false || t1.long_lived !== false) {
      bad("S-02 desktop sweep 不冒充 daemon（daemon=false long_lived=false）", JSON.stringify(t1).slice(0, 260));
    } else if (!/desktop/i.test(String(t1.note || ""))) {
      bad("S-02 note 是人话且点明 desktop", String(t1.note || "(empty)"));
    } else {
      ok("S-02 payload: desktop_sweep=true daemon=false long_lived=false note=" + JSON.stringify(t1.note));
    }

    /* ---------- S-03 是周期，不是启动时打一枪 ---------- */
    await sleep(SWEEP_MS * 5);
    const t2 = readJson(TICK);
    if (!t1 || !t2 || !t2.at) {
      bad("S-03 连续两轮 tick", "t2=" + JSON.stringify(t2 || null));
    } else if (Date.parse(t2.at) <= Date.parse(t1.at)) {
      bad("S-03 连续两轮 tick（时间前进）", "t1=" + t1.at + " t2=" + t2.at);
    } else {
      ok("S-03 连续两轮 tick（" + t1.at + " → " + t2.at + "）");
    }

    /* ---------- S-04 挂账转交搭同一班车 ---------- */
    const rows = await waitFor(() => {
      const r = readLines(SWEEP_LOG);
      return r.length >= 2 ? r : null;
    }, 8000);
    if (!rows || rows.length < 2) {
      bad("S-04 desktop-sweep.jsonl 至少两行", "rows=" + (rows ? rows.length : 0));
    } else {
      const missing = rows.filter((r) => !r.handoff_retry || r.handoff_retry.ok !== true);
      if (missing.length) {
        bad(
          "S-04 每轮都带 handoff_retry 且 ok:true",
          "缺/失败 " + missing.length + "/" + rows.length + " 行：" + JSON.stringify(missing[0]).slice(0, 220),
        );
      } else {
        ok("S-04 每轮都带 handoff_retry（" + rows.length + " 行，scope=" + (rows[rows.length - 1].handoff_retry.scope || "-") + "）");
      }
    }

    /* ---------- S-05 single-flight：不嵌套 ---------- */
    if (!rows || rows.length < 2) {
      bad("S-05 sweep 行有起止时间且不嵌套", "行数不足");
    } else {
      const badRow = rows.find(
        (r) =>
          !r.started_at ||
          !r.ended_at ||
          Date.parse(r.ended_at) < Date.parse(r.started_at) ||
          r.in_flight === true ||
          r.skipped_in_flight === true,
      );
      /* 允许「上一轮没跑完就跳过」的诚实记录，但不能出现并发的两个 started。 */
      const overlapping = rows.some((r, i) => {
        if (i === 0) return false;
        const prev = rows[i - 1];
        return prev.ended_at && r.started_at && Date.parse(r.started_at) < Date.parse(prev.ended_at);
      });
      if (badRow) {
        bad("S-05 sweep 行有起止时间", JSON.stringify(badRow).slice(0, 260));
      } else if (overlapping) {
        bad("S-05 sweep 不并发（后一轮在前一轮结束之后）", "发现重叠");
      } else {
        ok("S-05 single-flight：每轮 started_at/ended_at 成对且不重叠");
      }
    }

    /* ---------- S-06 退出后定时器真的停了 ---------- */
    const beforeQuit = readJson(TICK);
    const beforeRows = readLines(SWEEP_LOG).length;
    const proc = app.process();
    /* 与 e2e_desktop_quit 同一条路径：app.quit() 会 emit before-quit。
       evaluate 的 Promise 在进程断开时必然 reject，不能 await（会把门禁打断），
       真正的判据是后面轮询主进程是否真的消失。 */
    void app.evaluate(({ app: e }) => e.quit()).catch(() => {});
    /* 轮询要拿一开始就抓到的 child process，而不是每次 app.process()：
       app 退出后 playwright 会 dispose 连接，再调 app.process() 会抛
       toImpl 的 TypeError —— 那是门禁自己的 bug，不是产品现象。 */
    const exit = await waitForAppExit(proc, 15000);
    if (exit) app = null; // 已退出，finally 不要再碰它
    if (!exit) {
      bad("S-06 退出应用", "15s 内没退出");
    } else {
      await sleep(SWEEP_MS * 6);
      const after = readJson(TICK);
      const afterRows = readLines(SWEEP_LOG).length;
      const moved =
        (beforeQuit && after && beforeQuit.at && after.at && after.at !== beforeQuit.at) ||
        afterRows !== beforeRows;
      if (moved) {
        bad(
          "S-06 退出后不再产生新 tick",
          "before=" + (beforeQuit && beforeQuit.at) + " after=" + (after && after.at) + " rows " + beforeRows + "→" + afterRows,
        );
      } else {
        ok("S-06 退出后不再产生新 tick（rows=" + afterRows + "）");
      }
    }
  } catch (err) {
    bad("门禁执行异常", err && err.stack ? err.stack : String(err));
  } finally {
    try {
      if (app) await app.close();
    } catch (_) {
      /* already gone */
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(UD, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
    done("e2e_desktop_sweep_timer");
  }
})();

async function waitForAppExit(proc, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return true;
    await sleep(150);
  }
  return false;
}
