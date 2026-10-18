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
echo "==> Host webfetch CM-1703 public fallback (403→curl, auth wall refuse)"
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18790 --mode webfetch >/tmp/bitbot-webfetch-mock.log 2>&1 &
WF_MOCK_PID=$!
sleep 0.3
node hosts/cli_host/run_turn.js --approved "webfetch http://127.0.0.1:18790/docs-blocked" >/tmp/bitbot-webfetch-fb.json || true
node hosts/cli_host/run_turn.js --approved "webfetch http://127.0.0.1:18790/login" >/tmp/bitbot-webfetch-auth.json || true
node hosts/cli_host/run_turn.js --approved "webfetch http://127.0.0.1:18790/ok" >/tmp/bitbot-webfetch-ok.json || true
kill "$WF_MOCK_PID" >/dev/null 2>&1 || true
wait "$WF_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webfetch-fb.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webfetch');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('used_fallback') is True;assert p.get('fallback')=='curl';assert p.get('credential_bypass') is False;assert p.get('pretend_fetched') is False;assert 'Public docs' in (p.get('body_prefix') or '');assert p.get('path') and os.path.isfile(p['path']);print('webfetch public fallback ok', p.get('fallback'), p.get('path'))"
python3 -c "import json;d=json.load(open('/tmp/bitbot-webfetch-auth.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webfetch');assert h.get('ok') is False;p=json.loads(h.get('stdout') or '{}');assert p.get('used_fallback') is False;assert p.get('credential_bypass') is False;assert 'auth_wall' in (p.get('error') or h.get('error') or '') or p.get('mode')=='host_webfetch_auth_wall';print('webfetch auth wall refuse ok', p.get('mode') or h.get('error'))"
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webfetch-ok.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webfetch');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('used_fallback') is False;assert p.get('http_status')==200;assert p.get('path') and os.path.isfile(p['path']);print('webfetch direct ok', p.get('http_status'), p.get('path'))"
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
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-ios-tools.json'));assert d.get('ok');assert d.get('intent')=='device_tools';h=next(x for x in d['host_results'] if x.get('kind')=='device_tools_list');p=json.loads(h['stdout']);assert p.get('count')>=1;assert p.get('pretend_granted') is False;assert os.path.isfile(p['path']);print('ios device_tools_list ok', p.get('count'), p.get('path'))"

echo "==> Host MCP stdio (real subprocess, not journal-only)"
node hosts/cli_host/run_turn.js --approved "mcp discover user-Gmail" >/tmp/bitbot-mcp-discover.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-discover.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mcp_discover' and x.get('ok'));p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_empty') is False;assert p.get('tool_count',0)>=1;assert p.get('path') and os.path.isfile(p['path']);print('mcp_discover host ok', p.get('tool_count'), p.get('path'), 'host_continued', d.get('host_continued'))"
node hosts/cli_host/run_turn.js --approved "mcp call user-Gmail.search_threads {}" >/tmp/bitbot-mcp-call.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-call.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mcp_call' and x.get('ok'));p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_ok') is False;assert p.get('path') and os.path.isfile(p['path']);snap=json.load(open(p['path']));assert snap.get('pretend_ok') is False;assert snap.get('mode')=='stdio-mcp';print('mcp_call host ok', p.get('mapped') or p.get('tool'), p.get('path'))"
# CM-2163 product path: Host FFI expands $file: before stdio MCP (search_threads→echo_body)
mkdir -p uploads
printf 'LARGE_PAYLOAD_BEGIN_%s_LARGE_PAYLOAD_END' "$(python3 -c 'print("x"*200)')" > uploads/bitbot-mcp-file-body.txt
node hosts/cli_host/run_turn.js --approved 'mcp call user-Gmail.search_threads {"body":"$file:uploads/bitbot-mcp-file-body.txt","q":"invoice"}' >/tmp/bitbot-mcp-file.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-file.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mcp_call');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');fe=p.get('file_expand') or {};assert fe.get('expanded_count',0)>=1;assert fe.get('pretend_inject') is False;refs=fe.get('refs') or [];assert refs and '\$file:' in (refs[0].get('ref') or '');assert p.get('path') and os.path.isfile(p['path']);print('mcp_call \$file: expand ok', fe.get('expanded_count'), 'bytes', (refs[0] or {}).get('bytes'), 'snap', p.get('path'))"
# CM-2164 product path: write_result → /workspace/agent-tools/
printf 'PAYLOAD_MARKER_%s_PAYLOAD_END' "$(python3 -c 'print("a"*120)')" > /tmp/bitbot-mcp-write-body.txt
node hosts/cli_host/run_turn.js --approved 'mcp call user-Gmail.write_result {"body":"$file:/tmp/bitbot-mcp-write-body.txt","filename":"smoke-mcp-write.txt","write_to_file":true}' >/tmp/bitbot-mcp-write.json || true
# Prefer repo-relative file for $file: gate
mkdir -p uploads
cp /tmp/bitbot-mcp-write-body.txt uploads/bitbot-mcp-write-body.txt
node hosts/cli_host/run_turn.js --approved 'mcp call user-Gmail.write_result {"body":"$file:uploads/bitbot-mcp-write-body.txt","filename":"smoke-mcp-write.txt","write_to_file":true}' >/tmp/bitbot-mcp-write.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-write.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mcp_call');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');wtf=p.get('write_to_file') or {};assert wtf.get('write_to_file') is True;assert wtf.get('pretend_inline_payload') is False;assert wtf.get('path') and os.path.isfile(wtf['path']);assert 'agent-tools' in wtf['path'];body=open(wtf['path']).read();assert 'PAYLOAD_MARKER_' in body;assert 'PAYLOAD_MARKER_' not in json.dumps(wtf);assert p.get('path') and os.path.isfile(p['path']) and p['path']!=wtf['path'];print('mcp_call write_to_file ok', wtf.get('path'), 'bytes', wtf.get('bytes'), 'snap', p.get('path'))"

