/* e2e_grok_desktop_spec.mjs — D-ST-UI: computed-style gate for Grok parity (G-28).
 *
 * Why this exists: G-28 makes "looks like the Grok Bot app" a goal, but that can
 * only be proven from the REAL rendered app, not from source text. This gate reads
 * getComputedStyle() in the REAL Electron window and asserts the Grok spec:
 *
 *   1) accent token is purple/magenta — #7c3aed (light) / #a855f7 (dark) — and
 *      is NOT the old near-black (#1a1a1a) or blue (#1e86fc);
 *   2) the send button is a circle filled with the accent;
 *   3) the composer is ONE pill: [＋][input][mic][↑] — radius ≥ 20px, zero chips;
 *   4) web-search / model / voice-chat live inside the ＋ menu (#composer-more),
 *      not in the row; the ＋ menu is hidden by default;
 *   5) a DM bot reply head renders: 28px circular avatar + sender name in accent;
 *   6) the assistant bubble is a flat block (0 border, no shadow, radius > 0).
 *
 * A skipped gate is never a PASS. Usage: node scripts/e2e_grok_desktop_spec.mjs
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv, hasDisplay } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const ACCENT_LIGHT = "rgb(124, 58, 237)"; // #7c3aed
const ACCENT_DARK = "rgb(168, 85, 247)"; // #a855f7
const OLD_BLACK = "rgb(26, 26, 26)";      // #1a1a1a (old)
const OLD_BLUE = "rgb(30, 134, 252)";     // #1e86fc (old)

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_grok_desktop_spec: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_grok_desktop_spec: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_grok_desktop_spec: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_grok_desktop_spec: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { _electron } = require("playwright-core");

const ud = electronUserDataDir("grok-spec");
const env = electronLaunchEnv(gateAppEnv(REPO, { BITBOT_NO_SECRET_SYNC: "1", BITBOT_DESKTOP_AUTOSTART: "0" }));

async function setTheme(win, mode) {
  await win.evaluate((m) => {
    const b = document.body;
    b.classList.remove("force-dark", "force-light");
    if (m) b.classList.add(m === "dark" ? "force-dark" : "force-light");
  }, mode);
  // #send carries `transition: all .15s ease`, so sampling right after a theme
  // swap reads an interpolated mid-frame. Wait past the transition, then settle
  // on two animation frames so the value we assert is the resting colour.
  await win.waitForTimeout(220);
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

(async () => {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO,
    env,
  });
  const win = await app.firstWindow();
  const snapshot = {};
  try {
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.evaluate(() => window.resizeTo(1440, 900)).catch(() => {});
    await win.waitForTimeout(400);

    // A0 — grok-ui shell is the skin everything else assumes
    const hasGrok = await win.evaluate(() => document.body.classList.contains("grok-ui"));
    hasGrok ? ok("body carries .grok-ui (Grok shell skin active)") : bad("body missing .grok-ui");

    // A1/A2 — accent token in both themes (via the send button, the ground truth)
    await setTheme(win, "light");
    const sendLight = await win.evaluate(() => getComputedStyle(document.getElementById("send")).backgroundColor);
    await setTheme(win, "dark");
    const sendDark = await win.evaluate(() => getComputedStyle(document.getElementById("send")).backgroundColor);
    await setTheme(win, null);
    snapshot.accent = { sendLight, sendDark };
    sendLight === ACCENT_LIGHT ? ok(`accent light = ${sendLight} (#7c3aed purple)`)
      : bad("light accent drifted", sendLight);
    sendDark === ACCENT_DARK ? ok(`accent dark = ${sendDark} (#a855f7 magenta)`)
      : bad("dark accent drifted", sendDark);
    (sendLight !== OLD_BLACK && sendLight !== OLD_BLUE && sendDark !== OLD_BLACK && sendDark !== OLD_BLUE)
      ? ok("accent is no longer the old black/blue (G-28 flip holds)")
      : bad("accent still resolves to an old black/blue value", JSON.stringify({ sendLight, sendDark }));

    // A4/A5 — send is a circle; composer .row is a single pill
    const composer = await win.evaluate(() => {
      const row = document.querySelector("#composer .row");
      const send = document.getElementById("send");
      const sr = send.getBoundingClientRect();
      const cs = getComputedStyle(row);
      return {
        rowDisplay: cs.display,
        rowWrap: cs.flexWrap,
        rowRadius: parseFloat(cs.borderTopLeftRadius),
        sendRadius: getComputedStyle(send).borderTopLeftRadius,
        sendW: Math.round(sr.width),
        sendH: Math.round(sr.height),
        rowChips: document.querySelectorAll("#composer .row .bb-chip").length,
        attachOrder: getComputedStyle(document.getElementById("attach-btn")).order,
      };
    });
    snapshot.composer = composer;
    (composer.sendRadius === "50%" && composer.sendW === composer.sendH && composer.sendW > 0)
      ? ok(`send button is a ${composer.sendW}px circle (radius 50%)`)
      : bad("send button not a circle", JSON.stringify(composer));
    (composer.rowDisplay === "flex" && composer.rowWrap === "nowrap" && composer.rowRadius >= 20)
      ? ok(`composer is one pill (radius ${composer.rowRadius}px, nowrap flex)`)
      : bad("composer pill geometry drifted", JSON.stringify(composer));
    composer.attachOrder === "-1" ? ok("attach ＋ sits leftmost (order -1)")
      : bad("attach ＋ not leftmost", composer.attachOrder);

    // A6 — the row is minimal: ZERO chips visible (web-search / model moved out)
    composer.rowChips === 0 ? ok("composer row has 0 chips — [＋][input][mic][↑] only")
      : bad("composer row still shows chips", composer.rowChips);

    // A7/A12 — the ＋ menu holds them, hidden by default
    const more = await win.evaluate(() => {
      const m = document.getElementById("composer-more");
      if (!m) return { missing: true };
      return {
        hidden: getComputedStyle(m).display === "none",
        hasSearch: !!m.querySelector("#web-search-toggle"),
        hasModel: !!m.querySelector("#model-switch-chip"),
        hasVoice: !!m.querySelector("#voicechat-btn"),
        hasAttach: !!m.querySelector("#add-attachment-btn"),
      };
    });
    snapshot.menu = more;
    if (more.missing) bad("#composer-more menu missing");
    else {
      more.hidden ? ok("＋ menu is hidden by default") : bad("＋ menu not hidden by default");
      (more.hasAttach && more.hasSearch && more.hasModel)
        ? ok("＋ menu holds 添加附件 / 联网搜索 / 模型 (function preserved)")
        : bad("＋ menu lost a control", JSON.stringify(more));
    }

    // A9 — DM bot reply head: 28px circle avatar + sender name in accent
    await setTheme(win, "light");
    const head = await win.evaluate(() => {
      const log = document.getElementById("log");
      if (!log) return { missing: true };
      const el = document.createElement("div");
      el.className = "msg assistant";
      el.innerHTML =
        '<div class="role">assistant</div>' +
        '<div class="msg-grok-head"><span class="msg-grok-avatar">B</span><span class="msg-grok-name">Bit Bot</span></div>' +
        '<div class="body">probe</div>';
      log.appendChild(el);
      const av = el.querySelector(".msg-grok-avatar");
      const nm = el.querySelector(".msg-grok-name");
      const ra = av.getBoundingClientRect();
      const out = {
        avatarW: Math.round(ra.width),
        avatarH: Math.round(ra.height),
        avatarRadius: getComputedStyle(av).borderRadius,
        nameColor: getComputedStyle(nm).color,
        nameWeight: getComputedStyle(nm).fontWeight,
      };
      el.remove();
      return out;
    });
    await setTheme(win, null);
    snapshot.head = head;
    if (head.missing) bad("#log missing for head probe");
    else {
      (head.avatarW === 28 && head.avatarH === 28 && head.avatarRadius === "50%")
        ? ok(`DM reply avatar is a 28px circle (radius ${head.avatarRadius})`)
        : bad("DM reply avatar geometry drifted", JSON.stringify(head));
      head.nameColor === ACCENT_LIGHT
        ? ok(`DM reply sender name uses accent (${head.nameColor})`)
        : bad("DM reply sender name colour drifted", head.nameColor);
    }

    // A10 — assistant bubble is a flat block (0 border, no shadow, radius > 0)
    const bubble = await win.evaluate(() => {
      const log = document.getElementById("log");
      if (!log) return { missing: true };
      const el = document.createElement("div");
      el.className = "msg assistant";
      el.innerHTML = '<div class="role">assistant</div><div class="body">probe</div>';
      log.appendChild(el);
      const bd = el.querySelector(".body");
      const s = getComputedStyle(bd);
      const r = bd.getBoundingClientRect();
      const out = {
        borderTopWidth: s.borderTopWidth,
        boxShadow: s.boxShadow,
        radius: parseFloat(s.borderTopLeftRadius),
        bg: s.backgroundColor,
        w: Math.round(r.width),
      };
      el.remove();
      return out;
    });
    snapshot.bubble = bubble;
    if (bubble.missing) bad("#log missing for bubble probe");
    else {
      (bubble.borderTopWidth === "0px" && bubble.boxShadow === "none" && bubble.radius > 0 && bubble.w > 0)
        ? ok(`assistant bubble is a flat block (0 border, no shadow, radius ${bubble.radius}px)`)
        : bad("assistant bubble chrome drifted", JSON.stringify(bubble));
    }

    const out = path.join(REPO, "docs/design/desktop-target/reference/grok-spec-computed.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`  · snapshot → ${path.relative(REPO, out)}`);
  } catch (e) {
    bad("gate block", (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
  } finally {
    try {
      await app.evaluate(({ app: ea }) => { ea.isQuiting = true; ea.quit(); });
      await app.close();
    } catch { /* already gone */ }
    fs.rmSync(ud, { recursive: true, force: true });
  }

  console.log(`\ne2e_grok_desktop_spec: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP}`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error("e2e_grok_desktop_spec crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
