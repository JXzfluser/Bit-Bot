"use strict";

/**
 * Room orchestrator — 群 Bot「真团队编排」的确定性层（Host 侧）。
 *
 * 这里只放**宿主必须确定性执行**的东西：
 *   - 共享任务板（写 = 子任务/进度；读 = 进 prompt 的回读路径）；
 *   - 团队预算（轮次 / 时间 / token 估算）与**真取消**通道；
 *   - 任务拆解与分工（模型只能*建议*拆解，分工与预算永远由宿主算）；
 *   - 重复劳动率（可测：几个成员产出了几乎一样的回答）。
 *
 * 原则（docs/agent-core/README.md §7）：模型不得决定安全与预算。因此
 * `normalizeSubtaskProposal` 只做「形状校验」，`assignSubtasks` 只做确定性
 * 轮转分配，`createTeamBudget` 是唯一的预算裁决者。
 *
 * 无 Electron 依赖，CommonJS，可被 scripts/prove_room_orchestrator.js 直接
 * require，也可在 Electron 打包后与 product_surface.js 同目录加载。
 */

const fs = require("fs");
const path = require("path");

// 共享任务板与内核 section store 同一目录/同一文件格式（host_ffi.js 的
// section_add/section_post 写的就是这个 schema），key 统一成 **room id**。
const BOARD_DIR_REL = path.join("data", "agents", "sections");

const BOARD_MAX_CHARS = 1200;      // 板子进 prompt 的字符上限
const BOARD_MAX_SECTIONS = 8;      // 板子上可见的子任务条数
const BOARD_MAX_MESSAGES = 6;      // 板子上可见的进度条数
const BOARD_BODY_MAX = 200;        // 单条进度正文上限
const SUBTASK_MAX_CHARS = 160;
const SUBTASK_MAX_COUNT = 6;
const DUPLICATE_THRESHOLD = 0.82;  // bigram Dice 相似度阈值
const SYNTHESIS_MEMBER_CHARS = 600;

function clip(text, max) {
  const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  const limit = Number(max) > 0 ? Number(max) : 120;
  return s.length <= limit ? s : s.slice(0, limit) + "…";
}

/** 目录名/文件名净化：与 host_ffi.js 的 sanitizeSkillName 同口径。 */
function sanitizeBoardKey(id) {
  return (
    String(id == null ? "" : id)
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "room"
  );
}

/**
 * 共享任务板（共享工作区）。
 * 文件：data/agents/sections/<room_id>.json
 * 形状：{ group_id, sections:[{id,title,group_id,owner,owner_name,status,...}],
 *         messages:[{section_id,from_agent,body,at}] }
 * 与 host_ffi.js 的 section_add / section_post 完全兼容 —— 内核写的分区与
 * 帖子，成员下一轮就能在 prompt 里回读到。
 */
