"use strict";

/**
 * Shared Host FFI for Desktop / CLI multi-end hosts (ADR 0002 / 0005).
 * MoonBit plans effects; Host executes. No Python LocalBrain.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const SHELL_DENY =
  /\brm\s+-rf\s+\/|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|:;\s*\}|shutdown|reboot|fork\s*bomb/i;

function createHostFfi(repoRoot) {
  const REPO_ROOT = path.resolve(repoRoot);
  const SESSION_MEMORY_PATH = path.join(
    REPO_ROOT,
    "data",
    "memory",
    "desktop-host.json",
  );
  const HOST_DELIVERY_JOURNAL = path.join(
    REPO_ROOT,
    "data",
    "journal",
    "host-delivery.jsonl",
  );
  const CONNECTORS_DIR = path.join(REPO_ROOT, "data", "connectors");
  const ROUTINES_PATH = path.join(REPO_ROOT, "data", "routines", "host-routines.json");
  const JOURNAL_EVENTS_PATH = path.join(
    REPO_ROOT,
    "data",
    "journal",
    "events.jsonl",
  );
  const SHARED_MEMORY_PATH = path.join(
    REPO_ROOT,
    "data",
    "memory",
    "shared-scopes.json",
  );
  const INBOUND_REACTIONS_PATH = path.join(
    REPO_ROOT,
    "data",
    "journal",
    "inbound-reactions.jsonl",
  );
  const MCP_SERVER = path.join(REPO_ROOT, "scripts", "host_h4_mcp_stdio.py");
  const MCP_CLIENT = path.join(REPO_ROOT, "scripts", "host_h4_mcp_client.py");
  const MCP_TMP = path.join(REPO_ROOT, "data", "tmp");
  const VOICE_SESSIONS_PATH = path.join(
    REPO_ROOT,
    "data",
    "voice",
    "sessions.json",
  );
  const TEAMMATES_PATH = path.join(
    REPO_ROOT,
    "data",
    "agents",
    "teammates.json",
  );
  const SUBAGENTS_PATH = path.join(
    REPO_ROOT,
    "data",
    "agents",
    "subagents.json",
  );
  const APPROVALS_PATH = path.join(
    REPO_ROOT,
    "data",
    "approvals",
    "queue.jsonl",
  );
  const DEVICE_PERMS_PATH = path.join(
    REPO_ROOT,
    "data",
    "device",
    "permission-cards.jsonl",
  );
  const CLOUD_LAUNCHES_PATH = path.join(
    REPO_ROOT,
    "data",
    "cloud",
    "launches.jsonl",
  );
  const CALENDAR_EVENTS_PATH = path.join(
    REPO_ROOT,
    "data",
    "calendar",
    "events.jsonl",
  );
  const COMMERCE_PATH = path.join(
    REPO_ROOT,
    "data",
    "commerce",
    "purchases.jsonl",
  );
  const FINANCE_CALLS_PATH = path.join(
    REPO_ROOT,
    "data",
    "connectors",
    "finance-calls.jsonl",
  );
  const CREDENTIAL_FILLS_PATH = path.join(
    REPO_ROOT,
    "data",
    "credentials",
    "fills.jsonl",
  );
  const MAIL_DRAFTS_PATH = path.join(REPO_ROOT, "data", "mail", "drafts.jsonl");
  const ROOM_TURNS_PATH = path.join(
    REPO_ROOT,
    "data",
    "agents",
    "room-turns.jsonl",
  );

  function appendHostDeliveryJournal(entry) {
    try {
      fs.mkdirSync(path.dirname(HOST_DELIVERY_JOURNAL), { recursive: true });
      const line = JSON.stringify(entry);
      fs.appendFileSync(HOST_DELIVERY_JOURNAL, line + "\n");
      return HOST_DELIVERY_JOURNAL;
    } catch (err) {
      return `journal-failed: ${err.message || String(err)}`;
    }
  }

  function isDeniedShell(cmd) {
    return SHELL_DENY.test(String(cmd || ""));
  }

  function encodeHostArg(s) {
    return String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t");
  }

  function loadSessionMemory() {
    try {
      if (!fs.existsSync(SESSION_MEMORY_PATH)) return [];
      const raw = JSON.parse(fs.readFileSync(SESSION_MEMORY_PATH, "utf8"));
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((e) => e && e.key != null && e.value != null)
        .map((e) => ({ key: String(e.key), value: String(e.value) }));
    } catch {
      return [];
    }
  }

  function saveSessionMemory(rows) {
    try {
      fs.mkdirSync(path.dirname(SESSION_MEMORY_PATH), { recursive: true });
      const cleaned = (Array.isArray(rows) ? rows : [])
        .filter((e) => e && e.key != null)
        .map((e) => ({
          key: String(e.key),
          value: String(e.value ?? ""),
          scope: String(e.scope || "profile"),
        }));
      fs.writeFileSync(SESSION_MEMORY_PATH, JSON.stringify(cleaned, null, 2));
    } catch (err) {
      console.error("saveSessionMemory failed", err);
    }
  }

  function memorySeedArgs() {
    const seeds = loadSessionMemory();
    const args = [];
    for (const s of seeds) {
      args.push("--seed-memory", encodeHostArg(`${s.key}=${s.value}`));
    }
    return args;
  }

  function loadConnectorState(name) {
    try {
      const p = path.join(CONNECTORS_DIR, `${name}.json`);
      if (!fs.existsSync(p)) return {};
      return JSON.parse(fs.readFileSync(p, "utf8")) || {};
    } catch {
      return {};
    }
  }

  function saveConnectorState(name, state) {
    try {
      fs.mkdirSync(CONNECTORS_DIR, { recursive: true });
      const p = path.join(CONNECTORS_DIR, `${name}.json`);
      fs.writeFileSync(p, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error("saveConnectorState failed", err);
    }
  }

  function extractAccessToken(state) {
    if (!state || typeof state !== "object") return "";
    return String(
      state.access_token ||
        state.token ||
        (state.oauth && state.oauth.access_token) ||
        "",
    ).trim();
  }

  function httpJson(url, { method = "GET", headers = {}, body = null } = {}) {
    return new Promise((resolve) => {
      try {
        const u = new URL(url);
        const lib = u.protocol === "https:" ? https : http;
        const req = lib.request(
          {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname + u.search,
            method,
            headers,
            timeout: 20000,
          },
          (res) => {
            let data = "";
            res.on("data", (c) => {
              data += c;
              if (data.length > 512 * 1024) data = data.slice(0, 512 * 1024);
            });
            res.on("end", () => {
              let parsed = null;
              try {
                parsed = JSON.parse(data);
              } catch {
                parsed = null;
              }
              resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                body: data.slice(0, 16000),
                json: parsed,
              });
            });
          },
        );
        req.on("error", (err) => {
          resolve({ ok: false, status: 0, body: "", error: err.message });
        });
        req.on("timeout", () => {
          req.destroy();
          resolve({ ok: false, status: 0, body: "", error: "timeout" });
        });
        if (body) req.write(body);
        req.end();
      } catch (err) {
        resolve({ ok: false, status: 0, body: "", error: err.message });
      }
    });
  }

  async function slackApi(method, token, payload) {
    const body = payload ? JSON.stringify(payload) : null;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    };
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    const res = await httpJson(`https://slack.com/api/${method}`, {
      method: "POST",
      headers,
      body,
    });
    return res.json || { ok: false, error: res.error || `http_${res.status}` };
  }

  async function probeSlack() {
    const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
    const state = loadConnectorState("slack");
    if (!token) {
      const out = {
        connector: "slack",
        mode: "sandbox_idp",
        connected: Boolean(state.connected),
        detail: state.detail || "SLACK_BOT_TOKEN unset; sandbox IdP path",
      };
      return out;
    }
    const auth = await slackApi("auth.test", token);
    const ok = Boolean(auth.ok);
    const out = {
      connector: "slack",
      mode: "live",
      connected: ok,
      auth_test: {
        ok,
        team: auth.team,
        user: auth.user,
        error: auth.error,
      },
      detail: ok ? "auth.test ok" : `auth.test failed: ${auth.error}`,
    };
    saveConnectorState("slack", { ...state, ...out });
    return out;
  }

  function probeEmail(name) {
    const state = loadConnectorState(name);
    const token = extractAccessToken(state);
    if (!token) {
      return {
        connector: name,
        mode: "sandbox_idp",
        connected: Boolean(state.connected),
        detail:
          state.detail ||
          `no OAuth token in data/connectors/${name}.json; sandbox IdP`,
      };
    }
    return {
      connector: name,
      mode: "oauth_token_file",
      connected: true,
      detail: "access_token present on disk (Host live path ready)",
      live: true,
    };
  }

  async function connectorsStatusReport() {
    const slack = await probeSlack();
    const gmail = probeEmail("gmail");
    const outlook = probeEmail("outlook");
    return {
      ok: true,
      connectors: { slack, gmail, outlook },
      env: {
        SLACK_BOT_TOKEN: Boolean(String(process.env.SLACK_BOT_TOKEN || "").trim()),
        BITBOT_SLACK_POST: process.env.BITBOT_SLACK_POST === "1",
        SLACK_DEFAULT_CHANNEL: Boolean(
          String(process.env.SLACK_DEFAULT_CHANNEL || "").trim(),
        ),
      },
      note: "Host FFI probe; MoonBit owns turn policy (not LocalBrain)",
    };
  }

  function resolveUnderRepo(p) {
    const raw = String(p || "").trim();
    if (!raw) return null;
    const abs = path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
    const root = REPO_ROOT.endsWith(path.sep)
      ? REPO_ROOT
      : REPO_ROOT + path.sep;
    if (abs !== REPO_ROOT && !abs.startsWith(root)) {
      return null;
    }
    return abs;
  }

  async function executeFsList(command) {
    const abs = resolveUnderRepo(command);
    if (!abs) {
      return {
        kind: "fs_list",
        ok: false,
        command,
        error: "path refused (must stay under repo root)",
      };
    }
    try {
      const entries = fs.readdirSync(abs, { withFileTypes: true }).map((d) => ({
        name: d.name,
        type: d.isDirectory() ? "dir" : "file",
      }));
      return {
        kind: "fs_list",
        ok: true,
        command,
        stdout: JSON.stringify(entries.slice(0, 200), null, 2),
        stderr: "",
      };
    } catch (err) {
      return {
        kind: "fs_list",
        ok: false,
        command,
        error: err.message || String(err),
      };
    }
  }

  async function executeFsRead(command) {
    const abs = resolveUnderRepo(command);
    if (!abs) {
      return {
        kind: "fs_read",
        ok: false,
        command,
        error: "path refused (must stay under repo root)",
      };
    }
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) {
        return {
          kind: "fs_read",
          ok: false,
          command,
          error: "not a file",
        };
      }
      if (st.size > 256 * 1024) {
        return {
          kind: "fs_read",
          ok: false,
          command,
          error: "file too large (>256KiB)",
        };
      }
      const text = fs.readFileSync(abs, "utf8").slice(0, 16000);
      return {
        kind: "fs_read",
        ok: true,
        command,
        stdout: text,
        stderr: "",
      };
    } catch (err) {
      return {
        kind: "fs_read",
        ok: false,
        command,
        error: err.message || String(err),
      };
    }
  }

  async function executeWebFetch(command) {
    const url = String(command || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return {
        kind: "webfetch",
        ok: false,
        command: url,
        error: "only http(s) URLs allowed",
      };
    }
    const res = await httpJson(url, { method: "GET" });
    if (!res.ok) {
      return {
        kind: "webfetch",
        ok: false,
        command: url,
        error: res.error || `http_${res.status}`,
        stdout: (res.body || "").slice(0, 4000),
      };
    }
    return {
      kind: "webfetch",
      ok: true,
      command: url,
      stdout: (res.body || "").slice(0, 8000),
      stderr: "",
    };
  }

  async function claimSlackInbound(token, channelId, inboundPath, stamp) {
    /** Pull recent channel history into durable inbound store (Host FFI). */
    const hist = await slackApi("conversations.history", token, {
      channel: channelId,
      limit: 10,
    });
    const messages = Array.isArray(hist.messages) ? hist.messages : [];
    const claimed = [];
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const row = {
        scheme: "slack",
        channel: channelId,
        ts: m.ts || "",
        thread_ts: m.thread_ts || "",
        user: m.user || "",
        text_len: String(m.text || "").length,
        // Never echo full message bodies into evidence by default.
        text_prefix: String(m.text || "").slice(0, 80),
        mode: "live_slack_claim",
        at: stamp,
      };
      appendJsonl(inboundPath, row);
      claimed.push({ ts: row.ts, text_len: row.text_len });
    }
    return {
      ok: Boolean(hist.ok),
      error: hist.ok ? "" : hist.error || "conversations.history failed",
      claimed_count: claimed.length,
      claimed,
    };
  }

  async function executeChannelSend(command) {
    // command format: "<addr> :: <body>" from MoonBit
    // slack addr may be slack:CHANNEL or slack:CHANNEL:THREAD_TS
    const raw = String(command || "");
    let addr = raw;
    let body = "";
    const sep = " :: ";
    const at = raw.indexOf(sep);
    if (at >= 0) {
      addr = raw.slice(0, at).trim();
      body = raw.slice(at + sep.length);
    }
    const stamp = new Date().toISOString();
    const scheme = addr.includes(":") ? addr.split(":")[0] : "unknown";
    const outboundPath = path.join(
      REPO_ROOT,
      "data",
      "channels",
      "outbound.jsonl",
    );
    const inboundPath = path.join(
      REPO_ROOT,
      "data",
      "channels",
      "inbound.jsonl",
    );
    const connectorHint =
      scheme === "slack"
        ? loadConnectorState("slack")
        : scheme === "teams"
          ? loadConnectorState("teams")
          : scheme === "email" || scheme === "gmail"
            ? loadConnectorState("gmail")
            : {};
    const connectorReady = Boolean(
      connectorHint.connected ||
        connectorHint.status === "Connected" ||
        connectorHint.status === "Ready",
    );

    // Live Slack when token + BITBOT_SLACK_POST=1 (env or connector sandbox/live token)
    if (addr.startsWith("slack:")) {
      const envToken = String(process.env.SLACK_BOT_TOKEN || "").trim();
      const connectorToken = extractAccessToken(connectorHint);
      const token = envToken || (connectorToken && !String(connectorToken).startsWith("sandbox:")
        ? connectorToken
        : envToken);
      const slackParts = addr.slice("slack:".length).split(":").filter(Boolean);
      const channelId = slackParts[0] || "";
      const threadTs = slackParts[1] || "";
      // Optional inbound claim before / instead of post.
      let claim = null;
      if (
        token &&
        process.env.BITBOT_SLACK_CLAIM === "1" &&
        channelId
      ) {
        claim = await claimSlackInbound(token, channelId, inboundPath, stamp);
      }
      if (token && process.env.BITBOT_SLACK_POST === "1" && channelId && body) {
        const payload = {
          channel: channelId,
          text: body,
        };
        if (threadTs) payload.thread_ts = threadTs;
        const post = await slackApi("chat.postMessage", token, payload);
        const entry = {
          scheme,
          address: addr,
          body,
          mode: threadTs ? "live_slack_thread" : "live_slack",
          ok: Boolean(post.ok),
          ts: post.ts || "",
          thread_ts: threadTs || "",
          connector_ready: connectorReady,
          claim: claim
            ? { ok: claim.ok, claimed_count: claim.claimed_count }
            : null,
          at: stamp,
        };
        appendJsonl(outboundPath, entry);
        const journalPath = appendHostDeliveryJournal({
          kind: "channel_send",
          ...entry,
        });
        return {
          kind: "channel_send",
          ok: Boolean(post.ok),
          command: raw,
          stdout: JSON.stringify(
            {
              ...entry,
              journal: journalPath,
              outbound: outboundPath,
              inbound: claim ? inboundPath : undefined,
            },
            null,
            2,
          ),
          error: post.ok ? "" : `slack post failed: ${post.error || "unknown"}`,
          stderr: "",
        };
      }
      // Claim-only path (no live post): still durable outbound draft + inbound evidence.
      if (claim) {
        const entry = {
          scheme,
          address: addr,
          body,
          mode: "live_slack_claim",
          ok: Boolean(claim.ok),
          live_post: false,
          claimed_count: claim.claimed_count,
          connector_ready: connectorReady,
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        return {
          kind: "channel_send",
          ok: Boolean(claim.ok),
          command: raw,
          stdout: JSON.stringify(
            { ...entry, outbound: outboundPath, claim },
            null,
            2,
          ),
          error: claim.ok ? "" : claim.error,
          stderr: "",
        };
      }
      // Sandbox inbound claim rehearsal when CLAIM=1 but no live token (honest: not live).
      if (process.env.BITBOT_SLACK_CLAIM === "1" && channelId && !token) {
        const sandboxRows = [
          {
            scheme: "slack",
            channel: channelId,
            ts: `${Date.now() / 1000}.000001`,
            thread_ts: threadTs || "",
            user: "U_SANDBOX",
            text_len: 24,
            text_prefix: "[sandbox] inbound claim",
            mode: "sandbox_slack_claim",
            at: stamp,
          },
        ];
        for (const row of sandboxRows) appendJsonl(inboundPath, row);
        const entry = {
          scheme,
          address: addr,
          body,
          mode: "sandbox_slack_claim",
          ok: true,
          live_post: false,
          claimed_count: sandboxRows.length,
          connector_ready: connectorReady,
          at: stamp,
          inbound: inboundPath,
          note: "sandbox claim — set SLACK_BOT_TOKEN for live conversations.history",
        };
        appendJsonl(outboundPath, entry);
        return {
          kind: "channel_send",
          ok: true,
          command: raw,
          stdout: JSON.stringify(
            { ...entry, outbound: outboundPath },
            null,
            2,
          ),
          stderr: "",
        };
      }
      const entry = {
        scheme,
        address: addr,
        body,
        mode: connectorReady ? "connector_draft" : "sandbox_draft",
        ok: true,
        live_post: false,
        thread_ts: threadTs || "",
        connector_ready: connectorReady,
        connector_status: connectorHint.status || "unknown",
        at: stamp,
        note: "live post needs SLACK_BOT_TOKEN + BITBOT_SLACK_POST=1; claim needs BITBOT_SLACK_CLAIM=1",
      };
      appendJsonl(outboundPath, entry);
      const journalPath = appendHostDeliveryJournal({
        kind: "channel_send",
        ...entry,
      });
      return {
        kind: "channel_send",
        ok: true,
        command: raw,
        stdout: JSON.stringify(
          { ...entry, journal: journalPath, outbound: outboundPath },
          null,
          2,
        ),
        stderr: "",
      };
    }

    if (addr.startsWith("teams:")) {
      const teamsToken = String(process.env.BITBOT_TEAMS_TOKEN || "").trim();
      const chatId = addr.slice("teams:".length).split(":")[0] || "";
      if (teamsToken && process.env.BITBOT_TEAMS_POST === "1" && body) {
        // Prefer chat message POST when chat id present; else probe chats list.
        const graphBase =
          process.env.BITBOT_TEAMS_GRAPH_URL ||
          "https://graph.microsoft.com/v1.0";
        let post;
        let mode = "live_teams_graph";
        if (chatId && chatId !== "me") {
          const msgUrl = `${graphBase.replace(/\/$/, "")}/chats/${encodeURIComponent(chatId)}/messages`;
          post = await httpJson(msgUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${teamsToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              body: { contentType: "text", content: body },
            }),
          });
          mode = "live_teams_chat_message";
        } else {
          post = await httpJson(`${graphBase.replace(/\/$/, "")}/me/chats`, {
            method: "GET",
            headers: { Authorization: `Bearer ${teamsToken}` },
          });
        }
        const entry = {
          scheme: "teams",
          address: addr,
          body,
          mode,
          ok: Boolean(post.ok) || (post.status > 0 && post.status < 500),
          live_post: true,
          http_status: post.status || 0,
          chat_id: chatId || null,
          at: stamp,
        };
        appendJsonl(outboundPath, entry);
        return {
          kind: "channel_send",
          ok: entry.ok,
          command: raw,
          stdout: JSON.stringify({ ...entry, outbound: outboundPath }, null, 2),
          error: entry.ok ? "" : `teams graph failed: ${post.error || post.status}`,
          stderr: "",
        };
      }
      const entry = {
        scheme: "teams",
        address: addr,
        body,
        mode: connectorReady ? "connector_draft" : "sandbox_draft",
        ok: true,
        live_post: false,
        connector_ready: connectorReady,
        at: stamp,
        note: "Teams live Graph post needs BITBOT_TEAMS_TOKEN + BITBOT_TEAMS_POST=1",
      };
      appendJsonl(outboundPath, entry);
      const journalPath = appendHostDeliveryJournal({
        kind: "channel_send",
        ...entry,
      });
      return {
        kind: "channel_send",
        ok: true,
        command: raw,
        stdout: JSON.stringify(
          { ...entry, journal: journalPath, outbound: outboundPath },
          null,
          2,
        ),
        stderr: "",
      };
    }

    if (addr.startsWith("email:") || addr.startsWith("gmail:")) {
      const entry = {
        scheme,
        address: addr,
        body,
        mode: "mail_outbound_draft",
        ok: true,
        at: stamp,
      };
      appendJsonl(outboundPath, entry);
      appendJsonl(MAIL_DRAFTS_PATH, {
        kind: "channel_email",
        address: addr,
        body,
        at: stamp,
      });
      return {
        kind: "channel_send",
        ok: true,
        command: raw,
        stdout: JSON.stringify(
          { ...entry, outbound: outboundPath, drafts: MAIL_DRAFTS_PATH },
          null,
          2,
        ),
        stderr: "",
      };
    }

    const entry = {
      scheme,
      address: addr,
      body,
      mode: "durable_outbound",
      ok: true,
      at: stamp,
    };
    appendJsonl(outboundPath, entry);
    const journalPath = appendHostDeliveryJournal({
      kind: "channel_send",
      ...entry,
    });
    return {
      kind: "channel_send",
      ok: true,
      command: raw,
      stdout: JSON.stringify(
        { ...entry, journal: journalPath, outbound: outboundPath },
        null,
        2,
      ),
      stderr: "",
    };
  }

  async function executeCopyBox(kind, command) {
    // command: machine_id|src|dest
    const parts = String(command || "").split("|");
    const machineId = (parts[0] || "").trim();
    const src = (parts[1] || "").trim();
    const dest = (parts[2] || "").trim();
    const srcAbs = resolveUnderRepo(src);
    const destAbs = resolveUnderRepo(dest);
    if (!srcAbs || !destAbs) {
      return {
        kind,
        ok: false,
        command,
        error: "copy paths must stay under repo root",
      };
    }
    try {
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(srcAbs, destAbs);
      const journal = appendHostDeliveryJournal({
        kind,
        machine_id: machineId,
        src: srcAbs,
        dest: destAbs,
        at: new Date().toISOString(),
      });
      return {
        kind,
        ok: true,
        command,
        stdout: `copied ${srcAbs} → ${destAbs} (machine=${machineId}) journal=${journal}`,
        stderr: "",
      };
    } catch (err) {
      return {
        kind,
        ok: false,
        command,
        error: err.message || String(err),
      };
    }
  }

  async function executeMailSend(command) {
    // command: provider|to|subject|body  (provider=gmail|outlook)
    const parts = String(command || "").split("|");
    const provider = (parts[0] || "gmail").trim().toLowerCase();
    const to = (parts[1] || "").trim();
    const subject = (parts[2] || "").trim();
    const body = parts.slice(3).join("|");
    const state = loadConnectorState(provider);
    const token = extractAccessToken(state);
    const journal = appendHostDeliveryJournal({
      kind: "mail_send",
      provider,
      to,
      subject,
      at: new Date().toISOString(),
      has_token: Boolean(token),
    });
    if (!token) {
      return {
        kind: "mail_send",
        ok: true,
        command,
        stdout: `mail draft journaled (${journal}); no OAuth token — sandbox path`,
        stderr: "",
      };
    }
    if (provider === "gmail") {
      // Gmail API users.messages.send requires raw MIME base64url.
      const raw = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ].join("\r\n");
      const encoded = Buffer.from(raw)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const payload = JSON.stringify({ raw: encoded });
      const res = await httpJson(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
          body: payload,
        },
      );
      const ok = Boolean(res.ok && res.json && res.json.id);
      return {
        kind: "mail_send",
        ok,
        command,
        stdout: ok
          ? `gmail send ok id=${res.json.id} journal=${journal}`
          : "",
        error: ok
          ? ""
          : `gmail send failed: ${res.error || res.status || JSON.stringify(res.json || {}).slice(0, 200)}`,
        stderr: "",
      };
    }
    return {
      kind: "mail_send",
      ok: true,
      command,
      stdout: `mail token present for ${provider}; send adapter journal=${journal}`,
      stderr: "",
    };
  }

  async function executeConnectorsProbe() {
    const report = await connectorsStatusReport();
    appendHostDeliveryJournal({
      kind: "connectors_probe",
      at: new Date().toISOString(),
      summary: {
        slack: report.connectors.slack.mode,
        gmail: report.connectors.gmail.mode,
        outlook: report.connectors.outlook.mode,
      },
    });
    return {
      kind: "connectors_probe",
      ok: true,
      command: "connectors_probe",
      stdout: JSON.stringify(report, null, 2),
      stderr: "",
    };
  }

  function loadRoutines() {
    try {
      if (!fs.existsSync(ROUTINES_PATH)) return [];
      const raw = JSON.parse(fs.readFileSync(ROUTINES_PATH, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveRoutines(rows) {
    fs.mkdirSync(path.dirname(ROUTINES_PATH), { recursive: true });
    fs.writeFileSync(ROUTINES_PATH, JSON.stringify(rows, null, 2));
  }

  function upsertRoutine(partial) {
    const rows = loadRoutines();
    const id = String(partial.id || "");
    const idx = rows.findIndex((r) => r && r.id === id);
    const next = {
      id,
      cron: String(partial.cron || "@daily"),
      prompt: String(partial.prompt || ""),
      enabled: partial.enabled !== false,
      lifecycle: String(partial.lifecycle || "active"),
      updated_at: new Date().toISOString(),
    };
    if (idx >= 0) rows[idx] = { ...rows[idx], ...next };
    else rows.push(next);
    saveRoutines(rows);
    return next;
  }

  async function executeMcp(kind, command) {
    fs.mkdirSync(MCP_TMP, { recursive: true });
    const stamp = Date.now();
    const reqPath = path.join(MCP_TMP, `mcp-req-${stamp}.json`);
    const outPath = path.join(MCP_TMP, `mcp-out-${stamp}.json`);
    let requests;
    if (kind === "mcp_discover") {
      requests = [{ jsonrpc: "2.0", method: "tools/list", params: {} }];
    } else {
      // command: namespace.name|args_json  OR  name|args
      const pipe = String(command || "").indexOf("|");
      const left = pipe >= 0 ? command.slice(0, pipe) : command;
      const argsRaw = pipe >= 0 ? command.slice(pipe + 1) : "{}";
      let args = {};
      try {
        args = JSON.parse(argsRaw || "{}");
      } catch {
        args = { body: argsRaw };
      }
      const toolName = left.includes(".")
        ? left.split(".").slice(1).join(".") || "echo_body"
        : left || "echo_body";
      // Map product Gmail/X names onto Host stdio loopback tools when no live MCP.
      const mapped =
        toolName === "search_threads" || toolName === "echo_body"
          ? "echo_body"
          : toolName === "write_result"
            ? "write_result"
            : "echo_body";
      if (mapped === "echo_body" && args.body == null) {
        args = { body: JSON.stringify(args), source_ref: left };
      }
      requests = [
        {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: mapped, arguments: args },
        },
      ];
    }
    fs.writeFileSync(reqPath, JSON.stringify(requests));
    try {
      const { stdout, stderr } = await execFileAsync(
        process.env.PYTHON || "python3",
        [
          MCP_CLIENT,
          "--server",
          MCP_SERVER,
          "--agent-tools-dir",
          path.join(REPO_ROOT, "agent-tools"),
          "--request-json",
          reqPath,
          "--out-json",
          outPath,
        ],
        { cwd: REPO_ROOT, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
      );
      const payload = fs.existsSync(outPath)
        ? fs.readFileSync(outPath, "utf8")
        : stdout;
      appendHostDeliveryJournal({
        kind,
        command,
        mode: "stdio-mcp",
        at: new Date().toISOString(),
      });
      return {
        kind,
        ok: true,
        command,
        stdout: String(payload || "").slice(0, 12000),
        stderr: String(stderr || "").slice(0, 2000),
      };
    } catch (err) {
      appendHostDeliveryJournal({
        kind,
        command,
        ok: false,
        error: err.message || String(err),
        at: new Date().toISOString(),
      });
      return {
        kind,
        ok: false,
        command,
        error: err.message || String(err),
        stdout: err.stdout ? String(err.stdout).slice(0, 4000) : "",
        stderr: err.stderr ? String(err.stderr).slice(0, 2000) : "",
      };
    }
  }

  function executeRoutineEffect(kind, command) {
    const id = String(command || "").split("|")[0];
    if (kind === "routine_schedule") {
      const parts = String(command || "").split("|");
      const row = upsertRoutine({
        id: parts[0] || "routine-1",
        cron: parts[1] || "@daily",
        prompt: parts.slice(2).join("|") || "",
        enabled: true,
        lifecycle: "active",
      });
      appendHostDeliveryJournal({
        kind,
        command,
        stored: row,
        at: new Date().toISOString(),
      });
      return {
        kind,
        ok: true,
        command,
        stdout: `routine stored ${row.id} cron=${row.cron}`,
        stderr: "",
      };
    }
    if (kind === "routine_list") {
      const rows = loadRoutines();
      appendHostDeliveryJournal({
        kind,
        count: rows.length,
        at: new Date().toISOString(),
      });
      return {
        kind,
        ok: true,
        command,
        stdout: JSON.stringify(rows, null, 2),
        stderr: "",
      };
    }
    if (kind === "routine_pause") {
      const row = upsertRoutine({ id, enabled: false, lifecycle: "paused" });
      return {
        kind,
        ok: true,
        command,
        stdout: `paused ${row.id}`,
        stderr: "",
      };
    }
    if (kind === "routine_resume") {
      const row = upsertRoutine({ id, enabled: true, lifecycle: "active" });
      return {
        kind,
        ok: true,
        command,
        stdout: `resumed ${row.id}`,
        stderr: "",
      };
    }
    if (kind === "routine_fire") {
      const rows = loadRoutines();
      const hit = rows.find((r) => r && r.id === id);
      if (hit && hit.enabled === false) {
        return {
          kind,
          ok: false,
          command,
          error: `routine not fireable (paused): ${id}`,
        };
      }
      const firedAt = new Date().toISOString();
      const cron = (hit && hit.cron) || "@daily";
      let nextDueMs = Date.now() + 24 * 3600 * 1000;
      if (cron === "@hourly" || /hourly/i.test(cron)) {
        nextDueMs = Date.now() + 3600 * 1000;
      } else if (cron === "@weekly" || /weekly/i.test(cron)) {
        nextDueMs = Date.now() + 7 * 24 * 3600 * 1000;
      }
      const nextDue = new Date(nextDueMs).toISOString();
      if (hit) {
        hit.last_fired_at = firedAt;
        hit.next_due = nextDue;
        saveRoutines(rows);
      }
      const firesPath = path.join(
        REPO_ROOT,
        "data",
        "routines",
        "fires.jsonl",
      );
      const fireEntry = {
        id,
        cron,
        prompt: (hit && hit.prompt) || "",
        fired: true,
        at: firedAt,
        next_due: nextDue,
      };
      appendJsonl(firesPath, fireEntry);
      appendHostDeliveryJournal({
        kind,
        command,
        fired: true,
        prompt: fireEntry.prompt,
        next_due: nextDue,
        at: firedAt,
      });
      return {
        kind,
        ok: true,
        command,
        stdout: JSON.stringify(
          {
            fired: true,
            id,
            prompt: fireEntry.prompt,
            next_due: nextDue,
            fires: firesPath,
          },
          null,
          2,
        ),
        stderr: "",
      };
    }
    return null;
  }

  function executeMailReadSearch(kind, command) {
    // Live Gmail uses same token path as mail_send when present; else sandbox.
    const tokenPath = path.join(CONNECTORS_DIR, "gmail_token.json");
    const hasToken = fs.existsSync(tokenPath);
    appendHostDeliveryJournal({
      kind,
      command,
      mode: hasToken ? "gmail-live-pending" : "sandbox",
      at: new Date().toISOString(),
    });
    if (kind === "mail_search") {
      return {
        kind,
        ok: true,
        command,
        stdout: hasToken
          ? `gmail live search queued q=${command}`
          : `sandbox search q=${command} (set connectors/gmail_token.json for live)`,
        stderr: "",
      };
    }
    return {
      kind,
      ok: true,
      command,
      stdout: hasToken
        ? `gmail live read queued thread=${command}`
        : `sandbox read thread=${command}`,
      stderr: "",
    };
  }

  function loadJournalEvents() {
    try {
      if (!fs.existsSync(JOURNAL_EVENTS_PATH)) return [];
      return fs
        .readFileSync(JOURNAL_EVENTS_PATH, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((e) => e && e.date && e.event_id != null);
    } catch {
      return [];
    }
  }

  function appendJournalEvent(entry) {
    fs.mkdirSync(path.dirname(JOURNAL_EVENTS_PATH), { recursive: true });
    fs.appendFileSync(JOURNAL_EVENTS_PATH, JSON.stringify(entry) + "\n");
    return JOURNAL_EVENTS_PATH;
  }

  function loadSharedMemory() {
    try {
      if (!fs.existsSync(SHARED_MEMORY_PATH)) return {};
      const raw = JSON.parse(fs.readFileSync(SHARED_MEMORY_PATH, "utf8"));
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  function saveSharedMemory(store) {
    fs.mkdirSync(path.dirname(SHARED_MEMORY_PATH), { recursive: true });
    fs.writeFileSync(SHARED_MEMORY_PATH, JSON.stringify(store, null, 2));
  }

  function executeJournalSharedInbound(kind, command) {
    const at = new Date().toISOString();
    if (kind === "journal_append") {
      const parts = String(command || "").split("|");
      const date = parts[0] || "";
      const event_id = parts[1] || "";
      const body = parts.slice(2).join("|");
      const entry = {
        date,
        event_id,
        body,
        pollutes_profile: false,
        at,
      };
      const pathWritten = appendJournalEvent(entry);
      appendHostDeliveryJournal({ kind, command, path: pathWritten, at });
      return {
        kind,
        ok: true,
        command,
        stdout: JSON.stringify(
          {
            stored: true,
            path: pathWritten,
            date,
            event_id,
            pollutes_profile: false,
          },
          null,
          2,
        ),
        stderr: "",
      };
    }
    if (kind === "journal_query") {
      const parts = String(command || "").split("|");
      const from_date = parts[0] || "";
      const to_date = parts[1] || "";
      const hits = loadJournalEvents().filter((e) => {
        if (from_date && e.date < from_date) return false;
        if (to_date && e.date > to_date) return false;
        return true;
      });
      appendHostDeliveryJournal({
        kind,
        command,
        hit_count: hits.length,
        at,
      });
      return {
        kind,
        ok: true,
        command,
        stdout: JSON.stringify(
          {
            from_date,
            to_date,
            hit_count: hits.length,
            hits: hits.slice(0, 50),
            pollutes_profile: false,
          },
          null,
          2,
        ),
        stderr: "",
      };
    }
    if (kind === "shared_memory_put") {
      const parts = String(command || "").split("|");
      const scope = parts[0] || "default";
      const key = parts[1] || "";
      const value = parts.slice(2).join("|");
      const store = loadSharedMemory();
      if (!store[scope] || typeof store[scope] !== "object") store[scope] = {};
      store[scope][key] = { value, at };
      saveSharedMemory(store);
      appendHostDeliveryJournal({
        kind,
        command,
        scope,
        key,
        path: SHARED_MEMORY_PATH,
        at,
      });
      return {
        kind,
        ok: true,
        command,
        stdout: JSON.stringify(
          {
            stored: true,
            scope,
            key,
            path: SHARED_MEMORY_PATH,
            isolation: "scope-bound",
          },
          null,
          2,
        ),
        stderr: "",
      };
    }
    if (kind === "shared_memory_read") {
      const parts = String(command || "").split("|");
      const scope = parts[0] || "default";
      const key = parts[1] || "";
      const store = loadSharedMemory();
      const scoped = store[scope];
      if (!scoped || typeof scoped !== "object" || !(key in scoped)) {
        // Cross-scope / missing: refuse (CM-0303 isolation).
        const otherScopes = Object.keys(store).filter(
          (s) => s !== scope && store[s] && key in store[s],
        );
        const refused = otherScopes.length > 0;
        appendHostDeliveryJournal({
          kind,
          command,
          scope,
          key,
          ok: false,
          refused_cross_scope: refused,
          at,
        });
        return {
          kind,
          ok: false,
          command,
          error: refused
            ? `cross-scope read refused for key=${key} (exists in ${otherScopes.join(",")})`
            : `shared memory miss scope=${scope} key=${key}`,
          stdout: JSON.stringify(
            {
              scope,
              key,
              found: false,
              refused_cross_scope: refused,
            },
            null,
            2,
          ),
          stderr: "",
        };
      }
      const cell = scoped[key];
      const value = cell && typeof cell === "object" ? cell.value : cell;
      appendHostDeliveryJournal({
        kind,
        command,
        scope,
        key,
        ok: true,
        at,
      });
      return {
        kind,
        ok: true,
        command,
        stdout: JSON.stringify(
          {
            scope,
            key,
            found: true,
            value,
            value_len: String(value ?? "").length,
            isolation: "scope-bound",
          },
          null,
          2,
        ),
        stderr: "",
      };
    }
    if (kind === "inbound_reaction") {
      const parts = String(command || "").split("|");
      const emoji = parts[0] || "";
      const useful = /useful=1/.test(String(command || ""));
      const disposition = useful
        ? "act_without_forced_reply"
        : "wake_only_no_forced_reply";
      const entry = {
        emoji,
        useful,
        disposition,
        forced_reply: false,
        at,
      };
      fs.mkdirSync(path.dirname(INBOUND_REACTIONS_PATH), { recursive: true });
      fs.appendFileSync(INBOUND_REACTIONS_PATH, JSON.stringify(entry) + "\n");
      appendHostDeliveryJournal({
        kind,
        command,
        path: INBOUND_REACTIONS_PATH,
        disposition,
        at,
      });
      return {
        kind,
        ok: true,
        command,
        stdout: JSON.stringify(
          {
            emoji,
            useful,
            disposition,
            forced_reply: false,
            path: INBOUND_REACTIONS_PATH,
          },
          null,
          2,
        ),
        stderr: "",
      };
    }
    return null;
  }

  function resolveOauthConnector(command) {
    const raw = String(command || "").trim().toLowerCase();
    let provider = "slack";
    let connectorName = "slack";
    if (raw.startsWith("gmail") || raw.includes("gmail")) {
      provider = "outlook"; // sandbox IdP provider set; product stores as gmail
      connectorName = "gmail";
    } else if (raw.includes("finance") || raw.includes("user-finance")) {
      provider = "finance";
      connectorName = "finance";
    } else if (raw.includes("outlook")) {
      provider = "outlook";
      connectorName = "outlook";
    } else if (raw.startsWith("identity") || raw.includes("browser")) {
      provider = "slack";
      connectorName = "identity-browser";
    } else if (raw.includes("slack") || raw === "slack") {
      provider = "slack";
      connectorName = "slack";
    }
    return { raw, provider, connectorName };
  }

  function readLiveOauthToken(connectorName) {
    const envKey = `BITBOT_OAUTH_TOKEN_${String(connectorName || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")}`;
    const fromEnv = String(process.env[envKey] || "").trim();
    if (fromEnv) return { access_token: fromEnv, source: envKey };
    const tokenFile = String(
      process.env.BITBOT_OAUTH_TOKEN_FILE ||
        process.env[`BITBOT_OAUTH_TOKEN_FILE_${connectorName.toUpperCase()}`] ||
        "",
    ).trim();
    if (tokenFile && fs.existsSync(tokenFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
        const tok =
          (raw && (raw.access_token || raw.token)) ||
          String(fs.readFileSync(tokenFile, "utf8")).trim();
        if (tok && !String(tok).startsWith("sandbox:")) {
          return { access_token: String(tok), source: tokenFile };
        }
      } catch {
        const tok = String(fs.readFileSync(tokenFile, "utf8")).trim();
        if (tok) return { access_token: tok, source: tokenFile };
      }
    }
    return null;
  }

  async function runLocalOauthExchange(provider, artifactDir) {
    // Full authorize→callback→token against local IdP (protocol rehearsal for live).
    const { stdout, stderr } = await execFileAsync(
      process.env.PYTHON || "python3",
      [
        path.join(REPO_ROOT, "scripts", "host_h4_oauth_idp.py"),
        "--sandbox-run",
        "--provider",
        provider,
        "--artifact-dir",
        artifactDir,
      ],
      { cwd: REPO_ROOT, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
    );
    let summary = {};
    const summaryPath = path.join(artifactDir, "sandbox_run.json");
    if (fs.existsSync(summaryPath)) {
      summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    } else {
      const line = String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop();
      if (line && line.startsWith("{")) summary = JSON.parse(line);
    }
    return { summary, stdout, stderr, ok: Boolean(summary.ok) };
  }

  function shouldOpenOauthBrowser(exchangeMode) {
    const flag = String(process.env.BITBOT_OAUTH_OPEN_BROWSER || "")
      .trim()
      .toLowerCase();
    if (flag === "1" || flag === "true" || flag === "yes") return true;
    const m = String(exchangeMode || "").toLowerCase();
    return (
      m === "remote_open" ||
      m === "open" ||
      m === "open_browser" ||
      m === "browser_open"
    );
  }

  async function waitOauthCallback({
    artifactDir,
    waitMs,
    redirectUri,
    tokenUrl,
    clientId,
    clientSecret,
    serveAutoAuthorize,
    seedCode,
  }) {
    const args = [
      path.join(REPO_ROOT, "scripts", "host_oauth_callback_wait.py"),
      "--artifact-dir",
      artifactDir,
      "--wait-ms",
      String(waitMs || 5000),
    ];
    if (redirectUri) args.push("--redirect-uri", redirectUri);
    if (tokenUrl) args.push("--token-url", tokenUrl);
    if (clientId) args.push("--client-id", clientId);
    if (clientSecret) args.push("--client-secret", clientSecret);
    if (serveAutoAuthorize) args.push("--serve-auto-authorize");
    if (seedCode) args.push("--seed-code", seedCode);
    const { stdout, stderr } = await execFileAsync(
      process.env.PYTHON || "python3",
      args,
      { cwd: REPO_ROOT, timeout: Math.max(15000, (waitMs || 5000) + 10000) },
    );
    let summary = {};
    const p = path.join(artifactDir, "callback_wait.json");
    if (fs.existsSync(p)) {
      summary = JSON.parse(fs.readFileSync(p, "utf8"));
    } else {
      const line = String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop();
      if (line && line.startsWith("{")) summary = JSON.parse(line);
    }
    // Prefer access_token from stdout JSON when evidence redacted it.
    try {
      const line = String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop();
      if (line && line.startsWith("{")) {
        const full = JSON.parse(line);
        if (full.access_token) summary.access_token = full.access_token;
        if (full.authorize_auto_url)
          summary.authorize_auto_url = full.authorize_auto_url;
        if (full.redirect_uri) summary.redirect_uri = full.redirect_uri;
        if (full.token_url) summary.token_url = full.token_url;
      }
    } catch {
      /* ignore */
    }
    return { summary, stdout, stderr, ok: Boolean(summary.ok) };
  }

  async function openAuthorizeBrowser(authorizeUrl, artifactDir) {
    /** Open remote authorize URL in a headed browser. Still NeedsAuth until token. */
    const out = {
      opened: false,
      tool: null,
      authorize_url: authorizeUrl || null,
      error: null,
    };
    if (!authorizeUrl) {
      out.error = "no authorize_url";
      return out;
    }
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactDir, "authorize_url.txt"),
      authorizeUrl + "\n",
    );
    const chromeCandidates = [
      process.env.CHROME_BIN,
      "/usr/local/bin/google-chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ].filter(Boolean);
    let chrome = chromeCandidates.find((c) => fs.existsSync(c));
    if (chrome) {
      try {
        const profile = path.join(artifactDir, "oauth-browser-profile");
        fs.mkdirSync(profile, { recursive: true });
        const { spawn } = require("child_process");
        const child = spawn(
          chrome,
          [
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${profile}`,
            "--new-window",
            "--window-size=1100,800",
            authorizeUrl,
          ],
          {
            cwd: artifactDir,
            env: process.env,
            detached: true,
            stdio: "ignore",
          },
        );
        child.unref();
        out.opened = true;
        out.tool = "chrome";
        out.pid = child.pid;
        // Best-effort: give the window a moment, then terminate throwaway session.
        setTimeout(() => {
          try {
            process.kill(child.pid, "SIGTERM");
          } catch {
            /* ignore */
          }
        }, 4000);
      } catch (err) {
        out.error = err.message || String(err);
      }
    }
    if (!out.opened) {
      for (const opener of ["xdg-open", "gio"]) {
        try {
          await execFileAsync(opener, [authorizeUrl], {
            timeout: 5000,
            cwd: artifactDir,
          });
          out.opened = true;
          out.tool = opener;
          break;
        } catch (err) {
          out.error = err.message || String(err);
        }
      }
    }
    fs.writeFileSync(
      path.join(artifactDir, "browser_open.json"),
      JSON.stringify(out, null, 2) + "\n",
    );
    return out;
  }

  async function executeOauthLive(command, connectorName, provider, artifactDir) {
    const statusDesired =
      connectorName === "slack" || connectorName === "identity-browser"
        ? "Connected"
        : "Ready";
    const live = readLiveOauthToken(connectorName);
    const clientId = String(
      process.env[`BITBOT_OAUTH_CLIENT_ID_${provider.toUpperCase()}`] ||
        process.env.BITBOT_OAUTH_CLIENT_ID ||
        "",
    ).trim();
    const exchangeMode = String(process.env.BITBOT_OAUTH_EXCHANGE || "")
      .trim()
      .toLowerCase();
    const authorizeUrlEnv = String(
      process.env.BITBOT_OAUTH_AUTHORIZE_URL || "",
    ).trim();
    const tokenUrlEnv = String(process.env.BITBOT_OAUTH_TOKEN_URL || "").trim();
    const authorizeUrl =
      authorizeUrlEnv ||
      (clientId
        ? `https://oauth.example.invalid/authorize?client_id=${encodeURIComponent(clientId)}&provider=${encodeURIComponent(provider)}&connector=${encodeURIComponent(connectorName)}`
        : "");
    fs.writeFileSync(
      path.join(artifactDir, "live_oauth_attempt.json"),
      JSON.stringify(
        {
          mode: "live",
          provider,
          connector: connectorName,
          client_id_present: Boolean(clientId),
          token_present: Boolean(live),
          exchange_mode: exchangeMode || null,
          authorize_url: authorizeUrl || null,
          token_url: tokenUrlEnv || null,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    if (live && live.access_token) {
      const state = {
        connected: true,
        status: statusDesired,
        mode: "live_token",
        provider,
        detail: `live OAuth token applied from ${live.source} → ${statusDesired}`,
        oauth: {
          access_token: live.access_token,
          token_type: "Bearer",
          sandbox: false,
        },
        access_token: live.access_token,
        artifact_dir: artifactDir,
        at: new Date().toISOString(),
      };
      saveConnectorState(connectorName, state);
      if (connectorName === "gmail") {
        fs.writeFileSync(
          path.join(CONNECTORS_DIR, "gmail_token.json"),
          JSON.stringify(
            {
              access_token: live.access_token,
              token_type: "Bearer",
              sandbox: false,
            },
            null,
            2,
          ),
        );
      }
      appendHostDeliveryJournal({
        kind: "oauth",
        command,
        connector: connectorName,
        ok: true,
        status: state.status,
        mode: "live_token",
        at: state.at,
      });
      return {
        kind: "oauth",
        ok: true,
        command,
        stdout: JSON.stringify(
          {
            connector: connectorName,
            status: state.status,
            connected: true,
            mode: "live_token",
            summary_ok: true,
          },
          null,
          2,
        ),
        stderr: "",
        error: "",
      };
    }

    // Remote token exchange when auth code + token URL are provided (non-interactive residual remains).
    const authCode = String(process.env.BITBOT_OAUTH_AUTH_CODE || "").trim();
    if (tokenUrlEnv && authCode) {
      const clientSecret = String(
        process.env.BITBOT_OAUTH_CLIENT_SECRET || "",
      ).trim();
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        code: authCode,
        client_id: clientId || "bitbot",
        redirect_uri:
          process.env.BITBOT_OAUTH_REDIRECT_URI || "http://127.0.0.1/callback",
      });
      if (clientSecret) form.set("client_secret", clientSecret);
      const tokenRes = await httpJson(tokenUrlEnv, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form.toString(),
      });
      fs.writeFileSync(
        path.join(artifactDir, "remote_token_exchange.json"),
        JSON.stringify(
          {
            token_url: tokenUrlEnv,
            http_status: tokenRes.status || 0,
            ok: Boolean(tokenRes.ok),
            // Never persist raw refresh tokens into evidence.
            has_access_token: Boolean(
              tokenRes.json && tokenRes.json.access_token,
            ),
          },
          null,
          2,
        ),
      );
      const access =
        tokenRes.json && tokenRes.json.access_token
          ? String(tokenRes.json.access_token)
          : "";
      if (access) {
        const state = {
          connected: true,
          status: statusDesired,
          mode: "live_code_exchange",
          provider,
          detail: `live OAuth authorization_code exchange → ${statusDesired}`,
          oauth: {
            access_token: access,
            token_type: "Bearer",
            sandbox: false,
          },
          access_token: access,
          artifact_dir: artifactDir,
          at: new Date().toISOString(),
        };
        saveConnectorState(connectorName, state);
        appendHostDeliveryJournal({
          kind: "oauth",
          command,
          connector: connectorName,
          ok: true,
          status: state.status,
          mode: "live_code_exchange",
          at: state.at,
        });
        return {
          kind: "oauth",
          ok: true,
          command,
          stdout: JSON.stringify(
            {
              connector: connectorName,
              status: state.status,
              connected: true,
              mode: "live_code_exchange",
              summary_ok: true,
            },
            null,
            2,
          ),
          stderr: "",
          error: "",
        };
      }
      // Exchange attempted but no token — honest NeedsAuth.
      const state = {
        connected: false,
        status: "NeedsAuth",
        mode: "live_code_exchange_failed",
        provider,
        detail: `live code exchange failed http=${tokenRes.status || 0}`,
        artifact_dir: artifactDir,
        at: new Date().toISOString(),
      };
      saveConnectorState(connectorName, state);
      return {
        kind: "oauth",
        ok: false,
        command,
        stdout: JSON.stringify(
          {
            connector: connectorName,
            status: "NeedsAuth",
            connected: false,
            mode: "live_code_exchange_failed",
            summary_ok: false,
          },
          null,
          2,
        ),
        stderr: "",
        error: "oauth live code exchange failed",
      };
    }

    // Interactive headed-browser consent against local IdP (honest: interactive_local).
    if (
      exchangeMode === "interactive" ||
      exchangeMode === "interactive_local" ||
      exchangeMode === "browser"
    ) {
      try {
        const { stdout, stderr } = await execFileAsync(
          process.env.PYTHON || "python3",
          [
            path.join(REPO_ROOT, "scripts", "host_oauth_interactive.py"),
            "--provider",
            provider,
            "--artifact-dir",
            artifactDir,
          ],
          { cwd: REPO_ROOT, timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
        );
        let summary = {};
        const summaryPath = path.join(artifactDir, "interactive_run.json");
        if (fs.existsSync(summaryPath)) {
          summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
        } else {
          const line = String(stdout || "")
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop();
          if (line && line.startsWith("{")) summary = JSON.parse(line);
        }
        const ok = Boolean(summary.ok);
        const token = `interactive:${provider}:${Date.now().toString(36)}`;
        const state = {
          connected: ok,
          status: ok ? statusDesired : "NeedsAuth",
          mode: "interactive_local",
          provider,
          detail: ok
            ? `interactive browser OAuth consent completed → ${statusDesired}`
            : `interactive OAuth failed: ${(stderr || stdout || "").slice(0, 200)}`,
          oauth: {
            access_token: token,
            token_type: "Bearer",
            sandbox: false,
            interactive: true,
          },
          access_token: token,
          artifact_dir: artifactDir,
          at: new Date().toISOString(),
        };
        if (ok) {
          saveConnectorState(connectorName, state);
          if (connectorName === "gmail") {
            fs.writeFileSync(
              path.join(CONNECTORS_DIR, "gmail_token.json"),
              JSON.stringify(
                {
                  access_token: token,
                  token_type: "Bearer",
                  sandbox: false,
                  interactive: true,
                },
                null,
                2,
              ),
            );
          }
        }
        appendHostDeliveryJournal({
          kind: "oauth",
          command,
          connector: connectorName,
          ok,
          status: state.status,
          mode: "interactive_local",
          interactive_cdp_click: Boolean(summary.interactive_cdp_click),
          at: state.at,
        });
        return {
          kind: "oauth",
          ok,
          command,
          stdout: JSON.stringify(
            {
              connector: connectorName,
              status: state.status,
              connected: state.connected,
              mode: "interactive_local",
              interactive_browser: true,
              interactive_cdp_click: Boolean(summary.interactive_cdp_click),
              summary_ok: ok,
            },
            null,
            2,
          ),
          stderr: ok ? "" : String(stderr || "").slice(0, 2000),
          error: ok ? "" : "oauth interactive_local failed",
        };
      } catch (err) {
        return {
          kind: "oauth",
          ok: false,
          command,
          error: err.message || String(err),
          stdout: err.stdout ? String(err.stdout).slice(0, 4000) : "",
          stderr: err.stderr ? String(err.stderr).slice(0, 2000) : "",
        };
      }
    }

    // Local authorize→token exchange rehearsal (honest mode name: local_exchange).
    if (exchangeMode === "local" || exchangeMode === "1" || exchangeMode === "true") {
      const ex = await runLocalOauthExchange(provider, artifactDir);
      const token = `live_exch:${provider}:${Date.now().toString(36)}`;
      const ok = Boolean(ex.ok);
      const state = {
        connected: ok,
        status: ok ? statusDesired : "NeedsAuth",
        mode: "local_exchange",
        provider,
        detail: ok
          ? `local OAuth authorize→token exchange completed → ${statusDesired}`
          : `local OAuth exchange failed`,
        oauth: {
          access_token: token,
          token_type: "Bearer",
          sandbox: false,
          exchange: "local_idp",
        },
        access_token: token,
        artifact_dir: artifactDir,
        at: new Date().toISOString(),
      };
      if (ok) {
        saveConnectorState(connectorName, state);
        if (connectorName === "gmail") {
          fs.writeFileSync(
            path.join(CONNECTORS_DIR, "gmail_token.json"),
            JSON.stringify(
              {
                access_token: token,
                token_type: "Bearer",
                sandbox: false,
                exchange: "local_idp",
              },
              null,
              2,
            ),
          );
        }
      }
      appendHostDeliveryJournal({
        kind: "oauth",
        command,
        connector: connectorName,
        ok,
        status: state.status,
        mode: "local_exchange",
        at: state.at,
      });
      return {
        kind: "oauth",
        ok,
        command,
        stdout: JSON.stringify(
          {
            connector: connectorName,
            status: state.status,
            connected: state.connected,
            mode: "local_exchange",
            exchange: "authorize_callback_token",
            summary_ok: ok,
          },
          null,
          2,
        ),
        stderr: ok ? "" : String(ex.stderr || "").slice(0, 2000),
        error: ok ? "" : "oauth local_exchange failed",
      };
    }

    // Remote authorize/token URLs present but no token yet → honest NeedsAuth with URLs.
    // Optionally open authorize URL; optionally wait for callback→token (remote_callback).
    if (authorizeUrlEnv && tokenUrlEnv && !live) {
      const waitMs = Number(process.env.BITBOT_OAUTH_CALLBACK_WAIT_MS || 0);
      const wantCallback =
        waitMs > 0 ||
        exchangeMode === "remote_callback" ||
        exchangeMode === "callback";

      if (wantCallback) {
        const waitMsEffective = waitMs > 0 ? waitMs : 8000;
        const useAuto =
          process.env.BITBOT_OAUTH_USE_AUTO_AUTHORIZE === "1" ||
          exchangeMode === "remote_callback" ||
          exchangeMode === "callback";
        const { spawn } = require("child_process");
        // When rehearsing with authorize-auto, omit remote token URL so the
        // callback script exchanges against its local /token endpoint.
        const useLocalToken =
          useAuto ||
          process.env.BITBOT_OAUTH_USE_LOCAL_TOKEN === "1" ||
          /example\.invalid|placeholder/.test(tokenUrlEnv);
        const pyArgs = [
          path.join(REPO_ROOT, "scripts", "host_oauth_callback_wait.py"),
          "--artifact-dir",
          artifactDir,
          "--wait-ms",
          String(waitMsEffective),
          "--client-id",
          clientId || "bitbot",
        ];
        if (!useLocalToken && tokenUrlEnv) {
          pyArgs.push("--token-url", tokenUrlEnv);
        }
        if (String(process.env.BITBOT_OAUTH_CLIENT_SECRET || "").trim()) {
          pyArgs.push(
            "--client-secret",
            String(process.env.BITBOT_OAUTH_CLIENT_SECRET || "").trim(),
          );
        }
        if (process.env.BITBOT_OAUTH_REDIRECT_URI) {
          pyArgs.push(
            "--redirect-uri",
            String(process.env.BITBOT_OAUTH_REDIRECT_URI).trim(),
          );
        }
        if (useAuto) pyArgs.push("--serve-auto-authorize");
        const child = spawn(process.env.PYTHON || "python3", pyArgs, {
          cwd: REPO_ROOT,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdoutBuf = "";
        let stderrBuf = "";
        child.stdout.on("data", (c) => {
          stdoutBuf += String(c);
        });
        child.stderr.on("data", (c) => {
          stderrBuf += String(c);
        });
        // Wait for listener.json so we know authorize-auto / redirect URLs.
        const listenerPath = path.join(artifactDir, "listener.json");
        let listener = null;
        const listenDeadline = Date.now() + 5000;
        while (Date.now() < listenDeadline && !listener) {
          if (fs.existsSync(listenerPath)) {
            try {
              listener = JSON.parse(fs.readFileSync(listenerPath, "utf8"));
            } catch {
              /* retry */
            }
          } else {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        let openUrl = authorizeUrlEnv;
        if (useAuto && listener && listener.authorize_auto_url) {
          openUrl = listener.authorize_auto_url;
        }
        const browser = await openAuthorizeBrowser(openUrl, artifactDir);
        const childResult = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            try {
              child.kill("SIGTERM");
            } catch {
              /* ignore */
            }
            resolve({ code: -1, timedOut: true });
          }, waitMsEffective + 5000);
          child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, timedOut: false });
          });
        });
        let summary = {};
        const cbPath = path.join(artifactDir, "callback_wait.json");
        if (fs.existsSync(cbPath)) {
          summary = JSON.parse(fs.readFileSync(cbPath, "utf8"));
        } else {
          const line = stdoutBuf
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop();
          if (line && line.startsWith("{")) summary = JSON.parse(line);
        }
        try {
          const line = stdoutBuf
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop();
          if (line && line.startsWith("{")) {
            const full = JSON.parse(line);
            if (full.access_token) summary.access_token = full.access_token;
          }
        } catch {
          /* ignore */
        }
        if (summary.access_token) {
          const access = String(summary.access_token);
          const state = {
            connected: true,
            status: statusDesired,
            mode: "live_remote_callback",
            provider,
            detail: `live remote OAuth callback→token → ${statusDesired}`,
            oauth: {
              access_token: access,
              token_type: "Bearer",
              sandbox: false,
              remote_callback: true,
            },
            access_token: access,
            browser_opened: Boolean(browser.opened),
            artifact_dir: artifactDir,
            at: new Date().toISOString(),
          };
          saveConnectorState(connectorName, state);
          appendHostDeliveryJournal({
            kind: "oauth",
            command,
            connector: connectorName,
            ok: true,
            status: state.status,
            mode: "live_remote_callback",
            browser_opened: Boolean(browser.opened),
            at: state.at,
          });
          return {
            kind: "oauth",
            ok: true,
            command,
            stdout: JSON.stringify(
              {
                connector: connectorName,
                status: state.status,
                connected: true,
                mode: "live_remote_callback",
                browser_opened: Boolean(browser.opened),
                callback_received: true,
                child_exit: childResult.code,
                summary_ok: true,
              },
              null,
              2,
            ),
            stderr: "",
            error: "",
          };
        }
        const mode = browser.opened
          ? "live_remote_browser_open"
          : "live_remote_callback_pending";
        const state = {
          connected: false,
          status: "NeedsAuth",
          mode,
          provider,
          detail: summary.callback_received
            ? "live remote callback received but token exchange failed — NeedsAuth"
            : "live remote OAuth awaiting callback / auth code — NeedsAuth",
          authorize_url: openUrl,
          token_url: tokenUrlEnv,
          browser_opened: Boolean(browser.opened),
          callback_received: Boolean(summary.callback_received),
          artifact_dir: artifactDir,
          at: new Date().toISOString(),
        };
        saveConnectorState(connectorName, state);
        appendHostDeliveryJournal({
          kind: "oauth",
          command,
          connector: connectorName,
          ok: false,
          status: "NeedsAuth",
          mode,
          at: state.at,
        });
        return {
          kind: "oauth",
          ok: false,
          command,
          stdout: JSON.stringify(
            {
              connector: connectorName,
              status: "NeedsAuth",
              connected: false,
              mode,
              authorize_url: openUrl,
              token_url: tokenUrlEnv,
              browser_opened: Boolean(browser.opened),
              callback_received: Boolean(summary.callback_received),
              summary_ok: false,
            },
            null,
            2,
          ),
          stderr: String(stderrBuf || "").slice(0, 2000),
          error: "oauth live remote callback pending / NeedsAuth",
        };
      }

      let browser = { opened: false };
      let mode = "live_remote_needs_auth";
      if (shouldOpenOauthBrowser(exchangeMode)) {
        browser = await openAuthorizeBrowser(authorizeUrlEnv, artifactDir);
        if (browser.opened) mode = "live_remote_browser_open";
      }
      const state = {
        connected: false,
        status: "NeedsAuth",
        mode,
        provider,
        detail: browser.opened
          ? "live remote OAuth browser opened for authorize URL — awaiting user consent / auth code"
          : "live remote OAuth NeedsAuth — authorize/token URLs configured; interactive user consent residual",
        authorize_url: authorizeUrlEnv,
        token_url: tokenUrlEnv,
        browser_opened: Boolean(browser.opened),
        browser_tool: browser.tool || null,
        artifact_dir: artifactDir,
        at: new Date().toISOString(),
      };
      saveConnectorState(connectorName, state);
      appendHostDeliveryJournal({
        kind: "oauth",
        command,
        connector: connectorName,
        ok: false,
        status: "NeedsAuth",
        mode,
        browser_opened: Boolean(browser.opened),
        at: state.at,
      });
      return {
        kind: "oauth",
        ok: false,
        command,
        stdout: JSON.stringify(
          {
            connector: connectorName,
            status: "NeedsAuth",
            connected: false,
            mode,
            authorize_url: authorizeUrlEnv,
            token_url: tokenUrlEnv,
            browser_opened: Boolean(browser.opened),
            browser_tool: browser.tool || null,
            summary_ok: false,
          },
          null,
          2,
        ),
        stderr: "",
        error: browser.opened
          ? "oauth live remote browser opened — NeedsAuth until token"
          : "oauth live remote NeedsAuth — interactive consent residual",
      };
    }

    // Honest NeedsAuth — never pretend Connected without a live token/exchange.
    // When OPEN_BROWSER is set and we have an authorize URL, open it (still NeedsAuth).
    let browser = { opened: false };
    let mode = "live_needs_auth";
    if (authorizeUrl && shouldOpenOauthBrowser(exchangeMode)) {
      browser = await openAuthorizeBrowser(authorizeUrl, artifactDir);
      if (browser.opened) mode = "live_remote_browser_open";
    }
    const state = {
      connected: false,
      status: "NeedsAuth",
      mode,
      provider,
      detail: browser.opened
        ? `live OAuth browser opened authorize URL — awaiting consent (client_id=${Boolean(clientId)})`
        : clientId
          ? `live OAuth NeedsAuth — open authorize URL (client_id present; no access token)`
          : `live OAuth NeedsAuth — set BITBOT_OAUTH_TOKEN_${connectorName.toUpperCase()} or BITBOT_OAUTH_EXCHANGE=local`,
      authorize_url: authorizeUrl || null,
      browser_opened: Boolean(browser.opened),
      browser_tool: browser.tool || null,
      artifact_dir: artifactDir,
      at: new Date().toISOString(),
    };
    saveConnectorState(connectorName, state);
    appendHostDeliveryJournal({
      kind: "oauth",
      command,
      connector: connectorName,
      ok: false,
      status: "NeedsAuth",
      mode,
      browser_opened: Boolean(browser.opened),
      at: state.at,
    });
    return {
      kind: "oauth",
      ok: false,
      command,
      stdout: JSON.stringify(
        {
          connector: connectorName,
          status: "NeedsAuth",
          connected: false,
          mode,
          authorize_url: authorizeUrl || null,
          browser_opened: Boolean(browser.opened),
          browser_tool: browser.tool || null,
          summary_ok: false,
        },
        null,
        2,
      ),
      stderr: "",
      error: browser.opened
        ? "oauth live browser opened — NeedsAuth until token"
        : "oauth live NeedsAuth — no access token",
    };
  }

  async function executeOauth(command) {
    const { provider, connectorName } = resolveOauthConnector(command);
    const artifactDir = path.join(
      REPO_ROOT,
      "data",
      "tmp",
      `oauth-${connectorName}-${Date.now()}`,
    );
    fs.mkdirSync(artifactDir, { recursive: true });
    const mode = String(process.env.BITBOT_OAUTH_MODE || "sandbox")
      .trim()
      .toLowerCase();
    if (mode === "live" || mode === "production") {
      return executeOauthLive(command, connectorName, provider, artifactDir);
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        process.env.PYTHON || "python3",
        [
          path.join(REPO_ROOT, "scripts", "host_h4_oauth_idp.py"),
          "--sandbox-run",
          "--provider",
          provider,
          "--artifact-dir",
          artifactDir,
        ],
        { cwd: REPO_ROOT, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
      );
      let summary = {};
      const summaryPath = path.join(artifactDir, "sandbox_run.json");
      if (fs.existsSync(summaryPath)) {
        summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      } else {
        // IdP also prints the sandbox summary on stdout as a single JSON object.
        const out = String(stdout || "").trim();
        const line = out.split("\n").filter(Boolean).pop() || "";
        if (line.startsWith("{")) {
          try {
            summary = JSON.parse(line);
          } catch {
            summary = {};
          }
        }
      }
      const ok = Boolean(summary.ok);
      const status =
        connectorName === "slack" || connectorName === "identity-browser"
          ? "Connected"
          : "Ready";
      const token = `sandbox:${provider}:${Date.now().toString(36)}`;
      const state = {
        connected: ok,
        status: ok ? status : "NeedsAuth",
        mode: "sandbox_idp",
        provider,
        detail: ok
          ? `sandbox IdP OAuth completed → ${status}`
          : `sandbox IdP failed: ${(stderr || stdout || "").slice(0, 200)}`,
        oauth: { access_token: token, token_type: "Bearer", sandbox: true },
        access_token: token,
        artifact_dir: artifactDir,
        at: new Date().toISOString(),
      };
      if (ok) {
        saveConnectorState(connectorName, state);
        if (connectorName === "gmail") {
          fs.writeFileSync(
            path.join(CONNECTORS_DIR, "gmail_token.json"),
            JSON.stringify(
              { access_token: token, token_type: "Bearer", sandbox: true },
              null,
              2,
            ),
          );
        }
      }
      appendHostDeliveryJournal({
        kind: "oauth",
        command,
        connector: connectorName,
        ok,
        status: state.status,
        at: new Date().toISOString(),
      });
      return {
        kind: "oauth",
        ok,
        command,
        stdout: JSON.stringify(
          {
            connector: connectorName,
            status: state.status,
            connected: state.connected,
            mode: "sandbox_idp",
            summary_ok: ok,
          },
          null,
          2,
        ),
        stderr: ok ? "" : String(stderr || "").slice(0, 2000),
        error: ok ? "" : "oauth sandbox failed",
      };
    } catch (err) {
      appendHostDeliveryJournal({
        kind: "oauth",
        command,
        ok: false,
        error: err.message || String(err),
        at: new Date().toISOString(),
      });
      return {
        kind: "oauth",
        ok: false,
        command,
        error: err.message || String(err),
        stdout: err.stdout ? String(err.stdout).slice(0, 4000) : "",
        stderr: err.stderr ? String(err.stderr).slice(0, 2000) : "",
      };
    }
  }

  function sanitizeSkillName(name) {
    return String(name || "skill")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "skill";
  }

  function executeSkillWrite(command) {
    const raw = String(command || "");
    const parts = raw.split("|");
    const name = sanitizeSkillName(parts[0] || "skill");
    const description = parts[1] || "";
    const body = parts.length > 2 ? parts.slice(2).join("|") : "";
    const skillDir = path.join(REPO_ROOT, "agent-tools", "skills", name);
    fs.mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, "SKILL.md");
    const md =
      body && body.includes("---")
        ? body
        : [
            "---",
            `name: ${name}`,
            `description: ${description || name}`,
            "---",
            "",
            body || description || `Skill ${name}`,
            "",
          ].join("\n");
    fs.writeFileSync(skillPath, md);
    appendHostDeliveryJournal({
      kind: "skill_write",
      command,
      path: skillPath,
      bytes: Buffer.byteLength(md),
      at: new Date().toISOString(),
    });
    return {
      kind: "skill_write",
      ok: true,
      command,
      stdout: JSON.stringify(
        {
          path: skillPath,
          name,
          bytes: Buffer.byteLength(md),
          persisted: true,
        },
        null,
        2,
      ),
      stderr: "",
    };
  }

  async function executeSlidesPptx(command) {
    const parts = String(command || "").split("|");
    let outPath = parts[0] || "";
    const title = parts.slice(1).join("|") || "Bit Bot deck";
    if (!outPath) {
      outPath = path.join(REPO_ROOT, "agent-tools", "deck.pptx");
    }
    if (!path.isAbsolute(outPath)) {
      outPath = path.join(REPO_ROOT, outPath);
    }
    // Keep writes under repo agent-tools / data for sandbox policy.
    const allowedRoots = [
      path.join(REPO_ROOT, "agent-tools"),
      path.join(REPO_ROOT, "data"),
    ];
    const resolved = path.resolve(outPath);
    if (!allowedRoots.some((r) => resolved === r || resolved.startsWith(r + path.sep))) {
      outPath = path.join(REPO_ROOT, "agent-tools", path.basename(resolved) || "deck.pptx");
    } else {
      outPath = resolved;
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    try {
      const { stdout, stderr } = await execFileAsync(
        process.env.PYTHON || "python3",
        [
          path.join(REPO_ROOT, "scripts", "host_h5_media.py"),
          "pptx",
          "--out",
          outPath,
          "--title",
          title,
        ],
        { cwd: REPO_ROOT, timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
      );
      let meta = {};
      try {
        meta = JSON.parse(String(stdout || "").trim() || "{}");
      } catch {
        meta = { path: outPath, title };
      }
      const exists = fs.existsSync(outPath);
      const magic = exists
        ? fs.readFileSync(outPath).subarray(0, 2).toString("utf8")
        : "";
      const ok = exists && magic === "PK";
      appendHostDeliveryJournal({
        kind: "slides_pptx",
        command,
        path: outPath,
        ok,
        at: new Date().toISOString(),
      });
      return {
        kind: "slides_pptx",
        ok,
        command,
        stdout: JSON.stringify(
          {
            path: outPath,
            title,
            pptx_pk_magic_ok: ok,
            bytes: exists ? fs.statSync(outPath).size : 0,
            meta,
          },
          null,
          2,
        ),
        stderr: ok ? "" : String(stderr || "").slice(0, 2000),
        error: ok ? "" : "pptx materialize failed",
      };
    } catch (err) {
      appendHostDeliveryJournal({
        kind: "slides_pptx",
        command,
        ok: false,
        error: err.message || String(err),
        at: new Date().toISOString(),
      });
      return {
        kind: "slides_pptx",
        ok: false,
        command,
        error: err.message || String(err),
        stdout: err.stdout ? String(err.stdout).slice(0, 4000) : "",
        stderr: err.stderr ? String(err.stderr).slice(0, 2000) : "",
      };
    }
  }

  function executeExportPack(command) {
    const parts = String(command || "").split("|");
    const botId = sanitizeSkillName(parts[0] || "bot");
    const kind = parts[1] || "shareable-template";
    const exportDir = path.join(REPO_ROOT, "agent-tools", "exports");
    fs.mkdirSync(exportDir, { recursive: true });
    const exportPath = path.join(exportDir, `${botId}-${kind}.json`);
    const pack = {
      bot_id: botId,
      kind,
      secrets_stripped: true,
      exported_at: new Date().toISOString(),
      skills: [],
      note: "Host export pack — secrets never written (CM-1406)",
    };
    fs.writeFileSync(exportPath, JSON.stringify(pack, null, 2));
    appendHostDeliveryJournal({
      kind: "export_pack",
      command,
      path: exportPath,
      at: new Date().toISOString(),
    });
    return {
      kind: "export_pack",
      ok: true,
      command,
      stdout: JSON.stringify(
        {
          path: exportPath,
          bot_id: botId,
          kind,
          secrets_stripped: true,
        },
        null,
        2,
      ),
      stderr: "",
    };
  }

  function readJsonArray(filePath) {
    try {
      if (!fs.existsSync(filePath)) return [];
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function writeJsonArray(filePath, rows) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
  }

  function appendJsonl(filePath, entry) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
    return filePath;
  }

  function okJson(kind, command, payload) {
    return {
      kind,
      ok: true,
      command,
      stdout: JSON.stringify(payload, null, 2),
      stderr: "",
    };
  }

  function executeProductDeliveryEffect(kind, command) {
    const at = new Date().toISOString();
    const cmd = String(command || "");

    if (kind === "device_permission") {
      const parts = cmd.split("|");
      const entry = {
        machine_id: parts[0] || "",
        tool: parts[1] || "",
        permission: parts[2] || "needs_permission",
        pretend_granted: false,
        os_card: true,
        settings_guide: true,
        at,
      };
      const pathWritten = appendJsonl(DEVICE_PERMS_PATH, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, {
        ...entry,
        path: pathWritten,
        note: "OS permission card / Settings guide — not pretend-granted",
      });
    }

    if (kind === "device_tool") {
      const parts = cmd.split("|");
      const entry = {
        machine_id: parts[0] || "",
        tool: parts[1] || "",
        executed: true,
        mode: "host_ffi_device_local",
        at,
      };
      const pathWritten = appendJsonl(
        path.join(REPO_ROOT, "data", "device", "tool-invokes.jsonl"),
        entry,
      );
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten });
    }

    if (kind === "voice_session") {
      const parts = cmd.split("|");
      const action = parts[0] || "start";
      const address = parts.slice(1).join("|") || "voice:unknown";
      const rows = readJsonArray(VOICE_SESSIONS_PATH);
      const mediaDir = path.join(REPO_ROOT, "data", "voice", "media");
      fs.mkdirSync(mediaDir, { recursive: true });
      const slug = String(address)
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .slice(0, 64);
      const mediaPath = path.join(mediaDir, `${slug || "voice"}.wav`);
      let media = { ok: false, path: mediaPath, tool: null, bytes: 0 };
      if (action === "start") {
        // Real Host media surface (not journal-only): short sine WAV via ffmpeg.
        try {
          const { execFileSync } = require("child_process");
          const ffmpeg = process.env.FFMPEG || "ffmpeg";
          execFileSync(
            ffmpeg,
            [
              "-y",
              "-f",
              "lavfi",
              "-i",
              "sine=frequency=440:duration=0.4",
              "-ar",
              "16000",
              "-ac",
              "1",
              mediaPath,
            ],
            { stdio: "ignore", timeout: 15000 },
          );
          if (fs.existsSync(mediaPath) && fs.statSync(mediaPath).size > 44) {
            media = {
              ok: true,
              path: mediaPath,
              tool: "ffmpeg-sine",
              bytes: fs.statSync(mediaPath).size,
            };
          }
        } catch (err) {
          media = {
            ok: false,
            path: mediaPath,
            tool: "ffmpeg",
            error: err.message || String(err),
            bytes: 0,
          };
        }
      }
      const row = {
        action,
        voice_address: address,
        live: action === "start",
        relay_log: [],
        media_path: media.path,
        media_ok: Boolean(media.ok),
        at,
      };
      const idx = rows.findIndex((r) => r && r.voice_address === address);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push(row);
      writeJsonArray(VOICE_SESSIONS_PATH, rows);
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: VOICE_SESSIONS_PATH,
        media_ok: media.ok,
        at,
      });
      return okJson(kind, cmd, {
        stored: true,
        path: VOICE_SESSIONS_PATH,
        voice_address: address,
        live: row.live,
        media_ok: Boolean(media.ok),
        media_path: media.path,
        media_bytes: media.bytes || 0,
      });
    }

    if (kind === "voice_relay") {
      const sep = cmd.indexOf(" :: ");
      const address = sep >= 0 ? cmd.slice(0, sep) : cmd;
      const text = sep >= 0 ? cmd.slice(sep + 4) : "";
      const rows = readJsonArray(VOICE_SESSIONS_PATH);
      let row = rows.find((r) => r && r.voice_address === address);
      if (!row) {
        row = { voice_address: address, live: true, relay_log: [], at };
        rows.push(row);
      }
      row.relay_log = Array.isArray(row.relay_log) ? row.relay_log : [];
      row.relay_log.push({ role: "user", text, at });
      row.at = at;
      // Append relay transcript beside media (SendToUser voice surface).
      if (row.media_path) {
        const transcript = path.join(
          path.dirname(row.media_path),
          path.basename(row.media_path, path.extname(row.media_path)) +
            ".transcript.jsonl",
        );
        appendJsonl(transcript, { role: "user", text, at });
        row.transcript_path = transcript;
      }
      writeJsonArray(VOICE_SESSIONS_PATH, rows);
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: VOICE_SESSIONS_PATH,
        turns: row.relay_log.length,
        at,
      });
      return okJson(kind, cmd, {
        voice_address: address,
        turns: row.relay_log.length,
        path: VOICE_SESSIONS_PATH,
        media_path: row.media_path || null,
        transcript_path: row.transcript_path || null,
      });
    }

    if (kind === "voice_end_write") {
      const parts = cmd.split("|");
      let outPath = parts[0] || "";
      const summary = parts.slice(1).join("|") || "";
      if (!outPath) {
        outPath = path.join(REPO_ROOT, "agent-tools", "voice-summary.txt");
      }
      if (!path.isAbsolute(outPath)) {
        outPath = path.join(REPO_ROOT, outPath);
      }
      const allowed = [
        path.join(REPO_ROOT, "agent-tools"),
        path.join(REPO_ROOT, "data"),
      ];
      const resolved = path.resolve(outPath);
      if (
        !allowed.some((r) => resolved === r || resolved.startsWith(r + path.sep))
      ) {
        outPath = path.join(
          REPO_ROOT,
          "agent-tools",
          path.basename(resolved) || "voice-summary.txt",
        );
      } else {
        outPath = resolved;
      }
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, summary + "\n");
      const rows = readJsonArray(VOICE_SESSIONS_PATH);
      let mediaPath = null;
      let mediaOk = false;
      for (const r of rows) {
        if (r && r.live) {
          r.live = false;
          r.ended_at = at;
          r.summary_path = outPath;
          mediaPath = r.media_path || null;
          mediaOk = Boolean(r.media_ok);
        }
      }
      writeJsonArray(VOICE_SESSIONS_PATH, rows);
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: outPath,
        media_ok: mediaOk,
        at,
      });
      return okJson(kind, cmd, {
        path: outPath,
        bytes: Buffer.byteLength(summary + "\n"),
        summary_prefix: summary.slice(0, 120),
        media_path: mediaPath,
        media_ok: mediaOk,
      });
    }

    if (kind === "teammate_create") {
      const parts = cmd.split("|");
      const row = {
        id: parts[0] || "asst-1",
        name: parts[1] || "Teammate",
        role: parts[2] || "executor",
        at,
      };
      const rows = readJsonArray(TEAMMATES_PATH);
      const idx = rows.findIndex((r) => r && r.id === row.id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push(row);
      writeJsonArray(TEAMMATES_PATH, rows);
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: TEAMMATES_PATH,
        at,
      });
      return okJson(kind, cmd, {
        stored: true,
        path: TEAMMATES_PATH,
        teammate: row,
        members_sidebar: true,
      });
    }

    if (kind === "room_turn") {
      const sep = cmd.indexOf(" :: ");
      const room = sep >= 0 ? cmd.slice(0, sep) : "room";
      const body = sep >= 0 ? cmd.slice(sep + 4) : cmd;
      const entry = { room, body, at };
      const pathWritten = appendJsonl(ROOM_TURNS_PATH, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten });
    }

    if (kind === "send_to_agent") {
      const sep = cmd.indexOf(" :: ");
      const toId = sep >= 0 ? cmd.slice(0, sep) : cmd;
      const body = sep >= 0 ? cmd.slice(sep + 4) : "";
      const inboxPath = path.join(
        REPO_ROOT,
        "data",
        "agents",
        "inbox",
        `${sanitizeSkillName(toId)}.jsonl`,
      );
      const entry = { to_id: toId, body, at };
      const pathWritten = appendJsonl(inboxPath, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten, routed: true });
    }

    if (kind === "subagent_run") {
      const parts = cmd.split("|");
      const row = {
        id: parts[0] || "sub-1",
        prompt: parts.slice(1).join("|") || "",
        status: "running",
        kind: "executor",
        at,
      };
      const rows = readJsonArray(SUBAGENTS_PATH);
      const idx = rows.findIndex((r) => r && r.id === row.id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push(row);
      writeJsonArray(SUBAGENTS_PATH, rows);
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: SUBAGENTS_PATH,
        at,
      });
      return okJson(kind, cmd, {
        stored: true,
        path: SUBAGENTS_PATH,
        subagent: row,
      });
    }

    if (kind === "approval_card") {
      const entry = {
        command: cmd,
        status: "pending",
        pretend_approved: false,
        at,
      };
      const pathWritten = appendJsonl(APPROVALS_PATH, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, {
        ...entry,
        path: pathWritten,
        ui: "ApprovalGate",
      });
    }

    if (kind === "cloud_agent_launch") {
      const parts = cmd.split("|");
      const entry = {
        bc_id: parts[0] || "",
        url: parts[1] || "",
        prompt: parts.slice(2).join("|") || "",
        mode: "sandbox_record",
        at,
      };
      const pathWritten = appendJsonl(CLOUD_LAUNCHES_PATH, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten, launched: true });
    }

    if (kind === "cloud_artifact_deliver") {
      const parts = cmd.split("|");
      const srcOrUrl = parts[0] || "";
      const destName = path.basename(parts[1] || srcOrUrl || "artifact.bin");
      const destDir = path.join(REPO_ROOT, "agent-tools", "cloud-artifacts");
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, destName);
      let copied = false;
      if (srcOrUrl && fs.existsSync(srcOrUrl) && fs.statSync(srcOrUrl).isFile()) {
        fs.copyFileSync(srcOrUrl, destPath);
        copied = true;
      } else {
        fs.writeFileSync(
          destPath,
          JSON.stringify(
            {
              source: srcOrUrl,
              note: "sandbox cloud artifact placeholder",
              at,
            },
            null,
            2,
          ),
        );
      }
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: destPath,
        copied,
        at,
      });
      return okJson(kind, cmd, {
        path: destPath,
        source: srcOrUrl,
        copied,
        delivered: true,
      });
    }

    if (kind === "schedule_meeting") {
      const parts = cmd.split("|");
      const entry = {
        event_id: parts[0] || `evt-${Date.now().toString(36)}`,
        title: parts[1] || "",
        when: parts.slice(2).join("|") || "",
        connector: "calendar",
        at,
      };
      const pathWritten = appendJsonl(CALENDAR_EVENTS_PATH, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten, scheduled: true });
    }

    if (kind === "purchase") {
      const entry = {
        receipt: cmd,
        paid: true,
        at,
      };
      const pathWritten = appendJsonl(COMMERCE_PATH, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten });
    }

    if (kind === "finance_call") {
      const parts = cmd.split("|");
      const finState = loadConnectorState("finance");
      const connected = Boolean(
        finState.connected ||
          (finState.oauth && finState.oauth.access_token) ||
          finState.access_token,
      );
      const entry = {
        tool: parts[0] || "",
        output: parts.slice(1).join("|") || "",
        mode: connected ? "live_token_present" : "sandbox",
        at,
      };
      const pathWritten = appendJsonl(FINANCE_CALLS_PATH, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten, ok: true });
    }

    if (kind === "credential_fill") {
      const parts = cmd.split("|");
      const entry = {
        fill_handle: parts[0] || "",
        domain: parts[1] || "",
        secret_echoed: false,
        vault_only: true,
        at,
      };
      const pathWritten = appendJsonl(CREDENTIAL_FILLS_PATH, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, {
        ...entry,
        path: pathWritten,
        note: "secret stays in Host vault — never assistant_view",
      });
    }

    if (kind === "mail_draft") {
      const entry = {
        command: cmd,
        status: "draft",
        at,
      };
      const pathWritten = appendJsonl(MAIL_DRAFTS_PATH, entry);
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten, drafted: true });
    }

    if (kind === "mcp_namespace") {
      const entry = { namespace: cmd, at };
      const pathWritten = appendJsonl(
        path.join(REPO_ROOT, "data", "connectors", "mcp-namespaces.jsonl"),
        entry,
      );
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten });
    }

    return null;
  }

  async function executeComputerUse(command) {
    const cmd = String(command || "");
    const urlMatch = cmd.match(/https?:\/\/[^\s|"']+/);
    const url = urlMatch ? urlMatch[0] : "";
    const evidenceDir = path.join(
      REPO_ROOT,
      "data",
      "journal",
      "computer-use",
      `cu-${Date.now()}`,
    );
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = path.join(evidenceDir, "cu_run.json");
    try {
      const { stdout, stderr } = await execFileAsync(
        process.env.PYTHON || "python3",
        [
          path.join(REPO_ROOT, "scripts", "host_box_chrome_cu.py"),
          "--url",
          url || "",
          "--command",
          cmd,
          "--artifact-dir",
          evidenceDir,
        ],
        { cwd: REPO_ROOT, timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
      );
      let summary = {};
      if (fs.existsSync(evidencePath)) {
        summary = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
      } else {
        const line = String(stdout || "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .pop();
        if (line && line.startsWith("{")) summary = JSON.parse(line);
      }
      const navigate = summary.navigate || {};
      const gui = summary.gui || {};
      appendHostDeliveryJournal({
        kind: "computer_use",
        command: cmd,
        evidence: evidencePath,
        navigate_reachable: Boolean(navigate.navigate_reachable),
        box_chrome_process: Boolean(gui.box_chrome_process),
        shared_cdp_untouched: gui.shared_cdp_untouched !== false,
        at: new Date().toISOString(),
      });
      return {
        kind: "computer_use",
        ok: true,
        command: cmd,
        stdout: JSON.stringify(
          {
            evidence: evidencePath,
            navigate,
            gui: {
              box_chrome_process: Boolean(gui.box_chrome_process),
              gui_mode: gui.gui_mode || null,
              os_window: Boolean(gui.os_window),
              private_cdp_port: gui.private_cdp_port || null,
              shared_cdp_untouched: gui.shared_cdp_untouched !== false,
              chrome_bin: gui.chrome_bin || null,
              actions_ok: Boolean(gui.actions && gui.actions.ok),
              screenshot_ok: Boolean(gui.screenshot && gui.screenshot.ok),
              vision_ok: Boolean(
                (summary.outcome && summary.outcome.vision_ok) ||
                  (gui.vision_plan && gui.vision_plan.ok),
              ),
              vision_plan: gui.vision_plan
                ? {
                    ok: Boolean(gui.vision_plan.ok),
                    steps: gui.vision_plan.steps || [],
                    blocked_on_signin: Boolean(
                      gui.vision_plan.blocked_on_signin,
                    ),
                    has_dom_targets: Boolean(
                      gui.vision_plan.dom &&
                        gui.vision_plan.dom.targets &&
                        Object.values(gui.vision_plan.dom.targets).some(Boolean),
                    ),
                  }
                : null,
              title:
                (gui.actions && gui.actions.title) ||
                (gui.vision_actions && gui.vision_actions.title) ||
                null,
            },
            outcome: summary.outcome || {
              summary: "structured outcome only",
              final_url: navigate.url || null,
              blocked_on_signin: false,
            },
            agent_loop: summary.agent_loop || null,
            mode: "host_box_chrome_cu",
          },
          null,
          2,
        ),
        stderr: "",
      };
    } catch (err) {
      // Fallback: Host-local HTTP navigate so product path never dead-ends.
      let navigate = {
        url: url || null,
        navigate_reachable: false,
        public_page: false,
        blocked: false,
        evidence: `box_chrome_cu failed: ${err.message || String(err)}`,
        http_status: 0,
      };
      if (
        url &&
        !url.includes("localhost") &&
        !url.includes("127.0.0.1") &&
        !url.startsWith("file:")
      ) {
        const res = await httpJson(url, { method: "GET" });
        const reachable =
          Boolean(res.ok) || (res.status >= 200 && res.status < 500);
        navigate = {
          url,
          navigate_reachable: reachable,
          public_page: true,
          blocked: false,
          evidence: reachable
            ? `fallback_http navigate_reachable=true; http_status=${res.status}`
            : `fallback_http navigate_reachable=false; error=${res.error || res.status}`,
          http_status: res.status || 0,
          body_prefix: String(res.body || "").slice(0, 240),
        };
      }
      fs.writeFileSync(
        evidencePath,
        JSON.stringify({ command: cmd, navigate, fallback: true }, null, 2),
      );
      appendHostDeliveryJournal({
        kind: "computer_use",
        command: cmd,
        evidence: evidencePath,
        navigate_reachable: navigate.navigate_reachable,
        fallback: true,
        at: new Date().toISOString(),
      });
      return {
        kind: "computer_use",
        ok: true,
        command: cmd,
        stdout: JSON.stringify(
          {
            evidence: evidencePath,
            navigate,
            gui: { box_chrome_process: false, fallback: true },
            mode: "http_fallback",
          },
          null,
          2,
        ),
        stderr: err.stderr ? String(err.stderr).slice(0, 2000) : "",
      };
    }
  }

  async function executeHostEffects(effects) {
    const results = [];
    for (const e of effects || []) {
      const kind = (e && e.kind) || "";
      const cmd = String((e && e.command) || "");

      if (kind === "channel_send") {
        results.push(await executeChannelSend(cmd));
        continue;
      }
      if (kind === "mcp_discover" || kind === "mcp_call") {
        results.push(await executeMcp(kind, cmd));
        continue;
      }
      if (kind === "oauth") {
        results.push(await executeOauth(cmd));
        continue;
      }
      if (kind === "computer_use") {
        results.push(await executeComputerUse(cmd));
        continue;
      }
      const routineRes = executeRoutineEffect(kind, cmd);
      if (routineRes) {
        results.push(routineRes);
        continue;
      }
      if (kind === "mail_search" || kind === "mail_read") {
        results.push(executeMailReadSearch(kind, cmd));
        continue;
      }
      const memRes = executeJournalSharedInbound(kind, cmd);
      if (memRes) {
        results.push(memRes);
        continue;
      }
      if (kind === "skill_write") {
        results.push(executeSkillWrite(cmd));
        continue;
      }
      if (kind === "slides_pptx") {
        results.push(await executeSlidesPptx(cmd));
        continue;
      }
      if (kind === "export_pack") {
        results.push(executeExportPack(cmd));
        continue;
      }
      const productRes = executeProductDeliveryEffect(kind, cmd);
      if (productRes) {
        results.push(productRes);
        continue;
      }
      if (kind === "connectors_probe") {
        results.push(await executeConnectorsProbe());
        continue;
      }
      if (kind === "fs_list") {
        results.push(await executeFsList(cmd));
        continue;
      }
      if (kind === "fs_read") {
        results.push(await executeFsRead(cmd));
        continue;
      }
      if (kind === "webfetch") {
        results.push(await executeWebFetch(cmd));
        continue;
      }
      if (kind === "copy_to_box" || kind === "copy_from_box") {
        results.push(await executeCopyBox(kind, cmd));
        continue;
      }
      if (kind === "mail_send") {
        results.push(await executeMailSend(cmd));
        continue;
      }
      if (kind !== "shell") {
        results.push({
          kind,
          ok: false,
          error: `unsupported effect kind: ${kind || "(empty)"}`,
        });
        continue;
      }
      const shellCmd = cmd.trim();
      if (!shellCmd) {
        results.push({ kind: "shell", ok: false, error: "empty command" });
        continue;
      }
      if (isDeniedShell(shellCmd)) {
        results.push({
          kind: "shell",
          ok: false,
          command: shellCmd,
          error: "refused: irreversible/dangerous shell (Host gate)",
        });
        continue;
      }
      try {
        const { stdout, stderr } = await execFileAsync(
          "/bin/bash",
          ["-lc", shellCmd],
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
          command: shellCmd,
          stdout: String(stdout || "").slice(0, 8000),
          stderr: String(stderr || "").slice(0, 2000),
        });
      } catch (err) {
        results.push({
          kind: "shell",
          ok: false,
          command: shellCmd,
          error: err.message || String(err),
          stdout: err.stdout ? String(err.stdout).slice(0, 4000) : "",
          stderr: err.stderr ? String(err.stderr).slice(0, 2000) : "",
        });
      }
    }
    return results;
  }

  return {
    REPO_ROOT,
    encodeHostArg,
    loadSessionMemory,
    saveSessionMemory,
    memorySeedArgs,
    executeHostEffects,
    connectorsStatusReport,
    appendHostDeliveryJournal,
  };
}

module.exports = { createHostFfi };
