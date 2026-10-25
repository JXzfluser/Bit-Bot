/* e2e_desktop_sidebar_adapt.mjs — 「左侧不自适应」的回归门禁
 *
 * 用户报的现象：把窗口拖窄，左侧栏（280px 固定）不收起，聊天区被挤得几乎没有。
 *
 * 根因：折叠态基础设施齐全（data-sidebar=expanded|collapsed、setSidebarCollapsed、
 * applySidebarCollapse 会落盘），但 main.js 的 BrowserWindow 没有 minWidth，且
 * 全文件没有任何 resize 监听去自动切换 data-sidebar —— 折叠只靠手动 Cmd+B / 菜单。
 *
 * 本门禁断的是「窗口宽度真的驱动左侧栏」：
 *   R-01 默认宽窗（1100）→ 左侧展开（#agents 可见）
 *   R-02 拖窄到 700（≤ 断点 768）→ 自动收起（#agents 隐藏）
 *   R-03 再放宽到 1100 → 自动展开
 *   R-04 手动 Cmd/Ctrl+B 收起后（= 用户显式意图）→ 再放宽也不会被自动展开（尊重手动）
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, isolatedRepoRoot, gateAppEnv, hasDisplay } from "./electron_env.mjs";

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
  console.log("e2e_desktop_sidebar_adapt: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_sidebar_adapt: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_sidebar_adapt: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_sidebar_adapt: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "adapt", {
  "bots.json": { bots: [{ id: "b1", name: "派单助手", job: "派单调度", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }], primary: "b1" },
  "settings.json": { notify: {} },
  "sessions.json": { sessions: [] },
});
const UD = electronUserDataDir("adapt");

function launch() {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
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

/* #agents 是左侧栏容器；collapsed 状态把它 display:none。用可见性判定，不依赖属性字符串。 */
const agentsHidden = (win) =>
  win.evaluate(() => {
    const el = document.getElementById("agents");
    if (!el) return null;
    return getComputedStyle(el).display === "none";
  });

/* 改视口尺寸：触发真实 resize 事件并刷新 innerWidth，和手拖同一条路径。
 * 自适应逻辑读的是 window.innerWidth，setViewportSize 正好驱动它。 */
async function setWidth(win, w, h) {
  await win.setViewportSize({ width: w, height: h });
  await sleep(450);
}

let app = null;

(async () => {
  try {
    app = await launch();
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(600);

    /* ---------- R-01 默认宽窗 → 左侧展开 ---------- */
    const hidden1 = await agentsHidden(win);
    hidden1 === false ? ok("R-01 宽窗（1100）下左侧栏展开（#agents 可见）") : bad("R-01 宽窗下左侧栏不该隐藏", hidden1);

    /* ---------- R-02 拖窄到 700（≤ 断点 768）→ 自动收起 ---------- */
    await setWidth(win, 700, 700);
    const hidden2 = await agentsHidden(win);
    hidden2 === true ? ok("R-02 窄窗（700 ≤ 768 断点）自动收起左侧栏（#agents 隐藏）") : bad("R-02 窄窗下左侧栏未自动收起", hidden2);

    /* ---------- R-03 再放宽到 1100 → 自动展开 ---------- */
    await setWidth(win, 1100, 760);
    const hidden3 = await agentsHidden(win);
    hidden3 === false ? ok("R-03 放宽到 1100 后自动展开左侧栏") : bad("R-03 放宽后左侧栏未自动展开", hidden3);

    /* ---------- R-04 手动收起后，自动适配要让位给用户 ---------- */
    // 模拟用户按 Cmd/Ctrl+B（直接派发 keydown，不依赖窗口焦点）
    await win.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, metaKey: true, bubbles: true }));
    });
    await sleep(300);
    const hidden4a = await agentsHidden(win);
    hidden4a === true ? ok("R-04 手动 Cmd/Ctrl+B 收起左侧栏") : bad("R-04 手动收起未生效", hidden4a);

    // 此时再放宽窗口：因为用户已显式操作，自动适配不应把它重新展开
    await setWidth(win, 1100, 760);
    const hidden4b = await agentsHidden(win);
    hidden4b === true
      ? ok("R-04 手动收起后，放宽窗口不再自动展开（尊重用户意图）")
      : bad("R-04 手动收起后被自动展开覆盖了", hidden4b);

    // 收尾：手动再展开，避免遗留折叠态
    await win.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, metaKey: true, bubbles: true }));
    });
    await sleep(300);

    done("e2e_desktop_sidebar_adapt");
  } catch (err) {
    bad("unexpected error", err && err.message);
    done("e2e_desktop_sidebar_adapt");
  } finally {
    if (app) await app.close().catch(() => {});
    try {
      execSync("pkill -9 -f " + JSON.stringify(UD), { stdio: "ignore" });
    } catch {
      /* ignore */
    }
  }
})();
