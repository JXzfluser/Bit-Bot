# CM-0205 host-integration evidence (H2 · C′ · §3.0)

| field | value |
|-------|-------|
| CM | CM-0205 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-0205` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0205-info-panel` |
| env | Bit Bot Host process + Live HostUiShell; private Xvfb; USER_IANA=Asia/Shanghai; stamp_utc=20261017T070855Z; shared_cdp_9223=untouched |
| assert | C′: HostUiShell open_info_panel → five sections (desktop-preview/routines/channels/members/gear-settings) with settingsOpen=false; global Settings separate frame; InfoPanelOpened; LiveDisplay |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | **I not claimed**. Bit验证 decides I-PASS. Contra §3.0 **B** (no CDP page-JS drive, no fixture-only/, no synthetic PNG). |

## §3.0 C′ vs B 自检（对照 interface-gaps §3.0）

| 维度 | C′ 要求 | 本产物 |
|------|---------|--------|
| UI 驱动 | 经 Live **HostUiShell** 方法 | **PASS** — `host_ui_shell_live.py` → `/api/host/*` (open_settings / delete / update_computer / reset / local_execution) |
| smoke 入口 | 只经 HostAbi / `run_h2_probe` 路径 | **PASS** — H2Intent CM-0205 via Live HostUiShell adapter (same mapping as `HostAbi::run_h2_probe`) |
| 审计 | Live audit span | **PASS** — `audit_spans.jsonl` + `/api/host/audit` |
| 事件回注 | Host→Kernel **HostUiEvent** | **PASS** — `host_ui_events.json` (SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged) |
| 产物标注 | 正规目录 + LiveDisplay | **PASS** — not `fixture-only/`; `frame_origin=LiveDisplay` |

## Audit spans (cite by span_id)

| span_id | tool | ok | detail |
|---------|------|----|--------|
| `17e5bead-d3d5-4fcc-8866-0c46a7d539ee` | host_ui:open_info_panel | True | agent=h2-throwaway-agent view=panel members=[] settingsOpen=False |
| `35dde3a9-0c4a-4e9c-9400-5ab3f8cbe1de` | host_ui:open_settings | True | SettingsOpened entry=sidebar-account-button anchor=none |

## Probe asserts

```
check_sections=desktop-preview,routines,channels,members,gear-settings (want desktop-preview,routines,channels,members,gear-settings)
check_info_not_settings=False (want False)
check_settings_closes_info=False (want False)
md5_info_panel=f40adf7c7fea16ffd5486fbe5860a2b9
md5_global_settings=65e7f1dbe4547dad1fc6f235b822ef21
frames_distinct=true
```
