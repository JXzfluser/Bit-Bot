"use strict";

/**
 * Host-side ADR 0008 checks that curl does not cover: default bind, fixed
 * approved:true removed from the inbound onTurn paths, unapproved shell does
 * not run, approved shell does not inherit BITBOT_LLM_API_KEY.
 * P0-3 stays a kernel U test. This file does not write an I-PASS artifact.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveInboundBind, shellChildEnv } = require("../hosts/shared/p0_security");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0;
let fail = 0;
const ok = (m) => {
  pass += 1;
  process.stdout.write("  ok " + m + "\n");
};
const bad = (m) => {
  fail += 1;
  process.stdout.write("  FAIL " + m + "\n");
};

const rootDir = path.resolve(__dirname, "..");

const bind = resolveInboundBind({}, {});
if (bind.host === "127.0.0.1" && bind.lan === false && bind.source === "default") {
  ok("default bind is 127.0.0.1");
} else {
  bad("default bind " + JSON.stringify(bind));
}
const lan = resolveInboundBind({}, { BITBOT_BIND_LAN: "1" });
if (lan.host === "0.0.0.0" && lan.warn === true) {
  ok("BITBOT_BIND_LAN=1 binds all interfaces and warns");
} else {
  bad("LAN bind " + JSON.stringify(lan));
}

const inboundSrc = fs.readFileSync(
  path.join(rootDir, "hosts/shared/cn_inbound_product_on_turn.js"),
  "utf8",
);
if (/approved:\s*true/.test(inboundSrc)) bad("product onTurn still has approved:true");
else ok("product onTurn does not force approved:true");

const mainSrc = fs.readFileSync(path.join(rootDir, "hosts/desktop/main.js"), "utf8");
const start = mainSrc.indexOf("async function ensureCnInbound");
const slice = start >= 0 ? mainSrc.slice(start, start + 1200) : "";
if (!slice) bad("ensureCnInbound missing");
else if (/approved:\s*true/.test(slice)) bad("ensureCnInbound still forces approved:true");
else ok("ensureCnInbound does not force approved:true");

const secret = "p0-secret-ABCDEFGH123456";
const prevKey = process.env.BITBOT_LLM_API_KEY;
process.env.BITBOT_LLM_API_KEY = secret;
const childEnv = shellChildEnv(process.env);
if (childEnv.BITBOT_LLM_API_KEY) bad("shell child env still has the API key");
else ok("shell child env omits BITBOT_LLM_API_KEY");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p0-shell-"));
  const ffi = createHostFfi(root);
  const marker = path.join(root, "pwned-unapproved");
  const denied = await ffi.executeHostEffects(
    [{ kind: "shell", command: "touch " + marker }],
    {},
  );
  const deniedRow = (denied || []).find((r) => r && r.kind === "shell") || {};
  if (!fs.existsSync(marker) && deniedRow.ran === false && deniedRow.needs_approval === true) {
    ok("unapproved shell does not run");
  } else {
    bad("unapproved shell ran or was not marked needs_approval");
  }

  const forged = await ffi.executeHostEffects(
    [{ kind: "shell", command: "touch " + marker + "-forged" }],
    { approved: true },
  );
  // Host-process approved:true is the CLI / Allow path and must still run,
  // but only inside the cwd allowlist and without the secret env.
  const forgedMissing = !fs.existsSync(marker + "-forged");
  if (forgedMissing) bad("turn-approved shell did not run");
  else ok("turn-approved shell runs");

  const outside = await ffi.executeHostEffects(
    [{ kind: "shell", command: "echo hi" }],
    { approved: true, cwd: "/etc" },
  );
  const outsideRow = (outside || []).find((r) => r && r.kind === "shell") || {};
  if (outsideRow.ok === false && outsideRow.error === "cwd_not_allowlisted" && outsideRow.ran === false) {
    ok("shell cwd outside the allowlist is refused");
  } else {
    bad("cwd allowlist " + JSON.stringify({ ok: outsideRow.ok, error: outsideRow.error, ran: outsideRow.ran }));
  }

  const echoed = await ffi.executeHostEffects(
    [{ kind: "shell", command: "echo sandbox-ok" }],
    { approved: true },
  );
  const echoRow = (echoed || []).find((r) => r && r.kind === "shell") || {};
  if (echoRow.ok === true && String(echoRow.stdout || "").includes("sandbox-ok")) {
    ok("approved shell can echo");
  } else {
    bad("approved echo failed");
  }

  const leaked = await ffi.executeHostEffects(
    [{ kind: "shell", command: "printenv BITBOT_LLM_API_KEY || true" }],
    { approved: true },
  );
  const leakRow = (leaked || []).find((r) => r && r.kind === "shell") || {};
  const blob = JSON.stringify(leakRow);
  if (blob.includes(secret) || String(leakRow.stdout || "").includes(secret)) {
    bad("approved shell stdout or result contains the API key");
  } else {
    ok("approved shell result does not contain the API key");
  }

  const shellDir = path.join(root, "data", "host-tools", "shell");
  let artifacts = "";
  if (fs.existsSync(shellDir)) {
    for (const name of fs.readdirSync(shellDir)) {
      artifacts += fs.readFileSync(path.join(shellDir, name), "utf8");
    }
  }
  if (artifacts.includes(secret)) bad("shell artifacts contain the API key");
  else ok("shell artifacts do not contain the API key");

  if (prevKey === undefined) delete process.env.BITBOT_LLM_API_KEY;
  else process.env.BITBOT_LLM_API_KEY = prevKey;

  process.stdout.write("host-checks pass=" + pass + " fail=" + fail + "\n");
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
