#!/usr/bin/env bash
# scripts/smoke_grok_desktop_parity.sh — Wave G 验收（docs/grok-desktop-parity/ipc-contract.md §5）
# 逐 kind：kernel phrase → intent + effects.kind → Host 实跑 → store 文件真实变化。
# 另断言 deny / expired / never / ask-priority 不产生副作用（GP-21/22/23/36）。
set -u
cd "$(dirname "$0")/.." || exit 1
export PATH="$HOME/.moon/bin:$PATH"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad() { FAIL=$((FAIL+1)); echo "  ✗ $1"; }

DATA=data/desktop
turn_json() { # $1 = user phrase, optional env BITBOT_APPROVED=1
  local extra=()
  [ "${BITBOT_APPROVED:-0}" = "1" ] && extra=(--approved)
  node hosts/cli_host/run_turn.js "${extra[@]}" "$1" 2>/dev/null | tail -1
}

field() { node -e "
const fs=require('fs');let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const lines=d.trim().split('\n').filter(l=>l.startsWith('{'));
  try{ const j=JSON.parse(lines[lines.length-1]); const f=process.argv[1];
    if(f==='hostKinds'){ console.log((j.host_results||[]).map(h=>h.kind+':'+(h.ok?'ok':'no')).join(',')); }
    else if(f==='autoApproved'){ console.log(j.auto_approved===true?('yes:'+(j.auto_approved_via||'?')):'no'); }
    else if(f==='cardMode'){ const h=(j.host_results||[]).find(x=>x.kind==='approval_card'); console.log(h?((h.mode||(JSON.parse(h.stdout||'{}').mode)||'normal')):'none'); }
    else console.log(j[f]===undefined?'':String(j[f]));
  }catch(e){ console.log('parse-error'); }
});" "$1"; }

echo "== G-1/G-2 Bot lifecycle =="
before=$(cat $DATA/bots.json 2>/dev/null | md5sum)
j=$(turn_json "create bot Smoke job=verify description=Wave+G+smoke+bot")
echo "$j" | field intent | grep -q create_bot && echo "$j" | field hostKinds | grep -q bot_create:ok && ok "create bot → create_bot → host ok" || bad "create bot chain"
grep -q "Smoke" $DATA/bots.json 2>/dev/null && ok "bots.json contains Smoke" || bad "bots.json missing Smoke"
smid=$(node -e "const b=require('./$DATA/bots.json').bots.find(x=>x.name==='Smoke');console.log(b?b.id:'')")
[ -n "$smid" ] && j=$(turn_json "pin bot $smid") && echo "$j" | field hostKinds | grep -q bot_pin:ok && ok "pin bot → bot_pin ok" || bad "pin bot"
j=$(turn_json "duplicate bot $smid"); echo "$j" | field hostKinds | grep -q bot_duplicate:ok && grep -q "Smoke copy" $DATA/bots.json && ok "duplicate → 'Smoke copy' persisted" || bad "duplicate"
j=$(turn_json "set primary bot $smid"); echo "$j" | field hostKinds | grep -q bot_set_primary:ok && node -e "process.exit(require('./$DATA/bots.json').primary_id==='$smid'?0:1)" && ok "set primary persisted" || bad "set primary"
j=$(turn_json "update bot $smid name=SmokeRenamed"); echo "$j" | field hostKinds | grep -q bot_update:ok && grep -q SmokeRenamed $DATA/bots.json && ok "update bot persisted" || bad "update bot"

