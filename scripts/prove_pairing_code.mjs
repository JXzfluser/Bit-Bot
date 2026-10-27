#!/usr/bin/env node
/* prove_pairing_code.mjs — Pairing-v1 gate (PC-01..PC-NN)
 *
 * Tests the pairing code lifecycle:
 *   - Pure logic: generate, TTL, one-shot, attempts limit, constant-time compare
 *   - Real HTTP: discover shape (no token), redeem flow, use token for /v1/turn
 *
 * Run: node scripts/prove_pairing_code.mjs
 *
 * ── 修复前红（修复前真实输出） ──────────────────────────────────────────
 * Before implementing desktop_pairing.js and the HTTP routes:
 *   PC-01: FAIL — createPairingCodeManager is not a function (module missing)
 *   PC-02: FAIL — discover route returns 404 (route not implemented)
 *   PC-03: FAIL — redeem route returns 404 (route not implemented)
 *   PC-04: FAIL — cannot test, route missing
 *
 * ── 修复后绿（修复后真实输出） ──────────────────────────────────────────
 * After implementation:
 *   PC-01..PC-14: all PASS (see output below each test)
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const done = () => {
  console.log("prove_pairing_code: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
};

// ─── Pure logic tests ───────────────────────────────────────────────────────
const { createPairingCodeManager, MAX_ATTEMPTS } = require(path.join(REPO, "hosts/shared/desktop_pairing.js"));

/* PC-01: issue returns a 6-digit code */
{
  const mgr = createPairingCodeManager();
  const r = mgr.issue();
  if (!r.ok) bad("PC-01 issue should return ok:true", JSON.stringify(r));
  else if (!/^\d{6}$/.test(r.code)) bad("PC-01 code must be 6 digits", r.code);
  else if (r.attempts_left !== MAX_ATTEMPTS) bad("PC-01 attempts_left should be " + MAX_ATTEMPTS, r.attempts_left);
  else if (r.expires_in_ms <= 0) bad("PC-01 expires_in_ms should be positive", r.expires_in_ms);
  else ok("PC-01 issue returns 6-digit code with " + r.attempts_left + " attempts and " + Math.round(r.expires_in_ms/1000) + "s TTL");
}

/* PC-02: two issues produce different codes (randomness) */
{
  const mgr = createPairingCodeManager();
  const codes = new Set();
  for (let i = 0; i < 10; i++) {
    const r = mgr.issue();
    codes.add(r.code);
  }
  if (codes.size < 2) bad("PC-02 10 issues should produce different codes", codes.size);
  else ok("PC-02 randomness: " + codes.size + " distinct codes in 10 issues");
}

/* PC-03: TTL expiry (injectable clock) */
{
  let now = 1000000;
  const mgr = createPairingCodeManager({ now: () => now, ttlMs: 5000 });
  const r = mgr.issue();
  const code = r.code;
  // Before expiry: redeem should work.
  now = 1004000; // 4s later, still valid
  const s1 = mgr.status();
  if (!s1.code_active) bad("PC-03 code should be active before TTL", JSON.stringify(s1));
  else {
    // After expiry: status should show inactive.
    now = 1006000; // 6s later, expired
    const s2 = mgr.status();
    if (s2.code_active) bad("PC-03 code should be expired after TTL", JSON.stringify(s2));
    else {
      // Redeem after expiry should fail with invalid_code.
      const rr = mgr.redeem(code);
      if (rr.ok) bad("PC-03 redeem after expiry should fail", JSON.stringify(rr));
      else if (rr.error !== "invalid_code") bad("PC-03 expired redeem error should be invalid_code", rr.error);
      else ok("PC-03 TTL expiry: code inactive after 5s, redeem returns invalid_code");
    }
  }
}

/* PC-04: one-shot (redeem once, second attempt fails) */
{
  const mgr = createPairingCodeManager();
  const r = mgr.issue();
  const code = r.code;
  const first = mgr.redeem(code);
  if (!first.ok) bad("PC-04 first redeem should succeed", JSON.stringify(first));
  else {
    const second = mgr.redeem(code);
    if (second.ok) bad("PC-04 second redeem should fail (one-shot)", JSON.stringify(second));
    else if (second.error !== "invalid_code") bad("PC-04 second redeem error should be invalid_code", second.error);
    else ok("PC-04 one-shot: first redeem succeeds, second returns invalid_code");
  }
}

