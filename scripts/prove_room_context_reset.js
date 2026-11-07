#!/usr/bin/env node
/* prove_room_context_reset — 群成员回合的私有上下文超预算时必须能自愈（G-111）
 *
 * 现场：5 人群里「事实编辑」的 agent 上下文槽位涨到 178 KB（≈6 万 token，预算 24000），
 * 于是它每一轮都走 over_budget → compact → 仍超 → `agent loop stopped: token budget
 * exhausted`，用户每次看到的都是「收齐 2/3 · 这个成员失败」。不是模型不行，是它一进门
 * 就超重，而历史只增不减 —— 不给出口就永远失败。
 *
 * 群里的共享上下文由 Host 塞进 prompt 的「最近群聊记录」承载（AR-07），成员私有的那份
 * 只是锦上添花。所以 Host 在**读**的时候量一次尺寸：超了就当没有历史。
 *
 * 判据（每条都带负向/边界对照）：
 *   A 群槽位、小上下文 → 原样读回（不许误伤正常记忆）
 *   B 群槽位、超预算   → 读回空（这就是修的那件事），且下一轮 save 之后磁盘真的瘦下来
 *   C 负向对照：私聊槽位超预算 → 仍然原样读回（不能把用户的「它记得我」一起清了）
 *   D 边界：恰好等于预算不重置；多 1 token 才重置
 *   E 预算以上下文自己的头部为准（大预算的会话不该被默认 24000 误砍）
 *   F 旧式平铺槽位的迁移路径同样适用这条规则（迁移不是绕过体检的后门）
 *
 * 用法：node scripts/prove_room_context_reset.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const { createProductSession } = require(path.join(REPO, "hosts/shared/agent_loop_product_wire.js"));

let PASS = 0;
let FAIL = 0;
function ok(msg) { PASS += 1; console.log("  ✓ " + msg); }
function bad(msg, detail) {
  FAIL += 1;
  console.log("  ✗ " + msg + (detail === undefined ? "" : " — " + String(detail)));
}

const GROUP = "bot-87a1a6__room-room-mw5sqgio-bot-87a1a6";
const DM = "bot-87a1a6__sess-abc123";
const head = (budget) => "v1|session-" + Date.now() + "|" + budget + "|6|0\n";

async function main() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bb-ctx-"));
  const ffi = { DATA_ROOT: TMP, executeLlmChat: async () => ({ ok: true, stdout: "" }) };
  const sess = createProductSession(ffi, {});
  const save = (slot, text) => sess.dispatch({ op: "save_context", slot, text });
  const load = async (slot) => {
    const out = await sess.dispatch({ op: "load_context", slot });
    return String((out && out.output) || "");
  };
  const ctxFile = (slot) => {
    // 与 agentContextPath 同一规则：<DATA_ROOT>/agent-context/<machine>/<safe>.ctx
    const safe = String(slot || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "agent-bit";
    const dir = path.join(TMP, "agent-context");
    for (const machine of fs.readdirSync(dir)) {
      const f = path.join(dir, machine, safe + ".ctx");
      if (fs.existsSync(f)) return f;
    }
    return "";
  };

  console.log("prove_room_context_reset — 群成员上下文超预算要能自愈");

  /* ---------- A. 正常尺寸：原样读回 ---------- */
  {
    const text = head(24000) + "e|user|" + "帮我核对一下这三个数字".repeat(20) + "\n";
    await save(GROUP, text);
    const got = await load(GROUP);
    got === text
      ? ok("A 群槽位的小上下文原样读回（正常记忆不被误伤，" + got.length + " 字节）")
      : bad("A small room context", JSON.stringify(got).slice(0, 120));
  }

  /* ---------- B. 超预算：读回空，且写回后收敛 ---------- */
  {
    const fat = head(24000) + "e|assistant|" + "抓下来的网页正文".repeat(4000) + "\n";
    await save(GROUP, fat);
    const file = ctxFile(GROUP);
    const bytes = file ? fs.statSync(file).size : 0;
    const got = await load(GROUP);
    got === "" && bytes > 80000
      ? ok("B 群槽位超预算（" + bytes + " 字节）→ 读回空上下文，不再每轮一进门就 token budget exhausted")
      : bad("B stale room context", JSON.stringify({ len: got.length, bytes }));
    const thin = head(24000) + "e|user|短一点\n";
    await save(GROUP, thin);
    const back = await load(GROUP);
    const sizeNow = fs.existsSync(ctxFile(GROUP)) ? fs.statSync(ctxFile(GROUP)).size : -1;
    back === thin && sizeNow === Buffer.byteLength(thin, "utf8")
      ? ok("B 写回一个瘦上下文后，磁盘上也真的瘦了（" + sizeNow + " 字节；自愈是收敛的，不是只在内存里假装）")
      : bad("B converge on write", JSON.stringify({ back: back.length, want: thin.length, sizeNow }));
  }

  /* ---------- C. 负向对照：私聊不许被清 ---------- */
  {
    const fat = head(24000) + "e|assistant|" + "我们上次聊过的偏好".repeat(4000) + "\n";
    await save(DM, fat);
    const got = await load(DM);
    got === fat && got.length > 30000
      ? ok("C 负向对照：私聊槽位同样超预算（" + got.length + " 字节）却原样读回 —— 「它记得我」不陪葬")
      : bad("C dm context wiped", JSON.stringify({ len: got.length }));
  }

  /* ---------- D. 边界：等于预算保留，多 1 才重置 ---------- */
  {
    // 估算是 floor((ascii+3)/4) + cjk。先把 ASCII 那部分定死（头部 + 记录前缀），
    // 反算 cjk 让总量**正好**落在 24000 —— 这样「多 1 就重置」才是真的边界判据。
    const prefix = head(24000) + "e|user|";
    const tail = "\n";
    const k = Math.floor((prefix.length + tail.length + 3) / 4);
    const exact = prefix + "中".repeat(24000 - k) + tail;
    await save(GROUP, exact);
    const keep = (await load(GROUP)) === exact;
    const over = prefix + "中".repeat(24000 - k + 1) + tail;
    await save(GROUP, over);
    const drop = (await load(GROUP)) === "";
    keep && drop
      ? ok("D 边界判据是「严格超过」：正好压在 24000 保留，24001 才重置（不是「差不多」）")
      : bad("D boundary", JSON.stringify({ keep, drop, headTokens: k }));
  }

  /* ---------- E. 预算以头部为准 ---------- */
  {
    const big = head(60000) + "e|user|" + "长文".repeat(20000) + "\n";
    await save(GROUP, big);
    const got = await load(GROUP);
    got === big
      ? ok("E 头部写明 60000 预算的会话不会被默认 24000 误砍（读它自己的预算，不猜）")
      : bad("E per-context budget", JSON.stringify({ len: got.length }));
  }

  /* ---------- F. 旧式平铺槽位迁移也要过同一关 ---------- */
  {
    const slot = "bot-legacy__room-room-old-bot-legacy";
    const safe = slot.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
    const legacy = path.join(TMP, "agent-context", safe + ".ctx");
    const fat = head(24000) + "e|assistant|" + "迁移前的老历史".repeat(4000) + "\n";
    fs.writeFileSync(legacy, fat, "utf8");
    const got = await load(slot);
    const movedOut = !fs.existsSync(legacy);
    got === "" && movedOut
      ? ok("F 旧式平铺槽位：迁移过去之后同样按超预算丢弃（迁移不是绕过体检的后门）")
      : bad("F legacy slot", JSON.stringify({ len: got.length, movedOut }));
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  console.log("\nprove_room_context_reset: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("prove_room_context_reset crashed: " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
