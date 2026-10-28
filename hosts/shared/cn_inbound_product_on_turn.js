"use strict";

/**
 * Product onTurn for CN inbound / mobile /v1/turn.
 * Uses the same MoonBit + Host FFI path as Desktop (never tunnel-echo).
 */

const path = require("path");
const fs = require("fs");
const { createTurnRunner } = require("./run_moon_turn");
const { machineIdForInbound } = require("./machine_identity");

function loadEnvLocal(repoRoot) {
  const candidates = [
    path.join(repoRoot, "hosts/desktop/.env.local"),
    path.join(repoRoot, ".env.local"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq <= 0) continue;
        const k = t.slice(0, eq).trim();
        let v = t.slice(eq + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (k && process.env[k] === undefined) process.env[k] = v;
      }
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * 内核注册表里只有三台机器：desk-1 / phone-ios / phone-android
 * （box_host/machines.mbt:87 seed()）。远端机器 id 必须是这三个之一，
 * 否则内核会把这次回合挂到一台**不存在**的设备上：device tools 返回 0 个工具、
 * run_on_machine 报 unknown machine，手机上「拍照 / 麦克风」全都没有落点。
 */
function seedMachineId(machineKind) {
  if (machineKind === "android") return "phone-android";
  if (machineKind === "ios") return "phone-ios";
  return "desk-1";
}

/**
 * @param {string} repoRoot
 * @returns {(prompt: string, meta?: object) => Promise<object>}
 */
function createProductOnTurn(repoRoot) {
  const root = path.resolve(repoRoot || process.cwd());
  loadEnvLocal(root);
  const runner = createTurnRunner(root);

  return async function productOnTurn(prompt, meta) {
    const channel = (meta && meta.channel) || "in";
    const machineKind =
      (meta && meta.machine_kind) ||
      (channel === "android" || channel === "ios" ? channel : "desktop");
    const sessionId =
      (meta && meta.session_id) || `cn-${channel}-${Date.now().toString(36)}`;
    const useChannel =
      channel === "android" || channel === "ios" || channel === "in"
        ? ""
        : channel;
    return runner.runTurn(String(prompt || ""), {
      sessionId,
      // B-2 + B-4a:入站回合的机器身份是**那台设备的 id**。
      // 入站本来就必须出示设备凭证,所以「谁发来的」是确定的 ——
      // 不该再去信 payload 里自称的 machine_kind。
      machineId: machineIdForInbound({
        kind: machineKind,
        deviceId: (meta && meta.device_id) || "",
      }),
      machineKind,
      channel: useChannel,
      // ADR 0008: a remote/mobile turn is not a desktop Allow click.
      approved: false,
      // K-2/C-3: a mobile or remote inbound turn comes from a LIMITED
      // device — the person asking is not sitting at the machine. Read-only
      // tools still work; anything that reaches outward or changes state has
      // to be approved by whoever IS at the machine.
      deviceTrust: "limited",
      // Q-5: 渠道自带的投递 id(钉钉 msgId / 飞书 message_id)。
      // 平台重投同一条消息 ⇒ 同一个 id ⇒ 不重复执行;用户另发一条 ⇒ 新 id。
      messageId: String((meta && (meta.message_id || meta.msgId)) || ""),
    });
  };
}

module.exports = { createProductOnTurn, loadEnvLocal, seedMachineId };
