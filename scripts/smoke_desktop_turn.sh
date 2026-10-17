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
run "list routines" "list routines"
run "pause routine" "pause routine smoke-r"
run "resume routine" "resume routine smoke-r"
run "fire routine" "fire routine smoke-r"
run "search mail" "search mail Invoice"
run "read mail" "read mail t-invoice-1"
run "mcp discover" "mcp discover user-Gmail"
run "mcp call" "mcp call user-Gmail.search_threads {}"
run "spawn subagent" "spawn subagent triage mail"
run "computer use" "computer use open example.com"
run "device tools ios" --machine-kind ios "device tools"
run "load skill" "load skill calendar sync"
run "voice start" "voice start smoke1"
run "voice end" "voice end smoke1"
run "create teammate" "create teammate id=asst-smoke name=Smoke role=executor"
run "room turn" "room eng :: ship it"
run "send to agent" "send to agent asst-smoke :: ping"
run "launch cloud agent" "launch cloud agent triage CI failures"
run "deliver cloud artifact" "deliver cloud artifact artifact=bc-smoke dest=report.md"
run "schedule meeting" "schedule meeting title=Sprint when=tomorrow-3pm"
run "shop retail" "shop target.com headphones"
run "purchase gated" "purchase item=BlueYeti cents=12900"
run "purchase approved" --approved "purchase item=BlueYeti cents=12900"
run "travel book" "book flight google.com/flights"
run "order food" "order food doordash.com"
run "meeting chat" "meeting chat body=standup note direct=1"
run "finance connect" "connect finance"
run "finance call" "finance get_balance"
run "fill credential" "fill credential domain=login.example.test"
run "cold mail gated" "cold mail to=a@example.com subject=Hi body=Hello unsubscribe=mailto:u@example.com"
run "cold mail approved" --approved "cold mail to=a@example.com subject=Hi body=Hello unsubscribe=mailto:u@example.com"
run "personal slack dm" "personal slack dm owner=Uowner text=ping"
run "job search" "job search engineer"
run "learn from demo" "learn from demo title=Checkout steps=click:Cart|type:email"
run "make slides" "make slides Q3 Review"
run "code changes" "code changes README.mbt.md"
run "source control" "source control github"
run "send on behalf gated" "send on behalf to=a@example.com subject=Hi body=Hello"
run "send on behalf approved" --approved "send on behalf to=a@example.com subject=Hi body=Hello"
run "list workflows" "list workflows"
run "identity browser" "identity browser"
run "x search" "x search moonbit"
run "author skill" "author skill name=demo-skill description=demo body=Do the thing."
run "export bot template" "export bot template id=bot-smoke name=SmokeBot"
run "device permission ios camera" --machine-kind ios "device tool camera"
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

echo "==> Host MCP stdio (real subprocess, not journal-only)"
node hosts/cli_host/run_turn.js --approved "mcp discover user-Gmail" >/tmp/bitbot-mcp-discover.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-mcp-discover.json'));assert d.get('ok');hrs=d.get('host_results') or [];assert any(h.get('kind')=='mcp_discover' and h.get('ok') for h in hrs);print('mcp_discover host ok', 'host_continued', d.get('host_continued'))"
node hosts/cli_host/run_turn.js --approved "mcp call user-Gmail.search_threads {}" >/tmp/bitbot-mcp-call.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-mcp-call.json'));assert d.get('ok');hrs=d.get('host_results') or [];assert any(h.get('kind')=='mcp_call' and h.get('ok') for h in hrs);print('mcp_call host ok')"

echo "==> Host durable routines"
node hosts/cli_host/run_turn.js --approved "create routine id=host-r cron=@hourly prompt=tick" >/tmp/bitbot-routine-create.json
node hosts/cli_host/run_turn.js "list routines" >/tmp/bitbot-routine-list.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-routine-list.json'));assert d.get('ok');hrs=d.get('host_results') or [];assert any(h.get('kind')=='routine_list' and 'host-r' in (h.get('stdout') or '') for h in hrs);print('routine_list durable ok')"

echo "==> native iOS/Android Host shells"
bash "$ROOT/scripts/verify_native_shells.sh"

echo "OK: smoke_desktop_turn.sh"
