/* e2e_desktop_mobile_control.mjs — 「移动端远程控制」独立弹窗的真渲染门禁（MC-01..MC-10）
 *
 * 用户拿一张别家产品的截图问「移动端控制，现在有这种成熟度吗？」。答案是：能力在，
 * 入口不在。配对码、发现、换令牌都真跑过（prove_pairing_code 19/0、e2e_android_roster
 * 20/0、APK 16/0），但桌面只把它摊成「设置 → 凭证 → 手机与入站」里的一堆按钮：
 *   - 没有「手机能不能连」的状态点，用户要自己读一句文案才知道就绪没有；
 *   - 没有独立的「移动端远程控制」入口，账户菜单里那条「获取移动版」只是把设置页打开；
 *   - 一键能用的配对码和「抄 64 位令牌」这两条路平铺在同一排按钮里，主次不分。
 * 这一波只做 IA / 状态如实 / 几何（S 档），不动线协议、不加假入口：
 * 二维码是下一波（M 档），真·远程控制工作区（L 档）另立设计。
 *
 * 断言：
 *   MC-01 账户菜单里有「移动端远程控制」入口，点了真开得出弹窗（不是把设置页打开）
 *   MC-02 弹窗标题与说明是中文主路：讲清「6 位配对码」，且整个弹窗里没有任何令牌控件
 *        （抄 64 位令牌不再是这条路上的必经动作）
 *   MC-03 状态点如实：没放开时是 off + 说明「只有桌面自己」；点「允许手机连接」后变 on，
 *        地址与 pairing.state() 一致；地址不是同一 Wi-Fi（scope≠private）时必须补一句实话
 *   MC-04 配对码在弹窗内闭环：生成 → 6 位 + 倒计时 + 按钮文案转成「刷新」；
 *        再点刷新 → 码真换了（旧码不复用）；作废 → 码区收起
 *   MC-05 复制配对链接：没地址时按钮不可点（点了必失败的按钮不是可用）；
 *        放开后可点，点完当场回显「已复制」
 *   MC-06 Esc 与遮罩都能关，且焦点归还到账户按钮（不是丢给 body）
 *   MC-07 Bot Channel 一列只列真支持的三个（钉钉/飞书/企业微信），不出现微信个人号、
 *        Telegram、Lark 这类假入口；「去配置」真跳到 连接应用 的国内渠道卡
 *   MC-08 弹窗里读不到令牌原文（配对码是短时效凭证，令牌不是这一屏要展示的东西）
 *   MC-09 480×720（产品 minWidth）：弹窗不破版 —— sheet 不超视口、无横向滚动、
 *        两列降为单列、关闭与生成两个键都在视口内点得到
 *   MC-10 设置里那张旧卡不再假装是主路：有一句指向新弹窗的说明（一处真相，两处入口不打架）
 *   MC-11 480 宽下账户弹层 itself 点得到：菜单里**每一行**（按 .ap-item 动态取，
 *        不写死清单）都不许开到视口外，且各自命中自己。（这条是顺带挖出来的
 *        真缺陷 —— 横带把账户条抬到 y≈143，平时向上开的弹层整片跑到屏外，
 *        「移动端远程控制」以及其他每一项在窄窗口里都点不动）
 *        顺带守住「手机只留一个入口」：ap-mobile 不许回来、ap-remote 不许消失。
 *   MC-12 旧深链 anchor=pairing（内核/CLI 还在发，指向已删除的「设置 → 手机」）
 *        落到弹窗而不是空页签；且不许在 sheet 栈里留下已藏起来的设置页 ——
 *        否则用户按第一次 Esc 关掉的是那个隐形面板，弹窗纹丝不动。
 *
 * 跑法：ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/e2e_desktop_mobile_control.mjs
 * 缺 electron / 缺显示环境时诚实 SKIP。
 *
 * ── 修复前红（HEAD 8ca2c5e 产品代码的真实输出，PASS=0 FAIL=10）──────────────
 *   ✗ MC-01 账户菜单里没有「移动端远程控制」入口（#ap-remote 不存在）
 *   ✗ MC-02 弹窗不存在（#mobile-control-modal 不存在）
 *   ✗ MC-03 弹窗不存在，状态点无从校验（#mc-dot 不存在）
 *   ✗ MC-04 弹窗内没有生成配对码的入口（#mc-gen-btn 不存在）
 *   ✗ MC-05 弹窗内没有复制配对链接按钮（#mc-copy-url-btn 不存在）
 *   ✗ MC-06 弹窗打不开，Esc/遮罩无从测起
 *   ✗ MC-07 弹窗内没有 Bot Channel 一列（#mc-channel-card 不存在）
 *   ✗ MC-08 弹窗不存在，令牌原文校验无从落手
 *   ✗ MC-09 弹窗不存在（480 宽下没有任何可量的 sheet）
 *   ✗ MC-10 旧卡里没有指向新弹窗的说明（#sec-pairing-modal-hint 不存在）
 * ── 实现后仍红（弹窗已绿，窄屏挖出第二条真缺陷，PASS=9 FAIL=2）───────────────
 *   ✗ MC-11 / MC-09：page.click('#ap-remote') 超时 —— "element is outside of the
 *     viewport"。量出来的现场（480×693 视口、Ctrl+B 展开侧栏后）：
 *     #account-popup y=-167 h=309、#ap-remote y=-97、elementFromPoint = null。
 *     根因：#account-popup 平时用 bottom: calc(100% + 2px) 向上开；≤900 的
 *     「140px 横带」把账户条抬到 y≈143，向上 309px 直接出屏，而 #agents 是
 *     overflow 容器、向下也会被 140px 裁掉。
 * ── 修复后绿 ──────────────────────────────────────────────────────────
 *   e2e_desktop_mobile_control: PASS=11 FAIL=0 SKIP=0
 *   （MC-11 的绿来自横带里 #account-popup 改向下开；同一份现场在 480×720 量到
 *     sheet 442px ≤ 视口、两卡竖排、关闭与生成键各自命中自己）
 *
 * ── 门禁自己的一次假红（第 M34 轮，与产品无关）─────────────────────────
 *   ✗ unexpected error — page.click: Timeout 10000ms exceeded (#account-avatar-btn)
 *   病根不在产品：侧栏「按宽度自适应收起」早已改成手动控制，480 宽下侧栏默认
 *   是**展开**的；而这里原来无脑按 Ctrl+B「展开侧栏」，那一下在今天的代码里
 *   是把侧栏**收起**，账户条随 #agents display:none 变 0×0，于是点不到、超时。
 *   现在改为先读 body[data-sidebar]，只有真收起时才用 #sidebar-reopen-tab 展开。
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import {
  electronLaunchEnv,
  electronUserDataDir,
  isolatedRepoRoot,
  gateAppEnv,
  hasDisplay,
  countAppMains,
  killGateProcs,
} from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);

let PASS = 0,
  FAIL = 0,
  SKIP = 0;
const ok = (m) => {
  PASS++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  FAIL++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : ""));
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

if (!fs.existsSync(ELECTRON)) {
  console.log("e2e_desktop_mobile_control: SKIP — electron dist missing (" + ELECTRON + ")");
  console.log("e2e_desktop_mobile_control: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log("e2e_desktop_mobile_control: SKIP — no DISPLAY and no xvfb-run");
  console.log("e2e_desktop_mobile_control: PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = new Date().toISOString();
const root = isolatedRepoRoot(REPO, "mobctl", {
  "bots.json": {
    bots: [{ id: "b1", name: "配对助手", job: "配对", description: "", group: "", pinned: false, created_at: NOW, updated_at: NOW }],
    primary: "b1",
  },
  "settings.json": { notify: {} },
  "sessions.json": { sessions: [] },
});
/* A2-5 种子：已登记的设备表必须落在 data/host/devices.json（与入站服务写 last_seen
   的路径一致），isolatedRepoRoot 的种子表只覆盖 data/desktop/，所以这里显式写。 */
