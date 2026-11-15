#!/usr/bin/env node
"use strict";

/**
 * prove_remote_turn — 把一个回合派到另一台机器上跑
 *
 * 现场推演(真实用户旅程,不是假设):
 *   用户有两台机器:桌上那台,和一台常开的 Box。用户说「让 Box 那边的 Bot
 *   顺手把今天的热点收一下」。
 *   —— 这件事今天做不了,而且**差的方向很具体**:
 *     · Box 的**收端是齐的**(POST /v1/turn + 设备密钥鉴权,ADR 0008);
 *     · 缺的只是**发端**:JS 侧只有验签,发签名只在 Android 的 Kotlin 侧有;
 *     · 也没有"这台机器的地址在哪"的登记处。
 *   ⇒ 一台机器能**被**别的机器使唤,但**使唤不了**别的机器:方向通,反的没有。
 *
 * 契约(先立红,修完必须全绿):
 *   1. 登记了机器 ⇒ 回合真的派过去,目标机器**真的跑了**这一轮。
 *   2. 回包如实带回来(消息 / host 结果 / stdout)。
 *   3. 负向:没登记机器 ⇒ 报错,不编。
 *   4. 负向:登记了但没凭证 ⇒ 报错,不编。
 *   5. 负向:目标机器不可达 ⇒ 报错,不假装派成功了。
 *   6. 负向:不带签名 ⇒ 目标机器拒(401)—— 证明"派过去"真的过了鉴权,
 *      不是绕过了它。
 *   7. 对外动作仍然在**目标机器那侧**走它自己的审批闸 —— 这条路只递话,
 *      不替目标机器点头。
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { createCnInboundServer } = require("../hosts/shared/cn_inbound_server");
const deviceKeys = require("../hosts/shared/device_keys");
const remoteTurn = require("../hosts/shared/remote_turn");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };
const check = (cond, m, d) => { if (cond) ok(m); else bad(m, d); };

const REPO = path.resolve(__dirname, "..");
// 数据根必须是仓库的**直接子目录**(host_ffi 的内核 cwd 约束)。
const dataRoot = path.join(REPO, ".rt-probe-" + process.pid);

console.log("prove_remote_turn（跨机派回合）");

(async function main() {
  fs.rmSync(dataRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(dataRoot, "host"), { recursive: true });

  // ---- 1) 一台设备:公钥进 Box,私钥留在发端 ------------------------------
  const device = deviceKeys.generateDeviceKey({ kind: "desktop", name: "发端机器" });
  const devicesPath = path.join(dataRoot, "host", "devices.json");
  deviceKeys.saveDevices(devicesPath, {
    version: 1,
    devices: [
      {
        id: device.id,
        name: device.name,
        kind: device.kind,
        public_key_pem: device.public_key_pem,
        created_at: device.created_at,
        revoked_at: null,
      },
    ],
  });
  const credPath = path.join(dataRoot, "host", "credentials", "sender.credential.json");
  fs.mkdirSync(path.dirname(credPath), { recursive: true });
  fs.writeFileSync(credPath, deviceKeys.deviceCredentialFile(device));

  // ---- 2) 起一台"目标机器"(Box 的收端) ----------------------------------
  const turns = [];
  const server = createCnInboundServer({
    repoRoot: dataRoot,
    port: 0,
    devicesPath,
    onTurn: async (payload) => {
      turns.push(payload);
      return {
        ok: true,
        messages: [{ role: "assistant", text: "目标机器回的一句" }],
        host_results: [{ kind: "noop", ok: true }],
        stdout: "remote-stdout",
      };
    },
  });
  const info = await server.start();
  const port = Number(info.port);
  const base = "http://127.0.0.1:" + port;

  try {
    // ---- 3) 机器登记表 --------------------------------------------------
    const machinesPath = path.join(dataRoot, "host", "machines.json");
    fs.writeFileSync(
      machinesPath,
      JSON.stringify(
        {
          version: 1,
          machines: [
            {
              id: "box-1",
              name: "云端 Box",
              kind: "box-local",
              url: base,
              credential: "host/credentials/sender.credential.json",
            },
          ],
        },
        null,
        2,
      ),
    );

    // ---- 4) 派过去 ------------------------------------------------------
    const sent = await remoteTurn.sendRemoteTurn({
      dataRoot,
      machineId: "box-1",
      text: "今天的 AI 科技热点收一下",
      sessionId: "rt-1",
    });
    check(sent.ok === true, "RT-1 回合派过去了", JSON.stringify(sent).slice(0, 240));
    const t0 = turns[0];
    const tText =
      typeof t0 === "string"
        ? t0
        : String((t0 && (t0.text || t0.message || t0.prompt)) || "");
    check(
      turns.length === 1 && tText.indexOf("AI 科技热点") >= 0,
      "RT-1 目标机器**真的跑了**这一轮(不是回了个空壳)",
      JSON.stringify(turns).slice(0, 200),
    );
    check(
      Array.isArray(sent.messages) && sent.messages.length === 1,
      "RT-2 回包把目标机器的消息带回来了",
      JSON.stringify(sent.messages).slice(0, 200),
    );
    check(
      sent.stdout === "remote-stdout",
      "RT-2 回包把目标机器的 stdout 带回来了",
      String(sent.stdout || "").slice(0, 120),
    );
    check(
      sent.device_id === device.id,
      "RT-2 回包带回设备身份(来的是哪台机器)",
      String(sent.device_id || "").slice(0, 80),
    );

    // ---- 5) 负向:没登记的机器 -------------------------------------------
    const noMachine = await remoteTurn.sendRemoteTurn({
      dataRoot,
      machineId: "not-registered",
      text: "x",
    });
    check(
      noMachine.ok === false && noMachine.error === "remote_turn_machine_not_registered",
      "RT-3 负向:没登记的机器 ⇒ 报错,不编",
      JSON.stringify(noMachine).slice(0, 200),
    );

    // ---- 6) 负向:登记了但没凭证 -----------------------------------------
    const noCredMachine = path.join(dataRoot, "host", "machines-nocred.json");
    const machinesRaw = JSON.parse(fs.readFileSync(machinesPath, "utf8"));
    machinesRaw.machines.push({
      id: "box-nocred",
      url: base,
      credential: "host/credentials/does-not-exist.json",
    });
    fs.writeFileSync(noCredMachine, JSON.stringify(machinesRaw, null, 2));
    fs.copyFileSync(machinesPath, machinesPath + ".bak");
    fs.writeFileSync(machinesPath, JSON.stringify(machinesRaw, null, 2));
    const noCred = await remoteTurn.sendRemoteTurn({
      dataRoot,
      machineId: "box-nocred",
      text: "x",
    });
    check(
      noCred.ok === false && noCred.error === "remote_turn_no_credential",
      "RT-4 负向:没凭证 ⇒ 报错,不编",
      JSON.stringify(noCred).slice(0, 200),
    );
    fs.copyFileSync(machinesPath + ".bak", machinesPath);

    // ---- 7) 负向:目标机器不可达 -----------------------------------------
    machinesRaw.machines.push({
      id: "box-dead",
      url: "http://127.0.0.1:1",
      credential: "host/credentials/sender.credential.json",
    });
    fs.writeFileSync(machinesPath, JSON.stringify(machinesRaw, null, 2));
    const dead = await remoteTurn.sendRemoteTurn({
      dataRoot,
      machineId: "box-dead",
      text: "x",
      timeoutMs: 3000,
    });
    check(
      dead.ok === false && dead.error === "remote_turn_unreachable",
      "RT-5 负向:目标机器不可达 ⇒ 报错,不假装派成功了",
      JSON.stringify(dead).slice(0, 200),
    );

    // ---- 7.5) CLI 也能派(人直接用的那条路) ------------------------------
    {
      const { execFile } = require("child_process");
      const cli = path.join(REPO, "scripts", "remote-turn.js");
      /* **必须异步**跑 CLI:这台 Box 服务就住在本进程里,execFileSync 会阻塞
         事件循环 ⇒ 子进程等回包、这边等子进程 ⇒ 互等到超时。
         (第一版用 execFileSync,门禁卡了 120 秒才发现——测试自己把自己锁死了。) */
      const { code, out } = await new Promise((resolve) => {
        const child = execFile(
          process.execPath,
          [cli, "--data-root", dataRoot, "--machine", "box-1", "--text", "CLI 派的一轮"],
          { encoding: "utf8" },
          (err, stdout, stderr) => {
            resolve({
              code: err ? (err.code === undefined ? -1 : err.code) : 0,
              out: String(stdout || "") + String(stderr || ""),
            });
          },
        );
        child.on("error", () => resolve({ code: -1, out: "" }));
      });
      check(code === 0, "RT-7 CLI 派回合成功(退出码 0)", code + " " + out.slice(0, 200));
      check(
        out.indexOf("CLI 派的一轮") >= 0 || turns.some((t) => String(t).indexOf("CLI 派的一轮") >= 0),
        "RT-7 CLI 派的那一轮真的到了目标机器",
        JSON.stringify(turns).slice(0, 200),
      );
    }

    // ---- 7.6) Host effect 那条路(产品路径用这个) -------------------------
    {
      const { createHostFfi } = require("../hosts/shared/host_ffi");
      const ffi = createHostFfi(REPO, { dataRoot });
      const rows = await ffi.executeHostEffects(
        [{ kind: "remote_turn", command: "box-1|effect 派的一轮" }],
        {},
      );
      const r = (rows || []).find((x) => x && x.kind === "remote_turn") || {};
      check(r.ok === true, "RT-8 Host effect 派回合成功", JSON.stringify(r).slice(0, 240));
      check(
        turns.some((t) => String(t).indexOf("effect 派的一轮") >= 0),
        "RT-8 effect 派的那一轮真的到了目标机器",
        JSON.stringify(turns).slice(0, 240),
      );
    }

    // ---- 8) 负向:不带签名 ⇒ 目标机器拒 ----------------------------------
    const turnsBeforeNoSig = turns.length;
    const raw = await new Promise((resolve) => {
      const body = JSON.stringify({ text: "没签名的一轮" });
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/v1/turn",
          method: "POST",
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        },
        (res) => {
          const c = [];
          res.on("data", (x) => c.push(x));
          res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString("utf8") }));
        },
      );
      req.on("error", () => resolve({ status: 0, body: "" }));
      req.write(body);
      req.end();
    });
    check(
      raw.status === 401,
      "RT-6 负向:不带签名 ⇒ 目标机器拒(401)—— 证明派过去真的过了鉴权",
      JSON.stringify(raw).slice(0, 200),
    );
    check(
      turns.length === turnsBeforeNoSig,
      "RT-6 负向:被拒的那轮**没有**在目标机器上跑",
      String(turns.length),
    );
  } finally {
    try { await server.stop(); } catch (_) { /* 停不掉也要把进程收了 */ }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }

  console.log("\nprove_remote_turn: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_remote_turn: " + String((e && e.message) || e));
  console.log("\nprove_remote_turn: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
