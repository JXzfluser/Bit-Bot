/* e2e_desktop_failure_code.mjs — KP-03「清空 key 后发一条消息」的界面可感面
 *
 * 真 Electron、真私聊发送。用 BITBOT_MOBILE_HOST=1 让 resolveLlmConfig 走到
 * 「本机不持有模型 key」这条真实产品分支（host_ffi.js:5353，api_key 无条件为 ""），
 * 于是 executeLlmChat 触发未配置守卫，Host 直接发出一条带 error_code 的流式失败，
 * 渲染层经唯一码表显示 canonical code —— 全程不碰用户的真 key、不发网络。
 *
 * 钉的是**下游渲染**：Host→IPC→onLlmStream→sendFailureText→normalizeFailure→i18n→DOM。
 * 「Host 确实产出 error_code、码来自 wire 不是写死」由 prove_failure_codes.js 的
 * N1/N2/N3 与 approve.js 的垃圾 artifact→unknown_failure 反向对照负责（同一份表）。
 *
 * 缺 electron / 无显示 / 缺 moon 时诚实 SKIP（exit 0），SKIP ≠ PASS。
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, hasDisplay } from "./electron_env.mjs";

const UD = electronUserDataDir("failure-code");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
// playwright-core 装在 hosts/desktop 下，用它自己的 package.json 当解析根。
const { _electron } = createRequire(path.join(DESKTOP, "package.json"))("playwright-core");
const ELECTRON = resolveElectronBinary(DESKTOP);
const DATA = path.join(REPO, "data/desktop");
const ROOMS = path.join(DATA, "rooms.json");
const SESSIONS = path.join(DATA, "sessions.json");
const BOTS = path.join(DATA, "bots.json");
const LLM_TURNS = path.join(REPO, "data/llm/turns");
const BOT_NAME = "KP03未配置Bot";

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 400))); };

function honestSkip(reason) {
  console.log("e2e_desktop_failure_code: SKIP — " + reason);
  console.log("e2e_desktop_failure_code: PASS=0 FAIL=0 SKIP=1（SKIP ≠ PASS）");
  process.exit(0);
}
if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing (" + ELECTRON + ")");
if (!hasDisplay()) honestSkip("no DISPLAY and no xvfb-run");
let moonOk = false;
try { execSync("moon --version", { stdio: "ignore" }); moonOk = true; }
catch { try { execSync((process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon")) + " --version", { stdio: "ignore" }); moonOk = true; } catch { moonOk = false; } }
if (!moonOk) honestSkip("moon toolchain missing (kernel cannot boot)");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeoutMs, stepMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(stepMs || 400);
  }
  return false;
}

/* ---- 数据根隔离：真 root（内核可靠开机），只清本轮 KP03 夹具并快照还原 ---------- */
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function sweepFixtures() {
  try {
    const b = readJson(BOTS);
    if (b && Array.isArray(b.bots)) {
      const keep = b.bots.filter((x) => !String(x.name || "").startsWith("KP03"));
      if (keep.length !== b.bots.length) { b.bots = keep; fs.writeFileSync(BOTS, JSON.stringify(b, null, 2)); }
    }
  } catch { /* ignore */ }
}
const turnsBefore = new Set(fs.existsSync(LLM_TURNS) ? fs.readdirSync(LLM_TURNS) : []);

const snap = {
  rooms: fs.existsSync(ROOMS) ? fs.readFileSync(ROOMS) : null,
  sessions: fs.existsSync(SESSIONS) ? fs.readFileSync(SESSIONS) : null,
  bots: fs.existsSync(BOTS) ? fs.readFileSync(BOTS) : null,
};
function restore() {
  for (const [p, buf] of [[ROOMS, snap.rooms], [SESSIONS, snap.sessions], [BOTS, snap.bots]]) {
    try { if (buf === null) { if (fs.existsSync(p)) fs.unlinkSync(p); } else fs.writeFileSync(p, buf); } catch { /* ignore */ }
  }
  // 清掉本轮发送新产生的失败 artifact（未配置守卫也会落 artifact），不留给用户
  try {
    if (fs.existsSync(LLM_TURNS)) {
      for (const f of fs.readdirSync(LLM_TURNS)) if (!turnsBefore.has(f)) fs.unlinkSync(path.join(LLM_TURNS, f));
    }
  } catch { /* ignore */ }
}
process.on("exit", restore);

let app = null, win = null;
async function quitApp() {
  if (!app) return;
  try {
    await app.evaluate(({ app: a }) => { a.isQuiting = true; a.quit(); });
    await Promise.race([app.close(), sleep(15000)]);
  } catch { /* ignore */ }
  app = null; win = null;
}

