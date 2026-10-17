# CM-0206 host-integration evidence (H2 · C′ · §3.0)

| field | value |
|-------|-------|
| CM | CM-0206 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-0206` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0206-notify-toggles` |
| env | Bit Bot Host process + Live HostUiShell; private Xvfb; USER_IANA=Asia/Shanghai; stamp_utc=20261017T070855Z; shared_cdp_9223=untouched |
| assert | C′: per-agent gear subpage via HostUiShell open_agent_settings; set_agent_notify on agent A (sound off, mentions-only on) leaves agent B defaults; AgentNotifyToggleChanged; LiveDisplay |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | **I not claimed**. Bit验证 decides I-PASS. Contra §3.0 **B** (no CDP page-JS drive, no fixture-only/, no synthetic PNG). |

## §3.0 C′ vs B 自检（对照 interface-gaps §3.0）

| 维度 | C′ 要求 | 本产物 |
|------|---------|--------|
| UI 驱动 | 经 Live **HostUiShell** 方法 | **PASS** — `host_ui_shell_live.py` → `/api/host/*` (open_settings / delete / update_computer / reset / local_execution) |
| smoke 入口 | 只经 HostAbi / `run_h2_probe` 路径 | **PASS** — H2Intent CM-0206 via Live HostUiShell adapter (same mapping as `HostAbi::run_h2_probe`) |
| 审计 | Live audit span | **PASS** — `audit_spans.jsonl` + `/api/host/audit` |
| 事件回注 | Host→Kernel **HostUiEvent** | **PASS** — `host_ui_events.json` (SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged) |
| 产物标注 | 正规目录 + LiveDisplay | **PASS** — not `fixture-only/`; `frame_origin=LiveDisplay` |

## Audit spans (cite by span_id)

| span_id | tool | ok | detail |
|---------|------|----|--------|
| `8598bdd9-6578-444a-b90f-856e5341f2e9` | host_ui:open_agent_settings | True | agent=h2-throwaway-agent view=gear members=[] settingsOpen=False |
| `454b8880-4657-477a-b422-6c372efc3a66` | host_ui:set_agent_notify | True | agent=h2-throwaway-agent notify.sound=False |
| `0d33382a-1755-4429-92ad-d82720dbcff4` | host_ui:set_agent_notify | True | agent=h2-throwaway-agent notify.mentions-only=True |
| `d4184e9f-1ab0-4331-9288-b183a70ba29c` | host_ui:open_agent_settings | True | agent=demo-agent view=gear members=[] settingsOpen=False |

## Probe asserts

```
check_a_sound=False (want False)
check_a_mentions_only=True (want True)
check_b_sound_isolated=True (want True)
check_b_mentions_isolated=False (want False)
check_not_global_settings=False (want False)
md5_agent_a_defaults=77548b97ca2e014c97f99c1202a15f84
md5_agent_a_toggled=89372786716c39502d8ab85daa3b990f
md5_agent_b_defaults=cf7062f178a6bfd305a3e213d09d8c47
frames_distinct=true
```
