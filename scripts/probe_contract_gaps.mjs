#!/usr/bin/env node
/**
 * probe_contract_gaps.mjs — 「产物能不能真用」的契约盲区探针。
 *
 * 为什么要有这个：
 *   契约（rules）决定「这一棒交的东西算不算交付」。现在的规则只认
 *   「够长 + 有关键词 + 有链接」⇒ 一份**内容是垃圾**的产物照样过验收。
 *   用户视角的评审说「不能用」，但那到底是「内容不好」还是「规则太松」？
 *   ⇒ 用产品自己的 judgeStage 实测，把「规则太松」变成可复现的证据。
 *
 * 跑法：node scripts/probe_contract_gaps.mjs
 * 退出码 0 = 现状（每条都判过 ⇒ 有盲区）；1 = 有案例判红（盲区已修）。
 *
 * 纪律：
 *   - 只用**产品里真实的 judgeStage**，不自己重写一套判据
 *   - 每个案例都要标出「按现状规则能不能过」和「加上什么规则能拦住」
 *   - 负例必须有：**加规则后必须判红**，否则这条规则就是假绿
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const require = createRequire(path.join(REPO, "hosts/desktop/package.json"));
const { judgeStage } = require(path.join(REPO, "hosts/desktop/room_orchestrator.js"));

/* 现状模板契约（hosts/shared/host_ffi.js 的 BOT_TEMPLATE_SEED） */
const NOW = {
  情报侦察员: { min_chars: 200, must_include: ["http"], min_urls: 1 },
  选题策划师: { min_chars: 200, must_include: ["http"], min_urls: 1 },
  内容主笔: { min_chars: 140, must_include: ["事实依据"] },
  事实编辑: { min_chars: 200, must_include: ["来源"] },
  数据复盘师: { min_chars: 200, must_include: ["数据来源"] },
};

const FILLER = "空话废话。".repeat(30);   // ≈120 字，用来凑够 min_chars
const cases = [
  {
    role: "情报侦察员",
    name: "只交 1 条情报 + 凑字数的废话",
    text: "1. 某公司发布了新东西\n   原始链接：https://example.com/x\n   证据摘录：" + FILLER + "\n   核验状态：已核验。",
    fix: { min_items: 3 },
    why: "真实场景要 3-8 条；现状 1 条也能过",
  },
  {
    role: "选题策划师",
    name: "3 个题，但全是空话",
    text: "题 1｜随便写点什么\n   原始链接与证据：https://example.com/a\n   读者场景：所有想变强的人。" + FILLER,
    fix: { min_items: 3, min_urls: 3 },
    why: "3 个题各带 1 个链接 ⇒ min_urls:3 能挡住「只挂一个链接重复用」",
  },
  {
    role: "内容主笔",
    name: "正文里出现「事实依据」四个字，但内容是空的",
    text: "这是一段没有任何来源的正文".repeat(10) + "\n事实依据：无。" + FILLER,
    fix: { min_urls: 1 },
    why: "主笔稿子必须真的挂上来源链接（现在只查关键词）",
  },
  {
    role: "事实编辑",
    name: "「来源」二字 + 200 字废话",
    text: "来源\n" + "我觉得没什么问题。".repeat(40),
    fix: { min_items: 3 },
    why: "审校意见必须逐条给结论，不能是「没问题」",
  },
  {
    role: "数据复盘师",
    name: "编造的数字（声称 8 条情报，实际只有 2 条）",
    text: "数据来源：本周五棒记录（情报卡 8 条、brief 3 题）\n" + "我们完成了一轮完整链路。".repeat(20),
    fix: { min_items: 3 },
    why: "复盘里的数字必须与实际产物对得上 ⇒ 需要交叉核对，不是长度能管的",
  },
];

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

/* 抽出产品里真实的 URL 计数正则（不重写一套 —— 抄它的行为会抄错） */
const { countDeliverableUrls } = (() => {
  const src = require("node:fs").readFileSync(
    path.join(REPO, "hosts/desktop/room_orchestrator.js"), "utf8");
  const body = src.match(/function countDeliverableUrls\(content\)\s*\{([\s\S]*?)\n\}/);
  if (!body) return { countDeliverableUrls: null };
  /* 直接用产品的正则字面量：抠出 s.match(/…/g) 那一段 */
  const re = body[1].match(/s\.match\((\/.*?\/g)\)/);
  if (!re) return { countDeliverableUrls: null };
  const rx = eval(re[1]);
  return { countDeliverableUrls: (content) => (String(content || "").match(rx) || []) };
})();

console.log("probe_contract_gaps — 契约盲区探针");
console.log("  用产品真实的 judgeStage 实测：现状规则到底拦不拦得住垃圾产物\n");

/* ── 专项 A：countDeliverableUrls 把坏链当成好链在数 ────────────────────── */
console.log("── 专项 A · URL 计数把坏链当好链");
{
  /* 用**真实产物里那行**（不是构造的）—— 构造文本容易漏掉真实世界的字符形态。
     这行来自 03-drafts/2026-11-24-draft.md 的「事实依据」段。 */
  const realLine = "事实依据：o3-mini 推理更新公告（[https://openai.com/index/o3-mini-update）与开源推理框架](https://openai.com/index/o3-mini-update）与开源推理框架) v2 Release（[https://github.com/example/infer/releases/tag/v2.0.0）。](https://github.com/example/infer/releases/tag/v2.0.0）。)";
  const n = countDeliverableUrls ? countDeliverableUrls(realLine).length : -1;
  const toks = countDeliverableUrls ? countDeliverableUrls(realLine) : [];
  const allBad = toks.length > 0 && toks.every((u) => /[^\x00-\x7F]/.test(u));
  if (n > 0 && allBad) {
    bad("countDeliverableUrls 把带全角括号的坏链数成了完整 URL",
      "数出 " + n + " 条，distinct " + new Set(toks).size + "，**全部含非 ASCII 字符** ⇒ min_urls 反而在帮坏链计数" +
      "（正则是 [^\\s)\\]}\"'<>，。；：、]+，**没排全角 ）**）");
  } else {
    ok("countDeliverableUrls 已能识别坏链（数出 " + n + " 条）");
  }
}

