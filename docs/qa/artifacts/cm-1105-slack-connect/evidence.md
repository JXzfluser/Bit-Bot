# CM-1105 host-integration evidence (H4 · MCP/OAuth/出网 · §4)

| field | value |
|-------|-------|
| CM | CM-1105 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-1105` |
| artifact_dir | `/workspace/docs/qa/artifacts/cm-1105-slack-connect` |
| env | box Live Host; USER_IANA=Asia/Shanghai; stamp_utc=20261017T090946Z; shared_cdp_9223=untouched |
| assert | NeedsAuth→sandbox OAuth HTTP code flow→Connected; callback observed; no refresh token; i_claimed=false |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h4_smoke.sh — **not** HostAbi::mock() / in-process fake MCP. Bit验证 decides I-PASS. |

