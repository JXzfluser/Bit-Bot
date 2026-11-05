#!/usr/bin/env node
"use strict";
/* prove_relay_host_audit.js — A3-16 门禁（HA-01..HA-13）
 *
 * 要证的一件事：**桌面上那个「中转地址」，产品自己知道手机敲不敲得到，
 * 而且敲不到时既不写进配置、也不下发给手机。**
 *
 * 现场来由：用户看到界面上出现两个对不上的 IP —— 配对那行是网卡现算的
 * 局域网地址（10.201.107.104:18765），中转那行是 relay.json 里手填的
 * 192.168.1.5:18766。后者既不在本机任何网段上、也不是公网，但 A3-14 的
 * 设置面只校验「非空 + 端口范围」，于是它被当成合法配置写进文件、再随配对
 * 回执下发给手机 —— 手机照着连，连不上，桌面还亮绿灯。
 *
 * 三层证据（缺一不可）：
 *  ① 纯函数：分类与判定（HA-01..HA-06）；
 *  ② 运行时：真模块 + 真 vault + 真文件，读要带 audit、写在 reverse 下要拒
 *     私网、在 dial 下要放行（HA-07..HA-10）；
 *  ③ 静态 join：main.js 真的拿它来决定「下不下发」、HTML 真的有那一行、
 *     三语词条齐（HA-11..HA-13）—— 模块自己绿 ≠ 产品会用。
 *
 * 反真空：HA-05（公网域名是 warn 不是 error，证明不是「全都判 error」）、
 * HA-09（dial 模式私网地址放行，证明不是「全都拒」）。
 *
 * 跑法：node scripts/prove_relay_host_audit.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const AUDIT = require(path.join(REPO, "hosts/shared/relay/relay_host_audit.js"));
const SETTINGS = require(path.join(REPO, "hosts/shared/relay/relay_settings.js"));
const KEYS = require(path.join(REPO, "hosts/shared/relay/relay_keys.js"));
const { createSecretVault } = require(path.join(REPO, "hosts/desktop/secret_vault.js"));
const MAINJS = path.join(REPO, "hosts/desktop/main.js");
const HTML = path.join(REPO, "hosts/desktop/index.html");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

/** 固定的假网卡表：这台桌面有 10.201.107.104 与 192.168.139.3，没有 192.168.1.5。 */
const IFACES = {
  en0: [{ address: "10.201.107.104", family: "IPv4", internal: false }],
  en5: [{ address: "192.168.139.3", family: "IPv4", internal: false }],
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
};

