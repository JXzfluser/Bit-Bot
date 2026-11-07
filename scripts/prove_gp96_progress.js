#!/usr/bin/env node
"use strict";

// A per-run id: the agent context is keyed by (bot, session), so a unique
// session keeps each run from inheriting the previous run's history.
const RUN_ID = Date.now().toString(36) + "-" + process.pid;
/**
 * GP-96/97/98 §5.7 进度更新 proof — runs without Electron.
 *
 * Official §5.7 list: 工具活动 / Computer 使用 / 创建的文件 / 问题 / 审批请求 / 语音消息.
 *
 * This probe drives the real Host FFI + kernel chain with a stub provider and
 * asserts the progress events the UI would render:
 *   - 2×N ordering: every effect gets exactly one `start` then one `done`,
 *     plus a final `host_continuing` before the kernel resumes.
 *   - `total` is the real effect array length, never a guess.
 *   - categorizeEffect maps result flags (needs_approval → approval_request,
 *     needs_confirm → question) over the static kind table.
 *   - created_files done carries a real on-disk path (GP-98 honesty).
 *   - refusals emit done ok:false, never silently dropped.
 *   - renderer reducer (createProgressState) consumes the same events and
 *     reaches a finished state with the right category counts.
 *
 * Usage: node scripts/prove_gp96_progress.js   (exit 0 = all assertions green)
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { asarPathOf } = require("./lib_pack_manifest.js");

const REPO = path.resolve(__dirname, "..");
const STUB_PORT = Number(process.env.BITBOT_G96_STUB_PORT || 8796);

let PASS = 0;
let FAIL = 0;
const ok = (name) => {
  PASS++;
  console.log("  ✓ " + name);
};
const bad = (name, detail) => {
  FAIL++;
  console.log("  ✗ " + name + (detail ? " — " + String(detail).slice(0, 200) : ""));
};

async function main() {
  console.log("GP-96/97/98 §5.7 进度更新 proof");

  /* ---- 1) Protocol module: categories + reducer ---- */
  const protocol = require(path.join(REPO, "hosts/desktop/progress_protocol.js"));
  const expected = ["tool_activity", "computer_use", "created_files", "question", "approval_request", "voice_message"];
  JSON.stringify(protocol.CATEGORIES) === JSON.stringify(expected)
    ? ok("GP-96 官方 §5.7 六类 + model_reply 共 7 个 category")
    : bad("GP-96 categories", protocol.CATEGORIES);

  // categorizeEffect: result flags outrank the static kind table
  protocol.categorizeEffect("shell", { needs_approval: true }) === "approval_request"
    ? ok("GP-96 needs_approval → approval_request (不论 kind)")
    : bad("GP-96 approval flag", protocol.categorizeEffect("shell", { needs_approval: true }));

  protocol.categorizeEffect("shell", { needs_confirm: true }) === "question"
    ? ok("GP-96 needs_confirm → question")
    : bad("GP-96 confirm flag", protocol.categorizeEffect("shell", { needs_confirm: true }));

  protocol.categorizeEffect("copy_to_box", {}) === "created_files"
    ? ok("GP-96 copy_to_box → created_files")
    : bad("GP-96 kind table", protocol.categorizeEffect("copy_to_box", {}));

  protocol.categorizeEffect("computer_use", {}) === "computer_use"
    ? ok("GP-96 computer_use → computer_use")
    : bad("GP-96 computer kind", protocol.categorizeEffect("computer_use", {}));

  protocol.categorizeEffect("voice_session", {}) === "voice_message"
    ? ok("GP-96 voice_session → voice_message")
    : bad("GP-96 voice kind", protocol.categorizeEffect("voice_session", {}));

  protocol.categorizeEffect("llm_chat", {}) === "model_reply"
    ? ok("GP-96 llm_chat → model_reply")
    : bad("GP-96 llm_chat", protocol.categorizeEffect("llm_chat", {}));

  protocol.categorizeEffect("unknown_kind", {}) === "tool_activity"
    ? ok("GP-96 未知 kind 默认 tool_activity")
    : bad("GP-96 default", protocol.categorizeEffect("unknown_kind", {}));

  // Reducer: turn_start → start → done → host_continuing → turn_end
  const st = protocol.createProgressState();
  st.apply({ phase: "turn_start", total: 2 });
  st.apply({ phase: "start", index: 1, total: 2, kind: "copy_to_box" });
  st.apply({ phase: "done", index: 1, total: 2, kind: "copy_to_box", ok: true, path: "/tmp/x.txt" });
  st.apply({ phase: "start", index: 2, total: 2, kind: "shell" });
  st.apply({ phase: "done", index: 2, total: 2, kind: "shell", ok: true });
  st.apply({ phase: "host_continuing", category: "model_reply" });
  st.apply({ phase: "turn_end" });
  st.state.phase === "finished" && st.state.doneCount === 2
    ? ok("GP-97 reducer 走完 2 个 effect 后 phase=finished, doneCount=2")
    : bad("GP-97 reducer", { phase: st.state.phase, doneCount: st.state.doneCount });

  /* ---- 2) Emitter module: 2×N ordering + total honesty ---- */
  const { createProgressEmitter, existingPathFromResult } = require(path.join(REPO, "hosts/shared/turn_progress.js"));
  const events = [];
  const emitter = createProgressEmitter({
    onProgress: (ev) => events.push(ev),
    total: 3,
    turnId: "gp96-test",
    sessionId: "sess-gp96-" + RUN_ID,
    repoRoot: REPO,
  });
  emitter.start(1, { kind: "copy_to_box", command: "desk-1|src|dest" });
  emitter.done(1, { kind: "copy_to_box", command: "desk-1|src|dest" }, { ok: true, path: "/tmp/exists.txt" });
  emitter.start(2, { kind: "shell", command: "echo hi" });
  emitter.done(2, { kind: "shell", command: "echo hi" }, { ok: false, error: "refused" });
  emitter.start(3, { kind: "approval_card", command: "Shell :: echo :: ask" });
  emitter.done(3, { kind: "approval_card", command: "Shell :: echo :: ask" }, { ok: false, needs_approval: true, approval_id: "a1" });
  emitter.raw({ phase: "host_continuing", category: "model_reply", label_key: "model" });

  events.length === 7
    ? ok("GP-96 emitter 产生 2×N + 1 个事件 (3 effects → 7 rows)")
    : bad("GP-96 event count", events.length);

  events[0].total === 3 && events[1].total === 3 && events[2].total === 3
    ? ok("GP-96 total 字段是真实 effect 数 (3), 不猜")
    : bad("GP-96 total", events.map(e => e.total));

  events[1].ok === true && events[3].ok === false && events[5].ok === false
    ? ok("GP-98 done.ok 反映真实结果 (成功/失败/审批)")
    : bad("GP-98 ok flags", events.map(e => e.ok));

  events[5].awaiting === "approval"
    ? ok("GP-96 needs_approval → awaiting=approval")
    : bad("GP-96 awaiting", events[5].awaiting);

  events[6].phase === "host_continuing" && events[6].category === "model_reply"
    ? ok("GP-97 host_continuing 事件在 effects 之后发出")
    : bad("GP-97 continuing", events[6]);

  // existingPathFromResult: only returns a path when the file actually exists
  const tmpFile = "/tmp/gp96-probe-file-" + Date.now() + ".txt";
  fs.writeFileSync(tmpFile, "test");
  const realPath = existingPathFromResult({ path: tmpFile }, REPO);
  realPath === tmpFile
    ? ok("GP-98 existingPathFromResult 返回真实存在的路径")
    : bad("GP-98 real path", realPath);
  const fakePath = existingPathFromResult({ path: "/tmp/does-not-exist-gp96" }, REPO);
  fakePath === ""
    ? ok("GP-98 existingPathFromResult 对不存在路径返回空串")
    : bad("GP-98 fake path", fakePath);
  fs.unlinkSync(tmpFile);

  /* ---- 3) Real kernel turn: progress events stream during execution ---- */
  const stub = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BITBOT_STUB_PORT: String(STUB_PORT), BITBOT_STUB_LATENCY_MS: "800" },
  });
  const stubUp = await new Promise((res) => {
    const t = setTimeout(() => res(false), 8000);
    stub.stdout.on("data", (d) => {
      if (String(d).includes("[stub-llm]")) {
        clearTimeout(t);
        res(true);
      }
    });
    stub.on("error", () => { clearTimeout(t); res(false); });
  });
  if (!stubUp) {
    bad("GP-96 stub 启动", "openai_compat_stub.js 未在 8s 内就绪");
    throw new Error("stub unavailable");
  }

  Object.assign(process.env, {
    BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1",
    BITBOT_LLM_API_KEY: "gp96-probe-key",
    BITBOT_LLM_MODEL: "gp96-probe",
    BITBOT_LLM_STREAM: "0",
    BITBOT_STUB_REPLY: "GP96 测试回复",
  });

  const { createTurnRunner } = require(path.join(REPO, "hosts/shared/run_moon_turn.js"));
  const runner = createTurnRunner(REPO);
  const turnEvents = [];
  const t0 = Date.now();
  const res = await runner.runTurn("GP96 随便聊一句", {
    sessionId: "sess-gp96probe-" + RUN_ID,
    machineId: "desk-1",
    machineKind: "desktop",
    onProgress: (ev) => turnEvents.push(Object.assign({ wall: Date.now() - t0 }, ev)),
  });

  res.ok === true
    ? ok("GP-96 真实 kernel 回合成功")
    : bad("GP-96 kernel turn", res.error);

  /* ── 2026-11-02 复核（本文件此前不在聚合矩阵里，所以这一段今天第一次真跑）──
     内核换成 AgentLoop 之后，一次「纯聊天」回合**没有任何批量 effects**：模型跳
     发生在 hosts/shared/agent_loop_product_wire.js 里，executeHostEffects 的进度
     发射器一次都没被喂到 ⇒ 上面这两条计数断言当场红（0 rows），而 2×N 排序那条
     是「0 start + 0 done 一一对应」——恒真的绿。这是尺子和产品同时有问题：
       · 产品：AgentLoop 的 llm 跳 / 真效果必须自己发进度行（本轮已修，见 report.md §8.62）；
       · 尺子：0 对不能算「排序正确」，并且 ≥3 行这条要落在**真的有效果边界**的回合上。
     所以这里跑两遍：A 纯聊天（证明模型跳可见 + 首行早于回合结束），
     B 脚本化 tool_call（证明效果边界 start/done、2×N、total=真实效果数）。 */
  const chatPairs = turnEvents.filter((e) => e.phase === "start").length;
  turnEvents.length >= 2 && chatPairs >= 1
    ? ok("GP-97 纯聊天回合也有进度行：" + turnEvents.length + " rows（model_reply 起 " + chatPairs + " 跳）")
    : bad("GP-97 纯聊天回合零进度行（AgentLoop 的 llm 跳没发进度）", turnEvents.length);

  // GP-97 slow provider: the FIRST progress event must arrive well before the
  // turn resolves. The stub holds the HTTP response for 800ms; if progress
  // only fired after delivery, all wall times would be >=800ms. The point of
  // §5.7 is that the UI row is visible while the provider is still thinking.
  //
  // 判据从"绝对 100ms"改成"至少比回合结束早一半（且本身在 400ms 内）"：
  // 绝对阈值卡的是机器负载，不是行为。并行跑 33 个门禁时首个事件会到
  // 101~149ms，断言就红，而 149ms / 976ms 的回合其实完全满足"边想边显示"。
  const firstWall = turnEvents.length > 0 ? turnEvents[0].wall : Infinity;
  const lastWall = turnEvents.length > 0 ? turnEvents[turnEvents.length - 1].wall : 0;
  firstWall < 400 && firstWall * 2 < lastWall && lastWall > 500
    ? ok("GP-97 慢 provider 下首个进度事件在 " + firstWall + "ms 可见 (回合 " + lastWall + "ms 才结束)")
    : bad("GP-97 slow provider", JSON.stringify({ first: firstWall, last: lastWall }));

  /* ---- 3b) Tool turn: real effect boundaries must stream (§5.7 工具活动) ---- */
  const TOOL_PORT = STUB_PORT + 1;
  const toolStub = spawn(process.execPath, [path.join(REPO, "scripts/dev_stubs/openai_compat_stub.js")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BITBOT_STUB_PORT: String(TOOL_PORT),
      BITBOT_STUB_MODE: "toolcall",
      BITBOT_STUB_LATENCY_MS: "200",
      // 一次真工具调用：kernel 让模型调 web_fetch → Host 真的 executeHostEffects
      // → 边界上发 start/done → kernel 续跑第二跳收尾。这证明的是**工具链路**，
      // 不是模型质量（stub 自己的头注释里同一句话）。
      BITBOT_STUB_TOOL_SCRIPT: JSON.stringify([
        { tool_calls: [{ id: "c1", name: "web_fetch", arguments: { url: "http://127.0.0.1:" + TOOL_PORT + "/v1/healthz" } }] },
        { content: "GP96 工具回合完成" },
      ]),
    },
  });
  const toolStubUp = await new Promise((res) => {
    const t = setTimeout(() => res(false), 8000);
    toolStub.stdout.on("data", (d) => {
      if (String(d).includes("[stub-llm]")) {
        clearTimeout(t);
        res(true);
      }
    });
    toolStub.on("error", () => { clearTimeout(t); res(false); });
  });
  if (!toolStubUp) {
    bad("GP-96 工具回合 stub 启动", "openai_compat_stub.js(toolcall) 未在 8s 内就绪");
  } else {
    Object.assign(process.env, {
      BITBOT_LLM_BASE_URL: "http://127.0.0.1:" + TOOL_PORT + "/v1",
    });
    const toolEvents = [];
    const t1 = Date.now();
    const resB = await runner.runTurn("GP96 用工具抓一个链接", {
      sessionId: "sess-gp96tool-" + RUN_ID,
      machineId: "desk-1",
      machineKind: "desktop",
      onProgress: (ev) => toolEvents.push(Object.assign({ wall: Date.now() - t1 }, ev)),
    });
    resB.ok === true
      ? ok("GP-96 工具回合（真 effect 边界）成功")
      : bad("GP-96 工具回合", resB.error);

    toolEvents.length >= 3
      ? ok("GP-97 进度事件在回合期间发出 (" + toolEvents.length + " rows，含 " +
        toolEvents.filter((e) => e.phase === "start" && e.category === "tool_activity").length + " 条工具活动)")
      : bad("GP-97 event count", toolEvents.length);

    // GP-96 2×N ordering: every start has a matching done with the same index.
    // 加了 starts.length >= 1：0 对不算「一一对应」（上一版就是这么恒真通过的）。
    const starts = toolEvents.filter(e => e.phase === "start");
    const dones = toolEvents.filter(e => e.phase === "done");
    starts.length >= 1 && starts.length === dones.length && starts.every((s, i) => dones[i] && dones[i].index === s.index)
      ? ok("GP-96 2×N 排序: " + starts.length + " start + " + dones.length + " done 一一对应")
      : bad("GP-96 ordering", { starts: starts.map(s => s.index), dones: dones.map(d => d.index) });

    // GP-96 total is real effect count（工具回合里 total 必须来自真实效果数）
    const totals = toolEvents.map(e => e.total).filter(t => t > 0);
    totals.length > 0 && totals.every(t => t === totals[0])
      ? ok("GP-96 total 字段一致 (" + totals[0] + "，来自真实 effect 数组长度)")
      : bad("GP-96 total consistency", totals);
  }
  try { toolStub.kill(); } catch (_) { /* 收尾 */ }


  stub.kill();

  /* ---- 4) Shipped wiring: main.js / preload / CLI / package ---- */
  const mainJs = fs.readFileSync(path.join(REPO, "hosts/desktop/main.js"), "utf8");
  const preload = fs.readFileSync(path.join(REPO, "hosts/desktop/preload.js"), "utf8");
  const cliRun = fs.readFileSync(path.join(REPO, "hosts/cli_host/run_turn.js"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "hosts/desktop/package.json"), "utf8"));

  /onProgress:\s*\(ev\)\s*=>/.test(mainJs) && /broadcast\("bitbot:turn-progress"/.test(mainJs)
    ? ok("GP-96 main.js: onProgress → IPC broadcast")
    : bad("GP-96 main wiring", "missing onProgress or broadcast");

  /onTurnProgress:\s*\(cb\)/.test(preload) && /bitbot:turn-progress/.test(preload)
    ? ok("GP-96 preload.js: onTurnProgress IPC channel")
    : bad("GP-96 preload wiring", "missing onTurnProgress");

  /BITBOT_CLI_PROGRESS/.test(cliRun) && /onProgress:/.test(cliRun)
    ? ok("GP-96 CLI: BITBOT_CLI_PROGRESS=1 → stderr progress")
    : bad("GP-96 CLI wiring", "missing progress hook");

  asarPathOf((pkg.build && pkg.build.files) || [], "progress_protocol.js") === "desktop/progress_protocol.js"
    ? ok("GP-96 progress_protocol.js 打进包（落在 desktop/）")
    : bad("GP-96 package files", pkg.build && pkg.build.files);

  /* ---- 5) Renderer: i18n keys + lifecycle ---- */
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  const i18nKeys = ["progTool", "progComputer", "progFiles", "progQuestion", "progApproval", "progVoice", "progModel", "progAwaiting", "progFailedSuffix", "progContinuing"];
  /* 上一版只判「这个 key 在文件里出现过」—— 三份字典里只要有一份写了就算过，
     于是英文/繁体缺词条时门还是绿的（真机上就出现过中文界面挂英文进度行）。
     现在按字典行数数：WAVEG_I18N 有 zh-CN / zh-TW / en 三份，每份一行，
     少于 3 行就是缺语言。 */
  const missing = i18nKeys
    .map((k) => ({ k, n: (html.match(new RegExp("\\n\\s*" + k + ":", "g")) || []).length }))
    .filter((x) => x.n < 3)
    .map((x) => x.k + "×" + x.n);
  missing.length === 0
    ? ok("GP-97 renderer i18n: 10 个 prog* 键 ×3 语言（按字典行数数）")
    : bad("GP-97 i18n keys", missing);

  /resetProgressRow\(\)/.test(html) && /finishProgressRow\(\)/.test(html)
    ? ok("GP-97 renderer lifecycle: resetProgressRow + finishProgressRow")
    : bad("GP-97 lifecycle", "missing reset/finish calls");

  /id="turn-progress"/.test(html) && /aria-live="polite"/.test(html)
    ? ok("GP-97 renderer DOM: #turn-progress row with aria-live")
    : bad("GP-97 DOM", "missing progress element");

  /* ---- 6) Host FFI: results.push interception ---- */
  const hostFfi = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
  /results\.push\s*=\s*function/.test(hostFfi) && /closeDangling\(\)/.test(hostFfi)
    ? ok("GP-96 host_ffi.js: results.push 拦截 + closeDangling fallback")
    : bad("GP-96 FFI interception", "missing push wrap or closeDangling");

  /progress\.raw\(\{\s*phase:\s*"host_continuing"/.test(hostFfi)
    ? ok("GP-97 host_ffi.js: host_continuing 事件在 delivery 之前")
    : bad("GP-97 continuing emission", "missing host_continuing raw event");

  console.log("\n" + PASS + " passed, " + FAIL + " failed");
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(2);
});
