/* e2e_desktop_unread_summary.mjs — P1-6 未读汇总 + P2-7 未读落盘 的回归门禁
 *
 * 前半段断汇总条这一条链路，后半段断「重启还在」：
 *   U-01 没有未读 → #unread-summary 隐藏（不占位、不空转）
 *   U-02 打开会话弹层 → 两个种子会话都在列表里
 *   U-03 注入未读（今天 2 条 + 更早 1 条）→ 汇总条可见，文案带总数 3
 *   U-04 点汇总条 → 跳到「最早未读」（更早分组那条），该会话未读清零，
 *        汇总条降为 2，弹层自动收起（和点行同一行为）
 *   U-05 全部读完 → 汇总条重新隐藏
 *   U-06 未读落 settings.unread → 关掉重开仍在（P2-7）
 *   U-07 清空后落盘不留幽灵行 → 重开是干净的（P2-7）
 *
 * 未读表的注入走 window.__bbUnread（测试钩子，和生产同一份数据 + 同一个
 * renderUnreadMarks / persistUnread），因此断的是真实渲染 + 真实落盘路径。
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
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 240) : ""));
};
const done = (name) => {
  console.log(name + ": PASS=" + PASS + " FAIL=" + FAIL + " SKIP=" + SKIP);
  process.exit(FAIL ? 1 : 0);
};

const NAME = "e2e_desktop_unread_summary";
if (!fs.existsSync(ELECTRON)) {
  console.log(NAME + ": SKIP — electron dist missing (" + ELECTRON + ")");
  console.log(NAME + ": PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}
if (!hasDisplay()) {
  console.log(NAME + ": SKIP — no DISPLAY and no xvfb-run");
  console.log(NAME + ": PASS=0 FAIL=0 SKIP=1");
  process.exit(0);
}

const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const DAY = 86400000;

/* 两个会话：一条在「今天」，一条在「更早」。
   列表按 今天 → 昨天 → 更早 排，所以「最早未读」必须落到更早那条。 */
