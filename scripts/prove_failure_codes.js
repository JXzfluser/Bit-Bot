#!/usr/bin/env node
"use strict";

/**
 * prove_failure_codes — KP-03「失败从自由文本升成码」的验收门
 *
 * 钉三件事（对应 spec 验收门「码表穷举断言 + 一条反向对照」）：
 *   T1 唯一码表是 dual-load：Host require()、渲染层 <script src>，同一份。
 *   T2 穷举：每个 canonical code 都有**真实产出路径**（在 producer 文件里能 grep 到
 *      该码或其别名/前缀）。unknown_failure 例外——它由归一化兜底产生，由 T4 证明。
 *   T3 收编：现有散装串确实收敛到 canonical（api_key_not_configured→provider_unconfigured…）。
 *   T4 反向对照：认不出的串落 unknown_failure 且**不抛错**（null/undefined/{}/number/怪串）。
 *   T5 接线：Host 带 error_code 到流/回执、私聊面按码渲染、approve.js --last-failure、打包。
 *
 * 负向对照（证明以上判据不是恒真）：
 *   N1 抹掉 provider_unconfigured 的产出串 → 它的 T2 穷举必须翻假。
 *   N2 把兜底改成「原样当码」→ T4 必须翻假（未知串不再落 unknown_failure）。
 *   N3 让归一化对怪串抛错 → T4 的「不崩溃」必须翻假。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const REPO = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");
const SRC_PATH = "hosts/desktop/failure_codes.js";
const MODULE_SRC = read(SRC_PATH);
const HOST_FFI = read("hosts/shared/host_ffi.js");
const RUN_MOON = read("hosts/shared/run_moon_turn.js");
const WIRE = read("hosts/shared/agent_loop_product_wire.js");
const DISPATCH = read("hosts/shared/room_dispatch.js");
const RUNTIME = read("hosts/shared/room_runtime.js");
const SURFACE = read("hosts/desktop/product_surface.js");
const MAIN = read("hosts/desktop/main.js");
const ORCH = read("hosts/desktop/room_orchestrator.js");
const INDEX = read("hosts/desktop/index.html");
const APPROVE = read("scripts/approve.js");
const PKG = read("hosts/desktop/package.json");

const mod = require(path.join(REPO, SRC_PATH));

/* producer 面：KP-03 关心的发送/群回合失败都产在这些文件里。
 * 关键：不并入模块自身——模块声明了每个码，若拿它当 producer 会让穷举恒真。
 * provider_unconfigured 这类收敛名只存在于模块/UI，其产出靠 alias（api_key_not_configured）。 */
const PRODUCER_BLOB = [HOST_FFI, RUN_MOON, WIRE, DISPATCH, RUNTIME, SURFACE, MAIN, ORCH].join("\n");

/** 一个 code 的所有可 grep token：码本身 + 映射到它的精确别名 + 前缀别名。 */
function tokensFor(code) {
  const toks = new Set([code]);
  for (const [k, v] of Object.entries(mod.ALIASES)) if (v === code) toks.add(k);
  for (const p of mod.PREFIX_ALIASES) if (p.code === code) toks.add(p.match);
  return [...toks];
}

/** T2 穷举判据（纯函数：blob 进，缺产出的码列表出）。unknown_failure 由归一化兜底，排除。 */
function codesMissingProducer(blob) {
  return mod.CODES.filter((c) => {
    if (c === "unknown_failure") return false; // 兜底码，产出路径是 normalize 本身（T4 证明）
    return !tokensFor(c).some((t) => blob.includes(t));
  });
}

