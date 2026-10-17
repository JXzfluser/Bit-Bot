# CM-0411 host-integration evidence (H3 · Host FFI · §5)

| field | value |
|-------|-------|
| CM | CM-0411 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h3_smoke.sh cm-0411` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0411-webhook-panel` |
| env | box Live Host FFI; USER_IANA=Asia/Shanghai; stamp_utc=20261017T072018Z; shared_cdp_9223=untouched |
| assert | Host webhook panel copy receipts; tool-read key rejected; wake <webhook_event> no key leak; i_claimed=false |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h3_smoke.sh — **not** HostAbi::mock(). Bit验证 decides I-PASS. |

