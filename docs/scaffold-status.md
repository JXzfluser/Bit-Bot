# Scaffold / M1 status — 2026-10-17 Asia/Shanghai

> **这是历史快照，不是当前状态。** 本文记录 2026-10-17 的脚手架搭建过程，
> 其中的数字（例如 `moon test` 168 passed）早已过时，**不要**当成现状引用。
> 当前状态看：
> - 能力矩阵与证据：`docs/capability-matrix.md`（由 `scripts/prove_capability_matrix.mjs` 机检）
> - 模块边界与依赖图：`docs/02-module-map.md`
> - 内核/Host 边界：`docs/adr/0002-wasm-host-boundary.md`
> - 契约层能力（已实现但未接入生产路径）：`docs/qa/contract-layer.md`
>
> 本文中"待办/未做"的条目若已完成，以代码与上述文档为准。

## Build smoke (≠ PASS)
- `moon check` ✅ · `moon test` **168** passed
- **PASS 仅 Bit验证**；矩阵只标 `in_progress`（CONTRACT.md）

## Ownership
- security 文件名锁：`types.mbt` + `approval.mbt` + `parse.mbt`（禁 fence/fence_types）
- 勿动：core / stores / ui_protocol / security 文件名
- runtime / tools / box_host / channels / agents* / routines / memory 验收测 — MoonBit核
- 顶层 `cloud/` 仅 DEPRECATED → `agents/cloud`

## 验收级测名 → CM（供 Bit验证 FAIL→PASS）

| 测名 | CM |
|------|-----|
| `acceptance_CM-0102_user_ack_hidden_agent_no_ack` | CM-0102 |
| `acceptance_CM-0103_two_milestones_then_final` | CM-0103 |
| `acceptance_CM-0104_end_turn_stops_user_delivery` | CM-0104 |
| `acceptance_CM-0105_CM-0106_widget_attachment_same_envelope_rejected` | CM-0105/0106 |
| `acceptance_CM-0106_attachment_path_rejected` | CM-0106 |
| `acceptance_CM-0111_bare_url_fails_linked_ok` | CM-0111 |
| `acceptance_CM-0304_recall_prefix_and_limit` | CM-0304 |
| `acceptance_CM-0305_update_upsert` | CM-0305 |
| `acceptance_CM-0306_memory_never_grants_send` | CM-0306 |
| `acceptance_CM-1501_irreversible_escalates` | CM-1501 |
| `acceptance_CM-1504_fence_instructional_false` | CM-1504 |
| `acceptance_cm0601_shell_box_and_machine` | CM-0601 |
| `acceptance_cm0602_read_line_numbered` | CM-0602 |
| `acceptance_cm0603_fs_persists` | CM-0603 |
| `acceptance_cm0604_await_no_kill_fire_and_forget` | CM-0604 |
| `acceptance_cm0605_screenshot_read_only` | CM-0605 |
| `acceptance_cm0606_shared_fs_distinct_desktops` | CM-0606 |
| `acceptance_cm0401_create_get_update` | CM-0401 |
| `acceptance_cm0402_validate_cron` | CM-0402 |
| `acceptance_cm0413_pause_resume` | CM-0413 |

## 实现备注
- deliver/milestone 已接 `@ui_protocol.ensure_markdown_links`（CM-0111）
- box_host：`read_only` 字段（非保留字 `readonly`）；`$file:` 用 `"$" + "file:"` 拼接
- tools/dynamic：GetDynamicTools/CallDynamicTool 描述+假调用

## CM-09xx / CM-12xx (MoonBit核 · 2026-10-17)
| 测名 | CM |
|------|-----|
| `acceptance_CM-0901_discover_then_full_description` | CM-0901 |
| `acceptance_cm0901_discover_before_call` | CM-0901 |
| `acceptance_cm0902_call_write_and_file_placeholder` | CM-0902 |
| `acceptance_CM-0903_0905_namespace_status_blocks_unusable` | CM-0903/0905 |
| `acceptance_CM-1201_executor_dispatch_no_user_send` | CM-1201 |
| `acceptance_CM-1206_check_status` | CM-1206 |
| `acceptance_CM-1207_stop_no_side_effects` | CM-1207 |
| `acceptance_CM-1208_wake_parent_with_summary` | CM-1208 |

Smoke: see latest `moon test` count. CM-1501/1504 由 Bitbot 执行器加严（draft/effect_planner）。

## CM-10xx mail + CM-0403–0405 (MoonBit核)
| 测名 | CM |
|------|-----|
| `acceptance_CM-1001_list_inboxes_empty_then_claimed` | CM-1001 |
| `acceptance_CM-1002_check_availability` | CM-1002 |
| `acceptance_CM-1003_claim_requires_user_selection` | CM-1003 |
| `acceptance_CM-1004_search_and_read_thread` | CM-1004 |
| `acceptance_CM-1005_draft_card_send_only_on_press` | CM-1005 |
| `acceptance_CM-0403_flexible_phase_and_no_blind_step` | CM-0403 |
| `acceptance_CM-0404_loose_daily_weekdays_daytime` | CM-0404 |
| `acceptance_CM-0405_min_interval_5_minutes` | CM-0405 |

7 条 FAIL（0105/0106/0111/0305/0306/1501/1504）已由 ui_protocol/security 验收测覆盖；本侧不重复改文件名。

## Bit验证 FAIL 补丁 + 下一批 (MoonBit核)
| 测名 | CM |
|------|-----|
| `acceptance_CM-0402_iana_timezone_and_CRON_TZ_override` | CM-0402 |
| `acceptance_CM-0602_image_read_inline_visible` | CM-0602 |
| `acceptance_CM-0605_screenshot_frame_evidence` | CM-0605 |
| `acceptance_CM-1006_send_on_behalf_pick_account` | CM-1006 |
| `acceptance_CM-0801_0803_computer_use_boundary` | CM-0801/0803 |
| `acceptance_CM-1701_web_search` | CM-1701 |
| `acceptance_CM-1702_web_fetch` | CM-1702 |

Smoke: moon test **96** passed（≠ PASS）.

## Bit验证 P0 FAIL 补丁 (PASS=32 后)
| 测名 | CM |
|------|-----|
| `acceptance_CM-0404_explicit_exception_required` | CM-0404 |
| `acceptance_CM-0404_loose_daily_weekdays_daytime` | CM-0404 |
| `acceptance_CM-0902_schema_required_and_write_to_file` | CM-0902 |
| `acceptance_CM-1004_thread_attachment_openable` | CM-1004 |
| `acceptance_CM-0404_exception_requires_explicit` | CM-0404 |
| `acceptance_CM-0902_schema_positive_and_write_to_file` | CM-0902 |

## P0 FAIL 补齐 PASS=32 (MoonBit核 · 2026-10-17 11:40 Asia/Shanghai)
| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0404_explicit_exception_required` | CM-0404 | 周末/通宵无 `explicit_exception=true` → Err；有则 Ok |
| `acceptance_CM-0404_exception_requires_explicit` | CM-0404 | `plan_loose_daily_with_exception` 同契约 |
| `acceptance_CM-0902_schema_required_and_write_to_file` | CM-0902 | 缺 required → Err；齐备 → Ok；`write_to_file` → `/workspace/agent-tools/` |
| `acceptance_CM-1004_thread_attachment_openable` | CM-1004 | mock 附件 path；`/workspace` → openable=true；院外 path → Err |

Smoke: `moon check` ✅ · `moon test` **112** passed / 0 failed.
CM-0605 Host I 边界仍等 Bit验证；CM-0904 P1 稍后。

## C批 P0 FAIL 补丁 (MoonBit核 · 2026-10-17 11:45 Asia/Shanghai)

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0801_named_bypass_rejected` | CM-0801 | Shell+xdotool/Playwright/CDP → Err；ViaComputerUse → Ok |
| `acceptance_CM-0803_signin_secret_no_plaintext` | CM-0803 | SecretRequest/UserForm Ok；transcript 无明文密码；ChatPlain 拒 |
| `acceptance_CM-1701_summary_url_current_year` | CM-1701 | hits 非空 snippet + https url；`latest AI` → 注入 2026 |
| `acceptance_CM-1702_auth_page_fails_clearly` | CM-1702 | example.com Ok；`/login` → Err 含 401/login/auth/认证 |

矩阵 CM-0801/0803/1701/1702 仍标 **in_progress**（勿改 PASS）。
Smoke: `moon check` ✅ · `moon test` **112** passed / 0 failed.

## D批 P0 acceptance (MoonBit核 · 2026-10-17 11:48 Asia/Shanghai)

矩阵 CM-1101/1102/1104/1106/1301/1302/1304/1502/1503 仍标 **in_progress**（勿改 PASS/done）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-1101_omit_channel_stays_in_chat` | CM-1101 | omit channel_hint → Chat-only；`is_external_hint(None)=false` |
| `acceptance_CM-1102_slack_thread_dm_toplevel` | CM-1102 | `C:ts`→Thread；`U`/`D`→Dm；bare `C`→TopLevel |
| `acceptance_CM-1104_channel_degrades_no_bare_widget` | CM-1104 | external `deliver_for_channel` Widget→Text/link；chat 可留 Widget |
| `acceptance_CM-1106_secret_request_no_plaintext` | CM-1106 | vault handle only；transcript 无明文；paste token 拒 |
| `acceptance_CM-1301_1302_cloud_agent_lifecycle` | CM-1301/1302 | launch→bcId+`https://cursor.com/agents/<id>`；Succeeded≠Failed |
| `acceptance_CM-1304_pr_comment_and_diff_mock` | CM-1304 | `MockGithub::create_pr_comment` + `read_pr_diff` |
| `acceptance_CM-1502_autoreview_blocks_high_risk` | CM-1502 | Destructive/irreversible Shell|CloudAgent → Deny+high-risk reason |
| `acceptance_CM-1503_smart_mode_same_action_only` | CM-1503 | same fingerprint Allow；rewrite/base64 bypass Deny |

Smoke: `moon check` ✅ · `moon test` **112** passed / 0 failed.

## Bit验证 P0 FAIL 验收名 (Bit Bot 执行器 · 2026-10-17 11:48 Asia/Shanghai)

与 MoonBit核 D批并行：保留其测名；**另补 Bit验证合同要求的精确测名**（同包可并存）。协调：复用 `slack_semantics` / `degrade` / `lifecycle` / `github_mock`；删除冲突的重复类型文件；扩展 `create_comment`/`read_diff`、`parse_slack_address`、`plan_channel_reply`、`reject_naked_widget_on_channel`、`AutoReviewGate`、`SecretRequestCard`、`smart_mode_retry`（禁 `resume`/`readonly`/`fence.mbt`）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-1101_omit_channel_not_external` | CM-1101 | omit channel → InAppOnly；`require_external_channel(None)`→Err |
| `acceptance_CM-1102_slack_address_thread_dm_top` | CM-1102 | `parse_slack_address`: C:ts→Thread；U/D→Dm；bare C→TopLevel |
| `acceptance_CM-1104_channel_degrades_widget` | CM-1104 | `deliver_for_channel` Widget→Text；naked widget on channel → Err |
| `acceptance_CM-1106_secret_no_plaintext_to_assistant` | CM-1106 | vault 提交后 assistant view 无明文；paste-token 拒 |
| `acceptance_CM-1301_1302_cloud_start_status` | CM-1301/1302 | launch→bc_id+url；`is_completed` vs `is_failed` 可区分 |
| `acceptance_CM-1304_github_comment_and_diff` | CM-1304 | `MockGithub::create_comment` + `read_diff` |
| `acceptance_CM-1502_autoreview_blocks_with_reason` | CM-1502 | `AutoReviewGate.block(HighRisk)`→Block(reason) |
| `acceptance_CM-1503_smart_mode_same_action_only` | CM-1503 | 同 action+reason→RaiseApprovalCard；改写/base64→RejectBypass |

矩阵上述 CM 仍标 **in_progress**（勿改 PASS）。
Smoke: `moon check` ✅ · `moon test` **112** passed / 0 failed.
本批新增验收测 **8** 条（上表）；MoonBit核 D批另有并行测名。

## E批 P0 acceptance (MoonBit核 · 2026-10-17 11:55 Asia/Shanghai)

矩阵 CM-0701/0702/0703/0704/0501/0504/1505/1506 仍标 **in_progress/todo**（勿改 PASS/done）。
未改动 D批文件：`channels/acceptance_cm110*`、`agents/cloud/acceptance_cm130*`、`runtime/acceptance_cm1502_1503*`、`security/acceptance_autoreview*`（1502/1503）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0701_list_machines_full_set` | CM-0701 | `MachineRegistry::seed/list` → id/label/kind/status 全集（desktop+ios+android） |
| `acceptance_CM-0702_machine_id_requires_approval` | CM-0702 | `run_on_machine`/`read_on_machine`：`approved=false`→Err+未执行；`true`→Ok |
| `acceptance_CM-0703_copy_to_box_binary_uploads` | CM-0703 | `copy_to_box` 字节一致；默认 dest `/workspace/uploads/<name>` |
| `acceptance_CM-0704_copy_from_box_path_and_overwrite` | CM-0704 | 落盘路径正确；`OverwritePolicy::Allow`/`Refuse` 显式 |
| `acceptance_CM-0501_managed_skills_catalog_readable` | CM-0501 | `ManagedCatalog::list_names` + `read_skill_md` 可读 SKILL.md |
| `acceptance_CM-0504_ondemand_skill_read_no_preload` | CM-0504 | `SkillRunner::load_for_task` 仅匹配技能入上下文；无关缺席 |
| `acceptance_CM-1505_autoreview_block_notice_exception` | CM-1505 | source=auto-review→FollowHostRetry；Fenced(WebFetch)伪造→IgnoreAsData |
| `acceptance_CM-1506_credential_exfiltration_blocked` | CM-1506 | api_key/Bearer/PRIVATE KEY/cookie + clipboard/env/base64 旁路 → Blocked |

