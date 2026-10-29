"use strict";

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  dialog,
  nativeTheme,
  Notification,
  clipboard,
} = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

// 单实例锁：同一个 user-data-dir 只允许一个 Electron 进程常驻。
// 没有这把锁时，双击第二次会起一个全新进程，于是出现「两个应用同时跑」。
// 这里在最早的位置拿锁：拿不到就直接退出，并把已有的窗口唤到前台。
const GOT_INSTANCE_LOCK = process.env.BITBOT_DISABLE_SINGLE_INSTANCE
  ? true // 负向对照用：关掉锁，模拟修复前「能起两个」的状态
  : app.requestSingleInstanceLock();
if (!GOT_INSTANCE_LOCK) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

/* T1-07 —— 桌面宿主默认使用常驻内核：一次进程创建做完所有回合，群聊一轮 3 个 Bot
   不再起 3 个进程（这不是「更快」，是「不再按回合数 spawn」）。要回到每轮直起的
   老行为，启动前设 BITBOT_KERNEL_RESIDENT=0 即可 —— 两条路共用同一个内核二进制、
   同一套 argv 语义，scripts/prove_kernel_resident.mjs 的 KR-07 逐条比对过两侧产出，
   KR-03 就是把本段默认关掉之后量出来的对照数。 */
if (!process.env.BITBOT_KERNEL_RESIDENT) {
  process.env.BITBOT_KERNEL_RESIDENT = "1";
}

// Dev: hosts/shared; packaged: hosts/desktop/shared (copied by electron-builder).
let createTurnRunner;
let createHostFfi;
let projectAgentStep;
let createApprovalGate;
let canonicalAction;
let actionFromKind;
let stripApproved;
try {
  createTurnRunner = require("./shared/run_moon_turn").createTurnRunner;
  createHostFfi = require("./shared/host_ffi").createHostFfi;
  projectAgentStep = require("./shared/agent_loop_product_wire").projectAgentStep;
  ({
    createApprovalGate,
    canonicalAction,
    actionFromKind,
    stripApproved,
  } = require("./shared/host_approval_gate"));
} catch (_e) {
  createTurnRunner = require("../shared/run_moon_turn").createTurnRunner;
  createHostFfi = require("../shared/host_ffi").createHostFfi;
  projectAgentStep = require("../shared/agent_loop_product_wire").projectAgentStep;
  ({
    createApprovalGate,
    canonicalAction,
    actionFromKind,
    stripApproved,
  } = require("../shared/host_approval_gate"));
}
const { createSessionStore } = require("./sessions");
const { buildRoomContext: buildRoomContextData } = require("../shared/room_context");
const { buildDiscretionPrompt, parseDiscretionReply } = require("../shared/room_discretion");
const { createRoomRuntime, roomSafeText: sharedRoomSafeText } = require("../shared/room_runtime");
const { dispatchRoomTurn } = require("../shared/room_dispatch");
const { resolveMachineId } = require("../shared/machine_identity");

// GP-93/94/95 — Markdown/链接纪律 (official spec §5.6). Policy + open route in
// one module pair used by both the main process and the smoke probe, so the
// probe asserts the shipped code rather than a copy of it.
let createLinkOpen;
try {
  createLinkOpen = require("./link_open").createLinkOpen;
} catch (_e) {
  createLinkOpen = require("../desktop/link_open").createLinkOpen;
}

let createProductSurface;
try {
  createProductSurface = require("./product_surface").createProductSurface;
} catch (_e) {
  try {
    createProductSurface = require("../desktop/product_surface").createProductSurface;
  } catch (_e2) {
    // Wave G surface not built yet — IPC handlers answer honestly instead of crashing.
    createProductSurface = () => ({
      unavailable: true,
      bots: {},
      settings: { get: () => ({ ok: false, error: "product_surface missing" }) },
    });
  }
}

// GP-99/100/101/102 — §8.3 secure secret input. The vault stores values on the
// Host side only; the renderer sees a handle + `****last4`.
const { createSecretVault } = require("./secret_vault");
// GP-103/104 — §8.4 untrusted marking is applied in the kernel (the fence text
// is written by `continue_after_host_ffi`); the renderer loads the same grammar
// from hosts/shared/untrusted_fence.js to render the badge.

let createCnInboundServer;
try {
  createCnInboundServer = require("./shared/cn_inbound_server").createCnInboundServer;
} catch (_e) {
  createCnInboundServer = require("../shared/cn_inbound_server").createCnInboundServer;
}

// Pairing-v1: shared code manager (IPC + HTTP routes see the same instance).
let createPairingCodeManager;
try {
  createPairingCodeManager = require("./shared/desktop_pairing").createPairingCodeManager;
} catch (_e) {
  createPairingCodeManager = require("../shared/desktop_pairing").createPairingCodeManager;
}
const pairingCodeManager = createPairingCodeManager();

// 内核注册表里的设备 id 只有一个真相来源：desk-1 / phone-ios / phone-android
// （box_host 的 seed()）。这里内联的 onTurn 以前自己拼 `${machineKind}-1`，
// 于是手机的回合挂在注册表里根本不存在的 `android-1` 上 —— HTTP 200、回复也
// 有，但设备工具 0 个、花名册点不亮。共用同一个函数，防止两处再各写一套。
// ADR 0008 的配对令牌由共享模块解析（env → data/host/turn-token → 生成 0600）。
// 界面上要把它交给用户，所以这里只读同一个真相来源，不另存一份。
let p0;
try {
  p0 = require("./shared/p0_security");
} catch (_e) {
  p0 = require("../shared/p0_security");
}

let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (_e) {
  autoUpdater = null;
}

/** CN inbound HTTP server (钉钉/飞书/企微 callbacks). */
let cnInbound = null;

/* Layout contract v1 §6: dev-mode may also be requested at launch. This is
   the ONLY way dev surfaces appear without the Settings switch, and the
   renderer badge makes the mode visible either way. */
const DEV_MODE_LAUNCH = process.argv.includes("--bitbot-devmode") || process.env.BITBOT_DEVMODE === "1";

/**
 * Path roots — see hosts/desktop/paths.js for the full contract.
 *
 *   SRC_ROOT  : the MoonBit code tree (`moon run cmd/desktop_turn` runs
 *               there); null in a packaged install
 *   REPO_ROOT : the root the host modules work from (= SRC_ROOT in dev,
 *               = the user-data parent when there is no source tree)
 *   DATA_ROOT : user data (sessions / rooms / memory / routines / secrets)
 *
 * The previous inline resolver probed for `moon.mod.json`, but MoonBit's
 * module file is `moon.mod`, so that probe could never match and the only
 * working fallback was a hard-coded developer path
 * (`/Users/zfl/Downloads/bitbot`). A packaged build therefore had no way to
 * find its kernel. We now:
 *   - probe the real module file name,
 *   - probe the kernel staged into the app resources (packaged builds),
 *   - and return null instead of guessing, so a missing kernel is reported
 *     honestly instead of surfacing as "moon exited 255".
 */
const { resolveRepoRoot, resolveDataRoot, resolveMoonBin, resolveKernelBin, describeMissingKernel } = require("./paths");

/** Resources dir of a packaged app (undefined in dev). */
const RESOURCES_PATH = (() => {
  try {
    return app.isPackaged && process.resourcesPath ? process.resourcesPath : null;
  } catch (_) {
    return null;
  }
})();

/** Where the kernel lives when it is shipped inside the app bundle. */
const BUNDLED_KERNEL_ROOT = RESOURCES_PATH ? path.join(RESOURCES_PATH, "kernel") : null;

/** The MoonBit *source* tree, or null in a packaged install (which ships the
 *  compiled kernel instead). Nothing below may guess this one. */
const SRC_ROOT = resolveRepoRoot({
  dirname: __dirname,
  kernelRoot: BUNDLED_KERNEL_ROOT,
  resourcesPath: RESOURCES_PATH,
});

/** The compiled kernel binary shipped in the app bundle (packaged builds).
 *  When present the host runs it directly instead of `moon run ...`, so the
 *  end user needs neither a MoonBit toolchain nor the kernel source tree. */
const KERNEL_BIN = resolveKernelBin({
  env: process.env,
  resourcesPath: RESOURCES_PATH,
  kernelRoot: BUNDLED_KERNEL_ROOT,
});

/** The `moon` executable: bundled copy first, then $MOON_BIN, then PATH. */
const MOON_BIN = resolveMoonBin({
  env: process.env,
  resourcesPath: RESOURCES_PATH,
  kernelRoot: BUNDLED_KERNEL_ROOT,
});
if (MOON_BIN && !process.env.MOON_BIN) process.env.MOON_BIN = MOON_BIN;

/** OS-managed user-data dir. Packaged builds keep user data here. */
const USER_DATA_DIR = (() => {
  try {
    return app.getPath ? app.getPath("userData") : null;
  } catch (_) {
    return null;
  }
})();

/** User data root. Dev keeps the historical <repo>/data layout. */
const DATA_ROOT = resolveDataRoot({
  repoRoot: SRC_ROOT,
  userDataDir: USER_DATA_DIR,
  packaged: Boolean(app.isPackaged),
});

/** The root the host modules work from. In dev it IS the source tree.
 *  A packaged install has no source tree, but those modules read `repoRoot` as
 *  "the directory whose `data/` holds the user data" — for a packaged app that
 *  is the user-data dir (DATA_ROOT is `<userData>/data`). Deriving it from
 *  DATA_ROOT keeps every `<repoRoot>/data/...` write landing in the right place
 *  instead of throwing on a null path; source-only helpers (`scripts/*.sh`)
 *  then report "missing" on their own instead of crashing the host. */
const REPO_ROOT = SRC_ROOT || (DATA_ROOT ? path.dirname(DATA_ROOT) : null);

if (!SRC_ROOT && !KERNEL_BIN) {
  // Honest failure: neither a checkout to run `moon` from nor a bundled
  // kernel binary, so there is no Product Brain in this install.
  const why = describeMissingKernel({ env: process.env });
  console.error("[bitbot] FATAL: " + why);
  try {
    app.whenReady().then(() => {
      dialog.showErrorBox("Bit Bot — 内核未找到", why + "\n\n当前安装无法启动月之核心(Product Brain)。");
    });
  } catch (_) { /* headless */ }
}

/** Last OTA check result — honest residual until feed + packaged app. */
const otaState = {
  last_check: null,
  last_result: null,
  update_available: false,
  update_downloaded: false,
  error: null,
};

/**
 * GP-77: persist install + OTA state so the shared Host (`update_status` kind)
 * reads the real values even from the CLI process. Read-only for the Computer
 * stores — app updates never touch data/desktop/computer.json or data/box.
 */
function persistAppInstallState() {
  try {
    const dir = path.join(DATA_ROOT, "desktop");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "app-install.json"),
      JSON.stringify(
        {
          version: app.getVersion ? app.getVersion() : null,
          packaged: app.isPackaged,
          updater_loaded: Boolean(autoUpdater),
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (_) { /* dev-run without write perms: update_status reports null */ }
}
function persistOtaState() {
  try {
    const dir = path.join(DATA_ROOT, "desktop");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "ota-state.json"),
      JSON.stringify(
        {
          last_check: otaState.last_check,
          last_result: otaState.last_result,
          update_available: otaState.update_available,
          update_downloaded: otaState.update_downloaded,
          error: otaState.error,
        },
        null,
        2,
      ),
    );
  } catch (_) { /* same */ }
}
if (autoUpdater) {
  autoUpdater.on("update-downloaded", (info) => {
    otaState.update_downloaded = true;
    otaState.last_result = { version: (info && info.version) || null };
    persistOtaState();
  });
}

const DESKTOP_ENV_LOCAL = path.join(__dirname, ".env.local");

/** Parse KEY=VALUE lines from an env file. */
function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

/**
 * Load hosts/desktop/.env.local then repo .env.local (never commit secrets).
 * @param {{overwrite?: boolean}} opts — overwrite=true applies file values over process.env
 */
function loadEnvLocalFiles(opts = {}) {
  const overwrite = Boolean(opts && opts.overwrite);
  const candidates = [DESKTOP_ENV_LOCAL, path.join(REPO_ROOT, ".env.local")];
  if (USER_DATA_DIR) candidates.push(path.join(USER_DATA_DIR, ".env.local"));
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const map = parseEnvFile(file);
      for (const [k, v] of Object.entries(map)) {
        if (overwrite || process.env[k] === undefined) process.env[k] = v;
      }
      process.stdout.write(`[desktop] loaded env file ${file}\n`);
    } catch (err) {
      process.stderr.write(
        `[desktop] env load failed ${file}: ${err && err.message ? err.message : err}\n`,
      );
    }
  }
}
loadEnvLocalFiles();
// Bot timezone default = system timezone (never hardcoded UTC). Seed BITBOT_TZ
// once so the routine daemon + product_surface agree; a real user override or a
// value already in .env.local takes precedence.
if (!String(process.env.BITBOT_TZ || "").trim()) {
  let sysTz = "UTC";
  try {
    sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || "UTC";
  } catch (_) { /* ignore */ }
  process.env.BITBOT_TZ = sysTz;
}
// Product default: content moderation armed unless explicitly disabled.
if (process.env.BITBOT_CONTENT_MODERATION === undefined) {
  process.env.BITBOT_CONTENT_MODERATION = "1";
}

const ALLOWED_SECRET_KEYS = new Set([
  "BITBOT_LLM_API_KEY",
  "BITBOT_LLM_BASE_URL",
  "BITBOT_LLM_MODEL",
  "BITBOT_LLM_PROVIDER",
  "BITBOT_LLM_QWEN_API_KEY",
  "BITBOT_LLM_MOONSHOT_API_KEY",
  // Replica C6: real web search (Tavily / Brave). Same open-config rule —
  // the user owns the key, it lands in gitignored .env.local and hot reloads.
  "BITBOT_SEARCH_PROVIDER",
  "BITBOT_SEARCH_API_KEY",
  "BITBOT_SEARCH_API_BASE",
  "BITBOT_DINGTALK_POST",
  "BITBOT_DINGTALK_WEBHOOK",
  "BITBOT_DINGTALK_TOKEN",
  "BITBOT_DINGTALK_APP_SECRET",
  "BITBOT_TURN_TOKEN",
  "BITBOT_FEISHU_POST",
  "BITBOT_FEISHU_TOKEN",
  "BITBOT_FEISHU_ENCRYPT_KEY",
  "BITBOT_FEISHU_VERIFICATION_TOKEN",
  "BITBOT_FEISHU_CHAT_ID",
  "BITBOT_WECOM_POST",
  "BITBOT_WECOM_TOKEN",
  "BITBOT_WECOM_CALLBACK_TOKEN",
  "BITBOT_WECOM_AGENT_ID",
  "BITBOT_WECOM_TOUSER",
  "BITBOT_CONTENT_MODERATION",
  "BITBOT_ICP_FILING",
  "BITBOT_ALGORITHM_FILING",
  "BITBOT_UPDATE_FEED_URL",
]);

/**
 * If Cloud Agent / shell injected BITBOT_* into process.env but .env.local
 * lacks them, persist for Settings + acceptance gate (never write stubs).
 *
 * 两个闸门（都是实测踩出来的）：
 * 1. BITBOT_NO_SECRET_SYNC=1：门禁隔离了 data/，但 .env.local 是固定路径
 *    （不在 REPO_ROOT 下），门禁注入的假 key 会被这里同步进用户的真文件。
 *    门禁一律带这个开关。
 * 2. stub 值识别：门禁的假值长 "e2e-stub-key" / "e2e-stub" 这样——只认
 *    /^stub/i 拦不住它们（实测漏过，把用户 .env.local 里的真实 key 顶掉了）。
 */
function syncInjectedSecretsToEnvLocal() {
  if (process.env.BITBOT_NO_SECRET_SYNC === "1") {
    return { ok: true, synced: [], skipped: "BITBOT_NO_SECRET_SYNC=1" };
  }
  const current = parseEnvFile(DESKTOP_ENV_LOCAL);
  const patch = {};
  for (const k of ALLOWED_SECRET_KEYS) {
    const v = String(process.env[k] || "").trim();
    if (!v) continue;
    if (/^(e2e[-_])?(stub|dummy|placeholder)/i.test(v) || v === "test" || v === "changeme") continue;
    if (current[k]) continue;
    patch[k] = v;
  }
  if (!Object.keys(patch).length) return { ok: true, synced: [] };
  const r = upsertDesktopEnvLocal(patch);
  process.stdout.write(
    `[desktop] synced injected secrets → .env.local: ${(r.applied || Object.keys(patch)).join(",")}\n`,
  );
  return r;
}

function maskSecret(v) {
  const s = String(v || "");
  if (!s) return { present: false, masked: "" };
  if (s.length <= 4) return { present: true, masked: "****" };
  return { present: true, masked: "****" + s.slice(-4) };
}

/** Upsert keys into hosts/desktop/.env.local and process.env (hot reload). */
function upsertDesktopEnvLocal(patch) {
  const incoming = patch && typeof patch === "object" ? patch : {};
  const current = parseEnvFile(DESKTOP_ENV_LOCAL);
  const applied = [];
  for (const [rawK, rawV] of Object.entries(incoming)) {
    const k = String(rawK || "").trim();
    if (!ALLOWED_SECRET_KEYS.has(k)) {
      return {
        ok: false,
        error: `key not allowed: ${k}`,
        pretend_saved: false,
      };
    }
    const v = rawV === null || rawV === undefined ? "" : String(rawV).trim();
    if (v === "") {
      delete current[k];
      delete process.env[k];
    } else {
      current[k] = v;
      process.env[k] = v;
    }
    applied.push(k);
  }
  const header =
    "# Bit Bot Desktop secrets — gitignored; never commit.\n" +
    "# Written by Desktop Settings (product path).\n";
  const body = Object.keys(current)
    .sort()
    .map((k) => `${k}=${current[k]}`)
    .join("\n");
  fs.writeFileSync(
    DESKTOP_ENV_LOCAL,
    header + (body ? body + "\n" : ""),
    { mode: 0o600 },
  );
  return {
    ok: true,
    path: "hosts/desktop/.env.local",
    applied,
    pretend_saved: false,
  };
}

syncInjectedSecretsToEnvLocal();

