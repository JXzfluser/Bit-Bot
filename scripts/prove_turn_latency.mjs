/* prove_turn_latency.mjs — KP-04 计时模块的验收门（纯逻辑 + 落盘往返 + 反向对照）
 *
 * 只吃 turn_latency.js 的纯派生与文件系统 API，不起 Electron。真·非零样本、连发
 * 三条各不相同由 e2e_desktop_turn_latency.mjs 负责（同一份 measure/coverageOk）。
 *
 * 判据（对齐 kernel-mechanism-parity §4 KP-04 验收门）：
 *  L1 唯一 schema：Host(main.js)、measure 脚本、本门三处都 require 同一模块。
 *  L2 派生正确：良构记录 → 三段 = 500/1500/1000 ms，可感面那行逐字对得上。
 *  L3 没测到 ≠ 0：缺 first_token 的两段是 null，界面显示「—」不是「0 ms」。
 *  L4 乱序被拒：accepted 早于 first_token → validateOrder 报问题、该段 null。
 *  L5 落盘往返：appendRecord → readRecords 找回 → findByTurnId 反查得到。
 *  L6 覆盖面铁律：coverageOk([]) 必须判不 OK（「0 条也算绿」禁止）；3 条流式满足。
 *
 * 反向对照（证明上面不是写死的 true）：改坏模块副本后，对应断言必须翻假。
 *  N1 diff 去掉端点守卫 → L3/L4 的「null」判定翻假。
 *  N2 coverageOk 去掉「n===0 → 红」→ L6 的 0 样本判红翻假。
 *  N3 format 把 null 印成「0 ms」→ L3 的「显示成 —」翻假。
 *
 * 用法：node scripts/prove_turn_latency.mjs
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const MOD = path.join(REPO, "hosts/shared/turn_latency.js");
const MAIN = path.join(REPO, "hosts/desktop/main.js");
const MEASURE = path.join(REPO, "scripts/measure_turn_latency.mjs");
const SRC = fs.readFileSync(MOD, "utf8");
const req = createRequire(import.meta.url);
const T = req(MOD);

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d === undefined || d === null ? "" : " — " + String(d).slice(0, 300))); };

// 写一份临时模块（可改坏），require 出来跑同一断言。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kp04-gate-"));
let tmpN = 0;
function loadFrom(src) {
  const p = path.join(tmpDir, "mod-" + tmpN++ + ".js");
  fs.writeFileSync(p, src);
  return req(p);
}

/* ---- 可复用的纯断言（给定模块实例返回布尔，正/负控共用） -------------------- */

// L3：缺 first_token 的记录，两段延迟必须是 null（不是 0）。
function assertNotMeasuredIsNull(mod) {
  const r = { turn_id: "t", enter_epoch_ms: 1000, composed_at_ms: 1500, first_token_at_ms: 0, accepted_at_ms: 4000 };
  const s = mod.spans(r);
  return s.send_to_first === null && s.first_to_store === null && s.enter_to_send === 500;
}
// L3b：可感面把没测到的段显示成「—」，不是「0 ms」。
function assertFormatUsesDash(mod) {
  const r = { turn_id: "t", enter_epoch_ms: 1000, composed_at_ms: 1500, first_token_at_ms: 0, accepted_at_ms: 4000 };
  const line = mod.format(r);
  return line.includes("发送→首字 —") && line.includes("首字→落库 —");
}
// L4：乱序（accepted < first_token）→ validateOrder 报问题，该段 null。
function assertOrderRejected(mod) {
  const r = { turn_id: "t", enter_epoch_ms: 1000, composed_at_ms: 1500, first_token_at_ms: 3000, accepted_at_ms: 2000 };
  const v = mod.validateOrder(r);
  const s = mod.spans(r);
  return v.ok === false && v.problems.length > 0 && s.first_to_store === null;
}
// L6：0 样本必须判不 OK——**哪怕调用方没设 minSamples**（这才是「0 条也算绿」的坑）；
//     3 条流式满足 minSendToFirst=3。
function assertCoverageRule(mod) {
  const empty = mod.coverageOk([], { minSamples: 1, minSendToFirst: 1 });
  // 不设任何下限：只有 n===0 这条硬规则会让它判红；去掉该规则就会「0 条也算绿」。
  const emptyNoReq = mod.coverageOk([], {});
  const three = mod.coverageOk(
    [1, 2, 3].map((k) => ({ turn_id: "t" + k, enter_epoch_ms: 1000, composed_at_ms: 1500, first_token_at_ms: 1500 + k * 100, accepted_at_ms: 4000 })),
    { minSamples: 3, minSendToFirst: 3 },
  );
  return empty.ok === false && emptyNoReq.ok === false && three.ok === true;
}

/* ---- 正向断言（跑真模块） --------------------------------------------------- */