echo "== G-1b Hide/Unhide/Delete（GP-06 / GP-07 store-backed）=="
# GP-06 hide 不删数据、不暂停：bots.json 行仍在，仅 hidden=true
j=$(turn_json "hide bot $smid")
echo "$j" | field hostKinds | grep -q bot_hide:ok && ok "hide bot → bot_hide host ok" || bad "hide bot chain"
node -e "
const b=require('./$DATA/bots.json').bots.find(x=>x.id==='$smid');
process.exit(b && b.hidden===true ? 0 : 1)" && ok "GP-06 hide 仅置 hidden 标志，配置行未被删除" || bad "GP-06 hide keeps row"
# 隐藏后主列表不可见，但仍在 hidden_bots 中可寻址（可恢复）
node -e "
const s=require('./hosts/desktop/product_surface.js').createProductSurface(process.cwd());
const v=s.listViews();
const vis=(v.bots||[]).some(x=>x.id==='$smid');
const hid=(v.hidden_bots||[]).some(x=>x.id==='$smid');
process.exit(!vis && hid ? 0 : 1)" && ok "GP-06 hidden bot 离开主列表 → Hidden Bots" || bad "GP-06 listViews hidden"
# 隐藏不暂停 Routines：daemon sweep 仍应看到该 Bot 的 routine
mkdir -p data/routines
node -e "
const fs=require('fs');const p='data/routines/host-routines.json';
const rows=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):[];
rows.push({id:'r-$smid-daily',cron:'@daily',prompt:'smoke routine for $smid',enabled:true,lifecycle:'active'});
fs.writeFileSync(p,JSON.stringify(rows,null,2))"
j=$(turn_json "hide bot $smid")
node -e "
const fs=require('fs');
const rows=JSON.parse(fs.readFileSync('data/routines/host-routines.json','utf8'));
const b=require('./$DATA/bots.json').bots.find(x=>x.id==='$smid');
process.exit(rows.some(r=>r.id==='r-$smid-daily') && b.hidden===true ? 0 : 1)" && ok "GP-06 hide 后 Routines 行仍在（未暂停）" || bad "GP-06 routines survive hide"
j=$(turn_json "unhide bot $smid")
echo "$j" | field hostKinds | grep -q bot_unhide:ok && node -e "
const b=require('./$DATA/bots.json').bots.find(x=>x.id==='$smid');
process.exit(b && b.hidden===false ? 0:1)" && ok "GP-06 unhide 恢复可见" || bad "GP-06 unhide"
# GP-07 未确认必须拒绝执行
node -e "
const fs=require('fs');const f='$DATA/sessions.json';
const s=JSON.parse(fs.readFileSync(f,'utf8'));
s.sessions.unshift({id:'sess-smoke-dm',title:'SmokeRenamed · DM',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),messages:[{role:'user',text:'hi'}]});
fs.writeFileSync(f,JSON.stringify(s,null,2))"
mkdir -p data/workspace && echo "keepme" > data/workspace/smoke-kept.txt
j=$(turn_json "delete bot $smid")
echo "$j" | grep -q needs_confirm && node -e "
const b=require('./$DATA/bots.json').bots.find(x=>x.id==='$smid');
process.exit(b ? 0:1)" && ok "GP-07 未确认 → needs_confirm 且不删除" || bad "GP-07 confirm gate"
echo "$j" | grep -q advise_hide_first && ok "GP-07 建议优先隐藏（advise_hide_first）" || bad "GP-07 hide-first advisory"
j=$(turn_json "confirm delete bot $smid")
echo "$j" | field hostKinds | grep -q bot_delete:ok && node -e "
const b=require('./$DATA/bots.json').bots.find(x=>x.id==='$smid');
process.exit(!b ? 0:1)" && ok "GP-07 确认后 bots.json 行删除" || bad "GP-07 confirmed delete"
node -e "
const s=require('./$DATA/sessions.json');
process.exit(!s.sessions.some(x=>x.id==='sess-smoke-dm') ? 0:1)" && ok "GP-07 DM 会话已级联删除" || bad "GP-07 session cascade"
node -e "
const rows=JSON.parse(require('fs').readFileSync('data/routines/host-routines.json','utf8'));
process.exit(!rows.some(r=>r.id==='r-$smid-daily') ? 0:1)" && ok "GP-07 Routines 已级联删除" || bad "GP-07 routine cascade"
[ -f data/workspace/smoke-kept.txt ] && grep -q keepme data/workspace/smoke-kept.txt && ok "GP-07 共享 Computer 文件保留" || bad "GP-07 workspace kept"
j=$(turn_json "confirm delete bot agent-bit")
echo "$j" | grep -q cannot_delete_builtin && ok "GP-07 内置 agent-bit 拒绝删除" || bad "GP-07 builtin guard"
node -e "require('fs').unlinkSync('data/workspace/smoke-kept.txt')" 2>/dev/null || true
# 删除后重建 Smoke 供后续 G-6 群组用例使用（delete 是级联的，旧 id 不复存在）
j=$(turn_json "create bot Smoke job=verify description=Wave+G+smoke+bot")
smid=$(node -e "const b=require('./$DATA/bots.json').bots.filter(x=>x.name==='Smoke').pop();console.log(b?b.id:'')")
j=$(turn_json "update bot $smid name=SmokeRenamed")
[ -n "$smid" ] && ok "Smoke 重建（G-6 前置）" || bad "Smoke recreate for G-6"

