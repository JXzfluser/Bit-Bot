#!/usr/bin/env node
"use strict";

/**
 * prove_approval_scope — 「总是允许」不能是一把万能钥匙
 *
 * 现场推演(真实用户旅程,不是假设):
 *   手机上批了一条「git status」的待批准请求,顺手点「总是允许」。
 *   老口径写下的规则是 `shell:*` —— 于是这台机器**以后任何一条 shell 命令**
 *   都不再逐次问你。用户当时看到的只有一条 `git status`。
 *   一次授权的量,远大于用户当时批准的那一件事。
 *
 *   同一个坑还有第二个面:effect 的 command 里带着**内容**——
 *   mail_send 是 `provider|收件人|主题|正文`,channel_send 是 `渠道 :: 正文`。
 *   如果把原样 command 写进长期规则,等于把邮件正文/消息内容在磁盘上再存一份。
 *
 * 契约(先立红,修完必须全绿):
 *   1. 「总是允许」默认写**作用域**规则:kind:<作用域>。
 *      shell        → 可执行名[ + 子命令]   shell:git status
 *      mail_send    → 收件人                mail_send:me@example.com
 *      channel_send → 渠道名                channel_send:dingtalk
 *   2. 作用域里**不含正文/参数值** —— 规则文件里不能出现邮件正文。
 *   3. 算不出作用域(命令带管道/复合/路径,或 kind 没定义作用域)
 *      ⇒ **不写长期规则**。这次批了,下次照常再问。
 *      宁可多问一句,也不默默递一把万能钥匙。
 *   4. 想按类放行必须**显式**(--wide / scope:"wide"),且老规则 kind:* 继续有效
 *      —— 新逻辑不能把已经发出去的授权悄悄作废。
 *   5. 作用域规则**不越界**:批了 `git status` 不等于批了 `git push --force`。
 *   6. ask 优先于 allow 的老口径(GP-22)不回归。
 *   7. CLI:不写 --yes 就不许放行(退出码 3),而且**一条规则都不许落盘**。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { createProductSurface } = require("../hosts/desktop/product_surface");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };
const eq = (m, actual, expected) => {
  if (String(actual) === String(expected)) ok(m + "（" + String(expected) + "）");
  else bad(m, "期望 " + JSON.stringify(expected) + " 实际 " + JSON.stringify(actual));
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "as-"));
const REPO = path.join(__dirname, "..");
const surf = createProductSurface(root);
const RULES = path.join(root, "data", "desktop", "approval-rules.json");
const readRules = () => { try { return JSON.parse(fs.readFileSync(RULES, "utf8")); } catch (_) { return { rules: [] }; } };
const ruleCount = () => ((readRules().rules) || []).length;
const scopeOf = (kind, command) => surf.approvalScope(kind, command);

console.log("prove_approval_scope（「总是允许」的作用域）");

// ── AS-01 作用域怎么算 ───────────────────────────────────────────────────
eq("AS-01 shell 取可执行名+子命令", scopeOf("shell", "git status"), "git status");
eq("AS-02 shell 第二个词是 flag 时只取可执行名", scopeOf("shell", "ls -la"), "ls");
eq("AS-03 mail_send 只取收件人(不含主题/正文)", scopeOf("mail_send", "gmail|me@example.com|主题|正文"), "me@example.com");
eq("AS-04 channel_send 只取渠道名(不含正文)", scopeOf("channel_send", "dingtalk :: 秘密正文"), "dingtalk");
eq("AS-04b mcp_call 只取服务名(不含参数)", scopeOf("mcp_call", "notion.search|{\"query\":\"秘密\"}"), "notion.search");
eq("AS-05 没定义作用域的 kind 算不出来", scopeOf("purchase_item", "buy a thing"), "");
eq("AS-06 空命令算不出来", scopeOf("shell", ""), "");

// ── AS-07 负向对照:带管道/复合的命令算不出作用域 ─────────────────────────
eq("AS-07 带 && 的复合命令算不出作用域", scopeOf("shell", "git status && rm -rf /"), "");
eq("AS-08 带管道的命令算不出作用域", scopeOf("shell", "cat a | grep b"), "");
eq("AS-09 带重定向的命令算不出作用域", scopeOf("shell", "echo x > /tmp/f"), "");

// ── AS-10 端到端:always 写的是作用域规则 ────────────────────────────────
const pShell = surf.appendPendingApproval({ source: "chat", kind: "shell", command: "git status" });
const dShell = surf.approvalDecide(pShell.id, "always");
eq("AS-10 always 写下的是作用域规则", dShell.persisted_pattern, "shell:git status");
eq("AS-11 作用域标记是 scoped", dShell.persisted_scope, "scoped");
ok("AS-12 规则真的落盘了", ruleCount() === 1 && readRules().rules[0].pattern === "shell:git status");

// ── AS-13 负向对照:作用域规则不越界 ─────────────────────────────────────
eq("AS-13 同一条命令不再问", surf.approvalRuleMatch("shell", "git status"), "allow");
eq("AS-14 同作用域(多了个 flag)也不再问", surf.approvalRuleMatch("shell", "git status --short"), "allow");
eq("AS-15 负向:别的命令照常要问", surf.approvalRuleMatch("shell", "rm -rf /"), null);
eq("AS-16 负向:同族别的子命令照常要问", surf.approvalRuleMatch("shell", "git push --force"), null);
eq("AS-17 负向:别的 kind 照常要问", surf.approvalRuleMatch("mail_send", "gmail|me@example.com|s|b"), null);

// ── AS-18 邮件:规则文件里不许出现正文 ───────────────────────────────────
const pMail = surf.appendPendingApproval({
  source: "chat",
  kind: "mail_send",
  command: "gmail|me@example.com|季度报告|正文里的秘密:账号123456",
});
const dMail = surf.approvalDecide(pMail.id, "always");
eq("AS-18 邮件的规则按收件人收窄", dMail.persisted_pattern, "mail_send:me@example.com");
const rulesRaw = fs.existsSync(RULES) ? fs.readFileSync(RULES, "utf8") : "";
ok("AS-19 负向:规则文件里没有邮件正文", !rulesRaw.includes("账号123456"));
ok("AS-20 负向:规则文件里没有邮件主题", !rulesRaw.includes("季度报告"));
ok("AS-21 负向:规则文件里没有整条 command", !rulesRaw.includes("gmail|me@example.com|季度报告"));
eq("AS-22 同一个收件人的邮件不再问", surf.approvalRuleMatch("mail_send", "gmail|me@example.com|别的主题|别的正文"), "allow");
eq("AS-23 负向:换个收件人照常要问", surf.approvalRuleMatch("mail_send", "gmail|other@example.com|s|b"), null);

// ── AS-24 算不出作用域 ⇒ 不写长期规则 ───────────────────────────────────
const before = ruleCount();
const pShell2 = surf.appendPendingApproval({ source: "chat", kind: "shell", command: "git status && rm -rf /" });
const dShell2 = surf.approvalDecide(pShell2.id, "always");
eq("AS-24 这次仍然批了", dShell2.ok, true);
eq("AS-25 算不出作用域就不写规则", dShell2.persisted_pattern || "", "");
eq("AS-26 负向:规则条数没变(没有悄悄落盘)", ruleCount(), before);
eq("AS-27 负向:这类命令下次照常要问", surf.approvalRuleMatch("shell", "git status && rm -rf /"), null);

// ── AS-28 --wide 才是按类放行 ────────────────────────────────────────────
const pShell3 = surf.appendPendingApproval({ source: "chat", kind: "shell", command: "docker build ." });
const dWide = surf.approvalDecide(pShell3.id, "always", undefined, { scope: "wide" });
eq("AS-28 --wide 写的是按类规则", dWide.persisted_pattern, "shell:*");
eq("AS-29 --wide 的作用域标记是 kind", dWide.persisted_scope, "kind");

// ── AS-30 老规则(kind:*)继续有效,不能被新逻辑悄悄作废 ─────────────────
eq("AS-30 老的一类放行规则仍然生效", surf.approvalRuleMatch("shell", "任何一条命令"), "allow");

// ── AS-31 ask 优先于 allow(GP-22 不回归) ─────────────────────────────────
surf.approvalRuleUpsert({ pattern: "shell:git status", decision: "ask", source: "team" });
eq("AS-31 ask 仍然压过 allow", surf.approvalRuleMatch("shell", "git status"), "ask");
surf.approvalRuleRemove("shell:git status");
eq("AS-32 移掉 ask 之后回到 allow", surf.approvalRuleMatch("shell", "git status"), "allow");

// ── AS-33 CLI:不写 --yes 就不许放行,而且一条规则都不许落盘 ──────────────
const credDir = path.join(root, "cred");
let credFile = "";
try {
  execFileSync(process.execPath, [path.join(REPO, "scripts/device-keys.js"), "init", "--kind", "mobile", "--name", "test-phone", "--out", credDir], { encoding: "utf8" });
  const files = fs.readdirSync(credDir).filter((f) => f.endsWith(".json"));
  if (files.length) credFile = path.join(credDir, files[0]);
} catch (_) { /* 凭证生成失败 ⇒ 下面如实标 SKIP */ }

