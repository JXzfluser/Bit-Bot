#!/usr/bin/env node
"use strict";

/**
 * B-1 补 + B-6 — a machine that stays on actually does its job, and another
 * machine can approve what it asks for.
 *
 * 两件事:
 *
 * 1) **排程调度器**:常开的机器到点得有人醒。Box 现在自带一个调度器
 *    (共享层 Host,不是外挂的 bash 守护脚本),到点跑一次「tick routines」——
 *    **走产品路径**(内核意图 → routine_tick effect → Host 唤醒到期任务)。
 *
 * 2) **跨端审批**:这台机器上待批准的请求,让**另一台已登记设备**(B-4a 的设备密钥)
 *    来看和决定。决定写进的是**这台机器**的队列和规则 —— 在手机上点「总是允许」
 *    等于授权这台机器以后做这类事。
 *
 * 关键诚实边界(必须有负例):
 *   - 到点**默认只备草稿**,不静默执行(GP-108「先读后执行」)。
 *   - 机器常开 ≠ 机器自己乱发邮件:自动执行要**用户的常驻授权**。
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const deviceKeys = require(path.join(ROOT, "hosts/shared/device_keys"));

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log("ok", n); };
const bad = (n, d) => { fail += 1; console.error("FAIL", n, d || ""); };
const check = (c, n, d) => (c ? ok(n) : bad(n, d));

function sseText(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
}
function jsonText(text) {
  return JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] });
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
      if (parsed && parsed.stream === true) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseText("好"));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(jsonText("好"));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, posts, port: server.address().port }));
  });
}

function signedFetch(port, method, urlPath, device, bodyObj) {
  const body = bodyObj ? Buffer.from(JSON.stringify(bodyObj), "utf8") : Buffer.alloc(0);
  const headers = {};
  if (body.length) headers["Content-Type"] = "application/json";
  if (device) {
    const ts = String(Date.now());
    const nonce = "n-" + Math.random().toString(36).slice(2) + Date.now();
    const sig = deviceKeys.signTurn(device.private_key_pem, device.id, ts, nonce, body);
    headers["x-bitbot-device"] = device.id;
    headers["x-bitbot-timestamp"] = ts;
    headers["x-bitbot-nonce"] = nonce;
    headers["x-bitbot-signature"] = sig;
  }
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        let parsed = {};
        try { parsed = JSON.parse(raw || "{}"); } catch (_) { parsed = {}; }
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: { error: String(e) }, raw: "" }));
    if (body.length) req.write(body);
    req.end();
  });
}

async function waitFor(fn, ms, step) {
  const deadline = Date.now() + (ms || 30000);
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step || 250));
  }
  return null;
}

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-sweep-"));
  const boxDir = path.join(tmp, "box");

  console.log("[gate] packing the box…");
  try {
    const packOut = String(
      execFileSync("bash", [path.join(ROOT, "scripts", "pack-box.sh"), "--out", boxDir, "--profile", "debug"], {
        cwd: ROOT,
        stdio: "pipe",
        env: { ...process.env, PATH: `${process.env.HOME || ""}/.moon/bin:${process.env.PATH || ""}` },
      }),
    );
    // 打包那步的 require 自检要在这里点名：GP-184 之后它挡的是「清单漏拷 /
    // 平铺布局里写了 dev 专用路径」这一类「包打得出来但开机缺一块」的破损。
    const reqLine = packOut.split("\n").find((l) => l.includes("require 自检"));
    if (!reqLine) {
      console.error("[gate] pack-box.sh 的输出里没有 require 自检那行（尺子没跑，不算绿）");
      fail += 1;
    } else {
      console.log("[gate] " + reqLine.replace(/^\[pack-box\]\s*/, ""));
    }
  } catch (e) {
    console.error("[gate] pack-box.sh failed: " + String((e && e.stdout) || e));
    console.log("prove_box_routine_sweep pass=" + pass + " fail=" + (fail + 1));
    process.exit(1);
  }

  // 登记两台设备:一台「手机」(用来跨端批准),一台「桌面」。
  const phone = deviceKeys.generateDeviceKey({ kind: "mobile", name: "我的手机" });
  const desk = deviceKeys.generateDeviceKey({ kind: "desktop", name: "我的桌面" });
  const registry = path.join(boxDir, "data", "host", "devices.json");
  deviceKeys.saveDevices(registry, {
    version: 1,
    devices: [
      { id: phone.id, name: phone.name, kind: phone.kind, public_key_pem: phone.public_key_pem, created_at: phone.created_at, revoked_at: null },
      { id: desk.id, name: desk.name, kind: desk.kind, public_key_pem: desk.public_key_pem, created_at: desk.created_at, revoked_at: null },
    ],
  });

  // 造两条**已经到期**的排程:一条循环的,一条一次性的。
  const routinesPath = path.join(boxDir, "data", "routines", "host-routines.json");
  fs.mkdirSync(path.dirname(routinesPath), { recursive: true });
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  fs.writeFileSync(
    routinesPath,
    JSON.stringify(
      [
        {
          id: "r-loop",
          enabled: true,
          lifecycle: "active",
          cron: "0 9 * * *",
          prompt: "每天采集一次 AI 科技热点并发给我",
          next_due: past,
          room_id: "",
          updated_at: past,
        },
        {
          id: "r-once",
          enabled: true,
          lifecycle: "active",
          cron: "@once",
          prompt: "只做一次的测试排程",
          next_due: past,
          room_id: "",
          updated_at: past,
        },
      ],
      null,
      2,
    ),
  );

  // 起 Box(扫排程的间隔给 2 秒,免得门禁等一分钟)
  const stub = await startStub();
  const port = 19100 + Math.floor(Math.random() * 400);
  const child = spawn("node", [path.join(boxDir, "shared", "box_main.js")], {
    cwd: boxDir,
    env: {
      ...process.env,
      BITBOT_KERNEL_BIN: path.join(boxDir, "bin", "desktop_turn"),
      BITBOT_CN_INBOUND_PORT: String(port),
      BITBOT_DEVICES_PATH: registry,
      BITBOT_ROUTINE_SWEEP_MS: "2000",
      BITBOT_LLM_BASE_URL: `http://127.0.0.1:${stub.port}/v1`,
      BITBOT_LLM_API_KEY: "stub-key",
      BITBOT_LLM_MODEL: "stub-model",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boxLog = "";
  child.stdout.on("data", (c) => { boxLog += c; });
  child.stderr.on("data", (c) => { boxLog += c; });

  try {
    const up = await waitFor(async () => {
      const h = await signedFetch(port, "GET", "/health", null);
      return h.status === 200;
    }, 40000);
    check(up, "SW-1 Box 起来了", boxLog.slice(-300));
    if (!up) {
      console.log("prove_box_routine_sweep pass=" + pass + " fail=" + (fail + 1));
      process.exit(1);
    }
    check(boxLog.includes("routine scheduler: on"), "SW-1 Box 说清了排程调度器开着", boxLog.slice(-300));

    // ---- SW-2: 到点真的被扫到,草稿真的生成了 --------------------------
    const draftsDir = path.join(boxDir, "data", "routines", "drafts");
    const drafts = await waitFor(async () => {
      try {
        const f = fs.readdirSync(draftsDir).filter((x) => x.endsWith(".json"));
        return f.length >= 2 ? f : null;
      } catch (_) {
        return null;
      }
    }, 30000);
    check(!!drafts, "SW-2 到点的排程真的被扫到了,草稿生成了", JSON.stringify(drafts || []));

    // ---- SW-3: daemon-status 说 long_lived(residual 能关) ----------------
    const statusPath = path.join(boxDir, "data", "routines", "daemon-status.json");
    const st = await waitFor(async () => {
      try {
        const s = JSON.parse(fs.readFileSync(statusPath, "utf8"));
        return s && s.long_lived === true && s.sweeps > 0 ? s : null;
      } catch (_) {
        return null;
      }
    }, 20000);
    check(!!st, "SW-3 daemon-status 说 long_lived=true(排程确实被武装了)", JSON.stringify(st || {}));
    check(!!st && st.sweeps >= 1, "SW-3 至少扫过一次", JSON.stringify(st || {}));

    // ---- SW-4 负例: 没批准 ⇒ 不执行,只备草稿 ---------------------------
    const draftFiles = (drafts || []).map((f) => path.join(draftsDir, f));
    const draftRows = draftFiles.map((f) => {
      try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return {}; }
    });
    check(
      draftRows.length > 0 && draftRows.every((d) => d.executed !== true),
      "SW-4 到点只备草稿,没有静默执行(GP-108 先读后执行)",
      JSON.stringify(draftRows.map((d) => d.executed)).slice(0, 200),
    );
    check(
      draftRows.some((d) => d.requires_approval === true || d.approval_required === true),
      "SW-4 草稿明说需要批准",
      JSON.stringify(draftRows[0] || {}).slice(0, 250),
    );

    // ---- SW-5: 一次性任务跑完就停车(不再每轮重复触发) -------------------
    const onceRow = (() => {
      try {
        const rows = JSON.parse(fs.readFileSync(routinesPath, "utf8"));
        return rows.find((r) => r && r.id === "r-once") || null;
      } catch (_) {
        return null;
      }
    })();
    check(
      !!onceRow && (onceRow.next_due === null || onceRow.next_due === undefined) && onceRow.once_done === true,
      "SW-5 一次性排程跑完就停车(不会每轮重复触发)",
      JSON.stringify(onceRow || {}),
    );

    // ---- SW-6: 跨端审批 —— 手机拉得到待批项 ------------------------------
    const pendPath = path.join(boxDir, "data", "desktop", "pending-approvals.jsonl");
    fs.mkdirSync(path.dirname(pendPath), { recursive: true });
    const pendId = "approval-box-test-1";
    fs.writeFileSync(
      pendPath,
      JSON.stringify({
        id: pendId,
        source: "routine",
        kind: "send_mail",
        command: "me@example.com|AI 热点日报|今天三条热点",
        requested_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        status: "pending",
      }) + "\n",
    );

    const list = await signedFetch(port, "GET", "/v1/approvals", phone);
    check(list.status === 200, "SW-6 手机拉得到待批项", list.status + " " + list.raw.slice(0, 160));
    check(
      list.body && Array.isArray(list.body.pending) && list.body.pending.some((p) => p.id === pendId),
      "SW-6 清单里有那一条",
      JSON.stringify(list.body || {}).slice(0, 250),
    );
    check(
      list.body && list.body.pending.every((p) => String(p.command || "").length <= 240),
      "SW-6 清单里的命令被截断了(不整段倒出去)",
    );

    // ---- SW-7 负例: 没有设备凭证 ⇒ 拉不到、也批不了 ---------------------
    const anonList = await signedFetch(port, "GET", "/v1/approvals", null);
    check(anonList.status === 401, "SW-7 没设备凭证拉不到待批项", anonList.status);
    const anonDecide = await signedFetch(port, "POST", "/v1/approvals/" + pendId + "/decide", null, {
      decision: "always",
    });
    check(anonDecide.status === 401, "SW-7 没设备凭证批不了", anonDecide.status);

    // ---- SW-8: 手机点「总是允许」⇒ 规则写进这台机器 ---------------------
    const decide = await signedFetch(port, "POST", "/v1/approvals/" + pendId + "/decide", phone, {
      decision: "always",
    });
    check(decide.status === 200, "SW-8 手机的决定被接受", decide.status + " " + decide.raw.slice(0, 200));
    check(
      decide.body && String(decide.body.persisted_pattern || "") === "send_mail:*",
      "SW-8 「总是允许」写下了这台机器的规则",
      JSON.stringify(decide.body || {}).slice(0, 220),
    );
    const rulesPath = path.join(boxDir, "data", "desktop", "approval-rules.json");
    let rules = null;
    try { rules = JSON.parse(fs.readFileSync(rulesPath, "utf8")); } catch (_) {}
    check(
      !!rules && Array.isArray(rules.rules) && rules.rules.some((r) => r && r.pattern === "send_mail:*" && r.decision === "allow"),
      "SW-8 规则真的落在这台机器上(下一次同类操作不再逐次问)",
      JSON.stringify(rules || {}).slice(0, 250),
    );
    // 决定本身有留痕
    const eventsPath = path.join(boxDir, "data", "routines", "webhooks", "cn-inbound", "events.jsonl");
    let events = "";
    try { events = fs.readFileSync(eventsPath, "utf8"); } catch (_) {}
    check(
      events.includes(pendId) && events.includes(phone.id),
      "SW-8 谁批的、批了哪一条,有留痕",
      events.slice(-250),
    );

    // ---- SW-9 负例: 已决定的那一条不能再批 ------------------------------
    const again = await signedFetch(port, "POST", "/v1/approvals/" + pendId + "/decide", phone, {
      decision: "deny",
    });
    check(again.status === 409, "SW-9 同一���不能再批第二次", again.status + " " + again.raw.slice(0, 160));
  } finally {
    try { child.kill("SIGTERM"); } catch (_) {}
    try { stub.server.close(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("prove_box_routine_sweep pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_box_routine_sweep crashed — " + String((e && e.stack) || e));
  console.log("prove_box_routine_sweep pass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
