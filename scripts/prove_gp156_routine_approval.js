#!/usr/bin/env node
"use strict";

/**
 * prove_gp156_routine_approval — 场景验收（自媒体日更）· 「定时 → 待批准 → 批准 → 真发」
 *
 * 修之前的真实断点：定时任务到期只在 data/routines/drafts/ 落一个草稿文件，
 * 审批队列里什么都没有（pending-approvals.jsonl 里永远没有 routine 来源的行），
 * 用户在界面上点不到任何东西，「批准之后发到我的邮箱」这一步根本走不完。
 *
 * 这个探针把契约写死成断言（先红），修完必须全绿：
 *   1. 原话里有邮箱 → 触发时排队一条 mail_send 待批准（只排队，不发）。
 *   2. 原话里没有邮箱 → 如实只留草稿，绝不凭空编一个收件人。
 *   3. 触发前后 data/mail/sends/ 必须一个文件都不新增（GP-108）。
 *   4. 批准后的重放（既有 approvals.runAllowed 用的同一条路径）才真落 sends 工件，
 *      内容带收件人和稿件正文。
 *   5. 正文优先取本群最近一次成稿回执（final_report），不是任务原话的复读。
 *   6. 正文里的 | 不会把 mail_send 的四字段命令截断。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 260) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gp156-"));
const ffi = createHostFfi(root);
const D = (...p) => path.join(root, "data", ...p);
const PEND = D("desktop/pending-approvals.jsonl");
const SEND_DIR = D("mail/sends");
const DRAFT_DIR = D("routines/drafts");

const readJsonl = (p) => {
  try {
    return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
};
const listJson = (dir) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; } };
const pendMail = () => readJsonl(PEND).filter((e) => e && e.kind === "mail_send" && e.source === "routine");

async function schedule(id, cron, prompt) {
  const r = await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|" + cron + "|" + prompt }],
    { sessionId: "gp156" },
  );
  return (r || []).find((x) => x && x.kind === "routine_schedule");
}
async function fire(id, extra) {
  const r = await ffi.executeHostEffects(
    [{ kind: "routine_fire", command: id + (extra || "") }],
    { sessionId: "gp156" },
  );
  return (r || []).find((x) => x && x.kind === "routine_fire");
}

(async () => {
  console.log("prove_gp156_routine_approval — 定时任务到期后能不能走到「批准 → 真发」");

  /* 群里已经有一篇审核通过的成稿（正文应优先取它，而不是复读任务原话） */
  const REPORT = "标题：模型上下文又降价了\n正文：今天最热的两条 AI 新闻｜附来源清单。\n审核结论：通过。";
  fs.mkdirSync(D("desktop"), { recursive: true });
  fs.writeFileSync(D("desktop/rooms.json"), JSON.stringify({
    rooms: [{ id: "room-gp156", title: "日更流水线", transcript: [
      { kind: "final_report", text: REPORT, at: new Date().toISOString() },
    ] },],
  }, null, 2));

  const prompt = "每天早上9点把审核通过的稿子发到 news@example.com";
  const sched = await schedule("gp156-daily", "0 9 * * *", prompt);
  const routinesPath = D("routines/host-routines.json");
  const rows = (() => { try { return JSON.parse(fs.readFileSync(routinesPath, "utf8")); } catch { return []; } })();
  const stored = (Array.isArray(rows) ? rows : rows.routines || []).find((r) => r && r.id === "gp156-daily");
  sched && sched.ok && stored ? ok("P0 定时任务落盘（cron=" + (stored && stored.cron) + "）")
    : bad("P0 定时任务没落盘", sched && (sched.error || sched.stderr));
  if (stored) { stored.room_id = "room-gp156"; fs.writeFileSync(routinesPath, JSON.stringify(Array.isArray(rows) ? [stored] : rows, null, 2)); }

  const sendsBefore = listJson(SEND_DIR);
  const res = await fire("gp156-daily");
  let payload = {};
  try { payload = JSON.parse((res && res.stdout) || "{}"); } catch { payload = {}; }

  res && res.ok ? ok("P1 触发成功并写好草稿（draft_path=" + String(payload.draft_path || "").split("/").pop() + "）")
    : bad("P1 触发失败", res && (res.error || res.stderr));

  const queued = pendMail();
  queued.length === 1 && String(queued[0].command || "").split("|")[1] === "news@example.com"
    ? ok("P2 到期挂出一条待批准 mail_send（收件人 news@example.com，来源 routine）")
    : bad("P2 到期没进待批准队列 —— 用户在界面上点不到，走不到「批准后才发」", JSON.stringify({ queued }).slice(0, 300));

  const parts = String((queued[0] || {}).command || "").split("|");
  parts.length === 4 && parts[3].includes("降价") && !parts[3].includes("|")
    ? ok("P3 命令四字段完整，正文取到本群成稿（含标题行，| 已转全角不截断）")
    : bad("P3 待批准命令内容不符", JSON.stringify({ parts: parts.length, body: (parts[3] || "").slice(0, 60) }));

  listJson(SEND_DIR).length === sendsBefore.length
    ? ok("P4 未批准前 0 封外发（data/mail/sends/ 无新增，GP-108 边界没被触发绕过）")
    : bad("P4 触发时竟然已经发了", JSON.stringify(listJson(SEND_DIR)));

  payload && payload.queued_approval === true && payload.mail_to === "news@example.com"
    ? ok("P5 触发工件如实写明排队情况（queued_approval=true / mail_to），没假装已发送")
    : bad("P5 工件缺排队事实", JSON.stringify({ q: payload && payload.queued_approval, to: payload && payload.mail_to }));

  /* 没有收件人 → 只留草稿，不编地址 */
  await schedule("gp156-nomail", "@daily", "每天下午5点把稿件提醒我一次");
  const res2 = await fire("gp156-nomail");
  let p2 = {};
  try { p2 = JSON.parse((res2 && res2.stdout) || "{}"); } catch { p2 = {}; }
  pendMail().length === 1 && p2.mail_to === null
    ? ok("P6 原话里没有邮箱时不编收件人：仍只有那一条待批准，这条只留草稿")
    : bad("P6 无地址却排队/编造收件人", JSON.stringify({ mail_to: p2.mail_to, queued: pendMail().length }));

  /* 批准 → 真发（和 UI 的 approvals.runAllowed 完全同一条执行路径） */
  const cmd = queued.length ? String(queued[0].command) : "";
  const sent = cmd
    ? await ffi.executeHostEffects([{ kind: "mail_send", command: cmd }], { approved: true, sessionId: "gp156" })
    : [];
  const sr = (sent || []).find((x) => x && x.kind === "mail_send");
  const sendsNow = listJson(SEND_DIR).filter((f) => !sendsBefore.includes(f));
  const body = sendsNow.length ? fs.readFileSync(path.join(SEND_DIR, sendsNow[0]), "utf8") : "";
  sr && sr.ok && sendsNow.length === 1 && body.includes("news@example.com") && body.includes("降价")
    ? ok("P7 批准之后才真发：" + SEND_DIR.replace(root, "<repo>") + "/" + sendsNow[0] + "（收件人 + 稿件正文都在）")
    : bad("P7 批准后没有真发工件", JSON.stringify({ ok: sr && sr.ok, err: sr && (sr.error || sr.refused), sendsNow, hasTo: body.includes("news@example.com") }).slice(0, 400));

  const drafts = listJson(DRAFT_DIR);
  drafts.length >= 2 ? ok("P8 两次触发各留一份草稿（" + drafts.length + " 份），审批走的是队列不是磁盘")
    : bad("P8 草稿缺失", JSON.stringify(drafts));

  console.log("prove_gp156_routine_approval: PASS=" + pass + " FAIL=" + fail);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* keep */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("probe crashed: " + ((e && e.stack) || e));
  console.log("prove_gp156_routine_approval: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