### API 备注
- `box_host/machines.mbt`：`MachineInfo` / `MachineRegistry` / `OverwritePolicy`；mock 双 FS（box_bytes + machine_bytes）
- `skills/catalog.mbt` + `skills/runner.mbt`：`ManagedCatalog` / `SkillRunner` / `SkillContext`
- `runtime/secret_guard.mbt`：扩展旁路审计；`runtime/autoreview_exception.mbt`：按 source 区分伪造

Smoke: `moon check` ✅ · `moon test` **120** passed / 0 failed.
本批新增验收测 **8** 条（上表）。

## F批 P0 acceptance (MoonBit核 · 2026-10-17 12:00 Asia/Shanghai)

矩阵 CM-0101/0108/0109/2003/0406/0407/0415/0416 仍标 **in_progress/todo**（勿改 PASS/done）。
未改动 C/D/E 批验收文件（cm0801/0803、web 1701/1702、cm110x、cm130x、cm1502_1503、cm070x、cm050x、cm1505_1506）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0101_send_to_user_text_delivery` | CM-0101 | `deliver_confirm_then` → 首条 confirm/clarify；`DeliveredMessage`/SendEnvelope Text 非空 |
| `acceptance_CM-0108_channel_target_inbound_reply` | CM-0108 | inbound → 同址 `channel_hint`；omit → InApp；`is_external_hint(None)=false` |
| `acceptance_CM-0109_thread_reply_stays_in_thread` | CM-0109 | `slack:C:ts` 解析；`deliver_text_to_inbound` 同线程 hint |
| `acceptance_CM-2003_hidden_inbound_cue_not_spoken` | CM-2003 | `strip_cue`/`open_turn_stripping_cue`；Hidden → `should_user_ack=false`；可见文本无 cue |
| `acceptance_CM-0406_slack_event_trigger_shape` | CM-0406 | mention/keyword/message/reaction + C/#@* 形状；未 invite 提示含 `/invite` |
| `acceptance_CM-0407_github_event_trigger_pr_babysit` | CM-0407 | `pr_babysit_default_package`；Merged/Closed → `handle_pr_terminal` 自删 |
| `acceptance_CM-0415_routine_create_confirm_card_no_retry_on_deny` | CM-0415 | Deny → tool result denied；同 fingerprint 禁止 rewrite-retry |
| `acceptance_CM-0416_delivery_destination_line` | CM-0416 | `parse_destination_line`；`plan_batch_delivery` 拒 fan-out/broadcast |

### API 备注
- `runtime/deliver.mbt`：`DeliveredMessage` / `first_delivered` / `deliver_confirm_then` / `is_confirm_or_clarify`
- `runtime/cue.mbt`：`strip_cue` / `has_hidden_cue` / `open_turn_stripping_cue`
- `runtime/channel_reply.mbt`：`reply_to_channel_target`（复用 `is_external_hint` / `plan_channel_reply` / `deliver_text_to_inbound`）
- `routines/events.mbt`：`SlackListenerShape` / `prepare_slack_listener` / `pr_babysit_default_package` / `handle_pr_terminal`
- `routines/confirm.mbt`：`ConfirmCardGate` / `create_with_confirm` / `RoutineWriteToolResult`
- `routines/destination.mbt`：`DestinationLine` / `parse_destination_line` / `plan_batch_delivery`

Smoke: `moon check` ✅ · `moon test` **128** passed / 0 failed.
本批新增验收测 **8** 条（上表）。

## G批 P0 acceptance (MoonBit核 · 2026-10-17 12:05 Asia/Shanghai)

矩阵 CM-0201/0203/0301/0804/1202/0906/1604/0908 仍标 **in_progress/todo**（勿改 PASS/done）。
未改动 C/D/E/F 批验收文件。CM-0903 已 PASS — 本批不重复验收。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0201_update_agent_profile_reflects` | CM-0201 | UpdateAgentProfile name/title/description；sidebar + info panel 即时反映 |
| `acceptance_CM-0203_sidebar_visibility_delete_confirm` | CM-0203 | 新建助手入侧边栏；删除需 confirm 且清 transcript |
| `acceptance_CM-0301_profile_update_recall_across_sessions` | CM-0301 | Update profile；新 session Recall 仍可见 |
| `acceptance_CM-0804_user_form_snapshot_no_blind_retry` | CM-0804 | RequestUserForm targets 来自 snapshot；失败不盲重试同表 fingerprint |
| `acceptance_CM-1202_computer_use_task_outcome_only` | CM-1202 | Task computerUse 只返回 wrap 的 ComputerUseOutcome |
| `acceptance_CM-0906_gmail_mcp_draft_search_read` | CM-0906 | Gmail MCP：draft + search + read thread |
| `acceptance_CM-1604_email_attachment_upload_path_contract` | CM-1604 | ReadEmailAttachment/UploadFile 大文件不截断；路径须 `/workspace` |
| `acceptance_CM-0908_github_mcp_pr_list_get_comment` | CM-0908 | cursor-github MCP：list/get PR + comments mock |

### API 备注
- `ui_protocol/profile.mbt`：`AgentProfile` / `SidebarModel` / `InfoPanelSnapshot`；`update_agent_profile` / `request_delete`+`confirm_delete`
- `ui_protocol/user_form.mbt`：`UserFormSnapshot` / `UserFormGate`；failed fingerprint 禁 blind-retry
- `memory/profile_session.mbt`：`ProfileMemoryStore` + `SessionId`；跨 session profile 持久
- `agents/computer_use/task_outcome.mbt`：`TaskComputerUseReport` / `run_computer_use_task` → wrap `ComputerUseOutcome`
- `connectors/mail/gmail_mcp.mbt`：`GmailMcpSurface` create_draft/search_threads/read_thread
- `connectors/mail/attachment_upload.mbt`：`AttachmentStore` read_email_attachment/upload_file；content_len==size_bytes
- `agents/cloud/github_mcp.mbt`：`GithubMcpSurface` list/get PR + create/list comments（复用 MockGithub）

Smoke: `moon check` ✅ · `moon test` **136** passed / 0 failed.
本批新增验收测 **8** 条（上表）。

## H批 P0 acceptance (MoonBit核 · 2026-10-17 12:10 Asia/Shanghai)

矩阵 CM-2001/2007/2008/1605/1802/2127/2130/2112 仍标 **in_progress/todo**（勿改 PASS/done）。
未改动 G/C/D/E/F 批验收文件。CM-1201 已 PASS — 本批不重复验收。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2001_user_timezone_report` | CM-2001 | `display_instant`/`report_time`：Z 先转换再展示；带 Asia/Shanghai 短标签；不鹦鹉 Z |
| `acceptance_CM-2007_automation_status_uses_latest_timestamp` | CM-2007 | `AutomationStatusTracker` reminder 相位用最新 timestamp |
| `acceptance_CM-2008_identity_product_name_only` | CM-2008 | `identity_reply` 只答产品名 "Bit Bot"；拒 provider/模型名 |
| `acceptance_CM-1605_inline_image_understandable` | CM-1605 | `read_image` → ImageContent visible+description；截图/用户图可描述 |
| `acceptance_CM-1802_purchases_require_explicit_user` | CM-1802 | `PurchaseGate`：无明示不付款；支付需 user_present；凭证不进 transcript |
| `acceptance_CM-2127_inbound_mail_no_auto_reply` | CM-2127 | `InboundMailHandler::handle_wake` 只摘要/草稿；不自动回原发件人 |
| `acceptance_CM-2130_list_credentials_no_secret_plaintext` | CM-2130 | `CredentialStore::list_credentials` 仅元数据；无 secret 明文 |
| `acceptance_CM-2112_offensive_cyber_short_refuse` | CM-2112 | `evaluate_policy` offensive_cyber 短拒；无步骤/无 PoC |

### API 备注
- `core/time.mbt`：`display_instant` / `Instant::display_in`（UTC+8 本地形 + `[converted from UTC]`）
- `runtime/timezone_report.mbt`：`report_time` / `user_timezone` / `is_parroted_z`
- `runtime/automation_status.mbt`：`AutomationStatusTracker` / `reminder_text` / `latest_timestamp`
- `runtime/identity.mbt`：`product_name` / `identity_reply` / `refuses_provider_name`
- `box_host/host_abi.mbt`：`ImageContent.description` + `is_describable`
- `connectors/commerce/purchases.mbt`：`PurchaseGate` / `PurchaseOutcome`
- `connectors/mail/inbound_wake.mbt`：`InboundMailHandler::handle_wake`
- `security/policy.mbt`：`evaluate_policy` / `is_short_refuse_no_poc`
- `security/credentials.mbt`：`CredentialStore::list_credentials` / `list_credentials_json`

Smoke: `moon check` ✅ · `moon test` **144** passed / 0 failed.
本批新增验收测 **8** 条（上表）。

## I批 P0 acceptance (MoonBit核 · 2026-10-17 12:15 Asia/Shanghai)

矩阵 CM-2113/2114/2115/2121/2122/2123/2124/2126 仍标 **in_progress/todo**（勿改 PASS/done）。
未改动 H批验收文件（acceptance_cm2001*、cm1605*、cm1802*、cm2127*、cm2112_2130*）。仅扩展 `security/policy.mbt`（保留 CM-2112 绿）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2113_child_sex_illegal_stop` | CM-2113 | `[policy:child_sex]` → Refuse 含 "illegal"；`is_terminal_stop` |
| `acceptance_CM-2114_weapons_dual_use_bio_refuse` | CM-2114 | weaponization / dual_use_bio → 短拒 |
| `acceptance_CM-2115_crime_assistance_short_refuse` | CM-2115 | `[policy:crime_help]` → 短拒 |
| `acceptance_CM-2121_offensive_cyber_refuse_no_detail` | CM-2121 | `[policy:exploit_poc]` → 短拒；无步骤/PoC |
| `acceptance_CM-2122_child_sex_refuse_illegal_stop` | CM-2122 | child_sex category id → illegal + stop |
| `acceptance_CM-2123_weapons_bio_refuse` | CM-2123 | weaponization/pathogen-enhancement → 拒 |
| `acceptance_CM-2124_crime_help_refuse` | CM-2124 | crime-help → 拒 |
| `acceptance_CM-2126_self_harm_care_988_no_methods` | CM-2126 | self_harm → care + "988"；无 method/how-to |

### API 备注
- `security/policy.mbt`：`PolicyCategory` 扩展 ChildSex | WeaponsDualUseBio | CrimeAssistance | SelfHarm | OffensiveCyber | Allowed | OtherDisallowed
- `evaluate_policy`：标签 `[policy:…]` + 安全 category-id 关键词；ChildSex 优先
- `PolicyVerdict::is_terminal_stop`：ChildSex 为 true
- `PolicyVerdict::category`：返回类别
- `is_short_refuse_no_poc`：适用于短拒类别（非 SelfHarm care）
- 新文件：`security/acceptance_cm2113_2126_test.mbt`（8 条）
- 夹具仅用抽象标签，无 graphic/PoC/methods 内容

Smoke: `moon check` ✅ · `moon test` **152** passed / 0 failed.
本批新增验收测 **8** 条（上表）。

## J批 P0 acceptance (MoonBit核 · 2026-10-17 12:20 Asia/Shanghai)