try {
  // L1 唯一 schema：Host、measure 脚本、本门三处都 require 同一个 turn_latency.js
  const mainSrc = fs.readFileSync(MAIN, "utf8");
  const measureSrc = fs.existsSync(MEASURE) ? fs.readFileSync(MEASURE, "utf8") : "";
  const selfSrc = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const usesMod = (s) => /turn_latency\b/.test(s);
  if (
    usesMod(mainSrc) && /appendRecord\s*\(/.test(mainSrc) &&
    usesMod(measureSrc) && /readRecords\s*\(/.test(measureSrc) &&
    usesMod(selfSrc)
  ) {
    ok("L1 唯一 schema：Host 用 appendRecord、measure 用 readRecords、本门同吃一份 turn_latency.js");
  } else {
    bad("L1 唯一 schema 没接上", { mainHasWriter: /appendRecord/.test(mainSrc), measureExists: fs.existsSync(MEASURE), measureReads: /readRecords/.test(measureSrc) });
  }

  // L2 派生正确 + 可感面逐字
  const rec = { turn_id: "turn-abc", session_id: "s", enter_epoch_ms: 1_000, composed_at_ms: 1_500, first_token_at_ms: 3_000, accepted_at_ms: 4_000 };
  const sp = T.spans(rec);
  if (sp.enter_to_send === 500 && sp.send_to_first === 1500 && sp.first_to_store === 1000) {
    ok("L2 三段派生 = 500/1500/1000 ms（回车→发送 / 发送→首字 / 首字→落库）");
  } else bad("L2 派生数值不对", JSON.stringify(sp));
  const line = T.format(rec);
  if (line === "turn-abc · 回车→发送 500 ms · 发送→首字 1500 ms · 首字→落库 1000 ms") {
    ok("L2b 可感面那一行逐字对得上：\n      " + line);
  } else bad("L2b 可感面格式漂移", line);

  // L3 / L4
  if (assertNotMeasuredIsNull(T)) ok("L3 缺端点 → 该段是 null，不是 0");
  else bad("L3 缺端点没落成 null");
  if (assertFormatUsesDash(T)) ok("L3b 没测到的段在界面上显示「—」（绝不显示 0 ms）");
  else bad("L3b 缺段没显示成 —");
  if (assertOrderRejected(T)) ok("L4 时钟乱序（accepted<first）→ 被拒、该段 null");
  else bad("L4 乱序没被拒");

  // L5 落盘往返 + 反查
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kp04-root-"));
  const written = T.appendRecord(root, rec);
  const readBack = T.readRecords(root, { limit: 10 });
  const found = T.findByTurnId(readBack, "turn-abc");
  if (fs.existsSync(written) && readBack.length === 1 && found && found.enter_epoch_ms === 1000 && found.accepted_at_ms === 4000) {
    ok("L5 appendRecord→readRecords→findByTurnId 往返一致（从日志反查 turn_id 成立）");
  } else bad("L5 落盘往返不一致", { file: written, n: readBack.length, found: !!found });
  fs.rmSync(root, { recursive: true, force: true });

  // L6 覆盖面铁律（真模块）
  if (assertCoverageRule(T)) ok("L6 覆盖面：0 样本判红、3 条流式判绿（「0 条也算绿」被禁）");
  else bad("L6 覆盖面规则不对");

  /* ---- 反向对照：改坏副本，对应断言必须翻假 ---- */

  // N1：去掉 diff 的端点守卫（b>=a → 直接相减），缺端点/乱序就不再是 null
  const n1 = SRC.replace("return a > 0 && b >= a ? b - a : null;", "return b - a;");
  if (n1 === SRC) bad("N1 没找到 diff 守卫源行（改动失效，负控不可信）");
  else {
    const m1 = loadFrom(n1);
    if (!assertNotMeasuredIsNull(m1) && !assertOrderRejected(m1)) ok("N1 负向对照真红：拆掉端点守卫 → L3/L4 的 null 判定翻假");
    else bad("N1 负向对照没红：守卫不是必需的（断言可能是假的）");
  }

  // N2：去掉 coverageOk 的「n===0 → 红」
  const n2 = SRC.replace("if (m.n === 0) why.push(\"样本数为 0（0 条不许算绿）\");", "if (false) why.push(\"x\");");
  if (n2 === SRC) bad("N2 没找到 coverageOk 的 0 样本源行");
  else {
    const m2 = loadFrom(n2);
    if (!assertCoverageRule(m2)) ok("N2 负向对照真红：去掉「0 样本判红」→ L6 翻假（覆盖面不是写死）");
    else bad("N2 负向对照没红：0 样本仍判红？规则可能失效");
  }

  // N3：把 null 印成 0 ms
  const n3 = SRC.replace('return v === null ? "—" : v + " ms";', "return v + \" ms\";");
  if (n3 === SRC) bad("N3 没找到 msText 源行");
  else {
    const m3 = loadFrom(n3);
    if (!assertFormatUsesDash(m3)) ok("N3 负向对照真红：把没测到的段印成 0 ms → L3b 翻假（「显示成 —」不是凑的）");
    else bad("N3 负向对照没红");
  }
} catch (e) {
  bad("prove_turn_latency 抛错", (e && e.stack) || e);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("\nprove_turn_latency: PASS=" + PASS + " FAIL=" + FAIL);
process.exit(FAIL ? 1 : 0);