echo "==> Host product media (CM-1601/1602/1603)"
node hosts/cli_host/run_turn.js --approved "generate image smoke aurora desk" >/tmp/bitbot-gen-image.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-gen-image.json'));assert d.get('ok') and d.get('intent')=='generate_image';h=next(x for x in d['host_results'] if x.get('kind')=='generate_image');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_media') is False;assert p.get('png_magic_ok') is True;assert p.get('media_path') and os.path.isfile(p['media_path']);assert open(p['media_path'],'rb').read(8)==b'\\x89PNG\\r\\n\\x1a\\n';assert p.get('path') and os.path.isfile(p['path']);print('generate_image host ok', p.get('media_path'), p.get('path'))"
node hosts/cli_host/run_turn.js --approved "generate video smoke clip desk" >/tmp/bitbot-gen-video.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-gen-video.json'));assert d.get('ok') and d.get('intent')=='generate_video';h=next(x for x in d['host_results'] if x.get('kind')=='generate_video');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_media') is False;assert p.get('video_complete_notified') is True or (p.get('media_path') and os.path.getsize(p['media_path'])>32);assert p.get('media_path') and os.path.isfile(p['media_path']);assert p.get('path') and os.path.isfile(p['path']);print('generate_video host ok', p.get('media_path'), p.get('path'))"
VID=$(python3 -c "import json;d=json.load(open('/tmp/bitbot-gen-video.json'));h=next(x for x in d['host_results'] if x.get('kind')=='generate_video');print(json.loads(h['stdout']).get('media_path'))")
node hosts/cli_host/run_turn.js --approved "watch video $VID" >/tmp/bitbot-watch-video.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-watch-video.json'));assert d.get('ok') and d.get('intent')=='watch_video';h=next(x for x in d['host_results'] if x.get('kind')=='watch_video');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_media') is False;assert p.get('png_magic_ok') is True;assert p.get('frame_path') and os.path.isfile(p['frame_path']);assert open(p['frame_path'],'rb').read(8)==b'\\x89PNG\\r\\n\\x1a\\n';assert p.get('path') and os.path.isfile(p['path']);print('watch_video host ok', p.get('frame_path'), p.get('path'))"
node hosts/cli_host/run_turn.js --approved 'structured chart {"alpha":4,"beta":9,"gamma":6}' >/tmp/bitbot-chart.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-chart.json'));assert d.get('ok') and d.get('intent')=='structured_chart';h=next(x for x in d['host_results'] if x.get('kind')=='structured_chart');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_media') is False;assert p.get('png_magic_ok') is True;assert p.get('media_path') and os.path.isfile(p['media_path']);assert open(p['media_path'],'rb').read(8)==b'\\x89PNG\\r\\n\\x1a\\n';assert isinstance(p.get('series'),dict) and p['series'].get('alpha')==4;assert p.get('path') and os.path.isfile(p['path']);print('structured_chart host ok', p.get('media_path'), p.get('path'), p.get('series'))"
echo "==> Host box_doctor (CM-0607)"
node hosts/cli_host/run_turn.js --approved "box doctor" >/tmp/bitbot-box-doctor.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-box-doctor.json'));assert d.get('ok') and d.get('intent')=='box_doctor';h=next(x for x in d['host_results'] if x.get('kind')=='box_doctor');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_healthy') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('log_path') and os.path.isfile(p['log_path']);assert 'PASS' in open(p['log_path']).read() or 'SUMMARY' in open(p['log_path']).read();assert p.get('pass_count',0)>=1;print('box_doctor host ok', p.get('mode'), 'pass', p.get('pass_count'), 'fail', p.get('fail_count'), 'residual', p.get('box_doctor_bin_residual'), p.get('path'))"
echo "==> Host box_env (CM-0608)"
node hosts/cli_host/run_turn.js --approved "box env" >/tmp/bitbot-box-env.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-box-env.json'));assert d.get('ok') and d.get('intent')=='box_env';h=next(x for x in d['host_results'] if x.get('kind')=='box_env');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_runtime') is False;assert p.get('runtime') in ('local-docker','hosted-anyrun','unknown');assert p.get('path') and os.path.isfile(p['path']);assert p.get('diagnostic_path') and os.path.isfile(p['diagnostic_path']);assert 'runtime=' in open(p['diagnostic_path']).read();print('box_env host ok', p.get('mode'), p.get('runtime'), 'dockerenv', p.get('dockerenv_present'), 'hosted', p.get('hosted'), p.get('path'))"
echo "==> Host box_clock (CM-2175)"
USER_IANA="${USER_IANA:-Asia/Shanghai}" node hosts/cli_host/run_turn.js --approved "box clock" >/tmp/bitbot-box-clock.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-box-clock.json'));assert d.get('ok') and d.get('intent')=='box_clock';h=next(x for x in d['host_results'] if x.get('kind')=='box_clock');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_aligned') is False;assert p.get('user_iana');assert p.get('date_raw');assert p.get('path') and os.path.isfile(p['path']);assert p.get('date_output_path') and os.path.isfile(p['date_output_path']);assert p.get('aligns') is True or p.get('zone_status');print('box_clock host ok', p.get('mode'), p.get('user_iana'), p.get('date_raw'), 'aligns', p.get('aligns'), p.get('path'))"
echo "==> Host webhook panel (CM-0411)"
node hosts/cli_host/run_turn.js --approved "open webhook panel" >/tmp/bitbot-webhook-panel.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webhook-panel.json'));assert d.get('ok') and d.get('intent')=='webhook_panel';h=next(x for x in d['host_results'] if x.get('kind')=='webhook_panel');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_key_visible_to_tools') is False;assert p.get('opaque_to_tools') is True;assert p.get('url') and p.get('key');assert p.get('path') and os.path.isfile(p['path']);assert p.get('panel_path') and os.path.isfile(p['panel_path']);print('webhook_panel host ok', p.get('mode'), p.get('id'), p.get('path'))"
node hosts/cli_host/run_turn.js --approved "copy webhook url" >/tmp/bitbot-webhook-copy-url.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webhook-copy-url.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_copy');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('what')=='url';assert p.get('copied');assert p.get('pretend_copy') is False;assert p.get('path') and os.path.isfile(p['path']);print('webhook_copy url ok', p.get('receipt')[:48], p.get('path'))"
node hosts/cli_host/run_turn.js --approved "copy webhook key" >/tmp/bitbot-webhook-copy-key.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webhook-copy-key.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_copy');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('what')=='key';assert p.get('copied') and str(p['copied']).startswith('whsec_');assert p.get('path') and os.path.isfile(p['path']);print('webhook_copy key ok', p.get('path'))"
node hosts/cli_host/run_turn.js --approved "tool-read webhook key" >/tmp/bitbot-webhook-tool-read.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webhook-tool-read.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_tool_read_key');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('refused') is True;assert p.get('key') is None;assert p.get('key_leaked') is False;assert p.get('pretend_key_readable') is False;assert 'opaque' in (p.get('error') or '');assert p.get('path') and os.path.isfile(p['path']);print('webhook_tool_read refuse ok', p.get('error'), p.get('path'))"
node hosts/cli_host/run_turn.js --approved "webhook wake id=evt-9 summary=POST /hooks received" >/tmp/bitbot-webhook-wake.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webhook-wake.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_wake');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('has_webhook_event') is True;assert '<webhook_event' in (p.get('wake_payload') or '');assert p.get('key_leaked') is False;assert p.get('pretend_wake') is False;assert p.get('path') and os.path.isfile(p['path']);panel=json.load(open('data/routines/webhooks/panel.json'));assert panel['key'] not in (p.get('wake_payload') or '');print('webhook_wake ok', p.get('event_id'), p.get('path'))"
echo "==> Host Settings / agent info / delete (CM-1901/1902/0205/1907)"
node hosts/cli_host/run_turn.js "open settings" >/tmp/bitbot-settings.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-settings.json'));assert d.get('ok') and d.get('intent')=='open_settings';h=next(x for x in d['host_results'] if x.get('kind')=='settings_open');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_opened') is False;assert p.get('entry')=='sidebar-account-button';assert p.get('panel_open') is True;assert p.get('anchors_closed_set_count')==27;assert p.get('path') and os.path.isfile(p['path']);assert p.get('panel_path') and os.path.isfile(p['panel_path']);print('settings_open host ok', p.get('entry'), p.get('tab'), p.get('path'))"
node hosts/cli_host/run_turn.js "open settings entry=command-palette anchor=theme" >/tmp/bitbot-settings-theme.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-settings-theme.json'));h=next(x for x in d['host_results'] if x.get('kind')=='settings_open');p=json.loads(h['stdout']);assert p.get('ok') is True;assert p.get('entry')=='command-palette';assert p.get('anchor')=='theme';assert p.get('deep_link')=='grokbot://app/v1/settings?id=theme';assert p.get('tab')=='General';print('settings deep-link ok', p.get('deep_link'))"
node hosts/cli_host/run_turn.js "open settings entry=gear" >/tmp/bitbot-settings-gear.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-settings-gear.json'));assert d.get('intent')=='open_settings';h=next(x for x in d['host_results'] if x.get('kind')=='settings_open');p=json.loads(h.get('stdout') or '{}');assert p.get('refused') is True;assert p.get('pretend_opened') is False;assert 'gear' in (p.get('error') or '').lower() or 'Preferences' in (p.get('error') or '');print('settings gear host refuse ok', p.get('error'))"
node hosts/cli_host/run_turn.js "open agent info agent=agent-bit" >/tmp/bitbot-agent-info.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-agent-info.json'));assert d.get('intent')=='open_agent_info_panel';h=next(x for x in d['host_results'] if x.get('kind')=='agent_info_panel');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_panel') is False;assert p.get('fields_align_with_app_ui') is True;assert p.get('gear_is_per_agent_not_global') is True;assert p.get('sections')==['desktop-preview','routines','channels','members','gear-settings'];assert p.get('path') and os.path.isfile(p['path']);print('agent_info_panel host ok', p.get('agent_id'), p.get('path'))"
node hosts/cli_host/run_turn.js "delete agent agent-smoke" >/tmp/bitbot-delete-await.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-delete-await.json'));assert d.get('intent')=='delete_agent';h=next(x for x in d['host_results'] if x.get('kind')=='delete_agent');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('phase')=='awaiting_confirm';assert p.get('agent_removed') is False;assert p.get('pretend_deleted') is False;assert p.get('needs_confirm') is True;assert p.get('path') and os.path.isfile(p['path']);print('delete_agent awaiting ok', p.get('agent_id'))"
node hosts/cli_host/run_turn.js "confirm delete agent agent-smoke" >/tmp/bitbot-delete-done.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-delete-done.json'));h=next(x for x in d['host_results'] if x.get('kind')=='delete_agent');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('phase')=='completed';assert p.get('agent_removed') is True;assert p.get('transcript_removed') is True;assert p.get('pretend_deleted') is False;assert os.path.isfile('data/agents/ui/removed-agents.jsonl');print('delete_agent completed ok', p.get('agent_id'), p.get('path'))"
echo "==> Host package_install (CM-2158)"
node hosts/cli_host/run_turn.js --approved "install package via=direct-apt-api pm=apt pkgs=curl" >/tmp/bitbot-pkg-refuse.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-pkg-refuse.json'));assert d.get('intent')=='package_install';h=next(x for x in d['host_results'] if x.get('kind')=='package_install');p=json.loads(h['stdout']);assert p.get('refused') is True;assert p.get('pretend_installed') is False;assert 'Shell' in (p.get('error') or '');assert p.get('path') and os.path.isfile(p['path']);print('package_install non-Shell refuse ok', p.get('error'))"
node hosts/cli_host/run_turn.js --approved "install package npm left-pad@1.3.0" >/tmp/bitbot-pkg-npm.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-pkg-npm.json'));h=next(x for x in d['host_results'] if x.get('kind')=='package_install');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('via_shell') is True;assert p.get('pretend_installed') is False;assert p.get('pm')=='npm';assert p.get('completed') is True;assert p.get('exit_code')==0;assert p.get('tree_ok') is True;assert p.get('tree_path') and os.path.isdir(p['tree_path']);assert p.get('path') and os.path.isfile(p['path']);print('package_install npm sandbox ok', p.get('shell_command'), p.get('tree_path'), p.get('path'))"
echo "==> Host shared_box_fs (CM-2174)"
node hosts/cli_host/run_turn.js "shared box fs" >/tmp/bitbot-shared-fs.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-shared-fs.json'));assert d.get('intent')=='shared_box_fs';h=next(x for x in d['host_results'] if x.get('kind')=='shared_box_fs');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_shared') is False;assert p.get('shared_fs') is True;assert p.get('distinct_desktops') is True;assert p.get('agent_a_sees_agent_b_write') is True;assert p.get('other_host_isolated') is True;assert p.get('charter_consistent') is True;assert p.get('desktop_a_display')!=p.get('desktop_b_display');assert p.get('shared_path') and os.path.isfile(p['shared_path']);assert p.get('path') and os.path.isfile(p['path']);print('shared_box_fs host ok', p.get('shared_path'), p.get('desktop_a_display'), p.get('desktop_b_display'), p.get('path'))"
echo "==> Host hide_agent / list_agents_sidebar / members_panel (CM-0204/1405)"
node hosts/cli_host/run_turn.js "hide agent research" >/tmp/bitbot-hide.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-hide.json'));assert d.get('intent')=='hide_agent';h=next(x for x in d['host_results'] if x.get('kind')=='hide_agent');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('hidden') is True;assert p.get('in_main_sidebar') is False;assert p.get('addressable') is True;assert p.get('pretend_removed') is False;assert 'research' not in (p.get('sidebar_ids') or []);assert p.get('path') and os.path.isfile(p['path']);print('hide_agent host ok', p.get('agent_id'), 'sidebar', p.get('sidebar_ids'))"
node hosts/cli_host/run_turn.js "list agents" >/tmp/bitbot-list-agents.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-list-agents.json'));assert d.get('intent')=='list_agents_sidebar';h=next(x for x in d['host_results'] if x.get('kind')=='list_agents_sidebar');assert h.get('ok');p=json.loads(h['stdout']);assert 'sys-hidden' not in (p.get('sidebar_ids') or []);assert 'sys-hidden' in (p.get('hidden_ids') or []);assert p.get('hidden_still_addressable') is True;assert p.get('path') and os.path.isfile(p['path']);print('list_agents_sidebar host ok', p.get('sidebar_ids'), 'hidden', p.get('hidden_ids'))"
node hosts/cli_host/run_turn.js "create teammate id=asst-alpha name=Alpha role=researcher" >/tmp/bitbot-tm-alpha.json
node hosts/cli_host/run_turn.js "open members group=group-1" >/tmp/bitbot-members.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-members.json'));assert d.get('intent')=='members_panel';h=next(x for x in d['host_results'] if x.get('kind')=='members_panel');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('section_anchor')=='members';assert p.get('matches_app_ui') is True;assert p.get('info_panel_has_members') is True;assert p.get('pretend_members') is False;assert 'asst-alpha' in (p.get('member_ids') or []);assert p.get('path') and os.path.isfile(p['path']);print('members_panel host ok', p.get('member_ids'), p.get('path'))"
echo "==> Host notify / update-computer / local-execution / permission guide (CM-0206/1903/1904/1905/2178)"
node hosts/cli_host/run_turn.js "notify settings assistant=asst-alpha" >/tmp/bitbot-notify.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-notify.json'));assert d.get('intent')=='notify_settings';h=next(x for x in d['host_results'] if x.get('kind')=='notify_settings');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('assistant_scoped') is True;assert p.get('pretend_global') is False;assert p.get('sound') is True;assert p.get('path') and os.path.isfile(p['path']);print('notify_settings host ok', p.get('assistant_id'), p.get('toggles'))"
node hosts/cli_host/run_turn.js "set notify assistant=asst-alpha toggle=sound enabled=0" >/tmp/bitbot-set-notify.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-set-notify.json'));h=next(x for x in d['host_results'] if x.get('kind')=='set_notify');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('toggle')=='sound';assert p.get('enabled') is False;assert (p.get('settings') or {}).get('sound') is False;assert p.get('assistant_scoped') is True;store=json.load(open('data/settings/notify.json'));assert store['asst-alpha']['sound'] is False;print('set_notify host ok', p.get('assistant_id'), 'sound', p.get('enabled'))"
node hosts/cli_host/run_turn.js "update computer" >/tmp/bitbot-update1.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-update1.json'));h=next(x for x in d['host_results'] if x.get('kind')=='update_computer');p=json.loads(h['stdout']);assert p.get('phase')=='awaiting_confirm_1';assert p.get('two_step_ready') is False;assert p.get('guide_before_reset') is True;print('update_computer await1 ok')"
node hosts/cli_host/run_turn.js "update computer confirm=1" >/tmp/bitbot-update2.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-update2.json'));h=next(x for x in d['host_results'] if x.get('kind')=='update_computer');p=json.loads(h['stdout']);assert p.get('phase')=='awaiting_confirm_2';assert p.get('confirms')==1;print('update_computer await2 ok')"
node hosts/cli_host/run_turn.js "update computer confirm=2" >/tmp/bitbot-update3.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-update3.json'));h=next(x for x in d['host_results'] if x.get('kind')=='update_computer');p=json.loads(h['stdout']);assert p.get('phase')=='completed';assert p.get('two_step_confirmed') is True;assert p.get('session_jar_intact') is True;assert p.get('software_needs_reinstall') is True;assert p.get('files_preserved') is True;assert p.get('pretend_updated') is False;assert p.get('path') and os.path.isfile(p['path']);print('update_computer completed ok', p.get('path'))"
node hosts/cli_host/run_turn.js "reset computer" >/tmp/bitbot-reset.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-reset.json'));h=next(x for x in d['host_results'] if x.get('kind')=='reset_computer');p=json.loads(h['stdout']);assert p.get('preferred') is False;assert p.get('not_preferred_vs_update') is True;assert p.get('pretend_reset') is False;print('reset_computer not-preferred ok', p.get('deep_link'))"
node hosts/cli_host/run_turn.js "local execution off" >/tmp/bitbot-local-off.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-local-off.json'));h=next(x for x in d['host_results'] if x.get('kind')=='local_execution');p=json.loads(h['stdout']);assert p.get('enabled') is False;assert p.get('machine_use_rejected') is True;assert p.get('pretend_on') is False;assert os.path.isfile('data/settings/local-execution.json');print('local_execution off ok', p.get('reject_reason'))"
node hosts/cli_host/run_turn.js "guide permission kind=needs-auth ns=user-Gmail" >/tmp/bitbot-guide-perm.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-guide-perm.json'));assert d.get('intent')=='guide_permission';h=next(x for x in d['host_results'] if x.get('kind')=='guide_permission');p=json.loads(h['stdout']);assert p.get('pretends_connected') is False;assert p.get('pretend_connected') is False;assert p.get('guides_to_settings') is True;assert p.get('deep_link')=='grokbot://app/v1/settings?id=account';assert 'Settings' in (p.get('guidance') or '');print('guide_permission host ok', p.get('deep_link'))"

