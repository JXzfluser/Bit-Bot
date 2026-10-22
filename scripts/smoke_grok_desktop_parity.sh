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

# Builtin row. loadBots() repairs a missing file and a half-written bots.json.
# Call this before any assertion that addresses agent-bit by id (G-1b, G-6, G-26).
ensure_agent_bit() {
  node -e "
const s=require('./hosts/desktop/product_surface.js').createProductSurface(process.cwd());
s.listViews();
const rows=(require('./$DATA/bots.json').bots)||[];
if(!rows.some(b=>b&&b.id==='agent-bit')){console.error('agent-bit missing after seed');process.exit(1);}
"
}

echo "== G-1/G-2 Bot lifecycle =="
ensure_agent_bit
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
ensure_agent_bit
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
# 注意：data/desktop/*.json 不入版本库（.gitignore），干净 clone 里该 store 可能
# 尚不存在——种子写入必须先建目录+建骨架，否则种子静默失败、后续级联断言
# 在 fresh clone 上直接 MODULE_NOT_FOUND（replay check13 实测踩到）。
mkdir -p $DATA
node -e "
const fs=require('fs');const f='$DATA/sessions.json';
const s=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{sessions:[]};
if(!Array.isArray(s.sessions)) s.sessions=[];
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
const fs=require('fs');const f='./$DATA/sessions.json';
const s=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):{sessions:[]};
process.exit(!(s.sessions||[]).some(x=>x.id==='sess-smoke-dm') ? 0:1)" && ok "GP-07 DM 会话已级联删除" || bad "GP-07 session cascade"
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
ensure_agent_bit
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
  # M21 起 E2E 含六次真实 boot（GP-70 ×2 + GP-14 + GP-99 + GP-108/109 + GP-111/112
  # + GP-116..119 + GP-93/94/95），单个 boot 冷启一次约 20–40s，故给足 1500s。
  # 无 live X display 时用 xvfb-run 起一个（DISPLAY 指向不存在的 socket 会让
  # Electron 在 ozone 里 SIGSEGV，被误判成应用问题）。
  e2e_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    e2e_xvfb=(xvfb-run -a)
  fi
  if timeout 1500 "${e2e_xvfb[@]}" node scripts/e2e_grok_desktop_boot.mjs >"$e2e_log" 2>&1; then
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
# G-17 is allowed to remove the only files a clean tree had under data/workspace.
# GP-113/114 count real shared files there, so put one deterministic file back
# instead of hoping an earlier wave left something behind.
mkdir -p data/workspace
printf 'shared-across-bots\n' > data/workspace/m23-shared-keep.txt
echo "  · G-17 清理完成（fixture 与暂存目录删除，双跑幂等；共享文件夹具已放回）"

echo "== G-18 Reply 回复特定消息（GP-14 · 官方 spec §5.1 + 群聊消息路由：被回复消息 id 必须进 kernel 上下文）=="
# 规格验收信号：点回复后 kernel 上下文含被回复消息 id。
# 只看 UI 引用条会是外壳，所以这里跑真实链：store id → kernel --reply-to →
# Host 解析 id→原文 → 注入 provider 请求体（echo-all stub 在 HTTP 层自证）→
# artifact/会话行持久化；伪 id 必须 message_not_found，不得静默吞。
if timeout 300 node scripts/prove_gp14_reply.js > /tmp/g18-probe.log 2>&1; then
  ok "G-18 GP-14 Reply 全链绿（$(grep -c '✓' /tmp/g18-probe.log) 项，$(tail -1 /tmp/g18-probe.log))"
else
  bad "G-18 GP-14 Reply 全链（见 /tmp/g18-probe.log）"
  tail -12 /tmp/g18-probe.log
fi
grep -q "kernel 回显" /tmp/g18-probe.log && grep -q "provider 请求体真含引用行" /tmp/g18-probe.log &&
  ok "G-18 GP-14：kernel 回显 + provider 请求体两级断言真实执行（非源码字符串检查）" || bad "G-18 GP-14 chain assertions missing"
grep -q "message_not_found" /tmp/g18-probe.log && grep -q "unresolved" /tmp/g18-probe.log &&
  ok "G-18 GP-14：伪 id 诚实失败路径被断言（不假装引用成功）" || bad "G-18 GP-14 honest-failure missing"
node -e '
const fs=require("fs");
const t=fs.readFileSync("cmd/desktop_turn/turn_json.mbt","utf8");
const s=fs.readFileSync("hosts/desktop/sessions.js","utf8");
// kernel: reply_to 进 struct/argv/serializer；sessions: 每条消息带持久 id
if(!/reply_to : String/.test(t)||!/--reply-to/.test(t)||t.indexOf("reply_to")<0) process.exit(1);
if(!/buf.write_string\(escape_json_string\(self.reply_to\)\)/.test(t)) process.exit(1);
if(!/function newMessageId/.test(s)||!/\"msg-"/.test(s)) process.exit(1);
if(!/function findMessage/.test(s)||!/message_not_found/.test(s)) process.exit(1);
process.exit(0)' &&
  ok "G-18 GP-14：kernel struct/argv/JSON + store 消息 id/findMessage 契约在位" || bad "G-18 GP-14 contract drift"
node -e '
const fs=require("fs");
const st=JSON.parse(fs.existsSync("data/desktop/sessions.json")?fs.readFileSync("data/desktop/sessions.json","utf8"):"{\"sessions\":[]}");
// 探针自带 store 快照恢复：跑完不得留下 sess-gp14probe 会话（双跑幂等）
process.exit((st.sessions||[]).some(x=>x.id==="sess-gp14probe")?1:0)' &&
  ok "G-18 GP-14 探针恢复 sessions.json 快照（无残留会话）" || bad "G-18 GP-14 store residue"
echo "  · G-18 说明：Reply 目标的 UI 交互（hover 回复按钮 → 引用条 → 切会话重建）由 E2E GP-14 十断言覆盖（G-16 同脚本）"

echo "== G-19 Markdown/链接纪律（GP-93/94/95 · 官方 spec §5.6：链接可点击打开 / 系统浏览器 / 悬停不自动导航）=="
# 规格验收信号：链接可点击打开、悬停预览不自动导航。UI 里挂个 <a> 只是外壳，
# 所以 G-19 跑真实链：provider 裸 URL → kernel CM-0111 markdown 化 → 共享政策
# 模块渲染成 DOM → link_open 路由（scheme 门 + 审计行）。探针不需要 Electron。
if timeout 300 node scripts/prove_gp93_links.js > /tmp/g19-probe.log 2>&1; then
  ok "G-19 GP-93/94/95 全链绿（$(grep -c '✓' /tmp/g19-probe.log) 项，$(tail -1 /tmp/g19-probe.log))"
else
  bad "G-19 GP-93/94/95 全链（见 /tmp/g19-probe.log）"
  tail -12 /tmp/g19-probe.log
fi
grep -q "scheme 门表 14 例全对" /tmp/g19-probe.log && grep -q "javascript: refused" /tmp/g19-probe.log &&
  ok "G-19 GP-94：scheme 门 + 拦截不放行两级断言真实执行" || bad "G-19 GP-94 gate assertions missing"
grep -q "审计留痕 4 行" /tmp/g19-probe.log && grep -q "opened 字段只反映真实" /tmp/g19-probe.log &&
  ok "G-19 GP-94：审计留痕（含被拦截尝试）+ opened 语义诚实性被断言" || bad "G-19 GP-94 audit missing"
grep -q "真实 kernel 回合" /tmp/g19-probe.log && grep -q "投递文本里不存在裸 URL" /tmp/g19-probe.log &&
  ok "G-19 GP-93：kernel 投递链（CM-0111 之前 markdown 化）被断言，非纯函数单测" || bad "G-19 GP-93 kernel chain missing"
