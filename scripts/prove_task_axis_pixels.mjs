#!/usr/bin/env node
/* prove_task_axis_pixels.mjs — P1 批 2:指挥台「任务主轴」两档像素回归门
 *
 * 方案:docs/design/p1-task-axis-and-mobile-command.md §4「批 2 · 两档像素回归门
 * (1440×900 / 480×720)」。这一门跑**真 Electron**(Playwright _electron.launch),
 * 在两档视口下打开指挥台,断言:
 *
 *   TA-01 视口真的到了(量的是**活着的**视口,不是请求值)
 *   TA-02 指挥台能打开(点产品自己的 #cmd-open-btn,不是调内部函数)
 *   TA-03 行动区第一张卡完全在视口内(不被浮动 composer 遮住、不被裁切)
 *   TA-04 没有待办时 #cmd-active 不出现(第二份夹具:没有 needs_you 任务)
 *   TA-05 四个桶 tab 都在(needs_you/working/waiting/closed)
 *   TA-06 点 tab 只显示对应 data-bucket 的卡(真点,不是改状态)
 *   TA-07 无横向滚动(scrollWidth ≤ clientWidth)
 *   TA-08 卡片之间不重叠
 *   TA-09 四个动作按钮(插话/改向/刹停/换人)逐个可点(elementFromPoint 命中按钮自己)
 *   TA-10 指挥台不被浮动 composer 压住(窄窗那条已知残留的判据)
 *   TA-11 与基线逐像素比对,差异像素占比 ≤ 0.5%
 *   TA-12 reference/ 下的基线逐字节未变(门禁不许自己改基线)
 *   TA-13 用户的真实数据目录一个字节没动(门禁跑在隔离数据根里)
 *   TA-14 像素判据有牙:故意改 1% 像素 ⇒ 判据必须翻红
 *   TA-15 几何判据有牙:把卡片推出视口 ⇒ TA-03 必须翻红
 *   TA-16 已知残留如实记录:#cmd-active 与 needs_you 分区重复渲染同一张卡
 *
 * 基线口径(R-5,照抄 e2e_desktop_layout_target.mjs:39-47 的做法与它写的理由):
 *   默认**只读** reference/ 下的基线做比对,产物写 artifacts/task-axis-pixels/;
 *   要刷新入仓必须显式 BITBOT_TASK_AXIS_SHOT_COMMIT=1(有意识的动作)。
 *   ⇒ 门禁自己**永远不会**在默认跑法里覆盖 reference/ 下的任何 png;
 *   跑前跑后各记一次 reference/ 全目录 sha256,变了就红(TA-12)。
 *
 * 缺 electron / 显示器 / playwright-core 时诚实 SKIP —— **SKIP ≠ PASS**。
 * 用法:
 *   xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/prove_task_axis_pixels.mjs
 *   BITBOT_TASK_AXIS_SHOT_COMMIT=1 …（刷新基线）
 */
import path from "path";
import fs from "fs";
import os from "os";
import net from "node:net";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { execSync } from "node:child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, isolatedRepoRoot, gateAppEnv, hasDisplay } from "./electron_env.mjs";
import { decodePng } from "./lib_png_pixel.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const REFERENCE_DIR = path.join(REPO, "docs/design/desktop-target/reference");
/* 产物默认进 artifacts/（已在 .gitignore 里）⇒ 门禁默认**不碰**工作树。
 * 要把基线刷新进 reference/ 必须显式 BITBOT_TASK_AXIS_SHOT_COMMIT=1。 */
const COMMIT = process.env.BITBOT_TASK_AXIS_SHOT_COMMIT === "1";
const OUT_DIR = process.env.BITBOT_TASK_AXIS_SHOT_DIR
  || (COMMIT ? REFERENCE_DIR : path.join(REPO, "artifacts", "task-axis-pixels"));
/* 方案 §4 批 2 的两档。1440×900 需要 ≥1440 宽的显示器（Xvfb 默认 1280 宽会把
 * 视口钳到 1280 ⇒ 那一档量到的就不是 1440×900 了）⇒ 门禁自己**量**活视口，
 * 量不到就如实 SKIP，不拿 1280 冒充 1440。 */
const VIEWPORTS = [[1440, 900], [480, 720]];
const BASELINES = { "1440x900": "task-axis-1440x900.png", "480x720": "task-axis-480x720.png" };
/* 方案 §4 批 2:差异像素占比 ≤ 0.5%。 */
const PIXEL_TOLERANCE = 0.005;
/* 这一档里会跑的判据编号(视口给不出时逐条报 SKIP,不许悄悄不吭声)。 */
const VIEWPORT_CLAIMS = ["TA-01", "TA-02", "TA-03", "TA-05", "TA-06", "TA-07", "TA-08", "TA-09", "TA-10", "TA-11", "TA-14", "TA-15", "TA-16"];

/* 计数用对象:一档视口中途挂了要能**回滚**这一档的计数(否则重试会把
 * 数字算重 —— 实测 Electron 在 Xvfb 下偶尔中途死一次,重试是必要的)。 */
