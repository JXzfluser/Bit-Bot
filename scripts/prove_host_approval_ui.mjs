/* Live Host approval UI.
 * AU1–AU4 are the minimum bar. Labels match docs/agent-core/05-security-host-approval-ui.md.
 * A missing Electron, display, or moon toolchain fails the script.
 * This does not close AR-15, does not promote P0-3 to I, and does not claim MVP.
 *
 * Usage: bash scripts/prove_host_approval_ui.sh
 */
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { createRequire as __createRequire } from "module";
const __require = __createRequire(import.meta.url);
const { currentTurn } = __require("./agent_turn_scene.js");
import { electronLaunchEnv, electronUserDataDir, hasDisplay } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const require = createRequire(path.join(DESKTOP, "package.json"));
const { createProductSession } = require(path.join(REPO, "hosts/shared/agent_loop_product_wire.js"));
const {
  createApprovalGate,
  canonicalAction,
  actionFromKind,
} = require(path.join(REPO, "hosts/shared/host_approval_gate.js"));

const marker = path.join(os.tmpdir(), `bitbot-au5-${process.pid}.txt`);
const markerCmd = `printf au5-ok > ${marker}`;

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

function shellCommandFor(blob) {
  if (blob.includes("AU-CLI-DENY")) return "echo cli-deny";
  if (blob.includes("AU-CLI")) return "echo cli-allow";
  if (blob.includes("AU-SAVED")) return "echo saved-allow";
  if (blob.includes("AU-DENY")) return "echo deny-me";
  if (blob.includes("AU-ALLOW")) return markerCmd;
  return "";
}

function classify(body) {
  // Scene from THIS turn's user message, tool results from THIS turn's tail:
  // the payload also carries earlier turns (ADR 0011).
  const { last, tail } = currentTurn(body);
  if (tail.includes("[product-shell]")) return { kind: "text", text: "shell ran" };
  if (tail.includes("approval denied")) return { kind: "text", text: "shell stayed off" };
  const command = shellCommandFor(last);
  if (command) {
    return {
      kind: "tool",
      name: "Shell",
      arguments: JSON.stringify({ command, approved: true }),
      id: "c-au",
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
      res.end(JSON.stringify({ choices: [{ message: { content: scene.text } }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, posts, port: server.address().port });
    });
  });
}

function isolatedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-au-root-"));
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

