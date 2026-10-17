# Bit Bot Host UI surface (Wave H2 · C′ · §3.0)

Interactive **Bit Bot Host process** surface + Live `HostUiShell` HTTP API.

## C′ drive path (升 I 口径)

1. `host_server.py` — Host process: serves UI + `/api/host/*` (HostUiShell methods).
2. `scripts/host_ui_shell_live.py` — Live HostUiShell adapter (open_settings / delete / update_computer / reset / local_execution…).
3. `scripts/host_h2_smoke.sh` — starts Host + isolated viewer; **mutates UI only via adapter**; captures LiveDisplay.
4. MoonBit `HostAbi::run_h2_probe` — same H2Intent mapping; `i_claimed=false`; absorbs `HostUiEvent`.

## B（拒升 I）— 本目录禁止

- CDP / 页面 JS 直调绕过 HostUiShell
- `fixture-only/` 演示壳
- 仅内存事件、无 Host 面状态推进
- 合成 PNG 冒充 Settings

Browser on private Xvfb is a **viewer** for LiveDisplay frames; CDP port is not used to drive UI.

## Batch-2 HostUiShell routes (CM-1903–1906)

- `POST /api/host/request_update_computer` / `confirm_update_computer_step` / `cancel_update_computer`
- `POST /api/host/open_reset_computer`
- `POST /api/host/set_local_execution` / `try_machine_call`
- Smoke: `bash scripts/host_h2_smoke.sh batch2`
