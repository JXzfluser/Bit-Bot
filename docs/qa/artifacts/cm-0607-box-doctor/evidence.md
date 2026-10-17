# CM-0607 host-integration evidence

| field | value |
|-------|-------|
| CM | CM-0607 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h0_smoke.sh cm-0607` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0607-box-doctor` |
| env | box Host smoke; USER_IANA=Asia/Shanghai; stamp_utc=20261017T061343Z |
| assert | real box-doctor (or FS probe) output under artifacts + /tmp/box-doctor-h0.log; PASS/FAIL/SUMMARY evidence; not HostAbi mock FS |
| status | READY_FOR_I_REVIEW |
| note | Produced by scripts/host_h0_smoke.sh — **not** HostAbi::mock(). Bit验证 decides I-PASS. |

