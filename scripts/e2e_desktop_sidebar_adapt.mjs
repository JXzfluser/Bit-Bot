/* e2e_desktop_sidebar_adapt.mjs — 窄窗口下「主列还剩多少」的回归门禁
 *
 * 用户报的原现象：把窗口拖窄，左侧栏（280px 固定）不收起，聊天区被挤得几乎没有。
 *
 * 口径变更（本轮实测确认，不是门禁想当然）：
 *   上游 9d89d17 把「按窗口宽度自动收起侧栏」整条**移除**了，代码里写得很明白
 *   （hosts/desktop/index.html:18788-18791）：
 *     「侧栏收起改为「手动控制」：展开 ⇄ 完全隐藏。不再按窗口宽度强制收起
 *       （原 ≤768 自适应会与用户手动作反复对拉，已移除）。」
 *   同时窄窗的侧栏从 280px 收到 200px（`@media (max-width: 900px)` 在 index.html:2025，
 *   里面 `--sidebar-w: 200px` 在 :2040），抽屉仍是覆盖层。
 *   被删掉的 `applySidebarCollapse` 现在叫 `setSidebarHidden`，并且只剩手动入口。
 *
 * 所以原来那套「窄→自动收起、宽→自动展开」的断言（R-02/R-03）测的是**已经不存在的设计**，
 * 继续留着只会红得没有意义。但用户最初抱怨的本质没变，也不因为换了实现就不用验：
 *   ① 窄窗口下主列必须仍然够用，侧栏不许把它挤没；
 *   ② 改成纯手动以后，「收起态怎么再展开」必须有看得见的入口 —— 以前自动收起会自动展开，
 *      现在如果收起态只有一个 200px 侧栏里的按钮，收起后按钮自己也消失了，用户就回不来。
 * 这两条是本门现在断的东西。断言全部走**真实用户动作**（拖宽窗口、点收起按钮、点重开条），
 * 不去调用内部函数：尺子不该比产品更清楚实现里叫什么名字。
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

/* 批次 14 域导航栏（#app-rail）是**布局的最左一列**（不是浮层）：
   宽屏 52px（--appbar-w），窄屏 ≤900 时 44px。
   ⇒ 「主列还剩多少」的账必须把它算进去，否则尺子会误判成「主列被挤了」。
   同时它是四个域的入口 ⇒ 宽度与左缘位置也钉住：它不许为了给主列让路而消失/漂走。 */
const APP_RAIL_W_WIDE = 52;
const APP_RAIL_W_NARROW = 44;
/* 布局 v15 起，网格是五列：域导航栏 | 侧栏 | 主列 | 右栏 | 右侧功能栏。
   导航栏（#app-rail，并栏后右侧已无图标列）是**列**，不是浮层 ⇒ 主列的宽度账必须把它算进去，
   否则"main + agents + apprail = 视口"永远差一栏。 */

/* 一次量齐：视口、侧栏是否隐藏、各区域矩形、有没有横向滚动。
   全部用 getBoundingClientRect / computed display —— 用户看到的宽度就是这个数。 */
const PROBE = () => {
  const rect = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.x * 100) / 100,
      y: Math.round(r.y * 100) / 100,
      w: Math.round(r.width * 100) / 100,
      h: Math.round(r.height * 100) / 100,
      right: Math.round(r.right * 100) / 100,
      bottom: Math.round(r.bottom * 100) / 100,
      display: cs.display,
      visibility: cs.visibility,
    };
  };
  const de = document.documentElement;
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    sidebar: document.body.dataset.sidebar || "expanded",
    apprail: rect("app-rail"),
    agents: rect("agents"),
    main: rect("main"),
    header: rect("header"),
    composer: rect("composer"),
    reopen: rect("sidebar-reopen-tab"),
    toggle: rect("sidebar-toggle-btn"),
    hscroll: Math.max(0, de.scrollWidth - de.clientWidth),
    // 收起态下重开条到底点不点得到：矩形在视口内也可能被更高 z 的兄弟压住
    reopenHit: (() => {
      const el = document.getElementById("sidebar-reopen-tab");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (getComputedStyle(el).display === "none" || r.width <= 0 || r.height <= 0) return null;
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      return { cx, cy, id: top ? top.id : "", inSelf: Boolean(top && (top === el || el.contains(top) || (top.closest && top.closest("#sidebar-reopen-tab")))) };
    })(),
  };
};

const measure = (win) => win.evaluate(PROBE);

/* 改视口尺寸：触发真实 resize 事件并刷新 innerWidth，和手拖同一条路径。 */
async function setWidth(win, w, h) {
  await win.setViewportSize({ width: w, height: h });
  await sleep(500);
}

let app = null;

