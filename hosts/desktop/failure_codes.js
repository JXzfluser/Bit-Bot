/*
 * KP-03 — 发送失败的唯一码表（pure, zero-dependency）。
 *
 * 为什么单独一个文件：Electron 渲染层是沙箱，不能 require()；Host 用 Node。
 * 一个纯模块可以同时被两边加载（渲染层 <script src>，Host require()），于是
 * 「Host 产出的码」「桌面显示的码」「手机契约里的码」是同一份表，而不是各写各的。
 * 第二份副本会让 UI 看起来对、Host 其实发的是别的东西（沿用 progress_protocol.js
 * 的纪律）。
 *
 * 收编原则（不新造词）：下面每个 canonical code 都对应当前代码里**已经在产**的
 * 串（见 docs/events.md §5.5 的来源列）。只有两处是 spec 指定的收敛名：
 *   - api_key_not_configured（host_ffi.js 已在产）收编进 provider_unconfigured；
 *   - 认不出的串一律落 unknown_failure，绝不把上游原文当码抛给界面。
 * normalizeFailure 是边界函数：接受任意上游 error 文本/对象，永不抛错。
 */
(function () {
  "use strict";

  /* Canonical enum。顺序即 docs/events.md §5.5 的表序。 */
  var CODES = [
    "provider_unconfigured",
    "empty_user_text",
    "kernel_invalid_json",
    "cancelled",
    "local_execution_never",
    "shell_approval_required",
    "llm_chat_failed",
    "no_reply",
    "turn_failed",
    "host_effect_failed",
    "room_turn_timeout",
    "bot_not_found",
    "responder_missing",
    "room_surface_unavailable",
    "orchestrator_unavailable",
    "room_and_text_required",
    "rooms_store_unreadable",
    "route_failed",
    "orchestrate_failed",
    "no_responders",
    "too_many_responders",
    "orchestrate_recursion",
    "responder_runner_required",
    "discretion_turn_failed",
    "discretion_unclear",
    "handoff_runner_required",
    "handoff_stuck",
    "handoff_retry_runner_required",
    "synthesis_turn_failed",
    "synthesis_no_reply",
    "budget_max_wall_ms",
    "budget_max_turns",
    "budget_max_tokens",
    "unknown_failure",
  ];

  var CODE_SET = {};
  for (var i = 0; i < CODES.length; i++) CODE_SET[CODES[i]] = true;

  /* 精确别名：当前产出串 → canonical。identity 的码不在此列（直接命中 CODE_SET）。 */
  var ALIASES = {
    api_key_not_configured: "provider_unconfigured",
    "empty user text": "empty_user_text",
    canceled: "cancelled",
    room_turn_deadline: "room_turn_timeout",
    max_wall_ms: "budget_max_wall_ms",
    max_turns: "budget_max_turns",
    max_tokens: "budget_max_tokens",
  };

  /* 前缀/子串别名：产出串带动态尾巴（`invalid JSON from MoonBit: <msg>`、
   * `handoff_stuck:<原因>`），不能精确匹配，按前缀收编。 */
  var PREFIX_ALIASES = [
    { match: "invalid JSON from MoonBit", code: "kernel_invalid_json" },
    { match: "handoff_stuck", code: "handoff_stuck" },
  ];

  /* 每个码的 i18n label key。渲染层据此本地化；码本身始终可见（私聊发送失败面）。
   * 群聊面沿用 GP-147 纪律：只显示人话 label，协议码只在 dev-mode 追加。 */
  var LABEL_KEY = {
    provider_unconfigured: "failProviderUnconfigured",
    empty_user_text: "failEmptyText",
    kernel_invalid_json: "failKernelJson",
    cancelled: "failCancelled",
    local_execution_never: "failLocalNever",
    shell_approval_required: "failApprovalRequired",
    llm_chat_failed: "failModelFailed",
    no_reply: "failNoReply",
    room_turn_timeout: "failTimeout",
    bot_not_found: "failBotNotFound",
    budget_max_wall_ms: "failBudget",
    budget_max_turns: "failBudget",
    budget_max_tokens: "failBudget",
    unknown_failure: "failUnknown",
  };
  var DEFAULT_LABEL = "failGeneric";

  /* 可照做的下一步。没有明确入口的码不给 action（不编一个假按钮）。 */
  var ACTION_KEY = {
    provider_unconfigured: "failActionModelSettings",
    shell_approval_required: "failActionApprove",
    kernel_invalid_json: "failActionRetry",
    llm_chat_failed: "failActionRetry",
    no_reply: "failActionRetry",
    room_turn_timeout: "failActionRetry",
    unknown_failure: "failActionRetry",
  };

  function isCode(c) {
    return typeof c === "string" && CODE_SET[c] === true;
  }

  /* 把一个候选串解析成 canonical code；认不出返回 ""（交给调用方落 unknown）。 */
  function resolveToken(token) {
    var s = String(token == null ? "" : token).trim();
    if (!s) return "";
    if (isCode(s)) return s;
    if (Object.prototype.hasOwnProperty.call(ALIASES, s)) return ALIASES[s];
    for (var i = 0; i < PREFIX_ALIASES.length; i++) {
      if (s.indexOf(PREFIX_ALIASES[i].match) === 0) return PREFIX_ALIASES[i].code;
    }
    return "";
  }

  /**
   * normalizeFailure(input) — 边界归一化。input 可以是：
   *   - 字符串（上游 error 原文）
   *   - 对象 { error_code | code | reason | error }（Host 回执 / 流式 chunk）
   * 返回 { code, raw, label_key, action_key }。永不抛错；认不出一律 unknown_failure。
   * 显式 error_code/code 优先于自由文本（机器码比措辞可靠）。
   */
  function normalizeFailure(input) {
    var raw = "";
    var code = "";
    if (input && typeof input === "object") {
      raw = String(
        input.error || input.reason || input.error_code || input.code || ""
      );
      code =
        resolveToken(input.error_code) ||
        resolveToken(input.code) ||
        resolveToken(input.reason) ||
        resolveToken(input.error);
    } else if (typeof input === "string" || typeof input === "number") {
      raw = String(input);
      code = resolveToken(input);
    }
    if (!code) code = "unknown_failure";
    return {
      code: code,
      raw: raw,
      label_key: LABEL_KEY[code] || DEFAULT_LABEL,
      action_key: ACTION_KEY[code] || "",
    };
  }

  function describe(code) {
    var c = isCode(code) ? code : "unknown_failure";
    return { code: c, label_key: LABEL_KEY[c] || DEFAULT_LABEL, action_key: ACTION_KEY[c] || "" };
  }

  var api = {
    CODES: CODES,
    ALIASES: ALIASES,
    PREFIX_ALIASES: PREFIX_ALIASES,
    LABEL_KEY: LABEL_KEY,
    ACTION_KEY: ACTION_KEY,
    DEFAULT_LABEL: DEFAULT_LABEL,
    isCode: isCode,
    resolveToken: resolveToken,
    normalizeFailure: normalizeFailure,
    describe: describe,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.__bitbotFailure = api;
})();