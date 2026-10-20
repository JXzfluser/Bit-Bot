"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitbot", {
  boot: () => ipcRenderer.invoke("bitbot:boot"),
  turn: (text, opts) => ipcRenderer.invoke("bitbot:turn", text, opts || {}),
  readArtifact: (artifactPath) =>
    ipcRenderer.invoke("bitbot:readArtifact", artifactPath),
  openArtifact: (artifactPath) =>
    ipcRenderer.invoke("bitbot:openArtifact", artifactPath),
  saveArtifact: (artifactPath) =>
    ipcRenderer.invoke("bitbot:saveArtifact", artifactPath),
  sessions: {
    list: () => ipcRenderer.invoke("bitbot:sessions:list"),
    get: (id) => ipcRenderer.invoke("bitbot:sessions:get", id),
    create: (title) => ipcRenderer.invoke("bitbot:sessions:create", title),
    setActive: (id) => ipcRenderer.invoke("bitbot:sessions:setActive", id),
    rename: (id, title) => ipcRenderer.invoke("bitbot:sessions:rename", id, title),
    delete: (id) => ipcRenderer.invoke("bitbot:sessions:delete", id),
  },
  // Wave G — Grok desktop parity (docs/grok-desktop-parity/ipc-contract.md §4).
  bots: {
    list: () => ipcRenderer.invoke("bitbot:bots:list"),
    op: (payload) => ipcRenderer.invoke("bitbot:bots:op", payload),
  },
  settings: {
    get: () => ipcRenderer.invoke("bitbot:settings:get"),
    set: (patch) => ipcRenderer.invoke("bitbot:settings:set", patch),
  },
  attachments: {
    pick: () => ipcRenderer.invoke("bitbot:attachments:pick"),
  },
  skills: {
    list: () => ipcRenderer.invoke("bitbot:skills:list"),
  },
  // Wave M8 — Connect apps / Marketplace panel (GP-A2/A3).
  plugins: {
    list: (opts) => ipcRenderer.invoke("bitbot:plugins:list", opts || {}),
    op: (payload) => ipcRenderer.invoke("bitbot:plugins:op", payload),
    toolToggle: (payload) => ipcRenderer.invoke("bitbot:plugins:toolToggle", payload),
  },
  approvals: {
    rule: (patch) => ipcRenderer.invoke("bitbot:approvals:rule", patch),
    listRules: () => ipcRenderer.invoke("bitbot:approvals:listRules"),
    removeRule: (pattern) => ipcRenderer.invoke("bitbot:approvals:removeRule", pattern),
    match: (info) => ipcRenderer.invoke("bitbot:approvals:match", info),
    listPending: () => ipcRenderer.invoke("bitbot:approvals:listPending"),
    decide: (id, decision) => ipcRenderer.invoke("bitbot:approvals:decide", id, decision),
    denyReceipt: (info) => ipcRenderer.invoke("bitbot:approvals:denyReceipt", info),
    runAllowed: (info) => ipcRenderer.invoke("bitbot:approvals:runAllowed", info),
  },
  computer: {
    frame: (opts) => ipcRenderer.invoke("bitbot:computer:frame", opts || {}),
    takeover: (opts) => ipcRenderer.invoke("bitbot:computer:takeover", opts),
    state: () => ipcRenderer.invoke("bitbot:computer:state"),
  },
  rooms: {
    list: () => ipcRenderer.invoke("bitbot:rooms:list"),
  },
  usage: {
    week: () => ipcRenderer.invoke("bitbot:usage:week"),
  },
  voice: {
    ingest: (payload) => ipcRenderer.invoke("bitbot:voice:ingest", payload),
  },
  notify: {
    turn: (payload) => ipcRenderer.invoke("bitbot:notify:turn", payload),
  },
  badge: {
    set: (n) => ipcRenderer.invoke("bitbot:badge:set", n),
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
  onSettingsChanged: (cb) => {
    const handler = (_e, payload) => {
      try {
        cb(payload);
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:settings-changed", handler);
    return () =>
      ipcRenderer.removeListener("bitbot:settings-changed", handler);
  },
  onFocusSession: (cb) => {
    const handler = (_e, payload) => {
      try {
        cb(payload);
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:focus-session", handler);
    return () =>
      ipcRenderer.removeListener("bitbot:focus-session", handler);
  },
  onApprovalAlwaysAllow: (cb) => {
    const handler = (_e, payload) => {
      try {
        cb(payload);
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:approval-always-allow", handler);
    return () =>
      ipcRenderer.removeListener("bitbot:approval-always-allow", handler);
  },
  onMenuSidebarToggle: (cb) => {
    const handler = () => {
      try {
        cb();
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:menu-sidebar-toggle", handler);
    return () =>
      ipcRenderer.removeListener("bitbot:menu-sidebar-toggle", handler);
  },
  onMenuNewChat: (cb) => {
    const handler = () => {
      try {
        cb();
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:menu-new-chat", handler);
    return () => ipcRenderer.removeListener("bitbot:menu-new-chat", handler);
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
  cnInboundStatus: () => ipcRenderer.invoke("bitbot:cn:inbound:status"),
  productStatus: () => ipcRenderer.invoke("bitbot:product:status"),
  ota: {
    check: () => ipcRenderer.invoke("bitbot:ota:check"),
    download: () => ipcRenderer.invoke("bitbot:ota:download"),
    restart: () => ipcRenderer.invoke("bitbot:ota:restart"),
  },
  secrets: {
    status: () => ipcRenderer.invoke("bitbot:secrets:status"),
    set: (patch) => ipcRenderer.invoke("bitbot:secrets:set", patch || {}),
    probeLlm: () => ipcRenderer.invoke("bitbot:secrets:probeLlm"),
    probeCnChannels: () =>
      ipcRenderer.invoke("bitbot:secrets:probeCnChannels"),
    runGate: () => ipcRenderer.invoke("bitbot:secrets:runGate"),
  },
});
