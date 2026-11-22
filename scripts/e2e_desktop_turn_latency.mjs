/* e2e_desktop_turn_latency.mjs — KP-04「连发三条、数字各不相同且可核对」的真机可感面
 *
 * 真 Electron + 真私聊发送 + 本地流式 stub。三条消息各带 [[lat:300/600/900]] 标记，
 * stub 精确按此挂起首字节 → Host 在首个 delta 打 first_token_at_ms。回合收尾把
 * {enter,composed,first,accepted} 落 data/latency/<今天>.jsonl。断言读的就是这三份
 * **真记录**：三段延迟非零、按已知下限对得上、三条互不相同、能用 turn_id 从日志反查。
 *
 * 公式/派生绝不在这里重算——全程用唯一模块 turn_latency.js 的 spans/format/measure/
 * coverageOk/findByTurnId（与 prove_turn_latency.mjs、measure 脚本同一份）。
 *
 * 缺 electron / 无显示 / 缺 moon 时诚实 SKIP（exit 0），SKIP ≠ PASS。
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { execSync } from "child_process";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, hasDisplay } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const req = createRequire(import.meta.url);
const T = req(path.join(REPO, "hosts/shared/turn_latency.js"));
const { _electron } = createRequire(path.join(DESKTOP, "package.json"))("playwright-core");
const ELECTRON = resolveElectronBinary(DESKTOP);
const UD = electronUserDataDir("turn-latency");
/* 数据根隔离（2026-11-22 补）：这扇门以前**直接在仓库真 data/ 上跑** ——
 * 应用没设 BITBOT_DATA_ROOT，于是 Host 与内核都写真目录；门再从真目录读 latency 记录，
 * 所以它"跑得通"，代价是用户的数据目录被门禁反复写。
 * 现在：种子拷到 <tmp根>/data，应用与门都走这一份。
 * 形状必须是 <根>/data —— 内核 cwd = dirname(DATA_ROOT)（host_ffi.js:183），
 * 内核按 cwd 相对写 `data/...` ⇒ 这样内核那一半与 Host 那一半才落在同一处。 */
const GATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-e2e-latency-"));
const GATE_DATA = path.join(GATE_ROOT, "data");
fs.mkdirSync(GATE_DATA, { recursive: true });
try { fs.symlinkSync(path.join(REPO, "cmd"), path.join(GATE_ROOT, "cmd"), "dir"); } catch { /* 已在或不存在 */ }
process.on("exit", () => { try { fs.rmSync(GATE_ROOT, { recursive: true, force: true }); } catch { /* 收尾失败不改判据 */ } });
(function copyTree(src, dst) {
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src)) copyTree(path.join(src, e), path.join(dst, e)); }
  else { fs.mkdirSync(path.dirname(dst), { recursive: true }); try { fs.copyFileSync(src, dst); } catch { /* 大文件/占用 ⇒ 跳过 */ } }
})(path.join(REPO, "data"), GATE_DATA);
const DATA = path.join(GATE_DATA, "desktop");
const BOTS = path.join(DATA, "bots.json");
const LAT_DIR = path.join(GATE_DATA, "latency");
const BOT_NAME = "KP04计时Bot";
const STUB_PORT = Number(process.env.KP04_STUB_PORT || 8817);
// 三条消息的**已知**首字下限（ms）：彼此相隔 300ms，ms 抖动不可能把它们撞成相等。
const FLOORS = [300, 600, 900];

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 400))); };
const note = (m) => console.log("  · " + m);

function honestSkip(reason) {
  console.log("e2e_desktop_turn_latency: SKIP — " + reason);
  console.log("e2e_desktop_turn_latency: PASS=0 FAIL=0 SKIP=1（SKIP ≠ PASS）");
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
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }

