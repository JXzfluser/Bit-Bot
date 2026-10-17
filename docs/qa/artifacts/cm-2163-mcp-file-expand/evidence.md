# CM-2163 host-integration evidence (H4 · MCP/OAuth/出网 · §4)

| field | value |
|-------|-------|
| CM | CM-2163 |
| evidence_cmd | `bash /workspace/bitbot/scripts/host_h4_smoke.sh cm-2163` |
| artifact_dir | `/workspace/docs/qa/artifacts/cm-2163-mcp-file-expand` |
| env | box Live Host; USER_IANA=Asia/Shanghai; stamp_utc=20261017T083929Z; shared_cdp_9223=untouched |
| assert | Host FS $file: inject via stdio MCP; chat only ref; plain refuse; audit; i_claimed=false |
| status | READY_FOR_I_REVIEW |
| i_claimed | false |
| note | Produced by scripts/host_h4_smoke.sh — **not** HostAbi::mock() / in-process fake MCP. Bit验证 decides I-PASS. |

