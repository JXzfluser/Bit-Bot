#!/usr/bin/env node
"use strict";

/**
 * prove_bot_identity —— 「名字不是身份」：同名 bot 也要分得清（批次 15）
 *
 * 背景：Bit-Bot 的机制层一直用 id 区分 Bot（data-bot-id / member_refs / bot_id），
 * 显示层却一直只印**名字** ⇒ 群里有两个都叫「助手」时，用户看到的两个东西**完全一样**。
 * 而且真出过一个 bug：成员区拿**名字**做键去查 **id** ⇒ 「在跑」状态永远算不出来。
 *
 * 本门跑**真页面**（headless Chromium 打开 index.html，注入带同名 bot 的夹具），
 * 验的是**真产品代码**：
 *   BI-01 身份算法挂在 window.__botIdentity 上（单一真源，跨作用域可调）
 *   BI-02 同名 ⇒ 显示名**必须不同**（消歧真的生效了）
 *   BI-03 不重名 ⇒ 显示名**原样**（界面不许凭空多出后缀）
 *   BI-04 后缀**优先用职责**（职责是 bot 真实的区分信息，用户看得懂）
 *   BI-05 职责也撞 ⇒ 退到短 id，且在这组同名的人里**唯一**
 *   BI-06 **单一真源**：侧栏行 / 指挥台成员区 / 任务卡，对同一个 bot 显示**同一个名字**
 *   BI-07 成员区「在跑」状态**算得出来**（名字/id 键错已修）
 *   BI-08 **冗余入口已移除**：侧栏不再有「指挥台」按钮（域导航栏的「指挥」是唯一入口），
 *         角标迁到「指挥」上且会显示
 *   BI-09 负向对照：把消歧抽掉 ⇒ BI-02 **必须判红**（判据有牙，不是恒绿）
 *   BI-10 点名候选：两个同名 bot **都在**、标签不同、点进去插入的是「名字（后缀）」
 *
 * 口径：变异只发生在**临时副本**上（源文件一个字节都不动）；副本放**同目录**
 *       （index.html 里的 CSS/JS 都是相对引用）。
 *
 * 用法：node scripts/prove_bot_identity.js
 */

const fs = require("fs");
const path = require("path");
const { resolveBrowser } = require("./lib/browser_env");

const REPO = path.resolve(__dirname, "..");
const HTML = path.join(REPO, "hosts", "desktop", "index.html");

let pass = 0,
  fail = 0;
const ok = (m) => {
  pass++;
  console.log("  ✓ " + m);
};
const bad = (m, d) => {
  fail++;
  console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : ""));
};
/* 本门声明的断言编号 —— 矩阵按这份清单**逐条**锚点(AC-02 的编号族对账)。
   AC-02 认编号的形状是「逗号 + 引号」(,\s*"([A-Z][A-Z0-9]*-\d{2}[a-z]?)")，
   所以清单第一项前面得有个占位，否则第一个编号认不到。
   ⚠️ 输出形态必须是 "[BI-01] …" —— 矩阵就是按这个字面 grep 锚点的
   （批次 15 自查发现：早期版本输出的是 "BI-01 …"（无方括号）⇒ 矩阵锚点全空
   ⇒ CI 上会凭空多出 9 条「锚点缺失」红）。 */
const CLAIM_IDS = ["(head)", "BI-01", "BI-02", "BI-03", "BI-04", "BI-05", "BI-06", "BI-07", "BI-08", "BI-09", "BI-10"];
const CLAIM_ID_SET = new Set(CLAIM_IDS.filter((x) => x !== "(head)"));
const usedIds = new Set();
const check = (id, cond, m, d) => {
  usedIds.add(id);
  if (!CLAIM_ID_SET.has(id)) {
    bad("[" + id + "] " + m, "断言编号没登记在 CLAIM_IDS 里（清单与实现漂了）");
    return;
  }
  return cond ? ok("[" + id + "] " + m) : bad("[" + id + "] " + m, d);
};

/** 夹具：一群里有两个「助手」、两个「通用」、一个「独苗」。 */
const BOTS = [
  { id: "dup-a", name: "助手", job: "销售", description: "外呼销售", group: "团队A" },
  { id: "dup-b", name: "助手", job: "支持", description: "客户支持", group: "团队A" },
  /* 职责与名字相同（现实里模板 bot 就是这样）⇒ 后缀必须退到下一级 */
  { id: "twin-a", name: "通用", job: "通用", description: "通用", group: "团队A" },
  { id: "twin-b", name: "通用", job: "通用", description: "通用", group: "团队A" },
  { id: "solo", name: "独苗", job: "研究", description: "研究", group: "团队A" },
];