/* ---- 数据隔离：只清本轮 KP04 夹具，latency 快照后还原，不给用户留痕 ------------ */
function sweepFixtures() {
  try {
    const b = readJson(BOTS);
    if (b && Array.isArray(b.bots)) {
      const keep = b.bots.filter((x) => !String(x.name || "").startsWith("KP04"));
      if (keep.length !== b.bots.length) { b.bots = keep; fs.writeFileSync(BOTS, JSON.stringify(b, null, 2)); }
    }
  } catch { /* ignore */ }
}
const dayFile = () => path.join(LAT_DIR, T.dayKey(Date.now()) + ".jsonl");
const snapBytes = fs.existsSync(dayFile()) ? fs.readFileSync(dayFile()) : null;
const beforeIds = new Set(T.readRecords(GATE_DATA, {}).map((r) => r.turn_id));
function restore() {
  try {
    const p = dayFile();
    if (snapBytes === null) { if (fs.existsSync(p)) fs.unlinkSync(p); }
    else fs.writeFileSync(p, snapBytes);
  } catch { /* ignore */ }
  try {
    const b = readJson(BOTS);
    if (b && Array.isArray(b.bots)) {
      const keep = b.bots.filter((x) => !String(x.name || "").startsWith("KP04"));
      if (keep.length !== b.bots.length) b.bots = keep;
      fs.writeFileSync(BOTS, JSON.stringify(b, null, 2));
    }
  } catch { /* ignore */ }
}
process.on("exit", restore);

function startStub() {
  const proc = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BITBOT_STUB_PORT: String(STUB_PORT), BITBOT_STUB_LATENCY_FROM_TEXT: "1" },
  });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout")), 10000);
    proc.stdout.on("data", (d) => { if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(proc); } });
    proc.stderr.on("data", (d) => note("[stub] " + String(d).trim().slice(0, 160)));
    proc.on("error", rej);
  });
}

let stub = null, app = null, win = null;
async function quitApp() {
  if (!app) return;
  try {
    await app.evaluate(({ app: a }) => { a.isQuiting = true; a.quit(); });
    await Promise.race([app.close(), sleep(15000)]);
  } catch { /* ignore */ }
  app = null; win = null;
  if (stub) { try { stub.kill(); } catch { /* ignore */ } stub = null; }
}

const launchEnv = electronLaunchEnv({
  DISPLAY: process.env.DISPLAY || "",
  PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
  MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
  BITBOT_REPO_ROOT: REPO,
  // 应用与门读同一份隔离数据 —— 仓库真 data/ 一个字节都不碰。
  BITBOT_DATA_ROOT: GATE_DATA,
  BITBOT_NO_SECRET_SYNC: "1",
  BITBOT_DESKTOP_AUTOSTART: "0",
  // 真流式：默认开（wantStream 只要 != "0"），让首个 delta 触发 first_token 打点。
  BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
  BITBOT_LLM_API_KEY: "kp04-stub-key",
  BITBOT_LLM_MODEL: "kp04-stub",
});

