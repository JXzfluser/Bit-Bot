#!/usr/bin/env node
/* prove_pairing_relay_handoff.js — A3-6 门禁（PH-01..PH-05）
 *
 * 要证的一件事：**配对成功后，桌面把「怎么跨网找到我」的四栏交给手机**，而且只在
 * 真的配齐时才给、只在成功回执里给、不夹带任何多余凭据。
 *
 * 为什么这条必须有：A3-5 已经把手机侧的中转传输层做出来了（RT-01..RT-10），但手机
 * **没有任何途径拿到中转参数** —— 没有界面、回执也不下发。于是「跨网能用」在用户侧
 * 仍然是零。这一层就是把参数这条路接通，并且把「半套配置」堵住：给一半比不给更坏，
 * 手机会拿半套去连，然后报一个查不出来的错。
 *
 * 形状约束（不破既有合同）：`relay` 是**可选新增字段**，没配就不出现 —— 老客户端、
 * 老门禁读到的回执一字不变。
 *
 * 跑法：node scripts/prove_pairing_relay_handoff.js
 */

const path = require("path");
const http = require("http");
const fs = require("fs");
const os = require("os");

const REPO = path.resolve(__dirname, "..");
const { createCnInboundServer } = require(path.join(REPO, "hosts/shared/cn_inbound_server.js"));
const { createPairingCodeManager } = require(path.join(REPO, "hosts/shared/desktop_pairing.js"));

let PASS = 0;
let FAIL = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : ""));
};

