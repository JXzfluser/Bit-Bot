/* e2e_modal_computed.mjs — D-ST: computed-style gate for sheet/modal chrome.
 *
 * Why this exists: the P2 convergence replaces five per-id close-button rules
 * (with !important) by ONE `.bb-close` base class. Visual equivalence cannot be
 * proven from source text, so this gate reads the REAL computed styles of every
 * sheet in the REAL Electron app before/after such refactors.
 *
 * Per surface (settings / model / marketplace / bot form / connect apps) it
 * asserts:
 *   - the close button is visible and is a ghost "×": transparent background,
 *     0 border, no shadow, 0 font-size, 6px padding, ::before content "×" at
 *     24px / line-height 1;
 *   - all five close buttons resolve to the SAME colour (one shared rule);
 *   - the surface itself is a real sheet: visible, width > 0, radius > 0;
 *   - settings head stays a right-aligned, borderless row.
 *
 * A skipped gate is never a PASS. Usage: node scripts/e2e_modal_computed.mjs
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, hasDisplay } from "./electron_env.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_modal_computed: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_modal_computed: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
/* 只有 Linux 需要 X server；macOS/Windows 没有 DISPLAY 是正常的。
   初版把条件写成"没有 xvfb-run 且没有 DISPLAY"，在 macOS 上永远跳过。 */