const launchEnv = electronLaunchEnv({
  DISPLAY: process.env.DISPLAY || "",
  PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
  MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
  BITBOT_REPO_ROOT: REPO,
  BITBOT_NO_SECRET_SYNC: "1",
  BITBOT_DESKTOP_AUTOSTART: "0",
  // KP-03：走真实「本机不持有 key」分支，强制 api_key=""，不发网络、不碰用户 key。
  BITBOT_MOBILE_HOST: "1",
});

try {
  sweepFixtures();
  app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
    cwd: REPO,
    env: launchEnv,
    timeout: 120000,
  });
  win = await app.firstWindow({ timeout: 60000 });
  await win.waitForSelector("#composer #text", { timeout: 60000 });
  await win.setViewportSize({ width: 1280, height: 800 });
  ok("P1 真 Electron 起来、composer 就绪（mobileHost=1 强制未配置 key）");

  const ls = await win.evaluate(async () => (window.bitbot && window.bitbot.llmStatus) ? await window.bitbot.llmStatus() : null);
  if (ls && ls.key_configured === false) ok("P2 llmStatus.key_configured=false —— 未配置态是真的，不是环境变量噪声");
  else bad("P2 key_configured 不是 false", JSON.stringify(ls));

  // UI 建一个 Bot，点进私聊
  await win.evaluate(() => { const s = document.getElementById("sb-bots-rooms"); if (s) s.classList.remove("collapsed"); });
  await win.click("#sess-new", { timeout: 20000 });
  await win.waitForSelector("#bot-edit-modal #bc-name", { state: "visible", timeout: 20000 });
  await win.fill("#bc-name", BOT_NAME);
  await win.fill("#bc-job", "占位");
  await win.fill("#bc-desc", "KP-03 未配置态验收");
  await win.click("#bc-create", { timeout: 20000 });
  const botId = await waitUntil(() => win.evaluate((nm) => {
    const row = Array.from(document.querySelectorAll("#bot-list .agent-item"))
      .find((el) => (((el.querySelector(".name") || {}).textContent || "")).includes(nm));
    return row ? row.dataset.agentId || "" : "";
  }, BOT_NAME), 60000);
  if (botId) {
    await win.evaluate(() => { const s = document.getElementById("sb-bots-rooms"); if (s) s.classList.remove("collapsed"); });
    await win.click('#bot-list .agent-item[data-agent-id="' + botId + '"]', { timeout: 20000 });
  }
  botId ? ok("P3 建 Bot + 进入私聊（id=" + botId + "）") : bad("P3 没建出 Bot，进不了私聊");

  // 真发一条消息：回车 → 内核回合 → executeLlmChat 未配置守卫 → 流式失败
  await waitUntil(async () => {
    const b = await win.evaluate(() => { const x = document.getElementById("send"); return Boolean(x && !x.disabled); });
    return b;
  }, 120000);
  await win.fill("#composer #text", "你好，随便说一句");
  await win.press("#composer #text", "Enter");

  const bubbleText = () => win.evaluate(() => {
    const box = document.getElementById("log");
    if (!box) return [];
    return Array.from(box.querySelectorAll(".msg"))
      .filter((el) => !el.classList.contains("debug-only"))
      .map((el) => el.innerText || "");
  });

  const found = await waitUntil(async () => {
    const rows = await bubbleText();
    return rows.find((t) => /provider_unconfigured/.test(t)) || null;
  }, 90000, 500);

  if (found) ok("P4 发送后屏幕上真的出现了一条带码的失败（渲染闭环跑通）");
  else bad("P4 发送后没有出现带 provider_unconfigured 的失败气泡（渲染闭环断了）");

  if (found) {
    const hasLabel = /未配置模型/.test(found);
    const hasAction = /去设置/.test(found);
    const hasCode = /provider_unconfigured/.test(found);
    if (hasLabel && hasAction && hasCode) ok("P5 失败文案 = 「未配置模型（provider_unconfigured），去设置」—— 三要素齐");
    else bad("P5 失败文案缺要素", JSON.stringify({ hasLabel, hasAction, hasCode, found }));
  }

  const rows = await bubbleText();
  const leaked = rows.filter((t) => /invalid JSON from MoonBit/.test(t) || /LLM:\s*当前供应商/.test(t) || /^LLM:\s/.test(t));
  if (leaked.length === 0) ok("P6 屏幕上不再有「invalid JSON…」/「LLM: 原文」这类裸自由文本");
  else bad("P6 仍有裸自由文本泄漏到产品面", JSON.stringify(leaked));
} catch (e) {
  bad("e2e 异常", (e && e.stack) || e);
} finally {
  await quitApp();
  restore();
}

console.log("\ne2e_desktop_failure_code: PASS=" + PASS + " FAIL=" + FAIL);
process.exit(FAIL ? 1 : 0);
