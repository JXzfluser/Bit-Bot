#!/usr/bin/env bash
# End-to-end Grok-parity scenario smoke (product MoonBit + Host FFI; not LocalBrain).
# Proves CHARTER Delivery SendToUser coverage across a multi-turn script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
RUN=(node hosts/cli_host/run_turn.js)
MOBILE=(node hosts/mobile_host/run.js)

echo "==> Grok parity scenario: multi-turn SendToUser + multi-end"

# Drop stale local mocks/fixtures from prior smokes (fixed ports).
pkill -f 'scripts/host_local_http_mock.py' >/dev/null 2>&1 || true
pkill -f 'scripts/host_cu_checkout_fixture.py' >/dev/null 2>&1 || true
sleep 0.2

# Fresh delivery ledger snapshot marker
MARKER="parity-scenario-$(date +%s)"
mkdir -p data/delivery
echo "{\"marker\":\"$MARKER\"}" >> data/delivery/send-to-user.jsonl

# 1) Text channel delivery + Slack thread_ts form (SendToUser type=thread)
"${RUN[@]}" --approved "reply via slack:Csmoke :: parity channel $MARKER" >/tmp/parity-channel.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-channel.json'));assert d.get('ok');hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send' and x.get('ok'));p=json.loads(h['stdout']);assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv['stdout']);assert dp.get('type')=='text';print('parity channel+text delivery ok', dp.get('type'), p.get('path'))"
"${RUN[@]}" --approved "reply via slack:Csmoke thread_ts=1700000000.000100 :: parity thread $MARKER" >/tmp/parity-channel-thread.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-channel-thread.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('thread_ts')=='1700000000.000100';assert 'thread' in str(p.get('mode') or '');assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv['stdout']);assert dp.get('type')=='thread';print('parity slack thread_ts delivery ok', p.get('mode'), dp.get('type'), p.get('path'))"

# 2) Attachment (schedule ICS)
"${RUN[@]}" "schedule meeting title=Parity when=tomorrow" >/tmp/parity-ics.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-ics.json'));h=next(x for x in d['host_results'] if x.get('kind')=='schedule_meeting');p=json.loads(h['stdout']);assert p.get('ics_ok') and os.path.isfile(p['ics_path']);assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_live') is False;print('parity attachment ics ok', p.get('path'))"

# 3) Widget (approval CM-0105 Approve/Dismiss)
"${RUN[@]}" "shell echo parity-approve" >/tmp/parity-widget.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-widget.json'));h=next(x for x in d['host_results'] if x.get('kind')=='approval_card');p=json.loads(h['stdout']);w=p.get('widget')or{};assert w.get('widget_id');opts=w.get('options')or[];assert any(o.get('id')=='approve' for o in opts);assert any(o.get('id')=='dismiss' for o in opts);assert p.get('pretend_approved') is False;assert p.get('path') and os.path.isfile(p['path']);deliv=next(x for x in d['host_results'] if x.get('kind')=='delivery');dp=json.loads(deliv['stdout']);assert dp.get('type')=='widget';print('parity approval_card CM-0105 ok', w.get('widget_id'), 'options', [o.get('id') for o in opts])"

# 4) Reaction pill
"${RUN[@]}" "[inbound] reaction :+1:" >/tmp/parity-reaction.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-reaction.json'));h=next(x for x in d['host_results'] if x.get('kind')=='inbound_reaction');p=json.loads(h['stdout']);assert p.get('visible_pill') is True;assert p.get('forced_reply') is False;assert p.get('pretend_forced_reply') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('send_to_user_type')=='reaction' or (p.get('outbound_reaction') or {}).get('type')=='reaction';print('parity reaction ok', p.get('emoji'), p.get('path'))"

# 5) Voice
"${RUN[@]}" "voice start parity1" >/tmp/parity-voice.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-voice.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_session');p=json.loads(h['stdout']);assert p.get('media_ok') is True and os.path.isfile(p.get('media_path') or '');assert p.get('pretend_live') is False;assert p.get('pretend_media') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('sessions_path') and os.path.isfile(p['sessions_path']);print('parity voice ok', p.get('path'))"

# 6) Credentials metadata (no secrets)
"${RUN[@]}" "list credentials" >/tmp/parity-creds.json
python3 -c "import json;d=json.load(open('/tmp/parity-creds.json'));assert d.get('intent')=='list_credentials';h=next(x for x in d['host_results'] if x.get('kind')=='credential_list');p=json.loads(h['stdout']);assert p.get('secret_echoed') is False;assert p.get('pretend_secret_view') is False;assert p.get('count')>=1;blob=json.dumps(p);assert 'vault:secret' not in blob.lower();print('parity credentials metadata ok', p.get('count'))"

# 7) Source-control plan artifact (real create gated)
"${RUN[@]}" "source control create_pr" >/tmp/parity-sc.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sc.json'));h=next(x for x in d['host_results'] if x.get('kind')=='source_control');p=json.loads(h['stdout']);assert p.get('pretend_remote_pr') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('status_path') and os.path.isfile(p['status_path']);rp=p.get('remote_pr') or {};assert rp.get('plan_path') and os.path.isfile(rp['plan_path']);plan=json.load(open(rp['plan_path']));assert plan.get('pretend_remote_pr') is False;assert plan.get('real_create_gated') is True or rp.get('real_create_gated') is True or p.get('remote_pr_residual') is True;print('parity source_control plan ok', rp.get('mode'), rp.get('plan_path'), p.get('path'))"

# 7b) Gated PR create path via injectable gh mock (dry-run then BITBOT_GH_PR_CREATE=1)
rm -rf /tmp/parity-gh-mock-dry /tmp/parity-gh-mock-real
mkdir -p /tmp/parity-gh-mock-dry /tmp/parity-gh-mock-real
BITBOT_GH_BIN="$ROOT/scripts/host_gh_mock.sh" BITBOT_GH_MOCK_LOG_DIR=/tmp/parity-gh-mock-dry BITBOT_GH_CREATE_PR=1 \
  "${RUN[@]}" "source control create_pr" >/tmp/parity-sc-dry.json
python3 -c "import json;d=json.load(open('/tmp/parity-sc-dry.json'));h=next(x for x in d['host_results'] if x.get('kind')=='source_control');p=json.loads(h['stdout']);rp=p.get('remote_pr') or {};assert rp.get('mode')=='gh_pr_create_dry_run';assert rp.get('real_create_gated') is True;assert p.get('pretend_remote_pr') is False;print('parity sc dry-run create ok')"
BITBOT_GH_BIN="$ROOT/scripts/host_gh_mock.sh" BITBOT_GH_MOCK_LOG_DIR=/tmp/parity-gh-mock-real BITBOT_GH_CREATE_PR=1 BITBOT_GH_PR_CREATE=1 \
  "${RUN[@]}" "source control create_pr" >/tmp/parity-sc-real.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sc-real.json'));h=next(x for x in d['host_results'] if x.get('kind')=='source_control');p=json.loads(h['stdout']);rp=p.get('remote_pr') or {};assert rp.get('mode')=='gh_pr_create';assert rp.get('dry_run') is False;assert rp.get('real_create_gated') is False;assert os.path.isfile('/tmp/parity-gh-mock-real/last-create.json');assert p.get('pretend_remote_pr') is False;print('parity sc gated real create ok', rp.get('plan_path'))"

# 8) Thread (room fanout) + cursor-agent card (CHARTER Delivery completeness)
"${RUN[@]}" "room eng :: parity thread $MARKER" >/tmp/parity-room.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-room.json'));h=next(x for x in d['host_results'] if x.get('kind')=='room_turn');p=json.loads(h['stdout']);stu=p.get('send_to_user') or {};assert p.get('room')=='eng';assert stu.get('type')=='thread';assert p.get('pretend_private_dm') is False;assert p.get('path') and os.path.isfile(p['path']);print('parity room/thread ok', p.get('room'), stu.get('type'), p.get('path'))"
# Prefer delivery ledger type=thread from recordSendToUser
python3 -c "
import json
rows=open('data/delivery/send-to-user.jsonl').read().splitlines()[-20:]
assert any((json.loads(l).get('type')=='thread') for l in rows if l.strip()), 'missing thread SendToUser'
print('parity thread ledger ok')
"
"${RUN[@]}" "launch cloud agent parity refactor $MARKER" >/tmp/parity-cloud.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-cloud.json'));h=next(x for x in d['host_results'] if x.get('kind')=='cloud_agent_launch');p=json.loads(h['stdout']);card=p.get('cursor_agent_card') or {};assert card.get('type')=='cursor-agent' or (p.get('delivery') or {}).get('type')=='cursor-agent' or card.get('bc_id');assert p.get('pretend_remote_cloud') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('session_path') and os.path.isfile(p['session_path']);print('parity cursor-agent ok', card.get('bc_id') or (p.get('delivery') or {}).get('bc_id'), p.get('path'))"

# 9) Session memory multi-turn (Host seed reinject — not LocalBrain)
SESS="parity-mem-$MARKER"
"${RUN[@]}" --session-id "$SESS" "remember parity_marker=$MARKER" >/tmp/parity-mem-set.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-mem-set.json'));assert d.get('ok');assert d.get('intent')=='memory_update';assert any(m.get('key')=='parity_marker' for m in (d.get('memory') or []));h=next(x for x in d['host_results'] if x.get('kind')=='memory_update');p=json.loads(h['stdout']);assert p.get('pretend_persisted') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('vault_path') and os.path.isfile(p['vault_path']);vault=json.load(open(p['vault_path']));assert (vault.get('entries') or {}).get('parity_marker');print('parity memory update Host vault ok', p.get('path'))"
"${RUN[@]}" --session-id "$SESS" "recall" >/tmp/parity-mem-get.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-mem-get.json'));assert d.get('ok');assert d.get('intent')=='memory_recall';blob=json.dumps(d.get('memory') or [])+ (d.get('assistant') or '')+json.dumps(d);assert '$MARKER' in blob;h=next(x for x in d['host_results'] if x.get('kind')=='memory_recall');p=json.loads(h['stdout']);assert p.get('pretend_empty') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('count',0)>=1;print('parity memory recall Host snapshot ok', p.get('count'), p.get('path'))"

