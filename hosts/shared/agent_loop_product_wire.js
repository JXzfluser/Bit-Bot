"use strict";

const fs = require("fs");
const path = require("path");
const { canonicalAction } = require("./host_approval_gate");

/**
 * One Host FFI op for the kernel AgentLoop.
 * The kernel owns think → call → observe. This file does not call the model
 * again when a reply contains tool calls.
 */

function readBounded(ffi, rel) {
  if (!ffi || !ffi.REPO_ROOT) return "read: path not found";
  const root = path.resolve(String(ffi.REPO_ROOT));
  const target = path.resolve(root, String(rel || ""));
  if (target !== root && !target.startsWith(root + path.sep)) {
    return "read: path not found";
  }
  try {
    return fs.readFileSync(target, "utf8");
  } catch (_) {
    return "read: path not found";
  }
}

function readFixtures() {
  try {
    const parsed = JSON.parse(process.env.BITBOT_LOOP_READ_JSON || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function approvalMode() {
  const mode = String(process.env.BITBOT_LOOP_APPROVAL || "deny");
  if (mode === "allow" || mode === "cancel") return mode;
  return "deny";
}

function canonProductTool(name) {
  const n = String(name || "");
  if (n === "webSearch" || n === "WebSearch" || n === "search_web" || n === "searchWeb") {
    return "web_search";
  }
  if (n === "webFetch" || n === "WebFetch" || n === "open_url" || n === "openUrl") {
    return "web_fetch";
  }
  if (n === "sendMail" || n === "SendMail" || n === "send_mail" || n === "mail_send") {
    return "send_mail";
  }
  return n;
}

/**
 * C-2 B-class product tools. The Host runs these SYNCHRONOUSLY, so the model
 * observes the REAL result — a search that found nothing, a fetch that was
 * blocked, a mail that had no credential — instead of a promise the Host may
 * later fail to keep.
 *
 * Nothing here invents success. Every failure path reports the real reason.
 */
async function execHostProductTool(name, args, argsJson, state) {
  const tool = canonProductTool(name);
  if (tool === "web_search") {
    const query = String(args.query || args.q || "").trim();
    if (!query) {
      return { output: JSON.stringify({ ok: false, error: "empty_query", sources: [] }) };
    }
    const topN = Math.min(5, Math.max(1, Number(args.topN || args.top_n) || 5));
    let res = null;
    try {
      res = await state.ffi.webSearch(query, { topN });
    } catch (err) {
      return {
        output: JSON.stringify({
          ok: false,
          error: String((err && err.message) || err).slice(0, 200),
          sources: [],
        }),
      };
    }
    if (!res || !res.ok) {
      return {
        output: JSON.stringify({
          ok: false,
          provider: (res && res.provider) || "",
          error: (res && res.error) || "search_failed",
          sources: [],
        }),
      };
    }
    const sources = (Array.isArray(res.sources) ? res.sources : []).map((s) => ({
      title: String((s && s.title) || ""),
      url: String((s && s.url) || ""),
      snippet: String((s && s.snippet) || "").slice(0, 400),
    }));
    return {
      output: JSON.stringify({ ok: true, provider: String(res.provider || ""), sources }),
    };
  }
  if (tool === "web_fetch") {
    const url = String(args.url || "").trim();
    if (!url) {
      return { output: JSON.stringify({ ok: false, error: "empty_url" }) };
    }
    let results = [];
    try {
      results = await state.ffi.executeHostEffects(
        [{ kind: "webfetch", command: url, needs_host_ffi: true }],
        {},
      );
    } catch (err) {
      return {
        output: JSON.stringify({
          ok: false,
          url,
          error: String((err && err.message) || err).slice(0, 200),
        }),
      };
    }
    const row = Array.isArray(results) ? results[0] : null;
    if (!row) {
      return { output: JSON.stringify({ ok: false, url, error: "no_result_recorded" }) };
    }
    let detail = {};
    try {
      detail = JSON.parse(String(row.stdout || "{}")) || {};
    } catch (_) {
      detail = {};
    }
    if (!row.ok) {
      return {
        output: JSON.stringify({
          ok: false,
          url,
          error: String(row.error || detail.error || "fetch_failed"),
          http_status: Number(detail.http_status || 0) || 0,
        }),
      };
    }
    return {
      output: JSON.stringify({
        ok: true,
        url,
        http_status: Number(detail.http_status || 0) || 0,
        body_prefix: String(detail.body_prefix || ""),
        body_bytes: Number(detail.body_bytes || 0) || 0,
      }),
    };
  }
  if (tool === "send_mail") {
    const to = String(args.to || "").trim();
    const subject = String(args.subject || "").trim();
    const body = String(args.body || args.text || "");
    if (!to || !subject || !body) {
      return {
        output: JSON.stringify({
          ok: false,
          error: "send_mail needs to, subject and body",
        }),
      };
    }
    // The effect command is `provider|to|subject|body`; `|` is the separator,
    // so a subject containing one would silently corrupt the recipient.
    if (subject.includes("|")) {
      return {
        output: JSON.stringify({
          ok: false,
          error: "subject must not contain '|' (it separates the effect fields)",
        }),
      };
    }
    // The approval grant comes from THIS Host's own decideApproval — never
    // from a field in the arguments. ADR 0008: args.approved cannot mint
    // approval, so `approved` is never read here.
    const action = canonicalAction("send_mail", argsJson);
    const granted =
      state.mailAllowed &&
      (state.pendingMailAction === "*" || state.pendingMailAction === action);
    if (!granted) {
      return {
        output: JSON.stringify({
          ok: false,
          error: "send_mail refused: no approval grant",
          needs_approval: true,
          sent: false,
        }),
      };
    }
    let results = [];
    try {
      results = await state.ffi.executeHostEffects(
        [
          {
            kind: "mail_send",
            command: "gmail|" + to + "|" + subject + "|" + body,
            needs_host_ffi: true,
          },
        ],
        { approved: true },
      );
    } catch (err) {
      return {
        output: JSON.stringify({
          ok: false,
          error: String((err && err.message) || err).slice(0, 200),
          sent: false,
        }),
      };
    }
    const row = Array.isArray(results) ? results[0] : null;
    if (!row) {
      return {
        output: JSON.stringify({ ok: false, error: "no_result_recorded", sent: false }),
      };
    }
    let detail = {};
    try {
      detail = JSON.parse(String(row.stdout || "{}")) || {};
    } catch (_) {
      detail = {};
    }
    // `sent` and `pretend_sent` come from the Host's own ledger. A sandbox
    // eml is NOT a send, and the model must be told which one happened.
    const sent = detail.sent === true;
    return {
      output: JSON.stringify({
        ok: row.ok !== false,
        to,
        subject,
        sent,
        pretend_sent: detail.pretend_sent === true,
        live_mail_residual: detail.live_mail_residual === true,
        mode: String(detail.mode || ""),
        eml_path: String(detail.eml_path || ""),
        error: row.ok === false ? String(row.error || detail.reason || "send_failed") : "",
      }),
    };
  }
  return { output: "exec refused: " + name };
}

async function execProductTool(req, state) {
  const name = String((req && req.name) || "");
  const argsJson = String((req && req.arguments) || "");
  let args = {};
  try {
    args = JSON.parse(argsJson || "{}");
  } catch (_) {
    args = {};
  }
  if (name === "Shell" || name === "shell") {
    const action = canonicalAction(name, argsJson);
    const granted =
      state.shellAllowed &&
      (state.pendingShellAction === "*" || state.pendingShellAction === action);
    if (!granted) {
      return { output: "shell refused: no approval grant" };
    }
    state.shellAllowed = false;
    state.pendingShellAction = "";
    return { output: "[product-shell] " + String(args.command || "") };
  }
  if (name === "Read" || name === "read" || name === "fs_read") {
    const rel = String(args.path || "");
    const fixture = readFixtures()[rel];
    if (typeof fixture === "string") return { output: fixture };
    return { output: readBounded(state.ffi, rel) };
  }
  if (canonProductTool(name) !== name || name === "web_search" || name === "web_fetch" || name === "send_mail") {
    return await execHostProductTool(name, args, argsJson, state);
  }
  return { output: "exec refused: " + name };
}

async function decideApproval(state, req, opts) {
  const options = opts || {};
  const name = String((req && req.name) || "");
  const argsJson = String((req && req.arguments) || "");
  // A grant the Host itself decided. B-class product tools get their own
  // grant: the Host's own effect gate (executeHostEffects) would otherwise
  // refuse `mail_send` a second time, with no way to say "already approved".
  const grant = () => {
    state.shellAllowed = true;
    state.pendingShellAction = canonicalAction(name, argsJson);
    if (canonProductTool(name) === "send_mail") {
      state.mailAllowed = true;
      state.pendingMailAction = canonicalAction("send_mail", argsJson);
    }
  };
  if (typeof options.requestApproval === "function") {
    let verdict = "deny";
    try {
      const answered = await options.requestApproval({
        name,
        arguments: argsJson,
        turnId: state.turnId,
      });
      const v = answered && answered.verdict;
      if (v === "allow" || v === "cancel" || v === "deny") verdict = v;
    } catch (_) {
      verdict = "deny";
    }
    if (verdict === "allow") {
      grant();
    }
    return { verdict };
  }
  if (options.cliApproved === true) {
    grant();
    if (options.approvalGate && state.turnId) {
      options.approvalGate.record({
        turnId: state.turnId,
        action: state.pendingShellAction,
        source: "cli",
      });
    }
    return { verdict: "allow" };
  }
  const verdict = approvalMode();
  if (verdict === "allow") {
    state.shellAllowed = true;
    state.pendingShellAction = "*";
    state.mailAllowed = true;
    state.pendingMailAction = "*";
  }
  return { verdict };
}

function createProductSession(ffi, llmOpts) {
  const opts = llmOpts || {};
  const chatOpts = {};
  if (opts.botId) chatOpts.botId = opts.botId;
  if (opts.roomContext) chatOpts.roomContext = opts.roomContext;
  // GP-14：回合内第一跳就要看见被引用的原文，所以引用在 kernel 启动前解析，
  // 这里原样带给 executeLlmChat（它负责把 [quoted message <id>] 行放进请求体）。
  if (opts.replyTo) {
    chatOpts.replyTo = String(opts.replyTo);
    chatOpts.replyQuote = String(opts.replyQuote || "");
    chatOpts.replyRole = String(opts.replyRole || "assistant");
  }
  const state = {
    shellAllowed: false,
    pendingShellAction: "",
    // C-2: the Host's own grant for the send_mail product tool. It is set
    // ONLY by decideApproval — a field in the tool arguments cannot set it.
    mailAllowed: false,
    pendingMailAction: "",
    delivered: "",
    // GP-165: first failing llm_chat reason for this turn ("" until one fails).
    llmError: "",
    ffi,
    turnId: String(opts.turnId || ""),
  };
  return {
    state,
    async dispatch(req) {
      const op = String((req && req.op) || "");
      if (op === "llm_chat") {
        // Production Chat: one kernel llm_chat becomes one executeLlmChat.
        // The URL is catalog / BITBOT_LLM_* (default DeepSeek). This file does
        // not substitute a loopback stub and does not call the model again.
        const res = await ffi.executeLlmChat("agent-loop", {
          ...chatOpts,
          messages: Array.isArray(req.messages) ? req.messages : [],
          agentLoopTools: true,
          // The kernel owns the tool catalog: it sends the schema the model
          // must see, so the provider payload can never drift from what the
          // kernel can actually dispatch.
          tools: Array.isArray(req.tools) ? req.tools : undefined,
        });
        const calls = Array.isArray(res.tool_calls) ? res.tool_calls : [];
        if (!res.ok) {
          // GP-165：上游模型失败不是「模型说的话」。以前把 error 原文塞进
          // content，内核就会把它当成 assistant 正文 deliver 出去，群协作也
          // 会把这一票算成「成功回复」。这里只留原因、正文留空，交给 Host
          // 出口按 ok:false 报出去。
          state.llmError = String(res.error || res.stderr || "llm_chat_failed");
          return { content: "", calls: [], error: state.llmError };
        }
        return {
          content: String(res.stdout || ""),
          calls: calls.map((c) => ({
            id: String((c && c.id) || ""),
            name: String((c && c.name) || ""),
            arguments: String((c && (c.arguments || c.arguments_json)) || ""),
          })),
        };
      }
      if (op === "exec_tool") return execProductTool(req, state);
      if (op === "request_approval") return decideApproval(state, req, opts);
      if (op === "deliver") {
        state.delivered = String((req && req.text) || "");
        return { ok: true };
      }
      return {
        error: "unknown op",
        content: "",
        calls: [],
        output: "",
        verdict: "deny",
      };
    },
  };
}

function legacyGuardedRerunEnabled(env) {
  return String((env || process.env).BITBOT_LEGACY_GUARDED_RERUN || "") === "1";
}

/**
 * Project one kernel loop line into an AgentStep.
 * The kernel owns the loop. Callers may display this object; they must not
 * start another model or tool loop from it.
 */
function projectAgentStep(line) {
  const text = String(line || "").trim();
  if (text === "BITBOT_LOOP entry=AgentLoop::run") {
    return {
      kind: "entry",
      entry: "AgentLoop::run",
      agent_entry: "open_turn",
    };
  }
  const prefix = "BITBOT_LOOP op=";
  if (!text.startsWith(prefix)) return null;
  const op = text.slice(prefix.length).trim();
  if (
    op !== "llm_chat" &&
    op !== "exec_tool" &&
    op !== "request_approval" &&
    op !== "deliver"
  ) {
    return null;
  }
  return { kind: "op", op };
}

module.exports = {
  createProductSession,
  execProductTool,
  decideApproval,
  legacyGuardedRerunEnabled,
  projectAgentStep,
};
