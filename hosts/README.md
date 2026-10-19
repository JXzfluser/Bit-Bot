# Hosts (multi-end baseline)

Bit Bot is multi-end by contract. MoonBit owns turn policy; each host attaches HostAbi and registers a `MachineKind`.

| Path | MachineKind | Status |
|------|-------------|--------|
| `hosts/desktop/` | `Desktop` | Electron product window + shared Host FFI |
| `hosts/cli_host/` | any | CLI Host — same brain/FFI as Desktop (`--machine-kind`) |
| `hosts/ios/` | `Ios` | stub_attach → CLI Host with `machine_kind=ios` |
| `hosts/android/` | `Android` | stub_attach → CLI Host with `machine_kind=android` |
| `hosts/shared/` | — | Host FFI + MoonBit turn runner (ADR 0002 回注) |

Shared brain path:

```text
Host → moon run cmd/desktop_turn → open_turn → intent → effects
    → Host FFI execute → --apply-host-results → continue_after_host_ffi
```

```bash
bash scripts/host_mobile_stub.sh
bash hosts/ios/stub_attach.sh
node hosts/cli_host/run_turn.js --machine-kind android "listdir docs"
bash scripts/start-desktop.sh
bash scripts/pack-desktop.sh
```

Host FFI kinds: `shell`, `fs_list`, `fs_read`, `webfetch`, `channel_send` (live Slack when token + `BITBOT_SLACK_POST=1`), `connectors_probe`, `oauth`, `mcp_namespace`, `mail_draft`.

Python LocalBrain is not the product path.
