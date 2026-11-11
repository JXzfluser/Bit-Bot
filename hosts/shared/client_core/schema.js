/*
 * client_core/schema.js — KP-08 / T3-02：客户端要认的词汇，单点定义。
 *
 * 这里只放**词表和形状**，不放行为：行为在 reducer.js（fold）与后面的
 * diff_apply.js / transport.js 里。为什么值得单独一个文件 ——
 * 三份真源今天并存且会各自漂移：
 *   · `docs/events.md` §5.1/§5.2/§5.4 定 command 与 event 的词表，
 *   · `ui_protocol/types.mbt` 定内核能发的消息种类（MessageKind / EndTurnReason），
 *   · 渲染层 `hosts/desktop/index.html` 里散着一堆字符串比较（kind === "…"）。
 * 客户端读的是日志里的 kind、屏幕上发的是 command、气泡里画的是 MessageKind，
 * 三者的名字对不上时不会报错，只会「这条消息在桌面看得见、在手机折不出来」。
 * 所以：本文件是这三份词表在 JS 侧的**唯一落点**，门（scripts/prove_client_core.js）
 * 逐条拿它跟 docs/events.md 与 ui_protocol/types.mbt 对字，多一个少一个都红。
 *
 * 两条口径写死在这里：
 *   1. surfaces 只有 sessions / rooms / approvals 三个（§5.4 规则 1，不多不少）；
 *   2. 保留 session_id 只有 "system" 与 "box"（§5.2 末），业务 id 不许占用。
 *
 * @ts-check
 */

/* 三个核心文件都会被渲染端当 classic script 顺序加载，同一个 realm 里顶层
   `const API` 只能声明一次 —— 整份包进 IIFE，文件之间从此互不知晓。 */