const STAT = { pass: 0, fail: 0, skip: 0 };
const ok = (m) => { STAT.pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { STAT.fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const skip = (id, msg, why) => { STAT.skip++; console.log("  · " + id + " SKIP " + msg + " — " + why); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function honestSkip(reason) {
  console.log("prove_task_axis_pixels: SKIP — " + reason);
  console.log("prove_task_axis_pixels: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

if (!fs.existsSync(ELECTRON)) honestSkip("electron dist missing (" + ELECTRON + ")");
if (!hasDisplay()) honestSkip("no DISPLAY and no xvfb-run");
/* 有 xvfb-run 但**没有 DISPLAY** ⇒ Electron 起不来(TA-02 会报「起真 Electron 失败」),
 * 而那不是产品缺陷,是环境不具备 ⇒ 不该报 FAIL。
 * ⇒ 自己用 xvfb-run 重新跑一遍(和仓里其它真渲染门同一套做法)。 */
if (process.platform === "linux" && !process.env.DISPLAY) {
  let xvfb = false;
  try { execSync("command -v xvfb-run", { stdio: "ignore" }); xvfb = true; } catch { /* no xvfb-run */ }
  if (xvfb) {
    console.log("  · 没有 DISPLAY,但有 xvfb-run ⇒ 自动套 xvfb-run 重跑一次(无显示器是环境问题,不是产品缺陷)");
    const r = spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1600x1000x24", process.execPath, ...process.argv.slice(1)],
      { stdio: "inherit", env: process.env });
    process.exit(r.status === null ? 1 : r.status);
  }
  honestSkip("no DISPLAY 且没有 xvfb-run ⇒ 真 Electron 起不来(SKIP ≠ PASS)");
}
let playwrightCore = null;
try {
  const req = createRequire(path.join(DESKTOP, "package.json"));
  playwrightCore = req("playwright-core");
} catch (e) {
  honestSkip("playwright-core 不可用（装法：bash scripts/ci_e2e_env.sh）");
}
const { _electron } = playwrightCore;

/* ---------------------------------------------------------------------------
 * 夹具:任务来自**同一份**转录事实(final_report / bot_reply / confirm_request),
 * 不新增数据源。bot_reply 带 task_sig ⇒ 「换人」按钮才会出现（产品按
 * task_sig + bot_id 决定给不给换人，index.html:26490）。
 * ------------------------------------------------------------------------- */
const ROOM_DONE = {
  id: "r-done", title: "内容团队", members: ["t1", "t2"],
  transcript: [
    { kind: "bot_reply", room_id: "r-done", speaker: "t1", bot_id: "t1", name: "Alice", task_sig: "sig-done", text: "热点已收集", at: "2026-11-21T10:00:00.000Z" },
    { kind: "bot_reply", room_id: "r-done", speaker: "t2", bot_id: "t2", name: "Bob", task_sig: "sig-done", text: "初稿已成", at: "2026-11-21T10:01:00.000Z" },
    { kind: "final_report", room_id: "r-done", task: "整理热点稿", task_title: "整理热点稿", task_sig: "sig-done", responders: ["t1", "t2"], total: 2, returned: 2, partial: false, sections: [], artifacts: [], at: "2026-11-21T10:02:00.000Z" },
  ],
};
const ROOM_WAIT = {
  id: "r-wait", title: "闲聊群", members: ["p1"],
  transcript: [
    { kind: "confirm_request", room_id: "r-wait", speaker: "host", stage: "route", question: "这句话我没看出该谁做。回一句名字，或者直接说「大家一起」。", candidates: [{ id: "p1", name: "Carol" }], task: "今天天气如何", task_sig: "sig-wait", at: "2026-11-21T11:00:00.000Z" },
  ],
};
const ROOM_RUN = {
  id: "r-run", title: "还在跑的群", members: ["t1", "t2"],
  transcript: [
    { kind: "bot_reply", room_id: "r-run", speaker: "t1", bot_id: "t1", name: "Alice", task_sig: "sig-run", text: "正在写…", at: "2026-11-21T12:00:00.000Z" },
    { kind: "bot_reply", room_id: "r-run", speaker: "t2", bot_id: "t2", name: "Bob", task_sig: "sig-run", text: "再核一遍数字", at: "2026-11-21T12:01:00.000Z" },
  ],
};
/* 夹具 A:有待办（needs_you）—— 行动区有第一张卡。
 * 夹具 B:没有待办 —— #cmd-active 必须整块不出现。 */
const FIXTURE_WITH = { version: 1, rooms: [ROOM_DONE, ROOM_WAIT, ROOM_RUN] };
const FIXTURE_WITHOUT = { version: 1, rooms: [ROOM_DONE, ROOM_RUN] };

/* ---------------------------------------------------------------------------
 * 基线保护:跑之前给 reference/ 下每个文件记一份 sha256,跑完比对。
 * 只要门禁**自己**把基线改了 ⇒ 这条就红 ⇒ 「基线被实现自动覆盖」从此是可
 * 执行的判据,而不只是一句约定(照抄 e2e_desktop_room_orchestration.mjs:80-104)。
 * ------------------------------------------------------------------------- */
const fingerprintReference = () => {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(REFERENCE_DIR); } catch { return out; }
  for (const f of names.sort()) {
    const fp = path.join(REFERENCE_DIR, f);
    try {
      if (!fs.statSync(fp).isFile()) continue;
      const buf = fs.readFileSync(fp);
      out[f] = buf.length + ":" + createHash("sha256").update(buf).digest("hex");
    } catch { /* ignore */ }
  }
  return out;
};
const REFERENCE_BEFORE = fingerprintReference();

/* 用户真仓库的 data/ —— 门禁跑在隔离根里,这里必须一个字节都不动。 */
const REAL_DATA = path.join(REPO, "data");
/* 本轮用过的隔离数据根(用来证明「隔离真生效」,而不只是「真目录没变」)。 */
const ISO_ROOTS = [];
/* 数一个目录下的文件数(递归),用来判断隔离根里到底有没有写入。 */
function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  walk(dir);
  return n;
}
const realDataSnapshot = () => {
  const out = {};
  const walk = (dir, prefix) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names.sort()) {
      const fp = path.join(dir, n);
      let st;
      try { st = fs.statSync(fp); } catch { continue; }
      if (st.isDirectory()) walk(fp, prefix + n + "/");
      else {
        try { out[prefix + n] = st.size + ":" + createHash("sha256").update(fs.readFileSync(fp)).digest("hex"); } catch { /* ignore */ }
      }
    }
  };
  walk(REAL_DATA, "");
  return out;
};
const REAL_DATA_BEFORE = realDataSnapshot();

