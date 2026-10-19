"use strict";

/**
 * Shared MoonBit turn runner + ADR 0002 Host FFI reinjection.
 * Used by Desktop Electron and multi-end CLI host.
 */

const { spawn } = require("child_process");
const { createHostFfi } = require("./host_ffi");

function createTurnRunner(repoRoot, opts = {}) {
  const ffi = createHostFfi(repoRoot);
  const MOON_BIN = opts.moonBin || process.env.MOON_BIN || "moon";
  const MOON_TARGET = opts.moonTarget || process.env.BITBOT_MOON_TARGET || "native";

  function runMoon(args, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(MOON_BIN, args, {
        cwd: ffi.REPO_ROOT,
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

  /**
   * @param {string} userText
   * @param {{
   *   sessionId?: string,
   *   machineId?: string,
   *   machineKind?: string,
   *   channel?: string,
   *   turnId?: string,
   *   approved?: boolean,
   * }} ctx
   */
  async function runTurn(userText, ctx = {}) {
    const text = String(userText || "").trim();
    if (!text) {
      return { ok: false, error: "empty text" };
    }
    const moonArgs = [
      "run",
      "cmd/desktop_turn",
      "--target",
      MOON_TARGET,
      "--",
      ...ffi.memorySeedArgs(),
    ];
    if (ctx.sessionId) {
      moonArgs.push("--session-id", String(ctx.sessionId));
    }
    if (ctx.machineId) {
      moonArgs.push("--machine-id", String(ctx.machineId));
    }
    if (ctx.machineKind) {
      moonArgs.push("--machine-kind", String(ctx.machineKind));
    }
    if (ctx.channel) {
      moonArgs.push("--channel", String(ctx.channel));
    }
    if (ctx.turnId) {
      moonArgs.push("--turn-id", String(ctx.turnId));
    }
    if (ctx.approved) {
      moonArgs.push("--approved");
    }
    moonArgs.push(text);

    const { stdout, stderr } = await runMoon(moonArgs);
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

    if (parsed && parsed.ok && Array.isArray(parsed.memory) && parsed.memory.length) {
      ffi.saveSessionMemory(parsed.memory);
    }

    if (
      parsed &&
      parsed.needs_host_ffi &&
      Array.isArray(parsed.effects) &&
      parsed.effects.length
    ) {
      const host_results = await ffi.executeHostEffects(parsed.effects, { approved: Boolean(ctx.approved) });
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
          String(parsed.turn_id || ctx.turnId || "host-cont"),
          "--prior-text",
          ffi.encodeHostArg(text),
        ];
        if (ctx.sessionId) {
          contArgs.push("--session-id", String(ctx.sessionId));
        }
        if (ctx.machineId) {
          contArgs.push("--machine-id", String(ctx.machineId));
        }
        if (ctx.machineKind) {
          contArgs.push("--machine-kind", String(ctx.machineKind));
        }
        if (ctx.channel) {
          contArgs.push("--channel", String(ctx.channel));
        }
        for (let i = 0; i < host_results.length; i++) {
          if (i > 0) contArgs.push("--result-next");
          const hr = host_results[i];
          contArgs.push(
            "--result-ok",
            hr.ok ? "true" : "false",
            "--result-kind",
            String(hr.kind || "shell"),
            "--result-command",
            ffi.encodeHostArg(hr.command || ""),
            "--result-stdout",
            ffi.encodeHostArg(hr.stdout || ""),
            "--result-stderr",
            ffi.encodeHostArg(hr.stderr || ""),
            "--result-error",
            ffi.encodeHostArg(hr.error || ""),
          );
        }
        const cont = await runMoon(contArgs);
        const contRaw = lastJsonLine(cont.stdout || cont.stderr);
        const continued = JSON.parse(contRaw);
        if (continued && continued.ok) {
          parsed.messages = Array.isArray(parsed.messages)
            ? parsed.messages.slice()
            : [];
          for (const m of continued.messages || []) {
            if (m && m.role === "assistant") parsed.messages.push(m);
          }
          parsed.host_continued = true;
          parsed.needs_host_ffi = false;
          parsed.intent_continued = continued.intent;
          // Prefer continued context fields when present
          if (continued.session_id) parsed.session_id = continued.session_id;
          if (continued.machine_id) parsed.machine_id = continued.machine_id;
          if (continued.machine_kind) parsed.machine_kind = continued.machine_kind;
          if (continued.channel) parsed.channel = continued.channel;
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
        for (const hr of host_results) {
          if (hr.ok) {
            parsed.messages.push({
              role: "assistant",
              text: `Host FFI ${hr.kind} \`${hr.command || ""}\`:\n\`\`\`\n${(hr.stdout || "").trim() || "(no stdout)"}\n\`\`\``,
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

    // Wave G GP-21/GP-36: kernel asked, Host auto-review says allow → execute
    // the original request once with --approved (one guarded re-run, no loops).
    if (
      parsed &&
      parsed.ok &&
      !ctx.approved &&
      Array.isArray(parsed.host_results) &&
      parsed.host_results.some((h) => h && h.kind === "approval_card" && h.ok && h.mode === "host_approval_card_auto")
    ) {
      try {
        const autoRerun = await runTurn(text, { ...ctx, approved: true, turnId: (parsed.turn_id || "turn") + "-auto" });
        parsed.auto_approved = true;
        parsed.auto_approved_via = (() => {
          const h = parsed.host_results.find((x) => x && x.mode === "host_approval_card_auto");
          try { return JSON.parse(h.stdout).auto_via; } catch { return null; }
        })();
        if (autoRerun && Array.isArray(autoRerun.host_results)) {
          parsed.host_results = parsed.host_results.concat(autoRerun.host_results);
        }
        parsed.messages = Array.isArray(parsed.messages) ? parsed.messages.slice() : [];
        parsed.messages.push({
          role: "assistant",
          text:
            "Auto-review 命中（" + (parsed.auto_approved_via || "approval_rule") +
            "）：已按 Always-allow 规则自动执行，未再次询问。",
        });
        if (autoRerun && autoRerun.assistant !== undefined) parsed.assistant = autoRerun.assistant;
        if (autoRerun && autoRerun.effects) parsed.effects_after_auto = autoRerun.effects;
      } catch (err) {
        parsed.messages = Array.isArray(parsed.messages) ? parsed.messages.slice() : [];
        parsed.messages.push({
          role: "assistant",
          text: `Auto-allow re-run failed: ${err.message || String(err)}`,
        });
      }
    }
    // GP-36 never-mode: card refused → do NOT re-run; say so honestly.
    if (
      parsed &&
      parsed.ok &&
      Array.isArray(parsed.host_results) &&
      parsed.host_results.some((h) => h && h.mode === "host_approval_card_refused")
    ) {
      parsed.messages = Array.isArray(parsed.messages) ? parsed.messages.slice() : [];
      parsed.messages.push({
        role: "assistant",
        text: "Local execution = Never allow：该操作被你的设置直接拒绝，未执行。",
      });
    }

    return parsed;
  }

  async function bootBanner() {
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
      note: "Product brain is MoonBit. Multi-end Host FFI via hosts/shared.",
    };
  }

  return { runTurn, bootBanner, ffi, runMoon, lastJsonLine, MOON_TARGET };
}

module.exports = { createTurnRunner };
