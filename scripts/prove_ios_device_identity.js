#!/usr/bin/env node
"use strict";

/**
 * prove_ios_device_identity —— iOS 的设备签名口径必须与服务端**逐字节相同**
 *
 * 现场:Android 侧一直有设备密钥签名(DeviceIdentity.requestHeaders),
 * iOS 侧只发一个共享 Bearer ⇒ 桌面/Box 的设备登记表一旦非空,
 * **iOS 的请求直接 401**。共享 Bearer 是"一把钥匙开所有门"。
 *
 * 为什么这值得一道门(Android 侧自己的注释就写了):
 *   「差一个换行,真机上就是**永久 401**,而两边的单测都会绿着。」
 * ⇒ 端上单测覆盖不到"跨语言口径一致"这件事 ⇒ 必须有一道门横跨两边。
 *
 * 本门做三件事:
 *   1. **真跑**服务端的 signingPayload(不是抄一遍),把结果与从 Swift 源码里
 *      提取的模板**拼出来的字节**逐字节比。
 *   2. 四个头名、SPKI 前缀字节、签名算法/base64 口径,Swift 侧必须与服务端一致。
 *   3. TurnBridge 真的把签名挂到请求上(挂在 httpBody **之后** —— 签名覆盖 body)。
 *
 * ⚠️ 诚实的边界:沙箱里**没有 Swift 编译器**,所以本门**不能**编译/运行 Swift。
 * 它能保证的是「Swift 源码写的口径与服务端一致」,
 * 不能保证「Swift 能编译」—— 那要真机/CI 上的 xcodebuild。
 */

const fs = require("fs");
const path = require("path");
const deviceKeys = require("../hosts/shared/device_keys");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };
const check = (cond, m, d) => { if (cond) ok(m); else bad(m, d); };

const REPO = path.resolve(__dirname, "..");
const SWIFT_DIR = path.join(REPO, "hosts/ios/BitBotHost/Sources/BitBotHost");
// 负向段跑在**副本**上 ⇒ 源文件永不被改。
// (`BITBOT_IOS_SRC_DIR` 指向副本时,整个门就审那份副本。)
const SRC_DIR = process.env.BITBOT_IOS_SRC_DIR || SWIFT_DIR;
const swiftPath = (f) => path.join(SRC_DIR, f);
const readSwift = (f) => {
  const p = swiftPath(f);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};

console.log("prove_ios_device_identity（iOS 设备签名口径）");

const swiftId = readSwift("DeviceIdentity.swift");
const swiftBridge = readSwift("TurnBridge.swift");

// ---------------------------------------------------------------- 1. 头名
const HEADER_NAMES = [
  "x-bitbot-device",
  "x-bitbot-timestamp",
  "x-bitbot-nonce",
  "x-bitbot-signature",
];
check(swiftId.length > 0, "DI-1 iOS 侧有 DeviceIdentity.swift");
check(swiftBridge.length > 0, "DI-1 iOS 侧有 TurnBridge.swift");
for (const h of HEADER_NAMES) {
  check(
    swiftId.indexOf('"' + h + '"') >= 0,
    "DI-2 iOS 带头名与服务端一致:" + h,
    "Swift 里没找到 " + h,
  );
}

