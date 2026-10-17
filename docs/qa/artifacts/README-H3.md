# H3 Host FFI smoke evidence note (MoonBit核 · 2026-10-17 Asia/Shanghai)

Host smoke artifacts under `docs/qa/artifacts/` for Wave H3 (`scripts/host_h3_smoke.sh`).
Status fields are `READY_FOR_I_REVIEW` / `NEEDS_REVIEW` only — **I-PASS not claimed**;
GAP rows in `qa/host-integration-gaps.md` stay **open** until Bit验证 promotes.
Do not delete GAP lines (incl. **CM-0806**) or rewrite kernel-contract PASS.

| CM | evidence_cmd | artifact | assert (summary) |
|----|--------------|----------|------------------|
| CM-2158 | `bash scripts/host_h3_smoke.sh cm-2158` | `cm-2158-package-install/` | Live Shell npm sandbox; pid/exit/stdout; non-Shell refused; audit |
| CM-2174 | `bash scripts/host_h3_smoke.sh cm-2174` | `cm-2174-shared-box-fs/` | Dual Live sessions shared FS + distinct displays; not mock self-rw |
| CM-0705 | `bash scripts/host_h3_smoke.sh cm-0705` | `cm-0705-device-local-tools/` | `platform_subset.md` = `desktop_no_device_local_tools`; desktop tools empty; phone OS dialog residual GAP |
| CM-0411 | `bash scripts/host_h3_smoke.sh cm-0411` | `cm-0411-webhook-panel/` | Host panel copy receipts; tool-read key rejected; wake `<webhook_event>` no key |

Kernel skeleton: `box_host/h3_probes.mbt` (`H3Intent` / `H3FfiEvidence` / `run_h3_probe`; `i_claimed=false`).
Shared CDP **9223** and `/home/box/chrome-profile` untouched.
