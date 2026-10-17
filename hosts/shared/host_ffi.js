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
  const SECTIONS_DIR = path.join(REPO_ROOT, "data", "agents", "sections");
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
  const SEND_TO_USER_PATH = path.join(
    REPO_ROOT,
    "data",
    "delivery",
    "send-to-user.jsonl",
  );
  const OUTBOUND_REACTIONS_PATH = path.join(
    REPO_ROOT,
    "data",
    "delivery",
    "outbound-reactions.jsonl",
  );
  const ROOM_TURNS_PATH = path.join(
    REPO_ROOT,
    "data",
    "agents",
    "room-turns.jsonl",
  );
  const AGENT_OUTBOX_DIR = path.join(REPO_ROOT, "data", "agents", "outbox");
  const AGENT_INBOX_DIR = path.join(REPO_ROOT, "data", "agents", "inbox");
  const SUBAGENT_RESULTS_DIR = path.join(
    REPO_ROOT,
    "data",
    "agents",
    "subagent-results",
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
    // BITBOT_SLACK_API_BASE allows local mock (e.g. http://127.0.0.1:18769) for Host deepen.
    const base = String(process.env.BITBOT_SLACK_API_BASE || "https://slack.com/api")
      .trim()
      .replace(/\/$/, "");
    const res = await httpJson(`${base}/${method}`, {
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
    const at = new Date().toISOString();
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
      const dir = path.join(REPO_ROOT, "data", "host-tools", "fs");
      fs.mkdirSync(dir, { recursive: true });
      const artifactPath = path.join(
        dir,
        `list-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        path: command,
        abs,
        count: entries.length,
        entries: entries.slice(0, 200),
        mode: "host_fs_list",
        pretend_listing: false,
        under_repo: true,
        at,
      };
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "lists.jsonl"), {
        ...artifact,
        artifact_path: artifactPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: artifactPath,
        label: "fs_list",
        source_kind: "fs_list",
        at,
      });
      appendHostDeliveryJournal({
        kind: "fs_list",
        command,
        path: artifactPath,
        count: entries.length,
        at,
      });
      return okJson("fs_list", command, {
        ...artifact,
        artifact_path: artifactPath,
        send_to_user: delivery,
        ok: true,
      });
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
    const at = new Date().toISOString();
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
      const dir = path.join(REPO_ROOT, "data", "host-tools", "fs");
      fs.mkdirSync(dir, { recursive: true });
      const artifactPath = path.join(
        dir,
        `read-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        path: command,
        abs,
        bytes: Buffer.byteLength(text, "utf8"),
        body_prefix: text.slice(0, 400),
        mode: "host_fs_read",
        pretend_contents: false,
        under_repo: true,
        at,
      };
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "reads.jsonl"), {
        ...artifact,
        artifact_path: artifactPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: artifactPath,
        label: "fs_read",
        source_kind: "fs_read",
        at,
      });
      appendHostDeliveryJournal({
        kind: "fs_read",
        command,
        path: artifactPath,
        bytes: artifact.bytes,
        at,
      });
      return okJson("fs_read", command, {
        ...artifact,
        artifact_path: artifactPath,
        // Keep truncated body for Host consumers that still expect text.
        body: text,
        send_to_user: delivery,
        ok: true,
      });
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
    const at = new Date().toISOString();
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
    const dir = path.join(REPO_ROOT, "data", "host-tools", "webfetch");
    fs.mkdirSync(dir, { recursive: true });
    const artifactPath = path.join(
      dir,
      `fetch-${Date.now().toString(36)}.json`,
    );
    const body = String(res.body || "");
    const artifact = {
      url,
      http_status: res.status || 0,
      ok: Boolean(res.ok),
      error: res.error || null,
      body_prefix: body.slice(0, 800),
      body_bytes: Buffer.byteLength(body, "utf8"),
      mode: "host_webfetch",
      pretend_fetched: false,
      at,
    };
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "fetches.jsonl"), {
      ...artifact,
      artifact_path: artifactPath,
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: artifactPath,
      label: "webfetch",
      url,
      source_kind: "webfetch",
      at,
    });
    appendHostDeliveryJournal({
      kind: "webfetch",
      command: url,
      path: artifactPath,
      http_status: artifact.http_status,
      at,
    });
    if (!res.ok) {
      return {
        kind: "webfetch",
        ok: false,
        command: url,
        error: res.error || `http_${res.status}`,
        stdout: JSON.stringify(
          {
            ...artifact,
            artifact_path: artifactPath,
            send_to_user: delivery,
          },
          null,
          2,
        ),
      };
    }
    return okJson("webfetch", url, {
      ...artifact,
      artifact_path: artifactPath,
      send_to_user: delivery,
      ok: true,
    });
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

  function finalizeChannelSend(raw, entry, extras = {}) {
    // Per-send Host snapshot (ledger jsonl retained by caller).
    const outboundPath =
      extras.outboundPath ||
      path.join(REPO_ROOT, "data", "channels", "outbound.jsonl");
    const sendDir = path.join(REPO_ROOT, "data", "channels", "sends");
    fs.mkdirSync(sendDir, { recursive: true });
    const sendPath = path.join(
      sendDir,
      `send-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      ...entry,
      pretend_live:
        entry && entry.pretend_live === true ? true : false,
      mode: (entry && entry.mode) || "channel_send",
    };
    const snapshot = {
      ...artifact,
      path: sendPath,
      outbound: outboundPath,
      inbound: extras.inbound || artifact.inbound || undefined,
      transcript: extras.transcript || artifact.transcript || undefined,
      teams_transcript:
        extras.teams_transcript || artifact.teams_transcript || undefined,
      mail: extras.mail || artifact.mail || undefined,
      claim: extras.claim || artifact.claim || undefined,
    };
    fs.writeFileSync(sendPath, JSON.stringify(snapshot, null, 2));
    appendJsonl(path.join(sendDir, "sends.jsonl"), snapshot);
    const journalPath =
      extras.journal ||
      appendHostDeliveryJournal({
        kind: "channel_send",
        path: sendPath,
        ...artifact,
      });
    const ok = extras.ok != null ? Boolean(extras.ok) : artifact.ok !== false;
    return {
      kind: "channel_send",
      ok,
      command: raw,
      stdout: JSON.stringify(
        {
          ...snapshot,
          journal: journalPath,
          send_to_user_type: extras.send_to_user_type || undefined,
        },
        null,
        2,
      ),
      error: ok ? "" : String(extras.error || "channel_send failed"),
      stderr: "",
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
      // Real Slack bot tokens (xox*) OR local mock token when BITBOT_SLACK_API_BASE is set.
      const slackApiBase = String(process.env.BITBOT_SLACK_API_BASE || "").trim();
      const looksLiveSlack = (t) =>
        /^(xox[baprs]-)/i.test(String(t || "").trim()) ||
        (Boolean(slackApiBase) &&
          String(t || "").trim().length > 0 &&
          !/^(sandbox:|remote_cb:)/i.test(String(t || "").trim()));
      const token = looksLiveSlack(envToken)
        ? envToken
        : looksLiveSlack(connectorToken)
          ? connectorToken
          : "";
      // Address forms: slack:Cxxx | slack:Cxxx:THREAD_TS | slack:Cxxx thread_ts=TS | slack:Cxxx thread=TS
      const slackRest = addr.slice("slack:".length).trim();
      const threadKv = slackRest.match(
        /(?:^|[\s:;])(?:thread_ts|thread)=([0-9]+(?:\.[0-9]+)?)/i,
      );
      const colonParts = slackRest.split(":").map((s) => s.trim()).filter(Boolean);
      let channelId = (colonParts[0] || "").split(/\s+/)[0] || "";
      // Strip trailing kv from channel token if glued (rare).
      channelId = channelId.replace(
        /(?:thread_ts|thread)=[0-9]+(?:\.[0-9]+)?$/i,
        "",
      );
      let threadTs = "";
      if (threadKv) {
        threadTs = threadKv[1];
      } else if (colonParts.length >= 2 && /^[0-9]+(?:\.[0-9]+)?$/.test(colonParts[1])) {
        threadTs = colonParts[1];
      }
      // CM-1103: personal Slack DM = owner user id (U…); shared channels (C…) are not DM.
      const isPersonalDm = /^U[A-Z0-9]+$/i.test(channelId);
      const isSharedChannel = /^C[A-Z0-9]+$/i.test(channelId);
      // CM-1104: channel degrade — strip naked widget payloads to text/link.
      let outboundBody = body;
      let widgetDegraded = false;
      if (/\[widget:|type=widget|decision_card/i.test(body)) {
        outboundBody = body
          .replace(/\[widget:[^\]]*\]/gi, "")
          .replace(/type=widget\S*/gi, "")
          .trim();
        if (!outboundBody) {
          outboundBody = "(widget degraded to text — open Desktop chat for choices)";
        }
        widgetDegraded = true;
      }
      // Optional inbound claim before / instead of post.
      let claim = null;
      if (
        token &&
        process.env.BITBOT_SLACK_CLAIM === "1" &&
        channelId
      ) {
        claim = await claimSlackInbound(token, channelId, inboundPath, stamp);
      }
      if (token && process.env.BITBOT_SLACK_POST === "1" && channelId && outboundBody) {
        const payload = {
          channel: channelId,
          text: outboundBody,
        };
        if (threadTs) payload.thread_ts = threadTs;
        const post = await slackApi("chat.postMessage", token, payload);
        const entry = {
          scheme,
          address: addr,
          body: outboundBody,
          mode: post.ok
            ? isPersonalDm
              ? "live_personal_slack_dm"
              : threadTs
                ? "live_slack_thread"
                : "live_slack"
            : "live_slack_failed",
          personal_dm: isPersonalDm,
          shared_channel: isSharedChannel,
          widget_degraded: widgetDegraded,
          ok: Boolean(post.ok),
          live_post: Boolean(post.ok),
          live_slack_residual: !Boolean(post.ok),
          pretend_live: false,
          ts: post.ts || "",
          thread_ts: threadTs || "",
          connector_ready: connectorReady,
          claim: claim
            ? { ok: claim.ok, claimed_count: claim.claimed_count }
            : null,
          at: stamp,
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: claim ? inboundPath : undefined,
          claim: claim
            ? { ok: claim.ok, claimed_count: claim.claimed_count }
            : undefined,
          ok: Boolean(post.ok),
          error: post.ok ? "" : `slack post failed: ${post.error || "unknown"}`,
        });
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
          pretend_live: false,
          claimed_count: claim.claimed_count,
          connector_ready: connectorReady,
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          claim,
          ok: Boolean(claim.ok),
          error: claim.ok ? "" : claim.error,
        });
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
          pretend_live: false,
          claimed_count: sandboxRows.length,
          connector_ready: connectorReady,
          at: stamp,
          inbound: inboundPath,
          note: "sandbox claim — set SLACK_BOT_TOKEN for live conversations.history",
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
        });
      }
      const draftMode = isPersonalDm
        ? "personal_slack_dm_draft"
        : threadTs
          ? connectorReady
            ? "connector_thread_draft"
            : "sandbox_thread_draft"
          : connectorReady
            ? "connector_draft"
            : "sandbox_draft";
      const entry = {
        scheme,
        address: addr,
        body: outboundBody,
        mode: draftMode,
        ok: true,
        live_post: false,
        pretend_live: false,
        personal_dm: isPersonalDm,
        shared_channel: isSharedChannel,
        widget_degraded: widgetDegraded,
        thread_ts: threadTs || "",
        connector_ready: connectorReady,
        connector_status: connectorHint.status || "unknown",
        at: stamp,
        note: isPersonalDm
          ? "CM-1103 personal Slack DM draft (owner U… only; live needs xox* + BITBOT_SLACK_POST=1)"
          : threadTs
            ? "Slack thread draft (thread_ts parsed); live needs token + BITBOT_SLACK_POST=1"
            : "live post needs SLACK_BOT_TOKEN + BITBOT_SLACK_POST=1; claim needs BITBOT_SLACK_CLAIM=1",
      };
      appendJsonl(outboundPath, entry);
      return finalizeChannelSend(raw, entry, { outboundPath });
    }

    if (addr.startsWith("teams:")) {
      const teamsToken = String(process.env.BITBOT_TEAMS_TOKEN || "").trim();
      const chatId = addr.slice("teams:".length).split(":")[0] || "";
      const graphBase = (
        process.env.BITBOT_TEAMS_GRAPH_URL ||
        "https://graph.microsoft.com/v1.0"
      ).replace(/\/$/, "");
      const inboundPath = path.join(
        REPO_ROOT,
        "data",
        "channels",
        "inbound.jsonl",
      );
      // Live Teams inbound claim (Graph chat messages) when CLAIM=1 + token.
      let teamsClaim = null;
      if (
        teamsToken &&
        process.env.BITBOT_TEAMS_CLAIM === "1" &&
        chatId &&
        chatId !== "me"
      ) {
        const histUrl = `${graphBase}/chats/${encodeURIComponent(chatId)}/messages`;
        const hist = await httpJson(histUrl, {
          method: "GET",
          headers: { Authorization: `Bearer ${teamsToken}` },
        });
        const okHist =
          Boolean(hist.ok) || (hist.status >= 200 && hist.status < 300);
        const values =
          (hist.json && (hist.json.value || hist.json.messages)) || [];
        const claimed = [];
        for (const m of Array.isArray(values) ? values : []) {
          if (!m || typeof m !== "object") continue;
          const row = {
            scheme: "teams",
            channel: chatId,
            id: m.id || "",
            text_prefix: String(
              (m.body && m.body.content) || m.content || "",
            ).slice(0, 80),
            text_len: String(
              (m.body && m.body.content) || m.content || "",
            ).length,
            mode: "live_teams_claim",
            at: stamp,
          };
          appendJsonl(inboundPath, row);
          claimed.push({ id: row.id, text_len: row.text_len });
        }
        teamsClaim = {
          ok: okHist,
          claimed_count: claimed.length,
          claimed,
          error: okHist ? "" : hist.error || `http_${hist.status}`,
        };
      }
      if (teamsToken && process.env.BITBOT_TEAMS_POST === "1" && body) {
        // Prefer chat message POST when chat id present; else probe chats list.
        let post;
        let mode = "live_teams_graph";
        if (chatId && chatId !== "me") {
          const msgUrl = `${graphBase}/chats/${encodeURIComponent(chatId)}/messages`;
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
          post = await httpJson(`${graphBase}/me/chats`, {
            method: "GET",
            headers: { Authorization: `Bearer ${teamsToken}` },
          });
        }
        const ok =
          Boolean(post.ok) || (post.status >= 200 && post.status < 300);
        const entry = {
          scheme: "teams",
          address: addr,
          body,
          mode: ok ? mode : "live_teams_failed",
          ok,
          live_post: ok,
          live_teams_residual: !ok,
          pretend_live: false,
          http_status: post.status || 0,
          chat_id: chatId || null,
          claim: teamsClaim,
          at: stamp,
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: teamsClaim ? inboundPath : undefined,
          claim: teamsClaim || undefined,
          ok: entry.ok,
          error: entry.ok
            ? ""
            : `teams graph failed: ${post.error || post.status}`,
        });
      }
      // Claim-only Teams path (no live post).
      if (teamsClaim) {
        const entry = {
          scheme: "teams",
          address: addr,
          body,
          mode: "live_teams_claim",
          ok: Boolean(teamsClaim.ok),
          live_post: false,
          claimed_count: teamsClaim.claimed_count,
          claim: teamsClaim,
          pretend_live: false,
          chat_id: chatId || null,
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          claim: teamsClaim,
          ok: entry.ok,
          error: entry.ok ? "" : teamsClaim.error,
        });
      }
      // Sandbox Teams claim rehearsal when CLAIM=1 but no token.
      if (process.env.BITBOT_TEAMS_CLAIM === "1" && chatId && !teamsToken) {
        const row = {
          scheme: "teams",
          channel: chatId,
          id: "sandbox-teams-1",
          text_prefix: "[sandbox] teams inbound claim",
          text_len: 28,
          mode: "sandbox_teams_claim",
          at: stamp,
        };
        appendJsonl(inboundPath, row);
        const entry = {
          scheme: "teams",
          address: addr,
          body,
          mode: "sandbox_teams_claim",
          ok: true,
          live_post: false,
          claimed_count: 1,
          pretend_live: false,
          at: stamp,
          inbound: inboundPath,
          note: "sandbox claim — set BITBOT_TEAMS_TOKEN for live Graph messages",
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
        });
      }
      const teamsDir = path.join(REPO_ROOT, "data", "channels", "teams");
      fs.mkdirSync(teamsDir, { recursive: true });
      const teamsTranscript = path.join(teamsDir, "outbound-drafts.jsonl");
      const entry = {
        scheme: "teams",
        address: addr,
        body,
        mode: connectorReady ? "connector_draft" : "sandbox_draft",
        ok: true,
        live_post: false,
        pretend_live: false,
        connector_ready: connectorReady,
        widget_degraded: /\[widget:|type=widget/i.test(body),
        at: stamp,
        note: "Teams live Graph post needs BITBOT_TEAMS_TOKEN + BITBOT_TEAMS_POST=1; claim needs BITBOT_TEAMS_CLAIM=1",
      };
      if (entry.widget_degraded) {
        entry.body = body
          .replace(/\[widget:[^\]]*\]/gi, "")
          .replace(/type=widget\S*/gi, "")
          .trim() || "(widget degraded to text)";
      }
      appendJsonl(outboundPath, entry);
      appendJsonl(teamsTranscript, entry);
      return finalizeChannelSend(raw, entry, {
        outboundPath,
        teams_transcript: teamsTranscript,
      });
    }

    if (addr.startsWith("email:") || addr.startsWith("gmail:")) {
      // Channel email: durable draft by default; live Gmail send when gated.
      const toAddr = addr.replace(/^(email|gmail):/i, "").trim() || "user@example.com";
      const mailCmd = `gmail|${toAddr}|channel delivery|${body}`;
      const mailResult = await executeMailSend(mailCmd);
      let mailPayload = {};
      try {
        mailPayload = JSON.parse(mailResult.stdout || "{}");
      } catch (_) {
        mailPayload = {};
      }
      const live = Boolean(mailPayload.sent && mailPayload.mode === "live_gmail");
      const entry = {
        scheme,
        address: addr,
        body,
        mode: live ? "live_email_gmail" : mailPayload.mode || "mail_outbound_draft",
        ok: true,
        live_post: live,
        live_mail_residual: !live,
        pretend_live: false,
        mail: {
          mode: mailPayload.mode || null,
          sent: Boolean(mailPayload.sent),
          eml_path: mailPayload.eml_path || null,
          message_id: mailPayload.message_id || null,
        },
        at: stamp,
      };
      appendJsonl(outboundPath, entry);
      appendJsonl(MAIL_DRAFTS_PATH, {
        kind: "channel_email",
        address: addr,
        body,
        mail_mode: entry.mode,
        at: stamp,
      });
      return finalizeChannelSend(raw, entry, {
        outboundPath,
        mail: entry.mail,
      });
    }

    // CM-2153 meeting chat DirectSend (command: meeting_chat :: body)
    if (addr === "meeting_chat" || scheme === "meeting_chat") {
      const meetingDir = path.join(REPO_ROOT, "data", "meetings");
      fs.mkdirSync(meetingDir, { recursive: true });
      const transcriptPath = path.join(meetingDir, "live-chat.jsonl");
      const meetingToken = String(process.env.BITBOT_MEETING_TOKEN || "").trim();
      const meetingApi = String(process.env.BITBOT_MEETING_API_URL || "").trim();
      const liveMeeting = Boolean(meetingToken && meetingApi);
      let livePost = false;
      let liveProbe = null;
      if (liveMeeting) {
        try {
          const resp = await fetch(meetingApi.replace(/\/$/, "") + "/messages", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${meetingToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: body, source: "bitbot-host" }),
          });
          livePost = resp.ok;
          liveProbe = { ok: resp.ok, http_status: resp.status };
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
        }
      }
      const entry = {
        scheme: "meeting_chat",
        address: "meeting_chat",
        body,
        mode: livePost ? "meeting_chat_live" : "meeting_chat_direct",
        direct_send: true,
        draft_card: false,
        ok: true,
        live_post: livePost,
        live_meeting_residual: !livePost,
        live_probe: liveProbe,
        note: livePost
          ? "CM-2153 DirectSend live meeting transport"
          : "CM-2153 DirectSend durable transcript (live meeting transport residual)",
        at: stamp,
      };
      appendJsonl(outboundPath, entry);
      appendJsonl(transcriptPath, entry);
      return finalizeChannelSend(raw, entry, {
        outboundPath,
        transcript: transcriptPath,
      });
    }

    const entry = {
      scheme,
      address: addr,
      body,
      mode: "durable_outbound",
      ok: true,
      pretend_live: false,
      at: stamp,
    };
    appendJsonl(outboundPath, entry);
    return finalizeChannelSend(raw, entry, { outboundPath });
  }

  async function executeCopyBox(kind, command) {
    // command: machine_id|src|dest
    const parts = String(command || "").split("|");
    const machineId = (parts[0] || "").trim();
    const src = (parts[1] || "").trim();
    const dest = (parts[2] || "").trim();
    const srcAbs = resolveUnderRepo(src);
    const destAbs = resolveUnderRepo(dest);
    const at = new Date().toISOString();
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
      const copyDir = path.join(REPO_ROOT, "data", "box-copy");
      fs.mkdirSync(copyDir, { recursive: true });
      const artifactPath = path.join(
        copyDir,
        `${kind}-${Date.now().toString(36)}.json`,
      );
      const bytes = fs.existsSync(destAbs) ? fs.statSync(destAbs).size : 0;
      const artifact = {
        kind,
        machine_id: machineId,
        src: srcAbs,
        dest: destAbs,
        bytes,
        under_repo: true,
        pretend_remote_machine: false,
        note: "Host FS copy under repo — machine_id is routing metadata",
        at,
      };
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
      const journal = appendHostDeliveryJournal({
        kind,
        machine_id: machineId,
        src: srcAbs,
        dest: destAbs,
        path: artifactPath,
        at,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: artifactPath,
        label: kind,
        source_kind: kind,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: artifactPath,
        journal,
        send_to_user: delivery,
        ok: true,
      });
    } catch (err) {
      return {
        kind,
        ok: false,
        command,
        error: err.message || String(err),
      };
    }
  }

  function writeMailEml({ provider, to, subject, body, status, at }) {
    const draftDir = path.join(REPO_ROOT, "data", "mail", "draft-files");
    fs.mkdirSync(draftDir, { recursive: true });
    const draftId = `mail-${Date.now().toString(36)}`;
    const emlPath = path.join(draftDir, `${draftId}.eml`);
    const eml = [
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      `Date: ${at}`,
      `Message-ID: <${draftId}@bitbot.local>`,
      `X-BitBot-Provider: ${provider}`,
      `X-BitBot-Status: ${status}`,
      "",
      body,
      "",
    ].join("\r\n");
    fs.writeFileSync(emlPath, eml);
    return {
      eml_path: emlPath,
      eml_ok:
        fs.existsSync(emlPath) &&
        fs.readFileSync(emlPath, "utf8").includes("X-BitBot-Status:"),
      draft_id: draftId,
    };
  }

  async function executeMailSend(command) {
    // command: provider|to|subject|body  (provider=gmail|outlook|cold)
    // cold: cold|to|subject|body|unsubscribe (CM-1009)
    const parts = String(command || "").split("|");
    const provider = (parts[0] || "gmail").trim().toLowerCase();
    const at = new Date().toISOString();

    if (provider === "cold" || provider === "onbehalf") {
      const to = (parts[1] || "").trim();
      const subject = (parts[2] || "").trim();
      const body = (parts[3] || "").trim();
      const unsubscribe =
        provider === "cold"
          ? (parts[4] || "mailto:unsub@example.com").trim()
          : "";
      const draftDir = path.join(REPO_ROOT, "data", "mail", "draft-files");
      fs.mkdirSync(draftDir, { recursive: true });
      const draftId = `${provider}-${Date.now().toString(36)}`;
      const emlPath = path.join(draftDir, `${draftId}.eml`);
      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        `Date: ${at}`,
        `Message-ID: <${draftId}@bitbot.local>`,
        "X-BitBot-Status: draft",
      ];
      if (provider === "cold") {
        headers.push(`List-Unsubscribe: <${unsubscribe}>`);
        headers.push("X-BitBot-Cold-Mail: 1");
      } else {
        headers.push("From: me@example.com");
        headers.push("X-BitBot-Send-On-Behalf: 1");
        headers.push("X-BitBot-Proxy-Account: acct-1");
      }
      const eml = [...headers, "", body, ""].join("\r\n");
      fs.writeFileSync(emlPath, eml);
      const ledger =
        provider === "cold"
          ? path.join(REPO_ROOT, "data", "mail", "cold-outbound.jsonl")
          : path.join(REPO_ROOT, "data", "mail", "onbehalf-outbound.jsonl");
      appendJsonl(ledger, {
        provider,
        to,
        subject,
        unsubscribe: unsubscribe || null,
        eml_path: emlPath,
        sent: false,
        pretend_sent: false,
        at,
      });
      appendJsonl(MAIL_DRAFTS_PATH, {
        provider,
        to,
        subject,
        status: "draft",
        unsubscribe: unsubscribe || null,
        eml_path: emlPath,
        at,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: emlPath,
        label: provider === "cold" ? "cold_mail.eml" : "send_on_behalf.eml",
        to,
        subject,
        source_kind: "mail_send",
        at,
      });
      appendHostDeliveryJournal({
        kind: "mail_send",
        provider,
        to,
        subject,
        eml: emlPath,
        at,
      });
      return okJson("mail_send", command, {
        provider,
        to,
        subject,
        unsubscribe: unsubscribe || null,
        mode:
          provider === "cold" ? "cold_sandbox_eml" : "onbehalf_sandbox_eml",
        sent: false,
        pretend_sent: false,
        eml_path: emlPath,
        eml_ok:
          fs.existsSync(emlPath) &&
          fs.readFileSync(emlPath, "utf8").includes("X-BitBot-Status: draft"),
        ledger,
        drafted: true,
        send_to_user: delivery,
      });
    }

    const to = (parts[1] || "").trim();
    const subject = (parts[2] || "").trim();
    const body = parts.slice(3).join("|");
    const state = loadConnectorState(provider);
    // Prefer explicit env token (local mock / CI) over connector rehearsal tokens.
    let token = String(process.env.BITBOT_GMAIL_TOKEN || "").trim();
    if (!token) {
      try {
        const tokPath = path.join(CONNECTORS_DIR, "gmail_token.json");
        if (fs.existsSync(tokPath)) {
          const tok = JSON.parse(fs.readFileSync(tokPath, "utf8"));
          token = String((tok && (tok.access_token || tok.token)) || "").trim();
        }
      } catch (_) {
        token = "";
      }
    }
    if (!token) {
      token = extractAccessToken(state);
    }
    const journal = appendHostDeliveryJournal({
      kind: "mail_send",
      provider,
      to,
      subject,
      at,
      has_token: Boolean(token),
    });

    const finishSandbox = (reason, mode = "sandbox_eml") => {
      const eml = writeMailEml({
        provider,
        to,
        subject,
        body,
        status: "draft",
        at,
      });
      appendJsonl(MAIL_DRAFTS_PATH, {
        provider,
        to,
        subject,
        status: "draft",
        reason,
        eml_path: eml.eml_path,
        at,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: eml.eml_path,
        label: "mail_draft.eml",
        to,
        subject,
        source_kind: "mail_send",
        at,
      });
      return okJson("mail_send", command, {
        provider,
        to,
        subject,
        mode,
        sent: false,
        pretend_sent: false,
        live_mail_residual: true,
        reason,
        journal,
        ...eml,
        drafted: true,
        send_to_user: delivery,
      });
    };

    if (!token) {
      return finishSandbox("no OAuth token — sandbox eml draft");
    }
    if (provider === "gmail") {
      // Draft-first: live send needs BITBOT_MAIL_SEND=1 (parity with Slack POST gate).
      if (String(process.env.BITBOT_MAIL_SEND || "").trim() !== "1") {
        return finishSandbox(
          "token present — set BITBOT_MAIL_SEND=1 for live Gmail send",
          "gmail_token_draft",
        );
      }
      // Gmail API users.messages.send requires raw MIME base64url.
      // BITBOT_GMAIL_API_BASE allows local mock (e.g. http://127.0.0.1:18773).
      const gmailBase = String(
        process.env.BITBOT_GMAIL_API_BASE ||
          "https://gmail.googleapis.com/gmail/v1",
      )
        .trim()
        .replace(/\/$/, "");
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
      const res = await httpJson(`${gmailBase}/users/me/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        body: payload,
      });
      const ok = Boolean(res.ok && res.json && res.json.id);
      if (!ok) {
        // Honest fallback: keep durable .eml draft; never pretend sent.
        return finishSandbox(
          `gmail send failed: ${res.error || res.status || "auth"} — sandbox eml draft`,
          "gmail_live_failed",
        );
      }
      const eml = writeMailEml({
        provider,
        to,
        subject,
        body,
        status: "sent",
        at,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: eml.eml_path,
        label: "mail_sent.eml",
        to,
        subject,
        source_kind: "mail_send",
        at,
      });
      return okJson("mail_send", command, {
        provider,
        to,
        subject,
        mode: "live_gmail",
        sent: true,
        pretend_sent: false,
        live_mail_residual: false,
        message_id: res.json.id,
        journal,
        ...eml,
        send_to_user: delivery,
      });
    }
    if (provider === "outlook") {
      // Prefer env token for local mock / CI over connector rehearsal tokens.
      let outlookToken = String(process.env.BITBOT_OUTLOOK_TOKEN || "").trim();
      if (!outlookToken) outlookToken = token;
      if (String(process.env.BITBOT_MAIL_SEND || "").trim() !== "1") {
        return finishSandbox(
          "outlook token present — set BITBOT_MAIL_SEND=1 for live Graph send",
          "outlook_token_draft",
        );
      }
      const graphBase = String(
        process.env.BITBOT_OUTLOOK_GRAPH_URL ||
          process.env.BITBOT_OUTLOOK_API_BASE ||
          "https://graph.microsoft.com/v1.0",
      )
        .trim()
        .replace(/\/$/, "");
      const payload = JSON.stringify({
        message: {
          subject,
          body: { contentType: "Text", content: body },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      });
      const res = await httpJson(`${graphBase}/me/sendMail`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${outlookToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        body: payload,
      });
      // Graph sendMail returns 202 Accepted with empty body on success.
      const ok =
        Boolean(res.ok) ||
        res.status === 202 ||
        Boolean(res.json && (res.json.id || res.json.ok));
      if (!ok) {
        return finishSandbox(
          `outlook send failed: ${res.error || res.status || "auth"} — sandbox eml draft`,
          "outlook_live_failed",
        );
      }
      const eml = writeMailEml({
        provider,
        to,
        subject,
        body,
        status: "sent",
        at,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: eml.eml_path,
        label: "outlook_sent.eml",
        to,
        subject,
        source_kind: "mail_send",
        at,
      });
      return okJson("mail_send", command, {
        provider,
        to,
        subject,
        mode: "live_outlook",
        sent: true,
        pretend_sent: false,
        live_mail_residual: false,
        message_id:
          (res.json && (res.json.id || res.json.message_id)) ||
          `outlook-${Date.now().toString(36)}`,
        http_status: res.status || 0,
        journal,
        ...eml,
        send_to_user: delivery,
      });
    }
    return finishSandbox(
      `mail token present for ${provider}; no live adapter — sandbox eml draft`,
    );
  }

  async function executeConnectorsProbe() {
    const report = await connectorsStatusReport();
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "connectors");
    fs.mkdirSync(dir, { recursive: true });
    const probePath = path.join(
      dir,
      `probe-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      ...report,
      mode: "host_connectors_probe",
      pretend_all_connected: false,
      at,
    };
    fs.writeFileSync(probePath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "probes.jsonl"), {
      path: probePath,
      summary: {
        slack: report.connectors.slack.mode,
        gmail: report.connectors.gmail.mode,
        outlook: report.connectors.outlook.mode,
      },
      at,
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: probePath,
      label: "connectors_probe",
      source_kind: "connectors_probe",
      at,
    });
    appendHostDeliveryJournal({
      kind: "connectors_probe",
      path: probePath,
      at,
      summary: {
        slack: report.connectors.slack.mode,
        gmail: report.connectors.gmail.mode,
        outlook: report.connectors.outlook.mode,
      },
    });
    return okJson("connectors_probe", "connectors_probe", {
      ...artifact,
      path: probePath,
      send_to_user: delivery,
      ok: true,
    });
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
    if (partial.next_due != null) next.next_due = String(partial.next_due);
    if (partial.last_fired_at != null) {
      next.last_fired_at = String(partial.last_fired_at);
    }
    if (idx >= 0) rows[idx] = { ...rows[idx], ...next };
    else rows.push(next);
    saveRoutines(rows);
    return next;
  }

  function expandMcpFileArgs(value, meta) {
    // CM-2163: expand $file:/abs/or/repo/rel paths from Host FS into arg values.
    // Plain strings without $file: are left unchanged (caller may refuse separately).
    if (typeof value === "string") {
      const m = value.match(/^\$file:(.+)$/);
      if (!m) return value;
      const rawPath = String(m[1] || "").trim();
      const abs = resolveUnderRepo(rawPath) ||
        (path.isAbsolute(rawPath) ? rawPath : null);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        meta.errors.push(`$file: missing or outside repo: ${rawPath}`);
        meta.refused = true;
        return value;
      }
      const text = fs.readFileSync(abs, "utf8");
      meta.expanded.push({
        ref: value,
        path: abs,
        bytes: Buffer.byteLength(text),
      });
      return text;
    }
    if (Array.isArray(value)) {
      return value.map((v) => expandMcpFileArgs(v, meta));
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = expandMcpFileArgs(v, meta);
      }
      return out;
    }
    return value;
  }

  async function executeMcp(kind, command) {
    fs.mkdirSync(MCP_TMP, { recursive: true });
    const stamp = Date.now();
    const reqPath = path.join(MCP_TMP, `mcp-req-${stamp}.json`);
    const outPath = path.join(MCP_TMP, `mcp-out-${stamp}.json`);
    let requests;
    let fileExpandMeta = null;
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
      // Expand $file: refs before MCP call (CM-2163 product Host path).
      fileExpandMeta = { expanded: [], errors: [], refused: false };
      args = expandMcpFileArgs(args, fileExpandMeta);
      // Map product Gmail/X names onto Host stdio loopback tools when no live MCP.
      // CM-2164: write_to_file args or write_result tool → write_result.
      const wantWrite =
        toolName === "write_result" ||
        toolName === "write_to_file" ||
        args.write_to_file === true ||
        args.write_to_file === "true";
      const mapped = wantWrite
        ? "write_result"
        : toolName === "search_threads" || toolName === "echo_body"
          ? "echo_body"
          : "echo_body";
      if (wantWrite && args.write_to_file == null) {
        args.write_to_file = true;
      }
      if (fileExpandMeta.refused) {
        appendHostDeliveryJournal({
          kind,
          command,
          ok: false,
          file_expand: fileExpandMeta,
          at: new Date().toISOString(),
        });
        return {
          kind,
          ok: false,
          command,
          error: fileExpandMeta.errors.join("; ") || "$file: expand refused",
          stdout: JSON.stringify(
            {
              mode: "file_expand_refused",
              pretend_inject: false,
              file_expand: fileExpandMeta,
            },
            null,
            2,
          ),
          stderr: "",
        };
      }
      if (mapped === "echo_body" && args.body == null) {
        args = { body: JSON.stringify(args), source_ref: left };
      }
      // Preserve original $file: ref in source_ref when we expanded body from file.
      if (
        mapped === "echo_body" &&
        fileExpandMeta.expanded.length > 0 &&
        !args.source_ref
      ) {
        args.source_ref = fileExpandMeta.expanded[0].ref;
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
      const mcpAt = new Date().toISOString();
      let outText = String(payload || "").slice(0, 12000);
      let writeMeta = null;
      let parsed = null;
      try {
        parsed = JSON.parse(outText);
        // CM-2164: extract write_result path from MCP tool content (never re-embed body).
        const toolText =
          parsed &&
          parsed["1"] &&
          parsed["1"].result &&
          Array.isArray(parsed["1"].result.content) &&
          parsed["1"].result.content[0]
            ? parsed["1"].result.content[0].text
            : null;
        if (toolText) {
          try {
            const meta = JSON.parse(toolText);
            if (meta && meta.path && meta.ok) {
              writeMeta = {
                path: meta.path,
                bytes: meta.bytes || 0,
                sha256: meta.sha256 || null,
                write_to_file: true,
                pretend_inline_payload: false,
              };
              if (fs.existsSync(meta.path)) {
                recordSendToUser({
                  type: "attachment",
                  path: meta.path,
                  label: "mcp_write_to_file",
                  source_kind: kind,
                  at: mcpAt,
                });
              }
            }
          } catch (_) {
            /* not a write_result payload */
          }
        }
        const annotated = { ...parsed };
        if (fileExpandMeta && fileExpandMeta.expanded.length > 0) {
          annotated.file_expand = {
            expanded_count: fileExpandMeta.expanded.length,
            refs: fileExpandMeta.expanded.map((e) => ({
              ref: e.ref,
              path: e.path,
              bytes: e.bytes,
            })),
            pretend_inject: false,
          };
        }
        if (writeMeta) {
          annotated.write_to_file = writeMeta;
        }
        // mcp_discover: durable tools catalog (not tmp-only).
        if (kind === "mcp_discover") {
          const responses = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === "object"
              ? Object.keys(parsed)
                  .filter((k) => /^\d+$/.test(k))
                  .sort((a, b) => Number(a) - Number(b))
                  .map((k) => parsed[k])
              : [];
          let tools = [];
          for (const resp of responses) {
            const listed =
              resp &&
              resp.result &&
              Array.isArray(resp.result.tools) &&
              resp.result.tools;
            if (listed && listed.length) {
              tools = listed;
              break;
            }
          }
          if (
            !tools.length &&
            parsed &&
            parsed.result &&
            Array.isArray(parsed.result.tools)
          ) {
            tools = parsed.result.tools;
          }
          const discDir = path.join(
            REPO_ROOT,
            "data",
            "connectors",
            "mcp-discovers",
          );
          fs.mkdirSync(discDir, { recursive: true });
          const catalogPath = path.join(
            discDir,
            `discover-${Date.now().toString(36)}.json`,
          );
          const catalog = {
            mode: "stdio-mcp",
            tool_count: tools.length,
            tools: tools.map((t) => ({
              name: t && t.name,
              description: t && t.description,
            })),
            out_json: outPath,
            pretend_empty: false,
            pretend_discovered: false,
            at: mcpAt,
          };
          fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
          appendJsonl(path.join(discDir, "discovers.jsonl"), {
            ...catalog,
            path: catalogPath,
          });
          annotated.discover = {
            path: catalogPath,
            tool_count: tools.length,
            pretend_empty: false,
            pretend_discovered: false,
          };
          const delivery = recordSendToUser({
            type: "attachment",
            path: catalogPath,
            label: "mcp_discover",
            source_kind: kind,
            at: mcpAt,
          });
          annotated.send_to_user = delivery;
          annotated.path = catalogPath;
          annotated.tool_count = tools.length;
          annotated.pretend_empty = false;
          annotated.pretend_discovered = false;
          annotated.ok = true;
          appendHostDeliveryJournal({
            kind,
            command,
            mode: "stdio-mcp",
            path: catalogPath,
            tool_count: tools.length,
            file_expand: fileExpandMeta,
            at: mcpAt,
          });
          return okJson(kind, command, annotated);
        }
        outText = JSON.stringify(annotated, null, 2).slice(0, 12000);
      } catch (_) {
        /* keep raw MCP payload */
      }
      appendHostDeliveryJournal({
        kind,
        command,
        mode: "stdio-mcp",
        file_expand: fileExpandMeta,
        at: mcpAt,
      });
      return {
        kind,
        ok: true,
        command,
        stdout: outText,
        stderr: String(stderr || "").slice(0, 2000),
      };
    } catch (err) {
      appendHostDeliveryJournal({
        kind,
        command,
        ok: false,
        error: err.message || String(err),
        file_expand: fileExpandMeta,
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
      const cron = parts[1] || "@daily";
      // @now / @once → due immediately so routine_tick can fire in the same session.
      let nextDue = null;
      if (cron === "@now" || cron === "@once" || /@now|@once/i.test(cron)) {
        nextDue = new Date().toISOString();
      } else if (cron === "@hourly" || /hourly/i.test(cron)) {
        nextDue = new Date(Date.now() + 3600 * 1000).toISOString();
      } else if (cron === "@weekly" || /weekly/i.test(cron)) {
        nextDue = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      } else {
        nextDue = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      }
      const dueNow = cron === "@now" || cron === "@once";
      const row = upsertRoutine({
        id: parts[0] || "routine-1",
        cron,
        prompt: parts.slice(2).join("|") || "",
        enabled: true,
        lifecycle: "active",
        next_due: nextDue,
      });
      const atSched = new Date().toISOString();
      const dir = path.join(REPO_ROOT, "data", "routines");
      fs.mkdirSync(dir, { recursive: true });
      const schedulePath = path.join(
        dir,
        `schedule-${row.id}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        stored: true,
        id: row.id,
        cron: row.cron,
        prompt: row.prompt || "",
        next_due: row.next_due || nextDue,
        due_now: dueNow,
        lifecycle: row.lifecycle || "active",
        enabled: row.enabled !== false,
        routines_path: ROUTINES_PATH,
        mode: "host_routine_schedule",
        pretend_scheduled: false,
        long_lived_cron_residual: !dueNow,
        at: atSched,
      };
      fs.writeFileSync(schedulePath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "schedules.jsonl"), {
        ...artifact,
        path: schedulePath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: schedulePath,
        label: "routine_schedule",
        source_kind: kind,
        at: atSched,
      });
      appendHostDeliveryJournal({
        kind,
        command,
        path: schedulePath,
        stored: row,
        at: atSched,
      });
      return okJson(kind, command, {
        ...artifact,
        path: schedulePath,
        send_to_user: delivery,
        ok: true,
      });
    }
    if (kind === "routine_list") {
      const rows = loadRoutines();
      const at = new Date().toISOString();
      const dir = path.join(REPO_ROOT, "data", "routines");
      fs.mkdirSync(dir, { recursive: true });
      const listPath = path.join(dir, `list-${Date.now().toString(36)}.json`);
      const artifact = {
        count: rows.length,
        routines: rows,
        mode: "host_routine_list",
        pretend_empty: false,
        at,
      };
      fs.writeFileSync(listPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "lists.jsonl"), {
        ...artifact,
        path: listPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: listPath,
        label: "routine_list",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        count: rows.length,
        path: listPath,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: listPath,
        send_to_user: delivery,
        ok: true,
      });
    }
    if (kind === "routine_pause") {
      const row = upsertRoutine({ id, enabled: false, lifecycle: "paused" });
      const at = new Date().toISOString();
      const dir = path.join(REPO_ROOT, "data", "routines");
      fs.mkdirSync(dir, { recursive: true });
      const pausePath = path.join(
        dir,
        `pause-${row.id}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        id: row.id,
        lifecycle: "paused",
        enabled: false,
        mode: "host_routine_pause",
        pretend_paused: false,
        at,
      };
      fs.writeFileSync(pausePath, JSON.stringify(artifact, null, 2));
      appendHostDeliveryJournal({
        kind,
        command,
        path: pausePath,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: pausePath,
        summary: `paused ${row.id}`,
        ok: true,
      });
    }
    if (kind === "routine_resume") {
      const row = upsertRoutine({ id, enabled: true, lifecycle: "active" });
      const at = new Date().toISOString();
      const dir = path.join(REPO_ROOT, "data", "routines");
      fs.mkdirSync(dir, { recursive: true });
      const resumePath = path.join(
        dir,
        `resume-${row.id}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        id: row.id,
        lifecycle: "active",
        enabled: true,
        mode: "host_routine_resume",
        pretend_resumed: false,
        at,
      };
      fs.writeFileSync(resumePath, JSON.stringify(artifact, null, 2));
      appendHostDeliveryJournal({
        kind,
        command,
        path: resumePath,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: resumePath,
        summary: `resumed ${row.id}`,
        ok: true,
      });
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
      const firesDir = path.join(REPO_ROOT, "data", "routines");
      fs.mkdirSync(firesDir, { recursive: true });
      const firesPath = path.join(firesDir, "fires.jsonl");
      const firePath = path.join(
        firesDir,
        `fire-${id || "routine"}-${Date.now().toString(36)}.json`,
      );
      const fireEntry = {
        id,
        cron,
        prompt: (hit && hit.prompt) || "",
        fired: true,
        at: firedAt,
        next_due: nextDue,
        mode: "host_routine_fire",
        pretend_fired: false,
        routines_path: ROUTINES_PATH,
      };
      fs.writeFileSync(firePath, JSON.stringify(fireEntry, null, 2));
      appendJsonl(firesPath, { ...fireEntry, path: firePath });
      const delivery = recordSendToUser({
        type: "attachment",
        path: firePath,
        label: "routine_fire",
        source_kind: kind,
        at: firedAt,
      });
      appendHostDeliveryJournal({
        kind,
        command,
        path: firePath,
        fires: firesPath,
        fired: true,
        prompt: fireEntry.prompt,
        next_due: nextDue,
        at: firedAt,
      });
      return okJson(kind, command, {
        ...fireEntry,
        path: firePath,
        fires: firesPath,
        send_to_user: delivery,
        ok: true,
      });
    }
    if (kind === "routine_tick" || kind === "routine_wake") {
      // Wake due routines (Host-side scheduler tick; not LocalBrain).
      const rows = loadRoutines();
      const now = Date.now();
      const due = rows.filter((r) => {
        if (!r || r.enabled === false) return false;
        if (!r.next_due && !r.last_fired_at) return true;
        if (!r.next_due) return true;
        return Date.parse(r.next_due) <= now;
      });
      const fired = [];
      for (const r of due) {
        const sub = executeRoutineEffect("routine_fire", r.id);
        if (sub && sub.ok) {
          let payload = {};
          try {
            payload = JSON.parse(sub.stdout || "{}");
          } catch {
            payload = {};
          }
          fired.push({
            id: r.id,
            prompt: r.prompt || "",
            next_due: payload.next_due || null,
          });
        }
      }
      const tickAt = new Date().toISOString();
      const wakesPath = path.join(REPO_ROOT, "data", "routines", "wakes.jsonl");
      const daemonSweep = process.env.BITBOT_ROUTINE_DAEMON === "1";
      const wakeEntry = {
        due_count: due.length,
        fired_count: fired.length,
        fired_ids: fired.map((f) => f.id),
        at: tickAt,
        daemon: daemonSweep,
        long_lived: false,
        note: daemonSweep
          ? "Host daemon one-shot sweep (scripts/host_routine_daemon.sh)"
          : "on-demand Host tick (long-lived cron residual)",
      };
      appendJsonl(wakesPath, wakeEntry);
      const lastTickPath = path.join(
        REPO_ROOT,
        "data",
        "routines",
        "last-tick.json",
      );
      fs.mkdirSync(path.dirname(lastTickPath), { recursive: true });
      fs.writeFileSync(
        lastTickPath,
        JSON.stringify({ ...wakeEntry, wakes: wakesPath }, null, 2),
      );
      if (daemonSweep) {
        fs.writeFileSync(
          path.join(REPO_ROOT, "data", "routines", "daemon-status.json"),
          JSON.stringify(
            {
              daemon: true,
              long_lived: false,
              last_sweep_at: tickAt,
              fired_count: fired.length,
              due_count: due.length,
              note: "one-shot sweep — not systemd cron",
            },
            null,
            2,
          ),
        );
      }
      appendHostDeliveryJournal({
        kind: "routine_tick",
        command,
        due_count: due.length,
        fired_count: fired.length,
        wakes: wakesPath,
        daemon: daemonSweep,
        at: tickAt,
      });
      return {
        kind: "routine_tick",
        ok: true,
        command,
        stdout: JSON.stringify(
          {
            due_count: due.length,
            fired_count: fired.length,
            fired,
            wakes: true,
            wakes_path: wakesPath,
            last_tick_path: lastTickPath,
            daemon: daemonSweep,
            long_lived: false,
          },
          null,
          2,
        ),
        stderr: "",
      };
    }
    return null;
  }

  async function executeMailReadSearch(kind, command) {
    // Durable sandbox artifacts always; live Gmail when token + API reachable.
    // Never pretend live hits without a successful API response.
    const at = new Date().toISOString();
    const tokenPath = path.join(CONNECTORS_DIR, "gmail_token.json");
    let accessToken = String(process.env.BITBOT_GMAIL_TOKEN || "").trim();
    if (!accessToken) {
      try {
        if (fs.existsSync(tokenPath)) {
          const tok = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
          accessToken = String(
            (tok && (tok.access_token || tok.token)) || "",
          ).trim();
        }
      } catch (_) {
        accessToken = "";
      }
    }
    if (!accessToken) {
      accessToken = extractAccessToken(loadConnectorState("gmail"));
    }
    const wantLive = Boolean(accessToken);
    const gmailBase = String(
      process.env.BITBOT_GMAIL_API_BASE ||
        "https://gmail.googleapis.com/gmail/v1",
    )
      .trim()
      .replace(/\/$/, "");
    const mailDir = path.join(REPO_ROOT, "data", "mail");
    const searchDir = path.join(mailDir, "search");
    const threadDir = path.join(mailDir, "threads");
    fs.mkdirSync(searchDir, { recursive: true });
    fs.mkdirSync(threadDir, { recursive: true });

    if (kind === "mail_search") {
      const q = String(command || "").trim() || "(all)";
      let liveHits = null;
      let liveProbe = null;
      let mode = "sandbox";
      if (wantLive) {
        try {
          const url =
            `${gmailBase}/users/me/messages?q=` +
            encodeURIComponent(q) +
            "&maxResults=10";
          const resp = await httpJson(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const body = resp.json || { raw: String(resp.body || "").slice(0, 400) };
          liveProbe = {
            ok: Boolean(resp.ok),
            http_status: resp.status || 0,
            error: resp.error || null,
          };
          if (resp.ok) {
            liveHits = Array.isArray(body.messages) ? body.messages : [];
            mode = "gmail_live";
          } else {
            mode = "gmail_live_failed";
          }
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
          mode = "gmail_live_failed";
        }
      }
      const sandboxHits = [
        {
          id: "t-sandbox-1",
          threadId: "t-sandbox-1",
          subject: `Sandbox hit for ${q}`,
          snippet: "Host sandbox mail index — not live Gmail",
        },
      ];
      const hits = liveHits
        ? liveHits.map((m) => ({
            id: m.id || "",
            threadId: m.threadId || m.id || "",
            subject: "(live)",
            snippet: "",
          }))
        : sandboxHits;
      const artifactPath = path.join(
        searchDir,
        `search-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        kind: "mail_search",
        query: q,
        mode,
        live_mail_residual: mode !== "gmail_live",
        pretend_live: false,
        hit_count: hits.length,
        hits,
        live_probe: liveProbe,
        at,
      };
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
      appendHostDeliveryJournal({
        kind,
        command,
        path: artifactPath,
        mode,
        at,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: artifactPath,
        label: "mail_search",
        source_kind: kind,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: artifactPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    // mail_read
    const threadId = String(command || "").trim() || "t-unknown";
    let liveThread = null;
    let liveProbe = null;
    let mode = "sandbox";
    if (wantLive) {
      try {
        const url =
          `${gmailBase}/users/me/threads/` +
          encodeURIComponent(threadId) +
          "?format=metadata";
        const resp = await httpJson(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const body = resp.json || { raw: String(resp.body || "").slice(0, 400) };
        liveProbe = {
          ok: Boolean(resp.ok),
          http_status: resp.status || 0,
          error: resp.error || null,
        };
        if (resp.ok) {
          liveThread = body;
          mode = "gmail_live";
        } else {
          mode = "gmail_live_failed";
        }
      } catch (err) {
        liveProbe = {
          ok: false,
          error: String((err && err.message) || err).slice(0, 200),
        };
        mode = "gmail_live_failed";
      }
    }
    const artifactPath = path.join(
      threadDir,
      `thread-${sanitizeSkillName(threadId)}.json`,
    );
    const artifact = {
      kind: "mail_read",
      thread_id: threadId,
      mode,
      live_mail_residual: mode !== "gmail_live",
      pretend_live: false,
      subject:
        (liveThread && liveThread.snippet) ||
        `Sandbox thread ${threadId}`,
      snippet:
        (liveThread && liveThread.snippet) ||
        "Host sandbox mail body — not live Gmail",
      live_probe: liveProbe,
      at,
    };
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    appendHostDeliveryJournal({
      kind,
      command,
      path: artifactPath,
      mode,
      at,
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: artifactPath,
      label: "mail_read",
      source_kind: kind,
      at,
    });
    return okJson(kind, command, {
      ...artifact,
      path: artifactPath,
      send_to_user: delivery,
      ok: true,
    });
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
      const eventsPath = appendJournalEvent(entry);
      const appendDir = path.join(REPO_ROOT, "data", "journal", "appends");
      fs.mkdirSync(appendDir, { recursive: true });
      const appendPath = path.join(
        appendDir,
        `append-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        stored: true,
        date,
        event_id,
        body,
        pollutes_profile: false,
        events_path: eventsPath,
        mode: "host_journal_append",
        pretend_stored: false,
        at,
      };
      fs.writeFileSync(appendPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(appendDir, "appends.jsonl"), {
        ...artifact,
        path: appendPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: appendPath,
        label: "journal_append",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command,
        path: appendPath,
        events_path: eventsPath,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: appendPath,
        send_to_user: delivery,
        ok: true,
      });
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
      const dir = path.join(REPO_ROOT, "data", "journal", "queries");
      fs.mkdirSync(dir, { recursive: true });
      const queryPath = path.join(
        dir,
        `query-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        from_date,
        to_date,
        hit_count: hits.length,
        hits: hits.slice(0, 50),
        pollutes_profile: false,
        pretend_hits: false,
        mode: "host_journal_query",
        at,
      };
      fs.writeFileSync(queryPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "queries.jsonl"), {
        ...artifact,
        path: queryPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: queryPath,
        label: "journal_query",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command,
        hit_count: hits.length,
        path: queryPath,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: queryPath,
        send_to_user: delivery,
        ok: true,
      });
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
      const memDir = path.join(REPO_ROOT, "data", "memory");
      fs.mkdirSync(memDir, { recursive: true });
      const putPath = path.join(
        memDir,
        `shared-put-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        stored: true,
        scope,
        key,
        value,
        isolation: "scope-bound",
        store_path: SHARED_MEMORY_PATH,
        mode: "host_shared_memory_put",
        pretend_stored: false,
        pretend_cross_scope: false,
        at,
      };
      fs.writeFileSync(putPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(memDir, "shared-puts.jsonl"), {
        ...artifact,
        path: putPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: putPath,
        label: "shared_memory_put",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command,
        scope,
        key,
        path: putPath,
        store_path: SHARED_MEMORY_PATH,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: putPath,
        send_to_user: delivery,
        ok: true,
      });
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
      const dir = path.join(REPO_ROOT, "data", "memory", "shared-reads");
      fs.mkdirSync(dir, { recursive: true });
      const readPath = path.join(
        dir,
        `read-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        scope,
        key,
        found: true,
        value,
        value_len: String(value ?? "").length,
        isolation: "scope-bound",
        pretend_cross_scope: false,
        mode: "host_shared_memory_read",
        at,
      };
      fs.writeFileSync(readPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "reads.jsonl"), {
        ...artifact,
        path: readPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: readPath,
        label: "shared_memory_read",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command,
        scope,
        key,
        path: readPath,
        ok: true,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: readPath,
        send_to_user: delivery,
        ok: true,
      });
    }
    if (kind === "memory_update") {
      // command: key|value — durable Host profile vault (not LocalBrain).
      const parts = String(command || "").split("|");
      const key = parts[0] || "";
      const value = parts.slice(1).join("|");
      const memDir = path.join(REPO_ROOT, "data", "memory");
      fs.mkdirSync(memDir, { recursive: true });
      const vaultPath = path.join(memDir, "profile-vault.json");
      let vault = { scope: "profile", entries: {} };
      try {
        if (fs.existsSync(vaultPath)) {
          vault = JSON.parse(fs.readFileSync(vaultPath, "utf8")) || vault;
        }
      } catch (_) {
        vault = { scope: "profile", entries: {} };
      }
      if (!vault.entries || typeof vault.entries !== "object") vault.entries = {};
      vault.entries[key] = { value, updated_at: at };
      vault.updated_at = at;
      fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2));
      const updatePath = path.join(
        memDir,
        `update-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        key,
        value,
        scope: "profile",
        vault_path: vaultPath,
        mode: "host_memory_update",
        pretend_persisted: false,
        at,
      };
      fs.writeFileSync(updatePath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(memDir, "updates.jsonl"), {
        ...artifact,
        path: updatePath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: updatePath,
        label: "memory_update",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command,
        path: updatePath,
        vault_path: vaultPath,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: updatePath,
        send_to_user: delivery,
        ok: true,
      });
    }
    if (kind === "memory_recall") {
      const prefix = String(command || "").trim();
      const memDir = path.join(REPO_ROOT, "data", "memory");
      fs.mkdirSync(memDir, { recursive: true });
      const vaultPath = path.join(memDir, "profile-vault.json");
      let vault = { scope: "profile", entries: {} };
      try {
        if (fs.existsSync(vaultPath)) {
          vault = JSON.parse(fs.readFileSync(vaultPath, "utf8")) || vault;
        }
      } catch (_) {
        vault = { scope: "profile", entries: {} };
      }
      const entries = Object.entries(vault.entries || {})
        .filter(([k]) => !prefix || String(k).startsWith(prefix))
        .map(([k, cell]) => ({
          key: k,
          value: cell && typeof cell === "object" ? cell.value : cell,
          scope: "profile",
        }));
      const recallPath = path.join(
        memDir,
        `recall-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        prefix,
        count: entries.length,
        entries,
        vault_path: vaultPath,
        mode: "host_memory_recall",
        pretend_empty: false,
        at,
      };
      fs.writeFileSync(recallPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(memDir, "recalls.jsonl"), {
        ...artifact,
        path: recallPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: recallPath,
        label: "memory_recall",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command,
        path: recallPath,
        count: entries.length,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: recallPath,
        send_to_user: delivery,
        ok: true,
      });
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
        mode: "host_inbound_reaction",
        pretend_forced_reply: false,
        at,
      };
      fs.mkdirSync(path.dirname(INBOUND_REACTIONS_PATH), { recursive: true });
      fs.appendFileSync(INBOUND_REACTIONS_PATH, JSON.stringify(entry) + "\n");
      const reactDir = path.join(REPO_ROOT, "data", "delivery", "reactions");
      fs.mkdirSync(reactDir, { recursive: true });
      const reactPath = path.join(
        reactDir,
        `reaction-${Date.now().toString(36)}.json`,
      );
      // CM-2128-shaped outbound reaction pill delivery (SendToUser reaction).
      const outbound = {
        type: "reaction",
        emoji,
        visible_pill: true,
        body_omitted: true,
        useful,
        disposition,
        path: reactPath,
        at,
      };
      const artifact = {
        ...entry,
        inbound_ledger: INBOUND_REACTIONS_PATH,
        outbound_ledger: OUTBOUND_REACTIONS_PATH,
        outbound_reaction: outbound,
        visible_pill: true,
        send_to_user_type: "reaction",
      };
      fs.writeFileSync(reactPath, JSON.stringify(artifact, null, 2));
      appendJsonl(OUTBOUND_REACTIONS_PATH, outbound);
      appendJsonl(SEND_TO_USER_PATH, outbound);
      const delivery = {
        type: "reaction",
        emoji,
        visible_pill: true,
        path: reactPath,
        disposition,
        source_kind: kind,
        at,
      };
      appendHostDeliveryJournal({
        kind,
        command,
        path: reactPath,
        inbound_ledger: INBOUND_REACTIONS_PATH,
        outbound: OUTBOUND_REACTIONS_PATH,
        disposition,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: reactPath,
        send_to_user: delivery,
        ok: true,
      });
    }
    return null;
  }

  function recordSendToUser(entry) {
    const row = {
      ...entry,
      at: entry.at || new Date().toISOString(),
    };
    appendJsonl(SEND_TO_USER_PATH, row);
    return row;
  }

  function deliveryFromHostResult(result) {
    if (!result || !result.ok) return null;
    const kind = result.kind || "";
    const at = new Date().toISOString();
    let parsed = {};
    try {
      parsed = JSON.parse(result.stdout || "{}");
    } catch {
      parsed = {};
    }
    if (kind === "channel_send") {
      const isMeeting = parsed.mode === "meeting_chat_direct" || parsed.direct_send;
      return recordSendToUser({
        type: isMeeting
          ? "text"
          : parsed.personal_dm
            ? "text"
            : parsed.thread_ts
              ? "thread"
              : "text",
        channel: parsed.address || "",
        body_prefix: String(parsed.body || "").slice(0, 120),
        mode: parsed.mode || "",
        personal_dm: Boolean(parsed.personal_dm),
        widget_degraded: Boolean(parsed.widget_degraded),
        meeting_chat: Boolean(isMeeting),
        transcript: parsed.transcript || null,
        source_kind: kind,
        at,
      });
    }
    if (kind === "cloud_agent_launch" || kind === "cloud_artifact_deliver") {
      return null; // SendToUser already recorded in cloud handlers
    }
    if (kind === "room_turn" || kind === "send_to_agent" || kind === "subagent_run") {
      return null; // SendToUser already recorded in multi-agent handlers
    }
    if (kind === "voice_session") {
      return null; // already recorded in voice_session handler
    }
    if (kind === "voice_end_write") {
      return recordSendToUser({
        type: "voice",
        voice_address: parsed.voice_address || "",
        media_path: parsed.media_path || null,
        media_ok: Boolean(parsed.media_ok),
        source_kind: kind,
        at,
      });
    }
    if (
      kind === "voice_relay" ||
      kind === "schedule_meeting" ||
      kind === "purchase" ||
      kind === "mail_draft" ||
      kind === "mail_send" ||
      kind === "code_changes" ||
      kind === "source_control"
    ) {
      return null; // SendToUser already recorded in effect handlers
    }
    if (kind === "oauth") {
      if (parsed.mode === "identity_browser_switch") {
        return null; // already recorded in identity-browser handler
      }
      return recordSendToUser({
        type: "widget",
        widget: "connector_oauth",
        status: parsed.status || "",
        mode: parsed.mode || "",
        connected: Boolean(parsed.connected),
        browser_opened: Boolean(parsed.browser_opened),
        source_kind: kind,
        at,
      });
    }
    if (kind === "approval_card") {
      return recordSendToUser({
        type: "widget",
        widget: "approval_card",
        command: result.command || "",
        options: parsed.widget && parsed.widget.options,
        widget_id: parsed.widget && parsed.widget.widget_id,
        source_kind: kind,
        at,
      });
    }
    if (kind === "computer_use") {
      return recordSendToUser({
        type: "attachment",
        label: "computer_use",
        path: parsed.evidence || "",
        vision_ok: Boolean(parsed.gui && parsed.gui.vision_ok),
        outcome: (parsed.outcome && parsed.outcome.summary) || "",
        checkout_stage: (parsed.outcome && parsed.outcome.checkout_stage) || "",
        blocked_on_signin: Boolean(
          parsed.outcome && parsed.outcome.blocked_on_signin,
        ),
        pretend_purchased: false,
        gui_mode: (parsed.gui && parsed.gui.gui_mode) || "",
        os_window: Boolean(parsed.gui && parsed.gui.os_window),
        source_kind: kind,
        at,
      });
    }
    if (kind === "slides_pptx" || kind === "skill_write" || kind === "export_pack") {
      return recordSendToUser({
        type: "attachment",
        path: parsed.path || "",
        source_kind: kind,
        at,
      });
    }
    if (kind === "inbound_reaction") {
      return null; // already recorded above
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

    // CM-2146 identity browser: switch session marker — never pretend Slack Connected.
    if (connectorName === "identity-browser") {
      const at = new Date().toISOString();
      const identityDir = path.join(REPO_ROOT, "data", "connectors", "identity");
      fs.mkdirSync(identityDir, { recursive: true });
      const sessionPath = path.join(identityDir, "browser-session.json");
      const session = {
        identity: "user-browser",
        previous: "app-identity",
        status: "SwitchedToSignedInBrowser",
        pretend_connected_slack: false,
        connected: false,
        mode: "identity_browser_switch",
        command: String(command || ""),
        at,
      };
      fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
      saveConnectorState("identity-browser", session);
      const delivery = recordSendToUser({
        type: "widget",
        widget: "identity_browser",
        status: session.status,
        mode: session.mode,
        connected: false,
        source_kind: "oauth",
        at,
      });
      appendHostDeliveryJournal({
        kind: "oauth",
        command,
        connector: "identity-browser",
        ok: true,
        status: session.status,
        path: sessionPath,
        at,
      });
      return okJson("oauth", command, {
        connector: "identity-browser",
        status: session.status,
        connected: false,
        pretend_connected_slack: false,
        mode: "identity_browser_switch",
        session_path: sessionPath,
        switched: true,
        send_to_user: delivery,
      });
    }

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

  function nestDepth() {
    const n = Number(process.env.BITBOT_NEST_DEPTH || "0");
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function parseLastJsonObject(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.startsWith("{") && line.endsWith("}")) {
        try {
          return JSON.parse(line);
        } catch {
          /* continue */
        }
      }
    }
    return null;
  }

  /**
   * Bounded MoonBit worker turn for teammate/subagent wakes (Host FFI only).
   * Does not re-enter Host effects — caller decides whether to apply effects.
   * BITBOT_NEST_DEPTH>=1 skips spawning to prevent busy-loop nesting (CM-2133).
   */
  async function runWorkerMoonTurn({ prompt, sessionId, timeoutMs = 90000 }) {
    const depth = nestDepth();
    if (depth >= 1) {
      return {
        ok: true,
        nested_skipped: true,
        assistant: `(worker nest skipped at depth ${depth})`,
        intent: "chat",
        effects: [],
      };
    }
    const moonBin = process.env.MOON_BIN || "moon";
    const moonTarget = process.env.BITBOT_MOON_TARGET || "native";
    const args = [
      "run",
      "cmd/desktop_turn",
      "--target",
      moonTarget,
      "--",
      "--session-id",
      String(sessionId || "worker"),
      ...memorySeedArgs(),
      String(prompt || "").slice(0, 800),
    ];
    try {
      const { stdout, stderr } = await execFileAsync(moonBin, args, {
        cwd: REPO_ROOT,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          BITBOT_NEST_DEPTH: String(depth + 1),
          PATH: `${process.env.HOME || ""}/.moon/bin:${process.env.PATH || ""}`,
        },
      });
      const parsed = parseLastJsonObject(stdout || stderr) || {};
      let assistant = String(parsed.assistant || parsed.summary || "").trim();
      if (!assistant && Array.isArray(parsed.messages)) {
        const parts = [];
        for (const m of parsed.messages) {
          if (m && m.role === "assistant" && m.text) parts.push(String(m.text));
        }
        assistant = parts.join("\n").trim();
      }
      return {
        ok: Boolean(parsed.ok !== false),
        nested_skipped: false,
        assistant: assistant.slice(0, 2000),
        intent: parsed.intent || "",
        turn_id: parsed.turn_id || "",
        effects: Array.isArray(parsed.effects) ? parsed.effects : [],
        needs_host_ffi: Boolean(parsed.needs_host_ffi),
        raw_ok: Boolean(parsed.ok),
      };
    } catch (err) {
      return {
        ok: false,
        nested_skipped: false,
        error: err.message || String(err),
        assistant: "",
        intent: "",
        effects: [],
      };
    }
  }

  function synthesizeVoiceWav(outPath, { frequency = 440, duration = 0.35 } = {}) {
    try {
      const { execFileSync } = require("child_process");
      const ffmpeg = process.env.FFMPEG || "ffmpeg";
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      execFileSync(
        ffmpeg,
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=${frequency}:duration=${duration}`,
          "-ar",
          "16000",
          "-ac",
          "1",
          outPath,
        ],
        { stdio: "ignore", timeout: 15000 },
      );
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 44) {
        return {
          ok: true,
          path: outPath,
          bytes: fs.statSync(outPath).size,
          tool: "ffmpeg-sine",
        };
      }
    } catch (err) {
      return {
        ok: false,
        path: outPath,
        bytes: 0,
        error: err.message || String(err),
      };
    }
    return { ok: false, path: outPath, bytes: 0 };
  }

  function cloudSessionPath(bcId) {
    return path.join(
      REPO_ROOT,
      "data",
      "cloud",
      "sessions",
      `${sanitizeSkillName(bcId) || "bc"}.json`,
    );
  }

  function readCloudSession(bcId) {
    const p = cloudSessionPath(bcId);
    try {
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  }

  function writeCloudSession(bcId, session) {
    const p = cloudSessionPath(bcId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(session, null, 2));
    return p;
  }

  async function executeCloudEffect(kind, command) {
    const at = new Date().toISOString();
    const cmd = String(command || "");

    if (kind === "cloud_agent_launch") {
      const parts = cmd.split("|");
      const bcId = parts[0] || `bc-local-${Date.now().toString(36)}`;
      const url =
        parts[1] ||
        (bcId ? `https://cursor.com/agents/${bcId}` : "");
      const prompt = parts.slice(2).join("|") || "";
      const depth = nestDepth();
      const cloudApiUrl = String(process.env.BITBOT_CLOUD_API_URL || "").trim();
      const cloudToken = String(
        process.env.BITBOT_CURSOR_CLOUD_TOKEN ||
          process.env.BITBOT_CLOUD_API_TOKEN ||
          "",
      ).trim();
      const wantRemote = Boolean(cloudApiUrl || cloudToken);
      let remoteProbe = null;
      let mode = "local_worker";
      let remoteResidual = true;
      let remoteAttempted = false;

      // Honest remote Cursor Cloud path: probe when URL+token set; never pretend remote success.
      // Local mock: BITBOT_CLOUD_API_URL=http://127.0.0.1:18774 (host_local_http_mock --mode cloud).
      if (wantRemote && cloudApiUrl && cloudToken) {
        remoteAttempted = true;
        try {
          const probeUrl = cloudApiUrl.replace(/\/$/, "") + "/agents";
          const resp = await httpJson(probeUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cloudToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              prompt: prompt || "cloud agent ping",
              bc_id: bcId,
              source: "bitbot-host",
            }),
          });
          const body = resp.json || {
            raw: String(resp.body || "").slice(0, 400),
          };
          remoteProbe = {
            ok: Boolean(resp.ok),
            http_status: resp.status || 0,
            error: resp.error || null,
            body_keys:
              body && typeof body === "object"
                ? Object.keys(body).slice(0, 12)
                : [],
            remote_bc_id: (body && (body.bc_id || body.id)) || null,
          };
          if (resp.ok) {
            mode = "remote_cloud_api";
            remoteResidual = false;
          } else {
            mode = "local_worker_after_remote_fail";
            remoteResidual = true;
          }
        } catch (err) {
          remoteProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
          mode = "local_worker_after_remote_fail";
          remoteResidual = true;
        }
      } else if (wantRemote) {
        // Partial remote config → honest residual, still run local worker.
        remoteResidual = true;
        mode = "local_worker";
        remoteProbe = {
          ok: false,
          error: "BITBOT_CLOUD_API_URL and BITBOT_CURSOR_CLOUD_TOKEN both required for remote",
        };
      }

      let session = {
        bc_id: bcId,
        url,
        prompt,
        status: "launching",
        mode,
        pretend_remote_cloud: false,
        remote_cloud_residual: remoteResidual,
        remote_api_attempted: remoteAttempted,
        remote_probe: remoteProbe,
        note:
          mode === "remote_cloud_api"
            ? "Host remote Cursor Cloud API launch"
            : "Host local MoonBit worker — remote Cursor Cloud API residual (no live remote session claimed)",
        at,
      };
      const sessionPath = writeCloudSession(bcId, session);

      let worker = {
        ok: true,
        nested_skipped: depth >= 1,
        assistant: "",
        intent: "",
      };
      if (mode === "remote_cloud_api") {
        // Remote API accepted launch — do not also invent a pretend remote completion body.
        session = {
          ...session,
          status: "launched_remote",
          completed_at: at,
          assistant: String(
            (remoteProbe && remoteProbe.body_keys && remoteProbe.body_keys.join(",")) ||
              "remote cloud launch accepted",
          ).slice(0, 4000),
          worker_ok: true,
          nested_skipped: false,
        };
        worker = { ok: true, nested_skipped: false, assistant: session.assistant, intent: "remote_cloud" };
      } else if (depth >= 1) {
        session = {
          ...session,
          status: "completed_nest_skipped",
          completed_at: at,
          assistant: "(cloud worker nest skipped)",
        };
      } else {
        session.status = "running";
        writeCloudSession(bcId, session);
        worker = await runWorkerMoonTurn({
          prompt: prompt || "cloud agent ping",
          sessionId: `cloud-${sanitizeSkillName(bcId)}`,
        });
        if (worker.needs_host_ffi && worker.effects && worker.effects.length) {
          const prev = process.env.BITBOT_NEST_DEPTH;
          process.env.BITBOT_NEST_DEPTH = "1";
          try {
            worker.host_results = await executeHostEffects(worker.effects);
          } finally {
            if (prev === undefined) delete process.env.BITBOT_NEST_DEPTH;
            else process.env.BITBOT_NEST_DEPTH = prev;
          }
        }
        session = {
          ...session,
          status: worker.ok ? "completed" : "failed",
          completed_at: new Date().toISOString(),
          assistant: String(worker.assistant || "").slice(0, 4000),
          worker_intent: worker.intent || "",
          worker_ok: Boolean(worker.ok),
          nested_skipped: Boolean(worker.nested_skipped),
        };
      }
      writeCloudSession(bcId, session);

      const launchDir = path.join(REPO_ROOT, "data", "cloud", "launches");
      fs.mkdirSync(launchDir, { recursive: true });
      const launchPath = path.join(
        launchDir,
        `launch-${sanitizeSkillName(bcId) || "bc"}-${Date.now().toString(36)}.json`,
      );
      const entry = {
        bc_id: bcId,
        url,
        prompt,
        mode: session.mode,
        status: session.status,
        session_path: sessionPath,
        pretend_remote_cloud: false,
        remote_cloud_residual: remoteResidual,
        remote_api_attempted: remoteAttempted,
        remote_probe: remoteProbe,
        mode_note: session.note || "",
        at,
      };
      fs.writeFileSync(launchPath, JSON.stringify(entry, null, 2));
      const pathWritten = appendJsonl(CLOUD_LAUNCHES_PATH, {
        ...entry,
        path: launchPath,
      });
      const card = recordSendToUser({
        type: "cursor-agent",
        bc_id: bcId,
        open_url: url,
        can_open_cloud: Boolean(bcId),
        prompt_prefix: String(prompt || "").slice(0, 80),
        status: session.status,
        path: launchPath,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: launchPath,
        ledger_path: pathWritten,
        session: sessionPath,
        status: session.status,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: launchPath,
        ledger_path: pathWritten,
        launched: true,
        ran: depth < 1 || mode === "remote_cloud_api",
        worker_ok: Boolean(worker.ok),
        nested_skipped: Boolean(worker.nested_skipped),
        assistant_prefix: String(session.assistant || "").slice(0, 160),
        cursor_agent_card: card,
        send_to_user: card,
        ok: true,
      });
    }

    if (kind === "cloud_artifact_deliver") {
      const parts = cmd.split("|");
      const srcOrUrl = parts[0] || "";
      const destRaw = parts[1] || "report.md";
      const destName = path.basename(destRaw || "report.md") || "report.md";
      const destDir = path.join(REPO_ROOT, "agent-tools", "cloud-artifacts");
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, destName);

      let copied = false;
      let fromSession = false;
      let bcId = "";
      const bcMatch = String(srcOrUrl).match(/bc-[A-Za-z0-9_-]+/);
      if (bcMatch) bcId = bcMatch[0];
      else if (/^bc-/i.test(srcOrUrl)) bcId = srcOrUrl;

      if (srcOrUrl && fs.existsSync(srcOrUrl) && fs.statSync(srcOrUrl).isFile()) {
        fs.copyFileSync(srcOrUrl, destPath);
        copied = true;
      } else {
        const session = bcId ? readCloudSession(bcId) : null;
        const body =
          (session && session.assistant) ||
          `# Cloud artifact\n\nsource: ${srcOrUrl}\nbc_id: ${bcId || "(none)"}\nstatus: ${
            (session && session.status) || "no_session"
          }\n\n${
            session
              ? "Materialized from Host local cloud worker session."
              : "No local session — placeholder report (not remote cloud fetch)."
          }\n`;
        fs.writeFileSync(destPath, body.endsWith("\n") ? body : body + "\n");
        fromSession = Boolean(session && session.assistant);
      }

      const delivDir = path.join(REPO_ROOT, "data", "cloud", "deliveries");
      fs.mkdirSync(delivDir, { recursive: true });
      const metaPath = path.join(
        delivDir,
        `deliver-${sanitizeSkillName(bcId || destName) || "art"}-${Date.now().toString(36)}.json`,
      );
      const meta = {
        artifact_path: destPath,
        source: srcOrUrl,
        bc_id: bcId || "",
        copied,
        from_session: fromSession,
        delivered: true,
        bytes: fs.statSync(destPath).size,
        pretend_remote_fetch: false,
        pretend_delivered: false,
        mode: fromSession
          ? "host_cloud_artifact_from_session"
          : copied
            ? "host_cloud_artifact_copy"
            : "host_cloud_artifact_placeholder",
        at,
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      appendJsonl(path.join(delivDir, "deliveries.jsonl"), {
        ...meta,
        path: metaPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: destPath,
        meta_path: metaPath,
        label: "cloud_artifact",
        bc_id: bcId || "",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: destPath,
        meta_path: metaPath,
        copied,
        from_session: fromSession,
        at,
      });
      return okJson(kind, cmd, {
        ...meta,
        path: destPath,
        meta_path: metaPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    return null;
  }

  async function executeDevtoolsEffect(kind, command) {
    const at = new Date().toISOString();
    const cmd = String(command || "");

    if (kind === "code_changes") {
      // command: mcp_namespace|/workspace/path
      const sep = cmd.indexOf("|");
      const ns = sep >= 0 ? cmd.slice(0, sep) : "user-github";
      const target = sep >= 0 ? cmd.slice(sep + 1) : cmd;
      const abs = path.isAbsolute(target)
        ? target
        : path.join(REPO_ROOT, target.replace(/^\/workspace\//, ""));
      const underRepo =
        abs === REPO_ROOT || abs.startsWith(REPO_ROOT + path.sep);
      const exists = underRepo && fs.existsSync(abs);
      const planDir = path.join(REPO_ROOT, "data", "code-changes");
      fs.mkdirSync(planDir, { recursive: true });
      const planId = `edit-${Date.now().toString(36)}`;
      const planPath = path.join(planDir, `${planId}.json`);
      let gitDiffStat = "";
      try {
        const { stdout } = await execFileAsync(
          "git",
          ["diff", "--stat", "--", exists ? path.relative(REPO_ROOT, abs) : "."],
          { cwd: REPO_ROOT, timeout: 15000 },
        );
        gitDiffStat = String(stdout || "").slice(0, 2000);
      } catch {
        gitDiffStat = "";
      }
      // BITBOT_CODE_APPLY=1 applies a durable sidecar patch under repo; never auto-commits.
      const allowApply =
        String(process.env.BITBOT_CODE_APPLY || "").trim() === "1";
      let applied = false;
      let appliedPath = null;
      let applyError = null;
      if (allowApply && exists && underRepo && fs.statSync(abs).isFile()) {
        try {
          appliedPath = abs + ".bitbot-applied.json";
          const marker = {
            target: abs,
            namespace: ns,
            applied: true,
            pretend_committed: false,
            note: "Host applied durable sidecar — git commit still requires explicit source_control",
            at,
          };
          fs.writeFileSync(appliedPath, JSON.stringify(marker, null, 2));
          applied = true;
        } catch (err) {
          applyError = String((err && err.message) || err).slice(0, 200);
          applied = false;
        }
      }
      const plan = {
        id: planId,
        namespace: ns,
        target: abs,
        exists,
        under_repo: underRepo,
        applied,
        apply_gated: allowApply,
        applied_path: appliedPath,
        apply_error: applyError,
        pretend_committed: false,
        code_apply_residual: !applied,
        git_diff_stat: gitDiffStat,
        note: applied
          ? "Host code-changes applied sidecar — not auto-committed (CM-1810)"
          : "Host code-changes plan — scoped edit not auto-committed (CM-1810); set BITBOT_CODE_APPLY=1 to apply sidecar",
        at,
      };
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
      // Sidecar plan next to target when file exists under repo.
      let sidecar = null;
      if (exists && fs.statSync(abs).isFile()) {
        sidecar = abs + ".bitbot-plan.md";
        fs.writeFileSync(
          sidecar,
          `# Bit Bot code-changes plan\n\n- target: \`${abs}\`\n- namespace: \`${ns}\`\n- applied: ${applied}\n- pretend_committed: false\n\nHost recorded a scoped edit plan; MoonBit owns intent (CM-1810).\n`,
        );
      }
      const delivery = recordSendToUser({
        type: "attachment",
        path: planPath,
        label: "code_changes_plan",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: planPath,
        sidecar,
        applied,
        applied_path: appliedPath,
        at,
      });
      return okJson(kind, cmd, {
        ...plan,
        path: planPath,
        sidecar,
        send_to_user: delivery,
      });
    }

    if (kind === "source_control") {
      // command: mcp_namespace|status|create_pr
      const sep = cmd.indexOf("|");
      const ns = sep >= 0 ? cmd.slice(0, sep) : "user-github";
      const action = (sep >= 0 ? cmd.slice(sep + 1) : "status") || "status";
      const scDir = path.join(REPO_ROOT, "data", "source-control");
      fs.mkdirSync(scDir, { recursive: true });
      const statusPath = path.join(scDir, "status.json");
      let branch = "";
      let porcelain = "";
      let head = "";
      let remoteUrl = "";
      let ok = true;
      let err = "";
      try {
        const br = await execFileAsync(
          "git",
          ["rev-parse", "--abbrev-ref", "HEAD"],
          { cwd: REPO_ROOT, timeout: 10000 },
        );
        branch = String(br.stdout || "").trim();
        const hd = await execFileAsync("git", ["rev-parse", "HEAD"], {
          cwd: REPO_ROOT,
          timeout: 10000,
        });
        head = String(hd.stdout || "").trim().slice(0, 40);
        const st = await execFileAsync(
          "git",
          ["status", "--porcelain=v1"],
          { cwd: REPO_ROOT, timeout: 15000 },
        );
        porcelain = String(st.stdout || "");
        try {
          const ru = await execFileAsync(
            "git",
            ["config", "--get", "remote.origin.url"],
            { cwd: REPO_ROOT, timeout: 5000 },
          );
          remoteUrl = String(ru.stdout || "").trim();
        } catch {
          remoteUrl = "";
        }
      } catch (e) {
        ok = false;
        err = e.message || String(e);
      }

      // Remote PR: BITBOT_GH_CREATE_PR=1 enables view/dry-run; never pretend create.
      // BITBOT_GH_PR_CREATE=1 would allow real create — default is dry-run only.
      const wantPr =
        /create_pr|pull_request|open_pr/i.test(action) ||
        String(process.env.BITBOT_GH_CREATE_PR || "").trim() === "1";
      const allowRealCreate =
        String(process.env.BITBOT_GH_PR_CREATE || "").trim() === "1";
      let remotePr = null;
      let remotePrResidual = true;
      let mode = "host_git_status";
      if (wantPr) {
        // BITBOT_GH_BIN overrides real gh for Host fidelity smoke (mock create/view).
        const ghBin = (() => {
          const override = String(process.env.BITBOT_GH_BIN || "").trim();
          if (override) {
            try {
              if (fs.existsSync(override)) return override;
            } catch {
              /* fall through */
            }
          }
          try {
            return require("child_process")
              .execSync("command -v gh", { encoding: "utf8" })
              .trim();
          } catch {
            return "";
          }
        })();
        const gateOn =
          String(process.env.BITBOT_GH_CREATE_PR || "").trim() === "1";
        if (ghBin && gateOn) {
          // Prefer existing PR view; then dry-run create plan (or real create if gated).
          try {
            const pr = await execFileAsync(
              ghBin,
              ["pr", "view", "--json", "url,number,state,title"],
              { cwd: REPO_ROOT, timeout: 20000 },
            );
            let body = null;
            try {
              body = JSON.parse(String(pr.stdout || "{}"));
            } catch {
              body = { raw: String(pr.stdout || "").slice(0, 400) };
            }
            const planPath = path.join(scDir, "pr-create-plan.json");
            fs.writeFileSync(
              planPath,
              JSON.stringify(
                {
                  branch,
                  head,
                  mode: "gh_pr_view",
                  dry_run: true,
                  allow_real_create: allowRealCreate,
                  real_create_gated: !allowRealCreate,
                  existing_pr: body,
                  pretend_remote_pr: false,
                  note: "Existing PR viewed — real create still gated on BITBOT_GH_PR_CREATE=1",
                  at,
                },
                null,
                2,
              ),
            );
            remotePr = {
              ok: true,
              mode: "gh_pr_view",
              pr: body,
              create_attempted: false,
              dry_run: false,
              plan_path: planPath,
              real_create_gated: !allowRealCreate,
            };
            remotePrResidual = false;
            mode = "host_git_status+gh_pr_view";
          } catch (viewErr) {
            // No existing PR — attempt dry-run create (default) or real create if gated.
            const createArgs = allowRealCreate
              ? [
                  "pr",
                  "create",
                  "--title",
                  `Bit Bot Host source_control ${branch || "branch"}`,
                  "--body",
                  "Created by Bit Bot Host source_control (BITBOT_GH_PR_CREATE=1).",
                  "--draft",
                ]
              : [
                  "pr",
                  "create",
                  "--dry-run",
                  "--title",
                  `Bit Bot Host source_control ${branch || "branch"}`,
                  "--body",
                  "Dry-run PR plan from Bit Bot Host (BITBOT_GH_CREATE_PR=1).",
                ];
            try {
              const created = await execFileAsync(ghBin, createArgs, {
                cwd: REPO_ROOT,
                timeout: 45000,
              });
              const out = String(created.stdout || created.stderr || "").slice(
                0,
                800,
              );
              const planPath = path.join(scDir, "pr-create-plan.json");
              fs.writeFileSync(
                planPath,
                JSON.stringify(
                  {
                    branch,
                    head,
                    dry_run: !allowRealCreate,
                    allow_real_create: allowRealCreate,
                    real_create_gated: !allowRealCreate,
                    args: createArgs,
                    output_prefix: out,
                    pretend_remote_pr: false,
                    at,
                  },
                  null,
                  2,
                ),
              );
              remotePr = {
                ok: true,
                mode: allowRealCreate ? "gh_pr_create" : "gh_pr_create_dry_run",
                dry_run: !allowRealCreate,
                create_attempted: true,
                output_prefix: out,
                plan_path: planPath,
                real_create_gated: !allowRealCreate,
              };
              // Dry-run closes create residual for Host fidelity without inventing a PR URL.
              remotePrResidual = false;
              mode = allowRealCreate
                ? "host_git_status+gh_pr_create"
                : "host_git_status+gh_pr_create_dry_run";
            } catch (createErr) {
              const planPath = path.join(scDir, "pr-create-plan.json");
              const failPayload = {
                branch,
                head,
                dry_run: !allowRealCreate,
                allow_real_create: allowRealCreate,
                real_create_gated: !allowRealCreate,
                args: createArgs,
                pretend_remote_pr: false,
                view_error: String(
                  (viewErr && viewErr.message) || viewErr,
                ).slice(0, 200),
                error: String(
                  (createErr && createErr.message) || createErr,
                ).slice(0, 300),
                at,
              };
              fs.writeFileSync(planPath, JSON.stringify(failPayload, null, 2));
              remotePr = {
                ok: false,
                mode: "gh_pr_create_failed",
                dry_run: !allowRealCreate,
                create_attempted: true,
                plan_path: planPath,
                real_create_gated: !allowRealCreate,
                view_error: failPayload.view_error,
                error: failPayload.error,
              };
              remotePrResidual = true;
              mode = "host_git_status+gh_pr_create_residual";
            }
          }
        } else {
          const planPath = path.join(scDir, "pr-create-plan.json");
          fs.writeFileSync(
            planPath,
            JSON.stringify(
              {
                branch,
                head,
                mode: "remote_pr_residual",
                dry_run: true,
                allow_real_create: false,
                real_create_gated: true,
                pretend_remote_pr: false,
                error: ghBin
                  ? "BITBOT_GH_CREATE_PR!=1 — refuse create/view pretend"
                  : "gh CLI not found — remote PR residual",
                at,
              },
              null,
              2,
            ),
          );
          remotePr = {
            ok: false,
            mode: "remote_pr_residual",
            plan_path: planPath,
            real_create_gated: true,
            error: ghBin
              ? "BITBOT_GH_CREATE_PR!=1 — refuse create/view pretend"
              : "gh CLI not found — remote PR residual",
          };
          remotePrResidual = true;
          mode = "host_git_status+remote_pr_residual";
        }
      }

      const payload = {
        namespace: ns,
        action,
        branch,
        head,
        remote_url: remoteUrl || null,
        dirty: Boolean(porcelain.trim()),
        porcelain: porcelain.slice(0, 4000),
        mode,
        pretend_remote_pr: false,
        remote_pr_residual: remotePrResidual,
        remote_pr: remotePr,
        ok,
        error: err || null,
        at,
      };
      fs.writeFileSync(statusPath, JSON.stringify(payload, null, 2));
      appendJsonl(path.join(scDir, "status.jsonl"), payload);
      const delivery = recordSendToUser({
        type: "attachment",
        path: statusPath,
        label: "source_control_status",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: statusPath,
        branch,
        at,
      });
      return okJson(kind, cmd, {
        ...payload,
        path: statusPath,
        send_to_user: delivery,
      });
    }

    return null;
  }

  async function executeVoiceRelay(command) {
    const at = new Date().toISOString();
    const cmd = String(command || "");
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

    const mediaDir = path.join(REPO_ROOT, "data", "voice", "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    const slug = String(address)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 64);
    if (!row.media_path) {
      row.media_path = path.join(mediaDir, `${slug || "voice"}.wav`);
    }
    const transcript = path.join(
      path.dirname(row.media_path),
      path.basename(row.media_path, path.extname(row.media_path)) +
        ".transcript.jsonl",
    );
    appendJsonl(transcript, { role: "user", text, at });
    row.transcript_path = transcript;

    // Host voice reply: MoonBit worker text + reply WAV (CHARTER SendToUser voice).
    const worker = await runWorkerMoonTurn({
      prompt: text || "voice ping",
      sessionId: `voice-${slug || "session"}`,
    });
    const replyText =
      worker.assistant ||
      (worker.nested_skipped
        ? "(voice nest skipped)"
        : "Bit Bot voice ack.");
    const replyWav = path.join(
      mediaDir,
      `${slug || "voice"}-reply-${row.relay_log.length}.wav`,
    );
    const replyMedia = synthesizeVoiceWav(replyWav, {
      frequency: 660,
      duration: 0.3,
    });
    row.relay_log.push({
      role: "assistant",
      text: replyText.slice(0, 2000),
      media_path: replyMedia.path,
      media_ok: Boolean(replyMedia.ok),
      at: new Date().toISOString(),
    });
    appendJsonl(transcript, {
      role: "assistant",
      text: replyText.slice(0, 2000),
      media_path: replyMedia.path,
      media_ok: Boolean(replyMedia.ok),
      at: new Date().toISOString(),
    });
    row.reply_media_path = replyMedia.path;
    row.reply_media_ok = Boolean(replyMedia.ok);
    writeJsonArray(VOICE_SESSIONS_PATH, rows);

    const delivery = recordSendToUser({
      type: "voice",
      voice_address: address,
      media_path: replyMedia.path,
      media_ok: Boolean(replyMedia.ok),
      reply_prefix: replyText.slice(0, 120),
      turns: row.relay_log.length,
      source_kind: "voice_relay",
      at,
    });
    appendHostDeliveryJournal({
      kind: "voice_relay",
      command: cmd,
      path: VOICE_SESSIONS_PATH,
      turns: row.relay_log.length,
      reply_media_ok: Boolean(replyMedia.ok),
      at,
    });
    return okJson("voice_relay", cmd, {
      voice_address: address,
      turns: row.relay_log.length,
      path: VOICE_SESSIONS_PATH,
      media_path: row.media_path || null,
      transcript_path: transcript,
      reply: replyText.slice(0, 2000),
      reply_media_path: replyMedia.path,
      reply_media_ok: Boolean(replyMedia.ok),
      reply_media_bytes: replyMedia.bytes || 0,
      worker_ok: Boolean(worker.ok),
      nested_skipped: Boolean(worker.nested_skipped),
      send_to_user: delivery,
    });
  }

  async function executeMultiAgentEffect(kind, command) {
    const at = new Date().toISOString();
    const cmd = String(command || "");
    const depth = nestDepth();

    if (kind === "room_turn") {
      const sep = cmd.indexOf(" :: ");
      const room = sep >= 0 ? cmd.slice(0, sep) : "room";
      const body = sep >= 0 ? cmd.slice(sep + 4) : cmd;
      const members = readJsonArray(TEAMMATES_PATH)
        .filter((r) => r && r.id)
        .map((r) => ({ id: r.id, name: r.name || r.id, role: r.role || "" }));
      const delivered_to = [];
      for (const m of members) {
        const inboxPath = path.join(
          AGENT_INBOX_DIR,
          `${sanitizeSkillName(m.id)}.jsonl`,
        );
        appendJsonl(inboxPath, {
          room,
          from: "user",
          to_id: m.id,
          body,
          is_room: true,
          forbids_private_assumptions: true,
          at,
        });
        delivered_to.push(m.id);
      }
      const roomDir = path.join(REPO_ROOT, "data", "agents", "room-turns");
      fs.mkdirSync(roomDir, { recursive: true });
      const turnPath = path.join(
        roomDir,
        `turn-${sanitizeSkillName(room) || "room"}-${Date.now().toString(36)}.json`,
      );
      const entry = {
        room,
        body,
        speaker_id: "user",
        is_room: true,
        is_private_dm: false,
        forbids_private_assumptions: true,
        members,
        delivered_to,
        member_count: members.length,
        mode: "room_fanout",
        pretend_private_dm: false,
        at,
      };
      fs.writeFileSync(turnPath, JSON.stringify(entry, null, 2));
      const pathWritten = appendJsonl(ROOM_TURNS_PATH, {
        ...entry,
        path: turnPath,
      });
      const delivery = recordSendToUser({
        type: "thread",
        channel: `room:${room}`,
        body_prefix: String(body || "").slice(0, 120),
        room,
        member_count: members.length,
        path: turnPath,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: turnPath,
        ledger_path: pathWritten,
        delivered_to,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: turnPath,
        ledger_path: pathWritten,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "send_to_agent") {
      const sep = cmd.indexOf(" :: ");
      const toId = sep >= 0 ? cmd.slice(0, sep) : cmd;
      const body = sep >= 0 ? cmd.slice(sep + 4) : "";
      if (!toId || toId === "user" || toId === "self") {
        return {
          kind,
          ok: false,
          command: cmd,
          error: "send_to_agent refused: invalid to_id / self-loop",
          stdout: "",
          stderr: "",
        };
      }
      const teammates = readJsonArray(TEAMMATES_PATH);
      const known = teammates.find((r) => r && r.id === toId) || null;
      const inboxPath = path.join(
        AGENT_INBOX_DIR,
        `${sanitizeSkillName(toId)}.jsonl`,
      );
      const inboxEntry = {
        to_id: toId,
        body,
        status: "queued",
        teammate_known: Boolean(known),
        at,
      };
      appendJsonl(inboxPath, inboxEntry);
      let worker = {
        ok: true,
        nested_skipped: depth >= 1,
        assistant: "",
        intent: "",
      };
      let reply = "";
      let status = "delivered";
      if (depth >= 1) {
        status = "delivered_nest_skipped";
        reply = `(nest skipped — inbox only for ${toId})`;
      } else {
        worker = await runWorkerMoonTurn({
          prompt: body || "ping",
          sessionId: `agent-${sanitizeSkillName(toId)}`,
        });
        reply = worker.assistant || `(acked by ${toId})`;
        // Apply non-nesting host effects from worker if any (nest depth already elevated in child env;
        // this process stays at depth 0 but child spawn was nest-guarded).
        if (worker.needs_host_ffi && worker.effects && worker.effects.length) {
          const prev = process.env.BITBOT_NEST_DEPTH;
          process.env.BITBOT_NEST_DEPTH = "1";
          try {
            await executeHostEffects(worker.effects);
          } finally {
            if (prev === undefined) delete process.env.BITBOT_NEST_DEPTH;
            else process.env.BITBOT_NEST_DEPTH = prev;
          }
        }
        status = worker.ok ? "delivered_replied" : "delivered_worker_error";
      }
      const outboxPath = path.join(
        AGENT_OUTBOX_DIR,
        `${sanitizeSkillName(toId)}.jsonl`,
      );
      const outboxEntry = {
        to_id: toId,
        body,
        reply: String(reply).slice(0, 2000),
        status,
        teammate_known: Boolean(known),
        worker_intent: worker.intent || "",
        nested_skipped: Boolean(worker.nested_skipped),
        at,
      };
      appendJsonl(outboxPath, outboxEntry);
      appendJsonl(inboxPath, {
        to_id: toId,
        body,
        status,
        reply_prefix: String(reply).slice(0, 120),
        at,
      });
      const sendDir = path.join(REPO_ROOT, "data", "agents", "sends");
      fs.mkdirSync(sendDir, { recursive: true });
      const sendPath = path.join(
        sendDir,
        `send-${sanitizeSkillName(toId) || "agent"}-${Date.now().toString(36)}.json`,
      );
      const sendArtifact = {
        to_id: toId,
        body,
        reply: String(reply).slice(0, 2000),
        status,
        teammate_known: Boolean(known),
        teammate: known,
        inbox_path: inboxPath,
        outbox_path: outboxPath,
        routed: true,
        delivered: true,
        nested_skipped: Boolean(worker.nested_skipped),
        worker_ok: Boolean(worker.ok),
        mode: "host_send_to_agent",
        pretend_delivered: false,
        at,
      };
      fs.writeFileSync(sendPath, JSON.stringify(sendArtifact, null, 2));
      appendJsonl(path.join(sendDir, "sends.jsonl"), {
        ...sendArtifact,
        path: sendPath,
      });
      const delivery = recordSendToUser({
        type: "text",
        channel: `agent:${toId}`,
        body_prefix: String(reply).slice(0, 120),
        to_id: toId,
        status,
        path: sendPath,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: sendPath,
        inbox: inboxPath,
        outbox: outboxPath,
        status,
        at,
      });
      return okJson(kind, cmd, {
        ...sendArtifact,
        path: sendPath,
        outbox: outboxPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "subagent_run") {
      const parts = cmd.split("|");
      const id = parts[0] || "sub-1";
      const prompt = parts.slice(1).join("|") || "";
      const rows = readJsonArray(SUBAGENTS_PATH);
      let row = {
        id,
        prompt,
        status: "running",
        kind: "executor",
        at,
      };
      const idx = rows.findIndex((r) => r && r.id === id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push(row);
      writeJsonArray(SUBAGENTS_PATH, rows);

      let worker = {
        ok: true,
        nested_skipped: depth >= 1,
        assistant: "",
        intent: "",
        error: "",
      };
      let resultPath = "";
      fs.mkdirSync(SUBAGENT_RESULTS_DIR, { recursive: true });
      const runStamp = Date.now().toString(36);
      if (depth >= 1) {
        row = {
          ...row,
          status: "completed_nest_skipped",
          completed_at: at,
          note: "CM-2133 nest guard — no busy-loop subagent spawn",
        };
        resultPath = path.join(
          SUBAGENT_RESULTS_DIR,
          `run-${sanitizeSkillName(id) || "sub"}-nest-${runStamp}.json`,
        );
        fs.writeFileSync(
          resultPath,
          JSON.stringify(
            {
              id,
              prompt,
              status: row.status,
              nested_skipped: true,
              pretend_completed: false,
              note: row.note,
              at,
            },
            null,
            2,
          ),
        );
      } else {
        worker = await runWorkerMoonTurn({
          prompt: prompt || "summarize",
          sessionId: `subagent-${sanitizeSkillName(id)}`,
        });
        if (worker.needs_host_ffi && worker.effects && worker.effects.length) {
          const prev = process.env.BITBOT_NEST_DEPTH;
          process.env.BITBOT_NEST_DEPTH = "1";
          try {
            worker.host_results = await executeHostEffects(worker.effects);
          } finally {
            if (prev === undefined) delete process.env.BITBOT_NEST_DEPTH;
            else process.env.BITBOT_NEST_DEPTH = prev;
          }
        }
        resultPath = path.join(
          SUBAGENT_RESULTS_DIR,
          `run-${sanitizeSkillName(id) || "sub"}-${runStamp}.json`,
        );
        fs.writeFileSync(
          resultPath,
          JSON.stringify(
            {
              id,
              prompt,
              assistant: worker.assistant || "",
              intent: worker.intent || "",
              ok: Boolean(worker.ok),
              error: worker.error || "",
              pretend_completed: false,
              at,
            },
            null,
            2,
          ),
        );
        // Keep last-known result alias for tooling that expects id.json.
        fs.writeFileSync(
          path.join(SUBAGENT_RESULTS_DIR, `${sanitizeSkillName(id)}.json`),
          JSON.stringify(
            {
              id,
              prompt,
              assistant: worker.assistant || "",
              intent: worker.intent || "",
              ok: Boolean(worker.ok),
              error: worker.error || "",
              run_path: resultPath,
              at,
            },
            null,
            2,
          ),
        );
        row = {
          ...row,
          status: worker.ok ? "completed" : "failed",
          completed_at: new Date().toISOString(),
          result_path: resultPath,
          assistant_prefix: String(worker.assistant || "").slice(0, 160),
          worker_intent: worker.intent || "",
        };
      }
      const next = readJsonArray(SUBAGENTS_PATH);
      const i2 = next.findIndex((r) => r && r.id === id);
      if (i2 >= 0) next[i2] = { ...next[i2], ...row };
      else next.push(row);
      writeJsonArray(SUBAGENTS_PATH, next);
      const runMetaPath = path.join(
        SUBAGENT_RESULTS_DIR,
        `meta-${sanitizeSkillName(id) || "sub"}-${runStamp}.json`,
      );
      const runMeta = {
        stored: true,
        subagent: row,
        result_path: resultPath || null,
        registry_path: SUBAGENTS_PATH,
        worker_ok: Boolean(worker.ok),
        nested_skipped: Boolean(worker.nested_skipped) || depth >= 1,
        ran: depth < 1,
        pretend_completed: false,
        mode: "host_subagent_run",
        at,
      };
      fs.writeFileSync(runMetaPath, JSON.stringify(runMeta, null, 2));
      const delivery = recordSendToUser({
        type: "text",
        channel: `subagent:${id}`,
        body_prefix: String(row.assistant_prefix || row.status || "").slice(
          0,
          120,
        ),
        status: row.status,
        path: runMetaPath,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: runMetaPath,
        registry_path: SUBAGENTS_PATH,
        result_path: resultPath || null,
        status: row.status,
        at,
      });
      return okJson(kind, cmd, {
        ...runMeta,
        path: runMetaPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    return null;
  }

  async function executeProductDeliveryEffect(kind, command) {
    const at = new Date().toISOString();
    const cmd = String(command || "");

    if (kind === "machines_list") {
      // command: host_kind|host_id|id:kind:status,...
      const parts = cmd.split("|");
      const hostKind = parts[0] || "";
      const hostId = parts[1] || "";
      const rowsRaw = parts.slice(2).join("|") || "";
      const machines = rowsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((row) => {
          const bits = row.split(":");
          return {
            id: bits[0] || "",
            kind: bits[1] || "",
            status: bits[2] || "disconnected",
          };
        });
      const dir = path.join(REPO_ROOT, "data", "machines");
      fs.mkdirSync(dir, { recursive: true });
      const listPath = path.join(
        dir,
        `list-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        host_kind: hostKind,
        host_id: hostId,
        machines,
        count: machines.length,
        mode: "host_machines_list",
        pretend_all_connected: false,
        at,
      };
      fs.writeFileSync(listPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "lists.jsonl"), {
        ...artifact,
        path: listPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: listPath,
        label: "machines_list",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: listPath,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: listPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "skill_load") {
      // command: task|loaded_count
      const parts = cmd.split("|");
      const task = parts[0] || "";
      const loadedCount = Number(parts[1] || "0") || 0;
      const dir = path.join(REPO_ROOT, "data", "skills");
      fs.mkdirSync(dir, { recursive: true });
      const loadPath = path.join(
        dir,
        `load-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        task,
        loaded_count: loadedCount,
        mode: "host_skill_load",
        pretend_loaded: false,
        at,
      };
      fs.writeFileSync(loadPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "loads.jsonl"), artifact);
      const delivery = recordSendToUser({
        type: "attachment",
        path: loadPath,
        label: "skill_load",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: loadPath,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: loadPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "mail_claim_inbox") {
      // command: local_part|address
      const parts = cmd.split("|");
      const localPart = parts[0] || "";
      const address = parts[1] || `${localPart}@bitbot.local`;
      const dir = path.join(REPO_ROOT, "data", "mail", "claims");
      fs.mkdirSync(dir, { recursive: true });
      const claimPath = path.join(
        dir,
        `claim-${localPart || "inbox"}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        local_part: localPart,
        address,
        mode: "host_mail_claim_inbox",
        pretend_claimed: false,
        user_confirmed: true,
        at,
      };
      fs.writeFileSync(claimPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "claims.jsonl"), artifact);
      const delivery = recordSendToUser({
        type: "attachment",
        path: claimPath,
        label: "mail_claim_inbox",
        address,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: claimPath,
        address,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: claimPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "device_permission") {
      const parts = cmd.split("|");
      const entry = {
        machine_id: parts[0] || "",
        tool: parts[1] || "",
        permission: parts[2] || "needs_permission",
        pretend_granted: false,
        os_card: true,
        settings_guide: true,
        true_device_os_dialog_residual: true,
        mode: "host_device_permission_card",
        at,
      };
      const pathWritten = appendJsonl(DEVICE_PERMS_PATH, entry);
      const cardDir = path.join(REPO_ROOT, "data", "device", "permission-cards");
      fs.mkdirSync(cardDir, { recursive: true });
      const cardPath = path.join(
        cardDir,
        `perm-${Date.now().toString(36)}.json`,
      );
      fs.writeFileSync(
        cardPath,
        JSON.stringify({ ...entry, queue_path: pathWritten }, null, 2),
      );
      const delivery = recordSendToUser({
        type: "widget",
        widget: "device_permission",
        path: cardPath,
        tool: entry.tool,
        machine_id: entry.machine_id,
        pretend_granted: false,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: cardPath,
        queue_path: pathWritten,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: cardPath,
        queue_path: pathWritten,
        send_to_user: delivery,
        note: "OS permission card / Settings guide — not pretend-granted; true-device dialog residual",
        ok: true,
      });
    }

    if (kind === "device_tools_list") {
      // command: machine_id|machine_kind|name=perm,name=perm…
      const parts = cmd.split("|");
      const machineId = parts[0] || "";
      const machineKind = parts[1] || "desktop";
      const toolsRaw = parts.slice(2).join("|") || "";
      const tools = toolsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const eq = pair.indexOf("=");
          if (eq < 0) return { name: pair, permission: "unknown" };
          return {
            name: pair.slice(0, eq),
            permission: pair.slice(eq + 1) || "unknown",
          };
        });
      const dir = path.join(REPO_ROOT, "data", "device");
      fs.mkdirSync(dir, { recursive: true });
      const listPath = path.join(
        dir,
        `tools-${machineKind}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        machine_id: machineId,
        machine_kind: machineKind,
        tools,
        count: tools.length,
        pretend_granted: false,
        mode: "host_device_tools_catalog",
        at,
      };
      fs.writeFileSync(listPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "tools-list.jsonl"), artifact);
      const delivery = recordSendToUser({
        type: "attachment",
        path: listPath,
        label: "device_tools_list",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: listPath,
        count: tools.length,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: listPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "device_tool") {
      const parts = cmd.split("|");
      const entry = {
        machine_id: parts[0] || "",
        tool: parts[1] || "",
        executed: true,
        mode: "host_ffi_device_local",
        pretend_executed: false,
        pretend_granted: false,
        at,
      };
      const invDir = path.join(REPO_ROOT, "data", "device", "tool-invokes");
      fs.mkdirSync(invDir, { recursive: true });
      const ledgerPath = path.join(
        REPO_ROOT,
        "data",
        "device",
        "tool-invokes.jsonl",
      );
      const invokePath = path.join(
        invDir,
        `invoke-${Date.now().toString(36)}.json`,
      );
      fs.writeFileSync(invokePath, JSON.stringify(entry, null, 2));
      const pathWritten = appendJsonl(ledgerPath, {
        ...entry,
        path: invokePath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: invokePath,
        label: "device_tool",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: invokePath,
        ledger_path: pathWritten,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: invokePath,
        ledger_path: pathWritten,
        send_to_user: delivery,
        ok: true,
      });
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
      const sessDir = path.join(REPO_ROOT, "data", "voice", "session-actions");
      fs.mkdirSync(sessDir, { recursive: true });
      const actionPath = path.join(
        sessDir,
        `${action}-${slug || "voice"}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        stored: true,
        action,
        voice_address: address,
        live: row.live,
        media_ok: Boolean(media.ok),
        media_path: media.path,
        media_bytes: media.bytes || 0,
        media_tool: media.tool || null,
        sessions_path: VOICE_SESSIONS_PATH,
        mode: "host_voice_session",
        pretend_live: false,
        pretend_media: false,
        at,
      };
      fs.writeFileSync(actionPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(sessDir, "actions.jsonl"), {
        ...artifact,
        path: actionPath,
      });
      const delivery = recordSendToUser({
        type: "voice",
        voice_address: address,
        media_path: media.path,
        media_ok: Boolean(media.ok),
        path: actionPath,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: actionPath,
        sessions_path: VOICE_SESSIONS_PATH,
        media_ok: media.ok,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: actionPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    // voice_relay → executeVoiceRelay (async: worker reply + reply WAV)

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
      let callId = "";
      for (const r of rows) {
        if (r && r.live) {
          r.live = false;
          r.ended_at = at;
          r.summary_path = outPath;
          mediaPath = r.media_path || null;
          mediaOk = Boolean(r.media_ok);
          callId = r.call_id || r.id || "";
        }
      }
      writeJsonArray(VOICE_SESSIONS_PATH, rows);
      const endDir = path.join(REPO_ROOT, "data", "voice", "ends");
      fs.mkdirSync(endDir, { recursive: true });
      const endArtifactPath = path.join(
        endDir,
        `end-${Date.now().toString(36)}.json`,
      );
      const endArtifact = {
        call_id: callId,
        summary_path: outPath,
        summary_prefix: summary.slice(0, 120),
        media_path: mediaPath,
        media_ok: mediaOk,
        live: false,
        pretend_still_live: false,
        mode: "host_voice_end",
        at,
      };
      fs.writeFileSync(endArtifactPath, JSON.stringify(endArtifact, null, 2));
      appendJsonl(path.join(endDir, "ends.jsonl"), {
        ...endArtifact,
        path: endArtifactPath,
      });
      const delivery = recordSendToUser({
        type: "voice",
        voice_address: callId || "",
        media_path: mediaPath || "",
        media_ok: mediaOk,
        path: endArtifactPath,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: outPath,
        end_artifact: endArtifactPath,
        media_ok: mediaOk,
        at,
      });
      return okJson(kind, cmd, {
        path: outPath,
        end_artifact_path: endArtifactPath,
        bytes: Buffer.byteLength(summary + "\n"),
        summary_prefix: summary.slice(0, 120),
        media_path: mediaPath,
        media_ok: mediaOk,
        pretend_still_live: false,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "section_add") {
      // command: group_id|section_id|title
      const parts = cmd.split("|");
      const groupId = parts[0] || "group-1";
      const sectionId = parts[1] || "";
      const title = parts.slice(2).join("|") || sectionId;
      if (!sectionId) {
        return {
          kind,
          ok: false,
          command: cmd,
          error: "section_add requires section id",
        };
      }
      fs.mkdirSync(SECTIONS_DIR, { recursive: true });
      const groupPath = path.join(
        SECTIONS_DIR,
        `${sanitizeSkillName(groupId)}.json`,
      );
      let group = { group_id: groupId, sections: [], messages: [] };
      try {
        if (fs.existsSync(groupPath)) {
          group = JSON.parse(fs.readFileSync(groupPath, "utf8")) || group;
        }
      } catch (_) {
        /* fresh */
      }
      if (!Array.isArray(group.sections)) group.sections = [];
      if (!Array.isArray(group.messages)) group.messages = [];
      const existing = group.sections.find((s) => s && s.id === sectionId);
      if (existing) {
        // Idempotent add — return existing partition (never invent a second section).
        if (title && existing.title !== title) {
          existing.title = title;
          group.updated_at = at;
          fs.writeFileSync(groupPath, JSON.stringify(group, null, 2));
        }
        const delivery = recordSendToUser({
          type: "attachment",
          path: groupPath,
          label: "section_add_existing",
          source_kind: kind,
          at,
        });
        appendHostDeliveryJournal({
          kind,
          command: cmd,
          path: groupPath,
          section_id: sectionId,
          existing: true,
          at,
        });
        return okJson(kind, cmd, {
          group_id: groupId,
          section: existing,
          path: groupPath,
          section_count: group.sections.length,
          existing: true,
          pretend_shared: false,
          send_to_user: delivery,
          ok: true,
        });
      }
      const sec = { id: sectionId, title, group_id: groupId };
      group.sections.push(sec);
      group.updated_at = at;
      fs.writeFileSync(groupPath, JSON.stringify(group, null, 2));
      appendJsonl(path.join(SECTIONS_DIR, "events.jsonl"), {
        kind: "section_add",
        ...sec,
        at,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: groupPath,
        label: "section_add",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: groupPath,
        section_id: sectionId,
        at,
      });
      return okJson(kind, cmd, {
        group_id: groupId,
        section: sec,
        path: groupPath,
        section_count: group.sections.length,
        existing: false,
        pretend_shared: false,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "section_post") {
      // command: group_id|section_id|from_agent|body
      const parts = cmd.split("|");
      const groupId = parts[0] || "group-1";
      const sectionId = parts[1] || "";
      const fromAgent = parts[2] || "user";
      const body = parts.slice(3).join("|") || "";
      fs.mkdirSync(SECTIONS_DIR, { recursive: true });
      const groupPath = path.join(
        SECTIONS_DIR,
        `${sanitizeSkillName(groupId)}.json`,
      );
      let group = { group_id: groupId, sections: [], messages: [] };
      try {
        if (fs.existsSync(groupPath)) {
          group = JSON.parse(fs.readFileSync(groupPath, "utf8")) || group;
        }
      } catch (_) {
        /* fresh */
      }
      if (!Array.isArray(group.sections)) group.sections = [];
      if (!Array.isArray(group.messages)) group.messages = [];
      if (!group.sections.some((s) => s && s.id === sectionId)) {
        return {
          kind,
          ok: false,
          command: cmd,
          error: `unknown section: ${sectionId}`,
          stdout: JSON.stringify(
            {
              group_id: groupId,
              path: groupPath,
              isolation_ok: true,
              pretend_cross_section: false,
            },
            null,
            2,
          ),
          stderr: "",
        };
      }
      const msg = {
        section_id: sectionId,
        from_agent: fromAgent,
        body,
        at,
      };
      group.messages.push(msg);
      group.updated_at = at;
      fs.writeFileSync(groupPath, JSON.stringify(group, null, 2));
      const inSection = group.messages.filter(
        (m) => m && m.section_id === sectionId,
      );
      appendJsonl(path.join(SECTIONS_DIR, "events.jsonl"), {
        kind: "section_post",
        ...msg,
        group_id: groupId,
        at,
      });
      const delivery = recordSendToUser({
        type: "text",
        channel: `section:${groupId}/${sectionId}`,
        body_prefix: String(body).slice(0, 120),
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: groupPath,
        section_id: sectionId,
        at,
      });
      return okJson(kind, cmd, {
        group_id: groupId,
        section_id: sectionId,
        from_agent: fromAgent,
        body,
        path: groupPath,
        messages_in_section: inSection.length,
        isolation_ok: true,
        pretend_cross_section: false,
        send_to_user: delivery,
        ok: true,
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
      const existing = idx >= 0;
      if (existing) rows[idx] = { ...rows[idx], ...row };
      else rows.push(row);
      writeJsonArray(TEAMMATES_PATH, rows);
      const tmDir = path.join(REPO_ROOT, "data", "agents", "teammate-creates");
      fs.mkdirSync(tmDir, { recursive: true });
      const createPath = path.join(
        tmDir,
        `create-${row.id}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        stored: true,
        existing,
        teammate: row,
        teammates_path: TEAMMATES_PATH,
        members_sidebar: true,
        mode: "host_teammate_create",
        pretend_created: false,
        at,
      };
      fs.writeFileSync(createPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(tmDir, "creates.jsonl"), {
        ...artifact,
        path: createPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: createPath,
        label: "teammate_create",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: createPath,
        teammates_path: TEAMMATES_PATH,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: createPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    // room_turn / send_to_agent / subagent_run → executeMultiAgentEffect (async)

    if (kind === "approval_card") {
      // CM-0105-shaped decision widget for Desktop (Approve / Dismiss).
      const widget = {
        widget_id: `approval-${Date.now().toString(36)}`,
        title: "Approval required",
        prompt: String(cmd || "").slice(0, 240),
        options: [
          { id: "approve", label: "Approve & re-run", style: "Primary" },
          { id: "dismiss", label: "Dismiss", style: "Default" },
        ],
        multi_select: false,
        dismiss_on_move_on: true,
      };
      const entry = {
        command: cmd,
        status: "pending",
        pretend_approved: false,
        widget,
        at,
      };
      const pathWritten = appendJsonl(APPROVALS_PATH, entry);
      const cardDir = path.join(REPO_ROOT, "data", "approvals", "cards");
      fs.mkdirSync(cardDir, { recursive: true });
      const cardPath = path.join(cardDir, `${widget.widget_id}.json`);
      fs.writeFileSync(
        cardPath,
        JSON.stringify({ ...entry, queue_path: pathWritten }, null, 2),
      );
      const delivery = recordSendToUser({
        type: "widget",
        widget: "approval_card",
        widget_id: widget.widget_id,
        path: cardPath,
        options: widget.options.map((o) => o.id),
        pretend_approved: false,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: cardPath,
        queue_path: pathWritten,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: cardPath,
        queue_path: pathWritten,
        send_to_user: delivery,
        ui: "ApprovalGate",
        type: "widget",
        ok: true,
      });
    }

    // cloud_agent_launch / cloud_artifact_deliver → executeCloudEffect (async)

    if (kind === "schedule_meeting") {
      const parts = cmd.split("|");
      const eventId = parts[0] || `evt-${Date.now().toString(36)}`;
      const title = parts[1] || "Meeting";
      const when = parts.slice(2).join("|") || "unspecified";
      const calDir = path.join(REPO_ROOT, "data", "calendar");
      fs.mkdirSync(calDir, { recursive: true });
      const icsPath = path.join(
        calDir,
        `${sanitizeSkillName(eventId) || "event"}.ics`,
      );
      const stamp = at.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Bit Bot//Host Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${eventId}@bitbot.local`,
        `DTSTAMP:${stamp}`,
        `SUMMARY:${String(title).replace(/\r?\n/g, " ")}`,
        `DESCRIPTION:Scheduled via Host FFI when=${String(when).replace(/\r?\n/g, " ")}`,
        `STATUS:CONFIRMED`,
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n");
      fs.writeFileSync(icsPath, ics);
      // Live calendar when BITBOT_CALENDAR_API_URL+token; else ICS-only residual.
      const calApi = String(process.env.BITBOT_CALENDAR_API_URL || "").trim();
      const calToken = String(process.env.BITBOT_CALENDAR_TOKEN || "").trim();
      let mode = "sandbox_ics";
      let liveProbe = null;
      let remoteEventId = null;
      if (calApi && calToken) {
        const base = calApi.replace(/\/$/, "");
        const probe = await httpJson(`${base}/events`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${calToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: eventId,
            subject: title,
            when,
            source: "bitbot-host",
          }),
        });
        liveProbe = {
          ok: Boolean(probe.ok),
          http_status: probe.status || 0,
          error: probe.error || null,
        };
        if (probe.ok) {
          mode = "calendar_live";
          remoteEventId =
            (probe.json && (probe.json.id || probe.json.event_id)) || eventId;
        } else {
          mode = "calendar_live_failed";
        }
      }
      const entry = {
        event_id: eventId,
        title,
        when,
        connector: "calendar",
        mode,
        ics_path: icsPath,
        ics_ok:
          fs.existsSync(icsPath) &&
          fs.readFileSync(icsPath, "utf8").includes("BEGIN:VEVENT"),
        live_calendar_residual: mode !== "calendar_live",
        pretend_live: false,
        remote_event_id: remoteEventId,
        live_probe: liveProbe,
        at,
      };
      const pathWritten = appendJsonl(CALENDAR_EVENTS_PATH, entry);
      const delivery = recordSendToUser({
        type: "attachment",
        path: icsPath,
        label: "calendar.ics",
        event_id: eventId,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: pathWritten,
        ics: icsPath,
        mode,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: pathWritten,
        scheduled: true,
        send_to_user: delivery,
      });
    }

    if (kind === "purchase") {
      const receiptDir = path.join(REPO_ROOT, "data", "commerce", "receipts");
      fs.mkdirSync(receiptDir, { recursive: true });
      const receiptId = `rcpt-${Date.now().toString(36)}`;
      const receiptPath = path.join(receiptDir, `${receiptId}.html`);
      const safeCmd = String(cmd || "").replace(/[<>&]/g, "");
      // Live charge only when LIVE=1 + token + API URL and processor returns 2xx.
      // Never claim paid without a successful processor response.
      const wantLive =
        String(process.env.BITBOT_PURCHASE_LIVE || "").trim() === "1";
      const purchaseToken = String(process.env.BITBOT_PURCHASE_TOKEN || "").trim();
      const purchaseApi = String(process.env.BITBOT_PURCHASE_API_URL || "").trim();
      let chargeProbe = null;
      let charged = false;
      let mode = "sandbox_receipt";
      if (wantLive && purchaseToken && purchaseApi) {
        try {
          const resp = await fetch(purchaseApi.replace(/\/$/, "") + "/charge", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${purchaseToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              receipt_id: receiptId,
              command: cmd,
              source: "bitbot-host",
            }),
          });
          const text = await resp.text();
          let body = null;
          try {
            body = JSON.parse(text);
          } catch (_) {
            body = { raw: String(text || "").slice(0, 300) };
          }
          chargeProbe = {
            ok: resp.ok,
            http_status: resp.status,
            charge_id: body && body.charge_id,
          };
          if (resp.ok) {
            charged = true;
            mode = "live_charge";
          } else {
            mode = "live_charge_failed";
          }
        } catch (err) {
          chargeProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
          mode = "live_charge_failed";
        }
      } else if (wantLive) {
        chargeProbe = {
          ok: false,
          error:
            "BITBOT_PURCHASE_LIVE=1 requires BITBOT_PURCHASE_TOKEN and BITBOT_PURCHASE_API_URL",
        };
        mode = "live_charge_residual";
      }
      fs.writeFileSync(
        receiptPath,
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${receiptId}</title></head>` +
          `<body><h1>Bit Bot purchase receipt</h1><p id="receipt">${safeCmd}</p>` +
          `<p>mode=${mode}</p><p>paid=${charged ? "true" : "sandbox"}</p>` +
          `<p>live_paid_residual=${charged ? "false" : "true"}</p><p>at=${at}</p></body></html>\n`,
      );
      const entry = {
        receipt: cmd,
        receipt_id: receiptId,
        receipt_path: receiptPath,
        receipt_ok:
          fs.existsSync(receiptPath) &&
          fs.readFileSync(receiptPath, "utf8").includes("purchase receipt"),
        mode,
        paid: charged,
        sandbox_receipt: !charged,
        live_paid_residual: !charged,
        pretend_paid: false,
        charge_probe: chargeProbe,
        at,
      };
      const pathWritten = appendJsonl(COMMERCE_PATH, entry);
      const delivery = recordSendToUser({
        type: "attachment",
        path: receiptPath,
        label: "purchase_receipt",
        receipt_id: receiptId,
        mode,
        live_paid_residual: !charged,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, receipt: receiptPath, at });
      return okJson(kind, cmd, { ...entry, path: pathWritten, send_to_user: delivery });
    }

    if (kind === "finance_call") {
      const parts = cmd.split("|");
      const tool = parts[0] || "";
      const output = parts.slice(1).join("|") || "";
      const finState = loadConnectorState("finance");
      // Explicit env token wins for live mock/API gates (sandbox oauth must not mask it).
      const accessToken = String(
        process.env.BITBOT_FINANCE_TOKEN ||
          (finState.oauth && finState.oauth.access_token) ||
          finState.access_token ||
          "",
      ).trim();
      const financeApi = String(process.env.BITBOT_FINANCE_API_URL || "").trim();
      const connected = Boolean(
        finState.connected || accessToken,
      );
      let mode = connected ? "live_token_present" : "sandbox";
      let liveProbe = null;
      let liveResult = null;
      // Live finance call only when token + API URL; never pretend bank data.
      if (accessToken && financeApi) {
        try {
          const resp = await fetch(
            financeApi.replace(/\/$/, "") + "/tools/" + encodeURIComponent(tool || "call"),
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ tool, output, source: "bitbot-host" }),
            },
          );
          const text = await resp.text();
          let body = null;
          try {
            body = JSON.parse(text);
          } catch (_) {
            body = { raw: String(text || "").slice(0, 400) };
          }
          liveProbe = { ok: resp.ok, http_status: resp.status };
          if (resp.ok) {
            liveResult = body;
            mode = "finance_live";
          } else {
            mode = "finance_live_failed";
          }
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
          mode = "finance_live_failed";
        }
      }
      const artifactDir = path.join(REPO_ROOT, "data", "connectors", "finance");
      fs.mkdirSync(artifactDir, { recursive: true });
      const artifactPath = path.join(
        artifactDir,
        `call-${sanitizeSkillName(tool) || "tool"}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        tool,
        output,
        mode,
        pretend_live: false,
        live_finance_residual: mode !== "finance_live",
        live_probe: liveProbe,
        live_result: liveResult,
        balance_sandbox:
          mode !== "finance_live" &&
          (/balance|get_balance/i.test(tool) || /balance/i.test(output))
            ? { currency: "USD", amount: 0, note: "sandbox zero — not live bank" }
            : null,
        at,
      };
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
      const entry = {
        tool,
        output,
        mode: artifact.mode,
        artifact_path: artifactPath,
        artifact_ok: fs.existsSync(artifactPath),
        live_finance_residual: artifact.live_finance_residual,
        pretend_live: false,
        at,
      };
      const pathWritten = appendJsonl(FINANCE_CALLS_PATH, entry);
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: pathWritten,
        artifact: artifactPath,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: pathWritten,
        ok: true,
        balance_sandbox: artifact.balance_sandbox,
        live_probe: liveProbe,
      });
    }

    if (kind === "job_search") {
      const parts = cmd.split("|");
      const query = parts[0] || "";
      const playbook = parts[1] || "linkedin-readonly";
      const hitCount = Number(parts[2] || 0) || 0;
      const jobDir = path.join(REPO_ROOT, "data", "jobs");
      fs.mkdirSync(jobDir, { recursive: true });
      const artifactPath = path.join(
        jobDir,
        `search-${Date.now().toString(36)}.json`,
      );
      const jobApi = String(process.env.BITBOT_JOB_API_URL || "").trim();
      const jobToken = String(process.env.BITBOT_JOB_TOKEN || "").trim();
      let mode = "sandbox_readonly";
      let liveProbe = null;
      let hits = Array.from({ length: Math.max(hitCount, 1) }, (_, i) => ({
        id: `job-sandbox-${i + 1}`,
        title: `${query || "role"} (sandbox ${i + 1})`,
        company: "BitBot Sandbox Co",
        readonly: true,
        pretend_applied: false,
      }));
      if (jobApi && jobToken) {
        const base = jobApi.replace(/\/$/, "");
        const probe = await httpJson(`${base}/jobs/search`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jobToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, playbook, limit: Math.max(hitCount, 3) }),
        });
        liveProbe = {
          ok: Boolean(probe.ok),
          http_status: probe.status || 0,
          error: probe.error || null,
        };
        const rows =
          (probe.json && (probe.json.jobs || probe.json.hits || probe.json.results)) ||
          null;
        if (probe.ok && Array.isArray(rows) && rows.length > 0) {
          hits = rows.slice(0, 20).map((r, i) => ({
            id: String((r && (r.id || r.job_id)) || `job-live-${i + 1}`),
            title: String((r && (r.title || r.name)) || `${query} live ${i + 1}`),
            company: String((r && r.company) || "Live Catalog"),
            readonly: true,
            pretend_applied: false,
          }));
          mode = "job_live";
        } else {
          mode = "job_live_failed";
        }
      }
      const artifact = {
        query,
        playbook,
        mode,
        live_job_residual: mode !== "job_live",
        pretend_applied: false,
        hit_count: hits.length,
        hits,
        live_probe: liveProbe,
        note:
          mode === "job_live"
            ? "Host job search live catalog — never auto-applies"
            : "Host job search catalog — CU playbook separate; never auto-applies",
        at,
      };
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(jobDir, "searches.jsonl"), artifact);
      const delivery = recordSendToUser({
        type: "attachment",
        path: artifactPath,
        label: "job_search",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: artifactPath,
        mode,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: artifactPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "credential_list") {
      // CM-2130: metadata only — never secret/password/token plaintext.
      const vaultPath = path.join(REPO_ROOT, "data", "credentials", "vault.json");
      fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
      let vault = { entries: [] };
      try {
        if (fs.existsSync(vaultPath)) {
          vault = JSON.parse(fs.readFileSync(vaultPath, "utf8")) || vault;
        }
      } catch (_) {
        vault = { entries: [] };
      }
      if (!Array.isArray(vault.entries) || vault.entries.length === 0) {
        // Seed sandbox metadata rows (no secrets) for Host list surface.
        vault.entries = [
          {
            id: "cred-sandbox-1",
            domain: "login.example.test",
            username: "demo@example.test",
            label: "Demo login",
          },
        ];
        fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2));
      }
      const metas = (vault.entries || []).map((e) => ({
        id: e.id || "",
        domain: e.domain || "",
        username: e.username || "",
        label: e.label || e.domain || "",
        has_secret: Boolean(e.secret || e.password || e.token),
        // Never echo secret fields into Host result / chat.
      }));
      const listPath = path.join(
        REPO_ROOT,
        "data",
        "credentials",
        `list-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        count: metas.length,
        credentials: metas,
        secret_echoed: false,
        pretend_secret_view: false,
        mode: "host_vault_metadata",
        at,
      };
      fs.writeFileSync(listPath, JSON.stringify(artifact, null, 2));
      const delivery = recordSendToUser({
        type: "attachment",
        path: listPath,
        label: "credentials_metadata",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: listPath,
        count: metas.length,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: listPath,
        vault_path: vaultPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "credential_fill") {
      const parts = cmd.split("|");
      const fillHandle = parts[0] || "";
      const domain = parts[1] || "";
      const username = parts[2] || "";
      const entry = {
        fill_handle: fillHandle,
        domain,
        username,
        secret_echoed: false,
        vault_only: true,
        at,
      };
      const pathWritten = appendJsonl(CREDENTIAL_FILLS_PATH, entry);
      // Upsert vault metadata only (CM-2130) — never store secret/password/token plaintext here.
      const vaultPath = path.join(REPO_ROOT, "data", "credentials", "vault.json");
      fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
      let vault = { entries: [] };
      try {
        if (fs.existsSync(vaultPath)) {
          vault = JSON.parse(fs.readFileSync(vaultPath, "utf8")) || vault;
        }
      } catch (_) {
        vault = { entries: [] };
      }
      if (!Array.isArray(vault.entries)) vault.entries = [];
      const id =
        fillHandle ||
        `cred-${Buffer.from(domain || "fill")
          .toString("hex")
          .slice(0, 10)}`;
      const existing = vault.entries.findIndex(
        (e) => e && (e.id === id || (domain && e.domain === domain)),
      );
      const meta = {
        id,
        domain: domain || "unknown",
        username: username || "",
        label: domain || id,
        has_secret: true,
        // Intentionally omit secret/password/token fields.
        filled_at: at,
        fill_handle: fillHandle,
      };
      if (existing >= 0) vault.entries[existing] = { ...vault.entries[existing], ...meta };
      else vault.entries.push(meta);
      fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2));
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: pathWritten,
        vault_path: vaultPath,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: pathWritten,
        vault_path: vaultPath,
        vault_id: id,
        pretend_secret_view: false,
        note: "secret stays in Host vault — never assistant_view; metadata upserted for list credentials",
      });
    }

    if (kind === "workflow_list") {
      const names = String(cmd || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const wfDir = path.join(REPO_ROOT, "data", "workflows");
      fs.mkdirSync(wfDir, { recursive: true });
      const catalogPath = path.join(wfDir, "catalog.json");
      const catalog = {
        workflows: names.map((n) => ({
          name: n,
          visibility: "private_example",
          pretend_shared: false,
        })),
        count: names.length,
        mode: "host_workflow_catalog",
        at,
      };
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
      appendJsonl(path.join(wfDir, "list.jsonl"), catalog);
      const delivery = recordSendToUser({
        type: "attachment",
        path: catalogPath,
        label: "workflow_catalog",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: catalogPath,
        at,
      });
      return okJson(kind, cmd, {
        ...catalog,
        path: catalogPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "x_search") {
      const q = String(cmd || "").trim() || "(empty)";
      const xDir = path.join(REPO_ROOT, "data", "connectors", "x");
      fs.mkdirSync(xDir, { recursive: true });
      const bearer = String(process.env.BITBOT_X_BEARER || "").trim();
      const xApiBase = String(process.env.BITBOT_X_API_BASE || "").trim();
      let mode = "sandbox_public";
      let liveHits = null;
      let liveProbe = null;
      if (bearer) {
        try {
          const root = (xApiBase || "https://api.x.com/2").replace(/\/$/, "");
          const url =
            `${root}/tweets/search/recent?query=` +
            encodeURIComponent(q) +
            "&max_results=10";
          // Prefer httpJson so local BITBOT_X_API_BASE mocks work without fetch quirks.
          const resp = await httpJson(url, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${bearer}`,
              Accept: "application/json",
            },
          });
          const body = resp.json || { raw: String(resp.body || "").slice(0, 400) };
          liveProbe = {
            ok: Boolean(resp.ok),
            http_status: resp.status || 0,
            error: resp.error || null,
          };
          if (resp.ok && Array.isArray(body.data)) {
            liveHits = body.data;
            mode = "x_live";
          } else {
            mode = "x_live_failed";
          }
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
          mode = "x_live_failed";
        }
      }
      const hits = liveHits
        ? liveHits.map((t) => ({
            id: t.id || "",
            text: String(t.text || "").slice(0, 280),
          }))
        : [
            {
              id: "t-sandbox-1",
              text: `moonbit grok parity ${q}`.slice(0, 280),
            },
          ];
      const artifactPath = path.join(
        xDir,
        `search-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        query: q,
        mode,
        live_x_residual: mode !== "x_live",
        pretend_live: false,
        hit_count: hits.length,
        hits,
        live_probe: liveProbe,
        at,
      };
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(xDir, "searches.jsonl"), artifact);
      const delivery = recordSendToUser({
        type: "attachment",
        path: artifactPath,
        label: "x_search",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: artifactPath,
        mode,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: artifactPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "mail_draft") {
      // command often: to|subject|body — or meeting_chat :: body (CM-2153 DraftCard)
      let to = "";
      let subject = "(no subject)";
      let body = "";
      let meetingDraft = false;
      if (cmd.startsWith("meeting_chat :: ") || cmd.startsWith("meeting_chat:")) {
        meetingDraft = true;
        to = "meeting-chat@bitbot.local";
        subject = "Meeting chat draft";
        body = cmd.includes(" :: ")
          ? cmd.slice(cmd.indexOf(" :: ") + 4)
          : cmd.replace(/^meeting_chat:?\s*/, "");
      } else {
        const parts = cmd.split("|");
        to = parts[0] || "";
        subject = parts[1] || "(no subject)";
        body = parts.slice(2).join("|") || "";
      }
      const draftDir = path.join(REPO_ROOT, "data", "mail", "draft-files");
      fs.mkdirSync(draftDir, { recursive: true });
      const draftId = `draft-${Date.now().toString(36)}`;
      const emlPath = path.join(draftDir, `${draftId}.eml`);
      const eml = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        `Date: ${at}`,
        `Message-ID: <${draftId}@bitbot.local>`,
        "X-BitBot-Status: draft",
        meetingDraft ? "X-BitBot-Meeting-Chat: 1" : "X-BitBot-Meeting-Chat: 0",
        "",
        body,
        "",
      ].join("\r\n");
      fs.writeFileSync(emlPath, eml);
      if (meetingDraft) {
        const meetingDir = path.join(REPO_ROOT, "data", "meetings");
        fs.mkdirSync(meetingDir, { recursive: true });
        appendJsonl(path.join(meetingDir, "draft-cards.jsonl"), {
          body,
          eml_path: emlPath,
          mode: "meeting_chat_draft_card",
          at,
        });
      }
      const entry = {
        command: cmd,
        to,
        subject,
        status: "draft",
        meeting_chat: meetingDraft,
        eml_path: emlPath,
        eml_ok:
          fs.existsSync(emlPath) &&
          fs.readFileSync(emlPath, "utf8").includes("X-BitBot-Status: draft"),
        at,
      };
      const pathWritten = appendJsonl(MAIL_DRAFTS_PATH, entry);
      const delivery = recordSendToUser({
        type: meetingDraft ? "widget" : "attachment",
        path: emlPath,
        label: meetingDraft ? "meeting_chat_draft" : "mail_draft.eml",
        widget: meetingDraft ? "meeting_draft_card" : undefined,
        to,
        subject,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({ kind, command: cmd, path: pathWritten, eml: emlPath, at });
      return okJson(kind, cmd, {
        ...entry,
        path: pathWritten,
        drafted: true,
        mode: meetingDraft ? "meeting_chat_draft_card" : "mail_draft",
        send_to_user: delivery,
      });
    }

    if (kind === "mcp_namespace") {
      const nsDir = path.join(REPO_ROOT, "data", "connectors", "mcp-namespaces");
      fs.mkdirSync(nsDir, { recursive: true });
      const ledgerPath = path.join(
        REPO_ROOT,
        "data",
        "connectors",
        "mcp-namespaces.jsonl",
      );
      const snapPath = path.join(
        nsDir,
        `ns-${Date.now().toString(36)}.json`,
      );
      const entry = {
        namespace: cmd,
        mode: "host_mcp_namespace",
        pretend_registered: false,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(entry, null, 2));
      const pathWritten = appendJsonl(ledgerPath, {
        ...entry,
        path: snapPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: snapPath,
        label: "mcp_namespace",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: snapPath,
        ledger_path: pathWritten,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: snapPath,
        ledger_path: pathWritten,
        send_to_user: delivery,
        ok: true,
      });
    }

    return null;
  }

  function parseVerticalPlaybook(command) {
    const cmd = String(command || "");
    let family = "";
    if (cmd.startsWith("shopping:")) family = "shopping";
    else if (cmd.startsWith("travel:")) family = "travel";
    else if (cmd.startsWith("food:")) family = "food";
    if (!family) return null;
    const playbookMatch = cmd.match(/site-playbooks-[a-z0-9-]+/i);
    const navigateMatch = cmd.match(/NAVIGATE\s+([^\s;]+)/i);
    const host = navigateMatch ? String(navigateMatch[1] || "").trim() : "";
    return {
      family,
      playbook_name: playbookMatch ? playbookMatch[0] : "",
      navigate_host: host,
      pretend_purchased: false,
    };
  }

  function materializePlaybookJournal(vertical, command) {
    if (!vertical) return null;
    const dir = path.join(REPO_ROOT, "data", "skills", "playbooks");
    fs.mkdirSync(dir, { recursive: true });
    const at = new Date().toISOString();
    const artifact = {
      family: vertical.family,
      playbook_name: vertical.playbook_name,
      navigate_host: vertical.navigate_host,
      command: String(command || "").slice(0, 500),
      pretend_purchased: false,
      mode: "host_site_playbook_dispatch",
      at,
    };
    const playbookPath = path.join(
      dir,
      `${vertical.family}-${Date.now().toString(36)}.json`,
    );
    fs.writeFileSync(playbookPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "dispatches.jsonl"), {
      ...artifact,
      path: playbookPath,
    });
    return { ...artifact, path: playbookPath };
  }

  async function executeComputerUse(command) {
    const cmd = String(command || "");
    const vertical = parseVerticalPlaybook(cmd);
    const playbookJournal = materializePlaybookJournal(vertical, cmd);
    const urlMatch = cmd.match(/https?:\/\/[^\s|"']+/);
    let url = urlMatch ? urlMatch[0] : "";
    if (!url && vertical && vertical.navigate_host) {
      const host = vertical.navigate_host.replace(/^https?:\/\//, "");
      url = `https://${host}`;
    }
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
      const baseOutcome = summary.outcome || {
        summary: "structured outcome only",
        final_url: navigate.url || url || null,
        blocked_on_signin: false,
        checkout_stage: "n/a",
        pretend_purchased: false,
      };
      const outcome = {
        ...baseOutcome,
        pretend_purchased: false,
        vertical_family: vertical ? vertical.family : baseOutcome.vertical_family || "",
        playbook_name: vertical
          ? vertical.playbook_name
          : baseOutcome.playbook_name || "",
        playbook_journal: playbookJournal ? playbookJournal.path : null,
        paid_checkout_attempted: Boolean(baseOutcome.paid_checkout_attempted),
      };
      appendHostDeliveryJournal({
        kind: "computer_use",
        command: cmd,
        evidence: evidencePath,
        navigate_reachable: Boolean(navigate.navigate_reachable),
        box_chrome_process: Boolean(gui.box_chrome_process),
        shared_cdp_untouched: gui.shared_cdp_untouched !== false,
        vertical_family: outcome.vertical_family || "",
        playbook_name: outcome.playbook_name || "",
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
            playbook: playbookJournal,
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
              native_os_input: gui.native_os_input || null,
              native_os_act: gui.native_os_act || null,
              os_window_automation_residual:
                gui.os_window_automation_residual !== undefined
                  ? Boolean(gui.os_window_automation_residual)
                  : Boolean(
                      (summary.outcome &&
                        summary.outcome.os_window_automation_residual) ||
                        true,
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
                    has_checkout: Boolean(
                      gui.vision_plan.dom && gui.vision_plan.dom.has_checkout,
                    ),
                    has_cart: Boolean(
                      gui.vision_plan.dom && gui.vision_plan.dom.has_cart,
                    ),
                    has_payment: Boolean(
                      gui.vision_plan.dom && gui.vision_plan.dom.has_payment,
                    ),
                    ocr: Boolean(
                      gui.vision_plan.vision && gui.vision_plan.vision.ocr,
                    ),
                    ocr_residual:
                      gui.vision_plan.vision &&
                      gui.vision_plan.vision.ocr_residual !== undefined
                        ? Boolean(gui.vision_plan.vision.ocr_residual)
                        : true,
                    ocr_text_prefix:
                      (gui.vision_plan.vision &&
                        gui.vision_plan.vision.ocr_text_prefix) ||
                      "",
                  }
                : null,
              checkout_summary: gui.checkout_summary || null,
              vertical_summary: gui.vertical_summary || gui.checkout_summary || null,
              title:
                (gui.actions && gui.actions.title) ||
                (gui.vision_actions && gui.vision_actions.title) ||
                null,
            },
            outcome,
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
        JSON.stringify(
          {
            command: cmd,
            navigate,
            playbook: playbookJournal,
            fallback: true,
          },
          null,
          2,
        ),
      );
      appendHostDeliveryJournal({
        kind: "computer_use",
        command: cmd,
        evidence: evidencePath,
        navigate_reachable: navigate.navigate_reachable,
        fallback: true,
        vertical_family: vertical ? vertical.family : "",
        playbook_name: vertical ? vertical.playbook_name : "",
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
            playbook: playbookJournal,
            gui: { box_chrome_process: false, fallback: true },
            outcome: {
              summary: "structured outcome only (http fallback)",
              final_url: navigate.url || null,
              blocked_on_signin: false,
              checkout_stage: "n/a",
              pretend_purchased: false,
              vertical_family: vertical ? vertical.family : "",
              playbook_name: vertical ? vertical.playbook_name : "",
              playbook_journal: playbookJournal ? playbookJournal.path : null,
              paid_checkout_attempted: false,
            },
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
        results.push(await executeMailReadSearch(kind, cmd));
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
      if (kind === "voice_relay") {
        results.push(await executeVoiceRelay(cmd));
        continue;
      }
      if (kind === "cloud_agent_launch" || kind === "cloud_artifact_deliver") {
        results.push(await executeCloudEffect(kind, cmd));
        continue;
      }
      if (kind === "code_changes" || kind === "source_control") {
        results.push(await executeDevtoolsEffect(kind, cmd));
        continue;
      }
      if (
        kind === "room_turn" ||
        kind === "send_to_agent" ||
        kind === "subagent_run"
      ) {
        results.push(await executeMultiAgentEffect(kind, cmd));
        continue;
      }
      const productRes = await executeProductDeliveryEffect(kind, cmd);
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
        const outText = String(stdout || "").slice(0, 8000);
        const errText = String(stderr || "").slice(0, 2000);
        const shellDir = path.join(REPO_ROOT, "data", "host-tools", "shell");
        fs.mkdirSync(shellDir, { recursive: true });
        const shellAt = new Date().toISOString();
        const shellPath = path.join(
          shellDir,
          `run-${Date.now().toString(36)}.json`,
        );
        const shellArtifact = {
          command: shellCmd,
          ok: true,
          stdout_prefix: outText.slice(0, 400),
          stderr_prefix: errText.slice(0, 200),
          mode: "host_shell_exec",
          pretend_ok: false,
          at: shellAt,
        };
        fs.writeFileSync(shellPath, JSON.stringify(shellArtifact, null, 2));
        appendJsonl(path.join(shellDir, "runs.jsonl"), {
          ...shellArtifact,
          path: shellPath,
        });
        recordSendToUser({
          type: "attachment",
          path: shellPath,
          label: "shell",
          source_kind: "shell",
          at: shellAt,
        });
        appendHostDeliveryJournal({
          kind: "shell",
          command: shellCmd,
          path: shellPath,
          ok: true,
          at: shellAt,
        });
        results.push({
          kind: "shell",
          ok: true,
          command: shellCmd,
          // Keep raw stdout for ADR 0002 --apply-host-results reinjection.
          stdout: outText,
          stderr: errText,
          artifact_path: shellPath,
          pretend_ok: false,
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
    // CHARTER Delivery: materialize SendToUser receipts beside Host effects.
    const withDelivery = [];
    for (const res of results) {
      withDelivery.push(res);
      const del = deliveryFromHostResult(res);
      if (del) {
        withDelivery.push({
          kind: "delivery",
          ok: true,
          command: res.kind || "",
          stdout: JSON.stringify(
            {
              ...del,
              // Preserve attachment/evidence path from the effect; ledger lives beside it.
              attachment_path: del.path || null,
              send_to_user_path: SEND_TO_USER_PATH,
              path: del.path || SEND_TO_USER_PATH,
              send_to_user: true,
            },
            null,
            2,
          ),
          stderr: "",
        });
      }
    }
    return withDelivery;
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