fs.mkdirSync(path.join(root, "data", "host"), { recursive: true });
fs.writeFileSync(
  path.join(root, "data", "host", "devices.json"),
  JSON.stringify(
    {
      version: 1,
      devices: [
        { id: "dev-e2e-aaa", name: "测试安卓", kind: "android", public_key_pem: "AAAA", created_at: new Date(Date.now() - 3600 * 1000).toISOString(), revoked_at: null },
        { id: "dev-e2e-bbb", name: "测试 iPhone", kind: "ios", public_key_pem: "BBBB", created_at: new Date().toISOString(), revoked_at: null },
      ],
    },
    null,
    2,
  ),
);
const UD = electronUserDataDir("mobctl");

let launchSeq = 0;
function launch(w, h) {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [
      path.join(DESKTOP, "main.js"),
      "--no-sandbox",
      "--disable-gpu",
      "--user-data-dir=" + electronUserDataDir("mobctl-" + ++launchSeq),
    ],
    cwd: REPO,
    env: electronLaunchEnv(
      gateAppEnv(root, {
        BITBOT_LLM_BASE_URL: "http://127.0.0.1:9/v1",
        BITBOT_LLM_API_KEY: "gate-no-call",
        BITBOT_LLM_MODEL: "gate-no-call",
        BITBOT_LLM_STREAM: "0",
      }),
    ),
  });
}

async function openWindow(w, h) {
  const app = await launch(w, h);
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const x of BrowserWindow.getAllWindows()) {
      x.setAutoHideMenuBar(true);
      x.setMenuBarVisibility(false);
    }
  }).catch(() => {});
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  await win.evaluate(([W, H]) => window.resizeTo(W, H), [w, h]);
  await win.waitForTimeout(300);
  return { app, win };
}

/* 用户的手顺：账户菜单 → 移动端远程控制。门禁不直接调内部函数。 */
async function openViaMenu(win) {
  await win.click("#account-avatar-btn");
  await win.waitForSelector("#ap-remote", { state: "visible", timeout: 8000 });
  await win.click("#ap-remote");
}

/* 修复前红这一段不能靠异常收尾：入口不存在时每个断言都要各自说话，
   否则只剩一条 "unexpected error"，等于知道红了却不知道红在哪。
   失败原因要带出来 —— 「点不到」和「点了没开」是两个不同的病。 */
async function tryOpenModal(win) {
  try {
    await openViaMenu(win);
    await win.waitForTimeout(250);
    const m = await modalState(win);
    return { ok: m.shown, err: m.shown ? "" : JSON.stringify({ exists: m.exists, display: m.display }) };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e).split("\n")[0].slice(0, 200) };
  }
}

const modalState = (win) =>
  win.evaluate(() => {
    const m = document.getElementById("mobile-control-modal");
    if (!m) return { exists: false };
    const cs = getComputedStyle(m);
    const b = m.getBoundingClientRect();
    return {
      exists: true,
      shown: cs.display !== "none" && cs.visibility !== "hidden",
      display: cs.display,
      z: cs.zIndex,
      sheet: (() => {
        const s = m.querySelector(".bb-sheet");
        if (!s) return null;
        const r = s.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), right: Math.round(r.right) };
      })(),
      cards: [
        document.getElementById("mc-pair-card"),
        document.getElementById("mc-channel-card"),
      ].map((c) => {
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
      }),
      text: String(m.innerText || m.textContent || "").replace(/\s+/g, " ").slice(0, 4000),
    };
  });

const readIds = (win, ids) =>
  win.evaluate((list) => {
    const out = {};
    for (const id of list) {
      const el = document.getElementById(id);
      if (!el) {
        out[id] = null;
        continue;
      }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out[id] = {
        text: String(el.textContent || "").replace(/\s+/g, " ").trim(),
        shown: cs.display !== "none" && cs.visibility !== "hidden" && !el.hidden,
        hidden: Boolean(el.hidden),
        disabled: Boolean(el.disabled),
        state: el.dataset ? String(el.dataset.state || "") : "",
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
      };
    }
    return out;
  }, ids);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitLanOpen(win) {
  let st = null;
  for (let i = 0; i < 24; i++) {
    st = await win.evaluate(() => window.bitbot.pairing.state());
    if (st && st.ok && st.lan_open && (st.turn_urls || []).length) return st;
    await sleep(500);
  }
  return st;
}