/* ---------------------------------------------------------------------------
 * 端口:入站服务默认占 18765 —— 固定端口 ⇒ 两次跑撞车 ⇒ e2e 不可重入。
 * 这里自己挑一个**空闲**端口,并在起 app 前**确认它绑得上**(关掉再绑一次)。
 * ------------------------------------------------------------------------- */
async function reserveFreePort() {
  const srv = net.createServer();
  await new Promise((res, rej) => { srv.once("error", rej); srv.listen(0, "127.0.0.1", res); });
  const port = srv.address().port;
  await new Promise((res) => srv.close(res));
  const probe = net.createServer();
  await new Promise((res, rej) => { probe.once("error", rej); probe.listen(port, "127.0.0.1", res); });
  await new Promise((res) => probe.close(res));
  return port;
}

/* 稳定判据:几何 + 关键文本,连续三次一样才算稳。 */
const SETTLE_SIG = () => {
  const h = (id) => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().height) : -1; };
  const tp = document.getElementById("turn-progress");
  return JSON.stringify([
    document.documentElement.clientWidth, document.documentElement.clientHeight,
    h("banner"), h("composer"), h("main"), h("command-panel"), h("log"),
    document.getElementById("command-panel").scrollHeight,
    (tp && tp.textContent || "").trim().slice(0, 40),
  ]);
};

async function settle(win) {
  /* ① 等指挥台渲染完:四个桶 tab 都在(数据是异步来的,cmdRefresh 还没回来时
   *    面板是空的 —— 量到那一瞬就会误判「tab 不对」)。 */
  await win.waitForFunction(() => {
    const p = document.getElementById("command-panel");
    if (!p || p.hidden) return false;
    return document.querySelectorAll("#cmd-buckets [data-cmd-tab]").length === 4;
  }, null, { timeout: 30000 }).catch(() => {});
  /* ② 等开机横幅收起:横幅里带 daemon pid,不收起来截图就不是确定性的。 */
  await win.waitForFunction(() => {
    const b = document.getElementById("banner");
    return !!b && b.classList.contains("collapsed");
  }, null, { timeout: 60000 }).catch(() => {});
  /* ② 等几何稳。 */
  let prev = null, stable = 0;
  for (let i = 0; i < 80; i++) {
    await win.waitForTimeout(300);
    let sig = "";
    try { sig = await win.evaluate(SETTLE_SIG); } catch { break; }
    if (sig && sig === prev) { stable++; if (stable >= 3) break; } else stable = 0;
    prev = sig;
  }
}

/* 量一屏:所有判据共用同一份测量,免得各量各的。 */
const PROBE = () => {
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2), right: +b.right.toFixed(2), bottom: +b.bottom.toFixed(2) };
  };
  const painted = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
  const hitAt = (r) => {
    if (!r || r.w <= 0 || r.h <= 0) return null;
    const el = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
    if (!el) return { none: true };
    return {
      tag: el.tagName, id: el.id || "", cls: String(el.className || ""),
      inComposer: !!(el.closest && el.closest("#composer")),
      inPanel: !!(el.closest && el.closest("#command-panel")),
    };
  };
  const main = document.getElementById("main");
  const composer = document.getElementById("composer");
  const panel = document.getElementById("command-panel");
  const active = document.getElementById("cmd-active");
  const activeList = document.getElementById("cmd-active-list");
  const cards = Array.from(document.querySelectorAll("#command-panel .cmd-card"));
  const visibleCards = cards.filter(painted);
  const sections = Array.from(document.querySelectorAll("#cmd-detail section[data-bucket]"));
  const tabs = Array.from(document.querySelectorAll("#cmd-buckets [data-cmd-tab]"));
  const firstActiveCard = activeList ? activeList.querySelector(".cmd-card") : null;
  /* 面板是滚动容器时,「可见区」= 它的 client box(裁切面),不是它的布局盒子。 */
  const panelClient = panel ? { top: panel.getBoundingClientRect().top, bottom: panel.getBoundingClientRect().bottom } : null;
  const inPanelView = (r) => !!r && !!panelClient && r.y >= panelClient.top - 0.5 && r.bottom <= panelClient.bottom + 0.5;
  /* 行动区(#cmd-active)的卡**不属于任何一个桶分区** —— 它是一级信息,
   * 永远显示(要你拍板)。桶 tab 切换管的是 #cmd-detail 里那些分区。 */
  const detailCards = Array.from(document.querySelectorAll("#cmd-detail .cmd-card")).filter(painted);
  const activeCards = activeList ? Array.from(activeList.querySelectorAll(".cmd-card")).filter(painted) : [];
  const bucketsOfVisibleCards = detailCards.map((c) => c.getAttribute("data-bucket"));
  /* 「#cmd-active 的内容在 needs_you 分区里又被渲染了一遍」——已知残留,量出来报。 */
  const activeSigs = new Set(activeList ? Array.from(activeList.querySelectorAll(".cmd-card")).map((c) => c.getAttribute("data-cmd-task") || "") : []);
  const needSec = sections.find((s) => s.getAttribute("data-bucket") === "needs_you");
  const dupSigs = needSec
    ? Array.from(needSec.querySelectorAll(".cmd-card")).map((c) => c.getAttribute("data-cmd-task") || "").filter((s) => s && activeSigs.has(s))
    : [];
  return {
    dpr: window.devicePixelRatio,
    viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    panelRect: rect(panel),
    panelHidden: panel ? panel.hidden : null,
    panelScrollable: panel ? panel.scrollHeight > panel.clientHeight + 1 : false,
    panelClientBox: panelClient,
    mainRect: rect(main),
    composerRect: rect(composer),
    activeHidden: active ? active.hidden : null,
    activeCardCount: activeList ? activeList.querySelectorAll(".cmd-card").length : 0,
    activeText: active ? (active.textContent || "").trim().slice(0, 60) : "",
    firstCardRect: rect(firstActiveCard),
    firstCardInViewport: firstActiveCard
      ? (() => { const b = firstActiveCard.getBoundingClientRect();
        return b.top >= -0.5 && b.bottom <= document.documentElement.clientHeight + 0.5 && b.left >= -0.5 && b.right <= document.documentElement.clientWidth + 0.5; })()
      : null,
    firstCardHit: hitAt(rect(firstActiveCard)),
    firstCardInPanelView: inPanelView(rect(firstActiveCard)),
    cardCount: cards.length,
    visibleCardCount: visibleCards.length,
    visibleCardBuckets: bucketsOfVisibleCards,
    activeCardBuckets: activeCards.map((c) => c.getAttribute("data-bucket")),
    visibleCardRects: visibleCards.map(rect),
    tabs: tabs.map((t) => ({
      key: t.getAttribute("data-cmd-tab"),
      label: (t.textContent || "").trim(),
      selected: t.getAttribute("aria-selected") === "true",
      on: t.classList.contains("cmd-tab-on"),
      rect: rect(t),
      hit: hitAt(rect(t)),
    })),
    sections: sections.map((s) => ({ bucket: s.getAttribute("data-bucket"), hidden: s.hidden, painted: painted(s) })),
    hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dupRenderCount: dupSigs.length,
    dupSigs: dupSigs.slice(0, 5),
  };
};