# 9b) Shared scope memory + journal durable Host stores
"${RUN[@]}" "shared memory put scope=parity key=marker value=$MARKER" >/tmp/parity-shared-put.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-shared-put.json'));h=next(x for x in d['host_results'] if x.get('kind')=='shared_memory_put');p=json.loads(h['stdout']);assert p.get('stored') is True;assert p.get('isolation')=='scope-bound';assert p.get('pretend_stored') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('store_path') and os.path.isfile(p['store_path']);assert '$MARKER' in open(p['path']).read();print('parity shared_memory put ok', p.get('path'))"
"${RUN[@]}" "shared memory read scope=parity key=marker" >/tmp/parity-shared-get.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-shared-get.json'));h=next(x for x in d['host_results'] if x.get('kind')=='shared_memory_read');p=json.loads(h['stdout']);assert p.get('found') is True;assert p.get('value')=='$MARKER';assert p.get('pretend_cross_scope') is False;assert p.get('path') and os.path.isfile(p['path']);print('parity shared_memory read ok', p.get('path'))"
"${RUN[@]}" "journal note parity $MARKER" >/tmp/parity-journal.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-journal.json'));h=next(x for x in d['host_results'] if x.get('kind')=='journal_append');p=json.loads(h['stdout']);assert p.get('ok') is True or h.get('ok');assert p.get('pretend_stored') is False;assert p.get('pollutes_profile') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('events_path') and os.path.isfile(p['events_path']);assert '$MARKER' in open(p['path']).read();assert '$MARKER' in open(p['events_path']).read();print('parity journal_append ok', p.get('path'))"

# 9c) Credential fill → vault metadata → list (never secret echo)
"${RUN[@]}" "fill credential domain=parity.example.test" >/tmp/parity-cred-fill.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-cred-fill.json'));h=next(x for x in d['host_results'] if x.get('kind')=='credential_fill');p=json.loads(h['stdout']);assert p.get('secret_echoed') is False;assert p.get('vault_only') is True;assert p.get('pretend_secret_view') is False;assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile(p.get('vault_path') or 'data/credentials/vault.json');vault=json.load(open(p['vault_path']));ents=vault.get('entries')or[];assert any(e.get('domain')=='parity.example.test' for e in ents);assert all(('password' not in e and 'token' not in e and 'secret' not in e) for e in ents);assert 'secret-ref' not in json.dumps(p)+json.dumps(vault);print('parity credential_fill vault meta ok', p.get('vault_id'), p.get('path'))"
"${RUN[@]}" "list credentials" >/tmp/parity-cred-list2.json
python3 -c "import json;d=json.load(open('/tmp/parity-cred-list2.json'));h=next(x for x in d['host_results'] if x.get('kind')=='credential_list');p=json.loads(h['stdout']);assert p.get('secret_echoed') is False;assert any(c.get('domain')=='parity.example.test' for c in p.get('credentials')or[]);print('parity credential_list sees fill ok', p.get('count'))"

# 9d) MCP discover + export pack + subagent + voice relay
"${RUN[@]}" "mcp discover user-Gmail" >/tmp/parity-mcp.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-mcp.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mcp_discover');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('pretend_empty') is False;assert p.get('pretend_discovered') is False;assert p.get('tool_count',0)>=1;assert p.get('path') and os.path.isfile(p['path']);cat=json.load(open(p['path']));assert cat.get('tool_count')>=1;print('parity mcp_discover ok', p.get('tool_count'), p.get('path'))"
"${RUN[@]}" "export bot template name=parity-$MARKER" >/tmp/parity-export.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-export.json'));h=next(x for x in d['host_results'] if x.get('kind')=='export_pack');p=json.loads(h['stdout']);assert p.get('secrets_stripped') is True;assert p.get('path') and os.path.isfile(p['path']);print('parity export_pack ok', p.get('path'))"
"${RUN[@]}" "spawn subagent triage parity-$MARKER" >/tmp/parity-sub.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sub.json'));h=next(x for x in d['host_results'] if x.get('kind')=='subagent_run');p=json.loads(h['stdout']);assert p.get('ran') is True;assert (p.get('subagent') or {}).get('status')=='completed';assert p.get('pretend_completed') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('result_path') and os.path.isfile(p['result_path']);assert (p.get('send_to_user') or {}).get('type')=='text';print('parity subagent_run ok', (p.get('subagent') or {}).get('id'), p.get('path'))"
"${RUN[@]}" "voice start parity-vr" >/tmp/parity-vr-start.json
"${RUN[@]}" "voice relay parity-vr :: hello parity $MARKER" >/tmp/parity-vr.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-vr.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_relay');p=json.loads(h['stdout']);assert p.get('reply_media_ok') is True;assert p.get('reply_media_path') and os.path.isfile(p['reply_media_path']);assert open(p['reply_media_path'],'rb').read(4)==b'RIFF';assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_silent') is False;snap=json.load(open(p['path']));assert snap.get('mode')=='host_voice_relay';assert snap.get('sessions_path') and os.path.isfile(snap['sessions_path']);print('parity voice_relay ok', p.get('turns'), p.get('path'))"
# 9d2) Product Host media CM-1601/1602/1603
"${RUN[@]}" --approved "generate image parity aurora $MARKER" >/tmp/parity-gen-image.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-gen-image.json'));assert d.get('intent')=='generate_image';h=next(x for x in d['host_results'] if x.get('kind')=='generate_image');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('pretend_media') is False;assert p.get('png_magic_ok') is True;assert p.get('media_path') and os.path.isfile(p['media_path']);assert open(p['media_path'],'rb').read(8)==b'\\x89PNG\\r\\n\\x1a\\n';assert p.get('path') and os.path.isfile(p['path']);print('parity generate_image ok', p.get('media_path'), p.get('path'))"
"${RUN[@]}" --approved "generate video parity clip $MARKER" >/tmp/parity-gen-video.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-gen-video.json'));assert d.get('intent')=='generate_video';h=next(x for x in d['host_results'] if x.get('kind')=='generate_video');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('pretend_media') is False;assert p.get('media_path') and os.path.isfile(p['media_path']);assert p.get('path') and os.path.isfile(p['path']);print('parity generate_video ok', p.get('media_path'), p.get('path'))"
PVID=$(python3 -c "import json;d=json.load(open('/tmp/parity-gen-video.json'));h=next(x for x in d['host_results'] if x.get('kind')=='generate_video');print(json.loads(h['stdout']).get('media_path'))")
"${RUN[@]}" --approved "watch video $PVID" >/tmp/parity-watch-video.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-watch-video.json'));assert d.get('intent')=='watch_video';h=next(x for x in d['host_results'] if x.get('kind')=='watch_video');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('pretend_media') is False;assert p.get('png_magic_ok') is True;assert p.get('frame_path') and os.path.isfile(p['frame_path']);assert open(p['frame_path'],'rb').read(8)==b'\\x89PNG\\r\\n\\x1a\\n';assert p.get('path') and os.path.isfile(p['path']);print('parity watch_video ok', p.get('frame_path'), p.get('path'))"
"${RUN[@]}" --approved 'structured chart {"wau":10,"mau":42,"dau":7}' >/tmp/parity-chart.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-chart.json'));assert d.get('intent')=='structured_chart';h=next(x for x in d['host_results'] if x.get('kind')=='structured_chart');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('pretend_media') is False;assert p.get('png_magic_ok') is True;assert p.get('media_path') and os.path.isfile(p['media_path']);assert open(p['media_path'],'rb').read(8)==b'\\x89PNG\\r\\n\\x1a\\n';assert p.get('series',{}).get('mau')==42;assert p.get('path') and os.path.isfile(p['path']);print('parity structured_chart ok', p.get('media_path'), p.get('path'))"
"${RUN[@]}" --approved "box doctor" >/tmp/parity-box-doctor.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-box-doctor.json'));assert d.get('intent')=='box_doctor';h=next(x for x in d['host_results'] if x.get('kind')=='box_doctor');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('pretend_healthy') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('log_path') and os.path.isfile(p['log_path']);assert p.get('pass_count',0)>=1;assert 'SUMMARY' in open(p['log_path']).read() or 'PASS' in open(p['log_path']).read();print('parity box_doctor ok', p.get('mode'), p.get('pass_count'), p.get('path'), 'bin_residual', p.get('box_doctor_bin_residual'))"
"${RUN[@]}" --approved "box env" >/tmp/parity-box-env.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-box-env.json'));assert d.get('intent')=='box_env';h=next(x for x in d['host_results'] if x.get('kind')=='box_env');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('pretend_runtime') is False;assert p.get('runtime') in ('local-docker','hosted-anyrun','unknown');assert p.get('path') and os.path.isfile(p['path']);assert p.get('diagnostic_path') and os.path.isfile(p['diagnostic_path']);print('parity box_env ok', p.get('mode'), p.get('runtime'), p.get('path'))"
USER_IANA="${USER_IANA:-Asia/Shanghai}" "${RUN[@]}" --approved "box clock" >/tmp/parity-box-clock.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-box-clock.json'));assert d.get('intent')=='box_clock';h=next(x for x in d['host_results'] if x.get('kind')=='box_clock');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('pretend_aligned') is False;assert p.get('user_iana');assert p.get('date_raw');assert p.get('path') and os.path.isfile(p['path']);assert p.get('date_output_path') and os.path.isfile(p['date_output_path']);print('parity box_clock ok', p.get('mode'), p.get('user_iana'), p.get('aligns'), p.get('path'))"
"${RUN[@]}" --approved "open webhook panel" >/tmp/parity-webhook-panel.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-webhook-panel.json'));assert d.get('intent')=='webhook_panel';h=next(x for x in d['host_results'] if x.get('kind')=='webhook_panel');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('opaque_to_tools') is True;assert p.get('pretend_key_visible_to_tools') is False;assert p.get('url') and p.get('key');assert p.get('path') and os.path.isfile(p['path']);print('parity webhook_panel ok', p.get('id'), p.get('path'))"
"${RUN[@]}" --approved "copy webhook key" >/tmp/parity-webhook-copy.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-webhook-copy.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_copy');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('what')=='key';assert p.get('pretend_copy') is False;assert p.get('path') and os.path.isfile(p['path']);print('parity webhook_copy ok', p.get('what'), p.get('path'))"
"${RUN[@]}" --approved "tool-read webhook key" >/tmp/parity-webhook-tool-read.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-webhook-tool-read.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_tool_read_key');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('refused') is True;assert p.get('key') is None;assert p.get('key_leaked') is False;assert p.get('pretend_key_readable') is False;print('parity webhook_tool_read ok', p.get('error'))"
"${RUN[@]}" --approved "webhook wake id=evt-parity summary=POST /hooks received" >/tmp/parity-webhook-wake.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-webhook-wake.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webhook_wake');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('has_webhook_event') is True;assert p.get('key_leaked') is False;assert p.get('path') and os.path.isfile(p['path']);panel=json.load(open('data/routines/webhooks/panel.json'));assert panel['key'] not in (p.get('wake_payload') or '');print('parity webhook_wake ok', p.get('event_id'), p.get('path'))"

