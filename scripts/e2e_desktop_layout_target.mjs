/* e2e_desktop_layout_target.mjs — Layout Contract v1 real-render gates.
 *
 * Launches the REAL app (hosts/desktop/main.js) through Electron under xvfb
 * at fixed 1440x900 and 1280x800 content-viewport windows, drives the single
 * panel state source (setPanel via evaluate), and asserts:
 *   D-L-xx  geometry vs contract (header 56 / sidebar 280 / rail 340 /
 *           stream column <=760 / main = viewport - sidebar - rail, ±2px),
 *           region-rect non-overlap, no horizontal scroll, <=1 visible rail,
 *           panel=none contributes 0 rail width (no empty rail),
 *           default state at boot (sidebar expanded, panel none, no modal).
 *   D-D-xx  debug surfaces absent by default; present with dev-mode.
 *   D-C-xx  visible-copy scan (zh-CN no unlisted English; keys 3-lang parity).
 * Skips honestly (and prints SKIP with the reason) when electron/xvfb are
 * unavailable — a skipped gate is NEVER a PASS.
 *
 * static prove_*.js regex probes remain LINT ONLY (target-v1.md §5).
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, isolatedRepoRoot, gateAppEnv } from "./electron_env.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const OUT = path.join(REPO, "docs/design/desktop-target/reference");
let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 240) : "")); };
const skip = (m, why) => { SKIP++; console.log("  · SKIP " + m + " — " + why); };

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_layout_target: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_layout_target: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
/* 只有 Linux 才需要 X server。macOS / Windows 自带窗口系统，没有 DISPLAY 是
 * 正常的 —— 初版把跳过条件写成"没有 xvfb-run 且没有 DISPLAY"，于是 macOS 上
 * 这个门禁永远在第一行就 SKIP，一次都没真跑过。假跳过不是 PASS。
 * （同类问题 electron_bin.mjs 的头注释已经提过一次。） */
if (process.platform === "linux" && !process.env.DISPLAY) {
  let hasXvfb = false;
  try {
    execSync("command -v xvfb-run", { stdio: "ignore" });
    hasXvfb = true;
  } catch {
    /* none */
  }
  if (!hasXvfb) {
    console.log("e2e_desktop_layout_target: SKIP — no DISPLAY and no xvfb-run");
    console.log("e2e_desktop_layout_target: PASS=0 FAIL=0 SKIP=1");
    process.exit(0);
  }
}
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));

const { _electron } = require("playwright-core");

const BAND = 2;
const near = (a, b) => Math.abs(a - b) <= BAND;

/* The shell hides to tray on window close (main.js win.on("close")); a bare
 * app.close() would hang forever. Force the real quit path, like the boot e2e. */
async function shutdown(app) {
  try {
    await app.evaluate(({ app: electronApp }) => {
      electronApp.isQuiting = true;
      electronApp.quit();
    });
    await app.close();
  } catch {
    /* already gone */
  }
}

let launchSeq = 0;
async function launchWith(w, h, opts = {}) {
  const cmdEnvArgs = [];
  if (opts.devmode) cmdEnvArgs.push("--bitbot-devmode");
  if (opts.devmode) process.env.BITBOT_DEVMODE = "1";
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [
      path.join(DESKTOP, "main.js"),
      "--no-sandbox",
      "--disable-gpu",
      ...cmdEnvArgs,
      /* 独立 user data 目录：Chromium 的单例锁会和正在运行的 app 抢同一个目录，
         抢输的那个实例直接退出，门禁就变成"随机启动失败"。 */
      "--user-data-dir=" + electronUserDataDir("layout-target-" + ++launchSeq),
    ],
    cwd: REPO,
    /* ELECTRON_RUN_AS_NODE=1 会让 electron 退化成纯 node（ipcMain 是 undefined），
       这里显式剔除。BITBOT_REPO_ROOT 把应用数据指向隔离目录；
       BITBOT_DESKTOP_AUTOSTART=0 不去改用户 macOS 的开机自启设置。 */
    env: electronLaunchEnv(gateAppEnv(ISO_ROOT)),
  });
  const win = await app.firstWindow();
  // native menu bar would eat 27px of the fixed content viewport; hide it for
  // the gate run (product behavior unchanged)
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) { w.setAutoHideMenuBar(true); w.setMenuBarVisibility(false); }
  }).catch(() => {});
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  // Fixed content viewport per the contract (1440x900 / 1280x800).
  // The app window is frameless under xvfb, so resizeTo maps 1:1 to content.
  await win.evaluate(([W, H]) => { window.resizeTo(W, H); }, [w, h]);
  await win.waitForTimeout(300);
  return { app, win };
}

