#!/usr/bin/env node
"use strict";

/**
 * prove_approval_single_source — 审批队列的**渲染与决定必须读同一个真源**
 *
 * 现场（真 provider 第七轮 P11 实测）：界面上明明显示着待批准行，
 * 用户点「本次允许 / 拒绝」却拿到 `approval_not_found` —— **看得见、管不着**。
 *
 * 根因：队列有**两个读取口**：
 *   · 渲染（`pendingApprovals`）在事件读模型开启时读**事件库**；
 *   · 决定（`approvalDecide`）却仍读**遗留 jsonl**。
 * ⇒ 两个真源各说各话。
 *
 * 契约（先立红，修完必须全绿）：
 *   1. 挂出的行，渲染**看得见**、决定**找得到**（同一 id、同一份数据）。
 *   2. 决定**成功**（ok=true），不是「找不到」。
 *   3. 决定之后，渲染**不再**把它当成待批准（状态真的落到真源里）。
 *   4. 决定**之后**真源里**没有**别的行被抹掉（整面覆盖不能吃掉别人的行）。
 *   5. 行形状不变（id/source/kind/command/requested_at/expires_at/status）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "apv-single-"));
const surf = createProductSurface(root);
const PEND = path.join(root, "data", "desktop", "pending-approvals.jsonl");

const readJsonl = () => {
  try {
    return fs.readFileSync(PEND, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
};

(async () => {
  /* 挂两行同源不同命令的批准 —— 第二行用来验「决定第一行不抹掉第二行」。 */
  const a = surf.appendPendingApproval({ source: "routine", kind: "mail_send", command: "gmail|me@example.com|first|body" });
  const b = surf.appendPendingApproval({ source: "routine", kind: "mail_send", command: "gmail|me@example.com|second|body" });
  ok("挂出两行待批准（id=" + (a && a.id) + " / " + (b && b.id) + "）");

  /* 1：渲染看得见 */
  const listed = surf.pendingApprovals();
  const ids = (listed || []).map((x) => String(x && x.id));
  ids.includes(String(a.id)) && ids.includes(String(b.id))
    ? ok("渲染看得到这两行（同一份数据）")
    : bad("渲染看不到刚挂出的行", JSON.stringify({ ids, a: a && a.id, b: b && b.id }));

  /* 2：决定找得到（这一条就是 P11 的要害） */
  const dec = surf.approvalDecide(a.id, "deny");
  dec && dec.ok === true
    ? ok("决定找得到同一行并成功（不再 approval_not_found）")
    : bad("决定找不到渲染明明显示着的行（双真源脱钩）", JSON.stringify(dec));

  /* 3：决定之后，渲染不再把它当待批准 */
  const after = surf.pendingApprovals();
  const stillPending = (after || []).some((x) => String(x && x.id) === String(a.id) && x.status === "pending");
  !stillPending
    ? ok("决定之后渲染不再把它当待批准（状态落到了真源）")
    : bad("决定了还显示成待批准", JSON.stringify((after || []).filter((x) => x && x.id === a.id)));

  /* 4：决定**没有**抹掉别人那一行 */
  const otherStill = (after || []).some((x) => String(x && x.id) === String(b.id) && x.status === "pending");
  otherStill
    ? ok("决定第一行没有把第二行一起抹掉（整面覆盖不吃别人的行）")
    : bad("决定抹掉了别人的行", JSON.stringify(readJsonl().map((x) => [x.id, x.status])));

  /* 5：行形状不变 */
  const rows = readJsonl();
  const keys = rows.length ? Object.keys(rows[0]).sort().join(",") : "";
  keys.includes("id") && keys.includes("source") && keys.includes("kind") &&
    keys.includes("command") && keys.includes("requested_at") && keys.includes("expires_at") &&
    keys.includes("status")
    ? ok("行形状未变（id/source/kind/command/requested_at/expires_at/status）")
    : bad("行的字段形状变了", keys);

  console.log("prove_approval_single_source: PASS=" + pass + " FAIL=" + fail);
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* keep */ }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("probe crashed: " + ((e && e.stack) || e));
  console.log("prove_approval_single_source: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
