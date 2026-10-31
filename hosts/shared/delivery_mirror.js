"use strict";

/**
 * GP-185 — 多端递送镜像的唯一词表与构造器。
 *
 * iOS / Android 壳共用 `hosts/mobile_host`：一个回合结束后，Host 结果里凡是
 * 带落盘产物的 kind，都要在手机上留一份「镜像证据」（`data/device/…-mirrors`），
 * 并把 `*_residual` 这类诚实标记原样带出来 —— 不许把「没真连上」写成「已连上」。
 *
 * 这些 kind 清单和残差键以前在 `mobile_host/run.js` 里手写一份、在
 * `send_to_user_surface.js` 里又手写一份（42 个键，集合相同、顺序不同）。
 * 两份词表的漂移不会让任何单端门禁变红，却会让手机说「已投递」而桌面说
 * 「仍有残差」。所以词表只留在这里，两端都 require 同一份。
 */

/** 可递送的 Host effect kind（有落盘产物、手机侧要留镜像）。 */
const DELIVERY_HOST_KINDS = [
  "channel_send",
  "mail_send",
  "mail_draft",
  "section_add",
  "section_post",
  "credential_fill",
  "purchase",
  "oauth",
  "mcp_call",
  "mcp_discover",
  "voice_relay",
  "voice_session",
  "voice_end_write",
  "credential_list",
  "x_search",
  "x_post",
  "approval_card",
  "connectors_probe",
  "generate_image",
  "generate_video",
  "watch_video",
  "structured_chart",
  "box_doctor",
  "box_env",
  "box_clock",
  "webhook_panel",
  "webhook_copy",
  "webhook_tool_read_key",
  "webhook_wake",
  "settings_open",
  "agent_info_panel",
  "delete_agent",
  "package_install",
  "shared_box_fs",
  "hide_agent",
  "list_agents_sidebar",
  "members_panel",
  "notify_settings",
  "set_notify",
  "update_computer",
  "reset_computer",
  "local_execution",
  "guide_permission",
  "render_markdown",
  "react_message",
  "screenshot",
  "check_updates",
  "auto_review_settings",
  "box_chrome_probe",
  "mcp_namespace",
  "mcp_uninstall",
  "mcp_get_plugin",
  "mcp_list_plugins",
  "teammate_create",
  "schedule_meeting",
  "mail_search",
  "mail_read",
  "finance_call",
  "job_search",
  "workflow_list",
  "slides_pptx",
  "skill_write",
  "export_pack",
  "inbound_reaction",
  "cloud_agent_launch",
  "cloud_artifact_deliver",
  "routine_schedule",
  "routine_list",
  "routine_fire",
  "routine_tick",
  "auto_review_settings",
  "shell",
  "fs_list",
  "fs_read",
  "webfetch",
  "computer_use",
  "shared_memory_put",
  "shared_memory_read",
  "memory_update",
  "memory_recall",
  "code_changes",
  "source_control",
  "machines_list",
  "mail_claim_inbox",
  "device_tools_list",
  "device_tool",
  "delivery",
  "journal_query",
  "skill_load",
  "list_skills",
  "copy_to_box",
  "copy_from_box",
  "subagent_run",
  "room_turn",
  "send_to_agent",
  "routine_pause",
  "routine_resume",
  "journal_append",
];

/**
 * 诚实残差键。**这里是唯一词表**：mobile 的镜像与 SendToUser 的 chip 都读它。
 * 新增残差时只改这一处，两端自动跟上。
 */
const RESIDUAL_KEYS = [
  "live_mail_residual",
  "live_x_residual",
  "live_x_post_residual",
  "live_job_residual",
  "live_finance_residual",
  "live_paid_residual",
  "live_calendar_residual",
  "live_slack_residual",
  "live_teams_residual",
  "live_meeting_residual",
  "live_channel_residual",
  "box_doctor_bin_residual",
  "box_chrome_bin_residual",
  "long_lived_cron_residual",
  "remote_cloud_residual",
  "remote_cloud_artifact_residual",
  "code_apply_residual",
  "git_commit_residual",
  "git_push_residual",
  "screenshot_residual",
  "remote_pr_residual",
  "gh_pr_create_residual",
  "public_fallback_residual",
  "ocr_residual",
  "os_window_automation_residual",
  "interactive_oauth_residual",
  "true_device_os_dialog_residual",
  "credential_browser_fill_residual",
  "inbound_turn_residual",
  "device_capture_residual",
  "device_tool_residual",
  "product_tool_residual",
  "voice_stt_residual",
  "voice_tts_residual",
  "voice_end_match_residual",
  "cross_machine_copy_residual",
  "live_sms_residual",
  "live_webhook_residual",
  "live_voice_residual",
  "live_mail_claim_residual",
  "inbound_push_residual",
  "signin_fill_residual",
];

/** 手机侧优先用的落盘路径（与既有镜像字段顺序一致）。 */
function pickMirrorPath(payload) {
  const p = payload || {};
  return (
    p.artifact_path ||
    p.path ||
    p.media_path ||
    p.frame_path ||
    p.html_path ||
    p.receipt_path ||
    p.pptx_path ||
    p.ics_path ||
    p.eml_path ||
    p.skill_path ||
    p.export_path ||
    p.reply_media_path ||
    null
  );
}

