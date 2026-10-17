# CM-1603 host-integration evidence (H5 · media/cards/pixels · §6)

| field | value |
|-------|-------|
| CM | CM-1603 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1603` |
| artifact_dir | `/workspace/docs/qa/artifacts/cm-1603-watch-video` |
| env | box Live Host; USER_IANA=Asia/Shanghai; stamp_utc=20261017T085929Z; shared_cdp_9223=untouched |
| assert | ffmpeg decode + frame PNG extract; magic 89504e47 |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h5_smoke.sh — **not** HostAbi::mock() / mock MediaHost. Bit验证 decides I-PASS. |

