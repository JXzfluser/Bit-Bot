# CM-0705 host-integration evidence (H3 · Host FFI · §5)

| field | value |
|-------|-------|
| CM | CM-0705 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0705` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0705-device-local-tools` |
| env | box Live Host FFI; USER_IANA=Asia/Shanghai; stamp_utc=20261017T072018Z; shared_cdp_9223=untouched |
| assert | platform_subset=desktop_no_device_local_tools + desktop tools empty; phone OS dialog residual GAP; i_claimed=false |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h3_smoke.sh — **not** HostAbi::mock(). Bit验证 decides I-PASS. |