node -e '
const fs=require("fs");
const pol=fs.readFileSync("hosts/desktop/link_discipline.js","utf8");
const open=fs.readFileSync("hosts/desktop/link_open.js","utf8");
const main=fs.readFileSync("hosts/desktop/main.js","utf8");
const html=fs.readFileSync("hosts/desktop/index.html","utf8");
// 政策模块：只用 createTextNode/createElement，绝不 innerHTML 赋值
if(/\.innerHTML\s*=/.test(pol)) process.exit(1);
if(!/parseExternalUrl/.test(pol)||!/OPENABLE_SCHEMES\[parsed\.protocol\]/.test(pol)) process.exit(1);
// 审计文件默认落 data/desktop/links.jsonl（gitignored），拒绝路径也写行
if(!/links\.jsonl/.test(open)||!/decision/.test(open)) process.exit(1);
if(!/appendFileSync/.test(open)) process.exit(1);
// main：openExternal 只在 scheme 通过后调用；新窗口一律 deny；导航拦截
if(!/shell\.openExternal\(url\)/.test(main)) process.exit(1);
if(!/setWindowOpenHandler/.test(main)||!/action: "deny"/.test(main)) process.exit(1);
if(!/will-navigate/.test(main)) process.exit(1);
// renderer：正文经政策模块、点击 preventDefault、悬停卡 DOM 存在
if(!/applyLinkBodyTo\(el\.querySelector\("\.body"\), (?:text|fenceText)\)/.test(html)) process.exit(1);
if(!/e\.preventDefault\(\)/.test(html)||!/id="link-preview"/.test(html)) process.exit(1);
process.exit(0)' &&
  ok "G-19 GP-93/94/95：政策模块无 innerHTML + main IPC/窗口守卫 + renderer 契约在位" || bad "G-19 GP-93/94/95 contract drift"
node -e '
const fs=require("fs");
process.exit(fs.existsSync("data/desktop/gp19-probe-links.jsonl")?1:0)' &&
  ok "G-19 GP-94 探针清理审计临时文件（双跑幂等，无残留）" || bad "G-19 GP-94 audit residue"
echo "  · G-19 说明：真实点击/hover/新窗口拦截的 UI 交互由 E2E GP-93/94/95 十四断言覆盖（G-16 同脚本）；Xvfb 下真实浏览器启动抑制为 record-only，审计行 opened:false 并写明原因，不宣称已打开浏览器"

echo
echo "== G-20 界面体验对标（M20：助手气泡 / 侧栏头像与预览 / 标题栏 Bot pill / 连接应用网格与分类）=="
if timeout 120 node scripts/prove_m20_ui.js > /tmp/g20-probe.log 2>&1; then
  ok "G-20 界面契约全绿（$(grep -c '✓' /tmp/g20-probe.log) 项，$(tail -1 /tmp/g20-probe.log)）"
else
  bad "G-20 界面契约（见 /tmp/g20-probe.log）"
fi
grep -q "助手气泡有真实底色" /tmp/g20-probe.log 2>/dev/null \
  && ok "G-20 助手气泡实心圆角（非旧的无框纯文本），且三套主题均非 transparent" \
  || bad "G-20 assistant bubble contract missing"
grep -q "未读点为蓝色圆点" /tmp/g20-probe.log 2>/dev/null \
  && ok "G-20 侧栏：确定性头像色 + 预览行省略 + 蓝色未读点挂行右缘" \
  || bad "G-20 sidebar row contract missing"
grep -q "三列栅格" /tmp/g20-probe.log 2>/dev/null \
  && ok "G-20 标题栏 auto|1fr|auto（Bot pill 居中且不与模型选择器重叠）" \
  || bad "G-20 header grid contract missing"
grep -q "chips 真实过滤插件" /tmp/g20-probe.log 2>/dev/null \
  && ok "G-20 连接应用：两列卡片网格 + 圆角图标 + 分类 chips 真实过滤（非装饰）" \
  || bad "G-20 connect-apps contract missing"
grep -q "正文从未通过 innerHTML 写入" /tmp/g20-probe.log 2>/dev/null \
  && ok "G-20 视觉打磨未破坏 GP-93 唯一安全正文渲染路径" \
  || bad "G-20 render-path regression"
echo "  · G-20 说明：像素级外观由真实 Electron 截图人工比对（scripts/ui_baseline_shot.mjs，属开发工具不入门禁）；门禁只钉可断言的契约，避免把「好看」写成不可验证的声明"

echo
echo "== G-21 信任面（M21：§8.3 密钥输入 / §8.4 Untrusted Content / §8.5 隐私模式）=="
if timeout 300 node scripts/prove_m21_trust.js > /tmp/g21-probe.log 2>&1; then
  ok "G-21 信任面契约全绿（$(grep -c '✓' /tmp/g21-probe.log) 项，$(tail -1 /tmp/g21-probe.log)）"
else
  bad "G-21 信任面契约（见 /tmp/g21-probe.log）"
fi
grep -q "密钥卡输入框是真实" /tmp/g21-probe.log 2>/dev/null \
  && ok "G-21 GP-99：密钥卡是真实 <input type=password>，提交走 Host IPC 而非 composer/bitbot:turn" \
  || bad "G-21 GP-99 secret card contract missing"
grep -q "落盘为密文" /tmp/g21-probe.log 2>/dev/null \
  && grep -q "仅 Host 侧可解出明文" /tmp/g21-probe.log 2>/dev/null \
  && ok "G-21 GP-100：vault 落盘密文 + 只回 ****last4 遮罩（值不出 Host）" \
  || bad "G-21 GP-100 vault contract missing"
grep -q "kernel 拒绝" /tmp/g21-probe.log 2>/dev/null \
  && grep -q "全 data/.*grep 不到明文" /tmp/g21-probe.log 2>/dev/null \
  && ok "G-21 GP-101/102：粘贴密钥被 kernel 拒绝，data/ 全量 grep 不到明文" \
  || bad "G-21 GP-101/102 redaction contract missing"
grep -q "包进 fence 并标注数据来源" /tmp/g21-probe.log 2>/dev/null \
  && grep -q "伪造闭合标签无法越狱" /tmp/g21-probe.log 2>/dev/null \
  && ok "G-21 GP-103：外部结果真实进入 fence（含逃逸防护/未闭合 fail-closed）" \
  || bad "G-21 GP-103 fence contract missing"
grep -q "伪造 Auto-review" /tmp/g21-probe.log 2>/dev/null \
  && grep -q "data-untrusted 角标" /tmp/g21-probe.log 2>/dev/null \
  && ok "G-21 GP-104/105：伪造 Auto-review 仍按数据处置 + UI 有可读来源角标" \
  || bad "G-21 GP-104/105 contract missing"
grep -q "managed by account" /tmp/g21-probe.log 2>/dev/null \
  && grep -q "disabled_by_default" /tmp/g21-probe.log 2>/dev/null \
  && ok "G-21 GP-106/107：隐私模式只读（账户侧管理），不可验证 → disabled_by_default" \
  || bad "G-21 GP-106/107 privacy contract missing"
echo "  · G-21 说明：密钥卡的键入/显示切换与提交后的 [REDACTED] 行由 renderer 契约 + Host vault 双端断言；真实 Electron 交互冒烟见 scripts/e2e_grok_desktop_boot.mjs"

echo
echo "== G-22 先读后执行（M22：§6.4 草稿先行 / execute 需批准 / 只读不打扰）=="
if timeout 600 node scripts/prove_m22_readfirst.js > /tmp/g22-probe.log 2>&1; then
  ok "G-22 先读后执行契约全绿（$(grep -c '✓' /tmp/g22-probe.log) 项，$(tail -1 /tmp/g22-probe.log)）"
else
  bad "G-22 先读后执行契约（见 /tmp/g22-probe.log）"
fi
grep -q "executed/pretend_executed/pretend_fired 全 false" /tmp/g22-probe.log 2>/dev/null \
  && grep -q "产出草稿文件" /tmp/g22-probe.log 2>/dev/null \
  && ok "G-22 GP-108：默认 fire 只准备草稿（draft_path 真实存在 + 三个 false 同时成立）" \
  || bad "G-22 GP-108 draft contract missing"
grep -q "5 类 approval_boundary" /tmp/g22-probe.log 2>/dev/null \
  && grep -q "只有附件投递" /tmp/g22-probe.log 2>/dev/null \
  && ok "G-22 GP-108：草稿随带发送/购买/删除/发布/生产变更审批边界，制备阶段零对外副作用" \
  || bad "G-22 GP-108 boundary/副作用 assertion missing"
grep -q "未 approved 的 execute=1 只出 approval_card" /tmp/g22-probe.log 2>/dev/null \
  && grep -q "approved 后才真实执行" /tmp/g22-probe.log 2>/dev/null \
  && ok "G-22 GP-109：execute=1 未批准只弹卡且 Host 无执行记录；approved 后 executed:true + executed_at" \
  || bad "G-22 GP-109 execute gate missing"
grep -q "execute_via=command" /tmp/g22-probe.log 2>/dev/null \
  && ok "G-22 GP-109：执行记录写明 execute_via（审计可回答“为什么跑了”）" \
  || bad "G-22 GP-109 execute_via missing"
grep -q "四个只读 intent" /tmp/g22-probe.log 2>/dev/null \
  && grep -q "不产生小票" /tmp/g22-probe.log 2>/dev/null \
  && ok "G-22 GP-110：只读 intent 零审批打扰；写入类被拦下且无小票/无执行记录" \
  || bad "G-22 GP-110 read/write split missing"
