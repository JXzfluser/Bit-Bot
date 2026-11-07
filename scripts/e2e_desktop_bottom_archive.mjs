/* e2e_desktop_bottom_archive.mjs — M52 两项能力的真渲染验证
 *
 * 覆盖：
 *   1) 回到底部：长对话在底部时藏；往上翻 → 出现；点一下 → 真回到最底并且自己藏；
 *      新建的空对话（滚不动）→ 不出现（判据是离底距离，不是 scrollTop === 0）。
 *   2) 定时任务归档：预置一条已归档 + 一条在跑的任务 → 群资料里常用列表只有 1 条、
 *      归档区折叠成「已归档 · 1」→ 点「取消归档」→ 回到常用列表且 store 里
 *      archived_at 真被摘掉（不是只改界面）。
 *
 * 纪律：独立 dataRoot（tmp）+ 独立 user-data-dir，跑完关进程，不碰仓库 data/。
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { resolveElectronBinary } from "./electron_bin.mjs";
import { electronLaunchEnv, electronUserDataDir, gateAppEnv } from "./electron_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DESKTOP = path.join(REPO, "hosts/desktop");
const ELECTRON = resolveElectronBinary(DESKTOP);
const require = createRequire(path.join(DESKTOP, "package.json"));
const { _electron } = require("playwright-core");

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

/* ---- 预置：长会话 + 一个群 + 两条定时任务（一条已归档） ---- */
const DATA = path.join(os.tmpdir(), "bitbot-e2e-bottom-archive");
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(path.join(DATA, "desktop"), { recursive: true });
fs.mkdirSync(path.join(DATA, "routines"), { recursive: true });

const now = new Date();
const sid = "sess-ba0001";
const ROOM = "room-ba0001";
const longMsgs = [];
for (let i = 0; i < 18; i++) {
  longMsgs.push({
    id: "msg-u" + i,
    role: "user",
    text: "第 " + (i + 1) + " 个问题：把这一周的派单情况按区域拆开讲一下，重点是超时单。",
    at: new Date(now.getTime() - (36 - i * 2) * 60000).toISOString(),
  });
  longMsgs.push({
    id: "msg-a" + i,
    role: "assistant",
    text: "第 " + (i + 1) + " 天：派单 1,2" + (i % 10) + " 单，超时 3 单（占 0.2%）。\n\n"
      + "北区仍然是超时最集中的地方，原因有两条：一是骑手在午饭档同时压了三单；"
      + "二是地址校验把「XX 大厦 A 座」判成了另一个园区。建议先把地址库补一遍。",
    at: new Date(now.getTime() - (36 - i * 2) * 60000 + 30000).toISOString(),
  });
}
fs.writeFileSync(path.join(DATA, "desktop", "sessions.json"), JSON.stringify({
  version: 1,
  active_id: sid,
  sessions: [{
    id: sid,
    title: "回到底部验证",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    messages: longMsgs,
  }],
}, null, 2));

fs.writeFileSync(path.join(DATA, "desktop", "rooms.json"), JSON.stringify({
  version: 1,
  rooms: [{
    id: ROOM,
    title: "归档验证群",
    members: [],
    created_at: now.toISOString(),
    transcript: [],
  }],
}, null, 2));

const ROUTES = path.join(DATA, "routines", "host-routines.json");
const liveRow = {
  id: "ba-live",
  cron: "0 9 * * *",
  prompt: "每天早上9点把审核通过的稿子发到 news@example.com",
  enabled: true,
  lifecycle: "active",
  room_id: ROOM,
  next_due: new Date(Date.now() + 3600 * 1000).toISOString(),
  updated_at: now.toISOString(),
};
const archRow = {
  id: "ba-arch",
  cron: "0 18 * * *",
  prompt: "每天18点汇总当日超时单",
  enabled: false,
  lifecycle: "paused",
  room_id: ROOM,
  next_due: new Date(Date.now() + 7200 * 1000).toISOString(),
  updated_at: now.toISOString(),
  archived_at: now.toISOString(),
};
fs.writeFileSync(ROUTES, JSON.stringify([liveRow, archRow], null, 2));