/* ── 专项 B：跨棒链接集合差（无源选题） ──────────────────────────────────── */
console.log("── 专项 B · 跨棒链接集合差（无源选题）");
{
  const intel = "1. 线索一\n   原始链接：https://openai.com/x\n2. 线索二\n   原始链接：https://github.com/y";
  const brief = "题 1｜基于线索一\n   链接：https://openai.com/x\n题 2｜无源题\n   链接：https://example.com/audit-notes";
  const u = (s) => [...new Set(s.match(/https?:\/\/[^\s)\]}\"'<>]+/g) || [])];
  const orphan = u(brief).filter((x) => !u(intel).includes(x));
  if (orphan.length) {
    bad("brief 里存在情报卡没有的链接（无源选题能过验收）",
      JSON.stringify(orphan) + " ⇒ 跨棒集合差可确定性检出");
  } else {
    ok("brief 的链接都能在情报卡里找到出处");
  }
}

/* ── 专项 C：min_items 会误杀写法不同的正确产物 ────────────────────────── */
console.log("── 专项 C · min_items 的副作用（会误杀正确产物）");
{
  const brief = "题 1｜第一个题\n   链接：https://a.com/1\n题 2｜第二个题\n   链接：https://a.com/2\n题 3｜第三个题\n   链接：https://a.com/3";
  const { countDeliverableItems } = require(path.join(REPO, "hosts/desktop/room_orchestrator.js"));
  const items = countDeliverableItems(brief);
  const v = judgeStage({
    text: brief, contract: { dir: "x", rules: { min_chars: 200, must_include: ["http"], min_urls: 1, min_items: 3 } },
    what: "选题brief",
  });
  if (!v.pass && items === 0) {
    bad("min_items 会误杀「题 N｜」这种写法（正确产物被判红）",
      "countDeliverableItems 数出 " + items + " 条（写法不匹配 ^\\d+[.、)] ）⇒ " + v.reason);
  } else {
    ok("min_items 对「题 N｜」写法可用");
  }
}

/* ── 专项 D：prompt 要求的固定交付，契约一项都不查 ───────────────────────── */
console.log("── 专项 D · prompt 要求 5 项固定交付，契约只查 1 个词");
{
  /* 事实编辑的岗位 prompt 原文写着：
     【固定交付】…包含：可发布候选版本、改动说明、风险标记、仍需人工确认、原始来源清单。
     契约只有 must_include:["来源"]。 */
  const required = ["可发布候选版本", "改动说明", "风险标记", "仍需人工确认", "原始来源清单"];
  /* 只交了「审校意见」的真实产物形态（不含那 5 项里的任何一个） */
  const realReview = "审校意见 · 候选稿第 1 稿\n总体结论：论点站得住。\n一、事实核对\n   1. 表述过宽，建议改为「单次推理成本结构变化」。\n二、来源清单\n   来源 1：[https://openai.com/x](https://openai.com/x) —— 一手官方公告，可用。\n三、仍需确认\n   定价页是否同步更新。" + "补充说明。".repeat(30);
  const missing = required.filter((k) => !realReview.includes(k));
  const v = judgeStage({
    text: realReview,
    contract: { dir: "x", rules: { min_chars: 200, must_include: ["来源"] } },
    what: "审校意见",
  });
  if (v.pass && missing.length) {
    bad("契约不查 prompt 要求的固定交付：缺 " + missing.length + "/" + required.length + " 项仍判过",
      "缺：" + missing.join("、") + " ⇒ 契约只命中了「来源」两个字");
  } else {
    ok("契约拦住了缺项的审校意见");
  }
}

console.log("");

for (const c of cases) {
  const nowRules = NOW[c.role];
  const v1 = judgeStage({ text: c.text, contract: { dir: "x", rules: nowRules }, what: c.role });
  const fixRules = Object.assign({}, nowRules, c.fix);
  const v2 = judgeStage({ text: c.text, contract: { dir: "x", rules: fixRules }, what: c.role });

  console.log("── " + c.role + " · " + c.name);
  if (!v1.pass) {
    ok("现状规则已拦住（无需修）" + (v1.reason ? "：" + v1.reason : ""));
  } else {
    /* 现状判过 = 盲区。要说清「加上什么规则能拦住」，且必须真的判红。 */
    if (v2.pass) {
      bad("现状判过，但建议的规则也没拦住 —— 这条建议是假绿",
        JSON.stringify(c.fix) + " ⇒ 仍判过");
    } else {
      ok("现状判过 ⇒ 盲区已复现；加 " + JSON.stringify(c.fix) + " 后判红 ⇒ 规则有效");
      console.log("      " + c.why);
      console.log("      判红理由：" + v2.reason);
    }
  }
}

console.log("\nprobe_contract_gaps: PASS=" + pass + " FAIL=" + fail);
console.log("  ⇒ FAIL=0 表示：每条盲区都有「现状判过 + 加规则判红」的双向证据。");
process.exit(fail ? 1 : 0);
