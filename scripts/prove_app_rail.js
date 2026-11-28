#!/usr/bin/env node
"use strict";

/**
 * prove_app_rail — 域导航栏门（批次 14）
 *
 * 背景：侧栏顶部那一排图标装着四种**不同性质**的东西
 * （切布局 / 搜索 / 创建 / 跳指挥台）⇒ 用户看到的是「四个按钮」，
 * 不是「四个去处」⇒ 这就是「堆了一堆功能」的视觉来源。
 *
 * ⇒ 最左加一条 64px 的**域导航栏**（对齐参考图那一支）：
 *   对话 / 指挥 / 自动化 / 设置 —— 只回答「我在哪、我要去哪」。
 *
 * 本门钉住六条：
 *   AR-1 域导航栏存在，恰好四个域，顺序固定
 *   AR-2 每个域都有**可见文字标签**（不只是图标）——
 *        域是「去处」，用户得知道去哪；只有图标的域栏读不懂
 *   AR-3 每个域都有**真实去处**（点了会有反应），不是摆设
 *   AR-4 「自动化」在没有所在群时**禁用**并说清原因 ——
 *        定时任务是逐群的（群资料面板那一段）⇒ 没群就没得看
 *        ⇒ 宁可禁用，也不放假入口
 *   AR-5 同一时刻只有一个域是选中态
 *   AR-6 负向对照：把域删成三个 ⇒ 必须判红
 *
 * 用法：node scripts/prove_app_rail.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require(path.join(__dirname, "..", "hosts", "desktop", "node_modules", "playwright-core"));

const REPO = path.resolve(__dirname, "..");
const HTML = path.join(REPO, "hosts", "desktop", "index.html");
const EXPECTED = ["chat", "command", "automation", "settings"];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const check = (c, m, d) => (c ? ok(m) : bad(m, d));

async function openPage(browser, htmlPath) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String((e && e.message) || "").split("\n")[0]));
  await page.addInitScript(() => {
    window.bitbot = Object.assign(window.bitbot || {}, {
      rooms: {
        list: async () => ({
          rooms: {
            version: 1,
            rooms: [{ id: "r-app-rail", title: "内容团队", members: ["t1", "t2"], transcript: [] }],
          },
        }),
      },
    });
  });
  await page.goto("file://" + htmlPath, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  return { page, errs };
}

(async () => {
  console.log("prove_app_rail — 域导航栏（四个域，每个都有真实去处）");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });

  let page = null;
  let errs = [];
  try {
    ({ page, errs } = await openPage(browser, HTML));

    /* AR-1 四个域，顺序固定 */
    const dom = await page.evaluate(() => {
      const rail = document.getElementById("app-rail");
      const items = rail ? Array.from(rail.querySelectorAll(".app-rail-item")) : [];
      return {
        exists: !!rail,
        keys: items.map((b) => b.getAttribute("data-app-domain")),
        labels: items.map((b) => {
          const sp = b.querySelector("span");
          return sp ? String(sp.textContent || "").trim() : "";
        }),
        svgs: items.map((b) => !!b.querySelector("svg")),
        disabled: Object.fromEntries(items.map((b) => [b.getAttribute("data-app-domain"), !!b.disabled])),
        titles: Object.fromEntries(items.map((b) => [b.getAttribute("data-app-domain"), b.getAttribute("title") || ""])),
        current: rail ? rail.getAttribute("data-app-domain") : null,
      };
    });
    if (dom.exists === true) {
  ok("[AR-01] 域导航栏存在（#app-rail）");
} else {
  bad("[AR-01] 域导航栏存在（#app-rail）");
};
    if (JSON.stringify(dom.keys) === JSON.stringify(EXPECTED)) {
  ok("[AR-01] 恰好四个域，顺序固定（对话 / 指挥 / 自动化 / 设置）");
} else {
  bad("[AR-01] 恰好四个域，顺序固定（对话 / 指挥 / 自动化 / 设置）", JSON.stringify(dom.keys));
};

    /* AR-2 每个域都有可见文字标签 + 图标 */
    if (dom.labels.every((t) => t && t.length > 0)) {
  ok("[AR-02] 每个域都有**可见文字标签**（不只是图标）");
} else {
  bad("[AR-02] 每个域都有**可见文字标签**（不只是图标）", JSON.stringify(dom.labels));
};
    if (dom.svgs.every(Boolean)) {
  ok("[AR-02] 每个域都有线性 SVG 图标");
} else {
  bad("[AR-02] 每个域都有线性 SVG 图标");
};

    /* AR-4 没有群时「自动化」禁用并说清原因 */
    if (dom.disabled.automation === true) {
  ok("[AR-04] 没有所在群时「自动化」是**禁用**的（定时任务是逐群的）");
} else {
  bad("[AR-04] 没有所在群时「自动化」是**禁用**的（定时任务是逐群的）", JSON.stringify(dom.disabled));
};
    if (/群/.test(dom.titles.automation || "")) {
  ok("[AR-04] 禁用时 title 说清了原因（为什么不能点）");
} else {
  bad("[AR-04] 禁用时 title 说清了原因（为什么不能点）", dom.titles.automation);
};

    /* AR-5 同一时刻只有一个域选中 */
    const cur = await page.evaluate(() => {
      const rail = document.getElementById("app-rail");
      return {
        current: rail ? rail.getAttribute("data-app-domain") : null,
        marked: rail ? rail.querySelectorAll('.app-rail-item[aria-current="page"]').length : 0,
      };
    });
    if (cur.marked === 1 && cur.current === "chat") {
  ok("[AR-05] 默认在「对话」，且同一时刻只有一个域是选中态");
} else {
  bad("[AR-05] 默认在「对话」，且同一时刻只有一个域是选中态", JSON.stringify(cur));
};

    /* AR-3 点「指挥」⇒ 指挥台真的打开了 */
    await page.click('#app-rail [data-app-domain="command"]');
    await page.waitForTimeout(700);
    const afterCmd = await page.evaluate(() => {
      const panel = document.getElementById("command-panel");
      const rail = document.getElementById("app-rail");
      return {
        panelOpen: !!(panel && !panel.hidden),
        bodyCmd: document.body.classList.contains("cmd-view"),
        current: rail ? rail.getAttribute("data-app-domain") : null,
        marked: rail ? rail.querySelectorAll('.app-rail-item[aria-current="page"]').length : 0,
        autoDisabled: (() => {
          const a = document.querySelector('[data-app-domain="automation"]');
          return a ? a.disabled : null;
        })(),
      };
    });
    if (afterCmd.panelOpen === true && afterCmd.bodyCmd === true) {
  ok("[AR-03] 点「指挥」⇒ 指挥台真的打开了（不是摆设）");
} else {
  bad("[AR-03] 点「指挥」⇒ 指挥台真的打开了（不是摆设）", JSON.stringify(afterCmd));
};
    if (afterCmd.current === "command" && afterCmd.marked === 1) {
  ok("[AR-05] 切域后仍然只有一个域选中");
} else {
  bad("[AR-05] 切域后仍然只有一个域选中");
};

    /* 进群 ⇒ 「自动化」变可用（定时任务确实跟着群走） */
    await page.evaluate(async () => {
      const res = await window.bitbot.rooms.list();
      await window.__bitbotCommand.enterRoom(res.rooms.rooms[0].id);
    });
    await page.waitForTimeout(900);
    const afterRoom = await page.evaluate(() => {
      const a = document.querySelector('[data-app-domain="automation"]');
      return { disabled: a ? a.disabled : null, title: a ? a.getAttribute("title") || "" : "" };
    });
    if (afterRoom.disabled === false) {
  ok("[AR-04] 进了群 ⇒ 「自动化」可用（定时任务确实是逐群的）");
} else {
  bad("[AR-04] 进了群 ⇒ 「自动化」可用（定时任务确实是逐群的）", JSON.stringify(afterRoom));
};

    /* 点「对话」⇒ 回到聊天，指挥台让位 */
    await page.click('#app-rail [data-app-domain="chat"]');
    await page.waitForTimeout(600);
    const afterChat = await page.evaluate(() => {
      const panel = document.getElementById("command-panel");
      return {
        panelClosed: !!(panel && panel.hidden),
        bodyCmd: document.body.classList.contains("cmd-view"),
      };
    });
    if (afterChat.panelClosed === true && afterChat.bodyCmd === false) {
  ok("[AR-03] 点「对话」⇒ 回到聊天，指挥台让位（两个视图互斥）");
} else {
  bad("[AR-03] 点「对话」⇒ 回到聊天，指挥台让位（两个视图互斥）", JSON.stringify(afterChat));
};

    if (errs.length === 0) {
  ok("[AR-06] 页面没有 pageerror");
} else {
  bad("[AR-06] 页面没有 pageerror", JSON.stringify(errs.slice(0, 3)));
};

    /* ── AR-6 负向对照：把域删成三个 ⇒ 必须判红 ──
     * 变异只发生在**临时副本**上（源文件一个字节不动）。
     * 副本必须放**同目录**：index.html 里的 CSS/JS 都是相对引用，
     * 放 /tmp 会全加载不到（实测踩过：页面只剩壳）。 */
    {
      const src = fs.readFileSync(HTML, "utf8") + "\n" + fs.readFileSync(path.join(REPO, "hosts", "desktop", "ui_components.css"), "utf8");
      const mutated = src.replace(/\s*<button type="button" class="app-rail-item" data-app-domain="automation">[\s\S]*?<\/button>/, "");
      if (mutated === src) {
        bad("[AR-06] 负向对照跑不起来（注入点找不到：源码结构变了）");
      } else {
        const tmpHtml = path.join(path.dirname(HTML), ".negative_control_app_rail.html");
        fs.writeFileSync(tmpHtml, mutated, "utf8");
        try {
          const m = await openPage(browser, tmpHtml);
          const keys = await m.page.evaluate(() => {
            const rail = document.getElementById("app-rail");
            return rail ? Array.from(rail.querySelectorAll(".app-rail-item")).map((b) => b.getAttribute("data-app-domain")) : [];
          });
          if (JSON.stringify(keys) !== JSON.stringify(EXPECTED)) {
  ok("[AR-06] 负向对照有牙：删掉「自动化」域 ⇒ AR-1 判红（少一个域就是少一个去处）");
} else {
  bad("[AR-06] 负向对照有牙：删掉「自动化」域 ⇒ AR-1 判红（少一个域就是少一个去处）", JSON.stringify(keys));
};
          await m.page.close();
        } catch (e) {
          bad("[AR-06] 负向对照跑不起来", String((e && e.message) || e).slice(0, 200));
        } finally {
          try { fs.unlinkSync(tmpHtml); } catch (_) { /* ignore */ }
        }
      }
    }
  } catch (e) {
    bad("门禁崩了", String((e && e.stack) || e).slice(0, 400));
  } finally {
    if (page) { try { await page.close(); } catch (_) { /* ignore */ } }
    await browser.close();
  }

  console.log(`\nprove_app_rail: PASS=${pass} FAIL=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
