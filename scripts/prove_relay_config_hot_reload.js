#!/usr/bin/env node
"use strict";
/* prove_relay_config_hot_reload.js — A3-11 门禁（RH-01..RH-11）
 *
 * 要证的一件事：**运行中改 relay.json，盒子登记会跟着变，不用重启桌面 app**（部分关 R-A3-6h）。
 *
 * 为什么必须做：A3-6 起，配对回执里的 relay 四栏是每次兑换现读的；但「登记」只在
 * 入站启动 / 切局域网开关时发生（main.js 的 syncRelayBoxRegistration）。于是运行中
 * 改配置会出现「有四栏却 NOBOX」—— A3-10 真机清单 §2.3 / §7 里甚至把
 * 「配置改完要重启桌面 app」写成了现场 workaround。这一刀把它删掉。
 *
 * 架构口径：逻辑在 hosts/shared/relay/relay_config_watch.js（可测），main.js 只接线。
 * 所以运行时断言全部打在**真模块 + 真 relay + 真 socket**上（RH-01..RH-09），
 * 静态锚点只补那个 join（RH-10）—— A3-7 RB-09 的教训：
 * 「模块绿着但产品没用」是最容易漏的一种坏。
 *
 * 反真空的三处：RH-01 正控（配置齐时确实登记上）、RH-02（定时器真的在跑，不是空转）、
 * RH-08 门内注入对照（把 onChange 摘掉，同样的配置变更**不该**导致重登记）。
 *
 * 跑法：node scripts/prove_relay_config_hot_reload.js
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const WATCH = path.join(REPO, "hosts/shared/relay/relay_config_watch.js");
const CONFIG = path.join(REPO, "hosts/shared/relay/relay_config.js");
const KEYS = path.join(REPO, "hosts/shared/relay/relay_keys.js");
const RELAY = path.join(REPO, "hosts/shared/relay/relay_server.js");
const BOX = path.join(REPO, "hosts/shared/relay/relay_box_client.js");
const MAINJS = path.join(REPO, "hosts/desktop/main.js");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

async function waitFor(fn, tries, stepMs) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return Boolean(fn());
}

/** 手机只走控制面：AUTH + CONNECT，读回两行（NOBOX 也算有效结果）。 */
function phoneConnect(port, clientToken, boxId) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    let buf = "";
    const t = setTimeout(() => { s.destroy(); resolve("(timeout)"); }, 3000);
    s.on("data", (d) => {
      buf += d.toString("latin1");
      const lines = buf.split("\n");
      if (lines.length >= 3) { // OK / <reply> / 空
        clearTimeout(t);
        s.destroy();
        resolve(lines[1].trim());
      }
    });
    s.on("error", () => { clearTimeout(t); resolve("(error)"); });
    s.on("close", () => { clearTimeout(t); resolve(buf.split("\n")[1] ? buf.split("\n")[1].trim() : "(closed)"); });
    s.once("connect", () => s.write("AUTH " + clientToken + "\nCONNECT " + boxId + "\n"));
  });
}