# 9e) Connectors probe + teammate send + routine tick (Host durable)
"${RUN[@]}" "list connectors" >/tmp/parity-conn.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-conn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='connectors_probe');p=json.loads(h['stdout']);assert p.get('ok') is True;assert p.get('pretend_all_connected') is False;assert isinstance(p.get('connectors'),dict) and p['connectors'];assert p.get('path') and os.path.isfile(p['path']);print('parity connectors_probe ok', sorted(p['connectors'].keys()), p.get('path'))"
"${RUN[@]}" "create teammate id=asst-parity name=Parity role=executor" >/tmp/parity-tm.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-tm.json'));h=next(x for x in d['host_results'] if x.get('kind')=='teammate_create');p=json.loads(h['stdout']);assert h.get('ok');assert p.get('pretend_created') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('teammates_path') and os.path.isfile(p['teammates_path']);print('parity teammate_create ok', p.get('path'))"
"${RUN[@]}" "send to agent asst-parity :: review parity $MARKER" >/tmp/parity-sta.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sta.json'));h=next(x for x in d['host_results'] if x.get('kind')=='send_to_agent');p=json.loads(h['stdout']);assert p.get('to_id')=='asst-parity';assert (p.get('send_to_user') or {}).get('type')=='text';assert p.get('pretend_delivered') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('inbox_path') and os.path.isfile(p['inbox_path']);print('parity send_to_agent ok', p.get('status'), p.get('path'))"
"${RUN[@]}" "create routine id=parity-now cron=@now prompt=ping $MARKER" >/tmp/parity-rt.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-rt.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_schedule');p=json.loads(h['stdout']);assert p.get('stored') is True;assert p.get('due_now') is True;assert p.get('id')=='parity-now';assert p.get('pretend_scheduled') is False;assert p.get('path') and os.path.isfile(p['path']);assert os.path.isfile('data/routines/schedules.jsonl');print('parity routine_schedule @now ok', p.get('next_due'), p.get('path'))"
"${RUN[@]}" "tick routines" >/tmp/parity-tick.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-tick.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_tick');p=json.loads(h['stdout']);assert p.get('fired_count',0)>=1;assert any((f.get('id')=='parity-now') for f in (p.get('fired')or[]));assert os.path.isfile(p.get('wakes_path') or 'data/routines/wakes.jsonl') or p.get('wakes');print('parity routine_tick ok', 'fired', p.get('fired_count'), 'due', p.get('due_count'))"
"${RUN[@]}" "fire routine parity-now" >/tmp/parity-fire.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-fire.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_fire');p=json.loads(h['stdout']);assert p.get('fired') is True;assert p.get('id')=='parity-now';assert p.get('pretend_fired') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('fires') and os.path.isfile(p['fires']);print('parity routine_fire ok', p.get('next_due'), p.get('path'))"

# 9f) Mail live (Gmail mock) + sections + slides + purchase + install plugin
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18773 --mode gmail --token smoke-gmail >/tmp/parity-gmail-mock.log 2>&1 &
GMAIL_PID=$!
sleep 0.35
BITBOT_GMAIL_API_BASE=http://127.0.0.1:18773 BITBOT_GMAIL_TOKEN=smoke-gmail \
  "${RUN[@]}" "search mail Invoice" >/tmp/parity-mail-search.json || true
BITBOT_GMAIL_API_BASE=http://127.0.0.1:18773 BITBOT_GMAIL_TOKEN=smoke-gmail \
  "${RUN[@]}" "read mail t-invoice-1" >/tmp/parity-mail-read.json || true
BITBOT_GMAIL_API_BASE=http://127.0.0.1:18773 BITBOT_GMAIL_TOKEN=smoke-gmail BITBOT_MAIL_SEND=1 \
  "${RUN[@]}" --approved "draft mail to=parity@example.com subject=Parity body=$MARKER" >/tmp/parity-mail-send.json || true
kill "$GMAIL_PID" >/dev/null 2>&1 || true
wait "$GMAIL_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/parity-mail-search.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_search');p=json.loads(h['stdout']);assert p.get('mode')=='gmail_live';assert p.get('live_mail_residual') is False;assert p.get('pretend_live') is False;assert p.get('hit_count')>=1;assert p.get('path') and os.path.isfile(p['path']);print('parity mail_search live ok', p.get('hit_count'), p.get('path'))"
python3 -c "import json,os;d=json.load(open('/tmp/parity-mail-read.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_read');p=json.loads(h['stdout']);assert p.get('mode')=='gmail_live';assert p.get('live_mail_residual') is False;assert p.get('path') and os.path.isfile(p['path']);print('parity mail_read live ok', p.get('thread_id'), p.get('path'))"
python3 -c "import json,os;d=json.load(open('/tmp/parity-mail-send.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_gmail';assert p.get('sent') is True;assert p.get('pretend_sent') is False;assert p.get('path') and os.path.isfile(p['path']);print('parity mail_send live ok', p.get('message_id'), p.get('path'))"

"${RUN[@]}" "add section group=parity id=sec-p title=Parity" >/tmp/parity-sec-add.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sec-add.json'));h=next(x for x in d['host_results'] if x.get('kind')=='section_add');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('ok') is True;assert (p.get('section') or {}).get('id')=='sec-p';assert p.get('pretend_shared') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('group_path') and os.path.isfile(p['group_path']);print('parity section_add ok', p.get('section').get('id'), 'existing', p.get('existing'), p.get('path'))"
"${RUN[@]}" "section post group=parity section=sec-p from=user body=parity $MARKER" >/tmp/parity-sec-post.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sec-post.json'));h=next(x for x in d['host_results'] if x.get('kind')=='section_post');p=json.loads(h['stdout']);assert p.get('isolation_ok') is True;assert p.get('pretend_cross_section') is False;assert (p.get('send_to_user') or {}).get('type')=='text';assert p.get('path') and os.path.isfile(p['path']);assert p.get('group_path') and os.path.isfile(p['group_path']);print('parity section_post ok', p.get('messages_in_section'), p.get('path'))"

"${RUN[@]}" "make slides title=Parity $MARKER" >/tmp/parity-slides.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-slides.json'));h=next(x for x in d['host_results'] if x.get('kind')=='slides_pptx');p=json.loads(h['stdout']);assert p.get('pptx_pk_magic_ok') is True;assert p.get('path') and os.path.isfile(p['path']);assert p.get('meta_path') and os.path.isfile(p['meta_path']);assert p.get('pretend_rendered') is False;print('parity slides_pptx ok', p.get('bytes'), p.get('meta_path'))"

"${RUN[@]}" --approved "purchase item=ParityWidget cents=500" >/tmp/parity-purchase.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-purchase.json'));h=next(x for x in d['host_results'] if x.get('kind')=='purchase');p=json.loads(h['stdout']);assert p.get('receipt_ok') is True;assert p.get('pretend_paid') is False;assert p.get('paid') is False;assert p.get('live_paid_residual') is True;assert os.path.isfile(p['receipt_path']);assert p.get('path') and os.path.isfile(p['path']);print('parity purchase sandbox ok', p.get('mode'), p.get('path'))"
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18765 --mode purchase --token smoke-pay >/tmp/parity-pay-mock.log 2>&1 &
PAY_PID=$!
sleep 0.35
BITBOT_PURCHASE_LIVE=1 BITBOT_PURCHASE_TOKEN=smoke-pay BITBOT_PURCHASE_API_URL=http://127.0.0.1:18765 \
  "${RUN[@]}" --approved "purchase item=LiveParity cents=999" >/tmp/parity-purchase-live.json || true
kill "$PAY_PID" >/dev/null 2>&1 || true
wait "$PAY_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/parity-purchase-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='purchase');p=json.loads(h['stdout']);assert p.get('mode')=='live_charge';assert p.get('paid') is True;assert p.get('live_paid_residual') is False;assert p.get('pretend_paid') is False;print('parity purchase live ok', (p.get('charge_probe') or {}).get('ok'))"

"${RUN[@]}" "install plugin plugin-slides" >/tmp/parity-plugin.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-plugin.json'));assert d.get('ok');assert d.get('intent')=='install_plugin';h=next(x for x in d['host_results'] if x.get('kind')=='mcp_namespace');p=json.loads(h['stdout']);assert p.get('pretend_registered') is False;assert p.get('namespace')=='user-Slides';assert p.get('status')=='Ready';assert p.get('usable') is True;assert p.get('path') and os.path.isfile(p['path']);print('parity install_plugin mcp_namespace Ready ok', p.get('namespace'), p.get('path'))"
"${RUN[@]}" "learn from demo title=ParityCheckout steps=click:Cart|type:email" >/tmp/parity-lfd.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-lfd.json'));h=next(x for x in d['host_results'] if x.get('kind')=='skill_write');p=json.loads(h['stdout']);assert p.get('path') and os.path.isfile(p['path']);body=open(p['path']).read();assert 'click:Cart' in body or 'Steps' in body;print('parity learn_from_demo ok')"
"${RUN[@]}" "author skill name=parity-skill description=demo body=Do the parity thing $MARKER" >/tmp/parity-author.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-author.json'));h=next(x for x in d['host_results'] if x.get('kind')=='skill_write');p=json.loads(h['stdout']);assert p.get('persisted') is True;assert p.get('path') and os.path.isfile(p['path']);assert p.get('meta_path') and os.path.isfile(p['meta_path']);assert p.get('pretend_shared') is False;print('parity author_skill ok', p.get('name'), p.get('meta_path'))"

# 9g) X / job / calendar / finance live mocks
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18772 --mode x --token smoke-x >/tmp/parity-x-mock.log 2>&1 &
X_PID=$!
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18771 --mode job --token smoke-job >/tmp/parity-job-mock.log 2>&1 &
JOB_PID=$!
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18776 --mode calendar --token smoke-cal >/tmp/parity-cal-mock.log 2>&1 &
CAL_PID=$!
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18768 --mode finance --token smoke-fin >/tmp/parity-fin-mock.log 2>&1 &
FIN_PID=$!
sleep 0.4
BITBOT_X_API_BASE=http://127.0.0.1:18772 BITBOT_X_BEARER=smoke-x \
  "${RUN[@]}" "x search parity $MARKER" >/tmp/parity-x.json || true
BITBOT_JOB_API_URL=http://127.0.0.1:18771 BITBOT_JOB_TOKEN=smoke-job \
  "${RUN[@]}" "job search engineer" >/tmp/parity-job.json || true
