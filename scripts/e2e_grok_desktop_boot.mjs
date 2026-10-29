#!/usr/bin/env node
/**
 * scripts/e2e_grok_desktop_boot.mjs — M15: automated cold start + GP-70
 * nativeTheme PIXEL assertion for the desktop shell.
 *
 * Replaces the manual "launch Electron, click around, eyeball a screenshot"
 * loop with Playwright's Electron driver (_electron.launch): the real main
 * process, the real preload bridge, the real MoonBit-kernel turn path, and the
 * real pixels Chromium composites under Xvfb.
 *
 * Why pixels: docs/grok-desktop-parity/spec.md GP-70 demands
 * "nativeTheme.updated 实测生效（themeSource 改变 + 截图/像素断言）". A CSS
 * variable read would only prove the stylesheet; decoding the screenshot
 * proves the theme change actually reaches the frame buffer, through the
 * REAL user path (settings.set → applyAppearance → broadcast → renderer).
 * Measured here (and asserted at runtime, printed as RESIDUAL if absent):
 * under Xvfb nativeTheme.themeSource does NOT drive the live
 * `prefers-color-scheme` media query, so the dark pixels ride the force-dark
 * token channel while themeSource truth is asserted in the main process.
 *
 * Exit 0 + `e2e_grok_desktop_boot: PASS=N FAIL=0` → smoke G-16 greps that.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { decodePng, avgLuma, pixelAt, encodeRgbPng } from "./lib_png_pixel.mjs";
import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv } from "./electron_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

/* #10: gate-store isolation. Every data path in this gate resolves under
   GATE_ROOT, which main() points at a temp COPY of the real store before any
   test runs. The external watcher that pollutes data/desktop across runs
   therefore can't reach the gate's fixtures — this is the structural root-cause
   fix for the GP-108/117 flaky failures (previously mis-attributed to code
   regressions). BITBOT_REPO_ROOT tells the app the same root, so the gate also
   stops writing back into the user's real data/desktop. */
let GATE_ROOT = REPO;
const dd = (n) => path.join(GATE_ROOT, "data/desktop", n);
const rd = (n) => path.join(GATE_ROOT, "data/routines", n);
const sd = (n) => path.join(GATE_ROOT, "data/secrets", n);

/* 这些路径**必须**是可重定向的 let：dd() 是函数、按调用时的 GATE_ROOT 求值，
   但模块级 const 在 main() 换根之前就已经算成 REPO 了 —— 那样门禁一边说「跑在
   隔离根里」，一边继续读写用户的真实 store（settings/account/sessions/bots
   全中招）。main() 建好临时根后调用 retargetStorePaths() 重新绑定。 */
let SETTINGS_PATH = "";
let ACCOUNT_PATH = "";
let SESSIONS_PATH = "";
let BOTS_PATH = "";
function retargetStorePaths() {
  SETTINGS_PATH = dd("settings.json");
  ACCOUNT_PATH = dd("account-profile.json");
  // GP-14: the reply chain writes message rows + provider artifacts; snapshot the
  // transcript store too so the whole E2E stays double-run idempotent.
  SESSIONS_PATH = dd("sessions.json");
  BOTS_PATH = dd("bots.json");
}
retargetStorePaths();

/** G-28: 会话列表收在账户条 #sessions-popup 里（侧栏主体没有会话区块）。
 *  任何对会话行的右键/点击前都必须先走真实用户路径把弹层打开：点账户条
 *  右侧的会话图标。 */
async function openSessionsPopup(win) {
  await win.evaluate(() => {
    const p = document.getElementById("sessions-popup");
    if (p && p.hidden) {
      const b = document.getElementById("ab-sessions-btn");
      if (b) b.click();
    }
  });
  await win.waitForSelector("#sessions-popup:not([hidden])", { timeout: 5000 });
}

/* 多 Bot 用例（群聊 / 记忆 / 排序 / GP-119）需要「≥2 个可见 Bot，且至少一个未固定」。
   以前它们直接 bad("…need two visible Bots")，于是在单人开发机（store 里只有
   agent-bit）上永远是红的 —— 红在数据前置上，不是红在代码上，反而挡住真回归。
   这里在跑之前补足探针 Bot，进程退出时按快照还原；已经是多 Bot 的环境不动。 */
function ensureProbeBots() {
  let raw;
  try {
    raw = fs.readFileSync(BOTS_PATH, "utf8");
  } catch (_) {
    return () => {};
  }
  const parsed = JSON.parse(raw);
  const bots = Array.isArray(parsed.bots) ? parsed.bots : [];
  const visible = () => bots.filter((b) => b && b.id && !b.hidden);
  const probe = (n) => {
    // 用极早的时间戳：侧栏按 updated_at 排序，探针必须排在真实 Bot 之后，
    // 否则「第一行是哪个 Bot」会变，依赖行序的用例（GP-127 置顶）会换靶子。
    const t = "2000-01-01T00:00:00.000Z";
    return {
      id: "e2e-probe-bot-" + n,
      name: "E2E 探针 " + n,
      job: "e2e fixture",
      description: "temporary fixture created by e2e_grok_desktop_boot (restored on exit)",
      avatar: "",
      hidden: false,
      pinned: false,
      created_at: t,
      updated_at: t,
    };
  };
  let added = 0;
  while (visible().length < 2) bots.push(probe(++added));
  if (!visible().some((b) => !b.pinned)) bots.push(probe(++added));
  if (!added) return () => {};
  parsed.bots = bots;
  fs.writeFileSync(BOTS_PATH, JSON.stringify(parsed, null, 2));
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    try {
      fs.writeFileSync(BOTS_PATH, raw);
    } catch (_) {
      /* ignore */
    }
  };
  process.on("exit", restore);
  console.log("  · 已补 " + added + " 个探针 Bot（退出时还原 bots.json）");
  return restore;
}

let PASS = 0;
let FAIL = 0;
const ok = (name) => {
  PASS++;
  console.log("  ✓ " + name);
};
const bad = (name, detail) => {
  FAIL++;
  console.log("  ✗ " + name + (detail ? " — " + String(detail).slice(0, 200) : ""));
};
/* 前置条件不成立时（例如本环境没有可用 provider，回合停在审批上，根本没走完）
   如实打 SKIP：跳过永远不算 PASS，但也不该把「环境没给机会」记成代码回归。 */
let SKIP = 0;
const skip = (name, why) => {
  SKIP++;
  console.log("  · SKIP " + name + " — " + why);
};

// target-v2: under grok-ui the header 电脑/能力 buttons are intentionally
// hidden (body.grok-ui #gp-panel-btn { display:none }). The Computer rail's
// real user entry is Cmd/Ctrl+F (see the keydown handler) and it closes from
// the rail's own × — drive those instead of the hidden legacy button.
async function openComputerRail(win) {
  await win.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
}
async function closeComputerRail(win) {
  await win.waitForSelector("#computer-rail-close", { state: "visible", timeout: 5000 });
  await win.click("#computer-rail-close");
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Launch the real app; window must be visible before we assert anything.
 * Under Xvfb the Electron main occasionally SIGSEGVs on the GPU channel
 * before first paint (env flake, not an app fault — the same binary boots
 * fine on retry). Bounded retry keeps the assertion honest: we still require
 * a REAL boot on a reachable X display, with a small retry for host flakes.
 * --disable-gpu makes Chromium take the software raster path, which is what
 * the manual CDP smoke used (screenshots stay pixel-faithful), and kills the
 * stderr chatter that raced Playwright's `DevTools listening` readline.
 */
const LAUNCH_RETRIES = Number(process.env.BITBOT_E2E_RETRIES || "3");

/**
 * The sandbox may export DISPLAY=:1 with no X server behind it (the parity
 * Xvfb listens on :99). Electron then aborts in ozone_platform_x11 with a
 * SIGSEGV-shaped exit and Playwright reports "Process failed to launch!" —
 * which would get falsely blamed on the app. Pick the first DISPLAY whose
 * unix socket actually exists, falling back to :99.
 */
function liveDisplay() {
  const cands = [];
  if (process.env.DISPLAY) cands.push(process.env.DISPLAY);
  cands.push(":99", ":0");
  for (const d of cands) {
    const m = /^:([\d]+)/.exec(d);
    if (m && fs.existsSync("/tmp/.X11-unix/X" + m[1])) return d;
  }
  return process.env.DISPLAY || ":99";
}

/* G-28 #2：Bot 区块默认折叠（只留头像条）。凡是要点 Bot 行的地方先调这个，
   等价于用户点一下折叠按钮 —— 幂等，已经展开就什么都不做。 */
async function expandBotList(win) {
  try {
    await win.evaluate(() => {
      const sec = document.getElementById("sb-bots-rooms");
      const btn = document.getElementById("bot-collapse-btn");
      if (sec && sec.classList.contains("collapsed") && btn) btn.click();
    });
    await win.waitForTimeout(120);
  } catch (_) {
    /* 页面还没就绪时下一处断言会如实报错，这里不抢它的结论 */
  }
}

/* GP-14 的 turn 产物有两个合法落点，不是一个：
     · app 驱动的回合 → 主进程按 BITBOT_REPO_ROOT 写隔离根（GATE_ROOT）；
     · node 侧 createTurnRunner 直跑的回合 → 按它自己的根写真实仓库。
   GATE_ROOT/cmd 只是软链，moon 顺着它解析回真实仓库，所以内核那条链路注定落在
   REPO。断言关心的是**产物内容**（reply_to / 引文来源），所以两边取最新的一份，
   而不是赌某一个根 —— 赌错就会读到上一轮的旧产物，把「字段对不对」误报成「没写」。 */
function newestLlmTurnArtifact() {
  const dirs = [path.join(GATE_ROOT, "data/llm/turns"), path.join(REPO, "data/llm/turns")];
  let best = null;
  for (const d of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(d).filter((f) => f.endsWith(".json"));
    } catch (_) {
      continue;
    }
    for (const f of names) {
      const p = path.join(d, f);
      let m = 0;
      try {
        m = fs.statSync(p).mtimeMs;
      } catch (_) {
        continue;
      }
      if (!best || m > best.mtime) best = { path: p, mtime: m };
    }
  }
  if (!best) return {};
  try {
    return JSON.parse(fs.readFileSync(best.path, "utf8"));
  } catch (_) {
    return {};
  }
}

