#!/usr/bin/env node
/* gen_device_signature_vectors.mjs — A2-3 的**跨语言金标**（Node 是预言机）
 *
 * 为什么要有这个文件：手机端要自己签 ed25519（bcprov），而验签的是 Node 这边
 * （hosts/shared/device_keys.js）。两边各写各的、各自测自己，最容易坏在
 * 「签的到底是哪串字节」这种约定上 —— 分隔符、UTF-8、空 body、base64 变体，
 * 任何一条理解不同，真机上就是永久 401，而两边的单测都还绿着。
 *
 * 所以：把 Node 侧的输入输出**冻结成金标**塞进 Kotlin 测试里。
 *   · Kotlin 用同一个 seed 必须推导出与 Node 完全一致的 SPKI 公钥 PEM；
 *   · Kotlin 对同一条 payload 必须签出与 Node **逐字节相同**的 base64 签名
 *     （ed25519 是确定性签名，RFC 8032，没有随机数 —— 不同就是实现错了）；
 *   · Node 这边若哪天改了 signingPayload 的拼法，本文件重跑就会与已提交的
 *     金标不一致 ⇒ prove_w3_device_trust 的 WD-10 翻红（改约定必须两边一起改、一起留证据）。
 *
 * 用法：
 *   node scripts/gen_device_signature_vectors.mjs            # 打到 stdout
 *   node scripts/gen_device_signature_vectors.mjs --write    # 写进 Kotlin 测试目录
 *
 * 三条 payload 是特意选的：ASCII body、中文多字节 body（UTF-8 长度 ≠ 字符数，
 * 按 length 截断或按 char 编码都会错）、空 body（GET /v1/events 没有请求体，
 * 签的必须是「只有三行前缀」那串字节，不能是 null 或 "undefined"）。
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const deviceKeys = require("../hosts/shared/device_keys");

const REPO = path.resolve(__dirname, "..");
const OUT = path.join(
  REPO,
  "hosts/android/BitBotHost/app/src/test/java/com/bitbot/host/DeviceSignatureVectors.kt",
);

/* 测试专用 seed：不是任何设备的密钥，也不许拿去做任何真实配对。
 * 取一个「一眼看得出是派生出来的」串，避免被人误当成真私钥拷进配置里。 */
const SEED = crypto.createHash("sha256").update("bitbot-a23-device-signature-golden-seed").digest();
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function privateKeyPemFromSeed(seed) {
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  return (
    "-----BEGIN PRIVATE KEY-----\n" +
    der.toString("base64").replace(/(.{64})/g, "$1\n") +
    "-----END PRIVATE KEY-----\n"
  );
}

const DEVICE_ID = "dev-android-a23golden";
const TS = "1730000000000";
const NONCE = "nonce-a23-0001";

const VECTORS = [
  {
    label: "POST /v1/turn —— 纯 ASCII 请求体",
    body: JSON.stringify({ text: "hello", machine_kind: "android", session_id: "mobile-android" }),
  },
  {
    label: "POST /v1/turn —— 中文多字节请求体（UTF-8 字节数 ≠ 字符数）",
    body: JSON.stringify({
      text: "帮我查一下今天的天气，并提醒我带伞",
      machine_kind: "android",
      session_id: "mobile-android",
    }),
  },
  {
    label: "GET /v1/events —— 空请求体（签的必须只有三行前缀）",
    body: "",
  },
];

function kotlinStringLiteral(s) {
  // Kotlin 里 JSON 原文含 "，逐字符转义最省事；也保证 diff 只随内容变。
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
}

