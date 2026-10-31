"use strict";

/**
 * SK1–SK8. Labels are isomorphic with
 * docs/agent-core/05-security-sandbox-secrets.md §4.
 * This is not P0, not AU, and not an I promotion.
 * prove_p0_inbound_host_checks.js does not close this residual.
 * Does not close AR-15 and does not claim MVP.
 * phone host is not SK7. danger/echo is not SK8.
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const p0 = require("../hosts/shared/p0_security");
const { createHostFfi } = require("../hosts/shared/host_ffi");
const { createCnInboundServer } = require("../hosts/shared/cn_inbound_server");

const ROOT = path.resolve(__dirname, "..");
const SECRET = "sk-sandbox-SECRETVALUE123456";
const TURN = "turn-secret-value-123456";
const OTHER_SECRET = "example-secret-value-123456";
const OTHER_PASSWORD = "example-password-value-123";
const OTHER_WEBHOOK = "https://hooks.example/secret-value";

const BINDING = [
  ["SK1", "allowlist env keeps LC_* PATH HOME BITBOT_TZ and drops secrets"],
  ["SK2", "approval does not release secrets"],
  ["SK3", "shell artifacts do not contain the model key or turn token"],
  ["SK4", "cwd stays inside the allow root"],
  ["SK5", "scrub removes secret values from stdout stderr and inbound logs"],
  ["SK6", "shell timeout kills the child and the buffer cap fail-closes"],
  ["SK7", "health 401 and 413 bodies do not leak the turn token or LLM API key"],
  ["SK8", "regression P0 prove is green, P0-3 stays U, AU is not overturned"],
];

let pass = 0;
let fail = 0;
const seen = new Set();
let section4 = "";

function ok(line) {
  pass += 1;
  const id = String(line).split(/\s+/)[0];
  seen.add(id);
  process.stdout.write("ok " + line + "\n");
}
function bad(line) {
  fail += 1;
  const id = String(line).split(/\s+/)[0];
  seen.add(id);
  process.stdout.write("FAIL " + line + "\n");
}
function note(line) {
  process.stdout.write("note " + line + "\n");
}

function assert(cond, message) {
  if (!cond) throw new Error(message || "assertion failed");
}

function bindingLine(id) {
  const row = BINDING.find((item) => item[0] === id);
  const phrase = row[1];
  const line = id + " " + phrase;
  if (!section4.includes(line)) throw new Error("Binding §4 missing " + line);
  return line;
}

async function withEnv(extra, fn) {
  const prev = {};
  for (const k of Object.keys(extra)) {
    prev[k] = process.env[k];
    if (extra[k] == null) delete process.env[k];
    else process.env[k] = extra[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(extra)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function shellRow(results) {
  return (results || []).find((r) => r && r.kind === "shell") || {};
}

function readTree(dir) {
  if (!fs.existsSync(dir)) return "";
  let out = "";
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out += readTree(p);
    else out += fs.readFileSync(p, "utf8");
  }
  return out;
}

function walkFiles(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (name === "build" || name === ".gradle" || name === "node_modules") continue;
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch (_) {
      continue;
    }
    if (st.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

function markerAlive(marker) {
  const out = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" });
  return out.split("\n").some((line) => line.includes(marker) && !line.includes("prove_sandbox_secrets"));
}

function httpCall(port, method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path: urlPath,
        headers: headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function bodyLeaks(text) {
  return text.includes(SECRET) || text.includes(TURN);
}

async function main() {
  const bindingDoc = fs.readFileSync(
    path.join(ROOT, "docs/agent-core/05-security-sandbox-secrets.md"),
    "utf8",
  );
  const secAt = bindingDoc.indexOf("## 4. Binding");
  const secEnd = bindingDoc.indexOf("\n## ", secAt + 4);
  section4 = bindingDoc.slice(secAt, secEnd === -1 ? undefined : secEnd);
  assert(secAt >= 0 && section4.includes("SK8 "), "Binding §4 missing");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-sk-"));
  const sub = path.join(root, "sub");
  fs.mkdirSync(sub, { recursive: true });
  const ffi = createHostFfi(root);
  const hostSrc = fs.readFileSync(path.join(ROOT, "hosts/shared/host_ffi.js"), "utf8");
  const inboundSrc = fs.readFileSync(path.join(ROOT, "hosts/shared/cn_inbound_server.js"), "utf8");
  const mobileSrc = fs.readFileSync(path.join(ROOT, "hosts/mobile_host/run.js"), "utf8");

  try {
    const child = p0.shellChildEnv({
      LC_MESSAGES: "en_US.UTF-8",
      BITBOT_TZ: "Asia/Shanghai",
      HOME: "/tmp/sk-home",
      BITBOT_LLM_API_KEY: SECRET,
      BITBOT_TURN_TOKEN: TURN,
      EXAMPLE_SECRET: OTHER_SECRET,
      EXAMPLE_PASSWORD: OTHER_PASSWORD,
      EXAMPLE_WEBHOOK: OTHER_WEBHOOK,
      BITBOT_EXTRA: "not-allowlisted",
    });
    const allowedNames = child && Object.keys(child);
    const secretNames = [
      "BITBOT_LLM_API_KEY",
      "BITBOT_TURN_TOKEN",
      "EXAMPLE_SECRET",
      "EXAMPLE_PASSWORD",
      "EXAMPLE_WEBHOOK",
      "BITBOT_EXTRA",
    ];
    assert(child.LC_MESSAGES === "en_US.UTF-8", "LC_MESSAGES dropped");
    assert(child.BITBOT_TZ === "Asia/Shanghai", "BITBOT_TZ dropped");
    assert(child.HOME === "/tmp/sk-home", "HOME dropped");
    assert(child.PATH && child.PATH.includes("/usr/bin"), "PATH was not defaulted");
    for (const name of secretNames) {
      assert(!Object.prototype.hasOwnProperty.call(child, name), "allowlist kept " + name);
    }
    for (const name of allowedNames) {
      assert(p0.shellEnvKeyAllowed(name), "child env has non-allowlisted " + name);
    }
    await withEnv(
      {
        BITBOT_TZ: "Asia/Shanghai",
        BITBOT_LLM_API_KEY: SECRET,
        BITBOT_EXTRA: "not-allowlisted",
      },
      async () => {
        const live = shellRow(
          await ffi.executeHostEffects(
            [{ kind: "shell", command: "printf '%s' \"$BITBOT_TZ|$BITBOT_LLM_API_KEY|$BITBOT_EXTRA\"" }],
            { approved: true },
          ),
        );
        assert(live.ok === true && live.ran === true, "allowlist probe did not run");
        assert(String(live.stdout) === "Asia/Shanghai||", "live env was " + JSON.stringify(live.stdout));
        assert(!JSON.stringify(live).includes(SECRET), "live result contains the model key");
        assert(!JSON.stringify(live).includes("not-allowlisted"), "unknown env leaked");
      },
    );
    ok(bindingLine("SK1"));
  } catch (err) {
    bad("SK1 " + (err && err.message ? err.message : err));
  }

  try {
    await withEnv({ BITBOT_LLM_API_KEY: SECRET, BITBOT_TURN_TOKEN: TURN }, async () => {
      const row = shellRow(
        await ffi.executeHostEffects(
          [{
            kind: "shell",
            command: "printf '%s' \"$BITBOT_LLM_API_KEY|$BITBOT_TURN_TOKEN\"",
          }],
          {
            approved: true,
            env: { BITBOT_LLM_API_KEY: SECRET, PATH: "/no-such-path" },
          },
        ),
      );
      const blob = JSON.stringify(row);
      assert(row.ok === true && row.ran === true, "approved shell did not run");
      assert(String(row.stdout) === "|", "approved stdout was " + JSON.stringify(row.stdout));
      assert(!blob.includes(SECRET) && !blob.includes(TURN), "approved result released a secret");
    });
    ok(bindingLine("SK2"));
  } catch (err) {
    bad("SK2 " + (err && err.message ? err.message : err));
  }

  try {
    await withEnv({ BITBOT_LLM_API_KEY: SECRET, BITBOT_TURN_TOKEN: TURN }, async () => {
      const row = shellRow(
        await ffi.executeHostEffects(
          [{ kind: "shell", command: "printf '%s' '" + SECRET + "|" + TURN + "'" }],
          { approved: true },
        ),
      );
      assert(row.ok === true && row.ran === true && row.path, "artifact probe did not write a file");
      const artifacts = readTree(path.join(root, "data", "host-tools", "shell"));
      assert(artifacts.length > 0, "shell artifacts were empty");
      assert(fs.existsSync(row.path), "artifact path missing on disk");
      assert(!artifacts.includes(SECRET) && !artifacts.includes(TURN), "shell artifacts released a secret");
      assert(artifacts.includes("[redacted]"), "shell artifacts were not scrubbed");
    });
    ok(bindingLine("SK3"));
  } catch (err) {
    bad("SK3 " + (err && err.message ? err.message : err));
  }

  try {
    const outside = shellRow(
      await ffi.executeHostEffects(
        [{ kind: "shell", command: "echo hi" }],
        { approved: true, cwd: "/etc" },
      ),
    );
    assert(outside.ok === false && outside.ran === false && outside.error === "cwd_not_allowlisted", "outside cwd " + JSON.stringify(outside));
    const inside = shellRow(
      await ffi.executeHostEffects(
        [{ kind: "shell", command: "pwd -P" }],
        { approved: true, cwd: sub },
      ),
    );
    assert(inside.ok === true, "inside cwd failed " + JSON.stringify(inside));
    assert(String(inside.stdout).trim() === fs.realpathSync(sub), "pwd was " + JSON.stringify(inside.stdout));
    const link = path.join(root, "escape");
    fs.symlinkSync("/etc", link);
    const escaped = shellRow(
      await ffi.executeHostEffects(
        [{ kind: "shell", command: "pwd -P" }],
        { approved: true, cwd: link },
      ),
    );
    assert(
      escaped.ok === false && escaped.ran === false && escaped.error === "cwd_not_allowlisted",
      "symlink cwd " + JSON.stringify(escaped),
    );
    ok(bindingLine("SK4"));
  } catch (err) {
    bad("SK4 " + (err && err.message ? err.message : err));
  }

  try {
    const scrubbed = p0.scrubDeep(
      { note: "see " + SECRET, list: [SECRET] },
      { BITBOT_LLM_API_KEY: SECRET },
    );
    assert(!JSON.stringify(scrubbed).includes(SECRET), "scrubDeep kept the secret");
    assert(JSON.stringify(scrubbed).includes("[redacted]"), "scrubDeep did not redact");
    assert(inboundSrc.includes("p0.scrubDeep"), "inbound log path does not scrub");
    await withEnv({ BITBOT_LLM_API_KEY: SECRET, BITBOT_TURN_TOKEN: TURN }, async () => {
      const row = shellRow(
        await ffi.executeHostEffects(
          [{ kind: "shell", command: "printf '%s' '" + SECRET + "'" }],
          { approved: true },
        ),
      );
      assert(row.ok === true, "scrub probe failed " + JSON.stringify(row).slice(0, 300));
      assert(row.stdout === "[redacted]", "stdout was " + JSON.stringify(row.stdout));
      assert(!JSON.stringify(row).includes(SECRET), "shell result kept the secret");
      const failed = shellRow(
        await ffi.executeHostEffects(
          [{ kind: "shell", command: "printf '%s' '" + SECRET + "' >&2; exit 1" }],
          { approved: true },
        ),
      );
      assert(failed.ok === false, "stderr probe did not fail");
      assert(!JSON.stringify(failed).includes(SECRET), "stderr result kept the secret");
      assert(String(failed.stderr).includes("[redacted]"), "stderr was not redacted");
    });
    ok(bindingLine("SK5"));
  } catch (err) {
    bad("SK5 " + (err && err.message ? err.message : err));
  }

  try {
    assert(p0.SHELL_TIMEOUT_MS === 30000, "default timeout is " + p0.SHELL_TIMEOUT_MS);
    assert(p0.SHELL_MAX_BUFFER === 256 * 1024, "default buffer is " + p0.SHELL_MAX_BUFFER);
    assert(p0.SHELL_OUTPUT_CAP === 8000, "output cap is " + p0.SHELL_OUTPUT_CAP);
    const callAt = hostSrc.indexOf("await p0.runSandboxedShell");
    assert(callAt >= 0, "host shell does not call runSandboxedShell");
    const call = hostSrc.slice(callAt, callAt + 220);
    assert(!call.includes("timeoutMs"), "host shell overrides the timeout");
    assert(!call.includes("maxBuffer"), "host shell overrides the buffer");
    const marker = "sk6-sleep-" + process.pid + "-" + Date.now();
    const started = Date.now();
    const timed = await p0.runSandboxedShell("sleep 30 #" + marker, {
      cwd: root,
      allowRoots: [root],
      timeoutMs: 1000,
      env: process.env,
    });
    const elapsed = Date.now() - started;
    assert(timed.ok === false && timed.ran === true, "timeout result " + JSON.stringify(timed));
    assert(elapsed < 8000, "timeout took " + elapsed + "ms");
    await new Promise((r) => setTimeout(r, 200));
    assert(!markerAlive(marker), "timed-out sleep is still running");
    const capped = await p0.runSandboxedShell(
      "python3 -c 'import sys; sys.stdout.write(\"Y\"*9000)'",
      { cwd: root, allowRoots: [root], env: process.env },
    );
    assert(capped.ok === true, "cap probe failed " + JSON.stringify(capped).slice(0, 300));
    assert(capped.stdout.length === 8000 && capped.stdout === "Y".repeat(8000), "stdout cap " + capped.stdout.length);
    const overflow = await p0.runSandboxedShell(
      "python3 -c 'import sys; sys.stdout.write(\"Z\"*4000)'",
      { cwd: root, allowRoots: [root], maxBuffer: 500, env: process.env },
    );
    assert(overflow.ok === false && overflow.ran === true, "buffer probe " + JSON.stringify(overflow).slice(0, 300));
    assert(String(overflow.error).includes("maxBuffer"), "buffer error " + overflow.error);
    assert(String(overflow.stdout).length <= 8000, "overflow stdout was not capped");
    ok(bindingLine("SK6"));
  } catch (err) {
    bad("SK6 " + (err && err.message ? err.message : err));
  }

  try {
    const inboundRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-sk7-"));
    let wakes = 0;
    await withEnv({ BITBOT_LLM_API_KEY: SECRET, BITBOT_TURN_TOKEN: TURN }, async () => {
      const server = createCnInboundServer({
        repoRoot: inboundRoot,
        port: 0,
        host: "127.0.0.1",
        turnToken: TURN,
        onTurn: async () => {
          wakes += 1;
          return { ok: true, messages: [], stdout: "" };
        },
      });
      try {
        const started = await server.start();
        const port = started.port;
        const health = await httpCall(port, "GET", "/health", {}, null);
        const denied = await httpCall(
          port,
          "POST",
          "/v1/turn",
          { "Content-Type": "application/json", "Content-Length": Buffer.byteLength('{"text":"hi"}') },
          '{"text":"hi"}',
        );
        const bulky = Buffer.alloc(p0.DEFAULT_MAX_BODY_BYTES + 1, 0x61);
        const tooBig = await httpCall(
          port,
          "POST",
          "/v1/turn",
          {
            "Content-Type": "application/json",
            "Content-Length": String(bulky.length),
            Authorization: "Bearer " + TURN,
          },
          bulky,
        );
        assert(health.status === 200, "health status " + health.status + " " + health.body);
        assert(denied.status === 401, "401 status " + denied.status + " " + denied.body);
        assert(tooBig.status === 413, "413 status " + tooBig.status + " " + tooBig.body);
        assert(!bodyLeaks(health.body), "health body leaked a secret");
        assert(!bodyLeaks(denied.body), "401 body leaked a secret");
        assert(!bodyLeaks(tooBig.body), "413 body leaked a secret");
        assert(wakes === 0, "401 or 413 woke a turn");
      } finally {
        await server.stop();
      }
    });
    ok(bindingLine("SK7"));
  } catch (err) {
    bad("SK7 " + (err && err.message ? err.message : err));
  }

  try {
    const p0Gates = fs.readFileSync(path.join(ROOT, "docs/qa/p0-security-gates.md"), "utf8");
    const p0Line = p0Gates.split("\n").find((line) => line.includes("| P0-3 |"));
    assert(p0Line && p0Line.includes("U 已绿，不升 I") && p0Line.includes("U only"), "P0-3 row is not U only");
    const cm0702 = path.join(ROOT, "docs/qa/artifacts/h6-matrix-i/cm-0702/evidence.json");
    if (fs.existsSync(cm0702)) {
      const evidence = JSON.parse(fs.readFileSync(cm0702, "utf8"));
      assert(evidence.i_claimed === false, "CM-0702 i_claimed was flipped");
    }
    const auDoc = fs.readFileSync(path.join(ROOT, "docs/qa/host-approval-ui-gates.md"), "utf8");
    assert(auDoc.includes("prove_host_approval_ui pass=69 fail=0"), "AU prove count was overturned");
    assert(auDoc.includes("不关 AR-15"), "AU page closed AR-15");
    const au7 = auDoc.split("\n").find((line) => line.includes("| AU7 |"));
    assert(au7 && au7.includes("approved: false"), "AU7 inbound approval was overturned");
    const mainJs = fs.readFileSync(path.join(ROOT, "hosts/desktop/main.js"), "utf8");
    const ensureAt = mainJs.indexOf("async function ensureCnInbound");
    // Slice to the next top-level boundary (app.whenReady), not a fixed char
    // window: ensureCnInbound grew past 1200 chars and pushed `approved: false`
    // out of a hardcoded window. Semantic bound stays correct as code grows.
    const ensureEndAt = mainJs.indexOf("app.whenReady", ensureAt);
    const ensureSlice = mainJs.slice(
      ensureAt,
      ensureEndAt > ensureAt ? ensureEndAt : ensureAt + 4000,
    );
    assert(ensureSlice.includes("approved: false"), "ensureCnInbound lost approved: false");
    assert(!ensureSlice.includes("approved: true"), "ensureCnInbound gained approved: true");
    const product = fs.readFileSync(path.join(ROOT, "hosts/shared/cn_inbound_product_on_turn.js"), "utf8");
    assert(product.includes("approved: false"), "product onTurn lost approved: false");
    assert(!product.includes("approved: true"), "product onTurn gained approved: true");
    const proved = execFileSync("bash", ["scripts/prove_p0_inbound_security.sh"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    assert(
      proved.includes("prove_p0_inbound_security pass=8 fail=0"),
      "P0 prove was not green",
    );
    ok(bindingLine("SK8"));
  } catch (err) {
    bad("SK8 " + (err && err.message ? err.message : err));
  }

  try {
    const phoneRoots = [
      path.join(ROOT, "hosts/ios"),
      path.join(ROOT, "hosts/android"),
      path.join(ROOT, "hosts/mobile_host"),
    ];
    const hits = [];
    for (const dir of phoneRoots) {
      for (const file of walkFiles(dir, [])) {
        const text = fs.readFileSync(file, "utf8");
        if (text.includes("BITBOT_LLM_API_KEY")) hits.push(path.relative(ROOT, file));
      }
    }
    assert(hits.length === 0, "phone tree names the model key: " + hits.join(","));
    const stripped = p0.mobileHostEnv({
      PATH: "/usr/bin",
      BITBOT_TURN_TOKEN: TURN,
      BITBOT_HOST_URL: "http://127.0.0.1:18765",
      BITBOT_LLM_API_KEY: SECRET,
      BITBOT_LLM_QWEN_API_KEY: "qwen-" + SECRET,
    });
    assert(stripped.BITBOT_MOBILE_HOST === "1", "mobile env flag missing");
    assert(stripped.BITBOT_TURN_TOKEN === TURN, "turn token was stripped");
    assert(stripped.BITBOT_HOST_URL, "host url was stripped");
    assert(!stripped.BITBOT_LLM_API_KEY && !stripped.BITBOT_LLM_QWEN_API_KEY, "mobile env kept a model key");
    assert(mobileSrc.includes("mobileHostEnv") && mobileSrc.includes("dropMobileLlmKeys"), "mobile host does not strip");
    assert(mobileSrc.includes('BITBOT_MOBILE_HOST = "1"'), "mobile host does not mark itself");
    assert(!mobileSrc.includes("env: process.env"), "mobile host still forwards the raw env");
    const llmDir = path.join(root, "data", "llm");
    fs.mkdirSync(llmDir, { recursive: true });
    fs.writeFileSync(
      path.join(llmDir, "active.json"),
      JSON.stringify({ provider_id: "deepseek", api_key: SECRET }),
    );
    await withEnv({ BITBOT_LLM_API_KEY: SECRET, BITBOT_MOBILE_HOST: null }, async () => {
      const desktop = ffi.resolveLlmConfig();
      assert(desktop.api_key === SECRET && desktop.key_configured === true, "desktop lost its model key");
    });
    await withEnv({ BITBOT_LLM_API_KEY: SECRET, BITBOT_MOBILE_HOST: "1" }, async () => {
      const mobile = ffi.resolveLlmConfig();
      assert(mobile.api_key === "", "mobile host resolved a model key");
      assert(mobile.key_configured === false, "mobile host reports the key configured");
      assert(mobile.key_source === "mobile_host_does_not_hold_llm_key", "key_source " + mobile.key_source);
      const catalog = ffi.listLlmCatalog();
      assert(catalog.providers.every((p) => p.key_configured === false), "catalog still shows a phone-held key");
    });
    note("phone-host remains a side check");
  } catch (err) {
    bad("phone-host " + (err && err.message ? err.message : err));
  }

  try {
    const kept = path.join(root, "not-removed");
    fs.writeFileSync(kept, "keep");
    const danger = shellRow(
      await ffi.executeHostEffects(
        [{ kind: "shell", command: "rm -rf /" }],
        { approved: true },
      ),
    );
    assert(danger.ok === false && danger.ran === false, "danger shell ran " + JSON.stringify(danger));
    assert(String(danger.error).includes("irreversible/dangerous"), "danger error " + danger.error);
    assert(fs.readFileSync(kept, "utf8") === "keep", "danger command removed a file");
    const echo = shellRow(
      await ffi.executeHostEffects(
        [{ kind: "shell", command: "echo sandbox-ok" }],
        { approved: true },
      ),
    );
    assert(echo.ok === true && String(echo.stdout).includes("sandbox-ok"), "approved echo failed");
    note("shell-control remains a side check");
  } catch (err) {
    bad("shell-control " + (err && err.message ? err.message : err));
  }
}

main()
  .then(() => {
    for (const row of BINDING) {
      if (!seen.has(row[0])) {
        fail += 1;
        process.stdout.write("FAIL " + row[0] + " missing\n");
      }
    }
    process.stdout.write(
      "SK is not P0 and not AU. prove_p0 host-checks do not close this residual. " +
        "AR-15 stays open. P0-3 stays U. not I. not MVP. residual stays open.\n",
    );
    process.stdout.write("prove_sandbox_secrets pass=" + pass + " fail=" + fail + "\n");
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
    process.stdout.write("prove_sandbox_secrets pass=" + pass + " fail=" + (fail + 1) + "\n");
    process.exit(1);
  });
