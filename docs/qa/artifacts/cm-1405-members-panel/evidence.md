# CM-1405 host-integration evidence (H2 · C′ · §3.0)

| field | value |
|-------|-------|
| CM | CM-1405 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1405` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-1405-members-panel` |
| env | Bit Bot Host process + Live HostUiShell; private Xvfb; USER_IANA=Asia/Shanghai; stamp_utc=20261017T070855Z; shared_cdp_9223=untouched |
| assert | C′: Members section (anchor 'members') inside per-agent info pane for group chat, per app-ui.md; five sections intact; member ids match; LiveDisplay |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | **I not claimed**. Bit验证 decides I-PASS. Contra §3.0 **B** (no CDP page-JS drive, no fixture-only/, no synthetic PNG). |

## §3.0 C′ vs B 自检（对照 interface-gaps §3.0）

| 维度 | C′ 要求 | 本产物 |
|------|---------|--------|
| UI 驱动 | 经 Live **HostUiShell** 方法 | **PASS** — `host_ui_shell_live.py` → `/api/host/*` (open_settings / delete / update_computer / reset / local_execution) |
| smoke 入口 | 只经 HostAbi / `run_h2_probe` 路径 | **PASS** — H2Intent CM-1405 via Live HostUiShell adapter (same mapping as `HostAbi::run_h2_probe`) |
| 审计 | Live audit span | **PASS** — `audit_spans.jsonl` + `/api/host/audit` |
| 事件回注 | Host→Kernel **HostUiEvent** | **PASS** — `host_ui_events.json` (SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged) |
| 产物标注 | 正规目录 + LiveDisplay | **PASS** — not `fixture-only/`; `frame_origin=LiveDisplay` |

## Audit spans (cite by span_id)

| span_id | tool | ok | detail |
|---------|------|----|--------|
| `8355094b-b340-4574-8ccd-a01a84f3e158` | host_ui:open_info_panel | True | agent=h2-throwaway-agent view=panel members=[] settingsOpen=False |
| `26182771-2dff-48c5-bf1a-10c7601502e9` | host_ui:open_info_panel | True | agent=h2-group view=panel members=['h2-throwaway-agent', 'demo-agent'] settingsOpen=False |

## Probe asserts

```
check_members_anchor_in_sections=True (want True)
check_sections=desktop-preview,routines,channels,members,gear-settings (want desktop-preview,routines,channels,members,gear-settings)
check_member_ids=h2-throwaway-agent,demo-agent (want h2-throwaway-agent,demo-agent)
check_in_info_pane_not_settings=False (want False)
md5_info_single_agent=f40adf7c7fea16ffd5486fbe5860a2b9
md5_members_panel=941f048a390063013293733eb48ccac9
frames_distinct=true
```
