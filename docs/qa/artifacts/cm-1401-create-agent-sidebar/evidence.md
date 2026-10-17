# CM-1401 host-integration evidence (H2 · C′ · §3.0)

| field | value |
|-------|-------|
| CM | CM-1401 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1401` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-1401-create-agent-sidebar` |
| env | Bit Bot Host process + Live HostUiShell; private Xvfb; USER_IANA=Asia/Shanghai; stamp_utc=20261017T070855Z; shared_cdp_9223=untouched |
| assert | C′: HostUiShell create_agent (throwaway h2-created-agent) → real sidebar row; open_members_panel shows it in Members; AgentCreated/SidebarListChanged/MembersPanelVisible; LiveDisplay |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | **I not claimed**. Bit验证 decides I-PASS. Contra §3.0 **B** (no CDP page-JS drive, no fixture-only/, no synthetic PNG). |

## §3.0 C′ vs B 自检（对照 interface-gaps §3.0）

| 维度 | C′ 要求 | 本产物 |
|------|---------|--------|
| UI 驱动 | 经 Live **HostUiShell** 方法 | **PASS** — `host_ui_shell_live.py` → `/api/host/*` (open_settings / delete / update_computer / reset / local_execution) |
| smoke 入口 | 只经 HostAbi / `run_h2_probe` 路径 | **PASS** — H2Intent CM-1401 via Live HostUiShell adapter (same mapping as `HostAbi::run_h2_probe`) |
| 审计 | Live audit span | **PASS** — `audit_spans.jsonl` + `/api/host/audit` |
| 事件回注 | Host→Kernel **HostUiEvent** | **PASS** — `host_ui_events.json` (SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged) |
| 产物标注 | 正规目录 + LiveDisplay | **PASS** — not `fixture-only/`; `frame_origin=LiveDisplay` |

## Audit spans (cite by span_id)

| span_id | tool | ok | detail |
|---------|------|----|--------|
| `b80405be-34da-4a4e-93c6-aaca812fe73e` | host_ui:address_agent | True | addressed agent=h2-throwaway-agent hidden=False in_sidebar=True |
| `81b00a84-ada0-45d6-86ce-e2134882eba7` | host_ui:create_agent | True | created h2-created-agent; sidebar=['h2-throwaway-agent', 'demo-agent', 'h2-created-agent'] |
| `72731bae-c611-42f4-b1d8-eb8e9b56d752` | host_ui:open_info_panel | True | agent=h2-group view=panel members=['h2-throwaway-agent', 'h2-created-agent'] settingsOpen=False |

## Probe asserts

```
check_absent_before=False (want False)
check_in_sidebar_after=True (want True)
check_in_members=True (want True)
check_members_event=True (want True)
md5_before_create=d3cdb5648d2806cae97d3baa51a92f0d
md5_after_create_sidebar=e3ca8c9d5e1a129b2c10350383a6f8b5
md5_after_create_members=224f314f1ce0341ad75c32b541b0037b
frames_distinct=true
```
