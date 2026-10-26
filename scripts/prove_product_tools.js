"use strict";

/**
 * PT — C-1 capability layer: product tools end-to-end gate.
 *
 * What this proves (and what it does NOT):
 *   PROVED: the model is OFFERED the product tools (the provider really
 *           receives their schema), the kernel REALLY dispatches them, the
 *           kernel REALLY does the MoonBit-side work, and the effect REALLY
 *           comes out of the turn with the right payload.
 *   NOT PROVED: that a real model would pick these tools. The provider is a
 *           local stub — it proves the TOOL PATH, not the model's judgement.
 *
 * The negative cases matter more than the positive ones: a product tool that
 * fails must leave NO effect behind. A tool that half-works is worse than a
 * tool that does not exist, because the Host would go on believing it did.
 *
 * The kernel runs as the COMPILED binary (BITBOT_KERNEL_BIN) when the wrapper
 * built one — that is the artifact a packaged app ships, so the proof is on
 * the product path, not on `moon run`.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

// A per-run id: the agent context is keyed by (bot, session), so a
// unique session keeps each run from inheriting the previous run's history.
const RUN_ID = Date.now().toString(36) + "-" + process.pid;
const ROOT = path.resolve(__dirname, "..");
const { createTurnRunner } = require(path.join(ROOT, "hosts/shared/run_moon_turn"));

let pass = 0;
let fail = 0;
// The stub's port is only known after it starts; the classifier needs it to
// hand the model a real URL to fetch.
let stubPort = 0;

function ok(name) {
  pass += 1;
  console.log("ok", name);
}

function bad(name, detail) {
  fail += 1;
  console.error("FAIL", name, detail || "");
}

function check(cond, name, detail) {
  if (cond) ok(name);
  else bad(name, detail);
}

function toolCall(name, args, id) {
  return {
    kind: "tool",
    name,
    arguments: JSON.stringify(args),
    id,
  };
}

/* The product path streams by default (`BITBOT_LLM_STREAM !== "0"`), so the
   stub has to speak SSE like the real provider does. A tool call in the
   streaming shape is a delta carrying tool_calls. */
function sseTool(name, args, id) {
  const payload = {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: { name, arguments: args },
            },
          ],
        },
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

function sseText(text) {
  const payload = { choices: [{ delta: { content: text } }] };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

/**
 * The stub answers by scene. The SECOND call of a scene (the kernel asks
 * again after the tool result) is detected by the observation already being
 * in the message stack — that is also how the negative cases are detected.
 */
/**
 * The scene is decided by the LAST user message, not by the whole payload.
 * Since K-1/K-3 the context crosses the process boundary, so a later turn's
 * payload also carries the EARLIER turns' user text — matching the whole blob
 * would answer every scene with the oldest one.
 */
function lastUserText(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m && String(m.role || "") === "user") return String(m.content || "");
  }
  return "";
}

/**
 * The messages AFTER the last user message — i.e. THIS turn's tool results.
 * The "did the tool already run?" checks must look here, not at the whole
 * payload: the payload now carries earlier turns, and an earlier turn's
 * observation would make the check pass without the tool ever running.
 */
function turnTail(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  let idx = -1;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m && String(m.role || "") === "user") {
      idx = i;
      break;
    }
  }
  if (idx < 0) return "";
  return JSON.stringify(msgs.slice(idx + 1));
}