BITBOT_CALENDAR_API_URL=http://127.0.0.1:18776 BITBOT_CALENDAR_TOKEN=smoke-cal \
  "${RUN[@]}" "schedule meeting title=ParityLive when=tomorrow" >/tmp/parity-cal.json || true
BITBOT_FINANCE_API_URL=http://127.0.0.1:18768 BITBOT_FINANCE_TOKEN=smoke-fin \
  "${RUN[@]}" "finance get_balance" >/tmp/parity-fin.json || true
kill "$X_PID" "$JOB_PID" "$CAL_PID" "$FIN_PID" >/dev/null 2>&1 || true
wait "$X_PID" "$JOB_PID" "$CAL_PID" "$FIN_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/parity-x.json'));h=next(x for x in d['host_results'] if x.get('kind')=='x_search');p=json.loads(h['stdout']);assert p.get('mode')=='x_live';assert p.get('pretend_live') is False;assert p.get('hit_count')>=1;print('parity x_search live ok', p.get('hit_count'))"
python3 -c "import json;d=json.load(open('/tmp/parity-job.json'));h=next(x for x in d['host_results'] if x.get('kind')=='job_search');p=json.loads(h['stdout']);assert p.get('mode')=='job_live';assert p.get('live_job_residual') is False;assert p.get('pretend_applied') is False;assert p.get('hit_count')>=1;print('parity job_search live ok', p.get('hit_count'))"
python3 -c "import json,os;d=json.load(open('/tmp/parity-cal.json'));h=next(x for x in d['host_results'] if x.get('kind')=='schedule_meeting');p=json.loads(h['stdout']);assert p.get('mode')=='calendar_live';assert p.get('live_calendar_residual') is False;assert p.get('ics_ok') is True and os.path.isfile(p['ics_path']);assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_live') is False;print('parity calendar live ok', p.get('path'))"
python3 -c "import json,os;d=json.load(open('/tmp/parity-fin.json'));h=next(x for x in d['host_results'] if x.get('kind')=='finance_call');p=json.loads(h['stdout']);assert p.get('mode')=='finance_live';assert p.get('live_finance_residual') is False;assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);print('parity finance_call live ok', p.get('path'))"

# 9h) CU OCR/native + device tools + identity + workflows + box copy + cold mail + meeting + Outlook
BITBOT_CU_OCR=1 BITBOT_CU_NATIVE_ACT=1 \
  "${RUN[@]}" "computer use open example.com" >/tmp/parity-cu.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-cu.json'));h=next(x for x in d['host_results'] if x.get('kind')=='computer_use');p=json.loads(h['stdout']);g=p.get('gui')or{};vp=g.get('vision_plan')or{};assert g.get('vision_ok') is True;assert vp.get('ocr') is True;assert vp.get('ocr_residual') is False;na=g.get('native_os_act')or{};assert na.get('enabled') is True;assert na.get('ok') is True;assert na.get('os_window_automation_residual') is False;assert p.get('evidence') and os.path.isfile(p['evidence']);assert (p.get('outcome') or {}).get('pretend_purchased') is False;print('parity CU OCR+native ok', 'ocr_prefix', (vp.get('ocr_text_prefix') or '')[:24])"
"${RUN[@]}" --machine-kind ios --machine-id phone-ios "device tools" >/tmp/parity-dt.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-dt.json'));h=next(x for x in d['host_results'] if x.get('kind')=='device_tools_list');p=json.loads(h['stdout']);assert p.get('machine_kind')=='ios';assert p.get('count')>=1;assert p.get('pretend_granted') is False;assert os.path.isfile(p['path']);print('parity device_tools_list ok', p.get('count'), p.get('path'))"
"${RUN[@]}" --machine-kind ios "device tool camera" >/tmp/parity-dti.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-dti.json'));hrs=d.get('host_results')or[];kinds=[h.get('kind') for h in hrs];assert 'device_tool' in kinds or 'device_permission' in kinds;h=next(x for x in hrs if x.get('kind') in ('device_tool','device_permission'));p=json.loads(h['stdout']);assert p.get('pretend_granted') is False if 'pretend_granted' in p else p.get('executed') is True;assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_executed') is not True;print('parity device invoke ok', h.get('kind'), p.get('path'))"
"${RUN[@]}" "identity browser" >/tmp/parity-id.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-id.json'));h=next(x for x in d['host_results'] if x.get('kind')=='oauth');p=json.loads(h['stdout']);assert p.get('mode')=='identity_browser_switch';assert p.get('pretend_connected_slack') is False;assert p.get('connected') is False;assert p.get('session_path') and os.path.isfile(p['session_path']);print('parity identity_browser ok')"
"${RUN[@]}" "list workflows" >/tmp/parity-wf.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-wf.json'));h=next(x for x in d['host_results'] if x.get('kind')=='workflow_list');p=json.loads(h['stdout']);assert p.get('count')>=1;assert p.get('path') and os.path.isfile(p['path']);assert p.get('catalog_path') and os.path.isfile(p['catalog_path']);assert p.get('pretend_shared') is False;assert all(w.get('pretend_shared') is False for w in p.get('workflows')or[]);print('parity workflow_list ok', p.get('count'), p.get('path'))"
mkdir -p uploads
echo "parity-box-$MARKER" > uploads/parity-box-src.txt
"${RUN[@]}" "copy to box machine=desk-1 src=uploads/parity-box-src.txt dest=uploads/parity-box-dest.txt" >/tmp/parity-box.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-box.json'));h=next(x for x in d['host_results'] if x.get('kind')=='copy_to_box');p=json.loads(h['stdout']);assert p.get('under_repo') is True;assert p.get('pretend_remote_machine') is False;assert os.path.isfile('uploads/parity-box-dest.txt');print('parity copy_to_box ok')"
"${RUN[@]}" --approved "cold mail to=parity@example.com subject=Hi body=Hello $MARKER" >/tmp/parity-cold.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-cold.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_send');p=json.loads(h['stdout']);assert p.get('provider')=='cold';assert p.get('pretend_sent') is False;assert 'List-Unsubscribe:' in open(p['eml_path']).read();assert p.get('path') and os.path.isfile(p['path']);print('parity cold_mail ok', p.get('path'))"
"${RUN[@]}" "meeting chat body=parity standup $MARKER direct=1" >/tmp/parity-meet.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-meet.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='meeting_chat_direct';assert p.get('live_meeting_residual') is True;assert p.get('transcript') and os.path.isfile(p['transcript']);print('parity meeting_chat DirectSend ok')"
"${RUN[@]}" "meeting chat body=parity draft card" >/tmp/parity-meet-draft.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-meet-draft.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_draft');p=json.loads(h['stdout']);assert p.get('mode')=='meeting_chat_draft_card';assert p.get('meeting_chat') is True;assert p.get('eml_ok') is True;assert os.path.isfile(p.get('eml_path') or '');assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_sent') is False;print('parity meeting_chat DraftCard ok', p.get('eml_path'), p.get('path'))"
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18766 --mode meeting --token smoke-meeting >/tmp/parity-meet-live-mock.log 2>&1 &
MEET_LIVE_PID=$!
sleep 0.4
BITBOT_MEETING_API_URL=http://127.0.0.1:18766 BITBOT_MEETING_TOKEN=smoke-meeting \
  "${RUN[@]}" --approved "meeting chat body=parity live standup direct=1" >/tmp/parity-meet-live.json || true
kill "$MEET_LIVE_PID" >/dev/null 2>&1 || true
wait "$MEET_LIVE_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/parity-meet-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='meeting_chat_live';assert p.get('live_post') is True;assert p.get('live_meeting_residual') is False;assert p.get('direct_send') is True;assert p.get('transcript') and os.path.isfile(p['transcript']);print('parity meeting_chat live ok', (p.get('live_probe') or {}).get('http_status'))"
"${RUN[@]}" --approved "shell echo parity-shell-$MARKER" >/tmp/parity-shell.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-shell.json'));assert d.get('host_continued') is True;h=next(x for x in d['host_results'] if x.get('kind')=='shell');assert h.get('ok');assert 'parity-shell-' in (h.get('stdout') or '');assert h.get('artifact_path') and os.path.isfile(h['artifact_path']);assert h.get('path')==h.get('artifact_path') and os.path.isfile(h['path']);assert h.get('pretend_ok') is False;print('parity shell Host path ok', h.get('path'))"
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18775 --mode outlook --token smoke-out >/tmp/parity-outlook-mock.log 2>&1 &
OUT_PID=$!
sleep 0.35
BITBOT_OUTLOOK_GRAPH_URL=http://127.0.0.1:18775 BITBOT_OUTLOOK_TOKEN=smoke-out BITBOT_MAIL_SEND=1 \
  "${RUN[@]}" --approved "draft outlook mail to=parity@example.com subject=Parity body=$MARKER" >/tmp/parity-outlook.json || true
kill "$OUT_PID" >/dev/null 2>&1 || true
wait "$OUT_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/parity-outlook.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_outlook';assert p.get('sent') is True;assert p.get('pretend_sent') is False;assert p.get('path') and os.path.isfile(p['path']);print('parity outlook live ok', p.get('path'))"

# 9h) Site-playbook verticals (shopping / travel / food) + CU payment_wall honesty
"${RUN[@]}" "shop https://www.target.com/ headphones" >/tmp/parity-shop.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-shop.json'));assert d.get('ok') and d.get('intent')=='shop_retail';h=next(x for x in d['host_results'] if x.get('kind')=='computer_use');p=json.loads(h['stdout']);oc=p.get('outcome')or{};assert oc.get('pretend_purchased') is False;assert oc.get('vertical_family')=='shopping';assert 'target' in (oc.get('playbook_name') or '');assert oc.get('playbook_journal') and os.path.isfile(oc['playbook_journal']);pb=json.load(open(oc['playbook_journal']));assert pb.get('pretend_purchased') is False;assert pb.get('family')=='shopping';print('parity shop playbook ok', oc.get('playbook_name'), oc.get('checkout_stage'))"
"${RUN[@]}" "book flight https://www.expedia.com/" >/tmp/parity-travel.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-travel.json'));assert d.get('ok') and d.get('intent')=='travel_book';h=next(x for x in d['host_results'] if x.get('kind')=='computer_use');p=json.loads(h['stdout']);oc=p.get('outcome')or{};assert oc.get('pretend_purchased') is False;assert oc.get('vertical_family')=='travel';assert 'expedia' in (oc.get('playbook_name') or '');assert oc.get('playbook_journal') and os.path.isfile(oc['playbook_journal']);print('parity travel playbook ok', oc.get('playbook_name'))"
"${RUN[@]}" "order food https://www.doordash.com/" >/tmp/parity-food.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-food.json'));assert d.get('ok') and d.get('intent')=='order_food';h=next(x for x in d['host_results'] if x.get('kind')=='computer_use');p=json.loads(h['stdout']);oc=p.get('outcome')or{};assert oc.get('pretend_purchased') is False;assert oc.get('vertical_family')=='food';assert 'doordash' in (oc.get('playbook_name') or '');assert oc.get('playbook_journal') and os.path.isfile(oc['playbook_journal']);print('parity food playbook ok', oc.get('playbook_name'))"
python3 "$ROOT/scripts/host_cu_checkout_fixture.py" --port 18780 >/tmp/parity-cu-fixture.log 2>&1 &
CU_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:18780/" >/dev/null; then break; fi
  sleep 0.2
