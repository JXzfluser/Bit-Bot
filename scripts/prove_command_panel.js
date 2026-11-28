#!/usr/bin/env node
"use strict";

/**
 * prove_command_panel —— 团队指挥台(B-8)
 *
 * 这道门跑**真页面**:用 headless Chromium 打开 index.html,注入一份假的
 * `rooms.list()`,然后调产品自己的 `window.__bitbotCommand` ⇒ 验的是
 * **真产品代码的聚合与渲染**,不是另写一份逻辑重测一遍。
 *
 * 负向对照(本门自带的那些「必须是错/必须是空」的断言):
 *   · 没有 final_report 的那一批**不能**被算成「已完」
 *   · 没有数据时必须显示「还没有任务」,**不编**
 *   · 页面无 pageerror
 *   ⇒ 外加手工变异对照(判定改坏 ⇒ 3 红;空态造假 ⇒ 1 红)。
 *
 * 它钉住四件事:
 *   1. **聚合正确** —— 群转录里的真实行 ⇒ 正确的任务集合与桶;
 *   2. **分桶诚实** —— 没有 final_report 的那一批**不能**被算成「已完」;
 *   3. **真渲染** —— 面板里能看到任务、成员、待拍板的问题;
 *   4. **负向** —— 没有数据时显示「还没有任务」,**不编**。
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const { resolveBrowser } = require("./lib/browser_env");


const HTML = path.resolve(__dirname, "..", "hosts", "desktop", "index.html");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const check = (c, m, d) => (c ? ok(m) : bad(m, d));

/** 一份假的 rooms.list():两个群,三种状态。 */
function fakeRooms() {
  return {
    rooms: {
      version: 1,
      rooms: [
        {
          id: "r-done",
          title: "内容团队",
          members: ["t1", "t2"],
          transcript: [
            { kind: "bot_reply", room_id: "r-done", speaker: "t1", bot_id: "t1", name: "Alice", text: "热点已收集", at: "2026-11-21T10:00:00.000Z" },
            { kind: "bot_reply", room_id: "r-done", speaker: "t2", bot_id: "t2", name: "Bob", text: "初稿已成", at: "2026-11-21T10:01:00.000Z" },
            {
              kind: "final_report", room_id: "r-done", task: "整理热点稿",
              task_title: "整理热点稿", task_sig: "sig-done", responders: ["t1", "t2"],
              total: 2, returned: 2, partial: false, sections: [], artifacts: [], at: "2026-11-21T10:02:00.000Z",
            },
          ],
        },
        {
          id: "r-wait",
          title: "闲聊群",
          members: ["p1"],
          transcript: [
            {
              kind: "confirm_request", room_id: "r-wait", speaker: "host", stage: "route",
              question: "这句话我没看出该谁做。回一句名字，或者直接说「大家一起」。",
              candidates: [{ id: "p1", name: "Carol" }], task: "今天天气如何",
              task_sig: "sig-wait", at: "2026-11-21T11:00:00.000Z",
            },
          ],
        },
        {
          id: "r-run",
          title: "还在跑的群",
          members: ["t1"],
          transcript: [
            { kind: "bot_reply", room_id: "r-run", speaker: "t1", bot_id: "t1", name: "Alice", text: "正在写…", at: "2026-11-21T12:00:00.000Z" },
          ],
        },
      ],
    },
  };
}

console.log("prove_command_panel — 团队指挥台(聚合 / 分桶 / 真渲染)");

