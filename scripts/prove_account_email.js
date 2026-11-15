#!/usr/bin/env node
"use strict";

/**
 * prove_account_email — 「发我邮箱」得有个地址能落地
 *
 * 现场推演(真实用户旅程,不是假设):
 *   用户说「每天 9 点采集 AI 科技热点,发我邮箱」。
 *   到点了,机器醒了,草稿也备了 —— 但**没有收件人**:
 *   收件人只从任务原话里找字面邮箱地址,「发我邮箱」里没有地址 ⇒
 *   解析不出来 ⇒ 连一条待批准的邮件都不排(在工件里写 mail_to:null)。
 *   用户看到的是:任务"跑了",但邮箱里什么都没有,而他明明说了"发我邮箱"。
 *
 * 根因:账户档案里只有**名字**(label),没有地址。
 *
 * 契约(先立红,修完必须全绿):
 *   1. 账户档案能登记「我的邮箱」,且**形状**要校验(不对就不写)。
 *   2. 登记的地址在 accountStatus 里能看见(用户看得见自己登记了什么)。
 *   3. 定时任务原话是「发我邮箱」时 ⇒ 用登记的地址当收件人。
 *   4. 负向:没登记邮箱 ⇒ **不编收件人**,一条邮件审批都不排。
 *   5. 负向:原话里写了地址 ⇒ 以原话为准(不覆盖用户明说的)。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHostFfi } = require("../hosts/shared/host_ffi");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };
const check = (cond, m, d) => { if (cond) ok(m); else bad(m, d); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ae-"));
const dataRoot = path.join(tmp, "data");
const ffi = createHostFfi(tmp, { dataRoot });
const surf = createProductSurface(tmp, { dataRoot });
ffi.setTurnRunner(async () => ({ ok: true, assistant: "[fake]" }));

(async function main() {
console.log("prove_account_email（「我的邮箱」）");

/* pendingApprovals 返回的是**数组**(读时现算过期),不是 {pending:[]}。 */
const rowsOf = (p) => (Array.isArray(p) ? p : ((p && p.pending) || []));
const pending = () => {
  try {
    return rowsOf(surf.pendingApprovals());
  } catch (_) {
    return [];
  }
};

async function fireWithPrompt(id, prompt) {
  await ffi.executeHostEffects(
    [{ kind: "routine_schedule", command: id + "|@daily|" + prompt }],
    {},
  );
  const rows = await ffi.executeHostEffects([{ kind: "routine_fire", command: id }], {});
  const res = (rows || []).find((x) => x && x.kind === "routine_fire") || {};
  let payload = {};
  try { payload = JSON.parse(res.stdout || "{}"); } catch (_) { payload = {}; }
  return payload;
}

// ── AE-01 形状校验:不对的地址不写 ────────────────────────────────────────
const signed = surf.accountSignIn("personal");
check(signed && signed.ok === true, "AE-01 profile 登录成功", JSON.stringify(signed || {}).slice(0, 160));

const badEmail = surf.accountSetEmail("personal", "not-an-email");
check(badEmail && badEmail.ok === false, "AE-01 形状不对的地址被拒", JSON.stringify(badEmail || {}).slice(0, 160));
check(
  !(surf.accountStatus().active && surf.accountStatus().active.email),
  "AE-01 负向:被拒的地址一个字节都没落盘",
  JSON.stringify(surf.accountStatus().active || {}),
);

// ── AE-02 登记成功并回显 ─────────────────────────────────────────────────
const good = surf.accountSetEmail("personal", "me@example.com");
check(good && good.ok === true, "AE-02 地址登记成功", JSON.stringify(good || {}).slice(0, 160));
check(
  surf.accountStatus().active && surf.accountStatus().active.email === "me@example.com",
  "AE-02 账户状态里能看见登记的地址",
  JSON.stringify(surf.accountStatus().active || {}),
);
check(
  (surf.accountStatus().accounts || []).some((a) => a && a.email === "me@example.com"),
  "AE-02 账户列表里也能看见",
  JSON.stringify(surf.accountStatus().accounts || []),
);

// ── AE-03 「发我邮箱」⇒ 用登记的地址当收件人 ─────────────────────────────
const p1 = await fireWithPrompt("ae-r1", "每天9点采集 AI 科技热点,发我邮箱");
const mailRows = pending().filter((x) => x && x.kind === "mail_send");
check(mailRows.length === 1, "AE-03 「发我邮箱」排出了一条待批准的邮件", JSON.stringify(pending()).slice(0, 240));
check(
  mailRows[0] && String(mailRows[0].command || "").indexOf("me@example.com") >= 0,
  "AE-03 收件人用的是登记的地址",
  JSON.stringify(mailRows[0] || {}).slice(0, 240),
);
check(
  p1.mail_to === "me@example.com",
  "AE-03 工件里的 mail_to 也是那个地址",
  JSON.stringify(p1).slice(0, 200),
);

// ── AE-04 负向:没登记邮箱 ⇒ 不编收件人 ──────────────────────────────────
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "ae2-"));
const dataRoot2 = path.join(tmp2, "data");
const ffi2 = createHostFfi(tmp2, { dataRoot: dataRoot2 });
const surf2 = createProductSurface(tmp2, { dataRoot: dataRoot2 });
ffi2.setTurnRunner(async () => ({ ok: true, assistant: "[fake]" }));
await ffi2.executeHostEffects(
  [{ kind: "routine_schedule", command: "ae-r2|@daily|发我邮箱" }],
  {},
);
await ffi2.executeHostEffects([{ kind: "routine_fire", command: "ae-r2" }], {});
const pending2 = (() => {
  try {
    return rowsOf(surf2.pendingApprovals());
  } catch (_) {
    return [];
  }
})();
check(
  pending2.filter((x) => x && x.kind === "mail_send").length === 0,
  "AE-04 负向:没登记邮箱 ⇒ 一条邮件审批都不排(不编收件人)",
  JSON.stringify(pending2).slice(0, 240),
);

// ── AE-05 负向:原话里写了地址 ⇒ 以原话为准 ──────────────────────────────
const p3 = await fireWithPrompt("ae-r3", "发我邮箱,其实是 other@example.com");
const mail3 = pending().filter((x) => x && x.kind === "mail_send");
const withOther = mail3.find((x) => String(x.command || "").indexOf("other@example.com") >= 0);
check(
  !!withOther,
  "AE-05 原话里写了地址 ⇒ 以原话为准(不拿档案里的覆盖)",
  JSON.stringify(mail3.map((x) => String(x.command || "").slice(0, 60))).slice(0, 240),
);


console.log("\nprove_account_email: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("prove_account_email: " + String((e && e.message) || e));
  console.log("\nprove_account_email: PASS=" + pass + " FAIL=" + (fail + 1));
  process.exit(1);
});