const ROOM = {
  id: "r-dup",
  title: "同名群",
  members: ["dup-a", "dup-b", "twin-a", "twin-b", "solo"],
  transcript: [
    /* 同一批任务里，两个同名 bot 都干了活 ⇒ 任务卡必须显示成两个不同的名字。
       ⚠️ 带 task_sig 是**产品现在真实写出来的形状**（批 3 之后 bot_reply 都带号）——
       旧形状（bot_reply 不带号）有另一个既存问题：后来的带号行会粘到旧卡上
       （见交付报告「已知遗留」），这一批不动聚合语义。 */
    { kind: "bot_reply", room_id: "r-dup", speaker: "dup-a", bot_id: "dup-a", name: "助手", text: "我先做", task_sig: "sig-run", at: "2026-11-26T10:00:00.000Z" },
    { kind: "bot_reply", room_id: "r-dup", speaker: "dup-b", bot_id: "dup-b", name: "助手", text: "我也做", task_sig: "sig-run", at: "2026-11-26T10:01:00.000Z" },
    /* 另一批：等你拍板 ⇒ 角标该亮 */
    {
      kind: "confirm_request", room_id: "r-dup", speaker: "host", stage: "route",
      question: "这一轮该谁做？", candidates: [{ id: "dup-a", name: "助手" }],
      task: "这一轮", task_sig: "sig-wait", at: "2026-11-26T10:05:00.000Z",
    },
  ],
};

async function openPage(browser, htmlPath) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String((e && e.message) || "").split("\n")[0]));
  await page.addInitScript((arg) => {
    window.bitbot = Object.assign(window.bitbot || {}, {
      bots: {
        list: async () => ({ version: 1, primary_id: "dup-a", bots: arg.bots }),
        detail: async (id) => {
          const hit = arg.bots.find((b) => b && b.id === id);
          return { ok: true, bot: hit || { id: id, name: id } };
        },
      },
      rooms: { list: async () => ({ rooms: { version: 1, rooms: [arg.room] } }) },
      sessions: { list: async () => ({ sessions: [] }) },
    });
  }, { bots: BOTS, room: ROOM });
  await page.goto("file://" + htmlPath, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  return { page, errs };
}