echo "== G-3 审批（GP-20..23）=="
node -e "require('fs').writeFileSync('$DATA/approval-rules.json',JSON.stringify({version:1,rules:[]},null,2))"
j=$(turn_json "shell echo gp21-ask"); [ "$(echo "$j" | field cardMode)" = "normal" ] && ok "无规则 → 正常弹卡（不假放行）" || bad "baseline card"
j=$(turn_json "always allow pattern=shell:*"); echo "$j" | field hostKinds | grep -q approval_rule:ok && ok "approval_rule phrase → host ok" || bad "rule write"
j=$(turn_json "shell echo gp21-auto"); [ "$(echo "$j" | field autoApproved)" = "yes:approval_rule" ] && ok "Always-allow 后同 pattern 不再询问（自动执行）" || bad "auto-allow"
node -e "require('fs').writeFileSync('$DATA/approval-rules.json',JSON.stringify({version:1,rules:[{pattern:'shell:*',decision:'allow',source:'personal'},{pattern:'shell:echo*',decision:'ask',source:'personal'}]},null,2))"
j=$(turn_json "shell echo gp22-ask-first-wins"); [ "$(echo "$j" | field autoApproved)" = "no" ] && ok "GP-22 ask-first 优先于 allow" || bad "ask priority"
node -e "require('fs').writeFileSync('$DATA/approval-rules.json',JSON.stringify({version:1,rules:[]},null,2))"
j=$(turn_json "local execution never"); echo "$j" | field hostKinds | grep -q local_execution_mode:ok || true
j=$(turn_json "shell echo gp36-never"); echo "$j" | grep -q host_approval_card_refused && ok "GP-36 never → 卡被拒且不执行" || bad "never refusal"
j=$(turn_json "local execution ask")
node -e "
const s=require('./hosts/desktop/product_surface.js').createProductSurface(process.cwd());
require('fs').writeFileSync('$DATA/pending-approvals.jsonl','');
const p=s.appendPendingApproval({source:'routine',kind:'shell',command:'echo exp',expires_at:new Date(Date.now()-1000).toISOString()});
const exp=(s.listPendingApprovals().pending.find(x=>x.id===p.id)||{}).status;
const once=s.decideApproval(p.id,'allow_once');
const always=s.decideApproval(p.id,'always');
process.exit(exp==='expired' && once.error==='approval_expired' && always.ok ? 0 : 1);" && ok "GP-23 expired：Allow-once 拒绝 / Always 仍可" || bad "expired semantics"
node -e "require('fs').writeFileSync('$DATA/approval-rules.json',JSON.stringify({version:1,rules:[]},null,2)); require('fs').writeFileSync('$DATA/pending-approvals.jsonl','')"

echo "== G-4 Computer / Take over =="
j=$(turn_json "take over reason=password"); echo "$j" | field hostKinds | grep -q take_over:ok && node -e "process.exit(require('./$DATA/computer.json').takeover.active===true?0:1)" && ok "take_over → computer.json active=true" || bad "takeover begin"
j=$(turn_json "i'm done"); echo "$j" | field hostKinds | grep -q takeover_done:ok && node -e "process.exit(require('./$DATA/computer.json').takeover.active===false?0:1)" && ok "takeover_done → active=false + handback" || bad "takeover end"
j=$(turn_json "recover computer"); echo "$j" | grep -q "recover only from error state\|host_recover_computer" && ok "recover：非错误态被正确拒绝/或恢复（不假装）" || bad "recover guard"
# GP-31: Computer 预览（右侧面板）——只读、不暂停后台、screens 状态落盘
node -e "
const fs=require('fs');const f='$DATA/computer.json';
if(fs.existsSync(f)){const c=JSON.parse(fs.readFileSync(f,'utf8'));c.screens={};fs.writeFileSync(f,JSON.stringify(c,null,2))}"
j=$(turn_json "open computer for bot agent-bit")
echo "$j" | field hostKinds | grep -q computer_preview:ok && ok "open computer → computer_preview host ok" || bad "computer preview chain"
node -e "
const c=require('./$DATA/computer.json');
const sc=(c.screens||{})['agent-bit'];
process.exit(sc && Array.isArray(sc.actions) && sc.actions.some(a=>a.action==='preview_open') ? 0:1)" && ok "GP-31 screens.agent-bit 活动记录落盘" || bad "GP-31 screen record"
j=$(turn_json "take over reason=password")
node -e "
const c=require('./$DATA/computer.json');
const sc=(c.screens||{})['agent-bit']||{};
process.exit(sc.last_action==='takeover' ? 0:1)" && ok "GP-31 takeover 帧/动作进入 screens 状态" || bad "takeover screen record"
j=$(turn_json "i'm done")