/* geometry probe: returns the contract table for the CURRENT live state */
const GEOMETRY_PROBE = `(() => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; };
  const vis = (el) => { const s = getComputedStyle(el); return el.offsetWidth > 0 && s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0; };
  const q = (s) => document.querySelector(s);
  const rails = ['#bot-rail','#conv-rail','#computer-rail','#machines'].map(q).filter(Boolean);
  return {
    panel: document.body.dataset.panel || 'none',
    sidebar: document.body.dataset.sidebar || 'expanded',
    header: q('header') && rect(q('header')),
    agents: q('#agents') && rect(q('#agents')),
    main: rect(q('#main')),
    composer: rect(q('#composer')),
    log: rect(q('#log')),
    railEls: rails.map(el => ({ id: el.id, w: el.getBoundingClientRect().width, visible: vis(el) })),
    msgMax: Math.max(0, ...Array.from(document.querySelectorAll('#log .msg')).map(e => e.getBoundingClientRect().width)),
    hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    openModal: !!Array.from(document.querySelectorAll('.bb-modal')).find(el => getComputedStyle(el).display !== 'none'),
  };
})()`;

const rectsOverlap = (a, b) =>
  a && b && a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

function checkState(g, vpW, state) {
  const collapsed = g.sidebar === "collapsed";
  const expRail = state === "none" || state === "collapsed" ? 0 : 340;
  const expMainW = vpW - (collapsed ? 0 : 280) - expRail;
  if (!near(g.header.h, 56)) bad(`1440/${state}: header h=${g.header.h} ≠ 56±${BAND}`);
  if (!near(g.agents.w, collapsed ? 0 : 280)) bad(`${state}: agents w=${g.agents.w}`);
  if (!near(g.main.w, expMainW)) bad(`${state}: main w=${g.main.w} ≠ ${expMainW}±${BAND}`);
  const visibleRails = g.railEls.filter((r) => r.visible);
  if (visibleRails.length !== (expRail ? 1 : 0)) bad(`${state}: visible rails=${visibleRails.length}`, JSON.stringify(g.railEls));
  if (expRail && !near(visibleRails[0]?.w || -999, 340)) bad(`${state}: rail width=${visibleRails[0]?.w}`);
  if (g.hscroll > 0) bad(`${state}: horizontal scroll ${g.hscroll}px`);
  if (rectsOverlap(g.header, g.main) || rectsOverlap(g.agents, g.main) || rectsOverlap(g.header, g.agents))
    bad(`${state}: region rects overlap`);
  if (g.composer && rectsOverlap(g.main, g.composer)) bad(`${state}: main/composer vertical overlap`);
  if (g.msgMax > 760 + 0.5) bad(`${state}: msg column ${g.msgMax} > 760`);
}

/* 门禁的应用数据一律指向隔离的临时根目录，不碰真仓库的 data/desktop。
 *
 * 初版是把真仓库的 sessions/bots/rooms 清空（为了让 copy-scan 只看产品外壳，
 * 不看别的 e2e 跑剩的会话），跑完再还原回去。清空的是**用户真实的聊天历史**，
 * 而"跑完再还原"会输给 app 退出时的落盘 —— 还原输了就是用户的会话被清空。
 * 现在改成：整个 app 跑在 BITBOT_REPO_ROOT 指向的临时根目录里，store 天然是空的，
 * 真仓库一个字节都不动，最后还断言这一点。
 */
const ISO_ROOT = isolatedRepoRoot(REPO, "layout-target", {
  "sessions.json": { version: 1, active_id: "", sessions: [] },
  "bots.json": { version: 1, primary_id: "agent-bit", bots: [] },
  "rooms.json": { version: 1, rooms: [] },
});

/* 隔离要可自证。但断言得针对**因果**：本门禁的旧代码的泄漏形态是"把用户 store
 * 的数组清空成 [] 再还原，还原输给 app 落盘"——危害特征是**我开跑时还有内容
 * 的数组，现在空了**。
 * 不比字符串：同样"数组空了"，JSON 缩进/键序一变字符串就对不上，判据会漏。
 * 直接比语义（解析后比较数组长度）。
 * 也不比"运行前后字节一致"：仓库里另有几个门禁按真实 REPO_ROOT 跑，会写
 * data/desktop，比字节会被它们误伤——那不是本门禁的锅。 */