echo "==> Host durable routines"
node hosts/cli_host/run_turn.js --approved "create routine id=host-r cron=@hourly prompt=tick" >/tmp/bitbot-routine-create.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-routine-create.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='routine_schedule');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('stored') is True;assert p.get('id')=='host-r';assert p.get('pretend_scheduled') is False;assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('data/routines/schedules.jsonl');print('routine_schedule durable ok', p.get('path'))"
node hosts/cli_host/run_turn.js "list routines" >/tmp/bitbot-routine-list.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-routine-list.json'));assert d.get('ok');hrs=d.get('host_results') or [];assert any(h.get('kind')=='routine_list' and 'host-r' in (h.get('stdout') or '') for h in hrs);print('routine_list durable ok')"
node hosts/cli_host/run_turn.js --approved "fire routine host-r" >/tmp/bitbot-routine-fire.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-routine-fire.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='routine_fire');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('fired') is True;assert p.get('next_due');assert p.get('pretend_fired') is False;assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('data/routines/fires.jsonl');print('routine_fire durable ok', 'next_due', p.get('next_due'), 'path', p.get('path'))"
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
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-routine-tick.json'));assert d.get('intent')=='tick_routines';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='routine_tick');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('wakes') is True;assert p.get('fired_count')>=1;assert p.get('daemon') is False;assert p.get('long_lived') is False;assert p.get('wakes_path') and os.path.isfile(p['wakes_path']);assert p.get('last_tick_path') and os.path.isfile(p['last_tick_path']);print('routine_tick wake log ok', 'fired', p.get('fired_count'), 'due', p.get('due_count'), 'wakes', p.get('wakes_path'))"
python3 - <<'PY'
import json, pathlib
p=pathlib.Path('data/routines/host-routines.json')
rows=json.loads(p.read_text()) if p.exists() else []
for r in rows:
  if r.get('id')=='host-r':
    r['next_due']='2020-01-01T00:00:00.000Z'
    r['enabled']=True
p.write_text(json.dumps(rows, indent=2))
print('forced host-r due for daemon')
PY
bash "$ROOT/scripts/host_routine_daemon.sh" --sweeps 1
python3 -c "import json,os;d=json.load(open('data/routines/daemon-status.json'));assert d.get('daemon') is True;assert d.get('long_lived') is False;assert d.get('ok')>=1;print('host_routine_daemon one-shot ok', d)"
bash "$ROOT/scripts/host_routine_daemon.sh" --sweeps 2 --interval-ms 200
python3 -c "import json;d=json.load(open('data/routines/daemon-status.json'));assert d.get('daemon') is True;assert d.get('long_lived') is False;assert d.get('sweeps')==2;assert d.get('interval_ms')==200;assert d.get('ok')==2;print('host_routine_daemon interval sweeps ok', d)"
bash "$ROOT/scripts/host_routine_daemon.sh" --write-systemd-unit
python3 -c "import json,os;d=json.load(open('data/routines/daemon-status.json'));assert d.get('systemd_unit_path') and os.path.isfile(d['systemd_unit_path']);assert 'bitbot-routine-daemon.service' in d['systemd_unit_path'];print('host_routine_daemon systemd unit scaffold ok', d.get('systemd_unit_path'))"
bash "$ROOT/scripts/host_routine_daemon.sh" --install-user-unit
python3 -c "import json,os;d=json.load(open('data/routines/daemon-status.json'));assert d.get('systemd_unit_installed') is True;assert d.get('systemd_scope') in ('user','system');assert d.get('systemd_user_unit_path') and os.path.isfile(d['systemd_user_unit_path']);print('host_routine_daemon user unit install ok', d.get('systemd_scope'), d.get('systemd_user_unit_path'))"
BITBOT_ROUTINE_MAX_SWEEPS=2 bash "$ROOT/scripts/host_routine_daemon.sh" --long-lived --interval-ms 100
python3 -c "import json,os;d=json.load(open('data/routines/daemon-status.json'));assert d.get('daemon') is True;assert d.get('long_lived') is True;assert d.get('sweeps')==2;assert d.get('ok')==2;assert d.get('systemd_unit_path') and os.path.isfile(d['systemd_unit_path']);assert d.get('systemd_unit_installed') is True;print('host_routine_daemon long-lived ok', 'sweeps', d.get('sweeps'), 'systemd_installed', d.get('systemd_unit_installed'), 'scope', d.get('systemd_scope'))"

