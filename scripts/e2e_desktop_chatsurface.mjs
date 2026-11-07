/* e2e_desktop_chatsurface.mjs — 聊天面四项新能力的真渲染验证
 *
 * 覆盖：
 *   1) 日期分隔行：预置一份「昨天 + 今天」的会话，真渲染后必须出现两行居中分隔
 *      （昨天 / 今天），且顺序对着每天第一条消息；
 *   2) Find in chat：Cmd/Ctrl+F 打开浮条 → 输入关键词 → <mark> 命中数正确 →
 *      Enter 跳下一个、计数跟着走 → Esc 关闭且命中全部拆回纯文本；
 *   3) 删除消息：hover 最后一条回复 → 点 ghost 条的删除钮 → 真 DOM 摘掉 +
 *      store 里那条也没了（不是只改界面）；
 *   4) 负向：删一个不存在的 message id → 必须 ok:false + message_not_found
 *      （不假装删成功）。
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

/* ---- 预置跨天会话 ---- */
const DATA = path.join(os.tmpdir(), "bitbot-e2e-chatsurface-data");
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(path.join(DATA, "desktop"), { recursive: true });
const now = new Date();
const yest = new Date(now.getTime() - 24 * 3600 * 1000);
const sid = "sess-cs0001";
const seed = {
  version: 1,
  active_id: sid,
  sessions: [{
    id: sid,
    title: "聊天面验证",
    created_at: yest.toISOString(),
    updated_at: now.toISOString(),
    messages: [
      { id: "msg-old1", role: "user", text: "昨天的派单量是多少", at: yest.toISOString() },
      { id: "msg-old2", role: "assistant", text: "昨天派单 1,284 单，同比 +6.2%。", at: new Date(yest.getTime() + 1000).toISOString() },
      { id: "msg-new1", role: "user", text: "今天的派单量呢", at: now.toISOString() },
      { id: "msg-new2", role: "assistant", text: "今天到目前派单 320 单。", at: new Date(now.getTime() + 1000).toISOString() },
    ],
  }],
};
fs.writeFileSync(path.join(DATA, "desktop", "sessions.json"), JSON.stringify(seed, null, 2));

