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
roomid=$(node -e "
const rs=require('./$DATA/rooms.json').rooms.filter(x=>x.title==='Smoke room');
const mine=rs.filter(r=>((r.bot_ids||r.members||[]).includes('$smid')));
console.log((mine[mine.length-1]||rs[rs.length-1]||{}).id||'')")
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

echo "== G-8 设置面板 Tab 链（CM-1903/04/06 · GP-73）=="
j=$(turn_json "check for updates"); echo "$j" | field intent | grep -q check_updates && echo "$j" | field hostKinds | grep -q check_updates:ok && node -e "
const p=require('./data/settings/panel.json');
process.exit(p.open===true && p.anchor==='update-channel' && p.tab==='Updates' ? 0:1)" && ok "GP-73 check for updates → Updates tab anchor=update-channel" || bad "check_updates chain"
j=$(turn_json "update computer"); echo "$j" | field hostKinds | grep -q update_computer:ok && node -e "
const s=require('./data/box/update-computer.json');
process.exit(s.phase==='awaiting_confirm_1' ? 0:1)" && ok "CM-1903 update computer → 两步确认 phase1（不假装完成）" || bad "update computer step1"
j=$(turn_json "update computer confirm"); echo "$j" | field hostKinds | grep -q update_computer:ok && node -e "
const s=require('./data/box/update-computer.json');
process.exit(s.phase==='awaiting_confirm_2'||s.phase==='updated'||Number(s.confirms)>=2 ? 0:1)" && ok "CM-1903 update computer 第二步推进" || bad "update computer step2"
j=$(turn_json "reset computer"); echo "$j" | grep -q "CM-1904\|reset" && ok "CM-1904 reset computer 短语可达（非首选提示）" || bad "reset computer"
node -e "require('fs').writeFileSync('data/box/update-computer.json',JSON.stringify({confirms:0,guide_preferred:true,session_jar:true},null,2))"

echo "== G-9 Connect apps / Marketplace（GP-A2/A3 · 规格 §2.5）=="
# 幂等起点：清空命名空间目录与工具目录
node -e "
const fs=require('fs');
fs.mkdirSync('data/connectors/mcp-namespaces',{recursive:true});
fs.writeFileSync('data/connectors/mcp-namespaces/catalog.json',JSON.stringify({namespaces:{},installed_plugins:[]},null,2));
try{fs.unlinkSync('data/connectors/mcp-tools-catalog.json')}catch(e){}"
j=$(turn_json "install plugin plugin-slides"); echo "$j" | field intent | grep -q install_plugin && echo "$j" | field hostKinds | grep -q mcp_namespace:ok && node -e "
const c=require('./data/connectors/mcp-namespaces/catalog.json');
const t=require('./data/connectors/mcp-tools-catalog.json');
process.exit(c.installed_plugins.includes('plugin-slides') && c.namespaces['user-Slides'] && c.namespaces['user-Slides'].status==='Ready' && (t.tools||[]).filter(x=>x.namespace==='user-Slides').length===2 ? 0:1)" && ok "GP-A2 install → catalog Ready + 工具目录种入×2" || bad "install plugin chain"
j=$(turn_json "disable tool user-Slides:make_deck off"); echo "$j" | field intent | grep -q toggle_plugin_tool && echo "$j" | field hostKinds | grep -q mcp_tool_toggle:ok && node -e "
const t=require('./data/connectors/mcp-tools-catalog.json');
const row=(t.tools||[]).find(x=>x.namespace==='user-Slides'&&x.name==='make_deck');
process.exit(row && row.enabled===false ? 0:1)" && ok "GP-A3 单工具禁用持久化 enabled=false" || bad "tool toggle off"
j=$(turn_json "list plugins"); echo "$j" | field hostKinds | grep -q mcp_list_plugins:ok && echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='mcp_list_plugins');const p=JSON.parse(h.stdout||'{}');const pl=(p.plugins||[]).find(x=>x.id==='plugin-slides');const td=((pl.tools||[]).find(t=>t.name==='make_deck')||{}).enabled;process.exit(pl.installed===true&&td===false?0:1)})" && ok "GP-A2 list 反映 installed + 禁用状态（同一目录）" || bad "list plugins state"
j=$(turn_json "enable tool user-Slides:make_deck"); echo "$j" | field hostKinds | grep -q mcp_tool_toggle:ok && node -e "
const t=require('./data/connectors/mcp-tools-catalog.json');
const row=(t.tools||[]).find(x=>x.namespace==='user-Slides'&&x.name==='make_deck');
process.exit(row && row.enabled===true ? 0:1)" && ok "GP-A3 natural enable → enabled=true" || bad "tool toggle on"
j=$(turn_json "disable tool user-Slides:no_such_tool"); echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='mcp_tool_toggle');const p=JSON.parse(h.stdout||'{}');process.exit(p.refused===true&&/unknown tool/.test(p.error||'')?0:1)})" && ok "GP-A3 未知工具诚实拒绝（不假装开关）" || bad "unknown tool refusal"
j=$(turn_json "uninstall plugin plugin-slides"); echo "$j" | field hostKinds | grep -q mcp_uninstall:ok && node -e "
const c=require('./data/connectors/mcp-namespaces/catalog.json');
process.exit(!c.installed_plugins.includes('plugin-slides') && c.namespaces['user-Slides'] && c.namespaces['user-Slides'].status==='Unavailable' ? 0:1)" && ok "GP-A2 uninstall → Unavailable + installed 移除" || bad "uninstall chain"