矩阵 CM-2129/2133/2134/2137/2138/2139/2140/2143 仍标 **in_progress/todo**（勿改 PASS/done）。
未改动 I批 / policy：`security/policy.mbt`、`security/acceptance_cm2113_2126_test.mbt`（逻辑未触；仅可能被 `moon fmt` 空白）。H批 CM-2112/2130 保持绿。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2129_credential_request_fill_no_plaintext` | CM-2129 | ListCredentials 命中 → `fill_credential_request` 成功；assistant_view 无明文 |
| `acceptance_CM-2133_no_busy_loop_check_subagent` | CM-2133 | `ParentWaitSession` completion-wake / yield；二次 Check 拒 busy-loop |
| `acceptance_CM-2134_needs_grant_refuse_then_grant_flow` | CM-2134 | NeedsGrant Call → refuse+grant card；`user_grants` → Ready 再 Call |
| `acceptance_CM-2137_inbound_attachment_ref_readable` | CM-2137 | `collect_inbound_attachments` → AttachmentRef 可读；缺文件拒 |
| `acceptance_CM-2138_multi_effect_batch_ge2` | CM-2138 | `plan_multi_delivery_step_ge2` → Effect[] ≥ 2 Deliver |
| `acceptance_CM-2139_reversible_autonomy_no_ask` | CM-2139 | 可逆整理 + delegated scope → `ProceedNoAsk` |
| `acceptance_CM-2140_no_fabricated_facts_admit_gap` | CM-2140 | 缺数据 → admit gap + real_path；拒 fabricated markers |
| `acceptance_CM-2143_refused_send_no_channel_bypass` | CM-2143 | Refused/Expired + 无新授权 → 拒换通道重试 |

### API 备注
- `security/credentials.mbt`：`CredentialFillResult` / `CredentialStore::fill_credential_request` / `fill_leaks_secret_to_assistant`
- `agents/task/handle.mbt`：`ParentWaitMode` / `ParentWaitSession`（plan_wait / check_once / await_completion_wake）
- `tools/namespace_status.mbt`：`GrantSession` / `GrantFlowStep`（call / user_grants / current_step）
- `ui_protocol/attachment.mbt`：`InboundAttachmentBag` / `collect_inbound_attachments` / `all_readable`
- `runtime/step_effects.mbt`：`StepEffectBatch` / `plan_multi_delivery_step(_ge2)`
- `runtime/autonomy.mbt`：`AutonomyAction` / `decide_autonomy` / `ProceedNoAsk`
- `runtime/honesty.mbt`：`answer_missing_data` / `reject_fabricated_answer`
- `security/approval.mbt`：`SendTerminalState` / `retry_send_via_channel` / `ApprovalDecision::to_send_terminal`
- 新验收文件：`security/acceptance_cm2129_2143_test.mbt`、`agents/task/acceptance_cm2133_test.mbt`、`tools/acceptance_cm2134_test.mbt`、`ui_protocol/acceptance_cm2137_test.mbt`、`runtime/acceptance_cm2138_2140_test.mbt`

Smoke: `moon check` ✅ · `moon test` **160** passed / 0 failed.
本批新增验收测 **8** 条（上表）。

## K批 P0 acceptance (MoonBit核 · 2026-10-17 12:17 Asia/Shanghai)

矩阵 CM-2142/2147/2152/2154/2159/2162/2169/2170 仍标 **in_progress/todo**（勿改 PASS/done）。
未改动 J批验收文件：`security/acceptance_cm2129_2143_test.mbt`、`agents/task/acceptance_cm2133_test.mbt`、`tools/acceptance_cm2134_test.mbt`、`ui_protocol/acceptance_cm2137_test.mbt`、`runtime/acceptance_cm2138_2140_test.mbt`。未改动 I批 / policy：`security/policy.mbt`、`security/acceptance_cm2113_2126_test.mbt`。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2142_draft_card_send_verbatim_once` | CM-2142 | 卡已展示 → 用户发送 → 冻结草稿原样发一次；禁 agent 改字 |
| `acceptance_CM-2147_no_homemade_connect_url` | CM-2147 | NeedsAuth→Authenticate；NeedsGrant→Install；自造 URL 拒 |
| `acceptance_CM-2152_first_turn_with_description_start` | CM-2152 | description 非空 → 短宣告开工；空 → getting-started |
| `acceptance_CM-2154_inbound_agent_not_user_question` | CM-2154 | `[agent]` / InboundKind::Agent → DivertAgent；不当作用户提问 |
| `acceptance_CM-2159_working_directory_param_effective` | CM-2159 | `ShellRequest.working_directory` → `ShellResult.cwd` / job_cwd 生效 |
| `acceptance_CM-2162_child_approval_bubbles_to_parent` | CM-2162 | 子 NeedApproval → `ParentApprovalView` 可见 ApprovalCard |
| `acceptance_CM-2169_agent_inbox_no_unauthorized_send` | CM-2169 | 执行者 Agent Inbox 禁发；只 `ReportDraftToParent` |
| `acceptance_CM-2170_safer_path_not_bypass_rewrite` | CM-2170 | 降权正当路径 ≠ base64/改写骗过 Auto-review |

### API 备注
- `connectors/mail/verbatim_send.mbt`：`VerbatimSendSession` / `FrozenDraft` / `user_says_send` / `agent_try_edit`
- `tools/connect_guide.mbt`：`guide_connect` / `OfficialConnectCard` / `is_homemade_connect_url`
- `runtime/onboarding.mbt`：`plan_first_turn` / `FirstTurnPlan` / `should_start_work_immediately`
- `runtime/inbound_agent.mbt`：`handle_inbound` / `DivertAgent` / `has_agent_cue` / `open_turn_from_inbound`
- `box_host/host_abi.mbt`：`ShellResult.cwd` / `ShellRequest::effective_cwd` / `HostAbi::job_cwd`
- `security/approval_bubble.mbt`：`ApprovalCard` / `NeedApprovalReport` / `ParentApprovalView` / `bubble_need_approval_to_parent`
- `agents/task/handle.mbt`：`SubagentHandle::report_need_approval`（Blocked + wake_parent）
- `security/agent_inbox.mbt`：`AgentInboxGuard::executor` / `try_send` → `ReportDraftToParent`
- `security/safer_path.mbt`：`classify_adaptation` / `AdaptationKind` / `is_legitimate_safer_path`
- 新验收文件：`connectors/mail/acceptance_cm2142_test.mbt`、`tools/acceptance_cm2147_test.mbt`、`runtime/acceptance_cm2152_2154_test.mbt`、`box_host/acceptance_cm2159_test.mbt`、`security/acceptance_cm2162_2169_2170_test.mbt`

Smoke: `moon check` ✅ · `moon test` **168** passed / 0 failed.
本批新增验收测 **8** 条（上表）。

## L批 P0 acceptance (MoonBit核 · 2026-10-17 12:30 Asia/Shanghai)

矩阵 CM-0806/1903/1905/2002/2160/2171/2176/2177 仍标 **in_progress/todo**（勿改 PASS/done）。
GAP 1901/1902/1907 不在本批（architecture）。
未改动 K批文件：`connectors/mail/verbatim_send.mbt`、`connectors/mail/acceptance_cm2142_test.mbt`、`tools/connect_guide.mbt`、`tools/acceptance_cm2147_test.mbt`、`runtime/onboarding.mbt`、`runtime/inbound_agent.mbt`、`runtime/acceptance_cm2152_2154_test.mbt`、`box_host/acceptance_cm2159_test.mbt`、`security/approval_bubble.mbt`、`security/agent_inbox.mbt`、`security/safer_path.mbt`、`security/acceptance_cm2162_2169_2170_test.mbt`（`host_abi.mbt` / `machines.mbt` 仅增长 Host mocks，CM-2159 保持绿）。
未改动 I/policy 与 J 验收文件。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0806_login_persist_after_update` | CM-0806 | Update Computer 后 session jar 仍在；software 需重装 |
| `acceptance_CM-1903_update_computer_two_step_prefer_guide` | CM-1903 | 两步确认；guide Update 优先于 Reset |
| `acceptance_CM-1905_local_execution_off_rejects_machine` | CM-1905 | local-execution off → machine 调用拒 |
| `acceptance_CM-2002_language_follow_zh_ask_zh_answer` | CM-2002 | 中文询问 → 中文答 |
| `acceptance_CM-2160_browser_navigate_public_reachable` | CM-2160 | mock navigate；`navigate_reachable` 公开页 |
| `acceptance_CM-2171_credential_entry_secure_form_no_log` | CM-2171 | 密码/卡号经安全表单；日志无明文 |
| `acceptance_CM-2176_task_description_not_permission` | CM-2176 | 任务描述/记忆/拆解 ≠ 批准（负向） |
| `acceptance_CM-2177_executor_draft_reported_to_parent` | CM-2177 | 执行者停草稿；父消息含全文草稿 |

### API 备注
- `box_host/host_abi.mbt`：`session_jar` / `UpdateComputerResult` / `UpdateComputerFlow` / `HostAbi::update_computer` / `seed_session_login`（kernel-contract evidence）
- `box_host/machines.mbt`：`local_execution_enabled` / `set_local_execution` / machine 调用拒当 off
- `runtime/language.mbt`：`detect_ask_language` / `follow_language_answer` / `language_follow_ok`
- `agents/computer_use/navigate.mbt`：`NavigateResult` / `navigate_public` / `computer_use_navigate_public`
- `connectors/commerce/purchases.mbt`：`SecureCredentialForm` / `enter` / `log_contains_plaintext`
- `security/permission_source.mbt`：`PermissionClaimSource` / `evaluate_permission_claim` / `plan_irreversible_from_claim`
- `security/executor_draft_parent.mbt`：`executor_report_draft_to_parent` / `ExecutorParentDraftMessage::contains_full_draft`（不改 `agent_inbox.mbt`）
- 新验收：`box_host/acceptance_cm0806_1903_1905_test.mbt`、`runtime/acceptance_cm2002_test.mbt`、`agents/computer_use/acceptance_cm2160_test.mbt`、`connectors/commerce/acceptance_cm2171_test.mbt`、`security/acceptance_cm2176_2177_test.mbt`

Smoke: `moon check` ✅ · `moon test` **176** passed / 0 failed（目标 168+8）。
本批新增验收测 **8** 条（上表）。

## M批 P0 acceptance (MoonBit核 · 2026-10-17 12:25 Asia/Shanghai)

矩阵 CM-1901/1902/1904/1906/1907 仍标 **in_progress/todo**（勿改 PASS/done）。
**Kernel-contract only**（仿 CM-0605）：入口枚举 / 锚点闭集 / 删除确认态 PASS ≠ Host 真屏 / host-integration。
未改动 L批验收文件：`box_host/acceptance_cm0806_1903_1905_test.mbt`、`runtime/acceptance_cm2002_test.mbt`、`agents/computer_use/acceptance_cm2160_test.mbt`、`connectors/commerce/acceptance_cm2171_test.mbt`、`security/acceptance_cm2176_2177_test.mbt`。
未改动 I/policy、J、K 验收文件。未标 capability-matrix PASS。
跳过重复 CM-1903/1905（已由 L 覆盖）；本批仅交叉断言锚点/语义（1904/1906）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-1901_settings_entry_closed_set` | CM-1901 | 仅 SidebarAccountButton / KeyboardShortcut / CommandPalette；禁 gear/Preferences/per-agent panel；`OpenSettingsIntent::validate` |
| `acceptance_CM-1902_settings_anchor_deeplink_bijection` | CM-1902 | 27 锚点闭集双射；`grokbot://app/v1/settings?id=`；未知 id → Error |
| `acceptance_CM-1907_delete_agent_confirm_not_settings` | CM-1907 | 侧栏右键 Delete + 确认态；禁 Settings/archive/hide；无 confirm 不得 Completed |
| `acceptance_CM-1904_reset_computer_not_preferred` | CM-1904 | `reset-computer` 锚点存在；助手首选 `update-computer` |
| `acceptance_CM-1906_update_channel_ne_update_computer` | CM-1906 | `update-channel`（Updates）≠ `update-computer`（Computer） |

### API 备注
- `ui_protocol/settings_ui.mbt`：`SettingsEntry` / `SettingsTab` / `SettingsAnchor` / `OpenSettingsIntent` / `settings_deep_link` / `parse_settings_anchor` / `parse_settings_deep_link` / `HostSettingsUiMock` / `prefer_update_over_reset` / `update_channel_ne_update_computer`
- `ui_protocol/delete_agent.mbt`：`HostAgentId` / `DeleteAgentPhase` / `DeleteAgentIntent` / `DeleteAgentPath` / `HostAgentLifecycleUiMock`（request/confirm/cancel；force_complete 拒）
- `ui_protocol/markdown.mbt`：`validate_deeplink_or_reject` 接受合法 `grokbot://app/v1/settings?id=`（闭集）
- 新验收：`ui_protocol/acceptance_cm1901_1902_1907_test.mbt`、`ui_protocol/acceptance_cm1904_1906_test.mbt`
- 消歧：`bitbot.mbt` / `types_test.mbt` 使用 `EndTurnReason::Completed`（与 `DeleteAgentPhase::Completed` 并存）

Smoke: `moon check` ✅ · `moon test` **181** passed / 0 failed（目标 176+5）。
本批新增验收测 **5** 条（上表）。

## N批 P1 acceptance (MoonBit核 · 2026-10-17 12:30 Asia/Shanghai)

