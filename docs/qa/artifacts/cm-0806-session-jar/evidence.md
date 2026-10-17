# CM-0806 host-integration evidence

| field | value |
|-------|-------|
| CM | CM-0806 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0806` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0806-session-jar` |
| env | box Host smoke; display=n/a (file digest only; no browser touched); USER_IANA=Asia/Shanghai; stamp_utc=20261017T062727Z |
| assert | cookie jar present; sha256/bytes/row-count read in place (jar_digest.txt), DB never copied. t0/t1 hashes are taken in ONE running session and do NOT prove the Update Computer lifecycle; Update Computer UI not automated |
| status | NEEDS_REVIEW |
| note | Produced by scripts/host_h1_smoke.sh — **not** HostAbi::mock() / Placeholder PNG. Bit验证 decides I-PASS. |

