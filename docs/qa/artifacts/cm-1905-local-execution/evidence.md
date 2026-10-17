# CM-1905 host-integration evidence (H2 · C′ · §3.0)

| field | value |
|-------|-------|
| CM | CM-1905 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h2_smoke.sh cm-1905` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-1905-local-execution` |
| env | Bit Bot Host process + Live HostUiShell; private Xvfb; USER_IANA=Asia/Shanghai; stamp_utc=20261017T070855Z; shared_cdp_9223=untouched |
| assert | C′: Live HostUiShell set_local_execution(off) then try_machine_call refused; gate log + LiveDisplay; LocalExecutionGateChanged |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | **I not claimed**. Bit验证 decides I-PASS. Contra §3.0 **B** (no CDP page-JS drive, no fixture-only/, no synthetic PNG). |

## §3.0 C′ vs B 自检（对照 interface-gaps §3.0）

| 维度 | C′ 要求 | 本产物 |
|------|---------|--------|
| UI 驱动 | 经 Live **HostUiShell** 方法 | **PASS** — `host_ui_shell_live.py` → `/api/host/*` (open_settings / delete / update_computer / reset / local_execution) |
| smoke 入口 | 只经 HostAbi / `run_h2_probe` 路径 | **PASS** — H2Intent CM-1905 via Live HostUiShell adapter (same mapping as `HostAbi::run_h2_probe`) |
| 审计 | Live audit span | **PASS** — `audit_spans.jsonl` + `/api/host/audit` |
| 事件回注 | Host→Kernel **HostUiEvent** | **PASS** — `host_ui_events.json` (SettingsOpened / SettingsAnchorVisible / DeleteAgentPhaseChanged) |
| 产物标注 | 正规目录 + LiveDisplay | **PASS** — not `fixture-only/`; `frame_origin=LiveDisplay` |

