/*
 * client_core/transport.js — KP-08 / T3-04「transport 接口 + IPC adapter」与
 * T3-06「断线重连与去重」里属于客户端核心的那半份。
 *
 * 它管三件渲染端本来管不好的事，三件都有真实事故来源：
 *
 *  1. **一条面的帧必须排队折叠。** 渲染端今天的 applyBotsDiff 是 async：自愈时
 *     `await refreshBots()`，这段 await 里再进来的广播会作用在**旧的 botState**
 *     上，而那次整份读回来的又可能比它旧 —— 谁后写谁赢，顺序没人保证。这里给
 *     每个面一条自己的链，帧按到达顺序折叠，自愈取数排在链上，插不进来。
 *
 *  2. **回包的形状不能靠调用方记。** `bitbot.surface.read` 发的是
 *     `{ok, surface, rev, payload}` 这个信封，快照在 `.payload` 里；KP-08 第一片
 *     的 KD-11 对拍第一次就栽在这里 —— 把信封整份交给 snapshotToState，核心折出
 *     0 行，看着像「核心算错了」，其实是门自己读错了包。unwrapRead 把这条形状
 *     规则收进 core，只在成功时取快照，其余一律报成可诊断的失败。
 *     （信封是 IPC 交付层的包装，不是产品数据，所以这里不认「裸快照」。）
 *
 *  3. **乐观消息要有身份。** 回车那一刻界面画的那条，和落库那一条，必须是同一条：
 *     渲染端自己生成 client_msg_id、现在就当它的 id 用；Host 落库时沿用这个 id，
 *     回执再把它作为 echo_entry_id 发回来。于是对账不是「按位置猜哪条是我发的」
 *     （今天 stored_ids.user 就是这么回填的），而是「这两个字符串相等」。
 *     不相等就是不匹配，报 anomaly；回执没有 echo 字段就是未确认，界面不许亮成
 *     「已送达」。拒绝必须带 KP-03 的码。
 *
 * 红线（T3-01 定的，G-120 CC-16.. 钉着）：没有 DOM、没有 Electron、没有 fs，
 * 连其它三份 core 文件都不 require —— fold/applyDiff/snapshotToState 由装配方
 * 注入，浏览器里当 classic script 加载、Node 里 require 后注入，同一份代码不改写。
 */

