"use strict";

/**
 * effect kind 的**策略单一真源**。
 *
 * 以前 kind 的词表散在四个地方各抄一份:
 *   · 内核 cmd/desktop_turn/turn_json.mbt(产生)
 *   · Host hosts/shared/host_ffi.js(消费)
 *   · 策略白名单 hosts/shared/run_moon_turn.js(3 个 Set)
 *   · 审批规则词表 hosts/desktop/index.html(渲染层,浏览器里 require 不到本文件)
 *
 * 抄四份的代价是**漂移**,而且是静默的:
 *   · 内核发 kind:"purchase",Host 的审批名单写 "purchase_item" ⇒ 该问的不问;
 *   · 白名单照着**意图名**写(install_plugin / secret_store / routine_remove),
 *     真正的 effect kind(package_install / credential_fill / …)反而不在名单里
 *     ⇒ 自决回合能装插件、能写凭证。
 *
 * 这里只声明**策略**(会不会改状态 / 要不要问人),**不声明词表本身** ——
 * 词表的真源是内核:它产生什么 effect,只有它知道。
 * 门禁 scripts/prove_effect_contract.mjs 拿这张表跟内核/Host/渲染层三方差分。
 *
 * mutating   —— 会改状态(写盘 / 改配置 / 对外动作)。
 * approval   —— none=直接跑 / ask=问一次 / never=直接拒。
 * source     —— kernel=内核产生 / host=Host 侧的动作(内核不产生这种 effect)。
 */

/* Host 侧的动作 kind:它们不是 effect,但同样要走审批闸与角色裁剪。 */
const HOST_ACTION_KINDS = new Set([
  "bot_hide",
  "bot_unhide",
  "channel_email",
  "channel_email_claim",
  "computer_shared_session",
  "disable_plugin",
  "install_plugin",
  "llm_list_models",
  "llm_set_model",
  "mail_draft",
  "routine_fire",
  "routine_remove",
  "routine_wake",
  "secret_store",
  "shell",
  "uninstall_plugin",
]);

