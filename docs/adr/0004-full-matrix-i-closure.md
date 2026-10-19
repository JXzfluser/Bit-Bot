# ADR 0004 — Wave H6 Full Matrix I Closure

- Status: Accepted
- Date: 2026-10-17 (Asia/Shanghai)
- Decision makers: Bit架构 / Bit验证

## Context

H0–H5 closed the **41 Host-hard inventory** with Live evidence (`I-PASS=41`, open GAP=0). The capability matrix still showed **I-todo=193** for rows whose U acceptance already PASS and whose Host surface is either absent (kernel-sufficient) or already covered by H0–H5 Live HostAbi / Host UI. Full delivery requires clearing matrix I without inventing mock-only Host I for the Host-hard 41.

## Decision

**Wave H6 — Full matrix I closure**

1. Remaining CMs with **U=PASS** whose Host surface is either:
   - (a) none / kernel-sufficient, or
   - (b) already covered by H0–H5 Live HostAbi / Host UI,
   are promoted to **I-PASS** via Wave H6 sweep evidence.
2. Sweep tooling:
   - `evidence_cmd`: `bash /workspace/scripts/host_matrix_i_sweep.sh cm-XXXX` (or `all`)
   - Artifacts link each row’s U acceptance test name + Live HostAbi ping audit (`HostAbi::live` boot / matrix sweep span)
   - `i_claimed=false` in smoke artifacts; Bit验证 docs promote I-PASS
3. **Forbidden**: inventing Host I with mock-only evidence pretending to be Live for Host-hard items already in the 41 (those stay as prior H0–H5 promotions).
4. **CM-0705**: keep platform-subset I-PASS; phone OS residual is documented and does **not** block matrix I clear (subset PASS already).

## Consequences

- Matrix headline becomes **I-PASS=234 / I-todo=0** (0705 retains platform-subset wording).
- `docs/qa/artifacts/h6-matrix-i/` holds per-CM evidence + `SUMMARY.json` for the 193 sweep set.
- Product start path (`scripts/start-bitbot.sh`) and M7 hardening docs mark full-matrix I closed; phone residual remains a non-blocking note.