grep -q "面板 Fire 按钮不带 approved" /tmp/g22-probe.log 2>/dev/null \
  && grep -q "草稿卡的“执行”= 一次显式 approved 回合" /tmp/g22-probe.log 2>/dev/null \
  && ok "G-22 渲染层：Fire 只准备、草稿卡 Execute 才是 approved 回合（准备≠执行）" \
  || bad "G-22 renderer two-phase wiring missing"
echo "  · G-22 说明：本块驱动真实 kernel + Host FFI 跑完整回合（CLI host，与 Desktop 同一条 run_moon_turn），断言基于落盘产物与 host_results，不是源码字符串自证"

echo
echo "== G-23 跨会话记忆（M23：§4.2 每 Bot 独立 / 共享可传递 / 删除不连坐）=="
if timeout 900 node scripts/prove_m23_memory.js > /tmp/g23-probe.log 2>&1; then
  ok "G-23 跨会话记忆契约全绿（$(grep -c '✓' /tmp/g23-probe.log) 项，$(tail -1 /tmp/g23-probe.log)）"
else
  bad "G-23 跨会话记忆契约（见 /tmp/g23-probe.log）"
fi
grep -q "换一个 session 仍能 recall 到同一偏好" /tmp/g23-probe.log 2>/dev/null \
  && ok "G-23 GP-111：同一 Bot 换会话仍记得稳定偏好（--seed-memory 注入生效）" \
  || bad "G-23 GP-111 cross-session recall missing"
grep -q "另一个 Bot 的 recall 命中 0 条" /tmp/g23-probe.log 2>/dev/null \
  && grep -q "desktop-host.json 是 v2 分槽" /tmp/g23-probe.log 2>/dev/null \
  && ok "G-23 GP-112：另一 Bot 看不到（0 命中）且两槽真实落盘" \
  || bad "G-23 GP-112 per-Bot isolation missing"
grep -q "B 能读到 A 写的共享事实" /tmp/g23-probe.log 2>/dev/null \
  && grep -q "跨 Bot 共享文件" /tmp/g23-probe.log 2>/dev/null \
  && ok "G-23 GP-113：共享 scope 与 workspace 文件跨 Bot 可传递" \
  || bad "G-23 GP-113 shared transfer missing"
grep -q "memory_dropped=true" /tmp/g23-probe.log 2>/dev/null \
  && grep -q "B 的 profile 记忆完好" /tmp/g23-probe.log 2>/dev/null \
  && ok "G-23 GP-114：删除 Bot 只清自己那一槽，别的 Bot 记忆与共享文件保留" \
  || bad "G-23 GP-114 delete scope missing"
grep -q "send=allow all" /tmp/g23-probe.log 2>/dev/null \
  && grep -q "不能放行 channel_send" /tmp/g23-probe.log 2>/dev/null \
  && ok "G-23 GP-115：记忆条目永不授权发送/购买（仍弹审批卡）" \
  || bad "G-23 GP-115 memory authority leak"
grep -q "旧扁平" /tmp/g23-probe.log 2>/dev/null \
  && ok "G-23 迁移：旧扁平 store/vault 升级后旧键保留在 agent-bit 槽（不丢用户数据）" \
  || bad "G-23 legacy migration missing"
echo "  · G-23 说明：本块用真实 CLI Host 跑多 Bot 多 session 回合，断言读的是 desktop-host.json / profile-vault.json / shared-scopes.json 与 host_results 的落盘事实"

echo "== G-24 主窗口结构（M24：§2.1 六类入口 / 活动排序 / 尾部区块 / 单一消息流）=="
if timeout 900 node scripts/prove_m24_window.js > /tmp/g24-probe.log 2>&1; then
  ok "G-24 主窗口结构契约全绿（$(grep -c '✓' /tmp/g24-probe.log) 项，$(tail -1 /tmp/g24-probe.log)）"
else
  bad "G-24 主窗口结构契约（见 /tmp/g24-probe.log）"
fi
grep -q "侧边栏顺序 = Bot 列表 → 群组列表 → 会话列表 → 尾部区块" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "六类入口都在 DOM 中" /tmp/g24-probe.log 2>/dev/null \
  && ok "G-24 GP-116：Bot/群组/会话列表与 Hidden/Connect apps/Marketplace/Settings 六类入口齐全且顺序正确" \
  || bad "G-24 GP-116 sidebar entries missing"
grep -q "Marketplace 面板调用 Host templates.list" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "Host bot_templates_list 返回真实目录" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "渲染层没有写死模板数组" /tmp/g24-probe.log 2>/dev/null \
  && ok "G-24 GP-116：Marketplace 模板来自 Host 目录（渲染层无写死数组，无第二份真相）" \
  || bad "G-24 GP-116 marketplace not Host-sourced"
grep -q "Marketplace 一键创建 → Host 真建 Bot" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "新建的 Bot 真的落进 data/desktop/bots.json" /tmp/g24-probe.log 2>/dev/null \
  && ok "G-24 GP-116：市场卡片一键创建是真建 Bot（模板 job/description 落盘）" \
  || bad "G-24 GP-116 template create fake"
grep -q "给旧 Bot 跑一轮 → 它跳到新 Bot 之前" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "很旧但置顶的 Bot 仍然排在所有未置顶 Bot 之前" /tmp/g24-probe.log 2>/dev/null \
  && ok "G-24 GP-117：按真实活动排序，置顶永远压过活动时间" \
  || bad "G-24 GP-117 activity ordering missing"
grep -q "未知 bot id 被拒绝且不会凭空造行" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "回合结束后 Host 广播 bots-changed" /tmp/g24-probe.log 2>/dev/null \
  && ok "G-24 GP-117：未知 id 不造行；回合结束广播 → 侧栏自动重排" \
  || bad "G-24 GP-117 unknown-id/broadcast missing"
grep -q "#sidebar-footer 位于侧边栏最末尾" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "尾部区块顺序 = Hidden Bots → Connect apps → Marketplace → Settings" /tmp/g24-probe.log 2>/dev/null \
  && ok "G-24 GP-118：隐藏入口在侧栏底部尾部区块（不在两个列表之间）" \
  || bad "G-24 GP-118 footer placement missing"
grep -q "群组落进 data/desktop/rooms.json" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "侧栏群组列表读 rooms.list()" /tmp/g24-probe.log 2>/dev/null \
  && ok "G-24 GP-116：侧栏群组列表读 rooms.json（与群组面板同源）" \
  || bad "G-24 GP-116 sidebar room list missing"
grep -q "群聊消息走同一条 runUserTurn → #log" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "只有一个消息流容器 #log" /tmp/g24-probe.log 2>/dev/null \
  && grep -q "右栏开合独立" /tmp/g24-probe.log 2>/dev/null \
  && ok "G-24 GP-119：#log 单一消息流；Computer 与工具右栏独立开合" \
  || bad "G-24 GP-119 single-stream/rails missing"
grep -q "新增侧边栏文案在 zh-CN / zh-TW / en 三套 i18n 里齐全" /tmp/g24-probe.log 2>/dev/null \
  && ok "G-24 i18n：新增入口文案三语齐全（不会露出原始 key）" \
  || bad "G-24 i18n keys missing"
if [ -f /tmp/e2e-g16.log ]; then
  grep -q "E2E GP-116：侧边栏顺序" /tmp/e2e-g16.log \
    && grep -q "E2E GP-118：#sidebar-footer 是侧栏最后一个块" /tmp/e2e-g16.log \
    && grep -q "E2E GP-118：长列表" /tmp/e2e-g16.log \
    && ok "G-24 真实 Electron：侧边栏六类入口顺序、尾部区块落位、长列表就地滚动（DOM 实测）" \
    || bad "G-24 E2E sidebar DOM missing"
  grep -q "E2E GP-116：点 Marketplace 打开模板市场" /tmp/e2e-g16.log \
    && grep -q "E2E GP-116：新建群组后侧栏 #room-list 出现该群" /tmp/e2e-g16.log \
    && ok "G-24 真实 Electron：Marketplace 卡片数 = Host 目录；新建群组立即出现在 #room-list" \
    || bad "G-24 E2E marketplace/room-list missing"
  grep -q "E2E GP-117：侧栏无需手动刷新就把它排到未置顶 Bot 的最前面" /tmp/e2e-g16.log \
    && grep -q "E2E GP-117：置顶 Bot 始终在未置顶 Bot 之前" /tmp/e2e-g16.log \
    && ok "G-24 真实 Electron：发消息后侧栏真重排，置顶块不动" \
    || bad "G-24 E2E reorder missing"
  grep -q "E2E GP-119：打开 Computer 右栏后中央消息流仍 > 200px" /tmp/e2e-g16.log \
    && grep -q "E2E GP-119：Computer 与工具右栏互不搭车" /tmp/e2e-g16.log \
    && ok "G-24 真实 Electron：Computer 右栏打开后中央消息流不被挤为 0，两右栏独立" \
    || bad "G-24 E2E rail geometry missing"
