"use strict";

const DEFAULT_MAX_FIELD = 80;
const DEFAULT_MAX_TOTAL = 4000;
const DEFAULT_MAX_RECENT = 6;
const DEFAULT_MAX_LINE = 320;

function clipField(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[ \u0000-\u001f]+/g, " ")
    .trim()
    .slice(0, max);
}

function entryText(entry) {
  if (!entry || typeof entry !== "object") return "";
  if (entry.kind === "final_report") {
    const title = entry.task_title || entry.task || "";
    const sections = Array.isArray(entry.sections) ? entry.sections : [];
    const body = sections
      .slice(0, 4)
      .map((section) => {
        const name = section.name || section.bot_id || "?";
        return name + ": " + (section.ok ? String(section.summary || "") : "(failed)");
      })
      .join("; ");
    return body ? String(title) + " — " + body : String(title);
  }
  if (entry.kind === "bot_reply_error") return "（本轮未成功）";
  return entry.text || "";
}

function recentFromTranscript(transcript, opts) {
  opts = opts || {};
  const entries = Array.isArray(transcript) ? transcript : [];
  const maxRecent = Number.isFinite(Number(opts.maxRecent))
    ? Math.max(0, Math.min(12, Number(opts.maxRecent)))
    : DEFAULT_MAX_RECENT;
  const maxLine = Math.max(40, Number(opts.maxLine) || DEFAULT_MAX_LINE);
  const sanitize = typeof opts.sanitize === "function" ? opts.sanitize : (v) => v;
  const currentTask = String(opts.currentTask || "").trim();
  const out = [];
  for (let i = entries.length - 1; i >= 0 && out.length < maxRecent; i--) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object") continue;
    if (entry.kind === "system") continue;
    if (
      entry.kind !== "user" &&
      entry.kind !== "bot_reply" &&
      entry.kind !== "bot_reply_error" &&
      entry.kind !== "final_report"
    ) {
      continue;
    }
    if (entry.kind === "user" && currentTask && String(entry.text || "").trim() === currentTask) {
      continue;
    }
    const raw = entryText(entry);
    if (!raw) continue;
    const text = clipField(sanitize(raw), maxLine);
    if (!text) continue;
    const speaker = entry.kind === "user"
      ? "user"
      : entry.kind === "final_report"
        ? "汇总"
        : String(entry.name || entry.speaker || entry.bot_id || "bot");
    out.push({
      kind: entry.kind,
      speaker: clipField(speaker, DEFAULT_MAX_FIELD),
      text,
    });
  }
  return out.reverse();
}

