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
} = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Dev: hosts/shared; packaged: hosts/desktop/shared (copied by electron-builder).
let createTurnRunner;
let createHostFfi;
try {
  createTurnRunner = require("./shared/run_moon_turn").createTurnRunner;
  createHostFfi = require("./shared/host_ffi").createHostFfi;
} catch (_e) {
  createTurnRunner = require("../shared/run_moon_turn").createTurnRunner;
  createHostFfi = require("../shared/host_ffi").createHostFfi;
}
const { createSessionStore } = require("./sessions");

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

let createCnInboundServer;
try {
  createCnInboundServer = require("./shared/cn_inbound_server").createCnInboundServer;
} catch (_e) {
  createCnInboundServer = require("../shared/cn_inbound_server").createCnInboundServer;
}

let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (_e) {
  autoUpdater = null;
}

/** CN inbound HTTP server (钉钉/飞书/企微 callbacks). */
let cnInbound = null;

const REPO_ROOT = process.env.BITBOT_REPO_ROOT
  ? path.resolve(process.env.BITBOT_REPO_ROOT)
  : path.resolve(__dirname, "../..");

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
    const dir = path.join(REPO_ROOT, "data", "desktop");
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
    const dir = path.join(REPO_ROOT, "data", "desktop");
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
  "BITBOT_DINGTALK_POST",
  "BITBOT_DINGTALK_WEBHOOK",
  "BITBOT_DINGTALK_TOKEN",
  "BITBOT_FEISHU_POST",
  "BITBOT_FEISHU_TOKEN",
  "BITBOT_FEISHU_CHAT_ID",
  "BITBOT_WECOM_POST",
  "BITBOT_WECOM_TOKEN",
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
 */
function syncInjectedSecretsToEnvLocal() {
  const current = parseEnvFile(DESKTOP_ENV_LOCAL);
  const patch = {};
  for (const k of ALLOWED_SECRET_KEYS) {
    const v = String(process.env[k] || "").trim();
    if (!v) continue;
    if (/^stub/i.test(v) || v === "test" || v === "changeme") continue;
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

const runner = createTurnRunner(REPO_ROOT);
const sessions = createSessionStore(REPO_ROOT);
const ffi = createHostFfi(REPO_ROOT);
/** Wave G stores: bots / settings / approvals / computer / rooms / usage (docs/grok-desktop-parity/ipc-contract.md §2). */
const surface = createProductSurface(REPO_ROOT);

let mainWindow = null;
let tray = null;
let routineDaemonChild = null;
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
  const p = path.join(REPO_ROOT, "data", "routines", "daemon-status.json");
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
});

