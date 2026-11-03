"use strict";
/**
 * relay_keys.js — 中转节点的成员凭证（A3-1）
 *
 * 中继节点不是「设备」，是「转发节点」。它用自己的 relay-secret 给成员（box / client）
 * 签发短期可校验的凭证，不在中转侧存任何设备私钥、也不解析业务内容。
 *
 * 模型（刻意最小）：HMAC-SHA256 签名的不透明 token。relay-secret 由两个信任方
 * （Box 启动时、Client 配置里）共享；任一方的 secret 泄露都只影响中转准入，不触碰
 * 业务内容（数据面是盲转发）。这不是公钥体系，是「共享准入密钥」，符合「仅自托管镜像、
 * 用户侧自己管 secret」的拍板。
 */

const crypto = require("crypto");

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}

/** 签发成员凭证：token = base64url(payload).base64url(HMAC(secret, payload)) */
function issueRelayCredential(secret, memberId, role) {
  const payload = b64url(JSON.stringify({ m: String(memberId), r: String(role), i: Date.now() }));
  const sig = b64url(crypto.createHmac("sha256", String(secret)).update(payload).digest());
  return payload + "." + sig;
}

/**
 * 校验成员凭证。返回 {ok:true, memberId, role} 或 {ok:false}。
 * 篡改 / 重放（iat 不在校验范围，最短 Token 即可）/ 错误 secret 一律 ok:false。
 */
function verifyRelayCredential(secret, token) {
  if (typeof token !== "string" || token.indexOf(".") < 0) return { ok: false };
  const dot = token.indexOf(".");
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = b64url(crypto.createHmac("sha256", String(secret)).update(payload).digest());
  const a = Buffer.from(sig || "");
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
  try {
    const obj = JSON.parse(b64urlDecode(payload));
    if (!obj || typeof obj.m !== "string" || typeof obj.r !== "string") return { ok: false };
    return { ok: true, memberId: obj.m, role: obj.r };
  } catch (_) {
    return { ok: false };
  }
}

module.exports = { issueRelayCredential, verifyRelayCredential };