if (!credFile) {
  console.log("  - AS-33~AS-36 跳过:没生成设备凭证");
} else {
  const cli = path.join(REPO, "scripts/approve.js");
  const runCli = (args) => {
    try {
      const out = execFileSync(process.execPath, [cli, "--box", "http://127.0.0.1:1", "--credential", credFile, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status === undefined ? -1 : e.status, out: String(e.stdout || "") + String(e.stderr || "") };
    }
  };
  const rulesBeforeCli = ruleCount();
  const r1 = runCli(["always", "approval-x"]);
  eq("AS-33 没写 --yes ⇒ 退出码 3(不放行)", r1.code, 3);
  ok("AS-34 提示语说的是「同一件」而不是「这一类」", r1.out.includes("同一件"));
  eq("AS-35 负向:CLI 退出前一条规则都没落盘", ruleCount(), rulesBeforeCli);

  const r2 = runCli(["always", "--wide", "approval-x"]);
  eq("AS-36 --wide 没写 --yes 也是退出码 3", r2.code, 3);
  ok("AS-37 --wide 的提示语明说「按类」", r2.out.includes("按类"));

  const r3 = runCli(["always", "--yes", "approval-x"]);
  ok("AS-38 写了 --yes 才会往下走(不再停在退出码 3)", r3.code !== 3);
  eq("AS-39 负向:连不上 Box 也没落盘任何规则", ruleCount(), rulesBeforeCli);
}

console.log("\nprove_approval_scope: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);