function shutdown(app) {
  if (!app) return Promise.resolve();
  const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), sleep(ms)]);
  return within(
    app.evaluate(({ app: electronApp }) => {
      electronApp.isQuiting = true;
      electronApp.quit();
    }).then(() => within(app.close(), 12000)),
    20000,
  );
}

let app = null;
let app2 = null;

(async () => {
  try {
    /* ================= 第一档：1280×800，功能与状态 ================= */
    const first = await openWindow(1280, 800);
    app = first.app;
    const win = first.win;

    /* ---------- MC-01 入口在账户菜单里，点了真开弹窗 ---------- */
    {
      const entry = await readIds(win, ["ap-remote"]);
      if (!entry["ap-remote"]) bad("MC-01 账户菜单里没有「移动端远程控制」入口（#ap-remote 不存在）");
      else if (!entry["ap-remote"].text || !/移动端|手机/.test(entry["ap-remote"].text))
        bad("MC-01 入口文案没说是移动端（用户找不到这一条）", JSON.stringify(entry["ap-remote"]));
      else {
        await openViaMenu(win);
        const m = await modalState(win);
        if (!m.exists) bad("MC-01 点了入口但弹窗不存在（#mobile-control-modal）");
        else if (!m.shown) bad("MC-01 弹窗没真显示出来", JSON.stringify({ display: m.display, shown: m.shown }));
        else if (m.z !== "60") bad("MC-01 弹窗必须走 modal 层（--z-modal:60），否则会踩抽屉/composer 分层", "z=" + m.z);
        else ok("MC-01 账户菜单 →「" + entry["ap-remote"].text + "」直接开弹窗（z-index " + m.z + "）");
      }
    }

    /* ---------- MC-02 标题与主路文案：6 位码是主路，令牌不是必经 ---------- */
    {
      const m = await modalState(win);
      const parts = await readIds(win, ["mc-title", "mc-hint", "mc-code-title"]);
      if (!m.exists) bad("MC-02 弹窗不存在（#mobile-control-modal 不存在）");
      else {
        const noTokenControl = await win.evaluate(() => {
          const mo = document.getElementById("mobile-control-modal");
          if (!mo) return null;
          return Array.from(mo.querySelectorAll("[id]")).filter((e) => /token/i.test(e.id)).map((e) => e.id);
        });
        const title = parts["mc-title"] ? parts["mc-title"].text : "";
        const hint = parts["mc-hint"] ? parts["mc-hint"].text : "";
        if (!/移动端|手机/.test(title) || !/控制|连接|配对/.test(title))
          bad("MC-02 标题没交代这是移动端控制", JSON.stringify({ title }));
        else if (!/6\s*位/.test(hint)) bad("MC-02 说明没把「6 位配对码」写成主路", JSON.stringify({ hint: hint.slice(0, 80) }));
        else if (noTokenControl === null) bad("MC-02 弹窗不存在");
        else if (noTokenControl.length) bad("MC-02 这一屏还摆着令牌控件（抄 64 位令牌仍是必经路）", noTokenControl.join(","));
        else if (/复制令牌|抄.*令牌|粘贴.*令牌/.test(m.text)) bad("MC-02 弹窗文案仍在教用户搬 64 位令牌", m.text.slice(0, 120));
        else ok("MC-02 标题「" + title + "」+ 说明走 6 位配对码，弹窗内零令牌控件");
      }
    }

    /* ---------- MC-03 状态点如实：没放开 ≠ 就绪 ---------- */
    {
      const before = await readIds(win, ["mc-dot", "mc-status", "mc-enable-btn"]);
      if (!before["mc-dot"]) bad("MC-03 弹窗不存在，状态点无从校验（#mc-dot 不存在）");
      else if (before["mc-dot"].state !== "off")
        bad("MC-03 未放开局域网时状态点必须是 off（绿点骗用户去试）", JSON.stringify({ state: before["mc-dot"].state, status: before["mc-status"] && before["mc-status"].text }));
      else if (!before["mc-status"] || !/只.*自己|本机|没在听|未就绪/.test(before["mc-status"].text))
        bad("MC-03 状态行没说实话（现在只有桌面自己能连）", JSON.stringify(before["mc-status"]));
      else {
        await win.click("#mc-enable-btn");
        const st1 = await waitLanOpen(win);
        const after = await readIds(win, ["mc-dot", "mc-status", "mc-scope-note"]);
        if (!st1 || !st1.lan_open || !(st1.turn_urls || []).length) {
          bad("MC-03 点「允许手机连接」后没真放开局域网地址", JSON.stringify(st1));
        } else if (after["mc-dot"].state !== "on") {
          bad("MC-03 放开后状态点没转成 on", JSON.stringify(after["mc-dot"]));
        } else if (!after["mc-status"] || after["mc-status"].text.indexOf(st1.pair_base) < 0) {
          bad("MC-03 状态行要写真实放开的地址，不能只是「可以了」", JSON.stringify({ status: after["mc-status"] && after["mc-status"].text, base: st1.pair_base }));
        } else {
          const expectNote = String(st1.pair_scope || "") !== "private";
          const noteShown = Boolean(after["mc-scope-note"] && after["mc-scope-note"].shown);
          if (expectNote && (!noteShown || !/手机|连|走不到|公网|覆盖网|169\.254/.test(after["mc-scope-note"].text)))
            bad("MC-03 地址不是同一 Wi-Fi 的局域网地址时，必须补一句实话", JSON.stringify({ scope: st1.pair_scope, note: after["mc-scope-note"] }));
          else if (!expectNote && noteShown)
            bad("MC-03 局域网地址不该啰嗦，说明行却还亮着（噪音会把真警告淹掉）", JSON.stringify(after["mc-scope-note"]));
          else
            ok(
              "MC-03 状态点 off→on 如实：「" +
                after["mc-status"].text.slice(0, 40) +
                "」（scope=" +
                (st1.pair_scope || "") +
                (noteShown ? "，已补实话" : "") +
                "）",
            );
        }
      }
    }

    /* ---------- MC-04 配对码：生成 / 刷新 / 作废都在弹窗内闭环 ---------- */
    {
      if (!(await modalState(win)).shown) await tryOpenModal(win);
      const g = await readIds(win, ["mc-gen-btn"]);
      if (!g["mc-gen-btn"]) bad("MC-04 弹窗内没有生成配对码的入口（#mc-gen-btn 不存在）");
      else {
        await win.click("#mc-gen-btn");
        await win.waitForTimeout(700);
        const v1 = await readIds(win, ["mc-code", "mc-countdown", "mc-code-block", "mc-gen-btn", "mc-revoke-btn"]);
        const st1 = await win.evaluate(() => window.bitbot.pairing.state());
        const digits1 = v1["mc-code"] ? v1["mc-code"].text : "";
        if (!/^\d{6}$/.test(digits1)) bad("MC-04 生成后应显示 6 位数字", JSON.stringify({ code: digits1 }));
        else if (!v1["mc-countdown"] || !/^\d+:\d{2}$/.test(v1["mc-countdown"].text))
          bad("MC-04 倒计时缺失或格式不对（5 分钟短码必须让用户看见剩余时间）", JSON.stringify(v1["mc-countdown"]));
        else if (!st1 || st1.pair_code !== digits1) bad("MC-04 界面码与 Host 状态不一致", JSON.stringify({ host: st1 && st1.pair_code, ui: digits1 }));
        else if (!(v1["mc-code-block"] && v1["mc-code-block"].shown)) bad("MC-04 配对码区块应可见", JSON.stringify(v1["mc-code-block"]));
        else if (!/刷新/.test(v1["mc-gen-btn"].text)) bad("MC-04 已有码时按钮该转成「刷新」，否则用户以为要另生成一个", JSON.stringify(v1["mc-gen-btn"]));
        else {
          await win.click("#mc-gen-btn");
          await win.waitForTimeout(700);
          const v2 = await readIds(win, ["mc-code"]);
          const st2 = await win.evaluate(() => window.bitbot.pairing.state());
          const digits2 = v2["mc-code"] ? v2["mc-code"].text : "";
          if (!/^\d{6}$/.test(digits2)) bad("MC-04 刷新后码不是 6 位", JSON.stringify({ code: digits2 }));
          else if (digits2 === digits1) bad("MC-04 刷新后还是同一个码（旧码没换掉，等于没刷新）", digits2);
          else if (!st2 || st2.pair_code !== digits2) bad("MC-04 刷新后 Host 状态与界面不一致", JSON.stringify({ host: st2 && st2.pair_code, ui: digits2 }));
          else {
            await win.click("#mc-revoke-btn");
            await win.waitForTimeout(700);
            /* 作废收起的是「码 + 倒计时 + 作废键」这一组（#mc-code-display /
               #mc-code-actions）；外层区块留着标题和说明，用户还要靠它再点生成。 */
            const v3 = await readIds(win, ["mc-code", "mc-code-display", "mc-code-actions", "mc-gen-btn"]);
            const st3 = await win.evaluate(() => window.bitbot.pairing.state());
            if (v3["mc-code"] && v3["mc-code"].text) bad("MC-04 作废后码没清空", JSON.stringify(v3["mc-code"]));
            else if (v3["mc-code-display"] && v3["mc-code-display"].shown) bad("MC-04 作废后码与倒计时还亮着", JSON.stringify(v3["mc-code-display"]));
            else if (v3["mc-code-actions"] && v3["mc-code-actions"].shown) bad("MC-04 作废后「立即作废」按钮还留着（已经没东西可作废了）", JSON.stringify(v3["mc-code-actions"]));
            else if (st3 && st3.pair_code) bad("MC-04 作废后 Host 侧仍认为码有效", JSON.stringify(st3.pair_code));
            else if (!/生成/.test(v3["mc-gen-btn"].text)) bad("MC-04 作废后按钮该回到「生成」", JSON.stringify(v3["mc-gen-btn"]));
            else ok("MC-04 生成 " + digits1 + " → 刷新 " + digits2 + " → 作废收起，Host 与界面每步一致");
          }
        }
      }
    }

    /* ---------- MC-05 复制配对链接：没地址不可点，有地址当场回显 ---------- */
    {
      const c = await readIds(win, ["mc-copy-url-btn", "mc-pair-note"]);
      if (!c["mc-copy-url-btn"]) bad("MC-05 弹窗内没有复制配对链接按钮（#mc-copy-url-btn 不存在）");
      else if (c["mc-copy-url-btn"].disabled) bad("MC-05 已放开局域网后复制按钮仍不可点", JSON.stringify(c["mc-copy-url-btn"]));
      else {
        await win.click("#mc-copy-url-btn");
        await win.waitForTimeout(600);
        const n = await readIds(win, ["mc-pair-note"]);
        if (!n["mc-pair-note"]) bad("MC-05 没有回显位（#mc-pair-note 不存在）");
        else if (!n["mc-pair-note"].shown || !/已复制/.test(n["mc-pair-note"].text))
          bad("MC-05 点了复制却没回显「已复制」（用户不知道到底进去没有）", JSON.stringify(n["mc-pair-note"]));
        else ok("MC-05 复制配对链接当场回显：「" + n["mc-pair-note"].text.slice(0, 30) + "」");
      }
    }

    /* ---------- MC-08 弹窗内不得出现令牌原文 ---------- */
    {
      const m = await modalState(win);
      const tok = await win.evaluate(() => window.bitbot.pairing.token());
      if (!m.exists) bad("MC-08 弹窗不存在，令牌原文校验无从落手");
      else if (!tok || !tok.ok || !tok.token) bad("MC-08 拿不到令牌做对照（这条断言不能空过）", JSON.stringify(tok && tok.error));
      else if (m.text.indexOf(tok.token) >= 0) bad("MC-08 弹窗里摊着令牌原文", m.text.slice(Math.max(0, m.text.indexOf(tok.token) - 40), 200));
      else if (/(^|\s)[A-Za-z0-9]{40,}(\s|$)/.test(m.text)) bad("MC-08 弹窗里出现 40 位以上连续串（形似凭证的原文）", RegExp.lastMatch.slice(0, 60));
      else ok("MC-08 弹窗内读不到令牌原文（" + tok.token.length + " 位令牌不在这一屏，掩码也不摊）");
    }

    /* ---------- MC-13 设备花名册（A2-5）：登记的设备列得出、能吊销 ---------- */
    {
      const roster = await win.evaluate(() => window.bitbot.devices.list());
      if (!roster || !roster.ok) bad("MC-13 花名册接口不可用（window.bitbot.devices.list 失败）", JSON.stringify(roster));
      else {
        const list = Array.isArray(roster.devices) ? roster.devices : [];
        if (list.length < 1) bad("MC-13 已登记的设备未出现在花名册（种子 2 台，应 ≥1）", "len=" + list.length);
        else {
          const card = await readIds(win, ["mc-roster-card", "mc-roster-list", "mc-roster-title"]);
          if (!card["mc-roster-card"] || !card["mc-roster-card"].shown) bad("MC-13 花名册卡不可见（#mc-roster-card）", JSON.stringify(card["mc-roster-card"]));
          else if (!card["mc-roster-list"]) bad("MC-13 花名册列表容器不存在（#mc-roster-list）", JSON.stringify(card["mc-roster-list"]));
          else {
            const rows = await win.evaluate(() =>
              Array.from(document.querySelectorAll("#mc-roster-list .mc-roster-row")).map((li) => ({
                id: li.dataset.deviceId,
                name: (li.querySelector(".mc-roster-name") || {}).textContent,
                kind: (li.querySelector(".mc-roster-kind") || {}).textContent,
                hasRevoke: Boolean(li.querySelector(".mc-roster-revoke")),
              })),
            );
            if (rows.length !== list.length) bad("MC-13 UI 行数 ≠ 接口设备数", "ui=" + rows.length + " api=" + list.length);
            else if (!rows.every((r) => r.name && r.kind && r.hasRevoke)) bad("MC-13 每行缺 名称/机器类/吊销键", JSON.stringify(rows));
            else {
              const firstId = rows[0].id;
              await win.click(`#mc-roster-list .mc-roster-row[data-device-id="${firstId}"] .mc-roster-revoke`);
              await win.waitForTimeout(400);
              const after = await win.evaluate(() => window.bitbot.devices.list());
              const revoked = (after.devices || []).find((d) => d.id === firstId);
              const rowState = await win.evaluate((id) => {
                const li = document.querySelector(`#mc-roster-list .mc-roster-row[data-device-id="${id}"]`);
                if (!li) return null;
                return {
                  revokedClass: li.classList.contains("is-revoked"),
                  btnDisabled: Boolean(li.querySelector(".mc-roster-revoke") && li.querySelector(".mc-roster-revoke").disabled),
                  badge: Boolean(li.querySelector(".mc-roster-badge.revoked")),
                };
              }, firstId);
              if (!revoked || !revoked.revoked) bad("MC-13 吊销后接口未反映（dev 仍非 revoked）", JSON.stringify(revoked));
              else if (!rowState || !rowState.revokedClass || !rowState.btnDisabled || !rowState.badge)
                bad("MC-13 吊销后 UI 未反映（缺 is-revoked / 键禁用 / 徽标）", JSON.stringify(rowState));
              else ok("MC-13 花名册列出 " + rows.length + " 台、每行含名称/机器类/吊销键；吊销首台后接口与 UI 同步（徽标+禁用）");
            }
          }
        }
      }
    }

    /* ---------- MC-07 渠道不在这张弹窗里：渠道属于「机器人管理」----------
     * 这一条以前判的是「弹窗里要列三条真渠道」。IA 改过之后判据反过来了：
     * 渠道挂在配对弹窗里会让人以为钉钉是「连手机的另一种方式」。
     * 所以现在钉的是**边界**：配对弹窗里零渠道卡片 + 有一个去机器人管理的入口；
     * 点进去之后四条渠道（含微信）在那边，并且微信不给假二维码。 */
    {
      const inside = await win.evaluate(() => {
        const m = document.getElementById("mobile-control-modal");
        if (!m) return null;
        return {
          channelRows: m.querySelectorAll("[id^='mc-ch-']").length,
          oldCard: Boolean(m.querySelector("#mc-channel-card")),
          managerEntry: (() => {
            const b = m.querySelector("#mc-open-manager");
            if (!b) return null;
            const s = getComputedStyle(b);
            return { text: String(b.textContent || "").trim(), shown: s.display !== "none" };
          })(),
          bodyText: String(m.textContent || ""),
        };
      });
      if (!inside) bad("MC-07 配对弹窗不存在，边界无从判");
      else if (inside.channelRows || inside.oldCard)
        bad("MC-07 渠道卡片又回到了手机配对弹窗", JSON.stringify({ rows: inside.channelRows, old: inside.oldCard }));
      else if (/使用 Bot Channel/.test(inside.bodyText))
        bad("MC-07 弹窗里还留着 Bot Channel 那一栏的文案");
      else if (!inside.managerEntry || !inside.managerEntry.shown)
        bad("MC-07 没有去机器人管理的入口（渠道搬走了却没留门）", JSON.stringify(inside.managerEntry));
      else {
        await win.click("#mc-open-manager");
        await win.waitForTimeout(600);
        const bm = await win.evaluate(() => {
          const el = document.getElementById("bot-manager-modal");
          const vis = (n) => {
            if (!n) return false;
            const s = getComputedStyle(n);
            return s.display !== "none" && s.visibility !== "hidden";
          };
          const items = el ? Array.from(el.querySelectorAll(".bm-item")) : [];
          const typing = el
            ? Array.from(el.querySelectorAll("input, textarea, select")).filter((n) => {
                const t = String(n.getAttribute("type") || "").toLowerCase();
                return t !== "checkbox" && t !== "radio" && t !== "hidden";
              }).length
            : -1;
          return {
            shown: vis(el),
            count: items.length,
            names: items.map((i) => String(i.textContent || "").replace(/\s+/g, " ").trim()),
            mcStill: vis(document.getElementById("mobile-control-modal")),
            typing,
            wechatQrBtn: (() => {
              /* 选中微信后「生成二维码」应当是隐藏的 —— 它没有可扫的东西。
                 名字要**精确**匹配：/微信/ 会先命中「企业微信」。 */
              const wx = items.filter((i) => {
                const n = i.querySelector("b");
                return n && n.textContent.trim() === "微信";
              })[0];
              if (!wx) return { found: false };
              wx.click();
              const btn = document.getElementById("bm-begin");
              const qr = document.getElementById("bm-qr");
              return {
                found: true,
                beginHidden: btn ? btn.hidden : null,
                qrHidden: qr ? qr.hidden : null,
              };
            })(),
          };
        });
        const wantNames = ["钉钉", "飞书", "企业微信", "微信"];
        const nameOk = wantNames.every((w) => bm.names.some((n) => n.indexOf(w) >= 0));
        if (!bm.shown) bad("MC-07 「机器人管理」没打开", JSON.stringify(bm));
        else if (bm.mcStill) bad("MC-07 两层弹窗叠着（用户不知道该关哪个）", JSON.stringify(bm));
        else if (bm.count !== 4 || !nameOk)
          bad("MC-07 机器人管理里的渠道不是四条（钉钉/飞书/企微/微信）", JSON.stringify(bm.names));
        else if (bm.typing !== 0)
          bad("MC-07 机器人管理主区出现了 " + bm.typing + " 个打字控件（这一屏应当零输入）");
        else if (!bm.wechatQrBtn.found || bm.wechatQrBtn.beginHidden !== true || bm.wechatQrBtn.qrHidden !== true)
          bad("MC-07 微信这一条给出了二维码（它没有官方机器人接口，扫了没用）", JSON.stringify(bm.wechatQrBtn));
        else
          ok("MC-07 配对弹窗零渠道卡片、留了去机器人管理的门；那边四条渠道齐全，微信不给假码，主区零输入框");
        await win.keyboard.press("Escape");
        await win.waitForTimeout(400);
      }
    }

    /* ---------- MC-06 Esc / 遮罩都能关，焦点归还账户按钮 ---------- */
    {
      /* 万一上面某条红在这里留了张开着的卡，先收干净再测：否则「点不到入口」
         会被误读成弹窗坏了。 */
      await win.keyboard.press("Escape").catch(() => {});
      await win.waitForTimeout(300);
      await win.focus("#account-avatar-btn").catch(() => {});
      const reopened = await tryOpenModal(win);
      if (!reopened.ok) bad("MC-06 弹窗打不开，Esc/遮罩无从测起", reopened.err);
      else {
        await win.keyboard.press("Escape");
        await win.waitForTimeout(350);
        const afterEsc = await win.evaluate(() => ({
          shown: (() => {
            const m = document.getElementById("mobile-control-modal");
            if (!m) return true;
            const s = getComputedStyle(m);
            return s.display !== "none";
          })(),
          active: document.activeElement ? document.activeElement.id || document.activeElement.tagName : "",
          stack: (window.__bbSheetStack || []).map((x) => x.id).join(","),
        }));
        if (afterEsc.shown) bad("MC-06 按 Esc 弹窗没关", JSON.stringify(afterEsc));
        else if (afterEsc.active !== "account-avatar-btn")
          bad("MC-06 关掉弹窗后焦点没归还账户按钮（键盘用户被丢回页面顶）", JSON.stringify(afterEsc));
        else if (/mobile-control-modal/.test(afterEsc.stack)) bad("MC-06 关闭后 sheet 栈没出栈（下一次 Esc 会关掉别的东西）", afterEsc.stack);
        else {
          await win.focus("#account-avatar-btn").catch(() => {});
          const again = await tryOpenModal(win);
          if (!again.ok) bad("MC-06 Esc 能关但再开不回来（弹窗状态机漏了一只）", again.err);
          else {
            const box = await win.evaluate(() => {
              const m = document.getElementById("mobile-control-modal");
              const b = m.getBoundingClientRect();
              return { x: b.x, y: b.y, w: b.width, h: b.height };
            });
            await win.mouse.click(box.x + 4, box.y + 4);
            await win.waitForTimeout(350);
            const afterMask = await win.evaluate(() => {
              const m = document.getElementById("mobile-control-modal");
              const s = getComputedStyle(m);
              return {
                shown: s.display !== "none",
                active: document.activeElement ? document.activeElement.id : "",
                stack: (window.__bbSheetStack || []).map((x) => x.id).join(","),
              };
            });
            if (afterMask.shown) bad("MC-06 点遮罩没关掉弹窗（遮罩只是装饰）", JSON.stringify(afterMask));
            else if (/mobile-control-modal/.test(afterMask.stack)) bad("MC-06 遮罩关了弹窗但没出栈", afterMask.stack);
            else ok("MC-06 Esc 与遮罩都能关，焦点归还 #account-avatar-btn，sheet 栈同步出栈");
          }
        }
      }
    }

    /* ---------- MC-10 旧卡不再假装主路：有一句指向新弹窗 ---------- */
    {
      await win.click("#account-avatar-btn");
      await win.waitForSelector("#ap-settings", { state: "visible", timeout: 8000 });
      await win.click("#ap-settings");
      await win.waitForSelector("#settings-panel", { state: "visible", timeout: 10000 });
      await win.click('.settings-tab-btn[data-stab="credentials"]');
      await win.waitForTimeout(500);
      const h = await readIds(win, ["sec-pairing-modal-hint", "pairing-gen-btn"]);
      if (!h["sec-pairing-modal-hint"]) bad("MC-10 旧卡里没有指向新弹窗的说明（#sec-pairing-modal-hint 不存在）");
      else if (!h["sec-pairing-modal-hint"].shown || !/移动端远程控制/.test(h["sec-pairing-modal-hint"].text))
        bad("MC-10 说明没写清主路去哪", JSON.stringify(h["sec-pairing-modal-hint"]));
      else if (!h["pairing-gen-btn"] || !h["pairing-gen-btn"].shown)
        bad("MC-10 旧卡的一键配对被藏了（这是别处依赖的兜底路，只能加不能删）", JSON.stringify(h["pairing-gen-btn"]));
      else ok("MC-10 旧卡保留手动兜底，并写明主路在「移动端远程控制」");

      /* ---------- MC-12 旧深链 anchor=pairing：落到弹窗，且不留隐形栈条目 ---------- */
      /* 内核与 CLI 都还会发 anchor=pairing（"设置 → 手机" 那个页签已经不存在）。
         这里直接喂 renderSettingsPanel —— 内核 settings_open 的 host_result 走的
         就是这一个入口，所以不是绕开产品代码。
         现场正好是「设置页开着」的状态（上一条 MC-10 刚打开它），先测这条最容易
         出错的路径：只藏 DOM 不出栈，用户按第一次 Esc 关掉的是隐形面板，
         弹窗纹丝不动。 */
      {
        const deep = (withTrigger) =>
          win.evaluate((w) => {
            if (w) {
              window.__bbPendingSettingsTrigger = document.getElementById("account-avatar-btn");
            }
            renderSettingsPanel({ entry: "cli", anchor: "pairing" });
            const panel = document.getElementById("settings-panel");
            const m = document.getElementById("mobile-control-modal");
            return {
              settingsShown: panel ? getComputedStyle(panel).display !== "none" : false,
              modalShown: m ? getComputedStyle(m).display !== "none" : false,
              stack: (window.__bbSheetStack || []).map((x) => x.id),
            };
          }, withTrigger);
        const stackHas = (s, id) => s.stack.indexOf(id) >= 0;

        const a = await deep(true);
        await win.waitForTimeout(300);
        if (!a.modalShown) bad("MC-12 anchor=pairing 没落到「移动端远程控制」弹窗（点了等于什么都没开）", JSON.stringify(a));
        else if (a.settingsShown) bad("MC-12 深链之后设置页还开着（两层弹窗叠在一起）", JSON.stringify(a));
        else if (stackHas(a, "settings-panel")) bad("MC-12 设置页已藏但还留在 sheet 栈里（第一次 Esc 关的是隐形面板）", JSON.stringify(a.stack));
        else if (a.stack[a.stack.length - 1] !== "mobile-control-modal") bad("MC-12 栈顶不是弹窗（Esc 会关错东西）", JSON.stringify(a.stack));
        else ok("MC-12 设置页开着时来一条 anchor=pairing：设置收起、弹窗接管、栈里只剩弹窗（无隐形条目）");

        await win.keyboard.press("Escape");
        await win.waitForTimeout(400);
        const afterEsc = await win.evaluate(() => {
          const m = document.getElementById("mobile-control-modal");
          return {
            modalShown: m ? getComputedStyle(m).display !== "none" : false,
            stack: (window.__bbSheetStack || []).map((x) => x.id).join(","),
            active: document.activeElement ? document.activeElement.id : "",
          };
        });
        if (afterEsc.modalShown) bad("MC-12 深链打开后第一次 Esc 没关掉弹窗（栈里还有别的东西）", JSON.stringify(afterEsc));
        else ok("MC-12 深链打开的弹窗，第一次 Esc 就关得掉（焦点回 " + (afterEsc.active || "body") + "）");

        /* 冷路径：设置页没开时来同一条深链，落点也必须成立。 */
        const b = await deep(false);
        if (!b.modalShown || b.settingsShown) bad("MC-12 设置页没开时 anchor=pairing 落点不对", JSON.stringify(b));
        else if (b.stack.filter((x) => x === "settings-panel").length) bad("MC-12 冷路径也往栈里塞了 settings-panel", JSON.stringify(b.stack));
        else ok("MC-12 冷路径（设置页没开）anchor=pairing 同样只开弹窗、不塞设置栈条目");
        await win.evaluate(() => closeMobileControl());
      }

      await win.evaluate(() => closeSettingsPanel());
    }
    await shutdown(app);
    app = null;

    /* ================= 第二档：480×720（产品 minWidth）================= */
    const second = await openWindow(480, 720);
    app2 = second.app;
    const win2 = second.win;

    {
      /* 侧栏「按宽度自适应收起」早就删了（改回手动控制，见 index.html
         `setSidebarHidden` 上方的注释），所以 480 宽下侧栏默认就是展开的。
         这里原来无脑按 Ctrl+B「展开侧栏」—— 在今天的代码里那一下反而是**收起**，
         #account-avatar-btn 变成 0×0，点不到、10s 超时，红的是门禁自己过期的
         假设，不是产品。只在真的收起时才展开，其余情况尊重现场。 */
      const collapsed = await win2.evaluate(() => document.body.dataset.sidebar === "collapsed");
      if (collapsed) {
        await win2.click("#sidebar-reopen-tab", { timeout: 5000 }).catch(() => {});
        await win2.waitForTimeout(400);
      }

      /* ---------- MC-11 窄屏下账户菜单本身点得到 ---------- */
      {
        await win2.click("#account-avatar-btn", { timeout: 10000 });
        await win2.waitForTimeout(350);
        const reach = await win2.evaluate(() => {
          /* 行不写死：弹层里「有几个 .ap-item」就是几行，加行/删行都要被这条覆盖到。
             （ap-mobile 这一轮并进了「移动端远程控制」，写死的清单会漏掉这类变化。） */
          const pop = document.getElementById("account-popup");
          const items = pop ? Array.from(pop.querySelectorAll(".ap-item")) : [];
          const out = { innerH: window.innerHeight, innerW: window.innerWidth, rows: [], hasMobileRow: false, hasRemote: false };
          for (const el of items) {
            if (el.id === "ap-mobile") out.hasMobileRow = true;
            if (el.id === "ap-remote") out.hasRemote = true;
            const b = el.getBoundingClientRect();
            const hit = b.width > 0 ? document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) : null;
            out.rows.push({
              id: el.id,
              y: Math.round(b.y),
              bottom: Math.round(b.bottom),
              inView: b.y >= 0 && b.bottom <= window.innerHeight && b.right <= window.innerWidth,
              hit: hit ? hit.id || (typeof hit.className === "string" ? hit.className : "?") : null,
              self: hit ? hit === el || el.contains(hit) : false,
            });
          }
          return out;
        });
        const off = reach.rows.filter((r) => !r.inView).map((r) => r.id + "@y" + r.y);
        const blocked = reach.rows.filter((r) => r.inView && !r.self).map((r) => r.id + "→" + r.hit);
        if (reach.rows.length < 7) bad("MC-11 窄屏弹层里的行数不对（漏行 = 用户少一个入口）", "rows=" + reach.rows.length + " " + reach.rows.map((r) => r.id).join(","));
        else if (reach.hasMobileRow) bad("MC-11 「获取移动版」还单列在弹层里（和「移动端远程控制」抢同一件事）");
        else if (!reach.hasRemote) bad("MC-11 「移动端远程控制」不见了（手机这件事的唯一入口被删了）");
        else if (off.length) bad("MC-11 480 宽下账户菜单项开到视口外（看得见按钮、点不到任何一项）", off.join(" "));
        else if (blocked.length) bad("MC-11 账户菜单项被别的东西挡住", blocked.join(" "));
        else ok("MC-11 480×" + reach.innerH + "：账户菜单 " + reach.rows.length + " 行全在视口内且各自命中自己（弹层没开到屏外），手机只留「移动端远程控制」一行");
      }

      /* ---------- MC-09 弹窗几何 ---------- */
      const opened = { ok: false, err: "" };
      {
        await win2.click("#ap-remote", { timeout: 10000 }).then(() => { opened.ok = true; }).catch((e) => { opened.err = String(e.message).split("\n")[0]; });
        await win2.waitForTimeout(350);
      }
      const m = await modalState(win2);
      const geo = await win2.evaluate(() => {
        const de = document.documentElement;
        const m2 = document.getElementById("mobile-control-modal");
        const cs = m2 ? getComputedStyle(m2) : null;
        const read = (id) => {
          const el = document.getElementById(id);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inView: r.y >= 0 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1 };
        };
        return {
          innerW: window.innerWidth,
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          pad: cs ? cs.padding : "",
          sheet: (() => {
            const s = m2 ? m2.querySelector(".bb-sheet") : null;
            if (!s) return null;
            const r = s.getBoundingClientRect();
            return { w: Math.round(r.width), x: Math.round(r.x), right: Math.round(r.right) };
          })(),
          /* 右栏现在是「已登记的设备」（渠道已移去机器人管理），量它而不是旧的渠道卡 */
          cards: [read("mc-pair-card"), read("mc-roster-card")],
          close: read("mc-close"),
          gen: read("mc-gen-btn"),
        };
      });
      if (!opened.ok || !m.exists || !m.shown) bad("MC-09 弹窗不存在或打不开（480 宽下没有任何可量的 sheet）", opened.err + " " + JSON.stringify({ exists: m.exists, shown: m.shown }));
      else if (geo.scrollW > geo.clientW) bad("MC-09 弹窗打开时页面出现横向滚动", JSON.stringify({ scrollW: geo.scrollW, clientW: geo.clientW }));
      else if (!geo.sheet || geo.sheet.w > geo.innerW) bad("MC-09 sheet 宽超出视口", JSON.stringify(geo.sheet || {}) + " innerW=" + geo.innerW);
      else if (!geo.cards[0] || !geo.cards[1]) bad("MC-09 窄屏找不到两张卡", JSON.stringify(geo.cards));
      else if (Math.abs(geo.cards[0].x - geo.cards[1].x) > 2)
        bad("MC-09 窄屏没降成单列（两卡左右并排 = 480 宽里挤两张）", JSON.stringify({ pair: geo.cards[0].x, roster: geo.cards[1].x }));
      else if (!(geo.cards[1].y > geo.cards[0].y)) bad("MC-09 单列顺序不对（设备卡跑到扫码卡上面）", JSON.stringify(geo.cards));
      else if (!geo.close || !geo.close.inView || geo.close.h <= 0) bad("MC-09 关闭键在窄屏点不到", JSON.stringify(geo.close));
      else if (!geo.gen || !geo.gen.inView || geo.gen.h <= 0) bad("MC-09 生成配对码键在窄屏点不到", JSON.stringify(geo.gen));
      else ok("MC-09 480×720：sheet " + geo.sheet.w + "px ≤ 视口 " + geo.innerW + "px、无横向滚动、两卡竖排，关闭/生成都在视口内");
    }

    done("e2e_desktop_mobile_control");
  } catch (err) {
    bad("unexpected error", (err && err.message) || String(err));
    done("e2e_desktop_mobile_control");
  } finally {
    await shutdown(app).catch(() => {});
    await shutdown(app2).catch(() => {});
    await sleep(600);
    for (const dir of [electronUserDataDir("mobctl-1"), electronUserDataDir("mobctl-2"), UD]) {
      const left = countAppMains(dir);
      if (left > 0) killGateProcs(dir);
    }
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* 临时目录清理失败不影响结论 */
    }
  }
})();
