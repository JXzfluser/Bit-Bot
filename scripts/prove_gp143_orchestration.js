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

  console.log(`\nprove_gp143_orchestration: PASS=${pass} FAIL=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.log("FATAL " + (e && e.stack || e)); process.exit(1); });