async function launchOnce(extraEnv) {
  const electronBinary = resolveElectronBinary(path.join(REPO, "hosts/desktop"));
  const app = await _electron.launch({
    executablePath: electronBinary,
    args: [
      path.join(REPO, "hosts/desktop/main.js"),
      "--no-sandbox",
      "--disable-gpu",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
    cwd: REPO,
    env: electronLaunchEnv({
      DISPLAY: liveDisplay(),
      BITBOT_ESPEAK_BIN: process.env.BITBOT_ESPEAK_BIN || "/usr/bin/espeak-ng",
      BITBOT_REPO_ROOT: GATE_ROOT,
      BITBOT_ROUTINE_DAEMON_AUTOSTART: "0",
      BITBOT_DESKTOP_AUTOSTART: "0",
      BITBOT_NO_SECRET_SYNC: "1",
      ...(extraEnv || {}),
    }),
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  /* G-28 #2：Bot 区块默认折叠成「头像条」。门禁要操作 Bot 行，就得先走一次真实
     用户路径把它展开（点折叠按钮）—— 否则 #bot-list 里的行是 display:none，
     waitForSelector(visible) 只会一路等到 30s 超时。 */
  await expandBotList(win);
  return { app, win };
}

async function launch(extraEnv) {
  let last;
  for (let i = 1; i <= LAUNCH_RETRIES; i++) {
    try {
      const boot = await launchOnce(extraEnv);
      if (i > 1) console.log("  · boot ok on attempt " + i);
      return boot;
    } catch (e) {
      last = e;
      if (i < LAUNCH_RETRIES) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw last;
}

async function shutdown(app) {
  try {
    // The shell hides to tray on window close; force the real quit path.
    await app.evaluate(({ app: electronApp }) => {
      electronApp.isQuiting = true;
      electronApp.quit();
    });
    await app.close();
  } catch {
    /* already gone */
  }
}

/** Screenshot → PNG decode → luminance of the full viewport. */
async function viewportLuma(win, file) {
  const buf = await win.screenshot({ path: file });
  const png = decodePng(buf);
  // Corners stay background even in the light theme (no white-only fixture).
  return avgLuma(png);
}

/** Read a JSONL file into rows (missing file → []). */
function readRows(p) {
  try {
    return fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Poll a Host-side JSONL until the predicate holds (bounded, no fixed sleep). */
async function pollRows(p, pred, { timeoutMs = 12000 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const rows = readRows(p);
    if (pred(rows)) return rows;
    if (Date.now() > until) return rows;
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function main() {
  // #10: snapshot the real store into an isolated temp root so the external
  // watcher that pollutes data/desktop across runs can't reach the gate's
  // fixtures. The app is pointed at the same root via BITBOT_REPO_ROOT below.
  GATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-e2e-boot-"));
  try { fs.symlinkSync(path.join(REPO, "cmd"), path.join(GATE_ROOT, "cmd"), "dir"); } catch { /* cmd already linked or absent */ }
  // Snapshot the WHOLE data/ tree (desktop + routines + secrets + workspace +
  // llm + memory) so the gate neither reads the watcher's polluted state nor
  // writes anything back into the user's real store.
  const srcData = path.join(REPO, "data");
  const dstData = path.join(GATE_ROOT, "data");
  fs.mkdirSync(dstData, { recursive: true });
  if (fs.existsSync(srcData)) fs.cpSync(srcData, dstData, { recursive: true });
  retargetStorePaths();
  process.on("exit", () => { try { fs.rmSync(GATE_ROOT, { recursive: true, force: true }); } catch { /* ignore */ } });
  ensureProbeBots();
  const outDir = process.env.BITBOT_E2E_OUT || "/tmp/e2e-m15";
  fs.mkdirSync(outDir, { recursive: true });

  /* ---- self-test the pixel reader before trusting any theme assertion ---- */
  const fixture = encodeRgbPng(64, 32, (x) => (x < 32 ? [23, 23, 23] : [255, 255, 255]));
  const fpng = decodePng(fixture);
  const lLeft = avgLuma(fpng, { x: 0, y: 0, w: 32, h: 32 });
  const lRight = avgLuma(fpng, { x: 32, y: 0, w: 32, h: 32 });
  const px = pixelAt(fpng, 5, 5);
  fpng.width === 64 && fpng.height === 32 &&
    Math.abs(lLeft - 23) < 0.01 && Math.abs(lRight - 255) < 0.01 &&
    px.join() === "23,23,23"
    ? ok("E2E PNG 解码自检：filter/CRC/亮度全部对得上（" + lLeft.toFixed(1) + " vs " + lRight.toFixed(1) + "）")
    : bad("E2E PNG 解码自检", JSON.stringify({ lLeft, lRight, px }));

  // Fresh, deterministic store state for appearance + account assertions.
  const settingsBefore = fs.existsSync(SETTINGS_PATH)
    ? fs.readFileSync(SETTINGS_PATH)
    : null;
  const accountBefore = fs.existsSync(ACCOUNT_PATH)
    ? fs.readFileSync(ACCOUNT_PATH)
    : null;
  const sessionsBefore = fs.existsSync(SESSIONS_PATH)
    ? fs.readFileSync(SESSIONS_PATH)
    : null;
  // GP-99..102: the secret card writes a real Host vault; snapshot it so a
  // probe run never leaves a credential behind in data/secrets/.
  const SECRETS_DIR = sd("");
  const secretsBefore = fs.existsSync(path.join(SECRETS_DIR, "vault.json"))
    ? fs.readFileSync(path.join(SECRETS_DIR, "vault.json"))
    : null;
  const restoreStores = () => {
    if (settingsBefore) fs.writeFileSync(SETTINGS_PATH, settingsBefore);
    else fs.rmSync(SETTINGS_PATH, { force: true });
    if (accountBefore) fs.writeFileSync(ACCOUNT_PATH, accountBefore);
    else fs.rmSync(ACCOUNT_PATH, { force: true });
    if (sessionsBefore) fs.writeFileSync(SESSIONS_PATH, sessionsBefore);
    else fs.rmSync(SESSIONS_PATH, { force: true });
    if (secretsBefore) fs.writeFileSync(path.join(SECRETS_DIR, "vault.json"), secretsBefore);
    else fs.rmSync(path.join(SECRETS_DIR, "vault.json"), { force: true });
  };

  try {
    fs.writeFileSync(
      SETTINGS_PATH,
      JSON.stringify(
        {
          version: 1,
          appearance: "system",
          language: "zh-CN",
          timezone: "Asia/Shanghai",
          local_execution: "ask",
          route_traffic: false,
          notify: {},
          unread: {},
          sidebar_collapsed: false,
        },
        null,
        2,
      ),
    );
    fs.rmSync(ACCOUNT_PATH, { force: true });

    /* ---- cold start (replaces manual launch + eyeball) ---- */
    let boot = null;
    try {
      boot = await launch();
      ok("E2E 冷启动：_electron.launch 拉起真实 main + preload + index.html");
    } catch (e) {
      bad("E2E 冷启动", e.message);
      restoreStores();
      console.log(`e2e_grok_desktop_boot: PASS=${PASS} FAIL=${FAIL}`);
      process.exit(1);
    }
    const { app, win } = boot;

    // Native window title lives on BrowserWindow: win.title() mirrors the
    // document <title>, so assert the real shell title via the main process.
    const title = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return w ? w.getTitle() : "";
    });
    title.includes("Bit Bot Desktop")
      ? ok("E2E 窗口标题真实（" + title + "）")
      : bad("E2E 窗口标题", title);

    /* GP-70: appearance=system means no body.force-* class may take credit */
    const sysCls = await win.evaluate(() => ({
      force: document.body.classList.contains("force-dark") ||
        document.body.classList.contains("force-light"),
    }));
    sysCls.force
      ? bad("E2E system 态必须无 force 类", JSON.stringify(sysCls))
      : ok("E2E appearance=system → 无 force-dark/force-light，主题只走 OS 通道");
    const lumaSys = await viewportLuma(win, path.join(outDir, "theme-system.png"));

    const setAppearance = (mode) =>
      win.evaluate((m) => window.bitbot.settings.set({ appearance: m }), mode);

    /* ---- GP-70 pixel assertion, dark: the REAL user path (Settings chip →
       settings.set → applyAppearance(nativeTheme.themeSource) + broadcast →
       renderer force class). Pixels must actually go dark. ---- */
    const resDark = await setAppearance("dark");
    resDark && resDark.ok ? ok("E2E settings.set appearance=dark 回执 ok") : bad("E2E settings.set dark", JSON.stringify(resDark));
    await win.waitForTimeout(1000);
    const mainDark = await app.evaluate(({ nativeTheme }) => ({
      source: nativeTheme.themeSource,
      should: nativeTheme.shouldUseDarkColors,
    }));
    mainDark.source === "dark" && mainDark.should === true
      ? ok("E2E 主进程真值 themeSource=dark / shouldUseDarkColors=true")
      : bad("E2E nativeTheme 真值", JSON.stringify(mainDark));
    const rendererDark = await win.evaluate(() => ({
      forceDark: document.body.classList.contains("force-dark"),
      mediaDark: matchMedia("(prefers-color-scheme: dark)").matches,
    }));
    rendererDark.forceDark
      ? ok("E2E renderer 强制暗色类已应用（broadcast → wavegApplyAppearanceClass）")
      : bad("E2E renderer force-dark", JSON.stringify(rendererDark));
    if (!rendererDark.mediaDark) {
      console.log("  · RESIDUAL（如实）：Xvfb/Chromium 下 nativeTheme.themeSource 不驱动 live `prefers-color-scheme` media query（boot 探测同现）——暗色像素由 force-dark token 承担，themeSource 真值由主进程断言；OS live 通道需在带 DE 的机器复核。");
    }
    const lumaDark = await viewportLuma(win, path.join(outDir, "theme-dark.png"));
    lumaDark < 60
      ? ok("E2E 像素断言 dark：viewport 亮度 " + lumaDark.toFixed(1) + " < 60")
      : bad("E2E 像素 dark 亮度", lumaDark);

    /* ---- GP-70 pixel assertion, light: same live window flips back ---- */
    await setAppearance("light");
    await win.waitForTimeout(1000);
    const lumaLight = await viewportLuma(win, path.join(outDir, "theme-light.png"));
    lumaLight > 200
      ? ok("E2E 像素断言 light：viewport 亮度 " + lumaLight.toFixed(1) + " > 200")
      : bad("E2E 像素 light 亮度", lumaLight);
    const delta = lumaLight - lumaDark;
    delta > 120
      ? ok("E2E 主题切换像素差 " + delta.toFixed(1) + "（>120，非渐变噪声）")
      : bad("E2E 主题像素差", delta);
    const lightCls = await win.evaluate(() => ({
      forceDark: document.body.classList.contains("force-dark"),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    !lightCls.forceDark
      ? ok("E2E light 态 force-dark 已解除（bg " + lightCls.bg + "）")
      : bad("E2E light 态残留 force-dark", JSON.stringify(lightCls));

    /* ---- system 回归基线：回到 OS 态，亮度复位 ---- */
    await setAppearance("system");
    await win.waitForTimeout(1000);
    const lumaBack = await viewportLuma(win, path.join(outDir, "theme-back-system.png"));
    Math.abs(lumaBack - lumaSys) < 25
      ? ok("E2E 回到 system 像素复位（Δ" + Math.abs(lumaBack - lumaSys).toFixed(1) + " < 25）")
      : bad("E2E system 复位", lumaBack + " vs " + lumaSys);

    /* ---- GP-70 持久化 + 重启保持：写 dark → 真实重启读取 ---- */
    await setAppearance("dark");
    const persisted = readSettings();
    persisted.appearance === "dark"
      ? ok("E2E settings.json 落盘 appearance=dark")
      : bad("E2E settings 落盘", JSON.stringify(persisted));

    await shutdown(app);
    const boot2 = await launch();
    const restored = await boot2.win.evaluate(() => ({
      forceDark: document.body.classList.contains("force-dark"),
      src: window.bitbot ? "bridge" : "none",
    }));
    restored.forceDark
      ? ok("E2E 重启后 force-dark 由持久值恢复（boot applyAppearance）")
      : bad("E2E 重启持久化", JSON.stringify(restored));
    const lumaRestart = await viewportLuma(boot2.win, path.join(outDir, "theme-restart-dark.png"));
    lumaRestart < 60
      ? ok("E2E 重启像素仍是暗色（亮度 " + lumaRestart.toFixed(1) + " < 60）")
      : bad("E2E 重启像素", lumaRestart);

    /* ---- real chat turn through the kernel (replaces manual typing) ---- */
    await boot2.win.fill("#composer #text", "sign in E2E");
    await boot2.win.press("#composer #text", "Enter");
    await boot2.win.waitForFunction(
      () => /本地 profile|已登录/.test(document.getElementById("log").innerText),
      null,
      { timeout: 30000 },
    ).then(
      () => ok("E2E 聊天链路：sign in E2E → Host 账户回执气泡真实渲染"),
      (e) => bad("E2E 聊天链路", e.message),
    );
    const acct = fs.existsSync(ACCOUNT_PATH)
      ? JSON.parse(fs.readFileSync(ACCOUNT_PATH, "utf8"))
      : {};
    acct.active === "E2E" && (acct.accounts || []).some((a) => a.label === "E2E")
      ? ok("E2E 账户 store 真写入 active=E2E（local-profile）")
      : bad("E2E 账户 store", JSON.stringify(acct).slice(0, 120));

    /* ---- GP-11 attachment limits through the real IPC bridge ----
       stagePaths maps File→real path with webUtils in preload, then the SAME
       Host validator main.js uses gates count/size. From the page we can only
       hand it pathless pseudo-Files (exactly the paste-blob case), which is
       what the count/no-path assertions exercise. */
    const bridge = await boot2.win.evaluate(async () => {
      const a = window.bitbot && window.bitbot.attachments;
      const out = { hasBridge: Boolean(a && a.stagePaths && a.pick) };
      out.refusedPath = await a.stagePaths([{ name: "blob.png" }], 0);
      out.refusedSix = await a.stagePaths(
        Array.from({ length: 2 }, (_, i) => ({ name: "f" + i })),
        5,
      );
      return out;
    });
    bridge.hasBridge
      ? ok("E2E GP-11：preload 附件桥（pick(existing)/stagePaths(files,existing)）已暴露")
      : bad("E2E GP-11 桥缺失", JSON.stringify(bridge));
    const noPath = bridge.refusedPath || {};
    noPath.ok === false && String(noPath.code || "") === "no_real_path"
      ? ok("E2E GP-11：无真实磁盘路径的粘贴/拖拽被诚实拒绝（不伪造路径，CM-0106）")
      : bad("E2E GP-11 no_real_path", JSON.stringify(noPath).slice(0, 160));
    const tooMany = bridge.refusedSix || {};
    tooMany.ok === false &&
      String(tooMany.code || "") === "too_many_attachments" &&
      tooMany.max_per_send === 6 &&
      tooMany.already_staged === 5
      ? ok("E2E GP-11：已有 5 个再拖 2 个 → too_many_attachments（跨次累计 ≤6）")
      : bad("E2E GP-11 count cap", JSON.stringify(tooMany).slice(0, 160));

    /* renderer drop wiring: a synthetic File drop over the window must run the
       stage path and show the LOCALIZED honest refusal (no silent drop). */
    await boot2.win.evaluate(() => {
      const file = new File(["hi"], "clip.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.body.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
      );
    });
    await boot2.win.waitForTimeout(1200);
    await boot2.win
      .waitForFunction(
        () => /附件被拒绝|没有真实磁盘路径/.test(document.getElementById("log").innerText),
        null,
        { timeout: 10000 },
      )
      .then(
        () => ok("E2E GP-11：拖拽链路进 renderer → 本地化诚实拒绝气泡（无路径不伪造）"),
        (e) => bad("E2E GP-11 drop refusal UI", e.message),
      );

    await shutdown(boot2.app);

    /* ---- GP-11 size caps + full-chain copy, against the same Host
       product_surface main.js requires (one validator, three entry points) ---- */
    {
      const { execFileSync } = await import("node:child_process");
      const surfaceMod = createRequire(path.join(REPO, "hosts/desktop/package.json"));
      /* 用 GATE_ROOT 而不是 REPO：这个 surface 会真的把附件写进
         data/workspace/uploads/ —— 指向真实仓库就是在往用户目录里丢测试文件，
         后面「暂存路径落在隔离根里」的断言也就必然红。 */
      const surface = surfaceMod(path.join(REPO, "hosts/desktop/product_surface.js"))
        .createProductSurface(GATE_ROOT);
      const d11 = "/tmp/e2e-gp11";
      fs.rmSync(d11, { recursive: true, force: true });
      fs.mkdirSync(d11, { recursive: true });
      execFileSync("truncate", ["-s", "26M", d11 + "/big.png"]);
      execFileSync("truncate", ["-s", "201M", d11 + "/big.mp4"]);
      execFileSync("truncate", ["-s", "24M", d11 + "/ok.png"]);
      const r26 = surface.stageAttachments([d11 + "/big.png"], "gp11e2e");
      r26.ok === false &&
        String(r26.code || "").startsWith("too_large:") &&
        r26.kind === "image" &&
        r26.max_bytes === 25 * 1024 * 1024
        ? ok("E2E GP-11：26MB 图片 → too_large（image 上限 25MB，负载带 kind/max）")
        : bad("E2E GP-11 25MB cap", JSON.stringify(r26).slice(0, 160));
      const r201 = surface.stageAttachments([d11 + "/big.mp4"], "gp11e2e");
      r201.ok === false &&
        String(r201.code || "").startsWith("too_large:") &&
        r201.kind === "video" &&
        r201.max_bytes === 200 * 1024 * 1024
        ? ok("E2E GP-11：201MB 视频 → too_large（video 上限 200MB）")
        : bad("E2E GP-11 200MB cap", JSON.stringify(r201).slice(0, 160));
      const r7 = surface.stageAttachments(
        Array.from({ length: 7 }, (_, i) => d11 + "/big.png#" + i),
        "gp11e2e",
      );
      r7.ok === false && String(r7.code || "") === "too_many_attachments"
        ? ok("E2E GP-11：7 个 → too_many_attachments")
        : bad("E2E GP-11 7-cap", JSON.stringify(r7).slice(0, 160));
      // Success path: 6 small files stage into data/workspace/uploads.
      for (let i = 0; i < 6; i++) fs.writeFileSync(d11 + "/s" + i + ".txt", "gp11-" + i);
      const six = surface.stageAttachments(
        Array.from({ length: 6 }, (_, i) => d11 + "/s" + i + ".txt"),
        "gp11e2e",
      );
      six.ok && six.paths && six.paths.length === 6
        ? ok("E2E GP-11：6 个成功暂存 → data/workspace/uploads/gp11e2e/（真实路径回执）")
        : bad("E2E GP-11 stage6", JSON.stringify(six).slice(0, 160));
      const underWs = (six.paths || []).every(
        (p) => p.startsWith(path.join(GATE_ROOT, "data/workspace/uploads/gp11e2e")),
      );
      underWs ? ok("E2E GP-11：暂存路径全部落在 workspace uploads 语义目录") : bad("E2E GP-11 stage dir");
      // Kernel end of the chain: composer pick format → attach_files intent →
      // exactly N copy_to_box effects (one per real path, dest = basename).
      const phrase =
        "看下这批文件\n" +
        six.paths.map((p) => "attach file " + p).join("; ");
      const turn = await new Promise((res, rej) => {
        const { spawn: spawnChild } = require("node:child_process");
        const mo =
          process.env.MOON_BIN || path.join(process.env.HOME || "", ".moon/bin/moon");
        const p = spawnChild(mo, ["run", "cmd/desktop_turn", "--", phrase], {
          stdio: ["ignore", "pipe", "pipe"],
          cwd: REPO,
        });
        let out = "";
        p.stdout.on("data", (d) => (out += d));
        p.on("error", rej);
        p.on("close", () =>
          res(out.trim().split("\n").filter((l) => l.startsWith("{")).pop() || "{}"),
        );
      });
      const tj = JSON.parse(turn);
      const effs = (tj.effects || []).filter((e) => e.kind === "copy_to_box");
      tj.intent === "attach_files" && effs.length === 6
        ? ok("E2E GP-11：内核链 attach_files → 6 条逐路径 copy_to_box 效果（不吞列表）")
        : bad("E2E GP-11 kernel chain", JSON.stringify({ i: tj.intent, n: effs.length }));
      const destsOk = effs.every((e, i) =>
        e.command === "desk-1|" + six.paths[i] + "|data/workspace/uploads/s" + i + ".txt",
      );
      destsOk
        ? ok("E2E GP-11：每条效果 dest=data/workspace/uploads/<basename>（Host 可执行，无幻觉 /workspace）")
        : bad("E2E GP-11 dest mapping", JSON.stringify(effs[0]).slice(0, 200));
      fs.rmSync(d11, { recursive: true, force: true });
      fs.rmSync(path.join(GATE_ROOT, "data/workspace/uploads/gp11e2e"), { recursive: true, force: true });
    }

    /* ---- GP-14 Reply 回复特定消息：id 必须进 kernel 上下文并变成真引用 ----
       走真实 UI：第一轮发消息 → hover 助手气泡 → 点「回复」→ 引用条出现 →
       发第二条。断言三层：kernel 回显 reply_to；Host 把该 id 解析成原文并塞进
       provider 请求（用 echo-all stub 在 HTTP body 层自证）；store 行带 reply_to
       且重载后 DOM 有引用条。伪 id 场景必须 resolved:false（不假装引用成功）。*/
    const stubPort = 8793;
    const g14Env = {
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + stubPort + "/v1",
      BITBOT_LLM_API_KEY: "e2e-stub-key",
      BITBOT_LLM_MODEL: "e2e-stub",
      BITBOT_LLM_STREAM: "0",
    };
    let stubProc = null;
    let target = null;
    try {
      const { spawn: spawnChild } = require("node:child_process");
      stubProc = spawnChild(
        process.execPath,
        [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
        {
          cwd: REPO,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            BITBOT_STUB_PORT: String(stubPort),
            BITBOT_STUB_ECHO_ALL: "1",
          },
        },
      );
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("stub boot timeout")), 8000);
        stubProc.stdout.on("data", (d) => {
          if (String(d).includes("[stub-llm]")) {
            clearTimeout(t);
            res();
          }
        });
        stubProc.on("error", rej);
      });

      const bootG14 = await launch(g14Env);
      // 干净会话：前面的 boot 已往 active session 写过消息，Reply 目标必须唯一，
      // 所以这里从「新建对话」开始，而不是在污染的转写里猜。
      await bootG14.win.evaluate(() => window.bbUi.newSession());
      await bootG14.win.waitForFunction(
        () => document.querySelectorAll("#log .msg").length === 0 ||
          document.getElementById("welcome"),
        null,
        { timeout: 15000 },
      );
      // 第一条消息（真实键盘 → kernel → Host llm_chat → stub 回执）
      await bootG14.win.fill("#composer #text", "GP14 原始问题 target-me");
      await bootG14.win.press("#composer #text", "Enter");
      // 等到该轮消息真的拿到 store id（乐观渲染的 user 气泡没有 id），
      // 否则下面的目标选择会读到空集合。
      await bootG14.win.waitForFunction(
        () => Array.from(document.querySelectorAll("#log .msg[data-mid]")).some(
          (el) => /GP14 原始问题/.test(el.textContent || ""),
        ),
        null,
        { timeout: 45000 },
      );
      const bubbles = await bootG14.win.evaluate(() =>
        Array.from(document.querySelectorAll("#log .msg[data-mid]")).map((el) => ({
          mid: el.dataset.mid,
          role: el.classList.contains("user") ? "user" : "assistant",
          text: (el.querySelector(".body") || {}).textContent || "",
        })),
      );
      const candidates = bubbles.filter(
        (b) => b.mid && /GP14 原始问题/.test(b.text),
      );
      // 回复助手回执更贴近 Grok 行为（Reply 一条具体回答）
      target =
        candidates.filter((b) => b.role === "assistant").pop() ||
        candidates.pop() ||
        null;
      target
        ? ok("E2E GP-14：首轮消息带持久 id（" + target.mid + " / " + target.role + "）供回复定位")
        : bad("E2E GP-14 missing message id", JSON.stringify(bubbles).slice(0, 300));

      // 点该气泡上的「回复」→ composer 上方出现引用条
      const clicked = await bootG14.win.evaluate((mid) => {
        if (!mid) return { bar: "no-target", title: "" };
        const el = document.querySelector('#log .msg[data-mid="' + mid + '"]');
        const btn = el && el.querySelector(".msg-actions button");
        if (!btn) return { bar: "no-reply-button", title: "" };
        btn.click();
        const bar = document.getElementById("reply-bar");
        const txt = document.getElementById("reply-bar-text") || {};
        return bar && bar.style.display !== "none"
          ? { bar: txt.textContent || "", title: txt.title || "" }
          : { bar: "bar-hidden", title: "" };
      }, target ? target.mid : "");
      // 引用条合同 = 「被回复那条消息正文的前缀」+ 指向那条消息的持久 id。
      // （正文按 90 字截断，所以不能要求某个中段词一定出现——那是截断合同，不是丢内容。）
      // 气泡正文走 marked({breaks:true})，换行变 <br>（textContent 里不再有换行符），
      // 所以前缀比较前两边统一去掉空白：比较的是可见文字，不是源码排版。
      const stripWs = (s) => String(s || "").replace(/\s+/g, "");
      const barBody = String(clicked.bar || "").replace(/^回复：/, "");
      barBody.length > 0 && target && stripWs(target.text).startsWith(stripWs(barBody)) &&
        clicked.title === "id=" + (target ? target.mid : "")
        ? ok("E2E GP-14：Reply 按钮 → 引用条显示被回复消息原文（前缀 + id 指向同一条）")
        : bad("E2E GP-14 reply bar", JSON.stringify(clicked).slice(0, 200));

      // 发第二条：id 必须进 kernel（--reply-to）并解析成 provider 请求里的引用
      await bootG14.win.fill("#composer #text", "GP14 针对引用作答");
      await bootG14.win.press("#composer #text", "Enter");
      await bootG14.win.waitForFunction(
        () => document.querySelectorAll("#log .msg-reply-quote").length >= 1 &&
          /quoted message/.test(document.getElementById("log").innerText),
        null,
        { timeout: 45000 },
      ).then(
        () => ok("E2E GP-14：回复回合渲染出带 [quoted message <id>] 的 provider 回执（真引用，非本地拼接）"),
        (e) => bad("E2E GP-14 quoted reply round-trip", e.message),
      );

      const art = newestLlmTurnArtifact();
      art.reply_to === target.mid && art.reply_quote_chars > 0 &&
        art.reply_quote_source === "session_store"
        ? ok("E2E GP-14：Host 侧 artifact 记录 reply_to=" + art.reply_to + " + 引文来自 session store")
        : bad("E2E GP-14 llm artifact", JSON.stringify({
            reply_to: art.reply_to,
            chars: art.reply_quote_chars,
            source: art.reply_quote_source,
            want: target.mid,
          }));

      // store 行持久化 reply_to + 重新载入会话后引用条仍在（不是只在内存里）
      const sessState = JSON.parse(fs.readFileSync(SESSIONS_PATH, "utf8"));
      let storedReply = null;
      // 只看本轮真正写入的那个会话：块开头点了「新建对话」，而前几轮 E2E 的行
      // 仍在 store 里（快照恢复保存的就是含历史行的文件）。全局搜最后一条匹配
      // 会命中上一轮的旧行，reply_to 对不上 → 假红。按 target.mid 定位会话。
      const runSession = (sessState.sessions || []).find(
        (ses) => (ses.messages || []).some((m) => m && m.id === (target && target.mid)),
      );
      for (const m of (runSession && runSession.messages) || []) {
        if (m && m.role === "user" && /GP14 针对引用作答/.test(String(m.text || "")))
          storedReply = m;
      }
      storedReply && storedReply.reply_to === target.mid
        ? ok("E2E GP-14：sessions.json 用户行带 reply_to=" + storedReply.reply_to)
        : bad("E2E GP-14 store row", JSON.stringify(storedReply || null).slice(0, 160));
      const quoteDom = await bootG14.win.evaluate(() => {
        const q = document.querySelector("#log .msg-reply-quote");
        return {
          chips: document.querySelectorAll("#log .msg-reply-quote").length,
          text: q ? (q.textContent || "") : "",
          mid: q ? (q.dataset.mid || "") : "",
        };
      });
      const chipBody = String(quoteDom.text || "").replace(/^回复：/, "");
      quoteDom.chips >= 1 && chipBody.length > 0 &&
        target && stripWs(target.text).startsWith(stripWs(chipBody)) &&
        quoteDom.mid === target.mid
        ? ok("E2E GP-14：转写里回复气泡上方渲染引用条（" + quoteDom.chips + " 处，指向 " + quoteDom.mid + "）")
        : bad("E2E GP-14 quote chip", JSON.stringify(quoteDom).slice(0, 200));
      // 侧栏切走再切回 = 从 store 重载，引用必须仍在（不是只在内存里）
      let reloadSessionId = null;
      {
        const st2 = JSON.parse(fs.readFileSync(SESSIONS_PATH, "utf8"));
        for (const ses of st2.sessions || []) {
          for (const m of ses.messages || []) {
            if (m && /GP14 针对引用作答/.test(String(m.text || ""))) reloadSessionId = ses.id;
          }
        }
      }
      const reload = await bootG14.win.evaluate(async (sid) => {
        await window.bbUi.newSession();
        await new Promise((r) => setTimeout(r, 1500));
        const away = document.querySelectorAll("#log .msg-reply-quote").length;
        const back = document.querySelector('[data-session-id="' + sid + '"]');
        if (!back) return { sid, away, found: false, chips: -1 };
        back.click();
        await new Promise((r) => setTimeout(r, 1500));
        return {
          sid,
          away,
          found: true,
          chips: document.querySelectorAll("#log .msg-reply-quote").length,
          text: (document.querySelector("#log .msg-reply-quote") || {}).textContent || "",
        };
      }, reloadSessionId);
      // 引用条正文会被折叠空白并截断，所以两边都先归一化再比对——
      // 否则原文末尾一个换行就会让 includes 假红（不是产品问题）。
      const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
      reload.found && reload.away === 0 && reload.chips > 0 &&
        norm(reload.text).includes(norm(target ? target.text : "GP14").slice(0, 24))
        ? ok("E2E GP-14：切到新会话引用消失、切回原会话引用从 store 重建（" + reload.chips + " 处）")
        : bad("E2E GP-14 reload", JSON.stringify(reload).slice(0, 200));

      // 取消按钮：引用条可撤销，撤销后下一条不再带 id
      const cancelState = await bootG14.win.evaluate(() => {
        const el = document.querySelector('#log .msg[data-mid] .msg-actions button');
        if (el) el.click();
        const shown = document.getElementById("reply-bar").style.display !== "none";
        document.getElementById("reply-cancel").click();
        return { shown, hidden: document.getElementById("reply-bar").style.display === "none" };
      });
      cancelState.shown && cancelState.hidden
        ? ok("E2E GP-14：取消回复 → 引用条收起")
        : bad("E2E GP-14 cancel", JSON.stringify(cancelState));
      await shutdown(bootG14.app);

      // 伪 id 必须诚实失败（不假装引用成功）— node 侧真实 Host 链
      Object.assign(process.env, g14Env);
      const { createTurnRunner } = require(path.join(REPO, "hosts/shared/run_moon_turn.js"));
      const runnerG14 = createTurnRunner(REPO);
      const ghost = await runnerG14.runTurn("GP14 幽灵引用", {
        sessionId: "e2e-gp14-ghost",
        machineId: "desk-1",
        machineKind: "desktop",
        replyTo: "msg-not-real-e2e",
      });
      const gq = ghost.reply_quote || {};
      ghost.reply_to === "msg-not-real-e2e" && gq.resolved === false &&
        /message_not_found/.test(String(gq.error || ""))
        ? ok("E2E GP-14：未知消息 id → kernel 仍回显 + Host 报 message_not_found（不静默吞）")
        : bad("E2E GP-14 ghost id", JSON.stringify({ echo: ghost.reply_to, q: gq }).slice(0, 200));
      const ga = newestLlmTurnArtifact();
      ga.reply_to === "msg-not-real-e2e" && ga.reply_quote_chars === 0 &&
        ga.reply_quote_source === "unresolved"
        ? ok("E2E GP-14：未解析引用在 provider artifact 标 unresolved（可审计）")
        : bad("E2E GP-14 unresolved artifact", JSON.stringify({
            reply_to: ga.reply_to,
            chars: ga.reply_quote_chars,
            source: ga.reply_quote_source,
          }));
    } catch (e) {
      bad("E2E GP-14 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      for (const k of Object.keys(g14Env)) delete process.env[k];
      if (stubProc) {
        try {
          stubProc.kill("SIGKILL");
        } catch (_) {}
      }
    }

    /* ---- GP-99..102 安全密钥输入（官方 spec §8.3）----
       真实 UI：打开密钥卡 → 往 <input type=password> 键入 → 点保存。
       断言：字段确实是 password 类型且不在 composer 里；提交后转写只有
       [REDACTED]、composer 与 sessions.json 都 grep 不到明文、vault 落盘是
       密文；再重载窗口，占位符仍在（历史里没有密钥）。*/
    const g21Secret = "sk-proj-E2EPROBE-0123456789abcdefghijkl";
    try {
      const bootG21 = await launch({
        BITBOT_LLM_STREAM: "0",
      });
      await bootG21.win.evaluate(() => window.bbUi.newSession());
      // Real user path: paste a credential into the composer and press Enter.
      // The renderer must refuse the message and open the secure card instead.
      await bootG21.win.fill("#composer #text", g21Secret);
      await bootG21.win.press("#composer #text", "Enter");
      await bootG21.win.waitForSelector("#secret-request-input", { timeout: 20000 });
      const pasteGuard = await bootG21.win.evaluate((secret) => {
        const bodies = Array.from(document.querySelectorAll("#log .msg .body"))
          .map((b) => b.textContent || "")
          .join("\n");
        return {
          card: Boolean(document.querySelector("#secret-request-input")),
          composer: document.getElementById("text").value,
          plaintextInLog: bodies.indexOf(secret) >= 0,
          blockedNote: bodies.indexOf("[REDACTED]") >= 0,
        };
      }, g21Secret);
      pasteGuard.card && pasteGuard.composer === "" && !pasteGuard.plaintextInLog && pasteGuard.blockedNote
        ? ok("E2E GP-101：密钥粘贴被 composer 拦截 → 清空 + 打开安全卡 + 只留 [REDACTED]")
        : bad("E2E GP-101 paste guard", JSON.stringify(pasteGuard).slice(0, 220));

      const fieldType = await bootG21.win.getAttribute("#secret-request-input", "type");
      fieldType === "password"
        ? ok("E2E GP-99：输入框 type=password（浏览器不渲染明文）")
        : bad("E2E GP-99 field type", String(fieldType));

      await bootG21.win.fill("#secret-request-input", g21Secret);
      const composerAtType = await bootG21.win.inputValue("#composer #text");
      composerAtType === ""
        ? ok("E2E GP-99：键入密钥不经过 composer（composer 仍为空）")
        : bad("E2E GP-99 composer leak", composerAtType.slice(0, 40));

      await bootG21.win.click("#secret-request-submit");
      await bootG21.win.waitForFunction(
        () => {
          const p = document.querySelector("#secret-redacted-pill");
          return p && p.textContent === "[REDACTED]";
        },
        null,
        { timeout: 20000 },
      );
      const afterSubmit = await bootG21.win.evaluate((secret) => {
        const pill = document.querySelector("#secret-redacted-pill");
        const bodyText = Array.from(document.querySelectorAll("#log .msg .body"))
          .map((b) => b.textContent || "")
          .join("\n");
        return {
          pill: pill ? pill.textContent : "",
          handle: pill ? pill.dataset.handle : "",
          fieldValue: document.querySelector("#secret-request-input").value,
          fieldDisabled: document.querySelector("#secret-request-input").disabled,
          composer: document.getElementById("text").value,
          plaintextInLog: bodyText.indexOf(secret) >= 0,
          tailInLog: bodyText.indexOf(secret.slice(-4)) >= 0,
          status: (document.getElementById("secret-request-status") || {}).textContent || "",
        };
      }, g21Secret);
      afterSubmit.pill === "[REDACTED]" && afterSubmit.handle.startsWith("sec-")
        ? ok("E2E GP-101：转写气泡恰为 [REDACTED] + 真实 handle（" + afterSubmit.handle + "）")
        : bad("E2E GP-101 pill", JSON.stringify(afterSubmit).slice(0, 220));
      !afterSubmit.plaintextInLog && !afterSubmit.tailInLog && afterSubmit.composer === ""
        ? ok("E2E GP-101/102：对话正文与 composer 都不含明文/尾 4 位")
        : bad("E2E GP-101 leak", JSON.stringify(afterSubmit).slice(0, 220));
      afterSubmit.fieldValue === "" && afterSubmit.fieldDisabled
        ? ok("E2E GP-99：提交后输入框清空并禁用（值只存在于 Host vault）")
        : bad("E2E GP-99 field reset", JSON.stringify(afterSubmit).slice(0, 160));

      // Re-open: history must still show the placeholder, never the value.
      await bootG21.win.reload();
      await bootG21.win.waitForSelector("#composer #text", { timeout: 30000 });
      await bootG21.win.waitForTimeout(1200);
      await expandBotList(bootG21.win);
      const afterReload = await bootG21.win.evaluate((secret) => {
        const bodyText = Array.from(document.querySelectorAll("#log .msg .body"))
          .map((b) => b.textContent || "")
          .join("\n");
        return {
          redactedRows: document.querySelectorAll(".secret-redacted-row").length,
          plaintext: bodyText.indexOf(secret) >= 0,
        };
      }, g21Secret);
      afterReload.redactedRows >= 1 && !afterReload.plaintext
        ? ok("E2E GP-102：重载窗口后历史仍只有 [REDACTED] 行（密钥不进聊天历史）")
        : bad("E2E GP-102 reload", JSON.stringify(afterReload));

      const storedSessions = fs.existsSync(SESSIONS_PATH)
        ? fs.readFileSync(SESSIONS_PATH, "utf8")
        : "";
      const storedVault = fs.existsSync(path.join(SECRETS_DIR, "vault.json"))
        ? fs.readFileSync(path.join(SECRETS_DIR, "vault.json"), "utf8")
        : "";
      storedSessions.indexOf(g21Secret) < 0
        ? ok("E2E GP-102：sessions.json 落盘不含明文")
        : bad("E2E GP-102 sessions leak", "plaintext persisted");
      storedVault.length > 0 && storedVault.indexOf(g21Secret) < 0
        ? ok("E2E GP-100：vault.json 落盘为密文（Host 独占解密）")
        : bad("E2E GP-100 vault at rest", "vault missing or plaintext");

      const hostVaultStatus = await bootG21.win.evaluate(() =>
        window.bitbot.secrets.vault(),
      );
      const e2eEntry =
        (hostVaultStatus &&
          hostVaultStatus.entries &&
          (hostVaultStatus.entries.pasted_secret || hostVaultStatus.entries.e2e_probe)) ||
        {};
      e2eEntry.masked === "****" + g21Secret.slice(-4) && e2eEntry.value === null
        ? ok("E2E GP-100：IPC 读回的 vault 只有 ****last4，value 恒为 null")
        : bad("E2E GP-100 vault status", JSON.stringify(e2eEntry).slice(0, 200));

      await bootG21.win.evaluate(() => window.bitbot.secrets.remove("pasted_secret"));
      await shutdown(bootG21.app);
    } catch (e) {
      bad("E2E GP-99..102 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    }

    /* ---- GP-108/109 先读后执行（官方 spec §6.4）----
       真实 UI：点侧栏 Routines 的「Fire routine」→ 对话流出现草稿卡（不是执行），
       卡上带 prompt 与审批边界；点卡上的「执行」→ 第二次回合才真正执行。
       断言的是 DOM 状态 + 落盘产物，不是源码字符串。*/
    const ROUTINES_PATH = rd("host-routines.json");
    const FIRES_PATH = rd("fires.jsonl");
    const DRAFTS_DIR = rd("drafts");
    const routinesBefore = fs.existsSync(ROUTINES_PATH)
      ? fs.readFileSync(ROUTINES_PATH)
      : null;
    const firesBefore = fs.existsSync(FIRES_PATH) ? fs.readFileSync(FIRES_PATH) : null;
    const draftsBefore = fs.existsSync(DRAFTS_DIR) ? fs.readdirSync(DRAFTS_DIR) : [];
    try {
      const bootG22 = await launch({ BITBOT_LLM_STREAM: "0" });
      await bootG22.win.evaluate(() => window.bbUi.newSession());
      await bootG22.win.evaluate(() => document.getElementById("rt-fire").click());
      await bootG22.win.waitForSelector(".routine-draft", { timeout: 30000 });
      await bootG22.win.waitForTimeout(600);

      const draftDom = await bootG22.win.evaluate(() => {
        const card = document.querySelector(".routine-draft");
        const exec = document.getElementById("routine-draft-execute");
        return {
          cards: document.querySelectorAll(".routine-draft").length,
          hasPrompt: Boolean(card && card.querySelector(".rd-prompt")),
          boundary: (card && card.querySelector(".rd-boundary")?.textContent) || "",
          hasExecute: Boolean(exec),
          executeEnabled: Boolean(exec && !exec.disabled),
          firedRows: document.querySelectorAll('[data-routine-draft]').length,
        };
      });
      draftDom.cards === 1 && draftDom.hasPrompt && draftDom.hasExecute && draftDom.executeEnabled
        ? ok("E2E GP-108：点 Fire 后对话流出现草稿卡（带 prompt + 可点的执行按钮）")
        : bad("E2E GP-108 draft card", JSON.stringify(draftDom).slice(0, 220));

      /external_send/.test(draftDom.boundary) && /purchase/.test(draftDom.boundary)
        ? ok("E2E GP-108：卡上写明审批边界（external_send / purchase …），不是一句“已触发”")
        : bad("E2E GP-108 boundary text", draftDom.boundary.slice(0, 160));

      const draftFiles = fs.existsSync(DRAFTS_DIR) ? fs.readdirSync(DRAFTS_DIR) : [];
      const newDrafts = draftFiles.filter((f) => !draftsBefore.includes(f));
      let draftJson = {};
      try {
        draftJson = JSON.parse(
          fs.readFileSync(path.join(DRAFTS_DIR, newDrafts[0]), "utf8"),
        );
      } catch (_) {
        draftJson = {};
      }
      newDrafts.length === 1 &&
        draftJson.requires_approval === true &&
        draftJson.default_action === "draft" &&
        Array.isArray(draftJson.approval_boundary)
        ? ok("E2E GP-108：Host 真落了一份草稿（requires_approval + default_action=draft）")
        : bad("E2E GP-108 draft artifact", JSON.stringify({ n: newDrafts.length, d: draftJson }).slice(0, 240));

      // Before the user presses Execute there must be no execution record.
      const firesPre = fs.existsSync(FIRES_PATH) ? fs.readFileSync(FIRES_PATH, "utf8") : "";
      const firesPreRows = firesPre
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (_) {
            return {};
          }
        });
      const preExecuted = firesPreRows.filter((r) => r && r.executed === true).length;
      const preFiredButNotExecuted = firesPreRows.filter(
        (r) => r && r.mode === "host_routine_draft" && r.executed === false,
      ).length;
      preFiredButNotExecuted >= 1
        ? ok("E2E GP-108：准备阶段 fires.jsonl 记 mode=host_routine_draft + executed:false")
        : bad("E2E GP-108 prepare record", "no draft-mode fire row");

      // Now the explicit execute step.
      await bootG22.win.evaluate(() => document.getElementById("routine-draft-execute").click());
      await bootG22.win.waitForFunction(
        () => {
          const btn = document.getElementById("routine-draft-execute");
          return btn && btn.disabled === true;
        },
        { timeout: 40000 },
      );
      await bootG22.win.waitForTimeout(1500);
      const afterExec = fs.existsSync(FIRES_PATH) ? fs.readFileSync(FIRES_PATH, "utf8") : "";
      const execRows = afterExec
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (_) {
            return {};
          }
        })
        .filter((r) => r && r.executed === true);
      execRows.length === preExecuted + 1 &&
        execRows[execRows.length - 1].mode === "host_routine_fire_executed" &&
        execRows[execRows.length - 1].execute_via === "command"
        ? ok("E2E GP-109：点「执行」后才新增一条 host_routine_fire_executed（execute_via=command）")
        : bad("E2E GP-109 executed row", JSON.stringify({ pre: preExecuted, post: execRows.length }).slice(0, 200));

      const execDom = await bootG22.win.evaluate(() => {
        const card = document.querySelector(".routine-draft");
        return {
          status: (card && card.querySelector(".draft-status")?.textContent) || "",
          disabled: Boolean(document.getElementById("routine-draft-execute")?.disabled),
        };
      });
      execDom.disabled && execDom.status.length > 0
        ? ok("E2E GP-109：执行后卡上按钮固化并显示状态（不可重复点）")
        : bad("E2E GP-109 card state", JSON.stringify(execDom).slice(0, 160));

      await shutdown(bootG22.app);
    } catch (e) {
      bad("E2E GP-108/109 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      if (routinesBefore) fs.writeFileSync(ROUTINES_PATH, routinesBefore);
      else fs.rmSync(ROUTINES_PATH, { force: true });
      if (firesBefore) fs.writeFileSync(FIRES_PATH, firesBefore);
      else fs.rmSync(FIRES_PATH, { force: true });
      for (const f of fs.existsSync(DRAFTS_DIR) ? fs.readdirSync(DRAFTS_DIR) : []) {
        if (!draftsBefore.includes(f)) fs.rmSync(path.join(DRAFTS_DIR, f), { force: true });
      }
    }

    /* ---- GP-111/112 跨会话记忆（官方 spec §4.2）----
       真实 UI：在 Bot A 的私聊里 remember 一条偏好 → 切到 Bot B 的私聊 recall
       → 再切回 A recall。断言读的是真实落盘产物（desktop-host.json 分槽、
       profile-vault.json 分槽、recall 快照的 bot_id/count），不是源码字符串。*/
    const MEM_STORE = path.join(GATE_ROOT, "data/memory/desktop-host.json");
    const MEM_VAULT = path.join(GATE_ROOT, "data/memory/profile-vault.json");
    const MEM_DIR = path.join(GATE_ROOT, "data/memory");
    const memStoreBefore = fs.existsSync(MEM_STORE) ? fs.readFileSync(MEM_STORE) : null;
    const memVaultBefore = fs.existsSync(MEM_VAULT) ? fs.readFileSync(MEM_VAULT) : null;
    const memFilesBefore = fs.existsSync(MEM_DIR)
      ? fs.readdirSync(MEM_DIR).filter((f) => f.endsWith(".json"))
      : [];
    try {
      const botsNow = JSON.parse(
        fs.readFileSync(dd("bots.json"), "utf8"),
      ).bots || [];
      const visible = botsNow.filter((b) => b && b.id && !b.hidden);
      const botA = (visible.find((b) => b.id !== "agent-bit") || visible[0] || {}).id;
      const botB = (visible.find((b) => b.id !== botA) || {}).id;
      if (!botA || !botB) throw new Error("need two visible Bots for the memory probe");

      const memKey = "e2e_mem_" + Date.now().toString(36);
      const recallsOf = (key) => {
        const out = [];
        for (const f of fs.existsSync(MEM_DIR) ? fs.readdirSync(MEM_DIR) : []) {
          if (!f.startsWith("recall-") || !f.endsWith(".json")) continue;
          if (memFilesBefore.includes(f)) continue;
          try {
            const j = JSON.parse(fs.readFileSync(path.join(MEM_DIR, f), "utf8"));
            if (j && String(j.prefix || "") === key) out.push(j);
          } catch (_) {}
        }
        return out;
      };
      const waitFor = async (fn, ms) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          const v = fn();
          if (v) return v;
          await new Promise((r) => setTimeout(r, 250));
        }
        return null;
      };

      const bootG23 = await launch({ BITBOT_LLM_STREAM: "0" });
      await bootG23.win.waitForSelector("#bot-list [data-agent-id]", { timeout: 30000 });

      /* openBot 以前是「点一下 + 死等 900ms」。侧栏正在重绘的那一瞬间，那一下可能
         点到已经被换掉的节点（querySelector 拿到 null 就什么都不做），于是这次
         recall 整个落在上一个 Bot 名下——实测两种表现都出现过：该 Bot 的 recall
         文件根本不出现（null），或 count 归错人。改成点完必须等**标题 pill 真变成
         这个 Bot**（selectBotForChat 里 pill 与 activeBotId 同一同步块，pill 对了
         发送目标就对了），没变就再点一次。断言一个字没放松。 */
      const nameOf = (id) => {
        const b = (botsNow || []).find((x) => x && x.id === id) || {};
        return String(b.name || id).trim();
      };
      const openBot = async (id) => {
        const want = nameOf(id);
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
          await bootG23.win.evaluate((bid) => {
            const row = document.querySelector('#bot-list [data-agent-id="' + bid + '"]');
            if (row) row.click();
          }, id);
          const landed = await bootG23.win
            .waitForFunction(
              (n) => String((document.querySelector("#bot-pill .bot-pill-name") || {}).textContent || "").trim() === n,
              want,
              { timeout: 4000 },
            )
            .then(() => true)
            .catch(() => false);
          if (landed) return true;
          await bootG23.win.waitForTimeout(250);
        }
        return false;
      };
      const send = async (text) => {
        await bootG23.win.fill("#composer #text", text);
        await bootG23.win.press("#composer #text", "Enter");
        await bootG23.win.waitForFunction(
          (t) => (document.getElementById("log") || {}).innerText?.includes(t),
          text,
          { timeout: 45000 },
        ).catch(() => {});
      };

      await openBot(botA);
      await send(`remember ${memKey}=blue`);
      const wrote = await waitFor(() => {
        try {
          const s = JSON.parse(fs.readFileSync(MEM_STORE, "utf8"));
          const slot = s && s.bots && s.bots[botA];
          return slot && (slot.entries || []).some((e) => e.key === memKey) ? s : null;
        } catch (_) {
          return null;
        }
      }, 30000);
      wrote
        ? ok("E2E GP-111：在 Bot A 的私聊 remember 后，desktop-host.json 的 A 槽真实落盘")
        : bad("E2E GP-111 remember", "slot " + botA + " never got the key");

      const vaultA = (() => {
        try {
          return JSON.parse(fs.readFileSync(MEM_VAULT, "utf8"));
        } catch (_) {
          return {};
        }
      })();
      vaultA && vaultA.bots && vaultA.bots[botA] &&
        vaultA.bots[botA].entries && vaultA.bots[botA].entries[memKey]
        ? ok("E2E GP-111：profile-vault.json 同步记在 A 的槽里（两条路径同一归属）")
        : bad("E2E GP-112 vault slot", JSON.stringify(vaultA && vaultA.bots && Object.keys(vaultA.bots || {})).slice(0, 160));

      await openBot(botB);
      await send(`recall ${memKey}`);
      const recallB = await waitFor(() => {
        const rows = recallsOf(memKey).filter((r) => r.bot_id === botB);
        return rows.length ? rows[rows.length - 1] : null;
      }, 30000);
      recallB && recallB.count === 0
        ? ok("E2E GP-112：切到 Bot B 后 recall 命中 0 条（另一个 Bot 的上下文不可见）")
        : bad("E2E GP-112 isolation", JSON.stringify(recallB).slice(0, 200));

      await openBot(botA);
      await send(`recall ${memKey}`);
      const recallA = await waitFor(() => {
        const rows = recallsOf(memKey).filter((r) => r.bot_id === botA);
        return rows.length ? rows[rows.length - 1] : null;
      }, 30000);
      recallA && recallA.count >= 1 &&
        (recallA.entries || []).some((e) => e.key === memKey && e.value === "blue")
        ? ok("E2E GP-111：切回 Bot A 仍 recall 到同一条偏好（跨会话一致）")
        : bad("E2E GP-111 cross-session recall", JSON.stringify(recallA).slice(0, 200));

      const storeAfter = (() => {
        try {
          return JSON.parse(fs.readFileSync(MEM_STORE, "utf8"));
        } catch (_) {
          return {};
        }
      })();
      const slotA = ((storeAfter.bots || {})[botA] || {}).entries || [];
      const slotB = ((storeAfter.bots || {})[botB] || {}).entries || [];
      storeAfter.version === 2 &&
        slotA.some((e) => e.key === memKey) &&
        !slotB.some((e) => e.key === memKey)
        ? ok("E2E GP-112：store v2 里该键只出现在 A 槽、B 槽干净（磁盘层面的隔离）")
        : bad("E2E GP-112 store isolation", JSON.stringify({ v: storeAfter.version, a: slotA.length, b: slotB.length }).slice(0, 200));

      await shutdown(bootG23.app);
    } catch (e) {
      bad("E2E GP-111/112 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      if (memStoreBefore) fs.writeFileSync(MEM_STORE, memStoreBefore);
      else fs.rmSync(MEM_STORE, { force: true });
      if (memVaultBefore) fs.writeFileSync(MEM_VAULT, memVaultBefore);
      else fs.rmSync(MEM_VAULT, { force: true });
      for (const f of fs.existsSync(MEM_DIR) ? fs.readdirSync(MEM_DIR) : []) {
        if (f.endsWith(".json") && !memFilesBefore.includes(f)) {
          fs.rmSync(path.join(MEM_DIR, f), { force: true });
        }
      }
    }

    /* ---- GP-116..119 主窗口结构（官方 spec §2.1）----
       真实 UI：数侧边栏六个入口的 DOM 顺序、点 Marketplace 看模板是否来自
       Host 目录、在群组面板真建一个群 → #room-list 出现该行、给两个 Bot 各发
       一条消息看侧栏是否按真实活动重排、打开 Computer 右栏看 #log 是否被挤没。
       断言读的是真实 DOM 几何 + Host 落盘，不是源码字符串。*/
    const BOTS_PATH = dd("bots.json");
    const ROOMS_PATH = dd("rooms.json");
    const botsBefore = fs.existsSync(BOTS_PATH) ? fs.readFileSync(BOTS_PATH) : null;
    const roomsBefore = fs.existsSync(ROOMS_PATH) ? fs.readFileSync(ROOMS_PATH) : null;
    // GP-118 几何断言需要长列表：以前这条 pass 是靠上一轮测试留在 bots.json
    // 里的几十个 Bot 撑的（数据污染当夹具）。现在种子自己种——临时扩 80 个
    // Bot，finally 里用 botsBefore 原样还原，门禁不再依赖外部残留数据。
    try {
      const seed = botsBefore ? JSON.parse(botsBefore) : { version: 1, primary_id: "", bots: [] };
      if (!Array.isArray(seed.bots)) seed.bots = [];
      for (let i = 0; i < 80; i++) {
        const ts = new Date().toISOString();
        seed.bots.push({
          id: "e2e-seed-" + i, name: "SeedBot " + i, job: "gate seed", description: "",
          group: "", avatar: "", tags: [], hidden: false, pinned: false,
          created_at: ts, updated_at: ts,
        });
      }
      fs.writeFileSync(BOTS_PATH, JSON.stringify(seed, null, 2));
    } catch (_) { /* 种子失败时 listsScroll 如实失败，不掩盖 */ }
    try {
      const bootG24 = await launch({ BITBOT_LLM_STREAM: "0" });
      const win = bootG24.win;
      await win.waitForSelector("#bot-list [data-agent-id]", { timeout: 30000 });

      // 1) six entries, in order, footer last
      const shell = await win.evaluate(() => {
        const agents = document.getElementById("agents");
        const q = (id) => document.getElementById(id);
        const pos = (el) => {
          let n = 0;
          let p = el;
          while (p && p !== agents) {
            p = p.previousElementSibling;
            if (p) n++;
          }
          return n;
        };
        const footer = q("sidebar-footer");
        const order = ["bot-list", "room-list", "sidebar-footer"].map((id) =>
          q(id) ? pos(q(id)) : -1,
        );
        /* 真正的顺序判定用文档序，不用「各自身后有几个兄弟」——#room-list 在
           #sb-bots-rooms 里、footer 在 #agents 里，两个计数属于不同容器，
           G-28 #2 往容器里多插一个 #bot-strip 就会让两个数字撞在一起，
           把「顺序没错」误报成「顺序错」。 */
        const precedes = (a, b) => {
          const x = q(a);
          const y = q(b);
          return Boolean(x && y && (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING));
        };
        const orderOk = precedes("bot-list", "room-list") && precedes("room-list", "sidebar-footer");
        const sess = q("session-list");
        return {
          order,
          orderOk,
          sessionsInPopup: Boolean(sess && sess.closest("#sessions-popup")),
          sessionsStandalone: Boolean(sess && !sess.closest("#sessions-popup") && sess.closest("#agents") === agents),
          footerIsLast: Boolean(footer) && footer.lastElementChild !== null &&
            agents.lastElementChild === footer,
          footerIds: ["hidden-bots-lab", "connect-apps-btn", "marketplace-btn", "sidebar-settings-btn"]
            .map((id) => Boolean(q(id))),
          hiddenBadge: (q("hidden-bots-count") || {}).textContent || "",
          // GP-118 geometry: with 70+ Bots / 30+ rooms in the store the footer
          // must still be on screen — lists scroll in place, footer never pushed out.
          footerVisible: Boolean(footer) && (() => {
            const a = agents.getBoundingClientRect();
            const f = footer.getBoundingClientRect();
            return f.bottom <= a.bottom + 1 && f.top >= a.top - 1;
          })(),
          // GP-123: the sidebar is one scrolling column (like the reference);
          // long lists make #agents scroll while the sticky footer stays put.
          listsScroll: agents.scrollHeight > agents.clientHeight + 1,
        };
      });
      shell.orderOk
        ? ok("E2E GP-116：侧边栏顺序 = Bot 列表 → 群组列表 → 尾部区块")
        : bad("E2E GP-116 sidebar order", JSON.stringify({ order: shell.order, orderOk: shell.orderOk }));
      // G-28 契约更新：侧栏没有独立「会话」区块（用户口径：入口只有
      // Bot / 群 Bot）。会话列表必须在账户条弹层 #sessions-popup 里，且不是
      // #agents 的直属列表。
      shell.sessionsInPopup && !shell.sessionsStandalone
        ? ok("E2E GP-116：会话列表收在账户条 #sessions-popup（侧栏无会话区块）")
        : bad("E2E GP-116 sessions popup", JSON.stringify({ in: shell.sessionsInPopup, standalone: shell.sessionsStandalone }));
      shell.footerIsLast && shell.footerIds.every(Boolean)
        ? ok("E2E GP-118：#sidebar-footer 是侧栏最后一个块，含 Hidden / Connect apps / Marketplace / Settings")
        : bad("E2E GP-118 footer", JSON.stringify(shell).slice(0, 200));
      shell.footerVisible && shell.listsScroll
        ? ok("E2E GP-118：长列表让侧栏整体滚动，sticky 尾部区块仍在可视区内")
        : bad("E2E GP-118 footer geometry", JSON.stringify({ vis: shell.footerVisible, scroll: shell.listsScroll }));

      // 2) Marketplace really renders the Host catalog
      const tplFile = JSON.parse(
        fs.readFileSync(dd("bot-templates.json"), "utf8"),
      );
      const tplCount = ((tplFile.templates || tplFile) || []).length;
      // target-v2: Marketplace lives in the account popup (the footer #sb-more
      // is display:none under grok-ui). Drive the real user path.
      await win.click("#account-avatar-btn");
      await win.waitForSelector("#ap-market", { state: "visible", timeout: 5000 });
      await win.click("#ap-market");
      await win.waitForFunction(
        () => {
          const m = document.getElementById("marketplace-modal");
          return m && getComputedStyle(m).display !== "none" &&
            document.querySelectorAll("#mk-grid [data-template-id]").length > 0;
        },
        null,
        { timeout: 20000 },
      );
      const mk = await win.evaluate(() => ({
        cards: document.querySelectorAll("#mk-grid [data-template-id]").length,
        ids: Array.from(document.querySelectorAll("#mk-grid [data-template-id]")).map(
          (el) => el.dataset.templateId,
        ),
        meta: (document.getElementById("mk-meta") || {}).textContent || "",
      }));
      mk.cards === tplCount && mk.ids.length === tplCount
        ? ok("E2E GP-116：点 Marketplace 打开模板市场，卡片数 = Host 目录（" + tplCount + "）")
        : bad("E2E GP-116 marketplace", JSON.stringify(mk).slice(0, 220));
      await win.click("#mk-close");

      // 3) create a real group through the group panel → #room-list row
      const ids = await win.evaluate(() =>
        Array.from(document.querySelectorAll("#bot-list [data-agent-id]"))
          .map((el) => el.dataset.agentId)
          .slice(0, 2),
      );
      if (ids.length < 2) {
        bad("E2E GP-116 group list", "need two visible Bots");
      } else {
        const roomTitle = "E2E room " + Date.now().toString(36);
        await win.evaluate(() => {
          const panel = document.getElementById("gp-panel");
          if (panel) panel.style.display = "block";
          const tab = document.querySelector('[data-gptab="group"]');
          if (tab) tab.click();
        });
        await win.waitForSelector("#gp-room-members .gp-chip", { timeout: 10000 });
        await win.evaluate((memberIds) => {
          for (const id of memberIds) {
            const chip = Array.from(document.querySelectorAll("#gp-room-members .gp-chip")).find(
              (c) => c.textContent.trim() === id,
            );
            if (chip && !chip.classList.contains("active")) chip.click();
          }
        }, ids);
        // Chips show Bot names, so select by clicking the first two unselected chips.
        await win.evaluate(() => {
          const chips = Array.from(document.querySelectorAll("#gp-room-members .gp-chip"));
          let picked = 0;
          for (const c of chips) {
            if (picked >= 2) break;
            if (!c.classList.contains("active")) {
              c.click();
              picked++;
            }
          }
        });
        await win.fill("#gp-room-title", roomTitle);
        await win.click("#gp-room-create");
        await win.waitForFunction(
          (t) => {
            const box = document.getElementById("room-list");
            return box && Array.from(box.querySelectorAll("[data-room-id]")).some(
              (el) => (el.textContent || "").includes(t),
            );
          },
          roomTitle,
          { timeout: 45000 },
        ).catch(() => {});
        const roomRow = await win.evaluate((t) => {
          const box = document.getElementById("room-list");
          const rows = Array.from(box ? box.querySelectorAll("[data-room-id]") : []);
          const hit = rows.find((el) => (el.textContent || "").includes(t));
          return { count: rows.length, hit: Boolean(hit), meta: hit ? hit.querySelector(".meta").textContent : "" };
        }, roomTitle);
        roomRow.hit
          ? ok("E2E GP-116：新建群组后侧栏 #room-list 出现该群（" + roomRow.meta + "）")
          : bad("E2E GP-116 room row", JSON.stringify(roomRow).slice(0, 200));
        const roomsDisk = JSON.parse(fs.readFileSync(ROOMS_PATH, "utf8"));
        (roomsDisk.rooms || []).some((r) => r.title === roomTitle && (r.members || []).length >= 2)
          ? ok("E2E GP-116：该群真的落进 data/desktop/rooms.json（侧栏读同一份数据）")
          : bad("E2E GP-116 room disk", JSON.stringify(roomsDisk).slice(0, 200));
      }

      // 4) activity ordering: messaging a Bot moves it up the list
      const before = JSON.parse(fs.readFileSync(BOTS_PATH, "utf8")).bots || [];
      const visible = before.filter((b) => b && !b.hidden);
      const orderBefore = await win.evaluate(() =>
        Array.from(document.querySelectorAll("#bot-list [data-agent-id]")).map(
          (el) => el.dataset.agentId,
        ),
      );
      const target = visible.slice().reverse().find((b) => !b.pinned && orderBefore.includes(b.id));
      if (!target) {
        bad("E2E GP-117 order", "no unpinned Bot to message");
      } else {
        await win.evaluate((bid) => {
          const row = document.querySelector('#bot-list [data-agent-id="' + bid + '"]');
          if (row) row.click();
        }, target.id);
        await win.waitForTimeout(800);
        await win.fill("#composer #text", "ping activity ordering");
        await win.press("#composer #text", "Enter");
        await win.waitForFunction(
          () => (document.getElementById("log") || {}).innerText?.includes("ping activity ordering"),
          null,
          { timeout: 45000 },
        ).catch(() => {});
        const bumped = await (async () => {
          const t0 = Date.now();
          while (Date.now() - t0 < 30000) {
            try {
              const rows = JSON.parse(fs.readFileSync(BOTS_PATH, "utf8")).bots || [];
              const row = rows.find((b) => b.id === target.id);
              if (row && String(row.updated_at) > String(
                (before.find((b) => b.id === target.id) || {}).updated_at || "",
              )) return row;
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 250));
          }
          return null;
        })();
        /* 回合因为要审批而停住时，活动戳本来就不会动（Host 只在该 Bot 的回合
           真正结束后 touchBotActivity）。这不是活动戳坏了，是回合没走完 ——
           此时如实 SKIP，不把「环境没有 provider」记成回归。 */
        const parked = await win
          .evaluate(() =>
            /request_approval|需要你批准|等待批准|等待审批/.test(
              (document.getElementById("log") || {}).innerText || "",
            ),
          )
          .catch(() => false);
        if (bumped) {
          ok("E2E GP-117：私聊里发一条消息 → 该 Bot 的 updated_at 被真实刷新");
        } else if (parked) {
          skip(
            "E2E GP-117 activity stamp/reorder",
            "本轮回合停在审批上（环境无可用的 provider 回执），活动戳与侧栏重排无法判定",
          );
        } else {
          bad("E2E GP-117 activity stamp", "updated_at never moved for " + target.id);
        }
        if (bumped) {
          await win.waitForFunction(
            (bid) => {
              const rows = Array.from(document.querySelectorAll("#bot-list [data-agent-id]"));
              const pos = rows.findIndex((el) => el.dataset.agentId === bid);
              const firstUnpinned = rows.findIndex((el) => !/★/.test(el.textContent || ""));
              return pos >= 0 && pos <= firstUnpinned + 1;
            },
            target.id,
            { timeout: 20000 },
          ).then(() => true).catch(() => false)
            ? ok("E2E GP-117：侧栏无需手动刷新就把它排到未置顶 Bot 的最前面")
            : bad("E2E GP-117 reorder", "sidebar did not move " + target.id + " up");
        }
        const pinnedFirst = await win.evaluate(() =>
          Array.from(document.querySelectorAll("#bot-list [data-agent-id]")).map((el) => ({
            id: el.dataset.agentId,
            pinned: /★/.test(el.textContent || ""),
          })),
        );
        const seenUnpinned = pinnedFirst.findIndex((r) => !r.pinned);
        pinnedFirst.every((r, i) => (seenUnpinned < 0 ? true : i < seenUnpinned ? r.pinned : !r.pinned))
          ? ok("E2E GP-117：置顶 Bot 始终在未置顶 Bot 之前（pinned 优先于活动时间）")
          : bad("E2E GP-117 pinned block", JSON.stringify(pinnedFirst.slice(0, 6)));
      }

      // 5) Computer rail open must not squeeze the message stream to zero
      const widths = await win.evaluate(() => ({
        main: document.getElementById("main").getBoundingClientRect().width,
        log: document.getElementById("log").getBoundingClientRect().width,
        machines: document.getElementById("machines").getBoundingClientRect().width,
      }));
      await openComputerRail(win);
      await win.waitForFunction(
        () => document.body.classList.contains("computer-open"),
        null,
        { timeout: 10000 },
      ).catch(() => {});
      await win.waitForTimeout(400);
      const widthsOpen = await win.evaluate(() => ({
        main: document.getElementById("main").getBoundingClientRect().width,
        log: document.getElementById("log").getBoundingClientRect().width,
        rail: document.getElementById("computer-rail").getBoundingClientRect().width,
        machines: document.getElementById("machines").getBoundingClientRect().width,
        toolsOpen: document.body.classList.contains("tools-open"),
      }));
      widthsOpen.rail > 200 && widthsOpen.log > 200 && widthsOpen.main > 200
        ? ok("E2E GP-119：打开 Computer 右栏后中央消息流仍 > 200px（不被挤为 0）")
        : bad("E2E GP-119 rail squeeze", JSON.stringify({ before: widths, open: widthsOpen }).slice(0, 240));
      // The tools rail stays at its 0fr track, so only padding+border remain
      // (< 40px). Asserting "exactly 0" would just re-test the box model.
      widthsOpen.machines < 40 && !widthsOpen.toolsOpen &&
      widthsOpen.machines < widthsOpen.rail / 4
        ? ok("E2E GP-119：Computer 与工具右栏互不搭车（tools 仍关闭，只剩自身 padding）")
        : bad("E2E GP-119 rails coupled", JSON.stringify(widthsOpen).slice(0, 200));
      await closeComputerRail(win);
      await win.waitForFunction(
        () => !document.body.classList.contains("computer-open"),
        null,
        { timeout: 10000 },
      ).catch(() => {});

      await shutdown(bootG24.app);
    } catch (e) {
      bad("E2E GP-116..119 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      if (botsBefore) fs.writeFileSync(BOTS_PATH, botsBefore);
      if (roomsBefore) fs.writeFileSync(ROOMS_PATH, roomsBefore);
    }

    /* ---- GP-120..123 Bot 资料 / 创建流程 / 会话列表（官方 spec §2.2–§2.3）----
       真实 UI 驱动：新建对话框（Name 留空）→ Host 落成 "New Bot" 且自动开对话；
       右键 Bot → 编辑资料 → 改名/加标签 → 侧栏同步；给 Bot 设头像 → 侧栏出现
       <img>；会话列表按 今天/昨天/更早 分组、搜索框真过滤、重命名/删除走 Host。
       断言读真实 DOM + 真实落盘，不是源码字符串。*/
    const BOTS_M25 = dd("bots.json");
    const SESS_M25 = dd("sessions.json");
    const botsM25Before = fs.existsSync(BOTS_M25) ? fs.readFileSync(BOTS_M25) : null;
    const sessM25Before = fs.existsSync(SESS_M25) ? fs.readFileSync(SESS_M25) : null;
    try {
      const bootM25 = await launch({ BITBOT_LLM_STREAM: "0" });
      const win = bootM25.win;
      await win.waitForSelector("#bot-list [data-agent-id]", { timeout: 30000 });

      // 1) Create via the real dialog: blank Name → "New Bot", multi-line desc
      await win.click("#sess-new");
      await win.waitForSelector("#bot-edit-modal", { state: "visible", timeout: 5000 });
      const createMode = await win.evaluate(() => ({
        title: document.getElementById("bf-title").textContent,
        tagsHidden: document.getElementById("bf-tags-row").style.display === "none",
        avatarHidden: document.getElementById("bf-avatar-col").style.display === "none",
        name: document.getElementById("bc-name").value,
      }));
      createMode.tagsHidden && createMode.avatarHidden && createMode.name === ""
        ? ok("E2E GP-121：新建对话框只问 Name/Job/Description（标签/头像只在编辑态）")
        : bad("E2E GP-121 create mode", JSON.stringify(createMode));
      await win.fill("#bc-job", "QA Probe");
      await win.fill("#bc-desc", "line one\nline two");
      await win.click("#bc-create");
      await win.waitForSelector("#bot-edit-modal", { state: "hidden", timeout: 20000 }).catch(() => {});
      const createdId = await (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
          try {
            const rows = JSON.parse(fs.readFileSync(BOTS_M25, "utf8")).bots || [];
            const hit = rows.find((b) => (b.name === "新 Bot" || b.name === "New Bot") && b.job === "QA Probe");
            if (hit) return hit.id;
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 200));
        }
        return "";
      })();
      createdId
        ? ok("E2E GP-121：Name 留空 → Host 真建出 \"New Bot\"（占位名来自 Host，不是假字）")
        : bad("E2E GP-121 placeholder", "no New Bot in bots.json");
      const createdRow = createdId
        ? (JSON.parse(fs.readFileSync(BOTS_M25, "utf8")).bots || []).find((b) => b.id === createdId)
        : null;
      createdRow && createdRow.description === "line one\nline two"
        ? ok("E2E GP-121：多行 Description 原样保存（换行没被压平成空格）")
        : bad("E2E GP-121 multiline", JSON.stringify(createdRow && createdRow.description));
      const autoOpened = await win
        .waitForFunction(
          () =>
            ["新 Bot", "New Bot"].includes(String((document.querySelector("#bot-pill .bot-pill-name") || {}).textContent || "").trim()),
          null,
          { timeout: 25000 },
        )
        .then(() => true)
        .catch(() => false);
      autoOpened
        ? ok("E2E GP-121：创建完成后自动打开该 Bot 的对话（标题 pill = New Bot）")
        : bad(
            "E2E GP-121 auto-open",
            String(await win.evaluate(() => (document.querySelector("#bot-pill .bot-pill-name") || {}).textContent)),
          );

      // 2) Edit Profile from the real right-click menu: name + tags persist
      if (createdId) {
        await win.click('#bot-list [data-agent-id="' + createdId + '"]', { button: "right" });
        await win.waitForSelector(".composer-menu:not([hidden])", { timeout: 5000 });
        await win.locator('.composer-menu:not([hidden]) [data-menu="edit"]').click(); // Edit Profile
        await win.waitForSelector("#bot-edit-modal", { state: "visible", timeout: 5000 });
        const editMode = await win.evaluate(() => ({
          name: document.getElementById("bc-name").value,
          tagsVisible: document.getElementById("bf-tags-row").style.display !== "none",
          avatarVisible: document.getElementById("bf-avatar-col").style.display !== "none",
          saveLabel: document.getElementById("bc-create").textContent,
        }));
        ["新 Bot", "New Bot"].includes(editMode.name) && editMode.tagsVisible && editMode.avatarVisible
          ? ok("E2E GP-120：编辑资料预填真实名称，并显示 标签 / 头像 字段")
          : bad("E2E GP-120 edit prefill", JSON.stringify(editMode));
        await win.fill("#bc-name", "Piper UI");
        await win.fill("#bc-tags", "perf, research");
        await win.click("#bc-create");
        await win.waitForSelector("#bot-edit-modal", { state: "hidden", timeout: 20000 }).catch(() => {});
        const edited = await (async () => {
          const t0 = Date.now();
          while (Date.now() - t0 < 20000) {
            try {
              const rows = JSON.parse(fs.readFileSync(BOTS_M25, "utf8")).bots || [];
              const hit = rows.find((b) => b.id === createdId);
              if (hit && hit.name === "Piper UI") return hit;
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 200));
          }
          return null;
        })();
        edited && Array.isArray(edited.tags) && edited.tags.join(",") === "perf,research"
          ? ok("E2E GP-120：改名 + 标签真写进 bots.json（标签不是只显示在表单里）")
          : bad("E2E GP-120 persist", JSON.stringify(edited && { name: edited.name, tags: edited.tags }));
        // 侧栏行是异步重绘的：改名落盘那一瞬 DOM 可能正被重建，单次 evaluate 会
        // 读到 null（实测：紧跟着的 GP-122 查同一行又查得到）。轮询到「行里就是
        // 新名字 + 新标签」为止；断言本身一个字没放松，只是不再抽查一次就当失败。
        let rowView = null;
        {
          const t0 = Date.now();
          while (Date.now() - t0 < 10000) {
            rowView = await win.evaluate((bid) => {
              const row = document.querySelector('#bot-list [data-agent-id="' + bid + '"]');
              return row
                ? { name: (row.querySelector(".name") || {}).textContent || "", meta: (row.querySelector(".meta") || {}).textContent || "" }
                : null;
            }, createdId);
            if (rowView && rowView.name.includes("Piper UI")
              && rowView.meta.includes("#perf") && rowView.meta.includes("#research")) break;
            await new Promise((r) => setTimeout(r, 200));
          }
        }
        rowView && rowView.name.includes("Piper UI") && rowView.meta.includes("#perf") && rowView.meta.includes("#research")
          ? ok("E2E GP-120：侧栏行立即同步新名称与标签（无需重启）")
          : bad("E2E GP-120 sidebar", JSON.stringify(rowView));

        // 3) Avatar: real file → data URL → <img> in the sidebar row
        const avatarPath = path.join(require("os").tmpdir(), "m25-e2e-avatar.png");
        fs.writeFileSync(
          avatarPath,
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        );
        await win.evaluate(
          ({ id, p }) =>
            window.bitbot.bots.op({ phrase: "update bot " + id + " avatar=" + p }),
          { id: createdId, p: avatarPath },
        );
        await win.evaluate(() => refreshBots());
        const avatarShown = await win
          .waitForSelector('#bot-list [data-agent-id="' + createdId + '"] .sess-avatar img', {
            timeout: 10000,
          })
          .then(() => true)
          .catch(() => false);
        avatarShown
          ? ok("E2E GP-122：保存的头像被侧栏渲染成真实 <img>（data URL，不依赖 file://）")
          : bad("E2E GP-122 avatar img", "no img in the Bot row");
      }

      // 4) Session list: date groups + live search + rename + delete
      const groups = await win.evaluate(() =>
        Array.from(document.querySelectorAll("#session-list .sess-group")).map((e) => e.textContent),
      );
      const rowsNow = await win.evaluate(
        () => document.querySelectorAll("#session-list [data-session-id]").length,
      );
      groups.length >= 1 && rowsNow >= 1
        ? ok("E2E GP-123：会话列表按 今天/昨天/更早 分组（" + groups.join(" / ") + "）")
        : bad("E2E GP-123 groups", JSON.stringify(groups));
      // #session-search is hidden until the sidebar search toggle reveals it
      // (matches the real product: the search button or Cmd/Ctrl+K).
      await win.click("#sidebar-search-toggle");
      await win.waitForSelector("#session-search:not([hidden])", { timeout: 5000 });
      await win.fill("#session-search", "zzz-no-such-session-xyz");
      await win.waitForTimeout(250);
      const filtered = await win.evaluate(() => ({
        rows: document.querySelectorAll("#session-list [data-session-id]").length,
        text: String(document.getElementById("session-list").textContent || ""),
      }));
      filtered.rows === 0 && filtered.text.trim().length > 0
        ? ok("E2E GP-123：搜索框实时过滤；无命中时给出空态而不是残留旧行")
        : bad("E2E GP-123 search", JSON.stringify(filtered).slice(0, 200));
      await win.fill("#session-search", "");
      await win.waitForTimeout(250);
      const rowsBack = await win.evaluate(
        () => document.querySelectorAll("#session-list [data-session-id]").length,
      );
      rowsBack === rowsNow
        ? ok("E2E GP-123：清空搜索后原会话列表完整恢复")
        : bad("E2E GP-123 search clear", rowsBack + " vs " + rowsNow);

      // The DM session title follows the "<bot name> · DM" convention, so the
      // name is whatever the Host actually created (localized defaultBotName:
      // "新 Bot" under zh-CN). Derive from the created bot, never assume English.
      // Use the name captured at CREATION time (createdRow), not a fresh
      // bots.json read: GP-120 renames the Bot afterwards, but the DM session
      // keeps its creation-time "<name> · DM" title (sessions don't cascade).
      const dmTitle = ((createdRow && createdRow.name) || "New Bot") + " · DM";
      const sessFile = JSON.parse(fs.readFileSync(SESS_M25, "utf8"));
      const dm = (sessFile.sessions || []).find((s) => s.title === dmTitle);
      if (!dm) {
        bad("E2E GP-123 rename target", dmTitle + " session missing");
      } else {
        await openSessionsPopup(win);
      await win.click('#session-list [data-session-id="' + dm.id + '"]', { button: "right" });
        await win.waitForSelector(".composer-menu:not([hidden])", { timeout: 5000 });
        await win.locator(".composer-menu:not([hidden]) button").nth(0).click(); // Rename
        await win.waitForSelector("#session-rename-modal", { state: "visible", timeout: 5000 });
        const prefill = await win.evaluate(() => document.getElementById("sr-title").value);
        prefill === dmTitle
          ? ok("E2E GP-123：重命名对话框预填当前标题")
          : bad("E2E GP-123 rename prefill", prefill);
        await win.fill("#sr-title", "E2E Renamed Chat");
        await win.click("#sr-save");
        const renamed = await (async () => {
          const t0 = Date.now();
          while (Date.now() - t0 < 15000) {
            try {
              const f = JSON.parse(fs.readFileSync(SESS_M25, "utf8"));
              const hit = (f.sessions || []).find((s) => s.id === dm.id);
              if (hit && hit.title === "E2E Renamed Chat") return hit;
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 200));
          }
          return null;
        })();
        renamed
          ? ok("E2E GP-123：重命名真写进 sessions.json（Host IPC，不是本地假改）")
          : bad("E2E GP-123 rename persist", "title never changed");
        const rowTitle = await win.evaluate((sid) => {
          const row = document.querySelector('#session-list [data-session-id="' + sid + '"]');
          return row ? (row.querySelector(".name") || {}).textContent : null;
        }, dm.id);
        rowTitle === "E2E Renamed Chat"
          ? ok("E2E GP-123：侧栏行同步显示新标题")
          : bad("E2E GP-123 rename row", String(rowTitle));

        await openSessionsPopup(win);
      await win.click('#session-list [data-session-id="' + dm.id + '"]', { button: "right" });
        await win.waitForSelector(".composer-menu:not([hidden])", { timeout: 5000 });
        await win.locator(".composer-menu:not([hidden]) button").nth(1).click(); // Delete
        await win.waitForSelector("#session-delete-modal", { state: "visible", timeout: 5000 });
        const delWarn = await win.evaluate(() => {
          const m = document.getElementById("session-delete-modal");
          return { target: String((document.getElementById("sd-target") || {}).textContent || ""), text: String(m.textContent || "") };
        });
        delWarn.text.length > 0 && delWarn.target.includes("E2E Renamed Chat")
          ? ok("E2E GP-123：删除前有确认对话框并点名会话（明示不可恢复）")
          : bad("E2E GP-123 delete dialog", JSON.stringify(delWarn).slice(0, 200));
        await win.click("#sd-go");
        const gone = await (async () => {
          const t0 = Date.now();
          while (Date.now() - t0 < 15000) {
            try {
              const f = JSON.parse(fs.readFileSync(SESS_M25, "utf8"));
              if (!(f.sessions || []).some((s) => s.id === dm.id)) return true;
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 200));
          }
          return false;
        })();
        await win.waitForTimeout(300);
        const rowGone = await win.evaluate(
          (sid) => !document.querySelector('#session-list [data-session-id="' + sid + '"]'),
          dm.id,
        );
        gone && rowGone
          ? ok("E2E GP-123：确认删除后会话从 sessions.json 与侧栏一起消失")
          : bad("E2E GP-123 delete gone", JSON.stringify({ gone, rowGone }));
      }

      await shutdown(bootM25.app);
    } catch (e) {
      bad("E2E GP-120..123 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      if (botsM25Before) fs.writeFileSync(BOTS_M25, botsM25Before);
      if (sessM25Before) fs.writeFileSync(SESS_M25, sessM25Before);
    }

    /* ---- GP-124..127 Bot 设置右栏（官方 spec §2.1 右侧面板 / §4.6 通知）----
       真实 UI 驱动：右键 Bot →「Bot 设置」→ #bot-rail 打开且资料与 bots.json
       一致；通知开关真写 settings.notify；开关关闭时 notify:turn 不再弹
       （bot_notify_off / 聚焦抑制都会 shown:false）；Computer 预览与 Bot 设置
       互斥；面板内 Pin/Unpin 真改 bots.json 且侧栏同步。断言读真实 DOM +
       真实落盘。*/
    const BOTS_M26 = dd("bots.json");
    const SET_M26 = dd("settings.json");
    const botsM26Before = fs.existsSync(BOTS_M26) ? fs.readFileSync(BOTS_M26) : null;
    const setM26Before = fs.existsSync(SET_M26) ? fs.readFileSync(SET_M26) : null;
    try {
      const bootM26 = await launch({ BITBOT_LLM_STREAM: "0" });
      const win = bootM26.win;
      await win.waitForSelector("#bot-list [data-agent-id]", { timeout: 30000 });

      // 1) Right-click first Bot →「Bot 设置」→ rail opens
      const m26BotId = await win.evaluate(
        () => document.querySelector("#bot-list [data-agent-id]").dataset.agentId,
      );
      await win.click('#bot-list [data-agent-id="' + m26BotId + '"]', { button: "right" });
      await win.waitForSelector(".composer-menu:not([hidden])", { timeout: 5000 });
      await win.locator('.composer-menu:not([hidden]) [data-menu="settings"]').click();
      await win.waitForFunction(
        () => document.body.classList.contains("bot-open") &&
          document.getElementById("bot-rail").getBoundingClientRect().width > 200,
        null,
        { timeout: 10000 },
      ).catch(() => {});
      const railOpened = await win.evaluate(() => ({
        open: document.body.classList.contains("bot-open"),
        width: document.getElementById("bot-rail").getBoundingClientRect().width,
        name: (document.getElementById("br-name") || {}).textContent || "",
        job: (document.getElementById("br-job") || {}).textContent || "",
        chips: document.querySelectorAll("#br-tags .gp-chip").length,
        stats: document.querySelectorAll("#br-stats .br-row").length,
        actions: document.querySelectorAll("#br-actions .bb-btn").length,
        notify: document.getElementById("br-notify") ? document.getElementById("br-notify").checked : null,
        logWidth: document.getElementById("log").getBoundingClientRect().width,
      }));
      const m26Row = (JSON.parse(fs.readFileSync(BOTS_M26, "utf8")).bots || []).find((b) => b.id === m26BotId) || {};
      railOpened.open && railOpened.width > 200
        ? ok("E2E GP-124：右键菜单打开 Bot 设置右栏（真实 #bot-rail 可见）")
        : bad("E2E GP-124 rail open", JSON.stringify(railOpened).slice(0, 200));
      railOpened.name === (m26Row.name || m26BotId) && railOpened.stats === 4 && railOpened.actions >= 4
        ? ok("E2E GP-125：面板资料与 bots.json 一致，统计 4 行、操作条就位")
        : bad("E2E GP-125 panel data", JSON.stringify({ rail: railOpened, row: { name: m26Row.name } }).slice(0, 240));
      railOpened.logWidth > 200
        ? ok("E2E GP-124：右栏打开后中央消息流仍 > 200px")
        : bad("E2E GP-124 log squeezed", String(railOpened.logWidth));
      // 旧行可能没有 tags 字段（M25 之前创建）；Host decorateBot 会补 []。
      const m26Tags = Array.isArray(m26Row.tags) ? m26Row.tags : [];
      railOpened.chips === m26Tags.length
        ? ok("E2E GP-125：标签 chips 数量与 bots.json 一致（" + m26Tags.length + "）")
        : bad("E2E GP-125 tags chips", JSON.stringify({ chips: railOpened.chips, tags: m26Row.tags }));

      // 2) §4.6 per-Bot notification toggle writes settings.notify, and the
      //    turn notification really stays hidden while it is off.
      await win.click("#br-notify");
      const notifyOff = await (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) {
          try {
            const st = JSON.parse(fs.readFileSync(SET_M26, "utf8"));
            if (st.notify && st.notify[m26BotId] === false) return true;
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      })();
      notifyOff
        ? ok("E2E GP-126：关掉面板开关 → settings.json notify." + m26BotId + "=false")
        : bad("E2E GP-126 notify off", "settings.json never got false");
      const turnRes = await win.evaluate(
        (id) => window.bitbot.notify.turn({ bot_id: id, title: "M26", body: "probe", session_id: null }),
        m26BotId,
      );
      turnRes && turnRes.shown === false && (turnRes.reason === "bot_notify_off" || turnRes.reason === "window_focused")
        ? ok("E2E GP-126：开关关闭后回合通知不再弹出（shown:false, reason=" + turnRes.reason + "）")
        : bad("E2E GP-126 notify turn", JSON.stringify(turnRes).slice(0, 200));
      await win.click("#br-notify");
      const notifyOn = await (async () => {
        const t0 = Date.now();
        while (Date.now() - t0 < 8000) {
          try {
            const st = JSON.parse(fs.readFileSync(SET_M26, "utf8"));
            if (!st.notify || st.notify[m26BotId] !== false) return true;
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 200));
        }
        return false;
      })();
      notifyOn
        ? ok("E2E GP-126：重新打开开关 → settings.notify 恢复")
        : bad("E2E GP-126 notify on", "settings.json still false");

      // 3) Mutual exclusion: opening the Computer preview closes the Bot rail.
      await openComputerRail(win);
      await win.waitForFunction(
        () => document.body.classList.contains("computer-open"),
        null,
        { timeout: 10000 },
      ).catch(() => {});
      await win.waitForTimeout(300);
      const excl = await win.evaluate(() => ({
        computer: document.body.classList.contains("computer-open"),
        bot: document.body.classList.contains("bot-open"),
        railW: document.getElementById("computer-rail").getBoundingClientRect().width,
      }));
      excl.computer && !excl.bot && excl.railW > 200
        ? ok("E2E GP-124：打开 Computer 预览自动收起 Bot 设置（同一可选右栏）")
        : bad("E2E GP-124 mutual exclusion", JSON.stringify(excl));
      await closeComputerRail(win);
      await win.waitForFunction(
        () => !document.body.classList.contains("computer-open"),
        null,
        { timeout: 10000 },
      ).catch(() => {});

      // 4) Panel actions drive the same Host phrases: Pin → bots.json pinned.
      // Re-open the rail via the menu (state is deterministic this way).
      await win.click('#bot-list [data-agent-id="' + m26BotId + '"]', { button: "right" });
      await win.waitForSelector(".composer-menu:not([hidden])", { timeout: 5000 });
      await win.locator('.composer-menu:not([hidden]) [data-menu="settings"]').click();
      await win.waitForFunction(
        () => document.body.classList.contains("bot-open"),
        null,
        { timeout: 10000 },
      ).catch(() => {});
      // Actions order: Edit / Pin·Unpin / Duplicate / Hide / Delete. The pin
      // button toggles its label with the current state, so assert on the
      // toggle relative to the value we read before clicking.
      const pinnedBefore = Boolean(m26Row.pinned);
      if (railOpened.actions >= 4) {
        await win.evaluate(() => {
          document.querySelectorAll("#br-actions .bb-btn")[1].click();
        });
        const toggled = await (async () => {
          const t0 = Date.now();
          while (Date.now() - t0 < 15000) {
            try {
              const rows = JSON.parse(fs.readFileSync(BOTS_M26, "utf8")).bots || [];
              const hit = rows.find((b) => b.id === m26BotId);
              if (hit && Boolean(hit.pinned) === !pinnedBefore) return true;
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 300));
          }
          return false;
        })();
        toggled
          ? ok("E2E GP-127：面板内置顶按钮真写 bots.json（pinned " + pinnedBefore + " → " + !pinnedBefore + "，与侧栏菜单同一条 Host 短语）")
          : bad("E2E GP-127 pin toggle", "bots.json pinned never became " + !pinnedBefore);
        // Toggle back so the store ends where it started.
        await win.waitForFunction(
          () => document.body.classList.contains("bot-open"),
          null,
          { timeout: 10000 },
        ).catch(() => {});
        // 置顶按钮在一轮 Host 回合里是 disabled 的（防连点）。第一次点击后
        // bots.json 会先变，但面板要等 runUserTurn + refreshBots + refreshBotRail
        // 全跑完才会重新可用；不等就点，点到的是已禁用的旧按钮，等于没点。
        await win.waitForFunction(
          () => {
            const b = document.querySelectorAll("#br-actions .bb-btn")[1];
            return Boolean(b) && !b.disabled;
          },
          null,
          { timeout: 30000 },
        ).catch(() => {});
        await win.evaluate(() => {
          document.querySelectorAll("#br-actions .bb-btn")[1].click();
        });
        const reverted = await (async () => {
          const t0 = Date.now();
          while (Date.now() - t0 < 15000) {
            try {
              const rows = JSON.parse(fs.readFileSync(BOTS_M26, "utf8")).bots || [];
              const hit = rows.find((b) => b.id === m26BotId);
              if (hit && Boolean(hit.pinned) === pinnedBefore) return true;
            } catch (_) {}
            await new Promise((r) => setTimeout(r, 300));
          }
          return false;
        })();
        reverted
          ? ok("E2E GP-127：再点一次恢复原状（面板按钮与侧栏菜单同源）")
          : bad("E2E GP-127 pin revert", "bots.json pinned never returned to " + pinnedBefore);
      } else {
        bad("E2E GP-127 pin button", "no pin button in #br-actions");
      }

      await shutdown(bootM26.app);
    } catch (e) {
      bad("E2E GP-124..127 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      if (botsM26Before) fs.writeFileSync(BOTS_M26, botsM26Before);
      if (setM26Before) fs.writeFileSync(SET_M26, setM26Before);
    }

    /* ---- GP-128/129 对话详情右栏（官方 spec §2.1 右栏第三种内容）----
       新建会话 → 发一条真消息 → 右键会话行「对话详情」→ #conv-rail 字段与
       sessions.json 该行逐项相等；三方互斥（conv / bot / computer）；面板内
       重命名真改 store；删除会话后详情面板自动关闭。*/
    const SESS_M27 = dd("sessions.json");
    const sessM27Before = fs.existsSync(SESS_M27) ? fs.readFileSync(SESS_M27) : null;
    // M27 原来裸跑真 LLM：无外网/无 key 时回合静默失败 → "probe session never
    // reached the store"。照 GP-14 的模式自带 echo stub，门禁不再依赖环境。
    let m27Stub = null;
    try {
      const { spawn: spawnChild } = require("node:child_process");
      m27Stub = spawnChild(
        process.execPath,
        [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
        {
          cwd: REPO,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, BITBOT_STUB_PORT: "8796", BITBOT_STUB_ECHO_ALL: "1" },
        },
      );
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("stub boot timeout")), 8000);
        m27Stub.stdout.on("data", (d) => {
          if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(); }
        });
        m27Stub.on("error", rej);
      });
      const bootM27 = await launch({
        BITBOT_LLM_STREAM: "0",
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:8796/v1",
        BITBOT_LLM_API_KEY: "e2e-stub-key",
        BITBOT_LLM_MODEL: "e2e-stub",
      });
      const win = bootM27.win;
      await win.waitForSelector("#composer #text", { timeout: 30000 });

      // 1) A fresh chat with one real turn so the details have real numbers.
      await win.evaluate(() => window.bbUi.newSession());
      await win.waitForTimeout(400);
      await win.fill("#composer #text", "M27 详情探针消息");
      await win.press("#composer #text", "Enter");
      await win.waitForFunction(
        () => document.querySelectorAll("#log .msg.assistant").length > 0,
        null,
        { timeout: 30000 },
      ).catch(() => {});
      await win.waitForTimeout(800);
      const m27SessionId = await (async () => {
        try {
          const st = JSON.parse(fs.readFileSync(SESS_M27, "utf8"));
          const hit = (st.sessions || []).find((x) => (x.messages || []).some((m) =>
            m && m.role === "user" && String(m.text || "").includes("M27 详情探针")));
          return hit ? hit.id : "";
        } catch (_) { return ""; }
      })();
      if (m27SessionId) {
        const rowSel = '#session-list [data-session-id="' + m27SessionId + '"]';
        await win.waitForSelector(rowSel, { timeout: 10000 }).catch(() => {});

        // 2) Right-click the row → last menu item = 对话详情 → #conv-rail opens
        await openSessionsPopup(win);
        await win.click(rowSel, { button: "right" });
        await win.waitForSelector(".composer-menu:not([hidden])", { timeout: 5000 });
        await win.locator(".composer-menu:not([hidden]) > button").last().click();
        await win.waitForFunction(
          () => document.body.classList.contains("conv-open") &&
            document.getElementById("conv-rail").getBoundingClientRect().width > 200,
          null,
          { timeout: 10000 },
        ).catch(() => {});
        // refreshConvRail 是异步取数：等面板真的渲染出标题再断言。
      await win.waitForFunction(
        () => ((document.getElementById("cv-name") || {}).textContent || "").length > 0,
        null,
        { timeout: 10000 },
      ).catch(() => {});
      const convOpened = await win.evaluate(() => ({
          open: document.body.classList.contains("conv-open"),
          width: document.getElementById("conv-rail").getBoundingClientRect().width,
          title: (document.getElementById("cv-name") || {}).textContent || "",
          kvs: document.querySelectorAll("#cv-kvs .cv-kv").length,
          preview: (document.getElementById("cv-preview") || {}).textContent || "",
          logWidth: document.getElementById("log").getBoundingClientRect().width,
        }));
        const m27Row = (JSON.parse(fs.readFileSync(SESS_M27, "utf8")).sessions || []).find((x) => x.id === m27SessionId) || {};
        const m27Msgs = m27Row.messages || [];
        convOpened.open && convOpened.width > 200
          ? ok("E2E GP-128：右键会话 → 对话详情右栏打开（真实 #conv-rail）")
          : bad("E2E GP-128 rail open", JSON.stringify(convOpened).slice(0, 200));
        convOpened.title === (m27Row.title || "")
          ? ok("E2E GP-128：面板标题与 sessions.json 一致（" + m27Row.title + "）")
          : bad("E2E GP-128 title", JSON.stringify({ panel: convOpened.title, store: m27Row.title }));
        convOpened.kvs === 5 && convOpened.logWidth > 200
          ? ok("E2E GP-128：信息 5 行（归属/创建/更新/消息数/回复数）且中央消息流仍 > 200px")
          : bad("E2E GP-128 kvs/geometry", JSON.stringify({ kvs: convOpened.kvs, log: convOpened.logWidth }));
        const expectPreview = m27Msgs.length
          ? "[" + m27Msgs[m27Msgs.length - 1].role + "] " + String(m27Msgs[m27Msgs.length - 1].text || "").slice(0, 400)
          : "";
        convOpened.preview === expectPreview && m27Msgs.length > 0
          ? ok("E2E GP-128：「最近一条」与 store 的最后一行逐字一致（" + m27Msgs.length + " 条消息）")
          : bad("E2E GP-128 preview", JSON.stringify({ panel: convOpened.preview.slice(0, 80), expect: expectPreview.slice(0, 80) }));

        // 3) Three-way exclusion: opening Bot settings closes the details rail.
        const botIdM27 = await win.evaluate(
          () => document.querySelector("#bot-list [data-agent-id]").dataset.agentId,
        );
        await win.click('#bot-list [data-agent-id="' + botIdM27 + '"]', { button: "right" });
        await win.waitForSelector(".composer-menu:not([hidden])", { timeout: 5000 });
        // Bot 菜单瘦身后最后一项是「删除…」，这里要的是「Bot 设置」→ 按 data-menu 寻址。
        await win.locator('.composer-menu:not([hidden]) [data-menu="settings"]').click();
        await win.waitForFunction(
          () => document.body.classList.contains("bot-open"),
          null,
          { timeout: 10000 },
        ).catch(() => {});
        await win.waitForTimeout(300);
        const excl27 = await win.evaluate(() => ({
          bot: document.body.classList.contains("bot-open"),
          conv: document.body.classList.contains("conv-open"),
        }));
        excl27.bot && !excl27.conv
          ? ok("E2E GP-128：打开 Bot 设置自动收起对话详情（同一可选右栏）")
          : bad("E2E GP-128 exclusion", JSON.stringify(excl27));

        // 4) Rename from the details rail writes the store and refreshes the panel.
        await openSessionsPopup(win);
        await win.click(rowSel, { button: "right" });
        await win.waitForSelector(".composer-menu:not([hidden])", { timeout: 5000 });
        await win.locator(".composer-menu:not([hidden]) > button").last().click();
        await win.waitForFunction(() => document.body.classList.contains("conv-open"), null, { timeout: 10000 }).catch(() => {});
        await win.waitForFunction(
          () => document.querySelectorAll("#cv-actions .bb-btn").length > 0,
          null,
          { timeout: 10000 },
        ).catch(() => {});
        const renameBtnIdx = await win.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("#cv-actions .bb-btn"));
          return btns.findIndex((b) => /重命名|重新命名|Rename/.test(b.textContent || ""));
        });
        if (renameBtnIdx >= 0) {
          await win.evaluate((i) => {
            document.querySelectorAll("#cv-actions .bb-btn")[i].click();
          }, renameBtnIdx);
          await win.waitForSelector("#session-rename-modal", { state: "visible", timeout: 5000 });
          await win.fill("#sr-title", "M27 重命名后的对话");
          await win.click("#sr-save");
          const renamed = await (async () => {
            const t0 = Date.now();
            while (Date.now() - t0 < 10000) {
              try {
                const rows = JSON.parse(fs.readFileSync(SESS_M27, "utf8")).sessions || [];
                const hit = rows.find((x) => x.id === m27SessionId);
                if (hit && hit.title === "M27 重命名后的对话") return true;
              } catch (_) {}
              await new Promise((r) => setTimeout(r, 200));
            }
            return false;
          })();
          // 面板标题随动是异步重拉：等它真的变成新标题。
          await win.waitForFunction(
            () => ((document.getElementById("cv-name") || {}).textContent || "") === "M27 重命名后的对话",
            null,
            { timeout: 10000 },
          ).catch(() => {});
          const panelTitle = await win.evaluate(
            () => (document.getElementById("cv-name") || {}).textContent || "",
          );
          renamed && panelTitle === "M27 重命名后的对话"
            ? ok("E2E GP-129：详情面板内重命名真写 sessions.json 且面板标题随动")
            : bad("E2E GP-129 rename", JSON.stringify({ renamed, panelTitle }).slice(0, 200));
        } else {
          bad("E2E GP-129 rename button", "no rename button in #cv-actions");
        }

        // 5) Deleting the chat closes its details rail.
        await openSessionsPopup(win);
        await win.click('#session-list [data-session-id="' + m27SessionId + '"]', { button: "right" });
        await win.waitForSelector(".composer-menu:not([hidden])", { timeout: 5000 });
        const menuBtns = await win.evaluate(() =>
          Array.from(document.querySelectorAll('.composer-menu[data-session-menu] button')).map((b) => b.textContent || ""),
        );
        const delIdx = menuBtns.findIndex((t) => /删除/.test(t));
        await win.evaluate((i) => {
          const btns = document.querySelectorAll('.composer-menu[data-session-menu] button');
          btns[i].click();
        }, delIdx);
        await win.waitForSelector("#session-delete-modal", { state: "visible", timeout: 5000 });
        await win.click("#sd-go");
        const railClosed = await (async () => {
          const t0 = Date.now();
          while (Date.now() - t0 < 10000) {
            const st = await win.evaluate(() => document.body.classList.contains("conv-open"));
            if (!st) {
              try {
                const rows = JSON.parse(fs.readFileSync(SESS_M27, "utf8")).sessions || [];
                if (!rows.some((x) => x.id === m27SessionId)) return true;
              } catch (_) { return true; }
            }
            await new Promise((r) => setTimeout(r, 200));
          }
          return false;
        })();
        railClosed
          ? ok("E2E GP-129：删除会话后详情面板自动关闭且会话从 store 消失")
          : bad("E2E GP-129 delete close", "rail still open or session not removed");
      } else {
        bad("E2E GP-128 session", "M27 probe session never reached the store");
      }

      await shutdown(bootM27.app);
    } catch (e) {
      bad("E2E GP-128/129 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      if (m27Stub) {
        try { m27Stub.kill("SIGKILL"); } catch (_) {}
      }
      if (sessM27Before) fs.writeFileSync(SESS_M27, sessM27Before);
    }

    /* ---- GP-130/131 Usage & Billing 接真回合（官方 spec §7.1）----
       自带 stub（回包带 usage 11/7）跑一回合真消息 → llm-usage.json 出现
       e2e-stub 行（requests≥1，tokens 为 11/7 的倍数，不伪造）；再开设置 →
       Usage & Billing tab，面板 per-row 行显示同一 provider/model。*/
    const USAGE_M28 = dd("llm-usage.json");
    const usageM28Before = fs.existsSync(USAGE_M28) ? fs.readFileSync(USAGE_M28) : null;
    const m28Port = 8795;
    let m28Stub = null;
    try {
      const { spawn: spawnChild } = require("node:child_process");
      m28Stub = spawnChild(
        process.execPath,
        [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
        {
          cwd: REPO,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, BITBOT_STUB_PORT: String(m28Port) },
        },
      );
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("m28 stub boot timeout")), 8000);
        m28Stub.stdout.on("data", (d) => {
          if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(); }
        });
        m28Stub.on("error", rej);
      });
      const bootM28 = await launch({
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + m28Port + "/v1",
        BITBOT_LLM_API_KEY: "e2e-stub-key",
        BITBOT_LLM_MODEL: "e2e-stub",
        BITBOT_LLM_STREAM: "0",
      });
      const win = bootM28.win;
      await win.waitForSelector("#composer #text", { timeout: 30000 });
      await win.fill("#composer #text", "M28 usage 探针消息");
      await win.press("#composer #text", "Enter");
      await win.waitForFunction(
        () => document.querySelectorAll("#log .msg.assistant").length > 0,
        null,
        { timeout: 45000 },
      );
      // usage 落盘是异步事件链（llm-stream → recordUsage），轮询 store。
      const m28Row = await (async () => {
        for (let i = 0; i < 30; i++) {
          try {
            const st = JSON.parse(fs.readFileSync(USAGE_M28, "utf8"));
            const row = (st.rows || []).find((r) => r.model === "e2e-stub" && r.requests > 0);
            if (row) return row;
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 300));
        }
        return null;
      })();
      m28Row && m28Row.prompt_tokens > 0 && m28Row.prompt_tokens % 11 === 0 &&
        m28Row.completion_tokens > 0 && m28Row.completion_tokens % 7 === 0
        ? ok("E2E GP-130：真实回合把 usage 写进 llm-usage.json（requests≥1，tokens=11/7 的倍数）")
        : bad("E2E GP-130 usage store", JSON.stringify(m28Row));

      // GP-131: Settings → Usage & Billing tab shows the same real row.
      // Under grok-ui the footer Settings row is hidden; the real entry is the
      // account popup → 设置, so drive that.
      await win.click("#account-avatar-btn");
      await win.waitForSelector("#ap-settings", { state: "visible", timeout: 5000 });
      await win.click("#ap-settings");
      await win.waitForSelector("#settings-panel", { timeout: 10000 });
      await win.evaluate(() => {
        const btn = document.querySelector('.settings-tab-btn[data-stab="usage"]');
        if (btn) btn.click();
      });
      await win.waitForFunction(
        () => {
          const el = document.getElementById("gp-usage");
          return el && (el.textContent || "").includes("e2e-stub");
        },
        null,
        { timeout: 10000 },
      ).catch(() => {});
      const usagePanel = await win.evaluate(() => {
        const el = document.getElementById("gp-usage");
        return el ? el.textContent || "" : "";
      });
      usagePanel.includes("e2e-stub") && usagePanel.includes("prompt")
        ? ok("E2E GP-131：Usage & Billing 面板 per-row 行与 store 一致（provider/model/请求/tokens）")
        : bad("E2E GP-131 usage panel", usagePanel.slice(0, 160));
      await shutdown(bootM28.app);
    } catch (e) {
      bad("E2E GP-130/131 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      if (m28Stub) { try { m28Stub.kill("SIGKILL"); } catch (_) {} }
      if (usageM28Before) fs.writeFileSync(USAGE_M28, usageM28Before);
      else fs.rmSync(USAGE_M28, { force: true });
    }

    /* ---- GP-119/M29 群聊入口 + GP-143 真回合（官方 spec §2.4）----
       预置一个真实群（成员取 bots.json 前两个 Bot）→ 启动后点侧栏群组行 →
       #room-banner 打开 + 空群如实说没有历史 → composer 发消息走 Host
       rooms.orchestrate IPC（Host RoomTurn 路由 + responder 扇出）→
       rooms.json 真落 kind=user / bot_reply / final_report → 群线程按条目
       渲染出 2 张回复卡 + 1 张汇总卡 → 退出群聊 banner 收起。
       LLM 用本地 OpenAI 兼容 stub：回执是真的 HTTP 往返，不依赖外部服务。 */
    const ROOMS_M29 = dd("rooms.json");
    const BOTS_M29 = dd("bots.json");
    const roomsM29Before = fs.existsSync(ROOMS_M29) ? fs.readFileSync(ROOMS_M29) : null;
    const botsM29Before = fs.existsSync(BOTS_M29) ? fs.readFileSync(BOTS_M29) : null;
    let stubM29 = null;
    try {
      const botsM29 = JSON.parse(fs.readFileSync(BOTS_M29, "utf8"));
      const botList = Array.isArray(botsM29) ? botsM29 : botsM29.bots || [];
      const m29Ids = botList.map((b) => b.id).filter(Boolean).slice(0, 2);
      if (m29Ids.length === 2) {
        const m29Room = {
          id: "room-m29e2e",
          title: "M29 E2E 群聊探针",
          members: m29Ids,
          created_at: new Date().toISOString(),
          transcript: [],
        };
        const roomsSeed = roomsM29Before
          ? JSON.parse(roomsM29Before.toString())
          : { version: 1, rooms: [] };
        const seedRooms = Array.isArray(roomsSeed) ? { version: 1, rooms: roomsSeed } : roomsSeed;
        seedRooms.rooms = (seedRooms.rooms || []).filter((r) => r && r.id !== "room-m29e2e");
        seedRooms.rooms.push(m29Room);
        fs.writeFileSync(ROOMS_M29, JSON.stringify(seedRooms, null, 2));
        const stubM29Port = 8799;
        const { spawn: spawnM29 } = require("node:child_process");
        stubM29 = spawnM29(
          process.execPath,
          [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
          {
            cwd: REPO,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, BITBOT_STUB_PORT: String(stubM29Port) },
          },
        );
        await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error("M29 stub boot timeout")), 8000);
          stubM29.stdout.on("data", (d) => {
            if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(); }
          });
          stubM29.on("error", rej);
        }).catch(() => {});
        const bootM29 = await launch({
          BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + stubM29Port + "/v1",
          BITBOT_LLM_API_KEY: "e2e-stub-key",
          BITBOT_LLM_MODEL: "e2e-stub",
          BITBOT_LLM_STREAM: "0",
          // 群回合走真内核 + 真 HTTP：给足单次 responder 的时间预算。
          BITBOT_ROOM_RESPONDER_TIMEOUT_MS: process.env.BITBOT_ROOM_RESPONDER_TIMEOUT_MS || "120000",
        });
        const win = bootM29.win;
        await win.waitForSelector("#room-list .agent-item[data-room-id]", { timeout: 30000 });
        await win.click('#room-list .agent-item[data-room-id="room-m29e2e"]');
        await win.waitForFunction(
          () => {
            const b = document.getElementById("room-banner");
            return b && b.style.display !== "none";
          },
          null,
          { timeout: 10000 },
        ).catch(() => {});
        const banner = await win.evaluate(() => {
          const b = document.getElementById("room-banner");
          if (!b || b.style.display === "none") return null;
          return {
            title: document.getElementById("room-banner-title").textContent,
            meta: document.getElementById("room-banner-meta").textContent,
            ph: document.querySelector("#composer #text").placeholder,
          };
        });
        banner && banner.title === "M29 E2E 群聊探针" && banner.ph.includes("@Name")
          ? ok("E2E GP-119/M29：点侧栏群组行 → 群聊 banner 打开（标题/路由提示/placeholder 切换）")
          : bad("E2E GP-119 room banner", JSON.stringify(banner));
        await win.waitForFunction(
          () => (document.getElementById("log").textContent || "").includes("还没有任何消息"),
          null,
          { timeout: 10000 },
        ).catch(() => {});
        (await win.evaluate(() => document.getElementById("log").textContent || "")).includes("还没有任何消息")
          ? ok("E2E GP-119/M29：空群明说「还没有任何消息」（不造历史）")
          : bad("E2E GP-119 empty transcript", "honest empty state missing");
        await win.fill("#composer #text", "@everyone M29 群聊探针消息");
        await win.press("#composer #text", "Enter");
        // GP-143: the composer row is the plain message — the kernel phrase is
        // gone, so the transcript has exactly one writer.
        await win.waitForFunction(
          () => Array.from(document.querySelectorAll("#log .msg.room-user .body")).some(
            (el) => /@everyone M29 群聊探针消息/.test(el.textContent || ""),
          ),
          null,
          { timeout: 20000 },
        ).catch(() => {});
        const logText = await win.evaluate(() => document.getElementById("log").textContent || "");
        logText.includes("@everyone M29 群聊探针消息") && !/room room-m29e2e :: /.test(logText)
          ? ok("E2E GP-119/143：composer 消息原样进群线程（用户行卡），不再拼 room <id> :: 短语")
          : bad("E2E GP-119 room turn", JSON.stringify(logText.slice(0, 200)));
        // The Host persists the routed user row into rooms.json — poll for it.
        let m29Grew = false;
        for (let i = 0; i < 30; i++) {
          try {
            const st = JSON.parse(fs.readFileSync(ROOMS_M29, "utf8"));
            const row = (st.rooms || []).find((r) => r && r.id === "room-m29e2e");
            if (row && Array.isArray(row.transcript) &&
                row.transcript.some((e) => e && e.kind === "user" &&
                  String(e.text || "").includes("@everyone M29 群聊探针消息"))) {
              m29Grew = true;
              break;
            }
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 300));
        }
        m29Grew
          ? ok("E2E GP-143：群聊回合真写 rooms.json（kind=user 行 + @everyone 路由）")
          : bad("E2E GP-143 transcript write", "rooms.json never gained the user row");
        // GP-143 real turns: both members answer through kernel + stub provider,
        // then the engine aggregates a final_report. Poll the durable store.
        let m29Report = null;
        for (let i = 0; i < 160; i++) {
          try {
            const st = JSON.parse(fs.readFileSync(ROOMS_M29, "utf8"));
            const row = (st.rooms || []).find((r) => r && r.id === "room-m29e2e");
            const fr = row && (row.transcript || []).find((e) => e && e.kind === "final_report");
            if (fr) { m29Report = fr; break; }
          } catch (_) {}
          await new Promise((r) => setTimeout(r, 500));
        }
        m29Report && m29Report.total === 2 && m29Report.returned === 2 && m29Report.partial === false
          ? ok("E2E GP-143：两个 responder 真回合收齐 2/2（partial=false，真 HTTP 回执）")
          : bad("E2E GP-143 real turns", JSON.stringify(m29Report && {
              returned: m29Report.returned, total: m29Report.total, partial: m29Report.partial,
              sections: (m29Report.sections || []).map((s) => ({ id: s.bot_id, ok: s.ok, err: s.summary })),
            }));
        await win.waitForFunction(
          () => document.querySelectorAll("#log .msg.room-reply").length >= 2 &&
            document.querySelectorAll("#log .msg.room-report").length >= 1,
          null,
          { timeout: 20000 },
        ).catch(() => {});
        const cards = await win.evaluate(() => ({
          replies: Array.from(document.querySelectorAll("#log .msg.room-reply")).map(
            (el) => ({
              speaker: (el.querySelector(".rs-name") || {}).textContent || "",
              text: (el.querySelector(".body") || {}).textContent || "",
            }),
          ),
          reports: Array.from(document.querySelectorAll("#log .msg.room-report")).map(
            (el) => ({
              cls: el.className,
              count: ((el.querySelector(".rr-count") || {}).textContent || ""),
              text: (el.querySelector(".body") || {}).textContent || "",
            }),
          ),
          errors: document.querySelectorAll("#log .msg.room-error").length,
        }));
        const distinctSpeakers = new Set(cards.replies.map((r) => r.speaker)).size;
        cards.replies.length >= 2 && distinctSpeakers >= 2 &&
          cards.replies.every((r) => r.text.replace(r.speaker, "").trim().length > 0)
          ? ok("E2E GP-146：群线程按条目渲染 ≥2 张 bot 回复卡（各有说话人 + 正文）")
          : bad("E2E GP-146 reply cards", JSON.stringify(cards.replies).slice(0, 300));
        cards.reports.length >= 1 && /2\/2/.test(cards.reports[0].count) &&
          !/room-partial/.test(cards.reports[0].cls) && cards.errors === 0
          ? ok("E2E GP-146：final_report 卡显示 2/2 且无 partial 标记（收齐才写完成）")
          : bad("E2E GP-146 report card", JSON.stringify(cards.reports).slice(0, 300));
        await win.evaluate(() => document.getElementById("room-banner-exit").click());
        const afterExit = await win.evaluate(() => ({
          hidden: document.getElementById("room-banner").style.display === "none",
          ph: document.querySelector("#composer #text").placeholder,
          thread: document.querySelectorAll(".room-thread").length,
        }));
        // 占位文案本身会变（Grok 单行胶囊里塞不下「Shift+Enter 换行」，那类提示
        // 已经移到 title 上）；这里只断言「回到了 DM 语境」，不锁死某一句话。
        afterExit.hidden && afterExit.ph.length > 0 && !afterExit.ph.includes("群") && afterExit.thread === 0
          ? ok("E2E GP-119/M29：退出群聊恢复 DM composer（banner 收起 + placeholder 复原 + 群线程移除）")
          : bad("E2E GP-119 exit room", JSON.stringify(afterExit));
        await shutdown(bootM29.app);
      } else {
        bad("E2E GP-119 seed", "bots.json needs at least 2 bots");
      }
    } catch (e) {
      bad("E2E GP-119/M29 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      if (stubM29) { try { stubM29.kill("SIGKILL"); } catch (_) {} }
      if (roomsM29Before) fs.writeFileSync(ROOMS_M29, roomsM29Before);
      else fs.rmSync(ROOMS_M29, { force: true });
      if (botsM29Before) fs.writeFileSync(BOTS_M29, botsM29Before);
    }

    /* ---- GP-93/94/95 Markdown/链接纪律（官方 spec §5.6）----
       走真实 UI + 真实 IPC：provider 回一句含裸 URL 与 javascript: 链接的话 →
       kernel CM-0111 规范化为 markdown → renderer 把 markdown 变成真 <a>，
       不可打开的 scheme 保持纯文本。断言：可点、href 一致、hover 出预览卡且
       「不自动导航」（悬停期间审计文件零行）、点击走 shell.openExternal 路由
       （审计行 + record-only 落点）、页面自身绝不导航、window.open 被 deny。
       诚实边界：record-only 模式抑制真实浏览器启动（Xvfb 下起不来是真环境限制），
       审计行因此 opened:false + error 说明原因，不谎称"已打开浏览器"。*/
    const g19Port = 8794;
    const g19Audit = "/tmp/g19-links-audit.jsonl";
    const g19Record = "/tmp/g19-links-record.jsonl";
    const g19Url = "https://example.com/docs?g=19";
    const g19Env = {
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + g19Port + "/v1",
      BITBOT_LLM_API_KEY: "e2e-stub-key",
      BITBOT_LLM_MODEL: "e2e-stub",
      BITBOT_LLM_STREAM: "0",
      // 裸 URL 后必须接空格/ASCII 终止符：kernel url_terminator_at 只认 ASCII
      // 标点，全角「，」会被吞进 URL，href 就不是逐字一致的那条了。
      BITBOT_STUB_REPLY:
        "文档在这里 " + g19Url + " 。另有坏链接 [点我](javascript:alert(1)) 与原文 <img src=x onerror=alert(1)> 。",
      BITBOT_LINKS_AUDIT_PATH: g19Audit,
      BITBOT_LINKS_RECORD_PATH: g19Record,
    };
    let g19Stub = null;
    try {
      fs.rmSync(g19Audit, { force: true });
      fs.rmSync(g19Record, { force: true });
      const { spawn: spawnChild } = require("node:child_process");
      g19Stub = spawnChild(
        process.execPath,
        [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
        {
          cwd: REPO,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, BITBOT_STUB_PORT: String(g19Port), BITBOT_STUB_REPLY: g19Env.BITBOT_STUB_REPLY },
        },
      );
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("g19 stub boot timeout")), 8000);
        g19Stub.stdout.on("data", (d) => {
          if (String(d).includes("[stub-llm]")) {
            clearTimeout(t);
            res();
          }
        });
        g19Stub.on("error", rej);
      });
      const bootG19 = await launch(g19Env);
      const urlBefore = bootG19.win.url();
      await bootG19.win.evaluate(() => window.bbUi.newSession());
      await bootG19.win.fill("#composer #text", "GP19 给我一个链接");
      await bootG19.win.press("#composer #text", "Enter");
      await bootG19.win.waitForFunction(
        (u) => Array.from(document.querySelectorAll("#log .msg a.msg-link")).some(
          (a) => (a.getAttribute("href") || "") === u,
        ),
        g19Url,
        { timeout: 45000 },
      );

      const dom = await bootG19.win.evaluate(
        (u) => {
          const a = Array.from(document.querySelectorAll("#log .msg a.msg-link")).find(
            (x) => (x.getAttribute("href") || "") === u,
          );
          const bodies = Array.from(document.querySelectorAll("#log .msg .body"));
          const joined = bodies.map((b) => b.textContent || "").join("\n");
          return {
            found: Boolean(a),
            label: a ? a.textContent : "",
            rel: a ? a.getAttribute("rel") : null,
            target: a ? a.getAttribute("target") : null,
            anchorsTotal: document.querySelectorAll("#log .msg a.msg-link").length,
            // 坏 scheme 与非链接原文必须仍在文本里，且没有变成元素
            keepsJsText: joined.includes("[点我](javascript:alert(1))"),
            keepsRawHtmlText: joined.includes("<img src=x onerror=alert(1)>"),
            injectedImg: document.querySelectorAll("#log .msg .body img").length,
            jsAnchor: Array.from(document.querySelectorAll("#log .msg a")).filter(
              (x) => /javascript:/i.test(x.getAttribute("href") || ""),
            ).length,
          };
        },
        g19Url,
      );
      dom.found
        ? ok("E2E GP-93：kernel 规范化的 markdown 链接在气泡里是真 <a href>（href 逐字=" + g19Url + "）")
        : bad("E2E GP-93 anchor", JSON.stringify(dom).slice(0, 240));
      dom.label.trim() === g19Url && dom.rel === "noopener noreferrer" && !dom.target
        ? ok("E2E GP-93：链接文案=原文，rel=noopener noreferrer，无 target=_blank（不绕过守卫开新窗）")
        : bad("E2E GP-93 anchor attrs", JSON.stringify({ label: dom.label, rel: dom.rel, target: dom.target }).slice(0, 220));
      dom.keepsJsText && dom.keepsRawHtmlText && dom.injectedImg === 0 && dom.jsAnchor === 0
        ? ok("E2E GP-93：javascript: 链接与 <img> 原文保持纯文本（无 innerHTML 注入面，0 个可点坏链接）")
        : bad("E2E GP-93 fail-closed", JSON.stringify(dom).slice(0, 260));

      // GP-95：hover 出预览卡；hover 期间不得有任何打开/导航副作用
      await bootG19.win.hover("#log .msg a.msg-link");
      const hover = await bootG19.win.evaluate(() => {
        const lp = document.getElementById("link-preview");
        return {
          show: lp ? lp.dataset.show : "missing",
          host: lp ? (lp.querySelector(".lp-host") || {}).textContent : "",
          url: lp ? (lp.querySelector(".lp-url") || {}).textContent : "",
          hintVisible: lp ? getComputedStyle(lp).display !== "none" : false,
        };
      });
      hover.show === "1" && hover.host === "example.com" && hover.url === g19Url && hover.hintVisible
        ? ok("E2E GP-95：悬停链接卡显示主机名+完整 URL+提示（example.com）")
        : bad("E2E GP-95 hover card", JSON.stringify(hover).slice(0, 220));
      // hover 期间给 IPC 一点时间：任何"自动导航"都会在这里留下行或改变 URL
      await new Promise((r) => setTimeout(r, 400));
      const auditAfterHover = readRows(g19Audit);
      auditAfterHover.length === 0 && bootG19.win.url() === urlBefore
        ? ok("E2E GP-95：悬停不自动导航——审计文件 0 行、页面 URL 未变")
        : bad("E2E GP-95 hover side effect", JSON.stringify({ rows: auditAfterHover.length, url: bootG19.win.url() }).slice(0, 220));
      await bootG19.win.mouse.move(2, 2);
      const hidden = await bootG19.win.evaluate(() => document.getElementById("link-preview").dataset.show);
      hidden === "0"
        ? ok("E2E GP-95：离开链接后预览卡收起")
        : bad("E2E GP-95 hover hide", String(hidden));

      // GP-94：点击 → Host 校验 scheme → openExternal 路由（record-only）→ 审计行
      await bootG19.win.click("#log .msg a.msg-link");
      const rows = await pollRows(g19Audit, (r) => r.some((x) => x.decision === "open_external"));
      const openRow = rows.find((r) => r.decision === "open_external" && r.url === g19Url);
      openRow && openRow.hostname === "example.com" && openRow.scheme === "https" &&
        openRow.source === "renderer-link" && openRow.opened === false &&
        /record-only mode/.test(String(openRow.error || ""))
        ? ok("E2E GP-94：点击落到 Host openExternal 路由（审计行 scheme/host/source 齐全，opened:false 并写明抑制原因）")
        : bad("E2E GP-94 audit row", JSON.stringify(rows).slice(0, 300));
      const rec = fs.existsSync(g19Record)
        ? fs.readFileSync(g19Record, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [];
      rec.length === 1 && rec[0].url === g19Url
        ? ok("E2E GP-94：真实调用到达 shell.openExternal 入口（record-only 落点 URL 逐字一致，未虚构 opened:true）")
        : bad("E2E GP-94 openExternal entry", JSON.stringify(rec).slice(0, 240));
      bootG19.win.url() === urlBefore
        ? ok("E2E GP-94：点击后页面仍在应用内（无 Electron 内导航）")
        : bad("E2E GP-94 in-app navigation", bootG19.win.url());

      // GP-94 拒绝路径：非 http(s) 走真实 IPC，必须 refused 且留审计行
      const refuse = await bootG19.win.evaluate(() =>
        window.bitbot.links.open({ url: "javascript:alert(1)", source: "probe-refuse" }),
      );
      refuse && refuse.decision === "refused" && refuse.opened === false &&
        refuse.error === "scheme_not_allowed"
        ? ok("E2E GP-94：javascript: 经 IPC 被拒（scheme_not_allowed，不静默打开）")
        : bad("E2E GP-94 refuse path", JSON.stringify(refuse).slice(0, 220));
      const rows2 = readRows(g19Audit);
      rows2.some((r) => r.decision === "refused" && r.source === "probe-refuse")
        ? ok("E2E GP-94：被拦截的点击同样留痕（审计含 refused 行）")
        : bad("E2E GP-94 refusal audit", JSON.stringify(rows2.map((r) => r.decision)).slice(0, 200));

      // GP-94 窗口守卫：window.open 必须被 deny（不产生新窗口），但仍走审计
      const popupBefore = bootG19.app.windows().length;
      await bootG19.win.evaluate((u) => window.open(u, "_blank"), g19Url);
      const popupAfter = bootG19.app.windows().length;
      const rows3 = await pollRows(g19Audit, (r) =>
        r.some((x) => x.source === "window-open-handler"),
      );
      popupAfter === popupBefore &&
        rows3.some((r) => r.source === "window-open-handler")
        ? ok("E2E GP-94：setWindowOpenHandler 拦截新窗口（窗口数 " + popupBefore + "→" + popupAfter + "）且路由到系统浏览器审计")
        : bad("E2E GP-94 window guard", JSON.stringify({ popupBefore, popupAfter, sources: rows3.map((r) => r.source) }).slice(0, 260));

      // 政策与主进程同源：renderer 与 Host 加载同一份 link_discipline.js
      const shared = await bootG19.win.evaluate(() => ({
        hasApi: Boolean(window.__bitbotLinks),
        fns: window.__bitbotLinks
          ? ["parseExternalUrl", "linkBodyToDom", "applyLinkBody"].filter(
              (k) => typeof window.__bitbotLinks[k] === "function",
            ).length
          : 0,
      }));
      shared.hasApi && shared.fns === 3
        ? ok("E2E GP-93：渲染进程加载的正是主进程同一份 link_discipline.js（policy 无副本）")
        : bad("E2E GP-93 shared policy", JSON.stringify(shared).slice(0, 160));

      await shutdown(bootG19.app);
      // openExternal 入口只应被两处触达：那次点击 + 被 deny 后转交的 window.open。
      // hover 一次都不能触达；javascript: 那次也必须没进来。
      const recFinal = readRows(g19Record);
      recFinal.length === 2 && recFinal.every((r) => r.url === g19Url)
        ? ok("E2E GP-94/95：到达 open 入口的只有那次点击与 window.open 转交（hover 0 次、被拒链接 0 次）")
        : bad("E2E GP-94 open entry count", JSON.stringify(recFinal).slice(0, 260));
    } catch (e) {
      bad("E2E GP-93/94/95 块异常", (e && e.message ? e.message : String(e)).slice(0, 220));
    } finally {
      for (const k of Object.keys(g19Env)) delete process.env[k];
      if (g19Stub) {
        try {
          g19Stub.kill("SIGKILL");
        } catch (_) {}
      }
    }


  } catch (e) {
    bad("E2E 未捕获异常", e.stack || e.message);
  } finally {
    restoreStores();
  }

  console.log(`e2e_grok_desktop_boot: PASS=${PASS} FAIL=${FAIL}` + (SKIP ? ` SKIP=${SKIP}` : ""));
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[e2e] failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});