done
curl -sf "http://127.0.0.1:18780/" >/dev/null
BITBOT_CU_ALLOW_LOCAL=1 "${RUN[@]}" "computer use open http://127.0.0.1:18780/ shop cart checkout buy" >/tmp/parity-cu-paywall.json || true
kill "$CU_PID" 2>/dev/null || true
wait "$CU_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/parity-cu-paywall.json'));h=next(x for x in d['host_results'] if x.get('kind')=='computer_use');p=json.loads(h.get('stdout') or '{}');oc=p.get('outcome') or {};assert oc.get('has_payment') is True;assert oc.get('checkout_stage')=='payment_wall' or oc.get('vertical_stage')=='payment_wall';assert oc.get('pretend_purchased') is False;assert oc.get('paid_checkout_attempted') is False;assert oc.get('live_paid_residual') is True;print('parity CU payment_wall ok', oc.get('checkout_stage'))"

# 9i) Mail claim inbox + Slack/Teams channel claim + cloud artifact + OAuth callback + daemon
"${RUN[@]}" "claim inbox bravo" >/tmp/parity-mail-claim.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-mail-claim.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_claim_inbox');p=json.loads(h['stdout']);assert p.get('pretend_claimed') is False;assert 'bravo@' in (p.get('address') or '');assert os.path.isfile(p['path']);print('parity mail_claim_inbox ok', p.get('address'))"
BITBOT_SLACK_CLAIM=1 "${RUN[@]}" --approved "reply via slack:Csmoke :: claim rehearsal $MARKER" >/tmp/parity-slack-claim.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-slack-claim.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='sandbox_slack_claim';assert p.get('pretend_live') is not True;assert os.path.isfile('data/channels/inbound.jsonl');print('parity sandbox_slack_claim ok', p.get('claimed_count'))"
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18781 --mode slack --token smoke-slack >/tmp/parity-slack-claim-mock.log 2>&1 &
SLACK_CLAIM_PID=$!
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18782 --mode teams --token smoke-teams >/tmp/parity-teams-claim-mock.log 2>&1 &
TEAMS_CLAIM_PID=$!
sleep 0.4
BITBOT_SLACK_API_BASE=http://127.0.0.1:18781 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_CLAIM=1 \
  "${RUN[@]}" --approved "reply via slack:Csmoke :: claim live $MARKER" >/tmp/parity-slack-claim-live.json || true
BITBOT_TEAMS_GRAPH_URL=http://127.0.0.1:18782 BITBOT_TEAMS_TOKEN=smoke-teams BITBOT_TEAMS_CLAIM=1 \
  "${RUN[@]}" --approved "reply via teams:Tsmoke :: claim teams $MARKER" >/tmp/parity-teams-claim-live.json || true
BITBOT_TEAMS_CLAIM=1 "${RUN[@]}" --approved "reply via teams:Tsmoke :: sandbox claim $MARKER" >/tmp/parity-teams-claim-sandbox.json
kill "$SLACK_CLAIM_PID" "$TEAMS_CLAIM_PID" >/dev/null 2>&1 || true
wait "$SLACK_CLAIM_PID" "$TEAMS_CLAIM_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/parity-slack-claim-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_slack_claim';assert p.get('claimed_count',0)>=1;assert 'live_slack_claim' in open('data/channels/inbound.jsonl').read();print('parity live_slack_claim ok', p.get('claimed_count'))"
python3 -c "import json;d=json.load(open('/tmp/parity-teams-claim-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_teams_claim';assert p.get('claimed_count',0)>=1;assert p.get('pretend_live') is False;print('parity live_teams_claim ok', p.get('claimed_count'))"
python3 -c "import json;d=json.load(open('/tmp/parity-teams-claim-sandbox.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='sandbox_teams_claim';assert p.get('pretend_live') is False;print('parity sandbox_teams_claim ok')"
"${RUN[@]}" "deliver cloud artifact bc-1" >/tmp/parity-cloud-art.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-cloud-art.json'));h=next(x for x in d['host_results'] if x.get('kind')=='cloud_artifact_deliver');p=json.loads(h['stdout']);assert p.get('delivered') is True;assert p.get('bc_id')=='bc-1';assert p.get('pretend_remote_fetch') is False;assert p.get('pretend_delivered') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('meta_path') and os.path.isfile(p['meta_path']);print('parity cloud_artifact_deliver ok', p.get('path'), p.get('meta_path'))"
bash "$ROOT/scripts/host_routine_daemon.sh" --sweeps 2 --interval-ms 50 --write-systemd-unit >/tmp/parity-daemon.log 2>&1
python3 -c "import json,os;assert os.path.isfile('data/routines/daemon-sweep-1.json');assert os.path.isfile('data/routines/daemon-sweep-2.json');st=json.load(open('data/routines/daemon-status.json'));assert st.get('sweeps',0)>=2;assert os.path.isfile('data/routines/bitbot-routine-daemon.service');print('parity routine daemon sweeps ok', st.get('sweeps'), 'systemd_unit', st.get('systemd_unit'))"
BITBOT_OAUTH_MODE=live "${RUN[@]}" "setup slack" >/tmp/parity-oauth-needsauth.json || true
python3 -c "import json,os;d=json.load(open('/tmp/parity-oauth-needsauth.json'));h=next(x for x in d['host_results'] if x.get('kind')=='oauth');assert h.get('ok') is False;p=json.loads(h.get('stdout') or '{}');assert p.get('status')=='NeedsAuth';assert p.get('mode')=='live_needs_auth';assert p.get('connected') is False;assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_connected') is False;print('parity oauth live NeedsAuth ok', p.get('path'))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_OPEN_BROWSER=1 BITBOT_OAUTH_CLIENT_ID=smoke-client \
  "${RUN[@]}" "setup slack" >/tmp/parity-oauth-browser.json || true
python3 -c "import json;d=json.load(open('/tmp/parity-oauth-browser.json'));h=next(x for x in d['host_results'] if x.get('kind')=='oauth');assert h.get('ok') is False;p=json.loads(h.get('stdout') or '{}');assert p.get('status')=='NeedsAuth';assert p.get('mode')=='live_remote_browser_open';assert p.get('browser_opened') is True;assert p.get('connected') is False;print('parity oauth live_remote_browser_open ok', p.get('browser_tool'))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=remote_callback BITBOT_OAUTH_AUTHORIZE_URL=https://oauth.example.invalid/authorize BITBOT_OAUTH_TOKEN_URL=https://oauth.example.invalid/token BITBOT_OAUTH_CLIENT_ID=smoke-client BITBOT_OAUTH_CALLBACK_WAIT_MS=4000 \
  "${RUN[@]}" "setup slack" >/tmp/parity-oauth-cb.json
python3 -c "import json;d=json.load(open('/tmp/parity-oauth-cb.json'));h=next(x for x in d['host_results'] if x.get('kind')=='oauth');p=json.loads(h['stdout']);assert p.get('mode')=='live_remote_callback';assert p.get('connected') is True;print('parity oauth remote_callback ok', p.get('callback_received'))"
BITBOT_ROUTINE_MAX_SWEEPS=2 bash "$ROOT/scripts/host_routine_daemon.sh" --long-lived --interval-ms 50 --install-user-unit >/tmp/parity-daemon-long.log 2>&1
python3 -c "import json,os;d=json.load(open('data/routines/daemon-status.json'));assert d.get('daemon') is True;assert d.get('long_lived') is True;assert d.get('sweeps')==2;assert d.get('ok')==2;assert d.get('systemd_unit_installed') is True;assert d.get('systemd_scope') in ('user','system');assert d.get('systemd_user_unit_path') and os.path.isfile(d['systemd_user_unit_path']);print('parity routine daemon long-lived+user unit ok', d.get('sweeps'), d.get('systemd_scope'))"

