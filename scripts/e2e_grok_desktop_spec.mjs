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

/* 真源派生的期望（`scripts/grok_acceptance_expectations.mjs --write` 的产物）：
   门读它，而不是把 558.4 抄进源码。缺文件/缺字段都不静默放行（见 SP-04）。 */
const EXPECT_FILE = path.join(REPO, "docs/design/desktop-target/reference/grok-acceptance-expectations.json");
let EXPECT_NODE = null;
try {
  EXPECT_NODE = JSON.parse(fs.readFileSync(EXPECT_FILE, "utf8"));
} catch (_e) {
  EXPECT_NODE = null;
}
const EXPECT_BUBBLE_MAXW = (() => {
  const b = EXPECT_NODE && EXPECT_NODE.bubble && EXPECT_NODE.bubble.maxWidth;
  return b && Number.isFinite(b.eq) && Number.isFinite(b.min) && Number.isFinite(b.max) ? b : null;
})();
/* W2 第二格（§8.183）：两个 728 也改读期望带 —— composer 的宽来自 `composer.width`，
   消息行的宽来自 `messageRow.rowWidth`（真源里这是两格独立的读数，以前在门源码里是同一个手抄字面量）。
   取不到带就是 null，配合 inBand 一律 bad：没有期望，这条断言等于没做事。 */
const EXPECT_BAND = (keys) => {
  let n = EXPECT_NODE;
  for (const k of keys) n = n && n[k];
  return n && Number.isFinite(n.eq) && Number.isFinite(n.min) && Number.isFinite(n.max) ? n : null;
};
const EXPECT_COMPOSER_W = EXPECT_BAND(["composer", "width"]);
const EXPECT_ROW_W = EXPECT_BAND(["messageRow", "rowWidth"]);
const EXPECT_PANE_W = EXPECT_BAND(["messageRow", "paneWidth"]);
/* §8.184：SP-02 的底色与**容器**行高也从期望读。派生表曾经只带正文段落的行高（22px），
   而这一格探针读的是气泡容器（真源同一张表里是 20px）—— 用字面量时这个错位看不出来。 */