矩阵 CM-0107/0110/0112/0202/0204/0205/0302/0303 仍标 **todo/in_progress**（勿改 PASS/done）。
未改动 M批文件：`ui_protocol/settings_ui.mbt`、`ui_protocol/delete_agent.mbt`、`ui_protocol/acceptance_cm1901_1902_1907_test.mbt`、`ui_protocol/acceptance_cm1904_1906_test.mbt`。
未标 capability-matrix PASS。Kernel-contract only（CM-0205 仿 CM-0605：面板字段锚点 ≠ Host 真屏）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0107_voice_memo_spoken_sentences` | CM-0107 | voice_memo=true；口述完整句、拒 markdown 列表；静默至首条 memo |
| `acceptance_CM-0110_inbound_reaction_no_forced_reply` | CM-0110 | `[inbound]` reaction 唤醒；轻量 ack 默认不回复；useful 才 Act |
| `acceptance_CM-0112_todowrite_multistep_checklist` | CM-0112 | TodoWrite ≥3 步可见；`mark_todo_done` 勾选 done |
| `acceptance_CM-0202_update_avatar_preview_reject_invalid` | CM-0202 | UpdateAvatar 可预览；无效/缺文件/非图路径拒绝 |
| `acceptance_CM-0204_hidden_agent_not_in_main_sidebar` | CM-0204 | hidden 不进主侧栏；仍 `is_addressable` |
| `acceptance_CM-0205_per_agent_info_panel_fields` | CM-0205 | 面板字段对齐 app-ui：desktop-preview / Routines / Channels / Members / gear-settings |
| `acceptance_CM-0302_journal_range_query_no_profile_pollute` | CM-0302 | journal 按日期范围检索；不污染 profile |
| `acceptance_CM-0303_shared_memory_scope_isolation` | CM-0303 | shared scope 隔离；cross-scope read 拒绝 |

### API 备注
- `runtime/voice_memo.mbt`：`is_spoken_sentence_style` / `TurnContext::deliver_voice_memo` / `is_silent_before_voice_memo` / `voice_memo_count` / `VoiceMemoDelivery`
- `runtime/todo_write.mbt`：`TurnContext::todo_write` / `visible_todos` / `mark_todo_done` / `done_todo_count` / `TodoItem::is_done`
- `channels/inbound_reaction.mbt`：`InboundReaction` / `ReactionWakeDisposition` / `handle_inbound_reaction` / `plan_reaction_outbound` / `has_inbound_reaction_cue`
- `ui_protocol/avatar.mbt`：`update_avatar` / `validate_avatar_path` / `AvatarPreview`
- `ui_protocol/agent_visibility.mbt`：`AgentRecord` / `AgentDirectory` / `main_sidebar_ids` / `in_main_sidebar` / `is_addressable` / `set_hidden`
- `ui_protocol/info_panel.mbt`：`InfoPanelSection` / `PerAgentInfoPanel` / `info_panel_section_anchors` / `HostInfoPanelMock`
- `memory/journal.mbt`：`JournalStore` / `query_range` / `journal_pollutes_profile`
- `memory/shared_scope.mbt`：`SharedScopeId` / `SharedMemoryStore` / `cross_scope_read` / `scopes_isolated`
- 新验收：`runtime/acceptance_cm0107_test.mbt`、`runtime/acceptance_cm0112_test.mbt`、`channels/acceptance_cm0110_test.mbt`、`ui_protocol/acceptance_cm0202_test.mbt`、`ui_protocol/acceptance_cm0204_test.mbt`、`ui_protocol/acceptance_cm0205_test.mbt`、`memory/acceptance_cm0302_test.mbt`、`memory/acceptance_cm0303_test.mbt`

Smoke: `moon check` ✅ · `moon test` **189** passed / 0 failed（目标 181+8）。
本批新增验收测 **8** 条（上表）。

## O批 P1 acceptance (MoonBit核 · 2026-10-17 12:35 Asia/Shanghai)

矩阵 CM-0408/0410/0411/0412/0414/0417/0502/0503 仍标 **todo/in_progress**（勿改 PASS/done）。
未改动 N批逻辑/API：`runtime/voice_memo.mbt`、`runtime/todo_write.mbt`、`runtime/acceptance_cm0107_test.mbt`、`runtime/acceptance_cm0112_test.mbt`、`channels/inbound_reaction.mbt`、`channels/acceptance_cm0110_test.mbt`、`ui_protocol/avatar.mbt`、`ui_protocol/agent_visibility.mbt`、`ui_protocol/info_panel.mbt`、`ui_protocol/acceptance_cm0202/0204/0205_test.mbt`、`memory/journal.mbt`、`memory/shared_scope.mbt`、`memory/acceptance_cm0302/0303_test.mbt`（本批未手改；`moon fmt` 可能仅动空白）。
未标 capability-matrix PASS。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0408_origin_event_native_repo_only` | CM-0408 | Origin 仅 Native；Mirror 拒；CI 需 pr_scope |
| `acceptance_CM-0410_mail_inbox_wake_headers_only` | CM-0410 | +tag 过滤；wake 仅 headers；体经 `MailService::read_thread` |
| `acceptance_CM-0411_webhook_trigger_key_opaque` | CM-0411 | 面板可复制 URL/key；`assistant_tool_read_key` 拒；wake 含 `<webhook_event>` |
| `acceptance_CM-0412_group_listeners_any_path_same_prompt` | CM-0412 | 多 path OR；cron 可入组；任一路径同 prompt |
| `acceptance_CM-0414_terminal_state_auto_delete` | CM-0414 | PR Merged/Closed 或 TimedWatch 终态 wake 后 routine 消失 |
| `acceptance_CM-0417_automation_status_no_prompt_body` | CM-0417 | reminder 列 routine id + folder id；无 prompt；`get` 取全文 |
| `acceptance_CM-0502_user_skills_load_with_priority` | CM-0502 | User skills 可加载；优先级 User > Plugin > Managed |
| `acceptance_CM-0503_plugin_skills_appear_after_install` | CM-0503 | `PluginRegistry::install` 后 plugin skills 出现 |

### API 备注
- `routines/events.mbt`：`OriginListenerShape` / `validate_origin_listener`；`MailInboxListener` / `MailWakeHeaders` / `mail_inbox_wake` / `mail_wake_payload`；`WebhookPanelSecrets` / `webhook_wake_payload`；`GroupListener` / `GroupListenerPath` / `wake_on`
- `routines/lifecycle.mbt`：`TerminalWakeReason` / `on_terminal_wake` / `TimedWatch` / `apply_timed_watch_end` / `on_pr_terminal_wake` / `delete_routine`
- `runtime/automation_status.mbt`：`RoutineStatusEntry` / `build_routines_status_reminder` / `reminder_contains_prompt_body`
- `skills/catalog.mbt`：`UnifiedCatalog` / `UserSkill` / `PluginSkill` / `SkillSource` / `resolve` / `skill_priority_rule` / `install_plugin`
- `connectors/plugins.mbt`：`PluginRegistry` / `PluginBundle` / `install`
- 新验收：`routines/acceptance_cm0408_0412_test.mbt`、`routines/acceptance_cm0414_test.mbt`、`runtime/acceptance_cm0417_test.mbt`、`skills/acceptance_cm0502_0503_test.mbt`

Smoke: `moon check` ✅ · `moon test` **197** passed / 0 failed（目标 189+8）。
本批新增验收测 **8** 条（上表）。

## P批 P1 acceptance (MoonBit核 · 2026-10-17 12:40 Asia/Shanghai)

矩阵 CM-0505/0507/0607/0609/0706/0802/0805/0904 仍标 **todo/in_progress**（勿改 PASS/done）。
未改动 O批验收文件：`routines/acceptance_cm0408_0412_test.mbt`、`routines/acceptance_cm0414_test.mbt`、`runtime/acceptance_cm0417_test.mbt`、`skills/acceptance_cm0502_0503_test.mbt`（hash 未变）。
`connectors/plugins.mbt` 仅谨慎扩展（CM-0904 namespace Ready；CM-0503 seed/install API 保持绿）。
未标 capability-matrix PASS。Kernel-contract only（CM-0607/0802 仿 CM-0605：Host mock ≠ Host 真屏）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0505_update_skill_next_trigger_new_body` | CM-0505 | UpdateSkill 改 user body；`next_trigger_body` 用新正文；managed 拒写 |
| `acceptance_CM-0507_site_playbook_snippet_to_computer_use` | CM-0507 | match site → Read first；Dispatch snippet 进 computerUse 子任务 |
| `acceptance_CM-0607_box_doctor_pass_fail_parsable` | CM-0607 | box-doctor → `/tmp/box-doctor.log`；PASS/FAIL/SUMMARY 可解析；failures reportable |
| `acceptance_CM-0609_agent_store_authorized_mount` | CM-0609 | `/cursor/stores/<id>` 授权可读；未授权 path_exists=false |
| `acceptance_CM-0706_sent_from_machine_default` | CM-0706 | 消息带 machineId；未指定默认 last-message machine |
| `acceptance_CM-0802_box_chrome_launcher_not_bare` | CM-0802 | 浏览器经 box-chrome；裸 chrome 拒；锁文件可诊断 |
| `acceptance_CM-0805_request_box_help_handoff_is_ask` | CM-0805 | handoff 即 ask；禁预问「要交棒吗」 |
| `acceptance_CM-0904_install_plugin_namespace_ready` | CM-0904 | InstallPlugin/add-connector 后 namespace Ready/usable |

### API 备注
- `skills/catalog.mbt`：`UnifiedCatalog::update_skill` / `next_trigger_body`
- `skills/site_playbooks.mbt`：`SitePlaybookCatalog` / `match_site` / `read_playbook` / `prepare_dispatch`
- `agents/computer_use/playbook_dispatch.mbt`：`dispatch_site_playbook_snippet` / `PlaybookChildTask`
- `box_host/box_doctor.mbt`：`HostAbi::run_box_doctor` / `parse_doctor_line` / `BoxDoctorReport`
- `box_host/box_chrome.mbt`：`HostAbi::launch_browser` / `diagnose_box_chrome_lockfile` / `documented_box_chrome_path`
- `stores/store.mbt`：`StoreMountTable` / `authorize` / `path_exists` / `read`
- `runtime/machine_default.mbt`：`MachineDefaultSession` / `InboundMachineNote` / `resolve_machine_id`
- `ui_protocol/box_help.mbt`：`request_box_help` / `BoxHelpHandoff` / `is_forbidden_pre_ask_handoff`
- `connectors/plugins.mbt`：`PluginBundle.mcp_namespace` / `add_connector` / `namespace_usable` / `namespace_status`
- 新验收：`skills/acceptance_cm0505_test.mbt`、`agents/computer_use/acceptance_cm0507/0802/0805_test.mbt`、`box_host/acceptance_cm0607_test.mbt`、`stores/acceptance_cm0609_test.mbt`、`runtime/acceptance_cm0706_test.mbt`、`connectors/acceptance_cm0904_test.mbt`

Smoke: `moon check` ✅ · `moon test` **205** passed / 0 failed（目标 197+8）。
本批新增验收测 **8** 条（上表）。

## Q批 P1 acceptance (MoonBit核 · 2026-10-17 12:45 Asia/Shanghai)

矩阵 CM-0909/1007/1008/1010/1103/1105/1203/1204 仍标 **todo/in_progress**（勿改 PASS/done）。
未改动 P批验收/实现文件：`skills/acceptance_cm0505_test.mbt`、`skills/site_playbooks.mbt`、`box_host/box_doctor.mbt`、`stores/acceptance_cm0609_test.mbt`、`runtime/machine_default.mbt`、`box_host/box_chrome.mbt`、`ui_protocol/box_help.mbt`、`connectors/acceptance_cm0904_test.mbt`、`agents/computer_use/playbook_dispatch.mbt`、`agents/computer_use/box_chrome_launch.mbt`、`agents/computer_use/box_help_handoff.mbt`、`agents/computer_use/acceptance_cm0507/0802/0805_test.mbt`（hash 未变）。
未标 capability-matrix PASS。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0909_cursor_origin_distinct_from_github_mirror` | CM-0909 | cursor-origin 原生仓/PR/checks；拒 mirror；namespace ≠ cursor-github |
| `acceptance_CM-1007_mailbox_create_draft_no_send` | CM-1007 | create_draft 留 Drafts；不发送；附件经 UploadFile |
| `acceptance_CM-1008_plus_tag_address_routine_filter` | CM-1008 | To/Cc 可见 +tag；routine 仅匹配 tag |
| `acceptance_CM-1010_send_on_behalf_tone_samples` | CM-1010 | 首次代写提供近期采样；按 register 匹配语气 |
| `acceptance_CM-1103_personal_slack_owner_dm_only` | CM-1103 | 个人 bot 仅 owner DM；共享频道礼貌拒 + share hint |
| `acceptance_CM-1105_setup_slack_connect_flow` | CM-1105 | SetUpSlack connect/status 或 Details；流程可完成 |
| `acceptance_CM-1203_task_knowledge_work_dispatch_summary` | CM-1203 | knowledgeWork 派发并回收摘要 |
| `acceptance_CM-1204_task_video_watch_path_in_conclusion_out` | CM-1204 | watchVideo 视频路径入、结论出 |

### API 备注
- `agents/cloud/origin_mcp.mbt`：`OriginMcpSurface` / `namespace_id` / `list_repos` / `get_pull_request` / `checks_read` / `seed_mirror_repo` 拒
- `connectors/mail/mailbox_draft.mbt`：`MailboxDraftStore::create_draft` / `attach_via_upload` / `try_send`
- `connectors/mail/plus_tag.mbt`：`parse_plus_tag_address` / `to_header` / `routine_matches_plus_tag` / `MailRecipients`
- `skills/send_on_behalf_tone.mbt`：`SendOnBehalfToneSession` / `begin_first_proxy_write` / `pick_sample` / `draft_matching_register`
- `channels/personal_slack.mbt`：`PersonalSlackBot::try_send` / `share_hint` / `PersonalSlackSendResult`
- `channels/setup_slack.mbt`：`SetUpSlackSession` / `connect_tool` / `guide_details` / `complete_from_details`
- `agents/types.mbt`：`SubagentType::KnowledgeWork` / `WatchVideo`
- `agents/task/handle.mbt`：`dispatch_knowledge_work` / `run_knowledge_work_task` / `dispatch_watch_video` / `run_watch_video_task`
- 新验收：`agents/cloud/acceptance_cm0909_test.mbt`、`connectors/mail/acceptance_cm1007/1008_test.mbt`、`skills/acceptance_cm1010_test.mbt`、`channels/acceptance_cm1103/1105_test.mbt`、`agents/task/acceptance_cm1203/1204_test.mbt`

Smoke: `moon check` ✅ · `moon test` **213** passed / 0 failed（目标 205+8）。
本批新增验收测 **8** 条（上表）。

## R批 P1 acceptance (MoonBit核 · 2026-10-17 12:50 Asia/Shanghai)

