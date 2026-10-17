# CM-0605 host-integration evidence

| field | value |
|-------|-------|
| CM | CM-0605 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h1_smoke.sh cm-0605` |
| artifact_dir | `/workspace/bitbot/docs/qa/artifacts/cm-0605-screenshot` |
| env | box Host smoke; DISPLAY=:1; USER_IANA=Asia/Shanghai; stamp_utc=20261017T062005Z |
| assert | real :1 x11grab PNG; png_magic=ok; bytes>0; sha256 recorded; frame_origin=LiveDisplay; read_only; clicked=false; not Placeholder/mock |
| status | READY_FOR_I_REVIEW |
| note | Produced by scripts/host_h1_smoke.sh — **not** HostAbi::mock() / Placeholder PNG. Bit验证 decides I-PASS. |

