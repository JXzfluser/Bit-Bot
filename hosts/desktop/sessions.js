"use strict";

/**
 * Durable Desktop chat sessions (Grok-style conversation list).
 * Stored under data/desktop/sessions.json — Host-side only, not LocalBrain.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const eventMirror = require("./event_mirror_ref").loadEventMirror();
const eventReadModel = require("./event_mirror_ref").loadEventReadModel();

function createSessionStore(repoRoot, opts = {}) {
  const root = path.resolve(repoRoot);
  /* Sessions are user data: packaged builds keep them in the OS user-data
     dir, not inside the (read-only, replace-on-upgrade) app bundle. */
  const dataRoot = opts.dataRoot ? path.resolve(opts.dataRoot) : path.join(root, "data");
  /* 注意(2026-11-22):这里**刻意不读** BITBOT_DATA_ROOT。
     门禁隔离由上游一层做够:main.js 用 resolveDataRoot() 算出 dataRoot 显式传进来,
     而 resolveDataRoot 本身就优先读 BITBOT_DATA_ROOT(见 hosts/desktop/paths.js:113)。
     ⇒ 本模块自己再读一遍 env 是**多余的**,而且会改掉「调用方没传 dataRoot」时的
     历史行为(实测:room_orchestration 因此报「complete card — null」)。
     ⇒ 需要 env 逃生口的模块是 hosts/shared/host_ffi.js(它有明确的 env 级)。 */
  /* 数据根三级优先级(和 hosts/shared/host_ffi.js 一致):
     opts.dataRoot > 环境变量 BITBOT_DATA_ROOT > <repo>/data。
     旧写法只有两级,漏掉环境变量那一级 ⇒ 门禁用 BITBOT_DATA_ROOT 隔离时,
     这里仍然写**真实 checkout 的 data/** ⇒ 门禁跑完用户的真数据目录被改了
     (实测:data/desktop/bots.json、data/approvals/queue.jsonl 被门禁改掉)。 */

  const dir = path.join(dataRoot, "desktop");
  const storePath = path.join(dir, "sessions.json");

  function empty() {
    const id = "sess-" + crypto.randomBytes(4).toString("hex");
    const at = new Date().toISOString();
    return {
      version: 1,
      active_id: id,
      sessions: [
        {
          id,
          title: "新对话",
          created_at: at,
          updated_at: at,
          messages: [],
        },
      ],
    };
  }

  function newMessageId() {
    return "msg-" + crypto.randomBytes(4).toString("hex");
  }

  // GP-14: every stored message needs a stable id so Reply can point at one.
  // One-shot backfill for rows written before this wave (load is the single
  // entry point, so both reads and later writes see the same ids).
  function ensureMessageIds(state) {
    let changed = false;
    for (const s of state.sessions || []) {
      if (!Array.isArray(s.messages)) s.messages = [];
      for (const m of s.messages) {
        if (m && !m.id) {
          m.id = newMessageId();
          changed = true;
        }
      }
    }
    if (changed) save(state);
    return state;
  }

  // T1-03 双写旁路：默认关（BITBOT_EVENT_DUAL_WRITE=1 才开），开也只是在同一
  // 次落盘后多追加几条事件；镜像失败不改这次写入的结果。
  const mirror = () => eventMirror.getSharedMirror(dataRoot);

  function writeStore(text) {
    const m = mirror();
    const token = m.capture(storePath);
    /* KP-09 片7（撕裂写）：这张面以前是「就地写」—— open(O_TRUNC) 先把旧内容清空，
       再往里写；写一半失败（磁盘满是真实现场，不是假想）就把整份历史变成半截 JSON，
       而半截 JSON 在 load() 眼里等于「一个会话都没有」：40 条会话静默没了，
       紧接着的下一次写还把坏文件的字节覆盖掉，连手工救的余地都没了（实测见 §8.130①）。
       tmp + rename 之后，目标文件要么还是上一刻的完整内容，要么就是这次的完整内容。
       tmp 名必须带 pid（片3 的账：同一毫秒两家用同名 tmp，先 rename 的后一家 ENOENT）。 */
    fs.mkdirSync(dir, { recursive: true });
    const tmp = storePath + ".tmp." + process.pid + "." + Date.now() + "." + Math.random().toString(36).slice(2, 8);
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, storePath);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch (_) { /* 清不掉不比把旧内容保住更要紧 */ }
      throw err;
    }
    m.commit(storePath, token, text);
  }

  /* ===== T1-05 EVENT_ONLY（BITBOT_EVENT_ONLY=1）=====
     事件库成为唯一写路径与读真源；sessions.json 一个字节都不再写。
     diff 的左半边不再是「盘上文件」，而是内存里最后一次读到的状态文本
     （lastLoadedText，load() 的每条路都负责刷新它）——这就是「prev 从盘上
     搬进内存」。读模型的降级路在这里只用于「读」，写侧一律 fail loud：
     JSON 不再是备份，写失败吞掉就是静默丢数据（commitText 会往外抛）。 */
  const eventOnly = () => process.env.BITBOT_EVENT_ONLY === "1";
  let lastLoadedText = null;
  /* 遗留基底标记：load() 从遗留 JSON 读来且库还没有这张面的账时置位。
     delta diff 只记增量——基底（旧会话们）从没进过库，直接落 delta 会让
     顺序事件指向幽灵实体（EO-05 抓出来的）。所以首次写必须先从 BASELINE
     把基底导进去（与导入脚本同一语义），再落 delta。 */
  let legacyBasePending = false;
  /* KP-09 片10：折叠读不出来（并发写撞坏/读模型报错）时，这里记下原因，
     写路一律拒绝 —— 原先这条路是「按空库处理，写入继续」，等于把一次读失败
     变成一次整面覆盖，别的进程刚写的会话当场没了。 */
  let foldBlocked = null;
  const sleepSync = (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  };
  const eventOnlySaid = new Set();
  /* 拒读的理由必须分开报：超时/超额是「这次没折完、下次能续」，anomaly 是「库里对不上」，
     三者的下一步完全不同 —— 合成一句「折叠不可用」就是把机制藏回屏幕后面（#80 要靠这句分辨）。 */
  function foldWhy(hit) {
    const an = (hit.anomalies || [])[0];
    if (an) return an;
    if (hit.reason === "fold_timeout") {
      return `日志读了 ${hit.rowsRead} 行没在 ${hit.deadlineMs}ms 内折完，已折到第 ${hit.progressSeq} 行，下次读接着折`;
    }
    if (hit.reason === "log_too_long") {
      return `日志超过单次额度 ${hit.maxRows} 行，已折到第 ${hit.progressSeq} 行`;
    }
    return hit.reason || "fold_unavailable";
  }
  function sayOnce(key, line) {
    if (eventOnlySaid.has(key)) return;
    eventOnlySaid.add(key);
    process.stderr.write(line);
  }

  function saveEventOnly(state) {
    const def = eventMirror.surfaceOf(storePath);
    const m = mirror();
    /* KP-09 片11：提交前在跨进程锁里重取基底 —— 群面 `requireWritableRooms()` 的同一条纪律。
       `load()` 到落库之间别的进程可能已经写了会话，拿自己那份陈旧基底做 diff 就会把别人的行
       从花名册里抹掉（真并发实测三次全是这个形状，§8.150）。四条合并规则与文件模式共用一个核心，
       所以两条路不会漂成两种语义。 */
    withFaceLock(storePath, () => {
      const hit = eventReadModel.readSurfaces(dataRoot);
      let base = lastLoadedText;
      let mine = state;
      if (hit.ok && !hit.anomalies.length && hit.count > 0) {
        const fresh = hit.sessions;
        if (fresh && Array.isArray(fresh.sessions)) {
          mine = mergeAgainstFace(state, fresh, lastLoadedText);
          base = JSON.stringify(fresh, null, 2);
        }
      } else if ((!hit.ok && hit.reason !== "no_db") || (hit.anomalies || []).length > 0) {
        const err = new Error(
          `sessions 写入被拦：提交时事件折叠不可用（${foldWhy(hit)}）`,
        );
        err.code = "SESSION_FOLD_BLOCKED";
        throw err;
      }
      const nextText = JSON.stringify(mine, null, 2);
      if (legacyBasePending) {
        m.commitText(def, null, base); // 基底导入（从 BASELINE，prevText=null）
        legacyBasePending = false;
      }
      m.commitText(def, base, nextText);
      lastLoadedText = nextText;
    });
  }

  /** EVENT_ONLY 的「从 BASELINE 播种」：与导入脚本共用同一语义（prevText=null）。 */
  function seedEventOnly() {
    const seed = empty();
    mirror().commitText(eventMirror.surfaceOf(storePath), null, JSON.stringify(seed, null, 2));
    lastLoadedText = JSON.stringify(seed, null, 2);
    return seed;
  }

  /** 从 JSON 文本恢复 store（EVENT_ONLY 的遗留数据 / 降级路共用），并刷新 prev。 */
  function stateFromJsonText(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return empty();
    }
    if (!raw || !Array.isArray(raw.sessions) || !raw.sessions.length) {
      return empty();
    }
    if (!raw.active_id) raw.active_id = raw.sessions[0].id;
    lastLoadedText = text;
    return ensureMessageIds(raw);
  }

  // T1-04 读切换：BITBOT_EVENT_READ=1 时优先从事件日志折叠出 sessions 面。
  // 读模型不可用（没开双写→没有库 / 日志坏 / 折叠有 anomaly）就老实回退 JSON
  // 读，并打一行说明——绝不静默，也绝不把读失败当成「没有会话」。
  // 写侧照旧（JSON + 双写镜像），这条路只换「读」，这就是 T1-04 的边界。
  // 降级说明的「只说一次」闸：READ=1 时开机的头几次 load() 落在双写建库之前，
  // no_db 是预期状态，不能每次读都刷一行；但换一种失败原因（库坏 / anomaly）
  // 必须重新开口。RM-02/RM-06 断言的就是这第一行。
  const degradedSaid = new Set();

  function readFromEvents() {
    const hit = eventReadModel.readSurfaces(dataRoot);
    if (hit.ok && !hit.anomalies.length) {
      return { state: hit.sessions, source: "events", count: hit.count };
    }
    if (hit.ok) {
      // fold 有 anomaly 但 ok —— readSurfaces 已把这种情况降级为 ok:false，
      // 这里理论上到不了；到了就当作不可用处理。
      return { state: null, source: "events_anomalies", detail: hit.anomalies.join("; ") };
    }
    return { state: null, source: hit.reason, detail: hit.error || "" };
  }

  function load() {
    fs.mkdirSync(dir, { recursive: true });
    // 每条读路都先清掉合并基底：只有「从文件读到」那一条会把它填回来。
    // 从事件折叠/播种/坏文件那几条路填出来的基底不是这张面的盘上现状，
    // 拿它做三方合并会把「别人删掉的会话」复活。
    mergeBaseText = null;
    foldBlocked = null;
    if (eventOnly()) {
      const hit = eventReadModel.readSurfaces(dataRoot);
      if (hit.ok && !hit.anomalies.length && hit.count > 0) {
        const raw = hit.sessions;
        if (!Array.isArray(raw.sessions) || !raw.sessions.length) {
          return seedEventOnly(); // 库里有事件但还没有会话：从 BASELINE 播种
        }
        if (!raw.active_id) raw.active_id = raw.sessions[0].id;
        lastLoadedText = JSON.stringify(raw);
        return ensureMessageIds(raw);
      }
      /* 库空（count===0）或读模型不可用：看有没有遗留 JSON。
         有 → 读它并说一句话（首次写入会把它增量带进事件库，即「自导入」；
         更稳妥是先跑导入脚本）；没有 → 正常播种。 */
      const legacyText = (() => {
        try {
          const j = JSON.parse(fs.readFileSync(storePath, "utf8"));
          return j && Array.isArray(j.sessions) && j.sessions.length ? fs.readFileSync(storePath, "utf8") : null;
        } catch {
          return null;
        }
      })();
      if (legacyText) {
        sayOnce(
          "legacy-sessions",
          "[sessions] BITBOT_EVENT_ONLY：事件库为空但存在遗留 sessions.json（未导入）——暂以 JSON 为读真源，" +
            "首次写入会把它增量带进事件库；建议先跑 scripts/import_json_to_events.mjs。\n",
        );
        legacyBasePending = true;
        return stateFromJsonText(legacyText);
      }
      /* 只有「库真没内容」（没建库 / 一条事件都没有）才允许从 BASELINE 播种。
         库有内容却折不动 —— 多个进程同时写这张面时最容易撞到这里 —— 先短促重试
         （对方的事务可能刚落库）；仍折不动就把这张面当只读：写路口当场拒绝并给回执。
         原来是「按空库处理，写入继续」，那等于把一次读失败变成一次整面覆盖，
         别的进程刚写进去的会话当场消失（报告 §8.150 实测：18 条 create 回执全 ok、
         18 条消息全拒、折叠 21 条 anomaly）。 */
      const liveLog = (hit.anomalies || []).length > 0 || hit.count > 0;
      /* 播种是整面替换（prevText=null = 从 BASELINE 起算），两个进程同时判「库空」
         各播一次，后一次会把前一次的花名册抹掉 —— 真并发实测的第一条坏面就是这么来的。
         所以「空库」这个判断要在跨进程锁里复核一遍，只有复核仍空才允许播种。 */
      if (!liveLog) {
        return withFaceLock(storePath, () => {
          const recheck = eventReadModel.readSurfaces(dataRoot);
          if ((recheck.anomalies || []).length > 0 || recheck.count > 0) {
            if (!recheck.ok || (recheck.anomalies || []).length) {
              foldBlocked = `事件折叠不可用（${foldWhy(recheck)}）`;
              sayOnce("block-recheck", `[sessions] BITBOT_EVENT_ONLY：${foldBlocked}——播种复核后按只读处理\n`);
              return empty();
            }
            const raw = recheck.sessions;
            if (!Array.isArray(raw.sessions) || !raw.sessions.length) return seedEventOnly();
            if (!raw.active_id) raw.active_id = raw.sessions[0].id;
            lastLoadedText = JSON.stringify(raw);
            return ensureMessageIds(raw);
          }
          return seedEventOnly();
        });
      }
      let attempt = hit;
      for (let tries = 0; tries < 6; tries++) {
        sleepSync(15);
        attempt = eventReadModel.readSurfaces(dataRoot);
        if (attempt.ok && !attempt.anomalies.length && attempt.count > 0) {
          const raw = attempt.sessions;
          if (!Array.isArray(raw.sessions) || !raw.sessions.length) return seedEventOnly();
          if (!raw.active_id) raw.active_id = raw.sessions[0].id;
          lastLoadedText = JSON.stringify(raw);
          return ensureMessageIds(raw);
        }
        if (!attempt.ok && attempt.reason === "read_disabled") break;
      }
      const why = foldWhy(attempt);
      foldBlocked = `事件折叠不可用（${why}）`;
      sayOnce(
        `block-${String(why).slice(0, 20)}`,
        `[sessions] BITBOT_EVENT_ONLY：${foldBlocked}——本次按只读处理，写入一律拒绝并给回执（不再拿空面覆盖别人的会话）\n`,
      );
      return empty();
    }
    if (!fs.existsSync(storePath)) {
      const seed = empty();
      writeStore(JSON.stringify(seed, null, 2));
      return seed;
    }
    if (eventReadModel.eventReadEnabled()) {
      const hit = readFromEvents();
      if (hit.state) {
        const raw = hit.state;
        if (!Array.isArray(raw.sessions) || !raw.sessions.length) {
          return empty();
        }
        if (!raw.active_id) raw.active_id = raw.sessions[0].id;
        lastLoadedText = JSON.stringify(raw);
        return ensureMessageIds(raw);
      }
      if (!degradedSaid.has(hit.source)) {
        degradedSaid.add(hit.source);
        process.stderr.write(
          `[sessions] BITBOT_EVENT_READ 已开但事件读模型不可用（${hit.source}` +
            (hit.detail ? `: ${hit.detail}` : "") + "），本次回退 JSON 读。\n",
        );
      }
    }
    let text = null;
    try {
      text = fs.readFileSync(storePath, "utf8");
    } catch {
      return empty();
    }
    let raw = null;
    try {
      const parsed = JSON.parse(text);
      raw = parsed && Array.isArray(parsed.sessions) ? parsed : null;
    } catch (_) {
      raw = null;
    }
    if (!raw) {
      /* 半截 JSON 不等于「一个会话都没有」：先把字节留住，再空态起步。
         以前这里是 `catch { return empty(); }` —— 一句都没有说，而且下一次落盘
         直接把坏文件覆盖掉，40 条会话连手工救的余地都没了（§8.130① 实测）。 */
      quarantineCorrupt();
      return empty();
    }
    if (!raw.sessions.length) {
      lastLoadedText = text;
      return empty();
    }
    if (!raw.active_id) raw.active_id = raw.sessions[0].id;
    lastLoadedText = text;
    mergeBaseText = text;
    pruneOrphanTmp();
    return ensureMessageIds(raw);
  }

  /* 崩在 write 与 rename 之间的进程来不及执行上面的 catch，半截 tmp 就留在面旁边
     （实测：8MB 面被 SIGKILL 10 次，面本身 0 次撕裂，但最多攒下 7 个孤儿 tmp）。
     只清「pid 已经不在了 + 老于 60s」的那些：别人的进程可能正在写自己的 tmp。 */
  function pruneOrphanTmp() {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((f) => f.startsWith(path.basename(storePath) + ".tmp."));
    } catch (_) {
      return;
    }
    const now = Date.now();
    for (const f of names) {
      const pid = Number(String(f).split(".")[3]);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
      if (isPidAlive(pid)) continue;
      const full = path.join(dir, f);
      try {
        if (now - fs.statSync(full).mtimeMs < 60000) continue;
        fs.rmSync(full, { force: true });
      } catch (_) { /* 清不掉只是磁盘上多一个垃圾，不影响这次开面 */ }
    }
  }

  function isPidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return String((e && e.code) || "") === "EPERM"; }
  }

  /* 坏文件不许就地覆盖：整份历史之所以还能救，全靠这些字节还在。
     改名（同目录内 rename 不会失败到需要跨盘）而不是删除 —— 既保住证据，
     又不会让下一次读又撞在同一份坏内容上反复报同一句。
     改不动就退化成复制；两条都不行才继续往下走，但这句话必须先说。 */
  function quarantineCorrupt() {
    const at = new Date().toISOString().replace(/[:.]/g, "-");
    const keep = storePath + ".corrupt-" + at;
    let how = "";
    try {
      fs.renameSync(storePath, keep);
      how = "已改名留成 " + keep;
    } catch (_) {
      try {
        fs.copyFileSync(storePath, keep);
        how = "已另存一份到 " + keep;
      } catch (_) {
        how = "没能另存（原文件仍在那里，但这次读不出来）";
      }
    }
    sayOnce("corrupt-" + keep,
      `[sessions] ${storePath} 不是合法的会话面 JSON（多半是写一半失败留下的）——原始字节${how}；` +
      "本次从空列表开始，这不是「你没有会话」，请手工检查那份文件。\n");
    return keep;
  }

  /* KP-09 片6（会话面跨进程丢更新）：sessions.json 在默认模式下仍是文件真源，
     save() 一次写换整份文本 —— 桌面主进程和定时守护两个进程读到同一份基底时，
     后写的那家把对方刚落盘的那批会话整批抹掉（新建的会话没了、改名被盖回、
     刚删掉的那条被复活），两边都拿到 ok:true，屏幕上一声不吭。
     判据实测（确定性交错 SW-22）：把交错钉在 B 读基底的那一刻，修前三条全红。
     改法与 bots/rooms 面逐字同形：按 id 三方合并 + 面自己的跨进程锁；
     基底 = 本次 load() 从文件读到的那份文本（只有那一条路会填 mergeBaseText）。
     EVENT_ONLY 下整条合并跳过 —— 那张面的真源是事件库，save 走 saveEventOnly。 */
  let mergeBaseText = null;

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

  function mergeSessionsAgainstDisk(state) {
    let disk = null;
    try { disk = JSON.parse(fs.readFileSync(storePath, "utf8")); } catch (_) { return state; }
    return mergeAgainstFace(state, disk, mergeBaseText);
  }

  /* KP-09 片11：合并的核心与「另一份是什么来源」无关 —— 文件模式拿 sessions.json，
     EVENT_ONLY 拿折叠出来的当前面。四条规则原样共用，不然两条路会漂成两种语义。 */
  function mergeAgainstFace(state, other, baseText) {
    if (!state || !Array.isArray(state.sessions)) return state;
    if (!other || !Array.isArray(other.sessions)) return state;
    let baseSessions = new Map();
    if (baseText) {
      let base = null;
      try { base = JSON.parse(baseText); } catch (_) { return state; }
      baseSessions = new Map(((base && base.sessions) || []).filter((s) => s && s.id).map((s) => [s.id, s]));
    }
    const diskById = new Map(other.sessions.filter((s) => s && s.id).map((s, i) => [s.id, { s, i }]));
    /* 顺序按「我这轮的那份」走：create() 是新会话插到最前，侧栏次序由它决定 ——
       若先走盘上的行再把我的新行追加在后面，单写者（盘上就是上一刻我自己写的）也会被
       改成「新建的会话排到最后」，事件 fold 与快照就再也对不上（DW-03 少一条 entity_order_changed、
       EO-02 两个世界的前两行互换，本轮实测到）。别人新建的行按它在盘上的位置插进来。 */
    const merged = [];
    const placed = new Set();
    for (const m of state.sessions) {
      if (!m || !m.id || placed.has(m.id)) continue;
      const hit = diskById.get(m.id);
      if (!hit) {
        // 盘上没有、基底里有 = 别的写者删了它；基底里也没有 = 我这轮新建的，照常写回。
        if (baseSessions.has(m.id)) continue;
        merged.push(m); placed.add(m.id); continue;
      }
      const b = baseSessions.get(m.id);
      merged.push(b && JSON.stringify(b) === JSON.stringify(m) ? hit.s : m);
      placed.add(m.id);
    }
    for (const d of other.sessions) {
      if (!d || !d.id || placed.has(d.id)) continue;
      // 基底里有 = 我删的（不复活）；基底里没有 = 别人刚建的，留在盘上、按盘上的位置归位。
      if (baseSessions.has(d.id)) continue;
      const here = diskById.get(d.id).i;
      const at = merged.findIndex((s) => {
        const k = diskById.get(s.id);
        return (k ? k.i : Infinity) > here;
      });
      if (at < 0) merged.push(d); else merged.splice(at, 0, d);
      placed.add(d.id);
    }
    return { ...state, sessions: merged };
  }

  function save(state) {
    if (eventOnly()) {
      if (foldBlocked) {
        const err = new Error(`sessions 写入被拦：${foldBlocked}`);
        err.code = "SESSION_FOLD_BLOCKED";
        throw err;
      }
      saveEventOnly(state);
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    withFaceLock(storePath, () => writeStore(JSON.stringify(mergeSessionsAgainstDisk(state), null, 2)));
  }

  function list() {
    const state = load();
    return {
      ok: true,
      active_id: state.active_id,
      sessions: state.sessions.map((s) => {
        // Grok-parity sidebar shows a one-line preview of the latest message.
        const msgs = Array.isArray(s.messages) ? s.messages : [];
        let preview = "";
        for (let i = msgs.length - 1; i >= 0; i--) {
          const t = String((msgs[i] && msgs[i].text) || "").replace(/\s+/g, " ").trim();
          if (t) { preview = t.slice(0, 40); break; }
        }
        return {
          id: s.id,
          title: s.title || "对话",
          updated_at: s.updated_at,
          message_count: msgs.length,
          preview,
        };
      }),
      path: storePath,
    };
  }

  function get(id) {
    const state = load();
    const want = String(id || state.active_id || "");
    const hit = state.sessions.find((s) => s.id === want) || state.sessions[0];
    return {
      ok: Boolean(hit),
      session: hit || null,
      active_id: state.active_id,
    };
  }

  function create(title) {
    const state = load();
    const at = new Date().toISOString();
    const id = "sess-" + crypto.randomBytes(4).toString("hex");
    const sess = {
      id,
      title: String(title || "新对话").trim() || "新对话",
      created_at: at,
      updated_at: at,
      messages: [],
    };
    state.sessions.unshift(sess);
    state.active_id = id;
    save(state);
    return { ok: true, session: sess, active_id: id };
  }

  function setActive(id) {
    const state = load();
    const hit = state.sessions.find((s) => s.id === String(id || ""));
    if (!hit) return { ok: false, error: "unknown session" };
    state.active_id = hit.id;
    save(state);
    return { ok: true, session: hit, active_id: hit.id };
  }

  function appendMessages(id, messages) {
    const state = load();
    const want = String(id || state.active_id || "");
    const hit = state.sessions.find((s) => s.id === want);
    if (!hit) return { ok: false, error: "unknown session" };
    if (!Array.isArray(hit.messages)) hit.messages = [];
    const now = new Date().toISOString();
    for (const m of messages || []) {
      if (!m || !m.role) continue;
      // 迁移/回放要保留原来的时间。之前这里无条件写 now，于是
      // import_grok_bot 算出来的历史时间被静默丢掉 —— 参数存在却不生效，
      // 比没有这个参数更坏：调用方以为自己保留了时间。
      // 不传 at（现有全部调用方）时行为完全不变，仍写这一刻。
      const atRow =
        m.at && !Number.isNaN(Date.parse(String(m.at))) ? new Date(m.at).toISOString() : now;
      /* KP-08 T3-04：调用方可以指定 id（乐观命令那条的身份）。同一个会话里 id 必须唯一 ——
         撞车时这里**不覆盖**已有那行，改成另发一个 id。回执会把真 id 带回界面，
         渲染端因此看得见「落库的不是我发的那条」，而不是两条消息静默并成一条。 */
      const wanted = String(m.id || "");
      const taken = !!wanted && hit.messages.some((r) => r && String(r.id) === wanted);
      const row = {
        id: wanted && !taken ? wanted : newMessageId(),
        role: String(m.role),
        text: String(m.text || ""),
        at: atRow,
      };
      // GP-14: keep the replied-to id in the transcript row so the quote
      // survives a reload instead of only living in this turn's memory.
      if (m.reply_to) row.reply_to = String(m.reply_to);
      // GP-102: a secret placeholder row keeps only the Host vault handle, so a
      // reload can rebuild `[REDACTED]` without ever storing the value.
      if (m.secret_handle) row.secret_handle = String(m.secret_handle);
      // M52b: 这一轮的产物（图片/视频/图表/ics/eml/skill/导出包）。只留四个字段，
      // 路径必须是字符串、名字由 Host 给；渲染层据此在刷新后重建文件卡。
      // 上限与 Host 侧收集器一致（24），这里再截一次是因为 store 不收任意输入。
      if (Array.isArray(m.artifacts) && m.artifacts.length) {
        const arts = [];
        for (const a of m.artifacts.slice(0, 24)) {
          if (!a || !a.path) continue;
          arts.push({
            path: String(a.path),
            name: String(a.name || ""),
            kind: String(a.kind || ""),
            bytes: Number.isFinite(a.bytes) ? Number(a.bytes) : null,
          });
        }
        if (arts.length) row.artifacts = arts;
      }
      hit.messages.push(row);
    }
    const DEFAULT_TITLES = ["新对话", "对话", "New chat", "新對話", "工作"];
    if (DEFAULT_TITLES.indexOf(hit.title) >= 0) {
      const firstUser = hit.messages.find((m) => m.role === "user");
      if (firstUser && firstUser.text) {
        hit.title = firstUser.text.trim().slice(0, 28) || hit.title;
      }
    }
    hit.updated_at = now;
    save(state);
    return { ok: true, session: hit, active_id: state.active_id };
  }

  function activeId() {
    return load().active_id;
  }

  /** GP-14: resolve a message id (any session) → { id, session_id, role, text }. */
  function findMessage(messageId) {
    const want = String(messageId || "").trim();
    if (!want) return { ok: false, error: "empty message id" };
    const state = load();
    for (const s of state.sessions || []) {
      const hit = (s.messages || []).find((m) => m && String(m.id) === want);
      if (hit) {
        return {
          ok: true,
          id: hit.id,
          session_id: s.id,
          role: hit.role,
          text: String(hit.text || ""),
        };
      }
    }
    return { ok: false, error: "message_not_found", message_id: want };
  }

  function rename(id, title) {
    const state = load();
    const hit = state.sessions.find((s) => s.id === String(id || ""));
    if (!hit) return { ok: false, error: "unknown session" };
    const t = String(title || "").trim();
    if (!t) return { ok: false, error: "empty title" };
    hit.title = t.slice(0, 60);
    hit.updated_at = new Date().toISOString();
    save(state);
    return { ok: true, session: hit };
  }

  function remove(id) {
    const state = load();
    const want = String(id || "");
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((s) => s.id !== want);
    if (state.sessions.length === before) return { ok: false, error: "unknown session" };
    if (!state.sessions.length) {
      const fresh = empty();
      state.sessions = fresh.sessions;
      state.active_id = fresh.active_id;
    } else if (state.active_id === want) {
      state.active_id = state.sessions[0].id;
    }
    save(state);
    return { ok: true, active_id: state.active_id, removed: want };
  }

  // GP-M31 (§5.1 消息反应): toggle a reaction on a stored message. The store
  // is the single source of truth (single-user desktop → per-emoji counter);
  // reload renders the same chips from these rows.
  function react(sessionId, messageId, emoji, on) {
    const sid = String(sessionId || "").trim();
    const mid = String(messageId || "").trim();
    const emo = String(emoji || "").trim();
    if (!sid || !mid || !emo) return { ok: false, error: "invalid_reaction" };
    if (Array.from(emo).length > 8) return { ok: false, error: "invalid_reaction" };
    const want = on !== false;
    const state = load();
    const sess = (state.sessions || []).find((s) => s && s.id === sid);
    if (!sess) return { ok: false, error: "session_not_found", session_id: sid };
    const hit = (sess.messages || []).find((m) => m && String(m.id) === mid);
    if (!hit) return { ok: false, error: "message_not_found", message_id: mid };
    if (!hit.reactions || typeof hit.reactions !== "object" || Array.isArray(hit.reactions)) {
      hit.reactions = {};
    }
    const cur = Number(hit.reactions[emo]) || 0;
    const next = cur + (want ? 1 : -1);
    if (next > 0) hit.reactions[emo] = next;
    else delete hit.reactions[emo];
    save(state);
    return { ok: true, id: mid, session_id: sid, reactions: hit.reactions };
  }

  // Replica C3: delete a single stored message so a regenerated reply can
  // replace the old one atomically (reload never shows duplicates).
  function removeMessage(sessionId, messageId) {
    const sid = String(sessionId || "").trim();
    const mid = String(messageId || "").trim();
    if (!sid || !mid) return { ok: false, error: "invalid_message" };
    const state = load();
    const sess = (state.sessions || []).find((s) => s && s.id === sid);
    if (!sess) return { ok: false, error: "session_not_found", session_id: sid };
    const before = (sess.messages || []).length;
    sess.messages = (sess.messages || []).filter((m) => !(m && String(m.id) === mid));
    if (sess.messages.length === before) {
      return { ok: false, error: "message_not_found", message_id: mid };
    }
    sess.updated_at = new Date().toISOString();
    save(state);
    return { ok: true, session_id: sid, removed: mid };
  }

  const api = {
    storePath,
    list,
    get,
    create,
    setActive,
    appendMessages,
    findMessage,
    activeId,
    rename,
    remove,
    react,
    removeMessage,
  };
  /* KP-09 片10：面被拦成只读时，写方法给的是回执而不是异常 ——
     调用方看得见「这条没写进去」，界面才不会把拒绝画成成功。 */
  for (const name of ["create", "setActive", "appendMessages", "rename", "remove", "react", "removeMessage"]) {
    const fn = api[name];
    api[name] = (...args) => {
      try {
        return fn(...args);
      } catch (e) {
        if (e && e.code === "SESSION_FOLD_BLOCKED") {
          return { ok: false, error: "fold_blocked", detail: String(e.message) };
        }
        throw e;
      }
    };
  }
  return api;
}

module.exports = { createSessionStore, getSessionStore };

/* KP-09 片1（单写者）：一个进程里同一个 dataRoot 只能有一个 sessions store 实例。
   实例各自记着「最后一次读到的状态文本」——EVENT_ONLY 下那是 diff 的左半边，两个实例
   交替写同一张面，后写的就拿陈旧的 prev 做 diff，等于把一张面拆成两条账。
   grok_import.js 早就在注释里要求调用方复用 Host 的那两个实例，但约定不是结构：
   这里按 repoRoot+dataRoot 收口，谁要都用同一个。 */
const storeInstances = new Map();

function getSessionStore(repoRoot, opts = {}) {
  const root = path.resolve(repoRoot);
  const dataRoot = opts.dataRoot ? path.resolve(opts.dataRoot) : path.join(root, "data");
  const key = root + "\u0000" + dataRoot;
  let hit = storeInstances.get(key);
  if (!hit) {
    hit = createSessionStore(repoRoot, opts);
    storeInstances.set(key, hit);
  }
  return hit;
}
