#!/usr/bin/env bash
# Product-path smoke: MoonBit desktop_turn Grok-parity intents (not LocalBrain).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MOON_TARGET="${BITBOT_MOON_TARGET:-native}"
run() {
  local label="$1"
  shift
  echo "==> $label"
  moon run cmd/desktop_turn --target "$MOON_TARGET" -- "$@"
}

run "ListMachines (multi-end kinds)" --machine-kind desktop "ListMachines"
run "ListMachines as ios context" --machine-kind ios "ListMachines"
run "connectors status" "list connectors"
run "channel delivery gated" "reply via slack:Csmoke :: smoke body"
run "channel delivery approved" --approved "reply via slack:Csmoke :: smoke body"
run "install plugin" "install plugin plugin-slides"
run "setup slack" "setup slack"
run "claim inbox" "claim inbox alpha"
run "draft mail gated" "draft mail to=smoke@example.com subject=Hi body=Smoke"
run "draft mail approved" --approved "draft mail to=smoke@example.com subject=Hi body=Smoke"
run "create routine" "create routine id=smoke-r cron=@daily prompt=ping"
run "mcp discover" "mcp discover user-Gmail"
run "mcp call" "mcp call user-Gmail.search_threads {}"
run "spawn subagent" "spawn subagent triage mail"
run "computer use" "computer use open example.com"
run "device tools ios" --machine-kind ios "device tools"
run "copy to box plan" --approved "copy to box machine=desk-1 src=README.mbt.md dest=/workspace/uploads/README.mbt.md"
run "fs_list plan" "listdir docs"
run "webfetch plan" "webfetch https://example.com"
run "host effect gated" "shell echo desktop-smoke"
run "host effect approved" --approved "shell echo desktop-smoke"
run "host FFI continue (ADR 0002)" \
  --apply-host-results \
  --turn-id smoke-cont \
  --prior-text "shell echo desktop-smoke" \
  --result-ok true \
  --result-kind shell \
  --result-command "echo desktop-smoke" \
  --result-stdout "desktop-smoke" \
  --result-stderr "" \
  --result-error ""
run "session memory seed" --seed-memory "smoke_key=smoke_val" "recall smoke"

echo "==> multi-end CLI Host (shared FFI)"
node hosts/cli_host/run_turn.js --machine-kind ios "ListMachines" | head -c 400
echo
node hosts/cli_host/run_turn.js --machine-kind android --approved "listdir docs" >/tmp/bitbot-android-turn.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-android-turn.json'));assert d.get('ok');assert d.get('host_continued');assert d.get('machine_kind')=='android';print('android fs_list ok', d.get('machine_kind'), 'host_continued', d.get('host_continued'))"
node hosts/cli_host/run_turn.js --machine-kind ios "device tools" >/tmp/bitbot-ios-tools.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-ios-tools.json'));assert d.get('ok');assert d.get('intent')=='device_tools';print('ios device_tools ok')"

echo "OK: smoke_desktop_turn.sh"