function classify(body) {
  const blob = JSON.stringify(body.messages || []);
  const last = lastUserText(body);
  const tail = turnTail(body);
  if (last.includes("PT1-ROUTINE")) {
    if (tail.includes("scheduled") || tail.includes("routine_error")) {
      return { kind: "text", text: "routine done" };
    }
    return toolCall(
      "create_routine",
      { schedule: "每天早上8点", prompt: "采集AI科技热点并发我邮箱" },
      "c-routine",
    );
  }
  if (last.includes("PT2-TEAMMATE")) {
    if (tail.includes("teammate created") || tail.includes("teammate_error")) {
      return { kind: "text", text: "teammate done" };
    }
    return toolCall(
      "create_teammate",
      { name: "选题", role: "热点选题" },
      "c-teammate",
    );
  }
  if (last.includes("PT3-BADSCHEDULE")) {
    if (tail.includes("routine_error") || tail.includes("scheduled")) {
      return { kind: "text", text: "bad schedule handled" };
    }
    return toolCall(
      "create_routine",
      { schedule: "随便哪天", prompt: "干活" },
      "c-badsched",
    );
  }
  if (last.includes("PT4-NOROLE")) {
    if (tail.includes("needs a role") || tail.includes("teammate_error")) {
      return { kind: "text", text: "missing role handled" };
    }
    return toolCall("create_teammate", { name: "选题" }, "c-norole");
  }
  // --- C-2: B-class tools (the Host runs them) ---
  if (last.includes("PT7-SEARCH")) {
    if (tail.includes("search_key_not_configured") || tail.includes("example.com")) {
      return { kind: "text", text: "search done" };
    }
    return toolCall("web_search", { query: "AI 科技热点", topN: 3 }, "c-search");
  }
  if (last.includes("PT8-SEARCHNOKEY")) {
    if (tail.includes("search_key_not_configured")) {
      return { kind: "text", text: "search refused" };
    }
    return toolCall("web_search", { query: "AI 科技热点" }, "c-nokey");
  }
  if (last.includes("PT9-FETCH")) {
    if (tail.includes("body_prefix") || tail.includes("fetch_failed")) {
      return { kind: "text", text: "fetch done" };
    }
    return toolCall(
      "web_fetch",
      { url: `http://127.0.0.1:${stubPort}/article` },
      "c-fetch",
    );
  }
  if (last.includes("PT10-MAILNOAPPROVAL")) {
    if (tail.includes("no approval grant") || tail.includes("approval denied")) {
      return { kind: "text", text: "mail refused" };
    }
    return toolCall(
      "send_mail",
      { to: "me@example.com", subject: "AI 热点日报", body: "今天三条热点" },
      "c-mailno",
    );
  }
  if (last.includes("PT12-DENIED")) {
    if (tail.includes("denied by policy")) return { kind: "text", text: "denied seen" };
    return toolCall("web_fetch", { url: `http://127.0.0.1:${stubPort}/article` }, "c-denied");
  }
  if (last.includes("PT13-LIMITED")) {
    if (tail.includes("approval denied") || tail.includes("body_prefix")) {
      return { kind: "text", text: "limited handled" };
    }
    return toolCall("web_fetch", { url: `http://127.0.0.1:${stubPort}/article` }, "c-limited");
  }
  if (last.includes("PT11-MAILAPPROVED")) {
    if (tail.includes("eml_path") || tail.includes("no approval grant")) {
      return { kind: "text", text: "mail handled" };
    }
    return toolCall(
      "send_mail",
      { to: "me@example.com", subject: "AI 热点日报", body: "今天三条热点" },
      "c-mailyes",
    );
  }
  return { kind: "text", text: "plain final" };
}

function startStub() {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      const url = String((req && req.url) || "");
      // --- C-2: the search provider (tavily shape) ---
      if (url.includes("/search")) {
        posts.push({ url, body, kind: "search" });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              {
                title: "推理模型的新进展",
                url: "https://example.com/a",
                content: "一条真实的检索结果摘要。",
              },
              {
                title: "Agent 框架横评",
                url: "https://example.com/b",
                content: "另一条检索结果。",
              },
            ],
          }),
        );
        return;
      }
      // --- C-2: a page for web_fetch to read ---
      if (url.includes("/article")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><h1>source_hub_article</h1><p>正文内容在这里。</p></body></html>");
        return;
      }
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (_) {
        parsed = {};
      }
      posts.push(parsed);
      const scene = classify(parsed);
      if (parsed.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          scene.kind === "tool"
            ? sseTool(scene.name, scene.arguments, scene.id)
            : sseText(scene.text),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (scene.kind === "tool") {
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: scene.id,
                      type: "function",
                      function: { name: scene.name, arguments: scene.arguments },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: scene.text } }],
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, posts, port: server.address().port });
    });
  });
}

function effectKinds(turn) {
  const out = [];
  if (turn && Array.isArray(turn.effects)) {
    for (const e of turn.effects) {
      if (e && e.kind) out.push(e.kind);
    }
  }
  return out;
}

/**
 * The tool results of the LAST turn among `posts` (from `before`).
 * Only the current turn counts: the payload also carries earlier turns, and
 * an earlier turn's observation would make "did it run?" answer the wrong
 * question.
 */
function turnObservations(posts, before) {
  const slice = posts.slice(before);
  if (!slice.length) return "";
  const last = slice[slice.length - 1];
  const msgs = Array.isArray(last && last.messages) ? last.messages : [];
  let idx = -1;
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m && String(m.role || "") === "user") {
      idx = i;
      break;
    }
  }
  if (idx < 0) return "";
  return JSON.stringify(msgs.slice(idx + 1));
}