async function main() {
  let watchMod = null, configMod = null, keysMod = null, relayMod = null, boxMod = null;
  const mods = [
    ["relay_config_watch", WATCH, (m) => { watchMod = m; }],
    ["relay_config", CONFIG, (m) => { configMod = m; }],
    ["relay_keys", KEYS, (m) => { keysMod = m; }],
    ["relay_server", RELAY, (m) => { relayMod = m; }],
    ["relay_box_client", BOX, (m) => { boxMod = m; }],
  ];
  for (const [name, p, set] of mods) {
    try { set(require(p)); } catch (e) { bad("RH-00 " + name + " 加载失败", e && e.message); }
  }
  if (!watchMod || !configMod || !keysMod || !relayMod || !boxMod) {
    console.log("prove_relay_config_hot_reload: PASS=" + PASS + " FAIL=" + FAIL);
    process.exit(1);
  }

  const SECRET = "hot-reload-secret-for-gate";
  const BOX_ID = "box-hot-reload";
  const boxToken = keysMod.issueRelayCredential(SECRET, "desktop-a", "box");
  const boxToken2 = keysMod.issueRelayCredential(SECRET, "desktop-b", "box");
  const clientToken = keysMod.issueRelayCredential(SECRET, "phone-a", "client");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-hotreload-"));
  const cfgPath = path.join(tmp, "relay.json");

  const relay = relayMod.createRelayServer({ relaySecret: SECRET, bindHost: "127.0.0.1" });
  const relayInfo = await relay.start();
  const localEndpoint = "127.0.0.1:" + relayInfo.controlPort; // 只作占位，本门不跑数据面

  const fullReverse = () => ({
    host: "127.0.0.1", port: relayInfo.controlPort, box_id: BOX_ID,
    box_token: boxToken, client_token: clientToken, mode: "reverse",
  });
  const writeCfg = (obj, pretty) => fs.writeFileSync(cfgPath, pretty ? JSON.stringify(obj, null, 4) : JSON.stringify(obj));
  const loadCfg = () => configMod.loadRelayConfig({ file: cfgPath, env: {} });

  /* 门里的 sync 复刻 main.js 的 syncRelayBoxRegistration 形状（幂等 + 按 key 重建）。
   * 诚实边界：这是门自己写的一份，不是 require main.js（那是 Electron 主进程）；
   * 「产品真的调用它」由 RH-10 的静态 join 锚点补上。 */
  let box = null;
  let boxKey = null;
  function sync() {
    const cfg = loadCfg();
    if (!cfg) {
      if (box) { box.stop(); box = null; boxKey = null; }
      return null;
    }
    const endpoint = cfg.endpoint || localEndpoint;
    const le = cfg.localEndpoint || localEndpoint;
    const key = [cfg.host, cfg.port, cfg.boxId, endpoint, cfg.mode, le].join("|");
    if (box && boxKey === key) return box;
    if (box) box.stop();
    box = boxMod.createRelayBoxClient({
      host: cfg.host, port: cfg.port, boxId: cfg.boxId, boxToken: cfg.boxToken,
      endpoint, mode: cfg.mode, localEndpoint: le,
      heartbeatMs: 0, reconnectMs: 0, // 门里不要自动重连，否则会掩盖「配置删掉后该下线」
    });
    boxKey = key;
    box.start();
    return box;
  }

  const watch = watchMod.createRelayConfigWatch({
    load: loadCfg,
    intervalMs: 40,
    onChange: () => sync(),
  });

  /* RH-01 反真空正控：配置齐时真的登记上，且是 reverse 条目。 */
  {
    writeCfg(fullReverse());
    watch.start();
    sync(); // 模拟入站启动时那一次登记
    const got = await waitFor(() => Boolean(relay.getRegistry()[BOX_ID]), 50, 20);
    const reg = relay.getRegistry()[BOX_ID];
    if (!got || !reg) {
      bad("RH-01 正控失败：配置齐了却没登记上（后面的红说明不了热生效）", JSON.stringify(relay.getRegistry()));
    } else if (reg.kind !== "reverse") {
      bad("RH-01 登记的不是 reverse 条目", JSON.stringify(reg));
    } else {
      ok("RH-01 正控：完整 reverse 配置 → 真 BIND 登记上（registry[" + BOX_ID + "].kind=reverse）");
    }
  }

  /* RH-02 定时器真的在跑 —— 否则「热生效」只是门手动 check() 出来的假象。 */
  {
    const before = watch.getState().checks;
    const ticked = await waitFor(() => watch.getState().checks > before, 40, 20);
    if (!ticked) bad("RH-02 观察器定时器没在跑（热生效只在门手动调用时成立）", JSON.stringify(watch.getState()));
    else ok("RH-02 观察器定时器真在跑（checks " + before + " → " + watch.getState().checks + "）");
  }

  /* RH-03 只改格式不触发 —— 指纹必须用归一后的配置，加空格不该重建长连接。 */
  {
    const before = watch.getState().changes;
    writeCfg(fullReverse(), true);
    const changed = watch.check();
    const after = watch.getState().changes;
    if (changed || after !== before) {
      bad("RH-03 往 JSON 里加空格/换行也触发了重登记（会白白断一次 BIND 长连接）", before + " → " + after);
    } else {
      ok("RH-03 只改格式不触发重登记（指纹用归一后的配置对象）");
    }
  }

  /* RH-04 改 mode：reverse → dial，旧长连接要断、新登记要生效。 */
  {
    const dialCfg = Object.assign(fullReverse(), {
      mode: "dial", endpoint: localEndpoint, box_token: boxToken,
    });
    writeCfg(dialCfg);
    const changed = watch.check();
    const got = await waitFor(() => {
      const r = relay.getRegistry()[BOX_ID];
      return r && r.kind === "dial";
    }, 50, 20);
    if (!changed) {
      bad("RH-04 改了 mode 观察器没报变化");
    } else if (!got) {
      bad("RH-04 配置切到 dial 后 registry 没跟着变（运行中改配置仍要重启 app）", JSON.stringify(relay.getRegistry()));
    } else {
      ok("RH-04 运行中改 mode=reverse→dial → 自动断旧长连接并按新配置登记（kind=dial）");
    }
  }

  /* RH-05 换 box_token：新凭证要能登记上（热生效不只是改 mode 这种显示字段）。 */
  {
    const c = Object.assign(fullReverse(), { box_token: boxToken2 });
    writeCfg(c);
    const changed = watch.check();
    const got = await waitFor(() => {
      const r = relay.getRegistry()[BOX_ID];
      return r && r.kind === "reverse" && box && box.getState().ok;
    }, 50, 20);
    if (!changed) {
      bad("RH-05 换了 box_token 观察器没报变化");
    } else if (!got) {
      bad("RH-05 换凭证后没重新登记成功（真现场就是改完密钥仍 NOBOX）", JSON.stringify(relay.getRegistry()));
    } else {
      ok("RH-05 运行中换 box_token → 自动用新凭证重新 BIND 成功");
    }
  }

  /* RH-06 删配置（半套）：盒子必须下线，手机明确回 NOBOX，而不是留一台幽灵盒子。 */
  {
    writeCfg({ host: "127.0.0.1" }); // 半套，loadRelayConfig 应回 null
    const changed = watch.check();
    const gone = await waitFor(() => !relay.getRegistry()[BOX_ID], 50, 20);
    let reply = "";
    try { reply = await phoneConnect(relayInfo.controlPort, clientToken, BOX_ID); }
    catch (e) { reply = "(error) " + e.message; }
    if (!changed) {
      bad("RH-06 配置被删观察器没报变化");
    } else if (!gone) {
      bad("RH-06 配置删了盒子还挂在 registry 上", JSON.stringify(relay.getRegistry()));
    } else if (reply !== "NOBOX") {
      bad("RH-06 盒子下线后手机没拿到明确 NOBOX", reply);
    } else {
      ok("RH-06 配置被删 → 自动停登记 → registry 清空 → 手机明确 NOBOX");
    }
  }

  /* RH-07 从无到有：重新写回完整配置，盒子要自己回来（这正是「不用重启 app」）。 */
  {
    writeCfg(fullReverse());
    const changed = watch.check();
    const cameBack = await waitFor(() => {
      const r = relay.getRegistry()[BOX_ID];
      return r && r.kind === "reverse";
    }, 50, 20);
    if (!changed) {
      bad("RH-07 配置从无到有观察器没报变化");
    } else if (!cameBack) {
      bad("RH-07 配置写回来了盒子却没自己回来（还得重启 app）", JSON.stringify(relay.getRegistry()));
    } else {
      ok("RH-07 配置从无到有 → 盒子自动重新上线（不需要重启桌面 app）");
    }
  }

  /* RH-08 门内注入对照：把 onChange 摘掉，同样的配置变更**不该**导致重登记。
   * 没有这条，「registry 变了」也可能来自别的魔法（心跳、relay 自己重连）。 */
  {
    watch.stop();
    const blind = watchMod.createRelayConfigWatch({ load: loadCfg, intervalMs: 0, onChange: () => {} });
    blind.start();
    const before = JSON.stringify(relay.getRegistry());
    const c = Object.assign(fullReverse(), { box_token: boxToken2 });
    writeCfg(c);
    const changed = blind.check();
    await new Promise((r) => setTimeout(r, 120));
    const after = JSON.stringify(relay.getRegistry());
    blind.stop();
    writeCfg(fullReverse());
    sync(); // 复原现场
    watch.start();
    if (!changed) {
      bad("RH-08 注入对照前置失败：空 onChange 的观察器连变化都没报");
    } else if (before !== after) {
      bad("RH-08 没接 onChange 时 registry 居然也变了（热生效的结论不干净）", before + " → " + after);
    } else {
      ok("RH-08 注入对照：摘掉 onChange 后同样改配置 → 观察器报变化但 registry 不变（重登记确实来自接线）");
    }
  }

  /* RH-09 stop() 之后不许再偷偷重登记。 */
  {
    watch.stop();
    const st = watch.getState();
    writeCfg(Object.assign(fullReverse(), { box_token: boxToken2 }));
    const fired = watch.check();
    if (st.running || fired || watch.getState().changes !== st.changes) {
      bad("RH-09 stop() 之后观察器还在触发", JSON.stringify(watch.getState()));
    } else {
      ok("RH-09 stop() 之后改配置不再触发（退出时不会留一个还在读配置的定时器）");
    }
    writeCfg(fullReverse());
  }

  /* RH-10 静态 join 锚点：模块绿 ≠ 产品会用（A3-7 RB-09 的教训）。 */
  {
    const src = fs.readFileSync(MAINJS, "utf8");
    const q0 = src.indexOf('app.on("before-quit"');
    const q1 = src.indexOf('app.on("will-quit"');
    const quitBlock = q0 >= 0 && q1 > q0 ? src.slice(q0, q1) : "";
    const i0 = src.indexOf('process.env.BITBOT_CN_INBOUND === "0"');
    const inboundOffBlock = i0 >= 0 ? src.slice(i0, i0 + 600) : "";
    const anchors = [
      [src, 'require("./shared/relay/relay_config_watch")', "没 require 观察器模块"],
      [src, "startRelayConfigWatch(started);", "ensureCnInbound 没启动观察器"],
      [src, "syncRelayBoxRegistration(relayConfigWatchStatus);", "onChange 没接到登记函数上"],
      [quitBlock, "stopRelayConfigWatch();", "before-quit 没停观察器"],
      [inboundOffBlock, "stopRelayConfigWatch();", "入站关掉时没停观察器"],
    ];
    const missing = anchors.filter(([s, needle]) => !s.includes(needle)).map(([, , why]) => why);
    if (missing.length) bad("RH-10 桌面接线缺了 " + missing.length + " 处：" + missing.join("；"));
    else ok("RH-10 五处接线都在：require / 启动 / onChange 接登记 / before-quit 停 / 入站关闭时停");
  }

  /* RH-11 热生效不许把「下发」改坏：四栏仍现读、仍正好四栏、不含 box_token。 */
  {
    const cfg = loadCfg();
    const h = configMod.toHandoff(cfg);
    const keys = Object.keys(h || {}).sort().join(",");
    const src = fs.readFileSync(MAINJS, "utf8");
    if (keys !== "box_id,client_token,host,port") {
      bad("RH-11 toHandoff 被撑大了（热生效不该改回执形状）", keys);
    } else if (JSON.stringify(h).includes(boxToken) || JSON.stringify(h).includes(boxToken2)) {
      bad("RH-11 四栏里夹带了 box_token");
    } else if (!src.includes("relayHandoff: () => currentRelayHandoff(),")) {
      bad("RH-11 回执不再每次兑换现读（A3-6 的能力被改坏了）");
    } else {
      ok("RH-11 回执四栏仍是现读的 host/port/box_id/client_token（不含 box_token）");
    }
  }

  try { watch.stop(); } catch (_) {}
  try { if (box) box.stop(); } catch (_) {}
  await relay.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("prove_relay_config_hot_reload: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_relay_config_hot_reload: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