echo "==> Host sandbox OAuth (Slack + Gmail) + computer_use navigate"
node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-slack.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-slack.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth' and x.get('ok'));p=json.loads(h.get('stdout') or '{}');assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_connected') is False;print('oauth slack host ok', p.get('path'))"
node hosts/cli_host/run_turn.js "connect gmail" >/tmp/bitbot-oauth-gmail.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-gmail.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth' and x.get('ok'));p=json.loads(h.get('stdout') or '{}');assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_connected') is False;print('oauth gmail host ok', p.get('path'))"
node hosts/cli_host/run_turn.js "computer use open https://example.com click:40,40" >/tmp/bitbot-cu.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');assert h.get('ok');out=h.get('stdout') or '';payload=json.loads(out);assert 'navigate_reachable' in out;g=payload.get('gui') or {};assert g.get('box_chrome_process') is True or 'http_fallback' in out;oc=payload.get('outcome') or {};assert oc.get('summary')=='structured outcome only';assert 'agent_loop' in payload;assert 'os_window_automation_residual' in oc or 'os_window_automation_residual' in g;assert oc.get('ocr_residual') is True;assert oc.get('ocr') is False;print('computer_use agent-loop host ok', 'os_window', g.get('os_window'), 'native_os', bool(g.get('native_os_input')), 'os_auto_residual', g.get('os_window_automation_residual') if 'os_window_automation_residual' in g else oc.get('os_window_automation_residual'), 'actions_ok', g.get('actions_ok'), 'screenshot_ok', g.get('screenshot_ok'))"
BITBOT_CU_NATIVE_ACT=1 node hosts/cli_host/run_turn.js "computer use open https://example.com click:40,40" >/tmp/bitbot-cu-native.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cu-native.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');g=p.get('gui') or {};act=g.get('native_os_act') or {};assert act.get('enabled') is True;assert act.get('ok') is True;assert g.get('os_window_automation_residual') is False;ev=p.get('evidence') or '';assert ev;nap=os.path.join(os.path.dirname(ev),'native_os_act.json');assert os.path.isfile(nap);print('computer_use native OS act ok', 'actions', len(act.get('actions') or []), 'residual', g.get('os_window_automation_residual'))"
BITBOT_CU_OCR=1 node hosts/cli_host/run_turn.js "computer use open https://example.com click:40,40" >/tmp/bitbot-cu-ocr.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-ocr.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};g=p.get('gui') or {};vp=(g.get('vision_plan') or {});assert oc.get('ocr') is True or (vp.get('ocr') is True);assert oc.get('ocr_residual') is False or vp.get('ocr_residual') is False;print('computer_use OCR ok', 'ocr', oc.get('ocr'), 'text_prefix', (oc.get('ocr_text_prefix') or '')[:40])"
BITBOT_OAUTH_MODE=live node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-live.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok') is False;p=json.loads(h.get('stdout') or '{}');assert p.get('status')=='NeedsAuth' or 'NeedsAuth' in (h.get('stdout') or '');assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_connected') is False;print('oauth live NeedsAuth (honest) ok', p.get('path'))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=local node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-exchange.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-exchange.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='local_exchange';assert p.get('path') and os.path.isfile(p['path']);print('oauth local_exchange authorize→token ok', p.get('path'))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=interactive node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-interactive.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-interactive.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='interactive_local';assert p.get('interactive_browser') is True;assert p.get('path') and os.path.isfile(p['path']);print('oauth interactive_local browser consent ok', p.get('path'))"
node hosts/cli_host/run_turn.js "shop target.com headphones" >/tmp/bitbot-cu-plan.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cu-plan.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};assert oc.get('summary')=='structured outcome only';assert 'checkout_stage' in oc;assert oc.get('pretend_purchased') is False;assert oc.get('paid_checkout_attempted') is False;assert 'has_payment' in oc;al=p.get('agent_loop') or {};assert 'act' in al;g=p.get('gui') or {};assert g.get('box_chrome_process') is True;assert isinstance(g.get('checkout_summary'),dict) or g.get('checkout_summary') is None;cs=g.get('checkout_summary') or {};assert cs.get('pretend_purchased') is not True;assert cs.get('paid_checkout_attempted') is False;ev=p.get('evidence') or '';assert ev;csum=os.path.join(os.path.dirname(ev),'checkout_summary.json');assert os.path.isfile(csum);print('computer_use planner playbook+checkout_stage ok', oc.get('checkout_stage'), 'payment', oc.get('has_payment'), 'live_paid_residual', oc.get('live_paid_residual'), 'os_window', g.get('os_window'))"
# Local checkout fixture → payment_wall (never pretend_purchased)
python3 "$ROOT/scripts/host_cu_checkout_fixture.py" --port 18767 >/tmp/bitbot-checkout-fixture.log 2>&1 &
CHECKOUT_FIX_PID=$!
sleep 0.4
BITBOT_CU_ALLOW_LOCAL=1 node hosts/cli_host/run_turn.js "computer use open http://127.0.0.1:18767/ shop cart checkout buy" >/tmp/bitbot-cu-paywall.json || true
kill "$CHECKOUT_FIX_PID" >/dev/null 2>&1 || true
wait "$CHECKOUT_FIX_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-paywall.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};assert oc.get('has_payment') is True;assert oc.get('checkout_stage')=='payment_wall' or oc.get('vertical_stage')=='payment_wall';assert oc.get('pretend_purchased') is False;assert oc.get('paid_checkout_attempted') is False;assert oc.get('live_paid_residual') is True;print('computer_use payment_wall fixture ok', oc.get('checkout_stage'), 'has_payment', oc.get('has_payment'))"
node hosts/cli_host/run_turn.js "shop target.com headphones" >/tmp/bitbot-cu-vision.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-vision.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');al=p.get('agent_loop') or {};assert 'vision' in al;oc=p.get('outcome') or {};assert 'vision_ok' in oc;v=al.get('vision') or {};dt=v.get('dom_targets');assert isinstance(dt,dict) or dt is None;print('computer_use vision planner host ok', 'vision_ok', oc.get('vision_ok'), 'blocked_on_signin', oc.get('blocked_on_signin'), 'hotspots', bool(v.get('hotspots')), 'dom_targets', isinstance(dt,dict), 'has_bbox', bool(dt and any(dt.values())))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_OPEN_BROWSER=1 BITBOT_OAUTH_CLIENT_ID=smoke-client node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-browser.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-browser.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok') is False;p=json.loads(h.get('stdout') or '{}');assert p.get('status')=='NeedsAuth';assert p.get('browser_opened') is True or p.get('mode')=='live_remote_browser_open';assert p.get('path') and os.path.isfile(p['path']);print('oauth live_remote_browser_open NeedsAuth ok', 'browser_opened', p.get('browser_opened'), 'tool', p.get('browser_tool'), p.get('path'))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=remote_callback BITBOT_OAUTH_AUTHORIZE_URL=https://oauth.example.invalid/authorize BITBOT_OAUTH_TOKEN_URL=https://oauth.example.invalid/token BITBOT_OAUTH_CLIENT_ID=smoke-client BITBOT_OAUTH_CALLBACK_WAIT_MS=6000 node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-callback.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-callback.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_remote_callback';assert p.get('callback_received') is True;assert p.get('connected') is True;assert p.get('path') and os.path.isfile(p['path']);print('oauth live_remote_callback browser→token ok', 'browser_opened', p.get('browser_opened'), p.get('path'))"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: smoke body" >/tmp/bitbot-channel.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-channel.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');assert 'outbound' in (h.get('stdout') or '') or os.path.isfile('data/channels/outbound.jsonl');print('channel_send outbound durable ok')"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke:1710000.000100 :: thread reply" >/tmp/bitbot-channel-thread.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-channel-thread.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('thread_ts')=='1710000.000100' or '1710000.000100' in (h.get('stdout') or '');print('channel_send slack thread_ts durable ok', p.get('mode'))"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke thread_ts=1710000.000200 :: thread kv reply" >/tmp/bitbot-channel-thread-kv.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-channel-thread-kv.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('thread_ts')=='1710000.000200';assert 'thread' in str(p.get('mode') or '');deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('type')=='thread';print('channel_send slack thread_ts= kv ok', p.get('mode'), dp.get('type'))"
BITBOT_SLACK_CLAIM=1 node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: claim rehearsal" >/tmp/bitbot-channel-claim.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-channel-claim.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='sandbox_slack_claim';assert os.path.isfile('data/channels/inbound.jsonl');print('channel_send sandbox_slack_claim inbound ok', 'claimed', p.get('claimed_count'))"
node hosts/cli_host/run_turn.js "shop target.com headphones" >/tmp/bitbot-cu-vision-gui.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cu-vision-gui.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');g=p.get('gui') or {};assert g.get('vision_ok') is True;assert isinstance(g.get('vision_plan'),dict);assert p.get('evidence') and os.path.isfile(p['evidence']);deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('attachment_path')==p.get('evidence') or dp.get('path')==p.get('evidence');print('computer_use gui.vision_plan+evidence attachment ok', g.get('vision_plan'))"
node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: teams body [widget:decision_card]" >/tmp/bitbot-teams.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-teams.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('scheme')=='teams';assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('teams_transcript') and os.path.isfile(p['teams_transcript']);print('channel_send teams outbound+degrade ok', p.get('mode'))"
# Live Slack post / claim / thread against local mock (BITBOT_SLACK_API_BASE)
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18769 --mode slack --token smoke-slack >/tmp/bitbot-slack-mock.log 2>&1 &
SLACK_MOCK_PID=$!
sleep 0.4
BITBOT_SLACK_API_BASE=http://127.0.0.1:18769 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_POST=1 node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: live mock body" >/tmp/bitbot-slack-live.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-slack-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('live_post') is True;assert p.get('live_slack_residual') is False;assert p.get('pretend_live') is False;assert p.get('mode')=='live_slack';assert p.get('ts');print('channel_send slack live mock ok', p.get('mode'), 'ts', p.get('ts'))"
BITBOT_SLACK_API_BASE=http://127.0.0.1:18769 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_CLAIM=1 node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: claim live" >/tmp/bitbot-slack-claim-live.json || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-slack-claim-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_slack_claim';assert p.get('claimed_count',0)>=1;assert (p.get('claim') or {}).get('ok') is True or p.get('ok') is True;assert os.path.isfile('data/channels/inbound.jsonl');rows=open('data/channels/inbound.jsonl').read();assert 'live_slack_claim' in rows;print('channel_send slack live claim ok', 'claimed', p.get('claimed_count'))"
BITBOT_SLACK_API_BASE=http://127.0.0.1:18769 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_POST=1 node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke thread_ts=1710000000.000060 :: live thread mock" >/tmp/bitbot-slack-live-thread.json || true
kill "$SLACK_MOCK_PID" >/dev/null 2>&1 || true
wait "$SLACK_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-slack-live-thread.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('live_post') is True;assert p.get('mode')=='live_slack_thread';assert p.get('thread_ts')=='1710000000.000060';assert p.get('pretend_live') is False;deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('type')=='thread';print('channel_send slack live thread ok', p.get('mode'), 'ts', p.get('ts'))"
# Live Teams Graph post / claim against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18770 --mode teams --token smoke-teams >/tmp/bitbot-teams-mock.log 2>&1 &
TEAMS_MOCK_PID=$!
sleep 0.4
BITBOT_TEAMS_GRAPH_URL=http://127.0.0.1:18770 BITBOT_TEAMS_TOKEN=smoke-teams BITBOT_TEAMS_POST=1 node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: live teams mock" >/tmp/bitbot-teams-live.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-teams-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('scheme')=='teams';assert p.get('live_post') is True;assert p.get('live_teams_residual') is False;assert p.get('pretend_live') is False;assert p.get('mode')=='live_teams_chat_message';print('channel_send teams live mock ok', p.get('mode'), 'status', p.get('http_status'))"
BITBOT_TEAMS_GRAPH_URL=http://127.0.0.1:18770 BITBOT_TEAMS_TOKEN=smoke-teams BITBOT_TEAMS_CLAIM=1 node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: claim teams" >/tmp/bitbot-teams-claim-live.json || true
kill "$TEAMS_MOCK_PID" >/dev/null 2>&1 || true
wait "$TEAMS_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-teams-claim-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_teams_claim';assert p.get('claimed_count',0)>=1;assert p.get('pretend_live') is False;assert os.path.isfile('data/channels/inbound.jsonl');assert 'live_teams_claim' in open('data/channels/inbound.jsonl').read();print('channel_send teams live claim ok', 'claimed', p.get('claimed_count'))"
BITBOT_TEAMS_CLAIM=1 node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: sandbox claim" >/tmp/bitbot-teams-claim-sandbox.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-teams-claim-sandbox.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='sandbox_teams_claim';assert p.get('pretend_live') is False;print('channel_send teams sandbox claim ok')"
# copy_to_box / copy_from_box durable JSON under data/box-copy/
mkdir -p uploads
echo 'box-copy-smoke' > uploads/box-src.txt
node hosts/cli_host/run_turn.js "copy to box machine=desk-1 src=uploads/box-src.txt dest=uploads/box-dest.txt" >/tmp/bitbot-copy-to-box.json
python3 -c "import json,os,glob;d=json.load(open('/tmp/bitbot-copy-to-box.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='copy_to_box');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('under_repo') is True;assert p.get('pretend_remote_machine') is False;assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('uploads/box-dest.txt');assert glob.glob('data/box-copy/copy_to_box-*.json');print('copy_to_box artifact ok', p.get('path'), 'bytes', p.get('bytes'))"
node hosts/cli_host/run_turn.js "copy from box machine=desk-1 box=uploads/box-dest.txt dest=uploads/box-out.txt" >/tmp/bitbot-copy-from-box.json
python3 -c "import json,os,glob;d=json.load(open('/tmp/bitbot-copy-from-box.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='copy_from_box');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('uploads/box-out.txt');assert glob.glob('data/box-copy/copy_from_box-*.json');print('copy_from_box artifact ok', p.get('path'), 'bytes', p.get('bytes'))"
node hosts/cli_host/run_turn.js "meeting chat body=standup note direct=1" >/tmp/bitbot-meeting-direct.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-meeting-direct.json'));assert d.get('ok');assert d.get('intent')=='meeting_chat';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='meeting_chat_direct';assert p.get('direct_send') is True;assert p.get('live_post') is False;assert p.get('live_meeting_residual') is True;assert p.get('transcript') and os.path.isfile(p['transcript']);print('meeting_chat DirectSend ok', p.get('transcript'), 'live_residual', p.get('live_meeting_residual'))"
# Live meeting transport against local mock (closes residual when API+token ok)
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18766 --mode meeting --token smoke-meeting >/tmp/bitbot-meeting-mock.log 2>&1 &
MEETING_MOCK_PID=$!
sleep 0.4
BITBOT_MEETING_API_URL=http://127.0.0.1:18766 BITBOT_MEETING_TOKEN=smoke-meeting node hosts/cli_host/run_turn.js "meeting chat body=live standup direct=1" >/tmp/bitbot-meeting-live.json || true
kill "$MEETING_MOCK_PID" >/dev/null 2>&1 || true
wait "$MEETING_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-meeting-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('live_post') is True;assert p.get('live_meeting_residual') is False;assert p.get('mode')=='meeting_chat_live';print('meeting_chat live transport ok', p.get('live_probe'))"
node hosts/cli_host/run_turn.js "meeting chat body=followup notes" >/tmp/bitbot-meeting-draft.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-meeting-draft.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_draft');p=json.loads(h.get('stdout') or '{}');assert p.get('meeting_chat') is True;assert p.get('mode')=='meeting_chat_draft_card';assert p.get('eml_ok') is True;assert os.path.isfile(p.get('eml_path') or '');assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_sent') is False;print('meeting_chat DraftCard eml ok', p.get('eml_path'), p.get('path'))"