async function poll(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function nodeChecks() {
  const wire = read("hosts/shared/agent_loop_product_wire.js");
  check(!/\bwhile\b/.test(wire), "wire module has no while");
  const execFn = sliceBetween(wire, "function execProductTool", "async function decideApproval");
  check(!execFn.includes("args.approved") && !execFn.includes(".approved"), "AU4 exec does not read args.approved");

  const main = read("hosts/desktop/main.js");
  const handler = sliceBetween(main, 'ipcMain.handle("bitbot:turn",', 'ipcMain.handle("bitbot:msg:regenerate"');
  check(handler.includes("cliApproved: false"), "AU4 composer turn does not take a CLI grant from the renderer");
  check(!handler.includes("approved: true"), "AU4 composer turn handler adds no approved:true");
  check(!handler.includes("cn-probe"), "AU6 composer turn does not use the cn-probe session");
  const allowed = sliceBetween(main, 'ipcMain.handle("bitbot:approvals:runAllowed"', 'ipcMain.handle("bitbot:rooms:list"');
  check(allowed.indexOf("no_grant") >= 0 && allowed.indexOf("no_grant") < allowed.indexOf("approved: true"), "AU4 runAllowed checks the grant before approved:true");
  check(allowed.includes("approved: true"), "AU5 runAllowed keeps the approved execute");
  const probe = sliceBetween(main, 'ipcMain.handle("bitbot:secrets:probeCnChannels"', "async function ensureCnInbound");
  check(probe.includes('sessionId: "cn-probe"') && probe.includes("approved: true"), "AU6 cn-probe channel probe stays");
  const inbound = sliceBetween(main, "async function ensureCnInbound", "app.whenReady");
  check(inbound.includes("approved: false") && !inbound.includes("approved: true"), "AU7 desktop inbound default is not an approval grant");
  const productOnTurn = read("hosts/shared/cn_inbound_product_on_turn.js");
  check(productOnTurn.includes("approved: false") && !productOnTurn.includes("approved: true"), "AU7 product onTurn default is not an approval grant");
  const cli = read("hosts/cli_host/run_turn.js");
  check(cli.includes('a === "--approved"') && cli.includes("cliApproved: approved === true"), "AU5 CLI --approved is the grant flag");
  const card = sliceBetween(read("hosts/desktop/index.html"), "function showLoopApproval", "// end loop approval card");
  check(card.includes("answerLoopApproval") && !card.includes("runUserTurn") && !card.includes("executeLlmChat") && !card.includes("turn("), "AU2 card answers in place and does not start a turn");
  const dirty = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" });
  check(!/capability-matrix\.md/.test(dirty), "capability matrix untouched");
  check(!/h6-matrix-i/.test(dirty), "H4 matrix artifacts untouched");

  const forgedArgs = JSON.stringify({ command: "echo hi", approved: true });
  check(
    canonicalAction("Shell", forgedArgs) === actionFromKind("shell", "echo hi"),
    "AU4 approved in args is not part of the action key",
  );
  const gate = createApprovalGate();
  const echoA = actionFromKind("shell", "echo a");
  gate.record({ turnId: "t1", action: echoA, source: "ui" });
  check(gate.peek("t2", echoA) === null, "AU4 cross-turn grant does not match");
  check(gate.peek("t1", actionFromKind("shell", "echo b")) === null, "AU4 wrong action does not match");
  check(Boolean(gate.consume("t1", echoA)), "AU5 same turn and action consumes the grant");
  check(gate.consume("t1", echoA) === null, "AU5 grant is one shot");
  check(gate.record({ turnId: "t1", action: echoA, source: "forged" }) === null, "AU4 unknown grant source is refused");

  const bare = createProductSession({});
  const refused = await bare.dispatch({
    op: "exec_tool",
    name: "Shell",
    arguments: forgedArgs,
  });
  check(String(refused.output || "").includes("no approval grant"), "AU4 args.approved does not grant", refused.output);

  const denied = createProductSession({}, {
    turnId: "t-deny",
    requestApproval: async () => ({ verdict: "deny" }),
  });
  const denyVerdict = await denied.dispatch({
    op: "request_approval",
    name: "Shell",
    arguments: forgedArgs,
  });
  const denyExec = await denied.dispatch({
    op: "exec_tool",
    name: "Shell",
    arguments: forgedArgs,
  });
  check(denyVerdict.verdict === "deny", "AU4 UI deny ignores args.approved");
  check(String(denyExec.output || "").includes("no approval grant"), "AU4 denied shell does not exec");

  process.env.BITBOT_LOOP_APPROVAL = "allow";
  const callbackWins = createProductSession({}, {
    requestApproval: async () => ({ verdict: "deny" }),
  });
  const callbackVerdict = await callbackWins.dispatch({
    op: "request_approval",
    name: "Shell",
    arguments: forgedArgs,
  });
  check(callbackVerdict.verdict === "deny", "AU4 BITBOT_LOOP_APPROVAL does not override the UI callback");
  const envSession = createProductSession({});
  const envVerdict = await envSession.dispatch({
    op: "request_approval",
    name: "Shell",
    arguments: forgedArgs,
  });
  const envExec = await envSession.dispatch({
    op: "exec_tool",
    name: "Shell",
    arguments: JSON.stringify({ command: "echo hi", approved: true }),
  });
  delete process.env.BITBOT_LOOP_APPROVAL;
  check(envVerdict.verdict === "allow" && String(envExec.output || "").includes("[product-shell] echo hi"), "wire env allow still grants when no UI callback is installed");

  const cliSession = createProductSession({}, { cliApproved: true, turnId: "au5-cli-unit" });
  const cliVerdict = await cliSession.dispatch({
    op: "request_approval",
    name: "Shell",
    arguments: forgedArgs.replace("echo hi", "echo cli"),
  });
  const cliExec = await cliSession.dispatch({
    op: "exec_tool",
    name: "Shell",
    arguments: JSON.stringify({ command: "echo cli", approved: true }),
  });
  const cliOther = await cliSession.dispatch({
    op: "exec_tool",
    name: "Shell",
    arguments: JSON.stringify({ command: "echo other", approved: true }),
  });
  check(cliVerdict.verdict === "allow" && String(cliExec.output || "").includes("[product-shell] echo cli"), "AU5 cliApproved grants that action");
  check(String(cliOther.output || "").includes("no approval grant"), "AU5 cliApproved does not grant a second action");
}

function llmEnv(port) {
  return {
    ...process.env,
    PATH: `${process.env.HOME || ""}/.moon/bin:${process.env.PATH || ""}`,
    MOONBIT_NEW_NATIVE: "0",
    BITBOT_LLM_BASE_URL: `http://127.0.0.1:${port}/v1`,
    BITBOT_LLM_API_KEY: "au-stub-key",
    BITBOT_LLM_MODEL: "au-stub-model",
    BITBOT_LLM_STREAM: "1",
    BITBOT_LLM_TIMEOUT_MS: "120000",
    BITBOT_NO_SECRET_SYNC: "1",
    BITBOT_DESKTOP_AUTOSTART: "0",
    BITBOT_ROUTINE_DAEMON_AUTOSTART: "0",
    BITBOT_CN_INBOUND: "0",
  };
}

async function sendComposer(win, text) {
  await win.fill("#composer #text", text);
  await win.press("#composer #text", "Enter");
}

async function runAllowed(win, info) {
  return win.evaluate(async (payload) => window.bitbot.approvals.runAllowed(payload), info);
}

async function electronChecks() {
  if (!fs.existsSync(ELECTRON)) {
    bad("electron binary", ELECTRON);
    return;
  }
  if (!hasDisplay()) {
    bad("display", "no DISPLAY and no xvfb-run");
    return;
  }
  let moonOk = false;
  try {
    execSync("moon --version", { stdio: "ignore" });
    moonOk = true;
  } catch (_) {
    moonOk = false;
  }
  if (!moonOk) {
    bad("moon toolchain", "moon --version failed");
    return;
  }

  try {
    fs.unlinkSync(marker);
  } catch (_) {
    /* absent */
  }
  const { _electron } = require("playwright-core");
  const stub = await startStub();
  const root = isolatedRoot();
  const trace = path.join(os.tmpdir(), `bitbot-au-trace-${process.pid}.jsonl`);
  fs.writeFileSync(trace, "");
  const userData = electronUserDataDir("au-approval");
  const env = electronLaunchEnv(llmEnv(stub.port));
  env.BITBOT_REPO_ROOT = root;
  env.BITBOT_AGENT_LOOP_TRACE = trace;
  delete env.BITBOT_LEGACY_CHAT_EFFECT;
  delete env.BITBOT_LEGACY_GUARDED_RERUN;
  delete env.BITBOT_LOOP_APPROVAL;
  delete env.BITBOT_APPROVED;

  let app = null;
  let allowResult = null;
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

    const cardless = await runAllowed(win, { kind: "shell", command: markerCmd, turn_id: "no-such-turn", bot_id: "agent-bit" });
    check(cardless && cardless.ok === false && cardless.error === "no_grant", "AU4 cardless runAllowed does not exec", JSON.stringify(cardless));
    check(!fs.existsSync(marker), "AU4 cardless runAllowed wrote no marker");

    const postsBefore = stub.posts.length;
    const traceBefore = traceRows(trace).length;
    await sendComposer(win, "AU-ALLOW");
    const mid = await poll(async () => {
      const rows = traceRows(trace).slice(traceBefore);
      const ops = rows.filter((r) => r.kind === "op").map((r) => r.op);
      const visible = await win.locator("#loop-approval").isVisible().catch(() => false);
      if (visible && ops.includes("request_approval") && !ops.includes("exec_tool")) return { rows, ops };
      return null;
    }, 300000);
    if (!mid) {
      bad("AU1 approval card before exec", `trace=${fs.readFileSync(trace, "utf8").slice(-800)} posts=${stub.posts.length}`);
      return;
    }
    const detail = await win.locator("#loop-approval-detail").innerText();
    const turnId = await win.locator("#loop-approval").getAttribute("data-turn-id");
    check(detail.includes('"approved":true'), "AU1 card is up while args contain approved", detail);
    check(detail.includes(markerCmd), "AU1 card shows the shell command", detail);
    check(Boolean(turnId), "AU1 card carries the turn id");
    check((await win.locator("#send").isDisabled()) === true, "AU1 composer turn still in flight");
    check(!mid.ops.includes("exec_tool"), "AU1 no exec_tool before Allow");
    const forged = await win.evaluate(async () => window.bitbot.answerLoopApproval({ id: "forged-card", decision: "allow" }));
    check(forged && forged.ok === false && forged.error === "no_card" && forged.granted === false, "AU4 answer IPC without the live card does not grant", JSON.stringify(forged));
    check((await win.locator("#loop-approval").isVisible()) === true, "AU4 forged answer leaves the live card up");
    check(!traceRows(trace).slice(traceBefore).some((r) => r.op === "exec_tool"), "AU4 forged answer does not exec");

    const clickAt = Date.now();
    await win.click("#loop-approval-allow");
    const finished = await poll(async () => {
      const raw = await win.locator("#json-out").textContent();
      return raw && raw.includes("shell ran") ? raw : null;
    }, 180000);
    check(Boolean(finished), "AU2 turn finishes after Allow");
    try {
      allowResult = JSON.parse(finished || "{}");
    } catch (err) {
      bad("AU2 turn json", err.message);
      allowResult = {};
    }
    const execRow = traceRows(trace).slice(traceBefore).find((r) => r.op === "exec_tool" && r.at > clickAt);
    check(Boolean(execRow), "AU2 exec_tool trace at is after Allow", JSON.stringify(traceRows(trace).slice(traceBefore)));
    const allowOps = traceRows(trace).slice(traceBefore).filter((r) => r.kind === "op").map((r) => r.op);
    const approvalAt = traceRows(trace).slice(traceBefore).find((r) => r.op === "request_approval");
    check(allowOps.includes("request_approval") && allowOps.indexOf("request_approval") < allowOps.indexOf("exec_tool"), "AU2 request_approval precedes exec_tool");
    check(approvalAt && execRow && approvalAt.at <= clickAt && execRow.at > clickAt, "AU2 approval trace is not after the click");
    const obs = stub.posts.slice(postsBefore).map((p) => JSON.stringify(p.messages || [])).find((s) => s.includes("[product-shell]"));
    check(Boolean(obs) && obs.includes(markerCmd) && obs.includes("[product-shell]"), "AU2 observation is the product shell marker", obs);
    check(allowResult.agent_exec === 1, "AU2 kernel exec once", String(allowResult.agent_exec));
    check(allowResult.session_id !== "cn-probe", "AU6 product turn session is not cn-probe", allowResult.session_id);
    check(!fs.existsSync(marker), "AU2 product shell did not run the host shell");

    const wrongTurn = await runAllowed(win, { kind: "shell", command: markerCmd, turn_id: turnId + "-other", bot_id: "agent-bit" });
    check(wrongTurn && wrongTurn.error === "no_grant", "AU4 cross-turn runAllowed does not exec", JSON.stringify(wrongTurn));
    const wrongAction = await runAllowed(win, { kind: "shell", command: "echo nope", turn_id: turnId, bot_id: "agent-bit" });
    check(wrongAction && wrongAction.error === "no_grant", "AU4 wrong-action runAllowed does not exec", JSON.stringify(wrongAction));
    check(!fs.existsSync(marker), "AU4 mismatched grants wrote no marker");
    const same = await runAllowed(win, { kind: "shell", command: markerCmd, turn_id: turnId, bot_id: "agent-bit" });
    const marked = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : "";
    check(same && same.ok === true && marked.includes("au5-ok"), "AU5 runAllowed same turn and action execs", JSON.stringify(same) + " " + marked);
    const again = await runAllowed(win, { kind: "shell", command: markerCmd, turn_id: turnId, bot_id: "agent-bit" });
    check(again && again.error === "no_grant", "AU5 grant cannot be replayed", JSON.stringify(again));

    const denyBefore = traceRows(trace).length;
    await sendComposer(win, "AU-DENY");
    const denyCard = await poll(async () => {
      const rows = traceRows(trace).slice(denyBefore);
      const ops = rows.filter((r) => r.kind === "op").map((r) => r.op);
      const visible = await win.locator("#loop-approval").isVisible().catch(() => false);
      if (visible && ops.includes("request_approval") && !ops.includes("exec_tool")) return true;
      return null;
    }, 180000);
    check(Boolean(denyCard), "AU3 deny card is up before exec");
    if (denyCard) {
      await win.click("#loop-approval-deny");
      const deniedRaw = await poll(async () => {
        const raw = await win.locator("#json-out").textContent();
        return raw && raw.includes("shell stayed off") ? raw : null;
      }, 180000);
      check(Boolean(deniedRaw), "AU3 deny turn finishes");
      let denied = {};
      try {
        denied = JSON.parse(deniedRaw || "{}");
      } catch (err) {
        bad("AU3 turn json", err.message);
      }
      const denyOps = traceRows(trace).slice(denyBefore).filter((r) => r.kind === "op").map((r) => r.op);
      check(denyOps.includes("request_approval") && !denyOps.includes("exec_tool"), "AU3 no exec_tool after Deny", denyOps.join(","));
      check(denied.agent_exec === 0, "AU3 kernel exec stays zero", String(denied.agent_exec));
      const denyObs = stub.posts.map((p) => JSON.stringify(p.messages || [])).find((s) => s.includes("approval denied"));
      check(Boolean(denyObs), "AU3 observation is approval denied");
    }

    const rule = await win.evaluate(async () => window.bitbot.approvals.rule({
      pattern: "shell:echo saved-allow",
      decision: "allow",
      source: "personal",
    }));
    check(rule && rule.ok === true, "AU5 saved allow rule stored", JSON.stringify(rule));
    const savedBefore = traceRows(trace).length;
    let savedCard = false;
    await sendComposer(win, "AU-SAVED");
    const savedRaw = await poll(async () => {
      if (await win.locator("#loop-approval").isVisible().catch(() => false)) savedCard = true;
      const raw = await win.locator("#json-out").textContent();
      return raw && raw.includes("shell ran") && raw.includes("AU-SAVED") ? raw : null;
    }, 180000);
    check(Boolean(savedRaw) && savedCard === false, "AU5 saved allow skips the card and still execs", `card=${savedCard}`);
    const savedOps = traceRows(trace).slice(savedBefore).filter((r) => r.kind === "op").map((r) => r.op);
    check(savedOps.includes("request_approval") && savedOps.includes("exec_tool"), "AU5 saved allow still goes through request_approval then exec", savedOps.join(","));
  } finally {
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
  }
}