矩阵 CM-1205/1303/1305/1306/1401/1402/1404/1507 仍标 **todo/in_progress**（勿改 PASS/done）。
未改动 Q批逻辑实现：`agents/cloud/origin_mcp.mbt`、`connectors/mail/mailbox_draft.mbt`、`connectors/mail/plus_tag.mbt`、`channels/personal_slack.mbt`（hash 未变）；`acceptance_cm0909_test.mbt` / `acceptance_cm1203_test.mbt` 已恢复原 hash。
`moon fmt` 曾仅改排版触及 `skills/send_on_behalf_tone.mbt`、`channels/setup_slack.mbt`、`agents/task/acceptance_cm1204_test.mbt`（语义未改；Q 验收仍绿）。未手改 Q 验收逻辑。
未标 capability-matrix PASS。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-1205_message_subagent_arrives_status_queryable` | CM-1205 | 运行中子代理 `message` 入 inbox；`check`/`query_status` 可查 |
| `acceptance_CM-1303_origin_cloud_aligns_cursor_origin_mcp` | CM-1303 | Origin PR/checks 工具面与 cursor-origin MCP 对齐（不改 origin_mcp.mbt） |
| `acceptance_CM-1305_source_control_no_origin_trigger_on_mirror` | CM-1305 | source-control：Mirror/GitHub 拒 origin 触发；Native→cursor-origin |
| `acceptance_CM-1306_cloud_agent_autoreview_same_action_card` | CM-1306 | CloudAgent 拦截后同动作 `smart_mode_retry` → 审批卡 |
| `acceptance_CM-1401_create_agent_appears_in_members` | CM-1401 | CreateAgent → Members + 主侧栏 |
| `acceptance_CM-1402_send_to_agent_delivery_loop_detect` | CM-1402 | SendToAgent 投递到达；自环/A↔B 循环探测 |
| `acceptance_CM-1404_room_turn_no_private_assumptions` | CM-1404 | `[room "…"]` 回合不泄漏私聊假设 |
| `acceptance_CM-1507_auto_review_settings_deeplink_anchors` | CM-1507 | `auto-review` / `auto-review-rules` / `security-keys` grokbot:// 锚点 |

### API 备注
- `agents/task/handle.mbt`：`SubagentHandle.inbox` / `message` / `message_arrived` / `inbox_snapshot` / `query_status`
- `agents/cloud/origin_align.mbt`：`cursor_origin_mcp_pr_checks_tools` / `origin_cloud_aligns_cursor_origin_mcp`（不改 Q 的 `origin_mcp.mbt`）
- `skills/source_control.mbt`：`ScRepoKind` / `ScBackend` / `route_source_control` / `allows_origin_trigger` / `register_origin_trigger`
- `agents/cloud/cloud_autoreview.mbt`：`CloudAgentAutoReviewSession` / `intercept` / `retry_same_action_card`
- `agents/teammates/`（新包）：`TeammateDirectory::create_agent` / `SendToAgentBus` / `open_room_turn` / `parse_room_cue`
- `ui_protocol/settings_ui.mbt`：复用既有 `AutoReview` / `AutoReviewRules` / `SecurityKeys` 锚点（M 批保持绿）
- 新验收：`agents/task/acceptance_cm1205_test.mbt`、`agents/cloud/acceptance_cm1303/1306_test.mbt`、`skills/acceptance_cm1305_test.mbt`、`agents/teammates/acceptance_cm1401/1402/1404_test.mbt`、`ui_protocol/acceptance_cm1507_test.mbt`

Smoke: `moon check` ✅ · `moon test` **221** passed / 0 failed（目标 213+8）。
本批新增验收测 **8** 条（上表）。

## S批 P1 acceptance (MoonBit核 · 2026-10-17 12:55 Asia/Shanghai)

矩阵 CM-1601/1603/1703/1801/1807/1809/1810/2004 仍标 **todo/in_progress**（勿改 PASS/done）。
未改动 R批文件：`agents/task/acceptance_cm1205_test.mbt`、`agents/cloud/origin_align.mbt`、`agents/cloud/cloud_autoreview.mbt`、`skills/source_control.mbt`、`agents/teammates/create_agent.mbt`、`agents/teammates/room_turn.mbt`、`agents/teammates/send_to_agent.mbt`、`agents/teammates/acceptance_cm1401/1402/1404_test.mbt`、`ui_protocol/acceptance_cm1507_test.mbt`（hash 未变）。
`agents/task/handle.mbt` 仅追加 CM-1603 API（`run_watch_video_answer_from_frames`）；未改 `run_watch_video_task`（Q CM-1204 保持绿）。
未标 capability-matrix PASS。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-1601_generate_image_artifact_deliverable` | CM-1601 | GenerateImage 产物落盘；`deliverable_attachment` 可投递 |
| `acceptance_CM-1603_watch_video_answer_from_frames` | CM-1603 | watchVideo 答基于 frames（tools/media 抽帧） |
| `acceptance_CM-1703_fetch_fail_public_fallback_no_cred_bypass` | CM-1703 | 403/block → browser/curl 公共页回退；401 禁凭证绕过 |
| `acceptance_CM-1801_scheduling_no_connector_fallback` | CM-1801 | scheduling 无连接器 → no-connector-fallback/browser |
| `acceptance_CM-1807_slides_pptx_openable` | CM-1807 | slides/office-pptx 产出可打开 pptx（path+PK magic） |
| `acceptance_CM-1809_no_connector_fallback_path_not_hard_fail` | CM-1809 | 无连接器明确降级路径，非硬失败 |
| `acceptance_CM-1810_code_changes_with_source_control` | CM-1810 | code-changes 与 source-control 协同（mirror 拒 origin） |
| `acceptance_CM-2004_room_cue_triggers_group_chat_discipline` | CM-2004 | 隐藏 [room] cue 触发 group-chat-turns 纪律 |

### API 备注
- `tools/media/`（新包）：`MediaHost::generate_image` / `deliver_generated_image` / `extract_video_frames` / `answer_from_frames`
- `tools/web.mbt`：`PublicFetchFallback` / `fetch_with_public_fallback` / `seed_blocked_public` / `is_credential_bypass_fallback`；fetch 区分 401 auth vs 403 block
- `agents/computer_use/public_fetch_fallback.mbt`：`public_page_fallback`（browser/curl；禁 cookies/tokens）
- `agents/task/handle.mbt`：`WatchVideoFrameAnswer` / `run_watch_video_answer_from_frames`
- `skills/scheduling.mbt`：`run_scheduling` / `SchedulingOutcome`
- `skills/slides_pptx.mbt`：`SlidesHost::generate_pptx` / `PptxArtifact.openable`
- `skills/no_connector_fallback.mbt`：`resolve_no_connector_fallback` / `plan_without_connector`
- `skills/code_changes.mbt`：`plan_code_changes` / `CodeChangePlan::try_origin_trigger`（调用既有 source-control API）
- `agents/teammates/group_chat_discipline.mbt`（新文件，未改 room_turn）：`trigger_group_chat_discipline` / `apply_group_chat_discipline`
- 新验收：`tools/media/acceptance_cm1601_test.mbt`、`agents/task/acceptance_cm1603_test.mbt`、`tools/acceptance_cm1703_test.mbt`、`skills/acceptance_cm1801/1807/1809/1810_test.mbt`、`agents/teammates/acceptance_cm2004_test.mbt`

Smoke: `moon check` ✅ · `moon test` **229** passed / 0 failed（目标 221+8）。
本批新增验收测 **8** 条（上表）。

## T批 P1 acceptance (MoonBit核 · 2026-10-17 13:17 Asia/Shanghai)

矩阵 CM-2005/2006/2101/2102/2103/2104/2105/2107 仍标 **todo/in_progress**（勿改 PASS/done）。
未改动 S批文件：`tools/media/*`、`tools/web.mbt`、`agents/computer_use/public_fetch_fallback.mbt`、`skills/scheduling.mbt`、`skills/slides_pptx.mbt`、`skills/no_connector_fallback.mbt`、`skills/code_changes.mbt`、`agents/teammates/group_chat_discipline.mbt`、及 S 验收测（hash 未变）。
channels 仅扩展 `Voice` 通道（CM-2005）；`personal_slack` / `outbound` / `degrade` / `slack_semantics` / `address` 补全 exhaustiveness（语义保持）。
未标 capability-matrix PASS。Kernel-contract only（CM-2103 仿 CM-0605：parse/validate ≠ Host 真渲染像素）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2005_voice_call_relay_summary_on_end` | CM-2005 | voice:<call> 第二助手；文本中继；结束写 voice-calls/ JSON；仅回 voice；汇总进应用 |
| `acceptance_CM-2006_claim_inbox_ask_local_part_no_default` | CM-2006 | 无 inbox 询问 local part；不默认生成；无选定不 claim |
| `acceptance_CM-2101_react_to_message_pill_toggle` | CM-2101 | ReactToMessage emoji pill 可见；同 emoji toggle 取消 |
| `acceptance_CM-2102_widget_multiselect_danger_dismiss` | CM-2102 | multiSelect 每行一值；danger；dismissOnMoveOn；allowCustom |
| `acceptance_CM-2103_markdown_math_and_mermaid` | CM-2103 | \( \)/$$ 与 mermaid 围栏 parse/validate |
| `acceptance_CM-2104_parallel_readonly_tools_same_turn` | CM-2104 | 独立只读（WebSearch/Read）同回合并行发出 |
| `acceptance_CM-2105_flexible_cron_early_late_window` | CM-2105 | earlyMinutes/lateMinutes；启动落在窗口内 |
| `acceptance_CM-2107_uninstall_plugin_namespace_gone` | CM-2107 | UninstallPlugin 后 GetDynamicTools 无该 ns |

### API 备注
- `skills/voice.mbt`：`VoiceCallSession::start` / `relay_text` / `assert_reply_voice_only` / `end_and_summarize` / `build_end_json` / `is_voice_calls_json_path`
- `channels/`：`ChannelKind::Voice`；`parse_channel_address("voice:…")` / `reply_hint`
- `connectors/mail/claim_first_start.mbt`：`FirstStartClaimGuide` / `AskLocalPart` / `select_local_part` / `claim_after_selection` / `suggested_default_local_part`（恒 None）
- `ui_protocol/react_to_message.mbt`：`ReactToMessageHost::react_to_message` / `MessageReactionPill::is_visible_pill`
- `ui_protocol/widget.mbt`：`as_multiselect_lines` / `decision_card_advanced` / `should_dismiss_on_move_on` / `has_danger_option`
- `ui_protocol/markdown_math.mbt`：`parse_markdown_math_and_mermaid` / `MarkdownRichParse`
- `runtime/parallel_tools.mbt`：`emit_two_readonly_same_turn` / `plan_parallel_readonly_emits` / `classify_tool_mutability`
- `routines/cron_phase.mbt`：`CronPlan::start_falls_in_window` / `plan_flexible_with_window`
- `connectors/plugins.mbt`：`PluginRegistry::uninstall` / `ready_namespaces`
- `tools/dynamic.mbt`：`DynamicCatalog::remove_namespace` / `list_namespaces` / `has_namespace`
- 新验收：`skills/acceptance_cm2005_test.mbt`、`connectors/mail/acceptance_cm2006_test.mbt`、`ui_protocol/acceptance_cm2101/2102/2103_test.mbt`、`runtime/acceptance_cm2104_test.mbt`、`routines/acceptance_cm2105_test.mbt`、`connectors/acceptance_cm2107_test.mbt`

Smoke: `moon check` ✅ · `moon test` **237** passed / 0 failed（目标 229+8）。
本批新增验收测 **8** 条（上表）。

## U批 P1 acceptance (MoonBit核 · 2026-10-17 13:30 Asia/Shanghai)

矩阵 CM-2108/2111/2116/2118/2119/2120/2125/2128 仍标 **todo**（勿改 PASS/done）。
未改动 T批验收/实现文件：`skills/voice.mbt`、`acceptance_cm2005`、`claim_first_start`、`acceptance_cm2006`、`acceptance_cm2101/2102/2103`、`parallel_tools`、`acceptance_cm2104`、`routines acceptance_cm2105`、`connectors acceptance_cm2107`（hash 未变）。
谨慎共享扩展：`connectors/plugins.mbt`（GetPlugin）、`skills/site_playbooks.mbt`（全目录族）、`security/policy.mbt`（Copyright）、`ui_protocol/react_to_message.mbt`（出站 end_turn）；CM-2101 / I-batch policy / CM-0507 / CM-0609 保持绿。
未标 capability-matrix PASS。Host 项 = kernel-contract only（CM-2120 mock auth；CM-2128 pill/envelope ≠ Host 像素）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2108_get_plugin_metadata_and_skills` | CM-2108 | GetPlugin → id + skills list |
| `acceptance_CM-2111_site_playbooks_catalog_loader_map` | CM-2111 | 22 站 enum ↔ loader；单站 map（airbnb/expedia/doordash/…） |
| `acceptance_CM-2116_copyright_policy_summarize_not_verbatim` | CM-2116 | copyright 拒 verbatim；ABSTRACT_FIXTURE 摘要 |
| `acceptance_CM-2118_user_workflows_visible_not_matrix_contract` | CM-2118 | 用户私有 workflows 运行时可见；不写入必交矩阵合同 |
| `acceptance_CM-2119_store_authorized_mount_unauthorized_absent` | CM-2119 | `/cursor/stores/<id>` 授权可读；未授权路径缺失 |
| `acceptance_CM-2120_outlook_connector_auth_then_draft_send` | CM-2120 | user-Outlook NeedsAuth→auth→draft/send |
| `acceptance_CM-2125_copyright_chapter_verbatim_refuse_summary` | CM-2125 | 整章 verbatim 拒 → 摘要替代（异于 2116 chapter 标志） |
| `acceptance_CM-2128_react_outbound_end_turn_pill_no_body` | CM-2128 | 致谢 → React end_turn 显示 pill，可无正文 |