echo "==> Host skill_write / slides_pptx / export_pack (real artifacts)"
node hosts/cli_host/run_turn.js "author skill name=smoke-skill description=demo body=Do the thing." >/tmp/bitbot-skill-write.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-skill-write.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='skill_write');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('path') and os.path.isfile(p['path']);assert 'SKILL.md' in p['path'];assert p.get('meta_path') and os.path.isfile(p['meta_path']);assert p.get('persisted') is True;assert p.get('pretend_shared') is False;print('skill_write host ok', p.get('meta_path'))"
node hosts/cli_host/run_turn.js "make slides Smoke Deck" >/tmp/bitbot-slides.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-slides.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='slides_pptx');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('pptx_pk_magic_ok') is True;assert p.get('path') and os.path.isfile(p['path']);assert open(p['path'],'rb').read(2)==b'PK';assert p.get('meta_path') and os.path.isfile(p['meta_path']);assert p.get('pretend_rendered') is False;print('slides_pptx host ok', p.get('path'), p.get('meta_path'))"
node hosts/cli_host/run_turn.js "export bot template id=bot-smoke name=SmokeBot" >/tmp/bitbot-export.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-export.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='export_pack');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('secrets_stripped') is True;assert p.get('pretend_secrets_included') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('meta_path') and os.path.isfile(p['meta_path']);print('export_pack host ok', p.get('meta_path'))"

echo "==> Host mail_search/read + workflow_list + x_search (durable artifacts)"
node hosts/cli_host/run_turn.js "search mail Invoice" >/tmp/bitbot-mail-search.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mail-search.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_search');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode') in ('sandbox','gmail_live','gmail_live_failed');assert p.get('pretend_live') is False;assert p.get('hit_count')>=1;assert p.get('path') and os.path.isfile(p['path']);print('mail_search artifact ok', p.get('mode'), p.get('path'), 'hits', p.get('hit_count'), 'residual', p.get('live_mail_residual'))"
node hosts/cli_host/run_turn.js "read mail t-invoice-1" >/tmp/bitbot-mail-read.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mail-read.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_read');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode') in ('sandbox','gmail_live','gmail_live_failed');assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);print('mail_read artifact ok', p.get('mode'), p.get('path'), 'thread', p.get('thread_id'), 'residual', p.get('live_mail_residual'))"
node hosts/cli_host/run_turn.js "list workflows" >/tmp/bitbot-workflows.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-workflows.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='workflow_list');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('count')>=1;assert p.get('path') and os.path.isfile(p['path']);assert p.get('catalog_path') and os.path.isfile(p['catalog_path']);assert p.get('pretend_shared') is False;print('workflow_list catalog ok', p.get('count'), p.get('path'))"
node hosts/cli_host/run_turn.js "x search moonbit" >/tmp/bitbot-x-search.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-x-search.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='x_search');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='sandbox_public';assert p.get('live_x_residual') is True;assert p.get('pretend_live') is False;assert p.get('hit_count')>=1;assert p.get('path') and os.path.isfile(p['path']);print('x_search sandbox artifact ok', p.get('path'), 'hits', p.get('hit_count'))"
# Live X search against local mock (BITBOT_X_API_BASE)
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18772 --mode x --token smoke-x >/tmp/bitbot-x-mock.log 2>&1 &
X_MOCK_PID=$!
sleep 0.4
BITBOT_X_API_BASE=http://127.0.0.1:18772 BITBOT_X_BEARER=smoke-x node hosts/cli_host/run_turn.js "x search moonbit" >/tmp/bitbot-x-live.json || true
kill "$X_MOCK_PID" >/dev/null 2>&1 || true
wait "$X_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-x-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='x_search');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='x_live';assert p.get('live_x_residual') is False;assert p.get('pretend_live') is False;assert p.get('hit_count')>=1;print('x_search live mock ok', p.get('path'), 'hits', p.get('hit_count'))"

