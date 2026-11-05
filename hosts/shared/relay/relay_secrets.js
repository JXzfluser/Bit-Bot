"use strict";
/**
 * relay_secrets.js — A3-12 中转凭证落盘加固（关 R-A3-6h 的「凭证明文」半条）
 *
 * 现状（A3-7..A3-11）：`data/desktop/relay.json` 里 `box_token` / `client_token`
 * 是**明文**，文件权限跟着 umask 走。`box_token` 是桌面自己的登记权，泄露出去
 * 别人就能把一台假盒子登记成你的 box_id。
 *
 * 仓库里早就有 `hosts/desktop/secret_vault.js`（GP-99~102）：AES-256-GCM 加密、
 * `vault.json` / `vault.key` 都是 0600、`resolve()` 是唯一解密读口、`status()`
 * 只回掩码。这一层**复用**它，不另造一套加密。
 *
 * 安全格式（relay.json 里不再有任何明文 token）：
 *   { "host": "...", "port": 18766, "box_id": "...", "mode": "reverse",
 *     "box_token_ref": "relay.box_token", "client_token_ref": "relay.client_token" }
 *
 * 兼容性是硬要求：旧的手写明文 `relay.json` 继续能读，环境变量兜底不变，
 * `loadRelayConfigSecure()` 的返回形状与 `relay_config.loadRelayConfig()` **完全一致**
 * （cfg 或 null），所以 main.js 只要换调用点，其它逻辑一行不用改。
 *
 * 边界：vault 的密钥文件仍在本机磁盘上（不是 OS 钥匙串），所以它防的是
 * 「grep data/ 就看到明文 / 文件被同机其他用户读走」，不防「本机已被完全控制」。
 * 真正的钥匙串接入、以及桌面设置界面，仍归 R-A3-6h 剩余部分。
 */
const fs = require("fs");
const path = require("path");
const relayConfig = require("./relay_config");

const BOX_TOKEN_NAME = "relay.box_token";
const CLIENT_TOKEN_NAME = "relay.client_token";
const SECURE_MODE = 0o600;

function configFileOf(opts) {
  const o = opts || {};
  return o.file ? String(o.file) : relayConfig.defaultRelayConfigPath(o.repoRoot);
}

function usableVault(v) {
  return Boolean(v && typeof v.submit === "function" && typeof v.resolve === "function");
}

/**
 * 安全写入：两把 token 交给 vault 加密，`relay.json` 只留引用与非敏感字段，mode 0600。
 * 写完再做一次「文件里查无明文」自检 —— 万一将来有人往 body 里加了 token 字段，
 * 这里会直接拒绝，而不是悄悄把明文写回磁盘。
 */
function writeRelayConfigSecure(opts) {
  const o = opts || {};
  const cfg = relayConfig.normalizeRelayConfig(o.cfg);
  if (!cfg) return { ok: false, reason: "bad_config" };
  if (!usableVault(o.vault)) return { ok: false, reason: "no_vault" };

  const b = o.vault.submit({ name: BOX_TOKEN_NAME, label: "中继 box_token", value: cfg.boxToken });
  const c = o.vault.submit({ name: CLIENT_TOKEN_NAME, label: "中继 client_token", value: cfg.clientToken });
  if (!b.ok || !c.ok) {
    return { ok: false, reason: "vault_submit_failed", box: b && b.ok, client: c && c.ok };
  }

  const body = {
    host: cfg.host,
    port: cfg.port,
    box_id: cfg.boxId,
    box_token_ref: BOX_TOKEN_NAME,
    client_token_ref: CLIENT_TOKEN_NAME,
  };
  if (cfg.mode === "reverse") body.mode = "reverse";
  if (cfg.endpoint) body.endpoint = cfg.endpoint;
  if (cfg.localEndpoint) body.local_endpoint = cfg.localEndpoint;
  if (cfg.connectHost) body.connect_host = cfg.connectHost;

  const text = JSON.stringify(body, null, 2) + "\n";
  if (text.includes(cfg.boxToken) || text.includes(cfg.clientToken)) {
    return { ok: false, reason: "plaintext_would_leak" };
  }

  const file = configFileOf(o);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, text, { mode: SECURE_MODE });
    try {
      fs.chmodSync(file, SECURE_MODE);
    } catch (_) { /* 非 POSIX 文件系统尽力而为 */ }
  } catch (e) {
    return { ok: false, reason: "write_failed", error: String((e && e.message) || e) };
  }
  return { ok: true, file, mode: SECURE_MODE, handles: { box: b.handle, client: c.handle } };
}

/**
 * 读配置。返回形状与 relay_config.loadRelayConfig 完全一致：归一后的 cfg 或 null。
 * 三种来源：安全引用格式 / 旧明文格式 / 环境变量兜底（文件 > 环境变量）。
 * 缺 vault 而配置又是引用格式 ⇒ 当半套处理回 null，绝不猜、绝不编一个默认 token。
 */
function loadRelayConfigSecure(opts) {
  const o = opts || {};
  const file = configFileOf(o);
  let raw = null;
  try {
    if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    raw = null; // 坏 JSON / 权限不足：当作没配，不抛
  }

  if (raw && typeof raw === "object") {
    const usesRefs = Boolean(raw.box_token_ref || raw.client_token_ref);
    if (usesRefs) {
      if (!usableVault(o.vault)) return null;
      raw = Object.assign({}, raw, {
        box_token: o.vault.resolve(raw.box_token_ref || BOX_TOKEN_NAME),
        client_token: o.vault.resolve(raw.client_token_ref || CLIENT_TOKEN_NAME),
      });
    }
    const cfg = relayConfig.normalizeRelayConfig(raw);
    if (cfg) return cfg;
  }
  const env = o.env === undefined ? process.env : o.env;
  return relayConfig.relayConfigFromEnv(env);
}

/** 给门与将来的设置面看：文件权限、有没有明文 token、引用是否齐。 */
function inspectRelayConfigFile(opts) {
  const o = opts || {};
  const file = configFileOf(o);
  const out = { exists: false, mode: null, secure: false, hasPlaintextTokens: false, refs: [], warnings: [] };
  let text = "";
  try {
    if (!fs.existsSync(file)) return out;
    out.exists = true;
    text = fs.readFileSync(file, "utf8");
    out.mode = fs.statSync(file).mode & 0o777;
    out.secure = out.mode === SECURE_MODE;
    if (!out.secure) out.warnings.push("mode=" + out.mode.toString(8) + "（期望 600）");
  } catch (e) {
    out.warnings.push("read_failed: " + String((e && e.message) || e));
    return out;
  }
  let raw = null;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    out.warnings.push("invalid_json");
    return out;
  }
  if (!raw || typeof raw !== "object") return out;
  // 「看起来像凭证」的判定按字段名，不猜值：明文格式就是有这两个键。
  out.hasPlaintextTokens = Boolean(raw.box_token || raw.client_token || raw.boxToken || raw.clientToken);
  if (out.hasPlaintextTokens) out.warnings.push("relay.json 里仍有明文 token（建议改用安全格式）");
  if (raw.box_token_ref) out.refs.push(String(raw.box_token_ref));
  if (raw.client_token_ref) out.refs.push(String(raw.client_token_ref));
  if (text.includes(BOX_TOKEN_NAME) && out.hasPlaintextTokens) {
    out.warnings.push("引用格式与明文格式混写");
  }
  return out;
}

module.exports = {
  writeRelayConfigSecure,
  loadRelayConfigSecure,
  inspectRelayConfigFile,
  BOX_TOKEN_NAME,
  CLIENT_TOKEN_NAME,
  SECURE_MODE,
};
