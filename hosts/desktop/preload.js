"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitbot", {
  boot: () => ipcRenderer.invoke("bitbot:boot"),
  turn: (text, opts) => ipcRenderer.invoke("bitbot:turn", text, opts || {}),
  readArtifact: (artifactPath) =>
    ipcRenderer.invoke("bitbot:readArtifact", artifactPath),
  openArtifact: (artifactPath) =>
    ipcRenderer.invoke("bitbot:openArtifact", artifactPath),
});