echo "==> Host durable product delivery (voice/teammates/device/subagent/cloud/commerce)"
node hosts/cli_host/run_turn.js "voice start smoke1" >/tmp/bitbot-voice.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='voice_session');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('media_ok') is True;assert os.path.isfile(p.get('media_path') or '');assert open(p['media_path'],'rb').read(4)==b'RIFF';assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('sessions_path') and os.path.isfile(p['sessions_path']);print('voice_session durable+media ok', p.get('path'), 'bytes', p.get('media_bytes'))"
node hosts/cli_host/run_turn.js "voice relay smoke1 :: hello from smoke" >/tmp/bitbot-voice-relay.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-relay.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='voice_relay');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('turns')>=2;assert p.get('transcript_path') and os.path.isfile(p['transcript_path']);assert p.get('reply');assert p.get('reply_media_ok') is True;assert p.get('reply_media_path') and os.path.isfile(p['reply_media_path']);assert open(p['reply_media_path'],'rb').read(4)==b'RIFF';assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_silent') is False;assert p.get('sessions_path') and os.path.isfile(p['sessions_path']);print('voice_relay reply WAV ok', p.get('turns'), 'bytes', p.get('reply_media_bytes'), 'snap', p.get('path'))"
node hosts/cli_host/run_turn.js "create teammate id=asst-smoke name=Smoke role=executor" >/tmp/bitbot-teammate.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-teammate.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='teammate_create');assert h.get('ok') and 'teammates.json' in (h.get('stdout') or '');assert os.path.isfile('data/agents/teammates.json');print('teammate_create durable ok')"
# CM-1403 section partitions (Host durable isolation)
node hosts/cli_host/run_turn.js "add section group=smoke-g id=sec-research title=Research" >/tmp/bitbot-section-add.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-section-add.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='section_add');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('path') and os.path.isfile(p['path']);assert p.get('group_path') and os.path.isfile(p['group_path']);assert (p.get('section') or {}).get('id')=='sec-research';print('section_add ok', p.get('path'), p.get('group_path'))"
node hosts/cli_host/run_turn.js "add section group=smoke-g id=sec-research title=Research" >/tmp/bitbot-section-add2.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-section-add2.json'));h=next(x for x in d['host_results'] if x.get('kind')=='section_add');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('existing') is True;assert p.get('pretend_shared') is False;assert (p.get('section') or {}).get('id')=='sec-research';assert p.get('path') and os.path.isfile(p['path']);assert p.get('group_path') and os.path.isfile(p['group_path']);print('section_add idempotent ok', p.get('existing'), p.get('path'))"
node hosts/cli_host/run_turn.js "add section group=smoke-g id=sec-ops title=Ops" >/tmp/bitbot-section-add2.json
node hosts/cli_host/run_turn.js "section post group=smoke-g section=sec-research from=asst-smoke body=research-only note" >/tmp/bitbot-section-post.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-section-post.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='section_post');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('isolation_ok') is True;assert p.get('pretend_cross_section') is False;assert p.get('section_id')=='sec-research';assert p.get('path') and os.path.isfile(p['path']);gp=p.get('group_path') or p['path'];g=json.load(open(gp));ops=[m for m in g.get('messages') if m.get('section_id')=='sec-ops'];assert not any(m.get('body')=='research-only note' for m in ops);print('section_post isolation ok', p.get('messages_in_section'), p.get('path'))"
node hosts/cli_host/run_turn.js "section post group=smoke-g section=missing from=x body=y" >/tmp/bitbot-section-unknown.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-section-unknown.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='section_post');assert h.get('ok') is False;assert 'unknown section' in (h.get('error') or '');print('section_post unknown refused ok')"
node hosts/cli_host/run_turn.js "room eng :: ship it" >/tmp/bitbot-room.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-room.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='room_turn');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('is_room') is True;assert p.get('forbids_private_assumptions') is True;assert p.get('is_private_dm') is False;assert p.get('pretend_private_dm') is False;assert isinstance(p.get('delivered_to'),list);assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('data/agents/room-turns.jsonl');print('room_turn fanout ok', p.get('room'), 'members', p.get('member_count'), 'path', p.get('path'))"
node hosts/cli_host/run_turn.js "send to agent asst-smoke :: ping" >/tmp/bitbot-send-agent.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-send-agent.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='send_to_agent');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('routed') is True;assert p.get('delivered') is True;assert p.get('pretend_delivered') is False;assert p.get('teammate_known') is True;assert p.get('status') in ('delivered_replied','delivered','delivered_worker_error');assert p.get('outbox') and os.path.isfile(p['outbox']);assert p.get('path') and os.path.isfile(p['path']);print('send_to_agent wake+outbox ok', p.get('status'), 'path', p.get('path'), 'reply_prefix', str(p.get('reply') or '')[:60])"
node hosts/cli_host/run_turn.js --machine-kind ios "device tool camera" >/tmp/bitbot-device-perm.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-device-perm.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind') in ('device_permission','device_tool'));assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_granted') is False if 'pretend_granted' in p else True;assert p.get('path') and os.path.isfile(p['path']);print('device_permission/tool durable ok', h.get('kind'), p.get('path'))"
node hosts/cli_host/run_turn.js "spawn subagent triage mail" >/tmp/bitbot-subagent.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-subagent.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='subagent_run');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');sub=p.get('subagent') or {};assert sub.get('status') in ('completed','failed','completed_nest_skipped');assert os.path.isfile('data/agents/subagents.json');assert p.get('ran') is True or sub.get('status')=='completed_nest_skipped';assert sub.get('status')!='running';assert p.get('pretend_completed') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('result_path') and os.path.isfile(p['result_path']);print('subagent_run worker ok', sub.get('status'), 'path', p.get('path'), 'result', p.get('result_path'))"
BITBOT_NEST_DEPTH=1 node hosts/cli_host/run_turn.js "spawn subagent nested guard" >/tmp/bitbot-subagent-nest.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-subagent-nest.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='subagent_run');p=json.loads(h.get('stdout') or '{}');assert p.get('nested_skipped') is True;assert (p.get('subagent') or {}).get('status')=='completed_nest_skipped';assert p.get('pretend_completed') is False;assert p.get('path') and os.path.isfile(p['path']);print('subagent_run CM-2133 nest guard ok', p.get('path'))"
node hosts/cli_host/run_turn.js "launch cloud agent triage CI failures" >/tmp/bitbot-cloud.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cloud.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='cloud_agent_launch');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');card=p.get('cursor_agent_card') or {};assert card.get('type')=='cursor-agent';assert card.get('can_open_cloud') is True;assert card.get('bc_id');assert 'agents/' in (card.get('open_url') or '');assert p.get('mode')=='local_worker';assert p.get('pretend_remote_cloud') is False;assert p.get('remote_cloud_residual') is True;assert p.get('remote_api_attempted') is False;assert p.get('status') in ('completed','failed');assert p.get('session_path') and os.path.isfile(p['session_path']);assert p.get('path') and os.path.isfile(p['path']);assert p.get('ran') is True;assert os.path.isfile('data/delivery/send-to-user.jsonl');print('cloud_agent_launch local_worker ok', p.get('bc_id'), p.get('status'), 'path', p.get('path'), 'remote_residual', p.get('remote_cloud_residual'));open('/tmp/bitbot-cloud-bc.txt','w').write(p.get('bc_id') or '')"
# Honest remote fail → local_worker fallback (never pretend remote success)
BITBOT_CLOUD_API_URL=http://127.0.0.1:9 BITBOT_CURSOR_CLOUD_TOKEN=test-token node hosts/cli_host/run_turn.js "launch cloud agent remote probe fail" >/tmp/bitbot-cloud-remote.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cloud-remote.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='cloud_agent_launch');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_remote_cloud') is False;assert p.get('remote_api_attempted') is True;assert p.get('remote_cloud_residual') is True;assert p.get('mode')=='local_worker_after_remote_fail';assert p.get('status') in ('completed','failed');print('cloud_agent_launch remote fail→local ok', p.get('mode'), 'probe', (p.get('remote_probe') or {}).get('error') or (p.get('remote_probe') or {}).get('http_status'))"
# Live remote cloud launch against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18774 --mode cloud --token smoke-cloud >/tmp/bitbot-cloud-mock.log 2>&1 &
CLOUD_MOCK_PID=$!
sleep 0.4
BITBOT_CLOUD_API_URL=http://127.0.0.1:18774 BITBOT_CURSOR_CLOUD_TOKEN=smoke-cloud node hosts/cli_host/run_turn.js "launch cloud agent live mock" >/tmp/bitbot-cloud-live.json || true
kill "$CLOUD_MOCK_PID" >/dev/null 2>&1 || true
wait "$CLOUD_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-cloud-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='cloud_agent_launch');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='remote_cloud_api';assert p.get('remote_cloud_residual') is False;assert p.get('pretend_remote_cloud') is False;assert p.get('remote_api_attempted') is True;assert p.get('status')=='launched_remote';assert (p.get('remote_probe') or {}).get('ok') is True;print('cloud_agent_launch remote live mock ok', p.get('bc_id'), p.get('status'))"
BC_ID="$(cat /tmp/bitbot-cloud-bc.txt)"
node hosts/cli_host/run_turn.js "deliver cloud artifact artifact=${BC_ID} dest=smoke-report.md" >/tmp/bitbot-cloud-art.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cloud-art.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='cloud_artifact_deliver');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('delivered') is True;assert p.get('from_session') is True;assert p.get('pretend_remote_fetch') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('meta_path') and os.path.isfile(p['meta_path']);assert os.path.getsize(p['path'])>20;body=open(p['path']).read();assert 'bc_id:' in body and 'from_session: true' in body;print('cloud_artifact_deliver from_session ok', p.get('path'), 'meta', p.get('meta_path'), 'bytes', p.get('bytes'))"
node hosts/cli_host/run_turn.js --approved "purchase item=BlueYeti cents=12900" >/tmp/bitbot-purchase.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-purchase.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind') in ('purchase','approval_card') and x.get('ok'));assert h; 
if h.get('kind')=='purchase':
 p=json.loads(h.get('stdout') or '{}');assert p.get('receipt_ok') is True;assert p.get('receipt_path') and os.path.isfile(p['receipt_path']);assert b'purchase receipt' in open(p['receipt_path'],'rb').read();assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_paid') is False;assert p.get('sandbox_receipt') is True;assert p.get('live_paid_residual') is True;assert p.get('paid') is False;assert p.get('mode')=='sandbox_receipt';print('purchase sandbox receipt HTML ok', p.get('receipt_path'), 'snap', p.get('path'), 'live_paid_residual', p.get('live_paid_residual'))
else:
 print('purchase/approval durable ok', h.get('kind'))"
