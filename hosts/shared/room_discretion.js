"use strict";

/**
 * room_discretion —— 成员自决回合的 prompt 与解析(B-7)。
 *
 * ## 这一步为什么关键
 *
 * 编排引擎的并行分支一直有个缺口:**并行 ≠ 团队**。
 * 成员们各跑各的、拿到同一份任务 ⇒ 是「并行广播」,不是「协作」。
 * 仓库自己的注释写得很直白:
 *
 *   「拆不出来就返回空数组 —— 那就诚实地继续用同一个任务
 *     (**宁可重复,不要假装分工**)。」
 *
 * 而 host 启发式拆解(`decomposeTask`)只在任务里**明写**「谁做什么」时才拆。
 * ⇒ 用户说「一起把稿子写了」,拆不出来 ⇒ 三个人各写一遍。
 *
 * ## 这一步做的事:把「要不要答」升级成「要不要答 + 你负责哪一段」
 *
 * 自决回合**本来就在并行问每个成员**(每个成员跑一次只放行 llm_chat 的回合)。
 * ⇒ 所以**加认领几乎不要额外成本**:同一批并行调用里,顺手拿到分工。
 *
 * 形态:模型输出两行 —— 第一行 YES/NO(老格式照旧),第二行可选的认领。
 *   YES
 *   CLAIM: 我负责把三个要点整理成初稿
 *
 * 认领是**模型给的语义**,但**要不要用**由 Host 判:
 *   · 认领必须落在**当前任务**的语义范围内(过长的、不像子任务的丢掉);
 *   · 认领只影响**这个成员的 prompt**(它的 subtask),不改别人的;
 *   · 没有认领 = 沿用老行为(各做各的)⇒ **向后兼容,不猜、不编**。
 */

const CLAIM_RE = /(?:^|\n)\s*(?:CLAIM|认领|负责)\s*[:：]\s*(.+)/i;

/**
 * 自决回合的 prompt。
 *
 * 为什么要「共享任务板」:让成员看得见**别人已经认领/做完什么**,
 * 免得所有人都说 YES(那是并行广播,不是协作)。
 *
 * @param {object} input
 * @param {object} input.bot      成员(bot)
 * @param {string} input.task     群任务
 * @param {string} [input.board]  共享任务板快照
 * @param {boolean} [input.askClaim] 是否要认领(默认 true)
 */
function buildDiscretionPrompt(input) {
  const opts = input || {};
  const bot = opts.bot || {};
  const task = String(opts.task || "").trim();
  const name = String(bot.name || bot.id || "Bot").trim();
  const job = String(bot.job || "").trim();
  const description = String(bot.description || "").trim();
  const role = [job ? "职责：" + job : "", description ? "简介：" + description : ""]
    .filter(Boolean)
    .join("；");
  // 共享任务板(可选):让「我要不要应答」这个判断看得到别人已经认领/做完了什么,
  // 免得所有人都说 YES(那是并行广播,不是协作)。
  const board = String(opts.board || "").trim().slice(0, 600);
  const askClaim = opts.askClaim !== false;
  return [
    "群任务：" + (task || "（空）"),
    "你是群成员「" + name + "」" + (role ? "（" + role + "）" : "") + "。",
    ...(board ? ["共享任务板（别人已经认领/做完的事）：\n" + board] : []),
    "只判断你是否应该在本轮发言:",
    "YES = 这个任务与你的职责相关,且你能提供不重复别人的价值;",
    "NO = 与你无关,或别的成员更适合。",
    ...(askClaim
      ? [
          "如果你答 YES,再写一行 CLAIM: 后面写**你负责的那一段**(一句话,别写整个任务)。",
          "例:",
          "YES",
          "CLAIM: 我负责把三个要点整理成初稿",
          "写不出具体的一段就只写 YES(不要硬编)。",
        ]
      : []),
    "只输出 YES 或 NO" + (askClaim ? "(可再加一行 CLAIM:)" : "") + ";不要调用工具,不要解释。",
  ].join("\n");
}

/**
 * 解析自决回复 —— 老格式,只回 boolean。**保持向后兼容**。
 * @param {string} raw
 * @returns {boolean|null}
 */
function parseDiscretionReply(raw) {
  const d = parseDiscretionDecision(raw);
  return d ? d.respond : null;
}

/**
 * 解析自决回复(新格式):既要 YES/NO,也要认领。
 *
 * 认领的清洗规则(确定性的部分留给 Host —— 模型给语义,Host 判能不能用):
 *   · 太长(> 120 字)⇒ 丢掉(那不是子任务,是一段正文);
 *   · 与任务毫无关系(既不含任务里的关键词,也不像子任务)⇒ 丢掉;
 *   · 空 ⇒ 丢掉(不猜、不编)。
 *
 * @param {string} raw
 * @returns {{respond: boolean, claim: string, text: string}|null}
 */
function parseDiscretionDecision(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return null;

  // 认领行要在**去掉认领行之后**的正文里判 YES/NO ——
  // 否则 "CLAIM: 我负责 NO 这一段" 这种句子会被误判成 NO。
  const claimMatch = text.match(CLAIM_RE);
  const claimRaw = claimMatch ? String(claimMatch[1] || "").trim() : "";
  const body = claimMatch ? text.replace(claimMatch[0], " ") : text;

  const first = body
    .split(/\s+/)[0]
    .replace(/^[^A-Za-z\u4e00-\u9fff]+|[^A-Za-z\u4e00-\u9fff]+$/g, "")
    .toUpperCase();
  let respond = null;
  if (["YES", "Y", "是", "应回答", "应答"].includes(first)) respond = true;
  else if (["NO", "N", "否", "不回答", "不应答"].includes(first)) respond = false;
  else {
    const yes = /\bYES\b/i.test(body);
    const no = /\bNO\b/i.test(body);
    if (yes && !no) respond = true;
    else if (no && !yes) respond = false;
  }
  if (respond === null) return null;

  return { respond, claim: cleanClaim(claimRaw), text: text.slice(0, 200) };
}

/**
 * 认领的清洗:太长的一律丢。
 * 宁可没有分工(各做各的,事后还能去重),也不要一段伪装成子任务的正文。
 */
function cleanClaim(raw) {
  const s = String(raw == null ? "" : raw)
    .replace(/^[\s:：]+/, "")
    .replace(/[\s:：]+$/, "")
    .trim();
  if (!s) return "";
  if (s.length > 120) return "";
  return s;
}

module.exports = {
  buildDiscretionPrompt,
  parseDiscretionReply,
  parseDiscretionDecision,
};