try {
  sweepFixtures();
  stub = await startStub();
  ok("P1 stub 起来（首字延迟由 [[lat:NNN]] 精确控制）");

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

  // 建 Bot + 进私聊
  await win.evaluate(() => { const s = document.getElementById("sb-bots-rooms"); if (s) s.classList.remove("collapsed"); });
  await win.click("#sess-new", { timeout: 20000 });
  await win.waitForSelector("#bot-edit-modal #bc-name", { state: "visible", timeout: 20000 });
  await win.fill("#bc-name", BOT_NAME);
  await win.fill("#bc-job", "占位");
  await win.fill("#bc-desc", "KP-04 计时验收");
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
  botId ? ok("P2 建 Bot + 进入私聊（id=" + botId + "）") : bad("P2 没建出 Bot，进不了私聊");

  // 连发三条：每条带一个已知首字下限，等上一条落库（新 turn_id 出现）再发下一条
  const sendOne = async (markerText) => {
    await win.evaluate((txt) => {
      const inp = document.getElementById("text");
      inp.value = txt;
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }, markerText);
    await win.click("#send", { timeout: 20000 });
  };
  const sendEnabled = () => win.evaluate(() => {
    const x = document.getElementById("send");
    return Boolean(x && !x.disabled);
  });

  const newRecords = () =>
    T.readRecords(GATE_DATA, { limit: 200 }).filter((r) => !beforeIds.has(r.turn_id));

  for (let i = 0; i < FLOORS.length; i++) {
    const prevCount = newRecords().length;
    await waitUntil(sendEnabled, 120000);
    await sendOne(`计时验收 第${i + 1}条 [[lat:${FLOORS[i]}]] 请原样回一句`);
    const appeared = await waitUntil(async () => newRecords().length > prevCount, 90000, 500);
    if (!appeared) { bad(`P3.${i + 1} 第${i + 1}条发出后没落计时记录（回合没闭环或打点没接上）`); break; }
  }

  const recs = newRecords();
  if (recs.length >= FLOORS.length) ok(`P3 连发 ${FLOORS.length} 条，落库 ${recs.length} 条计时记录（三条都闭环）`);
  else bad(`P3 落库记录不足`, { need: FLOORS.length, got: recs.length });

  // P4 覆盖面：三条都要量到「发送→首字」（用唯一模块的 coverageOk，不在这里重算）
  const cov = T.coverageOk(recs, { minSamples: 3, minSendToFirst: 3 });
  cov.ok ? ok("P4 覆盖面：≥3 条样本且每条都量到首字延迟（coverageOk，非写死）")
         : bad("P4 覆盖面不足", JSON.stringify(cov.why));

  // P5 已知下限对得上 + 三条各不相同：升序后 [a,b,c] 必须 a>=300,b>=600,c>=900 且互不相等
  const vals = recs.map((r) => T.spans(r).send_to_first).filter((v) => v !== null).sort((x, y) => x - y);
  const distinct = new Set(vals).size;
  const floorOk = vals.length >= 3 && vals[0] >= FLOORS[0] && vals[1] >= FLOORS[1] && vals[2] >= FLOORS[2];
  if (floorOk && distinct >= 3) ok("P5 「发送→首字」逐条 ≥ 各自下限，且三条互不相同（连发三条各不相同且可核对）\n      " + vals.slice(0, 3).join(" / ") + " ms");
  else bad("P5 首字延迟对不上已知下限或没各不相同", { vals: vals.slice(0, 6), distinct, FLOORS });

  // P6 反查 + 时间线自洽：任取一条，用 turn_id 从日志找回，enter/accepted 都 >0 且不乱序
  const probe = recs[recs.length - 1];
  const found = T.findByTurnId(recs, probe.turn_id);
  const order = T.validateOrder(probe);
  if (found && found.turn_id === probe.turn_id && probe.enter_epoch_ms > 0 && probe.accepted_at_ms > 0 && order.ok) {
    ok("P6 从日志按 turn_id 反查得到该回合；enter/accepted 均非零、时间线自洽（可感面那一行：\n      " + T.format(found) + "）");
  } else {
    bad("P6 反查/自洽不过", { found: !!found, enter: probe.enter_epoch_ms, accepted: probe.accepted_at_ms, problems: order.problems });
  }

  // P7 渲染层确实传了 enter_epoch_ms：否则回车→发送 段为 null，屏幕显示「—」
  const enterSpanMeasured = recs.some((r) => T.spans(r).enter_to_send !== null);
  enterSpanMeasured ? ok("P7 「回车→发送」量到（渲染层 enter_epoch_ms 确实随回合传到 Host）")
                    : bad("P7 「回车→发送」全为 null —— 渲染层没接 enter_epoch_ms");
} catch (e) {
  bad("e2e 异常", (e && e.stack) || e);
} finally {
  await quitApp();
  restore();
}

console.log("\ne2e_desktop_turn_latency: PASS=" + PASS + " FAIL=" + FAIL);
process.exit(FAIL ? 1 : 0);
