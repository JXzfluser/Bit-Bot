"use strict";

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
  // 共享任务板（可选）：让「我要不要应答」这个判断看得到别人已经认领/做完了什么，
  // 免得所有人都说 YES（那是并行广播，不是协作）。
  const board = String(opts.board || "").trim().slice(0, 600);
  return [
    "群任务：" + (task || "（空）"),
    "你是群成员「" + name + "」" + (role ? "（" + role + "）" : "") + "。",
    ...(board ? ["共享任务板（别人已经认领/做完的事）：\n" + board] : []),
    "只判断你是否应该在本轮发言：",
    "YES = 这个任务与你的职责相关，且你能提供不重复别人的价值；",
    "NO = 与你无关，或别的成员更适合。",
    "只输出 YES 或 NO；不要调用工具，不要解释。",
  ].join("\n");
}

function parseDiscretionReply(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return null;
  const first = text
    .split(/\s+/)[0]
    .replace(/^[^A-Za-z\u4e00-\u9fff]+|[^A-Za-z\u4e00-\u9fff]+$/g, "")
    .toUpperCase();
  if (["YES", "Y", "是", "应回答", "应答"].includes(first)) return true;
  if (["NO", "N", "否", "不回答", "不应答"].includes(first)) return false;
  const yes = /\bYES\b/i.test(text);
  const no = /\bNO\b/i.test(text);
  if (yes && !no) return true;
  if (no && !yes) return false;
  return null;
}

module.exports = {
  buildDiscretionPrompt,
  parseDiscretionReply,
};
