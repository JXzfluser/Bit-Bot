#!/usr/bin/env node
"use strict";

/**
 * remote-turn —— 把一个回合派到**另一台机器**上跑。
 *
 *   node scripts/remote-turn.js --machine box-1 --text "今天的 AI 科技热点收一下"
 *   node scripts/remote-turn.js --machine box-1 --text "..." --session rt-1
 *
 * 机器登记在 data/host/machines.json:
 *   { "machines": [ { "id": "box-1", "name": "云端 Box",
 *                      "url": "http://192.168.1.10:18765",
 *                      "credential": "host/credentials/box-1.credential.json" } ] }
 *
 * 鉴权用**设备密钥**(B-4a):凭证文件里有私钥,签名之后目标机器用公钥验。
 * 账号 = 设备密钥,没有别的身份。
 *
 * 边界:这条命令只负责"把话递过去"。**对外动作**(发邮件/发文/下单)仍然在
 * **目标机器那侧**走它自己的审批闸 —— 这里不替目标机器点头。
 *
 * 失败一律如实报(退出码非 0),不假装派过了。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const remoteTurn = require(path.join(ROOT, "hosts/shared/remote_turn"));

function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0 || i + 1 >= process.argv.length) return dflt;
  return String(process.argv[i + 1]);
}
function has(name) {
  return process.argv.indexOf("--" + name) >= 0;
}

const dataRoot = arg("data-root", process.env.BITBOT_DATA_ROOT || path.join(ROOT, "data"));
const machineId = arg("machine", process.env.BITBOT_REMOTE_MACHINE || "");
const text = arg("text", process.env.BITBOT_REMOTE_TEXT || "");
const sessionId = arg("session", "");
const machineKind = arg("kind", "desktop");

if (has("list")) {
  const machines = remoteTurn.loadMachines(dataRoot);
  if (!machines.length) {
    console.error("没有登记任何机器(数据根:" + dataRoot + ")");
    console.error("在 data/host/machines.json 里登记 id / url / credential。");
    process.exit(2);
  }
  console.log("登记的机器(" + machines.length + " 台):\n");
  for (const m of machines) {
    console.log("  id:        " + m.id);
    console.log("  名字:      " + (m.name || ""));
    console.log("  地址:      " + m.url);
    console.log("  凭证:      " + (m.credential || "(无)"));
    console.log("  → 派一个回合: node scripts/remote-turn.js --machine " + m.id + ' --text "..."');
    console.log("");
  }
  process.exit(0);
}

if (!machineId || !text) {
  console.error(
    "用法:node scripts/remote-turn.js --machine <id> --text <要递过去的话>\n" +
      "      node scripts/remote-turn.js --list",
  );
  process.exit(2);
}

remoteTurn
  .sendRemoteTurn({ dataRoot, machineId, text, sessionId, machineKind })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    if (!r || r.ok !== true) {
      console.error("\n没派成功:" + String((r && r.error) || "unknown"));
      if (r && r.hint) console.error("  → " + r.hint);
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error("remote-turn: " + String((e && e.message) || e));
    process.exit(1);
  });
