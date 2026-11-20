#!/usr/bin/env node
/* prove_expectations_fresh.mjs — 「门读的期望」必须是当前真源的派生物（EF-01..EF-05）
 *
 * 缘起（§8.180 边界②）：SP-04 改成读 reference/grok-acceptance-expectations.json 之后，
 * 门不再抄字面量，但换来一个新问题 —— 那份 JSON 是 scripts/grok_acceptance_expectations.mjs
 * 在 2026-10-24 生成的，**没有任何东西看守它是否随 grok-real-spec.json / bb-real-spec.json
 * 重生成**。真源重采而期望忘更新，门就会拿旧期望判新产品：既可能假红，更可能假绿
 * （640 那一格能活两年，正是「真值在盘上、门里是手抄数」这条链断掉的形状，见 §8.179）。
 *
 * 判据分三层，缺一条都算这条门没做事：
 *   可跑层（EF-01）—— 生成器在临时目录里跑通并交出合法期望；
 *   新鲜层（EF-02/03）—— 盘上期望逐字节等于「用当前两份 spec 重新生成」，且消费方读到的带
 *     确实溯回真源那个数（不是文件自己跟自己一致）；
 *   灵敏度（EF-04/05）—— 反向对照：改临时真源必须改到期望里；门源码里不许再长回字面量。
 *
 * 写法约束（踩过一次）：编号必须出现在 `ok("[EF-01] …")` 这种**双引号字面量**里。
 * 孤门尺 AC-02 是从源码字面量里提取「门自己声明的编号」，模板字面量 ok(`[EF-01] ${x}`) 它读不到，
 * 于是矩阵锚了点上门里「没有」的号，当场红（§8.181）。数值一律用 + 拼接，别改成反引号。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REPO = path.resolve(import.meta.dirname, "..");
const REF = path.join(REPO, "docs/design/desktop-target/reference");
const GEN = path.join(REPO, "scripts/grok_acceptance_expectations.mjs");
const COMMITTED = path.join(REF, "grok-acceptance-expectations.json");
const GROK_SRC = path.join(REF, "grok-real-spec.json");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exp-fresh-"));
const runGen = (refDir, outFile) => {
  execFileSync(process.execPath, [GEN, "--write", `--ref=${refDir}`, `--out=${outFile}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(fs.readFileSync(outFile, "utf8"));
};

/* EF-01 生成器在临时目录里跑通：跑不通（真源字段被改名/删掉）后面全都不用谈。 */
let fresh = null;
try {
  fresh = runGen(REF, path.join(tmp, "ef01.json"));
  if (fresh && fresh.bubble && fresh.bubble.maxWidth) ok("[EF-01] 生成器在临时目录跑通并交出 bubble.maxWidth（字段族 " + Object.keys(fresh).filter((k) => !k.startsWith("_")).length + " 族）");
  else bad("[EF-01] 生成器跑通但期望里没有 bubble.maxWidth —— 消费方（SP-04）读的就是这一格", JSON.stringify(fresh && fresh.bubble));
} catch (err) {
  bad("[EF-01] 生成器跑不通", String(err && err.stdout || err));
}

/* EF-02 新鲜度：盘上那份必须**逐字节**等于用当前两份 spec 重新生成的结果。
   逐字节而不是逐字段：字段级比较会放过「生成逻辑改了但没重跑」这一类漂移。 */
if (fresh) {
  const regenerated = fs.readFileSync(path.join(tmp, "ef01.json"));
  const committed = fs.readFileSync(COMMITTED);
  if (Buffer.compare(regenerated, committed) === 0) {
    ok("[EF-02] 盘上期望与「当前两份 real-spec 重新生成」逐字节相同（" + committed.length + "B，断言族 " + Object.keys(fresh).filter((k) => !k.startsWith("_")).length + " 族）");
  } else {
    bad("[EF-02] 期望 JSON 已陈旧：真源或生成器变了，门会拿旧期望判新产品", "重生成 " + regenerated.length + "B vs 盘上 " + committed.length + "B —— 跑 `node scripts/grok_acceptance_expectations.mjs --write` 后再提交");
  }
}

/* EF-03 溯回真源：消费方读到的带必须等于「直接从 grok-real-spec.json 取的那个数 ± 容差」。
   只比文件自己（EF-02）不够 —— 生成器如果哪天把数写错，两份会一起错得很一致。 */
