#!/usr/bin/env node
"use strict";

/**
 * 跨端审批的客户端 —— 让「批准」这件事现在就能用。
 *
 * 一台常开的机器(Box)会攒下待批准的请求。**机器上没有人在旁边**,
 * 所以批准必须能从别的机器做。这份 CLI 就是那个「别的机器」:
 *
 *   node scripts/approve.js --box http://127.0.0.1:18765 \
 *        --credential data/host/credentials/dev-mobile-xxx.credential.json list
 *   node scripts/approve.js ... allow  <approval-id>    # 只批这一次
 *   node scripts/approve.js ... always <approval-id>    # 授权这台机器以后做这类事
 *   node scripts/approve.js ... deny   <approval-id>
 *
 * 鉴权用**设备密钥**(B-4a):凭证文件里有私钥,签名之后 Box 用公钥验。
 * 账号 = 设备密钥,没有别的身份。
 *
 * 注意 `always` 的分量:它写的是这台机器上的 allow 规则(`kind:*`),
 * 等于**授权这台机器以后做这类事不再逐次问你**。所以这个命令会先问你一句。
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const deviceKeys = require(path.join(ROOT, "hosts/shared/device_keys"));

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0 || i + 1 >= process.argv.length) return dflt;
  return String(process.argv[i + 1]);
}

function has(name) {
  return process.argv.indexOf("--" + name) >= 0;
}

/** 带值的 flag。**布尔 flag(比如 --yes)不吃后面的词** —— 否则
 *  `--yes always approval-x` 里的 `always` 会被当成 --yes 的值吃掉。 */
const VALUE_FLAGS = new Set(["box", "credential"]);

/** 位置参数:跳过 --xxx(带值的那个才吃掉它的值)。 */
function positionals() {
  const out = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2).split("=")[0];
      if (a.indexOf("=") < 0 && VALUE_FLAGS.has(name)) i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

function readCredential(file) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) {
    throw new Error("找不到设备凭证文件: " + p);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!raw || !raw.id || !raw.private_key_pem) {
    throw new Error("凭证文件不完整(缺 id 或私钥): " + p);
  }
  return raw;
}

function request(baseUrl, method, urlPath, device, bodyObj) {
  const u = new URL(urlPath, baseUrl);
  const body = bodyObj ? Buffer.from(JSON.stringify(bodyObj), "utf8") : Buffer.alloc(0);
  const headers = { Accept: "application/json" };
  if (body.length) headers["Content-Type"] = "application/json";
  const ts = String(Date.now());
  const nonce = "n-" + require("crypto").randomBytes(8).toString("hex");
  const sig = deviceKeys.signTurn(device.private_key_pem, device.id, ts, nonce, body);
  headers["x-bitbot-device"] = device.id;
  headers["x-bitbot-timestamp"] = ts;
  headers["x-bitbot-nonce"] = nonce;
  headers["x-bitbot-signature"] = sig;

  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let parsed = {};
          try { parsed = JSON.parse(raw || "{}"); } catch (_) { parsed = { raw }; }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (body.length) req.write(body);
    req.end();
  });
}

async function main() {
  const boxUrl = String(arg("box", process.env.BITBOT_BOX_URL || "http://127.0.0.1:18765")).replace(/\/+$/, "");
  const credentialPath = arg("credential", process.env.BITBOT_DEVICE_CREDENTIAL || "");
  const [cmd, id] = positionals();

  if (!cmd) {
    console.error(
      "usage: node scripts/approve.js --box <url> --credential <file> <list|allow|always|deny> [approval-id]",
    );
    process.exit(2);
  }
  if (!credentialPath) {
    console.error(
      "缺少设备凭证。用 scripts/device-keys.js init --out <dir> 生成一份。",
    );
    process.exit(2);
  }
  const device = readCredential(credentialPath);

  if (cmd === "list") {
    const res = await request(boxUrl, "GET", "/v1/approvals", device);
    if (res.status !== 200) {
      console.error("拉取失败: HTTP " + res.status + " " + JSON.stringify(res.body));
      process.exit(1);
    }
    const pending = (res.body && res.body.pending) || [];
    if (!pending.length) {
      console.log("没有待批准的请求。");
      return;
    }
    console.log("这台机器上等着人批的请求(" + pending.length + " 条):\n");
    for (const p of pending) {
      console.log("  id:       " + p.id);
      console.log("  类型:     " + p.kind + "   来源: " + (p.source || "?"));
      console.log("  内容:     " + (p.command || "").slice(0, 120));
      console.log("  申请于:   " + (p.requested_at || ""));
      console.log("  过期于:   " + (p.expires_at || ""));
      console.log("  状态:     " + (p.status || ""));
      console.log("  → 批准:   node scripts/approve.js ... allow  " + p.id);
      console.log("  → 总是:   node scripts/approve.js ... always " + p.id);
      console.log("  → 拒绝:   node scripts/approve.js ... deny   " + p.id);
      console.log("");
    }
    return;
  }

  if (!["allow", "always", "deny"].includes(cmd)) {
    console.error("未知命令:" + cmd + "(可用:list / allow / always / deny)");
    process.exit(2);
  }
  if (!id) {
    console.error("缺少 approval-id。先跑 list 看看有哪些。");
    process.exit(2);
  }
  const decision = cmd === "allow" ? "allow_once" : cmd;

  if (decision === "always" && !has("yes")) {
    // always 的分量比 allow_once 重:它授权的是**这台机器**以后做这类事。
    console.log(
      "「总是允许」会在这台机器上写一条 allow 规则(" + cmd + "),\n" +
      "也就是:以后这类操作不再逐次问你。\n" +
      "确认请加 --yes 再跑一次。",
    );
    process.exit(3);
  }

  const res = await request(boxUrl, "POST", "/v1/approvals/" + encodeURIComponent(id) + "/decide", device, {
    decision,
  });
  if (res.status !== 200) {
    console.error("决定失败: HTTP " + res.status + " " + JSON.stringify(res.body));
    process.exit(1);
  }
  console.log(JSON.stringify(res.body, null, 2));
}

main().catch((e) => {
  console.error("approve: " + String((e && e.message) || e));
  process.exit(1);
});
