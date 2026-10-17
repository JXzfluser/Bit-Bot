"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, "../..");
const MOON_BIN = process.env.MOON_BIN || "moon";
const MOON_TARGET = process.env.BITBOT_MOON_TARGET || "native";
const fs = require("fs");
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

/** Dangerous patterns — Host FFI refuse (Grok-like irreversible gate). */
const SHELL_DENY =
  /\brm\s+-rf\s+\/|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|:;\s*\}|shutdown|reboot|fork\s*bomb/i;

function isDeniedShell(cmd) {
  return SHELL_DENY.test(String(cmd || ""));
}

/**
 * Execute MoonBit-planned Host effects (FFI only — no LocalBrain).
 * @param {Array<{kind?: string, command?: string}>} effects
 */
async function executeHostEffects(effects) {
  const results = [];
  for (const e of effects || []) {
    const kind = (e && e.kind) || "";
    // Channel / mail / MCP / OAuth: Host records delivery journal (live APIs when creds exist).
    if (
      kind === "channel_send" ||
      kind === "mail_draft" ||
      kind === "mcp_namespace" ||
      kind === "oauth"
    ) {
      const cmd = String((e && e.command) || "");
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
    if (kind !== "shell") {
      results.push({
        kind,
        ok: false,
        error: `unsupported effect kind: ${kind || "(empty)"}`,
      });
      continue;
    }
    const cmd = String((e && e.command) || "").trim();
    if (!cmd) {
      results.push({ kind: "shell", ok: false, error: "empty command" });
      continue;
    }
    if (isDeniedShell(cmd)) {
      results.push({
        kind: "shell",
        ok: false,
        command: cmd,
        error: "refused: irreversible/dangerous shell (Host gate)",
      });
      continue;
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        "/bin/bash",
        ["-lc", cmd],
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
        command: cmd,
        stdout: String(stdout || "").slice(0, 8000),
        stderr: String(stderr || "").slice(0, 2000),
      });
    } catch (err) {
      results.push({
        kind: "shell",
        ok: false,
        command: cmd,
        error: err.message || String(err),
        stdout: err.stdout ? String(err.stdout).slice(0, 4000) : "",
        stderr: err.stderr ? String(err.stderr).slice(0, 2000) : "",
      });
    }
  }
  return results;
}

function runMoon(args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(MOON_BIN, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${process.env.HOME || ""}/.moon/bin:${process.env.PATH || ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`moon timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `moon exited ${code}\n${stderr || stdout || "(no output)"}`.trim(),
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function lastJsonLine(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.startsWith("{") && line.endsWith("}")) {
      return line;
    }
  }
  return text.trim();
}

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

ipcMain.handle("bitbot:boot", async () => {
  const { stdout, stderr } = await runMoon([
    "run",
    "cmd/main",
    "--target",
    MOON_TARGET,
  ]);
  return {
    ok: true,
    banner: stdout.trim() || stderr.trim(),
    target: MOON_TARGET,
    note: "Product brain is MoonBit. Wasm alt: BITBOT_MOON_TARGET=wasm",
  };
});

ipcMain.handle("bitbot:turn", async (_event, text) => {
  const userText = String(text || "").trim();
  if (!userText) {
    return { ok: false, error: "empty text" };
  }
  const { stdout, stderr } = await runMoon([
    "run",
    "cmd/desktop_turn",
    "--target",
    MOON_TARGET,
    "--",
    ...memorySeedArgs(),
    userText,
  ]);
  const raw = lastJsonLine(stdout || stderr);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON from MoonBit: ${err.message}`,
      raw,
      stderr: stderr.trim(),
    };
  }
  // Persist MoonBit memory snapshot for next turn (Host disk; kernel stays pure).
  if (parsed && parsed.ok && Array.isArray(parsed.memory) && parsed.memory.length) {
    saveSessionMemory(parsed.memory);
  }
  // Host FFI: MoonBit plans effects; Desktop executes; results re-injected
  // into MoonBit via --apply-host-results (ADR 0002 TurnEvent 回注).
  if (parsed && parsed.needs_host_ffi && Array.isArray(parsed.effects) && parsed.effects.length) {
    const host_results = await executeHostEffects(parsed.effects);
    parsed.host_results = host_results;
    try {
      const contArgs = [
        "run",
        "cmd/desktop_turn",
        "--target",
        MOON_TARGET,
        "--",
        "--apply-host-results",
        "--turn-id",
        String(parsed.turn_id || "desktop-host-cont"),
        "--prior-text",
        encodeHostArg(userText),
      ];
      for (let i = 0; i < host_results.length; i++) {
        if (i > 0) contArgs.push("--result-next");
        const hr = host_results[i];
        contArgs.push(
          "--result-ok",
          hr.ok ? "true" : "false",
          "--result-kind",
          String(hr.kind || "shell"),
          "--result-command",
          encodeHostArg(hr.command || ""),
          "--result-stdout",
          encodeHostArg(hr.stdout || ""),
          "--result-stderr",
          encodeHostArg(hr.stderr || ""),
          "--result-error",
          encodeHostArg(hr.error || ""),
        );
      }
      const cont = await runMoon(contArgs);
      const contRaw = lastJsonLine(cont.stdout || cont.stderr);
      const continued = JSON.parse(contRaw);
      if (continued && continued.ok) {
        parsed.messages = Array.isArray(parsed.messages)
          ? parsed.messages.slice()
          : [];
        const contMsgs = Array.isArray(continued.messages)
          ? continued.messages
          : [];
        for (const m of contMsgs) {
          if (m && m.role === "assistant") {
            parsed.messages.push(m);
          }
        }
        parsed.host_continued = true;
        parsed.needs_host_ffi = false;
        parsed.intent_continued = continued.intent;
      } else {
        parsed.messages = Array.isArray(parsed.messages)
          ? parsed.messages.slice()
          : [];
        parsed.messages.push({
          role: "assistant",
          text: `Host FFI continue failed: ${(continued && continued.error) || contRaw}`,
        });
      }
    } catch (err) {
      parsed.messages = Array.isArray(parsed.messages)
        ? parsed.messages.slice()
        : [];
      parsed.messages.push({
        role: "assistant",
        text: `Host FFI continue error: ${err.message || String(err)}`,
      });
      // Fallback: surface raw host stdout so the user still sees effect output.
      for (const hr of host_results) {
        if (hr.ok) {
          parsed.messages.push({
            role: "assistant",
            text: `Host FFI shell \`${hr.command}\`:\n\`\`\`\n${(hr.stdout || "").trim() || "(no stdout)"}\n\`\`\``,
          });
        } else {
          parsed.messages.push({
            role: "assistant",
            text: `Host FFI refused/failed: ${hr.error || "unknown"}${hr.command ? ` (${hr.command})` : ""}`,
          });
        }
      }
    }
  }
  return parsed;
});

/** Encode newlines/tabs for MoonBit unescape_host_arg. */
function encodeHostArg(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

/** Host-persisted profile memory for MoonBit --seed-memory (session scope). */
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
