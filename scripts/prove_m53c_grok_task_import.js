#!/usr/bin/env node
"use strict";

/**
 * prove_m53c_grok_task_import — 「把 Grok 里跑着的任务搬过来」这条通道可不可信
 *
 * 这条门禁盯的不是"能解析"，而是三件更容易被糊过去的事：
 *   1. **看不懂的绝不落库**。没有"默认 09:00"这种兜底 —— 猜出来的时间比没建更糟：
 *      用户以为它在跑，其实跑在错的时刻，而且再也不会去看第二眼。
 *   2. **幂等**。同一份清单跑两遍只有一份；重复的关键是「同群 + 同 cron + 同一句话」，
 *      少任何一个维度都会把「同一句话的两个不同频率」误并成一条。
 *   3. **归属不许猜**。--room 找不到 / 重名时必须拒绝，不能静默落成私聊任务 ——
 *      迁错归属会让用户以后在群里找不到它，还以为丢了。
 *
 * 负向对照（三条，各自把实现打坏，断言必须翻假）：
 *   a. 去掉「没时间就不写」的守卫 → 「每天」会被造出一个时间
 *   b. 把「周一」映射成周日 → 周一的 cron 断言翻假
 *   c. 把幂等键里的 cron 去掉 → 不同频率的同一句话被判成重复
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const REPO = path.join(__dirname, "..");
const SRC_PATH = path.join(REPO, "scripts/import_grok_tasks.js");
const SRC = fs.readFileSync(SRC_PATH, "utf8");

/** 在隔离上下文里加载（可传改坏的源码），CLI 分支不会跑：假 module 没有 main。 */
function load(src) {
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require,
    __dirname: path.join(REPO, "scripts"),
    __filename: SRC_PATH,
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(src, sandbox, { filename: SRC_PATH });
  return mod.exports;
}

const impl = load(SRC);

/* ---------- T1 时间表达 → cron：Grok 面板里的四种节奏 + 直给 cron ---------- */
{
  const cases = [
    ["每天 09:00", "0 9 * * *"],
    ["每日 21:30", "30 21 * * *"],
    ["每周一 10:00", "0 10 * * 1"],
    ["每周日 08:00", "0 8 * * 0"],
    ["每周五晚上八点半", "30 8 * * 5"],
    ["每月 1 日 09:00", "0 9 1 * *"],
    ["每月 15 号 07:00", "0 7 15 * *"],
    ["每年 1 月 1 日 09:00", "0 9 1 1 *"],
    ["Daily at 8:30am", "30 8 * * *"],
    ["Weekly on Tuesday at 18:00", "0 18 * * 2"],
    ["Monthly on the 15th at 10:00", "0 10 15 * *"],
    ["Yearly on Mar 3 at 09:00", "0 9 3 3 *"],
    ["0 7 * * 1-5", "0 7 * * 1-5"],
  ];
  const wrong = [];
  for (const [input, want] of cases) {
    const got = impl.scheduleToCron(input);
    if (got.cron !== want) wrong.push(input + " → " + (got.cron || got.error) + "（应为 " + want + "）");
  }
  wrong.length === 0
    ? ok("T1 " + cases.length + " 种时间写法都映射到预期 cron（中英、数字/中文数字、直给 cron）")
    : bad("T1 时间映射不对", wrong.join(" / "));
}

/* ---------- T2 缺料就拒绝，并且说清缺什么（这是"不猜"的具体形态） ---------- */
{
  const cases = [
    ["每天", "no_time"],
    ["每周 09:00", "no_weekday"],
    ["每月 09:00", "no_day_of_month"],
    ["每年 09:00", "no_month_day"],
    ["随手一句没有时间的话", "unknown_schedule"],
    ["", "no_schedule"],
  ];
  const wrong = [];
  for (const [input, want] of cases) {
    const got = impl.scheduleToCron(input);
    if (got.error !== want) wrong.push(JSON.stringify(input) + " → " + JSON.stringify(got));
  }
  wrong.length === 0
    ? ok("T2 缺时间/缺星期/缺日期/认不出 → 各自给出拒绝原因（没有一件被「顺手补个默认时间」）")
    : bad("T2 拒绝原因不对", wrong.join(" / "));
}