const runner = createTurnRunner(REPO_ROOT, { dataRoot: DATA_ROOT, moonBin: MOON_BIN, kernelBin: KERNEL_BIN });
let releaseActiveTurnCancel = null;
const approvalGate = createApprovalGate();
let liveLoopApproval = null;
const sessions = createSessionStore(REPO_ROOT, { dataRoot: DATA_ROOT });
const ffi = createHostFfi(REPO_ROOT, { dataRoot: DATA_ROOT, kernelBin: KERNEL_BIN });
/** Wave G stores: bots / settings / approvals / computer / rooms / usage (docs/grok-desktop-parity/ipc-contract.md §2). */
const surface = createProductSurface(REPO_ROOT, { dataRoot: DATA_ROOT });
/** GP-99/100/101/102 — Host-owned secret vault (§8.3). */
const secretVault = createSecretVault(REPO_ROOT, { dataRoot: DATA_ROOT });
const secretProtocol = require("./secret_protocol");
const { computePrivacyStatus } = require(path.join(
  fs.existsSync(path.join(__dirname, "shared", "privacy_status.js"))
    ? path.join(__dirname, "shared", "privacy_status.js")
    : path.join(__dirname, "..", "shared", "privacy_status.js"),
));

let mainWindow = null;
let tray = null;
let routineDaemonChild = null;
/* GP-170: in-process routine sweep. Exactly one wake source at a time: the
 * shell daemon when it is actually running, otherwise this timer. */
let desktopSweepTimer = null;
let desktopSweepInFlight = false;
/* 「用户真的要退出」这一件事必须有一个明确来源。窗口的 close 事件无法区分
 * 「用户点了红叉」和「退出流程正在关窗」—— 两者都是 close。没有这个标志，
 * 下面 close 里的 preventDefault 就会把 Cmd+Q / 菜单退出一起取消掉，
 * 窗口只是 hide()，进程留在后台（这正是「手动退出不了」的成因）。 */
let quitRequested = false;
const HOTKEY =
  process.env.BITBOT_DESKTOP_HOTKEY ||
  (process.platform === "darwin" ? "Command+Shift+Space" : "Control+Shift+Space");
const AUTOSTART_ENABLED =
  process.env.BITBOT_DESKTOP_AUTOSTART === undefined
    ? true
    : process.env.BITBOT_DESKTOP_AUTOSTART === "1";
const DAEMON_AUTOSTART =
  process.env.BITBOT_ROUTINE_DAEMON_AUTOSTART === undefined
    ? true
    : process.env.BITBOT_ROUTINE_DAEMON_AUTOSTART === "1";

/* GP-170 — the app itself must be a wake source.
 *
 * History: wakes were 100% delegated to scripts/host_routine_daemon.sh (bash).
 * That script is not in hosts/desktop/package.json build.files, and Windows has
 * no /bin/bash, so an installed app never swept anything. Every Electron gate
 * also sets BITBOT_ROUTINE_DAEMON_AUTOSTART=0, so nothing ever noticed.
 *
 * Now the main process runs routine_tick itself whenever the shell daemon is
 * not running. Default cadence matches the daemon (60s); 0 disables it
 * (deterministic-quiet gates), and BITBOT_DESKTOP_SWEEP_MS shortens it in
 * gates. Only an optional field (desktop_sweep:true) is added to the tick
 * payload — the existing routine payload contract is untouched.
 */
const DESKTOP_SWEEP_MS = (() => {
  const raw = process.env.BITBOT_DESKTOP_SWEEP_MS;
  if (raw === undefined || raw === "") return 60000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 60000;
})();

/** Linux XDG autostart .desktop (Electron setLoginItemSettings is weak on Linux). */
function applyLinuxXdgAutostart(enabled) {
  const home = process.env.HOME || "";
  if (!home) return { ok: false, error: "HOME unset" };
  const dir = path.join(home, ".config", "autostart");
  const desk = path.join(dir, "bitbot-desktop.desktop");
  if (!enabled) {
    try {
      if (fs.existsSync(desk)) fs.unlinkSync(desk);
    } catch (_) {
      /* ignore */
    }
    return { ok: true, openAtLogin: false, path: desk, removed: true };
  }
  fs.mkdirSync(dir, { recursive: true });
  const execLine = process.env.BITBOT_DESKTOP_AUTOSTART_EXEC
    ? String(process.env.BITBOT_DESKTOP_AUTOSTART_EXEC)
    : `"${process.execPath}" "${path.join(__dirname)}"`;
  const body =
    "[Desktop Entry]\n" +
    "Type=Application\n" +
    "Name=Bit Bot\n" +
    "Comment=Bit Bot Desktop — MoonBit CN assistant\n" +
    `Exec=${execLine}\n` +
    "Terminal=false\n" +
    "X-GNOME-Autostart-enabled=true\n" +
    "StartupNotify=false\n";
  fs.writeFileSync(desk, body, { mode: 0o644 });
  return { ok: true, openAtLogin: true, path: desk, linux_xdg: true };
}

function applyLoginItem(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: true,
      path: process.execPath,
      args:
        process.env.BITBOT_DESKTOP_LOGIN_ARGS
          ? String(process.env.BITBOT_DESKTOP_LOGIN_ARGS).split(/\s+/).filter(Boolean)
          : [],
    });
    let linux = null;
    if (process.platform === "linux") {
      linux = applyLinuxXdgAutostart(Boolean(enabled));
    }
    return {
      ok: true,
      openAtLogin: Boolean(enabled),
      linux_xdg: linux,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
}

function readDaemonStatus() {
  const p = path.join(DATA_ROOT, "routines", "daemon-status.json");
  try {
    if (fs.existsSync(p)) {
      return { ok: true, path: p, status: JSON.parse(fs.readFileSync(p, "utf8")) };
    }
  } catch (_) {
    /* ignore */
  }
  return {
    ok: true,
    path: p,
    status: {
      daemon: false,
      long_lived: false,
      note: "no daemon-status yet",
    },
  };
}

