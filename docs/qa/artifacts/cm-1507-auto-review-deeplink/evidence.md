# CM-1507 host-integration evidence (H2 · C′ · §3.0)

| field | value |
|-------|-------|
| CM | CM-1507 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1507` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-1507-auto-review-deeplink` |
| env | Bit Bot Host process + Live HostUiShell; private Xvfb; USER_IANA=Asia/Shanghai; stamp_utc=20261017T071823Z; shared_cdp_9223=untouched |
| assert | C′: deep-link anchors auto-review / auto-review-rules / security-keys via HostUiShell; page→Host viewport receipt {anchor_id,scrollTop,boundingRect,highlighted}; assert inViewport; SettingsAnchorVisible; LiveDisplay |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | **I not claimed**. Bit验证 decides I-PASS. Contra §3.0 **B** (no CDP page-JS drive, no fixture-only/, no synthetic PNG). |

## §3.0 C′ vs B 自检（对照 interface-gaps §3.0）

| 维度 | C′ 要求 | 本产物 |
|------|---------|--------|
| UI 驱动 | 经 Live **HostUiShell** 方法 | **PASS** — `host_ui_shell_live.py` → `/api/host/*` (open_settings / delete / update_computer / reset / local_execution) |
| smoke 入口 | 只经 HostAbi / `run_h2_probe` 路径 | **PASS** — H2Intent CM-1507 via Live HostUiShell adapter (same mapping as `HostAbi::run_h2_probe`) |
| 审计 | Live audit span | **PASS** — `audit_spans.jsonl` + `/api/host/audit` |
| 事件回注 | Host→Kernel **HostUiEvent** | **PASS** — `host_ui_events.json` (SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged) |
| 产物标注 | 正规目录 + LiveDisplay | **PASS** — not `fixture-only/`; `frame_origin=LiveDisplay` |

## Audit spans (cite by span_id)

| span_id | tool | ok | detail |
|---------|------|----|--------|
| `9c1fc677-f626-4708-a674-910b3c6f21ef` | host_ui:open_settings | True | SettingsOpened entry=command-palette anchor=auto-review |
| `0490cc40-4809-48ab-93e7-a068daee65d7` | host_ui:settings_anchor_visible | True | SettingsAnchorVisible anchor=auto-review |
| `e1bf38de-e243-4af0-b53d-2aaf83583954` | host_ui:open_settings | True | SettingsOpened entry=command-palette anchor=auto-review-rules |
| `439599b6-90a5-4823-b098-9a40671c6c92` | host_ui:settings_anchor_visible | True | SettingsAnchorVisible anchor=auto-review-rules |
| `00e32899-1c3b-41cf-ab3d-e59cea9a96be` | host_ui:open_settings | True | SettingsOpened entry=command-palette anchor=security-keys |
| `09c2a9d5-990f-47c9-b067-cb5853534448` | host_ui:settings_anchor_visible | True | SettingsAnchorVisible anchor=security-keys |

## Probe asserts

```
check_anchor_auto-review=auto-review@General (want auto-review@General)
check_vp_id_auto-review=auto-review (want auto-review)
check_vp_highlighted_auto-review=true (want true)
check_vp_in_viewport_auto-review=true (want true)
check_vp_scrollTop_auto-review=true (want true)
check_vp_rect_auto-review=true (want true)
check_anchor_auto-review-rules=auto-review-rules@General (want auto-review-rules@General)
check_vp_id_auto-review-rules=auto-review-rules (want auto-review-rules)
check_vp_highlighted_auto-review-rules=true (want true)
check_vp_in_viewport_auto-review-rules=true (want true)
check_vp_scrollTop_auto-review-rules=true (want true)
check_vp_rect_auto-review-rules=true (want true)
check_anchor_security-keys=security-keys@General (want security-keys@General)
check_vp_id_security-keys=security-keys (want security-keys)
check_vp_highlighted_security-keys=true (want true)
check_vp_in_viewport_security-keys=true (want true)
check_vp_scrollTop_security-keys=true (want true)
check_vp_rect_security-keys=true (want true)
md5_auto-review=31fcb5bdda52e6fc6b24ed43f85019fd
md5_auto-review-rules=f4019542b62f2e3461de35cc562e5b54
md5_security-keys=0d3dfdf2831755465251cdfcd4666b18
frames_distinct=true
```