const ud = electronUserDataDir("bb-bottom-archive");
const env = electronLaunchEnv(
  gateAppEnv(REPO, {
    BITBOT_DATA_ROOT: DATA,
    BITBOT_NO_SECRET_SYNC: "1",
    BITBOT_DESKTOP_AUTOSTART: "0",
  }),
);

const gapOf = () => {
  const log = document.getElementById("log");
  return log.scrollHeight - log.scrollTop - log.clientHeight;
};

(async () => {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [path.join(DESKTOP, "main.js"), "--no-sandbox", "--disable-gpu", "--user-data-dir=" + ud],
    cwd: REPO,
    env,
    timeout: 60000,
  });
  const win = await app.firstWindow({ timeout: 60000 });
  try {
    await win.waitForSelector("#composer #text", { timeout: 30000 });
    await win.evaluate(() => {
      document.body.classList.remove("force-dark");
      document.body.classList.add("force-light");
    });

    // ---------- 1) 回到底部 ----------
    await win.waitForFunction(() => document.querySelectorAll("#log .msg").length >= 30, null, { timeout: 20000 }).catch(() => {});
    await win.waitForTimeout(400);
    const atBottom = await win.evaluate(new Function("return (" + gapOf.toString() + ")()"));
    const hiddenAtBottom = await win.evaluate(() => {
      const b = document.getElementById("to-bottom");
      return !b || b.hidden;
    });
    atBottom < 240 && hiddenAtBottom
      ? ok("在底部时不出现（离底 " + Math.round(atBottom) + "px）")
      : bad("bottom state", JSON.stringify({ gap: atBottom, hidden: hiddenAtBottom }));

    await win.evaluate(() => { document.getElementById("log").scrollTop = 0; });
    await win.waitForTimeout(300);
    const upState = await win.evaluate(new Function(
      "const g = (" + gapOf.toString() + ")();" +
      "const b = document.getElementById('to-bottom');" +
      "return { gap: g, hidden: !b || b.hidden, rect: b ? { w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height } : null };",
    ));
    !upState.hidden && upState.gap > 240
      ? ok("往上翻一屏后浮现（离底 " + Math.round(upState.gap) + "px）")
      : bad("button did not appear", JSON.stringify(upState));
    upState.rect && upState.rect.w > 20 && upState.rect.h > 20
      ? ok("按钮有真实尺寸（" + Math.round(upState.rect.w) + "×" + Math.round(upState.rect.h) + "），不是 0 高度的幽灵")
      : bad("button size", JSON.stringify(upState.rect));

    await win.screenshot({ path: path.join(os.tmpdir(), "bb-tobottom.png") });
    await win.click("#to-bottom");
    await win.waitForTimeout(700);
    const afterClick = await win.evaluate(new Function(
      "return { gap: (" + gapOf.toString() + ")(), hidden: document.getElementById('to-bottom').hidden };",
    ));
    afterClick.gap < 60 && afterClick.hidden
      ? ok("点一下就回到最底，按钮自己收起来（离底 " + Math.round(afterClick.gap) + "px）")
      : bad("click did not scroll", JSON.stringify(afterClick));

    // 空对话：滚不动 → 离底 0 → 不该出现（这条专治「scrollTop === 0 就亮」的写法）。
    // 注意不能点 #sess-new：没有 Bot 的干净 dataRoot 上它会拉出建 Bot 的弹层，
    // 于是走 IPC 直接建一个空会话，再从侧栏那一行点进去（等价于用户点会话）。
    const blank = await win.evaluate(() => window.bitbot.sessions.create("空对话"));
    const blankId = blank && blank.session && blank.session.id;
    // 侧栏那一段可能整块是收起状态（新会话被折叠在「最近」里），Playwright 的
    // 「可见才点」会一直等；这里直接派发点击——用户点的是同一行、同一个 handler。
    await win.waitForSelector('.sess-row[data-session-id="' + blankId + '"]', { state: "attached", timeout: 15000 });
    await win.evaluate((id) => {
      document.querySelector('.sess-row[data-session-id="' + id + '"]').click();
    }, blankId);
    await win.waitForTimeout(800);
    const emptyState = await win.evaluate(new Function(
      "return { gap: (" + gapOf.toString() + ")(), msgs: document.querySelectorAll('#log .msg').length," +
      " hidden: document.getElementById('to-bottom').hidden, top: document.getElementById('log').scrollTop };",
    ));
    emptyState.hidden && emptyState.gap < 240 && emptyState.msgs === 0 && emptyState.top === 0
      ? ok("空对话里 scrollTop 就是 0，但按钮仍然藏着（判据是离底距离）")
      : bad("empty convo shows button", JSON.stringify(emptyState));

    // ---------- 2) 定时任务归档 ----------
    await win.waitForSelector('.sess-row[data-room-id="' + ROOM + '"]', { timeout: 20000 });
    await win.click('.sess-row[data-room-id="' + ROOM + '"]');
    await win.waitForTimeout(800);
    await win.click("#room-banner-info");
    await win.waitForTimeout(400);
    await win.click("#ri-tab-routines");
    await win.waitForTimeout(600);

    const panel = await win.evaluate(() => {
      const live = Array.from(document.querySelectorAll("#ri-routine-list .ri-item .ri-prompt")).map((x) => x.textContent.trim());
      const box = document.getElementById("ri-routine-archived");
      const sum = box ? box.querySelector("summary") : null;
      return {
        live,
        archHidden: !box || box.hidden,
        sum: sum ? sum.textContent.trim() : "",
        archRows: box ? box.querySelectorAll(".ri-item-archived").length : 0,
      };
    });
    panel.live.length === 1 && /稿子/.test(panel.live[0] || "")
      ? ok("常用列表只剩在跑的那条（归档行被剔出去了）")
      : bad("live list", JSON.stringify(panel.live));
    !panel.archHidden && panel.archRows === 1 && /已归档/.test(panel.sum) && /1/.test(panel.sum)
      ? ok("归档区折叠成「" + panel.sum + "」，里面 1 条")
      : bad("archive fold", JSON.stringify(panel));

    await win.screenshot({ path: path.join(os.tmpdir(), "bb-archive-fold.png") });
    const collapsed = await win.evaluate(() => {
      const d = document.querySelector("#ri-routine-archived details");
      return d ? d.open === true : null;
    });
    collapsed === false
      ? ok("归档区默认是收起的（历史不占常用列表的位置）")
      : bad("archive fold default open", JSON.stringify(collapsed));
    await win.click("#ri-routine-archived summary");
    await win.waitForTimeout(200);
    await win.click("#ri-routine-archived .ri-unarchive");
    await win.waitForTimeout(900);
    const after = await win.evaluate(() => {
      const live = document.querySelectorAll("#ri-routine-list .ri-item").length;
      const box = document.getElementById("ri-routine-archived");
      return { live, archHidden: !box || box.hidden };
    });
    const stored = JSON.parse(fs.readFileSync(ROUTES, "utf8"));
    const row = stored.find((r) => r && r.id === "ba-arch") || {};
    after.live === 2 && after.archHidden
      ? ok("取消归档：行回到常用列表，归档区空了就整块隐藏")
      : bad("unarchive ui", JSON.stringify(after));
    !row.archived_at && row.enabled === false
      ? ok("取消归档：store 里 archived_at 真被摘掉，且仍是暂停态（没偷偷开排程）")
      : bad("unarchive store", JSON.stringify({ a: row.archived_at, e: row.enabled }));

    await win.screenshot({ path: path.join(os.tmpdir(), "bb-archive-after.png") });
  } finally {
    await app.close();
  }
  console.log("\ne2e_desktop_bottom_archive: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => {
  console.error("e2e_desktop_bottom_archive fatal:", e && e.message ? e.message : e);
  process.exit(1);
});
