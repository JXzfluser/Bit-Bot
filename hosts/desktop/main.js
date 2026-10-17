"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, "../..");
const MOON_BIN = process.env.MOON_BIN || "moon";
const MOON_TARGET = process.env.BITBOT_MOON_TARGET || "native";

/** Dangerous patterns — Host FFI refuse (Grok-like irreversible gate). */
const SHELL_DENY =
  /\brm\s+-rf\s+\/|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|:;\s*\}|shutdown|reboot|fork\s*bomb/i;

function isDeniedShell(cmd) {
  return SHELL_DENY.test(String(cmd || ""));
}

/**
 * Execute MoonBit-planned Host effects (FFI only — no LocalBrain).
 * @param {Array<{kind?: string, command?: string}>} effects
 */
async function executeHostEffects(effects) {
  const results = [];
  for (const e of effects || []) {
    const kind = (e && e.kind) || "";
    if (kind !== "shell") {
      results.push({
        kind,
        ok: false,
        error: `unsupported effect kind: ${kind || "(empty)"}`,
      });
      continue;
    }
    const cmd = String((e && e.command) || "").trim();
    if (!cmd) {
      results.push({ kind: "shell", ok: false, error: "empty command" });
      continue;
    }
    if (isDeniedShell(cmd)) {
      results.push({
        kind: "shell",
        ok: false,
        command: cmd,
        error: "refused: irreversible/dangerous shell (Host gate)",
      });
      continue;
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        "/bin/bash",
        ["-lc", cmd],
        {
          cwd: REPO_ROOT,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          env: process.env,
        },
      );
      results.push({
        kind: "shell",
        ok: true,
        command: cmd,
        stdout: String(stdout || "").slice(0, 8000),
        stderr: String(stderr || "").slice(0, 2000),
      });
    } catch (err) {
      results.push({
        kind: "shell",
        ok: false,
        command: cmd,
        error: err.message || String(err),
        stdout: err.stdout ? String(err.stdout).slice(0, 4000) : "",
        stderr: err.stderr ? String(err.stderr).slice(0, 2000) : "",
      });
    }
  }
  return results;
}

function runMoon(args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(MOON_BIN, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${process.env.HOME || ""}/.moon/bin:${process.env.PATH || ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`moon timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `moon exited ${code}\n${stderr || stdout || "(no output)"}`.trim(),
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function lastJsonLine(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith("{") && line.endsWith("}")) {
      return line;
    }
  }
  return text.trim();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    title: "Bit Bot Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.handle("bitbot:boot", async () => {
  const { stdout, stderr } = await runMoon([
    "run",
    "cmd/main",
    "--target",
    MOON_TARGET,
  ]);
  return {
    ok: true,
    banner: stdout.trim() || stderr.trim(),
    target: MOON_TARGET,
    note: "Product brain is MoonBit. Wasm alt: BITBOT_MOON_TARGET=wasm",
  };
});

ipcMain.handle("bitbot:turn", async (_event, text) => {
  const userText = String(text || "").trim();
  if (!userText) {
    return { ok: false, error: "empty text" };
  }
  const { stdout, stderr } = await runMoon([
    "run",
    "cmd/desktop_turn",
    "--target",
    MOON_TARGET,
    "--",
    userText,
  ]);
  const raw = lastJsonLine(stdout || stderr);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON from MoonBit: ${err.message}`,
      raw,
      stderr: stderr.trim(),
    };
  }
  // Host FFI: MoonBit plans effects; Desktop executes (ADR 0002 / 0005).
  if (parsed && parsed.needs_host_ffi && Array.isArray(parsed.effects) && parsed.effects.length) {
    const host_results = await executeHostEffects(parsed.effects);
    parsed.host_results = host_results;
    parsed.messages = Array.isArray(parsed.messages) ? parsed.messages.slice() : [];
    for (const hr of host_results) {
      if (hr.ok) {
        parsed.messages.push({
          role: "assistant",
          text: `Host FFI shell \`${hr.command}\`:\n\`\`\`\n${(hr.stdout || "").trim() || "(no stdout)"}\n\`\`\``,
        });
      } else {
        parsed.messages.push({
          role: "assistant",
          text: `Host FFI refused/failed: ${hr.error || "unknown"}${hr.command ? ` (${hr.command})` : ""}`,
        });
      }
    }
  }
  return parsed;
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
