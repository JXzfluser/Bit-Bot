# CM-2175 host-integration evidence

| field | value |
|-------|-------|
| CM | CM-2175 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-2175` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-2175-box-clock` |
| env | box Host smoke; USER_IANA=Asia/Shanghai; stamp_utc=20261017T061344Z |
| assert | real `TZ=Asia/Shanghai date` output aligns with user IANA (CST/+0800 for Asia/Shanghai) |
| status | READY_FOR_I_REVIEW |
| note | Produced by scripts/host_h0_smoke.sh — **not** HostAbi::mock(). Bit验证 decides I-PASS. |