function findEffect(turn, kind) {
  if (!turn || !Array.isArray(turn.effects)) return null;
  for (const e of turn.effects) {
    if (e && e.kind === kind) return e;
  }
  return null;
}

function blobOf(turn) {
  try {
    return JSON.stringify(turn || {});
  } catch (_) {
    return "";
  }
}

/**
 * The gate runs the COMPILED kernel — the artifact a packaged app ships.
 * `moon run` is not an acceptable substitute here: it needs the repo root as
 * cwd, and this gate deliberately runs with a throwaway data root so it
 * cannot leave residue in the repo.
 */
function findKernelBinary() {
  const env = String(process.env.BITBOT_KERNEL_BIN || "").trim();
  if (env && fs.existsSync(env)) return env;
  for (const profile of ["debug", "release"]) {
    for (const name of ["desktop_turn", "desktop_turn.exe"]) {
      const p = path.join(
        ROOT,
        "_build",
        "native",
        profile,
        "build",
        "cmd",
        "desktop_turn",
        name,
      );
      if (fs.existsSync(p)) return p;
    }
  }
  return "";
}

async function main() {
  const kernelBin = findKernelBinary();
  if (!kernelBin) {
    console.error(
      "FAIL PT0 — no compiled kernel found. Run `bash scripts/prove_product_tools.sh`,",
    );
    console.error(
      "       or `moon build --target native` first (this gate needs the binary,",
    );
    console.error("       not `moon run`: it must run with a throwaway data root).");
    process.exit(1);
  }
  process.env.BITBOT_KERNEL_BIN = kernelBin;

  const stub = await startStub();
  stubPort = stub.port;
  // The Host writes to DATA_ROOT itself; the kernel writes to `data/`
  // relative to its cwd, which is the PARENT of DATA_ROOT. So DATA_ROOT has
  // to be <root>/data for both sides to land in the same place.
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-pt-"));
  const dataRoot = path.join(tmpRoot, "data");
  fs.mkdirSync(dataRoot, { recursive: true });

  process.env.BITBOT_LLM_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
  process.env.BITBOT_LLM_API_KEY = "stub-key";
  process.env.BITBOT_LLM_MODEL = "stub-model";
  // The product path streams by default; keep it that way so the gate proves
  // the transport the product actually uses. PT6 covers the other one.
  process.env.BITBOT_LLM_STREAM = "1";
  delete process.env.BITBOT_LOOP_APPROVAL;
  delete process.env.BITBOT_LEGACY_CHAT_EFFECT;
  delete process.env.BITBOT_LEGACY_GUARDED_RERUN;

  const runner = createTurnRunner(ROOT, { dataRoot });
  runner.ffi.setLlmStreamHandler(() => {});

  // ---- PT1: the model is OFFERED the product tools -------------------
  const before = stub.posts.length;
  const routine = await runner.runTurn("PT1-ROUTINE", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt1",
    timeoutMs: 300000,
  });
  const firstPost = stub.posts[before] || {};
  const offered = Array.isArray(firstPost.tools)
    ? firstPost.tools.map((t) =>
        String((t && t.function && t.function.name) || (t && t.name) || ""),
      )
    : [];
  check(
    offered.includes("describe_schedule") &&
      offered.includes("create_teammate") &&
      offered.includes("create_routine"),
    "PT1 provider was offered the three product tools",
    JSON.stringify(offered),
  );
  check(
    offered.includes("Read") && offered.includes("Shell") && offered.includes("TodoWrite"),
    "PT1 the original three tools are still offered",
    JSON.stringify(offered),
  );

  // ---- PT2: the kernel really dispatched create_routine --------------
  const rEff = findEffect(routine, "routine_schedule");
  check(!!rEff, "PT2 create_routine produced a routine_schedule effect", JSON.stringify(effectKinds(routine)));
  if (rEff) {
    check(
      String(rEff.command || "").includes("0 8 * * *"),
      "PT2 the Chinese schedule became the right cron",
      rEff.command,
    );
    check(
      String(rEff.command || "").includes("采集AI科技热点并发我邮箱"),
      "PT2 the prompt travelled with the effect",
      rEff.command,
    );
  }
  check(
    routine.agent_stop === "Final",
    "PT2 the loop finished after the tool result",
    String(routine.agent_stop),
  );
  check(
    !blobOf(routine).includes("exec refused: create_routine"),
    "PT2 the kernel ran the tool, the Host never refused it",
    blobOf(routine).slice(0, 200),
  );

  // ---- PT3: the kernel really dispatched create_teammate --------------
  const t = await runner.runTurn("PT2-TEAMMATE", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt2",
    timeoutMs: 300000,
  });
  const tEff = findEffect(t, "teammate_create");
  check(!!tEff, "PT3 create_teammate produced a teammate_create effect", JSON.stringify(effectKinds(t)));
  if (tEff) {
    check(
      String(tEff.command || "").includes("选题") &&
        String(tEff.command || "").includes("热点选题"),
      "PT3 the teammate name and role travelled with the effect",
      tEff.command,
    );
  }

  // ---- PT4 (negative): an unparsable schedule leaves NO effect -------
  const b = await runner.runTurn("PT3-BADSCHEDULE", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt3",
    timeoutMs: 300000,
  });
  check(
    !findEffect(b, "routine_schedule"),
    "PT4 an unparsable schedule produced no routine_schedule effect",
    JSON.stringify(effectKinds(b)),
  );
  const bPosts = stub.posts.slice(before);
  const sawError = bPosts.some((p) =>
    JSON.stringify(p.messages || []).includes("routine_error"),
  );
  check(
    sawError,
    "PT4 the model was told the schedule was not understood (honest error)",
    "",
  );

  // ---- PT5 (negative): a missing required arg leaves NO effect -------
  const m = await runner.runTurn("PT4-NOROLE", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt4",
    timeoutMs: 300000,
  });
  check(
    !findEffect(m, "teammate_create"),
    "PT5 a missing role produced no teammate_create effect",
    JSON.stringify(effectKinds(m)),
  );

  // ---- PT7: web_search really searches (real provider path) ---------
  process.env.BITBOT_SEARCH_PROVIDER = "tavily";
  process.env.BITBOT_SEARCH_API_KEY = "stub-search-key";
  process.env.BITBOT_SEARCH_API_BASE = `http://127.0.0.1:${stub.port}`;
  const s = await runner.runTurn("PT7-SEARCH", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt7",
    timeoutMs: 300000,
  });
  const sPosts = stub.posts.slice(before);
  const sawSources = sPosts.some((p) =>
    JSON.stringify(p.messages || []).includes("example.com"),
  );
  check(
    sawSources,
    "PT7 web_search returned real sources to the model",
    JSON.stringify(sPosts.map((p) => (p.messages || []).length)),
  );
  check(
    !blobOf(s).includes("exec refused: web_search"),
    "PT7 the Host ran web_search (not refused)",
    blobOf(s).slice(0, 200),
  );

  // ---- PT8: no search key -> honest failure, not a fake empty result -
  delete process.env.BITBOT_SEARCH_API_KEY;
  const nk = await runner.runTurn("PT8-SEARCHNOKEY", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt8",
    timeoutMs: 300000,
  });
  const nkPosts = stub.posts.slice(before);
  const sawNoKey = nkPosts.some((p) =>
    JSON.stringify(p.messages || []).includes("search_key_not_configured"),
  );
  check(
    sawNoKey,
    "PT8 an unconfigured search key is reported honestly",
    "",
  );
  check(
    !blobOf(nk).includes("exec refused: web_search"),
    "PT8 the Host answered, it did not refuse the tool",
    blobOf(nk).slice(0, 200),
  );

  // ---- PT9: web_fetch really reads a page ---------------------------
  const f = await runner.runTurn("PT9-FETCH", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt9",
    timeoutMs: 300000,
  });
  const fPosts = stub.posts.slice(before);
  const sawBody = fPosts.some((p) =>
    JSON.stringify(p.messages || []).includes("body_prefix"),
  );
  check(sawBody, "PT9 web_fetch returned the page body to the model", "");
  check(
    !blobOf(f).includes("exec refused: web_fetch"),
    "PT9 the Host ran web_fetch (not refused)",
    blobOf(f).slice(0, 200),
  );

  // ---- PT10 (negative): send_mail WITHOUT approval must not send ----
  delete process.env.BITBOT_LOOP_APPROVAL;
  const m0 = await runner.runTurn("PT10-MAILNOAPPROVAL", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt10",
    timeoutMs: 300000,
  });
  const m0Posts = stub.posts.slice(before);
  // The kernel's approval gate fires FIRST (requires_approval: true), so the
  // tool never runs at all. The Host's own grant check is the second line of
  // defence — both must refuse.
  const sawRefusal = m0Posts.some((p) => {
    const blob = JSON.stringify(p.messages || []);
    return blob.includes("approval denied") || blob.includes("no approval grant");
  });
  check(sawRefusal, "PT10 send_mail without approval is refused", "");
  const sendsDir = path.join(dataRoot, "mail", "sends");
  const sentFiles = fs.existsSync(sendsDir)
    ? fs.readdirSync(sendsDir).filter((n) => n.endsWith(".json"))
    : [];
  check(
    sentFiles.length === 0,
    "PT10 nothing was written to the mail send ledger",
    JSON.stringify(sentFiles),
  );

  // ---- PT11: send_mail WITH approval runs, and is honest about it ----
  process.env.BITBOT_LOOP_APPROVAL = "allow";
  const m1 = await runner.runTurn("PT11-MAILAPPROVED", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt11",
    timeoutMs: 300000,
  });
  delete process.env.BITBOT_LOOP_APPROVAL;
  const m1Posts = stub.posts.slice(before);
  const sawEml = m1Posts.some((p) =>
    JSON.stringify(p.messages || []).includes("eml_path"),
  );
  check(sawEml, "PT11 an approved send_mail produced a real mail artifact", "");
  const sendsDir2 = path.join(dataRoot, "mail", "sends");
  const sentFiles2 = fs.existsSync(sendsDir2)
    ? fs.readdirSync(sendsDir2).filter((n) => n.endsWith(".json"))
    : [];
  check(
    sentFiles2.length > 0,
    "PT11 the mail send ledger has the send",
    JSON.stringify(sentFiles2),
  );
  // The snapshot must be honest: a sandbox eml is NOT a send.
  let honest = false;
  for (const f2 of sentFiles2) {
    try {
      const row = JSON.parse(
        fs.readFileSync(path.join(sendsDir2, f2), "utf8"),
      );
      if (row && row.sent === true) honest = true;
      if (row && row.pretend_sent === true) honest = true;
      if (row && row.live_mail_residual === true) honest = true;
    } catch (_) {
      /* ignore an unreadable snapshot */
    }
  }
  check(
    honest,
    "PT11 the send snapshot says plainly whether it was really sent",
    "",
  );

  // ---- PT12: a denied tool never runs, and the model is told why -----
  process.env.BITBOT_TOOL_DENY = "web_fetch";
  const dn = await runner.runTurn("PT12-DENIED", {
    turnId: "pt12",
    timeoutMs: 300000,
  });
  delete process.env.BITBOT_TOOL_DENY;
  const dnObs = turnObservations(stub.posts, before);
  check(
    dnObs.includes("denied by policy"),
    "PT12 a policy deny reached the model",
    dnObs.slice(0, 200),
  );
  check(
    !dnObs.includes("body_prefix"),
    "PT12 the denied tool did NOT run",
    dnObs.slice(0, 200),
  );

  // ---- PT13: a limited device needs approval for web_fetch ----------
  delete process.env.BITBOT_LOOP_APPROVAL;
  const lim = await runner.runTurn("PT13-LIMITED", {
    turnId: "pt13",
    deviceTrust: "limited",
    timeoutMs: 300000,
  });
  const limObs = turnObservations(stub.posts, before);
  check(
    limObs.includes("approval denied"),
    "PT13 a limited device had to ask before web_fetch",
    limObs.slice(0, 200),
  );
  check(
    !limObs.includes("body_prefix"),
    "PT13 the limited device's web_fetch did not run unapproved",
    limObs.slice(0, 200),
  );

  // ---- PT14: the same tool on a TRUSTED device runs without asking ---
  const trust = await runner.runTurn("PT13-LIMITED", {
    turnId: "pt14",
    deviceTrust: "trusted",
    timeoutMs: 300000,
  });
  const trustObs = turnObservations(stub.posts, before);
  check(
    trustObs.includes("body_prefix"),
    "PT14 the same tool ran on a trusted device without asking",
    trustObs.slice(0, 200),
  );

  // ---- PT6: the same path on the non-streaming transport -------------
  process.env.BITBOT_LLM_STREAM = "0";
  const ns = await runner.runTurn("PT1-ROUTINE", {
    sessionId: "pt-" + RUN_ID,
    turnId: "pt6",
    timeoutMs: 300000,
  });
  const nsEff = findEffect(ns, "routine_schedule");
  check(
    !!nsEff && String(nsEff.command || "").includes("0 8 * * *"),
    "PT6 the non-streaming transport dispatches product tools too",
    JSON.stringify(effectKinds(ns)),
  );
  process.env.BITBOT_LLM_STREAM = "1";

  // ---- cleanup --------------------------------------------------------
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {
    /* temp dir cleanup is best effort */
  }
  await new Promise((resolve) => stub.server.close(resolve));

  console.log(`prove_product_tools pass=${pass} fail=${fail}`);
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error("FAIL harness", err && err.stack ? err.stack : err);
  process.exit(1);
});
