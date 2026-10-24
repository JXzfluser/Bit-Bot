"use strict";

/**
 * SK1–SK8. Sandbox and secret-leak evidence for ADR 0008.
 * This is not P0, not AU, and not an I promotion.
 * prove_p0_inbound_host_checks.js does not close this residual.
 * Does not close AR-15 and does not claim MVP.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const p0 = require("../hosts/shared/p0_security");
const { createHostFfi } = require("../hosts/shared/host_ffi");

const ROOT = path.resolve(__dirname, "..");
const SECRET = "sk-sandbox-SECRETVALUE123456";
const TURN = "turn-secret-value-123456";
const OTHER_SECRET = "example-secret-value-123456";
const OTHER_PASSWORD = "example-password-value-123";
const OTHER_WEBHOOK = "https://hooks.example/secret-value";

let pass = 0;
let fail = 0;
const seen = new Set();

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

function assert(cond, message) {
  if (!cond) throw new Error(message || "assertion failed");
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

async function main() {
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
    ok("SK1 allowlist env keeps LC_* PATH HOME BITBOT_TZ and drops secrets");
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
      const artifacts = readTree(path.join(root, "data", "host-tools", "shell"));
      assert(!artifacts.includes(SECRET) && !artifacts.includes(TURN), "approved artifacts released a secret");
    });
    ok("SK2 approval does not release secrets");
  } catch (err) {
    bad("SK2 " + (err && err.message ? err.message : err));
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
    ok("SK3 cwd stays inside the allow root");
  } catch (err) {
    bad("SK3 " + (err && err.message ? err.message : err));
  }

  try {
    assert(p0.SHELL_TIMEOUT_MS === 30000, "default timeout is " + p0.SHELL_TIMEOUT_MS);
    const callAt = hostSrc.indexOf("await p0.runSandboxedShell");
    assert(callAt >= 0, "host shell does not call runSandboxedShell");
    const call = hostSrc.slice(callAt, callAt + 220);
    assert(!call.includes("timeoutMs"), "host shell overrides the timeout");
    const marker = "sk4-sleep-" + process.pid + "-" + Date.now();
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
    ok("SK4 shell timeout kills the child");
  } catch (err) {
    bad("SK4 " + (err && err.message ? err.message : err));
  }

  try {
    assert(p0.SHELL_MAX_BUFFER === 256 * 1024, "default buffer is " + p0.SHELL_MAX_BUFFER);
    assert(p0.SHELL_OUTPUT_CAP === 8000, "output cap is " + p0.SHELL_OUTPUT_CAP);
    const callAt = hostSrc.indexOf("await p0.runSandboxedShell");
    const call = hostSrc.slice(callAt, callAt + 220);
    assert(!call.includes("maxBuffer"), "host shell overrides the buffer");
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
    ok("SK5 shell buffer and output cap");
  } catch (err) {
    bad("SK5 " + (err && err.message ? err.message : err));
  }

  try {
    const scrubbed = p0.scrubDeep(
      { note: "see " + SECRET, list: [SECRET] },
      { BITBOT_LLM_API_KEY: SECRET },
    );
    assert(!JSON.stringify(scrubbed).includes(SECRET), "scrubDeep kept the secret");
    assert(JSON.stringify(scrubbed).includes("[redacted]"), "scrubDeep did not redact");
    assert(inboundSrc.includes("p0.scrubDeep"), "inbound log path does not scrub");
    await withEnv({ BITBOT_LLM_API_KEY: SECRET }, async () => {
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
      const artifacts = readTree(path.join(root, "data", "host-tools", "shell"));
      assert(!artifacts.includes(SECRET), "shell artifacts kept the secret");
    });
    ok("SK6 scrub removes secret values from results and artifacts");
  } catch (err) {
    bad("SK6 " + (err && err.message ? err.message : err));
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
    ok("SK7 phone host does not hold the LLM key");
  } catch (err) {
    bad("SK7 " + (err && err.message ? err.message : err));
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
    ok("SK8 approved echo still runs and the danger table still refuses");
  } catch (err) {
    bad("SK8 " + (err && err.message ? err.message : err));
  }
}

main()
  .then(() => {
    const ids = ["SK1", "SK2", "SK3", "SK4", "SK5", "SK6", "SK7", "SK8"];
    for (const id of ids) {
      if (!seen.has(id)) {
        fail += 1;
        process.stdout.write("FAIL " + id + " missing\n");
      }
    }
    process.stdout.write(
      "SK is not P0 and not AU. prove_p0 host-checks do not close this residual. " +
        "AR-15 stays open. P0-3 stays U. not I. not MVP.\n",
    );
    process.stdout.write("prove_sandbox_secrets pass=" + pass + " fail=" + fail + "\n");
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
    process.stdout.write("prove_sandbox_secrets pass=" + pass + " fail=" + (fail + 1) + "\n");
    process.exit(1);
  });