function httpPost(host, port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      {
        host,
        port,
        path: urlPath,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": payload.length },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          resolve({ status: res.statusCode, json, text: data });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-relay-handoff-"));
  const pairingMgr = createPairingCodeManager();
  // 可变的中转配置：同一台桌面依次扮演「没配 / 配齐 / 配半套」三种状态。
  let handoff = null;
  const server = createCnInboundServer({
    repoRoot: tmp,
    port: 0,
    host: "0.0.0.0", // redeem 要求 LAN 已放开（409 pairing_not_open 的另一条路）
    pairingManager: pairingMgr,
    turnToken: "t-handoff-0123456789",
    relayHandoff: () => handoff,
    onTurn: async (prompt) => ({
      ok: true,
      messages: [{ role: "assistant", text: "echo: " + prompt }],
      host_results: [],
      stdout: "echo: " + prompt,
    }),
  });
  const info = await server.start();
  const port = info.port || info;
  const HOST = "127.0.0.1";

  const redeem = async (codeOverride) => {
    const issued = pairingMgr.issue();
    const code = codeOverride || issued.code;
    return httpPost(HOST, port, "/v1/pair/redeem", {
      code,
      device_name: "pixel-test",
      machine_kind: "android",
    });
  };

  /* PH-01 没配中转 → 回执里**没有** relay 这个键（形状不变，老客户端不受影响） */
  {
    handoff = null;
    const r = await redeem();
    if (r.status !== 200 || !r.json || r.json.ok !== true) {
      bad("PH-01 配对本身应当成功（这一条测的是「没配中转」不是「配不上」）", r.status + " " + r.text);
    } else if (Object.prototype.hasOwnProperty.call(r.json, "relay")) {
      bad("PH-01 没配中转时不该出现 relay 字段（会误导手机去连一个不存在的端点）", JSON.stringify(r.json.relay));
    } else if (!r.json.turn_token || !r.json.base_url) {
      bad("PH-01 既有字段不该被这次改动动到", r.text);
    } else {
      ok("PH-01 没配中转 → 回执无 relay 字段，turn_token / base_url 照旧");
    }
  }

  /* PH-02 配齐四栏 → 回执带 relay，且值与配置一致 */
  {
    handoff = {
      host: "relay.example.com",
      port: 18766,
      boxId: "box-home",
      clientToken: "cli-token-abc",
    };
    const r = await redeem();
    const relay = r.json && r.json.relay;
    if (!relay) {
      bad("PH-02 配了中转却没下发 relay（手机永远拿不到跨网参数）", r.text);
    } else if (relay.host !== "relay.example.com") {
      bad("PH-02 relay.host 不对", JSON.stringify(relay));
    } else if (relay.port !== 18766) {
      bad("PH-02 relay.port 必须保持数字（字符串会让端上端口校验判非法）", JSON.stringify(relay.port));
    } else if (relay.box_id !== "box-home") {
      bad("PH-02 relay.box_id 不对", JSON.stringify(relay.box_id));
    } else if (relay.client_token !== "cli-token-abc") {
      bad("PH-02 relay.client_token 不对", JSON.stringify(relay.client_token));
    } else {
      ok("PH-02 配齐 → relay 四栏（host/port/box_id/client_token）如实下发，port 是数字");
    }
  }

  /* PH-03 不夹带：relay 里只有那四栏，绝不许把 turn_token / 其他凭据塞进去 */
  {
    const r = await redeem();
    const relay = (r.json && r.json.relay) || {};
    const keys = Object.keys(relay).sort().join(",");
    if (keys !== "box_id,client_token,host,port") {
      bad("PH-03 relay 只准有四栏", keys || "(空)");
    } else if ("turn_token" in relay || "secret" in relay || "token" in relay) {
      bad("PH-03 relay 里夹带了别的凭据", keys);
    } else if (JSON.stringify(relay).includes(r.json.turn_token)) {
      bad("PH-03 relay 里出现了配对令牌原文（跨网不该复用配对令牌）", keys);
    } else {
      ok("PH-03 relay 只有 host/port/box_id/client_token，不含配对令牌");
    }
  }

  /* PH-04 半套配置 → **不下发**。给一半比不给更坏：手机会拿半套去连，报一个查不出来的错。
   * 注意这里先跑**正控**：配齐时必须真的下发。否则「半套不下发」在功能根本不存在时也会绿，
   * 那就是一条真空通过 —— 门禁骗自己比没门禁更坏。 */
  {
    handoff = { host: "relay.example.com", port: 18766, boxId: "box-home", clientToken: "cli-token-abc" };
    const ctrl = await redeem();
    if (!(ctrl.json && ctrl.json.relay)) {
      bad("PH-04 正控失败：配齐也没下发 relay，下面四种半套的结论不算数", ctrl.text);
      handoff = null;
    } else {
    const halfCases = [
      ["缺 clientToken", { host: "relay.example.com", port: 18766, boxId: "box-home" }],
      ["缺 boxId", { host: "relay.example.com", port: 18766, clientToken: "cli" }],
      ["port 非法", { host: "relay.example.com", port: 70000, boxId: "box-home", clientToken: "cli" }],
      ["port 是字符串垃圾", { host: "relay.example.com", port: "abc", boxId: "box", clientToken: "cli" }],
    ];
    const leaked = [];
    for (const [label, cfg] of halfCases) {
      handoff = cfg;
      const r = await redeem();
      if (!r.json || r.json.ok !== true) {
        leaked.push(label + "（配对本身失败了，尺子写错）");
      } else if (r.json.relay) {
        leaked.push(label + " → " + JSON.stringify(r.json.relay));
      }
    }
    if (leaked.length) bad("PH-04 配置不齐时必须不下发 relay", leaked.join("；"));
    else ok("PH-04 四种半套配置（缺 token / 缺 box / port 越界 / port 非数字）全部不下发；正控（配齐→下发）先过");
    handoff = null;
    }
  }

  /* PH-05 失败路径不泄漏：错码 → 400，且回包里没有 relay。
   * 同样先正控（配齐要能下发），否则「失败回包没 relay」在功能缺失时也是真空绿。 */
  {
    handoff = { host: "relay.example.com", port: 18766, boxId: "box-home", clientToken: "cli-token-abc" };
    const ctrl = await redeem();
    if (!(ctrl.json && ctrl.json.relay)) {
      bad("PH-05 正控失败：配齐也没下发 relay，失败路径的结论不算数", ctrl.text);
    } else {
    const r = await redeem("000000");
    if (r.status !== 400) {
      bad("PH-05 错码应当 400", r.status + " " + r.text);
    } else if (r.json && Object.prototype.hasOwnProperty.call(r.json, "relay")) {
      bad("PH-05 配对失败的回包里不该有 relay（失败路径不许泄漏跨网参数）", r.text);
    } else {
      ok("PH-05 错码 → 400 " + (r.json && r.json.error ? r.json.error : "") + "，回包无 relay（正控先过）");
    }
    }
  }

  await server.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("prove_pairing_relay_handoff: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_pairing_relay_handoff: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