if (fresh) {
  const srcRule = JSON.parse(fs.readFileSync(GROK_SRC, "utf8")).messageColumn.maxWidthRule;
  const srcPx = typeof srcRule === "number" ? srcRule : parseFloat(String(srcRule).match(/[\d.]+/)?.[0] || "");
  const band = JSON.parse(fs.readFileSync(COMMITTED, "utf8")).bubble.maxWidth;
  const tolOk = band && Number.isFinite(srcPx) && band.eq === Math.round(srcPx * 100) / 100 && band.min <= band.eq && band.eq <= band.max;
  if (tolOk) ok("[EF-03] 期望带溯回真源：grok-real-spec messageColumn.maxWidthRule=" + srcRule + " → bubble.maxWidth eq=" + band.eq + " 带 " + band.min + ".." + band.max);
  else bad("[EF-03] 期望带对不上真源读数", JSON.stringify({ srcRule, band }));
}

/* EF-04 反向对照（灵敏度）：在临时副本里把真源那一格改成 640px 重新生成，
   期望必须跟着变成 640 —— 否则说明源头到期望这条链根本没接上，EF-02 只是两份文件在互相印证。 */
{
  const mutRef = path.join(tmp, "mutref");
  fs.mkdirSync(mutRef, { recursive: true });
  for (const f of ["grok-real-spec.json", "bb-real-spec.json"]) fs.copyFileSync(path.join(REF, f), path.join(mutRef, f));
  const g = JSON.parse(fs.readFileSync(path.join(mutRef, "grok-real-spec.json"), "utf8"));
  g.messageColumn.maxWidthRule = "640px";
  fs.writeFileSync(path.join(mutRef, "grok-real-spec.json"), JSON.stringify(g));
  try {
    const mutated = runGen(mutRef, path.join(tmp, "ef04.json"));
    const eq = mutated && mutated.bubble && mutated.bubble.maxWidth && mutated.bubble.maxWidth.eq;
    const committedBand = JSON.parse(fs.readFileSync(COMMITTED, "utf8")).bubble.maxWidth;
    if (eq === 640 && (!committedBand || committedBand.eq !== 640)) {
      ok("[EF-04] 反向对照：把临时真源 maxWidthRule 改成 640px 重新生成，期望当场跟着变成 eq=" + eq + "（盘上仍是 " + committedBand.eq + "）—— 源头→期望这条链是通的");
    } else {
      bad("[EF-04] 反向对照没做成", "改真源后期望 eq=" + eq + "（期望 640）—— 生成器可能根本没读这一格，EF-02 就成了自证循环");
    }
  } catch (err) {
    bad("[EF-04] 突变真源后生成器直接跑不通", String(err && err.stdout || err).slice(0, 200));
  }
}

/* EF-05 门源码不许再长回手抄字面量：判据必须来自期望 JSON。
   这里钉的是**代码形状**而不是注释 —— §4.4 那个数出现在散文里是出处，出现在判据里才是漂移的起点。 */
{
  const src = fs.readFileSync(path.join(REPO, "scripts/e2e_grok_desktop_spec.mjs"), "utf8");
  const handCopied = [
    [/maxW\.includes\(\s*["'`]558\.4/, 'a.maxW.includes("558.4px")'],
    [/Math\.abs\(a\.longW\s*-\s*558\.4\)/, "Math.abs(a.longW - 558.4) <= 1"],
    /* §8.183 起，两个 728（composer 药丸宽 / SP-03 消息行宽）也进了同一判据：
       真源里它们是 composer.width 与 messageRow.rowWidth 两格独立读数，手抄时却被写成同一个数。 */
    [/bubble\.rowW === 728/, "bubble.rowW === 728"],
    [/composer\.rowW === 728/, "composer.rowW === 728"],
  ].filter(([re, sample]) => re.test(sample) && re.test(src)).map(([re]) => re.source);
  const consumes =
    /EXPECT_BUBBLE_MAXW/.test(src) && /cap\s*>=\s*band\.min/.test(src) && /cap\s*<=\s*band\.max/.test(src) &&
    /EXPECT_ROW_W/.test(src) && /EXPECT_COMPOSER_W/.test(src) &&
    /inBand\(bubble\.rowW/.test(src) && /inBand\(composer\.rowW/.test(src);
  if (handCopied.length) bad("[EF-05] SP-03/SP-04 与 composer 宽的判据里又出现手抄字面量（期望必须来自 grok-acceptance-expectations.json）", handCopied.join(" / "));
  else if (!consumes) bad("[EF-05] 判据没有全部按期望带判（缺 EXPECT_BUBBLE_MAXW / EXPECT_ROW_W / EXPECT_COMPOSER_W 或 min/max 比较）");
  else ok("[EF-05] SP-03/SP-04 与 composer 宽都只读期望带（EXPECT_BUBBLE_MAXW + EXPECT_ROW_W + EXPECT_COMPOSER_W，inBand 落 min..max），手抄字面量 0 处（判据正则先自证咬得住 §8.178 与 §8.183 改前那四行原话）");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("\nprove_expectations_fresh: PASS=" + pass + " FAIL=" + fail + " SKIP=0");
process.exit(fail === 0 ? 0 : 1);