### API 备注
- `connectors/plugins.mbt`：`PluginRegistry::get_plugin` / `PluginMetadata` / `skill_names`
- `skills/site_playbooks.mbt`：`SitePlaybookId` enum（22）/ `site_playbook_catalog_family` / `seed_full_catalog` / `map_site` / `enum_matches_loader`（`seed_demo` 保留）
- `security/policy.mbt`：`PolicyCategory::Copyright` / `evaluate_copyright_policy` / `CopyrightPolicyResult::uses_summary_not_verbatim`
- `skills/user_workflows.mbt`：`UserWorkflowRuntime` / `MatrixMustDeliverContract` / `contains_any_user_workflow` / NG-003
- `stores/store.mbt`：复用 `StoreMountTable`（对齐 CM-0609）
- `connectors/mail/outlook.mbt`：`OutlookConnector::new/authenticate/create_draft/send_draft/crud_available`
- `ui_protocol/react_to_message.mbt`：`react_outbound_end_turn` / `plan_thank_you_react_end_turn` / `ReactOutboundTurn` / `is_thank_you_message`
- 新验收：`connectors/acceptance_cm2108_test.mbt`、`skills/acceptance_cm2111_test.mbt`、`security/acceptance_cm2116_2125_test.mbt`、`skills/acceptance_cm2118_test.mbt`、`stores/acceptance_cm2119_test.mbt`、`connectors/mail/acceptance_cm2120_test.mbt`、`ui_protocol/acceptance_cm2128_test.mbt`

Smoke: `moon check` ✅ · `moon test` **245** passed / 0 failed（目标 237+8）。
本批新增验收测 **8** 条（上表）。

## V批 P1 acceptance (MoonBit核 · 2026-10-17 13:31 Asia/Shanghai)

矩阵 CM-2131/2132/2135/2136/2141/2144/2145/2146 仍标 **todo**（勿改 PASS/done）。
未改动 U批验收文件：`connectors/acceptance_cm2108*`、`skills/acceptance_cm2111*`、`security/acceptance_cm2116_2125*`、`skills/acceptance_cm2118*`、`stores/acceptance_cm2119*`、`connectors/mail/acceptance_cm2120*`、`ui_protocol/acceptance_cm2128*`。
谨慎共享扩展：`skills/user_workflows.mbt`（WeChat seed + `NativeMustDeliverP0`；CM-2118 API/测保持绿）。
未标 capability-matrix PASS。Host 项 = kernel-contract only（CM-2131 cursor-agent 卡；CM-2146 app→浏览器会话）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2131_cursor_agent_card_opens_cloud` | CM-2131 | SendToUser type=cursor-agent 发卡；bcId → 可打开云代理 |
| `acceptance_CM-2132_x_public_rate_limit_window` | CM-2132 | 内置 x 命名空间 30/分 1000/日 UTC 窗；超额拒并报告剩余 |
| `acceptance_CM-2135_user_private_workflows_not_kernel_must_deliver` | CM-2135 | WeChat 等用户私有 workflows 运行时可见；不写入必交原生/P0 |
| `acceptance_CM-2136_task_resume_preserves_context` | CM-2136 | 子代理完成后 resume=id 保留上下文并继续 |
| `acceptance_CM-2141_send_to_agent_fanout_ask_first` | CM-2141 | 未明确要求时扇出多名助手 → 先问用户 |
| `acceptance_CM-2144_standing_permission_revoke_immediate` | CM-2144 | 站立直发授权撤销后下一封须再确认 |
| `acceptance_CM-2145_memory_api_authoritative_not_box_file` | CM-2145 | Memory API 权威写 profile；盒普通文件非权威源 |
| `acceptance_CM-2146_connector_app_vs_user_identity_browser` | CM-2146 | app 身份不足且需用户身份 → 改已登录浏览器会话 |

### API 备注
- `ui_protocol/cursor_agent_card.mbt`：`SendToUserType::CursorAgent` / `issue_cursor_agent_card` / `send_to_user_cursor_agent` / `CursorAgentCard::open_cloud_agent`
- `connectors/x_rate_limit.mbt`：`XPublicRateLimiter` / `UtcRateWindow` / `X_RATE_LIMIT_PER_MINUTE=30` / `X_RATE_LIMIT_PER_DAY=1000`
- `skills/user_workflows.mbt`：`seed_wechat_and_private` / `NativeMustDeliverP0` / `try_write_user_workflow_as_native`（CM-2118 面保持）
- `agents/task/handle.mbt`：`TaskResumeRegistry` / `record_finished` / `resume_by_id` / `TaskResumeContext`
- `agents/teammates/send_to_agent.mbt`：`plan_send_to_agent_fanout` / `FanoutPlan` / `SendToAgentBus::fanout`
- `security/standing_permission.mbt`：`StandingPermissionTable` / `grant_direct_send` / `revoke` / `attempt_direct_send`
- `memory/authoritative.mbt`：`ProfileWriteSource` / `write_profile_authoritative` / `box_ordinary_file_is_profile_authority`
- `connectors/identity_browser.mbt`：`resolve_connector_identity` / `ConnectorIdentitySession::ensure` / `SwitchToSignedInBrowser`
- 新验收：`ui_protocol/acceptance_cm2131_test.mbt`、`connectors/acceptance_cm2132_test.mbt`、`skills/acceptance_cm2135_test.mbt`、`agents/task/acceptance_cm2136_test.mbt`、`agents/teammates/acceptance_cm2141_test.mbt`、`security/acceptance_cm2144_test.mbt`、`memory/acceptance_cm2145_test.mbt`、`connectors/acceptance_cm2146_test.mbt`

Smoke: `moon check` ✅ · `moon test` **253** passed / 0 failed（目标 245+8）。
本批新增验收测 **8** 条（上表）。

## W批 P1 acceptance (MoonBit核 · 2026-10-17 13:36 Asia/Shanghai)

矩阵 CM-2148/2150/2155/2156/2158/2161/2165/2166 仍标 **todo**（勿改 PASS/done）。
未改动 V批验收/实现文件：`ui_protocol/acceptance_cm2131*`、`connectors/acceptance_cm2132*`、`skills/acceptance_cm2135*`、`agents/task/acceptance_cm2136*`、`agents/teammates/acceptance_cm2141*`、`security/acceptance_cm2144*`、`memory/acceptance_cm2145*`、`connectors/acceptance_cm2146*`，以及对应新 API（`cursor_agent_card` / `x_rate_limit` / `user_workflows` / `handle.mbt` resume / `send_to_agent` / `standing_permission` / `authoritative` / `identity_browser`）——本批未写入。
本批仅新增文件；未改 V 共享实现面。未标 capability-matrix PASS。Host 项 = kernel-contract only（CM-2158 Shell mock 安装；CM-2148 路径策略）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2148_cloud_artifact_path_no_opt_cursor_direct` | CM-2148 | 拒 `/opt/cursor/artifacts` 直附；投递 workspace 复制路径或官方 URL |
| `acceptance_CM-2150_read_transcript_includes_tool_calls` | CM-2150 | ReadTranscript 本/子/他助手轨迹含工具调用 |
| `acceptance_CM-2155_origin_trigger_event_subset_only` | CM-2155 | Origin 触发仅 pr-opened/pushed/merged/comment |
| `acceptance_CM-2156_short_concrete_style_guide_sampleable` | CM-2156 | 短句具体风格指南可测抽检（拒空话/过长） |
| `acceptance_CM-2158_box_package_install_via_shell` | CM-2158 | apt/npm 等包安装经 Shell（kernel-contract mock） |
| `acceptance_CM-2161_parallel_multi_subagent_handles_running` | CM-2161 | 同回合 ≥2 handle 且 ≥2 Running |
| `acceptance_CM-2165_routine_silent_ok_no_send_to_user` | CM-2165 | silent_ok 且无 notable → 不 SendToUser |
| `acceptance_CM-2166_routine_break_silence_when_notable` | CM-2166 | failure/approval/decision/notable → 打破静默 |

### API 备注
- `agents/cloud/artifact_path.mbt`：`deliver_cloud_artifact` / `is_forbidden_opt_cursor_artifacts` / `CloudArtifactDelivery` / `CLOUD_AGENT_ARTIFACTS_ROOT`
- `runtime/transcript.mbt`：`TranscriptStore` / `read_transcript` / `read_transcript_for_audit` / `transcript_includes_tool_calls` / `TranscriptScope`
- `routines/origin_trigger_subset.mbt`：`OriginTriggerEvent` / `validate_origin_trigger_event` / `allowed_origin_trigger_events` / `register_origin_trigger_event`
- `runtime/style_guide.mbt` + `docs/style-guide-short-concrete.md`：`sample_style_guide_check` / `assert_style_guide_ok` / `is_fluff_phrase`
- `box_host/package_install.mbt`：`plan_box_package_install` / `install_box_package_via_shell` / `PackageManager` / `reject_non_shell_package_install`
- `agents/task/parallel_spawn.mbt`：`spawn_parallel_executors` / `count_running_handles` / `assert_parallel_multi_running`（未改 `handle.mbt`）
- `routines/silence.mbt`：`SilencePolicy` / `decide_routine_delivery` / `is_break_silence_notable` / `silent_ok_no_send_when_quiet` / `break_silence_when_notable`
- 新验收：`agents/cloud/acceptance_cm2148_test.mbt`、`runtime/acceptance_cm2150_test.mbt`、`routines/acceptance_cm2155_test.mbt`、`runtime/acceptance_cm2156_test.mbt`、`box_host/acceptance_cm2158_test.mbt`、`agents/task/acceptance_cm2161_test.mbt`、`routines/acceptance_cm2165_test.mbt`、`routines/acceptance_cm2166_test.mbt`

Smoke: `moon check` ✅ · `moon test` **261** passed / 0 failed（目标 253+8）。
本批新增验收测 **8** 条（上表）。

## X批 P1 acceptance (MoonBit核 · 2026-10-17 13:42 Asia/Shanghai)

矩阵 CM-2167/2168/2172/2173/2178 仍标 **todo**（勿改 PASS/done）。
未改动 W批验收/实现文件：`agents/cloud/acceptance_cm2148*`、`runtime/acceptance_cm2150*`、`routines/acceptance_cm2155*`、`runtime/acceptance_cm2156*`、`box_host/acceptance_cm2158*`、`agents/task/acceptance_cm2161*`、`routines/acceptance_cm2165*`、`routines/acceptance_cm2166*`，以及对应新 API（`artifact_path` / `transcript` / `origin_trigger_subset` / `style_guide` / `package_install` / `parallel_spawn` / `silence`）——hash 未变。
谨慎共享扩展：`stores/store.mbt`（CM-2173 ordinary file tools 路径策略，复用 `StoreMountTable`；CM-0609 / CM-2119 保持绿）。
未标 capability-matrix PASS。Host 项 = kernel-contract only（CM-2178 Settings 导引 ≠ Host 像素）。
P1 GAP 2163/2164/2174/2175 属下一批 — 本批未实现。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2167_skill_ref_stable_id_source_path` | CM-2167 | SkillRef 稳定引用 id+source+path（managed/user/plugin） |
| `acceptance_CM-2168_channel_speak_as_user_not_third_person` | CM-2168 | 渠道以用户身份发言；拒第三人称用户 |
| `acceptance_CM-2172_teammate_outbound_permission_gate_reuse` | CM-2172 | 队友外发复用 ApprovalGate；无越权 Allow |
| `acceptance_CM-2173_store_read_write_via_ordinary_file_tools` | CM-2173 | store 经 Read/Write 普通文件工具；路径策略 |
| `acceptance_CM-2178_missing_permission_guide_settings_not_pretend` | CM-2178 | 缺权限导引 Settings；不假装已连接 |

### API 备注
- `skills/skill_ref.mbt`：`SkillRef` / `skill_ref_path` / `SkillRef::from_resolved` / `SkillRef::is_stable` / `UnifiedCatalog::skill_ref`
- `channels/identity.mbt`：`ChannelSpeakAsUser` / `plan_channel_speak_as_user` / `is_third_person_about_user` / `assert_not_third_person_about_user` / `ChannelIdentitySpeech`
- `security/teammate_outbound.mbt`：`TeammateOutboundRequest` / `plan_teammate_outbound` / `teammate_try_outbound_bypass` / `assert_teammate_no_unauthorized_outbound` / `TeammateOutboundVerdict`（复用 `ApprovalGate::plan_consequential`）
- `stores/store.mbt`：`OrdinaryFileTool` / `validate_ordinary_tool_path` / `read_via_ordinary_tool` / `write_via_ordinary_tool` / `OrdinaryStoreIo`（复用 `StoreMountTable`）
- `ui_protocol/permission_guide.mbt`：`MissingPermissionKind` / `guide_missing_permission_to_settings` / `MissingPermissionGuide` / `validate_missing_permission_guidance` / `is_pretend_connected_guidance`
- 新验收：`skills/acceptance_cm2167_test.mbt`、`channels/acceptance_cm2168_test.mbt`、`security/acceptance_cm2172_test.mbt`、`stores/acceptance_cm2173_test.mbt`、`ui_protocol/acceptance_cm2178_test.mbt`

Smoke: `moon check` ✅ · `moon test` **266** passed / 0 failed（目标 261+5）。
本批新增验收测 **5** 条（上表）。

## Y批 P1 GAP→kernel-contract + P2 start (MoonBit核 · 2026-10-17 13:47 Asia/Shanghai)

矩阵 CM-2163/2164/2174/2175/0409/0506/0608/0705 仍标 **todo**（勿改 PASS/done）。
未改动 X批验收/实现文件：`skills/acceptance_cm2167*`、`channels/acceptance_cm2168*`、`security/acceptance_cm2172*`、`stores/acceptance_cm2173*`、`ui_protocol/acceptance_cm2178*`，以及对应 API（`skill_ref` / `identity` / `teammate_outbound` / `store` ordinary tools / `permission_guide`）——hash 未变。
未标 capability-matrix PASS。Host/MCP 项 = kernel-contract only（host-integration 仍 GAP）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2163_mcp_file_arg_expand_no_chat_bloat` | CM-2163 | `$file:` 大参从文件注入；chat 仅占位符，不膨胀 |
| `acceptance_CM-2164_mcp_write_to_file_returns_path` | CM-2164 | write_to_file 大结果落盘；返回 `/workspace/agent-tools/` 路径 |
| `acceptance_CM-2174_cross_agent_shared_box_fs_charter` | CM-2174 | 同 box 跨代理共享 FS；桌面 per-agent；CHARTER 一致 |
| `acceptance_CM-2175_box_clock_aligns_user_timezone` | CM-2175 | mock `date` 输出与用户 IANA 时区一致 |
| `acceptance_CM-0409_event_trigger_teams_linear_sentry_pagerduty` | CM-0409 | Teams/Linear/Sentry/PD listener 形状 + 缺连接自动出卡 |
| `acceptance_CM-0506_skill_authoring_produces_valid_skill_md` | CM-0506 | skill-authoring 元技能产出合规 SKILL.md |
| `acceptance_CM-0608_docker_vs_anyrun_env_detect` | CM-0608 | `/.dockerenv` 区分 local-docker vs hosted-anyrun |
| `acceptance_CM-0705_device_local_tools_needs_permission_card` | CM-0705 | 手机 deviceLocalTools；needs_permission → 审批卡 |