function buildRoomContext(input) {
  const opts = input || {};
  const room = opts.room;
  if (!room || !room.id) return null;
  const maxField = Math.max(20, Number(opts.maxField) || DEFAULT_MAX_FIELD);
  const maxTotal = Math.max(200, Number(opts.maxTotal) || DEFAULT_MAX_TOTAL);
  const maxRecent = Number.isFinite(Number(opts.maxRecent))
    ? Math.max(0, Math.min(12, Number(opts.maxRecent)))
    : DEFAULT_MAX_RECENT;
  const maxLine = Math.max(40, Number(opts.maxLine) || DEFAULT_MAX_LINE);
  const bots = Array.isArray(opts.bots) ? opts.bots : [];
  const clip = (value) => clipField(value, maxField);
  const botId = String(opts.botId || "").trim();
  const members = (room.members || []).map((id) => {
    const bot = bots.find((candidate) => candidate && candidate.id === id) || {};
    return {
      name: clip(bot.name || id),
      job: clip(bot.job || ""),
      description: clip(bot.description || ""),
    };
  });
  const mentioned = (Array.isArray(opts.mentionedNames) ? opts.mentionedNames : [])
    .map(clip)
    .filter(Boolean);
  const selfBot = bots.find((candidate) => candidate && candidate.id === botId) || {};
  const self = clip(selfBot.name || opts.selfName || "");
  const out = {
    room_id: String(room.id),
    title: clip(room.title || ""),
    members: [],
    mentioned: [],
    self,
    /* 岗位 prompt（批次 5）：**这一位成员自己的**完整职责。
     * 为什么走 roomContext 而不是编排 prompt：编排 prompt 会**整段**进内核，
     * 而内核用它做意图识别（中文建房句式是全文子串匹配）⇒ 岗位 prompt 里
     * 「不得扩展选题**或加入**新观点」这种句子会被判成「把 X 拉进 Y 群」⇒
     * 这一棒直接去建房了（实测：事实编辑那一棒 names_not_found）。
     * roomContext 只进**模型请求**、不参与内核意图解析 ⇒ 正好是它该去的地方。 */
    self_prompt: "",
    /* Host 取回的材料（批次 10 续）。
     *
     * 为什么也走 roomContext 而不是编排 prompt：
     *   编排 prompt 会**整段**进内核，而内核用它做意图识别
     *   （中文建房句式是**全文子串匹配**）⇒ 材料是 RSS 标题/正文这种
     *   **外部中文文本**，里面随便哪句都可能被误判成「把 X 拉进 Y 群」
     *   ⇒ 实测：材料里一句「跟 Googler 与零售、制造、游戏…同台」就把这一棒
     *   带去建房了（names_not_found），第一棒交上来的竟是内核调试串。
     *   ⇒ 与岗位 prompt（批次 5）同一个道理：走 system 通道，
     *   只进**模型请求**、不参与内核意图解析。 */
    materials: "",
    recent: [],
    chars: 0,
  };
  let used = out.title.length + out.self.length;
  /* 岗位 prompt 先占额度：它是「这一棒要交什么、哪些事不能做」的硬要求，
     比成员列表和最近转录更该保住。 */
  const selfPromptRaw = String(selfBot.prompt || "").trim();
  if (selfPromptRaw) {
    const left = maxTotal - used;
    if (left >= 120) {
      const text = clipField(selfPromptRaw, Math.min(2400, left));
      if (text) {
        out.self_prompt = text;
        used += text.length + 16;
      }
    }
  }
  /* 材料（批次 10 续）：紧跟岗位 prompt —— 它也是「这一棒要交什么」的硬材料，
     比成员列表和最近转录更该保住。 */
  const materialsRaw = String(opts.materials || "").trim();
  if (materialsRaw) {
    const left = maxTotal - used;
    if (left >= 200) {
      const text = clipField(materialsRaw, Math.min(4000, left));
      if (text) {
        out.materials = text;
        used += text.length + 16;
      }
    }
  }
  for (const name of mentioned) {
    const cost = name.length + 2;
    if (used + cost > maxTotal) break;
    out.mentioned.push(name);
    used += cost;
  }
  for (const member of members) {
    const cost = member.name.length + member.job.length + member.description.length + 4;
    if (used + cost > maxTotal) break;
    out.members.push(member);
    used += cost;
  }
  // 共享任务板（群编排的共享工作区）：可选注入一条有界的上下文行 ——
  // 这是「板子写完能读回 prompt」的第二条路径（第一条是成员 prompt 里的板子块）。
  const boardRaw = String(opts.sharedBoard || "").trim();
  if (boardRaw) {
    const boardText = clipField(boardRaw, maxLine);
    if (boardText) {
      out.recent.push({ kind: "board", speaker: "共享任务板", text: boardText });
      used += boardText.length + 12;
    }
  }
  const recent = recentFromTranscript(room.transcript, {
    maxRecent,
    maxLine,
    sanitize: opts.sanitize,
    currentTask: opts.currentTask,
  });
  for (const entry of recent) {
    const fixed = entry.kind.length + entry.speaker.length + 8;
    const left = maxTotal - used - fixed;
    if (left < 40) break;
    const text = clipField(entry.text, Math.min(maxLine, left));
    if (!text) continue;
    out.recent.push({ kind: entry.kind, speaker: entry.speaker, text });
    used += fixed + text.length;
  }
  out.chars = used;
  return out;
}

module.exports = {
  buildRoomContext,
  recentFromTranscript,
  clipField,
  DEFAULT_MAX_FIELD,
  DEFAULT_MAX_TOTAL,
  DEFAULT_MAX_RECENT,
  DEFAULT_MAX_LINE,
};
