#!/usr/bin/env node
"use strict";

/**
 * GP-14「Reply 回复特定消息」proof — runs without Electron.
 *
 * Grok's acceptance signal (docs/grok-desktop-parity/spec.md GP-14) is that
 * after hitting Reply, the *kernel turn context* carries the replied-to message
 * id. A UI quote chip alone would be a shell, so this probe drives the real
 * chain and checks it at every layer:
 *
 *   sessions store id  →  runTurn({replyTo})  →  kernel argv --reply-to
 *   →  kernel echoes reply_to in the turn JSON  →  Host resolves id → text
 *   →  quote is injected into the provider request body (echo-all stub proves
 *      it reached HTTP, not just our own logs)  →  llm artifact + store row
 *      record which message was quoted.
 *
 * Honesty checks: an unknown id must surface message_not_found / unresolved,
 * never a silently dropped quote; a reply turn must not leak the id into the
 * user text sent to the model.
 *
 * Usage: node scripts/prove_gp14_reply.js   (exit 0 = all assertions green)
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const SESSIONS_PATH = path.join(REPO, "data/desktop/sessions.json");
const TURNS_DIR = path.join(REPO, "data/llm/turns");
const STUB_PORT = Number(process.env.BITBOT_G14_STUB_PORT || 8795);
const QUOTE_TEXT = "GP14-PROBE 被引用的原始回答";
const REPLY_TEXT = "GP14-PROBE 针对引用作答";
// A per-run id: the agent context is keyed by (bot, session), so a unique
// session keeps each run from inheriting the previous run's history.
const RUN_ID = Date.now().toString(36) + "-" + process.pid;
const SESSION_ID = "sess-gp14probe-" + RUN_ID;
const QUOTE_ID = "msg-gp14probe-q1";

let PASS = 0;
let FAIL = 0;
const ok = (name) => {
  PASS++;
  console.log("  ✓ " + name);
};
const bad = (name, detail) => {
  FAIL++;
  console.log("  ✗ " + name + (detail ? " — " + String(detail).slice(0, 200) : ""));
};

function newestArtifact(dir) {
  if (!fs.existsSync(dir)) return null;
  const rows = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]);
  if (!rows.length) return null;
  rows.sort((a, b) => b[1] - a[1]);
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, rows[0][0]), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const sessionsBefore = fs.existsSync(SESSIONS_PATH)
    ? fs.readFileSync(SESSIONS_PATH)
    : null;

  let stub = null;
  let stubUp = false;
  try {
    // 1) deterministic store row with a real durable id (via the real store API)
    fs.mkdirSync(path.dirname(SESSIONS_PATH), { recursive: true });
    let state = sessionsBefore ? JSON.parse(String(sessionsBefore)) : null;
    if (!state || !Array.isArray(state.sessions)) {
      state = { version: 1, active_id: SESSION_ID, sessions: [] };
    }
    state.sessions = state.sessions.filter((s) => s.id !== SESSION_ID);
    state.sessions.unshift({
      id: SESSION_ID,
      title: "GP14 probe",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: [
        { id: QUOTE_ID, role: "assistant", text: QUOTE_TEXT, at: new Date().toISOString() },
      ],
    });
    state.active_id = SESSION_ID;
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(state, null, 2));
    ok("GP-14 fixture：session store 写入带固定 id 的被引用消息（" + QUOTE_ID + "）");

    // 2) echo-all stub so the provider request body is observable
    stub = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BITBOT_STUB_PORT: String(STUB_PORT),
        BITBOT_STUB_ECHO_ALL: "1",
        BITBOT_STUB_ECHO_WIDTH: "700",
      },
    });
    stubUp = await new Promise((res) => {
      const t = setTimeout(() => res(false), 8000);
      stub.stdout.on("data", (d) => {
        if (String(d).includes("[stub-llm]")) {
          clearTimeout(t);
          res(true);
        }
      });
      stub.on("error", () => {
        clearTimeout(t);
        res(false);
      });
    });
    if (!stubUp) {
      bad("GP-14 stub 启动", "openai_compat_stub.js 未在 8s 内就绪");
      console.log("gp14 probe 中止");
      process.exitCode = 1;
      return;
    }
    Object.assign(process.env, {
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
      BITBOT_LLM_API_KEY: "gp14-probe-key",
      BITBOT_LLM_MODEL: "gp14-probe",
      BITBOT_LLM_STREAM: "0",
    });
    ok("GP-14 stub：echo-all provider 服务就绪（可观测 HTTP messages 全栈）");

    const { createTurnRunner } = require(path.join(REPO, "hosts/shared/run_moon_turn.js"));
    const runner = createTurnRunner(REPO);

    // 3) real reply turn: id → kernel → Host → provider body
    const r = await runner.runTurn(REPLY_TEXT, {
      sessionId: SESSION_ID,
      machineId: "desk-1",
      machineKind: "desktop",
      replyTo: QUOTE_ID,
    });
    r.ok && r.reply_to === QUOTE_ID
      ? ok("GP-14 kernel 回显：turn JSON reply_to=" + r.reply_to)
      : bad("GP-14 kernel 回显", JSON.stringify({ ok: r.ok, reply_to: r.reply_to, error: r.error }));

    const userRow = (r.messages || []).find((m) => m.role === "user");
    userRow && String(userRow.text).trim() === REPLY_TEXT
      ? ok("GP-14 用户原文未被污染（id 不拼进 text，Host 拿到的是真原文）")
      : bad("GP-14 原文污染", JSON.stringify(userRow && userRow.text));

    const q = r.reply_quote || {};
    q.resolved === true && q.message_id === QUOTE_ID && q.text === QUOTE_TEXT && q.role === "assistant"
      ? ok("GP-14 Host 解析：id → store 原文（role/text 都对得上，非伪造）")
      : bad("GP-14 Host 解析", JSON.stringify(q));

    // 两条产品路径都要有同一份证据：legacy 计划把 llm_chat 作为 Host 效果
    // （host_results 行），AgentLoop 在回合内直接调模型（没有 effects 行）。
    // 后者认 provider artifact：reply_to / 引文字节数 / 来源=session_store。
    const art = newestArtifact(TURNS_DIR);
    const llm = (r.host_results || []).find((h) => h.kind === "llm_chat");
    const legacyHit = Boolean(
      llm && llm.ok && llm.reply_to === QUOTE_ID && llm.reply_quote_chars === QUOTE_TEXT.length,
    );
    const loopHit = Boolean(
      r.agent_loop === true &&
        Number(r.agent_llm) >= 1 &&
        art &&
        art.reply_to === QUOTE_ID &&
        art.reply_quote_chars === QUOTE_TEXT.length &&
        art.reply_quote_source === "session_store",
    );
    legacyHit || loopHit
      ? ok(
          "GP-14 llm 调用带 reply_to + 引文字节数（" +
            (legacyHit
              ? "legacy host_results," + llm.reply_quote_chars
              : "AgentLoop provider artifact," + art.reply_quote_chars) +
            "）",
        )
      : bad(
          "GP-14 llm 调用缺引用证据",
          JSON.stringify({
            legacy: llm || null,
            loop: r.agent_loop === true ? Number(r.agent_llm) : null,
            art: art && { reply_to: art.reply_to, chars: art.reply_quote_chars, source: art.reply_quote_source },
          }).slice(0, 260),
        );

    // 4) the quote actually reached the provider request body
    const echoed = JSON.stringify((r.messages || []).map((m) => m.text).join(" "));
    /quoted message /.test(echoed) && echoed.includes(QUOTE_ID) && echoed.includes(QUOTE_TEXT)
      ? ok("GP-14 provider 请求体真含引用行（stub 回显 [quoted message <id>] <原文>）")
      : bad("GP-14 provider 请求体", echoed.slice(0, 220));

    art && art.reply_to === QUOTE_ID && art.reply_quote_source === "session_store"
      ? ok("GP-14 artifact 记录 reply_to + 引用来源=session_store（可审计）")
      : bad("GP-14 artifact", JSON.stringify(art && { reply_to: art.reply_to, source: art.reply_quote_source }));

    // 5) store row persists the reply target (survives reload / restart).
    // runTurn does not write the transcript — main.js does — so this exercises
    // the same session-store API main.js calls, not a reimplementation.
    const { createSessionStore } = require(path.join(REPO, "hosts/desktop/sessions.js"));
    const store = createSessionStore(REPO);
    const appended = store.appendMessages(SESSION_ID, [
      { role: "user", text: REPLY_TEXT, reply_to: QUOTE_ID },
    ]);
    const stored = appended && appended.session
      ? (appended.session.messages || []).find(
          (m) => String(m.text || "").indexOf(REPLY_TEXT) >= 0,
        )
      : null;
    stored && stored.reply_to === QUOTE_ID && stored.id
      ? ok("GP-14 sessions.json 用户行持久 reply_to（id=" + stored.id + "）→ 重载可复原引用条")
      : bad("GP-14 store 持久化", JSON.stringify(stored || appended).slice(0, 200));
    // findMessage = the resolver main.js injects; must read back the quote
    const found = store.findMessage(QUOTE_ID);
    found && found.ok && found.text === QUOTE_TEXT && found.role === "assistant"
      ? ok("GP-14 store.findMessage 解析 id → 原文/角色（Reply 引用来源）")
      : bad("GP-14 findMessage", JSON.stringify(found).slice(0, 200));
    const miss = store.findMessage("msg-gp14probe-nope");
    miss && miss.ok === false && miss.error === "message_not_found"
      ? ok("GP-14 findMessage 未知 id → message_not_found（不返回空对象假成功）")
      : bad("GP-14 findMessage miss 语义", JSON.stringify(miss).slice(0, 160));

    // 6) honest failure for a bogus id (never pretend the quote resolved)
    const ghost = await runner.runTurn("GP14-PROBE 幽灵引用", {
      sessionId: SESSION_ID,
      machineId: "desk-1",
      machineKind: "desktop",
      replyTo: "msg-gp14probe-ghost",
    });
    const gq = ghost.reply_quote || {};
    ghost.reply_to === "msg-gp14probe-ghost" && gq.resolved === false &&
      /message_not_found/.test(String(gq.error || ""))
      ? ok("GP-14 未知 id：kernel 仍如实回显 + Host 报 message_not_found（不静默吞引用）")
      : bad("GP-14 未知 id", JSON.stringify({ echo: ghost.reply_to, q: gq }).slice(0, 220));
    const gArt = newestArtifact(TURNS_DIR);
    gArt && gArt.reply_to === "msg-gp14probe-ghost" && gArt.reply_quote_chars === 0 &&
      gArt.reply_quote_source === "unresolved"
      ? ok("GP-14 未解析引用在 provider artifact 标 unresolved")
      : bad("GP-14 unresolved artifact", JSON.stringify(gArt && { reply_to: gArt.reply_to, source: gArt.reply_quote_source }));

    // 7) not-a-reply turn keeps the field empty (no accidental quoting)
    const plain = await runner.runTurn("GP14-PROBE 普通提问", {
      sessionId: SESSION_ID,
      machineId: "desk-1",
      machineKind: "desktop",
    });
    plain.reply_to === "" && (plain.reply_quote === undefined || plain.reply_quote === null)
      ? ok("GP-14 非回复回合 reply_to 空串 + 无 quote 注入")
      : bad("GP-14 非回复回合", JSON.stringify({ reply_to: plain.reply_to, q: plain.reply_quote }));

    // 8) renderer wiring (id + Reply affordance + quote bar + i18n ×3)
    const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
    const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
    const wire =
      /function attachMessageActions/.test(html) &&
      /setReplyTarget/.test(html) &&
      /id="reply-bar"/.test(html) &&
      /replyTo: reply \? reply\.id : undefined/.test(html) &&
      /mid: m\.id \|\| ""/.test(html) &&
      /stored_ids/.test(html) &&
      /result\.stored_ids = \{/.test(mainJs);
    const i18n = ["replyAction:", "replyQuoting:", "replyCancel:"].every(
      (k) => (html.match(new RegExp(k, "g")) || []).length >= 3,
    );
    wire && i18n
      ? ok("GP-14 renderer：每条气泡带 store id + 回复入口 + 引用条 + 三语文案")
      : bad("GP-14 renderer wiring", JSON.stringify({ wire, i18n }));

    // 9) CLI host exposes the same flag (multi-end parity)
    const cli = fs.readFileSync(path.join(REPO, "hosts/cli_host/run_turn.js"), "utf8");
    const ffi = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
    /--reply-to/.test(cli) && /replyTo: replyTo \|\| undefined/.test(cli) &&
      /const replyToId = String\(\(llmOpts && llmOpts\.replyTo\)/.test(ffi) &&
      /\[quoted message " \+ replyToId/.test(ffi)
      ? ok("GP-14 多端一致：CLI run_turn --reply-to + host_ffi 引用注入同源")
      : bad("GP-14 CLI/FFI contract", "flag or injection missing");
  } catch (e) {
    bad("GP-14 探针异常", e.stack || e.message);
  } finally {
    if (stub) {
      try {
        stub.kill("SIGKILL");
      } catch (_) {}
    }
    for (const k of [
      "BITBOT_LLM_BASE_URL",
      "BITBOT_LLM_API_KEY",
      "BITBOT_LLM_MODEL",
      "BITBOT_LLM_STREAM",
    ])
      delete process.env[k];
    // restore the transcript store byte-for-byte (double-run idempotent)
    if (sessionsBefore) fs.writeFileSync(SESSIONS_PATH, sessionsBefore);
    else fs.rmSync(SESSIONS_PATH, { force: true });
  }

  console.log(`prove_gp14_reply: PASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[gp14] failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});