else
  echo "  · skip：/tmp/e2e-g16.log 不存在（E2E 未在本轮运行）"
fi
echo "  · G-24 说明：本块用真实 CLI Host + product_surface 建/删 Bot 与群组，断言读的是 DM 顺序、rooms.json、bot-templates.json 与 host_results，另加一条负向对照（关掉 saveBots 后活动排序断言变红）"


echo "== G-25 Bot 资料管理与创建流程（M25：§2.2 Edit Profile / §2.3 创建流程 / 会话列表）=="
if timeout 900 node scripts/prove_m25_profile.js > /tmp/g25-probe.log 2>&1; then
  ok "G-25 Bot 资料与创建流程契约全绿（$(grep -c '✓' /tmp/g25-probe.log) 项，$(tail -1 /tmp/g25-probe.log)）"
else
  bad "G-25 Bot 资料与创建流程契约（见 /tmp/g25-probe.log）"
fi
grep -q "新增 31 个文案在 zh-CN / zh-TW / en 三套 i18n 里齐全" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 i18n：Edit/Create 对话框与会话分组文案三语齐全（同一屏不混语言）" \
  || bad "G-25 i18n keys missing"
grep -q "渲染层短语 \`create bot New+Bot" /tmp/g25-probe.log 2>/dev/null \
  && grep -q "内核 → Host 建出 \"New Bot\"" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 GP-121：空名创建经内核 → Host 落成 \"New Bot\"（占位名不是渲染层假字）" \
  || bad "G-25 GP-121 placeholder missing"
grep -q "Description 多行文本原样落盘（换行不丢）" /tmp/g25-probe.log 2>/dev/null \
  && grep -q "Description 是多行 textarea" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 GP-121：Description 多行输入与多行落盘（换行不被压平）" \
  || bad "G-25 GP-121 multiline missing"
grep -q "\`update bot … tags=…\` 真写进 bots.json（名称/职责/描述/标签）" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 GP-120：Edit Profile 的 名称/标签/描述 经内核 tags= → Host 真落盘" \
  || bad "G-25 GP-120 update persist missing"
