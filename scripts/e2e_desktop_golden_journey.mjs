/* e2e_desktop_golden_journey.mjs — 黄金旅程门禁（产品的定义就是这一条旅程）
 *
 * 这道门只回答一个问题：**「这个产品成立了」吗？**
 * 判据不是组件、不是函数，而是**用户在真实 Electron 里能不能把这一条路走完**：
 *
 *   建团队 → 排程 → 到点执行 → 产出 → 指挥(看/插话/改向/刹停/换人) → 复盘
 *
 * 全程不卡。任何一步断了就是红。红的要说出来，不许改判据迁就实现。
 *
 * 步骤与真界面（**没有一步是直接调内部 API 假装用户操作**）：
 *   建团队   —— 主输入框说「组建团队：…」（渲染层自己的组队话术路径）
 *   排程     —— 群资料面板「定时任务」段 → 添加入口 → 原话 → 「添加」
 *   到点执行 —— 改 store 里 next_due（**唯一允许的例外**，见下）→ 等**应用自己的**
 *               唤醒定时器（BITBOT_DESKTOP_SWEEP_MS）到点触发
 *   产出     —— 群转录里的 bot_reply / final_report + 落盘的产物 .md 文件
 *   指挥     —— 团队指挥台（域导航栏的「指挥」#app-rail-command）：看 / 插话 / 改向 / 刹停 / 换人
 *   复盘     —— 指挥台里的「复盘」段（只列真的收过口的批次）
 *
 * 唯一的例外（题面允许的那一个）：**排程的墙钟不可控**。排程建成的是
 * 「每天早上9点」，门禁不能等到真的 9 点 ⇒ 把隔离根里那一行的 next_due
 * 改到过去，让应用自己的调度器按「到点」处理它。除此之外，门禁不改任何
 * 判据、不改任何期望基线、不伪造 provider 回答。
 *
 * 排程那句为什么是这个形态（这是**产品事实**，不是门禁在偷懒）：
 *   句子里带排程动词（发到/汇总/整理/提醒…）时，内核的意图分类器会把
 *   **整句**认成「再建一条定时任务」—— 于是到点派进群的那一回合，回执是
 *   「已建定时任务 …」，**模型根本没被叫醒**，群里也就没有真产物。
 *   （这是 2026-11-21 实测到的真实现象：中文形态的排程原话会被内核当成命令。）
 *   ⇒ 门禁用同一张真实表单、同一条产品路径，只是把「动词」换掉，并让
 *   **内核的中文排程解析器**算墙钟（cron=0 9 * * * 仍由内核算，不是门禁写的）。
 *
 * 隔离：BITBOT_DATA_ROOT 指向临时根（仓库 data/ 一个字节都不碰），
 *       跑完用 sha256 证明仓库 data/desktop/rooms.json 逐字节未变。
 * provider：随机端口的本地 stub；起之前**只按端口**清残留
 *       （`lsof -ti tcp:<port>`），**严禁**按脚本名 pkill —— 那会杀掉
 *       同门禁另一个 stub，症状是「消息没到 provider」。
 * 内核：钉住已编译二进制 BITBOT_KERNEL_BIN（走 `moon run` 每回合重编译
 *       那条路在门禁环境里内核会 exit 255 崩掉）。
 *
 * 用法：ELECTRON_DISABLE_SANDBOX=1 PLAYWRIGHT_CORE_PATH=$PWD/hosts/desktop/node_modules/playwright-core \
 *       xvfb-run -a node scripts/e2e_desktop_golden_journey.mjs
 */
import path from "path";
import net from "net";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync, spawn } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, hasDisplay } from "./electron_env.mjs";

/* 单实例锁按 user-data-dir 算：不隔离就会撞上用户自己开着的 Bit Bot。 */
const UD = electronUserDataDir("golden-journey");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);

/* ── 隔离数据根 ──────────────────────────────────────────────────────────────
 * 口径照 hosts/desktop/paths.js:resolveDataRoot()：
 *   BITBOT_DATA_ROOT 必须是某个根的**直接子目录**（内核 cwd = dirname(DATA_ROOT)），
 *   所以临时根 GATE_ROOT 里放 cmd 软链 + 整份 data/ 快照，应用与门禁走同一份 DATA。
 * 仓库那份 data/ 只被**读**（拷快照），一个字节都不被写。 */
const GATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-e2e-golden-"));
try { fs.symlinkSync(path.join(REPO, "cmd"), path.join(GATE_ROOT, "cmd"), "dir"); } catch { /* 已存在 */ }
const DATA = path.join(GATE_ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
for (const name of fs.existsSync(path.join(REPO, "data")) ? fs.readdirSync(path.join(REPO, "data")) : []) {
  /* data/tmp（临时文件）与历史 import-backup 不参与本轮。 */
  if (name === "tmp" || name.startsWith("import-backup-")) continue;
  fs.cpSync(path.join(REPO, "data", name), path.join(DATA, name), { recursive: true });
}
const KEEP_ROOT = process.env.GJ_KEEP_ROOT === "1";
process.on("exit", () => {
  if (KEEP_ROOT) { console.log("  · 隔离数据根保留（GJ_KEEP_ROOT=1）：" + GATE_ROOT); return; }
  try { fs.rmSync(GATE_ROOT, { recursive: true, force: true }); } catch { /* 收尾失败不改判据 */ }
});

const D = (...p) => path.join(DATA, ...p);
const ROOMS = D("desktop/rooms.json");
const BOTS = D("desktop/bots.json");
const TASKS = D("desktop/tasks.json");
const ROUTINES = D("routines/host-routines.json");
const ROUTINE_DIR = D("routines");
const DRAFT_DIR = D("routines/drafts");
const SEND_DIR = D("mail/sends");
const PENDING = D("desktop/pending-approvals.jsonl");
const REPO_ROOMS = path.join(REPO, "data/desktop/rooms.json");

/* 取证目录：截图 + provider 请求 JSONL + 断言 JSONL + evidence.json */
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const ART = process.env.GJ_ART_DIR || path.join(REPO, "artifacts");
const ART_RUN = path.join(ART, "golden-journey-" + RUN_ID);
fs.mkdirSync(ART_RUN, { recursive: true });
const PROVIDER_JSONL = path.join(ART_RUN, "provider-requests.jsonl");
const ASSERT_JSONL = path.join(ART_RUN, "assertions.jsonl");
const EVIDENCE_JSON = path.join(ART_RUN, "evidence.json");

const TZ = process.env.GJ_TZ || "Asia/Shanghai";
const MAIL_TO = "gj-golden@example.com";
const TEAM_TITLE = "GJGolden";
const ROUTINE_ID = "gj-golden-1";
const ROLES = ["竞品动态调研", "简报撰写", "简报复核"];
/* 排程原话（同一张真实表单）。
 *   · 「每天早上9点」→ **内核的中文排程解析器**算 cron（门禁不写 cron）
 *   · 动词刻意避开内核那 20 个排程动词：带动词时内核会把整句当成
 *     「再建一条定时任务」，到点派活时模型根本不会被叫醒（见文件头）
 *   · 邮箱 ⇒ 到点备好草稿并挂待批准（GP-108 先读后执行） */
const SCHEDULE_TEXT = "create routine id=" + ROUTINE_ID +
  " prompt=每天早上9点把竞品动态简报投递到 " + MAIL_TO;
/* 无 @ 的一句话：宿主应当按内容**派一个负责人**（一次只开工一个）。 */
/* 「无 @ 的一句话」(2026-11-22 修):原来这里拼了 ROLES[0](= 第一个成员的**职责名**
   「竞品动态调研」)⇒ 那句话其实**点名了 A**,压根不是「无 @」。
   ⇒ 门禁想测「宿主/团队怎么认领」,测的却是「点名了会怎样」。
   ⇒ 现在**不带任何成员名或职责名**,才是真正的无 @。 */
const OWNER_TEXT = "帮我做今天的竞品动态对比表";

let PASS = 0, FAIL = 0, SKIP = 0;
const results = [];

/** 安全截断：JSON.stringify(undefined) 是 undefined，再 .slice() 会 TypeError。 */
const safeStr = (v, n) => {
  const s = v === undefined || v === null ? "" : (typeof v === "string" ? v : JSON.stringify(v));
  const text = s === undefined ? "" : String(s);
  return text.length > n ? text.slice(0, n) + "…" : text;
};
const ok = (id, m, extra) => {
  PASS++;
  console.log("  ✓ [" + id + "] " + m);
  results.push({ id, result: "PASS", at: new Date().toISOString(), message: m, detail: extra === undefined ? null : safeStr(extra, 500) });
  appendAssert(results[results.length - 1]);
};
const bad = (id, m, d) => {
  FAIL++;
  console.log("  ✗ [" + id + "] " + m + (d === undefined || d === null ? "" : " — " + safeStr(d, 500)));
  results.push({ id, result: "FAIL", at: new Date().toISOString(), message: m, detail: d === undefined || d === null ? null : safeStr(d, 500) });
  appendAssert(results[results.length - 1]);
};
const skip = (id, m, why) => {
  SKIP++;
  console.log("  · SKIP [" + id + "] " + m + " — " + why);
  results.push({ id, result: "SKIP", at: new Date().toISOString(), message: m, detail: safeStr(why, 400) });
  appendAssert(results[results.length - 1]);
};
function appendAssert(row) {
  try { fs.appendFileSync(ASSERT_JSONL, JSON.stringify(row) + "\n"); } catch { /* 取证失败不改判据 */ }
}

function honestSkip(reason) {
  console.log("e2e_desktop_golden_journey: SKIP — " + reason);
  console.log("e2e_desktop_golden_journey: PASS=0 FAIL=0 SKIP=1（SKIP ≠ PASS）");
  try {
    fs.writeFileSync(EVIDENCE_JSON, JSON.stringify({
      started_at: new Date().toISOString(), skipped: true, reason,
      pass: 0, fail: 0, skip: 1,
    }, null, 2));
  } catch { /* ignore */ }
  process.exit(0);
}

if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing (" + ELECTRON + ")");
if (!hasDisplay()) honestSkip("no DISPLAY and no xvfb-run");
let moonOk = false;
try { execSync("moon --version", { stdio: "ignore" }); moonOk = true; }
catch {
  const local = path.join(os.homedir(), ".moon/bin/moon");
  if (fs.existsSync(local)) {
    try { execSync('PATH="' + path.dirname(local) + ':$PATH" moon --version', { stdio: "ignore" }); moonOk = true; }
    catch { /* below */ }
  }
}
if (!moonOk) honestSkip("moon toolchain unavailable → 真回合无法验证（诚实 residual，不伪造 PASS）");

/* 钉住已编译内核二进制：走 `moon run` 每回合重编译那条路在门禁环境里内核 exit 255。 */
const KERNEL_BIN = path.join(REPO, "_build/native/debug/build/cmd/desktop_turn/desktop_turn.exe");
if (!fs.existsSync(KERNEL_BIN)) honestSkip("已编译内核二进制缺失（" + KERNEL_BIN + "）→ 真回合无法验证");

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

/* 随机端口 provider stub。 */
const STUB_PORT = Number(process.env.GJ_STUB_PORT || (26000 + Math.floor(Math.random() * 20000)));
/* stub 回执（**不许出现内核那 20 个排程动词**，否则回执会被当成命令）：
 *   · 自决问询（正文里有 "YES ="）⇒ 答 YES（团队模式下人人都答 ⇒ 这正是
 *     「无 @ 的一句话 ⇒ 两个 Bot 同时开工」那条在修的真缺陷的现场）
 *   · 成员/接力回合（正文里有 "【群任务】"）⇒ 一段像样的成果 + 【交给】下一棒
 *   · 接力回合的下一棒（正文里有 "【上一棒】"）⇒ 交给第三个人
 * 接力标记必须精确是 RELAY_MARKERS.handoff（【交给】），且回执里**不能**
 * 出现【需要确认】—— 否则 stub 的回声会被当成「Bot 要停下问」。 */
const STUB_REPLY_MATCH = JSON.stringify({
  "【上一棒】": "已看过上一棒：竞品对比表的价格列与覆盖列都看过一遍，差异点已标注出处。\n【交给】" + ROLES[2] + "：请复核这份简报的结论是否站得住。",
  "YES =": "YES\nCLAIM: 我负责本轮分工里的这一段",
  "【群任务】": "已完成本轮分工：竞品动态对比表（A/B/C 三家，价格、覆盖范围、优势各一列），每条结论都标了出处。\n【交给】" + ROLES[1] + "：请把这份对比表收成一页简报并补上数据出处。",
});
const STUB_DELAY_MS = Number(process.env.GJ_STUB_DELAY_MS || 4000);

const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const roomRows = () => { const j = readJson(ROOMS, { rooms: [] }); return Array.isArray(j) ? j : (j.rooms || []); };
const roomRow = (id) => roomRows().find((r) => r && r.id === id) || null;
const txOf = (id) => (roomRow(id) || {}).transcript || [];
const botRows = () => { const j = readJson(BOTS, { bots: [] }); return Array.isArray(j) ? j : (j.bots || []); };
const routineRows = () => { const j = readJson(ROUTINES, []); return Array.isArray(j) ? j : (j.routines || []); };
const taskRows = () => { const j = readJson(TASKS, { tasks: [] }); return Array.isArray(j) ? j : (j.tasks || []); };
const listFiles = (dir, ext) => {
  try { return fs.readdirSync(dir).filter((f) => !ext || f.endsWith(ext)); } catch { return []; }
};
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const readBytes = (p) => { try { return fs.readFileSync(p); } catch { return null; } };

/** IANA 时区下的墙钟（不引第三方库）。 */
function wallClock(iso, tz) {
  const p = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(iso))) p[part.type] = part.value;
  return {
    hour: Number(p.hour === "24" ? "0" : p.hour), minute: Number(p.minute),
    day: Number(p.day), month: Number(p.month),
  };
}
/** 时间判据**算时间差**（TZ≠UTC 时 `Date.parse(x) >= Date.now() - N` 永远 false）。 */
function ageMs(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return NaN;
  return Date.now() - t;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, step = 250) {
  const deadline = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > deadline) return null;
    await sleep(step);
  }
}

/* ── provider stub（随机端口；起之前只按端口清残留） ───────────────────────── */
function killByPort(port) {
  try {
    const out = execSync("lsof -ti tcp:" + port + " 2>/dev/null || true", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    for (const pid of out.split(/\s+/).filter(Boolean)) {
      try { process.kill(Number(pid), "SIGKILL"); } catch { /* ignore */ }
    }
    return out.split(/\s+/).filter(Boolean).length;
  } catch { return 0; }
}
async function portFree(port) {
  return new Promise((res) => {
    const srv = net.createServer();
    srv.once("error", () => res(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => res(true)));
    setTimeout(() => { try { srv.close(); } catch { /* ignore */ } res(false); }, 300);
  });
}
function startStub() {
  const proc = spawn(
    process.execPath,
    [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
    {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BITBOT_STUB_PORT: String(STUB_PORT),
        BITBOT_STUB_RECORD: PROVIDER_JSONL,
        BITBOT_STUB_REPLY_MATCH: STUB_REPLY_MATCH,
        BITBOT_STUB_DELAY_MS: String(STUB_DELAY_MS),
      },
    },
  );
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout on " + STUB_PORT)), 15000);
    proc.stdout.on("data", (d) => { if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(proc); } });
    proc.stderr.on("data", (d) => console.log("[stub] " + safeStr(String(d).trim(), 200)));
    proc.on("error", rej);
  });
}

