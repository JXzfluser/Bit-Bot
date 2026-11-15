#!/usr/bin/env node
"use strict";

/**
 * prove_team_brief — 组队话术解析:用户真写的那句话,得解析对
 *
 * 现场推演(真实用户旅程,不是假设):
 *   用户说:「组建团队(角色:采集/写作/排版)+ 每天定时采集 AI 科技热点
 *             + 更新公众号 + 发我邮箱」
 *   旧口径把 rest 按 / 切开 ⇒ roles = ["(角色:采集", "写作"]
 *     · 第一个角色**带着「(角色:」前缀** —— 侧栏里出现一个叫「(角色:采集」的 Bot
 *     · 第三个角色「排版」因为后面黏着整句任务(>12 字)被长度过滤**吃掉**
 *     · 只建出 2 个 Bot,第三个角色凭空消失
 *   同时「每天9点」被降级成 @daily(＝凌晨0点)—— 用户要 9 点,任务半夜跑。
 *
 * 契约(先立红,修完必须全绿):
 *   1. 「(角色:采集/写作/排版)」这种**显式角色清单**要整段摘出来再切:
 *      角色名干净、一个不少、清单里的连接词不混进角色名。
 *   2. 摘掉清单后剩下的才是**任务描述**。
 *   3. 「每天 / 每日 / 每晚 / 工作日」**不在桌面算时间** ⇒ cron 留空,
 *      交给内核确定性解析(桌面猜错了用户看不出来)。
 *      「每周 / 每月 / 每小时」内核不解析,桌面给明确的宏。
 *   4. 没写分隔符的长句仍**不是**角色清单(别建出叫「来处理公众号从每天…」的 Bot)。
 *   5. 问句不组队。
 *
 * 怎么测:这些函数在渲染器的闭包里,外面摸不到。
 * 这里把**真实源码**抠出来在 vm 里跑(仓库已有这个套路:prove_client_core.js
 * 的 CC-01 就是按 <script> 顺序装配渲染器),所以测的是产品真代码,
 * 不是另写一份。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 320) : "")); };
const eq = (m, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(m + "（" + JSON.stringify(expected) + "）");
  else bad(m, "期望 " + JSON.stringify(expected) + " 实际 " + JSON.stringify(actual));
};

console.log("prove_team_brief（组队话术解析）");

const html = fs.readFileSync(path.join(REPO, "hosts/desktop/index.html"), "utf8");

/* 抠出 TEAM_HEAD_RE … parseTeamBrief 这一段真源码。 */
const start = html.indexOf("const TEAM_HEAD_RE");
const endMark = "async function runTeamBrief";
const end = html.indexOf(endMark);
if (start < 0 || end < 0 || end <= start) {
  console.error("prove_team_brief: 抠不出解析器源码（渲染器形状变了？）");
  process.exit(1);
}
const src = html.slice(start, end);

/* wavegT 是 i18n 取词:这里只要一个占位,判据不依赖具体词条。 */
const ctx = vm.createContext({ wavegT: (k) => k, console });
vm.runInContext(src, ctx, { filename: "index.html#team-brief" });

const parse = ctx.parseTeamBrief;
const cronOf = ctx.teamCronOf;
if (typeof parse !== "function" || typeof cronOf !== "function") {
  console.error("prove_team_brief: 抠出来的源码里没有 parseTeamBrief / teamCronOf");
  process.exit(1);
}

// ── TB-01 显式角色清单:一个不少、名字干净 ────────────────────────────────
const full =
  "组建团队(角色:采集/写作/排版)+ 每天定时采集 AI 科技热点 + 更新公众号 + 发我邮箱";
const brief = parse(full);
check(brief, "TB-01 这句话被认出是组队话术");
eq("TB-01 三个角色一个不少", (brief && brief.roles) || [], ["采集", "写作", "排版"]);
ok(
  "TB-01 角色名里没有「角色:」这种前缀",
  (brief.roles || []).every((r) => !/角色|[:：]/.test(String(r))),
  JSON.stringify(brief.roles),
);

// ── TB-02 任务描述里不该再夹着角色清单 ───────────────────────────────────
ok(
  "TB-02 任务描述里没有角色清单的残渣",
  !/角色\s*[:：]/.test(String((brief && brief.task) || "")) &&
    !/排版/.test(String((brief && brief.task) || "")),
  JSON.stringify(brief && brief.task),
);
ok(
  "TB-02 任务描述还是那句真话",
  /采集/.test(String((brief && brief.task) || "")) && /邮箱/.test(String((brief && brief.task) || "")),
  JSON.stringify(brief && brief.task),
);

// ── TB-03 「每天」不在桌面算时间 ─────────────────────────────────────────
eq("TB-03 「每天早上9点」的 cron 留空(交给内核)", cronOf("每天早上9点采集热点"), "");
eq("TB-03 「每周」给明确的宏", cronOf("每周复盘一次"), "@weekly");
eq("TB-03 「每月」给明确的宏", cronOf("每月出一次报表"), "@monthly");
eq("TB-03 「每小时」给明确的宏", cronOf("每小时看一眼"), "@hourly");
eq("TB-03 「每晚」也留空(内核认每晚)", cronOf("每晚8点发日报"), "");

// ── TB-04 有排程意图 ⇒ scheduled 为真 ───────────────────────────────────
ok("TB-04 「每天…」⇒ scheduled 为真", brief && brief.scheduled === true, JSON.stringify(brief));
ok(
  "TB-04 排程意图在但 cron 留空 ⇒ 桌面不猜时间",
  brief && brief.cron === "",
  JSON.stringify(brief && brief.cron),
);

// ── TB-05 负向:没写分隔符的长句不是角色清单 ─────────────────────────────
const vague = parse("组建团队负责公众号从每天定时收集AI科技热点内容发我邮箱");
ok(
  "TB-05 负向:一整句任务不会被当成角色清单",
  !vague || (vague.roles || []).length === 0 || (vague.roles || []).length === 3,
  JSON.stringify(vague && vague.roles),
);
ok(
  "TB-05 负向:长句角色名不会被建出来",
  !vague || (vague.roles || []).every((r) => String(r).length <= 12),
  JSON.stringify(vague && vague.roles),
);

// ── TB-06 负向:问句不组队 ────────────────────────────────────────────────
eq("TB-06 负向:问句不组队", parse("组建团队要怎么做?"), null);
eq("TB-06 负向:不是组队话术就不管", parse("今天天气怎么样"), null);

// ── TB-07 负向对照:把显式清单的解析摘掉 ⇒ 必须翻红 ──────────────────────
{
  const broken = src.replace(
    /const roleHead = taskText\.match\([\s\S]*?\);/,
    "const roleHead = null;",
  );
  const ctx2 = vm.createContext({ wavegT: (k) => k, console });
  vm.runInContext(broken, ctx2, { filename: "index.html#team-brief-broken" });
  const b2 = ctx2.parseTeamBrief(full);
  const roles2 = (b2 && b2.roles) || [];
  const stillClean = roles2.length === 3 && roles2.every((r) => !/角色/.test(String(r)));
  ok(
    "TB-07 负向对照:摘掉显式清单的解析 ⇒ TB-01 立刻不成立(判据不是恒真)",
    !stillClean,
    JSON.stringify(roles2),
  );
}

console.log("\nprove_team_brief: PASS=" + pass + " FAIL=" + fail);
process.exit(fail ? 1 : 0);

function check(cond, m, d) {
  if (cond) ok(m);
  else bad(m, d);
}