function ensureRoutineDaemon() {
  if (!DAEMON_AUTOSTART) {
    return { ok: false, skipped: true, reason: "BITBOT_ROUTINE_DAEMON_AUTOSTART=0" };
  }
  if (routineDaemonChild && !routineDaemonChild.killed) {
    return {
      ok: true,
      already_running: true,
      pid: routineDaemonChild.pid,
    };
  }
  /* GP-170: the shell daemon only exists in a source checkout. In an installed
   * app REPO_ROOT is null (or lacks scripts/) and Windows has no /bin/bash.
   * Report that honestly instead of throwing inside whenReady — the in-process
   * sweep below is what keeps the machine awake in those layouts. */
  if (!REPO_ROOT) {
    return {
      ok: false,
      error: "repo_root_unavailable",
      note: "installed layout: no scripts/ to run; desktop in-process sweep takes over",
      fallback: "desktop_sweep",
    };
  }
  if (process.platform === "win32") {
    return {
      ok: false,
      error: "daemon_script_needs_bash",
      note: "no /bin/bash on Windows; desktop in-process sweep takes over",
      fallback: "desktop_sweep",
    };
  }
  const script = path.join(REPO_ROOT, "scripts", "host_routine_daemon.sh");
  if (!fs.existsSync(script)) {
    return { ok: false, error: "missing scripts/host_routine_daemon.sh" };
  }
  const interval = String(process.env.BITBOT_ROUTINE_INTERVAL_MS || "60000");
  try {
    routineDaemonChild = spawn(
      "/bin/bash",
      [script, "--long-lived", "--interval-ms", interval],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          BITBOT_ROUTINE_DAEMON: "1",
          BITBOT_ROUTINE_LONG_LIVED: "1",
          PATH: `${process.env.HOME || ""}/.moon/bin:${process.env.PATH || ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      },
    );
    routineDaemonChild.stdout.on("data", (c) => {
      process.stdout.write(`[routine-daemon] ${c}`);
    });
    routineDaemonChild.stderr.on("data", (c) => {
      process.stderr.write(`[routine-daemon] ${c}`);
    });
    routineDaemonChild.on("exit", (code) => {
      process.stdout.write(
        `[routine-daemon] exited code=${code}\n`,
      );
      routineDaemonChild = null;
      // GP-170: daemon 走了，桌面定时器接手 —— 不能让「开着电脑」空转。
      syncWakeSource();
    });
    /* spawn /bin/bash 失败（例如被裁剪的镜像）会 emit 'error'；没有监听器时
       Node 会把它升级成未捕获异常，整个主进程崩掉。这里落一笔并交给 sweep。 */
    routineDaemonChild.on("error", (err) => {
      process.stderr.write(
        `[routine-daemon] spawn failed: ${err && err.message ? err.message : err}\n`,
      );
      routineDaemonChild = null;
      syncWakeSource();
    });
    return {
      ok: true,
      pid: routineDaemonChild.pid,
      interval_ms: Number(interval) || 60000,
      long_lived: true,
      pretend_daemon: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      pretend_daemon: false,
    };
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(channel, payload);
    } catch (_) {
      /* ignore */
    }
  }
}

ffi.setLlmStreamHandler((chunk) => {
  broadcast("bitbot:llm-stream", chunk);
  // GP-130 (§7.1): every real successful model call lands in the weekly
  // usage store — requests always, tokens only when the provider reported
  // them (unreported tokens stay 0 and the panel labels them honestly).
  if (chunk && chunk.phase === "usage" && chunk.provider_id) {
    try {
      surface.recordUsage({
        provider: String(chunk.provider_id),
        model: String(chunk.model || ""),
        prompt_tokens: Number(chunk.prompt_tokens) || 0,
        completion_tokens: Number(chunk.completion_tokens) || 0,
      });
    } catch (_) {
      /* usage bookkeeping must never break the turn */
    }
  }
});

/** One-shot product-path smoke: Electron Host runs a MoonBit turn then exits. */
async function runSmokeTurnAndExit() {
  const text = String(process.env.BITBOT_DESKTOP_SMOKE_TURN || "").trim();
  const outDir = path.join(DATA_ROOT, "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "desktop-electron-turn.json");
  const at = new Date().toISOString();
  try {
    const result = await runner.runTurn(text || "ListMachines", {
      sessionId: "desktop-electron-smoke",
      machineId: resolveMachineId({ kind: "desktop" }),
      machineKind: "desktop",
      channel: "",
      approved: process.env.BITBOT_DESKTOP_SMOKE_APPROVED === "1",
    });
    const evidence = {
      mode: "desktop_electron_smoke_turn",
      ok: Boolean(result && result.ok),
      pretend_desktop: false,
      via_electron: true,
      local_brain: false,
      moonbit_brain: true,
      intent: (result && result.intent) || null,
      machine_kind: (result && result.machine_kind) || "desktop",
      turn_path: outPath,
      at,
      turn: result,
    };
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
    process.stdout.write(
      "[desktop-smoke] ok=" +
        String(evidence.ok) +
        " intent=" +
        String(evidence.intent) +
        " path=" +
        outPath +
        "\n",
    );
    app.exit(evidence.ok ? 0 : 1);
  } catch (err) {
    const evidence = {
      mode: "desktop_electron_smoke_turn",
      ok: false,
      pretend_desktop: false,
      via_electron: true,
      local_brain: false,
      moonbit_brain: true,
      error: String(err && err.message ? err.message : err),
      at,
    };
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2));
    process.stderr.write("[desktop-smoke] failed: " + evidence.error + "\n");
    app.exit(1);
  }
}

/** 关掉常驻 routine daemon。SIGTERM 优先（给它收尾的机会），SIGKILL 兜底。
 *  历史上 daemon 有过不响应 SIGTERM 的情况（--long-lived 里的 trap），
 *  所以退出流程要分两次调用：before-quit 发 SIGTERM，will-quit 发 SIGKILL。 */
function stopRoutineDaemon(signal) {
  const child = routineDaemonChild;
  if (!child || child.killed) return;
  // child.killed 只表示「信号已发出」，不代表进程还活着；这里看真实退出码。
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(signal || "SIGTERM");
  } catch (_) {
    /* ignore */
  }
}

/** 关掉常驻内核池（T1-07）。`stop()` 的语义是「关上 stdin，让内核见 EOF 自己收摊」，
 *  不需要信号；但 before-quit 里不能 await，所以真正的兜底是 will-quit 那一记 SIGKILL。
 *  即使两记都没落地也不会留孤儿：主进程一退，管道写端就关闭，内核读到 EOF 必然退出。 */
function stopResidentKernel() {
  try {
    if (runner && typeof runner.stopKernel === "function") runner.stopKernel();
  } catch (_) {
    /* 退出路径上的异常不许挡住关闭 */
  }
}

function killResidentKernel() {
  let pids = [];
  try {
    const st = runner && typeof runner.kernelStats === "function" ? runner.kernelStats() : null;
    pids = (st && st.pids) || [];
  } catch (_) {
    pids = [];
  }
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch (_) {
      /* 已经退了 */
    }
  }
}

/** daemon 现在还活着吗？（child.killed 只表示信号发过，退出码才是真相） */
function routineDaemonAlive() {
  const child = routineDaemonChild;
  return !!child && !child.killed && child.exitCode === null && child.signalCode === null;
}

/** 把一轮 sweep 如实写进 data/routines/desktop-sweep.jsonl（失败也写）。
 *  这是 App 自己的运行日志，不是用户数据：超过 1MB 只保留最近 500 行，
 *  否则一个常年开着的桌面端会把磁盘写成无止境。 */
function appendDesktopSweepRow(row) {
  try {
    const dir = path.join(DATA_ROOT, "routines");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "desktop-sweep.jsonl");
    try {
      if (fs.statSync(p).size > 1000000) {
        const kept = fs
          .readFileSync(p, "utf8")
          .split("\n")
          .filter(Boolean)
          .slice(-500);
        fs.writeFileSync(p, kept.join("\n") + "\n");
      }
    } catch (_) {
      /* 文件还不存在 */
    }
    fs.appendFileSync(p, JSON.stringify(row) + "\n");
  } catch (_) {
    /* 记账失败不能把定时器带崩 */
  }
}

/** 走一遍 routine_tick —— 和 shell daemon 每轮跑的是同一个 Host 效果。
 *  single-flight：上一轮还在等内核 / 转交重试时，这一轮如实记
 *  skipped_in_flight，不并发、也不谎报跑过。 */
async function runDesktopSweep(reason) {
  const startedAt = new Date().toISOString();
  if (quitRequested) return null;
  if (desktopSweepInFlight) {
    appendDesktopSweepRow({
      mode: "desktop_sweep",
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      reason: String(reason || "interval"),
      skipped_in_flight: true,
      tick_ok: false,
    });
    return null;
  }
  desktopSweepInFlight = true;
  const row = {
    mode: "desktop_sweep",
    started_at: startedAt,
    reason: String(reason || "interval"),
    tick_ok: false,
  };
  try {
    const results = await ffi.executeHostEffects(
      [{ kind: "routine_tick", command: "desktop-sweep" }],
      { sessionId: "desktop-sweep", desktopSweep: true },
    );
    const hit = (results || []).find(
      (r) => r && (r.kind === "routine_tick" || r.kind === "routine_wake"),
    );
    let payload = {};
    try {
      payload = JSON.parse((hit && hit.stdout) || "{}");
    } catch (_) {
      payload = {};
    }
    row.tick_ok = Boolean(hit && hit.ok);
    row.tick_at = payload.at || null;
    row.due_count = payload.due_count != null ? payload.due_count : null;
    row.fired_count = payload.fired_count != null ? payload.fired_count : null;
    // 挂账转交搭同一班车（GP-168）；这里如实转述，不做第二次判断。
    row.handoff_retry = (hit && hit.handoff_retry) || payload.handoff_retry || null;
    if (!row.tick_ok) row.error = (hit && (hit.error || hit.stderr)) || "routine_tick_failed";
  } catch (err) {
    row.error = String((err && err.message) || err);
  } finally {
    desktopSweepInFlight = false;
    row.ended_at = new Date().toISOString();
    appendDesktopSweepRow(row);
  }
  return row;
}

function startDesktopSweep() {
  if (quitRequested) return { ok: false, skipped: true, reason: "quitting" };
  if (desktopSweepTimer) {
    return { ok: true, already_running: true, interval_ms: DESKTOP_SWEEP_MS };
  }
  if (!(DESKTOP_SWEEP_MS > 0)) {
    return { ok: false, skipped: true, reason: "BITBOT_DESKTOP_SWEEP_MS=0" };
  }
  // 开机先扫一轮：已经到点的任务不必等满一个周期。
  void runDesktopSweep("startup");
  desktopSweepTimer = setInterval(() => {
    void runDesktopSweep("interval");
  }, DESKTOP_SWEEP_MS);
  return { ok: true, interval_ms: DESKTOP_SWEEP_MS, desktop_sweep: true };
}

function stopDesktopSweep() {
  if (!desktopSweepTimer) return;
  try {
    clearInterval(desktopSweepTimer);
  } catch (_) {
    /* ignore */
  }
  desktopSweepTimer = null;
}

/** 只留一个唤醒源：daemon 在跑就用 daemon，否则 App 自己扫。
 *  两个同时扫会争同一批到期任务（可能重复触发发文/发邮件）。 */
function syncWakeSource() {
  if (quitRequested) return null;
  if (routineDaemonAlive()) {
    stopDesktopSweep();
    return { wake_source: "routine_daemon" };
  }
  return Object.assign({ wake_source: "desktop_sweep" }, startDesktopSweep());
}

/** 唯一的退出入口：托盘菜单、应用菜单的 role:"quit" 最终都落到 before-quit，
 *  这个函数只是给「代码里主动要求退出」的地方用，保证标志与 quit 同源。 */
function requestQuit() {
  quitRequested = true;
  /* 曾经这里还有一个 app.isQuiting 标志，用来给 close 判断。它不是 Electron 的
     API（拼写也差一个 t），而且只在托盘菜单一处被设过 —— 正是"Cmd+Q 退不掉"
     的成因。现在统一成上面的 quitRequested，这个字段不再需要。 */
  app.quit();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 420,
    title: "Bit Bot Desktop",
    icon: path.join(__dirname, "build", "icon.png"),
    // Grok-parity chrome: no native title bar; traffic lights float inset over
    // the top strip (the in-app header stays as the drag region).
    titleBarStyle: "hiddenInset",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));
  // The window chrome name is the product name set here — the renderer's
  // <title> ("Bit Bot 桌面版") is a document label, not a title-bar owner.
  // Without this, Chromium's page-title-updated overwrite made win.title()
  // locale-dependent (real-render e2e caught it on first live boot).
  win.setTitle("Bit Bot Desktop");
  win.webContents.on("page-title-updated", (e) => {
    e.preventDefault();
    win.setTitle("Bit Bot Desktop");
  });
  // GP-94: nothing may leave the app window. New-window requests are denied
  // outright, and a navigation away from the app shell is blocked and routed
  // through the same validated open-external path instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    links.open(url, { source: "window-open-handler" });
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    links.open(url, { source: "will-navigate" });
  });
  win.on("close", (e) => {
    // Grok-style: 点红叉只是收进托盘（退出从菜单 / 托盘 / Cmd+Q 发起）。
    // 但「退出流程」也在关这个窗口 —— 用 quitRequested 把两种 close 区分开，
    // 否则 preventDefault 会把退出一起吃掉。
    if (quitRequested) return;
    e.preventDefault();
    win.hide();
  });
  mainWindow = win;
  return win;
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTray() {
  // 16x16 green square — product tray presence without external assets.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVQ4T2NkYGD4z0ABYBzVMKoBBgQjAxQw/qdWMwYGhv8UwYFiNQAA6v0FAfQ1nqQAAAAASUVORK5CYII=",
    "base64",
  );
  const icon = nativeImage.createFromBuffer(png);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Bit Bot Desktop");
  const menu = Menu.buildFromTemplate([
    {
      label: "显示 / 隐藏",
      click: () => toggleMainWindow(),
    },
    {
      label: "新对话",
      click: () => {
        sessions.create("新对话");
        broadcast("bitbot:sessions-changed", sessions.list());
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => requestQuit(),
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => toggleMainWindow());
  tray.on("double-click", () => toggleMainWindow());
}

function registerHotkey() {
  try {
    const ok = globalShortcut.register(HOTKEY, () => toggleMainWindow());
    if (!ok) {
      process.stderr.write(
        `[desktop] globalShortcut failed to register: ${HOTKEY}\n`,
      );
    } else {
      process.stdout.write(`[desktop] hotkey ${HOTKEY} → show/hide\n`);
    }
  } catch (err) {
    process.stderr.write(
      `[desktop] hotkey error: ${err && err.message ? err.message : err}\n`,
    );
  }
}

ipcMain.handle("bitbot:boot", async () => runner.bootBanner());

/*
 * GP-94 — 链接在系统浏览器打开，不在 Electron 内导航（官方 spec §5.6）.
 * The renderer never touches shell directly: it asks for a URL, and this route
 * validates the scheme, opens it externally, and appends an audit row to
 * data/desktop/links.jsonl (including refusals, so a blocked target leaves a
 * trace). Non-http(s) hrefs are refused, never silently routed anywhere.
 */
const links = createLinkOpen({
  repoRoot: REPO_ROOT,
  // Tests point the audit at their own file so hover/click row counts are exact;
  // production keeps data/desktop/links.jsonl.
  auditPath: process.env.BITBOT_LINKS_AUDIT_PATH || undefined,
  openExternal: async (url) => {
    // Test hook (same spirit as BITBOT_SAVE_ARTIFACT_DIR): under Xvfb a real
    // browser launch is environment-dependent, so a run can record the exact
    // URL instead. The row still says opened:false with the reason — a recorded
    // click is never reported as a launched browser.
    const recordPath = process.env.BITBOT_LINKS_RECORD_PATH;
    if (recordPath) {
      try {
        fs.appendFileSync(
          path.resolve(recordPath),
          JSON.stringify({ at: new Date().toISOString(), url }) + "\n",
        );
      } catch (_e) {
        /* recording is best-effort; the audit row already has the URL */
      }
      return { ok: false, recorded: true, error: "record-only mode: browser launch suppressed under test" };
    }
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  },
});

ipcMain.handle("bitbot:links:open", async (_e, payload) => {
  const p = payload || {};
  return links.open(p.url, { source: p.source || "renderer-link", sessionId: p.sessionId });
});

ipcMain.handle("bitbot:links:auditPath", async () => ({ ok: true, path: links.auditPath }));

ipcMain.handle("bitbot:sessions:list", async () => sessions.list());
ipcMain.handle("bitbot:sessions:get", async (_e, id) => sessions.get(id));
ipcMain.handle("bitbot:sessions:create", async (_e, title) => {
  const r = sessions.create(title);
  broadcast("bitbot:sessions-changed", sessions.list());
  return r;
});
ipcMain.handle("bitbot:sessions:append", async (_e, id, messages) => {
  // GP-102: the renderer may persist a secret placeholder row (role + text +
  // secret_handle). Everything here is already value-free by construction.
  try {
    const rows = Array.isArray(messages) ? messages : [];
    const safe = rows
      .filter((m) => m && typeof m === "object" && m.role)
      .map((m) => ({
        role: String(m.role),
        text: String(m.text || ""),
        ...(m.secret_handle ? { secret_handle: String(m.secret_handle) } : {}),
        ...(m.reply_to ? { reply_to: String(m.reply_to) } : {}),
      }));
    const res = sessions.appendMessages(String(id || ""), safe);
    broadcast("bitbot:sessions-changed", sessions.list());
    return res;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});
ipcMain.handle("bitbot:sessions:setActive", async (_e, id) => {
  const r = sessions.setActive(id);
  broadcast("bitbot:sessions-changed", sessions.list());
  return r;
});
ipcMain.handle("bitbot:sessions:rename", async (_e, id, title) => {
  const r = sessions.rename ? sessions.rename(id, title) : { ok: false, error: "rename unsupported" };
  broadcast("bitbot:sessions-changed", sessions.list());
  return r;
});
ipcMain.handle("bitbot:sessions:delete", async (_e, id) => {
  const r = sessions.remove ? sessions.remove(id) : { ok: false, error: "delete unsupported" };
  broadcast("bitbot:sessions-changed", sessions.list());
  return r;
});
// GP-M31 (§5.1 消息反应): toggle a reaction on a stored message. No
// sessions-changed broadcast — the renderer applies the returned reactions
// in place, and a reload reads the same store rows.
ipcMain.handle("bitbot:sessions:react", async (_e, payload) => {
  const p = payload || {};
  return sessions.react
    ? sessions.react(p.session_id, p.message_id, p.emoji, p.on)
    : { ok: false, error: "react unsupported" };
});

/* ------------------------------------------------------------------ *
 * Wave G — Grok desktop parity product surface IPC.
 * Stores live in product_surface.js (Host side); kernel keeps policy.
 * ------------------------------------------------------------------ */

ipcMain.handle("bitbot:bots:list", async () => {
  try {
    return surface.listBotsView();
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), bots: [], hidden_bots: [] };
  }
});

/** Kernel-authoritative product phrases (ADR 0002): Bot lifecycle runs a real turn. */
ipcMain.handle("bitbot:bots:op", async (_e, payload) => {
  const p = payload || {};
  const phrase = String(p.phrase || "").trim();
  if (!phrase) return { ok: false, error: "empty phrase" };
  try {
    const result = await runner.runTurn(phrase, {
      sessionId: "bot-ops",
      machineId: resolveMachineId({ kind: "desktop" }),
      machineKind: "desktop",
      channel: "",
      approved: p.approved === true,
      skipSession: true,
    });
    // GP-120/121: the renderer needs the real created/updated row (e.g. to
    // auto-open a new Bot's chat) without re-deriving it from the list. A
    // refused Host effect (invalid avatar, unknown Bot) must also read as a
    // failed op, not as a green turn that silently changed nothing.
    let hostPayload = null;
    try {
      const hit = ((result && result.host_results) || []).find(
        (h) => h && (h.kind === "bot_create" || h.kind === "bot_update"),
      );
      hostPayload = hit && hit.stdout ? JSON.parse(hit.stdout) : null;
    } catch (_) {
      hostPayload = null;
    }
    const effectOk = !hostPayload || hostPayload.ok !== false;
    return {
      ok: Boolean(result && result.ok) && effectOk,
      intent: (result && result.intent) || null,
      turn: result,
      host_payload: hostPayload,
      view: (() => {
        try {
          return surface.listBotsView();
        } catch (_) {
          return null;
        }
      })(),
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

/** G-28 · Bot 分组：展示偏好的直写通道（不经 kernel 意图链，同 settings）。
 *  返回与 listBotsView 相同形状的全量视图，渲染器据此重排侧栏分组。 */
ipcMain.handle("bitbot:bots:setGroup", async (_e, payload) => {
  const p = payload || {};
  try {
    const r = surface.botsSetGroup({ bot_id: p.bot_id, group: p.group });
    if (r && r.ok) broadcast("bitbot:bots-changed", surface.listViews());
    return r;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), mode: "host_bot_group" };
  }
});

/** GP-122 (§2.2): OS image picker for the Bot avatar. The Host validates the
 *  real path on save (`bot_update` rejects missing files); this handler only
 *  returns the path plus a bounded data URL for the in-dialog preview. */
ipcMain.handle("bitbot:bots:pickAvatar", async () => {
  try {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showOpenDialog(win, {
      title: "选择 Bot 头像",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const abs = r.filePaths[0];
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) {
      return { ok: false, error: "avatar_too_large", path: abs };
    }
    const ext = path.extname(abs).toLowerCase();
    const mime =
      ext === ".png" ? "image/png"
        : ext === ".webp" ? "image/webp"
          : ext === ".gif" ? "image/gif"
            : "image/jpeg";
    return {
      ok: true,
      path: abs,
      data_url: "data:" + mime + ";base64," + fs.readFileSync(abs).toString("base64"),
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

/** G-22: Bot settings rail — profile + counts all come from their own stores. */
ipcMain.handle("bitbot:bots:detail", async (_e, botId) => {
  try {
    return surface.botDetail(String(botId || ""));
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

/** G-22 / §4.6: per-Bot notification toggle (merges into settings.notify). */
ipcMain.handle("bitbot:bots:notify", async (_e, payload) => {
  try {
    const p = payload || {};
    const res = surface.botNotifySet(String(p.bot_id || ""), p.on);
    if (res && res.ok) broadcast("bitbot:settings-changed", { ok: true, settings: surface.getSettings() });
    return res;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

/** GP-02: local Bot template catalog (list + one-click create). */
ipcMain.handle("bitbot:templates:list", async () => {
  try {
    const results = await ffi.executeHostEffects(
      [{ kind: "bot_templates_list", command: "" }],
      { sessionId: "templates-panel" },
    );
    const hit = (results || []).find((r) => r && r.kind === "bot_templates_list");
    let payload = {};
    try {
      payload = JSON.parse((hit && hit.stdout) || "{}");
    } catch {
      payload = {};
    }
    return {
      ok: Boolean(hit && hit.ok),
      templates: Array.isArray(payload.templates) ? payload.templates : [],
      count: payload.count != null ? payload.count : null,
      source: payload.source || null,
      error: hit && !hit.ok ? hit.error || "host_failed" : undefined,
      pretend_fetched: false,
    };
  } catch (err) {
    return { ok: false, templates: [], error: String(err && err.message ? err.message : err), pretend_fetched: false };
  }
});

ipcMain.handle("bitbot:templates:create", async (_e, opts) => {
  const tplId = String((opts && opts.templateId) || "").trim();
  const name = String((opts && opts.name) || "").trim();
  if (!tplId) return { ok: false, error: "empty template id", pretend_created: false };
  try {
    const enc = (s) => String(s || "").replace(/\s+/g, "+");
    const results = await ffi.executeHostEffects(
      [{ kind: "bot_create_from_template", command: "template=" + enc(tplId) + " name=" + enc(name) }],
      { sessionId: "templates-panel" },
    );
    const hit = (results || []).find((r) => r && r.kind === "bot_create_from_template");
    let payload = {};
    try {
      payload = JSON.parse((hit && hit.stdout) || "{}");
    } catch {
      payload = {};
    }
    return {
      ok: Boolean(hit && hit.ok && payload.ok !== false && !payload.refused),
      refused: payload.refused === true,
      error: payload.error || (hit && !hit.ok ? hit.error || "host_failed" : undefined),
      bot: payload.bot || null,
      template_id: payload.template_id || tplId,
      pretend_created: false,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), pretend_created: false };
  }
});

/** Light HTML→text for local article files fed to the team extractor. */
function stripHtmlToText(html) {
  if (!html) return "";
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/gi, "'");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").replace(/ +/g, " ").trim();
  return s;
}

/** G-31: build-team-from-URL — fetch a public page body (renderer → Host webfetch),
    or read a local file:// / absolute path the user explicitly referenced.
    Login-walled / blocked URLs return ok:false so the UI can ask the user to
    paste the article text instead. No local execution happens here. */
ipcMain.handle("bitbot:webfetch", async (_e, opts) => {
  const url = String((opts && opts.url) || "").trim();
  if (!url) return { ok: false, reason: "empty_url" };
  // Local file the user named explicitly: read from disk (not execution), strip
  // HTML → text so the extractor sees prose, not markup/CSS.
  if (/^file:\/\//i.test(url) || /^(?:\/|[A-Za-z]:\\)/.test(url)) {
    const fpath = url.replace(/^file:\/\//i, "");
    try {
      const raw = fs.readFileSync(fpath, "utf8");
      const text = stripHtmlToText(raw);
      if (!text) return { ok: false, reason: "empty_body", source: "file" };
      return { ok: true, text: text.slice(0, 60000), url, source: "file", http_status: 200 };
    } catch (err) {
      return { ok: false, reason: "read_failed", error: String(err && err.message ? err.message : err), source: "file" };
    }
  }
  try {
    const results = await ffi.executeHostEffects(
      [{ kind: "webfetch", command: url }],
      { sessionId: "webfetch-panel" },
    );
    const hit = (results || []).find((r) => r && r.kind === "webfetch") || null;
    if (!hit || !hit.ok) {
      const wf = (hit && hit.webfetch) || {};
      return {
        ok: false,
        reason: "fetch_failed",
        http_status: hit && hit.http_status,
        residual: wf.public_fallback_residual || (hit && hit.error) || "host_failed",
      };
    }
    const wf = hit.webfetch || {};
    let text = "";
    if (wf.path) {
      try { text = fs.readFileSync(wf.path, "utf8"); } catch (_) { text = ""; }
    }
    if (!text && hit.stdout) {
      try { const p = JSON.parse(hit.stdout); text = p.text || p.content || ""; } catch { text = hit.stdout; }
    }
    text = String(text || "").trim();
    if (!text) return { ok: false, reason: "empty_body", http_status: wf.http_status };
    return { ok: true, text: text.slice(0, 60000), url: wf.url || url, http_status: wf.http_status };
  } catch (err) {
    return { ok: false, reason: "exception", error: String(err && err.message ? err.message : err) };
  }
});

/** G-31: build-team-from-URL — one-shot structured extraction of a team structure
    from article text via the live LLM. Returns {title, roles[], task?, rules?}.
    With no configured live LLM key this is an honest residual (needs_key:true). */
ipcMain.handle("bitbot:llm:extractTeam", async (_e, opts) => {
  const text = String((opts && opts.text) || "").trim();
  if (!text) return { ok: false, reason: "empty_text" };
  const sys =
    "你是团队架构师。读下面这篇教程/正文，反推出它描述的团队结构。\n" +
    '只输出一个 JSON 对象（不要解释、不要 markdown 代码块），结构：\n' +
    '{ "title": string, "roles": string[], "task": string, "rules": string }\n' +
    "title 是团队名；roles 是 2-6 个简短岗位名（中文优先）；\n" +
    "task 是一句话团队目标；rules 是统一协作规则（可空字符串）。";
  const prompt = sys + "\n\n—— 正文开始 ——\n" + text.slice(0, 24000) + "\n—— 正文结束 ——\n输出 JSON：";
  try {
    const results = await ffi.executeHostEffects(
      [{ kind: "llm_chat", command: prompt }],
      { sessionId: "team-extract" },
    );
    const hit = (results || []).find((r) => r && r.kind === "llm_chat") || null;
    if (!hit || !hit.ok) {
      return { ok: false, needs_key: true, reason: "llm_unavailable", error: (hit && hit.error) || "no llm_chat result" };
    }
    const raw = String(hit.stdout || "").trim();
    let json = "";
    const a = raw.indexOf("{");
    const b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) json = raw.slice(a, b + 1);
    let parsed = null;
    if (json) { try { parsed = JSON.parse(json); } catch { parsed = null; } }
    if (!parsed) { try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: "bad_json", raw }; } }
    const roles = Array.isArray(parsed.roles) ? parsed.roles.map(String).filter(Boolean).slice(0, 6) : [];
    if (!roles.length) return { ok: false, reason: "no_roles", parsed };
    return {
      ok: true,
      title: String(parsed.title || "").trim() || "新建团队",
      roles,
      task: parsed.task ? String(parsed.task) : "",
      rules: parsed.rules ? String(parsed.rules) : "",
    };
  } catch (err) {
    return { ok: false, reason: "exception", error: String(err && err.message ? err.message : err) };
  }
});

/** G-31: build-team-from-URL — scaffold the shared workspace dir under
    data/workspace/<team> (app data root — never a real /workspace on disk,
    per local_execution=never). Skeleton: 00-profile..06-analysis + voice.md
    empty template + optional COLLAB-RULES.md from the extracted rules. */
ipcMain.handle("bitbot:team:workspace", async (_e, opts) => {
  const title = String((opts && opts.title) || "").trim();
  if (!title) return { ok: false, error: "empty_title" };
  const safe = (title.replace(/[\\/:*?"<>|]+/g, "_").trim() || "team").slice(0, 48);
  const root = path.join(DATA_ROOT, "workspace", safe);
  try {
    fs.mkdirSync(root, { recursive: true });
    const sub = ["00-profile", "01-brief", "02-plan", "03-draft", "04-review", "05-publish", "06-analysis"];
    sub.forEach((d) => fs.mkdirSync(path.join(root, d), { recursive: true }));
    const voice = [
      "# 账号声音 / Voice",
      "",
      "> 由教程反推生成。把账号定位、语气、受众填进来，各角色据此交付。",
      "",
      "- 定位：",
      "- 受众：",
      "- 语气：",
      "- 禁忌：",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(root, "00-profile", "voice.md"), voice, "utf8");
    if (opts && opts.rules) {
      fs.writeFileSync(
        path.join(root, "00-profile", "COLLAB-RULES.md"),
        "# 统一协作规则\n\n" + String(opts.rules).trim() + "\n",
        "utf8",
      );
    }
    return { ok: true, path: root, title: safe, dirs: sub };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

function applyAppearance(mode) {
  // Real Electron theme switch — GP-70 (nativeTheme.themeSource is the source of truth).
  if (mode === "light" || mode === "dark" || mode === "system") {
    nativeTheme.themeSource = mode;
    return { applied: true, theme_source: nativeTheme.themeSource };
  }
  return { applied: false, theme_source: nativeTheme.themeSource };
}

ipcMain.handle("bitbot:settings:get", async () => {
  try {
    const st = surface.getSettings();
    return { ok: true, settings: st, theme_source: nativeTheme.themeSource, devmode_launch: DEV_MODE_LAUNCH };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:settings:set", async (_e, patch) => {
  try {
    const res = surface.patchSettings(patch || {});
    if (res && res.ok && patch && patch.appearance) applyAppearance(String(patch.appearance));
    // GP-72: new timezone must reach the routine daemon → env + restart cycle.
    if (res && res.ok && patch && patch.timezone) {
      process.env.BITBOT_TZ = String(patch.timezone);
      try {
        if (routineDaemonChild && !routineDaemonChild.killed) routineDaemonChild.kill();
        ensureRoutineDaemon();
      } catch (_) { /* daemon respawn best-effort */ }
    }
    broadcast("bitbot:settings-changed", res);
    return res;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:attachments:pick", async (_e, payload) => {
  try {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showOpenDialog(win, {
      title: "添加附件",
      properties: ["openFile", "multiSelections"],
    });
    if (r.canceled || !r.filePaths.length) {
      return { ok: false, canceled: true, paths: [] };
    }
    const existing = Number(payload && payload.existing) || 0;
    const staged = surface.stageAttachments(
      r.filePaths,
      sessions.activeId() || "desktop",
      existing,
    );
    return staged;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), paths: [] };
  }
});

// GP-11: paste / drag-drop arrive as File objects; preload resolves the real
// paths (webUtils.getPathForFile) and the SAME Host validator stages them —
// one truth for count/size limits across pick, paste, and drop.
ipcMain.handle("bitbot:attachments:stage", async (_e, payload) => {
  try {
    const paths = Array.isArray(payload && payload.paths) ? payload.paths : [];
    const existing = Number(payload && payload.existing) || 0;
    return surface.stageAttachments(
      paths,
      sessions.activeId() || "desktop",
      existing,
    );
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), paths: [] };
  }
});

// GP-M30 (§5.1 附件在发送前可预览): composer chips show a real thumbnail or
// kind/bytes from the staged file — read-only over the real bytes.
ipcMain.handle("bitbot:attachments:preview", async (_e, payload) => {
  try {
    return surface.attachmentPreview(payload && payload.path);
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:skills:list", async () => {
  try {
    // Reuse Host product path (no LocalBrain): a real kernel turn plans list_skills.
    const result = await runner.runTurn("list skills", {
      sessionId: "skills-pick",
      machineId: resolveMachineId({ kind: "desktop" }),
      machineKind: "desktop",
      channel: "",
      skipSession: true,
    });
    const hit = ((result && result.host_results) || []).find((h) => h && h.kind === "list_skills");
    if (!hit || !hit.ok) {
      return { ok: false, skills: [], error: (hit && hit.error) || "no list_skills host result" };
    }
    let payload = null;
    try {
      payload = JSON.parse(hit.stdout);
    } catch (_) {
      payload = null;
    }
    return { ok: true, skills: (payload && payload.skills) || [], raw: payload };
  } catch (err) {
    return { ok: false, skills: [], error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:approvals:rule", async (_e, patch) => {
  try {
    return surface.upsertApprovalRule(patch || {});
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:approvals:listRules", async () => {
  try {
    return surface.listApprovalRules();
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), rules: [] };
  }
});

ipcMain.handle("bitbot:approvals:removeRule", async (_e, pattern) => {
  try {
    return surface.removeApprovalRule(String(pattern || ""));
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:approvals:match", async (_e, info) => {
  try {
    const kind = String((info && info.kind) || "");
    const command = String((info && info.command) || "");
    let decision = surface.approvalRuleMatch(kind, command);
    // GP-36: local kinds follow the local_execution mode when no rule decides.
    if (!decision && (kind === "shell" || kind === "computer_use")) {
      const wrap = surface.getSettings();
      const st = (wrap && wrap.settings) || wrap || {};
      if (st.local_execution === "always") decision = "allow";
      if (st.local_execution === "never") decision = "deny";
    }
    return { ok: true, decision };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), decision: null };
  }
});

ipcMain.handle("bitbot:approvals:listPending", async () => {
  try {
    const res = surface.listPendingApprovals();
    // GP-162：任务被删掉之后，它挂出来的待批准行仍然在队列里（发不发是用户的
    // 决定，Host 不代做），但必须看得见来路。待批准行本身不带任务 id —— 既有
    // 行形状不动，这里用 Host 已有的触发历史派生，只给 source=routine 的行加
    // 一个可选新字段 routine_gone。
    if (res && Array.isArray(res.pending)) {
      let owners = null;
      try { owners = (ffi.routineApprovalOwners && ffi.routineApprovalOwners()) || null; } catch { owners = null; }
      const map = owners && owners.by_approval;
      if (map) {
        for (const it of res.pending) {
          if (!it || it.source !== "routine") continue;
          const hit = map[String(it.id)];
          if (hit && hit.alive === false) it.routine_gone = true;
        }
      }
    }
    return res;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), items: [] };
  }
});

ipcMain.handle("bitbot:approvals:decide", async (_e, id, decision) => {
  try {
    const res = surface.decideApproval(id, String(decision || ""), new Date().toISOString());
    if (res && res.ok && (res.decision === "allow_once" || res.decision === "always")) {
      const turnId = String((res.item && res.item.turn_id) || ("pending:" + res.id));
      const grant = approvalGate.record({
        turnId,
        action: actionFromKind(res.kind, res.command),
        source: "ui",
      });
      if (grant) res.grant_turn_id = grant.turnId;
    }
    if (res && res.ok && res.decision === "always") {
      // Always allow → also run the originally blocked action once, via kernel re-run.
      broadcast("bitbot:approval-always-allow", { id, kind: res.kind || null });
    }
    return res;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:approvals:denyReceipt", async (_e, info) => {
  try {
    return surface.denyApprovalReceipt({
      source: (info && info.source) || "chat",
      kind: String((info && info.kind) || "chat_action"),
      command: String((info && info.command) || ""),
    });
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

function savedLoopDecision(kind, command) {
  let decision = null;
  try {
    decision = surface.approvalRuleMatch(kind, command);
  } catch (_) {
    decision = null;
  }
  if (!decision && (kind === "shell" || kind === "computer_use")) {
    try {
      const wrap = surface.getSettings();
      const st = (wrap && wrap.settings) || wrap || {};
      if (st.local_execution === "always") decision = "allow";
      if (st.local_execution === "never") decision = "deny";
    } catch (_) {
      /* keep the ask */
    }
  }
  return decision;
}

function finishLiveLoopApproval(verdict) {
  const pending = liveLoopApproval;
  if (!pending || pending.settled) return null;
  pending.settled = true;
  liveLoopApproval = null;
  const next = verdict === "allow" ? "allow" : verdict === "cancel" ? "cancel" : "deny";
  try {
    pending.resolve({ verdict: next });
  } catch (_) {
    /* already settled */
  }
  broadcast("bitbot:loop-approval", { id: pending.id, clear: true });
  return pending;
}

async function resolveProductApproval(req, turnId) {
  const name = String((req && req.name) || "");
  const argsJson = String((req && req.arguments) || "");
  let parsed = {};
  try {
    parsed = JSON.parse(argsJson || "{}");
  } catch (_) {
    parsed = {};
  }
  const shown = stripApproved(parsed);
  const action = canonicalAction(name, argsJson);
  const kind = name === "Shell" || name === "shell" ? "shell" : String(name || "").toLowerCase();
  const command = String(shown.command || shown.cmd || "");
  const saved = savedLoopDecision(kind, command);
  if (saved === "allow") {
    approvalGate.record({ turnId, action, source: "saved_rule" });
    return { verdict: "allow" };
  }
  if (saved === "deny") return { verdict: "deny" };
  const id = "loop-approval-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const answered = await new Promise((resolve) => {
    liveLoopApproval = { id, turnId, action, name, settled: false, resolve };
    broadcast("bitbot:loop-approval", {
      id,
      turnId,
      name,
      arguments: JSON.stringify(shown),
      raw_arguments: argsJson,
      action,
    });
  });
  if (answered && answered.verdict === "allow") {
    approvalGate.record({ turnId, action, source: "ui" });
  }
  return {
    verdict: answered && (answered.verdict === "allow" || answered.verdict === "cancel")
      ? answered.verdict
      : "deny",
  };
}

ipcMain.handle("bitbot:loop-approval:answer", async (_e, info) => {
  const id = String((info && info.id) || "");
  const decision = String((info && info.decision) || "");
  if (!liveLoopApproval || liveLoopApproval.settled || liveLoopApproval.id !== id) {
    return { ok: false, error: "no_card", granted: false };
  }
  if (decision !== "allow" && decision !== "deny") {
    return { ok: false, error: "bad_decision", granted: false };
  }
  const turnId = liveLoopApproval.turnId;
  const action = liveLoopApproval.action;
  const pending = finishLiveLoopApproval(decision);
  return {
    ok: Boolean(pending),
    decision,
    turnId,
    action,
    granted: Boolean(pending) && decision === "allow",
  };
});

ipcMain.handle("bitbot:approvals:runAllowed", async (_e, info) => {
  try {
    const kind = String((info && info.kind) || "");
    const command = String((info && info.command) || "");
    const ALLOWABLE = ["shell", "channel_send", "mail_send", "mcp_call", "computer_use"];
    if (!ALLOWABLE.includes(kind)) {
      return { ok: false, error: "kind_not_replayable" };
    }
    const turnId = String((info && (info.turn_id || info.turnId)) || "");
    const grant = approvalGate.consume(turnId, actionFromKind(kind, command));
    if (!grant) {
      return { ok: false, error: "no_grant", granted: false };
    }
    const out = await ffi.executeHostEffects([{ kind, command }], {
      approved: true,
      // GP-30: replayed computer-use must contend on the same per-Bot lock.
      botId: String((info && info.bot_id) || "") || undefined,
    });
    const hr = Array.isArray(out) ? out[0] : null;
    return {
      ok: Boolean(hr && hr.ok),
      summary: hr && hr.ok ? String(hr.stdout || "").slice(0, 160) : (hr && (hr.error || hr.refused)) || "failed",
      error: hr && !hr.ok ? hr.error || hr.refused || "refused" : undefined,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:rooms:list", async () => {
  try {
    // GP-146：坏掉的 rooms.json 不能报成「一个群都没有」——那会让用户以为历史
    // 没了。读不到就说读不到，渲染层负责显示可恢复的失败态。
    const st = surface.roomsStoreStatus();
    if (!st || !st.ok) {
      return { ok: false, error: (st && st.error) || "rooms_store_unreadable", rooms: { version: 1, rooms: [] } };
    }
    return { ok: true, rooms: st.rooms };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), rooms: { version: 1, rooms: [] } };
  }
});

/* 群资料库（room.library）—— 群资料面板里那份「文件 / 知识库」。
   写侧只碰 rooms.json 的 room.library，且只收 repo 内的路径（与 openArtifact
   同一把尺子）；读不到 rooms.json 就如实报错，不把「读不到」演成「没有资料」。 */
ipcMain.handle("bitbot:rooms:library:list", async (_e, payload) => {
  try {
    return surface.roomLibraryList(payload && payload.roomId);
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), items: [] };
  }
});

/* 群目录变更的广播必须带 rooms 快照 —— 渲染层靠这份快照判断「当前群是不是还在
   目录里」，只看 {ok:true} 会把 list 解析成空数组，进而把用户从群聊里踢出去。
   （G-28 #4 加成员时踩到的就是这个：面板刚写完成员，群聊就被 exitRoomChat 关了。） */
function broadcastRoomsChanged() {
  let st = null;
  try { st = surface.roomsStoreStatus(); } catch (_) { st = null; }
  broadcast(
    "bitbot:rooms-changed",
    st && st.ok ? { ok: true, rooms: st.rooms } : { ok: false, error: (st && st.error) || "rooms_unavailable" },
  );
}

ipcMain.handle("bitbot:rooms:library:add", async (_e, payload) => {
  try {
    const res = surface.roomLibraryAdd(payload && payload.roomId, payload && payload.items);
    if (res && res.ok && res.added) {
      broadcastRoomsChanged();
    }
    return res;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), items: [] };
  }
});

/* G-28 #4：群成员增删（团队详情抽屉里的「移除 / 从 Bot 库添加」）。
   边界由 engine 守（2–6 人、Bot 必须存在、不能重复），这里只做转发与广播：
   写成功后发 rooms-changed，侧栏成员数与群 transcript 同时跟着刷新。 */
ipcMain.handle("bitbot:rooms:members:update", async (_e, payload) => {
  try {
    const res = surface.roomMembersUpdate(payload || {});
    if (res && res.ok) broadcastRoomsChanged();
    return res;
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

/* GP-143/144/145/146 — 群 Bot 协作真回合（Host 产品路径）。
 *
 * engine（product_surface.orchestrateRoom）owns 路由/护栏/聚合与 transcript schema;
 * 这里提供它缺的那一块 —— 每个 responder 的真实回合：
 *   - 自己的 botId → 自己的记忆槽（memorySeedArgs）、自己的 persona
 *     （host_ffi 每回合现读 bots.json 的 job/description）、自己的审批/Computer 作用域；
 *   - 独立 sessionId（room-<roomId>-<botId>）→ 群回合永不写进 Bot 的 DM 会话；
 *   - 缺 key / 内核失败 / provider 失败 → 如实返回 ok:false，engine 记
 *     bot_reply_error 并把 final_report 聚合成 N/总 partial，不伪造回执。
 * 审批与 Secret 仍走各自 Bot 的原通道（pending approval store + 私聊提醒），
 * 群 transcript 只落 sanitizer 处理过的回复正文，不落内部结构串。
 */
/* Kernel planning chatter and Host internals are not chat content — the shared
 * transcript must never carry them (same shapes the renderer hides behind
 * DEBUG_LINE_RE, plus paths/protocol keys). Token-shaped text is redacted with
 * the very rule set the composer and the kernel use. */
const ROOM_DEBUG_RE =
  /(收到，正在用 MoonBit 内核处理|\[host\] ADR 0002|Host FFI|booting MoonBit|moon run cmd\/|Host effect planned|已计划 Host 效果|非 LocalBrain|BITBOT_LLM_[A-Z0-9_]*|entry=|account=|masked=|token_refused|needs_host_ffi|"kind"\s*:\s*"|__bb|data\/(desktop|llm|workspace)\/|\/Users\/[^\s]+)|^已计划[^\n]*(Host |GP-|CM-|BITBOT_)/;

/**
 * GP-148 §1-J4（P0-3）：内核的「已计划…」施工说明和环境变量名属于 Host 内部
 * 细节，不该进用户的历史。修法是分层且透明的：
 *   - 源头：内核这两类意图改为 plan_only（文本进 result.plan，不进 messages）；
 *   - 落库：这里只按形状跳过仍带调试口径的 assistant 行，并把原文放进
 *     result.debug_messages —— 不删、不改写上已有历史（§0），只是不新增；
 *   - 显示：渲染层把这种行标 debug-only（Alt+D 仍可见）。
 * 只匹配已知形状，用户/模型正常发言不会被吞。
 * GP-152：内核 ~50 个意图都用「已计划…（GP-xx/CM-xxxx）。Host …」句式，逐个
 * 列会漏（截图里漏的是 CM-0205 那条）。这里改成按句式匹配：assistant 行必须以
 * 「已计划」开头，且带 Host 内部标记（Host 句子 / GP- / CM- / 环境变量名），
 * 与内核 is_construction_note 保持同一口径 —— 内核已经不产出这种行，这里只是
 * 兜住历史版本与 Host 侧的残余。
 */
const PRODUCT_DEBUG_RE =
  /(收到，正在用 MoonBit 内核处理|\[host\] ADR 0002|booting MoonBit|moon run cmd\/|Host effect planned|已计划 Host 效果|已计划群聊（GP-\d+|非 LocalBrain|BITBOT_LLM_[A-Z0-9_]*|token_refused|needs_host_ffi|__bb)|^已计划[^\n]*(Host |GP-|CM-|BITBOT_)/;

// 脱敏规则住在共享层(桌面/CLI/移动端同一条),桌面只是传进 secretProtocol。
function roomSafeText(raw) {
  return sharedRoomSafeText(raw, secretProtocol);
}

/**
 * GP-148 §1-J3 / AR-07：群回合的 provider 上下文。除群名、成员、本轮被 @、
 * 自己之外，带上最近 N 条共享转录（user/bot_reply/bot_reply_error/final_report）。
 * 仍然不带记忆、路径、协议字段、密钥；逐字段清洗 + 截断，总量有预算。
 * 私聊路径不调用它（DM 传 null），因此 DM 永远不会带出群名单/群历史。
 */
function buildRoomContext(roomId, botId, ctx, task) {
  const rid = String(roomId || "").trim();
  if (!rid) return null;
  let room = null;
  try {
    const st = surface.roomsStoreStatus();
    if (!st || !st.ok) return null;
    room = ((st.rooms && st.rooms.rooms) || []).find((r) => r && r.id === rid) || null;
  } catch (_) {
    return null;
  }
  if (!room) return null;
  const bots = (surface.loadBots().bots) || [];
  return buildRoomContextData({
    room,
    bots,
    botId,
    mentionedNames: (ctx && ctx.mentioned_names) || [],
    selfName: (ctx && ctx.name) || "",
    currentTask: task,
    sanitize: roomSafeText,
    maxField: 80,
    maxTotal: Number(process.env.BITBOT_ROOM_CONTEXT_MAX || 4000),
    maxRecent: Number(process.env.BITBOT_ROOM_RECENT_MAX || 6),
    maxLine: Number(process.env.BITBOT_ROOM_RECENT_LINE_MAX || 320),
  });
}

/**
 * GP-148 §1-J2：建房回执由 Host 写，不让内核替用户宣布成功。
 * 内核这条意图历史上只会回一句「已计划群聊（GP-50）…」——那是给开发者看的调试
 * 口径，用户读完不知道群到底建没建。这里按 host_results 里的真实结果生成一句
 * 确定回执：真建出来了就报名单，没建出来就点名是谁没找到，绝不粉饰。
 * 返回 "" 表示本轮没有建房效果。
 */
/**
 * 多端在线回执（对话里可见）。
 *
 * 「机器」面板挂在工具轨上，而工具轨是 dev-mode only —— 普通用户其实看不见花名册。
 * 在线这件事又不该只在 dev 面板里成立：手机真的连上来回过话，用户问一句就该在
 * 对话里看到是谁、什么时候的证据。证据来自 Host 记下的 presence（不是内核 seed
 * 出来的固定三台），所以这里只念 Host 已经合并进 machines_list 回包的事实。
 */
function machinePresenceReceiptText(result) {
  const host = (result && Array.isArray(result.host_results)) ? result.host_results : [];
  const hit = host.find((h) => h && h.kind === "machines_list");
  if (!hit || !hit.stdout) return "";
  let payload = null;
  try {
    payload = JSON.parse(hit.stdout);
  } catch (_) {
    return "";
  }
  const rows = payload && Array.isArray(payload.machines) ? payload.machines : [];
  const phones = rows.filter((m) => m && String(m.kind || "").toLowerCase() !== "desktop");
  if (!phones.length) return "";
  const now = Date.now();
  const agoText = (iso) => {
    const at = Date.parse(String(iso || ""));
    if (!Number.isFinite(at)) return "";
    const sec = Math.max(0, Math.round((now - at) / 1000));
    return sec >= 90 ? `${Math.round(sec / 60)} 分钟前` : `${sec} 秒前`;
  };
  const parts = phones.map((m) => {
    const name = String(m.label || m.id || "?") + (m.label && m.id ? `(${m.id})` : `(${m.id || "?"})`);
    const ago = agoText(m.last_seen);
    const online = String(m.status || "").toLowerCase() === "connected";
    if (online && ago) return `${name} 在线（${ago}前有回合）`;
    if (ago) return `${name} 离线（最后证据 ${ago}）`;
    return `${name} 未配对（还没带凭证来说过话）`;
  });
  return "多端在线：" + parts.join("；") + "。";
}

function groupChatReceiptText(result) {
  const host = (result && Array.isArray(result.host_results)) ? result.host_results : [];
  const hit = host.find((h) => h && h.kind === "group_chat");
  if (!hit) return "";
  const room = hit.room || null;
  const names = room && Array.isArray(room.members)
    ? room.members.map((id) => {
        const b = ((surface.loadBots().bots) || []).find((x) => x && x.id === id);
        return String((b && b.name) || id);
      })
    : [];
  if (hit.ok && room && names.length) {
    const title = String(room.title || "").trim() || "（未命名）";
    const head = hit.existing
      ? `群聊「${title}」刚刚已经建好了，这一句没有重复建第二个。`
      : `已创建群聊「${title}」。`;
    return head + `成员 ${names.length} 人：${names.join("、")}。侧栏已打开这个群。`;
  }
  if (!hit.ok && hit.error === "names_not_found") {
    const missing = (Array.isArray(hit.names_not_found) ? hit.names_not_found : [])
      .map((s) => String(s || "").trim()).filter(Boolean);
    const known = (Array.isArray(hit.resolved_names) ? hit.resolved_names : [])
      .map((s) => String(s || "").trim()).filter(Boolean);
    return (
      (missing.length ? `没找到 ${missing.join("、")}，` : "") +
      "所以这个群没有创建。" +
      (known.length ? `认出的人只有 ${known.join("、")}。` : "") +
      "群聊需要 2–6 个真实存在的 Bot，名字对上以后再试一次。"
    );
  }
  if (!hit.ok && hit.error === "members_2_to_6") {
    const n = Number(hit.resolved_count);
    return (
      "这个群没有创建：" +
      (Number.isFinite(n) ? `只认出 ${n} 个成员，` : "") +
      "群聊需要 2–6 个真实存在的 Bot。"
    );
  }
  return "这个群没有创建（Host 拒绝了这次建房请求），没有假装成功。";
}


/**
 * Lead synthesis turn (L4/L5). Deliberately NOT `runRoomResponderTurn`:
 * a synthesis round is not a member round — it must not stamp the lead's
 * "working" state, and it must not be counted as a member answer.
 * One model call, inside the same team budget and cancel scope.
 */
async function runRoomSynthesisTurn(botId, prompt, ctx) {
  const id = String(botId || "").trim();
  if (!id) return { ok: false, error: "synthesis_lead_missing", text: "" };
  const bots = (surface.loadBots().bots) || [];
  const bot = bots.find((b) => b && b.id === id);
  if (!bot) return { ok: false, error: "synthesis_lead_not_found", text: "" };
  const roomId = String((ctx && ctx.room) || "room");
  try {
    const result = await runner.runTurn(String(prompt || ""), {
      sessionId: "room-" + roomId + "-" + id + "-synthesis",
      machineId: resolveMachineId({ kind: "desktop" }),
      machineKind: "desktop",
      channel: "",
      // A summary is a read-only act; it must not be able to trigger effects.
      approved: false,
      botId: id,
      roomId,
      roomContext: buildRoomContext(roomId, id, ctx, String(prompt || "")),
      cancelPromise: (ctx && ctx.cancelPromise) || undefined,
    });
    if (!result || result.ok === false) {
      return { ok: false, error: roomSafeText((result && result.error) || "synthesis_turn_failed"), text: "" };
    }
    const text = ((result.messages || [])
      .filter((m) => m && m.role === "assistant" && m.text)
      .map((m) => String(m.text))
      .join("\n"));
    if (!text.trim()) return { ok: false, error: "synthesis_no_reply", text: "" };
    return { ok: true, text, artifacts: [] };
  } catch (err) {
    return { ok: false, error: roomSafeText((err && err.message) || String(err)), text: "" };
  }
}

/**
 * Model-proposed task decomposition (L4).
 *
 * OFF by default on purpose: this is an EXTRA model call per group message
 * and it is not covered by the team budget (the budget starts at fan-out).
 * The host-side heuristic decomposition is free and runs by default; this
 * only upgrades the quality when the operator opts in.
 * Set BITBOT_ROOM_DECOMPOSE=1 to enable.
 */
async function runRoomDecompositionProposal(input) {
  const opts = input || {};
  if (process.env.BITBOT_ROOM_DECOMPOSE !== "1") {
    return { subtasks: [] };
  }
  const candidates = Array.isArray(opts.candidates) ? opts.candidates : [];
  const roster = candidates
    .map((c) => "- " + String(c.name || c.id || "") + "：" + String(c.job || c.description || ""))
    .join("\n");
  const prompt = [
    "把下面的任务拆成 2 到 " + Math.min(candidates.length || 2, 4) + " 个互不重叠的子任务。",
    "只输出 JSON，形如 {\"subtasks\":[\"子任务1\",\"子任务2\"]}。不要输出其它文字。",
    "任务：" + String(opts.task || ""),
    "可用成员：\n" + roster,
  ].join("\n");
  const roomId = String(opts.room || "room");
  try {
    const result = await runner.runTurn(prompt, {
      sessionId: "room-" + roomId + "-decompose",
      machineId: resolveMachineId({ kind: "desktop" }),
      machineKind: "desktop",
      channel: "",
      approved: false,
      botId: String((candidates[0] && candidates[0].id) || ""),
      roomId,
    });
    const text = ((result && result.messages) || [])
      .filter((m) => m && m.role === "assistant" && m.text)
      .map((m) => String(m.text))
      .join("\n");
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) return { subtasks: [] };
    const parsed = JSON.parse(match[0]);
    const list = Array.isArray(parsed) ? parsed : (parsed && parsed.subtasks);
    if (!Array.isArray(list)) return { subtasks: [] };
    return { subtasks: list.map((t) => String(t && t.title ? t.title : t)).filter(Boolean) };
  } catch (_) {
    // 拆解建议失败不是错误：编排层会退回宿主启发式。
    return { subtasks: [] };
  }
}

/**
 * 群回合运行时(共享实现)。
 * 桌面的 responder / discretion 回合与 CLI/移动端走的是**同一份代码** ——
 * Q-6 的教训就是「扇出只在桌面做」会变成别的端发群消息没人回、还不报错。
 */
const roomRuntime = createRoomRuntime({
  runTurn: (text, ctx) => runner.runTurn(text, ctx),
  surface,
  secretProtocol,
  machineId: resolveMachineId({ kind: "desktop" }),
  machineKind: "desktop",
  onProgress: (row) => broadcast("bitbot:room-turn-progress", row),
  onBotActivity: () => {
    try {
      broadcast("bitbot:bots-changed", surface.listViews());
    } catch (_) {
      /* 广播失败不影响回合 */
    }
  },
});

const runRoomResponderTurn = roomRuntime.runResponderTurn;
const runRoomDiscretionTurn = roomRuntime.runDiscretionTurn;
const selectRoomResponders = roomRuntime.selectResponders;


ipcMain.handle("bitbot:rooms:orchestrate", async (_e, payload) => {
  const roomId = String((payload && payload.room_id) || "").trim();
  const text = String((payload && payload.text) || "").trim();
  if (!roomId || !text) return { ok: false, error: "room_and_text_required" };
  try {
    // 1) 真实路由 + 落 transcript + 扇出,一条路径(shared/room_dispatch)。
    //    桌面和 CLI/移动端走**同一个函数** —— Q-6 的教训就是「扇出只在桌面做」
    //    会变成别的端发群消息没人回、还不报错。
    //    扇出到点名的 responder,收齐后聚合 final_report(N/总 如实)。
    //    预算护栏交给引擎(>6 → too_many_responders),这里不静默截断。
    //    「工作中」态由 engine 在真正扇出时才回调发:幂等命中/护栏拒绝不得闪假态。
    const timeoutMs = Number(process.env.BITBOT_ROOM_RESPONDER_TIMEOUT_MS || 120000);
    const res = await dispatchRoomTurn({
      surface,
      roomId,
      text,
      messageId: String((payload && payload.message_id) || ""),
      deps: {
        runResponderTurn: runRoomResponderTurn,
        selectResponders: selectRoomResponders,
        // L4/L5:综合回合是独立依赖(不是成员回合),它吃同一份团队预算与取消通道。
        synthesize: runRoomSynthesisTurn,
        // 拆解建议:模型只提建议,分工由宿主确定性执行(见 §7 决策 2)。
        proposeDecomposition: runRoomDecompositionProposal,
        // 团队预算(轮次 / 时间 / token 估算)——宿主唯一裁决者。
        maxTurns: Number(process.env.BITBOT_ROOM_BUDGET_TURNS || 7),
        maxWallMs: Number(process.env.BITBOT_ROOM_BUDGET_WALL_MS || 600000),
        maxTokens: Number(process.env.BITBOT_ROOM_BUDGET_TOKENS || 200000),
        maxFailOpen: Number(process.env.BITBOT_ROOM_MAX_FAIL_OPEN || 2),
        duplicateThreshold: Number(process.env.BITBOT_ROOM_DUPLICATE_THRESHOLD || 0.82),
        leadBotId: process.env.BITBOT_ROOM_LEAD_BOT || "",
        timeoutMs,
        onFanout: (ev) => {
          const bots = (surface.loadBots().bots) || [];
          broadcast("bitbot:room-orchestrating", {
            room_id: roomId,
            task: (ev && ev.task) || text,
            responders: ((ev && ev.responders) || []).map((r) => ({
              id: r.id,
              name: (bots.find((b) => b && b.id === r.id) || {}).name || r.name || r.id,
            })),
            member_count: (ev && ev.member_count) || 0,
            policy: (ev && ev.policy) || "",
            at: new Date().toISOString(),
          });
        },
      },
    });
    broadcast("bitbot:room-updated", {
      room_id: roomId,
      ok: Boolean(res && res.ok),
      returned: res && res.returned,
      total: res && res.total,
      partial: Boolean(res && res.partial),
      error: res && res.ok ? undefined : (res && res.error) || "orchestrate_failed",
    });
    // GP-146：广播的是「读得到的目录」，读不到时带 ok:false，渲染层才不会把
    // 存储故障演成「群都消失了」。
    const st = surface.roomsStoreStatus();
    broadcast("bitbot:rooms-changed", st.ok ? { ok: true, rooms: st.rooms } : { ok: false, error: st.error });
    return res;
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err), room_id: roomId };
  }
});

/* GP-154「定时任务在群内部」— 群资料面板的定时任务读写口。
 * 两个设计约束：
 *  1) 写侧不新造调度语义。添加按钮只是把「每天9点…」这类自然语言交给内核，
 *     由内核产出 routine_schedule 效果，再走 executeHostEffects —— 与聊天里
 *     说一句话建的定时任务是同一条路，排程/5 分钟下限/诚实拒绝全都共用。
 *  2) room_id 是可选新字段，只加在 Host 侧的 routine 行上；老行不动，
 *     内核的 effect 三元组（id|cron|prompt）与 IPC 既有契约都不改。 */
ipcMain.handle("bitbot:routines:list", async (_e, payload) => {
  const roomId = String((payload && payload.roomId) || "");
  try {
    return ffi.listRoomRoutines(roomId);
  } catch (err) {
    return {
      ok: false,
      error: String((err && err.message) || err),
      room_id: roomId,
      routines: [],
    };
  }
});

ipcMain.handle("bitbot:routines:op", async (_e, payload) => {
  const text = String((payload && payload.text) || "").trim();
  const roomId = String((payload && payload.roomId) || "");
  if (!text) return { ok: false, error: "empty_request", reply: "" };
  if (!roomId) return { ok: false, error: "room_required", reply: "" };
  const startedAt = Date.now();
  // 先记住这个群现在有哪些定时任务：回执之后要用「真落盘了吗」来判，
  // 而不是照抄内核那句乐观回执（GP-153 的拒绝路径就长在这里）。
  let baseline = null;
  try {
    const pre = ffi.listRoomRoutines(roomId);
    baseline = new Map(
      ((pre && pre.routines) || []).map((r) => [String(r.id || ""), String(r.updated_at || "")]),
    );
  } catch (_) {
    baseline = null;
  }
  let turn;
  try {
    turn = await runner.runTurn(text, {
      botId: String((payload && payload.botId) || ""),
      sessionId: String((payload && payload.sessionId) || "room-" + roomId),
      roomId,
    });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err), reply: "" };
  }
  const msgs = (turn && Array.isArray(turn.messages)) ? turn.messages : [];
  // 施工说明与环境变量名不进面板：与落库/渲染同一形状规则（GP-148）。
  const assistantText = msgs
    .filter((m) => m && m.role === "assistant" && !PRODUCT_DEBUG_RE.test(String(m.text || "")))
    .map((m) => String(m.text));
  const failed = turn && turn.ok === false;
  // 没建成时不能回一句「已建定时任务」——内核的回执是乐观文案，Host 被
  // GP-138/GP-153 拒绝时行根本不存在。真值只认落盘：新增行，或已有行的
  // updated_at 被这次写入推前了。
  let stored = null;
  try {
    const listed = ffi.listRoomRoutines(roomId);
    const rowsNow = (listed && listed.routines) || [];
    if (baseline) {
      stored =
        rowsNow.find((r) => {
          const key = String(r && r.id || "");
          if (!baseline.has(key)) return true;
          return String((r && r.updated_at) || "") !== String(baseline.get(key) || "");
        }) || null;
    }
    // 读不到基线时不能用「有行」当证据 —— 那些行可能本来就在。
  } catch (_) {
    stored = null;
  }
  // 被拒时把 Host 自己写下的 refuse 快照原因带回去，渲染层据此说人话。
  let refuseError = "";
  if (!stored && !failed) {
    try {
      const dir = path.join(DATA_ROOT, "routines");
      const recent = fs
        .readdirSync(dir)
        .filter((f) => /^refuse-.*\.json$/.test(f))
        .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)[0];
      if (recent && recent.m >= startedAt) {
        const j = JSON.parse(fs.readFileSync(path.join(dir, recent.f), "utf8"));
        refuseError = String((j && j.error) || "");
      }
    } catch (_) {
      /* 读不到 refuse 快照就只报 not_stored，不猜原因 */
    }
  }
  const reply = failed || !stored ? "" : assistantText.join("\n");
  broadcast("bitbot:routines-changed", { ok: true, room_id: roomId });
  return {
    ok: Boolean(stored),
    scheduled: Boolean(stored),
    reply,
    routine: stored || null,
    room_id: roomId,
    error: failed
      ? String((turn && turn.error) || "turn_failed")
      : stored
        ? null
        : refuseError || "not_stored",
  };
});

/* GP-158：群资料面板的「暂停 / 继续」。
 * 只把 Host 已有的 routine_pause / routine_resume 能力接到界面，不新建第二条
 * 改库路径：归属校验、存在性校验、真值回执都在 ffi.routineLifecycle 里做。
 * 成功才广播 routines-changed —— 失败时重绘只会把「已暂停」显示成没发生。 */
ipcMain.handle("bitbot:routines:lifecycle", async (_e, payload) => {
  const roomId = String((payload && payload.roomId) || "");
  const id = String((payload && payload.id) || "");
  const action = String((payload && payload.action) || "");
  try {
    const res = ffi.routineLifecycle({ roomId, id, action });
    if (res && res.ok) broadcast("bitbot:routines-changed", { ok: true, room_id: roomId });
    return res;
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err), room_id: roomId };
  }
});

ipcMain.handle("bitbot:computer:state", async () => {
  try {
    return { ok: true, computer: surface.loadComputer() };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), computer: null };
  }
});

ipcMain.handle("bitbot:computer:frame", async (_e, opts) => {
  try {
    const botId = (opts && opts.bot_id) || "agent-bit";
    const comp = surface.loadComputer();
    const screen = (comp.screens && comp.screens[botId]) || null;
    const framePath = screen && screen.frame_path ? screen.frame_path : null;
    if (!framePath || !fs.existsSync(framePath)) {
      return { ok: false, residual: screen && screen.residual ? screen.residual : "no_frame", frame_path: null, data_url: null };
    }
    const buf = fs.readFileSync(framePath);
    const b64 = buf.toString("base64");
    return { ok: true, frame_path: framePath, data_url: "data:image/png;base64," + b64, at: screen.updated_at || null };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), residual: "frame_error" };
  }
});

ipcMain.handle("bitbot:computer:takeover", async (_e, opts) => {
  try {
    const action = String((opts && opts.action) || "");
    if (action === "begin") return surface.beginTakeover(String(opts.bot_id || "agent-bit"), String(opts.reason || ""));
    if (action === "end") return surface.endTakeover();
    return { ok: false, error: "action must be begin|end" };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:usage:week", async () => {
  try {
    return { ok: true, usage: surface.weekView() };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle("bitbot:voice:ingest", async (_e, payload) => {
  // Wave G: store the real recording on Host disk; no STT in sandbox → transcript stays null (never faked).
  try {
    const b64 = String((payload && payload.wav_b64) || "");
    if (!b64) return { ok: false, error: "empty wav", residual: "empty_recording" };
    const dir = path.join(DATA_ROOT, "desktop", "voice");
    fs.mkdirSync(dir, { recursive: true });
    const wavPath = path.join(dir, "voice-" + Date.now().toString(36) + ".wav");
    fs.writeFileSync(wavPath, Buffer.from(b64, "base64"));
    return {
      ok: true,
      wav_path: wavPath,
      bytes: fs.statSync(wavPath).size,
      transcript: null,
      residual: "no_stt",
      pretend_transcript: false,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), residual: "voice_error" };
  }
});

ipcMain.handle("bitbot:notify:turn", async (_e, payload) => {
  try {
    const p = payload || {};
    const botId = String(p.bot_id || "agent-bit");
    const wrap = surface.getSettings();
    const st = (wrap && wrap.settings) || wrap || {};
    const notifyOn = !st.notify ? true : st.notify[botId] !== false;
    const win = mainWindow;
    const focused = Boolean(win && !win.isDestroyed() && win.isFocused() && win.isVisible());
    // GP-80: focus-suppression + per-bot toggle (never notify when window is frontmost).
    if (!notifyOn || focused || !Notification.isSupported()) {
      return { ok: true, shown: false, reason: !notifyOn ? "bot_notify_off" : focused ? "window_focused" : "unsupported" };
    }
    const n = new Notification({ title: String(p.title || "Bit Bot"), body: String(p.body || "").slice(0, 200) });
    n.on("click", () => {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
      broadcast("bitbot:focus-session", { session_id: p.session_id || null, bot_id: botId });
    });
    n.show();
    return { ok: true, shown: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), shown: false };
  }
});

ipcMain.handle("bitbot:badge:set", async (_e, n) => {
  try {
    const count = Number(n) || 0;
    const supported = app.setBadgeCount ? app.setBadgeCount(count) : false;
    return { ok: true, count, set: Boolean(supported), platform: process.platform };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});


ipcMain.handle("bitbot:autostart:get", async () => {
  const settings = app.getLoginItemSettings();
  return {
    ok: true,
    openAtLogin: Boolean(settings.openAtLogin),
    wasOpenedAtLogin: Boolean(settings.wasOpenedAtLogin),
    configured: AUTOSTART_ENABLED,
  };
});

ipcMain.handle("bitbot:autostart:set", async (_e, enabled) => {
  return applyLoginItem(Boolean(enabled));
});

ipcMain.handle("bitbot:daemon:status", async () => {
  const st = readDaemonStatus();
  return {
    ...st,
    child_pid: routineDaemonChild && !routineDaemonChild.killed
      ? routineDaemonChild.pid
      : null,
  };
});

ipcMain.handle("bitbot:daemon:ensure", async () => {
  const res = ensureRoutineDaemon();
  // 手动拉起 daemon 之后重新分工：daemon 在跑就不再让主进程定时器抢。
  syncWakeSource();
  return res;
});

ipcMain.handle("bitbot:llm:status", async () => {
  try {
    const cfg = ffi.resolveLlmConfig();
    return {
      ok: true,
      provider_id: cfg.provider_id,
      label: cfg.label,
      model: cfg.model,
      base_url: cfg.base_url,
      key_configured: Boolean(cfg.key_configured),
      key_source: cfg.key_source,
      env_local_hint: "hosts/desktop/.env.local",
      pretend_ready: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      pretend_ready: false,
    };
  }
});

ipcMain.handle("bitbot:llm:catalog", async () => {
  try {
    if (typeof ffi.listLlmCatalog === "function") {
      return ffi.listLlmCatalog();
    }
    const cfg = ffi.resolveLlmConfig();
    return {
      ok: true,
      active: {
        provider_id: cfg.provider_id,
        label: cfg.label,
        model: cfg.model,
        key_configured: Boolean(cfg.key_configured),
      },
      providers: [],
      pretend_ready: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      pretend_ready: false,
    };
  }
});

/** Honest CN channel live-gate status (钉钉/飞书/企微). Never pretends live. */
function cnChannelGate(name, postEnv, credEnvs) {
  const postOn = process.env[postEnv] === "1";
  const creds = {};
  let anyCred = false;
  for (const k of credEnvs) {
    const present = Boolean(String(process.env[k] || "").trim());
    creds[k] = present;
    if (present) anyCred = true;
  }
  const live_ready = postOn && anyCred;
  return {
    connector: name,
    post_env: postEnv,
    post_enabled: postOn,
    credentials: creds,
    live_ready,
    mode: live_ready ? "live_gated" : "draft_only",
    residual: live_ready
      ? null
      : !postOn
        ? `${postEnv}!=1`
        : "missing channel credential env",
  };
}

ipcMain.handle("bitbot:cn:status", async () => {
  const channels = [
    cnChannelGate("dingtalk", "BITBOT_DINGTALK_POST", [
      "BITBOT_DINGTALK_WEBHOOK",
      "BITBOT_DINGTALK_TOKEN",
    ]),
    cnChannelGate("feishu", "BITBOT_FEISHU_POST", [
      "BITBOT_FEISHU_TOKEN",
      "BITBOT_FEISHU_CHAT_ID",
    ]),
    cnChannelGate("wecom", "BITBOT_WECOM_POST", [
      "BITBOT_WECOM_TOKEN",
      "BITBOT_WECOM_AGENT_ID",
      "BITBOT_WECOM_TOUSER",
    ]),
  ];
  const anyLive = channels.some((c) => c.live_ready);
  return {
    ok: true,
    desktop_first: true,
    // 安卓版已经存在（hosts/android/BitBotHost），「移动暂缓」不再是事实。
    mobile_deferred: false,
    mobile_ready: true,
    channels,
    any_live_ready: anyLive,
    inbound: cnInbound ? cnInbound.status() : { listening: false, residual: "not_started" },
    pretend_live: false,
    hint: anyLive
      ? "至少一条国内渠道 live 门控已开"
      : "国内渠道均为 draft — Settings→凭证 勾选 POST=1 并填写 webhook/token（开放配置，不写死）",
  };
});

ipcMain.handle("bitbot:cn:inbound:status", async () => {
  return cnInbound
    ? cnInbound.status()
    : { ok: false, listening: false, residual: "not_started" };
});

ipcMain.handle("bitbot:secrets:status", async () => {
  const keys = [
    "BITBOT_LLM_API_KEY",
    "BITBOT_LLM_BASE_URL",
    "BITBOT_LLM_MODEL",
    // 凭证页的「接入方式」用 provider_id + base 反推下拉框，
    // 所以这个键要在 status 里回读（写路径本来就在 ALLOWED_SECRET_KEYS 里）。
    "BITBOT_LLM_PROVIDER",
    "BITBOT_LLM_QWEN_API_KEY",
    "BITBOT_LLM_MOONSHOT_API_KEY",
    "BITBOT_SEARCH_PROVIDER",
    "BITBOT_SEARCH_API_KEY",
    "BITBOT_SEARCH_API_BASE",
    "BITBOT_DINGTALK_POST",
    "BITBOT_DINGTALK_WEBHOOK",
    "BITBOT_DINGTALK_TOKEN",
    // 群机器人「加签」密钥：写路径早就在白名单里，但 status 不回读，
    // 于是卡里永远显示「未配置」，用户只能去终端手改 .env.local。
    "BITBOT_DINGTALK_APP_SECRET",
    "BITBOT_FEISHU_POST",
    "BITBOT_FEISHU_TOKEN",
    "BITBOT_FEISHU_CHAT_ID",
    // 飞书事件订阅的两把回调密钥（Encrypt Key / Verification Token）同上：
    // 内网穿透 / 事件订阅要用，写路径可用，读路径漏了。
    "BITBOT_FEISHU_ENCRYPT_KEY",
    "BITBOT_FEISHU_VERIFICATION_TOKEN",
    "BITBOT_WECOM_POST",
    "BITBOT_WECOM_TOKEN",
    // 企微「接收事件服务器」的回调 Token，同上。
    "BITBOT_WECOM_CALLBACK_TOKEN",
    "BITBOT_WECOM_AGENT_ID",
    "BITBOT_WECOM_TOUSER",
    "BITBOT_ICP_FILING",
    "BITBOT_ALGORITHM_FILING",
    "BITBOT_CONTENT_MODERATION",
    "BITBOT_UPDATE_FEED_URL",
  ];
  const fields = {};
  for (const k of keys) {
    const m = maskSecret(process.env[k]);
    fields[k] = {
      present: m.present,
      masked: m.masked,
      // Non-secret toggles / urls may show value when short and non-key-like
      value:
        /_POST$|_MODEL$|_BASE_URL$|_CHAT_ID$|_AGENT_ID$|_TOUSER$|_FILING$|_FEED_URL$|_PROVIDER$|_API_BASE$/.test(
          k,
        ) && !/_TOKEN$|_KEY$|_WEBHOOK$/.test(k)
          ? String(process.env[k] || "")
          : undefined,
    };
  }
  let llm = null;
  try {
    llm = ffi.resolveLlmConfig();
  } catch (_) {
    /* ignore */
  }
  return {
    ok: true,
    path: "hosts/desktop/.env.local",
    fields,
    llm: llm
      ? {
          provider_id: llm.provider_id,
          model: llm.model,
          key_configured: Boolean(llm.key_configured),
        }
      : null,
    pretend_ready: false,
  };
});

ipcMain.handle("bitbot:secrets:set", async (_e, patch) => {
  try {
    const saved = upsertDesktopEnvLocal(patch || {});
    if (!saved.ok) return saved;
    // Re-resolve so subsequent turns see new key without restart.
    loadEnvLocalFiles({ overwrite: true });
    let llm = null;
    try {
      llm = ffi.resolveLlmConfig();
    } catch (_) {
      /* ignore */
    }
    return {
      ...saved,
      llm: llm
        ? {
            provider_id: llm.provider_id,
            model: llm.model,
            key_configured: Boolean(llm.key_configured),
            key_source: llm.key_source,
          }
        : null,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      pretend_saved: false,
    };
  }
});

/**
 * GP-99/100/101/102 — §8.3 secure secret input.
 *
 * The renderer's secret card posts here; the value never travels through
 * `bitbot:turn`, is never added to a session, and never comes back. The reply
 * carries a handle + a `****last4` mask only.
 */
ipcMain.handle("bitbot:secrets:submit", async (_e, payload) => {
  const p = payload && typeof payload === "object" ? payload : {};
  try {
    const res = secretVault.submit(p);
    if (!res.ok) return res;
    // Optional env-key mirror: only for keys the Settings form already owns,
    // so a secret card can't smuggle an arbitrary env name into .env.local.
    if (p.env_key && ALLOWED_SECRET_KEYS.has(String(p.env_key))) {
      const saved = upsertDesktopEnvLocal({ [String(p.env_key)]: String(p.value || "") });
      loadEnvLocalFiles({ overwrite: true });
      res.env_local = saved && saved.ok ? saved.path : null;
      res.env_local_applied = Boolean(saved && saved.ok);
    } else if (p.env_key) {
      res.env_local = null;
      res.env_local_applied = false;
      res.env_local_note = "key not in the Settings allow-list; stored in the Host vault only";
    }
    // The transcript bubble renders `[REDACTED]`; the handle is what the kernel
    // and credential-fill path would receive.
    res.display = secretProtocol.REDACTED;
    res.value_echoed = false;
    res.message =
      "密钥已存入 Host vault（" +
      (res.masked || "****") +
      "）。对话与模型只会看到 " +
      secretProtocol.REDACTED +
      "。";
    return res;
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      value_echoed: false,
      pretend_saved: false,
    };
  }
});
ipcMain.handle("bitbot:secrets:vault", async () => {
  try {
    return secretVault.status();
  } catch (err) {
    return { ok: false, entries: {}, error: String(err && err.message ? err.message : err) };
  }
});
ipcMain.handle("bitbot:secrets:remove", async (_e, name) => {
  try {
    return secretVault.remove(name);
  } catch (err) {
    return { ok: false, removed: false, error: String(err && err.message ? err.message : err) };
  }
});

/**
 * GP-106/107 — §8.5 Privacy Mode. Read-only: the real switch lives in the
 * account provider. We report what we can actually observe and say
 * "unavailable · managed by account" otherwise (never a fake "on").
 */
ipcMain.handle("bitbot:privacy:status", async () => {
  let account = {};
  try {
    const st = await runAccountEffect("account_status", "whoami");
    const payload = (st && st.payload) || {};
    account = payload.active || {};
    // The local profile has no provider-issued privacy claim, so nothing here
    // can mark the status verified; `privacy_verified` stays undefined.
  } catch (_) {
    account = {};
  }
  return computePrivacyStatus({ env: process.env, account });
});

/** Run honest acceptance gate script; never invents PASS. */
ipcMain.handle("bitbot:secrets:runGate", async () => {
  const script = path.join(REPO_ROOT, "scripts/prove_cn_product_acceptance.sh");
  return await new Promise((resolve) => {
    const child = spawn("bash", [script], {
      cwd: REPO_ROOT,
      env: process.env,
      timeout: 120000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      resolve({
        ok: false,
        exit_code: -1,
        error: String(err && err.message ? err.message : err),
        pretend_pass: false,
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exit_code: code,
        stdout: stdout.slice(0, 8000),
        stderr: stderr.slice(0, 2000),
        pretend_pass: false,
        script: "scripts/prove_cn_product_acceptance.sh",
      });
    });
  });
});

/** Probe current LLM config with a tiny completion (real HTTP; no pretend). */
ipcMain.handle("bitbot:secrets:probeLlm", async () => {
  try {
    const results = await ffi.executeHostEffects(
      [{ kind: "llm_chat", command: "ping" }],
      { sessionId: "secrets-probe" },
    );
    const hit = (results || []).find((r) => r && r.kind === "llm_chat") || null;
    return {
      ok: Boolean(hit && hit.ok),
      pretend_probe: false,
      result: hit
        ? {
            ok: hit.ok,
            error: hit.error || "",
            stdout_prefix: String(hit.stdout || "").slice(0, 160),
            provider_id: hit.provider_id,
            model: hit.model,
          }
        : { ok: false, error: "no llm_chat result" },
    };
  } catch (err) {
    return {
      ok: false,
      pretend_probe: false,
      error: String(err && err.message ? err.message : err),
    };
  }
});

/**
 * Probe 钉钉/飞书/企微 live gates with real Host channel_send (no pretend).
 * Unarmed channels return honest residual — never invents live success.
 */
ipcMain.handle("bitbot:secrets:probeCnChannels", async () => {
  const probes = [
    {
      id: "dingtalk",
      post: "BITBOT_DINGTALK_POST",
      addr: "dingtalk:cid-probe",
      body: "Bit Bot 渠道试连 · 钉钉",
    },
    {
      id: "feishu",
      post: "BITBOT_FEISHU_POST",
      addr: `feishu:${String(process.env.BITBOT_FEISHU_CHAT_ID || "oc_probe").trim()}`,
      body: "Bit Bot 渠道试连 · 飞书",
    },
    {
      id: "wecom",
      post: "BITBOT_WECOM_POST",
      addr: `wecom:${String(process.env.BITBOT_WECOM_TOUSER || "BitBotProbe").trim()}`,
      body: "Bit Bot 渠道试连 · 企微",
    },
  ];
  const channels = [];
  for (const p of probes) {
    if (process.env[p.post] !== "1") {
      channels.push({
        connector: p.id,
        armed: false,
        live_ok: false,
        residual: `${p.post}!=1 — Settings→凭证 勾选 live`,
        pretend_live: false,
      });
      continue;
    }
    try {
      const results = await ffi.executeHostEffects(
        [{ kind: "channel_send", command: `${p.addr} :: ${p.body}` }],
        { sessionId: "cn-probe", approved: true },
      );
      const hit =
        (results || []).find((r) => r && r.kind === "channel_send") || null;
      const live =
        Boolean(hit && hit.ok) &&
        (hit.live_post === true ||
          (hit.mode && String(hit.mode).startsWith("live")));
      channels.push({
        connector: p.id,
        armed: true,
        live_ok: live,
        mode: hit && hit.mode,
        error: (hit && hit.error) || (!hit ? "no channel_send result" : ""),
        pretend_live: false,
      });
    } catch (err) {
      channels.push({
        connector: p.id,
        armed: true,
        live_ok: false,
        error: String(err && err.message ? err.message : err),
        pretend_live: false,
      });
    }
  }
  const anyLive = channels.some((c) => c.live_ok);
  return {
    ok: anyLive,
    pretend_probe: false,
    any_live: anyLive,
    channels,
    inbound: cnInbound ? cnInbound.status() : { listening: false },
  };
});

ipcMain.handle("bitbot:product:status", async () => {
  let llm = null;
  try {
    llm =
      typeof ffi.listLlmCatalog === "function"
        ? ffi.listLlmCatalog()
        : { active: ffi.resolveLlmConfig() };
  } catch (_) {
    llm = null;
  }
  const filingIcp = Boolean(String(process.env.BITBOT_ICP_FILING || "").trim());
  const filingAlgo = Boolean(
    String(process.env.BITBOT_ALGORITHM_FILING || "").trim(),
  );
  const moderation = process.env.BITBOT_CONTENT_MODERATION === "1";
  const otaFeed = Boolean(
    String(process.env.BITBOT_UPDATE_FEED_URL || "").trim(),
  );
  return {
    ok: true,
    desktop_first: true,
    mobile_deferred: false,
    mobile_ready: true,
    llm: llm && llm.active ? llm.active : llm,
    filing: {
      icp: filingIcp,
      algorithm: filingAlgo,
      residual: !(filingIcp || filingAlgo),
    },
    content_moderation: { armed: moderation, residual: !moderation },
    ota: {
      feed_configured: otaFeed,
      updater_loaded: Boolean(autoUpdater),
      packaged: app.isPackaged,
      last_check: otaState.last_check,
      last_result: otaState.last_result,
      update_available: otaState.update_available,
      update_downloaded: otaState.update_downloaded,
      error: otaState.error,
      residual: !(otaFeed && autoUpdater && app.isPackaged),
    },
    pretend_complete: false,
  };
});

/** P4 auto-update — real electron-updater against BITBOT_UPDATE_FEED_URL; no pretend. */
ipcMain.handle("bitbot:ota:check", async () => {
  const feed = String(process.env.BITBOT_UPDATE_FEED_URL || "").trim();
  if (!autoUpdater) {
    otaState.error = "electron-updater not installed";
    persistOtaState();
    return {
      ok: false,
      residual: true,
      error: otaState.error,
      pretend_update: false,
    };
  }
  if (!feed) {
    otaState.error = "BITBOT_UPDATE_FEED_URL not set";
    persistOtaState();
    return {
      ok: false,
      residual: true,
      error: otaState.error,
      pretend_update: false,
    };
  }
  if (!app.isPackaged) {
    otaState.error = "OTA check only in packaged app (npm run dist)";
    persistOtaState();
    return {
      ok: false,
      residual: true,
      error: otaState.error,
      pretend_update: false,
      packaged: false,
    };
  }
  try {
    autoUpdater.setFeedURL({ provider: "generic", url: feed });
    autoUpdater.autoDownload = false;
    otaState.update_downloaded = false;
    otaState.last_check = new Date().toISOString();
    const result = await autoUpdater.checkForUpdates();
    const info = result && result.updateInfo ? result.updateInfo : null;
    otaState.last_result = info
      ? { version: info.version, path: info.path || null }
      : null;
    otaState.update_available = Boolean(info);
    otaState.error = null;
    persistOtaState();
    return {
      ok: true,
      residual: false,
      update_available: otaState.update_available,
      info: otaState.last_result,
      pretend_update: false,
    };
  } catch (err) {
    otaState.error = String(err && err.message ? err.message : err);
    persistOtaState();
    return {
      ok: false,
      residual: true,
      error: otaState.error,
      pretend_update: false,
    };
  }
});

/** GP-73: download + restart-to-update — only ever real (electron-updater). */
ipcMain.handle("bitbot:ota:download", async () => {
  if (!autoUpdater || !app.isPackaged || !otaState.update_available) {
    return { ok: false, residual: true, error: "no update to download", pretend_update: false };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true, residual: false, downloading: true };
  } catch (err) {
    return { ok: false, residual: true, error: String(err && err.message ? err.message : err) };
  }
});
ipcMain.handle("bitbot:ota:restart", async () => {
  if (!autoUpdater || !otaState.update_downloaded) {
    return { ok: false, residual: true, error: "update not downloaded", pretend_update: false };
  }
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true, residual: false, restarting: true };
});

/**
 * GP-A2/A3 — Connect apps panel reads/toggles through the same Host raw
 * handlers the kernel effects use (single durable store, never a fake list).
 */
/**
 * GP-74 — Account panel reads/writes the LOCAL profile only (same shared-Host
 * path the kernel effects use; single durable store, never a fake identity).
 */
async function runAccountEffect(kind, command) {
  try {
    const results = await ffi.executeHostEffects(
      [{ kind, command }],
      { sessionId: "account-panel" },
    );
    const hit = (results || []).find((r) => r && r.kind === kind);
    let payload = {};
    try {
      payload = JSON.parse((hit && hit.stdout) || "{}");
    } catch {
      payload = {};
    }
    return {
      ok: Boolean(hit && hit.ok),
      refused: Boolean(payload.refused),
      payload,
      error: payload.error || (hit && !hit.ok ? hit.error || "host_failed" : undefined),
    };
  } catch (err) {
    return {
      ok: false,
      payload: {},
      error: String(err && err.message ? err.message : err),
    };
  }
}
ipcMain.handle("bitbot:account:status", async () =>
  runAccountEffect("account_status", "whoami"),
);
ipcMain.handle("bitbot:account:signIn", async (_e, label) =>
  runAccountEffect("account_sign_in", String(label || "").trim().replace(/ /g, "+")),
);
ipcMain.handle("bitbot:account:signOut", async () =>
  runAccountEffect("account_sign_out", "local"),
);
ipcMain.handle("bitbot:account:switch", async (_e, label) =>
  runAccountEffect("account_switch", String(label || "").trim().replace(/ /g, "+")),
);
/** GP-77: install/update state for the Updates tab (read-only shared-Host kind). */
ipcMain.handle("bitbot:app:updateStatus", async () => {
  try {
    const results = await ffi.executeHostEffects(
      [{ kind: "update_status", command: "install" }],
      { sessionId: "updates-tab" },
    );
    const hit = (results || []).find((r) => r && r.kind === "update_status");
    let payload = {};
    try {
      payload = JSON.parse((hit && hit.stdout) || "{}");
    } catch {
      payload = {};
    }
    return { ok: Boolean(hit && hit.ok), payload, pretend_state: false };
  } catch (err) {
    return {
      ok: false,
      payload: {},
      error: String(err && err.message ? err.message : err),
      pretend_state: false,
    };
  }
});

ipcMain.handle("bitbot:plugins:list", async (_e, opts) => {
  try {
    const query = String((opts && opts.query) || "");
    const results = await ffi.executeHostEffects(
      [{ kind: "mcp_list_plugins", command: query ? "q=" + query : "q=" }],
      { sessionId: "plugins-panel" },
    );
    const hit = (results || []).find((r) => r && r.kind === "mcp_list_plugins");
    let payload = {};
    try {
      payload = JSON.parse((hit && hit.stdout) || "{}");
    } catch {
      payload = {};
    }
    return {
      ok: Boolean(hit && hit.ok),
      plugins: Array.isArray(payload.plugins) ? payload.plugins : [],
      count: payload.count != null ? payload.count : null,
      query: payload.query || query || null,
      error: hit && !hit.ok ? hit.error || "host_failed" : undefined,
      pretend_listing: false,
    };
  } catch (err) {
    return {
      ok: false,
      plugins: [],
      error: String(err && err.message ? err.message : err),
      pretend_listing: false,
    };
  }
});
ipcMain.handle("bitbot:plugins:toolToggle", async (_e, opts) => {
  const ns = String((opts && opts.namespace) || "").trim();
  const tool = String((opts && opts.tool) || "").trim();
  const enabled = Boolean(opts && opts.enabled);
  if (!ns || !tool) return { ok: false, error: "namespace+tool required" };
  try {
    const results = await ffi.executeHostEffects(
      [{ kind: "mcp_tool_toggle", command: `${ns}|${tool}|${enabled ? "on" : "off"}` }],
      { sessionId: "plugins-panel" },
    );
    const hit = (results || []).find((r) => r && r.kind === "mcp_tool_toggle");
    let payload = {};
    try {
      payload = JSON.parse((hit && hit.stdout) || "{}");
    } catch {
      payload = {};
    }
    return {
      ok: Boolean(hit && hit.ok),
      refused: Boolean(payload.refused),
      error: payload.error || (hit && !hit.ok ? hit.error || "host_failed" : undefined),
      namespace: payload.namespace || ns,
      tool: payload.tool || tool,
      enabled: payload.enabled === undefined ? null : Boolean(payload.enabled),
      pretend_toggled: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      pretend_toggled: false,
    };
  }
});
/**
 * GP-A2: Add / Uninstall from the Connect apps panel. Same Host raw handlers
 * as the kernel InstallPlugin / UninstallPlugin effects (durable stores,
 * honest refusal for unknown ids; no transcript noise for menu clicks).
 */
ipcMain.handle("bitbot:plugins:op", async (_e, opts) => {
  const action = String((opts && opts.action) || "");
  const pluginId = String((opts && opts.plugin_id) || "").trim();
  if (!pluginId || (action !== "install" && action !== "uninstall")) {
    return { ok: false, error: "action must be install|uninstall with plugin_id" };
  }
  const kind = action === "install" ? "mcp_namespace" : "mcp_uninstall";
  try {
    const results = await ffi.executeHostEffects(
      [{ kind, command: pluginId }],
      { sessionId: "plugins-panel" },
    );
    const hit = (results || []).find((r) => r && r.kind === kind);
    let payload = {};
    try {
      payload = JSON.parse((hit && hit.stdout) || "{}");
    } catch {
      payload = {};
    }
    return {
      ok: Boolean(hit && hit.ok),
      refused: Boolean(payload.refused),
      error: payload.error || (hit && !hit.ok ? hit.error || "host_failed" : undefined),
      plugin_id: payload.plugin_id || pluginId,
      namespace: payload.namespace || null,
      status: payload.status || null,
      skills: Array.isArray(payload.skills) ? payload.skills : null,
      tools: Array.isArray(payload.tools) ? payload.tools : null,
      pretend_registered: false,
      pretend_uninstalled: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
});

ipcMain.handle("bitbot:turn:cancel", async () => {
  if (typeof releaseActiveTurnCancel === "function") releaseActiveTurnCancel();
  return { ok: true };
});

ipcMain.handle("bitbot:turn", async (_event, text, opts = {}) => {
  // Optional per-turn Host env (e.g. BITBOT_SLACK_CLAIM) — restore after turn.
  const envPatch = (opts && opts.env && typeof opts.env === "object") ? opts.env : null;
  const prev = {};
  if (envPatch) {
    for (const [k, v] of Object.entries(envPatch)) {
      prev[k] = process.env[k];
      if (v === null || v === undefined || v === "") delete process.env[k];
      else process.env[k] = String(v);
    }
  }
  const sessionId =
    String((opts && opts.sessionId) || sessions.activeId() || "desktop-session");
  // GP-98: the turn returns its real progress trail so the renderer (and tests)
  // can distinguish "ran and failed" from "never ran".
  const progressRows = [];
  try {
    broadcast("bitbot:llm-stream", {
      phase: "start",
      session_id: sessionId,
      user: String(text || "").slice(0, 200),
    });
    let releaseCancel = () => {};
    const cancelState = { requested: false };
    const cancelPromise = new Promise((resolve) => {
      releaseCancel = () => {
        if (cancelState.requested) return;
        cancelState.requested = true;
        resolve();
      };
    });
    releaseActiveTurnCancel = releaseCancel;
    const hostTurnId = "desktop-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    const result = await runner.runTurn(String(text || ""), {
      sessionId,
      machineId: resolveMachineId({ kind: "desktop" }),
      machineKind: "desktop",
      channel: "",
      turnId: hostTurnId,
      approved: !!(opts && opts.approved),
      cliApproved: false,
      requestApproval: (req) => resolveProductApproval(req, hostTurnId),
      // Replica C4/C6: composer web-search toggle for this turn.
      search: !!(opts && opts.webSearch),
      // GP-30: which Bot owns this turn — the Host's per-Bot computer-use
      // lock keys on it (renderer sets activeBotId when a Bot chat is opened).
      botId: String((opts && opts.botId) || "").trim() || undefined,
      // GP-14: Reply targets a specific message id; the kernel carries the id
      // and this resolver turns it into the quoted text for the provider call.
      replyTo: String((opts && opts.replyTo) || "").trim() || undefined,
      resolveReply: (id) => sessions.findMessage(id),
      // GP-96/97 (§5.7 实时进度): every real effect boundary streams here and is
      // broadcast to the renderer, so the transcript shows work-in-progress
      // while the turn is still running — not one dump at the end.
      onProgress: (ev) => {
        const row = Object.assign({}, ev, {
          session_id: String((ev && ev.session_id) || sessionId),
        });
        progressRows.push(row);
        broadcast("bitbot:turn-progress", row);
      },
      // Kernel AgentLoop lines, forwarded as AgentStep. The renderer only
      // displays them. This handler does not call the model again.
      onLoop: (line) => {
        const step = projectAgentStep(line);
        if (!step) return;
        const row = Object.assign(
          { session_id: sessionId, at: Date.now() },
          step,
        );
        broadcast("bitbot:agent-loop", row);
        const tracePath = process.env.BITBOT_AGENT_LOOP_TRACE;
        if (tracePath) {
          try {
            fs.appendFileSync(tracePath, JSON.stringify(row) + "\n");
          } catch (_) {
            /* evidence file is optional */
          }
        }
      },
      isCancelled: () => cancelState.requested,
      cancelPromise,
    });
    // Replica C6: surface real search sources on the final assistant line so the
    // renderer can draw citations; a missing key degrades honestly (a note).
    if (result && result.search) {
      const srch = result.search;
      if (srch.ok && Array.isArray(srch.sources) && srch.sources.length) {
        const arr = Array.isArray(result.messages) ? result.messages : [];
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i] && arr[i].role === "assistant") {
            arr[i] = Object.assign({}, arr[i], { sources: srch.sources });
            break;
          }
        }
      } else if (srch.error === "search_key_not_configured" && Array.isArray(result.messages)) {
        result.messages.push({
          role: "assistant",
          text: "联网搜索未启用：还没有配置搜索密钥（设置 → 凭证 → 联网搜索 里填 Tavily/Brave key）。本轮按普通对话处理，没有假装查过。",
        });
      }
    }
    const rawText = String(text || "").trim();
    // GP-148 §1-J2：把 Host 的建房事实变成用户看得见的一句回执，并让侧栏立刻
    // 刷新。回执走的是 result.messages 这条既有通道（可选新增一条 assistant
    // 行），所以既进 transcript，也进 session 存储，渲染层不需要新契约。
    let roomReceipt = "";
    try {
      roomReceipt = groupChatReceiptText(result);
    } catch (_) {
      roomReceipt = "";
    }
    if (roomReceipt) {
      if (result && Array.isArray(result.messages)) {
        result.messages.push({ role: "assistant", text: roomReceipt });
      }      const touched = ((result && result.host_results) || [])
        .find((h) => h && h.kind === "group_chat");
      if (touched && touched.ok) {
        try {
          const st = surface.roomsStoreStatus();
          broadcast("bitbot:rooms-changed", st && st.ok ? { ok: true, rooms: st.rooms } : { ok: false, error: (st && st.error) || "rooms_unavailable" });
        } catch (_) {
          broadcast("bitbot:rooms-changed", { ok: false, error: "rooms_unavailable" });
        }
      }
    }
    // 多端在线回执：花名册挂在 dev-only 的工具轨上，普通用户看不见；而且
    // 「iOS/Android 到底连没连上」是用户问一句就该得到答案的事。这里只念 Host
    // 已经合并进 machines_list 回包里的证据（last_seen / presence_evidence）。
    let presenceReceipt = "";
    try {
      presenceReceipt = machinePresenceReceiptText(result);
    } catch (_) {
      presenceReceipt = "";
    }
    if (presenceReceipt && result && Array.isArray(result.messages)) {
      result.messages.push({ role: "assistant", text: presenceReceipt });
    }
    const skipSession =
      !!(opts && opts.skipSession) ||
      /^listmachines$/i.test(rawText) ||
      /^list machines$/i.test(rawText);
    if (!skipSession) {
      const toStore = [];
      // GP-102: never persist the raw composer text if the kernel refused it as
      // a pasted credential — the kernel's user row is the redacted form.
      const kernelUser =
        result && Array.isArray(result.messages) && result.messages[0] &&
        result.messages[0].role === "user"
          ? String(result.messages[0].text || "")
          : "";
      const tokenRefused =
        result && result.ok === false && /token paste rejected/.test(String(result.error || ""));
      const userRow = {
        role: "user",
        text: tokenRefused && kernelUser ? kernelUser : String(text || ""),
      };
      // GP-14: persist which message this turn replied to (kernel-echoed id).
      if (result && result.reply_to) userRow.reply_to = String(result.reply_to);
      toStore.push(userRow);
      if (result && Array.isArray(result.messages)) {
        const withheld = [];
        for (const m of result.messages) {
          if (m && m.role === "assistant" && m.text) {
            // GP-148 §1-J4：调试口径不写进用户历史，但原文留在 debug_messages，
            // 不假装它没发生。
            if (PRODUCT_DEBUG_RE.test(String(m.text))) {
              withheld.push(String(m.text));
              continue;
            }
            toStore.push({ role: "assistant", text: m.text });
          }
        }
        if (withheld.length && result && typeof result === "object") {
          result.debug_messages = withheld;
        }
      }
      const appended = sessions.appendMessages(sessionId, toStore);
      // GP-14: Reply needs the *store* ids, so hand them back in the same order
      // the renderer draws bubbles (user bubble first, then assistant lines).
      if (appended && appended.ok && appended.session) {
        const rows = appended.session.messages || [];
        const ids = rows.slice(rows.length - toStore.length).map((r) => r.id);
        result.stored_ids = {
          user: ids[0] || "",
          assistant: ids.slice(1),
        };
      }
      broadcast("bitbot:sessions-changed", sessions.list());
    }
    if (result && typeof result === "object") result.progress = progressRows;
    // GP-117 (§2.1): a turn that belongs to a Bot is real activity, so the
    // sidebar can order Bots by when they were last used. Unknown ids are
    // ignored by the surface (it never invents a row).
    let botActivity = null;
    if (!skipSession) {
      const touchedId = String((opts && opts.botId) || "").trim() || "agent-bit";
      try {
        botActivity = surface.touchBotActivity(touchedId);
        if (botActivity && botActivity.ok) {
          broadcast("bitbot:bots-changed", surface.listViews());
        }
      } catch (_) {
        botActivity = { ok: false, error: "touch_failed" };
      }
    }
    if (result && typeof result === "object") result.bot_activity = botActivity;
    broadcast("bitbot:llm-stream", {
      phase: "end",
      session_id: sessionId,
      ok: Boolean(result && result.ok),
    });
    return result;
  } finally {
    finishLiveLoopApproval("deny");
    releaseActiveTurnCancel = null;
    if (envPatch) {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }
});

/** Replica C3: regenerate an assistant reply. Removes the old entry, re-runs the
 *  preceding user prompt through the same turn pipeline, and stores only the new
 *  assistant rows (so the user bubble is never duplicated). */
ipcMain.handle("bitbot:msg:regenerate", async (_e, payload) => {
  const p = payload || {};
  const sessionId = String(p.sessionId || sessions.activeId() || "").trim();
  const entryId = String(p.entryId || "").trim();
  if (!sessionId || !entryId) return { ok: false, error: "invalid_request" };
  const got = sessions.get(sessionId);
  if (!got || !got.ok || !got.session) return { ok: false, error: "session_not_found" };
  const msgs = Array.isArray(got.session.messages) ? got.session.messages : [];
  let idx = -1;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i] && String(msgs[i].id) === entryId) { idx = i; break; }
  }
  if (idx < 0) return { ok: false, error: "message_not_found" };
  if (msgs[idx].role !== "assistant") return { ok: false, error: "not_assistant" };
  let prompt = "";
  for (let i = idx - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].role === "user") { prompt = String(msgs[i].text || ""); break; }
  }
  if (!prompt) return { ok: false, error: "no_prompt" };
  const rm = sessions.removeMessage(sessionId, entryId);
  if (rm && rm.ok === false) return { ok: false, error: rm.error || "remove_failed" };
  const result = await runner.runTurn(prompt, {
    sessionId,
    machineId: resolveMachineId({ kind: "desktop" }),
    machineKind: "desktop",
    channel: "",
    approved: false,
  });
  const toStore = [];
  if (result && Array.isArray(result.messages)) {
    for (const m of result.messages) {
      if (m && m.role === "assistant" && m.text && !PRODUCT_DEBUG_RE.test(String(m.text))) {
        toStore.push({ role: "assistant", text: m.text });
      }
    }
  }
  const appended = sessions.appendMessages(sessionId, toStore);
  let assistantIds = [];
  if (appended && appended.ok && appended.session) {
    const rows = appended.session.messages || [];
    assistantIds = rows.slice(rows.length - toStore.length).map((r) => r.id);
  }
  broadcast("bitbot:sessions-changed", sessions.list());
  return {
    ok: Boolean(result && result.ok !== false),
    messages: toStore.map((r) => r.text),
    stored_ids: { assistant: assistantIds },
    error: result && result.ok === false ? String(result.error || "") : "",
  };
});

/** CHARTER Delivery: read Host artifact under repo for inline Desktop preview. */
ipcMain.handle("bitbot:readArtifact", async (_event, artifactPath) => {
  const raw = String(artifactPath || "").trim();
  if (!raw) return { ok: false, error: "empty path" };
  let resolved;
  try {
    resolved = path.resolve(raw);
  } catch {
    return { ok: false, error: "invalid path" };
  }
  const roots = [path.resolve(REPO_ROOT), path.resolve(DATA_ROOT)].filter(Boolean);
  const inside = roots.some((r) => resolved === r || resolved.startsWith(r + path.sep));
  if (!inside) {
    return { ok: false, error: "path outside repo", pretend_read: false };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, error: "missing file", pretend_read: false };
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime =
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".html": "text/html",
      ".htm": "text/html",
      ".md": "text/markdown",
      ".txt": "text/plain",
      ".json": "application/json",
      ".csv": "text/csv",
      ".ics": "text/calendar",
      ".eml": "message/rfc822",
      ".yaml": "text/yaml",
      ".yml": "text/yaml",
    }[ext] || null;
  // GP-90: unknown extensions preview as text when they look texty (≤64KB).
  let textish = false;
  if (!mime) {
    const probe = fs.readFileSync(resolved);
    if (probe.length > 64 * 1024) {
      return {
        ok: false,
        error: "unsupported media type",
        path: resolved,
        pretend_read: false,
      };
    }
    if (probe.subarray(0, 1024).includes(0)) {
      return {
        ok: false,
        error: "unsupported media type",
        path: resolved,
        pretend_read: false,
      };
    }
    textish = true;
  }
  const buf = fs.readFileSync(resolved);
  // Cap inline preview size (Desktop UI; full file still on disk).
  if (buf.length > 8 * 1024 * 1024) {
    return {
      ok: false,
      error: "artifact too large for inline preview",
      path: resolved,
      bytes: buf.length,
      pretend_read: false,
    };
  }
  // HTML: return text for sandboxed iframe srcdoc (CM-2103 delivery).
  if (mime === "text/html") {
    return {
      ok: true,
      path: resolved,
      mime,
      bytes: buf.length,
      text: buf.toString("utf8"),
      pretend_read: false,
    };
  }
  // GP-90: text-family previews (md/txt/json/csv/ics/eml/yaml + texty unknowns).
  const asText =
    textish ||
    (mime &&
      (mime.startsWith("text/") ||
        mime === "application/json" ||
        mime === "message/rfc822"));
  if (asText) {
    return {
      ok: true,
      path: resolved,
      mime: mime || "text/plain",
      bytes: buf.length,
      text: buf.toString("utf8"),
      pretend_read: false,
    };
  }
  return {
    ok: true,
    path: resolved,
    mime,
    bytes: buf.length,
    data_url: "data:" + mime + ";base64," + buf.toString("base64"),
    pretend_read: false,
  };
});

/** GP-91: Save file… — copy a repo artifact to a user-chosen path. */
ipcMain.handle("bitbot:saveArtifact", async (_event, artifactPath) => {
  const raw = String(artifactPath || "").trim();
  if (!raw) return { ok: false, error: "empty path" };
  let resolved;
  try {
    resolved = path.resolve(raw);
  } catch {
    return { ok: false, error: "invalid path" };
  }
  const roots = [path.resolve(REPO_ROOT), path.resolve(DATA_ROOT)].filter(Boolean);
  const inside = roots.some((r) => resolved === r || resolved.startsWith(r + path.sep));
  if (!inside) {
    return { ok: false, error: "path outside repo", pretend_saved: false };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, error: "missing file", pretend_saved: false };
  }
  try {
    // Headless smoke override: real copy to a fixed dir (no modal dialog).
    const dirOverride = String(process.env.BITBOT_SAVE_ARTIFACT_DIR || "").trim();
    if (dirOverride) {
      fs.mkdirSync(dirOverride, { recursive: true });
      const dest = path.join(dirOverride, path.basename(resolved));
      fs.copyFileSync(resolved, dest);
      return {
        ok: true,
        saved_path: dest,
        bytes: fs.statSync(resolved).size,
        headless: true,
        pretend_saved: false,
      };
    }
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const opts = {
      defaultPath: path.basename(resolved),
      properties: ["openFile", "createDirectory"],
    };
    const res = win
      ? await dialog.showSaveDialog(win, opts)
      : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) {
      return { ok: false, canceled: true, pretend_saved: false };
    }
    fs.copyFileSync(resolved, res.filePath);
    return {
      ok: true,
      saved_path: res.filePath,
      bytes: fs.statSync(resolved).size,
      pretend_saved: false,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      pretend_saved: false,
    };
  }
});

/** CHARTER Delivery: open Host attachment with OS handler (pptx/ics/eml/…). */
ipcMain.handle("bitbot:openArtifact", async (_event, artifactPath) => {
  const raw = String(artifactPath || "").trim();
  if (!raw) return { ok: false, error: "empty path", pretend_open: false };
  let resolved;
  try {
    resolved = path.resolve(raw);
  } catch {
    return { ok: false, error: "invalid path", pretend_open: false };
  }
  const roots = [path.resolve(REPO_ROOT), path.resolve(DATA_ROOT)].filter(Boolean);
  const inside = roots.some((r) => resolved === r || resolved.startsWith(r + path.sep));
  if (!inside) {
    return { ok: false, error: "path outside repo", pretend_open: false };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, error: "missing file", pretend_open: false };
  }
  const err = await shell.openPath(resolved);
  if (err) {
    return {
      ok: false,
      error: err,
      path: resolved,
      pretend_open: false,
    };
  }
  return {
    ok: true,
    path: resolved,
    bytes: fs.statSync(resolved).size,
    pretend_open: false,
  };
});

async function ensureCnInbound() {
  if (process.env.BITBOT_CN_INBOUND === "0") {
    return { ok: false, skipped: true, reason: "BITBOT_CN_INBOUND=0" };
  }
  if (!cnInbound) {
    // 上次用户打开过「允许手机连接」，重启之后还得算数（偏好只在这个文件里）。
    if (!process.env.BITBOT_BIND_LAN && readPairingPrefs().lan_enabled) {
      process.env.BITBOT_BIND_LAN = "1";
    }
    cnInbound = createCnInboundServer({
      repoRoot: REPO_ROOT,
      pairingManager: pairingCodeManager,
      onTurn: async (prompt, meta) => {
        const channel = (meta && meta.channel) || "in";
        const machineKind =
          (meta && meta.machine_kind) ||
          (channel === "android" || channel === "ios" ? channel : "desktop");
        const sessionId =
          (meta && meta.session_id) || `cn-${channel}`;
        broadcast("bitbot:llm-stream", {
          phase: "start",
          session_id: sessionId,
          user: String(prompt || "").slice(0, 200),
          channel,
          machine_kind: machineKind,
        });
        const result = await runner.runTurn(String(prompt || ""), {
          sessionId,
          machineId: resolveMachineId({ kind: machineKind }),
          machineKind,
          channel: channel === "android" || channel === "ios" ? "" : channel,
          approved: false,
        });
        broadcast("bitbot:llm-stream", {
          phase: "end",
          session_id: sessionId,
          ok: Boolean(result && result.ok),
        });
        return result;
      },
    });
  }
  return cnInbound.start();
}

/* ---------- 手机配对（移动版 · ADR 0008） -------------------------------- *
 * 手机要连的就是这台桌面大脑，但 /v1/turn 默认只绑 127.0.0.1；放开局域网以前
 * 只有翻 BITBOT_BIND_LAN 的人做得到 —— 界面上既看不见地址也拿不到令牌，于是
 * 「手机连桌面大脑」停在 README 里，而不是产品里。开关偏好落在
 * data/desktop/pairing.json：一个新增的本地文件，不动既有 store 契约。
 * ------------------------------------------------------------------------ */
function pairingPrefsFile() {
  return path.join(REPO_ROOT, "data", "desktop", "pairing.json");
}

function readPairingPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(pairingPrefsFile(), "utf8"));
    return { lan_enabled: Boolean(raw && raw.lan_enabled === true) };
  } catch (_e) {
    return { lan_enabled: false };
  }
}

function writePairingPrefs(prefs) {
  try {
    const dir = path.dirname(pairingPrefsFile());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      pairingPrefsFile(),
      JSON.stringify(
        {
          lan_enabled: Boolean(prefs && prefs.lan_enabled),
          at: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    return true;
  } catch (_e) {
    return false;
  }
}

// 配对地址该给哪一个：共享模块按网段 + 网卡命名排序（docker0 / 169.254 / 公网
// 地址不能顶在第一位，手机敲那些一定失败）。只做排序，不编地址。
let lanRank;
try {
  lanRank = require("./shared/lan_candidates");
} catch (_e) {
  lanRank = require("../shared/lan_candidates");
}

/** 这台机器上网卡里的 IPv4 —— 手机真的能敲到的排在最前。 */
function lanIPv4Addresses() {
  try {
    return lanRank.lanIPv4List(os.networkInterfaces() || {});
  } catch (_e) {
    /* 读不到网卡就老实说没有，不编地址 */
    return [];
  }
}

/** 带网卡名与范围的候选，界面用来如实标注「这个地址是从哪块网卡来的」。 */
function lanIPv4Candidates() {
  try {
    return lanRank.rankLanIPv4(os.networkInterfaces() || {});
  } catch (_e) {
    return [];
  }
}

function maskPairingToken(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 8) return "••••";
  return s.slice(0, 4) + "…" + s.slice(-4);
}

function turnTokenValue() {
  try {
    return String(p0.resolveTurnToken(REPO_ROOT, process.env, {}).token || "");
  } catch (_e) {
    return "";
  }
}

function pairingState() {
  const st = cnInbound
    ? cnInbound.status()
    : { listening: false, host: "", port: 0, lan: false };
  const port = Number(st.port || 0);
  const listening = Boolean(st.listening);
  const lanOpen = listening && Boolean(st.lan || st.host === "0.0.0.0");
  const ips = lanOpen ? lanIPv4Addresses() : [];
  const detail = lanOpen ? lanIPv4Candidates() : [];
  // 手机「凭证」里要填的是配对地址（http://ip:port），/v1/turn 由手机端自己补
  // （hosts/android TurnBridge.turnEndpoint，有 JVM 单测钉住）。界面上把两者分开：
  // 普通用户看到的这一行不再带路径，开发态才给完整端点。
  const base = ips.length ? `http://${ips[0]}:${port}` : port ? `http://127.0.0.1:${port}` : "";
  // Pairing-v1: optional code fields (only present when a code is active).
  const codeStatus = pairingCodeManager.status();
  const result = {
    ok: true,
    listening,
    port,
    lan_enabled: readPairingPrefs().lan_enabled,
    lan_open: lanOpen,
    lan_ips: ips,
    lan_detail: detail,
    pair_base: base,
    pair_scope: detail.length ? String(detail[0].scope || "") : "",
    turn_urls: ips.map((ip) => `http://${ip}:${port}/v1/turn`),
    loopback_url: port ? `http://127.0.0.1:${port}/v1/turn` : "",
    loopback_base: port ? `http://127.0.0.1:${port}` : "",
    token_masked: maskPairingToken(turnTokenValue()),
    mobile_ready: true,
    pretend_paired: false,
  };
  // Only add code fields when active (spec: optional new fields).
  if (codeStatus.code_active) {
    result.pair_code = codeStatus.code;
    result.pair_code_expires_in_ms = codeStatus.expires_in_ms;
    result.pair_code_attempts_left = codeStatus.attempts_left;
  }
  return result;
}

ipcMain.handle("bitbot:pairing:state", async () => pairingState());

// Pairing-v1: issue or revoke a 6-digit pairing code (IPC, local only).
ipcMain.handle("bitbot:pairing:code", async (_e, payload) => {
  const action = String((payload && payload.action) || "").trim();
  if (action === "issue") {
    const r = pairingCodeManager.issue();
    return {
      ok: true,
      code: r.code,
      expires_in_ms: r.expires_in_ms,
      attempts_left: r.attempts_left,
    };
  }
  if (action === "revoke") {
    pairingCodeManager.revoke();
    return { ok: true, code: "" };
  }
  return { ok: false, error: "unknown_action" };
});

/** 令牌只在用户明确点「显示」时给出原文；默认状态里只有掩码。 */
ipcMain.handle("bitbot:pairing:token", async () => {
  const token = turnTokenValue();
  if (!token) return { ok: false, error: "token_unavailable" };
  return { ok: true, token, masked: maskPairingToken(token) };
});

/** 手机上手敲 64 位令牌不是「走通」，所以给一个复制入口。 */
ipcMain.handle("bitbot:pairing:copy", async (_e, what) => {
  const st = pairingState();
  // 复制出去的就是「凭证」里那一栏要的东西：配对地址（http://ip:port）。
  // 路径由手机端自己补，用户多抄一段 /v1/turn 反而容易出错。
  const text =
    what === "token" ? turnTokenValue() : (st.pair_base || st.loopback_base || "");
  if (!text) return { ok: false, error: "nothing_to_copy" };
  try {
    clipboard.writeText(String(text));
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
  return { ok: true, kind: String(what || "url"), length: String(text).length };
});

/**
 * 允许 / 禁止局域网里的手机连进来。ADR 0008 默认 loopback；这里改的是同一个
 * 开关（BITBOT_BIND_LAN），并把入站监听重建一次 —— 端口、鉴权、路由都不变。
 */
ipcMain.handle("bitbot:pairing:lan", async (_e, enabled) => {
  const next = Boolean(enabled);
  if (!writePairingPrefs({ lan_enabled: next })) {
    return { ok: false, error: "pairing_prefs_write_failed", ...pairingState() };
  }
  if (next) process.env.BITBOT_BIND_LAN = "1";
  else delete process.env.BITBOT_BIND_LAN;
  try {
    if (cnInbound) {
      await cnInbound.stop();
      cnInbound = null;
    }
    await ensureCnInbound();
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      ...pairingState(),
    };
  }
  return { ok: true, ...pairingState() };
});

app.whenReady().then(async () => {
  // GP-77: install state on disk for the shared Host `update_status` reader.
  persistAppInstallState();
  if (process.platform === "darwin" && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, "build", "icon.png"));
    } catch (_) { /* keep the default if the bundled icon is unavailable */ }
  }
  if (process.env.BITBOT_DESKTOP_SMOKE_TURN !== undefined) {
    return runSmokeTurnAndExit();
  }
  // GP-70: persisted appearance wins over OS default at boot.
  try {
    const stBoot = surface.settingsGet();
    if (stBoot && stBoot.appearance) applyAppearance(String(stBoot.appearance));
  } catch (_) { /* keep OS default */ }
  // GP-A1: app menu with accelerators (Cmd/Ctrl+B sidebar, Cmd/Ctrl+N new chat).
  const appMenu = Menu.buildFromTemplate([
    {
      label: "Bit Bot",
      submenu: [
        {
          label: "新对话",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            sessions.create("新对话");
            broadcast("bitbot:sessions-changed", sessions.list());
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
              mainWindow.webContents.send("bitbot:menu-new-chat", {});
            }
          },
        },
        {
          label: "折叠/展开侧边栏",
          accelerator: "CmdOrCtrl+B",
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("bitbot:menu-sidebar-toggle", {});
            }
          },
        },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    { role: "editMenu", label: "编辑" },
    { role: "viewMenu", label: "视图" },
  ]);
  Menu.setApplicationMenu(appMenu);
  if (AUTOSTART_ENABLED) {
    const login = applyLoginItem(true);
    process.stdout.write(
      `[desktop] openAtLogin=${login.openAtLogin} ok=${login.ok}\n`,
    );
  }
  createWindow();
  createTray();
  registerHotkey();
  const daemon = ensureRoutineDaemon();
  process.stdout.write(
    `[desktop] routine-daemon ok=${daemon.ok} pid=${daemon.pid || "n/a"} long_lived=${daemon.long_lived || false}\n`,
  );
  /* GP-170: 装了 App 的机器上没有 scripts/host_routine_daemon.sh（Windows 连
     /bin/bash 都没有）。daemon 起不来时由主进程自己扫，保证「开着电脑」本身就是
     唤醒源；daemon 真的在跑时让位，避免两个唤醒源争同一批到期任务。 */
  const wake = syncWakeSource();
  process.stdout.write(
    `[desktop] wake-source ${wake && wake.wake_source} interval_ms=${(wake && wake.interval_ms) || 0}\n`,
  );
  try {
    const inbound = await ensureCnInbound();
    process.stdout.write(
      `[desktop] cn-inbound listening=${inbound.listening} port=${inbound.port}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[desktop] cn-inbound failed: ${err && err.message ? err.message : err}\n`,
    );
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });
});