(function () {
"use strict";

/** 乐观命令的生命周期。pending 之外全是终态，终态不许再变回去。 */
const CMD_STATE = {
  Pending: "pending",
  Durable: "durable",
  Rejected: "rejected",
  Unmatched: "unmatched",
  Expired: "expired",
};

/**
 * 回执里的落库指针。名字就用 docs/events.md §5.1 各 command 的 receipt 里那个
 * `echo_entry_id`（schema.COMMANDS 抄了一遍，CC-16 逐字比对）—— 不在这里另造
 * entry_id / message_id 那种「大概同名」的字段，那种别名只会让对账悄悄失配。
 */
const ECHO_FIELDS = ["echo_entry_id"];
/**
 * 可能带失败码的字段：`error_code` 是我们 Host 现在就在发的（桌面端
 * sendFailureText 读它），`rejection_code` 是内核侧契约名，`code` 是归一化后的
 * canonical 名。名单的单点定义在 schema.js 的 REJECTED_RECEIPT_FIELDS，
 * CC-16 比对这两份，漂了当场红。
 */
const REJECT_FIELDS = ["error_code", "rejection_code", "code"];
/** 失败原文的字段：只能用来诊断，绝不当成码。 */
const REJECT_TEXT_FIELDS = ["error", "message"];

/* 台账上限：Host 永不回执时，这里不能无限长。淘汰的是最老的终态记录，
   还在 pending 的永远留着（它们才是屏幕上正在等的东西）。 */
const LEDGER_MAX = 256;

function str(v) {
  return v === undefined || v === null ? "" : String(v);
}

function hex(rand, n) {
  let s = "";
  while (s.length < n) s += str(rand()).replace(/[^0-9a-z]/gi, "").toLowerCase();
  return s.slice(0, n);
}

/**
 * 乐观那条消息的界面侧 id。前缀 `cm-` 只用来让日志和门一眼看出这条的身份来自
 * 渲染端；Host 落库后它就是库里那一行的 id，和 Host 自己生成的 `msg-` 不在同一个
 * 命名空间，不会撞。
 * @param {() => string} rand
 * @returns {string}
 */
function makeClientId(rand) {
  const pick = rand || Math.random;
  return "cm-" + hex(() => str(pick()), 16);
}

/** 回执里找落库指针；没有就返回空串，由调用方判成「未确认」，不许当成成功。 */
function echoOf(receipt) {
  if (!receipt || typeof receipt !== "object") return "";
  for (const f of ECHO_FIELDS) if (str(receipt[f])) return str(receipt[f]);
  return "";
}

/** 回执里的码。有码就只认码；完全没码时把原文截一段留着诊断，但绝不当成码。 */
function codeOf(receipt) {
  if (!receipt || typeof receipt !== "object") return "";
  for (const f of REJECT_FIELDS) if (str(receipt[f])) return str(receipt[f]);
  return "";
}

/** 没有码时的原文：只用于诊断文案，永远不进 code 字段。 */
function textOf(receipt) {
  if (!receipt || typeof receipt !== "object") return str(receipt);
  return REJECT_TEXT_FIELDS.map((f) => str(receipt[f])).filter(Boolean).join(" / ");
}

/**
 * 乐观命令台账。begin → settle 是一条命令的两端；expire 负责「等太久」这第三种
 * 结局 —— 断线时屏幕上那条不能永远绿着。T3-06 补上另一半：touch 是「还活着」的
 * 证据（流式片段/进度帧都算），expire 的钟从「距发出」改成「距最后一次证据」；
 * expired 不是结局而是「没证据」，所以迟到的回执可以纠正它（绝不回到 pending）。
 *
 * @param {{rand?: () => string, now?: () => number, idem?: boolean}} hooks
 */
function createLedger(hooks) {
  const h = hooks || {};
  const rand = h.rand || Math.random;
  const now = h.now || (() => Date.now());
  /** @type {Map<string, any>} */
  const byId = new Map();
  /** 插入顺序，淘汰终态时按它走。@type {string[]} */
  const seq = [];

  function remember(cmd) {
    byId.set(cmd.client_msg_id, cmd);
    seq.push(cmd.client_msg_id);
    if (seq.length > LEDGER_MAX) {
      for (let i = 0; i < seq.length && seq.length > LEDGER_MAX; i++) {
        const old = byId.get(seq[i]);
        if (old && old.state !== CMD_STATE.Pending) {
          byId.delete(seq[i]);
          seq.splice(i, 1);
          i--;
        }
      }
    }
    return cmd;
  }

  /**
   * 生成一个台账里还没有的 client_msg_id。rand 可以是任何来源（生产用
   * Math.random，门里给一个定值序列）；重复时最多换 8 次，还重复就报错 ——
   * 乐观消息的身份撞车，屏幕上两条会变成一条，这种错必须响，不能静默覆盖。
   */
  function nextClientId() {
    for (let i = 0; i < 8; i++) {
      const cid = makeClientId(rand);
      if (!byId.has(cid)) return cid;
    }
    throw new Error("client_msg_id 连续 8 次撞车：rand 太弱，乐观消息会被互相覆盖");
  }

  /**
   * 记下一条要发的命令，并给出界面上**现在就该画**的那一行。
   * 同一个命令名 + 同一个 idem_key 重复 begin 时，返回原来那条（幂等，§4）：
   * 回车连点两次不该出现两条乐观消息。
   * @param {string} name schema.COMMANDS 里的名字
   * @param {Record<string, any>} [args]
   * @returns {{cmd: any, optimistic: any, reused: boolean}}
   */
  function begin(name, args) {
    const a = args && typeof args === "object" ? args : {};
    const idem = str(a.idem_key);
    if (idem) {
      for (const id of seq) {
        const c = byId.get(id);
        if (c && c.name === name && c.idem_key === idem && c.state === CMD_STATE.Pending) {
          return { cmd: c, optimistic: c.optimistic, reused: true };
        }
      }
    }
    const cid = nextClientId();
    const beganAt = Number(now());
    const cmd = {
      cmd_id: cid,
      client_msg_id: cid,
      name: str(name),
      idem_key: idem,
      text: str(a.text),
      session_id: str(a.session_id || a.room_id || ""),
      sent_at_ms: beganAt,
      // T3-06：expire 看的是「距最后一次证据」，不是「距发出」。begin 时还没有证据，
      // 所以 alive 就等于 sent；任何一条证据都会把它推后。
      alive_at_ms: beganAt,
      state: CMD_STATE.Pending,
      entry_id: "",
      code: "",
      anomalies: [],
    };
    const optimistic = {
      id: cid,
      role: "user",
      kind: str(a.kind || "Text"),
      text: cmd.text,
      at: cmd.sent_at_ms,
      optimistic: true,
    };
    cmd.optimistic = optimistic;
    return { cmd: remember(cmd), optimistic, reused: false };
  }

  /**
   * 一条命令的回执到了。返回的 cmd 就是台账里那份（同一对象），界面按 state 画：
   * durable → 已送达；rejected → 变红 + 码；unmatched → 「落库的不是我发的那条」；
   * 回执没有 echo → unmatched（不许亮成已送达）；终态不被迟到回执改回去（late）。
   *
   * T3-06 唯一的例外是 expired：它不是「结局」，只是「到点了还没证据」。所以
   * 迟到的回执可以纠正它（corrected=true，异常照记），但**任何情况下都不回到
   * pending** —— 屏幕上那行不能从「没等到回执」再变回转圈。
   * @param {string} clientMsgId
   * @param {any} receipt
   */
  function settle(clientMsgId, receipt) {
    const cmd = byId.get(str(clientMsgId));
    if (!cmd) return { found: false, cmd: null };
    const from = cmd.state;
    if (from !== CMD_STATE.Pending && from !== CMD_STATE.Expired)
      return { found: true, cmd, late: true };
    const ok = !!(receipt && receipt.ok === true);
    if (!receipt) {
      cmd.state = CMD_STATE.Unmatched;
      cmd.anomalies.push("回执为空：没告诉界面上那条落库成了什么");
    } else if (!ok) {
      cmd.state = CMD_STATE.Rejected;
      cmd.code = codeOf(receipt);
      if (!cmd.code) {
        cmd.anomalies.push("拒绝没带 KP-03 的码，只有原文：" + textOf(receipt).slice(0, 80));
      }
    } else {
      const echo = echoOf(receipt);
      if (!echo) {
        cmd.state = CMD_STATE.Unmatched;
        cmd.anomalies.push("成功回执没有 echo_entry_id：不能声称这条已落库");
      } else if (echo === cmd.client_msg_id) {
        cmd.state = CMD_STATE.Durable;
        cmd.entry_id = echo;
      } else {
        cmd.state = CMD_STATE.Unmatched;
        cmd.entry_id = echo;
        cmd.anomalies.push(
          `落库那条（${echo}）不是界面上这条（${cmd.client_msg_id}）——` +
            "界面必须换节点，节点身份就丢了；这是按位置回填的老毛病，不许当成功",
        );
      }
    }
    cmd.settled_at_ms = Number(now());
    const out = { found: true, cmd, late: false };
    if (from === CMD_STATE.Expired) {
      cmd.corrected_at_ms = cmd.settled_at_ms;
      cmd.anomalies.push(
        `迟到的回执把 expired 纠正成 ${cmd.state}（距发出 ${
          Math.round(cmd.settled_at_ms - cmd.sent_at_ms)
        }ms 才到）：expired 只是「没证据」，不是结局`,
      );
      out.corrected = true;
    }
    return out;
  }

  /**
   * 一条「还活着」的证据：流式片段、进度帧、任何来自 Host 的动静都算。
   * T3-06 的超时看的是「距最后一次证据」而不是「距发出」—— 首字延迟 90s 的
   * 长回合不该在第 10 秒被画成「没等到回执」，只要它一直在往外吐字。
   * 只对 pending 有效：已经尘埃落定的那条不会被动静推翻。
   * @param {string} clientMsgId @param {number} [atMs]
   */
  function touch(clientMsgId, atMs) {
    const cmd = byId.get(str(clientMsgId));
    if (!cmd) return { found: false, cmd: null };
    if (cmd.state !== CMD_STATE.Pending) return { found: true, cmd, touched: false };
    const at = Number(atMs == null ? now() : atMs);
    cmd.alive_at_ms = Number.isFinite(at) ? at : cmd.sent_at_ms;
    return { found: true, cmd, touched: true };
  }

  /**
   * 把等太久的 pending 判成 expired。断线重连不做这件事的话，屏幕上会留着一条
   * 「永远在送达中」的消息，而它其实早就没人认领了。
   * @param {number} maxAgeMs 距最后一次证据的上限
   * @returns {any[]} 被判过期那几条（副本引用，同一对象）
   */
  function expire(maxAgeMs) {
    const limit = Number(maxAgeMs);
    if (!Number.isFinite(limit)) return [];
    const at = Number(now());
    const out = [];
    for (const id of seq) {
      const c = byId.get(id);
      if (c && c.state === CMD_STATE.Pending) {
        // 老台账（没有 alive_at_ms 的记录）退回按发出算，绝不因缺字段而不超时。
        const last = Number.isFinite(c.alive_at_ms) ? c.alive_at_ms : c.sent_at_ms;
        if (at - last > limit) {
          c.state = CMD_STATE.Expired;
          c.expired_at_ms = at;
          c.anomalies.push(
            `回执超时：距最后一次证据 ${Math.round(at - last)}ms > ${limit}ms` +
              `（距发出 ${Math.round(at - c.sent_at_ms)}ms）`,
          );
          out.push(c);
        }
      }
    }
    return out;
  }

  /** @param {string} clientMsgId @returns {any|null} */
  function get(clientMsgId) {
    return byId.get(str(clientMsgId)) || null;
  }

  /** 还在等的（屏幕上的「送达中」就是它），按发出顺序。@returns {any[]} */
  function pending() {
    return seq.map((id) => byId.get(id)).filter((c) => c && c.state === CMD_STATE.Pending);
  }

  function size() {
    return byId.size;
  }

  return { begin, settle, touch, expire, get, pending, size, LEDGER_MAX, CMD_STATE };
}

/**
 * 校验并拆开 `surface.read` 的 IPC 信封。只认成功信封里的 `.payload`；
 * 形状不对就返回可读的失败，绝不把信封本身当快照喂给折叠器（KD-11 栽过一次）。
 * @param {any} res
 * @param {string} surfaceName
 * @returns {{ok: boolean, error?: string, rev: number, payload?: any}}
 */
function unwrapRead(res, surfaceName) {
  if (!res || typeof res !== "object") {
    return { ok: false, error: `${surfaceName} 整份回包不是对象：${str(res)}`, rev: NaN };
  }
  if (res.ok !== true) {
    return {
      ok: false,
      error: `${surfaceName} 整份读取失败：${str(res.error || res.reason || "Host 没说原因")}`,
      rev: NaN,
    };
  }
  if (!Object.prototype.hasOwnProperty.call(res, "payload")) {
    return { ok: false, error: `${surfaceName} 回包没有 payload 字段（信封形状变了）`, rev: NaN };
  }
  if (!res.payload || typeof res.payload !== "object" || Array.isArray(res.payload)) {
    return { ok: false, error: `${surfaceName} 的 payload 不是快照对象`, rev: NaN };
  }
  const rev = Number(res.rev);
  return { ok: true, rev, payload: res.payload };
}

/**
 * 装配一张面的接收链。依赖全部注入，所以这份文件在浏览器里、在 Node 里都能跑。
 *
 * @param {{
 *   surface: string,
 *   fold: (state: any, frame: any) => {state: any, effects: any[]},
 *   full: (frame: any) => any,
 *   read: (surface: string, fromSeq?: number) => Promise<any>,
 *   paint: (report: any) => void | Promise<void>,
 *   now?: () => number,
 * }} opts
 */
function createSurfaceStream(opts) {
  const o = opts || {};
  const name = str(o.surface);
  const now = o.now || (() => Date.now());
  const st = {
    state: null,
    /** 最后被接受那帧的游标（Host 侧那个面的 rev 就是它的序号）。 */
    cursor: NaN,
    chain: Promise.resolve(),
    frames: 0,
    dups: 0,
    heals: 0,
    resyncs: 0,
    queued: 0,
    last_error: "",
  };

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  /** 一帧进链：只接受比游标新的，其余记成 dup（去重发生在这里，不在渲染端）。 */
  function intake(frame) {
    st.frames++;
    const rev = num(frame && frame.rev);
    if (Number.isFinite(rev) && Number.isFinite(st.cursor) && rev <= st.cursor) {
      st.dups++;
      return st.chain;
    }
    st.queued++;
    st.chain = st.chain.then(() => handle(frame)).catch((e) => {
      st.last_error = String((e && e.message) || e);
    });
    return st.chain;
  }

  async function handle(frame) {
    st.queued--;
    const rev = num(frame && frame.rev);
    const gap = Number.isFinite(st.cursor) && Number.isFinite(rev) && rev > st.cursor + 1;
    if (!frame || (frame.mode !== "diff" && frame.mode !== "full") || gap) {
      await resync();
      return;
    }
    if (frame.mode === "full") {
      st.state = o.full(frame);
      if (Number.isFinite(rev)) st.cursor = rev;
      await o.paint({ surface: name, mode: "full", rev: st.cursor, effects: [], state: st.state });
      return;
    }
    if (!st.state) {
      await resync();
      return;
    }
    const got = o.fold(st.state, frame);
    const healed = (got.effects || []).some((e) => e && e.type === "self_heal");
    if (healed) {
      st.heals++;
      await resync();
      return;
    }
    st.state = got.state;
    if (Number.isFinite(rev)) st.cursor = rev;
    await o.paint({
      surface: name,
      mode: "diff",
      rev: st.cursor,
      effects: got.effects,
      state: st.state,
    });
  }

  /**
   * 取整份并把它作为新基线。带 from_seq 就是「从这个游标之后续」，Host 若只给整份
   * 也安全：整份永远比续订新。取回来失败时不动状态、不动游标 —— 屏幕保持上一次
   * 已知为真的样子，而不是画半份。
   */
  async function resync() {
    st.resyncs++;
    const res = await o.read(name, Number.isFinite(st.cursor) ? st.cursor : undefined);
    const un = unwrapRead(res, name);
    if (!un.ok) {
      st.last_error = un.error;
      return { ok: false, error: un.error };
    }
    st.state = o.full(un.payload);
    st.cursor = Number.isFinite(un.rev) ? un.rev : st.cursor;
    await o.paint({
      surface: name,
      mode: "full",
      rev: st.cursor,
      effects: [],
      state: st.state,
      healed: true,
    });
    return { ok: true, rev: st.cursor };
  }

  /** 断线重连：从当前游标续订，落后的帧在 intake 那一步就消失了。 */
  function reconnect() {
    return resync();
  }

  /**
   * 这几计数是给门和现场日志看的：
   * frames 进来的帧数、dups 因不比游标新而丢弃、heals 因折叠效果自愈、
   * resyncs 真的取了几次整份（含跳号）。queued 不归零就是有帧卡在链上。
   */
  function stats() {
    return {
      surface: name,
      cursor: st.cursor,
      frames: st.frames,
      dups: st.dups,
      heals: st.heals,
      resyncs: st.resyncs,
      queued: st.queued,
      last_error: st.last_error,
    };
  }

  return { intake, resync, reconnect, stats, get state() { return st.state; } };
}

const API = {
  CMD_STATE,
  ECHO_FIELDS,
  REJECT_FIELDS,
  REJECT_TEXT_FIELDS,
  LEDGER_MAX,
  makeClientId,
  echoOf,
  codeOf,
  textOf,
  createLedger,
  unwrapRead,
  createSurfaceStream,
};

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof globalThis !== "undefined" && globalThis.__bitbotClientCore) {
  Object.assign(globalThis.__bitbotClientCore, API);
}
})();