async function main() {
  /* HA-01 分类：每种地址都认得出自己是什么。 */
  {
    const cases = [
      ["127.0.0.1", "loopback"],
      ["0.0.0.0", "loopback"],
      ["::1", "loopback"],
      ["169.254.7.7", "link_local"],
      ["10.0.0.2", "private"],
      ["172.16.4.1", "private"],
      ["172.32.4.1", "public"], // 172.32 不在 172.16/12 里，别把私网判宽
      ["192.168.1.5", "private"],
      ["100.64.3.9", "cgnat"],
      ["14.155.111.69", "public"],
      ["relay.example.com", "hostname"],
      ["mybox.local", "mdns"],
      ["", "empty"],
    ];
    const wrong = cases.filter(([h, want]) => AUDIT.classifyHost(h).kind !== want);
    if (wrong.length) bad("HA-01 地址分类有错", JSON.stringify(wrong));
    else ok("HA-01 " + cases.length + " 种地址全部分类正确（含 172.32 不算私网）");
  }

  /* HA-02 归一：用户贴 URL / 带端口 / 带方括号 也能收拾成裸 host。 */
  {
    const cases = [
      ["http://192.168.1.5:18766/x?y=1", "192.168.1.5"],
      ["https://relay.example.com", "relay.example.com"],
      ["Relay.Example.COM.", "relay.example.com"],
      ["[::1]:18766", "::1"],
      ["10.1.2.3:9999", "10.1.2.3"],
    ];
    const wrong = cases.filter(([inp, want]) => AUDIT.normalizeHost(inp) !== want);
    if (wrong.length) bad("HA-02 host 归一有错", JSON.stringify(wrong));
    else ok("HA-02 " + cases.length + " 种写法（URL/端口/方括号/大写/尾点）都归一正确");
  }

  /* HA-03 本机私网：如实说「这是局域网地址，蜂窝下不通」。 */
  {
    const v = AUDIT.auditRelayHost({ host: "10.201.107.104", port: 18766, mode: "reverse", interfaces: IFACES });
    if (v.code !== "host_private_local") bad("HA-03 本机网卡地址没被判成 host_private_local", v.code);
    else if (v.level !== "error") bad("HA-03 本机私网地址的 severity 应是 error", v.level);
    else if (v.reachableFromCellular !== false) bad("HA-03 不该说蜂窝下能连");
    else if (v.isLocalInterface !== true) bad("HA-03 没认出这是本机网卡", v.isLocalInterface);
    else ok("HA-03 本机网卡私网地址 → host_private_local / error / 蜂窝不通 / 认出本机网卡");
  }

  /* HA-04 **用户踩的那个值**：私网但不在本机任何网段 —— 必须与 HA-03 区分开。 */
  {
    const v = AUDIT.auditRelayHost({ host: "192.168.1.5", port: 18766, mode: "reverse", interfaces: IFACES });
    if (v.code !== "host_private_other") bad("HA-04 192.168.1.5 没被判成 host_private_other", v.code);
    else if (v.isLocalInterface !== false) bad("HA-04 把 192.168.1.5 认成了本机网卡");
    else if (v.reachableFromCellular !== false) bad("HA-04 不该说蜂窝下能连");
    else ok("HA-04 不在本机网段的私网地址（现场 192.168.1.5）→ host_private_other / 非本机网卡");
  }

  /* HA-05 反真空：公网域名是 warn 不是 error，证明不是「一律判死」。 */
  {
    const d = AUDIT.auditRelayHost({ host: "relay.example.com", port: 18766, mode: "reverse", interfaces: IFACES });
    const own = AUDIT.auditRelayHost({ host: "14.155.111.69", port: 18766, mode: "reverse", interfaces: IFACES });
    if (d.level !== "warn" || d.code !== "host_hostname") bad("HA-05 公网域名判定不对", JSON.stringify([d.level, d.code]));
    else if (d.reachableFromCellular !== true) bad("HA-05 公网域名应视为蜂窝可达");
    else if (own.level !== "warn" || own.code !== "host_own_public_ip") bad("HA-05 本机公网出口 IP 判定不对", JSON.stringify([own.level, own.code]));
    else ok("HA-05 反真空：公网域名 → warn/hostname、本机公网出口 IP → warn/own_public，都没被判死");
  }

  /* HA-06 准入策略：只有 reverse + error 才拒；dial 同网部署放行。 */
  {
    const mk = (host, mode) => AUDIT.auditRelayHost({ host, port: 18766, mode, interfaces: IFACES });
    const rows = [
      [mk("192.168.1.5", "reverse"), true, "reverse+私网必须拒"],
      [mk("127.0.0.1", "reverse"), true, "reverse+回环必须拒"],
      [mk("192.168.1.5", "dial"), false, "dial+私网应放行（同网部署）"],
      [mk("relay.example.com", "reverse"), false, "reverse+公网域名应放行"],
      [mk("14.155.111.69", "reverse"), false, "reverse+本机公网 IP 只 warn，不该拒"],
    ];
    const wrong = rows.filter(([v, want]) => AUDIT.shouldRejectSave(v) !== want).map((r) => r[2]);
    if (wrong.length) bad("HA-06 准入策略有错", JSON.stringify(wrong));
    else ok("HA-06 准入策略 5 例：只有 reverse+error 拒；dial+私网、公网 warn 都放行");
  }

  /* 真 vault + 真文件，下面的运行时用例共用。 */
  const SECRET = "audit-secret";
  const boxToken = KEYS.issueRelayCredential(SECRET, "desktop-audit", "box");
  const clientToken = KEYS.issueRelayCredential(SECRET, "phone-audit", "client");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-host-audit-"));
  const file = path.join(tmp, "relay.json");
  const vault = createSecretVault(tmp, {
    vaultPath: path.join(tmp, "vault.json"),
    keyPath: path.join(tmp, "vault.key"),
  });
  const base = { file, vault, env: {}, interfaces: IFACES };
  const read = () => SETTINGS.readRelaySettings(base);
  const save = (patch) => SETTINGS.saveRelaySettings(Object.assign({}, base, { patch }));
  const creds = { box_token: boxToken, client_token: clientToken };

  /* HA-07 读要带 audit：配置了就能说出「这个地址谁能敲到」，不能只是沉默。 */
  {
    const r = save(Object.assign({ host: "relay.example.com", port: 18766, box_id: "audit-box", mode: "reverse" }, creds));
    const v = read();
    if (!r.ok) bad("HA-07 前置保存失败", JSON.stringify(r));
    else if (!v.audit || typeof v.audit !== "object") bad("HA-07 readRelaySettings 没带 audit");
    else if (v.audit.code !== "host_hostname") bad("HA-07 audit 没跟着实际 host 走", JSON.stringify(v.audit));
    else if (v.audit.host !== "relay.example.com") bad("HA-07 audit.host 不是归一后的值", v.audit.host);
    else ok("HA-07 读视图带 audit，且审计的是归一后的真实 host");
  }

  /* HA-08 写要拦：reverse 下私网 host 必须拒，且**文件一个字节都没动**。 */
  {
    const before = fs.readFileSync(file, "utf8");
    const r = save({ host: "192.168.1.5", port: 18766, box_id: "audit-box", mode: "reverse" });
    const after = fs.readFileSync(file, "utf8");
    if (r.ok) bad("HA-08 私网 host 在 reverse 下居然保存成功");
    else if (r.reason !== "host_private_other") bad("HA-08 拒绝理由不是自检码", r.reason);
    else if (!r.audit || r.audit.code !== "host_private_other") bad("HA-08 拒绝时没把 audit 一起带回给界面");
    else if (before !== after) bad("HA-08 被拒了却把文件改了");
    else ok("HA-08 reverse + 私网 host 被拒（reason 即自检码），文件零改动");
  }

  /* HA-09 反真空：dial 模式同一个私网地址必须能存 —— 同网部署就是合法的。 */
  {
    const r = save({ host: "192.168.1.5", port: 18766, box_id: "audit-box", mode: "dial" });
    const v = read();
    if (!r.ok) bad("HA-09 dial 模式下私网地址被误拒", JSON.stringify(r));
    else if (v.host !== "192.168.1.5" || v.mode !== "dial") bad("HA-09 存进去的值不对", JSON.stringify([v.host, v.mode]));
    else if (!v.audit || v.audit.reachableFromCellular !== false) bad("HA-09 dial 放行了但 audit 应该仍说蜂窝不通");
    else ok("HA-09 反真空：dial + 私网放行，但 audit 仍如实标注「蜂窝不通」");
  }

  /* HA-10 静态 join：main.js 真的用它决定「下不下发」，不是只 require 了模块。 */
  {
    const src = fs.readFileSync(MAINJS, "utf8");
    const start = src.indexOf("function currentRelayHandoff");
    const slice = start >= 0 ? src.slice(start, start + 1600) : "";
    // 反面教材 ×2：先只搜 `return null;`，命中了 catch 兜底那行；
    // 再换 `[\s\S]{0,500}?return null;` 贪心，又跨过 if 的右花括号吃到了兜底那行。
    // 所以这里改成**按花括号位置切出 if 块区间**，只在这个区间里找 return null。
    const MARK = "shouldRejectSave(verdict)) {";
    const anchor = slice.indexOf(MARK);
    let seg = "";
    if (anchor >= 0) {
      const segStart = anchor + MARK.length;
      const segEnd = slice.indexOf("\n    }", segStart); // 该 if 块的收尾（外层缩进 4 空格）
      seg = segEnd > segStart ? slice.slice(segStart, segEnd) : "";
    }
    if (!slice) bad("HA-10 main.js 里找不到 currentRelayHandoff");
    else if (!/relayHostAudit\.auditRelayHost\(/.test(slice)) bad("HA-10 currentRelayHandoff 没做地址自检");
    else if (anchor < 0) bad("HA-10 currentRelayHandoff 没用准入策略");
    else if (!seg.includes("return null;")) bad("HA-10 自检不过的 if 块里没有 return null（等于照样下发死地址）");
    else if (!/require\("\.\.?\/shared\/relay\/relay_host_audit"\)/.test(src)) bad("HA-10 main.js 没接 relay_host_audit 模块");
    else ok("HA-10 静态 join：currentRelayHandoff 的拒绝分支里 return null（不下发死地址）");
  }

  /* HA-11 静态 join：界面上真有那一行，且 render 用的是词条表不是裸码。 */
  {
    const src = fs.readFileSync(HTML, "utf8");
    if (!src.includes('id="mc-relay-audit"')) bad("HA-11 界面没有 #mc-relay-audit 这一行");
    else if (!/const MC_AUDIT_KEY = \{/.test(src)) bad("HA-11 没有码→词条映射表");
    else if (!/MC_AUDIT_KEY\[a\.code\]/.test(src)) bad("HA-11 render 没把 audit.code 翻成词条");
    else if (!/dot\.dataset\.state = !v\.configured \? "off"/.test(src)) bad("HA-11 灯没有跟随自检结果（配了不等于能用）");
    else ok("HA-11 静态 join：界面有审计行、有码→词条表、灯跟随自检结果");
  }

  /* HA-12 三语词条齐：10 个码 × 3 种语言，一个都不能靠 fallback 混过去。 */
  {
    const src = fs.readFileSync(HTML, "utf8");
    const keys = ["mcRelayAuditMissing", "mcRelayAuditLoopback", "mcRelayAuditLinkLocal",
      "mcRelayAuditPrivateLocal", "mcRelayAuditPrivateOther", "mcRelayAuditCgnat",
      "mcRelayAuditMdns", "mcRelayAuditOwnPublic", "mcRelayAuditPublic", "mcRelayAuditHostname",
      "mcRelayHandoffHeld"];
    const missing = [];
    keys.forEach((k) => {
      const n = (src.match(new RegExp("\\b" + k + ":", "g")) || []).length;
      if (n < 3) missing.push(k + "×" + n);
    });
    if (missing.length) bad("HA-12 三语词条不全", JSON.stringify(missing));
    else ok("HA-12 " + keys.length + " 个自检词条 × 3 种语言全齐");
  }

  /* HA-13 自检文案不许泄露凭证：纯函数输出里不该出现任何 token 字段。 */
  {
    const v = AUDIT.auditRelayHost({ host: "relay.example.com", port: 18766, mode: "reverse", interfaces: IFACES });
    const text = JSON.stringify(v);
    if (/token/i.test(text)) bad("HA-13 audit 输出里出现了 token 字样");
    else ok("HA-13 audit 输出是纯地址判定，不含任何凭证字段");
  }

  /* HA-14 配对那行也要如实：它显示的是局域网地址，不能写成「手机可以连进来了」。 */
  {
    const src = fs.readFileSync(HTML, "utf8");
    const hits = src.match(/pairingLanOn: "[^"]*"/g) || [];
    if (hits.length < 3) bad("HA-14 pairingLanOn 词条不足 3 条", String(hits.length));
    else if (hits.some((h) => !/Wi-Fi/.test(h))) bad("HA-14 有语言版本没说清「仅同一 Wi-Fi」", JSON.stringify(hits));
    else ok("HA-14 配对地址那行三语都标明「仅同一 Wi-Fi」，不再让用户以为跨网也能连");
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("");
  console.log("prove_relay_host_audit: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SETUP-FAIL: " + ((e && e.stack) || e));
  process.exit(2);
});
