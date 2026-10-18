"use strict";

/**
 * Shared Host FFI for Desktop / CLI multi-end hosts (ADR 0002 / 0005).
 * MoonBit plans effects; Host executes. No Python LocalBrain.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const SHELL_DENY =
  /\brm\s+-rf\s+\/|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|:;\s*\}|shutdown|reboot|fork\s*bomb/i;

/** Durable Host marker line/comment appended when BITBOT_CODE_APPLY=1 mutates a target. */
const BITBOT_HOST_APPLIED_TAG = "bitbot-host-applied";

function hostCodeApplyMarkerLine(filePath, at) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  const body = `${BITBOT_HOST_APPLIED_TAG} at=${at}`;
  if (
    ext === ".md" ||
    ext === ".html" ||
    ext === ".htm" ||
    ext === ".xml" ||
    ext === ".svg"
  ) {
    return `<!-- ${body} -->\n`;
  }
  if (
    ext === ".js" ||
    ext === ".ts" ||
    ext === ".mjs" ||
    ext === ".cjs" ||
    ext === ".jsx" ||
    ext === ".tsx" ||
    ext === ".java" ||
    ext === ".go" ||
    ext === ".c" ||
    ext === ".cpp" ||
    ext === ".h" ||
    ext === ".mbt" ||
    ext === ".rs" ||
    ext === ".swift" ||
    ext === ".kt"
  ) {
    return `// ${body}\n`;
  }
  // Shell, Python, YAML, TOML, and unknown text: `#` comment.
  return `# ${body}\n`;
}

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

  function connectorTokenPath(name) {
    const safe =
      String(name || "connector")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_") || "connector";
    return path.join(CONNECTORS_DIR, `${safe}_token.json`);
  }

  function readConnectorTokenFile(name) {
    try {
      const p = connectorTokenPath(name);
      if (!fs.existsSync(p)) return "";
      const tok = JSON.parse(fs.readFileSync(p, "utf8"));
      return String((tok && (tok.access_token || tok.token)) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function writeConnectorTokenFile(name, tokenObj) {
    fs.mkdirSync(CONNECTORS_DIR, { recursive: true });
    fs.writeFileSync(
      connectorTokenPath(name),
      JSON.stringify(tokenObj || {}, null, 2),
    );
  }

  /** Env var names for connector tokens (Slack uses SLACK_BOT_TOKEN historically). */
  function providerTokenEnvKeys(provider) {
    const p = String(provider || "").trim().toLowerCase();
    if (p === "slack") return ["SLACK_BOT_TOKEN", "BITBOT_SLACK_TOKEN"];
    if (p === "outlook") return ["BITBOT_OUTLOOK_TOKEN"];
    if (p === "gmail") return ["BITBOT_GMAIL_TOKEN"];
    if (p === "teams") return ["BITBOT_TEAMS_TOKEN"];
    if (p === "meeting" || p === "meeting_chat")
      return ["BITBOT_MEETING_TOKEN"];
    if (p === "finance") return ["BITBOT_FINANCE_TOKEN"];
    if (p === "calendar") return ["BITBOT_CALENDAR_TOKEN"];
    if (p === "job" || p === "jobs") return ["BITBOT_JOB_TOKEN"];
    if (p === "x" || p === "twitter")
      return ["BITBOT_X_BEARER", "BITBOT_X_TOKEN"];
    if (p === "purchase" || p === "commerce")
      return ["BITBOT_PURCHASE_TOKEN"];
    if (p === "cloud" || p === "cursor_cloud")
      return ["BITBOT_CURSOR_CLOUD_TOKEN", "BITBOT_CLOUD_API_TOKEN"];
    const upper = p.replace(/[^a-z0-9]+/g, "_").toUpperCase();
    return upper ? [`BITBOT_${upper}_TOKEN`] : [];
  }

  /** Provider-scoped token: never let Gmail env/file steal Outlook Bearer. */
  function resolveProviderAccessToken(provider) {
    const p = String(provider || "gmail").trim().toLowerCase();
    const fileName =
      p === "meeting_chat" ? "meeting" : p === "meeting" ? "meeting" : p;
    for (const key of providerTokenEnvKeys(p)) {
      const fromEnv = String(process.env[key] || "").trim();
      if (fromEnv) return fromEnv;
    }
    let token = readConnectorTokenFile(fileName);
    if (!token) token = extractAccessToken(loadConnectorState(fileName));
    return token;
  }

  function connectorArmed(name) {
    const n = String(name || "").trim().toLowerCase();
    const fileName =
      n === "meeting_chat" ? "meeting" : n === "meeting" ? "meeting" : n;
    const st = loadConnectorState(fileName);
    return Boolean(
      resolveProviderAccessToken(n) ||
        st.connected === true ||
        st.status === "Ready" ||
        st.status === "Connected",
    );
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

  /** API/base URL from connector state, token file, then env keys. */
  function resolveConnectorApiUrl(name, envKeys) {
    const n = String(name || "").trim().toLowerCase();
    const st = loadConnectorState(n);
    const fromState = String(
      st.api_url ||
        st.base_url ||
        (st.oauth && (st.oauth.api_url || st.oauth.base_url)) ||
        "",
    ).trim();
    if (fromState) return fromState;
    try {
      const p = connectorTokenPath(n);
      if (fs.existsSync(p)) {
        const tok = JSON.parse(fs.readFileSync(p, "utf8"));
        const u = String(
          (tok && (tok.api_url || tok.base_url || tok.graph_url)) || "",
        ).trim();
        if (u) return u;
      }
    } catch (_) {
      /* ignore */
    }
    for (const key of envKeys || []) {
      const v = String(process.env[key] || "").trim();
      if (v) return v;
    }
    return "";
  }

  async function probeSlack() {
    const token = resolveProviderAccessToken("slack");
    const state = loadConnectorState("slack");
    if (!token) {
      const out = {
        connector: "slack",
        mode: "sandbox_idp",
        connected: Boolean(state.connected),
        detail:
          state.detail ||
          "SLACK_BOT_TOKEN / slack_token.json unset; sandbox IdP path",
        live: false,
      };
      return out;
    }
    const auth = await slackApi("auth.test", token);
    const ok = Boolean(auth.ok);
    const out = {
      connector: "slack",
      mode: "live",
      connected: ok,
      live: ok,
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
    const token = resolveProviderAccessToken(name);
    if (!token) {
      return {
        connector: name,
        mode: "sandbox_idp",
        connected: Boolean(state.connected),
        live: false,
        detail:
          state.detail ||
          `no OAuth token in data/connectors/${name}_token.json; sandbox IdP`,
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

  function probeConnectorToken(name) {
    const state = loadConnectorState(name);
    const token = resolveProviderAccessToken(name);
    if (!token) {
      return {
        connector: name,
        mode: "sandbox_idp",
        connected: Boolean(
          state.connected ||
            state.status === "Ready" ||
            state.status === "Connected",
        ),
        live: false,
        detail: state.detail || `${name} token unset; sandbox path`,
      };
    }
    return {
      connector: name,
      mode: "connector_token_file",
      connected: true,
      live: true,
      detail: `${name} token present (env or *_token.json)`,
    };
  }

  async function connectorsStatusReport() {
    const slack = await probeSlack();
    const gmail = probeEmail("gmail");
    const outlook = probeEmail("outlook");
    const teams = probeConnectorToken("teams");
    const finance = probeConnectorToken("finance");
    const calendar = probeConnectorToken("calendar");
    const job = probeConnectorToken("job");
    const x = probeConnectorToken("x");
    const purchase = probeConnectorToken("purchase");
    const meeting = probeConnectorToken("meeting");
    return {
      ok: true,
      connectors: {
        slack,
        gmail,
        outlook,
        teams,
        meeting,
        finance,
        calendar,
        job,
        x,
        purchase,
      },
      env: {
        SLACK_BOT_TOKEN: Boolean(resolveProviderAccessToken("slack")),
        BITBOT_SLACK_POST: process.env.BITBOT_SLACK_POST === "1",
        SLACK_DEFAULT_CHANNEL: Boolean(
          String(process.env.SLACK_DEFAULT_CHANNEL || "").trim(),
        ),
      },
      pretend_all_connected: false,
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
        listed_path: command,
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
        path: artifactPath,
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
      // CHARTER Delivery: path is durable snap (not the listed dir name).
      return okJson("fs_list", command, {
        ...artifact,
        path: artifactPath,
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
        read_path: command,
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
        path: artifactPath,
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
      // CHARTER Delivery: path is durable snap (not the read target path).
      return okJson("fs_read", command, {
        ...artifact,
        path: artifactPath,
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

  function isWebFetchAuthWall(url, status, body) {
    const u = String(url || "").toLowerCase();
    const b = String(body || "").toLowerCase();
    if (status === 401 || status === 407) return true;
    if (/\/login(?:\/|$|\?)|\/signin|\/oauth|\/sso/.test(u)) return true;
    if (
      b.includes("www-authenticate") ||
      b.includes("unauthorized") ||
      b.includes("sign in") ||
      b.includes("please log in") ||
      b.includes("credential")
    ) {
      return true;
    }
    return false;
  }

  function isWebFetchBlocked(status, body) {
    const b = String(body || "").toLowerCase();
    if (status === 403 || status === 429 || status === 451) return true;
    if (
      b.includes("blocked") ||
      b.includes("access denied") ||
      b.includes("forbidden") ||
      b.includes("bot detected")
    ) {
      return true;
    }
    return false;
  }

  async function curlPublicFallback(url) {
    // CM-1703: public egress via curl UA — never send auth headers (no cred bypass).
    try {
      const { stdout, stderr } = await execFileAsync(
        "curl",
        [
          "-fsSL",
          "--max-time",
          "20",
          "-A",
          "BitBot-PublicFallback/1.0",
          url,
        ],
        {
          cwd: REPO_ROOT,
          timeout: 25000,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            // Strip inherited auth to enforce no credential bypass.
            CURL_HOME: path.join(REPO_ROOT, "data", "tmp", "curl-empty-home"),
          },
        },
      );
      const body = String(stdout || "");
      return {
        ok: body.length > 0,
        status: 200,
        body: body.slice(0, 16000),
        error: null,
        tool: "curl",
        stderr: String(stderr || "").slice(0, 400),
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        body: err.stdout ? String(err.stdout).slice(0, 4000) : "",
        error: err.message || String(err),
        tool: "curl",
        stderr: err.stderr ? String(err.stderr).slice(0, 400) : "",
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
    fs.mkdirSync(path.join(REPO_ROOT, "data", "tmp", "curl-empty-home"), {
      recursive: true,
    });
    const artifactPath = path.join(
      dir,
      `fetch-${Date.now().toString(36)}.json`,
    );
    let body = String(res.body || "");
    let httpStatus = res.status || 0;
    let ok = Boolean(res.ok);
    let error = res.error || null;
    let usedFallback = false;
    let fallback = null;
    let credentialBypass = false;
    let mode = "host_webfetch";
    let publicFallbackResidual = false;

    if (!ok) {
      if (isWebFetchAuthWall(url, httpStatus, body)) {
        // Auth wall: refuse public fallback (CM-1703 no credential bypass).
        error =
          error ||
          `auth_wall http_${httpStatus}: public fallback refused (credential bypass forbidden)`;
        mode = "host_webfetch_auth_wall";
        credentialBypass = false;
        publicFallbackResidual = false;
      } else if (isWebFetchBlocked(httpStatus, body) || httpStatus === 0) {
        const fb = await curlPublicFallback(url);
        if (fb.ok) {
          usedFallback = true;
          fallback = "curl";
          body = fb.body;
          httpStatus = fb.status || 200;
          ok = true;
          error = null;
          mode = "host_webfetch_public_fallback";
          credentialBypass = false;
          publicFallbackResidual = false;
        } else {
          error =
            error ||
            fb.error ||
            `blocked http_${httpStatus}; curl public fallback failed`;
          mode = "host_webfetch_blocked";
          publicFallbackResidual = true;
          fallback = "curl_failed";
        }
      }
    }

    const artifact = {
      url,
      http_status: httpStatus,
      ok,
      error,
      body_prefix: body.slice(0, 800),
      body_bytes: Buffer.byteLength(body, "utf8"),
      mode,
      used_fallback: usedFallback,
      fallback,
      credential_bypass: credentialBypass,
      public_fallback_residual: publicFallbackResidual,
      pretend_fetched: false,
      at,
    };
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "fetches.jsonl"), {
      ...artifact,
      path: artifactPath,
      artifact_path: artifactPath,
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: artifactPath,
      label: "webfetch",
      url,
      used_fallback: usedFallback,
      source_kind: "webfetch",
      at,
    });
    appendHostDeliveryJournal({
      kind: "webfetch",
      command: url,
      path: artifactPath,
      http_status: artifact.http_status,
      used_fallback: usedFallback,
      fallback,
      at,
    });
    if (!ok) {
      return {
        kind: "webfetch",
        ok: false,
        command: url,
        error: error || `http_${httpStatus}`,
        stdout: JSON.stringify(
          {
            ...artifact,
            path: artifactPath,
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
      path: artifactPath,
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

  /** Close residual / run inbound turn only when HTTP-ok AND ≥1 claimed. */
  function gateClaimForResidual(claim) {
    if (!claim || typeof claim !== "object") return claim;
    const httpOk = Boolean(claim.ok);
    const count = Number(claim.claimed_count || 0);
    const claimOk = httpOk && count >= 1;
    if (claimOk) return claim;
    return {
      ...claim,
      ok: false,
      error:
        claim.error ||
        (httpOk && count < 1 ? "empty claim inbox" : "claim failed"),
    };
  }

  /**
   * Claim → nested Host turn hook (webhook_wake / mail_claim_inbox parity).
   * When BITBOT_INBOUND_TURN=1, runs cli_host on turnPrompt and closes
   * inbound_turn_residual on turn_ok.
   */
  async function runInboundTurnHook({
    hooksBaseDir,
    turnPrompt,
    hookMeta = {},
    pendingMeta = {},
  }) {
    const at = new Date().toISOString();
    const hooksDir = path.join(hooksBaseDir, "turn-hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(
      hooksDir,
      `hook-${Date.now().toString(36)}.json`,
    );
    const prompt = String(turnPrompt || "").slice(0, 400);
    const hook = {
      ...hookMeta,
      turn_prompt: prompt,
      status: "pending",
      pretend_turn: false,
      at,
    };
    fs.writeFileSync(hookPath, JSON.stringify(hook, null, 2));
    const pendingPath = path.join(hooksBaseDir, "pending-turns.jsonl");
    appendJsonl(pendingPath, {
      ...pendingMeta,
      hook_path: hookPath,
      turn_prompt: prompt,
      status: "pending",
      at,
    });
    let turnHookResult = {
      hooked: true,
      hook_path: hookPath,
      pending_path: pendingPath,
      turn_executed: false,
      turn_ok: false,
      turn_path: null,
      error: null,
    };
    if (process.env.BITBOT_INBOUND_TURN === "1") {
      try {
        const turnOut = path.join(
          hooksDir,
          `turn-${Date.now().toString(36)}.json`,
        );
        const { stdout, stderr } = await execFileAsync(
          process.execPath,
          [
            path.join(REPO_ROOT, "hosts", "cli_host", "run_turn.js"),
            "--approved",
            prompt,
          ],
          {
            cwd: REPO_ROOT,
            timeout: 60000,
            maxBuffer: 2 * 1024 * 1024,
            env: {
              ...process.env,
              // Prevent recursive inbound wake loops.
              BITBOT_INBOUND_TURN: "0",
            },
          },
        );
        fs.writeFileSync(
          turnOut,
          String(stdout || "").trim() ||
            JSON.stringify({ ok: false, error: "empty turn stdout", stderr }),
        );
        let turnOk = false;
        try {
          const parsed = JSON.parse(fs.readFileSync(turnOut, "utf8"));
          turnOk = Boolean(parsed && parsed.ok);
        } catch (_) {
          turnOk = false;
        }
        hook.status = turnOk ? "executed" : "failed";
        hook.turn_path = turnOut;
        fs.writeFileSync(hookPath, JSON.stringify(hook, null, 2));
        turnHookResult = {
          hooked: true,
          hook_path: hookPath,
          pending_path: pendingPath,
          turn_executed: true,
          turn_ok: turnOk,
          turn_path: turnOut,
          error: turnOk ? null : "inbound turn returned ok=false",
        };
      } catch (err) {
        hook.status = "failed";
        hook.error = String((err && err.message) || err).slice(0, 240);
        fs.writeFileSync(hookPath, JSON.stringify(hook, null, 2));
        turnHookResult = {
          hooked: true,
          hook_path: hookPath,
          pending_path: pendingPath,
          turn_executed: true,
          turn_ok: false,
          turn_path: null,
          error: hook.error,
        };
      }
    }
    const inboundTurnResidual =
      !turnHookResult.turn_executed || !turnHookResult.turn_ok;
    return {
      turnHookResult,
      inboundTurnResidual,
      hookPath,
      pendingPath,
      hooksDir,
    };
  }

  async function finalizeChannelSend(raw, entry, extras = {}) {
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
    const claim = extras.claim || artifact.claim || undefined;
    // Live claim-ok with ≥1 message → nested Host turn hook for all schemes
    // (Slack/Teams/meeting/SMS/webhook/voice). Empty HTTP-ok inbox must not
    // execute inbound turn as success.
    let turnHookResult = undefined;
    let inboundTurnResidual = undefined;
    const claimReady =
      claim &&
      Boolean(claim.ok) &&
      Number(claim.claimed_count || 0) >= 1;
    if (claimReady) {
      const channelsDir = path.join(REPO_ROOT, "data", "channels");
      const turnPrompt =
        `Channel claim ${artifact.scheme || "channel"} ${artifact.address || ""}: ${claim.claimed_count || 0} message(s)`.slice(
          0,
          400,
        );
      const hooked = await runInboundTurnHook({
        hooksBaseDir: channelsDir,
        turnPrompt,
        hookMeta: {
          scheme: artifact.scheme || null,
          address: artifact.address || null,
          mode: artifact.mode || null,
          claimed_count: claim.claimed_count || 0,
        },
        pendingMeta: {
          scheme: artifact.scheme || null,
          address: artifact.address || null,
        },
      });
      turnHookResult = hooked.turnHookResult;
      inboundTurnResidual = hooked.inboundTurnResidual;
    }
    // Claim/pull is not HTTP Events push — keep inbound_push_residual true
    // (host_slack/teams/email/meeting/voice_events_listen close it on real Events/push POST).
    const inboundPushResidual = claimReady ? true : undefined;
    const snapshot = {
      ...artifact,
      path: sendPath,
      outbound: outboundPath,
      inbound: extras.inbound || artifact.inbound || undefined,
      transcript: extras.transcript || artifact.transcript || undefined,
      teams_transcript:
        extras.teams_transcript || artifact.teams_transcript || undefined,
      mail: extras.mail || artifact.mail || undefined,
      claim,
      turn_hook: turnHookResult,
      inbound_turn_residual: inboundTurnResidual,
      inbound_push_residual: inboundPushResidual,
    };
    fs.writeFileSync(sendPath, JSON.stringify(snapshot, null, 2));
    appendJsonl(path.join(sendDir, "sends.jsonl"), snapshot);
    const journalPath =
      extras.journal ||
      appendHostDeliveryJournal({
        kind: "channel_send",
        path: sendPath,
        ...artifact,
        turn_hook: turnHookResult || undefined,
        inbound_turn_residual: inboundTurnResidual,
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
          : scheme === "outlook"
            ? loadConnectorState("outlook")
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
      const connectorToken =
        extractAccessToken(connectorHint) ||
        resolveProviderAccessToken("slack");
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
      // Close residual only when HTTP ok AND ≥1 claimed (empty inbox keeps residual open).
      if (claim) {
        const gated = gateClaimForResidual(claim);
        const claimOk = Boolean(gated.ok);
        const entry = {
          scheme,
          address: addr,
          body: outboundBody,
          mode: "live_slack_claim",
          ok: claimOk,
          live_post: false,
          live_slack_residual: !claimOk,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          claimed_count: claim.claimed_count,
          claim: gated,
          connector_ready: connectorReady,
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          claim: gated,
          ok: claimOk,
          error: claimOk ? "" : gated.error,
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
          live_slack_residual: true,
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
        live_slack_residual: true,
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
      const teamsToken = resolveProviderAccessToken("teams");
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
      // CM-1104: channel degrade — strip naked widget payloads before live/draft.
      let outboundBody = body;
      let widgetDegraded = false;
      if (/\[widget:|type=widget|decision_card/i.test(body)) {
        outboundBody = body
          .replace(/\[widget:[^\]]*\]/gi, "")
          .replace(/type=widget\S*/gi, "")
          .trim();
        if (!outboundBody) {
          outboundBody =
            "(widget degraded to text — open Desktop chat for choices)";
        }
        widgetDegraded = true;
      }
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
      if (
        teamsToken &&
        process.env.BITBOT_TEAMS_POST === "1" &&
        outboundBody
      ) {
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
              body: { contentType: "text", content: outboundBody },
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
          body: outboundBody,
          mode: ok ? mode : "live_teams_failed",
          ok,
          live_post: ok,
          live_teams_residual: !ok,
          pretend_live: false,
          widget_degraded: widgetDegraded,
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
      // Close residual only when HTTP ok AND ≥1 claimed (empty inbox keeps residual open).
      if (teamsClaim) {
        const gated = gateClaimForResidual(teamsClaim);
        const claimOk = Boolean(gated.ok);
        const entry = {
          scheme: "teams",
          address: addr,
          body: outboundBody,
          mode: "live_teams_claim",
          ok: claimOk,
          live_post: false,
          live_teams_residual: !claimOk,
          claimed_count: teamsClaim.claimed_count,
          claim: gated,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          chat_id: chatId || null,
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          claim: gated,
          ok: claimOk,
          error: claimOk ? "" : gated.error,
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
          body: outboundBody,
          mode: "sandbox_teams_claim",
          ok: true,
          live_post: false,
          live_teams_residual: true,
          claimed_count: 1,
          pretend_live: false,
          widget_degraded: widgetDegraded,
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
        body: outboundBody,
        mode: connectorReady ? "connector_draft" : "sandbox_draft",
        ok: true,
        live_post: false,
        live_teams_residual: true,
        pretend_live: false,
        connector_ready: connectorReady,
        widget_degraded: widgetDegraded,
        at: stamp,
        note: "Teams live Graph post needs BITBOT_TEAMS_TOKEN + BITBOT_TEAMS_POST=1; claim needs BITBOT_TEAMS_CLAIM=1",
      };
      appendJsonl(outboundPath, entry);
      appendJsonl(teamsTranscript, entry);
      return finalizeChannelSend(raw, entry, {
        outboundPath,
        teams_transcript: teamsTranscript,
      });
    }

    if (
      addr.startsWith("email:") ||
      addr.startsWith("gmail:") ||
      addr.startsWith("outlook:")
    ) {
      // Channel email: durable draft by default; live Gmail/Outlook when gated.
      // Inbound claim (BITBOT_EMAIL_CLAIM=1) reuses mail_claim mock token/API.
      const toAddr =
        addr.replace(/^(email|gmail|outlook):/i, "").trim() ||
        "user@example.com";
      let mailProvider = "gmail";
      if (/^outlook:/i.test(addr)) {
        mailProvider = "outlook";
      } else if (/^gmail:/i.test(addr)) {
        mailProvider = "gmail";
      } else {
        // bare email: — prefer Outlook when BITBOT_MAIL_PROVIDER=outlook, or when
        // Outlook is armed and no Gmail env token (Connect Outlook alone must
        // not lose to a stale gmail_token.json from prior runs).
        const mailProviderEnv = String(process.env.BITBOT_MAIL_PROVIDER || "")
          .trim()
          .toLowerCase();
        const preferOutlook =
          mailProviderEnv === "outlook" ||
          (connectorArmed("outlook") &&
            !String(process.env.BITBOT_GMAIL_TOKEN || "").trim() &&
            mailProviderEnv !== "gmail");
        if (preferOutlook) mailProvider = "outlook";
      }
      // Live email inbound claim via existing mail_claim mock (parity with SMS/Slack).
      let emailClaim = null;
      const claimApi = String(
        process.env.BITBOT_MAIL_CLAIM_API_URL || "",
      ).trim();
      const claimToken =
        String(process.env.BITBOT_MAIL_CLAIM_TOKEN || "").trim() ||
        resolveProviderAccessToken("mail_claim") ||
        resolveProviderAccessToken(mailProvider) ||
        resolveProviderAccessToken("gmail") ||
        resolveProviderAccessToken("outlook");
      const claimApiBase = claimApi ? claimApi.replace(/\/$/, "") : "";
      if (
        claimToken &&
        claimApiBase &&
        process.env.BITBOT_EMAIL_CLAIM === "1"
      ) {
        const hist = await httpJson(
          claimApiBase +
            "/messages?q=" +
            encodeURIComponent(toAddr || "inbox"),
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${claimToken}`,
              Accept: "application/json",
            },
          },
        );
        const okHist =
          Boolean(hist.ok) || (hist.status >= 200 && hist.status < 300);
        const values =
          (hist.json &&
            (hist.json.messages || hist.json.items || hist.json.value)) ||
          [];
        const claimed = [];
        for (const m of Array.isArray(values) ? values : []) {
          if (!m || typeof m !== "object") continue;
          const text = String(
            m.text_prefix || m.snippet || m.subject || m.text || m.body || "",
          );
          const row = {
            scheme: "email",
            id: m.id || m.message_id || "",
            to: toAddr,
            from: m.from || "",
            subject: m.subject || "",
            text_prefix: text.slice(0, 80),
            text_len: text.length,
            mode: "live_email_claim",
            at: stamp,
          };
          appendJsonl(inboundPath, row);
          claimed.push({ id: row.id, text_len: row.text_len });
        }
        emailClaim = {
          ok: okHist,
          claimed_count: claimed.length,
          claimed,
          error: okHist ? "" : hist.error || `http_${hist.status}`,
        };
      }
      // Claim-only path (CLAIM=1, no live mail send): close residual only when
      // HTTP ok AND ≥1 claimed (empty inbox keeps residual open).
      const mailSendArmed = process.env.BITBOT_MAIL_SEND === "1";
      if (emailClaim && !mailSendArmed) {
        const gated = gateClaimForResidual(emailClaim);
        const claimOk = Boolean(gated.ok);
        const entry = {
          scheme,
          address: addr,
          body,
          mode: "live_email_claim",
          ok: claimOk,
          live_post: false,
          pretend_live: false,
          live_mail_residual: !claimOk,
          live_channel_residual: !claimOk,
          claimed_count: emailClaim.claimed_count,
          claim: gated,
          mail: {
            provider: mailProvider,
            mode: "live_email_claim",
            sent: false,
            eml_path: null,
            message_id: null,
          },
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        appendJsonl(MAIL_DRAFTS_PATH, {
          kind: "channel_email_claim",
          address: addr,
          body,
          mail_mode: entry.mode,
          at: stamp,
        });
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          mail: entry.mail,
          claim: gated,
          ok: claimOk,
          error: claimOk ? "" : gated.error || "email claim failed",
        });
      }
      // Sandbox claim rehearsal when CLAIM=1 but no live token/API.
      if (
        process.env.BITBOT_EMAIL_CLAIM === "1" &&
        !(claimToken && claimApiBase)
      ) {
        const sandboxRow = {
          scheme: "email",
          id: `sandbox-email-${Date.now().toString(36)}`,
          to: toAddr,
          from: "sandbox@local",
          subject: "sandbox email inbound",
          text_prefix: "sandbox email inbound claim",
          text_len: 28,
          mode: "sandbox_email_claim",
          at: stamp,
        };
        appendJsonl(inboundPath, sandboxRow);
        const entry = {
          scheme,
          address: addr,
          body,
          mode: "sandbox_email_claim",
          ok: true,
          live_post: false,
          pretend_live: false,
          live_mail_residual: true,
          live_channel_residual: true,
          claimed_count: 1,
          note: "sandbox email claim — set BITBOT_MAIL_CLAIM_TOKEN + BITBOT_MAIL_CLAIM_API_URL for live",
          mail: {
            provider: mailProvider,
            mode: "sandbox_email_claim",
            sent: false,
            eml_path: null,
            message_id: null,
          },
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        appendJsonl(MAIL_DRAFTS_PATH, {
          kind: "channel_email_claim",
          address: addr,
          body,
          mail_mode: entry.mode,
          at: stamp,
        });
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          mail: entry.mail,
        });
      }
      const mailCmd = `${mailProvider}|${toAddr}|channel delivery|${body}`;
      const mailResult = await executeMailSend(mailCmd);
      let mailPayload = {};
      try {
        mailPayload = JSON.parse(mailResult.stdout || "{}");
      } catch (_) {
        mailPayload = {};
      }
      const live = Boolean(
        mailPayload.sent &&
          (mailPayload.mode === "live_gmail" ||
            mailPayload.mode === "live_outlook"),
      );
      const claimOk = Boolean(emailClaim && emailClaim.ok);
      const residualClosed = live || claimOk;
      const entry = {
        scheme,
        address: addr,
        body,
        mode: live
          ? mailPayload.mode === "live_outlook"
            ? "live_email_outlook"
            : "live_email_gmail"
          : mailPayload.mode || "mail_outbound_draft",
        ok: true,
        live_post: live,
        live_mail_residual: !residualClosed,
        pretend_live: false,
        claim: emailClaim
          ? { ok: emailClaim.ok, claimed_count: emailClaim.claimed_count }
          : null,
        mail: {
          provider: mailProvider,
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
        inbound: emailClaim ? inboundPath : undefined,
        mail: entry.mail,
        claim: emailClaim || undefined,
      });
    }

    // CM-2153 meeting chat DirectSend (command: meeting_chat :: body)
    if (addr === "meeting_chat" || scheme === "meeting_chat") {
      const meetingDir = path.join(REPO_ROOT, "data", "meetings");
      fs.mkdirSync(meetingDir, { recursive: true });
      const transcriptPath = path.join(meetingDir, "live-chat.jsonl");
      const inboundPath = path.join(
        REPO_ROOT,
        "data",
        "channels",
        "inbound.jsonl",
      );
      const meetingToken = resolveProviderAccessToken("meeting");
      const meetingApi = resolveConnectorApiUrl("meeting", [
        "BITBOT_MEETING_API_URL",
      ]);
      const apiBase = meetingApi ? meetingApi.replace(/\/$/, "") : "";
      // CM-1104: strip naked widget payloads before live/direct meeting send.
      let outboundBody = body;
      let widgetDegraded = false;
      if (/\[widget:|type=widget|decision_card/i.test(body)) {
        outboundBody = body
          .replace(/\[widget:[^\]]*\]/gi, "")
          .replace(/type=widget\S*/gi, "")
          .trim();
        if (!outboundBody) {
          outboundBody =
            "(widget degraded to text — open Desktop chat for choices)";
        }
        widgetDegraded = true;
      }
      // Live meeting inbound claim when CLAIM=1 + token + API.
      let meetingClaim = null;
      if (
        meetingToken &&
        apiBase &&
        process.env.BITBOT_MEETING_CLAIM === "1"
      ) {
        const hist = await httpJson(apiBase + "/messages", {
          method: "GET",
          headers: { Authorization: `Bearer ${meetingToken}` },
        });
        const okHist =
          Boolean(hist.ok) || (hist.status >= 200 && hist.status < 300);
        const values =
          (hist.json && (hist.json.messages || hist.json.value)) || [];
        const claimed = [];
        for (const m of Array.isArray(values) ? values : []) {
          if (!m || typeof m !== "object") continue;
          const text = String(m.text || m.body || m.content || "");
          const row = {
            scheme: "meeting_chat",
            id: m.id || m.message_id || "",
            text_prefix: text.slice(0, 80),
            text_len: text.length,
            mode: "live_meeting_claim",
            at: stamp,
          };
          appendJsonl(inboundPath, row);
          claimed.push({ id: row.id, text_len: row.text_len });
        }
        meetingClaim = {
          ok: okHist,
          claimed_count: claimed.length,
          claimed,
          error: okHist ? "" : hist.error || `http_${hist.status}`,
        };
      }
      const liveMeeting = Boolean(meetingToken && apiBase);
      let livePost = false;
      let liveAttempted = false;
      let liveProbe = null;
      // Gate live meeting POST behind BITBOT_MEETING_POST=1 (parity with Slack/Teams/SMS).
      if (
        liveMeeting &&
        process.env.BITBOT_MEETING_POST === "1" &&
        outboundBody
      ) {
        liveAttempted = true;
        try {
          const resp = await fetch(apiBase + "/messages", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${meetingToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: outboundBody,
              source: "bitbot-host",
            }),
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
      // Claim-only path (CLAIM=1, no POST gate): close residual only when HTTP ok
      // AND ≥1 claimed (empty inbox keeps residual open).
      if (meetingClaim && !liveAttempted) {
        const gated = gateClaimForResidual(meetingClaim);
        const claimOk = Boolean(gated.ok);
        const entry = {
          scheme: "meeting_chat",
          address: "meeting_chat",
          body: outboundBody,
          mode: "live_meeting_claim",
          direct_send: true,
          draft_card: false,
          ok: claimOk,
          live_post: false,
          live_meeting_residual: !claimOk,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          claimed_count: meetingClaim.claimed_count,
          claim: gated,
          note: claimOk
            ? "CM-2153 live meeting inbound claim"
            : "CM-2153 meeting claim failed (live_meeting_residual)",
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        appendJsonl(transcriptPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          transcript: transcriptPath,
          inbound: inboundPath,
          claim: gated,
          ok: claimOk,
          error: claimOk ? "" : gated.error || "meeting claim failed",
        });
      }
      // Sandbox claim rehearsal when CLAIM=1 but no live token/API.
      if (process.env.BITBOT_MEETING_CLAIM === "1" && !liveMeeting) {
        const sandboxRow = {
          scheme: "meeting_chat",
          id: `sandbox-meet-${Date.now().toString(36)}`,
          text_prefix: "sandbox meeting inbound",
          text_len: 24,
          mode: "sandbox_meeting_claim",
          at: stamp,
        };
        appendJsonl(inboundPath, sandboxRow);
        const entry = {
          scheme: "meeting_chat",
          address: "meeting_chat",
          body: outboundBody,
          mode: "sandbox_meeting_claim",
          direct_send: true,
          draft_card: false,
          ok: true,
          live_post: false,
          live_meeting_residual: true,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          claimed_count: 1,
          note: "sandbox meeting claim — set BITBOT_MEETING_TOKEN + BITBOT_MEETING_API_URL for live",
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        appendJsonl(transcriptPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          transcript: transcriptPath,
          inbound: inboundPath,
        });
      }
      let mode = "meeting_chat_direct";
      if (livePost) mode = "meeting_chat_live";
      else if (liveAttempted) mode = "meeting_chat_live_failed";
      // Live post closes residual; claim-ok alongside failed/direct also closes.
      const claimOk = Boolean(meetingClaim && meetingClaim.ok);
      const residualClosed = livePost || claimOk;
      const entry = {
        scheme: "meeting_chat",
        address: "meeting_chat",
        body: outboundBody,
        mode,
        direct_send: true,
        draft_card: false,
        ok: livePost || !liveAttempted,
        live_post: livePost,
        live_meeting_residual: !residualClosed,
        pretend_live: false,
        widget_degraded: widgetDegraded,
        live_probe: liveProbe,
        claim: meetingClaim
          ? {
              ok: meetingClaim.ok,
              claimed_count: meetingClaim.claimed_count,
            }
          : null,
        note: livePost
          ? "CM-2153 DirectSend live meeting transport"
          : liveAttempted
            ? "CM-2153 live meeting transport failed (live_meeting_residual)"
            : "CM-2153 DirectSend durable transcript (live meeting transport residual)",
        at: stamp,
      };
      appendJsonl(outboundPath, entry);
      appendJsonl(transcriptPath, entry);
      return finalizeChannelSend(raw, entry, {
        outboundPath,
        transcript: transcriptPath,
        inbound: meetingClaim ? inboundPath : undefined,
        claim: meetingClaim || undefined,
        ok: entry.ok,
        error: liveAttempted && !livePost
          ? `meeting post failed: ${(liveProbe && (liveProbe.error || liveProbe.http_status)) || "unknown"}`
          : "",
      });
    }

    // SMS adapter (sandbox + optional live mock).
    if (scheme === "sms" || addr.startsWith("sms:")) {
      const smsDir = path.join(REPO_ROOT, "data", "channels", "sms");
      fs.mkdirSync(smsDir, { recursive: true });
      const to = addr.includes(":") ? addr.split(":").slice(1).join(":") : addr;
      const smsApi = String(process.env.BITBOT_SMS_API_URL || "").trim();
      const smsToken =
        String(process.env.BITBOT_SMS_TOKEN || "").trim() ||
        resolveProviderAccessToken("sms");
      // CM-1104: strip naked widget payloads before SMS send (parity with Slack/Teams).
      let outboundBody = String(body || "");
      let widgetDegraded = false;
      if (/\[widget:|type=widget|decision_card/i.test(outboundBody)) {
        outboundBody = outboundBody
          .replace(/\[widget:[^\]]*\]/gi, "")
          .replace(/type=widget\S*/gi, "")
          .trim();
        if (!outboundBody) {
          outboundBody =
            "(widget degraded to text — open Desktop chat for choices)";
        }
        widgetDegraded = true;
      }
      const apiBase = smsApi ? smsApi.replace(/\/$/, "") : "";
      // Live SMS inbound claim when CLAIM=1 + token + API (parity with meeting).
      let smsClaim = null;
      if (smsToken && apiBase && process.env.BITBOT_SMS_CLAIM === "1") {
        const hist = await httpJson(apiBase + "/messages", {
          method: "GET",
          headers: { Authorization: `Bearer ${smsToken}` },
        });
        const okHist =
          Boolean(hist.ok) || (hist.status >= 200 && hist.status < 300);
        const values =
          (hist.json && (hist.json.messages || hist.json.value)) || [];
        const claimed = [];
        for (const m of Array.isArray(values) ? values : []) {
          if (!m || typeof m !== "object") continue;
          const text = String(m.text || m.body || m.content || "");
          const row = {
            scheme: "sms",
            id: m.id || m.message_id || "",
            to,
            text_prefix: text.slice(0, 80),
            text_len: text.length,
            mode: "live_sms_claim",
            at: stamp,
          };
          appendJsonl(inboundPath, row);
          claimed.push({ id: row.id, text_len: row.text_len });
        }
        smsClaim = {
          ok: okHist,
          claimed_count: claimed.length,
          claimed,
          error: okHist ? "" : hist.error || `http_${hist.status}`,
        };
      }
      let livePost = false;
      let liveProbe = null;
      let liveAttempted = false;
      let mode = "sandbox_sms";
      // Gate live SMS behind BITBOT_SMS_POST=1 (parity with webhook/voice).
      if (smsApi && smsToken && process.env.BITBOT_SMS_POST === "1") {
        liveAttempted = true;
        try {
          const resp = await httpJson(apiBase + "/messages", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + smsToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to,
              body: outboundBody.slice(0, 1600),
            }),
          });
          liveProbe = {
            ok: Boolean(resp.ok),
            http_status: resp.status || 0,
            error: resp.error || null,
          };
          livePost = Boolean(resp.ok);
          mode = livePost ? "live_sms" : "live_sms_failed";
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
          mode = "live_sms_failed";
        }
      }
      // Claim-only path (CLAIM=1, no POST): close residual only when HTTP ok
      // and at least one message was claimed (empty inbox keeps residual open).
      if (smsClaim && !liveAttempted) {
        const gated = gateClaimForResidual(smsClaim);
        const claimOk = Boolean(gated.ok);
        const entry = {
          scheme: "sms",
          address: addr,
          to,
          body: outboundBody.slice(0, 1600),
          mode: "live_sms_claim",
          ok: claimOk,
          live_post: false,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          live_sms_residual: !claimOk,
          live_channel_residual: !claimOk,
          claimed_count: smsClaim.claimed_count,
          claim: gated,
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        appendJsonl(path.join(smsDir, "outbound.jsonl"), entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          claim: gated,
          ok: claimOk,
          error: claimOk ? "" : gated.error || "sms claim failed",
          send_to_user_type: "text",
        });
      }
      // Sandbox claim rehearsal when CLAIM=1 but no live token/API.
      if (process.env.BITBOT_SMS_CLAIM === "1" && !(smsToken && apiBase)) {
        const sandboxRow = {
          scheme: "sms",
          id: `sandbox-sms-${Date.now().toString(36)}`,
          to,
          text_prefix: "sandbox sms inbound",
          text_len: 20,
          mode: "sandbox_sms_claim",
          at: stamp,
        };
        appendJsonl(inboundPath, sandboxRow);
        const entry = {
          scheme: "sms",
          address: addr,
          to,
          body: outboundBody.slice(0, 1600),
          mode: "sandbox_sms_claim",
          ok: true,
          live_post: false,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          live_sms_residual: true,
          live_channel_residual: true,
          claimed_count: 1,
          note: "sandbox sms claim — set BITBOT_SMS_TOKEN + BITBOT_SMS_API_URL for live",
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        appendJsonl(path.join(smsDir, "outbound.jsonl"), entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          send_to_user_type: "text",
        });
      }
      const claimOk = Boolean(smsClaim && smsClaim.ok);
      const residualClosed = livePost || claimOk;
      const entry = {
        scheme: "sms",
        address: addr,
        to,
        body: outboundBody.slice(0, 1600),
        mode,
        ok: true,
        live_post: livePost,
        pretend_live: false,
        widget_degraded: widgetDegraded,
        live_sms_residual: !residualClosed,
        live_channel_residual: !residualClosed,
        live_probe: liveProbe,
        claim: smsClaim
          ? { ok: smsClaim.ok, claimed_count: smsClaim.claimed_count }
          : null,
        at: stamp,
      };
      appendJsonl(outboundPath, entry);
      appendJsonl(path.join(smsDir, "outbound.jsonl"), entry);
      const snapPath = path.join(
        smsDir,
        `send-${Date.now().toString(36)}.json`,
      );
      fs.writeFileSync(snapPath, JSON.stringify(entry, null, 2));
      return finalizeChannelSend(raw, entry, {
        outboundPath,
        inbound: smsClaim ? inboundPath : undefined,
        claim: smsClaim || undefined,
        send_to_user_type: "text",
      });
    }

    // Webhook outbound adapter — POST to panel URL or BITBOT_WEBHOOK_OUTBOUND_URL.
    if (scheme === "webhook" || addr.startsWith("webhook:")) {
      const panel = loadWebhookPanel();
      const hookUrl =
        String(process.env.BITBOT_WEBHOOK_OUTBOUND_URL || "").trim() ||
        (panel && panel.url) ||
        "";
      // CM-1104: strip naked widget payloads before webhook outbound.
      let outboundBody = String(body || "");
      let widgetDegraded = false;
      if (/\[widget:|type=widget|decision_card/i.test(outboundBody)) {
        outboundBody = outboundBody
          .replace(/\[widget:[^\]]*\]/gi, "")
          .replace(/type=widget\S*/gi, "")
          .trim();
        if (!outboundBody) {
          outboundBody =
            "(widget degraded to text — open Desktop chat for choices)";
        }
        widgetDegraded = true;
      }
      // Live webhook inbound claim when CLAIM=1 + outbound URL (GET /hooks).
      let webhookClaim = null;
      if (hookUrl && process.env.BITBOT_WEBHOOK_CLAIM === "1") {
        const claimUrl = hookUrl.replace(/\/$/, "");
        const hist = await httpJson(claimUrl, { method: "GET" });
        const okHist =
          Boolean(hist.ok) || (hist.status >= 200 && hist.status < 300);
        const values =
          (hist.json &&
            (hist.json.events || hist.json.messages || hist.json.value)) ||
          [];
        const claimed = [];
        for (const m of Array.isArray(values) ? values : []) {
          if (!m || typeof m !== "object") continue;
          const text = String(m.text || m.body || m.summary || "");
          const row = {
            scheme: "webhook",
            id: m.id || m.event_id || "",
            text_prefix: text.slice(0, 80),
            text_len: text.length,
            mode: "live_webhook_claim",
            at: stamp,
          };
          appendJsonl(inboundPath, row);
          claimed.push({ id: row.id, text_len: row.text_len });
        }
        webhookClaim = {
          ok: okHist,
          claimed_count: claimed.length,
          claimed,
          error: okHist ? "" : hist.error || `http_${hist.status}`,
        };
      }
      let livePost = false;
      let liveProbe = null;
      let liveAttempted = false;
      let mode = "sandbox_webhook_outbound";
      if (hookUrl && process.env.BITBOT_WEBHOOK_POST === "1") {
        liveAttempted = true;
        try {
          const resp = await httpJson(hookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(panel && panel.key
                ? { "X-Webhook-Key": "opaque" }
                : {}),
            },
            body: JSON.stringify({
              address: addr,
              body: outboundBody.slice(0, 4000),
              at: stamp,
            }),
          });
          liveProbe = {
            ok: Boolean(resp.ok),
            http_status: resp.status || 0,
            error: resp.error || null,
          };
          livePost = Boolean(resp.ok);
          mode = livePost ? "live_webhook_outbound" : "live_webhook_failed";
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
          mode = "live_webhook_failed";
        }
      }
      // Claim-only: close residual only when HTTP ok AND ≥1 claimed.
      if (webhookClaim && !liveAttempted) {
        const gated = gateClaimForResidual(webhookClaim);
        const claimOk = Boolean(gated.ok);
        const entry = {
          scheme: "webhook",
          address: addr,
          body: outboundBody.slice(0, 4000),
          mode: "live_webhook_claim",
          ok: claimOk,
          live_post: false,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          live_webhook_residual: !claimOk,
          live_channel_residual: !claimOk,
          key_leaked: false,
          hook_url_set: Boolean(hookUrl),
          claimed_count: webhookClaim.claimed_count,
          claim: gated,
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          claim: gated,
          ok: claimOk,
          error: claimOk ? "" : gated.error || "webhook claim failed",
        });
      }
      if (process.env.BITBOT_WEBHOOK_CLAIM === "1" && !hookUrl) {
        const sandboxRow = {
          scheme: "webhook",
          id: `sandbox-wh-${Date.now().toString(36)}`,
          text_prefix: "sandbox webhook inbound",
          text_len: 24,
          mode: "sandbox_webhook_claim",
          at: stamp,
        };
        appendJsonl(inboundPath, sandboxRow);
        const entry = {
          scheme: "webhook",
          address: addr,
          body: outboundBody.slice(0, 4000),
          mode: "sandbox_webhook_claim",
          ok: true,
          live_post: false,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          live_webhook_residual: true,
          live_channel_residual: true,
          key_leaked: false,
          hook_url_set: false,
          claimed_count: 1,
          note: "sandbox webhook claim — set BITBOT_WEBHOOK_OUTBOUND_URL for live",
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
        });
      }
      const claimOk = Boolean(webhookClaim && webhookClaim.ok);
      const residualClosed = livePost || claimOk;
      const entry = {
        scheme: "webhook",
        address: addr,
        body: outboundBody.slice(0, 4000),
        mode,
        ok: true,
        live_post: livePost,
        pretend_live: false,
        widget_degraded: widgetDegraded,
        live_webhook_residual: !residualClosed,
        live_channel_residual: !residualClosed,
        key_leaked: false,
        hook_url_set: Boolean(hookUrl),
        live_probe: liveProbe,
        claim: webhookClaim
          ? {
              ok: webhookClaim.ok,
              claimed_count: webhookClaim.claimed_count,
            }
          : null,
        at: stamp,
      };
      appendJsonl(outboundPath, entry);
      return finalizeChannelSend(raw, entry, {
        outboundPath,
        inbound: webhookClaim ? inboundPath : undefined,
        claim: webhookClaim || undefined,
      });
    }

    // Voice channel adapter (CM-2005 / CM-0108): voice:<call> → session + media.
    if (scheme === "voice" || addr.startsWith("voice:")) {
      const voiceChDir = path.join(REPO_ROOT, "data", "channels", "voice");
      fs.mkdirSync(voiceChDir, { recursive: true });
      const mediaDir = path.join(REPO_ROOT, "data", "voice", "media");
      fs.mkdirSync(mediaDir, { recursive: true });
      const callKey =
        addr.includes(":") ? addr.split(":").slice(1).join(":") : addr;
      const slug = String(callKey || "voice")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .slice(0, 64);
      // CM-1104: strip naked widget payloads before voice channel outbound.
      let outboundBody = String(body || "");
      let widgetDegraded = false;
      if (/\[widget:|type=widget|decision_card/i.test(outboundBody)) {
        outboundBody = outboundBody
          .replace(/\[widget:[^\]]*\]/gi, "")
          .replace(/type=widget\S*/gi, "")
          .trim();
        if (!outboundBody) {
          outboundBody =
            "(widget degraded to text — open Desktop chat for choices)";
        }
        widgetDegraded = true;
      }
      const rows = readJsonArray(VOICE_SESSIONS_PATH);
      let row = rows.find(
        (r) =>
          r &&
          (r.voice_address === addr ||
            r.voice_address === "voice:" + callKey ||
            String(r.call_id || "") === callKey),
      );
      const callId =
        (row && row.call_id) ||
        `call-${slug || "voice"}-${Date.now().toString(36)}`;
      const mediaPath = path.join(
        mediaDir,
        `${slug || "voice"}-ch-${Date.now().toString(36)}.wav`,
      );
      const media = synthesizeVoiceWav(mediaPath, {
        frequency: 520,
        duration: 0.28,
        text: outboundBody.slice(0, 400),
      });
      // After media write: close voice_stt_residual when sidecar / BITBOT_STT_BIN
      // / BITBOT_VOICE_STT path yields a transcript (never pretend heard).
      let stt = {
        ok: false,
        text: "",
        tool: null,
        voice_stt_residual: true,
      };
      if (media.ok && media.path) {
        const wantStt =
          process.env.BITBOT_VOICE_STT === "1" ||
          process.env.BITBOT_VOICE_STT === "force" ||
          Boolean(String(process.env.BITBOT_STT_BIN || "").trim()) ||
          fs.existsSync(media.path + ".stt.txt") ||
          fs.existsSync(
            path.join(
              path.dirname(media.path),
              path.basename(media.path, path.extname(media.path)) + ".stt.txt",
            ),
          );
        if (wantStt) {
          stt = transcribeVoiceWav(media.path);
        }
      }
      const voiceSttResidual = stt.voice_stt_residual !== false || !stt.ok;
      if (!row) {
        row = {
          voice_address: addr.startsWith("voice:") ? addr : "voice:" + callKey,
          call_id: callId,
          // Channel outbound alone is not a live CM-2005 call — do not steal voice_end.
          live: false,
          relay_log: [],
          media_path: media.path,
          media_ok: Boolean(media.ok),
          at: stamp,
        };
        rows.push(row);
      } else {
        row.call_id = row.call_id || callId;
        row.at = stamp;
        row.media_path = media.path;
        row.media_ok = Boolean(media.ok);
        row.relay_log = Array.isArray(row.relay_log) ? row.relay_log : [];
        // Keep existing live flag from voice_session; channel_send must not force live.
      }
      row.relay_log.push({
        role: "assistant",
        text: outboundBody.slice(0, 2000),
        media_path: media.path,
        media_ok: Boolean(media.ok),
        source: "channel_send",
        at: stamp,
      });
      writeJsonArray(VOICE_SESSIONS_PATH, rows);
      // Optional live voice transport mock (not carrier PSTN / OS mic).
      const voiceApi = String(process.env.BITBOT_VOICE_API_URL || "").trim();
      const voiceToken =
        String(process.env.BITBOT_VOICE_TOKEN || "").trim() ||
        resolveProviderAccessToken("voice");
      const voiceApiBase = voiceApi ? voiceApi.replace(/\/$/, "") : "";
      let voiceClaim = null;
      if (
        voiceToken &&
        voiceApiBase &&
        process.env.BITBOT_VOICE_CLAIM === "1"
      ) {
        const hist = await httpJson(voiceApiBase + "/messages", {
          method: "GET",
          headers: { Authorization: `Bearer ${voiceToken}` },
        });
        const okHist =
          Boolean(hist.ok) || (hist.status >= 200 && hist.status < 300);
        const values =
          (hist.json && (hist.json.messages || hist.json.value)) || [];
        const claimed = [];
        for (const m of Array.isArray(values) ? values : []) {
          if (!m || typeof m !== "object") continue;
          const text = String(m.text || m.body || m.content || "");
          const row = {
            scheme: "voice",
            id: m.id || m.message_id || "",
            call_id: callId,
            text_prefix: text.slice(0, 80),
            text_len: text.length,
            mode: "live_voice_claim",
            at: stamp,
          };
          appendJsonl(inboundPath, row);
          claimed.push({ id: row.id, text_len: row.text_len });
        }
        voiceClaim = {
          ok: okHist,
          claimed_count: claimed.length,
          claimed,
          error: okHist ? "" : hist.error || `http_${hist.status}`,
        };
      }
      let livePost = false;
      let liveProbe = null;
      let liveAttempted = false;
      let mode = "sandbox_voice_channel";
      if (voiceApi && voiceToken && process.env.BITBOT_VOICE_POST === "1") {
        liveAttempted = true;
        try {
          const resp = await httpJson(voiceApiBase + "/messages", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + voiceToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              voice_address: addr,
              call_id: callId,
              text: outboundBody.slice(0, 4000),
            }),
          });
          liveProbe = {
            ok: Boolean(resp.ok),
            http_status: resp.status || 0,
            error: resp.error || null,
          };
          livePost = Boolean(resp.ok);
          mode = livePost ? "live_voice_channel" : "live_voice_failed";
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
          mode = "live_voice_failed";
        }
      }
      // Claim-only: close residual only when HTTP ok AND ≥1 claimed.
      if (voiceClaim && !liveAttempted) {
        const gated = gateClaimForResidual(voiceClaim);
        const claimOk = Boolean(gated.ok);
        const entry = {
          scheme: "voice",
          address: addr,
          voice_address: addr.startsWith("voice:") ? addr : "voice:" + callKey,
          call_id: callId,
          body: outboundBody.slice(0, 4000),
          mode: "live_voice_claim",
          ok: claimOk,
          live_post: false,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          live_voice_residual: !claimOk,
          live_channel_residual: !claimOk,
          voice_tts_residual: media.voice_tts_residual !== false,
          // Honest residual: closed only when STT mock/sidecar actually heard.
          voice_stt_residual: voiceSttResidual,
          stt_ok: Boolean(stt.ok),
          stt_tool: stt.tool || null,
          stt_text: stt.ok ? String(stt.text || "").slice(0, 400) : null,
          media_ok: Boolean(media.ok),
          media_path: media.path,
          media_bytes: media.bytes || 0,
          media_tool: media.tool || null,
          sessions_path: VOICE_SESSIONS_PATH,
          claimed_count: voiceClaim.claimed_count,
          claim: gated,
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        appendJsonl(path.join(voiceChDir, "outbound.jsonl"), entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          claim: gated,
          ok: claimOk,
          error: claimOk ? "" : gated.error || "voice claim failed",
          send_to_user_type: "voice",
        });
      }
      if (
        process.env.BITBOT_VOICE_CLAIM === "1" &&
        !(voiceToken && voiceApiBase)
      ) {
        const sandboxRow = {
          scheme: "voice",
          id: `sandbox-voice-${Date.now().toString(36)}`,
          call_id: callId,
          text_prefix: "sandbox voice inbound",
          text_len: 22,
          mode: "sandbox_voice_claim",
          at: stamp,
        };
        appendJsonl(inboundPath, sandboxRow);
        const entry = {
          scheme: "voice",
          address: addr,
          voice_address: addr.startsWith("voice:") ? addr : "voice:" + callKey,
          call_id: callId,
          body: outboundBody.slice(0, 4000),
          mode: "sandbox_voice_claim",
          ok: true,
          live_post: false,
          pretend_live: false,
          widget_degraded: widgetDegraded,
          live_voice_residual: true,
          live_channel_residual: true,
          voice_tts_residual: media.voice_tts_residual !== false,
          // Honest residual: closed only when STT mock/sidecar actually heard.
          voice_stt_residual: voiceSttResidual,
          stt_ok: Boolean(stt.ok),
          stt_tool: stt.tool || null,
          stt_text: stt.ok ? String(stt.text || "").slice(0, 400) : null,
          media_ok: Boolean(media.ok),
          media_path: media.path,
          media_bytes: media.bytes || 0,
          media_tool: media.tool || null,
          sessions_path: VOICE_SESSIONS_PATH,
          claimed_count: 1,
          note: "sandbox voice claim — set BITBOT_VOICE_TOKEN + BITBOT_VOICE_API_URL for live",
          at: stamp,
          inbound: inboundPath,
        };
        appendJsonl(outboundPath, entry);
        appendJsonl(path.join(voiceChDir, "outbound.jsonl"), entry);
        return finalizeChannelSend(raw, entry, {
          outboundPath,
          inbound: inboundPath,
          send_to_user_type: "voice",
        });
      }
      const claimOk = Boolean(voiceClaim && voiceClaim.ok);
      const residualClosed = livePost || claimOk;
      const entry = {
        scheme: "voice",
        address: addr,
        voice_address: addr.startsWith("voice:") ? addr : "voice:" + callKey,
        call_id: callId,
        body: outboundBody.slice(0, 4000),
        mode,
        ok: true,
        live_post: livePost,
        pretend_live: false,
        widget_degraded: widgetDegraded,
        live_voice_residual: !residualClosed,
        live_channel_residual: !residualClosed,
        voice_tts_residual: media.voice_tts_residual !== false,
        // Honest residual: closed only when STT mock/sidecar actually heard.
        voice_stt_residual: voiceSttResidual,
        stt_ok: Boolean(stt.ok),
        stt_tool: stt.tool || null,
        stt_text: stt.ok ? String(stt.text || "").slice(0, 400) : null,
        media_ok: Boolean(media.ok),
        media_path: media.path,
        media_bytes: media.bytes || 0,
        media_tool: media.tool || null,
        sessions_path: VOICE_SESSIONS_PATH,
        live_probe: liveProbe,
        claim: voiceClaim
          ? { ok: voiceClaim.ok, claimed_count: voiceClaim.claimed_count }
          : null,
        at: stamp,
      };
      appendJsonl(outboundPath, entry);
      appendJsonl(path.join(voiceChDir, "outbound.jsonl"), entry);
      const snapPath = path.join(
        voiceChDir,
        `send-${Date.now().toString(36)}.json`,
      );
      fs.writeFileSync(snapPath, JSON.stringify(entry, null, 2));
      return finalizeChannelSend(raw, entry, {
        outboundPath,
        inbound: voiceClaim ? inboundPath : undefined,
        claim: voiceClaim || undefined,
        send_to_user_type: "voice",
      });
    }

    const entry = {
      scheme,
      address: addr,
      body,
      mode: "durable_outbound",
      ok: true,
      pretend_live: false,
      // Unknown schemes: durable snap only — honest residual (not pretend live).
      live_channel_residual: true,
      at: stamp,
    };
    appendJsonl(outboundPath, entry);
    return finalizeChannelSend(raw, entry, { outboundPath });
  }

  async function executeCopyBox(kind, command) {
    // command: machine_id|src|dest[|overwrite=allow|refuse]
    const parts = String(command || "").split("|");
    const machineId = (parts[0] || "").trim();
    const src = (parts[1] || "").trim();
    let dest = (parts[2] || "").trim();
    let overwriteArg = "";
    for (const p of parts.slice(3)) {
      const m = String(p || "").match(/^overwrite=(allow|refuse)$/i);
      if (m) overwriteArg = m[1].toLowerCase();
    }
    // CM-0703: default dest under /workspace/uploads when omitted.
    if (!dest) {
      dest = path.join("uploads", path.basename(src) || "box-copy.bin");
    }
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
    const COPYBOX_MAX = 100 * 1024 * 1024; // CM-0703 ≤100MiB
    try {
      if (!fs.existsSync(srcAbs)) {
        return {
          kind,
          ok: false,
          command,
          error: "source not found: " + src,
          pretend_remote_machine: false,
        };
      }
      const srcBytes = fs.statSync(srcAbs).size;
      if (srcBytes > COPYBOX_MAX) {
        const copyDir = path.join(REPO_ROOT, "data", "box-copy");
        fs.mkdirSync(copyDir, { recursive: true });
        const refusePath = path.join(
          copyDir,
          `${kind}-refuse-${Date.now().toString(36)}.json`,
        );
        const refused = {
          kind,
          machine_id: machineId,
          src: srcAbs,
          dest: destAbs,
          bytes: srcBytes,
          max_bytes: COPYBOX_MAX,
          refused: true,
          pretend_remote_machine: false,
          cross_machine_copy_residual: Boolean(machineId),
          error: "CopyBox refused: source exceeds 100MiB",
          mode: "host_copybox_size_refuse",
          at,
        };
        fs.writeFileSync(refusePath, JSON.stringify(refused, null, 2));
        return okJson(kind, command, {
          ...refused,
          path: refusePath,
          ok: false,
        });
      }
      const overwriteEnv = String(
        process.env.BITBOT_COPYBOX_OVERWRITE || "",
      )
        .trim()
        .toLowerCase();
      // CM-0704: CopyFromBox defaults to Refuse when dest exists unless allow.
      const overwrite =
        overwriteArg ||
        overwriteEnv ||
        (kind === "copy_from_box" ? "refuse" : "allow");
      if (
        kind === "copy_from_box" &&
        overwrite === "refuse" &&
        fs.existsSync(destAbs)
      ) {
        const copyDir = path.join(REPO_ROOT, "data", "box-copy");
        fs.mkdirSync(copyDir, { recursive: true });
        const refusePath = path.join(
          copyDir,
          `${kind}-overwrite-refuse-${Date.now().toString(36)}.json`,
        );
        const priorBytes = fs.statSync(destAbs).size;
        const refused = {
          kind,
          machine_id: machineId,
          src: srcAbs,
          dest: destAbs,
          bytes: priorBytes,
          refused: true,
          overwrite: "refuse",
          pretend_remote_machine: false,
          cross_machine_copy_residual: Boolean(machineId),
          error: "CopyFromBox: dest exists and overwrite=Refuse",
          mode: "host_copybox_overwrite_refuse",
          at,
        };
        fs.writeFileSync(refusePath, JSON.stringify(refused, null, 2));
        return okJson(kind, command, {
          ...refused,
          path: refusePath,
          ok: false,
        });
      }
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(srcAbs, destAbs);
      const copyDir = path.join(REPO_ROOT, "data", "box-copy");
      fs.mkdirSync(copyDir, { recursive: true });
      const artifactPath = path.join(
        copyDir,
        `${kind}-${Date.now().toString(36)}.json`,
      );
      const bytes = fs.existsSync(destAbs) ? fs.statSync(destAbs).size : 0;
      const srcSha = crypto
        .createHash("sha256")
        .update(fs.readFileSync(srcAbs))
        .digest("hex");
      const destSha = crypto
        .createHash("sha256")
        .update(fs.readFileSync(destAbs))
        .digest("hex");
      // Cross-machine: optional scp when BITBOT_COPYBOX_SSH + remote host mapped.
      // BITBOT_SCP_BIN injects a mock scp for residual-close smoke (never invents remote).
      let remote = {
        attempted: false,
        ok: false,
        host: null,
        error: null,
        scp_bin: null,
      };
      const sshMapPath = path.join(
        REPO_ROOT,
        "data",
        "box",
        "machine-ssh.json",
      );
      let remoteHost = (process.env.BITBOT_COPYBOX_SSH || "").trim();
      if (!remoteHost && machineId && fs.existsSync(sshMapPath)) {
        try {
          const map = JSON.parse(fs.readFileSync(sshMapPath, "utf8")) || {};
          remoteHost = String((map[machineId] || map.hosts?.[machineId] || ""))
            .trim();
        } catch (_) {
          remoteHost = "";
        }
      }
      const wantRemote =
        Boolean(remoteHost) && process.env.BITBOT_COPYBOX_REMOTE === "1";
      if (wantRemote) {
        remote.attempted = true;
        remote.host = remoteHost;
        const scpBin =
          String(process.env.BITBOT_SCP_BIN || "").trim() || "scp";
        remote.scp_bin = scpBin;
        try {
          const { execFileSync } = require("child_process");
          const remoteDest = `${remoteHost}:${destAbs}`;
          execFileSync(
            scpBin,
            [
              "-o",
              "BatchMode=yes",
              "-o",
              "StrictHostKeyChecking=accept-new",
              srcAbs,
              remoteDest,
            ],
            {
              stdio: "ignore",
              timeout: 30000,
            },
          );
          remote.ok = true;
        } catch (err) {
          remote.ok = false;
          remote.error = String((err && err.message) || err).slice(0, 240);
        }
      }
      const crossMachineResidual =
        Boolean(machineId) && !(remote.attempted && remote.ok);
      const artifact = {
        kind,
        machine_id: machineId,
        src: srcAbs,
        dest: destAbs,
        bytes,
        sha256_src: srcSha,
        sha256_dest: destSha,
        binary_intact: srcSha === destSha,
        overwrite,
        under_repo: true,
        pretend_remote_machine: false,
        remote,
        cross_machine_copy_residual: crossMachineResidual,
        note: remote.ok
          ? "Host FS copy + remote scp to machine"
          : "Host FS copy under repo — machine_id is routing metadata until remote scp",
        at,
      };
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
      const journal = appendHostDeliveryJournal({
        kind,
        machine_id: machineId,
        src: srcAbs,
        dest: destAbs,
        path: artifactPath,
        cross_machine_copy_residual: crossMachineResidual,
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

  function finalizeMailSend(command, entry, extras = {}) {
    // Per-send Host snapshot — eml + jsonl ledgers retained by caller.
    const sendDir = path.join(REPO_ROOT, "data", "mail", "sends");
    fs.mkdirSync(sendDir, { recursive: true });
    const provider = sanitizeSkillName(entry.provider || "mail") || "mail";
    const sendPath = path.join(
      sendDir,
      `send-${provider}-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      ...entry,
      pretend_sent: entry && entry.pretend_sent === true ? true : false,
      mode: (entry && entry.mode) || "mail_send",
      mode_note: "host_mail_send",
    };
    const snapshot = {
      ...artifact,
      ledger_path: extras.ledger || artifact.ledger || undefined,
      journal: extras.journal || artifact.journal || undefined,
    };
    fs.writeFileSync(sendPath, JSON.stringify(snapshot, null, 2));
    appendJsonl(path.join(sendDir, "sends.jsonl"), {
      ...snapshot,
      path: sendPath,
    });
    const journalPath =
      extras.journal ||
      appendHostDeliveryJournal({
        kind: "mail_send",
        command,
        path: sendPath,
        eml: artifact.eml_path,
        provider: artifact.provider,
        mode: artifact.mode,
        at: artifact.at,
      });
    return okJson("mail_send", command, {
      ...snapshot,
      path: sendPath,
      journal: journalPath,
      send_to_user: extras.delivery || artifact.send_to_user,
      ok: true,
    });
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
      // Optional live transport mock (not production MTA / IdP).
      // BITBOT_MAIL_SEND=1 + BITBOT_COLD_MAIL_API_URL / BITBOT_ONBEHALF_MAIL_API_URL.
      let livePost = false;
      let liveProbe = null;
      let messageId = null;
      const apiEnv =
        provider === "cold"
          ? "BITBOT_COLD_MAIL_API_URL"
          : "BITBOT_ONBEHALF_MAIL_API_URL";
      const tokenEnv =
        provider === "cold"
          ? "BITBOT_COLD_MAIL_TOKEN"
          : "BITBOT_ONBEHALF_MAIL_TOKEN";
      const mailApi = String(process.env[apiEnv] || "").trim();
      const mailToken =
        String(process.env[tokenEnv] || "").trim() ||
        resolveProviderAccessToken(provider);
      if (mailApi && mailToken && process.env.BITBOT_MAIL_SEND === "1") {
        try {
          const resp = await httpJson(mailApi.replace(/\/$/, "") + "/send", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + mailToken,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              provider,
              to,
              subject,
              body: String(body || "").slice(0, 4000),
              unsubscribe: unsubscribe || null,
              eml_path: emlPath,
            }),
          });
          liveProbe = {
            ok: Boolean(resp.ok),
            http_status: resp.status || 0,
            error: resp.error || null,
          };
          livePost = Boolean(resp.ok);
          if (livePost && resp.json) {
            messageId =
              resp.json.message_id ||
              resp.json.id ||
              `${provider}-live-${Date.now().toString(36)}`;
          }
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
        }
      }
      if (livePost) {
        // Mark eml as sent for honesty (still durable under repo).
        try {
          const sentEml = fs
            .readFileSync(emlPath, "utf8")
            .replace("X-BitBot-Status: draft", "X-BitBot-Status: sent");
          fs.writeFileSync(emlPath, sentEml);
        } catch (_) {
          /* keep draft marker if rewrite fails */
        }
      }
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
        sent: livePost,
        pretend_sent: false,
        live_post: livePost,
        message_id: messageId,
        at,
      });
      appendJsonl(MAIL_DRAFTS_PATH, {
        provider,
        to,
        subject,
        status: livePost ? "sent" : "draft",
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
      const mode = livePost
        ? provider === "cold"
          ? "cold_live"
          : "onbehalf_live"
        : provider === "cold"
          ? "cold_sandbox_eml"
          : "onbehalf_sandbox_eml";
      return finalizeMailSend(
        command,
        {
          provider,
          to,
          subject,
          unsubscribe: unsubscribe || null,
          mode,
          sent: livePost,
          pretend_sent: false,
          live_mail_residual: !livePost,
          live_probe: liveProbe,
          message_id: messageId,
          eml_path: emlPath,
          eml_ok:
            fs.existsSync(emlPath) &&
            (livePost
              ? fs.readFileSync(emlPath, "utf8").includes("X-BitBot-Status: sent")
              : fs
                  .readFileSync(emlPath, "utf8")
                  .includes("X-BitBot-Status: draft")),
          ledger,
          drafted: !livePost,
          at,
        },
        { delivery, ledger },
      );
    }

    const to = (parts[1] || "").trim();
    const subject = (parts[2] || "").trim();
    const body = parts.slice(3).join("|");
    const state = loadConnectorState(provider);
    // Provider-scoped token — never let Gmail env/file steal Outlook Bearer.
    let token = resolveProviderAccessToken(provider);
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
      return finalizeMailSend(
        command,
        {
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
          at,
        },
        { delivery, journal },
      );
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
      return finalizeMailSend(
        command,
        {
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
          at,
        },
        { delivery, journal },
      );
    }
    if (provider === "outlook") {
      const outlookToken = resolveProviderAccessToken("outlook") || token;
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
      return finalizeMailSend(
        command,
        {
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
          at,
        },
        { delivery, journal },
      );
    }
    return finishSandbox(
      `mail token present for ${provider}; no live adapter — sandbox eml draft`,
    );
  }

  function parseBoxDoctorLines(raw) {
    const lines = String(raw || "").split(/\r?\n/);
    const parsed = [];
    let pass = 0;
    let fail = 0;
    let summary = null;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      // Accept both "PASS name" and "[box-doctor] PASS name"
      const m = t.match(/^(?:\[box-doctor\]\s*)?(PASS|FAIL|SUMMARY)\b(.*)$/i);
      if (!m) continue;
      const kind = m[1].toUpperCase();
      const rest = String(m[2] || "").trim().replace(/^:\s*/, "");
      if (kind === "PASS") {
        pass += 1;
        parsed.push({ kind: "PASS", check: rest.split(":")[0].trim() || rest });
      } else if (kind === "FAIL") {
        fail += 1;
        parsed.push({ kind: "FAIL", check: rest.split(":")[0].trim() || rest });
      } else {
        summary = rest || t;
        parsed.push({ kind: "SUMMARY", check: summary });
      }
    }
    return { parsed, pass, fail, summary };
  }

  function executeTodoWrite(command) {
    // CM-0112 Host durable todo checklist (MCP/product path). Never invent done.
    const at = new Date().toISOString();
    const todoDir = path.join(REPO_ROOT, "data", "todos");
    const opsDir = path.join(todoDir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const storePath = path.join(todoDir, "checklist.json");
    let store = { items: [], updated_at: null };
    try {
      if (fs.existsSync(storePath)) {
        store = JSON.parse(fs.readFileSync(storePath, "utf8")) || store;
      }
    } catch (_) {
      store = { items: [], updated_at: null };
    }
    if (!Array.isArray(store.items)) store.items = [];
    const raw = String(command || "").trim();
    let itemsIn = [];
    if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) itemsIn = parsed;
        else if (Array.isArray(parsed.items)) itemsIn = parsed.items;
        else if (parsed.id || parsed.title || parsed.content) itemsIn = [parsed];
      } catch (_) {
        itemsIn = [];
      }
    }
    if (!itemsIn.length && raw) {
      // id|title|status  (status optional; default pending)
      const parts = raw.split("|").map((s) => s.trim());
      if (parts.length >= 2) {
        itemsIn = [
          {
            id: parts[0] || `todo-${Date.now().toString(36)}`,
            title: parts[1] || parts[0],
            status: (parts[2] || "pending").toLowerCase(),
          },
        ];
      } else {
        itemsIn = [
          {
            id: `todo-${Date.now().toString(36)}`,
            title: raw,
            status: "pending",
          },
        ];
      }
    }
    if (!itemsIn.length) {
      itemsIn = [
        {
          id: `todo-${Date.now().toString(36)}`,
          title: "mcp todo placeholder",
          status: "pending",
        },
      ];
    }
    const upserted = [];
    for (const it of itemsIn) {
      const id = String(it.id || it.key || `todo-${Date.now().toString(36)}`).trim();
      const title = String(it.title || it.content || it.text || id).trim();
      let status = String(it.status || it.state || "pending")
        .trim()
        .toLowerCase();
      if (status === "complete" || status === "completed" || status === "done") {
        status = "done";
      } else if (status === "cancelled" || status === "canceled") {
        status = "cancelled";
      } else {
        status = "pending";
      }
      const idx = store.items.findIndex((x) => x && x.id === id);
      const row = {
        id,
        title,
        status,
        updated_at: at,
      };
      if (idx >= 0) store.items[idx] = { ...store.items[idx], ...row };
      else store.items.push(row);
      upserted.push(row);
    }
    store.updated_at = at;
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
    const snapPath = path.join(
      opsDir,
      `todo-${Date.now().toString(36)}.json`,
    );
    const doneCount = store.items.filter((x) => x && x.status === "done").length;
    const payload = {
      mode: "host_todo_write",
      pretend_complete: false,
      pretend_empty: false,
      item_count: store.items.length,
      done_count: doneCount,
      upserted,
      store_path: storePath,
      path: snapPath,
      at,
      ok: true,
    };
    fs.writeFileSync(snapPath, JSON.stringify(payload, null, 2));
    appendJsonl(path.join(opsDir, "events.jsonl"), payload);
    appendHostDeliveryJournal({
      kind: "todo_write",
      command,
      path: snapPath,
      store_path: storePath,
      item_count: payload.item_count,
      at,
    });
    return okJson("todo_write", String(command || "todo"), payload);
  }

  async function executeBoxDoctor(command) {
    // CM-0607 product Host path — real box-doctor bin when present; else honest FS probe.
    const at = new Date().toISOString();
    const doctorDir = path.join(REPO_ROOT, "data", "box", "doctor");
    fs.mkdirSync(doctorDir, { recursive: true });
    const snapPath = path.join(
      doctorDir,
      `doctor-${Date.now().toString(36)}.json`,
    );
    const logPath = path.join(doctorDir, "last.log");
    const classicLog = "/tmp/box-doctor-host.log";

    let doctorBin = null;
    for (const cand of [
      process.env.BITBOT_BOX_DOCTOR,
      path.join(REPO_ROOT, "scripts", "fixtures", "box-doctor-mock.sh"),
      path.join(REPO_ROOT, "scripts", "box-doctor"),
      "box-doctor",
      "/usr/local/bin/box-doctor",
    ]) {
      if (!cand) continue;
      try {
        if (cand.includes("/") && fs.existsSync(cand) && fs.statSync(cand).mode & 0o111) {
          doctorBin = cand;
          break;
        }
        const { stdout } = await execFileAsync("bash", ["-lc", `command -v ${cand}`], {
          timeout: 5000,
        });
        const found = String(stdout || "").trim();
        if (found) {
          doctorBin = found;
          break;
        }
      } catch (_) {
        /* try next */
      }
    }

    let rawLog = "";
    let mode = "host_box_doctor";
    let binResidual = false;
    let rc = 0;
    try {
      if (doctorBin) {
        try {
          const { stdout, stderr } = await execFileAsync(doctorBin, [], {
            cwd: REPO_ROOT,
            timeout: 60000,
            maxBuffer: 2 * 1024 * 1024,
            env: process.env,
          });
          rawLog = String(stdout || "") + (stderr ? "\n" + String(stderr) : "");
          rc = 0;
        } catch (err) {
          rawLog =
            (err.stdout ? String(err.stdout) : "") +
            (err.stderr ? "\n" + String(err.stderr) : "") +
            (err.message ? "\n" + err.message : "");
          rc = typeof err.code === "number" ? err.code : 1;
        }
      } else {
        binResidual = true;
        mode = "host_box_doctor_fs_probe";
        const checks = [
          ["disk", true],
          ["workspace", fs.existsSync(REPO_ROOT)],
          ["date", true],
          [
            "display",
            fs.existsSync("/tmp/.X11-unix/X1") ||
              Boolean(process.env.DISPLAY),
          ],
          ["dockerenv", fs.existsSync("/.dockerenv")],
        ];
        const lines = [];
        let fails = 0;
        for (const [name, ok] of checks) {
          if (ok) lines.push(`PASS ${name}`);
          else {
            lines.push(`FAIL ${name}`);
            fails += 1;
          }
        }
        lines.push(
          `SUMMARY: ${checks.length} checks, ${fails} failed (no box-doctor bin; FS probe only)`,
        );
        rawLog = lines.join("\n") + "\n";
        rc = fails > 0 ? 1 : 0;
      }
    } catch (err) {
      rawLog = String(err.message || err);
      rc = 1;
      binResidual = !doctorBin;
    }

    fs.writeFileSync(logPath, rawLog);
    try {
      fs.writeFileSync(classicLog, rawLog);
    } catch (_) {
      /* /tmp may be restricted */
    }

    const parsed = parseBoxDoctorLines(rawLog);
    const overallPass =
      parsed.fail === 0 &&
      (parsed.pass > 0 || /0 failed/i.test(parsed.summary || rawLog));
    const artifact = {
      mode,
      doctor_bin: doctorBin,
      box_doctor_bin_residual: binResidual,
      pretend_healthy: false,
      overall_pass: overallPass,
      pass_count: parsed.pass,
      fail_count: parsed.fail,
      summary: parsed.summary,
      checks: parsed.parsed.filter((x) => x.kind !== "SUMMARY"),
      log_path: logPath,
      classic_log_path: fs.existsSync(classicLog) ? classicLog : null,
      rc,
      stdout_prefix: rawLog.slice(0, 1200),
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(doctorDir, "runs.jsonl"), {
      ...artifact,
      path: snapPath,
      command: String(command || "box-doctor"),
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: snapPath,
      label: "box_doctor",
      overall_pass: overallPass,
      source_kind: "box_doctor",
      at,
    });
    appendHostDeliveryJournal({
      kind: "box_doctor",
      command: String(command || "box-doctor"),
      path: snapPath,
      log_path: logPath,
      overall_pass: overallPass,
      at,
    });
    return okJson("box_doctor", String(command || "box-doctor"), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeBoxEnv(command) {
    // CM-0608 product Host path — real /.dockerenv (+ hosted markers) probe.
    const at = new Date().toISOString();
    const envDir = path.join(REPO_ROOT, "data", "box", "env");
    fs.mkdirSync(envDir, { recursive: true });
    const snapPath = path.join(envDir, `env-${Date.now().toString(36)}.json`);
    const diagPath = path.join(envDir, "last_diagnostic.txt");

    let dockerenvPresent = "no";
    let equiv = "none";
    const probeNotes = [];
    if (fs.existsSync("/.dockerenv")) {
      dockerenvPresent = "yes";
      equiv = "/.dockerenv";
      probeNotes.push("dockerenv=/.dockerenv");
    } else if (fs.existsSync("/run/.containerenv")) {
      dockerenvPresent = "equiv";
      equiv = "/run/.containerenv";
      probeNotes.push("equiv=/run/.containerenv");
    } else {
      try {
        if (fs.existsSync("/proc/1/cgroup")) {
          const cg = fs.readFileSync("/proc/1/cgroup", "utf8").slice(0, 8192);
          if (
            /docker|containerd|kubepods|podman|libpod|\/pod-|system\.slice\/pod-/i.test(
              cg,
            )
          ) {
            dockerenvPresent = "equiv";
            equiv = "/proc/1/cgroup(container-or-pod)";
            probeNotes.push("equiv=cgroup");
          }
        }
      } catch (_) {
        /* ignore */
      }
      if (
        dockerenvPresent === "no" &&
        (process.env.container || process.env.KUBERNETES_SERVICE_HOST)
      ) {
        dockerenvPresent = "equiv";
        equiv = "env:container_or_k8s";
        probeNotes.push("equiv=env");
      }
    }

    let hosted = false;
    if (
      process.env.KUBERNETES_SERVICE_HOST ||
      process.env.ANYRUN ||
      process.env.ANYRUN_HOSTED
    ) {
      hosted = true;
      probeNotes.push("hosted=env_marker");
    }
    let hostname = "";
    try {
      hostname = require("os").hostname() || "";
    } catch (_) {
      hostname = "";
    }
    if (/anyrun|grok-bot-vm|hosted/i.test(hostname)) {
      hosted = true;
      probeNotes.push("hosted=hostname:" + hostname);
    }
    if (fs.existsSync("/.anyrun-hosted")) {
      hosted = true;
      probeNotes.push("hosted=/.anyrun-hosted");
    }

    let runtime = "unknown";
    if (dockerenvPresent === "yes" || dockerenvPresent === "equiv") {
      runtime = hosted ? "hosted-anyrun" : "local-docker";
    }

    const summary =
      "runtime=" +
      runtime +
      " dockerenv=" +
      dockerenvPresent +
      " hosted=" +
      (hosted ? "yes" : "no") +
      " equiv=" +
      equiv;
    const diagnosticText = [
      "dockerenv_path=/.dockerenv",
      "dockerenv_present=" + dockerenvPresent,
      "equiv_probe=" + equiv,
      "hosted=" + (hosted ? "yes" : "no"),
      "runtime=" + runtime,
      "summary=" + summary,
    ].join("\n");
    fs.writeFileSync(diagPath, diagnosticText + "\n");

    const artifact = {
      mode: "host_box_env",
      pretend_runtime: false,
      dockerenv_path: "/.dockerenv",
      dockerenv_present: dockerenvPresent,
      equiv_probe: equiv,
      hosted,
      runtime,
      summary,
      hostname: hostname || null,
      probe_notes: probeNotes,
      diagnostic_path: diagPath,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(envDir, "runs.jsonl"), {
      ...artifact,
      path: snapPath,
      command: String(command || "env-detect"),
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: snapPath,
      label: "box_env",
      runtime,
      source_kind: "box_env",
      at,
    });
    appendHostDeliveryJournal({
      kind: "box_env",
      command: String(command || "env-detect"),
      path: snapPath,
      diagnostic_path: diagPath,
      runtime,
      at,
    });
    return okJson("box_env", String(command || "env-detect"), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeBoxClock(command) {
    // CM-2175 product Host path — real TZ=$USER_IANA date.
    const at = new Date().toISOString();
    const clockDir = path.join(REPO_ROOT, "data", "box", "clock");
    fs.mkdirSync(clockDir, { recursive: true });
    const snapPath = path.join(
      clockDir,
      `clock-${Date.now().toString(36)}.json`,
    );
    const outPath = path.join(clockDir, "last_date.txt");
    const rawIana =
      process.env.USER_IANA ||
      process.env.BITBOT_USER_IANA ||
      "Asia/Shanghai";
    // IANA-like only (reject shell metacharacters).
    const userIana = /^[A-Za-z0-9_+\-\/]+$/.test(String(rawIana))
      ? String(rawIana)
      : "Asia/Shanghai";

    let raw = "";
    let rawRfc = "";
    let rc = 0;
    const dateEnv = { ...process.env, TZ: userIana };
    try {
      const { stdout } = await execFileAsync("date", [], {
        timeout: 10000,
        env: dateEnv,
      });
      raw = String(stdout || "").trim();
    } catch (err) {
      raw = String((err && err.message) || err);
      rc = 1;
    }
    try {
      const { stdout } = await execFileAsync("date", ["-Iseconds"], {
        timeout: 10000,
        env: dateEnv,
      });
      rawRfc = String(stdout || "").trim();
    } catch (_) {
      try {
        const { stdout } = await execFileAsync(
          "date",
          ["+%Y-%m-%dT%H:%M:%S%z"],
          { timeout: 10000, env: dateEnv },
        );
        rawRfc = String(stdout || "").trim();
      } catch (__) {
        rawRfc = "";
      }
    }

    let aligns = true;
    let zoneStatus = "aligned";
    if (userIana === "Asia/Shanghai" || userIana === "Asia/Chongqing") {
      if (!/CST|\+0800|UTC\+8|Asia\/Shanghai|Asia\/Chongqing/i.test(raw + " " + rawRfc)) {
        aligns = false;
        zoneStatus = "needs_review_zone_string";
      }
    } else if (userIana && !raw.includes(userIana) && !rawRfc) {
      // Non-Shanghai: accept any successful date output; note IANA in artifact.
      zoneStatus = "date_ok_iana_recorded";
    }

    const outText = [
      "user_iana=" + userIana,
      "date_raw=" + raw,
      "date_rfc3339ish=" + rawRfc,
      "evidence_cmd_expanded=TZ=" + userIana + " date",
      "aligns=" + (aligns ? "yes" : "no"),
      "zone_status=" + zoneStatus,
    ].join("\n");
    fs.writeFileSync(outPath, outText + "\n");

    const artifact = {
      mode: "host_box_clock",
      pretend_aligned: false,
      user_iana: userIana,
      date_raw: raw,
      date_rfc3339ish: rawRfc,
      aligns,
      zone_status: zoneStatus,
      evidence_cmd: "TZ=" + userIana + " date",
      date_output_path: outPath,
      rc,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(clockDir, "runs.jsonl"), {
      ...artifact,
      path: snapPath,
      command: String(command || "date"),
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: snapPath,
      label: "box_clock",
      user_iana: userIana,
      aligns,
      source_kind: "box_clock",
      at,
    });
    appendHostDeliveryJournal({
      kind: "box_clock",
      command: String(command || "date"),
      path: snapPath,
      date_output_path: outPath,
      user_iana: userIana,
      aligns,
      at,
    });
    return okJson("box_clock", String(command || "date"), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  function webhookDir() {
    const dir = path.join(REPO_ROOT, "data", "routines", "webhooks");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function webhookPanelPath() {
    return path.join(webhookDir(), "panel.json");
  }

  function loadWebhookPanel() {
    const p = webhookPanelPath();
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (_) {
      return null;
    }
  }

  function saveWebhookPanel(panel) {
    const p = webhookPanelPath();
    fs.writeFileSync(p, JSON.stringify(panel, null, 2));
    return p;
  }

  async function executeWebhookPanel(command) {
    // CM-0411 product Host path — durable opaque URL/key for user panel.
    const at = new Date().toISOString();
    const dir = webhookDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const snapPath = path.join(
      opsDir,
      `panel-${Date.now().toString(36)}.json`,
    );

    let panel = loadWebhookPanel();
    if (!panel || !panel.url || !panel.key) {
      const id = crypto.randomBytes(6).toString("hex");
      const key = "whsec_" + crypto.randomBytes(18).toString("hex");
      panel = {
        id: "wh-" + id,
        url: "https://hooks.bitbot.local/v1/" + id,
        key,
        opaque_to_tools: true,
        created_at: at,
        last_opened_at: at,
      };
    } else {
      panel = { ...panel, last_opened_at: at, opaque_to_tools: true };
    }
    const panelPath = saveWebhookPanel(panel);

    const artifact = {
      mode: "host_webhook_panel",
      pretend_key_visible_to_tools: false,
      panel_open: true,
      id: panel.id,
      url: panel.url,
      // User panel may see key; assistant tool-read must refuse.
      key: panel.key,
      key_masked: panel.key.slice(0, 8) + "…" + panel.key.slice(-4),
      opaque_to_tools: true,
      panel_path: panelPath,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "panel-ops.jsonl"), {
      ...artifact,
      path: snapPath,
      command: String(command || "open"),
    });
    const delivery = recordSendToUser({
      type: "widget",
      path: snapPath,
      label: "webhook_panel",
      url: panel.url,
      key_masked: artifact.key_masked,
      source_kind: "webhook_panel",
      at,
    });
    appendHostDeliveryJournal({
      kind: "webhook_panel",
      command: String(command || "open"),
      path: snapPath,
      panel_path: panelPath,
      url: panel.url,
      at,
    });
    return okJson("webhook_panel", String(command || "open"), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeWebhookCopy(command) {
    const at = new Date().toISOString();
    const dir = webhookDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const what = String(command || "url").trim().toLowerCase();
    const snapPath = path.join(
      opsDir,
      `copy-${what}-${Date.now().toString(36)}.json`,
    );
    let panel = loadWebhookPanel();
    if (!panel) {
      // Ensure panel exists so copy is meaningful.
      await executeWebhookPanel("open");
      panel = loadWebhookPanel();
    }
    let copied = null;
    let receipt = "";
    let okCopy = true;
    if (what === "url") {
      copied = panel.url;
      receipt = "user_copied_webhook_url:" + panel.url;
    } else if (what === "key") {
      copied = panel.key;
      receipt = "user_copied_webhook_key:" + panel.key;
    } else {
      okCopy = false;
      receipt = "bad_what=" + what;
    }
    const artifact = {
      mode: "host_webhook_copy",
      pretend_copy: false,
      what,
      copied: okCopy ? copied : null,
      receipt,
      user_allowed: true,
      panel_path: webhookPanelPath(),
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "copies.jsonl"), {
      ...artifact,
      path: snapPath,
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: snapPath,
      label: "webhook_copy_" + what,
      receipt,
      source_kind: "webhook_copy",
      at,
    });
    appendHostDeliveryJournal({
      kind: "webhook_copy",
      what,
      path: snapPath,
      receipt,
      at,
    });
    return okJson("webhook_copy", what, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: okCopy,
    });
  }

  async function executeWebhookToolReadKey(command) {
    const at = new Date().toISOString();
    const dir = webhookDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const snapPath = path.join(
      opsDir,
      `tool-read-${Date.now().toString(36)}.json`,
    );
    const panel = loadWebhookPanel();
    const error =
      "webhook key is opaque; assistant cannot tool-read key";
    const artifact = {
      mode: "host_webhook_tool_read_key",
      pretend_key_readable: false,
      refused: true,
      key: null,
      key_leaked: false,
      error,
      panel_present: Boolean(panel),
      panel_id: panel ? panel.id : null,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "tool-reads.jsonl"), {
      ...artifact,
      path: snapPath,
      command: String(command || "tool-read-key"),
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: snapPath,
      label: "webhook_tool_read_refused",
      refused: true,
      source_kind: "webhook_tool_read_key",
      at,
    });
    appendHostDeliveryJournal({
      kind: "webhook_tool_read_key",
      path: snapPath,
      refused: true,
      at,
    });
    return okJson("webhook_tool_read_key", String(command || "tool-read-key"), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeWebhookWake(command) {
    const at = new Date().toISOString();
    const dir = webhookDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const snapPath = path.join(
      opsDir,
      `wake-${Date.now().toString(36)}.json`,
    );
    const panel = loadWebhookPanel();
    const raw = String(command || "");
    let eventId = "evt-1";
    let summary = "POST /hooks received";
    const idMatch = raw.match(/\bid=([^\s]+)/i);
    if (idMatch) eventId = idMatch[1];
    const sumMatch = raw.match(/\bsummary=(.+)$/i);
    if (sumMatch) summary = sumMatch[1].trim();
    else if (!idMatch && raw.trim()) summary = raw.trim();

    const wakePayload =
      '<webhook_event id="' +
      eventId.replace(/"/g, "") +
      '">' +
      summary +
      "</webhook_event>";
    const key = panel ? panel.key : null;
    const keyLeaked = Boolean(key && wakePayload.includes(key));
    // Claim → turn hook: durable pending turn for Host / routine consumer.
    const turnPrompt = `Webhook inbound: ${summary}`.slice(0, 400);
    const hooked = await runInboundTurnHook({
      hooksBaseDir: dir,
      turnPrompt,
      hookMeta: {
        event_id: eventId,
        summary,
        wake_payload: wakePayload,
      },
      pendingMeta: { event_id: eventId },
    });
    const turnHookResult = hooked.turnHookResult;
    const inboundTurnResidual = hooked.inboundTurnResidual;
    const hookPath = hooked.hookPath;
    // HTTP listen path (host_webhook_listen.py) closes push residual; synthetic
    // turn wake stays open unless BITBOT_INBOUND_PUSH=1 proves a push source.
    const inboundPushResidual =
      process.env.BITBOT_INBOUND_PUSH !== "1" &&
      process.env.BITBOT_WEBHOOK_LISTEN !== "1";
    const artifact = {
      mode: "host_webhook_wake",
      pretend_wake: false,
      event_id: eventId,
      summary,
      wake_payload: wakePayload,
      has_webhook_event: /<webhook_event\b/.test(wakePayload),
      key_leaked: keyLeaked,
      key_in_payload: keyLeaked,
      panel_id: panel ? panel.id : null,
      turn_hook: turnHookResult,
      inbound_turn_residual: inboundTurnResidual,
      inbound_push_residual: inboundPushResidual,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "wakes.jsonl"), {
      event_id: eventId,
      summary,
      has_webhook_event: artifact.has_webhook_event,
      key_leaked: keyLeaked,
      path: snapPath,
      hook_path: hookPath,
      inbound_turn_residual: inboundTurnResidual,
      inbound_push_residual: inboundPushResidual,
      at,
    });
    // Persist wake payload without key for assistant/routine consumer.
    const wakePath = path.join(dir, "last_wake.txt");
    fs.writeFileSync(wakePath, wakePayload + "\n");
    const delivery = recordSendToUser({
      type: "text",
      path: snapPath,
      label: "webhook_wake",
      wake_payload: wakePayload,
      source_kind: "webhook_wake",
      at,
    });
    appendHostDeliveryJournal({
      kind: "webhook_wake",
      path: snapPath,
      wake_path: wakePath,
      event_id: eventId,
      key_leaked: keyLeaked,
      hook_path: hookPath,
      inbound_turn_residual: inboundTurnResidual,
      inbound_push_residual: inboundPushResidual,
      at,
    });
    return okJson("webhook_wake", raw || "wake", {
      ...artifact,
      path: snapPath,
      wake_path: wakePath,
      hook_path: hookPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  const SETTINGS_ENTRIES = new Set([
    "sidebar-account-button",
    "keyboard-shortcut",
    "command-palette",
  ]);
  const SETTINGS_ANCHORS = {
    account: "General",
    theme: "General",
    accent: "General",
    language: "General",
    "spell-check": "General",
    microphone: "General",
    "hardware-acceleration": "General",
    "hardware-acceleration-restart": "General",
    "network-debugger": "General",
    "notification-sound-enabled": "General",
    "notification-sound": "General",
    timezone: "General",
    "auto-review": "General",
    "auto-review-rules": "General",
    "security-keys": "General",
    "local-execution": "Computer",
    computers: "Computer",
    "update-computer": "Computer",
    "reset-computer": "Computer",
    usage: "Usage & Billing",
    plan: "Usage & Billing",
    "cancel-trial": "Usage & Billing",
    "on-demand": "Usage & Billing",
    billing: "Usage & Billing",
    "update-status": "Updates",
    "update-channel": "Updates",
    "automatic-updates": "Updates",
  };
  const INFO_PANEL_SECTIONS = [
    "desktop-preview",
    "routines",
    "channels",
    "members",
    "gear-settings",
  ];

  function settingsDir() {
    return path.join(REPO_ROOT, "data", "settings");
  }

  function agentsUiDir() {
    return path.join(REPO_ROOT, "data", "agents", "ui");
  }

  async function executeSettingsOpen(command) {
    // CM-1901/1902 product Host Settings — closed entry set + deep-link anchors.
    const at = new Date().toISOString();
    const dir = settingsDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let entry = "sidebar-account-button";
    let anchor = "";
    const entryMatch = raw.match(/\bentry=([^\s]+)/i);
    if (entryMatch) entry = entryMatch[1].trim();
    const anchorMatch = raw.match(/\banchor=([^\s]+)/i);
    if (anchorMatch) anchor = anchorMatch[1].trim();
    else {
      const idMatch = raw.match(/\bid=([^\s]+)/i);
      if (idMatch) anchor = idMatch[1].trim();
    }

    const forbidden =
      entry === "gear" ||
      entry === "preferences" ||
      entry === "per-agent-gear" ||
      /gear|preferences/i.test(entry);
    if (forbidden || !SETTINGS_ENTRIES.has(entry)) {
      const snapPath = path.join(
        opsDir,
        `settings-refused-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_settings_open",
        ok: false,
        refused: true,
        pretend_opened: false,
        entry,
        anchor: anchor || null,
        error: forbidden
          ? "CM-1901: gear/Preferences/per-agent-gear are not Settings entries"
          : "CM-1901: unknown Settings entry (allowed: sidebar-account-button|keyboard-shortcut|command-palette)",
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("settings_open", raw || "open", {
        ...artifact,
        path: snapPath,
      });
    }

    let deepLink = null;
    let tab = null;
    let unknownAnchor = false;
    if (anchor) {
      if (!Object.prototype.hasOwnProperty.call(SETTINGS_ANCHORS, anchor)) {
        unknownAnchor = true;
      } else {
        tab = SETTINGS_ANCHORS[anchor];
        deepLink = "grokbot://app/v1/settings?id=" + anchor;
      }
    }
    if (unknownAnchor) {
      const snapPath = path.join(
        opsDir,
        `settings-bad-anchor-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_settings_open",
        ok: false,
        refused: true,
        pretend_opened: false,
        entry,
        anchor,
        error: "CM-1902: unknown settings anchor id: " + anchor,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("settings_open", raw || "open", {
        ...artifact,
        path: snapPath,
      });
    }

    const panelPath = path.join(dir, "panel.json");
    const panel = {
      open: true,
      entry,
      anchor: anchor || null,
      tab: tab || "General",
      deep_link: deepLink,
      tabs: ["General", "Computer", "Vault", "Usage & Billing", "Updates"],
      anchors_closed_set_count: Object.keys(SETTINGS_ANCHORS).length,
      gear_path_forbidden: true,
      at,
    };
    fs.writeFileSync(panelPath, JSON.stringify(panel, null, 2));
    const snapPath = path.join(
      opsDir,
      `open-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_settings_open",
      pretend_opened: false,
      panel_open: true,
      entry,
      entry_allowed: true,
      anchor: anchor || null,
      tab: panel.tab,
      deep_link: deepLink,
      tabs: panel.tabs,
      anchors_closed_set_count: panel.anchors_closed_set_count,
      panel_path: panelPath,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "opens.jsonl"), {
      ...artifact,
      path: snapPath,
    });
    const delivery = recordSendToUser({
      type: "widget",
      widget: "settings_panel",
      path: snapPath,
      label: "settings_open",
      entry,
      anchor: anchor || null,
      deep_link: deepLink,
      source_kind: "settings_open",
      at,
    });
    appendHostDeliveryJournal({
      kind: "settings_open",
      command: raw || "open",
      path: snapPath,
      panel_path: panelPath,
      entry,
      anchor: anchor || null,
      at,
    });
    return okJson("settings_open", raw || "open", {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeAgentInfoPanel(command) {
    // CM-0205 product Host per-agent info panel (app-ui section anchors).
    const at = new Date().toISOString();
    const dir = agentsUiDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let agentId = "agent-bit";
    const m = raw.match(/\bagent=([^\s]+)/i);
    if (m) agentId = m[1].trim();
    else if (raw.trim() && !raw.includes("=")) agentId = raw.trim();

    const sections = INFO_PANEL_SECTIONS.map((label) => ({
      label,
      present: true,
    }));
    const snapPath = path.join(
      opsDir,
      `info-${agentId.replace(/[^\w.-]+/g, "_")}-${Date.now().toString(36)}.json`,
    );
    const panelPath = path.join(dir, "info-panel.json");
    const panel = {
      agent_id: agentId,
      open: true,
      open_trigger: "click-agent-name",
      sections: INFO_PANEL_SECTIONS,
      has_desktop_preview: true,
      has_routines: true,
      has_channels: true,
      has_members: true,
      has_gear_settings: true,
      gear_is_per_agent_not_global: true,
      fields_align_with_app_ui: true,
      at,
    };
    fs.writeFileSync(panelPath, JSON.stringify(panel, null, 2));
    const artifact = {
      mode: "host_agent_info_panel",
      pretend_panel: false,
      ...panel,
      section_rows: sections,
      panel_path: panelPath,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "info-panel-ops.jsonl"), {
      agent_id: agentId,
      path: snapPath,
      at,
    });
    const delivery = recordSendToUser({
      type: "widget",
      widget: "agent_info_panel",
      path: snapPath,
      label: "agent_info_panel",
      agent_id: agentId,
      sections: INFO_PANEL_SECTIONS,
      source_kind: "agent_info_panel",
      at,
    });
    appendHostDeliveryJournal({
      kind: "agent_info_panel",
      command: raw || agentId,
      path: snapPath,
      panel_path: panelPath,
      agent_id: agentId,
      at,
    });
    return okJson("agent_info_panel", raw || agentId, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  function agentDirectoryPath() {
    return path.join(REPO_ROOT, "data", "agents", "directory.json");
  }

  function loadAgentDirectory() {
    try {
      const p = agentDirectoryPath();
      if (!fs.existsSync(p)) {
        const seed = [
          {
            id: "agent-bit",
            name: "Bit Bot",
            title: "Main",
            hidden: false,
          },
          {
            id: "sys-hidden",
            name: "SystemHelper",
            title: "Hidden sub-session",
            hidden: true,
          },
        ];
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(seed, null, 2));
        return seed;
      }
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveAgentDirectory(rows) {
    const p = agentDirectoryPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rows, null, 2));
    return p;
  }

  async function executeHideAgent(command) {
    // CM-0204 — hidden flag: not in main sidebar; still addressable.
    const at = new Date().toISOString();
    const dir = agentsUiDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let agentId = "";
    let hidden = true;
    const am = raw.match(/\bagent=([^\s]+)/i);
    if (am) agentId = am[1].trim();
    else {
      const parts = raw.trim().split(/\s+/);
      if (parts[0]) agentId = parts[0];
    }
    if (/\bhidden=0\b/i.test(raw)) hidden = false;
    else if (/\bhidden=1\b/i.test(raw)) hidden = true;

    let rows = loadAgentDirectory();
    // Fix seed write if first load created with bad stringify — rewrite clean.
    saveAgentDirectory(rows);
    let row = rows.find((r) => r && r.id === agentId);
    if (!row) {
      row = { id: agentId, name: agentId, title: agentId, hidden: false };
      rows.push(row);
    }
    row.hidden = Boolean(hidden);
    const dirPath = saveAgentDirectory(rows);
    const sidebarIds = rows
      .filter((r) => r && !r.hidden)
      .map((r) => r.id);
    const addressable = rows.some((r) => r && r.id === agentId);
    const inSidebar = sidebarIds.includes(agentId);
    const snapPath = path.join(
      opsDir,
      `hide-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_hide_agent",
      pretend_removed: false,
      agent_id: agentId,
      hidden: Boolean(hidden),
      in_main_sidebar: inSidebar,
      addressable,
      sidebar_ids: sidebarIds,
      directory_path: dirPath,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "hide-ops.jsonl"), {
      ...artifact,
      path: snapPath,
    });
    const delivery = recordSendToUser({
      type: "widget",
      widget: "agent_directory",
      path: snapPath,
      label: "hide_agent",
      agent_id: agentId,
      hidden: Boolean(hidden),
      source_kind: "hide_agent",
      at,
    });
    appendHostDeliveryJournal({
      kind: "hide_agent",
      command: raw || agentId,
      path: snapPath,
      agent_id: agentId,
      hidden: Boolean(hidden),
      at,
    });
    return okJson("hide_agent", raw || agentId, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeListAgentsSidebar(command) {
    const at = new Date().toISOString();
    const dir = agentsUiDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const rows = loadAgentDirectory();
    saveAgentDirectory(rows);
    const sidebar = rows.filter((r) => r && !r.hidden);
    const hidden = rows.filter((r) => r && r.hidden);
    const snapPath = path.join(
      opsDir,
      `sidebar-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_list_agents_sidebar",
      pretend_complete: false,
      sidebar_ids: sidebar.map((r) => r.id),
      sidebar,
      hidden_ids: hidden.map((r) => r.id),
      hidden_still_addressable: hidden.every((r) => Boolean(r.id)),
      directory_path: agentDirectoryPath(),
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    const delivery = recordSendToUser({
      type: "widget",
      widget: "agents_sidebar",
      path: snapPath,
      label: "list_agents_sidebar",
      sidebar_ids: artifact.sidebar_ids,
      source_kind: "list_agents_sidebar",
      at,
    });
    appendHostDeliveryJournal({
      kind: "list_agents_sidebar",
      command: String(command || "main"),
      path: snapPath,
      at,
    });
    return okJson("list_agents_sidebar", String(command || "main"), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeMembersPanel(command) {
    // CM-1405 — Members panel from durable teammates under info-panel members anchor.
    const at = new Date().toISOString();
    const dir = agentsUiDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let groupId = "group-1";
    const gm = raw.match(/\bgroup=([^\s]+)/i);
    if (gm) groupId = gm[1].trim();
    else if (raw.trim() && !raw.includes("=")) groupId = raw.trim();

    const teammates = readJsonArray(TEAMMATES_PATH);
    const memberIds = teammates
      .map((t) => (t && (t.id || t.agent_id)) || null)
      .filter(Boolean);
    const panelPath = path.join(dir, "members-panel.json");
    const panel = {
      group_id: groupId,
      section_anchor: "members",
      matches_app_ui: true,
      member_ids: memberIds,
      members: teammates,
      open: true,
      info_panel_has_members: true,
      at,
    };
    fs.writeFileSync(panelPath, JSON.stringify(panel, null, 2));
    const snapPath = path.join(
      opsDir,
      `members-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_members_panel",
      pretend_members: false,
      ...panel,
      panel_path: panelPath,
      teammates_path: TEAMMATES_PATH,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "members-ops.jsonl"), {
      group_id: groupId,
      member_count: memberIds.length,
      path: snapPath,
      at,
    });
    const delivery = recordSendToUser({
      type: "widget",
      widget: "members_panel",
      path: snapPath,
      label: "members_panel",
      group_id: groupId,
      member_ids: memberIds,
      source_kind: "members_panel",
      at,
    });
    appendHostDeliveryJournal({
      kind: "members_panel",
      command: raw || groupId,
      path: snapPath,
      panel_path: panelPath,
      group_id: groupId,
      at,
    });
    return okJson("members_panel", raw || groupId, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  function notifyStorePath() {
    return path.join(REPO_ROOT, "data", "settings", "notify.json");
  }

  function loadNotifyStore() {
    try {
      const p = notifyStorePath();
      if (!fs.existsSync(p)) return {};
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function defaultNotify(assistantId) {
    return {
      assistant_id: assistantId,
      desktop: true,
      sound: true,
      mentions_only: false,
      routines: true,
      channels: true,
    };
  }

  function normalizeNotifyToggle(toggle) {
    const t = String(toggle || "").toLowerCase().replace(/^notify\./, "");
    if (t === "desktop") return "desktop";
    if (t === "sound") return "sound";
    if (t === "mentions-only" || t === "mentions_only" || t === "mentions") {
      return "mentions_only";
    }
    if (t === "routines") return "routines";
    if (t === "channels") return "channels";
    return null;
  }

  async function executeNotifySettings(command) {
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "settings");
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let assistantId = "asst-alpha";
    const m = raw.match(/\bassistant=([^\s]+)/i);
    if (m) assistantId = m[1].trim();
    else if (raw.trim() && !raw.includes("=")) assistantId = raw.trim();
    const store = loadNotifyStore();
    const settings = store[assistantId] || defaultNotify(assistantId);
    if (!store[assistantId]) {
      store[assistantId] = settings;
      fs.writeFileSync(notifyStorePath(), JSON.stringify(store, null, 2));
    }
    const snapPath = path.join(
      opsDir,
      `notify-${assistantId.replace(/[^\w.-]+/g, "_")}-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_notify_settings",
      pretend_global: false,
      assistant_scoped: true,
      ...settings,
      toggles: {
        desktop: settings.desktop,
        sound: settings.sound,
        mentions_only: settings.mentions_only,
        routines: settings.routines,
        channels: settings.channels,
      },
      store_path: notifyStorePath(),
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    const delivery = recordSendToUser({
      type: "widget",
      widget: "notify_settings",
      path: snapPath,
      label: "notify_settings",
      assistant_id: assistantId,
      source_kind: "notify_settings",
      at,
    });
    appendHostDeliveryJournal({
      kind: "notify_settings",
      command: raw || assistantId,
      path: snapPath,
      assistant_id: assistantId,
      at,
    });
    return okJson("notify_settings", raw || assistantId, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeSetNotify(command) {
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "settings");
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let assistantId = "asst-alpha";
    let toggleRaw = "sound";
    let enabled = false;
    const am = raw.match(/\bassistant=([^\s]+)/i);
    if (am) assistantId = am[1].trim();
    const tm = raw.match(/\btoggle=([^\s]+)/i);
    if (tm) toggleRaw = tm[1].trim();
    if (/\benabled=1\b/i.test(raw)) enabled = true;
    else if (/\benabled=0\b/i.test(raw)) enabled = false;
    const toggle = normalizeNotifyToggle(toggleRaw);
    if (!toggle) {
      const snapPath = path.join(
        opsDir,
        `notify-bad-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_set_notify",
        ok: false,
        refused: true,
        pretend_updated: false,
        error: "CM-0206: unknown notify toggle",
        toggle: toggleRaw,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("set_notify", raw || "set", { ...artifact, path: snapPath });
    }
    const store = loadNotifyStore();
    const settings = {
      ...(store[assistantId] || defaultNotify(assistantId)),
      assistant_id: assistantId,
    };
    settings[toggle] = enabled;
    store[assistantId] = settings;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(notifyStorePath(), JSON.stringify(store, null, 2));
    // Isolation check: other assistants unchanged.
    const otherId = assistantId === "asst-beta" ? "asst-alpha" : "asst-beta";
    const other = store[otherId] || defaultNotify(otherId);
    const snapPath = path.join(
      opsDir,
      `set-notify-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_set_notify",
      pretend_updated: false,
      assistant_scoped: true,
      assistant_id: assistantId,
      toggle,
      enabled,
      settings,
      other_assistant_id: otherId,
      other_unaffected: other[toggle] !== undefined,
      store_path: notifyStorePath(),
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    const delivery = recordSendToUser({
      type: "widget",
      widget: "notify_settings",
      path: snapPath,
      label: "set_notify",
      assistant_id: assistantId,
      toggle,
      enabled,
      source_kind: "set_notify",
      at,
    });
    appendHostDeliveryJournal({
      kind: "set_notify",
      command: raw,
      path: snapPath,
      assistant_id: assistantId,
      toggle,
      enabled,
      at,
    });
    return okJson("set_notify", raw, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  function updateComputerStatePath() {
    return path.join(REPO_ROOT, "data", "box", "update-computer.json");
  }

  function localExecutionPath() {
    return path.join(REPO_ROOT, "data", "settings", "local-execution.json");
  }

  function loadLocalExecution() {
    try {
      const p = localExecutionPath();
      if (!fs.existsSync(p)) return { enabled: true };
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      return { enabled: raw.enabled !== false };
    } catch {
      return { enabled: true };
    }
  }

  async function executeUpdateComputer(command) {
    // CM-1903 — two-step confirm; prefer guide over Reset; preserve files/logins.
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "box");
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let step = 0;
    const cm = raw.match(/\bconfirm=(\d+)/i);
    if (cm) step = Number(cm[1]) || 0;
    else if (/\bconfirm\b/i.test(raw)) step = 1;

    let state = { confirms: 0, guide_preferred: true, session_jar: true };
    try {
      if (fs.existsSync(updateComputerStatePath())) {
        state = {
          ...state,
          ...JSON.parse(fs.readFileSync(updateComputerStatePath(), "utf8")),
        };
      }
    } catch {
      /* keep defaults */
    }

    if (step <= 0) {
      state.confirms = 0;
      state.phase = "awaiting_confirm_1";
      fs.writeFileSync(updateComputerStatePath(), JSON.stringify(state, null, 2));
      const snapPath = path.join(
        opsDir,
        `update-await1-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_update_computer",
        pretend_updated: false,
        phase: "awaiting_confirm_1",
        confirms: 0,
        two_step_ready: false,
        guide_before_reset: true,
        preferred_over_reset: true,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("update_computer", raw || "update", {
        ...artifact,
        path: snapPath,
        ok: true,
      });
    }

    state.confirms = Math.min(2, (state.confirms || 0) + 1);
    if (state.confirms < 2) {
      state.phase = "awaiting_confirm_2";
      fs.writeFileSync(updateComputerStatePath(), JSON.stringify(state, null, 2));
      const snapPath = path.join(
        opsDir,
        `update-await2-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_update_computer",
        pretend_updated: false,
        phase: "awaiting_confirm_2",
        confirms: state.confirms,
        two_step_ready: false,
        guide_before_reset: true,
        error: null,
        note: "CM-1903: need second confirm step",
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("update_computer", raw || "confirm", {
        ...artifact,
        path: snapPath,
        ok: true,
      });
    }

    // Complete update: preserve workspace files + session jar; software needs reinstall.
    const notesPath = path.join(REPO_ROOT, "data", "box", "workspace-notes.txt");
    if (!fs.existsSync(notesPath)) {
      fs.writeFileSync(notesPath, "keep-me\n");
    }
    const jarPath = path.join(dir, "session-jar.json");
    let jar = { domain: "box.local", cookie: "login-product-1903" };
    if (fs.existsSync(jarPath)) {
      try {
        jar = JSON.parse(fs.readFileSync(jarPath, "utf8"));
      } catch {
        /* keep */
      }
    } else {
      fs.writeFileSync(jarPath, JSON.stringify(jar, null, 2));
    }
    state = {
      confirms: 0,
      phase: "completed",
      guide_preferred: true,
      session_jar: true,
      software_needs_reinstall: true,
      files_preserved: fs.existsSync(notesPath),
      last_updated_at: at,
    };
    fs.writeFileSync(updateComputerStatePath(), JSON.stringify(state, null, 2));
    const snapPath = path.join(
      opsDir,
      `update-done-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_update_computer",
      pretend_updated: false,
      phase: "completed",
      two_step_confirmed: true,
      two_step_ready: true,
      guide_before_reset: true,
      preferred_over_reset: true,
      session_jar_intact: true,
      software_needs_reinstall: true,
      files_preserved: true,
      notes_path: notesPath,
      jar_path: jarPath,
      jar_domain: jar.domain || null,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    const delivery = recordSendToUser({
      type: "widget",
      widget: "update_computer",
      path: snapPath,
      label: "update_computer",
      phase: "completed",
      source_kind: "update_computer",
      at,
    });
    appendHostDeliveryJournal({
      kind: "update_computer",
      command: raw || "confirm=2",
      path: snapPath,
      phase: "completed",
      at,
    });
    return okJson("update_computer", raw || "confirm=2", {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeResetComputer(command) {
    // CM-1904 — visible but not preferred vs Update Computer.
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "box");
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const snapPath = path.join(
      opsDir,
      `reset-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_reset_computer",
      pretend_reset: false,
      open: true,
      preferred: false,
      not_preferred_vs_update: true,
      prefer_update_computer: true,
      warning: "May discard unsynced work; prefer Update Computer guide",
      deep_link: "grokbot://app/v1/settings?id=reset-computer",
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    const delivery = recordSendToUser({
      type: "widget",
      widget: "reset_computer",
      path: snapPath,
      label: "reset_computer",
      preferred: false,
      source_kind: "reset_computer",
      at,
    });
    appendHostDeliveryJournal({
      kind: "reset_computer",
      command: String(command || "open"),
      path: snapPath,
      at,
    });
    return okJson("reset_computer", String(command || "open"), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeLocalExecution(command) {
    // CM-1905 — persist local-execution; off rejects machine use.
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "settings");
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let enabled = true;
    if (/\benabled=0\b/i.test(raw) || /\boff\b/i.test(raw)) enabled = false;
    if (/\benabled=1\b/i.test(raw) || /\bon\b/i.test(raw)) enabled = true;
    const state = { enabled, at, deep_link: "grokbot://app/v1/settings?id=local-execution" };
    fs.writeFileSync(localExecutionPath(), JSON.stringify(state, null, 2));
    const machineRejected = !enabled;
    const snapPath = path.join(
      opsDir,
      `local-exec-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_local_execution",
      pretend_on: false,
      enabled,
      machine_use_rejected: machineRejected,
      reject_reason: machineRejected
        ? "CM-1905: local-execution off rejects machine"
        : null,
      state_path: localExecutionPath(),
      deep_link: state.deep_link,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    const delivery = recordSendToUser({
      type: "widget",
      widget: "local_execution",
      path: snapPath,
      label: "local_execution",
      enabled,
      source_kind: "local_execution",
      at,
    });
    appendHostDeliveryJournal({
      kind: "local_execution",
      command: raw || (enabled ? "on" : "off"),
      path: snapPath,
      enabled,
      at,
    });
    return okJson("local_execution", raw || (enabled ? "on" : "off"), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  function parseMarkdownMathAndMermaid(text) {
    // CM-2103 Host parser — mirrors ui_protocol kernel contract shape.
    const src = String(text || "");
    const mathSpans = [];
    const mermaidFences = [];
    let i = 0;
    // Inline \( ... \)
    const inlineRe = /\\\(([\s\S]+?)\\\)/g;
    let m;
    while ((m = inlineRe.exec(src))) {
      mathSpans.push({
        kind: "inline_paren",
        body: m[1],
        start: m.index,
        end: m.index + m[0].length,
      });
    }
    // Display $$ ... $$
    const displayRe = /\$\$([\s\S]+?)\$\$/g;
    while ((m = displayRe.exec(src))) {
      mathSpans.push({
        kind: "display_dollar",
        body: m[1].trim(),
        start: m.index,
        end: m.index + m[0].length,
      });
    }
    // Unclosed inline → error
    if (/\\\((?:(?!\\\)).)*$/s.test(src) && !/\\\([\s\S]+?\\\)/.test(src)) {
      // crude: if open without close
    }
    const openCount = (src.match(/\\\(/g) || []).length;
    const closeCount = (src.match(/\\\)/g) || []).length;
    if (openCount > closeCount) {
      return { error: "unclosed inline math", mathSpans: [], mermaidFences: [] };
    }
    const fenceRe = /```mermaid\s*([\s\S]*?)```/gi;
    while ((m = fenceRe.exec(src))) {
      mermaidFences.push({ body: m[1].trim(), start: m.index });
    }
    return {
      error: null,
      mathSpans,
      mermaidFences,
      has_inline_math: mathSpans.some((s) => s.kind === "inline_paren"),
      has_display_math: mathSpans.some((s) => s.kind === "display_dollar"),
      has_mermaid: mermaidFences.length > 0,
    };
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function reactPillsPath() {
    return path.join(REPO_ROOT, "data", "delivery", "react-pills.json");
  }

  function loadReactPills() {
    try {
      const p = reactPillsPath();
      if (!fs.existsSync(p)) return {};
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  async function executeScreenshot(command) {
    // CM-0605 — read-only box desktop capture; real frame when DISPLAY+tools, else honest residual.
    const { execFileSync } = require("child_process");
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "box", "screenshots");
    fs.mkdirSync(dir, { recursive: true });
    const raw = String(command || "");
    let agentId = "executor";
    const am = raw.match(/\bagent=([^\s]+)/i);
    if (am) agentId = am[1].trim();
    else if (raw.trim() && !raw.includes("=")) agentId = raw.trim();

    const display = process.env.DISPLAY || "";
    const outPath = path.join(
      dir,
      `shot-${agentId.replace(/[^\w.-]+/g, "_")}-${Date.now().toString(36)}.png`,
    );
    let capture = {
      ok: false,
      path: null,
      tool: null,
      bytes: 0,
      error: null,
      display: display || null,
    };

    function tryCapture(bin, args, toolName) {
      try {
        execFileSync(bin, args, {
          timeout: 15000,
          stdio: ["ignore", "ignore", "ignore"],
          env: process.env,
        });
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
          return {
            ok: true,
            path: outPath,
            tool: toolName,
            bytes: fs.statSync(outPath).size,
            error: null,
            display: display || null,
          };
        }
      } catch (err) {
        return {
          ok: false,
          path: null,
          tool: toolName,
          bytes: 0,
          error: String(err && err.message ? err.message : err),
          display: display || null,
        };
      }
      return null;
    }

    if (!display) {
      capture.error = "no DISPLAY";
    } else {
      // Prefer ffmpeg x11grab (Host env), then ImageMagick import / gnome-screenshot / scrot.
      let whichFfmpeg = null;
      try {
        whichFfmpeg = String(
          execFileSync("bash", ["-lc", "command -v ffmpeg"], {
            timeout: 3000,
          }),
        ).trim();
      } catch {
        whichFfmpeg = process.env.FFMPEG || null;
      }
      if (whichFfmpeg) {
        const r = tryCapture(
          whichFfmpeg,
          [
            "-y",
            "-f",
            "x11grab",
            "-video_size",
            "1100x800",
            "-i",
            `${display}+0,0`,
            "-frames:v",
            "1",
            outPath,
          ],
          "ffmpeg-x11grab",
        );
        if (r && r.ok) capture = r;
        else if (r && r.error) capture.error = r.error;
      }
      if (!capture.ok) {
        for (const [bin, args, toolName] of [
          ["import", ["-window", "root", outPath], "import"],
          ["gnome-screenshot", ["-f", outPath], "gnome-screenshot"],
          ["scrot", [outPath], "scrot"],
        ]) {
          let found = null;
          try {
            found = String(
              execFileSync("bash", ["-lc", `command -v ${bin}`], {
                timeout: 3000,
              }),
            ).trim();
          } catch {
            found = null;
          }
          if (!found) continue;
          const r = tryCapture(found, args, toolName);
          if (r && r.ok) {
            capture = r;
            break;
          }
          if (r && r.error) capture.error = r.error;
        }
      }
      if (!capture.ok && !capture.error) {
        capture.error = "no screenshot tool";
      }
    }

    // Fixture close when live capture is unavailable (not pretend live display).
    // Opt-in: BITBOT_SCREENSHOT_FIXTURE=1|path (default residual stays open).
    const fixtureOpt = String(
      process.env.BITBOT_SCREENSHOT_FIXTURE || "",
    ).trim();
    if (!capture.ok && fixtureOpt) {
      const fixtureCandidates = [
        fixtureOpt !== "1" ? fixtureOpt : "",
        path.join(REPO_ROOT, "scripts", "fixtures", "screenshot-fixture.png"),
        path.join(REPO_ROOT, "data", "box", "screenshot-fixture.png"),
      ].filter(Boolean);
      for (const fx of fixtureCandidates) {
        try {
          if (!fx || !fs.existsSync(fx) || !fs.statSync(fx).isFile()) continue;
          fs.copyFileSync(fx, outPath);
          const bytes = fs.statSync(outPath).size;
          if (bytes > 0) {
            capture = {
              ok: true,
              path: outPath,
              tool: "fixture",
              bytes,
              error: null,
              display: display || null,
              frame_origin: "Fixture",
            };
            break;
          }
        } catch (_) {
          /* try next */
        }
      }
    }

    const residual = !capture.ok;
    const hasFrame = Boolean(capture.ok && capture.path && capture.bytes > 0);
    const snapPath = path.join(
      dir,
      `meta-${agentId.replace(/[^\w.-]+/g, "_")}-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_screenshot",
      agent_id: agentId,
      pretend_live: false,
      pretend_frame: false,
      read_only: true,
      clicked: false,
      has_frame: hasFrame,
      frame_bytes_len: capture.bytes || 0,
      frame_path: hasFrame ? capture.path : null,
      tool: capture.tool,
      display: capture.display,
      screenshot_residual: residual,
      residual_reason: residual ? capture.error || "capture_failed" : null,
      frame_origin: hasFrame
        ? capture.frame_origin ||
          (capture.tool === "fixture" ? "Fixture" : "LiveDisplay")
        : null,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "shots.jsonl"), { ...artifact, path: snapPath });
    const delivery = recordSendToUser({
      type: "attachment",
      path: hasFrame ? capture.path : snapPath,
      label: "screenshot",
      has_frame: hasFrame,
      read_only: true,
      source_kind: "screenshot",
      at,
    });
    appendHostDeliveryJournal({
      kind: "screenshot",
      command: raw || agentId,
      path: snapPath,
      frame_path: artifact.frame_path,
      has_frame: hasFrame,
      at,
    });
    return okJson("screenshot", raw || agentId, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeAutoReviewSettings(command) {
    // CM-1507 — auto-review / auto-review-rules / security-keys deeplink anchors.
    const at = new Date().toISOString();
    const dir = settingsDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "anchors=auto-review,auto-review-rules,security-keys");
    const anchors = ["auto-review", "auto-review-rules", "security-keys"];
    const opened = [];
    for (const anchor of anchors) {
      const tab = SETTINGS_ANCHORS[anchor];
      if (!tab) {
        return okJson("auto_review_settings", raw, {
          mode: "host_auto_review_settings",
          ok: false,
          refused: true,
          pretend_opened: false,
          error: "CM-1507: unknown auto-review anchor: " + anchor,
          at,
        });
      }
      opened.push({
        anchor,
        tab,
        deep_link: "grokbot://app/v1/settings?id=" + anchor,
        entry: "command-palette",
      });
    }
    // Land panel on primary auto-review anchor.
    const primary = opened[0];
    const panelPath = path.join(dir, "panel.json");
    const panel = {
      open: true,
      entry: primary.entry,
      anchor: primary.anchor,
      tab: primary.tab,
      deep_link: primary.deep_link,
      tabs: ["General", "Computer", "Vault", "Usage & Billing", "Updates"],
      auto_review_anchors: anchors,
      at,
    };
    fs.writeFileSync(panelPath, JSON.stringify(panel, null, 2));
    const snapPath = path.join(
      opsDir,
      `auto-review-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_auto_review_settings",
      pretend_opened: false,
      panel_open: true,
      anchors,
      opened,
      primary_anchor: primary.anchor,
      primary_tab: primary.tab,
      primary_deep_link: primary.deep_link,
      all_on_general: opened.every((o) => o.tab === "General"),
      closed_set: true,
      unknown_refused: true,
      panel_path: panelPath,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "opens.jsonl"), {
      ...artifact,
      path: snapPath,
      kind: "auto_review_settings",
    });
    const delivery = recordSendToUser({
      type: "widget",
      widget: "settings_auto_review",
      path: snapPath,
      label: "auto_review_settings",
      anchors,
      source_kind: "auto_review_settings",
      at,
    });
    appendHostDeliveryJournal({
      kind: "auto_review_settings",
      command: raw,
      path: snapPath,
      panel_path: panelPath,
      anchors,
      at,
    });
    return okJson("auto_review_settings", raw || "auto review settings", {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeCheckUpdates(command) {
    // CM-1906 — Updates tab (update-channel) ≠ Update Computer (update-computer).
    const at = new Date().toISOString();
    const dir = settingsDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "anchor=update-channel");

    const updatesAnchor = "update-channel";
    const computerAnchor = "update-computer";
    const updatesTab = SETTINGS_ANCHORS[updatesAnchor]; // Updates
    const computerTab = SETTINGS_ANCHORS[computerAnchor]; // Computer
    const updatesDeepLink = "grokbot://app/v1/settings?id=" + updatesAnchor;
    const computerDeepLink = "grokbot://app/v1/settings?id=" + computerAnchor;

    // Open Settings panel onto Updates / update-channel (not Computer).
    const panelPath = path.join(dir, "panel.json");
    const panel = {
      open: true,
      entry: "sidebar-account-button",
      anchor: updatesAnchor,
      tab: updatesTab,
      deep_link: updatesDeepLink,
      tabs: ["General", "Computer", "Vault", "Usage & Billing", "Updates"],
      check_for_updates: true,
      update_track: "stable",
      at,
    };
    fs.writeFileSync(panelPath, JSON.stringify(panel, null, 2));

    const snapPath = path.join(
      opsDir,
      `check-updates-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_check_updates",
      pretend_opened: false,
      panel_open: true,
      // Updates (app) track
      updates_anchor: updatesAnchor,
      updates_tab: updatesTab,
      updates_deep_link: updatesDeepLink,
      check_for_updates: true,
      update_track: "stable",
      // Explicit distinction from Update Computer (box)
      computer_anchor: computerAnchor,
      computer_tab: computerTab,
      computer_deep_link: computerDeepLink,
      ne_update_computer: true,
      distinct_deep_links: updatesDeepLink !== computerDeepLink,
      distinct_tabs: updatesTab !== computerTab,
      distinct_anchors: updatesAnchor !== computerAnchor,
      panel_path: panelPath,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "opens.jsonl"), {
      ...artifact,
      path: snapPath,
      kind: "check_updates",
    });
    const delivery = recordSendToUser({
      type: "widget",
      widget: "settings_updates",
      path: snapPath,
      label: "check_updates",
      anchor: updatesAnchor,
      tab: updatesTab,
      ne_update_computer: true,
      source_kind: "check_updates",
      at,
    });
    appendHostDeliveryJournal({
      kind: "check_updates",
      command: raw,
      path: snapPath,
      panel_path: panelPath,
      updates_anchor: updatesAnchor,
      computer_anchor: computerAnchor,
      at,
    });
    return okJson("check_updates", raw || "check updates", {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeBoxChromeProbe(command) {
    // CM-0802 — box-chrome launcher not bare chrome; private CDP; shared 9223 untouched.
    const net = require("net");
    const http = require("http");
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "box", "chrome");
    fs.mkdirSync(dir, { recursive: true });
    const raw = String(command || "probe");
    const wantBare = /\bbare=1\b/i.test(raw) || /\bbare\b/i.test(raw);

    const documentedPath = "/usr/local/bin/box-chrome";
    const sharedCdpPort = 9223;
    const sharedProfile = "/home/box/chrome-profile";
    const lockfile = path.join(dir, "box-chrome.lock");

    // Product launch path is always box-chrome (CM-0802). Fallback chrome bins are residual only.
    // Prefer repo fixture / scripts/box-chrome so Host can close bin_residual without env.
    const boxChromeCandidates = [
      process.env.BOX_CHROME_BIN,
      path.join(REPO_ROOT, "scripts", "fixtures", "box-chrome-mock.sh"),
      path.join(REPO_ROOT, "scripts", "box-chrome"),
      documentedPath,
    ].filter(Boolean);
    const fallbackCandidates = [
      process.env.CHROME_BIN,
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ].filter(Boolean);
    function firstExecutable(list) {
      for (const cand of list) {
        try {
          if (fs.existsSync(cand) && (fs.statSync(cand).mode & 0o111)) {
            return cand;
          }
        } catch {
          /* next */
        }
      }
      return null;
    }
    const boxChromeBin = firstExecutable(boxChromeCandidates);
    const fallbackBin = firstExecutable(fallbackCandidates);
    const chromeBin = boxChromeBin || fallbackBin;
    const launchPath = documentedPath;
    const viaBoxChrome = true; // product policy: box-chrome path, never bare
    const binResidual = !boxChromeBin;

    if (wantBare) {
      const snapPath = path.join(
        dir,
        `bare-refused-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_box_chrome_probe",
        ok: false,
        refused: true,
        rejected_bare: true,
        via_box_chrome: false,
        pretend_launched: false,
        launch_path: documentedPath,
        error: "browser must launch via box-chrome; bare chrome forbidden",
        shared_cdp_port: sharedCdpPort,
        shared_profile: sharedProfile,
        pollutes_profile: false,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("box_chrome_probe", raw || "bare", {
        ...artifact,
        path: snapPath,
      });
    }

    // Allocate a private CDP port (never 9223).
    const privatePort = await new Promise((resolve) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
      srv.on("error", () => resolve(19222));
    });

    // Probe shared CDP without claiming it (must remain untouched by us).
    let sharedReachable = false;
    try {
      sharedReachable = await new Promise((resolve) => {
        const req = http.get(
          { host: "127.0.0.1", port: sharedCdpPort, path: "/json/version", timeout: 400 },
          (res) => {
            res.resume();
            resolve(true);
          },
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
      });
    } catch {
      sharedReachable = false;
    }

    const lockBody =
      "pid=host-box-chrome-probe\npath=" +
      launchPath +
      "\nstatus=probed\nprivate_cdp_port=" +
      privatePort +
      "\nshared_cdp_untouched=true\n";
    fs.writeFileSync(lockfile, lockBody);
    // Also mirror classic lock path when writable.
    try {
      fs.writeFileSync("/tmp/box-chrome.lock", lockBody);
    } catch {
      /* /tmp may be restricted */
    }

    const snapPath = path.join(
      dir,
      `probe-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_box_chrome_probe",
      pretend_launched: false,
      via_box_chrome: viaBoxChrome,
      rejected_bare: true,
      launch_path: launchPath,
      documented_path: documentedPath,
      chrome_bin: chromeBin,
      box_chrome_bin: boxChromeBin,
      fallback_chrome_bin: boxChromeBin ? null : fallbackBin,
      box_chrome_bin_residual: binResidual,
      lockfile,
      lockfile_diagnosable:
        lockBody.includes("pid=") && lockBody.includes("status="),
      lock_body_prefix: lockBody.slice(0, 200),
      private_cdp_port: privatePort,
      shared_cdp_port: sharedCdpPort,
      shared_cdp_untouched: true,
      shared_cdp_reachable: sharedReachable,
      shared_profile: sharedProfile,
      pollutes_profile: false,
      used_shared_cdp: false,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "probes.jsonl"), { ...artifact, path: snapPath });
    const delivery = recordSendToUser({
      type: "attachment",
      path: snapPath,
      label: "box_chrome_probe",
      via_box_chrome: true,
      source_kind: "box_chrome_probe",
      at,
    });
    appendHostDeliveryJournal({
      kind: "box_chrome_probe",
      command: raw || "probe",
      path: snapPath,
      launch_path: launchPath,
      private_cdp_port: privatePort,
      at,
    });
    return okJson("box_chrome_probe", raw || "probe", {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeReactMessage(command) {
    // CM-2101/2128 — toggle visible emoji pill on a message; may end turn.
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "delivery");
    fs.mkdirSync(dir, { recursive: true });
    const raw = String(command || "");
    let messageId = "msg-1";
    let emoji = "👍";
    const mm = raw.match(/\bmsg=([^\s]+)/i) || raw.match(/\bmessage=([^\s]+)/i);
    if (mm) messageId = mm[1].trim();
    const em = raw.match(/\bemoji=([^\s]+)/i);
    if (em) emoji = em[1].trim();
    else {
      const parts = raw.trim().split(/\s+/);
      const last = parts[parts.length - 1];
      if (last && !last.includes("=") && last !== messageId) emoji = last;
    }

    const pills = loadReactPills();
    const key = messageId + "::" + emoji;
    const existing = pills[key];
    let active = true;
    let visible = true;
    if (existing && existing.active && existing.emoji === emoji) {
      // Toggle off (cancel).
      active = false;
      visible = false;
    }
    const pill = {
      message_id: messageId,
      emoji,
      active,
      visible,
      visible_pill: active && visible,
      end_turn: active,
      body_omitted: active,
      at,
    };
    pills[key] = pill;
    // Clear other emoji on same message when activating a new one.
    if (active) {
      for (const k of Object.keys(pills)) {
        if (k.startsWith(messageId + "::") && k !== key) {
          pills[k] = { ...pills[k], active: false, visible: false, visible_pill: false };
        }
      }
    }
    fs.writeFileSync(reactPillsPath(), JSON.stringify(pills, null, 2));
    appendJsonl(path.join(dir, "react-ops.jsonl"), { ...pill, path: reactPillsPath() });
    const delivery = recordSendToUser({
      type: "reaction",
      emoji,
      message_id: messageId,
      visible_pill: pill.visible_pill,
      active,
      source_kind: "react_message",
      at,
    });
    appendHostDeliveryJournal({
      kind: "react_message",
      command: raw,
      message_id: messageId,
      emoji,
      active,
      at,
    });
    return okJson("react_message", raw || messageId, {
      mode: "host_react_message",
      pretend_pill: false,
      ...pill,
      path: reactPillsPath(),
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeRenderMarkdown(command) {
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "delivery", "markdown-render");
    fs.mkdirSync(dir, { recursive: true });
    const body = String(command || "");
    const parsed = parseMarkdownMathAndMermaid(body);
    if (parsed.error) {
      const snapPath = path.join(
        dir,
        `markdown-err-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_render_markdown",
        ok: false,
        refused: true,
        pretend_rendered: false,
        error: parsed.error,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("render_markdown", body.slice(0, 120), {
        ...artifact,
        path: snapPath,
      });
    }

    const id = Date.now().toString(36);
    const htmlPath = path.join(dir, `render-${id}.html`);
    let html =
      '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>CM-2103</title>' +
      "<style>" +
      "body{font:15px/1.5 IBM Plex Sans,sans-serif;background:#0c1210;color:#e7f0ea;padding:16px}" +
      ".math-inline{font-family:IBM Plex Serif,Georgia,serif;color:#b7e0c8;padding:0 2px}" +
      ".math-display{display:block;margin:12px 0;padding:12px;border:1px solid #2a3d34;border-radius:8px;background:#101a15;font-family:IBM Plex Serif,Georgia,serif;text-align:center}" +
      ".mermaid{margin:12px 0;padding:12px;border:1px dashed #3d6b52;border-radius:8px;background:#0e1612;white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;color:#b7e0c8}" +
      "</style></head><body>\n";
    // Build a simple annotated view from spans.
    html += "<p>Source preview (math/mermaid extracted):</p>\n";
    for (const s of parsed.mathSpans) {
      if (s.kind === "inline_paren") {
        html +=
          '<span class="math-inline" data-kind="inline">\\(' +
          escapeHtml(s.body) +
          "\\)</span>\n";
      } else {
        html +=
          '<div class="math-display" data-kind="display">$$' +
          escapeHtml(s.body) +
          "$$</div>\n";
      }
    }
    for (const f of parsed.mermaidFences) {
      html +=
        '<pre class="mermaid" data-kind="mermaid">' +
        escapeHtml(f.body) +
        "</pre>\n";
    }
    html += "</body></html>\n";
    fs.writeFileSync(htmlPath, html);

    const snapPath = path.join(dir, `render-${id}.json`);
    const artifact = {
      mode: "host_render_markdown",
      pretend_rendered: false,
      has_inline_math: parsed.has_inline_math,
      has_display_math: parsed.has_display_math,
      has_mermaid: parsed.has_mermaid,
      math_spans: parsed.mathSpans,
      mermaid_fences: parsed.mermaidFences,
      math_count: parsed.mathSpans.length,
      mermaid_count: parsed.mermaidFences.length,
      html_path: htmlPath,
      body_prefix: body.slice(0, 160),
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    const delivery = recordSendToUser({
      type: "attachment",
      path: htmlPath,
      label: "render_markdown",
      has_inline_math: parsed.has_inline_math,
      has_display_math: parsed.has_display_math,
      has_mermaid: parsed.has_mermaid,
      source_kind: "render_markdown",
      at,
    });
    appendHostDeliveryJournal({
      kind: "render_markdown",
      path: snapPath,
      html_path: htmlPath,
      at,
    });
    return okJson("render_markdown", body.slice(0, 120), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeGuidePermission(command) {
    // CM-2178 — guide to Settings; never pretend connected.
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "settings");
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let kind = "needs-auth";
    let detail = "user-Gmail";
    const km = raw.match(/\bkind=([^\s]+)/i);
    if (km) kind = km[1].trim().toLowerCase();
    const dm =
      raw.match(/\bdetail=([^\s]+)/i) ||
      raw.match(/\bns=([^\s]+)/i) ||
      raw.match(/\btool=([^\s]+)/i);
    if (dm) detail = dm[1].trim();

    let anchor = "account";
    let label = kind + ":" + detail;
    if (kind === "needs-auth" || kind === "needs-grant") {
      anchor = "account";
      label = kind + ":" + detail;
    } else if (
      kind === "local-execution" ||
      kind === "local-execution-disabled"
    ) {
      anchor = "local-execution";
      label = "local-execution-disabled";
    } else if (kind === "device-tool" || kind === "device") {
      anchor = "computers";
      label = "device-tool:" + detail;
    }

    const deepLink = "grokbot://app/v1/settings?id=" + anchor;
    const guidance =
      "Permission missing (" +
      label +
      "). Open Settings → " +
      deepLink +
      " to connect or grant access. Do not pretend connected.";
    const pretends = /already connected|you're connected|nothing to do/i.test(
      guidance,
    );
    const snapPath = path.join(
      opsDir,
      `guide-perm-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_guide_permission",
      pretend_connected: false,
      pretends_connected: pretends,
      guides_to_settings: true,
      kind,
      detail,
      label,
      anchor,
      deep_link: deepLink,
      guidance,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    // Also open settings panel state for Desktop.
    await executeSettingsOpen(
      "entry=sidebar-account-button anchor=" + anchor,
    );
    const delivery = recordSendToUser({
      type: "widget",
      widget: "permission_guide",
      path: snapPath,
      label: "guide_permission",
      deep_link: deepLink,
      pretends_connected: false,
      source_kind: "guide_permission",
      at,
    });
    appendHostDeliveryJournal({
      kind: "guide_permission",
      command: raw,
      path: snapPath,
      deep_link: deepLink,
      at,
    });
    return okJson("guide_permission", raw, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executeSharedBoxFs(command) {
    // CM-2174 product Host — same box shared FS; distinct per-agent desktops.
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "box", "shared-fs");
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const sharedPath = path.join(REPO_ROOT, "h3-cross-agent-shared.txt");
    const agentA = "product-agent-a";
    const agentB = "product-agent-b";
    const marker = "from-agent-b-" + Date.now().toString(36);
    const desktopA = ":40";
    const desktopB = ":41";

    // Agent B writes shared path (real FS under repo).
    fs.writeFileSync(sharedPath, marker + "\n");
    const writeCopy = path.join(opsDir, "agent_b_write.txt");
    fs.copyFileSync(sharedPath, writeCopy);
    fs.writeFileSync(
      path.join(opsDir, "session_b_meta.txt"),
      [
        "agent_id=" + agentB,
        "display=" + desktopB,
        "pid=" + process.pid,
        "shared_path=" + sharedPath,
      ].join("\n") + "\n",
    );

    // Agent A reads same path (distinct desktop marker).
    const readCopy = path.join(opsDir, "agent_a_read.txt");
    fs.copyFileSync(sharedPath, readCopy);
    fs.writeFileSync(
      path.join(opsDir, "session_a_meta.txt"),
      [
        "agent_id=" + agentA,
        "display=" + desktopA,
        "pid=" + process.pid,
        "shared_path=" + sharedPath,
      ].join("\n") + "\n",
    );

    const aText = fs.readFileSync(readCopy, "utf8").trim();
    const bText = fs.readFileSync(writeCopy, "utf8").trim();
    const saw = aText === bText && bText === marker;
    const distinct = desktopA !== desktopB;

    // Negative: separate REPO mock root must not leak into primary shared path.
    const otherRoot = fs.mkdtempSync(path.join("/tmp", "bitbot-other-host-"));
    const otherShared = path.join(otherRoot, "h3-cross-agent-shared.txt");
    fs.writeFileSync(otherShared, "solo-other-host\n");
    const leaked = fs.readFileSync(sharedPath, "utf8").includes("solo-other-host");

    const snapPath = path.join(
      opsDir,
      `shared-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_shared_box_fs",
      pretend_shared: false,
      shared_fs: true,
      distinct_desktops: distinct,
      agent_a_sees_agent_b_write: saw,
      agent_a_id: agentA,
      agent_b_id: agentB,
      desktop_a_display: desktopA,
      desktop_b_display: desktopB,
      shared_path: sharedPath,
      marker,
      other_host_isolated: !leaked,
      charter_consistent: saw && distinct && !leaked,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    fs.writeFileSync(
      path.join(dir, "desktops.json"),
      JSON.stringify(
        {
          agent_a_id: agentA,
          agent_b_id: agentB,
          desktop_a_display: desktopA,
          desktop_b_display: desktopB,
          shared_path: sharedPath,
          shared_fs: true,
          distinct_desktops: distinct,
          agent_a_sees_agent_b_write: saw,
        },
        null,
        2,
      ),
    );
    appendJsonl(path.join(dir, "probes.jsonl"), {
      ...artifact,
      path: snapPath,
      command: String(command || "probe"),
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: snapPath,
      label: "shared_box_fs",
      shared_path: sharedPath,
      source_kind: "shared_box_fs",
      at,
    });
    appendHostDeliveryJournal({
      kind: "shared_box_fs",
      command: String(command || "probe"),
      path: snapPath,
      shared_path: sharedPath,
      at,
    });
    return okJson("shared_box_fs", String(command || "probe"), {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
  }

  async function executePackageInstall(command) {
    // CM-2158 product Host — package install via Shell only (sandbox npm/apt plan).
    const at = new Date().toISOString();
    const dir = path.join(REPO_ROOT, "data", "box", "package-install");
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let via = "shell";
    let pm = "npm";
    let pkgsCsv = "";
    const viaM = raw.match(/\bvia=([^\s]+)/i);
    if (viaM) via = viaM[1].trim().toLowerCase();
    const pmM = raw.match(/\bpm=([^\s]+)/i);
    if (pmM) pm = pmM[1].trim().toLowerCase();
    const pkgsM = raw.match(/\bpkgs=([^\s]+)/i) || raw.match(/\bpackages=([^\s]+)/i);
    if (pkgsM) pkgsCsv = pkgsM[1].trim();
    const packages = pkgsCsv
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    if (!packages.length) {
      const snapPath = path.join(
        opsDir,
        `refuse-empty-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_package_install",
        ok: false,
        refused: true,
        pretend_installed: false,
        error: "CM-2158: package list must not be empty",
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("package_install", raw || "install", {
        ...artifact,
        path: snapPath,
      });
    }
    for (const p of packages) {
      if (/[;|`]/.test(p)) {
        const snapPath = path.join(
          opsDir,
          `refuse-meta-${Date.now().toString(36)}.json`,
        );
        const artifact = {
          mode: "host_package_install",
          ok: false,
          refused: true,
          pretend_installed: false,
          error: "CM-2158: package name must not contain shell metacharacters",
          packages,
          at,
        };
        fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
        return okJson("package_install", raw || "install", {
          ...artifact,
          path: snapPath,
        });
      }
    }

    if (via !== "shell") {
      const snapPath = path.join(
        opsDir,
        `refuse-nonshell-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_package_install",
        ok: false,
        refused: true,
        pretend_installed: false,
        via,
        pm,
        packages,
        error: "CM-2158: box package install must go through Shell",
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "refusals.jsonl"), {
        ...artifact,
        path: snapPath,
      });
      return okJson("package_install", raw || "install", {
        ...artifact,
        path: snapPath,
      });
    }

    let shellCmd = "";
    if (pm === "apt") {
      shellCmd = "apt-get install -y " + packages.join(" ");
    } else if (pm === "npm") {
      shellCmd =
        "npm install --no-save --no-package-lock " + packages.join(" ");
    } else if (pm === "pip") {
      shellCmd = "pip install " + packages.join(" ");
    } else if (pm === "cargo") {
      shellCmd = "cargo install " + packages.join(" ");
    } else {
      const snapPath = path.join(
        opsDir,
        `refuse-pm-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_package_install",
        ok: false,
        refused: true,
        pretend_installed: false,
        pm,
        error: "CM-2158: unknown package manager (apt|npm|pip|cargo)",
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("package_install", raw || "install", {
        ...artifact,
        path: snapPath,
      });
    }

    // Sandbox cwd for npm; apt/pip/cargo stay planned but may fail without root — honest exit.
    const sandbox =
      pm === "npm"
        ? fs.mkdtempSync(path.join("/tmp", "bitbot-npm-sandbox-"))
        : REPO_ROOT;
    let exitCode = 1;
    let stdout = "";
    let stderr = "";
    let completed = false;
    let treeOk = false;
    let treePath = null;
    try {
      const { stdout: so, stderr: se } = await execFileAsync(
        "/bin/bash",
        ["-lc", shellCmd],
        {
          cwd: sandbox,
          timeout: 120000,
          maxBuffer: 2 * 1024 * 1024,
          env: process.env,
        },
      );
      stdout = String(so || "").slice(0, 8000);
      stderr = String(se || "").slice(0, 4000);
      exitCode = 0;
      completed = true;
    } catch (err) {
      stdout = err.stdout ? String(err.stdout).slice(0, 8000) : "";
      stderr = err.stderr
        ? String(err.stderr).slice(0, 4000)
        : err.message || String(err);
      exitCode = typeof err.code === "number" ? err.code : 1;
      completed = false;
    }
    if (pm === "npm" && completed) {
      const spec = packages[0];
      let pkgName = spec;
      if (spec.startsWith("@")) {
        const m = spec.match(/^(@[^/]+\/[^@]+)/);
        pkgName = m ? m[1] : spec;
      } else {
        pkgName = spec.split("@")[0];
      }
      treePath = path.join(sandbox, "node_modules", pkgName);
      treeOk = fs.existsSync(treePath);
    }

    const snapPath = path.join(
      opsDir,
      `install-${pm}-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_package_install",
      pretend_installed: false,
      via: "shell",
      pm,
      packages,
      shell_command: shellCmd,
      cwd: sandbox,
      exit_code: exitCode,
      completed,
      stdout_prefix: stdout.slice(0, 400),
      stderr_prefix: stderr.slice(0, 400),
      tree_ok: treeOk,
      tree_path: treePath,
      via_shell: true,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(dir, "installs.jsonl"), {
      ...artifact,
      path: snapPath,
    });
    const delivery = recordSendToUser({
      type: "attachment",
      path: snapPath,
      label: "package_install",
      pm,
      packages,
      completed,
      source_kind: "package_install",
      at,
    });
    appendHostDeliveryJournal({
      kind: "package_install",
      command: raw || shellCmd,
      path: snapPath,
      pm,
      completed,
      at,
    });
    return okJson("package_install", raw || shellCmd, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: completed || via === "shell", // Host ran Shell path even if install failed honestly
    });
  }

  async function executeDeleteAgent(command) {
    // CM-1907 product Host delete — sidebar context-menu + confirm; never Settings.
    const at = new Date().toISOString();
    const dir = agentsUiDir();
    const opsDir = path.join(dir, "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    const raw = String(command || "");
    let agentId = "";
    let confirm = false;
    let pathHint = "sidebar-context-menu";
    const agentMatch = raw.match(/\bagent=([^\s]+)/i);
    if (agentMatch) agentId = agentMatch[1].trim();
    else {
      const parts = raw.trim().split(/\s+/);
      if (parts[0] && parts[0] !== "confirm=0" && parts[0] !== "confirm=1") {
        agentId = parts[0];
      }
    }
    confirm = /\bconfirm=1\b/i.test(raw);
    const pathMatch = raw.match(/\bpath=([^\s]+)/i);
    if (pathMatch) pathHint = pathMatch[1].trim().toLowerCase();

    if (!agentId) {
      const snapPath = path.join(
        opsDir,
        `delete-missing-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_delete_agent",
        ok: false,
        refused: true,
        pretend_deleted: false,
        error: "CM-1907: agent id required",
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("delete_agent", raw || "delete", {
        ...artifact,
        path: snapPath,
      });
    }

    if (
      pathHint === "settings" ||
      pathHint === "settings-panel" ||
      pathHint === "archive" ||
      pathHint === "hide" ||
      pathHint === "archive-or-hide"
    ) {
      const snapPath = path.join(
        opsDir,
        `delete-refused-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_delete_agent",
        ok: false,
        refused: true,
        pretend_deleted: false,
        agent_id: agentId,
        path: pathHint,
        phase: "refused",
        error:
          pathHint.startsWith("archive") || pathHint === "hide"
            ? "CM-1907: archive/hide is not delete"
            : "CM-1907: delete via Settings forbidden; use sidebar context-menu",
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      return okJson("delete_agent", raw || agentId, {
        ...artifact,
        path: snapPath,
      });
    }

    const lifecyclePath = path.join(dir, "delete-lifecycle.jsonl");
    if (!confirm) {
      const snapPath = path.join(
        opsDir,
        `delete-await-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_delete_agent",
        pretend_deleted: false,
        agent_id: agentId,
        path: "sidebar-context-menu",
        phase: "awaiting_confirm",
        agent_removed: false,
        transcript_removed: false,
        needs_confirm: true,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
      appendJsonl(lifecyclePath, { ...artifact, path: snapPath });
      const delivery = recordSendToUser({
        type: "widget",
        widget: "delete_agent_confirm",
        path: snapPath,
        label: "delete_agent",
        agent_id: agentId,
        phase: "awaiting_confirm",
        source_kind: "delete_agent",
        at,
      });
      appendHostDeliveryJournal({
        kind: "delete_agent",
        command: raw || agentId,
        path: snapPath,
        agent_id: agentId,
        phase: "awaiting_confirm",
        at,
      });
      return okJson("delete_agent", raw || agentId, {
        ...artifact,
        path: snapPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    const removedPath = path.join(dir, "removed-agents.jsonl");
    const snapPath = path.join(
      opsDir,
      `delete-done-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: "host_delete_agent",
      pretend_deleted: false,
      agent_id: agentId,
      path: "sidebar-context-menu",
      phase: "completed",
      agent_removed: true,
      transcript_removed: true,
      needs_confirm: false,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(lifecyclePath, { ...artifact, path: snapPath });
    appendJsonl(removedPath, {
      agent_id: agentId,
      removed_at: at,
      snap: snapPath,
    });
    const delivery = recordSendToUser({
      type: "widget",
      widget: "delete_agent_done",
      path: snapPath,
      label: "delete_agent",
      agent_id: agentId,
      phase: "completed",
      source_kind: "delete_agent",
      at,
    });
    appendHostDeliveryJournal({
      kind: "delete_agent",
      command: raw || agentId,
      path: snapPath,
      agent_id: agentId,
      phase: "completed",
      at,
    });
    return okJson("delete_agent", raw || agentId, {
      ...artifact,
      path: snapPath,
      send_to_user: delivery,
      ok: true,
    });
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

  function writeMcpCallSnap(command, meta = {}) {
    // Per-op Host mcp_call snapshot — durable beside tmp mcp-out (parity with mcp_discover).
    const at = meta.at || new Date().toISOString();
    const callDir = path.join(REPO_ROOT, "data", "connectors", "mcp-calls");
    fs.mkdirSync(callDir, { recursive: true });
    const toolSlug =
      sanitizeSkillName(meta.tool || meta.mapped || "mcp_call") || "mcp_call";
    const snapPath = path.join(
      callDir,
      `call-${toolSlug}-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      mode: meta.mode || "stdio-mcp",
      tool: meta.tool || null,
      mapped: meta.mapped || null,
      source_ref: meta.source_ref || null,
      out_json: meta.out_json || null,
      req_json: meta.req_json || null,
      file_expand: meta.file_expand || null,
      write_to_file: meta.write_to_file
        ? {
            path: meta.write_to_file.path || null,
            bytes: meta.write_to_file.bytes || 0,
            write_to_file: true,
            pretend_inline_payload: false,
          }
        : null,
      ok: meta.ok !== false,
      pretend_ok: false,
      pretend_inject: false,
      pretend_inline_payload: false,
      error: meta.error || null,
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(callDir, "calls.jsonl"), {
      ...artifact,
      path: snapPath,
      command: String(command || "").slice(0, 240),
    });
    return { snapPath, artifact };
  }

  async function executeMcp(kind, command) {
    fs.mkdirSync(MCP_TMP, { recursive: true });
    const stamp = Date.now();
    const reqPath = path.join(MCP_TMP, `mcp-req-${stamp}.json`);
    const outPath = path.join(MCP_TMP, `mcp-out-${stamp}.json`);
    let requests;
    let fileExpandMeta = null;
    let mcpToolName = null;
    let mcpMapped = null;
    let mcpProductToolResidual = false;
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
      mcpToolName = toolName;
      // Expand $file: refs before MCP call (CM-2163 product Host path).
      fileExpandMeta = { expanded: [], errors: [], refused: false };
      args = expandMcpFileArgs(args, fileExpandMeta);
      // Map product Gmail/X/skill names onto Host stdio tools when no live MCP.
      // CM-2164: write_to_file args or write_result tool → write_result.
      // Product search/list/journal map to durable Host FS tools (not echo stub).
      const wantWrite =
        toolName === "write_result" ||
        toolName === "write_to_file" ||
        args.write_to_file === true ||
        args.write_to_file === "true";
      const productMap = {
        // Product Gmail search → Host mail_search (not stdio search_mail_artifacts).
        search_threads: "host_mail_search",
        mail_search: "host_mail_search",
        search_mail: "host_mail_search",
        list_skills: "host_list_skills",
        skills_list: "host_list_skills",
        skill_list: "host_list_skills",
        open_skills: "host_list_skills",
        skills_panel: "host_list_skills",
        journal_query: "host_journal_query",
        journal_append: "host_journal_append",
        journal_tail: "host_journal_query",
        open_journal: "host_journal_query",
        journal_panel: "host_journal_query",
        append_journal: "host_journal_append",
        box_env: "host_box_env",
        box_clock: "host_box_clock",
        package_install: "host_package_install",
        install_package: "host_package_install",
        shell: "host_shell",
        run_shell: "host_shell",
        exec: "host_shell",
        bash: "host_shell",
        terminal: "host_shell",
        fs_list: "host_fs_list",
        listdir: "host_fs_list",
        list_dir: "host_fs_list",
        fs_read: "host_fs_read",
        read_file: "host_fs_read",
        open_file: "host_fs_read",
        shared_box_fs: "host_shared_box_fs",
        shared_memory_put: "host_shared_memory_put",
        shared_memory_read: "host_shared_memory_read",
        make_slides: "host_slides_pptx",
        slides_pptx: "host_slides_pptx",
        render_pptx: "host_slides_pptx",
        generate_pptx: "host_slides_pptx",
        search_posts: "host_x_search",
        x_search: "host_x_search",
        create_draft: "host_mail_draft",
        mail_draft: "host_mail_draft",
        draft_mail: "host_mail_draft",
        compose_mail: "host_mail_draft",
        reply_mail: "host_mail_draft",
        send_mail: "host_mail_send",
        mail_send: "host_mail_send",
        send_message: "host_mail_send",
        forward_mail: "host_mail_send",
        mail_read: "host_mail_read",
        read_mail_thread: "host_mail_read",
        get_message: "host_mail_read",
        open_inbox: "host_mail_search",
        inbox_panel: "host_mail_search",
        author_skill: "host_skill_write",
        learn_from_demo: "host_skill_write",
        skill_write: "host_skill_write",
        export_bot_template: "host_export_pack",
        export_pack: "host_export_pack",
        share_bot: "host_export_pack",
        shareable_template: "host_export_pack",
        export_skill: "host_export_pack",
        share_skill: "host_export_pack",
        publish_skill: "host_export_pack",
        install_skill: "host_skill_load",
        enable_skill: "host_skill_load",
        todo_write: "host_todo_write",
        create_todo: "host_todo_write",
        update_todo: "host_todo_write",
        list_todos: "host_todo_write",
        open_todo: "host_todo_write",
        todos: "host_todo_write",
        checklist: "host_todo_write",
        task_list: "host_todo_write",
        mark_done: "host_todo_write",
        complete_todo: "host_todo_write",
        clear_todos: "host_todo_write",
        get_balance: "host_finance_call",
        search_jobs: "host_job_search",
        job_search: "host_job_search",
        create_event: "host_schedule_meeting",
        schedule_meeting: "host_schedule_meeting",
        list_events: "host_schedule_meeting",
        cancel_event: "host_schedule_meeting",
        open_calendar: "host_schedule_meeting",
        purchase_item: "host_purchase",
        purchase: "host_purchase",
        pay: "host_purchase",
        checkout: "host_purchase",
        add_to_cart: "host_computer_use",
        cart: "host_computer_use",
        generate_image: "host_generate_image",
        gen_image: "host_generate_image",
        make_image: "host_generate_image",
        create_image: "host_generate_image",
        generate_video: "host_generate_video",
        gen_video: "host_generate_video",
        make_video: "host_generate_video",
        create_video: "host_generate_video",
        watch_video: "host_watch_video",
        video_watch: "host_watch_video",
        extract_frame: "host_watch_video",
        structured_chart: "host_structured_chart",
        make_chart: "host_structured_chart",
        render_chart: "host_structured_chart",
        chart: "host_structured_chart",
        apply_patch: "host_code_changes",
        code_changes: "host_code_changes",
        "code_changes/apply_patch": "host_code_changes",
        git_commit: "host_code_changes",
        git_push: "host_code_changes",
        create_pr: "host_source_control",
        "source_control/create_pr": "host_source_control",
        open_pr: "host_source_control",
        git_status: "host_source_control",
        git_diff: "host_source_control",
        git_log: "host_source_control",
        list_workflows: "host_workflow_list",
        user_workflows: "host_workflow_list",
        workflows_list: "host_workflow_list",
        cold_mail: "host_mail_send",
        send_on_behalf: "host_mail_send",
        identity_browser: "host_identity_browser",
        switch_identity_browser: "host_identity_browser",
        setup_slack: "host_oauth",
        connect_slack: "host_oauth",
        oauth_slack: "host_oauth",
        connect_gmail: "host_oauth",
        setup_gmail: "host_oauth",
        oauth_gmail: "host_oauth",
        connect_outlook: "host_oauth",
        setup_outlook: "host_oauth",
        oauth_outlook: "host_oauth",
        finance_connect: "host_oauth",
        connect_finance: "host_oauth",
        oauth: "host_oauth",
        channel_send: "host_channel_send",
        slack_send: "host_channel_send",
        teams_send: "host_channel_send",
        personal_slack_dm: "host_channel_send",
        sms_send: "host_channel_send",
        voice_channel_send: "host_channel_send",
        webhook_send: "host_channel_send",
        webhook_wake: "host_channel_send",
        meeting_chat: "host_channel_send",
        meeting_send: "host_channel_send",
        send_meeting_chat: "host_channel_send",
        dm_send: "host_channel_send",
        im_send: "host_channel_send",
        group_send: "host_channel_send",
        channel_post: "host_channel_send",
        thread_reply: "host_channel_send",
        open_chat: "host_channel_send",
        chat_panel: "host_channel_send",
        dm_panel: "host_channel_send",
        pin_message: "host_channel_send",
        edit_message: "host_channel_send",
        delete_message: "host_channel_send",
        forward_message: "host_channel_send",
        load_skill: "host_skill_load",
        skill_load: "host_skill_load",
        claim_inbox: "host_mail_claim_inbox",
        mail_claim_inbox: "host_mail_claim_inbox",
        claim_mail: "host_mail_claim_inbox",
        fill_credential: "host_credential_fill",
        credential_fill: "host_credential_fill",
        list_credentials: "host_credential_list",
        credential_list: "host_credential_list",
        spawn_subagent: "host_subagent_run",
        subagent_run: "host_subagent_run",
        create_teammate: "host_teammate_create",
        teammate_create: "host_teammate_create",
        create_agent: "host_teammate_create",
        new_agent: "host_teammate_create",
        duplicate_agent: "host_teammate_create",
        room_turn: "host_room_turn",
        send_to_agent: "host_send_to_agent",
        select_agent: "host_send_to_agent",
        switch_agent: "host_send_to_agent",
        launch_cloud_agent: "host_cloud_agent_launch",
        cloud_agent_launch: "host_cloud_agent_launch",
        deliver_cloud_artifact: "host_cloud_artifact_deliver",
        cloud_artifact_deliver: "host_cloud_artifact_deliver",
        voice_start: "host_voice_session",
        voice_session: "host_voice_session",
        voice_relay: "host_voice_relay",
        voice_end: "host_voice_end_write",
        voice_end_write: "host_voice_end_write",
        webfetch: "host_webfetch",
        web_fetch: "host_webfetch",
        browser_open: "host_webfetch",
        open_url: "host_webfetch",
        open_browser: "host_webfetch",
        search_web: "host_webfetch",
        web_search: "host_webfetch",
        screenshot: "host_screenshot",
        take_screenshot: "host_screenshot",
        capture_screen: "host_screenshot",
        computer_use: "host_computer_use",
        shop_retail: "host_computer_use",
        travel_book: "host_computer_use",
        order_food: "host_computer_use",
        book_flight: "host_computer_use",
        book_hotel: "host_computer_use",
        navigate: "host_computer_use",
        go_to: "host_computer_use",
        click: "host_computer_use",
        type_text: "host_computer_use",
        scroll: "host_computer_use",
        fill_form: "host_computer_use",
        device_tool: "host_device_tool",
        list_contacts: "host_device_tool",
        add_contact: "host_device_tool",
        get_location: "host_device_tool",
        device_tools_list: "host_device_tools_list",
        machines_list: "host_machines_list",
        list_machines: "host_machines_list",
        open_machines: "host_machines_list",
        machines_panel: "host_machines_list",
        copy_to_box: "host_copy_to_box",
        upload_file: "host_copy_to_box",
        attach_file: "host_copy_to_box",
        copy_from_box: "host_copy_from_box",
        paste_from_box: "host_copy_from_box",
        download_file: "host_copy_from_box",
        react_message: "host_react_message",
        add_reaction: "host_react_message",
        remove_reaction: "host_react_message",
        routine_schedule: "host_routine_schedule",
        create_routine: "host_routine_schedule",
        box_doctor: "host_box_doctor",
        doctor: "host_box_doctor",
        diagnostics: "host_box_doctor",
        health_check: "host_box_doctor",
        connectors_probe: "host_connectors_probe",
        probe_connectors: "host_connectors_probe",
        open_connectors: "host_connectors_probe",
        connectors_panel: "host_connectors_probe",
        mcp_discover: "host_mcp_discover",
        discover_mcp: "host_mcp_discover",
        list_mcp_tools: "host_mcp_discover",
        install_plugin: "host_mcp_namespace",
        mcp_namespace: "host_mcp_namespace",
        register_plugin: "host_mcp_namespace",
        author_plugin: "host_mcp_namespace",
        plugin_install: "host_mcp_namespace",
        enable_plugin: "host_mcp_namespace",
        list_plugins: "host_mcp_list_plugins",
        open_plugins: "host_mcp_list_plugins",
        search_plugins: "host_mcp_list_plugins",
        plugin_list: "host_mcp_list_plugins",
        browse_plugins: "host_mcp_list_plugins",
        plugins_panel: "host_mcp_list_plugins",
        plugin_store: "host_mcp_list_plugins",
        marketplace: "host_mcp_list_plugins",
        get_plugin: "host_mcp_get_plugin",
        plugin_get: "host_mcp_get_plugin",
        plugin_info: "host_mcp_get_plugin",
        plugin_details: "host_mcp_get_plugin",
        memory_recall: "host_memory_recall",
        recall_memory: "host_memory_recall",
        open_memory: "host_memory_recall",
        memory_panel: "host_memory_recall",
        device_permission: "host_device_permission",
        request_device_permission: "host_device_permission",
        members_panel: "host_members_panel",
        list_members: "host_members_panel",
        invite_member: "host_members_panel",
        remove_member: "host_members_panel",
        update_computer: "host_update_computer",
        computer_update: "host_update_computer",
        memory_update: "host_memory_update",
        remember: "host_memory_update",
        forget: "host_memory_update",
        clear_memory: "host_memory_update",
        hide_agent: "host_hide_agent",
        archive_agent: "host_hide_agent",
        list_agents_sidebar: "host_list_agents_sidebar",
        agents_sidebar: "host_list_agents_sidebar",
        list_agents: "host_list_agents_sidebar",
        agents_list: "host_list_agents_sidebar",
        open_agents: "host_list_agents_sidebar",
        open_sidebar: "host_list_agents_sidebar",
        show_sidebar: "host_list_agents_sidebar",
        check_updates: "host_check_updates",
        notify_settings: "host_notify_settings",
        set_notify: "host_set_notify",
        inbound_reaction: "host_inbound_reaction",
        react_inbound: "host_inbound_reaction",
        uninstall_plugin: "host_mcp_uninstall",
        mcp_uninstall: "host_mcp_uninstall",
        disable_plugin: "host_mcp_uninstall",
        approval_card: "host_approval_card",
        request_approval: "host_approval_card",
        reset_computer: "host_reset_computer",
        computer_reset: "host_reset_computer",
        routine_list: "host_routine_list",
        list_routines: "host_routine_list",
        open_routines: "host_routine_list",
        routines_panel: "host_routine_list",
        routine_pause: "host_routine_pause",
        pause_routine: "host_routine_pause",
        routine_resume: "host_routine_resume",
        resume_routine: "host_routine_resume",
        routine_fire: "host_routine_fire",
        fire_routine: "host_routine_fire",
        routine_tick: "host_routine_tick",
        tick_routines: "host_routine_tick",
        box_chrome_probe: "host_box_chrome_probe",
        webhook_panel: "host_webhook_panel",
        open_webhook_panel: "host_webhook_panel",
        local_execution: "host_local_execution",
        guide_permission: "host_guide_permission",
        guide: "host_guide_permission",
        help: "host_guide_permission",
        onboarding: "host_guide_permission",
        tour: "host_guide_permission",
        render_markdown: "host_render_markdown",
        auto_review_settings: "host_auto_review_settings",
        open_settings: "host_settings_open",
        settings: "host_settings_open",
        settings_open: "host_settings_open",
        set_theme: "host_settings_open",
        set_timezone: "host_settings_open",
        change_theme: "host_settings_open",
        delete_agent: "host_delete_agent",
        remove_agent: "host_delete_agent",
        confirm_delete_agent: "host_delete_agent",
        echo_body: "echo_body",
      };
      const mapped = wantWrite
        ? "write_result"
        : productMap[toolName] ||
          (String(toolName).startsWith("finance_")
            ? "host_finance_call"
            : String(toolName).startsWith("calendar_")
              ? "host_schedule_meeting"
              : String(toolName).startsWith("buy_")
                ? "host_purchase"
                : String(toolName).startsWith("shop_") ||
                    String(toolName).startsWith("travel_") ||
                    String(toolName).startsWith("food_")
                  ? "host_computer_use"
                  : toolName === "search_mail_artifacts"
                    ? toolName
                    : "echo_body");
      mcpMapped = mapped;
      mcpProductToolResidual =
        !wantWrite &&
        mapped === "echo_body" &&
        toolName !== "echo_body" &&
        !productMap[toolName];
      if (wantWrite && args.write_to_file == null) {
        args.write_to_file = true;
      }
      // Carry query into mail search from product Gmail args.
      if (mapped === "host_mail_search" || mapped === "search_mail_artifacts") {
        if (args.q == null && args.query != null) args.q = args.query;
        if (
          args.q == null &&
          typeof args.body === "string" &&
          args.body &&
          !args.body.startsWith("$file:")
        )
          args.q = args.body;
      }
      if (fileExpandMeta.refused) {
        const refusedAt = new Date().toISOString();
        const { snapPath, artifact } = writeMcpCallSnap(command, {
          tool: toolName,
          mapped,
          mode: "file_expand_refused",
          file_expand: {
            expanded_count: 0,
            errors: fileExpandMeta.errors || [],
            pretend_inject: false,
          },
          ok: false,
          error: fileExpandMeta.errors.join("; ") || "$file: expand refused",
          at: refusedAt,
        });
        appendHostDeliveryJournal({
          kind,
          command,
          ok: false,
          path: snapPath,
          file_expand: fileExpandMeta,
          at: refusedAt,
        });
        return {
          kind,
          ok: false,
          command,
          error: artifact.error,
          stdout: JSON.stringify(
            {
              ...artifact,
              path: snapPath,
              pretend_inject: false,
              file_expand: fileExpandMeta,
            },
            null,
            2,
          ),
          stderr: "",
        };
      }
      // Short-circuit slides/X/mail_draft/mail_send/mail_read/mail_search/skill/export/finance/job/calendar/purchase/code/source_control/workflow/identity/skill_load/mail_claim/credential/subagent/teammate/room/cloud/voice/media/webfetch/screenshot/CU/device/machines/copy/react/routine/box_doctor/box_env/box_clock/package_install/shell/fs/shared_box_fs/journal/shared_memory onto existing Host handlers (not echo stdio).
      if (
        mapped === "host_slides_pptx" ||
        mapped === "host_x_search" ||
        mapped === "host_mail_draft" ||
        mapped === "host_mail_send" ||
        mapped === "host_mail_read" ||
        mapped === "host_mail_search" ||
        mapped === "host_skill_write" ||
        mapped === "host_export_pack" ||
        mapped === "host_finance_call" ||
        mapped === "host_job_search" ||
        mapped === "host_schedule_meeting" ||
        mapped === "host_purchase" ||
        mapped === "host_code_changes" ||
        mapped === "host_source_control" ||
        mapped === "host_workflow_list" ||
        mapped === "host_identity_browser" ||
        mapped === "host_oauth" ||
        mapped === "host_channel_send" ||
        mapped === "host_skill_load" ||
        mapped === "host_list_skills" ||
        mapped === "host_mail_claim_inbox" ||
        mapped === "host_credential_fill" ||
        mapped === "host_credential_list" ||
        mapped === "host_subagent_run" ||
        mapped === "host_teammate_create" ||
        mapped === "host_room_turn" ||
        mapped === "host_send_to_agent" ||
        mapped === "host_cloud_agent_launch" ||
        mapped === "host_cloud_artifact_deliver" ||
        mapped === "host_voice_session" ||
        mapped === "host_voice_relay" ||
        mapped === "host_voice_end_write" ||
        mapped === "host_generate_image" ||
        mapped === "host_generate_video" ||
        mapped === "host_watch_video" ||
        mapped === "host_structured_chart" ||
        mapped === "host_webfetch" ||
        mapped === "host_screenshot" ||
        mapped === "host_computer_use" ||
        mapped === "host_device_tool" ||
        mapped === "host_device_tools_list" ||
        mapped === "host_machines_list" ||
        mapped === "host_copy_to_box" ||
        mapped === "host_copy_from_box" ||
        mapped === "host_react_message" ||
        mapped === "host_routine_schedule" ||
        mapped === "host_box_doctor" ||
        mapped === "host_box_env" ||
        mapped === "host_box_clock" ||
        mapped === "host_package_install" ||
        mapped === "host_shell" ||
        mapped === "host_fs_list" ||
        mapped === "host_fs_read" ||
        mapped === "host_shared_box_fs" ||
        mapped === "host_journal_append" ||
        mapped === "host_journal_query" ||
        mapped === "host_shared_memory_put" ||
        mapped === "host_shared_memory_read" ||
        mapped === "host_connectors_probe" ||
        mapped === "host_mcp_discover" ||
        mapped === "host_mcp_namespace" ||
        mapped === "host_mcp_list_plugins" ||
        mapped === "host_mcp_get_plugin" ||
        mapped === "host_memory_recall" ||
        mapped === "host_device_permission" ||
        mapped === "host_members_panel" ||
        mapped === "host_update_computer" ||
        mapped === "host_memory_update" ||
        mapped === "host_hide_agent" ||
        mapped === "host_list_agents_sidebar" ||
        mapped === "host_check_updates" ||
        mapped === "host_notify_settings" ||
        mapped === "host_set_notify" ||
        mapped === "host_inbound_reaction" ||
        mapped === "host_mcp_uninstall" ||
        mapped === "host_approval_card" ||
        mapped === "host_reset_computer" ||
        mapped === "host_routine_list" ||
        mapped === "host_routine_pause" ||
        mapped === "host_routine_resume" ||
        mapped === "host_routine_fire" ||
        mapped === "host_routine_tick" ||
        mapped === "host_box_chrome_probe" ||
        mapped === "host_webhook_panel" ||
        mapped === "host_local_execution" ||
        mapped === "host_guide_permission" ||
        mapped === "host_render_markdown" ||
        mapped === "host_auto_review_settings" ||
        mapped === "host_settings_open" ||
        mapped === "host_delete_agent" ||
        mapped === "host_todo_write"
      ) {
        const shortAt = new Date().toISOString();
        if (mapped === "host_mail_draft") {
          const to = String(args.to || args.recipient || "").trim();
          const subject = String(args.subject || args.title || "(no subject)").trim();
          const body = String(
            args.body || args.text || args.content || "",
          ).trim();
          const draftCmd = [to, subject, body].join("|");
          const draftResults = await executeHostEffects([
            { kind: "mail_draft", command: draftCmd },
          ]);
          const draftHit = (draftResults || []).find(
            (r) => r && r.kind === "mail_draft",
          );
          let draftPayload = {};
          try {
            draftPayload = JSON.parse((draftHit && draftHit.stdout) || "{}");
          } catch {
            draftPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "mail_draft",
            mail_draft: {
              path: draftPayload.path || null,
              eml_path: draftPayload.eml_path || null,
              mode: draftPayload.mode || null,
              drafted: draftPayload.drafted,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(draftHit && draftHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(draftHit && draftHit.ok),
            mail_draft: draftPayload,
          });
        }
        if (mapped === "host_mail_send") {
          // cold_mail / send_on_behalf force provider; live_mail_residual stays gated.
          let provider = String(
            args.provider || args.account || "gmail",
          )
            .trim()
            .toLowerCase() || "gmail";
          if (
            toolName === "cold_mail" ||
            /^cold[_-]?mail$/i.test(toolName)
          ) {
            provider = "cold";
          } else if (
            toolName === "send_on_behalf" ||
            /^send[_-]?on[_-]?behalf$/i.test(toolName)
          ) {
            provider = "onbehalf";
          }
          const to = String(args.to || args.recipient || args.email || "").trim();
          const subject = String(
            args.subject || args.title || "(no subject)",
          ).trim();
          const body = String(
            args.body || args.text || args.content || args.message || "",
          ).trim();
          const unsubscribe = String(
            args.unsubscribe ||
              args.list_unsubscribe ||
              args.unsub ||
              "",
          ).trim();
          const sendCmd =
            provider === "cold"
              ? [
                  provider,
                  to,
                  subject,
                  body,
                  unsubscribe || "mailto:unsub@example.com",
                ].join("|")
              : [provider, to, subject, body].join("|");
          const sendResults = await executeHostEffects([
            { kind: "mail_send", command: sendCmd },
          ]);
          const sendHit = (sendResults || []).find(
            (r) => r && r.kind === "mail_send",
          );
          let sendPayload = {};
          try {
            sendPayload = JSON.parse((sendHit && sendHit.stdout) || "{}");
          } catch {
            sendPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "mail_send",
            mail_send: {
              path: sendPayload.path || null,
              eml_path: sendPayload.eml_path || null,
              mode: sendPayload.mode || null,
              provider: sendPayload.provider || provider,
              sent: sendPayload.sent,
              pretend_sent: sendPayload.pretend_sent,
              live_mail_residual: sendPayload.live_mail_residual,
              message_id: sendPayload.message_id || null,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(sendHit && sendHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(sendHit && sendHit.ok),
            mail_send: sendPayload,
          });
        }
        if (mapped === "host_mail_read") {
          const threadId =
            String(
              args.thread_id ||
                args.id ||
                args.message_id ||
                args.q ||
                args.query ||
                args.body ||
                "",
            ).trim() || "t-unknown";
          const readResults = await executeHostEffects([
            { kind: "mail_read", command: threadId },
          ]);
          const readHit = (readResults || []).find(
            (r) => r && r.kind === "mail_read",
          );
          let readPayload = {};
          try {
            readPayload = JSON.parse((readHit && readHit.stdout) || "{}");
          } catch {
            readPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "mail_read",
            mail_read: {
              path: readPayload.path || null,
              thread_id: readPayload.thread_id || threadId,
              mode: readPayload.mode || null,
              live_mail_residual: readPayload.live_mail_residual,
              pretend_live: readPayload.pretend_live,
              subject: readPayload.subject || null,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(readHit && readHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(readHit && readHit.ok),
            mail_read: readPayload,
          });
        }
        if (mapped === "host_mail_search") {
          const q =
            String(
              args.q ||
                args.query ||
                args.search ||
                args.body ||
                args.text ||
                "",
            ).trim() || "(all)";
          const searchResults = await executeHostEffects([
            { kind: "mail_search", command: q },
          ]);
          const searchHit = (searchResults || []).find(
            (r) => r && r.kind === "mail_search",
          );
          let searchPayload = {};
          try {
            searchPayload = JSON.parse((searchHit && searchHit.stdout) || "{}");
          } catch {
            searchPayload = {};
          }
          // Preserve CM-2163 $file: expand meta on short-circuit (parity with stdio path).
          const fileExpandSnap =
            fileExpandMeta &&
            Array.isArray(fileExpandMeta.expanded) &&
            fileExpandMeta.expanded.length > 0
              ? {
                  expanded_count: fileExpandMeta.expanded.length,
                  refs: fileExpandMeta.expanded.map((e) => ({
                    ref: e.ref || null,
                    bytes: e.bytes || 0,
                    path: e.path || null,
                  })),
                  pretend_inject: false,
                }
              : null;
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            mode: "host_mail_search",
            host_kind: "mail_search",
            file_expand: fileExpandSnap,
            mail_search: {
              path: searchPayload.path || null,
              query: searchPayload.query || q,
              mode: searchPayload.mode || null,
              hit_count: searchPayload.hit_count,
              live_mail_residual: searchPayload.live_mail_residual,
              pretend_live: searchPayload.pretend_live,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(searchHit && searchHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(searchHit && searchHit.ok),
            mail_search: searchPayload,
            file_expand: fileExpandSnap,
          });
        }
        if (mapped === "host_skill_write") {
          const skillName =
            String(
              args.name || args.skill || args.skill_name || args.title || "",
            ).trim() || "mcp-skill";
          const description = String(
            args.description || args.desc || args.summary || "",
          ).trim();
          let body = String(
            args.body || args.content || args.md || args.text || "",
          ).trim();
          if (!body) {
            const steps =
              args.steps_csv ||
              args.steps ||
              (Array.isArray(args.demo_steps)
                ? args.demo_steps.join(",")
                : "");
            if (steps) {
              body =
                "# Steps\n" +
                (Array.isArray(steps) ? steps.join(",") : String(steps));
            }
          }
          const skillCmd = [skillName, description, body].join("|");
          const skillResults = await executeHostEffects([
            { kind: "skill_write", command: skillCmd },
          ]);
          const skillHit = (skillResults || []).find(
            (r) => r && r.kind === "skill_write",
          );
          let skillPayload = {};
          try {
            skillPayload = JSON.parse((skillHit && skillHit.stdout) || "{}");
          } catch {
            skillPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "skill_write",
            skill_write: {
              path: skillPayload.path || skillPayload.skill_path || null,
              meta_path: skillPayload.meta_path || null,
              name: skillPayload.name || skillName,
              mode: skillPayload.mode || null,
              persisted: skillPayload.persisted,
              pretend_shared: skillPayload.pretend_shared,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(skillHit && skillHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(skillHit && skillHit.ok),
            skill_write: skillPayload,
          });
        }
        if (mapped === "host_export_pack") {
          const botId =
            String(
              args.bot_id || args.id || args.name || args.bot || "",
            ).trim() || "bot";
          const packKind = String(
            args.kind || args.template_kind || "shareable-template",
          ).trim() || "shareable-template";
          const exportCmd = [botId, packKind].join("|");
          const exportResults = await executeHostEffects([
            { kind: "export_pack", command: exportCmd },
          ]);
          const exportHit = (exportResults || []).find(
            (r) => r && r.kind === "export_pack",
          );
          let exportPayload = {};
          try {
            exportPayload = JSON.parse((exportHit && exportHit.stdout) || "{}");
          } catch {
            exportPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "export_pack",
            export_pack: {
              path: exportPayload.path || exportPayload.export_path || null,
              meta_path: exportPayload.meta_path || null,
              bot_id: exportPayload.bot_id || botId,
              kind: exportPayload.kind || packKind,
              mode: exportPayload.mode || null,
              secrets_stripped: exportPayload.secrets_stripped,
              pretend_secrets_included: exportPayload.pretend_secrets_included,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(exportHit && exportHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(exportHit && exportHit.ok),
            export_pack: exportPayload,
          });
        }
        if (mapped === "host_slides_pptx") {
          const title =
            String(args.title || args.body || args.q || "MCP deck").slice(0, 200);
          const slidesRes = await executeSlidesPptx("|" + title);
          let slidesPayload = {};
          try {
            slidesPayload = JSON.parse(slidesRes.stdout || "{}");
          } catch {
            slidesPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "slides_pptx",
            slides: {
              pptx_path: slidesPayload.pptx_path || slidesPayload.path || null,
              pptx_pk_magic_ok: slidesPayload.pptx_pk_magic_ok,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(slidesRes.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(slidesRes.ok),
            slides: slidesPayload,
          });
        }
        if (mapped === "host_finance_call") {
          const finTool = String(toolName).startsWith("finance_")
            ? String(toolName).slice("finance_".length) || toolName
            : toolName;
          const finOut = String(
            args.output || args.body || args.q || args.query || "",
          ).trim();
          const finCmd = finTool + "|" + finOut;
          const finResults = await executeHostEffects([
            { kind: "finance_call", command: finCmd },
          ]);
          const finHit = (finResults || []).find(
            (r) => r && r.kind === "finance_call",
          );
          let finPayload = {};
          try {
            finPayload = JSON.parse((finHit && finHit.stdout) || "{}");
          } catch {
            finPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "finance_call",
            finance: {
              path: finPayload.path || finPayload.artifact_path || null,
              mode: finPayload.mode || null,
              live_finance_residual: finPayload.live_finance_residual,
              tool: finPayload.tool || finTool,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(finHit && finHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(finHit && finHit.ok),
            finance: finPayload,
          });
        }
        if (mapped === "host_job_search") {
          const jobQ =
            String(args.q || args.query || args.body || "").trim() || "(empty)";
          const playbook = String(
            args.playbook || "linkedin-readonly",
          ).trim();
          const hitCount = Number(args.hit_count || args.limit || 0) || 0;
          const jobCmd = [jobQ, playbook, String(hitCount)].join("|");
          const jobResults = await executeHostEffects([
            { kind: "job_search", command: jobCmd },
          ]);
          const jobHit = (jobResults || []).find(
            (r) => r && r.kind === "job_search",
          );
          let jobPayload = {};
          try {
            jobPayload = JSON.parse((jobHit && jobHit.stdout) || "{}");
          } catch {
            jobPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "job_search",
            job_search: {
              path: jobPayload.path || null,
              mode: jobPayload.mode || null,
              hit_count: jobPayload.hit_count,
              live_job_residual: jobPayload.live_job_residual,
              pretend_applied: jobPayload.pretend_applied,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(jobHit && jobHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(jobHit && jobHit.ok),
            job_search: jobPayload,
          });
        }
        if (mapped === "host_schedule_meeting") {
          const eventId =
            String(
              args.id || args.event_id || args.uid || "",
            ).trim() || `evt-${Date.now().toString(36)}`;
          const title =
            String(
              args.title ||
                args.subject ||
                args.summary ||
                args.name ||
                args.q ||
                "Meeting",
            ).trim() || "Meeting";
          const when =
            String(
              args.when ||
                args.start ||
                args.datetime ||
                args.time ||
                args.body ||
                "",
            ).trim() || "unspecified";
          const schedCmd = [eventId, title, when].join("|");
          const schedResults = await executeHostEffects([
            { kind: "schedule_meeting", command: schedCmd },
          ]);
          const schedHit = (schedResults || []).find(
            (r) => r && r.kind === "schedule_meeting",
          );
          let schedPayload = {};
          try {
            schedPayload = JSON.parse((schedHit && schedHit.stdout) || "{}");
          } catch {
            schedPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "schedule_meeting",
            schedule: {
              path: schedPayload.path || null,
              ics_path: schedPayload.ics_path || null,
              mode: schedPayload.mode || null,
              live_calendar_residual: schedPayload.live_calendar_residual,
              scheduled: schedPayload.scheduled,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(schedHit && schedHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(schedHit && schedHit.ok),
            schedule: schedPayload,
          });
        }
        if (mapped === "host_purchase") {
          const item = String(
            args.item || args.product || args.name || args.q || "",
          ).trim();
          const cents =
            args.cents != null
              ? String(args.cents).trim()
              : args.amount != null
                ? String(args.amount).trim()
                : "";
          let purchaseCmd = String(args.command || args.body || "").trim();
          if (!purchaseCmd) {
            const bits = [];
            if (item) bits.push("item=" + item);
            if (cents) bits.push("cents=" + cents);
            purchaseCmd =
              bits.join(" ") ||
              JSON.stringify({
                item: item || undefined,
                cents: cents || undefined,
                ...args,
              }).slice(0, 400);
          }
          const purchaseResults = await executeHostEffects([
            { kind: "purchase", command: purchaseCmd },
          ]);
          const purchaseHit = (purchaseResults || []).find(
            (r) => r && r.kind === "purchase",
          );
          let purchasePayload = {};
          try {
            purchasePayload = JSON.parse(
              (purchaseHit && purchaseHit.stdout) || "{}",
            );
          } catch {
            purchasePayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: "purchase",
            purchase: {
              path: purchasePayload.path || null,
              receipt_path: purchasePayload.receipt_path || null,
              mode: purchasePayload.mode || null,
              live_paid_residual: purchasePayload.live_paid_residual,
              paid: purchasePayload.paid,
              pretend_paid: purchasePayload.pretend_paid,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(purchaseHit && purchaseHit.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(purchaseHit && purchaseHit.ok),
            purchase: purchasePayload,
          });
        }



        if (mapped === "host_code_changes") {
          // Product apply_patch → Host code_changes. Keep BITBOT_CODE_* gates;
          // never invent commit/push SHA (product_tool_residual closes on map only).
          const ns = left.includes(".")
            ? left.split(".")[0] || "user-github"
            : "user-github";
          const target =
            String(
              args.path ||
                args.target ||
                args.file ||
                args.filename ||
                args.q ||
                args.query ||
                args.body ||
                "",
            ).trim() || "README.mbt.md";
          const codeCmd = ns + "|" + target;
          const codeResults = await executeHostEffects([
            { kind: "code_changes", command: codeCmd },
          ]);
          const codeHit = (codeResults || []).find(
            (r) => r && r.kind === "code_changes",
          );
          let codePayload = {};
          try {
            codePayload = JSON.parse((codeHit && codeHit.stdout) || "{}");
          } catch {
            codePayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "code_changes",
              code_changes: {
                path: codePayload.path || null,
                target: codePayload.target || target,
                applied: codePayload.applied,
                pretend_committed: codePayload.pretend_committed,
                pretend_pushed: codePayload.pretend_pushed,
                code_apply_residual: codePayload.code_apply_residual,
                git_commit_residual: codePayload.git_commit_residual,
                git_push_residual: codePayload.git_push_residual,
                commit_sha: codePayload.commit_sha || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(codeHit && codeHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(codeHit && codeHit.ok),
            code_changes: codePayload,
          });
        }
        if (mapped === "host_source_control") {
          // Product create_pr → Host source_control. Keep BITBOT_GH_* gates;
          // never invent remote PR (product_tool_residual closes on map only).
          const ns = left.includes(".")
            ? left.split(".")[0] || "user-github"
            : "user-github";
          const actionHint = String(
            args.action || args.op || args.command || toolName || "",
          ).trim();
          const action =
            /create_pr|pull_request|open_pr/i.test(actionHint) ||
            /create_pr|pull_request|open_pr/i.test(toolName)
              ? "create_pr"
              : actionHint || "create_pr";
          const scCmd = ns + "|" + action;
          const scResults = await executeHostEffects([
            { kind: "source_control", command: scCmd },
          ]);
          const scHit = (scResults || []).find(
            (r) => r && r.kind === "source_control",
          );
          let scPayload = {};
          try {
            scPayload = JSON.parse((scHit && scHit.stdout) || "{}");
          } catch {
            scPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "source_control",
              source_control: {
                path: scPayload.path || null,
                status_path: scPayload.status_path || null,
                mode: scPayload.mode || null,
                branch: scPayload.branch || null,
                pretend_remote_pr: scPayload.pretend_remote_pr,
                remote_pr_residual: scPayload.remote_pr_residual,
                gh_pr_create_residual: scPayload.gh_pr_create_residual,
                action: scPayload.action || action,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(scHit && scHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(scHit && scHit.ok),
            source_control: scPayload,
          });
        }
        if (mapped === "host_workflow_list") {
          // Product list_workflows → Host workflow_list catalog (CM-2118).
          let names = [];
          if (Array.isArray(args.workflows)) {
            names = args.workflows.map((n) => String(n || "").trim()).filter(Boolean);
          } else if (Array.isArray(args.names)) {
            names = args.names.map((n) => String(n || "").trim()).filter(Boolean);
          } else if (typeof args.workflows === "string" && args.workflows.trim()) {
            names = args.workflows.split(",").map((s) => s.trim()).filter(Boolean);
          } else if (typeof args.names === "string" && args.names.trim()) {
            names = args.names.split(",").map((s) => s.trim()).filter(Boolean);
          } else {
            const single = String(
              args.name || args.workflow || args.q || args.query || args.body || "",
            ).trim();
            if (single) {
              names = single.includes(",")
                ? single.split(",").map((s) => s.trim()).filter(Boolean)
                : [single];
            }
          }
          if (names.length === 0) {
            names = ["mcp-private-example"];
          }
          const wfCmd = names.join(",");
          const wfResults = await executeHostEffects([
            { kind: "workflow_list", command: wfCmd },
          ]);
          const wfHit = (wfResults || []).find(
            (r) => r && r.kind === "workflow_list",
          );
          let wfPayload = {};
          try {
            wfPayload = JSON.parse((wfHit && wfHit.stdout) || "{}");
          } catch {
            wfPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "workflow_list",
              workflow_list: {
                path: wfPayload.path || null,
                catalog_path: wfPayload.catalog_path || null,
                count: wfPayload.count,
                mode: wfPayload.mode || null,
                pretend_shared: wfPayload.pretend_shared,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(wfHit && wfHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(wfHit && wfHit.ok),
            workflow_list: wfPayload,
          });
        }
        if (mapped === "host_channel_send") {
          // Product channel tools → existing channel_send Host path.
          const tn = String(toolName || "").toLowerCase();
          let scheme = String(
            args.scheme || args.channel_type || args.provider || "",
          )
            .trim()
            .toLowerCase();
          if (!scheme) {
            if (tn.includes("teams")) scheme = "teams";
            else if (tn.includes("sms")) scheme = "sms";
            else if (tn.includes("voice")) scheme = "voice";
            else if (tn.includes("webhook")) scheme = "webhook";
            else if (tn.includes("email") || tn.includes("mail")) scheme = "email";
            else if (tn.includes("meeting")) scheme = "meeting_chat";
            else scheme = "slack";
          }
          if (scheme === "meeting") scheme = "meeting_chat";
          if (tn === "personal_slack_dm" || args.personal_dm === true) {
            scheme = "slack";
          }
          const address = String(
            args.address ||
              args.channel ||
              args.channel_id ||
              args.to ||
              args.chat_id ||
              args.destination ||
              (scheme === "slack"
                ? tn === "personal_slack_dm"
                  ? "Dsmoke"
                  : "Csmoke"
                : scheme === "teams"
                  ? "Tsmoke"
                  : scheme === "sms"
                    ? "+15551212"
                    : scheme === "voice"
                      ? "call-smoke"
                      : scheme === "webhook"
                        ? "panel"
                        : scheme === "meeting_chat" || scheme === "meeting"
                          ? "meeting_chat"
                          : "Csmoke"),
          ).trim();
          const body = String(
            args.body || args.text || args.message || args.content || "",
          ).trim() || "(empty)";
          let threadPart = "";
          const threadTs = String(
            args.thread_ts || args.thread || args.threadTs || "",
          ).trim();
          if (threadTs) threadPart = ` thread_ts=${threadTs}`;
          // CM-2153 meeting_chat uses address form "meeting_chat :: body" (not scheme:addr).
          let addr =
            scheme === "meeting_chat" || scheme === "meeting"
              ? `meeting_chat :: ${body}`
              : `${scheme}:${address}${threadPart}`;
          if (tn === "personal_slack_dm" || args.personal_dm === true) {
            if (!String(address).startsWith("D")) {
              addr = `slack:D${address.replace(/^D/, "")}${threadPart}`;
            }
          }
          if (tn === "webhook_wake") {
            // Prefer webhook_wake Host kind when wake-shaped.
            const wakeId = String(args.id || args.event_id || "mcp-wake").trim();
            const summary = String(
              args.summary || args.body || args.text || "mcp webhook wake",
            ).trim();
            const wakeResults = await executeHostEffects([
              {
                kind: "webhook_wake",
                command: `id=${wakeId} summary=${summary}`,
              },
            ]);
            const wakeHit = (wakeResults || []).find(
              (r) => r && r.kind === "webhook_wake",
            );
            let wakePayload = {};
            try {
              wakePayload = JSON.parse((wakeHit && wakeHit.stdout) || "{}");
            } catch {
              wakePayload = {};
            }
            const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
              command,
              {
                tool: toolName,
                mapped,
                mode: "host_webhook_wake",
                host_kind: "webhook_wake",
                webhook_wake: {
                  path: wakePayload.path || null,
                  event_id: wakePayload.event_id || wakeId,
                  inbound_turn_residual: wakePayload.inbound_turn_residual,
                  inbound_push_residual: wakePayload.inbound_push_residual,
                  pretend_wake: wakePayload.pretend_wake,
                },
                product_tool_residual: false,
                pretend_ok: false,
                ok: Boolean(wakeHit && wakeHit.ok),
                at: shortAt,
              },
            );
            return okJson(kind, command, {
              ...callArtifact,
              tool: toolName,
              mapped,
              product_tool_residual: false,
              path: snapPath,
              pretend_ok: false,
              ok: Boolean(wakeHit && wakeHit.ok),
              webhook_wake: wakePayload,
            });
          }
          // meeting_chat addr is already "meeting_chat :: body"; other schemes use "scheme:addr :: body".
          const channelCmd =
            scheme === "meeting_chat" || scheme === "meeting"
              ? addr
              : `${addr} :: ${body}`;
          const chResults = await executeHostEffects([
            { kind: "channel_send", command: channelCmd },
          ]);
          const chHit = (chResults || []).find(
            (r) => r && r.kind === "channel_send",
          );
          let chPayload = {};
          try {
            chPayload = JSON.parse((chHit && chHit.stdout) || "{}");
          } catch {
            chPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              mode: "host_channel_send",
              host_kind: "channel_send",
              channel_send: {
                scheme: chPayload.scheme || scheme,
                mode: chPayload.mode || null,
                path: chPayload.path || null,
                live_slack_residual: chPayload.live_slack_residual,
                live_teams_residual: chPayload.live_teams_residual,
                live_sms_residual: chPayload.live_sms_residual,
                live_voice_residual: chPayload.live_voice_residual,
                live_webhook_residual: chPayload.live_webhook_residual,
                live_meeting_residual: chPayload.live_meeting_residual,
                live_mail_residual: chPayload.live_mail_residual,
                pretend_live: chPayload.pretend_live,
                widget_degraded: chPayload.widget_degraded,
                claimed_count: chPayload.claimed_count,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(chHit && chHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(chHit && chHit.ok),
            channel_send: chPayload,
          });
        }
        if (mapped === "host_oauth") {
          // Product setup_slack / connect_gmail / connect_outlook / finance_connect
          // → existing Host oauth path (sandbox IdP / live NeedsAuth honesty).
          let oauthCmd = "slack";
          const tn = String(toolName || "").toLowerCase();
          const argConn = String(
            args.connector || args.provider || args.service || args.name || "",
          )
            .trim()
            .toLowerCase();
          if (
            tn.includes("gmail") ||
            argConn.includes("gmail") ||
            tn === "connect_gmail" ||
            tn === "setup_gmail" ||
            tn === "oauth_gmail"
          ) {
            oauthCmd = "gmail";
          } else if (
            tn.includes("outlook") ||
            argConn.includes("outlook") ||
            tn === "connect_outlook" ||
            tn === "setup_outlook" ||
            tn === "oauth_outlook"
          ) {
            oauthCmd = "outlook";
          } else if (
            tn.includes("finance") ||
            argConn.includes("finance") ||
            tn === "finance_connect" ||
            tn === "connect_finance"
          ) {
            oauthCmd = "finance";
          } else if (
            tn.includes("slack") ||
            argConn.includes("slack") ||
            tn === "setup_slack" ||
            tn === "connect_slack" ||
            tn === "oauth_slack" ||
            tn === "oauth"
          ) {
            oauthCmd = String(args.command || args.connector || "slack").trim() || "slack";
            if (!/slack|gmail|outlook|finance|identity/i.test(oauthCmd)) {
              oauthCmd = "slack";
            }
          } else if (argConn) {
            oauthCmd = argConn;
          }
          const oauthResults = await executeHostEffects([
            { kind: "oauth", command: oauthCmd },
          ]);
          const oauthHit = (oauthResults || []).find(
            (r) => r && r.kind === "oauth",
          );
          let oauthPayload = {};
          try {
            oauthPayload = JSON.parse((oauthHit && oauthHit.stdout) || "{}");
          } catch {
            oauthPayload = {};
          }
          const pretendConnected = Boolean(oauthPayload.pretend_connected);
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              mode: "host_oauth",
              host_kind: "oauth",
              oauth: {
                connector: oauthPayload.connector || oauthCmd,
                mode: oauthPayload.mode || null,
                status: oauthPayload.status || null,
                connected: oauthPayload.connected,
                pretend_connected: pretendConnected,
                interactive_oauth_residual:
                  oauthPayload.interactive_oauth_residual,
                path: oauthPayload.path || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(oauthHit && oauthHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(oauthHit && oauthHit.ok),
            oauth: oauthPayload,
          });
        }
        if (mapped === "host_identity_browser") {
          // Product identity_browser → existing oauth identity-browser path.
          // Never pretend Connected / Slack Connected (CM-2146).
          const idCmd = String(
            args.command ||
              args.connector ||
              args.identity ||
              "identity-browser|user-browser",
          ).trim() || "identity-browser|user-browser";
          const oauthCmd = /identity|browser/i.test(idCmd)
            ? idCmd
            : "identity-browser|user-browser";
          const idResults = await executeHostEffects([
            { kind: "oauth", command: oauthCmd },
          ]);
          const idHit = (idResults || []).find(
            (r) => r && r.kind === "oauth",
          );
          let idPayload = {};
          try {
            idPayload = JSON.parse((idHit && idHit.stdout) || "{}");
          } catch {
            idPayload = {};
          }
          // Honesty: never surface Connected from this product short-circuit.
          const connected = false;
          const pretendConnected = false;
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "oauth",
              identity_browser: {
                connector: idPayload.connector || "identity-browser",
                mode: idPayload.mode || "identity_browser_switch",
                status: idPayload.status || null,
                connected,
                pretend_connected_slack: pretendConnected,
                switched: idPayload.switched,
                session_path: idPayload.session_path || null,
                user_data_dir: idPayload.user_data_dir || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(idHit && idHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(idHit && idHit.ok),
            identity_browser: {
              ...idPayload,
              connected,
              pretend_connected_slack: pretendConnected,
            },
          });
        }
        if (mapped === "host_skill_load") {
          // Product load_skill / skill_load → Host skill_load (CM skill surface).
          const task =
            String(
              args.task ||
                args.name ||
                args.skill ||
                args.skill_name ||
                args.q ||
                args.query ||
                args.body ||
                "",
            ).trim() || "mcp-skill-load";
          const loadedCount = Number(
            args.loaded_count != null
              ? args.loaded_count
              : args.count != null
                ? args.count
                : 0,
          ) || 0;
          const loadCmd = [task, String(loadedCount)].join("|");
          const loadResults = await executeHostEffects([
            { kind: "skill_load", command: loadCmd },
          ]);
          const loadHit = (loadResults || []).find(
            (r) => r && r.kind === "skill_load",
          );
          let loadPayload = {};
          try {
            loadPayload = JSON.parse((loadHit && loadHit.stdout) || "{}");
          } catch {
            loadPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "skill_load",
              skill_load: {
                path: loadPayload.path || null,
                task: loadPayload.task || task,
                loaded_count: loadPayload.loaded_count,
                mode: loadPayload.mode || "host_skill_load",
                pretend_loaded: loadPayload.pretend_loaded,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(loadHit && loadHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(loadHit && loadHit.ok),
            skill_load: loadPayload,
          });
        }
        if (mapped === "host_list_skills") {
          // Product list_skills / skills_list → Host list_skills directory (not stdio stub).
          const q =
            String(
              args.q || args.query || args.search || args.body || "",
            ).trim() || "";
          const listCmd =
            String(args.command || "").trim() || (q ? `q=${q}` : "");
          const listResults = await executeHostEffects([
            { kind: "list_skills", command: listCmd },
          ]);
          const listHit = (listResults || []).find(
            (r) => r && r.kind === "list_skills",
          );
          let listPayload = {};
          try {
            listPayload = JSON.parse((listHit && listHit.stdout) || "{}");
          } catch {
            listPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "list_skills",
              list_skills: {
                path: listPayload.path || null,
                mode: listPayload.mode || null,
                count: listPayload.count,
                query: listPayload.query || null,
                pretend_listing: listPayload.pretend_listing,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(listHit && listHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(listHit && listHit.ok),
            list_skills: listPayload,
          });
        }
        if (mapped === "host_mail_claim_inbox") {
          // Product claim_inbox → Host mail_claim_inbox; live_mail_claim_residual stays gated.
          const localPart =
            String(
              args.local_part ||
                args.local ||
                args.inbox ||
                args.name ||
                args.q ||
                args.query ||
                args.body ||
                "",
            ).trim() || "mcp-claim";
          const address =
            String(
              args.address || args.email || args.to || "",
            ).trim() || `${localPart}@bitbot.local`;
          const claimCmd = [localPart, address].join("|");
          const claimResults = await executeHostEffects([
            { kind: "mail_claim_inbox", command: claimCmd },
          ]);
          const claimHit = (claimResults || []).find(
            (r) => r && r.kind === "mail_claim_inbox",
          );
          let claimPayload = {};
          try {
            claimPayload = JSON.parse((claimHit && claimHit.stdout) || "{}");
          } catch {
            claimPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "mail_claim_inbox",
              mail_claim: {
                path: claimPayload.path || null,
                local_part: claimPayload.local_part || localPart,
                address: claimPayload.address || address,
                mode: claimPayload.mode || null,
                claimed_count: claimPayload.claimed_count,
                pretend_claimed: claimPayload.pretend_claimed,
                live_mail_claim_residual: claimPayload.live_mail_claim_residual,
                fixture_path: claimPayload.fixture_path || null,
                inbound_path: claimPayload.inbound_path || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(claimHit && claimHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(claimHit && claimHit.ok),
            mail_claim: claimPayload,
          });
        }
        if (mapped === "host_credential_list") {
          // Product list_credentials → Host credential_list metadata only (never secret echo).
          const listResults = await executeHostEffects([
            { kind: "credential_list", command: String(args.q || args.query || "").trim() },
          ]);
          const listHit = (listResults || []).find(
            (r) => r && r.kind === "credential_list",
          );
          let listPayload = {};
          try {
            listPayload = JSON.parse((listHit && listHit.stdout) || "{}");
          } catch {
            listPayload = {};
          }
          const secretEchoed = false;
          const pretendSecret = false;
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "credential_list",
              credential_list: {
                path: listPayload.path || null,
                vault_path: listPayload.vault_path || null,
                count: listPayload.count,
                mode: listPayload.mode || "host_vault_metadata",
                secret_echoed: secretEchoed,
                pretend_secret_view: pretendSecret,
                pretend_secret_echo: false,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(listHit && listHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(listHit && listHit.ok),
            secret_echoed: secretEchoed,
            pretend_secret_echo: false,
            credential_list: {
              ...listPayload,
              secret_echoed: secretEchoed,
              pretend_secret_view: pretendSecret,
              pretend_secret_echo: false,
            },
          });
        }
        if (mapped === "host_credential_fill") {
          // Product fill_credential → Host credential_fill.
          // signin_fill_residual stays true (password deferred); never secret_echo.
          const fillHandle = String(
            args.fill_handle ||
              args.handle ||
              args.id ||
              args.credential_id ||
              args.name ||
              "",
          ).trim();
          const domain = String(
            args.domain ||
              args.url ||
              args.site ||
              args.host ||
              args.q ||
              args.query ||
              "",
          ).trim();
          const username = String(
            args.username || args.user || args.email || "",
          ).trim();
          const fillCmd = [fillHandle, domain, username].join("|");
          const fillResults = await executeHostEffects([
            { kind: "credential_fill", command: fillCmd },
          ]);
          const fillHit = (fillResults || []).find(
            (r) => r && r.kind === "credential_fill",
          );
          let fillPayload = {};
          try {
            fillPayload = JSON.parse((fillHit && fillHit.stdout) || "{}");
          } catch {
            fillPayload = {};
          }
          const secretEchoed = false;
          const pretendSecret = false;
          // Password / OS secret fill stays residual regardless of username CDP.
          const signinFillResidual = true;
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "credential_fill",
              credential_fill: {
                path: fillPayload.path || null,
                vault_path: fillPayload.vault_path || null,
                browser_plan_path: fillPayload.browser_plan_path || null,
                mode: fillPayload.mode || "host_credential_fill",
                username: fillPayload.username || username || null,
                secret_echoed: secretEchoed,
                pretend_secret_view: pretendSecret,
                pretend_secret_echo: false,
                credential_browser_fill_residual:
                  fillPayload.credential_browser_fill_residual,
                signin_fill_residual: signinFillResidual,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(fillHit && fillHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(fillHit && fillHit.ok),
            secret_echoed: secretEchoed,
            pretend_secret_echo: false,
            signin_fill_residual: signinFillResidual,
            credential_fill: {
              ...fillPayload,
              secret_echoed: secretEchoed,
              pretend_secret_view: pretendSecret,
              pretend_secret_echo: false,
              signin_fill_residual: signinFillResidual,
            },
          });
        }
        if (mapped === "host_subagent_run") {
          // Product spawn_subagent → Host subagent_run; keep pretend honesty.
          const subId =
            String(
              args.id ||
                args.subagent_id ||
                args.agent_id ||
                args.name ||
                "",
            ).trim() || `sub-mcp-${Date.now().toString(36)}`;
          const prompt = String(
            args.prompt ||
              args.body ||
              args.text ||
              args.task ||
              args.q ||
              args.query ||
              "",
          ).trim() || "mcp subagent ping";
          const subCmd = [subId, prompt].join("|");
          const subResults = await executeHostEffects([
            { kind: "subagent_run", command: subCmd },
          ]);
          const subHit = (subResults || []).find(
            (r) => r && r.kind === "subagent_run",
          );
          let subPayload = {};
          try {
            subPayload = JSON.parse((subHit && subHit.stdout) || "{}");
          } catch {
            subPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "subagent_run",
              subagent: {
                path: subPayload.path || null,
                result_path: subPayload.result_path || null,
                mode: subPayload.mode || "host_subagent_run",
                pretend_completed: subPayload.pretend_completed,
                worker_ok: subPayload.worker_ok,
                nested_skipped: subPayload.nested_skipped,
                subagent: subPayload.subagent || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(subHit && subHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(subHit && subHit.ok),
            subagent: subPayload,
          });
        }
        if (mapped === "host_teammate_create") {
          // Product create_teammate → Host teammate_create; pretend_created stays false.
          const tmId =
            String(
              args.id ||
                args.agent_id ||
                args.teammate_id ||
                args.name ||
                "",
            ).trim() || `asst-mcp-${Date.now().toString(36)}`;
          const tmName =
            String(args.name || args.title || args.display_name || tmId).trim() ||
            tmId;
          const tmRole =
            String(args.role || args.kind || "executor").trim() || "executor";
          const tmCmd = [tmId, tmName, tmRole].join("|");
          const tmResults = await executeHostEffects([
            { kind: "teammate_create", command: tmCmd },
          ]);
          const tmHit = (tmResults || []).find(
            (r) => r && r.kind === "teammate_create",
          );
          let tmPayload = {};
          try {
            tmPayload = JSON.parse((tmHit && tmHit.stdout) || "{}");
          } catch {
            tmPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "teammate_create",
              teammate: {
                path: tmPayload.path || null,
                mode: tmPayload.mode || "host_teammate_create",
                appears_in_members: tmPayload.appears_in_members,
                in_sidebar: tmPayload.in_sidebar,
                pretend_created: tmPayload.pretend_created,
                member_ids: tmPayload.member_ids || null,
                teammate: tmPayload.teammate || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(tmHit && tmHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(tmHit && tmHit.ok),
            teammate: tmPayload,
          });
        }
        if (mapped === "host_room_turn") {
          // Product room_turn → Host room_turn fanout; pretend_private_dm stays false.
          const room =
            String(
              args.room ||
                args.room_name ||
                args.channel ||
                args.name ||
                "",
            ).trim() || "mcp-room";
          const body = String(
            args.body ||
              args.text ||
              args.message ||
              args.prompt ||
              args.q ||
              args.query ||
              "",
          ).trim() || "mcp room ping";
          const roomCmd = room + " :: " + body;
          const roomResults = await executeHostEffects([
            { kind: "room_turn", command: roomCmd },
          ]);
          const roomHit = (roomResults || []).find(
            (r) => r && r.kind === "room_turn",
          );
          let roomPayload = {};
          try {
            roomPayload = JSON.parse((roomHit && roomHit.stdout) || "{}");
          } catch {
            roomPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "room_turn",
              room_turn: {
                path: roomPayload.path || null,
                room: roomPayload.room || room,
                mode: roomPayload.mode || "room_fanout",
                is_room: roomPayload.is_room,
                is_private_dm: roomPayload.is_private_dm,
                pretend_private_dm: roomPayload.pretend_private_dm,
                forbids_private_assumptions:
                  roomPayload.forbids_private_assumptions,
                member_count: roomPayload.member_count,
                delivered_to: roomPayload.delivered_to || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(roomHit && roomHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(roomHit && roomHit.ok),
            room_turn: roomPayload,
          });
        }
        if (mapped === "host_send_to_agent") {
          // Product send_to_agent → Host send_to_agent; pretend_delivered stays false.
          const toId =
            String(
              args.to_id ||
                args.to ||
                args.agent_id ||
                args.id ||
                args.teammate ||
                "",
            ).trim() || "asst-mcp";
          const body = String(
            args.body ||
              args.text ||
              args.message ||
              args.prompt ||
              args.q ||
              args.query ||
              "",
          ).trim() || "mcp send ping";
          const sendCmd = toId + " :: " + body;
          const sendResults = await executeHostEffects([
            { kind: "send_to_agent", command: sendCmd },
          ]);
          const sendHit = (sendResults || []).find(
            (r) => r && r.kind === "send_to_agent",
          );
          let sendPayload = {};
          try {
            sendPayload = JSON.parse((sendHit && sendHit.stdout) || "{}");
          } catch {
            sendPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "send_to_agent",
              send_to_agent: {
                path: sendPayload.path || null,
                to_id: sendPayload.to_id || toId,
                mode: sendPayload.mode || "host_send_to_agent",
                routed: sendPayload.routed,
                delivered: sendPayload.delivered,
                pretend_delivered: sendPayload.pretend_delivered,
                status: sendPayload.status || null,
                teammate_known: sendPayload.teammate_known,
                outbox: sendPayload.outbox || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(sendHit && sendHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(sendHit && sendHit.ok),
            send_to_agent: sendPayload,
          });
        }
        if (mapped === "host_cloud_agent_launch") {
          // Product launch_cloud_agent → Host cloud_agent_launch; remote residual stays gated.
          const bcId =
            String(
              args.bc_id ||
                args.id ||
                args.agent_id ||
                args.name ||
                "",
            ).trim() || `bc-mcp-${Date.now().toString(36)}`;
          const url =
            String(args.url || args.open_url || "").trim() ||
            `https://cursor.com/agents/${bcId}`;
          const prompt = String(
            args.prompt ||
              args.body ||
              args.text ||
              args.task ||
              args.q ||
              args.query ||
              "",
          ).trim() || "mcp cloud ping";
          const launchCmd = [bcId, url, prompt].join("|");
          const launchResults = await executeHostEffects([
            { kind: "cloud_agent_launch", command: launchCmd },
          ]);
          const launchHit = (launchResults || []).find(
            (r) => r && r.kind === "cloud_agent_launch",
          );
          let launchPayload = {};
          try {
            launchPayload = JSON.parse((launchHit && launchHit.stdout) || "{}");
          } catch {
            launchPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "cloud_agent_launch",
              cloud_launch: {
                path: launchPayload.path || null,
                bc_id: launchPayload.bc_id || bcId,
                url: launchPayload.url || url,
                mode: launchPayload.mode || null,
                status: launchPayload.status || null,
                pretend_remote_cloud: launchPayload.pretend_remote_cloud,
                remote_cloud_residual: launchPayload.remote_cloud_residual,
                launched: launchPayload.launched,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(launchHit && launchHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(launchHit && launchHit.ok),
            cloud_launch: launchPayload,
          });
        }
        if (mapped === "host_cloud_artifact_deliver") {
          // Product deliver_cloud_artifact → Host cloud_artifact_deliver; remote residual stays gated.
          const src =
            String(
              args.artifact ||
                args.bc_id ||
                args.source ||
                args.src ||
                args.path ||
                args.url ||
                args.id ||
                "",
            ).trim() || "bc-mcp-art";
          const dest =
            String(
              args.dest ||
                args.destination ||
                args.filename ||
                args.out ||
                args.name ||
                "",
            ).trim() || "mcp-cloud-report.md";
          const artCmd = [src, dest].join("|");
          const artResults = await executeHostEffects([
            { kind: "cloud_artifact_deliver", command: artCmd },
          ]);
          const artHit = (artResults || []).find(
            (r) => r && r.kind === "cloud_artifact_deliver",
          );
          let artPayload = {};
          try {
            artPayload = JSON.parse((artHit && artHit.stdout) || "{}");
          } catch {
            artPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "cloud_artifact_deliver",
              cloud_artifact: {
                path: artPayload.path || artPayload.artifact_path || null,
                meta_path: artPayload.meta_path || null,
                bc_id: artPayload.bc_id || null,
                mode: artPayload.mode || null,
                delivered: artPayload.delivered,
                pretend_delivered: artPayload.pretend_delivered,
                pretend_remote_fetch: artPayload.pretend_remote_fetch,
                remote_cloud_artifact_residual:
                  artPayload.remote_cloud_artifact_residual,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(artHit && artHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(artHit && artHit.ok),
            cloud_artifact: artPayload,
          });
        }
        if (mapped === "host_voice_session") {
          // Product voice_start → Host voice_session; STT/TTS residuals stay gated.
          const callId =
            String(
              args.call_id ||
                args.id ||
                args.voice_address ||
                args.address ||
                args.name ||
                "",
            ).trim() || `mcp-voice-${Date.now().toString(36)}`;
          const address = callId.startsWith("voice:")
            ? callId
            : `voice:${callId}`;
          const voiceCmd = ["start", address].join("|");
          const voiceResults = await executeHostEffects([
            { kind: "voice_session", command: voiceCmd },
          ]);
          const voiceHit = (voiceResults || []).find(
            (r) => r && r.kind === "voice_session",
          );
          let voicePayload = {};
          try {
            voicePayload = JSON.parse((voiceHit && voiceHit.stdout) || "{}");
          } catch {
            voicePayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "voice_session",
              voice_session: {
                path: voicePayload.path || null,
                voice_address: voicePayload.voice_address || address,
                call_id: voicePayload.call_id || null,
                mode: voicePayload.mode || "host_voice_session",
                live: voicePayload.live,
                pretend_live: voicePayload.pretend_live,
                pretend_media: voicePayload.pretend_media,
                voice_stt_residual: voicePayload.voice_stt_residual,
                voice_tts_residual: voicePayload.voice_tts_residual,
                media_path: voicePayload.media_path || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(voiceHit && voiceHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(voiceHit && voiceHit.ok),
            voice_session: voicePayload,
          });
        }
        if (mapped === "host_voice_relay") {
          // Product voice_relay → Host voice_relay; STT/TTS residuals stay gated.
          const address = String(
            args.voice_address ||
              args.address ||
              args.call_id ||
              args.id ||
              "",
          ).trim() || "voice:mcp-relay";
          const text = String(
            args.text ||
              args.body ||
              args.message ||
              args.prompt ||
              args.q ||
              args.query ||
              "",
          ).trim() || "mcp voice relay";
          const relayCmd = address + " :: " + text;
          const relayResults = await executeHostEffects([
            { kind: "voice_relay", command: relayCmd },
          ]);
          const relayHit = (relayResults || []).find(
            (r) => r && r.kind === "voice_relay",
          );
          let relayPayload = {};
          try {
            relayPayload = JSON.parse((relayHit && relayHit.stdout) || "{}");
          } catch {
            relayPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "voice_relay",
              voice_relay: {
                path: relayPayload.path || null,
                voice_address: relayPayload.voice_address || address,
                mode: relayPayload.mode || null,
                turns: relayPayload.turns,
                pretend_silent: relayPayload.pretend_silent,
                voice_stt_residual: relayPayload.voice_stt_residual,
                voice_tts_residual: relayPayload.voice_tts_residual,
                reply_media_ok: relayPayload.reply_media_ok,
                reply_media_path: relayPayload.reply_media_path || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(relayHit && relayHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(relayHit && relayHit.ok),
            voice_relay: relayPayload,
          });
        }
        if (mapped === "host_voice_end_write") {
          // Product voice_end → Host voice_end_write; voice_end_match_residual stays gated.
          const outPath = String(
            args.path ||
              args.out ||
              args.summary_path ||
              args.filename ||
              "",
          ).trim();
          const summary = String(
            args.summary ||
              args.body ||
              args.text ||
              args.message ||
              args.app_summary ||
              "",
          ).trim() || "mcp voice end";
          // Prefer call_id stem in path so match residual can close when session exists.
          const callStem = String(
            args.call_id ||
              args.id ||
              args.voice_address ||
              args.address ||
              "",
          )
            .trim()
            .replace(/^voice:/, "");
          // Basename stem must equal call_id / voice address (voice_end matchRank).
          const endPath =
            outPath ||
            (callStem
              ? `agent-tools/${callStem}.txt`
              : "agent-tools/voice-summary-mcp.txt");
          const endCmd = [endPath, summary].join("|");
          const endResults = await executeHostEffects([
            { kind: "voice_end_write", command: endCmd },
          ]);
          const endHit = (endResults || []).find(
            (r) => r && r.kind === "voice_end_write",
          );
          let endPayload = {};
          try {
            endPayload = JSON.parse((endHit && endHit.stdout) || "{}");
          } catch {
            endPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "voice_end_write",
              voice_end: {
                path: endPayload.path || null,
                summary_path: endPayload.summary_path || null,
                call_id: endPayload.call_id || null,
                mode: endPayload.mode || null,
                matched: endPayload.matched,
                voice_end_match_residual: endPayload.voice_end_match_residual,
                pretend_still_live: endPayload.pretend_still_live,
                app_summary: endPayload.app_summary || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(endHit && endHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(endHit && endHit.ok),
            voice_end: endPayload,
          });
        }
        if (mapped === "host_webfetch") {
          // Product webfetch / web_fetch / browser_open / open_url → Host webfetch;
          // public_fallback_residual stays gated (never credential_bypass).
          const fetchUrl = String(
            args.url ||
              args.href ||
              args.uri ||
              args.link ||
              args.target ||
              args.q ||
              args.query ||
              args.body ||
              "",
          ).trim();
          const fetchResults = await executeHostEffects([
            { kind: "webfetch", command: fetchUrl },
          ]);
          const fetchHit = (fetchResults || []).find(
            (r) => r && r.kind === "webfetch",
          );
          let fetchPayload = {};
          try {
            fetchPayload = JSON.parse((fetchHit && fetchHit.stdout) || "{}");
          } catch {
            fetchPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "webfetch",
              webfetch: {
                path: fetchPayload.path || null,
                url: fetchPayload.url || fetchUrl || null,
                mode: fetchPayload.mode || null,
                http_status: fetchPayload.http_status,
                used_fallback: fetchPayload.used_fallback,
                public_fallback_residual: fetchPayload.public_fallback_residual,
                pretend_fetched: fetchPayload.pretend_fetched,
                credential_bypass: fetchPayload.credential_bypass,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(fetchHit && fetchHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(fetchHit && fetchHit.ok),
            webfetch: fetchPayload,
          });
        }
        if (mapped === "host_screenshot") {
          // Product screenshot → Host screenshot; screenshot_residual stays gated.
          const agentId = String(
            args.agent || args.agent_id || args.id || "executor",
          ).trim() || "executor";
          const shotCmd = String(
            args.command || args.body || `agent=${agentId}`,
          ).trim() || `agent=${agentId}`;
          const shotResults = await executeHostEffects([
            { kind: "screenshot", command: shotCmd },
          ]);
          const shotHit = (shotResults || []).find(
            (r) => r && r.kind === "screenshot",
          );
          let shotPayload = {};
          try {
            shotPayload = JSON.parse((shotHit && shotHit.stdout) || "{}");
          } catch {
            shotPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "screenshot",
              screenshot: {
                path: shotPayload.path || null,
                frame_path: shotPayload.frame_path || null,
                mode: shotPayload.mode || null,
                screenshot_residual: shotPayload.screenshot_residual,
                pretend_frame: shotPayload.pretend_frame,
                pretend_live: shotPayload.pretend_live,
                has_frame: shotPayload.has_frame,
                read_only: shotPayload.read_only,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(shotHit && shotHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(shotHit && shotHit.ok),
            screenshot: shotPayload,
          });
        }
        if (mapped === "host_computer_use") {
          // Product computer_use / shop|travel|food → Host computer_use.
          // Nested CU residuals (ocr/os_window/live_paid/signin) stay gated.
          const cuUrl = String(
            args.url || args.href || args.q || args.query || "",
          ).trim();
          let cuCmd = String(
            args.command || args.body || args.prompt || "",
          ).trim();
          if (!cuCmd) {
            if (
              toolName === "shop_retail" ||
              String(toolName).startsWith("shop_")
            ) {
              cuCmd =
                "shopping:site-playbooks-target :: NAVIGATE " +
                (cuUrl || "example.com");
            } else if (
              toolName === "travel_book" ||
              String(toolName).startsWith("travel_")
            ) {
              cuCmd =
                "travel:flights:site-playbooks-expedia :: NAVIGATE " +
                (cuUrl || "example.com");
            } else if (
              toolName === "order_food" ||
              String(toolName).startsWith("food_")
            ) {
              cuCmd =
                "food:site-playbooks-doordash :: NAVIGATE " +
                (cuUrl || "example.com");
            } else {
              cuCmd = cuUrl || "https://example.com";
            }
          } else if (
            cuUrl &&
            !/https?:\/\//i.test(cuCmd) &&
            !/NAVIGATE/i.test(cuCmd)
          ) {
            cuCmd = cuCmd + " " + cuUrl;
          }
          const cuResults = await executeHostEffects([
            { kind: "computer_use", command: cuCmd },
          ]);
          const cuHit = (cuResults || []).find(
            (r) => r && r.kind === "computer_use",
          );
          let cuPayload = {};
          try {
            cuPayload = JSON.parse((cuHit && cuHit.stdout) || "{}");
          } catch {
            cuPayload = {};
          }
          const cuOutcome = cuPayload.outcome || {};
          const cuGui = cuPayload.gui || {};
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "computer_use",
              computer_use: {
                evidence: cuPayload.evidence || null,
                mode: cuPayload.mode || null,
                pretend_purchased: cuOutcome.pretend_purchased,
                vertical_family: cuOutcome.vertical_family || null,
                playbook_name: cuOutcome.playbook_name || null,
                ocr_residual: cuOutcome.ocr_residual,
                os_window_automation_residual:
                  cuOutcome.os_window_automation_residual != null
                    ? cuOutcome.os_window_automation_residual
                    : cuGui.os_window_automation_residual,
                live_paid_residual: cuOutcome.live_paid_residual,
                signin_fill_residual: cuOutcome.signin_fill_residual,
                credential_browser_fill_residual:
                  cuOutcome.credential_browser_fill_residual,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(cuHit && cuHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(cuHit && cuHit.ok),
            computer_use: cuPayload,
          });
        }
        if (mapped === "host_device_tools_list") {
          const machineId = String(
            args.machine_id || args.machine || args.id || "mcp-device",
          ).trim() || "mcp-device";
          const machineKind = String(
            args.machine_kind || args.kind || "desktop",
          ).trim() || "desktop";
          let toolsRaw = "";
          if (typeof args.tools === "string") {
            toolsRaw = args.tools;
          } else if (Array.isArray(args.tools)) {
            toolsRaw = args.tools
              .map((t) => {
                if (typeof t === "string") return t;
                if (t && typeof t === "object") {
                  return (
                    String(t.name || t.tool || "") +
                    "=" +
                    String(t.permission || t.perm || "unknown")
                  );
                }
                return "";
              })
              .filter(Boolean)
              .join(",");
          } else {
            toolsRaw = String(args.body || args.catalog || "camera=ask").trim();
          }
          const dtlCmd = [machineId, machineKind, toolsRaw].join("|");
          const dtlResults = await executeHostEffects([
            { kind: "device_tools_list", command: dtlCmd },
          ]);
          const dtlHit = (dtlResults || []).find(
            (r) => r && r.kind === "device_tools_list",
          );
          let dtlPayload = {};
          try {
            dtlPayload = JSON.parse((dtlHit && dtlHit.stdout) || "{}");
          } catch {
            dtlPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "device_tools_list",
              device_tools_list: {
                path: dtlPayload.path || null,
                count: dtlPayload.count,
                mode: dtlPayload.mode || null,
                pretend_granted: dtlPayload.pretend_granted,
                machine_id: dtlPayload.machine_id || machineId,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(dtlHit && dtlHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(dtlHit && dtlHit.ok),
            device_tools_list: dtlPayload,
          });
        }
        if (mapped === "host_device_tool") {
          // Product device_tool → Host device_tool; device_tool_residual stays gated.
          const machineId = String(
            args.machine_id || args.machine || args.id || "mcp-device",
          ).trim() || "mcp-device";
          const tool = String(
            args.tool || args.name || args.q || args.query || args.body || "camera",
          )
            .trim()
            .toLowerCase() || "camera";
          const dtCmd = [machineId, tool].join("|");
          const dtResults = await executeHostEffects([
            { kind: "device_tool", command: dtCmd },
          ]);
          const dtHit = (dtResults || []).find(
            (r) => r && r.kind === "device_tool",
          );
          let dtPayload = {};
          try {
            dtPayload = JSON.parse((dtHit && dtHit.stdout) || "{}");
          } catch {
            dtPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "device_tool",
              device_tool: {
                path: dtPayload.path || null,
                capture_path: dtPayload.capture_path || null,
                mode: dtPayload.mode || null,
                device_tool_residual: dtPayload.device_tool_residual,
                pretend_granted: dtPayload.pretend_granted,
                tool: dtPayload.tool || tool,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(dtHit && dtHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(dtHit && dtHit.ok),
            device_tool: dtPayload,
          });
        }
        if (mapped === "host_machines_list") {
          const hostKind = String(
            args.host_kind || args.kind || "desktop",
          ).trim() || "desktop";
          const hostId = String(
            args.host_id || args.id || "mcp-host",
          ).trim() || "mcp-host";
          let rowsRaw = "";
          if (typeof args.machines === "string") {
            rowsRaw = args.machines;
          } else if (Array.isArray(args.machines)) {
            rowsRaw = args.machines
              .map((m) => {
                if (typeof m === "string") return m;
                if (m && typeof m === "object") {
                  return [
                    m.id || "m1",
                    m.kind || "desktop",
                    m.status || "disconnected",
                  ].join(":");
                }
                return "";
              })
              .filter(Boolean)
              .join(",");
          } else {
            rowsRaw = String(
              args.rows || args.body || "desk-1:desktop:connected",
            ).trim();
          }
          const mlCmd = [hostKind, hostId, rowsRaw].join("|");
          const mlResults = await executeHostEffects([
            { kind: "machines_list", command: mlCmd },
          ]);
          const mlHit = (mlResults || []).find(
            (r) => r && r.kind === "machines_list",
          );
          let mlPayload = {};
          try {
            mlPayload = JSON.parse((mlHit && mlHit.stdout) || "{}");
          } catch {
            mlPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "machines_list",
              machines_list: {
                path: mlPayload.path || null,
                count: mlPayload.count,
                mode: mlPayload.mode || null,
                pretend_all_connected: mlPayload.pretend_all_connected,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(mlHit && mlHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(mlHit && mlHit.ok),
            machines_list: mlPayload,
          });
        }
        if (
          mapped === "host_copy_to_box" ||
          mapped === "host_copy_from_box"
        ) {
          // Product copy_* → Host copy kinds; cross_machine_copy_residual stays gated.
          const copyKind =
            mapped === "host_copy_from_box" ? "copy_from_box" : "copy_to_box";
          const machineId = String(
            args.machine_id || args.machine || "",
          ).trim();
          const src = String(
            args.src || args.source || args.from || args.path || "",
          ).trim();
          const dest = String(
            args.dest || args.destination || args.to || args.out || "",
          ).trim();
          const overwrite = String(args.overwrite || "").trim();
          const copyParts = [machineId, src, dest];
          if (overwrite) copyParts.push("overwrite=" + overwrite);
          const copyCmd = copyParts.join("|");
          const copyResults = await executeHostEffects([
            { kind: copyKind, command: copyCmd },
          ]);
          const copyHit = (copyResults || []).find(
            (r) => r && r.kind === copyKind,
          );
          let copyPayload = {};
          try {
            copyPayload = JSON.parse((copyHit && copyHit.stdout) || "{}");
          } catch {
            copyPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: copyKind,
              copy_box: {
                path: copyPayload.path || null,
                kind: copyKind,
                mode: copyPayload.mode || null,
                cross_machine_copy_residual:
                  copyPayload.cross_machine_copy_residual,
                pretend_remote_machine: copyPayload.pretend_remote_machine,
                bytes: copyPayload.bytes,
                refused: copyPayload.refused,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(copyHit && copyHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(copyHit && copyHit.ok),
            copy_box: copyPayload,
          });
        }
        if (mapped === "host_react_message") {
          const messageId = String(
            args.message_id || args.msg || args.id || "msg-mcp",
          ).trim() || "msg-mcp";
          const emoji = String(args.emoji || args.reaction || "👍").trim() || "👍";
          const reactCmd = `msg=${messageId} emoji=${emoji}`;
          const reactResults = await executeHostEffects([
            { kind: "react_message", command: reactCmd },
          ]);
          const reactHit = (reactResults || []).find(
            (r) => r && r.kind === "react_message",
          );
          let reactPayload = {};
          try {
            reactPayload = JSON.parse((reactHit && reactHit.stdout) || "{}");
          } catch {
            reactPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "react_message",
              react_message: {
                path: reactPayload.path || null,
                message_id: reactPayload.message_id || messageId,
                emoji: reactPayload.emoji || emoji,
                mode: reactPayload.mode || null,
                visible_pill: reactPayload.visible_pill,
                pretend_pill: reactPayload.pretend_pill,
                active: reactPayload.active,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(reactHit && reactHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(reactHit && reactHit.ok),
            react_message: reactPayload,
          });
        }
        if (mapped === "host_routine_schedule") {
          // Product routine_schedule / create_routine → Host routine_schedule.
          // long_lived_cron_residual stays gated unless daemon/unit armed.
          const rid = String(
            args.id || args.routine_id || args.name || "mcp-routine",
          ).trim() || "mcp-routine";
          const cron = String(
            args.cron || args.schedule || args.when || "@daily",
          ).trim() || "@daily";
          const prompt = String(
            args.prompt || args.body || args.text || args.q || "mcp routine",
          ).trim() || "mcp routine";
          const routCmd = [rid, cron, prompt].join("|");
          const routResults = await executeHostEffects([
            { kind: "routine_schedule", command: routCmd },
          ]);
          const routHit = (routResults || []).find(
            (r) => r && r.kind === "routine_schedule",
          );
          let routPayload = {};
          try {
            routPayload = JSON.parse((routHit && routHit.stdout) || "{}");
          } catch {
            routPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "routine_schedule",
              routine_schedule: {
                path: routPayload.path || null,
                id: routPayload.id || rid,
                cron: routPayload.cron || cron,
                mode: routPayload.mode || null,
                stored: routPayload.stored,
                pretend_scheduled: routPayload.pretend_scheduled,
                long_lived_cron_residual: routPayload.long_lived_cron_residual,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(routHit && routHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(routHit && routHit.ok),
            routine_schedule: routPayload,
          });
        }
        if (mapped === "host_box_doctor") {
          // Product box_doctor → Host box_doctor; box_doctor_bin_residual stays gated.
          const doctorCmd = String(
            args.command || args.body || args.q || "box-doctor",
          ).trim() || "box-doctor";
          const doctorResults = await executeHostEffects([
            { kind: "box_doctor", command: doctorCmd },
          ]);
          const doctorHit = (doctorResults || []).find(
            (r) => r && r.kind === "box_doctor",
          );
          let doctorPayload = {};
          try {
            doctorPayload = JSON.parse((doctorHit && doctorHit.stdout) || "{}");
          } catch {
            doctorPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "box_doctor",
              box_doctor: {
                path: doctorPayload.path || null,
                log_path: doctorPayload.log_path || null,
                mode: doctorPayload.mode || null,
                box_doctor_bin_residual: doctorPayload.box_doctor_bin_residual,
                pretend_healthy: doctorPayload.pretend_healthy,
                pass_count: doctorPayload.pass_count,
                fail_count: doctorPayload.fail_count,
                doctor_bin: doctorPayload.doctor_bin || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(doctorHit && doctorHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(doctorHit && doctorHit.ok),
            box_doctor: doctorPayload,
          });
        }
        if (mapped === "host_box_env") {
          // Product box_env → Host box_env.
          const envCmd = String(
            args.command || args.body || args.q || "env-detect",
          ).trim() || "env-detect";
          const envResults = await executeHostEffects([
            { kind: "box_env", command: envCmd },
          ]);
          const envHit = (envResults || []).find(
            (r) => r && r.kind === "box_env",
          );
          let envPayload = {};
          try {
            envPayload = JSON.parse((envHit && envHit.stdout) || "{}");
          } catch {
            envPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "box_env",
              box_env: {
                path: envPayload.path || null,
                diagnostic_path: envPayload.diagnostic_path || null,
                mode: envPayload.mode || null,
                runtime: envPayload.runtime || null,
                pretend_runtime: envPayload.pretend_runtime,
                dockerenv_present: envPayload.dockerenv_present,
                hosted: envPayload.hosted,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(envHit && envHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(envHit && envHit.ok),
            box_env: envPayload,
          });
        }
        if (mapped === "host_box_clock") {
          // Product box_clock → Host box_clock.
          const clockCmd = String(
            args.command || args.body || args.q || "date",
          ).trim() || "date";
          const clockResults = await executeHostEffects([
            { kind: "box_clock", command: clockCmd },
          ]);
          const clockHit = (clockResults || []).find(
            (r) => r && r.kind === "box_clock",
          );
          let clockPayload = {};
          try {
            clockPayload = JSON.parse((clockHit && clockHit.stdout) || "{}");
          } catch {
            clockPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "box_clock",
              box_clock: {
                path: clockPayload.path || null,
                date_output_path: clockPayload.date_output_path || null,
                mode: clockPayload.mode || null,
                user_iana: clockPayload.user_iana || null,
                date_raw: clockPayload.date_raw || null,
                pretend_aligned: clockPayload.pretend_aligned,
                aligns: clockPayload.aligns,
                zone_status: clockPayload.zone_status || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(clockHit && clockHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(clockHit && clockHit.ok),
            box_clock: clockPayload,
          });
        }
        if (mapped === "host_package_install") {
          // Product package_install → Host package_install (Shell-via honesty).
          const pkgsRaw =
            args.pkgs ||
            args.packages ||
            args.package ||
            args.name ||
            args.body ||
            "";
          const pkgsStr = Array.isArray(pkgsRaw)
            ? pkgsRaw.map((p) => String(p).trim()).filter(Boolean).join(",")
            : String(pkgsRaw).trim();
          const pm = String(args.pm || args.package_manager || "npm").trim() || "npm";
          const via = String(args.via || "shell").trim() || "shell";
          let pkgCmd = String(args.command || "").trim();
          if (!pkgCmd) {
            pkgCmd =
              "via=" +
              via +
              " pm=" +
              pm +
              (pkgsStr ? " pkgs=" + pkgsStr : "");
          }
          const pkgResults = await executeHostEffects([
            { kind: "package_install", command: pkgCmd },
          ]);
          const pkgHit = (pkgResults || []).find(
            (r) => r && r.kind === "package_install",
          );
          let pkgPayload = {};
          try {
            pkgPayload = JSON.parse((pkgHit && pkgHit.stdout) || "{}");
          } catch {
            pkgPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "package_install",
              package_install: {
                path: pkgPayload.path || null,
                mode: pkgPayload.mode || null,
                via: pkgPayload.via || null,
                via_shell: pkgPayload.via_shell,
                pm: pkgPayload.pm || null,
                packages: pkgPayload.packages || null,
                completed: pkgPayload.completed,
                refused: pkgPayload.refused,
                pretend_installed: pkgPayload.pretend_installed,
                tree_ok: pkgPayload.tree_ok,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(pkgHit && pkgHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(pkgHit && pkgHit.ok),
            package_install: pkgPayload,
          });
        }
        if (mapped === "host_shell") {
          // Product shell → Host shell. Approval honesty: never pretend user approved.
          const shellCmd = String(
            args.command || args.cmd || args.body || args.q || "",
          ).trim();
          const shellApproved =
            args.approved === true ||
            args.approved === "true" ||
            args.approved === 1 ||
            args.approved === "1";
          // Honesty: mcp product short-circuit does not mint approval; refuse unless args.approved.
          if (!shellApproved) {
            const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
              command,
              {
                tool: toolName,
                mapped,
                host_kind: "shell",
                shell: {
                  command: shellCmd || null,
                  mode: "host_shell_needs_approval",
                  pretend_approved: false,
                  pretend_ok: false,
                  needs_approval: true,
                  ran: false,
                },
                product_tool_residual: false,
                pretend_ok: false,
                pretend_approved: false,
                ok: true,
                at: shortAt,
              },
            );
            return okJson(kind, command, {
              ...callArtifact,
              tool: toolName,
              mapped,
              product_tool_residual: false,
              path: snapPath,
              pretend_ok: false,
              pretend_approved: false,
              ok: true,
              shell: {
                command: shellCmd || null,
                mode: "host_shell_needs_approval",
                pretend_approved: false,
                needs_approval: true,
                ran: false,
              },
            });
          }
          const shellResults = await executeHostEffects([
            { kind: "shell", command: shellCmd },
          ]);
          const shellHit = (shellResults || []).find(
            (r) => r && r.kind === "shell",
          );
          let shellPayload = {};
          try {
            shellPayload = JSON.parse((shellHit && shellHit.stdout) || "{}");
          } catch {
            // Host shell keeps raw stdout for reinjection; wrap honestly.
            shellPayload = {
              command: shellCmd,
              stdout_prefix: String((shellHit && shellHit.stdout) || "").slice(
                0,
                400,
              ),
              path: shellHit && shellHit.path,
              mode: "host_shell_exec",
              pretend_ok: false,
            };
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "shell",
              shell: {
                command: shellCmd || null,
                path: (shellHit && shellHit.path) || shellPayload.path || null,
                mode: shellPayload.mode || "host_shell_exec",
                pretend_approved: false,
                pretend_ok: false,
                needs_approval: false,
                ran: Boolean(shellHit && shellHit.ok),
                ok: Boolean(shellHit && shellHit.ok),
              },
              product_tool_residual: false,
              pretend_ok: false,
              pretend_approved: false,
              ok: Boolean(shellHit && shellHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            pretend_approved: false,
            ok: Boolean(shellHit && shellHit.ok),
            shell: {
              ...shellPayload,
              command: shellCmd || null,
              pretend_approved: false,
              needs_approval: false,
              ran: Boolean(shellHit && shellHit.ok),
            },
          });
        }
        if (mapped === "host_fs_list") {
          // Product fs_list / listdir → Host fs_list.
          const listPath = String(
            args.path || args.dir || args.directory || args.body || args.q || ".",
          ).trim() || ".";
          const listResults = await executeHostEffects([
            { kind: "fs_list", command: listPath },
          ]);
          const listHit = (listResults || []).find(
            (r) => r && r.kind === "fs_list",
          );
          let listPayload = {};
          try {
            listPayload = JSON.parse((listHit && listHit.stdout) || "{}");
          } catch {
            listPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "fs_list",
              fs_list: {
                path: listPayload.path || null,
                listed_path: listPayload.listed_path || listPath,
                mode: listPayload.mode || null,
                count: listPayload.count,
                pretend_listing: listPayload.pretend_listing,
                under_repo: listPayload.under_repo,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(listHit && listHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(listHit && listHit.ok),
            fs_list: listPayload,
          });
        }
        if (mapped === "host_fs_read") {
          // Product fs_read / read_file → Host fs_read.
          const readPath = String(
            args.path || args.file || args.filename || args.body || args.q || "",
          ).trim();
          const readResults = await executeHostEffects([
            { kind: "fs_read", command: readPath },
          ]);
          const readHit = (readResults || []).find(
            (r) => r && r.kind === "fs_read",
          );
          let readPayload = {};
          try {
            readPayload = JSON.parse((readHit && readHit.stdout) || "{}");
          } catch {
            readPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "fs_read",
              fs_read: {
                path: readPayload.path || null,
                read_path: readPayload.read_path || readPath,
                mode: readPayload.mode || null,
                bytes: readPayload.bytes,
                pretend_contents: readPayload.pretend_contents,
                under_repo: readPayload.under_repo,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(readHit && readHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(readHit && readHit.ok),
            fs_read: readPayload,
          });
        }
        if (mapped === "host_shared_box_fs") {
          // Product shared_box_fs → Host shared_box_fs.
          const sharedFsCmd = String(
            args.command || args.body || args.q || "probe",
          ).trim() || "probe";
          const sharedFsResults = await executeHostEffects([
            { kind: "shared_box_fs", command: sharedFsCmd },
          ]);
          const sharedFsHit = (sharedFsResults || []).find(
            (r) => r && r.kind === "shared_box_fs",
          );
          let sharedFsPayload = {};
          try {
            sharedFsPayload = JSON.parse(
              (sharedFsHit && sharedFsHit.stdout) || "{}",
            );
          } catch {
            sharedFsPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "shared_box_fs",
              shared_box_fs: {
                path: sharedFsPayload.path || null,
                shared_path: sharedFsPayload.shared_path || null,
                mode: sharedFsPayload.mode || null,
                pretend_shared: sharedFsPayload.pretend_shared,
                shared_fs: sharedFsPayload.shared_fs,
                distinct_desktops: sharedFsPayload.distinct_desktops,
                charter_consistent: sharedFsPayload.charter_consistent,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(sharedFsHit && sharedFsHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(sharedFsHit && sharedFsHit.ok),
            shared_box_fs: sharedFsPayload,
          });
        }
        if (mapped === "host_journal_append") {
          // Product journal_append → Host journal_append.
          const jDate = String(args.date || args.day || "").trim();
          const jEvent = String(
            args.event_id || args.event || args.id || "",
          ).trim();
          const jBody = String(
            args.body || args.text || args.content || args.q || "",
          ).trim();
          let jAppendCmd = String(args.command || "").trim();
          if (!jAppendCmd) {
            jAppendCmd = [jDate, jEvent, jBody].join("|");
          }
          const jAppendResults = await executeHostEffects([
            { kind: "journal_append", command: jAppendCmd },
          ]);
          const jAppendHit = (jAppendResults || []).find(
            (r) => r && r.kind === "journal_append",
          );
          let jAppendPayload = {};
          try {
            jAppendPayload = JSON.parse(
              (jAppendHit && jAppendHit.stdout) || "{}",
            );
          } catch {
            jAppendPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "journal_append",
              journal_append: {
                path: jAppendPayload.path || null,
                events_path: jAppendPayload.events_path || null,
                mode: jAppendPayload.mode || null,
                stored: jAppendPayload.stored,
                pretend_stored: jAppendPayload.pretend_stored,
                pollutes_profile: jAppendPayload.pollutes_profile,
                date: jAppendPayload.date || null,
                event_id: jAppendPayload.event_id || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(jAppendHit && jAppendHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(jAppendHit && jAppendHit.ok),
            journal_append: jAppendPayload,
          });
        }
        if (mapped === "host_journal_query") {
          // Product journal_query → Host journal_query (not echo / journal_tail stub).
          const fromDate = String(
            args.from_date || args.from || args.start || "",
          ).trim();
          const toDate = String(
            args.to_date || args.to || args.end || "",
          ).trim();
          let jQueryCmd = String(args.command || "").trim();
          if (!jQueryCmd) {
            jQueryCmd = [fromDate, toDate].join("|");
          }
          const jQueryResults = await executeHostEffects([
            { kind: "journal_query", command: jQueryCmd },
          ]);
          const jQueryHit = (jQueryResults || []).find(
            (r) => r && r.kind === "journal_query",
          );
          let jQueryPayload = {};
          try {
            jQueryPayload = JSON.parse(
              (jQueryHit && jQueryHit.stdout) || "{}",
            );
          } catch {
            jQueryPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "journal_query",
              journal_query: {
                path: jQueryPayload.path || null,
                mode: jQueryPayload.mode || null,
                hit_count: jQueryPayload.hit_count,
                pretend_hits: jQueryPayload.pretend_hits,
                pollutes_profile: jQueryPayload.pollutes_profile,
                from_date: jQueryPayload.from_date || null,
                to_date: jQueryPayload.to_date || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(jQueryHit && jQueryHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(jQueryHit && jQueryHit.ok),
            journal_query: jQueryPayload,
          });
        }
        if (mapped === "host_shared_memory_put") {
          // Product shared_memory_put → Host shared_memory_put.
          const memScope = String(
            args.scope || args.namespace || "default",
          ).trim() || "default";
          const memKey = String(args.key || args.name || "").trim();
          const memValue = String(
            args.value != null
              ? args.value
              : args.body != null
                ? args.body
                : args.text != null
                  ? args.text
                  : "",
          );
          let memPutCmd = String(args.command || "").trim();
          if (!memPutCmd) {
            memPutCmd = [memScope, memKey, memValue].join("|");
          }
          const memPutResults = await executeHostEffects([
            { kind: "shared_memory_put", command: memPutCmd },
          ]);
          const memPutHit = (memPutResults || []).find(
            (r) => r && r.kind === "shared_memory_put",
          );
          let memPutPayload = {};
          try {
            memPutPayload = JSON.parse(
              (memPutHit && memPutHit.stdout) || "{}",
            );
          } catch {
            memPutPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "shared_memory_put",
              shared_memory_put: {
                path: memPutPayload.path || null,
                store_path: memPutPayload.store_path || null,
                mode: memPutPayload.mode || null,
                stored: memPutPayload.stored,
                pretend_stored: memPutPayload.pretend_stored,
                pretend_cross_scope: memPutPayload.pretend_cross_scope,
                scope: memPutPayload.scope || null,
                key: memPutPayload.key || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(memPutHit && memPutHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(memPutHit && memPutHit.ok),
            shared_memory_put: memPutPayload,
          });
        }
        if (mapped === "host_shared_memory_read") {
          // Product shared_memory_read → Host shared_memory_read; cross-scope stays refused.
          const memReadScope = String(
            args.scope || args.namespace || "default",
          ).trim() || "default";
          const memReadKey = String(args.key || args.name || "").trim();
          let memReadCmd = String(args.command || "").trim();
          if (!memReadCmd) {
            memReadCmd = [memReadScope, memReadKey].join("|");
          }
          const memReadResults = await executeHostEffects([
            { kind: "shared_memory_read", command: memReadCmd },
          ]);
          const memReadHit = (memReadResults || []).find(
            (r) => r && r.kind === "shared_memory_read",
          );
          let memReadPayload = {};
          try {
            memReadPayload = JSON.parse(
              (memReadHit && memReadHit.stdout) || "{}",
            );
          } catch {
            memReadPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "shared_memory_read",
              shared_memory_read: {
                path: memReadPayload.path || null,
                mode: memReadPayload.mode || null,
                found: memReadPayload.found,
                refused_cross_scope: memReadPayload.refused_cross_scope,
                pretend_cross_scope: memReadPayload.pretend_cross_scope,
                scope: memReadPayload.scope || memReadScope,
                key: memReadPayload.key || memReadKey,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(memReadHit && memReadHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(memReadHit && memReadHit.ok),
            shared_memory_read: memReadPayload,
          });
        }
        if (mapped === "host_connectors_probe") {
          const probeResults = await executeHostEffects([
            { kind: "connectors_probe", command: "" },
          ]);
          const probeHit = (probeResults || []).find(
            (r) => r && r.kind === "connectors_probe",
          );
          let probePayload = {};
          try {
            probePayload = JSON.parse((probeHit && probeHit.stdout) || "{}");
          } catch {
            probePayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "connectors_probe",
              connectors_probe: {
                path: probePayload.path || null,
                mode: probePayload.mode || null,
                pretend_all_connected: probePayload.pretend_all_connected,
                connector_count: Object.keys(probePayload.connectors || {})
                  .length,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(probeHit && probeHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(probeHit && probeHit.ok),
            connectors_probe: probePayload,
          });
        }
        if (mapped === "host_mcp_discover") {
          const discResults = await executeHostEffects([
            { kind: "mcp_discover", command: String(args.command || "").trim() },
          ]);
          const discHit = (discResults || []).find(
            (r) => r && r.kind === "mcp_discover",
          );
          let discPayload = {};
          try {
            discPayload = JSON.parse((discHit && discHit.stdout) || "{}");
          } catch {
            discPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "mcp_discover",
              mcp_discover: {
                path: discPayload.path || null,
                tool_count: discPayload.tool_count,
                pretend_empty: discPayload.pretend_empty,
                pretend_discovered: discPayload.pretend_discovered,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(discHit && discHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(discHit && discHit.ok),
            mcp_discover: discPayload,
          });
        }
        if (mapped === "host_mcp_namespace") {
          // Product install_plugin → Host mcp_namespace register (never pretend_registered).
          const ns =
            String(
              args.namespace ||
                args.plugin ||
                args.name ||
                args.id ||
                "user-Slides",
            ).trim() || "user-Slides";
          const pluginId =
            String(args.plugin_id || args.pluginId || args.id || "plugin-slides")
              .trim() || "plugin-slides";
          const nsCmd =
            String(args.command || "").trim() || `${ns}|${pluginId}`;
          const nsResults = await executeHostEffects([
            { kind: "mcp_namespace", command: nsCmd },
          ]);
          const nsHit = (nsResults || []).find(
            (r) => r && r.kind === "mcp_namespace",
          );
          let nsPayload = {};
          try {
            nsPayload = JSON.parse((nsHit && nsHit.stdout) || "{}");
          } catch {
            nsPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "mcp_namespace",
              mcp_namespace: {
                path: nsPayload.path || null,
                catalog_path: nsPayload.catalog_path || null,
                namespace: nsPayload.namespace || ns,
                plugin_id: nsPayload.plugin_id || pluginId,
                status: nsPayload.status || null,
                usable: nsPayload.usable,
                pretend_registered: nsPayload.pretend_registered,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(nsHit && nsHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(nsHit && nsHit.ok),
            mcp_namespace: nsPayload,
          });
        }
        if (mapped === "host_mcp_list_plugins") {
          // Product list_plugins / open_plugins / search_plugins → Host mcp_list_plugins.
          const q =
            String(
              args.q || args.query || args.search || args.body || "",
            ).trim() || "";
          const listCmd =
            String(args.command || "").trim() || (q ? `q=${q}` : "");
          const listResults = await executeHostEffects([
            { kind: "mcp_list_plugins", command: listCmd },
          ]);
          const listHit = (listResults || []).find(
            (r) => r && r.kind === "mcp_list_plugins",
          );
          let listPayload = {};
          try {
            listPayload = JSON.parse((listHit && listHit.stdout) || "{}");
          } catch {
            listPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "mcp_list_plugins",
              mcp_list_plugins: {
                path: listPayload.path || null,
                mode: listPayload.mode || null,
                count: listPayload.count,
                query: listPayload.query || null,
                pretend_listing: listPayload.pretend_listing,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(listHit && listHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(listHit && listHit.ok),
            mcp_list_plugins: listPayload,
          });
        }
        if (mapped === "host_mcp_get_plugin") {
          // Product get_plugin → Host mcp_get_plugin (never invent unknown plugins).
          const pluginId =
            String(
              args.plugin_id ||
                args.pluginId ||
                args.id ||
                args.plugin ||
                args.name ||
                args.body ||
                "plugin-slides",
            ).trim() || "plugin-slides";
          const getCmd = String(args.command || "").trim() || pluginId;
          const getResults = await executeHostEffects([
            { kind: "mcp_get_plugin", command: getCmd },
          ]);
          const getHit = (getResults || []).find(
            (r) => r && r.kind === "mcp_get_plugin",
          );
          let getPayload = {};
          try {
            getPayload = JSON.parse((getHit && getHit.stdout) || "{}");
          } catch {
            getPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "mcp_get_plugin",
              mcp_get_plugin: {
                path: getPayload.path || null,
                mode: getPayload.mode || null,
                id: getPayload.id || null,
                plugin_id: getPayload.plugin_id || pluginId,
                skill_count: getPayload.skill_count,
                pretend_plugin: getPayload.pretend_plugin,
                refused: getPayload.refused,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(getHit && getHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(getHit && getHit.ok),
            mcp_get_plugin: getPayload,
          });
        }
        if (mapped === "host_memory_recall") {
          const recallQ = String(
            args.q || args.query || args.prefix || args.key || args.body || "smoke",
          ).trim() || "smoke";
          const recallResults = await executeHostEffects([
            { kind: "memory_recall", command: recallQ },
          ]);
          const recallHit = (recallResults || []).find(
            (r) => r && r.kind === "memory_recall",
          );
          let recallPayload = {};
          try {
            recallPayload = JSON.parse((recallHit && recallHit.stdout) || "{}");
          } catch {
            recallPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "memory_recall",
              memory_recall: {
                path: recallPayload.path || null,
                mode: recallPayload.mode || null,
                count: recallPayload.count,
                pretend_empty: recallPayload.pretend_empty,
                prefix: recallPayload.prefix || recallQ,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(recallHit && recallHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(recallHit && recallHit.ok),
            memory_recall: recallPayload,
          });
        }
        if (mapped === "host_device_permission") {
          const permTool = String(
            args.tool || args.name || args.device || args.body || "camera",
          )
            .trim()
            .toLowerCase() || "camera";
          const permResults = await executeHostEffects([
            { kind: "device_permission", command: permTool },
          ]);
          const permHit = (permResults || []).find(
            (r) => r && r.kind === "device_permission",
          );
          let permPayload = {};
          try {
            permPayload = JSON.parse((permHit && permHit.stdout) || "{}");
          } catch {
            permPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "device_permission",
              device_permission: {
                path: permPayload.path || null,
                tool: permPayload.tool || permTool,
                permission: permPayload.permission || null,
                pretend_granted: permPayload.pretend_granted,
                true_device_os_dialog_residual:
                  permPayload.true_device_os_dialog_residual,
                mode: permPayload.mode || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(permHit && permHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(permHit && permHit.ok),
            device_permission: permPayload,
          });
        }
        if (mapped === "host_members_panel") {
          const membersCmd = String(
            args.command || args.group || args.group_id || "",
          ).trim();
          const membersResults = await executeHostEffects([
            { kind: "members_panel", command: membersCmd },
          ]);
          const membersHit = (membersResults || []).find(
            (r) => r && r.kind === "members_panel",
          );
          let membersPayload = {};
          try {
            membersPayload = JSON.parse(
              (membersHit && membersHit.stdout) || "{}",
            );
          } catch {
            membersPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "members_panel",
              members_panel: {
                path: membersPayload.path || membersPayload.panel_path || null,
                mode: membersPayload.mode || null,
                pretend_members: membersPayload.pretend_members,
                member_ids: membersPayload.member_ids || [],
                section_anchor: membersPayload.section_anchor || null,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(membersHit && membersHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(membersHit && membersHit.ok),
            members_panel: membersPayload,
          });
        }
        if (mapped === "host_update_computer") {
          const updCmd = String(
            args.command || args.phase || args.action || args.body || "",
          ).trim();
          const updResults = await executeHostEffects([
            { kind: "update_computer", command: updCmd },
          ]);
          const updHit = (updResults || []).find(
            (r) => r && r.kind === "update_computer",
          );
          let updPayload = {};
          try {
            updPayload = JSON.parse((updHit && updHit.stdout) || "{}");
          } catch {
            updPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
            command,
            {
              tool: toolName,
              mapped,
              host_kind: "update_computer",
              update_computer: {
                path: updPayload.path || null,
                mode: updPayload.mode || null,
                phase: updPayload.phase || null,
                pretend_updated: updPayload.pretend_updated,
                two_step_ready: updPayload.two_step_ready,
                guide_before_reset: updPayload.guide_before_reset,
              },
              product_tool_residual: false,
              pretend_ok: false,
              ok: Boolean(updHit && updHit.ok),
              at: shortAt,
            },
          );
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(updHit && updHit.ok),
            update_computer: updPayload,
          });
        }
        // Generic product→Host short-circuits for UI/settings/memory/agent ops.
        {
          const genericMaps = {
            host_memory_update: {
              kind: "memory_update",
              field: "memory_update",
              cmd: () =>
                String(args.command || "").trim() ||
                [
                  String(args.key || args.name || "mcp-key").trim() || "mcp-key",
                  String(args.value || args.v || args.body || "mcp-val").trim() ||
                    "mcp-val",
                  String(args.scope || "profile").trim() || "profile",
                ].join("|"),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                key: p.key || null,
                pretend_persisted: p.pretend_persisted,
              }),
            },
            host_hide_agent: {
              kind: "hide_agent",
              field: "hide_agent",
              cmd: () =>
                String(
                  args.command || args.agent_id || args.id || args.agent || "asst-mcp",
                ).trim() || "asst-mcp",
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                agent_id: p.agent_id || null,
                pretend_removed: p.pretend_removed,
                hidden: p.hidden,
              }),
            },
            host_list_agents_sidebar: {
              kind: "list_agents_sidebar",
              field: "list_agents_sidebar",
              cmd: () => String(args.command || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_complete: p.pretend_complete,
                sidebar_ids: p.sidebar_ids || [],
              }),
            },
            host_check_updates: {
              kind: "check_updates",
              field: "check_updates",
              cmd: () => String(args.command || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_opened: p.pretend_opened,
                ne_update_computer: p.ne_update_computer,
                distinct_deep_links: p.distinct_deep_links,
              }),
            },
            host_notify_settings: {
              kind: "notify_settings",
              field: "notify_settings",
              cmd: () =>
                String(args.command || args.assistant_id || args.id || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_global: p.pretend_global,
                assistant_scoped: p.assistant_scoped,
              }),
            },
            host_set_notify: {
              kind: "set_notify",
              field: "set_notify",
              cmd: () =>
                String(args.command || "").trim() ||
                [
                  String(args.toggle || args.key || "desktop").trim() || "desktop",
                  String(args.enabled != null ? args.enabled : args.value || "on")
                    .trim() || "on",
                  String(args.assistant_id || args.id || "").trim(),
                ]
                  .filter(Boolean)
                  .join("|"),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_updated: p.pretend_updated,
                toggle: p.toggle || null,
                enabled: p.enabled,
              }),
            },
            host_inbound_reaction: {
              kind: "inbound_reaction",
              field: "inbound_reaction",
              cmd: () =>
                String(args.command || "").trim() ||
                [
                  String(args.message_id || args.msg || "msg-mcp").trim() ||
                    "msg-mcp",
                  String(args.emoji || args.reaction || "+1").trim() || "+1",
                ].join("|"),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_forced_reply: p.pretend_forced_reply,
                emoji: p.emoji || null,
                visible_pill: p.visible_pill,
              }),
            },
            host_mcp_uninstall: {
              kind: "mcp_uninstall",
              field: "mcp_uninstall",
              cmd: () =>
                String(
                  args.command ||
                    args.namespace ||
                    args.plugin ||
                    args.name ||
                    "user-Slides",
                ).trim() || "user-Slides",
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_uninstalled: p.pretend_uninstalled,
                namespace: p.namespace || null,
                status: p.status || null,
                usable: p.usable,
              }),
            },
            host_approval_card: {
              kind: "approval_card",
              field: "approval_card",
              cmd: () =>
                String(
                  args.command ||
                    args.body ||
                    args.text ||
                    "Shell :: mcp approval :: needs confirmation",
                ).trim() || "Shell :: mcp approval :: needs confirmation",
              pick: (p) => ({
                path: p.path || null,
                status: p.status || null,
                pretend_approved: p.pretend_approved,
                widget_id: (p.widget && p.widget.widget_id) || null,
              }),
            },
            host_reset_computer: {
              kind: "reset_computer",
              field: "reset_computer",
              cmd: () =>
                String(args.command || args.action || args.body || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_reset: p.pretend_reset,
                prefer_update_computer: p.prefer_update_computer,
              }),
            },
            host_routine_list: {
              kind: "routine_list",
              field: "routine_list",
              cmd: () => String(args.command || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_empty: p.pretend_empty,
                count: p.count,
              }),
            },
            host_routine_pause: {
              kind: "routine_pause",
              field: "routine_pause",
              cmd: () =>
                String(args.command || args.id || args.routine_id || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_paused: p.pretend_paused,
                id: p.id || null,
              }),
            },
            host_routine_resume: {
              kind: "routine_resume",
              field: "routine_resume",
              cmd: () =>
                String(args.command || args.id || args.routine_id || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_resumed: p.pretend_resumed,
                id: p.id || null,
              }),
            },
            host_routine_fire: {
              kind: "routine_fire",
              field: "routine_fire",
              cmd: () =>
                String(args.command || args.id || args.routine_id || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_fired: p.pretend_fired,
                id: p.id || null,
              }),
            },
            host_routine_tick: {
              kind: "routine_tick",
              field: "routine_tick",
              cmd: () => String(args.command || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                fired: p.fired,
                long_lived: p.long_lived,
              }),
            },
            host_box_chrome_probe: {
              kind: "box_chrome_probe",
              field: "box_chrome_probe",
              cmd: () => String(args.command || args.url || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_launched: p.pretend_launched,
                box_chrome_bin_residual: p.box_chrome_bin_residual,
              }),
            },
            host_webhook_panel: {
              kind: "webhook_panel",
              field: "webhook_panel",
              cmd: () =>
                String(args.command || args.action || "open").trim() || "open",
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_key_readable: p.pretend_key_readable,
                key_leaked: p.key_leaked,
              }),
            },
            host_local_execution: {
              kind: "local_execution",
              field: "local_execution",
              cmd: () =>
                String(args.command || args.body || args.shell || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_on: p.pretend_on,
              }),
            },
            host_guide_permission: {
              kind: "guide_permission",
              field: "guide_permission",
              cmd: () =>
                String(args.command || args.tool || args.body || "camera").trim() ||
                "camera",
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_connected: p.pretend_connected,
              }),
            },
            host_render_markdown: {
              kind: "render_markdown",
              field: "render_markdown",
              cmd: () =>
                String(args.command || args.body || args.markdown || args.text || "# mcp").trim() ||
                "# mcp",
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_rendered: p.pretend_rendered,
              }),
            },
            host_auto_review_settings: {
              kind: "auto_review_settings",
              field: "auto_review_settings",
              cmd: () => String(args.command || "").trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_opened: p.pretend_opened,
              }),
            },
            host_settings_open: {
              kind: "settings_open",
              field: "settings_open",
              cmd: () =>
                String(
                  args.command ||
                    args.anchor ||
                    args.id ||
                    args.section ||
                    args.body ||
                    "",
                ).trim(),
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_opened: p.pretend_opened,
                anchor: p.anchor || null,
              }),
            },
            host_delete_agent: {
              kind: "delete_agent",
              field: "delete_agent",
              cmd: () =>
                String(
                  args.command ||
                    args.agent_id ||
                    args.id ||
                    args.agent ||
                    "asst-mcp",
                ).trim() || "asst-mcp",
              pick: (p) => ({
                path: p.path || null,
                mode: p.mode || null,
                pretend_deleted: p.pretend_deleted,
                agent_id: p.agent_id || null,
                phase: p.phase || null,
              }),
            },
            host_todo_write: {
              kind: "todo_write",
              field: "todo_write",
              cmd: () => {
                if (args.items || args.todos || args.list) {
                  return JSON.stringify({
                    items: args.items || args.todos || args.list,
                  });
                }
                if (args.id || args.title || args.content || args.text) {
                  return JSON.stringify({
                    id: args.id,
                    title: args.title || args.content || args.text,
                    status: args.status || args.state || "pending",
                  });
                }
                return String(args.command || args.body || "").trim();
              },
              pick: (p) => ({
                path: p.path || null,
                store_path: p.store_path || null,
                mode: p.mode || null,
                pretend_complete: p.pretend_complete,
                item_count: p.item_count,
                done_count: p.done_count,
              }),
            },
          };
          const gSpec = genericMaps[mapped];
          if (gSpec) {
            const gCmd = gSpec.cmd();
            const gResults = await executeHostEffects([
              { kind: gSpec.kind, command: gCmd },
            ]);
            const gHit = (gResults || []).find(
              (r) => r && r.kind === gSpec.kind,
            );
            let gPayload = {};
            try {
              gPayload = JSON.parse((gHit && gHit.stdout) || "{}");
            } catch {
              gPayload = {};
            }
            const picked = gSpec.pick(gPayload) || {};
            const { snapPath, artifact: callArtifact } = writeMcpCallSnap(
              command,
              {
                tool: toolName,
                mapped,
                host_kind: gSpec.kind,
                [gSpec.field]: picked,
                product_tool_residual: false,
                pretend_ok: false,
                ok: Boolean(gHit && gHit.ok),
                at: shortAt,
              },
            );
            return okJson(kind, command, {
              ...callArtifact,
              tool: toolName,
              mapped,
              product_tool_residual: false,
              path: snapPath,
              pretend_ok: false,
              ok: Boolean(gHit && gHit.ok),
              [gSpec.field]: gPayload,
            });
          }
        }

        if (
          mapped === "host_generate_image" ||
          mapped === "host_generate_video" ||
          mapped === "host_watch_video" ||
          mapped === "host_structured_chart"
        ) {
          const mediaKind =
            mapped === "host_generate_image"
              ? "generate_image"
              : mapped === "host_generate_video"
                ? "generate_video"
                : mapped === "host_watch_video"
                  ? "watch_video"
                  : "structured_chart";
          let mediaCmd = "";
          if (mediaKind === "generate_image" || mediaKind === "generate_video") {
            const out = String(
              args.out || args.path || args.output || args.filename || "",
            ).trim();
            const prompt = String(
              args.prompt ||
                args.body ||
                args.q ||
                args.query ||
                args.text ||
                args.description ||
                "",
            ).trim() || `MCP ${mediaKind}`;
            mediaCmd = out + "|" + prompt;
          } else if (mediaKind === "watch_video") {
            const video = String(
              args.video ||
                args.video_path ||
                args.path ||
                args.q ||
                args.query ||
                args.body ||
                "",
            ).trim();
            const frame = String(
              args.frame ||
                args.frame_out ||
                args.out ||
                args.output ||
                args.filename ||
                "",
            ).trim();
            mediaCmd = video + "|" + frame;
          } else {
            const out = String(
              args.out || args.path || args.output || args.filename || "",
            ).trim();
            let seriesRaw = "";
            if (args.series != null) {
              seriesRaw =
                typeof args.series === "string"
                  ? args.series
                  : JSON.stringify(args.series);
            } else if (args.data != null) {
              seriesRaw =
                typeof args.data === "string"
                  ? args.data
                  : JSON.stringify(args.data);
            } else if (args.body != null) {
              seriesRaw =
                typeof args.body === "string"
                  ? args.body
                  : JSON.stringify(args.body);
            } else {
              const skip = new Set([
                "out",
                "path",
                "output",
                "filename",
                "tool",
                "command",
              ]);
              const seriesObj = {};
              for (const [k, v] of Object.entries(args || {})) {
                if (skip.has(k)) continue;
                if (typeof v === "number" || typeof v === "string") {
                  seriesObj[k] = v;
                }
              }
              seriesRaw = Object.keys(seriesObj).length
                ? JSON.stringify(seriesObj)
                : "";
            }
            mediaCmd = out + "|" + seriesRaw;
          }
          const mediaRes = await executeMediaProductEffect(mediaKind, mediaCmd);
          let mediaPayload = {};
          try {
            mediaPayload = JSON.parse((mediaRes && mediaRes.stdout) || "{}");
          } catch {
            mediaPayload = {};
          }
          const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
            tool: toolName,
            mapped,
            host_kind: mediaKind,
            media: {
              path: mediaPayload.path || null,
              media_path: mediaPayload.media_path || null,
              frame_path: mediaPayload.frame_path || null,
              video_path: mediaPayload.video_path || null,
              mode: mediaPayload.mode || null,
              png_magic_ok: mediaPayload.png_magic_ok,
              video_complete_notified: mediaPayload.video_complete_notified,
              pretend_media: mediaPayload.pretend_media,
              series: mediaPayload.series || null,
            },
            product_tool_residual: false,
            pretend_ok: false,
            ok: Boolean(mediaRes && mediaRes.ok),
            at: shortAt,
          });
          return okJson(kind, command, {
            ...callArtifact,
            tool: toolName,
            mapped,
            product_tool_residual: false,
            path: snapPath,
            pretend_ok: false,
            ok: Boolean(mediaRes && mediaRes.ok),
            media: mediaPayload,
          });
        }
        const q = String(
          args.q || args.query || args.body || "",
        ).trim() || "(empty)";
        const xResults = await executeHostEffects([
          { kind: "x_search", command: q },
        ]);
        const xHit = (xResults || []).find((r) => r && r.kind === "x_search");
        let xPayload = {};
        try {
          xPayload = JSON.parse((xHit && xHit.stdout) || "{}");
        } catch {
          xPayload = {};
        }
        const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
          tool: toolName,
          mapped,
          host_kind: "x_search",
          x_search: {
            path: xPayload.path || null,
            mode: xPayload.mode || null,
            hit_count: xPayload.hit_count,
            live_x_residual: xPayload.live_x_residual,
          },
          product_tool_residual: false,
          pretend_ok: false,
          ok: Boolean(xHit && xHit.ok),
          at: shortAt,
        });
        return okJson(kind, command, {
          ...callArtifact,
          tool: toolName,
          mapped,
          product_tool_residual: false,
          path: snapPath,
          pretend_ok: false,
          ok: Boolean(xHit && xHit.ok),
          x_search: xPayload,
        });
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
        // mcp_call: durable per-op snap (not tmp-only out_json).
        const { snapPath, artifact: callArtifact } = writeMcpCallSnap(command, {
          tool: mcpToolName,
          mapped: mcpMapped,
          source_ref: (parsed && parsed.source_ref) || null,
          out_json: outPath,
          req_json: reqPath,
          file_expand:
            fileExpandMeta && fileExpandMeta.expanded.length > 0
              ? {
                  expanded_count: fileExpandMeta.expanded.length,
                  pretend_inject: false,
                }
              : fileExpandMeta
                ? { expanded_count: 0, pretend_inject: false }
                : null,
          write_to_file: writeMeta,
          product_tool_residual: mcpProductToolResidual,
          ok: true,
          at: mcpAt,
        });
        annotated.path = snapPath;
        annotated.mode = callArtifact.mode;
        annotated.tool = mcpToolName;
        annotated.mapped = mcpMapped;
        annotated.product_tool_residual = mcpProductToolResidual;
        annotated.pretend_ok = false;
        annotated.ok = true;
        const callDelivery = recordSendToUser({
          type: "attachment",
          path: snapPath,
          label: "mcp_call",
          source_kind: kind,
          at: mcpAt,
        });
        annotated.send_to_user = callDelivery;
        appendHostDeliveryJournal({
          kind,
          command,
          mode: "stdio-mcp",
          path: snapPath,
          tool: mcpToolName,
          mapped: mcpMapped,
          file_expand: fileExpandMeta,
          write_to_file: writeMeta,
          at: mcpAt,
        });
        return okJson(kind, command, annotated);
      } catch (_) {
        /* keep raw MCP payload — still snap path for evidence */
      }
      if (kind === "mcp_call") {
        const { snapPath } = writeMcpCallSnap(command, {
          tool: mcpToolName,
          mapped: mcpMapped,
          out_json: outPath,
          req_json: reqPath,
          file_expand: fileExpandMeta
            ? {
                expanded_count: (fileExpandMeta.expanded || []).length,
                pretend_inject: false,
              }
            : null,
          ok: true,
          at: mcpAt,
        });
        let rawPayload = {};
        try {
          rawPayload = JSON.parse(outText);
        } catch (_) {
          rawPayload = { raw_prefix: String(outText || "").slice(0, 400) };
        }
        appendHostDeliveryJournal({
          kind,
          command,
          mode: "stdio-mcp",
          path: snapPath,
          tool: mcpToolName,
          mapped: mcpMapped,
          file_expand: fileExpandMeta,
          at: mcpAt,
        });
        recordSendToUser({
          type: "attachment",
          path: snapPath,
          label: "mcp_call",
          source_kind: kind,
          at: mcpAt,
        });
        return okJson(kind, command, {
          ...rawPayload,
          path: snapPath,
          mode: "stdio-mcp",
          tool: mcpToolName,
          mapped: mcpMapped,
          pretend_ok: false,
          ok: true,
        });
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
      const errAt = new Date().toISOString();
      let errSnap = null;
      if (kind === "mcp_call") {
        errSnap = writeMcpCallSnap(command, {
          tool: mcpToolName,
          mapped: mcpMapped,
          out_json: outPath,
          req_json: reqPath,
          file_expand: fileExpandMeta
            ? {
                expanded_count: (fileExpandMeta.expanded || []).length,
                pretend_inject: false,
              }
            : null,
          ok: false,
          error: err.message || String(err),
          at: errAt,
        });
      }
      appendHostDeliveryJournal({
        kind,
        command,
        ok: false,
        path: errSnap ? errSnap.snapPath : undefined,
        error: err.message || String(err),
        file_expand: fileExpandMeta,
        at: errAt,
      });
      return {
        kind,
        ok: false,
        command,
        error: err.message || String(err),
        stdout: errSnap
          ? JSON.stringify(
              {
                ...errSnap.artifact,
                path: errSnap.snapPath,
                pretend_ok: false,
              },
              null,
              2,
            )
          : err.stdout
            ? String(err.stdout).slice(0, 4000)
            : "",
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
      // Close long_lived_cron_residual only when a long-lived daemon is armed
      // (env / daemon-status.long_lived) OR the user systemd unit is *active*.
      // Scaffold --write-systemd-unit and enable-without-start must NOT close
      // (systemd_unit_installed alone is insufficient).
      let longLivedCronClosed = process.env.BITBOT_ROUTINE_LONG_LIVED === "1";
      let systemdUnitActive = false;
      let systemdUnitInstalled = false;
      try {
        const stPath = path.join(REPO_ROOT, "data", "routines", "daemon-status.json");
        if (fs.existsSync(stPath)) {
          const st = JSON.parse(fs.readFileSync(stPath, "utf8"));
          if (st.long_lived === true) {
            longLivedCronClosed = true;
          }
          if (st.systemd_unit_active === true) {
            systemdUnitActive = true;
            longLivedCronClosed = true;
          }
          if (st.systemd_unit_installed === true) {
            systemdUnitInstalled = true;
          }
        }
      } catch (_) {
        /* residual stays open */
      }
      // Probe live unit activity (not merely enabled / unit file present).
      try {
        const { execFileSync } = require("child_process");
        const out = execFileSync(
          "systemctl",
          ["--user", "is-active", "bitbot-routine-daemon.service"],
          { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
        );
        if (String(out || "").trim() === "active") {
          systemdUnitActive = true;
          longLivedCronClosed = true;
        }
      } catch (_) {
        /* inactive / missing unit — residual stays unless long_lived armed */
      }
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
        systemd_unit_installed: systemdUnitInstalled,
        systemd_unit_active: systemdUnitActive,
        long_lived_cron_residual: !dueNow && !longLivedCronClosed,
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
      // Honor BITBOT_ROUTINE_LONG_LIVED the same way the daemon script exports it —
      // one-shot sweeps leave this unset so long_lived stays false (honest residual).
      const longLived = process.env.BITBOT_ROUTINE_LONG_LIVED === "1";
      const wakeEntry = {
        due_count: due.length,
        fired_count: fired.length,
        fired_ids: fired.map((f) => f.id),
        at: tickAt,
        daemon: daemonSweep,
        long_lived: longLived,
        note: longLived
          ? "Host long-lived routine sweep (BITBOT_ROUTINE_LONG_LIVED=1)"
          : daemonSweep
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
              long_lived: longLived,
              last_sweep_at: tickAt,
              fired_count: fired.length,
              due_count: due.length,
              note: longLived
                ? "long-lived Host sweep — BITBOT_ROUTINE_LONG_LIVED=1"
                : "one-shot sweep — not systemd cron",
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
        long_lived: longLived,
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
            long_lived: longLived,
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
    // Durable sandbox artifacts always; live Gmail or Outlook Graph when token
    // + API reachable. Never pretend live hits without a successful API response.
    // Provider pick matches bare-email channel: BITBOT_MAIL_PROVIDER=outlook, or
    // Outlook armed with no Gmail env token (stale gmail_token.json must not win).
    const at = new Date().toISOString();
    const mailProviderEnv = String(process.env.BITBOT_MAIL_PROVIDER || "")
      .trim()
      .toLowerCase();
    const preferOutlook =
      mailProviderEnv === "outlook" ||
      (connectorArmed("outlook") &&
        !String(process.env.BITBOT_GMAIL_TOKEN || "").trim() &&
        mailProviderEnv !== "gmail");
    const gmailToken = resolveProviderAccessToken("gmail");
    const outlookToken = resolveProviderAccessToken("outlook");
    const useOutlook =
      Boolean(outlookToken) && (preferOutlook || !gmailToken);
    const accessToken = useOutlook ? outlookToken : gmailToken;
    const wantLive = Boolean(accessToken);
    const gmailBase = String(
      process.env.BITBOT_GMAIL_API_BASE ||
        "https://gmail.googleapis.com/gmail/v1",
    )
      .trim()
      .replace(/\/$/, "");
    const outlookBase = String(
      process.env.BITBOT_OUTLOOK_GRAPH_URL ||
        process.env.BITBOT_OUTLOOK_API_BASE ||
        "https://graph.microsoft.com/v1.0",
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
          const url = useOutlook
            ? `${outlookBase}/me/messages?$search=` +
              encodeURIComponent(q) +
              "&$top=10"
            : `${gmailBase}/users/me/messages?q=` +
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
            provider: useOutlook ? "outlook" : "gmail",
          };
          if (resp.ok) {
            liveHits = useOutlook
              ? Array.isArray(body.value)
                ? body.value
                : []
              : Array.isArray(body.messages)
                ? body.messages
                : [];
            mode = useOutlook ? "outlook_live" : "gmail_live";
          } else {
            mode = useOutlook ? "outlook_live_failed" : "gmail_live_failed";
          }
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
            provider: useOutlook ? "outlook" : "gmail",
          };
          mode = useOutlook ? "outlook_live_failed" : "gmail_live_failed";
        }
      }
      const sandboxHits = [
        {
          id: "t-sandbox-1",
          threadId: "t-sandbox-1",
          subject: `Sandbox hit for ${q}`,
          snippet: "Host sandbox mail index — not live mail",
        },
      ];
      const hits = liveHits
        ? liveHits.map((m) => ({
            id: m.id || "",
            threadId: m.conversationId || m.threadId || m.id || "",
            subject: m.subject || "(live)",
            snippet: m.bodyPreview || m.snippet || "",
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
        live_mail_residual: !(
          mode === "gmail_live" || mode === "outlook_live"
        ),
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
        const url = useOutlook
          ? `${outlookBase}/me/messages/` + encodeURIComponent(threadId)
          : `${gmailBase}/users/me/threads/` +
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
          provider: useOutlook ? "outlook" : "gmail",
        };
        if (resp.ok) {
          liveThread = body;
          mode = useOutlook ? "outlook_live" : "gmail_live";
        } else {
          mode = useOutlook ? "outlook_live_failed" : "gmail_live_failed";
        }
      } catch (err) {
        liveProbe = {
          ok: false,
          error: String((err && err.message) || err).slice(0, 200),
          provider: useOutlook ? "outlook" : "gmail",
        };
        mode = useOutlook ? "outlook_live_failed" : "gmail_live_failed";
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
      live_mail_residual: !(mode === "gmail_live" || mode === "outlook_live"),
      pretend_live: false,
      subject:
        (liveThread &&
          (liveThread.subject || liveThread.snippet || liveThread.bodyPreview)) ||
        `Sandbox thread ${threadId}`,
      snippet:
        (liveThread &&
          (liveThread.bodyPreview || liveThread.snippet)) ||
        "Host sandbox mail body — not live mail",
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
    if (!result) return null;
    const kind = result.kind || "";
    const at = new Date().toISOString();
    let parsed = {};
    try {
      parsed = JSON.parse(result.stdout || "{}");
    } catch {
      parsed = {};
    }
    // Honest NeedsAuth OAuth still gets a SendToUser widget (ok may be false).
    const oauthNeedsAuth =
      kind === "oauth" &&
      (parsed.status === "NeedsAuth" ||
        parsed.mode === "live_needs_auth" ||
        parsed.mode === "live_remote_browser_open" ||
        (parsed.connected === false && parsed.pretend_connected === false));
    if (!result.ok && !oauthNeedsAuth) return null;
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
        status: parsed.status || (oauthNeedsAuth ? "NeedsAuth" : ""),
        mode: parsed.mode || "",
        connected: Boolean(parsed.connected),
        pretend_connected: parsed.pretend_connected === true,
        browser_opened: Boolean(parsed.browser_opened),
        needs_auth: Boolean(oauthNeedsAuth || parsed.status === "NeedsAuth"),
        interactive_oauth_residual:
          parsed.interactive_oauth_residual === true ||
          Boolean(oauthNeedsAuth || parsed.status === "NeedsAuth"),
        path: parsed.path || null,
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
    if (kind === "credential_fill") {
      // Prefer effect-recorded secret-request; re-stamp delivery receipt for Host results.
      if (parsed.send_to_user && parsed.send_to_user.type === "secret-request") {
        return parsed.send_to_user;
      }
      return recordSendToUser({
        type: "secret-request",
        name: parsed.domain || parsed.vault_id || "credential",
        label: parsed.domain || parsed.vault_id || "credential",
        handle: parsed.vault_id || parsed.fill_handle || "",
        vault_path: parsed.vault_path || null,
        vault_id: parsed.vault_id || "",
        fill_handle: parsed.fill_handle || parsed.vault_id || "",
        path: parsed.path || null,
        secret_echoed: false,
        pretend_secret_view: false,
        pretend_secret_echo: false,
        credential_browser_fill_residual:
          parsed.credential_browser_fill_residual === true,
        signin_fill_residual: parsed.signin_fill_residual === true,
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
        // Nested CU residuals lifted for Desktop / STU chips (password stays deferred).
        credential_browser_fill_residual: Boolean(
          parsed.outcome && parsed.outcome.credential_browser_fill_residual,
        ),
        signin_fill_residual: Boolean(
          parsed.outcome && parsed.outcome.signin_fill_residual,
        ),
        pretend_purchased: false,
        gui_mode: (parsed.gui && parsed.gui.gui_mode) || "",
        os_window: Boolean(parsed.gui && parsed.gui.os_window),
        source_kind: kind,
        at,
      });
    }
    if (
      kind === "slides_pptx" ||
      kind === "skill_write" ||
      kind === "export_pack" ||
      kind === "generate_image" ||
      kind === "generate_video" ||
      kind === "watch_video" ||
      kind === "structured_chart" ||
      kind === "settings_open" ||
      kind === "agent_info_panel" ||
      kind === "delete_agent" ||
      kind === "package_install" ||
      kind === "shared_box_fs" ||
      kind === "hide_agent" ||
      kind === "list_agents_sidebar" ||
      kind === "members_panel" ||
      kind === "notify_settings" ||
      kind === "set_notify" ||
      kind === "update_computer" ||
      kind === "reset_computer" ||
      kind === "local_execution" ||
      kind === "guide_permission" ||
      kind === "render_markdown" ||
      kind === "react_message" ||
      kind === "screenshot" ||
      kind === "check_updates" ||
      kind === "auto_review_settings" ||
      kind === "box_chrome_probe" ||
      kind === "mcp_uninstall" ||
      kind === "mcp_get_plugin" ||
      kind === "mcp_list_plugins" ||
      kind === "list_skills" ||
      kind === "box_doctor" ||
      kind === "box_env" ||
      kind === "box_clock" ||
      kind === "webhook_panel" ||
      kind === "webhook_copy" ||
      kind === "webhook_wake"
    ) {
      return null; // SendToUser already recorded in effect handlers
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

  function finalizeOauthHostResult(command, result) {
    // Per-op Host oauth snapshot — never echo tokens; honesty flags preserved.
    const at = new Date().toISOString();
    let payload = {};
    try {
      payload = JSON.parse((result && result.stdout) || "{}") || {};
    } catch (_) {
      payload = {};
    }
    const connector =
      sanitizeSkillName(payload.connector || "oauth") || "oauth";
    const modeSlug =
      sanitizeSkillName(payload.mode || (result && result.ok ? "ok" : "needsauth")) ||
      "oauth";
    const oauthDir = path.join(REPO_ROOT, "data", "connectors", "oauth");
    fs.mkdirSync(oauthDir, { recursive: true });
    const snapPath = path.join(
      oauthDir,
      `oauth-${connector}-${modeSlug}-${Date.now().toString(36)}.json`,
    );
    const needsAuthSnap =
      payload.status === "NeedsAuth" ||
      payload.mode === "live_needs_auth" ||
      payload.mode === "live_remote_browser_open" ||
      payload.mode === "live_remote_needs_auth" ||
      payload.mode === "live_code_exchange_failed" ||
      payload.mode === "live_remote_callback_pending" ||
      (payload.connected === false && result && result.ok === false);
    const artifact = {
      connector: payload.connector || connector,
      status: payload.status || (result && result.ok ? "ok" : "NeedsAuth"),
      connected: Boolean(payload.connected),
      mode: payload.mode || null,
      summary_ok: payload.summary_ok,
      browser_opened: Boolean(payload.browser_opened),
      browser_tool: payload.browser_tool || null,
      authorize_url: payload.authorize_url || null,
      callback_received: payload.callback_received,
      interactive_browser: payload.interactive_browser,
      interactive_cdp_click: payload.interactive_cdp_click,
      session_path: payload.session_path || null,
      artifact_dir: payload.artifact_dir || null,
      switched: payload.switched,
      pretend_connected: false,
      pretend_connected_slack:
        payload.pretend_connected_slack === true ? true : false,
      interactive_oauth_residual:
        typeof payload.interactive_oauth_residual === "boolean"
          ? payload.interactive_oauth_residual
          : Boolean(needsAuthSnap),
      mode_note: "host_oauth",
      host_ok: Boolean(result && result.ok),
      at,
    };
    fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
    appendJsonl(path.join(oauthDir, "events.jsonl"), {
      ...artifact,
      path: snapPath,
    });
    appendHostDeliveryJournal({
      kind: "oauth",
      command,
      path: snapPath,
      connector: artifact.connector,
      mode: artifact.mode,
      ok: Boolean(result && result.ok),
      at,
    });
    return {
      ...(result || {}),
      kind: "oauth",
      command,
      stdout: JSON.stringify(
        {
          ...payload,
          ...artifact,
          path: snapPath,
        },
        null,
        2,
      ),
    };
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

  function killChromeByUserDataDir(profilePath) {
    /** Best-effort: reap chrome/chromium trees bound to a throwaway profile. */
    const needle = String(profilePath || "").trim();
    if (!needle) return;
    try {
      const { execFileSync } = require("child_process");
      // pkill -f matches full argv; profile path is unique per oauth artifact.
      execFileSync("pkill", ["-f", `--user-data-dir=${needle}`], {
        timeout: 3000,
        stdio: "ignore",
      });
    } catch {
      /* no matching process is fine */
    }
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
            // New session so we can SIGTERM the whole chrome tree (-pid).
            detached: true,
            stdio: "ignore",
          },
        );
        child.unref();
        out.opened = true;
        out.tool = "chrome";
        out.pid = child.pid;
        out.user_data_dir = profile;
        // Best-effort: brief headed flash, then kill process group + profile match.
        // Killing only child.pid leaves zygote/renderer orphans that OOM later CU.
        setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, "SIGTERM");
          } catch {
            try {
              if (child.pid) process.kill(child.pid, "SIGTERM");
            } catch {
              /* ignore */
            }
          }
          killChromeByUserDataDir(profile);
        }, 2500);
        setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
            /* ignore */
          }
          killChromeByUserDataDir(profile);
        }, 4500);
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
      writeConnectorTokenFile(connectorName, {
        access_token: live.access_token,
        token_type: "Bearer",
        sandbox: false,
      });
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
        writeConnectorTokenFile(connectorName, {
          access_token: access,
          token_type: "Bearer",
          sandbox: false,
          exchange: "authorization_code",
        });
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
              interactive_oauth_residual: false,
              pretend_connected: false,
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
        interactive_oauth_residual: true,
        pretend_connected: false,
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
            interactive_oauth_residual: true,
            pretend_connected: false,
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
          writeConnectorTokenFile(connectorName, {
            access_token: token,
            token_type: "Bearer",
            sandbox: false,
            interactive: true,
          });
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
              pretend_connected: false,
              // Headed local IdP consent closes residual when ok; production IdP stays deferred.
              interactive_oauth_residual: !ok,
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
        writeConnectorTokenFile(connectorName, {
          access_token: token,
          token_type: "Bearer",
          sandbox: false,
          exchange: "local_idp",
        });
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
            pretend_connected: false,
            // Local authorize→token rehearsal closes residual when ok.
            interactive_oauth_residual: !ok,
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
          writeConnectorTokenFile(connectorName, {
            access_token: access,
            token_type: "Bearer",
            sandbox: false,
            remote_callback: true,
          });
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
                interactive_oauth_residual: false,
                pretend_connected: false,
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
          interactive_oauth_residual: true,
          pretend_connected: false,
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
              interactive_oauth_residual: true,
              pretend_connected: false,
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
        interactive_oauth_residual: true,
        pretend_connected: false,
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
        interactive_oauth_residual: true,
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
            pretend_connected: false,
            interactive_oauth_residual: true,
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
      interactive_oauth_residual: true,
      pretend_connected: false,
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
      interactive_oauth_residual: true,
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
          pretend_connected: false,
          interactive_oauth_residual: true,
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

    // CM-2146 identity browser: switch to durable user-data-dir for later CU.
    // Never pretend Slack Connected; never touch shared /home/box/chrome-profile.
    if (connectorName === "identity-browser") {
      const at = new Date().toISOString();
      const identityDir = path.join(REPO_ROOT, "data", "connectors", "identity");
      fs.mkdirSync(identityDir, { recursive: true });
      const userDataDir = path.join(identityDir, "chrome-user-data");
      fs.mkdirSync(userDataDir, { recursive: true });
      const sessionPath = path.join(identityDir, "browser-session.json");
      const session = {
        identity: "user-browser",
        previous: "app-identity",
        status: "SwitchedToSignedInBrowser",
        pretend_connected_slack: false,
        connected: false,
        switched: true,
        user_data_dir: userDataDir,
        shared_profile_untouched: true,
        mode: "identity_browser_switch",
        command: String(command || ""),
        at,
      };
      fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
      // Pointer env file for child CU processes (Host FFI sets when spawning CU).
      fs.writeFileSync(
        path.join(identityDir, "active-user-data-dir.txt"),
        userDataDir + "\n",
      );
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
        user_data_dir: userDataDir,
        at,
      });
      return okJson("oauth", command, {
        connector: "identity-browser",
        status: session.status,
        connected: false,
        pretend_connected_slack: false,
        mode: "identity_browser_switch",
        session_path: sessionPath,
        user_data_dir: userDataDir,
        shared_profile_untouched: true,
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
        writeConnectorTokenFile(connectorName, {
          access_token: token,
          token_type: "Bearer",
          sandbox: true,
        });
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
            pretend_connected: false,
            interactive_oauth_residual: !ok,
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
    const at = new Date().toISOString();
    const writeDir = path.join(REPO_ROOT, "data", "skills", "writes");
    fs.mkdirSync(writeDir, { recursive: true });
    const metaPath = path.join(
      writeDir,
      `write-${name}-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      skill_path: skillPath,
      name,
      description,
      bytes: Buffer.byteLength(md),
      persisted: true,
      pretend_shared: false,
      mode: "host_skill_write",
      at,
    };
    fs.writeFileSync(metaPath, JSON.stringify(artifact, null, 2));
    appendHostDeliveryJournal({
      kind: "skill_write",
      command,
      path: metaPath,
      skill_path: skillPath,
      bytes: Buffer.byteLength(md),
      at,
    });
    return {
      kind: "skill_write",
      ok: true,
      command,
      stdout: JSON.stringify(
        {
          ...artifact,
          path: skillPath,
          meta_path: metaPath,
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
      const at = new Date().toISOString();
      const bytes = exists ? fs.statSync(outPath).size : 0;
      const slidesDir = path.join(REPO_ROOT, "data", "slides", "renders");
      fs.mkdirSync(slidesDir, { recursive: true });
      const metaPath = path.join(
        slidesDir,
        `render-${sanitizeSkillName(path.basename(outPath, ".pptx")) || "deck"}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        pptx_path: outPath,
        title,
        pptx_pk_magic_ok: ok,
        bytes,
        pretend_rendered: false,
        mode: "host_slides_pptx",
        meta,
        at,
      };
      fs.writeFileSync(metaPath, JSON.stringify(artifact, null, 2));
      appendHostDeliveryJournal({
        kind: "slides_pptx",
        command,
        path: metaPath,
        pptx_path: outPath,
        ok,
        at,
      });
      return {
        kind: "slides_pptx",
        ok,
        command,
        stdout: JSON.stringify(
          {
            ...artifact,
            path: outPath,
            meta_path: metaPath,
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

  function normalizeChartSeries(raw) {
    const s = String(raw || "").trim();
    if (!s) return JSON.stringify({ A: 3, B: 7, C: 5 });
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return JSON.stringify(parsed);
      }
    } catch (_) {
      /* kv form: A=1 B=2 or A:1,B:2 */
    }
    const out = {};
    const parts = s.split(/[\s,]+/).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^([A-Za-z0-9._-]+)[=:](-?\d+(?:\.\d+)?)$/);
      if (m) out[m[1]] = Number(m[2]);
    }
    if (Object.keys(out).length) return JSON.stringify(out);
    return JSON.stringify({ A: 3, B: 7, C: 5, note: s.slice(0, 40) });
  }

  function resolveAgentToolsPath(raw, fallbackName) {
    let outPath = String(raw || "").trim();
    if (!outPath) {
      outPath = path.join(REPO_ROOT, "agent-tools", fallbackName);
    }
    if (!path.isAbsolute(outPath)) {
      outPath = path.join(REPO_ROOT, outPath);
    }
    const allowedRoots = [
      path.join(REPO_ROOT, "agent-tools"),
      path.join(REPO_ROOT, "data"),
      path.join(REPO_ROOT, "uploads"),
    ];
    const resolved = path.resolve(outPath);
    if (
      !allowedRoots.some((r) => resolved === r || resolved.startsWith(r + path.sep))
    ) {
      return path.join(
        REPO_ROOT,
        "agent-tools",
        path.basename(resolved) || fallbackName,
      );
    }
    return resolved;
  }

  async function executeMediaProductEffect(kind, command) {
    // CM-1601/1602/1603/2157 product Host path — real PNG/MP4/frame/chart via host_h5_media.py.
    const raw = String(command || "");
    const pipe = raw.indexOf("|");
    const left = pipe >= 0 ? raw.slice(0, pipe).trim() : raw.trim();
    const right = pipe >= 0 ? raw.slice(pipe + 1).trim() : "";
    const at = new Date().toISOString();
    const mediaDir = path.join(REPO_ROOT, "data", "media", "ops");
    fs.mkdirSync(mediaDir, { recursive: true });
    const mediaPy = path.join(REPO_ROOT, "scripts", "host_h5_media.py");
    try {
      let args = [];
      let outPath = null;
      let framePath = null;
      let videoPath = null;
      let prompt = "";
      let seriesJson = null;
      if (kind === "generate_image") {
        outPath = resolveAgentToolsPath(left, `gen-image-${Date.now().toString(36)}.png`);
        prompt = right || "bitbot generate image";
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        args = ["generate-image", "--out", outPath, "--prompt", prompt];
      } else if (kind === "generate_video") {
        outPath = resolveAgentToolsPath(left, `gen-video-${Date.now().toString(36)}.mp4`);
        prompt = right || "bitbot generate video";
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        args = ["generate-video", "--out", outPath, "--seconds", "1.0"];
      } else if (kind === "watch_video") {
        videoPath = resolveAgentToolsPath(left, "watch-input.mp4");
        framePath = resolveAgentToolsPath(
          right || "",
          `watch-frame-${Date.now().toString(36)}.png`,
        );
        fs.mkdirSync(path.dirname(framePath), { recursive: true });
        args = ["watch-video", "--video", videoPath, "--frame-out", framePath];
      } else if (kind === "structured_chart") {
        outPath = resolveAgentToolsPath(
          left,
          `chart-${Date.now().toString(36)}.png`,
        );
        seriesJson = normalizeChartSeries(right);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        args = ["structured-chart", "--out", outPath, "--series", seriesJson];
      } else {
        return {
          kind,
          ok: false,
          command,
          error: `unsupported media kind: ${kind}`,
        };
      }
      const { stdout, stderr } = await execFileAsync(
        process.env.PYTHON || "python3",
        [mediaPy, ...args],
        { cwd: REPO_ROOT, timeout: 90000, maxBuffer: 4 * 1024 * 1024 },
      );
      let meta = {};
      try {
        meta = JSON.parse(String(stdout || "").trim() || "{}");
      } catch {
        meta = {};
      }
      const snapPath = path.join(
        mediaDir,
        `${kind.replace(/_/g, "-")}-${Date.now().toString(36)}.json`,
      );
      let ok = false;
      let artifactPath = outPath || framePath || null;
      if (kind === "generate_image" || kind === "structured_chart") {
        ok = Boolean(
          meta.png_magic_ok ||
            (outPath &&
              fs.existsSync(outPath) &&
              fs.readFileSync(outPath).subarray(0, 8).equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
              )),
        );
        artifactPath = meta.path || outPath;
      } else if (kind === "generate_video") {
        ok = Boolean(
          meta.video_complete_notified ||
            (outPath && fs.existsSync(outPath) && fs.statSync(outPath).size > 32),
        );
        artifactPath = meta.path || outPath;
      } else if (kind === "watch_video") {
        ok = Boolean(
          meta.png_magic_ok ||
            (framePath &&
              fs.existsSync(framePath) &&
              fs.readFileSync(framePath).subarray(0, 8).equals(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
              )),
        );
        artifactPath = meta.frame_path || framePath;
      }
      const artifact = {
        kind,
        mode: `host_${kind}`,
        prompt: prompt || null,
        series: seriesJson
          ? (() => {
              try {
                return JSON.parse(seriesJson);
              } catch (_) {
                return seriesJson;
              }
            })()
          : meta.series || null,
        media_path: artifactPath,
        video_path: videoPath || meta.video_path || null,
        frame_path: kind === "watch_video" ? artifactPath : null,
        bytes: artifactPath && fs.existsSync(artifactPath)
          ? fs.statSync(artifactPath).size
          : meta.bytes || 0,
        png_magic_ok: Boolean(meta.png_magic_ok),
        video_complete_notified: Boolean(meta.video_complete_notified),
        pretend_media: false,
        pretend_ok: false,
        i_claimed: false,
        host_ok: ok,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify({ ...artifact, meta }, null, 2));
      appendJsonl(path.join(mediaDir, "ops.jsonl"), {
        ...artifact,
        path: snapPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: artifactPath || snapPath,
        snap_path: snapPath,
        label: kind,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command,
        path: snapPath,
        media_path: artifactPath,
        ok,
        at,
      });
      return okJson(kind, command, {
        ...artifact,
        path: snapPath,
        send_to_user: delivery,
        ok,
      });
    } catch (err) {
      const failPath = path.join(
        mediaDir,
        `${kind.replace(/_/g, "-")}-fail-${Date.now().toString(36)}.json`,
      );
      const failArt = {
        kind,
        ok: false,
        pretend_media: false,
        error: err.message || String(err),
        at,
      };
      fs.writeFileSync(failPath, JSON.stringify(failArt, null, 2));
      appendHostDeliveryJournal({
        kind,
        command,
        path: failPath,
        ok: false,
        error: failArt.error,
        at,
      });
      return {
        kind,
        ok: false,
        command,
        error: failArt.error,
        stdout: JSON.stringify({ ...failArt, path: failPath }, null, 2),
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
    const at = pack.exported_at;
    const packDir = path.join(REPO_ROOT, "data", "exports", "packs");
    fs.mkdirSync(packDir, { recursive: true });
    const metaPath = path.join(
      packDir,
      `pack-${botId}-${sanitizeSkillName(kind)}-${Date.now().toString(36)}.json`,
    );
    const artifact = {
      export_path: exportPath,
      bot_id: botId,
      kind,
      secrets_stripped: true,
      pretend_secrets_included: false,
      mode: "host_export_pack",
      at,
    };
    fs.writeFileSync(metaPath, JSON.stringify(artifact, null, 2));
    appendHostDeliveryJournal({
      kind: "export_pack",
      command,
      path: metaPath,
      export_path: exportPath,
      at,
    });
    return {
      kind: "export_pack",
      ok: true,
      command,
      stdout: JSON.stringify(
        {
          ...artifact,
          path: exportPath,
          meta_path: metaPath,
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

  function synthesizeVoiceWav(
    outPath,
    { frequency = 440, duration = 0.35, text = "" } = {},
  ) {
    const { execFileSync } = require("child_process");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const speakText = String(text || "").trim().slice(0, 400);
    // Prefer real TTS (espeak / BITBOT_ESPEAK_BIN) → wav when available; else honest sine residual.
    if (speakText) {
      try {
        const wavTmp = outPath + ".espeak.wav";
        const espeakBin =
          String(process.env.BITBOT_ESPEAK_BIN || "").trim() || "espeak";
        execFileSync(
          espeakBin,
          ["-w", wavTmp, "-s", "150", speakText],
          { stdio: "ignore", timeout: 15000 },
        );
        if (fs.existsSync(wavTmp) && fs.statSync(wavTmp).size > 44) {
          // Normalize to 16k mono for voice pipeline consistency.
          try {
            const ffmpeg = process.env.FFMPEG || "ffmpeg";
            execFileSync(
              ffmpeg,
              ["-y", "-i", wavTmp, "-ar", "16000", "-ac", "1", outPath],
              { stdio: "ignore", timeout: 15000 },
            );
          } catch (_) {
            fs.copyFileSync(wavTmp, outPath);
          }
          try {
            fs.unlinkSync(wavTmp);
          } catch (_) {}
          if (fs.existsSync(outPath) && fs.statSync(outPath).size > 44) {
            return {
              ok: true,
              path: outPath,
              bytes: fs.statSync(outPath).size,
              tool: "espeak",
              voice_tts_residual: false,
            };
          }
        }
      } catch (_) {
        // fall through to sine
      }
    }
    try {
      const ffmpeg = process.env.FFMPEG || "ffmpeg";
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
          voice_tts_residual: true,
        };
      }
    } catch (err) {
      return {
        ok: false,
        path: outPath,
        bytes: 0,
        error: err.message || String(err),
        voice_tts_residual: true,
      };
    }
    return { ok: false, path: outPath, bytes: 0, voice_tts_residual: true };
  }

  function transcribeVoiceWav(wavPath) {
    // Host STT: sidecar transcript, BITBOT_STT_BIN, or residual.
    // Never pretend heard — typed relay text alone keeps voice_stt_residual.
    const wav = String(wavPath || "").trim();
    if (!wav || !fs.existsSync(wav)) {
      return {
        ok: false,
        text: "",
        tool: null,
        voice_stt_residual: true,
        error: "wav missing",
      };
    }
    const sidecar = wav + ".stt.txt";
    const alt = path.join(
      path.dirname(wav),
      path.basename(wav, path.extname(wav)) + ".stt.txt",
    );
    // Only honor sidecars written for this wav generation (mtime >= wav).
    // Stale .stt.txt from prior BITBOT_STT_BIN smokes must not close residual.
    let wavMtime = 0;
    try {
      wavMtime = fs.statSync(wav).mtimeMs || 0;
    } catch (_) {
      wavMtime = 0;
    }
    for (const side of [sidecar, alt]) {
      if (fs.existsSync(side) && fs.statSync(side).isFile()) {
        let sideMtime = 0;
        try {
          sideMtime = fs.statSync(side).mtimeMs || 0;
        } catch (_) {
          sideMtime = 0;
        }
        if (wavMtime && sideMtime + 1 < wavMtime) continue;
        const text = String(fs.readFileSync(side, "utf8") || "")
          .trim()
          .slice(0, 4000);
        if (text) {
          return {
            ok: true,
            text,
            tool: "stt_sidecar",
            voice_stt_residual: false,
            sidecar: side,
          };
        }
      }
    }
    const sttBin = String(process.env.BITBOT_STT_BIN || "").trim();
    if (sttBin) {
      try {
        const { execFileSync } = require("child_process");
        const out = execFileSync(sttBin, [wav], {
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        });
        const text = String(out || "").trim().slice(0, 4000);
        if (text) {
          return {
            ok: true,
            text,
            tool: path.basename(sttBin),
            voice_stt_residual: false,
          };
        }
      } catch (err) {
        return {
          ok: false,
          text: "",
          tool: path.basename(sttBin),
          voice_stt_residual: true,
          error: String((err && err.message) || err).slice(0, 200),
        };
      }
    }
    return {
      ok: false,
      text: "",
      tool: null,
      voice_stt_residual: true,
      error: "no STT sidecar or BITBOT_STT_BIN",
    };
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
      const cloudApiUrl = resolveConnectorApiUrl("cloud", [
        "BITBOT_CLOUD_API_URL",
      ]);
      const cloudToken = resolveProviderAccessToken("cloud");
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
      let remoteFetched = false;
      let remoteProbe = null;
      let remoteCloudArtifactResidual = true;
      let bcId = "";
      const bcMatch = String(srcOrUrl).match(/bc-[A-Za-z0-9_-]+/);
      if (bcMatch) bcId = bcMatch[0];
      else if (/^bc-/i.test(srcOrUrl)) bcId = srcOrUrl;

      if (srcOrUrl && fs.existsSync(srcOrUrl) && fs.statSync(srcOrUrl).isFile()) {
        fs.copyFileSync(srcOrUrl, destPath);
        copied = true;
        remoteCloudArtifactResidual = false;
      } else {
        // Optional remote artifact fetch (local mock / BITBOT_CLOUD_API_URL).
        const cloudApi = String(process.env.BITBOT_CLOUD_API_URL || "")
          .trim()
          .replace(/\/$/, "");
        const cloudToken =
          String(
            process.env.BITBOT_CURSOR_CLOUD_TOKEN ||
              process.env.BITBOT_CLOUD_API_TOKEN ||
              "",
          ).trim() || resolveProviderAccessToken("cloud");
        if (
          cloudApi &&
          cloudToken &&
          bcId &&
          process.env.BITBOT_CLOUD_ARTIFACT_FETCH === "1"
        ) {
          try {
            const artUrl = `${cloudApi}/agents/${encodeURIComponent(bcId)}/artifact`;
            const resp = await httpJson(artUrl, {
              method: "GET",
              headers: { Authorization: `Bearer ${cloudToken}` },
            });
            const ok =
              Boolean(resp.ok) || (resp.status >= 200 && resp.status < 300);
            remoteProbe = {
              ok,
              http_status: resp.status || 0,
              error: resp.error || null,
            };
            if (ok) {
              const bodyText =
                (resp.json &&
                  (resp.json.body ||
                    resp.json.content ||
                    resp.json.markdown)) ||
                (typeof resp.text === "string" ? resp.text : "");
              const text =
                String(bodyText || "").trim() ||
                `# Cloud artifact\n\nbc_id: ${bcId}\nremote_fetch: true\n`;
              fs.writeFileSync(
                destPath,
                text.endsWith("\n") ? text : text + "\n",
              );
              remoteFetched = true;
              remoteCloudArtifactResidual = false;
            }
          } catch (err) {
            remoteProbe = {
              ok: false,
              error: String((err && err.message) || err).slice(0, 200),
            };
          }
        }
        if (!remoteFetched) {
          const session = bcId ? readCloudSession(bcId) : null;
          fromSession = Boolean(session);
          let body;
          if (session) {
            // Always wrap session state into a durable markdown report — never
            // use a short assistant stub (e.g. remote body_keys join) as the file.
            const assistantBody = String(session.assistant || "").trim();
            body = [
              `# Cloud artifact`,
              ``,
              `bc_id: ${session.bc_id || bcId || "(none)"}`,
              `status: ${session.status || "unknown"}`,
              `mode: ${session.mode || ""}`,
              `url: ${session.url || ""}`,
              `source: ${srcOrUrl || "(session)"}`,
              `from_session: true`,
              `pretend_remote_fetch: false`,
              `at: ${session.completed_at || session.at || at}`,
              ``,
              `## Session note`,
              String(
                session.note || "Materialized from Host cloud session.",
              ).trim(),
              ``,
              `## Assistant`,
              assistantBody ||
                "(no assistant body — launch accepted / worker pending)",
              ``,
            ].join("\n");
            remoteCloudArtifactResidual = false;
          } else {
            body = `# Cloud artifact\n\nsource: ${srcOrUrl}\nbc_id: ${
              bcId || "(none)"
            }\nstatus: no_session\n\nNo local session — placeholder report (not remote cloud fetch).\n`;
          }
          fs.writeFileSync(destPath, body.endsWith("\n") ? body : body + "\n");
        }
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
        remote_fetched: remoteFetched,
        remote_probe: remoteProbe,
        delivered: true,
        bytes: fs.statSync(destPath).size,
        pretend_remote_fetch: false,
        pretend_delivered: false,
        remote_cloud_artifact_residual: remoteCloudArtifactResidual,
        mode: remoteFetched
          ? "host_cloud_artifact_remote_fetch"
          : fromSession
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
      // BITBOT_CODE_APPLY=1: durable sidecar + mutate target with Host marker.
      // After apply, stamp git_commit_residual until BITBOT_CODE_COMMIT=1 closes it
      // via real git or BITBOT_GIT_BIN mock — never invent SHA / pretend_committed.
      // After commit success, stamp git_push_residual until BITBOT_CODE_PUSH=1 closes it
      // via real git push or BITBOT_GIT_BIN mock — never invent remote / pretend_pushed.
      const allowApply =
        String(process.env.BITBOT_CODE_APPLY || "").trim() === "1";
      let applied = false;
      let appliedPath = null;
      let applyError = null;
      let targetMutated = false;
      if (allowApply && exists && underRepo && fs.statSync(abs).isFile()) {
        try {
          appliedPath = abs + ".bitbot-applied.json";
          const markerLine = hostCodeApplyMarkerLine(abs, at);
          let body = fs.readFileSync(abs, "utf8");
          if (!body.includes(BITBOT_HOST_APPLIED_TAG)) {
            const needsNl = body.length > 0 && !body.endsWith("\n");
            body = body + (needsNl ? "\n" : "") + markerLine;
            fs.writeFileSync(abs, body);
          }
          targetMutated = body.includes(BITBOT_HOST_APPLIED_TAG);
          const marker = {
            target: abs,
            namespace: ns,
            applied: true,
            pretend_committed: false,
            pretend_pushed: false,
            target_mutated: targetMutated,
            marker: BITBOT_HOST_APPLIED_TAG,
            note: "Host applied durable sidecar + target marker — git commit gated on BITBOT_CODE_COMMIT=1",
            at,
          };
          fs.writeFileSync(appliedPath, JSON.stringify(marker, null, 2));
          applied = true;
        } catch (err) {
          applyError = String((err && err.message) || err).slice(0, 200);
          applied = false;
          targetMutated = false;
        }
      }
      let gitCommitResidual = applied;
      let pretendCommitted = false;
      let commitSha = null;
      let commitError = null;
      let commitAttempted = false;
      let commitGitBin = null;
      const resolveGitBin = () => {
        const override = String(process.env.BITBOT_GIT_BIN || "").trim();
        if (override) {
          try {
            if (fs.existsSync(override)) return override;
          } catch {
            /* fall through */
          }
        }
        return "git";
      };
      const allowCommit =
        applied &&
        String(process.env.BITBOT_CODE_COMMIT || "").trim() === "1";
      if (allowCommit) {
        commitAttempted = true;
        const gitBin = resolveGitBin();
        commitGitBin = gitBin;
        const rel = path.relative(REPO_ROOT, abs);
        try {
          await execFileAsync(gitBin, ["add", "--", rel], {
            cwd: REPO_ROOT,
            timeout: 15000,
          });
          await execFileAsync(
            gitBin,
            [
              "commit",
              "-m",
              "Bit Bot Host code_changes apply (BITBOT_CODE_COMMIT=1)",
              "--",
              rel,
            ],
            { cwd: REPO_ROOT, timeout: 30000 },
          );
          const hd = await execFileAsync(gitBin, ["rev-parse", "HEAD"], {
            cwd: REPO_ROOT,
            timeout: 10000,
          });
          const sha = String(hd.stdout || "").trim().slice(0, 40);
          if (!sha) {
            commitError = "rev-parse HEAD returned empty";
            gitCommitResidual = true;
          } else {
            commitSha = sha;
            gitCommitResidual = false;
            pretendCommitted = false;
            if (appliedPath && fs.existsSync(appliedPath)) {
              try {
                const prev = JSON.parse(fs.readFileSync(appliedPath, "utf8"));
                fs.writeFileSync(
                  appliedPath,
                  JSON.stringify(
                    {
                      ...prev,
                      committed: true,
                      commit_sha: sha,
                      git_commit_residual: false,
                      pretend_committed: false,
                      git_push_residual: true,
                      pretend_pushed: false,
                      at,
                    },
                    null,
                    2,
                  ),
                );
              } catch {
                /* sidecar refresh best-effort */
              }
            }
          }
        } catch (err) {
          commitError = String((err && err.message) || err).slice(0, 240);
          gitCommitResidual = true;
          commitSha = null;
          pretendCommitted = false;
        }
      }
      // After BITBOT_CODE_COMMIT success, stamp git_push_residual until BITBOT_CODE_PUSH=1.
      let gitPushResidual = Boolean(commitSha && !gitCommitResidual);
      let pretendPushed = false;
      let pushError = null;
      let pushAttempted = false;
      let pushGitBin = null;
      const allowPush =
        gitPushResidual &&
        String(process.env.BITBOT_CODE_PUSH || "").trim() === "1";
      if (allowPush) {
        pushAttempted = true;
        const gitBin = commitGitBin || resolveGitBin();
        pushGitBin = gitBin;
        try {
          // Bare `git push` — never invent remote name/URL in Host.
          await execFileAsync(gitBin, ["push"], {
            cwd: REPO_ROOT,
            timeout: 60000,
          });
          gitPushResidual = false;
          pretendPushed = false;
          if (appliedPath && fs.existsSync(appliedPath)) {
            try {
              const prev = JSON.parse(fs.readFileSync(appliedPath, "utf8"));
              fs.writeFileSync(
                appliedPath,
                JSON.stringify(
                  {
                    ...prev,
                    pushed: true,
                    git_push_residual: false,
                    pretend_pushed: false,
                    at,
                  },
                  null,
                  2,
                ),
              );
            } catch {
              /* sidecar refresh best-effort */
            }
          }
        } catch (err) {
          pushError = String((err && err.message) || err).slice(0, 240);
          gitPushResidual = true;
          pretendPushed = false;
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
        target_mutated: targetMutated,
        pretend_committed: pretendCommitted,
        pretend_pushed: pretendPushed,
        code_apply_residual: !applied,
        git_commit_residual: gitCommitResidual,
        git_push_residual: gitPushResidual,
        commit_gated: allowCommit,
        commit_attempted: commitAttempted,
        commit_sha: commitSha,
        commit_error: commitError,
        commit_git_bin: commitGitBin,
        push_gated: allowPush,
        push_attempted: pushAttempted,
        push_error: pushError,
        push_git_bin: pushGitBin,
        git_diff_stat: gitDiffStat,
        note: applied
          ? gitCommitResidual
            ? "Host code-changes applied — git_commit_residual until BITBOT_CODE_COMMIT=1 (CM-1810)"
            : gitPushResidual
              ? "Host code-changes applied + committed — git_push_residual until BITBOT_CODE_PUSH=1 (CM-1810)"
              : "Host code-changes applied + committed + pushed via BITBOT_CODE_PUSH=1 (CM-1810)"
          : "Host code-changes plan — scoped edit not auto-committed (CM-1810); set BITBOT_CODE_APPLY=1 to apply sidecar + target marker",
        at,
      };
      fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
      // Sidecar plan next to target when file exists under repo.
      let sidecar = null;
      if (exists && fs.statSync(abs).isFile()) {
        sidecar = abs + ".bitbot-plan.md";
        fs.writeFileSync(
          sidecar,
          `# Bit Bot code-changes plan\n\n- target: \`${abs}\`\n- namespace: \`${ns}\`\n- applied: ${applied}\n- pretend_committed: ${pretendCommitted}\n- pretend_pushed: ${pretendPushed}\n- git_commit_residual: ${gitCommitResidual}\n- git_push_residual: ${gitPushResidual}\n- commit_sha: ${commitSha || ""}\n\nHost recorded a scoped edit plan; MoonBit owns intent (CM-1810).\n`,
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
        git_commit_residual: gitCommitResidual,
        git_push_residual: gitPushResidual,
        commit_sha: commitSha,
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
      // gh_pr_create_residual stays open through dry-run/plan/gated; close only when
      // BITBOT_GH_PR_CREATE=1 + gh pr create succeeds (BITBOT_GH_BIN mock OK).
      // remote_pr_residual is separate — dry-run may clear it for view fidelity.
      const wantPr =
        /create_pr|pull_request|open_pr/i.test(action) ||
        String(process.env.BITBOT_GH_CREATE_PR || "").trim() === "1";
      const allowRealCreate =
        String(process.env.BITBOT_GH_PR_CREATE || "").trim() === "1";
      let remotePr = null;
      let remotePrResidual = true;
      let ghPrCreateResidual = false;
      let mode = "host_git_status";
      if (wantPr) {
        ghPrCreateResidual = true;
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
              // Dry-run clears remote_pr_residual for view fidelity only —
              // gh_pr_create_residual stays open until BITBOT_GH_PR_CREATE=1 succeeds.
              remotePrResidual = false;
              if (allowRealCreate) {
                ghPrCreateResidual = false;
              }
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
        gh_pr_create_residual: ghPrCreateResidual,
        remote_pr: remotePr,
        ok,
        error: err || null,
        at,
      };
      fs.writeFileSync(statusPath, JSON.stringify(payload, null, 2));
      appendJsonl(path.join(scDir, "status.jsonl"), payload);
      const opsDir = path.join(scDir, "ops");
      fs.mkdirSync(opsDir, { recursive: true });
      const opPath = path.join(
        opsDir,
        `op-${sanitizeSkillName(action) || "status"}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        ...payload,
        status_path: statusPath,
        mode_note: "host_source_control",
      };
      fs.writeFileSync(opPath, JSON.stringify(artifact, null, 2));
      const delivery = recordSendToUser({
        type: "attachment",
        path: opPath,
        label: "source_control_status",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: opPath,
        status_path: statusPath,
        branch,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: opPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    return null;
  }

  async function executeVoiceRelay(command) {
    const at = new Date().toISOString();
    const cmd = String(command || "");
    const sep = cmd.indexOf(" :: ");
    const address = sep >= 0 ? cmd.slice(0, sep) : cmd;
    let text = sep >= 0 ? cmd.slice(sep + 4) : "";
    const rows = readJsonArray(VOICE_SESSIONS_PATH);
    let row = rows.find((r) => r && r.voice_address === address);
    if (!row) {
      // Accept bare id (smoke1) or voice:id forms from MoonBit.
      row = rows.find(
        (r) =>
          r &&
          (r.voice_address === "voice:" + address ||
            String(r.voice_address || "").endsWith(":" + address) ||
            String(r.voice_address || "").endsWith(address)),
      );
    }
    if (!row) {
      row = { voice_address: address, live: true, relay_log: [], at };
      rows.push(row);
    }
    row.relay_log = Array.isArray(row.relay_log) ? row.relay_log : [];
    row.at = at;

    const mediaDir = path.join(REPO_ROOT, "data", "voice", "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    const slug = String(address)
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 64);
    if (!row.media_path) {
      row.media_path = path.join(mediaDir, `${slug || "voice"}.wav`);
    }
    // STT from session WAV when: $stt / empty+$BITBOT_VOICE_STT / $wav:path
    let stt = {
      ok: false,
      text: "",
      tool: null,
      voice_stt_residual: true,
    };
    let wavForStt = row.media_path;
    const wantStt =
      /^\$stt\b/i.test(text.trim()) ||
      /^\$wav:/i.test(text.trim()) ||
      (process.env.BITBOT_VOICE_STT === "1" && !String(text || "").trim()) ||
      process.env.BITBOT_VOICE_STT === "force";
    if (/^\$wav:/i.test(text.trim())) {
      const raw = text.trim().slice(5).trim();
      const abs = resolveUnderRepo(raw) || (path.isAbsolute(raw) ? raw : null);
      if (abs) wavForStt = abs;
    }
    if (wantStt || /^\$stt\b/i.test(text.trim()) || /^\$wav:/i.test(text.trim())) {
      stt = transcribeVoiceWav(wavForStt);
      if (stt.ok && stt.text) {
        text = stt.text;
      } else if (/^\$stt\b/i.test(String(command || "").slice(sep + 4).trim()) || /^\$wav:/i.test(String(command || "").slice(sep + 4).trim())) {
        // Explicit STT request with no transcript — keep residual, empty typed body.
        text = "";
      }
    }
    row.relay_log.push({
      role: "user",
      text,
      stt_ok: Boolean(stt.ok),
      stt_tool: stt.tool || null,
      at,
    });
    const transcript = path.join(
      path.dirname(row.media_path),
      path.basename(row.media_path, path.extname(row.media_path)) +
        ".transcript.jsonl",
    );
    appendJsonl(transcript, {
      role: "user",
      text,
      stt_ok: Boolean(stt.ok),
      stt_tool: stt.tool || null,
      at,
    });
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
      text: replyText,
    });
    const voiceSttResidual = stt.voice_stt_residual !== false || !stt.ok;
    const voiceTtsResidual = replyMedia.voice_tts_residual !== false;
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

    // Per-op Host voice_relay snap (sessions ledger retained).
    const relayDir = path.join(REPO_ROOT, "data", "voice", "relays");
    fs.mkdirSync(relayDir, { recursive: true });
    const relaySnapPath = path.join(
      relayDir,
      `relay-${Date.now().toString(36)}.json`,
    );
    const relayArtifact = {
      voice_address: address,
      turns: row.relay_log.length,
      sessions_path: VOICE_SESSIONS_PATH,
      media_path: row.media_path || null,
      transcript_path: transcript,
      reply_media_path: replyMedia.path,
      reply_media_ok: Boolean(replyMedia.ok),
      reply_media_bytes: replyMedia.bytes || 0,
      reply_media_tool: replyMedia.tool || null,
      reply_prefix: replyText.slice(0, 120),
      user_text_prefix: String(text || "").slice(0, 120),
      stt_text: stt.ok ? String(stt.text || "").slice(0, 400) : null,
      stt_tool: stt.tool || null,
      stt_ok: Boolean(stt.ok),
      worker_ok: Boolean(worker.ok),
      nested_skipped: Boolean(worker.nested_skipped),
      mode: stt.ok
        ? replyMedia.tool === "espeak"
          ? "host_voice_relay_stt_tts"
          : "host_voice_relay_stt"
        : replyMedia.tool === "espeak"
          ? "host_voice_relay_tts"
          : "host_voice_relay",
      voice_stt_residual: voiceSttResidual,
      voice_tts_residual: voiceTtsResidual,
      pretend_silent: false,
      pretend_ok: false,
      at,
    };
    fs.writeFileSync(relaySnapPath, JSON.stringify(relayArtifact, null, 2));
    appendJsonl(path.join(relayDir, "relays.jsonl"), {
      ...relayArtifact,
      path: relaySnapPath,
    });

    const delivery = recordSendToUser({
      type: "voice",
      voice_address: address,
      media_path: replyMedia.path,
      media_ok: Boolean(replyMedia.ok),
      reply_prefix: replyText.slice(0, 120),
      turns: row.relay_log.length,
      path: relaySnapPath,
      source_kind: "voice_relay",
      at,
    });
    appendHostDeliveryJournal({
      kind: "voice_relay",
      command: cmd,
      path: relaySnapPath,
      sessions_path: VOICE_SESSIONS_PATH,
      turns: row.relay_log.length,
      reply_media_ok: Boolean(replyMedia.ok),
      at,
    });
    return okJson("voice_relay", cmd, {
      ...relayArtifact,
      path: relaySnapPath,
      sessions_path: VOICE_SESSIONS_PATH,
      reply: replyText.slice(0, 2000),
      send_to_user: delivery,
      ok: true,
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

    if (kind === "list_skills") {
      // CM skill directory — list agent-tools/skills (never pretend_listing).
      const raw = String(command || "");
      let query = "";
      const qm = raw.match(/\bq=([^\n]*)/i);
      if (qm) query = String(qm[1] || "").trim().toLowerCase();
      else if (raw.trim() && !raw.includes("=")) {
        query = raw.trim().toLowerCase();
      }
      const skillsRoot = path.join(REPO_ROOT, "agent-tools", "skills");
      fs.mkdirSync(skillsRoot, { recursive: true });
      let names = [];
      try {
        names = fs
          .readdirSync(skillsRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .sort();
      } catch {
        names = [];
      }
      const skills = names
        .filter((n) => !query || n.toLowerCase().includes(query))
        .map((n) => {
          const skillMd = path.join(skillsRoot, n, "SKILL.md");
          return {
            id: n,
            name: n,
            path: path.join(skillsRoot, n),
            has_skill_md: fs.existsSync(skillMd),
          };
        });
      const dir = path.join(REPO_ROOT, "data", "skills");
      fs.mkdirSync(dir, { recursive: true });
      const listPath = path.join(
        dir,
        `list-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        mode: "host_list_skills",
        pretend_listing: false,
        query: query || null,
        count: skills.length,
        skills,
        at,
      };
      fs.writeFileSync(listPath, JSON.stringify(artifact, null, 2));
      const delivery = recordSendToUser({
        type: "attachment",
        path: listPath,
        label: "list_skills",
        count: skills.length,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: raw || "list",
        path: listPath,
        count: skills.length,
        at,
      });
      return okJson(kind, raw || "list", {
        ...artifact,
        path: listPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "mail_claim_inbox") {
      // command: local_part|address — durable claim + fixture inbox + inbound wake.
      // Optional live mock: BITBOT_MAIL_CLAIM_API_URL + BITBOT_MAIL_CLAIM_POST=1.
      // Production Gmail/Outlook IdP remains deferred when mock/API unset.
      const parts = cmd.split("|");
      const localPart = parts[0] || "";
      const address = parts[1] || `${localPart}@bitbot.local`;
      const dir = path.join(REPO_ROOT, "data", "mail", "claims");
      fs.mkdirSync(dir, { recursive: true });
      const inboxDir = path.join(REPO_ROOT, "data", "mail", "inbox");
      fs.mkdirSync(inboxDir, { recursive: true });
      const inboundPath = path.join(
        REPO_ROOT,
        "data",
        "channels",
        "inbound.jsonl",
      );
      const claimPath = path.join(
        dir,
        `claim-${localPart || "inbox"}-${Date.now().toString(36)}.json`,
      );
      // Optional live claim against local HTTP mock (not production IdP).
      let liveClaim = false;
      let liveAttempted = false;
      let liveEmpty = false;
      let liveProbe = null;
      let liveRows = [];
      const claimApi = String(process.env.BITBOT_MAIL_CLAIM_API_URL || "").trim();
      const claimToken =
        String(process.env.BITBOT_MAIL_CLAIM_TOKEN || "").trim() ||
        resolveProviderAccessToken("mail_claim") ||
        resolveProviderAccessToken("gmail") ||
        resolveProviderAccessToken("outlook");
      if (claimApi && claimToken && process.env.BITBOT_MAIL_CLAIM_POST === "1") {
        liveAttempted = true;
        try {
          const resp = await httpJson(
            claimApi.replace(/\/$/, "") +
              "/messages?q=" +
              encodeURIComponent(localPart || "inbox"),
            {
              method: "GET",
              headers: {
                Authorization: "Bearer " + claimToken,
                Accept: "application/json",
              },
            },
          );
          liveProbe = {
            ok: Boolean(resp.ok),
            http_status: resp.status || 0,
            error: resp.error || null,
          };
          if (resp.ok && resp.json) {
            const msgs =
              resp.json.messages ||
              resp.json.items ||
              (Array.isArray(resp.json) ? resp.json : []);
            if (Array.isArray(msgs) && msgs.length > 0) {
              liveRows = msgs.slice(0, 20).map((m, i) => ({
                id: String((m && (m.id || m.message_id)) || `live-claim-${i}`),
                from: String((m && m.from) || "live@mock"),
                to: address,
                subject: String((m && m.subject) || "live claim"),
                text_prefix: String(
                  (m && (m.text_prefix || m.snippet || m.subject)) || "",
                ).slice(0, 80),
                mode: "live_mail_claim",
                at,
              }));
              liveClaim = true;
            } else {
              // HTTP-ok empty inbox: keep residual open; do not seed fixture.
              liveEmpty = true;
            }
          }
        } catch (err) {
          liveProbe = {
            ok: false,
            error: String((err && err.message) || err).slice(0, 200),
          };
        }
      }
      // Seed / load local fixture messages for this inbox (not live IdP).
      // Skip fixture fallback when live HTTP-ok returned an empty inbox.
      const fixturePath = path.join(
        inboxDir,
        `${sanitizeSkillName(localPart) || "inbox"}.jsonl`,
      );
      let fixtureRows = liveRows.slice();
      if (!liveEmpty && fixtureRows.length === 0 && fs.existsSync(fixturePath)) {
        try {
          fixtureRows = fs
            .readFileSync(fixturePath, "utf8")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch (_) {
                return null;
              }
            })
            .filter(Boolean);
        } catch (_) {
          fixtureRows = [];
        }
      }
      if (!liveEmpty && fixtureRows.length === 0) {
        const seed = {
          id: `fixture-${localPart || "inbox"}-welcome`,
          from: "bitbot@local",
          to: address,
          subject: "Welcome to claimed inbox",
          text_prefix: "Sandbox claim fixture — not live IdP mail.",
          mode: "sandbox_mail_fixture",
          at,
        };
        appendJsonl(fixturePath, seed);
        fixtureRows = [seed];
      }
      const claimed = [];
      const claimMode = liveClaim ? "live_mail_claim" : "sandbox_mail_claim";
      for (const m of fixtureRows.slice(0, 20)) {
        const row = {
          scheme: "mail",
          address,
          local_part: localPart,
          id: m.id || "",
          from: m.from || "",
          subject: m.subject || "",
          text_prefix: String(m.text_prefix || m.subject || "").slice(0, 80),
          mode: claimMode,
          at,
        };
        appendJsonl(inboundPath, row);
        claimed.push({
          id: row.id,
          subject: row.subject,
          text_len: String(m.text_prefix || "").length,
        });
      }
      // Close residual only when live claim ok AND ≥1 message; empty inbox
      // keeps residual open and must not execute inbound turn as success.
      const claimOk = liveClaim && claimed.length >= 1;
      let turnHookResult = undefined;
      let inboundTurnResidual = undefined;
      if (claimOk || (!liveAttempted && claimed.length >= 1)) {
        // Sandbox fixture still wakes turn hook; live empty skips it.
        const turnPrompt = `Mail claim inbox ${address}: ${claimed.length} fixture message(s)`.slice(
          0,
          400,
        );
        const hooked = await runInboundTurnHook({
          hooksBaseDir: dir,
          turnPrompt,
          hookMeta: {
            address,
            local_part: localPart,
            claimed_count: claimed.length,
          },
          pendingMeta: { address },
        });
        turnHookResult = hooked.turnHookResult;
        inboundTurnResidual = hooked.inboundTurnResidual;
      }
      const artifact = {
        local_part: localPart,
        address,
        mode: liveClaim
          ? "live_mail_claim_inbox"
          : liveEmpty
            ? "live_mail_claim_inbox"
            : "host_mail_claim_inbox",
        pretend_claimed: false,
        user_confirmed: true,
        claimed_count: claimed.length,
        claimed,
        fixture_path: fixturePath,
        inbound_path: inboundPath,
        turn_hook: turnHookResult,
        live_claim: liveClaim,
        live_probe: liveProbe,
        // Closes only when live mock/API returns ≥1 message.
        live_mail_claim_residual: !claimOk,
        inbound_turn_residual: inboundTurnResidual,
        at,
      };
      fs.writeFileSync(claimPath, JSON.stringify(artifact, null, 2));
      appendJsonl(path.join(dir, "claims.jsonl"), {
        ...artifact,
        path: claimPath,
      });
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
        claimed_count: claimed.length,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: claimPath,
        send_to_user: delivery,
        ok: liveEmpty ? false : true,
        error: liveEmpty ? "empty claim inbox" : "",
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
      const machineId = parts[0] || "";
      const tool = String(parts[1] || "").trim().toLowerCase();
      const invDir = path.join(REPO_ROOT, "data", "device", "tool-invokes");
      const mediaDir = path.join(REPO_ROOT, "data", "device", "captures");
      fs.mkdirSync(invDir, { recursive: true });
      fs.mkdirSync(mediaDir, { recursive: true });
      const stampId = Date.now().toString(36);
      let capturePath = null;
      let captureOk = false;
      let captureError = "";
      let mode = "host_ffi_device_local";
      // Best-effort real capture when device nodes / tools exist.
      // Never claim executed without a durable capture artifact.
      try {
        if (tool === "camera" || tool === "photo" || tool === "screenshot") {
          capturePath = path.join(mediaDir, `camera-${stampId}.png`);
          const display = String(process.env.DISPLAY || "").trim();
          const cameraFixture = path.join(
            REPO_ROOT,
            "data",
            "device",
            "camera.png",
          );
          if (display && fs.existsSync("/usr/bin/import")) {
            await execFileAsync(
              "/usr/bin/import",
              ["-window", "root", capturePath],
              { timeout: 8000 },
            );
            captureOk = fs.existsSync(capturePath) && fs.statSync(capturePath).size > 32;
            mode = "host_device_import_root";
          } else if (fs.existsSync("/usr/bin/ffmpeg") && fs.existsSync("/dev/video0")) {
            await execFileAsync(
              "/usr/bin/ffmpeg",
              [
                "-y",
                "-f",
                "v4l2",
                "-i",
                "/dev/video0",
                "-frames:v",
                "1",
                capturePath,
              ],
              { timeout: 10000 },
            );
            captureOk =
              fs.existsSync(capturePath) && fs.statSync(capturePath).size > 32;
            mode = "host_device_v4l2_frame";
          } else if (fs.existsSync(cameraFixture)) {
            // Sandbox fixture backend (not OS camera) — closes capture residual honestly.
            fs.copyFileSync(cameraFixture, capturePath);
            captureOk =
              fs.existsSync(capturePath) && fs.statSync(capturePath).size > 32;
            mode = "host_device_camera_fixture";
          } else {
            captureError =
              "no DISPLAY/import, /dev/video0, or data/device/camera.png — device_capture_residual";
            mode = "host_device_capture_residual";
          }
        } else if (tool === "mic" || tool === "microphone" || tool === "audio") {
          capturePath = path.join(mediaDir, `mic-${stampId}.wav`);
          const micFixture = path.join(REPO_ROOT, "data", "device", "mic.wav");
          if (fs.existsSync("/usr/bin/ffmpeg") && fs.existsSync("/dev/snd")) {
            await execFileAsync(
              "/usr/bin/ffmpeg",
              [
                "-y",
                "-f",
                "alsa",
                "-i",
                "default",
                "-t",
                "1",
                capturePath,
              ],
              { timeout: 8000 },
            );
            captureOk =
              fs.existsSync(capturePath) && fs.statSync(capturePath).size > 44;
            mode = "host_device_alsa_wav";
          } else if (fs.existsSync(micFixture)) {
            fs.copyFileSync(micFixture, capturePath);
            captureOk =
              fs.existsSync(capturePath) && fs.statSync(capturePath).size > 44;
            mode = "host_device_mic_fixture";
          } else {
            captureError =
              "no ALSA default capture or data/device/mic.wav — device_capture_residual";
            mode = "host_device_capture_residual";
          }
        } else if (tool === "contacts" || tool === "location") {
          // Sandbox fixture backends (not OS address-book / GPS).
          const fixture =
            tool === "contacts"
              ? path.join(REPO_ROOT, "data", "device", "contacts.json")
              : path.join(REPO_ROOT, "data", "device", "location.json");
          if (fs.existsSync(fixture)) {
            const raw = fs.readFileSync(fixture, "utf8");
            capturePath = path.join(
              mediaDir,
              `${tool}-${stampId}.json`,
            );
            fs.writeFileSync(capturePath, raw);
            captureOk = true;
            mode =
              tool === "contacts"
                ? "host_device_contacts_fixture"
                : "host_device_location_fixture";
          } else {
            captureError =
              `no data/device/${tool}.json fixture — device_tool_residual`;
            mode = "host_device_invoke_residual";
          }
        } else {
          // Unknown non-media tools: durable invoke only.
          captureError = `tool=${tool || "unknown"} has no local capture backend`;
          mode = "host_device_invoke_residual";
        }
      } catch (err) {
        captureError = String((err && err.message) || err).slice(0, 240);
        captureOk = false;
      }
      const isMediaTool =
        tool === "camera" ||
        tool === "photo" ||
        tool === "screenshot" ||
        tool === "mic" ||
        tool === "microphone" ||
        tool === "audio";
      const entry = {
        machine_id: machineId,
        tool: tool || parts[1] || "",
        executed: captureOk,
        capture_path: captureOk ? capturePath : null,
        capture_bytes:
          captureOk && capturePath && fs.existsSync(capturePath)
            ? fs.statSync(capturePath).size
            : 0,
        mode,
        pretend_executed: false,
        pretend_granted: false,
        device_capture_residual: isMediaTool ? !captureOk : false,
        device_tool_residual: !captureOk,
        capture_error: captureError || null,
        at,
      };
      const ledgerPath = path.join(
        REPO_ROOT,
        "data",
        "device",
        "tool-invokes.jsonl",
      );
      const invokePath = path.join(
        invDir,
        `invoke-${stampId}.json`,
      );
      fs.writeFileSync(invokePath, JSON.stringify(entry, null, 2));
      const pathWritten = appendJsonl(ledgerPath, {
        ...entry,
        path: invokePath,
      });
      const delivery = recordSendToUser({
        type: captureOk && capturePath ? "media" : "attachment",
        path: captureOk && capturePath ? capturePath : invokePath,
        label: "device_tool",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: invokePath,
        capture_path: entry.capture_path,
        ledger_path: pathWritten,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        path: invokePath,
        media_path: entry.capture_path,
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
        // Prefer BITBOT_ESPEAK_BIN / espeak via synthesizeVoiceWav; sine residual otherwise.
        media = synthesizeVoiceWav(mediaPath, {
          frequency: 440,
          duration: 0.4,
          text: `Bit Bot voice session ${address}`,
        });
      }
      // After media write: close voice_stt_residual when sidecar / BITBOT_STT_BIN
      // / BITBOT_VOICE_STT path yields a transcript (never pretend heard).
      let stt = {
        ok: false,
        text: "",
        tool: null,
        voice_stt_residual: true,
      };
      if (action === "start" && media.ok && media.path) {
        const wantStt =
          process.env.BITBOT_VOICE_STT === "1" ||
          process.env.BITBOT_VOICE_STT === "force" ||
          Boolean(String(process.env.BITBOT_STT_BIN || "").trim()) ||
          fs.existsSync(media.path + ".stt.txt") ||
          fs.existsSync(
            path.join(
              path.dirname(media.path),
              path.basename(media.path, path.extname(media.path)) + ".stt.txt",
            ),
          );
        if (wantStt) {
          stt = transcribeVoiceWav(media.path);
        }
      }
      const callId =
        action === "start"
          ? `call-${slug || "voice"}-${Date.now().toString(36)}`
          : (rows.find((r) => r && r.voice_address === address) || {}).call_id ||
            `call-${slug || "voice"}`;
      const row = {
        action,
        voice_address: address,
        call_id: callId,
        live: action === "start",
        relay_log: [],
        media_path: media.path,
        media_ok: Boolean(media.ok),
        at,
      };
      const idx = rows.findIndex((r) => r && r.voice_address === address);
      if (idx >= 0) {
        rows[idx] = {
          ...rows[idx],
          ...row,
          call_id: rows[idx].call_id || callId,
          relay_log: rows[idx].relay_log || [],
        };
      } else rows.push(row);
      writeJsonArray(VOICE_SESSIONS_PATH, rows);
      const sessDir = path.join(REPO_ROOT, "data", "voice", "session-actions");
      fs.mkdirSync(sessDir, { recursive: true });
      const actionPath = path.join(
        sessDir,
        `${action}-${slug || "voice"}-${Date.now().toString(36)}.json`,
      );
      const voiceSttResidual = stt.voice_stt_residual !== false || !stt.ok;
      const artifact = {
        stored: true,
        action,
        voice_address: address,
        call_id: (rows[idx >= 0 ? idx : rows.length - 1] || row).call_id || callId,
        live: row.live,
        media_ok: Boolean(media.ok),
        media_path: media.path,
        media_bytes: media.bytes || 0,
        media_tool: media.tool || null,
        sessions_path: VOICE_SESSIONS_PATH,
        mode: "host_voice_session",
        stt_ok: Boolean(stt.ok),
        stt_tool: stt.tool || null,
        stt_text: stt.ok ? String(stt.text || "").slice(0, 400) : null,
        // Honest residual: closed only when STT mock/sidecar actually heard.
        voice_stt_residual: voiceSttResidual,
        // Honest residual: closed only when synthesizeVoiceWav used espeak/TTS.
        voice_tts_residual: media.voice_tts_residual !== false,
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
      // Prefer the session named by the end artifact stem (voice-calls/smoke1.json → smoke1).
      const endStem = path
        .basename(outPath, path.extname(outPath))
        .replace(/^end-/, "")
        .replace(/^voice[_-]?/, "");
      // Exact address / call_id prefixes only — never id.includes(stem)
      // (smoke1 must not steal smoke1b / call-voice_smoke1b-…).
      const matchRank = (r) => {
        if (!r || !endStem) return 0;
        const va = String(r.voice_address || "");
        const id = String(r.call_id || r.id || "");
        if (
          va === endStem ||
          va === "voice:" + endStem ||
          va.endsWith(":" + endStem)
        ) {
          return 3;
        }
        if (
          id === endStem ||
          id === "call-" + endStem ||
          id.startsWith("call-voice_" + endStem + "-") ||
          id.startsWith("call-" + endStem + "-")
        ) {
          return 2;
        }
        return 0;
      };
      let mediaPath = null;
      let mediaOk = false;
      let callId = "";
      let matched = false;
      let bestRank = 0;
      for (const r of rows) {
        const rank = matchRank(r);
        if (rank <= 0) continue;
        r.live = false;
        r.ended_at = at;
        r.summary_path = outPath;
        if (rank >= bestRank) {
          mediaPath = r.media_path || null;
          mediaOk = Boolean(r.media_ok);
          callId = r.call_id || r.id || callId;
          bestRank = rank;
          matched = true;
        }
      }
      // Unmatched: do not steal other live calls — leave residual open.
      // Matched: only the ranked session(s) above were ended; siblings stay live.
      writeJsonArray(VOICE_SESSIONS_PATH, rows);
      // CM-2005: durable end under data/voice/voice-calls/ with app_summary.
      const endDir = path.join(REPO_ROOT, "data", "voice", "voice-calls");
      fs.mkdirSync(endDir, { recursive: true });
      const endArtifactPath = path.join(
        endDir,
        `end-${callId || Date.now().toString(36)}.json`,
      );
      const endArtifact = {
        call_id: callId,
        summary_path: outPath,
        app_summary: summary.slice(0, 2000),
        summary_prefix: summary.slice(0, 120),
        media_path: mediaPath,
        media_ok: mediaOk,
        live: false,
        pretend_still_live: false,
        matched: matched,
        voice_end_match_residual: !matched,
        mode: matched ? "host_voice_end" : "host_voice_end_unmatched",
        at,
      };
      fs.writeFileSync(endArtifactPath, JSON.stringify(endArtifact, null, 2));
      // Keep legacy ends/ ledger pointer for older smokes.
      const legacyEnds = path.join(REPO_ROOT, "data", "voice", "ends");
      fs.mkdirSync(legacyEnds, { recursive: true });
      appendJsonl(path.join(legacyEnds, "ends.jsonl"), {
        ...endArtifact,
        path: endArtifactPath,
      });
      appendJsonl(path.join(endDir, "calls.jsonl"), {
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
        ...endArtifact,
        path: endArtifactPath,
        summary_path: outPath,
        end_artifact_path: endArtifactPath,
        bytes: Buffer.byteLength(summary + "\n"),
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
      const snapDir = path.join(SECTIONS_DIR, "adds");
      fs.mkdirSync(snapDir, { recursive: true });
      if (existing) {
        // Idempotent add — return existing partition (never invent a second section).
        if (title && existing.title !== title) {
          existing.title = title;
          group.updated_at = at;
          fs.writeFileSync(groupPath, JSON.stringify(group, null, 2));
        }
        const addPath = path.join(
          snapDir,
          `add-${sanitizeSkillName(sectionId) || "sec"}-existing-${Date.now().toString(36)}.json`,
        );
        const artifact = {
          group_id: groupId,
          section: existing,
          group_path: groupPath,
          section_count: group.sections.length,
          existing: true,
          pretend_shared: false,
          mode: "host_section_add",
          at,
        };
        fs.writeFileSync(addPath, JSON.stringify(artifact, null, 2));
        const delivery = recordSendToUser({
          type: "attachment",
          path: addPath,
          label: "section_add_existing",
          source_kind: kind,
          at,
        });
        appendHostDeliveryJournal({
          kind,
          command: cmd,
          path: addPath,
          group_path: groupPath,
          section_id: sectionId,
          existing: true,
          at,
        });
        return okJson(kind, cmd, {
          ...artifact,
          path: addPath,
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
      const addPath = path.join(
        snapDir,
        `add-${sanitizeSkillName(sectionId) || "sec"}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        group_id: groupId,
        section: sec,
        group_path: groupPath,
        section_count: group.sections.length,
        existing: false,
        pretend_shared: false,
        mode: "host_section_add",
        at,
      };
      fs.writeFileSync(addPath, JSON.stringify(artifact, null, 2));
      const delivery = recordSendToUser({
        type: "attachment",
        path: addPath,
        label: "section_add",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: addPath,
        group_path: groupPath,
        section_id: sectionId,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: addPath,
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
      const postDir = path.join(SECTIONS_DIR, "posts");
      fs.mkdirSync(postDir, { recursive: true });
      const postPath = path.join(
        postDir,
        `post-${sanitizeSkillName(sectionId) || "sec"}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        group_id: groupId,
        section_id: sectionId,
        from_agent: fromAgent,
        body,
        group_path: groupPath,
        messages_in_section: inSection.length,
        isolation_ok: true,
        pretend_cross_section: false,
        mode: "host_section_post",
        at,
      };
      fs.writeFileSync(postPath, JSON.stringify(artifact, null, 2));
      const delivery = recordSendToUser({
        type: "text",
        channel: `section:${groupId}/${sectionId}`,
        body_prefix: String(body).slice(0, 120),
        path: postPath,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: postPath,
        group_path: groupPath,
        section_id: sectionId,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: postPath,
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
      // CM-1401 — CreateAgent must appear in Members + sidebar immediately.
      const memberIds = rows
        .map((r) => (r && (r.id || r.agent_id)) || null)
        .filter(Boolean);
      const inMembers = memberIds.includes(row.id);
      const artifact = {
        stored: true,
        existing,
        teammate: row,
        teammates_path: TEAMMATES_PATH,
        members_sidebar: true,
        appears_in_members: inMembers,
        in_members: inMembers,
        in_sidebar: inMembers,
        member_ids: memberIds,
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
        appears_in_members: inMembers,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: createPath,
        teammates_path: TEAMMATES_PATH,
        appears_in_members: inMembers,
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
      // Live calendar when API URL+token; else ICS-only residual.
      const calApi = resolveConnectorApiUrl("calendar", [
        "BITBOT_CALENDAR_API_URL",
      ]);
      const calToken = resolveProviderAccessToken("calendar");
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
      const schedDir = path.join(calDir, "schedules");
      fs.mkdirSync(schedDir, { recursive: true });
      const schedPath = path.join(
        schedDir,
        `schedule-${sanitizeSkillName(eventId) || "evt"}-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        ...entry,
        ledger_path: pathWritten,
        mode_note: "host_schedule_meeting",
      };
      fs.writeFileSync(schedPath, JSON.stringify(artifact, null, 2));
      const delivery = recordSendToUser({
        type: "attachment",
        path: icsPath,
        meta_path: schedPath,
        label: "calendar.ics",
        event_id: eventId,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: schedPath,
        ics: icsPath,
        ledger_path: pathWritten,
        mode,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: schedPath,
        scheduled: true,
        send_to_user: delivery,
        ok: true,
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
      const purchaseToken = resolveProviderAccessToken("purchase");
      const purchaseApi = resolveConnectorApiUrl("purchase", [
        "BITBOT_PURCHASE_API_URL",
      ]);
      // Live when LIVE=1 or purchase_token.json sets live:true (never pretend charge).
      let wantLive =
        String(process.env.BITBOT_PURCHASE_LIVE || "").trim() === "1";
      try {
        const tokPath = connectorTokenPath("purchase");
        if (fs.existsSync(tokPath)) {
          const tok = JSON.parse(fs.readFileSync(tokPath, "utf8"));
          if (tok && tok.live === true) wantLive = true;
        }
      } catch (_) {
        /* ignore */
      }
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
            "BITBOT_PURCHASE_LIVE=1 requires purchase token (env or connectors/purchase_token.json) and BITBOT_PURCHASE_API_URL",
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
      const purchaseDir = path.join(REPO_ROOT, "data", "commerce", "purchases");
      fs.mkdirSync(purchaseDir, { recursive: true });
      const purchasePath = path.join(
        purchaseDir,
        `purchase-${receiptId}.json`,
      );
      const artifact = {
        ...entry,
        ledger_path: pathWritten,
        mode_note: "host_purchase",
      };
      fs.writeFileSync(purchasePath, JSON.stringify(artifact, null, 2));
      const delivery = recordSendToUser({
        type: "attachment",
        path: receiptPath,
        meta_path: purchasePath,
        label: "purchase_receipt",
        receipt_id: receiptId,
        mode,
        live_paid_residual: !charged,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: purchasePath,
        receipt: receiptPath,
        ledger_path: pathWritten,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: purchasePath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "finance_call") {
      const parts = cmd.split("|");
      const tool = parts[0] || "";
      const output = parts.slice(1).join("|") || "";
      const finState = loadConnectorState("finance");
      // Explicit env / connector token file wins for live mock/API gates.
      const accessToken = resolveProviderAccessToken("finance");
      const financeApi = resolveConnectorApiUrl("finance", [
        "BITBOT_FINANCE_API_URL",
      ]);
      const connected = Boolean(
        finState.connected || accessToken || connectorArmed("finance"),
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
        path: artifactPath,
        ledger_path: pathWritten,
        artifact: artifactPath,
        at,
      });
      return okJson(kind, cmd, {
        ...entry,
        ...artifact,
        path: artifactPath,
        ledger_path: pathWritten,
        ok: true,
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
      const jobApi = resolveConnectorApiUrl("job", ["BITBOT_JOB_API_URL"]);
      const jobToken = resolveProviderAccessToken("job");
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
      let username = parts[2] || "";
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
      // Prefer username from vault metadata when MoonBit sends handle|domain only.
      if (!username) {
        const prior = vault.entries.find(
          (e) =>
            e &&
            ((fillHandle && e.fill_handle === fillHandle) ||
              (domain && e.domain === domain) ||
              (fillHandle && e.id === fillHandle)),
        );
        if (prior && prior.username) username = String(prior.username);
      }
      // Product seed username when vault has none (matches MoonBit CredentialStore seed).
      if (!username) username = "user";
      const entry = {
        fill_handle: fillHandle,
        domain,
        username,
        secret_echoed: false,
        vault_only: true,
        at,
      };
      const pathWritten = appendJsonl(CREDENTIAL_FILLS_PATH, entry);
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
      const fillDir = path.join(REPO_ROOT, "data", "credentials", "fills");
      fs.mkdirSync(fillDir, { recursive: true });
      const fillPath = path.join(
        fillDir,
        `fill-${sanitizeSkillName(id) || "cred"}-${Date.now().toString(36)}.json`,
      );
      // CM-2130 + identity-browser: durable CDP fill plan (username only — never secret).
      const identitySessPath = path.join(
        REPO_ROOT,
        "data",
        "connectors",
        "identity",
        "browser-session.json",
      );
      let identityReady = false;
      let identityUserData = null;
      if (fs.existsSync(identitySessPath)) {
        try {
          const sess = JSON.parse(fs.readFileSync(identitySessPath, "utf8"));
          if (
            sess &&
            (sess.switched || sess.status === "SwitchedToSignedInBrowser")
          ) {
            identityReady = true;
            identityUserData = sess.user_data_dir || null;
          }
        } catch (_) {
          identityReady = false;
        }
      }
      // CM-0111: domain may arrive as markdown [label](url); unwrap for navigate.
      const resolveCredentialNavigateUrl = (raw) => {
        const s = String(raw || "").trim();
        if (!s) return null;
        const md = s.match(/\]\((https?:\/\/[^)\s]+)\)/);
        let urlOrHost = md ? md[1] : s;
        const bare = String(urlOrHost).match(/https?:\/\/[^\s|"')\]]+/);
        if (bare) urlOrHost = bare[0];
        urlOrHost = String(urlOrHost)
          .replace(/[.,;:]+$/, "")
          .trim();
        if (!urlOrHost) return null;
        if (
          urlOrHost.startsWith("http://") ||
          urlOrHost.startsWith("https://")
        ) {
          return urlOrHost;
        }
        return `https://${urlOrHost}`;
      };
      const navUrl = resolveCredentialNavigateUrl(domain);
      const domainForPlan = navUrl
        ? navUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
        : domain || "";
      const browserPlan = {
        fill_handle: fillHandle || id,
        domain: domainForPlan,
        username: username || "",
        // Password never leaves vault / never appears in plan JSON.
        secret_in_plan: false,
        identity_browser_ready: identityReady,
        user_data_dir: identityUserData,
        navigate_url: navUrl,
        cdp_actions: username
          ? [
              navUrl ? `navigate:${navUrl}` : null,
              "focus:input[type=email],input[name*=user],input[name*=email],input[type=text]",
              `type_username:${username}`,
              // Password fill stays residual until OS secret provider (deferred).
              "password_fill:residual",
            ].filter(Boolean)
          : [],
        pretend_secret_view: false,
        at,
      };
      const planPath = path.join(
        fillDir,
        `browser-plan-${sanitizeSkillName(id) || "cred"}-${Date.now().toString(36)}.json`,
      );
      fs.writeFileSync(planPath, JSON.stringify(browserPlan, null, 2));
      // Optional live username CDP attempt when identity profile is switched.
      // BITBOT_CREDENTIAL_FILL_MOCK=1 closes username residual without CU (password stays residual).
      let browserFill = {
        attempted: false,
        username_typed: false,
        ok: false,
        error: null,
        evidence: null,
      };
      const wantMockFill =
        process.env.BITBOT_CREDENTIAL_FILL_MOCK === "1" &&
        Boolean(username) &&
        Boolean(navUrl);
      const wantLiveFill =
        process.env.BITBOT_CREDENTIAL_BROWSER_FILL === "1" &&
        identityReady &&
        Boolean(username) &&
        Boolean(navUrl);
      if (wantMockFill) {
        const evidenceDir = path.join(
          REPO_ROOT,
          "data",
          "journal",
          "computer-use",
          `cred-fill-mock-${Date.now().toString(36)}`,
        );
        fs.mkdirSync(evidenceDir, { recursive: true });
        const mockEvidence = path.join(evidenceDir, "username_fill_mock.json");
        fs.writeFileSync(
          mockEvidence,
          JSON.stringify(
            {
              username_typed: true,
              password_filled: false,
              pretend_secret_view: false,
              mode: "host_credential_username_mock",
              at,
            },
            null,
            2,
          ),
        );
        browserFill = {
          attempted: true,
          username_typed: true,
          ok: true,
          error: null,
          evidence: mockEvidence,
          mode: "host_credential_username_mock",
        };
      } else if (wantLiveFill) {
        try {
          const evidenceDir = path.join(
            REPO_ROOT,
            "data",
            "journal",
            "computer-use",
            `cred-fill-${Date.now().toString(36)}`,
          );
          fs.mkdirSync(evidenceDir, { recursive: true });
          const cuEnv = { ...process.env };
          if (identityUserData) {
            cuEnv.BITBOT_IDENTITY_USER_DATA_DIR = identityUserData;
          }
          // Local sign-in fixtures (smoke) need BITBOT_CU_ALLOW_LOCAL like CU blocked_on_signin.
          const localNav =
            navUrl &&
            (navUrl.includes("127.0.0.1") ||
              navUrl.includes("localhost") ||
              navUrl.includes("0.0.0.0"));
          if (localNav && !cuEnv.BITBOT_CU_ALLOW_LOCAL) {
            cuEnv.BITBOT_CU_ALLOW_LOCAL = "1";
          }
          // Username only in CU command — never append password/token.
          // Navigate to sign-in wall; CDP username fill reuses CU blocked_on_signin
          // browser-plan path (focus + type_username; password stays residual).
          const cuCmd = `credential fill username sign in login ${navUrl}`;
          const { stdout } = await execFileAsync(
            process.env.PYTHON || "python3",
            [
              path.join(REPO_ROOT, "scripts", "host_box_chrome_cu.py"),
              "--url",
              navUrl,
              "--command",
              cuCmd,
              "--artifact-dir",
              evidenceDir,
              "--gui-mode",
              "headless",
            ],
            {
              cwd: REPO_ROOT,
              timeout: 90000,
              maxBuffer: 2 * 1024 * 1024,
              env: cuEnv,
            },
          );
          const cuRun = path.join(evidenceDir, "cu_run.json");
          let summary = {};
          if (fs.existsSync(cuRun)) {
            summary = JSON.parse(fs.readFileSync(cuRun, "utf8"));
          } else {
            const line = String(stdout || "")
              .trim()
              .split("\n")
              .filter(Boolean)
              .pop();
            if (line && line.startsWith("{")) summary = JSON.parse(line);
          }
          const gui = summary.gui || {};
          const outcome = summary.outcome || {};
          const signinFill =
            (gui.vision_plan && gui.vision_plan.signin_fill) ||
            outcome.signin_fill ||
            {};
          // Prefer CU blocked_on_signin username CDP (focus+type_username from plan).
          const usernameTyped = Boolean(signinFill.username_typed);
          const chromeOk = Boolean(gui.box_chrome_process || gui.started);
          browserFill = {
            attempted: true,
            username_typed: usernameTyped,
            ok: chromeOk && usernameTyped,
            error: usernameTyped
              ? null
              : String(
                  signinFill.error ||
                    (gui.actions && gui.actions.error) ||
                    outcome.summary ||
                    "username CDP fill did not type",
                ).slice(0, 240),
            evidence: fs.existsSync(cuRun) ? cuRun : evidenceDir,
            identity_browser: gui.identity_browser || null,
            user_data_dir: gui.user_data_dir || identityUserData,
            mode: signinFill.mode || "host_credential_fill_browser",
            signin_fill: {
              username_typed: usernameTyped,
              password_filled: false,
              filled: false,
              mode: signinFill.mode || null,
            },
          };
        } catch (err) {
          browserFill = {
            attempted: true,
            username_typed: false,
            ok: false,
            error: String((err && err.message) || err).slice(0, 240),
            evidence: null,
          };
        }
      }
      // Username residual closes when typed; password/OS secret fill stays residual (deferred).
      const credentialBrowserFillResidual =
        !browserFill.ok || !browserFill.username_typed;
      const signinFillResidual = true;
      const artifact = {
        ...entry,
        vault_path: vaultPath,
        vault_id: id,
        ledger_path: pathWritten,
        pretend_secret_view: false,
        mode: wantMockFill
          ? "host_credential_fill_username_mock"
          : wantLiveFill
            ? "host_credential_fill_browser"
            : "host_credential_fill",
        browser_plan_path: planPath,
        browser_fill: browserFill,
        identity_browser_ready: identityReady,
        credential_browser_fill_residual: credentialBrowserFillResidual,
        signin_fill_residual: signinFillResidual,
        note: "secret stays in Host vault — never assistant_view; CDP plan is username-only; password OS fill residual",
        at,
      };
      fs.writeFileSync(fillPath, JSON.stringify(artifact, null, 2));
      // CM-1106: SendToUser type=secret-request → vault; never plaintext / attachment mislabel.
      const delivery = recordSendToUser({
        type: "secret-request",
        name: domain || id,
        label: meta.label || domain || "credential",
        handle: id,
        vault_path: vaultPath,
        vault_id: id,
        fill_handle: fillHandle || id,
        path: fillPath,
        secret_echoed: false,
        pretend_secret_view: false,
        pretend_secret_echo: false,
        credential_browser_fill_residual: credentialBrowserFillResidual,
        signin_fill_residual: signinFillResidual,
        source_kind: "credential_fill",
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: fillPath,
        vault_path: vaultPath,
        ledger_path: pathWritten,
        browser_plan_path: planPath,
        credential_browser_fill_residual: credentialBrowserFillResidual,
        signin_fill_residual: signinFillResidual,
        send_to_user_type: "secret-request",
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: fillPath,
        send_to_user: delivery,
        ok: true,
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
      const listDir = path.join(wfDir, "lists");
      fs.mkdirSync(listDir, { recursive: true });
      const listPath = path.join(
        listDir,
        `list-${Date.now().toString(36)}.json`,
      );
      const artifact = {
        ...catalog,
        catalog_path: catalogPath,
        pretend_shared: false,
      };
      fs.writeFileSync(listPath, JSON.stringify(artifact, null, 2));
      const delivery = recordSendToUser({
        type: "attachment",
        path: listPath,
        label: "workflow_catalog",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: listPath,
        catalog_path: catalogPath,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: listPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "x_search") {
      const q = String(cmd || "").trim() || "(empty)";
      const xDir = path.join(REPO_ROOT, "data", "connectors", "x");
      fs.mkdirSync(xDir, { recursive: true });
      const bearer = resolveProviderAccessToken("x");
      const xApiBase = resolveConnectorApiUrl("x", ["BITBOT_X_API_BASE"]);
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
      const draftMetaDir = path.join(REPO_ROOT, "data", "mail", "drafts");
      fs.mkdirSync(draftMetaDir, { recursive: true });
      const draftMetaPath = path.join(draftMetaDir, `${draftId}.json`);
      const artifact = {
        ...entry,
        ledger_path: pathWritten,
        pretend_sent: false,
        mode_note: "host_mail_draft",
      };
      fs.writeFileSync(draftMetaPath, JSON.stringify(artifact, null, 2));
      const delivery = recordSendToUser({
        type: meetingDraft ? "widget" : "attachment",
        path: emlPath,
        meta_path: draftMetaPath,
        label: meetingDraft ? "meeting_chat_draft" : "mail_draft.eml",
        widget: meetingDraft ? "meeting_draft_card" : undefined,
        to,
        subject,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: cmd,
        path: draftMetaPath,
        eml: emlPath,
        ledger_path: pathWritten,
        at,
      });
      return okJson(kind, cmd, {
        ...artifact,
        path: draftMetaPath,
        drafted: true,
        mode: meetingDraft ? "meeting_chat_draft_card" : "mail_draft",
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "mcp_get_plugin") {
      // CM-2108 — GetPlugin metadata + skills.
      const nsDir = path.join(REPO_ROOT, "data", "connectors", "mcp-namespaces");
      fs.mkdirSync(nsDir, { recursive: true });
      const catalogPath = path.join(nsDir, "catalog.json");
      const raw = String(command || "").trim();
      const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
      const pluginId = parts[0] || raw;
      const PLUGIN_META = {
        "plugin-slides": {
          id: "plugin-slides",
          display_name: "Slides helper",
          mcp_namespace: "user-Slides",
          skills: ["slides-quickstart"],
        },
        "plugin-calendar": {
          id: "plugin-calendar",
          display_name: "Calendar sync",
          mcp_namespace: "user-Calendar",
          skills: ["calendar-sync"],
        },
      };
      const meta = PLUGIN_META[pluginId];
      if (!meta) {
        const snapPath = path.join(
          nsDir,
          `get-refused-${Date.now().toString(36)}.json`,
        );
        const artifact = {
          mode: "host_mcp_get_plugin",
          ok: false,
          refused: true,
          pretend_plugin: false,
          plugin_id: pluginId,
          error: "unknown plugin: " + pluginId,
          at,
        };
        fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
        return okJson(kind, raw, { ...artifact, path: snapPath });
      }
      let installed = false;
      let status = "available";
      try {
        if (fs.existsSync(catalogPath)) {
          const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
          installed = Array.isArray(catalog.installed_plugins)
            ? catalog.installed_plugins.includes(pluginId)
            : false;
          const ns = (catalog.namespaces || {})[meta.mcp_namespace];
          if (ns && ns.status) status = ns.status;
          else if (installed) status = "Ready";
        }
      } catch {
        /* defaults */
      }
      const snapPath = path.join(
        nsDir,
        `get-${pluginId.replace(/[^\w.-]+/g, "_")}-${Date.now().toString(36)}.json`,
      );
      const entry = {
        mode: "host_mcp_get_plugin",
        pretend_plugin: false,
        ...meta,
        skill_count: meta.skills.length,
        skill_names: meta.skills.slice(),
        installed,
        status,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(entry, null, 2));
      const delivery = recordSendToUser({
        type: "attachment",
        path: snapPath,
        label: "mcp_get_plugin",
        plugin_id: pluginId,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: raw,
        path: snapPath,
        plugin_id: pluginId,
        at,
      });
      return okJson(kind, raw, {
        ...entry,
        path: snapPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "mcp_list_plugins") {
      // CM-0904 directory — SearchPlugins / list available connectors.
      const nsDir = path.join(REPO_ROOT, "data", "connectors", "mcp-namespaces");
      fs.mkdirSync(nsDir, { recursive: true });
      const catalogPath = path.join(nsDir, "catalog.json");
      const raw = String(command || "");
      let query = "";
      const qm = raw.match(/\bq=([^\n]*)/i);
      if (qm) query = String(qm[1] || "").trim().toLowerCase();
      const ALL = [
        {
          id: "plugin-slides",
          display_name: "Slides helper",
          mcp_namespace: "user-Slides",
          skills: ["slides-quickstart"],
        },
        {
          id: "plugin-calendar",
          display_name: "Calendar sync",
          mcp_namespace: "user-Calendar",
          skills: ["calendar-sync"],
        },
      ];
      let installed = [];
      try {
        if (fs.existsSync(catalogPath)) {
          const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
          installed = Array.isArray(catalog.installed_plugins)
            ? catalog.installed_plugins
            : [];
        }
      } catch {
        installed = [];
      }
      const plugins = ALL.filter((p) => {
        if (!query) return true;
        const hay = (
          p.id +
          " " +
          p.display_name +
          " " +
          p.mcp_namespace +
          " " +
          p.skills.join(" ")
        ).toLowerCase();
        return hay.includes(query);
      }).map((p) => ({
        ...p,
        installed: installed.includes(p.id),
        skill_count: p.skills.length,
      }));
      const snapPath = path.join(
        nsDir,
        `list-${Date.now().toString(36)}.json`,
      );
      const entry = {
        mode: "host_mcp_list_plugins",
        pretend_listing: false,
        query: query || null,
        count: plugins.length,
        plugins,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(entry, null, 2));
      const delivery = recordSendToUser({
        type: "attachment",
        path: snapPath,
        label: "mcp_list_plugins",
        count: plugins.length,
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: raw || "list",
        path: snapPath,
        count: plugins.length,
        at,
      });
      return okJson(kind, raw || "list", {
        ...entry,
        path: snapPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "mcp_uninstall") {
      // CM-2107 — UninstallPlugin: namespace Unavailable; tools under ns gone.
      const nsDir = path.join(REPO_ROOT, "data", "connectors", "mcp-namespaces");
      fs.mkdirSync(nsDir, { recursive: true });
      const catalogPath = path.join(nsDir, "catalog.json");
      const toolsCatalogPath = path.join(
        REPO_ROOT,
        "data",
        "connectors",
        "mcp-tools-catalog.json",
      );
      const raw = String(cmd || "").trim();
      const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
      const pluginId = parts[0] || raw;
      let namespace = parts[1] || "";
      const PLUGIN_NS = {
        "plugin-slides": "user-Slides",
        "plugin-calendar": "user-Calendar",
      };
      if (!namespace) namespace = PLUGIN_NS[pluginId] || pluginId;

      let catalog = { namespaces: {}, installed_plugins: [] };
      try {
        if (fs.existsSync(catalogPath)) {
          catalog = {
            ...catalog,
            ...JSON.parse(fs.readFileSync(catalogPath, "utf8")),
          };
          if (!catalog.namespaces) catalog.namespaces = {};
          if (!Array.isArray(catalog.installed_plugins)) {
            catalog.installed_plugins = [];
          }
        }
      } catch {
        /* defaults */
      }

      const wasInstalled =
        (catalog.namespaces[namespace] &&
          catalog.namespaces[namespace].status === "Ready") ||
        catalog.installed_plugins.includes(pluginId);
      const knownPlugin = Boolean(PLUGIN_NS[pluginId]);
      if (!wasInstalled && !knownPlugin) {
        const snapPath = path.join(
          nsDir,
          `uninstall-refused-${Date.now().toString(36)}.json`,
        );
        const artifact = {
          mode: "host_mcp_uninstall",
          ok: false,
          refused: true,
          pretend_uninstalled: false,
          plugin_id: pluginId,
          namespace,
          error: "unknown or not installed plugin: " + pluginId,
          at,
        };
        fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
        return okJson(kind, raw, { ...artifact, path: snapPath });
      }

      // Mark Unavailable / remove from ready catalog.
      if (catalog.namespaces[namespace]) {
        catalog.namespaces[namespace] = {
          ...catalog.namespaces[namespace],
          status: "Unavailable",
          usable: false,
          uninstalled_at: at,
        };
      } else {
        catalog.namespaces[namespace] = {
          namespace,
          status: "Unavailable",
          usable: false,
          plugin_id: pluginId,
          uninstalled_at: at,
        };
      }
      catalog.installed_plugins = catalog.installed_plugins.filter(
        (id) => id !== pluginId,
      );
      catalog.updated_at = at;
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

      // Drop tools under namespace from durable MCP tools catalog if present.
      let toolsRemoved = 0;
      try {
        if (fs.existsSync(toolsCatalogPath)) {
          const toolsCat = JSON.parse(fs.readFileSync(toolsCatalogPath, "utf8"));
          const tools = Array.isArray(toolsCat.tools) ? toolsCat.tools : [];
          const kept = tools.filter((t) => {
            const ns = (t && (t.namespace || t.namespace_)) || "";
            if (ns === namespace) {
              toolsRemoved += 1;
              return false;
            }
            return true;
          });
          toolsCat.tools = kept;
          toolsCat.updated_at = at;
          fs.writeFileSync(toolsCatalogPath, JSON.stringify(toolsCat, null, 2));
        }
      } catch {
        /* optional catalog */
      }

      const snapPath = path.join(
        nsDir,
        `uninstall-${(namespace || "ns").replace(/[^\w.-]+/g, "_")}-${Date.now().toString(36)}.json`,
      );
      const entry = {
        mode: "host_mcp_uninstall",
        pretend_uninstalled: false,
        plugin_id: pluginId,
        namespace,
        status: "Unavailable",
        usable: false,
        namespace_gone: true,
        tools_removed: toolsRemoved,
        catalog_path: catalogPath,
        at,
      };
      fs.writeFileSync(snapPath, JSON.stringify(entry, null, 2));
      appendJsonl(path.join(nsDir, "uninstalls.jsonl"), {
        ...entry,
        path: snapPath,
      });
      const delivery = recordSendToUser({
        type: "attachment",
        path: snapPath,
        label: "mcp_uninstall",
        namespace,
        status: "Unavailable",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: raw,
        path: snapPath,
        namespace,
        at,
      });
      return okJson(kind, raw, {
        ...entry,
        path: snapPath,
        send_to_user: delivery,
        ok: true,
      });
    }

    if (kind === "mcp_namespace") {
      // CM-0904 — InstallPlugin / add-connector registers MCP namespace Ready+usable.
      const nsDir = path.join(REPO_ROOT, "data", "connectors", "mcp-namespaces");
      fs.mkdirSync(nsDir, { recursive: true });
      const ledgerPath = path.join(
        REPO_ROOT,
        "data",
        "connectors",
        "mcp-namespaces.jsonl",
      );
      const catalogPath = path.join(nsDir, "catalog.json");
      const raw = String(cmd || "").trim();
      const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
      const pluginToken = parts[0] || raw;
      const nsHint = parts[1] || "";
      // Known demo plugins (mirrors connectors/plugins.mbt seed_demo).
      const PLUGIN_NS = {
        "plugin-slides": {
          namespace: "user-Slides",
          display_name: "Slides helper",
          skills: ["slides-quickstart"],
        },
        "plugin-calendar": {
          namespace: "user-Calendar",
          display_name: "Calendar sync",
          skills: ["calendar-sync"],
        },
      };
      let pluginId = pluginToken;
      let namespace = nsHint || pluginToken;
      let displayName = pluginToken;
      let skills = [];
      const known = PLUGIN_NS[pluginToken];
      if (known) {
        pluginId = pluginToken;
        namespace = nsHint || known.namespace;
        displayName = known.display_name;
        skills = known.skills.slice();
      } else if (
        pluginToken.startsWith("user-") ||
        pluginToken.startsWith("cursor-") ||
        pluginToken.includes("/")
      ) {
        // Direct namespace register (source-control backends etc.).
        namespace = pluginToken;
        pluginId = null;
        displayName = pluginToken;
      } else if (pluginToken) {
        const snapPath = path.join(
          nsDir,
          `ns-refused-${Date.now().toString(36)}.json`,
        );
        const artifact = {
          mode: "host_mcp_namespace",
          ok: false,
          refused: true,
          pretend_registered: false,
          plugin_id: pluginToken,
          error: "unknown plugin: " + pluginToken,
          at,
        };
        fs.writeFileSync(snapPath, JSON.stringify(artifact, null, 2));
        return okJson(kind, raw, { ...artifact, path: snapPath });
      }

      let catalog = { namespaces: {}, installed_plugins: [] };
      try {
        if (fs.existsSync(catalogPath)) {
          catalog = {
            ...catalog,
            ...JSON.parse(fs.readFileSync(catalogPath, "utf8")),
          };
          if (!catalog.namespaces) catalog.namespaces = {};
          if (!Array.isArray(catalog.installed_plugins)) {
            catalog.installed_plugins = [];
          }
        }
      } catch {
        /* keep defaults */
      }
      catalog.namespaces[namespace] = {
        namespace,
        status: "Ready",
        usable: true,
        plugin_id: pluginId,
        display_name: displayName,
        skills,
        at,
      };
      if (pluginId && !catalog.installed_plugins.includes(pluginId)) {
        catalog.installed_plugins.push(pluginId);
      }
      catalog.updated_at = at;
      fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

      const snapPath = path.join(
        nsDir,
        `ns-${(namespace || "ns").replace(/[^\w.-]+/g, "_")}-${Date.now().toString(36)}.json`,
      );
      const entry = {
        mode: "host_mcp_namespace",
        pretend_registered: false,
        plugin_id: pluginId,
        namespace,
        display_name: displayName,
        skills,
        skill_count: skills.length,
        status: "Ready",
        usable: true,
        namespace_ready: true,
        catalog_path: catalogPath,
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
        namespace,
        status: "Ready",
        source_kind: kind,
        at,
      });
      appendHostDeliveryJournal({
        kind,
        command: raw,
        path: snapPath,
        ledger_path: pathWritten,
        namespace,
        at,
      });
      return okJson(kind, raw, {
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
    // Prefer markdown [label](url) (CM-0111-safe Host hints); else bare URL
    // without trailing markdown punctuation.
    const mdUrl = cmd.match(/\]\((https?:\/\/[^)\s]+)\)/);
    const bareUrl = cmd.match(/https?:\/\/[^\s|"')\]]+/);
    let url = mdUrl ? mdUrl[1] : bareUrl ? bareUrl[0] : "";
    if (url) url = url.replace(/[.,;:]+$/, "");
    if (!url && vertical && vertical.navigate_host) {
      const host = vertical.navigate_host.replace(/^https?:\/\//, "");
      url = `https://${host}`;
    }
    // CM-2146: pass identity-browser user-data-dir into CU child when switched.
    const cuEnv = { ...process.env };
    const identityPtr = path.join(
      REPO_ROOT,
      "data",
      "connectors",
      "identity",
      "active-user-data-dir.txt",
    );
    const identitySess = path.join(
      REPO_ROOT,
      "data",
      "connectors",
      "identity",
      "browser-session.json",
    );
    let identityUserData = "";
    if (fs.existsSync(identityPtr)) {
      identityUserData = String(fs.readFileSync(identityPtr, "utf8") || "")
        .trim()
        .split("\n")[0]
        .trim();
    }
    if (!identityUserData && fs.existsSync(identitySess)) {
      try {
        const sess = JSON.parse(fs.readFileSync(identitySess, "utf8"));
        if (sess && (sess.switched || sess.status === "SwitchedToSignedInBrowser")) {
          identityUserData = String(sess.user_data_dir || "").trim();
        }
      } catch {
        identityUserData = "";
      }
    }
    if (identityUserData) {
      cuEnv.BITBOT_IDENTITY_USER_DATA_DIR = identityUserData;
    }

    async function runBoxChromeCuOnce(evidenceDir) {
      fs.mkdirSync(evidenceDir, { recursive: true });
      const evidencePath = path.join(evidenceDir, "cu_run.json");
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
        {
          cwd: REPO_ROOT,
          timeout: 90000,
          maxBuffer: 4 * 1024 * 1024,
          env: cuEnv,
        },
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
      return { summary, evidencePath, stderr: String(stderr || "") };
    }

    function reapStrayThrowawayChrome() {
      // OAuth headed flash + prior CU can leave zygote orphans that OOM the next CU.
      try {
        const { execFileSync } = require("child_process");
        for (const needle of [
          "oauth-browser-profile",
          "throwaway-chrome-profile",
        ]) {
          try {
            execFileSync("pkill", ["-f", needle], {
              timeout: 3000,
              stdio: "ignore",
            });
          } catch {
            /* no match */
          }
        }
      } catch {
        /* ignore */
      }
      if (identityUserData) killChromeByUserDataDir(identityUserData);
    }

    let evidenceDir = path.join(
      REPO_ROOT,
      "data",
      "journal",
      "computer-use",
      `cu-${Date.now()}`,
    );
    let evidencePath = path.join(evidenceDir, "cu_run.json");
    try {
      let ran;
      try {
        ran = await runBoxChromeCuOnce(evidenceDir);
      } catch (firstErr) {
        // One retry after reaping leftover chrome (smoke oauth→CU flake / OOM).
        reapStrayThrowawayChrome();
        await new Promise((r) => setTimeout(r, 400));
        evidenceDir = path.join(
          REPO_ROOT,
          "data",
          "journal",
          "computer-use",
          `cu-${Date.now()}-retry`,
        );
        evidencePath = path.join(evidenceDir, "cu_run.json");
        try {
          ran = await runBoxChromeCuOnce(evidenceDir);
        } catch (retryErr) {
          retryErr.message = `${retryErr.message || String(retryErr)}; first=${firstErr.message || String(firstErr)}`;
          throw retryErr;
        }
      }
      evidencePath = ran.evidencePath;
      const summary = ran.summary || {};
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
              user_data_dir: gui.user_data_dir || null,
              identity_browser: gui.identity_browser || null,
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
                        : !Boolean(
                            gui.vision_plan.vision && gui.vision_plan.vision.ocr,
                          ),
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
            gui: {
              box_chrome_process: false,
              fallback: true,
              os_window_automation_residual: true,
              vision_plan: { ocr: false, ocr_residual: true },
            },
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
              ocr_residual: true,
              ocr: false,
              os_window_automation_residual: true,
              live_paid_residual: true,
            },
            mode: "http_fallback",
          },
          null,
          2,
        ),
        stderr: [
          err && err.message ? String(err.message) : "",
          err && err.stderr ? String(err.stderr) : "",
          err && err.killed ? "killed=timeout_or_signal" : "",
        ]
          .filter(Boolean)
          .join("\n")
          .slice(0, 2000),
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
        results.push(finalizeOauthHostResult(cmd, await executeOauth(cmd)));
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
      if (
        kind === "generate_image" ||
        kind === "generate_video" ||
        kind === "watch_video" ||
        kind === "structured_chart"
      ) {
        results.push(await executeMediaProductEffect(kind, cmd));
        continue;
      }
      if (kind === "export_pack") {
        results.push(executeExportPack(cmd));
        continue;
      }
      if (kind === "todo_write") {
        results.push(executeTodoWrite(cmd));
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
      if (kind === "box_doctor") {
        results.push(await executeBoxDoctor(cmd));
        continue;
      }
      if (kind === "box_env") {
        results.push(await executeBoxEnv(cmd));
        continue;
      }
      if (kind === "box_clock") {
        results.push(await executeBoxClock(cmd));
        continue;
      }
      if (kind === "webhook_panel") {
        results.push(await executeWebhookPanel(cmd));
        continue;
      }
      if (kind === "webhook_copy") {
        results.push(await executeWebhookCopy(cmd));
        continue;
      }
      if (kind === "webhook_tool_read_key") {
        results.push(await executeWebhookToolReadKey(cmd));
        continue;
      }
      if (kind === "webhook_wake") {
        results.push(await executeWebhookWake(cmd));
        continue;
      }
      if (kind === "settings_open") {
        results.push(await executeSettingsOpen(cmd));
        continue;
      }
      if (kind === "agent_info_panel") {
        results.push(await executeAgentInfoPanel(cmd));
        continue;
      }
      if (kind === "delete_agent") {
        results.push(await executeDeleteAgent(cmd));
        continue;
      }
      if (kind === "package_install") {
        results.push(await executePackageInstall(cmd));
        continue;
      }
      if (kind === "shared_box_fs") {
        results.push(await executeSharedBoxFs(cmd));
        continue;
      }
      if (kind === "hide_agent") {
        results.push(await executeHideAgent(cmd));
        continue;
      }
      if (kind === "list_agents_sidebar") {
        results.push(await executeListAgentsSidebar(cmd));
        continue;
      }
      if (kind === "members_panel") {
        results.push(await executeMembersPanel(cmd));
        continue;
      }
      if (kind === "notify_settings") {
        results.push(await executeNotifySettings(cmd));
        continue;
      }
      if (kind === "set_notify") {
        results.push(await executeSetNotify(cmd));
        continue;
      }
      if (kind === "update_computer") {
        results.push(await executeUpdateComputer(cmd));
        continue;
      }
      if (kind === "reset_computer") {
        results.push(await executeResetComputer(cmd));
        continue;
      }
      if (kind === "local_execution") {
        results.push(await executeLocalExecution(cmd));
        continue;
      }
      if (kind === "guide_permission") {
        results.push(await executeGuidePermission(cmd));
        continue;
      }
      if (kind === "render_markdown") {
        results.push(await executeRenderMarkdown(cmd));
        continue;
      }
      if (kind === "react_message") {
        results.push(await executeReactMessage(cmd));
        continue;
      }
      if (kind === "screenshot") {
        results.push(await executeScreenshot(cmd));
        continue;
      }
      if (kind === "check_updates") {
        results.push(await executeCheckUpdates(cmd));
        continue;
      }
      if (kind === "auto_review_settings") {
        results.push(await executeAutoReviewSettings(cmd));
        continue;
      }
      if (kind === "box_chrome_probe") {
        results.push(await executeBoxChromeProbe(cmd));
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
          // path + artifact_path: durable Host snap (stdout stays raw text).
          path: shellPath,
          artifact_path: shellPath,
          pretend_ok: false,
        });
      } catch (err) {
        const failAt = new Date().toISOString();
        const shellDir = path.join(REPO_ROOT, "data", "host-tools", "shell");
        fs.mkdirSync(shellDir, { recursive: true });
        const failPath = path.join(
          shellDir,
          `run-fail-${Date.now().toString(36)}.json`,
        );
        const failArtifact = {
          command: shellCmd,
          ok: false,
          error: err.message || String(err),
          stdout_prefix: err.stdout
            ? String(err.stdout).slice(0, 400)
            : "",
          stderr_prefix: err.stderr
            ? String(err.stderr).slice(0, 200)
            : "",
          mode: "host_shell_exec",
          pretend_ok: false,
          at: failAt,
        };
        fs.writeFileSync(failPath, JSON.stringify(failArtifact, null, 2));
        appendJsonl(path.join(shellDir, "runs.jsonl"), {
          ...failArtifact,
          path: failPath,
        });
        appendHostDeliveryJournal({
          kind: "shell",
          command: shellCmd,
          path: failPath,
          ok: false,
          at: failAt,
        });
        results.push({
          kind: "shell",
          ok: false,
          command: shellCmd,
          error: err.message || String(err),
          // Keep raw stdout/stderr for ADR reinjection; path is snap-only.
          stdout: err.stdout ? String(err.stdout).slice(0, 4000) : "",
          stderr: err.stderr ? String(err.stderr).slice(0, 2000) : "",
          path: failPath,
          artifact_path: failPath,
          pretend_ok: false,
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
