# CM-2109 host-integration evidence (H4 · MCP/OAuth/出网 · §4)

| field | value |
|-------|-------|
| CM | CM-2109 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2109` |
| artifact_dir | `/workspace/docs/qa/artifacts/cm-2109-finance-oauth` |
| env | box Live Host; USER_IANA=Asia/Shanghai; stamp_utc=20261017T090950Z; shared_cdp_9223=untouched |
| assert | NeedsAuth→sandbox OAuth HTTP code flow→Ready; callback observed; no refresh token; i_claimed=false |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h4_smoke.sh — **not** HostAbi::mock() / in-process fake MCP. Bit验证 decides I-PASS. |

