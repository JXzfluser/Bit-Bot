/* Live Electron composer mid-run.
 * EG1–EG3 are the minimum bar for the Chat GUI residual.
 * A missing Electron, display, or moon toolchain fails the script.
 * This does not close the AR status column and does not claim MVP.
 *
 * Usage: bash scripts/prove_electron_chat_agent_loop.sh
 */
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, hasDisplay } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);

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

function sliceBetween(src, start, end) {
  const i = src.indexOf(start);
  if (i < 0) return "";
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? src.slice(i) : src.slice(i, j);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

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

function classify(body) {
  const blob = JSON.stringify(body.messages || []);
  if (blob.includes("cursor_untrusted_data")) return { kind: "text", text: "saw file" };
  if (blob.includes("EG-READ")) {
    return { kind: "tool", name: "Read", arguments: "{\"path\":\"a.txt\"}", id: "c-eg" };
  }
  return { kind: "text", text: "plain final" };
}

function startStub() {
  const posts = [];
  const releasers = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", async () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (_) {
        parsed = {};
      }
      posts.push(parsed);
      const scene = classify(parsed);
      const hold = scene.kind === "text" && JSON.stringify(parsed.messages || []).includes("cursor_untrusted_data");
      if (hold) {
        await new Promise((resolve) => {
          releasers.push(resolve);
        });
      }
      if (parsed.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(scene.kind === "tool" ? sseTool(scene.name, scene.arguments, scene.id) : sseText(scene.text));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (scene.kind === "tool") {
        res.end(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: scene.id,
                type: "function",
                function: { name: scene.name, arguments: scene.arguments },
              }],
            },
          }],
        }));
        return;
      }
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: scene.text } }],
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        posts,
        port: server.address().port,
        release() {
          while (releasers.length) releasers.shift()();
        },
      });
    });
  });
}

function isolatedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-eg-root-"));
  for (const name of fs.readdirSync(REPO)) {
    if (name === "data" || name === ".git") continue;
    fs.symlinkSync(path.join(REPO, name), path.join(root, name));
  }
  fs.mkdirSync(path.join(root, "data", "desktop"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "llm"), { recursive: true });
  return root;
}

function traceRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function sameOps(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function poll(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

function staticChecks() {
  const wire = read("hosts/shared/agent_loop_product_wire.js");
  const pump = sliceBetween(read("hosts/shared/run_moon_turn.js"), "function pumpMoonFfi", "function lastJsonLine");
  const renderer = sliceBetween(read("hosts/desktop/index.html"), "function projectAgentStepRow", "if (window.bitbot && window.bitbot.onAgentLoop)");
  const handler = sliceBetween(read("hosts/desktop/main.js"), 'ipcMain.handle("bitbot:turn"', 'ipcMain.handle("bitbot:msg:regenerate"');
  const main = read("hosts/desktop/main.js");
  const { projectAgentStep } = createRequire(path.join(DESKTOP, "package.json"))(
    path.join(REPO, "hosts/shared/agent_loop_product_wire.js"),
  );
  const entry = projectAgentStep("BITBOT_LOOP entry=AgentLoop::run");
  check(entry && entry.kind === "entry" && entry.agent_entry === "open_turn", "projector entry is open_turn");
  check(projectAgentStep("BITBOT_LOOP op=llm_chat").op === "llm_chat", "projector llm_chat");
  check(projectAgentStep("BITBOT_LOOP op=exec_tool").op === "exec_tool", "projector exec_tool");
  check(projectAgentStep("BITBOT_LOOP op=request_approval").op === "request_approval", "projector request_approval");
  check(projectAgentStep("BITBOT_LOOP op=deliver").op === "deliver", "projector deliver");
  check(projectAgentStep("not a step") === null, "projector drops unknown lines");
  check(!/\bwhile\b/.test(wire), "wire module has no while");
  check(pump.includes("onLoop") && pump.includes("BITBOT_FFI "), "pump forwards loop lines and still answers FFI");
  check(!pump.includes("tool_calls"), "pump does not read tool_calls");
  check(!pump.includes("executeLlmChat"), "pump does not call the provider");
  check(renderer.includes("dataset.agentStep") && !renderer.includes("turn("), "renderer projects steps and does not call turn");
  check(!renderer.includes("executeLlmChat") && !/\bwhile\s*\(/.test(renderer), "renderer projection has no model loop");
  check(handler.includes("onLoop") && handler.includes("projectAgentStep"), "composer IPC forwards kernel steps");
  check(!handler.includes("executeLlmChat") && !/\bwhile\s*\(/.test(handler), "bitbot:turn has no second model loop");
  const allowed = sliceBetween(main, 'ipcMain.handle("bitbot:approvals:runAllowed"', 'ipcMain.handle("bitbot:rooms:list"');
  const probe = sliceBetween(main, 'ipcMain.handle("bitbot:secrets:probeCnChannels"', 'ipcMain.handle("bitbot:product:status"');
  check(allowed.includes("approved: true"), "runAllowed approval site unchanged");
  check(probe.includes('sessionId: "cn-probe"') && probe.includes("approved: true"), "cn-probe approval site unchanged");
  check(!handler.includes("approved: true"), "composer turn handler adds no approved:true");
  const dirty = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
  check(!/capability-matrix\.md/.test(dirty), "capability matrix untouched");
  check(!/h6-matrix-i/.test(dirty), "H4 matrix artifacts untouched");
  check(read("docs/qa/agent-loop-wp1-wp8-gates.md").includes("| WP1 | live PASS |"), "WP1 ruling unchanged");
}

async function main() {
  staticChecks();
  if (!fs.existsSync(ELECTRON)) {
    bad("electron binary", ELECTRON);
  }
  if (!hasDisplay()) bad("display", "no DISPLAY and no xvfb-run");
  let moonOk = false;
  try {
    execSync("moon --version", { stdio: "ignore" });
    moonOk = true;
  } catch (_) {
    moonOk = false;
  }
  if (!moonOk) bad("moon toolchain", "moon --version failed");
  if (fail) {
    console.log(`prove_electron_chat_agent_loop pass=${pass} fail=${fail}`);
    process.exit(1);
  }

  const require = createRequire(path.join(DESKTOP, "package.json"));
  const { _electron } = require("playwright-core");
  const stub = await startStub();
  const root = isolatedRoot();
  const trace = path.join(os.tmpdir(), `bitbot-eg-trace-${process.pid}.jsonl`);
  fs.writeFileSync(trace, "");
  const userData = electronUserDataDir("eg-agent-loop");
  const env = electronLaunchEnv({
    DISPLAY: process.env.DISPLAY || "",
    PATH: `${process.env.HOME || ""}/.moon/bin:${process.env.PATH || ""}`,
    MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
    BITBOT_REPO_ROOT: root,
    BITBOT_NO_SECRET_SYNC: "1",
    BITBOT_DESKTOP_AUTOSTART: "0",
    BITBOT_ROUTINE_DAEMON_AUTOSTART: "0",
    BITBOT_LLM_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
    BITBOT_LLM_API_KEY: "eg-stub-key",
    BITBOT_LLM_MODEL: "eg-stub-model",
    BITBOT_LLM_STREAM: "1",
    BITBOT_LOOP_READ_JSON: JSON.stringify({ "a.txt": "see b.txt" }),
    BITBOT_AGENT_LOOP_TRACE: trace,
    BITBOT_LLM_TIMEOUT_MS: "120000",
  });
  delete env.BITBOT_LEGACY_CHAT_EFFECT;
  delete env.BITBOT_LEGACY_GUARDED_RERUN;
  delete env.BITBOT_LOOP_APPROVAL;

  let app = null;
  try {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [path.join(DESKTOP, "main.js"), `--user-data-dir=${userData}`, "--no-sandbox", "--disable-gpu"],
      cwd: REPO,
      env,
      timeout: 120000,
    });
    const win = await app.firstWindow({ timeout: 60000 });
    await win.waitForSelector("#composer #text", { timeout: 60000 });
    ok("electron composer mounted");
    const bootedHandle = await win.waitForFunction(() => {
      const banner = document.getElementById("banner");
      if (banner && banner.classList.contains("err")) return "err";
      const list = document.getElementById("machine-list");
      const text = list ? list.textContent || "" : "";
      if (text && !text.includes("请求刷新机器列表")) return "machines";
      return false;
    }, { timeout: 300000 });
    const booted = await bootedHandle.jsonValue();
    if (booted !== "machines") {
      const banner = await win.locator("#banner").textContent();
      bad("desktop boot", banner);
      return;
    }
    ok("boot ListMachines finished before the chat turn");

    const hostEnv = await app.evaluate(() => ({
      legacy: process.env.BITBOT_LEGACY_CHAT_EFFECT || "",
      approval: process.env.BITBOT_LOOP_APPROVAL || "",
    }));
    check(hostEnv.legacy === "", "EG5 legacy chat effect is off");
    check(hostEnv.approval === "", "EG6 approval mode is not forced allow");

    await win.fill("#composer #text", "EG-READ");
    await win.press("#composer #text", "Enter");

    const mid = await poll(async () => {
      const rows = traceRows(trace);
      const ops = rows.filter((r) => r.kind === "op").map((r) => r.op);
      const llm = ops.filter((op) => op === "llm_chat").length;
      const saw = await win.locator("#log").innerText();
      const deliver = await win.locator('[data-agent-step="deliver"]').count();
      if (rows.some((r) => r.kind === "entry") && ops.includes("exec_tool") && llm >= 2 && stub.posts.length >= 2 && !saw.includes("saw file") && deliver === 0) {
        return { rows, ops, saw };
      }
      return null;
    }, 180000);

    if (!mid) {
      bad("EG1 mid-run window", `trace=${fs.readFileSync(trace, "utf8")} posts=${stub.posts.length}`);
      return;
    }
    check(mid.rows.some((r) => r.kind === "entry" && r.agent_entry === "open_turn"), "EG1 mid-run trace entry open_turn");
    check((await win.locator('[data-agent-step="entry"]').count()) > 0, "EG1 mid-run DOM projects entry");
    check(!mid.saw.includes("saw file"), "EG1 final assistant text still absent");
    check((await win.locator('[data-agent-step="deliver"]').count()) === 0, "EG4 deliver not projected yet");
    check(mid.ops.includes("llm_chat") && mid.ops.includes("exec_tool"), "EG2 mid-run kernel llm_chat and exec_tool");
    check((await win.locator('[data-agent-step="llm_chat"]').count()) > 0, "EG2 DOM projects llm_chat");
    check((await win.locator('[data-agent-step="exec_tool"]').count()) > 0, "EG2 DOM projects exec_tool");
    check((await win.locator("#agent-step-live").getAttribute("data-agent-steps")) === "live", "EG4 step row is live");
    check((await win.locator("#send").isDisabled()) === true, "EG1 composer turn still in flight");
    const tools = (stub.posts[0] && stub.posts[0].tools) || [];
    check(Array.isArray(tools) && tools.some((t) => t && t.function && t.function.name === "Read"), "EG2 first provider request has Read tool");
    check(stub.posts.length === 2, "EG2 second provider request is already in flight", String(stub.posts.length));
    const llmTrace = mid.ops.filter((op) => op === "llm_chat").length;
    check(llmTrace === stub.posts.length, "EG3 mid-run provider calls equal kernel llm_chat", `${llmTrace} vs ${stub.posts.length}`);
    const second = JSON.stringify((stub.posts[1] && stub.posts[1].messages) || []);
    check(second.includes("cursor_untrusted_data") && second.includes("see b.txt"), "EG5 observation is fenced before the final paint");
    check(!mid.ops.includes("request_approval"), "EG6 Read path did not request approval");

    stub.release();
    const finished = await poll(async () => {
      const text = await win.locator("#log").innerText();
      return text.includes("saw file") ? text : null;
    }, 90000);
    check(Boolean(finished), "EG5 final DOM shows saw file");
    const raw = await win.locator("#json-out").textContent();
    let result = {};
    try {
      result = JSON.parse(raw || "{}");
    } catch (err) {
      bad("turn json", err.message);
      return;
    }
    const traceJson = result.loop_trace || {};
    check(result.agent_loop === true, "EG1 agent_loop json");
    check(result.agent_entry === "open_turn", "EG1 agent_entry open_turn");
    check(traceJson.entry === true, "EG1 loop_trace entry");
    check(sameOps(traceJson.kernel_ops, traceJson.node_ops), "EG3 node ops match kernel ops", JSON.stringify(traceJson));
    const llmDone = (traceJson.kernel_ops || []).filter((op) => op === "llm_chat").length;
    check(llmDone === stub.posts.length, "EG3 provider calls equal kernel llm_chat", `${stub.posts.length} vs ${JSON.stringify(traceJson.kernel_ops)}`);
    check(stub.posts.length === 2, "EG5 two provider calls");
    const assistant = (result.messages || []).filter((m) => m && m.role === "assistant").map((m) => m.text).join("\n");
    check(assistant.includes("saw file"), "EG5 delivered saw file", assistant);
    check((await win.locator("#agent-step-live").getAttribute("data-agent-steps")) === "done", "EG4 projection remains after the turn");
    check((await win.locator('[data-agent-step="deliver"]').count()) > 0, "EG4 deliver projected from the kernel");
    check(result.auto_approved !== true, "EG6 turn did not auto-approve");
  } finally {
    stub.release();
    if (app) {
      try {
        await app.evaluate(({ app: electronApp }) => {
          electronApp.isQuiting = true;
          electronApp.quit();
        });
      } catch (_) {
        /* already gone */
      }
      try {
        await app.close();
      } catch (_) {
        /* already gone */
      }
    }
    try {
      stub.server.close();
    } catch (_) {
      /* ignore */
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log(`prove_electron_chat_agent_loop pass=${pass} fail=${fail}`);
    process.exit(fail ? 1 : 0);
  })
  .catch((err) => {
    console.error("FAIL harness", err && err.stack ? err.stack : err);
    console.log(`prove_electron_chat_agent_loop pass=${pass} fail=${fail + 1}`);
    process.exit(1);
  });
