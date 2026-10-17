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

  async function executeChannelSend(command) {
    // command format: "<addr> :: <body>" from MoonBit
    const raw = String(command || "");
    let addr = raw;
    let body = "";
    const sep = " :: ";
    const at = raw.indexOf(sep);
    if (at >= 0) {
      addr = raw.slice(0, at).trim();
      body = raw.slice(at + sep.length);
    }
    const journalPath = appendHostDeliveryJournal({
      kind: "channel_send",
      address: addr,
      body,
      at: new Date().toISOString(),
    });

    // Live Slack when token + BITBOT_SLACK_POST=1
    if (addr.startsWith("slack:")) {
      const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
      const channelId = addr.slice("slack:".length).split(":")[0];
      if (token && process.env.BITBOT_SLACK_POST === "1" && channelId && body) {
        const post = await slackApi("chat.postMessage", token, {
          channel: channelId,
          text: body,
        });
        return {
          kind: "channel_send",
          ok: Boolean(post.ok),
          command: raw,
          stdout: post.ok
            ? `live Slack post ok ts=${post.ts || ""} journal=${journalPath}`
            : "",
          error: post.ok ? "" : `slack post failed: ${post.error || "unknown"}`,
          stderr: "",
        };
      }
      return {
        kind: "channel_send",
        ok: true,
        command: raw,
        stdout: `Slack draft recorded (journal=${journalPath}); live post needs SLACK_BOT_TOKEN + BITBOT_SLACK_POST=1`,
        stderr: "",
      };
    }

    return {
      kind: "channel_send",
      ok: true,
      command: raw,
      stdout: `Host delivery journal: ${journalPath}`,
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

  async function executeHostEffects(effects) {
    const results = [];
    for (const e of effects || []) {
      const kind = (e && e.kind) || "";
      const cmd = String((e && e.command) || "");

      if (kind === "channel_send") {
        results.push(await executeChannelSend(cmd));
        continue;
      }
      if (
        kind === "mail_draft" ||
        kind === "mcp_namespace" ||
        kind === "oauth" ||
        kind === "approval_card" ||
        kind === "mcp_discover" ||
        kind === "mcp_call" ||
        kind === "subagent_run" ||
        kind === "computer_use" ||
        kind === "routine_schedule" ||
        kind === "device_tool" ||
        kind === "voice_session" ||
        kind === "voice_relay" ||
        kind === "voice_end_write" ||
        kind === "teammate_create" ||
        kind === "room_turn" ||
        kind === "send_to_agent" ||
        kind === "cloud_agent_launch" ||
        kind === "cloud_artifact_deliver" ||
        kind === "schedule_meeting" ||
        kind === "purchase" ||
        kind === "finance_call" ||
        kind === "credential_fill" ||
        kind === "mail_draft"
      ) {
        const journalLine = appendHostDeliveryJournal({
          kind,
          command: cmd,
          at: new Date().toISOString(),
        });
        results.push({
          kind,
          ok: true,
          command: cmd,
          stdout: `Host delivery journal: ${journalLine}`,
          stderr: "",
        });
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