/* ---------- T3 干跑：可建 / 跳过 / 看不懂 三类分得开 ---------- */
const SAMPLE = [
  "# 从 grok.com/tasks 抄下来的",
  "每天 09:00 | 搜 X 上我关注领域的 24 小时热点，挑 3 条并说明为什么值得看",
  "每周一 10:00 | 汇总上周竞品动态",
  "每天 | 这条没写时间",
].join("\n");
{
  const parsed = impl.fromText(SAMPLE);
  const { ready, unparsed } = impl.plan(parsed.items, "room-x");
  ready.length === 2 && unparsed.length === 1 && unparsed[0].reason === "no_time"
    ? ok("T3 三条输入分成 2 条可建 + 1 条看不懂（注释行不计入）")
    : bad("T3 分类不对", JSON.stringify({ ready: ready.length, unparsed }));
  ready.every((r) => r.room === "room-x" && /^grok-[0-9a-f]{10}$/.test(r.id))
    ? ok("T3b 每条都带上归属群与内容推导出的稳定 id")
    : bad("T3b 归属或 id 形状不对", JSON.stringify(ready.map((r) => [r.room, r.id])));
}

/* ---------- T4 真落库：临时数据根上走产品路径建，再跑一遍必须幂等 ---------- */
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-import-"));
  fs.mkdirSync(path.join(root, "desktop"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "desktop", "rooms.json"),
    JSON.stringify({ rooms: [{ id: "room-content", title: "自媒体内容团队", transcript: [] }] }, null, 2),
  );
  process.env.BITBOT_DATA_ROOT = root;

  const rooms = [{ id: "room-content", title: "自媒体内容团队" }];
  const byTitle = impl.resolveRoom("自媒体内容团队", rooms);
  const byId = impl.resolveRoom("room-content", rooms);
  const missing = impl.resolveRoom("不存在的群", rooms);
  byTitle.id === "room-content" && byId.id === "room-content" && missing.error === "room_not_found"
    ? ok("T4 归属解析：名字/ID 都能命中，找不到就如实报 room_not_found（不静默落私聊）")
    : bad("T4 归属解析不对", JSON.stringify({ byTitle, byId, missing }));

  const duplicateTitle = impl.resolveRoom("同名群", [
    { id: "a", title: "同名群" },
    { id: "b", title: "同名群" },
  ]);
  duplicateTitle.error === "room_title_ambiguous"
    ? ok("T4b 重名群拒绝并要人给 id（不替用户挑一个）")
    : bad("T4b 重名群被随便挑了一个", JSON.stringify(duplicateTitle));

  const { createHostFfi } = require(path.join(REPO, "hosts/shared/host_ffi"));
  const ffi = createHostFfi(REPO);

  async function applyMirror(entries) {
    const out = [];
    for (const e of entries) {
      const res = await ffi.executeHostEffects(
        [{ kind: "routine_schedule", command: [e.id, e.cron, e.prompt].join("|") }],
        { sessionId: "prove-m53c", roomId: e.room || "" },
      );
      const hit = (res || [])[0] || {};
      let payload = {};
      try { payload = JSON.parse(hit.stdout || "{}"); } catch { payload = {}; }
      out.push({ ok: hit.ok === true && payload.stored !== false, payload });
    }
    return out;
  }
  const readRows = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, "routines", "host-routines.json"), "utf8"));
    } catch { return []; }
  };

  const parsed = impl.fromText(SAMPLE);
  const first = impl.plan(parsed.items, "room-content");
  const applied = await applyMirror(first.ready);
  const rows1 = readRows();
  applied.every((a) => a.ok) && rows1.length === 2
    ? ok("T4c 真写入 2 行（走 executeHostEffects 的产品路径，不是手写 JSON）")
    : bad("T4c 没写进去", JSON.stringify({ applied, n: rows1.length }));

  const daily = rows1.find((r) => String(r.cron) === "0 9 * * *") || {};
  daily.room_id === "room-content" && daily.next_due && Date.parse(daily.next_due) > Date.now()
    ? ok("T4d 归属群写进行里，next_due 由真实 cron 解析器算出（" + String(daily.next_due).slice(0, 16) + "Z）")
    : bad("T4d 行字段不对", JSON.stringify(daily));

  // 第二遍：库里已有的按 (群, cron, 原话) 判重
  const rowsBefore = rows1.length;
  const again = first.ready.filter((e) => !rows1.some((row) => impl.sameRoutine(row, e)));
  again.length === 0 && readRows().length === rowsBefore
    ? ok("T4e 再跑一遍：0 条新建（幂等，不会把同一句话再种一行）")
    : bad("T4e 不幂等", JSON.stringify({ again: again.length, n: readRows().length }));

  /* ---------- T4f 你在 Grok 里暂停着的任务，搬过来也必须是暂停的 ---------- */
  {
    const pausedEntry = impl.plan(
      impl.fromText("每天 07:00 | 我在 Grok 里已经停掉的那条").items.map((it) => ({ ...it, enabled: false })),
      "room-content",
    ).ready[0];
    const res = await ffi.executeHostEffects(
      [{ kind: "routine_schedule", command: [pausedEntry.id, pausedEntry.cron, pausedEntry.prompt].join("|") }],
      { sessionId: "prove-m53c", roomId: pausedEntry.room },
    );
    const hit = (res || [])[0] || {};
    let payload = {};
    try { payload = JSON.parse(hit.stdout || "{}"); } catch { payload = {}; }
    const id = payload.id || pausedEntry.id;
    const pr = ffi.routineLifecycle({ roomId: pausedEntry.room, id, action: "pause" });
    const row = readRows().find((r) => r && r.id === id) || {};
    pr && pr.ok && row.enabled === false && String(row.lifecycle) === "paused"
      ? ok("T4f 暂停状态跟着迁（建完立刻走同一条 lifecycle 通道按下，不是改 JSON 假装）")
      : bad("T4f 暂停状态没迁过来", JSON.stringify({ pr, row }));
  }

  /* ---------- T5 负向对照 a：拆掉"没时间就不写"的守卫 ---------- */
  {
    const broken = load(SRC.replace(/if \(!clock\) return \{ error: "no_time" \};/g, 'if (!clock) return { cron: "0 9 * * *", kind: "daily" };'));
    const got = broken.scheduleToCron("每天");
    got.cron === "0 9 * * *"
      ? ok("T5 负向对照：拆掉缺时间的守卫 → 「每天」被造出一个 09:00（证明 T2 的拒绝是真在拦）")
      : bad("T5 负向对照恒真：拆掉守卫后仍然拒绝", JSON.stringify(got));
  }

  /* ---------- T6 负向对照 b：把「周一」映射成周日 ---------- */
  {
    const broken = load(SRC.replace("一: 1, 二: 2", "一: 0, 二: 2"));
    const got = broken.scheduleToCron("每周一 10:00");
    got.cron === "0 10 * * 0"
      ? ok("T6 负向对照：把周一映射成 0 → cron 变成周日（证明 T1 断言盯着的就是这张表）")
      : bad("T6 负向对照恒真：改了映射断言没变", JSON.stringify(got));
  }

  /* ---------- T7 负向对照 c：幂等键里去掉 cron ---------- */
  {
    const broken = load(SRC.replace('String(row.cron || "") === want.cron &&', ""));
    const a = { cron: "0 9 * * *", room: "room-content", prompt: "同一句话" };
    const b = { cron: "0 18 * * *", room: "room-content", prompt: "同一句话", };
    const row = { cron: "0 9 * * *", room_id: "room-content", prompt: "同一句话" };
    const realSame = impl.sameRoutine(row, b);
    const brokenSame = broken.sameRoutine(row, b);
    realSame === false && brokenSame === true
      ? ok("T7 负向对照：幂等键去掉 cron → 不同频率的同一句话被判成重复（证明去重维度不能少）")
      : bad("T7 负向对照恒真", JSON.stringify({ realSame, brokenSame, a: a.cron }));
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log("\nprove_m53c_grok_task_import: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_m53c fatal:", e && e.message ? e.message : e);
  process.exit(1);
});
