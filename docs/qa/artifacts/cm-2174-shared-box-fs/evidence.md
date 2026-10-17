# CM-2174 host-integration evidence (H3 · Host FFI · §5)

| field | value |
|-------|-------|
| CM | CM-2174 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2174` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-2174-shared-box-fs` |
| env | box Live Host FFI; USER_IANA=Asia/Shanghai; stamp_utc=20261017T072018Z; shared_cdp_9223=untouched |
| assert | dual Live sessions: A reads B write on /workspace/h3-cross-agent-shared.txt; displays :40!=:41; not mock self-rw |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h3_smoke.sh — **not** HostAbi::mock(). Bit验证 decides I-PASS. |

