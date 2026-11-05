#!/usr/bin/env node
"use strict";
/* prove_public_entry.js — A3-17/18/19 门禁（PE-01..PE-12）
 *
 * 要证的一件事：**「公网入口」这一层可以自动探测、自动开洞，而且失败时
 * 说的是真话 —— 不编造 IP、不把异常当结果、不碰显式指定的 --host。**
 *
 * 三层证据：
 *  ① 纯函数 / 注入：探测、XML 解析、SOAP 错误码（PE-01..PE-07）；
 *  ② 静态 join：setup 真的有 --auto 分支、仍然拒绝私网、--no-upnp 生效
 *     （PE-08、PE-09、PE-12）；
 *  ③ 进程级：三个脚本 node --check、--help 不联网退出 0（PE-10、PE-11）。
 *
 * 门禁本身完全离线：所有探测/SSDP/SOAP 都走注入替身，不真发一个包。
 *
 * 跑法：node scripts/prove_public_entry.js
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const DETECT_PATH = path.join(REPO, "scripts/detect_public_ip.js");
const UPNP_PATH = path.join(REPO, "scripts/upnp_map.js");
const SETUP_PATH = path.join(REPO, "scripts/setup_public_relay.js");

const DETECT = require(DETECT_PATH);
const UPNP = require(UPNP_PATH);
const SETUP = require(SETUP_PATH);

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

/** 固定假网卡表：这台机器有 10.201.107.104 / 192.168.139.3，出口 IP 不在里面。 */
const IFACES = {
  en0: [{ address: "10.201.107.104", family: "IPv4", internal: false }],
  en5: [{ address: "192.168.139.3", family: "IPv4", internal: false }],
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
};
/** 反例用：出口 IP 真的落在网卡上（公网直连 / 桥接）。 */
const IFACES_WITH_EXIT = {
  en0: [{ address: "203.0.113.9", family: "IPv4", internal: false }],
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
};

const S1 = "https://source-one.test/ip";
const S2 = "https://source-two.test/ip";
const S3 = "https://source-three.test/ip";

/** 两服务块：WANPPP 在前、WANIP 在后 —— 必须优先 WANIP。 */
const IGD_XML = [
  '<?xml version="1.0"?>',
  "<root><device><serviceList>",
  "<service><serviceType>urn:schemas-upnp-org:service:WANPPPConnection:1</serviceType>",
  "<controlURL>/upnp/control/WANPPPConnection1</controlURL></service>",
  "<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>",
  "<controlURL>/upnp/control/WANIPConnection1</controlURL></service>",
  "</serviceList></device></root>",
].join("");

/** 带名字空间前缀的变体。 */
const IGD_XML_PREFIXED = [
  '<root xmlns:u="urn:schemas-upnp-org:device-1-0"><device><serviceList>',
  "<service><u:serviceType>urn:schemas-upnp-org:service:WANPPPConnection:1</u:serviceType>",
  "<u:controlURL>/upnp/control/WANPPPConnection1</u:controlURL></service>",
  "</serviceList></device></root>",
].join("");

const SOAP_FAULT_718 = [
  '<?xml version="1.0"?>',
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">',
  "<s:Body><s:Fault><faultcode>s:Client</faultcode><detail><UPnPError>",
  "<errorCode>718</errorCode><errorDescription>ConflictInMappingEntry</errorDescription>",
  "</UPnPError></detail></s:Fault></s:Body></s:Envelope>",
].join("");

