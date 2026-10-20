/*
 * GP-96/97/98 — §5.7 进度更新的唯一协议层（pure, zero-dependency）.
 *
 * Why a separate file from turn_progress.js: the Electron renderer is sandboxed
 * and may not require() anything, while the Node host may use fs/path. A pure
 * module can be loaded BOTH ways (<script src> in the shell, require() in the
 * Host), so the category set, the kind→category table and the stream reducer
 * the UI uses are the same ones the Host produced events against. A second
 * copy in the renderer would let the UI look correct while the Host emitted
 * something else.
 *
 * Official §5.7 list (verbatim): 工具活动 / Computer 使用 / 创建的文件 /
 * 问题 / 审批请求 / 语音消息.
 */
(function () {
  "use strict";

  var CATEGORY_TOOL = "tool_activity";
  var CATEGORY_COMPUTER = "computer_use";
  var CATEGORY_FILES = "created_files";
  var CATEGORY_QUESTION = "question";
  var CATEGORY_APPROVAL = "approval_request";
  var CATEGORY_VOICE = "voice_message";
  var CATEGORY_MODEL = "model_reply";

  // Official categories, in the order the spec lists them.
  var CATEGORIES = [
    CATEGORY_TOOL,
    CATEGORY_COMPUTER,
    CATEGORY_FILES,
    CATEGORY_QUESTION,
    CATEGORY_APPROVAL,
    CATEGORY_VOICE,
  ];

  var KIND_CATEGORY = {
    // Computer 使用（官方 §3 共享电脑上的动作）
    computer_use: CATEGORY_COMPUTER,
    screenshot: CATEGORY_COMPUTER,
    computer_preview: CATEGORY_COMPUTER,
    take_over: CATEGORY_COMPUTER,
    takeover_done: CATEGORY_COMPUTER,
    box_chrome_probe: CATEGORY_COMPUTER,
    box_clock: CATEGORY_COMPUTER,
    box_env: CATEGORY_COMPUTER,
    box_doctor: CATEGORY_COMPUTER,
    recover_computer: CATEGORY_COMPUTER,
    reset_computer: CATEGORY_COMPUTER,
    update_computer: CATEGORY_COMPUTER,
    device_permission: CATEGORY_COMPUTER,
    guide_permission: CATEGORY_COMPUTER,

    // 创建的文件（Host 真落盘的产物）
    copy_to_box: CATEGORY_FILES,
    copy_from_box: CATEGORY_FILES,
    webhook_copy: CATEGORY_FILES,
    skill_write: CATEGORY_FILES,
    export_pack: CATEGORY_FILES,
    slides_pptx: CATEGORY_FILES,
    generate_image: CATEGORY_FILES,
    generate_video: CATEGORY_FILES,
    journal_append: CATEGORY_FILES,
    cloud_artifact_deliver: CATEGORY_FILES,
    mail_draft: CATEGORY_FILES,
    schedule_meeting: CATEGORY_FILES,

    // 语音消息（官方 §5.3–5.4）
    voice_session: CATEGORY_VOICE,
    voice_relay: CATEGORY_VOICE,
    voice_end_write: CATEGORY_VOICE,

    // 审批请求（官方 §5.8 / §8.2）
    approval_card: CATEGORY_APPROVAL,

    // 模型回复本身（回合自身的工作，不算"工具活动"）
    llm_chat: CATEGORY_MODEL,
  };

  /* i18n dictionary keys per category — the renderer maps these to localized
   * text; the raw kind is never the only thing shown. */
  var LABEL_KEY = {};
  LABEL_KEY[CATEGORY_TOOL] = "progTool";
  LABEL_KEY[CATEGORY_COMPUTER] = "progComputer";
  LABEL_KEY[CATEGORY_FILES] = "progFiles";
  LABEL_KEY[CATEGORY_QUESTION] = "progQuestion";
  LABEL_KEY[CATEGORY_APPROVAL] = "progApproval";
  LABEL_KEY[CATEGORY_VOICE] = "progVoice";
  LABEL_KEY[CATEGORY_MODEL] = "progModel";

  function categorizeEffect(kind, result) {
    var k = String(kind || "");
    // Result flags outrank the static table: an effect that came back asking
    // for confirmation is a 问题 in the stream, and one queued for approval is
    // an 审批请求 — whatever kind it started as.
    if (result) {
      if (result.needs_approval === true) return CATEGORY_APPROVAL;
      if (result.needs_confirm === true || result.awaiting_confirm === true)
        return CATEGORY_QUESTION;
    }
    if (KIND_CATEGORY[k]) return KIND_CATEGORY[k];
    return CATEGORY_TOOL;
  }

  function labelKeyFor(category) {
    return LABEL_KEY[category] || LABEL_KEY[CATEGORY_TOOL];
  }

  /* ------------------------------------------------------------------
   * createProgressState() — renderer-side stream reducer.
   *
   * §5.7 acceptance「长时间任务有中间更新」means ONE row that advances in
   * place (plus counters per category), not N new bubbles per turn. This is
   * pure state so a probe can feed it the exact events the Host emitted and
   * assert what the UI would show, without a browser.
   * ------------------------------------------------------------------ */
  function createProgressState() {
    var st = {
      active: false,
      total: 0,
      index: 0,
      kind: "",
      category: "",
      label_key: "",
      phase: "",
      awaiting: "",
      error: "",
      doneCount: 0,
      counts: {},
      lastPaths: [],
      modelStarted: false,
    };
    for (var i = 0; i < CATEGORIES.length; i++) st.counts[CATEGORIES[i]] = 0;
    st.counts[CATEGORY_MODEL] = 0;

    function apply(ev) {
      if (!ev || typeof ev !== "object") return st;
      if (ev.phase === "start") {
        st.active = true;
        st.total = Number(ev.total) || st.total;
        st.index = Number(ev.index) || st.index;
        st.kind = String(ev.kind || "");
        st.category = String(ev.category || categorizeEffect(ev.kind, null));
        st.label_key = labelKeyFor(st.category);
        st.phase = "running";
        st.awaiting = "";
        st.error = "";
        if (st.category === CATEGORY_MODEL) st.modelStarted = true;
      } else if (ev.phase === "done") {
        st.doneCount += 1;
        st.index = Number(ev.index) || st.index;
        st.total = Number(ev.total) || st.total;
        st.kind = String(ev.kind || st.kind);
        st.category = String(ev.category || categorizeEffect(ev.kind, ev));
        st.label_key = labelKeyFor(st.category);
        st.counts[st.category] = (st.counts[st.category] || 0) + 1;
        st.awaiting = String(ev.awaiting || "");
        st.error = ev.ok ? "" : String(ev.error || "failed");
        if (ev.path) st.lastPaths = [String(ev.path)];
        st.phase = st.awaiting ? "awaiting" : ev.ok ? "done" : "failed";
      } else if (ev.phase === "host_continuing") {
        st.active = true;
        st.category = String(ev.category || CATEGORY_MODEL);
        st.label_key = labelKeyFor(st.category);
        st.phase = "continuing";
      } else if (ev.phase === "turn_end") {
        st.active = false;
        st.phase = st.doneCount ? "finished" : "idle";
      } else if (ev.phase === "turn_start") {
        st.active = true;
        st.phase = "started";
        st.doneCount = 0;
        for (var j = 0; j < CATEGORIES.length; j++) st.counts[CATEGORIES[j]] = 0;
        st.counts[CATEGORY_MODEL] = 0;
        st.total = Number(ev.total) || 0;
        st.index = 0;
        st.lastPaths = [];
      }
      return st;
    }

    return { apply: apply, state: st };
  }

  var api = {
    CATEGORIES: CATEGORIES,
    CATEGORY_TOOL: CATEGORY_TOOL,
    CATEGORY_COMPUTER: CATEGORY_COMPUTER,
    CATEGORY_FILES: CATEGORY_FILES,
    CATEGORY_QUESTION: CATEGORY_QUESTION,
    CATEGORY_APPROVAL: CATEGORY_APPROVAL,
    CATEGORY_VOICE: CATEGORY_VOICE,
    CATEGORY_MODEL: CATEGORY_MODEL,
    KIND_CATEGORY: KIND_CATEGORY,
    categorizeEffect: categorizeEffect,
    labelKeyFor: labelKeyFor,
    createProgressState: createProgressState,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.__bitbotProgress = api;
})();
