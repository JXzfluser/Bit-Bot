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
node hosts/cli_host/run_turn.js --approved "fire routine host-r" >/tmp/bitbot-routine-fire.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-routine-fire.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='routine_fire');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('fired') is True;assert p.get('next_due');assert os.path.isfile('data/routines/fires.jsonl');print('routine_fire durable ok', 'next_due', p.get('next_due'))"
python3 - <<'PY'
import json, pathlib
p=pathlib.Path('data/routines/host-routines.json')
rows=json.loads(p.read_text()) if p.exists() else []
for r in rows:
  if r.get('id')=='host-r':
    r['next_due']='2020-01-01T00:00:00.000Z'
p.write_text(json.dumps(rows, indent=2))
print('forced host-r due')
PY
node hosts/cli_host/run_turn.js "tick routines" >/tmp/bitbot-routine-tick.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-routine-tick.json'));assert d.get('intent')=='tick_routines';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='routine_tick');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('wakes') is True;assert p.get('fired_count')>=1;print('routine_tick wake ok', 'fired', p.get('fired_count'), 'due', p.get('due_count'))"

echo "==> Host sandbox OAuth (Slack + Gmail) + computer_use navigate"
node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-slack.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-oauth-slack.json'));assert d.get('ok');hrs=d.get('host_results') or [];assert any(h.get('kind')=='oauth' and h.get('ok') for h in hrs);print('oauth slack host ok')"
node hosts/cli_host/run_turn.js "connect gmail" >/tmp/bitbot-oauth-gmail.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-oauth-gmail.json'));assert d.get('ok');hrs=d.get('host_results') or [];assert any(h.get('kind')=='oauth' and h.get('ok') for h in hrs);print('oauth gmail host ok')"
node hosts/cli_host/run_turn.js "computer use open https://example.com click:40,40" >/tmp/bitbot-cu.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');assert h.get('ok');out=h.get('stdout') or '';payload=json.loads(out);assert 'navigate_reachable' in out;g=payload.get('gui') or {};assert g.get('box_chrome_process') is True or 'http_fallback' in out;oc=payload.get('outcome') or {};assert oc.get('summary')=='structured outcome only';assert 'agent_loop' in payload;print('computer_use agent-loop host ok', 'os_window', g.get('os_window'), 'actions_ok', g.get('actions_ok'), 'screenshot_ok', g.get('screenshot_ok'))"
BITBOT_OAUTH_MODE=live node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-live.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-oauth-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok') is False;assert 'NeedsAuth' in (h.get('stdout') or '') or 'live_needs_auth' in (h.get('stdout') or '');print('oauth live NeedsAuth (honest) ok')"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=local node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-exchange.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-oauth-exchange.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok');assert 'local_exchange' in (h.get('stdout') or '');print('oauth local_exchange authorize→token ok')"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=interactive node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-interactive.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-oauth-interactive.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok');out=h.get('stdout') or '';assert 'interactive_local' in out;assert 'interactive_browser' in out;print('oauth interactive_local browser consent ok')"
node hosts/cli_host/run_turn.js "shop target.com headphones" >/tmp/bitbot-cu-plan.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-plan.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert (p.get('outcome') or {}).get('summary')=='structured outcome only';al=p.get('agent_loop') or {};assert 'act' in al;g=p.get('gui') or {};assert g.get('box_chrome_process') is True;print('computer_use planner playbook host ok', 'os_window', g.get('os_window'), 'actions_ok', g.get('actions_ok'))"
node hosts/cli_host/run_turn.js "shop target.com headphones" >/tmp/bitbot-cu-vision.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-vision.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');al=p.get('agent_loop') or {};assert 'vision' in al;oc=p.get('outcome') or {};assert 'vision_ok' in oc;v=al.get('vision') or {};dt=v.get('dom_targets');assert isinstance(dt,dict) or dt is None;print('computer_use vision planner host ok', 'vision_ok', oc.get('vision_ok'), 'blocked_on_signin', oc.get('blocked_on_signin'), 'hotspots', bool(v.get('hotspots')), 'dom_targets', isinstance(dt,dict), 'has_bbox', bool(dt and any(dt.values())))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_OPEN_BROWSER=1 BITBOT_OAUTH_CLIENT_ID=smoke-client node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-browser.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-oauth-browser.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok') is False;out=h.get('stdout') or '';assert 'NeedsAuth' in out;assert 'live_remote_browser_open' in out or 'browser_opened' in out;p=json.loads(out);assert p.get('status')=='NeedsAuth';print('oauth live_remote_browser_open NeedsAuth ok', 'browser_opened', p.get('browser_opened'), 'tool', p.get('browser_tool'))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=remote_callback BITBOT_OAUTH_AUTHORIZE_URL=https://oauth.example.invalid/authorize BITBOT_OAUTH_TOKEN_URL=https://oauth.example.invalid/token BITBOT_OAUTH_CLIENT_ID=smoke-client BITBOT_OAUTH_CALLBACK_WAIT_MS=6000 node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-callback.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-oauth-callback.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_remote_callback';assert p.get('callback_received') is True;assert p.get('connected') is True;print('oauth live_remote_callback browser→token ok', 'browser_opened', p.get('browser_opened'))"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: smoke body" >/tmp/bitbot-channel.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-channel.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');assert 'outbound' in (h.get('stdout') or '') or os.path.isfile('data/channels/outbound.jsonl');print('channel_send outbound durable ok')"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke:1710000.000100 :: thread reply" >/tmp/bitbot-channel-thread.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-channel-thread.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('thread_ts')=='1710000.000100' or '1710000.000100' in (h.get('stdout') or '');print('channel_send slack thread_ts durable ok', p.get('mode'))"
BITBOT_SLACK_CLAIM=1 node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: claim rehearsal" >/tmp/bitbot-channel-claim.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-channel-claim.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='sandbox_slack_claim';assert os.path.isfile('data/channels/inbound.jsonl');print('channel_send sandbox_slack_claim inbound ok', 'claimed', p.get('claimed_count'))"
node hosts/cli_host/run_turn.js "shop target.com headphones" >/tmp/bitbot-cu-vision-gui.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-vision-gui.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');g=p.get('gui') or {};assert g.get('vision_ok') is True;assert isinstance(g.get('vision_plan'),dict);print('computer_use gui.vision_plan host ok', g.get('vision_plan'))"
node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: teams body" >/tmp/bitbot-teams.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-teams.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');assert 'teams' in (h.get('stdout') or '');print('channel_send teams outbound ok')"

