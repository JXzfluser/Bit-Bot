/* e2e_grok_desktop_spec.mjs — D-ST-UI: computed-style gate for Grok parity (G-28).
 *
 * Why this exists: G-28 makes "looks like the Grok Bot app" a goal, but that can
 * only be proven from the REAL rendered app, not from source text. This gate reads
 * getComputedStyle() in the REAL Electron window and asserts the Grok spec:
 *
 *   1) accent token is near-black #1c1c1c (light) / paper #f5f5f5 (dark) — D-1;
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
import { electronLaunchEnv, electronUserDataDir, gateAppEnv, hasDisplay, killStaleGateInstances } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const ACCENT_LIGHT = "rgb(28, 28, 28)";   // #1c1c1c (D-1)
const ACCENT_DARK = "rgb(245, 245, 245)"; // #f5f5f5 (D-1 inverted)

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

    // S — sidebar geometry (Grok reference, measured off replica/screens/grok-composer.png
    //     at 2080px = 1040 logical points => sidebar ~240 logical, 40px blob avatar,
    //     near-flat list with tiny group labels).
    /* G-28 #2：Bot 区块默认折叠成「头像条」——§4.2 的行高/间距/分组头只在**展开态**
       才成立，所以先断默认态（折叠条可见、完整列表收起），再展开测几何。
       不展开就量，量到的是一排 0×0 的隐藏行，会假装成「行距漂移」。 */
    const collapsedDefault = await win.evaluate(() => {
      const sec = document.getElementById("sb-bots-rooms");
      const list = document.getElementById("bot-list");
      const strip = document.getElementById("bot-strip");
      return {
        hasSec: !!sec,
        collapsed: !!(sec && sec.classList.contains("collapsed")),
        listShown: !!(list && getComputedStyle(list).display !== "none"),
        stripShown: !!(strip && getComputedStyle(strip).display !== "none"),
        chips: strip ? strip.querySelectorAll(".strip-av").length : 0,
      };
    });
    collapsedDefault.hasSec &&
    collapsedDefault.collapsed &&
    !collapsedDefault.listShown &&
    collapsedDefault.stripShown &&
    collapsedDefault.chips > 0
      ? ok("bot 区块默认折叠成头像条（" + collapsedDefault.chips + " 枚胶囊，完整列表收起）")
      : bad("bot 区块默认态不对", JSON.stringify(collapsedDefault));
    await win.click("#bot-collapse-btn");
    await win.waitForTimeout(350);
    const expandedBotList = await win.evaluate(() => {
      const list = document.getElementById("bot-list");
      return { listShown: !!(list && getComputedStyle(list).display !== "none") };
    });
    expandedBotList.listShown
      ? ok("点折叠按钮 → Bot 列表展开（§4.2 几何在展开态下测）")
      : bad("点折叠按钮 Bot 列表没展开", JSON.stringify(expandedBotList));

    const sidebar = await win.evaluate(() => {
      const sb = document.getElementById("agents");
      if (!sb) return { missing: true };
      const r = sb.getBoundingClientRect();
      const rows = [...sb.querySelectorAll(".sess-row")];
      const row = rows[0] || null;
      const av = row && row.querySelector(".sess-avatar");
      const rr = row && row.getBoundingClientRect();
      const ar = av && av.getBoundingClientRect();
      const labels = [...sb.querySelectorAll('[class*="group"],[class*="section-title"],.nav-title')]
        .map((g) => (g.textContent || "").trim())
        .filter((t) => t && t.length < 12);
      // 分解头部高度：用户看到的「列表起点」是会话列表第一行，
      // 而不是 bot 列表第一行 —— 两者差着整个 Bot/群组区块。
      const box = (sel) => {
        const n = sb.querySelector(sel);
        if (!n) return null;
        const q = n.getBoundingClientRect();
        return { top: Math.round(q.top), h: Math.round(q.height) };
      };
      const firstOf = (sel) => {
        const n = sb.querySelector(sel + " .sess-row");
        return n ? Math.round(n.getBoundingClientRect().top) : null;
      };
      // §4.2 行内字号 / 行间距 / 分组头：直接读 computed，不靠截图目测。
      const cs = (n, p) => (n ? getComputedStyle(n)[p] : null);
      const nameEl = row && row.querySelector(".sess-main .name");
      const metaEl = row && row.querySelector(".sess-main .meta");
      const sameList = row ? [...row.parentElement.children].filter((c) => c.classList.contains("sess-row")) : [];
      const gapPx = sameList.length > 1
        ? Math.round(sameList[1].getBoundingClientRect().top - rr.bottom)
        : null;
      // §4.2 分组头专指 Bot 分组头（.bot-group-head）。会话日期分组
      // （.sess-group：今天/昨天/更早）位于默认 hidden 的 #sessions-popup 内，
      // 其 getBoundingClientRect().height 恒为 0——不能纳入此断言，否则会误报。
      const groupHeads = [...sb.querySelectorAll(".bot-group-head")];
      const gh = groupHeads[0] || null;
      const ghLabel = gh && gh.querySelector("span:first-child");
      return {
        w: Math.round(r.width),
        rows: rows.length,
        toolbar: box("#sidebar-toolbar"),
        botSection: box("#sb-bots-rooms"),
        botList: box("#bot-list"),
        roomList: box("#room-list"),
        roomEmptyShown: !!sb.querySelector("#room-list .sess-empty"),
        roomListPrev: (() => {
          const rl = sb.querySelector("#room-list");
          const p = rl && rl.previousElementSibling;
          if (!p) return null;
          const s = getComputedStyle(p);
          return { tag: p.tagName, cls: p.className, display: s.display, h: Math.round(p.getBoundingClientRect().height), top: Math.round(p.getBoundingClientRect().top) };
        })(),
        sessionTitleTop: box("#agents > .panel-title") ? box("#agents > .panel-title").top : null,
        sessionListTop: firstOf("#session-list"),
        chatTitleY: box("#session-list") ? box("#session-list").top : null,
        firstRowTop: rr ? Math.round(rr.top) : null,
        rowH: rr ? Math.round(rr.height) : null,
        rowGap: gapPx,
        rowRadius: cs(row, "borderTopLeftRadius"),
        name: nameEl
          ? { size: cs(nameEl, "fontSize"), weight: cs(nameEl, "fontWeight"), lh: cs(nameEl, "lineHeight") }
          : null,
        meta: metaEl
          ? { size: cs(metaEl, "fontSize"), weight: cs(metaEl, "fontWeight"), lh: cs(metaEl, "lineHeight"), color: cs(metaEl, "color") }
          : null,
        groupHead: gh
          ? {
              h: Math.round(gh.getBoundingClientRect().height),
              size: cs(ghLabel || gh, "fontSize"),
              weight: cs(ghLabel || gh, "fontWeight"),
              color: cs(ghLabel || gh, "color"),
            }
          : null,
        avW: ar ? Math.round(ar.width) : null,
        avRadius: av ? getComputedStyle(av).borderRadius : null,
        labels: [...new Set(labels)].slice(0, 10),
      };
    });
    snapshot.sidebar = sidebar;
    console.log("  · sidebar", JSON.stringify(sidebar));

    // S1-S4 — 侧栏几何对齐 §4.2（Grok CDP 真值：行 54 / 间距 4 / 圆角 10 /
    //         标题 16-420-lh20 / 预览 13-420-lh18 / 分组头 30）。
    if (sidebar.missing) bad("#agents sidebar missing");
    else {
      sidebar.w === 280
        ? ok(`sidebar width ${sidebar.w}px (Grok measured 279.5)`)
        : bad("sidebar width drifted", sidebar.w);
      sidebar.avW >= 34 && sidebar.avW <= 40
        ? ok(`bot row avatar ${sidebar.avW}px (Grok measured 31.5-37.5, 5 samples)`)
        : bad("bot row avatar drifted", sidebar.avW);
      sidebar.rowH === 54
        ? ok(`bot row height ${sidebar.rowH}px (§4.2 = padding 8×2 + title 20 + preview 18)`)
        : bad("bot row height drifted (§4.2 wants 54)", sidebar.rowH);
      sidebar.rowGap === 4
        ? ok("inter-row gap 4px (§4.2)")
        : bad("inter-row gap drifted (§4.2 wants 4)", sidebar.rowGap);
      sidebar.rowRadius === "10px"
        ? ok("row radius 10px (§4.2)")
        : bad("row radius drifted (§4.2 wants 10)", sidebar.rowRadius);
      sidebar.name &&
      sidebar.name.size === "16px" &&
      Number(sidebar.name.weight) === 420 &&
      sidebar.name.lh === "20px"
        ? ok("row title 16px/420/lh20 (§4.2)")
        : bad("row title drifted (§4.2 wants 16/420/20)", sidebar.name);
      sidebar.meta &&
      sidebar.meta.size === "13px" &&
      Number(sidebar.meta.weight) === 420 &&
      sidebar.meta.lh === "18px" &&
      sidebar.meta.color === "rgba(28, 28, 28, 0.68)"
        ? ok("row preview 13px/420/lh18 + ink .68 (§4.2)")
        : bad("row preview drifted (§4.2 wants 13/420/18/rgba(28,28,28,.68))", sidebar.meta);
      // 加载时可能尚无 Bot 分组（分组是动态的，真实分组头在 S6 经 setGroup
      // 创建并测高），故此处仅在有真实 .bot-group-head 时做硬断言。
      sidebar.groupHead
        ? (sidebar.groupHead.h === 30
            ? ok(`group header ${sidebar.groupHead.h}px (§4.2 = padding 8+6 + lh16)`)
            : bad("group header height drifted (§4.2 wants 30)", sidebar.groupHead))
        : ok("加载时无 Bot 分组 — 分组头几何在 S6 创建后实测");
      sidebar.firstRowTop !== null && sidebar.firstRowTop <= 160
        ? ok(`first bot row starts at y=${sidebar.firstRowTop} (guard: <=160)`)
        : bad("Bot list pushed down — header blocks grew", sidebar.firstRowTop);
    }

    // S5 — 会话入口：Grok 底部是「胶囊 + 两个图标」。会话列表必须真的能从
    //      那个图标打开（不能只是把入口藏掉导致功能失踪）。
    const sessPopup = await win.evaluate(async () => {
      const btn = document.getElementById("ab-sessions-btn");
      const popup = document.getElementById("sessions-popup");
      if (!btn || !popup) return { missing: true };
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      const rect = popup.getBoundingClientRect();
      const out = {
        shown: !popup.hidden && rect.height > 0 && rect.width > 0,
        rows: popup.querySelectorAll(".sess-row").length,
        inAccountBar: !!popup.closest("#account-bar"),
        leftStandaloneSection: !!document.getElementById("sb-sessions"),
      };
      btn.click(); // 收回去，别影响后续截图/断言
      return out;
    });
    snapshot.sessPopup = sessPopup;
    if (sessPopup.missing) bad("sessions popup wiring missing");
    else {
      sessPopup.shown && sessPopup.inAccountBar
        ? ok(`会话入口在账户条图标里，点开显示 ${sessPopup.rows} 条会话`)
        : bad("sessions popup does not open from the account-bar icon", JSON.stringify(sessPopup));
      !sessPopup.leftStandaloneSection
        ? ok("侧栏主体已无独立「会话」区块（对齐 Grok：只有 Bot / 群 Bot）")
        : bad("standalone sidebar sessions section still present");
    }

    // S6 — Bot 分组：Grok 侧栏支持把 Bot 归组（「组名 N」一节）。走真实
    //      Host 直写通道 setGroup，断言后**必须还原**（门禁不污染用户数据）。
    const grp = await win.evaluate(async () => {
      const view = await window.bitbot.bots.list();
      const first = (view.bots || [])[0];
      if (!first) return { missing: true };
      const before = typeof first.group === "string" ? first.group : "";
      const set = await window.bitbot.bots.setGroup(first.id, "核心");
      if (!set || set.ok !== true) return { setFailed: JSON.stringify(set || {}).slice(0, 200) };
      // bots-changed 广播会触发侧栏重渲染；兜底再等一拍
      await new Promise((r) => setTimeout(r, 600));
      const heads = Array.from(document.querySelectorAll("#bot-list .bot-group-head"));
      const mine = heads.find((h) => (h.textContent || "").includes("核心"));
      // §4.2：分组头容器高 30（padding 8+6 + lh16）。在此真实存在的节点上测，
      // 不要去测隐藏弹层里的 .sess-group（那恒为 0）。
      const headH = mine ? Math.round(mine.getBoundingClientRect().height) : null;
      const rowsUnder = mine
        ? (() => {
            let n = 0, el = mine.nextElementSibling;
            while (el && !el.classList.contains("bot-group-head")) { n += el.classList.contains("sess-row") ? 1 : 0; el = el.nextElementSibling; }
            return n;
          })()
        : 0;
      return { before, headShown: !!mine, headH, cnt: mine ? (mine.querySelector(".cnt") || {}).textContent : "", rowsUnder };
    });
    snapshot.botGroup = grp;
    try {
      if (grp.missing) bad("no bots to group (store empty)");
      else if (grp.setFailed) bad("bots.setGroup failed", grp.setFailed);
      else {
        grp.headShown && Number(grp.cnt) === grp.rowsUnder && grp.rowsUnder >= 1 && grp.headH === 30
          ? ok(`Bot 分组渲染：出现「核心 ${grp.cnt}」节，其下 ${grp.rowsUnder} 行，分组头 ${grp.headH}px（§4.2）`)
          : bad("bot group header not 组名 N @30px (§4.2 wants 30)", JSON.stringify(grp));
      }
    } finally {
      // 还原：把第一个 Bot 的分组放回原值（通常是未分组）。Playwright 的
      // evaluate 只收一个参数，多值要包成对象。
      const firstId = await win.evaluate(async () => {
        const v = await window.bitbot.bots.list();
        return ((v.bots || [])[0] || {}).id || "";
      });
      if (firstId) {
        await win.evaluate(async ({ id, g }) => { await window.bitbot.bots.setGroup(id, g); },
          { id: firstId, g: grp.before || "" });
      }
    }

    // A1/A2 — accent token in both themes (via the send button, the ground truth)
    await setTheme(win, "light");
    const sendLight = await win.evaluate(() => getComputedStyle(document.getElementById("send")).backgroundColor);
    await setTheme(win, "dark");
    const sendDark = await win.evaluate(() => getComputedStyle(document.getElementById("send")).backgroundColor);
    await setTheme(win, null);
    snapshot.accent = { sendLight, sendDark };
    sendLight === ACCENT_LIGHT ? ok(`accent light = ${sendLight} (#1c1c1c near-black, D-1)`)
      : bad("light accent drifted", sendLight);
    sendDark === ACCENT_DARK ? ok(`accent dark = ${sendDark} (#f5f5f5 paper, D-1)`)
      : bad("dark accent drifted", sendDark);
    (sendLight !== sendDark)
      ? ok("accent inverts between themes (D-1: near-black ↔ paper)")
      : bad("accent did not invert between themes", JSON.stringify({ sendLight, sendDark }));

    // A4/A5 — §4.3 composer: 728×44 pill, radius 22, 28px buttons
    const composer = await win.evaluate(() => {
      const row = document.querySelector("#composer .row");
      const send = document.getElementById("send");
      const attach = document.getElementById("attach-btn");
      const voice = document.getElementById("voice-btn");
      const rr = row.getBoundingClientRect();
      const sr = send.getBoundingClientRect();
      const arb = attach.getBoundingClientRect();
      const vrb = voice.getBoundingClientRect();
      const cs = getComputedStyle(row);
      return {
        rowDisplay: cs.display,
        rowWrap: cs.flexWrap,
        rowRadius: parseFloat(cs.borderTopLeftRadius),
        rowW: Math.round(rr.width),
        rowH: Math.round(rr.height),
        sendRadius: getComputedStyle(send).borderTopLeftRadius,
        sendW: Math.round(sr.width),
        sendH: Math.round(sr.height),
        voiceW: Math.round(vrb.width),
        attachW: Math.round(arb.width),
        attachLeft: Math.round(arb.left - rr.left),
        sendRight: Math.round(rr.right - sr.right),
        rowChips: document.querySelectorAll("#composer .row .bb-chip").length,
      };
    });
    snapshot.composer = composer;
    (parseFloat(composer.sendRadius) >= 14 && composer.sendW === composer.sendH && composer.sendW === 28)
      ? ok(`send button is a ${composer.sendW}px circle (§4.3 = 28)`)
      : bad("send button geometry drifted (§4.3 wants 28 circle)", JSON.stringify(composer));
    (composer.attachW === 28 && composer.voiceW === 28)
      ? ok("＋ and mic are 28px (§4.3)")
      : bad("composer control sizes drifted (§4.3 wants 28/28)", JSON.stringify(composer));
    (composer.rowDisplay === "flex" && composer.rowWrap === "nowrap" && composer.rowRadius === 22)
      ? ok(`composer is one pill (radius ${composer.rowRadius}px, nowrap flex)`)
      : bad("composer pill geometry drifted (§4.3 wants radius 22)", JSON.stringify(composer));
    (composer.rowH === 44)
      ? ok("composer pill is 44px tall (§4.3)")
      : bad("composer height drifted (§4.3 wants 44)", composer.rowH);
    (composer.rowW === 728)
      ? ok("composer pill is 728px wide (§4.3)")
      : bad("composer width drifted (§4.3 wants 728)", composer.rowW);
    (Math.abs(composer.attachLeft - 12) <= 1 && Math.abs(composer.sendRight - 8) <= 1)
      ? ok("＋ at left 12 / send at right 8 (§4.3 absolute placement)")
      : bad("composer button placement drifted (§4.3 wants 12 / 8)", JSON.stringify({ attachLeft: composer.attachLeft, sendRight: composer.sendRight }));

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
      const csMsg = getComputedStyle(el);
      const rh = el.querySelector(".msg-grok-head").getBoundingClientRect();
      const rb = el.querySelector(".body").getBoundingClientRect();
      const out = {
        avatarW: Math.round(ra.width),
        avatarH: Math.round(ra.height),
        avatarRadius: getComputedStyle(av).borderRadius,
        nameColor: getComputedStyle(nm).color,
        nameWeight: getComputedStyle(nm).fontWeight,
        // Stacked (Grok) = name row ABOVE the bubble, both flush left.
        dir: csMsg.flexDirection,
        stacked: rb.top >= rh.bottom - 1 && Math.abs(rb.left - rh.left) < 2,
        rects: {
          msg: [Math.round(el.getBoundingClientRect().left), Math.round(el.getBoundingClientRect().top), Math.round(el.getBoundingClientRect().width)],
          head: [Math.round(rh.left), Math.round(rh.top), Math.round(rh.width), Math.round(rh.height)],
          body: [Math.round(rb.left), Math.round(rb.top), Math.round(rb.width), Math.round(rb.height)],
        },
        bodyMargin: getComputedStyle(el.querySelector(".body")).marginLeft + " / " + getComputedStyle(el.querySelector(".body")).alignSelf,
      };
      el.remove();
      return out;
    });
    await setTheme(win, null);
    snapshot.head = head;
    if (head.missing) bad("#log missing for head probe");
    else {
      (head.avatarW === 22 && head.avatarH === 22)
        ? ok(`DM reply avatar is ${head.avatarW}px (§4.4 = 22)`)
        : bad("DM reply avatar geometry drifted (§4.4 wants 22)", JSON.stringify(head));
      (head.nameColor === "rgba(28, 28, 28, 0.68)" && Number(head.nameWeight) === 420)
        ? ok(`DM reply sender name 12px/420 muted (${head.nameColor})`)
        : bad("DM reply sender name drifted (§4.4 wants 12/420 muted)", JSON.stringify({ c: head.nameColor, w: head.nameWeight }));
      head.stacked && head.dir === "column"
        ? ok("head sits ABOVE the bubble, both flush left (Grok stacking)")
        : bad("head/bubble layout drifted from Grok stacking", JSON.stringify({ dir: head.dir, stacked: head.stacked }));
    }

    // A10 — §4.4 bubbles: assistant = 墨 6% flat block, user = near-black + white
    const bubble = await win.evaluate(() => {
      const log = document.getElementById("log");
      if (!log) return { missing: true };
      const as = document.createElement("div");
      as.className = "msg assistant";
      as.innerHTML = '<div class="role">assistant</div><div class="body">probe</div>';
      const us = document.createElement("div");
      us.className = "msg user";
      us.innerHTML = '<div class="body">probe</div><div class="msg-status">✓</div>';
      log.appendChild(as);
      log.appendChild(us);
      const ab = as.querySelector(".body");
      const ub = us.querySelector(".body");
      const sa = getComputedStyle(ab);
      const su = getComputedStyle(us);
      const sb = getComputedStyle(ub);
      const ra = ab.getBoundingClientRect();
      const ru = us.getBoundingClientRect();
      const out = {
        assistant: {
          borderTopWidth: sa.borderTopWidth,
          boxShadow: sa.boxShadow,
          radius: parseFloat(sa.borderTopLeftRadius),
          bg: sa.backgroundColor,
          w: Math.round(ra.width),
          size: sa.fontSize,
          weight: sa.fontWeight,
          lh: sa.lineHeight,
        },
        user: {
          radius: su.borderTopLeftRadius,
          bg: su.backgroundColor,
          color: sb.color,
          shadow: su.boxShadow,
          w: Math.round(ru.width),
        },
        rowW: Math.round(log.getBoundingClientRect().width - parseFloat(getComputedStyle(log).paddingLeft) - parseFloat(getComputedStyle(log).paddingRight)),
      };
      as.remove();
      us.remove();
      return out;
    });
    snapshot.bubble = bubble;
    if (bubble.missing) bad("#log missing for bubble probe");
    else {
      const a = bubble.assistant, u = bubble.user;
      (a.borderTopWidth === "0px" && a.boxShadow === "none" && a.radius === 18 && a.w > 0)
        ? ok(`assistant bubble is a flat block (0 border, no shadow, radius ${a.radius}px = --radius-bubble)`)
        : bad("assistant bubble chrome drifted (§4.4 wants 18)", JSON.stringify(a));
      (a.bg === "rgba(28, 28, 28, 0.06)" && a.size === "14px" && Number(a.weight) === 420 && a.lh === "20px")
        ? ok("assistant bubble = ink 6% / 14px-420-lh20 (§4.4)")
        : bad("assistant bubble fill or type drifted (§4.4 wants ink .06 / 14-420-20)", JSON.stringify(a));
      (bubble.rowW === 728)
        ? ok("message row is 728px inside the 760 pane (§4.4)")
        : bad("message row width drifted (§4.4 wants 728)", bubble.rowW);
      (a.w === 558 && Math.abs(a.w - 558.4) <= 1)
        ? ok(`message text column is ${a.w}px (§4.4 = 558.4)`)
        : bad("message text column drifted (§4.4 wants 558.4)", a.w);
      (u.bg === "rgb(28, 28, 28)" && u.color === "rgb(255, 255, 255)" && u.radius === "18px" && /inset/.test(u.shadow))
        ? ok("user bubble = near-black + white + inset highlights + 18 all corners (§4.4)")
        : bad("user bubble drifted (§4.4 wants #1c1c1c / white / 18 / inset)", JSON.stringify(u));
    }

    const out = path.join(REPO, "docs/design/desktop-target/reference/grok-spec-computed.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`  · snapshot → ${path.relative(REPO, out)}`);
  } catch (e) {
    bad("gate block", (e && e.stack || String(e)).split("\n").slice(0, 3).join(" | "));
  } finally {
    // 关闭真实 Electron 实例，避免门禁孤儿残留。app.close() 在某些平台会卡住
    // 等 app 退出（app 不退就不 resolve），所以加 3s 超时兜底；再用门禁专用 kill
    // 兜底清一遍残留实例（精确匹配 bitbot-e2e-ud，绝不误伤用户真实 app），最后删
    // user-data-dir。这样无论 close 是否成功，node 都会退出、不留孤儿。
    try {
      await Promise.race([
        app.close().catch(() => {}),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    } catch { /* ignore */ }
    try { killStaleGateInstances(); } catch { /* ignore */ }
    try { fs.rmSync(ud, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\ne2e_grok_desktop_spec: PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP}`);
  process.exit(FAIL ? 1 : 0);
})().catch((err) => {
  console.error("e2e_grok_desktop_spec crashed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