const EXPECT_ASSISTANT_BG = (EXPECT_NODE && EXPECT_NODE.bubble && EXPECT_NODE.bubble.assistantBackground) || null;
const EXPECT_CONTAINER_LH = (EXPECT_NODE && EXPECT_NODE.bubble && EXPECT_NODE.bubble.containerLineHeight) || null;
const inBand = (v, band) => !!(band && Number.isFinite(Number(v)) && Number(v) >= band.min && Number(v) <= band.max);
const bandNote = (label, band) =>
  `（期望来自 ${path.basename(EXPECT_FILE)} ${label}=${band ? band.eq : "读不到"}，带 ${band ? `${band.min}..${band.max}` : "读不到"}）`;
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
    /* 【布局 v15】Bot 区块默认**展开**成具名行（openbot / v15 的列表列都是具名行；
       折叠成一排首字圆点认不出谁是谁）。折叠能力仍在：点 ▾ 收起成头像条。
       §4.2 的行高/间距/分组头只在**展开态**成立，所以先断默认态（列表可见、
       头像条收起），再点两下验证折叠/展开往返，最后在展开态下测几何。 */
    const defaultState = await win.evaluate(() => {
      const sec = document.getElementById("sb-bots-rooms");
      const list = document.getElementById("bot-list");
      const strip = document.getElementById("bot-strip");
      return {
        hasSec: !!sec,
        collapsed: !!(sec && sec.classList.contains("collapsed")),
        listShown: !!(list && getComputedStyle(list).display !== "none"),
        stripShown: !!(strip && getComputedStyle(strip).display !== "none"),
        rows: list ? list.querySelectorAll(".sess-row").length : 0,
        chips: strip ? strip.querySelectorAll(".strip-av").length : 0,
      };
    });
    defaultState.hasSec &&
    !defaultState.collapsed &&
    defaultState.listShown &&
    !defaultState.stripShown &&
    defaultState.rows > 0
      ? ok("bot 区块默认展开成具名列表（" + defaultState.rows + " 行，头像条收起）—— 布局 v15")
      : bad("bot 区块默认态不对", JSON.stringify(defaultState));
    await win.click("#bot-collapse-btn");
    await win.waitForTimeout(350);
    const collapsedNow = await win.evaluate(() => ({
      collapsed: document.getElementById("sb-bots-rooms").classList.contains("collapsed"),
      stripShown: getComputedStyle(document.getElementById("bot-strip")).display !== "none",
    }));
    collapsedNow.collapsed && collapsedNow.stripShown
      ? ok("点折叠按钮 → 收成头像条（折叠能力保留）")
      : bad("点折叠按钮没折叠", JSON.stringify(collapsedNow));
    await win.click("#bot-collapse-btn");
    await win.waitForTimeout(350);
    const expandedBotList = await win.evaluate(() => {
      const list = document.getElementById("bot-list");
      return { listShown: !!(list && getComputedStyle(list).display !== "none") };
    });
    expandedBotList.listShown
      ? ok("再点一次 → Bot 列表展开（§4.2 几何在展开态下测）")
      : bad("再点一次 Bot 列表没展开", JSON.stringify(expandedBotList));

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

    // S1-S4 — 侧栏行几何。基准从 Grok 的 §4.2（行 54 / 头像 36 / 标题 16-420-lh20 /
    //         预览 13-420-lh18）**重挂到 v15 .row**（行 52 / 头像 30 / 标题 13-600 /
    //         预览 12 / 间距 4 / 圆角 10 不变）。这是规格本身换了，不是放松：
    //         行高与字号改为「实测值必须落在 v15 值上」，仍钉死单值。
    //         行高用容差 ±1 是因为它由 13×1.4 + 12×1.4 + 1 + 8×2 算出来，
    //         不同字体的亚像素取整会差 1px。
    if (sidebar.missing) bad("#agents sidebar missing");
    else {
      sidebar.w === 280
        ? ok(`sidebar width ${sidebar.w}px (v15 .sidebar = 280)`)
        : bad("sidebar width drifted", sidebar.w);
      sidebar.avW === 30
        ? ok(`bot row avatar ${sidebar.avW}px (v15 .ava = 30)`)
        : bad("bot row avatar drifted (v15 wants 30)", sidebar.avW);
      Math.abs(sidebar.rowH - 52) <= 1
        ? ok(`bot row height ${sidebar.rowH}px (v15 = padding 8×2 + 标题 18.2 + 预览 16.8 + 1)`)
        : bad("bot row height drifted (v15 wants 52±1)", sidebar.rowH);
      sidebar.rowGap === 4
        ? ok("inter-row gap 4px (§4.2)")
        : bad("inter-row gap drifted (§4.2 wants 4)", sidebar.rowGap);
      sidebar.rowRadius === "10px"
        ? ok("row radius 10px (v15 .row = 9，本项目取 --radius-lg 10)")
        : bad("row radius drifted (wants 10)", sidebar.rowRadius);
      sidebar.name &&
      sidebar.name.size === "13px" &&
      Number(sidebar.name.weight) === 600 &&
      parseFloat(sidebar.name.lh) >= 17.5 && parseFloat(sidebar.name.lh) <= 18.5
        ? ok("row title 13px/600/lh≈18 (v15 .nm = 12.5/600)")
        : bad("row title drifted (v15 wants 13/600/lh≈18)", sidebar.name);
      sidebar.meta &&
      sidebar.meta.size === "12px" &&
      Number(sidebar.meta.weight) === 400 &&
      parseFloat(sidebar.meta.lh) >= 16 && parseFloat(sidebar.meta.lh) <= 17.5 &&
      sidebar.meta.color === "rgba(28, 28, 28, 0.68)"
        ? ok("row preview 12px/400/lh≈17 + ink .68 (v15 .prev = 11.5)")
        : bad("row preview drifted (v15 wants 12/400/lh≈17/rgba(28,28,28,.68))", sidebar.meta);
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

    // A4/A5 — §4.3 composer: pill, radius 999, 28px buttons，宽度跟 --composer-max
    const composer = await win.evaluate(() => {
      const row = document.querySelector("#composer .row");
      const send = document.getElementById("send");
      const attach = document.getElementById("attach-btn");
      const voice = document.getElementById("voice-btn");
      const main = document.getElementById("main");
      const shell = document.querySelector("#composer");
      const rr = row.getBoundingClientRect();
      const sr = send.getBoundingClientRect();
      const arb = attach.getBoundingClientRect();
      const vrb = voice.getBoundingClientRect();
      const cs = getComputedStyle(row);
      const shellCs = getComputedStyle(shell);
      const capRaw = getComputedStyle(document.body).getPropertyValue("--composer-max").trim();
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
        /* 宽度链的三个输入：面板宽、令牌 --composer-max、容器左右的 16。
           期望带 composer.width（728）从此只当**下限**用（见下面那条断言）。 */
        paneW: main ? Math.round(main.getBoundingClientRect().width) : null,
        capPx: parseFloat(capRaw) || null,
        padX: (parseFloat(shellCs.paddingLeft) || 0) + (parseFloat(shellCs.paddingRight) || 0),
        scrollW: document.documentElement.clientWidth,
      };
    });
    snapshot.composer = composer;
    (parseFloat(composer.sendRadius) >= 14 && composer.sendW === composer.sendH && composer.sendW === 28)
      ? ok(`send button is a ${composer.sendW}px circle (§4.3 = 28)`)
      : bad("send button geometry drifted (§4.3 wants 28 circle)", JSON.stringify(composer));
    /* 布局 v15 换了输入条的形制（.cbox）：侧键 26（原来是 28，和发送同尺寸 ⇒
       一行里三个"按钮"），＋ 距左缘 11（1px 描边 + 10 内边距），
       发送距右缘 7（描边 + 6）。发送键仍是 28 的实心圆 —— 一行里只该有它一个
       被看见的按钮。 */
    (composer.attachW === 26 && composer.voiceW === 26 && composer.sendW === 28
      && Math.abs(composer.attachLeft - 11) <= 1 && Math.abs(composer.sendRight - 7) <= 1)
      ? ok("＋/麦 26px、发送 28px（v15 .cbox：侧键 26、＋ 左 11、发送 右 7）")
      : bad("composer control sizes drifted (v15 wants 26/26/28, attachLeft 11, sendRight 7)", JSON.stringify(composer));
    /* 输入条是"药丸"这件事，判据是**两端半圆**，不是 999 这个数：
       输入框可以被拖高（#composer-grip），999 在 170 高时会变成两个大圆，
       ＋ / 麦 / 发送 全落在弧线上。所以钉 radius ≥ 行高的一半 ——
       42 高时它等价于"药丸"（22 被浏览器钳到 21），拖高之后自然退化成圆角矩形。 */
    (composer.rowDisplay === "flex" && composer.rowWrap === "nowrap" && composer.rowRadius >= composer.rowH / 2 - 0.5)
      ? ok(`composer is one pill (radius ${composer.rowRadius}px ≥ 行高的一半 ${composer.rowH / 2}，两端半圆；拖高后退化成圆角矩形，nowrap flex)`)
      : bad("composer pill geometry drifted (v15 .cbox：一行时两端必须是半圆 ⇒ radius ≥ 行高的一半)", JSON.stringify(composer));
    (composer.rowH === 42)
      ? ok("composer pill is 42px tall (v15 .cbox)")
      : bad("composer height drifted (v15 wants 42)", composer.rowH);
    /* 输入条宽度：**关系式**，不是那个 728。
       728 是「面板 760 − 两侧 16」——它在面板 760 的时候对，但一旦把 728 当绝对值钉住，
       就等于要求输入条永远等于正文列：窗口拉到 1440，面板 1108，正文列合理地停在 760，
       输入条也只能停在 728，两侧各空 190 ⇒ 用户看到的就是「输入框偏窄」。
       真源没把两件事绑在一起（v15 的 .cbox 贴面板走，实测 1004 / 面板 1048 = 0.958，
       而同一屏的气泡只有 558），所以这里钉的是宽度链本身：
         rowW  ==  min(面板宽, --composer-max) − 容器左右内边距
       再补两条下限：输入条**不得窄于正文行**（这是用户口径"输入框偏窄"的可回归形式），
       也不得窄于真源那一档 728。三处任一漂移都会红。 */
    const expectRowW = Math.min(composer.paneW ?? 0, composer.capPx ?? 0) - composer.padX;
    (composer.capPx && composer.paneW && Math.abs(composer.rowW - expectRowW) <= 2
      && composer.rowW >= (EXPECT_ROW_W ? EXPECT_ROW_W.min : 0)
      && composer.rowW >= (EXPECT_COMPOSER_W ? EXPECT_COMPOSER_W.eq : 0))
      ? ok(`composer pill is ${composer.rowW}px = min(面板 ${composer.paneW}, --composer-max ${composer.capPx}) − ${composer.padX}；不窄于正文行 ${EXPECT_ROW_W ? EXPECT_ROW_W.min : "?"}（真源 composer.width=${EXPECT_COMPOSER_W ? EXPECT_COMPOSER_W.eq : "读不到"} 当**下限**用：输入条在宽窗口上刻意比正文列宽）`)
      : bad(`composer width drifted（要的是 rowW = min(面板, --composer-max) − 内边距，且不窄于正文行）${bandNote("composer.width", EXPECT_COMPOSER_W)}`, JSON.stringify({ rowW: composer.rowW, paneW: composer.paneW, capPx: composer.capPx, padX: composer.padX, expectRowW, rowFloor: EXPECT_ROW_W, refComposer: EXPECT_COMPOSER_W, expectFile: EXPECT_FILE }));
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
      const mk = (cls, html) => {
        const d = document.createElement("div");
        d.className = cls;
        d.innerHTML = html;
        return d;
      };
      /* 两条助手行：短的那条量的是「随内容收缩」，长的那条才逼得出 max-width。
         §4.4 的 558.4 是**夹位**，不是行宽 —— 只喂 5 个字去断言它，量到的是探针自己造的值。 */
      const asShort = mk("msg assistant", '<div class="role">assistant</div><div class="body">probe</div>');
      const asLong = mk("msg assistant", '<div class="role">assistant</div><div class="body">' + "字".repeat(400) + "</div>");
      const us = mk("msg user", '<div class="body">probe</div><div class="msg-status">✓</div>');
      log.appendChild(asShort);
      log.appendChild(asLong);
      log.appendChild(us);
      const ab = asShort.querySelector(".body");
      const lb = asLong.querySelector(".body");
      const ub = us.querySelector(".body");
      const sa = getComputedStyle(ab);
      const su = getComputedStyle(us);
      const sb = getComputedStyle(ub);
      const ra = ab.getBoundingClientRect();
      const rl = lb.getBoundingClientRect();
      const ru = us.getBoundingClientRect();
      const out = {
        assistant: {
          borderTopWidth: sa.borderTopWidth,
          boxShadow: sa.boxShadow,
          radius: parseFloat(sa.borderTopLeftRadius),
          bg: sa.backgroundColor,
          w: Math.round(ra.width),
          longW: Math.round(rl.width),
          longWExact: rl.width,
          maxW: sa.maxWidth,
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
        /* 「728 装在 760 的面板里」以前只是散文；paneW 是真的把 padding 加回去读一次，
           这样 SP-03 能同时核对期望的 messageRow.rowWidth 与 messageRow.paneWidth。 */
        paneW: Math.round(log.getBoundingClientRect().width),
      };
      asShort.remove();
      asLong.remove();
      us.remove();
      return out;
    });
    snapshot.bubble = bubble;
    if (bubble.missing) bad("#log missing for bubble probe");
    else {
      const a = bubble.assistant, u = bubble.user;
      (a.borderTopWidth === "0px" && a.boxShadow === "none" && a.radius === 18 && a.w > 0)
        ? ok("[SP-01] assistant bubble is a flat block (0 border, no shadow, radius ${a.radius}px = --radius-bubble)")
        : bad("assistant bubble chrome drifted (§4.4 wants 18)", JSON.stringify(a));
      /* 正文 13px 跟 composer 的输入字号、侧栏 Bot 名字同档（--text-md）。
         真源参考那档是 14px，但用户口径是"对话内容字体跟整体不匹配"——
         打进去 13、回过来 14 会读成两套界面。所以这里钉的是**同档**关系，
         不是把参考读数当绝对值：size 必须等于输入框的实际字号。 */
      const composerFs = await win.evaluate(() => getComputedStyle(document.querySelector("#composer #text")).fontSize);
      (a.bg === EXPECT_ASSISTANT_BG && a.size === composerFs && Number(a.weight) === 420 && a.lh === EXPECT_CONTAINER_LH)
        ? ok(`[SP-02] assistant bubble = ${a.bg} / ${a.size}-${a.weight}-lh${a.lh}（正文字号与输入框 ${composerFs} 同档；底色与容器行高来自 ${path.basename(EXPECT_FILE)}）`)
        : bad(`assistant bubble fill or type drifted (期望：底色 ${EXPECT_ASSISTANT_BG ?? "读不到"} / 容器行高 ${EXPECT_CONTAINER_LH ?? "读不到"} / 与输入框同档 ${composerFs} / 420)`, JSON.stringify(a));
      (inBand(bubble.rowW, EXPECT_ROW_W) && inBand(bubble.paneW, EXPECT_PANE_W))
        ? ok(`[SP-03] message row is ${bubble.rowW}px inside the ${bubble.paneW}px pane (§4.4)${bandNote("messageRow.rowWidth", EXPECT_ROW_W)}${bandNote("messageRow.paneWidth", EXPECT_PANE_W)}`)
        : bad(`message row width drifted (§4.4 要的是期望带内的行宽与面板宽)${bandNote("messageRow.rowWidth", EXPECT_ROW_W)}${bandNote("messageRow.paneWidth", EXPECT_PANE_W)}`, JSON.stringify({ rowW: bubble.rowW, paneW: bubble.paneW, band: EXPECT_ROW_W, paneBand: EXPECT_PANE_W, expectFile: EXPECT_FILE }));
      /* SP-04 的期望从真源派生的 JSON 里读，不钉字面 558.4（§8.180 / W2 第一格）：
         640 那格能活两年，一半原因是「真值」和「门里的数」靠人手抄同源（§8.179）。
         读不到期望一律 bad —— SKIP≠过：没有期望，这条断言等于没做事。 */
      const band = EXPECT_BUBBLE_MAXW;
      const cap = Number(String(a.maxW).match(/(\d+(?:\.\d+)?)px/)?.[1]);
      (band && Number.isFinite(cap) && cap >= band.min && cap <= band.max && Math.abs(a.longW - cap) <= 1 && a.w < cap)
        ? ok(`[SP-04] message text column saturates at ${a.longW}px (max-width ${a.maxW}); short row shrink-wraps to ${a.w}px (期望来自 ${path.basename(EXPECT_FILE)} bubble.maxWidth=${band ? band.eq : "无"}，带 ${band ? `${band.min}..${band.max}` : "无"})`)
        : bad(`message text column 不在期望带内（bubble.maxWidth=${band ? band.eq : "读不到"}，带 ${band ? `${band.min}..${band.max}` : "读不到"}；长句宽度须夹在同一值、短句要真的更窄）`, JSON.stringify({ maxW: a.maxW, longW: a.longW, shortW: a.w, cap, expectFile: EXPECT_FILE }));
      (u.bg === "rgb(28, 28, 28)" && u.color === "rgb(255, 255, 255)" && u.radius === "18px" && /inset/.test(u.shadow))
        ? ok("[SP-05] user bubble = near-black + white + inset highlights + 18 all corners (§4.4)")
        : bad("user bubble drifted (§4.4 wants #1c1c1c / white / 18 / inset)", JSON.stringify(u));
    }

    /* 快照是**本轮实测产物**，不是期望基线 ⇒ 必须写 artifacts/。
     * 以前它写 docs/design/desktop-target/reference/grok-spec-computed.json ——
     * 那是 reference/ 目录，期望基线住在里面，只有人能改。
     * 于是门禁每跑一次就把「我方当前长什么样」覆盖进 reference/，
     * 而这份文件恰恰是 §8.97 那次自证循环里被当成「真源」引用的那一类。
     * 现在：产物进 artifacts/grok-spec/，reference/ 里的那份保持人工版本不动。 */
    const out = path.join(REPO, "artifacts/grok-spec/grok-spec-computed.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n");
    console.log(`  · snapshot → ${path.relative(REPO, out)}（产物，不是基线；reference/ 未动）`);
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