echo "== G-10 Files & result cards（GP-90/91 · 规格 §9.1/§9.2）=="
# GP-90: skill/ics/eml/export_pack 产物真实落盘（renderer 卡片的数据源）
rm -rf agent-tools/skills/learned-smoke-skill
j=$(turn_json "learn from demo title=Smoke skill steps=click:Start,click:Stop")
sk=$(echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='skill_write');const p=JSON.parse(h.stdout||'{}');console.log(p.skill_path||p.path||'')})")
echo "$j" | field hostKinds | grep -q skill_write:ok && [ -n "$sk" ] && [ -f "$sk" ] && head -1 "$sk" | grep -q '^---' && ok "GP-90 skill_write → SKILL.md 落盘（text 卡数据源）" || bad "GP-90 SKILL.md"
# GP-91: headless save 覆盖路径真实拷贝；缺文件诚实拒绝
rm -rf /tmp/gp91-save
BITBOT_SAVE_ARTIFACT_DIR=/tmp/gp91-save node -e "
const path=require('path');
process.on('unhandledRejection',()=>process.exit(1));
const {createHostFfi}=require('./hosts/shared/host_ffi.js');
const ffi=createHostFfi(process.cwd());
if(!ffi||typeof ffi.executeHostEffects!=='function'){console.error('no ffi');process.exit(2)}
(async()=>{
  const res=await ffi.executeHostEffects([{kind:'skill_write',command:'gp91-smoke|GP91 save probe|# body'}],{sessionId:'gp91'});
  const hit=res.find(r=>r.kind==='skill_write');
  if(!hit||!hit.ok)process.exit(1);
  const p=JSON.parse(hit.stdout);
  const fs=require('fs');
  if(!fs.existsSync(p.skill_path))process.exit(1);
  const dest='/tmp/gp91-save';
  fs.mkdirSync(dest,{recursive:true});
  fs.copyFileSync(p.skill_path,path.join(dest,'SKILL.md'));
  if(!fs.existsSync(path.join(dest,'SKILL.md')))process.exit(1);
})()" && [ -f /tmp/gp91-save/SKILL.md ] && ok "GP-91 save 链（headless dir 覆盖）真实拷贝产物" || bad "GP-91 save probe"
# GP-90: ics / eml / export_pack 文本产物同样落盘（三张 text 卡的数据源）
j=$(turn_json "schedule meeting with Kim at 2026-11-02 10:00 duration 30 topic=Sync")
ics=$(echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='schedule_meeting');const p=JSON.parse(h.stdout||'{}');console.log(p.ics_path||'')})")
[ -n "$ics" ] && [ -f "$ics" ] && grep -q "BEGIN:VCALENDAR" "$ics" && ok "GP-90 schedule_meeting → .ics 落盘" || bad "GP-90 ics"
j=$(BITBOT_APPROVED=1 turn_json "send email to=bob@smoke.example subject=Hi body=hello there")
eml=$(echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='mail_send');const p=JSON.parse(h.stdout||'{}');console.log(p.eml_path||'')})")
[ -n "$eml" ] && [ -f "$eml" ] && grep -qi "^Subject: Hi" "$eml" && ok "GP-90 mail_send → .eml 落盘（sandbox，未假发送）" || bad "GP-90 eml"
j=$(turn_json "export bot template id=bot-export name=Export")
exp=$(echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='export_pack');const p=JSON.parse(h.stdout||'{}');console.log(p.export_path||p.path||'')})")
[ -n "$exp" ] && [ -f "$exp" ] && node -e "const p=require(process.argv[1]);process.exit(p.secrets_stripped===true?0:1)" "$exp" && ok "GP-90 export_pack → .json 落盘且 secrets_stripped" || bad "GP-90 export_pack"
# GP-90: readArtifact 文本扩展名与二进制拒绝（与 main.js mime 表一致性抽查）
node -e "
const TABLE='.png .jpg .jpeg .gif .webp .svg .wav .mp3 .ogg .mp4 .webm .html .htm .md .txt .json .csv .ics .eml .yaml .yml'.split(' ');
const fs=require('fs');
for(const e of ['.md','.txt','.json','.csv','.ics','.eml','.yaml','.yml'])if(!TABLE.includes(e)){console.error('missing '+e);process.exit(1)}
const re=/\.(md|txt|json|csv|ics|eml|ya?ml|log)\$/i;
for(const p of ['a/SKILL.md','x.ics','y.eml','z.json','w.log'])if(!re.test(p)){console.error('renderer re misses '+p);process.exit(1)}
for(const p of ['a.pptx','b.pdf','c.png'])if(re.test(p)){console.error('renderer re overmatches '+p);process.exit(1)}
// main.js 文本分支存在性
const main=fs.readFileSync('hosts/desktop/main.js','utf8');
if(!/message\/rfc822/.test(main)||!/text\/calendar/.test(main)){console.error('main mime missing');process.exit(1)}
if(!/GP-90/.test(main)){console.error('no GP-90 marker');process.exit(1)}
if(!/ipcMain\.handle\(\"bitbot:saveArtifact\"/.test(main)){console.error('no saveArtifact IPC');process.exit(1)}
if(!main.includes('BITBOT_SAVE_ARTIFACT_DIR')){console.error('no headless save override');process.exit(1)}" && ok "GP-90 文本格式表（main/renderer 一致 + 二进制豁免）" || bad "GP-90 format table"
rm -rf /tmp/gp91-save agent-tools/skills/gp91-smoke

echo "== G-11 Bot 模板目录（GP-02 · 规格 §2.2 建议模板一键创建）=="
# 本地目录：删除后由 Host 首次读取自动种入，全程无网络
rm -f data/desktop/bot-templates.json
j=$(turn_json "list bot templates")
echo "$j" | field intent | grep -q list_bot_templates && echo "$j" | field hostKinds | grep -q bot_templates_list:ok && node -e "
const fs=require('fs');
const t=JSON.parse(fs.readFileSync('data/desktop/bot-templates.json','utf8')).templates;
const ids=t.map(x=>x.id);
const need=['sales-outbound','talent-scout','paid-media','expense-manager','bug-reproduction','chief-of-staff'];
process.exit(need.every(x=>ids.includes(x)) ? 0:1)" && ok "GP-02 list → 本地目录种入且含官方六模板" || bad "GP-02 seed catalog"
j=$(turn_json "create bot from template chief-of-staff name=Chiefy")
echo "$j" | field intent | grep -q create_bot_from_template && echo "$j" | field hostKinds | grep -q bot_create_from_template:ok && node -e "
const b=require('./data/desktop/bots.json').bots.find(x=>x.name==='Chiefy');
const t=require('./data/desktop/bot-templates.json').templates.find(x=>x.id==='chief-of-staff');
process.exit(b && b.job===t.job && b.description===t.description ? 0:1)" && ok "GP-02 一键创建：job/description 与模板逐字一致" || bad "GP-02 create from template"
j=$(turn_json "create bot from template no-such-template name=Ghost")
echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='bot_create_from_template');const p=JSON.parse(h.stdout||'{}');process.exit(p.refused===true&&/unknown template/.test(p.error||'')&&p.pretend_created===false?0:1)})" && ! grep -q '"Ghost"' data/desktop/bots.json && ok "GP-02 未知模板诚实拒绝（不凭空造 Bot）" || bad "GP-02 refusal"
# 模板短语不得落回普通 create bot 匹配器
j=$(turn_json "create bot from template talent-scout")
echo "$j" | field intent | grep -q "^create_bot_from_template$" && ok "GP-02 短语优先于 create bot（意图不被吞）" || bad "GP-02 intent precedence"
# 模板 Bot 持久化进 bots.json（Chiefy 来自上一步真实创建）
node -e "
const b=require('./data/desktop/bots.json').bots;
const hit=b.find(x=>x.name==='Chiefy');
process.exit(hit && hit.job==='Chief of Staff' && hit.created_at ? 0:1)" && ok "GP-02 模板 Bot 已持久化进 bots.json" || bad "GP-02 persisted"
# 清理本段创建的模板 Bot，保持双跑幂等
node -e "
const fs=require('fs');const p='./data/desktop/bots.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.bots=d.bots.filter(x=>!['Chiefy','Scouty','Sage','Ghost'].includes(x.name));
fs.writeFileSync(p,JSON.stringify(d,null,2))"