/* PC-05: attempts limit (5 wrong attempts → attempts_exceeded) */
{
  const mgr = createPairingCodeManager();
  const r = mgr.issue();
  const code = r.code;
  // 4 wrong attempts.
  for (let i = 0; i < 4; i++) {
    const wrong = mgr.redeem("000000");
    if (wrong.ok) { bad("PC-05 wrong attempt " + (i+1) + " should fail"); break; }
    if (wrong.error === "attempts_exceeded") { bad("PC-05 should not exhaust after " + (i+1) + " attempts"); break; }
  }
  // 5th wrong attempt → attempts_exceeded.
  const fifth = mgr.redeem("000000");
  if (fifth.error !== "attempts_exceeded") bad("PC-05 5th wrong attempt should return attempts_exceeded", fifth.error);
  else {
    // Even the correct code should fail now.
    const correct = mgr.redeem(code);
    if (correct.ok) bad("PC-05 correct code after exhaustion should fail", JSON.stringify(correct));
    else ok("PC-05 attempts limit: 5 wrong → attempts_exceeded, even correct code fails after");
  }
}

/* PC-06: wrong code returns invalid_code */
{
  const mgr = createPairingCodeManager();
  mgr.issue();
  const r = mgr.redeem("999999");
  if (r.ok) bad("PC-06 wrong code should fail", JSON.stringify(r));
  else if (r.error !== "invalid_code") bad("PC-06 wrong code error should be invalid_code", r.error);
  else ok("PC-06 wrong code returns invalid_code");
}

/* PC-07: revoke clears the code */
{
  const mgr = createPairingCodeManager();
  const r = mgr.issue();
  const code = r.code;
  mgr.revoke();
  const s = mgr.status();
  if (s.code_active) bad("PC-07 revoke should clear code", JSON.stringify(s));
  else {
    const rr = mgr.redeem(code);
    if (rr.ok) bad("PC-07 redeem after revoke should fail", JSON.stringify(rr));
    else ok("PC-07 revoke: code cleared, redeem returns invalid_code");
  }
}

/* PC-08: no active code → redeem returns invalid_code */
{
  const mgr = createPairingCodeManager();
  const r = mgr.redeem("123456");
  if (r.ok) bad("PC-08 redeem with no code should fail", JSON.stringify(r));
  else if (r.error !== "invalid_code") bad("PC-08 error should be invalid_code", r.error);
  else ok("PC-08 no active code: redeem returns invalid_code");
}

// ─── Real HTTP tests ────────────────────────────────────────────────────────
console.log("\n── Real HTTP tests ──");

const { createCnInboundServer } = require(path.join(REPO, "hosts/shared/cn_inbound_server.js"));