// ---------------------------------------------------------------- 2. 签名载荷逐字节
// 从 Swift 源码里把模板抠出来(不是手抄一份)
const tplMatch = swiftId.match(
  /signingPayload[\s\S]{0,400}?Data\(\(([^\n]*?)\)\.utf8\)/,
);
check(
  !!tplMatch,
  "DI-3 iOS 的签名载荷模板能被抠出来(门禁真读源码,不是抄)",
  tplMatch ? "" : "没匹配到 Data((...).utf8)",
);
if (tplMatch) {
  const swiftExpr = tplMatch[1];
  // Swift 表达式:deviceId + "\n" + timestamp + "\n" + nonce + "\n"
  const parts = swiftExpr.split("+").map((s) => s.trim());
  const literals = parts
    .filter((p) => /^".*"$/.test(p))
    .map((p) => p.slice(1, -1))
    .filter((p) => p.indexOf("\\n") >= 0);
  // 抠出**变量顺序**(不只是换行个数)—— 顺序抄错也必须能红。
  const varOrder = parts.filter((p) => !/^".*"$/.test(p) && p.length);
  const SEP = "\\n";
  const VALUES = {
    deviceId: "dev-ios-test",
    timestamp: "1700000000000",
    nonce: "ios-abc",
  };
  // 按 Swift 里写的顺序拼
  let swiftHead = "";
  for (let i = 0; i < varOrder.length; i++) {
    const name = varOrder[i];
    if (!(name in VALUES)) {
      swiftHead = "";
      break;
    }
    swiftHead += VALUES[name];
    // Swift 源码里的 "\n" 是**转义序列文本**,拼字节前要解释成真换行
    if (i < literals.length) swiftHead += literals[i].replace(/\\n/g, "\n");
  }
  check(
    varOrder.length === 3 &&
      varOrder[0] === "deviceId" &&
      varOrder[1] === "timestamp" &&
      varOrder[2] === "nonce",
    "DI-3 Swift 模板的变量顺序是 deviceId → timestamp → nonce",
    "抠出来的顺序:" + JSON.stringify(varOrder),
  );
  check(
    literals.length === 3 && literals.every((l) => l === SEP),
    "DI-3 Swift 模板是三段换行分隔",
    "抠出来的分隔符:" + JSON.stringify(literals),
  );
  // 服务端**真跑**一遍(不是抄)
  const body = Buffer.from('{"text":"你好"}', "utf8");
  const serverBytes = deviceKeys.signingPayload(
    "dev-ios-test",
    "1700000000000",
    "ios-abc",
    body,
  );
  const swiftBytes = Buffer.concat([Buffer.from(swiftHead, "utf8"), body]);
  check(
    serverBytes.equals(swiftBytes),
    "DI-3 签名载荷与服务端逐字节相同(按 Swift 写的顺序拼 vs 服务端真跑)",
    "server=" + serverBytes.toString("hex").slice(0, 80) + " swift=" + swiftBytes.toString("hex").slice(0, 80),
  );
  check(
    serverBytes.toString("utf8").indexOf("dev-ios-test\n1700000000000\nios-abc\n") === 0,
    "DI-3 载荷前缀是 deviceId\\nts\\nnonce\\n",
    serverBytes.toString("utf8").slice(0, 60),
  );
}

// ---------------------------------------------------------------- 3. SPKI 前缀
const spkiMatch = swiftId.match(/spkiPrefix[^=]*=\s*\[([\s\S]*?)\]/);
check(!!spkiMatch, "DI-4 iOS 的 SPKI 前缀能被抠出来");
if (spkiMatch) {
  const swiftBytes = (spkiMatch[1].match(/0x[0-9A-Fa-f]{2}/g) || []).map((h) => parseInt(h, 16));
  // 服务端口径:Node export spki 的 DER 前缀
  const crypto = require("crypto");
  const key = crypto.generateKeyPairSync("ed25519");
  const der = key.publicKey.export({ type: "spki", format: "der" });
  const serverPrefix = Array.from(der.slice(0, der.length - 32));
  check(
    swiftBytes.length === serverPrefix.length && swiftBytes.every((b, i) => b === serverPrefix[i]),
    "DI-4 SPKI 前缀与 Node 导出的逐字节相同(iOS 能算出桌面认的公钥 PEM)",
    "swift=" + swiftBytes.join(",") + " server=" + serverPrefix.join(","),
  );
  check(
    swiftId.indexOf("base64EncodedString") >= 0 &&
      /chunked\(64\)|offsetBy: 64/.test(swiftId) &&
      swiftId.indexOf("-----BEGIN PUBLIC KEY-----") >= 0,
    "DI-4 公钥 PEM 的折行/头尾与服务端口径一致(64 一折)",
  );
}

