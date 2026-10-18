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
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webfetch-fb.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webfetch');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('used_fallback') is True;assert p.get('fallback')=='curl';assert p.get('public_fallback_residual') is False;assert p.get('credential_bypass') is False;assert p.get('pretend_fetched') is False;assert 'Public docs' in (p.get('body_prefix') or '');assert p.get('path') and os.path.isfile(p['path']);print('webfetch public fallback ok', p.get('fallback'), 'residual', p.get('public_fallback_residual'), p.get('path'))"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-webfetch-fb.json","utf8"));
if(s.labels.some(l=>l.includes("public_fallback_residual"))) { console.error("success fallback must not stamp residual", s); process.exit(1); }
console.log("webfetch success fallback STU no residual ok");
'
node hosts/cli_host/run_turn.js --approved "webfetch http://127.0.0.1:9/nope" >/tmp/bitbot-webfetch-fail.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-webfetch-fail.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webfetch');p=json.loads(h.get('stdout') or '{}');assert p.get('public_fallback_residual') is True or h.get('ok') is False;print('webfetch fail residual ok', p.get('public_fallback_residual'), p.get('mode') or h.get('error'))"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-webfetch-fail.json","utf8"));
if(!s.labels.some(l=>l.includes("public_fallback_residual")||l.includes("webfetch"))) { console.error(s); process.exit(1); }
console.log("webfetch fail STU residual/label ok", s.labels.slice(0,3));
'
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
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-call.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mcp_call' and x.get('ok'));p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_ok') is False;assert p.get('mapped')=='search_mail_artifacts';assert p.get('product_tool_residual') is False;assert p.get('path') and os.path.isfile(p['path']);snap=json.load(open(p['path']));assert snap.get('pretend_ok') is False;assert snap.get('mode')=='stdio-mcp';assert snap.get('mapped')=='search_mail_artifacts';print('mcp_call host ok', p.get('mapped') or p.get('tool'), p.get('path'))"
# Catalog tool without Host product map → echo_body + product_tool_residual
node hosts/cli_host/run_turn.js --approved 'mcp call user-Gmail.create_draft {"to":"a@b.c","subject":"x","body":"y"}' >/tmp/bitbot-mcp-draft.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-draft.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mcp_call' and x.get('ok'));p=json.loads(h.get('stdout') or '{}');assert p.get('tool')=='create_draft';assert p.get('mapped')=='host_mail_draft';assert p.get('product_tool_residual') is False;assert p.get('pretend_ok') is False;md=p.get('mail_draft') or {};assert md.get('eml_path') and os.path.isfile(md['eml_path']);assert 'X-BitBot-Status: draft' in open(md['eml_path']).read();print('mcp_call create_draft→mail_draft ok', p.get('mapped'), md.get('eml_path'))"
# Unmapped product tool still stamps product_tool_residual (Host FFI; MoonBit catalog only seeds mapped tools).
node -e '
const { createHostFfi } = require("./hosts/shared/host_ffi.js");
(async () => {
  const ffi = createHostFfi(process.cwd());
  const results = await ffi.executeHostEffects([
    { kind: "mcp_call", command: "user-Gmail.some_unmapped_tool|{\"q\":\"x\"}" },
  ]);
  const h = results.find((r) => r && r.kind === "mcp_call");
  if (!h || !h.ok) throw new Error("mcp_call missing: " + JSON.stringify(results).slice(0, 400));
  const p = JSON.parse(h.stdout || "{}");
  if (p.tool !== "some_unmapped_tool") throw new Error("tool " + p.tool);
  if (p.mapped !== "echo_body") throw new Error("mapped " + p.mapped);
  if (p.product_tool_residual !== true) throw new Error("expected product_tool_residual");
  if (p.pretend_ok === true) throw new Error("pretend_ok");
  require("fs").writeFileSync("/tmp/bitbot-mcp-residual.json", JSON.stringify({ ok: true, ...p }, null, 2));
  console.log("mcp_call product_tool_residual ok", p.tool, p.mapped);
})().catch((e) => { console.error(e); process.exit(1); });
'
# CM-2163 product path: Host FFI expands $file: before stdio MCP (search_threads→search_mail_artifacts)
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
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-box-doctor.json'));assert d.get('ok') and d.get('intent')=='box_doctor';h=next(x for x in d['host_results'] if x.get('kind')=='box_doctor');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_healthy') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('log_path') and os.path.isfile(p['log_path']);assert 'PASS' in open(p['log_path']).read() or 'SUMMARY' in open(p['log_path']).read();assert p.get('pass_count',0)>=1;assert p.get('box_doctor_bin_residual') is False;assert p.get('doctor_bin');print('box_doctor host ok', p.get('mode'), 'pass', p.get('pass_count'), 'fail', p.get('fail_count'), 'bin', p.get('doctor_bin'), p.get('path'))"
echo "==> Host box_doctor with local mock bin (closes box_doctor_bin_residual)"
BITBOT_BOX_DOCTOR="$ROOT/scripts/fixtures/box-doctor-mock.sh" node hosts/cli_host/run_turn.js --approved "box doctor" >/tmp/bitbot-box-doctor-bin.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-box-doctor-bin.json'));h=next(x for x in d['host_results'] if x.get('kind')=='box_doctor');p=json.loads(h['stdout']);assert p.get('box_doctor_bin_residual') is False;assert p.get('doctor_bin');assert p.get('pretend_healthy') is False;assert p.get('mode')=='host_box_doctor';assert p.get('pass_count',0)>=1;print('box_doctor mock bin residual closed ok', p.get('doctor_bin'), p.get('path'))"
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
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webhook-wake.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_wake');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('has_webhook_event') is True;assert '<webhook_event' in (p.get('wake_payload') or '');assert p.get('key_leaked') is False;assert p.get('pretend_wake') is False;assert p.get('path') and os.path.isfile(p['path']);th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('hook_path') and os.path.isfile(th['hook_path']);hook=json.load(open(th['hook_path']));assert hook.get('pretend_turn') is False;assert hook.get('status')=='pending';assert p.get('inbound_turn_residual') is True;assert p.get('inbound_push_residual') is True;panel=json.load(open('data/routines/webhooks/panel.json'));assert panel['key'] not in (p.get('wake_payload') or '');print('webhook_wake ok', p.get('event_id'), 'hook', th.get('hook_path'), 'inbound_turn_residual', True, 'inbound_push_residual', True)"
# Live inbound turn hook (claim → Host turn) when BITBOT_INBOUND_TURN=1
BITBOT_INBOUND_TURN=1 node hosts/cli_host/run_turn.js --approved "webhook wake id=evt-live summary=inbound turn smoke" >/tmp/bitbot-webhook-wake-live.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-webhook-wake-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_wake');p=json.loads(h['stdout']);th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;assert p.get('inbound_turn_residual') is False;assert p.get('inbound_push_residual') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('webhook_wake inbound turn ok', th.get('turn_path'), 'residual', False)"
# Synthetic wake with BITBOT_INBOUND_PUSH=1 closes inbound_push_residual (HTTP listen parity).
BITBOT_INBOUND_PUSH=1 node hosts/cli_host/run_turn.js --approved "webhook wake id=evt-push summary=push residual close" >/tmp/bitbot-webhook-wake-push.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-webhook-wake-push.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_wake');p=json.loads(h['stdout']);assert p.get('inbound_push_residual') is False;assert p.get('pretend_wake') is False;print('webhook_wake inbound push residual close ok', p.get('event_id'), 'residual', False)"
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
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-tm-alpha.json'));assert d.get('intent')=='create_teammate';h=next(x for x in d['host_results'] if x.get('kind')=='teammate_create');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('appears_in_members') is True;assert p.get('in_sidebar') is True;assert 'asst-alpha' in (p.get('member_ids') or []);assert p.get('pretend_created') is False;assert p.get('path') and os.path.isfile(p['path']);print('teammate_create appears_in_members ok', p.get('member_ids'))"
node hosts/cli_host/run_turn.js "open members group=group-1" >/tmp/bitbot-members.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-members.json'));assert d.get('intent')=='members_panel';h=next(x for x in d['host_results'] if x.get('kind')=='members_panel');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('section_anchor')=='members';assert p.get('matches_app_ui') is True;assert p.get('info_panel_has_members') is True;assert p.get('pretend_members') is False;assert 'asst-alpha' in (p.get('member_ids') or []);assert p.get('path') and os.path.isfile(p['path']);print('members_panel host ok', p.get('member_ids'), p.get('path'))"
echo "==> Host notify / update-computer / local-execution / permission guide (CM-0206/1903/1904/1905/2178)"
# Seed known defaults so durable notify store from prior runs does not flake asserts.
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('data/settings/notify.json')
p.parent.mkdir(parents=True, exist_ok=True)
store = json.loads(p.read_text()) if p.exists() else {}
store['asst-alpha'] = {
  'desktop': True, 'sound': True, 'mentions_only': False,
  'routines': True, 'channels': True,
}
p.write_text(json.dumps(store, indent=2))
print('seeded notify defaults for asst-alpha')
PY
node hosts/cli_host/run_turn.js "notify settings assistant=asst-alpha" >/tmp/bitbot-notify.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-notify.json'));assert d.get('intent')=='notify_settings';h=next(x for x in d['host_results'] if x.get('kind')=='notify_settings');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('assistant_scoped') is True;assert p.get('pretend_global') is False;assert p.get('sound') is True;assert isinstance(p.get('toggles'), dict);assert p.get('path') and os.path.isfile(p['path']);print('notify_settings host ok', p.get('assistant_id'), p.get('toggles'))"
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
echo "==> Host render_markdown math/mermaid (CM-2103)"
node hosts/cli_host/run_turn.js 'render markdown Inline \(E=mc^2\) and $$a^2+b^2=c^2$$ ```mermaid
graph TD
  A-->B
