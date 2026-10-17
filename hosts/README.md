# Hosts (multi-end baseline)

Bit Bot is multi-end by contract. MoonBit owns turn policy; each host attaches HostAbi and registers a `MachineKind`.

| Path | MachineKind | Status |
|------|-------------|--------|
| `hosts/desktop/` | `Desktop` | Electron product window + MoonBit `cmd/desktop_turn` |
| `hosts/ios/` | `Ios` | Host stub / simulator attach docs |
| `hosts/android/` | `Android` | Host stub / simulator attach docs |

Shared brain path:

```text
Host UI → moon run cmd/desktop_turn → open_turn → intent → deliver → JSON v:1
```

List all registered kinds (seed registry):

```bash
bash scripts/host_mobile_stub.sh
# or
moon run cmd/desktop_turn --target native -- "ListMachines"
```

Desktop-only Host FFI executes shell/FS/network effects. Mobile stubs document how the same JSON contract attaches; they do not reimplement LocalBrain.