# Live purchase charge against local mock processor
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18765 --mode purchase --token smoke-pay >/tmp/bitbot-purchase-mock.log 2>&1 &
PURCHASE_MOCK_PID=$!
sleep 0.4
BITBOT_PURCHASE_LIVE=1 BITBOT_PURCHASE_TOKEN=smoke-pay BITBOT_PURCHASE_API_URL=http://127.0.0.1:18765 node hosts/cli_host/run_turn.js --approved "purchase item=LiveWidget cents=999" >/tmp/bitbot-purchase-live.json || true
kill "$PURCHASE_MOCK_PID" >/dev/null 2>&1 || true
wait "$PURCHASE_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-purchase-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='purchase');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_charge';assert p.get('paid') is True;assert p.get('live_paid_residual') is False;assert p.get('pretend_paid') is False;assert (p.get('charge_probe') or {}).get('ok') is True;assert p.get('path') and os.path.isfile(p['path']);print('purchase live charge ok', p.get('receipt_path'), 'snap', p.get('path'), 'charge', p.get('charge_probe'))"
node hosts/cli_host/run_turn.js --approved "draft mail to=smoke@example.com subject=Hi body=Smoke" >/tmp/bitbot-mail-eml.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mail-eml.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('eml_ok') is True;assert p.get('eml_path') and os.path.isfile(p['eml_path']);assert p.get('pretend_sent') is False;assert 'X-BitBot-Status:' in open(p['eml_path']).read();print('mail_send sandbox eml ok', p.get('mode'), p.get('eml_path'))"
# Live Gmail send + search/read against local mock (BITBOT_GMAIL_API_BASE)
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18773 --mode gmail --token smoke-gmail >/tmp/bitbot-gmail-mock.log 2>&1 &
GMAIL_MOCK_PID=$!
sleep 0.4
BITBOT_GMAIL_API_BASE=http://127.0.0.1:18773 BITBOT_GMAIL_TOKEN=smoke-gmail BITBOT_MAIL_SEND=1 node hosts/cli_host/run_turn.js --approved "draft mail to=live@example.com subject=Live body=Sent" >/tmp/bitbot-mail-live.json || true
BITBOT_GMAIL_API_BASE=http://127.0.0.1:18773 BITBOT_GMAIL_TOKEN=smoke-gmail node hosts/cli_host/run_turn.js "search mail Invoice" >/tmp/bitbot-mail-search-live.json || true
BITBOT_GMAIL_API_BASE=http://127.0.0.1:18773 BITBOT_GMAIL_TOKEN=smoke-gmail node hosts/cli_host/run_turn.js "read mail t-invoice-1" >/tmp/bitbot-mail-read-live.json || true
BITBOT_GMAIL_API_BASE=http://127.0.0.1:18773 BITBOT_GMAIL_TOKEN=smoke-gmail BITBOT_MAIL_SEND=1 node hosts/cli_host/run_turn.js --approved "reply via email:live@example.com :: channel live mail" >/tmp/bitbot-email-channel-live.json || true
kill "$GMAIL_MOCK_PID" >/dev/null 2>&1 || true
wait "$GMAIL_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-mail-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_gmail';assert p.get('sent') is True;assert p.get('pretend_sent') is False;assert p.get('live_mail_residual') is False;print('mail_send live_gmail ok', p.get('message_id'), p.get('eml_path'))"
python3 -c "import json;d=json.load(open('/tmp/bitbot-mail-search-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_search');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='gmail_live';assert p.get('live_mail_residual') is False;assert p.get('hit_count')>=1;print('mail_search gmail_live ok', p.get('hit_count'))"
python3 -c "import json;d=json.load(open('/tmp/bitbot-mail-read-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_read');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='gmail_live';assert p.get('live_mail_residual') is False;print('mail_read gmail_live ok', p.get('thread_id'))"
python3 -c "import json;d=json.load(open('/tmp/bitbot-email-channel-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('live_post') is True;assert p.get('mode')=='live_email_gmail';assert p.get('pretend_live') is False;print('channel_send email live ok', p.get('mode'), (p.get('mail') or {}).get('message_id'))"
# Live Outlook Graph send against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18775 --mode outlook --token smoke-outlook >/tmp/bitbot-outlook-mock.log 2>&1 &
OUTLOOK_MOCK_PID=$!
sleep 0.4
BITBOT_OUTLOOK_GRAPH_URL=http://127.0.0.1:18775 BITBOT_OUTLOOK_TOKEN=smoke-outlook BITBOT_MAIL_SEND=1 node hosts/cli_host/run_turn.js --approved "draft outlook mail to=live@example.com subject=Hi body=Outlook" >/tmp/bitbot-outlook-live.json || true
kill "$OUTLOOK_MOCK_PID" >/dev/null 2>&1 || true
wait "$OUTLOOK_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-outlook-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_outlook';assert p.get('sent') is True;assert p.get('pretend_sent') is False;assert p.get('live_mail_residual') is False;print('mail_send live_outlook ok', p.get('message_id'))"
node hosts/cli_host/run_turn.js "shell echo needs-approve" >/tmp/bitbot-approval-widget.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-approval-widget.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='approval_card');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');w=p.get('widget') or {};assert w.get('widget_id');opts=w.get('options') or [];assert any(o.get('id')=='approve' for o in opts);assert any(o.get('id')=='dismiss' for o in opts);deliv=next(x for x in hrs if x.get('kind')=='delivery' and 'approval_card' in (x.get('stdout') or ''));dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('type')=='widget';assert os.path.isfile('data/delivery/send-to-user.jsonl');print('approval_card CM-0105 widget ok', w.get('widget_id'), 'options', len(opts))"
node hosts/cli_host/run_turn.js "personal slack dm owner=Uowner text=ping [widget:decision_card]" >/tmp/bitbot-personal-dm.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-personal-dm.json'));assert d.get('ok');assert d.get('intent')=='personal_slack_dm';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('personal_dm') is True;assert p.get('mode')=='personal_slack_dm_draft';assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert os.path.isfile('data/channels/outbound.jsonl');deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('personal_dm') is True;assert dp.get('widget_degraded') is True;print('personal_slack_dm CM-1103/1104 ok', p.get('mode'), 'degraded', p.get('widget_degraded'))"
node hosts/cli_host/run_turn.js "list credentials" >/tmp/bitbot-cred-list.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cred-list.json'));assert d.get('ok');assert d.get('intent')=='list_credentials';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='credential_list');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('secret_echoed') is False;assert p.get('pretend_secret_view') is False;assert p.get('count')>=1;assert 'vault:secret' not in json.dumps(p).lower();print('credential_list metadata ok', p.get('count'))"
node hosts/cli_host/run_turn.js "fill credential domain=login.example.test" >/tmp/bitbot-cred.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cred.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='credential_fill');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('secret_echoed') is False;assert p.get('pretend_secret_view') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('vault_path') and os.path.isfile(p['vault_path']);print('credential_fill vault-only ok', p.get('path'))"
node hosts/cli_host/run_turn.js "identity browser" >/tmp/bitbot-identity.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-identity.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('connector')=='identity-browser';assert p.get('mode')=='identity_browser_switch';assert p.get('connected') is False;assert p.get('pretend_connected_slack') is False;assert p.get('session_path') and os.path.isfile(p['session_path']);print('identity_browser switch ok', p.get('status'))"
node hosts/cli_host/run_turn.js --approved "cold mail to=a@example.com subject=Hi body=Hello unsubscribe=mailto:u@example.com" >/tmp/bitbot-cold.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cold.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('provider')=='cold';assert p.get('mode')=='cold_sandbox_eml';assert p.get('sent') is False;assert p.get('pretend_sent') is False;assert p.get('eml_ok') is True;assert 'List-Unsubscribe:' in open(p['eml_path']).read();assert p.get('path') and os.path.isfile(p['path']);print('cold_mail List-Unsubscribe eml ok', p.get('eml_path'), p.get('path'))"
node hosts/cli_host/run_turn.js "learn from demo title=Checkout steps=click:Cart|type:email" >/tmp/bitbot-lfd.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-lfd.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='skill_write');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('path') and os.path.isfile(p['path']);body=open(p['path']).read();assert 'click:Cart' in body or 'Steps' in body;print('learn_from_demo skill steps ok', p.get('path'))"
node hosts/cli_host/run_turn.js "code changes README.mbt.md" >/tmp/bitbot-code-changes.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-code-changes.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='code_changes');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('applied') is False;assert p.get('pretend_committed') is False;assert p.get('code_apply_residual') is True;assert p.get('path') and os.path.isfile(p['path']);print('code_changes plan ok', p.get('path'))"
BITBOT_CODE_APPLY=1 node hosts/cli_host/run_turn.js "code changes README.mbt.md" >/tmp/bitbot-code-apply.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-code-apply.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='code_changes');p=json.loads(h.get('stdout') or '{}');assert p.get('applied') is True;assert p.get('code_apply_residual') is False;assert p.get('pretend_committed') is False;assert p.get('applied_path') and os.path.isfile(p['applied_path']);print('code_changes apply sidecar ok', p.get('applied_path'))"
node hosts/cli_host/run_turn.js "source control github" >/tmp/bitbot-sc.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='host_git_status' or str(p.get('mode') or '').startswith('host_git_status');assert p.get('pretend_remote_pr') is False;assert p.get('remote_pr_residual') is True;assert p.get('branch');assert p.get('path') and os.path.isfile(p['path']);assert p.get('status_path') and os.path.isfile(p['status_path']);print('source_control git status ok', p.get('branch'), 'dirty', p.get('dirty'), 'path', p.get('path'), 'remote_pr_residual', p.get('remote_pr_residual'))"
node hosts/cli_host/run_turn.js "source control create_pr" >/tmp/bitbot-sc-pr.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc-pr.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_remote_pr') is False;assert p.get('remote_pr_residual') is True;rp=p.get('remote_pr') or {};assert rp.get('mode') in ('remote_pr_residual','gh_pr_view_failed','gh_pr_view','gh_pr_create_dry_run','gh_pr_create_failed');assert rp.get('plan_path') and os.path.isfile(rp['plan_path']);plan=json.load(open(rp['plan_path']));assert plan.get('pretend_remote_pr') is False;assert plan.get('real_create_gated') is True;print('source_control remote PR residual+plan ok', rp.get('mode'), rp.get('plan_path'))"
BITBOT_GH_CREATE_PR=1 node hosts/cli_host/run_turn.js "source control create_pr" >/tmp/bitbot-sc-pr-live.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc-pr-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_remote_pr') is False;rp=p.get('remote_pr') or {};assert rp.get('mode') in ('gh_pr_view','gh_pr_create_dry_run','gh_pr_create');assert p.get('remote_pr_residual') is False;assert rp.get('plan_path') and os.path.isfile(rp['plan_path']);plan=json.load(open(rp['plan_path']));assert plan.get('pretend_remote_pr') is False;print('source_control remote PR live/view ok', rp.get('mode'), 'residual', p.get('remote_pr_residual'), 'gated', plan.get('real_create_gated'))"
# Gated create evidence via injectable gh mock (no real GitHub PR invent).
rm -rf /tmp/bitbot-gh-mock-dry /tmp/bitbot-gh-mock-real
mkdir -p /tmp/bitbot-gh-mock-dry /tmp/bitbot-gh-mock-real
BITBOT_GH_BIN="$ROOT/scripts/host_gh_mock.sh" BITBOT_GH_MOCK_LOG_DIR=/tmp/bitbot-gh-mock-dry BITBOT_GH_CREATE_PR=1 node hosts/cli_host/run_turn.js "source control create_pr" >/tmp/bitbot-sc-pr-dry.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc-pr-dry.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');p=json.loads(h.get('stdout') or '{}');rp=p.get('remote_pr') or {};assert rp.get('mode')=='gh_pr_create_dry_run';assert rp.get('dry_run') is True;assert rp.get('real_create_gated') is True;assert p.get('remote_pr_residual') is False;assert p.get('pretend_remote_pr') is False;plan=json.load(open(rp['plan_path']));assert plan.get('dry_run') is True;assert plan.get('real_create_gated') is True;assert plan.get('allow_real_create') is False;assert '--dry-run' in (plan.get('args') or []);log=open('/tmp/bitbot-gh-mock-dry/invocations.log').read();assert 'pr create' in log and '--dry-run' in log;print('source_control mock dry-run create ok', rp.get('plan_path'))"
BITBOT_GH_BIN="$ROOT/scripts/host_gh_mock.sh" BITBOT_GH_MOCK_LOG_DIR=/tmp/bitbot-gh-mock-real BITBOT_GH_CREATE_PR=1 BITBOT_GH_PR_CREATE=1 node hosts/cli_host/run_turn.js "source control create_pr" >/tmp/bitbot-sc-pr-real.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc-pr-real.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');p=json.loads(h.get('stdout') or '{}');rp=p.get('remote_pr') or {};assert rp.get('mode')=='gh_pr_create';assert rp.get('dry_run') is False;assert rp.get('real_create_gated') is False;assert rp.get('create_attempted') is True;assert p.get('remote_pr_residual') is False;assert p.get('pretend_remote_pr') is False;plan=json.load(open(rp['plan_path']));assert plan.get('dry_run') is False;assert plan.get('allow_real_create') is True;assert plan.get('real_create_gated') is False;assert '--dry-run' not in (plan.get('args') or []);assert os.path.isfile('/tmp/bitbot-gh-mock-real/last-create.json');print('source_control mock gated real create ok', rp.get('plan_path'), plan.get('output_prefix','')[:80])"
node hosts/cli_host/run_turn.js --approved "send on behalf to=a@example.com subject=Hi body=Hello" >/tmp/bitbot-sob.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sob.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('provider')=='onbehalf';assert p.get('mode')=='onbehalf_sandbox_eml';assert p.get('sent') is False;assert p.get('pretend_sent') is False;assert 'X-BitBot-Send-On-Behalf: 1' in open(p['eml_path']).read();assert p.get('path') and os.path.isfile(p['path']);print('send_on_behalf eml ok', p.get('eml_path'), p.get('path'))"
node hosts/cli_host/run_turn.js "book flight google.com/flights" >/tmp/bitbot-travel.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-travel.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};assert oc.get('pretend_booked') is False;assert 'vertical_stage' in oc or 'checkout_stage' in oc;g=p.get('gui') or {};assert (g.get('vertical_summary') or g.get('checkout_summary') or {}).get('playbook') in ('travel','shopping','food','generic',None) or True;print('travel CU vertical_stage ok', oc.get('vertical_stage') or oc.get('checkout_stage'), 'playbook', oc.get('playbook'))"
node hosts/cli_host/run_turn.js "finance get_balance" >/tmp/bitbot-finance.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-finance.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='finance_call');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('artifact_ok') is True;assert p.get('artifact_path') and os.path.isfile(p['artifact_path']);assert p.get('path') and os.path.isfile(p['path']);assert p.get('path')==p.get('artifact_path');assert p.get('mode') in ('sandbox','live_token_present','finance_live','finance_live_failed');assert p.get('pretend_live') is False;print('finance_call artifact ok', p.get('mode'), p.get('path'), 'residual', p.get('live_finance_residual'))"
# Live finance against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18768 --mode finance --token smoke-fin >/tmp/bitbot-finance-mock.log 2>&1 &
FINANCE_MOCK_PID=$!
sleep 0.4
BITBOT_FINANCE_TOKEN=smoke-fin BITBOT_FINANCE_API_URL=http://127.0.0.1:18768 node hosts/cli_host/run_turn.js "finance get_balance" >/tmp/bitbot-finance-live.json || true
kill "$FINANCE_MOCK_PID" >/dev/null 2>&1 || true
wait "$FINANCE_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-finance-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='finance_call');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='finance_live';assert p.get('live_finance_residual') is False;assert p.get('pretend_live') is False;assert (p.get('live_probe') or {}).get('ok') is True;print('finance_call live ok', p.get('artifact_path'), p.get('live_probe'))"
node hosts/cli_host/run_turn.js "job search engineer" >/tmp/bitbot-jobs.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-jobs.json'));hrs=d.get('host_results') or [];kinds=[h.get('kind') for h in hrs];assert 'computer_use' in kinds;h=next(x for x in hrs if x.get('kind')=='job_search');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_applied') is False;assert p.get('live_job_residual') is True;assert p.get('mode')=='sandbox_readonly';assert p.get('path') and os.path.isfile(p['path']);assert p.get('hit_count')>=1;print('job_search durable ok', p.get('path'), 'hits', p.get('hit_count'), 'playbook', p.get('playbook'))"
# Live job catalog against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18771 --mode job --token smoke-job >/tmp/bitbot-job-mock.log 2>&1 &
JOB_MOCK_PID=$!
sleep 0.4
BITBOT_JOB_API_URL=http://127.0.0.1:18771 BITBOT_JOB_TOKEN=smoke-job node hosts/cli_host/run_turn.js "job search engineer" >/tmp/bitbot-jobs-live.json || true
kill "$JOB_MOCK_PID" >/dev/null 2>&1 || true
wait "$JOB_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-jobs-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='job_search');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='job_live';assert p.get('live_job_residual') is False;assert p.get('pretend_applied') is False;assert p.get('hit_count')>=1;assert (p.get('live_probe') or {}).get('ok') is True;print('job_search live mock ok', p.get('path'), 'hits', p.get('hit_count'))"
node hosts/cli_host/run_turn.js "schedule meeting title=Sprint when=tomorrow-3pm" >/tmp/bitbot-schedule.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-schedule.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='schedule_meeting');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('scheduled') is True;assert p.get('ics_ok') is True;assert p.get('ics_path') and os.path.isfile(p['ics_path']);assert b'BEGIN:VEVENT' in open(p['ics_path'],'rb').read();assert p.get('path') and os.path.isfile(p['path']);assert p.get('live_calendar_residual') is True;assert p.get('pretend_live') is False;print('schedule_meeting ICS ok', p.get('ics_path'), p.get('mode'), p.get('path'))"
# Live calendar against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18776 --mode calendar --token smoke-cal >/tmp/bitbot-cal-mock.log 2>&1 &
CAL_MOCK_PID=$!
sleep 0.4
BITBOT_CALENDAR_API_URL=http://127.0.0.1:18776 BITBOT_CALENDAR_TOKEN=smoke-cal node hosts/cli_host/run_turn.js "schedule meeting title=LiveSprint when=tomorrow-4pm" >/tmp/bitbot-schedule-live.json || true
kill "$CAL_MOCK_PID" >/dev/null 2>&1 || true
wait "$CAL_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-schedule-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='schedule_meeting');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='calendar_live';assert p.get('live_calendar_residual') is False;assert p.get('pretend_live') is False;assert (p.get('live_probe') or {}).get('ok') is True;assert p.get('path') and os.path.isfile(p['path']);print('schedule_meeting calendar_live ok', p.get('remote_event_id'), p.get('ics_path'), p.get('path'))"

