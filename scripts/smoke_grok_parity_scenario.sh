#!/usr/bin/env bash
# End-to-end Grok-parity scenario smoke (product MoonBit + Host FFI; not LocalBrain).
# Proves CHARTER Delivery SendToUser coverage across a multi-turn script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
RUN=(node hosts/cli_host/run_turn.js)
MOBILE=(node hosts/mobile_host/run.js)

echo "==> Grok parity scenario: multi-turn SendToUser + multi-end"

# Fresh delivery ledger snapshot marker
MARKER="parity-scenario-$(date +%s)"
mkdir -p data/delivery
echo "{\"marker\":\"$MARKER\"}" >> data/delivery/send-to-user.jsonl

# 1) Text channel delivery + Slack thread_ts form (SendToUser type=thread)
"${RUN[@]}" --approved "reply via slack:Csmoke :: parity channel $MARKER" >/tmp/parity-channel.json
python3 -c "import json;d=json.load(open('/tmp/parity-channel.json'));assert d.get('ok');hrs=d.get('host_results') or [];assert any(h.get('kind')=='channel_send' and h.get('ok') for h in hrs);deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv['stdout']);assert dp.get('type')=='text';print('parity channel+text delivery ok', dp.get('type'))"
"${RUN[@]}" --approved "reply via slack:Csmoke thread_ts=1700000000.000100 :: parity thread $MARKER" >/tmp/parity-channel-thread.json
python3 -c "import json;d=json.load(open('/tmp/parity-channel-thread.json'));hrs=d.get('host_results') or [];h=next(x for x in hrs if x.get('kind')=='channel_send');p=json.loads(h['stdout']);assert p.get('thread_ts')=='1700000000.000100';assert 'thread' in str(p.get('mode') or '');deliv=next(x for x in hrs if x.get('kind')=='delivery');dp=json.loads(deliv['stdout']);assert dp.get('type')=='thread';print('parity slack thread_ts delivery ok', p.get('mode'), dp.get('type'))"

# 2) Attachment (schedule ICS)
"${RUN[@]}" "schedule meeting title=Parity when=tomorrow" >/tmp/parity-ics.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-ics.json'));h=next(x for x in d['host_results'] if x.get('kind')=='schedule_meeting');p=json.loads(h['stdout']);assert p.get('ics_ok') and os.path.isfile(p['ics_path']);print('parity attachment ics ok')"

# 3) Widget (approval)
"${RUN[@]}" "shell echo parity-approve" >/tmp/parity-widget.json
python3 -c "import json;d=json.load(open('/tmp/parity-widget.json'));h=next(x for x in d['host_results'] if x.get('kind')=='approval_card');p=json.loads(h['stdout']);assert (p.get('widget') or {}).get('widget_id');print('parity widget ok')"

# 4) Reaction pill
"${RUN[@]}" "[inbound] reaction :+1:" >/tmp/parity-reaction.json
python3 -c "import json;d=json.load(open('/tmp/parity-reaction.json'));h=next(x for x in d['host_results'] if x.get('kind')=='inbound_reaction');p=json.loads(h['stdout']);assert p.get('visible_pill') is True;print('parity reaction ok')"

# 5) Voice
"${RUN[@]}" "voice start parity1" >/tmp/parity-voice.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-voice.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_session');p=json.loads(h['stdout']);assert p.get('media_ok') is True and os.path.isfile(p.get('media_path') or '');print('parity voice ok')"

# 6) Credentials metadata (no secrets)
"${RUN[@]}" "list credentials" >/tmp/parity-creds.json
python3 -c "import json;d=json.load(open('/tmp/parity-creds.json'));assert d.get('intent')=='list_credentials';h=next(x for x in d['host_results'] if x.get('kind')=='credential_list');p=json.loads(h['stdout']);assert p.get('secret_echoed') is False;assert p.get('pretend_secret_view') is False;assert p.get('count')>=1;blob=json.dumps(p);assert 'vault:secret' not in blob.lower();print('parity credentials metadata ok', p.get('count'))"

# 7) Source-control plan artifact (real create gated)
"${RUN[@]}" "source control create_pr" >/tmp/parity-sc.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sc.json'));h=next(x for x in d['host_results'] if x.get('kind')=='source_control');p=json.loads(h['stdout']);assert p.get('pretend_remote_pr') is False;rp=p.get('remote_pr') or {};assert rp.get('plan_path') and os.path.isfile(rp['plan_path']);plan=json.load(open(rp['plan_path']));assert plan.get('pretend_remote_pr') is False;assert plan.get('real_create_gated') is True or rp.get('real_create_gated') is True or p.get('remote_pr_residual') is True;print('parity source_control plan ok', rp.get('mode'), rp.get('plan_path'))"

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
python3 -c "import json;d=json.load(open('/tmp/parity-room.json'));h=next(x for x in d['host_results'] if x.get('kind')=='room_turn');p=json.loads(h['stdout']);stu=p.get('send_to_user') or {};assert p.get('room')=='eng';assert stu.get('type')=='thread';print('parity room/thread ok', p.get('room'), stu.get('type'))"
# Prefer delivery ledger type=thread from recordSendToUser
python3 -c "
import json
rows=open('data/delivery/send-to-user.jsonl').read().splitlines()[-20:]
assert any((json.loads(l).get('type')=='thread') for l in rows if l.strip()), 'missing thread SendToUser'
print('parity thread ledger ok')
"
"${RUN[@]}" "launch cloud agent parity refactor $MARKER" >/tmp/parity-cloud.json
python3 -c "import json;d=json.load(open('/tmp/parity-cloud.json'));h=next(x for x in d['host_results'] if x.get('kind')=='cloud_agent_launch');p=json.loads(h['stdout']);card=p.get('cursor_agent_card') or {};assert card.get('type')=='cursor-agent' or (p.get('delivery') or {}).get('type')=='cursor-agent' or card.get('bc_id');print('parity cursor-agent ok', card.get('bc_id') or (p.get('delivery') or {}).get('bc_id'))"

# 9) Session memory multi-turn (Host seed reinject — not LocalBrain)
SESS="parity-mem-$MARKER"
"${RUN[@]}" --session-id "$SESS" "remember parity_marker=$MARKER" >/tmp/parity-mem-set.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-mem-set.json'));assert d.get('ok');assert d.get('intent')=='memory_update';assert any(m.get('key')=='parity_marker' for m in (d.get('memory') or []));assert os.path.isfile('data/memory/desktop-host.json');print('parity memory update ok')"
"${RUN[@]}" --session-id "$SESS" "recall" >/tmp/parity-mem-get.json
python3 -c "import json;d=json.load(open('/tmp/parity-mem-get.json'));assert d.get('ok');assert d.get('intent')=='memory_recall';blob=json.dumps(d.get('memory') or [])+ (d.get('assistant') or '')+json.dumps(d);assert '$MARKER' in blob;print('parity memory recall reinject ok')"

# 10) Multi-end mobile Host strip
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios "list credentials" >/tmp/parity-ios.txt
python3 -c "t=open('/tmp/parity-ios.txt').read();assert 'SendToUser' in t or 'credential_list' in t;assert 'list_credentials' in t or '\"ok\": true' in t or '\"ok\":true' in t;print('parity ios SendToUser strip ok')"
"${MOBILE[@]}" --machine-kind android --session-id parity-android --approved "listdir docs" >/tmp/parity-android.txt
python3 -c "t=open('/tmp/parity-android.txt').read();assert 'android' in t;print('parity android turn ok')"

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
