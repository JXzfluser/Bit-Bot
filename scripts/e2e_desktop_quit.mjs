/* e2e_desktop_quit.mjs — 「应用退不掉」的回归门禁
 *
 * 用户报的现象：按 Cmd+Q / 菜单「退出」，窗口消失了，但应用还在（Dock 里还有
 * 指示灯，活动监视器里主进程还活着），再点图标窗口又回来了。看起来像退不掉。
 *
 * 根因是三行代码的组合：
 *   1. win.on("close") 里 `if (app.isQuiting) return; e.preventDefault(); win.hide();`
 *      —— 点红叉只收进托盘，这是产品意图（Grok-style 常驻）；
 *   2. 但 `app.isQuiting` 只在托盘菜单的「退出」里被设过，**quit 流程本身从没设**；
 *   3. 而且 main.js 没有注册 `before-quit`。
 * 于是 Cmd+Q → Electron 关窗 → close 里 preventDefault → quit 被取消 → 窗口 hide()。
 * 唯一的退出路径是托盘菜单（16px 绿方块，用户根本不知道它存在）。
 *
 * 本门禁断的是「退出真的退出」，而不是「窗口消失」：
 *   Q-01 点红叉：窗口隐藏、进程仍在 —— 常驻托盘是产品意图，必须保持不变
 *   Q-02 隐藏之后再 quit（= 用户真实动作序列）：进程真的退出，退出码 0
 *   Q-03 退出后没有残留进程 —— will-quit 的清理真的跑了
 *   Q-04 同一个 user-data-dir 能再启动一次 —— 退出是干净的，没留单例锁
 *
 * Q-02 走的是 app.quit()，和菜单里 role:"quit" / Cmd+Q / Dock 退出完全同一条路径。
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, isolatedRepoRoot, gateAppEnv, hasDisplay, countAppMains, countAllGateProcs, killGateProcs } from "./electron_env.mjs";

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
  console.log("e2e_desktop_quit: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_quit: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_quit: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_quit: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "quit", {
  "bots.json": {
    bots: [{ id: "b1", name: "派单助手", job: "派单调度", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }],
    primary: "b1",
  },
  "settings.json": { notify: {} },
  "sessions.json": { sessions: [] },
});

/* 同一个 user-data-dir 用两次：Q-01/Q-02 用一次，Q-04 复用它证明锁已释放。 */
const UD = electronUserDataDir("quit");

function launch() {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
    cwd: REPO,
    env: electronLaunchEnv(
      gateAppEnv(root, {
        /* 退出门禁不该触发任何模型调用。 */
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
        BITBOT_LLM_API_KEY: "gate-no-call",
        BITBOT_LLM_MODEL: "gate-no-call",
        BITBOT_LLM_STREAM: "0",
      }),
    ),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (proc) => !!proc && proc.exitCode === null && proc.signalCode === null;

/** 轮询等到进程真的消失（或超时）。返回 { gone, code, signal }。 */
async function waitExit(proc, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!alive(proc)) return { gone: true, code: proc.exitCode, signal: proc.signalCode };
    await sleep(100);
  }
  return { gone: false, code: proc.exitCode, signal: proc.signalCode };
}

/** 这个 user-data-dir 下还有几个活着的「应用主进程」？（退出后应为 0）
 *  和 single_instance 用同一把尺子：只数带 main.js + UD 的主进程。
 *  Chromium 辅助进程（gpu / renderer / network）命令行里带 UD 但不带 main.js，
 *  主进程退出后它们会自行解体；把它们算成"残留实例"会永远多算，且不是用户
 *  看到的「退不掉」现象。旧的 execSync("pgrep -f UD") 更糟——它把承载 pgrep 的
 *  `sh -c`（命令行同样含 UD）也算进去，实测稳定多 1。 */
function liveInstances() {
  return countAppMains(UD);
}

let app = null;