const ud = electronUserDataDir("bb-chatsurface");
const env = electronLaunchEnv(
  gateAppEnv(REPO, {
    BITBOT_DATA_ROOT: DATA,
    BITBOT_NO_SECRET_SYNC: "1",
    BITBOT_DESKTOP_AUTOSTART: "0",
  }),
);

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

    // ---------- 1) 历史加载 + 日期分隔 ----------
    await win.waitForFunction(() => document.querySelectorAll("#log .msg").length >= 4, null, { timeout: 20000 }).catch(() => {});
    const seps = await win.evaluate(() =>
      Array.from(document.querySelectorAll("#log .msg-day-sep")).map((x) => x.textContent.trim()));
    seps.length === 2 ? ok("日期分隔：历史加载插了两行（一天一行）") : bad("day sep count", JSON.stringify(seps));
    /昨天/.test(seps[0] || "") && /今天/.test(seps[1] || "")
      ? ok("日期分隔文案：昨天 / 今天（真机同款相对日）")
      : bad("day sep text", JSON.stringify(seps));
    const sepOrder = await win.evaluate(() => {
      const kids = Array.from(document.querySelectorAll("#log > *"));
      const firstSep = kids.findIndex((k) => k.classList && k.classList.contains("msg-day-sep"));
      const firstMsg = kids.findIndex((k) => k.classList && k.classList.contains("msg"));
      return firstSep >= 0 && firstSep < firstMsg;
    });
    sepOrder ? ok("日期分隔位置：在当天第一条消息之前") : bad("day sep order", "separator after first message");

    // ---------- 2) Find in chat ----------
    await win.keyboard.press("Meta+f");
    await win.waitForTimeout(150);
    const opened = await win.evaluate(() => {
      const bar = document.getElementById("find-bar");
      return { hidden: !bar || bar.hidden, focused: document.activeElement && document.activeElement.id };
    });
    !opened.hidden && opened.focused === "find-input"
      ? ok("Cmd+F：查找条可见且输入框拿到焦点")
      : bad("find open", JSON.stringify(opened));

    await win.keyboard.type("派单");
    await win.waitForTimeout(350);
    const hits = await win.evaluate(() => ({
      count: document.querySelectorAll("#log mark.find-hit").length,
      label: (document.getElementById("find-count") || {}).textContent || "",
      onFirst: !!document.querySelector("#log mark.find-hit.on"),
    }));
    hits.count >= 4 ? ok("查找命中：" + hits.count + " 处被 <mark> 包起来（不重建 markdown）") : bad("find hits", JSON.stringify(hits));
    hits.label === "1/" + hits.count ? ok("计数：回车前停在 1/" + hits.count) : bad("find label", JSON.stringify(hits.label));
    hits.onFirst ? ok("当前命中带 .on（不是所有命中一个颜色）") : bad("find current", "no .on hit");

    await win.screenshot({ path: path.join(os.tmpdir(), "bb-findbar.png") });
    await win.keyboard.press("Enter");
    await win.waitForTimeout(150);
    const second = await win.evaluate(() => (document.getElementById("find-count") || {}).textContent || "");
    second === "2/" + hits.count ? ok("Enter：跳到下一个（2/" + hits.count + "）") : bad("find next", second);

    await win.keyboard.press("Escape");
    await win.waitForTimeout(200);
    const closed = await win.evaluate(() => ({
      hidden: document.getElementById("find-bar").hidden,
      marks: document.querySelectorAll("#log mark.find-hit").length,
      text: (document.querySelector("#log .msg .body") || {}).textContent || "",
    }));
    closed.hidden && closed.marks === 0 ? ok("Esc：查找条关闭且命中全部拆回纯文本") : bad("find close", JSON.stringify(closed));
    /派单/.test(closed.text) ? ok("关闭后正文原样（拆 mark 没伤到文本）") : bad("find restore", closed.text.slice(0, 80));

    // ---------- 3) 删除消息（真按钮 → 真 store） ----------
    const before = await win.evaluate(() => document.querySelectorAll("#log .msg").length);
    // 注意：流式进度行也是 .msg.assistant（没有 mid、没有操作条），
    // 按「最后一条 assistant」选会选到它 —— 用 mid 精确锁定那条回复。
    const lastReply = win.locator('#log .msg.assistant[data-mid="msg-new2"]');
    await lastReply.hover();
    await win.waitForTimeout(250);
    const delBtn = lastReply.locator(".msg-actions button").last();
    await delBtn.click();
    await win.waitForTimeout(600);
    const after = await win.evaluate(() => document.querySelectorAll("#log .msg").length);
    const stored = await win.evaluate(async (sessionId) => {
      const got = await window.bitbot.sessions.get(sessionId);
      const msgs = (got && got.session && got.session.messages) || [];
      return { n: msgs.length, ids: msgs.map((m) => m.id) };
    }, sid);
    after === before - 1 ? ok("删除消息：DOM 少一行") : bad("delete dom", before + " → " + after);
    !stored.ids.includes("msg-new2") && stored.n === 3
      ? ok("删除消息：store 里那条也真没了（不是只改界面）")
      : bad("delete store", JSON.stringify(stored));

    // ---------- 4) 负向：删不存在的 id ----------
    const neg = await win.evaluate(async (sessionId) => {
      const res = await window.bitbot.messages.delete({ sessionId, entryId: "msg-does-not-exist" });
      return res;
    }, sid);
    neg && neg.ok === false && neg.error === "message_not_found"
      ? ok("负向：删不存在的消息 → ok:false + message_not_found（不假装成功）")
      : bad("delete negative", JSON.stringify(neg));

    await win.screenshot({ path: path.join(os.tmpdir(), "bb-chatsurface.png") });
  } finally {
    await app.close();
  }
  console.log("\ne2e_desktop_chatsurface: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => {
  console.error("e2e_desktop_chatsurface fatal:", e && e.message ? e.message : e);
  process.exit(1);
});