async function main() {
  /* PE-01 多源：第一个失败 → 第二个成功，source 必须是第二个。 */
  {
    const calls = [];
    const fake = async (url) => {
      calls.push(url);
      if (url === S1) throw new Error("connect ECONNREFUSED");
      if (url === S2) return { ok: true, status: 200, body: "203.0.113.9\n" };
      return { ok: true, status: 200, body: "198.51.100.7" };
    };
    const r = await DETECT.detectPublicIPv4({
      fetchImpl: fake, interfaces: IFACES, sources: [S1, S2, S3], timeoutMs: 50,
    });
    if (!r.ok || r.ip !== "203.0.113.9") {
      bad("PE-01 没有取到第二个源的有效 IP", JSON.stringify({ ok: r.ok, ip: r.ip }));
    } else if (r.source !== S2) {
      bad("PE-01 source 不是实际成功的源", r.source);
    } else if (calls[0] !== S1 || calls[1] !== S2) {
      bad("PE-01 没有按顺序尝试源", JSON.stringify(calls));
    } else {
      ok("PE-01 第一个源失败后改用第二个 → ip=203.0.113.9、source=第二个源");
    }
  }

  /* PE-02 全失败：不编造 IP，tried 长度 == 源数量。 */
  {
    const sources = [S1, S2, S3];
    const fake = async () => ({ ok: false, status: 503, error: "down" });
    const r = await DETECT.detectPublicIPv4({
      fetchImpl: fake, interfaces: IFACES, sources, timeoutMs: 50,
    });
    if (r.ok || r.ip !== "") {
      bad("PE-02 全部源失败却返回了 IP（编造）", JSON.stringify({ ok: r.ok, ip: r.ip }));
    } else if (r.tried.length !== sources.length) {
      bad("PE-02 tried 长度与源数量不一致", r.tried.length + " != " + sources.length);
    } else if (!r.tried.every((t) => t.url && t.error)) {
      bad("PE-02 失败原因列表不完整", JSON.stringify(r.tried));
    } else if (DETECT.SOURCES.length < 3) {
      bad("PE-02 默认源不足 3 个", DETECT.SOURCES.length);
    } else {
      ok("PE-02 全部源失败 → ok:false、ip 为空、tried=" + r.tried.length +
        " 条（默认源 " + DETECT.SOURCES.length + " 个）");
    }
  }

  /* PE-03 出口 IP 在网卡上 → 无 NAT；不在 → 有 NAT。 */
  {
    const fake = async () => ({ ok: true, status: 200, body: "203.0.113.9" });
    const direct = await DETECT.detectPublicIPv4({
      fetchImpl: fake, interfaces: IFACES_WITH_EXIT, sources: [S1], timeoutMs: 50,
    });
    const behindNat = await DETECT.detectPublicIPv4({
      fetchImpl: fake, interfaces: IFACES, sources: [S1], timeoutMs: 50,
    });
    if (direct.natDetected !== false) {
      bad("PE-03 出口 IP 在本机网卡上却判成 NAT", JSON.stringify(direct));
    } else if (behindNat.natDetected !== true) {
      bad("PE-03 出口 IP 不在网卡上却没判成 NAT", JSON.stringify(behindNat));
    } else if (direct.localInterfaces.length < 1) {
      bad("PE-03 没有返回本机网卡列表");
    } else {
      ok("PE-03 出口 IP 在网卡上 → natDetected:false；不在 → true");
    }
  }

  /* PE-04 非法响应体绝不能被当成 IP。 */
  {
    const bodies = [
      "<html><body>captive portal 10.0.0.1</body></html>",
      "",
      "203.0.113.9\n198.51.100.7",
      "not-an-ip",
      "1.2.3.999",
    ];
    const wrong = [];
    for (const body of bodies) {
      const r = await DETECT.detectPublicIPv4({
        fetchImpl: async () => ({ ok: true, status: 200, body }),
        interfaces: IFACES,
        sources: [S1],
        timeoutMs: 50,
      });
      if (r.ok) wrong.push(JSON.stringify(body));
    }
    if (wrong.length) bad("PE-04 非法 body 被当成了 IP", wrong.join(" / "));
    else ok("PE-04 HTML / 空 / 多行 / 非 IPv4 / 越界段 五种非法体全部拒绝");
  }

  /* PE-05 控制地址解析：优先 WANIP，且认 u: 前缀。 */
  {
    const a = UPNP.parseIgd(IGD_XML, "http://192.168.1.1:5000/rootDesc.xml");
    const b = UPNP.parseIgd(IGD_XML_PREFIXED, "http://192.168.1.1:5000/rootDesc.xml");
    if (a.controlUrl !== "http://192.168.1.1:5000/upnp/control/WANIPConnection1") {
      bad("PE-05 没有优先 WANIPConnection", a.controlUrl);
    } else if (b.controlUrl !== "http://192.168.1.1:5000/upnp/control/WANPPPConnection1") {
      bad("PE-05 带 u: 前缀的 controlURL 没解析出来", b.controlUrl);
    } else {
      ok("PE-05 从设备 XML 提取 controlURL：优先 WANIP、相对路径拼绝对、u: 前缀也认");
    }
  }

  /* PE-06 无 IGD：结构化 no_igd，绝不 throw。 */
  {
    let thrown = "";
    let r = null;
    try {
      r = await UPNP.addPortMapping({
        discoverImpl: async () => null,
        internalClient: "192.168.139.3",
        timeoutMs: 10,
      });
    } catch (e) {
      thrown = String((e && e.message) || e);
    }
    if (thrown) bad("PE-06 addPortMapping 把异常抛给了调用方", thrown);
    else if (!r || r.ok !== false || r.reason !== "no_igd") {
      bad("PE-06 无 IGD 时没有回 no_igd", JSON.stringify(r));
    } else if (r.upnpFound !== false) {
      bad("PE-06 无 IGD 时 upnpFound 应为 false", r.upnpFound);
    } else {
      ok("PE-06 无 IGD → {ok:false, reason:no_igd, upnpFound:false}，未抛异常");
    }
  }

  /* PE-07 SOAP errorCode → 结构化 soap_error:<code>；反真空：成功路径能通。 */
  {
    const discoverImpl = async () => ({
      location: "http://192.168.1.1:5000/rootDesc.xml",
      xml: IGD_XML,
    });
    const failed = await UPNP.addPortMapping({
      discoverImpl,
      soapImpl: async () => ({ ok: false, status: 500, body: SOAP_FAULT_718 }),
      internalClient: "192.168.139.3",
    });
    const succeeded = await UPNP.addPortMapping({
      discoverImpl,
      soapImpl: async () => ({ ok: true, status: 200, body: "<ok/>" }),
      internalClient: "192.168.139.3",
    });
    if (!failed.ok && failed.reason !== "soap_error:718") {
      bad("PE-07 没有读出 errorCode 数字", JSON.stringify(failed));
    } else if (failed.ok) {
      bad("PE-07 SOAP fault 却被当成成功");
    } else if (!succeeded.ok || succeeded.upnpFound !== true) {
      bad("PE-07 反真空：正常 SOAP 响应反而失败", JSON.stringify(succeeded));
    } else {
      ok("PE-07 SOAP errorCode=718 → soap_error:718；正常响应 → ok:true（反真空）");
    }
  }

  /* PE-08 静态 join：--auto 分支在、仍拒私网、--no-upnp 真生效。 */
  {
    const src = fs.readFileSync(SETUP_PATH, "utf8");
    const anchors = [
      [src.includes("--auto"), "没有 --auto 参数"],
      [src.includes("if (shouldAutoDetect(o)) {"), "没有 --auto 的判定分支"],
      [src.includes("entry = await autoEntry(o);"), "--auto 分支里没有调用探测"],
      [src.includes("isLoopbackOrPrivate(o.host)"), "私网/回环 host 的拒绝被拿掉了"],
      [src.includes("shouldAttemptUpnp(o, entry.natDetected)"), "--no-upnp 没有接进映射判定"],
      [src.includes("--no-upnp"), "没有 --no-upnp 参数"],
    ];
    const missing = anchors.filter(([v]) => !v).map(([, why]) => why);
    const noUpnpOff = SETUP.shouldAttemptUpnp({ noUpnp: true }, true) === false;
    const noUpnpOn = SETUP.shouldAttemptUpnp({ noUpnp: false }, true) === true;
    if (missing.length) bad("PE-08 接线缺：" + missing.join("；"));
    else if (!noUpnpOff || !noUpnpOn) bad("PE-08 shouldAttemptUpnp 对 --no-upnp 不敏感");
    else ok("PE-08 静态：--auto 分支在、isLoopbackOrPrivate 仍在拒私网、--no-upnp 真的能关掉映射");
  }

  /* PE-09 反真空：显式 --host 时绝不探测。 */
  {
    const explicit = SETUP.shouldAutoDetect({ auto: true, host: "1.2.3.4" });
    const automatic = SETUP.shouldAutoDetect({ auto: true, host: "" });
    const noFlag = SETUP.shouldAutoDetect({ auto: false, host: "" });
    const src = fs.readFileSync(SETUP_PATH, "utf8");
    if (explicit !== false) bad("PE-09 显式 --host 时仍然会去探测");
    else if (automatic !== true) bad("PE-09 --auto 且无 host 时没有触发探测");
    else if (noFlag !== false) bad("PE-09 没给 --auto 却触发了探测");
    else if (!/if \(shouldAutoDetect\(o\)\) \{\s*entry = await autoEntry\(o\);/.test(src)) {
      bad("PE-09 探测调用没有被 shouldAutoDetect 守住");
    } else {
      ok("PE-09 反真空：--auto + 显式 host → 不探测；仅 --auto 且空 host → 才探测");
    }
  }

  /* PE-10 三个脚本语法都能过。 */
  {
    const scripts = [DETECT_PATH, UPNP_PATH, SETUP_PATH];
    const bads = [];
    scripts.forEach((p) => {
      const r = spawnSync(process.execPath, ["--check", p], { encoding: "utf8", timeout: 10000 });
      if (r.status !== 0) bads.push(path.basename(p) + ": " + String(r.stderr || r.stdout).trim());
    });
    if (bads.length) bad("PE-10 node --check 失败", bads.join(" | "));
    else ok("PE-10 detect_public_ip / upnp_map / setup_public_relay 三个脚本 node --check 全过");
  }

  /* PE-11 CLI --help 不联网也能退出 0。 */
  {
    const scripts = [DETECT_PATH, UPNP_PATH, SETUP_PATH];
    const bads = [];
    scripts.forEach((p) => {
      const r = spawnSync(process.execPath, [p, "--help"], {
        encoding: "utf8",
        timeout: 8000,
        env: Object.assign({}, process.env, { NO_PROXY: "*", HTTP_PROXY: "", HTTPS_PROXY: "" }),
      });
      if (r.status !== 0) bads.push(path.basename(p) + ": status=" + r.status + " " + String(r.stderr || "").trim());
    });
    if (bads.length) bad("PE-11 --help 没有稳定退出 0", bads.join(" | "));
    else ok("PE-11 三个脚本 --help 全部退出 0（不依赖网络）");
  }

  /* PE-12 静态锚点：dgram 与 http 两条路径都设了超时。 */
  {
    const src = fs.readFileSync(UPNP_PATH, "utf8");
    const ssdpAt = src.indexOf("function ssdpDiscover");
    const discoverAt = src.indexOf("async function discoverGateway");
    const getAt = src.indexOf("function httpGetText");
    const soapAt = src.indexOf("function soapPost");
    const ssdpBlock = ssdpAt >= 0 && discoverAt > ssdpAt ? src.slice(ssdpAt, discoverAt) : "";
    // httpGetText 在 soapPost 之前，两者都在 ssdpDiscover 之前。
    const httpBlock = getAt >= 0 && ssdpAt > getAt ? src.slice(getAt, ssdpAt) : "";
    const missing = [];
    if (!/dgram\.createSocket/.test(src)) missing.push("没有 dgram 发现路径");
    if (!/mod\.get\(|https?\.get\(/.test(src)) missing.push("没有 http GET 路径");
    if (!/mod\.request\(/.test(src)) missing.push("没有 http SOAP POST 路径");
    if (!/setTimeout\(/.test(ssdpBlock) || !/timeoutMs/.test(ssdpBlock)) {
      missing.push("SSDP 收包没有超时");
    }
    if (!/setTimeout\(/.test(httpBlock) || !/timeoutMs/.test(httpBlock)) {
      missing.push("HTTP GET/SOAP 没有超时");
    }
    if (soapAt < 0) missing.push("找不到 soapPost");
    if (missing.length) bad("PE-12 超时接入不完整：" + missing.join("；"));
    else ok("PE-12 SSDP(dgram)、设备描述 GET、SOAP POST 三条网络路径都有 setTimeout 超时");
  }

  console.log("");
  console.log("prove_public_entry: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SETUP-FAIL: " + ((e && e.stack) || e));
  console.log("prove_public_entry: PASS=" + PASS + " FAIL=" + (FAIL + 1));
  process.exit(2);
});
