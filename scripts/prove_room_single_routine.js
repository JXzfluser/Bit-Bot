#!/usr/bin/env node
"use strict";

/**
 * prove_room_single_routine — 群里一句话，只能落一条定时任务
 *
 * 事故现场（用户报的）：
 *   在群里发「配置好每天7点的定时任务，发送邮件到 jx_zfl@126.com」，
 *   用户点开「定时任务」看到 13 条一模一样的排程，id 各不相同。
 *
 * 成因（三层，缺一不可）：
 *   1. 群任务被扇出成「自决 → 每个成员 → lead 综合」多次**完整内核回合**，
 *      每一次都带全套工具，每一次都能产出 routine_schedule；
 *   2. 内核给每条腿生成的是**不同的** routine id，而 Host 的 upsert 是按 id
 *      找行 —— 不同 id = 各长一行，13 条就是这么来的；
 *   3. 排程的 prompt 存的是**编排脚手架**（【群任务】+【共享任务板】+ 别人的
 *      发言），到点触发时等于每天让 bot 重做一次编排。
 *
 * 契约：
 *   T1 同一群 + 同一 cron + 同一句请求，13 条腿各说一遍 → **只有 1 行**。
 *   T2 这一行的 prompt 是**用户原话**，不是编排脚手架。
 *   T3 后来那些合并进来的要如实标 deduped（回执不能长得像建了 13 个）。
 *   T4 同一个群换时间 = 另一条任务（不能被上面那条规则吃掉）。
 *   T5 别的群说同一句话 = 它自己的任务（群隔离不能被去重打破）。
 *   T6 DM 路径一个字节都不变：没有 roomId 时，两次不同 id 仍然是两行。
 *   T7 行形状不新增字段（id/enabled/lifecycle/updated_at/cron/prompt/next_due/room_id…）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "room-single-routine-"));
const ffi = createHostFfi(root);
const ROUTES = path.join(root, "data", "routines", "host-routines.json");

const readRows = () => {
  try {
    const j = JSON.parse(fs.readFileSync(ROUTES, "utf8"));
    return Array.isArray(j) ? j : (j.routines || []);
  } catch { return []; }
};

/** 一次「腿」的排程：内核自己生成的 id + 它自己写的 prompt 都可能污染。 */
async function leg(kernelId, cron, kernelPrompt, opts) {
  const o = opts || {};
  const res = await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: kernelId + "|" + cron + "|" + kernelPrompt }],
    { sessionId: "prove", roomId: o.roomId || "", userText: o.userText || "" },
  );
  const hit = (res || []).find((x) => x && x.kind === "routine_schedule") || {};
  // 内核读的是 stdout 里的 JSON（回执也照它说话），所以断言要落在那一层。
  let art = {};
  try { art = JSON.parse(String(hit.stdout || "{}")); } catch { art = {}; }
  return Object.assign({}, hit, art, { ok: hit.ok });
}

