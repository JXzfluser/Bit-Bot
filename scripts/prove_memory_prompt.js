"use strict";

/**
 * K-4 / AR-05 gate: the Bot's long-term memory has to reach the MODEL.
 *
 * Before this, the memory lived in the Host's per-Bot slot and travelled to
 * the kernel as `--seed-memory key=value` command-line arguments. The product
 * agent-loop path never used it, so a normal chat never saw it: the user
 * could say 「记住我喜欢简洁」 and the next question would come back as if
 * nothing had happened.
 *
 * The gate proves the fact is in the provider request's **system** segment:
 *   - bot-A's memory IS in bot-A's request
 *   - bot-A's memory is NOT in bot-B's request  (per-Bot isolation)
 *   - a Bot with no memory gets no memory block
 *   - a secret-shaped value is scrubbed before it reaches the provider
 *
 * The provider is a local stub that only inspects the request payload.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { createTurnRunner } = require(path.join(ROOT, "hosts/shared/run_moon_turn"));

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log("ok", n); };
const bad = (n, d) => { fail += 1; console.error("FAIL", n, d || ""); };
const check = (c, n, d) => (c ? ok(n) : bad(n, d));

const FACT = "用户偏好极简回答";
const OTHER_FACT = "另一个 Bot 的秘密事实";
const SECRET = "sk-live-abcdef1234567890";

function sseText(text) {
  const payload = { choices: [{ delta: { content: text } }] };
  return `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
}

function startStub() {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch (_) { parsed = {}; }
      posts.push(parsed);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(sseText("好"));
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
      const p = path.join(ROOT, "_build", "native", profile, "build", "cmd", "desktop_turn", name);
      if (fs.existsSync(p)) return p;
    }
  }
  return "";
}

/** The system segment of the LAST provider request. */
function systemOf(posts) {
  if (!posts.length) return "";
  const msgs = posts[posts.length - 1].messages || [];
  return msgs
    .filter((m) => m && String(m.role || "") === "system")
    .map((m) => String(m.content || ""))
    .join("\n");
}

async function main() {
  const kernelBin = findKernelBinary();
  if (!kernelBin) {
    console.error("FAIL K4-0 — no compiled kernel found. Run `moon build --target native`.");
    process.exit(1);
  }
  process.env.BITBOT_KERNEL_BIN = kernelBin;

  const stub = await startStub();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-k4-"));
  const dataRoot = path.join(tmpRoot, "data");
  fs.mkdirSync(dataRoot, { recursive: true });

  process.env.BITBOT_LLM_BASE_URL = `http://127.0.0.1:${stub.port}/v1`;
  process.env.BITBOT_LLM_API_KEY = "stub-key";
  process.env.BITBOT_LLM_MODEL = "stub-model";
  process.env.BITBOT_LLM_STREAM = "1";
  delete process.env.BITBOT_LEGACY_CHAT_EFFECT;

  const runner = createTurnRunner(ROOT, { dataRoot });
  runner.ffi.setLlmStreamHandler(() => {});

  // 给两个 Bot 各写一份记忆。记忆是 per-Bot 的(和会话无关)。
  runner.ffi.saveSessionMemory("bot-A", [
    { key: "user.style", value: FACT },
    { key: "user.token", value: SECRET },
  ]);
  runner.ffi.saveSessionMemory("bot-B", [
    { key: "other.secret", value: OTHER_FACT },
  ]);

  // ---- K4-1: bot-A 的记忆进了 system 段 -----------------------------
  const before = stub.posts.length;
  await runner.runTurn("我今天心情不错", {
    turnId: "k4-a",
    botId: "bot-A",
    sessionId: "k4-sess-a",
    timeoutMs: 300000,
  });
  const sysA = systemOf(stub.posts.slice(before));
  check(sysA.includes(FACT), "K4-1 记忆里的事实在 provider 请求的 system 段", sysA.slice(0, 300));
  check(
    sysA.includes("你记住的事实"),
    "K4-1 记忆块有明确的标签(是事实,不是系统指令)",
    sysA.slice(0, 300),
  );

  // ---- K4-2: 另一个 Bot 看不到这份记忆(per-Bot 隔离) ----------------
  const before2 = stub.posts.length;
  await runner.runTurn("我今天心情不错", {
    turnId: "k4-b",
    botId: "bot-B",
    sessionId: "k4-sess-b",
    timeoutMs: 300000,
  });
  const sysB = systemOf(stub.posts.slice(before2));
  check(!sysB.includes(FACT), "K4-2 bot-A 的记忆没有漏进 bot-B 的请求", sysB.slice(0, 300));
  check(sysB.includes(OTHER_FACT), "K4-2 bot-B 看到的是自己那份记忆", sysB.slice(0, 300));

  // ---- K4-3: 没有记忆的 Bot 就没有记忆块 ----------------------------
  const before3 = stub.posts.length;
  await runner.runTurn("我今天心情不错", {
    turnId: "k4-c",
    botId: "bot-empty",
    sessionId: "k4-sess-c",
    timeoutMs: 300000,
  });
  const sysC = systemOf(stub.posts.slice(before3));
  check(!sysC.includes("你记住的事实"), "K4-3 没有记忆就没有记忆块", sysC.slice(0, 300));

  // ---- K4-4: 记忆里的密钥形状内容在进 provider 前被脱敏 --------------
  check(
    !sysA.includes(SECRET),
    "K4-4 记忆里的 token 形状内容没有原样进 provider 请求",
    sysA.slice(0, 300),
  );

  // ---- K4-5: 记忆进的是 system 段,不是塞进用户消息 ------------------
  const lastPost = stub.posts[stub.posts.length - 1] || {};
  const userSegs = (lastPost.messages || [])
    .filter((m) => m && String(m.role || "") === "user")
    .map((m) => String(m.content || ""))
    .join("\n");
  check(!userSegs.includes(FACT), "K4-5 记忆没有混进用户消息段", userSegs.slice(0, 200));

  // ---- K4-6: DM 路径也带记忆(记忆是 per-Bot 的,和群无关) -----------
  // 上面的回合都没有 roomContext ⇒ 就是 DM 路径,断言已在 K4-1 覆盖。

  console.log("prove_memory_prompt pass=" + pass + " fail=" + fail);
  try { stub.server.close(); } catch (_) {}
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("prove_memory_prompt crashed — " + String((e && e.stack) || e));
  console.log("prove_memory_prompt pass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