(async () => {
  try {
    /* ---------- Q-01 点红叉：只收进托盘，进程必须还在 ---------- */
    app = await launch();
    let win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(600);

    const proc = app.process();
    typeof proc === "object" && proc.pid ? ok("Q-01 拿到主进程 pid " + proc.pid) : bad("Q-01 no main process handle");

    // 直接调 BrowserWindow.close()，和用户点红叉是同一条事件路径。
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.close();
    }).catch(() => {});
    await sleep(700);

    const afterClose = await app.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      const w = all[0];
      return {
        count: all.length,
        destroyed: !w || w.isDestroyed(),
        visible: w && !w.isDestroyed() ? w.isVisible() : false,
      };
    }).catch(() => null);

    if (!afterClose) {
      bad("Q-01 cannot read window state after close (process may have died)");
    } else {
      !afterClose.destroyed && afterClose.count === 1
        ? ok("Q-01 点红叉后窗口没有被销毁（收进托盘）")
        : bad("Q-01 window destroyed on red-cross close", JSON.stringify(afterClose));
      afterClose.visible === false
        ? ok("Q-01 窗口已隐藏（isVisible=false）")
        : bad("Q-01 window still visible after close", JSON.stringify(afterClose));
    }
    alive(proc) ? ok("Q-01 进程仍在运行 —— 常驻托盘是产品意图") : bad("Q-01 process died on red-cross close");

    /* ---------- Q-02 隐藏之后再退出：这就是用户的真实动作序列 ---------- */
    /* app.quit() 与菜单 role:"quit" / Cmd+Q / Dock「退出」是同一条路径：
       都会 emit before-quit，再关窗。修复前这里会因为 close 的 preventDefault
       被取消掉，进程永远不退出。 */
    void app.evaluate(({ app: e }) => e.quit()).catch(() => {});
    await sleep(300);
    const r1 = await waitExit(proc, 8000);

    let aborted = false;
    if (!r1.gone) {
      bad("Q-02 process still alive 8s after quit — 退出请求被 close 的 preventDefault 吃掉了");
      /* 进程没退出的时候，Q-03/Q-04 没有意义：残留是必然的，单例锁也必然被占。
         继续往下跑只会把门禁自己拖死（实测：脚本被 SIGKILL，stdout 缓冲一起丢，
         连失败原因都看不到）。这里短路，并强制清场。 */
      skip("Q-03 退出后无残留", "Q-02 已失败：进程没退出，残留是必然结果");
      skip("Q-04 同一 user-data-dir 再启动", "Q-02 已失败：单例锁必然被占用");
      try {
        proc.kill("SIGKILL");
      } catch (_) {
        /* ignore */
      }
      await waitExit(proc, 3000);
      aborted = true;
    } else {
      ok("Q-02 app.quit() 后进程真的退出（code=" + r1.code + " signal=" + r1.signal + "）");
      r1.code === 0
        ? ok("Q-02 退出码为 0（不是崩溃退出）")
        : bad("Q-02 non-zero exit code", JSON.stringify(r1));
    }

    app = null; // 已退出 / 已被强杀，别让 finally 再碰它

    if (!aborted) {
      /* ---------- Q-03 退出后无残留 ---------- */
      await sleep(500);
      const left = liveInstances();
      left === 0
        ? ok("Q-03 退出后没有残留应用主进程（user-data-dir 下 0 个 main.js 实例）")
        : bad("Q-03 leftover instances after quit", left + " process(es) still match " + UD);
      /* 辅助进程单独看一眼：主进程退了但 gpu/renderer/network 还挂着，是真泄漏。
         不当成 Q-03 的红（用户看到的「退不掉」是主进程），但必须如实打印出来。 */
      const helpers = countAllGateProcs(UD) - left;
      if (helpers > 0) {
        console.log("  · RESIDUAL（如实）：退出后仍有 " + helpers + " 个 Chromium 辅助进程匹配该 user-data-dir（主进程已退出，未计入 Q-03）");
      }

      /* ---------- Q-04 同一个 userData 能再启动：说明锁释放干净了 ---------- */
      let app2 = null;
      try {
        app2 = await launch();
        const win2 = await app2.firstWindow();
        await win2.waitForSelector("#composer #text", { timeout: 30000 });
        ok("Q-04 同一 user-data-dir 能再次启动（单例锁已释放）");
      } catch (err) {
        bad("Q-04 cannot relaunch with the same user-data-dir", err && err.message);
      } finally {
        if (app2) await Promise.race([app2.close().catch(() => {}), sleep(8000)]);
      }
    }
  } catch (err) {
    bad("fatal", err && err.stack ? err.stack : String(err));
  } finally {
    // 收尾也要有上界：脚本如果因为「退不掉」卡在这里，门禁会变成僵尸。
    if (app) await Promise.race([app.close().catch(() => {}), sleep(8000)]);
    try {
      fs.rmSync(UD, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  done("e2e_desktop_quit");
})();