(async () => {
  console.log("prove_room_single_routine — 群里一句话，只能落一条定时任务");

  const ROOM = "room-mvxphoyw-kt3si";
  const SENTENCE = "配置好每天7点的定时任务，发送邮件到我邮件jx_zfl@126.com";
  const CRON = "0 7 * * *";

  /* ---- T1/T2/T3：13 条腿，13 个内核 id，13 种被污染的 prompt ---- */
  // 现场抄回来的三种污染形态（成员版 / 任务板版 / lead 综合版）。
  const poisoned = [
    (n) => "群任务：" + SENTENCE + "\n【你的分工】" + n + "\n你是群成员「" + n + "」（职责：内容）",
    (n) => "群任务：" + SENTENCE + "\n【共享任务板 group_id=" + ROOM + "】\n- [shared] 共享任务 — 认领：未认领\n最近进度：\n- bot-27ce3c：我先认领选题环节…",
    () => "你是这个群的 lead，请把成员的结果综合成一个可执行的最终答案。\n【群任务】" + SENTENCE + "\n【成员结果】\n- 情报侦察员：已建定时任务 routine-cn-1…",
  ];
  const names = ["情报侦察员", "数据复盘师", "选题策划师", "内容主笔", "事实编辑"];
  const results = [];
  let n = 0;
  for (const name of names) {
    for (const mk of poisoned) {
      n += 1;
      results.push(await leg("routine-cn-" + (100000 + n), CRON, mk(name), {
        roomId: ROOM, userText: SENTENCE,
      }));
    }
  }
  // 最后一条换成「同一句原话但 cron 相同、prompt 也已经是干净的」——同样并进同一条。
  results.push(await leg("routine-cn-999999", CRON, SENTENCE, { roomId: ROOM, userText: SENTENCE }));

  const rows = readRows();
  rows.length === 1
    ? ok("T1 13 条腿 × 同一句请求 → 1 行（实测 " + rows.length + " 行）")
    : bad("T1 一句话还是长出了多行", JSON.stringify(rows.map((r) => ({ id: r.id, cron: r.cron, prompt: String(r.prompt || "").slice(0, 40) }))));

  const row = rows[0] || {};
  String(row.prompt || "") === SENTENCE
    ? ok("T2 存下来的是用户原话（不是编排脚手架）")
    : bad("T2 排程 prompt 不是用户原话", JSON.stringify(String(row.prompt || "").slice(0, 200)));

  const deduped = results.filter((r) => r && r.deduped);
  const created = results.filter((r) => r && r.ok !== false && !r.deduped);
  created.length === 1 && deduped.length === results.length - 1
    ? ok("T3 只有第一条算「新建」，其余 " + deduped.length + " 条如实标 deduped")
    : bad("T3 deduped 标记不对", JSON.stringify({ created: created.length, deduped: deduped.length, total: results.length }));

  /* ---- T4：同一个群换时间 = 另一条任务 ---- */
  await leg("routine-cn-200001", "30 8 * * *", "群任务：" + SENTENCE + "\n【你的分工】改时间", {
    roomId: ROOM, userText: SENTENCE,
  });
  readRows().length === 2
    ? ok("T4 同一个群换 cron → 是另一条任务（去重没有吃掉改时间）")
    : bad("T4 改时间被误并进旧行", JSON.stringify(readRows().map((r) => r.cron)));

  /* ---- T5：别的群说同一句话 = 它自己的任务 ---- */
  await leg("routine-cn-200002", CRON, "群任务：" + SENTENCE, {
    roomId: "room-other-group", userText: SENTENCE,
  });
  const other = readRows().filter((r) => String(r.room_id || "") === "room-other-group");
  other.length === 1 && String((readRows().find((r) => r.room_id === ROOM) || {}).room_id) === ROOM
    ? ok("T5 另一个群说同一句话 → 它自己的一行，群隔离没被打破")
    : bad("T5 群隔离被去重打破", JSON.stringify(readRows().map((r) => ({ id: r.id, room: r.room_id }))));

  /* ---- T6：DM 路径不变 ---- */
  const before = readRows().length;
  await leg("routine-cn-300001", CRON, "每天早上帮我看看热点", {});
  await leg("routine-cn-300002", CRON, "每天早上帮我看看热点", {});
  readRows().length === before + 2
    ? ok("T6 DM / 无群归属：两个 id 仍是两行（既有语义不变）")
    : bad("T6 DM 路径被改了", JSON.stringify({ before, after: readRows().length }));

  /* ---- T7：行形状没变 ---- */
  const allowed = new Set([
    "id", "enabled", "lifecycle", "updated_at", "cron", "prompt", "next_due",
    "room_id", "auto_execute", "last_run", "created_at",
  ]);
  const extra = new Set();
  for (const r of readRows()) for (const k of Object.keys(r || {})) if (!allowed.has(k)) extra.add(k);
  extra.size === 0
    ? ok("T7 行形状没新增字段")
    : bad("T7 行上多了字段", Array.from(extra).join(","));

  /* ---- T8：静态接线 —— 群回合必须把「用户原话」交下去 ---- */
  const REPO = path.join(__dirname, "..");
  const runtimeJs = fs.readFileSync(path.join(REPO, "hosts/shared/room_runtime.js"), "utf8");
  const responder = (runtimeJs.match(/async function runResponderTurn[\s\S]{0,3000}?\n  \}/) || [""])[0];
  /\n\s*userText\s*:/.test(responder)
    ? ok("T8 成员回合把用户原话交给了效果执行（runTurn opts.userText 在位）")
    : bad("T8 成员回合没交 userText：群里排的程又会被编排 prompt 污染");
  const turnJs = fs.readFileSync(path.join(REPO, "hosts/shared/run_moon_turn.js"), "utf8");
  /\n\s*userText\s*:\s*String\(ctx\.userText/.test(turnJs)
    ? ok("T9 runTurn 把 userText 一路传到 executeHostEffects")
    : bad("T9 runTurn 没把 userText 传下去");
  const discretion = (runtimeJs.match(/async function runDiscretionTurn[\s\S]{0,3000}?\n  \}/) || [""])[0];
  /sideEffectPolicy:\s*"text_only"/.test(discretion)
    ? ok("T10 自决回合（只回 YES/NO）只放行 llm_chat，改不了任何状态")
    : bad("T10 自决回合又成了完整内核回合：它能替用户建任务");

  /* ---- T11：副作用闸的运行时行为（不只是静态字符串）---- */
  const { applySideEffectPolicy } = require("../hosts/shared/run_moon_turn");
  const batch = [
    { kind: "llm_chat", command: "简单聊" },
    { kind: "routine_schedule", command: "routine-cn-1|0 7 * * *|每天发邮件" },
    { kind: "routine_remove", command: "routine-cn-1" },
    { kind: "memory_update", command: "记住：我喜欢简短" },
    { kind: "teammate_create", command: "建一个编辑" },
  ];
  const d = applySideEffectPolicy(batch, "text_only");
  d.effects.length === 1 && d.effects[0].kind === "llm_chat" && d.withheld.length === 4
    ? ok("T11 判定回合：5 个效果只放行 llm_chat，其余 4 个带 reason 记入 withheld")
    : bad("T11 判定回合的闸没按白名单裁", JSON.stringify(d.withheld));
  const m = applySideEffectPolicy(batch, "no_schedule");
  m.effects.some((e) => e.kind === "routine_schedule") === false && m.effects.some((e) => e.kind === "memory_update")
    ? ok("T12 no_schedule 只拦排程，别的效果照常（成员回合还能记忆，不能建任务）")
    : bad("T12 no_schedule 拦错了东西", JSON.stringify(m.effects.map((e) => e.kind)));
  const open = applySideEffectPolicy(batch, "");
  open.effects.length === batch.length && open.withheld.length === 0
    ? ok("T13 不传 policy 时一个都不拦（DM / CLI 行为不变）")
    : bad("T13 默认路径被误伤", JSON.stringify(open.withheld.map((w) => w.kind)));

  /* ---- T14：历史遗留行（prompt 已被污染）也要认得出是同一条 ---- */
  // 现场那 13 行的 prompt 是编排脚手架。用户再说一遍同一句话时，不能因为
  // 「字面不一样」又长出第 14 行 —— 要比「这条任务要干什么」。
  const LEGACY = "room-legacy-1";
  const legacyRows = readRows();
  legacyRows.push({
    id: "routine-cn-legacy", enabled: true, lifecycle: "active",
    updated_at: "2026-11-01T12:00:00.000Z", cron: CRON,
    prompt: "群任务：" + SENTENCE + "\n【你的分工】情报侦察员\n你是群成员「情报侦察员」（职责：情报）",
    next_due: "2026-11-01T23:00:00.000Z", room_id: LEGACY,
  });
  fs.writeFileSync(ROUTES, JSON.stringify(legacyRows, null, 2));
  const beforeLegacy = readRows().length;
  const legacyHit = await leg("routine-cn-brandnew", CRON, "群任务：" + SENTENCE + "\n【共享任务板】…", {
    roomId: LEGACY, userText: SENTENCE,
  });
  const afterLegacy = readRows();
  afterLegacy.length === beforeLegacy && legacyHit.id === "routine-cn-legacy"
    ? ok("T14 历史行的 prompt 是脚手架也认得出：并进原行，不长第 N+1 行")
    : bad("T14 历史行没认出来（用户再说一遍就又长一行）", JSON.stringify({
        before: beforeLegacy, after: afterLegacy.length, hit: legacyHit.id,
      }));

  console.log("\n" + (fail === 0 ? "PASS " : "FAIL ") + pass + "/" + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("prove_room_single_routine crashed:", e && e.stack || e);
  process.exit(1);
});
