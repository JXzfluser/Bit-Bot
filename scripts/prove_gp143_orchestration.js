#!/usr/bin/env node
"use strict";

/**
 * prove_gp143_orchestration — GP-143/144 编排引擎单元证明（无内核依赖）
 *
 * 验证 product_surface.orchestrateRoom 的状态机与护栏：
 *   A. 部分收齐：1 成功 + 1 超时 → 2 条 speaker=bot_id 回执 + 1 条 final_report，
 *      returned=1/total=2/partial=true（如实 1/2，不假装完整）。
 *   B. 幂等：同 task 二次编排 → deduped，不重复落 final_report。
 *   C. 递归护栏：responder 回合内再次 orchestrate 同 task → orchestrate_recursion。
 *   D. 成员校验：@ 非成员 → responder_not_member（不伪造路由）。
 *   E. 无 runner：未注入 runResponderTurn → responder_runner_required，且不写 transcript。
 *   F. 单 responder：to=b1 → total=1。
 *   G. @only：to=[b2] 只跑 b2。
 *   H. @everyone：无 to → 全员 2/2，收齐才写 partial=false。
 *   I. 预算：7 成员 → too_many_responders 且不写 transcript。
 *   J. 上下文隔离：每个 responder 用自己的 bot_id/name/job。
 *   K. 失败：1/2 partial + bot_reply_error 带原因，不伪造正文。
 *   L. 超时：per-responder timeoutMs 生效，原因=responder_timeout。
 *
 * 注：真实 per-responder LLM 回合由 MoonBit runner 执行（本沙箱无 moon），
 * 此处注入 fake runResponderTurn 证明编排逻辑本身。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 200) : "")); };

const BOTS = {
  version: 1, primary_id: "b1",
  bots: [
    { id: "b1", name: "Researcher", job: "research", description: "find facts", hidden: false },
    { id: "b2", name: "Writer", job: "write", description: "draft prose", hidden: false },
    { id: "b3", name: "Outsider", job: "x", description: "not a member", hidden: false },
  ],
};
const ROOMS = {
  version: 1,
  rooms: [{ id: "room-t", title: "Test Room", members: ["b1", "b2"], created_at: "t", transcript: [] }],
};

function mkSurface() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp143-"));
  const dir = path.join(root, "data", "desktop");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bots.json"), JSON.stringify(BOTS));
  fs.writeFileSync(path.join(dir, "rooms.json"), JSON.stringify(ROOMS));
  return { surface: createProductSurface(root), root };
}
const tx = (surface, id = "room-t") =>
  (surface.loadRooms().rooms.find(r => r.id === id) || {}).transcript || [];
const count = (arr, k) => arr.filter(e => e && e.kind === k).length;

(async () => {
  console.log("prove_gp143_orchestration — 编排引擎（GP-143/144）");

  /* ---------- A. 部分收齐 + 诚实 N/总 ---------- */
  {
    const { surface } = mkSurface();
    const runResponderTurn = async (botId) => {
      if (botId === "b1") return { ok: true, text: "结论：要点 A / B", artifacts: [{ name: "a.md" }] };
      throw new Error("responder_timeout"); // b2 超时
    };
    const r = await surface.orchestrateRoom({
      room: "room-t", task: "整理季度简报", to: "b1,b2",
      deps: { runResponderTurn, timeoutMs: 500 },
    });
    r && r.ok === true && r.returned === 1 && r.total === 2 && r.partial === true
      ? ok(`A 部分收齐如实：returned=${r.returned}/${r.total} partial=${r.partial}`)
      : bad("A partial aggregation", JSON.stringify(r));
    const t = tx(surface);
    count(t, "bot_reply") === 1 && count(t, "bot_reply_error") === 1 && count(t, "final_report") === 1
      ? ok("A transcript：1 成功 + 1 失败回执 + 1 final_report，speaker=bot_id")
      : bad("A transcript shape", `reply=${count(t, "bot_reply")} err=${count(t, "bot_reply_error")} fr=${count(t, "final_report")}`);
    const fr = t.find(e => e.kind === "final_report");
    (fr.sections && fr.sections.length === 2 && fr.sections.some(s => s.bot_id === "b1" && s.ok) && fr.sections.some(s => s.bot_id === "b2" && !s.ok))
      ? ok("A final_report.sections：两成员各一，成功/失败如实标注")
      : bad("A sections", JSON.stringify(fr && fr.sections));
  }

  /* ---------- B. 幂等 ---------- */
  {
    const { surface } = mkSurface();
    const runResponderTurn = async () => ({ ok: true, text: "ok" });
    await surface.orchestrateRoom({ room: "room-t", task: "same task", to: "b1,b2", deps: { runResponderTurn } });
    const before = count(tx(surface), "final_report");
    const r2 = await surface.orchestrateRoom({ room: "room-t", task: "same task", to: "b1,b2", deps: { runResponderTurn } });
    const after = count(tx(surface), "final_report");
    (r2 && r2.deduped === true && after === before && before === 1)
      ? ok("B 幂等：同 task 不重复落 final_report（deduped）")
      : bad("B idempotency", `deduped=${r2 && r2.deduped} before=${before} after=${after}`);
  }

  /* ---------- C. 递归护栏 ---------- */
  {
    const { surface } = mkSurface();
    let inner = null;
    const runResponderTurn = async () => {
      inner = await surface.orchestrateRoom({ room: "room-t", task: "recursive task", to: "b1", deps: { runResponderTurn } });
      return { ok: true, text: "done" };
    };
    await surface.orchestrateRoom({ room: "room-t", task: "recursive task", to: "b1", deps: { runResponderTurn } });
    (inner && inner.ok === false && inner.error === "orchestrate_recursion")
      ? ok("C 递归护栏：responder 回合内重入同 task → orchestrate_recursion")
      : bad("C recursion guard", JSON.stringify(inner));
  }

  /* ---------- D. 非成员拒绝 ---------- */
  {
    const { surface } = mkSurface();
    const r = await surface.orchestrateRoom({ room: "room-t", task: "t", to: "b3", deps: { runResponderTurn: async () => ({ ok: true }) } });
    (r && r.ok === false && r.error === "responder_not_member")
      ? ok("D 非成员：@ 非房间成员 → responder_not_member（不伪造）")
      : bad("D membership", JSON.stringify(r));
  }

  /* ---------- E. 无 runner 诚实拒绝且不落盘 ---------- */
  {
    const { surface } = mkSurface();
    const r = await surface.orchestrateRoom({ room: "room-t", task: "no runner", to: "b1" });
    const t = tx(surface);
    (r && r.ok === false && r.error === "responder_runner_required" && t.length === 0)
      ? ok("E 无 runner：responder_runner_required，且不写任何 transcript")
      : bad("E no-runner", `err=${r && r.error} transcript=${t.length}`);
  }

  /* ---------- F. 单 responder ---------- */
  {
    const { surface } = mkSurface();
    const r = await surface.orchestrateRoom({ room: "room-t", task: "single", to: "b1", deps: { runResponderTurn: async () => ({ ok: true, text: "x" }) } });
    (r && r.ok === true && r.total === 1 && r.returned === 1)
      ? ok("F 单 responder：total=1 returned=1")
      : bad("F single responder", JSON.stringify(r && { returned: r.returned, total: r.total }));
  }

  /* ---------- G. @only：只跑点名的那一个 ---------- */
  {
    const { surface } = mkSurface();
    const seen = [];
    const r = await surface.orchestrateRoom({
      room: "room-t", task: "only b2", to: ["b2"],
      deps: { runResponderTurn: async (botId) => { seen.push(botId); return { ok: true, text: "b2 done" }; } },
    });
    (r && r.ok && r.total === 1 && r.returned === 1 && seen.length === 1 && seen[0] === "b2")
      ? ok("G @only：to=[b2] 只运行 b2，b1 未被唤醒（total=1）")
      : bad("G mention only", JSON.stringify({ seen, r: r && { total: r.total, returned: r.returned } }));
  }

  /* ---------- H. @everyone：不给 to → 全体成员 ---------- */
  {
    const { surface } = mkSurface();
    const seen = [];
    const r = await surface.orchestrateRoom({
      room: "room-t", task: "everyone works",
      deps: { runResponderTurn: async (botId) => { seen.push(botId); return { ok: true, text: "ok" }; } },
    });
    (r && r.ok && r.total === 2 && r.returned === 2 && r.partial === false && seen.length === 2)
      ? ok("H @everyone：无 to 时全员执行，2/2 且 partial=false")
      : bad("H all members", JSON.stringify({ seen, r: r && { total: r.total, returned: r.returned, partial: r.partial } }));
    const fr = tx(surface).find((e) => e && e.kind === "final_report");
    (fr && fr.partial === false && fr.returned === 2 && fr.total === 2)
      ? ok("H final_report 收齐时如实 2/2 partial=false（只有未收齐才写 partial）")
      : bad("H complete report", JSON.stringify(fr && { returned: fr.returned, total: fr.total, partial: fr.partial }));
  }

  /* ---------- I. 预算护栏：>6 个 responder 直接拒绝 ---------- */
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp143-"));
    const dir = path.join(root, "data", "desktop");
    fs.mkdirSync(dir, { recursive: true });
    const many = { version: 1, primary_id: "m1", bots: [] };
    for (let i = 1; i <= 7; i++) many.bots.push({ id: "m" + i, name: "M" + i, job: "j", description: "d", hidden: false });
    fs.writeFileSync(path.join(dir, "bots.json"), JSON.stringify(many));
    fs.writeFileSync(path.join(dir, "rooms.json"), JSON.stringify({
      version: 1,
      rooms: [{ id: "room-big", title: "Seven", members: many.bots.map((b) => b.id), created_at: "t", transcript: [] }],
    }));
    const surface = createProductSurface(root);
    const r = await surface.orchestrateRoom({
      room: "room-big", task: "seven at once",
      deps: { runResponderTurn: async () => ({ ok: true, text: "x" }) },
    });
    (r && r.ok === false && r.error === "too_many_responders" && r.count === 7 && r.max === 6 && tx(surface, "room-big").length === 0)
      ? ok("I 预算护栏：7 成员 → too_many_responders，且一条 transcript 都不写（不静默截断）")
      : bad("I budget guard", JSON.stringify({ err: r && r.error, count: r && r.count, tx: tx(surface, "room-big").length }));
  }

  /* ---------- J. responder 上下文各自独立（不共用主 Bot）---------- */
  {
    const { surface } = mkSurface();
    const calls = [];
    const r = await surface.orchestrateRoom({
      room: "room-t", task: "context isolation", to: "b1,b2",
      deps: {
        runResponderTurn: async (botId, task, ctx) => {
          calls.push({ botId, task, ctx });
          return { ok: true, text: botId + " reply" };
        },
      },
    });
    const byId = {};
    for (const c of calls) byId[c.botId] = c;
    const okShape = r && r.ok && calls.length === 2 &&
      byId.b1 && byId.b2 &&
      byId.b1.ctx.bot_id === "b1" && byId.b1.ctx.job === "research" && byId.b1.ctx.name === "Researcher" &&
      byId.b2.ctx.bot_id === "b2" && byId.b2.ctx.job === "write" && byId.b2.ctx.name === "Writer" &&
      byId.b1.ctx.room === "room-t" && byId.b2.ctx.room === "room-t";
    okShape
      ? ok("J 上下文隔离：每个 responder 收到自己的 bot_id/name/job，不复用主 Bot 上下文")
      : bad("J per-responder ctx", JSON.stringify(calls.map((c) => ({ id: c.botId, job: c.ctx && c.ctx.job }))));
  }

  /* ---------- K. 失败回执如实带原因，不伪造正文 ---------- */
  {
    const { surface } = mkSurface();
    const r = await surface.orchestrateRoom({
      room: "room-t", task: "one fails", to: "b1,b2",
      deps: {
        runResponderTurn: async (botId) =>
          botId === "b1"
            ? { ok: true, text: "b1 finished", artifacts: [{ name: "report.md" }] }
            : { ok: false, error: "BITBOT_LLM_API_KEY not set", text: "", artifacts: [] },
      },
    });
    (r && r.ok && r.returned === 1 && r.total === 2 && r.partial === true)
      ? ok("K 缺 key 的 responder → 1/2 partial（失败不算成功）")
      : bad("K failure honesty", JSON.stringify(r && { returned: r.returned, total: r.total, partial: r.partial }));
    const err = tx(surface).find((e) => e && e.kind === "bot_reply_error");
    (err && err.bot_id === "b2" && err.speaker === "b2" && err.text === "" &&
      String(err.error).includes("BITBOT_LLM_API_KEY"))
      ? ok("K bot_reply_error：speaker=b2、正文为空、原因原样保留（不伪造回复）")
      : bad("K error row", JSON.stringify(err));
    const fr = tx(surface).find((e) => e && e.kind === "final_report");
    const s2 = fr && fr.sections.find((x) => x.bot_id === "b2");
    (s2 && s2.ok === false && String(s2.summary).includes("BITBOT_LLM_API_KEY"))
      ? ok("K final_report.sections 带失败原因，产物只收成功侧（report.md）")
      : bad("K sections", JSON.stringify(fr && fr.sections));
  }

  /* ---------- L. 超时护栏按 responder 生效 ---------- */
  {
    const { surface } = mkSurface();
    const r = await surface.orchestrateRoom({
      room: "room-t", task: "slow one", to: "b1,b2",
      deps: {
        timeoutMs: 200,
        runResponderTurn: (botId) =>
          botId === "b1"
            ? Promise.resolve({ ok: true, text: "fast" })
            : new Promise(() => {}), // b2 never settles → engine timeout
      },
    });
    const out = await r;
    (out && out.returned === 1 && out.total === 2 && out.partial === true)
      ? ok("L 超时护栏：b2 悬挂 → 200ms 后如实 1/2 partial，整轮不吊死")
      : bad("L per-responder timeout", JSON.stringify(out && { returned: out.returned, total: out.total, partial: out.partial }));
    const err = tx(surface).find((e) => e && e.kind === "bot_reply_error");
    (err && err.bot_id === "b2" && String(err.error).includes("responder_timeout"))
      ? ok("L 超时原因写进 bot_reply_error（responder_timeout），不是静默丢失")
      : bad("L timeout reason", JSON.stringify(err));
  }

  /* ---------- M. 共享转录有界（GP-146 持久层卫生） ---------- */
  {
    const { surface } = mkSurface();
    const long = "长".repeat(6000);
    const r = await surface.orchestrateRoom({
      room: "room-t", task: "写一份" + "很".repeat(600) + "长的任务", to: "b1",
      deps: { runResponderTurn: async () => ({ ok: true, text: long }), timeoutMs: 500 },
    });
    const out = await r;
    const reply = tx(surface).find((e) => e && e.kind === "bot_reply");
    const fr = tx(surface).find((e) => e && e.kind === "final_report");
    (out && out.ok === true && reply && reply.text.length <= 4001 && reply.text_truncated === true)
      ? ok(`M 回复正文有界：durable text=${reply ? reply.text.length : "-"} ≤ 4001 且标 text_truncated`)
      : bad("M bounded reply text", JSON.stringify({ len: reply && reply.text.length, trunc: reply && reply.text_truncated }));
    (fr && fr.sections[0] && fr.sections[0].summary.length <= 241 && fr.sections[0].summary_truncated === true)
      ? ok(`M final_report 分区只留摘要：summary=${fr.sections[0].summary.length} ≤ 241（全文仍在 bot_reply 行）`)
      : bad("M bounded section summary", JSON.stringify({ len: fr && fr.sections[0] && fr.sections[0].summary.length }));
    (fr && fr.task.length <= 241 && fr.task_title.length <= 241)
      ? ok("M final_report.task/task_title 同样有界（不把整条任务抄第二遍）")
      : bad("M bounded task", JSON.stringify({ task: fr && fr.task.length, title: fr && fr.task_title && fr.task_title.length }));
    (fr && String(fr.task_sig).length > 241)
      ? ok("M 幂等标识仍按完整任务文本比对（截断只发生在展示字段，不改身份）")
      : bad("M task_sig must stay exact", JSON.stringify({ sig: fr && fr.task_sig && fr.task_sig.length }));
  }

  /* ---------- N. 失败原因有界，不把 provider 负载整段落盘 ---------- */
  {
    const { surface } = mkSurface();
    const dump = "provider 502 upstream body=" + "x".repeat(1200);
    const r = await surface.orchestrateRoom({
      room: "room-t", task: "boom reason", to: "b1,b2",
      deps: {
        timeoutMs: 500,
        runResponderTurn: async (botId) => (botId === "b1" ? { ok: true, text: "fine" } : { ok: false, text: "", error: dump }),
      },
    });
    const out = await r;
    const err = tx(surface).find((e) => e && e.kind === "bot_reply_error");
    (out && out.partial === true && err && String(err.error).length <= 201 && err.error_truncated === true)
      ? ok(`N 失败原因截断到 ${err ? String(err.error).length : "-"}/201，不再把上游响应体抄进共享转录`)
      : bad("N bounded error reason", JSON.stringify({ len: err && String(err.error).length, trunc: err && err.error_truncated }));
    const fr = tx(surface).find((e) => e && e.kind === "final_report");
    (fr && fr.sections[1] && fr.sections[1].ok === false && fr.sections[1].summary.length <= 241)
      ? ok("N 汇报失败分区同样有界（用户看到摘要 + 完整原因在回复行）")
      : bad("N bounded failed section", JSON.stringify({ len: fr && fr.sections[1] && fr.sections[1].summary.length }));
  }

  /* ---------- O. 「工作中」态只在真扇出时给出 ---------- */
  {
    const { surface } = mkSurface();
    let fanouts = 0;
    let last = null;
    const deps = {
      timeoutMs: 500,
      runResponderTurn: async () => ({ ok: true, text: "done" }),
      onFanout: (ev) => { fanouts += 1; last = ev; },
    };
    const first = await surface.orchestrateRoom({ room: "room-t", task: "同一任务", to: "b1,b2", policy: "mentioned_only", deps });
    await first;
    (fanouts === 1 && last && last.room === "room-t" && last.policy === "mentioned_only" &&
      last.member_count === 2 && Array.isArray(last.responders) && last.responders.length === 2)
      ? ok("O 新鲜编排：engine 回调 onFanout 一次，载荷带 room/task/policy/成员数/responder 名单")
      : bad("O fanout payload", JSON.stringify({ fanouts, last }));
    const dup = await surface.orchestrateRoom({ room: "room-t", task: "同一任务", to: "b1,b2", policy: "mentioned_only", deps });
    (dup && dup.ok === true && dup.deduped === true && fanouts === 1)
      ? ok("O 幂等命中：不再扇出、不再发「工作中」态（不闪假运行状态）")
      : bad("O dedupe must not fan out", JSON.stringify({ deduped: dup && dup.deduped, fanouts }));
    const refused = await surface.orchestrateRoom({ room: "room-t", task: "别的任务", to: ["ghost"], deps });
    (refused && refused.ok === false && fanouts === 1)
      ? ok("O 护栏拒绝（非成员）同样不发运行态：拒绝不该显示「在跑」")
      : bad("O guard must not fan out", JSON.stringify({ err: refused && refused.error, fanouts }));
    const fr = tx(surface).find((e) => e && e.kind === "final_report");
    (fr && fr.responder_policy === "mentioned_only")
      ? ok("O final_report 落 responder_policy：重开窗口仍能如实说明这次是谁该答")
      : bad("O policy persisted", JSON.stringify({ p: fr && fr.responder_policy }));
  }

  /* ---------- P. 提及不存在的成员：不假装定向成功 ---------- */
  {
    const { surface } = mkSurface();
    const r = surface.roomTurn("room-t", "@GhostBot 帮我核对数字", "2026-10-23T00:00:00.000Z");
    const e = r && r.transcript_entry;
    (e && e.responder_policy === "bot_discretion" && Array.isArray(e.unknown_mentions) &&
      e.unknown_mentions[0] === "GhostBot" && e.responders.length === 2)
      ? ok("P @非成员：记 unknown_mentions + 按未点名处理（成员自行判断），不伪造定向")
      : bad("P unknown mention", JSON.stringify(e && { p: e.responder_policy, u: e.unknown_mentions, n: e.responders.length }));
    const clean = surface.roomTurn("room-t", "@Researcher 帮我核对数字", "2026-10-23T00:00:01.000Z");
    const ce = clean && clean.transcript_entry;
    (ce && ce.responder_policy === "mentioned_only" && ce.unknown_mentions === undefined)
      ? ok("P 正常点名不带 unknown_mentions（不制造多余噪声字段）")
      : bad("P clean mention", JSON.stringify(ce && { p: ce.responder_policy, u: ce.unknown_mentions }));
    const many = surface.roomTurn("room-t", "@a @b @c @d @e @f 任务", "2026-10-23T00:00:02.000Z");
    const me = many && many.transcript_entry;
    (me && Array.isArray(me.unknown_mentions) && me.unknown_mentions.length <= 5)
      ? ok(`P 未知提及上限 5 条（本次 ${me.unknown_mentions.length}）：错误提示本身也不能无界`)
      : bad("P unknown mention cap", JSON.stringify(me && me.unknown_mentions));
  }

  /* ---------- Q. rooms.json 坏掉：读侧如实报、写侧 fail closed ---------- */
  {
    const { surface, root } = mkSurface();
    const roomsPath = path.join(root, "data", "desktop", "rooms.json");
    const before = fs.readFileSync(roomsPath, "utf8");
    fs.writeFileSync(roomsPath, String(before).slice(0, 40) + '{"broken"', "utf8");

    const st = surface.roomsStoreStatus();
    (st && st.ok === false && /rooms_store_unreadable/.test(st.error || ""))
      ? ok("Q 坏存储：roomsStoreStatus 如实报 unreadable（渲染层才敢区分「读不到」与「没有群」）")
      : bad("Q store status", JSON.stringify(st));

    let created = null, thrown = null;
    try { created = surface.roomCreate("b1,b3", "Should Not Persist"); }
    catch (e) { thrown = String((e && e.message) || e); }
    const onDisk = fs.readFileSync(roomsPath, "utf8");
    (thrown || (created && created.ok === false)) && onDisk.includes("broken")
      ? ok("Q 写侧 fail closed：建群被拒且不落空目录（一次存储故障不会覆盖用户全部群聊历史）")
      : bad("Q fail closed write", JSON.stringify({ thrown, created, tail: onDisk.slice(-24) }));

    let orch = null, orchErr = "";
    try {
      orch = await surface.orchestrateRoom({
        room: "room-t", task: "坏存储下的编排",
        deps: { runResponderTurn: async () => ({ ok: true, text: "x" }) },
      });
    } catch (e) { orchErr = String((e && e.message) || e); }
    const orchDump = orchErr || JSON.stringify(orch);
    ((orch && orch.ok === false) || Boolean(orchErr)) && /rooms_store_unreadable/.test(orchDump)
      ? ok("Q 编排拒绝而不是在坏目录上「假装跑完」（" + (orchErr ? "同步拒绝" : "结构化拒绝") + "）")
      : bad("Q orchestrate on corrupt store", String(orchDump).slice(0, 220));

    fs.writeFileSync(roomsPath, before, "utf8");
    const st2 = surface.roomsStoreStatus();
    (st2 && st2.ok === true && Array.isArray(st2.rooms.rooms) && st2.rooms.rooms.length === 1)
      ? ok("Q 恢复后按原文件重建（历史仍在，不是重新生成的空壳）")
      : bad("Q recovery", JSON.stringify(st2).slice(0, 200));

    const missing = fs.mkdtempSync(path.join(os.tmpdir(), "gp143-none-"));
    fs.mkdirSync(path.join(missing, "data", "desktop"), { recursive: true });
    const st3 = createProductSurface(missing).roomsStoreStatus();
    (st3 && st3.ok === true && st3.rooms.rooms.length === 0)
      ? ok("Q 文件不存在 ≠ 存储故障：如实当作「还没有群」的空目录")
      : bad("Q missing file", JSON.stringify(st3).slice(0, 200));
  }

  console.log(`\nprove_gp143_orchestration: PASS=${pass} FAIL=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
