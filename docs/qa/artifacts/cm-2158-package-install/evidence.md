# CM-2158 host-integration evidence (H3 · Host FFI · §5)

| field | value |
|-------|-------|
| CM | CM-2158 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-2158` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-2158-package-install` |
| env | box Live Host FFI; USER_IANA=Asia/Shanghai; stamp_utc=20261017T072018Z; shared_cdp_9223=untouched |
| assert | Live Shell npm (sandbox left-pad); shell.meta pid/exit; non_shell_refusal; audit span; i_claimed=false |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h3_smoke.sh — **not** HostAbi::mock(). Bit验证 decides I-PASS. |

