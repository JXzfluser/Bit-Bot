# CM-1807 host-integration evidence (H5 · media/cards/pixels · §6)

| field | value |
|-------|-------|
| CM | CM-1807 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1807` |
| artifact_dir | `/workspace/docs/qa/artifacts/cm-1807-pptx` |
| env | box Live Host; USER_IANA=Asia/Shanghai; stamp_utc=20261017T085929Z; shared_cdp_9223=untouched |
| assert | python-pptx host-openable .pptx; PK magic; under /workspace |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h5_smoke.sh — **not** HostAbi::mock() / mock MediaHost. Bit验证 decides I-PASS. |

