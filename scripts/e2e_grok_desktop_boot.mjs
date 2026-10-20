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
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { decodePng, avgLuma, pixelAt, encodeRgbPng } from "./lib_png_pixel.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const SETTINGS_PATH = path.join(REPO, "data/desktop/settings.json");
const ACCOUNT_PATH = path.join(REPO, "data/desktop/account-profile.json");
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

async function launchOnce() {
  const electronBinary = path.join(
    REPO,
    "hosts/desktop/node_modules/electron/dist/electron",
  );
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
    env: {
      ...process.env,
      DISPLAY: liveDisplay(),
      BITBOT_ESPEAK_BIN: process.env.BITBOT_ESPEAK_BIN || "/usr/bin/espeak-ng",
    },
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  return { app, win };
}

async function launch() {
  let last;
  for (let i = 1; i <= LAUNCH_RETRIES; i++) {
    try {
      const boot = await launchOnce();
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

async function main() {
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
  const restoreStores = () => {
    if (settingsBefore) fs.writeFileSync(SETTINGS_PATH, settingsBefore);
    else fs.rmSync(SETTINGS_PATH, { force: true });
    if (accountBefore) fs.writeFileSync(ACCOUNT_PATH, accountBefore);
    else fs.rmSync(ACCOUNT_PATH, { force: true });
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

    const title = await win.title();
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

    await shutdown(boot2.app);
  } catch (e) {
    bad("E2E 未捕获异常", e.stack || e.message);
  } finally {
    restoreStores();
  }

  console.log(`e2e_grok_desktop_boot: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[e2e] failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});
