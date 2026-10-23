/* e2e_desktop_user_journeys.mjs — J1–J4 用户旅程验收（唯一标准：真实 Electron 里走不走得通）
 *
 * 这一道门禁不以组件断言变绿为目标，只回答四个用户问题：
 *
 *  J1 在 UI 里建两个不同职责的 Bot，分别私聊「你负责什么？」——
 *     回答必须各按各的职责，绝不串成对方的；provider 收到的 system 里
 *     只能有各自的 persona，私聊载荷里不许出现群/成员上下文。
 *  J2 主输入框用自然语言建群：「把 xxx yyy kkk 创建到一个 abc 的群」
 *     必须在同一回合真把群建出来（侧栏出现、3 名成员、transcript 有建房系统行），
 *     不能回「我无法直接创建群聊」，也不能出现「已计划…」调试行；
 *     再验两种说法 + 两人建群 + 名字不存在时的诚实失败 + 短时窗幂等。
 *  J3 群里 @ 两个 Bot 各自说明职责 → 两条 bot_reply 各说各的；
 *     每个 responder 的 provider 载荷必须带群名、完整成员名单（名字+职责）、
 *     本轮被 @ 的是谁；问「这个群有哪些成员？」必须答得出全名单；
 *     同一个 Bot 回到私聊后不得带上群上下文（DM 与 room-* 会话隔离）。
 *  J4 两个 responder 都成功 → final_report 汇总卡；一个失败 → 如实 partial 1/2
 *     并点名失败的 Bot 与原因，绝不编造成功；全程 DOM / 会话持久层 / rooms.json
 *     新增行不得出现调试串；zh-TW 必须真生效（无英文残留、 reload 与重启都保持）；
 *     模型密钥输入框高度 32–48px 且 1280×800 / 1440×900 不横向溢出；
 *     切换 provider 后真正打到 stub 的 Base URL / Authorization 必须来自当前 provider。
 *
 * 证据：截图与 provider 请求记录写进 artifacts/（密钥只记 sha256 前缀，绝不落原文）。
 * 缺 electron / xvfb / moon 时诚实 SKIP（exit 0），SKIP ≠ PASS。
 *
 * 用法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_user_journeys.mjs
 */
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync, spawn } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const DATA = path.join(REPO, "data/desktop");
const ROOMS = path.join(DATA, "rooms.json");
const SESSIONS = path.join(DATA, "sessions.json");
const BOTS = path.join(DATA, "bots.json");
const SETTINGS = path.join(DATA, "settings.json");
const LLM_ACTIVE = path.join(REPO, "data/llm/active.json");
const ART = process.env.UJ_ART_DIR || path.join(REPO, "artifacts");
const REC_MAIN = path.join(ART, "uj-provider-main.jsonl");
const REC_QWEN = path.join(ART, "uj-provider-qwen.jsonl");

let PASS = 0, FAIL = 0;
const hhmmss = () => new Date().toISOString().slice(11, 19);
const ok = (m) => { PASS++; console.log("  ✓ [" + hhmmss() + "] " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ [" + hhmmss() + "] " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 400))); };

function honestSkip(reason) {
  console.log("e2e_desktop_user_journeys: SKIP — " + reason);
  console.log("e2e_desktop_user_journeys: PASS=0 FAIL=0 SKIP=1（SKIP ≠ PASS）");
  process.exit(0);
}
if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing (" + ELECTRON + ")");
try { execSync("command -v xvfb-run", { stdio: "ignore" }); }
catch { if (!process.env.DISPLAY) honestSkip("no DISPLAY and no xvfb-run"); }
let moonOk = false;
try { execSync("moon --version", { stdio: "ignore" }); moonOk = true; }
catch {
  const localBin = process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon");
  if (fs.existsSync(localBin)) {
    try { execSync('PATH="' + path.join(os.homedir(), ".moon/bin") + ':$PATH" moon --version', { stdio: "ignore" }); moonOk = true; }
    catch { /* below */ }
  }
}
if (!moonOk) honestSkip("moon toolchain unavailable → 真回合无法验证");

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const P_MAIN = Number(process.env.UJ_PORT_MAIN || 9411);
const P_QWEN = Number(process.env.UJ_PORT_QWEN || 9412);
// 只在进程 env 里存在；门禁全程只打印长度与 sha256 前缀，绝不打印原文。
const KEY_MAIN = "uj-key-main-" + crypto.randomBytes(8).toString("hex");
const KEY_QWEN = "uj-key-qwen-" + crypto.randomBytes(8).toString("hex");
const authHash = (k) => crypto.createHash("sha256").update("Bearer " + k).digest("hex").slice(0, 16);
const H_MAIN = authHash(KEY_MAIN);
const H_QWEN = authHash(KEY_QWEN);

/* 夹具：名字全用 ASCII（@ 点名与 phrase 编码最稳），职责/简介带唯一标记串，
   provider 回显（ECHO_ALL）里出现哪个标记就能判定哪份 persona 真进了载荷。 */
const A = { name: "UJProduct", job: "UJJOBA负责需求分析与PRD", desc: "UJDESCA只写验收标准" };
const B = { name: "UJTester", job: "UJJOBB负责用例与回归", desc: "UJDESCB只跑回归测试" };
const X = { name: "UJXxx", job: "UJJOBX竞品调研", desc: "UJDESCX只收集证据" };
const Y = { name: "UJYyy", job: "UJJOBY数据核对", desc: "UJDESCY只做核对" };
const Z = { name: "UJZkkk", job: "UJJOBC文案撰写", desc: "UJDESCZ只写文案" };
const F = { name: "UJFail", job: "UJJOBFL长文写作", desc: "UJDESCF这一路必失败" };
const T1 = "UJAbc", T2 = "UJAbc2", T3 = "UJAbc3", T4 = "UJAbc4", TP = "UJPartial";
const PH1 = "把 " + X.name + " " + Y.name + " " + Z.name + " 创建到一个 " + T1 + " 的群";
const PH2 = "建个群叫 " + T2 + "，把 " + X.name + "、" + Y.name + "、" + Z.name + " 拉进来";
const PH3 = "把 " + X.name + " 和 " + Y.name + " 拉到 " + T3 + " 群";
const PHBAD = "把 " + X.name + "、UJGhostone 拉到 " + T4 + " 群";
const PHPART = "把 " + X.name + " 和 " + F.name + " 拉到 " + TP + " 群";

function startStub({ port, record, failContains, reply }) {
  const proc = spawn(
    process.execPath,
    [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")],
    {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        BITBOT_STUB_PORT: String(port),
        BITBOT_STUB_RECORD: record,
        // 整条 message stack 回显进正文：人设/群上下文是否真到 provider 直接可见
        BITBOT_STUB_ECHO_ALL: "1",
        BITBOT_STUB_ECHO_WIDTH: "6000",
        BITBOT_STUB_FAIL_CONTAINS: failContains || "",
        BITBOT_STUB_REPLY: reply || "",
      },
    },
  );
  proc.stderr.on("data", (d) => console.log("[stub:" + port + "] " + String(d).trim().slice(0, 160)));
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("stub boot timeout on " + port)), 10000);
    proc.stdout.on("data", (d) => {
      if (String(d).includes("[stub-llm]")) { clearTimeout(t); res(proc); }
    });
    proc.on("error", rej);
  });
}

const readJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return dflt; } };
const roomRow = (title) => (readJson(ROOMS, { rooms: [] }).rooms || []).find((r) => r && r.title === title) || null;
const tx = (title) => (roomRow(title) || {}).transcript || [];
const rowsOf = (title, kind) => tx(title).filter((e) => e && e.kind === kind);
const reportsOf = (title) => rowsOf(title, "final_report");
const lastReport = (title) => { const l = reportsOf(title); return l[l.length - 1] || null; };
const readRecords = (file) => {
  let raw = "";
  try { raw = fs.readFileSync(file, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 半行忽略 */ }
  }
  return out;
};
/** provider 载荷里的 system 全文（人设/群上下文断言都打在它上面）。 */
const sysText = (rec) => (rec.messages || []).filter((m) => m.role === "system").map((m) => m.content).join("\n");
/* GP-152：system 载荷 = 人设段 + "\n当前群聊：…" 群上下文段。群上下文按 §1 J3
 * 本来就必须列出全体成员的职责，所以「A 的载荷里不该出现 B 的职责」这条只能在
 * 人设段上断言；整段比较会把共享名单误判成串味（上一轮的假红）。 */
