"use strict";

/**
 * Shared MoonBit turn runner + ADR 0002 Host FFI reinjection.
 * Used by Desktop Electron and multi-end CLI host.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createHostFfi } = require("./host_ffi");
const { createProductSession } = require("./agent_loop_product_wire");

/** Kernel child does not need the model key. HTTP stays in the Node host. */
function moonProcessEnv(source) {
  const base = source || process.env;
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (
      key === "BITBOT_LLM_API_KEY" ||
      /^BITBOT_LLM_.+(?:_KEY|_TOKEN|_SECRET)$/i.test(key)
    ) {
      delete env[key];
    }
  }
  const home = base.HOME || process.env.HOME || "";
  const pathEnv = base.PATH || process.env.PATH || "";
  env.PATH = `${home}/.moon/bin:${pathEnv}`;
  // Product FFI is a C stub. The LLVM native backend does not link it.
  env.MOONBIT_NEW_NATIVE = "0";
  return env;
}

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
  const ffi = createHostFfi(repoRoot, { dataRoot: opts.dataRoot });
  const defaultResolveReply = defaultResolveReplyForRoot(repoRoot);
  const MOON_BIN = opts.moonBin || process.env.MOON_BIN || "moon";
  const MOON_TARGET = opts.moonTarget || process.env.BITBOT_MOON_TARGET || "native";
  /* A packaged app ships the compiled kernel instead of a MoonBit
     toolchain. The binary is a drop-in for `moon run cmd/desktop_turn
     --target native -- <args>`: same argv tail, same stdout/stdin FFI
     line protocol (BITBOT_FFI <json> out, one JSON line back in). */
  const KERNEL_BIN = opts.kernelBin || process.env.BITBOT_KERNEL_BIN || null;
  /* The kernel writes `data/workspace/uploads/...` relative to its cwd, so
     the cwd must be the PARENT of the data root. Dev: <repo>. Packaged:
     <userData>. */
  const KERNEL_CWD = ffi.DATA_ROOT ? path.dirname(ffi.DATA_ROOT) : ffi.REPO_ROOT;
  const kernelPrefix = () =>
    KERNEL_BIN ? [] : ["run", "cmd/desktop_turn", "--target", MOON_TARGET, "--"];
  const kernelExe = () => KERNEL_BIN || MOON_BIN;

  function runMoon(args, { timeoutMs = 120000 } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(kernelExe(), args, {
        cwd: KERNEL_CWD,
        env: moonProcessEnv(),
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

  function kernelLoopTrace(stderr) {
    const kernelOps = [];
    let entry = false;
    for (const raw of String(stderr || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "BITBOT_LOOP entry=AgentLoop::run") entry = true;
      if (line.startsWith("BITBOT_LOOP op=")) {
        kernelOps.push(line.slice("BITBOT_LOOP op=".length).trim());
      }
    }
    return { entry, kernelOps };
  }

  /**
   * Read one kernel FFI request, write one JSON response. Line splitting only.
   */
  function pumpMoonFfi(args, onFfi, opts = {}) {
    const timeoutMs = opts.timeoutMs || 180000;
    const onLoop = typeof opts.onLoop === "function" ? opts.onLoop : null;
    return new Promise((resolve, reject) => {
      const child = spawn(kernelExe(), args, {
        cwd: KERNEL_CWD,
        env: moonProcessEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let buf = "";
      let stderrCarry = "";
      let chain = Promise.resolve();
      const emitLoopLines = (chunk) => {
        stderrCarry += chunk;
        let nl = stderrCarry.indexOf("\n");
        while (nl >= 0) {
          const line = stderrCarry.slice(0, nl).replace(/\r$/, "").trim();
          stderrCarry = stderrCarry.slice(nl + 1);
          if (onLoop && line.startsWith("BITBOT_LOOP ")) {
            try {
              onLoop(line);
            } catch (_) {
              /* projection must not break the kernel exchange */
            }
          }
          nl = stderrCarry.indexOf("\n");
        }
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`moon timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const takeLine = (line) => {
        if (line.startsWith("BITBOT_FFI ")) {
          const payload = line.slice("BITBOT_FFI ".length);
          chain = chain.then(async () => {
            let res;
            try {
              res = await onFfi(JSON.parse(payload));
            } catch (err) {
              res = {
                content: "",
                calls: [],
                output: "",
                verdict: "deny",
                error: String((err && err.message) || err),
              };
            }
            if (child.stdin && !child.stdin.destroyed) {
              child.stdin.write(JSON.stringify(res) + "\n");
            }
          });
          return;
        }
        stdout += line + "\n";
      };
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        let nl = buf.indexOf("\n");
        while (nl >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          takeLine(line);
          nl = buf.indexOf("\n");
        }
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        emitLoopLines(text);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        chain.then(() => {
          clearTimeout(timer);
          if (buf.trim()) stdout += buf + "\n";
          if (code !== 0) {
            reject(
              new Error(
                `moon exited ${code}\n${stderr || stdout || "(no output)"}`.trim(),
              ),
            );
            return;
          }
          resolve({ stdout, stderr, ...kernelLoopTrace(stderr) });
        }).catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
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
      ...kernelPrefix(),
      // GP-112: seeds (and --bot-id) come from this Bot's slot only.
      ...ffi.memorySeedArgs(ctx.botId),
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

    const nodeOps = [];
    // GP-14：AgentLoop 在回合内（第一跳）就要把被引用的原文带给模型，所以回复
    // 目标必须在 kernel 启动前解析；回合结束后不再重复解析同一份。
    const preResolveReply =
      typeof ctx.resolveReply === "function" ? ctx.resolveReply : defaultResolveReply;
    let preReplyQuote = null;
    if (ctx.replyTo) {
      try {
        const hit = preResolveReply(String(ctx.replyTo)) || {};
        preReplyQuote = {
          message_id: String(ctx.replyTo),
          resolved: Boolean(hit.ok),
          role: hit.role || "",
          text: hit.ok ? String(hit.text || "") : "",
          error: hit.ok ? "" : String(hit.error || "message_not_found"),
        };
      } catch (err) {
        preReplyQuote = {
          message_id: String(ctx.replyTo),
          resolved: false,
          role: "",
          text: "",
          error: "resolve_failed:" + (err && err.message ? err.message : String(err)),
        };
      }
    }
    const productWire = createProductSession(ffi, {
      botId: ctx.botId,
      // K-2/C-3: the device this turn came from decides how much the model
      // may do without asking. "limited" = a mobile client or a remote
      // inbound turn — the person asking is not at the machine.
      deviceTrust: String(ctx.deviceTrust || "trusted"),
      subject: String(ctx.botId || ""),
      roomContext: ctx.roomContext || null,
      turnId: String(ctx.turnId || ""),
      cliApproved: ctx.cliApproved === true,
      approvalGate: ctx.approvalGate || null,
      requestApproval: ctx.requestApproval,
      replyTo: String(ctx.replyTo || ""),
      replyQuote: (preReplyQuote && preReplyQuote.resolved && preReplyQuote.text) || "",
      replyRole: (preReplyQuote && preReplyQuote.role) || "assistant",
    });
    const session = await pumpMoonFfi(
      moonArgs,
      async (req) => {
        const op = String((req && req.op) || "");
        nodeOps.push(op);
        if (typeof ctx.isCancelled === "function" && ctx.isCancelled()) {
          return { cancel: true, content: "", calls: [], output: "", verdict: "deny" };
        }
        const pending = productWire.dispatch(req);
        const guarded = pending.catch((err) => {
          if (typeof ctx.isCancelled === "function" && ctx.isCancelled()) {
            return { cancel: true, content: "", calls: [], output: "", verdict: "deny" };
          }
          throw err;
        });
        if (!ctx.cancelPromise) return guarded;
        return Promise.race([
          guarded,
          ctx.cancelPromise.then(() => ({
            cancel: true,
            content: "",
            calls: [],
            output: "",
            verdict: "deny",
          })),
        ]);
      },
      {
        timeoutMs: ctx.timeoutMs || 180000,
        onLoop: ctx.onLoop,
      },
    );
    const { stdout, stderr } = session;
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
    parsed.loop_trace = {
      entry: Boolean(session.entry),
      kernel_ops: session.kernelOps || [],
      node_ops: nodeOps,
    };
    // GP-165：AgentLoop 的出口诚实化。内核的 stop 只有 Final / MaxSteps /
    // Cancelled，没有「Host 模型调用失败」这一档；失败时它只是 Final 地把空
    // 文本收尾。Host 知道真实原因，就在这里把 ok 改回 false 并带上原因 ——
    // 否则一次 provider 500 会被下游（尤其群协作）当成一次成功回复。
    if (
      parsed &&
      parsed.agent_loop === true &&
      productWire &&
      productWire.state &&
      productWire.state.llmError
    ) {
      parsed.ok = false;
      parsed.error = String(productWire.state.llmError);
      parsed.host_llm_failed = true;
    }
    // Prove-only. Product Desktop does not set this, so kernel stderr stays off the UI.
    if (String(process.env.BITBOT_PP_CAPTURE_STDERR || "") === "1") {
      parsed.loop_trace.stderr = stderr;
    }

    if (
      parsed &&
      parsed.ok &&
      parsed.intent === "memory_update" &&
      Array.isArray(parsed.memory) &&
      parsed.memory.length
    ) {
      // GP-112: write back into the same Bot slot the seeds came from. Only
      // `memory_update` persists — a recall returns the profile plus a demo row
      // when the slot is empty, and writing that back would seed a Bot with a
      // preference it never learned.
      ffi.saveSessionMemory(ctx.botId, parsed.memory);
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
    let replyQuote = preReplyQuote;
    if (!replyQuote && parsed && parsed.reply_to && typeof resolveReply === "function") {
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
    }
    if (replyQuote && parsed) parsed.reply_quote = replyQuote;

    // 「有 effect」和「要回灌内核」是**两件事**。
    //
    // 之前这两件事共用一个门(`parsed.needs_host_ffi`),而产品 AgentLoop 路径
    // 把它设成了 false —— 于是 **A 类 effect 从来没被 Host 执行过**。
    // 内核自己能做的(create_teammate)看着正常;但只有 Host 能做的
    // (routine_schedule —— 持久化在 Host 的文件里)就是**静默失效**:
    // 模型说「已排上」,排程根本没建。
    //
    // 现在:effect 一律执行;**只有内核明确要求时**才回灌结果给它。
    if (
      parsed &&
      Array.isArray(parsed.effects) &&
      parsed.effects.length
    ) {
      // Replica C6: when this turn asked for web search, resolve real sources
      // first so they ride into llm_chat's context and get cited in the reply.
      let searchPayload = null;
      if (ctx.search && parsed.effects.some((e) => e && e.kind === "llm_chat")) {
        try {
          const sr = await ffi.webSearch(text, { topN: 5 });
          if (sr && sr.ok && Array.isArray(sr.sources) && sr.sources.length) {
            searchPayload = { enabled: true, ok: true, provider: sr.provider, sources: sr.sources };
          } else if (sr) {
            searchPayload = { enabled: true, ok: false, error: sr.error || "search_failed", sources: [] };
          }
        } catch (err) {
          searchPayload = { enabled: true, ok: false, error: err.message || String(err), sources: [] };
        }
        if (searchPayload) parsed.search = searchPayload;
      }
      const host_results = await ffi.executeHostEffects(parsed.effects, {
        approved: Boolean(ctx.approved),
        botId: ctx.botId,
        // GP-96/97: §5.7 progress events stream out of the real effect
        // boundaries; hosts pass a listener (Electron broadcast / CLI stderr).
        onProgress: typeof ctx.onProgress === "function" ? ctx.onProgress : undefined,
        turnId: String(parsed.turn_id || ctx.turnId || "host-cont"),
        sessionId: String(ctx.sessionId || ""),
        // GP-148 §1-J3：群上下文是 Host 侧事实（rooms.json + bots.json + 本轮路由），
        // 内核不参与拼装，只负责把这个对象原样转交给 llm_chat 效果。DM 不传 → null。
        roomContext: ctx.roomContext || null,
        // GP-154「定时任务在群内部」：回合来自哪个群就归给哪个群（可选，
        // DM 不传 → 空串，效果与改之前完全一致）。
        roomId: String(ctx.roomId || ""),
        // Q-5: 投递 id —— 同一次投递重试 ⇒ 同一个 id ⇒ 幂等;用户再发一遍 ⇒
        // 新 id ⇒ 新的任务。没有它就现生成(每次进入 = 一条新消息)。
        messageId: String(ctx.messageId || ""),
        replyTo: (replyQuote && replyQuote.message_id) || "",
        replyQuote:
          (replyQuote && replyQuote.resolved && replyQuote.text) || "",
        replyRole: (replyQuote && replyQuote.role) || "assistant",
        searchSources:
          searchPayload && searchPayload.ok && searchPayload.sources.length
            ? searchPayload.sources
            : null,
      });
      parsed.host_results = host_results;
      // 回灌内核只在内核**要求**时做(legacy 意图路径)。
      // AgentLoop 路径的最终答复已经交付了,再回灌一次只会多跑一轮模型。
      if (parsed.needs_host_ffi) {
      try {
        const contArgs = [
          ...kernelPrefix(),
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
    }

    // GP-21/GP-36：只有 legacy 单效果计划需要这一次「守卫式重跑」——always-allow
    // 之后要把同一个 pattern 真的执行掉。AgentLoop 回合的审批在它自己的循环里
    // 完成，绝不从这里再进模型（那会把一次审批变成第二次推理）。
    // （BITBOT_LEGACY_GUARDED_RERUN 开关从 PR 链带进来时默认关闭，直接套用会让
    //  Always allow 只记决定不执行；这里按计划类型判定，不再门控于该环境变量。）
    if (
      parsed &&
      parsed.agent_loop !== true &&
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

    // K-6: 落一条可回放的回合记录。
    // 失败不能影响这一回合的结果 —— 记录是诊断材料,不是业务数据。
    try {
      writeTurnTrace(parsed, text, ctx);
    } catch (_) {
      /* 记录写不下去也不能让回合失败 */
    }

    return parsed;
  }

  /**
   * K-6:每回合一条 trace(可回放)。
   *
   * 记什么:这回合的输入、工具序列(名字/参数/结果摘要/耗时)、最终交付、
   * 停止原因。**模型的决定被记录,但不可重放**(provider 不确定)——
   * 可重放的是**工具序列**:拿这条记录驱动一个新回合,工具序列必须一样。
   *
   * 脱敏:整条记录过一遍(模式级 token 形状 + 环境值级)。仓库铁律是
   * 「私钥/密钥不进日志/artifact」—— trace 就是 artifact。
   */
  function writeTurnTrace(parsed, userText, ctx) {
    const rows = Array.isArray(parsed && parsed.agent_traces) ? parsed.agent_traces : [];
    if (!rows.length) return null;
    const dataRoot = ffi.DATA_ROOT;
    if (!dataRoot) return null;
    const dir = path.join(dataRoot, "traces");
    fs.mkdirSync(dir, { recursive: true });
    const turnId = String((parsed && parsed.turn_id) || (ctx && ctx.turnId) || "turn");
    const file = path.join(dir, turnId.replace(/[^A-Za-z0-9._-]/g, "_") + ".json");
    const trace = {
      version: 1,
      turn_id: turnId,
      session_id: String((parsed && parsed.session_id) || (ctx && ctx.sessionId) || ""),
      bot_id: String((ctx && ctx.botId) || ""),
      machine_id: String((parsed && parsed.machine_id) || (ctx && ctx.machineId) || ""),
      machine_kind: String((parsed && parsed.machine_kind) || (ctx && ctx.machineKind) || ""),
      channel: String((parsed && parsed.channel) || (ctx && ctx.channel) || ""),
      at: new Date().toISOString(),
      ok: Boolean(parsed && parsed.ok !== false),
      intent: String((parsed && parsed.intent) || ""),
      agent_stop: String((parsed && parsed.agent_stop) || ""),
      agent_steps: Number((parsed && parsed.agent_steps) || 0),
      agent_llm: Number((parsed && parsed.agent_llm) || 0),
      agent_exec: Number((parsed && parsed.agent_exec) || 0),
      agent_approval: Number((parsed && parsed.agent_approval) || 0),
      user_text: String(userText || ""),
      assistant_text: ((parsed && parsed.messages) || [])
        .filter((m) => m && m.role === "assistant" && m.text)
        .map((m) => String(m.text))
        .join("\n"),
      tools: rows.map((t) => ({
        tool_name: String((t && t.tool_name) || ""),
        args_json: String((t && t.args_json) || ""),
        result_snippet: String((t && t.result_snippet) || ""),
        duration_ms: Number((t && t.duration_ms) || 0),
        exit_code: Number((t && t.exit_code) || 0),
        error: Boolean(t && t.error),
        timestamp: String((t && t.timestamp) || ""),
      })),
    };
    fs.writeFileSync(file, JSON.stringify(scrubTrace(trace), null, 2));
    return file;
  }

  /** trace 是 artifact —— 密钥不许进来。 */
  function scrubTrace(value) {
    const p0 = require("./p0_security");
    let secretProtocol = null;
    try { secretProtocol = require("../desktop/secret_protocol"); }
    catch {
      try { secretProtocol = require("../../hosts/desktop/secret_protocol"); }
      catch {
        try { secretProtocol = require("../secret_protocol"); }
        catch { secretProtocol = null; }
      }
    }
    const walk = (v) => {
      if (v == null) return v;
      if (typeof v === "string") {
        let out = v;
        if (secretProtocol && Array.isArray(secretProtocol.TOKEN_RULES)) {
          for (const rule of secretProtocol.TOKEN_RULES) {
            if (rule && rule.re) {
              out = out.replace(new RegExp(rule.re.source, "g"), secretProtocol.REDACTED || "[REDACTED]");
            }
          }
        }
        return p0.scrubSecrets(out);
      }
      if (Array.isArray(v)) return v.map(walk);
      if (typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v)) out[k] = walk(v[k]);
        return out;
      }
      return v;
    };
    return walk(value);
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

  // 把自己注册给 FFI:群回合的扇出需要一个「懂群上下文」的 runner
  // (host_ffi 里的嵌套 worker 回合不懂)。依赖方向只能是这一条 ——
  // host_ffi 不能反过来 require 这个模块。
  if (ffi && typeof ffi.setTurnRunner === "function") {
    ffi.setTurnRunner(runTurn);
  }

  return { runTurn, bootBanner, ffi, runMoon, lastJsonLine, MOON_TARGET };
}

module.exports = { createTurnRunner, moonProcessEnv };
