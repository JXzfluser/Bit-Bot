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
    const tmp = `${file}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
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
  /* 岗位 prompt（批次 5）**刻意不拼在这里**：
   * 编排 prompt 会整段进内核，而内核用它做意图识别（中文建房句式是全文子串
   * 匹配）⇒ 岗位 prompt 里「不得扩展选题**或加入**新观点」这种句子会被判成
   * 「把 X 拉进 Y 群」⇒ 这一棒直接去建房了（实测 names_not_found）。
   * ⇒ 岗位 prompt 走 roomContext（只进模型请求，不参与内核意图解析）。
   * 见 hosts/shared/room_context.js 的 self_prompt。 */
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
    /* 流水线（批次 4）里上一棒交的是**成果正文**：可能是整张情报卡、也可能是一份
       brief ⇒ 400 字的截断会把关键内容切掉，下一棒就等于没拿到上游 ⇒ 按需放宽。 */
    const prevMax = Math.max(400, Number(opts.prevMaxChars || 0));
    lines.push("【上一棒】" + String(prev.name || prev.bot_id || "") + " 交给你：" + clip(prev.text, prevMax));
  }
  /* Host 找料（批次 10）——**材料直接进 prompt**。
   * 为什么不是让成员去读文件：岗位 prompt 明写「不得访问本机文件」，
   * 而且成员**没有**读共享目录的可靠途径 ⇒ 材料只存在于文件里 = 模型看不到。
   * ⇒ Host 把料直接贴进 prompt，成员只做判断与写作。 */
  if (opts.materials && String(opts.materials.text || "").trim()) {
    lines.push(
      "【Host 已经取回的材料（不用你再上网找）】",
      String(opts.materials.text).trim(),
      "这些材料里每一条链接都**由 Host 实测过能打开**，死链已经剔掉了。",
      "直接用下面的材料做判断和写作；**不要自己去 web_search / web_fetch 找料**" +
        "（你一去抓就会陷在登录墙和打不开的站点里，任务会超时）。",
      "材料抓不到正文的地方只写标题和链接、并标「待核查」，**不要编造细节**。",
    );
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
  /* 有交付契约时，把这一棒的落点说清楚 —— 否则成员会以为要自己写文件，
     而实际上它**没有写文件的工具**（write_result 是 Gmail 的 MCP 工具），
     于是它只会交一句「已写入 xxx」，Host 把那句话当交付 ⇒ 产物成了转述。 */
  if (opts.contract && (opts.contract.dir || opts.contract.path)) {
    const where = String(opts.contract.dir || opts.contract.path).trim();
    lines.push(
      "   这一棒有交付约定：成果会被 Host 落到「" + where + "」下。" +
      "你**不用自己写文件**，把成果正文完整写在这条回复里就行；" +
      "只交一句「已完成」或一个路径，Host 会判这一棒没交出成果（后面的人不接力，产物也不落盘）。",
    );
  }
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
  // mode:
  //   relay（默认）—— 串行接力，**最后一棒**是权威交付内容，前面几棒作过程留痕；
  //   parallel      —— 用户显式 @ 了多个人（各写各的），没有「最后一棒」这回事，
  //                    所有成功成果并列成交付内容，谁写了什么都留着；
  //   pipeline      —— 批次 4：成员契约带 order 的**流水线**。每一棒是独立交付物
  //                    （情报卡 / 选题 brief / 候选稿 / 审校 / 复盘 各有各的目录）
  //                    ⇒ 同样并列成交付内容，但标出先后顺序。
  const mode = String(opts.mode || "relay");
  const parallel = mode === "parallel";
  const pipeline = mode === "pipeline";
  const multi = parallel || pipeline;
  const title = clip(task || "群任务产物", 80);
  /* 交付内容优先取**成员写下的那个文件**（delivered_content，契约验收通过时由 Host 写入），
     没有契约时退回成员交上来的文本。两者都不是「对成果的转述」以外的东西。 */
  const bodyOf = (r) => String((r && (r.delivered_content || r.text)) || "").trim();
  const done = relay.filter((r) => r && r.ok && bodyOf(r));
  const lines = [];
  lines.push("# " + title);
  lines.push("");
  const meta = [];
  if (opts.roomTitle) meta.push("群：" + String(opts.roomTitle));
  if (opts.at) meta.push("时间：" + String(opts.at));
  if (relay.length) {
    meta.push((pipeline ? "流水线：" : parallel ? "成员：" : "接力：") +
      relay.map((r) => String(r.name || r.bot_id || "")).join(multi ? "、" : " → "));
  }
  if (meta.length) {
    lines.push("> " + meta.join("｜"));
    lines.push("");
  }
  if (done.length) {
    lines.push("## 交付内容");
    lines.push("");
    if (multi) {
      for (const r of done) {
        lines.push("### " + String(r.name || r.bot_id || ""));
        lines.push("");
        lines.push(bodyOf(r));
        lines.push("");
      }
    } else {
      lines.push(bodyOf(done[done.length - 1]));
      lines.push("");
      if (done.length > 1) {
        lines.push("## 过程");
        lines.push("");
        for (let i = 0; i < done.length - 1; i++) {
          lines.push("### 第 " + (i + 1) + " 棒 · " + String(done[i].name || done[i].bot_id || ""));
          lines.push("");
          lines.push(bodyOf(done[i]));
          lines.push("");
        }
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
  const contract = opts.contract || null;
  const hasContract = !!(contract && (contract.dir || contract.path));
  const lines = [];
  lines.push("【群任务】" + (task || "（空）"));
  /* 岗位 prompt（批次 5）同样走 roomContext，不拼进编排 prompt（理由同上）。 */
  if (subtask && subtask !== task) {
    lines.push("【你的分工】" + subtask + "（只做这一件；别人做别的，别重做）");
  }
  if (boardText) lines.push(boardText);
  lines.push(
    "先看共享任务板：别人已经做过的部分不要重写，只补自己分工里缺的东西。",
  );
  if (hasContract) {
    /* 交付契约（批次 1/1.5）：团队模式（并行分工）原本只有一句「做完说明你这一件的
       结果」⇒ 成员交的是**转述** ⇒ Host 落盘的也是汇报，不是成果。
       ⇒ 有契约时，口径必须和串行接力一致：交**正文**，Host 代写落盘。 */
    const where = String(contract.dir || contract.path).trim();
    lines.push(
      "这一棒有交付约定：成果会被 Host 落到「" + where + "」下。" +
      "你**不用自己写文件**，把成果正文完整写在这条回复里就行；" +
      "只交一句「已完成」或一个路径，Host 会判这一棒没交出成果（产物也不落盘）。",
    );
    lines.push(
      "做完把**成果正文**交上来（成稿的正文、脚本、清单、结论都行），不要只写「已完成」「如上」。",
    );
  } else {
    lines.push("做完说明你这一件的结果。");
  }
  return lines.join("\n");
}

/**
 * 流水线顺序：成员契约里带 `order` 的，按 order 排成一条链。
 *
 * 为什么需要这条（批次 4）：内置团队模板是一条**五棒流水线**——情报 → 选题 →
 * 主笔 → 审校 → 复盘，角色之间靠上游交付物衔接（角色 prompt 里写死了
 * 「读 02-briefs/ 里已批准的 brief」之类）。
 * 若按「并行分工」跑，后四棒**拿不到上游成果**：成员的角色 prompt 明写
 * 「不得访问本机文件」⇒ 它们读不到共享目录里刚落盘的文件 ⇒ 只能编。
 * ⇒ 有 order ⇒ 串行跑，每棒把上一棒交上来的正文递下去（prev）。
 *
 * 判据要**窄**：只有显式带 order 的成员才进流水线；order 缺失或重复 ⇒ 不算
 * 流水线（说不清谁接谁就不猜，退回原有行为）。
 */
function pickPipelineOrder(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const picked = [];
  for (const c of list) {
    const d = c && c.deliverable;
    const order = Number(d && d.order);
    if (!Number.isFinite(order) || order <= 0) continue;
    picked.push({ bot: c, order: Math.floor(order) });
  }
  if (picked.length < 2) return [];
  picked.sort((a, b) => a.order - b.order);
  for (let i = 1; i < picked.length; i++) {
    if (picked[i].order === picked[i - 1].order) return []; // 重复 order ⇒ 谁接谁说不清
  }
  return picked.map((p) => p.bot);
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

/* ===== 产物验收：成员交上来的必须是「成果本身」，不是对成果的转述 =====
 *
 * 缘起（2026-11-23，截图实证）：
 *   团队模板的角色 prompt 里**早就写死了**【固定交付】与【验收】——
 *   「写入 /workspace/content-team/01-inbox/YYYY-MM-DD.md，每次最多 8 条……
 *     完成后只汇报文件路径、条数和未完成原因。」
 *   ⇒ 也就是说：**产物本来就是那个文件**；成员按 prompt 只汇报「路径+条数」，
 *     而**那句汇报恰恰是转述**。
 *   而 Host 侧当时**不认这个契约**：buildRelayPrompt 第 3 条虽然写着
 *   「交付时直接给成果本身，不要只写『已完成』」——**指令对了，但没有强制**；
 *   Host 拿成员的汇报文本当交付，下限只有 20 字符，于是照样落盘。
 *   实测：群里「收齐 3/3」「产物已落盘」全绿，产物却只有 882 字节的转述，
 *   而且两棒成员交的话**一字不差**（没在干各自的活）。
 *
 * ⇒ 这里把「指令」变成「验收」：
 *   · **契约存在**时（角色自带 / 任务带 / 房间带）：交付内容取自**成员写下的那个文件**；
 *     文件不在、内容不够 ⇒ 这一棒**不算交付**（驳回）、**下游不接力**、产物不落盘。
 *   · **契约不存在**时：**一字不改**地放行（opt-in 语义，不误伤普通短任务），
 *     但会把「这棒看起来只交了转述」记成 warn，让复盘能看见。
 *
 * 契约是**声明式**的（不解析自然语言）：角色 prompt 里的散文给人看，
 * Host 认的是这里的字段；两者必须由**同一处模板**生成，否则又是一份第二真相。
 */

/* 没有契约时的兜底判据（只用于 warn，不用于驳回）。 */
const NARRATION_PATTERNS = [
  /^已完成/, /^已看过上一棒/, /^请(?:复核|审阅|确认|检查|把)/,
  /请把.*(?:收成|整理成|并补)/, /^(?:如上|同上|以上)[。.]?$/,
];

function looksLikeNarration(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  return NARRATION_PATTERNS.some((re) => re.test(t));
}

/** 团队共享目录名（与 hosts/desktop/main.js 的 teamCreateWorkspace 同一条口径：
 *  目录名 = 标题去掉非法字符后截 48 —— 两边必须一致，否则成员按 prompt 写的路径
 *  和 Host 建的目录对不上。）。 */
/* 团队目录名清洗：实现下沉到 hosts/shared/host_ffi.js（唯一一份）。
   批次 10 起 Host 侧（prepareResearchMaterials）也要用同一个名字落材料目录
   ⇒ 两份实现必然漂移，这里改成复用底层那份。 */
const { sanitizeTeamDir } = require("../shared/team_paths.js");

/**
 * 交付契约的目标路径解析（唯一一份）。
 * spec: {path?, dir?, file?}
 * opts: {dataRoot, roomTitle, date, botName, scope}
 *   scope="team"（默认）⇒ 相对路径落在**团队共享目录** <dataRoot>/workspace/<团队名>/
 *                       （团队成员真正看得到的那棵树）
 *   scope="data"        ⇒ 相对路径落在 <dataRoot>/
 *   "/workspace/x"      ⇒ 一律 <dataRoot>/workspace/x
 * 占位符：{date} / YYYY-MM-DD / {title}（团队名）/ {bot}（成员名）
 */
function resolveDeliverablePath(spec, opts) {
  const o = opts || {};
  const c = typeof spec === "string" ? { path: spec } : (spec || {});
  let p = String(c.path || "").trim();
  if (!p && c.dir) {
    const dir = String(c.dir).trim().replace(/\/+$/, "");
    const file = String(c.file || "{date}.md").trim();
    p = dir ? dir + "/" + file : file;
  }
  if (!p) return "";
  const date = String(o.date || new Date().toISOString().slice(0, 10));
  const week = String(o.week || isoWeekOf(date));
  p = p
    .replace(/\{date\}/g, date)
    .replace(/YYYY-MM-DD/g, date)
    .replace(/\{week\}/g, week)
    .replace(/YYYY-WW/g, week.slice(0, 4) + "-W" + week.slice(5, 7))
    .replace(/\{title\}/g, sanitizeTeamDir(o.roomTitle || o.title || ""))
    .replace(/\{bot\}/g, sanitizeTeamDir(o.botName || o.bot || ""));
  const root = String(o.dataRoot || "").trim();
  if (!root) return "";
  if (p.startsWith("/workspace/")) {
    return path.join(root, "workspace", p.slice("/workspace/".length));
  }
  if (path.isAbsolute(p)) return p;
  const scope = String(o.scope || "team");
  if (scope === "data") return path.join(root, p);
  return path.join(root, "workspace", sanitizeTeamDir(o.roomTitle || o.title || ""), p);
}

/** ISO 周（YYYY-Www）—— 复盘类交付物按周命名。 */
function isoWeekOf(dateStr) {
  const d = new Date(String(dateStr || "") + "T00:00:00Z");
  if (isNaN(d.getTime())) return "";
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  const ww = String(week).padStart(2, "0");
  return String(t.getUTCFullYear()) + "-W" + ww;
}

/**
 * 数条目（列表项）：`- xxx` / `1. xxx` / `1、xxx` / `题 1｜xxx` / `一、xxx` / `第1条 xxx`。
 *
 * 为什么扩了这么多写法（批次 7）：
 *   实测真实产物里，同一支团队用了**三种**编号写法 ——
 *   情报卡用 `1.`，选题 brief 用 `题 1｜`，审校意见用 `一、`。
 *   旧规则只认 `-` / `*` / `1.` ⇒ 对 `题 1｜` 那种写法数出 **0 条**
 *   ⇒ 一旦给这些棒配 `min_items`，**正确产物会被判红**（实测）。
 *   这不是「加个 min_items」能解决的，是**计数规则跟不上产物形态**。
 *   ⇒ 规则要认全中文/英文常见的编号形态，否则 min_items 是个陷阱。
 */
function countDeliverableItems(content) {
  const lines = String(content || "").split(/\r?\n/);
  let n = 0;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    /* markdown 标题不算条目（那是小节，不是列表项） */
    if (/^#{1,6}\s/.test(t)) continue;
    if (
      /^[-*•]\s+/.test(t) ||            /* - xxx / * xxx / • xxx */
      /^\d+[.、)）]\s*/.test(t) ||       /* 1. xxx / 1、xxx / 1) xxx */
      /^[（(]?\d+[）)]\s*/.test(t) ||    /* (1) xxx / （1）xxx */
      /^题\s*\d+\s*[｜|丨:：.、]/.test(t) || /* 题 1｜xxx */
      /^第\s*[0-9一二三四五六七八九十]+\s*[条项篇章节]/.test(t) || /* 第 1 条 xxx */
      /^[一二三四五六七八九十]+\s*[、.．]/.test(t)  /* 一、xxx */
    ) n++;
  }
  return n;
}

/**
 * 从正文里抽出**链接 token**（含 markdown 的链接与裸 URL）。
 * 返回 [{raw, url, ok, why}]。
 *
 * 为什么不能只用一个正则数「完整 URL」：
 *   实测（2026-11-24 真实产物）主笔那行「事实依据」里有 4 个 token，
 *   全部含全角 `）` 或中文，distinct 只有 2 个 ——
 *   而旧的 `countDeliverableUrls` 把这 4 个坏 token **全部算成完整链接**，
 *   于是 `min_urls` 反而在**帮坏链计数**：链接越写越脏，越容易达标。
 *   根因不是「少排了一个字符」，而是**产物形态是中文散文 + 全角标点**，
 *   逐个补字符迟早再炸（下一个产物会带 `、`，再下一个会带 `，`）。
 * ⇒ 改成：token 必须**整体是 ASCII** 才算一个链接；
 *   含非 ASCII（中文/全角标点/全角括号）⇒ 判为坏链。
 */
function extractUrlTokens(content) {
  const s = String(content || "");
  const out = [];
  /* markdown 链接 `[文字](url)` 会把两个 URL 连成一个 token ——
   * 实测那行坏链接抽出来是：
   *   "https://openai.com/...）与开源推理框架](https://openai.com/...）与开源推理框架)"
   * ⇒ 先在 `](` 处切开，再逐段抽 URL。
   * 切完仍会带上 markdown 的收尾 `)` / `]` ⇒ 后面逐条剥掉。 */
  const segs = String(s).split(/\]\(/);
  const raws = [];
  for (const seg of segs) {
    const m = seg.match(/https?:\/\/[^\s]+/g);
    if (m) for (const x of m) raws.push(x);
  }
  for (const tok of raws) {
    /* markdown 的收尾 `)` / `]` 是句法，不是 URL 的一部分 */
    let t = tok;
    while (t.endsWith(")") || t.endsWith("]")) t = t.slice(0, -1);
    if (!t) continue;
    const nonAscii = t.match(/[^\x00-\x7F]/g);
    out.push({
      raw: tok,
      url: t,
      ok: !nonAscii,
      why: nonAscii
        ? "链接里混进了非 ASCII 字符（" + Array.from(new Set(nonAscii)).slice(0, 4).join("、") +
          "）—— 这是坏链，不是完整链接"
        : "",
    });
  }
  return out;
}

/**
 * 数正文里**真正完整**的 URL（整体 ASCII 的 http:// 或 https:// 链接）。
 * `must_include: ["http"]` 是子串匹配，贴一个假链接就能过 ⇒ 验收要链接时
 * 数的是「像样的链接条数」。
 *
 * 新增能力：
 *   unique=true ⇒ 去重后计数（否则同一个链接写 4 次就满足 min_urls:4）
 */
function countDeliverableUrls(content, opts) {
  const o = opts || {};
  const tokens = extractUrlTokens(content).filter((t) => t.ok);
  if (o.unique) {
    const set = new Set(tokens.map((t) => t.url));
    return set.size;
  }
  return tokens.length;
}

/** 正文里有没有坏链（含全角标点/中文的链接 token）。 */
function findBrokenUrls(content) {
  return extractUrlTokens(content).filter((t) => !t.ok);
}

/**
 * 取出一个「小节」的正文。
 * 小节 = 以 label 开头的那一行 + 它后面连续的正文行，直到遇到下一个
 * 小节标题（markdown 标题 / 中文序号小节 / 同批配置里的另一个 label）。
 *
 * 为什么需要它（批次 7）：契约现在的 `must_include` 是**子串匹配** ——
 * 正文里出现「来源」两个字就算过 ⇒ 成员只写「来源」+ 200 字废话也能过。
 * 而岗位 prompt 里写的是「包含：可发布候选版本、改动说明、风险标记……」，
 * 这些是**要交付的段落**，不是要出现的词 ⇒ 必须检查段落里真有东西。
 */
function extractSectionBody(text, label, otherLabels) {
  const s = String(text || "");
  const lab = String(label || "");
  if (!lab) return "";
  const lines = s.split(/\r?\n/);
  const others = (otherLabels || []).map((x) => String(x || "")).filter((x) => x && x !== lab);
  const startsWithLabel = (line) => {
    const bare = String(line || "").trim()
      .replace(/^#{1,6}\s*/, "").replace(/^[【\[]/, "").replace(/[】\]]$/, "");
    return bare === lab || bare.startsWith(lab + "：") || bare.startsWith(lab + ":") ||
      bare.startsWith(lab + " ") || bare.startsWith(lab + "｜") || bare.startsWith(lab + "|");
  };
  /* 边界判定要能认出**任意一个**已知小节标题，不只是当前这个 label。 */
  const startsWithAnyLabel = (line, labels) => {
    const bare = String(line || "").trim()
      .replace(/^#{1,6}\s*/, "").replace(/^[【\[]/, "").replace(/[】\]]$/, "");
    return labels.some((L) => {
      const l = String(L || "");
      if (!l) return false;
      return bare === l || bare.startsWith(l + "：") || bare.startsWith(l + ":") ||
        bare.startsWith(l + " ") || bare.startsWith(l + "｜") || bare.startsWith(l + "|");
    });
  };
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (startsWithLabel(lines[i])) { start = i; break; }
  }
  if (start < 0) return "";
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim();
    if (i > start) {
      /* 小节边界：下一个小节标题 */
      if (/^#{1,6}\s/.test(t)) break;
      if (/^[一二三四五六七八九十]+\s*[、.．]/.test(t)) break;
      if (startsWithAnyLabel(t, others)) break;
    }
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

/**
 * 解析契约里的「成品出口」publish 声明。
 *
 * 为什么需要（批次 7）：实测真实产物里，交付目录有 01-inbox…06-analysis，
 * 但 **05-publish 是空的** —— 没有任何一棒往那儿放东西。
 * 用户拿到手的「成品」是**五棒堆叠的一个过程档案**（6259 字节，正文只占 3.2%），
 * 想发出去得先从档案里把正文抠出来。
 * ⇒ 成品必须**独立成文件**，而且是**可直接复制的那一份**。
 *
 * 写法：
 *   publish: [
 *     { dir: "05-publish", file: "{date}-final.md",   section: "可发布候选版本" },
 *     { dir: "05-publish", file: "{date}-sources.md", section: "原始来源清单" },
 *   ]
 *   section  —— 只把这一个小节的正文写成成品（不带标题行）
 *   sections —— 多个小节合成一个文件（用于「待人工签字」那几项）
 */
function resolvePublishTargets(contract, opts) {
  const o = opts || {};
  const c = typeof contract === "string" ? {} : (contract || {});
  const list = Array.isArray(c.publish) ? c.publish : (c.publish ? [c.publish] : []);
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const spec = {
      dir: String(raw.dir || "").trim(),
      file: String(raw.file || "").trim(),
      section: raw.section ? String(raw.section).slice(0, 60) : "",
      sections: Array.isArray(raw.sections)
        ? raw.sections.map((x) => String(x || "").slice(0, 60)).filter(Boolean).slice(0, 8)
        : [],
    };
    if (!spec.dir && !spec.file) continue;
    const p = resolveDeliverablePath({ dir: spec.dir, file: spec.file || "{date}.md" }, o);
    if (!p) continue;
    out.push(Object.assign({}, spec, { path: p }));
  }
  return out;
}

/**
 * 把原文里的某一个小节**换掉**，其它小节原样保留。
 *
 * 为什么需要（实测踩到）：
 *   回路第一次的实现是「用审校的这一节**整段**覆盖上游」——
 *   结果主笔稿里的「本轮选题」这一节**被整段抹掉了**（那节是主笔的，
 *   审校那一节里没有）。产物里选题裁决就没了。
 *   ⇒ 覆盖必须是**按小节**的：只替换指定的那一节，别人的小节一个字不动。
 *
 * @param {string} text   原文
 * @param {string} label  要替换的小节标题
 * @param {string} newBody 新的这一节的内容（不含标题行）
 * @returns {string} 替换后的全文（找不到该小节 ⇒ 原样返回）
 */
function replaceSectionBody(text, label, newBody) {
  const s = String(text || "");
  const lab = String(label || "");
  if (!lab || !newBody) return s;
  const lines = s.split(/\r?\n/);
  const allLabels = collectSectionLabels(s);
  const startsWithLabel = (line) => {
    const bare = String(line || "").trim()
      .replace(/^#{1,6}\s*/, "").replace(/^[【\[]/, "").replace(/[】\]]$/, "")
      .replace(/[：:]$/, "").trim();
    return bare === lab || bare.startsWith(lab + "：") || bare.startsWith(lab + ":") ||
      bare.startsWith(lab + " ") || bare.startsWith(lab + "｜") || bare.startsWith(lab + "|");
  };
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (startsWithLabel(lines[i])) { start = i; break; }
  }
  if (start < 0) return s;
  /* 找这一节的结束位置（下一个小节标题） */
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^#{1,6}\s/.test(t)) { end = i; break; }
    if (/^[一二三四五六七八九十]+\s*[、.．]/.test(t)) { end = i; break; }
    const bare = t.replace(/^#{1,6}\s*/, "").replace(/^[【\[]/, "").replace(/[】\]]$/, "");
    if (allLabels.some((L) => {
      const l = String(L || "");
      if (!l) return false;
      return bare === l || bare.startsWith(l + "：") || bare.startsWith(l + ":") ||
        bare.startsWith(l + " ") || bare.startsWith(l + "｜");
    })) { end = i; break; }
  }
  const head = lines.slice(0, start);
  const tail = lines.slice(end);
  const bodyLines = String(newBody).split(/\r?\n/);
  /* 保留原标题行，只换内容 */
  const titleLine = lines[start];
  return head.concat([titleLine], bodyLines, [""], tail).join("\n");
}

/**
 * 读「历史成品清单」（批次 9）：这个团队**已经产出过**的成品。
 *
 * 为什么需要（评审）：
 *   用户评审提了一条 ——「这个角度我上个月发过没有？谁查？」
 *   产品答不上来：没有任何地方记着「做过什么」。
 *   而真源是现成的：**05-publish/ 里的成品就是已产出过的作品**
 *   （批次 7 才开始往那儿放东西，之前是空的）。
 *
 * ⇒ Host 读 05-publish/ 下每个文件的**首行**（标题），
 *   递给下一棒，让它选题时能避开重复的角度。
 *
 * @returns {Array<{file:string, title:string}>}
 */
function readPublishedHistory(dataRoot, roomTitle, opts) {
  const o = opts || {};
  const root = String(dataRoot || "").trim();
  if (!root) return [];
  const dir = path.join(root, "workspace", sanitizeTeamDir(roomTitle || o.title || ""), "05-publish");
  let names = [];
  try {
    if (!fs.existsSync(dir)) return [];
    names = fs.readdirSync(dir).filter((n) => /\.md$/i.test(n)).sort();
  } catch (_) {
    return [];
  }
  const out = [];
  for (const n of names.slice(0, Math.max(1, Number(o.max || 20)))) {
    let title = "";
    try {
      const raw = fs.readFileSync(path.join(dir, n), "utf8");
      const first = String(raw).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || "";
      /* 第一行常是小节标题（「正文」/「可发布候选版本」）⇒ 往后找第一行像正文的 */
      title = first;
      const lines = String(raw).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const bodyLine = lines.find((x) => x.length > 12 && !/^#/.test(x) &&
        !/^[【\[（(]/.test(x) && !/^(正文|事实依据|仍需确认|可发布候选版本|改动说明|风险标记|仍需人工确认|原始来源清单|数据来源|本轮交付|链路断点|改进建议|数据缺口|本轮选题)$/.test(x));
      if (bodyLine) title = bodyLine.slice(0, 60);
    } catch (_) {
      title = "";
    }
    out.push({ file: n, title: title || n });
  }
  return out;
}

/**
 * 「审校 → 修订」回路（批次 9）：把某一棒的小节**覆盖**到上游的交付物上。
 *
 * 为什么需要（实测 + 评审）：
 *   审校那一棒交的是「可发布候选版本」这一节 —— **已经是改好的稿**。
 *   以前这条链是单向的：审校的修改只躺在它的产物里，主笔那一棒的稿
 *   **一个字都没变** ⇒ 「提了意见没人执行」。
 *   逐字对比实测产物：审校说「建议改为『单次推理成本结构变化』」，
 *   稿子里仍是「推理成本这次真的下了一档」（比被批评的更重）。
 *
 * 为什么不是「让主笔重跑」：
 *   - 主笔重跑要再花一次模型调用，而且**可能把审校的修改改回去**；
 *   - 审校手里已经有改好的稿了（它必须交这一节才能过验收）⇒ 直接用它更准。
 *   ⇒ 回路 = **用审校的改后稿覆盖主笔的稿**，并留一条修订记录。
 *
 * 契约声明（opt-in，不声明行为一字不变）：
 *   deliverable.replaces = [{ section: "可发布候选版本", upstream: "内容主笔" }]
 *     section  —— 取这一棒的这一小节作为覆盖内容
 *     upstream —— 覆盖哪一棒（按角色名匹配）
 *
 * @returns {{ok:boolean, reason:string, replaced:object|null}}
 */
function applyRevisionLoop(input) {
  const o = input || {};
  const chain = Array.isArray(o.chain) ? o.chain : [];
  const contract = o.contract || {};
  const specs = Array.isArray(contract.replaces) ? contract.replaces : [];
  if (!specs.length) return { ok: true, reason: "no_replaces_declared", replaced: null };
  const selfName = String(o.selfName || "");
  const body = String(o.body || "");
  for (const spec of specs) {
    if (!spec || typeof spec !== "object") continue;
    const section = String(spec.section || "");
    const upstreamName = String(spec.upstream || "");
    if (!section || !upstreamName) continue;
    /* 找到要覆盖的那一棒 */
    const target = chain.find((c) => c && String(c.name || "") === upstreamName);
    if (!target) continue;
    /* 取本棒的这一小节 —— 找不到 ⇒ 明确说不覆盖，不静默放过 */
    /* 取本节内容（**去掉标题行**）—— 覆盖时上游那节自己的标题保留，
       否则会变成「正文」下面又套一个「可发布候选版本」标题。 */
    const revisedRaw = extractSectionBody(body, section, collectSectionLabels(body));
    const revised = revisedRaw
      ? revisedRaw.split(/\r?\n/).slice(1).join("\n").replace(/^\s+/, "").replace(/\s+$/, "")
      : "";
    if (!revised) {
      return {
        ok: false, reason: "本棒没有「" + section + "」这一节，没法覆盖上游",
        replaced: null,
      };
    }
    /* 覆盖上游的**哪一节**：
       - target_section 显式指定 ⇒ 覆盖那一节
       - 没指定 ⇒ 找上游里与本节「同名的」小节
       - 都没有 ⇒ 整段覆盖（上游没有小节结构时）
       为什么需要 target_section：审校的「可发布候选版本」对应主笔的「正文」，
       两者**名字不一样**（实测踩过：不指定时覆盖落空，回路静默失效）。 */
    const targetSection = String(spec.target_section || "");
    const upstreamLabels = collectSectionLabels(String(target.delivered_content || ""));
    const sameName = upstreamLabels.find((L) => L === section);
    const effectiveTarget = targetSection || sameName || "";
    const before = String(target.delivered_content || "");
    /* ⚠️ **按小节替换**，不是整段覆盖 ——
       整段覆盖会把上游的其它小节（本例：主笔的「本轮选题」）整段抹掉。
       实测踩过：回路生效后，产物里选题裁决消失了。 */
    const merged = effectiveTarget
      ? replaceSectionBody(before, effectiveTarget, revised)
      : (revised + "\n\n" + before);
    if (merged === before) {
      return { ok: true, reason: "覆盖内容与上游相同（无变化）", replaced: null };
    }
    return {
      ok: true,
      reason: "",
      replaced: {
        upstream_name: upstreamName,
        upstream_from: selfName,
        section,
        target_section: effectiveTarget,
        before_chars: before.length,
        after_chars: merged.length,
        /* 修订记录：复盘棒能确定性核对「提了 N 条、执行了几条」 */
        revision: {
          at: new Date().toISOString(),
          section,
          from: upstreamName,
          by: selfName,
          before_sha: sha1(before),
          after_sha: sha1(revised),
        },
        content: merged,
      },
    };
  }
  return { ok: true, reason: "no_matching_replace_spec", replaced: null };
}

/** 极简 sha1（只用于修订记录的指纹，不做安全用途）。 */
function sha1(text) {
  const crypto = require("crypto");
  return crypto.createHash("sha1").update(String(text || ""), "utf8").digest("hex").slice(0, 12);
}

/** 从交付正文里取出成品正文（按 section / sections）。 */
function extractPublishBody(content, target) {
  const text = String(content || "");
  const secs = target.sections && target.sections.length
    ? target.sections
    : (target.section ? [target.section] : []);
  if (!secs.length) return text;
  /* ⚠️ 边界判定要知道**全文里所有的小节标题**，否则「正文」那一节会把
     后面「事实依据」「仍需确认」一起吞进来 ⇒ 成品文件变成整份过程档案。
     ⇒ 从正文里把所有形如「小节标题 + 空行/内容」的标题行都认出来，
     一并当作边界。（实测踩过：成品文件里三个小节全在。） */
  const allLabels = collectSectionLabels(text);
  const parts = [];
  for (const s of secs) {
    const body = extractSectionBody(text, s, allLabels);
    if (body) parts.push(body);
  }
  return parts.join("\n\n").trim();
}

/**
 * 找出正文里所有「小节标题」行。
 * 判据：单独一行、长度不太长、后面不是紧跟正文（也就是后面要么空行、
 * 要么整行就是它自己）—— 这是 markdown 里小节标题最稳的形状。
 */
function collectSectionLabels(text) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.length > 40) continue;
    const bare = t.replace(/^#{1,6}\s*/, "").replace(/^[【\[]/, "").replace(/[】\]]$/, "")
      .replace(/[：:]$/, "").trim();
    if (!bare || bare.length > 30) continue;
    /* 排除「内容行」：原行带冒号（如「来源 1：https://…」）⇒ 那是内容，不是标题。
       （标题也可能是「事实依据：」，但那种行只有一个冒号且冒号在末尾 ⇒ 已剥掉。） */
    if (/[：:]/.test(t.replace(/[：:]$/, ""))) continue;
    /* 排除正文句子：以句末标点结尾的（。！？；，、）几乎都是句子，不是小节标题。
       中文小节标题（正文 / 事实依据 / 仍需确认）不带这些标点。 */
    if (/[。！？；，、,.!?;]$/.test(bare)) continue;
    /* 标题行后面要么空行、要么整行结束 ⇒ 不像正文句子 */
    const next = (lines[i + 1] || "").trim();
    if (next) continue;
    out.push(bare);
  }
  return out;
}

/**
 * 跨棒一致性比对（批次 7）。
 *
 * 为什么要有这一层（实测）：5 条契约全是「单棒自证」——每棒只查自己，
 * **链路传递零校验**。于是：
 *   - 选题 brief 里出现了情报卡**根本没有**的链接（无源选题）照样判过；
 *   - 主笔的稿子引了 brief 里没有的来源也判过；
 *   - 复盘声称「情报卡 8 条」，实际只有 2 条，也判过。
 * 这三类都是**纯确定性**能抓的：Host 本来就持有全部上游产物，
 * 不需要模型、不需要改任何一棒的工作方式。
 *
 * @param {object} input
 *   upstream  上游各棒的交付正文数组（字符串）
 *   text      当前棒的交付正文
 *   rules     当前棒的契约规则
 * @returns {{pass:boolean, code:string, reason:string, extra_links:string[], counts:object}}
 */
function judgeCrossStage(input) {
  const o = input || {};
  const rules = o.rules || {};
  const upstream = Array.isArray(o.upstream) ? o.upstream : [];
  const text = String(o.text || "");
  const out = { pass: true, code: "ok", reason: "", extra_links: [], counts: {} };

  /* 规则一：当前棒的链接必须来自上游（不得凭空造来源）。
   * 只有「上游确实有链接」时才查 —— 上游没链接的情况由各棒自己的
   * min_urls 管，不在这里越权。 */
  if (rules.links_must_come_from_upstream && upstream.length) {
    const up = new Set();
    for (const u of upstream) {
      for (const t of extractUrlTokens(u)) if (t.ok) up.add(t.url);
    }
    if (up.size) {
      const mine = [];
      for (const t of extractUrlTokens(text)) {
        if (t.ok && !up.has(t.url)) mine.push(t.url);
      }
      if (mine.length) {
        out.pass = false;
        out.code = "link_not_from_upstream";
        out.extra_links = Array.from(new Set(mine));
        out.reason = "交付里有 " + out.extra_links.length +
          " 条链接在上游产物里不存在（" + out.extra_links.slice(0, 3).join("、") +
          "）—— 引用来源必须来自上游已核验的材料";
        return out;
      }
    }
  }

  /* 规则二：数字对账 —— 当前棒声称的「上游条目数」必须等于上游真实条目数。
   * 抓的是「复盘声称情报卡 8 条，实际只有 2 条」这类虚报。
   * 只查「N 条/N 个/N 份」这种**计数量词**前的数字，且必须能在上游正文里
   * 找到对应说法 —— 避免把无关数字（如「四成」「3 项建议」）误判。 */
  if (rules.counts_must_match_upstream && upstream.length) {
    const upText = upstream.join("\n");
    /* 上游每个棒的真实条目数（用修好的计数规则） */
    const upCounts = upstream.map((u) => countDeliverableItems(u));
    const total = upCounts.reduce((a, b) => a + b, 0);
    out.counts = { upstream_per_hop: upCounts, upstream_total: total };
    /* 当前棒里出现的「N 条」「N 个」 */
    const claimed = [];
    const re = /(\d+)\s*(条|个|份|则|张)/g;
    let m;
    while ((m = re.exec(text)) !== null) claimed.push({ n: Number(m[1]), unit: m[2], at: m.index });
    /* 只查那些**看起来在说上游**的计数：
     * 上下文里出现「情报卡/情报/简报/brief/选题/来源/卡片/条情报」等上游物。 */
    const UPSTREAM_WORDS = /(情报卡|情报|简报|brief|选题|素材|卡片|来源清单)/;
    const bad = [];
    for (const c of claimed) {
      const around = text.slice(Math.max(0, c.at - 24), c.at + 24);
      if (!UPSTREAM_WORDS.test(around)) continue;
      /* 上游正文里出现过这个数字吗？ */
      if (!new RegExp("\\b" + c.n + "\\b").test(upText)) {
        bad.push(c);
      }
    }
    if (bad.length) {
      out.pass = false;
      out.code = "count_mismatch";
      out.reason = "交付里声称「" + bad[0].n + " " + bad[0].unit +
        "」，但上游产物里没有这个数字（上游实际：" + upCounts.join(" / ") +
        " 条）—— 复盘不许虚报上游规模";
      return out;
    }
  }

  /* 规则三：凭空数字 —— 正文里的**百分比**必须在上游出现过。
   *
   * 为什么只查百分比（不查所有数字）：
   *   实测最严重的一条是主笔写「重试吃掉了总成本的**近四成**」——
   *   而上游情报卡里**没有任何成本遥测数据**，brief 还明写「定价页未同步更新」。
   *   ⇒ 这个数字不是模型乱编，是**上游把能算账的东西全过滤了，然后契约还要求它算账**。
   *   百分比是**伪造风险最高**、也最容易确定性检出的一类：
   *   「N%」「近四成」这种，上游正文里没有 ⇒ 判红。
   *   而「3 条」「2 题」这类计数已由 counts_must_match_upstream 管，
   *   日期/版本号/链接里的数字另有一堆例外 ⇒ 一概不查，避免误杀。
   */
  if (rules.percentages_must_come_from_upstream && upstream.length) {
    const upText = upstream.join("\n");
    const upPcts = extractPercentages(upText);
    const minePcts = extractPercentages(text);
    const orphan = minePcts.filter((p) => !upPcts.includes(p));
    if (orphan.length) {
      out.pass = false;
      out.code = "fabricated_percentage";
      out.reason = "交付里有上游没有的百分比（" + orphan.join("、") +
        "）—— 数字必须能从上游材料算出来，不能自己编";
      return out;
    }
  }
  /* 规则五：修订条数对账 —— 复盘说的「执行了 N 条修订」必须等于上游实际发生的 N。
   *
   * 为什么需要（批次 9）：
   *   回路落地后，链路里会留下**修订记录**（谁改的、改了哪节、前后指纹）。
   *   复盘棒如果自己另起一个数字（"改了 5 处"，实际 2 处），
   *   那复盘本身就是编的 —— 和它之前编「情报卡 8 条」是同一类毛病。
   * ⇒ 纯确定性判据：复盘里出现的「N 条修订」必须等于上游实际修订数。
   */
  if (rules.revisions_must_match_upstream && Number.isFinite(Number(o.revisionCount)) &&
      o.revisionCount !== undefined && o.revisionCount !== null) {
    const actual = Number(o.revisionCount);
    const m = text.match(/(\d+)\s*条[^。；\n]{0,6}修订/g) || [];
    const claimed = m.map((x) => Number((x.match(/\d+/) || ["0"])[0]));
    const badNums = claimed.filter((n) => n !== actual);
    if (badNums.length) {
      out.pass = false;
      out.code = "revision_count_mismatch";
      out.reason = "复盘里说有 " + badNums[0] + " 条修订，但上游实际发生了 " + actual +
        " 条 —— 复盘不许另起数字";
      return out;
    }
  }

  /* 规则四：链接可达性 —— 交付里声明「可访问」的链接必须真的能打开。
   *
   * 为什么需要（实测）：契约能判「链接长得对」（纯 ASCII、括号配平），
   * 但判不了「链接是死的」。评审里那条无源选题的来源
   * `https://example.com/audit-notes` —— **格式完全正确、纯 ASCII、能过
   * min_urls**，实测 HTTP 404。格式判据对它完全无效。
   * ⇒ 唯一能判的办法是**真的去访问那个 URL**。
   *
   * 为什么是 Host 做而不是成员做：成员会自己说「我核验过了」—— 那是自证。
   *
   * 为什么不阻塞验收：链接打不开 ≠ 产物不合格（登录墙/付费墙/SPA 都可能）。
   * ⇒ 但要**如实记录**：核验结果写进产物，让「核验状态」名副其实。
   *
   * 规则 keys：
   *   require_reachable_links  true    —— 有链接打不开 ⇒ 判红
   *   link_check_min          N       —— 至少要核验 N 条（太少说明没认真查）
   */
  if (Array.isArray(o.linkResults) && o.linkResults.length) {
    const bad = o.linkResults.filter((r) => r && !r.ok);
    const needMin = Number(rules.link_check_min || 0);
    if (needMin && o.linkResults.length < needMin) {
      out.pass = false;
      out.code = "link_check_too_few";
      out.reason = "只核验了 " + o.linkResults.length + " 条链接（要求 ≥ " + needMin +
        " 条）—— 交付里的来源都要真的访问一次";
      return out;
    }
    if (rules.require_reachable_links && bad.length) {
      out.pass = false;
      out.code = "unreachable_links";
      out.unreachable = bad.map((r) => r.url);
      out.reason = "交付里有 " + bad.length + " 条链接打不开（" +
        bad.slice(0, 3).map((r) => r.url + "（" + (r.reason || "unknown") + "）").join("、") +
        "）—— 来源必须真的能打开，不能只是长得像";
      return out;
    }
  }


  return out;
}