# 9j) Host tools: fs list/read, webfetch, copy_from_box, routines list/pause/resume, connect gmail
"${RUN[@]}" "fs list ." >/tmp/parity-fs-list.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-fs-list.json'));h=next(x for x in d['host_results'] if x.get('kind')=='fs_list');p=json.loads(h['stdout']);assert p.get('pretend_listing') is False;assert p.get('count',0)>=1;assert p.get('artifact_path') and os.path.isfile(p['artifact_path']);print('parity fs_list ok', p.get('count'))"
"${RUN[@]}" "fs read README.mbt.md" >/tmp/parity-fs-read.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-fs-read.json'));h=next(x for x in d['host_results'] if x.get('kind')=='fs_read');p=json.loads(h['stdout']);assert p.get('pretend_contents') is False;assert p.get('bytes',0)>=1;assert 'MoonBit' in (p.get('body_prefix') or p.get('body') or '');assert os.path.isfile(p['artifact_path']);print('parity fs_read ok', p.get('bytes'))"
"${RUN[@]}" "webfetch https://example.com" >/tmp/parity-webfetch.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-webfetch.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webfetch');p=json.loads(h['stdout']);assert p.get('pretend_fetched') is False;assert p.get('ok') is True;assert p.get('http_status')==200;assert p.get('used_fallback') is False;assert p.get('credential_bypass') is False;assert os.path.isfile(p.get('path') or p['artifact_path']);print('parity webfetch ok', p.get('http_status'), p.get('body_bytes'), p.get('path') or p.get('artifact_path'))"
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18790 --mode webfetch >/tmp/parity-webfetch-mock.log 2>&1 &
WF_PID=$!
sleep 0.3
"${RUN[@]}" --approved "webfetch http://127.0.0.1:18790/docs-blocked" >/tmp/parity-webfetch-fb.json || true
"${RUN[@]}" --approved "webfetch http://127.0.0.1:18790/login" >/tmp/parity-webfetch-auth.json || true
kill "$WF_PID" >/dev/null 2>&1 || true
wait "$WF_PID" 2>/dev/null || true
python3 -c "import json,os;d=json.load(open('/tmp/parity-webfetch-fb.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webfetch');p=json.loads(h['stdout']);assert h.get('ok') is True;assert p.get('used_fallback') is True;assert p.get('fallback')=='curl';assert p.get('credential_bypass') is False;assert p.get('pretend_fetched') is False;assert 'Public docs' in (p.get('body_prefix') or '');assert p.get('path') and os.path.isfile(p['path']);print('parity webfetch CM-1703 public fallback ok', p.get('fallback'), p.get('path'))"
python3 -c "import json;d=json.load(open('/tmp/parity-webfetch-auth.json'));h=next(x for x in d['host_results'] if x.get('kind')=='webfetch');p=json.loads(h.get('stdout') or '{}');assert h.get('ok') is False;assert p.get('used_fallback') is False;assert p.get('credential_bypass') is False;assert 'auth_wall' in (p.get('error') or h.get('error') or '') or p.get('mode')=='host_webfetch_auth_wall';print('parity webfetch auth wall no-bypass ok', p.get('mode') or h.get('error'))"
mkdir -p uploads
printf 'parity-box-roundtrip\n' > uploads/parity-round-src.txt
"${RUN[@]}" "copy to box machine=desk-1 src=uploads/parity-round-src.txt dest=uploads/parity-round-box.txt" >/tmp/parity-box-to.json
"${RUN[@]}" "copy from box machine=desk-1 box=uploads/parity-round-box.txt dest=uploads/parity-round-out.txt" >/tmp/parity-box-from.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-box-from.json'));h=next(x for x in d['host_results'] if x.get('kind')=='copy_from_box');p=json.loads(h['stdout']);assert p.get('pretend_remote_machine') is False;assert p.get('under_repo') is True;assert os.path.isfile('uploads/parity-round-out.txt');assert 'parity-box-roundtrip' in open('uploads/parity-round-out.txt').read();print('parity copy_from_box ok', p.get('bytes'))"
"${RUN[@]}" "list routines" >/tmp/parity-routines-list.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-routines-list.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_list');p=json.loads(h['stdout']);count=len(p) if isinstance(p,list) else len((p.get('routines') if isinstance(p,dict) else None) or []);assert count>=1;assert p.get('pretend_empty') is False if isinstance(p,dict) else True;assert (not isinstance(p,dict)) or (p.get('path') and os.path.isfile(p['path']));print('parity routine_list ok', count, (p.get('path') if isinstance(p,dict) else ''))"
"${RUN[@]}" "pause routine parity-now" >/tmp/parity-routines-pause.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-routines-pause.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_pause');assert h.get('ok');p=json.loads(h['stdout']) if (h.get('stdout')or'').strip().startswith('{') else {};assert p.get('lifecycle')=='paused' or 'paused' in (h.get('stdout') or '').lower();assert (not p.get('path')) or os.path.isfile(p['path']);print('parity routine_pause ok', p.get('path') or h.get('stdout'))"
"${RUN[@]}" "resume routine parity-now" >/tmp/parity-routines-resume.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-routines-resume.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_resume');assert h.get('ok');p=json.loads(h['stdout']) if (h.get('stdout')or'').strip().startswith('{') else {};assert p.get('lifecycle')=='active' or 'resumed' in (h.get('stdout') or '').lower();assert (not p.get('path')) or os.path.isfile(p['path']);print('parity routine_resume ok', p.get('path') or h.get('stdout'))"
"${RUN[@]}" "connect gmail" >/tmp/parity-connect-gmail.json
python3 -c "import json;d=json.load(open('/tmp/parity-connect-gmail.json'));h=next(x for x in d['host_results'] if x.get('kind')=='oauth');p=json.loads(h['stdout']);assert p.get('connector')=='gmail';assert p.get('mode')=='sandbox_idp';assert p.get('connected') is True;print('parity connect_gmail sandbox ok', p.get('status'))"
"${RUN[@]}" "connect finance" >/tmp/parity-connect-finance.json
python3 -c "import json;d=json.load(open('/tmp/parity-connect-finance.json'));assert d.get('intent')=='finance_connect';h=next(x for x in d['host_results'] if x.get('kind')=='oauth');p=json.loads(h['stdout']);assert p.get('connector')=='finance';assert p.get('mode')=='sandbox_idp';assert p.get('connected') is True;print('parity connect_finance sandbox ok', p.get('status'))"
"${RUN[@]}" "journal query from=2020-01-01 to=2099-12-31" >/tmp/parity-journal-query.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-journal-query.json'));assert d.get('intent')=='journal_query';h=next(x for x in d['host_results'] if x.get('kind')=='journal_query');p=json.loads(h['stdout']);assert p.get('pretend_hits') is False;assert p.get('pollutes_profile') is False;assert os.path.isfile(p['path']);print('parity journal_query ok', p.get('hit_count'))"
"${RUN[@]}" --approved "teams send teams:tenant-A/team-1/general :: parity teams cm1107 $MARKER" >/tmp/parity-teams-send.json
python3 -c "import json;d=json.load(open('/tmp/parity-teams-send.json'));assert d.get('intent')=='teams_send';h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert 'teams:' in str(p.get('target') or p.get('address') or p.get('command') or h.get('command') or '');assert p.get('pretend_live') is not True;print('parity teams_send cm1107 ok', p.get('mode'))"
"${RUN[@]}" --approved "teams send Tsmoke :: parity teams chatid $MARKER" >/tmp/parity-teams-chatid.json
python3 -c "import json;d=json.load(open('/tmp/parity-teams-chatid.json'));assert d.get('intent')=='teams_send';h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert h.get('ok');print('parity teams_send chatid ok', p.get('mode'))"
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18783 --mode teams --token smoke-teams >/tmp/parity-teams-post-mock.log 2>&1 &
TEAMS_POST_PID=$!
sleep 0.4
BITBOT_TEAMS_GRAPH_URL=http://127.0.0.1:18783 BITBOT_TEAMS_TOKEN=smoke-teams BITBOT_TEAMS_POST=1 \
  "${RUN[@]}" --approved "teams send teams:Tsmoke :: live teams post $MARKER" >/tmp/parity-teams-live-post.json || true
kill "$TEAMS_POST_PID" >/dev/null 2>&1 || true
wait "$TEAMS_POST_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/parity-teams-live-post.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_teams_chat_message';assert p.get('pretend_live') is False;assert p.get('live_post') is True;print('parity teams live post ok', p.get('mode'))"

# 9j2) Personal Slack DM + live Slack channel post + voice end + host_continued
"${RUN[@]}" --approved "personal slack dm owner=Uowner text=parity dm draft $MARKER" >/tmp/parity-psd-draft.json
python3 -c "import json;d=json.load(open('/tmp/parity-psd-draft.json'));assert d.get('intent')=='personal_slack_dm';h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='personal_slack_dm_draft';assert p.get('personal_dm') is True;assert p.get('live_post') is False;print('parity personal_slack_dm draft ok')"
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18784 --mode slack --token smoke-slack >/tmp/parity-psd-mock.log 2>&1 &
PSD_PID=$!
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18785 --mode slack --token smoke-slack >/tmp/parity-slp-mock.log 2>&1 &
SLP_PID=$!
sleep 0.4
BITBOT_SLACK_API_BASE=http://127.0.0.1:18784 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_POST=1 \
  "${RUN[@]}" --approved "personal slack dm owner=Uowner text=parity dm live $MARKER" >/tmp/parity-psd-live.json || true
BITBOT_SLACK_API_BASE=http://127.0.0.1:18785 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_POST=1 \
  "${RUN[@]}" --approved "reply via slack:Csmoke :: live channel post $MARKER" >/tmp/parity-slack-live-post.json || true
kill "$PSD_PID" "$SLP_PID" >/dev/null 2>&1 || true
wait "$PSD_PID" "$SLP_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/parity-psd-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_personal_slack_dm';assert p.get('personal_dm') is True;assert p.get('live_post') is True;assert p.get('pretend_live') is False;print('parity personal_slack_dm live ok', p.get('ts'))"
python3 -c "import json,os;d=json.load(open('/tmp/parity-slack-live-post.json'));assert d.get('host_continued') is True;h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_slack';assert p.get('live_post') is True;assert p.get('pretend_live') is False;assert p.get('path') and os.path.isfile(p['path']);print('parity live_slack post + host_continued ok', p.get('mode'), p.get('path'))"
"${RUN[@]}" "voice start parity-end-$MARKER" >/tmp/parity-voice-start2.json
"${RUN[@]}" "voice end parity-end-$MARKER" >/tmp/parity-voice-end.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-voice-end.json'));assert d.get('intent')=='voice_end';h=next(x for x in d['host_results'] if x.get('kind')=='voice_end_write');p=json.loads(h['stdout']);assert p.get('pretend_still_live') is False;assert p.get('media_ok') is True;assert p.get('end_artifact_path') and os.path.isfile(p['end_artifact_path']);print('parity voice_end ok', p.get('end_artifact_path'))"

# 9k) OAuth sandbox + load skill + code apply + MCP call + send on behalf + pack evidence
"${RUN[@]}" "setup slack" >/tmp/parity-oauth.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-oauth.json'));h=next(x for x in d['host_results'] if x.get('kind')=='oauth');p=json.loads(h['stdout']);assert p.get('mode')=='sandbox_idp';assert p.get('connected') is True;assert p.get('path') and os.path.isfile(p['path']);assert p.get('pretend_connected') is False;deliv=next(x for x in d['host_results'] if x.get('kind')=='delivery');dp=json.loads(deliv['stdout']);assert dp.get('type')=='widget';print('parity oauth sandbox_idp ok', p.get('status'), p.get('path'))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=local "${RUN[@]}" "setup slack" >/tmp/parity-oauth-ex.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-oauth-ex.json'));h=next(x for x in d['host_results'] if x.get('kind')=='oauth');p=json.loads(h['stdout']);assert p.get('mode')=='local_exchange';assert p.get('path') and os.path.isfile(p['path']);print('parity oauth local_exchange ok', p.get('path'))"
BITBOT_OAUTH_MODE=live BITBOT_OAUTH_EXCHANGE=interactive "${RUN[@]}" "setup slack" >/tmp/parity-oauth-int.json
python3 -c "import json;d=json.load(open('/tmp/parity-oauth-int.json'));h=next(x for x in d['host_results'] if x.get('kind')=='oauth');out=h.get('stdout') or '';assert 'interactive_local' in out;assert 'interactive_browser' in out;print('parity oauth interactive_local ok')"
"${RUN[@]}" "load skill slides presentation" >/tmp/parity-load.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-load.json'));h=next(x for x in d['host_results'] if x.get('kind')=='skill_load');p=json.loads(h['stdout']);assert p.get('pretend_loaded') is False;assert os.path.isfile(p['path']);print('parity skill_load ok', p.get('task'), p.get('loaded_count'))"
"${RUN[@]}" "code changes README.mbt.md" >/tmp/parity-code.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-code.json'));h=next(x for x in d['host_results'] if x.get('kind')=='code_changes');p=json.loads(h['stdout']);assert p.get('applied') is False;assert p.get('pretend_committed') is False;assert p.get('code_apply_residual') is True;assert os.path.isfile(p['path']);print('parity code_changes plan ok')"
BITBOT_CODE_APPLY=1 "${RUN[@]}" "code changes README.mbt.md" >/tmp/parity-code-apply.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-code-apply.json'));h=next(x for x in d['host_results'] if x.get('kind')=='code_changes');p=json.loads(h['stdout']);assert p.get('applied') is True;assert p.get('code_apply_residual') is False;assert p.get('pretend_committed') is False;assert os.path.isfile(p['applied_path']);print('parity code_changes apply ok')"
"${RUN[@]}" --approved 'mcp call user-Gmail.search_threads {"q":"parity"}' >/tmp/parity-mcp-call.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-mcp-call.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mcp_call');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('pretend_ok') is False;assert p.get('path') and os.path.isfile(p['path']);snap=json.load(open(p['path']));assert snap.get('mode')=='stdio-mcp';assert snap.get('pretend_ok') is False;print('parity mcp_call ok', p.get('path'))"
mkdir -p uploads
printf 'FILE_EXPAND_MARKER\n' > uploads/parity-mcp-file-body.txt
printf 'PAYLOAD_MARKER_parity_body\n' > uploads/parity-mcp-write-body.txt
"${RUN[@]}" --approved 'mcp call user-Gmail.search_threads {"body":"$file:uploads/parity-mcp-file-body.txt","q":"invoice"}' >/tmp/parity-mcp-file.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-mcp-file.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mcp_call');p=json.loads(h['stdout']);fe=p.get('file_expand')or{};assert fe.get('expanded_count',0)>=1;assert fe.get('pretend_inject') is False;assert p.get('path') and os.path.isfile(p['path']);print('parity mcp_call file_expand ok', fe.get('expanded_count'), p.get('path'))"
"${RUN[@]}" --approved 'mcp call user-Gmail.write_result {"body":"$file:uploads/parity-mcp-write-body.txt","filename":"parity-mcp-write.txt","write_to_file":true}' >/tmp/parity-mcp-write.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-mcp-write.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mcp_call');p=json.loads(h['stdout']);wtf=p.get('write_to_file')or{};assert wtf.get('write_to_file') is True;assert wtf.get('pretend_inline_payload') is False;assert wtf.get('path') and os.path.isfile(wtf['path']);assert 'PAYLOAD_MARKER_' in open(wtf['path']).read();assert 'PAYLOAD_MARKER_' not in json.dumps(wtf);assert p.get('path') and os.path.isfile(p['path']);print('parity mcp_call write_to_file ok', wtf.get('path'), 'snap', p.get('path'))"
# Live email channel + Slack live thread + android fs_list
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18787 --mode gmail --token smoke-gmail >/tmp/parity-email-ch-mock.log 2>&1 &
EMAIL_CH_PID=$!
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18786 --mode slack --token smoke-slack >/tmp/parity-slack-thread-mock.log 2>&1 &
SLACK_TH_PID=$!
sleep 0.4
BITBOT_GMAIL_API_BASE=http://127.0.0.1:18787 BITBOT_GMAIL_TOKEN=smoke-gmail BITBOT_MAIL_SEND=1 \
  "${RUN[@]}" --approved "reply via email:live@example.com :: channel live mail $MARKER" >/tmp/parity-email-live.json || true