/* effect kind → 策略。内核产生的每一个 effect 都在这张表里(门禁守着)。 */
const EFFECT_POLICY = {
  account_sign_in: { mutating: true, approval: "none", source: "kernel" },
  account_sign_out: { mutating: true, approval: "none", source: "kernel" },
  account_status: { mutating: false, approval: "none", source: "kernel" },
  account_switch: { mutating: true, approval: "none", source: "kernel" },
  agent_info_panel: { mutating: false, approval: "none", source: "kernel" },
  appearance_set: { mutating: true, approval: "none", source: "kernel" },
  approval_card: { mutating: false, approval: "none", source: "kernel" },
  approval_rule: { mutating: false, approval: "none", source: "kernel" },
  auto_review_settings: { mutating: true, approval: "none", source: "kernel" },
  bot_create: { mutating: true, approval: "none", source: "kernel" },
  bot_create_from_template: { mutating: true, approval: "none", source: "kernel" },
  bot_delete: { mutating: true, approval: "none", source: "kernel" },
  bot_duplicate: { mutating: true, approval: "none", source: "kernel" },
  bot_pin: { mutating: true, approval: "none", source: "kernel" },
  bot_set_primary: { mutating: true, approval: "none", source: "kernel" },
  bot_templates_list: { mutating: false, approval: "none", source: "kernel" },
  bot_update: { mutating: true, approval: "none", source: "kernel" },
  box_chrome_probe: { mutating: false, approval: "none", source: "kernel" },
  box_clock: { mutating: false, approval: "none", source: "kernel" },
  box_doctor: { mutating: false, approval: "none", source: "kernel" },
  box_env: { mutating: false, approval: "none", source: "kernel" },
  channel_send: { mutating: true, approval: "ask", source: "kernel" },
  check_updates: { mutating: false, approval: "none", source: "kernel" },
  cloud_agent_launch: { mutating: true, approval: "none", source: "kernel" },
  cloud_artifact_deliver: { mutating: false, approval: "none", source: "kernel" },
  code_changes: { mutating: true, approval: "none", source: "kernel" },
  computer_preview: { mutating: false, approval: "none", source: "kernel" },
  computer_use: { mutating: true, approval: "ask", source: "kernel" },
  connectors_probe: { mutating: false, approval: "none", source: "kernel" },
  copy_from_box: { mutating: true, approval: "none", source: "kernel" },
  copy_to_box: { mutating: true, approval: "none", source: "kernel" },
  credential_fill: { mutating: true, approval: "none", source: "kernel" },
  credential_list: { mutating: false, approval: "none", source: "kernel" },
  delete_agent: { mutating: true, approval: "none", source: "kernel" },
  device_permission: { mutating: true, approval: "none", source: "kernel" },
  device_tool: { mutating: false, approval: "none", source: "kernel" },
  device_tools_list: { mutating: false, approval: "none", source: "kernel" },
  export_pack: { mutating: true, approval: "none", source: "kernel" },
  finance_call: { mutating: true, approval: "none", source: "kernel" },
  fs_list: { mutating: false, approval: "none", source: "kernel" },
  fs_read: { mutating: false, approval: "none", source: "kernel" },
  generate_image: { mutating: true, approval: "none", source: "kernel" },
  generate_video: { mutating: true, approval: "none", source: "kernel" },
  group_chat: { mutating: true, approval: "none", source: "kernel" },
  guide_permission: { mutating: true, approval: "none", source: "kernel" },
  handoff_task: { mutating: true, approval: "none", source: "kernel" },
  hide_agent: { mutating: true, approval: "none", source: "kernel" },
  inbound_reaction: { mutating: true, approval: "none", source: "kernel" },
  job_search: { mutating: false, approval: "none", source: "kernel" },
  journal_append: { mutating: true, approval: "none", source: "kernel" },
  journal_query: { mutating: false, approval: "none", source: "kernel" },
  language_set: { mutating: true, approval: "none", source: "kernel" },
  list_agents_sidebar: { mutating: false, approval: "none", source: "kernel" },
  list_skills: { mutating: false, approval: "none", source: "kernel" },
  llm_chat: { mutating: false, approval: "none", source: "kernel" },
  local_execution: { mutating: false, approval: "none", source: "kernel" },
  local_execution_mode: { mutating: false, approval: "none", source: "kernel" },
  machines_list: { mutating: false, approval: "none", source: "kernel" },
  mail_claim_inbox: { mutating: true, approval: "none", source: "kernel" },
  mail_read: { mutating: false, approval: "none", source: "kernel" },
  mail_search: { mutating: false, approval: "none", source: "kernel" },
  mail_send: { mutating: true, approval: "ask", source: "kernel" },
  mcp_call: { mutating: true, approval: "ask", source: "kernel" },
  mcp_discover: { mutating: false, approval: "none", source: "kernel" },
  mcp_get_plugin: { mutating: false, approval: "none", source: "kernel" },
  mcp_list_plugins: { mutating: false, approval: "none", source: "kernel" },
  mcp_namespace: { mutating: false, approval: "none", source: "kernel" },
  mcp_tool_toggle: { mutating: true, approval: "none", source: "kernel" },
  mcp_uninstall: { mutating: true, approval: "none", source: "kernel" },
  members_panel: { mutating: false, approval: "none", source: "kernel" },
  memory_recall: { mutating: false, approval: "none", source: "kernel" },
  memory_update: { mutating: true, approval: "none", source: "kernel" },
  notify_settings: { mutating: true, approval: "none", source: "kernel" },
  oauth: { mutating: true, approval: "none", source: "kernel" },
  package_install: { mutating: true, approval: "none", source: "kernel" },
  purchase: { mutating: true, approval: "ask", source: "kernel" },
  react_message: { mutating: true, approval: "none", source: "kernel" },
  recover_computer: { mutating: true, approval: "none", source: "kernel" },
  render_markdown: { mutating: false, approval: "none", source: "kernel" },
  reset_computer: { mutating: true, approval: "none", source: "kernel" },
  room_turn: { mutating: true, approval: "none", source: "kernel" },
  routine_list: { mutating: false, approval: "none", source: "kernel" },
  routine_pause: { mutating: true, approval: "none", source: "kernel" },
  routine_resume: { mutating: true, approval: "none", source: "kernel" },
  routine_schedule: { mutating: true, approval: "none", source: "kernel" },
  routine_tick: { mutating: true, approval: "none", source: "kernel" },
  schedule_meeting: { mutating: true, approval: "none", source: "kernel" },
  screenshot: { mutating: false, approval: "none", source: "kernel" },
  section_add: { mutating: true, approval: "none", source: "kernel" },
  section_post: { mutating: true, approval: "none", source: "kernel" },
  send_to_agent: { mutating: true, approval: "none", source: "kernel" },
  set_notify: { mutating: true, approval: "none", source: "kernel" },
  settings_open: { mutating: false, approval: "none", source: "kernel" },
  shared_box_fs: { mutating: false, approval: "none", source: "kernel" },
  shared_memory_put: { mutating: true, approval: "none", source: "kernel" },
  shared_memory_read: { mutating: false, approval: "none", source: "kernel" },
  skill_load: { mutating: true, approval: "none", source: "kernel" },
  skill_write: { mutating: true, approval: "none", source: "kernel" },
  slides_pptx: { mutating: true, approval: "none", source: "kernel" },
  source_control: { mutating: true, approval: "none", source: "kernel" },
  structured_chart: { mutating: false, approval: "none", source: "kernel" },
  subagent_run: { mutating: true, approval: "none", source: "kernel" },
  take_over: { mutating: true, approval: "none", source: "kernel" },
  takeover_done: { mutating: true, approval: "none", source: "kernel" },
  teammate_create: { mutating: true, approval: "none", source: "kernel" },
  timezone_set: { mutating: true, approval: "none", source: "kernel" },
  todo_write: { mutating: true, approval: "none", source: "kernel" },
  update_computer: { mutating: true, approval: "none", source: "kernel" },
  update_status: { mutating: true, approval: "none", source: "kernel" },
  voice_end_write: { mutating: true, approval: "none", source: "kernel" },
  voice_relay: { mutating: true, approval: "none", source: "kernel" },
  voice_session: { mutating: false, approval: "none", source: "kernel" },
  watch_video: { mutating: false, approval: "none", source: "kernel" },
  webfetch: { mutating: false, approval: "none", source: "kernel" },
  webhook_copy: { mutating: true, approval: "none", source: "kernel" },
  webhook_panel: { mutating: false, approval: "none", source: "kernel" },
  webhook_tool_read_key: { mutating: false, approval: "none", source: "kernel" },
  webhook_wake: { mutating: true, approval: "none", source: "kernel" },
  workflow_list: { mutating: false, approval: "none", source: "kernel" },
  x_post: { mutating: true, approval: "none", source: "kernel" },
  x_search: { mutating: false, approval: "none", source: "kernel" },
};