/** One-shot product-path smoke: Electron Host runs a MoonBit turn then exits. */
async function runSmokeTurnAndExit() {
  const text = String(process.env.BITBOT_DESKTOP_SMOKE_TURN || "").trim();
  const outDir = path.join(REPO_ROOT, "data", "tmp");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "desktop-electron-turn.json");
  const at = new Date().toISOString();
  try {
    const result = await runner.runTurn(text || "ListMachines", {
      sessionId: "desktop-electron-smoke",
      machineId: "desk-1",
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "Bit Bot Desktop",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));
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
    // Grok-style: close hides to tray (quit from tray menu).
    if (app.isQuiting) return;
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
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
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
      machineId: "desk-1",
      machineKind: "desktop",
      channel: "",
      approved: p.approved === true,
      skipSession: true,
    });
    return {
      ok: Boolean(result && result.ok),
      intent: (result && result.intent) || null,
      turn: result,
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
    return { ok: true, settings: st, theme_source: nativeTheme.themeSource };
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

ipcMain.handle("bitbot:skills:list", async () => {
  try {
    // Reuse Host product path (no LocalBrain): a real kernel turn plans list_skills.
    const result = await runner.runTurn("list skills", {
      sessionId: "skills-pick",
      machineId: "desk-1",
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
    return surface.listPendingApprovals();
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), items: [] };
  }
});

ipcMain.handle("bitbot:approvals:decide", async (_e, id, decision) => {
  try {
    const res = surface.decideApproval(id, String(decision || ""), new Date().toISOString());
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

ipcMain.handle("bitbot:approvals:runAllowed", async (_e, info) => {
  try {
    const kind = String((info && info.kind) || "");
    const command = String((info && info.command) || "");
    const ALLOWABLE = ["shell", "channel_send", "mail_send", "mcp_call", "computer_use"];
    if (!ALLOWABLE.includes(kind)) {
      return { ok: false, error: "kind_not_replayable" };
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
    return { ok: true, rooms: surface.loadRooms() };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), rooms: [] };
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
    const dir = path.join(REPO_ROOT, "data", "desktop", "voice");
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

ipcMain.handle("bitbot:daemon:ensure", async () => ensureRoutineDaemon());

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
    mobile_deferred: true,
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
    "BITBOT_LLM_QWEN_API_KEY",
    "BITBOT_LLM_MOONSHOT_API_KEY",
    "BITBOT_DINGTALK_POST",
    "BITBOT_DINGTALK_WEBHOOK",
    "BITBOT_DINGTALK_TOKEN",
    "BITBOT_FEISHU_POST",
    "BITBOT_FEISHU_TOKEN",
    "BITBOT_FEISHU_CHAT_ID",
    "BITBOT_WECOM_POST",
    "BITBOT_WECOM_TOKEN",
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
        /_POST$|_MODEL$|_BASE_URL$|_CHAT_ID$|_AGENT_ID$|_TOUSER$|_FILING$|_FEED_URL$/.test(
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
    mobile_deferred: true,
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
    const result = await runner.runTurn(String(text || ""), {
      sessionId,
      machineId: "desk-1",
      machineKind: "desktop",
      channel: "",
      approved: !!(opts && opts.approved),
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
    });
    const rawText = String(text || "").trim();
    const skipSession =
      !!(opts && opts.skipSession) ||
      /^listmachines$/i.test(rawText) ||
      /^list machines$/i.test(rawText);
    if (!skipSession) {
      const toStore = [];
      const userRow = { role: "user", text: String(text || "") };
      // GP-14: persist which message this turn replied to (kernel-echoed id).
      if (result && result.reply_to) userRow.reply_to = String(result.reply_to);
      toStore.push(userRow);
      if (result && Array.isArray(result.messages)) {
        for (const m of result.messages) {
          if (m && m.role === "assistant" && m.text) {
            toStore.push({ role: "assistant", text: m.text });
          }
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
    broadcast("bitbot:llm-stream", {
      phase: "end",
      session_id: sessionId,
      ok: Boolean(result && result.ok),
    });
    return result;
  } finally {
    if (envPatch) {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }
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
  const root = path.resolve(REPO_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
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
  const root = path.resolve(REPO_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
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
  const root = path.resolve(REPO_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
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
    cnInbound = createCnInboundServer({
      repoRoot: REPO_ROOT,
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
          machineId: machineKind === "desktop" ? "desk-1" : `${machineKind}-1`,
          machineKind,
          channel: channel === "android" || channel === "ios" ? "" : channel,
          approved: true,
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

app.whenReady().then(async () => {
  // GP-77: install state on disk for the shared Host `update_status` reader.
  persistAppInstallState();
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

app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll();
  } catch (_) {
    /* ignore */
  }
  if (routineDaemonChild && !routineDaemonChild.killed) {
    try {
      routineDaemonChild.kill("SIGTERM");
    } catch (_) {
      /* ignore */
    }
  }
});

app.on("window-all-closed", () => {
  if (process.env.BITBOT_DESKTOP_SMOKE_TURN !== undefined) return;
  // Stay alive for tray / global hotkey (Grok-style resident).
});
