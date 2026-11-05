#!/usr/bin/env node
"use strict";
/* prove_relay_settings.js — A3-14 门禁（RS2-01..RS2-11）
 *
 * 要证的一件事：**桌面有地方能配中转，而且配的时候不把明文凭证交给渲染端**。
 *
 * 两层证据（A3-7 的教训，缺一不可）：
 *  ① 运行时：真模块 + 真 vault + 真临时文件，跑保存/沿用/拒绝/关闭（RS2-01..RS2-08）；
 *  ② 静态 join：HTML 有表单、preload 暴露通道、main.js 有 handler 且保存后真的重新登记
 *     （RS2-09..RS2-11）—— 模块自己绿 ≠ 产品会用。
 *
 * 反真空：RS2-01（未配置时确实回 configured:false，不是「什么都回 false」）、
 * RS2-03（保存后读回的字段与掩码正确）、RS2-04（留空 token 真的沿用了原值）。
 *
 * 跑法：node scripts/prove_relay_settings.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SETTINGS = require(path.join(REPO, "hosts/shared/relay/relay_settings.js"));
const SECRETS = require(path.join(REPO, "hosts/shared/relay/relay_secrets.js"));
const KEYS = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));
const { createSecretVault } = require(path.join(REPO, "hosts/desktop/secret_vault.js"));
const MAINJS = path.join(REPO, "hosts/desktop/main.js");
const PRELOAD = path.join(REPO, "hosts/desktop/preload.js");
const HTML = path.join(REPO, "hosts/desktop/index.html");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

async function main() {
  const SECRET = "settings-secret";
  const boxToken = KEYS.issueRelayCredential(SECRET, "desktop-ui", "box");
  const clientToken = KEYS.issueRelayCredential(SECRET, "phone-ui", "client");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-settings-"));
  const file = path.join(tmp, "relay.json");
  const vault = createSecretVault(tmp, {
    vaultPath: path.join(tmp, "vault.json"),
    keyPath: path.join(tmp, "vault.key"),
  });
  const base = { file, vault, env: {} };
  const read = () => SETTINGS.readRelaySettings(base);
  const save = (patch) => SETTINGS.saveRelaySettings(Object.assign({}, base, { patch }));
  const full = {
    host: "relay.example.com", port: 18766, box_id: "box-ui",
    box_token: boxToken, client_token: clientToken, mode: "reverse",
  };

  /* RS2-01 反真空正控：未配置时视图是「没配」，且不含任何凭证明文。 */
  {
    const v = read();
    const text = JSON.stringify(v);
    if (v.configured !== false) bad("RS2-01 没配置却说配好了", JSON.stringify(v));
    else if (text.includes(boxToken) || text.includes(clientToken)) bad("RS2-01 视图里出现明文凭证");
    else if (v.value_echoed !== false) bad("RS2-01 视图没声明 value_echoed:false");
    else ok("RS2-01 正控：未配置 → configured=false、零明文、value_echoed=false");
  }

  /* RS2-02 保存：生成安全格式，明文不落盘、0600。 */
  {
    const r = save(full);
    const text = fs.readFileSync(file, "utf8");
    const mode = fs.statSync(file).mode & 0o777;
    if (!r.ok) bad("RS2-02 保存失败", JSON.stringify(r));
    else if (text.includes(boxToken) || text.includes(clientToken)) bad("RS2-02 relay.json 里出现明文");
    else if (mode !== 0o600) bad("RS2-02 文件权限不是 0600", mode.toString(8));
    else ok("RS2-02 保存 → 安全格式（只留 *_token_ref）、查无明文、mode=0600");
  }

  /* RS2-03 读回视图：字段齐、掩码正确、绝不回明文。 */
  {
    const v = read();
    const text = JSON.stringify(v);
    if (!v.configured || v.host !== full.host || v.port !== full.port || v.boxId !== full.box_id || v.mode !== "reverse") {
      bad("RS2-03 读回的字段不对", JSON.stringify(v));
    } else if (v.boxTokenMask !== SETTINGS.mask(boxToken) || v.clientTokenMask !== SETTINGS.mask(clientToken)) {
      bad("RS2-03 掩码不对", JSON.stringify(v));
    } else if (text.includes(boxToken) || text.includes(clientToken)) {
      bad("RS2-03 视图里夹带了明文凭证（渲染端绝不该拿到）");
    } else {
      ok("RS2-03 读回视图字段齐、掩码正确、查无明文（渲染端只拿到 ****后四位）");
    }
  }

  /* RS2-04 只改地址、token 留空 → 沿用原值（不用每次重贴两把钥匙）。 */
  {
    const r = save({ host: "relay2.example.com", port: 18766, box_id: "box-ui", mode: "dial" });
    const cfg = SECRETS.loadRelayConfigSecure(base);
    if (!r.ok) bad("RS2-04 留空 token 再保存被拒了", JSON.stringify(r));
    else if (!cfg || cfg.boxToken !== boxToken || cfg.clientToken !== clientToken) {
      bad("RS2-04 token 没沿用（被清空或编了新值）", cfg && cfg.boxToken);
    } else if (cfg.host !== "relay2.example.com" || cfg.mode !== "dial") {
      bad("RS2-04 新字段没生效", JSON.stringify(cfg));
    } else {
      ok("RS2-04 只改地址/模式、token 留空 → 沿用原凭证且新字段生效");
    }
  }

  /* RS2-05 首次配置缺 token → 明确拒绝，不编默认凭证。 */
  {
    fs.writeFileSync(file, JSON.stringify({ enabled: false })); // 回到未配置
    const r = save({ host: "x.example.com", port: 18766, box_id: "box-ui", mode: "reverse" });
    if (r.ok || r.reason !== "missing_token") {
      bad("RS2-05 首次缺 token 竟然保存成功（会编一个假凭证）", JSON.stringify(r));
    } else {
      ok("RS2-05 首次配置缺 token → 明确 reason=missing_token，不编默认凭证");
    }
  }

  /* RS2-06 非法字段一律拒绝。 */
  {
    const cases = [
      [{ host: "", port: 18766, box_id: "b", mode: "reverse", box_token: boxToken, client_token: clientToken }, "missing_host"],
      [{ host: "x", port: 70000, box_id: "b", mode: "reverse", box_token: boxToken, client_token: clientToken }, "bad_port"],
      [{ host: "x", port: 18766, box_id: "", mode: "reverse", box_token: boxToken, client_token: clientToken }, "missing_box_id"],
    ];
    const got = cases.map(([p]) => save(p).reason);
    if (got.join(",") !== cases.map(([, r]) => r).join(",")) {
      bad("RS2-06 非法字段没被逐条挡住", got.join(","));
    } else if (fs.readFileSync(file, "utf8").includes("x.example.com")) {
      bad("RS2-06 非法保存把文件改坏了");
    } else {
      ok("RS2-06 空 host / 越界 port / 空 box_id 各自被拒，文件未被改坏");
    }
  }

  /* RS2-07 关闭中转：写 enabled:false，视图回到未配置，文件不删。 */
  {
    save(full);
    const r = SETTINGS.disableRelaySettings(base);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!r.ok || raw.enabled !== false) {
      bad("RS2-07 关闭中转失败", JSON.stringify({ r, raw }));
    } else if (r.view.configured !== false || read().configured !== false) {
      bad("RS2-07 关掉之后视图还说配好了");
    } else {
      ok("RS2-07 关闭中转 → enabled:false、视图 configured=false，文件保留可改回");
    }
  }

  /* RS2-08 半套 / 坏 JSON 不撒谎。 */
  {
    fs.writeFileSync(file, JSON.stringify({ host: "x" }));
    const half = read();
    fs.writeFileSync(file, "{ bad json");
    const broken = read();
    if (half.configured || broken.configured) {
      bad("RS2-08 半套/坏 JSON 被说成配好了", JSON.stringify({ half, broken }));
    } else {
      ok("RS2-08 半套与坏 JSON 一律 configured=false（沿用 A3-7 口径）");
    }
  }

  /* RS2-09 静态 join：preload + main.js。 */
  {
    const pre = fs.readFileSync(PRELOAD, "utf8");
    const main = fs.readFileSync(MAINJS, "utf8");
    // 只切 save handler 这一段：disable handler 里也有一行同样的重登记调用，
    // 用 main.includes() 全文搜会被它撑绿（A3-7 RB-09 踩过的同型坑）。
    const s0 = main.indexOf('ipcMain.handle("bitbot:relay:settings:save"');
    const s1 = s0 >= 0 ? main.indexOf('ipcMain.handle("', s0 + 10) : -1;
    const saveBlock = s0 >= 0 && s1 > s0 ? main.slice(s0, s1) : "";
    const anchors = [
      [pre, "relaySettings: {", "preload 没暴露 relaySettings"],
      [pre, '"bitbot:relay:settings:get"', "preload 缺 get 通道"],
      [pre, '"bitbot:relay:settings:save"', "preload 缺 save 通道"],
      [pre, '"bitbot:relay:settings:disable"', "preload 缺 disable 通道"],
      [main, 'require("./shared/relay/relay_settings")', "main.js 没 require 设置模块"],
      [main, 'ipcMain.handle("bitbot:relay:settings:get"', "main.js 缺 get handler"],
      [main, 'ipcMain.handle("bitbot:relay:settings:save"', "main.js 缺 save handler"],
      [main, 'ipcMain.handle("bitbot:relay:settings:disable"', "main.js 缺 disable handler"],
      [main, "relaySettingsMod.saveRelaySettings(", "save handler 没接设置模块"],
      [saveBlock, "syncRelayBoxRegistration(relayConfigWatchStatus)", "保存后没有主动重新登记"],
    ];
    const missing = anchors.filter(([s, n]) => !s.includes(n)).map(([, , why]) => why);
    if (missing.length) bad("RS2-09 桌面接线缺了 " + missing.length + " 处：" + missing.join("；"));
    else ok("RS2-09 十处接线都在：preload 三通道 / main.js 三 handler / 调模块 / 保存后重登记");
  }

  /* RS2-10 静态 join：HTML 表单 + 三语 + 明文零回填。 */
  {
    const html = fs.readFileSync(HTML, "utf8");
    const ids = ["mc-relay-card", "mc-relay-host", "mc-relay-port", "mc-relay-box",
                 "mc-relay-mode", "mc-relay-box-token", "mc-relay-client-token",
                 "mc-relay-save", "mc-relay-disable", "mc-relay-status"];
    const missingIds = ids.filter((id) => !html.includes('id="' + id + '"'));
    const pw = /id="mc-relay-box-token"[^>]*type="password"/.test(html) &&
               /id="mc-relay-client-token"[^>]*type="password"/.test(html);
    const i18n = ["mcRelayTitle", "mcRelayNote", "mcRelayHost", "mcRelayPort",
                  "mcRelayBoxId", "mcRelayMode", "mcRelayBoxToken", "mcRelayClientToken",
                  "mcRelaySave", "mcRelayDisable", "mcRelayEmpty", "mcRelaySaved", "mcRelayKeep"];
    const missingI18n = i18n.filter((k) => (html.match(new RegExp('\\b' + k + '\\s*:', "g")) || []).length < 3);
    const wired = html.includes("window.bitbot.relaySettings.get()") &&
                  html.includes("window.bitbot.relaySettings.save(");
    if (missingIds.length) {
      bad("RS2-10 HTML 缺元素：" + missingIds.join(","));
    } else if (!pw) {
      bad("RS2-10 两个凭证输入框不是 type=password");
    } else if (missingI18n.length) {
      bad("RS2-10 三语词条不齐（每语都要有）：" + missingI18n.join(","));
    } else if (!wired) {
      bad("RS2-10 HTML 没接 window.bitbot.relaySettings");
    } else if (/id="mc-relay-box-token"[^>]*value=/.test(html) || /id="mc-relay-client-token"[^>]*value=/.test(html)) {
      bad("RS2-10 凭证输入框预填了值（明文回填到 DOM）");
    } else {
      ok("RS2-10 表单元素齐、密码框、13 个三语词条、接了 IPC，且不预填凭证");
    }
  }

  /* RS2-11 既有锚点一字未动（连改三个文件最怕连坐）。 */
  {
    const main = fs.readFileSync(MAINJS, "utf8");
    const q0 = main.indexOf('app.on("before-quit"');
    const q1 = main.indexOf('app.on("will-quit"');
    const quitBlock = q0 >= 0 && q1 > q0 ? main.slice(q0, q1) : "";
    // A3-16：回执四栏改成「先拿 cfg → 地址自检 → 过了才 toHandoff」，
    // 原来那条整行锚点必然失配。约束保留，锚点改形状。
    const hs = main.indexOf("function currentRelayHandoff");
    const handoffBody = hs >= 0 ? main.slice(hs, hs + 1600) : "";
    const anchors = [
      [main, "relayHandoff: () => currentRelayHandoff(),", "RB-09"],
      [main, "const started = await cnInbound.start();", "RB-09"],
      [main, "syncRelayBoxRegistration(started)", "RB-09"],
      [main, "load: () => loadCurrentRelayConfig(),", "RH-10"],
      [handoffBody, "relayConfigMod.toHandoff(", "RS-09"],
      [quitBlock, "relayBox.stop()", "RB-09 quit"],
      [quitBlock, "stopRelayConfigWatch();", "RH-10 quit"],
    ];
    const missing = anchors.filter(([s, n]) => !s.includes(n)).map(([, , why]) => why);
    if (missing.length) bad("RS2-11 既有锚点被撞掉：" + missing.join("；"));
    else ok("RS2-11 RB-09 / RH-10 / RS-09 的七处既有锚点一字未动");
  }

  /* RS2-12 新增的 UI JS 真的能编译 —— 静态锚点只证「代码在」，
   * 写错一行 JS 整个面板就哑了，这种坏法 RS2-10 的那些 includes 抓不到。 */
  {
    const html = fs.readFileSync(HTML, "utf8");
    const start = html.indexOf("(function initRelaySettings()");
    const end = start >= 0 ? html.indexOf("})();", start) : -1;
    let err = "";
    if (start < 0 || end < 0) {
      err = "找不到 initRelaySettings 片段";
    } else {
      try {
        // 只编译不执行：语法错会在这里抛，浏览器专有 API 不会真的被调用。
        new Function(html.slice(start, end + 5));
      } catch (e) {
        err = String((e && e.message) || e);
      }
    }
    if (err) bad("RS2-12 新增的 UI JS 编译不过", err);
    else ok("RS2-12 新增的 UI JS 片段语法可编译（静态锚点之外的一层实证）");
  }

  /* RS2-13 IA 边界：MC-02（e2e_desktop_mobile_control）硬要求「移动端远程控制」
   * 弹窗里零令牌控件 —— 6 位配对码才是主路。这一片把中转表单移到独立弹窗
   * 就是为了守住它，本门也自己钉一次，免得以后搬回去只有另一个门会红。 */
  {
    const html = fs.readFileSync(HTML, "utf8");
    const m0 = html.indexOf('<div id="mobile-control-modal"');
    const m1 = html.indexOf('<div id="relay-settings-modal"', m0);
    const mainModal = m0 >= 0 && m1 > m0 ? html.slice(m0, m1) : "";
    const relayModal = m1 >= 0 ? html.slice(m1, html.indexOf('<div id="agent-info-panel"', m1)) : "";
    if (!mainModal || !relayModal) {
      bad("RS2-13 前置失败：两个弹窗切不出来", JSON.stringify({ m0, m1 }));
    } else if (/id="[^"]*token[^"]*"/i.test(mainModal)) {
      bad("RS2-13 令牌控件回到了手机配对弹窗（MC-02 会红）");
    } else if (!relayModal.includes('id="mc-relay-box-token"') || !relayModal.includes('id="mc-relay-client-token"')) {
      bad("RS2-13 独立弹窗里找不到两把凭证框");
    } else if (!mainModal.includes('id="mc-relay-open"')) {
      bad("RS2-13 配对弹窗里没有中转设置入口");
    } else {
      ok("RS2-13 IA 边界：配对弹窗零令牌控件、只有一个入口；凭证框全在独立弹窗里");
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("prove_relay_settings: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => {
  console.log("  ✗ 门禁自身异常：" + ((e && e.stack) || e));
  console.log("prove_relay_settings: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(1);
});
