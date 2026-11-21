#!/usr/bin/env node
/* prove_fold_state_owner.mjs — #84：「续折锚什么时候可信」只许有一个口径（FP-01..FP-07）
 *
 * 缘起：产品读路径（hosts/shared/event_read_model.js 的 cacheByFile）与对账尺
 * （hosts/shared/surface_parity.js 的 foldCacheByFile + auditSurface）各自内联过同一条规则的
 * **近似副本** —— 本轮动手前实测是 8 处内联（2 处 canContinue 的两种写法 + 6 处异常准入的四种写法），
 * 分布在产品的内存槽、尺的内存槽、尺的 audit 处、盘上检查点四处存储里。
 * 近似的意思是：一边改了失效条件，另一边不会跟着红 —— #83 那个洞（截断面按真 lastSeq
 * 进缓存 = 一次截断永久失真）就是这一类。判据现在抽进 hosts/shared/fold_state.js，
 * 这条门守的是「抽完之后不许再长回去」。
 *
 * 判据分三层，缺一条都算这条门没做事：
 *   静态层（FP-01/02）—— 两个消费方必须引用 fold_state，且自己文件里不许再出现内联判据；
 *   语义层（FP-03..06）—— 抽出来的四条规则本身对不对（真值表 + 前缀游标 + 原地作废）；
 *   灵敏度（FP-07）—— 反向对照：把「同 seq 不算可续」这一字之差摆出来，证明 FP-03 真在管。
 *
 * 端到端行为不在这里证：RM 组（prove_event_read_model，含 RM-13 检查点）与 L 组
 * （prove_surface_parity，含 L9「截断读数不许焐热缓存」）继续各自管自己那半。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const REPO = path.resolve(import.meta.dirname, "..");
const require_ = createRequire(import.meta.url);
const foldState = require_(path.join(REPO, "hosts/shared/fold_state.js"));

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  ✓ " + m); };
const bad = (m, d) => { fail++; console.log("  ✗ " + m + (d ? " — " + String(d).slice(0, 300) : "")); };
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const CONSUMERS = ["hosts/shared/event_read_model.js", "hosts/shared/surface_parity.js"];

/* FP-01 两个消费方都真的引用了单一出处（不是复制了一份注释）。 */
{
  const missing = CONSUMERS.filter((f) => !/require\(["']\.\/fold_state["']\)/.test(read(f)));
  if (missing.length) bad("[FP-01] 两个消费方必须 require(./fold_state)", missing.join(", ") + " 没有 —— 判据还长在它们自己里");
  else ok("[FP-01] 两个消费方都 require(./fold_state)：" + CONSUMERS.map((f) => path.basename(f)).join(" + "));
}

/* FP-02 内联判据不许再长回来：五条正则，覆盖动手前那 6 种写法（8 处内联）。
   第 4 式（`!x.anomalies ||`）是尺的 auditSurface 里的写法，第 5 式是盘上检查点的准入判据
   （`Array.isArray(f.anomalies) && f.anomalies.length`）—— 一并钉住。 */
{
  const PATTERNS = [
    ["续折条件", /lastSeq\s*>=\s*slot\.lastSeq/, "if (slot.folded && lastSeq >= slot.lastSeq) {"],
    ["异常判空（产品写法）", /anomalies\s*\|\|\s*\[\]\)\s*\.length/, "if (!(result.folded.anomalies || []).length) { cache.set(k, s); }"],
    ["异常判空（尺写法一）", /anomalies\.length\s*===\s*0/, "if (inc.folded && inc.folded.anomalies.length === 0) {"],
    ["异常判空（尺写法二）", /!\s*[\w.]+\.anomalies\s*\|\|/, "folded = res.folded && !res.folded.anomalies || null;"],
    ["异常判空（检查点写法）", /Array\.isArray\([\w.]+\.anomalies\)\s*&&/, "if (Array.isArray(f.anomalies) && f.anomalies.length) return null;"],
  ];
  /* 每条判据先自证「能咬住历史写法的那一行原话」，否则正则写错 = 整条 FP-02 恒真。
     这五句是本轮动手前从三个文件里逐字抄下来的（§8.177）。 */
  const blind = PATTERNS.filter(([, re, sample]) => !re.test(sample)).map(([name]) => name);
  if (blind.length) bad("[FP-02] 判据正则对自己抄下的历史写法不敏感（先怀疑探针）", blind.join(", "));
  const hits = [];
  for (const f of CONSUMERS) {
    const src = read(f);
    for (const [name, re] of PATTERNS) if (re.test(src)) hits.push(path.basename(f) + " 里还有内联「" + name + "」");
  }
  if (!blind.length && hits.length) bad("[FP-02] 消费方里不许再出现内联失效判据", hits.join(" / "));
  else if (!blind.length) ok("[FP-02] 五条判据各自咬得住抄下来的历史写法，且消费方内联判据 0 处（续折条件 + 四种异常判空写法全在 fold_state 一处）");
}

/* FP-03 canContinue 的真值表 —— 五个格子，少一格都可能放过一条错规则。 */
{
  const slot = { lastSeq: 10, folded: { anomalies: [] } };
  const table = [
    ["同 seq", true, foldState.canContinue(slot, 10)],
    ["seq 前进", true, foldState.canContinue(slot, 11)],
    ["seq 倒退（库被换掉）", false, foldState.canContinue(slot, 9)],
    ["槽里没有状态", false, foldState.canContinue({ lastSeq: 10, folded: null }, 12)],
    ["lastSeq 非有限数", false, foldState.canContinue(slot, Number.NaN)],
  ];
  const wrong = table.filter(([ , want, got]) => want !== got).map((x) => x[0]);
  if (wrong.length) bad("[FP-03] canContinue 真值表不对", wrong.join(", "));
  else ok("[FP-03] canContinue 真值表 5/5（同 seq、前进、倒退、空槽、非有限数）");
}

/* FP-04 isClean：带任何 anomaly 一律不许拿它下结论；null 不是干净。
   口径统一说明（本轮实测出来的分歧）：尺的缓存处原先要求 anomalies 字段**存在**才肯缓存，
   产品与尺的 audit 处把「缺字段」当干净。统一到宽的那一侧（3/4 处如此，foldPages 的
   返回体始终带这个字段），并把这条写进 fold_state 的头注释 —— 不是悄悄选边。 */
{
  const table = [
    ["null 状态", false, foldState.isClean(null)],
    ["缺 anomalies 字段", true, foldState.isClean({})],
    ["anomalies 为空", true, foldState.isClean({ anomalies: [] })],
    ["带 anomaly", false, foldState.isClean({ anomalies: ["gap"] })],
  ];
  const wrong = table.filter(([ , want, got]) => want !== got).map((x) => x[0]);
  if (wrong.length) bad("[FP-04] isClean 判据不对", wrong.join(", "));
  else ok("[FP-04] isClean 4/4（null / 缺字段 / 空 anomalies / 带 anomalies）");
}

/* FP-05 截断前缀只认**它自己的游标**（#83 的洞就在把游标当成库的 lastSeq）。 */
{
  const clean = foldState.prefixOf({ folded: { anomalies: [] }, cursor: 40 });
  const dirty = foldState.prefixOf({ folded: { anomalies: ["gap"] }, cursor: 40 });
  const none = foldState.prefixOf(null);
  if (!clean || clean.seq !== 40 || !clean.folded || dirty !== null || none !== null) {
    bad("[FP-05] prefixOf 的前缀游标语义不对", JSON.stringify({ clean: clean && clean.seq, dirty, none }));
  } else {
    ok("[FP-05] prefixOf：干净前缀按游标 40 交出（不是库 lastSeq）、脏前缀与无结果一律 null");
  }
}

/* FP-06 invalidate 原地重置：持有方拿着同一个槽引用，不需要重新接线。 */
{
  const slot = { lastSeq: 7, folded: { anomalies: [] }, count: 3 };
  const ret = foldState.invalidate(slot);
  if (ret !== slot || slot.folded !== null || slot.lastSeq !== -1 || slot.count !== 3) {
    bad("[FP-06] invalidate 没有原地重置（或顺手清了不该清的字段）", JSON.stringify(slot));
  } else ok("[FP-06] invalidate：原地清 folded/lastSeq（同一引用返回），count 等旁字段不动");
}

/* FP-07 反向对照：把「同 seq 不算可续」这一字之差摆出来，FP-03 必须能分辨。
   突变体不落盘（内存里的另一条规则），只证明判据表对它不盲。 */
{
  const slot = { lastSeq: 10, folded: { anomalies: [] } };
  const mutant = (s, ls) => Boolean(s && s.folded) && Number.isFinite(ls) && ls > s.lastSeq;
  const real = foldState.canContinue(slot, 10);
  const mut = mutant(slot, 10);
  if (real === mut) {
    bad("[FP-07] 反向对照没做成", "同 seq 格子里真规则与突变体读数相同（" + real + "）—— FP-03 对这条不灵敏");
  } else {
    ok("[FP-07] 反向对照：把 `>=` 写成 `>` 后「同 seq」这格从 " + real + " 翻成 " + mut
      + "，FP-03 当场分辨得出（判据表有牙）");
  }
}

console.log("\nprove_fold_state_owner: PASS=" + pass + " FAIL=" + fail + " SKIP=0");
process.exit(fail === 0 ? 0 : 1);
