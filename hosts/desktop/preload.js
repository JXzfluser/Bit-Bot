"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitbot", {
  boot: () => ipcRenderer.invoke("bitbot:boot"),
  turn: (text, opts) => ipcRenderer.invoke("bitbot:turn", text, opts || {}),
  readArtifact: (artifactPath) =>
    ipcRenderer.invoke("bitbot:readArtifact", artifactPath),
  openArtifact: (artifactPath) =>
    ipcRenderer.invoke("bitbot:openArtifact", artifactPath),
  sessions: {
    list: () => ipcRenderer.invoke("bitbot:sessions:list"),
    get: (id) => ipcRenderer.invoke("bitbot:sessions:get", id),
    create: (title) => ipcRenderer.invoke("bitbot:sessions:create", title),
    setActive: (id) => ipcRenderer.invoke("bitbot:sessions:setActive", id),
  },
  onLlmStream: (cb) => {
    const handler = (_e, chunk) => {
      try {
        cb(chunk);
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:llm-stream", handler);
    return () => ipcRenderer.removeListener("bitbot:llm-stream", handler);
  },
  onSessionsChanged: (cb) => {
    const handler = (_e, list) => {
      try {
        cb(list);
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:sessions-changed", handler);
    return () =>
      ipcRenderer.removeListener("bitbot:sessions-changed", handler);
  },
  autostart: {
    get: () => ipcRenderer.invoke("bitbot:autostart:get"),
    set: (enabled) => ipcRenderer.invoke("bitbot:autostart:set", enabled),
  },
  daemon: {
    status: () => ipcRenderer.invoke("bitbot:daemon:status"),
    ensure: () => ipcRenderer.invoke("bitbot:daemon:ensure"),
  },
  llmStatus: () => ipcRenderer.invoke("bitbot:llm:status"),
  llmCatalog: () => ipcRenderer.invoke("bitbot:llm:catalog"),
  cnStatus: () => ipcRenderer.invoke("bitbot:cn:status"),
  productStatus: () => ipcRenderer.invoke("bitbot:product:status"),
  secrets: {
    status: () => ipcRenderer.invoke("bitbot:secrets:status"),
    set: (patch) => ipcRenderer.invoke("bitbot:secrets:set", patch || {}),
    probeLlm: () => ipcRenderer.invoke("bitbot:secrets:probeLlm"),
  },
});
