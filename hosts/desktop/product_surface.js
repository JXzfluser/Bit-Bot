"use strict";

/**
 * Product Surface — Wave G Host data layer
 * CommonJS module, no Electron dependency.
 * API aligned with main.js/preload.js expectations.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const roomOrchestrator = require("./room_orchestrator");
const eventMirror = require("./event_mirror_ref").loadEventMirror();
const eventReadModel = require("./event_mirror_ref").loadEventReadModel();

function createProductSurface(repoRoot, opts = {}) {
  const REPO_ROOT = path.resolve(repoRoot);
  /* User data (rooms / bots / sessions / memory / routines) lives outside the
     code tree: a packaged app's tree is a read-only bundle that gets replaced
     on upgrade. Dev keeps the historical <repo>/data layout. */
  const DATA_ROOT = opts.dataRoot ? path.resolve(opts.dataRoot) : path.join(REPO_ROOT, "data");
  const DESKTOP_DIR = path.join(DATA_ROOT, "desktop");
  const BOTS_PATH = path.join(DESKTOP_DIR, "bots.json");
  const APPROVAL_RULES_PATH = path.join(DESKTOP_DIR, "approval-rules.json");
  const PENDING_APPROVALS_PATH = path.join(DESKTOP_DIR, "pending-approvals.jsonl");
  const APPROVALS_LOG_PATH = path.join(DESKTOP_DIR, "approvals.log.jsonl");
  const SETTINGS_PATH = path.join(DESKTOP_DIR, "settings.json");
  const COMPUTER_PATH = path.join(DESKTOP_DIR, "computer.json");
  const LLM_USAGE_PATH = path.join(DESKTOP_DIR, "llm-usage.json");
  const ROOMS_PATH = path.join(DESKTOP_DIR, "rooms.json");
  /* sessions.json 没有本地路径常量了：这张面只有一个写者（sessions store），
     谁想读写它都得经过上面那个 store 句柄 —— 见 §8.123 / G-122 的 SW-02 棘轮。 */
  const MEMORY_DIR = path.join(DATA_ROOT, "memory");
  const MEMORY_STORE_PATH = path.join(MEMORY_DIR, "desktop-host.json");
  const PROFILE_VAULT_PATH = path.join(MEMORY_DIR, "profile-vault.json");
  const ACCOUNT_PROFILE_PATH = path.join(DESKTOP_DIR, "account-profile.json");
  const ROUTINES_DIR = path.join(DATA_ROOT, "routines");
  const WORKSPACE_UPLOADS_DIR = path.join(DATA_ROOT, "workspace", "uploads");
  const VOICE_DIR = path.join(DESKTOP_DIR, "voice");
  const FRAMES_DIR = path.join(DESKTOP_DIR, "frames");
  // 共享任务板（群编排的共享工作区）：与内核 section store 同一目录/同一格式，
  // key 统一成 room id —— 内核写的 section_post，成员下一轮能在 prompt 里读到。
  const roomBoard = roomOrchestrator.createRoomBoard(REPO_ROOT, { dataRoot: DATA_ROOT });

  /* KP-09 片1：sessions.json 这张面的读写都从这里出去。
     main.js 把它自己那个实例注进来（同一个进程里两个实例交替 load/save 就是
     grok_import.js 注释里点名要避免的那种丢更新）；没注入时按同一 dataRoot
     取进程内缓存的那一个。Box 若没打包到 sessions 模块则为 null，调用点必须
     说出口而不是假装做成。 */
  const sessionsStore = (() => {
    if (opts.sessions) return opts.sessions;
    try {
      return require("./sessions").getSessionStore(REPO_ROOT, { dataRoot: DATA_ROOT });
    } catch (_) {
      return null;
    }
  })();

  // Atomic write helper: tmp + rename
  /* T1-03 双写旁路：只有 sessions.json / rooms.json / pending-approvals.jsonl
     这三个面会派事件，其它路径在 capture() 里就被过滤掉。默认关；开着时镜像
     失败也只是少几条事件，rename 的结果一个字节都不变。 */
  const mirror = () => eventMirror.getSharedMirror(DATA_ROOT);

  /* ===== T1-05 EVENT_ONLY（BITBOT_EVENT_ONLY=1）=====
     三张面（sessions/rooms/approvals）的 JSON 不再被写：diff 的左半边从
     「盘上文件」换成「内存里最后一次读到的状态文本」（lastTextBySurface，
     读点负责刷新）。非三张面的文件（bots/settings/rules/approvals.log）
     照常落盘——它们不在事件日志的范围里（docs/events.md §7）。
     写失败不吞：EVENT_ONLY 下事件库是唯一真源，吞掉就是静默丢数据。 */
  const eventOnlyMode = () => process.env.BITBOT_EVENT_ONLY === "1";
  const lastTextBySurface = new Map();
  const setLastTextFor = (p, t) => lastTextBySurface.set(path.resolve(p), t);
  const eventOnlySaid = new Set();
  function sayOnce(key, line) {
    if (eventOnlySaid.has(key)) return;
    eventOnlySaid.add(key);
    process.stderr.write(line);
  }

  /** 面状态的规范文本（读模型 / 文件两个来源都要落到同一种形状）。 */
  function canonicalTextFor(surface, hit) {
    if (surface === "approvals") {
      const lines = (hit.approvals || []).map((e) => JSON.stringify(e));
      return lines.length ? lines.join("\n") + "\n" : "";
    }
    const obj = surface === "rooms" ? hit.rooms : hit.sessions;
    return JSON.stringify(obj, null, 2);
  }

  /** 内存缓存没有时的兜底：从读模型现算规范文本（防「没读先写」）；库没账则 null。 */
  function prevTextFor(filePath, def) {
    const hit = eventReadModel.readSurfaces(DATA_ROOT);
    if (hit.ok && !hit.anomalies.length && hit.count > 0) {
      const canonical = canonicalTextFor(def.surface, hit);
      setLastTextFor(filePath, canonical);
      return canonical;
    }
    return null;
  }

  /** 这张面在事件库里是不是还没有账（fold == BASELINE）。
      delta diff 只记增量——基底从没进过库时直接落 delta 会让顺序事件指向
      幽灵实体，所以「面空 + 手上有遗留文本」的首次写必须先导基底。 */
  function surfaceEmptyInDb(hit, surface) {
    if (!hit.ok || hit.anomalies.length) return true; // 库不可用/折不动：按没账处理
    if (surface === "approvals") return (hit.approvals || []).length === 0;
    const baseline = surface === "rooms"
      ? { version: 1, rooms: [] }
      : { version: 1, active_id: "", sessions: [] };
    return JSON.stringify(hit[surface]) === JSON.stringify(baseline);
  }

  /** EVENT_ONLY 的统一落库口：基底（需要时从 BASELINE 导入）+ delta，全程不碰文件。
      prevText 由调用方给用时**必须**用它，不能再自己读一遍：next 是从调用方那一刻的
      prev 拼出来的，这里重读会读到**比 next 更新**的状态——别的进程刚提交的行在 prev
      里有、在 next 里没有，diff 就派一串 entity_removed 把别人的行从唯一真源里删掉。
      实测（3 进程 × 12 条审批冷启同一个新库）：20 轮里 3 轮丢 1~6 行，子进程零报错，
      events 表里多出没人发起过的删除。KP-09 片3。 */
  function eventOnlyWrite(filePath, def, nextText, prevText) {
    const m = mirror();
    let prev = prevText === undefined ? lastTextBySurface.get(path.resolve(filePath)) : prevText;
    if (prev == null) prev = prevTextFor(filePath, def);
    if (prev != null && surfaceEmptyInDb(eventReadModel.readSurfaces(DATA_ROOT), def.surface)) {
      m.commitText(def, null, prev); // 基底导入（与导入脚本同一语义）
    }
    m.commitText(def, prev, nextText);
    setLastTextFor(filePath, nextText);
  }

  function atomicWrite(filePath, data) {
    const def = eventOnlyMode() ? eventMirror.surfaceOf(filePath) : null;
    if (def) {
      eventOnlyWrite(filePath, def, data);
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // tmp 名必须**进程内也唯一**（KP-09 片3）：只带 Date.now() 时，同一毫秒里两个
    // 进程（桌面主进程 + 定时守护 run_turn.js）给同一张面算出同一个 tmp 名，
    // 先 rename 的那家把文件搬走，后一家 renameSync 就 ENOENT —— 用户那次
    // 「建 Bot / 建群」整个抛错。实测 3 进程冷启：2/3 挂。
    const tmp = filePath + ".tmp." + process.pid + "." + Date.now() + "." + Math.random().toString(36).slice(2, 8);
    const m = mirror();
    const token = m.capture(filePath);
    /* 写失败不许把 tmp 留在盘上，更不许把错吞掉（KP-09 片8，与会话面 writeStore 同形）：
       吞掉就是「ok:true 但盘上还是陈旧的」，留在盘上就是每次崩都攒一个垃圾。 */
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, filePath);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* 清不掉只是多一个垃圾 */ }
      throw err;
    }
    m.commit(filePath, token, data);
  }

  function readJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return fallback;
    }
  }

  /* ===== store 形状的面（bots.json）的读法：坏文件不许演成「一个都没有」 =====
     KP-09 片8。readJson 有 15 处调用（settings / 缓存 / memory 都在里面），
     那里「读不到就用默认值」是正当的降级；但 Bot 面不是默认值能盖住的：
     实测把 bots.json 截一半（1251→625 字节），loadBots 拿到 null 就当
     「一个 Bot 都没有」，用内建 Bot 起步并紧接着 saveBots 把坏字节整份覆盖 ——
     用户的 Bot 连手工救的余地都没了，侧栏只说没有 Bot，botDetail 报的是
     bot_not_found（错误的诊断），stderr 一个字节都没有。
     改法与会话面片7 逐字同形：先把字节改名留住（.corrupt-<时间戳>）、说一句，
     再交回 fallback 让内建 Bot 起步 —— 顺序不能反，反了下一次写就把证据盖掉。
     群面（rooms.json）不在这条路上：它的写侧早已 fail closed（requireWritableRooms
     直接抛，坏字节留在原文件里，GP-164 P8 钉的就是「原文件还在原路径」），
     给它做隔离反而会把那条门自己踩掉，所以群面只补「读侧要说话」那半条。 */
  function readFaceJson(filePath, rowsKey, fallback) {
    if (!fs.existsSync(filePath)) {
      pruneOrphanFaceTmp(filePath);
      return fallback;
    }
    let text = null;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (_) {
      return fallback; // 连字节都读不出（权限/只读盘）时不动证据
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed[rowsKey])) {
      quarantineFaceFile(filePath, rowsKey);
      pruneOrphanFaceTmp(filePath);
      return fallback;
    }
    pruneOrphanFaceTmp(filePath);
    return parsed;
  }

  function quarantineFaceFile(filePath, rowsKey) {
    const at = new Date().toISOString().replace(/[:.]/g, "-");
    const keep = filePath + ".corrupt-" + at;
    let how = "";
    try {
      fs.renameSync(filePath, keep);
      how = "已改名留成 " + keep;
    } catch (_) {
      try {
        fs.copyFileSync(filePath, keep);
        how = "已另存一份到 " + keep;
      } catch (_) {
        how = "没能另存（原文件仍在那里，但这次读不出来）";
      }
    }
    const face = path.basename(filePath);
    sayOnce("corrupt-" + keep,
      `[bots] ${filePath} 不是合法的 Bot 面 JSON（多半是写一半失败留下的）——原始字节${how}；` +
      `本次从内建 Bot 起步，这不是「你没有 Bot」（${rowsKey} 里那些行还在那些字节里），请手工检查那份文件。\n`);
    return keep;
  }

  /* 崩在 write 与 rename 之间的进程来不及清理自己那个 tmp（片8 之前 atomicWrite
     连清理都没有：写失败直接把 tmp 留在面旁边）。pid 不在了 + 老于 60s 才清 ——
     别的活着的进程可能正在写它自己那个 tmp。 */
  function pruneOrphanFaceTmp(filePath) {
    let names = [];
    try {
      names = fs.readdirSync(path.dirname(filePath))
        .filter((f) => f.startsWith(path.basename(filePath) + ".tmp."));
    } catch (_) {
      return;
    }
    const now = Date.now();
    for (const f of names) {
      const pid = Number(String(f).split(".")[3]);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      if (isPidAlive(pid)) continue;
      const full = path.join(path.dirname(filePath), f);
      try {
        if (now - fs.statSync(full).mtimeMs < 60000) continue;
        fs.rmSync(full, { force: true });
      } catch (_) { /* 清不掉只是磁盘上多一个垃圾，不影响这次开面 */ }
    }
  }

  function isPidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return String((e && e.code) || "") === "EPERM"; }
  }

  function appendJsonl(filePath, entry) {
    const def = eventOnlyMode() ? eventMirror.surfaceOf(filePath) : null;
    if (def) {
      // approvals 面：追加 = 旧文本 + 一行。prev 与落库语义同 atomicWrite。
      let prev = lastTextBySurface.get(path.resolve(filePath));
      if (prev == null) {
        const hit = eventReadModel.readSurfaces(DATA_ROOT);
        prev = hit.ok && !hit.anomalies.length && hit.count > 0 ? canonicalTextFor("approvals", hit) : "";
      }
      const next = (prev || "") + JSON.stringify(entry) + "\n";
      eventOnlyWrite(filePath, def, next, prev);
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const m = mirror();
    const token = m.capture(filePath);
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
    m.commit(filePath, token, null);
  }

  function generateBotId() {
    return "bot-" + Math.random().toString(16).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // ===== BOTS STORE =====
  function builtinAgentBit(now) {
    return {
      id: "agent-bit",
      name: "Bit Bot",
      job: "通用助手",
      description: "Bit Bot 默认智能体",
      avatar: "",
      hidden: false,
      pinned: true,
      created_at: now,
      updated_at: now,
    };
  }

  /* bots.json 的读-改-写基底：本次 loadBots 交给调用方的那份快照，落盘时用来
     分辨「我删掉的」和「别的进程刚加的」。见 saveBots / mergeBotsAgainstDisk。 */
  let botsBaseText = null;

  function loadBots() {
    // Missing file AND a half-written file (bots present, builtin row absent)
    // both have to come back with agent-bit. G-1b / G-6 / G-26 address that
    // id directly; seeding only when the file is absent leaves the row out
    // as soon as anything else creates bots.json first.
    let data = readFaceJson(BOTS_PATH, "bots", null);
    botsBaseText = data ? JSON.stringify(data) : null;
    let dirty = false;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      data = { version: 1, primary_id: "agent-bit", bots: [] };
      dirty = true;
    }
    if (!Array.isArray(data.bots)) {
      data.bots = [];
      dirty = true;
    }
    if (!data.bots.some((b) => b && b.id === "agent-bit")) {
      data.bots.unshift(builtinAgentBit(nowIso()));
      dirty = true;
    }
    if (!data.primary_id) {
      data.primary_id = "agent-bit";
      dirty = true;
    }
    if (!data.version) {
      data.version = 1;
      dirty = true;
    }
    if (dirty) saveBots(data);
    return data;
  }

  /* bots.json 不是事件面（docs/events.md §7 只收了 sessions/rooms/approvals），
     所以它一度是跨进程「最后写者赢」：3 个进程各建 2 个 Bot，盘上只剩 3 个
     （内建 + 最后那个进程的），另外两个进程紧接着用自己的 Bot 建群就被
     roomCreate 点名 names_not_found —— 用户看到的是「Bot 建好了，群建不起来」。
     写侧改成按 id 三方合并：基底 = 本次 loadBots 读到的那份，ours = 调用方这份，
     disk = 盘上当前。我没改过的行用盘上更新的，我删掉的才删；别人新加的留着，
     别人删掉的我不复活（SW-20 的交错尺子把这三条各钉了一遍）。
     primary_id 仍是单个标量，按调用方落（多进程同时改主 Bot 不在这一片的范围里）。 */
  function saveBots(data) {
    withFaceLock(BOTS_PATH, () => atomicWrite(BOTS_PATH, JSON.stringify(mergeBotsAgainstDisk(data), null, 2)));
  }

  /* 合并要读盘，读盘和写盘之间不能被别人插进来 —— 否则两个进程读到同一份基底，
     各自把自己那份写回去，合并照样丢。锁是 mkdir 原子创建，拿不到就短轮询；
     持有者进程已死或锁超过 5s 视为陈旧并接管。超时后不阻塞用户：退回无锁写。
     拿不到锁的**原因**决定下一步：只有 EEXIST（真有人持着）才等，其它失败
     （面目录还不存在、只读盘、权限）直接退回无锁写 —— 第一版在这里写了个
     `catch { continue; }`，把「data/desktop 目录还没建」的首次落盘变成 100% CPU
     的死循环，由 SW-18 那把带墙钟的尺子抓出来。
     锁按面分开（bots.json.lock / rooms.json.lock）：两张面的合并互不阻塞，
     也不会有嵌套持锁 —— 写侧只在真正落盘那一小段里持锁。 */
  function withFaceLock(facePath, fn) {
    const lock = facePath + ".lock";
    const deadline = Date.now() + 5000;
    let held = false;
    try { fs.mkdirSync(path.dirname(facePath), { recursive: true }); } catch (_) { /* 建不出来就让写盘自己报错 */ }
    while (!held) {
      let lockErr = null;
      try { fs.mkdirSync(lock); held = true; } catch (err) { lockErr = err; }
      if (held) { try { fs.writeFileSync(path.join(lock, "pid"), String(process.pid)); } catch (_) { /* 只是取证信息 */ } break; }
      if (!lockErr || lockErr.code !== "EEXIST") break;
      let ageMs = Infinity, owner = 0;
      try {
        ageMs = Date.now() - fs.statSync(lock).mtimeMs;
        owner = Number(fs.readFileSync(path.join(lock, "pid"), "utf8")) || 0;
      } catch (_) { /* 锁刚被释放：按陈旧算，下一轮重试 mkdir */ }
      let ownerAlive = true;
      if (owner && owner !== process.pid) { try { process.kill(owner, 0); } catch (_) { ownerAlive = false; } }
      if (ageMs > 5000 || !ownerAlive) { try { fs.rmSync(lock, { recursive: true, force: true }); } catch (_) { /* 别人先接管了 */ } continue; }
      if (Date.now() > deadline) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    try { return fn(); } finally {
      if (held) { try { fs.rmSync(lock, { recursive: true, force: true }); } catch (_) { /* 已被陈旧接管清掉 */ } }
    }
  }

  function mergeBotsAgainstDisk(data) {
    if (!data || !Array.isArray(data.bots)) return data;
    let disk = null;
    try { disk = JSON.parse(fs.readFileSync(BOTS_PATH, "utf8")); } catch (_) { return data; }
    if (!disk || !Array.isArray(disk.bots)) return data;
    // 基底 = 本次 loadBots 读到的那份。null 不是「没有基底」而是「我读的时候盘上
    // 没有可解析的一份」——那时任何一行都不可能是我删的，全部按别人的新增留着。
    let baseBots = new Map();
    if (botsBaseText) {
      let base = null;
      try { base = JSON.parse(botsBaseText); } catch (_) { return data; }
      baseBots = new Map(((base && base.bots) || []).filter((b) => b && b.id).map((b) => [b.id, b]));
    }
    const mine = new Map(data.bots.filter((b) => b && b.id).map((b) => [b.id, b]));
    const merged = [];
    const seen = new Set();
    for (const d of disk.bots) {
      if (!d || !d.id) continue;
      seen.add(d.id);
      const m = mine.get(d.id);
      if (!m) {
        // 我没写回去：基底里有 = 我删的；基底里没有 = 别的进程刚加的，不归我删。
        if (!baseBots.has(d.id)) merged.push(d);
        continue;
      }
      const b = baseBots.get(d.id);
      merged.push(b && JSON.stringify(b) === JSON.stringify(m) ? d : m);
    }
    for (const m of data.bots) {
      if (!m || !m.id || seen.has(m.id)) continue;
      /* 我这轮带了这行、盘上却没有：基底里有 = 别的写者把它删了，我不许把它复活
         （SW-20 的确定性交错实测到「A 删掉的 Bot 被 B 紧接着的整份写带回侧栏」）；
         基底里没有 = 我这轮新建的，留着。 */
      if (baseBots.has(m.id)) continue;
      merged.push(m);
    }
    return { ...data, bots: merged };
  }

  /* §2.2 tags: comma-separated in the product phrase, stored as a small array.
     "-" is the explicit "clear tags" signal (an empty value cannot be sent
     through key=value phrases without reading as "unchanged"). */
  function normalizeTags(value) {
    if (Array.isArray(value)) {
      return value.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 8);
    }
    const raw = String(value == null ? "" : value).trim();
    if (raw === "-" || raw === "") return [];
    return raw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8);
  }

  /* G-28 · Bot 分组（Grok Bot 的侧栏把 Bot 按分组折叠，右侧显示数量）。
     分组只是**展示归属**，不是产品策略：不参与权限、审批、记忆与回合路由，
     所以它和 settings 一样由 Host 存储直写，不走 kernel 意图链。
     空字符串 = 未分组（侧栏渲染成「未分组」一节）。 */
  function normalizeGroup(value) {
    const raw = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    if (raw === "-") return "";
    return raw.slice(0, 24);
  }

  /* §2.2 avatar: a stored path is displayed as a data URL so the renderer never
     needs file:// access. Unreadable / oversized files are simply not shown. */
  function avatarDataUrl(bot) {
    const p = String((bot && bot.avatar) || "").trim();
    if (!p) return "";
    try {
      const abs = path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 512 * 1024) return "";
      const ext = path.extname(abs).toLowerCase();
      const mime =
        ext === ".png" ? "image/png"
          : ext === ".webp" ? "image/webp"
            : ext === ".gif" ? "image/gif"
              : "image/jpeg";
      return "data:" + mime + ";base64," + fs.readFileSync(abs).toString("base64");
    } catch (_) {
      return "";
    }
  }

  function botsCreate({ name, job, description, group }) {
    const data = loadBots();
    const bot = {
      id: generateBotId(),
      // §2.3: a skipped name still yields the official "New Bot" placeholder.
      name: String(name || "").trim() || "New Bot",
      job: String(job || "").trim(),
      description: String(description || "").trim(),
      group: normalizeGroup(group),
      avatar: "",
      tags: [],
      hidden: false,
      pinned: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    data.bots.push(bot);
    saveBots(data);
    return {
      ok: true,
      mode: "host_bot_create",
      pretend_saved: false,
      bot
    };
  }

  function botsUpdate({ bot_id, name, job, description, avatar, tags, group }) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_bot_update" };
    }

    // Validate avatar if provided. "-" clears the avatar; empty/undefined
    // means "leave unchanged" (the kernel omits the field in that case).
    if (avatar !== undefined && avatar !== null && avatar !== "") {
      if (avatar === "-") {
        bot.avatar = "";
      } else {
        const avatarPath = path.isAbsolute(avatar) ? avatar : path.join(REPO_ROOT, avatar);
        if (!fs.existsSync(avatarPath)) {
          return { ok: false, error: "invalid_avatar", mode: "host_bot_update" };
        }
        bot.avatar = avatar;
      }
    }

    if (tags !== undefined) bot.tags = normalizeTags(tags);
    // G-28: 分组走 "-"=清空 / 未提供=不变 的同一约定（kernel 省略字段时不动）。
    if (group !== undefined) bot.group = normalizeGroup(group);
    if (name !== undefined) bot.name = String(name || "").trim() || bot.name;
    if (job !== undefined) bot.job = String(job || "").trim();
    if (description !== undefined) bot.description = String(description || "").trim();
    bot.updated_at = nowIso();

    saveBots(data);
    return {
      ok: true,
      mode: "host_bot_update",
      pretend_saved: false,
      bot
    };
  }

  /* G-28 · 分组直写通道（渲染器右键菜单「移动到分组」）。分组是展示偏好，
     不经过 kernel 意图链——与 settings 一样的存储级 UI 状态。 */
  function botsSetGroup({ bot_id, group }) {
    const id = String(bot_id || "").trim();
    if (!id) return { ok: false, error: "bot_not_found", mode: "host_bot_group" };
    const data = loadBots();
    const bot = data.bots.find(b => b && b.id === id);
    if (!bot) return { ok: false, error: "bot_not_found", mode: "host_bot_group" };
    bot.group = normalizeGroup(group);
    bot.updated_at = nowIso();
    saveBots(data);
    const visible = (data.bots || []).filter(b => b && !b.hidden);
    const hidden = (data.bots || []).filter(b => b && b.hidden);
    return {
      ok: true,
      mode: "host_bot_group",
      pretend_saved: false,
      bot: decorateBot(bot),
      bots: visible.map(decorateBot),
      hidden_bots: hidden.map(decorateBot),
      primary_id: data.primary_id || (visible[0] && visible[0].id) || ""
    };
  }

  function botsDuplicate(bot_id) {
    const data = loadBots();
    const source = data.bots.find(b => b.id === bot_id);
    if (!source) {
      return { ok: false, error: "bot_not_found", mode: "host_bot_duplicate" };
    }
    // Generate unique name: "<name> copy", "<name> copy 2", etc.
    let baseName = source.name;
    let newName = baseName + " copy";
    let counter = 2;
    while (data.bots.some(b => b.name === newName)) {
      newName = baseName + " copy " + counter;
      counter++;
    }

    const duplicate = {
      id: generateBotId(),
      name: newName,
      job: source.job,
      description: source.description,
      avatar: source.avatar,
      tags: Array.isArray(source.tags) ? source.tags.slice() : [],
      hidden: false,
      pinned: false,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    data.bots.push(duplicate);
    saveBots(data);

    return {
      ok: true,
      mode: "host_bot_duplicate",
      pretend_saved: false,
      bot: duplicate
    };
  }

  function botsPin(bot_id, pinned) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_bot_pin" };
    }
    bot.pinned = Boolean(pinned);
    bot.updated_at = nowIso();
    saveBots(data);
    return {
      ok: true,
      mode: "host_bot_pin",
      pretend_saved: false,
      bot
    };
  }

  function botsSetPrimary(bot_id) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_bot_set_primary" };
    }
    data.primary_id = bot_id;
    saveBots(data);
    return {
      ok: true,
      mode: "host_bot_set_primary",
      pretend_saved: false,
      primary_id: bot_id
    };
  }

  function botsHide(bot_id) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_hide_bot" };
    }
    bot.hidden = true;
    bot.updated_at = nowIso();
    saveBots(data);
    return {
      ok: true,
      mode: "host_hide_bot",
      pretend_saved: false,
      bot
    };
  }

  function botsUnhide(bot_id) {
    const data = loadBots();
    const bot = data.bots.find(b => b.id === bot_id);
    if (!bot) {
      return { ok: false, error: "bot_not_found", mode: "host_unhide_bot" };
    }
    bot.hidden = false;
    bot.updated_at = nowIso();
    saveBots(data);
    return {
      ok: true,
      mode: "host_unhide_bot",
      pretend_saved: false,
      bot
    };
  }

  /* GP-114: drop one Bot's memory slot from both memory files (store + vault),
     leaving every other Bot's slot untouched. Never throws: a missing or
     malformed store must not block the delete cascade. */
  function dropBotMemorySlot(botId) {
    const id = String(botId || "").trim();
    if (!id) return { dropped: false };
    let storeDropped = false;
    let vaultDropped = false;
    try {
      const store = readJson(MEMORY_STORE_PATH, null);
      if (store && store.bots && store.bots[id]) {
        delete store.bots[id];
        atomicWrite(MEMORY_STORE_PATH, JSON.stringify(store, null, 2));
        storeDropped = true;
      }
    } catch (_) { /* memory store missing or malformed, skip */ }
    try {
      const vault = readJson(PROFILE_VAULT_PATH, null);
      if (vault && vault.bots && vault.bots[id]) {
        delete vault.bots[id];
        atomicWrite(PROFILE_VAULT_PATH, JSON.stringify(vault, null, 2));
        vaultDropped = true;
      }
    } catch (_) { /* profile vault missing or malformed, skip */ }
    return { dropped: storeDropped || vaultDropped, store: storeDropped, vault: vaultDropped };
  }

  function botsDelete(bot_id, confirm) {
    if (confirm !== "yes") {
      return {
        ok: false,
        needs_confirm: true,
        advise_hide_first: true,
        bot_id,
        mode: "host_delete_bot"
      };
    }

    const data = loadBots();
    const botIndex = data.bots.findIndex(b => b.id === bot_id);
    if (botIndex === -1) {
      return { ok: false, error: "bot_not_found", mode: "host_delete_bot" };
    }

    // Never delete agent-bit
    if (bot_id === "agent-bit") {
      return { ok: false, error: "cannot_delete_builtin", mode: "host_delete_bot" };
    }

    const bot = data.bots[botIndex];
    data.bots.splice(botIndex, 1);
    let primaryReassigned = false;
    if (data.primary_id === bot_id) {
      data.primary_id = "agent-bit";
      primaryReassigned = true;
    }
    saveBots(data);

    // GP-07: routines bound to this bot must stop firing. The daemon sweeps
    // data/routines/host-routines.json, so remove bound rows *there* (plus
    // schedule artifacts), not just per-bot files under ROUTINES_DIR.
    let routines_deleted = 0;
    const ROUTINES_JSON_PATH = path.join(ROUTINES_DIR, "host-routines.json");
    try {
      const rows = readJson(ROUTINES_JSON_PATH, null);
      if (Array.isArray(rows)) {
        const bound = (r) =>
          r &&
          (String(r.id || "").includes(bot_id) ||
            String(r.prompt || "").includes(bot_id));
        const kept = rows.filter((r) => !bound(r));
        routines_deleted += rows.length - kept.length;
        if (kept.length !== rows.length) {
          atomicWrite(ROUTINES_JSON_PATH, JSON.stringify(kept, null, 2));
        }
      }
    } catch {
      // routines store missing or malformed, skip
    }
    try {
      if (fs.existsSync(ROUTINES_DIR)) {
        const files = fs.readdirSync(ROUTINES_DIR);
        for (const file of files) {
          if (!/^(schedule|list)-.*\.json$/.test(file)) continue;
          const filePath = path.join(ROUTINES_DIR, file);
          try {
            const content = fs.readFileSync(filePath, "utf8");
            if (content.includes(`owner=${bot_id}`) || file.includes(bot_id) ||
              (JSON.parse(content).prompt || "").includes(bot_id)) {
              fs.unlinkSync(filePath);
              routines_deleted++;
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } catch {
      // routines dir missing, skip
    }

    /* GP-07: cascade sessions —— KP-09 片1 把这段收进唯一的写者。
       以前它自己 readJson(SESSIONS_PATH) + atomicWrite(SESSIONS_PATH)，于是这张面
       有两个写者；更坏的是 EVENT_ONLY 下 JSON 不再是真源，这条读的是永远陈旧的
       文件，实测（临时 dataRoot、真代码路径）删 Bot 后 sessions_deleted=0、
       sessions_cascaded=false —— Bot 从列表里没了，它的 DM 会话在侧栏和事件库里
       都还在，而且一声不吭。现在只有 sessions store 能写这张面。 */
    let sessions_deleted = 0;
    let sessions_cascade_deferred = "";
    const dmTitles = new Set([bot.name || bot_id, bot_id].map((x) => String(x) + " · DM"));
    if (!sessionsStore) {
      /* 唯一可能的缺席是打包清单没带上 store（Box 少一个文件）——那时宁可说出口，
         也不能像以前那样把「没做成」报成「做完了」。 */
      sessions_cascade_deferred = "no_store";
      sayOnce("cascade-no-sessions-store",
        "[product-surface] 删 Bot 的会话级联没执行：本进程拿不到 sessions store（sessions.json 的唯一写者），" +
        "这个 Bot 的 DM 会话要手动删\n");
    } else {
      const rows = sessionsStore.list();
      for (const row of (rows && rows.sessions) || []) {
        if (!row || !dmTitles.has(String(row.title || ""))) continue;
        const rm = sessionsStore.remove(row.id);
        if (rm && rm.ok) sessions_deleted++;
      }
    }

    // GP-07: remove the bot from rooms; drop rooms that fall below 2 members.
    // 被解散的群要**点名**带回去：群一没，用户回头发消息只会得到「群不存在」，
    // 根本不知道是自己刚才删人把群解散了。只回一个数字是不够的。
    let rooms_removed = 0;
    let rooms_dropped = [];
    try {
      const rooms = requireWritableRooms();
      if (Array.isArray(rooms.rooms)) {
        for (const r of rooms.rooms) {
          if (Array.isArray(r.bot_ids)) r.bot_ids = r.bot_ids.filter((x) => x !== bot_id);
          if (Array.isArray(r.members)) r.members = r.members.filter((x) => x !== bot_id);
          if (Array.isArray(r.bots)) r.bots = r.bots.filter((x) => x !== bot_id);
        }
        const before = rooms.rooms.slice();
        rooms.rooms = rooms.rooms.filter((r) => {
          const n = (r.bot_ids && r.bot_ids.length) || (r.members && r.members.length) || (r.bots && r.bots.length) || 0;
          return n >= 2;
        });
        const kept = new Set(rooms.rooms.map((r) => r.id));
        rooms_dropped = before
          .filter((r) => r && !kept.has(r.id))
          .map((r) => ({ id: r.id, title: r.title || r.id }));
        rooms_removed = rooms_dropped.length;
        saveRooms(rooms);
      }
    } catch {
      // rooms store missing, skip
    }

    // Count workspace files kept
    let workspace_files_kept = 0;
    try {
      const workspaceDir = path.join(DATA_ROOT, "workspace");
      if (fs.existsSync(workspaceDir)) {
        const countFiles = (dir) => {
          let count = 0;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              count += countFiles(fullPath);
            } else {
              count++;
            }
          }
          return count;
        };
        workspace_files_kept = countFiles(workspaceDir);
      }
    } catch {
      // workspace dir missing
    }

    // GP-114 (§4.2): memory is per Bot, so exactly one slot goes away with the
    // Bot. Other Bots' learned context is not ours to delete.
    const memory_dropped = dropBotMemorySlot(bot_id).dropped;

    return {
      ok: true,
      mode: "host_delete_bot",
      pretend_saved: false,
      sessions_cascaded: sessions_deleted > 0,
      sessions_deleted,
      sessions_cascade_deferred,
      memory_dropped,
      routines_deleted,
      rooms_removed,
      rooms_dropped,
      primary_reassigned: primaryReassigned,
      workspace_files_kept
    };
  }

  function decorateBot(bot) {
    return Object.assign({}, bot, {
      tags: Array.isArray(bot.tags) ? bot.tags : [],
      group: typeof bot.group === "string" ? bot.group : "",
      avatar_data_url: avatarDataUrl(bot),
    });
  }

  /* GP-124..127 (§2.1 right panel, §4.6 notifications): every field of the Bot
     settings panel is read from the store that actually owns it — profile from
     bots.json, memory count from this Bot's memory slot, routines by the same
     binding convention the delete cascade uses (id/prompt contains bot_id),
     sessions by the existing "<name> · DM" title convention. Nothing is
     synthesised: a missing store simply reports 0. */
  function botDetail(botId) {
    const id = String(botId || "").trim();
    if (!id) return { ok: false, error: "bot_not_found", bot_id: id, mode: "host_bot_detail" };
    const data = loadBots();
    const bot = (data.bots || []).find((b) => b && b.id === id);
    if (!bot) return { ok: false, error: "bot_not_found", bot_id: id, mode: "host_bot_detail" };

    let memoryEntries = 0;
    try {
      const store = readJson(MEMORY_STORE_PATH, null);
      const slot = store && store.bots && store.bots[id];
      if (slot && Array.isArray(slot.entries)) memoryEntries = slot.entries.length;
    } catch (_) { /* memory store missing → 0 entries */ }

    let routineCount = 0;
    let routineActive = 0;
    try {
      const rows = readJson(path.join(ROUTINES_DIR, "host-routines.json"), null);
      if (Array.isArray(rows)) {
        const bound = (r) => r && (String(r.id || "").includes(id) || String(r.prompt || "").includes(id));
        const hits = rows.filter(bound);
        routineCount = hits.length;
        routineActive = hits.filter((r) => r.enabled !== false && r.lifecycle !== "paused").length;
      }
    } catch (_) { /* routines store missing → 0 */ }

    let sessionCount = 0;
    let lastSessionAt = "";
    /* GP-124..127：这一块以前直读 sessions.json。EVENT_ONLY 下那张面的真源是事件库
       （JSON 一个字节都不再写），于是 Bot 详情里的会话数与「最近活动」看的是一份陈旧副本。
       改走 store 以后，读写两边看到的是同一张面。 */
    const dmTitlesForBot = new Set([String(bot.name || id) + " · DM", id + " · DM"]);
    const dmRows = sessionsStore ? (sessionsStore.list().sessions || []) : [];
    for (const s of dmRows) {
      if (!s || !dmTitlesForBot.has(String(s.title || ""))) continue;
      sessionCount++;
      const at = String(s.updated_at || "");
      if (at > lastSessionAt) lastSessionAt = at;
    }

    let roomCount = 0;
    try {
      /* 片2 的纪律（面的读法归面的持有者）在这里还剩一处漏网：这一行以前直读
         rooms.json。EVENT_ONLY 下那张 JSON 一个字节都不再写，于是 Bot 详情面板
         显示的「群数」是陈旧副本 —— 实测同一次操作里 loadRooms 数到 1 个群、
         rooms_total 报 0，两个互相矛盾的数字同屏（用户看到的正是那一句）。 */
      const roomsFace = loadRooms();
      const rows = Array.isArray(roomsFace) ? roomsFace : (roomsFace && Array.isArray(roomsFace.rooms) ? roomsFace.rooms : []);
      roomCount = rows.filter((r) => Array.isArray(r && r.members) && r.members.includes(id)).length;
    } catch (_) { /* rooms store missing → 0 */ }

    const settings = loadSettings();
    const notifyMap = settings && settings.notify && typeof settings.notify === "object" ? settings.notify : {};
    return {
      ok: true,
      mode: "host_bot_detail",
      bot: decorateBot(bot),
      primary_id: data.primary_id || "",
      is_primary: String(data.primary_id || "") === id,
      notifications: notifyMap[id] !== false,
      notify_explicit: Object.prototype.hasOwnProperty.call(notifyMap, id),
      memory_entries: memoryEntries,
      routines_total: routineCount,
      routines_active: routineActive,
      sessions_total: sessionCount,
      last_session_at: lastSessionAt,
      rooms_total: roomCount,
    };
  }

  /* GP-126: one Bot's notification toggle must not clobber the other Bots'
     settings, and only a real boolean is accepted. */
  function botNotifySet(botId, on) {
    const id = String(botId || "").trim();
    if (!id) return { ok: false, error: "bot_not_found", mode: "host_bot_notify" };
    const data = loadBots();
    if (!(data.bots || []).some((b) => b && b.id === id)) {
      return { ok: false, error: "bot_not_found", bot_id: id, mode: "host_bot_notify" };
    }
    if (typeof on !== "boolean") {
      return { ok: false, error: "invalid_value", bot_id: id, mode: "host_bot_notify" };
    }
    const settings = loadSettings();
    const notify = settings.notify && typeof settings.notify === "object" ? settings.notify : {};
    notify[id] = on;
    settings.notify = notify;
    saveSettings(settings);
    return { ok: true, mode: "host_bot_notify", bot_id: id, notifications: on, notify_map: notify };
  }

  function listViews() {
    const data = loadBots();
    const visible = data.bots
      .filter(b => !b.hidden)
      .sort((a, b) => {
        // GP-117 (§2.1): pinned Bots are fixed at the top regardless of age,
        // then the list is ordered by real activity (updated_at).
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // Then by updated_at desc
        return new Date(b.updated_at) - new Date(a.updated_at);
      });
    const hidden = data.bots.filter(b => b.hidden);
    return {
      ok: true,
      bots: visible.map(decorateBot),
      hidden_bots: hidden.map(decorateBot),
      primary_id: data.primary_id
    };
  }

  /* GP-117: a Bot's position in the list comes from real activity, so the Host
     stamps updated_at whenever a turn belongs to that Bot. Cheap and idempotent:
     an unknown id is ignored rather than inventing a row. */
  function touchBotActivity(botId) {
    const id = String(botId || "").trim();
    if (!id) return { ok: false, error: "empty bot id" };
    const data = loadBots();
    const bot = (data.bots || []).find((b) => b && b.id === id);
    if (!bot) return { ok: false, error: "bot_not_found", bot_id: id };
    bot.updated_at = nowIso();
    saveBots(data);
    return { ok: true, bot_id: id, updated_at: bot.updated_at };
  }

  // ===== APPROVAL RULES =====
  function loadApprovalRules() {
    return readJson(APPROVAL_RULES_PATH, { version: 1, rules: [] });
  }

  function saveApprovalRules(data) {
    atomicWrite(APPROVAL_RULES_PATH, JSON.stringify(data, null, 2));
  }

  function approvalRuleUpsert({ pattern, decision, source }) {
    const data = loadApprovalRules();
    const existing = data.rules.find(r => r.pattern === pattern);
    if (existing) {
      if (existing.locked) {
        return { ok: false, error: "rule_locked", mode: "host_approval_rule" };
      }
      existing.decision = decision;
    } else {
      data.rules.push({
        pattern,
        decision,
        source: source || "personal",
        locked: source === "team",
        created_at: nowIso()
      });
    }
    saveApprovalRules(data);
    return {
      ok: true,
      rule: data.rules.find(r => r.pattern === pattern)
    };
  }

  function approvalRuleList() {
    const data = loadApprovalRules();
    return {
      ok: true,
      rules: data.rules
    };
  }

  // GP-73: personal rules removable; team/locked rows are not.
  function approvalRuleRemove(pattern) {
    const data = loadApprovalRules();
    const idx = data.rules.findIndex(r => r.pattern === pattern);
    if (idx < 0) return { ok: false, error: "rule_not_found", mode: "host_approval_rule_remove" };
    if (data.rules[idx].locked) return { ok: false, error: "rule_locked", mode: "host_approval_rule_remove" };
    const removed = data.rules.splice(idx, 1)[0];
    saveApprovalRules(data);
    return { ok: true, removed, mode: "host_approval_rule_remove" };
  }

  // ── 「总是允许」的作用域(scope) ────────────────────────────────────────
  // 「总是允许」不是「一把钥匙开整栋楼」。
  // 以前一次 always 写的是 kind:* —— 批一次 mail_send,以后**任何**一封邮件
  // 都不用问;批一次 shell,以后**任何**一条命令都能跑。那一次的授权量,
  // 远大于用户当时看到的那一条。
  //
  // 现在按 kind 算一个**结构性的作用域**:只说"哪一类里的哪一个",
  // 不含正文/参数值 ⇒ 规则文件里不会留下邮件正文、消息内容、命令参数。
  //
  //   shell        → 可执行名[ + 子命令]:  shell:git push
  //   mail_send    → 收件人:               mail_send:me@example.com
  //   channel_send → 渠道名:               channel_send:dingtalk
  //   mcp_call     → 服务名:               mcp_call:notion
  //   其它 kind    → 算不出 ⇒ 不写长期规则(这一次仍然批了)
  //
  // 算不出作用域时**不退回 kind:*** —— 宁可这次多问一句,也不要默默递一把
  // 万能钥匙。要按类授权,用户得**显式**说"按类放行"(CLI 的 --wide)。
  function approvalScope(kind, command) {
    const k = String(kind || "");
    const cmd = String(command || "");
    if (!cmd) return "";
    // 作用域里允许出现的字符:不含空格/竖线/引号等结构字符。
    const okTok = (s) => /^[A-Za-z0-9._@+-]{1,60}$/.test(s);
    if (k === "shell") {
      // 带管道/重定向/复合(; && || | > < …)的命令 ⇒ 作用域不可靠 ⇒ 不写长期规则。
      if (/[;&|`$(){}\[\]<>\n\r*?!~#\\]/.test(cmd)) return "";
      const toks = cmd.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) return "";
      if (!toks.every(okTok)) return "";
      // 第二个 token 若不是子命令(不以 - 开头)就算进去:`git push` 收窄,
      // `git push --force` 不会被 `git push` 这条规则命中。
      if (toks.length >= 2 && !toks[1].startsWith("-")) return `${toks[0]} ${toks[1]}`;
      return toks[0];
    }
    if (k === "mail_send") {
      // command 形状: <provider>|<收件人>|<主题>|<正文> —— 只取收件人。
      const parts = cmd.split("|");
      const to = String(parts[1] || "").trim();
      return /^[^@\s|]{1,64}@[^@\s|]{1,190}$/.test(to) ? to : "";
    }
    if (k === "channel_send") {
      // command 形状: <渠道> :: <正文>
      const head = cmd.split("::")[0].trim();
      return okTok(head) ? head : "";
    }
    if (k === "mcp_call") {
      // command 形状: <namespace.name>|<参数 JSON>
      const head = cmd.split("|")[0].trim();
      return okTok(head) ? head : "";
    }
    return "";
  }

  function approvalRuleMatch(kind, command) {
    const data = loadApprovalRules();
    const cmd = String(command || "");
    const scope = approvalScope(kind, cmd);
    // 一次待批要同时试三种形态:
    //   ① kind:<作用域>    —— 新写的长期规则(窄)
    //   ② kind:<整条命令>  —— 老代码可能写过的精确规则(得留着)
    //   ③ kind:*           —— 老的一类放行(得留着,不能被新逻辑悄悄作废)
    const testPatterns = [];
    if (scope) testPatterns.push(`${kind}:${scope}`);
    if (cmd) testPatterns.push(`${kind}:${cmd}`);

    // GP-22: ask takes priority over allow
    let askMatch = null;
    let allowMatch = null;

    for (const rule of data.rules) {
      const hit = testPatterns.some(tp => matchPattern(rule.pattern, tp));
      if (!hit) continue;
      if (rule.decision === "ask" && !askMatch) {
        askMatch = rule;
      } else if (rule.decision === "allow" && !allowMatch) {
        allowMatch = rule;
      }
    }

    // ask takes priority
    if (askMatch) return "ask";
    if (allowMatch) return "allow";
    return null;
  }

  function matchPattern(rulePattern, testPattern) {
    // kind:* matches kind:anything
    if (rulePattern.endsWith(":*")) {
      const prefix = rulePattern.slice(0, -2);
      return testPattern.startsWith(prefix + ":");
    }
    // kind:prefix* matches kind:prefixAnything
    if (rulePattern.endsWith("*")) {
      const prefix = rulePattern.slice(0, -1);
      return testPattern.startsWith(prefix);
    }
    // Exact match
    return rulePattern === testPattern;
  }

  // ===== PENDING APPROVALS =====
  function appendPendingApproval({ source, kind, command, expires_at }) {
    const entry = {
      // 同毫秒两条审批会撞 id（CI 上真撞过：EO-03 折叠报「审批被创建了两次」，
      // fold 的 find/drop 全按 id 认，撞了就是把两条当一条）。加随机后缀，
      // 与 roomLibraryAdd 的 lib- id 同一款生成法。
      id: "approval-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      source: source || "chat",
      kind,
      command,
      requested_at: nowIso(),
      expires_at: expires_at || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      status: "pending"
    };
    appendJsonl(PENDING_APPROVALS_PATH, entry);
    return { ok: true, id: entry.id, mode: "host_pending_approval" };
  }

  // 与 sessions.js 同一条「只说一次」闸（rooms / approvals 各自一份）。
  const roomsDegradedSaid = new Set();
  const approvalsDegradedSaid = new Set();

  /** jsonl 原始行的读取（不做过期标注）：EVENT_ONLY 的遗留路与 approvalDecide 共用。 */
  function readApprovalsFileRaw() {
    try {
      if (!fs.existsSync(PENDING_APPROVALS_PATH)) return [];
      return fs
        .readFileSync(PENDING_APPROVALS_PATH, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function pendingApprovals(nowIsoParam) {
    // T1-05 EVENT_ONLY：读模型为主，遗留文件走自导入路径（同 loadRooms 的分层）。
    if (eventOnlyMode()) {
      const hit = eventReadModel.readSurfaces(DATA_ROOT);
      let raw;
      if (hit.ok && !hit.anomalies.length && hit.count > 0) {
        raw = hit.approvals || [];
      } else {
        raw = readApprovalsFileRaw();
        if (raw.length) {
          sayOnce(
            "legacy-approvals",
            "[approvals] BITBOT_EVENT_ONLY：事件库为空但存在遗留 pending-approvals.jsonl（未导入）——暂以 JSON 为读真源，" +
              "首次写入会把它增量带进事件库；建议先跑 scripts/import_json_to_events.mjs。\n",
          );
        }
      }
      setLastTextFor(PENDING_APPROVALS_PATH, canonicalTextFor("approvals", { approvals: raw }));
      const now = nowIsoParam ? new Date(nowIsoParam).getTime() : Date.now();
      return raw.map((entry) => {
        const e = JSON.parse(JSON.stringify(entry));
        if (e.status === "pending" && new Date(e.expires_at).getTime() < now) {
          e.status = "expired";
        }
        return e;
      });
    }
    // T1-04 读切换：事件读模型里的 approvals 面保存的是 jsonl 的原始行
    // （status 落库时是什么就是什么），「过期」是读时语义，两条路都要现算。
    if (eventReadModel.eventReadEnabled()) {
      const hit = eventReadModel.readSurfaces(DATA_ROOT);
      if (hit.ok && !hit.anomalies.length) {
        const now = nowIsoParam ? new Date(nowIsoParam).getTime() : Date.now();
        return (hit.approvals || []).map(entry => {
          const e = JSON.parse(JSON.stringify(entry));
          if (e.status === "pending" && new Date(e.expires_at).getTime() < now) {
            e.status = "expired";
          }
          return e;
        });
      }
      const src = hit.ok ? "events_anomalies" : hit.reason;
      if (!approvalsDegradedSaid.has(src)) {
        approvalsDegradedSaid.add(src);
        process.stderr.write(
          `[approvals] BITBOT_EVENT_READ 已开但事件读模型不可用（${src}` +
            (hit.ok ? "" : hit.error ? `: ${hit.error}` : "") + "），本次回退 JSON 读。\n",
        );
      }
    }
    try {
      if (!fs.existsSync(PENDING_APPROVALS_PATH)) {
        return [];
      }
      const lines = fs.readFileSync(PENDING_APPROVALS_PATH, "utf8").split("\n").filter(Boolean);
      const now = nowIsoParam ? new Date(nowIsoParam).getTime() : Date.now();
      return lines.map(line => {
        try {
          const entry = JSON.parse(line);
          // Calculate status based on expires_at
          if (entry.status === "pending" && new Date(entry.expires_at).getTime() < now) {
            entry.status = "expired";
          }
          return entry;
        } catch {
          return null;
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  // opts: { scope: "wide" } ⇒ 「总是允许」按**类**放行(kind:*)。
  // 默认走**作用域**规则(kind:<作用域>),窄得多。
  function approvalDecide(id, decision, nowIsoParam, opts) {
    if (!["allow_once", "always", "deny"].includes(decision)) {
      return { ok: false, error: "invalid_decision", mode: "host_approval_decide" };
    }

    // Load all pending approvals
    // EVENT_ONLY：读模型为主（fold 保存的是原始行），库空时遗留文件即真源。
    let entries = [];
    if (eventOnlyMode()) {
      const hit = eventReadModel.readSurfaces(DATA_ROOT);
      if (hit.ok && !hit.anomalies.length && hit.count > 0) {
        entries = JSON.parse(JSON.stringify(hit.approvals || []));
      } else {
        entries = readApprovalsFileRaw();
      }
      // prev 缓存以这次读到的为准（随后的 atomicWrite diff 左半边必须精确）
      setLastTextFor(PENDING_APPROVALS_PATH, canonicalTextFor("approvals", { approvals: entries }));
    } else {
      try {
        if (fs.existsSync(PENDING_APPROVALS_PATH)) {
          const lines = fs.readFileSync(PENDING_APPROVALS_PATH, "utf8").split("\n").filter(Boolean);
          entries = lines.map(line => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
        }
      } catch {
        return { ok: false, error: "read_failed", mode: "host_approval_decide" };
      }
    }

    const entry = entries.find(e => e.id === id);
    if (!entry) {
      return { ok: false, error: "approval_not_found", mode: "host_approval_decide" };
    }
    if (entry.status === "decided") {
      return { ok: false, error: "already_decided", decision: entry.decision, id, mode: "host_approval_decide" };
    }
    // GP-23: expired background approvals still allow always-allow / deny, but not allow_once.
    const nowMs = nowIsoParam ? new Date(nowIsoParam).getTime() : Date.now();
    const isExpired =
      entry.status === "pending" &&
      entry.expires_at &&
      new Date(entry.expires_at).getTime() < nowMs;
    if (isExpired && decision === "allow_once") {
      return {
        ok: false,
        error: "approval_expired",
        id,
        kind: entry.kind,
        command: entry.command,
        mode: "host_approval_decide",
      };
    }
    // GP-23: expired approvals still allow always-allow / deny (rule persist below).

    entry.status = "decided";
    entry.decision = decision;
    entry.decided_at = nowIsoParam || nowIso();

    // Rewrite pending approvals file
    atomicWrite(PENDING_APPROVALS_PATH, entries.map(e => JSON.stringify(e)).join("\n") + "\n");

    // Log decision
    appendJsonl(APPROVALS_LOG_PATH, {
      id,
      decision,
      kind: entry.kind,
      command: entry.command,
      decided_at: entry.decided_at
    });

    let persisted_pattern;
    let persisted_scope = "";
    // If "always", upsert allow rule.
    //
    // 以前写的是 kind:* —— 一次授权 = 这台机器以后做**这一类**事不再问你。
    // 现在默认写**作用域**规则(kind:<作用域>),窄得多:
    //   shell:git push        mail_send:me@example.com   channel_send:dingtalk
    // 算不出作用域(命令带管道/复合,或 kind 没定义作用域)⇒ **不写长期规则**:
    // 这一次批了,下次照常再问。想按类放行得显式说(--wide / scope:"wide")。
    if (decision === "always") {
      const wantWide = !!(opts && opts.scope === "wide");
      const scope = wantWide ? "*" : approvalScope(entry.kind, entry.command);
      if (scope === "*") {
        persisted_pattern = entry.kind + ":*";
        persisted_scope = "kind";
      } else if (scope) {
        persisted_pattern = entry.kind + ":" + scope;
        persisted_scope = "scoped";
      }
      if (persisted_pattern) {
        approvalRuleUpsert({ pattern: persisted_pattern, decision: "allow", source: "personal" });
      }
    }

    return {
      ok: true,
      id,
      decision,
      kind: entry.kind,
      command: entry.command,
      item: entry,
      persisted_pattern,
      persisted_scope,
      mode: "host_approval_decide"
    };
  }

  // GP-21: chat-sourced Deny receipt — append-only audit line, nothing executed.
  function logApprovalDeny({ source, kind, command }) {
    const entry = {
      id: "deny-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      source: source || "chat",
      decision: "deny",
      kind,
      command,
      decided_at: nowIso(),
      executed: false,
      pretend_executed: false
    };
    appendJsonl(APPROVALS_LOG_PATH, entry);
    return { ok: true, entry, mode: "host_approval_deny_receipt" };
  }

  // ===== SETTINGS =====
  // Timezone default = SYSTEM timezone (not hardcoded UTC). Priority:
  //   1. BITBOT_TZ (explicit, also drives the routine daemon)
  //   2. Intl resolved zone (Node/OS)
  //   3. TZ env
  //   4. "UTC" only as a last resort when the system really reports UTC.
  function systemTimezone() {
    try {
      const explicit = String(process.env.BITBOT_TZ || "").trim();
      if (explicit) return explicit;
      if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) return tz;
      }
      const tzEnv = String(process.env.TZ || "").trim();
      if (tzEnv) return tzEnv;
    } catch (_) { /* ignore */ }
    return "UTC";
  }

  function loadSettings() {
    const data = readJson(SETTINGS_PATH, {
      version: 1,
      appearance: "system",
      language: "zh-CN",
      timezone: systemTimezone(),
      timezone_explicit: false,
      local_execution: "ask",
      route_traffic: false,
      sidebar_collapsed: false,
      notify: {},
      unread: {}
    });
    // Migration: a legacy store that never had an explicit choice but shows the
    // old hardcoded "UTC" default is re-seeded to the system timezone. A UTC the
    // user actually picked (timezone_explicit === true) is preserved untouched.
    if (
      data &&
      (data.timezone === "UTC" || data.timezone == null) &&
      data.timezone_explicit !== true
    ) {
      data.timezone = systemTimezone();
      if (data.timezone_explicit === undefined) data.timezone_explicit = false;
    }
    return data;
  }

  function saveSettings(data) {
    atomicWrite(SETTINGS_PATH, JSON.stringify(data, null, 2));
  }

  function settingsGet() {
    return loadSettings();
  }

  function settingsPatch(patch) {
    const data = loadSettings();
    // Replica C4: search_default 是 composer「联网搜索」开关的持久位。不在白名单里
    // 会被静默 ignored —— 开关点了能亮、重启就忘。
    const allowed = new Set(["appearance", "language", "timezone", "timezone_explicit", "local_execution", "route_traffic", "notify", "unread", "sidebar_collapsed", "dev_mode", "search_default"]);
    const ignored = [];
    
    for (const key of Object.keys(patch)) {
      if (allowed.has(key)) {
        data[key] = patch[key];
      } else {
        ignored.push(key);
      }
    }
    
    saveSettings(data);
    return {
      ok: true,
      settings: data,
      ignored
    };
  }

  // ===== COMPUTER =====
  function loadComputer() {
    return readJson(COMPUTER_PATH, {
      version: 1,
      state: "ready",
      last_update_at: null,
      last_reset_at: null,
      last_recover_at: null,
      screens: {},
      takeover: { active: false }
    });
  }

  function saveComputer(data) {
    atomicWrite(COMPUTER_PATH, JSON.stringify(data, null, 2));
  }

  // GP-31: per-Bot screen state. Host computer-use/screenshot/takeover runs
  // record real frames + actions here so the right-side preview reflects the
  // Bot's actual activity (click / type / navigate / current state).
  // GP-30: one computer-use task at a time per Bot (spec §2.3). The lock is a
  // real file so separate Host processes (CLI smoke, Electron main) contend on
  // the same state; a hold is only trusted while fresh (< TTL) — a crashed
  // process's lock expires instead of blocking the Bot forever.
  const CU_LOCK_DIR = path.join(DATA_ROOT, "desktop", "cu-locks");
  const CU_LOCK_TTL_MS = Number(process.env.BITBOT_CU_LOCK_TTL_MS || 120000);

  function cuLockPath(bot_id) {
    return path.join(CU_LOCK_DIR, String(bot_id || "agent-bit") + ".json");
  }

  function cuLockAcquire(bot_id, task) {
    const id = String(bot_id || "agent-bit");
    fs.mkdirSync(CU_LOCK_DIR, { recursive: true });
    const p = cuLockPath(id);
    const now = Date.now();
    try {
      if (fs.existsSync(p)) {
        const held = JSON.parse(fs.readFileSync(p, "utf8"));
        const age = now - (Date.parse(held.at || "") || 0);
        if (Number.isFinite(age) && age < CU_LOCK_TTL_MS) {
          return {
            ok: false,
            busy: true,
            held_by: id,
            held_since: held.at,
            held_task: String(held.task || "").slice(0, 120),
            age_ms: age,
            mode: "host_computer_use_lock",
          };
        }
      }
    } catch {
      // corrupt lock file — treat as expired and take over
    }
    const entry = { bot_id: id, task: String(task || "").slice(0, 200), at: new Date(now).toISOString(), pid: process.pid };
    atomicWrite(p, JSON.stringify(entry, null, 2));
    return { ok: true, mode: "host_computer_use_lock", lock_path: p, entry };
  }

  function cuLockRelease(bot_id) {
    const p = cuLockPath(bot_id);
    let released = false;
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        released = true;
      }
    } catch {
      // best-effort; TTL will expire it
    }
    return { ok: true, released, mode: "host_computer_use_lock" };
  }

  function cuLockStatus() {
    const out = [];
    try {
      if (fs.existsSync(CU_LOCK_DIR)) {
        for (const f of fs.readdirSync(CU_LOCK_DIR)) {
          if (!f.endsWith(".json")) continue;
          try {
            out.push(JSON.parse(fs.readFileSync(path.join(CU_LOCK_DIR, f), "utf8")));
          } catch { /* skip corrupt */ }
        }
      }
    } catch { /* no locks dir */ }
    return { ok: true, holds: out, mode: "host_computer_use_lock" };
  }

  function recordComputerAction({ bot_id, action, detail, frame_path, status }) {
    const id = String(bot_id || "agent-bit");
    const data = loadComputer();
    if (!data.screens || typeof data.screens !== "object") data.screens = {};
    const prev = data.screens[id] || { actions: [] };
    const at = nowIso();
    const entry = {
      action: String(action || "observe"),
      detail: String(detail || "").slice(0, 200),
      frame_path: frame_path && fs.existsSync(String(frame_path)) ? String(frame_path) : null,
      at,
    };
    const actions = Array.isArray(prev.actions) ? prev.actions : [];
    actions.push(entry);
    data.screens[id] = {
      status: String(status || prev.status || "active"),
      frame_path: entry.frame_path || prev.frame_path || null,
      last_action: entry.action,
      last_detail: entry.detail,
      updated_at: at,
      actions: actions.slice(-12),
    };
    saveComputer(data);
    return { ok: true, mode: "host_computer_screen_record", screen: data.screens[id] };
  }

  // GP-140 (§3.1): the Computer's browser profile is ONE durable user-data-dir
  // shared by every Bot (official: a site a Bot signed into stays available to
  // the others). Login *markers* live in computer.json so any Bot can read
  // them; real cookie contents / cloud microVM remain external (honest residual).
  function sharedBrowserState() {
    const data = loadComputer();
    const sb =
      data.shared_browser && typeof data.shared_browser === "object"
        ? data.shared_browser
        : {};
    const profileDir = path.join(
    DATA_ROOT,
    "connectors",
    "identity",
    "chrome-user-data"
  );
    return {
      data,
      shared_browser: {
        user_data_dir: sb.user_data_dir || profileDir,
        shared_across_bots: true,
        sites: sb.sites && typeof sb.sites === "object" ? sb.sites : {},
      },
    };
  }

  function recordSharedBrowserSession({ bot_id, site, signed_in = true, detail }) {
    const name = String(site || "").trim();
    if (!name) return { ok: false, error: "site_required", mode: "host_computer_shared_session" };
    const id = String(bot_id || "agent-bit");
    const at = nowIso();
    const { data, shared_browser } = sharedBrowserState();
    try {
      fs.mkdirSync(shared_browser.user_data_dir, { recursive: true });
    } catch (_) {
      /* profile dir is best-effort on read-only hosts */
    }
    shared_browser.sites[name] = {
      signed_in: signed_in !== false,
      by_bot: id,
      at,
      detail: String(detail || "").slice(0, 160),
    };
    data.shared_browser = shared_browser;
    saveComputer(data);
    return {
      ok: true,
      mode: "host_computer_shared_session",
      site: name,
      by_bot: id,
      shared_browser,
      visible_to_bots: "all",
      pretend_cookies: false,
      real_cloud_vm: false,
      at,
    };
  }

  function readSharedBrowserSession({ bot_id } = {}) {
    const { shared_browser } = sharedBrowserState();
    const sites = shared_browser.sites;
    return {
      ok: true,
      mode: "host_computer_shared_session",
      asker_bot: String(bot_id || "agent-bit"),
      shared_across_bots: true,
      user_data_dir: shared_browser.user_data_dir,
      sites,
      signed_in_sites: Object.keys(sites).filter((s) => sites[s] && sites[s].signed_in),
      visible_to_bots: "all",
      pretend_cookies: false,
      real_cloud_vm: false,
      cookie_sandbox_residual: true,
      note: "共享登录标记可跨 Bot 读取；真实 Cookie/云 microVM 属外部依赖（诚实残留）。",
    };
  }

  function computerFrame(botId) {
    // Look for latest frame for this bot
    try {
      if (!fs.existsSync(FRAMES_DIR)) {
        return { path: null, at: null, residual: "no_frame" };
      }
      const files = fs.readdirSync(FRAMES_DIR)
        .filter(f => f.endsWith(".png") && (!botId || f.includes(botId)))
        .map(f => ({
          name: f,
          path: path.join(FRAMES_DIR, f),
          mtime: fs.statSync(path.join(FRAMES_DIR, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);
      
      if (files.length === 0) {
        return { path: null, at: null, residual: "no_frame" };
      }
      
      const latest = files[0];
      return {
        path: latest.path,
        at: new Date(latest.mtime).toISOString(),
        residual: null
      };
    } catch {
      return { path: null, at: null, residual: "no_frame" };
    }
  }

  function takeoverBegin({ bot_id, reason, session_id }) {
    const data = loadComputer();
    data.takeover = {
      active: true,
      bot_id: bot_id || "user",
      reason: reason || "",
      session_id: session_id || null,
      started_at: nowIso()
    };
    saveComputer(data);
    
    // Try to capture screenshot if DISPLAY available
    let frame_path = null;
    try {
      const display = process.env.DISPLAY;
      if (display) {
        fs.mkdirSync(FRAMES_DIR, { recursive: true });
        const frameFile = path.join(FRAMES_DIR, `takeover-${bot_id || "user"}-${Date.now()}.png`);
        // Try scrot or import
        try {
          execFileSync("scrot", [frameFile], { timeout: 3000, stdio: "ignore" });
          if (fs.existsSync(frameFile)) frame_path = frameFile;
        } catch {
          try {
            execFileSync("import", ["-window", "root", frameFile], { timeout: 3000, stdio: "ignore" });
            if (fs.existsSync(frameFile)) frame_path = frameFile;
          } catch { /* no screenshot tool */ }
        }
      }
    } catch { /* screenshot failed */ }
    
    return {
      ok: true,
      mode: "host_takeover_begin",
      pretend_saved: false,
      takeover: data.takeover,
      frame_path
    };
  }

  function takeoverEnd({ bot_id, handback_at }) {
    const data = loadComputer();
    data.takeover = {
      active: false,
      bot_id: bot_id || data.takeover.bot_id,
      handback_at: handback_at || nowIso()
    };
    saveComputer(data);
    return {
      ok: true,
      mode: "host_takeover_end",
      pretend_saved: false,
      takeover: data.takeover
    };
  }

  function recoverComputer(now, force) {
    const data = loadComputer();
    if (data.state !== "error" && !force) {
      return {
        ok: false,
        error: "recover only from error state",
        advise: "update_computer",
        mode: "host_recover_computer"
      };
    }

    // Count workspace files
    let workspace_files_kept = 0;
    try {
      const workspaceDir = path.join(DATA_ROOT, "workspace");
      if (fs.existsSync(workspaceDir)) {
        const countFiles = (dir) => {
          let count = 0;
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              count += countFiles(fullPath);
            } else {
              count++;
            }
          }
          return count;
        };
        workspace_files_kept = countFiles(workspaceDir);
      }
    } catch {
      // workspace dir missing
    }

    data.state = "ready";
    data.last_recover_at = now || nowIso();
    saveComputer(data);

    return {
      ok: true,
      mode: "host_recover_computer",
      pretend_saved: false,
      workspace_files_kept,
      computer: data
    };
  }

  // ===== ROOMS =====
  /* 群资料库（room.library）——
     条目 = {id, title, kind, path?, added_at}。path 只允许落在 repo 内
     （与 openArtifact 同一把尺子），所以资料库里存的路径永远真的能打开。
     写侧 fail closed：rooms.json 读不出来就不写，绝不把用户的群聊历史覆盖成空。 */
  const ROOM_LIBRARY_MAX = 50;
  function roomLibraryItems(room) {
    const raw = room && Array.isArray(room.library) ? room.library : [];
    return raw
      .filter((x) => x && typeof x === "object" && String(x.title || "").trim())
      .map((x) => ({
        id: String(x.id || ""),
        title: String(x.title || "").trim(),
        kind: String(x.kind || "doc"),
        path: String(x.path || ""),
        added_at: String(x.added_at || ""),
      }));
  }
  function roomLibraryList(roomId) {
    const rid = String(roomId || "").trim();
    if (!rid) return { ok: false, error: "room_id_required", items: [] };
    const hit = parseRoomsRaw();
    if (hit.unreadable) return { ok: false, error: ROOMS_UNREADABLE + ":" + hit.reason, items: [] };
    const rooms = Array.isArray(hit.data.rooms) ? hit.data.rooms : [];
    const room = rooms.find((r) => r && String(r.id) === rid);
    if (!room) return { ok: false, error: "room_not_found", items: [] };
    return { ok: true, room_id: rid, items: roomLibraryItems(room) };
  }
  function roomLibraryAdd(roomId, entries) {
    const rid = String(roomId || "").trim();
    if (!rid) return { ok: false, error: "room_id_required", items: [] };
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return { ok: false, error: "no_entries", items: [] };
    let data = null;
    try {
      data = requireWritableRooms(); // 坏文件直接抛，绝不写成空目录
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), items: [] };
    }
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    const room = rooms.find((r) => r && String(r.id) === rid);
    if (!room) return { ok: false, error: "room_not_found", items: [] };
    const items = roomLibraryItems(room);
    const seen = new Set(items.map((x) => x.path).filter(Boolean));
    const added = [];
    for (const e of list) {
      const title = String((e && e.title) || "").trim();
      if (!title) continue;
      const p = String((e && e.path) || "").trim();
      if (p) {
        // 路径必须在 repo 内 —— 与 openArtifact 同一把尺子，否则资料库里会
        // 出现「点了打不开」的条目。
        const resolved = path.resolve(p);
        const root = path.resolve(REPO_ROOT);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
          return { ok: false, error: "path_outside_repo", items: items.concat(added) };
        }
        if (seen.has(resolved)) continue;
        seen.add(resolved);
      }
      if (items.length + added.length >= ROOM_LIBRARY_MAX) {
        return { ok: false, error: "library_full", max: ROOM_LIBRARY_MAX, items: items.concat(added) };
      }
      added.push({
        id: "lib-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
        title,
        kind: String((e && e.kind) || "doc"),
        path: p,
        added_at: nowIso(),
      });
    }
    if (!added.length) return { ok: true, added: 0, items };
    room.library = items.concat(added);
    saveRooms(data);
    return { ok: true, added: added.length, items: roomLibraryItems(room) };
  }

  // T1-04 读切换：与 sessions.load() 同一条路——BITBOT_EVENT_READ=1 时优先
  // 从事件日志折叠 rooms 面，读模型不可用就回退 JSON 读并打一行说明。
  // 注意：这只换「读」，parseRoomsRaw 的诚实报错语义保持原样（它诊断的是
  // JSON 文件本身的健康度，在双写还开着的阶段仍是有效信号）。
  function readRoomsFromEvents() {
    const hit = eventReadModel.readSurfaces(DATA_ROOT);
    if (hit.ok && !hit.anomalies.length) {
      const rooms = hit.rooms;
      if (rooms && typeof rooms === "object" && Array.isArray(rooms.rooms)) {
        return { data: rooms, source: "events" };
      }
      return { data: null, source: "events_shape_invalid" };
    }
    if (hit.ok) return { data: null, source: "events_anomalies" };
    return { data: null, source: hit.reason, detail: hit.error || "" };
  }

  function loadRooms() {
    if (eventOnlyMode()) {
      const hit = eventReadModel.readSurfaces(DATA_ROOT);
      if (hit.ok && !hit.anomalies.length && hit.count > 0) {
        const text = canonicalTextFor("rooms", hit);
        setLastTextFor(ROOMS_PATH, text);
        return JSON.parse(text);
      }
      // 库空或不可用：遗留文件即真源（自导入路径），否则空目录
      if (fs.existsSync(ROOMS_PATH)) {
        sayOnce(
          "legacy-rooms",
          "[rooms] BITBOT_EVENT_ONLY：事件库为空但存在遗留 rooms.json（未导入）——暂以 JSON 为读真源，" +
            "首次写入会把它增量带进事件库；建议先跑 scripts/import_json_to_events.mjs。\n",
        );
        const text = fs.readFileSync(ROOMS_PATH, "utf8");
        setLastTextFor(ROOMS_PATH, text);
        const parsed = JSON.parse(text);
        return parsed && Array.isArray(parsed.rooms) ? parsed : { version: 1, rooms: [] };
      }
      if (hit.ok && hit.anomalies.length) {
        sayOnce("ano-rooms", `[rooms] BITBOT_EVENT_ONLY：事件折叠有异常（${hit.anomalies[0]}）——按空目录处理，写入继续\n`);
      } else if (!hit.ok && hit.reason !== "no_db" && hit.reason !== "read_disabled") {
        sayOnce(`rm-rooms-${hit.reason}`, `[rooms] BITBOT_EVENT_ONLY：事件读模型不可用（${hit.reason}${hit.error ? ": " + hit.error : ""}）——按空目录处理，写入继续\n`);
      }
      setLastTextFor(ROOMS_PATH, JSON.stringify({ version: 1, rooms: [] }, null, 2));
      return { version: 1, rooms: [] };
    }
    if (eventReadModel.eventReadEnabled()) {
      const hit = readRoomsFromEvents();
      if (hit.data) return hit.data;
      if (!roomsDegradedSaid.has(hit.source)) {
        roomsDegradedSaid.add(hit.source);
        process.stderr.write(
          `[rooms] BITBOT_EVENT_READ 已开但事件读模型不可用（${hit.source}` +
            (hit.detail ? `: ${hit.detail}` : "") + "），本次回退 JSON 读。\n",
        );
      }
    }
    /* KP-09 片8（群面读侧要说话）：这一行以前是 readJson 的静默回落 —— 坏文件直接
       交出空目录，一声不吭。rooms.json 撕裂时 loadRooms 交出「一个群都没有」。写侧确实
       fail closed（requireWritableRooms 抛，坏字节留在原文件里），渲染层也有
       roomsStoreStatus 这条诚实通道，但 loadRooms 的其它消费者（定时任务读的成稿回执、
       host 交接）拿到的是空面而不是「我读不到」，于是邮件里写的是「本群暂无成稿」而不是
       「rooms.json 坏了」。这里只补这一句说明，语义（空目录 + 写侧照旧抛）不变。 */
    const hit = parseRoomsRaw();
    if (!hit.unreadable) return hit.data;
    if (hit.reason === "rooms_file_unreadable" && !fs.existsSync(ROOMS_PATH)) {
      return { version: 1, rooms: [] }; // 还没建过群：空目录是正当默认值，不用报
    }
    sayOnce(`rm-empty-${hit.reason}`,
      `[rooms] ${ROOMS_PATH} 读不出群面（${hit.reason}）——本次按空目录显示，这不是「你没有群」：` +
      "写侧已 fail closed，坏字节仍留在原文件里（改法不是隔离，群面的历史要靠那份字节），请手工检查。\n");
    return { version: 1, rooms: [] };
  }

  // GP-146：rooms.json 坏掉时 readJson 会静默回落成「空目录」。读侧把这种状态
  // 如实报出来（渲染层才能区分「群里没消息」和「我读不到」）；写侧必须 fail
  // closed —— 落一次空目录就把用户全部群聊历史覆盖没了，这是数据丢失，不是降级。
  const ROOMS_UNREADABLE = "rooms_store_unreadable";
  function parseRoomsRaw() {
    let raw;
    try { raw = fs.readFileSync(ROOMS_PATH, "utf8"); }
    catch (e) { return { unreadable: true, reason: "rooms_file_unreadable" }; }
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return { unreadable: true, reason: "rooms_json_parse_failed" }; }
    if (!data || typeof data !== "object" || !Array.isArray(data.rooms)) {
      return { unreadable: true, reason: "rooms_shape_invalid" };
    }
    return { data, unreadable: false, reason: "" };
  }
  /* KP-09 片2（读写同源，群面）：这条以前长在 host_ffi 里，自己 readFileSync
     rooms.json。EVENT_ONLY 下这张面的真源是事件库、JSON 一个字节都不再写，
     于是定时任务的邮件正文永远退回「本群暂无可读到的成稿回执 + 任务原话」——
     群里明明有 final_report，用户收到的是猜测。面的读法归面的持有者。 */
  function roomLatestReport(roomId) {
    const want = String(roomId || "");
    if (!want) return "";
    try {
      const j = loadRooms();
      const list = Array.isArray(j) ? j : ((j && j.rooms) || []);
      const hit = list.find((r) => r && String(r.id) === want);
      const tx = (hit && hit.transcript) || [];
      for (let i = tx.length - 1; i >= 0; i -= 1) {
        const e = tx[i];
        if (e && e.kind === "final_report") {
          const t = String(e.text || e.content || "").trim();
          if (t) return t;
        }
      }
    } catch (_) { /* 读不到就退回原话，不把猜测当稿件 */ }
    return "";
  }

  function roomsStoreStatus() {
    // EVENT_ONLY：JSON 文件不再是真源（可能是遗留物），健康度以事件折叠为准。
    if (eventOnlyMode()) {
      const hit = eventReadModel.readSurfaces(DATA_ROOT);
      if (hit.ok && !hit.anomalies.length) return { ok: true, rooms: hit.rooms };
      return { ok: false, error: ROOMS_UNREADABLE + ":events_" + (hit.ok ? "anomalies" : hit.reason) };
    }
    if (!fs.existsSync(ROOMS_PATH)) return { ok: true, rooms: { version: 1, rooms: [] } };
    const hit = parseRoomsRaw();
    if (hit.unreadable) return { ok: false, error: ROOMS_UNREADABLE + ":" + hit.reason };
    return { ok: true, rooms: hit.data };
  }
  /* rooms.json 的读-改-写基底：本次 requireWritableRooms 交给调用方的那份快照，
     落盘时用来分辨「我删掉的群」和「别的进程刚建的群」。见 saveRooms / mergeRoomsAgainstDisk。 */
  let roomsBaseText = null;

  // 只给「要落盘」的路径用：文件不存在可以当空目录开（还没有群），坏文件不行。
  // EVENT_ONLY 下写侧的基底必须是事件折叠（遗留文件走自导入路径）。
  function requireWritableRooms() {
    if (eventOnlyMode()) {
      const hit = eventReadModel.readSurfaces(DATA_ROOT);
      if (hit.ok && !hit.anomalies.length && hit.count > 0) {
        const text = canonicalTextFor("rooms", hit);
        setLastTextFor(ROOMS_PATH, text);
        roomsBaseText = text;
        return JSON.parse(text);
      }
    }
    if (!fs.existsSync(ROOMS_PATH)) { roomsBaseText = null; return { version: 1, rooms: [] }; }
    const hit = parseRoomsRaw();
    if (hit.unreadable) { const err = new Error(ROOMS_UNREADABLE + ":" + hit.reason); err.code = ROOMS_UNREADABLE; throw err; }
    roomsBaseText = JSON.stringify(hit.data, null, 2);
    if (eventOnlyMode()) setLastTextFor(ROOMS_PATH, JSON.stringify(hit.data, null, 2));
    return hit.data;
  }

  /* KP-09 片5（群面跨进程丢更新）：rooms.json 在默认模式下仍是文件真源，
     一次写换整份文本 —— 桌面主进程和定时守护同时建群，谁读到的是旧快照，
     写回去时就把对方刚建的那个群整批抹掉。用户在侧栏看不见那个群，
     但事件里、Bot 的会话里它还存在过（SW-12 只能撞运气报出「少了几个群」）。
     判据实测（确定性交错，SW-21）：修前盘上只剩「乙的群」，甲刚建的群一个字节都不在。
     改法和 bots 面同形：按 id 三方合并 + 跨进程锁。
     EVENT_ONLY 下不合并 —— 那张面的真源是事件库，atomicWrite 走 eventOnlyWrite，
     此时 rooms.json 可能是遗留物，拿它当「盘上当前」合并会凭空造出幽灵群。 */
  function saveRooms(data) {
    if (eventOnlyMode()) { atomicWrite(ROOMS_PATH, JSON.stringify(data, null, 2)); return; }
    withFaceLock(ROOMS_PATH, () => atomicWrite(ROOMS_PATH, JSON.stringify(mergeRoomsAgainstDisk(data), null, 2)));
  }

  function mergeRoomsAgainstDisk(data) {
    if (!data || !Array.isArray(data.rooms)) return data;
    let disk = null;
    try { disk = JSON.parse(fs.readFileSync(ROOMS_PATH, "utf8")); } catch (_) { return data; }
    if (!disk || !Array.isArray(disk.rooms)) return data;
    let baseRooms = new Map();
    if (roomsBaseText) {
      let base = null;
      try { base = JSON.parse(roomsBaseText); } catch (_) { return data; }
      baseRooms = new Map(((base && base.rooms) || []).filter((r) => r && r.id).map((r) => [r.id, r]));
    }
    const mine = new Map(data.rooms.filter((r) => r && r.id).map((r) => [r.id, r]));
    const merged = [];
    const seen = new Set();
    for (const d of disk.rooms) {
      if (!d || !d.id) continue;
      seen.add(d.id);
      const m = mine.get(d.id);
      if (!m) {
        // 我没写回去：基底里有 = 我删的（群面目前没有删除入口，这条为将来留）；基底里没有 = 别人刚建的，不归我删。
        if (!baseRooms.has(d.id)) merged.push(d);
        continue;
      }
      const b = baseRooms.get(d.id);
      merged.push(b && JSON.stringify(b) === JSON.stringify(m) ? d : m);
    }
    for (const m of data.rooms) {
      if (!m || !m.id || seen.has(m.id)) continue;
      // 我这轮带了、盘上却没有 = 别的写者删了它；不复活（和 bots 面同一条判据）。
      if (baseRooms.has(m.id)) continue;
      merged.push(m);
    }
    return { ...data, rooms: merged };
  }

  /* G-28 #4「团队详情抽屉 · 成员管理」的 Host 落点。
     群成员是 2–6 人的硬边界（与 roomCreate 同一条尺子），所以两侧都先验后写：
       · 加人 —— Bot 必须真实存在于 bots.json，且还不在群里，加完不超过 6；
       · 移人 —— 必须是当前成员，移完不少于 2。
     拒绝时点名返回原因（room_not_found / bot_not_found / already_member /
     not_member / members_2_to_6），ok:true 只代表 store 真落了盘。
     成功时追加一条 kind:"system" transcript —— 群里看得见「谁进谁出」，
     而不是 members 数组在背后悄悄变了。 */
  const ROOM_MEMBERS_MIN = 2;
  const ROOM_MEMBERS_MAX = 6;
  function roomBotName(botId) {
    try {
      const data = loadBots();
      const b = (data.bots || []).find(x => x && x.id === botId);
      return b ? String(b.name || b.id) : String(botId);
    } catch (_) { return String(botId); }
  }
  function roomMembersUpdate(input) {
    const opts = input || {};
    const roomKey = String(opts.room || "").trim();
    const botId = String(opts.bot_id || "").trim();
    const act = String(opts.action || "").trim();
    if (!roomKey || !botId) return { ok: false, error: "members_need_room_and_bot" };
    if (act !== "add" && act !== "remove") return { ok: false, error: "action_unsupported" };
    let rooms;
    try { rooms = requireWritableRooms(); }
    catch (err) { return { ok: false, error: String((err && err.code) || "rooms_store_unreadable") }; }
    const hit = (rooms.rooms || []).find(r => r && (r.id === roomKey || r.title === roomKey));
    if (!hit) return { ok: false, error: "room_not_found", room: roomKey };
    if (!Array.isArray(hit.members)) hit.members = [];
    const isMember = hit.members.indexOf(botId) >= 0;
    if (act === "add") {
      let known;
      try {
        const bots = loadBots();
        known = (bots.bots || []).some(x => x && x.id === botId);
      } catch (_) {
        return { ok: false, error: "bots_store_unreadable" };
      }
      if (!known) return { ok: false, error: "bot_not_found", bot: botId };
      if (isMember) return { ok: false, error: "already_member", bot: botId, members: hit.members.slice() };
      if (hit.members.length + 1 > ROOM_MEMBERS_MAX) {
        return { ok: false, error: "members_2_to_6", max: ROOM_MEMBERS_MAX, members: hit.members.slice() };
      }
      hit.members.push(botId);
    } else {
      if (!isMember) return { ok: false, error: "not_member", bot: botId, members: hit.members.slice() };
      if (hit.members.length - 1 < ROOM_MEMBERS_MIN) {
        return { ok: false, error: "members_2_to_6", min: ROOM_MEMBERS_MIN, members: hit.members.slice() };
      }
      hit.members = hit.members.filter(x => x !== botId);
    }
    const name = roomBotName(botId);
    const at = nowIso();
    if (!Array.isArray(hit.transcript)) hit.transcript = [];
    hit.transcript.push({
      kind: "system",
      room_id: hit.id,
      speaker: "system",
      text: act === "add" ? `＋ ${name} 加入了群聊。` : `－ ${name} 离开了群聊。`,
      at
    });
    if (hit.transcript.length > 200) hit.transcript = hit.transcript.slice(-200);
    saveRooms(rooms);
    return {
      ok: true,
      mode: "host_room_members_update",
      action: act,
      room: hit.id,
      title: hit.title,
      bot: botId,
      members: hit.members.slice(),
      at
    };
  }

  /**
   * 群改名。以前没有这个入口：群名只在建房那一刻由 brief/模板定下来，之后
   * 用户在界面上找不到任何地方能改 —— 建错一次（或建队自动取的名字不合适）
   * 就永久留在侧栏，而且同名群多了以后根本分不清（「两个自媒体内容团队」）。
   *
   * 边界：
   *   · 空名 / 全空白 → title_empty，不写盘；
   *   · 超过 40 字 → title_too_long（侧栏一行放不下，也不该让名字变成一段话）；
   *   · 群不存在 → room_not_found；
   *   · 与其他群同名 → **允许**，但把重名的 room id 一起返回，界面负责提示
   *     「已存在同名群」——不靠替用户改名来掩盖冲突；
   *   · 改成功落一条 kind:"system" 转录（与成员增删同一条纪律：群里的变化
   *     群里看得见，不在数组里背后改）。
   */
  const ROOM_TITLE_MAX = 40;
  function roomRename(input) {
    const opts = input || {};
    const roomKey = String(opts.room || opts.room_id || "").trim();
    const rawTitle = String(opts.title == null ? "" : opts.title);
    if (!roomKey) return { ok: false, error: "room_required" };
    const title = rawTitle.trim().replace(/\s+/g, " ");
    if (!title) return { ok: false, error: "title_empty" };
    if (title.length > ROOM_TITLE_MAX) {
      return { ok: false, error: "title_too_long", max: ROOM_TITLE_MAX, length: title.length };
    }
    let rooms;
    try { rooms = requireWritableRooms(); }
    catch (err) { return { ok: false, error: String((err && err.code) || "rooms_store_unreadable") }; }
    const list = rooms.rooms || [];
    const hit = list.find(r => r && (r.id === roomKey || r.title === roomKey));
    if (!hit) return { ok: false, error: "room_not_found", room: roomKey };
    const previous = String(hit.title || "");
    const duplicates = list
      .filter(r => r && r.id !== hit.id && String(r.title || "") === title)
      .map(r => r.id);
    if (previous === title) {
      return {
        ok: true, mode: "host_room_rename", room: hit.id, title, previous,
        unchanged: true, duplicates,
      };
    }
    hit.title = title;
    const at = nowIso();
    if (!Array.isArray(hit.transcript)) hit.transcript = [];
    hit.transcript.push({
      kind: "system",
      room_id: hit.id,
      speaker: "system",
      text: `群名称已改为「${title}」（原「${previous}」）。`,
      at,
    });
    if (hit.transcript.length > 200) hit.transcript = hit.transcript.slice(-200);
    saveRooms(rooms);
    return {
      ok: true,
      mode: "host_room_rename",
      room: hit.id,
      title,
      previous,
      duplicates,
      at,
    };
  }

  /**
   * GP-148 §1-J2：自然语言建房的 Host 落点。三条硬要求：
   *  1) 名字认不出来就点名返回 names_not_found，绝不建「少一个人的残群」，
   *     也绝不返回 ok:true 假装成功；
   *  2) 同成员 + 同群名在短窗内重复 → 返回既有群（幂等），不新建第二个；
   *  3) 建房成功时在 transcript 落一条确定的 kind:"system" 回执行（带群名与
   *     成员名单），用户在同一次回合里就能看见「群真的建出来了」，侧栏也有成员数。
   * 既有返回形状 {ok,mode,pretend_saved,room} 不变，只新增可选字段。
   */
  function roomCreate(bots_csv, title) {
    const data = loadBots();
    const botsList = data.bots;
    const nameOf = (id) => {
      const b = botsList.find(x => x && x.id === id);
      return b ? String(b.name || b.id) : String(id);
    };

    // Parse bots_csv
    const memberIds = String(bots_csv || "").split(",").map(s => s.trim()).filter(Boolean);

    // Resolve member IDs/names
    const resolved = [];
    const names_not_found = [];
    for (const idOrName of memberIds) {
      // Accept "bit" as alias for "agent-bit"
      if (idOrName === "bit" || idOrName === "agent-bit") {
        const bot = botsList.find(b => b.id === "agent-bit");
        if (bot) {
          if (!resolved.includes(bot.id)) resolved.push(bot.id);
        } else if (!names_not_found.includes(idOrName)) {
          names_not_found.push(idOrName);
        }
        continue;
      }
      const bot = botsList.find(b => b.id === idOrName || b.name === idOrName);
      if (bot) {
        if (!resolved.includes(bot.id)) resolved.push(bot.id);
      } else if (!names_not_found.includes(idOrName)) {
        names_not_found.push(idOrName);
      }
    }

    // 负例优先：只要有一个点名说不出来，就不建残群（哪怕剩下的人数已经够 2 个）。
    if (names_not_found.length) {
      return {
        ok: false,
        error: "names_not_found",
        names_not_found,
        resolved_names: resolved.map(nameOf),
        mode: "host_group_chat",
        pretend_saved: false
      };
    }

    if (resolved.length < 2 || resolved.length > 6) {
      return {
        ok: false,
        error: "members_2_to_6",
        resolved_count: resolved.length,
        names_not_found: [],
        mode: "host_group_chat",
        pretend_saved: false
      };
    }

    // Generate title if empty
    if (!title || !title.trim()) {
      const names = resolved.map(nameOf);
      title = `Group · ${names[0]} + ${names[1]}`;
    }
    const finalTitle = title.trim();
    const setKey = resolved.slice().sort().join(",");

    const rooms = requireWritableRooms();

    // 幂等：**同群名 + 同成员集合 = 同一个群**，无条件复用。
    // 旧版只在这个组合的 10 分钟窗口内去重（ROOM_DUP_WINDOW_MS），于是隔一天
    // 再点一次「一键成队」就又多一个同名群：侧栏两个「自媒体内容团队」，
    // 点开内容一个 22 行一个 1 行 —— 用户根本分不清哪个是哪个。
    // 真想要一个新群，改名再建即可（改名入口见 roomRename）。
    const existing = (rooms.rooms || []).find(r => {
      if (!r || String(r.title || "") !== finalTitle) return false;
      return (r.members || []).slice().sort().join(",") === setKey;
    });
    if (existing) {
      return {
        ok: true,
        mode: "host_group_chat",
        existing: true,
        reused_reason: "same_title_and_members",
        pretend_saved: false,
        room: existing
      };
    }

    const at = nowIso();
    const names = resolved.map(nameOf);
    const roomId = "room-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    const room = {
      id: roomId,
      title: finalTitle,
      members: resolved,
      created_at: at,
      // 确定的建房回执：内核不参与措辞，Host 一次写好，渲染层按 kind 渲染。
      transcript: [{
        kind: "system",
        room_id: roomId,
        speaker: "system",
        text: `已创建群聊「${finalTitle}」，成员 ${names.length} 人：${names.join("、")}。`,
        at
      }]
    };
    rooms.rooms.push(room);
    saveRooms(rooms);

    return {
      ok: true,
      mode: "host_group_chat",
      pretend_saved: false,
      room
    };
  }

  function roomTurn(room_id, text, now, message_id) {
    const rooms = requireWritableRooms();
    const room = rooms.rooms.find(r => r.id === room_id);
    if (!room) {
      return { ok: false, error: "room_not_found", mode: "host_room_turn" };
    }

    const botsData = loadBots();
    const members = room.members.map(id => {
      const bot = botsData.bots.find(b => b.id === id);
      // 带 job/description:「这个群是不是一支团队」的判据靠它
      // (成员**被赋予了职责** ⇒ 是团队,不是随手拉人聊天)。
      return bot
        ? {
            id: bot.id, name: bot.name,
            job: String(bot.job || ""),
            description: String(bot.description || ""),
          }
        : { id, name: id, job: "", description: "" };
    });

    // Parse mentions — GP-51 semantics kept (@Name directed / @everyone all /
    // no @ = members decide), GP-144 extends it to several leading mentions so
    // "@A @B task" runs exactly the named members. Member names may contain
    // spaces ("市场 分析员") — at each position the longest member name wins,
    // then the single-token form, so both spellings keep routing.
    let responders = members;
    /* 没有 @ 的时候，以前的默认是 bot_discretion（每个成员都被问一遍「你要不要答」，
       然后所有说「要」的同时各跑一轮）。用户看到的是「一堆活全部 bot 开始工作」。
       现在默认 auto_route：宿主按对话内容算**唯一负责人**，一次只跑一个，
       做完交给下一棒；看不出该谁做就停下来问用户。 */
    let responder_policy = "auto_route";
    const namedResponders = [];
    const unknownMentions = [];
    let wantsAll = false;
    let rest = String(text || "");
    while (/^@/.test(rest)) {
      const after = rest.slice(1);
      const hitMember = members
        .filter((m) => m.name && after.startsWith(m.name))
        .sort((a, b) => String(b.name).length - String(a.name).length)[0];
      const tokenMatch = after.match(/^[^\s]+/);
      const token = tokenMatch ? tokenMatch[0] : "";
      if (!hitMember && token === "everyone") {
        wantsAll = true;
        rest = after.slice(token.length).replace(/^\s*/, "");
        continue;
      }
      const name = hitMember ? hitMember.name : token;
      if (!name) break;
      const target = members.find((m) => m.name === name || m.id === name);
      if (target && !namedResponders.some((x) => x.id === target.id)) {
        namedResponders.push(target);
      } else if (!target && !wantsAll && unknownMentions.length < 5) {
        // 打错了 / 不在本群：不能假装定向成功，渲染层要如实说明「按未点名处理」。
        unknownMentions.push(String(name).slice(0, 40));
      }
      rest = after.slice(name.length).replace(/^\s*/, "");
    }
    if (wantsAll) {
      responder_policy = "all";
    } else if (namedResponders.length) {
      responders = namedResponders;
      responder_policy = "mentioned_only";
    }
    // A typed mention that resolves to no member leaves the GP-51 default
    // untouched: members decide, the Host never invents a directed route.

    const transcript_entry = {
      // GP-146: the durable transcript now renders per entry, so a user row is
      // explicitly typed. Rows written before this have no `kind` — the renderer
      // keeps showing them as user lines instead of dropping them.
      kind: "user",
      speaker: "user",
      room_id,
      text,
      responders: responders.map(r => r.id),
      responder_policy,
      unknown_mentions: unknownMentions.length ? unknownMentions : undefined,
      // Q-5: 一条消息的身份。幂等要认「同一次投递」,不是「同样的文字」——
      // 用户把同一句话再发一遍,那是两条消息、两个任务。
      // 渠道侧(钉钉 msgId / 飞书 message_id)自带稳定 id;桌面/CLI 每次发送新生成。
      message_id: String(message_id || "") || undefined,
      at: now || nowIso()
    };
    // AR-08：无 @ 时 responders 是候选池，不是已确定的发言者；真正的选择由
    // auto_route（宿主按内容派给一个负责人）或 discretetion（每个成员自己决定）落定，
    // final_report.responders 才是结果。
    if (responder_policy === "bot_discretion" || responder_policy === "auto_route") {
      transcript_entry.responders_are_candidates = true;
    }

    return {
      ok: true,
      mode: "host_room_turn",
      pretend_saved: false,
      transcript_entry,
      escalations: "dm-only"
    };
  }

  // GP-51/52: persist the routed line into the room's durable transcript (capped at 200).
  function appendRoomTranscript(room_id, entry) {
    const rooms = requireWritableRooms();
    const room = rooms.rooms.find(r => r.id === room_id);
    if (!room) return { ok: false, error: "room_not_found" };
    if (!Array.isArray(room.transcript)) room.transcript = [];
    room.transcript.push(entry);
    if (room.transcript.length > 200) room.transcript = room.transcript.slice(-200);
    saveRooms(rooms);
    return { ok: true, mode: "host_room_transcript_append" };
  }

  // GP-143/144: orchestrate one task across room responders, then aggregate a
  // `final_report`. The per-responder LLM turn is *injected* (`deps.runResponderTurn`)
  // because in production it is executed by the MoonBit turn runner; this engine
  // owns routing, guards, the transcript schema and honest N/总 aggregation so it
  // is unit-testable without a kernel. Guards (per plan G-E): membership, budget
  // ≤6, recursion depth (a responder turn must not re-enter orchestration),
  // idempotency (one final_report per task), per-responder timeout.
  const _orchInflight = new Set();

  /* KP-02：用户按「停止」要能真的停下群回合。引擎内部的超时取消用的是
   * createCancelScope，但那些 scope 只挂在各自的 withTimeout 上，外面的停止按钮
   * 够不着。这里把每个在跑的 scope 登记进一张表，停止时统一 cancel；回合真正
   *  settle 之后（runner promise 的 finally）把自己摘掉，表里剩下的就是在跑的。
   * cancel 自身也摘 —— 超时路径取消后不必等 runner 收尾才不再算「在跑」。 */
  const _activeRoomScopes = new Set();
  // 任务级 scope 表(taskSig → 在跑的 scope 集合)—— 让「刹停」能**精准命中一个任务**,
  // 而不是像 cancelActiveRoomTurns 那样把整台机器上的群回合全停掉。
  const _taskScopes = new Map();
  function roomCancelScope() {
    const s = roomOrchestrator.createCancelScope();
    _activeRoomScopes.add(s);
    const cancel = s.cancel.bind(s);
    s.cancel = (why) => {
      const r = cancel(why);
      _activeRoomScopes.delete(s);
      return r;
    };
    return s;
  }
  function forgetRoomScope(s) {
    _activeRoomScopes.delete(s);
    if (s && s.taskSig && _taskScopes.has(s.taskSig)) {
      const set = _taskScopes.get(s.taskSig);
      set.delete(s);
      if (!set.size) _taskScopes.delete(s.taskSig);
    }
  }

  /** 把一个 scope 挂到任务上(可写回 scope.taskSig,方便收尾时摘掉)。 */
  function registerTaskScope(taskSig, s) {
    const key = String(taskSig || "").trim();
    if (!key || !s) return;
    s.taskSig = key;
    if (!_taskScopes.has(key)) _taskScopes.set(key, new Set());
    _taskScopes.get(key).add(s);
    // 包一层 cancel:取消的那一刻就把 scope 从**所有**表里摘干净
    // (否则任务表里会留着已经停掉的 scope ⇒ 指挥台以为还在跑,
    //  再点一次刹停会得到 ok=false 却说不出原因)。
    if (!s.__bitbotWrapped) {
      s.__bitbotWrapped = true;
      const rawCancel = s.cancel.bind(s);
      s.cancel = (why) => {
        const r = rawCancel(why);
        _activeRoomScopes.delete(s);
        const set = _taskScopes.get(key);
        if (set) {
          set.delete(s);
          if (!set.size) _taskScopes.delete(key);
        }
        return r;
      };
    }
  }

  /**
   * 刹停某一个正在跑的任务。
   * @returns {{ok:boolean, cancelled:number, error?:string}}
   */
  function cancelRoomTask(taskSig, reason) {
    const key = String(taskSig || "").trim();
    if (!key) return { ok: false, cancelled: 0, error: "task_sig_required" };
    const set = _taskScopes.get(key);
    if (!set || !set.size) {
      // 没有在跑的 —— **如实说没有**,不假装停掉了什么。
      return { ok: false, cancelled: 0, error: "no_running_task" };
    }
    let n = 0;
    for (const s of [...set]) {
      if (s.cancel(reason || "user_stop")) n += 1;
    }
    if (!n) {
      // 表里还挂着但都已经停过了 —— 如实说"没有在跑的",
      // 别让 UI 显示成 "没停掉:undefined"。
      return { ok: false, cancelled: 0, error: "no_running_task" };
    }
    return { ok: true, cancelled: n };
  }

  /** 这个任务现在还在跑吗(指挥台用它决定按钮是否可点)。 */
  function taskIsRunning(taskSig) {
    const set = _taskScopes.get(String(taskSig || "").trim());
    return !!(set && set.size);
  }
  /** 停止当前所有在跑的群回合，返回真取消了几条（0 = 根本没有在跑的）。 */
  function cancelActiveRoomTurns(reason) {
    let n = 0;
    for (const s of [..._activeRoomScopes]) {
      if (s.cancel(reason || "user_stop")) n++;
    }
    _activeRoomScopes.clear();
    return n;
  }

  // GP-146 持久层有界合同：房间转录是共享面，任何一行都不能无界增长——完整正文
  // 已经由那条 bot_reply 行承载，final_report 的分区/任务只留摘要，失败原因截断。
  // 上限可由环境收紧（默认与渲染合同一致，渲染层不再自己裁长度）。
  const ROOM_TEXT_MAX = Math.max(200, Number(process.env.BITBOT_ROOM_TEXT_MAX || 4000));
  const ROOM_SUMMARY_MAX = 240;
  const ROOM_REASON_MAX = 200;
  const ROOM_TASK_MAX = 240;
  // 「停下来确认」那一问的正文上限：问题是给人读的，太长就不成问题了。
  const CONFIRM_MAX_CHARS = 300;
  function clipRoomText(raw, max) {
    const s = String(raw == null ? "" : raw);
    const limit = Number(max) > 0 ? Number(max) : ROOM_TEXT_MAX;
    if (s.length <= limit) return { text: s, truncated: false };
    return { text: s.slice(0, limit) + "…", truncated: true };
  }
  // 超时必须**真的取消**：把取消信号传给执行层（ctx.cancelPromise / ctx.isCancelled），
  // 而不是只 reject 外层 promise —— 那样内核回合会继续跑、继续烧 token。
  function withCancelTimeout(promise, ms, onTimeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          if (typeof onTimeout === "function") onTimeout();
        } catch (_) {
          /* 取消通道本身不能抛 */
        }
        reject(new Error("responder_timeout"));
      }, ms);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  /* ===== 群任务的「产物」：宿主落盘，不靠模型工具 =====
     用户要的是「最后输出按要求的产物」。这里由宿主把接力链合成一份 markdown 写到
     data/desktop/room-deliverables/<room>/ 下，群里给一个可点开的路径 —— 是真文件，
     可校验（存在 / 字节数 / 内容含各棒成果），不是一句「我做到了」。 */
  function roomDeliverableDir(roomId) {
    return path.join(DESKTOP_DIR, "room-deliverables", roomOrchestrator.sanitizeBoardKey(roomId));
  }
  function writeRoomDeliverable(input) {
    const o = input || {};
    const room = o.room || {};
    const markdown = String(o.markdown || "");
    if (!markdown.trim()) return { ok: false, error: "empty_deliverable" };
    const dir = roomDeliverableDir(room.id);
    const base = String(roomOrchestrator.clip(String(o.task || "群任务"), 24))
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/[\s-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "群任务";
    const sig = roomOrchestrator.sanitizeBoardKey(String(o.taskSig || "")).slice(-10) || "d";
    const name = base + "-" + sig + ".md";
    const file = path.join(dir, name);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + ".tmp." + process.pid + "." + Date.now() + "." + Math.random().toString(36).slice(2, 8);
      fs.writeFileSync(tmp, markdown, "utf8");
      fs.renameSync(tmp, file);
      return { ok: true, name, path: file, bytes: Buffer.byteLength(markdown, "utf8") };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  /* 产物正文太短就不落文件：一句「好的」不配占一个 .md。
     这是「没有产物」而不是「产物失败」—— 群里的汇总卡照旧给答复。 */
  const MIN_DELIVERABLE_CHARS = 20;
  function deliverableFromTurns(input) {
    const o = input || {};
    const turns = Array.isArray(o.turns) ? o.turns : [];
    const usable = turns.filter((t) => t && t.ok && String(t.text || "").trim());
    if (!usable.length) return { ok: false, error: "no_content" };
    const chars = usable.reduce((n, t) => n + String(t.text || "").trim().length, 0);
    if (chars < MIN_DELIVERABLE_CHARS) return { ok: false, error: "too_short", chars };
    try {
      const markdown = roomOrchestrator.composeDeliverable({
        task: o.task, relay: turns, roomTitle: o.roomTitle, at: o.at, mode: o.mode || "relay",
      });
      return writeRoomDeliverable({ room: o.room, task: o.task, taskSig: o.taskSig, markdown });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  /* 上一轮有没有「停下来等用户回答」的那一问。
     转录是唯一的状态源：用户这句已经落盘了，所以先跳过本轮这条 user 行，再看上一行。 */
  function pendingConfirmOf(room, messageId) {
    const t = Array.isArray(room && room.transcript) ? room.transcript : [];
    if (!t.length) return null;
    let i = t.length - 1;
    const last = t[i];
    if (last && last.kind === "user") {
      // 只有当它就是本轮这条投递（或调用方没给 id）时才跳过，避免把上一轮的提问错认。
      const sameId = String(last.message_id || "") === String(messageId || "");
      if (!sameId && messageId) return null;
      i--;
    }
    for (; i >= 0; i--) {
      const e = t[i];
      if (!e || !e.kind) continue;
      if (e.kind === "confirm_request") return e.answered_at ? null : e;
      return null;
    }
    return null;
  }
  function markConfirmAnswered(roomId, confirmAt, answer) {
    try {
      const rooms = requireWritableRooms();
      const room = (rooms.rooms || []).find((r) => r.id === roomId);
      if (!room || !Array.isArray(room.transcript)) return false;
      for (let i = room.transcript.length - 1; i >= 0; i--) {
        const e = room.transcript[i];
        if (e && e.kind === "confirm_request" && String(e.at || "") === String(confirmAt || "")) {
          e.answered_at = nowIso();
          e.answer = clipRoomText(answer, ROOM_SUMMARY_MAX).text;
          saveRooms(rooms);
          return true;
        }
      }
    } catch (_) {
      /* 标记失败不影响本轮继续：最多下次再问一遍 */
    }
    return false;
  }

  function orchestrateRoom(input) {    const opts = input || {};
    const deps = opts.deps || {};
    const roomKey = String(opts.room || "").trim();
    const task = String(opts.task || "").trim();
    if (!roomKey || !task) {
      return { ok: false, error: "orchestrate_needs_room_and_task", mode: "host_orchestrate_room" };
    }
    const rooms = requireWritableRooms();
    const room = (rooms.rooms || []).find(r => r.id === roomKey || r.title === roomKey);
    if (!room) return { ok: false, error: "room_not_found", room: roomKey, mode: "host_orchestrate_room" };

    const bots = (loadBots().bots) || [];
    const resolve = (idOrName) => {
      const b = bots.find(x => x.id === idOrName || x.name === idOrName);
      return b ? { id: b.id, name: b.name, job: b.job || "", description: b.description || "" } : null;
    };
    const memberIds = room.members || [];
    const toList = Array.isArray(opts.to)
      ? opts.to
      : String(opts.to || "").split(",").map(s => s.trim()).filter(Boolean);
    let responders;
    if (toList.length) {
      responders = [];
      for (const t of toList) {
        const r = resolve(t);
        if (!r) return { ok: false, error: "responder_not_found", responder: t, mode: "host_orchestrate_room" };
        if (!memberIds.includes(r.id)) return { ok: false, error: "responder_not_member", responder: r.id, mode: "host_orchestrate_room" };
        if (!responders.some(x => x.id === r.id)) responders.push(r);
      }
    } else {
      responders = memberIds.map(resolve).filter(Boolean);
    }
    if (responders.length < 1) return { ok: false, error: "no_responders", mode: "host_orchestrate_room" };
    if (responders.length > 6) return { ok: false, error: "too_many_responders", count: responders.length, max: 6, mode: "host_orchestrate_room" };
    // 没有点名时默认 auto_route（单负责人串行接力），不再是「所有人自己决定要不要答」。
    // `bot_discretion` / `all` / `mentioned_only` 仍是显式可选策略（用户点名或调用方指定）。
    const responderPolicy = String(opts.policy || (toList.length ? "mentioned_only" : "auto_route")).trim();

    // Q-5: 幂等键 = 房间 + **投递 id**。
    // 没有 id 时退回文字(向后兼容旧转录),但那时「同样的字」只能当同一次投递。
    const sigKey = String(opts.message_id || "").trim() || task.toLowerCase();
    const taskSig = room.id + "|" + sigKey;
    if (_orchInflight.has(taskSig)) {
      return { ok: false, error: "orchestrate_recursion", depth: 1, mode: "host_orchestrate_room" };
    }
    const prior = (room.transcript || []).find(
      (e) => e && (e.kind === "final_report" || e.kind === "confirm_request") && e.task_sig === taskSig,
    );
    if (prior && !opts.force) {
      // 幂等命中：不扇出、不起新回合，只回既有汇报。渲染层据此说明「未重复执行」，
      // 不能让人以为刚刚又跑了一遍。
      // confirm_request 也进幂等：停下来问用户的那一轮同样只能问一次。
      return {
        ok: true, mode: "host_orchestrate_room", deduped: true,
        paused: prior.kind === "confirm_request" || undefined,
        awaiting: prior.kind === "confirm_request"
          ? { bot_id: prior.bot_id || "", name: prior.name || "", question: prior.question || "", stage: prior.stage || "" }
          : undefined,
        returned: prior.returned, total: prior.total, partial: prior.partial,
        responder_policy: prior.responder_policy || opts.policy || "", final_report: prior,
      };
    }
    // 依赖回落:调用方显式给的优先,否则用 surface 上注入的运行时依赖
    // (setRoomRuntimeDeps)。CLI/移动端走的就是这条回落 —— 桌面和别的端
    // 走同一条扇出路径,不会一个回一个不回。
    const runResponderTurn =
      typeof deps.runResponderTurn === "function"
        ? deps.runResponderTurn
        : roomRuntimeDeps && typeof roomRuntimeDeps.runResponderTurn === "function"
          ? roomRuntimeDeps.runResponderTurn
          : null;
    const selectResponders =
      typeof deps.selectResponders === "function"
        ? deps.selectResponders
        : roomRuntimeDeps && typeof roomRuntimeDeps.selectResponders === "function"
          ? roomRuntimeDeps.selectResponders
          : null;
    if (typeof runResponderTurn !== "function") {
      return {
        ok: false, error: "responder_runner_required", mode: "host_orchestrate_room",
        note: "GP-143 responder turn is run by the MoonBit runner; inject deps.runResponderTurn",
      };
    }
    // `bot_discretion` **必须**有真实的成员自决(它整个语义就是"成员自己决定")。
    if (responderPolicy === "bot_discretion" && typeof selectResponders !== "function") {
      return {
        ok: false, error: "discretion_selector_required", mode: "host_orchestrate_room",
        note: "bot_discretion must be a real per-member decision; inject deps.selectResponders",
      };
    }
    // 团队模式**没有** selector 时优雅降级:不筛人,全员并行,只是拿不到认领。
    // ⇒ 少一个能力(认领),不该让整个编排失败 —— 失败才会让"团队"变回"广播"都没了。
    const canAskMembers = typeof selectResponders === "function";

    const timeoutMs = Number(deps.timeoutMs || 120000);
    const decisionTimeoutMs = Number(deps.discretionTimeoutMs || Math.min(timeoutMs, 30000));
    const at = nowIso();
    const withTimeout = withCancelTimeout;
    const candidates = responders.slice();
    const cleanDecisions = (list) => {
      if (!Array.isArray(list)) return undefined;
      return list.slice(0, 6).map((d) => {
        const id = String((d && d.bot_id) || "").trim();
        if (!id) return null;
        const out = {
          bot_id: id,
          name: clipRoomText((d && d.name) || "", 80).text,
          respond: Boolean(d && d.respond),
        };
        // 认领要**留着**:它是这个成员负责哪一段(B-7)。
        // 不留 ⇒ 分工信息在清洗这一步就没了,后面全白搭。
        if (d && d.claim) {
          const c = clipRoomText(String(d.claim), ROOM_REASON_MAX).text;
          if (c) out.claim = c;
        }
        if (d && d.fail_open) out.fail_open = true;
        if (d && d.error) out.error = clipRoomText(d.error, ROOM_REASON_MAX).text;
        return out;
      }).filter(Boolean);
    };

    // 团队预算（轮次 / 时间 / token 估算）：宿主唯一裁决者，超了就停并如实说明。
    const budget = roomOrchestrator.createTeamBudget({
      maxTurns: Number(deps.maxTurns || process.env.BITBOT_ROOM_BUDGET_TURNS || 7),
      maxWallMs: Number(deps.maxWallMs || process.env.BITBOT_ROOM_BUDGET_WALL_MS || 600000),
      maxTokens: Number(deps.maxTokens || process.env.BITBOT_ROOM_BUDGET_TOKENS || 200000),
      maxMembers: 6,
    });

    // ===== auto_route：单负责人 + 串行接力 + 产物落盘 + 遇不明就停 =====
    // 用户的诉求原话：「针对对话内容，分配给某一个 bot，然后一步一步的进行协作，
    // 最后输出按要求的产物（如果中间某一个 bot 有不明确的就停下来进行确认之后再继续）」。
    // 这一条路径就是那句话的实现；上层扇出（@A @B / 全员）保持不变。
    // ===== 团队模式(B-7)=====
    //
    // `auto_route` 的语义**不动**:用户的原话是「分配给某一个 bot,然后一步一步
    // 协作」⇒ 唯一负责人 + 串行接力 + 看不出该谁做就停下来问。那是刻意定的,
    // 门禁 Q-5 明确守着它(「auto_route 不再逐人问你要不要答」)。
    //
    // 那"随时可以指挥的团队"从哪来?从**组建团队**这个动作来:
    // 成员被**赋予了职责**(job/description)⇒ 这个群就是一支团队,不是闲聊。
    // ⇒ 团队里的任务走**并行 + 分工**;随手拉几个人聊天仍然走 auto_route。
    //
    // 判据:群里**至少两个成员有职责**。单成员 / 无职责 ⇒ 老行为。
    // 显式覆盖:opts.teamMode = true/false;BITBOT_ROOM_TEAM_MODE=0 全局退回。
    // ===== 团队模式(B-7)=====
    //
    // `auto_route` 的语义**不动**:用户的原话是「分配给某一个 bot,然后一步一步
    // 协作」⇒ 唯一负责人 + 串行接力 + 看不出该谁做就停下来问。那是刻意定的,
    // 门禁 Q-5 明确守着它(「auto_route 不再逐人问你要不要答」)。
    //
    // 那"随时可以指挥的团队"从哪来?从**组建团队**这个动作来:
    // 成员被**赋予了职责**(job/description)⇒ 这个群就是一支团队,不是闲聊。
    // ⇒ 团队里的任务走**并行 + 分工**;随手拉几个人聊天仍然走 auto_route。
    //
    // 判据:群里**至少两个成员有职责**。单成员 / 无职责 ⇒ 老行为。
    // 显式覆盖:opts.teamMode = true/false;BITBOT_ROOM_TEAM_MODE=0 全局退回。
    const teamRoleCount = candidates.filter(
      (r) => String((r && r.job) || "").trim() ||
        String((r && r.description) || "").trim(),
    ).length;
    const teamMode =
      opts.teamMode === true
        ? true
        : opts.teamMode === false
          ? false
          : process.env.BITBOT_ROOM_TEAM_MODE !== "0" &&
            teamRoleCount >= 2 &&
            // 无人值守(定时任务到点)**不开团队模式**:
            // 常开机器上没人在旁边 ⇒ 一队人并行 = 成本 ×N 且没人看着。
            // ⇒ 这种场景走「按名册交给第一位」的兜底(如实记下是兜底,不是判断)。
            !opts.unattended;
    let isRelay = responderPolicy === "auto_route" && !teamMode;
    const pendingConfirm = isRelay ? pendingConfirmOf(room, opts.message_id) : null;

    async function relayTurn() {
      const roster = candidates.map((r) => ({
        id: r.id, name: r.name, job: r.job, description: r.description,
      }));
      const answer = pendingConfirm ? task : "";
      // 上一轮宿主问过「该谁做」，用户回了一句「大家一起」——用户要全员，但这里仍然
      // 一次只跑一位；只是把第一个人当作本棒负责人，让它按需往下交接。
      const wantsEveryone = Boolean(pendingConfirm) && /大家|全体|都上|一起|all\b/i.test(task);
      let route = roomOrchestrator.routeTask({
        task,
        members: roster,
        explicitTo: "",
        resume: pendingConfirm && pendingConfirm.bot_id ? { bot_id: pendingConfirm.bot_id } : null,
      });
      if (route.mode === "unclear" && wantsEveryone) {
        route = {
          mode: "user_all_to_first", owner: roster[0], ranking: route.ranking,
          margin: route.margin, reason: "user_asked_everyone_relay_keeps_serial",
        };
      }
      if (route.mode === "unclear" && opts.unattended && roster.length) {
        // 无人值守(定时任务到点):「这句话我没看出该谁做」这句话在常开机器上
        // **问不到人** —— 桌面上停下来问是对的,机器上停下来就是永远卡死。
        // 这种情况下按名册顺序交给第一位,并如实记下这是兜底、不是判断。
        route = {
          mode: "unattended_fallback_to_first", owner: roster[0], ranking: route.ranking,
          margin: route.margin, reason: "no_one_to_ask_fallback_to_first",
        };
      }
      const routeOut = {
        mode: route.mode, reason: route.reason,
        owner: route.owner ? route.owner.id : "",
        owner_name: route.owner ? route.owner.name : "",
        margin: route.margin,
        ranking: (route.ranking || []).slice(0, 4).map((x) => ({ id: x.id, name: x.name, score: x.score })),
      };
      if (pendingConfirm && pendingConfirm.at) {
        markConfirmAnswered(room.id, pendingConfirm.at, task);
      }

      // ---- 停点 1：看不出该谁做。不开工，先问用户；问完这轮就结束。 ----
      //
      // 团队模式**不问**：成员自己能认领(自决回合就是"谁能干")。
      // ⇒ 问用户是**单助手**语义下的兜底(那个群没有一支成形的队伍);
      // ⇒ 一支有职责的团队,应该让它自己接活,而不是每次都回来问人。
      if ((route.mode === "unclear" || !route.owner) && !teamMode) {
        const names = roster.map((r) => r.name).join("、");
        const question = route.reason === "two_equally_likely"
          ? "这句话我看两个人都像：{a}、{b}。要谁来做？回一句名字就行。"
              .replace("{a}", (route.ranking[0] && route.ranking[0].name) || "?")
              .replace("{b}", (route.ranking[1] && route.ranking[1].name) || "?")
          : "这句话我没看出该谁做（本群成员：" + names + "）。回一句名字，或者直接说「大家一起」。";
        const q = clipRoomText(question, CONFIRM_MAX_CHARS).text;
        const entry = {
          kind: "confirm_request", room_id: room.id, speaker: "host", stage: "route",
          question: q, candidates: roster.map((r) => ({ id: r.id, name: r.name })),
          task: clipRoomText(task, ROOM_TASK_MAX).text, task_sig: taskSig, at,
        };
        appendRoomTranscript(room.id, entry);
        return {
          ok: true, mode: "host_orchestrate_room", paused: true, needs_route: true,
          routed: routeOut, awaiting: { bot_id: "", name: "", question: q, stage: "route" },
          message: q, returned: 0, total: 0, partial: false, final_report: null,
        };
      }

      // ---- 串行接力：一次只跑一个成员，上一棒的产出交给下一棒 ----
      const chain = [];
      const seen = new Set();
      let current = route.owner;
      let prev = null;
      let confirmAnswer = answer && pendingConfirm && pendingConfirm.bot_id ? answer : "";
      let paused = null;
      const maxHops = Math.max(1, Math.min(
        Number(deps.maxHops || process.env.BITBOT_ROOM_RELAY_MAX_HOPS || roomOrchestrator.RELAY_MAX_HOPS),
        roster.length,
        roomOrchestrator.RELAY_MAX_HOPS,
      ));
      for (let hop = 0; hop < maxHops && current; hop++) {
        if (seen.has(current.id)) break; // 踢皮球：同一个人不跑第二棒
        seen.add(current.id);
        if (typeof deps.onFanout === "function") {
          // 每一棒都播一次：界面上的「工作中」必须跟着**当前这一棒**走。
          // 只播第一棒的话，第二棒在跑时用户还看着第一个人的名字。
          try {
            deps.onFanout({
              room: room.id, task, responders: [current], candidates,
              policy: responderPolicy, member_count: memberIds.length,
              relay: true, hop, route: routeOut,
            });
          } catch (_) {
            /* 进度提示是 best effort */
          }
        }
        const boardText = roomBoard.snapshot(room.id).text;
        const prompt = roomOrchestrator.buildRelayPrompt({
          task, roster, hop, prev, boardText, confirmAnswer, maxHops,
        });
        const promptTokens = roomOrchestrator.estimateTokens(prompt);
        const gate = budget.canStart({ tokens: promptTokens });
        if (!gate.ok) {
          budget.mark(gate.reason);
          chain.push({
            bot_id: current.id, name: current.name, ok: false, skipped: true,
            text: "", artifacts: [], error: "budget_" + gate.reason, hop,
          });
          break;
        }
        const scope = roomCancelScope();
        registerTaskScope(taskSig, scope);
        const ctx = {
          room: room.id, bot_id: current.id, name: current.name,
          job: current.job, description: current.description,
          mentioned_names: [], role: "member", relay: true, hop,
          userText: String(task || ""),
          subtask: null, subtasks: [],
          shared_board: boardText, board_group_id: room.id,
          previous_turn: prev
            ? { bot_id: prev.bot_id, name: prev.name, text: clipRoomText(prev.text, 800).text }
            : null,
          confirm_answer: confirmAnswer || "",
          cancelPromise: scope.promise,
          isCancelled: () => scope.isCancelled(),
          timeoutMs: Math.max(1, Math.min(timeoutMs, budget.remainingMs() || timeoutMs)),
        };
        budget.spend({ turns: 1, tokens: promptTokens });
        let res;
        try {
          const out = await withTimeout(
            runResponderTurn(current.id, prompt, ctx).finally(() => forgetRoomScope(scope)),
            ctx.timeoutMs,
            () => scope.cancel("timeout"),
          );
          const text = String((out && out.text) || "");
          budget.spend({ turns: 0, tokens: roomOrchestrator.estimateTokens(text) });
          res = {
            bot_id: current.id, name: current.name, ok: !!(out && out.ok !== false),
            text, artifacts: (out && out.artifacts) || [], error: (out && out.error) || null, hop,
          };
        } catch (e) {
          scope.cancel("timeout_or_error");
          res = {
            bot_id: current.id, name: current.name, ok: false, text: "", artifacts: [],
            error: String((e && e.message) || e), cancelled: true, hop,
          };
        }
        // 转录一行：和扇出路径同 schema（渲染层不变），只是多了 hop。
        const body = clipRoomText(res.text, ROOM_TEXT_MAX);
        const row = {
          kind: res.ok ? "bot_reply" : "bot_reply_error",
          room_id: room.id, speaker: res.bot_id, bot_id: res.bot_id, name: res.name,
          text: body.text, hop, at,
        };
        // 带 task_sig ⇒ 指挥台才能把这轮归到某个任务上,
        // 也才能在"还没有 final_report"的批次里给出可点的刹停按钮。
        if (taskSig) row.task_sig = taskSig;
        if (body.truncated) row.text_truncated = true;
        if (!res.ok) {
          const why = clipRoomText(res.error || "no_reply", ROOM_REASON_MAX);
          row.error = why.text;
          if (why.truncated) row.error_truncated = true;
        }
        appendRoomTranscript(room.id, row);
        roomBoard.post(
          room.id, "relay", res.bot_id,
          res.ok ? (res.text || "") : "（这一棒没成功）",
          "接力第 " + (hop + 1) + " 棒 · " + res.name,
        );
        chain.push(res);
        if (!res.ok) break; // 这一棒失败：不再往下传（传下去就是拿失败当进度）
        const parsed = roomOrchestrator.parseRelayReply(res.text);
        // ---- 停点 2：成员说「要先问清楚」。这一轮到此为止，等用户回答后继续。 ----
        if (parsed.confirm !== null) {
          paused = {
            bot_id: res.bot_id, name: res.name,
            question: clipRoomText(parsed.confirm || "（这位成员没有写清要确认什么）", CONFIRM_MAX_CHARS).text,
          };
          res.needs_confirm = paused.question;
          break;
        }
        const handoffRaw = parsed.handoff ? String(parsed.handoff) : "";
        const nextMember = handoffRaw
          ? candidates.find((m) => m.id === handoffRaw || m.name === handoffRaw)
            || candidates.find((m) => m.name && handoffRaw.includes(m.name))
            || null
          : null;
        res.handoff_to = nextMember ? nextMember.id : "";
        if (nextMember && !seen.has(nextMember.id)) {
          prev = res;
          current = nextMember;
          confirmAnswer = "";
          continue;
        }
        break; // 没有交接 = 这一棒就是收尾
      }

      const okChain = chain.filter((c) => c.ok && String(c.text || "").trim());
      const chainOut = chain.map((c) => ({
        bot_id: c.bot_id, name: c.name, ok: c.ok, hop: c.hop,
        skipped: c.skipped || false,
        handoff_to: c.handoff_to || "",
        needs_confirm: c.needs_confirm || "",
        summary: clipRoomText(c.ok ? c.text : "(" + (c.error || "no reply") + ")", ROOM_SUMMARY_MAX).text,
      }));

      // ---- 停点 2 的落盘：群里出现一张「等你回答」的卡片，这一轮不再往下跑 ----
      if (paused) {
        const entry = {
          kind: "confirm_request", room_id: room.id, speaker: paused.bot_id, stage: "member",
          bot_id: paused.bot_id, name: paused.name, question: paused.question,
          relay: chainOut,
          task: clipRoomText(task, ROOM_TASK_MAX).text, task_sig: taskSig, at,
        };
        appendRoomTranscript(room.id, entry);
        return {
          ok: true, mode: "host_orchestrate_room", paused: true,
          awaiting: Object.assign({ stage: "member" }, paused),
          routed: routeOut, relay: chainOut,
          returned: okChain.length, total: chain.length, partial: true,
          deliverable: null, final_report: null,
        };
      }

      // ---- 产物：把接力链合成一份真文件落盘 ----
      const deliverable = deliverableFromTurns({
        room, task, taskSig, at, roomTitle: room.title,
        turns: chain, mode: "relay",
      });

      const duplication = roomOrchestrator.duplicateWorkRate(
        chain.map((c) => ({ bot_id: c.bot_id, name: c.name, ok: c.ok, text: c.text })),
        { threshold: Number(deps.duplicateThreshold || roomOrchestrator.DUPLICATE_THRESHOLD) },
      );
      const final_report = {
        kind: "final_report", room_id: room.id, responder_policy: responderPolicy,
        task: clipRoomText(task, ROOM_TASK_MAX).text,
        task_sig: taskSig,
        task_title: clipRoomText(String(opts.report || task).trim() || task, ROOM_TASK_MAX).text,
        responders: chain.map((c) => c.bot_id),
        total: chain.length,
        returned: okChain.length,
        partial: okChain.length < chain.length,
        sections: chain.map((c) => {
          const sum = clipRoomText(c.ok ? c.text : "(" + (c.error || "no reply") + ")", ROOM_SUMMARY_MAX);
          return {
            bot_id: c.bot_id, name: c.name, ok: c.ok,
            summary: sum.text, summary_truncated: sum.truncated || undefined,
            artifacts: c.artifacts || [],
          };
        }),
        artifacts: chain.flatMap((c) => c.artifacts || []),
        route: routeOut,
        relay: chainOut,
        deliverable: deliverable && deliverable.ok
          ? { name: deliverable.name, path: deliverable.path, bytes: deliverable.bytes }
          : undefined,
        // 只有「真写失败」才报错：内容太短/没人交东西不是错误，如实不产文件即可。
        deliverable_error: deliverable && !deliverable.ok &&
          deliverable.error !== "too_short" && deliverable.error !== "no_content"
          ? deliverable.error
          : undefined,
        deliverable_skipped: deliverable && !deliverable.ok ? deliverable.error : undefined,
        budget: budget.snapshot(),
        duplication,
        at,
      };
      appendRoomTranscript(room.id, final_report);

      const notice = [];
      /* 产物不在这里再说一遍：汇报卡上已经有那一行（文件名 + 大小 + 「打开」），
         同一件事说两遍只会把群消息流撑长。系统行只承载**卡里没有的信息** ——
         为什么没产出、预算是怎么停的。 */
      if (deliverable && !deliverable.ok && final_report.deliverable_error) {
        notice.push("产物没能落盘：" + final_report.deliverable_error);
      }
      if (budget.snapshot().exceeded) {
        notice.push("团队预算用尽（" + (budget.snapshot().reason || "exhausted") + "），接力的后续棒次已停止。");
      }
      if (notice.length) {
        appendRoomTranscript(room.id, {
          kind: "system", room_id: room.id, speaker: "system", text: notice.join("\n"), at,
        });
      }
      return {
        ok: true, mode: "host_orchestrate_room",
        returned: final_report.returned, total: final_report.total,
        partial: final_report.partial, final_report,
        routed: routeOut, relay: chainOut,
        deliverable: final_report.deliverable || null,
      };
    }

    _orchInflight.add(taskSig);
    return (async () => {
      if (isRelay) return await relayTurn();
      let selected = candidates;
      let discretion = [];
      // 成员自决结果(含**认领**)。团队模式与 bot_discretion 共用这一份。
      let decisions = [];
      let degraded = false;
      let degradedReason = "";
      let failOpenIncluded = [];
      let failOpenExcluded = [];
      let failOpenTotal = 0;
      if ((responderPolicy === "bot_discretion" || teamMode) && canAskMembers) {
        // 团队模式:也先问一轮成员「要不要答 + 你负责哪一段」。
        // 这是**模型自决**,不是宿主猜 —— 答 NO 的成员本轮不参与。
        let picked = null;
        try {
          picked = await withTimeout(selectResponders({
            room: room.id,
            task,
            candidates: selected.map((r) => Object.assign({}, r)),
            member_count: memberIds.length,
            // 共享任务板回读：选择回合也能看到别人上一轮干了什么。
            board: roomBoard.snapshot(room.id).text,
          }), decisionTimeoutMs);
        } catch (e) {
          // 整个 selector 挂了 = 没人能决定谁应答。此时**不扇出**（那会把失败
          // 演成全员应答、还放大成本），如实失败，让上层知道这一轮没结论。
          return {
            ok: false, error: "discretion_failed",
            detail: String((e && e.message) || e), mode: "host_orchestrate_room",
          };
        }
        if (!picked || picked.ok === false) {
          return {
            ok: false, error: (picked && picked.error) || "discretion_failed",
            mode: "host_orchestrate_room",
          };
        }
        if (!Array.isArray(picked.responders)) {
          return { ok: false, error: "discretion_result_invalid", mode: "host_orchestrate_room" };
        }
        decisions = cleanDecisions(picked.decisions);
        const pickedIds = new Set(picked.responders.map((id) => String(id)));
        const decidedYes = decisions.filter(d => d.respond && !d.fail_open).map(d => d.bot_id);
        const undecided = decisions.filter(d => d.fail_open).map(d => d.bot_id);
        failOpenTotal = undecided.length;
        // fail-open 有界降级：选择失败的成员**不再全员扇出**（那是成本 ×N），
        // 最多带 maxFailOpen 个进本轮，其余如实标为「已跳过」。
        const allowance = Math.max(0, Math.min(
          Number(deps.maxFailOpen != null ? deps.maxFailOpen : (process.env.BITBOT_ROOM_MAX_FAIL_OPEN || 2)),
          candidates.length,
        ));
        const allowed = new Set(decidedYes.filter((id) => pickedIds.has(id)));
        let used = 0;
        for (const id of undecided) {
          if (!pickedIds.has(id)) continue;
          if (used >= allowance) {
            failOpenExcluded.push(id);
            continue;
          }
          allowed.add(id);
          used++;
        }
        failOpenIncluded = undecided.filter((id) => allowed.has(id));
        for (const d of decisions) {
          if (!d.fail_open) continue;
          d.included = allowed.has(d.bot_id);
          d.degraded = true;
          if (!d.included) d.skipped_reason = "degraded_budget";
        }
        discretion = decisions;
        if (failOpenTotal) {
          degraded = true;
          if (!degradedReason) degradedReason = "discretion_fail_open";
        }
        selected = selected.filter(r => allowed.has(r.id));
      }
      const nameOf = (id) => {
        const hit = selected.find(r => r.id === id) || candidates.find(r => r.id === id);
        return hit ? hit.name : id;
      };
      if (!selected.length) {
        const final_report = {
          kind: "final_report", room_id: room.id, responder_policy: responderPolicy,
          task: clipRoomText(task, ROOM_TASK_MAX).text,
          task_sig: taskSig,
          task_title: clipRoomText(String(opts.report || task).trim() || task, ROOM_TASK_MAX).text,
          responders: [], total: 0, returned: 0, partial: false, skipped: true,
          sections: [], artifacts: [], discretion,
          discretion_fail_open: failOpenIncluded.length || undefined,
          discretion_failed_total: failOpenTotal || undefined,
          discretion_excluded: failOpenExcluded.length ? failOpenExcluded : undefined,
          degraded: degraded || undefined,
          degraded_reason: degradedReason || undefined,
          budget: budget.snapshot(),
          at,
        };
        appendRoomTranscript(room.id, final_report);
        return {
          ok: true, mode: "host_orchestrate_room", skipped: true,
          returned: 0, total: 0, partial: false, final_report,
        };
      }
      // 「工作中」态只在真的扇出时给出（dedupe / 护栏拒绝 / 全员弃权都不会闪假状态）。
      if (typeof deps.onFanout === "function") {
        try {
          deps.onFanout({
            room: room.id, task, responders: selected, candidates,
            policy: responderPolicy, member_count: memberIds.length, discretion,
          });
        } catch (_) {
          /* 进度提示是 best effort，不能拖垮编排 */
        }
      }

      // ===== 任务拆解：模型可以*建议*，分工由宿主确定性执行 =====
      let subtasks = [];
      let decompositionSource = "none";
      if (selected.length > 1 && typeof deps.proposeDecomposition === "function") {
        try {
          const proposal = await withTimeout(deps.proposeDecomposition({
            room: room.id,
            task,
            candidates: selected.map((r) => Object.assign({}, r)),
            member_count: memberIds.length,
          }), decisionTimeoutMs);
          const normalized = roomOrchestrator.normalizeSubtaskProposal(proposal, {
            maxCount: Math.min(selected.length, roomOrchestrator.SUBTASK_MAX_COUNT),
          });
          if (normalized.length >= 2) {
            subtasks = normalized;
            decompositionSource = "model";
          }
        } catch (_) {
          /* 拆解建议失败 → 退回宿主启发式（不猜、不编） */
        }
      }
      if (!subtasks.length && selected.length > 1) {
        const heuristic = roomOrchestrator.decomposeTask(task, { maxCount: selected.length });
        if (heuristic.length >= 2) {
          subtasks = heuristic;
          decompositionSource = "host_heuristic";
        }
      }
      const assignments = roomOrchestrator.assignSubtasks(subtasks, selected.map(r => r.id));
      // 认领优先于拆解:成员自己说「我负责 X」时,就用它当自己的那段。
      // 没有认领的成员沿用拆解结果 —— **不猜、不编**。
      const claims = new Map();
      for (const d of (decisions || [])) {
        if (d && d.claim && d.bot_id) claims.set(d.bot_id, String(d.claim));
      }
      const ownerOf = (subId) => {
        for (const r of selected) {
          const subs = assignments.get(r.id) || [];
          if (subs.some(s => s.id === subId)) return r;
        }
        return null;
      };
      // 共享任务板：写（认领/分工）。key 统一成 room id。
      for (const sub of subtasks) {
        const owner = ownerOf(sub.id);
        roomBoard.addTask(room.id, {
          id: sub.id,
          title: sub.title,
          owner: owner ? owner.id : "",
          owner_name: owner ? owner.name : "",
          status: "assigned",
        });
      }

      // ===== 扇出：真并行 + 真取消 + 预算闸门 =====
      const concurrency = Math.max(1, Math.min(
        Number(opts.concurrency || deps.concurrency || selected.length) || selected.length,
        selected.length,
      ));
      const results = new Array(selected.length);
      let cursor = 0;
      const runMember = async (r) => {
        const scope = roomCancelScope();
        registerTaskScope(taskSig, scope);
        // 认领优先于拆解:成员说「我负责 X」⇒ 用它当自己那段。
        // 没有认领 ⇒ 沿用拆解结果(**不猜、不编**)。
        const claim = claims.get(r.id) || "";
        const decomposed = assignments.get(r.id) || [];
        const subs = claim
          ? [{ id: "claim-" + r.id, title: claim }]
          : decomposed;
        const subtask = subs.length ? subs[0] : null;
        // 回读路径：板子在**每次调用前**现读一次 —— 先跑完的成员，进度会出现在
        // 后面才被派到的成员的 prompt 里（同轮协作，不是各说各话）。
        const boardText = roomBoard.snapshot(room.id).text;
        const prompt = roomOrchestrator.buildResponderPrompt({ task, subtask, boardText });
        const ctx = {
          room: room.id,
          bot_id: r.id,
          name: r.name,
          job: r.job,
          description: r.description,
          mentioned_names: responderPolicy === "bot_discretion"
            ? []
            : selected.map((x) => String((x && x.name) || "")).filter(Boolean),
          // ---- 真编排需要的执行面 ----
          role: "member",
          // 用户原话。排程落盘要用它，不能用上面这段编排 prompt（见 host_ffi
          // executeRoutineEffect 的注释：prompt 污染会让定时任务每天重做一次编排）。
          userText: String(task || ""),
          subtask: subtask ? { id: subtask.id, title: subtask.title } : null,
          subtasks: subs.map(s => ({ id: s.id, title: s.title })),
          shared_board: boardText,
          board_group_id: room.id,
          cancelPromise: scope.promise,
          isCancelled: () => scope.isCancelled(),
          // 注意：不要给 per-responder timeout 设下限 —— 下限会把「超时即失败」
          // 的语义改掉（原本 400ms 就该判失败，抬到 1000ms 会让悬挂成员被算成成功）。
          timeoutMs: Math.max(1, Math.min(timeoutMs, budget.remainingMs() || timeoutMs)),
        };
        const promptTokens = roomOrchestrator.estimateTokens(prompt);
        const gate = budget.canStart({ tokens: promptTokens });
        if (!gate.ok) {
          budget.mark(gate.reason);
          return {
            bot_id: r.id, name: r.name, ok: false, skipped: true,
            error: "budget_" + gate.reason, text: "", artifacts: [],
          };
        }
        budget.spend({ turns: 1, tokens: promptTokens });
        try {
          const out = await withTimeout(
            runResponderTurn(r.id, prompt, ctx).finally(() => forgetRoomScope(scope)),
            ctx.timeoutMs,
            () => scope.cancel("timeout"),
          );
          const text = String((out && out.text) || "");
          budget.spend({ turns: 0, tokens: roomOrchestrator.estimateTokens(text) });
          return {
            bot_id: r.id, name: r.name, ok: !!(out && out.ok !== false),
            text, artifacts: (out && out.artifacts) || [], error: (out && out.error) || null,
          };
        } catch (e) {
          // 超时/取消：取消信号已经传给执行层，内核回合会真的停下来。
          scope.cancel("timeout_or_error");
          return {
            bot_id: r.id, name: r.name, ok: false, text: "", artifacts: [],
            error: String((e && e.message) || e), cancelled: true,
          };
        }
      };
      const worker = async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= selected.length) return;
          const r = selected[idx];
          const res = await runMember(r);
          results[idx] = res;
          const subs = assignments.get(r.id) || [];
          const status = res.ok ? "done" : (res.skipped ? "skipped" : "failed");
          for (const s of subs) {
            roomBoard.updateTask(room.id, s.id, { status, owner: r.id, owner_name: r.name });
          }
          roomBoard.post(
            room.id,
            subs.length ? subs[0].id : "shared",
            r.id,
            res.ok ? (res.text || "") : "（本轮未成功）",
            subs.length ? subs[0].title : "共享任务（未拆分）",
          );
        }
      };
      const workers = [];
      for (let i = 0; i < Math.min(concurrency, selected.length); i++) workers.push(worker());
      await Promise.all(workers);
      const settled = results.map((res, i) => res || {
        bot_id: selected[i].id, name: selected[i].name, ok: false, text: "", artifacts: [],
        error: String((res && res.error) || "not_started"),
      });
      const sections = settled.map((res) => ({
        bot_id: res.bot_id, name: res.name, ok: res.ok, text: res.text,
        artifacts: res.artifacts || [], error: res.error || null, skipped: res.skipped || false,
      }));
      for (const s of sections) {
        // 共享转录的每一行都有界：正文由 bot_reply 行承载，汇报里只留摘要；
        // 失败原因截断后再落盘，不把整段 provider 负载抄进 rooms.json。
        const body = clipRoomText(s.text, ROOM_TEXT_MAX);
        const entry = {
          kind: s.ok ? "bot_reply" : "bot_reply_error",
          room_id: room.id, speaker: s.bot_id, bot_id: s.bot_id, name: s.name,
          text: body.text, at,
        };
        if (taskSig) entry.task_sig = taskSig;
        if (body.truncated) entry.text_truncated = true;
        if (!s.ok) {
          const why = clipRoomText(s.error || "no_reply", ROOM_REASON_MAX);
          entry.error = why.text;
          if (why.truncated) entry.error_truncated = true;
        }
        appendRoomTranscript(room.id, entry);
      }
      const returned = sections.filter(s => s.ok).length;
      const total = sections.length;

      // ===== 综合（lead）回合：与成员原话**分层**，不混为一谈 =====
      const okSections = sections.filter(s => s.ok);
      let synthesis = { ok: false, skipped: true, reason: "not_enough_members", at };
      // 综合回合走**独立依赖** deps.synthesize：
      //   - 仓库既有门禁 scripts/prove_gp143_orchestration.js 断言 runResponderTurn
      //     恰好被调用「成员数」次（多一次模型调用就会打破它），所以综合不能默认
      //     挂在 runResponderTurn 上；
      //   - main.js 传 `synthesize: runRoomResponderTurn` 即生效（一次模型调用，
      //     同样吃团队预算与取消通道）。
      const synthRunner = typeof deps.synthesize === "function"
        ? deps.synthesize
        : (deps.synthesize === true || opts.synthesis === true)
          ? runResponderTurn
          : null;
      if (!synthRunner) synthesis = { ok: false, skipped: true, reason: "synthesizer_not_configured", at };
      const wantSynthesis = !!synthRunner && selected.length >= 2 && okSections.length >= 1;
      if (wantSynthesis) {
        const gaps = [];
        for (const s of sections) {
          if (s.ok) continue;
          gaps.push(((s.name || "?") + "(" + s.bot_id + ")") + " 本轮未成功");
        }
        for (const id of failOpenExcluded) gaps.push(((nameOf(id) || id) + "(" + id + ")") + " 选择失败已跳过（降级）");
        for (const s of sections) {
          if (!s.skipped) continue;
          gaps.push(((s.name || "?") + "(" + s.bot_id + ")") + " 未执行（预算用尽）");
        }
        const leadId = String(opts.lead_bot || deps.leadBotId || (okSections[0] && okSections[0].bot_id) || "");
        const lead = selected.find(r => r.id === leadId) || null;
        if (!lead) {
          synthesis = { ok: false, skipped: true, reason: "no_lead", gaps, at };
        } else {
          const boardText = roomBoard.snapshot(room.id).text;
          const prompt = roomOrchestrator.buildSynthesisPrompt({
            task,
            members: sections.map(s => ({ bot_id: s.bot_id, name: s.name, ok: s.ok, text: s.text })),
            gaps,
            boardText,
          });
          const scope = roomCancelScope();
          const synthTimeout = Math.max(1, Math.min(timeoutMs, budget.remainingMs() || timeoutMs));
          const ctx = {
            room: room.id, bot_id: lead.id, name: lead.name, job: lead.job, description: lead.description,
            mentioned_names: [], role: "synthesis", lead: true,
            userText: String(task || ""),
            shared_board: boardText, board_group_id: room.id,
            cancelPromise: scope.promise,
            isCancelled: () => scope.isCancelled(),
            timeoutMs: synthTimeout,
          };
          const promptTokens = roomOrchestrator.estimateTokens(prompt);
          const gate = budget.canStart({ tokens: promptTokens });
          if (!gate.ok) {
            budget.mark(gate.reason);
            synthesis = { ok: false, skipped: true, reason: "budget_" + gate.reason, gaps, at };
          } else {
            budget.spend({ turns: 1, tokens: promptTokens });
            try {
              const out = await withTimeout(
                synthRunner(lead.id, prompt, ctx).finally(() => forgetRoomScope(scope)),
                synthTimeout,
                () => scope.cancel("timeout"),
              );
              const raw = String((out && out.text) || "");
              const ok = !!(out && out.ok !== false) && raw.trim().length > 0;
              budget.spend({ turns: 0, tokens: roomOrchestrator.estimateTokens(raw) });
              const sum = clipRoomText(raw, ROOM_SUMMARY_MAX);
              const body = clipRoomText(raw, ROOM_TEXT_MAX);
              synthesis = {
                ok,
                lead_bot_id: lead.id,
                lead_name: lead.name,
                // 完整正文留在转录里（final_report.synthesis.text），摘要仍受 240 约束。
                text: body.text,
                summary: sum.text,
                summary_truncated: sum.truncated || undefined,
                gaps,
                degraded: degraded || undefined,
                error: ok ? null : ((out && out.error) || "no_reply"),
                at: nowIso(),
              };
            } catch (e) {
              scope.cancel("timeout_or_error");
              synthesis = {
                ok: false, lead_bot_id: lead.id, lead_name: lead.name,
                error: String((e && e.message) || e), gaps, degraded: degraded || undefined, at: nowIso(),
              };
            }
          }
        }
      }

      // ===== 重复劳动率（可测指标）=====
      const duplication = roomOrchestrator.duplicateWorkRate(
        sections.map(s => ({ bot_id: s.bot_id, name: s.name, ok: s.ok, text: s.text })),
        { threshold: Number(deps.duplicateThreshold || roomOrchestrator.DUPLICATE_THRESHOLD) },
      );
      /* 显式 @ / 全员 这条路径同样要有「能拿走的产物」：用户点了名让两个人各自写，
         最后只给他一张各说各话的汇总卡，等于还是要他自己去复制粘贴。
         并行路径没有「最后一棒」，所以按名字并列所有成功成果（mode: parallel）。 */
      const deliverable = deliverableFromTurns({
        room, task, taskSig, at, roomTitle: room.title,
        turns: sections.map(s => ({ bot_id: s.bot_id, name: s.name, ok: s.ok, text: s.text })),
        mode: "parallel",
      });
      const final_report = {
        kind: "final_report", room_id: room.id, responder_policy: responderPolicy,
        task: clipRoomText(task, ROOM_TASK_MAX).text,
        task_sig: taskSig,
        task_title: clipRoomText(String(opts.report || task).trim() || task, ROOM_TASK_MAX).text,
        responders: selected.map(r => r.id), total, returned,
        partial: returned < total,
        sections: sections.map(s => {
          const sum = clipRoomText(s.ok ? s.text : `(${s.error || "no reply"})`, ROOM_SUMMARY_MAX);
          return {
            bot_id: s.bot_id, name: s.name, ok: s.ok,
            summary: sum.text, summary_truncated: sum.truncated || undefined,
            artifacts: s.artifacts,
          };
        }),
        artifacts: sections.flatMap(s => s.artifacts || []),
        deliverable: deliverable && deliverable.ok
          ? { name: deliverable.name, path: deliverable.path, bytes: deliverable.bytes }
          : undefined,
        deliverable_error: deliverable && !deliverable.ok &&
          deliverable.error !== "too_short" && deliverable.error !== "no_content"
          ? deliverable.error
          : undefined,
        deliverable_skipped: deliverable && !deliverable.ok ? deliverable.error : undefined,
        discretion,
        // UI 文案「n 个成员的选择失败，已按应答处理」——n 只数**真被带进本轮**的那些。
        discretion_fail_open: failOpenIncluded.length || undefined,
        discretion_failed_total: failOpenTotal || undefined,
        discretion_excluded: failOpenExcluded.length ? failOpenExcluded : undefined,
        degraded: degraded || undefined,
        degraded_reason: degradedReason || undefined,
        decomposition: { source: decompositionSource, count: subtasks.length },
        subtasks: subtasks.length
          ? subtasks.map(s => {
            const owner = ownerOf(s.id);
            return {
              id: s.id, title: s.title,
              owner: owner ? owner.id : "",
              owner_name: owner ? owner.name : "",
            };
          })
          : undefined,
        board: { group_id: room.id, tasks: subtasks.length },
        synthesis,
        budget: budget.snapshot(),
        duplication,
        at,
      };
      appendRoomTranscript(room.id, final_report);
      // 系统行：综合答案与降级说明要**看得见**（渲染层不认新字段，用系统行承载）。
      // 产物不在这里重复：汇报卡上已有「产物」那一行（文件名 + 大小 + 「打开」）。
      const notice = [];
      if (deliverable && !deliverable.ok && final_report.deliverable_error) {
        notice.push("产物没能落盘：" + final_report.deliverable_error);
      }
      if (synthesis && synthesis.ok && synthesis.summary) {
        notice.push("群综合（lead：" + (synthesis.lead_name || synthesis.lead_bot_id) + "）：" + synthesis.summary);
      } else if (synthesis && !synthesis.ok && !synthesis.skipped) {
        notice.push("群综合未成功：" + String(synthesis.error || "unknown"));
      }
      if (failOpenTotal) {
        notice.push(
          "成员选择失败 " + failOpenTotal + " 人：其中 " + failOpenIncluded.length +
            " 人按有界降级参与本轮" + (failOpenExcluded.length ? "，" + failOpenExcluded.length + " 人已跳过（未计入参与）" : "") + "。",
        );
      }
      if (budget.snapshot().exceeded) {
        notice.push("团队预算用尽（" + (budget.snapshot().reason || "exhausted") + "），已停止继续扇出。");
      }
      if (notice.length) {
        appendRoomTranscript(room.id, {
          kind: "system", room_id: room.id, speaker: "system", text: notice.join("\n"), at,
        });
      }
      return {
        ok: true, mode: "host_orchestrate_room", returned, total,
        partial: final_report.partial, final_report,
      };
    })().catch((e) => {
      return { ok: false, error: "orchestrate_failed", detail: String((e && e.message) || e), mode: "host_orchestrate_room" };
    }).finally(() => {
      _orchInflight.delete(taskSig);
    });
  }

  // ===== 交接（GP-52）：真执行，不再是「只写 inbox 假装交接成功」 =====
  // 同步入口 handoffTask 只做「受理」（host_ffi.js 走它，不能改）：目标 Bot 还没跑，
  // pretend_transferred 必须是 false。异步入口 handoffTaskAsync 才真的让目标 Bot
  // 跑一轮 —— 成功与否由目标 Bot 的真实产出来定，回复落进群转录。
  let roomRuntimeDeps = null;

  function setRoomRuntimeDeps(deps) {
    roomRuntimeDeps = deps && typeof deps === "object" ? deps : null;
    return {
      ok: true, mode: "host_room_runtime_deps",
      has_runner: !!(roomRuntimeDeps && typeof roomRuntimeDeps.runResponderTurn === "function"),
    };
  }

  function prepareHandoff(input) {
    const opts = input || {};
    const roomId = String(opts.room || "").trim();
    const toId = String(opts.to_bot || "").trim();
    const fromId = String(opts.from_bot || "user").trim() || "user";
    const taskText = String(opts.task || "").trim();
    if (!roomId || !toId || !taskText) {
      return {
        ok: false, error: "handoff_needs_room_to_task", mode: "host_handoff_task",
        pretend_transferred: false, executed: false,
      };
    }
    const rooms = requireWritableRooms();
    const hit = (rooms.rooms || []).find(r => r.id === roomId || r.title === roomId);
    if (!hit) {
      return {
        ok: false, error: "room_not_found", room: roomId, mode: "host_handoff_task",
        pretend_transferred: false, executed: false,
      };
    }
    const botsData = loadBots();
    const resolve = (idOrName) => {
      const b = (botsData.bots || []).find(x => x.id === idOrName || x.name === idOrName);
      return b ? b.id : idOrName;
    };
    const toResolved = resolve(toId);
    const fromResolved = fromId === "user" ? "user" : resolve(fromId);
    const isMember = (id) => (hit.members || []).includes(id);
    if (!isMember(toResolved)) {
      return {
        ok: false,
        error: "to_bot_not_member",
        room: hit.id,
        to_bot: toResolved,
        members: hit.members || [],
        mode: "host_handoff_task",
        pretend_transferred: false,
        executed: false,
      };
    }
    if (fromResolved !== "user" && !isMember(fromResolved)) {
      return {
        ok: false,
        error: "from_bot_not_member",
        room: hit.id,
        from_bot: fromResolved,
        members: hit.members || [],
        mode: "host_handoff_task",
        pretend_transferred: false,
        executed: false,
      };
    }
    const nameOf = (id) => {
      const b = (botsData.bots || []).find(x => x.id === id);
      return b ? b.name : id;
    };
    const at = nowIso();
    const entry = {
      room_id: hit.id,
      kind: "handoff",
      text: `↪ task handed off: ${nameOf(fromResolved)} → ${nameOf(toResolved)} :: ${taskText}`,
      from_bot: fromResolved,
      to_bot: toResolved,
      task: taskText,
      responders: [toResolved],
      responder_policy: "handoff_target",
      at,
    };
    return {
      ok: true, mode: "host_handoff_task", room: hit.id, title: hit.title,
      from_bot: fromResolved, from_name: nameOf(fromResolved),
      to_bot: toResolved, to_name: nameOf(toResolved),
      task: taskText, entry, at, rooms, hit,
    };
  }

  function pushHandoffRow(prep) {
    if (!Array.isArray(prep.hit.transcript)) prep.hit.transcript = [];
    prep.hit.transcript.push(prep.entry);
    if (prep.hit.transcript.length > 200) prep.hit.transcript = prep.hit.transcript.slice(-200);
    saveRooms(prep.rooms);
  }

  // 目标 Bot 真跑一轮。成功/失败都如实落进群转录（交接闭环看得见）。
  async function executeHandoff(prep, runner) {
    // 交接回合与群成员回合是两件事(会话不同)。优先用专门的交接 runner。
    const handoffRunner =
      runner && typeof runner.runHandoffTurn === "function"
        ? { ...runner, runResponderTurn: runner.runHandoffTurn }
        : runner;
    const timeoutMs = Number(
      (runner && runner.timeoutMs) || process.env.BITBOT_ROOM_RESPONDER_TIMEOUT_MS || 120000,
    );
    const scope = roomCancelScope();
    const boardText = roomBoard.snapshot(prep.room).text;
    const prompt = roomOrchestrator.buildResponderPrompt({
      task: prep.task,
      subtask: null,
      boardText,
    });
    const ctx = {
      room: prep.room,
      bot_id: prep.to_bot,
      name: prep.to_name,
      mentioned_names: prep.from_bot && prep.from_bot !== "user" ? [prep.from_name] : [],
      role: "handoff_target",
      handoff_from: prep.from_bot,
      shared_board: boardText,
      board_group_id: prep.room,
      cancelPromise: scope.promise,
      isCancelled: () => scope.isCancelled(),
      timeoutMs,
    };
    let out = null;
    let error = "";
    try {
      out = await withCancelTimeout(
        handoffRunner.runResponderTurn(prep.to_bot, prompt, ctx).finally(() => forgetRoomScope(scope)),
        timeoutMs,
        () => scope.cancel("timeout"),
      );
    } catch (e) {
      error = String((e && e.message) || e);
    }
    const text = String((out && out.text) || "");
    const ok = !error && !!(out && out.ok !== false) && text.trim().length > 0;
    const reason = ok ? "" : (error || ((out && out.error) || "no_reply"));
    const at = nowIso();
    const body = clipRoomText(text, ROOM_TEXT_MAX);
    const row = ok
      ? {
        kind: "bot_reply", room_id: prep.room, speaker: prep.to_bot, bot_id: prep.to_bot,
        name: prep.to_name, text: body.text, responder_policy: "handoff_target", at,
      }
      : {
        kind: "bot_reply_error", room_id: prep.room, speaker: prep.to_bot, bot_id: prep.to_bot,
        name: prep.to_name, text: "", error: clipRoomText(reason || "handoff_target_failed", ROOM_REASON_MAX).text,
        responder_policy: "handoff_target", at,
      };
    if (body.truncated && ok) row.text_truncated = true;
    appendRoomTranscript(prep.room, row);
    return {
      // 「这笔转交成立」与「承接方当场答上了」是两件事：
      // 成员校验过了、交接行写进群转录了 = 所有权真的转移了 → ok=true，
      // Host 侧据此把凭据（inbox 行 + 存根）落盘；承接方这轮没答上只是**还没跑完**，
      // 用 pending / transferred=false / reply_error 如实说出来。
      // 旧写法在这里回 ok=false，于是 transcript 已经写着「↪ task handed off」，
      // 收件箱与存根却整笔跳过 —— 用户看到「已转交」，实际上没有任何东西被交出去。
      ok: true,
      accepted: true,
      replied: ok,
      executed: true,
      // pretend_transferred 只有在目标 Bot 真产出了之后才为 true。
      pretend_transferred: ok,
      transferred: ok,
      pending: !ok,
      error: "",
      reply_error: ok ? "" : (reason || "handoff_target_failed"),
      target_reply: ok ? body.text : "",
      target_artifacts: ok ? ((out && out.artifacts) || []) : [],
      transcript_row: row,
      at,
    };
  }

  async function handoffTaskAsync(args, deps) {
    const prep = prepareHandoff(args);
    if (!prep.ok) return prep;
    pushHandoffRow(prep);
    const runner = deps || roomRuntimeDeps || {};
    if (typeof runner.runResponderTurn !== "function") {
      // 没有运行时依赖 ≠ 转交失败。这一支和同步入口同义：**受理并排队**——
      // 转录已落、任务进承接 Bot 的 inbox（host_ffi 靠 accepted 决定投递），
      // 只是「目标 Bot 立刻跑一轮」这件事没人执行。把它报成 ok:false 会让
      // 宿主连 inbox 都不写，任务就此消失（2026-10-29 GP-52 三项红的真因）。
      // 同时按 §8.30 的口径把「受理」与「答没答上」分开：accepted/ok 只说受理，
      // replied/transferred/pending/reply_error 说这一轮执行的结果。
      return {
        ok: true, accepted: true, error: "", reply_error: "handoff_runner_required",
        mode: "host_handoff_task",
        pretend_transferred: false, transferred: false, replied: false,
        executed: false, pending: true, execution: "queued",
        queue_reason: "handoff_runner_required",
        room: prep.room, title: prep.title, from_bot: prep.from_bot, to_bot: prep.to_bot,
        task: prep.task, transcript_entry: prep.entry, at: prep.at,
      };
    }
    const out = await executeHandoff(prep, runner);
    return Object.assign({
      accepted: true,
      mode: "host_handoff_task", room: prep.room, title: prep.title,
      from_bot: prep.from_bot, to_bot: prep.to_bot, task: prep.task,
      transcript_entry: prep.entry, at: prep.at,
    }, out);
  }

  // 同步入口：host_ffi.js 的 handoff_task 效果走这里（那个文件不能改）。
  // 它只**受理**交接并排队执行；目标 Bot 真的跑完之后，回复会落到群转录里。
  function handoffTask(args) {
    const prep = prepareHandoff(args);
    if (!prep.ok) return prep;
    pushHandoffRow(prep);
    const result = {
      ok: true,
      // 与异步入口同一把尺子：accepted 只说「受理 + 投递」，执行与否看 executed。
      accepted: true,
      replied: false,
      mode: "host_handoff_task",
      // 目标 Bot 还没跑 —— 不能写成「已交接」。
      pretend_transferred: false,
      executed: false,
      pending: true,
      execution: "queued",
      room: prep.room,
      title: prep.title,
      from_bot: prep.from_bot,
      to_bot: prep.to_bot,
      task: prep.task,
      transcript_entry: prep.entry,
      at: prep.at,
    };
    const runner = roomRuntimeDeps;
    if (runner && typeof runner.runResponderTurn === "function") {
      // 已注册运行时依赖 → 后台真执行（host_ffi 的同步调用点无需改动）。
      result.execution = "scheduled";
      executeHandoff(prep, runner).catch(() => {
        /* 后台失败已经如实写进群转录（bot_reply_error），这里不再抛 */
      });
    }
    return result;
  }

  // ===== pending 转交凭据的下游（GP-166）=====
  // host_ffi 把「受理成立、但这轮没答上」的转交落成两份东西：目标 Bot 的 inbox 行
  // （data/agents/inbox/<bot>.jsonl）+ 一笔凭据存根（data/agents/handoffs/handoff-*.json）。
  // 只有写入、没有消费者 = 这笔任务永远挂着，群里那句「已转交」就成了假话。
  // 这里补上消费侧：下一次群回合（dispatchRoomTurn，桌面 IPC / CLI / 移动端共用那个入口）
  // 自动把它捡起重跑；GP-168 起，定时唤醒（routine_tick / routine_wake）那一班车也以
  // all_rooms 模式来捡一次 —— 群里一整天没人说话时，挂账仍然会被叫醒。并且
  //   · 幂等 —— 幂等键 = 存根文件名（host_ffi 写入时就是唯一的一次转交），终态不再跑第二遍，
  //     因为「定时发文 / 推邮箱」这类动作跑两遍就是事故；
  //   · 有界重试 —— 跑一次算一次 attempts，到上限如实标 stuck 并在群里点名，不自激循环；
  //   · 不删用户数据 —— 读不懂的存根原样留在原地，只跳过、只计数。
  // 存根回写只加新字段（state/attempts/last_error/…），原有凭据内容一个字都不丢。
  const HANDOFF_DIR = path.join(DATA_ROOT, "agents", "handoffs");
  // 上限与每轮捡取件数写死在这里：多到 3 次还答不上，就是该让人来看的情况，
  // 不是继续后台烧 token 的情况；一轮最多捡 5 笔，避免用户发一句话换来五次模型调用。
  const HANDOFF_MAX_ATTEMPTS = 3;
  const HANDOFF_SCAN_LIMIT = 5;
  // claim 超过 10 分钟没更新 = 上一轮宿主中途没了，允许下一个回合接手。
  const HANDOFF_CLAIM_STALE_MS = 10 * 60 * 1000;

  function readHandoffStub(p) {
    let raw = "";
    try {
      raw = fs.readFileSync(p, "utf8");
    } catch (e) {
      return { missing: true, error: String((e && e.code) || (e && e.message) || "unreadable") };
    }
    let stub = null;
    try {
      stub = JSON.parse(raw);
    } catch (_) {
      return { malformed: true, raw };
    }
    if (!stub || typeof stub !== "object" || Array.isArray(stub)) return { malformed: true, raw };
    return { stub, raw };
  }

  // 读出当前字节再合并写回，避免与 host_ffi 的写入互相吃掉。
  function patchHandoffStub(p, patch) {
    const cur = readHandoffStub(p);
    const base = cur.stub && typeof cur.stub === "object" ? cur.stub : {};
    const next = Object.assign({}, base, patch, {
      path: p,
      updated_at: nowIso(),
    });
    atomicWrite(p, JSON.stringify(next, null, 2));
    return next;
  }

  // stuck 必须在群里看得见：复用既有的 bot_reply_error 行，不新增转录 kind（契约不变）。
  function noteHandoffStuck(roomId, stub, reason, p) {
    const toBot = String((stub && stub.to_bot) || "");
    const row = {
      kind: "bot_reply_error",
      room_id: roomId,
      speaker: toBot,
      bot_id: toBot,
      name: String((stub && stub.to_name) || toBot || ""),
      text: "",
      error: clipRoomText(`handoff_stuck:${reason}`, ROOM_REASON_MAX).text,
      responder_policy: "handoff_target",
      handoff_file: path.basename(String(p || "")),
      at: nowIso(),
    };
    try {
      const app = appendRoomTranscript(roomId, row);
      return !(app && app.ok === false);
    } catch (_) {
      return false;
    }
  }

  async function retryPendingHandoffs(opts) {
    const o = opts || {};
    const roomId = String(o.room || "").trim();
    // GP-168：定时唤醒（routine_tick / routine_wake）那一班车没有「某间群」这个语境，
    // 但它每天必然发生，是唯一能把睡着的挂账叫醒的人。所以再开一种模式：
    // all_rooms = 按凭据自己记的 room 逐间捡，仍然受同一套幂等键 / 上限 / claim 约束。
    // 单群语义一个字都没改：给了 room 就只处理那间。
    const allRooms = roomId ? false : o.all_rooms === true;
    const runner = o.deps && typeof o.deps === "object" ? o.deps : (roomRuntimeDeps || {});
    const out = {
      ok: true,
      mode: "host_handoff_retry",
      room: roomId,
      scope: roomId ? "single_room" : allRooms ? "all_rooms" : "",
      scanned: 0,
      attempted: 0,
      answered: 0,
      failed: 0,
      stuck: 0,
      skipped_terminal: 0,
      skipped_malformed: 0,
      skipped_running: 0,
      skipped_other_room: 0,
      skipped_no_room: 0,
      pending: 0,
      notified: 0,
      notice_failed: false,
      max_attempts: HANDOFF_MAX_ATTEMPTS,
      ids: [],
      errors: [],
    };
    const noteErr = (p, e) => {
      if (out.errors.length < 3) out.errors.push(`${path.basename(String(p))}: ${String((e && e.message) || e)}`);
    };
    if (!roomId && !allRooms) return Object.assign({}, out, { ok: false, error: "handoff_retry_needs_room" });
    if (typeof runner.runResponderTurn !== "function") {
      return Object.assign({}, out, { ok: false, error: "handoff_retry_runner_required" });
    }
    let files = [];
    try {
      files = fs.readdirSync(HANDOFF_DIR).filter((f) => /^handoff-.+\.json$/.test(f)).sort();
    } catch (_) {
      return out; // 目录都还没有 = 没有待办，零成本返回
    }
    // 转录面读不动时不能把凭据演成「都卡住了」—— 那是 store 的故障，不是这笔任务的终态。
    try {
      requireWritableRooms();
    } catch (e) {
      return Object.assign({}, out, { ok: false, error: "rooms_store_unreadable", detail: String((e && e.message) || e) });
    }
    for (const f of files) {
      const p = path.join(HANDOFF_DIR, f);
      out.scanned++;
      const r = readHandoffStub(p);
      if (r.malformed) {
        out.skipped_malformed++; // 不覆盖、不删除，只如实计数
        continue;
      }
      if (r.missing) continue;
      const stub = r.stub;
      const stubRoom = String(stub.room || "").trim();
      if (roomId && stubRoom !== roomId) {
        out.skipped_other_room++; // 群之间不串：这轮的捡起只处理这间的凭据
        continue;
      }
      if (!stubRoom) {
        // all_rooms 模式下没有 room 的老凭据：不知道交回哪间群，就不许自己编一间。
        out.skipped_no_room++;
        continue;
      }
      // 单群模式 = 那间群；all_rooms = 以凭据自己记的那间为准。
      const target = roomId || stubRoom;
      const state = String(stub.state || "pending");
      const attempts = Math.max(0, Number(stub.attempts) || 0);
      if (state === "answered" || state === "stuck") {
        out.skipped_terminal++;
        continue;
      }
      if (state === "running") {
        const claimedAt = Date.parse(String(stub.claimed_at || ""));
        const fresh = Number.isFinite(claimedAt) && (Date.now() - claimedAt) < HANDOFF_CLAIM_STALE_MS;
        if (fresh) {
          out.skipped_running++; // 另一个回合正在跑它，再来一次就是两条答案
          continue;
        }
      }
      if (out.attempted >= HANDOFF_SCAN_LIMIT) {
        out.pending++; // 这一轮先捡这么多，剩下的下一轮再来
        continue;
      }
      const why0 = String(stub.task || "").trim() ? "" : "handoff_task_missing";
      if (why0) {
        patchHandoffStub(p, { state: "stuck", last_error: why0, stuck_at: nowIso() });
        if (!noteHandoffStuck(target, stub, why0, p)) out.notice_failed = true;
        else out.notified++;
        out.stuck++;
        continue;
      }
      let prep = null;
      try {
        prep = prepareHandoff({
          room: target,
          from_bot: stub.from_bot,
          to_bot: stub.to_bot,
          task: stub.task,
        });
      } catch (e) {
        noteErr(p, e); // store 读不动：不标终态，下一轮再试
        continue;
      }
      if (!prep || prep.ok !== true) {
        const why = String((prep && prep.error) || "handoff_retry_prep_failed");
        patchHandoffStub(p, { state: "stuck", last_error: why, stuck_at: nowIso() });
        if (!noteHandoffStuck(target, stub, why, p)) out.notice_failed = true;
        else out.notified++;
        out.stuck++;
        continue;
      }
      // 先 claim 再跑：并发进来的另一个回合会看到新鲜 claim 而跳过它。
      patchHandoffStub(p, { state: "running", claimed_at: nowIso(), picked_up_at: nowIso(), retry_of: f });
      out.attempted++;
      let res = null;
      try {
        res = await executeHandoff(prep, runner);
      } catch (e) {
        noteErr(p, e);
        patchHandoffStub(p, { state: "pending", last_error: `handoff_retry_threw:${String((e && e.message) || e)}` });
        continue;
      }
      const na = attempts + 1;
      const replied = res && res.replied === true;
      if (replied) {
        patchHandoffStub(p, { state: "answered", attempts: na, last_error: "", answered_at: nowIso() });
        out.answered++;
      } else {
        const why = String((res && (res.reply_error || res.error)) || "handoff_target_failed");
        const isStuck = na >= HANDOFF_MAX_ATTEMPTS;
        patchHandoffStub(p, Object.assign(
          { state: isStuck ? "stuck" : "pending", attempts: na, last_error: why },
          isStuck ? { stuck_at: nowIso() } : {},
        ));
        out.failed++;
        if (isStuck) {
          out.stuck++;
          if (!noteHandoffStuck(target, stub, `${why}（第 ${na}/${HANDOFF_MAX_ATTEMPTS} 次）`, p)) out.notice_failed = true;
          else out.notified++;
        }
      }
      out.ids.push(f);
    }
    return out;
  }

  // ===== ACCOUNT (GP-74) =====
  // Local-profile semantics only: the desktop app has no remote Bit Bot account
  // to talk to, so "signed in" always means a local profile row plus the real
  // credential sources that back it. Never fabricate a remote identity.
  function loadAccountProfile() {
    const d = readJson(ACCOUNT_PROFILE_PATH, null);
    if (!d || typeof d !== "object" || !Array.isArray(d.accounts)) {
      return { version: 1, active: null, accounts: [] };
    }
    return d;
  }

  function saveAccountProfile(data) {
    atomicWrite(ACCOUNT_PROFILE_PATH, JSON.stringify(data, null, 2));
  }

  // Truth table of the credential sources that actually exist on this machine.
  // Checks process.env AND the gitignored .env.local files, so CLI smoke and the
  // Electron main process report the same configured state.
  function envFileKeys() {
    const keys = new Set();
    for (const f of [
      path.join(REPO_ROOT, "hosts", "desktop", ".env.local"),
      path.join(REPO_ROOT, ".env.local"),
    ]) {
      try {
        if (!fs.existsSync(f)) continue;
        for (const line of fs.readFileSync(f, "utf8").split("\n")) {
          const m = /^([A-Z0-9_]+)=.+$/.exec(line.trim());
          if (m) keys.add(m[1]);
        }
      } catch (_) { /* unreadable env file counts as unset */ }
    }
    return keys;
  }

  function credentialSourceTruth() {
    const env = process.env;
    const fileKeys = envFileKeys();
    const src = (name, keys, file) => {
      const fromEnv = keys.map(k => String(env[k] || "").trim()).filter(Boolean);
      const inFile = keys.some(k => fileKeys.has(k));
      const onDisk = file ? fs.existsSync(path.join(REPO_ROOT, file)) : false;
      return { name, configured: fromEnv.length > 0 || inFile || onDisk, env_keys: keys, file: file || null };
    };
    return [
      src("llm", ["BITBOT_LLM_API_KEY"]),
      src("slack", ["SLACK_BOT_TOKEN", "BITBOT_SLACK_TOKEN"], "data/connectors/slack_token.json"),
      src("gmail", ["BITBOT_GMAIL_TOKEN"], "data/connectors/gmail_token.json"),
      src("outlook", ["BITBOT_OUTLOOK_TOKEN"], "data/connectors/outlook_token.json"),
      src("dingtalk", ["BITBOT_DINGTALK_WEBHOOK", "BITBOT_DINGTALK_TOKEN"]),
      src("feishu", ["BITBOT_FEISHU_TOKEN"]),
      src("wecom", ["BITBOT_WECOM_TOKEN"]),
    ];
  }

  function accountStatus() {
    const data = loadAccountProfile();
    const sources = credentialSourceTruth();
    const configured = sources.filter(s => s.configured).map(s => s.name);
    const active = data.active
      ? (data.accounts || []).find(a => a.label === data.active) || null
      : null;
    return {
      ok: true,
      mode: "host_account_status",
      signed_in: Boolean(active),
      // Honesty flags: we never claim a remote session we cannot verify.
      pretend_signed_in: false,
      remote_verified: false,
      scope: "local-profile",
      active: active
        ? {
            label: active.label,
            // 「我的邮箱」:用户在这个 profile 上登记的收件地址。
            // 有了它,「发我邮箱」这种话才解析得出收件人 —— 以前账户档案里
            // 只有名字,于是定时任务里的"发我邮箱"连审批都排不出来。
            email: active.email || "",
            created_at: active.created_at,
            last_used_at: active.last_used_at,
            backed_by: active.backed_by || [],
          }
        : null,
      accounts: (data.accounts || []).map(a => ({
        label: a.label,
        email: a.email || "",
        created_at: a.created_at,
        last_used_at: a.last_used_at,
      })),
      credential_sources: sources,
      configured_sources: configured,
      note: active
        ? configured.length
          ? "local profile «" + active.label + "» backed by: " + configured.join(", ")
          : "local profile «" + active.label + "» has NO configured credentials — features needing them stay off"
        : "not signed in (no local profile); configure credentials under Settings · Credentials",
      at: nowIso()
    };
  }

  /* 登记/改「我的邮箱」。
   *
   * 账户档案以前只有名字(label),没有地址 ⇒ 用户说"发我邮箱"时,
   * 收件人只从原话里找字面邮箱地址;找不到就不外发(绝不编地址)——
   * 于是"发我邮箱"这句话永远落不了地。
   * 这里让用户自己登记一个地址:登记了,定时任务的外发才有收件人。
   *
   * 地址只做**形状**校验,不验证可达性(那要联网、要发信,不该在保存时做)。
   * 空串 = 清除。 */
  function accountSetEmail(label, email) {
    const name = String(label || "").trim();
    if (!name) return { ok: false, error: "account_needs_label", mode: "host_account_set_email" };
    const raw = String(email || "").trim();
    if (raw && !/^[^@\s]{1,64}@[^@\s]{1,190}$/.test(raw)) {
      return { ok: false, error: "account_email_invalid", mode: "host_account_set_email" };
    }
    const data = loadAccountProfile();
    const hit = (data.accounts || []).find(a => a.label === name);
    if (!hit) {
      return { ok: false, error: "account_not_found", mode: "host_account_set_email" };
    }
    hit.email = raw;
    hit.email_updated_at = raw ? nowIso() : null;
    saveAccountProfile(data);
    return {
      ok: true,
      mode: "host_account_set_email",
      label: name,
      email: raw,
      cleared: !raw,
      at: nowIso(),
    };
  }

  function accountSignIn(label) {
    const name = String(label || "").trim();
    if (!name) return { ok: false, error: "account_needs_label", mode: "host_account_sign_in" };
    const data = loadAccountProfile();
    const at = nowIso();
    const configured = credentialSourceTruth().filter(s => s.configured).map(s => s.name);
    let hit = (data.accounts || []).find(a => a.label === name);
    if (!hit) {
      hit = { label: name, created_at: at, last_used_at: at, backed_by: configured };
      data.accounts.push(hit);
    } else {
      hit.last_used_at = at;
      hit.backed_by = configured;
    }
    data.active = name;
    saveAccountProfile(data);
    return {
      ok: true,
      mode: "host_account_sign_in",
      pretend_remote_login: false,
      scope: "local-profile",
      label: name,
      created: hit.created_at === at,
      backed_by: configured,
      credentials_missing: credentialSourceTruth()
        .filter(s => !s.configured)
        .map(s => s.name),
      at
    };
  }

  function accountSignOut() {
    const data = loadAccountProfile();
    const was = data.active || null;
    data.active = null;
    saveAccountProfile(data);
    return {
      ok: true,
      mode: "host_account_sign_out",
      pretend_remote_signout: false,
      scope: "local-profile",
      signed_out: was,
      // Credentials are env/file-backed on this machine — sign-out never deletes them.
      credentials_untouched: true,
      at: nowIso()
    };
  }

  function accountSwitch(label) {
    const name = String(label || "").trim();
    if (!name) return { ok: false, error: "account_needs_label", mode: "host_account_switch" };
    const data = loadAccountProfile();
    const hit = (data.accounts || []).find(
      a => a.label.toLowerCase() === name.toLowerCase()
    );
    if (!hit) {
      return {
        ok: false,
        error: "account_not_found",
        wanted: name,
        known: (data.accounts || []).map(a => a.label),
        mode: "host_account_switch",
        pretend_switched: false
      };
    }
    data.active = hit.label;
    hit.last_used_at = nowIso();
    saveAccountProfile(data);
    return {
      ok: true,
      mode: "host_account_switch",
      pretend_switched: false,
      scope: "local-profile",
      label: hit.label,
      at: hit.last_used_at
    };
  }

  // ===== LLM USAGE =====
  function loadLlmUsage() {
    return readJson(LLM_USAGE_PATH, { version: 1, week: "", rows: [] });
  }

  function saveLlmUsage(data) {
    atomicWrite(LLM_USAGE_PATH, JSON.stringify(data, null, 2));
  }

  function getIsoWeek(date) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }

  function recordUsage({ provider, model, prompt_tokens, completion_tokens, at }) {
    const data = loadLlmUsage();
    const week = getIsoWeek(at || new Date());

    if (data.week !== week) {
      data.week = week;
      data.rows = [];
    }

    // Find or create row for this provider/model
    let row = data.rows.find(r => r.provider === provider && r.model === model);
    if (!row) {
      row = {
        at: at || nowIso(),
        provider,
        model,
        prompt_tokens: 0,
        completion_tokens: 0,
        requests: 0
      };
      data.rows.push(row);
    }

    row.prompt_tokens += Number(prompt_tokens) || 0;
    row.completion_tokens += Number(completion_tokens) || 0;
    row.requests += 1;
    row.at = at || nowIso();

    saveLlmUsage(data);
    return { ok: true, mode: "host_llm_usage_record" };
  }

  function llmUsageWeekView() {
    const data = loadLlmUsage();
    
    // Calculate totals
    const totals = data.rows.reduce((acc, row) => ({
      requests: acc.requests + (row.requests || 0),
      prompt_tokens: acc.prompt_tokens + (row.prompt_tokens || 0),
      completion_tokens: acc.completion_tokens + (row.completion_tokens || 0)
    }), { requests: 0, prompt_tokens: 0, completion_tokens: 0 });
    
    return {
      week: data.week,
      rows: data.rows,
      totals
    };
  }

  // ===== STAGE ATTACHMENTS =====
  // GP-11 (official Grok spec §5.5 附件 / desktop limits): ≤6 per send,
  // doc/image/audio ≤25 MB, video ≤200 MB. existingCount is what the composer
  // already holds, so repeated picks cannot smuggle past the per-send cap.
  // GP-142 (§5.5): encrypted/corrupt attachments must be rejected honestly as
  // `unreadable` — never staged or fed to the kernel as if readable. Checks are
  // conservative: only definitively-bad content is rejected (image magic bytes,
  // PDF header/Encrypt/EOF, text NUL/invalid-UTF8); unknown binaries pass.
  function _readProbe(file, headLen = 8192, tailLen = 2048) {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const head = Buffer.alloc(Math.min(headLen, size));
      if (head.length) fs.readSync(fd, head, 0, head.length, 0);
      let tail = Buffer.alloc(0);
      if (size > head.length) {
        const tlen = Math.min(tailLen, size - head.length);
        tail = Buffer.alloc(tlen);
        fs.readSync(fd, tail, 0, tlen, size - tlen);
      }
      return { size, head, tail };
    } finally {
      fs.closeSync(fd);
    }
  }
  function _unreadableReason(file, ext, kind) {
    let p;
    try { p = _readProbe(file); } catch (_) { return "io_unreadable"; }
    if (p.size === 0) return "empty_file";
    const h = p.head;
    if (kind === "image") {
      const png = h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47;
      const jpg = h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
      const gif = h.length >= 4 && h.slice(0, 4).toString("latin1") === "GIF8";
      const webp = h.length >= 12 && h.slice(0, 4).toString("latin1") === "RIFF" && h.slice(8, 12).toString("latin1") === "WEBP";
      return (png || jpg || gif || webp) ? null : "not_a_valid_image";
    }
    if (ext === ".pdf") {
      if (h.length < 5 || h.slice(0, 5).toString("latin1") !== "%PDF-") return "not_a_pdf";
      if (Buffer.concat([h, p.tail]).includes(Buffer.from("/Encrypt"))) return "encrypted_pdf";
      if (!p.tail.includes(Buffer.from("%%EOF")) && !h.includes(Buffer.from("%%EOF"))) return "truncated_pdf";
      return null;
    }
    if (kind === "doc") {
      const TEXT = [".txt", ".md", ".markdown", ".json", ".csv", ".tsv", ".log", ".js", ".mjs", ".cjs", ".ts", ".html", ".htm", ".css", ".xml", ".yaml", ".yml", ".toml", ".ini", ".sh", ".py"];
      if (TEXT.includes(ext)) {
        if (h.includes(0x00)) return "binary_not_text";
        try { new TextDecoder("utf-8", { fatal: true }).decode(h, { stream: true }); }
        catch (_) { return "invalid_utf8"; }
      }
    }
    return null;
  }

  function stageAttachments(paths, sessionId, existingCount = 0) {
    const held = Number.isInteger(existingCount) && existingCount > 0 ? existingCount : 0;
    if (!Array.isArray(paths) || paths.length + held > 6) {
      return {
        ok: false,
        code: "too_many_attachments",
        error: "too_many_attachments",
        max_per_send: 6,
        already_staged: held
      };
    }

    const staged = [];
    const resultPaths = [];
    const sessionDir = path.join(WORKSPACE_UPLOADS_DIR, String(sessionId || "default"));
    fs.mkdirSync(sessionDir, { recursive: true });

    for (const srcPath of paths) {
      if (!srcPath) {
        // Paste/drop without a real filesystem path (clipboard blob, web view
        // file): refuse honestly instead of staging a hallucinated path (CM-0106).
        return {
          ok: false,
          code: "no_real_path",
          error: "no_real_path",
          note: "附件没有真实磁盘路径，已拒绝（不伪造路径）"
        };
      }
      try {
        const stat = fs.statSync(srcPath);
        const basename = path.basename(srcPath);
        const ext = path.extname(basename).toLowerCase();

        // Classify and check size
        let kind;
        let maxSize;
        if ([".mp4", ".webm", ".mov"].includes(ext)) {
          kind = "video";
          maxSize = 200 * 1024 * 1024;
        } else if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
          kind = "image";
          maxSize = 25 * 1024 * 1024;
        } else if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) {
          kind = "audio";
          maxSize = 25 * 1024 * 1024;
        } else {
          kind = "doc";
          maxSize = 25 * 1024 * 1024;
        }

        if (stat.size > maxSize) {
          return {
            ok: false,
            code: `too_large:${basename}`,
            error: `too_large:${basename}`,
            kind,
            bytes: stat.size,
            max_bytes: maxSize
          };
        }

        // GP-142: reject encrypted/corrupt content honestly (never stage it).
        const unreadable = _unreadableReason(srcPath, ext, kind);
        if (unreadable) {
          return {
            ok: false,
            code: `unreadable:${basename}`,
            error: "unreadable",
            reason: unreadable,
            kind,
            note: "文件不可解码（加密/损坏），已诚实拒绝，未进入上下文"
          };
        }

        // Copy with timestamp prefix if name conflict
        let destName = basename;
        let destPath = path.join(sessionDir, destName);
        if (fs.existsSync(destPath)) {
          destName = `${Date.now()}-${basename}`;
          destPath = path.join(sessionDir, destName);
        }

        fs.copyFileSync(srcPath, destPath);
        const absPath = path.resolve(destPath);
        resultPaths.push(absPath);
        staged.push({
          src: srcPath,
          dst: absPath,
          bytes: stat.size,
          kind
        });
      } catch (err) {
        return {
          ok: false,
          error: `copy_failed:${srcPath}`
        };
      }
    }

    return {
      ok: true,
      paths: resultPaths,
      staged
    };
  }

  // GP-M30 (§5.1 附件在发送前可预览): read a staged attachment for the
  // composer chips. Images ≤2MB get a real data-URL thumbnail; everything
  // else reports kind/bytes — never a fabricated preview.
  function attachmentPreview(p) {
    const src = String(p || "").trim();
    if (!src) return { ok: false, error: "preview_unavailable" };
    try {
      const stat = fs.statSync(src);
      const ext = path.extname(src).toLowerCase();
      const name = path.basename(src);
      let kind = "doc";
      if ([".mp4", ".mov", ".avi", ".mkv"].includes(ext)) kind = "video";
      else if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) kind = "image";
      else if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) kind = "audio";
      let dataUrl = null;
      if (kind === "image" && stat.size <= 2 * 1024 * 1024) {
        const mime =
          ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
          ext === ".png" ? "image/png" :
          ext === ".gif" ? "image/gif" : "image/webp";
        dataUrl = "data:" + mime + ";base64," + fs.readFileSync(src).toString("base64");
      }
      return {
        ok: true,
        mode: "host_attachment_preview",
        name,
        ext,
        kind,
        bytes: stat.size,
        data_url: dataUrl,
        residual: kind === "image" && stat.size > 2 * 1024 * 1024 ? "image_too_large_for_preview" : null,
      };
    } catch (err) {
      return { ok: false, error: "preview_unavailable", detail: String(err && err.message || err) };
    }
  }

  // ===== VOICE INGEST =====
  function voiceIngest({ wav_b64, session, transcript_provider }) {
    try {
      fs.mkdirSync(VOICE_DIR, { recursive: true });
      const wavPath = path.join(VOICE_DIR, `voice-${session || "default"}-${Date.now()}.wav`);
      const wavBuffer = Buffer.from(wav_b64, "base64");
      fs.writeFileSync(wavPath, wavBuffer);
      
      return {
        ok: true,
        wav_path: wavPath,
        bytes: wavBuffer.length,
        transcript: null,
        residual: "no_stt"
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message || "voice_ingest_failed"
      };
    }
  }

  return {
    // Bots (new API names)
    botsCreate,
    botsUpdate,
    botsSetGroup,
    botsDuplicate,
    botsPin,
    botsSetPrimary,
    botsHide,
    botsUnhide,
    botsDelete,
    listViews,
    botDetail,
    botNotifySet,
    loadBots,
    touchBotActivity,

    // Bots (legacy aliases for host_ffi.js)
    createBot: botsCreate,
    updateBot: botsUpdate,
    duplicateBot: botsDuplicate,
    pinBot: botsPin,
    setPrimaryBot: botsSetPrimary,
    hideBot: botsHide,
    unhideBot: botsUnhide,
    deleteBot: botsDelete,
    listBotsView: listViews,

    // Approval rules
    approvalRuleUpsert,
    approvalRuleList,
    approvalRuleRemove,
    approvalRuleMatch,
    
    // Legacy aliases
    upsertApprovalRule: approvalRuleUpsert,
    listApprovalRules: approvalRuleList,
    removeApprovalRule: approvalRuleRemove,
    matchApprovalRule: (pattern) => {
      const result = approvalRuleMatch(pattern.split(":")[0], pattern.split(":").slice(1).join(":"));
      if (result === null) return { matched: false };
      return { matched: true, decision: result };
    },

    // Pending approvals
    appendPendingApproval,
    pendingApprovals,
    approvalDecide,
    approvalScope,
    logApprovalDeny,
    
    // Legacy aliases
    listPendingApprovals: () => ({ ok: true, pending: pendingApprovals(), mode: "host_pending_approval_list" }),
    decideApproval: approvalDecide,
    denyApprovalReceipt: logApprovalDeny,

    // Settings
    settingsGet,
    settingsPatch,
    loadSettings,
    
    // Legacy aliases
    getSettings: () => ({ ok: true, mode: "host_settings_get", settings: settingsGet() }),
    patchSettings: (patch) => {
      const result = settingsPatch(patch);
      return { ...result, mode: "host_settings_patch", pretend_saved: false };
    },

    // Computer
    computerFrame,
    recordComputerAction,
    recordSharedBrowserSession,
    readSharedBrowserSession,
    cuLockAcquire,
    cuLockRelease,
    cuLockStatus,
    takeoverBegin,
    takeoverEnd,
    recoverComputer,
    loadComputer,
    
    // Legacy aliases
    getComputer: () => ({ ok: true, mode: "host_computer_get", computer: loadComputer() }),
    patchComputer: (patch) => {
      const data = loadComputer();
      Object.assign(data, patch);
      saveComputer(data);
      return { ok: true, mode: "host_computer_patch", pretend_saved: false, computer: data };
    },
    beginTakeover: (bot_id, reason) => takeoverBegin({ bot_id, reason }),
    endTakeover: () => takeoverEnd({}),

    // Rooms
    roomCreate,
    roomTurn,
    orchestrateRoom,
    cancelRoomTask,
    taskIsRunning,
    registerTaskScope,
    forgetRoomScope,
    // KP-02：停止按钮要能真停到群回合。这个句柄必须挂在返回值上 —— 只在
    // createProductSurface 内部定义、不导出，main.js 的 `surface.cancelActiveRoomTurns`
    // 就永远是 undefined，回执里的 had_active_turn 恒为 false（「按了停止，界面说
    // 没有在执行的回合」，而实际有一条正跑着）。
    cancelActiveRoomTurns,
    activeRoomTurnCount: () => _activeRoomScopes.size,
    handoffTask,
    handoffTaskAsync,
    retryPendingHandoffs,
    setRoomRuntimeDeps,
    roomBoardSnapshot: (roomId) => roomBoard.snapshot(roomId),
    appendRoomTranscript,
    loadRooms,
    roomsStoreStatus,
    roomLatestReport,
    roomLibraryList,
    roomLibraryAdd,
    roomMembersUpdate,
    roomRename,

    // Account (GP-74) — local profile semantics only
    accountStatus,
    accountSignIn,
    accountSetEmail,
    accountSignOut,
    accountSwitch,
    
    // Legacy aliases
    createRoom: roomCreate,

    // LLM usage
    recordUsage,
    llmUsageWeekView,
    
    // Legacy aliases
    weekView: llmUsageWeekView,

    // Attachments
    stageAttachments,
    attachmentPreview,

    // Voice
    voiceIngest
  };
}

module.exports = { createProductSurface };
