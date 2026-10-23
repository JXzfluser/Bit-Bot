#!/usr/bin/env node
"use strict";

/**
 * prove_gp159_approval_window — 场景验收（自媒体日更）· 批准窗口要跟着排程走
 *
 * 现场推演（真实用户旅程，不是假设）：
 *   「每天早上9点把审核通过的稿子发到我的邮箱」→ 09:00 定时任务触发，Host 按
 *   GP-156 挂出一条 mail_send 待批准。但 09:00 用户大概率还没打开应用。
 *   排队用的既有默认有效期是 10 分钟（product_surface.appendPendingApproval），
 *   而 GP-23 的口径是「过期的批准不能再 allow_once」。
 *   于是这条日更邮件在用户 10 点打开应用时已经是一条「已过期」的行：
 *   定时 → 待批准 → 批准 → 真发，链条断在第二步，而且界面只会显示「已过期待批准」，
 *   看不出是自己来晚了。这是「看起来修了」的典型形态。
 *
 * 契约（先立红，修完必须全绿）：
 *   1. 定时任务排出来的批准行，有效期不能还是 10 分钟；下限 1 小时。
 *   2. 循环任务：有效期对齐下一次触发（这一轮还没批准，下一轮会重新排一条）。
 *   3. 一次性任务：没有下一次，窗口放到上限 48 小时，别让唯一一次机会 10 分钟就没。
 *   4. 聊天里当场问一句的路径**不改**（仍然是 10 分钟）——那是另一件事的节奏。
 *   5. 不改既有形状：行还是 {id,source,kind,command,requested_at,expires_at,status}。
 *   6. GP-23 的边界不放松：过期后 allow_once 仍被拒，deny / always 仍可用。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp159-"));
const REPO = path.join(__dirname, "..");
const ffi = createHostFfi(root);
const D = (...p) => path.join(root, "data", ...p);
const PEND = D("desktop/pending-approvals.jsonl");
const ROUTES = D("routines/host-routines.json");

const readJsonl = (p) => {
  try {
    return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
};
const routineRows = () => readJsonl(PEND).filter((e) => e && e.source === "routine");
const readRows = () => { try { const j = JSON.parse(fs.readFileSync(ROUTES, "utf8")); return Array.isArray(j) ? j : (j.routines || []); } catch { return []; } };

async function schedule(id, cron, prompt) {
  await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|" + cron + "|" + prompt }],
    { sessionId: "gp159" },
  );
}
async function fire(id) {
  const r = await ffi.executeHostEffects([{ kind: "routine_fire", command: id }], { sessionId: "gp159" });
  return (r || []).find((x) => x && x.kind === "routine_fire") || {};
}

(async () => {
  console.log("prove_gp159_approval_window — 定时任务的待批准会不会 10 分钟就过期");

  fs.mkdirSync(D("desktop"), { recursive: true });
  fs.writeFileSync(D("desktop/rooms.json"), JSON.stringify({
    rooms: [{ id: "room-gp159", title: "日更流水线", transcript: [{ kind: "final_report", text: "标题：批准窗口也要讲道理", at: new Date().toISOString() }] }],
  }, null, 2));

  /* 1 / 2：循环任务 —— 有效期对齐下一次触发 */
  await schedule("gp159-daily", "0 9 * * *", "每天早上9点把审核通过的稿子发到 news@example.com");
  const res = await fire("gp159-daily");
  res && res.ok ? ok("T0 到期触发并写好草稿") : bad("T0 触发失败", res && (res.error || res.stderr));
  const row = readRows().find((r) => r && r.id === "gp159-daily") || {};
  const queued = routineRows();
  const entry = queued.length ? queued[queued.length - 1] : null;
  const mins = entry ? (Date.parse(entry.expires_at) - Date.parse(entry.requested_at)) / 60000 : 0;
  entry && mins >= 60
    ? ok("T1 定时排出来的批准行有 " + Math.round(mins) + " 分钟窗口（不再是 10 分钟）")
    : bad("T1 定时任务的批准还是 10 分钟就过期 —— 用户还没打开应用，日更邮件已经悄悄没了", JSON.stringify({ windowMin: Math.round(mins), entry: entry && { e: entry.expires_at, r: entry.requested_at } }));
  const drift = entry && row.next_due ? Math.abs(Date.parse(entry.expires_at) - Date.parse(row.next_due)) / 60000 : NaN;
  Number.isFinite(drift) && drift <= 2
    ? ok("T2 窗口跟着排程：expires_at 与 next_due 相差 " + drift.toFixed(1) + " 分钟（下一轮会重新排一条）")
    : bad("T2 窗口没有跟着排程走", JSON.stringify({ driftMin: drift, expires: entry && entry.expires_at, next_due: row.next_due }));

  /* 3：一次性任务 —— 没有下一次，窗口放到上限 */
  await schedule("gp159-once", "@now", "现在把稿子发一次到 once@example.com");
  await fire("gp159-once");
  const q2 = routineRows();
  const once = q2.length >= 2 ? q2[q2.length - 1] : null;
  const mins2 = once ? (Date.parse(once.expires_at) - Date.parse(once.requested_at)) / 60000 : 0;
  once && mins2 >= 60 * 24
    ? ok("T3 一次性任务的批准窗口有 " + Math.round(mins2 / 60) + " 小时（唯一一次机会不会 10 分钟就没）")
    : bad("T3 一次性任务的窗口没有被放宽", JSON.stringify({ windowMin: Math.round(mins2), windowHour: Math.round(mins2 / 60) }));

  /* 4：聊天路径的节奏不能被带跑 —— 它不传 expires_at，吃的还是产品面默认值。 */
  const chatBefore = routineRows().length;
  const { createProductSurface } = require("../hosts/desktop/product_surface");
  const surf = createProductSurface(root);
  const chatPend = surf.appendPendingApproval({ source: "chat", kind: "mail_send", command: "gmail|me@example.com|hi|body" });
  const chatRow = readJsonl(PEND).filter((e) => e && e.source === "chat").slice(-1)[0];
  const chatMins = chatRow ? (Date.parse(chatRow.expires_at) - Date.parse(chatRow.requested_at)) / 60000 : 0;
  chatPend && chatRow && Math.abs(chatMins - 10) < 1
    ? ok("T4 不传 expires_at 的路径仍是 10 分钟默认（" + Math.round(chatMins) + " 分钟，聊天里当场问一句的节奏没被带跑）")
    : bad("T4 默认窗口被改了", JSON.stringify({ chatMins, row: chatRow && chatRow.expires_at }));
  routineRows().length === chatBefore ? ok("T5 聊天行不算定时行（source 仍区分得开）")
    : bad("T5 source 分错了", JSON.stringify({ before: chatBefore, after: routineRows().length }));
  // 静态护栏：聊天排队那一段（source:"chat"）不许偷偷开始传自己的有效期。
  const hostSrc = fs.readFileSync(path.join(REPO, "hosts/shared/host_ffi.js"), "utf8");
  const at = hostSrc.indexOf('source: "chat",');
  const chatSite = at >= 0 && /command: cmd,\s*\}\)/.test(hostSrc.slice(at, at + 200));
  chatSite ? ok("T5b Host 里聊天排队的调用仍只传 source/kind/command（没夹带 expires_at）")
    : bad("T5b 聊天排队调用形状变了", "找不到「source: chat 且直接以 command: cmd 收尾」的调用形状");

  /* 5：形状不变 */
  const keys = entry ? Object.keys(entry).sort().join(",") : "";
  keys.includes("id") && keys.includes("source") && keys.includes("kind") && keys.includes("command") &&
  keys.includes("requested_at") && keys.includes("expires_at") && keys.includes("status")
    ? ok("T6 行形状未变（id/source/kind/command/requested_at/expires_at/status）")
    : bad("T6 行的字段形状变了", keys);

  /* 6：GP-23 边界不放松 —— 把行拨到过期，allow_once 仍须被拒 */
  const target = routineRows()[0];
  if (target) {
    const lines = fs.readFileSync(PEND, "utf8").split("\n").filter(Boolean);
    const patched = lines.map((l) => {
      let j; try { j = JSON.parse(l); } catch { return l; }
      if (j && j.id === target.id) { j.expires_at = new Date(Date.now() - 60000).toISOString(); return JSON.stringify(j); }
      return l;
    });
    fs.writeFileSync(PEND, patched.join("\n") + "\n");
  }
  // 直接走产品面自己的 approvalDecide（和 UI 点「本次允许」是同一条函数）。
  const allowOnce = target ? surf.approvalDecide(target.id, "allow_once") : { ok: false, error: "no_row" };
  const expired = target ? (surf.pendingApprovals().find((x) => x && x.id === target.id) || {}) : {};
  allowOnce && allowOnce.ok !== true && /expir/i.test(String(allowOnce.error || "")) && expired.status === "expired"
    ? ok("T7 过期之后 allow_once 仍被拒（GP-23 边界没有因为窗口变长而放松）")
    : bad("T7 过期的批准竟然还能 allow_once", JSON.stringify({ allowOnce, expired: expired.status }));

  console.log("prove_gp159_approval_window: PASS=" + pass + " FAIL=" + fail);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* keep */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("probe crashed: " + ((e && e.stack) || e));
  console.log("prove_gp159_approval_window: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
