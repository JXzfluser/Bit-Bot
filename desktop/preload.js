"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitbot", {
  boot: () => ipcRenderer.invoke("bitbot:boot"),
  turn: (text) => ipcRenderer.invoke("bitbot:turn", text),
});
