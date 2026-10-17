# CM-2178 host-integration evidence (H2 · C′ · §3.0)

| field | value |
|-------|-------|
| CM | CM-2178 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-2178` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-2178-permission-guide-settings` |
| env | Bit Bot Host process + Live HostUiShell; private Xvfb; USER_IANA=Asia/Shanghai; stamp_utc=20261017T070855Z; shared_cdp_9223=untouched |
| assert | C′: missing-permission guide (user-Gmail needs auth) shown 'Not connected'; following it really opens Settings at account anchor; status stays not connected; PermissionGuideShown(pretends_connected=false); LiveDisplay |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | **I not claimed**. Bit验证 decides I-PASS. Contra §3.0 **B** (no CDP page-JS drive, no fixture-only/, no synthetic PNG). |

## §3.0 C′ vs B 自检（对照 interface-gaps §3.0）

| 维度 | C′ 要求 | 本产物 |
|------|---------|--------|
| UI 驱动 | 经 Live **HostUiShell** 方法 | **PASS** — `host_ui_shell_live.py` → `/api/host/*` (open_settings / delete / update_computer / reset / local_execution) |
| smoke 入口 | 只经 HostAbi / `run_h2_probe` 路径 | **PASS** — H2Intent CM-2178 via Live HostUiShell adapter (same mapping as `HostAbi::run_h2_probe`) |
| 审计 | Live audit span | **PASS** — `audit_spans.jsonl` + `/api/host/audit` |
| 事件回注 | Host→Kernel **HostUiEvent** | **PASS** — `host_ui_events.json` (SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged) |
| 产物标注 | 正规目录 + LiveDisplay | **PASS** — not `fixture-only/`; `frame_origin=LiveDisplay` |

## Audit spans (cite by span_id)

| span_id | tool | ok | detail |
|---------|------|----|--------|
| `a44e92bf-3280-45b7-bf1f-36094580fd0c` | host_ui:show_permission_guide | True | guide kind=connector-needs-auth ns=user-Gmail anchor=account connected=False |
| `de387b8b-d7b3-4aa1-9753-789b553b8bfa` | host_ui:follow_permission_guide | True | Settings opened at account via guide; connector still not connected |

## Probe asserts

```
check_guide_not_connected=False (want False)
check_settings_open=True (want True)
check_settings_anchor=account (want account)
check_still_not_connected=False (want False)
check_no_pretend_event=True (want True)
check_opened_via_guide=True (want True)
md5_guide_card=b69e2288746175d0bf8a069383a88dc7
md5_settings_opened=bd2562663a7b9def7d7d7b6d58c4a724
frames_distinct=true
```
