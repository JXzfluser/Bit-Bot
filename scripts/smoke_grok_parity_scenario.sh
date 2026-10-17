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

# 9b) Shared scope memory + journal durable Host stores
"${RUN[@]}" "shared memory put scope=parity key=marker value=$MARKER" >/tmp/parity-shared-put.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-shared-put.json'));h=next(x for x in d['host_results'] if x.get('kind')=='shared_memory_put');p=json.loads(h['stdout']);assert p.get('stored') is True;assert p.get('isolation')=='scope-bound';assert os.path.isfile(p.get('path') or 'data/memory/shared-scopes.json');print('parity shared_memory put ok')"
"${RUN[@]}" "shared memory read scope=parity key=marker" >/tmp/parity-shared-get.json
python3 -c "import json;d=json.load(open('/tmp/parity-shared-get.json'));h=next(x for x in d['host_results'] if x.get('kind')=='shared_memory_read');p=json.loads(h['stdout']);assert p.get('found') is True;assert p.get('value')=='$MARKER';print('parity shared_memory read ok')"
"${RUN[@]}" "journal note parity $MARKER" >/tmp/parity-journal.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-journal.json'));h=next(x for x in d['host_results'] if x.get('kind')=='journal_append');p=json.loads(h['stdout']);assert p.get('ok') is True or h.get('ok');path=p.get('path') or 'data/journal/events.jsonl';assert os.path.isfile(path);assert '$MARKER' in open(path).read();print('parity journal_append ok', path)"

# 9c) Credential fill → vault metadata → list (never secret echo)
"${RUN[@]}" "fill credential domain=parity.example.test" >/tmp/parity-cred-fill.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-cred-fill.json'));h=next(x for x in d['host_results'] if x.get('kind')=='credential_fill');p=json.loads(h['stdout']);assert p.get('secret_echoed') is False;assert p.get('vault_only') is True;assert p.get('pretend_secret_view') is False;assert os.path.isfile(p.get('vault_path') or 'data/credentials/vault.json');vault=json.load(open(p['vault_path']));ents=vault.get('entries')or[];assert any(e.get('domain')=='parity.example.test' for e in ents);assert all(('password' not in e and 'token' not in e and 'secret' not in e) for e in ents);assert 'secret-ref' not in json.dumps(p)+json.dumps(vault);print('parity credential_fill vault meta ok', p.get('vault_id'))"
"${RUN[@]}" "list credentials" >/tmp/parity-cred-list2.json
python3 -c "import json;d=json.load(open('/tmp/parity-cred-list2.json'));h=next(x for x in d['host_results'] if x.get('kind')=='credential_list');p=json.loads(h['stdout']);assert p.get('secret_echoed') is False;assert any(c.get('domain')=='parity.example.test' for c in p.get('credentials')or[]);print('parity credential_list sees fill ok', p.get('count'))"

# 9d) MCP discover + export pack + subagent + voice relay
"${RUN[@]}" "mcp discover user-Gmail" >/tmp/parity-mcp.json
python3 -c "import json;d=json.load(open('/tmp/parity-mcp.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mcp_discover');assert h.get('ok');print('parity mcp_discover ok')"
"${RUN[@]}" "export bot template name=parity-$MARKER" >/tmp/parity-export.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-export.json'));h=next(x for x in d['host_results'] if x.get('kind')=='export_pack');p=json.loads(h['stdout']);assert p.get('secrets_stripped') is True;assert p.get('path') and os.path.isfile(p['path']);print('parity export_pack ok', p.get('path'))"
"${RUN[@]}" "spawn subagent triage parity-$MARKER" >/tmp/parity-sub.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sub.json'));h=next(x for x in d['host_results'] if x.get('kind')=='subagent_run');p=json.loads(h['stdout']);assert p.get('ran') is True;assert (p.get('subagent') or {}).get('status')=='completed';assert (p.get('send_to_user') or {}).get('type')=='text';print('parity subagent_run ok', (p.get('subagent') or {}).get('id'))"
"${RUN[@]}" "voice start parity-vr" >/tmp/parity-vr-start.json
"${RUN[@]}" "voice relay parity-vr :: hello parity $MARKER" >/tmp/parity-vr.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-vr.json'));h=next(x for x in d['host_results'] if x.get('kind')=='voice_relay');p=json.loads(h['stdout']);assert p.get('reply_media_ok') is True;assert p.get('reply_media_path') and os.path.isfile(p['reply_media_path']);assert open(p['reply_media_path'],'rb').read(4)==b'RIFF';print('parity voice_relay ok', p.get('turns'))"

