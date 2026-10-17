# CM-2146 host-integration evidence (H4 · MCP/OAuth/出网 · §4)

| field | value |
|-------|-------|
| CM | CM-2146 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2146` |
| artifact_dir | `/workspace/docs/qa/artifacts/cm-2146-app-vs-user-browser` |
| env | box Live Host; USER_IANA=Asia/Shanghai; stamp_utc=20261017T084001Z; shared_cdp_9223=untouched |
| assert | Isolated App+User chrome profiles/CDP (not 9223); session switch observable; i_claimed=false |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h4_smoke.sh — **not** HostAbi::mock() / in-process fake MCP. Bit验证 decides I-PASS. |