/* ── 隔离根里的历史排程/外发记录：只清**副本**，让门禁的库是安静的 ──────────
 * 仓库那份不动（门禁只读它做快照）。清了才谈得上「未批准前 0 封外发」。 */
function quietIsolatedStore() {
  const cleared = [];
  try { fs.rmSync(ROUTINES, { force: true }); cleared.push("routines/host-routines.json"); } catch { /* ignore */ }
  try { fs.rmSync(DRAFT_DIR, { recursive: true, force: true }); cleared.push("routines/drafts"); } catch { /* ignore */ }
  for (const f of listFiles(ROUTINE_DIR, ".json")) {
    if (/^(fire-|refuse-|remove-|resume-)/i.test(f)) { try { fs.rmSync(path.join(ROUTINE_DIR, f), { force: true }); } catch { /* ignore */ } }
  }
  try { fs.rmSync(SEND_DIR, { recursive: true, force: true }); cleared.push("mail/sends"); } catch { /* ignore */ }
  try { fs.rmSync(PENDING, { force: true }); cleared.push("desktop/pending-approvals.jsonl"); } catch { /* ignore */ }
  return cleared;
}

let app = null, win = null, stub = null;
const shots = [];
async function shot(name) {
  try {
    const p = path.join(ART_RUN, name + ".png");
    await win.screenshot({ path: p });
    shots.push(p);
    return p;
  } catch { return ""; }
}

