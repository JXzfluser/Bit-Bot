#!/usr/bin/env node
"use strict";
/* prove_relay_bootstrap.js — A3-18 门禁（RBI-01..RBI-10）
 *
 * 要证的一件事：**手机在蜂窝网下也能配对** —— 桌面能把「中转四栏」提前交出去，
 * 交出去的那段串手机认得、且里面没有桌面自己那把那把钥匙。
 *
 * 现场死结（R-A3-6a）：`DesktopPairing.redeemCode` 只 POST 局域网地址
 * （`http://<ip>:18765/v1/pair/redeem`），而中转四栏**只有配对成功之后**才下发。
 * 于是「在蜂窝网下配第一次」在结构上不可能 —— 必须先回同一个 Wi-Fi 配一次。
 *
 * 破法：桌面多一个「生成跨网配对串」的出口（`buildRelayBootstrap`），
 * 手机粘一次、解析成 RelayConfig、redeem 走 relay 隧道。门禁要证的不是
 * 「有这个函数」，而是这四段真的连着：
 *   ① 生成（RBI-01..RBI-04）：形状对不对、有没有把 box_token 漏出去、
 *      地址自检不过时会不会照样生成一段连不上的串；
 *   ② 两端线格式（RBI-05..RBI-06）：转义/还原、协议前缀、键名、转义字符集
 *      **逐字**对齐 —— 这里对不上，用户粘过去就是「解析不出来」；
 *   ③ 接线（RBI-07..RBI-09）：桌面 IPC/preload/界面、手机 PairingSheet/MainActivity/
 *      DesktopPairing 真的走隧道而不是又回到直连 IP；
 *   ④ 行为（RBI-10）：Kotlin 侧 RB-01..RB-06 真在跑（执行由 AB-21 在 JVM 结果里点名）。
 *
 * 诚实边界：
 *  - 本门**不执行 Kotlin**。两端对齐用的是「字面量逐字比对 + 键序列比对」，
 *    不是「跑一遍 Kotlin 看结果」。真正的解析行为由 LinkStatusTest 的 RB 用例承担，
 *    AB-21 负责点名那些用例真的出现在 JVM 结果里。这里不假装自己跑过 Kotlin。
 *  - 没有真手机、没有真 relay 部署：串「粘过去能用」这一跳仍是 R-A3-6a 的残留。
 *
 * 跑法：node scripts/prove_relay_bootstrap.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SETTINGS = require(path.join(REPO, "hosts/shared/relay/relay_settings.js"));
const KEYS = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));
const { createSecretVault } = require(path.join(REPO, "hosts/desktop/secret_vault.js"));
const MAINJS = path.join(REPO, "hosts/desktop/main.js");
const PRELOAD = path.join(REPO, "hosts/desktop/preload.js");
const HTML = path.join(REPO, "hosts/desktop/index.html");
const ANDROID = path.join(REPO, "hosts/android/BitBotHost/app/src/main/java/com/bitbot/host");
const KT_BOOT = path.join(ANDROID, "RelayBootstrap.kt");
const KT_PAIR = path.join(ANDROID, "DesktopPairing.kt");
const KT_ACT = path.join(ANDROID, "MainActivity.kt");
const KT_SHEETS = path.join(ANDROID, "ui/Sheets.kt");
const KT_TEST = path.join(REPO, "hosts/android/BitBotHost/app/src/test/java/com/bitbot/host/LinkStatusTest.kt");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

/** 固定假网卡表：这台桌面有 10.201.107.104，**没有** 192.168.1.5。 */
const IFACES = {
  en0: [{ address: "10.201.107.104", family: "IPv4", internal: false }],
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
};

const readText = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

/**
 * 两端约定的解析规则（**镜像** RelayBootstrap.parse 的 query 部分，只用于
 * 证明「桌面生成的串按同一套规则能还原」，不是第二份产品实现）。
 * 改这里必须同时改 RelayBootstrap.kt 的 unesc/键名，RBI-06 会把不一致打红。
 */