echo "==> Host skill_write / slides_pptx / export_pack (real artifacts)"
node hosts/cli_host/run_turn.js "author skill name=smoke-skill description=demo body=Do the thing." >/tmp/bitbot-skill-write.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-skill-write.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='skill_write');assert h.get('ok');assert 'SKILL.md' in (h.get('stdout') or '');assert os.path.isfile('agent-tools/skills/smoke-skill/SKILL.md');print('skill_write host ok')"
node hosts/cli_host/run_turn.js "make slides Smoke Deck" >/tmp/bitbot-slides.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-slides.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='slides_pptx');assert h.get('ok');assert 'pptx_pk_magic_ok' in (h.get('stdout') or '');p=json.loads(h['stdout'])['path'];assert open(p,'rb').read(2)==b'PK';print('slides_pptx host ok', p)"
node hosts/cli_host/run_turn.js "export bot template id=bot-smoke name=SmokeBot" >/tmp/bitbot-export.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-export.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='export_pack');assert h.get('ok');assert 'secrets_stripped' in (h.get('stdout') or '');assert os.path.isfile('agent-tools/exports/bot-smoke-shareable-template.json');print('export_pack host ok')"

echo "==> Host durable product delivery (voice/teammates/device/subagent/cloud/commerce)"
node hosts/cli_host/run_turn.js "voice start smoke1" >/tmp/bitbot-voice.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='voice_session');assert h.get('ok') and 'sessions.json' in (h.get('stdout') or '');assert os.path.isfile('data/voice/sessions.json');p=json.loads(h.get('stdout') or '{}');assert p.get('media_ok') is True;assert os.path.isfile(p.get('media_path') or '');assert open(p['media_path'],'rb').read(4)==b'RIFF';print('voice_session durable+media ok', p.get('media_path'), 'bytes', p.get('media_bytes'))"
node hosts/cli_host/run_turn.js "voice relay smoke1 :: hello from smoke" >/tmp/bitbot-voice-relay.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-relay.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='voice_relay');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('turns')>=2;assert p.get('transcript_path') and os.path.isfile(p['transcript_path']);assert p.get('reply');assert p.get('reply_media_ok') is True;assert p.get('reply_media_path') and os.path.isfile(p['reply_media_path']);assert open(p['reply_media_path'],'rb').read(4)==b'RIFF';print('voice_relay reply WAV ok', p.get('turns'), 'bytes', p.get('reply_media_bytes'))"
node hosts/cli_host/run_turn.js "create teammate id=asst-smoke name=Smoke role=executor" >/tmp/bitbot-teammate.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-teammate.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='teammate_create');assert h.get('ok') and 'teammates.json' in (h.get('stdout') or '');assert os.path.isfile('data/agents/teammates.json');print('teammate_create durable ok')"
node hosts/cli_host/run_turn.js "room eng :: ship it" >/tmp/bitbot-room.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-room.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='room_turn');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('is_room') is True;assert p.get('forbids_private_assumptions') is True;assert p.get('is_private_dm') is False;assert isinstance(p.get('delivered_to'),list);assert os.path.isfile('data/agents/room-turns.jsonl');print('room_turn fanout ok', p.get('room'), 'members', p.get('member_count'), 'delivered', len(p.get('delivered_to') or []))"
node hosts/cli_host/run_turn.js "send to agent asst-smoke :: ping" >/tmp/bitbot-send-agent.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-send-agent.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='send_to_agent');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('routed') is True;assert p.get('delivered') is True;assert p.get('teammate_known') is True;assert p.get('status') in ('delivered_replied','delivered','delivered_worker_error');assert p.get('outbox') and os.path.isfile(p['outbox']);assert os.path.isfile(p.get('path') or '');print('send_to_agent wake+outbox ok', p.get('status'), 'reply_prefix', str(p.get('reply') or '')[:60])"
node hosts/cli_host/run_turn.js --machine-kind ios "device tool camera" >/tmp/bitbot-device-perm.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-device-perm.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind') in ('device_permission','device_tool'));assert h.get('ok');assert 'pretend_granted' not in (h.get('stdout') or '') or 'false' in (h.get('stdout') or '');print('device_permission/tool durable ok', h.get('kind'))"
node hosts/cli_host/run_turn.js "spawn subagent triage mail" >/tmp/bitbot-subagent.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-subagent.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='subagent_run');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');sub=p.get('subagent') or {};assert sub.get('status') in ('completed','failed','completed_nest_skipped');assert os.path.isfile('data/agents/subagents.json');assert p.get('ran') is True or sub.get('status')=='completed_nest_skipped';assert sub.get('status')!='running';print('subagent_run worker ok', sub.get('status'), 'result', p.get('result_path'))"
BITBOT_NEST_DEPTH=1 node hosts/cli_host/run_turn.js "spawn subagent nested guard" >/tmp/bitbot-subagent-nest.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-subagent-nest.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='subagent_run');p=json.loads(h.get('stdout') or '{}');assert p.get('nested_skipped') is True;assert (p.get('subagent') or {}).get('status')=='completed_nest_skipped';print('subagent_run CM-2133 nest guard ok')"
node hosts/cli_host/run_turn.js "launch cloud agent triage CI failures" >/tmp/bitbot-cloud.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cloud.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='cloud_agent_launch');assert h.get('ok') and 'launches.jsonl' in (h.get('stdout') or '');p=json.loads(h.get('stdout') or '{}');card=p.get('cursor_agent_card') or {};assert card.get('type')=='cursor-agent';assert card.get('can_open_cloud') is True;assert card.get('bc_id');assert 'agents/' in (card.get('open_url') or '');assert os.path.isfile('data/delivery/send-to-user.jsonl');print('cloud_agent_launch cursor-agent card ok', card.get('bc_id'))"
node hosts/cli_host/run_turn.js --approved "purchase item=BlueYeti cents=12900" >/tmp/bitbot-purchase.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-purchase.json'));assert d.get('ok');hrs=d.get('host_results') or [];assert any(h.get('kind') in ('purchase','approval_card') and h.get('ok') for h in hrs);print('purchase/approval durable ok', [(h.get('kind'),h.get('ok')) for h in hrs])"
node hosts/cli_host/run_turn.js "shell echo needs-approve" >/tmp/bitbot-approval-widget.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-approval-widget.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='approval_card');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');w=p.get('widget') or {};assert w.get('widget_id');opts=w.get('options') or [];assert any(o.get('id')=='approve' for o in opts);assert any(o.get('id')=='dismiss' for o in opts);deliv=next(x for x in hrs if x.get('kind')=='delivery' and 'approval_card' in (x.get('stdout') or ''));dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('type')=='widget';assert os.path.isfile('data/delivery/send-to-user.jsonl');print('approval_card CM-0105 widget ok', w.get('widget_id'), 'options', len(opts))"
node hosts/cli_host/run_turn.js "personal slack dm owner=Uowner text=ping [widget:decision_card]" >/tmp/bitbot-personal-dm.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-personal-dm.json'));assert d.get('ok');assert d.get('intent')=='personal_slack_dm';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('personal_dm') is True;assert p.get('mode')=='personal_slack_dm_draft';assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert os.path.isfile('data/channels/outbound.jsonl');deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('personal_dm') is True;assert dp.get('widget_degraded') is True;print('personal_slack_dm CM-1103/1104 ok', p.get('mode'), 'degraded', p.get('widget_degraded'))"
node hosts/cli_host/run_turn.js "fill credential domain=login.example.test" >/tmp/bitbot-cred.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cred.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='credential_fill');assert h.get('ok');assert 'secret_echoed' in (h.get('stdout') or '') and 'false' in (h.get('stdout') or '');print('credential_fill vault-only ok')"
node hosts/cli_host/run_turn.js "schedule meeting title=Sprint when=tomorrow-3pm" >/tmp/bitbot-schedule.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-schedule.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='schedule_meeting');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('scheduled') is True;assert p.get('ics_ok') is True;assert p.get('ics_path') and os.path.isfile(p['ics_path']);assert b'BEGIN:VEVENT' in open(p['ics_path'],'rb').read();print('schedule_meeting ICS ok', p.get('ics_path'))"