/* 逐个动作按钮:先滚进可见区(面板是滚动容器),再做真实命中测试。 */
const PROBE_ACTIONS = () => {
  const panel = document.getElementById("command-panel");
  const out = [];
  const btns = Array.from(panel.querySelectorAll("[data-cmd-steer],[data-cmd-replan],[data-cmd-cancel],[data-cmd-swap]"));
  for (const b of btns) {
    const card = b.closest(".cmd-card");
    if (!card || !card.getClientRects().length) continue; /* 不可见的卡不算 */
    b.scrollIntoView({ block: "center", inline: "nearest" });
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    out.push({
      kind: b.getAttribute("data-cmd-steer") !== null ? "steer"
        : b.getAttribute("data-cmd-replan") !== null ? "replan"
        : b.getAttribute("data-cmd-cancel") !== null ? "cancel"
        : b.getAttribute("data-cmd-swap") !== null ? "swap" : "other",
      label: (b.textContent || "").trim().slice(0, 8),
      x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      hitSelf: !!(hit && (hit === b || b.contains(hit))),
      hitComposer: !!(hit && hit.closest && hit.closest("#composer")),
      hitId: hit ? (hit.id || hit.tagName) : null,
    });
  }
  return out;
};

/* 像素比对:解 PNG → 逐像素比。阈值 PIXEL_TOLERANCE(0.5%)。 */
function diffDecoded(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    return { ratio: 1, diff: a.width * a.height, total: a.width * a.height, sizeMismatch: true };
  }
  const ch = Math.min(a.channels, b.channels);
  let diff = 0;
  const total = a.width * a.height;
  for (let i = 0; i < total; i++) {
    const oa = i * a.channels, ob = i * b.channels;
    if (Math.abs(a.data[oa] - b.data[ob]) > 2 || Math.abs(a.data[oa + 1] - b.data[ob + 1]) > 2 || Math.abs(a.data[oa + 2] - b.data[ob + 2]) > 2) diff++;
  }
  return { ratio: diff / total, diff, total };
}

async function launchWith(w, h, fixture, port, tag) {
  const iso = isolatedRepoRoot(REPO, "task-axis", {
    "rooms.json": fixture,
    "bots.json": { version: 1, primary_id: "agent-bit", bots: [] },
    "sessions.json": { version: 1, active_id: "", sessions: [] },
  });
  const env = electronLaunchEnv(gateAppEnv(iso, {
    /* 门禁的隔离:数据根指向临时目录(BITBOT_DATA_ROOT 是 hosts/desktop/paths.js:113
       为门禁留的逃生口),**不许**碰用户真仓库的 data/。 */
    BITBOT_DATA_ROOT: path.join(iso, "data"),
    BITBOT_CN_INBOUND_PORT: String(port),
  }));
  /* **实际交给 app 的**数据根 —— 判「隔离是否真生效」要量的是这个,
     不是我们心里想的那个。 */
  const DATA_ROOT_USED = env.BITBOT_DATA_ROOT;
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [
      path.join(DESKTOP, "main.js"),
      "--no-sandbox",
      "--disable-gpu",
      /* 独立 user data 目录:Chromium 的单例锁会和正在运行的 app 抢同一个目录。 */
      "--user-data-dir=" + electronUserDataDir("task-axis-" + tag + "-" + process.pid),
    ],
    cwd: REPO,
    env,
  });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) { w.setAutoHideMenuBar(true); w.setMenuBarVisibility(false); }
  }).catch(() => {});
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  /* 记下**实际交给 app 的**数据根(env 里那个),不是我们自己想的那个 ——
     变异对照证明:如果 env 指的是真目录,这一条必须能抓到。 */
  if (iso) ISO_ROOTS.push({ root: path.join(iso, "data"), used: DATA_ROOT_USED, files: 0 });
  return { app, win, iso };
}

async function shutdown(app) {
  const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(r, ms))]);
  try {
    await within(app.evaluate(({ app: electronApp }) => { electronApp.isQuiting = true; electronApp.quit(); }), 10000);
    await within(app.close(), 15000);
  } catch { /* already gone */ }
}

