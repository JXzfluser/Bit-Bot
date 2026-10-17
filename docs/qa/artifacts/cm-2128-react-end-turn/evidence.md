# CM-2128 host-integration evidence (H5 · media/cards/pixels · §6)

| field | value |
|-------|-------|
| CM | CM-2128 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-2128` |
| artifact_dir | `/workspace/docs/qa/artifacts/cm-2128-react-end-turn` |
| env | box Live Host; USER_IANA=Asia/Shanghai; stamp_utc=20261017T085755Z; shared_cdp_9223=untouched |
| assert | end_turn leaves pill visible in LiveDisplay frame |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h5_smoke.sh — **not** HostAbi::mock() / mock MediaHost. Bit验证 decides I-PASS. |

