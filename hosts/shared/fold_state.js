"use strict";
/* fold_state.js — 「续折锚什么时候可信」的唯一口径（#84 / §8.177）
 *
 * 为什么要有这个文件：产品读路径（hosts/shared/event_read_model.js 的 cacheByFile）和
 * 对账尺（hosts/shared/surface_parity.js 的 foldCacheByFile）各自写过一份**近似**的同一条
 * 规则 —— 「lastSeq 往前走才续折」「折出异常不许当结论」「截断那趟只认它自己的游标」。
 * 近似就是风险：一边改了失效条件、另一边不会跟着红，于是同一份日志在产品和尺子上
 * 可信程度不一样（#83 那个洞就是这一类：截断面按真 lastSeq 进缓存，一次截断永久失真）。
 *
 * 本文件**只管判据**，不管缓存本体：两侧内存槽的形状、深拷贝、检查点的落盘与读盘
 * 字段校验、护栏（尺用行数、
 * 产品用 250ms 墙钟）留在各自文件里。三份存储的**准入判据**都在这里：
 * 产品内存槽、尺内存槽、盘上检查点（loadCheckpoint 用 isClean 判定，不再是自己那份
 * `Array.isArray(f.anomalies) && f.anomalies.length`）。
 * 交出一条规则换来的是：改判据只有一个地方能改，
 * 且 G-126 的 FP-01/02 会在有人另起一份内联判据时直接红。
 *
 * 口径变化（有意为之，写清楚）：
 *   - canContinue 要求 lastSeq 是**有限数**。产品原先没判（lastSeq 来自 SQLite 恒为数），
 *     尺原先判了。统一到严格那一侧。
 *   - lastSeq === slot.lastSeq 时 canContinue 为真（「状态没动」由各调用方自己短路成
 *     reused，不在这里判 —— 尺和产品的复用代价不同）。
 *   - isClean 把**缺 anomalies 字段**当干净。原先尺的缓存处要求字段存在才肯缓存，产品的
 *     缓存处与尺的 audit 处（共 3/4 处）都把缺字段当干净；统一到宽的那一侧，理由是
 *     foldEvents/foldPages 的返回体始终带这个字段，缺它只可能是自造夹具。
 *     G-126 的 FP-04 把这个口径钉成真值表，别再靠读代码猜。
 */

/** 槽里有没有一份「可以继续往上折」的状态。 */
function canContinue(slot, lastSeq) {
  return Boolean(slot && slot.folded) && Number.isFinite(lastSeq) && lastSeq >= Number(slot.lastSeq);
}

/** 折出来的状态干不干净。带任何 anomaly 就不干净 —— 不许拿它下结论。 */
function isClean(folded) {
  return Boolean(folded) && !(folded.anomalies || []).length;
}

/** 截断那趟折出来的**前缀**能不能留：只看前缀自己的游标，不看库的 lastSeq（#83）。 */
function prefixOf(result) {
  if (!result || !isClean(result.folded)) return null;
  return { folded: result.folded, seq: Number(result.cursor) };
}

/** 作废一个槽（原地改，让持有方不必重新接线）。 */
function invalidate(slot) {
  if (slot) {
    slot.folded = null;
    slot.lastSeq = -1;
  }
  return slot;
}

module.exports = { canContinue, isClean, prefixOf, invalidate };