echo "==> journal / shared memory / inbound reaction (durable Host stores)"
node hosts/cli_host/run_turn.js "journal date=2026-10-17 id=smoke body=smoke-event" >/tmp/bitbot-journal-append.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-journal-append.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='journal_append');assert h.get('ok') and 'events.jsonl' in (h.get('stdout') or '');print('journal_append durable ok')"
node hosts/cli_host/run_turn.js "query journal from=2026-10-01 to=2026-10-31" >/tmp/bitbot-journal-query.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-journal-query.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='journal_query');assert h.get('ok') and 'hit_count' in (h.get('stdout') or '');print('journal_query durable ok')"
node hosts/cli_host/run_turn.js "shared memory put scope=team key=k value=v" >/tmp/bitbot-shared-put.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-shared-put.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='shared_memory_put');assert h.get('ok') and 'shared-scopes.json' in (h.get('stdout') or '');print('shared_memory_put durable ok')"
node hosts/cli_host/run_turn.js "shared memory read scope=team key=k" >/tmp/bitbot-shared-read.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-shared-read.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='shared_memory_read');assert h.get('ok') and '\"found\": true' in (h.get('stdout') or '');print('shared_memory_read durable ok')"
node hosts/cli_host/run_turn.js "[inbound] reaction :+1:" >/tmp/bitbot-inbound.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-inbound.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='inbound_reaction');assert h.get('ok') and 'forced_reply' in (h.get('stdout') or '') and 'false' in (h.get('stdout') or '').lower();p=json.loads(h.get('stdout') or '{}');assert p.get('visible_pill') is True;assert os.path.isfile('data/delivery/outbound-reactions.jsonl');assert os.path.isfile('data/delivery/send-to-user.jsonl');print('inbound_reaction SendToUser pill ok', p.get('emoji'))"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: delivery body" >/tmp/bitbot-delivery.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-delivery.json'));hrs=d.get('host_results') or [];assert any(h.get('kind')=='channel_send' and h.get('ok') for h in hrs);deliv=next(x for x in hrs if x.get('kind')=='delivery');assert deliv.get('ok');p=json.loads(deliv.get('stdout') or '{}');assert p.get('type') in ('text','thread');assert p.get('send_to_user') is True;assert os.path.isfile('data/delivery/send-to-user.jsonl');print('SendToUser delivery receipt ok', p.get('type'), p.get('channel'))"

echo "==> native iOS/Android Host shells"
bash "$ROOT/scripts/verify_native_shells.sh"

echo "OK: smoke_desktop_turn.sh"
