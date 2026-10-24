/* grok_real_spec_capture.mjs — ground-truth UI spec captured from the REAL
 * Grok Bot.app renderer over CDP (getComputedStyle + getBoundingClientRect).
 *
 * Why this exists: docs/design/desktop-target/reference/grok-spec-computed.json
 * is OUR app's snapshot, not Grok's. This script produces the actual Grok
 * numbers that the Bit Bot desktop skin must match:
 *   docs/design/desktop-target/reference/grok-real-spec.json
 * plus reference screenshots in /tmp/grok_ref/.
 *
 * Prereq (read docs in replica/grok-live-compare.md): Grok Bot must be running
 * with --remote-debugging-port=9224. This script is READ-ONLY navigation:
 * it only hovers/clicks reversible openers (account popup, composer "+" menu,
 * connect-apps dialog, session rows) and presses Escape / clicks a backdrop to
 * dismiss them. It types nothing except a single throwaway character to reveal
 * the send button (cleared right after). It never sends messages, deletes
 * sessions, changes/saves settings, switches theme, signs out, adds an account,
 * or clicks any 连接/授权/启用 third-party action. Items that would leave the
 * app or trigger OAuth ("获取移动版 Grok Bot", "添加账户", "退出登录", "管理用量",
 * plugin rows' 连接/添加) are measured for style ONLY and never clicked.
 *
 * Usage:
 *   node scripts/grok_real_spec_capture.mjs                 # full refresh (all keys)
 *   node scripts/grok_real_spec_capture.mjs --merge-extended # only refresh the
 *       4 extended keys (accountPopup / connectAppsPanel / plusMenuItems /
 *       rowInteractionStates), preserving every other key byte-for-byte.
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
// GROK_SPEC_OUT lets a dry-run write elsewhere (used to validate the full-refresh
// path without touching the committed reference file).
const OUT_JSON = process.env.GROK_SPEC_OUT || path.join(REPO, "docs/design/desktop-target/reference/grok-real-spec.json");
const SHOTS = "/tmp/grok_ref";
const CDP = "http://127.0.0.1:9224";
const MERGE_ONLY = process.argv.includes("--merge-extended");

const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { chromium } = require("playwright-core");

// Element property extractor that runs inside the page. Returns resolved
// computed values (never CSS variable names) plus rounded geometry.
const PAGE_HELPERS = `
  const RECT = (el) => { const r = el.getBoundingClientRect(); return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) }; };
  const GEOM = (el) => { const cs = getComputedStyle(el); const r = RECT(el); return { ...r,
    padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(" "),
    margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(" "),
    gap: cs.gap }; };
  const STYLE = (el, props) => { const cs = getComputedStyle(el); const o = {}; for (const p of props) o[p] = cs[p]; return o; };
  const ALL = (el, props) => el ? { selector: undefined, ...GEOM(el), ...STYLE(el, props || []) } : null;
  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => [...(root || document).querySelectorAll(sel)];
`;

// Detailed spec of every currently-visible .ui-menu, keyed by aria-label.
// Reused for the account popup, its submenus, and the composer "+" menu.
const READ_MENUS = `(() => {
  ${PAGE_HELPERS}
  const BORDER = ["borderTopWidth","borderTopColor","borderTopStyle","borderRightWidth","borderRightColor","borderBottomWidth","borderBottomColor","borderBottomStyle","borderLeftWidth","borderLeftColor"];
  const CONT = ["backgroundColor","borderRadius","boxShadow","zIndex","position","opacity","transform","fontFamily","fontSize","fontWeight","color","transition"];
  const ROWS = ["backgroundColor","color","borderRadius","fontSize","fontWeight","lineHeight","padding","gap"];
  const visible = qa(".ui-menu").filter((m) => RECT(m).width > 0 && RECT(m).height > 0);
  const pseudoSep = (el, pe) => { const cs = getComputedStyle(el, pe); if (!cs.content || cs.content === "none") return null;
    return { via: pe, content: cs.content, height: cs.height, width: cs.width, bg: cs.backgroundColor, border: [cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor].join(" "), margin: cs.margin }; };
  return visible.map((menu) => {
    const label = menu.querySelector("[aria-label]") ? menu.querySelector("[aria-label]").getAttribute("aria-label") : null;
    const list = menu.querySelector(".ui-menu__list");
    const sections = qa(".ui-menu__section", menu).map((s, i) => ({ index: i, ...GEOM(s), ...STYLE(s, ["gap","padding","margin"]), nextIsSection: s.getAttribute("data-next-is-section"), sepBefore: pseudoSep(s, "::before"), sepAfter: pseudoSep(s, "::after") }));
    const separators = [];
    for (const s of sections) { if (s.sepBefore) separators.push({ ...s.sepBefore, sectionIndex: s.index }); if (s.sepAfter) separators.push({ ...s.sepAfter, sectionIndex: s.index }); }
    const rowSel = ".ui-menu__row,.ui-menu__submenu-trigger,.ui-menu__label,.ui-menu__separator";
    const rows = qa(rowSel, menu).map((el) => {
      const leafTexts = []; for (const e of el.querySelectorAll("*")) { if (e.children.length === 0) { const t = (e.textContent || "").trim(); if (t && t.length < 40 && !leafTexts.includes(t)) leafTexts.push(t); } }
      const cont = el.querySelector(".ui-menu__item-content");
      return {
        text: (el.textContent || "").trim().slice(0, 44),
        component: el.getAttribute("data-component"),
        hasSubmenuArrow: el.getAttribute("aria-haspopup") === "menu",
        expanded: el.getAttribute("aria-expanded"),
        disabled: el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled"),
        href: el.getAttribute("href"),
        ...GEOM(el),
        ...STYLE(el, ROWS),
        icons: qa("[data-icon-name]", el).map((ic) => ({ name: ic.getAttribute("data-icon-name"), sizeAttr: ic.getAttribute("data-size"), ...RECT(ic), color: getComputedStyle(ic).color, fontSize: getComputedStyle(ic).fontSize })),
        inlineSvg: qa("svg", el).map((s) => ({ ...RECT(s), color: getComputedStyle(s).color })),
        labelEl: cont ? { ...RECT(cont), ...STYLE(cont, ["fontSize","fontWeight","color","lineHeight"]) } : null,
        leafTexts,
        subtext: leafTexts.slice(1),
      };
    });
    return { label, container: { ...GEOM(menu), ...STYLE(menu, CONT), ...STYLE(menu, BORDER) }, list: list ? { ...GEOM(list) } : null, sections, separators, rows };
  });
})()`;

// Full read of the visible connect-apps dialog.
const READ_CONNECT = `(() => {
  ${PAGE_HELPERS}
  const d = qa('[role="dialog"]').filter((e) => RECT(e).width > 0)[0];
  if (!d) return null;
  const BTN = ["backgroundColor","color","borderRadius","fontSize","fontWeight","boxShadow","borderTopWidth","borderTopColor"];
  const txt = (e) => (e.textContent || e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.value || "").trim().slice(0, 44);
  const container = { selector: ".ui-dialog[role=dialog]", ...GEOM(d), ...STYLE(d, ["backgroundColor","borderRadius","boxShadow","borderTopWidth","borderTopColor","borderTopStyle","zIndex","position","overflow","fontFamily","fontSize","fontWeight","color","padding"]) };
  const titleEl = [...d.querySelectorAll("h1,h2")].find((e) => RECT(e).height > 0);
  const title = titleEl ? { tag: titleEl.tagName, text: txt(titleEl), ...RECT(titleEl), ...STYLE(titleEl, ["fontSize","fontWeight","color"]) } : null;
  const closeBtn = [...d.querySelectorAll("button")].find((b) => /关闭|close/i.test(txt(b))) || null;
  const close = closeBtn ? { text: txt(closeBtn), ...RECT(closeBtn), ...STYLE(closeBtn, BTN) } : null;
  const search = d.querySelector('input[role="combobox"], input[type="search"], input');
  const searchBox = search ? { selector: 'input[role=combobox]', placeholder: search.getAttribute("placeholder") || search.getAttribute("aria-label"), ...RECT(search), ...STYLE(search, ["fontSize","fontWeight","color","backgroundColor","borderRadius"]) } : null;
  const installedBtn = d.querySelector(".sand-plugins__installed-preview");
  const installedPreview = installedBtn ? { selector: ".sand-plugins__installed-preview", text: txt(installedBtn), ...RECT(installedBtn), ...STYLE(installedBtn, BTN) } : null;
  const botTpl = [...d.querySelectorAll("button")].find((b) => /Bot 模板/.test(txt(b)));
  const botTemplate = botTpl ? { text: txt(botTpl), ...RECT(botTpl), ...STYLE(botTpl, BTN) } : null;
  const btns = qa("button", d).filter((b) => RECT(b).height > 0);
  const chips = btns.filter((b) => { const r = RECT(b); return r.top >= 178 && r.top <= 214 && r.height <= 30; }).map((b) => ({ text: txt(b), ...RECT(b), ...STYLE(b, BTN), active: getComputedStyle(b).backgroundColor === "rgb(28, 28, 28)" }));
  const headings = [...d.querySelectorAll("h3")].filter((e) => RECT(e).height > 0).map((e) => ({ text: txt(e), ...RECT(e), ...STYLE(e, ["fontSize","fontWeight","color"]) }));
  const viewAll = qa(".sand-plugins__group-action", d).map((b) => ({ text: txt(b), ...RECT(b), ...STYLE(b, BTN) }));
  const grid = d.querySelector(".sand-plugins__grid");
  const gridInfo = grid ? { selector: ".sand-plugins__grid", ...GEOM(grid), ...STYLE(grid, ["display","gridTemplateColumns","gap"]) } : null;
  const rowEls = qa(".sand-plugins-row__open", d).filter((e) => RECT(e).height > 0);
  const rows = rowEls.slice(0, 6).map((e) => {
    const nameEl = e.querySelector(".sand-plugins-row__name");
    const subEl = e.querySelector(".sand-plugins-row__subtitle");
    const grp = e.closest(".sand-plugins-row");
    return { text: txt(e), ...RECT(e), ...STYLE(e, ["backgroundColor","borderRadius","fontSize","fontWeight","padding","gap","height"]),
      name: nameEl ? { text: txt(nameEl), ...RECT(nameEl), ...STYLE(nameEl, ["fontSize","fontWeight","color"]) } : null,
      subtitle: subEl ? { text: txt(subEl), ...RECT(subEl), ...STYLE(subEl, ["fontSize","fontWeight","color","lineHeight"]) } : null,
      outerRow: grp ? { ...RECT(grp), ...STYLE(grp, ["backgroundColor","borderRadius","padding","gap","height"]) } : null };
  });
  const trailingBtns = qa(".sand-plugins-row__trailing .sand-button, .sand-plugins-row .sand-button", d).filter((e) => RECT(e).height > 0).slice(0, 4).map((b) => ({ text: txt(b), ...RECT(b), ...STYLE(b, BTN) }));
  const added = qa(".sand-plugins__added", d).slice(0, 3).map((e) => ({ text: txt(e), ...RECT(e), ...STYLE(e, ["color","backgroundColor","fontSize","fontWeight","borderRadius"]) }));
  const teamBadges = qa(".sand-plugins__team-badge", d).slice(0, 3).map((e) => ({ text: txt(e), ...RECT(e), ...STYLE(e, ["color","backgroundColor","fontSize","borderRadius","padding"]) }));
  return { container, title, close, searchBox, installedPreview, botTemplate, chips, headings, viewAll, grid: gridInfo, rowCount: rowEls.length, rows, trailingButtons: trailingBtns, addedConnectedMarker: added, teamBadges };
})()`;

async function capture() {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages().find((p) => p.url().includes("index.html")) || browser.contexts()[0].pages()[0];
  if (!page) throw new Error("no Grok Bot page target on " + CDP);
  await page.bringToFront().catch(() => {});

  fs.mkdirSync(SHOTS, { recursive: true });
  const shot = async (name, clipSel) => {
    try {
      const file = path.join(SHOTS, name + ".png");
      if (clipSel) {
        const el = await page.$(clipSel);
        if (!el) return null;
        await el.screenshot({ path: file });
      } else {
        await page.screenshot({ path: file, fullPage: false });
      }
      return file;
    } catch (e) {
      console.log("shot failed " + name + ": " + e.message.split("\n")[0]);
      return null;
    }
  };
  // viewport-clip screenshot given a {left,top,width,height} rect
  const clipShot = async (name, rect) => {
    try {
      if (!rect) return null;
      const file = path.join(SHOTS, name + ".png");
      await page.screenshot({ path: file, clip: { x: Math.max(0, rect.left), y: Math.max(0, rect.top), width: Math.max(1, rect.width), height: Math.max(1, rect.height) } });
      return file;
    } catch (e) {
      console.log("clip shot failed " + name + ": " + e.message.split("\n")[0]);
      return null;
    }
  };

  const meta = await page.evaluate(() => ({
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    title: document.title,
  }));

  let spec;
  if (MERGE_ONLY) {
    // Preserve every existing key byte-for-byte; only the extended keys are refreshed.
    spec = JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
  } else {
    spec = await page.evaluate(`(() => {
      ${PAGE_HELPERS}
      const COLOR_PROPS = ["color", "backgroundColor", "borderTopWidth", "borderTopColor", "borderTopStyle", "borderRadius", "boxShadow", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "opacity"];
      const out = {};

      // ---- window shell -------------------------------------------------
      const shell = q(".sand-shell") || document.body;
      out.windowShell = { selector: ".sand-shell", ...GEOM(shell), ...STYLE(shell, ["backgroundColor", "fontFamily", "fontSize", "color"]) };
      out.windowShell.bodyBackground = getComputedStyle(document.body).backgroundColor;

      // ---- sidebar ------------------------------------------------------
      const aside = q("aside.sand-agents-sidebar");
      out.sidebar = { selector: "aside.sand-agents-sidebar", ...GEOM(aside), ...STYLE(aside, ["backgroundColor", "borderRightWidth", "borderRightColor", "borderRightStyle", "color", "fontFamily", "fontSize"]) };
      const sbHeader = q(".sand-agents-sidebar__header");
      out.sidebarHeader = { selector: ".sand-agents-sidebar__header", ...GEOM(sbHeader), ...STYLE(sbHeader, COLOR_PROPS) };
      out.sidebarHeaderButtons = qa(".sand-agents-sidebar__header button").map((b) => ({ ...RECT(b), ...STYLE(b, ["backgroundColor", "borderRadius", "borderTopWidth", "borderTopColor", "color", "boxShadow"]) }));

      // ---- session rows -------------------------------------------------
      const rows = qa("button.sand-agent-item").filter((r) => r.getBoundingClientRect().height > 0);
      const row = rows[0];
      const rowRect = RECT(row);
      const pitch = rows.length > 1 ? +(RECT(rows[1]).top - rowRect.top).toFixed(1) : null;
      out.sessionRow = {
        selector: "button.sand-agent-item",
        count: rows.length,
        ...GEOM(row),
        ...STYLE(row, COLOR_PROPS),
        verticalPitch: pitch,
        interRowGap: pitch != null ? +(pitch - rowRect.height).toFixed(1) : null,
        title: (() => { const t = row.querySelector(".sand-agent-item__title > span, .sand-agent-item__title"); return { selector: ".sand-agent-item__title", ...RECT(t), ...STYLE(t, ["fontSize", "fontWeight", "color", "lineHeight", "letterSpacing"]) }; })(),
        preview: (() => { const p = row.querySelector(".sand-agent-item__preview"); return { selector: ".sand-agent-item__preview", ...RECT(p), ...STYLE(p, ["fontSize", "fontWeight", "color", "lineHeight"]) }; })(),
        activeRowBackground: (() => { const a = rows.find((r) => getComputedStyle(r).backgroundColor !== "rgba(0, 0, 0, 0)"); return a ? getComputedStyle(a).backgroundColor : null; })(),
      };

      // ---- avatars ------------------------------------------------------
      out.avatar = {
        selector: "button.sand-agent-item .sand-agent-item__avatar",
        ...RECT(row.querySelector(".sand-agent-item__avatar")),
        ...STYLE(row.querySelector(".sand-agent-item__avatar"), ["borderRadius", "backgroundColor", "overflow"]),
        disc: (() => { const d = row.querySelector(".sand-agent-item__avatar-disc"); return { ...RECT(d), ...STYLE(d, ["borderRadius", "backgroundColor"]) }; })(),
        note: "bot mark is an SVG blob (sand-grok-bot-mark) at 153% scale inside a 36px box; wrapper has border-radius 0",
      };

      // ---- group label --------------------------------------------------
      const gh = qa(".sand-agents-section__header")[0];
      out.groupLabel = {
        selector: ".sand-agents-section__header",
        ...GEOM(gh),
        ...STYLE(gh, ["height", "fontSize", "fontWeight", "color", "backgroundColor"]),
        textSpan: (() => { const s = gh.querySelector("span"); return { ...RECT(s), ...STYLE(s, ["fontSize", "fontWeight", "color", "lineHeight", "letterSpacing", "textTransform"]) }; })(),
        count: qa(".sand-agents-section__header").length,
      };

      // ---- composer -----------------------------------------------------
      const dock = q(".sand-chat-input-dock");
      const frame = q(".sand-kit-message-input-frame");
      const field = q(".sand-prompt-field");
      out.composer = {
        selector: ".sand-kit-message-input-frame",
        dock: { selector: ".sand-chat-input-dock", ...GEOM(dock), ...STYLE(dock, ["backgroundColor", "padding"]) },
        ...GEOM(frame),
        ...STYLE(frame, ["backgroundColor", "borderTopWidth", "borderTopColor", "borderTopStyle", "borderRadius", "boxShadow", "padding", "gap"]),
        field: { selector: ".sand-prompt-field", ...RECT(field), ...STYLE(field, ["fontSize", "lineHeight", "color", "fontFamily", "backgroundColor"]) },
        fieldLeftInset: +(RECT(field).left - RECT(frame).left).toFixed(1),
        frameWidthVsPane: null,
      };
      out.composer.frameWidthVsPane = +(RECT(frame).width / RECT(q("main.sand-chat")).width).toFixed(3);

      const actions = qa(".sand-prompt-actions-row button");
      out.attachButton = { selector: ".sand-prompt-actions-row button:first-of-type", ...RECT(actions[0]), ...STYLE(actions[0], ["width", "height", "borderRadius", "backgroundColor", "color", "boxShadow", "borderTopWidth", "borderTopColor"]) };
      const trailingInfo = () => qa(".sand-prompt-actions-trailing button").map((b) => { const cs = getComputedStyle(b); return { ...RECT(b), width: cs.width, height: cs.height, borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, color: cs.color, boxShadow: cs.boxShadow, opacity: cs.opacity, visibility: cs.visibility }; });
      out.trailingButtonsEmpty = trailingInfo();
      out.micButton = out.trailingButtonsEmpty.find((b) => b.visibility === "visible" && b.opacity === "1") || out.trailingButtonsEmpty[0] || null;
      if (out.micButton) out.micButton.selector = ".sand-prompt-actions-trailing button (visible while empty)";

      // ---- assistant bubble ---------------------------------------------
      const msg = q(".sand-message");
      out.bubble = { selector: ".sand-message", ...GEOM(msg), ...STYLE(msg, COLOR_PROPS), hasBorder: parseFloat(getComputedStyle(msg).borderTopWidth) > 0, hasShadow: getComputedStyle(msg).boxShadow !== "none" };
      const prose = q(".sand-message-prose p") || q(".sand-message-prose");
      out.bubbleText = { selector: ".sand-message-prose p", ...RECT(prose), ...STYLE(prose, ["fontSize", "lineHeight", "color", "fontWeight", "letterSpacing"]) };
      out.bubbleVariants = (() => {
        const seen = new Set();
        const list = [];
        for (const m of qa(".sand-message")) {
          const cs = getComputedStyle(m);
          const key = cs.backgroundColor + "|" + cs.color;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({ selector: ".sand-message", ...RECT(m), backgroundColor: cs.backgroundColor, color: cs.color, borderRadius: cs.borderRadius, padding: cs.padding, borderTopWidth: cs.borderTopWidth, boxShadow: cs.boxShadow });
        }
        return list;
      })();
      const nameEl = [...qa(".sand-author-run *")].find((e) => e.children.length === 0 && (e.textContent || "").trim().length > 1 && (e.textContent || "").trim().length < 24);
      out.bubbleAuthorName = nameEl ? { selector: ".sand-author-run (text leaf)", ...RECT(nameEl), ...STYLE(nameEl, ["fontSize", "fontWeight", "color", "lineHeight"]) } : null;
      out.bubbleAvatar = (() => { const g = q(".sand-author-run__gutter"); return g ? { selector: ".sand-author-run__gutter", ...RECT(g), ...STYLE(g, ["borderRadius", "backgroundColor"]) } : null; })();

      // ---- message column geometry --------------------------------------
      const trow = qa(".sand-virtual-transcript__row").find((r) => RECT(r).height > 0);
      const main = q("main.sand-chat");
      out.messageColumn = {
        selector: ".sand-virtual-transcript__row",
        row: { ...GEOM(trow), ...STYLE(trow, ["padding", "backgroundColor"]) },
        paneWidth: +RECT(main).width.toFixed(1),
        rowWidth: +RECT(trow).width.toFixed(1),
        sideMargin: +((RECT(main).width - RECT(trow).width) / 2).toFixed(1),
        maxWidthRule: msg ? STYLE(msg, ["maxWidth"]).maxWidth : null,
        codeBlock: (() => { const c = q(".sand-code-block"); return c ? { ...RECT(c), ...STYLE(c, ["borderRadius", "backgroundColor", "borderTopWidth", "borderTopColor", "boxShadow", "padding"]) } : null; })(),
      };

      // ---- account bar ---------------------------------------------------
      const footer = q(".sand-agents-sidebar__footer");
      const acctBtn = footer.querySelector("button");
      const acctImg = footer.querySelector("img");
      out.accountBar = {
        selector: ".sand-agents-sidebar__footer",
        ...GEOM(footer),
        ...STYLE(footer, ["backgroundColor", "height", "gap"]),
        accountButton: { ...RECT(acctBtn), ...STYLE(acctBtn, ["backgroundColor", "borderRadius", "fontSize", "color", "padding", "boxShadow", "borderTopWidth", "borderTopColor"]) },
        accountAvatar: acctImg ? { ...RECT(acctImg), ...STYLE(acctImg, ["width", "height", "borderRadius"]) } : null,
        emailText: (() => { const s = [...footer.querySelectorAll("span")].find((x) => (x.textContent || "").includes("@")); return s ? { ...RECT(s), ...STYLE(s, ["fontSize", "fontWeight", "color"]) } : null; })(),
        connectAppsButton: (() => { const b = [...footer.querySelectorAll("button")].find((x) => (x.textContent || "").includes("连接")); return b ? { ...RECT(b), ...STYLE(b, ["backgroundColor", "borderRadius", "fontSize", "color", "gap"]) } : null; })(),
      };

      // ---- header pill / toolbar ----------------------------------------
      const headPill = q(".sand-chat-header button");
      out.chatHeader = { selector: ".sand-chat-header button", ...RECT(headPill), ...STYLE(headPill, ["backgroundColor", "borderRadius", "fontSize", "fontWeight", "color", "padding", "borderTopWidth", "borderTopColor", "boxShadow"]) };
      const toolbar = q("header.sand-toolbar");
      out.toolbar = { selector: "header.sand-toolbar", ...GEOM(toolbar), ...STYLE(toolbar, ["backgroundColor", "borderBottomWidth", "borderBottomColor", "boxShadow"]) };

      // ---- tokens / colours ----------------------------------------------
      out.tokens = (() => {
        const cs = getComputedStyle(document.documentElement);
        const names = ["--sand-bg-green-bright", "--sand-bg-primary", "--sand-bg-secondary", "--sand-text-primary", "--sand-text-secondary", "--sand-border", "--sand-accent", "--sand-bg-tertiary"];
        const vars = {};
        for (const n of names) { const v = cs.getPropertyValue(n); if (v) vars[n] = v.trim(); }
        const dot = q(".sand-kit-status-dot");
        return { cssVars: vars, unreadDot: dot ? { selector: ".sand-kit-status-dot", ...RECT(dot), color: getComputedStyle(dot).backgroundColor } : null, rowTextPrimary: getComputedStyle(row).color, previewText: getComputedStyle(row.querySelector(".sand-agent-item__preview")).color, separator: getComputedStyle(aside).borderRightColor };
      })();

      return out;
    })()`);

    // ---- baseline screenshots (element clips) ---------------------------
    await shot("00-window-full", null);
    await shot("01-sidebar", "aside.sand-agents-sidebar");
    await shot("02-session-row", "button.sand-agent-item");
    await shot("03-group-label", ".sand-agents-section__header");
    await shot("04-composer", ".sand-chat-input-dock");
    await shot("05-account-bar", ".sand-agents-sidebar__footer");
    await shot("06-chat-pane", "main.sand-chat");
    await shot("07-header-pill", ".sand-chat-header button");

    await page.evaluate(`(() => { ${PAGE_HELPERS}
      const scroller = qa(".sand-chat-stage .ui-scroll-area__viewport")[0] || q(".sand-chat-stage");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      return 0; })()`);
    await page.waitForTimeout(400);
    await shot("08-bubble-area", ".sand-chat-stage");
    await shot("09-message-row", ".sand-virtual-transcript__row");
    spec.bubbleVariants = await page.evaluate(`(() => { ${PAGE_HELPERS}
      const seen = new Set(); const list = [];
      for (const m of qa(".sand-message")) {
        const cs = getComputedStyle(m);
        const key = cs.backgroundColor + "|" + cs.color;
        if (seen.has(key)) continue; seen.add(key);
        list.push({ selector: ".sand-message", ...RECT(m), backgroundColor: cs.backgroundColor, color: cs.color, borderRadius: cs.borderRadius, padding: cs.padding, borderTopWidth: cs.borderTopWidth, boxShadow: cs.boxShadow });
      }
      return list; })()`);

    // reveal the send button: type one char, measure, clear (never press Enter)
    try {
      await dismissMenus(page);
      await page.click(".sand-prompt-field");
      await page.keyboard.type("1");
      await page.waitForTimeout(350);
      const send = await page.evaluate(`(() => { ${PAGE_HELPERS}
        const btns = qa(".sand-prompt-actions-trailing button");
        const vis = btns.map((b) => { const cs = getComputedStyle(b); const r = RECT(b); return { ...r, opacity: cs.opacity, visibility: cs.visibility, display: cs.display, backgroundColor: cs.backgroundColor, color: cs.color, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow, width: cs.width, height: cs.height }; });
        const solid = vis.filter((v) => v.opacity === "1" && v.visibility === "visible" && !v.backgroundColor.startsWith("rgba"));
        return { all: vis, send: solid[0] || null };
      })()`);
      spec.sendButton = { selector: ".sand-prompt-actions-trailing button (solid fill while typing)", ...(send.send || { notFound: true }), allTrailingWhileTyping: send.all };
      await shot("11-composer-with-text", ".sand-chat-input-dock");
      await page.keyboard.press("Meta+a");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(200);
      const empty = await page.evaluate(`(() => { const f = document.querySelector(".sand-prompt-field"); return (f.textContent || "").trim(); })()`);
      if (empty !== "") console.log("WARNING: composer not cleared, text=" + JSON.stringify(empty));
    } catch (e) { console.log("send-button probe skipped: " + e.message.split("\n")[0]); }
  }

  // ================= EXTENDED CAPTURE (the 4 new key groups) ==============
  const ext = await captureExtended(page, { clipShot });
  spec.accountPopup = ext.accountPopup;
  spec.connectAppsPanel = ext.connectAppsPanel;
  spec.plusMenuItems = ext.plusMenuItems;
  spec.rowInteractionStates = ext.rowInteractionStates;

  if (MERGE_ONLY) {
    // keep the original 23 keys (including meta) byte-for-byte; only the 4 extended
    // keys above were refreshed. Record the extended-refresh time inside accountPopup
    // so the meta block itself stays untouched.
    if (spec.accountPopup && typeof spec.accountPopup === "object") spec.accountPopup.extendedCapturedAt = new Date().toISOString();
    console.log("meta preserved verbatim (merge-extended); extended capture " + spec.accountPopup?.extendedCapturedAt);
  } else {
    spec.meta = { ...meta, capturedAt: new Date().toISOString(), source: "Grok Bot.app (CDP :9224, live renderer)", script: "scripts/grok_real_spec_capture.mjs" };
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(spec, null, 2) + "\n");
  console.log("wrote " + OUT_JSON + (MERGE_ONLY ? "  (--merge-extended: only 4 extended keys refreshed)" : "  (full refresh)"));
  console.log("screenshots in " + SHOTS);

  // Final safety: dismiss everything, restore main chat with an empty composer.
  await restoreCleanState(page);

  await browser.close(); // CDP connection only — the app keeps running
}

// Click openers / dismiss menus with a reversible, idempotent flow.
async function dismissMenus(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
  const openCount = () => page.evaluate(() => ({ menus: [...document.querySelectorAll(".ui-menu")].filter((m) => m.getBoundingClientRect().width > 0).length, dialogs: [...document.querySelectorAll('[role="dialog"]')].filter((m) => m.getBoundingClientRect().width > 0).length }));
  let st = await openCount();
  if (st.menus > 0 || st.dialogs > 0) {
    await page.mouse.click(1000, 730).catch(() => {}); // empty backdrop corner: dismisses ui-menu / dialog without hitting any control
    await page.waitForTimeout(250);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
    st = await openCount();
    if (st.menus > 0 || st.dialogs > 0) console.log("WARNING: could not dismiss all overlays", JSON.stringify(st));
  }
  return st;
}

async function openBySelector(page, sel, nth) {
  const box = await page.evaluate(({ s, n }) => { const e = document.querySelectorAll(s)[n]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, { s: sel, n: nth || 0 });
  if (!box) throw new Error("opener not found: " + sel);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down(); await page.mouse.up();
  return box;
}

async function hoverByMenuText(page, menuLabel, triggerText) {
  const box = await page.evaluate(({ ml, tt }) => {
    const menus = [...document.querySelectorAll(".ui-menu")].filter((m) => m.getBoundingClientRect().width > 0);
    const menu = menus.find((m) => (m.querySelector("[aria-label]") || {}).getAttribute && m.querySelector("[aria-label]").getAttribute("aria-label") === ml) || menus[0];
    if (!menu) return null;
    const e = [...menu.querySelectorAll(".ui-menu__submenu-trigger,.ui-menu__row")].find((x) => (x.textContent || "").trim().startsWith(tt));
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + 20, y: r.top + r.height / 2 };
  }, { ml: menuLabel, tt: triggerText });
  if (!box) { console.log("hover target not found: " + triggerText); return false; }
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(1800);
  return true;
}

async function readMenus(page) { return page.evaluate(READ_MENUS); }
const pickMenu = (snap, label) => snap.find((m) => m.label === label) || null;

function unionRect(a, b) {
  if (!a) return b; if (!b) return a;
  const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width), bottom = Math.max(a.top + a.height, b.top + b.height);
  return { left, top, width: +(right - left).toFixed(1), height: +(bottom - top).toFixed(1) };
}

async function captureExtended(page, { clipShot }) {
  const out = {};

  // ---------- 1) composer "+" menu (plusMenuItems) ----------
  await dismissMenus(page);
  try {
    await openBySelector(page, ".sand-prompt-actions-row button", 0);
    await page.waitForTimeout(500);
    const snap = await readMenus(page);
    const m = pickMenu(snap, "输入框操作") || snap[0] || null;
    out.plusMenuItems = m ? {
      label: m.label,
      container: m.container,
      list: m.list,
      sections: m.sections,
      separators: m.separators,
      itemCount: m.rows.length,
      items: m.rows,
      note: "composer plus-menu; rows have no separators (single flat list); opens above the attach button anchored to .sand-prompt-actions-row button",
    } : { notFound: true };
    if (m) await clipShot("43-plus-menu-items", m.container.rect ? { ...m.container.rect } : m.container);
  } catch (e) { console.log("plusMenuItems probe failed: " + e.message.split("\n")[0]); out.plusMenuItems = { error: e.message.split("\n")[0] }; }
  await dismissMenus(page);

  // ---------- 2) account popup + submenus (accountPopup) ----------
  // Each submenu is hovered from a FRESH root open: the flyout only reliably
  // expands for the first hovered trigger after the popover opens, so we reopen
  // between the 每周用量 and 支持 captures. All steps are reversible (Escape /
  // backdrop click); nothing inside a submenu is clicked through.
  try {
    await openBySelector(page, ".sand-agents-sidebar__footer button", 0);
    await page.waitForTimeout(700);
    const rootSnap = await readMenus(page);
    const root = pickMenu(rootSnap, "账户") || rootSnap[0] || null;

    // hover a plain row (设置, a non-trigger row) to read its hover background
    const hoverBg = await page.evaluate(() => {
      const menus = [...document.querySelectorAll(".ui-menu")].filter((m) => m.getBoundingClientRect().width > 0);
      const menu = menus.find((m) => (m.querySelector("[aria-label]") || {}).getAttribute && m.querySelector("[aria-label]").getAttribute("aria-label") === "账户") || menus[0];
      if (!menu) return null;
      const rows = [...menu.querySelectorAll(".ui-menu__row")];
      const target = rows.find((r) => (r.textContent || "").trim() === "设置") || rows[0];
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    let hoverSample = null;
    if (hoverBg) {
      await page.mouse.move(hoverBg.x, hoverBg.y);
      await page.waitForTimeout(400);
      hoverSample = await page.evaluate(() => {
        const menus = [...document.querySelectorAll(".ui-menu")].filter((m) => m.getBoundingClientRect().width > 0);
        const menu = menus.find((m) => (m.querySelector("[aria-label]") || {}).getAttribute && m.querySelector("[aria-label]").getAttribute("aria-label") === "账户") || menus[0];
        if (!menu) return null;
        const rows = [...menu.querySelectorAll(".ui-menu__row,.ui-menu__submenu-trigger")];
        const hov = rows.find((r) => getComputedStyle(r).backgroundColor !== "rgba(0, 0, 0, 0)");
        return hov ? { text: (hov.textContent || "").trim().slice(0, 20), backgroundColor: getComputedStyle(hov).backgroundColor, color: getComputedStyle(hov).color, transition: getComputedStyle(hov).transitionProperty + " " + getComputedStyle(hov).transitionDuration } : { note: "no hover bg detected" };
      });
    }

    // clear the row highlight to a neutral in-container point, then clip shot 40
    if (root && root.container) {
      await page.mouse.move(root.container.left + 6, root.container.top + 2);
      await page.waitForTimeout(250);
      await clipShot("40-account-popup", { ...root.container });
    }
    await dismissMenus(page);

    const submenus = {};
    // submenu 每周用量: fresh root open, then hover the trigger
    await openBySelector(page, ".sand-agents-sidebar__footer button", 0);
    await page.waitForTimeout(650);
    if (await hoverByMenuText(page, "账户", "每周用量")) {
      const uSnap = await readMenus(page);
      const uMenu = pickMenu(uSnap, "每周用量");
      submenus["每周用量"] = uMenu ? { submenuAriaLabel: uMenu.label, container: uMenu.container, sections: uMenu.sections, separators: uMenu.separators, itemCount: uMenu.rows.length, items: uMenu.rows } : null;
      if (uMenu && root) { const u = unionRect({ ...root.container }, { ...uMenu.container }); await clipShot("41-account-submenu-usage", u); }
    }
    await dismissMenus(page);

    // submenu 支持 (flyout aria-label is "支持选项"): fresh root open, then hover
    await openBySelector(page, ".sand-agents-sidebar__footer button", 0);
    await page.waitForTimeout(650);
    if (await hoverByMenuText(page, "账户", "支持")) {
      const sSnap = await readMenus(page);
      const sMenu = pickMenu(sSnap, "支持选项") || sSnap.find((m) => m.label && m.label !== "账户" && m.label !== "每周用量") || null;
      submenus["支持"] = sMenu ? { submenuAriaLabel: sMenu.label, container: sMenu.container, sections: sMenu.sections, separators: sMenu.separators, itemCount: sMenu.rows.length, items: sMenu.rows } : null;
    }

    out.accountPopup = root ? {
      label: root.label,
      container: root.container,
      list: root.list,
      sectionCount: root.sections.length,
      sections: root.sections,
      separators: root.separators,
      itemCount: root.rows.length,
      items: root.rows,
      rowHoverState: hoverSample,
      submenus,
      notClicked: ["获取移动版 Grok Bot (external/OAuth)", "添加账户 (adds account)", "退出登录 (signs out)", "管理用量 (external usage page)"],
      note: "left-bottom account popover (.ui-menu, aria-label=账户). Submenus (每周用量/支持) open on hover; only style-measured, never clicked through.",
    } : { notFound: true };
  } catch (e) { console.log("accountPopup probe failed: " + e.message.split("\n")[0]); out.accountPopup = { error: e.message.split("\n")[0] }; }
  await dismissMenus(page);

  // ---------- 3) connect apps panel (connectAppsPanel) ----------
  try {
    await openBySelector(page, ".sand-agents-sidebar__footer button", 1); // 2nd footer pill = 连接应用
    await page.waitForTimeout(1500);
    const conn = await page.evaluate(READ_CONNECT);
    out.connectAppsPanel = conn ? {
      ...conn,
      notClicked: ["plugin 连接/添加 buttons (OAuth/third-party connect)", "row 打开 detail", "Bot 模板 (navigates away)"],
      note: "connect-apps dialog opened from the footer 连接应用 pill. Read-only; no third-party app was connected/authorized/enabled.",
    } : { notFound: true };
    if (conn && conn.container) await clipShot("42-connect-panel", { ...conn.container });
  } catch (e) { console.log("connectAppsPanel probe failed: " + e.message.split("\n")[0]); out.connectAppsPanel = { error: e.message.split("\n")[0] }; }
  await dismissMenus(page);

  // ---------- 4) session row interaction states (rowInteractionStates) ----------
  try {
    const rowSel = "button.sand-agent-item";
    const readRows = () => page.evaluate((s) => [...document.querySelectorAll(s)].map((e, i) => ({ i, text: (e.textContent || "").trim().slice(0, 24), rect: (() => { const r = e.getBoundingClientRect(); return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) }; })(), backgroundColor: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color, boxShadow: getComputedStyle(e).boxShadow, borderRadius: getComputedStyle(e).borderRadius, isCurrent: e.getAttribute("aria-current") || /(?:^|\s)page(?:\s|$)/.test(e.className) ? "current" : null })), rowSel);
    const centerOf = (n) => page.evaluate(({ s, i }) => { const e = document.querySelectorAll(s)[i]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, { s: rowSel, i: n });
    const activeIdx = await page.evaluate((s) => { const rs = [...document.querySelectorAll(s)]; return rs.findIndex((e) => getComputedStyle(e).backgroundColor !== "rgba(0, 0, 0, 0)" || /(?:^|\s)page(?:\s|$)/.test(e.className) || e.getAttribute("aria-current")); }, rowSel);

    // hover a row that is NOT the currently-selected one, so the hover colour is not masked
    const hoverIdx = activeIdx === 0 ? 1 : 0;
    const baseline = await readRows();
    const hb = await centerOf(hoverIdx);
    await page.mouse.move(hb.x, hb.y);
    await page.waitForTimeout(500);
    const hoverRows = await readRows();
    const hoverState = hoverRows[hoverIdx];
    await clipShot("44-row-hover", { left: baseline[hoverIdx].rect.left - 4, top: baseline[hoverIdx].rect.top - 4, width: baseline[hoverIdx].rect.width + 8, height: baseline[hoverIdx].rect.height + 8 });

    // click that row -> it becomes the current/selected session (read-only navigation)
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(1400);
    await page.mouse.move(600, 420); // move pointer off so hover does not mask the selected colour
    await page.waitForTimeout(300);
    const afterClick = await readRows();
    const selectedState = afterClick[hoverIdx];

    out.rowInteractionStates = {
      selector: rowSel,
      rowRect: baseline[0].rect,
      idle: { index: hoverIdx, backgroundColor: baseline[hoverIdx].backgroundColor, color: baseline[hoverIdx].color, borderRadius: baseline[hoverIdx].borderRadius, boxShadow: baseline[hoverIdx].boxShadow },
      hover: hoverState,
      selected: selectedState ? { index: selectedState.i, text: selectedState.text, backgroundColor: selectedState.backgroundColor, color: selectedState.color, borderRadius: selectedState.borderRadius, boxShadow: selectedState.boxShadow, marker: selectedState.isCurrent } : null,
      originalActiveIndex: activeIdx,
      note: "idle transparent -> hover rgba(28,28,28,0.06) -> selected/current rgba(28,28,28,0.08) (aria-current / class 'page'). Hover measured on a non-selected row to avoid masking; opening a session is read-only navigation.",
    };
    // restore the originally-selected session (fall back to the top row = main chat)
    const restoreIdx = activeIdx >= 0 ? activeIdx : 0;
    out._rowRestoreIndex = restoreIdx;
    if (restoreIdx !== hoverIdx) { const rb = await centerOf(restoreIdx); await page.mouse.move(rb.x, rb.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(1100); }
  } catch (e) { console.log("rowInteractionStates probe failed: " + e.message.split("\n")[0]); out.rowInteractionStates = { error: e.message.split("\n")[0] }; }

  return out;
}

// Restore to the main chat with an empty composer, no open overlays.
// (The row-interaction block already re-selected the originally-active session;
// here we only ensure overlays are gone and the composer is empty.)
async function restoreCleanState(page) {
  try {
    await dismissMenus(page);
    // ensure the composer is empty
    await page.click(".sand-prompt-field").catch(() => {});
    await page.keyboard.press("Meta+a").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => ({ composer: (document.querySelector(".sand-prompt-field")?.textContent || "").trim(), menus: [...document.querySelectorAll(".ui-menu")].filter((m) => m.getBoundingClientRect().width > 0).length, dialogs: [...document.querySelectorAll('[role="dialog"]')].filter((m) => m.getBoundingClientRect().width > 0).length }));
    await page.mouse.move(600, 420);
    console.log("restored state:", JSON.stringify(state));
    if (state.composer !== "" || state.menus > 0 || state.dialogs > 0) console.log("WARNING: not fully clean after restore");
  } catch (e) { console.log("restore failed: " + e.message.split("\n")[0]); }
}

capture().catch((e) => { console.error("grok_real_spec_capture failed:", e && e.stack ? e.stack : e); process.exit(1); });
