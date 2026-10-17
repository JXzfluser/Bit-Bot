# CM-0204 host-integration evidence (H2 · C′ · §3.0)

| field | value |
|-------|-------|
| CM | CM-0204 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-0204` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0204-hidden-agent` |
| env | Bit Bot Host process + Live HostUiShell; private Xvfb; USER_IANA=Asia/Shanghai; stamp_utc=20261017T071831Z; shared_cdp_9223=untouched |
| assert | C′: HostUiShell set_agent_hidden→address_agent; hidden agent absent from main sidebar list yet addressable (chat header); SidebarListChanged/SidebarHiddenAgentAddressable; LiveDisplay |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | **I not claimed**. Bit验证 decides I-PASS. Contra §3.0 **B** (no CDP page-JS drive, no fixture-only/, no synthetic PNG). |

## §3.0 C′ vs B 自检（对照 interface-gaps §3.0）

| 维度 | C′ 要求 | 本产物 |
|------|---------|--------|
| UI 驱动 | 经 Live **HostUiShell** 方法 | **PASS** — `host_ui_shell_live.py` → `/api/host/*` (open_settings / delete / update_computer / reset / local_execution) |
| smoke 入口 | 只经 HostAbi / `run_h2_probe` 路径 | **PASS** — H2Intent CM-0204 via Live HostUiShell adapter (same mapping as `HostAbi::run_h2_probe`) |
| 审计 | Live audit span | **PASS** — `audit_spans.jsonl` + `/api/host/audit` |
| 事件回注 | Host→Kernel **HostUiEvent** | **PASS** — `host_ui_events.json` (SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged) |
| 产物标注 | 正规目录 + LiveDisplay | **PASS** — not `fixture-only/`; `frame_origin=LiveDisplay` |

## Audit spans (cite by span_id)

| span_id | tool | ok | detail |
|---------|------|----|--------|
| `5aaf99e7-863a-4186-aa78-0e21964dd9d4` | host_ui:set_agent_hidden | True | agent=h2-hidden-agent hidden=False sidebar=['h2-throwaway-agent', 'demo-agent', 'h2-hidden-agent'] |
| `6da8c767-1470-4e81-9cc8-889881d9698d` | host_ui:set_agent_hidden | True | agent=h2-hidden-agent hidden=True sidebar=['h2-throwaway-agent', 'demo-agent'] |
| `8257beb5-ea29-48b3-a805-59b99167b52f` | host_ui:address_agent | True | addressed agent=h2-hidden-agent hidden=True in_sidebar=False; event=SidebarHiddenAgentAddressable |

## Probe asserts

```
check_visible_before=True (want True)
check_in_sidebar_after_hide=False (want False)
check_addressable_hidden=True (want True)
check_addressed_in_sidebar=False (want False)
check_event_sidebar_hidden_addressable=True (want True)
md5_sidebar_before=fdfd31007f828e4c2fea3581486efd6c
md5_sidebar_hidden=1cfc2c227a21e7718c8aa6df2383320b
md5_addressed_hidden=017e5ac043741752e256e26873adafb3
frames_distinct=true
```
