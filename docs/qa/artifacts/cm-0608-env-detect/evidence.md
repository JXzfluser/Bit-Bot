# CM-0608 host-integration evidence

| field | value |
|-------|-------|
| CM | CM-0608 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-0608` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0608-env-detect` |
| env | box Host smoke; USER_IANA=Asia/Shanghai; stamp_utc=20261017T061344Z |
| assert | true read of /.dockerenv or equivalent Host probe (/proc/1/cgroup|/run/.containerenv|env); diagnostic runtime label recorded |
| status | READY_FOR_I_REVIEW |
| note | Produced by scripts/host_h0_smoke.sh — **not** HostAbi::mock(). Bit验证 decides I-PASS. |

