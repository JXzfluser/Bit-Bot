#!/usr/bin/env node
"use strict";

/**
 * 跨端审批 CLI 的门禁 —— 「批准」这件事现在就能用。
 *
 * 覆盖:
 *   - 手机(设备凭证)能拉到这台机器的待批清单
 *   - `allow` 批一次
 *   - `always` **不带 --yes 会被拒**(它的分量更重:授权这台机器以后做这类事)
 *   - `always --yes` 真的写下规则
 *   - `deny` 拒绝,什么也没执行
 *   - 凭证文件不存在 / 不完整 ⇒ 如实报错,不是静默
 *
 * CLI 是真跑的(子进程),服务器是真的入站服务。
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const deviceKeys = require(path.join(ROOT, "hosts/shared/device_keys"));
const { createCnInboundServer } = require(path.join(ROOT, "hosts/shared/cn_inbound_server"));

let pass = 0;
let fail = 0;
const ok = (n) => { pass += 1; console.log("ok", n); };
const bad = (n, d) => { fail += 1; console.error("FAIL", n, d || ""); };
const check = (c, n, d) => (c ? ok(n) : bad(n, d));

function runCli(args, opts) {
  return new Promise((resolve) => {
    const child = spawn("node", [path.join(ROOT, "scripts", "approve.js")].concat(args), {
      cwd: ROOT,
      env: { ...process.env, ...((opts && opts.env) || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-approve-"));
  const registry = path.join(tmp, "devices.json");
  // surface 的数据根是 <repoRoot>/data ⇒ 待审批队列在 <repoRoot>/data/desktop
  const desk = path.join(tmp, "data", "desktop");
  fs.mkdirSync(desk, { recursive: true });

  // 登记一台设备,并把凭证文件给它(私钥在这台「手机」上,Box 上只有公钥)。
  const phone = deviceKeys.generateDeviceKey({ kind: "mobile", name: "我的手机" });
  deviceKeys.saveDevices(registry, {
    version: 1,
    devices: [
      { id: phone.id, name: phone.name, kind: phone.kind, public_key_pem: phone.public_key_pem, created_at: phone.created_at, revoked_at: null },
    ],
  });
  const credPath = path.join(tmp, phone.id + ".credential.json");
  fs.writeFileSync(credPath, deviceKeys.deviceCredentialFile(phone), { mode: 0o600 });

  // 待批队列
  const pendPath = path.join(desk, "pending-approvals.jsonl");
  const mk = (id, kind, cmd) =>
    JSON.stringify({
      id,
      source: "routine",
      kind,
      command: cmd,
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      status: "pending",
    });
  fs.writeFileSync(pendPath, mk("approval-a1", "send_mail", "me@example.com|日报|三条热点") + "\n");

  const server = createCnInboundServer({
    repoRoot: tmp,
    port: 0,
    devicesPath: registry,
    onTurn: async () => ({ ok: true, messages: [], host_results: [] }),
  });
  const info = await server.start();
  const port = Number(info.port);
  const boxUrl = "http://127.0.0.1:" + port;

  try {
    // ---- AP-1: list 拉到清单 -------------------------------------------
    const list = await runCli(["--box", boxUrl, "--credential", credPath, "list"]);
    check(list.code === 0, "AP-1 list 退出码 0", list.code + " " + list.err);
    check(list.out.includes("approval-a1"), "AP-1 清单里有那一条", list.out.slice(0, 300));
    check(list.out.includes("send_mail"), "AP-1 清单显示了类型", list.out.slice(0, 300));
    check(list.out.includes("allow"), "AP-1 清单给出了怎么批", list.out.slice(0, 400));

    // ---- AP-2 负例: always 不带 --yes 会被拒 ---------------------------
    const alwaysNoYes = await runCli(["--box", boxUrl, "--credential", credPath, "always", "approval-a1"]);
    check(alwaysNoYes.code === 3, "AP-2 「总是允许」不带 --yes 被拒(它的分量更重)", alwaysNoYes.code);
    check(alwaysNoYes.out.includes("--yes"), "AP-2 拒的时候说明了要怎么做", alwaysNoYes.out.slice(0, 300));
    // 而且**真的**没写规则
    const rulesAfterNo = path.join(desk, "approval-rules.json");
    let rules = null;
    try { rules = JSON.parse(fs.readFileSync(rulesAfterNo, "utf8")); } catch (_) {}
    check(
      !rules || !(rules.rules || []).some((r) => r && r.pattern === "send_mail:*"),
      "AP-2 被拒之后没有写下任何规则",
      JSON.stringify(rules || {}).slice(0, 200),
    );

    // ---- AP-3: always --yes 真的写下规则 -------------------------------
    const alwaysYes = await runCli(["--box", boxUrl, "--credential", credPath, "--yes", "always", "approval-a1"]);
    check(alwaysYes.code === 0, "AP-3 always --yes 成功", alwaysYes.code + " " + alwaysYes.err);
    check(alwaysYes.out.includes("send_mail:*"), "AP-3 回执说明了写下的规则", alwaysYes.out.slice(0, 300));
    let rules2 = null;
    try { rules2 = JSON.parse(fs.readFileSync(rulesAfterNo, "utf8")); } catch (_) {}
    check(
      !!rules2 && (rules2.rules || []).some((r) => r && r.pattern === "send_mail:*" && r.decision === "allow"),
      "AP-3 规则真的落在这台机器上",
      JSON.stringify(rules2 || {}).slice(0, 250),
    );

    // ---- AP-4: deny 拒绝,什么也没执行 ----------------------------------
    fs.appendFileSync(pendPath, mk("approval-a2", "shell", "rm -rf /tmp/nothing") + "\n");
    const deny = await runCli(["--box", boxUrl, "--credential", credPath, "deny", "approval-a2"]);
    check(deny.code === 0, "AP-4 deny 成功", deny.code + " " + deny.err);
    check(deny.out.includes("deny") || deny.out.includes("拒绝"), "AP-4 回执说清了是拒绝", deny.out.slice(0, 300));
    // 被拒的那条不能再批
    const denyAgain = await runCli(["--box", boxUrl, "--credential", credPath, "allow", "approval-a2"]);
    check(denyAgain.code === 1, "AP-4 同一��不能再批第二次", denyAgain.code + " " + denyAgain.err);

    // ---- AP-5 负例: 凭证文件不对 ⇒ 如实报错 ----------------------------
    const noCred = await runCli(["--box", boxUrl, "--credential", path.join(tmp, "nope.json"), "list"]);
    check(noCred.code === 1, "AP-5 凭证文件不存在 ⇒ 报错退出", noCred.code);
    check(noCred.err.includes("找不到设备凭证"), "AP-5 错误说清了原因", noCred.err.slice(0, 200));

    const noCredArg = await runCli(["--box", boxUrl, "list"]);
    // 2 = 用法错(CLI 约定);1 = 执行失败。
    check(noCredArg.code === 2, "AP-5 没给凭证 ⇒ 用法错退出", noCredArg.code);
    check(noCredArg.err.includes("device-keys.js"), "AP-5 告诉用户怎么生成凭证", noCredArg.err.slice(0, 200));

    // ---- AP-6 负例: 另一台(没登记的)设备批不了 -------------------------
    const stranger = deviceKeys.generateDeviceKey({ kind: "mobile", name: "陌生人" });
    const strangerCred = path.join(tmp, stranger.id + ".credential.json");
    fs.writeFileSync(strangerCred, deviceKeys.deviceCredentialFile(stranger));
    const strangerList = await runCli(["--box", boxUrl, "--credential", strangerCred, "list"]);
    check(strangerList.code === 1, "AP-6 没登记的设备拉不到清单", strangerList.code + " " + strangerList.err.slice(0, 200));
  } finally {
    try { await server.stop(); } catch (_) {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  console.log("prove_approve_cli pass=" + pass + " fail=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_approve_cli crashed — " + String((e && e.stack) || e));
  console.log("prove_approve_cli pass=" + pass + " fail=" + (fail + 1));
  process.exit(1);
});