function runCli(args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, "hosts/cli_host/run_turn.js"), ...args], {
      cwd: REPO,
      env,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("close", () => {
      clearTimeout(timer);
      const lines = out.trim().split(/\n/).filter(Boolean);
      const raw = lines[lines.length - 1] || "";
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        parsed = null;
      }
      resolve({ parsed, out, err, raw });
    });
  });
}

async function cliChecks() {
  const stub = await startStub();
  const env = llmEnv(stub.port);
  delete env.BITBOT_LOOP_APPROVAL;
  delete env.BITBOT_APPROVED;
  delete env.BITBOT_LEGACY_CHAT_EFFECT;
  try {
    const allowed = await runCli(["--approved", "--turn-id", "au5-cli", "AU-CLI"], env, 300000);
    const ops = (allowed.parsed && allowed.parsed.loop_trace && allowed.parsed.loop_trace.kernel_ops) || [];
    check(allowed.parsed && allowed.parsed.agent_exec === 1, "AU5 CLI --approved execs that turn", allowed.raw.slice(0, 400) || allowed.err.slice(-400));
    check(ops.includes("request_approval") && ops.includes("exec_tool"), "AU5 CLI --approved still requests approval then execs", ops.join(","));
    const obs = stub.posts.map((p) => JSON.stringify(p.messages || [])).find((s) => s.includes("[product-shell] echo cli-allow"));
    check(Boolean(obs), "AU5 CLI observation is the product shell marker");
    const postsAfter = stub.posts.length;
    const denied = await runCli(["--turn-id", "au5-cli-off", "AU-CLI-DENY"], env, 180000);
    const denyOps = (denied.parsed && denied.parsed.loop_trace && denied.parsed.loop_trace.kernel_ops) || [];
    check(denied.parsed && denied.parsed.agent_exec === 0, "AU5 CLI without --approved does not exec", denied.raw.slice(0, 400));
    check(denyOps.includes("request_approval") && !denyOps.includes("exec_tool"), "AU5 CLI without the flag stops at request_approval", denyOps.join(","));
    check(stub.posts.length > postsAfter, "AU5 CLI deny still reached the provider");
  } finally {
    try {
      stub.server.close();
    } catch (_) {
      /* ignore */
    }
  }
}