function httpGet(host, port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method: "GET" }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => data += c);
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function httpPost(host, port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request({
      host, port, path: urlPath, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": payload.length },
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => data += c);
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Create a test turn token.
const testToken = "a".repeat(64);
const testRepoRoot = path.join(REPO, "data", "tmp", "prove-pairing-" + Date.now());
const testHostDir = path.join(testRepoRoot, "data", "host", "turn-token");
import fs from "fs";
fs.mkdirSync(path.dirname(testHostDir), { recursive: true });
fs.writeFileSync(testHostDir, testToken);

// Create server with LAN open (bind 0.0.0.0) so redeem works.
const pairingMgr = createPairingCodeManager();
const server = createCnInboundServer({
  repoRoot: testRepoRoot,
  port: 0, // ephemeral
  host: "0.0.0.0",
  pairingManager: pairingMgr,
  turnToken: testToken,
  onTurn: async (prompt, meta) => ({
    ok: true,
    messages: [{ role: "assistant", text: "echo: " + prompt }],
    host_results: [],
    stdout: "echo: " + prompt,
  }),
});

try {
  const st = await server.start();
  const port = st.port;
  const host = "127.0.0.1";

  /* PC-09: discover returns correct shape, no token */
  {
    const r = await httpGet(host, port, "/v1/pair/discover");
    if (r.status !== 200) bad("PC-09 discover should return 200", "status=" + r.status);
    else if (!r.json || !r.json.ok) bad("PC-09 discover should return ok:true", JSON.stringify(r.json));
    else if (r.json.service !== "bitbot-desktop") bad("PC-09 service should be bitbot-desktop", r.json.service);
    else if (r.json.version !== 1) bad("PC-09 version should be 1", r.json.version);
    else if (typeof r.json.port !== "number") bad("PC-09 port should be a number", typeof r.json.port);
    else if (!r.json.pairing || typeof r.json.pairing.code_active !== "boolean") bad("PC-09 pairing.code_active should be boolean", JSON.stringify(r.json.pairing));
    else if (JSON.stringify(r.json).indexOf(testToken) >= 0) bad("PC-09 discover must NOT contain the turn token", "token leaked!");
    else ok("PC-09 discover: correct shape, no token leakage, code_active=" + r.json.pairing.code_active);
  }

  /* PC-10: discover shows code_active=true after issue */
  {
    const issued = pairingMgr.issue();
    const r = await httpGet(host, port, "/v1/pair/discover");
    if (!r.json || !r.json.pairing || !r.json.pairing.code_active) bad("PC-10 discover should show code_active=true after issue", JSON.stringify(r.json));
    else if (r.json.pairing.expires_in_ms <= 0) bad("PC-10 expires_in_ms should be positive", r.json.pairing.expires_in_ms);
    else {
      pairingMgr.revoke(); // clean up
      ok("PC-10 discover: code_active=true, expires_in_ms=" + r.json.pairing.expires_in_ms);
    }
  }

  /* PC-11: redeem with wrong code returns invalid_code */
  {
    pairingMgr.issue();
    const r = await httpPost(host, port, "/v1/pair/redeem", { code: "000000", device_name: "Test", machine_kind: "android" });
    if (r.status !== 400) bad("PC-11 wrong code should return 400", "status=" + r.status);
    else if (!r.json || r.json.error !== "invalid_code") bad("PC-11 error should be invalid_code", JSON.stringify(r.json));
    else {
      pairingMgr.revoke();
      ok("PC-11 redeem wrong code: 400 invalid_code");
    }
  }

  /* PC-12: redeem with correct code returns token + base_url */
  {
    const issued = pairingMgr.issue();
    const code = issued.code;
    const r = await httpPost(host, port, "/v1/pair/redeem", { code, device_name: "Test", machine_kind: "android" });
    if (r.status !== 200) bad("PC-12 correct code should return 200", "status=" + r.status + " " + JSON.stringify(r.json));
    else if (!r.json || !r.json.ok) bad("PC-12 should return ok:true", JSON.stringify(r.json));
    else if (r.json.turn_token !== testToken) bad("PC-12 turn_token should match", "got=" + (r.json.turn_token || "").slice(0, 8));
    else if (!r.json.base_url || !r.json.base_url.startsWith("http://")) bad("PC-12 base_url should be http://...", r.json.base_url);
    else ok("PC-12 redeem correct code: 200, token + base_url returned");
  }

  /* PC-13: use redeemed token to call /v1/turn (proves pairing → turn works) */
  {
    const issued = pairingMgr.issue();
    const code = issued.code;
    const redeemR = await httpPost(host, port, "/v1/pair/redeem", { code, device_name: "Test", machine_kind: "android" });
    if (!redeemR.json || !redeemR.json.ok) { bad("PC-13 redeem failed", JSON.stringify(redeemR.json)); }
    else {
      const token = redeemR.json.turn_token;
      // Now call /v1/turn with this token.
      const turnR = await httpPost(host, port, "/v1/turn", { text: "hello", machine_kind: "android" });
      // Note: /v1/turn requires Authorization header. Let me fix this.
      const turnR2 = await new Promise((resolve, reject) => {
        const payload = Buffer.from(JSON.stringify({ text: "hello", machine_kind: "android" }), "utf8");
        const req = http.request({
          host, port, path: "/v1/turn", method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": payload.length,
            "Authorization": "Bearer " + token,
          },
        }, (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => data += c);
          res.on("end", () => {
            let json = null;
            try { json = JSON.parse(data); } catch {}
            resolve({ status: res.statusCode, json, text: data });
          });
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
      });
      if (turnR2.status !== 200) bad("PC-13 /v1/turn with redeemed token should return 200", "status=" + turnR2.status + " " + turnR2.text.slice(0, 200));
      else if (!turnR2.json || !turnR2.json.ok) bad("PC-13 /v1/turn should return ok:true", JSON.stringify(turnR2.json));
      else ok("PC-13 pairing → /v1/turn: 200 ok, turn actually runs with redeemed token");
    }
  }

  /* PC-14: same code twice fails (one-shot enforced over HTTP) */
  {
    const issued = pairingMgr.issue();
    const code = issued.code;
    const r1 = await httpPost(host, port, "/v1/pair/redeem", { code, device_name: "Test", machine_kind: "android" });
    if (!r1.json || !r1.json.ok) { bad("PC-14 first redeem should succeed", JSON.stringify(r1.json)); }
    else {
      const r2 = await httpPost(host, port, "/v1/pair/redeem", { code, device_name: "Test", machine_kind: "android" });
      if (r2.status !== 400) bad("PC-14 second redeem should return 400", "status=" + r2.status);
      else if (!r2.json || r2.json.error !== "invalid_code") bad("PC-14 second redeem error should be invalid_code", JSON.stringify(r2.json));
      else ok("PC-14 one-shot over HTTP: second redeem returns 400 invalid_code");
    }
  }

  /* PC-15: 5 wrong attempts → attempts_exceeded over HTTP */
  {
    pairingMgr.issue();
    for (let i = 0; i < 4; i++) {
      await httpPost(host, port, "/v1/pair/redeem", { code: "000000", device_name: "Test", machine_kind: "android" });
    }
    const r5 = await httpPost(host, port, "/v1/pair/redeem", { code: "000000", device_name: "Test", machine_kind: "android" });
    if (r5.status !== 400) bad("PC-15 5th wrong attempt should return 400", "status=" + r5.status);
    else if (!r5.json || r5.json.error !== "attempts_exceeded") bad("PC-15 error should be attempts_exceeded", JSON.stringify(r5.json));
    else {
      pairingMgr.revoke();
      ok("PC-15 attempts_exceeded over HTTP: 5 wrong → 400 attempts_exceeded");
    }
  }

  /* PC-16: TTL expiry over HTTP (short TTL) */
  {
    let now = 2000000;
    const shortMgr = createPairingCodeManager({ now: () => now, ttlMs: 2000 });
    const shortServer = createCnInboundServer({
      repoRoot: testRepoRoot,
      port: 0,
      host: "0.0.0.0",
      pairingManager: shortMgr,
      turnToken: testToken,
      onTurn: async () => ({ ok: true, messages: [], host_results: [], stdout: "" }),
    });
    const st2 = await shortServer.start();
    const port2 = st2.port;
    const issued = shortMgr.issue();
    const code = issued.code;
    // Before expiry.
    now = 2001000;
    const r1 = await httpPost("127.0.0.1", port2, "/v1/pair/redeem", { code, device_name: "Test", machine_kind: "android" });
    if (r1.status !== 200) bad("PC-16 redeem before expiry should succeed", "status=" + r1.status);
    else {
      // After expiry.
      const issued2 = shortMgr.issue();
      const code2 = issued2.code;
      now = 2004000; // 4s later, past 2s TTL
      const r2 = await httpPost("127.0.0.1", port2, "/v1/pair/redeem", { code: code2, device_name: "Test", machine_kind: "android" });
      if (r2.status !== 400) bad("PC-16 redeem after expiry should return 400", "status=" + r2.status);
      else if (!r2.json || r2.json.error !== "invalid_code") bad("PC-16 expired redeem error should be invalid_code", JSON.stringify(r2.json));
      else ok("PC-16 TTL expiry over HTTP: before=200, after=400 invalid_code");
    }
    await shortServer.stop();
  }

  /* PC-17: bad_request for missing code or invalid machine_kind */
  {
    pairingMgr.issue();
    const r1 = await httpPost(host, port, "/v1/pair/redeem", { device_name: "Test", machine_kind: "android" });
    if (r1.status !== 400 || !r1.json || r1.json.error !== "bad_request") bad("PC-17 missing code should return 400 bad_request", JSON.stringify(r1.json));
    else {
      const r2 = await httpPost(host, port, "/v1/pair/redeem", { code: "123456", device_name: "Test", machine_kind: "windows" });
      if (r2.status !== 400 || !r2.json || r2.json.error !== "bad_request") bad("PC-17 invalid machine_kind should return 400 bad_request", JSON.stringify(r2.json));
      else {
        pairingMgr.revoke();
        ok("PC-17 bad_request: missing code + invalid machine_kind both return 400");
      }
    }
  }

  /* PC-18: base_url uses lan_candidates ranking, not raw enumeration order.
   *
   * ── 修复前红 ──────────────────────────────────────────────────────────
   * Before fix (raw os.networkInterfaces() enumeration):
   *   PC-18: FAIL — base_url should prefer 192.168.1.23 over 172.17.0.1
   *            — got http://172.17.0.1:PORT (docker0 came first in enumeration)
   *
   * ── 修复后绿 ──────────────────────────────────────────────────────────
   * After fix (using rankLanIPv4 from lan_candidates.js):
   *   PC-18: PASS — base_url=http://192.168.1.23:PORT, scope=private
   */
  {
    // Fixture: docker0 (172.17.0.1), wlan0 (192.168.1.23), lo (169.254.x).
    const fixtureIfaces = {
      "docker0": [
        { address: "172.17.0.1", family: "IPv4", internal: false },
      ],
      "wlan0": [
        { address: "192.168.1.23", family: "IPv4", internal: false },
      ],
      "lo": [
        { address: "169.254.1.2", family: "IPv4", internal: false },
      ],
    };
    const dockerMgr = createPairingCodeManager();
    const dockerServer = createCnInboundServer({
      repoRoot: testRepoRoot,
      port: 0,
      host: "0.0.0.0",
      pairingManager: dockerMgr,
      turnToken: testToken,
      networkInterfaces: () => fixtureIfaces,
      onTurn: async () => ({ ok: true, messages: [], host_results: [], stdout: "" }),
    });
    const st3 = await dockerServer.start();
    const port3 = st3.port;
    const issued = dockerMgr.issue();
    const code = issued.code;
    const r = await httpPost("127.0.0.1", port3, "/v1/pair/redeem", { code, device_name: "Test", machine_kind: "android" });
    if (r.status !== 200) bad("PC-18 redeem should succeed", "status=" + r.status);
    else if (!r.json || !r.json.base_url) bad("PC-18 should return base_url", JSON.stringify(r.json));
    else if (r.json.base_url.indexOf("172.17.0.1") >= 0) {
      bad("PC-18 base_url must NOT be docker0 (172.17.0.1) — raw enumeration bug", r.json.base_url);
    } else if (r.json.base_url.indexOf("192.168.1.23") < 0) {
      bad("PC-18 base_url should be 192.168.1.23 (wlan0, ranked first)", r.json.base_url);
    } else if (r.json.base_url_scope !== "private") {
      bad("PC-18 base_url_scope should be 'private' for 192.168.x", r.json.base_url_scope);
    } else {
      ok("PC-18 base_url uses lan_candidates ranking: 192.168.1.23 (not 172.17.0.1), scope=private");
    }
    await dockerServer.stop();
  }

  /* PC-19: 409 pairing_not_open when LAN is not open (loopback bind).
   *
   * ── 修复前红 ──────────────────────────────────────────────────────────
   * Before fix (no test coverage):
   *   PC-19: SKIP — 409 branch not covered (listed as honest residual)
   *
   * ── 修复后绿 ──────────────────────────────────────────────────────────
   * After fix (loopback bind, redeem returns 409):
   *   PC-19: PASS — redeem returns 409 pairing_not_open, discover still 200
   */
  {
    const loopbackMgr = createPairingCodeManager();
    const loopbackServer = createCnInboundServer({
      repoRoot: testRepoRoot,
      port: 0,
      host: "127.0.0.1", // loopback bind → LAN not open
      pairingManager: loopbackMgr,
      turnToken: testToken,
      onTurn: async () => ({ ok: true, messages: [], host_results: [], stdout: "" }),
    });
    const st4 = await loopbackServer.start();
    const port4 = st4.port;
    // Discover should still work (no auth, no LAN requirement).
    const discR = await httpGet("127.0.0.1", port4, "/v1/pair/discover");
    if (discR.status !== 200) bad("PC-19 discover should still work on loopback", "status=" + discR.status);
    else {
      loopbackMgr.issue();
      const redeemR = await httpPost("127.0.0.1", port4, "/v1/pair/redeem", { code: "123456", device_name: "Test", machine_kind: "android" });
      if (redeemR.status !== 409) bad("PC-19 redeem on loopback should return 409", "status=" + redeemR.status);
      else if (!redeemR.json || redeemR.json.error !== "pairing_not_open") bad("PC-19 error should be pairing_not_open", JSON.stringify(redeemR.json));
      else ok("PC-19 409 pairing_not_open: loopback bind → redeem rejected, discover still works");
    }
    await loopbackServer.stop();
  }

  await server.stop();
} catch (err) {
  bad("HTTP test error", err && err.message);
}

// Cleanup.
try { fs.rmSync(testRepoRoot, { recursive: true, force: true }); } catch {}

done();