const REAL_STORES = ["sessions.json", "bots.json", "rooms.json"].map((f) =>
  path.join(REPO, "data/desktop", f)
);
const realSnap = REAL_STORES.map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f) : null]);
const realLeak = () => {
  for (const [f, buf] of realSnap) {
    if (buf === null) continue;
    const now = fs.existsSync(f) ? fs.readFileSync(f) : null;
    if (now === null) continue;
    let pre, post;
    try {
      pre = JSON.parse(buf.toString());
      post = JSON.parse(now.toString());
    } catch {
      continue; // 文件已不是合法 JSON（更糟），但不是"数组被清空"这一形态
    }
    for (const k of ["sessions", "bots", "rooms"]) {
      const before = pre && pre[k];
      const after = post && post[k];
      if (!Array.isArray(before) || !Array.isArray(after)) continue;
      if (before.length > 0 && after.length === 0) {
        return { file: f, key: k, before: before.length, after: after.length };
      }
    }
  }
  return null;
};

const STATES = ["none", "bot", "conv", "computer", "tools", "collapsed"];

async function runViewport(win, vpW, vpH, { devmode = true } = {}) {
  await win.waitForTimeout(150);
  let measured = null;
  for (const st of STATES) {
    await win.evaluate((s) => {
      if (s === "collapsed") {
        if (typeof setPanel === "function") setPanel("none");
        if (typeof applySidebarCollapse === "function") applySidebarCollapse(true);
      } else {
        if (typeof applySidebarCollapse === "function") applySidebarCollapse(false);
        if (typeof setPanel === "function") setPanel(s);
      }
    }, st);
    await win.waitForTimeout(320); // transition settles
    const g = await win.evaluate(GEOMETRY_PROBE);
    const vw = g.viewport.w;
    measured = measured || { w: g.viewport.w, h: g.viewport.h };
    if (st === "tools" && !devmode) {
      g.panel === "none" ? ok("D-D-02: setPanel(tools) refused with dev-mode off")
        : bad("D-D-02 tools without devmode", g.panel);
      continue;
    }
    // tolerate window-manager width differences: main formula uses the LIVE viewport
    checkState(g, vw, st);
    if (g.viewport.h && Math.abs(g.viewport.h - vpH) > 8) skip(`${st} @${vpW}`, `viewport h=${g.viewport.h} ≠ ${vpH}`);
  }
  // reset to none/expanded
  await win.evaluate(() => { setPanel("none"); applySidebarCollapse(false); });
  await win.waitForTimeout(250);
  const shot = await win.screenshot({ type: "png" });
  fs.writeFileSync(path.join(OUT, `live-${vpW}x${vpH}-none.png`), shot);
  /* 结论里写**实测**视口，不写请求值。窗口高度会被系统按可用屏幕高度钳住
   * （本机 availHeight=858，1440x900 那档实际量到的是 1440x858），
   * 汇总行若写 "@1440" 会让人以为 1440x900 已被覆盖。 */
  return measured;
}

