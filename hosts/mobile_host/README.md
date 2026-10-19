# Mobile Host (iOS / Android)

Not App Store / Play packaging yet — this is the **real multi-end Host process**
that phones attach to: same MoonBit `desktop_turn` brain + `hosts/shared` FFI as
Desktop, with `machine_kind=ios|android` and `deviceLocalTools`.

```bash
node hosts/mobile_host/run.js "ListMachines"
node hosts/mobile_host/run.js "device tools"
node hosts/mobile_host/run.js --machine-kind android "device tools"
node hosts/mobile_host/run.js --approved "shell uname -a"
```

`hosts/ios/stub_attach.sh` and `hosts/android/stub_attach.sh` call into this path.