BITBOT_SLACK_API_BASE=http://127.0.0.1:18786 SLACK_BOT_TOKEN=smoke-slack BITBOT_SLACK_POST=1 \
  "${RUN[@]}" --approved "reply via slack:Csmoke thread_ts=1700000000.000100 :: live thread $MARKER" >/tmp/parity-slack-live-thread.json || true
kill "$EMAIL_CH_PID" "$SLACK_TH_PID" >/dev/null 2>&1 || true
wait "$EMAIL_CH_PID" "$SLACK_TH_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/parity-email-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_email_gmail';assert p.get('live_post') is True;assert p.get('pretend_live') is False;print('parity email channel live ok', (p.get('mail') or {}).get('message_id'))"
python3 -c "import json;d=json.load(open('/tmp/parity-slack-live-thread.json'));h=next(x for x in d['host_results'] if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_slack_thread';assert p.get('thread_ts')=='1700000000.000100';assert p.get('pretend_live') is False;print('parity live_slack_thread ok', p.get('mode'))"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-fs "fs list ." >/tmp/parity-android-fs.raw
python3 -c "import json;raw=open('/tmp/parity-android-fs.raw').read().splitlines();d=json.loads(next(l for l in raw if l.startswith('{')));assert d.get('ok');assert d.get('machine_kind')=='android';assert d.get('host_continued') is True;assert d.get('intent')=='fs_list';h=next(x for x in d['host_results'] if x.get('kind')=='fs_list');p=json.loads(h['stdout']);assert p.get('pretend_listing') is False;assert p.get('count',0)>=1;print('parity android fs_list ok', p.get('count'), 'host_continued', d.get('host_continued'))"
"${RUN[@]}" --approved "send on behalf to=parity@example.com subject=Hi body=Hello $MARKER" >/tmp/parity-sob.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sob.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_send');p=json.loads(h['stdout']);assert p.get('provider')=='onbehalf';assert p.get('pretend_sent') is False;assert 'X-BitBot-Send-On-Behalf: 1' in open(p['eml_path']).read();assert p.get('path') and os.path.isfile(p['path']);print('parity send_on_behalf ok', p.get('path'))"
# Pack evidence (unsigned — store certs deferred)
test -f data/tmp/desktop-pack-evidence.json || bash "$ROOT/scripts/pack-desktop.sh" >/tmp/parity-pack-desktop.log 2>&1
python3 -c "import json;d=json.load(open('data/tmp/desktop-pack-evidence.json'));assert d.get('ok') is True;assert d.get('signed') is False;assert d.get('entry_count',0)>=1;print('parity desktop pack evidence ok', d.get('entry_count'), 'signed', d.get('signed'))"
bash "$ROOT/scripts/pack-mobile.sh" >/tmp/parity-pack-mobile.log 2>&1
python3 -c "import json,glob,os;meta=json.load(open('hosts/dist/mobile/meta/store-packaging.json'));assert meta.get('brain')=='cmd/desktop_turn';assert 'ios' in meta and 'android' in meta;u=json.load(open('hosts/dist/mobile/meta/unsigned-release.json'));assert u.get('signed') is False;assert glob.glob('hosts/dist/mobile/archives/*.tar.gz');print('parity mobile pack unsigned ok', u.get('kind'))"