/**
 * 抽出正文里的百分比，统一成数字形态。
 * 认得两种写法：阿拉伯数字（40% / 40 %）与中文（约四成 / 近四成）。
 * 中文数字只认到「十」，够用了（更复杂的写法宁可放过，别误杀）。
 */
function extractPercentages(text) {
  const s = String(text || "");
  const out = [];
  /* 阿拉伯数字：40% / 40.5% */
  const re1 = /(\d+(?:\.\d+)?)\s*[%％]/g;
  let m;
  while ((m = re1.exec(s)) !== null) out.push(String(Number(m[1])));
  /* 中文：近四成 / 约八成 / 三成 */
  const CN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const re2 = /([一二三四五六七八九十])\s*成/g;
  while ((m = re2.exec(s)) !== null) {
    out.push(String(CN[m[1]] * 10));
  }
  return Array.from(new Set(out));
}

/**
 * 从交付正文里抽出**纯 ASCII**的完整链接（与 countDeliverableUrls 同口径）。
 * 用于 Host 侧核验可达性：混了全角/中文的坏链不算链接（那是格式问题，
 * 由 no_broken_urls 判），这里只取**格式正确**的那些去真的访问。
 */
function extractCleanUrls(content) {
  const s = String(content || "");
  const segs = s.split(/\]\(/);
  const out = [];
  for (const seg of segs) {
    const m = seg.match(/https?:\/\/[^\s]+/g);
    if (!m) continue;
    for (const tok of m) {
      let t = tok;
      while (t.endsWith(")") || t.endsWith("]")) t = t.slice(0, -1);
      if (!t) continue;
      if (/[^\x00-\x7F]/.test(t)) continue; // 混了全角/中文 ⇒ 坏链
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}
function readDeliverableArtifact(contract, opts) {
  const o = opts || {};
  const file = resolveDeliverablePath(contract, o);
  if (!file) return { ok: false, error: "no_path", path: "", reason: "契约里没写交付路径" };
  if (!fs.existsSync(file)) return { ok: false, error: "not_found", path: file, reason: "文件不存在" };
  let content = "";
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { ok: false, error: "read_failed", path: file, reason: String((e && e.message) || e) };
  }
  const chars = content.trim().length;
  if (!chars) return { ok: false, error: "empty", path: file, reason: "文件是空的" };
  return { ok: true, path: file, content, chars, bytes: Buffer.byteLength(content, "utf8") };
}

/**
 * 验收一棒。
 * @param {object} input
 *   text      成员这一棒交上来的**汇报文本**
 *   contract  这一棒的交付契约（没有 ⇒ 不驳回，只记 warn）
 *   dataRoot  数据根（用于解析 /workspace 与相对路径）
 *   rules     契约里的验收规则 {min_chars, max_items, min_items, must_include[]}
 * @returns {{pass:boolean, code:string, reason:string, chars:number, artifact:object|null, warn:string}}
 */
function judgeStage(input) {
  const o = input || {};
  const text = String(o.text || "").trim();
  const contract = o.contract || null;
  const rules = Object.assign({}, (contract && contract.rules) || {}, o.rules || {});
  const out = { pass: true, code: "ok", reason: "", chars: text.length, artifact: null, warn: "", content: "", target_path: "" };

  /* 没有契约 ⇒ 放行，但把「像转述」记下来（复盘可见，不拦人）。 */
  if (!contract || (!contract.path && !contract.dir)) {
    if (looksLikeNarration(text)) {
      out.warn = "这一棒只交了转述，没有交成果本身";
    }
    out.reason = out.warn ? out.warn : "无交付契约，按原文放行";
    out.code = out.warn ? "narration_only_warn" : "no_contract";
    return out;
  }

  const target = resolveDeliverablePath(contract, {
    dataRoot: o.dataRoot, date: o.date, roomTitle: o.roomTitle, botName: o.botName,
  });
  out.target_path = target;

  /* ── 通道 A：成员自己写文件（expect_file）──────────────────────────────
   * 交付内容 = 那个文件的正文；文件不在/不合格 ⇒ 这一棒不算交付。 */
  if (contract.expect_file === true || contract.expect_file === "true") {
    const art = readDeliverableArtifact(contract, {
      dataRoot: o.dataRoot, date: o.date, roomTitle: o.roomTitle, botName: o.botName,
    });
    out.artifact = art;
    if (!art.ok) {
      out.pass = false;
      out.code = art.error === "not_found" ? "no_deliverable_file" : ("artifact_" + art.error);
      out.reason = "这一棒没有交出约定的交付文件（" + (art.path || target) + "）：" + (art.reason || "");
      return out;
    }
    out.chars = art.chars;
    const verdict = checkContentRules(art.content, rules, "交付文件");
    if (!verdict.pass) { out.pass = false; out.code = verdict.code; out.reason = verdict.reason; out.items = verdict.items; return out; }
    out.reason = "通过（交付文件 " + art.chars + " 字）";
    return out;
  }

  /* ── 通道 B（默认）：成员在回复里交正文，Host 按契约代写落盘 ────────────
   * 为什么需要这条通道：实测发现**成员并没有写文件的工具**（write_result 是
   * Gmail 的 MCP 工具，不是通用写文件能力）⇒ 角色 prompt 里「写入 xxx.md」
   * 这句话成员根本兑现不了 ⇒ 它唯一能交的是回复文本 ⇒ 而 prompt 又让它
   * 「只汇报路径和条数」⇒ Host 把汇报当交付落盘 ⇒ 882 字节的转述。
   * ⇒ 于是把「写文件」这件事从成员身上挪回 Host：成员交**正文**，Host 落盘。 */
  if (!text.length) {
    out.pass = false;
    out.code = "empty";
    out.reason = "这一棒没有交出任何内容";
    return out;
  }
  if (looksLikeNarration(text)) {
    out.pass = false;
    out.code = "narration_only";
    out.reason = "这一棒只交了转述（" + clip(text, 40) + "），没有交成果本身";
    return out;
  }
  const verdict = checkContentRules(text, rules, "交付内容");
  if (!verdict.pass) { out.pass = false; out.code = verdict.code; out.reason = verdict.reason; out.items = verdict.items; return out; }
  out.content = text;
  out.reason = "通过（正文 " + text.length + " 字）";
  return out;
}

/** 内容规则（长度 / 条目数 / 必含）—— 两种通道共用一份判据。 */
function checkContentRules(content, rules, what) {
  const text = String(content || "");
  const chars = text.trim().length;
  const r = rules || {};
  if (r.min_chars && chars < Number(r.min_chars)) {
    return { pass: false, code: "too_short", reason: what + "太短（" + chars + " 字，要求 ≥ " + r.min_chars + " 字）" };
  }
  let items = 0;
  if (r.min_items || r.max_items) items = countDeliverableItems(text);
  if (r.min_items && items < Number(r.min_items)) {
    return { pass: false, code: "too_few_items", items, reason: what + "条目太少（" + items + " 条，要求 ≥ " + r.min_items + " 条）" };
  }
  if (r.max_items && items > Number(r.max_items)) {
    return { pass: false, code: "too_many_items", items, reason: what + "条目超了（" + items + " 条，上限 " + r.max_items + " 条）" };
  }
  for (const need of (r.must_include || [])) {
    if (!text.includes(String(need))) {
      return { pass: false, code: "missing_content", items, reason: what + "里缺少「" + String(need) + "」" };
    }
  }
  /* must_include_sections：**必含的段落**（不只是必含的词）。
   * 为什么要有它：`must_include: ["来源"]` 只要正文出现「来源」两个字就过 ——
   * 实测「只写『来源』二字 + 200 字废话」能过验收。
   * 而岗位 prompt 写的是「【固定交付】…包含：可发布候选版本、改动说明、
   * 风险标记、仍需人工确认、原始来源清单」—— 这些是**要交付的段落**，
   * 成员只交了「审校意见」正文，5 项一项都没有，契约却判过。
   * ⇒ 规则要能表达「这一节必须有实质内容」。
   * 写法：["可发布候选版本", {"label":"改动说明","min_chars":30}, ...]
   *   - 字符串 ⇒ 该小节必须有实质内容（默认至少 20 字）
   *   - 对象   ⇒ 可指定 label 与 min_chars
   */
  const sections = Array.isArray(r.must_include_sections) ? r.must_include_sections : [];
  if (sections.length) {
    const labels = sections.map((x) => (typeof x === "string" ? x : String((x || {}).label || "")));
    for (const spec of sections) {
      const label = typeof spec === "string" ? spec : String((spec || {}).label || "");
      if (!label) continue;
      const need = typeof spec === "string" ? 20 : Math.max(0, Number((spec || {}).min_chars || 20));
      const body = extractSectionBody(text, label, labels);
      if (!body) {
        return { pass: false, code: "missing_section", items,
          reason: what + "里没有「" + label + "」这一节 —— 岗位要求的固定交付缺了" };
      }
      /* 只算标题外的实质内容：把标题行本身去掉再数 */
      const bodyLines = body.split(/\r?\n/);
      const contentChars = bodyLines.slice(1).join("").replace(/\s+/g, "").length;
      if (contentChars < need) {
        return { pass: false, code: "empty_section", items,
          reason: what + "里「" + label + "」这一节只有标题没有内容（正文 " + contentChars +
            " 字，要求 ≥ " + need + " 字）—— 交了标题不算交付" };
      }
    }
  }
  /* URL 计数（批次 6）：`must_include: ["http"]` 是**子串**匹配 ——
   * 正文里出现「http」就算过 ⇒ 模型只要贴一个**编造的**链接就能过验收。
   * 真实场景里这等于「产品在奖励编造来源」：情报侦察员搜不到、或者干脆
   * 不想搜的时候，编一条 URL 反而比如实说「没搜到」更容易过关。
   * ⇒ 要链接就用 min_urls 数**完整 URL**（http(s)://…），不含裸词。
   * 注意：min_urls 只保证「有像样的链接」，**不保证链接是真的** ——
   *   「链接是真的」要靠成员自己 web_fetch 核验 + 用户抽检，不在验收里假装。 */
  if (r.min_urls) {
    const urls = countDeliverableUrls(text);
    if (urls < Number(r.min_urls)) {
      return {
        pass: false, code: "too_few_urls", items, urls,
        reason: what + "里只有 " + urls + " 条完整链接（要求 ≥ " + Number(r.min_urls) +
          " 条）—— 贴一个编的链接不算数，要真的来源",
      };
    }
  }
  /* unique_urls：去重后计数 —— 否则同一个链接写 4 次就满足 min_urls:4。
   * 「来源清单」里重复贴同一条链接是最常见的凑数手法。 */
  if (r.unique_urls) {
    const uniq = countDeliverableUrls(text, { unique: true });
    if (uniq < Number(r.unique_urls)) {
      return {
        pass: false, code: "too_few_unique_urls", items, urls: uniq,
        reason: what + "里只有 " + uniq + " 条**不重复**的链接（要求 ≥ " + Number(r.unique_urls) +
          " 条）—— 同一个链接重复贴不算数",
      };
    }
  }
  /* no_broken_urls：正文里有坏链（全角括号/中文混进 URL）⇒ 判红。
   * 为什么要有这条：`min_urls` 只数「像样的链接」，而**中文散文里的链接
   * 往往全是坏的**（实测真实产物：4 个 token 全部含全角 `）` 或中文）。
   * 不查坏链的话，验收就是在**奖励脏链接**。 */
  if (r.no_broken_urls) {
    const broken = findBrokenUrls(text);
    if (broken.length) {
      return {
        pass: false, code: "broken_urls", items, urls: broken.length,
        reason: what + "里有 " + broken.length + " 条坏链接（" +
          (broken[0].why || "链接格式坏了") + "）—— 来源要写成一行一个、URL 只出现一次",
      };
    }
  }
  return { pass: true, code: "ok", items };
}

/** 从任务/房间/成员三处挑出这一棒该用的契约。 */
function pickStageContract(input) {
  const o = input || {};
  const hop = Number(o.hop || 0);
  const bot = o.bot || {};
  const contracts = [];
  if (o.contract) contracts.push(o.contract);
  if (o.roomContract) contracts.push(o.roomContract);
  if (bot && bot.deliverable) contracts.push({ deliverable: bot.deliverable });
  for (const c of contracts) {
    if (!c) continue;
    const stages = Array.isArray(c.stages) ? c.stages : null;
    if (stages) {
      for (const st of stages) {
        if (!st) continue;
        const m = st.match || {};
        const hitName = m.name && String(m.name) === String(bot.name || "");
        const hitId = m.bot_id && String(m.bot_id) === String(bot.id || "");
        const hitJob = m.job && String(m.job) === String(bot.job || "");
        const hitHop = Number.isFinite(Number(m.hop)) && Number(m.hop) === hop;
        if (hitName || hitId || hitJob || hitHop) {
          return Object.assign({}, st, { rules: st.rules || c.rules || {} });
        }
      }
      continue;
    }
    const d = c.deliverable || c;
    if (d && (d.path || d.dir)) return Object.assign({}, d, { rules: d.rules || c.rules || {} });
  }
  return null;
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
  pickPipelineOrder,
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
  judgeStage,
  pickStageContract,
  readDeliverableArtifact,
  resolveDeliverablePath,
  countDeliverableItems,
  countDeliverableUrls,
  extractUrlTokens,
  findBrokenUrls,
  extractSectionBody,
  resolvePublishTargets,
  extractPublishBody,
  collectSectionLabels,
  judgeCrossStage,
  extractPercentages,
  extractCleanUrls,
  applyRevisionLoop,
  replaceSectionBody,
  readPublishedHistory,
  looksLikeNarration,
  createTeamBudget,
  createCancelScope,
  sanitizeBoardKey,
  clip,
};
