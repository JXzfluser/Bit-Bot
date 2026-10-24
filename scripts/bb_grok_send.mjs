// G-28 真机验证：启动真实 Bit Bot 桌面端，选一个 bot 开 DM，发一条消息，
// 等真实 LLM 回复流（带 .msg-grok-head 头像+名），截主聊天流。
// 真实数据（BITBOT_REPO_ROOT=REPO，读 hosts/desktop/.env.local 里的真 key），
// 临时 user-data-dir 避免单例锁，NO_SECRET_SYNC 避免 stub 顶掉真 key。
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const mainJs = path.join(DESKTOP, "main.js");
const ELECTRON = resolveElectronBinary(DESKTOP);

const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const ud = electronUserDataDir("grok-send");
const env = electronLaunchEnv(gateAppEnv(REPO, { BITBOT_NO_SECRET_SYNC: "1" }));

const PROMPT = process.env.GROK_PROMPT || "用一句话介绍你自己。";

const app = await _electron.launch({
  executablePath: ELECTRON,
  args: [mainJs, "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
  cwd: REPO,
  env,
});

const win = await app.firstWindow();
await win.waitForLoadState("domcontentloaded").catch(() => {});
await win.waitForSelector("#log", { timeout: 20000 }).catch(() => {});
await win.waitForTimeout(2000);

// 选第一个 bot 开 DM（没有就退回默认会话直接发）。
const botRow = win.locator(".sess-row[data-agent-id]").first();
if (await botRow.count()) {
  await botRow.click().catch(() => {});
  await win.waitForTimeout(1500);
}

// 输入并发送
await win.fill("#text", PROMPT).catch(() => {});
await win.click("#send").catch(() => {});
console.log("sent:", PROMPT);

// 等真实回复的头像+名出现（最多 90s）。出现说明真 key 通、G-28 头生效。
let sawHead = false;
try {
  await win.waitForSelector(".msg.assistant .msg-grok-head", { timeout: 90000 });
  sawHead = true;
} catch (_) {}
// 再等一会儿让正文流式完成
await win.waitForTimeout(4000);

const log = win.locator("#log");
if (await log.count()) await log.screenshot({ path: "/tmp/grok_live.png" }).catch(() => {});
await win.screenshot({ path: "/tmp/grok_live_window.png" }).catch(() => {});

// 抓完整 #log 文本，便于判断是真实回复还是报错 / 路由错
const lastText = await win.evaluate(() => {
  const log = document.getElementById("log");
  return log ? log.innerText.slice(0, 3000) : "";
}).catch(() => "");

console.log("sawHead=", sawHead);
console.log("=== #log full text ===");
console.log(lastText);
fs.rmSync(ud, { recursive: true, force: true });
process.exit(0);
