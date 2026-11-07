#!/usr/bin/env node
"use strict";

/**
 * prove_room_relay — 群任务「单负责人 + 串行接力 + 产物 + 停下确认」（G-110）
 *
 * 用户的诉求原话：
 *   「按正常不是一个团队协作？为什么一堆活就全部 bot 开始工作？而不是针对对话
 *     内容，分配给某一个 bot，然后一步一步的进行协作，最后输出按要求的产物
 *    （如果中间某一个 bot 有不明确的就停下来进行确认之后再继续的哦）」
 *
 * 这份门禁证明的就是那四件事，全部走**产品路径**（dispatchRoomTurn →
 * roomTurn → orchestrateRoom），只把「跑一个模型回合」换成假 runner：
 *
 *   A. 一次只跑一个：4 人群发一句普通任务 → runResponderTurn **恰好 1 次**，
 *      且是内容最匹配的那一位；不再全员并发。
 *   B. 串行接力：第一棒写【交给】X → 第二棒才开跑，且它收到的 prompt 里
 *      带着第一棒的成果（previous_turn / 【上一棒】）。
 *   C. 产物落盘：跑完在 data/desktop/room-deliverables/<room>/ 下真有 .md 文件，
 *      内容含最后一棒的正文，final_report.deliverable 指向它。
 *   D. 遇不明就停：成员写【需要确认】→ 本轮**不发 final_report、不写产物**，
 *      群里落 confirm_request；用户答一句后回到**同一个** Bot，带着答复继续。
 *   E. 路由不明也停：看不出该谁做 → 一个 Bot 都不跑，先问用户。
 *   F. 旧路径没被破坏：显式 @ 两人仍按点名扇出（用户点名就是用户的决定）。
 *
 * 负向对照（必须能红）：把「一次只跑一个」换回旧的全员并发（concurrency =
 * 成员数），A 会立刻变红 —— 见 --inject-fanout。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");
const { dispatchRoomTurn } = require("../hosts/shared/room_dispatch");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const BOTS = {
  version: 1,
  primary_id: "b1",
  bots: [
    { id: "b1", name: "选题策划", job: "选题", description: "负责选题与受众分析，判断什么题值得做", hidden: false },
    { id: "b2", name: "脚本撰写", job: "脚本", description: "把选题写成短视频口播脚本，控制节奏与时长", hidden: false },
    { id: "b3", name: "事实核查", job: "核查", description: "核对数据与引用，标注不确定的说法", hidden: false },
    { id: "b4", name: "分发运营", job: "分发", description: "决定发到哪些平台，写标题与话题标签", hidden: false },
  ],
};
const ROOMS = {
  version: 1,
  rooms: [{
    id: "room-relay",
    title: "自媒体内容团队",
    members: ["b1", "b2", "b3", "b4"],
    created_at: "t",
    transcript: [],
  }],
};

function mkSurface() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-"));
  const dir = path.join(root, "data", "desktop");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bots.json"), JSON.stringify(BOTS));
  fs.writeFileSync(path.join(dir, "rooms.json"), JSON.stringify(ROOMS));
  return { surface: createProductSurface(root), root };
}
const txOf = (surface, id = "room-relay") =>
  (surface.loadRooms().rooms.find((r) => r.id === id) || {}).transcript || [];
const kinds = (t) => t.map((e) => e && e.kind);

(async () => {
  console.log("prove_room_relay — 群任务：单负责人 / 串行接力 / 产物 / 停下确认");

  /* ---------- A. 一次只跑一个 ---------- */
  {
    const { surface } = mkSurface();
    const calls = [];
    const r = await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "写一条关于绿色低碳的短视频脚本，3分钟以内",
      deps: {
        runResponderTurn: async (botId, prompt, ctx) => {
          calls.push({ botId, prompt, ctx });
          return { ok: true, text: "口播稿正文：……（第一版）" };
        },
      },
    });
    (r && r.ok && calls.length === 1 && calls[0].botId === "b2")
      ? ok("A 一句普通任务只跑 1 个成员（脚本撰写），不是 4 个一起上")
      : bad("A single owner", JSON.stringify({ ok: r && r.ok, calls: calls.map((c) => c.botId), err: r && r.error }));
    const fr = txOf(surface).find((e) => e.kind === "final_report");
    (fr && fr.route && fr.route.mode === "content_match" && fr.route.owner === "b2")
      ? ok("A final_report 记下路由依据：content_match → 脚本撰写")
      : bad("A route persisted", JSON.stringify(fr && fr.route));
    // 负向：不该出现「别人也在回」
    const replies = txOf(surface).filter((e) => e.kind === "bot_reply");
    (replies.length === 1 && replies[0].bot_id === "b2" && replies[0].hop === 0)
      ? ok("A 转录里只有一条 bot_reply（speaker=脚本撰写，hop=0），其余成员一个字都没写")
      : bad("A only one reply row", JSON.stringify(replies.map((x) => [x.bot_id, x.hop])));
  }

  /* ---------- B. 串行接力：上一棒交给下一棒 ---------- */
  {
    const { surface } = mkSurface();
    const calls = [];
    const r = await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "写一条关于绿色低碳的短视频脚本，3分钟以内",
      deps: {
        runResponderTurn: async (botId, prompt, ctx) => {
          calls.push({ botId, prompt, ctx });
          if (botId === "b2") {
            return { ok: true, text: "选题定了：园区光伏。提纲三条。\n【交给】事实核查：把光伏装机数据核准一下" };
          }
          return { ok: true, text: "数据已核准：2024 年园区光伏装机 3.2MW（来源：园区年报）。" };
        },
      },
    });
    (r && r.ok && calls.length === 2 && calls[0].botId === "b2" && calls[1].botId === "b3")
      ? ok("B 两棒串行：脚本撰写 → 事实核查（第二棒在第一棒交出去之后才开跑）")
      : bad("B serial relay", JSON.stringify(calls.map((c) => c.botId)));
    const second = calls[1] || {};
    (second.ctx && second.ctx.hop === 1 &&
      second.ctx.previous_turn && second.ctx.previous_turn.bot_id === "b2" &&
      /【上一棒】/.test(String(second.prompt || "")) &&
      String(second.prompt || "").includes("园区光伏"))
      ? ok("B 第二棒的 prompt 带着第一棒的成果（【上一棒】+ previous_turn）")
      : bad("B handoff context", JSON.stringify({ hop: second.ctx && second.ctx.hop, prev: second.ctx && second.ctx.previous_turn }));
    const fr = txOf(surface).find((e) => e.kind === "final_report");
    (fr && Array.isArray(fr.relay) && fr.relay.length === 2 &&
      fr.relay[0].handoff_to === "b3" && fr.relay[1].ok)
      ? ok("B final_report.relay 记下棒次与交接对象（谁交给谁）")
      : bad("B relay record", JSON.stringify(fr && fr.relay));
    (fr && fr.total === 2 && fr.returned === 2 && fr.partial === false)
      ? ok("B 收齐 2/2，partial=false（不虚报也不漏报）")
      : bad("B counts", JSON.stringify(fr && { total: fr.total, returned: fr.returned }));
  }

  /* ---------- C. 产物真落盘 ---------- */
  {
    const { surface } = mkSurface();
    await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "写一条关于绿色低碳的短视频脚本，3分钟以内",
      deps: {
        runResponderTurn: async () => ({ ok: true, text: "成稿：开场 3 秒抛出园区光伏的对比数字……" }),
      },
    });
    const fr = txOf(surface).find((e) => e.kind === "final_report");
    const d = fr && fr.deliverable;
    const exists = d && d.path && fs.existsSync(d.path);
    const body = exists ? fs.readFileSync(d.path, "utf8") : "";
    (exists && d.bytes > 0 && /\.md$/.test(d.name) && String(d.name).length > 3)
      ? ok("C 产物是真文件，且 deliverable 三件齐全（名字/路径/字节）：" + (d && d.name) + "（" + (d && d.bytes) + " 字节）")
      : bad("C deliverable file", JSON.stringify(d));
    (body.includes("## 交付内容") && body.includes("园区光伏的对比数字"))
      ? ok("C 产物正文含最后一棒的成果，不是一句「我做到了」")
      : bad("C deliverable body", body.slice(0, 200));
    /* 产物只在汇报卡上露一次（渲染层直接读 final_report.deliverable 画那一行）。
       转录里再补一条同义系统行就是同一件事说两遍，会把群消息流撑长；空白的系统行
       更是纯噪声。这里反向钉住：不许有。 */
    const sysAll = txOf(surface).filter((e) => e.kind === "system");
    const dup = sysAll.filter((e) => /产物/.test(String(e.text || "")));
    (sysAll.every((e) => String(e.text || "").trim()) && dup.length === 0)
      ? ok("C 产物不在群里重复说一遍（卡上那一行是唯一出口），也没有空白的系统行")
      : bad("C duplicate deliverable notice", JSON.stringify(sysAll.map((s) => s.text)));
  }

  /* ---------- D. 遇不明就停：confirm_request → 用户答复 → 回到同一个 Bot ---------- */
  {
    const { surface } = mkSurface();
    const calls = [];
    const first = await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "写一条关于绿色低碳的短视频脚本，3分钟以内",
      deps: {
        runResponderTurn: async (botId, prompt, ctx) => {
          calls.push({ botId, prompt, ctx });
          return { ok: true, text: "先确认一下。\n【需要确认】你说的是园区自己的案例，还是行业通用案例？" };
        },
      },
    });
    const t1 = txOf(surface);
    (first && first.ok && first.paused === true && calls.length === 1)
      ? ok("D 成员说要确认 → 本轮停在第一棒（paused=true），没有继续往下传")
      : bad("D paused", JSON.stringify({ ok: first && first.ok, paused: first && first.paused, calls: calls.length }));
    const q = t1.find((e) => e.kind === "confirm_request");
    (q && q.stage === "member" && q.bot_id === "b2" && /园区自己的案例/.test(String(q.question || "")))
      ? ok("D 群里落了一张 confirm_request 卡：脚本撰写问「园区还是行业」")
      : bad("D confirm row", JSON.stringify(q && { stage: q.stage, bot: q.bot_id, q: q.question }));
    (t1.filter((e) => e.kind === "final_report").length === 0 && !first.final_report)
      ? ok("D 停下时**不写** final_report（没跑完就不宣布跑完）")
      : bad("D no final_report while paused", JSON.stringify(kinds(t1)));
    (first.deliverable === null)
      ? ok("D 停下时不产出产物（没内容就不造文件）")
      : bad("D no deliverable while paused", JSON.stringify(first.deliverable));

    // 用户答一句 → 回到同一个 Bot，并把答复带进 prompt
    calls.length = 0;
    const second = await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "用园区自己的案例",
      deps: {
        runResponderTurn: async (botId, prompt, ctx) => {
          calls.push({ botId, prompt, ctx });
          return { ok: true, text: "成稿：以园区光伏为例……" };
        },
      },
    });
    (second && second.ok && calls.length === 1 && calls[0].botId === "b2")
      ? ok("D 用户答一句 → 回到**同一个** Bot（脚本撰写）继续，不重新路由给别人")
      : bad("D resume owner", JSON.stringify(calls.map((c) => c.botId)));
    (/【你的上一问的答复】用园区自己的案例/.test(String((calls[0] || {}).prompt || "")))
      ? ok("D 答复原文进了下一棒的 prompt（【你的上一问的答复】）")
      : bad("D answer in prompt", String((calls[0] || {}).prompt || "").slice(0, 200));
    const answered = txOf(surface).find((e) => e.kind === "confirm_request");
    (answered && answered.answered_at && answered.answer === "用园区自己的案例")
      ? ok("D 那张卡被标记已答复（同一问不会被再问第二遍）")
      : bad("D mark answered", JSON.stringify(answered && { at: answered.answered_at, a: answered.answer }));
  }

  /* ---------- E. 路由不明：一个 Bot 都不跑，先问用户 ---------- */
  {
    const { surface } = mkSurface();
    let ran = 0;
    const r = await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "帮我核对一下上一条脚本里的碳排放数字",
      deps: { runResponderTurn: async () => { ran += 1; return { ok: true, text: "x" }; } },
    });
    const t = txOf(surface);
    const q = t.find((e) => e.kind === "confirm_request");
    (r && r.ok && r.paused === true && ran === 0 && q && q.stage === "route")
      ? ok("E 两人一样像 → 一个 Bot 都不跑，先问「要谁来做」")
      : bad("E unclear route", JSON.stringify({ paused: r && r.paused, ran, stage: q && q.stage }));
    (q && Array.isArray(q.candidates) && q.candidates.length === 4)
      ? ok("E 问题里带候选名单（用户回一个名字就能继续，不用猜我们认不认）")
      : bad("E candidates", JSON.stringify(q && q.candidates));

    // 用户回一个名字 → 这一轮真的开工，且派的就是被点名的那位
    const calls = [];
    const resumed = await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "事实核查",
      deps: {
        runResponderTurn: async (botId) => {
          calls.push(botId);
          return { ok: true, text: "核完了：这个数字出自园区 2024 年报第 12 页。" };
        },
      },
    });
    (resumed && resumed.ok && calls.length === 1 && calls[0] === "b3" &&
      resumed.final_report && resumed.final_report.route.owner === "b3")
      ? ok("E 用户回「事实核查」→ 不再追问，直接派给事实核查（route.owner=b3）")
      : bad("E resume by name", JSON.stringify({ calls, route: resumed && resumed.final_report && resumed.final_report.route }));
    const answeredRoute = txOf(surface).find((e) => e.kind === "confirm_request" && e.stage === "route");
    (answeredRoute && answeredRoute.answered_at && answeredRoute.answer === "事实核查")
      ? ok("E 那张「该谁做」的卡被标已答复（同一问不会再问第二遍）")
      : bad("E route confirm answered", JSON.stringify(answeredRoute && { at: answeredRoute.answered_at, a: answeredRoute.answer }));
  }

  /* ---------- F. 旧路径没被破坏：显式点名仍是点名 ---------- */
  {
    const { surface } = mkSurface();
    const ran = [];
    const r = await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "@选题策划 @脚本撰写 一起把这条脚本过一遍",
      deps: { runResponderTurn: async (botId) => { ran.push(botId); return { ok: true, text: botId + " ok" }; } },
    });
    (r && r.ok && ran.length === 2 && ran.includes("b1") && ran.includes("b2"))
      ? ok("F 用户显式 @ 两个人 → 仍按点名执行 2 位（用户点名的就是用户的决定）")
      : bad("F explicit mentions", JSON.stringify(ran));
  }

  /* ---------- I. 显式点名这条路径也要有产物（并列，不是「最后一棒」） ---------- */
  {
    const { surface } = mkSurface();
    await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "@选题策划 @脚本撰写 各自给一版方案",
      deps: {
        runResponderTurn: async (botId) =>
          botId === "b1"
            ? { ok: true, text: "选题方案：园区光伏对比，三条理由，面向园区管理者。" }
            : { ok: true, text: "脚本方案：开场 3 秒抛数字，第 8 秒给结论，全程口播。" },
      },
    });
    const fr = txOf(surface).find((e) => e.kind === "final_report");
    const d = fr && fr.deliverable;
    const body = d && d.path && fs.existsSync(d.path) ? fs.readFileSync(d.path, "utf8") : "";
    (d && d.bytes > 0 && body.includes("选题方案") && body.includes("脚本方案"))
      ? ok("I @两个人 → 也产出一份文件，两人的成果**并列**在交付内容里（谁写的都留着）")
      : bad("I parallel deliverable", JSON.stringify({ d, head: body.slice(0, 160) }));
  }

  /* ---------- J. 一句话的短答复不产文件（不制造垃圾 .md） ---------- */
  {
    const { surface } = mkSurface();
    await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "标题和话题标签再想想",
      deps: { runResponderTurn: async () => ({ ok: true, text: "好。" }) },
    });
    const fr = txOf(surface).find((e) => e.kind === "final_report");
    (fr && fr.deliverable === undefined && fr.deliverable_skipped === "too_short" && fr.partial === false)
      ? ok("J 答复只有一句「好。」→ 不落 .md（deliverable_skipped=too_short），但这一轮不算 partial")
      : bad("J too short", JSON.stringify(fr && {
          d: fr.deliverable, skip: fr.deliverable_skipped, partial: fr.partial,
        }));
  }

  /* ---------- G. 一个人不跑第二棒（防踢皮球） ---------- */
  {
    const { surface } = mkSurface();
    const ran = [];
    await dispatchRoomTurn({
      surface,
      roomId: "room-relay",
      text: "写一条关于绿色低碳的短视频脚本，3分钟以内",
      deps: {
        runResponderTurn: async (botId) => {
          ran.push(botId);
          if (botId === "b2") return { ok: true, text: "提纲如下。\n【交给】事实核查：核数" };
          if (botId === "b3") return { ok: true, text: "数核完了。\n【交给】脚本撰写：继续" };
          return { ok: true, text: "x" };
        },
      },
    });
    (ran.length === 2 && ran[0] === "b2" && ran[1] === "b3")
      ? ok("G A→B→A 的踢皮球被拦住：同一个人不会跑第二棒（最多 2 次调用）")
      : bad("G no ping-pong", JSON.stringify(ran));
  }

  /* ---------- H. 负向对照：把「一次只跑一个」换回旧的全员并发，A 必须变红 ----------
     做法不是「再断言一遍」，而是**真的换实现**：读当前 product_surface 源码，
     把 auto_route 关掉、把默认策略改回 bot_discretion，保存成同目录的临时模块
     （相对 require 才能解析），再用同一套 A 的判据跑一次 —— 必须看到 4 个成员
     全被唤醒。这一步证明 A 的「1 次」是引擎行为，不是计数器失灵。 */
  {
    const srcPath = require.resolve("../hosts/desktop/product_surface");
    const raw = fs.readFileSync(srcPath, "utf8");
    const mutated = raw
      .replace('const isRelay = responderPolicy === "auto_route";', "const isRelay = false;")
      .replace('let responder_policy = "auto_route";', 'let responder_policy = "bot_discretion";');
    const hitCtrl = mutated !== raw && /const isRelay = false;/.test(mutated) && /bot_discretion";/.test(mutated);
    if (!hitCtrl) {
      bad("H 负向对照：注入点找不到（源码结构变了，这条对照失效了）");
    } else {
      const tmpPath = path.join(path.dirname(srcPath), ".negative_control_surface.js");
      fs.writeFileSync(tmpPath, mutated, "utf8");
      try {
        delete require.cache[tmpPath];
        const { createProductSurface: broken } = require(tmpPath);
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-neg-"));
        const dir = path.join(root, "data", "desktop");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "bots.json"), JSON.stringify(BOTS));
        fs.writeFileSync(path.join(dir, "rooms.json"), JSON.stringify(ROOMS));
        const surface = broken(root);
        const calls = [];
        await dispatchRoomTurn({
          surface,
          roomId: "room-relay",
          text: "写一条关于绿色低碳的短视频脚本，3分钟以内",
          deps: {
            // 旧路径的必要依赖：每个成员自己表态要不要答 —— 这里让它「全员都答」。
            selectResponders: async ({ candidates }) => ({
              ok: true,
              responders: candidates.map((c) => c.id),
              decisions: candidates.map((c) => ({ bot_id: c.id, name: c.name, respond: true })),
            }),
            runResponderTurn: async (botId) => { calls.push(botId); return { ok: true, text: botId + " ok" }; },
          },
        });
        (calls.length === 4)
          ? ok("H 负向对照成立：换回旧的「全员并发」后同一句话唤醒 4 个成员 → A 的判据确实会红")
          : bad("H negative control did not fan out", JSON.stringify(calls));
      } finally {
        try { fs.unlinkSync(tmpPath); } catch (_) { /* 清理失败不影响结论 */ }
      }
    }
  }

  console.log(`\nprove_room_relay: PASS=${pass} FAIL=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.log("FATAL " + ((e && e.stack) || e));
  process.exit(1);
});