# 10) Multi-end mobile Host strip + ListMachines host-present honesty
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios "list credentials" >/tmp/parity-ios.txt
python3 -c "t=open('/tmp/parity-ios.txt').read();assert 'SendToUser' in t or 'credential_list' in t;assert 'machine_kind=ios' in t;assert 'list_credentials' in t or '\"ok\": true' in t or '\"ok\":true' in t;print('parity ios SendToUser strip ok')"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-perm --approved "device tool camera" >/tmp/parity-ios-perm.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-perm.txt').read();assert 'device_permission' in t or 'HostAbi device_permission' in t;assert 'pretend_granted=false' in t or 'pretend_granted\": false' in t;assert 'machine_kind=ios' in t;mirrors=sorted(glob.glob('data/device/mobile-mirrors/os-card-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('pretend_granted') is False;assert m.get('card_path') and os.path.isfile(m['card_path']);print('parity ios mobile permission mirror ok', m.get('card_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-mail --approved "cold mail to=parity-mobile@example.com subject=Hi body=parity-mobile unsubscribe=mailto:u@example.com" >/tmp/parity-ios-mail.txt
python3 -c "import json,os,glob,re;t=open('/tmp/parity-ios-mail.txt').read();assert 'mail_send' in t;assert 'machine_kind=ios' in t;assert 'HostAbi mail_send path=' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/mail_send-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='mail_send';assert m.get('pretend_sent') is False;assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity ios mobile mail_send delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-mcp --approved 'mcp call user-Gmail.search_threads {"q":"mobile-parity"}' >/tmp/parity-ios-mcp.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-mcp.txt').read();assert 'mcp_call' in t;assert 'machine_kind=ios' in t;assert 'HostAbi mcp_call path=' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/mcp_call-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='mcp_call';assert m.get('host_path') and os.path.isfile(m['host_path']);snap=json.load(open(m['host_path']));assert snap.get('pretend_ok') is False;print('parity ios mobile mcp_call delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-get-plugin "get plugin plugin-slides" >/tmp/parity-ios-get-plugin.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-get-plugin.txt').read();assert 'mcp_get_plugin' in t;assert 'machine_kind=ios' in t;assert 'HostAbi mcp_get_plugin path=' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/mcp_get_plugin-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='mcp_get_plugin';assert m.get('host_path') and os.path.isfile(m['host_path']);snap=json.load(open(m['host_path']));assert snap.get('pretend_plugin') is False;assert snap.get('id')=='plugin-slides';assert snap.get('skill_count',0)>=1;print('parity ios mobile mcp_get_plugin delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-list-plugins "list plugins" >/tmp/parity-and-list-plugins.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-and-list-plugins.txt').read();assert 'mcp_list_plugins' in t;assert 'machine_kind=android' in t;assert 'HostAbi mcp_list_plugins path=' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/mcp_list_plugins-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='mcp_list_plugins';assert m.get('host_path') and os.path.isfile(m['host_path']);snap=json.load(open(m['host_path']));assert snap.get('pretend_listing') is False;assert snap.get('count',0)>=1;print('parity android mobile mcp_list_plugins delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-tm "create teammate id=asst-parity-ios name=ParityIos role=executor" >/tmp/parity-ios-tm.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-tm.txt').read();assert 'teammate_create' in t;assert 'machine_kind=ios' in t;assert 'HostAbi teammate_create path=' in t;assert 'Host FFI continue failed' not in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/teammate_create-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='teammate_create';assert m.get('host_path') and os.path.isfile(m['host_path']);snap=json.load(open(m['host_path']));assert snap.get('pretend_created') is False;print('parity ios mobile teammate_create delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-sched "schedule meeting title=ParityMobile when=tomorrow-5pm" >/tmp/parity-and-sched.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-and-sched.txt').read();assert 'schedule_meeting' in t;assert 'machine_kind=android' in t;assert 'HostAbi schedule_meeting path=' in t;assert 'Host FFI continue failed' not in t;raw=t.splitlines();d=json.loads(next(l for l in raw if l.startswith('{')));assert d.get('host_continued') is True;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/schedule_meeting-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='schedule_meeting';assert m.get('host_path') and os.path.isfile(m['host_path']);cu=next(x for x in d['host_results'] if x.get('kind')=='computer_use');cup=json.loads(cu['stdout']);nav=(cup.get('navigate') or {}).get('url') or '';assert nav=='https://calendar.example.com/create';assert not nav.endswith(')');print('parity android schedule_meeting continue+CU url ok', nav, mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-vr --approved "voice relay parity-ios-vr :: hello mobile" >/tmp/parity-ios-vr.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-vr.txt').read();assert 'voice_relay' in t;assert 'machine_kind=ios' in t;assert 'HostAbi voice_relay path=' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/voice_relay-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='voice_relay';assert m.get('host_path') and os.path.isfile(m['host_path']);snap=json.load(open(m['host_path']));assert snap.get('pretend_silent') is False;assert snap.get('mode')=='host_voice_relay';print('parity ios mobile voice_relay delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-shot "screenshot agent=executor" >/tmp/parity-ios-shot.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-shot.txt').read();assert 'screenshot' in t;assert 'machine_kind=ios' in t;assert 'HostAbi screenshot path=' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/screenshot-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='screenshot';assert m.get('host_path') and os.path.isfile(m['host_path']);snap=json.load(open(m['host_path']));assert snap.get('pretend_live') is False;assert snap.get('read_only') is True;print('parity ios mobile screenshot delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-bcp "box chrome probe" >/tmp/parity-and-bcp.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-and-bcp.txt').read();assert 'box_chrome_probe' in t;assert 'machine_kind=android' in t;assert 'HostAbi box_chrome_probe path=' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/box_chrome_probe-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='box_chrome_probe';assert m.get('host_path') and os.path.isfile(m['host_path']);snap=json.load(open(m['host_path']));assert snap.get('via_box_chrome') is True;assert snap.get('shared_cdp_untouched') is True;print('parity android mobile box_chrome_probe delivery mirror ok', m.get('host_path'), mirrors[-1])"
# Native Host SendToUser surface sources (iOS/Android) must stay wired for multi-end delivery chips.
python3 -c "
from pathlib import Path
ios=Path('hosts/ios/BitBotHost/Sources/BitBotHost/SendToUserSurface.swift').read_text()
kt=Path('hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/SendToUserSurface.kt').read_text()
cv=Path('hosts/ios/BitBotHost/Sources/BitBotHost/ContentView.swift').read_text()
main=Path('hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/MainActivity.kt').read_text()
assert 'formatStrip' in ios and 'SendToUserChipRow' in ios
assert 'formatStrip' in kt and 'SendToUser' in kt
assert 'attachments' in ios and 'pickAttachmentPath' in ios
assert 'attachments' in kt and 'pickAttachmentPath' in kt
assert 'SendToUserSurface' in cv and 'SendToUserSurface' in main
for needle in (
    'productActions',
    'list plugins',
    'get plugin plugin-slides',
    'generate image',
    'voice start',
    'box doctor',
    'box chrome probe',
    'make slides',
    'draft mail',
    'schedule meeting',
    'purchase item',
    'reply via slack:',
    'reply via teams:',
    'finance get_balance',
    'job search',
    'x search moonbit',
    'list workflows',
    'list credentials',
    'react message',
    'screenshot agent=executor',
    'check updates',
    'launch cloud agent',
    'list routines',
    'tick routines',
    'listdir docs',
    'webfetch https://example.com',
    'computer use open',
    'shell echo',
    'cold mail to=',
    'send on behalf to=',
    'claim inbox',
    'author skill name=',
    'export bot template id=',
    'device tools',
    'journal query hello',
    'copy to box machine=',
    'mcp discover',
    'mcp call user-Gmail.search_threads',
    'spawn subagent summarize inbox',
    'travel expedia.com',
    'order food doordash.com',
    'package install cowsay',
):
    assert needle in cv, needle
    assert needle in main, needle
print('parity native SendToUser surface wired ok')
print('parity native product quick actions ok')
"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-fs --approved "listdir docs" >/tmp/parity-and-fs-tools.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-and-fs-tools.txt').read();assert 'fs_list' in t or 'listdir' in t;assert 'machine_kind=android' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/fs_list-*.json'));assert mirrors, t[-600:];m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='fs_list';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity android fs_list delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-claim "claim inbox alpha" >/tmp/parity-ios-claim.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-claim.txt').read();assert 'mail_claim_inbox' in t or 'claim' in t;assert 'machine_kind=ios' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/mail_claim_inbox-*.json'));assert mirrors, t[-600:];m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='mail_claim_inbox';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity ios mail_claim_inbox delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-mach "list machines" >/tmp/parity-and-mach.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-and-mach.txt').read();assert 'machines_list' in t or 'list machines' in t;assert 'machine_kind=android' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/machines_list-*.json'));assert mirrors, t[-600:];m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='machines_list';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity android machines_list delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-dev "device tools" >/tmp/parity-ios-dev.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-dev.txt').read();assert 'device_tools_list' in t;assert 'machine_kind=ios' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/device_tools_list-*.json'));assert mirrors, t[-600:];m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='device_tools_list';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity ios device_tools_list delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-jq "journal query hello" >/tmp/parity-and-jq.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-and-jq.txt').read();assert 'journal_query' in t;assert 'machine_kind=android' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/journal_query-*.json'));assert mirrors, t[-600:];m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='journal_query';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity android journal_query delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-mcp "mcp discover" >/tmp/parity-ios-mcp.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-mcp.txt').read();assert 'mcp_discover' in t;assert 'machine_kind=ios' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/mcp_discover-*.json'));assert mirrors, t[-600:];m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='mcp_discover';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity ios mcp_discover delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-sa --approved "spawn subagent summarize inbox" >/tmp/parity-and-sa.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-and-sa.txt').read();assert 'subagent_run' in t;assert 'machine_kind=android' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/subagent_run-*.json'));assert mirrors, t[-600:];m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='subagent_run';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity android subagent_run delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-fetch "webfetch https://example.com" >/tmp/parity-ios-fetch.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-fetch.txt').read();assert 'webfetch' in t;assert 'machine_kind=ios' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/webfetch-*.json'));assert mirrors, t[-600:];m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='webfetch';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity ios webfetch delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-x "x search moonbit" >/tmp/parity-ios-x.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-ios-x.txt').read();assert 'x_search' in t;assert 'machine_kind=ios' in t;assert 'HostAbi x_search path=' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/x_search-*.json'));assert mirrors;m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='x_search';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity ios x_search delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-fin "finance get_balance" >/tmp/parity-and-fin.txt
python3 -c "import json,os,glob;t=open('/tmp/parity-and-fin.txt').read();assert 'finance_call' in t or 'finance' in t;assert 'machine_kind=android' in t;mirrors=sorted(glob.glob('data/device/mobile-delivery-mirrors/finance_call-*.json'));assert mirrors, t[-600:];m=json.load(open(mirrors[-1]));assert m.get('host_kind')=='finance_call';assert m.get('host_path') and os.path.isfile(m['host_path']);print('parity android finance_call delivery mirror ok', m.get('host_path'), mirrors[-1])"
"${MOBILE[@]}" --machine-kind android --session-id parity-android --approved "listdir docs" >/tmp/parity-android.txt
python3 -c "t=open('/tmp/parity-android.txt').read();assert 'android' in t;assert 'machine_kind=android' in t;print('parity android turn ok')"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-slides "make slides title=MobileParity" >/tmp/parity-ios-slides.txt
python3 -c "t=open('/tmp/parity-ios-slides.txt').read();assert 'SendToUser' in t;assert 'attachment' in t or 'slides_pptx' in t;assert 'SendToUser attachments' in t;assert 'slides_pptx' in t;assert 'machine_kind=ios' in t;print('parity ios slides SendToUser strip+attachments ok')"
"${MOBILE[@]}" --machine-kind android --session-id parity-and-img "generate image android parity aurora" >/tmp/parity-and-img.txt
python3 -c "t=open('/tmp/parity-and-img.txt').read();assert 'generate_image' in t;assert 'SendToUser attachments' in t;assert 'machine_kind=android' in t;print('parity android generate_image attachment strip ok')"
"${RUN[@]}" --machine-kind android --machine-id phone-android "ListMachines" >/tmp/parity-lm-android.json
python3 -c "import json;d=json.load(open('/tmp/parity-lm-android.json'));ms=d.get('machines')or[];a=next(m for m in ms if m.get('kind')=='android');assert a.get('status')=='connected';assert a.get('id')=='phone-android';print('parity android host-present ListMachines ok', a.get('status'))"
"${RUN[@]}" --machine-kind desktop "ListMachines" >/tmp/parity-lm-desk.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-lm-desk.json'));ms=d.get('machines')or[];a=next(m for m in ms if m.get('kind')=='android');assert a.get('status')=='disconnected';ios=next(m for m in ms if m.get('kind')=='ios');assert ios.get('status')=='disconnected';desk=next(m for m in ms if m.get('kind')=='desktop');assert desk.get('status')=='connected';h=next(x for x in d['host_results'] if x.get('kind')=='machines_list');p=json.loads(h['stdout']);assert p.get('pretend_all_connected') is False;assert p.get('host_kind')=='desktop';assert os.path.isfile(p['path']);print('parity desktop ListMachines honesty ok', 'android', a.get('status'), 'ios', ios.get('status'), p.get('path'))"

# 11) Delivery ledger must cover CHARTER SendToUser types after marker
python3 -c "
import json
rows=open('data/delivery/send-to-user.jsonl').read().splitlines()
seen=False; types=set()
for line in rows:
  try: o=json.loads(line)
  except: continue
  if o.get('marker')=='$MARKER':
    seen=True; continue
  if not seen: continue
  if o.get('type'): types.add(o['type'])
assert seen
assert types, 'no SendToUser rows after marker'
need={'text','attachment','widget','reaction','voice','thread','cursor-agent'}
missing=sorted(need-types)
assert not missing, 'missing SendToUser types: %s (have %s)' % (missing, sorted(types))
print('parity SendToUser ledger types', sorted(types))
"

echo "OK: smoke_grok_parity_scenario.sh"
