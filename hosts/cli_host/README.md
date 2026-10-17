# CLI multi-end Host

Same product path as Desktop Electron: MoonBit `cmd/desktop_turn` + Host FFI
(`hosts/shared`). Sets `machine_kind` so iOS/Android sessions are first-class,
not Desktop-only freelancing.

```bash
# Desktop
node hosts/cli_host/run_turn.js --machine-kind desktop "ListMachines"

# iOS / Android attach (same brain, different MachineKind)
node hosts/cli_host/run_turn.js --machine-kind ios "ListMachines"
node hosts/cli_host/run_turn.js --machine-kind android "shell uname -a"

# Channel + session context
node hosts/cli_host/run_turn.js --machine-kind ios --channel slack:C1 \
  "reply via slack:C1 :: hello from phone"
```

Host FFI kinds: `shell`, `fs_list`, `fs_read`, `webfetch`, `channel_send`
(live Slack when `SLACK_BOT_TOKEN` + `BITBOT_SLACK_POST=1`), `connectors_probe`,
`oauth`, `mcp_namespace`, `mail_draft`.