if (!hasDisplay()) {
  console.log("e2e_modal_computed: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_modal_computed: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));

const { _electron } = require("playwright-core");

const SURFACES = [
  { name: "settings", open: "openProductCredentials('e2e')", mask: "#settings-panel", root: "#settings-panel .bb-sheet", close: "#settings-close", head: "#settings-sheet .bb-sheet-head" },
  { name: "model", open: "openModelSheet()", mask: "#model-modal", root: "#model-modal .bb-sheet", close: "#model-close" },
  { name: "marketplace", open: "openMarketplace()", mask: "#marketplace-modal", root: "#marketplace-modal .bb-sheet", close: "#mk-close" },
  { name: "bot-form", open: "openBotForm(null)", mask: "#bot-edit-modal", root: "#bot-edit-modal .bb-sheet", close: "#bf-close" },
  { name: "connect-apps", open: "openConnectApps()", mask: "#connect-apps-modal", root: "#connect-apps-modal .bb-sheet", close: "#ca-close" },
];

const CLOSE_PROBE = `(() => {
  const el = document.querySelector(CLOSE_SEL);
  if (!el) return { missing: true };
  const s = getComputedStyle(el);
  const b = getComputedStyle(el, "::before");
  const r = el.getBoundingClientRect();
  return {
    display: s.display,
    backgroundColor: s.backgroundColor,
    borderTopWidth: s.borderTopWidth,
    borderStyle: s.borderStyle,
    boxShadow: s.boxShadow,
    fontSize: s.fontSize,
    color: s.color,
    padding: s.padding,
    content: b.content,
    beforeFontSize: b.fontSize,
    beforeLineHeight: b.lineHeight,
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
})()`;

const ROOT_PROBE = `(() => {
  const el = document.querySelector(ROOT_SEL);
  if (!el) return { missing: true };
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    display: s.display,
    backgroundColor: s.backgroundColor,
    borderRadius: s.borderRadius,
    boxShadow: s.boxShadow,
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
})()`;

async function shutdown(app) {
  try {
    await app.evaluate(({ app: electronApp }) => { electronApp.isQuiting = true; electronApp.quit(); });
    await app.close();
  } catch { /* already gone */ }
}

(async () => {
  const args = [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu"];
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args,
    cwd: REPO,
    /* ELECTRON_RUN_AS_NODE=1 会让 electron 退化成纯 node（ipcMain undefined），
       这里显式剔除；门禁也不该改用户 macOS 的开机自启设置。 */
    env: electronLaunchEnv({ BITBOT_DESKTOP_AUTOSTART: "0" }),
  });
  const win = await app.firstWindow();
  try {
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.evaluate(() => window.resizeTo(1440, 900));
    await win.waitForTimeout(400);

    const snapshot = {};
    for (const s of SURFACES) {
      await win.evaluate((src) => { (0, eval)(src); }, s.open);
      await win.mouse.move(1, 1); // no accidental :hover on the × we are measuring
      await win.waitForTimeout(250);
      const close = await win.evaluate(CLOSE_PROBE.replace("CLOSE_SEL", JSON.stringify(s.close)));
      const root = await win.evaluate(ROOT_PROBE.replace("ROOT_SEL", JSON.stringify(s.root)));
      const type = await win.evaluate((sel) => {
        const pick = (q) => {
          const el = document.querySelector(sel + " " + q);
          if (!el) return null;
          const st = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return { text: (el.textContent || "").trim().slice(0, 12), fontSize: st.fontSize, fontWeight: st.fontWeight, letterSpacing: st.letterSpacing, color: st.color, margin: st.margin, visible: r.width > 0 && r.height > 0 };
        };
        return { title: pick(".bb-sheet-title"), note: pick(".bb-sheet-note") };
      }, s.root.replace(" .bb-sheet", ""));
      snapshot[s.name] = { close, root, type };
      if (s.head) {
        snapshot[s.name].head = await win.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return { missing: true };
          const st = getComputedStyle(el);
          return { display: st.display, justifyContent: st.justifyContent, borderBottomWidth: st.borderBottomWidth, background: st.backgroundColor };
        }, s.head);
      }
      if (s.name === "settings") {
        // P2: settings nav/tabs are their own style layer; snapshot the whole
        // row so a de-!important rewrite can be diffed field by field.
        snapshot.settings.tabsChrome = await win.evaluate(() => {
          const nav = document.getElementById("settings-tabs");
          const ns = getComputedStyle(nav);
          const tabs = [...nav.querySelectorAll(".settings-tab-btn")].map((b) => {
            const st = getComputedStyle(b);
            const pb = getComputedStyle(b, "::before");
            const r = b.getBoundingClientRect();
            return {
              stab: b.dataset.stab,
              active: b.classList.contains("active"),
              display: st.display,
              background: st.backgroundColor,
              color: st.color,
              padding: st.padding,
              borderRadius: st.borderRadius,
              fontSize: st.fontSize,
              fontWeight: st.fontWeight,
              width: Math.round(r.width),
              height: Math.round(r.height),
              iconContent: pb.content,
              iconW: pb.width,
              iconH: pb.height,
              iconMask: (pb.maskImage || pb.webkitMaskImage || "").slice(0, 12),
            };
          });
          return {
            nav: {
              display: ns.display,
              direction: ns.flexDirection,
              gap: ns.gap,
              background: ns.backgroundColor,
              borderWidth: ns.borderTopWidth,
              borderRadius: ns.borderRadius,
              padding: ns.padding,
            },
            tabs,
          };
        });
        const tc = snapshot.settings.tabsChrome;
        const navOk = tc.nav.display === "flex" && tc.nav.direction === "column" &&
          tc.nav.background === "rgba(0, 0, 0, 0)" && tc.nav.borderWidth === "0px";
        navOk ? ok(`settings: nav is a transparent column (gap ${tc.nav.gap}, padding ${tc.nav.padding})`)
          : bad("settings: nav chrome drifted", JSON.stringify(tc.nav));
        const tabsOk = tc.tabs.length === 5 && tc.tabs.every((t) =>
          t.display === "flex" && t.width > 0 && t.height > 0 && t.fontSize === "14px" &&
          t.borderRadius === "999px" && t.padding === "9px 12px" &&
          t.iconContent === '""' && t.iconW === "17px" && t.iconH === "17px");
        tabsOk ? ok("settings: 5 tab rows share one 14px/pill skin with 17px icon masks")
          : bad("settings: tab skin drifted", JSON.stringify(tc.tabs.map((t) => [t.stab, t.fontSize, t.borderRadius, t.padding, t.iconW, t.width])));
        const act = tc.tabs.find((t) => t.active);
        act && act.background !== "rgba(0, 0, 0, 0)" && act.background !== tc.tabs.find((t) => !t.active).background
          ? ok(`settings: active tab keeps its pill background ${act.background}`)
          : bad("settings: active pill lost", JSON.stringify(act));
      }

      if (close.missing) bad(`${s.name}: close button ${s.close} missing`);
      else {
        const ghost =
          close.display !== "none" &&
          close.backgroundColor === "rgba(0, 0, 0, 0)" &&
          close.borderTopWidth === "0px" &&
          close.borderStyle === "none" &&
          close.boxShadow === "none" &&
          close.fontSize === "0px" &&
          close.padding === "6px" &&
          close.content === '"×"' &&
          close.beforeFontSize === "24px" &&
          close.beforeLineHeight === "24px" &&
          close.w > 0 && close.h > 0;
        ghost ? ok(`${s.name}: close is a ghost × (transparent/0 border/0 font/6px/24px glyph)`)
          : bad(`${s.name}: close style drifted`, JSON.stringify(close));
      }
      if (root.missing) bad(`${s.name}: root ${s.root} missing`);
      else {
        const sheet = root.display !== "none" && root.w > 0 && root.h > 0 && parseFloat(root.borderRadius) > 0;
        sheet ? ok(`${s.name}: sheet visible ${root.w}x${root.h}, radius ${root.borderRadius}, bg ${root.backgroundColor}`)
          : bad(`${s.name}: sheet geometry/radius lost`, JSON.stringify(root));
      }
      const ty = snapshot[s.name].type;
      if (ty.title && ty.title.visible) {
        const t = ty.title;
        t.fontSize === "21px" && t.fontWeight === "600" && t.letterSpacing === "-0.21px"
          ? ok(`${s.name}: sheet title is 21px/600 with tight tracking`)
          : bad(`${s.name}: sheet title type drifted`, JSON.stringify(t));
      } else if (ty.title) {
        ok(`${s.name}: sheet title intentionally hidden (display-only chrome)`);
      }
      if (ty.note && ty.note.visible) {
        const n = ty.note;
        n.fontSize === "13px"
          ? ok(`${s.name}: sheet note stays 13px caption`)
          : bad(`${s.name}: sheet note type drifted`, JSON.stringify(n));
      }
      if (s.head) {
        const h = snapshot[s.name].head;
        h.missing ? bad(`${s.name}: head ${s.head} missing`)
          : (h.justifyContent === "flex-end" && h.borderBottomWidth === "0px" && h.background === "rgba(0, 0, 0, 0)")
            ? ok(`${s.name}: head right-aligned, borderless, transparent`)
            : bad(`${s.name}: head chrome drifted`, JSON.stringify(h));
      }

      // close via the same button (proves the merged rule still binds a handler)
      if (!close.missing) {
        await win.click(s.close);
        await win.waitForTimeout(150);
        const closed = await win.evaluate((sel) => {
          const el = document.querySelector(sel);
          return !el || getComputedStyle(el).display === "none";
        }, s.mask);
        closed ? ok(`${s.name}: close button dismisses the sheet`) : bad(`${s.name}: close button did not dismiss`);
      }
    }

    // one shared colour for all five ghost buttons
    const colours = [...new Set(Object.values(snapshot).map((v) => v.close.color))];
    colours.length === 1 ? ok(`all 5 close buttons share colour ${colours[0]}`)
      : bad("close buttons diverge in colour", JSON.stringify(colours));

    const out = path.join(REPO, "docs/design/desktop-target/reference/modal-computed.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`  · snapshot → ${path.relative(REPO, out)}`);
  } catch (e) {
    bad("gate block", (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
  } finally {
    await shutdown(app);
  }

  console.log(`\ne2e_modal_computed: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP}`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error("e2e_modal_computed crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