### API 备注
- `tools/mcp_host_file.mbt`：`McpHostFs` / `expand_file_arg` / `FileArgExpandResult` / `write_to_file_result` / `WriteToFileResult` / `extract_file_placeholder_path`
- `box_host/shared_box_charter.mbt`：`charter_shared_box_fs` / `charter_distinct_desktops` / `HostAbi::check_cross_agent_shared_box_charter` / `SharedBoxCharterCheck`
- `box_host/box_clock.mbt`：`HostAbi::date_aligned_with_user_tz` / `BoxDateOutput` / `assert_box_clock_matches_user_tz` / `default_user_iana_timezone`
- `routines/connector_events.mbt`：`ExternalEventConnector` / `ExternalListenerShape` / `prepare_external_listener` / `MissingConnectorAutoCard` / `ExternalListenerPrep`
- `skills/skill_authoring.mbt`：`SkillAuthoring` / `SkillMdDraft` / `validate_skill_md` / `produce_skill_md` / `skill_authoring_name`
- `box_host/env_detect.mbt`：`EnvProbe` / `BoxRuntimeKind` / `detect_box_runtime` / `diagnose_box_env` / `HostAbi::diagnose_runtime`
- `box_host/device_local_tools.mbt`：`DeviceLocalTool` / `DeviceToolPermission` / `DevicePermissionCard` / `DeviceLocalToolsRegistry` / `MachineRegistry::device_local_tools_for`
- 新验收：`tools/acceptance_cm2163_2164_test.mbt`、`box_host/acceptance_cm2174_test.mbt`、`box_host/acceptance_cm2175_test.mbt`、`routines/acceptance_cm0409_test.mbt`、`skills/acceptance_cm0506_test.mbt`、`box_host/acceptance_cm0608_test.mbt`、`box_host/acceptance_cm0705_test.mbt`

Smoke: `moon check` ✅ · `moon test` **274** passed / 0 failed（目标 266+8）。
本批新增验收测 **8** 条（上表）。

## Z批 P2 acceptance (MoonBit核 · 2026-10-17 13:56 Asia/Shanghai)

矩阵 CM-0206/0907/0910/1009/1107/1403/1405/1406 仍标 **todo**（勿改 PASS/done）。
未改动 Y批验收/实现文件：`tools/acceptance_cm2163_2164*`、`tools/mcp_host_file.mbt`、`box_host/acceptance_cm2174*`、`box_host/acceptance_cm2175*`、`box_host/shared_box_charter.mbt`、`box_host/box_clock.mbt`、`routines/acceptance_cm0409*`、`routines/connector_events.mbt`、`skills/acceptance_cm0506*`、`skills/skill_authoring.mbt`、`box_host/acceptance_cm0608*`、`box_host/env_detect.mbt`、`box_host/acceptance_cm0705*`、`box_host/device_local_tools.mbt`——hash 未变。
谨慎共享扩展：`channels` 增加 `ChannelKind::Teams` 并补全 exhaustiveness（`types` / `address` / `outbound` / `degrade` / `personal_slack` / `slack_semantics`）；既有 Voice/Slack 测保持绿。
未标 capability-matrix PASS。Host 项 = kernel-contract only（CM-0206/1405 ≠ Host 像素）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-0206_per_assistant_notification_settings` | CM-0206 | 助手级 notify 开关；互不影响；profile key 形 |
| `acceptance_CM-0907_x_twitter_mcp_surface_dynamic_tools` | CM-0907 | user-X posts/bookmarks/chat；GetDynamicTools 列出；读路径可测 |
| `acceptance_CM-0910_public_x_search_namespace_readonly` | CM-0910 | 公开 `x` 命名空间无用户鉴权；search_posts 等只读 |
| `acceptance_CM-1009_unsolicited_mail_unsubscribe_reject_multi` | CM-1009 | 冷邮单收件人+退订；卡发送不支持冷触达；多收件人拒 |
| `acceptance_CM-1107_microsoft_teams_channel_scope` | CM-1107 | Teams 入站/出站+routine 触发；tenant/team 作用域 |
| `acceptance_CM-1403_teammate_sections_message_isolation` | CM-1403 | 群组 sections 分区；消息隔离可测 |
| `acceptance_CM-1405_members_panel_matches_app_ui` | CM-1405 | Members 面板成员列表；与 app-ui Members 锚一致 |
| `acceptance_CM-1406_export_bot_template_no_secrets` | CM-1406 | export-bot-template 可分享模板（非团队副本）；包无秘密 |

### API 备注
- `ui_protocol/notify_settings.mbt`：`AssistantNotifyToggle` / `AssistantNotifySettings` / `PerAssistantNotifyStore::set_toggle` / `to_profile_entries`
- `connectors/x_twitter_mcp.mbt`：`XTwitterMcpSurface` / `USER_X_NAMESPACE` / `seed_dynamic_tools` / `read_post` / `read_bookmarks` / `read_chat_conversations`
- `connectors/x_public_search.mbt`：`XPublicSearchNamespace` / `X_PUBLIC_NAMESPACE` / `search_posts` / `reject_write_tool` / `requires_user_auth`（恒 false）
- `connectors/mail/unsolicited.mbt`：`UnsolicitedMailPlan` / `validate_unsolicited_mail` / `card_send_supports_cold_outreach` / `try_card_send_cold` / `plan_unsolicited_send`
- `channels/teams.mbt` + `ChannelKind::Teams`：`TeamsScope` / `parse_teams_scope` / `plan_teams_outbound` / `TeamsRoutineTrigger` / `TeamsChannelSession`
- `agents/teammates/sections.mbt`：`GroupSections` / `GroupSection` / `post` / `messages_in` / `assert_isolation`
- `agents/teammates/members_panel.mbt`：`MembersPanel::from_directory` / `matches_app_ui` / `HostMembersPanelMock`
- `skills/export_bot_template.mbt`：`export_bot_template` / `BotTemplatePack` / `assert_pack_has_no_secrets` / `export_as_team_copy`（拒）
- 新验收：`ui_protocol/acceptance_cm0206_test.mbt`、`connectors/acceptance_cm0907_test.mbt`、`connectors/acceptance_cm0910_test.mbt`、`connectors/mail/acceptance_cm1009_test.mbt`、`channels/acceptance_cm1107_test.mbt`、`agents/teammates/acceptance_cm1403_test.mbt`、`agents/teammates/acceptance_cm1405_test.mbt`、`skills/acceptance_cm1406_test.mbt`

Smoke: `moon check` ✅ · `moon test` **282** passed / 0 failed（目标 274+8）。
本批新增验收测 **8** 条（上表）。


## AA批 P2 acceptance (MoonBit核 · 2026-10-17 14:01 Asia/Shanghai)

矩阵 CM-1602/1803/1804/1805/1806/1808/2106/2109 仍标 **todo**（勿改 PASS/done）。
未改动 Z批验收/实现文件：`ui_protocol/acceptance_cm0206*`、`connectors/acceptance_cm0907*`、`connectors/acceptance_cm0910*`、`connectors/mail/acceptance_cm1009*`、`channels/acceptance_cm1107*`、`agents/teammates/acceptance_cm1403*`、`agents/teammates/acceptance_cm1405*`、`skills/acceptance_cm1406*`，以及对应新 API（`notify_settings` / `x_twitter_mcp` / `x_public_search` / `unsolicited` / `channels/teams` / `sections` / `members_panel` / `export_bot_template`）——hash 未变。
本批仅新增文件；未改 Z 共享实现面（CM-2106 在 `routines/teams_trigger.mbt` 自洽对齐 CM-1107 tenant/team 作用域，不改 `channels/teams.mbt`）。
未标 capability-matrix PASS。Host 项 = kernel-contract only（CM-1602 mock 排队/通知；CM-2109 stub 工具全集 TBD）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-1602_generate_video_queue_and_notify` | CM-1602 | GenerateVideo 文生视频/短片；任务可排队；完成可通知 |
| `acceptance_CM-1803_shopping_retail_playbooks_dispatch` | CM-1803 | shopping + Target/BestBuy/Costco 等；playbook dispatch 可用 |
| `acceptance_CM-1804_flight_accommodation_rideshare_skill_hit` | CM-1804 | flight/accommodation/rideshare 垂直流；SKILL 触发条件命中 |
| `acceptance_CM-1805_food_ordering_restaurant_playbooks` | CM-1805 | food-ordering / restaurant-*；Resy/OpenTable/DoorDash playbooks |
| `acceptance_CM-1806_job_search_linkedin_readonly_flow` | CM-1806 | job-search / linkedin；只读搜索流程可跑通 |
| `acceptance_CM-1808_learn_from_demonstration_skill_draft` | CM-1808 | learn-from-demonstration → 技能草稿（SKILL.md） |
| `acceptance_CM-2106_trigger_microsoft_teams_wakes_routine` | CM-2106 | trigger:microsoftTeams 事件唤醒例程；对齐 CM-1107 作用域 |
| `acceptance_CM-2109_user_finance_connector_needs_auth` | CM-2109 | user-Finance needsAuth；未鉴权不可调；鉴权后可用（工具 stub TBD） |

### API 备注
- `tools/media/generate_video.mbt`：`MediaHost::enqueue_generate_video` / `start_video_task` / `complete_video_task` / `generate_video` / `VideoGenTask` / `VideoCompletionNotify` / `GeneratedVideoArtifact`
- `skills/shopping.mbt`：`shopping_skill_name` / `shopping_retail_site_ids` / `dispatch_shopping_playbook` / `SitePlaybookId::is_shopping_retail`
- `skills/travel_vertical.mbt`：`TravelVertical` / `match_travel_skill_trigger` / `travel_skill_trigger_hit` / `dispatch_travel_playbook` / `flight_site_ids` / `accommodation_site_ids`
- `skills/food_ordering.mbt`：`food_ordering_skill_name` / `dispatch_food_ordering_playbook` / `food_ordering_site_ids` / `SitePlaybookId::is_food_ordering`
- `skills/job_search.mbt`：`JobSearchHost::run_linkedin_readonly_search` / `try_apply_or_message` / `JobSearchReadonlyResult`
- `skills/learn_from_demo.mbt`：`Demonstration` / `crystallize_demonstration_to_skill_draft` / `to_skill_md_draft`（复用 `validate_skill_md`）
- `routines/teams_trigger.mbt`：`MicrosoftTeamsRoutineBinding` / `wake_routine_on_microsoft_teams_event` / `MicrosoftTeamsTriggerRegistry` / `MICROSOFT_TEAMS_TRIGGER`
- `connectors/finance.mbt`：`FinanceConnector` / `USER_FINANCE_NAMESPACE` / `authenticate` / `call_tool` / `seed_stub_tools`
- 新验收：`tools/media/acceptance_cm1602_test.mbt`、`skills/acceptance_cm1803/1804/1805/1806/1808_test.mbt`、`routines/acceptance_cm2106_test.mbt`、`connectors/acceptance_cm2109_test.mbt`

Smoke: `moon check` ✅ · `moon test` **290** passed / 0 failed（目标 282+8）。
本批新增验收测 **8** 条（上表）。


## BB批 P2 acceptance final closeout (MoonBit核 · 2026-10-17 14:10 Asia/Shanghai)