function mirrorParse(text) {
  const SCHEME = "bitbot-relay://v1";
  let q = String(text || "").trim();
  if (q.startsWith(SCHEME + "?")) q = q.slice(SCHEME.length + 1);
  else if (q.startsWith(SCHEME)) q = q.slice(SCHEME.length).replace(/^[?&]/, "");
  else if (q.startsWith("?")) q = q.slice(1);
  const map = new Map();
  for (const pair of q.split("&")) {
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    map.set(pair.slice(0, i).trim().toLowerCase(), pair.slice(i + 1).trim());
  }
  const unesc = (v) => String(v || "").replace(/%23/g, "#").replace(/%26/g, "&").replace(/%25/g, "%");
  return {
    host: unesc(map.get("h")),
    port: Number.parseInt(map.get("p") || "0", 10) || 0,
    boxId: unesc(map.get("b")),
    token: unesc(map.get("t") || map.get("token")),
  };
}

/**
 * RBI-06 的判据本体：给定两端源码，说出哪里对不上。抽成函数是为了让**注入对照
 * 复用同一个判据**（上一版把对照写成「替换掉再检查字符串没了」，那是恒真的 ——
 * 恒真的对照比没有对照更糟，它会让人以为判据有牙）。
 */
function measureWire(kt, jsSrc) {
  const problems = [];
  const ktScheme = (kt.match(/const val SCHEME\s*=\s*"([^"]+)"/) || [])[1] || "";
  const jsScheme = jsSrc.includes("bitbot-relay://v1?h=") ? "bitbot-relay://v1" : "";
  if (ktScheme !== "bitbot-relay://v1") problems.push("Kotlin SCHEME 不是约定值：" + (ktScheme || "(缺失)"));
  if (!jsScheme) problems.push("JS 生成器前缀不是 bitbot-relay://v1?");
  for (const k of ["h", "p", "b", "t"]) {
    if (!kt.includes(`map["${k}"]`)) problems.push("Kotlin 解析不读键 " + k);
    // 生成器里第一个键前面是 `?`（紧跟协议前缀，形如 `bitbot-relay://v1?h=`），
    // 后面的键前面是 `&`。两种都算「出这个键」—— 别假设引号就在 `?` 前面。
    if (!jsSrc.includes(`?${k}=`) && !jsSrc.includes(`&${k}=`)) problems.push("JS 生成器不出键 " + k);
  }
  // 转义集对齐：两端口径都必须是 % & # → %25 %26 %23。
  // 两个坑都踩过：
  //  ① 带 \n 的懒正则 `=([\s\S]{0,240}?)\n` 会捕获空串 —— 函数体在 `=` 后面换行；
  //  ② 只查「`replace("#"` 在不在」是不够的：把映射改坏成 `replace("#", "#")`
  //     那串还在，判据照样绿。必须连**映射的目标值**一起钉住，否则这条是摆设。
  const ktEscStart = kt.indexOf("private fun esc(");
  const ktEsc = ktEscStart >= 0 ? kt.slice(ktEscStart, ktEscStart + 240) : "";
  const jsAt = jsSrc.indexOf("const esc = (v) =>");
  const jsEscArea = jsAt >= 0 ? jsSrc.slice(jsAt, jsAt + 200) : "";
  const ESC_MAP = [["%", "%25"], ["&", "%26"], ["#", "%23"]];
  for (const [ch, to] of ESC_MAP) {
    if (!ktEsc.includes(`replace("${ch}", "${to}")`)) problems.push(`Kotlin esc 没把 ${ch} 转成 ${to}`);
    if (!jsEscArea.includes(`replace(/${ch}/g, "${to}")`)) problems.push(`JS esc 没把 ${ch} 转成 ${to}`);
  }
  return problems;
}

