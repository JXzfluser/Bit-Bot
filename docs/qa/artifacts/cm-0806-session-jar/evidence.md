# CM-0806 host-integration evidence (H5 · media/cards/pixels · §6)

| field | value |
|-------|-------|
| CM | CM-0806 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h5_smoke.sh cm-0806` |
| artifact_dir | `/workspace/docs/qa/artifacts/cm-0806-session-jar` |
| env | box Live Host; USER_IANA=Asia/Shanghai; stamp_utc=20261017T091358Z; shared_cdp_9223=untouched |
| assert | Isolated throwaway jar + HostUiShell Update Computer two-step complete; in-place digest stable; 9223 untouched |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h5_smoke.sh — **not** HostAbi::mock() / mock MediaHost. Bit验证 decides I-PASS. |

