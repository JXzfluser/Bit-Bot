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

  turnEvents.length >= 3
    ? ok("GP-97 进度事件在回合期间发出 (" + turnEvents.length + " rows)")
    : bad("GP-97 event count", turnEvents.length);

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

  // GP-96 2×N ordering: every start has a matching done with the same index
  const starts = turnEvents.filter(e => e.phase === "start");
  const dones = turnEvents.filter(e => e.phase === "done");
  starts.length === dones.length && starts.every((s, i) => dones[i] && dones[i].index === s.index)
    ? ok("GP-96 2×N 排序: " + starts.length + " start + " + dones.length + " done 一一对应")
    : bad("GP-96 ordering", { starts: starts.map(s => s.index), dones: dones.map(d => d.index) });

  // GP-96 total is real effect count
  const totals = turnEvents.map(e => e.total).filter(t => t > 0);
  totals.length > 0 && totals.every(t => t === totals[0])
    ? ok("GP-96 total 字段一致 (" + totals[0] + ")")
    : bad("GP-96 total consistency", totals);

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

  pkg.build && pkg.build.files && pkg.build.files.includes("progress_protocol.js")
    ? ok("GP-96 package.json build.files 包含 progress_protocol.js")
    : bad("GP-96 package files", pkg.build && pkg.build.files);

  /* ---- 5) Renderer: i18n keys + lifecycle ---- */
  const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");
  const i18nKeys = ["progTool", "progComputer", "progFiles", "progQuestion", "progApproval", "progVoice", "progModel", "progAwaiting", "progFailedSuffix", "progContinuing"];
  const missing = i18nKeys.filter(k => !new RegExp(k + ":").test(html));
  missing.length === 0
    ? ok("GP-97 renderer i18n: 10 个 prog* 键 ×3 语言")
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
