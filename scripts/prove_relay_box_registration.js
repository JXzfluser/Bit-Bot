#!/usr/bin/env node
/* prove_relay_box_registration.js — A3-7 门禁（RB-01..RB-08）
 *
 * 要证的一件事：**桌面自己会挂到中转上**，而不是等人从终端 export 环境变量。
 *
 * 为什么这条必须有：A3-6 把「参数下发」接通了，但两份材料一直是空的 ——
 *   ① `hosts/desktop/main.js` 的 `ensureCnInbound()` 从不传 `relayHandoff`，也没读任何配置文件
 *      ⇒ 普通用户跑起来，回执里根本没有 `relay`（登记为 R-A3-6d）；
 *   ② 仓库里只有中转**服务端**与测试用的进程内 `registerBox()`，**没有任何以 box 角色
 *      连上去 REGISTER 的客户端** ⇒ 就算四栏配好，真跨网 `CONNECT` 也只会回 `NOBOX`（R-A3-6e）。
 *
 * 这一刀补的就是这两段：读配置 → 盒子上线登记 → 心跳重登记 → 参数下发。
 *
 * 证到哪一步（诚实边界，写在最后）：本门用真 relay_server + 真 cn_inbound + 真 socket，
 * 证的是「这条路在进程间真的通」。它**不**证公网、不证 TLS、不证真机 —— 那些是 R-A3-3b/R-A2-1。
 *
 * 跑法：node scripts/prove_relay_box_registration.js
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const http = require("http");

const REPO = path.resolve(__dirname, "..");
const { createRelayServer } = require(path.join(REPO, "hosts/shared/relay/relay_server.js"));
const { issueRelayCredential } = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));
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
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : ""));
};
const skipBlock = (m) => {
  FAIL++;
  console.log("  ✗ " + m);
};

/* ---------------------------------------------------------------- 小工具 */

function httpGet(host, port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: urlPath, method: "GET" }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, text: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

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
          } catch (_) {}
          resolve({ status: res.statusCode, json, text: data });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** 逐字节读到一行（不带缓冲的 readline：控制面之后的数据面首字节不能被吞）。 */
function readLineFrom(socket) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d) => {
      buf += d.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        socket.removeListener("data", onData);
        resolve(buf.slice(0, nl).trim());
      }
    };
    socket.on("data", onData);
    socket.on("error", reject);
    socket.setTimeout(8000, () => reject(new Error("read line timeout")));
  });
}