/** 残差键 → 布尔。嵌套字段（outcome / gui / vision_plan）与 mode 兜底都收在这里。 */
function collectResidualFlags(payload) {
  const p = payload || {};
  const oc = p.outcome || {};
  const gui = p.gui || {};
  const vp = gui.vision_plan || {};
  const flags = {};
  for (const k of RESIDUAL_KEYS) flags[k] = p[k] === true;
  // live_paid 以前还看 outcome；ocr / 窗口自动化看嵌套 CU 结果。
  flags.live_paid_residual =
    p.live_paid_residual === true || oc.live_paid_residual === true;
  flags.ocr_residual =
    p.ocr_residual === true ||
    oc.ocr_residual === true ||
    vp.ocr_residual === true;
  flags.os_window_automation_residual =
    p.os_window_automation_residual === true ||
    oc.os_window_automation_residual === true ||
    gui.os_window_automation_residual === true;
  // PR 创建失败有时只落在 mode 字符串里，payload 布尔没置。
  flags.gh_pr_create_residual =
    p.gh_pr_create_residual === true ||
    String((p.remote_pr && p.remote_pr.mode) || p.mode || "").includes(
      "gh_pr_create_residual",
    );
  return flags;
}

/**
 * 构造手机侧镜像。字段顺序与既有落盘文件保持一致（人读 diff 时不至于满屏乱）。
 * @param {{kind:string, machineKind:string, payload:object, hostOk?:boolean,
 *          hostPath?:string, at?:string}} o
 */
function buildDeliveryMirror(o) {
  const kind = o.kind;
  const p = o.payload || {};
  const flags = collectResidualFlags(p);
  return {
    kind: kind + "_mobile_mirror",
    machine_kind: o.machineKind,
    host_kind: kind,
    host_path: o.hostPath,
    media_path: p.media_path || null,
    frame_path: p.frame_path || null,
    html_path: p.html_path || null,
    eml_path: p.eml_path || null,
    mode: p.mode || null,
    pretend_live: p.pretend_live === true,
    pretend_sent: p.pretend_sent === true,
    pretend_connected: p.pretend_connected === true,
    live_mail_residual: flags.live_mail_residual,
    live_mail_claim_residual: flags.live_mail_claim_residual,
    live_channel_residual: flags.live_channel_residual,
    widget_degraded: p.widget_degraded === true,
    inbound_push_residual: flags.inbound_push_residual,
    live_slack_residual: flags.live_slack_residual,
    live_teams_residual: flags.live_teams_residual,
    live_meeting_residual: flags.live_meeting_residual,
    live_sms_residual: flags.live_sms_residual,
    live_webhook_residual: flags.live_webhook_residual,
    live_voice_residual: flags.live_voice_residual,
    live_x_residual: flags.live_x_residual,
    live_x_post_residual: flags.live_x_post_residual,
    live_job_residual: flags.live_job_residual,
    live_finance_residual: flags.live_finance_residual,
    live_calendar_residual: flags.live_calendar_residual,
    voice_stt_residual: flags.voice_stt_residual,
    voice_tts_residual: flags.voice_tts_residual,
    voice_end_match_residual: flags.voice_end_match_residual,
    inbound_turn_residual: flags.inbound_turn_residual,
    credential_browser_fill_residual: flags.credential_browser_fill_residual,
    signin_fill_residual: flags.signin_fill_residual,
    cross_machine_copy_residual: flags.cross_machine_copy_residual,
    device_capture_residual: flags.device_capture_residual,
    device_tool_residual: flags.device_tool_residual,
    product_tool_residual: flags.product_tool_residual,
    live_paid_residual: flags.live_paid_residual,
    box_doctor_bin_residual: flags.box_doctor_bin_residual,
    box_chrome_bin_residual: flags.box_chrome_bin_residual,
    long_lived_cron_residual: flags.long_lived_cron_residual,
    remote_cloud_residual: flags.remote_cloud_residual,
    remote_cloud_artifact_residual: flags.remote_cloud_artifact_residual,
    code_apply_residual: flags.code_apply_residual,
    git_commit_residual: flags.git_commit_residual,
    git_push_residual: flags.git_push_residual,
    screenshot_residual: flags.screenshot_residual,
    remote_pr_residual: flags.remote_pr_residual,
    public_fallback_residual: flags.public_fallback_residual,
    interactive_oauth_residual: flags.interactive_oauth_residual,
    true_device_os_dialog_residual: flags.true_device_os_dialog_residual,
    gh_pr_create_residual: flags.gh_pr_create_residual,
    ocr_residual: flags.ocr_residual,
    os_window_automation_residual: flags.os_window_automation_residual,
    host_ok: o.hostOk !== false,
    at: o.at || new Date().toISOString(),
    note: "Mobile Host mirrors Desktop Host delivery snap path — no invent",
  };
}

module.exports = {
  DELIVERY_HOST_KINDS,
  RESIDUAL_KEYS,
  collectResidualFlags,
  pickMirrorPath,
  buildDeliveryMirror,
};