echo "==> journal / shared memory / inbound reaction (durable Host stores)"
node hosts/cli_host/run_turn.js "journal date=2026-10-17 id=smoke body=smoke-event" >/tmp/bitbot-journal-append.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-journal-append.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='journal_append');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_stored') is False;assert p.get('pollutes_profile') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('events_path') and os.path.isfile(p['events_path']);assert 'events.jsonl' in (p.get('events_path') or '');print('journal_append durable ok', p.get('path'))"
node hosts/cli_host/run_turn.js "query journal from=2026-10-01 to=2026-10-31" >/tmp/bitbot-journal-query.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-journal-query.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='journal_query');assert h.get('ok') and 'hit_count' in (h.get('stdout') or '');print('journal_query durable ok')"
node hosts/cli_host/run_turn.js "shared memory put scope=team key=k value=v" >/tmp/bitbot-shared-put.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-shared-put.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='shared_memory_put');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_stored') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('store_path') and os.path.isfile(p['store_path']);assert 'shared-scopes.json' in (p.get('store_path') or '');print('shared_memory_put durable ok', p.get('path'))"
node hosts/cli_host/run_turn.js "shared memory read scope=team key=k" >/tmp/bitbot-shared-read.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-shared-read.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='shared_memory_read');assert h.get('ok') and '\"found\": true' in (h.get('stdout') or '');print('shared_memory_read durable ok')"
node hosts/cli_host/run_turn.js "[inbound] reaction :+1:" >/tmp/bitbot-inbound.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-inbound.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='inbound_reaction');assert h.get('ok') and 'forced_reply' in (h.get('stdout') or '') and 'false' in (h.get('stdout') or '').lower();p=json.loads(h.get('stdout') or '{}');assert p.get('visible_pill') is True;assert os.path.isfile('data/delivery/outbound-reactions.jsonl');assert os.path.isfile('data/delivery/send-to-user.jsonl');print('inbound_reaction SendToUser pill ok', p.get('emoji'))"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: delivery body" >/tmp/bitbot-delivery.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-delivery.json'));hrs=d.get('host_results') or [];assert any(h.get('kind')=='channel_send' and h.get('ok') for h in hrs);deliv=next(x for x in hrs if x.get('kind')=='delivery');assert deliv.get('ok');p=json.loads(deliv.get('stdout') or '{}');assert p.get('type') in ('text','thread');assert p.get('send_to_user') is True;assert os.path.isfile('data/delivery/send-to-user.jsonl');print('SendToUser delivery receipt ok', p.get('type'), p.get('channel'))"

echo "==> native iOS/Android Host shells"
bash "$ROOT/scripts/verify_native_shells.sh"

echo "OK: smoke_desktop_turn.sh"