/** 临时加载一份模块（负向对照用），跑完删掉。 */
function loadFrom(src) {
  const tmp = path.join(os.tmpdir(), "prove_failure_codes_" + process.pid + "_" + Date.now() + ".js");
  fs.writeFileSync(tmp, src, "utf8");
  try {
    delete require.cache[require.resolve(tmp)];
    return require(tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
}

/* ---- 正向 --------------------------------------------------------------- */

{
  const dual = /module\.exports\s*=\s*api/.test(MODULE_SRC) && /window\.__bitbotFailure\s*=\s*api/.test(MODULE_SRC);
  dual ? ok("T1 唯一码表 dual-load：module.exports(Host) + window.__bitbotFailure(渲染层)")
    : bad("T1 码表没有同时导出到 Host 与渲染层");
}

{
  const missing = codesMissingProducer(PRODUCER_BLOB);
  const covered = mod.CODES.length - missing.length;
  missing.length === 0
    ? ok("T2 穷举：" + covered + "/" + mod.CODES.length + " 个码都能在 producer 文件里找到产出串（unknown_failure 由归一化兜底）")
    : bad("T2 穷举：" + missing.length + " 个码没有任何产出路径", missing.join(", "));
}

{
  const cases = [
    ["api_key_not_configured", "provider_unconfigured"],
    ["empty user text", "empty_user_text"],
    ["invalid JSON from MoonBit: Unexpected token <", "kernel_invalid_json"],
    ["handoff_stuck:provider down（第 3/3 次）", "handoff_stuck"],
    ["room_turn_deadline", "room_turn_timeout"],
    ["canceled", "cancelled"],
    ["max_wall_ms", "budget_max_wall_ms"],
    ["no_reply", "no_reply"],
  ];
  const wrong = cases.filter(([inp, want]) => mod.normalizeFailure(inp).code !== want);
  wrong.length === 0
    ? ok("T3 收编：现有散装串确实收敛到 canonical（含 host 已在产的 api_key_not_configured）")
    : bad("T3 收编：下列串没有收敛到期望码", wrong.map(([i, w]) => i + "→" + mod.normalizeFailure(i).code + "(want " + w + ")").join("; "));
}

{
  const junk = ["totally_unknown_xyz", "", "   ", "{ not json", "Error: ENOENT no such file"];
  const objs = [null, undefined, {}, { foo: 1 }, 12345, true, []];
  let crashed = null;
  let wrong = [];
  try {
    for (const j of junk) if (mod.normalizeFailure(j).code !== "unknown_failure") wrong.push(String(j));
    for (const o of objs) if (mod.normalizeFailure(o).code !== "unknown_failure") wrong.push(JSON.stringify(o) || String(o));
  } catch (e) {
    crashed = e;
  }
  if (crashed) bad("T4 反向对照：归一化对未知输入抛错了（必须落 unknown_failure 而不是崩溃）", crashed.message);
  else if (wrong.length) bad("T4 反向对照：下列未知输入没有落 unknown_failure", wrong.join(", "));
  else ok("T4 反向对照：怪串/null/{}/number/空串一律落 unknown_failure，且不抛错");
}

{
  const noLabel = mod.CODES.filter((c) => !mod.describe(c).label_key);
  const badDescribe = mod.describe("__not_a_code__").code !== "unknown_failure";
  if (noLabel.length === 0 && !badDescribe)
    ok("T5 每个码都有 i18n label_key，describe(未知) 安全落 unknown_failure");
  else
    bad("T5 码表 describe 不完整", noLabel.join(",") + (badDescribe ? " | describe(未知)未兜底" : ""));
}

{
  const hostStream = /emitLlmStream\(\{[\s\S]{0,220}?error_code:\s*artifact\.error_code/.test(HOST_FFI);
  const hostReturn = /return\s*\{\s*kind:\s*"llm_chat",[\s\S]{0,240}?error:\s*artifact\.error,\s*error_code:\s*artifact\.error_code,/.test(HOST_FFI);
  const wireCode = /state\.llmErrorCode\s*=\s*res\.error_code/.test(WIRE);
  const moonJson = /error_code:\s*"kernel_invalid_json"/.test(RUN_MOON);
  const moonExit = /parsed\.error_code\s*=\s*String\(productWire\.state\.llmErrorCode\)/.test(RUN_MOON);
  const renderer = /function sendFailureText\(/.test(INDEX) && /addMsg\("assistant",\s*sendFailureText\(chunk\)\)/.test(INDEX);
  const scriptTag = /<script src="\.\/failure_codes\.js"><\/script>/.test(INDEX);
  const packaged = /"failure_codes\.js"/.test(PKG);
  const cli = /has\("last-failure"\)[\s\S]{0,80}?printLastFailure\(\)/.test(APPROVE) && /failureCodes\.normalizeFailure/.test(APPROVE);
  const all = hostStream && hostReturn && wireCode && moonJson && moonExit && renderer && scriptTag && packaged && cli;
  if (all) ok("T6 接线闭环：Host 带 error_code→流/回执→渲染层按码显示→approve.js --last-failure→打进包");
  else
    bad("T6 接线缺项", JSON.stringify({ hostStream, hostReturn, wireCode, moonJson, moonExit, renderer, scriptTag, packaged, cli }));
}

/* ---- 负向对照：破坏实现，对应断言必须翻假 --------------------------------- */

{
  // N1 抹掉 provider_unconfigured 的产出（把 api_key_not_configured 改名）→ T2 穷举必须翻假
  const brokenBlob = PRODUCER_BLOB.replace(/api_key_not_configured/g, "api_key_XXX_removed");
  const missing = codesMissingProducer(brokenBlob);
  missing.includes("provider_unconfigured")
    ? ok("N1 负向对照：抹掉 api_key_not_configured → T2 里 provider_unconfigured 判定翻假")
    : bad("N1 负向对照恒真：抹掉产出串后 T2 仍说全覆盖");
}

{
  // N2 把兜底「unknown_failure」改成「原样返回输入」→ T4 必须翻假
  const brokenSrc = MODULE_SRC.replace('if (!code) code = "unknown_failure";', 'if (!code) code = String(input == null ? "" : (input.code || input));');
  const broken = loadFrom(brokenSrc);
  const leaks = broken.normalizeFailure("totally_unknown_xyz").code !== "unknown_failure";
  leaks ? ok("N2 负向对照：去掉 unknown_failure 兜底 → T4 翻假（未知串不再落兜底码）")
    : bad("N2 负向对照恒真：去掉兜底后未知串仍落 unknown_failure");
}

{
  // N3 让 resolveToken 对怪串抛错 → T4 的「不崩溃」必须真的能抓到崩溃
  const brokenSrc = MODULE_SRC.replace("var s = String(token == null ? \"\" : token).trim();", "if (token === undefined) throw new Error('boom'); var s = String(token == null ? \"\" : token).trim();");
  const broken = loadFrom(brokenSrc);
  let threw = false;
  try { broken.normalizeFailure({}); } catch (_) { threw = true; }
  threw ? ok("N3 负向对照：让 resolveToken 对空对象的 undefined 抛错 → T4 能抓到崩溃（不崩溃判据不是写死的 true）")
    : bad("N3 负向对照失效：注入的抛错没有被 normalizeFailure({}) 触发");
}

console.log("\nprove_failure_codes: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
