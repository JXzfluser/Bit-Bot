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
// GP-14: the reply chain writes message rows + provider artifacts; snapshot the
// transcript store too so the whole E2E stays double-run idempotent.
const SESSIONS_PATH = path.join(REPO, "data/desktop/sessions.json");
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

async function launchOnce(extraEnv) {
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
      ...(extraEnv || {}),
    },
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  await win.waitForSelector("#composer #text", { timeout: 30000 });
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
  const SECRETS_DIR = path.join(REPO, "data/secrets");
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
      const surface = surfaceMod(path.join(REPO, "hosts/desktop/product_surface.js"))
        .createProductSurface(REPO);
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
        (p) => p.startsWith(path.join(REPO, "data/workspace/uploads/gp11e2e")),
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
      fs.rmSync(path.join(REPO, "data/workspace/uploads/gp11e2e"), { recursive: true, force: true });
    }

    /* ---- GP-14 Reply 回复特定消息：id 必须进 kernel 上下文并变成真引用 ----
       走真实 UI：第一轮发消息 → hover 助手气泡 → 点「回复」→ 引用条出现 →
       发第二条。断言三层：kernel 回显 reply_to；Host 把该 id 解析成原文并塞进
       provider 请求（用 echo-all stub 在 HTTP body 层自证）；store 行带 reply_to
       且重载后 DOM 有引用条。伪 id 场景必须 resolved:false（不假装引用成功）。*/
    const stubPort = 8793;
    const LLM_TURNS_DIR = path.join(REPO, "data/llm/turns");
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
      await bootG14.win.evaluate(() => document.getElementById("sess-new").click());
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
        if (!mid) return "no-target";
        const el = document.querySelector('#log .msg[data-mid="' + mid + '"]');
        const btn = el && el.querySelector(".msg-actions button");
        if (!btn) return "no-reply-button";
        btn.click();
        const bar = document.getElementById("reply-bar");
        return bar && bar.style.display !== "none"
          ? (document.getElementById("reply-bar-text") || {}).textContent || ""
          : "bar-hidden";
      }, target ? target.mid : "");
      typeof clicked === "string" && clicked.includes("GP14 原始问题")
        ? ok("E2E GP-14：Reply 按钮 → 引用条显示被回复消息原文")
        : bad("E2E GP-14 reply bar", String(clicked).slice(0, 160));

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

      const newest = fs
        .readdirSync(LLM_TURNS_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f, fs.statSync(path.join(LLM_TURNS_DIR, f)).mtimeMs])
        .sort((a, b) => b[1] - a[1])[0];
      const art = newest
        ? JSON.parse(fs.readFileSync(path.join(LLM_TURNS_DIR, newest[0]), "utf8"))
        : {};
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
      const quoteDom = await bootG14.win.evaluate(() => ({
        chips: document.querySelectorAll("#log .msg-reply-quote").length,
        text: (document.querySelector("#log .msg-reply-quote") || {}).textContent || "",
      }));
      quoteDom.chips >= 1 && quoteDom.text.includes("GP14 原始问题")
        ? ok("E2E GP-14：转写里回复气泡上方渲染引用条（" + quoteDom.chips + " 处）")
        : bad("E2E GP-14 quote chip", JSON.stringify(quoteDom).slice(0, 160));
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
        document.getElementById("sess-new").click();
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
      reload.found && reload.away === 0 && reload.chips > 0 &&
        reload.text.includes(String(target ? target.text : "GP14").slice(0, 24))
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
      const ghostArt = fs
        .readdirSync(LLM_TURNS_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [f, fs.statSync(path.join(LLM_TURNS_DIR, f)).mtimeMs])
        .sort((a, b) => b[1] - a[1])[0];
      const ga = JSON.parse(fs.readFileSync(path.join(LLM_TURNS_DIR, ghostArt[0]), "utf8"));
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
      await bootG21.win.evaluate(() => document.getElementById("sess-new").click());
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
      await bootG19.win.evaluate(() => document.getElementById("sess-new").click());
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

  console.log(`e2e_grok_desktop_boot: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[e2e] failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});
