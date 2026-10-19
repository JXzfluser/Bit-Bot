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
  error: null,
};

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
    return { ok: true, openAtLogin: Boolean(enabled) };
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
      : "国内渠道均为 draft — 在 .env.local 设 BITBOT_*_POST=1 + 凭证",
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
    return {
      ok: false,
      residual: true,
      error: otaState.error,
      pretend_update: false,
    };
  }
  if (!feed) {
    otaState.error = "BITBOT_UPDATE_FEED_URL not set";
    return {
      ok: false,
      residual: true,
      error: otaState.error,
      pretend_update: false,
    };
  }
  if (!app.isPackaged) {
    otaState.error = "OTA check only in packaged app (npm run dist)";
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
    otaState.last_check = new Date().toISOString();
    const result = await autoUpdater.checkForUpdates();
    const info = result && result.updateInfo ? result.updateInfo : null;
    otaState.last_result = info
      ? { version: info.version, path: info.path || null }
      : null;
    otaState.update_available = Boolean(info);
    otaState.error = null;
    return {
      ok: true,
      residual: false,
      update_available: otaState.update_available,
      info: otaState.last_result,
      pretend_update: false,
    };
  } catch (err) {
    otaState.error = String(err && err.message ? err.message : err);
    return {
      ok: false,
      residual: true,
      error: otaState.error,
      pretend_update: false,
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
    });
    const rawText = String(text || "").trim();
    const skipSession =
      !!(opts && opts.skipSession) ||
      /^listmachines$/i.test(rawText) ||
      /^list machines$/i.test(rawText);
    if (!skipSession) {
      const toStore = [];
      toStore.push({ role: "user", text: String(text || "") });
      if (result && Array.isArray(result.messages)) {
        for (const m of result.messages) {
          if (m && m.role === "assistant" && m.text) {
            toStore.push({ role: "assistant", text: m.text });
          }
        }
      }
      sessions.appendMessages(sessionId, toStore);
      broadcast("bitbot:sessions-changed", sessions.list());
    }
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
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".html": "text/html",
      ".htm": "text/html",
    }[ext] || null;
  if (!mime) {
    return {
      ok: false,
      error: "unsupported media type",
      path: resolved,
      pretend_read: false,
    };
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
  return {
    ok: true,
    path: resolved,
    mime,
    bytes: buf.length,
    data_url: "data:" + mime + ";base64," + buf.toString("base64"),
    pretend_read: false,
  };
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
  if (process.env.BITBOT_DESKTOP_SMOKE_TURN !== undefined) {
    return runSmokeTurnAndExit();
  }
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
