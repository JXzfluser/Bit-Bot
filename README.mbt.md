# bitbot/bitbot

**Product = MoonBit kernel + multi-end hosts** (ADR 0005). Desktop is the shipping Host window; iOS/Android register the same `MachineKind` surface. Capability matrix: **234** CMs · **U-PASS=234** · **I-PASS=234** (Wave H6; CM-0705 platform-subset wording retained).

See [docs/scaffold-status.md](docs/scaffold-status.md), [docs/capability-matrix.md](docs/capability-matrix.md), [docs/adr/0005-course-correct-moonbit-desktop.md](docs/adr/0005-course-correct-moonbit-desktop.md), [hosts/README.md](hosts/README.md).

## Start Desktop (primary)

```bash
export PATH="$HOME/.moon/bin:$PATH"
bash scripts/start-desktop.sh
# Window: hosts/desktop (Bit Bot Desktop)
# Boot → moon run cmd/main --target native
# Chat → moon run cmd/desktop_turn --target native -- "<text>"
```

One MoonBit turn without the window:

```bash
moon run cmd/desktop_turn --target native -- "ListMachines"
# JSON v:1 includes machines kind desktop + ios + android
```

Multi-end machine list (no UI):

```bash
bash scripts/host_mobile_stub.sh
```

Default target is **native**. Wasm alternative: `BITBOT_MOON_TARGET=wasm`.

Kernel boot only:

```bash
moon run cmd/main --target native
```

## Check / test

```bash
export PATH="$HOME/.moon/bin:$PATH"
moon check
moon test
```

## Python Host (non-goal / demoted)

`scripts/bitbot_runtime/` + `:8765` Host UI and `deploy_local.sh` are **not** the product path. They are optional Host FFI experiments only. Do not advertise Python chat as Bit Bot.

Prefer `bash scripts/start-desktop.sh`.

Docs: [docs/qa/real-host-runtime.md](docs/qa/real-host-runtime.md) (legacy Host UI notes).

## Host smokes / H6 matrix I sweep

```bash
bash scripts/host_h0_smoke.sh all
bash scripts/host_h5_smoke.sh media
bash scripts/host_matrix_i_sweep.sh all
H6_FAST=1 bash scripts/host_matrix_i_sweep.sh all
```

Artifacts: `docs/qa/artifacts/h6-matrix-i/SUMMARY.json`