grep -q "\`tags=-\` / \`avatar=-\` 明确清空（与省略字段=保持不变区分开）" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 GP-120：省略字段 = 保持不变，\`-\` = 显式清空（两种语义不混）" \
  || bad "G-25 GP-120 clear-vs-omit missing"
grep -q "头像路径存在 → 保存并把图片读回 data URL（GP-122）" /tmp/g25-probe.log 2>/dev/null \
  && grep -q "不存在的头像路径被 Host 拒绝（invalid_avatar），旧头像保持不变" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 GP-122：头像路径 → data URL 渲染；坏路径被 Host 拒且旧头像保留" \
  || bad "G-25 GP-122 avatar validation missing"
grep -q "侧栏 Bot 行 / 标题 pill 使用真实头像图" /tmp/g25-probe.log 2>/dev/null \
  && grep -q "创建成功后自动打开该 Bot 的对话" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 GP-121/122：头像在侧栏与标题 pill 显示；创建后自动进入该 Bot 对话" \
  || bad "G-25 GP-121/122 avatar-render/auto-open missing"
grep -q "会话按 updated_at 分 今天 / 昨天 / 更早（不是假分组）" /tmp/g25-probe.log 2>/dev/null \
  && grep -q "重命名 / 删除接到已存在的 Host IPC" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 GP-123：今天/昨天/更早分组 + 搜索 + 重命名/删除走既有 Host IPC" \
  || bad "G-25 GP-123 session list missing"
grep -q "bots:op 把 Host 的拒绝也算作失败（不会绿着返回却没保存）" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 GP-120：Host 拒绝的 effect 让 bots.op 返回 ok:false（不假装保存成功）" \
  || bad "G-25 GP-120 refused-effect masking"
grep -q "sessions.rename 真改标题" /tmp/g25-probe.log 2>/dev/null \
  && grep -q "sessions.delete 真删会话并要求 Host 重选 active" /tmp/g25-probe.log 2>/dev/null \
  && ok "G-25 GP-123：rename/delete 改动落在 sessions.json（active 由 Host 重选）" \
  || bad "G-25 GP-123 session store missing"
if [ -f /tmp/e2e-g16.log ]; then
  grep -q "E2E GP-121：Name 留空 → Host 真建出 \"New Bot\"" /tmp/e2e-g16.log \
    && grep -q "E2E GP-121：多行 Description 原样保存" /tmp/e2e-g16.log \
    && grep -q "E2E GP-121：创建完成后自动打开该 Bot 的对话" /tmp/e2e-g16.log \
    && ok "G-25 真实 Electron：空名 → \"New Bot\"、多行 Description 保真、创建后自动打开对话" \
    || bad "G-25 E2E create flow missing"
  grep -q "E2E GP-120：编辑资料预填真实名称，并显示 标签 / 头像 字段" /tmp/e2e-g16.log \
    && grep -q "E2E GP-120：改名 + 标签真写进 bots.json" /tmp/e2e-g16.log \
    && grep -q "E2E GP-120：侧栏行立即同步新名称与标签" /tmp/e2e-g16.log \
    && ok "G-25 真实 Electron：Edit Profile 预填 → 改名+标签落盘 → 侧栏立即同步" \
    || bad "G-25 E2E edit profile missing"
  grep -q "E2E GP-122：保存的头像被侧栏渲染成真实 <img>" /tmp/e2e-g16.log \
    && ok "G-25 真实 Electron：保存的头像在侧栏渲染为真实 <img>（data URL）" \
    || bad "G-25 E2E avatar img missing"
  grep -q "E2E GP-123：会话列表按 今天/昨天/更早 分组" /tmp/e2e-g16.log \
    && grep -q "E2E GP-123：搜索框实时过滤" /tmp/e2e-g16.log \
    && grep -q "E2E GP-123：重命名真写进 sessions.json" /tmp/e2e-g16.log \
    && grep -q "E2E GP-123：确认删除后会话从 sessions.json 与侧栏一起消失" /tmp/e2e-g16.log \
    && ok "G-25 真实 Electron：分组/搜索/重命名/删除全部打到真实 store 与 DOM" \
    || bad "G-25 E2E session list missing"
else
  echo "  · skip：/tmp/e2e-g16.log 不存在（E2E 未在本轮运行）"
fi
echo "  · G-25 说明：本块用真实 CLI 内核 + Host product_surface 跑 create/update bot 与 sessions rename/delete，断言读 bots.json / sessions.json / listViews() 的 avatar_data_url；负向对照为关掉 tags 归一化后 3 条变红"


echo "== G-26 Bot 设置右栏（M26：§2.1 右侧面板 / §4.6 每 Bot 通知开关）=="
ensure_agent_bit
if timeout 900 node scripts/prove_m26_botpanel.js > /tmp/g26-probe.log 2>&1; then
  ok "G-26 Bot 设置右栏契约全绿（$(grep -c '✓' /tmp/g26-probe.log) 项，$(tail -1 /tmp/g26-probe.log)）"
else
  bad "G-26 Bot 设置右栏契约（见 /tmp/g26-probe.log）"
fi
grep -q "#bot-rail 与 Computer 预览共用同一右栏列" /tmp/g26-probe.log 2>/dev/null \
  && grep -q "bot-open 与 computer-open 互斥" /tmp/g26-probe.log 2>/dev/null \
  && ok "G-26 GP-124：Bot 设置与 Computer 预览共用可选右栏且互斥（中央不被挤 0）" \
  || bad "G-26 GP-124 rail placement/exclusion missing"
grep -q "botDetail 返回 ok 且资料来自 bots.json" /tmp/g26-probe.log 2>/dev/null \
  && grep -q "面板资料逐项等于 bots.json" /tmp/g26-probe.log 2>/dev/null \
  && grep -q "记忆条数 = desktop-host.json 该 Bot 槽真实条数" /tmp/g26-probe.log 2>/dev/null \
  && ok "G-26 GP-125：面板字段逐项来自真实 store（bots/记忆/会话/通知），未知 id 拒绝" \
  || bad "G-26 GP-125 detail data missing"
grep -q "会话数按「<name> · DM」约定统计" /tmp/g26-probe.log 2>/dev/null \
  && grep -q "与删除级联同口径" /tmp/g26-probe.log 2>/dev/null \
  && ok "G-26 GP-125：会话计数与删除级联同一命名约定（无第二份口径）" \
  || bad "G-26 GP-125 session-count convention missing"
grep -q "botNotifySet(false) 真写 settings.notify" /tmp/g26-probe.log 2>/dev/null \
  && grep -q "开关是逐 Bot 合并写：另一个 Bot 的设置不被覆盖" /tmp/g26-probe.log 2>/dev/null \
  && ok "G-26 GP-126：每 Bot 通知开关合并写 settings.notify，不覆盖其它 Bot" \
  || bad "G-26 GP-126 notify merge missing"
grep -q "非布尔值被拒绝（invalid_value）" /tmp/g26-probe.log 2>/dev/null \
  && grep -q "未知 Bot id 的通知开关被拒（bot_not_found）" /tmp/g26-probe.log 2>/dev/null \
  && ok "G-26 GP-126：非法值 / 未知 id 都被 Host 拒绝（不写脏数据）" \
  || bad "G-26 GP-126 input validation missing"
grep -q "负向对照：禁用记忆计数后 detail 返回 0" /tmp/g26-probe.log 2>/dev/null \
  && ok "G-26 负向对照：砍掉 botDetail 的记忆计数后契约变红（断言非恒真）" \
  || bad "G-26 negative control missing"
if [ -f /tmp/e2e-g16.log ]; then
  grep -q "E2E GP-124：右键菜单打开 Bot 设置右栏" /tmp/e2e-g16.log \
    && grep -q "E2E GP-124：右栏打开后中央消息流仍 > 200px" /tmp/e2e-g16.log \
    && ok "G-26 真实 Electron：右键 → Bot 设置右栏打开，中央消息流不被挤压" \
    || bad "G-26 E2E rail open missing"
  grep -q "E2E GP-125：面板资料与 bots.json 一致，统计 4 行、操作条就位" /tmp/e2e-g16.log \
    && grep -q "E2E GP-125：标签 chips 数量与 bots.json 一致" /tmp/e2e-g16.log \
    && ok "G-26 真实 Electron：面板资料 / 统计 / 标签与 store 逐项一致" \
    || bad "G-26 E2E panel data missing"
  grep -q "E2E GP-126：关掉面板开关 → settings.json notify" /tmp/e2e-g16.log \
    && grep -q "E2E GP-126：开关关闭后回合通知不再弹出" /tmp/e2e-g16.log \
    && grep -q "E2E GP-126：重新打开开关 → settings.notify 恢复" /tmp/e2e-g16.log \
    && ok "G-26 真实 Electron：§4.6 通知开关真写盘且回合通知真实被抑制" \
    || bad "G-26 E2E notify toggle missing"
  grep -q "E2E GP-124：打开 Computer 预览自动收起 Bot 设置" /tmp/e2e-g16.log \
    && grep -q "E2E GP-127：面板内置顶按钮真写 bots.json" /tmp/e2e-g16.log \
    && ok "G-26 真实 Electron：右栏互斥实测；面板内 Pin 走同一条 Host 短语落盘" \
    || bad "G-26 E2E exclusion/pin missing"
else
  echo "  · skip：/tmp/e2e-g16.log 不存在（E2E 未在本轮运行）"
fi
echo "  · G-26 说明：本块用真实 product_surface botDetail/botNotifySet 打真实 store（bots/settings/memory/sessions），E2E 走真实右键菜单与开关；负向对照为禁用记忆计数后 detail 返回 0"


echo "== G-27 对话详情右栏（M27：§2.1 右栏第三种内容）=="
if timeout 900 node scripts/prove_m27_convrail.js > /tmp/g27-probe.log 2>&1; then
  ok "G-27 对话详情右栏契约全绿（$(grep -c '✓' /tmp/g27-probe.log) 项，$(tail -1 /tmp/g27-probe.log)）"
else
  bad "G-27 对话详情右栏契约（见 /tmp/g27-probe.log）"
fi
grep -q "#conv-rail 与 Computer / Bot 设置共用同一可选右栏列" /tmp/g27-probe.log 2>/dev/null \
  && grep -q "computer / bot / conv 三方互斥" /tmp/g27-probe.log 2>/dev/null \
  && ok "G-27 GP-128：对话详情作为右栏第三种内容，三方互斥不叠加" \
  || bad "G-27 GP-128 placement/exclusion missing"
grep -q "消息数 2（用户 1 / Bot 1）、回复引用 1" /tmp/g27-probe.log 2>/dev/null \
  && grep -q "「最近一条」取真实最后一行" /tmp/g27-probe.log 2>/dev/null \
  && ok "G-27 GP-128：详情统计与最近一条全部可从真实会话行算出" \
  || bad "G-27 GP-128 field math missing"
grep -q "归属 Bot 按「<name> · DM」约定解析" /tmp/g27-probe.log 2>/dev/null \
  && grep -q "与删除级联同口径" /tmp/g27-probe.log 2>/dev/null \
  && ok "G-27 GP-128：归属 Bot 解析与删除级联同一命名约定" \
  || bad "G-27 GP-128 owner convention missing"
grep -q "面板内重命名走 sessions.rename 真改 store" /tmp/g27-probe.log 2>/dev/null \
  && grep -q "删除后会话从 store 消失" /tmp/g27-probe.log 2>/dev/null \
  && grep -q "未知会话 id 在 list 中找不到" /tmp/g27-probe.log 2>/dev/null \
  && ok "G-27 GP-129：只读呈现 + 既有操作；被删/未知会话显示「不存在」" \
  || bad "G-27 GP-129 read-only semantics missing"
grep -q "负向对照：把回复计数写成 0 后与真实 1 条不符" /tmp/g27-probe.log 2>/dev/null \
  && ok "G-27 负向对照：砍掉回复引用计数后契约变红（断言非恒真）" \
  || bad "G-27 negative control missing"
if [ -f /tmp/e2e-g16.log ]; then
  grep -q "E2E GP-128：右键会话 → 对话详情右栏打开" /tmp/e2e-g16.log \
    && grep -q "E2E GP-128：信息 5 行" /tmp/e2e-g16.log \
    && grep -q "E2E GP-128：「最近一条」与 store 的最后一行逐字一致" /tmp/e2e-g16.log \
    && ok "G-27 真实 Electron：详情右栏字段与 sessions.json 逐项一致，中央不被挤压" \
    || bad "G-27 E2E rail fields missing"
  grep -q "E2E GP-128：打开 Bot 设置自动收起对话详情" /tmp/e2e-g16.log \
    && ok "G-27 真实 Electron：右栏三方互斥实测（conv → bot 自动收起）" \
    || bad "G-27 E2E exclusion missing"
  grep -q "E2E GP-129：详情面板内重命名真写 sessions.json 且面板标题随动" /tmp/e2e-g16.log \
    && grep -q "E2E GP-129：删除会话后详情面板自动关闭且会话从 store 消失" /tmp/e2e-g16.log \
    && ok "G-27 真实 Electron：面板内重命名/删除走既有 Host IPC 且面板状态诚实" \
    || bad "G-27 E2E actions missing"
else
  echo "  · skip：/tmp/e2e-g16.log 不存在（E2E 未在本轮运行）"
fi
echo "  · G-27 说明：本块用真实 createSessionStore 建会话/发消息/重命名/删除，断言读 sessions.json 真实行；负向对照为把回复引用计数写死为 0"

echo
echo "== G-28 Usage & Billing 接真回合（M28：§7.1）=="
if timeout 900 node scripts/prove_m28_usage.js > /tmp/g28-probe.log 2>&1; then
  ok "G-28 用量契约全绿（$(grep -c '✓' /tmp/g28-probe.log) 项，$(tail -1 /tmp/g28-probe.log)）"
else
  bad "G-28 用量契约（见 /tmp/g28-probe.log）"
fi
grep -q "executeLlmChat 双路径提取 usage" /tmp/g28-probe.log 2>/dev/null \
  && ok "G-28 GP-130：流式/非流式双路径提取 provider usage，成功回合必 emit usage 事件" \
  || bad "G-28 GP-130 extraction missing"
grep -q "main.js 把 usage 事件写进 surface.recordUsage" /tmp/g28-probe.log 2>/dev/null \
  && grep -q "recordUsage 同 provider/model 累加" /tmp/g28-probe.log 2>/dev/null \
  && ok "G-28 GP-130：usage 事件真写 llm-usage.json，同 provider/model 累加不覆盖" \
  || bad "G-28 GP-130 store wiring missing"
grep -q "provider 未上报 → usage 事件 tokens_reported=false" /tmp/g28-probe.log 2>/dev/null \
  && grep -q "artifact 如实记录 usage.reported=false" /tmp/g28-probe.log 2>/dev/null \
  && ok "G-28 GP-130：provider 未上报时 requests 真记、tokens 不伪造" \
  || bad "G-28 GP-130 unreported honesty missing"
grep -q "面板 per-provider/model 行渲染" /tmp/g28-probe.log 2>/dev/null \
  && grep -q "三套 i18n 齐全" /tmp/g28-probe.log 2>/dev/null \
  && ok "G-28 GP-131：Usage & Billing 面板 per-row 明细 + 三语文案（未上报 tokens 如实标注）" \
  || bad "G-28 GP-131 panel missing"
grep -q "负向对照：禁用提取后 tokens_reported 翻假" /tmp/g28-probe.log 2>/dev/null \
  && ok "G-28 负向对照：砍掉 usage 提取后 tokens_reported 翻假（断言非恒真）" \
  || bad "G-28 negative control missing"
if [ -f /tmp/e2e-g16.log ]; then
  grep -q "E2E GP-130：真实回合把 usage 写进 llm-usage.json" /tmp/e2e-g16.log \
    && ok "G-28 真实 Electron：真回合 → usage 落盘（tokens=stub 上报的 11/7 倍数）" \
    || bad "G-28 E2E store missing"
  grep -q "E2E GP-131：Usage & Billing 面板 per-row 行与 store 一致" /tmp/e2e-g16.log \
    && ok "G-28 真实 Electron：设置 → Usage tab 显示同一真实行" \
    || bad "G-28 E2E panel missing"
else
  echo "  · skip：/tmp/e2e-g16.log 不存在（E2E 未在本轮运行）"
fi
echo "  · G-28 说明：probe 用进程内 OpenAI 兼容 stub（带/不带 usage 两种）走真实 executeHostEffects(llm_chat)，store/artifact/env 在 finally 恢复"

echo
echo "== G-29 群聊入口（M29：§2.4）=="
if timeout 900 node scripts/prove_m29_roomchat.js > /tmp/g29-probe.log 2>&1; then
  ok "G-29 群聊入口契约全绿（$(grep -c '✓' /tmp/g29-probe.log) 项，$(tail -1 /tmp/g29-probe.log)）"
else
  bad "G-29 群聊入口契约（见 /tmp/g29-probe.log）"
fi
grep -q "composer 提交走既有 kernel RoomTurn 短语" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-119：群组行 → composer 对准群聊，提交走既有 room <id> :: 短语（无第二消息面）" \
  || bad "G-29 GP-119 composer prefix missing"
grep -q "@Name → mentioned_only 且 responders 精确" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "@everyone → all" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "无 @ → bot_discretion" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-51：入口沿用真实路由语义（含含空格成员名的最长匹配修复）" \
  || bad "G-29 GP-51 routing missing"
grep -q "rooms.json transcript 与 roomTurn 逐字一致" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "空群明说" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-119：打开群聊读 rooms.json 真实 transcript，空群不造历史" \
  || bad "G-29 GP-119 transcript missing"
grep -q "负向对照：禁用前缀后 composer 不再路由到群聊" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 负向对照：砍掉 composer 前缀后断言变红（断言非恒真）" \
  || bad "G-29 negative control missing"

echo
echo "== G-30 附件发送前预览（M30：§5.1 验收信号）=="
if timeout 900 node scripts/prove_m30_attachpreview.js > /tmp/g30-probe.log 2>&1; then
  ok "G-30 附件预览契约全绿（$(grep -c '✓' /tmp/g30-probe.log) 项，$(tail -1 /tmp/g30-probe.log)）"
else
  bad "G-30 附件预览契约（见 /tmp/g30-probe.log）"
fi
grep -q "真实 PNG → kind=image + data:image/png;base64" /tmp/g30-probe.log 2>/dev/null \
  && ok "G-30 GP-§5.1：图片附件 chip 预览真实字节（缩略图来自磁盘，不造图）" \
  || bad "G-30 image preview missing"
grep -q "mp4 → kind=video、data_url=null" /tmp/g30-probe.log 2>/dev/null \
  && grep -q "缺失路径 → preview_unavailable" /tmp/g30-probe.log 2>/dev/null \
  && ok "G-30 GP-§5.1：非图片类型+体积徽标，缺失/空路径诚实拒绝" \
  || bad "G-30 kind badge/refusal missing"
grep -q "IPC bitbot:attachments:preview + preload" /tmp/g30-probe.log 2>/dev/null \
  && grep -q "pick 与 paste/drop 两个入口都先渲染 chip" /tmp/g30-probe.log 2>/dev/null \
  && ok "G-30 GP-§5.1：preview IPC 全链暴露，pick/paste/drop 入口接线" \
  || bad "G-30 wiring missing"
grep -q "负向对照：禁用缩略图生成后 data_url 退化 null" /tmp/g30-probe.log 2>/dev/null \
  && ok "G-30 负向对照：砍掉缩略图生成后断言变红（断言非恒真）" \
  || bad "G-30 negative control missing"

echo "== G-31 消息反应 React（M31：§5.1 验收信号）=="
if timeout 900 node scripts/prove_m31_reactions.js > /tmp/g31-probe.log 2>&1; then
  ok "G-31 消息反应契约全绿（$(grep -c '✓' /tmp/g31-probe.log) 项，$(tail -1 /tmp/g31-probe.log)）"
else
  bad "G-31 消息反应契约（见 /tmp/g31-probe.log）"
fi
grep -q "hover「反应」按钮 + 6 emoji picker" /tmp/g31-probe.log 2>/dev/null \
  && ok "G-31 GP-§5.1：hover 反应按钮 + 6 emoji picker（与 Reply 同一条 msg-actions）" \
  || bad "G-31 react affordance missing"
grep -q "chips 从 store 行渲染" /tmp/g31-probe.log 2>/dev/null \
  && ok "G-31 GP-§5.1：chips 从 store 行渲染，点击 chip 走同一 IPC 撤销" \
  || bad "G-31 reaction chips missing"
grep -q "transcript 重载把 reactions 传给 addMsg" /tmp/g31-probe.log 2>/dev/null \
  && ok "G-31 GP-§5.1：transcript 重载把 reactions 传给 addMsg（重载不丢反应）" \
  || bad "G-31 transcript passthrough missing"
grep -q "IPC bitbot:sessions:react + preload sessions.react" /tmp/g31-probe.log 2>/dev/null \
  && ok "G-31 GP-§5.1：IPC bitbot:sessions:react + preload 全链暴露" \
  || bad "G-31 IPC wiring missing"
grep -q "reactAction 文案在 zh-CN / zh-TW / en 三套 i18n 齐全" /tmp/g31-probe.log 2>/dev/null \
  && ok "G-31 GP-§5.1：reactAction 三语 i18n 齐全" \
  || bad "G-31 i18n missing"
grep -q "sessions.react 落在 sessions store" /tmp/g31-probe.log 2>/dev/null \
  && ok "G-31 GP-§5.1：sessions.react 落在 sessions store（单一事实源）" \
  || bad "G-31 store react missing"
grep -q "负向对照：禁用 save 后反应不落盘" /tmp/g31-probe.log 2>/dev/null \
  && ok "G-31 负向对照：砍掉 save(state) 后反应不落盘（断言非恒真）" \
  || bad "G-31 negative control missing"

echo "== G-33 Grok 桌面外观（M33：对标 Grok Bot UI）=="
if timeout 900 node scripts/prove_m33_grokchrome.js > /tmp/g33-probe.log 2>&1; then
  ok "G-33 Grok 桌面外观契约全绿（$(grep -c '✓' /tmp/g33-probe.log) 项，$(tail -1 /tmp/g33-probe.log)）"
else
  bad "G-33 Grok 桌面外观契约（见 /tmp/g33-probe.log）"
fi
grep -q "侧栏顶部图标工具栏" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：侧栏顶部图标工具栏（search + new-chat）" \
  || bad "G-33 sidebar toolbar missing"
grep -q "账户条包含 8 项弹层" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：底部账户条 → 8 项 popup（含 Settings 复用 sidebar-settings-btn）" \
  || bad "G-33 account popup missing"
grep -q "送达状态：存储 → ✓、回合收尾 → ✓✓ 绿色" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：用户气泡送达状态 ✓ → ✓✓ 绿色" \
  || bad "G-33 delivery status missing"
grep -q "首个 delta 前显示三点动效" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：助手思考三点 typing indicator（DOM 节点，非 innerHTML）" \
  || bad "G-33 typing indicator missing"
grep -q "Composer 发送按钮：36px 圆形" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：Composer 发送按钮 → 36px 圆形 ↑ 图标" \
  || bad "G-33 composer send missing"
grep -q "10 个常见英文标签已全部本地化" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：中英混排清理（10 项 i18n key）" \
  || bad "G-33 CN/EN separation missing"
grep -q "语言选择器保留各语言原生名" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：语言下拉保留原生名（English / 简体中文 / 繁體中文）" \
  || bad "G-33 language dropdown missing"
grep -q "负向对照：砍掉 read 绿色样式" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 负向对照：砍掉 read 样式 → 送达状态断言翻假（非恒真）" \
  || bad "G-33 negative control missing"

echo "== G-34 账户弹层入口落地（M34：对标 Grok Bot 桌面外观）=="
if timeout 900 node scripts/prove_m34_account_actions.js > /tmp/g34-probe.log 2>&1; then
  ok "G-34 账户弹层入口契约全绿（$(grep -c '✓' /tmp/g34-probe.log) 项，$(tail -1 /tmp/g34-probe.log)）"
else
  bad "G-34 账户弹层入口契约（见 /tmp/g34-probe.log）"
fi
grep -q "三项（更新 / 用量 / 添加账户）通过 open settings anchor" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：三项真实落点（更新→update-status / 用量→usage / 添加账户→profile）" \
  || bad "G-34 anchor wiring missing"
grep -q "update-status / usage / profile 三个锚点在 SETTINGS_ANCHOR_TAB 已注册" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：锚点在 SETTINGS_ANCHOR_TAB 已注册" \
  || bad "G-34 anchor registry missing"
grep -q "移动版 / 支持 / 退出登录 三项：中文占位文案" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：三项走本地化 callout（非静默 no-op）" \
  || bad "G-34 placeholder missing"
grep -q "handler 都收口：先关 popup 再走短语" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：handler 都关 popup，不挡设置页" \
  || bad "G-34 popup close missing"
grep -q "负向对照：抹掉 anchor=usage 短语" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 负向对照：抹掉 anchor 短语 → 断言翻假（非恒真）" \
  || bad "G-34 negative control missing"

echo "== G-35 键盘快捷键面板（M35：Cmd/Ctrl+K 搜索 + Cmd/Ctrl+/ 快捷键表）=="
if timeout 900 node scripts/prove_m35_hotkeys.js > /tmp/g35-probe.log 2>&1; then
  ok "G-35 快捷键契约全绿（$(grep -c '✓' /tmp/g35-probe.log) 项，$(tail -1 /tmp/g35-probe.log)）"
else
  bad "G-35 快捷键契约（见 /tmp/g35-probe.log）"
fi
grep -q "wireAccelerators：新增 Cmd/Ctrl+K（搜索）与 Cmd/Ctrl+/（快捷键表）" /tmp/g35-probe.log 2>/dev/null \
  && ok "G-35 GP-M35：wireAccelerators 接入 K / 两条新绑定" \
  || bad "G-35 accelerators missing"
grep -q "走既有 #session-search 输入" /tmp/g35-probe.log 2>/dev/null \
  && ok "G-35 GP-M35：Cmd/Ctrl+K 复用既有搜索输入，不造第二份状态" \
  || bad "G-35 shared search missing"
grep -q "bb-modal + bb-sheet 复用；DOM 建" /tmp/g35-probe.log 2>/dev/null \
  && ok "G-35 GP-M35：快捷键面板走 bb-modal / bb-sheet，DOM 建（GP-93 纪律）" \
  || bad "G-35 sheet build"
grep -q "HOTKEYS 9 项 + 面板标题共 10 个 key 在 zh-CN / zh-TW / en 全部齐备" /tmp/g35-probe.log 2>/dev/null \
  && ok "G-35 GP-M35：10 个 hk key 三语齐备" \
  || bad "G-35 i18n coverage"
grep -q "负向对照：抹掉 openHotkeysSheet" /tmp/g35-probe.log 2>/dev/null \
  && ok "G-35 负向对照：抹掉 openHotkeysSheet 调用 → 断言翻假（非恒真）" \
  || bad "G-35 negative control"

echo "== G-36 Cmd/Ctrl+D 语音绑定（M36：单一录音入口）=="
if timeout 900 node scripts/prove_m36_voicehotkey.js > /tmp/g36-probe.log 2>&1; then
  ok "G-36 语音快捷键契约全绿（$(grep -c '✓' /tmp/g36-probe.log) 项，$(tail -1 /tmp/g36-probe.log)）"
else
  bad "G-36 语音快捷键契约（见 /tmp/g36-probe.log）"
fi
grep -q "wireAccelerators：Cmd/Ctrl+D 分支调用 startVoiceInput" /tmp/g36-probe.log 2>/dev/null \
  && ok "G-36 GP-M36：Cmd/Ctrl+D 与 🎙 按钮共用 startVoiceInput 单一入口" \
  || bad "G-36 voice hotkey missing"
grep -q "键盘分支使用 typeof guard" /tmp/g36-probe.log 2>/dev/null \
  && ok "G-36 GP-M36：typeof guard 保护前向引用，不重复实现" \
  || bad "G-36 guard missing"
grep -q "HOTKEYS hkVoice 项与按钮 title 一致" /tmp/g36-probe.log 2>/dev/null \
  && ok "G-36 GP-M36：hkVoice 面板项与按钮 title 对齐（语音输入 / Cmd+D）" \
  || bad "G-36 label drift"
grep -q "负向对照：抹掉 startVoiceInput" /tmp/g36-probe.log 2>/dev/null \
  && ok "G-36 负向对照：抹掉 startVoiceInput() 调用 → 分支断言翻假（非恒真）" \
  || bad "G-36 negative control"

echo "== G-37 M37 布局修复 + CN/EN 清扫（侧栏账户弹层 / 全局 [hidden] / i18n 字典）=="
if timeout 900 node scripts/prove_m37_layout.js > /tmp/g37-probe.log 2>&1; then
  ok "G-37 M37 布局与中英清扫契约全绿（$(grep -c '✓' /tmp/g37-probe.log) 项，$(tail -1 /tmp/g37-probe.log)）"
else
  bad "G-37 M37 布局契约（见 /tmp/g37-probe.log）"
fi
grep -q "全局 \[hidden\] { display: none !important" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：全局 [hidden] !important，防 UA 语义被 display:flex 顶掉" \
  || bad "G-37 global hidden reset missing"
grep -q "#account-popup 使用 position: fixed" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：账户弹层 position: fixed + z-index: 4x（不被 #agents 裁剪）" \
  || bad "G-37 popup stacking missing"
grep -q "setAccountPopup(open)：hidden 属性 + aria-expanded 同步" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：setAccountPopup 单一真源（hidden 属性 + aria-expanded）" \
  || bad "G-37 popup single-source missing"
grep -q 'Escape 键 → setAccountPopup(false)' /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：Escape 关闭弹层" \
  || bad "G-37 escape close missing"
grep -q "gpQueueNote.*已本地化" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：gpQueueNote 已本地化（后台审批队列）" \
  || bad "G-37 gpQueueNote CN leak"
grep -q "autoReview.*已本地化" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：autoReview 已本地化（自动复核规则）" \
  || bad "G-37 autoReview CN leak"
grep -q "accountSection.*已本地化" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：accountSection 已本地化（账户 · 本地 profile）" \
  || bad "G-37 accountSection CN leak"
grep -q "settings-tab 动态标签 map 已中文化" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：settings-tab 动态标签 map（常规 / 电脑 / 凭证）" \
  || bad "G-37 settings-tab map missing"
grep -q "composer placeholder 已中文化" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：composer placeholder 已中文化（给 Bit Bot 发消息…）" \
  || bad "G-37 composer placeholder missing"
grep -q "负向对照：抹掉 removeAttribute" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 负向对照：抹掉 removeAttribute → 断言翻假（非恒真）" \
  || bad "G-37 negative control"

echo "== G-38 复制按钮 + 悬浮 pill 工具条 + welcome 品牌渐变（M38）=="
if timeout 900 node scripts/prove_m38_copy.js > /tmp/g38-probe.log 2>&1; then
  ok "G-38 M38 复制契约全绿（$(grep -c '✓' /tmp/g38-probe.log) 项，$(tail -1 /tmp/g38-probe.log)）"
else
  bad "G-38 M38 复制契约（见 /tmp/g38-probe.log）"
fi
grep -q "attachMessageActions：Reply / React 后追加 Copy" /tmp/g38-probe.log 2>/dev/null \
  && ok "G-38 GP-M38：Copy 按钮接入悬浮工具条，含 clipboard / execCommand 回退" \
  || bad "G-38 copy wiring missing"
grep -q "i18n zh-CN：copyAction" /tmp/g38-probe.log 2>/dev/null \
  && grep -q "i18n zh-TW：copyAction" /tmp/g38-probe.log 2>/dev/null \
  && grep -q "i18n en：Copy" /tmp/g38-probe.log 2>/dev/null \
  && ok "G-38 GP-M38：三语 copyAction / copyDone / copyFailed 齐备" \
  || bad "G-38 i18n coverage"
grep -q "msg-actions：pill 容器 + backdrop-filter" /tmp/g38-probe.log 2>/dev/null \
  && ok "G-38 GP-M38：pill 容器 + backdrop-filter blur(4px)" \
  || bad "G-38 pill bar missing"
grep -q "welcome .w-brand：linear-gradient" /tmp/g38-probe.log 2>/dev/null \
  && ok "G-38 GP-M38：welcome .w-brand 使用 linear-gradient + background-clip: text" \
  || bad "G-38 welcome gradient missing"
grep -q "负向对照：抹掉 bar.appendChild(cp)" /tmp/g38-probe.log 2>/dev/null \
  && ok "G-38 负向对照：抹掉 bar.appendChild(cp) → Copy 装配断言翻假（非恒真）" \
  || bad "G-38 negative control"

echo "== G-39 微交互精修（M39：淡入悬浮条 / 按压反馈 / 侧栏行 hover）=="
if timeout 900 node scripts/prove_m39_micro.js > /tmp/g39-probe.log 2>&1; then
  ok "G-39 M39 微交互契约全绿（$(grep -c '✓' /tmp/g39-probe.log) 项，$(tail -1 /tmp/g39-probe.log)）"
else
  bad "G-39 M39 微交互契约（见 /tmp/g39-probe.log）"
fi
grep -q "msg-actions：改用 opacity + pointer-events 淡入" /tmp/g39-probe.log 2>/dev/null \
  && ok "G-39 GP-M39：msg-actions 淡入（display 常驻，transition 生效）" \
  || bad "G-39 fade transition missing"
grep -q "msg-actions button:active → scale" /tmp/g39-probe.log 2>/dev/null \
  && ok "G-39 GP-M39：msg-actions button :active scale(0.96) 按压反馈" \
  || bad "G-39 button press missing"
grep -q "sess-row:hover translateX" /tmp/g39-probe.log 2>/dev/null \
  && ok "G-39 GP-M39：sess-row hover translateX(1px) 微滑" \
  || bad "G-39 sess-row hover missing"
grep -q "sess-row:active scale" /tmp/g39-probe.log 2>/dev/null \
  && ok "G-39 GP-M39：sess-row active scale(0.995) 极轻按压" \
  || bad "G-39 sess-row press missing"
grep -q "#send:active scale" /tmp/g39-probe.log 2>/dev/null \
  && ok "G-39 GP-M39：#send :active scale(0.94) 发送键反馈" \
  || bad "G-39 send press missing"
grep -q "M38 Copy 装配 + welcome 渐变契约保持" /tmp/g39-probe.log 2>/dev/null \
  && ok "G-39 M38 回归不破：Copy 装配 + welcome 渐变仍在" \
  || bad "G-39 M38 regression"
grep -q "负向对照：抹掉 opacity:0" /tmp/g39-probe.log 2>/dev/null \
  && ok "G-39 负向对照：抹掉 opacity:0 → 淡入断言翻假（非恒真）" \
  || bad "G-39 negative control"

echo "== G-40 无障碍（M40：键盘焦点环 + prefers-reduced-motion）=="
if timeout 900 node scripts/prove_m40_a11y.js > /tmp/g40-probe.log 2>&1; then
  ok "G-40 M40 无障碍契约全绿（$(grep -c '✓' /tmp/g40-probe.log) 项，$(tail -1 /tmp/g40-probe.log)）"
else
  bad "G-40 M40 无障碍契约（见 /tmp/g40-probe.log）"
fi
grep -q ":focus-visible 焦点环：2px solid accent" /tmp/g40-probe.log 2>/dev/null \
  && ok "G-40 GP-M40：:focus-visible 键盘焦点环（2px solid accent，仅键盘可见）" \
  || bad "G-40 focus-visible missing"
grep -q "prefers-reduced-motion: reduce)：全局 transition/animation" /tmp/g40-probe.log 2>/dev/null \
  && ok "G-40 GP-M40：prefers-reduced-motion 全局压平 transition/animation" \
  || bad "G-40 reduced-motion missing"
grep -q "reduced-motion 下 composer send:active transform 归零" /tmp/g40-probe.log 2>/dev/null \
  && ok "G-40 GP-M40：reduced-motion 下 composer 按压位移归零" \
  || bad "G-40 rm composer missing"
grep -q "M39 msg-actions 淡入契约仍在" /tmp/g40-probe.log 2>/dev/null \
  && ok "G-40 M39 回归不破：msg-actions 淡入仍在" \
  || bad "G-40 M39 regression"
grep -q "负向对照：抹掉 :focus-visible 规则" /tmp/g40-probe.log 2>/dev/null \
  && ok "G-40 负向对照：抹掉 :focus-visible → 焦点环断言翻假（非恒真）" \
  || bad "G-40 negative control"

echo "== G-41 中英混排收尾（M41：动态 meta 前缀 + 内部枚举外泄）=="
if timeout 900 node scripts/prove_m41_cn.js > /tmp/g41-probe.log 2>&1; then
  ok "G-41 M41 中英收尾契约全绿（$(grep -c '✓' /tmp/g41-probe.log) 项，$(tail -1 /tmp/g41-probe.log)）"
else
  bad "G-41 M41 中英收尾契约（见 /tmp/g41-probe.log）"
fi
grep -q "channels-meta 前缀本地化" /tmp/g41-probe.log 2>/dev/null \
  && ok "G-41 GP-M41：channels-meta workflows · → 工作流 ·" \
  || bad "G-41 channels meta"
grep -q "box-meta 前缀本地化" /tmp/g41-probe.log 2>/dev/null \
  && ok "G-41 GP-M41：box-meta env · → 运行环境 ·" \
  || bad "G-41 box meta"
grep -q "cloud-meta 默认值不再外泄内部枚举" /tmp/g41-probe.log 2>/dev/null \
  && ok "G-41 GP-M41：cloud-meta local_worker → 本地代理（枚举不外泄）" \
  || bad "G-41 cloud-meta leak"
grep -q "技术引用保留：ADR 0002 / ICS" /tmp/g41-probe.log 2>/dev/null \
  && ok "G-41 GP-M41：技术引用保留 ADR 0002 / ICS（符合扫描排除规则）" \
  || bad "G-41 technical ref drift"
grep -q "负向对照：塞回 workflows ·" /tmp/g41-probe.log 2>/dev/null \
  && ok "G-41 负向对照：塞回 workflows · → 本地化断言翻假（非恒真）" \
  || bad "G-41 negative control"

echo "== G-42 消息流排版（M42：居中列 + 气泡尾角 + 连续回合分组）=="
if timeout 900 node scripts/prove_m42_stream.js > /tmp/g42-probe.log 2>&1; then
  ok "G-42 M42 消息流排版契约全绿（$(grep -c '✓' /tmp/g42-probe.log) 项，$(tail -1 /tmp/g42-probe.log)）"
else
  bad "G-42 M42 消息流排版契约（见 /tmp/g42-probe.log）"
fi
grep -q "#log 单列居中" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 GP-M42：#log 单列居中，user/assistant 对齐同一列" \
  || bad "G-42 log center missing"
grep -q "user 气泡：保留 18px 圆角" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 GP-M42：user 气泡 18px 圆角（M20）+ 右下尾角" \
  || bad "G-42 user tail missing"
grep -q "assistant 气泡：var(--bot-bubble)" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 GP-M42：assistant 气泡 bot-bubble + 左上尾角" \
  || bad "G-42 assistant tail missing"
grep -q "连续 assistant 行隐藏重复头像" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 GP-M42：连续 assistant 回合隐藏重复头像 + 收紧行距" \
  || bad "G-42 grouping missing"
grep -q "M20 用户胶囊正则仍匹配" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 M20 回归护栏：用户胶囊正则仍匹配" \
  || bad "G-42 M20 regression"
grep -q "负向对照：抹掉 #log max-width" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 负向对照：抹掉 #log max-width → 居中列断言翻假（非恒真）" \
  || bad "G-42 negative control"


echo
echo "smoke_grok_desktop_parity: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
