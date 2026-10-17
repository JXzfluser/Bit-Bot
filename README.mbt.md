# bitbot/bitbot

MoonBit runtime for Bit Bot (Grok Bot–class agent host). Full capability matrix: **234** CMs · **U-PASS=234** · **I-PASS=234** (Wave H6; CM-0705 platform-subset wording retained).

See [docs/scaffold-status.md](docs/scaffold-status.md), [docs/capability-matrix.md](docs/capability-matrix.md), and [docs/adr/0004-full-matrix-i-closure.md](docs/adr/0004-full-matrix-i-closure.md).

## Run

```bash
export PATH="$HOME/.moon/bin:$PATH"
bash scripts/start-bitbot.sh
# Host UI: http://127.0.0.1:8765/
# Health:  http://127.0.0.1:8765/api/host/health
```

Or kernel boot only:

```bash
moon run cmd/main
```

## Check / test

```bash
export PATH="$HOME/.moon/bin:$PATH"
moon check
moon test   # expect 347+ passed
```

## Host smokes / H6 matrix I sweep

```bash
# Prior Host-hard inventory (H0–H5)
bash scripts/host_h0_smoke.sh all
bash scripts/host_h5_smoke.sh media

# Wave H6 — remaining matrix I=todo → READY_FOR_I_REVIEW artifacts
bash scripts/host_matrix_i_sweep.sh all
# Fast re-artifact (skip moon test):
H6_FAST=1 bash scripts/host_matrix_i_sweep.sh all
```

Artifacts: `docs/qa/artifacts/h6-matrix-i/SUMMARY.json`