/** 假 client：按线协议 CONNECT <boxId>，拿到 TUNNEL 之后把 socket 交给调用方。 */
async function connectViaRelay(relayPort, clientToken, boxId) {
  const s = net.connect(relayPort, "127.0.0.1");
  await new Promise((res, rej) => {
    s.once("connect", res);
    s.once("error", rej);
  });
  s.write("AUTH " + clientToken + "\n");
  const auth = await readLineFrom(s);
  if (auth !== "OK") {
    s.destroy();
    return { ok: false, line: auth };
  }
  s.write("CONNECT " + boxId + "\n");
  const reply = await readLineFrom(s);
  s.setTimeout(0);
  if (!reply.startsWith("TUNNEL ")) {
    s.destroy();
    return { ok: false, line: reply };
  }
  return { ok: true, endpoint: reply.slice("TUNNEL ".length).trim(), socket: s };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-relay-box-"));
  const configPath = path.join(tmp, "data/desktop/relay.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  /* 模块缺失就直接红（和 G-79 同一口径：模块没实现时不该「悄悄跳过」）。 */
  let relayConfigMod = null;
  let boxClientMod = null;
  try {
    relayConfigMod = require(path.join(REPO, "hosts/shared/relay/relay_config.js"));
  } catch (e) {
    skipBlock("RB-00 hosts/shared/relay/relay_config.js 加载失败：" + (e && e.message));
  }
  try {
    boxClientMod = require(path.join(REPO, "hosts/shared/relay/relay_box_client.js"));
  } catch (e) {
    skipBlock("RB-00 hosts/shared/relay/relay_box_client.js 加载失败：" + (e && e.message));
  }
  if (!relayConfigMod || !boxClientMod) {
    console.log("prove_relay_box_registration: PASS=" + PASS + " FAIL=" + FAIL);
    process.exit(1);
  }
  const { loadRelayConfig, toHandoff } = relayConfigMod;
  const { createRelayBoxClient } = boxClientMod;

  const SECRET = "relay-secret-for-gate";
  const BOX_ID = "box-gate-home";
  const boxToken = issueRelayCredential(SECRET, "desktop-gate", "box");
  const clientToken = issueRelayCredential(SECRET, "phone-gate", "client");

  let relay = createRelayServer({ relaySecret: SECRET, bindHost: "127.0.0.1" });
  let relayInfo = await relay.start();

  /* 真的 cn_inbound：隧道那头必须有东西在听，否则 RB-03 只是「连上一个空壳」。 */
  const pairingMgr = createPairingCodeManager();
  let handoff = null;
  const inbound = createCnInboundServer({
    repoRoot: tmp,
    port: 0,
    // redeem 要求「允许手机连接」已放开（否则 409 pairing_not_open）——
    // 这里绑 0.0.0.0 只为让配对这条路能走，隧道那头仍然是 127.0.0.1:port。
    host: "0.0.0.0",
    pairingManager: pairingMgr,
    turnToken: "t-boxreg-0123456789",
    relayHandoff: () => handoff,
    onTurn: async (prompt) => ({
      ok: true,
      messages: [{ role: "assistant", text: "echo: " + prompt }],
      host_results: [],
      stdout: "echo: " + prompt,
    }),
  });
  const inboundInfo = await inbound.start();
  const inboundPort = inboundInfo.port || inboundInfo;
  const realEndpoint = "127.0.0.1:" + inboundPort;

  const writeConfig = (obj) => fs.writeFileSync(configPath, JSON.stringify(obj), "utf8");
  const fullConfig = {
    host: "127.0.0.1",
    port: relayInfo.controlPort,
    box_id: BOX_ID,
    box_token: boxToken,
    client_token: clientToken,
  };

  const redeem = async () => {
    const issued = pairingMgr.issue();
    return httpPost("127.0.0.1", inboundPort, "/v1/pair/redeem", {
      code: issued.code,
      device_name: "gate-phone",
      machine_kind: "android",
    });
  };

  /* RB-01 没配置：不读、不连、不下发。 */
  {
    const cfg = loadRelayConfig({ file: configPath, env: {} });
    if (cfg !== null) {
      bad("RB-01 配置文件不存在时必须回 null（不许编一个默认中转）", JSON.stringify(cfg));
    } else if (toHandoff(cfg) !== null) {
      bad("RB-01 没配置时 toHandoff 必须回 null");
    } else {
      handoff = toHandoff(cfg);
      const r = await redeem();
      if (!r.json || r.json.ok !== true) {
        bad("RB-01 配对本身应当成功（这条测的是「没配中转」）", r.text);
      } else if (Object.prototype.hasOwnProperty.call(r.json, "relay")) {
        bad("RB-01 没配中转时回执不该有 relay", JSON.stringify(r.json.relay));
      } else {
        ok("RB-01 没配置：load → null、toHandoff → null、配对回执无 relay（形状不变）");
      }
    }
  }

  /* RB-02 配齐：load 认得出五栏，且**只把手机那四栏**交出去（box_token 绝不外发）。 */
  let cfg = null;
  {
    writeConfig(fullConfig);
    cfg = loadRelayConfig({ file: configPath, env: {} });
    if (!cfg) {
      bad("RB-02 配齐了却读不出来（桌面永远挂不上中转）", fs.readFileSync(configPath, "utf8"));
    } else if (cfg.boxId !== BOX_ID || cfg.port !== relayInfo.controlPort) {
      bad("RB-02 读出来的 host/port/boxId 不对", JSON.stringify(cfg));
    } else if (!cfg.boxToken || !cfg.clientToken) {
      bad("RB-02 两把钥匙（box_token / client_token）都要读到", JSON.stringify(Object.keys(cfg)));
    } else {
      const h = toHandoff(cfg);
      const keys = Object.keys(h || {}).sort().join(",");
      if (keys !== "box_id,client_token,host,port") {
        bad("RB-02 下发给手机的必须正好四栏（不许夹带 box_token）", keys || "(空)");
      } else if (JSON.stringify(h).includes(cfg.boxToken)) {
        bad("RB-02 下发的四栏里出现了 box 凭证（那是桌面自己的钥匙）");
      } else {
        ok("RB-02 配齐 → 五栏读得全，下发给手机的只有 host/port/box_id/client_token（box_token 不外泄）");
      }
    }
  }

  /* RB-11 反真空的正控：RB-01 断言的是「没配时不出现 relay」，而「不出现」这句话只有在
   * 「配齐了确实出现」成立时才有意义。这条走**真 HTTP**：真配置文件 → loadRelayConfig →
   * toHandoff → 兑换回执。缺了它，RB-01 就是一个永远为真的空断言。
   * （A3-6 的 PH-01..PH-05 也证过同一件事，但那条门用的是自己拼的 relayHandoff；这里用的是
   *   产品实际会读的那个配置文件，口径不同，两边都要在。）
   */
  if (cfg) {
    handoff = toHandoff(cfg);
    const r = await redeem();
    const rel = r.json && r.json.relay;
    const keys = rel ? Object.keys(rel).sort().join(",") : "";
    if (!r.json || r.json.ok !== true) {
      bad("RB-11 配齐中转后配对本身竟然失败（正控前提没了）", r.text);
    } else if (!rel) {
      bad("RB-11 配了中转，回执里却没有 relay —— 手机拿不到参数，跨网无从开始", r.text);
    } else if (keys !== "box_id,client_token,host,port") {
      bad("RB-11 回执里 relay 的字段不是那四栏", keys);
    } else if (rel.port !== relayInfo.controlPort || rel.box_id !== BOX_ID) {
      bad("RB-11 回执里的中转端口/boxId 与配置不一致", JSON.stringify(rel));
    } else if (JSON.stringify(rel).includes(boxToken)) {
      bad("RB-11 回执把 box 凭证一起给了手机（等于把登记权也交出去）");
    } else {
      ok("RB-11 正控：配置文件 → 回执 relay 四栏与配置一致（" + rel.host + ":" + rel.port + " / " + rel.box_id + "）");
    }
  } else {
    bad("RB-11 正控跑不了：RB-02 没读出配置");
  }

  /* RB-03 盒子真的登记上去了：真连 relay、真发 AUTH/REGISTER，registry 里能查到端点。 */
  const box = createRelayBoxClient({
    host: "127.0.0.1",
    port: relayInfo.controlPort,
    boxId: BOX_ID,
    boxToken,
    endpoint: realEndpoint,
    heartbeatMs: 60000, // 这条只测「登记一次」，心跳留给 RB-07
  });
  {
    const r = await box.registerOnce();
    const reg = relay.getRegistry()[BOX_ID];
    if (!r || r.ok !== true) {
      bad("RB-03 登记这一步就失败了（真跨网会一直 NOBOX）", JSON.stringify(r));
    } else if (!reg) {
      bad("RB-03 客户端说成功了，但 relay 的 registry 里没有这台盒子", JSON.stringify(relay.getRegistry()));
    } else if (reg.endpoint !== realEndpoint) {
      bad("RB-03 登记的端点不对（client 会连到别处去）", JSON.stringify(reg));
    } else {
      ok("RB-03 AUTH + REGISTER 走通：registry[" + BOX_ID + "] = " + reg.endpoint);
    }
  }

  /* RB-04 端到端：client 角色 CONNECT 拿到 TUNNEL，并且**真的穿过隧道**打到 cn_inbound。 */
  {
    const c = await connectViaRelay(relayInfo.controlPort, clientToken, BOX_ID);
    if (!c.ok) {
      bad("RB-04 client CONNECT 没拿到 TUNNEL（跨网第一条就断）", c.line);
    } else if (c.endpoint !== realEndpoint) {
      bad("RB-04 TUNNEL 给的端点与登记的不一致", c.endpoint + " ≠ " + realEndpoint);
      try {
        c.socket.destroy();
      } catch (_) {}
    } else {
      c.socket.write(
        "GET /v1/pair/discover HTTP/1.1\r\nHost: " +
          realEndpoint +
          "\r\nConnection: close\r\n\r\n",
      );
      const resp = await new Promise((res) => {
        let buf = "";
        c.socket.on("data", (d) => (buf += d.toString("utf8")));
        c.socket.on("close", () => res(buf));
        c.socket.on("error", () => res(buf));
      });
      try {
        c.socket.destroy();
      } catch (_) {}
      const status = (resp.split("\r\n")[0] || "").trim();
      if (!/^HTTP\/1\.1 200/.test(status)) {
        bad("RB-04 隧道里打不通真 cn_inbound（拿到了 TUNNEL 也不等于能用）", status + " | " + resp.slice(-120));
      } else {
        ok("RB-04 穿过隧道打到真 cn_inbound：GET /v1/pair/discover → " + status);
      }
    }
  }

  /* RB-05 错 box 凭证：DENY，且 registry 里不许出现第二个盒子。先跑正控（配齐能登记），
   * 否则「错了也登记不上」在功能不存在时同样成立 —— 那是真空通过。 */
  {
    const ctrl = await createRelayBoxClient({
      host: "127.0.0.1",
      port: relayInfo.controlPort,
      boxId: BOX_ID + "-ctrl",
      boxToken,
      endpoint: realEndpoint,
    }).registerOnce();
    if (!ctrl || ctrl.ok !== true) {
      bad("RB-05 正控失败：好凭证也没登记上，下面「坏凭证被拒」的结论不算数", JSON.stringify(ctrl));
    } else {
      const badClient = createRelayBoxClient({
        host: "127.0.0.1",
        port: relayInfo.controlPort,
        boxId: BOX_ID + "-bad",
        boxToken: issueRelayCredential("wrong-secret", "x", "box"),
        endpoint: realEndpoint,
      });
      const r = await badClient.registerOnce();
      const reg = relay.getRegistry();
      if (r && r.ok === true) {
        bad("RB-05 错凭证居然登记成功（中转准入形同虚设）", JSON.stringify(r));
      } else if (reg[BOX_ID + "-bad"]) {
        bad("RB-05 被拒的盒子仍出现在 registry 里", JSON.stringify(reg[BOX_ID + "-bad"]));
      } else if (!r || r.reason !== "denied") {
        bad("RB-05 被拒时要能说清原因（denied ≠ transport）", JSON.stringify(r));
      } else {
        ok("RB-05 错 box 凭证 → reason=denied、registry 无此盒（正控：好凭证先登记成功）");
      }
    }
  }

  /* RB-06 半套配置：整体不认（不下发、也不登记）。给一半比不给更坏。 */
  {
    const halfCases = [
      ["缺 client_token", { ...fullConfig, client_token: "" }],
      ["缺 box_token", { ...fullConfig, box_token: "" }],
      ["port 非法", { ...fullConfig, port: 70000 }],
    ];
    const leaked = [];
    for (const [label, obj] of halfCases) {
      writeConfig(obj);
      const c = loadRelayConfig({ file: configPath, env: {} });
      if (c !== null) leaked.push(label + " → 仍被认作可用配置");
      else if (toHandoff(c) !== null) leaked.push(label + " → toHandoff 仍给了四栏");
    }
    writeConfig(fullConfig); // 复原，后面还要用
    if (leaked.length) bad("RB-06 半套配置必须整体不认", leaked.join("；"));
    else ok("RB-06 三种半套（缺 client_token / 缺 box_token / port 越界）一律回 null，不下发也不登记");
  }

  /* RB-07 心跳重登记：relay 重启后 registry 是空的（内存表），盒子必须**自己回来**。
   *
   * 形状很关键：客户端必须先跑在**旧 relay** 上（它那一次立即登记落在旧表里），再换一台新的
   * 空 relay —— 只有这样，「新表里又出现它」才只能由心跳解释。
   * 如果让客户端在重启之后再 start，它的「立即登记一次」就会把断言撑绿：
   * 那时即便完全不做心跳，RB-07 也过 —— 那是一条真空通过的断言。 */
  {
    const beat = createRelayBoxClient({
      host: "127.0.0.1",
      port: relayInfo.controlPort,
      boxId: BOX_ID,
      boxToken,
      endpoint: realEndpoint,
      heartbeatMs: 150,
    });
    beat.start();
    // 正控：它至少在旧 relay 上登记成功过一次（否则下面「没回来」说明不了心跳的事）。
    const t0 = Date.now();
    let onOld = false;
    while (Date.now() - t0 < 3000) {
      if (relay.getRegistry()[BOX_ID]) {
        onOld = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 60));
    }

    // 重启要**用同一个端口**：真实世界里 relay 进程重启，端口是它的配置，不会变；
    // 客户端也只认那个地址。换端口等于换了台中转，那是另一件事（客户端会一直连不上）。
    const oldPort = relayInfo.controlPort;
    await new Promise((res) => relay.stop().then(res));
    relay = createRelayServer({ relaySecret: SECRET, bindHost: "127.0.0.1", controlPort: oldPort });
    relayInfo = await relay.start();
    const emptyAfterRestart = !relay.getRegistry()[BOX_ID]; // 反真空：新表确实是空的

    const t1 = Date.now();
    let cameBack = false;
    while (Date.now() - t1 < 3000) {
      if (relay.getRegistry()[BOX_ID]) {
        cameBack = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    const beatMs = Date.now() - t1;
    try {
      beat.stop();
    } catch (_) {}
    if (!onOld) {
      bad("RB-07 正控失败：客户端在旧 relay 上一次都没登记上，下面「没回来」说明不了心跳");
    } else if (!emptyAfterRestart) {
      bad("RB-07 反真空失败：换新 relay 后 registry 里已经有这台盒子，测不出心跳");
    } else if (!cameBack) {
      bad("RB-07 relay 重启后盒子没回来（registry 是内存表，没人重登记就永远是 NOBOX）");
    } else {
      ok("RB-07 旧 relay 上登记成功 → 换新 relay（确认为空）→ 心跳把盒子重登记回来（" + beatMs + "ms）");
    }
  }

  /* RB-08 relay 侧看到的必须是「元数据只有端点」：登记这件事不该把凭证写进审计日志。 */
  {
    const audit = relay
      .getAuditLog()
      .filter((r) => r.event === "register")
      .map((r) => JSON.stringify(r))
      .join("\n");
    if (!audit.length) {
      bad("RB-08 relay 没有记到任何 register 事件（这条要的是「有日志且查无凭证」）");
    } else if (audit.includes(boxToken) || audit.includes(SECRET) || audit.includes(clientToken)) {
      bad("RB-08 审计日志里出现了凭证原文（中转侧不该看得到它）");
    } else {
      ok("RB-08 审计日志有 register 事件且查无凭证（只记 boxId/endpoint）");
    }
  }

  /* RB-09 接线：模块自己绿不等于产品会用。
   *
   * A3-5/A3-6 那两条旧尺子就是这么瞎掉的 —— 门只认旧写法，产品已经换了写法，两边各自
   * 「看着都对」。所以这一条钉的是**join**，一共五处，任何一处回退都要红：
   *   ① 四栏由 main.js 传进 `createCnInboundServer`（否则 R-A3-6d 原地：只有环境变量）；
   *   ② 服务端真的读 `opts.relayHandoff`（防「传了但没人读」，参数静静躺在闭包里）；
   *   ③ `ensureCnInbound` 拿住 `await cnInbound.start()` 的结果（拿不到真实端口）；
   *   ④ 盒子登记接在 `started` 上（不是接在那个壳对象 cnInbound 上）；
   *   ⑤ `before-quit` 里把心跳停掉（否则中转上永远留一台拨不通的盒子）。
   *
   * 诚实边界：这几处是**静态锚点** —— 证「接线在」，不证「运行时一定通」。运行时语义由
   * RB-01..RB-08 用真 socket 证。少了任何一边都不闭合：光看静态锚点会被注释骗过，
   * 光跑模块又不知道产品有没有调用它。
   */
  {
    const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
    const inboundJs = fs.readFileSync(path.join(REPO, "hosts/shared/cn_inbound_server.js"), "utf8");
    const anchors = [
      [mainJs, "relayHandoff: () => currentRelayHandoff(),", "四栏没接进 createCnInboundServer（R-A3-6d 原地）"],
      [inboundJs, "opts.relayHandoff", "服务端从没读过 opts.relayHandoff（传了也白传）"],
      [mainJs, "const started = await cnInbound.start();", "ensureCnInbound 没拿住 start() 的结果（拿不到真实端口）"],
      [mainJs, "syncRelayBoxRegistration(started)", "盒子登记没接在 inbound 的启动结果上（R-A3-6e 原地）"],
    ];
    const missing = anchors.filter(([src, needle]) => !src.includes(needle)).map(([, , why]) => why);
    // 退出清理必须落在 before-quit 里 —— 全文搜 `relayBox.stop()` 会被别处的分支撑绿。
    const q0 = mainJs.indexOf('app.on("before-quit"');
    const q1 = mainJs.indexOf('app.on("will-quit"');
    const quitBlock = q0 >= 0 && q1 > q0 ? mainJs.slice(q0, q1) : "";
    if (!/relayBox\.stop\(\)/.test(quitBlock)) {
      missing.push("before-quit 里没停心跳（中转上会留一台拨不通的盒子）");
    }
    if (missing.length) {
      bad("RB-09 桌面接线缺了 " + missing.length + " 处：" + missing.join("；"));
    } else if (/return cnInbound\.start\(\);/.test(mainJs)) {
      bad("RB-09 ensureCnInbound 还是老写法 `return cnInbound.start()` —— 盒子拿不到端口，登记无从下手");
    } else {
      ok("RB-09 五处接线都在：四栏传入 / 服务端真读 / 拿住 started / 登记接 started / 退出停心跳");
    }
  }

  /* RB-10 默认路径：main.js 调用 loadRelayConfig 时**只给 repoRoot**，不给 file。
   * 所以「不传 file 也真的读得到 data/desktop/relay.json」必须单独证 —— 否则现场把配置
   * 写进仓库的 data/desktop/relay.json，桌面可能读的是 cwd 或别处，症状是「明明配了却还是没配」。
   */
  {
    const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-rb-root-"));
    try {
      const defPath = relayConfigMod.defaultRelayConfigPath(fakeRoot);
      fs.mkdirSync(path.dirname(defPath), { recursive: true });
      fs.writeFileSync(
        defPath,
        JSON.stringify({
          host: "127.0.0.1",
          port: 18766,
          box_id: "box-default-path",
          box_token: "bt-x",
          client_token: "ct-x",
        }),
        "utf8",
      );
      const got = relayConfigMod.loadRelayConfig({ repoRoot: fakeRoot, env: {} });
      const nowhere = relayConfigMod.loadRelayConfig({
        repoRoot: path.join(fakeRoot, "no-such-root"),
        env: {},
      });
      const h = toHandoff(got);
      // 上面「写」和「读」都走同一个函数算路径 —— 这条路**自指**：默认路径整体挪错位置
      // 也照样绿。所以这里再钉一条字面路径（文档与现场都按这个位置放配置）。
      const wantPath = path.join(fakeRoot, "data", "desktop", "relay.json");
      if (path.resolve(defPath) !== path.resolve(wantPath)) {
        bad("RB-10 默认配置路径不是 data/desktop/relay.json（现场按文档放的文件读不到）", defPath);
      } else if (!got || got.boxId !== "box-default-path") {
        bad("RB-10 只给 repoRoot 时读不到 data/desktop/relay.json（桌面永远算「没配」）", defPath);
      } else if (nowhere) {
        bad("RB-10 换一个没有配置的 repoRoot 竟然读出了配置（来源不明）", JSON.stringify(nowhere));
      } else if (!h || "endpoint" in h) {
        bad("RB-10 endpoint 不该出现在下发给手机的四栏里（那是 relay 拨回来的地址）", JSON.stringify(h));
      } else {
        ok("RB-10 默认路径 = <repoRoot>/data/desktop/relay.json，只给 repoRoot 读得到；endpoint 不外发");
      }
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  }

  /* RB-12 装机接缝：源码里 require 得到，不等于打进 app 之后还在。
   *
   * `main.js` 是先试 `./shared/...` 再退 `../shared/...`；装机包里 `main.js` 被放到
   * `desktop/main.js`，只有第二条能命中。而 `hosts/desktop/package.json` 的
   * `build.files` 是把 `../shared` 整棵拷到 `shared/`。**如果那份 filter 被改成文件白名单，
   * 新加的 hosts/shared/relay/ 两个模块就不会进包，装机版一启动直接 require 失败** ——
   * 本机怎么跑都绿，用户双击打不开。这条钉的就是这个接缝（正控：filter 必须覆盖整棵树）。
   */
  {
    let pkg = null;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(REPO, "hosts/desktop/package.json"), "utf8"));
    } catch (e) {
      bad("RB-12 读不到 hosts/desktop/package.json（装机配置都看不见，谈何覆盖）", e && e.message);
    }
    if (pkg) {
      const entries = (pkg.build && Array.isArray(pkg.build.files)) ? pkg.build.files : [];
      const sharedEntry = entries.find(
        (e) => e && typeof e === "object" && e.from === "../shared" && e.to === "shared",
      );
      const filters = sharedEntry && Array.isArray(sharedEntry.filter) ? sharedEntry.filter : [];
      // 只看**包含项**：`!**/*.map` 这种排除项里也有 `**`，混进来会让断言恒真
      // （负向对照实测：把 `**/*` 改成 `*.js`，这一条居然还是绿的）。
      const recursiveInclude = filters
        .filter((f) => !String(f).startsWith("!"))
        .some((f) => String(f).includes("**"));
      const needFiles = [
        "hosts/shared/relay/relay_config.js",
        "hosts/shared/relay/relay_box_client.js",
      ];
      const onDisk = needFiles.every((f) => fs.existsSync(path.join(REPO, f)));
      const mainSrc = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
      const fallback = mainSrc.includes('require("../shared/relay/relay_config")') &&
        mainSrc.includes('require("../shared/relay/relay_box_client")');
      if (!onDisk) {
        bad("RB-12 两个 relay 模块在源码树里就找不到（门跑在幻觉上）");
      } else if (!sharedEntry) {
        bad("RB-12 打包配置里没有 `../shared → shared` 这一项，装机版根本带不上共享模块");
      } else if (!recursiveInclude) {
        bad("RB-12 shared 的包含项里没有递归通配 —— 新增的 relay/ 子目录进不了 asar", JSON.stringify(filters));
      } else if (!fallback) {
        bad("RB-12 main.js 没有 `../shared/relay/...` 的兜底 require（装机版路径与源码不同）");
      } else {
        ok("RB-12 装机接缝在：打包把 hosts/shared 整棵拷进 shared/，两个新模块都在树里，main.js 有 ../shared 兜底");
      }
    }
  }

  try {
    box.stop();
  } catch (_) {}
  await inbound.stop();
  await relay.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("prove_relay_box_registration: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_relay_box_registration: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
