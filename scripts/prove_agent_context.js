"use strict";

/**
 * AC — K-1/K-3 gate: the agent context survives the process.
 *
 * The kernel is spawned per turn, so an in-process context dies with the
 * process. This gate proves the context CROSSES that boundary:
 *   - turn 1 plants a fact
 *   - turn 2 (same Bot) must SEE it — that is the "it remembers me" moment
 *   - turn 3 (a DIFFERENT Bot) must NOT see it — the slot isolation
 *   - the context file really lands on disk
 *
 * What it does NOT prove: that the model uses the remembered fact well. The
 * provider is a local stub that only checks whether the fact is PRESENT in
 * the request payload.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { createTurnRunner } = require(path.join(ROOT, "hosts/shared/run_moon_turn"));

let pass = 0;
let fail = 0;

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

const FACT = "4271";

function sseText(text) {
  const payload = { choices: [{ delta: { content: text } }] };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

function sseTool(name, args, id) {
  const payload = {
    choices: [
      {
        delta: {
          tool_calls: [
            { index: 0, id, type: "function", function: { name, arguments: args } },
          ],
        },
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

/**
 * The stub answers by scene. `AC-SEED` plants the fact; `AC-ASK` must arrive
 * with the fact already in the payload — that is the whole point.
 */
/**
 * The scene is decided by the LAST user message, not by the whole payload:
 * once the context is carried, the payload contains the PREVIOUS turn's user
 * text too — matching the whole blob would answer every scene with the
 * oldest one.
 */
function lastUserText(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i];
    if (m && String(m.role || "") === "user") return String(m.content || "");
  }
  return "";
}

function classify(body) {
  const blob = JSON.stringify(body.messages || []);
  const last = lastUserText(body);
  // Longer marker first: "AC-ASK-OTHER" contains "AC-ASK".
  if (last.includes("AC-ASK-OTHER")) {
    if (blob.includes(FACT)) return { kind: "text", text: "LEAKED" };
    return { kind: "text", text: "ISOLATED" };
  }
  if (last.includes("AC-ASK")) {
    if (blob.includes(FACT)) return { kind: "text", text: "REMEMBERED" };
    return { kind: "text", text: "FORGOT" };
  }
  if (last.includes("AC-SEED")) {
    // The tool already ran: the observation is in the payload.
    if (blob.includes("teammate created")) return { kind: "text", text: "seeded" };
    return {
      kind: "tool",
      name: "create_teammate",
      arguments: JSON.stringify({ name: "记事", role: "记事实" }),
      id: "c-seed",
    };
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
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (_) {
        parsed = {};
      }
      posts.push(parsed);
      const scene = classify(parsed);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        scene.kind === "tool"
          ? sseTool(scene.name, scene.arguments, scene.id)
          : sseText(scene.text),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, posts, port: server.address().port });
    });
  });
}

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

function messagesOf(turn) {
  try {
    return (Array.isArray(turn && turn.messages) ? turn.messages : [])
      .map((m) => String((m && m.text) || ""))
      .join("\n");
  } catch (_) {
    return "";
  }
}

async function main() {
  const kernelBin = findKernelBinary();
  if (!kernelBin) {
    console.error("FAIL AC0 — no compiled kernel found. Run `moon build --target native`.");
    process.exit(1);
  }
  process.env.BITBOT_KERNEL_BIN = kernelBin;

  const stub = await startStub();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-ac-"));
  const dataRoot = path.join(tmpRoot, "data");
  fs.mkdirSync(dataRoot, { recursive: true });

  process.env.BITBOT_LLM_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
  process.env.BITBOT_LLM_API_KEY = "stub-key";
  process.env.BITBOT_LLM_MODEL = "stub-model";
  process.env.BITBOT_LLM_STREAM = "1";
  delete process.env.BITBOT_LOOP_APPROVAL;
  delete process.env.BITBOT_LEGACY_CHAT_EFFECT;

  const runner = createTurnRunner(ROOT, { dataRoot });
  runner.ffi.setLlmStreamHandler(() => {});

  // ---- AC1: plant a fact --------------------------------------------
  const t1 = await runner.runTurn(`AC-SEED 请记住这个数字 ${FACT}`, {
    turnId: "ac1",
    botId: "bot-A",
    timeoutMs: 300000,
  });
  check(t1 && t1.ok, "AC1 the seeding turn ran", t1 && t1.error);

  // ---- AC2: the context file really landed on disk -------------------
  const ctxDir = path.join(dataRoot, "agent-context");
  const ctxFiles = fs.existsSync(ctxDir) ? fs.readdirSync(ctxDir) : [];
  check(
    ctxFiles.some((n) => n.endsWith(".ctx")),
    "AC2 the agent context was persisted to disk",
    JSON.stringify(ctxFiles),
  );
  const ctxFile = ctxFiles.find((n) => n.endsWith(".ctx"));
  let ctxText = "";
  if (ctxFile) {
    try {
      ctxText = fs.readFileSync(path.join(ctxDir, ctxFile), "utf8");
    } catch (_) {
      ctxText = "";
    }
  }
  check(
    ctxText.includes(FACT),
    "AC2 the persisted context contains the fact",
    ctxText.slice(0, 200),
  );

  // ---- AC3: the NEXT turn (same Bot) must SEE the fact ---------------
  const before = stub.posts.length;
  const t2 = await runner.runTurn("AC-ASK 我刚才让你记的数字是多少", {
    turnId: "ac2",
    botId: "bot-A",
    timeoutMs: 300000,
  });
  const askPosts = stub.posts.slice(before);
  const sawFact = askPosts.some((p) =>
    JSON.stringify(p.messages || []).includes(FACT),
  );
  check(sawFact, "AC3 the next turn's provider payload carried the fact", "");
  check(
    messagesOf(t2).includes("REMEMBERED"),
    "AC3 the model saw the fact (answered REMEMBERED, not FORGOT)",
    messagesOf(t2).slice(0, 200),
  );

  // ---- AC4: a DIFFERENT Bot must NOT see it (slot isolation) ---------
  const before2 = stub.posts.length;
  const t3 = await runner.runTurn("AC-ASK-OTHER 另一个 Bot 看得见吗", {
    turnId: "ac3",
    botId: "bot-B",
    timeoutMs: 300000,
  });
  const otherPosts = stub.posts.slice(before2);
  const leaked = otherPosts.some((p) =>
    JSON.stringify(p.messages || []).includes(FACT),
  );
  check(!leaked, "AC4 another Bot's slot did NOT carry the fact", "");
  check(
    messagesOf(t3).includes("ISOLATED"),
    "AC4 the other Bot answered ISOLATED, not LEAKED",
    messagesOf(t3).slice(0, 200),
  );

  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (_) {
    /* temp dir cleanup is best effort */
  }
  await new Promise((resolve) => stub.server.close(resolve));

  console.log(`prove_agent_context pass=${pass} fail=${fail}`);
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error("FAIL harness", err && err.stack ? err.stack : err);
  process.exit(1);
});