function createRoomBoard(repoRoot, opts = {}) {
  /* The board is shared workspace state -> user data, not code. */
  const dataRoot = (opts && opts.dataRoot) ? path.resolve(opts.dataRoot) : path.join(path.resolve(repoRoot), "data");
  const dir = path.join(dataRoot, "agents", "sections");
  const pathOf = (roomId) => path.join(dir, `${sanitizeBoardKey(roomId)}.json`);
  const nowIso = () => new Date().toISOString();

  const read = (roomId) => {
    const key = String(roomId == null ? "" : roomId);
    let data = { group_id: key, sections: [], messages: [] };
    try {
      const file = pathOf(key);
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed && typeof parsed === "object") data = parsed;
      }
    } catch (_) {
      /* 板子读坏了就当空板：不能因为板子坏了就让整个群回合崩掉 */
    }
    if (!Array.isArray(data.sections)) data.sections = [];
    if (!Array.isArray(data.messages)) data.messages = [];
    data.group_id = key;
    return data;
  };

  const write = (roomId, data) => {
    fs.mkdirSync(dir, { recursive: true });
    const file = pathOf(roomId);
    const tmp = `${file}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
    return file;
  };

  /** 认领/登记一个子任务（幂等：同 id 只更新，不产生第二条）。 */
  const addTask = (roomId, task) => {
    const id = String((task && task.id) || "").trim();
    if (!id) return null;
    const key = String(roomId == null ? "" : roomId);
    const data = read(key);
    const at = nowIso();
    const existing = data.sections.find((s) => s && s.id === id);
    if (existing) {
      if (task && task.title) existing.title = String(task.title);
      if (task && task.owner) existing.owner = String(task.owner);
      if (task && task.owner_name) existing.owner_name = String(task.owner_name);
      if (task && task.status) existing.status = String(task.status);
      existing.updated_at = at;
      data.updated_at = at;
      write(key, data);
      return existing;
    }
    const sec = {
      id,
      title: String((task && task.title) || id),
      group_id: key,
      owner: task && task.owner ? String(task.owner) : "",
      owner_name: task && task.owner_name ? String(task.owner_name) : "",
      status: String((task && task.status) || "assigned"),
      created_at: at,
      updated_at: at,
    };
    data.sections.push(sec);
    data.updated_at = at;
    write(key, data);
    return sec;
  };

  const updateTask = (roomId, id, patch) => {
    const key = String(roomId == null ? "" : roomId);
    const data = read(key);
    const sec = data.sections.find((s) => s && s.id === String(id || ""));
    if (!sec) return null;
    const p = patch || {};
    if (p.title != null) sec.title = String(p.title);
    if (p.owner != null) sec.owner = String(p.owner);
    if (p.owner_name != null) sec.owner_name = String(p.owner_name);
    if (p.status != null) sec.status = String(p.status);
    sec.updated_at = nowIso();
    data.updated_at = sec.updated_at;
    write(key, data);
    return sec;
  };

  /** 往板子上贴一条进度（成员完成/失败时由宿主写，不花模型钱）。 */
  const post = (roomId, sectionId, fromAgent, body, title) => {
    const key = String(roomId == null ? "" : roomId);
    const data = read(key);
    const secId = String(sectionId || "general") || "general";
    if (!data.sections.some((s) => s && s.id === secId)) {
      data.sections.push({
        id: secId,
        title: String(title || (secId === "general" ? "共享任务" : secId)),
        group_id: key,
        status: "open",
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
    const msg = {
      section_id: secId,
      from_agent: String(fromAgent || "host"),
      body: clip(body, BOARD_BODY_MAX),
      at: nowIso(),
    };
    data.messages.push(msg);
    data.updated_at = msg.at;
    write(key, data);
    return msg;
  };

  /** 回读：板子当前长什么样（这就是「只有写没有读」的读路径）。 */
  const snapshot = (roomId, opts) => {
    const options = opts || {};
    const key = String(roomId == null ? "" : roomId);
    const data = read(key);
    const maxSections = Math.max(1, Number(options.maxSections || BOARD_MAX_SECTIONS));
    const maxMessages = Math.max(0, Number(options.maxMessages ?? BOARD_MAX_MESSAGES));
    const maxChars = Math.max(200, Number(options.maxChars || BOARD_MAX_CHARS));
    const sections = data.sections.slice(0, maxSections).map((s) => ({
      id: String((s && s.id) || ""),
      title: clip((s && s.title) || "", 80),
      owner: String((s && s.owner) || ""),
      owner_name: String((s && s.owner_name) || ""),
      status: String((s && s.status) || ""),
    }));
    const messages = data.messages.slice(-maxMessages).map((m) => ({
      section_id: String((m && m.section_id) || ""),
      from_agent: String((m && m.from_agent) || ""),
      body: clip((m && m.body) || "", BOARD_BODY_MAX),
    }));
    const text = buildBoardText({ group_id: key, sections, messages }, { maxChars });
    return { group_id: key, sections, messages, text, task_count: data.sections.length };
  };

  const clear = (roomId) => {
    const key = String(roomId == null ? "" : roomId);
    write(key, { group_id: key, sections: [], messages: [] });
    return true;
  };

  return { dir, pathOf, read, write, addTask, updateTask, post, snapshot, clear };
}

/** 板子 → 有界的 prompt 文本块（成员/lead 看到的「别人做到哪了」）。 */
function buildBoardText(snapshot, opts) {
  const options = opts || {};
  const snap = snapshot || {};
  const maxChars = Math.max(200, Number(options.maxChars || BOARD_MAX_CHARS));
  const sections = Array.isArray(snap.sections) ? snap.sections : [];
  const messages = Array.isArray(snap.messages) ? snap.messages : [];
  if (!sections.length && !messages.length) return "";
  const lines = ["【共享任务板 group_id=" + String(snap.group_id || "") + "】"];
  for (const s of sections) {
    const owner = s.owner_name || s.owner || "未认领";
    lines.push(
      "- [" + s.id + "] " + s.title + " — 认领：" + owner + " — 状态：" + (s.status || "assigned"),
    );
  }
  if (messages.length) {
    lines.push("最近进度：");
    for (const m of messages) {
      lines.push("- " + (m.from_agent || "host") + "：" + m.body);
    }
  }
  let text = lines.join("\n");
  if (text.length > maxChars) text = text.slice(0, maxChars) + "…";
  return text;
}

/* ==========================================================================
 * 接力协议（auto_route）：一个群任务**只由一个 Bot 接下**，做完交给下一位，
 * 一路串行；最后一棒的成果由宿主合成产物落盘。
 *
 * 为什么要有这一段：此前的 bot_discretion 是「群里每个成员都被问一遍要不要答」，
 * 然后所有说「要」的成员**同时**各跑一轮 —— 用户的感受是「一堆活全部 bot 开始
 * 工作」，互相重复、互相覆盖，最后只剩一段综合说明。真团队不是这样：活派给一个人，
 * 做完交下一棒，谁不清楚就停下来问。
 *
 * 宿主职责（确定性，不花模型钱）：按对话内容算出唯一负责人、限制接力棒数、
 * 预算与取消；模型只负责「这一棒做什么」和「要不要交给谁 / 要不要先问清楚」。
 * ========================================================================== */

/** 回复里的三个协议标记。成员用它们表达「要交接 / 要先问 / 已交付」。 */
const RELAY_MARKERS = {
  confirm: "【需要确认】",
  handoff: "【交给】",
  deliver: "【交付】",
};
/** 一次群任务最多几棒。超过就停并如实说明（防止两个 Bot 互相踢皮球）。 */
const RELAY_MAX_HOPS = 4;
/** 内容路由：低于这个分数视为「看不出该谁做」，要停下来问用户。 */
const ROUTE_MIN_SCORE = 0.12;
/** 第一名与第二名的差距小于它，说明两个人一样像——同样停下来问。 */
const ROUTE_MIN_MARGIN = 0.06;

/** 匹配用的停用二元组：这些词在任何职责描述里都可能出现，命中它没有信息量。 */
const MATCH_STOP_GRAMS = new Set([
  "帮我", "我们", "你们", "他们", "这个", "那个", "一个", "一下", "怎么", "什么",
  "可以", "需要", "然后", "已经", "就是", "以及", "还有", "给我", "的把", "了吗",
  "你要", "你把", "的话", "现在", "今天", "明天", "出一", "个短", "条的",
]);

/**
 * 把一段话切成可比较的片段：拉丁词（≥3 字符）+ 中文二元组。
 * 中文用二元组而不是分词，是因为职责描述普遍很短（「负责选题与脚本」），
 * 二元组已经够判「谁更像」，又不需要词表。
 */
function matchFragments(text) {
  const s = String(text == null ? "" : text).toLowerCase();
  const latin = (s.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []).filter((w) => w.length >= 3);
  const runs = s.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || [];
  const grams = [];
  for (const run of runs) {
    if (run.length === 1) {
      grams.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) {
      const g = run.slice(i, i + 2);
      if (!MATCH_STOP_GRAMS.has(g)) grams.push(g);
    }
  }
  return { latin: Array.from(new Set(latin)), grams: Array.from(new Set(grams)) };
}

/**
 * 寒暄/回执类消息：没有任务内容，不值得开会讨论「谁来做」。
 * 命中的话仍然**只派给一个成员**（用一句话回应，不展开、不派活）。
 */
const SOCIAL_RE = /^(大家好|各位好|hi\b|hello\b|hey\b|在吗|在不在|早\b|早上好|晚上好|晚安|谢谢|多谢|辛苦了|收到|好的|ok\b|嗯+|哈+|test\b)/i;

/**
 * 按**对话内容**算出这一轮该谁做（唯一负责人）。
 *
 * 返回 mode：
 *   explicit       —— 调用了点名，用户已经决定了
 *   resume_confirm —— 上一轮某位成员停下来问用户，这句是答复，回到他手上
 *   single_member  —— 群里只有一个人（没有选择余地）
 *   content_match  —— 内容匹配出唯一最像的人
 *   social         —— 寒暄/回执，派一个人简短应一声，不派活
 *   unclear        —— 看不出该谁做 / 两个人一样像 → **不开工，先问用户**
 *
 * 这是宿主裁决，不是模型裁点：同样的输入永远得到同样的负责人。
 */
function routeTask(input) {
  const opts = input || {};
  const task = String(opts.task || "").trim();
  const members = (Array.isArray(opts.members) ? opts.members : [])
    .filter((m) => m && (m.id || m.name))
    .map((m) => ({
      id: String(m.id || m.name),
      name: String(m.name || m.id),
      job: String(m.job || ""),
      description: String(m.description || ""),
    }));
  const explicit = String(opts.explicitTo || "").trim();
  const resume = opts.resume && (opts.resume.bot_id || opts.resume.botId)
    ? String(opts.resume.bot_id || opts.resume.botId)
    : "";
  if (!members.length) {
    return { mode: "unclear", owner: null, ranking: [], reason: "no_members" };
  }
  if (explicit) {
    const hit = members.find((m) => m.id === explicit || m.name === explicit);
    if (hit) return { mode: "explicit", owner: hit, ranking: [], reason: "user_mentioned" };
  }
  if (resume) {
    const hit = members.find((m) => m.id === resume);
    if (hit) return { mode: "resume_confirm", owner: hit, ranking: [], reason: "answer_to_pending_question" };
  }
  if (members.length === 1) {
    return { mode: "single_member", owner: members[0], ranking: [], reason: "only_one_member" };
  }
  const taskFrags = matchFragments(task);
  const total = taskFrags.latin.length + taskFrags.grams.length || 1;
  /* IDF：一个片段如果**每个成员的职责里都有**（「负责」「内容」），它说明不了该找谁；
     只有一个人有的片段才是真信号。所以按「命中人数」的倒数加权 —— 这是判「谁更像」
     和判「都一样像」的关键，不然两个人都命中一个常用词就会永远打平。 */
  const profiles = members.map((m) => matchFragments([m.name, m.job, m.description].join(" ")));
  const hitCount = new Map();
  for (const p of profiles) {
    const set = new Set(p.latin.concat(p.grams));
    for (const f of set) hitCount.set(f, (hitCount.get(f) || 0) + 1);
  }
  const ranking = members.map((m, i) => {
    const profile = profiles[i];
    const profileSet = new Set(profile.latin.concat(profile.grams));
    const matched = [];
    let weight = 0;
    for (const f of taskFrags.latin.concat(taskFrags.grams)) {
      if (!profileSet.has(f)) continue;
      matched.push(f);
      weight += 1 / Math.max(1, hitCount.get(f) || 1);
    }
    let score = weight / total;
    // 名字出现在任务里是强信号（用户可能直接叫了它的名字而没打 @）。
    if (m.name && task.toLowerCase().includes(m.name.toLowerCase())) score += 0.6;
    return {
      id: m.id, name: m.name, job: m.job,
      score: Math.round(Math.min(1, score) * 1000) / 1000,
      matched: Array.from(new Set(matched)).slice(0, 8),
    };
  }).sort((a, b) => b.score - a.score);
  const top = ranking[0];
  const second = ranking[1] || { score: 0 };
  const margin = Math.round((top.score - second.score) * 1000) / 1000;
  if (top.score < ROUTE_MIN_SCORE) {
    // 没有任务内容（寒暄/回执）：不开会决定谁做，派一个人简短应一声。
    if (SOCIAL_RE.test(task) || task.replace(/\s+/g, "").length <= 4) {
      const owner = members.find((m) => m.id === top.id) || members[0];
      return { mode: "social", owner, ranking, margin, reason: "social_message" };
    }
    return { mode: "unclear", owner: null, ranking, margin, reason: "no_content_match" };
  }
  if (top.score < 1 && margin < ROUTE_MIN_MARGIN) {
    return { mode: "unclear", owner: null, ranking, margin, reason: "two_equally_likely" };
  }
  const owner = members.find((m) => m.id === top.id) || null;
  return { mode: "content_match", owner, ranking, margin, reason: "content_match" };
}

/**
 * 解析成员回复里的协议标记。
 * 三个标记都是**人话**，用户在气泡里直接读得懂，不是给机器看的协议串。
 */
function parseRelayReply(text) {
  const raw = String(text == null ? "" : text);
  const pick = (marker) => {
    const at = raw.indexOf(marker);
    if (at < 0) return null;
    const after = raw.slice(at + marker.length);
    const line = after.split(/\r?\n/)[0].replace(/^[：:\s、]+/, "").trim();
    if (line) return line;
    // 标记后面没跟内容（换了行）：取后面第一段非空文本。
    const para = after.split(/\r?\n+/).map((s) => s.trim()).find(Boolean);
    return para || "";
  };
  const confirm = pick(RELAY_MARKERS.confirm);
  const handoffRaw = pick(RELAY_MARKERS.handoff);
  return {
    // 空字符串 = 写了标记但没写内容，也算「要确认」——宁可多问一句，不要猜着往下做。
    confirm: confirm === null ? null : String(confirm),
    handoff: handoffRaw || null,
    delivered: raw.includes(RELAY_MARKERS.deliver),
  };
}

/**
 * 这一棒的 prompt。和旧的 buildResponderPrompt 的差别是三条纪律，而不是措辞：
 *   1) 这一轮只有你在做（不会有人同时和你抢同一件事）；
 *   2) 做完交付**成果正文**，不是「我做到了」；
 *   3) 缺信息就写【需要确认】并停下 —— 这一轮真的会停在这里等用户回答。
 */
function buildRelayPrompt(input) {
  const opts = input || {};
  const task = String(opts.task || "").trim();
  const roster = Array.isArray(opts.roster) ? opts.roster : [];
  const hop = Math.max(0, Number(opts.hop || 0)) | 0;
  const prev = opts.prev && opts.prev.text ? opts.prev : null;
  const boardText = String(opts.boardText || "").trim();
  const confirmAnswer = String(opts.confirmAnswer || "").trim();
  const maxHops = Math.max(1, Number(opts.maxHops || RELAY_MAX_HOPS));
  const lines = [];
  lines.push("【群任务】" + (task || "（空）"));
  lines.push(
    "这一轮只有你在做这件事（第 " + (hop + 1) + " 棒，最多 " + maxHops + " 棒）。群里其他成员不会同时开工，所以不用抢、也不用替他们做。",
  );
  if (roster.length) {
    lines.push("【群成员】");
    for (const m of roster) {
      const role = String(m.job || m.description || "").trim();
      lines.push("- " + String(m.name || m.id) + (role ? "：" + clip(role, 60) : ""));
    }
  }
  if (prev) {
    lines.push("【上一棒】" + String(prev.name || prev.bot_id || "") + " 交给你：" + clip(prev.text, 400));
  }
  if (confirmAnswer) {
    lines.push("【你的上一问的答复】" + confirmAnswer);
  }
  if (boardText) lines.push(boardText);
  lines.push("怎么做：");
  lines.push("1. 只做这一棒该做的部分；上一棒已经做完的不要重做，也不要把整件事再复述一遍。");
  if (hop === 0) {
    lines.push("2. 先判断：这件事是不是靠你一个人就能做完？能做完就一路做完，不要为了「显得在协作」硬交给别人。");
  } else {
    lines.push("2. 接着上一棒的成果往下做；能收尾就收尾。");
  }
  lines.push(
    "3. 交付时直接给**成果本身**（成稿的正文、脚本、清单、结论都行），不要只写「已完成」「如上」。",
  );
  lines.push(
    "4. 确实需要另一位成员的专业能力才能继续时，另起一行写：" +
      RELAY_MARKERS.handoff + "<成员名字>：<要他做什么>。能自己做完就不要写。",
  );
  lines.push(
    "5. 信息不足、或要在两种做法里二选一时，不要猜也不要编，另起一行写：" +
      RELAY_MARKERS.confirm + "<你要问用户的那一个问题>，然后停下。这一轮会停在这里，等用户回答后你再继续。",
  );
  return lines.join("\n");
}

/**
 * 把接力链合成一份**真产物**（markdown 正文）。
 * 最后一棒是权威交付内容，前面几棒作为过程记录保留 —— 谁做了什么都留痕。
 */
function composeDeliverable(input) {
  const opts = input || {};
  const task = String(opts.task || "").trim();
  const relay = Array.isArray(opts.relay) ? opts.relay : [];
  const title = clip(task || "群任务产物", 80);
  const done = relay.filter((r) => r && r.ok && String(r.text || "").trim());
  const lines = [];
  lines.push("# " + title);
  lines.push("");
  const meta = [];
  if (opts.roomTitle) meta.push("群：" + String(opts.roomTitle));
  if (opts.at) meta.push("时间：" + String(opts.at));
  if (relay.length) meta.push("接力：" + relay.map((r) => String(r.name || r.bot_id || "")).join(" → "));
  if (meta.length) {
    lines.push("> " + meta.join("｜"));
    lines.push("");
  }
  if (done.length) {
    const last = done[done.length - 1];
    lines.push("## 交付内容");
    lines.push("");
    lines.push(String(last.text || "").trim());
    lines.push("");
    if (done.length > 1) {
      lines.push("## 过程");
      lines.push("");
      for (let i = 0; i < done.length - 1; i++) {
        lines.push("### 第 " + (i + 1) + " 棒 · " + String(done[i].name || done[i].bot_id || ""));
        lines.push("");
        lines.push(String(done[i].text || "").trim());
        lines.push("");
      }
    }
  } else {
    lines.push("## 交付内容");
    lines.push("");
    lines.push("（这一轮没有成员交出可用内容，产物为空。原因见群里的失败记录。）");
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * 成员回合的 prompt：原始任务 + 你的分工 + 共享任务板。
 * 关键：**分工不同**（不再是同一份 task 广播 N 份），且每个人都能看到别人
 * 认领了什么、做到哪了。
 *
 * 注意：这是 `@A @B` / 全员 这类**用户显式要求多人**时的旧路径。没有点名时
 * 走的是上面的 buildRelayPrompt（单负责人串行接力）。
 */
function buildResponderPrompt(input) {
  const opts = input || {};
  const task = String(opts.task || "").trim();
  const subtask = opts.subtask && opts.subtask.title ? String(opts.subtask.title).trim() : "";
  const boardText = String(opts.boardText || "").trim();
  const lines = [];
  lines.push("【群任务】" + (task || "（空）"));
  if (subtask && subtask !== task) {
    lines.push("【你的分工】" + subtask + "（只做这一件；别人做别的，别重做）");
  }
  if (boardText) lines.push(boardText);
  lines.push(
    "先看共享任务板：别人已经做过的部分不要重写，只补自己分工里缺的东西；" +
      "做完说明你这一件的结果。",
  );
  return lines.join("\n");
}

/**
 * lead 综合回合的 prompt：成员原话 + 缺口 + 共享任务板。
 * 失败成员的**原始错误文本不进 prompt**（provider 细节不该再喂给模型），
 * 缺口用「谁没成功」如实点名，完整原因留在 final_report.sections 里。
 */
function buildSynthesisPrompt(input) {
  const opts = input || {};
  const task = String(opts.task || "").trim();
  const members = Array.isArray(opts.members) ? opts.members : [];
  const gaps = Array.isArray(opts.gaps) ? opts.gaps : [];
  const boardText = String(opts.boardText || "").trim();
  const lines = [];
  lines.push("你是这个群的 lead，请把成员的结果综合成一个可执行的最终答案。");
  lines.push("【群任务】" + (task || "（空）"));
  if (members.length) {
    lines.push("【成员结果】");
    for (const m of members) {
      const name = String((m && m.name) || (m && m.bot_id) || "?");
      const body = m && m.ok
        ? clip((m && m.text) || "", SYNTHESIS_MEMBER_CHARS)
        : "（本轮未成功）";
      lines.push("- " + name + "：" + body);
    }
  }
  if (gaps.length) lines.push("【缺口】" + gaps.join("；"));
  if (boardText) lines.push(boardText);
  lines.push(
    "要求：只综合上面真实出现的内容，不要编造成员没说的结论；" +
      "有缺口就如实写明；最后给出可执行的下一步。",
  );
  return lines.join("\n");
}

/**
 * 确定性拆解（宿主启发式）：任务里本来就写了「谁做什么」时才拆。
 * 拆不出来就返回空数组 —— 那就诚实地继续用同一个任务（宁可重复，不要假装分工）。
 */
function decomposeTask(task, opts) {
  const options = opts || {};
  const maxCount = Math.max(1, Number(options.maxCount || SUBTASK_MAX_COUNT));
  const minLen = Math.max(2, Number(options.minLen || 4));
  const text = String(task || "").trim();
  if (!text) return [];
  let parts = text
    .split(/\r?\n+|；|;/)
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (parts.length < 2 && /分别|各自|各负责|分工|每人/.test(text)) {
    parts = text
      .split(/，|,/)
      .map((s) => String(s).trim())
      .filter(Boolean);
  }
  if (parts.length < 2) {
    // 「A and B」「A 以及 B」：只在没有别的分隔符时兜底切一刀，且每段都得够长，
    // 否则宁可不拆（宁可重复，也不要把任务切得莫名其妙）。
    const andParts = text
      .split(/\s+(?:and\s+then|and|以及|还有)\s+/i)
      .map((s) => String(s).trim())
      .filter(Boolean);
    const cjk = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
    if (
      andParts.length >= 2 &&
      andParts.every((p) => p.length >= 4 && (cjk.test(p) || p.length >= 8))
    ) {
      parts = andParts;
    }
  }
  parts = parts.map((s) =>
    s.replace(/^[\s]*(\d+[\.、)]|[-*•·]|第[一二三四五六七八九十]+步[：:]?)\s*/, "").trim(),
  );
  parts = parts.filter((s) => s.length >= minLen);
  if (parts.length < 2) return [];
  if (parts.length > maxCount) {
    const head = parts.slice(0, maxCount - 1);
    head.push(parts.slice(maxCount - 1).join("；"));
    parts = head;
  }
  return parts.map((title, i) => ({ id: "sub-" + (i + 1), title: clip(title, SUBTASK_MAX_CHARS) }));
}

/**
 * 校验模型给的拆解建议。模型只能**建议**：形状不合格就整份丢弃，退回宿主
 * 启发式；条数/长度由宿主裁剪。
 */
function normalizeSubtaskProposal(proposal, opts) {
  const options = opts || {};
  const maxCount = Math.max(1, Number(options.maxCount || SUBTASK_MAX_COUNT));
  const list = Array.isArray(proposal)
    ? proposal
    : Array.isArray(proposal && proposal.subtasks)
      ? proposal.subtasks
      : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const raw =
      item && typeof item === "object"
        ? item.title || item.task || item.subtask || item.text || ""
        : item;
    const title = String(raw || "").trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= maxCount) break;
  }
  return out.map((title, i) => ({ id: "sub-" + (i + 1), title: clip(title, SUBTASK_MAX_CHARS) }));
}

/**
 * 确定性分工：轮转分配，宿主说了算，模型无权指定谁做。
 * 返回 Map<bot_id, subtask[]>（空数组 = 没有专属子任务，做共享任务）。
 */
function assignSubtasks(subtasks, memberIds) {
  const list = Array.isArray(subtasks) ? subtasks : [];
  const members = (Array.isArray(memberIds) ? memberIds : []).map((id) => String(id));
  const out = new Map();
  for (const id of members) out.set(id, []);
  list.forEach((sub, i) => {
    if (!members.length) return;
    const owner = members[i % members.length];
    const arr = out.get(owner) || [];
    arr.push(sub);
    out.set(owner, arr);
  });
  return out;
}

function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigrams(text) {
  const s = String(text || "");
  const out = [];
  for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2));
  return out;
}

function diceCoefficient(a, b) {
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const g of a) counts.set(g, (counts.get(g) || 0) + 1);
  let hit = 0;
  for (const g of b) {
    const n = counts.get(g) || 0;
    if (n > 0) {
      counts.set(g, n - 1);
      hit++;
    }
  }
  return (2 * hit) / (a.length + b.length);
}

/**
 * 重复劳动率：几个成员产出了「几乎一样」的回答。
 * 可测口径：两两 bigram Dice 相似度 ≥ 阈值即视为重复；rate = 重复成员数 /
 * 成功成员数。分组用并查集给出「谁和谁做了一样的事」。
 */
function duplicateWorkRate(sections, opts) {
  const options = opts || {};
  const threshold = Number(options.threshold || DUPLICATE_THRESHOLD);
  const list = (Array.isArray(sections) ? sections : []).filter(
    (s) => s && s.ok !== false && String(s.text != null ? s.text : s.summary || "").trim(),
  );
  const n = list.length;
  if (n < 2) {
    return {
      rate: 0,
      duplicate_members: 0,
      comparable: n,
      threshold,
      members: [],
      groups: [],
    };
  }
  const grams = list.map((s) => bigrams(normalizeForCompare(s.text != null ? s.text : s.summary || "")));
  const sim = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) row.push(i === j ? 1 : diceCoefficient(grams[i], grams[j]));
    sim.push(row);
  }
  const parent = list.map((_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sim[i][j] >= threshold) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const arr = groups.get(root) || [];
    arr.push({
      bot_id: String(list[i].bot_id || ""),
      name: String(list[i].name || ""),
    });
    groups.set(root, arr);
  }
  const members = [];
  let dupCount = 0;
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestWith = "";
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (sim[i][j] > best) {
        best = sim[i][j];
        bestWith = String(list[j].bot_id || list[j].name || "");
      }
    }
    const dup = best >= threshold;
    if (dup) dupCount++;
    members.push({
      bot_id: String(list[i].bot_id || ""),
      name: String(list[i].name || ""),
      similarity: Math.round(best * 1000) / 1000,
      duplicate: dup,
      most_similar_to: bestWith,
    });
  }
  return {
    rate: Math.round((dupCount / n) * 1000) / 1000,
    duplicate_members: dupCount,
    comparable: n,
    threshold,
    members,
    groups: Array.from(groups.values()).filter((g) => g.length > 1),
  };
}

/** token 估算（CJK 1.5 字/token，其余 4 字符/token）——只用于预算，不是计费。 */
function estimateTokens(text) {
  const s = String(text == null ? "" : text);
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

/**
 * 团队预算（唯一裁决者）。超了就停，并如实说明停在哪一条上。
 */
function createTeamBudget(options) {
  const opts = options || {};
  const limits = {
    max_turns: Math.max(1, Number(opts.maxTurns || 7)),
    max_wall_ms: Math.max(1000, Number(opts.maxWallMs || 600000)),
    max_tokens: Math.max(1000, Number(opts.maxTokens || 200000)),
    max_members: Math.max(1, Number(opts.maxMembers || 6)),
  };
  const startedAt = Date.now();
  const spent = { turns: 0, tokens: 0 };
  let exceeded = false;
  let reason = "";
  const elapsedMs = () => Date.now() - startedAt;
  const canStart = (cost) => {
    if (exceeded) return { ok: false, reason: reason || "budget_exhausted" };
    if (spent.turns + 1 > limits.max_turns) return { ok: false, reason: "max_turns" };
    if (elapsedMs() >= limits.max_wall_ms) return { ok: false, reason: "max_wall_ms" };
    const tokens = Number((cost && cost.tokens) || 0);
    if (spent.tokens + tokens > limits.max_tokens) return { ok: false, reason: "max_tokens" };
    return { ok: true, reason: "" };
  };
  const spend = (cost) => {
    spent.turns += Number(cost && cost.turns != null ? cost.turns : 1);
    spent.tokens += Number((cost && cost.tokens) || 0);
  };
  const mark = (why) => {
    exceeded = true;
    reason = String(why || reason || "budget_exhausted");
  };
  const snapshot = () => ({
    limits,
    spent: { turns: spent.turns, tokens: spent.tokens, wall_ms: elapsedMs() },
    exceeded,
    reason,
  });
  return {
    limits,
    canStart,
    spend,
    mark,
    snapshot,
    elapsedMs,
    remainingMs: () => Math.max(0, limits.max_wall_ms - elapsedMs()),
  };
}

/**
 * 真取消通道：promise 一旦 cancel，执行层（runResponderTurn → runner.runTurn 的
 * ctx.cancelPromise / ctx.isCancelled）就能真的停下来，而不是只把外层 promise
 * reject 掉、让内核继续烧 token。
 */
function createCancelScope() {
  let cancelled = false;
  let reason = "";
  let resolveFn = null;
  const promise = new Promise((resolve) => {
    resolveFn = resolve;
  });
  return {
    promise,
    cancel(why) {
      if (cancelled) return false;
      cancelled = true;
      reason = String(why || "cancelled");
      try {
        resolveFn(reason);
      } catch (_) {
        /* 取消通道本身不能抛 */
      }
      return true;
    },
    isCancelled() {
      return cancelled;
    },
    reason() {
      return reason;
    },
  };
}

module.exports = {
  BOARD_DIR_REL,
  BOARD_MAX_CHARS,
  BOARD_MAX_SECTIONS,
  BOARD_MAX_MESSAGES,
  SUBTASK_MAX_CHARS,
  SUBTASK_MAX_COUNT,
  DUPLICATE_THRESHOLD,
  RELAY_MARKERS,
  RELAY_MAX_HOPS,
  ROUTE_MIN_SCORE,
  ROUTE_MIN_MARGIN,
  createRoomBoard,
  buildBoardText,
  buildResponderPrompt,
  buildSynthesisPrompt,
  buildRelayPrompt,
  composeDeliverable,
  matchFragments,
  parseRelayReply,
  routeTask,
  decomposeTask,
  normalizeSubtaskProposal,
  assignSubtasks,
  duplicateWorkRate,
  estimateTokens,
  createTeamBudget,
  createCancelScope,
  sanitizeBoardKey,
  clip,
};
