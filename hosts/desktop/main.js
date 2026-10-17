"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "../..");
const MOON_BIN = process.env.MOON_BIN || "moon";
const MOON_TARGET = process.env.BITBOT_MOON_TARGET || "native";

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
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON from MoonBit: ${err.message}`,
      raw,
      stderr: stderr.trim(),
    };
  }
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