(function () {
"use strict";

/** @typedef {{surface: "sessions"|"rooms"|"approvals", entity_id: string, changed_fields: Record<string, unknown>, moved_bucket?: boolean}} ChangedRow */

/** 三张面（§5.4 规则 1）。 */
const SURFACES = ["sessions", "rooms", "approvals"];

/** 保留 session_id（§5.2 末：全局事件 = system，无头宿主 = box）。 */
const RESERVED_SESSION_IDS = ["system", "box"];

/**
 * §5.2 回合流 14 个 kind 与它们的必带 payload。
 * `durable: false` 的只有 delta（§5.3：token 增量不落库，只进内存缓冲）。
 */
const TURN_EVENT_KINDS = {
  session_created: { payload: ["session"], durable: true },
  turn_started: { payload: ["turn_id", "initiator"], durable: true },
  delta: { payload: ["turn_id", "channel", "text"], durable: false },
  progress: { payload: ["turn_id", "row"], durable: true },
  message_committed: { payload: ["message"], durable: true },
  approval_requested: { payload: ["approval"], durable: true },
  approval_decided: { payload: ["approval_id", "decision", "scope", "by"], durable: true },
  effect_started: { payload: ["effect_id", "kind", "target"], durable: true },
  effect_finished: { payload: ["effect_id", "ok"], durable: true },
  turn_ended: { payload: ["turn_id", "status"], durable: true },
  job_started: { payload: ["job_id", "pid", "cmd"], durable: true },
  job_output: { payload: ["job_id", "stream", "text"], durable: true },
  job_ended: { payload: ["job_id", "exit_code"], durable: true },
  presence_changed: { payload: ["machine_id", "online", "last_seen_ms"], durable: true },
};

/** §5.4 镜像 kind：其中 4 个复用回合流的写法，8 个是镜像独有。 */
const MIRROR_ONLY_KINDS = [
  "message_updated",
  "message_removed",
  "history_pruned",
  "entity_state_changed",
  "entity_removed",
  "entity_activated",
  "entity_order_changed",
  "store_state_changed",
];
const MIRROR_REUSED_KINDS = [
  "session_created",
  "message_committed",
  "approval_requested",
  "approval_decided",
];

/**
 * §5.1 的 12 条 command：入参按文档，落库按文档。
 * `receipt` 是 T3-05 之前缺的那一块 —— 乐观命令必须能被回执对上，
 * 所以这里把回执形状钉死（见 docs/events.md §5.9）：
 *   · `idem_key` 由客户端生成，服务端按它去重（§4，event_log 已有唯一索引）；
 *   · `echo_entry_id` 由服务端回，指向**落库那一条**的稳定 id，
 *     渲染层用它把乐观行换成真行 —— 不再靠「列表末尾第几条」这种位置巧合。
 */
const COMMANDS = {
  user_message: { args: ["session_id", "text", "attachments", "idem_key"], receipt: ["echo_entry_id", "turn_id"] },
  approve: { args: ["session_id", "approval_id", "scope"], receipt: ["approval_id"] },
  deny: { args: ["session_id", "approval_id", "reason"], receipt: ["approval_id"] },
  cancel_turn: { args: ["session_id", "turn_id"], receipt: ["turn_id"] },
  create_bot: { args: ["bot", "idem_key"], receipt: ["bot_id"] },
  update_bot: { args: ["bot_id", "patch", "idem_key"], receipt: ["bot_id"] },
  create_room: { args: ["room", "idem_key"], receipt: ["room_id"] },
  send_room_message: { args: ["room_id", "text", "mention_bot_ids", "idem_key"], receipt: ["echo_entry_id"] },
  set_setting: { args: ["key", "value"], receipt: ["key"] },
  start_job: { args: ["session_id", "job", "idem_key"], receipt: ["job_id"] },
  stop_job: { args: ["session_id", "job_id"], receipt: ["job_id"] },
  ack: { args: ["session_id", "upto_seq"], receipt: [] },
};

/**
 * `ui_protocol/types.mbt` 的一一对应表（T3-02 的完成定义就是这张表存在）。
 * key 是 MoonBit 构造子名，value 是 core 侧的判据：
 * `label` 对应 `MessageKind::label` 的返回值，`fields` 是渲染层真正会读的字段。
 */
const MESSAGE_KINDS = {
  Text: { label: "text", fields: ["body"] },
  Widget: { label: "widget", fields: ["widget_id", "payload_json"] },
  Attachment: { label: "attachment", fields: ["name", "mime", "path"] },
  Voice: { label: "voice", fields: ["audio_path", "transcript"] },
  Reaction: { label: "reaction", fields: ["emoji", "target_message_id"] },
};

/** EndTurnReason（内核）→ turn_ended.status（事件词表）的对应，两边都不许自己猜。 */
const END_TURN_STATUS = {
  Completed: "ok",
  Cancelled: "cancelled",
  Error: "error",
  AwaitingApproval: "awaiting_approval",
};

/**
 * KP-03 失败码在回执里的三种写法 —— 这里是单点定义（T3-02），transport.js 抄的
 * 就是这三条，G-120 CC-16 逐字比对，两份漂了就红：
 *   error_code     我们 Host 现在就在发（桌面端 sendFailureText 读它）；
 *   rejection_code 内核侧契约名（docs/grok-desktop-parity/kernel-mechanism-parity.md 的发送回执）；
 *   code           normalizeFailure 输出的 canonical 名。
 * 失败原文不是码，列在 REJECTED_RECEIPT_TEXT_FIELDS，只进诊断文案。
 */
const REJECTED_RECEIPT_FIELDS = ["error_code", "rejection_code", "code"];
const REJECTED_RECEIPT_TEXT_FIELDS = ["error", "message"];

function turnEventKinds() {
  return Object.keys(TURN_EVENT_KINDS);
}

function allEventKinds() {
  return Array.from(new Set(turnEventKinds().concat(MIRROR_ONLY_KINDS)));
}

/** @param {string} kind @returns {boolean} 这个 kind 是否要落库（delta 不要，§5.3）。 */
function isDurableEvent(kind) {
  const spec = TURN_EVENT_KINDS[kind];
  return spec ? spec.durable !== false : true;
}

/**
 * 自检：词表内部不能自相矛盾。
 * 门用它挡「往一个文件里加 kind、忘了加另一个」这种半截改动。
 * @returns {string[]} 为空即一致
 */
function selfCheck() {
  const problems = [];
  if (SURFACES.length !== 3) problems.push("surfaces 必须是 sessions/rooms/approvals 三个（§5.4 规则 1）");
  for (const k of MIRROR_REUSED_KINDS) {
    if (!TURN_EVENT_KINDS[k]) problems.push(`镜像复用 kind 不在回合流词表里：${k}`);
  }
  for (const k of MIRROR_ONLY_KINDS) {
    if (TURN_EVENT_KINDS[k]) problems.push(`镜像独有 kind 与回合流重名：${k}`);
  }
  for (const [name, c] of Object.entries(COMMANDS)) {
    if (!c.args.includes("idem_key") && ["user_message", "create_bot", "update_bot", "create_room", "send_room_message", "start_job"].includes(name)) {
      problems.push(`${name} 少了 idem_key（§4 幂等）`);
    }
  }
  for (const [name, spec] of Object.entries(MESSAGE_KINDS)) {
    if (!spec.label || !spec.fields.length) problems.push(`MessageKind ${name} 的对应表不完整`);
  }
  if (Object.keys(END_TURN_STATUS).length !== 4) problems.push("EndTurnReason 有四个构造子");
  if (REJECTED_RECEIPT_FIELDS.some((f) => REJECTED_RECEIPT_TEXT_FIELDS.includes(f))) {
    problems.push("失败码字段与原文字段重名，归一化会分不清拿到的是码还是文案");
  }
  if (!Object.keys(COMMANDS).some((n) => COMMANDS[n].receipt.includes("echo_entry_id"))) {
    problems.push("没有任何 command 的回执带 echo_entry_id —— 乐观消息无从对账");
  }
  return problems;
}

const API = {
  SURFACES,
  RESERVED_SESSION_IDS,
  TURN_EVENT_KINDS,
  MIRROR_ONLY_KINDS,
  MIRROR_REUSED_KINDS,
  COMMANDS,
  MESSAGE_KINDS,
  END_TURN_STATUS,
  REJECTED_RECEIPT_FIELDS,
  REJECTED_RECEIPT_TEXT_FIELDS,
  turnEventKinds,
  allEventKinds,
  isDurableEvent,
  selfCheck,
};

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof globalThis !== "undefined" && globalThis.__bitbotClientCore) {
  Object.assign(globalThis.__bitbotClientCore, API);
}
})();