(async function main() {
  const benv = resolveBrowser();
  if (!benv.pw || !benv.exe) {
    console.log("  · SKIP " + benv.reason + " —— 渲染门没跑(不算通过)");
    console.log("\nprove_command_panel: SKIP(" + benv.reason + ")");
    process.exit(2);
  }
  const { chromium } = benv.pw;
  const browser = await chromium.launch({
    executablePath: benv.exe,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String((e && e.message) || "").split("\n")[0]));

  // 在页面脚本跑之前把假的 rooms.list 挂上。
  await page.addInitScript((rooms) => {
    window.bitbot = Object.assign(window.bitbot || {}, {
      rooms: { list: async () => rooms },
    });
  }, fakeRooms());

  await page.goto("file://" + HTML, { waitUntil: "load" });
  await page.waitForTimeout(900);

  const hasApi = await page.evaluate(() => !!(window.__bitbotCommand && window.__bitbotCommand.aggregate));
  check(hasApi, "CP-1 指挥台的聚合入口挂在 window.__bitbotCommand");
  if (!hasApi) {
    await browser.close();
    console.log("\nprove_command_panel: PASS=" + pass + " FAIL=" + (fail + 1));
    process.exit(1);
  }

  // ── 1. 聚合:三行事实 ⇒ 三个任务,各归其桶 ─────────────────────────────
  const agg = await page.evaluate(() => {
    const t = window.__bitbotCommand.aggregate([
      { id: "r-done", title: "内容团队", transcript: [
        { kind: "bot_reply", room_id: "r-done", speaker: "t1", bot_id: "t1", name: "Alice", text: "a", at: "2026-11-21T10:00:00.000Z" },
        { kind: "bot_reply", room_id: "r-done", speaker: "t2", bot_id: "t2", name: "Bob", text: "b", at: "2026-11-21T10:01:00.000Z" },
        { kind: "final_report", room_id: "r-done", task: "整理热点稿", task_sig: "sig-done", responders: ["t1","t2"], total: 2, returned: 2, partial: false, artifacts: [], at: "2026-11-21T10:02:00.000Z" },
      ]},
      { id: "r-wait", title: "闲聊群", transcript: [
        { kind: "confirm_request", room_id: "r-wait", speaker: "host", stage: "route", question: "该谁做?", candidates: [], task: "今天天气", task_sig: "sig-wait", at: "2026-11-21T11:00:00.000Z" },
      ]},
      { id: "r-run", title: "在跑", transcript: [
        { kind: "bot_reply", room_id: "r-run", speaker: "t1", bot_id: "t1", name: "Alice", text: "写…", at: "2026-11-21T12:00:00.000Z" },
      ]},
    ]);
    return {
      count: t.length,
      buckets: t.map((x) => x.bucket),
      closedMembers: (t.find((x) => x.bucket === "closed") || { members: [] }).members,
      closedTask: (t.find((x) => x.bucket === "closed") || { task: "" }).task,
      needsYou: !!(t.find((x) => x.bucket === "needs_you") || {}).needs_you,
      workingSteps: ((t.find((x) => x.bucket === "working") || { steps: [] }).steps || []).length,
    };
  });
  check(agg.count === 3, "CP-2 三段事实 ⇒ 三个任务", agg.count);
  check(agg.buckets.indexOf("closed") >= 0, "CP-2 有「已完」的任务");
  check(agg.buckets.indexOf("needs_you") >= 0, "CP-2 有「需要你拍板」的任务");
  check(agg.buckets.indexOf("working") >= 0, "CP-2 有「在跑」的任务");
  check(
    agg.closedMembers.length === 2 && agg.closedMembers.indexOf("Alice") >= 0 && agg.closedMembers.indexOf("Bob") >= 0,
    "CP-2 已完任务里**两个成员都在**(并行真的发生过)",
    JSON.stringify(agg.closedMembers)
  );
  check(agg.closedTask === "整理热点稿", "CP-2 任务标题来自真实记录", agg.closedTask);
  check(agg.needsYou === true, "CP-2 待拍板任务带着问题");
  check(agg.workingSteps === 1, "CP-2 在跑任务有进行中的步骤", agg.workingSteps);

  // ── 2. 负向:没有 final_report 的批次**不能**被算成已完 ────────────────
  const noReport = await page.evaluate(() => {
    const t = window.__bitbotCommand.aggregate([
      { id: "r", title: "x", transcript: [
        { kind: "bot_reply", room_id: "r", speaker: "t1", bot_id: "t1", name: "A", text: "a", at: "2026-11-21T10:00:00.000Z" },
      ]},
    ]);
    return { bucket: t[0] && t[0].bucket };
  });
  check(noReport.bucket === "working", "CP-3 没有 final_report ⇒ 算「在跑」,**不算已完**", noReport.bucket);

  // ── 3. 真渲染:打开面板,DOM 里看得到 ──────────────────────────────────
  await page.evaluate(() => window.__bitbotCommand.open());
  await page.waitForTimeout(500);
  const dom = await page.evaluate(() => {
    const panel = document.getElementById("command-panel");
    const buckets = document.getElementById("cmd-buckets");
    const detail = document.getElementById("cmd-detail");
    return {
      visible: panel && panel.style.display !== "none",
      bucketText: buckets ? buckets.textContent : "",
      detailText: detail ? detail.textContent : "",
      detailHtmlLen: detail ? detail.innerHTML.length : 0,
    };
  });
  check(dom.visible === true, "CP-4 指挥台面板真的显示出来了");
  check(
    dom.bucketText.indexOf("需要你拍板") >= 0 || dom.bucketText.indexOf("Needs you") >= 0,
    "CP-4 四桶标题渲染出来了(默认语种)", dom.bucketText.slice(0, 120)
  );
  check(dom.detailText.indexOf("整理热点稿") >= 0, "CP-4 任务标题在 DOM 里", dom.detailText.slice(0, 160));
  check(dom.detailText.indexOf("Alice") >= 0 && dom.detailText.indexOf("Bob") >= 0,
    "CP-4 成员名字在 DOM 里(看得见谁干了)", dom.detailText.slice(0, 160));

  check(errs.length === 0, "CP-6 页面没有 pageerror", JSON.stringify(errs.slice(0, 3)));

  // ── 5. 【批次 12】指挥台**绑定当前会话**：切群 ⇒ 换一套成员、换一批任务 ──
  //
  // 这是这次改动的**核心**：以前指挥台把所有群混在一张表里 ⇒
  // 不同群的人和事挤在一处，用户根本不知道这个面板是给谁看的。
  // ⇒ 现在进哪个群，指挥台就服务哪个群（成员名单不同、任务不同）。
  {
    /** 点侧栏里的某个群（走真实路径 openRoomChat），再读指挥台当前显示了什么。 */
    const enterRoomAndRead = async (title) => {
      /* 用产品自己的「切到这个群」入口（window.__bitbotCommand.enterRoom）——
         它做的是真事：openRoomChat + 刷新面板。 */
      const entered = await page.evaluate(async (t) => {
        const list = await window.bitbot.rooms.list();
        const payload = (list && list.rooms) || {};
        const rows = Array.isArray(payload) ? payload : payload.rooms || [];
        const hit = rows.find((r) => r && String(r.title || "") === t);
        if (!hit) return null;
        const res = await window.__bitbotCommand.enterRoom(hit.id);
        return res && res.ok ? res : null;
      }, title);
      if (!entered) return null;
      await page.waitForTimeout(400);
      /* 【批次 15】这里原来还有一句 `window.__bitbotCommand.refresh()` ——
         它**正好把「切群不刷新指挥台」这个 bug 盖住了**：
         切完群自己再刷一次 ⇒ 无论 openRoomChat 里刷没刷，面板都是对的
         ⇒ CP-11/CP-12 成了假绿。
         ⇒ 现在**不额外刷** ⇒ 切群后面板对不对，全看 openRoomChat 自己有没有刷新
         （真事故 2026-11-26：那一行写的是 typeof cmdRefresh === "function"，
          而 cmdRefresh 在另一个 IIFE ⇒ 恒为 undefined ⇒ 从来没执行过）。 */
      await page.waitForTimeout(300);
      return await page.evaluate(() => {
        const members = document.getElementById("cmd-members-list");
        const titleEl = document.getElementById("cmd-top-title");
        const detail = document.getElementById("cmd-detail");
        return {
          memberText: members ? members.textContent || "" : "",
          memberCount: members ? members.querySelectorAll(".cmd-member").length : 0,
          title: titleEl ? String(titleEl.textContent || "") : "",
          detailText: detail ? String(detail.textContent || "") : "",
          otherText: (() => {
            const o = document.getElementById("cmd-other-rooms");
            return o && !o.hidden ? String(o.textContent || "") : "";
          })(),
        };
      });
    };

    const rWait = await enterRoomAndRead("闲聊群");
    check(
      rWait && rWait.title.indexOf("闲聊群") >= 0,
      "CP-7 指挥台标题写明是**哪个群**的指挥台", rWait ? rWait.title : "(没进群)"
    );
    check(
      rWait && rWait.memberCount === 1 && rWait.memberText.indexOf("p1") >= 0 &&
        rWait.memberText.indexOf("t1") < 0 && rWait.memberText.indexOf("t2") < 0,
      "CP-8 成员区只显示**这个群**的人（闲聊群只有 Carol，不含内容团队的 Alice/Bob）",
      rWait ? JSON.stringify({ n: rWait.memberCount, text: rWait.memberText.slice(0, 120) }) : "(没进群)"
    );
    check(
      rWait && rWait.detailText.indexOf("今天天气如何") >= 0 &&
        rWait.detailText.indexOf("整理热点稿") < 0,
      "CP-9 任务区只显示**这个群**的事（闲聊群的事在，内容团队的事不在）",
      rWait ? rWait.detailText.slice(0, 160) : "(没进群)"
    );
    check(
      rWait && rWait.otherText.indexOf("整理热点稿") < 0 && rWait.otherText.indexOf("今天天气如何") < 0,
      "CP-10 跨群提醒**只做提醒**（提醒条里是群名+数量，不是别的群的任务标题）",
      rWait ? rWait.otherText.slice(0, 160) : "(没进群)"
    );

    // 切到另一个群 ⇒ 成员必须换掉
    const rDone = await enterRoomAndRead("内容团队");
    check(
      rDone && rDone.memberCount === 2 && rDone.memberText.indexOf("t1") >= 0 &&
        rDone.memberText.indexOf("t2") >= 0 && rDone.memberText.indexOf("p1") < 0,
      "CP-11 切到另一个群 ⇒ 成员区**换了一整套人**（内容团队是 t1+t2，不含闲聊群的 p1）",
      rDone ? JSON.stringify({ n: rDone.memberCount, text: rDone.memberText.slice(0, 120) }) : "(没进群)"
    );
    check(
      rDone && rDone.detailText.indexOf("整理热点稿") >= 0 &&
        rDone.detailText.indexOf("今天天气如何") < 0,
      "CP-12 切到另一个群 ⇒ 任务区也跟着换",
      rDone ? rDone.detailText.slice(0, 160) : "(没进群)"
    );

    /* CP-13 负向对照：**变异掉作用域过滤** ⇒ 成员区必然混进别的群
       ⇒ CP-8 那条判据必须翻红。
       变异只发生在**临时副本**上（源文件一个字节都不动）。 */
    {
      const src = fs.readFileSync(HTML, "utf8") + "\n" + fs.readFileSync(path.resolve(__dirname, "..", "hosts", "desktop", "command_center.js"), "utf8");
      const marker = 'CMD_STATE.tasks = scope.kind === "room"';
      const at = src.indexOf(marker);
      if (at < 0) {
        bad("CP-13 负向对照跑不起来（注入点找不到：源码结构变了）");
      } else {
        // 把「按作用域过滤」改成「不过滤」⇒ 别的群的任务会混进来。
        const mutated = src.replace(
          'CMD_STATE.tasks = scope.kind === "room"\n          ? allTasks.filter(function (t) {\n              return t && String(t.room_id || "") === scope.id;\n            })\n          : allTasks;',
          "CMD_STATE.tasks = allTasks;",
        );
        if (mutated === src) {
          bad("CP-13 负向对照跑不起来（替换没命中：源码形态变了）");
        } else {
          /* 变异副本必须放**同目录**：index.html 里的 CSS/JS 都是相对引用
             ⇒ 放 /tmp 会全部加载不到 ⇒ 页面只剩壳，功能全失（实测踩到）。
             同目录 + 用完删除 ⇒ 源文件一个字节不动。 */
          const tmpHtml = path.join(path.dirname(HTML), ".negative_control_cmd_panel.html");
          fs.writeFileSync(tmpHtml, mutated, "utf8");
          try {
            const mPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            const mErrs = [];
            mPage.on("pageerror", (e) => mErrs.push(String((e && e.message) || "").split("\n")[0]));
            await mPage.addInitScript((rooms) => {
              window.bitbot = Object.assign(window.bitbot || {}, { rooms: { list: async () => rooms } });
            }, fakeRooms());
            await mPage.goto("file://" + tmpHtml, { waitUntil: "load" });
            await mPage.waitForTimeout(900);
            const mRes = await mPage.evaluate(async () => {
              const list = await window.bitbot.rooms.list();
              const payload = (list && list.rooms) || {};
              const rows = Array.isArray(payload) ? payload : payload.rooms || [];
              const hit = rows.find((r) => r && r.title === "闲聊群");
              if (!hit) return { ok: false };
              await window.__bitbotCommand.enterRoom(hit.id);
              await window.__bitbotCommand.refresh();
              await new Promise((r) => setTimeout(r, 400));
              const members = document.getElementById("cmd-members-list");
              const detail = document.getElementById("cmd-detail");
              return {
                ok: true,
                memberText: members ? members.textContent || "" : "",
                detailText: detail ? String(detail.textContent || "") : "",
              };
            });
            // 变异后：别的群（内容团队）的事会混进「闲聊群」的指挥台 ⇒ 判红。
            const leaked =
              (mRes.detailText || "").indexOf("整理热点稿") >= 0 ||
              (mRes.memberText || "").indexOf("t1") >= 0 ||
              (mRes.memberText || "").indexOf("t2") >= 0;
            check(
              mRes.ok === true && leaked,
              "CP-13 负向对照有牙：掐掉作用域过滤 ⇒ 别的群混进来 ⇒ CP-8/CP-9 的判据确实会红",
              JSON.stringify({ ok: mRes.ok, leaked, member: (mRes.memberText || "").slice(0, 80) })
            );
            await mPage.close();
          } catch (e) {
            bad("CP-13 负向对照跑不起来", String((e && e.message) || e).slice(0, 200));
          } finally {
            try { fs.unlinkSync(tmpHtml); } catch (_) { /* ignore */ }
          }
        }
      }
    }

    /* CP-14 / CP-15 负向对照：**掐掉「切群时刷新指挥台」** ⇒ CP-11 的判据必然翻红。
       真事故（2026-11-26）：那一行写的是 `typeof cmdRefresh === "function"`，
       而 cmdRefresh 定义在**另一个 IIFE** ⇒ 在本作用域里 typeof 恒为 "undefined"
       ⇒ 这一行**从来没执行过** ⇒ 指挥台开着的时候切群，看到的还是上一个群的数据。
       ⇒ 变异只发生在**临时副本**上（源文件一个字节都不动）。

       手法：**同一套操作跑两遍**，两个页面只差那一行 ——
         · 对照组（真源码）：进「闲聊群」→ 刷一次 → 切「内容团队」⇒ 成员区换成 t1/t2
           ⇒ CP-11 的判据成立（绿）
         · 变异组（掐掉刷新）：同样的操作 ⇒ 成员区**还停在闲聊群的人**（Carol/p1）
           ⇒ CP-11 的判据不成立（红）
       两组都**先刷一次再切群**（模拟「用户开着指挥台，屏上已经有上一个群的数据」）
       ⇒ 变异组才是真正的「停在旧数据」；否则它只是「面板从没填过」（空），
       那是另一种失败，不能拿来当这条负向对照的证据。
       ⚠️ 门禁纪律：**判据不许只写「不是新的」**（空面板也能满足）⇒ 必须同时钉住
       「旧数据还在」+「新数据没来」。 */
    {
      /* 两组共用的探针：进闲聊群 → 刷一次 → 切内容团队 → 读成员区。 */
      const probe = async (pg) => await pg.evaluate(async () => {
        const list = await window.bitbot.rooms.list();
        const payload = (list && list.rooms) || {};
        const rows = Array.isArray(payload) ? payload : payload.rooms || [];
        const go = async (title) => {
          const hit = rows.find((r) => r && String(r.title || "") === title);
          if (!hit) return false;
          await window.__bitbotCommand.enterRoom(hit.id);
          return true;
        };
        const read = () => {
          const el = document.getElementById("cmd-members-list");
          return {
            count: el ? el.querySelectorAll(".cmd-member").length : 0,
            text: el ? String(el.textContent || "") : "",
          };
        };
        await go("闲聊群");
        await new Promise((r) => setTimeout(r, 500));
        /* 面板已经开着、屏上已经有「闲聊群」的人 */
        await window.__bitbotCommand.refresh();
        await new Promise((r) => setTimeout(r, 300));
        const before = read();
        await go("内容团队");
        await new Promise((r) => setTimeout(r, 800));
        const after = read();
        /* CP-11 的判据，原样搬过来（变异体上它必须不成立）。 */
        const cp11 =
          after.count === 2 &&
          after.text.indexOf("t1") >= 0 &&
          after.text.indexOf("t2") >= 0 &&
          after.text.indexOf("p1") < 0;
        return {
          beforeCount: before.count,
          beforeText: before.text.slice(0, 80),
          count: after.count,
          text: after.text.slice(0, 120),
          cp11: cp11,
          stale: after.text.indexOf("Carol") >= 0 || after.text.indexOf("p1") >= 0,
        };
      });

      const src = fs.readFileSync(HTML, "utf8") + "\n" + fs.readFileSync(path.resolve(__dirname, "..", "hosts", "desktop", "command_center.js"), "utf8");
      const target =
        'var cmdApi = window.__bitbotCommand;\n' +
        '        if (cmdApi && typeof cmdApi.refresh === "function") await cmdApi.refresh();';
      if (src.indexOf(target) < 0) {
        bad("CP-14 负向对照跑不起来（注入点找不到：源码结构变了）");
      } else {
        const mutated = src.replace(
          target,
          'var cmdApi = window.__bitbotCommand;\n' +
            '        /* 变异：切群时不刷新指挥台 */'
        );
        if (mutated === src) {
          bad("CP-14 负向对照跑不起来（替换没命中：源码形态变了）");
        } else {
          /* 变异副本必须放**同目录**：index.html 里的 CSS/JS 都是相对引用
             ⇒ 放 /tmp 会全部加载不到 ⇒ 页面只剩壳，功能全失（实测踩到）。 */
          const tmpHtml = path.join(path.dirname(HTML), ".negative_control_cmd_panel_roomswitch.html");
          fs.writeFileSync(tmpHtml, mutated, "utf8");
          let ctlRes = null, mutRes = null;
          try {
            /* 对照组：真源码，同一套操作。 */
            const cPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            await cPage.addInitScript((rooms) => {
              window.bitbot = Object.assign(window.bitbot || {}, { rooms: { list: async () => rooms } });
            }, fakeRooms());
            await cPage.goto("file://" + HTML, { waitUntil: "load" });
            await cPage.waitForTimeout(900);
            ctlRes = await probe(cPage);
            await cPage.close();

            /* 变异组：只差那一句刷新。 */
            const mPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
            await mPage.addInitScript((rooms) => {
              window.bitbot = Object.assign(window.bitbot || {}, { rooms: { list: async () => rooms } });
            }, fakeRooms());
            await mPage.goto("file://" + tmpHtml, { waitUntil: "load" });
            await mPage.waitForTimeout(900);
            mutRes = await probe(mPage);
            await mPage.close();
          } catch (e) {
            bad("CP-14 负向对照跑不起来", String((e && e.message) || e).slice(0, 200));
          } finally {
            try { fs.unlinkSync(tmpHtml); } catch (_) { /* ignore */ }
          }

          /* 对照组：真源码 ⇒ 切群后确实换成内容团队的人（CP-11 判据成立）。
             这一条同时证明**探针本身是有效的**（不是恒假、也不是恒真）。 */
          check(
            ctlRes && ctlRes.cp11 === true,
            "CP-14 对照组（真源码）：切群后成员区换成内容团队的人 ⇒ 探针有效",
            ctlRes ? JSON.stringify(ctlRes) : "(对照组没跑起来)"
          );
          /* 变异组：判据不成立 **且** 旧数据还在（不是空面板糊弄过去）。 */
          check(
            mutRes && mutRes.cp11 === false && mutRes.stale === true,
            "CP-15 变异组有牙：掐掉切群时的刷新 ⇒ 成员区停在上一个群 ⇒ CP-11 的判据确实会红",
            mutRes ? JSON.stringify(mutRes) : "(变异组没跑起来)"
          );
        }
      }
    }
  }

  // ── 6. 负向:没有数据 ⇒ 「还没有任务」,不编 ───────────────────────────
  // （放在最后：它会把 rooms.list 换成空的 ⇒ 前面那些断言要先跑完。）
  await page.evaluate(() => {
    window.bitbot.rooms.list = async () => ({ rooms: { version: 1, rooms: [] } });
  });
  await page.evaluate(() => window.__bitbotCommand.refresh());
  await page.waitForTimeout(300);
  const empty = await page.evaluate(() => {
    const d = document.getElementById("cmd-detail");
    return d ? d.textContent : "";
  });
  check(
    empty.indexOf("还没有任务") >= 0 || empty.indexOf("No tasks yet") >= 0 ||
      empty.indexOf("这个团队还没有任务") >= 0 || empty.indexOf("This team has no tasks yet") >= 0,
    "CP-5 没有任务时显示空态,**不编**",
    empty.slice(0, 120)
  );

  await browser.close();
  console.log("\nprove_command_panel: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_command_panel: " + String((e && e.stack) || e));
  console.log("\nprove_command_panel: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