const root = isolatedRepoRoot(REPO, "unread", {
  "bots.json": {
    bots: [
      {
        id: "b1",
        name: "派单助手",
        job: "派单调度",
        description: "",
        group: "",
        pinned: false,
        created_at: iso(0),
        updated_at: iso(0),
      },
    ],
    primary: "b1",
  },
  "settings.json": { notify: {} },
  "sessions.json": {
    sessions: [
      { id: "sess-today", title: "今天的会话", created_at: iso(0), updated_at: iso(0), messages: [] },
      { id: "sess-old", title: "更早的会话", created_at: iso(30 * DAY), updated_at: iso(30 * DAY), messages: [] },
    ],
  },
});
const UD = electronUserDataDir("unread");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch() {
  return _electron.launch({
    executablePath: ELECTRON,
    args: [
      path.join(DESKTOP, "main.js"),
      "--no-sandbox",
      "--disable-gpu",
      "--user-data-dir=" + UD,
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

const summary = (win) =>
  win.evaluate(() => {
    const el = document.getElementById("unread-summary");
    if (!el) return null;
    return {
      exists: true,
      hidden: el.hidden,
      display: getComputedStyle(el).display,
      text: (el.textContent || "").trim(),
      hasDot: !!el.querySelector(".unread-dot"),
    };
  });

const activeId = async (win) => {
  const list = await win.evaluate(() => window.bitbot.sessions.list());
  return list && list.active_id;
};

/* 读 settings.unread（getSettings 会包一层，两种形状都认） */
const storedUnread = (win) =>
  win.evaluate(async () => {
    const res = await window.bitbot.settings.get();
    const st = (res && res.settings && res.settings.settings) || (res && res.settings) || {};
    return (st && st.unread) || {};
  });

let app = null;
const open = async () => {
  app = await launch();
  const win = await app.firstWindow();
  await win.waitForSelector("#composer #text", { timeout: 30000 });
  await win.waitForTimeout(700);
  return win;
};
const close = async () => {
  if (!app) return;
  try {
    await app.close();
  } catch (_) {
    /* ignore */
  }
  app = null;
  await sleep(400);
};

(async () => {
  try {
    let win = await open();

    /* ---------- U-01 没有未读 → 汇总条隐藏 ---------- */
    const s1 = await summary(win);
    if (!s1 || !s1.exists) bad("U-01 #unread-summary 节点不存在", JSON.stringify(s1));
    else if (s1.hidden && s1.display === "none") ok("U-01 无未读时汇总条隐藏（零未读不占位）");
    else bad("U-01 无未读时汇总条不该可见", JSON.stringify(s1));

    /* ---------- U-02 打开弹层 → 两个会话都在 ---------- */
    await win.click("#ab-sessions-btn");
    await win.waitForTimeout(500);
    const rows = await win.evaluate(() =>
      Array.from(document.querySelectorAll("#session-list .agent-item")).map((el) => el.dataset.sessionId),
    );
    rows.includes("sess-today") && rows.includes("sess-old")
      ? ok("U-02 会话弹层渲染出两个种子会话（" + rows.join(",") + "）")
      : bad("U-02 会话行缺失", JSON.stringify(rows));

    /* ---------- U-03 注入未读 → 汇总条显示总数 ---------- */
    const injected = await win.evaluate(() => {
      const st = window.__bbUnread.state();
      st["sess-today"] = 2;
      st["sess-old"] = 1;
      window.__bbUnread.render();
      return Object.assign({}, st);
    });
    await win.waitForTimeout(200);
    const s3 = await summary(win);
    const total3 = (injected["sess-today"] || 0) + (injected["sess-old"] || 0);
    if (s3.hidden) bad("U-03 有未读时汇总条仍然隐藏");
    else if (!/(^|\D)3(\D|$)/.test(s3.text)) bad("U-03 汇总条文案没带总数 3", s3.text);
    else if (!s3.hasDot) bad("U-03 汇总条缺少未读点", JSON.stringify(s3));
    else ok("U-03 汇总条可见且文案带总数 " + total3 + "（" + s3.text + "）");

    /* ---------- U-04 点汇总条 → 跳到最早未读 ---------- */
    await win.click("#unread-summary");
    await win.waitForTimeout(1200);
    const act4 = await activeId(win);
    const s4 = await summary(win);
    const left4 = await win.evaluate(() => Object.assign({}, window.__bbUnread.state()));
    const popHidden = await win.evaluate(() => {
      const el = document.getElementById("sessions-popup");
      return el ? el.hidden : null;
    });
    if (act4 !== "sess-old") bad("U-04 没跳到最早未读（active=" + act4 + "，期望 sess-old）");
    else if ("sess-old" in left4) bad("U-04 跳转后该会话未读没清零", JSON.stringify(left4));
    else if (s4.hidden) bad("U-04 还剩 2 条未读，汇总条不该消失", JSON.stringify(s4));
    else if (!/(^|\D)2(\D|$)/.test(s4.text)) bad("U-04 汇总条总数没降到 2", s4.text);
    else if (popHidden !== true) bad("U-04 跳转后弹层没收起", String(popHidden));
    else ok("U-04 点汇总条跳到最早未读，未读降为 2，弹层收起");

    /* ---------- U-05 点会话行本身也要清未读（不能再靠重画糊掉） ---------- */
    await win.click("#ab-sessions-btn");
    await win.waitForTimeout(400);
    await win.click('#session-list .agent-item[data-session-id="sess-today"]');
    await win.waitForTimeout(900);
    const afterRow = await win.evaluate(() => Object.assign({}, window.__bbUnread.state()));
    const s5 = await summary(win);
    Object.keys(afterRow).length === 0
      ? ok("U-05 点会话行后未读表清空（行点击走同一条 activateSessionById）")
      : bad("U-05 点会话行没有清未读", JSON.stringify(afterRow));
    s5.hidden && s5.display === "none"
      ? ok("U-05 全部已读后汇总条重新隐藏")
      : bad("U-05 全部已读后汇总条仍可见", JSON.stringify(s5));

    /* ---------- U-06 未读落盘 → 重开还在（P2-7） ---------- */
    await win.evaluate(() => {
      const st = window.__bbUnread.state();
      st["sess-today"] = 3;
      window.__bbUnread.commit();
    });
    let disk = {};
    for (let i = 0; i < 20; i++) {
      disk = await storedUnread(win);
      if (disk["sess-today"] === 3) break;
      await sleep(150);
    }
    disk["sess-today"] === 3
      ? ok("U-06 settings.unread 已写入（{sess-today:3}）")
      : bad("U-06 settings.unread 没落盘", JSON.stringify(disk));

    await close();
    win = await open();
    const s6 = await summary(win);
    const rowDot6 = await win.evaluate(() => {
      const el = document.querySelector('#session-list .agent-item[data-session-id="sess-today"]');
      return el ? !!el.querySelector(".unread-dot") : null;
    });
    if (s6.hidden) bad("U-06 重开后汇总条没回填");
    else if (!/(^|\D)3(\D|$)/.test(s6.text)) bad("U-06 重开后总数不对", s6.text);
    else if (rowDot6 !== true) bad("U-06 重开后行内未读点没回填", String(rowDot6));
    else ok("U-06 重开后未读回填（汇总条 3 + 行点）——P2-7 生效");

    /* ---------- U-07 清空后不留幽灵行（P2-7） ---------- */
    await win.evaluate(() => {
      const st = window.__bbUnread.state();
      for (const k of Object.keys(st)) delete st[k];
      window.__bbUnread.commit();
    });
    for (let i = 0; i < 20; i++) {
      disk = await storedUnread(win);
      if (Object.keys(disk).length === 0) break;
      await sleep(150);
    }
    Object.keys(disk).length === 0
      ? ok("U-07 清空后 settings.unread = {}（不落 sid:0 幽灵行）")
      : bad("U-07 清空后仍残留未读键", JSON.stringify(disk));

    await close();
    win = await open();
    const s7 = await summary(win);
    s7.hidden && s7.display === "none"
      ? ok("U-07 重开后是干净的（无未读、无汇总条）")
      : bad("U-07 重开后仍有未读", JSON.stringify(s7));
  } catch (e) {
    bad("执行异常", (e && e.message) || e);
  } finally {
    await close();
    done(NAME);
  }
})();
