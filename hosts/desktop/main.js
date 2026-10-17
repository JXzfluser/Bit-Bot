"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// Dev: hosts/shared; packaged: hosts/desktop/shared (copied by electron-builder).
let createTurnRunner;
try {
  createTurnRunner = require("./shared/run_moon_turn").createTurnRunner;
} catch (_e) {
  createTurnRunner = require("../shared/run_moon_turn").createTurnRunner;
}

const REPO_ROOT = process.env.BITBOT_REPO_ROOT
  ? path.resolve(process.env.BITBOT_REPO_ROOT)
  : path.resolve(__dirname, "../..");
const runner = createTurnRunner(REPO_ROOT);

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

ipcMain.handle("bitbot:boot", async () => runner.bootBanner());

ipcMain.handle("bitbot:turn", async (_event, text, opts = {}) => {
  return runner.runTurn(String(text || ""), {
    sessionId: "desktop-session",
    machineId: "desk-1",
    machineKind: "desktop",
    channel: "",
    approved: !!(opts && opts.approved),
  });
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