# 9e) Connectors probe + teammate send + routine tick (Host durable)
"${RUN[@]}" "list connectors" >/tmp/parity-conn.json
python3 -c "import json;d=json.load(open('/tmp/parity-conn.json'));h=next(x for x in d['host_results'] if x.get('kind')=='connectors_probe');p=json.loads(h['stdout']);assert p.get('ok') is True;assert isinstance(p.get('connectors'),dict) and p['connectors'];print('parity connectors_probe ok', sorted(p['connectors'].keys()))"
"${RUN[@]}" "create teammate id=asst-parity name=Parity role=executor" >/tmp/parity-tm.json
python3 -c "import json;d=json.load(open('/tmp/parity-tm.json'));h=next(x for x in d['host_results'] if x.get('kind')=='teammate_create');assert h.get('ok');print('parity teammate_create ok')"
"${RUN[@]}" "send to agent asst-parity :: review parity $MARKER" >/tmp/parity-sta.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sta.json'));h=next(x for x in d['host_results'] if x.get('kind')=='send_to_agent');p=json.loads(h['stdout']);assert p.get('to_id')=='asst-parity';assert (p.get('send_to_user') or {}).get('type')=='text';assert p.get('path') and os.path.isfile(p['path']);print('parity send_to_agent ok', p.get('status'))"
"${RUN[@]}" "create routine id=parity-now cron=@now prompt=ping $MARKER" >/tmp/parity-rt.json
python3 -c "import json;d=json.load(open('/tmp/parity-rt.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_schedule');p=json.loads(h['stdout']);assert p.get('stored') is True;assert p.get('due_now') is True;assert p.get('id')=='parity-now';print('parity routine_schedule @now ok', p.get('next_due'))"
"${RUN[@]}" "tick routines" >/tmp/parity-tick.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-tick.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_tick');p=json.loads(h['stdout']);assert p.get('fired_count',0)>=1;assert any((f.get('id')=='parity-now') for f in (p.get('fired')or[]));assert os.path.isfile(p.get('wakes_path') or 'data/routines/wakes.jsonl') or p.get('wakes');print('parity routine_tick ok', 'fired', p.get('fired_count'), 'due', p.get('due_count'))"
"${RUN[@]}" "fire routine parity-now" >/tmp/parity-fire.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-fire.json'));h=next(x for x in d['host_results'] if x.get('kind')=='routine_fire');p=json.loads(h['stdout']);assert p.get('fired') is True;assert p.get('id')=='parity-now';assert p.get('fires') and os.path.isfile(p['fires']);print('parity routine_fire ok', p.get('next_due'))"

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
python3 -c "import json;d=json.load(open('/tmp/parity-mail-search.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_search');p=json.loads(h['stdout']);assert p.get('mode')=='gmail_live';assert p.get('live_mail_residual') is False;assert p.get('pretend_live') is False;assert p.get('hit_count')>=1;print('parity mail_search live ok', p.get('hit_count'))"
python3 -c "import json;d=json.load(open('/tmp/parity-mail-read.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_read');p=json.loads(h['stdout']);assert p.get('mode')=='gmail_live';assert p.get('live_mail_residual') is False;print('parity mail_read live ok', p.get('thread_id'))"
python3 -c "import json;d=json.load(open('/tmp/parity-mail-send.json'));h=next(x for x in d['host_results'] if x.get('kind')=='mail_send');p=json.loads(h['stdout']);assert p.get('mode')=='live_gmail';assert p.get('sent') is True;assert p.get('pretend_sent') is False;print('parity mail_send live ok', p.get('message_id'))"

"${RUN[@]}" "add section group=parity id=sec-p title=Parity" >/tmp/parity-sec-add.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-sec-add.json'));h=next(x for x in d['host_results'] if x.get('kind')=='section_add');assert h.get('ok');p=json.loads(h['stdout']);assert p.get('ok') is True;assert (p.get('section') or {}).get('id')=='sec-p';assert p.get('pretend_shared') is False;print('parity section_add ok', p.get('section').get('id'), 'existing', p.get('existing'))"
"${RUN[@]}" "section post group=parity section=sec-p from=user body=parity $MARKER" >/tmp/parity-sec-post.json
python3 -c "import json;d=json.load(open('/tmp/parity-sec-post.json'));h=next(x for x in d['host_results'] if x.get('kind')=='section_post');p=json.loads(h['stdout']);assert p.get('isolation_ok') is True;assert p.get('pretend_cross_section') is False;assert (p.get('send_to_user') or {}).get('type')=='text';print('parity section_post ok', p.get('messages_in_section'))"

"${RUN[@]}" "make slides title=Parity $MARKER" >/tmp/parity-slides.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-slides.json'));h=next(x for x in d['host_results'] if x.get('kind')=='slides_pptx');p=json.loads(h['stdout']);assert p.get('pptx_pk_magic_ok') is True;assert p.get('path') and os.path.isfile(p['path']);print('parity slides_pptx ok', p.get('bytes'))"