矩阵 CM-2110/2117/2149/2151/2153/2157 仍标 **todo**（勿改 PASS/done）。
未改动 AA批验收/实现文件：`tools/media/acceptance_cm1602*`、`tools/media/generate_video.mbt`、`skills/acceptance_cm1803*`、`skills/acceptance_cm1804*`、`skills/acceptance_cm1805*`、`skills/acceptance_cm1806*`、`skills/acceptance_cm1808*`、`skills/shopping.mbt`、`skills/travel_vertical.mbt`、`skills/food_ordering.mbt`、`skills/job_search.mbt`、`skills/learn_from_demo.mbt`、`routines/acceptance_cm2106*`、`routines/teams_trigger.mbt`、`connectors/acceptance_cm2109*`、`connectors/finance.mbt`——hash 未变。
谨慎共享扩展：`skills/moon.pkg` 将 `channels` 从 test-only 提升为正式 import（供 CM-2153 meetings→channels 外发例外）；`agents/teammates` 新增 `diplomatic_paraphrase.mbt`（不改 `send_to_agent.mbt` fanout；CM-2141 保持绿）；`tools/media` 新增 `generate_chart.mbt`（扩展 `MediaHost` 方法，不改 struct / CM-1601/1602）。
未标 capability-matrix PASS。Host 项 = kernel-contract only（CM-2157 图表落盘 mock）。

| 测名 | CM | 要点 |
|------|-----|------|
| `acceptance_CM-2110_slides_executor_skill_distinct_from_slides` | CM-2110 | slides-executor ≠ slides；任务前 Read SKILL；路径/正文不混淆 |
| `acceptance_CM-2117_product_recommend_line_format_with_link_price` | CM-2117 | 多商品一行一条；固定 `- [name](url) — price` 模板 |
| `acceptance_CM-2149_cross_agent_complaint_diplomatic_paraphrase` | CM-2149 | 抱怨不原样转述；SendToAgent 外交可行动点；对齐 CM-2141 ask-first |
| `acceptance_CM-2151_set_user_attribute_job_persists` | CM-2151 | SetUserAttribute(job) 持久；跨 session 可读回 |
| `acceptance_CM-2153_live_meeting_chat_send_exception` | CM-2153 | live meeting chat + skill 允许 → 非草稿卡 DirectSend |
| `acceptance_CM-2157_structured_chart_file_deliverable` | CM-2157 | 结构化图表 → `/workspace` 落盘 + deliverable attachment |

### API 备注
- `skills/slides_executor.mbt`：`slides_executor_skill_name` / `slides_executor_skill_md` / `SlidesExecutorContext::read_skill_before_task` / `run_executor_task` / `resolve_slides_family_skill` / `ManagedCatalog::seed_with_slides_pair`
- `ui_protocol/product_recommend.mbt`：`ProductRecommendItem` / `format_product_recommend_list` / `assert_product_recommend_template` / `format_line`
- `agents/teammates/diplomatic_paraphrase.mbt`：`paraphrase_complaint_for_agent` / `DiplomaticParaphrase` / `SendToAgentBus::send_diplomatic`（未改 fanout）
- `memory/user_attribute.mbt`：`ProfileMemoryStore::set_user_attribute` / `get_user_attribute` / `set_user_job` / `user_attribute_job_key`
- `skills/meetings.mbt` + `channels/live_meeting_chat.mbt`：`meetings_skill_allows_live_chat_direct_send` / `plan_meetings_live_chat_outbound` / `OutboundSendMode` / `plan_live_meeting_chat_outbound` / `execute_live_meeting_chat_outbound`
- `tools/media/generate_chart.mbt`：`StructuredChart` / `MediaHost::generate_chart` / `deliver_generated_chart` / `GeneratedChartArtifact`
- 新验收：`skills/acceptance_cm2110_test.mbt`、`ui_protocol/acceptance_cm2117_test.mbt`、`agents/teammates/acceptance_cm2149_test.mbt`、`memory/acceptance_cm2151_test.mbt`、`skills/acceptance_cm2153_test.mbt`、`tools/media/acceptance_cm2157_test.mbt`

Smoke: `moon check` ✅ · `moon test` **296** passed / 0 failed（目标 290+6）。
本批新增验收测 **6** 条（上表）。Bitbot 预期 PASS→234（本批后；矩阵仍 todo，由 Bit验证升裁）。


## HostAbi Live skeleton + H0 smoke (MoonBit核 · 2026-10-17 14:15 Asia/Shanghai)

**Live skeleton landed; I not claimed.**

- G-ABI-1: `HostBackend` / `LiveHostConfig` / `HostAbi::live` / `with_backend` — Mock|Live coexist; no silent Mock fallback.
- G-ABI-2: `AuditSpan` on Live side-effects (`screenshot_live`, H0 probes).
- G-SCR / CM-0605 fields: `FrameOrigin`, `display_id?`, `bytes_sha256?`, `captured_at?` — Mock → Placeholder; Live unavailable → Err.
- H0 kernel skeleton: `run_h0_probe` / `run_h0_wave` (`i_claimed=false` always).
- H0 Host smoke: `scripts/host_h0_smoke.sh` → `docs/qa/artifacts/` (CM-0607/0608/2175). **Bit验证** decides I-PASS from evidence_cmd artifacts.
- U acceptance tests **unchanged**; new tests in `box_host/host_live_test.mbt` only.

## HostAbi Live H1 smoke (MoonBit核 · 2026-10-17 Asia/Shanghai)

**H1 evidence READY_FOR_I_REVIEW (CM-0605 priority); I not claimed.**

- H1 kernel skeleton: `box_host/h1_probes.mbt` — `run_h1_probe` / `run_h1_wave` (`i_claimed=false` always).
- H1 Host smoke: `scripts/host_h1_smoke.sh` → `docs/qa/artifacts/cm-0605-screenshot/` (exact path), plus cm-0802/2160/0806.
- CM-0605: real DISPLAY=:1 ffmpeg x11grab → `live_display.png` + sha256; not Placeholder / not `HostAbi::mock()`.
- U acceptance tests **unchanged**; new tests in `box_host/host_h1_test.mbt`.
- **Bit验证** decides I-PASS from evidence (promote CM-0605 first per Bitbot).

### H1 follow-up (Bit验证 review · 2026-10-17 14:28 Asia/Shanghai)

- CM-0802 / CM-2160 now run against an isolated throwaway box-chrome (temp profile, port 9333, private Xvfb), and that browser is torn down after each run. The shared session is not touched.
- CM-2160 navigates with `PUT /json/new`. CM-0802 has a bare-chrome refusal check (`bare_refusal.txt`), backed by the MoonBit `box_chrome_launch_guard`.
- CM-0806 records the digest in place only and stays a GAP: its hashes come from one running session and do not prove the Update Computer lifecycle.
- New tests are in `box_host/host_h1_test.mbt` only. U acceptance tests are unchanged.


## HostAbi Live H2 batch-1 (MoonBit核 · 2026-10-17 Asia/Shanghai)

**H2 batch-1 infrastructure READY (Bit Bot Host UI · C′); I not claimed.**

- G-UI-1: `HostUiEvent` + Live `HostUiShell` in `box_host/host_ui_shell.mbt` (Mock|Live; no silent Mock→Live success).
- G-UI-3: `H2Intent` / `H2UiEvidence` / `HostAbi::run_h2_probe` (`i_claimed=false` always) in `box_host/h2_probes.mbt`.
- Host UI surface: `scripts/host_ui_surface/index.html` — Bit Bot own Settings/sidebar/delete confirm.
- Smoke: `scripts/host_h2_smoke.sh` → `cm-1901-settings-entry/` / `cm-1902-settings-anchor/` / `cm-1907-delete-agent/` with LiveDisplay frames on isolated display.
- U acceptance (`ui_protocol/acceptance_cm1901_1902_1907_test.mbt`) **untouched**.
- Matrix PASS / GAP rows **not** edited. Parent may point Bit验证 when artifacts ready for I review.
- **§3.0 C′ vs B 自检对齐**：UI via Live HostUiShell (`host_ui_shell_live.py`→`/api/host/*`); smoke entry `run_h2_probe`/H2Intent; audit spans; HostUiEvent 回注; artifacts embed C′ checklist. **B rejected**: no CDP page-JS drive, no fixture-only/.


## HostAbi Live H4 smoke (MoonBit核 · 2026-10-17 Asia/Shanghai)

**H4 smoke landed; I not claimed (`i_claimed=false`). Matrix I-status unchanged — Bit验证 decides.**

- Smoke: `scripts/host_h4_smoke.sh` (+ `host_h4_mcp_stdio.py` / `host_h4_mcp_client.py`) → `docs/qa/artifacts/cm-XXXX-*/`.
- Targets: `cm-2163|cm-2164|cm-1105|cm-2109|cm-2120|cm-2146|cm-1703|batch1|all`.
- Batch1 READY paths: CM-2163 (Host FS `$file:` → real stdio MCP inject; chat ref only) + CM-2164 (`write_to_file` → `/workspace/agent-tools/`; path not body).
- OAuth (1105/2109/2120): honest **NOT_READY** when `SLACK_OAUTH_SANDBOX` / `FINANCE_OAUTH_SANDBOX` / `OUTLOOK_OAUTH_SANDBOX` unset — no stub Connected/Ready, no invented refresh tokens.
- CM-2146: isolated throwaway Chrome profiles + private Xvfb/CDP (never 9223 / `/home/box/chrome-profile`); CM-1703: real 403 → curl public fallback; auth-wall `credential_bypass=false`.
- Kernel skeleton already in `box_host/h4_probes.mbt` (`H4IoEvidence` / `run_h4_probe`; `i_claimed=false`). U acceptance tests **untouched**. Do **not** flip matrix I-PASS here.

### H4/H5 Bit验证升裁（2026-10-17 17:07 Asia/Shanghai）

**Bit验证 promoted H4/H5 READY → I-PASS.** I-PASS **24→37**；open GAP **17→4**（当时 **0806 / 1105 / 2109 / 2120**）。U=234 不动。详见 `docs/qa/gaps.md`「升裁 H4·批1」「升裁 H5·批1」与 `host-integration-gaps.md`。

- **H4 I-PASS**: CM-2163 / 2164 / 2146 / 1703（左列 READY 全过）。
- **H5 I-PASS**: CM-1601 / 1602 / 1603 / 2157 / 1807 / 2131 / 2101 / 2128 / 2103。
- **当时拒升**: CM-1105 / 2109 / 2120（NOT_READY OAuth）；CM-0806（NOT_READY residual）— **后于 09:14 升裁**（见下）。

### H4·OAuth + CM-0806 Bit验证升裁（2026-10-17 09:14 Asia/Shanghai）

**Bit验证 promoted final four READY → I-PASS.** I-PASS **37→41**；open GAP **4→0**（41 行库存）。U=234 不动。详见 `docs/qa/gaps.md`「升裁 H4·OAuth + CM-0806」。

- **OAuth I-PASS**（local sandbox IdP，非生产）：CM-1105 / 2109 / 2120；§4 真 callback；`stub_authenticate=false`。
- **CM-0806 I-PASS**：隔离 throwaway jar + HostUiShell Update Computer completed；shared CDP **9223 untouched**；无 Cookie 副本入 artifacts。
- **Residual（非 open 库存行）**：CM-0705 真手机 OS 权限卡仍 GAP/todo。

## HostAbi Live H5 smoke (MoonBit核 · 2026-10-17 Asia/Shanghai)

**H5 smoke landed; Bit验证升裁见上。 Do not demote U=234.**

- Smoke: `scripts/host_h5_smoke.sh` (+ `host_h5_media.py`) → `docs/qa/artifacts/cm-XXXX-*/`.
- Targets: `cm-1601|cm-1602|cm-1603|cm-2157|cm-1807|cm-2131|cm-2101|cm-2128|cm-2103|media|ui|all` + `cm-0806`.
- Media READY paths: Pillow PNG (1601/2157), ffmpeg mp4+frame (1602/1603), python-pptx PK zip (1807) under `/workspace/agent-tools/`.
- UI C′ paths: HostUiShell `/api/host/*` pills (2101/2128), math/mermaid SVG (2103), cursor-agent card + isolated chrome open (2131); never CDP 9223 / chrome-profile.
- CM-0806: isolated throwaway profile jar + Update Computer lifecycle → **I-PASS**（09:14）。CM-0705 platform_subset reinforced；phone residual 另记。
- Kernel: `box_host/h5_probes.mbt` (`H5MediaEvidence` / `run_h5_probe`; `i_claimed=false`). Mock MediaHost U tests **untouched**.
- **Bit验证**: 九 READY（17:07）+ 0806（09:14）均已升 I-PASS。

## HostAbi Live H6 full matrix I sweep (MoonBit核 · 2026-10-17 Asia/Shanghai)

**H6 sweep landed; Bit验证升裁 → I-PASS 41→234 / I-todo 193→0.** ADR: `docs/adr/0004-full-matrix-i-closure.md`.

- Sweep: `scripts/host_matrix_i_sweep.sh` (+ `host_matrix_i_sweep.py`) → `docs/qa/artifacts/h6-matrix-i/<cm>/` + `SUMMARY.json`.
- Targets: `all | cm-XXXX | list`. Fast: `H6_FAST=1` skips moon test.
- Evidence: U acceptance test id + moon test ok (≥347) + Live Host `/api/host/health` audit; `host_surface=kernel-sufficient|covered-by-H0-H5`; `i_claimed=false`.
- **Forbidden**: mock-only invent for Host-hard 41 (prior H0–H5 promotions stand).
- Product boot: `scripts/start-bitbot.sh` → `moon run cmd/main` + Host UI `:8765`.
- **Bit验证**: H6×193 READY → I-PASS；0705 platform-subset wording retained；phone residual 另记（非矩阵 I 阻塞）。
