# 契约层能力清单（已实现且有证据，但未接入生产路径）

> 生成物：`node scripts/prove_contract_layer.mjs --list` · 门禁：`node scripts/prove_contract_layer.mjs`
> 更新：2026-10-31

## 这份清单是什么

能力矩阵 `docs/capability-matrix.md` 里有一批行，状态是 PASS，证据测试也确实存在、
也确实通过。但这些能力的**实现没有任何生产调用者**——用户走产品路径时够不到它们。

这类代码既不是死代码（删掉会让矩阵的 PASS 行变成假账），也不是已交付的能力
（它在产品里不可达）。把它单列出来，是为了不假装它已经交付。

本次架构评审把"CI 测的代码路径 ≠ 产品发布的路径"列为阻断级问题，根因之一就是
这类契约层：测试覆盖它们，所以 CI 是绿的；产品路径不经过它们，所以它们不在产品里。

## 为什么不能直接删

- 能力矩阵是**合同**：缺行 = 架构/实现缺陷，不是可砍 backlog。删掉实现会让 PASS 行失真。
- 这些实现本身就是该能力的**规格**（spec-as-code）：它们定义了应有的行为，
  接入生产路径时可以直接照着接。

## 为什么也不能算"已交付"

- 矩阵的 I-status 列（Host 集成态）对这些行没有区分，读者容易把「状态=PASS」
  读成「用户能用」。实际不能。

## 正确处置

1. **接入生产路径**（首选）：让矩阵的 PASS 行名副其实。这是行为变更，需要单独排期。
2. **显式标注**：在矩阵里把这类行标出来，别让读者误读。

## 当前清单（56 个文件 / 5816 行）

| 文件 | 行数 | 关联 CM |
|------|------|---------|
| `agents/cloud/github_mcp.mbt` | 89 | CM-0908 CM-0909 |
| `agents/cloud/origin_align.mbt` | 62 | CM-1303 |
| `agents/computer_use/box_chrome_launch.mbt` | 50 | CM-0802 |
| `agents/computer_use/box_help_handoff.mbt` | 10 | CM-0805 |
| `agents/computer_use/navigate.mbt` | 69 | CM-2160 |
| `agents/computer_use/playbook_dispatch.mbt` | 55 | CM-0507 |
| `agents/computer_use/task_outcome.mbt` | 35 | CM-1202 |
| `agents/task/parallel_spawn.mbt` | 60 | CM-2161 |
| `agents/teammates/diplomatic_paraphrase.mbt` | 137 | CM-2149 |
| `box_host/box_clock.mbt` | 75 | CM-2175 |
| `box_host/box_doctor.mbt` | 147 | CM-0607 |
| `box_host/package_install.mbt` | 117 | CM-2158 |
| `box_host/shared_box_charter.mbt` | 68 | CM-2174 |
| `channels/identity.mbt` | 129 | CM-2168 |
| `connectors/mail/claim_first_start.mbt` | 122 | CM-2006 |
| `connectors/mail/inbound_wake.mbt` | 121 | CM-2127 |
| `connectors/mail/mailbox_draft.mbt` | 133 | CM-1007 |
| `connectors/mail/outlook.mbt` | 150 | CM-2120 |
| `connectors/mail/plus_tag.mbt` | 123 | CM-1008 |
| `connectors/mail/verbatim_send.mbt` | 98 | CM-2142 |
| `connectors/x_rate_limit.mbt` | 152 | CM-2132 |
| `connectors/x_twitter_mcp.mbt` | 230 | CM-0907 |
| `memory/authoritative.mbt` | 74 | CM-2145 |
| `memory/forget.mbt` | 19 | CM-0304 CM-0305 |
| `memory/user_attribute.mbt` | 56 | CM-2151 |
| `routines/confirm.mbt` | 147 | CM-0415 |
| `routines/cron_phase.mbt` | 193 | CM-0403 CM-0404 CM-0405 CM-2105 |
| `routines/origin_trigger_subset.mbt` | 91 | CM-2155 |
| `routines/silence.mbt` | 155 | CM-2165 CM-2166 |
| `runtime/automation_status.mbt` | 188 | CM-0417 CM-2001 CM-2007 CM-2008 |
| `runtime/autonomy.mbt` | 68 | CM-2138 CM-2139 CM-2140 |
| `runtime/autoreview_exception.mbt` | 44 | CM-1505 CM-1506 |
| `runtime/cue.mbt` | 67 | CM-2003 |
| `runtime/honesty.mbt` | 80 | CM-2138 CM-2139 CM-2140 |
| `runtime/identity.mbt` | 56 | CM-2001 CM-2007 CM-2008 |
| `runtime/inbound_agent.mbt` | 111 | CM-2152 CM-2154 |
| `runtime/language.mbt` | 77 | CM-2002 |
| `runtime/onboarding.mbt` | 89 | CM-2152 CM-2154 |
| `runtime/parallel_tools.mbt` | 136 | CM-2104 |
| `runtime/secret_guard.mbt` | 64 | CM-1505 CM-1506 |
| `runtime/smart_mode.mbt` | 53 | CM-1502 CM-1503 |
| `runtime/step_effects.mbt` | 45 | CM-2138 CM-2139 CM-2140 |
| `runtime/style_guide.mbt` | 130 | CM-2156 |
| `runtime/timezone_report.mbt` | 26 | CM-2001 CM-2007 CM-2008 |
| `runtime/voice_memo.mbt` | 116 | CM-0107 |
| `security/effect_planner.mbt` | 87 | CM-0306 CM-1501 CM-1504 |
| `security/executor_draft_parent.mbt` | 53 | CM-2176 CM-2177 |
| `security/permission_source.mbt` | 108 | CM-2176 CM-2177 |
| `security/safer_path.mbt` | 102 | CM-2162 CM-2169 CM-2170 |
| `security/teammate_outbound.mbt` | 128 | CM-2172 |
| `skills/slides_executor.mbt` | 122 | CM-2110 |
| `tools/mcp_host_file.mbt` | 383 | CM-2163 CM-2164 |
| `tools/namespace_status.mbt` | 139 | CM-0901 CM-0903 CM-0905 CM-2134 |
| `ui_protocol/avatar.mbt` | 82 | CM-0202 |
| `ui_protocol/product_recommend.mbt` | 129 | CM-2117 |
| `ui_protocol/react_to_message.mbt` | 166 | CM-2101 CM-2128 |

## 怎么读这张表

- **行数**：该文件的有效行数（`wc -l`）。
- **关联 CM**：能力矩阵里由该文件实现、且证据测试落在该文件上的能力 ID。

## 变更这张表的方式

1. 把某条能力接进生产路径 → 该文件的生产调用者出现 → 它自动从清单里消失，
   门禁会要求你同时从本文删除对应行。
2. 新增一个"只有验收测试调用"的实现 → 它自动进入清单 → 门禁会要求你在本文补一行。

两个方向都会让门禁变红，所以这份清单既不会漏记已交付的能力，也不会长期挂着
已经不成立的说法。