async function main() {
  /* ---------- 真 vault + 真配置，下面共用 ---------- */
  const SECRET = "bootstrap-secret";
  const boxToken = KEYS.issueRelayCredential(SECRET, "desktop-boot", "box");
  const clientToken = KEYS.issueRelayCredential(SECRET, "phone-boot", "client");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-boot-"));
  const file = path.join(tmp, "relay.json");
  const vault = createSecretVault(tmp, {
    vaultPath: path.join(tmp, "vault.json"),
    keyPath: path.join(tmp, "vault.key"),
  });
  const base = { file, vault, env: {}, interfaces: IFACES };
  const save = (patch) => SETTINGS.saveRelaySettings(Object.assign({}, base, { patch }));
  const build = () => SETTINGS.buildRelayBootstrap(base);
  const creds = { box_token: boxToken, client_token: clientToken };

  /* RBI-01 生成：形状对、四栏与配置逐字一致。 */
  {
    const r = save(Object.assign({ host: "relay.example.com", port: 18766, box_id: "boot-box", mode: "reverse" }, creds));
    const b = build();
    if (!r.ok) bad("RBI-01 前置保存失败", JSON.stringify(r && r.reason));
    else if (!b.ok) bad("RBI-01 配好了却生成失败", JSON.stringify([b.reason, b.audit && b.audit.code]));
    else if (!b.bootstrap.startsWith("bitbot-relay://v1?")) bad("RBI-01 前缀不是约定的协议", b.bootstrap.slice(0, 40));
    else {
      const p = mirrorParse(b.bootstrap);
      const wrong = [];
      if (p.host !== "relay.example.com") wrong.push("host=" + p.host);
      if (p.port !== 18766) wrong.push("port=" + p.port);
      if (p.boxId !== "boot-box") wrong.push("box=" + p.boxId);
      if (p.token !== clientToken) wrong.push("token 与配置里的 client_token 不一致");
      if (wrong.length) bad("RBI-01 生成的串还原不回原配置", wrong.join(" / "));
      else if (!b.summary || b.summary.includes(clientToken)) bad("RBI-01 summary 不该含 token", b.summary);
      else ok("RBI-01 生成的串 `bitbot-relay://v1?h&p&b&t` 还原回原配置（host/port/box/token 四栏全对）");
    }
  }

  /* RBI-02 **只带 client_token**：box 那把是「我可以冒充这台桌面」，绝不能出桌面。 */
  {
    const b = build();
    const src = readText(path.join(REPO, "hosts/shared/relay/relay_settings.js"));
    const fnStart = src.indexOf("function buildRelayBootstrap");
    const fnBody = fnStart >= 0 ? src.slice(fnStart, fnStart + 1400) : "";
    if (!b.ok) bad("RBI-02 前置生成失败", b.reason);
    else if (!clientToken || clientToken.length < 8) bad("RBI-02 前置：client_token 自身为空");
    else if (!b.bootstrap.includes(clientToken)) bad("RBI-02 生成的串里没有 client_token（手机拿什么认）");
    else if (boxToken && b.bootstrap.includes(boxToken)) bad("RBI-02 生成的串里出现了 box_token —— 等于把「冒充桌面」交出去");
    else if (!fnBody.includes("cfg.clientToken")) bad("RBI-02 生成器没读 clientToken（以后可能换成别的字段）");
    else if (/boxToken|box_token/.test(fnBody)) bad("RBI-02 生成器函数体里出现了 box token 的引用");
    else if (!b.contains_credential) bad("RBI-02 没标 contains_credential（界面就不会提醒「当密码对待」）");
    else ok("RBI-02 只带 client_token：box_token 不在串里（生成器函数体也不引用它）");
  }

  /* RBI-03 自检不过**不生成** —— 宁可让用户回同网配对，也不给一段连不上的串。
   *
   * 第一版这条写错了两处，记在这里免得下次又这么写：
   *  a) 我先调 saveRelaySettings 写 192.168.1.5，被 A3-16 的闸拦下 —— 于是文件里
   *     留下的还是上一次那份好配置，生成器**理所当然**吐出好串，门却判它红。
   *     门自己的错，不是产品的错。
   *  b) 更关键的是：被 save 拦住这件事已经由 HA-08 证过了。这一条要证的是**另一件事** ——
   *     用户机器上 192.168.1.5 是**历史残留**（A3-16 之前写进去的），它不会重新经过 save。
   *     所以这里直接改盘上的 relay.json，模拟「配置已经是坏的」，再问生成器：
   *     你会不会照着它生成一段手机永远连不上的串？
   */
  {
    const good = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, good.replace('"host": "relay.example.com"', '"host": "192.168.1.5"'));
    const b = build();
    fs.writeFileSync(file, good); // 复原，后面的用例继续用这份好配置
    if (b.ok) bad("RBI-03 盘上是死地址，生成器却照它生成了一段串", b.bootstrap.slice(0, 60));
    else if (b.bootstrap !== "") bad("RBI-03 拒绝了却回了一段串", b.bootstrap.slice(0, 60));
    else if (b.reason !== "host_private_other") bad("RBI-03 拒绝理由不是自检码", b.reason);
    else if (!b.audit || b.audit.reachableFromCellular !== false) bad("RBI-03 拒绝时没把「蜂窝不通」的结论带回给界面");
    else {
      const back = build();
      if (!back.ok) bad("RBI-03 复原好配置后仍生成不出串（这条门污染了状态）");
      else ok("RBI-03 反真空：盘上是历史残留的 192.168.1.5 → 拒绝生成（reason=host_private_other、串为空、audit 说蜂窝不通），换回好地址立刻能生成");
    }
  }

  /* RBI-04 没配中转就说没配，不编一段假的。 */
  {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-boot-empty-"));
    const b = SETTINGS.buildRelayBootstrap({
      file: path.join(tmp2, "relay.json"),
      vault: createSecretVault(tmp2, { vaultPath: path.join(tmp2, "v.json"), keyPath: path.join(tmp2, "v.key") }),
      env: {},
      interfaces: IFACES,
    });
    if (b.ok) bad("RBI-04 没配置却生成了配对串", b.bootstrap.slice(0, 60));
    else if (b.reason !== "not_configured") bad("RBI-04 理由不是 not_configured", b.reason);
    else if (b.bootstrap !== "") bad("RBI-04 失败时 bootstrap 不是空串");
    else ok("RBI-04 未配置 → not_configured，串为空（不编默认值）");
  }

  /* RBI-05 转义/还原：`&` `#` `%` 必须活着穿过 query。 */
  {
    // 用 dig 的 host 走不通（域名会被归一），改用带特殊字符的 box_id / token。
    const weirdBox = "box&a#b%c";
    const r = save(Object.assign({ host: "relay.example.com", port: 18766, box_id: weirdBox, mode: "reverse" }, creds));
    const b = build();
    if (!r.ok) bad("RBI-05 前置保存失败（box_id 里的 & # % 被拒？）", JSON.stringify(r.reason));
    else if (!b.ok) bad("RBI-05 生成失败", b.reason);
    else {
      const q = b.bootstrap.slice(b.bootstrap.indexOf("?") + 1);
      const rawAmp = q.split("&").length;
      const p = mirrorParse(b.bootstrap);
      if (p.boxId !== weirdBox) bad("RBI-05 box_id 转义后还原不回来", JSON.stringify([weirdBox, p.boxId]));
      // 4 栏 + box_id 里那个 & 被转义后不该额外多切一段
      else if (rawAmp !== 4) bad("RBI-05 未转义的分隔出现了（& 没被 %26 换掉）", "段数=" + rawAmp);
      else ok("RBI-05 `&`/`#`/`%` 转义后能还原，query 仍是干净的 4 段");
    }
  }

  /* RBI-06 两端线格式**逐字**对齐：改一边不改另一边，用户粘过去就是解析不出来。 */
  {
    const problems = measureWire(readText(KT_BOOT), readText(path.join(REPO, "hosts/shared/relay/relay_settings.js")));
    if (problems.length) bad("RBI-06 两端线格式没对齐", problems.slice(0, 5).join(" | "));
    else ok("RBI-06 两端逐字对齐：SCHEME 同一个字面量、键 h/p/b/t 两边都在、转义集都是 % & # 三个");
  }

  /* RBI-07 桌面接线：IPC + preload + 界面三处都得在，否则用户碰不到。 */
  {
    const mainSrc = readText(MAINJS);
    const preSrc = readText(PRELOAD);
    const htmlSrc = readText(HTML);
    const problems = [];
    if (!mainSrc.includes('ipcMain.handle("bitbot:relay:bootstrap"')) problems.push("main.js 没有 bitbot:relay:bootstrap handler");
    else {
      const i = mainSrc.indexOf('ipcMain.handle("bitbot:relay:bootstrap"');
      const body = mainSrc.slice(i, i + 700);
      if (!body.includes("relaySettingsMod.buildRelayBootstrap(")) problems.push("handler 没调 buildRelayBootstrap");
      if (!/reason:\s*"build_failed"/.test(body)) problems.push("生成抛异常时不回结构化失败（渲染端会拿到 undefined）");
    }
    if (!preSrc.includes('bootstrap: () => ipcRenderer.invoke("bitbot:relay:bootstrap")')) problems.push("preload 没暴露 relaySettings.bootstrap");
    if (!htmlSrc.includes('id="mc-relay-bootstrap"')) problems.push("界面没有「生成跨网配对串」按钮");
    if (!htmlSrc.includes('id="mc-relay-bootstrap-text"')) problems.push("界面没有可复制的输出框");
    if (!htmlSrc.includes('id="mc-relay-bootstrap-copy"')) problems.push("界面没有复制按钮");
    if (problems.length) bad("RBI-07 桌面这条路没接齐", problems.join(" | "));
    else ok("RBI-07 桌面接通：IPC handler → buildRelayBootstrap、preload 暴露、界面有按钮/输出框/复制");
  }

  /* RBI-08 手机接线：粘进来 → 解析 → redeem **走隧道**（不许又回到直连 IP）。 */
  {
    const sheets = readText(KT_SHEETS);
    const act = readText(KT_ACT);
    const pair = readText(KT_PAIR);
    const problems = [];
    if (!sheets.includes("bootstrapInput")) problems.push("PairingSheet 没有配对串输入");
    if (!sheets.includes("RelayBootstrap.parse(")) problems.push("PairingSheet 没解析配对串");
    if (!act.includes("RelayBootstrap.parse(")) problems.push("MainActivity 没解析配对串");
    if (!act.includes("completePairingViaRelay(")) problems.push("MainActivity 没走跨网配对（解析了却不用）");
    const fnStart = pair.indexOf("fun redeemCodeViaRelay(");
    const fnBody = fnStart >= 0 ? pair.slice(fnStart, fnStart + 2600) : "";
    if (!fnStart) problems.push("DesktopPairing 没有 redeemCodeViaRelay");
    else {
      if (!/RelayTunnel|openTunnel|TunnelHttp/.test(fnBody)) problems.push("redeemCodeViaRelay 没走隧道（那跨网还是不通）");
      if (/http:\/\/\$\{?/.test(fnBody)) problems.push("redeemCodeViaRelay 里还在拼 http:// 直连地址");
    }
    if (problems.length) bad("RBI-08 手机这条路没接齐", problems.join(" | "));
    else ok("RBI-08 手机接通：PairingSheet 收串 → parse → redeem 走 relay 隧道（不拼直连 IP）");
  }

  /* RBI-09 界面不泄凭证：describe 与提示语都不能把 token 摆出来。 */
  {
    const kt = readText(KT_BOOT);
    const htmlSrc = readText(HTML);
    const descStart = kt.indexOf("fun describe(");
    const descBody = descStart >= 0 ? kt.slice(descStart, descStart + 260) : "";
    const problems = [];
    if (!descBody) problems.push("RelayBootstrap 没有 describe");
    else if (/token/.test(descBody)) problems.push("describe 里出现了 token（屏幕上会看见凭证）");
    // 桌面提示语三语齐：整段串含凭证，要说「当密码对待」
    const notes = (htmlSrc.match(/mcRelayBootstrapNote:/g) || []).length;
    if (notes < 3) problems.push("桌面提示语不是三语齐（实际 " + notes + " 条）");
    if (!/当密码对待/.test(htmlSrc)) problems.push("桌面没写「当密码对待」");
    if (problems.length) bad("RBI-09 界面泄了凭证或提示语缺语种", problems.join(" | "));
    else ok("RBI-09 describe 不含 token、桌面提示语三语齐且写明「当密码对待」");
  }

  /* RBI-10 行为用例点名：Kotlin 侧真有 RB-01..RB-06（执行由 AB-21 在 JVM 结果里点）。 */
  {
    const t = readText(KT_TEST);
    const missing = [];
    for (let i = 1; i <= 6; i++) {
      const id = "RB-0" + i;
      if (!t.includes(id)) missing.push(id);
    }
    if (missing.length) bad("RBI-10 Kotlin 侧行为用例缺", missing.join(", "));
    else if (!t.includes("assertTrue") || !t.includes("assertEquals")) bad("RBI-10 RB 用例没有真正的断言");
    else ok("RBI-10 Kotlin 侧 RB-01..RB-06 六条行为用例都在（真执行由 AB-21 点名 JVM 结果）");
  }

  /* ---------- 负向对照：把关键改动从**副本**里摘掉，同一判据必须翻红 ---------- */
  {
    /* 对照 1（实跑，不是读字符串猜）：副本模块把 box_token 也拼进串里。
     * 为什么必须实跑：上一版门禁栽过「恒真对照」——把源码字符串替换掉，
     * 再检查副本里没有那个字符串，这种对照永远绿，比没有对照更糟。
     * 这里改的是副本文件、真的 require 它、真的跑一次生成，看串里有没有 box_token。 */
    const injPath = path.join(REPO, "hosts/shared/relay/.inj_relay_settings.js");
    const srcPath = path.join(REPO, "hosts/shared/relay/relay_settings.js");
    let injOk = false;
    try {
      const src = readText(srcPath).replace('"&t=" + esc(cfg.clientToken);', '"&t=" + esc(cfg.clientToken) + "&x=" + esc(cfg.boxToken);');
      if (src.includes('"&x=" + esc(cfg.boxToken)')) {
        fs.writeFileSync(injPath, src);
        delete require.cache[injPath];
        const INJ = require(injPath);
        // 副本用的是相对路径 require，模块内 ./relay_secrets 仍然解析到同一目录，可以真跑。
        const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-boot-inj-"));
        const f3 = path.join(tmp3, "relay.json");
        const v3 = createSecretVault(tmp3, { vaultPath: path.join(tmp3, "v.json"), keyPath: path.join(tmp3, "v.key") });
        const b3 = { file: f3, vault: v3, env: {}, interfaces: IFACES };
        INJ.saveRelaySettings(Object.assign({}, b3, {
          patch: Object.assign({ host: "relay.example.com", port: 18766, box_id: "inj-box", mode: "reverse" }, creds),
        }));
        const out = INJ.buildRelayBootstrap(b3);
        injOk = out.ok && out.bootstrap.includes(boxToken);
      }
    } catch (err) {
      injOk = false;
      bad("INJ-RBI_02 注入对照执行异常", String((err && err.message) || err));
    } finally {
      try { fs.rmSync(injPath, { force: true }); } catch {}
    }
    if (injOk) ok("INJ-RBI_02 注入对照有牙：副本里把 box_token 拼进串 → 真跑出来的串确实带上了它（判据会翻红）");
    else bad("INJ-RBI_02 注入对照失效：改了副本却没有把 box_token 带出来，这条判据是摆设");
  }

  {
    /* 负向对照 2（同一判据、真跑）：把手机端 SCHEME 改成 v2 / 把某个键删掉，
     * measureWire 必须报出问题。判据不红就说明 RBI-06 是装饰。 */
    const kt = readText(KT_BOOT);
    const jsSrc = readText(path.join(REPO, "hosts/shared/relay/relay_settings.js"));
    const m1 = measureWire(kt.replace('const val SCHEME = "bitbot-relay://v1"', 'const val SCHEME = "bitbot-relay://v2"'), jsSrc);
    const m2 = measureWire(kt.replace('map["b"]', 'map["box"]'), jsSrc);
    const m3 = measureWire(kt.replace('replace("#", "%23")', 'replace("#", "#")'), jsSrc);
    const misses = [];
    if (!m1.length) misses.push("改 SCHEME 没被发现");
    if (!m2.length) misses.push("改键名没被发现");
    if (!m3.length) misses.push("漏掉一个转义字符没被发现");
    if (misses.length) bad("INJ-RBI_06 注入对照失效", misses.join("；") + " —— 这条断言是摆设");
    else ok("INJ-RBI_06 注入对照有牙：改 SCHEME（v1→v2）、改键名（b→box）、去掉 # 转义，三种走偏 measureWire 全抓到");
  }

  console.log("\nprove_relay_bootstrap: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("prove_relay_bootstrap: 异常 —", (err && err.stack) || err);
  process.exit(1);
});
