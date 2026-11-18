"use strict";

/**
 * 出站回合:把一个回合派到**另一台机器**上跑。
 *
 * 现场推演(真实用户旅程,不是假设):
 *   用户有两台机器:桌上那台,和一台常开的 Box。Box 上有它自己的 Bot。
 *   用户说「让 Box 那边的 Bot 顺手把今天的热点收一下」。
 *   —— 今天这句话**没有任何代码路径能落地**:
 *     · Box 那边**收端是齐的**(`POST /v1/turn`,设备密钥鉴权,ADR 0008);
 *     · 缺的只是**发端**:JS 侧只有验签(`device_keys.verifyDeviceTurn`),
 *       发签名只在 Android 的 Kotlin 侧有(DeviceIdentity.requestHeaders);
 *     · 也没有"这台机器的地址在哪"的登记处。
 *   ⇒ 一台机器能**被**别的机器使唤,但**使唤不了**别的机器:方向是通的,反的没有。
 *
 * 这里补的是**反的那一半**,而且只做这一半:
 *   1. 机器地址登记:data/host/machines.json(机器 id → 地址 + 凭证文件)。
 *   2. 带设备签名的 POST /v1/turn。
 *   3. 回包如实带回来(成功/失败都带,失败不编)。
 *
 * 边界:
 *   · **对外动作**仍在目标机器那侧走它自己的审批闸 —— 这条路只负责
 *     "把话递过去",不负责替目标机器点头。
 *   · 目标机器不可达/没凭证 ⇒ 如实报错,不假装派过了。
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const deviceKeys = require("./device_keys");

/* 机器登记表。放在 data/host/machines.json:
 *   { "machines": [ { "id": "box-1", "name": "云端 Box", "kind": "box-local",
 *                      "url": "http://192.168.1.10:18765",
 *                      "credential": "data/host/credentials/box-1.credential.json" } ] }
 * 没有登记 ⇒ 没有出站。地址写错 ⇒ 目标机器自己会拒(不是这里编地址)。 */
function loadMachines(dataRoot) {
  const p = path.join(dataRoot, "host", "machines.json");
  try {
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.machines || [];
    return Array.isArray(list) ? list.filter((m) => m && m.id && m.url) : [];
  } catch (_) {
    // 读不出来就当"没登记" —— 不猜地址。
    return [];
  }
}

function machineById(dataRoot, id) {
  const want = String(id || "").trim();
  if (!want) return null;
  return loadMachines(dataRoot).find((m) => m && String(m.id) === want) || null;
}

/** 读机器的设备凭证(私钥在这一刻从磁盘上来)。 */
function loadMachineCredential(dataRoot, machine) {
  const rel = String((machine && machine.credential) || "").trim();
  if (!rel) return null;
  // 凭证路径登记为**相对 dataRoot**(机器登记表就住在 data/host/ 下)。
  const p = path.isAbsolute(rel) ? rel : path.join(dataRoot, rel);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || !raw.id || !raw.private_key_pem) return null;
    return raw;
  } catch (_) {
    return null;
  }
}

/**
 * 派一个回合到另一台机器。
 *
 * @param {object} o
 *   dataRoot   必填。机器登记与凭证都在它底下。
 *   machineId  必填。登记里的机器 id。
 *   text       必填。要递过去的话。
 *   sessionId  可选。目标机器上的会话 id(不给则目标机器自己生成)。
 *   machineKind 可选。告诉目标机器"来的是哪种设备"(android/ios/desktop…)。
 *   timeoutMs  可选。默认 120s —— 目标机器要真的跑一个内核回合,不会很快。
 * @returns {Promise<object>} { ok, error?, messages?, host_results?, stdout?, device_id? }
 */
async function sendRemoteTurn(o) {
  const opts = o || {};
  const dataRoot = String(opts.dataRoot || "");
  const text = String(opts.text || "").trim();
  if (!dataRoot) return { ok: false, error: "remote_turn_no_data_root" };
  if (!text) return { ok: false, error: "remote_turn_empty_text" };

  const machine = machineById(dataRoot, opts.machineId);
  if (!machine) {
    return {
      ok: false,
      error: "remote_turn_machine_not_registered",
      machine_id: String(opts.machineId || ""),
      hint: "在 data/host/machines.json 里登记这台机器的 id 与地址",
    };
  }
  const cred = loadMachineCredential(dataRoot, machine);
  if (!cred) {
    return {
      ok: false,
      error: "remote_turn_no_credential",
      machine_id: machine.id,
      hint: "这台机器没有可用的设备凭证(脚本 scripts/device-keys.js init)",
    };
  }

  const body = JSON.stringify({
    text,
    session_id: String(opts.sessionId || ""),
    machine_kind: String(opts.machineKind || "desktop"),
  });
  const headers = deviceKeys.signRequest(cred, body);
  if (!headers) {
    return { ok: false, error: "remote_turn_no_credential", machine_id: machine.id };
  }

  let u;
  try {
    u = new URL(String(machine.url));
  } catch (_) {
    return {
      ok: false,
      error: "remote_turn_bad_url",
      machine_id: machine.id,
      url: String(machine.url || ""),
    };
  }
  const target = new URL("/v1/turn", u);
  const lib = target.protocol === "https:" ? https : http;
  const timeoutMs = Number(opts.timeoutMs || 120000);

  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: target.pathname + target.search,
        method: "POST",
        headers: Object.assign(
          {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
          headers,
        ),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let payload = null;
          try {
            payload = JSON.parse(raw);
          } catch (_) {
            payload = null;
          }
          if (!payload) {
            // 目标机器回的不是 JSON —— 如实说,别把一段 HTML 当成"派成功了"。
            done({
              ok: false,
              error: "remote_turn_bad_response",
              machine_id: machine.id,
              http_status: res.statusCode,
              body_prefix: raw.slice(0, 200),
            });
            return;
          }
          done({
            ok: res.statusCode === 200 && payload.ok === true,
            machine_id: machine.id,
            http_status: res.statusCode,
            error: payload.error || (res.statusCode === 200 ? "" : "remote_turn_http_" + res.statusCode),
            messages: payload.messages || [],
            host_results: payload.host_results || [],
            stdout: payload.stdout || "",
            device_id: payload.device_id || "",
            remote_brain: payload.brain || "",
          });
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("remote_turn_timeout"));
    });
    req.on("error", (e) => {
      done({
        ok: false,
        error: "remote_turn_unreachable",
        machine_id: machine.id,
        url: String(machine.url || ""),
        detail: String((e && e.message) || e),
      });
    });
    req.write(body);
    req.end();
  });
}

module.exports = {
  loadMachines,
  machineById,
  loadMachineCredential,
  sendRemoteTurn,
};