(async () => {
  try {
    app = await launch();
    const win = await app.firstWindow();
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.waitForTimeout(600);

    /* ---------- R-01 默认宽窗（1100）→ 左侧展开 ---------- */
    {
      const g = await measure(win);
      g.sidebar === "expanded" && g.agents && g.agents.display !== "none"
        ? ok("R-01 宽窗（1100）下左侧栏展开（#agents 可见）")
        : bad("R-01 宽窗下左侧栏不该隐藏", JSON.stringify({ sidebar: g.sidebar, agents: g.agents && g.agents.display }));
    }

    /* ---------- R-02 窄窗 700：不再强制收起（设计已改手动），但主列必须还够用 ----------
       合同（layout-contract.md §3.1 更正后 + 批次 14 域导航栏）：≤900 侧栏收成 200px
       紧凑文字侧栏；**域导航栏（#app-rail）是布局的最左一列**，宽 48px；
       主列拿剩下的全部宽度；抽屉是覆盖层不占列。 */
    {
      await setWidth(win, 700, 700);
      const g = await measure(win);
      const agentsW = g.agents && g.agents.display !== "none" ? g.agents.w : 0;
      const railW = g.apprail ? g.apprail.w : 0;
      /* 并栏后只有一条导航栏（#app-rail）是**列**，右栏已并入它 ⇒
         主列的账只算 apprail + agents。 */
      const okSum = Math.abs(g.main.w + agentsW + railW - g.vw) <= 2;
      const okAgents = agentsW <= 200.5;
      const usable = g.main.w >= g.vw - railW - 200.5;
      /* 新钉：窄屏导航栏必须是 44px 且贴住左边缘 ——
         它不许为了给主列让路而消失或漂走（那等于把整条导航藏起来）。 */
      const okRail = Math.abs(railW - APP_RAIL_W_NARROW) <= 2 && (!g.apprail || g.apprail.x <= 0.5);
      /* 并栏的实证：右侧不再有恒在的图标列，主列右侧必须直抵视口右缘。 */
      const okNoRightRail = Math.abs(g.main.x + g.main.w - g.vw) <= 2;
      if (okSum && okAgents && usable && okRail && okNoRightRail && g.hscroll === 0) {
        ok(`R-02 窄窗（${g.vw}）主列不被挤没：apprail=${railW}px + agents=${agentsW}px + main=${g.main.w}px = 视口宽（右侧无图标列），无横向滚动（侧栏按设计保持手动态=${g.sidebar}）`);
      } else {
        bad("R-02 窄窗下主列被挤了", JSON.stringify({ vw: g.vw, apprail: railW, agents: agentsW, main: g.main.w, sum: g.main.w + agentsW + railW, okSum, okRail, okNoRightRail, hscroll: g.hscroll }));
      }
    }

    /* ---------- R-03 产品下界 480（main.js minWidth）：同样不许挤没、不许越界 ---------- */
    {
      await setWidth(win, 480, 720);
      const g = await measure(win);
      const agentsW = g.agents && g.agents.display !== "none" ? g.agents.w : 0;
      const railW = g.apprail ? g.apprail.w : 0;
      const sum = g.main.w + agentsW + railW;
      const problems = [];
      if (Math.abs(sum - g.vw) > 2) problems.push(`main ${g.main.w} + agents ${agentsW} + apprail ${railW} ≠ 视口 ${g.vw}`);
      if (Math.abs(railW - APP_RAIL_W_NARROW) > 2) problems.push(`导航栏宽 ${railW} ≠ ${APP_RAIL_W_NARROW}`);
      if (Math.abs(g.main.x + g.main.w - g.vw) > 2) problems.push(`主列右缘 ${g.main.x + g.main.w} ≠ 视口 ${g.vw}（右侧不该再有图标列）`);
      if (g.hscroll > 0) problems.push(`横向滚动 ${g.hscroll}px`);
      if (!g.composer || g.composer.bottom > g.vh + 0.5) problems.push(`composer 底 ${g.composer && g.composer.bottom} 越出视口 ${g.vh}`);
      if (g.composer && g.composer.right > g.vw + 0.5) problems.push(`composer 右 ${g.composer.right} 越出视口`);
      if (problems.length) bad(`R-03 480（产品最小宽）不可用`, JSON.stringify({ vw: g.vw, main: g.main.w, agents: agentsW, apprail: railW, problems }));
      else ok(`R-03 480 档仍然走通：apprail=${railW}px、agents=${agentsW}px、main=${g.main.w}px、composer 完整在视口内、无横向滚动`);
    }

    /* ---------- R-04 手动收起：用真实按钮，不用内部函数 ---------- */
    await setWidth(win, 1100, 760);
    {
      const before = await measure(win);
      if (before.sidebar !== "expanded") bad("R-04 前置：宽窗下应先处于展开态", before.sidebar);
      await win.click("#sidebar-toggle-btn", { timeout: 8000 });
      await sleep(400);
      const g = await measure(win);
      const hidden = g.agents && g.agents.display === "none";
      const railW = g.apprail ? g.apprail.w : 0;
      /* 收起侧栏 ⇒ 主列拿满**除那条导航栏以外**的全部宽度（右侧已无图标列）。 */
      hidden && g.sidebar === "collapsed" && Math.abs(g.main.w - (g.vw - railW)) <= 2 &&
        Math.abs(railW - APP_RAIL_W_WIDE) <= 2
        ? ok(`R-04 手动收起后（点 #sidebar-toggle-btn）#agents 真的没了，主列拿满 ${g.main.w}px（视口 ${g.vw} − 导航栏 ${railW}）`)
        : bad("R-04 手动收起后主列没拿满视口", JSON.stringify({ sidebar: g.sidebar, agents: g.agents && g.agents.display, main: g.main.w, vw: g.vw, apprail: railW }));
    }

    /* ---------- R-05 收起态必须有看得见、点得到的重开入口 ----------
       自动收起被移除后，这是唯一把侧栏找回来的路；点不到就是死路。 */
    {
      const g = await measure(win);
      if (!g.reopen || g.reopen.display === "none" || g.reopen.w <= 0) {
        bad("R-05 收起态下没有可见的重开条（#sidebar-reopen-tab）——侧栏收得回来吗", JSON.stringify(g.reopen));
      } else if (!g.reopenHit || !g.reopenHit.inSelf) {
        bad("R-05 重开条看不见/点不到（被别的元素压住）", JSON.stringify(g.reopenHit));
      } else {
        await win.click("#sidebar-reopen-tab", { timeout: 8000 });
        await sleep(400);
        const back = await measure(win);
        back.sidebar === "expanded" && back.agents && back.agents.display !== "none"
          ? ok(`R-05 收起态的重开条可见可点（${g.reopen.w}×${g.reopen.h} @(${g.reopenHit.cx},${g.reopenHit.cy}) 命中自己），点一下侧栏回来了`)
          : bad("R-05 点了重开条但侧栏没回来", JSON.stringify({ sidebar: back.sidebar, agents: back.agents && back.agents.display }));
      }
    }

    /* ---------- R-06 手动收起是「用户意图」：放宽窗口不许把它自动展开 ---------- */
    {
      await win.click("#sidebar-toggle-btn", { timeout: 8000 });
      await sleep(300);
      const c1 = await measure(win);
      if (c1.sidebar !== "collapsed") {
        bad("R-06 前置：手动收起没生效", c1.sidebar);
      } else {
        await setWidth(win, 1440, 820);
        const g = await measure(win);
        g.sidebar === "collapsed"
          ? ok("R-06 手动收起后放宽窗口不会被自动展开（尊重用户意图）")
          : bad("R-06 手动收起后被自动展开覆盖了", g.sidebar);
        // 收尾：恢复展开，避免遗留折叠态（本门跑在隔离根目录，不碰用户 settings）
        await win.click("#sidebar-reopen-tab", { timeout: 8000 }).catch(() => {});
        await sleep(300);
      }
    }

    /* ---------- R-07 交通灯安全带：红/黄/绿不许压在导航栏的图标上 ----------
       用户报的原现象：「顶部的关闭窗口按钮和图标有重叠」。
       成因不是猜的：titleBarStyle:"hiddenInset" 让交通灯浮在内容上方，
       而并栏后左上角第一格就是品牌块 —— 系统默认 inset 正好穿过它
       （实测品牌 [8,8,36,36]，灯组落在 y≈14..26 / x≈20..72）。
       修法是两处配一对：main.js 的 trafficLightPosition 定死灯组位置，
       ui_chrome 的 #app-rail 顶部留出安全带。
       这里同时量两边 —— 只量 CSS 的话，把 main.js 那段删掉这条会照绿。 */
    {
      const btn = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        return typeof w.getWindowButtonPosition === "function" ? w.getWindowButtonPosition() : null;
      });
      if (process.platform !== "darwin") {
        skip("R-07 交通灯安全带", "非 macOS，没有交通灯");
      } else if (!btn) {
        /* 没显式设 trafficLightPosition 时 Electron 返回 null，灯组位置就是系统默认值，
           无从测量 ⇒ 这条必须红：说明 main.js 里的钉子被删了。 */
        bad("R-07 交通灯安全带", "getWindowButtonPosition() 为 null —— main.js 的 trafficLightPosition 不见了，灯组位置又变回系统默认（会压住品牌块）");
      } else {
        const g = await win.evaluate(() => {
          const r = (s) => {
            const e = document.querySelector(s);
            if (!e) return null;
            const b = e.getBoundingClientRect();
            return { top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) };
          };
          return { mark: r(".app-rail-mark"), chat: r('#app-rail .app-rail-item[data-app-domain="chat"]') };
        });
        /* 灯组高度按 14（macOS 圆钮实际直径，screencapture 抓真窗口量的），
           且**必须再留 8px 空气**：第一版只留 4px（品牌顶 36 / 灯底 34），
           用户看到的仍然是"贴在一起"。零重叠不等于看得过去。 */
        const lightBottom = btn.y + 14;
        const GAP = 8;
        g.mark && g.mark.top >= lightBottom + GAP
          ? ok(`R-07 交通灯安全带：灯组 y=${btn.y}..${lightBottom}，品牌块顶 ${g.mark.top}（间距 ${g.mark.top - lightBottom}px）`)
          : bad("R-07 交通灯挤压导航栏图标", JSON.stringify({ btn, lightBottom, need: lightBottom + GAP, mark: g.mark }));
      }
    }

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
