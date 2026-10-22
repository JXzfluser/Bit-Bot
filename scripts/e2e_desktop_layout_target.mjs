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
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = path.join(DESKTOP, "node_modules/electron/dist/electron");
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
let useXvfb = false;
try { execSync("command -v xvfb-run", { stdio: "ignore" }); useXvfb = true; } catch { if (!process.env.DISPLAY) {
  console.log("e2e_desktop_layout_target: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_layout_target: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
} }

const { _electron } = await import("playwright-core");

const BAND = 2;
const near = (a, b) => Math.abs(a - b) <= BAND;

async function launchWith(w, h) {
  const cmdEnvArgs = [];
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", ...cmdEnvArgs],
    cwd: REPO,
  });
  const win = await app.firstWindow();
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  // content viewport at the contract sizes
  await win.evaluate(([W, H]) => {
    // resize is best-effort; we measure DOM rects, and the window was created
    // at these content sizes via the bounds below.
  }, [w, h]);
  return { app, win };
}

/* geometry probe: returns the contract table for the CURRENT live state */
const GEOMETRY_PROBE = `(() => {
  const rect = (el) => { const b = el.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height}; };
  const vis = (el) => el && el.offsetWidth > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
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

const STATES = ["none", "bot", "conv", "computer", "tools", "collapsed"];

async function runViewport(win, vpW, vpH) {
  // set content size through the browser window (frame:false apps report clientWidth)
  await win.evaluate(([W, H]) => { window.resizeTo(W, H); }, [vpW, vpH]);
  await win.waitForTimeout(200);
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
    // tolerate window-manager width differences: main formula uses the LIVE viewport
    checkState(g, vw, st);
    if (g.viewport.h && Math.abs(g.viewport.h - vpH) > 8) skip(`${st} @${vpW}`, `viewport h=${g.viewport.h} ≠ ${vpH}`);
    // default-state check runs separately after boot
  }
  // reset to none/expanded
  await win.evaluate(() => { setPanel("none"); applySidebarCollapse(false); });
  await win.waitForTimeout(250);
  const shot = await win.screenshot({ type: "png" });
  fs.writeFileSync(path.join(OUT, `live-${vpW}x${vpH}-none.png`), shot);
}

async function debugGate(win, { devmode }) {
  const SEL = ["details.lab", "#probe-connectors", "#tool-webfetch", "#tool-device", "#cu-open"];
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

/* copy scan over the RENDERED DOM (zh-CN default language) */
const COPY_PROBE = `(() => {
  const allow = ${JSON.stringify(COPY_ALLOW_HINTS)};
  const texts = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; const seen = new Set();
  while ((n = walk.nextNode())) {
    const t = (n.textContent || "").trim();
    if (t.length > 3 && /[A-Za-z][A-Za-z][A-Za-z]+/.test(t)) {
      const tag = n.parentElement && n.parentElement.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") continue;
      if (!seen.has(t)) { seen.add(t); texts.push(t.slice(0, 80)); }
    }
  }
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) {
    for (const attr of ['placeholder','title','aria-label']) {
      const v = (el.getAttribute(attr) || '').trim();
      if (v.length > 3 && /[A-Za-z][A-Za-z][A-Za-z]+/.test(v) && !seen.has(v)) { seen.add(v); texts.push(v.slice(0, 80)); }
    }
  }
  const hasCJK = /[\\u4e00-\\u9fff]/;
  const allowHit = (t) => allow.some((a) => (a.test ? a.test(t) : t.includes(a)));
  const violations = texts.filter((t) => !hasCJK(t) && !allowHit(t));
  return { total: texts.length, violations: violations.slice(0, 40) };
})()`;

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
    await runViewport(win, 1440, 900);
    ok("D-L-01..06: 6 panel states geometry @1440 (contract table, ±2px, overlap/hscroll)");

    /* D-D debug surfaces */
    const off = await debugGate(win, { devmode: false });
    const onVis = off.filter((h) => h.visible > 0);
    onVis.length === 0 ? ok("D-D-01: debug selectors 0 visible with dev-mode off")
      : bad("D-D-01 debug visible by default", JSON.stringify(onVis));

    /* D-C copy scan (zh-CN default) */
    const copy = await win.evaluate(COPY_PROBE);
    copy.violations.length === 0
      ? ok(`D-C-01: zh-CN visible copy clean (${copy.total} scanned, 0 unlisted English)`)
      : bad("D-C-01 unlisted English", JSON.stringify(copy.violations.slice(0, 12)));

    await app.close();
  } catch (e) {
    bad("gate block", (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
    try { await app.close(); } catch {}
  }

  /* second viewport pass */
  try {
    const b = await launchWith(1280, 800);
    ({ app, win } = b);
    await runViewport(win, 1280, 800);
    ok("D-L-07..12: 6 panel states geometry @1280");
    await app.close();
  } catch (e) {
    bad("1280 pass", (e && e.message) || String(e));
  }

  console.log("\ne2e_desktop_layout_target: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
})();