(async () => {
  console.log("prove_bot_identity — 同名 bot 也要分得清（名字不是身份）");
  const benv = resolveBrowser();
  if (!benv.pw || !benv.exe) {
    console.log("  · SKIP " + benv.reason + " —— 渲染门没跑(不算通过)");
    console.log("\nprove_bot_identity: SKIP(" + benv.reason + ")");
    process.exit(2);
  }
  const { chromium } = benv.pw;
  const browser = await chromium.launch({
    executablePath: benv.exe,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  let page = null;
  let errs = [];
  try {
    ({ page, errs } = await openPage(browser, HTML));

    /* BI-01 单一真源在 window 上（跨作用域可调） */
    const hasIdent = await page.evaluate(() => !!(window.__botIdentity && typeof window.__botIdentity.label === "function"));
    check("BI-01", hasIdent, "身份算法挂在 window.__botIdentity 上（单一真源）");
    if (!hasIdent) throw new Error("no_identity_api");

    /* BI-02 同名 ⇒ 标签不同；BI-03 不重名 ⇒ 原样；BI-04 后缀优先职责；BI-05 退到短 id */
    const labels = await page.evaluate(() => {
      const id = window.__botIdentity;
      const dupA = { id: "dup-a", name: "助手", job: "销售", group: "团队A" };
      const dupB = { id: "dup-b", name: "助手", job: "支持", group: "团队A" };
      const twinA = { id: "twin-a", name: "通用", job: "通用", group: "团队A" };
      const twinB = { id: "twin-b", name: "通用", job: "通用", group: "团队A" };
      const solo = { id: "solo", name: "独苗", job: "研究", group: "团队A" };
      const dupPeers = [dupA, dupB];
      const twinPeers = [twinA, twinB];
      return {
        dupA: id.label(dupA, dupPeers),
        dupB: id.label(dupB, dupPeers),
        twinA: id.label(twinA, twinPeers),
        twinB: id.label(twinB, twinPeers),
        solo: id.label(solo, [dupA, dupB, twinA, twinB, solo]),
        map: id.labelMap(dupPeers),
      };
    });
    check("BI-02", 
      labels.dupA !== labels.dupB,
      "同名 bot 的显示名**必须不同**（消歧真的生效了）",
      JSON.stringify([labels.dupA, labels.dupB])
    );
    check("BI-03", 
      labels.solo === "独苗",
      "不重名 ⇒ 显示名**原样**（界面不许凭空多出后缀）",
      labels.solo
    );
    check("BI-04", 
      labels.dupA.indexOf("销售") >= 0 && labels.dupB.indexOf("支持") >= 0,
      "后缀**优先用职责**（职责是真实的区分信息，用户看得懂）",
      JSON.stringify([labels.dupA, labels.dupB])
    );
    check("BI-05", 
      labels.twinA !== labels.twinB
        && labels.twinA.indexOf("通用 · ") === 0
        && labels.twinB.indexOf("通用 · ") === 0,
      "职责也撞 ⇒ 退到下一级（短 id），且两人仍然不同",
      JSON.stringify([labels.twinA, labels.twinB])
    );

    /* BI-06 单一真源 + BI-07「在跑」算得出来 + BI-08 冗余入口已移除 */
    await page.evaluate(async () => {
      await window.__bitbotCommand.enterRoom("r-dup");
      /* 侧栏平时由 Host 的 bots-changed 广播叫起 ⇒ 门禁得自己叫一次真刷新。 */
      if (window.__botIdentity && typeof window.__botIdentity.refreshSidebar === "function") {
        await window.__botIdentity.refreshSidebar();
      }
    });
    await page.waitForTimeout(1200);
    const dom = await page.evaluate(() => {
      const railCmd = document.querySelector('#app-rail [data-app-domain="command"]');
      const badge = document.getElementById("cmd-nav-badge");
      const sideA = document.querySelector('#bot-list .agent-item[data-agent-id="dup-a"] .name');
      const sideB = document.querySelector('#bot-list .agent-item[data-agent-id="dup-b"] .name');
      const memA = document.querySelector('#cmd-members-list .cmd-member[data-cmd-member="dup-a"] .cmd-member-name');
      const memB = document.querySelector('#cmd-members-list .cmd-member[data-cmd-member="dup-b"] .cmd-member-name');
      const stateA = document.querySelector('#cmd-members-list .cmd-member[data-cmd-member="dup-a"] .cmd-member-state');
      /* 按 task_sig 精确取「在跑」那张卡 —— DOM 里四个桶的卡都在，
         取第一张会拿到 needs_you 那张（它本来就没有成员）。 */
      const whoEl = document.querySelector('.cmd-card[data-task-sig="sig-run"] .cmd-card-who');
      return {
        railCommandExists: !!railCmd,
        badgeText: badge ? badge.textContent : "",
        badgeHidden: badge ? !!badge.hidden : null,
        sidebarA: sideA ? sideA.textContent : "",
        sidebarB: sideB ? sideB.textContent : "",
        memberA: memA ? memA.textContent : "",
        memberB: memB ? memB.textContent : "",
        stateA: stateA ? stateA.textContent : "",
        who: whoEl ? whoEl.textContent : "",
        sidebarCmdBtn: !!document.getElementById("cmd-open-btn"),
        sidebarCmdEntryClass: !!document.querySelector(".sb-cmd-entry"),
      };
    });

    check("BI-06", 
      dom.sidebarA !== "" && dom.sidebarB !== "" && dom.sidebarA !== dom.sidebarB,
      "侧栏两行同名 bot 显示成**不同的名字**",
      JSON.stringify([dom.sidebarA, dom.sidebarB])
    );
    check("BI-06", 
      dom.memberA !== "" && dom.memberA === dom.sidebarA && dom.memberB === dom.sidebarB,
      "单一真源：成员区与侧栏对同一个 bot 显示**同一个名字**",
      JSON.stringify([dom.sidebarA, dom.sidebarB, dom.memberA, dom.memberB])
    );
    check("BI-06", 
      dom.who.indexOf("助手 · 销售") >= 0 && dom.who.indexOf("助手 · 支持") >= 0,
      "任务卡的「谁」显示两个**不同**的同名成员（不是「助手、助手」）",
      dom.who
    );
    check("BI-07", 
      /在跑|Working/.test(dom.stateA),
      "成员区「在跑」状态**算得出来**（名字/id 键错已修）",
      dom.stateA
    );
    check("BI-08", 
      dom.railCommandExists === true && dom.sidebarCmdBtn === false && dom.sidebarCmdEntryClass === false,
      "冗余入口已移除：域导航栏的「指挥」在，侧栏那颗「指挥台」按钮**没了**",
      JSON.stringify(dom)
    );
    check("BI-08", 
      dom.badgeHidden === false && String(dom.badgeText).trim() !== "",
      "角标迁到「指挥」上，而且会显示（要你拍板几件）",
      JSON.stringify([dom.badgeText, dom.badgeHidden])
    );

    check("BI-06", errs.length === 0, "页面没有 pageerror", JSON.stringify(errs.slice(0, 3)));

    /* BI-10 点名候选：两个同名 bot **都在**、标签不同、点进去插入的 token 可唯一解析。
       旧写法按**名字**去重 ⇒ 第二个同名 bot 被静默吞掉 ⇒ 用户根本 @ 不到他。 */
    {
      await page.click("#composer #text");
      await page.keyboard.type("@");
      await page.waitForTimeout(600);
      const items = await page.evaluate(() =>
        Array.from(document.querySelectorAll("#mention-pop .mention-item")).map((el) => {
          const nm = el.querySelector(".m-name");
          return nm ? String(nm.textContent || "") : "";
        })
      );
      check(
        "BI-10",
        items.indexOf("助手 · 销售") >= 0 && items.indexOf("助手 · 支持") >= 0,
        "点名候选里两个同名 bot **都在**（以前按名字去重 ⇒ 第二个被静默吞掉，用户根本 @ 不到）",
        JSON.stringify(items)
      );
      const idx = items.indexOf("助手 · 销售");
      if (idx >= 0) {
        await page.click("#mention-opt-" + idx);
        await page.waitForTimeout(400);
        const val = await page.evaluate(() => String((document.getElementById("text") || {}).value || ""));
        check(
          "BI-10",
          val.indexOf("@助手（销售）") >= 0,
          "点同名候选 ⇒ 插进去的是「名字（后缀）」（Host 能唯一解析；裸名字会指错人）",
          val
        );
      } else {
        bad("[BI-10] 点同名候选 ⇒ 插进去的是「名字（后缀）」（Host 能唯一解析；裸名字会指错人）", "候选里没有「助手 · 销售」");
      }
    }

    /* ── BI-09 负向对照：把消歧抽掉 ⇒ BI-02 必须判红 ──
     * 变异只发生在**临时副本**上（源文件一个字节不动）；
     * 副本必须放**同目录**：index.html 的 CSS/JS 都是相对引用。 */
    {
      const src = fs.readFileSync(HTML, "utf8");
      const anchor = "if (same.length < 2) return nm;";
      const mutated = src.replace(anchor, "if (same.length >= 0) return nm;");
      if (mutated === src) {
        bad("[BI-09] 负向对照跑不起来（注入点找不到：源码结构变了）");
      } else {
        const tmpHtml = path.join(path.dirname(HTML), ".negative_control_bot_identity." + process.pid + ".html");
        fs.writeFileSync(tmpHtml, mutated, "utf8");
        try {
          const m = await openPage(browser, tmpHtml);
          const mLabels = await m.page.evaluate(() => {
            const id = window.__botIdentity;
            if (!id) return null;
            const a = { id: "dup-a", name: "助手", job: "销售", group: "团队A" };
            const b = { id: "dup-b", name: "助手", job: "支持", group: "团队A" };
            return { a: id.label(a, [a, b]), b: id.label(b, [a, b]) };
          });
          check("BI-09", 
            !!(mLabels && mLabels.a === mLabels.b),
            "负向对照有牙：抽掉消歧 ⇒ 两个同名 bot 显示成同一个名字 ⇒ BI-02 判红",
            JSON.stringify(mLabels)
          );
          await m.page.close();
        } catch (e) {
          bad("[BI-09] 负向对照跑不起来", String((e && e.message) || e).slice(0, 200));
        } finally {
          try {
            fs.unlinkSync(tmpHtml);
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
  } catch (e) {
    bad("门禁崩了", String((e && e.stack) || e).slice(0, 400));
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (_) {
        /* ignore */
      }
    }
    await browser.close();
  }

  console.log(`\nprove_bot_identity: PASS=${pass} FAIL=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})();
