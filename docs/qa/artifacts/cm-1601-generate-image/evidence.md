# CM-1601 host-integration evidence (H5 · media/cards/pixels · §6)

| field | value |
|-------|-------|
| CM | CM-1601 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-1601` |
| artifact_dir | `/workspace/docs/qa/artifacts/cm-1601-generate-image` |
| env | box Live Host; USER_IANA=Asia/Shanghai; stamp_utc=20261017T085755Z; shared_cdp_9223=untouched |
| assert | Pillow PNG under /workspace/agent-tools/; magic 89504e47; openable |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h5_smoke.sh — **not** HostAbi::mock() / mock MediaHost. Bit验证 decides I-PASS. |

