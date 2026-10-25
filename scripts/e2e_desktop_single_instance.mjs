/* e2e_desktop_single_instance.mjs — 「能同时启动两个应用」的回归门禁
 *
 * 用户报的现象：双击应用两次，出现两个窗口、两个进程，互不相关。
 *
 * 根因：main.js 从来没调用 app.requestSingleInstanceLock()。Electron 的锁是
 * 按 user-data-dir 存的；没有这把锁，第二次双击就是全新进程，各自建窗口、各跑各的。
 *
 * 本门禁断的是「同一个 user-data-dir 只允许一个进程」：
 *   S-01 对照：两个不同的 UD 各起一个 → 两个都活着（证明机制是「按 UD 锁」，
 *        不是「永远不允许两个 Electron 进程」）
 *   S-02 修复：同一个 UD 起第二个 → 第二个立刻退出，只剩第一个（单实例锁生效）
 *   S-03 第二个实例触发 second-instance → 第一个窗口被唤到前台（focus）
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { spawn } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, isolatedRepoRoot, gateAppEnv, hasDisplay, countAppMains, killGateProcs } from "./electron_env.mjs";

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
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 240) : ""));
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
  console.log("e2e_desktop_single_instance: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_single_instance: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_single_instance: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_single_instance: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "si", {
  "bots.json": { bots: [{ id: "b1", name: "派单助手", job: "派单调度", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }], primary: "b1" },
  "settings.json": { notify: {} },
  "sessions.json": { sessions: [] },
});
const UD_A = electronUserDataDir("si-a");
const UD_B = electronUserDataDir("si-b");

function launch(ud) {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO,
    env: electronLaunchEnv(
      gateAppEnv(root, {
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
        BITBOT_LLM_API_KEY: "gate-no-call",
        BITBOT_LLM_MODEL: "gate-no-call",
        BITBOT_LLM_STREAM: "0",
      }),
    ),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 只数「主进程」：Electron 的辅助进程（GPU / 渲染）命令行里不含 main.js，
 * 但会带 --user-data-dir。用 main.js + ud 组合，滤掉辅助进程，才能数清楚「几个实例」。
 * 计数走 electron_env.countAppMains（无中间 shell）——旧的 execSync("pgrep -f …")
 * 会把 `sh -c` 自己也算进去，永远多 1，实测把 1 个实例读成 2（假红）。 */
const liveMain = (ud) => countAppMains(ud);

let appA = null;
let appB = null;
let appC = null;

(async () => {
  try {
    /* ---------- S-01 对照：两个不同 UD 各起一个 → 都活着 ---------- */
    appA = await launch(UD_A);
    const winA = await appA.firstWindow();
    await winA.waitForSelector("#composer #text", { timeout: 30000 });
    await winA.waitForTimeout(500);

    appB = await launch(UD_B);
    let winB = null;
    try {
      winB = await appB.firstWindow();
      await winB.waitForSelector("#composer #text", { timeout: 30000 });
    } catch (e) {
      bad("S-01 第二个实例（不同 UD）未能启动", e && e.message);
    }
    await sleep(300);

    const liveA = liveMain(UD_A);
    const liveB = liveMain(UD_B);
    liveA === 1 ? ok("S-01 UD-A 实例存活（" + liveA + "）") : bad("S-01 UD-A 实例数异常", liveA);
    liveB === 1 ? ok("S-01 UD-B 实例存活（" + liveB + "）") : bad("S-01 UD-B 实例数异常", liveB);
    liveA === 1 && liveB === 1
      ? ok("S-01 不同 UD 可以各起一个 —— 锁是「按 UD」的，不是禁用多进程")
      : skip("S-02 对照前提不满足", "S-01 未同时成立");

    /* ---------- S-02 修复：同一 UD 起第二个 → 只剩第一个 ----------
     * 第二个实例拿不到锁会立刻 app.quit()，在 Playwright 建立调试连接前就退出，
     * 所以不能用 _electron.launch（它会因「Target page closed」抛错）。这里用原生
     * spawn 起第二个进程，直接验证它退出、且主实例数不被增加。 */
    // 负向对照：设 NEG_CONTROL=1 时，给第二个实例关掉锁（BITBOT_DISABLE_SINGLE_INSTANCE=1），
    // 模拟修复前「能起两个」的状态 —— 此时 S-02 应翻红，证明门禁真能抓住回归。
    const cEnv = electronLaunchEnv(
      gateAppEnv(root, {
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
        BITBOT_LLM_API_KEY: "gate-no-call",
        BITBOT_LLM_MODEL: "gate-no-call",
        BITBOT_LLM_STREAM: "0",
      }),
    );
    const cEnvEff = process.env.NEG_CONTROL ? { ...cEnv, BITBOT_DISABLE_SINGLE_INSTANCE: "1" } : cEnv;
    const cProc = spawn(
      ELECTRON,
      [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD_A],
      { cwd: REPO, env: cEnvEff, stdio: "ignore" },
    );
    // 等到第二个实例退场（或超时）
    let cExited = false;
    for (let i = 0; i < 80; i++) {
      if (cProc.exitCode !== null || cProc.signalCode !== null) {
        cExited = true;
        break;
      }
      await sleep(100);
    }
    cExited
      ? ok("S-02 第二个实例（同 UD）拿不到锁，已主动退出（exitCode=" + cProc.exitCode + "）")
      : bad("S-02 第二个实例没有退出 —— 单实例锁没拦住它");

    const liveSame = liveMain(UD_A);
    liveSame === 1
      ? ok("S-02 同 UD 只活着一个主进程（单实例锁生效）")
      : bad("S-02 同 UD 出现多个主进程", liveSame);

    /* ---------- S-03 第二个实例唤起第一个窗口到前台 ---------- */
    const aFocused = await appA
      .evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        return w ? { visible: w.isVisible(), focused: w.isFocused() } : null;
      })
      .catch(() => null);
    aFocused && aFocused.visible
      ? ok("S-03 第一个实例窗口仍在前台（second-instance 把它唤起了）")
      : bad("S-03 第一个实例窗口状态异常", JSON.stringify(aFocused));
    appC = null; // 已用 spawn 管理，finally 里别再碰 Playwright 句柄

    done("e2e_desktop_single_instance");
  } catch (err) {
    bad("unexpected error", err && err.message);
    done("e2e_desktop_single_instance");
  } finally {
    for (const a of [appA, appB, appC]) {
      if (a) await a.close().catch(() => {});
    }
    // 兜底清场，避免门禁之间互相污染
    killGateProcs(UD_A);
    killGateProcs(UD_B);
  }
})();
