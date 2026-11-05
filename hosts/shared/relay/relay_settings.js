"use strict";
/**
 * relay_settings.js — A3-14 桌面中转设置面的读写逻辑（部分关 R-A3-6h）
 *
 * 这一层是**给 UI 用的视图**，不是给主进程内部用的配置加载器：
 *  - `readRelaySettings()` 只回掩码视图，**绝不返回两把 token 的明文**
 *    （渲染端连看都不该看到；输入框因此永远是空的，placeholder 写「留空沿用」）。
 *  - `saveRelaySettings()` 校验字段后走 `writeRelayConfigSecure()`：
 *    两把 token 进 vault、`relay.json` 只留引用、mode 0600。
 *  - 用户只改地址 / 模式时**可以不重贴 token** —— 从现有配置沿用；
 *    首次配置缺 token 则明确拒绝，绝不编一个默认凭证。
 *
 * 抽成独立模块是为了门禁能直接 require 用真 vault + 真文件跑；
 * main.js 的 IPC handler 只做「调它 + 触发一次重新登记」。
 * 静态 join 由门里的锚点补（A3-7 的教训：模块绿 ≠ 产品会用）。
 */
const fs = require("fs");
const path = require("path");
const relaySecrets = require("./relay_secrets");
const relayConfig = require("./relay_config");

function mask(v) {
  const s = String(v || "");
  return s ? "****" + s.slice(-4) : "";
}

function optsOf(opts) {
  const o = opts || {};
  return {
    repoRoot: o.repoRoot,
    file: o.file,
    vault: o.vault,
    env: o.env === undefined ? {} : o.env, // 设置面只看文件，不被进程环境变量干扰
  };
}

/** 给 UI 的只读视图：掩码 + 状态，绝不含明文。 */
function readRelaySettings(opts) {
  const o = optsOf(opts);
  const cfg = relaySecrets.loadRelayConfigSecure(o);
  const info = relaySecrets.inspectRelayConfigFile(o);
  return {
    configured: Boolean(cfg),
    host: cfg ? cfg.host : "",
    port: cfg ? cfg.port : "",
    boxId: cfg ? cfg.boxId : "",
    mode: cfg ? cfg.mode : "dial",
    secure: info.exists ? info.secure : true,
    hasPlaintextTokens: Boolean(info.hasPlaintextTokens),
    boxTokenMask: cfg ? mask(cfg.boxToken) : "",
    clientTokenMask: cfg ? mask(cfg.clientToken) : "",
    warnings: info.warnings.slice(),
    // 显式诚实：渲染端拿不到值，连字段名都不给它误用的机会。
    value_echoed: false,
  };
}

function parsePatch(patch) {
  const p = patch && typeof patch === "object" ? patch : {};
  const host = String(p.host || "").trim();
  const port = Number(p.port);
  const boxId = String(p.box_id || p.boxId || "").trim();
  const mode = String(p.mode || "reverse").trim().toLowerCase() === "dial" ? "dial" : "reverse";
  const boxToken = String(p.box_token || p.boxToken || "").trim();
  const clientToken = String(p.client_token || p.clientToken || "").trim();
  const endpoint = String(p.endpoint || "").trim();
  const localEndpoint = String(p.local_endpoint || p.localEndpoint || "").trim();
  return { host, port, boxId, mode, boxToken, clientToken, endpoint, localEndpoint };
}

/**
 * 保存设置。返回 `{ok, view}` 或 `{ok:false, reason, view}`。
 * 失败时把当前视图一起带上，UI 不用再发一次 IPC 才知道显示什么。
 */
function saveRelaySettings(opts) {
  const o = optsOf(opts);
  const p = parsePatch(opts && opts.patch);
  const current = relaySecrets.loadRelayConfigSecure(o);
  const boxToken = p.boxToken || (current ? current.boxToken : "");
  const clientToken = p.clientToken || (current ? current.clientToken : "");

  const view = () => readRelaySettings(o);
  if (!p.host) return { ok: false, reason: "missing_host", view: view() };
  if (!Number.isInteger(p.port) || p.port <= 0 || p.port > 65535) {
    return { ok: false, reason: "bad_port", view: view() };
  }
  if (!p.boxId) return { ok: false, reason: "missing_box_id", view: view() };
  if (!boxToken || !clientToken) {
    return { ok: false, reason: "missing_token", view: view() };
  }

  const cfg = {
    host: p.host,
    port: p.port,
    box_id: p.boxId,
    box_token: boxToken,
    client_token: clientToken,
    mode: p.mode,
  };
  if (p.endpoint) cfg.endpoint = p.endpoint;
  if (p.localEndpoint) cfg.local_endpoint = p.localEndpoint;

  const written = relaySecrets.writeRelayConfigSecure(Object.assign({}, o, { cfg }));
  if (!written.ok) return { ok: false, reason: written.reason, view: view() };
  return { ok: true, view: view() };
}

/** 关掉中转：写 enabled:false（不删文件，方便以后改回来）。 */
function disableRelaySettings(opts) {
  const o = optsOf(opts);
  const file = o.file || relayConfig.defaultRelayConfigPath(o.repoRoot);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ enabled: false }, null, 2) + "\n", {
      mode: relaySecrets.SECURE_MODE,
    });
    try {
      fs.chmodSync(file, relaySecrets.SECURE_MODE);
    } catch (_) { /* 非 POSIX 尽力而为 */ }
  } catch (e) {
    return { ok: false, reason: "write_failed", error: String((e && e.message) || e), view: readRelaySettings(o) };
  }
  return { ok: true, view: readRelaySettings(o) };
}

module.exports = { readRelaySettings, saveRelaySettings, disableRelaySettings, mask };