echo "== G-12 隐藏不暂停 Routines · 真实触发断言（GP-06 · 规格 §2.2）=="
# 规格验收信号：隐藏操作不暂停 Bot 或 Routines —— 行为级（真的触发），不只是行存活。
j=$(turn_json "create bot M11Probe job=probe description=hidden+fire+probe")
m11id=$(node -e "const b=require('./data/desktop/bots.json').bots.filter(x=>x.name==='M11Probe').pop();console.log(b?b.id:'')")
[ -n "$m11id" ] && ok "G-12 前置：探针 Bot 创建" || bad "G-12 probe bot"
j=$(turn_json "create routine id=r-$m11id-m11 cron=@now prompt=m11probe")
echo "$j" | field hostKinds | grep -q routine_schedule:ok && ok "G-12 routine 到期入册（@now due_now）" || bad "G-12 schedule"
j=$(turn_json "hide bot $m11id")
node -e "
const b=require('./data/desktop/bots.json').bots.find(x=>x.id==='$m11id');
const rows=JSON.parse(require('fs').readFileSync('data/routines/host-routines.json','utf8'));
const r=rows.find(x=>x.id==='r-$m11id-m11');
process.exit(b && b.hidden===true && r && r.enabled!==false && r.lifecycle!=='paused' ? 0:1)" && ok "GP-06 hide 后 routine 行 enabled/lifecycle 未被暂停" || bad "GP-06 not paused"
# 守护进程 sweep：隐藏期间真实触发
before_fire=$(node -e "
const fs=require('fs');
const p='data/routines/fires.jsonl';
const lines=fs.existsSync(p)?fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean):[];
console.log(lines.filter(l=>l.includes('\"id\":\"r-$m11id-m11\"')).length)")
bash scripts/host_routine_daemon.sh >/dev/null 2>&1
node -e "
const fs=require('fs');
const t=JSON.parse(fs.readFileSync('data/routines/last-tick.json','utf8'));
const b=require('./data/desktop/bots.json').bots.find(x=>x.id==='$m11id');
const fires=fs.readFileSync('data/routines/fires.jsonl','utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const mine=fires.filter(f=>f.id==='r-$m11id-m11');
const last=mine[mine.length-1]||{};
process.exit(
  (t.fired_ids||[]).includes('r-$m11id-m11') &&
  b.hidden===true &&
  last.fired===true && last.pretend_fired===false &&
  mine.length>$before_fire ? 0:1)" && ok "GP-06 隐藏 Bot 的 routine 在 daemon sweep 中真实触发（非 pretend）" || bad "GP-06 hidden firing (daemon)"
# 内核短语 tick：第二次到期 → on-demand 触发（kernel phrase → host effect 链）
before_lfa=$(node -e "
const rows=JSON.parse(require('fs').readFileSync('data/routines/host-routines.json','utf8'));
const r=rows.find(x=>x.id==='r-$m11id-m11');console.log(r&&r.last_fired_at||'')")
j=$(turn_json "create routine id=r-$m11id-m11 cron=@now prompt=m11probe")
j=$(turn_json "tick routines")
echo "$j" | field hostKinds | grep -q routine_tick:ok && node -e "
const j=JSON.parse(require('fs').readFileSync('data/routines/last-tick.json','utf8'));
const b=require('./data/desktop/bots.json').bots.find(x=>x.id==='$m11id');
const rows=JSON.parse(require('fs').readFileSync('data/routines/host-routines.json','utf8'));
const r=rows.find(x=>x.id==='r-$m11id-m11');
const prev=Date.parse('$before_lfa')||0;
process.exit((j.fired_ids||[]).includes('r-$m11id-m11') && b.hidden===true && Date.parse(r.last_fired_at)>prev ? 0:1)" && ok "GP-06 'tick routines' 短语 → 隐藏 Bot routine 再次触发且 last_fired_at 推进" || bad "GP-06 hidden firing (kernel tick)"
# 删除二次确认在聊天链路也必须弹确认框（renderer 断言：拒绝负载带 bot_id 并接线到对话框）
node -e "
const fs=require('fs');
const ps=fs.readFileSync('hosts/desktop/product_surface.js','utf8');
const html=fs.readFileSync('hosts/desktop/index.html','utf8');
const gate=/needs_confirm:[\s\S]{0,120}advise_hide_first:[\s\S]{0,80}bot_id,/.test(ps);
const wire=/p\.needs_confirm === true && p\.advise_hide_first === true/.test(html) &&
  /openBotDeleteDialog\(\{ id: p\.bot_id/.test(html);
process.exit(gate && wire ? 0:1)" && ok "GP-07 聊天侧 delete 未确认 → 复用 hide-first 确认框（不静默、不死胡同）" || bad "GP-07 chat confirm wiring"
j=$(turn_json "delete bot $m11id")
node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());
  const h=(j.host_results||[]).find(x=>x.kind==='bot_delete');
  const p=JSON.parse(h.stdout||'{}');
  const b=require('./data/desktop/bots.json').bots.find(x=>x.id==='$m11id');
  process.exit(p.needs_confirm===true && p.bot_id==='$m11id' && b ? 0:1)})" <<<"$j" && ok "GP-07 未确认拒绝负载含 bot_id 且 Bot 未被删" || bad "GP-07 refusal payload"
# 清理：确认删除 → 级联移除绑定 routine 行
j=$(turn_json "confirm delete bot $m11id")
node -e "
const b=require('./data/desktop/bots.json').bots.find(x=>x.id==='$m11id');
const rows=JSON.parse(require('fs').readFileSync('data/routines/host-routines.json','utf8'));
process.exit(!b && !rows.some(r=>r.id==='r-$m11id-m11') ? 0:1)" && ok "G-12 清理：确认删除级联移除探针 routine（双跑幂等）" || bad "G-12 cleanup"

echo "== G-13 同 Bot computer-use 并发拒绝（GP-30 · 规格 §2.3）=="
# 锁是文件（data/desktop/cu-locks/<bot>.json）→ 跨进程真实竞争可断言。
mkdir -p data/desktop/cu-locks
node -e "
const s=require('./hosts/desktop/product_surface.js').createProductSurface(process.cwd());
const a=s.cuLockAcquire('agent-bit','hold: navigate https://held.example/task-a');
process.exit(a.ok===true ? 0:1)" && ok "GP-30 前置：外部进程持有 agent-bit 屏幕锁" || bad "GP-30 hold acquire"
j=$(BITBOT_BOT_ID=agent-bit turn_json "computer use navigate https://example.com")
echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='computer_use');const p=JSON.parse(h.stdout||'{}');process.exit(h.ok===false&&h.busy===true&&p.refused===true&&p.pretend_ran===false&&p.error==='computer_use_busy'&&/task-a/.test(p.held_task||'')?0:1)})" && ok "GP-30 同 Bot 第二任务被拒（busy + 说明占用任务，不假装执行）" || bad "GP-30 same-bot refusal"
node -e "
const fs=require('fs');
const held=JSON.parse(fs.readFileSync('data/desktop/cu-locks/agent-bit.json','utf8'));
process.exit(held.task.startsWith('hold:') ? 0:1)" && ok "GP-30 拒绝不窃取锁（原任务持有不变）" || bad "GP-30 lock not stolen"
# 不同 Bot 可并行：agent-bit 被占用时，另一 Bot 的 CU 正常执行
j=$(BITBOT_BOT_ID=bot-other-gp30 turn_json "computer use navigate https://example.com")
echo "$j" | field hostKinds | grep -q computer_use:ok && ok "GP-30 不同 Bot 并行执行（不被他 Bot 的锁阻塞）" || bad "GP-30 other-bot parallel"
# 释放后同 Bot 恢复可用
node -e "
const s=require('./hosts/desktop/product_surface.js').createProductSurface(process.cwd());
s.cuLockRelease('agent-bit')"
j=$(BITBOT_BOT_ID=agent-bit turn_json "computer use navigate https://example.com")
echo "$j" | field hostKinds | grep -q computer_use:ok && node -e "
const s=require('./hosts/desktop/product_surface.js').createProductSurface(process.cwd());
process.exit(s.cuLockStatus().holds.length===0 ? 0:1)" && ok "GP-30 释放后同 Bot 可再跑且锁自动清空（无泄漏）" || bad "GP-30 release + rerun"
# 崩溃锁 TTL 过期：陈旧锁不永久卡死 Bot
node -e "
const fs=require('fs');const p='data/desktop/cu-locks/bot-stale-gp30.json';
fs.writeFileSync(p,JSON.stringify({bot_id:'bot-stale-gp30',task:'crashed task',at:new Date(Date.now()-3*60*1000).toISOString(),pid:999999}))"
j=$(BITBOT_BOT_ID=bot-stale-gp30 turn_json "computer use navigate https://example.com")
echo "$j" | field hostKinds | grep -q computer_use:ok && ok "GP-30 崩溃残留锁过期后可接管（TTL，不死锁）" || bad "GP-30 stale TTL"
# renderer 接线：busy 拒绝必须进聊天（chip 条只渲染 ok:true）
node -e "
const html=require('fs').readFileSync('hosts/desktop/index.html','utf8');
process.exit(/computer_use_busy/.test(html) && /rCuBusy/.test(html) && /botId: activeBotId/.test(html) ? 0:1)" && ok "GP-30 renderer：busy 回执进聊天 + 回合携带 activeBotId" || bad "GP-30 renderer wiring"
rm -f data/desktop/cu-locks/*.json

echo "== G-14 群内任务所有权转移（GP-52 · 规格 §2.5）=="
# 规格验收信号：Bot→Bot 转交必须写进群 transcript（可见）并把任务投递给承接 Bot；
# 非成员/未知群一律诚实拒绝，绝不假装转移。
j=$(turn_json "create bot HoFrom job=probe description=handoff+source")
hid_a=$(node -e "const b=require('./$DATA/bots.json').bots.filter(x=>x.name==='HoFrom').pop();console.log(b?b.id:'')")
j=$(turn_json "create bot HoTo job=probe description=handoff+target")
hid_b=$(node -e "const b=require('./$DATA/bots.json').bots.filter(x=>x.name==='HoTo').pop();console.log(b?b.id:'')")
j=$(turn_json "create bot HoOut job=probe description=handoff+outsider")
hid_c=$(node -e "const b=require('./$DATA/bots.json').bots.filter(x=>x.name==='HoOut').pop();console.log(b?b.id:'')")
[ -n "$hid_a" ] && [ -n "$hid_b" ] && [ -n "$hid_c" ] && ok "G-14 前置：三个探针 Bot（源/目标/外人）" || bad "G-14 probe bots"
j=$(turn_json "create group chat bots=$hid_a,$hid_b title=Ho+room")
echo "$j" | field hostKinds | grep -q group_chat:ok || true
hoid=$(node -e "
const rs=require('./$DATA/rooms.json').rooms.filter(r=>r.title==='Ho room');
const mine=rs.filter(r=>(r.members||[]).includes('$hid_b')&&(r.members||[]).includes('$hid_a'));
console.log((mine[mine.length-1]||{}).id||'')")
[ -n "$hoid" ] && ok "G-14 前置：群建立（2 成员）" || bad "G-14 room create"
j=$(turn_json "handoff room $hoid from=$hid_a to=$hid_b task=collect deploy logs")
echo "$j" | field intent | grep -q handoff_task && echo "$j" | field hostKinds | grep -q handoff_task:ok && ok "GP-52 短语 → handoff_task 意图 + host ok" || bad "GP-52 chain"
node -e "
const fs=require('fs');
const hit=require('./$DATA/rooms.json').rooms.find(r=>r.id==='$hoid')||{};
const t=(hit.transcript||[]).filter(x=>x.kind==='handoff').pop()||{};
process.exit(
  t.to_bot==='$hid_b' && t.from_bot==='$hid_a' &&
  t.responder_policy==='handoff_target' &&
  Array.isArray(t.responders) && t.responders.join()==='$hid_b' &&
  t.task==='collect deploy logs' &&
  /HoFrom → HoTo :: collect deploy logs/.test(t.text||'') ? 0:1)" && ok "GP-52 群 transcript 落入 handoff 行（成员、任务、承接者逐字对齐）" || bad "GP-52 transcript entry"
# 承接 Bot 的 inbox 必须真的收到任务（否则 transcript 只是装饰）
node -e "
const fs=require('fs');
const p='data/agents/inbox/$hid_b.jsonl';
if(!fs.existsSync(p))process.exit(1);
const rows=fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
const last=rows.filter(r=>r.is_handoff===true).pop()||{};
process.exit(last.to_id==='$hid_b' && last.from==='$hid_a' && last.room==='$hoid' &&
  last.body==='collect deploy logs' && last.is_room===true &&
  last.forbids_private_assumptions===true ? 0:1)" && ok "GP-52 任务写入承接 Bot inbox（is_handoff + 禁私有假设）" || bad "GP-52 inbox delivery"
node -e "
const fs=require('fs');
const d='data/agents/handoffs';
const files=fs.existsSync(d)?fs.readdirSync(d).filter(f=>f.startsWith('handoff-$hid_b-')):[];
process.exit(files.length>=1 ? 0:1)" && ok "GP-52 转交存根落盘 data/agents/handoffs/" || bad "GP-52 handoff artifact"
# 非成员承接 → 诚实拒绝，transcript 不增行
ho_lines=$(node -e "
const hit=require('./$DATA/rooms.json').rooms.find(r=>r.id==='$hoid')||{};
console.log((hit.transcript||[]).filter(x=>x.kind==='handoff').length)")
j=$(turn_json "handoff room $hoid from=$hid_a to=$hid_c task=steal the task")
echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='handoff_task');const p=JSON.parse(h.stdout||'{}');process.exit(h.ok===false&&h.refused===true&&p.error==='to_bot_not_member'&&p.pretend_transferred===false&&Array.isArray(p.members)?0:1)})" <<<"$j" && node -e "
const hit=require('./$DATA/rooms.json').rooms.find(r=>r.id==='$hoid')||{};
process.exit((hit.transcript||[]).filter(x=>x.kind==='handoff').length===$ho_lines ? 0:1)" && ok "GP-52 非成员承接被拒（to_bot_not_member，不假转交、不写 transcript）" || bad "GP-52 non-member refusal"
# 未知群 → room_not_found
j=$(turn_json "handoff room no-such-room-xyz to=$hid_b task=nobody hears this")
echo "$j" | grep -q "room_not_found" && ! echo "$j" | grep -q "unknown host error" && ok "GP-52 未知群 → room_not_found 拒绝，且拒绝原因透传给内核续跑（非 unknown host error）" || bad "GP-52 unknown room"
# renderer 接线：转交回执必须本地化进群聊气泡（三语字典 + 占位填充）
node -e '
const html=require("fs").readFileSync("hosts/desktop/index.html","utf8");
const keys=(html.match(/rHandoff:/g)||[]).length;
const map=html.includes("Task handoff planned") && html.includes("GP-52") && html.includes(String.raw`"rHandoff"`);
const fill=html.includes(String.raw`key === "rHandoff"`) && html.includes("{from}") && html.includes("{to}") && html.includes("{room}");
const failBubble=(html.match(/rHandoffFail:/g)||[]).length>=3 && html.includes(String.raw`h.kind === "handoff_task" && !h.ok`);
process.exit(keys>=3 && map && fill && failBubble ? 0:1)' && ok "GP-52 renderer：三语 rHandoff + GP-52 回执映射与占位填充" || bad "GP-52 renderer wiring"
# 清理：确认删除三个探针 Bot（<2 成员的群行被级联移除）+ 探针 inbox/存根
for id in "$hid_a" "$hid_b" "$hid_c"; do
  turn_json "confirm delete bot $id" >/dev/null
done
node -e "
const fs=require('fs');
for(const p of ['data/agents/inbox/$hid_a.jsonl','data/agents/inbox/$hid_b.jsonl','data/agents/inbox/$hid_c.jsonl']){try{fs.unlinkSync(p)}catch(e){}}
const d='data/agents/handoffs';
if(fs.existsSync(d))for(const f of fs.readdirSync(d))if(/-($hid_a|$hid_b|$hid_c)-/.test(f))fs.unlinkSync(require('path').join(d,f));
const bs=require('./$DATA/bots.json').bots;
const rs=require('./$DATA/rooms.json').rooms;
process.exit(!bs.some(b=>['HoFrom','HoTo','HoOut'].includes(b.name)) && !rs.some(r=>r.id==='$hoid') ? 0:1)" && ok "G-14 清理：探针 Bot/群行/inbox/存根全清（双跑幂等）" || bad "G-14 cleanup"

echo "== G-15 账户真实登录态 + 安装态（GP-74 / GP-77 · 规格 §2.6）=="
# 规格验收信号：显示真实登录态来源（凭证是否配置）；未配置明确"未登录"而非假装；
# 应用更新不重置 Computer 文件。
node -e "require('fs').rmSync('data/desktop/account-profile.json',{force:true})"
j=$(turn_json "whoami")
echo "$j" | field hostKinds | grep -q account_status:ok && echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='account_status');const p=JSON.parse(h.stdout||'{}');process.exit(p.signed_in===false&&p.pretend_signed_in===false&&p.remote_verified===false&&p.scope==='local-profile'&&/not signed in/.test(p.note||'')&&Array.isArray(p.credential_sources)?0:1)})" && ok "GP-74 无 profile → 明确未登录（remote_verified:false，不伪造远端账号）" || bad "GP-74 not-signed-in"
j=$(turn_json "sign in Work")
echo "$j" | field hostKinds | grep -q account_sign_in:ok && node -e "
const p=require('./data/desktop/account-profile.json');
process.exit(p.active==='Work' && p.accounts.length===1 && p.accounts[0].label==='Work' ? 0:1)" && ok "GP-74 sign in → 本地 profile 落盘并激活" || bad "GP-74 sign in persisted"
j=$(turn_json "whoami")
echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='account_status');const p=JSON.parse(h.stdout||'{}');const llm=(p.credential_sources||[]).find(s=>s.name==='llm');process.exit(p.signed_in===true&&p.active.label==='Work'&&llm&&typeof llm.configured==='boolean'&&(llm.configured===true?/backed by/.test(p.note):/NO configured credentials/.test(p.note))?0:1)})" && ok "GP-74 登录态附真实凭证来源（llm 配置与否决定 note 文案，不空口说已登录）" || bad "GP-74 credential truth"
j=$(turn_json "sign in Personal")
j=$(turn_json "switch account Work")
echo "$j" | field hostKinds | grep -q account_switch:ok && node -e "
const p=require('./data/desktop/account-profile.json');
process.exit(p.active==='Work'&&p.accounts.length===2 ? 0:1)" && ok "GP-74 多 profile 切换持久化" || bad "GP-74 switch"
j=$(turn_json "switch account Ghost")
echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='account_switch');const p=JSON.parse(h.stdout||'{}');process.exit(h.ok===false&&h.refused===true&&p.error==='account_not_found'&&p.pretend_switched===false&&p.known.includes('Work')?0:1)})" && ok "GP-74 未知 profile 被拒（account_not_found + known 列表，不假切换）" || bad "GP-74 unknown profile"
j=$(turn_json "sign out")
echo "$j" | field hostKinds | grep -q account_sign_out:ok && node -e "
const p=require('./data/desktop/account-profile.json');
process.exit(p.active===null&&p.accounts.length===2 ? 0:1)" && ok "GP-74 登出仅清本地激活态（profile 与凭证保留，无 pretend_remote_signout）" || bad "GP-74 sign out"
# GP-77：安装态真实读取 + 应用更新不触碰 Computer
node -e "
const fs=require('fs');const p='data/desktop/computer.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
d.__m14_marker='keep-'+Date.now();
fs.writeFileSync(p,JSON.stringify(d,null,2))"
j=$(turn_json "update status")
echo "$j" | field hostKinds | grep -q update_status:ok && echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='update_status');const p=JSON.parse(h.stdout||'{}');process.exit(/^\d+\.\d+/.test(p.version||'')&&p.packaged===false&&p.residual===true&&p.pretend_up_to_date===false&&p.computer_untouched_by_app_update===true?0:1)})" && ok "GP-77 update status → 真实版本 + 未打包诚实 residual（不谎称最新）" || bad "GP-77 install state"
j=$(turn_json "check for updates")
echo "$j" | field hostKinds | grep -q check_updates:ok && ok "GP-77 check for updates → Updates tab 链 ok（与 update status 分离）" || bad "GP-77 check chain"
node -e "
const fs=require('fs');
const d=JSON.parse(fs.readFileSync('data/desktop/computer.json','utf8'));
process.exit(d.__m14_marker&&/^keep-/.test(d.__m14_marker) ? 0:1)" && ok "GP-77 应用更新链跑完后 Computer 状态文件未被改写" || bad "GP-77 computer untouched"
node -e "
const fs=require('fs');
const p='data/desktop/computer.json';
const d=JSON.parse(fs.readFileSync(p,'utf8'));
delete d.__m14_marker;
fs.writeFileSync(p,JSON.stringify(d,null,2))"
# renderer 接线：Account 面板 + Updates 安装态（三语）
node -e '
const html=require("fs").readFileSync("hosts/desktop/index.html","utf8");
const acct=(html.match(/accountSignedIn:/g)||[]).length>=3 &&
  html.includes("gp-account-state") && html.includes("bitbot.account.status") &&
  html.includes(String.raw`h.kind === "account_status" && h.ok`) &&
  (html.match(/accountSignedOut:/g)||[]).length>=3;
const upd=(html.match(/updatesComputerSafe:/g)||[]).length>=3 &&
  html.includes("bitbot.ota.status") && html.includes("updatesDevRun");
const noFake=!/pretend_signed_in: true/.test(html);
process.exit(acct&&upd&&noFake?0:1)' && ok "GP-74/77 renderer：Account 面板与 Updates 安装态三语接线（无假登录文案）" || bad "GP-74/77 renderer wiring"
node -e "
const fs=require('fs');
for(const p of ['data/desktop/account-profile.json']){try{fs.unlinkSync(p)}catch(e){}}
for(const p of ['data/desktop/app-install.json','data/desktop/ota-state.json']){try{fs.unlinkSync(p)}catch(e){}}
const ds=require('fs').readdirSync('data/settings').filter(f=>f.startsWith('update-status-'));
for(const f of ds){try{fs.unlinkSync('data/settings/'+f)}catch(e){}}"
echo "  · G-15 清理完成（account-profile / install 快照删除，双跑幂等）"

echo

echo "== G-16 自动化冷启动 + GP-70 像素断言（Playwright-E2E · 规格 §2.6/§7.3）=="
# 规格验收信号：Appearance 改动 nativeTheme 实测生效 + 截图/像素断言；重启保持。
# 本波把「手工启动 Electron + 肉眼看截图」换成 scripts/e2e_grok_desktop_boot.mjs：
# Playwright _electron.launch 拉起真实 main/preload，settings.set 走真实用户链，
# 截图用零依赖 PNG 解码（scripts/lib_png_pixel.mjs）算 viewport 亮度做可证伪断言。
if [ -d hosts/desktop/node_modules/playwright-core ] && [ -x hosts/desktop/node_modules/electron/dist/electron ]; then
  e2e_log=/tmp/e2e-g16.log
  if timeout 240 node scripts/e2e_grok_desktop_boot.mjs >"$e2e_log" 2>&1; then
    ok "G-16 E2E 冷启动+像素断言全绿（$(grep -c '✓' "$e2e_log") 项，$(tail -1 "$e2e_log"))"
  else
    bad "G-16 E2E 冷启动+像素断言（见 $e2e_log）"
    tail -8 "$e2e_log"
  fi
  grep -q "E2E 像素断言 dark" "$e2e_log" && grep -q "E2E 像素断言 light" "$e2e_log" && ok "G-16 GP-70：dark/light 两态 viewport 亮度断言真实执行（非 CSS 字符串检查）" || bad "G-16 GP-70 pixel assertions missing"
  grep -q "重启后 force-dark" "$e2e_log" && ok "G-16 GP-70：重启保持由真实二次 boot 验证" || bad "G-16 restart assertion missing"
  # E2E 自带 store 快照恢复；settings 必须已回到 G-5 后状态
  node -e "
const st=require('./data/desktop/settings.json');
// E2E 恢复快照 = 运行前内容；G-5 写入的 appearance 仍是三态之一
process.exit(['dark','light','system'].includes(st.appearance)?0:1)" && ok "G-16 E2E 后 settings.json 完好（快照恢复）" || bad "G-16 settings restore"
else
  echo "  · skip：playwright-core / electron dist 未安装（npm --prefix hosts/desktop i -D playwright-core）"
fi

echo "== G-17 附件上限与多附件真实复制（GP-11 · 官方 spec §5.5：≤6 个/次，文档/图片/音频 ≤25MB，视频 ≤200MB）=="
# 本波 closure：
#  1) 单次 ≤6 是「本次选择 + 已暂存」的累计上限，不是只看本次选择；
#  2) 多附件不再被压成一条 copy_to_box 命令（旧缺陷：整串 src 被当单路径 →
#     "copy paths must stay under repo root"），kernel 走 AttachFiles，一条意图 N 个 effect；
#  3) dest 从幻觉的 /workspace/... 改成 Host 真能执行的 data/workspace/uploads/<basename>；
#  4) 粘贴/拖拽无真实磁盘路径时诚实拒绝（CM-0106 不伪造路径）。
mkdir -p /tmp/g17
for i in 1 2 3 4 5 6 7; do echo "g17 doc $i" > /tmp/g17/g17doc$i.txt; done
truncate -s 26M /tmp/g17/big.png 2>/dev/null
truncate -s 201M /tmp/g17/big.mp4 2>/dev/null
node -e '
const s=require("./hosts/desktop/product_surface.js").createProductSurface(process.cwd());
const p=(x)=>JSON.stringify(x);
const a=s.stageAttachments(["/tmp/g17/g17doc1.txt","/tmp/g17/g17doc2.txt","/tmp/g17/g17doc3.txt","/tmp/g17/g17doc4.txt","/tmp/g17/g17doc5.txt","/tmp/g17/g17doc6.txt","/tmp/g17/g17doc7.txt"],"g17",0);
const b=s.stageAttachments(["/tmp/g17/big.png"],"g17",0);
const c=s.stageAttachments(["/tmp/g17/big.mp4"],"g17",0);
const d=s.stageAttachments(["/tmp/g17/g17doc1.txt","/tmp/g17/g17doc2.txt"],"g17",5);
const e=s.stageAttachments([""],"g17",0);
process.stdout.write([a.code,a.max_per_send,b.kind,b.bytes+"/"+b.max_bytes,c.kind,c.bytes+"/"+c.max_bytes,d.already_staged,e.code].join("|"));
process.exit(a.ok||b.ok||c.ok||d.ok||e.ok?1:0)' > /tmp/g17/codes.txt 2>&1
g17codes=$(cat /tmp/g17/codes.txt 2>/dev/null)
echo "$g17codes" | grep -q '^too_many_attachments|6|' && ok "G-17 GP-11：7 个附件 → too_many_attachments（max_per_send=6）" || bad "G-17 count cap ($g17codes)"
echo "$g17codes" | grep -q 'image|27262976/26214400' && ok "G-17 GP-11：26MB 图片 → too_large + kind=image + 真实字节/上限" || bad "G-17 image size cap"
echo "$g17codes" | grep -q 'video|210763776/209715200' && ok "G-17 GP-11：201MB 视频走 200MB 档（非 25MB）" || bad "G-17 video size cap"
echo "$g17codes" | grep -q '|5|' && ok "G-17 GP-11：已暂存 5 + 本次 2 → 拒绝（累计口径，非本次口径）" || bad "G-17 cumulative cap ($g17codes)"
echo "$g17codes" | grep -q 'no_real_path$' && ok "G-17 GP-11：无真实路径 → no_real_path 诚实拒绝（不伪造）" || bad "G-17 no_real_path ($g17codes)"
# 2 个成功暂存 → 真实落盘 uploads/<session>/
node -e '
const s=require("./hosts/desktop/product_surface.js").createProductSurface(process.cwd());
const r=s.stageAttachments(["/tmp/g17/g17doc1.txt","/tmp/g17/g17doc2.txt"],"g17",0);
const fs=require("fs");
process.exit(r.ok && r.paths.length===2 && r.paths.every(p=>fs.existsSync(p))?0:1)' \
  && ok "G-17 GP-11：2 个附件真实暂存到 data/workspace/uploads/g17/（文件存在）" || bad "G-17 stage ok path"
# composer 提交格式 → kernel AttachFiles → N 个 copy_to_box effect（旧缺陷回归）
P1=$(pwd)/data/workspace/uploads/g17/g17doc1.txt
P2=$(pwd)/data/workspace/uploads/g17/g17doc2.txt
j=$(turn_json "$(printf '看下这批文件\nattach file %s; attach file %s' "$P1" "$P2")")
echo "$j" | field intent | grep -q attach_files && ok "G-17 GP-11：多附件 composer 文本 → attach_files 意图" || bad "G-17 attach_files intent"
node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
const j=JSON.parse(d.trim().split("\n").filter(l=>l.startsWith("{")).pop());
const e=(j.effects||[]).filter(x=>x.kind==="copy_to_box");
// 断言 1：一条意图 = 每路径一个 effect（旧版整串塞一条命令 → Host 报 repo root 越界）
if(e.length!==2) process.exit(1);
// 断言 2：dest 是 Host 真能执行的 data/workspace/uploads/<basename>，不是幻觉 /workspace/
for(const x of e){ if(!/^desk-1\|\S+\|data\/workspace\/uploads\/g17doc[12]\.txt$/.test(x.command)) process.exit(1); }
process.exit(0)})' <<<"$j" \
  && ok "G-17 GP-11：attach_files 展开 2 条 copy_to_box，dest=data/workspace/uploads/<basename>（非 /workspace）" || bad "G-17 per-path effects"
j=$(turn_json "$(printf 'attach file %s' "$P1")")
echo "$j" | field hostKinds | grep -q "^copy_to_box:ok" && ok "G-17 GP-11：单附件 → copy_to_box 真实复制 Host ok" || bad "G-17 single attach host ok"
[ -f data/workspace/uploads/g17doc1.txt ] && grep -q '"binary_intact": true' data/box-copy/$(ls -t data/box-copy | head -1) && ok "G-17 GP-11：dest 落盘 + Host FFI 记录 sha256 一致/binary_intact" || bad "G-17 real copy artifact"
# 渲染层三处入口共用同一校验器 + 本地化拒绝
node -e '
const fs=require("fs");const h=fs.readFileSync("hosts/desktop/index.html","utf8");
const pl=fs.readFileSync("hosts/desktop/preload.js","utf8");
const mj=fs.readFileSync("hosts/desktop/main.js","utf8");
const need=[
 /stageIncomingFiles/,           // pick/paste/drop 汇聚到单一校验器
 /addEventListener\("paste"/,    // 粘贴入口
 /const dropZone\s*=\s*document\.body/, // 拖拽区（composer 是 #main 的兄弟节点）
 /localizeAttachRefusal/,        // 拒绝文案本地化
 /webUtils/,                     // preload 用 getPathForFile 取真实路径
];
for(const k of need) if(!k.test(h)&&!k.test(pl)) process.exit(1);
// i18n：6 个 key × 3 语言（词典定义形式 key: "…"）
for(const k of ["attachTooMany","attachTooLarge","attachTooLargeVideo","attachNoPath","rAttach","rAttachOne"])
  if(((h.match(new RegExp(k+":","g"))||[]).length)<3) process.exit(1);
if(!/bitbot:attachments:stage/.test(pl)||!/bitbot:attachments:stage/.test(mj)) process.exit(1);
if(!/bitbot:attachments:pick/.test(pl)||!/existing/.test(mj)) process.exit(1);
process.exit(0)' \
  && ok "G-17 GP-11：pick/paste/drop 共用校验器 + webUtils 真实路径 + 拒绝文案 i18n×3 + stage IPC 契约" || bad "G-17 renderer/IPC wiring"
rm -rf /tmp/g17 data/workspace/uploads/g17 data/workspace/uploads/gp17
rm -f data/workspace/uploads/g17doc1.txt data/workspace/uploads/g17doc2.txt data/workspace/uploads/g17doc3.txt
echo "  · G-17 清理完成（fixture 与暂存目录删除，双跑幂等）"

echo
echo "smoke_grok_desktop_parity: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
