# CM-2160 host-integration evidence

| field | value |
|-------|-------|
| CM | CM-2160 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-2160` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-2160-navigate` |
| env | box Host smoke; display=:99 (private Xvfb; isolated throwaway box-chrome, port 9333); USER_IANA=Asia/Shanghai; stamp_utc=20261017T062936Z |
| assert | navigated via CDP `PUT /json/new?https://example.com` on isolated port 9333; isolated /json/list shows page url=https://example.com/ title=Example_Domain; post-navigate frame PNG sha256=a7018046bf0ef941d6ef8f84c103888163b548a85e3ba497e762e6d901e0032c; throwaway profile/pid cleaned (cleanup_proof.txt) |
| status | READY_FOR_I_REVIEW |
| note | Produced by scripts/host_h1_smoke.sh — **not** HostAbi::mock() / Placeholder PNG. Bit验证 decides I-PASS. |

