#!/usr/bin/env node
"use strict";

/**
 * prove_command_task_control —— 指挥台的「可指挥」能力(B-8 批 2b + 批 3)
 *
 * 负向对照(本门自带的那些「必须是错/必须是空/必须是没发生」的断言):
 *   · 再停一次 ⇒ no_running_task(**不假装**停掉了什么);空 sig ⇒ task_sig_required
 *   · 新人选不存在 / 不在群里 / 换成自己 ⇒ 各自如实回错
 *   · 没有 task_sig ⇒ **不写** Task(**不编一个出来**)
 *   · 空输入 ⇒ 不发任何东西
 *   ⇒ 外加手工变异对照(不同步 8 红 / 不补「仅记录」卡 5 红 / 实体不优先 1 红)。
 *
 * 两半:
 *   A. **并行过程可见**(2b):指挥台里看得到每个成员干了什么。
 *   B. **刹停**(批 3):能**精准命中一个正在跑的任务**并把它停下来,
 *      停下来要**落一行可审计的转录**。
 *
 * B 半跑**真源码**:`createProductSurface` 是纯 CommonJS ⇒ 直接 require,
 * 用真 `roomOrchestrator.createCancelScope()` 造 scope ⇒ 验的是产品真逻辑。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
const { resolveBrowser } = require("./lib/browser_env");

const HTML = path.join(REPO, "hosts", "desktop", "index.html");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const check = (c, m, d) => (c ? ok(m) : bad(m, d));

console.log("prove_command_task_control — 指挥台(并行可见 / 刹停)");

// ══════════════════════════════════════════════════════════════════════
// A. 并行过程可见 —— 静态 + 真渲染
// ══════════════════════════════════════════════════════════════════════
{
  const html = fs.readFileSync(HTML, "utf8");
  check(/cmdRenderSteps/.test(html), "TC-1 指挥台有步骤明细的渲染函数");
  check(/cmd-step-name/.test(html), "TC-1 步骤明细画出成员名字");

  // 取**含 aggregateCommandTasks 的那个 script 块**(比定位注释稳)。
  let m = null;
  const blocks = html.match(/<script[\s\S]*?<\/script>/g) || [];
  for (const b of blocks) {
    if (b.indexOf("aggregateCommandTasks") >= 0) { m = b.match(/<script[^>]*>([\s\S]*?)<\/script>/); break; }
  }
  check(!!m, "TC-1 指挥台脚本块可定位");
  if (m) {
    try {
      // 只**编译**不执行:这层要验的是语法,不是浏览器行为
      // (真渲染由下面的 Playwright 段负责)。
      new vm.Script(m[1], { filename: "index.html#cmd-panel" });
      ok("TC-1 指挥台脚本在 vm 里语法成立");
    } catch (e) {
      bad("TC-1 指挥台脚本在 vm 里语法成立", e && e.message);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// B. 刹停 —— 真源码
// ══════════════════════════════════════════════════════════════════════
{
  const surfaceMod = require(path.join(REPO, "hosts", "desktop", "product_surface.js"));
  const orch = require(path.join(REPO, "hosts", "desktop", "room_orchestrator.js"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-ctrl-"));
  const surface = surfaceMod.createProductSurface(REPO, { dataRoot: tmp });

  // 造一个在跑的任务
  const scope = orch.createCancelScope();
  surface.registerTaskScope("sig-run-1", scope);
  check(surface.taskIsRunning("sig-run-1") === true, "TC-2 登记后这个任务算「在跑」");

  const r1 = surface.cancelRoomTask("sig-run-1", "user_stop");
  check(r1 && r1.ok === true && r1.cancelled === 1, "TC-2 刹停命中了 1 个在跑的 scope", JSON.stringify(r1));
  check(scope.isCancelled() === true, "TC-2 scope 真的被取消了");

  // 负向:再停一次 ⇒ 如实说"没有在跑的",**不假装**
  const r2 = surface.cancelRoomTask("sig-run-1", "user_stop");
  check(r2 && r2.ok === false && r2.error === "no_running_task",
    "TC-3 负向:再停一次 ⇒ no_running_task(**不假装停掉了什么**)", JSON.stringify(r2));

  // 负向:空 task_sig
  const r3 = surface.cancelRoomTask("", "user_stop");
  check(r3 && r3.ok === false && r3.error === "task_sig_required",
    "TC-3 负向:空 task_sig ⇒ task_sig_required", JSON.stringify(r3));

  // 精准性:两个任务,只停其中一个
  const sA = orch.createCancelScope();
  const sB = orch.createCancelScope();
  surface.registerTaskScope("sig-A", sA);
  surface.registerTaskScope("sig-B", sB);
  const r4 = surface.cancelRoomTask("sig-A", "user_stop");
  check(r4 && r4.cancelled === 1, "TC-4 精准:只停 A", JSON.stringify(r4));
  check(surface.taskIsRunning("sig-B") === true, "TC-4 精准:B 还在跑(没被误伤)");
  check(surface.taskIsRunning("sig-A") === false, "TC-4 精准:A 停了");

  // 收尾:forgetRoomScope 之后 scope 表干净
  surface.forgetRoomScope(sB);
  check(surface.taskIsRunning("sig-B") === false, "TC-4 forgetRoomScope 之后任务不在表里");

  // IPC 那条路:静态断言「停掉了 ⇒ 落一行 task_state 转录」
  const mainSrc = fs.readFileSync(path.join(REPO, "hosts", "desktop", "main.js"), "utf8");
  check(/bitbot:rooms:task:cancel/.test(mainSrc), "TC-5 IPC 通道存在");
  const ipcBlock = mainSrc.slice(
    mainSrc.indexOf('ipcMain.handle("bitbot:rooms:task:cancel"'),
    mainSrc.indexOf('ipcMain.handle("bitbot:rooms:orchestrate"')
  );
  check(/kind:\s*"task_state"/.test(ipcBlock), "TC-5 停掉了会落一行 task_state 转录(可审计)");
  check(/state:\s*"cancelled"/.test(ipcBlock), "TC-5 那行写明 state=cancelled");
  check(/appendRoomTranscript/.test(ipcBlock), "TC-5 那行真的写进转录");

  // preload 暴露
  const pre = fs.readFileSync(path.join(REPO, "hosts", "desktop", "preload.js"), "utf8");
  check(/cancelTask/.test(pre), "TC-5 preload 暴露 cancelTask");

  // ── 插话 / 改向 ──────────────────────────────────────────────────────
  {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-steer-"));
    fs.mkdirSync(path.join(tmp2, "desktop"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp2, "desktop", "rooms.json"),
      JSON.stringify({ rooms: [{ id: "r1", title: "测试群", members: [], transcript: [] }] })
    );
    const s2 = surfaceMod.createProductSurface(REPO, { dataRoot: tmp2 });

    // 插话:落共享板 ⇒ **下一棒**读 board 时看得见
    const st = s2.steerRoomTask("r1|sig-1", "r1", "加一段数据分析");
    check(st && st.ok === true, "TC-10 插话成功", JSON.stringify(st));
    check(st && st.scope === "next_hop" && st.current_turn_sees === false,
      "TC-10 **诚实**:回执写明「下一棒看得见、当前这一轮看不见」",
      JSON.stringify(st));

    const board = orch.createRoomBoard(REPO, { dataRoot: tmp2 });
    const snap = board.snapshot("r1");
    check(String(snap.text || "").indexOf("数据分析") >= 0,
      "TC-10 插话真的落在共享板上(下一棒读得到)", String(snap.text).slice(0, 120));

    const roomsJson = JSON.parse(fs.readFileSync(path.join(tmp2, "desktop", "rooms.json"), "utf8"));
    const tr = roomsJson.rooms[0].transcript || [];
    const steerRow = tr.find((e) => e.kind === "task_state" && e.state === "steered");
    check(!!steerRow, "TC-10 插话落了一行 task_state/steered 转录(可审计)");
    check(steerRow && String(steerRow.text || "").indexOf("数据分析") >= 0,
      "TC-10 那行带着插话内容");

    // 改向:换目标 + 幂等键沿用
    const rp = s2.replanRoomTask("r1|sig-1", "r1", "改成写一份竞品分析");
    check(rp && rp.ok === true, "TC-11 改向成功", JSON.stringify(rp));
    check(rp && rp.message_id === "sig-1",
      "TC-11 改向沿用原幂等键(还是同一个任务)", JSON.stringify(rp));
    const rooms2 = JSON.parse(fs.readFileSync(path.join(tmp2, "desktop", "rooms.json"), "utf8"));
    const tr2 = rooms2.rooms[0].transcript || [];
    const rpRow = tr2.find((e) => e.kind === "task_state" && e.state === "replanned");
    check(!!rpRow && String(rpRow.task || "") === "改成写一份竞品分析",
      "TC-11 改向落了一行 task_state/replanned,写明新目标");

    // 编排读 directive ⇒ 用新目标
    const dir = s2.latestTaskDirective(rooms2.rooms[0]);
    check(dir && dir.task === "改成写一份竞品分析",
      "TC-12 编排读得到改向指令 ⇒ 下一轮用新目标", JSON.stringify(dir));
    check(dir && dir.message_id === "sig-1",
      "TC-12 directive 带着幂等键(不改身份,只换目标)", JSON.stringify(dir));

    // 负向
    check(s2.steerRoomTask("", "r1", "x").error === "task_sig_required", "TC-13 负向:空 task_sig");
    check(s2.steerRoomTask("r1|s", "r1", "  ").error === "text_required", "TC-13 负向:空插话内容");
    check(s2.replanRoomTask("r1|s", "r1", "").error === "task_required", "TC-13 负向:空新目标");
    check(s2.steerRoomTask("r1|s", "", "x").error === "room_id_required", "TC-13 负向:空 room");

    // 真差分:编排**真的读了** directive ⇒ 即便调用方没给 task,
    // 也不会报 "needs_room_and_task",而是走到后面去(这里 members 为空 ⇒ no_responders)。
    // (不读 directive 的话 ⇒ 一定会撞上 needs_room_and_task。)
    const orchOut = s2.orchestrateRoom({ room: "r1", task: "" });
    check(orchOut && orchOut.error !== "orchestrate_needs_room_and_task",
      "TC-17 编排真的读了改向指令(没给 task 也没报缺 task)", JSON.stringify(orchOut));
    check(orchOut && orchOut.error === "no_responders",
      "TC-17 它是顺着新目标往下走的(不是被空 task 挡住)", JSON.stringify(orchOut));

    // directive 之后若已收口 ⇒ 不再生效(改向只影响"还没跑完"的那批)
    rooms2.rooms[0].transcript.push({ kind: "final_report", task_sig: "r1|sig-1", at: "x" });
    check(s2.latestTaskDirective(rooms2.rooms[0]) === null,
      "TC-14 负向:那批已经收口 ⇒ 旧改向指令不再生效");

    // ── 换人 ────────────────────────────────────────────────────────────
    const botsFile = path.join(tmp2, "desktop", "bots.json");
    fs.writeFileSync(botsFile, JSON.stringify({
      bots: [
        { id: "b-old", name: "老王" },
        { id: "b-new", name: "小李" },
        { id: "b-outsider", name: "外人" },
      ],
    }));
    // 把两个 bot 都放进群里
    const rw = JSON.parse(fs.readFileSync(path.join(tmp2, "desktop", "rooms.json"), "utf8"));
    rw.rooms[0].members = ["b-old", "b-new"];
    fs.writeFileSync(path.join(tmp2, "desktop", "rooms.json"), JSON.stringify(rw));
    const s3 = surfaceMod.createProductSurface(REPO, { dataRoot: tmp2 });

    const sw = s3.reassignRoomTask("r1|sig-1", "r1", "b-old", "b-new");
    check(sw && sw.ok === true, "TC-18 换人成功", JSON.stringify(sw));
    check(sw && sw.to_bot === "b-new" && sw.scope === "next_hop",
      "TC-18 换的是**下一棒**(当前这一轮已经拿到 prompt)", JSON.stringify(sw));

    const rooms3 = JSON.parse(fs.readFileSync(path.join(tmp2, "desktop", "rooms.json"), "utf8"));
    const swRow = (rooms3.rooms[0].transcript || []).find(
      (e) => e.kind === "task_state" && e.state === "reassigned"
    );
    check(!!swRow && swRow.from_bot === "b-old" && swRow.to_bot === "b-new",
      "TC-18 落了一行 task_state/reassigned(可审计)", JSON.stringify(swRow));
    check(!!(rooms3.rooms[0].transcript || []).find((e) => e.kind === "task_state" && e.state === "steered"),
      "TC-18 插话与换人落在**同一条时间线**上(能一起回看)");

    // 编排读换人指令 ⇒ 真的换人
    const dirSwap = s3.latestReassignment(rooms3.rooms[0]);
    check(dirSwap && dirSwap.from_bot === "b-old" && dirSwap.to_bot === "b-new",
      "TC-19 编排读得到换人指令", JSON.stringify(dirSwap));

    // 纯函数真跑:候选池里真的换了
    const cand = [{ id: "b-old", name: "老王" }, { id: "b-new", name: "小李" }];
    const applied = s3.applyReassignment(cand, dirSwap, [
      { id: "b-old", name: "老王" }, { id: "b-new", name: "小李" },
    ]);
    check(applied && applied.applied === true && cand[0].id === "b-new",
      "TC-19 候选池里那个人真的被换掉了(纯函数真跑)", JSON.stringify({ applied, cand }));
    check(cand.length === 2, "TC-19 换人不改候选池的**长度**(不凭空多一个人)");

    // 负向
    check(s3.reassignRoomTask("r1|s", "r1", "b-old", "不存在的人").error === "bot_not_found",
      "TC-20 负向:新人选不存在");
    check(s3.reassignRoomTask("r1|s", "r1", "b-old", "外人").error === "bot_not_in_room",
      "TC-20 负向:新人选不在这个群里(**不能让人去一个不在群里的人**)");
    check(s3.reassignRoomTask("r1|s", "r1", "b-old", "b-old").error === "same_bot",
      "TC-20 负向:换成自己");
    check(s3.reassignRoomTask("r1|s", "r1", "", "b-new").error === "from_bot_required",
      "TC-20 负向:没说要换谁");
    check(s3.reassignRoomTask("r1|s", "r1", "b-old", "").error === "to_bot_required",
      "TC-20 负向:没说换成谁");
    check(s3.reassignRoomTask("", "r1", "b-old", "b-new").error === "task_sig_required",
      "TC-20 负向:空 task_sig");

    // 编排源码真的用了这个纯函数(只有一个替换点)
    const psrc = fs.readFileSync(path.join(REPO, "hosts", "desktop", "product_surface.js"), "utf8");
    // 判据必须精确到**调用**:`function applyReassignment(candidates, reassign, ...)`
    // 这个定义本身也会命中前缀 —— 只看前缀 ⇒ 删掉调用反而门禁还是绿的(踩过)。
    const applyCalls = psrc.match(/[^a-zA-Z]applyReassignment\(candidates, reassign, loadBots\(\)/g) || [];
    check(applyCalls.length === 1,
      "TC-21 编排**真的调用了**它(且只在一处调用:接力+并行两路都覆盖)", applyCalls.length);
    check(!/function applyReassignment\(candidates, reassign, loadBots\(\)/.test(psrc),
      "TC-21 定义与调用不是同一处(判据没被定义本身骗到)");

    // ── Task 实体(批 4)─────────────────────────────────────────────────
    {
      const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "bitbot-task-"));
      fs.mkdirSync(path.join(tmp3, "desktop"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp3, "desktop", "rooms.json"),
        JSON.stringify({ rooms: [{ id: "r1", title: "群", members: [], transcript: [] }] })
      );
      const t1 = surfaceMod.createProductSurface(REPO, { dataRoot: tmp3 });

      // 收口 ⇒ Task 实体写 state=done
      t1.appendRoomTranscript("r1", {
        kind: "final_report", room_id: "r1", task_sig: "r1|sig-1",
        task: "写稿子", task_title: "写稿子", total: 2, returned: 2, partial: false, at: "x",
      });
      const t1tasks = t1.listTasks();
      const rec1 = t1tasks.find((x) => x.id === "r1|sig-1");
      check(!!rec1 && rec1.state === "done",
        "TC-26 final_report ⇒ Task 实体记 done", JSON.stringify(rec1));
      check(!!rec1 && rec1.task === "写稿子",
        "TC-26 Task 实体记着任务标题(不是只有状态)", JSON.stringify(rec1 && rec1.task));

      // 问人 ⇒ state=waiting
      t1.appendRoomTranscript("r1", {
        kind: "confirm_request", room_id: "r1", task_sig: "r1|sig-2",
        task: "选谁", question: "该谁做?", at: "x",
      });
      check((t1.listTasks().find((x) => x.id === "r1|sig-2") || {}).state === "waiting",
        "TC-26 confirm_request ⇒ Task 实体记 waiting");

      // 取消 ⇒ state=cancelled
      t1.appendRoomTranscript("r1", {
        kind: "task_state", room_id: "r1", task_sig: "r1|sig-1",
        state: "cancelled", reason: "user_stop", at: "x",
      });
      check((t1.listTasks().find((x) => x.id === "r1|sig-1") || {}).state === "cancelled",
        "TC-26 刹停 ⇒ Task 实体记 cancelled");

      // 改向 ⇒ 任务文本更新
      t1.appendRoomTranscript("r1", {
        kind: "task_state", room_id: "r1", task_sig: "r1|sig-3",
        state: "replanned", task: "改成写竞品", prev_message_id: "sig-3", at: "x",
      });
      check((t1.listTasks().find((x) => x.id === "r1|sig-3") || {}).task === "改成写竞品",
        "TC-27 改向 ⇒ Task 实体的目标更新了");

      // 负向:没有 task_sig ⇒ **不写** Task(不编)
      const before = t1.listTasks().length;
      t1.appendRoomTranscript("r1", { kind: "final_report", room_id: "r1", task: "无 sig", at: "x" });
      check(t1.listTasks().length === before,
        "TC-27 负向:没有 task_sig ⇒ 不写 Task(**不编一个出来**)", t1.listTasks().length);

      // **跨会话**:换一个 surface 实例(≈重启进程)⇒ Task 还在
      const t2 = surfaceMod.createProductSurface(REPO, { dataRoot: tmp3 });
      const t2tasks = t2.listTasks();
      check(t2tasks.length === 3,
        "TC-28 跨会话:换实例(≈重启)⇒ Task 实体还在", t2tasks.length);
      check((t2tasks.find((x) => x.id === "r1|sig-1") || {}).state === "cancelled",
        "TC-28 跨会话:状态也还在");

      // 多进程合并:两个实例各写一条 ⇒ 都还在(不整表覆盖)
      t1.appendRoomTranscript("r1", { kind: "task_state", room_id: "r1", task_sig: "r1|sig-4", state: "cancelled", at: "x" });
      t2.appendRoomTranscript("r1", { kind: "task_state", room_id: "r1", task_sig: "r1|sig-5", state: "cancelled", at: "x" });
      const merged = surfaceMod.createProductSurface(REPO, { dataRoot: tmp3 }).listTasks();
      check(merged.length === 5,
        "TC-28 多进程各写一条 ⇒ 都在(按 id 合并,不整表覆盖)", merged.length);

      fs.rmSync(tmp3, { recursive: true, force: true });
    }

    fs.rmSync(tmp2, { recursive: true, force: true });
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ══════════════════════════════════════════════════════════════════════
// C. 真渲染:按钮只给真在跑的
// ══════════════════════════════════════════════════════════════════════
(async function render() {
  const benv = resolveBrowser();
  if (!benv.pw || !benv.exe) {
    console.log("  · SKIP " + benv.reason + " —— 渲染门没跑(不算通过)");
    console.log("\nprove_command_task_control: SKIP(" + benv.reason + ")");
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
  await page.addInitScript(() => {
    window.bitbot = Object.assign(window.bitbot || {}, {
      routines: {
        list: async (p) => {
          const rid = String((p && p.roomId) || "");
          if (rid === "r-done") {
            return { ok: true, routines: [
              { id: "rt-1", room_id: "r-done", prompt: "每天9点采集AI热点", cron: "0 9 * * *",
                enabled: true, next_due_label: "明天 09:00", once_done: false, last_fired_label: "今天 09:00" },
              { id: "rt-2", room_id: "r-done", prompt: "一次性:发上周周报", cron: "",
                enabled: true, next_due: null, once_done: true, last_fired_label: "昨天 18:30" },
            ] };
          }
          if (rid === "r-err") throw new Error("读不到");
          return { ok: true, routines: [] };
        },
      },
      tasks: {
        list: async () => ({ ok: true, tasks: [
          { id: "sig-run-1", room_id: "r-run", task: "旧活儿", title: "旧活儿", state: "done", updated_at: "2026-11-20T10:00:00.000Z" },
          { id: "sig-gone", room_id: "r-old", task: "转录已滚出的那批", title: "转录已滚出的那批", state: "waiting", updated_at: "2026-11-19T10:00:00.000Z" },
        ] }),
      },
      rooms: {
        list: async () => ({
          rooms: {
            version: 1,
            rooms: [
              { id: "r-run", title: "在跑", transcript: [
                { kind: "bot_reply", room_id: "r-run", speaker: "t1", bot_id: "t1", name: "Alice", text: "正在写第一段…", task_sig: "sig-run-1", at: "2026-11-21T12:00:00.000Z" },
                { kind: "bot_reply", room_id: "r-run", speaker: "t2", bot_id: "t2", name: "Bob", text: "第二段完成", task_sig: "sig-run-1", at: "2026-11-21T12:00:30.000Z" },
              ]},
              { id: "r-done", title: "已完成", transcript: [
                { kind: "bot_reply", room_id: "r-done", speaker: "t1", bot_id: "t1", name: "Alice", text: "稿子好了", at: "2026-11-21T10:00:00.000Z" },
                { kind: "final_report", room_id: "r-done", task: "整理稿", task_sig: "sig-done", responders: ["t1"], total: 1, returned: 1, partial: false, artifacts: [], at: "2026-11-21T10:01:00.000Z" },
              ]},
            ],
          },
        }),
        cancelTask: async () => ({ ok: true, cancelled: 1 }),
      },
    });
  });
  await page.goto("file://" + HTML, { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__bitbotCommand.open());
  await page.waitForTimeout(500);

  const dom = await page.evaluate(() => {
    const d = document.getElementById("cmd-detail");
    return {
      text: d ? d.textContent : "",
      cancelBtns: document.querySelectorAll("[data-cmd-cancel]").length,
      cancelSig: (document.querySelector("[data-cmd-cancel]") || {}).dataset
        ? document.querySelector("[data-cmd-cancel]").dataset.cmdCancel : "",
      stepNames: Array.from(document.querySelectorAll(".cmd-step-name")).map((n) => n.textContent),
      stepTexts: Array.from(document.querySelectorAll(".cmd-step-text")).map((n) => n.textContent),
    };
  });

  check(dom.stepNames.indexOf("Alice") >= 0 && dom.stepNames.indexOf("Bob") >= 0,
    "TC-6 两个成员的名字都出现在明细里(并行看得见)", JSON.stringify(dom.stepNames));
  check(dom.stepTexts.some((t) => t.indexOf("正在写第一段") >= 0),
    "TC-6 明细里能看到某个成员**干了什么**", JSON.stringify(dom.stepTexts));
  check(dom.cancelBtns === 1, "TC-7 刹停按钮只给真在跑的那个任务(1 个)", dom.cancelBtns);
  check(dom.cancelSig === "sig-run-1" || dom.cancelSig === "",
    "TC-7 按钮带的是真 task_sig(没带就不该给按钮)", dom.cancelSig);
  check(dom.text.indexOf("整理稿") >= 0, "TC-6 已完的任务也在列表里");

  // 点击按钮 ⇒ 真的调 cancelTask
  await page.evaluate(() => {
    window.__cmdCancelCalls = [];
    window.bitbot.rooms.cancelTask = async (p) => {
      window.__cmdCancelCalls.push(p);
      return { ok: true, cancelled: 1 };
    };
  });
  await page.evaluate(() => {
    const b = document.querySelector("[data-cmd-cancel]");
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__cmdCancelCalls || []);
  check(calls.length === 1 && calls[0] && calls[0].task_sig,
    "TC-8 点刹停 ⇒ 真的调了 cancelTask(带 task_sig)", JSON.stringify(calls));
  check(calls.length === 1 && calls[0] && calls[0].reason === "user_stop",
    "TC-8 停的理由写明是 user_stop(可审计)", JSON.stringify(calls[0] || {}));

  // 指挥区:一句输入 + 插话 / 改向
  const cmdUi = await page.evaluate(() => ({
    inputs: document.querySelectorAll(".cmd-input").length,
    steer: document.querySelectorAll("[data-cmd-steer]").length,
    replan: document.querySelectorAll("[data-cmd-replan]").length,
  }));
  check(cmdUi.inputs >= 1, "TC-15 指挥区有输入框", cmdUi.inputs);
  check(cmdUi.steer >= 1 && cmdUi.replan >= 1, "TC-15 插话/改向按钮都在", JSON.stringify(cmdUi));

  await page.evaluate(() => {
    window.__cmdSteerCalls = [];
    window.bitbot.rooms.steerTask = async (p) => { window.__cmdSteerCalls.push(p); return { ok: true, scope: "next_hop" }; };
    window.bitbot.rooms.replanTask = async (p) => { window.__cmdSteerCalls.push(Object.assign({ via: "replan" }, p)); return { ok: true }; };
  });
  await page.evaluate(() => {
    const inp = document.querySelector(".cmd-input");
    if (inp) inp.value = "插一句：重点看数据";
    const b = document.querySelector("[data-cmd-steer]");
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const steerCalls = await page.evaluate(() => window.__cmdSteerCalls || []);
  check(steerCalls.length === 1 && String(steerCalls[0].text || "").indexOf("重点看数据") >= 0,
    "TC-16 点插话 ⇒ 真的把那句原文发出去", JSON.stringify(steerCalls));
  check(steerCalls.length === 1 && !!steerCalls[0].task_sig,
    "TC-16 插话带 task_sig(知道是对谁说的)", JSON.stringify(steerCalls[0] || {}));

  // 空输入 ⇒ 不该发任何东西(诚实:先写一句)
  await page.evaluate(() => {
    window.__cmdSteerCalls = [];
    const inp = document.querySelector(".cmd-input");
    if (inp) inp.value = "   ";
    const b = document.querySelector("[data-cmd-steer]");
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  const emptyCalls = await page.evaluate(() => window.__cmdSteerCalls || []);
  check(emptyCalls.length === 0, "TC-16 负向:空输入 ⇒ 不发任何东西", JSON.stringify(emptyCalls));

  // 换人:每个成员旁一个「换人」,读同一张卡的输入框当新人选
  const swapUi = await page.evaluate(() => ({
    btns: document.querySelectorAll("[data-cmd-swap]").length,
    from: (document.querySelector("[data-cmd-swap]") || { dataset: {} }).dataset.cmdSwap || "",
  }));
  check(swapUi.btns >= 1, "TC-22 成员旁有「换人」按钮", swapUi.btns);
  check(swapUi.from === "t1", "TC-22 按钮带的是那个成员的 id", swapUi.from);

  await page.evaluate(() => {
    window.__cmdSwapCalls = [];
    window.bitbot.rooms.reassignTask = async (p) => { window.__cmdSwapCalls.push(p); return { ok: true, scope: "next_hop" }; };
  });
  await page.evaluate(() => {
    const card = document.querySelector("[data-cmd-task]");
    const inp = card ? card.querySelector(".cmd-input") : null;
    if (inp) inp.value = "小李";
    const b = document.querySelector("[data-cmd-swap]");
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const swapCalls = await page.evaluate(() => window.__cmdSwapCalls || []);
  check(swapCalls.length === 1 && swapCalls[0].from_bot === "t1" && swapCalls[0].to_bot === "小李",
    "TC-23 点换人 ⇒ 把「谁」和「换成谁」都发出去", JSON.stringify(swapCalls));
  check(swapCalls.length === 1 && !!swapCalls[0].task_sig,
    "TC-23 换人带 task_sig(知道是在改哪一批)", JSON.stringify(swapCalls[0] || {}));

  await page.evaluate(() => {
    window.__cmdSwapCalls = [];
    const card = document.querySelector("[data-cmd-task]");
    const inp = card ? card.querySelector(".cmd-input") : null;
    if (inp) inp.value = "  ";
    const b = document.querySelector("[data-cmd-swap]");
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  const swapEmpty = await page.evaluate(() => window.__cmdSwapCalls || []);
  check(swapEmpty.length === 0, "TC-23 负向:空输入 ⇒ 不发任何东西", JSON.stringify(swapEmpty));

  // 批 4:Task 实体的状态**优先**于从转录推的;转录已滚出的批次要补「仅记录」卡
  const taskUi = await page.evaluate(() => {
    const d = document.getElementById("cmd-detail");
    return {
      text: d ? d.textContent : "",
      archived: document.querySelectorAll(".cmd-tag").length,
      hasGone: d ? d.textContent.indexOf("转录已滚出的那批") >= 0 : false,
      oldDone: d ? d.textContent.indexOf("旧活儿") >= 0 : false,
    };
  });
  check(taskUi.hasGone, "TC-24 转录已滚出的那批 ⇒ 指挥台**还认得**(Task 实体补回来的)");
  check(taskUi.archived >= 1, "TC-24 它被标成「仅记录」", taskUi.archived);
  check(taskUi.oldDone, "TC-24 Task 里的任务标题出现在列表里");

  const bucketState = await page.evaluate(() => {
    const t = window.__bitbotCommand.aggregate(
      [{ id: "r", title: "x", transcript: [] }],
      [{ id: "sig-run-1", state: "done", task: "干完了" }]
    );
    return t.map((x) => ({ bucket: x.bucket, persisted: !!x.persisted }));
  });
  check(bucketState.length === 1 && bucketState[0].bucket === "closed",
    "TC-25 Task 实体说 done ⇒ 归「已完」(**实体优先于转录推导**)", JSON.stringify(bucketState));
  check(bucketState.length === 1 && bucketState[0].persisted === true,
    "TC-25 标成 persisted(知道它来自 Task 实体)");

  // 批 H:值班区
  const dutyUi = await page.evaluate(() => {
    const d = document.getElementById("cmd-duty");
    return { text: d ? d.textContent : "", rows: document.querySelectorAll(".cmd-duty-row").length };
  });
  check(dutyUi.rows >= 2, "TC-29 值班区画出了排班行", dutyUi.rows);
  check(dutyUi.text.indexOf("每天9点采集AI热点") >= 0, "TC-29 值班区写着排班内容(真 prompt)");
  check(dutyUi.text.indexOf("明天 09:00") >= 0, "TC-29 值班区写着下次什么时候跑");
  check(dutyUi.text.indexOf("昨天 18:30") >= 0, "TC-29 一次性任务显示**上次**跑的时间(不是说「还没排上」)");

  // 批 I:复盘区
  const revUi = await page.evaluate(() => {
    const d = document.getElementById("cmd-review");
    return { text: d ? d.textContent : "", rows: document.querySelectorAll(".cmd-review-row").length };
  });
  check(revUi.rows >= 1, "TC-30 复盘区画出了完成的批次", revUi.rows);
  check(revUi.text.indexOf("旧活儿") >= 0, "TC-30 复盘区写着做完了什么");

  // 负向:排班读不到 ⇒ 如实说「没有排班任务」,**不编一条出来**
  await page.evaluate(() => {
    window.bitbot.routines.list = async () => { throw new Error("读不到排班"); };
  });
  await page.evaluate(() => window.__bitbotCommand.refresh());
  await page.waitForTimeout(400);
  const dutyFail = await page.evaluate(() => {
    const d = document.getElementById("cmd-duty");
    return { text: d ? d.textContent : "", rows: document.querySelectorAll(".cmd-duty-row").length };
  });
  check(dutyFail.rows === 0, "TC-31 排班读不到 ⇒ 值班区**没有编出任何一行**", dutyFail.rows);
  check(dutyFail.text.indexOf("没有排班任务") >= 0 || dutyFail.text.indexOf("No scheduled duties") >= 0,
    "TC-31 排班读不到 ⇒ 如实说没有排班任务", dutyFail.text.slice(0, 80));

  check(errs.length === 0, "TC-9 页面没有 pageerror", JSON.stringify(errs.slice(0, 3)));

  await browser.close();
  console.log("\nprove_command_task_control: PASS=" + pass + " FAIL=" + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_command_task_control: " + String((e && e.stack) || e));
  console.log("\nprove_command_task_control: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