const personaText = (rec) => sysText(rec).split("\n当前群聊：")[0];

async function waitUntil(fn, ms = 60000, step = 400) {
  const deadline = Date.now() + ms;
  for (;;) {
    let v = false;
    try { v = await fn(); } catch { v = false; }
    if (v) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, step));
  }
}

const FORBIDDEN = ["已计划", "Host 效果", "BITBOT_LLM_", "LocalBrain", "收到，正在用 MoonBit"];
const forbiddenHit = (text) => {
  const s = String(text || "");
  for (const f of FORBIDDEN) if (s.includes(f)) return f;
  return "";
};

(async () => {
  console.log("e2e_desktop_user_journeys — J1–J4 真实 Electron 用户旅程");
  fs.mkdirSync(ART, { recursive: true });
  for (const f of [REC_MAIN, REC_QWEN]) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }

  // 只清自己的夹具（UJ 前缀），不动用户的 Bot / 群 / 会话历史。
  const sweep = () => {
    const s = { bots: 0, rooms: 0, sessions: 0 };
    try {
      const bs = readJson(BOTS, { bots: [] });
      const keep = (bs.bots || []).filter((b) => !/^UJ/.test(String(b.name || "")));
      s.bots = (bs.bots || []).length - keep.length;
      if (s.bots) { bs.bots = keep; fs.writeFileSync(BOTS, JSON.stringify(bs, null, 2)); }
    } catch { /* 首次运行没有 bots.json */ }
    try {
      const rs = readJson(ROOMS, { rooms: [] });
      const keep = (rs.rooms || []).filter((r) => !/^UJ/.test(String(r.title || "")));
      s.rooms = (rs.rooms || []).length - keep.length;
      if (s.rooms) { rs.rooms = keep; fs.writeFileSync(ROOMS, JSON.stringify(rs, null, 2)); }
    } catch { /* 首次运行没有 rooms.json */ }
    // 夹具 DM 会话标题是 "<UJ 夹具名> · DM"，按同一前缀清；其余会话一行不动。
    try {
      const ss = readJson(SESSIONS, { sessions: [] });
      const keep = (ss.sessions || []).filter((x) => !/^UJ\S* · DM$/.test(String((x && x.title) || "")));
      s.sessions = (ss.sessions || []).length - keep.length;
      if (s.sessions) {
        ss.sessions = keep;
        if (!keep.some((x) => x.id === ss.active_id)) {
          ss.active_id = keep.length ? keep[keep.length - 1].id : "";
        }
        fs.writeFileSync(SESSIONS, JSON.stringify(ss, null, 2));
      }
    } catch { /* 首次运行没有 sessions.json */ }
    return s;
  };
  const swept = sweep();
  if (swept.bots || swept.rooms) console.log("  · 清掉上一轮遗留夹具：" + JSON.stringify(swept));

  const snap = {
    rooms: fs.existsSync(ROOMS) ? fs.readFileSync(ROOMS) : null,
    sessions: fs.existsSync(SESSIONS) ? fs.readFileSync(SESSIONS) : null,
    bots: fs.existsSync(BOTS) ? fs.readFileSync(BOTS) : null,
    settings: fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null,
    llmActive: fs.existsSync(LLM_ACTIVE) ? fs.readFileSync(LLM_ACTIVE) : null,
  };
  const evidence = {
    started_at: new Date().toISOString(),
    note: "keys are recorded only as sha256 prefixes; raw values never leave process env",
    auth_sha256: { main: H_MAIN, qwen: H_QWEN },
    key_lengths: { main: KEY_MAIN.length, qwen: KEY_QWEN.length },
  };

  const launchEnv = (extra) => ({
    ...process.env,
    DISPLAY: process.env.DISPLAY || "",
    PATH: (process.env.HOME || "") + "/.moon/bin:" + (process.env.PATH || ""),
    MOON_BIN: process.env.MOON_BIN || path.join(os.homedir(), ".moon/bin/moon"),
    BITBOT_REPO_ROOT: REPO,
    BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + P_MAIN + "/v1",
    BITBOT_LLM_API_KEY: KEY_MAIN,
    BITBOT_LLM_MODEL: "uj-deepseek",
    BITBOT_LLM_STREAM: "0",
    // provider 级配置：切换到 qwen 后必须用这一组，而不是上面的全局 DeepSeek
    BITBOT_LLM_QWEN_BASE_URL: "http://127.0.0.1:" + P_QWEN + "/v1",
    BITBOT_LLM_QWEN_API_KEY: KEY_QWEN,
    BITBOT_LLM_QWEN_MODEL: "uj-qwen",
    BITBOT_ROOM_RESPONDER_TIMEOUT_MS: "180000",
    ...extra,
  });

  let stubMain = null, stubQwen = null, app = null, win = null;
  const newWindow = async () => {
    app = await _electron.launch({
      executablePath: ELECTRON,
      args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu"],
      cwd: REPO,
      env: launchEnv({}),
      timeout: 120000,
    });
    win = await app.firstWindow({ timeout: 60000 });
    await win.waitForSelector("#composer #text", { timeout: 60000 });
    await win.setViewportSize({ width: 1280, height: 800 });
    return win;
  };
  const quitApp = async () => {
    if (!app) return;
    try {
      await app.evaluate(({ app: electronApp }) => { electronApp.isQuiting = true; electronApp.quit(); });
      await Promise.race([
        app.close(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("close timeout")), 15000)),
      ]);
    } catch { /* pkill below */ }
    app = null; win = null;
  };

  const sendComposer = async (text) => {
    await waitUntil(async () => {
      const b = await win.evaluate(() => { const x = document.getElementById("send"); return Boolean(x && !x.disabled); });
      return b;
    }, 120000);
    await win.fill("#composer #text", text);
    await win.press("#composer #text", "Enter");
  };
  const logVisible = () => win.evaluate(() => {
    const box = document.getElementById("log");
    if (!box) return "";
    return Array.from(box.querySelectorAll(".msg"))
      .filter((el) => !el.classList.contains("debug-only"))
      .map((el) => el.innerText || "")
      .join("\n");
  });
  const logAll = () => win.evaluate(() => (document.getElementById("log") || {}).textContent || "");

  /** 侧栏 Bot 行：名字可能带「★ 」「 · primary」后缀，用包含匹配。 */
  const botRowId = (nm) => win.evaluate((name) => {
    const row = Array.from(document.querySelectorAll("#bot-list .agent-item"))
      .find((el) => (((el.querySelector(".name") || {}).textContent || "")).includes(name));
    return row ? row.dataset.agentId || "" : "";
  }, nm);

  /** UI 建 Bot：走真实对话框（新建按钮 → 名称/职责/描述 → 创建）。 */
  const uiCreateBot = async (b) => {
    await win.click("#bot-new-btn", { timeout: 20000 });
    await win.waitForSelector("#bot-edit-modal #bc-name", { state: "visible", timeout: 20000 });
    await win.fill("#bc-name", b.name);
    await win.fill("#bc-job", b.job);
    await win.fill("#bc-desc", b.desc);
    await win.click("#bc-create", { timeout: 20000 });
    const found = await waitUntil(() => botRowId(b.name), 60000);
    if (!found) return null;
    return botRowId(b.name);
  };

  /** 私聊某个 Bot：点侧栏它的行（真实用户路径），并确认标题栏胶囊切到它。 */
  const openDm = async (botId, botName) => {
    await win.click('#bot-list .agent-item[data-agent-id="' + botId + '"]', { timeout: 20000 });
    const switched = await waitUntil(() => win.evaluate((nm) => {
      const pill = (document.querySelector("#bot-pill .bot-pill-name") || {}).textContent || "";
      const ph = (document.querySelector("#composer #text") || {}).placeholder || "";
      return pill.includes(nm) && !/群/.test(ph);
    }, botName || botId), 30000);
    if (!switched) throw new Error("点开 Bot 私聊没生效（" + botId + "）");
  };

  /** 本轮最后一条可见 assistant 正文（判断「这一句答了什么」，不混入历史）。 */
  const lastAssistantVisible = () => win.evaluate(() => {
    const els = Array.from(document.querySelectorAll("#log .msg"))
      .filter((el) => !el.classList.contains("debug-only") && el.classList.contains("assistant"));
    const last = els[els.length - 1];
    return last ? (last.innerText || "") : "";
  });

  /** 主输入框 = 非群模式（退出群 composer，不依赖某个 Bot 是否存在）。 */
  const useMainComposer = async () => {
    await win.evaluate(() => { if (typeof exitRoomChat === "function") exitRoomChat(); });
  };

  /** 点开侧栏里的某个群（先刷新目录，再点行，等 banner 出现）。 */
  const reopenRoom = async (title) => {
    const row = roomRow(title);
    if (!row) throw new Error("群不存在：" + title);
    await win.evaluate(() => {
      if (typeof exitRoomChat === "function") exitRoomChat();
      if (typeof refreshSidebarRooms === "function") refreshSidebarRooms();
    });
    await win.waitForSelector('#room-list .agent-item[data-room-id="' + row.id + '"]', { timeout: 30000 });
    await win.click('#room-list .agent-item[data-room-id="' + row.id + '"]', { timeout: 20000 });
    await win.waitForFunction(() => {
      const b = document.getElementById("room-banner");
      return b && b.style.display !== "none";
    }, null, { timeout: 30000 });
  };

  /**
   * 取证兜底：J2（中文自然语言建房）在修复前必然是红的。如果 J3/J4 就此中止，
   * 群上下文 / 汇总 / provider 这三组断言就一条证据都留不下。这里退回「内核本来
   * 就支持的英文指令」把夹具房先建出来，让后面的断言继续测各自要测的东西；
   * J2 的失败已由 PH1/PH2/PH3 单独记录，不会因此被掩盖。
   */
  const seedRoomByCommand = async (title, memberIds) => {
    const encTitle = (s) => String(s || "").replace(/\+/g, "%2B").replace(/\s+/g, "+").trim();
    await useMainComposer();
    await sendComposer("create group chat bots=" + memberIds.join(",") + " title=" + encTitle(title));
    return await waitUntil(async () => Boolean(roomRow(title)), 45000);
  };

  /**
   * 产品态打开设置：头像 → 账户弹层 → 设置。
   * #sidebar-settings-btn 在 body.grok-ui 下是 display:none（ui_chrome.css:1114，
   * Round 5/6 把「管理/设置」收进账户弹层），直接点它不是用户路径；
   * 用户点的是头像弹层里的 #ap-settings，由它转发到那颗按钮。
   */
  const openSettings = async (stab) => {
    // GP-152：设置面板已经开着时直接切页签，别再走 #account-avatar-btn ——
    // 面板展开时盖住头像按钮，Playwright 的 actionability 检查会一直等不到
    // 稳定（上一轮 provider 旅程就是这么超时的：前置检查只关了模型面板，
    // 没关设置面板，下一次 openSettings 就被自己的面板挡住）。
    const alreadyOpen = await win.evaluate(() => {
      const p = document.getElementById("settings-panel");
      // .bb-modal 是 position:fixed，offsetParent 恒为 null，只能看 computed display。
      return Boolean(p && getComputedStyle(p).display !== "none");
    });
    if (!alreadyOpen) {
      await win.click("#account-avatar-btn", { timeout: 20000 });
      await win.waitForSelector("#ap-settings", { state: "visible", timeout: 20000 });
      await win.click("#ap-settings", { timeout: 20000 });
    }
    await win.waitForSelector("#settings-panel", { state: "visible", timeout: 20000 });
    if (stab) await win.click('.settings-tab-btn[data-stab="' + stab + '"]', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 300));
  };

  /**
   * 产品态进入「模型 / 供应商」面板。修复前这里就是真红：openModelSheet 只绑在
   * 被 grok-ui 隐藏的表头 chip 上（ui_chrome.css:1110，且 e2e_desktop_shell_v2
   * S-HEADER 要求它不可见），设置里没有任何入口能打开 #model-modal，
   * 于是「切换 provider」「密钥输入框高度」这两条用户根本走不到。
   * 返回 false = 面板不可达；调用方按「前置没走通」报红，而不是量到 -1px 冒充缺陷。
   */
  const openModelSheet = async () => {
    // 幂等保护（我的门禁 bug，不是产品 bug）：面板已经开着时不要再走
    // openSettings → #account-avatar-btn —— #model-modal 是全屏遮罩，按钮被盖住，
    // Playwright 会卡在 "waiting for locator('#account-avatar-btn')" 上，
    // 把后面每个断言连带判成假红（上一轮 J4 的三个 FAIL + "重启后语言被覆盖"
    // 就是这么来的）。已开则直接复用。
    const already = await win.evaluate(() => {
      const m = document.getElementById("model-modal");
      return Boolean(m && getComputedStyle(m).display !== "none");
    });
    if (already) return "already-open";
    await openSettings("credentials");
    const via = await win.evaluate(() => {
      const b = document.getElementById("sec-model-open");
      if (b && b.offsetParent !== null) { b.click(); return "settings-credentials"; }
      const h = document.getElementById("model-entry");
      if (h && h.offsetParent !== null) { h.click(); return "header-chip"; }
      return "";
    });
    if (!via) return false;
    await win.waitForSelector("#model-modal .ms-card", { timeout: 20000 }).catch(() => {});
    const okSheet = await win.evaluate(() => {
      const m = document.getElementById("model-modal");
      return Boolean(m && getComputedStyle(m).display !== "none");
    });
    return okSheet ? via : false;
  };

  try {
    stubMain = await startStub({ port: P_MAIN, record: REC_MAIN, failContains: "名字：" + F.name });
    stubQwen = await startStub({ port: P_QWEN, record: REC_QWEN, reply: "UJQWEN-PROVIDER-REPLY 已收到" });
    await newWindow();
    ok("真 Electron 冷启动 + 两个本地 provider stub（" + P_MAIN + " / " + P_QWEN + "）就绪");

    /* ================= J1 ================= */
    console.log("\n— J1 建 Bot 并私聊答对职责 —");
    let idA = null, idB = null;
    try {
      idA = await uiCreateBot(A);
      idB = await uiCreateBot(B);
      idA && idB && idA !== idB
        ? ok("UI 对话框建出两个不同 Bot（" + idA + " / " + idB + "）")
        : bad("UI 建 Bot", JSON.stringify({ idA, idB }));
      await win.screenshot({ path: path.join(ART, "uj-j1-bots-created.png") });

      /* provider 记录是唯一权威：selectBotForChat 会在界面本地写一行「职责：<job>」，
         所以「界面出现了职责串」不能证明请求打到 provider；只有 provider 回显里才
         同时有「名字：<name>」。等待条件用记录条数，界面断言用「名字：」。 */
      const recBefore = readRecords(REC_MAIN).length;
      await openDm(idA, A.name);
      await sendComposer("你负责什么？");
      const gotA = await waitUntil(() => readRecords(REC_MAIN).length > recBefore, 150000);
      const recsA = readRecords(REC_MAIN).slice(recBefore);
      const lastA = recsA[recsA.length - 1] || null;
      gotA && lastA
        ? ok("A 的私聊回合真打到 provider（新增 " + recsA.length + " 条请求记录）")
        : bad("A 私聊未达 provider", JSON.stringify({ gotA, n: recsA.length }));
      const sysA = lastA ? sysText(lastA) : "";
      sysA.includes(A.job) && sysA.includes(A.desc) && sysA.includes("名字：" + A.name)
        ? ok("A 的 system 里带 A 的名字/职责/简介")
        : bad("A system persona 缺失", sysA.slice(0, 260));
      !sysA.includes(B.job) && !sysA.includes(B.desc) && !sysA.includes("名字：" + B.name)
        ? ok("A 的 system 里没有 B 的人设串（不串味）")
        : bad("A system 串进 B 的人设", sysA.slice(0, 260));
      const echoA = await waitUntil(async () => (await logVisible()).includes("名字：" + A.name), 60000);
      const visA = await logVisible();
      echoA && visA.includes("名字：" + A.name) && !visA.includes("名字：" + B.name)
        ? ok("A 的回执（provider 回显）体现 A 自己的身份，不含 B 的人设")
        : bad("A 回执文案", JSON.stringify({ echoA, tail: visA.slice(0, 240) }));
      !visA.includes("收到，正在用 MoonBit") && !forbiddenHit(visA)
        ? ok("J1 私聊可见区无调试行")
        : bad("J1 私聊出现调试行", forbiddenHit(visA) || visA.slice(0, 200));

      const recBeforeB = readRecords(REC_MAIN).length;
      await openDm(idB, B.name);
      await sendComposer("你负责什么？");
      const gotB = await waitUntil(() => readRecords(REC_MAIN).length > recBeforeB, 150000);
      const recsB = readRecords(REC_MAIN).slice(recBeforeB);
      const lastB = recsB[recsB.length - 1] || null;
      const sysB = lastB ? sysText(lastB) : "";
      gotB && sysB.includes(B.job) && sysB.includes("名字：" + B.name) && !sysB.includes(A.job)
        ? ok("B 的私聊各按各的：system 只有 B 的人设，没有 A 的")
        : bad("B 私聊人设", JSON.stringify({ gotB, n: recsB.length, sys: sysB.slice(0, 240) }));
      await waitUntil(async () => (await lastAssistantVisible()).includes("名字：" + B.name), 60000);
      const visB = await lastAssistantVisible();
      visB.includes("名字：" + B.name) && !visB.includes("名字：" + A.name)
        ? ok("B 的回执（本轮最后一条可见回复）只体现 B 自己的身份")
        : bad("B 回执文案", visB.slice(0, 240));
      await win.screenshot({ path: path.join(ART, "uj-j1-dm-persona.png") });

      // 私聊载荷里不得出现任何群/成员上下文
      const allDm = readRecords(REC_MAIN);
      const leak = allDm.find((r) => /当前群聊：|群成员：|本轮被 @/.test(sysText(r)));
      !leak
        ? ok("DM 请求体不含群上下文（无「当前群聊／群成员／本轮被 @」）")
        : bad("DM 载荷带群上下文", sysText(leak).slice(0, 240));
      evidence.j1 = {
        bot_ids: { A: idA, B: idB },
        main_requests: allDm.length,
        sys_a_head: sysA.slice(0, 300),
        sys_b_head: sysB.slice(0, 300),
      };
    } catch (e) { bad("J1 崩溃", String((e && e.message) || e)); }

    /* ================= J2 ================= */
    console.log("\n— J2 自然语言建群 —");
    let idX = null, idY = null, idZ = null;
    try {
      idX = await uiCreateBot(X);
      idY = await uiCreateBot(Y);
      idZ = await uiCreateBot(Z);
      if (!idX || !idY || !idZ) throw new Error("建群所需 Bot 没建出来");
      await useMainComposer(); // 主输入框：非群模式下发送
      const roomsBefore = (readJson(ROOMS, { rooms: [] }).rooms || []).length;
      await sendComposer(PH1);
      const made1 = await waitUntil(async () => Boolean(roomRow(T1)), 45000);
      const r1 = roomRow(T1);
      const sysRow = rowsOf(T1, "system");
      made1 && r1 && (r1.members || []).length === 3
        ? ok("自然语言「…创建到一个 UJAbc 的群」真建出群，成员 3（" + r1.id + "）")
        : bad("PH1 未建群", JSON.stringify({ made1, members: r1 ? (r1.members || []).length : null }));
      made1 && sysRow.length >= 1 && String(sysRow[0].text || "").includes(T1)
        ? ok("transcript 有建房系统行（Host 生成的确定回执，带群名）")
        : bad("缺建房系统行", JSON.stringify(sysRow.map((r) => r && r.kind)));
      made1 && sysRow.length >= 1 && [X.name, Y.name, Z.name].every((n) => String(sysRow[0].text || "").includes(n))
        ? ok("建房系统行列出 3 个成员名字")
        : bad("建房系统行成员缺失", String(sysRow[0] && sysRow[0].text).slice(0, 200));
      const side1 = await win.evaluate((t) => {
        const row = Array.from(document.querySelectorAll("#room-list .agent-item"))
          .find((el) => ((el.querySelector(".name") || {}).textContent || "").trim() === t);
        return row ? { name: t, meta: ((row.querySelector(".meta") || {}).textContent || "").trim() } : null;
      }, T1);
      side1 && /3/.test(side1.meta)
        ? ok("侧栏同一回合出现 " + T1 + "（" + side1.meta + "）")
        : bad("侧栏未出现群", JSON.stringify(side1));
      const vis2 = await logVisible();
      !/我无法直接创建群聊|无法创建群/.test(vis2)
        ? ok("没有「我无法直接创建群聊」这类推脱回复")
        : bad("回复推脱无法建群", vis2.slice(-260));
      !forbiddenHit(vis2)
        ? ok("建群回合可见区没有「已计划…」调试行")
        : bad("建群调试行", forbiddenHit(vis2));
      await win.screenshot({ path: path.join(ART, "uj-j2-room-created.png") });
      (readJson(ROOMS, { rooms: [] }).rooms || []).length === roomsBefore + 1
        ? ok("这一句只新增 1 个群（没有顺手建出别的）")
        : bad("群数量异常", JSON.stringify({ before: roomsBefore, after: (readJson(ROOMS, { rooms: [] }).rooms || []).length }));

      await sendComposer(PH2);
      const made2 = await waitUntil(async () => Boolean(roomRow(T2)), 45000);
      made2 && (roomRow(T2).members || []).length === 3
        ? ok("说法二「建个群叫 UJAbc2，把 …、… 拉进来」同样真建群")
        : bad("PH2 未建群", JSON.stringify(roomRow(T2) && roomRow(T2).members));

      await sendComposer(PH3);
      const made3 = await waitUntil(async () => Boolean(roomRow(T3)), 45000);
      made3 && (roomRow(T3).members || []).length === 2
        ? ok("说法三「把 … 和 … 拉到 UJAbc3 群」建群成功（2 人也算）")
        : bad("PH3 未建群", JSON.stringify(roomRow(T3) && roomRow(T3).members));

      // 负例：有名字不存在 → 点名说清，不建残群、不假装成功
      const beforeBad = (readJson(ROOMS, { rooms: [] }).rooms || []).length;
      await sendComposer(PHBAD);
      const answered = await waitUntil(async () => {
        const t = await lastAssistantVisible();
        return /UJGhostone|没找到|未找到|不存在/.test(t) ||
          (readJson(ROOMS, { rooms: [] }).rooms || []).length !== beforeBad;
      }, 45000);
      const visBad = await lastAssistantVisible();
      const noRoom = !roomRow(T4);
      const roomsUnchanged = (readJson(ROOMS, { rooms: [] }).rooms || []).length === beforeBad;
      // stub 会把用户原话整段回显，所以「回复里出现 UJGhostone」本身不算证据；
      // 必须同时出现「没找到」这类明确的失败措辞，才算产品真的认出了这个名字。
      const saysNotFound = /没找到|未找到|不存在|找不到|没有叫|查无/.test(visBad);
      answered && noRoom && roomsUnchanged && /UJGhostone/.test(visBad) && saysNotFound
        ? ok("名字不存在时点名告知 UJGhostone 未找到，且一个群都没新建")
        : bad("负例不诚实或建了残群", JSON.stringify({ answered, noRoom, roomsUnchanged, saysNotFound, tail: visBad.slice(0, 260) }));
      !/已创建|创建成功|已经建好|建好了/.test(visBad)
        ? ok("失败路径的回复没有假装成功的文案")
        : bad("失败路径假装成功", visBad.slice(0, 260));
      await win.screenshot({ path: path.join(ART, "uj-j2-name-not-found.png") });

      // 幂等：同成员同群名在短时窗内重复 → 只有一个群
      const sameSet = () => (readJson(ROOMS, { rooms: [] }).rooms || []).filter((r) => {
        if (!r || r.title !== T1) return false;
        const m = (r.members || []).slice().sort().join(",");
        return m === [idX, idY, idZ].slice().sort().join(",");
      }).length;
      const roomsBeforeDup = (readJson(ROOMS, { rooms: [] }).rooms || []).length;
      const dupBefore = sameSet();
      const recBeforeDup = readRecords(REC_MAIN).length;
      await sendComposer(PH1);
      // 等这一句真过了 provider（回合结束）再数群：固定 sleep 在慢机器上会假绿。
      await waitUntil(() => readRecords(REC_MAIN).length > recBeforeDup, 45000);
      await new Promise((r) => setTimeout(r, 3000));
      const dupAfter = sameSet();
      const dupTotal = (readJson(ROOMS, { rooms: [] }).rooms || []).length;
      if (dupBefore !== 1) {
        bad("幂等无法取证", JSON.stringify({ dupBefore, note: "重复句之前 " + T1 + " 就不止 0/1 个（建房本身已失败，见 PH1）" }));
      } else if (dupAfter === 1 && dupTotal === roomsBeforeDup) {
        ok("重复同一句不产生重复群（同成员同群名仍只有 1 个 " + T1 + "）");
      } else {
        bad("重复同一句后群变多", JSON.stringify({ dupBefore, dupAfter, total: dupTotal, totalBefore: roomsBeforeDup }));
      }
      evidence.j2 = {
        room_ids: { [T1]: (roomRow(T1) || {}).id, [T2]: (roomRow(T2) || {}).id, [T3]: (roomRow(T3) || {}).id },
        [T4]: roomRow(T4) ? roomRow(T4).id : null,
        system_rows: sysRow,
      };
    } catch (e) { bad("J2 崩溃", String((e && e.message) || e)); }

    /* ================= J3 ================= */
    console.log("\n— J3 群内多 Bot 各用各的职责 —");
    try {
      if (!roomRow(T1)) {
        console.log("  · [取证兜底] J2 没建出 " + T1 + "（红色已记录于 J2），改用内核已支持的英文指令建房，"
          + "让 J3/J4 的群上下文、汇总、provider 断言照样取证");
        if (!(await seedRoomByCommand(T1, [idX, idY, idZ].filter(Boolean)))) {
          throw new Error("兜底建房也没建出 " + T1 + "，J3 无从开始");
        }
      }
      await reopenRoom(T1);
      const recBefore3 = readRecords(REC_MAIN).length;
      await sendComposer("@" + X.name + " @" + Y.name + " 各自说明你负责什么，并给本周计划");
      const twoReplies = await waitUntil(() => rowsOf(T1, "bot_reply").length >= 2, 200000);
      const reps = rowsOf(T1, "bot_reply");
      const rx = reps.filter((r) => r && r.bot_id === idX).map((r) => String(r.text || "")).join("\n");
      const ry = reps.filter((r) => r && r.bot_id === idY).map((r) => String(r.text || "")).join("\n");
      /* GP-152 修正我这版门禁的口径：stub 用 ECHO_ALL 时，bot_reply 的正文就是整份
         载荷的回显，里面必然带着共享的群成员名单（名单含全员职责，§1 J3 要求）。
         所以「行级」只能断言正面（各人确实带着自己的职责发言），互不串味的反面
         放到载荷的人设段上验（见下面 responder 人设互串）。真实模型不会有这种
         回显，但用回显做证据时就必须按这个边界断言，否则断言在构造上永假。 */
      twoReplies && rx.includes(X.job) && ry.includes(Y.job)
        ? ok("两条 bot_reply 各自带上了自己的职责（反面在人设段验）")
        : bad("群内职责缺失", JSON.stringify({ twoReplies, x: rx.slice(0, 160), y: ry.slice(0, 160) }));
      const roomRecs = readRecords(REC_MAIN).slice(recBefore3);
      const responderRecs = roomRecs.filter((r) => /名字：/ .test(sysText(r)) && /当前群聊：/.test(sysText(r)));
      responderRecs.length >= 2
        ? ok("每个 responder 的 provider 请求都带当前群上下文（" + responderRecs.length + " 条）")
        : bad("群上下文未进 provider", JSON.stringify({ n: roomRecs.length, heads: roomRecs.map((r) => sysText(r).slice(0, 80)) }));
      const rc = responderRecs[0] || null;
      const sysRC = rc ? sysText(rc) : "";
      sysRC.includes(T1) && [X.name, Y.name, Z.name].every((n) => sysRC.includes(n))
        ? ok("群上下文含群名与完整成员名单（3 个名字都在）")
        : bad("群名/成员名单缺失", sysRC.slice(0, 320));
      [X.name, Y.name, Z.name].every((n) => sysRC.includes(n) && /职责[：:]/.test(sysRC))
        ? ok("成员名单带职责描述（不只是名字）")
        : bad("成员职责缺失", sysRC.slice(0, 320));
      sysRC.includes("本轮被 @") && sysRC.includes(X.name) && sysRC.includes(Y.name)
        ? ok("群上下文写明本轮被 @ 的是哪两个")
        : bad("本轮被 @ 缺失", sysRC.slice(0, 320));
      const rX = responderRecs.find((r) => sysText(r).includes("名字：" + X.name)) || null;
      const rY = responderRecs.find((r) => sysText(r).includes("名字：" + Y.name)) || null;
      rX && rY && personaText(rX).includes(X.job) && !personaText(rX).includes(Y.job)
        && personaText(rY).includes(Y.job) && !personaText(rY).includes(X.job)
        ? ok("两个 responder 的 system 人设段各自只带自己的职责（同群也不共享人设）")
        : bad("responder 人设互串", JSON.stringify({ x: rX && personaText(rX).slice(0, 160), y: rY && personaText(rY).slice(0, 160) }));
      await win.screenshot({ path: path.join(ART, "uj-j3-group-two-replies.png") });

      // 成员列表可见性：不再回答「我无法查看群成员列表」
      const beforeCount = rowsOf(T1, "bot_reply").length;
      await sendComposer("这个群有哪些成员？");
      const answeredMembers = await waitUntil(
        () => Promise.resolve(rowsOf(T1, "bot_reply").length > beforeCount), 200000);
      const newReplies = rowsOf(T1, "bot_reply").slice(beforeCount).map((r) => String(r.text || "")).join("\n");
      const allNames = [X.name, Y.name, Z.name].every((n) => newReplies.includes(n));
      answeredMembers && allNames && !/无法查看群成员|看不到群成员/.test(newReplies)
        ? ok("问「这个群有哪些成员」答出全名单（不再自称看不到成员）")
        : bad("成员列表问答", JSON.stringify({ answeredMembers, allNames, txt: newReplies.slice(0, 240) }));

      // DM 与 room 会话隔离：同一个 Bot 回到私聊不得带群上下文
      const recBefore3c = readRecords(REC_MAIN).length;
      await openDm(idX, X.name);
      await sendComposer("你负责什么？");
      const dmAgain = await waitUntil(() => readRecords(REC_MAIN).length > recBefore3c, 120000);
      const dmRec = readRecords(REC_MAIN).slice(recBefore3c).pop() || null;
      const dmSys = dmRec ? sysText(dmRec) : "";
      dmAgain && dmSys.includes(X.job) && !/当前群聊：|群成员：/.test(dmSys)
        ? ok("群聊过后回到该 Bot 私聊：上下文不含群名/成员（DM 与 room 会话隔离）")
        : bad("DM 仍带群上下文", dmSys.slice(0, 320));
      /* 会话隔离：Host 契约（main.js:1217）是「群回合用独立 sessionId
         room-<roomId>-<botId>，永不写进 Bot 的 DM 会话」。所以真正要断言的是
         隔离，而不是 sessions.json 里必须零个 room- 前缀。 */
      const sessAll = readJson(SESSIONS, { sessions: [] }).sessions || [];
      const dmText = JSON.stringify(sessAll.filter((s) => / · DM$/.test(String((s && s.title) || ""))));
      !dmText.includes("各自说明你负责什么") && !/"kind":"(bot_reply|final_report)"/.test(dmText)
        ? ok("群回合与汇报没有落进任何 DM 会话")
        : bad("群回合漏进 DM 会话", dmText.slice(0, 200));
      const roomSess = sessAll.filter((s) => /^room-/.test(String((s && s.id) || "")));
      const listed = await win.evaluate(() => Array.from(
        document.querySelectorAll("#session-list .agent-item")).map((el) => el.getAttribute("data-session-id") || ""));
      roomSess.every((s) => !listed.includes(s.id))
        ? ok("room-* 会话（" + roomSess.length + " 条）都不出现在 DM 会话列表里（" + listed.length + " 条列表项）")
        : bad("DM 会话列表混入 room-* 会话", JSON.stringify({ roomIds: roomSess.slice(0, 3).map((s) => s.id), listed: listed.slice(0, 5) }));
      evidence.j3 = {
        bot_reply_rows: rowsOf(T1, "bot_reply").length,
        responder_sys_head: sysRC.slice(0, 500),
        dm_sys_after_room: dmSys.slice(0, 300),
      };
    } catch (e) { bad("J3 崩溃", String((e && e.message) || e)); }

    /* ================= J4 ================= */
    console.log("\n— J4 final_report / partial / 无调试行 / zh-TW / provider —");
    try {
      /* final_report（两人都成功那一轮） */
      if (roomRow(T1)) {
        await reopenRoom(T1);
        const rep = reportsOf(T1).find((r) => r && r.total === 2 && r.returned === 2 && r.partial === false) || null;
        const cards = await win.evaluate(() => Array.from(
          document.querySelectorAll("#log .msg.room-report")).map((el) => el.innerText || ""));
        rep
          ? ok("两 responder 都成功 → final_report 2/2 partial=false（共 " + reportsOf(T1).length + " 轮）")
          : bad("final_report 汇总", JSON.stringify(reportsOf(T1).map((r) => ({ total: r.total, returned: r.returned, partial: r.partial }))));
        cards.length > 0 && cards.some((c) => /2\/2/.test(c))
          ? ok("群线程渲染出汇总卡（" + cards.length + " 张，含 2/2 那张）")
          : bad("汇总卡未渲染", JSON.stringify(cards.slice(0, 2)).slice(0, 300));
        await win.screenshot({ path: path.join(ART, "uj-j4-final-report.png") });
      } else bad("J4 前置缺群", T1 + " 不存在");

      /* partial：注入一个 Bot 失败 → 1/2 + 点名 + 原因，绝不编造成功 */
      const idF = await uiCreateBot(F);
      if (!idF) throw new Error("失败夹具 Bot " + F.name + " 没建出来，partial 无从注入");
      await useMainComposer();
      await sendComposer(PHPART);
      const madeP = await waitUntil(async () => Boolean(roomRow(TP)), 45000);
      if (!madeP) {
        console.log("  · [取证兜底] " + TP + " 没被中文指令建出来（红色已记录于 J2 同型路径），改用英文指令建房继续取证 partial");
        if (!(await seedRoomByCommand(TP, [idX, idF].filter(Boolean)))) throw new Error("partial 用的群没建出来（" + TP + "）");
      }
      await reopenRoom(TP);
      await sendComposer("@" + X.name + " @" + F.name + " 各自说明你负责什么");
      const gotPartial = await waitUntil(() => reportsOf(TP).length >= 1, 200000);
      const repP = lastReport(TP);
      const secsP = (repP && repP.sections) || [];
      gotPartial && repP.total === 2 && repP.returned === 1 && repP.partial === true
        ? ok("注入单 Bot 失败后如实 partial 1/2（不编造成功汇总）")
        : bad("partial 汇总", JSON.stringify(repP && { total: repP.total, returned: repP.returned, partial: repP.partial }));
      const badSec = secsP.find((s) => s && s.ok === false);
      badSec && String(badSec.name) === F.name && String(badSec.summary || "").trim().length > 0
        ? ok("partial 点名失败的 Bot（" + (badSec && badSec.name) + "）并带原因")
        : bad("partial 未点名失败者", JSON.stringify(secsP.map((s) => ({ n: s.name, ok: s.ok }))));
      const cardP = await win.evaluate(() => {
        const els = Array.from(document.querySelectorAll("#log .msg.room-report"));
        const last = els[els.length - 1];
        return last ? { cls: last.className, text: last.innerText || "" } : null;
      });
      cardP && /1\/2/.test(cardP.text) && /room-partial/.test(cardP.cls) && !/已全部收齐/.test(cardP.text)
        ? ok("UI partial 卡显示 1/2 且文案不谎称收齐")
        : bad("UI partial 卡", JSON.stringify(cardP && cardP.text.slice(0, 200)));
      cardP && (cardP.text || "").includes(F.name)
        ? ok("UI 汇总卡里能看到失败的那个 Bot 名字")
        : bad("UI 汇总卡未点名", (cardP && cardP.text || "").slice(0, 200));
      await win.screenshot({ path: path.join(ART, "uj-j4-partial.png") });

      /* 全程调试行扫描：DOM + 会话持久层 + rooms.json 本轮新增行。
         这里上一轮用错了口径（我的门禁 bug）：logAll() 取的是 #log 的完整
         textContent，连 .debug-only 一起算，等于要求「隐藏层里也不许出现」——
         而 §0 明确允许旧调试行只在渲染层隐藏/过滤、不改写文件。改成两层断言：
           1) 产品可见区（logVisible，已排除 .debug-only）必须零命中 —— 这才是
              用户能否走通的标准；
           2) 原始 textContent 里若还有命中，必须逐条落在 .debug-only 行内，
              出现「命中但在可见行」即判红。 */
      const visOnly = await logVisible();
      const hitVis = forbiddenHit(visOnly);
      !hitVis ? ok("DOM 产品可见区全程无调试串") : bad("DOM 可见区残留调试串", hitVis);
      const audit = await win.evaluate((needles) => {
        const box = document.getElementById("log");
        const rows = box ? Array.from(box.querySelectorAll(".msg")) : [];
        const hidden = rows.filter((el) => el.classList.contains("debug-only"));
        const visible = rows.filter((el) => !el.classList.contains("debug-only"));
        const hiddenText = hidden.map((el) => el.innerText || "").join("\n");
        const visibleText = visible.map((el) => el.innerText || "").join("\n");
        const raw = box ? (box.textContent || "") : "";
        const hits = needles.filter((n) => raw.includes(n));
        return {
          rawHits: hits,
          stillVisible: hits.filter((n) => visibleText.includes(n)),
          covered: hits.filter((n) => hiddenText.includes(n)).length,
          hiddenRows: hidden.length,
          totalRows: rows.length,
        };
      }, FORBIDDEN);
      audit.stillVisible.length === 0
        ? ok("原始 DOM 命中全部在 .debug-only 内（可见 " + audit.totalRows + " 行 / 调试 " +
             audit.hiddenRows + " 行，命中 " + audit.rawHits.join(",") + "）")
        : bad("有调试串出现在非 debug-only 行", audit.stillVisible.join(","));
      const sessRows = (readJson(SESSIONS, { sessions: [] }).sessions || [])
        .filter((s) => s && Array.isArray(s.messages))
        .flatMap((s) => s.messages.map((m) => String((m && m.text) || "")));
      const newSess = sessRows.filter((t) => /UJ/.test(t) || /你负责什么|这个群有哪些成员|创建到一个|拉进来|拉到/.test(t));
      const hitSess = newSess.map(forbiddenHit).find(Boolean);
      !hitSess ? ok("sessions 持久层本轮新增行无调试串（" + newSess.length + " 行相关）")
        : bad("sessions 残留调试串", hitSess);
      const ujRooms = (readJson(ROOMS, { rooms: [] }).rooms || []).filter((r) => r && /^UJ/.test(String(r.title || "")));
      const ujTx = JSON.stringify(ujRooms.map((r) => r.transcript || []));
      const hitTx = forbiddenHit(ujTx);
      !hitTx ? ok("rooms.json 本轮新增行无调试串") : bad("rooms.json 残留调试串", hitTx);

      /* 模型密钥输入框高度 + 横向溢出。先确认面板在产品态可达：可达性本身是一条
         独立断言，不能拿「量不到元素」冒充「高度 220px 的缺陷」。 */
      const sheetVia = await openModelSheet();
      sheetVia
        ? ok("产品态能打开模型/供应商面板（入口：" + sheetVia + "）")
        : bad("产品态打不开模型/供应商面板", "设置→凭证 没有通往 #model-modal 的入口，表头 chip 又被 grok-ui 隐藏 —— P1-5/P1-6 的用户前置");
      for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
        await win.setViewportSize(vp);
        await new Promise((r) => setTimeout(r, 300));
        if (sheetVia) await openModelSheet();
        const m = await win.evaluate(() => {
          const key = document.querySelector("#model-modal .ms-key");
          const h = key ? Math.round(key.getBoundingClientRect().height) : -1;
          const over = document.documentElement.scrollWidth - window.innerWidth;
          return { h, over, shown: Boolean(key) };
        });
        if (!sheetVia) {
          bad(vp.width + "×" + vp.height + " 密钥输入框高度无法取证", "面板不可达（见上一条红色），不是高度缺陷");
        } else {
          m.h >= 32 && m.h <= 48
            ? ok(vp.width + "×" + vp.height + " 密钥输入框高度 " + m.h + "px（32–48 合同内）")
            : bad(vp.width + "×" + vp.height + " 密钥输入框高度异常", m.h + "px（要求 32–48）");
        }
        m.over <= 0
          ? ok(vp.width + "×" + vp.height + " 无横向溢出")
          : bad(vp.width + "×" + vp.height + " 横向溢出", "scrollWidth+" + m.over);
        await win.screenshot({ path: path.join(ART, "uj-j4-key-input-" + vp.width + ".png") });
        await win.keyboard.press("Escape").catch(() => {});
        await win.click("#model-close", { timeout: 10000 }).catch(() => {});
        await win.click("#settings-close", { timeout: 10000 }).catch(() => {});
      }
    } catch (e) { bad("J4（final_report/partial/卫生/尺寸）崩溃", String((e && e.message) || e)); }

    /* zh-TW 真生效 + 语言在 reload 后保持 */
    try {
      await win.setViewportSize({ width: 1280, height: 800 });
      await openSettings("general");
      await win.waitForSelector("#settings-panel #gp-language", { state: "visible", timeout: 20000 });
      await win.selectOption("#gp-language", "zh-TW", { timeout: 20000 });
      const applied = await waitUntil(async () => {
        const st = readJson(SETTINGS, {});
        return st.language === "zh-TW";
      }, 30000);
      applied ? ok("设置→语言 选繁體中文已持久化（settings.json language=zh-TW）")
        : bad("语言未持久化", JSON.stringify(readJson(SETTINGS, {}).language));
      await new Promise((r) => setTimeout(r, 1500));
      const tw = await win.evaluate(() => ({
        panel: (document.getElementById("settings-panel") || {}).innerText || "",
        modelPanel: (document.getElementById("model-body") || {}).innerText || "",
        body: document.body.innerText || "",
        sel: (document.getElementById("gp-language") || {}).value || "",
        follow: (document.body.innerText || "").split("跟隨系統").length - 1,
        followCn: (document.body.innerText || "").split("跟随系统").length - 1,
      }));
      /語言/.test(tw.panel) && /一般/.test(tw.panel)
        ? ok("zh-TW 下设置页签与语言区是繁体（一般／語言）")
        : bad("设置页未转繁体", tw.panel.slice(0, 220));
      // 英文残留只看我们知道的界面 chrome 词，且区分大小写，
      // 免得把 <code>language</code> 这类标识符误判成文案缺陷。
      // GP-152 修正我这版门禁的口径：body 级扫描会把「用户自己的 Bot 数据」
      // 也算进去 —— 默认 Bit Bot 的 job 是用户数据 "General assistant"（§0
      // 不许改写），界面如实显示它不是 chrome 残留。所以先把 bots.json 里的
      // 名称/职责/简介从文本里剔除，再查 chrome 词。
      const userBotTexts = (readJson(BOTS, { bots: [] }).bots || [])
        .flatMap((b) => [b && b.name, b && b.job, b && b.description])
        .filter((s) => s && String(s).trim());
      const chromeText = userBotTexts.reduce(
        (acc, s) => acc.split(String(s)).join(""),
        tw.panel + "\n" + tw.modelPanel + "\n" + tw.body,
      );
      const enHits = (chromeText.match(/General|Computer|Credentials|Marketplace|Settings|Sign in|Updates|Usage/g) || []).filter((v, i, a) => a.indexOf(v) === i);
      enHits.length === 0
        ? ok("界面无英文 chrome 残留（General/Computer/Marketplace/…；用户 Bot 数据除外）")
        : bad("zh-TW 残留英文", enHits.join(","));
      /* 委派 两字简繁同形（繁体也是「委派任務」），单独出现不能当简体证据；
         要抓就抓简体专属的 委派任务（vs 繁体 委派任務）。 */
      const cnHits = (tw.panel.match(/设置|语言|时区|隐私|群组|外观|审批|执行命令|发送消息|发起购买|调用工具|操作电脑|委派任务/g) || []).filter((v, i, a) => a.indexOf(v) === i);
      cnHits.length === 0
        ? ok("设置页无简体残留")
        : bad("zh-TW 残留简体", cnHits.join(","));
      tw.follow === 1
        ? ok("「跟隨系統」文案只出现 1 次（没有重复标签）")
        : bad("「跟隨系統」重复/缺失", JSON.stringify({ tw: tw.follow, cn: tw.followCn }));
      await win.screenshot({ path: path.join(ART, "uj-j4-zhtw-settings.png") });
      await win.click("#settings-close", { timeout: 10000 }).catch(() => {});

      await win.reload({ timeout: 90000 });
      await win.waitForSelector("#composer #text", { timeout: 60000 });
      await openSettings("general");
      await win.waitForSelector("#settings-panel #gp-language", { state: "visible", timeout: 20000 });
      const afterReload = await win.evaluate(() => ({
        sel: (document.getElementById("gp-language") || {}).value || "",
        panel: (document.getElementById("settings-panel") || {}).innerText || "",
      }));
      afterReload.sel === "zh-TW" && /語言/.test(afterReload.panel) && /一般/.test(afterReload.panel)
        ? ok("reload 后仍是繁体（下拉与画面一致）")
        : bad("reload 后语言被覆盖", JSON.stringify(afterReload).slice(0, 240));
      await win.screenshot({ path: path.join(ART, "uj-j4-zhtw-after-reload.png") });
      await win.click("#settings-close", { timeout: 10000 }).catch(() => {});
    } catch (e) { bad("zh-TW 旅程崩溃", String((e && e.message) || e)); }

    /* provider 切换：真打到的 Base URL / Authorization 必须跟着当前 provider 走 */
    try {
      const useProvider = async (pid) => {
        if (!(await openModelSheet())) throw new Error("模型/供应商面板在产品态打不开，provider 切换无从下手");
        const sel = '#model-modal .ms-card[data-provider-id="' + pid + '"] .ms-use';
        await win.waitForSelector(sel, { timeout: 20000 });
        await win.click(sel, { timeout: 20000 });
        await waitUntil(() => win.evaluate((p) => {
          const card = document.querySelector('#model-modal .ms-card[data-provider-id="' + p + '"]');
          return Boolean(card && card.querySelector(".ms-badge.is-ready"));
        }, pid), 60000);
        await win.click("#model-close", { timeout: 10000 }).catch(() => {});
        await win.click("#settings-close", { timeout: 10000 }).catch(() => {});
      };

      if (!(await openModelSheet())) throw new Error("模型/供应商面板在产品态打不开（provider 旅程前置）");
      await win.waitForSelector('#model-modal .ms-card[data-provider-id="qwen"]', { timeout: 20000 });
      const useBtn = '#model-modal .ms-card[data-provider-id="qwen"] .ms-use';
      const hasUse = await win.evaluate((sel) => Boolean(document.querySelector(sel)), useBtn);
      await win.click("#model-close", { timeout: 10000 }).catch(() => {});
      await win.click("#settings-close", { timeout: 10000 }).catch(() => {});
      hasUse
        ? ok("qwen 卡片出现「设为当前模型」按钮（provider 级密钥已配置且非当前）")
        : bad("qwen 无设为当前按钮", "provider 目录没把 provider 级 env 当已配置");

      const beforeM = readRecords(REC_MAIN).length;
      const beforeQ = readRecords(REC_QWEN).length;
      await useProvider("qwen");
      await useMainComposer();
      await sendComposer("UJPROVSWITCH 验证当前 provider");
      const hitQ = await waitUntil(() => readRecords(REC_QWEN).length > beforeQ, 180000);
      const qRec = readRecords(REC_QWEN).slice(beforeQ).pop() || null;
      const newMain = readRecords(REC_MAIN).slice(beforeM);
      hitQ && qRec
        ? ok("切到 qwen 后请求真打到 qwen 的 stub（端口 " + (qRec.port || P_QWEN) + " " + qRec.url + "）")
        : bad("切 provider 后仍没打到 qwen stub", JSON.stringify({ hitQ, newMain: newMain.length }));
      qRec && qRec.auth_sha256 === H_QWEN
        ? ok("qwen 请求的 Authorization 来自 provider 级密钥（sha256 " + qRec.auth_sha256 + "）")
        : bad("qwen 请求用了错误的密钥", JSON.stringify({ got: qRec && qRec.auth_sha256, want: H_QWEN, main_would_be: H_MAIN }));
      newMain.length === 0
        ? ok("切到 qwen 后没有任何请求还打到全局 DeepSeek stub")
        : bad("切 provider 后仍打到全局 stub", JSON.stringify({ n: newMain.length, sha: newMain.map((r) => r.auth_sha256) }));
      qRec && String(qRec.url || "").includes("/chat/completions") && /qwen/.test(String(qRec.model || ""))
        ? ok("qwen 请求路径与 model 来自当前 provider 配置（" + (qRec.model || "") + "）")
        : bad("qwen 请求 model/url 不符", JSON.stringify(qRec && { url: qRec.url, model: qRec.model }));
      const visQ = await lastAssistantVisible();
      visQ.includes("UJQWEN-PROVIDER-REPLY")
        ? ok("界面回复文本来自 qwen stub（回执真来自当前 provider）")
        : bad("界面回执不来自 qwen stub", visQ.slice(0, 200));

      // 切回 DeepSeek：下一个请求必须回到主 stub 用主密钥
      const backM = readRecords(REC_MAIN).length;
      const backQ = readRecords(REC_QWEN).length;
      await useProvider("deepseek");
      await sendComposer("UJPROVBACK 验证切回");
      const backOk = await waitUntil(() => readRecords(REC_MAIN).length > backM, 180000);
      const mRec = readRecords(REC_MAIN).slice(backM).pop() || null;
      backOk && mRec && mRec.auth_sha256 === H_MAIN && readRecords(REC_QWEN).length === backQ
        ? ok("切回 DeepSeek 后请求与密钥回到主 stub（sha256 " + mRec.auth_sha256 + "，qwen stub 零新增）")
        : bad("切回后 provider/密钥没跟着切", JSON.stringify({ backOk, got: mRec && mRec.auth_sha256, qwen_new: readRecords(REC_QWEN).length - backQ }));
      // 密钥原文绝不进证据文件
      const dumps = [REC_MAIN, REC_QWEN].map((f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
      !dumps.includes(KEY_MAIN) && !dumps.includes(KEY_QWEN)
        ? ok("provider 记录里没有密钥原文（只有 sha256 前缀）")
        : bad("记录里出现密钥原文", "must never happen");
      const sessText = JSON.stringify(readJson(SESSIONS, { sessions: [] }).sessions || []);
      !sessText.includes(KEY_MAIN) && !sessText.includes(KEY_QWEN)
        ? ok("会话持久层没有密钥原文")
        : bad("会话里出现密钥原文", "must never happen");
      evidence.j4 = Object.assign(evidence.j4 || {}, {
        provider_switch: {
          qwen_url: qRec && qRec.url, qwen_model: qRec && qRec.model,
          qwen_auth_sha256: qRec && qRec.auth_sha256,
          back_auth_sha256: mRec && mRec.auth_sha256,
          main_requests_after_switch: newMain.length,
        },
      });
    } catch (e) { bad("provider 切换旅程崩溃", String((e && e.message) || e)); }

    /* 重启后语言必须还在（zh-TW 单一真相，不被刷新覆盖） */
    try {
      await quitApp();
      await newWindow();
      await win.setViewportSize({ width: 1280, height: 800 });
      await openSettings("general");
      await win.waitForSelector("#settings-panel #gp-language", { state: "visible", timeout: 20000 });
      await new Promise((r) => setTimeout(r, 1200));
      const afterRestart = await win.evaluate(() => ({
        sel: (document.getElementById("gp-language") || {}).value || "",
        panel: (document.getElementById("settings-panel") || {}).innerText || "",
      }));
      afterRestart.sel === "zh-TW" && /語言/.test(afterRestart.panel) && /一般/.test(afterRestart.panel)
        ? ok("重启后仍是繁体（语言不被启动流程覆盖回简体）")
        : bad("重启后语言被覆盖", JSON.stringify(afterRestart).slice(0, 240));
      await win.screenshot({ path: path.join(ART, "uj-j4-zhtw-after-restart.png") });
      // 复原语言，避免把测试选择留给用户
      await win.selectOption("#gp-language", "zh-CN", { timeout: 20000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      await win.click("#settings-close", { timeout: 10000 }).catch(() => {});
    } catch (e) { bad("重启后语言检查崩溃", String((e && e.message) || e)); }

    evidence.finished_at = new Date().toISOString();
  } catch (e) {
    bad("门禁整体崩溃", String((e && e.stack) || e).slice(0, 500));
  } finally {
    await quitApp().catch(() => {});
    if (stubMain) { try { stubMain.kill("SIGKILL"); } catch { /* ignore */ } }
    if (stubQwen) { try { stubQwen.kill("SIGKILL"); } catch { /* ignore */ } }
    try { execSync('pkill -9 -f "dist/[e]lectron"', { stdio: "ignore" }); } catch { /* ignore */ }
    try { execSync('pkill -9 -f "openai_compat_stub.js"', { stdio: "ignore" }); } catch { /* ignore */ }
    try { fs.writeFileSync(path.join(ART, "uj-journeys-evidence.json"), JSON.stringify(evidence, null, 2)); } catch { /* ignore */ }
    // 运行期文件复原：不删用户历史，只回到本次运行前的样子
    const restore = (p, buf) => { if (buf !== null) fs.writeFileSync(p, buf); else if (fs.existsSync(p)) fs.rmSync(p, { force: true }); };
    try {
      restore(ROOMS, snap.rooms);
      restore(SESSIONS, snap.sessions);
      restore(BOTS, snap.bots);
      restore(SETTINGS, snap.settings);
      restore(LLM_ACTIVE, snap.llmActive);
    } catch (e) { console.log("  ! 运行期文件复原失败：" + String((e && e.message) || e)); }
  }
  console.log("\ne2e_desktop_user_journeys: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=0");
  console.log("artifacts: " + ART + "（截图 + uj-provider-main.jsonl / uj-provider-qwen.jsonl / uj-journeys-evidence.json）");
  process.exit(FAIL > 0 ? 1 : 0);
})();