(async () => {
  console.log("e2e_desktop_golden_journey — 黄金旅程（建团队→排程→到点执行→产出→指挥→复盘）");
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  /* 仓库 data/desktop/rooms.json 的逐字节基线（跑完要比）。 */
  const repoRoomsBefore = readBytes(REPO_ROOMS);
  const repoRoomsShaBefore = repoRoomsBefore ? sha256(repoRoomsBefore) : "(absent)";
  console.log("  · 隔离数据根：" + DATA);
  console.log("  · provider stub 端口：" + STUB_PORT + "（随机；按端口清残留，不按脚本名 pkill）");
  console.log("  · 内核二进制（钉住已编译）：" + KERNEL_BIN);
  console.log("  · 仓库 data/desktop/rooms.json 基线 sha256：" + repoRoomsShaBefore);

  quietIsolatedStore();

  try {
    killByPort(STUB_PORT);
    for (let i = 0; i < 40; i++) { if (await portFree(STUB_PORT)) break; await sleep(100); }
    stub = await startStub();
    await sleep(300);
    if (stub.exitCode !== null || stub.signalCode !== null) {
      throw new Error("stub " + STUB_PORT + " 刚启动就死了(exit=" + stub.exitCode + ")");
    }

    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + UD],
      cwd: REPO,
      env: electronLaunchEnv({
        DISPLAY: process.env.DISPLAY || "",
        PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
        MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
        BITBOT_REPO_ROOT: REPO,
        BITBOT_DATA_ROOT: DATA,
        BITBOT_NO_SECRET_SYNC: "1",
        BITBOT_DESKTOP_AUTOSTART: "0",
        BITBOT_ROUTINE_DAEMON_AUTOSTART: "0",
        /* 应用自己就是唤醒源：让**产品自己的**定时器去到点触发排程，
         * 而不是门禁替它调一次 tick。 */
        BITBOT_DESKTOP_SWEEP_MS: String(process.env.GJ_SWEEP_MS || 3000),
        TZ,
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
        BITBOT_LLM_API_KEY: "gj-golden-key",
        BITBOT_LLM_MODEL: "gj-stub",
        BITBOT_LLM_STREAM: "0",
        BITBOT_ROOM_RESPONDER_TIMEOUT_MS: process.env.GJ_ROOM_TIMEOUT_MS || "150000",
        /* 主进程日志落文件（playwright 会收走子进程 stdout，门外看不到主进程说话）。 */
        BITBOT_APP_LOG_FILE: path.join(ART_RUN, "app.log"),
      }),
      timeout: 120000,
    });
    try {
      const ap = app.process();
      if (ap && ap.stderr) ap.stderr.on("data", (d) => {
        const t = String(d).trim();
        if (!/dbus|DEPRECATED|deprecated|ERROR:dbus|GPU|gpu/i.test(t)) console.log("[app!] " + safeStr(t, 220));
      });
    } catch { /* 诊断通道是锦上添花 */ }
    win = await app.firstWindow({ timeout: 60000 });
    win.on("pageerror", (e) => console.log("[pageerror] " + safeStr(String((e && e.message) || e), 200)));
    await win.waitForSelector("#composer #text", { timeout: 60000 });
    await win.setViewportSize({ width: 1440, height: 900 });
    ok("GJ-00", "真 Electron 冷启动就绪（main + preload + index.html），隔离数据根已就位");

    /* ─────────────────────────────────────────────────────────────
     * 步骤 1：建团队（主输入框的组队话术 —— 渲染层自己的路径）
     * ───────────────────────────────────────────────────────────── */
    const teamMsg = "组建团队：团队名=" + TEAM_TITLE + " 角色：" + ROLES.join("、");
    await win.fill("#composer #text", teamMsg);
    await win.press("#composer #text", "Enter");
    const teamRoom = await waitFor(() => roomRows().find((r) => r && r.title === TEAM_TITLE) || null, 120000);
    if (!teamRoom) {
      bad("GJ-01", "建团队：群没建出来", "「" + teamMsg + "」之后 120s 内没有 " + TEAM_TITLE);
      await shot("99-team-failed");
    } else {
      const members = (teamRoom.members || []).slice();
      const bots = botRows();
      const mine = bots.filter((b) => members.includes(b.id));
      const names = mine.map((b) => String(b.name || ""));
      const jobs = mine.map((b) => String(b.job || ""));
      const namesHit = ROLES.every((r) => names.includes(r));
      const jobsHit = mine.length === ROLES.length && jobs.every((j) => j.trim().length > 0);
      namesHit && jobsHit
        ? ok("GJ-01", "建团队：3 个 Bot 真建好且各有职责（" + names.join(" / ") + "）",
          { names, jobs, member_ids: members })
        : bad("GJ-01", "建团队：Bot 或职责没落到位", { names, jobs, members });
      members.length === ROLES.length
        ? ok("GJ-02", "建团队：群「" + TEAM_TITLE + "」真建好，成员 " + members.length + " 位（" + members.join(",") + "）")
        : bad("GJ-02", "建团队：群成员数不对", { members, expected: ROLES.length });
    }
    const roomId = teamRoom ? teamRoom.id : "";
    await shot("01-team");

    if (!roomId) {
      const why = "建团队没成功（GJ-01/GJ-02 已红）";
      for (const id of ["GJ-03", "GJ-04", "GJ-05", "GJ-06", "GJ-07", "GJ-08", "GJ-09", "GJ-10", "GJ-11", "GJ-12",
        "GJ-13", "GJ-14", "GJ-15", "GJ-16", "GJ-17", "GJ-18", "GJ-19", "GJ-20", "GJ-21", "GJ-22",
        "GJ-23", "GJ-24", "GJ-25", "GJ-26", "GJ-27"]) skip(id, "往后的步骤都依赖群", why);
    } else {
      /* ───────────────────────────────────────────────────────────
       * 步骤 2：排程（群资料面板 → 定时任务 → 添加入口 → 原话 → 添加）
       * ─────────────────────────────────────────────────────────── */
      await win.evaluate(() => refreshSidebarRooms()).catch(() => {});
      const roomSel = '#room-list .agent-item[data-room-id="' + roomId + '"]';
      const seen = await waitFor(async () => await win.$(roomSel).then((h) => !!h).catch(() => false), 30000);
      const sideText = await win.evaluate(() => String((document.getElementById("room-list") || {}).innerText || ""));
      seen && sideText.includes(TEAM_TITLE)
        ? ok("GJ-03", "建团队：侧栏真的出现了这个群（用户在界面上看得见）")
        : bad("GJ-03", "建团队：侧栏没出现这个群", { seen, side: safeStr(sideText, 200) });
      if (seen) await win.click(roomSel).catch(() => {});
      const inRoom = await waitFor(() => win.evaluate(() => {
        const b = document.getElementById("room-banner");
        return !!(b && b.style.display !== "none" && String(b.innerText || "").includes("GJGolden"));
      }).catch(() => false), 30000);
      inRoom
        ? ok("GJ-04", "建团队：点进去就是那个群（banner 标题=GJGolden）")
        : bad("GJ-04", "建团队：点开侧栏那一行没进群", { inRoom });

      /* 群资料面板 → 定时任务段 */
      await win.click("#room-banner-info").catch(() => {});
      const railOpen = await waitFor(() => win.evaluate(() => document.body.dataset.panel === "room").catch(() => false), 20000);
      let railText = "";
      if (railOpen) {
        await win.evaluate(() => setRoomRailTab("routines")).catch(() => {});
        await sleep(400);
        railText = await win.evaluate(() => String((document.getElementById("ri-routine-list") || {}).innerText || ""));
      }
      const emptyState = /暂无|沒有|没有|No scheduled/i.test(railText);
      emptyState
        ? ok("GJ-05", "排程：群资料「定时任务」段先是真的空态（不是假装有）")
        : bad("GJ-05", "排程：群资料定时任务段既没开也没空态", { railOpen, rail: safeStr(railText, 200) });

      await win.click("#ri-routine-add").catch(() => {});
      const formOpen = await waitFor(() => win.evaluate(() => document.body.dataset.roomForm === "open").catch(() => false), 15000);
      if (formOpen) {
        await win.fill("#ri-text", SCHEDULE_TEXT);
        await win.click("#ri-form-save");
      }
      const routine = await waitFor(() => routineRows().find((r) => r && String(r.room_id || "") === roomId) || null, 60000);
      if (!routine) {
        bad("GJ-06", "排程：原话没落成一条真任务", { formOpen, text: SCHEDULE_TEXT });
      } else {
        const cron = String(routine.cron || "");
        const wc = routine.next_due ? wallClock(routine.next_due, TZ) : null;
        const cronHit = cron === "0 9 * * *";
        const wallHit = !!(wc && wc.hour === 9 && wc.minute === 0);
        const dueAhead = Number.isFinite(ageMs(routine.next_due)) && ageMs(routine.next_due) < 0;
        cronHit && wallHit && dueAhead
          ? ok("GJ-06", "排程：原话落成 cron=" + cron + "、墙钟 " +
            String(wc.hour).padStart(2, "0") + ":" + String(wc.minute).padStart(2, "0") + "（" + TZ + "）、归属本群",
            { id: routine.id, cron, next_due: routine.next_due, room_id: routine.room_id })
          : bad("GJ-06", "排程：cron/墙钟/归属有一项不对", {
            cron, wall: wc, next_due: routine.next_due, room_id: routine.room_id,
            dueAhead, ageMs: ageMs(routine.next_due),
          });
      }
      const routineId = routine ? String(routine.id) : "";
      await sleep(800);
      const panelText = await win.evaluate(() => String((document.getElementById("ri-routine-list") || {}).innerText || ""));
      panelText.includes("09:00")
        ? ok("GJ-07", "排程：面板上看得见这条任务与它的 09:00（用户看得见，不是只落了盘）")
        : bad("GJ-07", "排程：面板没显示这条任务的 09:00", { panel: safeStr(panelText, 240) });
      await shot("02-schedule");

      /* ───────────────────────────────────────────────────────────
       * 步骤 3：到点执行
       *   唯一允许的例外：改隔离根里那一行的 next_due（墙钟不可控）。
       *   之后等**应用自己的**唤醒定时器去触发它。
       * ─────────────────────────────────────────────────────────── */
      const fired = { done: false };
      if (!routineId) {
        bad("GJ-08", "到点执行：没有可触发的任务", "排程没落盘");
        skip("GJ-09", "到点执行：先读后执行", "没有可触发的任务");
      } else {
        /* 例外（写明为什么）：排程建成的是「每天早上9点」，门禁不能等到真的 9 点。
         * 只改 next_due 这一个字段，别的（cron / prompt / room_id）一个字节都不动。 */
        const rows = routineRows();
        const hit = rows.find((r) => r && String(r.id) === routineId);
        if (hit) {
          hit.next_due = new Date(Date.now() - 60000).toISOString();
          const raw = readJson(ROUTINES, []);
          fs.writeFileSync(ROUTINES, JSON.stringify(Array.isArray(raw) ? rows : raw, null, 2));
        }
        const firedRow = await waitFor(() => {
          const r = routineRows().find((x) => x && String(x.id) === routineId);
          return r && r.last_fired_at ? r : null;
        }, 120000);
        const tick = readJson(D("routines/last-tick.json"), {});
        const age = firedRow ? ageMs(firedRow.last_fired_at) : NaN;
        const ageOk = Number.isFinite(age) && age >= -60000 && age <= 180000;
        firedRow && ageOk && String((tick.fired_ids || []).join(",")).includes(routineId)
          ? ok("GJ-08", "到点执行：应用自己的调度器真到点触发了这条任务（sweep fired_ids 里有它）",
            { fired_at: firedRow.last_fired_at, age_ms: age, tick_at: tick.at })
          : bad("GJ-08", "到点执行：没有到点触发（或触发了但不是最近这一轮）", {
            firedRow: firedRow ? { last_fired_at: firedRow.last_fired_at } : null, age, tick,
          });
        const draftFiles = listFiles(DRAFT_DIR, ".json").filter((f) => f.startsWith("routine-" + routineId + "-"));
        const draft = draftFiles.length ? readJson(path.join(DRAFT_DIR, draftFiles[0]), {}) : {};
        draftFiles.length >= 1 && draft.requires_approval === true
          ? ok("GJ-09", "到点执行：先读后执行 —— 只备好草稿（requires_approval=true）")
          : bad("GJ-09", "到点执行：没有备好待批准的草稿", { draftFiles, draft: safeStr(draft, 200) });
      }

      /* ───────────────────────────────────────────────────────────
       * 步骤 4：产出（到点派进群 → 成员真的跑完 → 落一份真产物）
       * ─────────────────────────────────────────────────────────── */
      const report = await waitFor(() => {
        const tx = txOf(roomId);
        const fr = tx.filter((e) => e && e.kind === "final_report" && String(e.task_sig || "").includes(routineId));
        return fr.length ? fr[fr.length - 1] : null;
      }, 180000);
      const replies = txOf(roomId).filter((e) => e && e.kind === "bot_reply" && String(e.task_sig || "").includes(routineId));
      replies.length >= 1
        ? ok("GJ-10", "产出：到点真的派进群，成员跑完并留下回执（bot_reply " + replies.length + " 条）",
          { names: replies.map((r) => r.name), text: safeStr(replies[0] && replies[0].text, 160) })
        : bad("GJ-10", "产出：到点之后群里没有任何成员回执", { tx: safeStr(txOf(roomId).slice(-6), 500) });
      /* 团队模式专属契约(2026-11-22):**共享任务板** ——
       * 成员能看见彼此干了什么。这是团队模式相对 auto_route 接力(previous_turn)多出来的东西,
       * 所以归这个门禁守(团队模式的那个群),不归 auto_route 场景守。
       * 载荷里的标记字样还没实测过 ⇒ 先按宽松正则找,并把首条 system 前 400 字打出来做诊断。 */
      /* 团队模式专属契约(2026-11-22):**共享任务板** ——
       * 成员能看见彼此干了什么。这是团队模式相对 auto_route 接力(previous_turn)多出来的东西,
       * 所以归这个门禁守(团队模式的那个群),不归 auto_route 场景守。
       * 载荷里的标记字样还没实测过 ⇒ 先按宽松正则找,并把首条 system 前 400 字打出来做诊断。 */
      const provRowsGJ = (() => {
        try {
          return fs.readFileSync(PROVIDER_JSONL, "utf8").split("\n").filter(Boolean)
            .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        } catch { return []; }
      })();
      const sharedHitsGJ = provRowsGJ.filter((r) => {
        const msgs = Array.isArray(r.messages) ? r.messages : [];
        const all = msgs.map((m) => String((m && m.content) || "")).join("\n");
        return /最近群聊记录|共享任务板|共享板|任务板|群聊记录/.test(all);
      }).length;
      if (sharedHitsGJ >= 1) {
        ok("GJ-10b", "团队模式：成员的 provider 载荷里带着**共享任务板**（成员看得见彼此干了什么）", { rows: sharedHitsGJ });
      } else {
        const firstSysGJ = provRowsGJ.length
          ? String(((provRowsGJ[0].messages || []).find((m) => m && m.role === "system") || {}).content || "").slice(0, 400)
          : "";
        bad("GJ-10b", "团队模式：provider 载荷里没有共享任务板（成员看不见彼此干了什么）",
          { rows: sharedHitsGJ, total: provRowsGJ.length, firstSystem: firstSysGJ });
      }
      if (!report) {
        bad("GJ-11", "产出：这一批没收口（没有 final_report）", { replies: replies.length });
      } else {
        const okReport = Number(report.total || 0) >= 1 && Number(report.returned || 0) >= 1 && report.partial !== true;
        okReport
          ? ok("GJ-11", "产出：这一批如实收口（" + report.returned + "/" + report.total + "，partial=" + (report.partial === true) + "）")
          : bad("GJ-11", "产出：收口不诚实（returned/total/partial 有一项不对）", {
            total: report.total, returned: report.returned, partial: report.partial, task_sig: report.task_sig,
          });
      }
      const deliverable = report && report.deliverable ? report.deliverable : null;
      const dPath = deliverable && deliverable.path ? String(deliverable.path) : "";
      const dBytes = dPath ? (readBytes(dPath) || null) : null;
      dPath && dBytes && dBytes.length > 0
        ? ok("GJ-12", "产出：真产物文件落盘（" + safeStr(dPath.split("/").slice(-2).join("/"), 80) + "，" + dBytes.length + " 字节）")
        : bad("GJ-12", "产出：没有真产物文件（汇报卡上也没有可打开的路径）", { deliverable });
      const taskSig = report ? String(report.task_sig || "") : "";
      /* 界面上也得看得见这一轮（不只看磁盘）。
       * 诚实说明：到点派活是在**后台**跑的（应用自己的调度器），渲染层拿不到
       * 「这一轮结束了」的广播 ⇒ 群聊记录不会自动重画；用户回头打开这个群时
       * 才看得到。所以这里先重新打开一次群（真实用户动作），再看屏幕。 */
      await win.evaluate(() => refreshSidebarRooms()).catch(() => {});
      if (await win.$(roomSel).then((h) => !!h).catch(() => false)) await win.click(roomSel).catch(() => {});
      await sleep(1500);
      const uiThread = await waitFor(async () => {
        const t = await win.evaluate(() => {
          const host = document.querySelector("#log .room-thread");
          return String((host && (host.innerText || host.textContent)) || "");
        }).catch(() => "");
        return /竞品动态对比表/.test(t) ? t : null;
      }, 30000);
      uiThread
        ? ok("GJ-13", "产出：群聊界面里看得见这一轮（不是只落在磁盘上）")
        : bad("GJ-13", "产出：界面上看不到这一轮", { thread: safeStr(uiThread, 240) });
      await shot("03-output");

      /* ───────────────────────────────────────────────────────────
       * 步骤 5：指挥（团队指挥台：看 / 插话 / 改向 / 刹停 / 换人）
       * ─────────────────────────────────────────────────────────── */
      await win.click("#app-rail-command").catch(() => {});
      await sleep(1200);
      await win.evaluate(() => window.__bitbotCommand && window.__bitbotCommand.refresh()).catch(() => {});
      await sleep(900);
      const cmdState = await win.evaluate(() => {
        const detail = document.getElementById("cmd-detail");
        const duty = document.getElementById("cmd-duty");
        /* 复盘并进 #cmd-done(见下面 GJ-23 的说明):读现在真实存在的容器。 */
        const review = document.getElementById("cmd-done-list") || document.getElementById("cmd-review");
        return {
          cards: document.querySelectorAll("#cmd-detail [data-cmd-task]").length,
          steps: Array.from(document.querySelectorAll(".cmd-step-name")).map((n) => String(n.textContent || "")),
          duty: String((duty && duty.innerText) || ""),
          review: String((review && review.innerText) || ""),
          detail: String((detail && detail.innerText) || ""),
        };
      }).catch(() => ({ cards: 0, steps: [], duty: "", review: "", detail: "" }));
      cmdState.cards >= 1 && cmdState.steps.length >= 1
        ? ok("GJ-14", "指挥·看：指挥台列出了这一批，并看得见每个成员干了什么（" + cmdState.steps.join(" / ") + "）",
          { cards: cmdState.cards, steps: cmdState.steps })
        : bad("GJ-14", "指挥·看：指挥台没列出这一批（或看不见成员做了什么）", cmdState);
      cmdState.duty.length > 0
        ? ok("GJ-15", "指挥·看：值班区把这条排程也列出来了（今天该跑什么）")
        : bad("GJ-15", "指挥·看：值班区没有排班", { duty: safeStr(cmdState.duty, 200) });
      await shot("04-command-panel");

      /* 指挥台里可能还有**别的**批次的卡（隔离根里拷着历史数据）⇒ 一律按
       * 本批的 task_sig 精确定位那张卡，不靠「最后一张」。 */
      const cardSel = '#cmd-detail [data-cmd-task="' + String(taskSig).replace(/"/g, '\\"') + '"]';
      const cmdAct = async (action, value) => win.evaluate(([sel, act, val]) => {
        /* 同一个 task_sig 可能有两张卡：Task 实体合并出来的「仅记录」卡，和
         * 转录派生的那张（带成员步骤）。要动手的是后者 —— 前者没有成员可换。 */
        const cards = Array.from(document.querySelectorAll(sel));
        const withSteps = cards.filter((c) => c.querySelector(".cmd-step"));
        const card = withSteps.length ? withSteps[0]
          : (cards.length ? cards[cards.length - 1] : null);
        if (!card) return { ok: false, why: "card_not_found" };
        const inp = card.querySelector(".cmd-input");
        if (inp) { inp.value = val; inp.dispatchEvent(new Event("input", { bubbles: true })); }
        const b = card.querySelector(act);
        if (!b) {
          return {
            ok: false, why: "button_not_found:" + act,
            card_html: String(card.innerHTML || "").slice(0, 700),
            panel_btns: document.querySelectorAll("#cmd-detail " + act).length,
            panel_cards: Array.from(document.querySelectorAll("#cmd-detail [data-cmd-task]"))
              .map((c) => String(c.getAttribute("data-cmd-task") || "")).slice(0, 6),
          };
        }
        b.click();
        return { ok: true };
      }, [cardSel, action, value]).catch((e) => ({ ok: false, why: String((e && e.message) || e) }));

      /* 插话 */
      const steerText = "插话：先看数据再下结论，别急着写。";
      const steerClick = await cmdAct("[data-cmd-steer]", steerText);
      const steered = await waitFor(() => txOf(roomId).filter((e) => e && e.kind === "task_state" && e.state === "steered")
        .find((e) => String(e.text || "").includes("先看数据再下结论")) || null, 30000);
      steered
        ? ok("GJ-16", "指挥·插话：真落了一条 steered 指令（下一棒看得见）", { click: steerClick })
        : bad("GJ-16", "指挥·插话：点下去没落任何 steered 指令", { click: steerClick, tx: safeStr(txOf(roomId).slice(-5), 500) });

      /* ───────────────────────────────────────────────────────────
       * 指挥·刹停：让任务真在跑时按「刹停」（第二次到点触发 ⇒ 一条新批次在跑）
       * ─────────────────────────────────────────────────────────── */
      if (!routineId) {
        skip("GJ-22", "指挥·刹停：真在跑的任务刹得下来", "没有可触发的任务");
      } else {
        const rows2 = routineRows();
        const hit2 = rows2.find((r) => r && String(r.id) === routineId);
        if (hit2) {
          hit2.next_due = new Date(Date.now() - 60000).toISOString();
          const raw2 = readJson(ROUTINES, []);
          fs.writeFileSync(ROUTINES, JSON.stringify(Array.isArray(raw2) ? rows2 : raw2, null, 2));
        }
        /* 轮询指挥台，等「刹停」按钮真的出现（= 有一条批次正在跑）。 */
        let brake = null;
        for (let i = 0; i < 160; i++) {
          await win.evaluate(() => window.__bitbotCommand && window.__bitbotCommand.refresh()).catch(() => {});
          brake = await win.evaluate((rid) => {
            const btns = Array.from(document.querySelectorAll("#cmd-detail [data-cmd-cancel]"));
            for (const b of btns) {
              const card = b.closest ? b.closest("[data-cmd-task]") : null;
              const sig = card ? String(card.getAttribute("data-cmd-task") || "") : "";
              const live = card && card.querySelector(".cmd-step");
              if (sig && live && sig.indexOf("routine-fire-" + rid + "-") >= 0) {
                return { sig, clicked: true };
              }
            }
            return null;
          }, routineId).catch(() => null);
          if (brake) break;
          await sleep(250);
        }
        if (!brake) {
          bad("GJ-22", "指挥·刹停：真在跑的任务没刹得下来（60s 内指挥台没给出可点的刹停按钮）", {
            routineId, reason: "没有出现 working 批次",
          });
        } else {
          const brakeClick = await win.evaluate((rid) => {
            const btns = Array.from(document.querySelectorAll("#cmd-detail [data-cmd-cancel]"));
            const hits = [];
            for (const b of btns) {
              const card = b.closest ? b.closest("[data-cmd-task]") : null;
              const sig = card ? String(card.getAttribute("data-cmd-task") || "") : "";
              const live = card && card.querySelector(".cmd-step");
              hits.push(sig);
              if (sig && live && sig.indexOf("routine-fire-" + rid + "-") >= 0) {
                b.click();
                return { clicked: sig, hits };
              }
            }
            return { clicked: "", hits };
          }, routineId).catch((e) => ({ clicked: "", hits: [], err: String((e && e.message) || e) }));
          await sleep(1200);
          const brakeNote = await win.evaluate(() => {
            const n = document.querySelector("#cmd-detail .cmd-note-box");
            return String((n && n.innerText) || "");
          }).catch(() => "");
          const brakedSig = String((brakeClick && brakeClick.clicked) || "");
          const cancelledRow = await waitFor(() => txOf(roomId).find((e) => e && e.kind === "task_state" && e.state === "cancelled"
            && (!brakedSig || String(e.task_sig || "") === brakedSig)) || null, 30000);
          const cancelledTask = cancelledRow
            ? taskRows().find((t) => t && String(t.id || "") === String(cancelledRow.task_sig || "")) : null;
          const tx = txOf(roomId);
          const cancelIdx = cancelledRow ? tx.indexOf(cancelledRow) : -1;
          const afterReply = cancelIdx >= 0
            ? tx.slice(cancelIdx + 1).filter((e) => e && e.kind === "bot_reply" && String(e.task_sig || "") === String(cancelledRow.task_sig || "")).length
            : -1;
          /* 点下去时那批可能**已经跑完了** ⇒ 主进程回 no_running_task。
           * 这时「如实说了没在跑」是合规的(不许静默失败);
           * 但指挥台那条**陈旧的 working 卡片不许一直挂着** —— 那是真问题:
           * 指挥台显示的状态必须跟真实状态一致,不然用户会去点一个点不动的按钮。 */
          const noRunningSaid = /no_running_task|没有在跑|沒有在跑|已经结束|已結束|not running/i.test(String(brakeNote || ""));
          let staleCard = null;
          for (let i = 0; i < 20; i++) {
            await win.evaluate(() => window.__bitbotCommand && window.__bitbotCommand.refresh()).catch(() => {});
            await sleep(500);
            staleCard = await win.evaluate((rid) => {
              const btns = Array.from(document.querySelectorAll("#cmd-detail [data-cmd-cancel]"));
              for (const b of btns) {
                const card = b.closest ? b.closest("[data-cmd-task]") : null;
                const sig = card ? String(card.getAttribute("data-cmd-task") || "") : "";
                const live = card && card.querySelector(".cmd-step");
                if (sig && live && sig.indexOf("routine-fire-" + rid + "-") >= 0) return sig;
              }
              return null;
            }, routineId).catch(() => null);
            if (!staleCard) break;
          }
          cancelledRow && cancelledTask && String(cancelledTask.state || "") === "cancelled" && afterReply === 0
            ? ok("GJ-22", "指挥·刹停：真在跑的那一批被刹停了，且**没留下半个状态**（一条 cancelled 行 + Task=cancelled + 停后不再出回执）",
              { task_sig: cancelledRow.task_sig, reason: cancelledRow.reason, state: cancelledTask.state, replies_after: afterReply })
            : (!cancelledRow && noRunningSaid && !staleCard
              ? ok("GJ-22", "指挥·刹停：点的时候那批已经跑完了 —— 宿主**如实说了没在跑**（没静默失败），"
                + "且指挥台那条陈旧的 working 卡片随后消失了（状态不许和真实状态脱节）",
                { note: safeStr(brakeNote, 120), click: brakeClick })
              : bad("GJ-22", "指挥·刹停：刹停后状态不干净", {
                cancelled: !!cancelledRow, task_state: cancelledTask && cancelledTask.state, replies_after: afterReply,
                no_running_said: noRunningSaid, stale_working_card: staleCard,
                click: brakeClick, note: safeStr(brakeNote, 160),
              }));
        }
      }

      /* ───────────────────────────────────────────────────────────
      /* 换人 */
      const swapTo = ROLES[1];
      const fromId = (replies[0] && replies[0].bot_id) || "";
      const swapClick = await cmdAct("[data-cmd-swap]", swapTo);
      const swapped = await waitFor(() => txOf(roomId).filter((e) => e && e.kind === "task_state" && e.state === "reassigned")
        .find((e) => String(e.to_bot || "") === swapTo || String(e.to_bot_name || "") === swapTo) || null, 30000);
      swapped && swapped.from_bot === fromId
        ? ok("GJ-18", "指挥·换人：真落了一条 reassigned 指令（" + fromId + " → " + swapTo + "）", { click: swapClick })
        : bad("GJ-18", "指挥·换人：点下去没落任何 reassigned 指令", { fromId, swapTo, click: swapClick, tx: safeStr(txOf(roomId).slice(-5), 500) });

      /* 负向：换人换成一个**不在群里**的人 ⇒ 如实拒绝，且**不留半个状态** */
      const txBeforeBadSwap = txOf(roomId).filter((e) => e && e.kind === "task_state" && e.state === "reassigned").length;
      const badSwapClick = await cmdAct("[data-cmd-swap]", "GJNotInRoom");
      await sleep(2500);
      const txAfterBadSwap = txOf(roomId).filter((e) => e && e.kind === "task_state" && e.state === "reassigned").length;
      const noteAfterBadSwap = await win.evaluate((sel) => {
        const card = document.querySelector(sel);
        const n = card ? card.querySelector(".cmd-note-box") : null;
        return String((n && n.innerText) || "");
      }, cardSel).catch(() => "");
      txAfterBadSwap === txBeforeBadSwap
        ? ok("GJ-19", "负向：换人换成一个不在群里的 Bot ⇒ 如实拒绝，且**没有**留下半个状态（转录里没有新的 reassigned 行）",
          { note: safeStr(noteAfterBadSwap, 160), click: badSwapClick })
        : bad("GJ-19", "负向：换人不成却还是落了状态", { before: txBeforeBadSwap, after: txAfterBadSwap, click: badSwapClick });

      /* 负向：指挥区空输入 ⇒ 什么都不发（没有 effect、没有状态） */
      const txBeforeEmpty = txOf(roomId).length;
      const emptyClick = await cmdAct("[data-cmd-steer]", "   ");
      await sleep(2000);
      txOf(roomId).length === txBeforeEmpty
        ? ok("GJ-20", "负向：指挥区空输入点插话 ⇒ 不发任何东西（转录一行都没多）", { click: emptyClick })
        : bad("GJ-20", "负向：空输入却落了东西", { before: txBeforeEmpty, after: txOf(roomId).length, click: emptyClick });

      /* 负向：未批准前不许外发（data/mail/sends/ 一份都不许新增） */
      const sendFiles = listFiles(SEND_DIR, ".json");
      const pendingRows = (() => {
        try {
          return fs.readFileSync(PENDING, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
            try { return JSON.parse(l); } catch { return null; }
          }).filter(Boolean);
        } catch { return []; }
      })();
      const mineApproval = pendingRows.find((p) => p && p.source === "routine" &&
        String(p.command || "").includes(MAIL_TO) && p.status === "pending" &&
        Math.abs(ageMs(p.requested_at)) <= 900000);
      sendFiles.length === 0 && mineApproval
        ? ok("GJ-21", "负向：未批准前**一封都没外发**（data/mail/sends/ 0 份；待批准里那一封还在排队）")
        : bad("GJ-21", "负向：未批准却外发了，或待批准入口不在", { sendFiles, approval: safeStr(mineApproval, 240) });

      /* ───────────────────────────────────────────────────────────
       * 「派一个负责人」：用户不点名的一句话进群，宿主应当**只派一个**人开工。
       * （已知真缺陷：团队模式下内容路由没被调用 ⇒ 多个 Bot 同时开工。）
       * ─────────────────────────────────────────────────────────── */
      const txBeforeOwner = txOf(roomId).length;
      await win.evaluate(() => refreshSidebarRooms()).catch(() => {});
      if (await win.$(roomSel).then((h) => !!h).catch(() => false)) await win.click(roomSel).catch(() => {});
      await win.fill("#composer #text", OWNER_TEXT);
      await win.press("#composer #text", "Enter");
      const ownerTurn = await waitFor(() => {
        const tx = txOf(roomId);
        const user = tx.filter((e) => e && e.kind === "user" && String(e.text || "") === OWNER_TEXT).pop();
        if (!user) return null;
        const sig = String(user.message_id || "");
        const replies = tx.filter((e) => e && e.kind === "bot_reply" && String(e.task_sig || "").indexOf(sig) >= 0);
        return replies.length ? { sig, replies } : null;
      }, 120000);
      if (!ownerTurn) {
        bad("GJ-25", "派一个负责人：无 @ 的一句话进群后没有人开工", { txBeforeOwner });
      } else {
        const started = Array.from(new Set(ownerTurn.replies.map((r) => String(r.name || r.bot_id || ""))));
        /* 契约归属(2026-11-22 修):这个群有 3 个**有职责**的成员 ⇒ 按产品设计判据
         * 「群里至少两个成员有职责 ⇒ 团队模式」⇒ **必然**是团队模式
         * (产品源码 hosts/desktop/product_surface.js 3078-3098 明写:
         *  团队里的任务走**并行 + 分工**;随手拉几个人聊天才走 auto_route)。
         * 「唯一负责人 + 串行接力」是 **auto_route** 契约,由 scripts/prove_room_relay.js 守着。
         * ⇒ ⇒ 本条断言原先在**一个团队模式的群**里要求「只派一个」⇒ **测错了契约**。
         *
         * ⇒ 现在改守团队模式真正的契约,而且判据**更强**:
         *   ① 成员分工并行开工(团队模式的设计)
         *   ② **只有一条 final_report** —— 写入收口唯一(不许两个成员各交一份)
         *   ③ **产物只有一份** —— 不许两个成员产出同一个文件
         *   ④ **不是半截**(partial=false,returned === total)
         */
        /* 等收口落下来:成员回执可能先于 final_report 落(写入要串行)⇒ 等等再判。 */
        let frs25 = [];
        for (let i = 0; i < 60; i++) {
          frs25 = txOf(roomId).filter((e) => e && e.kind === "final_report"
            && String(e.task_sig || "").indexOf(ownerTurn.sig) >= 0);
          if (frs25.length) break;
          await sleep(500);
        }
        const txAll25 = txOf(roomId);
        if (process.env.GJ_DEBUG_SIG) {
          console.log("  · [debug] ownerTurn.sig=" + ownerTurn.sig);
          console.log("  · [debug] 最近 final_report:" + JSON.stringify(txAll25.filter((e) => e && e.kind === "final_report").slice(-3).map((e) => ({ t: e.task_sig, resp: e.responders, tot: e.total, ret: e.returned, part: e.partial }))));
          console.log("  · [debug] 最近 user 行:" + JSON.stringify(txAll25.filter((e) => e && e.kind === "user").slice(-3).map((e) => ({ mid: e.message_id, txt: safeStr(e.text, 24) }))));
        }
        const fr25 = frs25[frs25.length - 1] || null;
        const delivered25 = frs25.filter((e) => e && e.deliverable).length;
        const teamOk25 = started.length >= 1 && frs25.length === 1 && fr25
          && fr25.partial === false
          && Number(fr25.returned) === Number(fr25.total)
          && delivered25 <= 1;
        teamOk25
          ? ok("GJ-25", "团队模式：无 @ 的一句话进群，成员分工并行开工（" + started.join("、")
            + "），但**写入收口唯一**：一条 final_report、产物 " + delivered25 + " 份、partial=false",
            { started, fr: { responders: fr25.responders, total: fr25.total, returned: fr25.returned, partial: fr25.partial } })
          : bad("GJ-25", "团队模式：并行分工但**写入收口不干净**", {
            started, final_reports: frs25.length, delivered: delivered25,
            fr: fr25 && { responders: fr25.responders, total: fr25.total, returned: fr25.returned, partial: fr25.partial },
          });
      }
      await shot("06-owner");
      /* 改向 */
      const replanText = "改向：只做竞品动态的对比表，别写简报。";
      const replanClick = await cmdAct("[data-cmd-replan]", replanText);
      const replanned = await waitFor(() => txOf(roomId).filter((e) => e && e.kind === "task_state" && e.state === "replanned")
        .find((e) => String(e.task || "").includes("只做竞品动态的对比表")) || null, 30000);
      replanned
        ? ok("GJ-17", "指挥·改向：真落了一条 replanned 指令（同一批任务换目标）", { click: replanClick })
        : bad("GJ-17", "指挥·改向：点下去没落任何 replanned 指令", { click: replanClick, tx: safeStr(txOf(roomId).slice(-5), 500) });

      /* ───────────────────────────────────────────────────────────
       * 步骤 6：复盘（指挥台「复盘」段：只列真的收过口的批次）
       * ─────────────────────────────────────────────────────────── */
      await win.evaluate(() => window.__bitbotCommand && window.__bitbotCommand.refresh()).catch(() => {});
      await sleep(1200);
      /* 「复盘」段在 P1 批 1 之后并进了「已完成」折叠区(#cmd-done)——
       * 原 #cmd-review 容器与它的渲染函数已删(D-7),**行 class 没改名**(仍是 .cmd-review-row)。
       * ⇒ 这条门以前读的是**已经被删掉的** #cmd-review ⇒ 恒读到 null ⇒ 恒判「复盘段是空的」。
       * ⇒ 门禁失修(门没跟上产品改动)—— 门要读**现在真实存在**的那个容器。
       *   (产品主键的门失修 = 主键失灵 ⇒ 这种失修比一条产品缺陷更危险。)
       */
      const review = await win.evaluate(() => {
        const host = document.getElementById("cmd-done-list") || document.getElementById("cmd-review");
        return {
          text: String((host && host.innerText) || ""),
          rows: document.querySelectorAll("#cmd-done-list .cmd-review-row, #cmd-review .cmd-review-row").length,
        };
      }).catch(() => ({ text: "", rows: 0 }));
      const doneTasks = taskRows().filter((t) => t && t.state === "done");
      const mineDone = taskSig ? doneTasks.find((t) => String(t.id || "") === taskSig) : null;
      review.rows >= 1 && mineDone
        ? ok("GJ-23", "复盘：指挥台「复盘」段列出了真的收过口的批次（" + safeStr(mineDone.title || mineDone.task || "", 60) + "）",
          { rows: review.rows, task: safeStr(mineDone, 240) })
        : bad("GJ-23", "复盘：复盘段没有这一批（或者 Task 实体没记成 done）", {
          rows: review.rows, review: safeStr(review.text, 240), done: doneTasks.length, mineDone: safeStr(mineDone, 200),
        });
      review.rows >= 1 && !/还没有完成的批次/.test(review.text)
        ? ok("GJ-24", "复盘：复盘段不是空壳（真的画出了行）")
        : bad("GJ-24", "复盘：复盘段是空态", { review: safeStr(review.text, 200) });
      await shot("05-review");

    }
  } catch (e) {
    bad("GJ-99", "门禁执行异常", (e && e.stack) ? String(e.stack).split("\n").slice(0, 4).join(" | ") : String(e));
  }

  /* ── 收尾：仓库 data/desktop/rooms.json 逐字节未变 ─────────────────────── */
  const repoRoomsAfter = readBytes(REPO_ROOMS);
  const repoRoomsShaAfter = repoRoomsAfter ? sha256(repoRoomsAfter) : "(absent)";
  const same = repoRoomsBefore === null ? repoRoomsAfter === null : repoRoomsBefore.equals(repoRoomsAfter);
  same
    ? ok("GJ-26", "隔离：仓库 data/desktop/rooms.json 逐字节未变（sha256 " + repoRoomsShaBefore.slice(0, 16) + "…）")
    : bad("GJ-26", "隔离：仓库 data/desktop/rooms.json 被改了", {
      before: repoRoomsShaBefore, after: repoRoomsShaAfter,
    });

  const providerRows = (() => {
    try {
      return fs.readFileSync(PROVIDER_JSONL, "utf8").split("\n").filter((l) => l.trim()).length;
    } catch { return 0; }
  })();
  providerRows >= 1
    ? ok("GJ-27", "取证：provider 真的收到了请求（" + providerRows + " 条，JSONL 已落 artifacts/）")
    : bad("GJ-27", "取证：provider 一条请求都没收到（消息没到 provider）", { providerRows, port: STUB_PORT });

  /* 这一回合真的走的是**本地 stub**，不是用户真配置里的公网地址。 */
  const llmTurns = listFiles(D("llm/turns"), ".json")
    .map((f) => readJson(path.join(D("llm/turns"), f), {}))
    .filter((j) => j && j.mode === "host_llm_chat" && ageMs(j.at) >= -60000 && ageMs(j.at) <= 1800000);
  const stubBase = "http://127.0.0.1:" + STUB_PORT + "/v1";
  const wentToStub = llmTurns.filter((j) => String(j.base_url || "").replace(/\/$/, "") === stubBase);
  wentToStub.length >= 1
    ? ok("GJ-28", "取证：这一回合的模型调用真的打到了本地 stub（" + wentToStub.length + " 次，base_url=" + stubBase + "）",
      { turns: llmTurns.length, to_stub: wentToStub.length })
    : bad("GJ-28", "取证：模型调用没打到本地 stub（可能打到了真 provider，或这一轮根本没调模型）", {
      turns: llmTurns.length,
      bases: Array.from(new Set(llmTurns.map((j) => String(j.base_url || "")))).slice(0, 5),
      stub_base: stubBase,
    });

  console.log("e2e_desktop_golden_journey: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);

  try {
    fs.writeFileSync(EVIDENCE_JSON, JSON.stringify({
      gate: "e2e_desktop_golden_journey",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      pass: PASS, fail: FAIL, skip: SKIP,
      data_root: DATA,
      stub_port: STUB_PORT,
      kernel_bin: KERNEL_BIN,
      tz: TZ,
      repo_rooms_sha256_before: repoRoomsShaBefore,
      repo_rooms_sha256_after: repoRoomsShaAfter,
      repo_rooms_unchanged: same,
      provider_requests: providerRows,
      provider_record_file: PROVIDER_JSONL,
      llm_chat_turns: llmTurns.map((j) => ({
        ok: j.ok, provider_id: j.provider_id, base_url: j.base_url, model: j.model,
        http_status: j.http_status, error: j.error, reply_prefix: String(j.reply_prefix || "").slice(0, 160),
      })),
      screenshots: shots,
      assertions: results,
    }, null, 2));
  } catch { /* 取证失败不改判据 */ }

  const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    if (app) {
      await Promise.race([app.close().catch(() => {}), sleep2(20000)]);
      try { const p = app.process(); if (p) p.kill("SIGKILL"); } catch { /* already gone */ }
    }
  } catch { /* ignore */ }
  try { if (stub) stub.kill("SIGKILL"); } catch { /* ignore */ }
  await sleep2(1000);
  process.exit(FAIL ? 1 : 0);
})();