/* Cmd+Q / 应用菜单的 role:"quit" / Dock「退出」/ 系统关机，全都从这里进来。
 * 这一句晚于 createWindow 也没关系（before-quit 只在退出时触发），但必须在
 * 任何一次 quit 之前注册 —— 所以放在 app.whenReady 之后的顶层，而不是
 * createWindow 里面。 */
app.on("before-quit", () => {
  quitRequested = true;
  // GP-170: 定时器先停，免得退出过程中还在起新回合。
  stopDesktopSweep();
  // 早点发 SIGTERM，给 daemon 收尾的时间；will-quit 里再兜底 SIGKILL。
  stopRoutineDaemon("SIGTERM");
  // 常驻内核同理：先请它自己收摊（关 stdin），will-quit 再兜底。
  stopResidentKernel();
});

app.on("will-quit", () => {
  // 兜底：即使 before-quit 没走到，退出时也不留下定时器。
  stopDesktopSweep();
  try {
    globalShortcut.unregisterAll();
  } catch (_) {
    /* ignore */
  }
  // 走到这里说明窗口已经真的关掉了。SIGTERM 若被 daemon 吃掉，
  // 这里补一记 SIGKILL —— 否则主进程一退，daemon 就成了孤儿进程，
  // 下一次启动时还会撞上「旧实例没清干净」。
  stopRoutineDaemon("SIGKILL");
  killResidentKernel();
  if (tray) {
    try {
      tray.destroy();
    } catch (_) {
      /* ignore */
    }
    tray = null;
  }
});

app.on("window-all-closed", () => {
  if (process.env.BITBOT_DESKTOP_SMOKE_TURN !== undefined) return;
  // 常驻托盘 + 全局热键是产品意图（Grok-style），所以「窗口关完」不等于退出。
  // 注意这只作用于「用户关窗」；quit 流程里 Electron 不会 emit 这个事件，
  // 所以它不会挡住 Cmd+Q。
});