async function debugGate(win, { devmode }) {
  const SEL = ["[data-lab]", "#probe-connectors", "#tool-webfetch", "#tool-device", "#cu-open"];
  await win.evaluate((dm) => {
    document.body.toggleAttribute("data-devmode-marker");
    if (dm) document.body.dataset.devmode = "on"; else delete document.body.dataset.devmode;
  }, devmode);
  await win.waitForTimeout(200);
  const hits = await win.evaluate((sels) => sels.map((s) => {
    const list = Array.from(document.querySelectorAll(s));
    return { s, count: list.length, visible: list.filter((e) => e.offsetWidth > 0 && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden").length };
  }), SEL);
  return hits;
}

// Allowlist mirrors docs/design/desktop-target/i18n-allowlist.json (brands,
// technical identifiers). Kept short + explicit; the JSON is the source of
// truth and this list is generated from it at gate time when present.
let COPY_ALLOW_HINTS = ["Bit Bot", "MoonBit", "Bot", "Computer", "Routine", "Skill", "Plugin",
  "Connect apps", "Voice", "Email", "Slack", "DeepSeek", "CM-", "GP-", "bot-", "session",
  "http", "https", "example.com", "workspace", "data/", "json", "PNG", "URL", "API", "IPC",
  "Ctrl", "Cmd", "Shift", "Space", "Host", "Electron", "Web", "ID", "ID:", "DM", "New Bot"];
try {
  const AL = JSON.parse(fs.readFileSync(path.join(REPO, "docs/design/desktop-target/i18n-allowlist.json"), "utf8"));
  if (Array.isArray(AL) && AL.length) COPY_ALLOW_HINTS = AL.map((e) => e.text || e.token || String(e)).filter(Boolean);
} catch { /* keep fallback hints */ }

/* copy scan over the RENDERED DOM (zh-CN default language).
 * Contract copy-contract.md §4: violation = VISIBLE node without CJK and
 * not per-item allowlisted (docs/design/desktop-target/i18n-allowlist.json).
 * Mixed-language visible strings are counted separately (advisory metric for
 * report.md: dynamic-copy migration progress), never a silent pass. */
const COPY_PROBE = `(() => {
  const allow = ${JSON.stringify(COPY_ALLOW_HINTS)};
  const visible = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (s.display === 'none' || p.hidden) return false; } return el.offsetParent !== null || el.getClientRects().length > 0; };
  const texts = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; const seen = new Set();
  const hasCJKg = /[\\u4e00-\\u9fff]/g;
  while ((n = walk.nextNode())) {
    const t = (n.textContent || "").trim();
    if (t.length > 3 && /[A-Za-z][A-Za-z][A-Za-z]+/.test(t)) {
      const tag = n.parentElement && n.parentElement.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") continue;
      if (!visible(n.parentElement)) continue;
      if (!seen.has(t)) { seen.add(t); texts.push(t.slice(0, 80)); }
    }
  }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
    if (!visible(el)) continue;
    for (const attr of ['placeholder','title','aria-label']) {
      const v = (el.getAttribute(attr) || '').trim();
      if (v.length > 3 && /[A-Za-z][A-Za-z][A-Za-z]+/.test(v) && !seen.has(v)) { seen.add(v); texts.push(v.slice(0, 80)); }
    }
  }
  const hasCJK = /[\\u4e00-\\u9fff]/;
  const allowHit = (t) => allow.some((a) => t.includes(a));
  const violations = texts.filter((t) => !hasCJK.test(t) && !allowHit(t));
  const mixed = texts.filter((t) => hasCJK.test(t) && (t.replace(hasCJKg, " ").match(/[A-Za-z]{4,}/g) || []).length >= 2);
  return { total: texts.length, violations: violations.slice(0, 40), mixedCount: mixed.length, mixedSample: mixed.slice(0, 8) };
})()`;

/* D-C-03: three-language key parity (source-level, deterministic) */
{
  const html = fs.readFileSync(path.join(DESKTOP, "index.html"), "utf8");
  const ANCHORS = { "zh-CN": "\n      \"zh-CN\": {", "zh-TW": "\n      \"zh-TW\": {", en: "\n      en: {" };
  const starts = ["zh-CN", "zh-TW", "en"].map((l) => html.indexOf(ANCHORS[l]));
  const dictEnd = html.indexOf("\n    };", starts[2]);
  const grab = (lang) => {
    const idx = ["zh-CN", "zh-TW", "en"].indexOf(lang);
    const start = starts[idx];
    const end = idx < 2 ? starts[idx + 1] : dictEnd;
    if (start < 0 || end < 0) return null;
    const seg = html.slice(start, end);
    const keys = new Set();
    for (const m of seg.matchAll(/^\s{8}([A-Za-z][\w]*): /gm)) keys.add(m[1]);
    return keys;
  };
  const z = grab("zh-CN"), t2 = grab("zh-TW"), e = grab("en");
  if (!z || !t2 || !e) bad("D-C-03 dictionary sections not found");
  else {
    const miss = (a, b) => Array.from(a).filter((k) => !b.has(k));
    const d1 = miss(z, t2).concat(miss(z, e), miss(t2, z), miss(t2, e), miss(e, z), miss(e, t2));
    d1.length === 0 ? ok(`D-C-03: zh-CN/zh-TW/en key sets identical (${z.size} keys each)`)
      : bad("D-C-03 key drift", JSON.stringify([...new Set(d1)].slice(0, 12)));
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let app, win;
  try {
    ({ app, win } = await launchWith(1440, 900));
  } catch (e) {
    bad("boot", (e && e.message) || String(e));
    console.log("\ne2e_desktop_layout_target: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
    process.exit(1);
  }
  try {
    /* D-DEFAULT boot state */
    const g0 = await win.evaluate(GEOMETRY_PROBE);
    g0.panel === "none" ? ok("D-DEFAULT: boot data-panel=none") : bad("D-DEFAULT panel", g0.panel);
    g0.sidebar !== "collapsed" ? ok("D-DEFAULT: boot sidebar expanded") : bad("D-DEFAULT sidebar collapsed at boot");
    !g0.openModal ? ok("D-DEFAULT: no modal open at boot") : bad("D-DEFAULT modal open");
    g0.railEls.every((r) => !r.visible) ? ok("D-DEFAULT: rail column contributes 0 width (no empty rail)")
      : bad("D-DEFAULT empty rail", JSON.stringify(g0.railEls));

    /* D-L geometry across states, 1440x900 */
    const m1440 = await runViewport(win, 1440, 900, { devmode: false });
    ok(`D-L-01..06: panel states geometry @${m1440.w}x${m1440.h} dev-off (contract table, ±2px, overlap/hscroll)`);

    /* D-D debug surfaces (dev-mode off) */
    const off = await debugGate(win, { devmode: false });
    const onVis = off.filter((h) => h.visible > 0);
    onVis.length === 0 ? ok("D-D-01: debug selectors 0 visible with dev-mode off")
      : bad("D-D-01 debug visible by default", JSON.stringify(onVis));


    await shutdown(app);
  } catch (e) {
    bad("gate block", (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
    try { await shutdown(app); } catch {}
  }

  /* second viewport pass (retry: previous app process may still hold userData) */
  try {
    let b = null;
    let lastErr = "";
    for (let i = 0; i < 3 && !b; i++) {
      await new Promise((r) => setTimeout(r, 3000 + i * 2000));
      try { b = await launchWith(1280, 800, { devmode: true }); } catch (e) { lastErr = (e && e.message) || String(e); }
    }
    if (!b) throw new Error("launch retries exhausted — " + lastErr.split("\n")[0]);
    ({ app, win } = b);
    const m1280 = await runViewport(win, 1280, 800, { devmode: true });
    ok(`D-L-07..12: 6 panel states geometry @${m1280.w}x${m1280.h} dev-on (incl. tools)`);
    /* dev-mode ON: debug surfaces appear + badge visible + tools panel allowed */
    const on = await debugGate(win, { devmode: true });
    const badge = await win.evaluate(() => {
      const b = document.getElementById("devmode-badge");
      return !!b && b.offsetWidth > 0 && !b.hidden;
    });
    const labsVisible = on.filter((h) => h.visible > 0).map((h) => h.s);
    badge && labsVisible.includes("[data-lab]") ? ok("D-D-03: dev-mode on reveals " + labsVisible.join(",") + " + badge")
      : bad("D-D-03 dev-mode reveal broken", JSON.stringify({ badge, labsVisible, on }));
    const toolsOk = await win.evaluate(() => { setPanel("tools"); return document.body.dataset.panel; });
    toolsOk === "tools" ? ok("D-D-04: tools rail available in dev-mode") : bad("D-D-04", toolsOk);
    await win.evaluate(() => setPanel("none"));
    /* copy scan on the zeroed-store window (real product surface only) */
    const copy = await win.evaluate(COPY_PROBE);
    copy.violations.length === 0
      ? ok(`D-C-01: zh-CN visible copy clean (${copy.total} visible nodes, 0 unlisted English)`)
      : bad("D-C-01 unlisted English", JSON.stringify(copy.violations.slice(0, 20)));
    console.log("  · D-C-04 advisory: mixed-language visible nodes=" + copy.mixedCount + " " + JSON.stringify(copy.mixedSample));
    await shutdown(app);
  } catch (e) {
    bad("1280 pass", (e && e.message) || String(e));
  }

  /* 门禁自己不能污染用户数据 —— 隔离要可自证 */
  const leak = realLeak();
  !leak
    ? ok("D-S-01: 用户的 data/desktop 没有被本门禁清空（门禁跑在隔离根目录里）")
    : bad("D-S-01 真仓库的 data/desktop 被本门禁改了", JSON.stringify(leak));
  try { fs.rmSync(ISO_ROOT, { recursive: true, force: true }); } catch { /* 残留不影响判定 */ }

  console.log("\ne2e_desktop_layout_target: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
})();