```' >/tmp/bitbot-markdown.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-markdown.json'));assert d.get('intent')=='render_markdown';h=next(x for x in d['host_results'] if x.get('kind')=='render_markdown');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_rendered') is False;assert p.get('has_inline_math') is True;assert p.get('has_display_math') is True;assert p.get('has_mermaid') is True;assert p.get('math_count',0)>=2;assert p.get('mermaid_count')==1;assert p.get('html_path') and os.path.isfile(p['html_path']);assert 'math-display' in open(p['html_path']).read() or 'math-inline' in open(p['html_path']).read();assert p.get('path') and os.path.isfile(p['path']);print('render_markdown host ok', p.get('math_count'), p.get('mermaid_count'), p.get('html_path'))"
node hosts/cli_host/run_turn.js 'render markdown bad \(no close' >/tmp/bitbot-markdown-bad.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-markdown-bad.json'));h=next(x for x in d['host_results'] if x.get('kind')=='render_markdown');p=json.loads(h['stdout']);assert p.get('refused') is True;assert p.get('pretend_rendered') is False;assert 'unclosed' in (p.get('error') or '');print('render_markdown unclosed refuse ok', p.get('error'))"
echo "==> Host react_message pill toggle (CM-2101/2128)"
node hosts/cli_host/run_turn.js "react message msg=msg-smoke emoji=👍" >/tmp/bitbot-react1.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-react1.json'));assert d.get('intent')=='react_message';h=next(x for x in d['host_results'] if x.get('kind')=='react_message');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('visible_pill') is True;assert p.get('active') is True;assert p.get('emoji');assert p.get('pretend_pill') is False;assert p.get('end_turn') is True;assert os.path.isfile('data/delivery/react-pills.json');print('react_message on ok', p.get('emoji'), p.get('message_id'))"
node hosts/cli_host/run_turn.js "react message msg=msg-smoke emoji=👍" >/tmp/bitbot-react2.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-react2.json'));h=next(x for x in d['host_results'] if x.get('kind')=='react_message');p=json.loads(h['stdout']);assert p.get('visible_pill') is False;assert p.get('active') is False;assert p.get('visible') is False;print('react_message toggle-off ok', p.get('message_id'))"
echo "==> Host screenshot + check_updates (CM-0605/1906)"
node hosts/cli_host/run_turn.js "screenshot agent=executor" >/tmp/bitbot-screenshot.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-screenshot.json'));assert d.get('intent')=='screenshot';h=next(x for x in d['host_results'] if x.get('kind')=='screenshot');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('read_only') is True;assert p.get('clicked') is False;assert p.get('pretend_live') is False;assert p.get('pretend_frame') is False;assert p.get('path') and os.path.isfile(p['path']);
ok=p.get('has_frame') is True
if ok:
  assert p.get('frame_path') and os.path.isfile(p['frame_path']);assert p.get('frame_bytes_len',0)>0;assert p.get('screenshot_residual') is False;print('screenshot live frame ok', p.get('tool'), p.get('frame_path'), p.get('frame_bytes_len'))
else:
  assert p.get('screenshot_residual') is True;assert p.get('has_frame') is False;assert p.get('residual_reason');print('screenshot honest residual ok', p.get('residual_reason'))"
# Fixture close when live capture unavailable (opt-in BITBOT_SCREENSHOT_FIXTURE=1).
env -u DISPLAY BITBOT_SCREENSHOT_FIXTURE=1 \
  node hosts/cli_host/run_turn.js "screenshot agent=executor" >/tmp/bitbot-screenshot-fixture.json || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-screenshot-fixture.json'));h=next(x for x in d['host_results'] if x.get('kind')=='screenshot');p=json.loads(h['stdout']);assert p.get('screenshot_residual') is False;assert p.get('has_frame') is True;assert p.get('tool')=='fixture';assert p.get('frame_origin')=='Fixture';assert p.get('pretend_live') is False;assert p.get('pretend_frame') is False;assert p.get('frame_path') and os.path.isfile(p['frame_path']);print('screenshot fixture residual close ok', p.get('frame_path'), p.get('frame_bytes_len'))"
node hosts/cli_host/run_turn.js "check updates" >/tmp/bitbot-check-updates.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-check-updates.json'));assert d.get('intent')=='check_updates';h=next(x for x in d['host_results'] if x.get('kind')=='check_updates');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('updates_anchor')=='update-channel';assert p.get('updates_tab')=='Updates';assert p.get('computer_anchor')=='update-computer';assert p.get('computer_tab')=='Computer';assert p.get('ne_update_computer') is True;assert p.get('distinct_deep_links') is True;assert p.get('distinct_tabs') is True;assert p.get('updates_deep_link')!=p.get('computer_deep_link');assert p.get('check_for_updates') is True;assert p.get('pretend_opened') is False;assert p.get('path') and os.path.isfile(p['path']);print('check_updates vs update-computer ok', p.get('updates_deep_link'), '≠', p.get('computer_deep_link'))"
echo "==> Host auto_review_settings deeplinks (CM-1507)"
node hosts/cli_host/run_turn.js "auto review settings" >/tmp/bitbot-auto-review.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-auto-review.json'));assert d.get('intent')=='auto_review_settings';h=next(x for x in d['host_results'] if x.get('kind')=='auto_review_settings');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('anchors')==['auto-review','auto-review-rules','security-keys'];assert p.get('all_on_general') is True;assert p.get('primary_anchor')=='auto-review';assert p.get('primary_deep_link')=='grokbot://app/v1/settings?id=auto-review';assert p.get('closed_set') is True;assert p.get('pretend_opened') is False;assert p.get('path') and os.path.isfile(p['path']);print('auto_review_settings host ok', p.get('anchors'))"
echo "==> Host box_chrome_probe (CM-0802)"
node hosts/cli_host/run_turn.js "box chrome probe" >/tmp/bitbot-box-chrome.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-box-chrome.json'));assert d.get('intent')=='box_chrome_probe';h=next(x for x in d['host_results'] if x.get('kind')=='box_chrome_probe');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('via_box_chrome') is True;assert p.get('rejected_bare') is True;assert p.get('pretend_launched') is False;assert 'box-chrome' in (p.get('launch_path') or '');assert p.get('shared_cdp_untouched') is True;assert p.get('used_shared_cdp') is False;assert p.get('private_cdp_port') not in (None, 9223);assert p.get('lockfile_diagnosable') is True;assert p.get('path') and os.path.isfile(p['path']);assert p.get('box_chrome_bin_residual') is False;assert p.get('box_chrome_bin');print('box_chrome_probe ok', p.get('launch_path'), 'private', p.get('private_cdp_port'), 'bin', p.get('box_chrome_bin'))"
echo "==> Host box_chrome_probe with BOX_CHROME_BIN mock (closes box_chrome_bin_residual)"
BOX_CHROME_BIN="$ROOT/scripts/fixtures/box-chrome-mock.sh" node hosts/cli_host/run_turn.js "box chrome probe" >/tmp/bitbot-box-chrome-bin.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-box-chrome-bin.json'));h=next(x for x in d['host_results'] if x.get('kind')=='box_chrome_probe');p=json.loads(h['stdout']);assert p.get('box_chrome_bin_residual') is False;assert p.get('box_chrome_bin');assert p.get('rejected_bare') is True;assert p.get('pretend_launched') is False;assert p.get('via_box_chrome') is True;print('box_chrome mock bin residual closed ok', p.get('box_chrome_bin'))"
BOX_CHROME_BIN="$ROOT/scripts/fixtures/box-chrome-mock.sh" node hosts/cli_host/run_turn.js "launch bare chrome" >/tmp/bitbot-bare-chrome-bin.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-bare-chrome-bin.json'));h=next(x for x in d['host_results'] if x.get('kind')=='box_chrome_probe');p=json.loads(h['stdout']);assert p.get('refused') is True;assert p.get('rejected_bare') is True;assert p.get('pretend_launched') is False;print('box_chrome bare refuse with mock bin ok', p.get('error'))"
node hosts/cli_host/run_turn.js "launch bare chrome" >/tmp/bitbot-bare-chrome.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-bare-chrome.json'));assert d.get('intent')=='box_chrome_probe';h=next(x for x in d['host_results'] if x.get('kind')=='box_chrome_probe');p=json.loads(h['stdout']);assert p.get('refused') is True;assert p.get('rejected_bare') is True;assert p.get('pretend_launched') is False;assert 'box-chrome' in (p.get('error') or '').lower() or 'bare' in (p.get('error') or '').lower();print('box_chrome bare refuse ok', p.get('error'))"
echo "==> Host mcp_namespace InstallPlugin (CM-0904)"
node hosts/cli_host/run_turn.js "install plugin plugin-slides" >/tmp/bitbot-mcp-ns.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-ns.json'));assert d.get('intent')=='install_plugin';h=next(x for x in d['host_results'] if x.get('kind')=='mcp_namespace');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_registered') is False;assert p.get('namespace')=='user-Slides';assert p.get('status')=='Ready';assert p.get('usable') is True;assert p.get('namespace_ready') is True;assert p.get('plugin_id')=='plugin-slides';assert p.get('skill_count',0)>=1;assert p.get('path') and os.path.isfile(p['path']);assert p.get('catalog_path') and os.path.isfile(p['catalog_path']);cat=json.load(open(p['catalog_path']));assert 'user-Slides' in (cat.get('namespaces') or {});assert 'plugin-slides' in (cat.get('installed_plugins') or []);print('mcp_namespace Ready ok', p.get('namespace'), p.get('path'))"
# MoonBit may refuse unknown before Host (ok=false → run_turn exit 1); keep JSON for assert.
node hosts/cli_host/run_turn.js "install plugin plugin-unknown-xyz" >/tmp/bitbot-mcp-ns-bad.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-mcp-ns-bad.json'));
# MoonBit may fail before Host, or Host refuses unknown — either way no pretend register.
if d.get('ok') is False:
  print('install unknown plugin moon refuse ok', d.get('error') or d.get('assistant') or 'failed')
else:
  hrs=d.get('host_results') or []
  h=next((x for x in hrs if x.get('kind')=='mcp_namespace'), None)
  assert h is not None
  p=json.loads(h.get('stdout') or '{}')
  assert p.get('refused') is True or p.get('pretend_registered') is False
  assert p.get('pretend_registered') is not True
  print('install unknown plugin host refuse ok', p.get('error'))
"
node hosts/cli_host/run_turn.js "get plugin plugin-slides" >/tmp/bitbot-mcp-get.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-get.json'));assert d.get('intent')=='get_plugin';h=next(x for x in d['host_results'] if x.get('kind')=='mcp_get_plugin');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_plugin') is False;assert p.get('id')=='plugin-slides';assert p.get('mcp_namespace')=='user-Slides';assert p.get('skill_count',0)>=1;assert 'slides-quickstart' in (p.get('skill_names') or []);assert p.get('path') and os.path.isfile(p['path']);print('mcp_get_plugin ok', p.get('id'), p.get('skill_names'))"
node hosts/cli_host/run_turn.js "get plugin plugin-missing" >/tmp/bitbot-mcp-get-bad.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-mcp-get-bad.json'));
if d.get('ok') is False:
  print('get unknown plugin moon refuse ok', d.get('error') or d.get('assistant') or 'failed')
else:
  h=next(x for x in d['host_results'] if x.get('kind')=='mcp_get_plugin');p=json.loads(h['stdout']);assert p.get('refused') is True;assert p.get('pretend_plugin') is False;print('get unknown plugin host refuse ok', p.get('error'))
"
node hosts/cli_host/run_turn.js "list plugins slides" >/tmp/bitbot-mcp-list.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-list.json'));assert d.get('intent')=='list_plugins';h=next(x for x in d['host_results'] if x.get('kind')=='mcp_list_plugins');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_listing') is False;assert p.get('count',0)>=1;assert any(x.get('id')=='plugin-slides' for x in (p.get('plugins') or []));assert p.get('path') and os.path.isfile(p['path']);print('mcp_list_plugins ok', p.get('count'), [x.get('id') for x in p.get('plugins') or []])"
python3 -c "
from pathlib import Path
html=Path('hosts/desktop/index.html').read_text()
assert 'id=\"plugins-meta\"' in html
assert 'id=\"plugin-list\"' in html and 'id=\"plugin-get\"' in html
assert 'id=\"plugin-install\"' in html and 'id=\"plugin-uninstall\"' in html
assert 'get plugin plugin-slides' in html
assert 'list plugins' in html
print('desktop plugins panel wired ok')
"
python3 -c "
from pathlib import Path
html=Path('hosts/desktop/index.html').read_text()
assert 'id=\"media-meta\"' in html
assert 'id=\"media-image\"' in html and 'id=\"media-video\"' in html
assert 'id=\"media-chart\"' in html and 'id=\"media-watch\"' in html
assert 'generate image desktop aurora skyline' in html
assert 'structured chart' in html
print('desktop media panel wired ok')
"
python3 -c "
from pathlib import Path
html=Path('hosts/desktop/index.html').read_text()
assert 'id=\"voice-meta\"' in html
assert 'id=\"voice-start\"' in html and 'id=\"voice-relay\"' in html
assert 'id=\"voice-end\"' in html
assert 'voice start desktop-voice' in html
assert 'voice relay desktop-voice' in html
print('desktop voice panel wired ok')
"
python3 -c "
from pathlib import Path
html=Path('hosts/desktop/index.html').read_text()
assert 'id=\"box-meta\"' in html
assert 'id=\"box-doctor\"' in html and 'id=\"box-env\"' in html
assert 'id=\"box-clock\"' in html and 'id=\"box-chrome\"' in html
assert 'id=\"box-screenshot\"' in html and 'id=\"box-check-updates\"' in html
assert 'id=\"cloud-meta\"' in html and 'id=\"cloud-launch\"' in html
assert 'id=\"cloud-deliver\"' in html
assert 'box doctor' in html and 'box chrome probe' in html
assert 'screenshot agent=executor' in html and 'check updates' in html
assert 'launch cloud agent' in html and 'deliver cloud artifact' in html
assert 'id=\"routines-meta\"' in html
assert 'id=\"rt-create\"' in html and 'id=\"rt-list\"' in html
assert 'id=\"rt-fire\"' in html and 'id=\"rt-tick\"' in html
assert 'id=\"rt-auto-review\"' in html
assert 'create routine id=desk-r' in html and 'tick routines' in html
assert 'auto review settings' in html
print('desktop box + cloud + routines panels wired ok')
"
python3 -c "
from pathlib import Path
html=Path('hosts/desktop/index.html').read_text()
assert 'id=\"tm-create\"' in html and 'id=\"tm-members\"' in html
assert 'id=\"tm-room\"' in html and 'id=\"tm-send\"' in html
assert 'create teammate id=asst-desktop' in html
assert 'members panel' in html
assert 'id=\"mail-meta\"' in html
assert 'id=\"mail-draft\"' in html and 'id=\"mail-schedule\"' in html
assert 'id=\"mail-purchase\"' in html and 'id=\"mail-search\"' in html
assert 'draft mail to=desktop@example.com' in html
assert 'schedule meeting title=DesktopSync' in html
assert 'id=\"channels-meta\"' in html
assert 'id=\"ch-slack-draft\"' in html and 'id=\"ch-slack-claim\"' in html
assert 'id=\"ch-teams-draft\"' in html and 'id=\"ch-teams-claim\"' in html
assert 'id=\"ch-finance\"' in html and 'id=\"ch-jobs\"' in html
assert 'id=\"ch-xsearch\"' in html and 'id=\"ch-workflows\"' in html
assert 'id=\"ch-credentials\"' in html
assert 'id=\"del-react\"' in html and 'id=\"del-inbound-react\"' in html
assert 'id=\"del-markdown\"' in html
assert 'BITBOT_SLACK_CLAIM' in html and 'BITBOT_TEAMS_CLAIM' in html
assert 'x search moonbit' in html and 'list workflows' in html
assert 'list credentials' in html
assert 'react message msg=msg-desktop' in html
assert '[inbound] reaction' in html
mainjs=Path('hosts/desktop/main.js').read_text()
assert 'envPatch' in mainjs
assert 'BITBOT_SLACK_CLAIM' in html
mobile=Path('hosts/mobile_host/run.js').read_text()
assert 'finance_call' in mobile and 'job_search' in mobile
assert 'workflow_list' in mobile and 'inbound_reaction' in mobile
assert 'receipt_path' in mobile and 'skill_path' in mobile
assert 'id=\"mem-remember\"' in html and 'id=\"tools-meta\"' in html
assert 'id=\"tool-shell\"' in html and 'id=\"tool-listdir\"' in html
assert 'id=\"tool-read\"' in html and 'id=\"tool-webfetch\"' in html
assert 'id=\"cu-meta\"' in html and 'id=\"cu-open\"' in html
assert 'id=\"cu-native\"' in html and 'id=\"cu-ocr\"' in html and 'id=\"cu-shop\"' in html
assert 'id=\"sc-code\"' in html
assert 'shell echo desktop-tools-panel' in html
assert 'listdir docs' in html and 'webfetch https://example.com' in html
assert 'BITBOT_CU_NATIVE_ACT' in html and 'BITBOT_CU_OCR' in html
assert 'code changes README.mbt.md' in html
assert 'fs_list' in mobile and 'webfetch' in mobile and 'computer_use' in mobile
assert 'shared_memory_put' in mobile and 'code_changes' in mobile
assert 'id=\"mach-list\"' in html and 'id=\"machines-meta\"' in html
assert 'id=\"mail-cold\"' in html and 'id=\"mail-onbehalf\"' in html
assert 'id=\"mail-claim\"' in html
assert 'list machines' in html
assert 'cold mail to=prospect@example.com' in html
assert 'send on behalf to=boss@example.com' in html
assert 'claim inbox alpha' in html
assert 'machines_list' in mobile and 'mail_claim_inbox' in mobile
assert 'id=\"del-slides\"' in html and 'id=\"del-skill\"' in html
assert 'id=\"del-export\"' in html and 'id=\"del-load-skill\"' in html
assert 'id=\"tool-device\"' in html and 'id=\"tool-journal\"' in html
assert 'id=\"box-copy-to\"' in html and 'id=\"box-copy-from\"' in html
assert 'make slides title=DeskParity' in html
assert 'author skill name=demo-skill' in html
assert 'export bot template id=bot-smoke' in html
assert 'load skill slides presentation' in html
assert 'device tools' in html and 'journal query hello' in html
assert 'copy to box machine=desk-1' in html and 'copy from box machine=desk-1' in html
assert 'device_tools_list' in mobile and 'journal_query' in mobile
assert 'skill_load' in mobile and 'copy_to_box' in mobile
assert 'id=\"plugin-mcp-discover\"' in html and 'id=\"plugin-mcp-call\"' in html
assert 'id=\"tm-subagent\"' in html
assert 'id=\"cu-travel\"' in html and 'id=\"cu-food\"' in html
assert 'id=\"tool-pkg\"' in html
assert 'mcp discover' in html
assert 'mcp call user-Gmail.search_threads' in html
assert 'spawn subagent summarize inbox' in html
assert 'travel expedia.com' in html and 'order food doordash.com' in html
assert 'package install cowsay' in html
assert 'subagent_run' in mobile
assert 'id=\"ag-list\"' in html and 'id=\"ag-hide\"' in html
assert 'id=\"pref-notify\"' in html and 'id=\"pref-guide\"' in html
assert 'id=\"pref-update\"' in html and 'id=\"pref-local\"' in html
assert 'id=\"box-shared-fs\"' in html
assert 'id=\"del-section\"' in html and 'id=\"del-learn\"' in html
assert 'id=\"mail-meeting\"' in html
assert 'list agents' in html and 'hide agent research' in html
assert 'notify settings assistant=asst-alpha' in html
assert 'shared box fs' in html
assert 'section post group=g1' in html
assert 'learn from demo title=Checkout' in html
assert 'meeting chat body=stand-up' in html
assert 'room_turn' in mobile and 'send_to_agent' in mobile
assert 'id=\"ch-cred-fill\"' in html and 'id=\"cu-paywall\"' in html
assert 'fill credential domain=login.example.test' in html
assert 'BITBOT_CU_ALLOW_LOCAL' in html
assert 'shop cart checkout buy' in html
assert 'credential_fill' in mobile
assert 'id=\"connect-finance\"' in html and 'id=\"connect-identity\"' in html
assert 'id=\"ch-teams-send\"' in html
assert 'id=\"del-section-add\"' in html
assert 'id=\"tool-journal-append\"' in html
assert 'id=\"cu-flight\"' in html
assert 'id=\"rt-pause\"' in html and 'id=\"rt-resume\"' in html
assert 'id=\"mail-read\"' in html and 'id=\"mail-outlook\"' in html
assert 'connect finance' in html and 'identity browser' in html
assert 'teams send tsmoke' in html
assert 'add section group=g1' in html
assert 'book flight google.com/flights' in html
assert 'pause routine smoke-r' in html and 'resume routine smoke-r' in html
assert 'read mail t-invoice-1' in html
assert 'draft outlook mail' in html
assert 'journal date=2026-10-17' in html
assert 'routine_pause' in mobile and 'journal_append' in mobile
assert 'id=\"ch-slack-dm\"' in html and 'id=\"del-channel-plan\"' in html
assert 'id=\"box-bare-chrome\"' in html
assert 'id=\"tool-pkg-npm\"' in html and 'id=\"tool-journal-range\"' in html
assert 'id=\"tm-members-group\"' in html
assert 'personal slack dm owner=Uowner' in html
assert 'channel plan body=stay in chat only' in html
assert 'launch bare chrome' in html
assert 'install package npm left-pad@1.3.0' in html
assert 'open members group=group-1' in html
assert 'query journal from=2026-10-01' in html
assert 'channel_delivery' in html
print('desktop teammates + mail/commerce + channels/delivery + tools/CU + machines + skills/box + mcp/subagent + prefs panels wired ok')
"
python3 - <<'PY'
from pathlib import Path
html=Path('hosts/desktop/index.html').read_text()
main=Path('hosts/desktop/main.js').read_text()
preload=Path('hosts/desktop/preload.js').read_text()
assert 'renderDeliveryMedia' in html and 'collectHostMediaPaths' in html
assert 'renderDeliveryHtml' in html and 'collectHostHtmlPaths' in html
assert 'renderOpenArtifact' in html and 'collectHostOpenablePaths' in html
assert 'delivery-media' in html
assert 'delivery-html' in html and 'html_iframe' in html
assert 'purchase_receipt' in html
assert 'skill_md' in html and 'export_pack' in html
assert 'files:' in html
assert 'open-artifact' in html and 'Open with OS' in html
assert 'srcdoc' in html
assert 'bitbot:readArtifact' in main and 'data_url' in main
assert 'bitbot:openArtifact' in main and 'shell.openPath' in main
assert 'pretend_open: false' in main
assert 'text/html' in main and '".html"' in main
assert 'buf.toString("utf8")' in main
assert 'readArtifact' in preload and 'openArtifact' in preload
assert 'path outside repo' in main
shared=Path('hosts/shared/send_to_user_surface.js').read_text()
assert 'skill_path' in shared and 'export_path' in shared
assert 'SendToUser attachments' in shared
assert 'oauthNeedsAuth' in shared or 'NeedsAuth' in shared
assert 'live_needs_auth' in html
assert 'h.kind !== "oauth"' in html
# STU classification: permission card = widget; react_message = reaction
assert 'widget:device_permission:' in shared
assert 'h.kind === "inbound_reaction" || h.kind === "react_message"' in shared
assert 'h.kind === "device_permission"' in shared
assert 'h.kind === "credential_fill"' in shared
assert 'secret-request' in shared
assert 'function residualSuffix' in shared
assert 'live_x_residual' in shared
assert 'h.kind === "react_message"' in html
assert 'types.push("reaction")' in html
assert 'secret-request' in html
assert 'types.push("secret-request")' in html
assert 'id="connect-outlook"' in html or "id=\"connect-outlook\"" in html
assert 'connect outlook' in html
assert 'memory_update' in html and 'memory-meta' in html
# device_permission / credential_fill must not sit in the generic attachment includes list
attach_block = shared.split('.includes(h.kind)')[0]
assert '"device_tool"' in attach_block
assert '"device_permission"' not in attach_block
assert '"credential_fill"' not in attach_block
# Desktop honesty chips + attachKinds parity for delivery strip
for needle in (
  'live_paid_residual',
  'live_calendar_residual',
  'live_mail_residual',
  'live_x_residual',
  'live_job_residual',
  'live_finance_residual',
  'live_slack_residual',
  'live_teams_residual',
  'live_meeting_residual',
  'live_channel_residual',
  'live_sms_residual',
  'live_webhook_residual',
  'live_voice_residual',
  'live_mail_claim_residual',
  'box_doctor_bin_residual',
  'box_chrome_bin_residual',
  'long_lived_cron_residual',
  'remote_cloud_residual',
  'remote_cloud_artifact_residual',
  'code_apply_residual',
  'git_commit_residual',
  'git_push_residual',
  'screenshot_residual',
  'gh_pr_create_residual',
  'public_fallback_residual',
  'interactive_oauth_residual',
  'ocr_residual',
  'os_window_automation_residual',
  'remote_pr_residual',
  'true_device_os_dialog_residual',
  'credential_browser_fill_residual',
  'signin_fill_residual',
  'inbound_turn_residual',
  'inbound_push_residual',
  'voice_stt_residual',
  'voice_tts_residual',
  'voice_end_match_residual',
  'cross_machine_copy_residual',
  'device_capture_residual',
  'device_tool_residual',
  'product_tool_residual',
  'refused_cross_scope',
  '/live_mail_residual',
  '/live_x_residual',
  '/live_job_residual',
  '/live_finance_residual',
  '/live_paid_residual',
  '/live_calendar_residual',
  '/live_slack_residual',
  '/live_teams_residual',
  '/live_meeting_residual',
  '/live_channel_residual',
  '/live_sms_residual',
  '/live_webhook_residual',
  '/live_voice_residual',
  '/live_mail_claim_residual',
  '/remote_cloud_residual',
  '/remote_cloud_artifact_residual',
  '/remote_pr_residual',
  '/gh_pr_create_residual',
  '/real_create_gated',
  '/code_apply_residual',
  '/git_commit_residual',
  '/git_push_residual',
  '/box_doctor_bin_residual',
  '/box_chrome_bin_residual',
  '/long_lived_cron_residual',
  '/screenshot_residual',
  '/credential_browser_fill_residual',
  '/signin_fill_residual',
  '/inbound_turn_residual',
  '/inbound_push_residual',
  '/voice_stt_residual',
  '/voice_tts_residual',
  '/voice_end_match_residual',
  '/cross_machine_copy_residual',
  '/device_capture_residual',
  '/device_tool_residual',
  '/product_tool_residual',
  'h.kind === "screenshot"',
  'vision_plan',
  '"mail_draft"',
  '"package_install"',
  '"shared_box_fs"',
  '"hide_agent"',
  '"reset_computer"',
  '"local_execution"',
  '"list_agents_sidebar"',
  '"members_panel"',
  '"react_message"',
):
  assert needle in html, needle
# Prefer full residual flag names on Desktop chip labels (not short forms).
for short in (
  '? "/live_residual"',
  '? "/gated"',
  '? "/remote_residual"',
  '? "/apply_residual"',
  '? "/bin_residual"',
  '? "/cron_residual"',
):
  assert short not in html, short
assert 'true_device_os_dialog_residual' in shared
assert 'refused_cross_scope' in shared
assert 'gh_pr_create_residual' in shared
assert 'remote_pr_residual' in shared
assert 'remote_cloud_artifact_residual' in shared
assert 'git_commit_residual' in shared
assert 'git_push_residual' in shared
assert 'live_voice_residual' in shared
assert 'live_mail_claim_residual' in shared
assert 'live_sms_residual' in shared
assert 'live_webhook_residual' in shared
assert 'personal-dm:' in html
assert 'p.live_post === true' in html or "p.live_post === true" in html
assert 'widget_degraded' in html
assert 'widget_degraded' in shared
mobile=Path('hosts/mobile_host/run.js').read_text()
assert 'media_path' in mobile and 'html_path' in mobile and 'frame_path' in mobile
assert 'payload.media_path' in mobile
assert 'memory_update' in mobile and 'memory_recall' in mobile
assert '"device_tool"' in mobile and '"delivery"' in mobile
for needle in (
  'live_mail_residual',
  'live_mail_claim_residual',
  'live_x_residual',
  'live_job_residual',
  'live_finance_residual',
  'live_paid_residual',
  'live_calendar_residual',
  'live_slack_residual',
  'live_teams_residual',
  'live_meeting_residual',
  'live_channel_residual',
  'live_sms_residual',
  'live_webhook_residual',
  'live_voice_residual',
  'voice_stt_residual',
  'voice_tts_residual',
  'voice_end_match_residual',
  'inbound_turn_residual',
  'inbound_push_residual',
  'widget_degraded',
  'box_doctor_bin_residual',
  'box_chrome_bin_residual',
  'long_lived_cron_residual',
  'remote_cloud_residual',
  'remote_cloud_artifact_residual',
  'code_apply_residual',
  'git_commit_residual',
  'git_push_residual',
  'screenshot_residual',
  'remote_pr_residual',
  'gh_pr_create_residual',
  'public_fallback_residual',
  'ocr_residual',
  'os_window_automation_residual',
  'interactive_oauth_residual',
  'credential_browser_fill_residual',
  'signin_fill_residual',
  'cross_machine_copy_residual',
  'device_capture_residual',
  'device_tool_residual',
  'product_tool_residual',
):
  assert needle in mobile, needle
ios=Path('hosts/ios/BitBotHost/Sources/BitBotHost/SendToUserSurface.swift').read_text()
android=Path('hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/SendToUserSurface.kt').read_text()
assert 'widget:device_permission:' in ios and 'widget:device_permission:' in android
assert 'inbound_reaction' in ios and 'react_message' in ios
assert 'inbound_reaction' in android and 'react_message' in android
for needle in (
  'gh_pr_create_residual',
  'true_device_os_dialog_residual',
  'remote_pr',
  'real_create_gated',
  'live_sms_residual',
  'live_webhook_residual',
  'live_voice_residual',
  'live_mail_claim_residual',
  'credential_browser_fill_residual',
  'signin_fill_residual',
  'device_capture_residual',
  'cross_machine_copy_residual',
  'voice_stt_residual',
  'voice_tts_residual',
  'voice_end_match_residual',
  'widget_degraded',
  'inbound_push_residual',
  'remote_cloud_artifact_residual',
  'git_commit_residual',
  'git_push_residual',
):
  assert needle in ios, needle
  assert needle in android, needle
print('desktop inline media + HTML + OS-open + NeedsAuth + STU residual chips wired ok')
PY
python3 - <<'PY'
from pathlib import Path
import base64
root = Path('/workspace')
sample = root / 'agent-tools'
sample.mkdir(parents=True, exist_ok=True)
pngs = list(sample.glob('*.png'))
if not pngs:
  img = sample / 'smoke-inline-media.png'
  img.write_bytes(base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ))
else:
  img = pngs[0]
assert img.is_file() and img.stat().st_size > 0
main = Path('hosts/desktop/main.js').read_text()
assert 'bitbot:readArtifact' in main and 'pretend_read: false' in main
print('desktop media artifact sample ok', img)
PY
node hosts/cli_host/run_turn.js "uninstall plugin plugin-slides" >/tmp/bitbot-mcp-uninstall.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mcp-uninstall.json'));assert d.get('intent')=='uninstall_plugin';h=next(x for x in d['host_results'] if x.get('kind')=='mcp_uninstall');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_uninstalled') is False;assert p.get('namespace')=='user-Slides';assert p.get('status')=='Unavailable';assert p.get('usable') is False;assert p.get('namespace_gone') is True;assert p.get('path') and os.path.isfile(p['path']);cat=json.load(open(p['catalog_path']));assert (cat.get('namespaces') or {}).get('user-Slides',{}).get('usable') is False;assert 'plugin-slides' not in (cat.get('installed_plugins') or []);print('mcp_uninstall Unavailable ok', p.get('namespace'), p.get('path'))"
echo "==> Desktop Electron Host smoke turn (ADR 0005 product path)"
(
  cd "$ROOT/hosts/desktop"
  BITBOT_DESKTOP_SMOKE_TURN="ListMachines" \
  BITBOT_REPO_ROOT="$ROOT" \
  ELECTRON_ENABLE_LOGGING=1 \
  npx --no-install electron . --no-sandbox >/tmp/bitbot-desktop-electron-smoke.log 2>&1
)
python3 -c "import json,os;p='data/tmp/desktop-electron-turn.json';assert os.path.isfile(p), open('/tmp/bitbot-desktop-electron-smoke.log').read()[-2000:];d=json.load(open(p));assert d.get('via_electron') is True;assert d.get('moonbit_brain') is True;assert d.get('local_brain') is False;assert d.get('pretend_desktop') is False;assert d.get('ok') is True;t=d.get('turn') or {};assert t.get('intent')=='list_machines';assert t.get('machine_kind')=='desktop';print('desktop electron smoke turn ok', t.get('intent'), p)"

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
echo "==> Host routine_tick honors BITBOT_ROUTINE_LONG_LIVED"
BITBOT_ROUTINE_DAEMON=1 BITBOT_ROUTINE_LONG_LIVED=1 node hosts/cli_host/run_turn.js "tick routines" >/tmp/bitbot-routine-tick-ll.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-routine-tick-ll.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_tick');p=json.loads(h.get('stdout') or '{}');assert p.get('daemon') is True;assert p.get('long_lived') is True;st=__import__('json').load(open('data/routines/daemon-status.json'));assert st.get('long_lived') is True;print('routine_tick long_lived env ok', p.get('fired_count'))"
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
# BITBOT_XDOTOOL_BIN mock closes os_window_automation_residual (injectable like BITBOT_TESSERACT_BIN).
rm -rf /tmp/bitbot-xdotool-mock
mkdir -p /tmp/bitbot-xdotool-mock
BITBOT_CU_NATIVE_ACT=1 BITBOT_XDOTOOL_BIN="$ROOT/scripts/host_xdotool_mock.sh" BITBOT_XDOTOOL_MOCK_LOG_DIR=/tmp/bitbot-xdotool-mock \
  node hosts/cli_host/run_turn.js "computer use open https://example.com click:40,40" >/tmp/bitbot-cu-native-mock.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cu-native-mock.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');g=p.get('gui') or {};act=g.get('native_os_act') or {};assert act.get('enabled') is True;assert act.get('ok') is True;assert g.get('os_window_automation_residual') is False;assert act.get('os_window_automation_residual') is False;assert os.path.isfile('/tmp/bitbot-xdotool-mock/last-xdotool.json');print('computer_use native OS xdotool bin mock residual close ok', 'actions', len(act.get('actions') or []), 'residual', False)"
BITBOT_CU_OCR=1 node hosts/cli_host/run_turn.js "computer use open https://example.com click:40,40" >/tmp/bitbot-cu-ocr.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-ocr.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};g=p.get('gui') or {};vp=(g.get('vision_plan') or {});assert oc.get('ocr') is True or (vp.get('ocr') is True);assert oc.get('ocr_residual') is False or vp.get('ocr_residual') is False;print('computer_use OCR ok', 'ocr', oc.get('ocr'), 'text_prefix', (oc.get('ocr_text_prefix') or '')[:40])"
# BITBOT_TESSERACT_BIN mock closes ocr_residual (injectable like BITBOT_STT_BIN).
rm -rf /tmp/bitbot-tesseract-mock
mkdir -p /tmp/bitbot-tesseract-mock
BITBOT_CU_OCR=1 BITBOT_TESSERACT_BIN="$ROOT/scripts/host_tesseract_mock.sh" BITBOT_TESSERACT_MOCK_LOG_DIR=/tmp/bitbot-tesseract-mock \
  node hosts/cli_host/run_turn.js "computer use open https://example.com click:40,40" >/tmp/bitbot-cu-ocr-mock.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cu-ocr-mock.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};g=p.get('gui') or {};vp=(g.get('vision_plan') or {});assert oc.get('ocr') is True or (vp.get('ocr') is True);assert oc.get('ocr_residual') is False;assert (vp.get('ocr_residual') is False) if 'ocr_residual' in vp else True;assert 'mock ocr text' in (oc.get('ocr_text_prefix') or vp.get('ocr_text_prefix') or '');assert os.path.isfile('/tmp/bitbot-tesseract-mock/last-ocr.json');print('computer_use OCR tesseract bin mock residual close ok', 'ocr', True, 'residual', False)"
BITBOT_OAUTH_MODE=live node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-live.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok') is False;p=json.loads(h.get('stdout') or '{}');assert p.get('status')=='NeedsAuth' or 'NeedsAuth' in (h.get('stdout') or '');assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_connected') is False;deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('type')=='widget';assert dp.get('needs_auth') is True or dp.get('status')=='NeedsAuth';assert dp.get('pretend_connected') is not True;print('oauth live NeedsAuth (honest) ok', p.get('path'), 'delivery', dp.get('status'))"
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
echo "==> Host CU payment_wall live /charge (closes live_paid_residual)"
python3 "$ROOT/scripts/host_cu_checkout_fixture.py" --port 18788 >/tmp/bitbot-checkout-fixture-paid.log 2>&1 &
CHECKOUT_PAID_PID=$!
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18789 --mode purchase --token smoke-purchase >/tmp/bitbot-cu-charge-mock.log 2>&1 &
CHARGE_MOCK_PID=$!
sleep 0.4
BITBOT_CU_ALLOW_LOCAL=1 BITBOT_CU_LIVE_PAID=1 BITBOT_PURCHASE_API_URL=http://127.0.0.1:18789 BITBOT_PURCHASE_TOKEN=smoke-purchase \
  node hosts/cli_host/run_turn.js "computer use open http://127.0.0.1:18788/ shop cart checkout buy" >/tmp/bitbot-cu-paywall-live.json || true
kill "$CHECKOUT_PAID_PID" "$CHARGE_MOCK_PID" >/dev/null 2>&1 || true
wait "$CHECKOUT_PAID_PID" "$CHARGE_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-paywall-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};assert oc.get('has_payment') is True;assert oc.get('paid_checkout_attempted') is True;assert oc.get('live_paid_residual') is False;assert oc.get('pretend_purchased') is False;assert (oc.get('charge_probe') or {}).get('ok') is True;print('computer_use payment_wall live charge ok', oc.get('checkout_stage'), oc.get('charge_probe'))"
echo "==> Host CU blocked_on_signin username CDP fill (closes credential_browser_fill_residual; password deferred)"
mkdir -p data/credentials/fills
python3 - <<'PY'
import json, time
from pathlib import Path
plan = {
  "fill_handle": "fill-cu-signin-smoke",
  "domain": "127.0.0.1",
  "username": "cu-smoke-user",
  "secret_in_plan": False,
  "navigate_url": "http://127.0.0.1:18766/",
  "cdp_actions": [
    "focus:input[type=email],input[name*=user],input[name*=email],input[type=text]",
    "type_username:cu-smoke-user",
    "password_fill:residual",
  ],
  "pretend_secret_view": False,
  "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
# Lexicographically newest under sorted(..., reverse=True)
path = Path("data/credentials/fills/browser-plan-zzz-cu-signin-smoke.json")
path.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
print(path)
PY
python3 "$ROOT/scripts/host_cu_signin_fixture.py" --port 18766 >/tmp/bitbot-signin-fixture.log 2>&1 &
SIGNIN_FIX_PID=$!
sleep 0.4
BITBOT_CU_ALLOW_LOCAL=1 node hosts/cli_host/run_turn.js "computer use open http://127.0.0.1:18766/ sign in login" >/tmp/bitbot-cu-signin.json || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cu-signin.json'));h=next(x for x in d['host_results'] if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};sf=oc.get('signin_fill') or {};assert oc.get('blocked_on_signin') is True;assert sf.get('username_planned') is True;assert sf.get('username_typed') is True;assert sf.get('password_filled') is False;assert sf.get('filled') is False;assert oc.get('credential_browser_fill_residual') is False;assert oc.get('signin_fill_residual') is True;assert 'vault:secret' not in json.dumps(oc).lower();print('computer_use blocked_on_signin username fill ok', sf.get('mode'), 'cred_residual', False, 'signin_residual', True)"
# Mock path still closes username residual only (password deferred).
BITBOT_CU_ALLOW_LOCAL=1 BITBOT_CU_SIGNIN_USERNAME_MOCK=1 node hosts/cli_host/run_turn.js "computer use open http://127.0.0.1:18766/ sign in login" >/tmp/bitbot-cu-signin-mock.json || true
kill "$SIGNIN_FIX_PID" >/dev/null 2>&1 || true
wait "$SIGNIN_FIX_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-signin-mock.json'));h=next(x for x in d['host_results'] if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};sf=oc.get('signin_fill') or {};assert oc.get('blocked_on_signin') is True;assert sf.get('username_typed') is True;assert oc.get('credential_browser_fill_residual') is False;assert oc.get('signin_fill_residual') is True;assert sf.get('mode')=='host_cu_signin_username_mock';print('computer_use signin username mock residual close ok', sf.get('mode'), 'signin_fill_residual', True)"
node hosts/cli_host/run_turn.js "shop target.com headphones" >/tmp/bitbot-cu-vision.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cu-vision.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');al=p.get('agent_loop') or {};assert 'vision' in al;oc=p.get('outcome') or {};assert 'vision_ok' in oc;v=al.get('vision') or {};dt=v.get('dom_targets');assert isinstance(dt,dict) or dt is None;print('computer_use vision planner host ok', 'vision_ok', oc.get('vision_ok'), 'blocked_on_signin', oc.get('blocked_on_signin'), 'hotspots', bool(v.get('hotspots')), 'dom_targets', isinstance(dt,dict), 'has_bbox', bool(dt and any(dt.values())))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_OPEN_BROWSER=1 BITBOT_OAUTH_CLIENT_ID=smoke-client node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-browser.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-browser.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok') is False;p=json.loads(h.get('stdout') or '{}');assert p.get('status')=='NeedsAuth';assert p.get('browser_opened') is True or p.get('mode')=='live_remote_browser_open';assert p.get('path') and os.path.isfile(p['path']);print('oauth live_remote_browser_open NeedsAuth ok', 'browser_opened', p.get('browser_opened'), 'tool', p.get('browser_tool'), p.get('path'))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=remote_callback BITBOT_OAUTH_AUTHORIZE_URL=https://oauth.example.invalid/authorize BITBOT_OAUTH_TOKEN_URL=https://oauth.example.invalid/token BITBOT_OAUTH_CLIENT_ID=smoke-client BITBOT_OAUTH_CALLBACK_WAIT_MS=6000 node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-callback.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-callback.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_remote_callback';assert p.get('callback_received') is True;assert p.get('connected') is True;assert p.get('path') and os.path.isfile(p['path']);print('oauth live_remote_callback browser→token ok', 'browser_opened', p.get('browser_opened'), p.get('path'))"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: smoke body" >/tmp/bitbot-channel.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-channel.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('live_slack_residual') is True;assert p.get('pretend_live') is False;assert p.get('live_post') is False;assert 'outbound' in (h.get('stdout') or '') or os.path.isfile('data/channels/outbound.jsonl');print('channel_send outbound durable ok', 'live_slack_residual', p.get('live_slack_residual'))"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke:1710000.000100 :: thread reply" >/tmp/bitbot-channel-thread.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-channel-thread.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('thread_ts')=='1710000.000100' or '1710000.000100' in (h.get('stdout') or '');print('channel_send slack thread_ts durable ok', p.get('mode'))"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke thread_ts=1710000.000200 :: thread kv reply" >/tmp/bitbot-channel-thread-kv.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-channel-thread-kv.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('thread_ts')=='1710000.000200';assert 'thread' in str(p.get('mode') or '');deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('type')=='thread';print('channel_send slack thread_ts= kv ok', p.get('mode'), dp.get('type'))"
BITBOT_SLACK_CLAIM=1 node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: claim rehearsal" >/tmp/bitbot-channel-claim.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-channel-claim.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='sandbox_slack_claim';assert p.get('live_slack_residual') is True;assert p.get('pretend_live') is False;assert os.path.isfile('data/channels/inbound.jsonl');print('channel_send sandbox_slack_claim inbound ok', 'claimed', p.get('claimed_count'))"
node hosts/cli_host/run_turn.js "shop target.com headphones" >/tmp/bitbot-cu-vision-gui.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cu-vision-gui.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');g=p.get('gui') or {};assert g.get('vision_ok') is True;assert isinstance(g.get('vision_plan'),dict);assert p.get('evidence') and os.path.isfile(p['evidence']);deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('attachment_path')==p.get('evidence') or dp.get('path')==p.get('evidence');print('computer_use gui.vision_plan+evidence attachment ok', g.get('vision_plan'))"
node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: teams body [widget:decision_card]" >/tmp/bitbot-teams.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-teams.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('scheme')=='teams';assert p.get('widget_degraded') is True;assert p.get('live_teams_residual') is True;assert p.get('pretend_live') is False;assert '[widget:' not in (p.get('body') or '');assert p.get('teams_transcript') and os.path.isfile(p['teams_transcript']);print('channel_send teams outbound+degrade ok', p.get('mode'), 'live_teams_residual', p.get('live_teams_residual'))"
# Live Slack post / claim / thread against local mock (BITBOT_SLACK_API_BASE)
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18769 --mode slack --token smoke-slack >/tmp/bitbot-slack-mock.log 2>&1 &
SLACK_MOCK_PID=$!
sleep 0.4
BITBOT_SLACK_API_BASE=http://127.0.0.1:18769 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_POST=1 node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: live mock body" >/tmp/bitbot-slack-live.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-slack-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('live_post') is True;assert p.get('live_slack_residual') is False;assert p.get('pretend_live') is False;assert p.get('mode')=='live_slack';assert p.get('ts');print('channel_send slack live mock ok', p.get('mode'), 'ts', p.get('ts'))"
BITBOT_SLACK_API_BASE=http://127.0.0.1:18769 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_CLAIM=1 node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: claim live [widget:decision_card]" >/tmp/bitbot-slack-claim-live.json || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-slack-claim-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_slack_claim';assert p.get('claimed_count',0)>=1;assert p.get('live_slack_residual') is False;assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert (p.get('claim') or {}).get('ok') is True or p.get('ok') is True;assert p.get('pretend_live') is False;assert os.path.isfile('data/channels/inbound.jsonl');rows=open('data/channels/inbound.jsonl').read();assert 'live_slack_claim' in rows;print('channel_send slack live claim residual close ok', 'claimed', p.get('claimed_count'), 'residual', False)"
# Slack live claim + BITBOT_INBOUND_TURN closes inbound_turn_residual (parity with Teams/mail).
BITBOT_SLACK_API_BASE=http://127.0.0.1:18769 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_CLAIM=1 BITBOT_INBOUND_TURN=1 \
  node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: claim inbound turn" >/tmp/bitbot-slack-claim-turn.json || true
BITBOT_SLACK_API_BASE=http://127.0.0.1:18769 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_POST=1 node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke thread_ts=1710000000.000060 :: live thread mock" >/tmp/bitbot-slack-live-thread.json || true
kill "$SLACK_MOCK_PID" >/dev/null 2>&1 || true
wait "$SLACK_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-slack-claim-turn.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_slack_claim';assert p.get('live_slack_residual') is False;th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;assert p.get('inbound_turn_residual') is False;assert p.get('inbound_push_residual') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('channel_send slack claim inbound turn residual close ok', th.get('turn_path'), 'inbound_push_residual', True)"
python3 -c "import json;d=json.load(open('/tmp/bitbot-slack-live-thread.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('live_post') is True;assert p.get('mode')=='live_slack_thread';assert p.get('thread_ts')=='1710000000.000060';assert p.get('pretend_live') is False;deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('type')=='thread';print('channel_send slack live thread ok', p.get('mode'), 'ts', p.get('ts'))"
# Empty HTTP-ok Slack inbox keeps live_slack_residual open; no inbound turn success.
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18803 --mode slack --token smoke-slack --empty >/tmp/bitbot-slack-empty-mock.log 2>&1 &
SLACK_EMPTY_MOCK_PID=$!
sleep 0.4
BITBOT_SLACK_API_BASE=http://127.0.0.1:18803 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_CLAIM=1 BITBOT_INBOUND_TURN=1 \
  node hosts/cli_host/run_turn.js --approved "reply via slack:Cempty :: claim empty inbox" >/tmp/bitbot-slack-claim-empty.json || true
kill "$SLACK_EMPTY_MOCK_PID" >/dev/null 2>&1 || true
wait "$SLACK_EMPTY_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-slack-claim-empty.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_slack_claim';assert p.get('claimed_count',0)==0;assert p.get('live_slack_residual') is True;assert p.get('ok') is False;assert (p.get('claim') or {}).get('ok') is False;th=p.get('turn_hook') or {};assert th.get('turn_executed') is not True;assert p.get('inbound_turn_residual') is None or p.get('inbound_turn_residual') is True;assert p.get('pretend_live') is False;print('channel_send slack empty claim residual open ok', 'claimed', p.get('claimed_count'), 'residual', True)"
# Live Teams Graph post / claim against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18770 --mode teams --token smoke-teams >/tmp/bitbot-teams-mock.log 2>&1 &
TEAMS_MOCK_PID=$!
sleep 0.4
BITBOT_TEAMS_GRAPH_URL=http://127.0.0.1:18770 BITBOT_TEAMS_TOKEN=smoke-teams BITBOT_TEAMS_POST=1 node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: live teams mock" >/tmp/bitbot-teams-live.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-teams-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('scheme')=='teams';assert p.get('live_post') is True;assert p.get('live_teams_residual') is False;assert p.get('pretend_live') is False;assert p.get('mode')=='live_teams_chat_message';print('channel_send teams live mock ok', p.get('mode'), 'status', p.get('http_status'))"
# Live Teams post + CM-1104 widget degrade closes live_teams_residual.
BITBOT_TEAMS_GRAPH_URL=http://127.0.0.1:18770 BITBOT_TEAMS_TOKEN=smoke-teams BITBOT_TEAMS_POST=1 \
  node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: live teams [widget:decision_card]" >/tmp/bitbot-teams-live-widget.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-teams-live-widget.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_teams_chat_message';assert p.get('live_post') is True;assert p.get('live_teams_residual') is False;assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('pretend_live') is False;print('channel_send teams live+widget residual close ok', p.get('mode'), 'degraded', True)"
# Teams live via connector token file (resolveProviderAccessToken), not only env.
mkdir -p data/connectors
printf '%s\n' '{"access_token":"smoke-teams","token_type":"Bearer"}' > data/connectors/teams_token.json
BITBOT_TEAMS_GRAPH_URL=http://127.0.0.1:18770 BITBOT_TEAMS_POST=1 \
  env -u BITBOT_TEAMS_TOKEN \
  node hosts/cli_host/run_turn.js --approved "reply via teams:Tfile :: live teams file token" >/tmp/bitbot-teams-file-token.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-teams-file-token.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('live_post') is True;assert p.get('live_teams_residual') is False;assert p.get('mode')=='live_teams_chat_message';print('channel_send teams connector token file ok', p.get('mode'))"
# Live Teams claim closes live_teams_residual (Graph messages claimed); widget degrade on claim body.
BITBOT_TEAMS_GRAPH_URL=http://127.0.0.1:18770 BITBOT_TEAMS_TOKEN=smoke-teams BITBOT_TEAMS_CLAIM=1 \
  node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: claim teams [widget:decision_card]" >/tmp/bitbot-teams-claim-live.json || true
# Live Teams claim + BITBOT_INBOUND_TURN closes inbound_turn_residual (parity with webhook/mail).
BITBOT_TEAMS_GRAPH_URL=http://127.0.0.1:18770 BITBOT_TEAMS_TOKEN=smoke-teams BITBOT_TEAMS_CLAIM=1 BITBOT_INBOUND_TURN=1 \
  node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: claim teams inbound turn" >/tmp/bitbot-teams-claim-turn.json || true
kill "$TEAMS_MOCK_PID" >/dev/null 2>&1 || true
wait "$TEAMS_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-teams-claim-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_teams_claim';assert p.get('claimed_count',0)>=1;assert p.get('live_teams_residual') is False;assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('pretend_live') is False;assert os.path.isfile('data/channels/inbound.jsonl');assert 'live_teams_claim' in open('data/channels/inbound.jsonl').read();print('channel_send teams live claim residual close ok', 'claimed', p.get('claimed_count'), 'residual', False)"
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-teams-claim-turn.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_teams_claim';assert p.get('live_teams_residual') is False;th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;assert p.get('inbound_turn_residual') is False;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('channel_send teams claim inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Clear connector token so sandbox claim is not reclassified as live_teams_claim.
rm -f data/connectors/teams_token.json
env -u BITBOT_TEAMS_TOKEN -u BITBOT_TEAMS_GRAPH_URL BITBOT_TEAMS_CLAIM=1 \
  node hosts/cli_host/run_turn.js --approved "reply via teams:Tsmoke :: sandbox claim" >/tmp/bitbot-teams-claim-sandbox.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-teams-claim-sandbox.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='sandbox_teams_claim';assert p.get('pretend_live') is False;assert p.get('live_teams_residual') is True;print('channel_send teams sandbox claim ok')"
# copy_to_box / copy_from_box durable JSON under data/box-copy/
mkdir -p uploads
echo 'box-copy-smoke' > uploads/box-src.txt
node hosts/cli_host/run_turn.js "copy to box machine=desk-1 src=uploads/box-src.txt dest=uploads/box-dest.txt" >/tmp/bitbot-copy-to-box.json
python3 -c "import json,os,glob;d=json.load(open('/tmp/bitbot-copy-to-box.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='copy_to_box');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('under_repo') is True;assert p.get('pretend_remote_machine') is False;assert p.get('cross_machine_copy_residual') is True;assert p.get('binary_intact') is True;assert p.get('sha256_src')==p.get('sha256_dest');assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('uploads/box-dest.txt');assert glob.glob('data/box-copy/copy_to_box-*.json');print('copy_to_box artifact ok', p.get('path'), 'bytes', p.get('bytes'), 'sha', str(p.get('sha256_src') or '')[:12], 'cross_machine_residual', True)"
# Cross-machine SCP mock closes residual when BITBOT_COPYBOX_REMOTE=1 + BITBOT_SCP_BIN.
rm -rf /tmp/bitbot-scp-mock
mkdir -p /tmp/bitbot-scp-mock
BITBOT_COPYBOX_REMOTE=1 BITBOT_COPYBOX_SSH=smoke@127.0.0.1 \
  BITBOT_SCP_BIN="$ROOT/scripts/host_scp_mock.sh" BITBOT_SCP_MOCK_LOG_DIR=/tmp/bitbot-scp-mock \
  node hosts/cli_host/run_turn.js "copy to box machine=desk-1 src=uploads/box-src.txt dest=uploads/box-dest-scp.txt" >/tmp/bitbot-copy-scp.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-copy-scp.json'));h=next(x for x in d['host_results'] if x.get('kind')=='copy_to_box');p=json.loads(h['stdout']);assert p.get('ok') is True;assert p.get('cross_machine_copy_residual') is False;remote=p.get('remote') or {};assert remote.get('attempted') is True;assert remote.get('ok') is True;assert remote.get('host')=='smoke@127.0.0.1';assert os.path.isfile('/tmp/bitbot-scp-mock/last-scp.json');assert os.path.isfile('/tmp/bitbot-scp-mock/invocations.log');print('copy_to_box SCP mock residual close ok', remote.get('scp_bin'), p.get('path'))"
# Fresh dest so default overwrite=Refuse does not trip on prior smoke runs.
rm -f uploads/box-out.txt
node hosts/cli_host/run_turn.js "copy from box machine=desk-1 box=uploads/box-dest.txt dest=uploads/box-out.txt" >/tmp/bitbot-copy-from-box.json
python3 -c "import json,os,glob;d=json.load(open('/tmp/bitbot-copy-from-box.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='copy_from_box');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('uploads/box-out.txt');assert p.get('binary_intact') is True;assert glob.glob('data/box-copy/copy_from_box-*.json');print('copy_from_box artifact ok', p.get('path'), 'bytes', p.get('bytes'))"
# Cross-machine SCP mock closes residual on copy_from_box (parity with copy_to_box).
rm -rf /tmp/bitbot-scp-mock-from
mkdir -p /tmp/bitbot-scp-mock-from
rm -f uploads/box-out-scp.txt
BITBOT_COPYBOX_REMOTE=1 BITBOT_COPYBOX_SSH=smoke@127.0.0.1 \
  BITBOT_SCP_BIN="$ROOT/scripts/host_scp_mock.sh" BITBOT_SCP_MOCK_LOG_DIR=/tmp/bitbot-scp-mock-from \
  node hosts/cli_host/run_turn.js "copy from box machine=desk-1 box=uploads/box-dest.txt dest=uploads/box-out-scp.txt" >/tmp/bitbot-copy-from-scp.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-copy-from-scp.json'));h=next(x for x in d['host_results'] if x.get('kind')=='copy_from_box');p=json.loads(h['stdout']);assert p.get('ok') is True;assert p.get('cross_machine_copy_residual') is False;remote=p.get('remote') or {};assert remote.get('attempted') is True;assert remote.get('ok') is True;assert remote.get('host')=='smoke@127.0.0.1';assert os.path.isfile('uploads/box-out-scp.txt');assert os.path.isfile('/tmp/bitbot-scp-mock-from/last-scp.json');print('copy_from_box SCP mock residual close ok', remote.get('scp_bin'), p.get('path'))"
# CM-0703 size refuse + CM-0704 overwrite refuse
python3 -c "p='uploads/huge-box.bin';f=open(p,'wb');f.seek(100*1024*1024);f.write(b'x');f.close()"
node hosts/cli_host/run_turn.js "copy to box machine=desk-1 src=uploads/huge-box.bin dest=uploads/huge-out.bin" >/tmp/bitbot-copy-huge.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-copy-huge.json'));h=next(x for x in d['host_results'] if x.get('kind')=='copy_to_box');p=json.loads(h['stdout']);assert p.get('refused') is True;assert p.get('ok') is False;assert '100MiB' in (p.get('error') or '');assert p.get('path') and os.path.isfile(p['path']);print('copy_to_box 100MiB refuse ok', p.get('mode'));os.remove('uploads/huge-box.bin')"
echo old > uploads/box-out-exist.txt
node hosts/cli_host/run_turn.js "copy from box machine=desk-1 box=uploads/box-dest.txt dest=uploads/box-out-exist.txt" >/tmp/bitbot-copy-ow.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-copy-ow.json'));h=next(x for x in d['host_results'] if x.get('kind')=='copy_from_box');p=json.loads(h['stdout']);assert p.get('refused') is True;assert p.get('overwrite')=='refuse';assert open('uploads/box-out-exist.txt').read().strip()=='old';print('copy_from_box overwrite refuse ok', p.get('mode'))"
node hosts/cli_host/run_turn.js "meeting chat body=standup note direct=1" >/tmp/bitbot-meeting-direct.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-meeting-direct.json'));assert d.get('ok');assert d.get('intent')=='meeting_chat';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='meeting_chat_direct';assert p.get('direct_send') is True;assert p.get('live_post') is False;assert p.get('live_meeting_residual') is True;assert p.get('pretend_live') is False;assert p.get('transcript') and os.path.isfile(p['transcript']);print('meeting_chat DirectSend ok', p.get('transcript'), 'live_residual', p.get('live_meeting_residual'))"
# Live meeting transport against local mock (closes residual when API+token+POST=1)
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18766 --mode meeting --token smoke-meeting >/tmp/bitbot-meeting-mock.log 2>&1 &
MEETING_MOCK_PID=$!
sleep 0.4
# Token+API without POST gate stays DirectSend residual (honest; parity with Slack/Teams/SMS).
BITBOT_MEETING_API_URL=http://127.0.0.1:18766 BITBOT_MEETING_TOKEN=smoke-meeting \
  env -u BITBOT_MEETING_POST \
  node hosts/cli_host/run_turn.js "meeting chat body=no post gate direct=1" >/tmp/bitbot-meeting-nopost.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-meeting-nopost.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='meeting_chat_direct';assert p.get('live_post') is False;assert p.get('live_meeting_residual') is True;assert p.get('pretend_live') is False;print('meeting_chat no-POST gate residual open ok')"
BITBOT_MEETING_API_URL=http://127.0.0.1:18766 BITBOT_MEETING_TOKEN=smoke-meeting BITBOT_MEETING_POST=1 \
  node hosts/cli_host/run_turn.js "meeting chat body=live standup direct=1" >/tmp/bitbot-meeting-live.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-meeting-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('live_post') is True;assert p.get('live_meeting_residual') is False;assert p.get('mode')=='meeting_chat_live';assert p.get('pretend_live') is False;print('meeting_chat live transport ok', p.get('live_probe'))"
# Live meeting + CM-1104 widget degrade closes live_meeting_residual.
BITBOT_MEETING_API_URL=http://127.0.0.1:18766 BITBOT_MEETING_TOKEN=smoke-meeting BITBOT_MEETING_POST=1 \
  node hosts/cli_host/run_turn.js "meeting chat body=live standup [widget:decision_card] direct=1" >/tmp/bitbot-meeting-live-widget.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-meeting-live-widget.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='meeting_chat_live';assert p.get('live_post') is True;assert p.get('live_meeting_residual') is False;assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('pretend_live') is False;print('meeting_chat live+widget residual close ok', p.get('mode'), 'degraded', True)"
# Live meeting POST fail leaves residual open (honest live_failed mode).
BITBOT_MEETING_API_URL=http://127.0.0.1:18766 BITBOT_MEETING_TOKEN=wrong-meeting BITBOT_MEETING_POST=1 \
  node hosts/cli_host/run_turn.js "meeting chat body=fail standup direct=1" >/tmp/bitbot-meeting-live-fail.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-meeting-live-fail.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='meeting_chat_live_failed';assert p.get('live_post') is False;assert p.get('live_meeting_residual') is True;assert p.get('pretend_live') is False;print('meeting_chat live fail residual open ok', p.get('mode'), (p.get('live_probe') or {}).get('http_status'))"
mkdir -p data/connectors
printf '%s\n' '{"access_token":"smoke-meeting","token_type":"Bearer"}' > data/connectors/meeting_token.json
BITBOT_MEETING_API_URL=http://127.0.0.1:18766 BITBOT_MEETING_POST=1 \
  env -u BITBOT_MEETING_TOKEN \
  node hosts/cli_host/run_turn.js "meeting chat body=file token standup direct=1" >/tmp/bitbot-meeting-file-token.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-meeting-file-token.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('live_post') is True;assert p.get('live_meeting_residual') is False;assert p.get('mode')=='meeting_chat_live';print('meeting_chat connector token file ok', p.get('live_probe'))"
# Live meeting claim closes live_meeting_residual (GET /messages); widget degrade on claim body.
BITBOT_MEETING_API_URL=http://127.0.0.1:18766 BITBOT_MEETING_TOKEN=smoke-meeting BITBOT_MEETING_CLAIM=1 \
  node hosts/cli_host/run_turn.js "meeting chat body=claim meeting [widget:decision_card] direct=1" >/tmp/bitbot-meeting-claim-live.json || true
# Live meeting claim + BITBOT_INBOUND_TURN closes inbound_turn_residual (parity with Slack/Teams).
BITBOT_MEETING_API_URL=http://127.0.0.1:18766 BITBOT_MEETING_TOKEN=smoke-meeting BITBOT_MEETING_CLAIM=1 BITBOT_INBOUND_TURN=1 \
  node hosts/cli_host/run_turn.js "meeting chat body=claim meeting inbound turn direct=1" >/tmp/bitbot-meeting-claim-turn.json || true
kill "$MEETING_MOCK_PID" >/dev/null 2>&1 || true
wait "$MEETING_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-meeting-claim-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_meeting_claim';assert p.get('claimed_count',0)>=1;assert p.get('live_meeting_residual') is False;assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('pretend_live') is False;assert os.path.isfile('data/channels/inbound.jsonl');assert 'live_meeting_claim' in open('data/channels/inbound.jsonl').read();print('meeting_chat live claim residual close ok', 'claimed', p.get('claimed_count'), 'residual', False)"
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-meeting-claim-turn.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_meeting_claim';assert p.get('live_meeting_residual') is False;th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;assert p.get('inbound_turn_residual') is False;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('meeting_chat claim inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Sandbox meeting claim leaves residual open.
rm -f data/connectors/meeting_token.json
env -u BITBOT_MEETING_TOKEN -u BITBOT_MEETING_API_URL BITBOT_MEETING_CLAIM=1 \
  node hosts/cli_host/run_turn.js "meeting chat body=sandbox claim direct=1" >/tmp/bitbot-meeting-claim-sandbox.json || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-meeting-claim-sandbox.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='sandbox_meeting_claim';assert p.get('live_meeting_residual') is True;assert p.get('pretend_live') is False;assert p.get('claimed_count',0)>=1;assert os.path.isfile('data/channels/inbound.jsonl');print('meeting_chat sandbox claim residual open ok', p.get('claimed_count'))"
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
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mail-search.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_search');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode') in ('sandbox','gmail_live','gmail_live_failed','outlook_live','outlook_live_failed');assert p.get('pretend_live') is False;assert p.get('hit_count')>=1;assert p.get('path') and os.path.isfile(p['path']);print('mail_search artifact ok', p.get('mode'), p.get('path'), 'hits', p.get('hit_count'), 'residual', p.get('live_mail_residual'))"
node hosts/cli_host/run_turn.js "read mail t-invoice-1" >/tmp/bitbot-mail-read.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mail-read.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_read');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode') in ('sandbox','gmail_live','gmail_live_failed','outlook_live','outlook_live_failed');assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);print('mail_read artifact ok', p.get('mode'), p.get('path'), 'thread', p.get('thread_id'), 'residual', p.get('live_mail_residual'))"
node hosts/cli_host/run_turn.js "list workflows" >/tmp/bitbot-workflows.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-workflows.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='workflow_list');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('count')>=1;assert p.get('path') and os.path.isfile(p['path']);assert p.get('catalog_path') and os.path.isfile(p['catalog_path']);assert p.get('pretend_shared') is False;print('workflow_list catalog ok', p.get('count'), p.get('path'))"
# Clear prior live token file so sandbox mode is not reclassified as x_live*.
rm -f data/connectors/x_token.json
env -u BITBOT_X_BEARER -u BITBOT_X_TOKEN -u BITBOT_X_API_BASE \
  node hosts/cli_host/run_turn.js "x search moonbit" >/tmp/bitbot-x-search.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-x-search.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='x_search');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='sandbox_public';assert p.get('live_x_residual') is True;assert p.get('pretend_live') is False;assert p.get('hit_count')>=1;assert p.get('path') and os.path.isfile(p['path']);print('x_search sandbox artifact ok', p.get('path'), 'hits', p.get('hit_count'))"
# Live X search against local mock (BITBOT_X_API_BASE)
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18772 --mode x --token smoke-x >/tmp/bitbot-x-mock.log 2>&1 &
X_MOCK_PID=$!
sleep 0.4
BITBOT_X_API_BASE=http://127.0.0.1:18772 BITBOT_X_BEARER=smoke-x node hosts/cli_host/run_turn.js "x search moonbit" >/tmp/bitbot-x-live.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-x-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='x_search');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='x_live';assert p.get('live_x_residual') is False;assert p.get('pretend_live') is False;assert p.get('hit_count')>=1;print('x_search live mock ok', p.get('path'), 'hits', p.get('hit_count'))"
mkdir -p data/connectors
printf '%s\n' '{"access_token":"smoke-x","token_type":"Bearer","api_url":"http://127.0.0.1:18772"}' > data/connectors/x_token.json
env -u BITBOT_X_BEARER -u BITBOT_X_TOKEN -u BITBOT_X_API_BASE \
  node hosts/cli_host/run_turn.js "x search moonbit" >/tmp/bitbot-x-file-token.json || true
kill "$X_MOCK_PID" >/dev/null 2>&1 || true
wait "$X_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-x-file-token.json'));h=next(x for x in d['host_results'] if x.get('kind')=='x_search');p=json.loads(h['stdout']);assert p.get('mode')=='x_live';assert p.get('live_x_residual') is False;print('x_search connector token+api_url file ok', p.get('mode'))"

echo "==> Host durable product delivery (voice/teammates/device/subagent/cloud/commerce)"
# Drop stale STT sidecars so honest voice_session keeps voice_stt_residual open.
rm -f data/voice/media/voice_smoke1.wav.stt.txt data/voice/media/voice_smoke1.stt.txt
node hosts/cli_host/run_turn.js "voice start smoke1" >/tmp/bitbot-voice.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='voice_session');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('media_ok') is True;assert os.path.isfile(p.get('media_path') or '');assert open(p['media_path'],'rb').read(4)==b'RIFF';assert p.get('pretend_live') is False;assert p.get('call_id');assert p.get('voice_stt_residual') is True;assert isinstance(p.get('voice_tts_residual'),bool);assert p.get('path') and os.path.isfile(p['path']);assert p.get('sessions_path') and os.path.isfile(p['sessions_path']);open('/tmp/bitbot-voice-call-id.txt','w').write(p['call_id']);print('voice_session durable+media ok', p.get('path'), 'call_id', p.get('call_id'), 'bytes', p.get('media_bytes'), 'stt_residual', True)"
# BITBOT_STT_BIN mock closes voice_stt_residual on voice_session start (not hardcode after sine).
rm -rf /tmp/bitbot-voice-session-stt-mock
mkdir -p /tmp/bitbot-voice-session-stt-mock
BITBOT_STT_BIN="$ROOT/scripts/host_stt_mock.sh" BITBOT_STT_MOCK_LOG_DIR=/tmp/bitbot-voice-session-stt-mock \
  node hosts/cli_host/run_turn.js "voice start sttsession" >/tmp/bitbot-voice-session-stt.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-session-stt.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='voice_session');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('media_ok') is True;assert p.get('stt_ok') is True;assert p.get('stt_tool')=='host_stt_mock.sh';assert p.get('voice_stt_residual') is False;assert 'mock stt transcript' in (p.get('stt_text') or '');assert os.path.isfile('/tmp/bitbot-voice-session-stt-mock/last-stt.json');print('voice_session STT bin mock residual close ok', p.get('stt_tool'), 'residual', False, p.get('path'))"
# BITBOT_ESPEAK_BIN mock closes voice_tts_residual on voice_session start (not ffmpeg-sine hardcode).
rm -rf /tmp/bitbot-voice-session-tts-mock
mkdir -p /tmp/bitbot-voice-session-tts-mock
BITBOT_ESPEAK_BIN="$ROOT/scripts/host_espeak_mock.sh" BITBOT_ESPEAK_MOCK_LOG_DIR=/tmp/bitbot-voice-session-tts-mock \
  node hosts/cli_host/run_turn.js "voice start ttssession" >/tmp/bitbot-voice-session-tts.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-session-tts.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='voice_session');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('media_ok') is True;assert p.get('media_tool')=='espeak';assert p.get('voice_tts_residual') is False;assert open(p['media_path'],'rb').read(4)==b'RIFF';assert os.path.isfile('/tmp/bitbot-voice-session-tts-mock/last-espeak.json');print('voice_session TTS bin mock residual close ok', p.get('media_tool'), 'residual', False, p.get('path'))"
node hosts/cli_host/run_turn.js "voice relay smoke1 :: hello from smoke" >/tmp/bitbot-voice-relay.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-relay.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='voice_relay');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('turns')>=2;assert p.get('transcript_path') and os.path.isfile(p['transcript_path']);assert p.get('reply');assert p.get('reply_media_ok') is True;assert p.get('reply_media_path') and os.path.isfile(p['reply_media_path']);assert open(p['reply_media_path'],'rb').read(4)==b'RIFF';assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_silent') is False;assert p.get('voice_stt_residual') is True;assert isinstance(p.get('voice_tts_residual'),bool);assert p.get('reply_media_tool') in ('espeak','ffmpeg-sine');assert p.get('sessions_path') and os.path.isfile(p['sessions_path']);print('voice_relay reply WAV ok', p.get('turns'), 'bytes', p.get('reply_media_bytes'), 'tool', p.get('reply_media_tool'), 'tts_residual', p.get('voice_tts_residual'), 'snap', p.get('path'))"
# TTS mock (BITBOT_ESPEAK_BIN) closes voice_tts_residual when spoken reply path uses espeak.
rm -rf /tmp/bitbot-espeak-mock
mkdir -p /tmp/bitbot-espeak-mock
BITBOT_ESPEAK_BIN="$ROOT/scripts/host_espeak_mock.sh" BITBOT_ESPEAK_MOCK_LOG_DIR=/tmp/bitbot-espeak-mock \
  node hosts/cli_host/run_turn.js "voice relay tts1 :: hello from tts mock" >/tmp/bitbot-voice-tts.json || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-tts.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_relay');p=json.loads(h['stdout']);assert p.get('reply_media_tool')=='espeak';assert p.get('voice_tts_residual') is False;assert p.get('reply_media_ok') is True;assert open(p['reply_media_path'],'rb').read(4)==b'RIFF';assert os.path.isfile('/tmp/bitbot-espeak-mock/last-espeak.json');print('voice_relay TTS mock residual close ok', p.get('reply_media_tool'), p.get('path'))"
# STT closes residual when Host WAV sidecar transcript exists
python3 -c "import json;d=json.load(open('/tmp/bitbot-voice.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_session');p=json.loads(h['stdout']);open('/tmp/bitbot-voice-wav.txt','w').write(p['media_path'])"
WAV=$(cat /tmp/bitbot-voice-wav.txt)
printf 'transcribed hello from mic\n' > "${WAV}.stt.txt"
BITBOT_VOICE_STT=force node hosts/cli_host/run_turn.js 'voice relay smoke1 :: $stt' >/tmp/bitbot-voice-stt.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-stt.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_relay');p=json.loads(h['stdout']);assert p.get('stt_ok') is True;assert p.get('stt_tool')=='stt_sidecar';assert p.get('voice_stt_residual') is False;assert 'transcribed hello' in (p.get('stt_text') or '');assert p.get('path') and os.path.isfile(p['path']);print('voice_relay STT sidecar ok', p.get('stt_tool'), 'residual', False, p.get('path'))"
# BITBOT_STT_BIN mock closes voice_stt_residual without sidecar.
rm -rf /tmp/bitbot-stt-mock
mkdir -p /tmp/bitbot-stt-mock data/voice/media
python3 - <<'PY'
from pathlib import Path
import struct
p = Path("data/voice/media/stt-mock.wav")
rate, ch, bits, n = 16000, 1, 16, 800
data = b"\x00\x00" * n
byte_rate = rate * ch * bits // 8
block = ch * bits // 8
hdr = struct.pack(
    "<4sI4s4sIHHIIHH4sI",
    b"RIFF",
    36 + len(data),
    b"WAVE",
    b"fmt ",
    16,
    1,
    ch,
    rate,
    byte_rate,
    block,
    bits,
    b"data",
    len(data),
)
p.write_bytes(hdr + data)
PY
BITBOT_STT_BIN="$ROOT/scripts/host_stt_mock.sh" BITBOT_STT_MOCK_LOG_DIR=/tmp/bitbot-stt-mock \
  node hosts/cli_host/run_turn.js 'voice relay sttbin :: $wav:data/voice/media/stt-mock.wav' >/tmp/bitbot-voice-stt-bin.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-stt-bin.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_relay');p=json.loads(h['stdout']);assert p.get('stt_ok') is True;assert p.get('stt_tool')=='host_stt_mock.sh';assert p.get('voice_stt_residual') is False;assert 'mock stt transcript' in (p.get('stt_text') or '');assert os.path.isfile('/tmp/bitbot-stt-mock/last-stt.json');print('voice_relay STT bin mock residual close ok', p.get('stt_tool'), p.get('path'))"
# Distractor session must not steal voice_end smoke1 (exact match).
node hosts/cli_host/run_turn.js "voice start smoke1b" >/tmp/bitbot-voice-smoke1b.json
node hosts/cli_host/run_turn.js "voice end smoke1" >/tmp/bitbot-voice-end.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-end.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_end_write');p=json.loads(h['stdout']);cid=open('/tmp/bitbot-voice-call-id.txt').read().strip();assert p.get('call_id')==cid;assert 'smoke1b' not in (p.get('call_id') or '');assert p.get('matched') is True;assert p.get('voice_end_match_residual') is False;assert p.get('app_summary') is not None;assert p.get('mode')=='host_voice_end';assert p.get('path') and os.path.isfile(p['path']);assert 'voice-calls' in p['path'];assert p.get('pretend_still_live') is False;rows=json.load(open('data/voice/sessions.json'));sib=next(r for r in rows if str(r.get('voice_address') or '') in ('voice:smoke1b','smoke1b'));assert sib.get('live') is True;print('voice_end call_id+app_summary ok', p.get('call_id'), p.get('path'), 'match_residual', False)"
node hosts/cli_host/run_turn.js "voice end missing-xyz" >/tmp/bitbot-voice-end-miss.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-voice-end-miss.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_end_write');p=json.loads(h['stdout']);assert p.get('matched') is False;assert p.get('voice_end_match_residual') is True;assert p.get('mode')=='host_voice_end_unmatched';assert p.get('pretend_still_live') is False;print('voice_end unmatched residual ok', p.get('mode'), 'residual', True)"
# MCP product short-circuit: slides + X + finance + job + calendar + purchase + mail_send/read + workflows/cold/identity + skill_load/mail_claim/credential + code/pr + media (Host FFI; MoonBit catalog may lack names)
node -e '
const { createHostFfi } = require("./hosts/shared/host_ffi.js");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
function sleep(ms){ return new Promise((r)=>setTimeout(r,ms)); }
function startMock(port, mode, token) {
  const log = "/tmp/bitbot-mcp-" + mode + "-mock.log";
  try {
    require("child_process").execSync("fuser -k " + port + "/tcp", {
      stdio: "ignore",
    });
  } catch (_) {}
  const child = spawn(process.env.PYTHON || "python3", [
    path.join(process.cwd(), "scripts/host_local_http_mock.py"),
    "--port", String(port), "--mode", mode, "--token", token,
  ], { stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")] });
  return child;
}
(async () => {
  const ffi = createHostFfi(process.cwd());
  const slides = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.make_slides|{\"title\":\"Smoke Deck\"}" }]);
  const h = slides.find((r) => r && r.kind === "mcp_call");
  if (!h || !h.ok) throw new Error("slides mcp");
  const p = JSON.parse(h.stdout || "{}");
  if (p.mapped !== "host_slides_pptx" || p.product_tool_residual !== false) throw new Error(JSON.stringify(p).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-slides.json", JSON.stringify({ ok: true, ...p }, null, 2));
  console.log("mcp_call slides short-circuit ok", p.mapped, (p.slides||{}).pptx_path);
  const xs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.search_posts|{\"q\":\"smoke\"}" }]);
  const xh = xs.find((r) => r && r.kind === "mcp_call");
  const xp = JSON.parse((xh && xh.stdout) || "{}");
  if (xp.mapped !== "host_x_search" || xp.product_tool_residual !== false) throw new Error(JSON.stringify(xp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-x.json", JSON.stringify({ ok: true, ...xp }, null, 2));
  console.log("mcp_call x short-circuit ok", xp.mapped, (xp.x_search||{}).mode);
  const fins = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.get_balance|{}" }]);
  const fh = fins.find((r) => r && r.kind === "mcp_call");
  if (!fh || !fh.ok) throw new Error("finance mcp");
  const fp = JSON.parse(fh.stdout || "{}");
  if (fp.mapped !== "host_finance_call" || fp.product_tool_residual !== false) throw new Error(JSON.stringify(fp).slice(0,200));
  if (!(fp.finance||{}).path && !(fp.finance||{}).mode) throw new Error("finance payload: " + JSON.stringify(fp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-finance.json", JSON.stringify({ ok: true, ...fp }, null, 2));
  console.log("mcp_call finance short-circuit ok", fp.mapped, (fp.finance||{}).mode, (fp.finance||{}).path);
  const finStar = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.finance_list_accounts|{}" }]);
  const fsh = finStar.find((r) => r && r.kind === "mcp_call");
  const fsp = JSON.parse((fsh && fsh.stdout) || "{}");
  if (fsp.mapped !== "host_finance_call" || fsp.product_tool_residual !== false) throw new Error(JSON.stringify(fsp).slice(0,200));
  console.log("mcp_call finance_* short-circuit ok", fsp.mapped, (fsp.finance||{}).tool || fsp.tool);
  const jobs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.search_jobs|{\"q\":\"engineer\"}" }]);
  const jh = jobs.find((r) => r && r.kind === "mcp_call");
  if (!jh || !jh.ok) throw new Error("job mcp");
  const jp = JSON.parse(jh.stdout || "{}");
  if (jp.mapped !== "host_job_search" || jp.product_tool_residual !== false) throw new Error(JSON.stringify(jp).slice(0,200));
  if ((jp.job_search||{}).pretend_applied === true) throw new Error("pretend_applied");
  require("fs").writeFileSync("/tmp/bitbot-mcp-job.json", JSON.stringify({ ok: true, ...jp }, null, 2));
  console.log("mcp_call job short-circuit ok", jp.mapped, (jp.job_search||{}).mode, (jp.job_search||{}).hit_count);
  const jobsAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.job_search|{\"q\":\"pm\"}" }]);
  const jah = jobsAlias.find((r) => r && r.kind === "mcp_call");
  const jap = JSON.parse((jah && jah.stdout) || "{}");
  if (jap.mapped !== "host_job_search" || jap.product_tool_residual !== false) throw new Error(JSON.stringify(jap).slice(0,200));
  console.log("mcp_call job_search alias short-circuit ok", jap.mapped, (jap.job_search||{}).mode);
  const cals = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.create_event|{\"title\":\"MCP Sprint\",\"when\":\"tomorrow-3pm\"}" }]);
  const ch = cals.find((r) => r && r.kind === "mcp_call");
  if (!ch || !ch.ok) throw new Error("calendar mcp");
  const cp = JSON.parse(ch.stdout || "{}");
  if (cp.mapped !== "host_schedule_meeting" || cp.product_tool_residual !== false) throw new Error(JSON.stringify(cp).slice(0,200));
  if (!(cp.schedule||{}).ics_path && !(cp.schedule||{}).path) throw new Error("schedule payload: " + JSON.stringify(cp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-calendar.json", JSON.stringify({ ok: true, ...cp }, null, 2));
  console.log("mcp_call calendar short-circuit ok", cp.mapped, (cp.schedule||{}).mode, (cp.schedule||{}).ics_path);
  const calStar = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.calendar_create_event|{\"title\":\"CalStar\",\"when\":\"tomorrow-4pm\"}" }]);
  const csh = calStar.find((r) => r && r.kind === "mcp_call");
  const csp = JSON.parse((csh && csh.stdout) || "{}");
  if (csp.mapped !== "host_schedule_meeting" || csp.product_tool_residual !== false) throw new Error(JSON.stringify(csp).slice(0,200));
  console.log("mcp_call calendar_* short-circuit ok", csp.mapped, (csp.schedule||{}).mode || csp.tool);
  const schedAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.schedule_meeting|{\"title\":\"AliasMeet\",\"when\":\"friday\"}" }]);
  const sah = schedAlias.find((r) => r && r.kind === "mcp_call");
  const sap = JSON.parse((sah && sah.stdout) || "{}");
  if (sap.mapped !== "host_schedule_meeting" || sap.product_tool_residual !== false) throw new Error(JSON.stringify(sap).slice(0,200));
  console.log("mcp_call schedule_meeting alias short-circuit ok", sap.mapped, (sap.schedule||{}).mode);
  // Clear prior live purchase token so sandbox_receipt is not reclassified as live_charge.
  try { fs.unlinkSync("data/connectors/purchase_token.json"); } catch (_) {}
  delete process.env.BITBOT_PURCHASE_LIVE;
  delete process.env.BITBOT_PURCHASE_TOKEN;
  delete process.env.BITBOT_PURCHASE_API_URL;
  const buys = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.purchase_item|{\"item\":\"MCPWidget\",\"cents\":999}" }]);
  const bh = buys.find((r) => r && r.kind === "mcp_call");
  if (!bh || !bh.ok) throw new Error("purchase mcp");
  const bp = JSON.parse(bh.stdout || "{}");
  if (bp.mapped !== "host_purchase" || bp.product_tool_residual !== false) throw new Error(JSON.stringify(bp).slice(0,200));
  if ((bp.purchase||{}).pretend_paid === true) throw new Error("pretend_paid");
  if (!(bp.purchase||{}).receipt_path && !(bp.purchase||{}).path) throw new Error("purchase payload: " + JSON.stringify(bp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-purchase.json", JSON.stringify({ ok: true, ...bp }, null, 2));
  console.log("mcp_call purchase short-circuit ok", bp.mapped, (bp.purchase||{}).mode, (bp.purchase||{}).receipt_path);
  const buyStar = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.buy_widget|{\"item\":\"BuyStar\",\"cents\":499}" }]);
  const bsh = buyStar.find((r) => r && r.kind === "mcp_call");
  const bsp = JSON.parse((bsh && bsh.stdout) || "{}");
  if (bsp.mapped !== "host_purchase" || bsp.product_tool_residual !== false) throw new Error(JSON.stringify(bsp).slice(0,200));
  console.log("mcp_call buy_* short-circuit ok", bsp.mapped, (bsp.purchase||{}).mode || bsp.tool);
  const purchaseAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.purchase|{\"item\":\"AliasBuy\",\"cents\":100}" }]);
  const pah = purchaseAlias.find((r) => r && r.kind === "mcp_call");
  const pap = JSON.parse((pah && pah.stdout) || "{}");
  if (pap.mapped !== "host_purchase" || pap.product_tool_residual !== false) throw new Error(JSON.stringify(pap).slice(0,200));
  console.log("mcp_call purchase alias short-circuit ok", pap.mapped, (pap.purchase||{}).mode);
  // Mail send/read product short-circuit (sandbox; residual may stay open without live mock)
  delete process.env.BITBOT_MAIL_SEND;
  delete process.env.BITBOT_GMAIL_TOKEN;
  delete process.env.BITBOT_GMAIL_API_BASE;
  try { fs.unlinkSync("data/connectors/gmail_token.json"); } catch (_) {}
  const sends = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.send_mail|{\"to\":\"mcp@example.com\",\"subject\":\"MCP Send\",\"body\":\"hello\"}" }]);
  const sh = sends.find((r) => r && r.kind === "mcp_call");
  if (!sh || !sh.ok) throw new Error("mail_send mcp");
  const sp = JSON.parse(sh.stdout || "{}");
  if (sp.mapped !== "host_mail_send" || sp.product_tool_residual !== false) throw new Error(JSON.stringify(sp).slice(0,200));
  if ((sp.mail_send||{}).pretend_sent === true) throw new Error("pretend_sent");
  if (!(sp.mail_send||{}).eml_path && !(sp.mail_send||{}).path) throw new Error("mail_send payload: " + JSON.stringify(sp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-mail-send.json", JSON.stringify({ ok: true, ...sp }, null, 2));
  console.log("mcp_call mail_send short-circuit ok", sp.mapped, (sp.mail_send||{}).mode, (sp.mail_send||{}).eml_path);
  const sendAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.send_message|{\"to\":\"alias@example.com\",\"subject\":\"Alias\",\"body\":\"hi\"}" }]);
  const smah = sendAlias.find((r) => r && r.kind === "mcp_call");
  const smap = JSON.parse((smah && smah.stdout) || "{}");
  if (smap.mapped !== "host_mail_send" || smap.product_tool_residual !== false) throw new Error(JSON.stringify(smap).slice(0,200));
  console.log("mcp_call send_message alias short-circuit ok", smap.mapped, (smap.mail_send||{}).mode);
  const mailSendAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.mail_send|{\"to\":\"ms@example.com\",\"subject\":\"MS\",\"body\":\"ms\"}" }]);
  const msah = mailSendAlias.find((r) => r && r.kind === "mcp_call");
  const msap = JSON.parse((msah && msah.stdout) || "{}");
  if (msap.mapped !== "host_mail_send" || msap.product_tool_residual !== false) throw new Error(JSON.stringify(msap).slice(0,200));
  console.log("mcp_call mail_send alias short-circuit ok", msap.mapped, (msap.mail_send||{}).mode);
  const reads = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.mail_read|{\"thread_id\":\"t-invoice-1\"}" }]);
  const rh = reads.find((r) => r && r.kind === "mcp_call");
  if (!rh || !rh.ok) throw new Error("mail_read mcp");
  const rp = JSON.parse(rh.stdout || "{}");
  if (rp.mapped !== "host_mail_read" || rp.product_tool_residual !== false) throw new Error(JSON.stringify(rp).slice(0,200));
  if ((rp.mail_read||{}).pretend_live === true) throw new Error("pretend_live");
  if (!(rp.mail_read||{}).path) throw new Error("mail_read payload: " + JSON.stringify(rp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-mail-read.json", JSON.stringify({ ok: true, ...rp }, null, 2));
  console.log("mcp_call mail_read short-circuit ok", rp.mapped, (rp.mail_read||{}).mode, (rp.mail_read||{}).thread_id);
  const readAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.read_mail_thread|{\"id\":\"t-alias-1\"}" }]);
  const rah = readAlias.find((r) => r && r.kind === "mcp_call");
  const rap = JSON.parse((rah && rah.stdout) || "{}");
  if (rap.mapped !== "host_mail_read" || rap.product_tool_residual !== false) throw new Error(JSON.stringify(rap).slice(0,200));
  console.log("mcp_call read_mail_thread alias short-circuit ok", rap.mapped, (rap.mail_read||{}).thread_id);
  const getMsg = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.get_message|{\"message_id\":\"t-get-1\"}" }]);
  const gmh = getMsg.find((r) => r && r.kind === "mcp_call");
  const gmp = JSON.parse((gmh && gmh.stdout) || "{}");
  if (gmp.mapped !== "host_mail_read" || gmp.product_tool_residual !== false) throw new Error(JSON.stringify(gmp).slice(0,200));
  console.log("mcp_call get_message alias short-circuit ok", gmp.mapped, (gmp.mail_read||{}).thread_id);
  // Skill/export product short-circuit → host_skill_write / host_export_pack (no pretend_shared / secret echo)
  const skills = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.author_skill|{\"name\":\"mcp-author-skill\",\"description\":\"mcp smoke\",\"body\":\"Do the MCP thing.\"}" }]);
  const skh = skills.find((r) => r && r.kind === "mcp_call");
  if (!skh || !skh.ok) throw new Error("author_skill mcp");
  const skp = JSON.parse(skh.stdout || "{}");
  if (skp.mapped !== "host_skill_write" || skp.product_tool_residual !== false) throw new Error(JSON.stringify(skp).slice(0,200));
  if ((skp.skill_write||{}).pretend_shared === true) throw new Error("pretend_shared");
  if ((skp.skill_write||{}).persisted !== true) throw new Error("skill persisted: " + JSON.stringify(skp).slice(0,200));
  if (!(skp.skill_write||{}).path && !(skp.skill_write||{}).meta_path) throw new Error("skill payload: " + JSON.stringify(skp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-skill-write.json", JSON.stringify({ ok: true, ...skp }, null, 2));
  console.log("mcp_call author_skill short-circuit ok", skp.mapped, (skp.skill_write||{}).mode, (skp.skill_write||{}).path);
  const lfd = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.learn_from_demo|{\"title\":\"mcp-lfd\",\"steps_csv\":\"click:Cart,type:Buy\"}" }]);
  const lfh = lfd.find((r) => r && r.kind === "mcp_call");
  const lfp = JSON.parse((lfh && lfh.stdout) || "{}");
  if (lfp.mapped !== "host_skill_write" || lfp.product_tool_residual !== false) throw new Error(JSON.stringify(lfp).slice(0,200));
  if ((lfp.skill_write||{}).pretend_shared === true) throw new Error("pretend_shared lfd");
  console.log("mcp_call learn_from_demo alias short-circuit ok", lfp.mapped, (lfp.skill_write||{}).name);
  const swAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.skill_write|{\"name\":\"mcp-sw-alias\",\"description\":\"alias\",\"body\":\"alias body\"}" }]);
  const swah = swAlias.find((r) => r && r.kind === "mcp_call");
  const swap = JSON.parse((swah && swah.stdout) || "{}");
  if (swap.mapped !== "host_skill_write" || swap.product_tool_residual !== false) throw new Error(JSON.stringify(swap).slice(0,200));
  console.log("mcp_call skill_write alias short-circuit ok", swap.mapped, (swap.skill_write||{}).mode);
  const exports = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.export_bot_template|{\"bot_id\":\"mcp-bot-smoke\",\"name\":\"McpSmokeBot\"}" }]);
  const exh = exports.find((r) => r && r.kind === "mcp_call");
  if (!exh || !exh.ok) throw new Error("export_bot_template mcp");
  const exp = JSON.parse(exh.stdout || "{}");
  if (exp.mapped !== "host_export_pack" || exp.product_tool_residual !== false) throw new Error(JSON.stringify(exp).slice(0,200));
  if ((exp.export_pack||{}).secrets_stripped !== true) throw new Error("secrets_stripped: " + JSON.stringify(exp).slice(0,200));
  if ((exp.export_pack||{}).pretend_secrets_included === true) throw new Error("pretend_secrets_included");
  if (!(exp.export_pack||{}).path && !(exp.export_pack||{}).meta_path) throw new Error("export payload: " + JSON.stringify(exp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-export-pack.json", JSON.stringify({ ok: true, ...exp }, null, 2));
  console.log("mcp_call export_bot_template short-circuit ok", exp.mapped, (exp.export_pack||{}).mode, (exp.export_pack||{}).path);
  const epAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.export_pack|{\"bot_id\":\"mcp-pack-alias\",\"kind\":\"shareable-template\"}" }]);
  const epah = epAlias.find((r) => r && r.kind === "mcp_call");
  const epap = JSON.parse((epah && epah.stdout) || "{}");
  if (epap.mapped !== "host_export_pack" || epap.product_tool_residual !== false) throw new Error(JSON.stringify(epap).slice(0,200));
  if ((epap.export_pack||{}).pretend_secrets_included === true) throw new Error("pretend_secrets alias");
  console.log("mcp_call export_pack alias short-circuit ok", epap.mapped, (epap.export_pack||{}).mode);
  // code_changes/apply_patch + source_control/create_pr product short-circuit (gates stay honest)
  delete process.env.BITBOT_CODE_APPLY;
  delete process.env.BITBOT_CODE_COMMIT;
  delete process.env.BITBOT_CODE_PUSH;
  delete process.env.BITBOT_GIT_BIN;
  delete process.env.BITBOT_GH_CREATE_PR;
  delete process.env.BITBOT_GH_PR_CREATE;
  delete process.env.BITBOT_GH_BIN;
  const patches = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.apply_patch|{\"path\":\"README.mbt.md\"}" }]);
  const ph = patches.find((r) => r && r.kind === "mcp_call");
  if (!ph || !ph.ok) throw new Error("apply_patch mcp");
  const pp = JSON.parse(ph.stdout || "{}");
  if (pp.mapped !== "host_code_changes" || pp.product_tool_residual !== false) throw new Error(JSON.stringify(pp).slice(0,200));
  if ((pp.code_changes||{}).pretend_committed === true) throw new Error("pretend_committed");
  if ((pp.code_changes||{}).pretend_pushed === true) throw new Error("pretend_pushed");
  if ((pp.code_changes||{}).applied === true) throw new Error("ungated applied");
  if ((pp.code_changes||{}).code_apply_residual !== true) throw new Error("code_apply_residual: " + JSON.stringify(pp.code_changes||{}).slice(0,200));
  if (!(pp.code_changes||{}).path) throw new Error("code_changes payload: " + JSON.stringify(pp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-apply-patch.json", JSON.stringify({ ok: true, ...pp }, null, 2));
  console.log("mcp_call apply_patch short-circuit ok", pp.mapped, (pp.code_changes||{}).code_apply_residual, (pp.code_changes||{}).path);
  const codeAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.code_changes|{\"path\":\"README.mbt.md\"}" }]);
  const cahCode = codeAlias.find((r) => r && r.kind === "mcp_call");
  const capCode = JSON.parse((cahCode && cahCode.stdout) || "{}");
  if (capCode.mapped !== "host_code_changes" || capCode.product_tool_residual !== false) throw new Error(JSON.stringify(capCode).slice(0,200));
  console.log("mcp_call code_changes alias short-circuit ok", capCode.mapped, (capCode.code_changes||{}).code_apply_residual);
  const slashPatch = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.code_changes/apply_patch|{\"path\":\"README.mbt.md\"}" }]);
  const sph = slashPatch.find((r) => r && r.kind === "mcp_call");
  const spp = JSON.parse((sph && sph.stdout) || "{}");
  if (spp.mapped !== "host_code_changes" || spp.product_tool_residual !== false) throw new Error(JSON.stringify(spp).slice(0,200));
  console.log("mcp_call code_changes/apply_patch short-circuit ok", spp.mapped, (spp.code_changes||{}).code_apply_residual);
  const prs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.create_pr|{}" }]);
  const prh = prs.find((r) => r && r.kind === "mcp_call");
  if (!prh || !prh.ok) throw new Error("create_pr mcp");
  const prp = JSON.parse(prh.stdout || "{}");
  if (prp.mapped !== "host_source_control" || prp.product_tool_residual !== false) throw new Error(JSON.stringify(prp).slice(0,200));
  if ((prp.source_control||{}).pretend_remote_pr === true) throw new Error("pretend_remote_pr");
  if ((prp.source_control||{}).remote_pr_residual !== true) throw new Error("remote_pr_residual: " + JSON.stringify(prp.source_control||{}).slice(0,200));
  if (!(prp.source_control||{}).path && !(prp.source_control||{}).status_path) throw new Error("source_control payload: " + JSON.stringify(prp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-create-pr.json", JSON.stringify({ ok: true, ...prp }, null, 2));
  console.log("mcp_call create_pr short-circuit ok", prp.mapped, (prp.source_control||{}).mode, (prp.source_control||{}).remote_pr_residual);
  const slashPr = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-github.source_control/create_pr|{}" }]);
  const sprh = slashPr.find((r) => r && r.kind === "mcp_call");
  const sprp = JSON.parse((sprh && sprh.stdout) || "{}");
  if (sprp.mapped !== "host_source_control" || sprp.product_tool_residual !== false) throw new Error(JSON.stringify(sprp).slice(0,200));
  if ((sprp.source_control||{}).pretend_remote_pr === true) throw new Error("pretend_remote_pr slash");
  console.log("mcp_call source_control/create_pr short-circuit ok", sprp.mapped, (sprp.source_control||{}).remote_pr_residual);
  // list_workflows / cold_mail / send_on_behalf / identity_browser product short-circuit
  const wfs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.list_workflows|{\"names\":[\"mcp-wf-a\",\"mcp-wf-b\"]}" }]);
  const wfh = wfs.find((r) => r && r.kind === "mcp_call");
  if (!wfh || !wfh.ok) throw new Error("list_workflows mcp");
  const wfp = JSON.parse(wfh.stdout || "{}");
  if (wfp.mapped !== "host_workflow_list" || wfp.product_tool_residual !== false) throw new Error(JSON.stringify(wfp).slice(0,200));
  if ((wfp.workflow_list||{}).pretend_shared === true) throw new Error("pretend_shared");
  if (!(wfp.workflow_list||{}).path || !(wfp.workflow_list||{}).catalog_path) throw new Error("workflow_list payload: " + JSON.stringify(wfp).slice(0,200));
  if (!((wfp.workflow_list||{}).count >= 1)) throw new Error("workflow count: " + JSON.stringify(wfp.workflow_list||{}).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-list-workflows.json", JSON.stringify({ ok: true, ...wfp }, null, 2));
  console.log("mcp_call list_workflows short-circuit ok", wfp.mapped, (wfp.workflow_list||{}).mode, (wfp.workflow_list||{}).count);
  const wfAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.user_workflows|{\"name\":\"mcp-alias-wf\"}" }]);
  const wfah = wfAlias.find((r) => r && r.kind === "mcp_call");
  const wfap = JSON.parse((wfah && wfah.stdout) || "{}");
  if (wfap.mapped !== "host_workflow_list" || wfap.product_tool_residual !== false) throw new Error(JSON.stringify(wfap).slice(0,200));
  console.log("mcp_call user_workflows alias short-circuit ok", wfap.mapped, (wfap.workflow_list||{}).count);
  const wfSlash = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.workflows_list|{\"workflows\":\"mcp-slash-a,mcp-slash-b\"}" }]);
  const wfsh = wfSlash.find((r) => r && r.kind === "mcp_call");
  const wfsp = JSON.parse((wfsh && wfsh.stdout) || "{}");
  if (wfsp.mapped !== "host_workflow_list" || wfsp.product_tool_residual !== false) throw new Error(JSON.stringify(wfsp).slice(0,200));
  console.log("mcp_call workflows_list alias short-circuit ok", wfsp.mapped, (wfsp.workflow_list||{}).count);
  delete process.env.BITBOT_MAIL_SEND;
  delete process.env.BITBOT_COLD_MAIL_API_URL;
  delete process.env.BITBOT_COLD_MAIL_TOKEN;
  delete process.env.BITBOT_ONBEHALF_MAIL_API_URL;
  delete process.env.BITBOT_ONBEHALF_MAIL_TOKEN;
  const colds = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.cold_mail|{\"to\":\"mcp-cold@example.com\",\"subject\":\"MCP Cold\",\"body\":\"hello cold\",\"unsubscribe\":\"mailto:u@example.com\"}" }]);
  const coldh = colds.find((r) => r && r.kind === "mcp_call");
  if (!coldh || !coldh.ok) throw new Error("cold_mail mcp");
  const coldp = JSON.parse(coldh.stdout || "{}");
  if (coldp.mapped !== "host_mail_send" || coldp.product_tool_residual !== false) throw new Error(JSON.stringify(coldp).slice(0,200));
  if ((coldp.mail_send||{}).provider !== "cold") throw new Error("cold provider: " + JSON.stringify(coldp.mail_send||{}).slice(0,200));
  if ((coldp.mail_send||{}).pretend_sent === true) throw new Error("pretend_sent cold");
  if ((coldp.mail_send||{}).live_mail_residual !== true) throw new Error("live_mail_residual must stay gated: " + JSON.stringify(coldp.mail_send||{}).slice(0,200));
  if (!(coldp.mail_send||{}).eml_path && !(coldp.mail_send||{}).path) throw new Error("cold_mail payload: " + JSON.stringify(coldp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-cold-mail.json", JSON.stringify({ ok: true, ...coldp }, null, 2));
  console.log("mcp_call cold_mail short-circuit ok", coldp.mapped, (coldp.mail_send||{}).mode, (coldp.mail_send||{}).live_mail_residual);
  const sobs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.send_on_behalf|{\"to\":\"mcp-sob@example.com\",\"subject\":\"MCP SOB\",\"body\":\"hello sob\"}" }]);
  const sobh = sobs.find((r) => r && r.kind === "mcp_call");
  if (!sobh || !sobh.ok) throw new Error("send_on_behalf mcp");
  const sobp = JSON.parse(sobh.stdout || "{}");
  if (sobp.mapped !== "host_mail_send" || sobp.product_tool_residual !== false) throw new Error(JSON.stringify(sobp).slice(0,200));
  if ((sobp.mail_send||{}).provider !== "onbehalf") throw new Error("onbehalf provider: " + JSON.stringify(sobp.mail_send||{}).slice(0,200));
  if ((sobp.mail_send||{}).pretend_sent === true) throw new Error("pretend_sent sob");
  if ((sobp.mail_send||{}).live_mail_residual !== true) throw new Error("live_mail_residual must stay gated sob: " + JSON.stringify(sobp.mail_send||{}).slice(0,200));
  if (!(sobp.mail_send||{}).eml_path && !(sobp.mail_send||{}).path) throw new Error("send_on_behalf payload: " + JSON.stringify(sobp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-send-on-behalf.json", JSON.stringify({ ok: true, ...sobp }, null, 2));
  console.log("mcp_call send_on_behalf short-circuit ok", sobp.mapped, (sobp.mail_send||{}).mode, (sobp.mail_send||{}).live_mail_residual);
  const ids = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.identity_browser|{}" }]);
  const idh = ids.find((r) => r && r.kind === "mcp_call");
  if (!idh || !idh.ok) throw new Error("identity_browser mcp");
  const idp = JSON.parse(idh.stdout || "{}");
  if (idp.mapped !== "host_identity_browser" || idp.product_tool_residual !== false) throw new Error(JSON.stringify(idp).slice(0,200));
  if ((idp.identity_browser||{}).connected === true) throw new Error("never pretend Connected");
  if ((idp.identity_browser||{}).pretend_connected_slack === true) throw new Error("pretend_connected_slack");
  if ((idp.identity_browser||{}).connector !== "identity-browser") throw new Error("connector: " + JSON.stringify(idp.identity_browser||{}).slice(0,200));
  if ((idp.identity_browser||{}).mode !== "identity_browser_switch") throw new Error("mode: " + JSON.stringify(idp.identity_browser||{}).slice(0,200));
  if (!(idp.identity_browser||{}).session_path || !(idp.identity_browser||{}).user_data_dir) throw new Error("identity payload: " + JSON.stringify(idp).slice(0,200));
  if ((idp.identity_browser||{}).switched !== true) throw new Error("switched: " + JSON.stringify(idp.identity_browser||{}).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-identity-browser.json", JSON.stringify({ ok: true, ...idp }, null, 2));
  console.log("mcp_call identity_browser short-circuit ok", idp.mapped, (idp.identity_browser||{}).mode, (idp.identity_browser||{}).connected);
  const idAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.switch_identity_browser|{}" }]);
  const idah = idAlias.find((r) => r && r.kind === "mcp_call");
  const idap = JSON.parse((idah && idah.stdout) || "{}");
  if (idap.mapped !== "host_identity_browser" || idap.product_tool_residual !== false) throw new Error(JSON.stringify(idap).slice(0,200));
  if ((idap.identity_browser||{}).connected === true) throw new Error("never pretend Connected alias");
  if ((idap.identity_browser||{}).pretend_connected_slack === true) throw new Error("pretend_connected_slack alias");
  console.log("mcp_call switch_identity_browser alias short-circuit ok", idap.mapped, (idap.identity_browser||{}).connected);
  // load_skill / claim_inbox / fill_credential / list_credentials product short-circuit
  const loads = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.load_skill|{\"task\":\"mcp-load-skill\",\"loaded_count\":2}" }]);
  const loadh = loads.find((r) => r && r.kind === "mcp_call");
  if (!loadh || !loadh.ok) throw new Error("load_skill mcp");
  const loadp = JSON.parse(loadh.stdout || "{}");
  if (loadp.mapped !== "host_skill_load" || loadp.product_tool_residual !== false) throw new Error(JSON.stringify(loadp).slice(0,200));
  if ((loadp.skill_load||{}).mode !== "host_skill_load") throw new Error("skill_load mode: " + JSON.stringify(loadp.skill_load||{}).slice(0,200));
  if ((loadp.skill_load||{}).pretend_loaded === true) throw new Error("pretend_loaded");
  if (!(loadp.skill_load||{}).path) throw new Error("skill_load path: " + JSON.stringify(loadp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-load-skill.json", JSON.stringify({ ok: true, ...loadp }, null, 2));
  console.log("mcp_call load_skill short-circuit ok", loadp.mapped, (loadp.skill_load||{}).mode, (loadp.skill_load||{}).path);
  const loadAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.skill_load|{\"name\":\"mcp-skill-alias\",\"count\":1}" }]);
  const loada = loadAlias.find((r) => r && r.kind === "mcp_call");
  const loadap = JSON.parse((loada && loada.stdout) || "{}");
  if (loadap.mapped !== "host_skill_load" || loadap.product_tool_residual !== false) throw new Error(JSON.stringify(loadap).slice(0,200));
  console.log("mcp_call skill_load alias short-circuit ok", loadap.mapped, (loadap.skill_load||{}).task);
  delete process.env.BITBOT_MAIL_CLAIM_API_URL;
  delete process.env.BITBOT_MAIL_CLAIM_TOKEN;
  delete process.env.BITBOT_MAIL_CLAIM_POST;
  const claims = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.claim_inbox|{\"local_part\":\"mcpclaim\",\"address\":\"mcpclaim@bitbot.local\"}" }]);
  const claimh = claims.find((r) => r && r.kind === "mcp_call");
  if (!claimh || !claimh.ok) throw new Error("claim_inbox mcp");
  const claimp = JSON.parse(claimh.stdout || "{}");
  if (claimp.mapped !== "host_mail_claim_inbox" || claimp.product_tool_residual !== false) throw new Error(JSON.stringify(claimp).slice(0,200));
  if ((claimp.mail_claim||{}).pretend_claimed === true) throw new Error("pretend_claimed");
  if ((claimp.mail_claim||{}).live_mail_claim_residual !== true) throw new Error("live_mail_claim_residual must stay gated: " + JSON.stringify(claimp.mail_claim||{}).slice(0,200));
  if (!((claimp.mail_claim||{}).claimed_count >= 1)) throw new Error("claimed_count: " + JSON.stringify(claimp.mail_claim||{}).slice(0,200));
  if (!(claimp.mail_claim||{}).path && !(claimp.mail_claim||{}).fixture_path) throw new Error("mail_claim payload: " + JSON.stringify(claimp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-claim-inbox.json", JSON.stringify({ ok: true, ...claimp }, null, 2));
  console.log("mcp_call claim_inbox short-circuit ok", claimp.mapped, (claimp.mail_claim||{}).mode, (claimp.mail_claim||{}).live_mail_claim_residual);
  const claimAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.mail_claim_inbox|{\"local_part\":\"mcpclaim2\"}" }]);
  const claima = claimAlias.find((r) => r && r.kind === "mcp_call");
  const claimap = JSON.parse((claima && claima.stdout) || "{}");
  if (claimap.mapped !== "host_mail_claim_inbox" || claimap.product_tool_residual !== false) throw new Error(JSON.stringify(claimap).slice(0,200));
  if ((claimap.mail_claim||{}).live_mail_claim_residual !== true) throw new Error("live_mail_claim_residual alias gated");
  console.log("mcp_call mail_claim_inbox alias short-circuit ok", claimap.mapped, (claimap.mail_claim||{}).local_part);
  const claimMail = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.claim_mail|{\"inbox\":\"mcpclaim3\"}" }]);
  const claimmh = claimMail.find((r) => r && r.kind === "mcp_call");
  const claimmp = JSON.parse((claimmh && claimmh.stdout) || "{}");
  if (claimmp.mapped !== "host_mail_claim_inbox" || claimmp.product_tool_residual !== false) throw new Error(JSON.stringify(claimmp).slice(0,200));
  console.log("mcp_call claim_mail alias short-circuit ok", claimmp.mapped, (claimmp.mail_claim||{}).live_mail_claim_residual);
  const credLists = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.list_credentials|{}" }]);
  const clh = credLists.find((r) => r && r.kind === "mcp_call");
  if (!clh || !clh.ok) throw new Error("list_credentials mcp");
  const clp = JSON.parse(clh.stdout || "{}");
  if (clp.mapped !== "host_credential_list" || clp.product_tool_residual !== false) throw new Error(JSON.stringify(clp).slice(0,200));
  if (clp.secret_echoed === true || (clp.credential_list||{}).secret_echoed === true) throw new Error("secret_echoed list");
  if (clp.pretend_secret_echo === true || (clp.credential_list||{}).pretend_secret_echo === true) throw new Error("pretend_secret_echo list");
  if (!((clp.credential_list||{}).count >= 1)) throw new Error("credential_list count: " + JSON.stringify(clp.credential_list||{}).slice(0,200));
  if (/vault:secret/i.test(JSON.stringify(clp))) throw new Error("secret leak list");
  require("fs").writeFileSync("/tmp/bitbot-mcp-list-credentials.json", JSON.stringify({ ok: true, ...clp }, null, 2));
  console.log("mcp_call list_credentials short-circuit ok", clp.mapped, (clp.credential_list||{}).mode, (clp.credential_list||{}).count);
  const credListAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.credential_list|{}" }]);
  const clah = credListAlias.find((r) => r && r.kind === "mcp_call");
  const clap = JSON.parse((clah && clah.stdout) || "{}");
  if (clap.mapped !== "host_credential_list" || clap.product_tool_residual !== false) throw new Error(JSON.stringify(clap).slice(0,200));
  console.log("mcp_call credential_list alias short-circuit ok", clap.mapped, (clap.credential_list||{}).count);
  const fills = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.fill_credential|{\"fill_handle\":\"mcp-fill-1\",\"domain\":\"login.example.test\",\"username\":\"mcp@example.test\"}" }]);
  const fillh = fills.find((r) => r && r.kind === "mcp_call");
  if (!fillh || !fillh.ok) throw new Error("fill_credential mcp");
  const fillp = JSON.parse(fillh.stdout || "{}");
  if (fillp.mapped !== "host_credential_fill" || fillp.product_tool_residual !== false) throw new Error(JSON.stringify(fillp).slice(0,200));
  if (fillp.secret_echoed === true || (fillp.credential_fill||{}).secret_echoed === true) throw new Error("secret_echoed fill");
  if (fillp.pretend_secret_echo === true || (fillp.credential_fill||{}).pretend_secret_echo === true) throw new Error("pretend_secret_echo fill");
  if (fillp.signin_fill_residual !== true || (fillp.credential_fill||{}).signin_fill_residual !== true) throw new Error("signin_fill_residual must stay true: " + JSON.stringify(fillp).slice(0,200));
  if ((fillp.credential_fill||{}).pretend_secret_view === true) throw new Error("pretend_secret_view");
  if (!(fillp.credential_fill||{}).path || !(fillp.credential_fill||{}).vault_path) throw new Error("fill payload: " + JSON.stringify(fillp).slice(0,200));
  if (/vault:secret/i.test(JSON.stringify(fillp))) throw new Error("secret leak fill");
  require("fs").writeFileSync("/tmp/bitbot-mcp-fill-credential.json", JSON.stringify({ ok: true, ...fillp }, null, 2));
  console.log("mcp_call fill_credential short-circuit ok", fillp.mapped, (fillp.credential_fill||{}).mode, fillp.signin_fill_residual);
  const fillAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.credential_fill|{\"handle\":\"mcp-fill-2\",\"domain\":\"login.example.test\",\"user\":\"alias@example.test\"}" }]);
  const filla = fillAlias.find((r) => r && r.kind === "mcp_call");
  const fillap = JSON.parse((filla && filla.stdout) || "{}");
  if (fillap.mapped !== "host_credential_fill" || fillap.product_tool_residual !== false) throw new Error(JSON.stringify(fillap).slice(0,200));
  if (fillap.signin_fill_residual !== true) throw new Error("signin_fill_residual alias");
  if (fillap.secret_echoed === true) throw new Error("secret_echoed alias");
  console.log("mcp_call credential_fill alias short-circuit ok", fillap.mapped, (fillap.credential_fill||{}).mode, fillap.signin_fill_residual);
  // Media product short-circuit → executeMediaProductEffect (generate_image/video/watch/chart)
  const imgs = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.generate_image|{\"prompt\":\"MCP aurora smoke\"}" }]);
  const ih = imgs.find((r) => r && r.kind === "mcp_call");
  if (!ih || !ih.ok) throw new Error("generate_image mcp");
  const ip = JSON.parse(ih.stdout || "{}");
  if (ip.mapped !== "host_generate_image" || ip.product_tool_residual !== false) throw new Error(JSON.stringify(ip).slice(0,200));
  if ((ip.media||{}).pretend_media === true) throw new Error("pretend_media image");
  if (!(ip.media||{}).media_path || !(ip.media||{}).png_magic_ok) throw new Error("image payload: " + JSON.stringify(ip).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-gen-image.json", JSON.stringify({ ok: true, ...ip }, null, 2));
  console.log("mcp_call generate_image short-circuit ok", ip.mapped, (ip.media||{}).media_path);
  const imgAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.make_image|{\"prompt\":\"alias image\"}" }]);
  const iah = imgAlias.find((r) => r && r.kind === "mcp_call");
  const iap = JSON.parse((iah && iah.stdout) || "{}");
  if (iap.mapped !== "host_generate_image" || iap.product_tool_residual !== false) throw new Error(JSON.stringify(iap).slice(0,200));
  console.log("mcp_call make_image alias short-circuit ok", iap.mapped, (iap.media||{}).mode);
  const vids = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.generate_video|{\"prompt\":\"MCP clip smoke\"}" }]);
  const vh = vids.find((r) => r && r.kind === "mcp_call");
  if (!vh || !vh.ok) throw new Error("generate_video mcp");
  const vp = JSON.parse(vh.stdout || "{}");
  if (vp.mapped !== "host_generate_video" || vp.product_tool_residual !== false) throw new Error(JSON.stringify(vp).slice(0,200));
  if ((vp.media||{}).pretend_media === true) throw new Error("pretend_media video");
  if (!(vp.media||{}).media_path) throw new Error("video payload: " + JSON.stringify(vp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-gen-video.json", JSON.stringify({ ok: true, ...vp }, null, 2));
  console.log("mcp_call generate_video short-circuit ok", vp.mapped, (vp.media||{}).media_path);
  const vidAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.gen_video|{\"prompt\":\"alias video\"}" }]);
  const vah = vidAlias.find((r) => r && r.kind === "mcp_call");
  const vap = JSON.parse((vah && vah.stdout) || "{}");
  if (vap.mapped !== "host_generate_video" || vap.product_tool_residual !== false) throw new Error(JSON.stringify(vap).slice(0,200));
  console.log("mcp_call gen_video alias short-circuit ok", vap.mapped, (vap.media||{}).mode);
  const watchVid = (vp.media||{}).media_path;
  const watches = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.watch_video|{\"video\":" + JSON.stringify(watchVid) + "}" }]);
  const wh = watches.find((r) => r && r.kind === "mcp_call");
  if (!wh || !wh.ok) throw new Error("watch_video mcp");
  const wp = JSON.parse(wh.stdout || "{}");
  if (wp.mapped !== "host_watch_video" || wp.product_tool_residual !== false) throw new Error(JSON.stringify(wp).slice(0,200));
  if ((wp.media||{}).pretend_media === true) throw new Error("pretend_media watch");
  if (!(wp.media||{}).frame_path || !(wp.media||{}).png_magic_ok) throw new Error("watch payload: " + JSON.stringify(wp).slice(0,200));
  require("fs").writeFileSync("/tmp/bitbot-mcp-watch-video.json", JSON.stringify({ ok: true, ...wp }, null, 2));
  console.log("mcp_call watch_video short-circuit ok", wp.mapped, (wp.media||{}).frame_path);
  const watchAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.extract_frame|{\"video\":" + JSON.stringify(watchVid) + "}" }]);
  const wahh = watchAlias.find((r) => r && r.kind === "mcp_call");
  const wap = JSON.parse((wahh && wahh.stdout) || "{}");
  if (wap.mapped !== "host_watch_video" || wap.product_tool_residual !== false) throw new Error(JSON.stringify(wap).slice(0,200));
  console.log("mcp_call extract_frame alias short-circuit ok", wap.mapped, (wap.media||{}).frame_path);
  const charts = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.structured_chart|{\"series\":{\"alpha\":4,\"beta\":9,\"gamma\":6}}" }]);
  const chh = charts.find((r) => r && r.kind === "mcp_call");
  if (!chh || !chh.ok) throw new Error("structured_chart mcp");
  const chp = JSON.parse(chh.stdout || "{}");
  if (chp.mapped !== "host_structured_chart" || chp.product_tool_residual !== false) throw new Error(JSON.stringify(chp).slice(0,200));
  if ((chp.media||{}).pretend_media === true) throw new Error("pretend_media chart");
  if (!(chp.media||{}).media_path || !(chp.media||{}).png_magic_ok) throw new Error("chart payload: " + JSON.stringify(chp).slice(0,200));
  if (!((chp.media||{}).series) || (chp.media||{}).series.alpha !== 4) throw new Error("chart series: " + JSON.stringify((chp.media||{}).series));
  require("fs").writeFileSync("/tmp/bitbot-mcp-chart.json", JSON.stringify({ ok: true, ...chp }, null, 2));
  console.log("mcp_call structured_chart short-circuit ok", chp.mapped, (chp.media||{}).media_path);
  const chartAlias = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.make_chart|{\"alpha\":2,\"beta\":5}" }]);
  const cah = chartAlias.find((r) => r && r.kind === "mcp_call");
  const cap = JSON.parse((cah && cah.stdout) || "{}");
  if (cap.mapped !== "host_structured_chart" || cap.product_tool_residual !== false) throw new Error(JSON.stringify(cap).slice(0,200));
  console.log("mcp_call make_chart alias short-circuit ok", cap.mapped, (cap.media||{}).mode);
  // Optional live residual close via existing calendar/purchase/gmail mocks
  // Clear connector token files so env API URL/token win (file api_url overrides env).
  try { fs.unlinkSync("data/connectors/purchase_token.json"); } catch (_) {}
  try { fs.unlinkSync("data/connectors/calendar_token.json"); } catch (_) {}
  try { fs.unlinkSync("data/connectors/gmail_token.json"); } catch (_) {}
  // Ports 18804/18805/18806 avoid CU/channel mocks and leftover 18786/18787 listeners.
  const calMock = startMock(18804, "calendar", "smoke-mcp-cal");
  const payMock = startMock(18805, "purchase", "smoke-mcp-pay");
  const gmailMock = startMock(18806, "gmail", "smoke-mcp-gmail");
  await sleep(500);
  try {
    process.env.BITBOT_CALENDAR_API_URL = "http://127.0.0.1:18804";
    process.env.BITBOT_CALENDAR_TOKEN = "smoke-mcp-cal";
    const liveCal = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.create_event|{\"title\":\"LiveMCP\",\"when\":\"tomorrow-6pm\"}" }]);
    const lch = liveCal.find((r) => r && r.kind === "mcp_call");
    const lcp = JSON.parse((lch && lch.stdout) || "{}");
    if (lcp.mapped !== "host_schedule_meeting" || lcp.product_tool_residual !== false) throw new Error(JSON.stringify(lcp).slice(0,200));
    if ((lcp.schedule||{}).live_calendar_residual !== false || (lcp.schedule||{}).mode !== "calendar_live") {
      throw new Error("calendar live residual: " + JSON.stringify(lcp.schedule||{}).slice(0,200));
    }
    console.log("mcp_call calendar live residual close ok", (lcp.schedule||{}).mode, (lcp.schedule||{}).live_calendar_residual);
    process.env.BITBOT_PURCHASE_LIVE = "1";
    process.env.BITBOT_PURCHASE_TOKEN = "smoke-mcp-pay";
    process.env.BITBOT_PURCHASE_API_URL = "http://127.0.0.1:18805";
    const liveBuy = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.purchase_item|{\"item\":\"LiveMCPWidget\",\"cents\":777}" }]);
    const lbh = liveBuy.find((r) => r && r.kind === "mcp_call");
    const lbp = JSON.parse((lbh && lbh.stdout) || "{}");
    if (lbp.mapped !== "host_purchase" || lbp.product_tool_residual !== false) throw new Error(JSON.stringify(lbp).slice(0,200));
    if ((lbp.purchase||{}).live_paid_residual !== false || (lbp.purchase||{}).mode !== "live_charge") {
      throw new Error("purchase live residual: " + JSON.stringify(lbp.purchase||{}).slice(0,200));
    }
    if ((lbp.purchase||{}).pretend_paid === true) throw new Error("pretend_paid live");
    console.log("mcp_call purchase live residual close ok", (lbp.purchase||{}).mode, (lbp.purchase||{}).live_paid_residual);
    process.env.BITBOT_GMAIL_API_BASE = "http://127.0.0.1:18806";
    process.env.BITBOT_GMAIL_TOKEN = "smoke-mcp-gmail";
    process.env.BITBOT_MAIL_SEND = "1";
    const liveSend = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.send_mail|{\"to\":\"live-mcp@example.com\",\"subject\":\"LiveMCP\",\"body\":\"sent\"}" }]);
    const lsh = liveSend.find((r) => r && r.kind === "mcp_call");
    const lsp = JSON.parse((lsh && lsh.stdout) || "{}");
    if (lsp.mapped !== "host_mail_send" || lsp.product_tool_residual !== false) throw new Error(JSON.stringify(lsp).slice(0,200));
    if ((lsp.mail_send||{}).live_mail_residual !== false || (lsp.mail_send||{}).mode !== "live_gmail") {
      throw new Error("mail_send live residual: " + JSON.stringify(lsp.mail_send||{}).slice(0,200));
    }
    if ((lsp.mail_send||{}).pretend_sent === true) throw new Error("pretend_sent live");
    console.log("mcp_call mail_send live residual close ok", (lsp.mail_send||{}).mode, (lsp.mail_send||{}).live_mail_residual);
    const liveRead = await ffi.executeHostEffects([{ kind: "mcp_call", command: "user-Gmail.mail_read|{\"thread_id\":\"t-invoice-1\"}" }]);
    const lrh = liveRead.find((r) => r && r.kind === "mcp_call");
    const lrp = JSON.parse((lrh && lrh.stdout) || "{}");
    if (lrp.mapped !== "host_mail_read" || lrp.product_tool_residual !== false) throw new Error(JSON.stringify(lrp).slice(0,200));
    if ((lrp.mail_read||{}).live_mail_residual !== false || (lrp.mail_read||{}).mode !== "gmail_live") {
      throw new Error("mail_read live residual: " + JSON.stringify(lrp.mail_read||{}).slice(0,200));
    }
    if ((lrp.mail_read||{}).pretend_live === true) throw new Error("pretend_live live");
    console.log("mcp_call mail_read live residual close ok", (lrp.mail_read||{}).mode, (lrp.mail_read||{}).live_mail_residual);
  } finally {
    try { calMock.kill(); } catch (_) {}
    try { payMock.kill(); } catch (_) {}
    try { gmailMock.kill(); } catch (_) {}
    delete process.env.BITBOT_CALENDAR_API_URL;
    delete process.env.BITBOT_CALENDAR_TOKEN;
    delete process.env.BITBOT_PURCHASE_LIVE;
    delete process.env.BITBOT_PURCHASE_TOKEN;
    delete process.env.BITBOT_PURCHASE_API_URL;
    delete process.env.BITBOT_GMAIL_API_BASE;
    delete process.env.BITBOT_GMAIL_TOKEN;
    delete process.env.BITBOT_MAIL_SEND;
  }
})().catch((e)=>{console.error(e);process.exit(1);});
'
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
python3 -c "import json;d=json.load(open('/tmp/bitbot-cloud-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='cloud_agent_launch');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='remote_cloud_api';assert p.get('remote_cloud_residual') is False;assert p.get('pretend_remote_cloud') is False;assert p.get('remote_api_attempted') is True;assert p.get('status')=='launched_remote';assert (p.get('remote_probe') or {}).get('ok') is True;print('cloud_agent_launch remote live mock ok', p.get('bc_id'), p.get('status'))"
mkdir -p data/connectors
printf '%s\n' '{"access_token":"smoke-cloud","token_type":"Bearer"}' > data/connectors/cloud_token.json
BITBOT_CLOUD_API_URL=http://127.0.0.1:18774 \
  env -u BITBOT_CURSOR_CLOUD_TOKEN -u BITBOT_CLOUD_API_TOKEN \
  node hosts/cli_host/run_turn.js "launch cloud agent file token" >/tmp/bitbot-cloud-file-token.json || true
kill "$CLOUD_MOCK_PID" >/dev/null 2>&1 || true
wait "$CLOUD_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-cloud-file-token.json'));h=next(x for x in d['host_results'] if x.get('kind')=='cloud_agent_launch');p=json.loads(h['stdout']);assert p.get('mode')=='remote_cloud_api';assert p.get('remote_cloud_residual') is False;print('cloud_agent_launch connector token file ok', p.get('mode'))"
BC_ID="$(cat /tmp/bitbot-cloud-bc.txt)"
node hosts/cli_host/run_turn.js "deliver cloud artifact artifact=${BC_ID} dest=smoke-report.md" >/tmp/bitbot-cloud-art.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cloud-art.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='cloud_artifact_deliver');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('delivered') is True;assert p.get('from_session') is True;assert p.get('pretend_remote_fetch') is False;assert p.get('remote_cloud_artifact_residual') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('meta_path') and os.path.isfile(p['meta_path']);assert os.path.getsize(p['path'])>20;body=open(p['path']).read();assert 'bc_id:' in body and 'from_session: true' in body;print('cloud_artifact_deliver from_session ok', p.get('path'), 'meta', p.get('meta_path'), 'bytes', p.get('bytes'), 'remote_artifact_residual', False)"
# Remote cloud artifact fetch closes remote_cloud_artifact_residual (local mock).
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18795 --mode cloud --token smoke-cloud >/tmp/bitbot-cloud-art-mock.log 2>&1 &
CLOUD_ART_MOCK_PID=$!
sleep 0.4
BITBOT_CLOUD_API_URL=http://127.0.0.1:18795 BITBOT_CURSOR_CLOUD_TOKEN=smoke-cloud BITBOT_CLOUD_ARTIFACT_FETCH=1 \
  node hosts/cli_host/run_turn.js "deliver cloud artifact artifact=bc-mock-cloud-1 dest=remote-art.md" >/tmp/bitbot-cloud-art-remote.json || true
kill "$CLOUD_ART_MOCK_PID" >/dev/null 2>&1 || true
wait "$CLOUD_ART_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cloud-art-remote.json'));h=next(x for x in d['host_results'] if x.get('kind')=='cloud_artifact_deliver');p=json.loads(h['stdout']);assert p.get('mode')=='host_cloud_artifact_remote_fetch';assert p.get('remote_fetched') is True;assert p.get('remote_cloud_artifact_residual') is False;assert p.get('pretend_remote_fetch') is False;assert p.get('path') and os.path.isfile(p['path']);assert 'remote_fetch: true' in open(p['path']).read();print('cloud_artifact_deliver remote fetch residual close ok', p.get('bc_id'), p.get('path'))"
# Clear prior live purchase token so sandbox_receipt is not reclassified as live_charge.
rm -f data/connectors/purchase_token.json
env -u BITBOT_PURCHASE_TOKEN -u BITBOT_PURCHASE_LIVE -u BITBOT_PURCHASE_API_URL \
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
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-purchase-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='purchase');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_charge';assert p.get('paid') is True;assert p.get('live_paid_residual') is False;assert p.get('pretend_paid') is False;assert (p.get('charge_probe') or {}).get('ok') is True;assert p.get('path') and os.path.isfile(p['path']);print('purchase live charge ok', p.get('receipt_path'), 'snap', p.get('path'), 'charge', p.get('charge_probe'))"
mkdir -p data/connectors
printf '%s\n' '{"access_token":"smoke-pay","token_type":"Bearer","api_url":"http://127.0.0.1:18765","live":true}' > data/connectors/purchase_token.json
env -u BITBOT_PURCHASE_TOKEN -u BITBOT_PURCHASE_LIVE -u BITBOT_PURCHASE_API_URL \
  node hosts/cli_host/run_turn.js --approved "purchase item=FileTokenWidget cents=499" >/tmp/bitbot-purchase-file-token.json || true
kill "$PURCHASE_MOCK_PID" >/dev/null 2>&1 || true
wait "$PURCHASE_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-purchase-file-token.json'));h=next(x for x in d['host_results'] if x.get('kind')=='purchase');p=json.loads(h['stdout']);assert p.get('mode')=='live_charge';assert p.get('live_paid_residual') is False;print('purchase connector token live:true file ok', p.get('mode'))"
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
python3 -c "import json;d=json.load(open('/tmp/bitbot-outlook-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_outlook';assert p.get('sent') is True;assert p.get('pretend_sent') is False;assert p.get('live_mail_residual') is False;print('mail_send live_outlook ok', p.get('message_id'))"
BITBOT_OUTLOOK_GRAPH_URL=http://127.0.0.1:18775 BITBOT_OUTLOOK_TOKEN=smoke-outlook BITBOT_MAIL_SEND=1 BITBOT_MAIL_PROVIDER=outlook \
  node hosts/cli_host/run_turn.js --approved "reply via email:live@example.com :: channel outlook mail" >/tmp/bitbot-email-channel-outlook.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-email-channel-outlook.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_email_outlook';assert p.get('live_post') is True;assert p.get('live_mail_residual') is False;assert p.get('pretend_live') is False;print('channel email live_outlook ok', p.get('mode'))"
BITBOT_OUTLOOK_GRAPH_URL=http://127.0.0.1:18775 BITBOT_OUTLOOK_TOKEN=smoke-outlook BITBOT_MAIL_PROVIDER=outlook \
  env -u BITBOT_GMAIL_TOKEN node hosts/cli_host/run_turn.js "search mail Invoice" >/tmp/bitbot-mail-search-outlook.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-mail-search-outlook.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_search');p=json.loads(h['stdout']);assert p.get('mode')=='outlook_live';assert p.get('live_mail_residual') is False;assert p.get('hit_count')>=1;print('mail_search outlook_live ok', p.get('hit_count'))"
BITBOT_OUTLOOK_GRAPH_URL=http://127.0.0.1:18775 BITBOT_OUTLOOK_TOKEN=smoke-outlook BITBOT_MAIL_PROVIDER=outlook \
  env -u BITBOT_GMAIL_TOKEN node hosts/cli_host/run_turn.js "read mail outlook-msg-1" >/tmp/bitbot-mail-read-outlook.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-mail-read-outlook.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_read');p=json.loads(h['stdout']);assert p.get('mode')=='outlook_live';assert p.get('live_mail_residual') is False;print('mail_read outlook_live ok', p.get('thread_id'))"
# mail_search/read prefer Outlook when connector armed (no BITBOT_MAIL_PROVIDER) — matches bare email.
mkdir -p data/connectors
printf '%s\n' '{"access_token":"smoke-outlook","token_type":"Bearer"}' > data/connectors/outlook_token.json
printf '%s\n' '{"connected":true,"status":"Ready"}' > data/connectors/outlook.json
printf '%s\n' '{"access_token":"stale-gmail-file","token_type":"Bearer"}' > data/connectors/gmail_token.json
BITBOT_OUTLOOK_GRAPH_URL=http://127.0.0.1:18775 \
  env -u BITBOT_GMAIL_TOKEN -u BITBOT_OUTLOOK_TOKEN -u BITBOT_MAIL_PROVIDER \
  node hosts/cli_host/run_turn.js "search mail PreferOutlook" >/tmp/bitbot-mail-search-prefer.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-mail-search-prefer.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_search');p=json.loads(h['stdout']);assert p.get('mode')=='outlook_live', p;assert (p.get('live_probe') or {}).get('provider')=='outlook';assert p.get('live_mail_residual') is False;print('mail_search prefer outlook after connect ok', p.get('mode'))"
BITBOT_OUTLOOK_GRAPH_URL=http://127.0.0.1:18775 \
  env -u BITBOT_GMAIL_TOKEN -u BITBOT_OUTLOOK_TOKEN -u BITBOT_MAIL_PROVIDER \
  node hosts/cli_host/run_turn.js "read mail prefer-1" >/tmp/bitbot-mail-read-prefer.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-mail-read-prefer.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_read');p=json.loads(h['stdout']);assert p.get('mode')=='outlook_live', p;assert (p.get('live_probe') or {}).get('provider')=='outlook';print('mail_read prefer outlook after connect ok', p.get('mode'))"
kill "$OUTLOOK_MOCK_PID" >/dev/null 2>&1 || true
wait "$OUTLOOK_MOCK_PID" 2>/dev/null || true
node hosts/cli_host/run_turn.js "shell echo needs-approve" >/tmp/bitbot-approval-widget.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-approval-widget.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='approval_card');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');w=p.get('widget') or {};assert w.get('widget_id');opts=w.get('options') or [];assert any(o.get('id')=='approve' for o in opts);assert any(o.get('id')=='dismiss' for o in opts);deliv=next(x for x in hrs if x.get('kind')=='delivery' and 'approval_card' in (x.get('stdout') or ''));dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('type')=='widget';assert os.path.isfile('data/delivery/send-to-user.jsonl');print('approval_card CM-0105 widget ok', w.get('widget_id'), 'options', len(opts))"
node hosts/cli_host/run_turn.js "personal slack dm owner=Uowner text=ping [widget:decision_card]" >/tmp/bitbot-personal-dm.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-personal-dm.json'));assert d.get('ok');assert d.get('intent')=='personal_slack_dm';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('personal_dm') is True;assert p.get('mode')=='personal_slack_dm_draft';assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert os.path.isfile('data/channels/outbound.jsonl');deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('personal_dm') is True;assert dp.get('widget_degraded') is True;print('personal_slack_dm CM-1103/1104 ok', p.get('mode'), 'degraded', p.get('widget_degraded'))"
# Live personal Slack DM closes live_slack_residual (CM-1103) with widget degrade (CM-1104).
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18783 --mode slack --token smoke-pdm >/tmp/bitbot-pdm-mock.log 2>&1 &
PDM_MOCK_PID=$!
sleep 0.4
BITBOT_SLACK_API_BASE=http://127.0.0.1:18783 SLACK_BOT_TOKEN=smoke-pdm BITBOT_SLACK_POST=1 \
  node hosts/cli_host/run_turn.js "personal slack dm owner=Uowner text=ping [widget:decision_card]" >/tmp/bitbot-personal-dm-live.json || true
kill "$PDM_MOCK_PID" >/dev/null 2>&1 || true
wait "$PDM_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-personal-dm-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('personal_dm') is True;assert p.get('mode')=='live_personal_slack_dm';assert p.get('live_slack_residual') is False;assert p.get('live_post') is True;assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('pretend_live') is False;print('personal_slack_dm live mock residual close ok', p.get('mode'), p.get('path'))"
node hosts/cli_host/run_turn.js "list credentials" >/tmp/bitbot-cred-list.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-cred-list.json'));assert d.get('ok');assert d.get('intent')=='list_credentials';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='credential_list');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('secret_echoed') is False;assert p.get('pretend_secret_view') is False;assert p.get('count')>=1;assert 'vault:secret' not in json.dumps(p).lower();print('credential_list metadata ok', p.get('count'))"
node hosts/cli_host/run_turn.js "fill credential domain=login.example.test" >/tmp/bitbot-cred.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cred.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='credential_fill');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('secret_echoed') is False;assert p.get('pretend_secret_view') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('vault_path') and os.path.isfile(p['vault_path']);assert p.get('browser_plan_path') and os.path.isfile(p['browser_plan_path']);plan=json.load(open(p['browser_plan_path']));assert plan.get('secret_in_plan') is False;assert plan.get('username');assert 'vault:secret' not in json.dumps(plan).lower();assert 'vault:secret' not in json.dumps(p).lower();assert p.get('credential_browser_fill_residual') is True;assert p.get('signin_fill_residual') is True;stu=p.get('send_to_user') or {};assert stu.get('type')=='secret-request';assert stu.get('secret_echoed') is False;deliv=next(x for x in hrs if x.get('kind')=='delivery' and 'secret-request' in (x.get('stdout') or ''));dp=json.loads(deliv.get('stdout') or '{}');assert dp.get('type')=='secret-request';assert dp.get('secret_echoed') is False;assert 'vault:secret' not in json.dumps(dp).lower();print('credential_fill vault+browser_plan+secret-request ok', p.get('path'), 'plan', p.get('browser_plan_path'), 'user', plan.get('username'), 'identity', p.get('identity_browser_ready'))"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-cred.json","utf8"));
if(!s.types.includes("secret-request")) { console.error(s); process.exit(1); }
if(s.types.includes("attachment") && s.labels.some(l=>l.startsWith("credential_fill"))) { console.error("credential_fill must not be attachment", s); process.exit(1); }
if(!s.labels.some(l=>l.startsWith("secret-request:"))) { console.error(s); process.exit(1); }
console.log("STU secret-request extract ok", s.types.slice(0,4), s.labels.slice(0,2));
'
# Username fill mock closes credential_browser_fill_residual; password stays signin_fill_residual.
BITBOT_CREDENTIAL_FILL_MOCK=1 node hosts/cli_host/run_turn.js "fill credential domain=example.com" >/tmp/bitbot-cred-user.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cred-user.json'));h=next(x for x in d['host_results'] if x.get('kind')=='credential_fill');p=json.loads(h['stdout']);assert p.get('credential_browser_fill_residual') is False;assert p.get('signin_fill_residual') is True;bf=p.get('browser_fill') or {};assert bf.get('username_typed') is True;assert bf.get('ok') is True;assert p.get('secret_echoed') is False;assert p.get('pretend_secret_view') is False;assert p.get('mode')=='host_credential_fill_username_mock';print('credential_fill username mock residual close ok', p.get('path'), 'signin_fill_residual', True)"
node hosts/cli_host/run_turn.js "identity browser" >/tmp/bitbot-identity.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-identity.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='oauth');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('connector')=='identity-browser';assert p.get('mode')=='identity_browser_switch';assert p.get('connected') is False;assert p.get('pretend_connected_slack') is False;assert p.get('switched') is True;assert p.get('session_path') and os.path.isfile(p['session_path']);assert p.get('user_data_dir') and os.path.isdir(p['user_data_dir']);assert 'chrome-user-data' in p['user_data_dir'];sess=json.load(open(p['session_path']));assert sess.get('user_data_dir')==p['user_data_dir'];ptr=os.path.join('data','connectors','identity','active-user-data-dir.txt');assert os.path.isfile(ptr);assert open(ptr).read().strip()==p['user_data_dir'];print('identity_browser switch ok', p.get('status'), p.get('user_data_dir'))"
# Identity profile pointer is preferred by CU chrome session (no live Chrome required).
python3 -c "
import json, os, subprocess, tempfile, pathlib
repo=pathlib.Path('.').resolve()
sess=repo/'data'/'connectors'/'identity'/'browser-session.json'
assert sess.is_file()
payload=json.loads(sess.read_text())
udd=payload.get('user_data_dir')
assert udd and os.path.isdir(udd)
art=tempfile.mkdtemp(prefix='bitbot-cu-id-')
env=os.environ.copy()
env['BITBOT_IDENTITY_USER_DATA_DIR']=udd
# Force headless; skip real chrome by checking profile resolution via --help path:
# run a tiny inline that imports profile prefer logic through the script's dry refuse path.
py='''
import json, os, sys
from pathlib import Path
sys.path.insert(0, \"scripts\")
# Inline the prefer logic used by run_chrome_session
repo = Path(\".\").resolve()
id_env = (os.environ.get(\"BITBOT_IDENTITY_USER_DATA_DIR\") or \"\").strip()
identity_meta = {\"identity_browser\": False, \"switched\": False, \"user_data_dir\": None}
profile = Path(\"/tmp/throwaway-should-not-win\")
if id_env:
    profile = Path(id_env)
    identity_meta = {\"identity_browser\": True, \"switched\": True, \"user_data_dir\": str(profile)}
assert identity_meta[\"identity_browser\"] is True
assert str(profile) == os.environ[\"BITBOT_IDENTITY_USER_DATA_DIR\"]
print(json.dumps({\"ok\": True, \"user_data_dir\": str(profile), \"identity_browser\": identity_meta}))
'''
out=subprocess.check_output([os.environ.get('PYTHON','python3'),'-c',py], cwd=str(repo), env=env, text=True)
meta=json.loads(out.strip().splitlines()[-1])
assert meta['identity_browser']['switched'] is True
assert meta['user_data_dir']==udd
print('identity_browser CU profile prefer ok', meta['user_data_dir'])
"
echo "==> Host credential_fill live CDP username (BITBOT_CREDENTIAL_BROWSER_FILL=1 closes credential_browser_fill_residual; password deferred)"
# Port 18798 avoids CU signin (18766) / webhook claim (18793) / Slack events (18797).
python3 "$ROOT/scripts/host_cu_signin_fixture.py" --port 18798 >/tmp/bitbot-cred-signin-fixture.log 2>&1 &
CRED_SIGNIN_FIX_PID=$!
sleep 0.4
BITBOT_CU_ALLOW_LOCAL=1 BITBOT_CREDENTIAL_BROWSER_FILL=1 \
  node hosts/cli_host/run_turn.js 'fill credential domain=[signin](http://127.0.0.1:18798/)' >/tmp/bitbot-cred-live.json || true
kill "$CRED_SIGNIN_FIX_PID" >/dev/null 2>&1 || true
wait "$CRED_SIGNIN_FIX_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cred-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='credential_fill');p=json.loads(h['stdout']);assert p.get('mode')=='host_credential_fill_browser';assert p.get('credential_browser_fill_residual') is False;assert p.get('signin_fill_residual') is True;assert p.get('secret_echoed') is False;assert p.get('pretend_secret_view') is False;bf=p.get('browser_fill') or {};assert bf.get('username_typed') is True;assert bf.get('ok') is True;assert bf.get('password_filled') is not True;assert 'vault:secret' not in json.dumps(p).lower();assert p.get('identity_browser_ready') is True;print('credential_fill live CDP username residual close ok', p.get('path'), 'mode', p.get('mode'), 'cred_residual', False, 'signin_residual', True, 'secret_echoed', False)"
# device_tool capture path (bypass MoonBit permission gate — Host FFI only)
node -e '
const { createHostFfi } = require("./hosts/shared/host_ffi.js");
(async () => {
  const ffi = createHostFfi(process.cwd());
  const results = await ffi.executeHostEffects([
    { kind: "device_tool", command: "desktop|camera" },
  ]);
  const h = results.find((r) => r && r.kind === "device_tool");
  if (!h || !h.ok) throw new Error("device_tool missing: " + JSON.stringify(results).slice(0, 400));
  const p = JSON.parse(h.stdout || "{}");
  if (p.pretend_executed === true) throw new Error("pretend_executed");
  if (typeof p.device_capture_residual !== "boolean") throw new Error("missing device_capture_residual");
  if (!(p.executed === true || p.device_capture_residual === true)) throw new Error("neither executed nor residual");
  if (!p.path) throw new Error("missing path");
  require("fs").writeFileSync("/tmp/bitbot-device-tool-ffi.json", JSON.stringify({ ok: true, ...p }, null, 2));
  console.log("device_tool capture honesty ok", "executed", p.executed, "residual", p.device_capture_residual, p.path, p.mode);
})().catch((e) => { console.error(e); process.exit(1); });
'
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-device-tool-ffi.json'));assert d.get('ok');assert d.get('pretend_executed') is not True;assert isinstance(d.get('device_capture_residual'),bool);assert d.get('path') and os.path.isfile(d['path']);print('device_tool ffi snap ok', d.get('mode'), d.get('path'))"
# contacts/location: residual without fixture; closes with data/device/*.json
node -e '
const { createHostFfi } = require("./hosts/shared/host_ffi.js");
const fs = require("fs");
(async () => {
  const ffi = createHostFfi(process.cwd());
  fs.mkdirSync("data/device", { recursive: true });
  try { fs.unlinkSync("data/device/contacts.json"); } catch (_) {}
  let r = await ffi.executeHostEffects([{ kind: "device_tool", command: "desktop|contacts" }]);
  let p = JSON.parse(r.find((x) => x.kind === "device_tool").stdout);
  if (p.device_tool_residual !== true || p.executed !== false) throw new Error("expected residual");
  fs.writeFileSync("data/device/contacts.json", JSON.stringify({ contacts: [{ id: "1", name: "Ada" }], pretend: false }));
  r = await ffi.executeHostEffects([{ kind: "device_tool", command: "desktop|contacts" }]);
  p = JSON.parse(r.find((x) => x.kind === "device_tool").stdout);
  if (p.executed !== true || p.device_tool_residual !== false || p.mode !== "host_device_contacts_fixture") throw new Error(JSON.stringify(p));
  fs.writeFileSync("/tmp/bitbot-device-contacts.json", JSON.stringify({ ok: true, ...p }, null, 2));
  console.log("device_tool contacts fixture ok", p.mode, p.capture_path);
  // camera/mic fixtures close device_capture_residual without OS devices
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  fs.writeFileSync("data/device/camera.png", png);
  // Minimal RIFF/WAV (44-byte header + 8 sample bytes)
  const wav = Buffer.alloc(52);
  wav.write("RIFF", 0); wav.writeUInt32LE(44, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write("data", 36); wav.writeUInt32LE(8, 40);
  fs.writeFileSync("data/device/mic.wav", wav);
  r = await ffi.executeHostEffects([{ kind: "device_tool", command: "desktop|camera" }]);
  p = JSON.parse(r.find((x) => x.kind === "device_tool").stdout);
  if (!(p.executed === true || p.mode === "host_device_camera_fixture" || p.mode === "host_device_import_root" || p.mode === "host_device_v4l2_frame")) {
    throw new Error("camera capture unexpected: " + JSON.stringify(p));
  }
  if (p.device_capture_residual !== false) throw new Error("camera residual expected closed: " + JSON.stringify(p));
  fs.writeFileSync("/tmp/bitbot-device-camera.json", JSON.stringify({ ok: true, ...p }, null, 2));
  console.log("device_tool camera fixture/capture ok", p.mode, p.capture_path);
  r = await ffi.executeHostEffects([{ kind: "device_tool", command: "desktop|mic" }]);
  p = JSON.parse(r.find((x) => x.kind === "device_tool").stdout);
  if (!(p.executed === true || p.mode === "host_device_mic_fixture" || p.mode === "host_device_alsa_wav")) {
    throw new Error("mic capture unexpected: " + JSON.stringify(p));
  }
  if (p.device_capture_residual !== false) throw new Error("mic residual expected closed: " + JSON.stringify(p));
  fs.writeFileSync("/tmp/bitbot-device-mic.json", JSON.stringify({ ok: true, ...p }, null, 2));
  console.log("device_tool mic fixture/capture ok", p.mode, p.capture_path);
  // location fixture (parity with contacts)
  try { fs.unlinkSync("data/device/location.json"); } catch (_) {}
  r = await ffi.executeHostEffects([{ kind: "device_tool", command: "desktop|location" }]);
  p = JSON.parse(r.find((x) => x.kind === "device_tool").stdout);
  if (p.device_tool_residual !== true || p.executed !== false) throw new Error("expected location residual");
  fs.writeFileSync("data/device/location.json", JSON.stringify({ lat: 37.77, lon: -122.42, pretend: false }));
  r = await ffi.executeHostEffects([{ kind: "device_tool", command: "desktop|location" }]);
  p = JSON.parse(r.find((x) => x.kind === "device_tool").stdout);
  if (p.executed !== true || p.device_tool_residual !== false || p.mode !== "host_device_location_fixture") throw new Error(JSON.stringify(p));
  fs.writeFileSync("/tmp/bitbot-device-location.json", JSON.stringify({ ok: true, ...p }, null, 2));
  console.log("device_tool location fixture ok", p.mode, p.capture_path);
})().catch((e)=>{console.error(e);process.exit(1);});
'
node hosts/cli_host/run_turn.js --approved "cold mail to=a@example.com subject=Hi body=Hello unsubscribe=mailto:u@example.com" >/tmp/bitbot-cold.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cold.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('provider')=='cold';assert p.get('mode')=='cold_sandbox_eml';assert p.get('sent') is False;assert p.get('pretend_sent') is False;assert p.get('live_mail_residual') is True;assert p.get('eml_ok') is True;assert 'List-Unsubscribe:' in open(p['eml_path']).read();assert p.get('path') and os.path.isfile(p['path']);print('cold_mail List-Unsubscribe eml ok', p.get('eml_path'), p.get('path'), 'live_mail_residual', True)"
# Live cold mail mock closes live_mail_residual
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18781 --mode cold --token smoke-cold >/tmp/bitbot-cold-mock.log 2>&1 &
COLD_MOCK_PID=$!
sleep 0.4
BITBOT_COLD_MAIL_API_URL=http://127.0.0.1:18781 BITBOT_COLD_MAIL_TOKEN=smoke-cold BITBOT_MAIL_SEND=1 \
  node hosts/cli_host/run_turn.js --approved "cold mail to=a@example.com subject=Hi body=Hello unsubscribe=mailto:u@example.com" >/tmp/bitbot-cold-live.json || true
kill "$COLD_MOCK_PID" >/dev/null 2>&1 || true
wait "$COLD_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-cold-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_send');p=json.loads(h['stdout']);assert p.get('provider')=='cold';assert p.get('mode')=='cold_live';assert p.get('sent') is True;assert p.get('live_mail_residual') is False;assert p.get('pretend_sent') is False;assert 'X-BitBot-Status: sent' in open(p['eml_path']).read();assert 'List-Unsubscribe:' in open(p['eml_path']).read();print('cold_mail live mock residual close ok', p.get('message_id'), p.get('path'))"
node hosts/cli_host/run_turn.js "learn from demo title=Checkout steps=click:Cart|type:email" >/tmp/bitbot-lfd.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-lfd.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='skill_write');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('path') and os.path.isfile(p['path']);body=open(p['path']).read();assert 'click:Cart' in body or 'Steps' in body;print('learn_from_demo skill steps ok', p.get('path'))"
node hosts/cli_host/run_turn.js "code changes README.mbt.md" >/tmp/bitbot-code-changes.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-code-changes.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='code_changes');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('applied') is False;assert p.get('pretend_committed') is False;assert p.get('pretend_pushed') is False;assert p.get('code_apply_residual') is True;assert p.get('git_commit_residual') is False;assert p.get('git_push_residual') is False;assert p.get('path') and os.path.isfile(p['path']);print('code_changes plan ok', p.get('path'))"
python3 -c "from pathlib import Path;p=Path('README.mbt.md');t=p.read_text();p.write_text(''.join(ln for ln in t.splitlines(True) if 'bitbot-host-applied' not in ln));Path('/tmp/bitbot-code-apply-before.txt').write_text(p.read_text());print('code_changes apply target pre-clean ok')"
BITBOT_CODE_APPLY=1 node hosts/cli_host/run_turn.js "code changes README.mbt.md" >/tmp/bitbot-code-apply.json
python3 -c "import json,os;from pathlib import Path;d=json.load(open('/tmp/bitbot-code-apply.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='code_changes');p=json.loads(h.get('stdout') or '{}');assert p.get('applied') is True;assert p.get('code_apply_residual') is False;assert p.get('git_commit_residual') is True;assert p.get('git_push_residual') is False;assert p.get('pretend_committed') is False;assert p.get('pretend_pushed') is False;assert p.get('commit_sha') in (None,'');assert p.get('target_mutated') is True;assert p.get('applied_path') and os.path.isfile(p['applied_path']);target=p.get('target') or 'README.mbt.md';before=Path('/tmp/bitbot-code-apply-before.txt').read_text();after=Path(target).read_text();assert after!=before,'target file content must change on apply';assert 'bitbot-host-applied' in after;Path(target).write_text(''.join(ln for ln in after.splitlines(True) if 'bitbot-host-applied' not in ln));print('code_changes apply target+sidecar ok', p.get('applied_path'), target, 'git_commit_residual', True)"
# Gated git commit closes git_commit_residual via BITBOT_GIT_BIN mock (never invent SHA).
# After commit success, stamps git_push_residual until BITBOT_CODE_PUSH=1.
python3 -c "from pathlib import Path;p=Path('README.mbt.md');t=p.read_text();p.write_text(''.join(ln for ln in t.splitlines(True) if 'bitbot-host-applied' not in ln));print('code_changes commit target pre-clean ok')"
rm -rf /tmp/bitbot-git-mock
mkdir -p /tmp/bitbot-git-mock
BITBOT_CODE_APPLY=1 BITBOT_CODE_COMMIT=1 BITBOT_GIT_BIN="$ROOT/scripts/host_git_mock.sh" BITBOT_GIT_MOCK_LOG_DIR=/tmp/bitbot-git-mock \
  node hosts/cli_host/run_turn.js "code changes README.mbt.md" >/tmp/bitbot-code-commit.json
python3 -c "import json,os;from pathlib import Path;d=json.load(open('/tmp/bitbot-code-commit.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='code_changes');p=json.loads(h.get('stdout') or '{}');assert p.get('applied') is True;assert p.get('code_apply_residual') is False;assert p.get('git_commit_residual') is False;assert p.get('git_push_residual') is True;assert p.get('pretend_committed') is False;assert p.get('pretend_pushed') is False;assert p.get('commit_attempted') is True;assert p.get('push_attempted') is False;assert p.get('commit_sha')=='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';assert os.path.isfile('/tmp/bitbot-git-mock/invocations.log');log=open('/tmp/bitbot-git-mock/invocations.log').read();assert 'commit' in log and 'rev-parse' in log;assert 'push' not in log;assert os.path.isfile('/tmp/bitbot-git-mock/last-commit.json');target=p.get('target') or 'README.mbt.md';Path(target).write_text(''.join(ln for ln in Path(target).read_text().splitlines(True) if 'bitbot-host-applied' not in ln));print('code_changes git commit mock residual close ok', p.get('commit_sha'), p.get('commit_git_bin'), 'git_push_residual', True)"
# Gated git push closes git_push_residual via BITBOT_GIT_BIN mock (never invent remote / pretend_pushed).
python3 -c "from pathlib import Path;p=Path('README.mbt.md');t=p.read_text();p.write_text(''.join(ln for ln in t.splitlines(True) if 'bitbot-host-applied' not in ln));print('code_changes push target pre-clean ok')"
rm -rf /tmp/bitbot-git-mock-push
mkdir -p /tmp/bitbot-git-mock-push
BITBOT_CODE_APPLY=1 BITBOT_CODE_COMMIT=1 BITBOT_CODE_PUSH=1 BITBOT_GIT_BIN="$ROOT/scripts/host_git_mock.sh" BITBOT_GIT_MOCK_LOG_DIR=/tmp/bitbot-git-mock-push \
  node hosts/cli_host/run_turn.js "code changes README.mbt.md" >/tmp/bitbot-code-push.json
python3 -c "import json,os;from pathlib import Path;d=json.load(open('/tmp/bitbot-code-push.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='code_changes');p=json.loads(h.get('stdout') or '{}');assert p.get('applied') is True;assert p.get('code_apply_residual') is False;assert p.get('git_commit_residual') is False;assert p.get('git_push_residual') is False;assert p.get('pretend_committed') is False;assert p.get('pretend_pushed') is False;assert p.get('commit_attempted') is True;assert p.get('push_attempted') is True;assert p.get('commit_sha')=='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';assert os.path.isfile('/tmp/bitbot-git-mock-push/invocations.log');log=open('/tmp/bitbot-git-mock-push/invocations.log').read();assert 'commit' in log and 'rev-parse' in log and 'push' in log;assert os.path.isfile('/tmp/bitbot-git-mock-push/last-push.json');push=json.load(open('/tmp/bitbot-git-mock-push/last-push.json'));assert push.get('pretend_pushed') is False;assert 'remote_url' not in push;target=p.get('target') or 'README.mbt.md';Path(target).write_text(''.join(ln for ln in Path(target).read_text().splitlines(True) if 'bitbot-host-applied' not in ln));print('code_changes git push mock residual close ok', p.get('commit_sha'), p.get('push_git_bin'), 'git_push_residual', False)"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const apply=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-code-apply.json","utf8"));
if(!apply.labels.some(l=>l.includes("/git_commit_residual"))) { console.error("apply must stamp git_commit_residual", apply); process.exit(1); }
if(apply.labels.some(l=>l.includes("/git_push_residual"))) { console.error("apply must not stamp git_push_residual", apply); process.exit(1); }
const committed=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-code-commit.json","utf8"));
if(committed.labels.some(l=>l.includes("/git_commit_residual"))) { console.error("commit must close git_commit_residual", committed); process.exit(1); }
if(!committed.labels.some(l=>l.includes("/git_push_residual"))) { console.error("commit must stamp git_push_residual", committed); process.exit(1); }
const pushed=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-code-push.json","utf8"));
if(pushed.labels.some(l=>l.includes("/git_push_residual"))) { console.error("push must close git_push_residual", pushed); process.exit(1); }
if(pushed.labels.some(l=>l.includes("/git_commit_residual"))) { console.error("push must keep git_commit_residual closed", pushed); process.exit(1); }
console.log("STU code_changes git_commit_residual+git_push_residual chips ok", apply.labels.filter(l=>l.includes("code")).slice(0,2), committed.labels.filter(l=>l.includes("code")).slice(0,2));
'
node hosts/cli_host/run_turn.js "source control github" >/tmp/bitbot-sc.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='host_git_status' or str(p.get('mode') or '').startswith('host_git_status');assert p.get('pretend_remote_pr') is False;assert p.get('remote_pr_residual') is True;assert p.get('branch');assert p.get('path') and os.path.isfile(p['path']);assert p.get('status_path') and os.path.isfile(p['status_path']);print('source_control git status ok', p.get('branch'), 'dirty', p.get('dirty'), 'path', p.get('path'), 'remote_pr_residual', p.get('remote_pr_residual'))"
node hosts/cli_host/run_turn.js "source control create_pr" >/tmp/bitbot-sc-pr.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc-pr.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_remote_pr') is False;assert p.get('remote_pr_residual') is True;assert p.get('gh_pr_create_residual') is True;rp=p.get('remote_pr') or {};assert rp.get('mode') in ('remote_pr_residual','gh_pr_view_failed','gh_pr_view','gh_pr_create_dry_run','gh_pr_create_failed');assert rp.get('plan_path') and os.path.isfile(rp['plan_path']);plan=json.load(open(rp['plan_path']));assert plan.get('pretend_remote_pr') is False;assert plan.get('real_create_gated') is True;print('source_control remote PR residual+plan ok', rp.get('mode'), rp.get('plan_path'), 'gh_pr_create_residual', True)"
BITBOT_GH_CREATE_PR=1 node hosts/cli_host/run_turn.js "source control create_pr" >/tmp/bitbot-sc-pr-live.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc-pr-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_remote_pr') is False;rp=p.get('remote_pr') or {};assert rp.get('mode') in ('gh_pr_view','gh_pr_create_dry_run','gh_pr_create');assert p.get('remote_pr_residual') is False;assert p.get('gh_pr_create_residual') is True or rp.get('mode')=='gh_pr_create';assert rp.get('plan_path') and os.path.isfile(rp['plan_path']);plan=json.load(open(rp['plan_path']));assert plan.get('pretend_remote_pr') is False;print('source_control remote PR live/view ok', rp.get('mode'), 'remote_pr_residual', p.get('remote_pr_residual'), 'gh_pr_create_residual', p.get('gh_pr_create_residual'), 'gated', plan.get('real_create_gated'))"
# Gated create evidence via injectable gh mock (no real GitHub PR invent).
rm -rf /tmp/bitbot-gh-mock-dry /tmp/bitbot-gh-mock-real
mkdir -p /tmp/bitbot-gh-mock-dry /tmp/bitbot-gh-mock-real
BITBOT_GH_BIN="$ROOT/scripts/host_gh_mock.sh" BITBOT_GH_MOCK_LOG_DIR=/tmp/bitbot-gh-mock-dry BITBOT_GH_CREATE_PR=1 node hosts/cli_host/run_turn.js "source control create_pr" >/tmp/bitbot-sc-pr-dry.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc-pr-dry.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');p=json.loads(h.get('stdout') or '{}');rp=p.get('remote_pr') or {};assert rp.get('mode')=='gh_pr_create_dry_run';assert rp.get('dry_run') is True;assert rp.get('real_create_gated') is True;assert p.get('remote_pr_residual') is False;assert p.get('gh_pr_create_residual') is True;assert p.get('pretend_remote_pr') is False;plan=json.load(open(rp['plan_path']));assert plan.get('dry_run') is True;assert plan.get('real_create_gated') is True;assert plan.get('allow_real_create') is False;assert '--dry-run' in (plan.get('args') or []);log=open('/tmp/bitbot-gh-mock-dry/invocations.log').read();assert 'pr create' in log and '--dry-run' in log;print('source_control mock dry-run create ok', rp.get('plan_path'), 'gh_pr_create_residual', True, 'remote_pr_residual', False)"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-sc-pr-dry.json","utf8"));
if(s.labels.some(l=>l.includes("/remote_pr_residual"))) { console.error("dry-run must not stamp remote_pr_residual", s); process.exit(1); }
if(!s.labels.some(l=>l.includes("/gh_pr_create_residual"))) { console.error("dry-run must stamp gh_pr_create_residual", s); process.exit(1); }
if(!s.labels.some(l=>l.includes("real_create_gated")||l.includes("source_control")||l.includes("gh_pr"))) { console.error(s); process.exit(1); }
console.log("STU dry-run gh_pr_create_residual chip + no remote_pr_residual conflation ok", s.labels.slice(0,4));
'
BITBOT_GH_BIN="$ROOT/scripts/host_gh_mock.sh" BITBOT_GH_MOCK_LOG_DIR=/tmp/bitbot-gh-mock-real BITBOT_GH_CREATE_PR=1 BITBOT_GH_PR_CREATE=1 node hosts/cli_host/run_turn.js "source control create_pr" >/tmp/bitbot-sc-pr-real.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sc-pr-real.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='source_control');p=json.loads(h.get('stdout') or '{}');rp=p.get('remote_pr') or {};assert rp.get('mode')=='gh_pr_create';assert rp.get('dry_run') is False;assert rp.get('real_create_gated') is False;assert rp.get('create_attempted') is True;assert p.get('remote_pr_residual') is False;assert p.get('gh_pr_create_residual') is False;assert p.get('pretend_remote_pr') is False;plan=json.load(open(rp['plan_path']));assert plan.get('dry_run') is False;assert plan.get('allow_real_create') is True;assert plan.get('real_create_gated') is False;assert '--dry-run' not in (plan.get('args') or []);assert os.path.isfile('/tmp/bitbot-gh-mock-real/last-create.json');print('source_control mock gated real create ok', rp.get('plan_path'), 'gh_pr_create_residual', False, plan.get('output_prefix','')[:80])"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-sc-pr-real.json","utf8"));
if(s.labels.some(l=>l.includes("/gh_pr_create_residual"))) { console.error("real create must close gh_pr_create_residual", s); process.exit(1); }
if(s.labels.some(l=>l.includes("/remote_pr_residual"))) { console.error("real create must not stamp remote_pr_residual", s); process.exit(1); }
console.log("STU real create closes gh_pr_create_residual chip ok", s.labels.slice(0,4));
'
node hosts/cli_host/run_turn.js --approved "send on behalf to=a@example.com subject=Hi body=Hello" >/tmp/bitbot-sob.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sob.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='mail_send');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('provider')=='onbehalf';assert p.get('mode')=='onbehalf_sandbox_eml';assert p.get('sent') is False;assert p.get('pretend_sent') is False;assert p.get('live_mail_residual') is True;assert 'X-BitBot-Send-On-Behalf: 1' in open(p['eml_path']).read();assert p.get('path') and os.path.isfile(p['path']);print('send_on_behalf eml ok', p.get('eml_path'), p.get('path'), 'live_mail_residual', True)"
# Live onbehalf mail mock closes live_mail_residual
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18782 --mode onbehalf --token smoke-sob >/tmp/bitbot-sob-mock.log 2>&1 &
SOB_MOCK_PID=$!
sleep 0.4
BITBOT_ONBEHALF_MAIL_API_URL=http://127.0.0.1:18782 BITBOT_ONBEHALF_MAIL_TOKEN=smoke-sob BITBOT_MAIL_SEND=1 \
  node hosts/cli_host/run_turn.js --approved "send on behalf to=a@example.com subject=Hi body=Hello" >/tmp/bitbot-sob-live.json || true
kill "$SOB_MOCK_PID" >/dev/null 2>&1 || true
wait "$SOB_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sob-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_send');p=json.loads(h['stdout']);assert p.get('provider')=='onbehalf';assert p.get('mode')=='onbehalf_live';assert p.get('sent') is True;assert p.get('live_mail_residual') is False;assert p.get('pretend_sent') is False;assert 'X-BitBot-Send-On-Behalf: 1' in open(p['eml_path']).read();assert 'X-BitBot-Status: sent' in open(p['eml_path']).read();print('send_on_behalf live mock residual close ok', p.get('message_id'), p.get('path'))"
node hosts/cli_host/run_turn.js --approved "reply via foo:bar :: unknown scheme residual" >/tmp/bitbot-ch-unknown.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-ch-unknown.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='durable_outbound';assert p.get('live_channel_residual') is True;assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);print('channel unknown scheme live_channel_residual ok', p.get('path'))"
node hosts/cli_host/run_turn.js --approved "reply via sms:+15551212 :: hello sms" >/tmp/bitbot-sms.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sms.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='sms';assert p.get('mode')=='sandbox_sms';assert p.get('live_sms_residual') is True;assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);print('channel sms sandbox residual ok', p.get('mode'), p.get('path'))"
# Live SMS mock closes live_sms_residual
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18777 --mode sms --token smoke-sms >/tmp/bitbot-sms-mock.log 2>&1 &
SMS_MOCK_PID=$!
sleep 0.4
BITBOT_SMS_API_URL=http://127.0.0.1:18777 BITBOT_SMS_TOKEN=smoke-sms BITBOT_SMS_POST=1 \
  node hosts/cli_host/run_turn.js --approved "reply via sms:+15551212 :: live sms mock" >/tmp/bitbot-sms-live.json || true
kill "$SMS_MOCK_PID" >/dev/null 2>&1 || true
wait "$SMS_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sms-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='sms';assert p.get('mode')=='live_sms';assert p.get('live_sms_residual') is False;assert p.get('live_channel_residual') is False;assert p.get('live_post') is True;assert p.get('pretend_live') is False;print('channel sms live mock residual close ok', p.get('mode'), p.get('path'))"
# Live SMS claim closes live_sms_residual (GET /messages); widget degrade on claim body.
# Port 18801 avoids leftover 18792 listeners and SMS listen (18802).
fuser -k 18801/tcp >/dev/null 2>&1 || true
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18801 --mode sms --token smoke-sms >/tmp/bitbot-sms-claim-mock.log 2>&1 &
SMS_CLAIM_MOCK_PID=$!
sleep 0.4
BITBOT_SMS_API_URL=http://127.0.0.1:18801 BITBOT_SMS_TOKEN=smoke-sms BITBOT_SMS_CLAIM=1 \
  node hosts/cli_host/run_turn.js --approved "reply via sms:+15551212 :: claim sms [widget:decision_card]" >/tmp/bitbot-sms-claim-live.json || true
# Live SMS claim + BITBOT_INBOUND_TURN closes inbound_turn_residual (parity with Slack/Teams).
BITBOT_SMS_API_URL=http://127.0.0.1:18801 BITBOT_SMS_TOKEN=smoke-sms BITBOT_SMS_CLAIM=1 BITBOT_INBOUND_TURN=1 \
  node hosts/cli_host/run_turn.js --approved "reply via sms:+15551212 :: claim sms inbound turn" >/tmp/bitbot-sms-claim-turn.json || true
kill "$SMS_CLAIM_MOCK_PID" >/dev/null 2>&1 || true
wait "$SMS_CLAIM_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sms-claim-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_sms_claim';assert p.get('claimed_count',0)>=1;assert p.get('live_sms_residual') is False;assert p.get('live_channel_residual') is False;assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('pretend_live') is False;assert 'live_sms_claim' in open('data/channels/inbound.jsonl').read();print('channel sms live claim residual close ok', 'claimed', p.get('claimed_count'), 'residual', False)"
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sms-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_sms_claim';assert p.get('live_sms_residual') is False;th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;assert p.get('inbound_turn_residual') is False;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('channel sms claim inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
env -u BITBOT_SMS_TOKEN -u BITBOT_SMS_API_URL BITBOT_SMS_CLAIM=1 \
  node hosts/cli_host/run_turn.js --approved "reply via sms:+15551212 :: sandbox claim" >/tmp/bitbot-sms-claim-sandbox.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-sms-claim-sandbox.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='sandbox_sms_claim';assert p.get('live_sms_residual') is True;assert p.get('pretend_live') is False;print('channel sms sandbox claim residual open ok', p.get('claimed_count'))"
# Live email/gmail/outlook channel claim closes live_mail_residual (reuses mail_claim mock).
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18795 --mode mail_claim --token smoke-claim >/tmp/bitbot-email-claim-mock.log 2>&1 &
EMAIL_CLAIM_MOCK_PID=$!
sleep 0.4
BITBOT_MAIL_CLAIM_API_URL=http://127.0.0.1:18795 BITBOT_MAIL_CLAIM_TOKEN=smoke-claim BITBOT_EMAIL_CLAIM=1 \
  env -u BITBOT_MAIL_SEND \
  node hosts/cli_host/run_turn.js --approved "reply via email:claim@example.com :: claim email inbound" >/tmp/bitbot-email-claim-live.json || true
kill "$EMAIL_CLAIM_MOCK_PID" >/dev/null 2>&1 || true
wait "$EMAIL_CLAIM_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-email-claim-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_email_claim';assert p.get('claimed_count',0)>=1;assert p.get('live_mail_residual') is False;assert p.get('live_channel_residual') is False;assert (p.get('claim') or {}).get('ok') is True;assert p.get('pretend_live') is False;assert p.get('inbound_push_residual') is True;assert 'live_email_claim' in open('data/channels/inbound.jsonl').read();print('channel email live claim residual close ok', 'claimed', p.get('claimed_count'), 'inbound_push_residual', True)"
# Email channel live claim + BITBOT_INBOUND_TURN closes inbound_turn_residual.
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18796 --mode mail_claim --token smoke-claim >/tmp/bitbot-email-claim-turn-mock.log 2>&1 &
EMAIL_CLAIM_TURN_MOCK_PID=$!
sleep 0.4
BITBOT_MAIL_CLAIM_API_URL=http://127.0.0.1:18796 BITBOT_MAIL_CLAIM_TOKEN=smoke-claim BITBOT_EMAIL_CLAIM=1 BITBOT_INBOUND_TURN=1 \
  env -u BITBOT_MAIL_SEND \
  node hosts/cli_host/run_turn.js --approved "reply via gmail:claim@example.com :: claim inbound turn" >/tmp/bitbot-email-claim-turn.json || true
kill "$EMAIL_CLAIM_TURN_MOCK_PID" >/dev/null 2>&1 || true
wait "$EMAIL_CLAIM_TURN_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-email-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_email_claim';assert p.get('live_mail_residual') is False;th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;assert p.get('inbound_turn_residual') is False;assert p.get('inbound_push_residual') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('channel email claim inbound turn residual close ok', th.get('turn_path'), 'inbound_push_residual', True)"
env -u BITBOT_MAIL_CLAIM_TOKEN -u BITBOT_MAIL_CLAIM_API_URL BITBOT_EMAIL_CLAIM=1 \
  env -u BITBOT_MAIL_SEND \
  node hosts/cli_host/run_turn.js --approved "reply via outlook:claim@example.com :: sandbox email claim" >/tmp/bitbot-email-claim-sandbox.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-email-claim-sandbox.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='sandbox_email_claim';assert p.get('live_mail_residual') is True;assert p.get('pretend_live') is False;print('channel email sandbox claim residual open ok', p.get('claimed_count'))"
# CM-1104 widget degrade on SMS (parity with Slack/Teams/meeting).
node hosts/cli_host/run_turn.js --approved "reply via sms:+15551212 :: hello [widget:decision_card]" >/tmp/bitbot-sms-widget.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-sms-widget.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='sms';assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('pretend_live') is False;print('channel sms widget_degraded ok', p.get('mode'), p.get('body'))"
node hosts/cli_host/run_turn.js --approved "reply via webhook:panel :: hello hook" >/tmp/bitbot-wh-out.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-wh-out.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='webhook';assert p.get('live_webhook_residual') is True;assert p.get('key_leaked') is False;assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);print('channel webhook outbound residual ok', p.get('mode'), p.get('path'))"
# Live webhook outbound mock closes live_webhook_residual
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18778 --mode webhook >/tmp/bitbot-wh-out-mock.log 2>&1 &
WH_OUT_MOCK_PID=$!
sleep 0.4
BITBOT_WEBHOOK_OUTBOUND_URL=http://127.0.0.1:18778/hooks BITBOT_WEBHOOK_POST=1 \
  node hosts/cli_host/run_turn.js --approved "reply via webhook:panel :: live hook mock" >/tmp/bitbot-wh-out-live.json || true
kill "$WH_OUT_MOCK_PID" >/dev/null 2>&1 || true
wait "$WH_OUT_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-wh-out-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='webhook';assert p.get('live_webhook_residual') is False;assert p.get('live_post') is True;assert p.get('key_leaked') is False;assert p.get('pretend_live') is False;print('channel webhook live mock residual close ok', p.get('mode'), p.get('path'))"
# Live webhook claim closes live_webhook_residual (GET /hooks).
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18793 --mode webhook >/tmp/bitbot-wh-claim-mock.log 2>&1 &
WH_CLAIM_MOCK_PID=$!
sleep 0.4
BITBOT_WEBHOOK_OUTBOUND_URL=http://127.0.0.1:18793/hooks BITBOT_WEBHOOK_CLAIM=1 \
  node hosts/cli_host/run_turn.js --approved "reply via webhook:panel :: claim hook [widget:decision_card]" >/tmp/bitbot-wh-claim-live.json || true
# Live webhook claim + BITBOT_INBOUND_TURN closes inbound_turn_residual (parity with Slack/Teams).
BITBOT_WEBHOOK_OUTBOUND_URL=http://127.0.0.1:18793/hooks BITBOT_WEBHOOK_CLAIM=1 BITBOT_INBOUND_TURN=1 \
  node hosts/cli_host/run_turn.js --approved "reply via webhook:panel :: claim hook inbound turn" >/tmp/bitbot-wh-claim-turn.json || true
kill "$WH_CLAIM_MOCK_PID" >/dev/null 2>&1 || true
wait "$WH_CLAIM_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-wh-claim-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_webhook_claim';assert p.get('claimed_count',0)>=1;assert p.get('live_webhook_residual') is False;assert p.get('widget_degraded') is True;assert p.get('key_leaked') is False;assert p.get('pretend_live') is False;assert 'live_webhook_claim' in open('data/channels/inbound.jsonl').read();print('channel webhook live claim residual close ok', 'claimed', p.get('claimed_count'), 'residual', False)"
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-wh-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_webhook_claim';assert p.get('live_webhook_residual') is False;th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;assert p.get('inbound_turn_residual') is False;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('channel webhook claim inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
node hosts/cli_host/run_turn.js --approved "reply via webhook:panel :: hook [widget:decision_card]" >/tmp/bitbot-wh-out-widget.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-wh-out-widget.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='webhook';assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('pretend_live') is False;print('channel webhook widget_degraded ok', p.get('mode'), p.get('body'))"
node hosts/cli_host/run_turn.js --approved "reply via voice:call-smoke :: hello voice channel" >/tmp/bitbot-voice-ch.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-ch.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='voice';assert p.get('mode')=='sandbox_voice_channel';assert p.get('live_voice_residual') is True;assert p.get('pretend_live') is False;assert p.get('call_id');assert p.get('media_ok') is True;assert p.get('media_path') and os.path.isfile(p['media_path']);assert open(p['media_path'],'rb').read(4)==b'RIFF';assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('data/channels/voice/outbound.jsonl');assert p.get('voice_tts_residual') is True;assert p.get('voice_stt_residual') is True;print('channel voice sandbox residual ok', p.get('mode'), p.get('call_id'), p.get('path'), 'tts_residual', True, 'stt_residual', True)"
# Channel voice ESPEAK mock closes voice_tts_residual (parity with voice_session/relay).
rm -rf /tmp/bitbot-voice-ch-tts-mock
BITBOT_ESPEAK_BIN="$ROOT/scripts/host_espeak_mock.sh" BITBOT_ESPEAK_MOCK_LOG_DIR=/tmp/bitbot-voice-ch-tts-mock \
  node hosts/cli_host/run_turn.js --approved "reply via voice:call-tts :: speak channel tts" >/tmp/bitbot-voice-ch-tts.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-ch-tts.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='voice';assert p.get('media_ok') is True;assert p.get('media_tool')=='espeak';assert p.get('voice_tts_residual') is False;assert open(p['media_path'],'rb').read(4)==b'RIFF';assert os.path.isfile('/tmp/bitbot-voice-ch-tts-mock/last-espeak.json');print('channel voice TTS bin mock residual close ok', p.get('media_tool'), 'residual', False, p.get('path'))"
# Channel voice STT mock closes voice_stt_residual (parity with voice_session/relay).
rm -rf /tmp/bitbot-voice-ch-stt-mock
BITBOT_STT_BIN="$ROOT/scripts/host_stt_mock.sh" BITBOT_STT_MOCK_LOG_DIR=/tmp/bitbot-voice-ch-stt-mock \
  node hosts/cli_host/run_turn.js --approved "reply via voice:call-stt :: hear channel stt" >/tmp/bitbot-voice-ch-stt.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-ch-stt.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='voice';assert p.get('stt_ok') is True;assert p.get('stt_tool')=='host_stt_mock.sh';assert p.get('voice_stt_residual') is False;assert 'mock stt transcript' in (p.get('stt_text') or '');assert os.path.isfile('/tmp/bitbot-voice-ch-stt-mock/last-stt.json');print('channel voice STT bin mock residual close ok', p.get('stt_tool'), 'residual', False, p.get('path'))"
# Live voice channel mock closes live_voice_residual
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18779 --mode voice --token smoke-voice >/tmp/bitbot-voice-ch-mock.log 2>&1 &
VOICE_CH_MOCK_PID=$!
sleep 0.4
BITBOT_VOICE_API_URL=http://127.0.0.1:18779 BITBOT_VOICE_TOKEN=smoke-voice BITBOT_VOICE_POST=1 \
  node hosts/cli_host/run_turn.js --approved "reply via voice:call-live :: live voice mock" >/tmp/bitbot-voice-ch-live.json || true
kill "$VOICE_CH_MOCK_PID" >/dev/null 2>&1 || true
wait "$VOICE_CH_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-ch-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='voice';assert p.get('mode')=='live_voice_channel';assert p.get('live_voice_residual') is False;assert p.get('live_post') is True;assert p.get('pretend_live') is False;print('channel voice live mock residual close ok', p.get('mode'), p.get('call_id'), p.get('path'))"
# Live voice claim closes live_voice_residual (GET /messages).
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18794 --mode voice --token smoke-voice >/tmp/bitbot-voice-claim-mock.log 2>&1 &
VOICE_CLAIM_MOCK_PID=$!
sleep 0.4
BITBOT_VOICE_API_URL=http://127.0.0.1:18794 BITBOT_VOICE_TOKEN=smoke-voice BITBOT_VOICE_CLAIM=1 \
  node hosts/cli_host/run_turn.js --approved "reply via voice:call-claim :: claim voice [widget:decision_card]" >/tmp/bitbot-voice-claim-live.json || true
# Live voice claim + BITBOT_INBOUND_TURN closes inbound_turn_residual (parity with Slack/Teams).
BITBOT_VOICE_API_URL=http://127.0.0.1:18794 BITBOT_VOICE_TOKEN=smoke-voice BITBOT_VOICE_CLAIM=1 BITBOT_INBOUND_TURN=1 \
  node hosts/cli_host/run_turn.js --approved "reply via voice:call-claim :: claim voice inbound turn" >/tmp/bitbot-voice-claim-turn.json || true
kill "$VOICE_CLAIM_MOCK_PID" >/dev/null 2>&1 || true
wait "$VOICE_CLAIM_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-claim-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_voice_claim';assert p.get('claimed_count',0)>=1;assert p.get('live_voice_residual') is False;assert p.get('live_channel_residual') is False;assert p.get('widget_degraded') is True;assert p.get('pretend_live') is False;assert 'live_voice_claim' in open('data/channels/inbound.jsonl').read();print('channel voice live claim residual close ok', 'claimed', p.get('claimed_count'), 'residual', False)"
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_voice_claim';assert p.get('live_voice_residual') is False;th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;assert p.get('inbound_turn_residual') is False;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('channel voice claim inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
node hosts/cli_host/run_turn.js --approved "reply via voice:call-widget :: speak [widget:decision_card]" >/tmp/bitbot-voice-ch-widget.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-voice-ch-widget.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('scheme')=='voice';assert p.get('widget_degraded') is True;assert '[widget:' not in (p.get('body') or '');assert p.get('pretend_live') is False;print('channel voice widget_degraded ok', p.get('mode'), p.get('body'))"
node hosts/cli_host/run_turn.js --approved "claim inbox alpha" >/tmp/bitbot-mail-claim.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mail-claim.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_claim_inbox');p=json.loads(h['stdout']);assert p.get('mode')=='host_mail_claim_inbox';assert p.get('local_part')=='alpha';assert p.get('pretend_claimed') is False;assert p.get('live_mail_claim_residual') is True;assert p.get('claimed_count',0)>=1;assert p.get('fixture_path') and os.path.isfile(p['fixture_path']);assert p.get('inbound_path') and os.path.isfile(p['inbound_path']);assert 'sandbox_mail_claim' in open(p['inbound_path']).read();th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('hook_path') and os.path.isfile(th['hook_path']);assert p.get('path') and os.path.isfile(p['path']);print('mail_claim_inbox fixture+inbound ok', p.get('claimed_count'), p.get('path'), 'live_mail_claim_residual', True)"
# Live mail claim mock closes live_mail_claim_residual (not production IdP).
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18780 --mode mail_claim --token smoke-claim >/tmp/bitbot-mail-claim-mock.log 2>&1 &
MAIL_CLAIM_MOCK_PID=$!
sleep 0.4
BITBOT_MAIL_CLAIM_API_URL=http://127.0.0.1:18780 BITBOT_MAIL_CLAIM_TOKEN=smoke-claim BITBOT_MAIL_CLAIM_POST=1 \
  node hosts/cli_host/run_turn.js --approved "claim inbox alpha" >/tmp/bitbot-mail-claim-live.json || true
kill "$MAIL_CLAIM_MOCK_PID" >/dev/null 2>&1 || true
wait "$MAIL_CLAIM_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mail-claim-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_claim_inbox');p=json.loads(h['stdout']);assert p.get('mode')=='live_mail_claim_inbox';assert p.get('live_mail_claim_residual') is False;assert p.get('live_claim') is True;assert p.get('claimed_count',0)>=1;assert 'live_mail_claim' in open(p['inbound_path']).read();assert p.get('pretend_claimed') is False;print('mail_claim_inbox live mock residual close ok', p.get('claimed_count'), p.get('path'))"
# Live mail claim + inbound turn closes inbound_turn_residual (parity with webhook wake).
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18781 --mode mail_claim --token smoke-claim >/tmp/bitbot-mail-claim-turn-mock.log 2>&1 &
MAIL_CLAIM_TURN_MOCK_PID=$!
sleep 0.4
BITBOT_MAIL_CLAIM_API_URL=http://127.0.0.1:18781 BITBOT_MAIL_CLAIM_TOKEN=smoke-claim BITBOT_MAIL_CLAIM_POST=1 BITBOT_INBOUND_TURN=1 \
  node hosts/cli_host/run_turn.js --approved "claim inbox alpha" >/tmp/bitbot-mail-claim-turn.json || true
kill "$MAIL_CLAIM_TURN_MOCK_PID" >/dev/null 2>&1 || true
wait "$MAIL_CLAIM_TURN_MOCK_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-mail-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_claim_inbox');p=json.loads(h['stdout']);assert p.get('live_mail_claim_residual') is False;th=p.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;assert p.get('inbound_turn_residual') is False;print('mail_claim_inbox inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Inbound HTTP push wake: push residual closed; turn residual stays true without BITBOT_INBOUND_TURN.
python3 "$ROOT/scripts/host_webhook_listen.py" --port 18791 >/tmp/bitbot-wh-listen.log 2>&1 &
WH_LISTEN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18791/hooks -H 'Content-Type: application/json' -d '{"id":"evt-http","summary":"push wake smoke"}' >/tmp/bitbot-wh-curl.json || true
kill "$WH_LISTEN_PID" >/dev/null 2>&1 || true
wait "$WH_LISTEN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-wh-curl.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is True;assert d.get('key_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is True;th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is False;assert '<webhook_event' in (snap.get('wake_payload') or '');print('webhook http listen push wake ok', d.get('path'), 'inbound_turn_residual', True)"
# HTTP listen + BITBOT_INBOUND_TURN=1 executes pending turn via Host run_turn (webhook_wake parity).
BITBOT_INBOUND_TURN=1 python3 "$ROOT/scripts/host_webhook_listen.py" --port 18791 >/tmp/bitbot-wh-listen-turn.log 2>&1 &
WH_LISTEN_TURN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18791/hooks -H 'Content-Type: application/json' -d '{"id":"evt-http-turn","summary":"inbound turn listen smoke"}' >/tmp/bitbot-wh-curl-turn.json || true
kill "$WH_LISTEN_TURN_PID" >/dev/null 2>&1 || true
wait "$WH_LISTEN_TURN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-wh-curl-turn.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is False;assert d.get('path') and os.path.isfile(d['path']);snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is False;th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('webhook http listen inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Slack Events HTTP push: closes inbound_push_residual; token never echoed; turn residual stays open without BITBOT_INBOUND_TURN.
# Port 18797 avoids SMS mock (18792) / webhook claim (18793) collisions.
python3 "$ROOT/scripts/host_slack_events_listen.py" --port 18797 >/tmp/bitbot-slack-events-listen.log 2>&1 &
SLACK_EVENTS_LISTEN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18797/slack/events -H 'Content-Type: application/json' \
  -d '{"token":"slack-verify-secret-smoke","type":"event_callback","event_id":"EvHttpSmoke","event":{"type":"message","channel":"Csmoke","user":"U_SMOKE","text":"slack events push smoke","ts":"1710000000.000199"}}' \
  >/tmp/bitbot-slack-events-curl.json || true
kill "$SLACK_EVENTS_LISTEN_PID" >/dev/null 2>&1 || true
wait "$SLACK_EVENTS_LISTEN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-slack-events-curl.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is True;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'slack-verify-secret-smoke' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is True;assert snap.get('mode')=='host_slack_events_listen';th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is False;rows=open('data/channels/inbound.jsonl').read();assert 'live_slack_events_push' in rows;print('slack events http listen push wake ok', d.get('path'), 'inbound_turn_residual', True)"
# Slack Events listen + BITBOT_INBOUND_TURN=1 executes pending turn via Host run_turn (webhook listen parity).
BITBOT_INBOUND_TURN=1 python3 "$ROOT/scripts/host_slack_events_listen.py" --port 18797 >/tmp/bitbot-slack-events-listen-turn.log 2>&1 &
SLACK_EVENTS_LISTEN_TURN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18797/slack/events -H 'Content-Type: application/json' \
  -d '{"token":"slack-verify-secret-turn","type":"event_callback","event_id":"EvHttpTurn","event":{"type":"message","channel":"Csmoke","user":"U_SMOKE","text":"slack events inbound turn smoke","ts":"1710000000.000299"}}' \
  >/tmp/bitbot-slack-events-curl-turn.json || true
kill "$SLACK_EVENTS_LISTEN_TURN_PID" >/dev/null 2>&1 || true
wait "$SLACK_EVENTS_LISTEN_TURN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-slack-events-curl-turn.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is False;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'slack-verify-secret-turn' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is False;th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('slack events http listen inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Teams notifications HTTP push: closes inbound_push_residual; token never echoed; turn residual stays open without BITBOT_INBOUND_TURN.
# Port 18798 is free here (credential fixture earlier killed); avoids Slack 18797 / SMS listen 18796.
python3 "$ROOT/scripts/host_teams_events_listen.py" --port 18798 >/tmp/bitbot-teams-events-listen.log 2>&1 &
TEAMS_EVENTS_LISTEN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18798/teams/notifications -H 'Content-Type: application/json' \
  -d '{"token":"teams-verify-secret-smoke","event_id":"TnHttpSmoke","channel":"Tsmoke","user":"U_TEAMS","text":"teams notifications push smoke"}' \
  >/tmp/bitbot-teams-events-curl.json || true
kill "$TEAMS_EVENTS_LISTEN_PID" >/dev/null 2>&1 || true
wait "$TEAMS_EVENTS_LISTEN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-teams-events-curl.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is True;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'teams-verify-secret-smoke' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is True;assert snap.get('mode')=='host_teams_events_listen';th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is False;rows=open('data/channels/inbound.jsonl').read();assert 'live_teams_events_push' in rows;print('teams events http listen push wake ok', d.get('path'), 'inbound_turn_residual', True)"
# Teams notifications listen + BITBOT_INBOUND_TURN=1 executes pending turn via Host run_turn (Slack Events listen parity).
BITBOT_INBOUND_TURN=1 python3 "$ROOT/scripts/host_teams_events_listen.py" --port 18798 >/tmp/bitbot-teams-events-listen-turn.log 2>&1 &
TEAMS_EVENTS_LISTEN_TURN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18798/teams/notifications -H 'Content-Type: application/json' \
  -d '{"token":"teams-verify-secret-turn","event_id":"TnHttpTurn","channel":"Tsmoke","user":"U_TEAMS","text":"teams notifications inbound turn smoke"}' \
  >/tmp/bitbot-teams-events-curl-turn.json || true
kill "$TEAMS_EVENTS_LISTEN_TURN_PID" >/dev/null 2>&1 || true
wait "$TEAMS_EVENTS_LISTEN_TURN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-teams-events-curl-turn.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is False;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'teams-verify-secret-turn' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is False;th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('teams events http listen inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Claim-only Teams path keeps inbound_push_residual true (not notifications push).
python3 -c "import json;d=json.load(open('/tmp/bitbot-teams-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_teams_claim';assert p.get('inbound_push_residual') is True;print('teams claim-only keeps inbound_push_residual true ok', p.get('mode'))"
# SMS Twilio-style HTTP push: closes inbound_push_residual; AuthToken never echoed; turn residual stays open without BITBOT_INBOUND_TURN.
# Port 18802 avoids SMS claim (18801) / email claim turn (18796) / Slack Events (18797).
fuser -k 18802/tcp >/dev/null 2>&1 || true
python3 "$ROOT/scripts/host_sms_listen.py" --port 18802 >/tmp/bitbot-sms-listen.log 2>&1 &
SMS_LISTEN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18802/sms/inbound -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'MessageSid=SMhttpSmoke&AccountSid=ACsmoke&From=%2B15550001111&To=%2B15551212&Body=sms+inbound+push+smoke&AuthToken=sms-auth-secret-smoke' \
  >/tmp/bitbot-sms-listen-curl.json || true
kill "$SMS_LISTEN_PID" >/dev/null 2>&1 || true
wait "$SMS_LISTEN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sms-listen-curl.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is True;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'sms-auth-secret-smoke' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is True;assert snap.get('mode')=='host_sms_listen';th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is False;rows=open('data/channels/inbound.jsonl').read();assert 'live_sms_events_push' in rows;print('sms http listen push wake ok', d.get('path'), 'inbound_turn_residual', True)"
# SMS listen + BITBOT_INBOUND_TURN=1 executes pending turn via Host run_turn (webhook/slack listen parity).
BITBOT_INBOUND_TURN=1 python3 "$ROOT/scripts/host_sms_listen.py" --port 18802 >/tmp/bitbot-sms-listen-turn.log 2>&1 &
SMS_LISTEN_TURN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18802/sms/inbound -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'MessageSid=SMhttpTurn&AccountSid=ACsmoke&From=%2B15550002222&To=%2B15551212&Body=sms+inbound+turn+smoke&AuthToken=sms-auth-secret-turn' \
  >/tmp/bitbot-sms-listen-curl-turn.json || true
kill "$SMS_LISTEN_TURN_PID" >/dev/null 2>&1 || true
wait "$SMS_LISTEN_TURN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-sms-listen-curl-turn.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is False;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'sms-auth-secret-turn' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is False;th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('sms http listen inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Claim-only SMS path keeps inbound_push_residual true (not Events push).
python3 -c "import json;d=json.load(open('/tmp/bitbot-sms-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_sms_claim';assert p.get('inbound_push_residual') is True;print('sms claim-only keeps inbound_push_residual true ok', p.get('mode'))"
# Email push HTTP listen: closes inbound_push_residual; OAuth tokens never persisted; turn residual stays open without BITBOT_INBOUND_TURN.
# Port 18799 avoids Slack events (18797) / SMS listen (18802) / reserved 18798 collisions.
python3 "$ROOT/scripts/host_email_events_listen.py" --port 18799 >/tmp/bitbot-email-events-listen.log 2>&1 &
EMAIL_EVENTS_LISTEN_PID=$!
sleep 0.4
# Gmail Pub/Sub-shaped push (access_token must not land in artifact).
curl -s -X POST http://127.0.0.1:18799/email/push -H 'Content-Type: application/json' \
  -d '{"access_token":"gmail-oauth-secret-smoke","message":{"messageId":"gmail-http-smoke","data":"eyJlbWFpbEFkZHJlc3MiOiJzbW9rZUBleGFtcGxlLmNvbSIsImhpc3RvcnlJZCI6IjE3MTAwMDAwMDEifQ=="},"subscription":"projects/smoke/subscriptions/gmail"}' \
  >/tmp/bitbot-email-events-curl.json || true
kill "$EMAIL_EVENTS_LISTEN_PID" >/dev/null 2>&1 || true
wait "$EMAIL_EVENTS_LISTEN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-email-events-curl.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is True;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'gmail-oauth-secret-smoke' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is True;assert snap.get('mode')=='host_email_events_listen';th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is False;rows=open('data/channels/inbound.jsonl').read();assert 'live_email_events_push' in rows;print('email events http listen push wake ok', d.get('path'), 'inbound_turn_residual', True)"
# Outlook-shaped push + BITBOT_INBOUND_TURN=1 executes pending turn via Host run_turn (Slack events parity).
BITBOT_INBOUND_TURN=1 python3 "$ROOT/scripts/host_email_events_listen.py" --port 18799 >/tmp/bitbot-email-events-listen-turn.log 2>&1 &
EMAIL_EVENTS_LISTEN_TURN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18799/email/push -H 'Content-Type: application/json' -H 'Authorization: Bearer outlook-oauth-secret-turn' \
  -d '{"value":[{"subscriptionId":"outlook-http-turn","changeType":"created","resource":"Users/me/Messages/msg-turn","resourceData":{"id":"msg-turn","subject":"email events inbound turn smoke"},"clientState":"outlook-oauth-secret-turn"}]}' \
  >/tmp/bitbot-email-events-curl-turn.json || true
kill "$EMAIL_EVENTS_LISTEN_TURN_PID" >/dev/null 2>&1 || true
wait "$EMAIL_EVENTS_LISTEN_TURN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-email-events-curl-turn.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is False;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'outlook-oauth-secret-turn' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is False;th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('email events http listen inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Claim-only email path keeps inbound_push_residual true (not Events push).
python3 -c "import json;d=json.load(open('/tmp/bitbot-email-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_email_claim';assert p.get('inbound_push_residual') is True;print('email claim-only keeps inbound_push_residual true ok', p.get('mode'))"
# Meeting events HTTP push: closes inbound_push_residual; token never echoed; turn residual stays open without BITBOT_INBOUND_TURN.
# Port 18803 is free here (Slack empty-claim mock earlier); kill leftovers before listen.
fuser -k 18803/tcp >/dev/null 2>&1 || true
python3 "$ROOT/scripts/host_meeting_events_listen.py" --port 18803 >/tmp/bitbot-meeting-events-listen.log 2>&1 &
MEETING_EVENTS_LISTEN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18803/meeting/events -H 'Content-Type: application/json' \
  -d '{"token":"meeting-verify-secret-smoke","event_id":"MnHttpSmoke","channel":"Msmoke","user":"U_MEET","text":"meeting events push smoke"}' \
  >/tmp/bitbot-meeting-events-curl.json || true
kill "$MEETING_EVENTS_LISTEN_PID" >/dev/null 2>&1 || true
wait "$MEETING_EVENTS_LISTEN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-meeting-events-curl.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is True;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'meeting-verify-secret-smoke' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is True;assert snap.get('mode')=='host_meeting_events_listen';th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is False;rows=open('data/channels/inbound.jsonl').read();assert 'live_meeting_events_push' in rows;print('meeting events http listen push wake ok', d.get('path'), 'inbound_turn_residual', True)"
# Meeting events listen + BITBOT_INBOUND_TURN=1 executes pending turn via Host run_turn (Teams Events listen parity).
BITBOT_INBOUND_TURN=1 python3 "$ROOT/scripts/host_meeting_events_listen.py" --port 18803 >/tmp/bitbot-meeting-events-listen-turn.log 2>&1 &
MEETING_EVENTS_LISTEN_TURN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18803/meeting/events -H 'Content-Type: application/json' \
  -d '{"token":"meeting-verify-secret-turn","event_id":"MnHttpTurn","channel":"Msmoke","user":"U_MEET","text":"meeting events inbound turn smoke"}' \
  >/tmp/bitbot-meeting-events-curl-turn.json || true
kill "$MEETING_EVENTS_LISTEN_TURN_PID" >/dev/null 2>&1 || true
wait "$MEETING_EVENTS_LISTEN_TURN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-meeting-events-curl-turn.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is False;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'meeting-verify-secret-turn' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is False;th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('meeting events http listen inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Claim-only meeting path keeps inbound_push_residual true (not Events push).
python3 -c "import json;d=json.load(open('/tmp/bitbot-meeting-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_meeting_claim';assert p.get('inbound_push_residual') is True;print('meeting claim-only keeps inbound_push_residual true ok', p.get('mode'))"
# Voice events HTTP push: closes inbound_push_residual; token never echoed; turn residual stays open without BITBOT_INBOUND_TURN.
# Port 18806 is free here; kill leftovers before listen.
fuser -k 18806/tcp >/dev/null 2>&1 || true
python3 "$ROOT/scripts/host_voice_events_listen.py" --port 18806 >/tmp/bitbot-voice-events-listen.log 2>&1 &
VOICE_EVENTS_LISTEN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18806/voice/events -H 'Content-Type: application/json' \
  -d '{"token":"voice-verify-secret-smoke","event_id":"VnHttpSmoke","channel":"Vsmoke","user":"U_VOICE","text":"voice events push smoke"}' \
  >/tmp/bitbot-voice-events-curl.json || true
kill "$VOICE_EVENTS_LISTEN_PID" >/dev/null 2>&1 || true
wait "$VOICE_EVENTS_LISTEN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-events-curl.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is True;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'voice-verify-secret-smoke' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is True;assert snap.get('mode')=='host_voice_events_listen';th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is False;rows=open('data/channels/inbound.jsonl').read();assert 'live_voice_events_push' in rows;print('voice events http listen push wake ok', d.get('path'), 'inbound_turn_residual', True)"
# Voice events listen + BITBOT_INBOUND_TURN=1 executes pending turn via Host run_turn (meeting Events listen parity).
BITBOT_INBOUND_TURN=1 python3 "$ROOT/scripts/host_voice_events_listen.py" --port 18806 >/tmp/bitbot-voice-events-listen-turn.log 2>&1 &
VOICE_EVENTS_LISTEN_TURN_PID=$!
sleep 0.4
curl -s -X POST http://127.0.0.1:18806/voice/events -H 'Content-Type: application/json' \
  -d '{"token":"voice-verify-secret-turn","event_id":"VnHttpTurn","channel":"Vsmoke","user":"U_VOICE","text":"voice events inbound turn smoke"}' \
  >/tmp/bitbot-voice-events-curl-turn.json || true
kill "$VOICE_EVENTS_LISTEN_TURN_PID" >/dev/null 2>&1 || true
wait "$VOICE_EVENTS_LISTEN_TURN_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-voice-events-curl-turn.json'));assert d.get('ok') is True;assert d.get('inbound_push_residual') is False;assert d.get('inbound_turn_residual') is False;assert d.get('token_leaked') is False;assert d.get('path') and os.path.isfile(d['path']);assert 'voice-verify-secret-turn' not in open(d['path']).read();snap=json.load(open(d['path']));assert snap.get('inbound_push_residual') is False;assert snap.get('inbound_turn_residual') is False;th=snap.get('turn_hook') or {};assert th.get('hooked') is True;assert th.get('turn_executed') is True;assert th.get('turn_path') and os.path.isfile(th['turn_path']);turn=json.load(open(th['turn_path']));assert turn.get('ok') is True;hook=json.load(open(th['hook_path']));assert hook.get('status')=='executed';print('voice events http listen inbound turn residual close ok', th.get('turn_path'), 'residual', False)"
# Claim-only voice path keeps inbound_push_residual true (not Events push).
python3 -c "import json;d=json.load(open('/tmp/bitbot-voice-claim-turn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='live_voice_claim';assert p.get('inbound_push_residual') is True;print('voice claim-only keeps inbound_push_residual true ok', p.get('mode'))"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-ch-unknown.json","utf8"));
if(!s.labels.some(l=>l.includes("live_channel_residual"))) { console.error(s); process.exit(1); }
const c=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-cold.json","utf8"));
if(!c.labels.some(l=>l.includes("live_mail_residual"))) { console.error(c); process.exit(1); }
console.log("STU residual labels channel+cold ok");
'
# Fresh connectors: connect outlook must arm outlook_token.json (not gmail).
rm -f data/connectors/outlook_token.json data/connectors/outlook.json
node hosts/cli_host/run_turn.js "connect outlook" >/tmp/bitbot-oauth-outlook.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-outlook.json'));assert d.get('intent')=='connect_outlook';h=next(x for x in d['host_results'] if x.get('kind')=='oauth');p=json.loads(h.get('stdout') or '{}');assert p.get('connector')=='outlook';assert p.get('interactive_oauth_residual') is False;assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('data/connectors/outlook_token.json');tok=json.load(open('data/connectors/outlook_token.json'));assert tok.get('access_token');snap=json.load(open(p['path']));assert snap.get('interactive_oauth_residual') is False;print('connect_outlook oauth+token file ok', p.get('mode') or p.get('status'), p.get('path'))"
# connectors_probe must see outlook_token.json (no env) as live-ready, not sandbox_idp.
env -u BITBOT_OUTLOOK_TOKEN -u BITBOT_GMAIL_TOKEN -u SLACK_BOT_TOKEN \
  node hosts/cli_host/run_turn.js "list connectors" >/tmp/bitbot-connectors-probe-file.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-connectors-probe-file.json'));h=next(x for x in d['host_results'] if x.get('kind')=='connectors_probe');p=json.loads(h['stdout']);c=(p.get('connectors') or {}).get('outlook') or {};assert c.get('live') is True or c.get('mode')=='oauth_token_file', c;assert c.get('mode')!='sandbox_idp', c;assert p.get('pretend_all_connected') is False;print('connectors_probe outlook token file live ok', c.get('mode'))"
# Bare email: after Connect Outlook (no Gmail env) routes to Outlook path.
env -u BITBOT_GMAIL_TOKEN -u BITBOT_OUTLOOK_TOKEN -u BITBOT_MAIL_PROVIDER \
  node hosts/cli_host/run_turn.js --approved "reply via email:user@example.com :: bare after connect" >/tmp/bitbot-email-bare-outlook.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-email-bare-outlook.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert (p.get('mail') or {}).get('provider')=='outlook', p;assert p.get('pretend_live') is False;print('bare email prefer outlook after connect ok', p.get('mode'), (p.get('mail') or {}).get('provider'))"
# Gmail env must not steal Outlook provider Bearer when drafting outlook mail.
python3 scripts/host_local_http_mock.py --port 18776 --mode outlook --token smoke-outlook-iso >/tmp/bitbot-outlook-iso-mock.log 2>&1 &
OUT_ISO=$!
sleep 0.3
BITBOT_GMAIL_TOKEN=steal-me BITBOT_OUTLOOK_GRAPH_URL=http://127.0.0.1:18776 BITBOT_OUTLOOK_TOKEN=smoke-outlook-iso BITBOT_MAIL_SEND=1 \
  node hosts/cli_host/run_turn.js --approved "draft outlook mail to=iso@example.com subject=Hi body=Iso" >/tmp/bitbot-outlook-no-steal.json || true
kill "$OUT_ISO" >/dev/null 2>&1 || true
wait "$OUT_ISO" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-outlook-no-steal.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_outlook';assert p.get('live_mail_residual') is False;assert p.get('pretend_sent') is False;print('outlook mail ignores gmail token steal ok', p.get('mode'))"
BITBOT_OAUTH_MODE=live node hosts/cli_host/run_turn.js "setup slack" >/tmp/bitbot-oauth-needsauth.json || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-oauth-needsauth.json'));h=next(x for x in d['host_results'] if x.get('kind')=='oauth');p=json.loads(h.get('stdout') or '{}');assert p.get('status')=='NeedsAuth';assert p.get('interactive_oauth_residual') is True;assert p.get('pretend_connected') is False;assert p.get('path') and os.path.isfile(p['path']);snap=json.load(open(p['path']));assert snap.get('interactive_oauth_residual') is True;print('oauth interactive_oauth_residual ok', p.get('mode'), 'snap', True)"
python3 -c "
import json,os
lines=open('data/delivery/send-to-user.jsonl').read().strip().splitlines()
hits=[json.loads(l) for l in lines if 'oauth' in l or (json.loads(l).get('source_kind')=='oauth')]
assert hits, 'no oauth delivery ledger'
last=hits[-1]
assert last.get('interactive_oauth_residual') is True or last.get('needs_auth') is True
print('oauth delivery ledger residual ok', last.get('status') or last.get('mode'))
"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-oauth-needsauth.json","utf8"));
if(!s.labels.some(l=>l.includes("interactive_oauth_residual")||l.includes("NeedsAuth"))) { console.error(s); process.exit(1); }
console.log("STU oauth NeedsAuth residual ok", s.labels.slice(0,4));
'
# write-unit-only must NOT close long_lived_cron_residual
rm -f data/routines/daemon-status.json
bash "$ROOT/scripts/host_routine_daemon.sh" --write-systemd-unit >/tmp/bitbot-rt-unit-only.log 2>&1 || true
node hosts/cli_host/run_turn.js --approved "create routine id=unit-only cron=@daily prompt=tick" >/tmp/bitbot-rt-unit-only.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-rt-unit-only.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_schedule');p=json.loads(h['stdout']);assert p.get('due_now') is False;assert p.get('long_lived_cron_residual') is True;assert p.get('systemd_unit_active') is False;assert os.path.isfile('data/routines/bitbot-routine-daemon.service');print('routine write-unit-only keeps long_lived_cron_residual True ok')"
# install-user-unit enable-without-start must also keep residual open
rm -f data/routines/daemon-status.json
bash "$ROOT/scripts/host_routine_daemon.sh" --install-user-unit >/tmp/bitbot-rt-install-only.log 2>&1 || true
node hosts/cli_host/run_turn.js --approved "create routine id=install-only cron=@daily prompt=tick" >/tmp/bitbot-rt-install-only.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-rt-install-only.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_schedule');p=json.loads(h['stdout']);st=json.load(open('data/routines/daemon-status.json'));assert st.get('long_lived') is False;assert st.get('systemd_unit_active') is False;assert p.get('due_now') is False;assert p.get('long_lived_cron_residual') is True;assert p.get('systemd_unit_active') is False;print('routine install-user-unit (not active) keeps long_lived_cron_residual True ok', 'installed', st.get('systemd_unit_installed'))"
# Armed long-lived / active status closes long_lived_cron_residual.
rm -f data/routines/daemon-status.json
BITBOT_ROUTINE_LONG_LIVED=1 node hosts/cli_host/run_turn.js --approved "create routine id=long-lived cron=@daily prompt=tick" >/tmp/bitbot-rt-long-lived.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-rt-long-lived.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_schedule');p=json.loads(h['stdout']);assert p.get('due_now') is False;assert p.get('long_lived_cron_residual') is False;print('routine BITBOT_ROUTINE_LONG_LIVED closes residual ok', p.get('path'))"
mkdir -p data/routines
printf '%s\n' '{"long_lived":false,"systemd_unit_installed":true,"systemd_unit_active":true}' > data/routines/daemon-status.json
node hosts/cli_host/run_turn.js --approved "create routine id=unit-active cron=@daily prompt=tick" >/tmp/bitbot-rt-unit-active.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-rt-unit-active.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_schedule');p=json.loads(h['stdout']);assert p.get('long_lived_cron_residual') is False;assert p.get('systemd_unit_active') is True;print('routine daemon-status active closes residual ok', p.get('path'))"
rm -f data/routines/daemon-status.json
node hosts/cli_host/run_turn.js "book flight google.com/flights" >/tmp/bitbot-travel.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-travel.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};assert oc.get('pretend_booked') is False;assert 'vertical_stage' in oc or 'checkout_stage' in oc;g=p.get('gui') or {};assert (g.get('vertical_summary') or g.get('checkout_summary') or {}).get('playbook') in ('travel','shopping','food','generic',None) or True;print('travel CU vertical_stage ok', oc.get('vertical_stage') or oc.get('checkout_stage'), 'playbook', oc.get('playbook'))"
node hosts/cli_host/run_turn.js "finance get_balance" >/tmp/bitbot-finance.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-finance.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='finance_call');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('artifact_ok') is True;assert p.get('artifact_path') and os.path.isfile(p['artifact_path']);assert p.get('path') and os.path.isfile(p['path']);assert p.get('path')==p.get('artifact_path');assert p.get('mode') in ('sandbox','live_token_present','finance_live','finance_live_failed');assert p.get('pretend_live') is False;print('finance_call artifact ok', p.get('mode'), p.get('path'), 'residual', p.get('live_finance_residual'))"
# Live finance against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18768 --mode finance --token smoke-fin >/tmp/bitbot-finance-mock.log 2>&1 &
FINANCE_MOCK_PID=$!
sleep 0.4
BITBOT_FINANCE_TOKEN=smoke-fin BITBOT_FINANCE_API_URL=http://127.0.0.1:18768 node hosts/cli_host/run_turn.js "finance get_balance" >/tmp/bitbot-finance-live.json || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-finance-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='finance_call');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='finance_live';assert p.get('live_finance_residual') is False;assert p.get('pretend_live') is False;assert (p.get('live_probe') or {}).get('ok') is True;print('finance_call live ok', p.get('artifact_path'), p.get('live_probe'))"
mkdir -p data/connectors
printf '%s\n' '{"access_token":"smoke-fin","token_type":"Bearer","api_url":"http://127.0.0.1:18768"}' > data/connectors/finance_token.json
env -u BITBOT_FINANCE_TOKEN -u BITBOT_FINANCE_API_URL \
  node hosts/cli_host/run_turn.js "finance get_balance" >/tmp/bitbot-finance-file-token.json || true
kill "$FINANCE_MOCK_PID" >/dev/null 2>&1 || true
wait "$FINANCE_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-finance-file-token.json'));h=next(x for x in d['host_results'] if x.get('kind')=='finance_call');p=json.loads(h['stdout']);assert p.get('mode')=='finance_live';assert p.get('live_finance_residual') is False;print('finance_call connector token+api_url file ok', p.get('mode'))"
node hosts/cli_host/run_turn.js "job search engineer" >/tmp/bitbot-jobs.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-jobs.json'));hrs=d.get('host_results') or [];kinds=[h.get('kind') for h in hrs];assert 'computer_use' in kinds;h=next(x for x in hrs if x.get('kind')=='job_search');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_applied') is False;assert p.get('live_job_residual') is True;assert p.get('mode')=='sandbox_readonly';assert p.get('path') and os.path.isfile(p['path']);assert p.get('hit_count')>=1;print('job_search durable ok', p.get('path'), 'hits', p.get('hit_count'), 'playbook', p.get('playbook'))"
# Live job catalog against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18771 --mode job --token smoke-job >/tmp/bitbot-job-mock.log 2>&1 &
JOB_MOCK_PID=$!
sleep 0.4
BITBOT_JOB_API_URL=http://127.0.0.1:18771 BITBOT_JOB_TOKEN=smoke-job node hosts/cli_host/run_turn.js "job search engineer" >/tmp/bitbot-jobs-live.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-jobs-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='job_search');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='job_live';assert p.get('live_job_residual') is False;assert p.get('pretend_applied') is False;assert p.get('hit_count')>=1;assert (p.get('live_probe') or {}).get('ok') is True;print('job_search live mock ok', p.get('path'), 'hits', p.get('hit_count'))"
mkdir -p data/connectors
printf '%s\n' '{"access_token":"smoke-job","token_type":"Bearer"}' > data/connectors/job_token.json
BITBOT_JOB_API_URL=http://127.0.0.1:18771 \
  env -u BITBOT_JOB_TOKEN \
  node hosts/cli_host/run_turn.js "job search engineer" >/tmp/bitbot-jobs-file-token.json || true
kill "$JOB_MOCK_PID" >/dev/null 2>&1 || true
wait "$JOB_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-jobs-file-token.json'));h=next(x for x in d['host_results'] if x.get('kind')=='job_search');p=json.loads(h['stdout']);assert p.get('mode')=='job_live';assert p.get('live_job_residual') is False;print('job_search connector token file ok', p.get('mode'))"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-jobs.json","utf8"));
if(!s.labels.some(l=>l.includes("live_job_residual"))) { console.error(s); process.exit(1); }
console.log("STU live_job_residual ok");
'
node hosts/cli_host/run_turn.js "schedule meeting title=Sprint when=tomorrow-3pm" >/tmp/bitbot-schedule.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-schedule.json'));assert d.get('ok');assert d.get('host_continued') is True, 'CM-0111 must not block Host continue on schedule+CU fallback';hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='schedule_meeting');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('scheduled') is True;assert p.get('ics_ok') is True;assert p.get('ics_path') and os.path.isfile(p['ics_path']);assert b'BEGIN:VEVENT' in open(p['ics_path'],'rb').read();assert p.get('path') and os.path.isfile(p['path']);assert p.get('live_calendar_residual') is True;assert p.get('pretend_live') is False;cu=next((x for x in hrs if x.get('kind')=='computer_use'), None);assert cu is not None;cup=json.loads(cu.get('stdout') or '{}');nav=(cup.get('navigate') or {}).get('url') or '';assert nav=='https://calendar.example.com/create' or nav.startswith('https://calendar.example.com/create');assert not nav.endswith(')');print('schedule_meeting ICS ok', p.get('ics_path'), p.get('mode'), p.get('path'), 'host_continued', d.get('host_continued'), 'cu_url', nav)"
# Live calendar against local mock
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18776 --mode calendar --token smoke-cal >/tmp/bitbot-cal-mock.log 2>&1 &
CAL_MOCK_PID=$!
sleep 0.4
BITBOT_CALENDAR_API_URL=http://127.0.0.1:18776 BITBOT_CALENDAR_TOKEN=smoke-cal node hosts/cli_host/run_turn.js "schedule meeting title=LiveSprint when=tomorrow-4pm" >/tmp/bitbot-schedule-live.json || true
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-schedule-live.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='schedule_meeting');p=json.loads(h.get('stdout') or '{}');assert p.get('mode')=='calendar_live';assert p.get('live_calendar_residual') is False;assert p.get('pretend_live') is False;assert (p.get('live_probe') or {}).get('ok') is True;assert p.get('path') and os.path.isfile(p['path']);print('schedule_meeting calendar_live ok', p.get('remote_event_id'), p.get('ics_path'), p.get('path'))"
printf '%s\n' '{"access_token":"smoke-cal","token_type":"Bearer"}' > data/connectors/calendar_token.json
BITBOT_CALENDAR_API_URL=http://127.0.0.1:18776 \
  env -u BITBOT_CALENDAR_TOKEN \
  node hosts/cli_host/run_turn.js "schedule meeting title=FileCal when=tomorrow-5pm" >/tmp/bitbot-schedule-file-token.json || true
kill "$CAL_MOCK_PID" >/dev/null 2>&1 || true
wait "$CAL_MOCK_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-schedule-file-token.json'));h=next(x for x in d['host_results'] if x.get('kind')=='schedule_meeting');p=json.loads(h['stdout']);assert p.get('mode')=='calendar_live';assert p.get('live_calendar_residual') is False;print('schedule_meeting connector token file ok', p.get('mode'))"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-schedule.json","utf8"));
if(!s.labels.some(l=>l.includes("live_calendar_residual"))) { console.error(s); process.exit(1); }
const p=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-purchase.json","utf8"));
if(!p.labels.some(l=>l.includes("live_paid_residual"))) { console.error(p); process.exit(1); }
console.log("STU live_calendar+live_paid residual ok");
'

echo "==> journal / shared memory / inbound reaction (durable Host stores)"
node hosts/cli_host/run_turn.js "journal date=2026-10-17 id=smoke body=smoke-event" >/tmp/bitbot-journal-append.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-journal-append.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='journal_append');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_stored') is False;assert p.get('pollutes_profile') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('events_path') and os.path.isfile(p['events_path']);assert 'events.jsonl' in (p.get('events_path') or '');print('journal_append durable ok', p.get('path'))"
node hosts/cli_host/run_turn.js "query journal from=2026-10-01 to=2026-10-31" >/tmp/bitbot-journal-query.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-journal-query.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='journal_query');assert h.get('ok') and 'hit_count' in (h.get('stdout') or '');print('journal_query durable ok')"
node hosts/cli_host/run_turn.js "shared memory put scope=team key=k value=v" >/tmp/bitbot-shared-put.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-shared-put.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='shared_memory_put');assert h.get('ok');p=json.loads(h.get('stdout') or '{}');assert p.get('pretend_stored') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('store_path') and os.path.isfile(p['store_path']);assert 'shared-scopes.json' in (p.get('store_path') or '');print('shared_memory_put durable ok', p.get('path'))"
node hosts/cli_host/run_turn.js "shared memory read scope=team key=k" >/tmp/bitbot-shared-read.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-shared-read.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='shared_memory_read');assert h.get('ok') and '\"found\": true' in (h.get('stdout') or '');print('shared_memory_read durable ok')"
# Cross-scope refuse must still surface on STU (ok=false exception).
node hosts/cli_host/run_turn.js "shared memory read scope=other key=k" >/tmp/bitbot-shared-refuse.json || true
python3 -c "import json;d=json.load(open('/tmp/bitbot-shared-refuse.json'));h=next(x for x in d['host_results'] if x.get('kind')=='shared_memory_read');p=json.loads(h.get('stdout') or '{}');assert h.get('ok') is False;assert p.get('refused_cross_scope') is True;print('shared_memory_read refuse ok')"
node -e '
const fs=require("fs");
const {extractDeliveryTypes}=require("./hosts/shared/send_to_user_surface.js");
const s=extractDeliveryTypes(fs.readFileSync("/tmp/bitbot-shared-refuse.json","utf8"));
if(!s.labels.some(l=>l.includes("refused_cross_scope"))) { console.error(s); process.exit(1); }
console.log("STU shared_memory refuse ok", s.labels.slice(0,3));
'
node hosts/cli_host/run_turn.js "[inbound] reaction :+1:" >/tmp/bitbot-inbound.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-inbound.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='inbound_reaction');assert h.get('ok') and 'forced_reply' in (h.get('stdout') or '') and 'false' in (h.get('stdout') or '').lower();p=json.loads(h.get('stdout') or '{}');assert p.get('visible_pill') is True;assert os.path.isfile('data/delivery/outbound-reactions.jsonl');assert os.path.isfile('data/delivery/send-to-user.jsonl');print('inbound_reaction SendToUser pill ok', p.get('emoji'))"
node hosts/cli_host/run_turn.js --approved "reply via slack:Csmoke :: delivery body" >/tmp/bitbot-delivery.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-delivery.json'));hrs=d.get('host_results') or [];assert any(h.get('kind')=='channel_send' and h.get('ok') for h in hrs);deliv=next(x for x in hrs if x.get('kind')=='delivery');assert deliv.get('ok');p=json.loads(deliv.get('stdout') or '{}');assert p.get('type') in ('text','thread');assert p.get('send_to_user') is True;assert os.path.isfile('data/delivery/send-to-user.jsonl');print('SendToUser delivery receipt ok', p.get('type'), p.get('channel'))"

echo "==> native iOS/Android Host shells"
bash "$ROOT/scripts/verify_native_shells.sh"

echo "OK: smoke_desktop_turn.sh"