"${RUN[@]}" --approved "purchase item=ParityWidget cents=500" >/tmp/parity-purchase.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-purchase.json'));h=next(x for x in d['host_results'] if x.get('kind')=='purchase');p=json.loads(h['stdout']);assert p.get('receipt_ok') is True;assert p.get('pretend_paid') is False;assert p.get('paid') is False;assert p.get('live_paid_residual') is True;assert os.path.isfile(p['receipt_path']);print('parity purchase sandbox ok', p.get('mode'))"
python3 "$ROOT/scripts/host_local_http_mock.py" --port 18765 --mode purchase --token smoke-pay >/tmp/parity-pay-mock.log 2>&1 &
PAY_PID=$!
sleep 0.35
BITBOT_PURCHASE_LIVE=1 BITBOT_PURCHASE_TOKEN=smoke-pay BITBOT_PURCHASE_API_URL=http://127.0.0.1:18765 \
  "${RUN[@]}" --approved "purchase item=LiveParity cents=999" >/tmp/parity-purchase-live.json || true
kill "$PAY_PID" >/dev/null 2>&1 || true
wait "$PAY_PID" 2>/dev/null || true
python3 -c "import json;d=json.load(open('/tmp/parity-purchase-live.json'));h=next(x for x in d['host_results'] if x.get('kind')=='purchase');p=json.loads(h['stdout']);assert p.get('mode')=='live_charge';assert p.get('paid') is True;assert p.get('live_paid_residual') is False;assert p.get('pretend_paid') is False;print('parity purchase live ok', (p.get('charge_probe') or {}).get('ok'))"

"${RUN[@]}" "install plugin plugin-slides" >/tmp/parity-plugin.json
python3 -c "import json;d=json.load(open('/tmp/parity-plugin.json'));assert d.get('ok');assert d.get('intent')=='install_plugin';print('parity install_plugin ok')"
"${RUN[@]}" "learn from demo title=ParityCheckout steps=click:Cart|type:email" >/tmp/parity-lfd.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-lfd.json'));h=next(x for x in d['host_results'] if x.get('kind')=='skill_write');p=json.loads(h['stdout']);assert p.get('path') and os.path.isfile(p['path']);body=open(p['path']).read();assert 'click:Cart' in body or 'Steps' in body;print('parity learn_from_demo ok')"
"${RUN[@]}" "author skill name=parity-skill description=demo body=Do the parity thing $MARKER" >/tmp/parity-author.json
python3 -c "import json,os;d=json.load(open('/tmp/parity-author.json'));h=next(x for x in d['host_results'] if x.get('kind')=='skill_write');p=json.loads(h['stdout']);assert p.get('persisted') is True;assert p.get('path') and os.path.isfile(p['path']);print('parity author_skill ok', p.get('name'))"

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
python3 -c "import json,os;d=json.load(open('/tmp/parity-cal.json'));h=next(x for x in d['host_results'] if x.get('kind')=='schedule_meeting');p=json.loads(h['stdout']);assert p.get('mode')=='calendar_live';assert p.get('live_calendar_residual') is False;assert p.get('ics_ok') is True and os.path.isfile(p['ics_path']);print('parity calendar live ok')"
python3 -c "import json;d=json.load(open('/tmp/parity-fin.json'));h=next(x for x in d['host_results'] if x.get('kind')=='finance_call');p=json.loads(h['stdout']);assert p.get('mode')=='finance_live';assert p.get('live_finance_residual') is False;assert p.get('pretend_live') is False;print('parity finance_call live ok')"

# 10) Multi-end mobile Host strip + ListMachines host-present honesty
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios "list credentials" >/tmp/parity-ios.txt
python3 -c "t=open('/tmp/parity-ios.txt').read();assert 'SendToUser' in t or 'credential_list' in t;assert 'machine_kind=ios' in t;assert 'list_credentials' in t or '\"ok\": true' in t or '\"ok\":true' in t;print('parity ios SendToUser strip ok')"
"${MOBILE[@]}" --machine-kind android --session-id parity-android --approved "listdir docs" >/tmp/parity-android.txt
python3 -c "t=open('/tmp/parity-android.txt').read();assert 'android' in t;assert 'machine_kind=android' in t;print('parity android turn ok')"
"${MOBILE[@]}" --machine-kind ios --session-id parity-ios-slides "make slides title=MobileParity" >/tmp/parity-ios-slides.txt
python3 -c "t=open('/tmp/parity-ios-slides.txt').read();assert 'SendToUser' in t;assert 'attachment' in t or 'slides_pptx' in t;assert 'machine_kind=ios' in t;print('parity ios slides SendToUser strip ok')"
"${RUN[@]}" --machine-kind android --machine-id phone-android "ListMachines" >/tmp/parity-lm-android.json
python3 -c "import json;d=json.load(open('/tmp/parity-lm-android.json'));ms=d.get('machines')or[];a=next(m for m in ms if m.get('kind')=='android');assert a.get('status')=='connected';assert a.get('id')=='phone-android';print('parity android host-present ListMachines ok', a.get('status'))"
"${RUN[@]}" --machine-kind desktop "ListMachines" >/tmp/parity-lm-desk.json
python3 -c "import json;d=json.load(open('/tmp/parity-lm-desk.json'));ms=d.get('machines')or[];a=next(m for m in ms if m.get('kind')=='android');assert a.get('status')=='disconnected';print('parity desktop ListMachines android residual disconnected ok')"

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
