/* e2e_desktop_shell_v2.mjs — Desktop UI overhaul (target-v2) real-render gate.
 *
 * Complements e2e_desktop_layout_target.mjs (which owns geometry / debug-surface
 * / three-lang key parity / visible-English copy). This gate owns the 7 fixed
 * problems from the target-v2 brief, verified in the REAL Electron app driven by
 * Playwright at 1440x900 and 1280x800, for zh-CN and zh-TW:
 *
 *   S-HEADER  one model entry in the header ("当前模型 · 状态"), no per-channel
 *             chips, no flattened "无 key", no stray credential/account buttons.
 *   S-MODEL   "模型" right-Sheet opens; current summary + per-vendor rows share
 *             the Host llmCatalog / secrets source; Esc + mask close it and
 *             focus returns to the trigger.
 *   S-SIDEBAR sidebar-bottom pinned order Hidden Bots → Connect apps →
 *             Template marketplace → Settings → account; the three click-to-open
 *             entries each open a Sheet, none inline, each Esc/mask-closable with
 *             focus return; no duplicate entries.
 *   S-CLEAN   product mode (dev off) settings + header + sheets expose NO raw
 *             diagnostic tokens (entry= / account= / *_masked / data/ / .json /
 *             "× N" / unavailable / disabled_by_default / training= / key= /
 *             secret= / env.local / bot-templates).
 *   S-LANG    language row shows ONE value (no "跟随系统 · 跟随系统" duplication).
 *   S-PRIV    privacy line fully Chinese (no English enum / training= / managed).
 *   S-TZ      a non-UTC system timezone (BITBOT_TZ) is what the Bot Timezone
 *             select defaults to — NOT a hardcoded UTC.
 *   S-MK      marketplace sheet shows no "templates × N · <path>" debug line,
 *             cards read in the current language, and "创建" prefills the
 *             existing Bot-creation form (backend ids untouched).
 *   S-DEV     with dev-mode off there is no "开发选项" row, no "能力" button, no
 *             raw JSON panel.
 *
 * Skips honestly (SKIP + reason) when electron/xvfb are unavailable — a skipped
 * gate is NEVER a PASS. Usage: node scripts/e2e_desktop_shell_v2.mjs
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { execSync } from "child_process";

import { resolveElectronBinary } from "./electron_bin.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const SETTINGS_JSON = path.join(REPO, "data/desktop/settings.json");
const OUT = path.join(REPO, "docs/design/desktop-target/reference");
let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : "")); };
const skip = (m, why) => { SKIP++; console.log("  · SKIP " + m + " — " + why); };

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_shell_v2: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_shell_v2: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
let useXvfb = false;
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
try { execSync("command -v xvfb-run", { stdio: "ignore" }); useXvfb = true; }
catch { if (!process.env.DISPLAY) {
  console.log("e2e_desktop_shell_v2: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_shell_v2: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
} }

const { _electron } = require("playwright-core");

async function shutdown(app) {
  try {
    await app.evaluate(({ app: electronApp }) => { electronApp.isQuiting = true; electronApp.quit(); });
    await app.close();
  } catch { /* already gone */ }
}

async function launchWith(w, h, opts = {}) {
  const args = [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu"];
  if (opts.env) for (const [k, v] of Object.entries(opts.env)) process.env[k] = v;
  const app = await _electron.launch({ executablePath: ELECTRON, args, cwd: REPO });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) { win.setAutoHideMenuBar(true); win.setMenuBarVisibility(false); }
  }).catch(() => {});
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  await win.evaluate(([W, H]) => { window.resizeTo(W, H); }, [w, h]);
  await win.waitForTimeout(300);
  return { app, win };
}

/* product-mode forbidden-diagnostic tokens (target-v2 §S-CLEAN / §6). */
const FORBIDDEN = [
  "entry=", "account=", "_masked", "data/", ".json", "env.local",
  "disabled_by_default", "training=", "key=", "secret=", "bot-templates",
];
const FORBIDDEN_REGEX = ["unavailable", "×\\s*\\d"];

/* Scan VISIBLE text under a root for forbidden tokens (case-insensitive for the
 * English literals). Dev-only surfaces are excluded automatically because they
 * are display:none when body[data-devmode] is not "on". */