// ---------------------------------------------------------------- 4. 签名算法与 base64
check(
  swiftId.indexOf("Curve25519.Signing.PrivateKey") >= 0,
  "DI-5 iOS 用的是 ed25519(CryptoKit Curve25519.Signing)",
);
check(
  swiftId.indexOf("rawRepresentation") >= 0,
  "DI-5 iOS 从 32 字节种子派生私钥(与 Android 的 seed 同一形状)",
);
check(
  /signature\(for:/.test(swiftId) && swiftId.indexOf("base64EncodedString") >= 0,
  "DI-5 iOS 签名值是标准 base64(与 Buffer.from(sig,\"base64\") 同一个)",
);

// ---------------------------------------------------------------- 5. TurnBridge 真的挂了
const httpBodyAt = swiftBridge.indexOf("req.httpBody =");
const headersAt = swiftBridge.indexOf("requestHeaders(body:");
check(httpBodyAt >= 0 && headersAt >= 0, "DI-6 TurnBridge 构造了 body 也取了签名头");
check(
  httpBodyAt >= 0 && headersAt >= 0 && headersAt > httpBodyAt,
  "DI-6 签名头挂在 httpBody **之后**(签名覆盖 body 字节,顺序反了就签错东西)",
  "httpBody@" + httpBodyAt + " headers@" + headersAt,
);
check(
  swiftBridge.indexOf("x-bitbot") < 0 &&
    /for \(field, value\) in headers\.headerFields/.test(swiftBridge),
  "DI-6 四个头由 headerFields 统一挂上(不手抄头名)",
);

// ---------------------------------------------------------------- 6. 负向:Swift 抄错就红
// ⚠️ 负向段会**再跑一次本门**(子进程)。子进程必须跳过负向段,
// 否则无限递归 ⇒ 多个进程互改同一个源文件 ⇒ 文件被留在变异状态。
// (第一版没加这个开关,结果 DeviceIdentity.swift 被留在 typo 状态。)
if (process.argv.includes("--no-self-check")) {
  console.log("\nprove_ios_device_identity: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
}
{
  // 把 Swift 里的一个头名改错 ⇒ 门必须红。
  //
  // ⚠️ 变异打在**副本**上,不打在源文件上。
  // 第一版改的是源文件:父进程只要被杀一次(沙箱的长任务杀手),
  // 文件就永久留在变异状态 —— 后面的门全在审一个坏文件,而且没人知道。
  // ⇒ 现在:复制 → 变异副本 → 子进程审副本 → 删副本。源文件一个字节都不动。
  const os = require("os");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-ios-mut-"));
  for (const f of fs.readdirSync(SWIFT_DIR)) {
    fs.copyFileSync(path.join(SWIFT_DIR, f), path.join(tmpDir, f));
  }
  const target = path.join(tmpDir, "DeviceIdentity.swift");
  const orig = fs.readFileSync(target, "utf8");
  fs.writeFileSync(
    target,
    orig.replace('"x-bitbot-nonce"', '"x-bitbot-nonce-typo"'),
    "utf8",
  );
  const { execFileSync } = require("child_process");
  let red = false;
  let out = "";
  try {
    execFileSync(
      process.execPath,
      [path.join(REPO, "scripts", "prove_ios_device_identity.js"), "--no-self-check"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: Object.assign({}, process.env, { BITBOT_IOS_SRC_DIR: tmpDir }),
      },
    );
  } catch (e) {
    red = true;
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  check(red, "DI-7 负向:Swift 抄错头名 ⇒ 本门必须红", out.slice(0, 200));
  check(
    out.indexOf("x-bitbot-nonce") >= 0,
    "DI-7 负向:红的原因正是那个头名(不是别的巧合)",
    out.slice(0, 200),
  );
}

console.log("\nprove_ios_device_identity: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
