"use strict";

/**
 * Shared MoonBit turn runner + ADR 0002 Host FFI reinjection.
 * Used by Desktop Electron and multi-end CLI host.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createHostFfi } = require("./host_ffi");

/** GP-14 fallback resolver: read data/desktop/sessions.json straight from disk. */
function defaultResolveReplyForRoot(repoRoot) {
  return (id) => {
    const want = String(id || "").trim();
    if (!want) return { ok: false, error: "empty message id" };
    const p = path.join(
      path.resolve(repoRoot),
      "data",
      "desktop",
      "sessions.json",
    );
    let state;
    try {
      state = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return { ok: false, error: "session_store_unreadable" };
    }
    for (const s of state.sessions || []) {
      const hit = (s.messages || []).find((m) => m && String(m.id) === want);
      if (hit) {
        return {
          ok: true,
          id: hit.id,
          session_id: s.id,
          role: hit.role,
          text: String(hit.text || ""),
        };
      }
    }
    return { ok: false, error: "message_not_found", message_id: want };
  };
}

function createTurnRunner(repoRoot, opts = {}) {
  const ffi = createHostFfi(repoRoot);
  const defaultResolveReply = defaultResolveReplyForRoot(repoRoot);
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
   *   botId?: string,
   *   replyTo?: string,
   *   resolveReply?: (id: string) => {ok:boolean, text?:string, role?:string},
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
    // GP-14: the replied-to message id travels into the kernel context.
    if (ctx.replyTo) {
      moonArgs.push("--reply-to", String(ctx.replyTo));
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

    // GP-14: resolve the id the kernel echoed into a real quoted text, then hand
    // it to llm_chat. An unresolved id is reported as reply_quote.resolved:false
    // rather than silently dropped (the UI can say "引用消息未找到").
    // Desktop injects sessions.findMessage; CLI/other hosts fall back to reading
    // the same store from disk so both ends resolve the identical quote.
    const resolveReply =
      typeof ctx.resolveReply === "function"
        ? ctx.resolveReply
        : defaultResolveReply;
    let replyQuote = null;
    if (parsed && parsed.reply_to && typeof resolveReply === "function") {
      try {
        const hit = resolveReply(String(parsed.reply_to)) || {};
        replyQuote = {
          message_id: String(parsed.reply_to),
          resolved: Boolean(hit.ok),
          role: hit.role || "",
          text: hit.ok ? String(hit.text || "") : "",
          error: hit.ok ? "" : String(hit.error || "message_not_found"),
        };
      } catch (err) {
        replyQuote = {
          message_id: String(parsed.reply_to),
          resolved: false,
          text: "",
          error:
            "resolve_failed:" + (err && err.message ? err.message : String(err)),
        };
      }
      parsed.reply_quote = replyQuote;
    }

    if (
      parsed &&
      parsed.needs_host_ffi &&
      Array.isArray(parsed.effects) &&
      parsed.effects.length
    ) {
      const host_results = await ffi.executeHostEffects(parsed.effects, {
        approved: Boolean(ctx.approved),
        botId: ctx.botId,
        replyTo: (replyQuote && replyQuote.message_id) || "",
        replyQuote:
          (replyQuote && replyQuote.resolved && replyQuote.text) || "",
        replyRole: (replyQuote && replyQuote.role) || "assistant",
      });
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
        if (ctx.replyTo) {
          contArgs.push("--reply-to", String(ctx.replyTo));
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