function wpSot() {
  let out = "";
  try {
    out = execSync("bash scripts/prove_agent_loop_product_wire.sh", {
      cwd: REPO,
      encoding: "utf8",
      timeout: 600000,
      env: {
        ...process.env,
        PATH: `${process.env.HOME || ""}/.moon/bin:${process.env.PATH || ""}`,
        MOONBIT_NEW_NATIVE: "0",
      },
    });
  } catch (err) {
    out = `${err.stdout || ""}\n${err.stderr || ""}`;
    bad("wire WP SoT", out.slice(-800));
    return;
  }
  const summary = out.match(/prove_agent_loop_product_wire pass=(\d+) fail=(\d+)/);
  check(Boolean(summary) && summary[2] === "0" && Number(summary[1]) > 0, "wire WP SoT fail=0", summary && summary[0]);
  check(out.includes("prove_agent_loop_product_wire done"), "wire product wire script finished");
  check(/failed: 0/.test(out) && !/failed: [1-9]/.test(out), "wire moon tests failed: 0");
}

async function main() {
  await nodeChecks();
  await electronChecks();
  await cliChecks();
  wpSot();
  console.log(`prove_host_approval_ui pass=${pass} fail=${fail}`);
  if (fail) process.exit(1);
}

main().catch((err) => {
  console.error("FAIL harness", err && err.stack ? err.stack : err);
  process.exit(1);
});