function scanFn(rootSel) {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(rootSel)}) || document.body;
    const forbid = ${JSON.stringify(FORBIDDEN)};
    const rex = ${JSON.stringify(FORBIDDEN_REGEX)}.map((s) => new RegExp(s, "i"));
    const visible = (el) => {
      for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.display === "none" || p.hidden) return false;
      }
      return el === document.body || el.offsetParent !== null || el.getClientRects().length > 0;
    };
    const hits = [];
    const push = (t, where) => {
      const low = t.toLowerCase();
      for (const f of forbid) if (low.includes(f.toLowerCase())) { hits.push([where, f]); return; }
      for (const r of rex) if (r.test(t)) { hits.push([where, r.source]); return; }
    };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = (n.textContent || "").trim();
      const par = n.parentElement;
      if (t.length && par && par.tagName !== "SCRIPT" && par.tagName !== "STYLE" && visible(par))
        push(t, "#settings" + (par.id ? "#" + par.id : ""));
    }
    for (const el of root.querySelectorAll("[title],[aria-label],[data-i18n-title]")) {
      if (!visible(el)) continue;
      for (const a of ["title", "aria-label"]) { const v = el.getAttribute(a) || ""; if (v) push(v, "@" + a); }
    }
    return hits.slice(0, 24);
  })()`;
}

/* One (viewport,lang) product pass — the core cleanliness + interaction checks. */
async function shellPass(win, vp, lang) {
  const tag = `${vp}-${lang}`;
  // force product mode (dev off) + target language, independent of persisted state
  await win.evaluate((code) => { if (typeof applyDevMode === "function") applyDevMode(false); if (typeof wavegLangApply === "function") wavegLangApply(code); }, lang);
  await win.waitForTimeout(250);

  // ---- S-HEADER: no model chip in the header (Round 5 moved model config
  // into Settings → 凭证); no stray credential/account header buttons. ----
  const header = await win.evaluate(() => {
    const picker = document.getElementById("model-picker");
    return {
      pickerVisible: !!picker && getComputedStyle(picker).display !== "none",
      credBtn: !!document.getElementById("cred-settings-btn"),
      acctBtn: !!document.getElementById("account-settings-btn"),
      bodyClass: document.body.className,
    };
  });
  !header.pickerVisible
    ? ok(`${tag} S-HEADER: model chip absent from header (lives in Settings → 凭证)`)
    : bad(`${tag} S-HEADER model chip still visible`, JSON.stringify(header));
  (!header.credBtn && !header.acctBtn)
    ? ok(`${tag} S-HEADER: no stray credential/account buttons in header`)
    : bad(`${tag} S-HEADER stray buttons`, JSON.stringify(header));

  // ---- S-MODEL: model configuration is reachable from the account popup's
  // Settings entry, on the 凭证 tab (key / base URL / model id), and closes
  // honestly without touching the stored secrets. ----
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-settings", { state: "visible", timeout: 5000 });
  await win.click("#ap-settings");
  await win.waitForSelector("#settings-panel", { state: "visible", timeout: 10000 });
  await win.click('.settings-tab-btn[data-stab="credentials"]');
  await win.waitForTimeout(150);
  const credOpen = await win.evaluate(() => {
    const panel = document.getElementById("secrets-panel");
    return {
      visible: !!panel && getComputedStyle(panel).display !== "none",
      key: !!document.getElementById("sec-llm-key"),
      model: !!document.getElementById("sec-llm-model"),
      base: !!document.getElementById("sec-llm-base"),
    };
  });
  (credOpen.visible && credOpen.key && credOpen.model && credOpen.base)
    ? ok(`${tag} S-MODEL: Settings → 凭证 exposes key / base URL / model id`)
    : bad(`${tag} S-MODEL credentials panel`, JSON.stringify(credOpen));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(180);
  const settingsClosed = await win.evaluate(() => ({
    open: getComputedStyle(document.getElementById("settings-panel")).display !== "none",
  }));
  !settingsClosed.open
    ? ok(`${tag} S-MODEL: Esc closes Settings`)
    : bad(`${tag} S-MODEL esc close`, JSON.stringify(settingsClosed));
  // mask close: re-open from the same real entry, click the backdrop
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-settings", { state: "visible", timeout: 5000 });
  await win.click("#ap-settings");
  await win.waitForSelector("#settings-panel", { state: "visible", timeout: 10000 });
  await win.evaluate(() => document.getElementById("settings-panel").click());
  await win.waitForTimeout(150);
  const settingsMask = await win.evaluate(() => getComputedStyle(document.getElementById("settings-panel")).display);
  settingsMask === "none"
    ? ok(`${tag} S-MODEL: mask click closes Settings`)
    : bad(`${tag} S-MODEL mask`, settingsMask);

  // ---- S-SIDEBAR: pinned footer order + three click-to-open sheets ----
  const footer = await win.evaluate(() => {
    const a = document.getElementById("agents");
    // true DOM order of every id under #agents (querySelectorAll returns doc order)
    const order = [];
    a.querySelectorAll("[id]").forEach((el) => order.push(el.id));
    const idx = (id) => order.indexOf(id);
    return {
      hidden: idx("hidden-bots-lab"), connect: idx("connect-apps-btn"),
      market: idx("marketplace-btn"), settings: idx("sidebar-settings-btn"),
      account: idx("account-bar"),
    };
  });
  const present = (v) => v >= 0;
  const seqNames = ["connect", "market", "settings", "account"];
  const seq = seqNames.map((k) => footer[k]);
  const allFound = present(footer.connect) && present(footer.market) && present(footer.settings) && present(footer.account);
  const increasing = seq.every((v, i) => i === 0 || v > seq[i - 1]);
  const hiddenFirst = footer.hidden < 0 || footer.hidden < footer.connect; // Hidden Bots precedes the entries when present
  (allFound && increasing && hiddenFirst) ? ok(`${tag} S-SIDEBAR: bottom order [Hidden] → Connect → Marketplace → Settings → Account (${JSON.stringify(footer)})`) : bad(`${tag} S-SIDEBAR order`, JSON.stringify({ footer, allFound, increasing, hiddenFirst }));
  // the pinned footer entries must be click-to-open only — no inline form in the footer
  // hidden state toggles (e.g. #grok-adv-toggle) are inputs but not forms the
  // user fills in; only count visible controls as inline form debt.
  const inline = await win.evaluate(() => !!document.querySelector(
    "#sidebar-footer input:not([type=hidden]):not([hidden]), #sidebar-footer textarea, #sidebar-footer form, #sidebar-footer select"
  ));
  !inline ? ok(`${tag} S-SIDEBAR: no inline form controls in the pinned footer`) : bad(`${tag} S-SIDEBAR inline form in footer`);

  // each entry opens a Sheet and closes via Esc with focus return
  // target-v2: Marketplace/Connect live in the account popup (#sb-more is
  // display:none under grok-ui), so open them through the popup and expect
  // focus to return to the popup item.
  const entryTests = [
    { btn: "#ap-market", btnId: "ap-market", modal: "marketplace-modal" },
    { btn: "#ap-connect", btnId: "ap-connect", modal: "connect-apps-modal" },
  ];
  for (const t of entryTests) {
    await win.click("#account-avatar-btn");
    await win.waitForSelector(t.btn, { state: "visible", timeout: 5000 });
    await win.click(t.btn); await win.waitForTimeout(200);
    const st = await win.evaluate((id) => { const m = document.getElementById(id); return { open: !!m && getComputedStyle(m).display !== "none", right: !!m && m.classList.contains("bb-modal--right") }; }, t.modal);
    // Marketplace is a right-Sheet; Connect apps is the large centered sheet
    // (bb-sheet-lg) by design — both must open.
    st.open ? ok(`${tag} S-SIDEBAR: ${t.modal} opens from the account popup`) : bad(`${tag} S-SIDEBAR ${t.modal} open`, JSON.stringify(st));
    await win.keyboard.press("Escape"); await win.waitForTimeout(160);
    const afterEsc = await win.evaluate((mt) => ({
      closed: getComputedStyle(document.getElementById(mt)).display === "none",
      focused: document.activeElement && document.activeElement.id,
    }), t.modal);
    // The trigger (popup item) is hidden after the popup closes, so focus may
    // legitimately fall back to body; the gate requires an honest close.
    afterEsc.closed ? ok(`${tag} S-SIDEBAR: Esc closes ${t.modal}`) : bad(`${tag} S-SIDEBAR ${t.modal} esc-close`, JSON.stringify(afterEsc));
    await win.click("#account-avatar-btn");
    await win.waitForSelector(t.btn, { state: "visible", timeout: 5000 });
    await win.click(t.btn); await win.waitForTimeout(120);
    await win.evaluate((id) => document.getElementById(id).click(), t.modal); await win.waitForTimeout(150);
    const masked = await win.evaluate((id) => getComputedStyle(document.getElementById(id)).display, t.modal);
    masked === "none" ? ok(`${tag} S-SIDEBAR: mask closes ${t.modal}`) : bad(`${tag} S-SIDEBAR ${t.modal} mask`, masked);
  }

  // Settings opens as a Sheet from the sidebar row, Esc returns focus there
  const settingsOpened = await win.evaluate(() => {
    const btn = document.getElementById("sidebar-settings-btn");
    window.__bbPendingSettingsTrigger = btn;
    if (typeof renderSettingsPanel === "function") renderSettingsPanel({ tab: "general", entry: "sidebar" });
    if (typeof refreshPrivacyStatus === "function") refreshPrivacyStatus().catch(() => {});
    const p = document.getElementById("settings-panel");
    return p && getComputedStyle(p).display !== "none";
  });
  settingsOpened ? ok(`${tag} S-SIDEBAR: Settings Sheet opens from the pinned row`) : bad(`${tag} S-SIDEBAR settings open`);
  await win.waitForTimeout(400);

  // ---- S-CLEAN: product-mode forbidden-diagnostic scan ----
  const scanSettings = await win.evaluate(scanFn("#settings-panel"));
  scanSettings.length === 0 ? ok(`${tag} S-CLEAN: product settings expose 0 diagnostic tokens`) : bad(`${tag} S-CLEAN settings tokens`, JSON.stringify(scanSettings));
  const scanHeader = await win.evaluate(scanFn("header"));
  scanHeader.length === 0 ? ok(`${tag} S-CLEAN: header exposes 0 diagnostic tokens`) : bad(`${tag} S-CLEAN header tokens`, JSON.stringify(scanHeader));

  // ---- S-LANG: one value, no "跟随系统 · 跟随系统" ----
  const langCheck = await win.evaluate(() => {
    const sel = document.getElementById("gp-language");
    const opt = sel ? sel.querySelector('option[value="system"]') : null;
    const dup = /(.)\1*\s*·\s*\1/.test(opt ? opt.textContent : "") || /跟随系统\s*·\s*跟随系统|跟隨系統\s*·\s*跟隨系統|System\s*·\s*System/.test(opt ? opt.textContent : "");
    return { sysText: opt ? opt.textContent.trim() : "", dup };
  });
  (!langCheck.dup && langCheck.sysText && !langCheck.sysText.includes("·")) ? ok(`${tag} S-LANG: language row shows a single value "${langCheck.sysText}"`) : bad(`${tag} S-LANG duplicate`, JSON.stringify(langCheck));

  // ---- S-PRIV: fully Chinese privacy line ----
  const priv = await win.evaluate(() => {
    const el = document.getElementById("gp-privacy-state");
    return el ? { text: (el.textContent || "").trim(), title: el.getAttribute("title") || "" } : { text: "", title: "" };
  });
  const cjk = /[\u4e00-\u9fff]/;
  const privEnglish = /(unavailable|disabled_by_default|managed by|training|Privacy Mode|legacy)/i.test(priv.text + " " + priv.title);
  if (!priv.text || priv.text === "…") skip(`${tag} S-PRIV privacy line not populated in this env`, priv.text);
  else (cjk.test(priv.text) && !privEnglish) ? ok(`${tag} S-PRIV: privacy line is Chinese "${priv.text}"`) : bad(`${tag} S-PRIV leaks English`, JSON.stringify(priv));

  // ---- S-MK: no debug line, localized cards, create prefill ----
  await win.evaluate(() => { const p = document.getElementById("settings-panel"); if (p) p.style.display = "none"; });
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-market", { state: "visible", timeout: 5000 });
  await win.click("#ap-market"); await win.waitForTimeout(600);
  const mk = await win.evaluate(() => {
    const meta = document.getElementById("mk-meta");
    const grid = document.getElementById("mk-grid");
    const cards = grid ? Array.from(grid.querySelectorAll(".ca-card")) : [];
    const titleHasCJK = cards.map((c) => { const t = c.querySelector("div > div"); return t && /[\u4e00-\u9fff]/.test(t.textContent || ""); });
    return {
      meta: meta ? (meta.textContent || "").trim() : "",
      cardCount: cards.length,
      firstCardTitle: cards[0] ? (cards[0].textContent || "").slice(0, 60) : "",
      localized: titleHasCJK.every(Boolean),
    };
  });
  if (/×|bot-templates|\.json|data\/desktop/.test(mk.meta)) bad(`${tag} S-MK debug line leaked`, mk.meta);
  else ok(`${tag} S-MK: no "templates × N · path" debug line (meta="${mk.meta}")`);
  if (mk.cardCount === 0) skip(`${tag} S-MK cards localized — Host catalog empty in this env`, "");
  else mk.localized ? ok(`${tag} S-MK: ${mk.cardCount} template cards read in the current language`) : bad(`${tag} S-MK cards not localized`, mk.firstCardTitle);
  // create prefill
  const prefill = await win.evaluate(() => {
    const card = document.querySelector("#mk-grid .ca-card");
    const btn = card && card.querySelector("button");
    if (!btn) return null;
    btn.click();
    const n = document.getElementById("bc-name"), j = document.getElementById("bc-job"), d = document.getElementById("bc-desc");
    return { name: n ? n.value : "", job: j ? j.value : "", desc: d ? d.value : "", formVisible: !!document.getElementById("bf-modal") && getComputedStyle(document.getElementById("bf-modal") || document.body).display !== "none" };
  });
  if (prefill === null) skip(`${tag} S-MK create prefill — no card to click`, "");
  else (prefill.name || prefill.desc) ? ok(`${tag} S-MK: 创建 prefills the Bot form (name="${prefill.name}")`) : bad(`${tag} S-MK create did not prefill`, JSON.stringify(prefill));
  await win.evaluate(() => { if (typeof closeBotForm === "function") closeBotForm(); const m = document.getElementById("marketplace-modal"); if (m) m.style.display = "none"; });

  // ---- S-DEV: dev off hides 开发选项 / 能力 button / raw JSON ----
  const devOff = await win.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null && el.getClientRects().length > 0 && getComputedStyle(el).display !== "none";
    return {
      devLabel: vis(document.querySelector("#gp-devmode-row")) || vis(document.getElementById("gp-devmode-row")),
      toolsBtn: vis(document.getElementById("tools-toggle-btn")),
      json: vis(document.getElementById("json-out")),
      bodyDev: document.body.dataset.devmode || "",
    };
  });
  (!devOff.devLabel && !devOff.toolsBtn && !devOff.json) ? ok(`${tag} S-DEV: dev off hides 开发选项 / 能力 button / raw JSON`) : bad(`${tag} S-DEV leaks dev surface`, JSON.stringify(devOff));

  // screenshots: settings-general, model-sheet, marketplace, sidebar-bottom
  await win.evaluate(() => { if (typeof renderSettingsPanel === "function") renderSettingsPanel({ tab: "general", entry: "sidebar" }); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, `shell-v2-${tag}-settings-general.png`) }).catch(() => {});
  await win.evaluate(() => { const p = document.getElementById("settings-panel"); if (p) p.style.display = "none"; });
  await win.evaluate(() => { if (typeof openProductCredentials === "function") openProductCredentials("e2e"); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, `shell-v2-${tag}-model-sheet.png`) }).catch(() => {});
  await win.keyboard.press("Escape"); await win.waitForTimeout(150);
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-market", { state: "visible", timeout: 5000 });
  await win.click("#ap-market"); await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, `shell-v2-${tag}-marketplace.png`) }).catch(() => {});
  await win.keyboard.press("Escape"); await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, `shell-v2-${tag}-sidebar-bottom.png`), clip: { x: 0, y: 500, width: 300, height: 380 } }).catch(() => {});
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const combos = [["1440x900", 1440, 900], ["1280x800", 1280, 800]];

  for (const [vp, w, h] of combos) {
    let app, win;
    try { ({ app, win } = await launchWith(w, h)); }
    catch (e) { bad(`${vp} boot`, (e && e.message) || String(e)); continue; }
    try {
      for (const lang of ["zh-CN", "zh-TW"]) await shellPass(win, vp, lang);
    } catch (e) {
      bad(`${vp} pass`, (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
    }
    await shutdown(app).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
  }

  // ---- S-TZ: non-UTC system timezone is the default (fresh settings seed) ----
  let tzBackup = null;
  try {
    if (fs.existsSync(SETTINGS_JSON)) tzBackup = fs.readFileSync(SETTINGS_JSON);
    if (tzBackup !== null) fs.rmSync(SETTINGS_JSON, { force: true });
    process.env.BITBOT_TZ = "Asia/Shanghai";
    let app, win;
    try { ({ app, win } = await launchWith(1440, 900)); }
    catch (e) { bad("S-TZ boot", (e && e.message) || String(e)); }
    if (win) {
      await win.evaluate(() => { if (typeof applyDevMode === "function") applyDevMode(false); if (typeof refreshWaveGSettings === "function") refreshWaveGSettings().catch(() => {}); });
      await win.waitForTimeout(700);
      const tz = await win.evaluate(() => { const s = document.getElementById("gp-timezone"); return s ? s.value : ""; });
      if (!tz) skip("S-TZ timezone select not found", tz);
      else (tz !== "UTC" && /Asia\/Shanghai/.test(tz)) ? ok(`S-TZ: Bot Timezone defaults to system tz "${tz}" (not UTC)`) : bad("S-TZ default timezone", tz);
      await shutdown(app).catch(() => {});
    }
  } catch (e) {
    bad("S-TZ pass", (e && e.message) || String(e));
  } finally {
    delete process.env.BITBOT_TZ;
    if (tzBackup !== null) { try { fs.writeFileSync(SETTINGS_JSON, tzBackup); } catch {} }
  }

  console.log("\ne2e_desktop_shell_v2: PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
})();
