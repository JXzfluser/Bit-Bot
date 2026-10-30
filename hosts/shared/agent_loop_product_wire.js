"use strict";

const fs = require("fs");
const path = require("path");
const { canonicalAction } = require("./host_approval_gate");
const { buildToolPolicy } = require("./tool_policy");
const { DEFAULTS } = require("./machine_identity");

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

/**
 * K-1/K-3: where one Bot's agent context lives.
 *
 * The slot arrives from the kernel as a bot id, and it ends up in a FILE PATH.
 * It must therefore never be able to escape the context directory: a bot id
 * like "../../etc/passwd" must not become a path.
 */
// GP-185: 默认机器 id 不在这里再写一次（machine_identity 是唯一来源）。
const DEFAULT_CONTEXT_MACHINE = DEFAULTS.desktop;

/**
 * B-5:这台机器叫什么。
 *
 * 上下文槽位从 per-(Bot, 会话) 扩成 per-(机器, Bot, 会话) ——
 * 同一段对话不该在两台机器上续着(那是串味,不是记得我)。
 *
 * **机器维度归 Host,不给内核**:内核是机器无关的(同一个二进制在每台机器上跑),
 * 而且 Host 侧能同时算出新路径和老路径,迁移才好做。
 */
function agentContextMachine(machineId) {
  const raw = String(machineId || "").trim();
  let safe = raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  if (safe === "" || safe === "." || safe === "..") safe = DEFAULT_CONTEXT_MACHINE;
  return safe;
}

function agentContextPath(ffi, slot, machineId) {
  const raw = String(slot || "").trim();
  let safe = raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  if (safe === "" || safe === "." || safe === "..") safe = "agent-bit";
  const dir = path.join(String((ffi && ffi.DATA_ROOT) || "."), "agent-context");
  const machine = agentContextMachine(machineId);
  return {
    dir,
    file: path.join(dir, machine, safe + ".ctx"),
    // 分机器之前,上下文是平铺在 agent-context/ 下的 —— 这条是迁移源。
    legacyFile: path.join(dir, safe + ".ctx"),
  };
}

function readAgentContext(ffi, slot, machineId) {
  const { file, legacyFile } = agentContextPath(ffi, slot, machineId);
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
    // 迁移:老槽位**没有机器归属**(那时候根本没记是谁写的),所以规则是
    // 「谁先读谁继承」—— 读完就搬走,第二台机器就看不到了。
    // 这才是「各机独立」该有的样子;复制的话两台机器会共享同一段对话。
    if (fs.existsSync(legacyFile)) {
      const text = fs.readFileSync(legacyFile, "utf8");
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text, "utf8");
        fs.unlinkSync(legacyFile);
      } catch (_) {
        /* 搬不动就还是读老的 —— 宁可继续用旧槽位,也不能把历史弄丢 */
      }
      return text;
    }
    return "";
  } catch (_) {
    return "";
  }
}

function writeAgentContext(ffi, slot, text, machineId) {
  const { file } = agentContextPath(ffi, slot, machineId);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(text || ""), "utf8");
    return true;
  } catch (_) {
    /* a context that cannot be persisted must not fail the turn */
    return false;
  }
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
  if (n === "createRoom" || n === "CreateRoom" || n === "create_group" || n === "createGroup") {
    return "create_room";
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
  if (tool === "create_room") {
    // C-5:建群。成员可以是名字或 id;不认识的人会被如实拒绝 —— 绝不建残群。
    const title = String(args.title || args.name || "").trim();
    const rawMembers = Array.isArray(args.members)
      ? args.members
      : Array.isArray(args.bots)
        ? args.bots
        : String(args.members || args.bots || "").split(",");
    const members = rawMembers.map((m) => String(m == null ? "" : m).trim()).filter(Boolean);
    if (!title) {
      return { output: JSON.stringify({ ok: false, error: "create_room needs a title" }) };
    }
    if (!members.length) {
      return { output: JSON.stringify({ ok: false, error: "create_room needs members" }) };
    }
    let res = null;
    try {
      res = await state.ffi.createRoom(members.join(","), title);
    } catch (err) {
      return {
        output: JSON.stringify({
          ok: false,
          error: String((err && err.message) || err).slice(0, 200),
          members,
        }),
      };
    }
    if (!res || res.ok === false) {
      return {
        output: JSON.stringify({
          ok: false,
          error: (res && res.error) || "room_create_failed",
          names_not_found: (res && res.names_not_found) || [],
          resolved_names: (res && res.resolved_names) || [],
          resolved_count: Number((res && res.resolved_count) || 0),
          members,
        }),
      };
    }
    const room = res.room || {};
    return {
      output: JSON.stringify({
        ok: true,
        room_id: String(room.id || ""),
        title: String(room.title || title),
        members: Array.isArray(room.members) ? room.members : members,
        member_count: Array.isArray(room.members) ? room.members.length : members.length,
        // 短窗内的同成员同群名 → 返回既有群,不新建第二个。
        existing: Boolean(res.existing),
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
  if (
    canonProductTool(name) !== name ||
    name === "web_search" ||
    name === "web_fetch" ||
    name === "send_mail" ||
    name === "create_room"
  ) {
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
    // K-2/C-3: the device this turn came from, and who it belongs to.
    deviceTrust: String((opts && opts.deviceTrust) || "trusted"),
    subject: String((opts && opts.subject) || ""),
    delivered: "",
    // GP-165: first failing llm_chat reason for this turn ("" until one fails).
    llmError: "",
    ffi,
    turnId: String(opts.turnId || ""),
    // B-5: 上下文按机器分槽。机器身份由 Host 提供(见 hosts/shared/machine_identity.js),
    // 内核不需要知道「机器」这件事。
    machineId: String((opts && opts.machineId) || ""),
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
      // K-1/K-3: the agent context crosses the process boundary here. The
      // kernel owns the semantics (encode/decode); the Host only stores bytes.
      // K-2/C-3: the Host builds the policy; the kernel enforces it.
      if (op === "load_policy") {
        const policy = buildToolPolicy({
          deviceTrust: state.deviceTrust,
          subject: state.subject,
        });
        return { output: JSON.stringify(policy) };
      }
      if (op === "load_context") {
        return { output: readAgentContext(state.ffi, req && req.slot, state.machineId) };
      }
      if (op === "save_context") {
        const ok = writeAgentContext(
          state.ffi,
          req && req.slot,
          req && req.text,
          state.machineId,
        );
        return { output: ok ? "ok" : "context_not_persisted" };
      }
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
