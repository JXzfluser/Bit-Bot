"use strict";

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("bitbot", {
  boot: () => ipcRenderer.invoke("bitbot:boot"),
  turn: (text, opts) => ipcRenderer.invoke("bitbot:turn", text, opts || {}),
  cancelTurn: () => ipcRenderer.invoke("bitbot:turn:cancel"),
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
    // GP-102: append value-free rows (secret placeholders carry a handle only).
    append: (id, messages) => ipcRenderer.invoke("bitbot:sessions:append", id, messages || []),
    rename: (id, title) => ipcRenderer.invoke("bitbot:sessions:rename", id, title),
    delete: (id) => ipcRenderer.invoke("bitbot:sessions:delete", id),
    // GP-M31 (§5.1 消息反应): toggle a reaction on a stored message.
    react: (sessionId, messageId, emoji, on) =>
      ipcRenderer.invoke("bitbot:sessions:react", { session_id: sessionId, message_id: messageId, emoji, on: on !== false }),
  },
  // Replica C3: regenerate an assistant reply (atomic replace-in-place).
  messages: {
    regenerate: (payload) => ipcRenderer.invoke("bitbot:msg:regenerate", payload || {}),
  },
  // Wave G — Grok desktop parity (docs/grok-desktop-parity/ipc-contract.md §4).
  bots: {
    list: () => ipcRenderer.invoke("bitbot:bots:list"),
    op: (payload) => ipcRenderer.invoke("bitbot:bots:op", payload),
    // GP-122: OS image picker; returns {path, data_url} for the Edit Profile dialog.
    pickAvatar: () => ipcRenderer.invoke("bitbot:bots:pickAvatar"),
    // G-22: Bot settings rail (profile + real counts) and §4.6 per-Bot notify.
    detail: (id) => ipcRenderer.invoke("bitbot:bots:detail", id),
    notify: (botId, on) => ipcRenderer.invoke("bitbot:bots:notify", { bot_id: botId, on: on !== false }),
    // G-28: 分组是展示偏好，Host 存储直写（不走 kernel 意图链）。
    setGroup: (botId, group) => ipcRenderer.invoke("bitbot:bots:setGroup", { bot_id: botId, group }),
  },
  settings: {
    get: () => ipcRenderer.invoke("bitbot:settings:get"),
    set: (patch) => ipcRenderer.invoke("bitbot:settings:set", patch),
  },
  // 麦克风：问宿主一遍 TCC 真实状态（not-determined 时才会弹系统授权框），
  // 并允许把用户送到「系统设置 → 隐私与安全性 → 麦克风」。渲染端不猜状态。
  media: {
    mic: () => ipcRenderer.invoke("bitbot:media:mic"),
    micSettings: () => ipcRenderer.invoke("bitbot:media:micSettings"),
  },
  attachments: {
    pick: (existing) => ipcRenderer.invoke("bitbot:attachments:pick", { existing: existing || 0 }),
    // GP-11: paste / drag-drop carry File objects only in the renderer; the
    // real path is resolved here with webUtils (Electron 32+ removed
    // file.path under contextIsolation) before the Host validates & stages.
    stagePaths: (files, existing = 0) => {
      const paths = (files || []).map((f) => {
        try {
          return webUtils.getPathForFile(f);
        } catch (_) {
          return "";
        }
      });
      return ipcRenderer.invoke("bitbot:attachments:stage", { paths, existing });
    },
    // GP-M30: pre-send preview for the composer chips (real bytes, read-only).
    preview: (p) => ipcRenderer.invoke("bitbot:attachments:preview", { path: p }),
    // 已经有真实磁盘路径的附件（截图落地的那一张）走同一条校验通道：
    // 数量 / 大小 / 真图片头都还在 Host 侧判，渲染层不自己放行。
    attachPaths: (paths, existing = 0) =>
      ipcRenderer.invoke("bitbot:attachments:stage", { paths: paths || [], existing }),
  },
  // 输入框的相机键：Host 藏窗口 → 系统抓屏 → 回来当附件。
  screenshot: {
    capture: (opts) => ipcRenderer.invoke("bitbot:screenshot:capture", opts || {}),
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
  // Wave M14 — Account panel (GP-74, local profile only).
  account: {
    status: () => ipcRenderer.invoke("bitbot:account:status"),
    signIn: (label) => ipcRenderer.invoke("bitbot:account:signIn", label),
    signOut: () => ipcRenderer.invoke("bitbot:account:signOut"),
    switchTo: (label) => ipcRenderer.invoke("bitbot:account:switch", label),
  },
  // Wave M10 — Bot template catalog (GP-02).
  templates: {
    list: () => ipcRenderer.invoke("bitbot:templates:list"),
    create: (payload) => ipcRenderer.invoke("bitbot:templates:create", payload || {}),
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
  answerLoopApproval: (info) => ipcRenderer.invoke("bitbot:loop-approval:answer", info || {}),
  computer: {
    frame: (opts) => ipcRenderer.invoke("bitbot:computer:frame", opts || {}),
    takeover: (opts) => ipcRenderer.invoke("bitbot:computer:takeover", opts),
    state: () => ipcRenderer.invoke("bitbot:computer:state"),
  },
  rooms: {
    list: () => ipcRenderer.invoke("bitbot:rooms:list"),
    // G-28 #4：群成员增删。渲染层只递交「哪个群、哪个 Bot、加还是减」，
    // 2–6 人与成员存在性由 Host engine 验，拒绝码原样回传。
    members: {
      update: (payload) => ipcRenderer.invoke("bitbot:rooms:members:update", payload || {}),
    },
    // 群资料库：读 / 加条目。写侧只碰 rooms.json 的 room.library，
    // 并且只收 repo 内的路径 —— 渲染层不自己开文件、不自己改库。
    library: {
      list: (payload) => ipcRenderer.invoke("bitbot:rooms:library:list", payload || {}),
      add: (payload) => ipcRenderer.invoke("bitbot:rooms:library:add", payload || {}),
    },
    // GP-143/144: route + fan out the task to the room's responders on the Host
    // product path — the renderer no longer builds a kernel phrase, so nothing
    // writes the transcript twice.
    orchestrate: (payload) => ipcRenderer.invoke("bitbot:rooms:orchestrate", payload || {}),
    // GP-146: group turns are async on the Host; (a) says which responders are
    // working now, (b) says the durable transcript gained rows. Observational
    // only — the renderer never keeps its own copy of room state.
    onRoomOrchestrating: (cb) => {
      const handler = (_e, ev) => {
        try {
          cb(ev);
        } catch (_) {
          /* ignore */
        }
      };
      ipcRenderer.on("bitbot:room-orchestrating", handler);
      return () => ipcRenderer.removeListener("bitbot:room-orchestrating", handler);
    },
    onRoomUpdated: (cb) => {
      const handler = (_e, ev) => {
        try {
          cb(ev);
        } catch (_) {
          /* ignore */
        }
      };
      ipcRenderer.on("bitbot:room-updated", handler);
      return () => ipcRenderer.removeListener("bitbot:room-updated", handler);
    },
    // GP-146: the directory itself (not just one room's transcript) changed —
    // e.g. a room dropped below 2 members. Payload carries ok:false when the
    // store is unreadable, so the renderer can say so instead of "no groups".
    onRoomsChanged: (cb) => {
      const handler = (_e, ev) => {
        try {
          cb(ev);
        } catch (_) {
          /* ignore */
        }
      };
      ipcRenderer.on("bitbot:rooms-changed", handler);
      return () => ipcRenderer.removeListener("bitbot:rooms-changed", handler);
    },
  },
  // GP-154「定时任务在群内部」: the group-info panel reads and writes the
  // routines owned by one room. Write side goes through the same kernel turn a
  // chat message uses, so scheduling rules (5-minute floor, honest refusal)
  // are not duplicated here.
  routines: {
    list: (payload) => ipcRenderer.invoke("bitbot:routines:list", payload || {}),
    op: (payload) => ipcRenderer.invoke("bitbot:routines:op", payload || {}),
    // GP-158：暂停 / 继续走 Host 既有的 routine_pause / routine_resume，
    // 渲染层不自己改库，也不碰内核的 effect 形状。
    lifecycle: (payload) => ipcRenderer.invoke("bitbot:routines:lifecycle", payload || {}),
    onChanged: (cb) => {
      const handler = (_e, ev) => {
        try {
          cb(ev);
        } catch (_) {
          /* ignore */
        }
      };
      ipcRenderer.on("bitbot:routines-changed", handler);
      return () => ipcRenderer.removeListener("bitbot:routines-changed", handler);
    },
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
  // GP-96 (§5.7): live turn progress events emitted at real Host effect
  // boundaries (start/done per effect) — observational only, no control surface.
  onTurnProgress: (cb) => {
    const handler = (_e, ev) => {
      try {
        cb(ev);
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:turn-progress", handler);
    return () => ipcRenderer.removeListener("bitbot:turn-progress", handler);
  },
  // AgentStep projection from the kernel loop. Display only.
  onAgentLoop: (cb) => {
    const handler = (_e, step) => {
      try {
        cb(step);
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:agent-loop", handler);
    return () => ipcRenderer.removeListener("bitbot:agent-loop", handler);
  },
  onLoopApproval: (cb) => {
    const handler = (_e, card) => {
      try {
        cb(card);
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:loop-approval", handler);
    return () => ipcRenderer.removeListener("bitbot:loop-approval", handler);
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
  onBotsChanged: (cb) => {
    const handler = (_e, view) => {
      try {
        cb(view);
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:bots-changed", handler);
    return () => ipcRenderer.removeListener("bitbot:bots-changed", handler);
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
  onMenuOpenSettings: (cb) => {
    const handler = () => {
      try {
        cb();
      } catch (_) {
        /* ignore */
      }
    };
    ipcRenderer.on("bitbot:menu-open-settings", handler);
    return () => ipcRenderer.removeListener("bitbot:menu-open-settings", handler);
  },
  // 语言变化：渲染端侦测到后把 language 发给主进程，主进程按语言重建原生菜单。
  relocalizeMenu: (lang) => {
    try {
      ipcRenderer.send("bitbot:menu-relocalize", lang);
    } catch (_) {
      /* ignore */
    }
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
  // G-31: build-team-from-URL — fetch a page, extract a team via live LLM, scaffold workspace.
  webfetch: (url) => ipcRenderer.invoke("bitbot:webfetch", { url }),
  llmExtractTeam: (text) => ipcRenderer.invoke("bitbot:llm:extractTeam", { text }),
  teamCreateWorkspace: (title, rules, roles) => ipcRenderer.invoke("bitbot:team:workspace", { title, rules, roles }),
  // G-31 follow-up: read a staged attachment's text for local team extraction.
  file: {
    readText: (p) => ipcRenderer.invoke("bitbot:file:readText", { path: p }),
  },
  cnStatus: () => ipcRenderer.invoke("bitbot:cn:status"),
  cnInboundStatus: () => ipcRenderer.invoke("bitbot:cn:inbound:status"),
  pairing: {
    state: () => ipcRenderer.invoke("bitbot:pairing:state"),
    token: () => ipcRenderer.invoke("bitbot:pairing:token"),
    copy: (what) => ipcRenderer.invoke("bitbot:pairing:copy", what),
    setLan: (enabled) => ipcRenderer.invoke("bitbot:pairing:lan", enabled),
    code: (payload) => ipcRenderer.invoke("bitbot:pairing:code", payload),
  },
  productStatus: () => ipcRenderer.invoke("bitbot:product:status"),
  ota: {
    check: () => ipcRenderer.invoke("bitbot:ota:check"),
    download: () => ipcRenderer.invoke("bitbot:ota:download"),
    restart: () => ipcRenderer.invoke("bitbot:ota:restart"),
    status: () => ipcRenderer.invoke("bitbot:app:updateStatus"),
  },
  // GP-94: renderer asks Host to open an external link (system browser only).
  links: {
    open: (payload) => ipcRenderer.invoke("bitbot:links:open", payload || {}),
    auditPath: () => ipcRenderer.invoke("bitbot:links:auditPath"),
  },
  secrets: {
    status: () => ipcRenderer.invoke("bitbot:secrets:status"),
    set: (patch) => ipcRenderer.invoke("bitbot:secrets:set", patch || {}),
    probeLlm: () => ipcRenderer.invoke("bitbot:secrets:probeLlm"),
    probeCnChannels: () =>
      ipcRenderer.invoke("bitbot:secrets:probeCnChannels"),
    runGate: () => ipcRenderer.invoke("bitbot:secrets:runGate"),
    // GP-99/100/101/102 (§8.3): the secure card's submit path. The reply is a
    // handle + mask; the value is never read back.
    submit: (payload) => ipcRenderer.invoke("bitbot:secrets:submit", payload || {}),
    vault: () => ipcRenderer.invoke("bitbot:secrets:vault"),
    remove: (name) => ipcRenderer.invoke("bitbot:secrets:remove", String(name || "")),
  },
  // GP-106/107 (§8.5): read-only account-managed privacy status; no setter.
  privacy: {
    status: () => ipcRenderer.invoke("bitbot:privacy:status"),
  },
});