echo "== G-5/6 Settings（GP-70..72）=="
j=$(turn_json "set appearance dark"); echo "$j" | field hostKinds | grep -q appearance_set:ok && node -e "process.exit(require('./$DATA/settings.json').appearance==='dark'?0:1)" && ok "appearance dark 持久化" || bad "appearance"
j=$(turn_json "set language en"); grep -q '"language": "en"' $DATA/settings.json && ok "language 持久化" || bad "language"
j=$(turn_json "set timezone Asia/Shanghai"); grep -q "Asia/Shanghai" $DATA/settings.json && ok "timezone 持久化" || bad "timezone"
j=$(turn_json "local execution always"); grep -q '"local_execution": "always"' $DATA/settings.json && ok "local_execution 三档持久化" || bad "local_execution"
node -e "require('fs').writeFileSync('$DATA/settings.json',JSON.stringify({version:1,appearance:'dark',language:'zh-CN',timezone:'Asia/Shanghai',local_execution:'ask',route_traffic:false,notify:{},unread:{},sidebar_collapsed:false},null,2))"

echo "== G-6 群组（GP-50/51）=="
j=$(turn_json "create group chat bots=agent-bit,$smid title=Smoke+room"); echo "$j" | field hostKinds | grep -q group_chat:ok && ok "group chat 建立（2 成员）" || bad "group chat"
j=$(turn_json "create group chat bots=$smid title=One"); echo "$j" | grep -q members_2_to_6 && ok "<2 成员被拒（GP-50）" || bad "member guard"
roomid=$(node -e "const r=require('./$DATA/rooms.json').rooms.find(x=>x.title==='Smoke room');console.log(r?r.id:'')")
j=$(turn_json "room $roomid :: @SmokeRenamed ping"); echo "$j" | grep -q mentioned_only && ok "@BotName → mentioned_only 路由" || bad "mention routing"
j=$(turn_json "room $roomid :: @everyone ping"); echo "$j" | grep -q '"responder_policy": "all"\|all' >/dev/null && echo "$j" | grep -q everyone && ok "@everyone 路由输出存在" || bad "everyone"
j=$(turn_json "room $roomid :: 无人点名"); echo "$j" | grep -q bot_discretion && ok "无 @ → bot_discretion" || bad "discretion"
echo "$j" | grep -q "dm-only" && ok "GP-53 escalations=dm-only（审批不进群）" || bad "dm-only flag"

echo "== G-7 语音（GP-15/60/61）=="
VOICE_MOCK="$PWD/scripts/host_espeak_mock.sh"
node -e "try{require('fs').writeFileSync('data/voice/sessions.json','[]')}catch(e){}"
j=$(BITBOT_ESPEAK_BIN="$VOICE_MOCK" turn_json "voice start uicall7"); echo "$j" | field intent | grep -q voice_start && echo "$j" | field hostKinds | grep -q voice_session:ok && ok "voice start → voice_session host ok" || bad "voice start chain"
node -e "
const rows=require('./data/voice/sessions.json');
const r=rows.find(x=>x&&x.voice_address==='voice:uicall7');
process.exit(r && r.live===true && r.media_ok===true ? 0:1)" && ok "GP-60 会话 live + 真实媒体落盘" || bad "voice session media"
j=$(BITBOT_ESPEAK_BIN="$VOICE_MOCK" turn_json "voice relay uicall7 :: 帮我看下今天的日程"); echo "$j" | field hostKinds | grep -q voice_relay:ok && node -e "
const rows=require('./data/voice/sessions.json');
const r=rows.find(x=>x&&x.voice_address==='voice:uicall7');
process.exit(r && (r.relay_log||[]).length>=1 ? 0:1)" && ok "GP-60 通话中转述进入 relay_log" || bad "voice relay"
j=$(BITBOT_ESPEAK_BIN="$VOICE_MOCK" turn_json "voice end uicall7"); echo "$j" | field hostKinds | grep -q voice_end_write:ok && echo "$j" | grep -q "Voice ended" && ok "voice end → voice_end_write host ok" || bad "voice end chain"
node -e "
const fs=require('fs');
const lines=fs.readFileSync('data/voice/voice-calls/calls.jsonl','utf8').trim().split('\n');
const last=JSON.parse(lines[lines.length-1]);
const rows=require('./data/voice/sessions.json');
const r=rows.find(x=>x&&x.voice_address==='voice:uicall7')||{};
process.exit(last.matched===true && last.media_ok===true && r.live===false ? 0:1)" && ok "GP-60 结束卡数据就绪：matched + media_ok + live=false" || bad "voice end card data"

echo
echo "smoke_grok_desktop_parity: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