function emit() {
  const privPem = privateKeyPemFromSeed(SEED);
  const pubPem = deviceKeys.generateDeviceKey
    ? crypto.createPublicKey(crypto.createPrivateKey(privPem)).export({ type: "spki", format: "pem" }).toString()
    : "";
  // 顺带自证：这把公钥确实能走通产品自己的验签路径（签 → 验，不过就根本不该生成金标）
  const selfCheck = VECTORS.map((v) => {
    const bodyBuf = v.body ? Buffer.from(v.body, "utf8") : Buffer.alloc(0);
    const sig = deviceKeys.signTurn(privPem, DEVICE_ID, TS, NONCE, bodyBuf);
    const ok = crypto.verify(
      null,
      deviceKeys.signingPayload(DEVICE_ID, TS, NONCE, bodyBuf),
      crypto.createPublicKey(pubPem),
      Buffer.from(sig, "base64"),
    );
    if (!ok) throw new Error("金标自检失败：" + v.label);
    // 反向对照：改一字节（空 body 则加一字节）必须验不过 —— 否则「自检」只是恒真。
    const flipped = bodyBuf.length ? bodyBuf[bodyBuf.length - 1] ^ 0x20 : 0x20;
    const tampered = Buffer.concat([bodyBuf.subarray(0, Math.max(0, bodyBuf.length - 1)), Buffer.from([flipped])]);
    const tamperedOk = crypto.verify(
      null,
      deviceKeys.signingPayload(DEVICE_ID, TS, NONCE, tampered),
      crypto.createPublicKey(pubPem),
      Buffer.from(sig, "base64"),
    );
    if (tamperedOk) throw new Error("金标自检的反向对照失效：改一字节还能验过");
    return sig;
  });

  const lines = [];
  lines.push("package com.bitbot.host");
  lines.push("");
  lines.push("/**");
  lines.push(" * GENERATED —— 由 `node scripts/gen_device_signature_vectors.mjs --write` 生成，不要手改。");
  lines.push(" *");
  lines.push(" * 这是 A2-3（端侧 ed25519 签名）的跨语言金标：Node 侧 hosts/shared/device_keys.js 是预言机。");
  lines.push(" * 端上实现（DeviceIdentity.kt）必须用同一个 seed 推导出同样的公钥，并签出**逐字节相同**的签名。");
  lines.push(" * ed25519 是确定性签名（RFC 8032），没有随机数：不一样就是实现错了，不存在「等价但不同」。");
  lines.push(" *");
  lines.push(" * 这个 seed 是测试派生的（sha256(\"bitbot-a23-device-signature-golden-seed\")），不是任何真实设备的密钥。");
  lines.push(" * prove_w3_device_trust 的 WD-10 会拿 Node 现行代码重算一遍并与此文件比对：");
  lines.push(" * 改了签名约定却不打算改端上，这里就会红。");
  lines.push(" */");
  lines.push("object DeviceSignatureVectors {");
  lines.push("  /** 32 字节 ed25519 seed（hex）。 */");
  lines.push("  const val SEED_HEX: String = " + kotlinStringLiteral(SEED.toString("hex")));
  lines.push("  /** Node crypto 导出的 SPKI PEM —— 端上必须逐字符拼出同一串（含结尾换行）。 */");
  lines.push("  const val PUBLIC_KEY_PEM: String = " + kotlinStringLiteral(pubPem));
  lines.push("  const val DEVICE_ID: String = " + kotlinStringLiteral(DEVICE_ID));
  lines.push("  const val TIMESTAMP: String = " + kotlinStringLiteral(TS));
  lines.push("  const val NONCE: String = " + kotlinStringLiteral(NONCE));
  lines.push("");
  lines.push("  /** 一条金标：请求体原文 + Node 用同一 seed 签出的 base64 签名。 */");
  lines.push("  data class Vector(val label: String, val body: String, val signatureBase64: String)");
  lines.push("");
  lines.push("  val VECTORS: List<Vector> = listOf(");
  VECTORS.forEach((v, i) => {
    lines.push("    Vector(");
    lines.push("      label = " + kotlinStringLiteral(v.label) + ",");
    lines.push("      body = " + kotlinStringLiteral(v.body) + ",");
    lines.push("      signatureBase64 = " + kotlinStringLiteral(selfCheck[i]) + ",");
    lines.push("    ),");
  });
  lines.push("  )");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

const out = emit();
if (process.argv.includes("--write")) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.error("written: " + OUT);
} else {
  process.stdout.write(out);
}