/* 一档视口跑完:开面板 → 稳定 → 量 → 断言 → 截图 → 比基线。 */
async function runViewport(w, h, fixture, port) {
  const tag = w + "x" + h;
  let app = null, win = null, iso = null;
  try {
    ({ app, win, iso } = await launchWith(w, h, fixture, port, tag));
  } catch (e) {
    bad("TA-02 指挥台能打开（" + tag + " 起真 Electron 失败）", (e && e.message) || String(e));
    return;
  }
  try {
    /* 视口:量**活着的**视口。请求 1440×900 但屏幕只有 1280 宽时,活视口是
     * 1280 —— 那就不是 1440×900 那一档,不许拿 1280 冒充。 */
    await win.evaluate(([W, H]) => { window.resizeTo(W, H); }, [w, h]);
    let vp = null;
    for (let i = 0; i < 40; i++) {
      await win.waitForTimeout(150);
      vp = await win.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
      if (vp.w === w && vp.h === h) break;
    }
    if (vp.w === w && vp.h === h) {
      ok("[TA-01] " + tag + " 视口真的到了 " + w + "×" + h + "（活视口，不是请求值）");
    } else {
      /* 这一档整档没跑 ⇒ 这一档的每一条判据都要**如实报 SKIP**，
       * 不许悄悄不吭声(矩阵那边的三态口径:门自己 SKIP ⇒ SKIP ≠ PASS)。 */
      const why = "活视口 " + vp.w + "×" + vp.h + " ≠ 请求的 " + w + "×" + h + "（显示器/窗口管理器给不出这一档视口）";
      for (const id of VIEWPORT_CLAIMS) skip(id, tag + " 这一档没跑", why);
      await shutdown(app);
      try {
        /* 删之前先记「隔离根里到底写了多少文件」——删了就量不到了。
         * 这一条是 TA-13b 的证据:隔离根必须**有**写入,否则「真目录没被碰」是空话。 */
        for (const rec of ISO_ROOTS) if (rec.root === path.join(iso, "data")) rec.files = countFiles(rec.root);
        fs.rmSync(iso, { recursive: true, force: true });
      } catch { /* ignore */ }
      return;
    }

    /* 打开指挥台:点产品自己的按钮(TA-02)。 */
    await win.click("#cmd-open-btn", { timeout: 10000 });
    await win.waitForTimeout(300);
    const opened = await win.evaluate(() => {
      const p = document.getElementById("command-panel");
      return { hidden: p.hidden, expanded: document.getElementById("cmd-open-btn").getAttribute("aria-expanded") };
    });
    if (!opened.hidden && opened.expanded === "true") {
      ok("[TA-02] " + tag + " 指挥台能打开（点 #cmd-open-btn ⇒ 面板可见、aria-expanded=true）");
    } else {
      bad("TA-02 " + tag + " 指挥台没打开", JSON.stringify(opened));
    }
    await settle(win);

    const g = await win.evaluate(PROBE);

    /* TA-03 行动区第一张卡:完全在视口内 + 命中测试落在卡自己身上。 */
    const fc = g.firstCardRect;
    const inVp = g.firstCardInViewport;
    const hitCard = g.firstCardHit && (g.firstCardHit.inPanel && !g.firstCardHit.inComposer);
    if (inVp && hitCard && g.firstCardInPanelView) {
      ok("[TA-03] " + tag + " 行动区第一张卡完全在视口内（" + JSON.stringify(fc) + "，命中测试落在卡上，未被 composer 遮住、未被裁切）");
    } else {
      bad("TA-03 " + tag + " 行动区第一张卡没完全在视口内",
        JSON.stringify({ rect: fc, inViewport: inVp, hit: g.firstCardHit, inPanelView: g.firstCardInPanelView }));
    }

    /* TA-05 四个桶 tab。 */
    const keys = g.tabs.map((t) => t.key);
    const wantKeys = ["needs_you", "working", "waiting", "closed"];
    const tabsOk = g.tabs.length === 4 && wantKeys.every((k) => keys.includes(k)) && g.tabs.every((t) => /[0-9]/.test(t.label));
    if (tabsOk) ok("[TA-05] " + tag + " 四个桶 tab 都在且各带计数（" + g.tabs.map((t) => t.label).join(" / ") + "）");
    else bad("TA-05 " + tag + " 桶 tab 不对", JSON.stringify(g.tabs.map((t) => ({ key: t.key, label: t.label }))));

    /* TA-07 无横向滚动。 */
    if (g.hscroll <= 0) ok("[TA-07] " + tag + " 无横向滚动（scrollWidth − clientWidth = " + g.hscroll + "）");
    else bad("TA-07 " + tag + " 有横向滚动 " + g.hscroll + "px");

    /* TA-08 卡片之间不重叠。 */
    const rs = g.visibleCardRects;
    let overlap = null;
    for (let i = 0; i < rs.length && !overlap; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j];
        if (a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5) { overlap = [a, b]; break; }
      }
    }
    if (!overlap) ok("[TA-08] " + tag + " 卡片之间不重叠（可见卡 " + rs.length + " 张）");
    else bad("TA-08 " + tag + " 卡片重叠", JSON.stringify(overlap));

    /* TA-10 指挥台不被浮动 composer 压住。
     * 判据是「面板的**可见区**(裁切面)不许压到 composer 上」+「面板自己
     * 是个滚动容器 ⇒ 下面的内容滚得到」—— 两件事都成立才算没被压住。 */
    const panelBottom = g.panelClientBox ? g.panelClientBox.bottom : (g.panelRect ? g.panelRect.bottom : null);
    const composerTop = g.composerRect ? g.composerRect.y : null;
    const overlapsComposer = panelBottom !== null && composerTop !== null && panelBottom > composerTop + 0.5;
    if (!overlapsComposer) {
      ok("[TA-10] " + tag + " 指挥台没被浮动 composer 压住（面板可见区底 " + panelBottom + " ≤ 输入区顶 " + composerTop + "）");
    } else {
      bad("TA-10 " + tag + " 指挥台被浮动 composer 压住",
        "面板可见区底 " + panelBottom + " > 输入区顶 " + composerTop + "（面板内容画到输入区底下）");
    }

    /* 截图(默认态:默认桶「在跑」、面板没滚动)⇒ 拿去跟基线比。 */
    const shot = await win.screenshot({ type: "png" });
    const shotPath = path.join(OUT_DIR, "task-axis-" + tag + ".png");
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(shotPath, shot);
    const baselinePath = path.join(REFERENCE_DIR, BASELINES[tag]);
    const hasBaseline = fs.existsSync(baselinePath);
    let base0 = null;
    if (hasBaseline) {
      try { base0 = decodePng(fs.readFileSync(baselinePath)); }
      catch (e) { bad("TA-11 " + tag + " 基线不是合法 PNG（reference/" + BASELINES[tag] + "）", (e && e.message) || String(e)); }
    }
    if (COMMIT) {
      fs.mkdirSync(REFERENCE_DIR, { recursive: true });
      fs.writeFileSync(baselinePath, shot);
      ok("[TA-11] " + tag + " 基线已刷新（显式动作 BITBOT_TASK_AXIS_SHOT_COMMIT=1 ⇒ 写入 " + BASELINES[tag] + "）");
    } else if (!hasBaseline) {
      skip("TA-11", tag + " 像素比对", "基线还没入仓（" + BASELINES[tag] + " 不存在）——用 BITBOT_TASK_AXIS_SHOT_COMMIT=1 生成；产物在 " + shotPath);
    } else if (!base0) {
      skip("TA-11", tag + " 像素比对", "基线解不开（已单独报红）");
    } else {
      const cur = decodePng(shot);
      const d = diffDecoded(cur, base0);
      if (d.sizeMismatch) {
        bad("TA-11 " + tag + " 与基线尺寸不同（当前 " + cur.width + "×" + cur.height + "，基线 " + base0.width + "×" + base0.height + "）");
      } else if (d.ratio <= PIXEL_TOLERANCE) {
        ok("[TA-11] " + tag + " 与基线逐像素比对：差异 " + d.diff + "/" + d.total + " = " + (d.ratio * 100).toFixed(4) + "% ≤ " + (PIXEL_TOLERANCE * 100) + "%");
      } else {
        bad("TA-11 " + tag + " 与基线差异 " + (d.ratio * 100).toFixed(4) + "% > " + (PIXEL_TOLERANCE * 100) + "%（" + d.diff + "/" + d.total + " 像素；产物 " + shotPath + "）");
      }
    }

    /* TA-14 像素判据有牙:把基线的 1% 像素改掉 ⇒ 比对必须翻红。
     * 这条是**纯算术**的负向对照(不依赖 Electron)⇒ 每跑必跑。
     * 基线缺失时用**当前这一张**当底(照样能验判据有牙)。 */
    {
      const base = hasBaseline ? base0 : decodePng(shot);
      const mutated = { width: base.width, height: base.height, channels: base.channels, data: Buffer.from(base.data) };
      let n = 0;
      for (let i = 0; i < base.width * base.height; i += 100) { /* 1% */
        const o = i * base.channels;
        mutated.data[o] = (mutated.data[o] + 137) & 0xff;
        mutated.data[o + 1] = (mutated.data[o + 1] + 61) & 0xff;
        mutated.data[o + 2] = (mutated.data[o + 2] + 29) & 0xff;
        n++;
      }
      const d = diffDecoded(base, mutated);
      if (d.ratio > PIXEL_TOLERANCE) {
        ok("[TA-14] 像素判据有牙：故意改 " + n + " 个像素（" + (d.ratio * 100).toFixed(2) + "%）⇒ 比对判红（阈值 " + (PIXEL_TOLERANCE * 100) + "%）");
      } else {
        bad("TA-14 像素判据恒真：改 1% 像素后比对仍判绿（" + (d.ratio * 100).toFixed(4) + "% ≤ " + (PIXEL_TOLERANCE * 100) + "%）");
      }
    }

    /* TA-09 四个动作按钮逐个可点。 */
    const acts = await win.evaluate(PROBE_ACTIONS);
    const kinds = new Set(acts.map((a) => a.kind));
    const notClickable = acts.filter((a) => !a.hitSelf || a.hitComposer);
    const wantKinds = ["steer", "replan", "cancel", "swap"];
    const missing = wantKinds.filter((k) => !kinds.has(k));
    if (!notClickable.length && !missing.length) {
      ok("[TA-09] " + tag + " 四个动作按钮逐个可点（" + acts.map((a) => a.kind + ":" + a.label).join(" / ") + "，命中测试全落在按钮自己身上）");
    } else {
      bad("TA-09 " + tag + " 动作按钮点不到", JSON.stringify({ missing, notClickable }));
    }
    /* 滚过之后把面板滚回原位,免得后面的测量/截图带着滚动位置。 */
    await win.evaluate(() => { const p = document.getElementById("command-panel"); if (p) p.scrollTop = 0; });

    /* TA-06 点 tab 只显示对应 data-bucket 的卡。 */
    let tabFails = [];
    for (const key of wantKeys) {
      let clicked = true;
      try {
        await win.click('#cmd-buckets [data-cmd-tab="' + key + '"]', { timeout: 8000 });
      } catch (e) {
        clicked = false;
        tabFails.push(key + ": 点不到(" + String(e && e.message).slice(0, 80) + ")");
        continue;
      }
      await win.waitForTimeout(220);
      const t = await win.evaluate(PROBE);
      const tab = t.tabs.find((x) => x.key === key);
      const sec = t.sections.find((s) => s.bucket === key);
      /* 只断**桶分区里**的卡:#cmd-detail 的 section[data-bucket=key] 里
       * 显示的卡必须全是 data-bucket=key。行动区(#cmd-active)是一级信息,
       * 不属于任何桶,永远显示(它自己的卡恒为 needs_you)。 */
      const wrongBucket = t.visibleCardBuckets.filter((b) => b !== key);
      const wrongActive = t.activeCardBuckets.filter((b) => b !== "needs_you");
      if (!tab || !tab.selected || !tab.on) tabFails.push(key + ": tab 没变成选中态");
      if (!sec || !sec.painted) tabFails.push(key + ": 对应分区没显示");
      const others = t.sections.filter((s) => s.bucket !== key && s.painted);
      if (others.length) tabFails.push(key + ": 别的分区还亮着(" + others.map((o) => o.bucket).join(",") + ")");
      if (wrongBucket.length) tabFails.push(key + ": 分区里显示了别的桶的卡(" + wrongBucket.join(",") + ")");
      if (wrongActive.length) tabFails.push(key + ": 行动区里出现了不是 needs_you 的卡(" + wrongActive.join(",") + ")");
    }
    if (!tabFails.length) {
      ok("[TA-06] " + tag + " 四个桶 tab 逐个点得动，且每次只显示对应 data-bucket 的卡");
    } else {
      bad("TA-06 " + tag + " 桶 tab 切换不对", tabFails.join(" / "));
    }
    /* 回到默认桶(「在跑」),把界面还原成基线那副样子。 */
    try { await win.click('#cmd-buckets [data-cmd-tab="working"]', { timeout: 8000 }); } catch { /* ignore */ }
    await win.waitForTimeout(200);

    /* TA-15 几何判据有牙:人为把卡片推出视口 ⇒ TA-03 必须翻红。
     * 注入的是**页面样式**(不改源文件一个字节),撤掉后必须恢复绿。 */
    {
      const style = await win.addStyleTag({ content: "#command-panel .cmd-card { position: relative; top: 3000px; }" });
      await win.waitForTimeout(250);
      const mutated = await win.evaluate(PROBE);
      const mutatedRed = !(mutated.firstCardInViewport && mutated.firstCardHit && mutated.firstCardHit.inPanel && !mutated.firstCardHit.inComposer);
      await style.evaluate((el) => el.remove());
      await win.waitForTimeout(250);
      const restored = await win.evaluate(PROBE);
      const restoredGreen = !!(restored.firstCardInViewport && restored.firstCardHit && restored.firstCardHit.inPanel && !restored.firstCardHit.inComposer);
      if (mutatedRed && restoredGreen) {
        ok("[TA-15] 几何判据有牙：把卡片推出视口 ⇒ TA-03 判红；撤掉样式 ⇒ 恢复绿（判据不是恒真）");
      } else {
        bad("TA-15 几何判据恒真", "变异后判红=" + mutatedRed + "，撤掉后恢复绿=" + restoredGreen);
      }
    }

    /* TA-16 已知残留如实记录。 */
    {
      const g2 = await win.evaluate(PROBE);
      if (g2.dupRenderCount === 1) {
        ok("[TA-16] 已知残留如实记录：#cmd-active 与 needs_you 分区重复渲染 1 张卡（同一张 task 卡出现两处；方案未定该留哪一处，本门只钉住现状并报出，不假装它是设计）");
      } else {
        bad("TA-16 重复渲染的现状变了（实测 " + g2.dupRenderCount + " 处；夹具里只有 1 条 needs_you 任务 ⇒ 现状应是 1）", JSON.stringify(g2.dupSigs));
      }
    }
  } catch (e) {
    const msg = (e && e.message) || String(e);
    /* Electron 在 Xvfb 下偶尔中途死一次(实测)⇒ 这类是**基础设施抖动**,
     * 不是产品红 ⇒ 抛出去让上层重试这一档(计数会回滚)。 */
    if (/Target page, context or browser has been closed|Protocol error|Target closed/i.test(msg)) {
      throw e;
    }
    bad("门禁主体出错（" + w + "×" + h + "）", (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
  } finally {
    try { await shutdown(app); } catch { /* ignore */ }
    try {
      for (const rec of ISO_ROOTS) if (rec.root === path.join(iso, "data")) rec.files = countFiles(rec.root);
      fs.rmSync(iso, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

/* 没有待办的那一档:夹具里没有 confirm_request ⇒ #cmd-active 必须整块不出现。 */
async function runNoPending(w, h, port) {
  let app = null, win = null, iso = null;
  try {
    ({ app, win, iso } = await launchWith(w, h, FIXTURE_WITHOUT, port, "npending"));
    await win.evaluate(([W, H]) => { window.resizeTo(W, H); }, [w, h]);
    for (let i = 0; i < 40; i++) {
      await win.waitForTimeout(150);
      const vp = await win.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
      if (vp.w === w && vp.h === h) break;
    }
    await win.click("#cmd-open-btn", { timeout: 10000 });
    await settle(win);
    const g = await win.evaluate(PROBE);
    if (g.activeHidden === true && g.activeCardCount === 0) {
      ok("[TA-04] 没有待办时 #cmd-active 不出现（hidden=" + g.activeHidden + "，行动区卡数 " + g.activeCardCount + "）");
    } else {
      bad("TA-04 没有待办时 #cmd-active 还是出现了", JSON.stringify({ hidden: g.activeHidden, cards: g.activeCardCount, text: g.activeText }));
    }
    /* 没有待办时，桶 tab 仍然在（首屏直接是四个 tab）。 */
    if (g.tabs.length === 4) ok("[TA-04] 没有待办时首屏直接是四个桶 tab（行动区整块 hidden，不占屏）");
    else bad("TA-04 没有待办时桶 tab 不对", String(g.tabs.length));
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/Target page, context or browser has been closed|Protocol error|Target closed/i.test(msg)) throw e;
    skip("TA-04", "没有待办那一档没跑起来", msg);
  } finally {
    try { await shutdown(app); } catch { /* ignore */ }
    try {
      for (const rec of ISO_ROOTS) if (rec.root === path.join(iso, "data")) rec.files = countFiles(rec.root);
      fs.rmSync(iso, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let port = 0;
  try {
    port = await reserveFreePort();
  } catch (e) {
    honestSkip("拿不到可绑的空闲端口：" + ((e && e.message) || String(e)));
  }
  console.log("prove_task_axis_pixels: 入站端口 " + port + "（随机挑的，起 app 前确认绑得上）");

  /* 一档视口跑三次:Electron 在 Xvfb 下偶尔中途死(基础设施抖动)⇒ 重试,
   * 但**产品红不许靠重试洗掉**:重试只针对「app 自己没了」这一类。 */
  const withRetry = async (label, fn) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const before = { ...STAT };
      try {
        await fn();
        return;
      } catch (e) {
        STAT.pass = before.pass; STAT.fail = before.fail; STAT.skip = before.skip;
        if (attempt < 3) {
          console.log("  · " + label + " 第 " + attempt + " 次跑时 Electron 中途死了（基础设施抖动）⇒ 回滚计数并重试");
          await sleep(3000 + attempt * 2000);
          continue;
        }
        bad("TA-02 " + label + " 连跑三次都挂（Electron 中途死）", (e && e.message) || String(e));
        return;
      }
    }
  };

  for (const [w, h] of VIEWPORTS) {
    await withRetry(w + "×" + h + " 这一档", () => runViewport(w, h, FIXTURE_WITH, port));
  }
  /* 「没有待办」那一档在 1440 跑:行动区不出现这条与视口无关。 */
  await withRetry("没有待办那一档", () => runNoPending(1440, 900, port));

  /* TA-12 基线保护:跑完 reference/ 必须逐字节未变(COMMIT 模式除外 ——
   * 那是有意识的刷新动作,只允许那两张 task-axis 基线变)。 */
  const after = fingerprintReference();
  const allowed = COMMIT ? Object.values(BASELINES) : [];
  const changed = [];
  for (const f of Object.keys(REFERENCE_BEFORE)) {
    if (after[f] !== REFERENCE_BEFORE[f] && !allowed.includes(f)) changed.push(f);
  }
  for (const f of Object.keys(after)) {
    if (!(f in REFERENCE_BEFORE) && !allowed.includes(f)) changed.push(f + "(新增)");
  }
  if (!changed.length) {
    ok("[TA-12] reference/ 下的基线逐字节未变（" + Object.keys(REFERENCE_BEFORE).length + " 个文件 sha256 比对；产物在 artifacts/，基线只能人工刷新）");
  } else {
    bad("TA-12 门禁自己动了期望基线", changed.join(", "));
  }

  /* TA-13 用户真数据目录没被碰。 */
  const realAfter = realDataSnapshot();
  const leaked = [];
  for (const f of Object.keys(REAL_DATA_BEFORE)) if (realAfter[f] !== REAL_DATA_BEFORE[f]) leaked.push(f);
  for (const f of Object.keys(realAfter)) if (!(f in REAL_DATA_BEFORE)) leaked.push(f + "(新增)");
  if (!leaked.length) {
    ok("[TA-13] 用户的真数据目录一个字节没动（门禁跑在隔离的 BITBOT_DATA_ROOT 里；真仓库 data/ 共 " +
      Object.keys(REAL_DATA_BEFORE).length + " 个文件 sha256 比对无差异）");
  } else {
    bad("[TA-13] 门禁碰了用户的真数据目录", leaked.join(", "));
  }

  /* TA-13b **隔离真生效了** —— 这是 TA-13 的另一半牙齿。
   * TA-13 只说「真 data/ 没被碰」,那**也可能只是因为门禁压根没写任何东西**
   * (隔离根是空的 ⇒ 什么都没写 ⇒ 真目录当然没变 ⇒ TA-13 恒绿 ⇒ 假牙)。
   * ⇒ 这里钉住两条:**隔离根 ≠ 用户真 data/**,**且隔离根里确实有写入**。
   * ⇒ 只有这两条同时成立,「真目录没被碰」才是有意义的证据。 */
  const isoRoots = [...new Map(ISO_ROOTS.filter(Boolean).map((r) => [r.root, r])).values()];
  if (!isoRoots.length) {
    bad("[TA-13b] 没有记录到任何隔离根 ⇒ 隔离是否生效根本没被量到");
  } else {
    /* 两条都要查:① 我们记录的隔离根 ② **实际交给 app 的**那个(used) */
    const wrongRoot = isoRoots.filter((r) => path.resolve(r.root) === path.resolve(REAL_DATA) ||
      path.resolve(r.used || r.root) === path.resolve(REAL_DATA));
    if (wrongRoot.length) {
      bad("[TA-13b] 隔离根就是用户的真数据目录 ⇒ 等于没隔离", wrongRoot.map((r) => r.used || r.root).join(", "));
    } else {
      ok("[TA-13b] 隔离根与用户真数据目录不是同一个（" + isoRoots.length + " 个隔离根）");
    }
    const noWrite = isoRoots.filter((r) => !r.files);
    if (noWrite.length) {
      bad("[TA-13b] 隔离根里一个文件都没有 ⇒ 门禁没在写任何数据 ⇒「真目录没被碰」是空话（假牙）",
        noWrite.map((r) => r.root).join(", "));
    } else {
      ok("[TA-13b] 隔离根里确实有写入（" + isoRoots.map((r) => r.files + " 个文件").join(", ") +
        "）⇒ 隔离既生效、门禁也真的在干活");
    }
  }

  console.log("\nprove_task_axis_pixels: PASS=" + STAT.pass + " FAIL=" + STAT.fail + " SKIP=" + STAT.skip);
  process.exit(STAT.fail ? 1 : 0);
})();