/* Host 侧动作的策略。 */
const HOST_ACTION_POLICY = {
  bot_hide: { mutating: true, approval: "none", source: "host" },
  bot_unhide: { mutating: true, approval: "none", source: "host" },
  channel_email: { mutating: false, approval: "none", source: "host" },
  channel_email_claim: { mutating: false, approval: "none", source: "host" },
  computer_shared_session: { mutating: false, approval: "none", source: "host" },
  disable_plugin: { mutating: true, approval: "none", source: "host" },
  install_plugin: { mutating: true, approval: "none", source: "host" },
  llm_list_models: { mutating: false, approval: "none", source: "host" },
  llm_set_model: { mutating: false, approval: "none", source: "host" },
  mail_draft: { mutating: true, approval: "none", source: "host" },
  routine_fire: { mutating: true, approval: "none", source: "host" },
  routine_remove: { mutating: true, approval: "none", source: "host" },
  routine_wake: { mutating: true, approval: "none", source: "host" },
  secret_store: { mutating: true, approval: "none", source: "host" },
  shell: { mutating: true, approval: "ask", source: "host" },
  uninstall_plugin: { mutating: true, approval: "none", source: "host" },
};

/* 排程类单独成组:自决回合连"排个会"都不许。 */
const SCHEDULE_EFFECT_KINDS = new Set([
  "routine_schedule",
  "routine_fire",
  "routine_pause",
  "routine_resume",
  "routine_remove",
  "routine_tick",
  "routine_wake",
]);

/* 自决回合真正需要的只有"把 YES/NO 说出来"。 */
const TEXT_ONLY_EFFECT_KINDS = new Set(["llm_chat"]);

/** 会不会改状态。自决回合只回 YES/NO,没有"做事"的资格。 */
function isMutating(kind) {
  const k = String(kind || "");
  const p = EFFECT_POLICY[k] || HOST_ACTION_POLICY[k];
  return !!(p && p.mutating === true);
}

/** 要不要问人。 */
function needsApproval(kind) {
  const k = String(kind || "");
  const p = EFFECT_POLICY[k] || HOST_ACTION_POLICY[k];
  return !!(p && p.approval === "ask");
}

/** 审批规则的 pattern 词表:默认就是 effect kind 本身(单一词表)。 */
function approvalPatternKind(kind) {
  const k = String(kind || "");
  return EFFECT_POLICY[k] || HOST_ACTION_POLICY[k] ? k : "";
}

/** 会改状态、因此自决回合不许做的全部 kind(从表里派生,不手写)。 */
function mutatingEffectKinds() {
  const out = new Set();
  for (const k of Object.keys(EFFECT_POLICY)) if (EFFECT_POLICY[k].mutating) out.add(k);
  for (const k of Object.keys(HOST_ACTION_POLICY)) if (HOST_ACTION_POLICY[k].mutating) out.add(k);
  return out;
}

/** 要问人的全部 kind(从表里派生)。 */
function askApprovalEffectKinds() {
  const out = new Set();
  for (const k of Object.keys(EFFECT_POLICY)) if (EFFECT_POLICY[k].approval === "ask") out.add(k);
  for (const k of Object.keys(HOST_ACTION_POLICY)) if (HOST_ACTION_POLICY[k].approval === "ask") out.add(k);
  return out;
}

module.exports = {
  EFFECT_POLICY,
  HOST_ACTION_POLICY,
  HOST_ACTION_KINDS,
  SCHEDULE_EFFECT_KINDS,
  TEXT_ONLY_EFFECT_KINDS,
  isMutating,
  needsApproval,
  approvalPatternKind,
  mutatingEffectKinds,
  askApprovalEffectKinds,
};
