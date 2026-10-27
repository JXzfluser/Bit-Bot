#!/usr/bin/env node
/* prove_report_history_intact.mjs — 交付报告的历史段落不能被吃掉（RH-01..RH-06）
 *
 * 为什么需要这道门：227e4ed 那一轮我用编辑工具往 report.md 追加 §8.18，
 * 结果工具把 §8.15.7、§8.16.1..8.16.8、§8.17.1..8.17.5 共 188 行已提交的记录
 * 一起删掉了，而这个删除被原样提交。报告是这个项目唯一的过程证据，
 * 「上一轮的红色证据被这一轮的提交静默抹掉」和「门禁造假」是同一类事故 ——
 * 所以它必须是一道门，不是一句自觉。
 *
 * Run: node scripts/prove_report_history_intact.mjs [报告路径]
 *      （默认 docs/design/desktop-target/report.md）
 *
 * ── 修复前红（真实输出，针对 227e4ed 里那份被吃掉段落的文件）────────────
 *   ✗ RH-01 已交付波次的标题必须全部在报告里 — 缺 16 个：8.15.7 / 8.16 全段 /
 *     8.16.1..8.16.8 / 8.17 全段 / 8.17.1..8.17.5
 *   ✗ RH-05 报告行数不得低于 480 — 实际 251 行（整段被截断）
 *   prove_report_history_intact: PASS=4 FAIL=2   (exit=1)
 *
 * ── 修复后绿（恢复 + 追加，diff 对 82b6f96 纯增量 68 行 / 0 删）──────────
 *   prove_report_history_intact: PASS=6 FAIL=0   (exit=0)
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log("  ✓ " + m); };
const bad = (m, d) => { FAIL++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 400) : "")); };
const done = () => {
  console.log("prove_report_history_intact: PASS=" + PASS + " FAIL=" + FAIL);
  process.exit(FAIL ? 1 : 0);
};

const REL = "docs/design/desktop-target/report.md";
const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO, REL);

if (!fs.existsSync(target)) {
  bad("RH-00 报告文件存在", target);
  done();
}

const text = fs.readFileSync(target, "utf8");
const lines = text.split("\n");

/* 提取标题：只认 markdown 的 ## / ###，并保留原文（含编号） */
const headings = (t) =>
  t.split("\n")
    .filter((l) => /^#{2,3} /.test(l))
    .map((l) => l.replace(/\s+$/, ""));

const hs = headings(text);

/* RH-01：这些段落是已经交付过的波次的唯一证据，一个都不能少 */
{
  const REQUIRED = [
    "### 8.15.7 产包这条路：`.github/workflows/android-apk.yml`",
    "## 8.16 打磨第二轮：配对地址、错误话术、在线证据落盘",
    "### 8.16.1 手机端配对地址归一（`hosts/android/.../TurnBridge.kt`）",
    "### 8.16.2 桌面那一行给的是「手机要填的东西」",
    "### 8.16.3 配对地址该挑哪块网卡（新增 `hosts/shared/lan_candidates.js`）",
    "### 8.16.4 在线证据的落盘健壮性（`hosts/shared/machine_presence.js`）",
    "### 8.16.5 其他如实化",
    "### 8.16.6 门禁接入与回归",
    "### 8.16.7 全量矩阵抓出来的两处：本轮自己新欠的视觉债",
    "### 8.16.8 残留（诚实）",
    "## 8.17 手机端把桌面的失败码翻成人话（同一轮评审里的第二段）",
    "### 8.17.1 先写复现测试，结果第一版测试自己是假的",
    "### 8.17.2 翻译层的取舍",
    "### 8.17.3 地址填了、令牌空着：不发包就先说",
    "### 8.17.4 门禁与回归",
    "### 8.17.5 残留（诚实）",
    "## 8.18 用户真机反馈推翻了一屏：配对改成「自动发现 + 6 位码」",
    "### 8.18.1 复核时抓到的三个「看起来修了」",
    "### 8.18.2 顺手的两处产品态度修正",
    "### 8.18.3 证据",
    "### 8.18.4 残留（诚实）",
    "## 8.19 提交之后才发现：我把报告的旧段落吃掉了（同一轮的自查事故）",
    "## 8.20 矩阵自己抓到的偶发：在线证据在高负载下会静默丢行",
    "## 8.21 桌面这屏也在「各种都要输入」：国内渠道凭证不裸奔",
  ];
  const have = new Set(hs);
  const missing = REQUIRED.filter((h) => !have.has(h));
  if (missing.length) bad("RH-01 已交付波次的标题必须全部在报告里", "缺 " + missing.length + " 个：" + missing.join(" / "));
  else ok("RH-01 " + REQUIRED.length + " 个已交付波次标题全在（8.15.7 / 8.16.* / 8.17.* / 8.18.*）");
}

/* RH-02：同一段标题不能出现两次（编辑工具重复插入是本仓库的高频事故） */
{
  const seen = new Map();
  for (const h of hs) seen.set(h, (seen.get(h) || 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([h, n]) => h + "×" + n);
  if (dup.length) bad("RH-02 标题不得重复（典型症状是整段被复制两份）", dup.join(" / "));
  else ok("RH-02 无重复标题（" + hs.length + " 个标题各一次）");
}

/* RH-03：编号必须单调递增，否则说明段落被插错位或前后颠倒了 */
{
  const num = (h) => {
    const m = h.match(/^#{2,3} (8(?:\.\d+)+)/);
    return m ? m[1].split(".").slice(1).map(Number) : null;
  };
  const seq = hs.map(num).filter(Boolean);
  const cmp = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  };
  let firstBad = null;
  for (let i = 1; i < seq.length; i++) {
    if (cmp(seq[i - 1], seq[i]) >= 0) { firstBad = seq[i - 1].join(".") + " 之后出现 " + seq[i].join("."); break; }
  }
  if (firstBad) bad("RH-03 小节编号必须单调递增（追加只能往后写）", firstBad);
  else ok("RH-03 " + seq.length + " 个带编号小节严格递增");
}

/* RH-04：代码围栏必须成对，未闭合的 ``` 会把后面的正文整体吞掉 */
{
  const fences = (text.match(/^```/gm) || []).length;
  if (fences % 2 !== 0) bad("RH-04 代码围栏数量必须为偶数", "共 " + fences + " 个，有未闭合的 ```");
  else ok("RH-04 代码围栏成对闭合（" + fences / 2 + " 段）");
}

/* RH-05：行数下限。整段被删是最省事的“修复”，下限把它变成红灯 */
{
  const FLOOR = 480;
  if (lines.length < FLOOR) bad("RH-05 报告行数不得低于 " + FLOOR, "实际 " + lines.length + " 行");
  else ok("RH-05 报告 " + lines.length + " 行（下限 " + FLOOR + "，只许涨不许塌）");
}

/* RH-06：本次改动不得删除 HEAD 版本里的任何标题。
 * 这条才是“防下一次”的机制：把已提交的段落迁走要显式写清单，不能悄悄吃。
 * 允许迁走：本清单为空 —— 到现在为止没有一段该从报告里消失。 */
{
  const MOVED_OUT = new Set();
  let headText = null;
  try {
    headText = execFileSync("git", ["show", "HEAD:" + REL], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    bad("RH-06 读取 HEAD 版本的报告失败（这道门需要在 git 工作区里跑）", String(e.message || e));
  }
  if (headText !== null) {
    const gone = headings(headText).filter((h) => !hs.includes(h) && !MOVED_OUT.has(h));
    if (gone.length) bad("RH-06 不得删除 HEAD 里已提交的段落", "消失的标题：" + gone.join(" / "));
    else ok("RH-06 HEAD 版本的段落一节没少（当前为纯增量或等价）");
  }
}

/* RH-07：不止 report.md —— 任何已提交的过程文档都不许被吃掉。
 * 这轮又撞上同一种事故：working tree 里的 parity-gaps-next.md 从 168 行掉到 95 行，
 * 「〇、核心叙事」整段（主线八步 × 内核原语映射表）被静默删除，而且不是这次的编辑造成的，
 * 是工作区里一份陈旧快照把提交过的内容盖掉了。RH-06 只盯 report.md，抓不到第二份文档。
 *
 * 修复前红（负向对照的真实输出：临时删掉「〇、核心叙事」整段 2445 字符后）：
 *   ✗ RH-07 已提交的过程文档不许丢段落 — docs/grok-desktop-parity/parity-gaps-next.md
 *     消失的标题：## 〇、核心叙事：多 Bot 协作编排回路（本次梳理的正主） /
 *     ### 主线八步 × 内核原语映射 / ### 关键纪律（回应"别搬调试台"） /
 *     ### 由此确定的本波核心工作包（取代按"暴露能力"排期）
 *   prove_report_history_intact: PASS=6 FAIL=1   (exit=1)
 * 修复后绿（对照跑完即 git checkout 还原）：
 *   ✓ RH-07 两份过程文档（验收报告 + parity 清单）相对 HEAD 一节没少
 *   prove_report_history_intact: PASS=7 FAIL=0
 *   本轮对 report.md 的实际 diff = 87 增 / 0 删。
 */
{
  const TRACKED = [
    "docs/design/desktop-target/report.md",
    "docs/grok-desktop-parity/parity-gaps-next.md",
  ];
  const problems = [];
  for (const rel of TRACKED) {
    let headText = null;
    try {
      headText = execFileSync("git", ["show", "HEAD:" + rel], {
        cwd: REPO,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      problems.push(rel + "：读 HEAD 失败 " + String(e.message || e).slice(0, 80));
      continue;
    }
    if (!fs.existsSync(path.join(REPO, rel))) {
      problems.push(rel + "：工作区里这个文件已经不存在");
      continue;
    }
    const cur = new Set(headings(fs.readFileSync(path.join(REPO, rel), "utf8")));
    const gone = headings(headText).filter((h) => !cur.has(h));
    if (gone.length) problems.push(rel + " 消失的标题：" + gone.slice(0, 8).join(" / "));
  }
  if (problems.length) bad("RH-07 已提交的过程文档不许丢段落", problems.join(" | "));
  else ok("RH-07 两份过程文档（验收报告 + parity 清单）相对 HEAD 一节没少");
}

done();
