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

# ---- A0-4：门禁不许改写已跟踪文件 -------------------------------------------
# 本轮实测事故：跑完整矩阵后 `report.md` 从 3738 行被写成 182 行、
# `parity-gaps-next.md` 从 361 行被写成 95 行（内容是更旧的副本，还带着已被刻意去掉的
# 硬编码计数）。这种损坏靠人眼发现不了 —— 因为门禁自己就会把仓里几个 PNG 重写一遍，
# 「脏」是常态，谁也不会去看第二眼。
#
# 做法：开局记下「本轮开始前就已经脏的已跟踪文件」，收尾时再记一次，
# **只报新冒出来的那批**。基线里原有的（比如本轮真正在改的文档）不算违规。
# 白名单为空：现在没有任何「门禁必须改已跟踪文件」的合法理由，将来若出现，
# 要在这里写死一条并附为什么，而不是把整条检查关掉。
GATE_DIRTY_BASELINE=/tmp/gate-dirty-baseline.txt
gate_dirty_tracked() {
  git status --porcelain=v1 2>/dev/null | grep -v '^??' | awk '{print $2}' | sort
}
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  gate_dirty_tracked > "$GATE_DIRTY_BASELINE"
else
  : > "$GATE_DIRTY_BASELINE"
fi

# ---- A0-6：门禁不许把「当前用哪个模型 provider」留在用户数据里 -----------------
# 本轮实测的病：`data/llm/active.json` 里留着上一轮**被中途打断**的journeys门写进去的
# `provider_id: qwen`。`host_ffi.js:5289 resolveLlmConfig()` 的优先级是
# 「provider 自己的 env > active.json > 全局 BITBOT_LLM_*」，而大部分门只 stub 全局那组
# —— 于是 qwen 的 scoped env 为空、回落到 active.json 里的**真实公网地址**，
# 拿着一个测试用键去敲阿里云：G-16/G-18/G-19/G-28/G-64 一共六条门因此变红，
# 红因写得像产品坏了（Incorrect API key provided），其实是上一轮的门禁漏了收尾。
# 更难看的一点：一次门禁跑会**替用户把模型渠道切走**，跑完不还原，用户下次自己用的时候
# 大脑就已经不是他选的那个了。这是「不许污染用户数据」那条硬约束的正面对撞。
GATE_LLM_ACTIVE="data/llm/active.json"
GATE_LLM_ACTIVE_SNAP=/tmp/gate-llm-active-snap.json
GATE_LLM_ACTIVE_PARK=/tmp/gate-llm-active-created-by-gate.json
gate_llm_snapshot() {
  if [ -f "$GATE_LLM_ACTIVE" ]; then
    cp "$GATE_LLM_ACTIVE" "$GATE_LLM_ACTIVE_SNAP" && echo present
  else
    rm -f "$GATE_LLM_ACTIVE_SNAP" && echo absent
  fi
}
gate_llm_restore() {
  # 三种情况都要有明确说法：内容有变（还原）、开局没有而现在有（挪走备份，不删）、没变（不动）。
  if [ -f "$GATE_LLM_ACTIVE_SNAP" ]; then
    if [ -f "$GATE_LLM_ACTIVE" ] && ! cmp -s "$GATE_LLM_ACTIVE_SNAP" "$GATE_LLM_ACTIVE"; then
      cp "$GATE_LLM_ACTIVE" "$GATE_LLM_ACTIVE_PARK"
      cp "$GATE_LLM_ACTIVE_SNAP" "$GATE_LLM_ACTIVE"
      echo "已还原（被门改写过，改写前的值备份在 ${GATE_LLM_ACTIVE_PARK}）"
    elif [ -f "$GATE_LLM_ACTIVE" ]; then
      echo "未变动"
    else
      cp "$GATE_LLM_ACTIVE_SNAP" "$GATE_LLM_ACTIVE"; echo "门把文件删了 → 从快照补回"
    fi
  elif [ -f "$GATE_LLM_ACTIVE" ]; then
    mv "$GATE_LLM_ACTIVE" "$GATE_LLM_ACTIVE_PARK"
    echo "开局没有、门跑出来了 → 挪走（不是删除，备份在 ${GATE_LLM_ACTIVE_PARK}）"
  else
    echo "开局没有、现在也没有"
  fi
}
GATE_LLM_STATE_BEFORE=$(gate_llm_snapshot)

DATA=data/desktop
turn_json() { # $1 = user phrase, optional env BITBOT_APPROVED=1
  local extra=()
  [ "${BITBOT_APPROVED:-0}" = "1" ] && extra=(--approved)
  # ${extra[@]+"${extra[@]}"} — bash 3.2（macOS 自带 /bin/bash）在 `set -u`
  # 下展开空数组会报 "extra[@]: unbound variable"，整条命令根本不执行。
  # 后果不是难看：这条函数是全部 kind 断言的入口，它一失败，门禁在 macOS 上
  # 永远是「✗ create bot chain」这样的连锁红（实测 296 项红），红的却不是产品。
  node hosts/cli_host/run_turn.js ${extra[@]+"${extra[@]}"} "$1" 2>/dev/null | tail -1
}

# ---- 这两件「Linux 自带」的东西，macOS 上没有；缺一件就会把门禁整片判红 -----
#
# timeout(1) 属于 GNU coreutils，macOS 不自带。脚本里 44 处
# `timeout <秒> node …` 于是全部变成 "timeout: command not found"，子门禁的
# 日志里只剩这一行 shell 错误，上层再报「chain assertions missing」——
# 2026-10-29 实测：这台机器上跑出来的 210 项红里，绝大多数是这只手，不是产品。
# polyfill 已抽到 scripts/lib/timeout_polyfill.sh 共享（macOS 上没有 coreutils
# timeout 的脚本不止这一个，其余 7 个调用方一并接上）。
source "$(dirname "$0")/lib/timeout_polyfill.sh"

# 另一处平台假设：`node_modules/electron/dist/electron` 是 Linux/Windows 的布局，
# macOS 是 `dist/Electron.app/Contents/MacOS/Electron`。7 个真渲染门禁的入口判断
# 写死了前者，于是在开发机上永远 SKIP（SKIP ≠ PASS，也永远拦不住回归）。
# 跨平台的解析已经有单一真源（scripts/electron_bin.mjs），这里复用它，只判存在性。
HAVE_ELECTRON_UI=0
if [ -d hosts/desktop/node_modules/playwright-core ] && node -e "
const fs=require('fs');
import('./scripts/electron_bin.mjs')
  .then((m) => process.exit(fs.existsSync(m.resolveElectronBinary('hosts/desktop')) ? 0 : 1))
  .catch(() => process.exit(1));
"; then
  HAVE_ELECTRON_UI=1
fi

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

# 夹具自清（矩阵开跑第一件事）。G-1/G-2 每跑一次就留下一批 Smoke 夹具：重名时
# Host 给副本自动加序号（Smoke copy 2…8），改名落成 SmokeRenamed，群留 Smoke room。
# 实测 8 次跑之后 data/desktop/bots.json 里 16/25 行是门禁造的 —— 而 dev 模式下
# 应用的数据根就是仓库 data/（hosts/desktop/paths.js 非 packaged 分支），于是这些
# 夹具直接长在用户自己的侧栏里。开机门早就改成临时副本（GATE_ROOT），这条链只剩
# 本脚本。这里按**前缀**摘，与 journeys 门清 UJ 夹具同一把尺子：只认夹具名，
# 用户 Bot（Bit Bot / Ivy / 情报侦察员…）一行不动。
purge_gate_fixtures() {
  node -e '
const fs=require("fs");
const [bp,rp]=process.argv.slice(1);
const FIXTURE_BOT=/^(Smoke|Smoke copy[ 0-9]*|SmokeRenamed)$/;
const FIXTURE_ROOM=/^Smoke room$/;
const drop=(p,kind,pick)=>{
  if(!fs.existsSync(p))return "无文件";
  let j;try{j=JSON.parse(fs.readFileSync(p,"utf8"));}catch(e){return "解析失败("+e.code+")，本次不碰";}
  const rows=Array.isArray(j[kind])?j[kind]:[];
  const kept=rows.filter((x)=>!(x&&pick(String(x.name||x.title||""))));
  const n=rows.length-kept.length;
  j[kind]=kept;
  if(kind==="bots"&&j.primary_id&&!kept.some((x)=>x&&x.id===j.primary_id))j.primary_id="";
  if(n>0)fs.writeFileSync(p,JSON.stringify(j,null,2));
  return n+" 条";
};
console.log("夹具 Bot "+drop(bp,"bots",(s)=>FIXTURE_BOT.test(s))+"、夹具群 "+drop(rp,"rooms",(s)=>FIXTURE_ROOM.test(s)));
' "$DATA/bots.json" "$DATA/rooms.json"
}
# 不只靠末尾那一次调用：矩阵被 set -u 或 timeout 打断时（本轮整合前就死在 G-59 的
# 空数组上）收尾根本不会执行，夹具照样留在用户侧栏里。挂 EXIT trap 兜住异常退出。
trap 'purge_gate_fixtures >/dev/null 2>&1; gate_llm_restore >/dev/null 2>&1' EXIT

echo "== G-1/G-2 Bot lifecycle =="
echo "  · 前置自清：$(purge_gate_fixtures)（只认 Smoke 前缀，用户 Bot 不动）"
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
j=$(turn_json "recover computer"); echo "$j" | grep -qE "recover only from error state|host_recover_computer" && ok "recover：非错误态被正确拒绝/或恢复（不假装）" || bad "recover guard"
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
j=$(turn_json "room $roomid :: @everyone ping"); echo "$j" | grep -qE '"responder_policy": "all"|all' >/dev/null && echo "$j" | grep -q everyone && ok "@everyone 路由输出存在" || bad "everyone"
j=$(turn_json "room $roomid :: 无人点名"); echo "$j" | grep -q bot_discretion && ok "无 @ → bot_discretion" || bad "discretion"
# GP-53「审批不进群」：原来靠回包里一个 escalations:"dm-only" 字面量取证，但群路径被
# 重写进 hosts/shared/room_* 之后这个字段整条链路都不产生了（也没人消费它）。
# 尺子不能跟着字段一起失效，也不能只会 grep 一个漂亮字符串 —— 改成量行为：
# 这条群回合的回包与这份群的持久转录里都不许出现审批卡。
room_approval_leak() { # $1=data root, $2=room id —— 返回 0=没有审批行混进群转录
  ROOT="$1" ROOM="$2" node -e '
const fs=require("fs");
const root=process.env.ROOT, id=process.env.ROOM;
const hit=(JSON.parse(fs.readFileSync(root+"/desktop/rooms.json","utf8")).rooms||[]).find(r=>r.id===id)||{};
const bad=(hit.transcript||[]).filter(x=>x&&/approval/i.test(String(x.kind||""))||x&&/approval/i.test(String(x.text||"")));
if(bad.length)console.error("群转录里出现审批行 "+bad.length+" 条");
process.exit(bad.length?1:0)'
}
host_result_has_approval() { # stdin = 回包 JSON —— 退出 1=Host 结果里有审批卡（或解析不出来，不 fail-open）
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
let j=null;
try{j=JSON.parse(d.trim().split("\n").filter(l=>l.startsWith("{")).pop())}catch(e){console.error("回包解析失败：尺子不 fail-open");process.exit(1)}
const hit=!!(j&&Array.isArray(j.host_results)&&j.host_results.some((h)=>h&&/approval/i.test(String(h.kind||""))));
if(hit)console.error("Host 结果里出现审批卡 kind");
process.exit(hit?1:0)})'
}
if printf '%s\n' "$j" | host_result_has_approval; then
  if room_approval_leak data "$roomid"; then
    ok "GP-53 审批不进群（按行为取证）：这条无点名群回合的 Host 结果与群转录里都没有审批卡"
  else
    bad "GP-53 审批行出现在群转录里（dm-only 承诺破了）"
  fi
else
  bad "GP-53 审批卡混进了群回合的 Host 结果（承诺是只走私聊）"
fi
# 这把尺子自己也要被验一遍：能抓住有的、放过没有的、解析失败不许当没事
d_ha=0
printf '%s\n' '{"host_results":[{"kind":"approval_card"}]}' | host_result_has_approval 2>/dev/null || d_ha=$((d_ha+1))
printf '%s\n' '{"host_results":[{"kind":"delivery"}]}' | host_result_has_approval 2>/dev/null && d_ha=$((d_ha+2))
printf '%s\n' 'not a json' | host_result_has_approval 2>/dev/null || d_ha=$((d_ha+3))
[ "$d_ha" = "6" ] && ok "GP-53 尺子自证：有审批卡被抓、纯 delivery 被放、坏 JSON 不 fail-open" \
  || bad "GP-53 尺子失效：三向对照结果码 ${d_ha}（期望 6=1+2+3）"
tmpa=$(mktemp -d); mkdir -p "$tmpa/desktop"
node -e '
const fs=require("fs");const root=process.argv[1];
fs.writeFileSync(root+"/desktop/rooms.json",JSON.stringify({rooms:[{id:"r9",title:"x",transcript:[{kind:"approval_card",text:"请批准这封外发"}]}]}));
' "$tmpa"
if room_approval_leak "$tmpa" r9 2>/dev/null; then
  bad "GP-53 尺子失效：注入一条审批行也没抓住（恒真断言）"
else
  ok "GP-53 尺子的负向对照：注入 approval_card 行后立刻翻红（非恒真）"
fi
rm -rf "$tmpa"
echo "  · G-53/GP-53 残留（诚实）：escalations:\"dm-only\" 这个字段在群路径重写后整条链都不再产生，"
echo "    也没有任何消费者（grep 全仓只有 product_surface.js 一处产出）。本轮把尺子改成量行为，"
echo "    但「群里触发的动作 → 审批走私聊」这条完整链路在 shared 新路径上还没有实现与用例，"
echo "    只在旧 roomTurn 里留了一句漂亮话。记在 parity-gaps-next 继续追。"

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
j=$(turn_json "reset computer"); echo "$j" | grep -qE "CM-1904|reset" && ok "CM-1904 reset computer 短语可达（非首选提示）" || bad "reset computer"
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
const t=require('./data/desktop/bot-templates.json').templates.find(x=>x.id==='chief-of-staff');
const hit=b.find(x=>x.name==='Chiefy');
process.exit(hit && hit.job===t.job && hit.created_at ? 0:1)" && ok "GP-02 模板 Bot 已持久化进 bots.json（job 对齐模板单一源，不写死英文）" || bad "GP-02 persisted"
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
# 这一条断的是「话术被认成转交、宿主真的受理并投递」，不是「承接 Bot 立刻跑完了」：
# 本门禁这一段没有 LLM 端点，承接者的回合必然产不出回复，把 ok（=真的答上了）
# 写进断言只会得到与产品无关的红（2026-10-29 实测三条红就在这里）。
# 受理=accepted，投递=inbox/存根（下面两条分别断）。
echo "$j" | field intent | grep -q handoff_task \
  && echo "$j" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d.trim().split('\n').filter(l=>l.startsWith('{')).pop());const h=(j.host_results||[]).find(x=>x.kind==='handoff_task')||{};const p=JSON.parse(h.stdout||'{}');process.exit(h.accepted===true&&p.accepted===true&&p.pretend_transferred===false?0:1)})" <<<"$j" \
  && ok "GP-52 短语 → handoff_task 意图 + 宿主受理并排队（不假装已交接）" \
  || bad "GP-52 chain" "intent=[$(echo "$j" | field intent)] kinds=[$(echo "$j" | field hostKinds)]"
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
# 因果一致（§8.30 新增）：交接行写进群转录 ⇒ 承接方 inbox 必有这一笔 ⇒ 存根必在。
# 三条单独锚点各自能绿，却挡不住「只写行不排队」这种半态 —— 本轮翻车正是这个形状：
# 承接方没答上时 Host 整笔跳过 inbox 与存根，屏幕上却写着「已转交」。
ho_causal() {
  HO_DATA_DIR="$1" node -e '
const fs=require("fs");const root=process.env.HO_DATA_DIR||"data";
const room=process.argv[1], to=process.argv[2];
const hit=(JSON.parse(fs.readFileSync(root+"/desktop/rooms.json","utf8")).rooms||[]).find(r=>r.id===room)||{};
const row=(hit.transcript||[]).filter(x=>x&&x.kind==="handoff"&&x.to_bot===to).pop()||{};
const p=root+"/agents/inbox/"+to+".jsonl";
const rows=fs.existsSync(p)?fs.readFileSync(p,"utf8").trim().split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean):[];
const q=rows.filter(r=>r&&r.is_handoff===true&&r.to_id===to&&r.room===room).pop()||{};
const d=root+"/agents/handoffs";
const stubs=fs.existsSync(d)?fs.readdirSync(d).filter(f=>f.startsWith("handoff-"+to+"-")):[];
const ok=!!row.to_bot && q.to_id===to && q.room===room && q.is_room===true && q.forbids_private_assumptions===true && stubs.length>=1;
console.error("交接行="+(row.to_bot?"有":"无")+" inbox="+(q.to_id||"无")+" 存根="+stubs.length+" 个");
process.exit(ok?0:1)' "$2" "$3"
}
if ho_causal data "$hoid" "$hid_b"; then
  ok "GP-52 因果一致：写了交接行就必然有收件箱那一笔与存根（三者同生，不许只剩转录那句漂亮话）"
else
  bad "GP-52 因果断裂：群转录写着已转交，收件箱/存根却没有（本轮修复前就是这个形状）"
fi
# 同一把尺子的负向对照：造一个「只有交接行、没有排队」的半态，必须翻红
ho_neg=0
tmpc=$(mktemp -d)
mkdir -p "$tmpc/desktop" "$tmpc/agents/inbox" "$tmpc/agents/handoffs"
node -e '
const fs=require("fs");const root=process.argv[1];
fs.writeFileSync(root+"/desktop/rooms.json",JSON.stringify({rooms:[{id:"r1",title="x",members:["a","b"],transcript:[{kind:"handoff",room_id:"r1",from_bot:"a",to_bot:"b",task:"t",responders:["b"],responder_policy:"handoff_target"}]}]}));
' "$tmpc"
if ho_causal "$tmpc" r1 b 2>/dev/null; then ho_neg=1; fi
rm -rf "$tmpc"
[ "$ho_neg" = "0" ] && ok "GP-52 因果尺子的负向对照：只有交接行、没有排队的半态被抓住（非恒真）" \
  || bad "GP-52 因果尺子失效：半态也判绿（恒真断言）"
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
const pendBubble=(html.match(/rHandoffPending:/g)||[]).length>=3 && html.includes(String.raw`hp.pending === true || hp.replied === false`);
process.exit(keys>=3 && map && fill && failBubble && pendBubble ? 0:1)' && ok "GP-52 renderer：三语 rHandoff + 回执映射与占位填充 + 三语 rHandoffPending（受理但没答上如实说一句，不装作完成）" || bad "GP-52 renderer wiring"
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
if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  e2e_log=/tmp/e2e-g16.log
  # M21 起 E2E 含六次真实 boot（GP-70 ×2 + GP-14 + GP-99 + GP-108/109 + GP-111/112
  # + GP-116..119 + GP-93/94/95），单个 boot 冷启一次约 20–40s，故给足 1500s。
  # 无 live X display 时用 xvfb-run 起一个（DISPLAY 指向不存在的 socket 会让
  # Electron 在 ozone 里 SIGSEGV，被误判成应用问题）。
  e2e_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    e2e_xvfb=(xvfb-run -a)
  fi
  if timeout 1500 ${e2e_xvfb[@]+"${e2e_xvfb[@]}"} node scripts/e2e_grok_desktop_boot.mjs >"$e2e_log" 2>&1; then
    ok "G-16 E2E 冷启动+像素断言全绿（$(grep -c '✓' "$e2e_log") 项，$(tail -1 "$e2e_log"))"
  else
    # 上一次（CI 0ef7a72）这里只打了 bad，tail 一行都没出来 —— 无法判断是「脚本抛错」
    # 还是「日志根本没写成」。所以失败时把**体积 + 末尾 20 行**一起打出来：
    # 空文件会被一眼看到（bytes=0），而不是被当成「没有 traceback 就没有问题」。
    bad "G-16 E2E 冷启动+像素断言（见 ${e2e_log}；bytes=$(wc -c < "$e2e_log" 2>/dev/null | tr -d ' ')）"
    tail -20 "$e2e_log" 2>/dev/null || true
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
// renderer：正文经政策模块、点击 preventDefault、悬停卡 DOM 存在。
// 锚的是今天的真实调用形状：先取 .body 再把节点交给政策模块（850259e 之后
// 这里改成了两步局部变量，旧锚点写死 `applyLinkBodyTo(el.querySelector(".body"), …)`
// 于是常年红——那是锚点过期，不是产品退化）。两步都要在，少一步判假。
if(!/const bodyEl = el\.querySelector\("\.body"\)/.test(html)) process.exit(1);
if(!/applyLinkBodyTo\(bodyEl, fenceText\)/.test(html)) process.exit(1);
if(!/applyLinkBodyTo\(streamEl\.querySelector\("\.body"\), chunk\.partial\)/.test(html)) process.exit(1);
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
grep -q "侧边栏顺序 = Bot 列表 → 群组列表 → 尾部区块" /tmp/g24-probe.log 2>/dev/null \
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
  # 这条 e2e 的日志是本块唯一证据源：先报「多大、多少 ✓、多少 ✗」，
  # 免得「断言 missing」被读成「产品坏了」——它也可能是「e2e 根本没跑完」。
  echo "  · G-24 e2e 日志：bytes=$(wc -c < /tmp/e2e-g16.log | tr -d ' ') 通过=$(grep -c '✓' /tmp/e2e-g16.log) 失败=$(grep -c '✗' /tmp/e2e-g16.log) 末行=$(tail -1 /tmp/e2e-g16.log | cut -c1-90)"
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
grep -q "composer 群聊提交走 Host rooms.orchestrate IPC" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-119/143：群组行 → composer 对准群聊，提交走 Host rooms.orchestrate（roomTurn 单一写入点）" \
  || bad "G-29 GP-119 composer orchestrate missing"
# 这里的 grep 是对「子门.printed 断言名」的字符串合同——子门把这条改名了，聚合门
# 就会假红（2026-10-29 实测：断言名已改成 dispatchRoomTurn(...) 形状，聚合一味
# 找旧串导致 G-29 红）。用 -E 只锚定这条断言的实质三段，别再把函数签名写死。
grep -E -q "Host IPC 真接线：.*roomTurn → appendRoomTranscript → orchestrateRoom" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "responder 回合用自己的 botId" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "preload 暴露 rooms.orchestrate" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-143：真回合接线落地（每 responder 自己的 botId/记忆/persona，独立 room session）" \
  || bad "G-29 GP-143 responder wiring missing"
grep -q "群 transcript 按条目渲染" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "运行中为每个 responder 显示「工作中」卡" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-146：按条目渲染 + 运行中状态（不再拼一段纯文本）" \
  || bad "G-29 GP-146 rendering missing"
grep -q "房间转录字段落盘前统一截断" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "「工作中」态在 engine 真扇出时才发" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-146：共享转录有界 + 运行态只在真扇出时发（幂等/拒绝不闪假状态）" \
  || bad "G-29 GP-146 bounded/fanout guard missing"
grep -q "群聊失败卡走本地化语义" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "渲染层把「提及不在本群」如实说给用户" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "幂等命中时如实说明" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-146：产品态文案诚实（失败说人话 / 点名未命中不装成功 / 幂等不装重跑）" \
  || bad "G-29 GP-146 honest copy missing"
grep -q "@Name → mentioned_only 且 responders 精确" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "@A @B → mentioned_only 且只跑点名的 2 个成员" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "@everyone → all" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "无 @ → bot_discretion" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-51/144：入口沿用真实路由语义（含多点名 @A @B 与含空格成员名）" \
  || bad "G-29 GP-51 routing missing"
grep -q "rooms.json transcript 与 roomTurn 逐字一致" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "空群明说" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 GP-119：打开群聊读 rooms.json 真实 transcript，空群不造历史" \
  || bad "G-29 GP-119 transcript missing"
grep -q "负向对照：禁用群聊发送调用后 composer 不再路由到群聊" /tmp/g29-probe.log 2>/dev/null \
  && ok "G-29 负向对照：摘掉群聊发送调用后断言变红（断言非恒真）" \
  || bad "G-29 negative control missing"
if timeout 300 node scripts/prove_gp143_orchestration.js > /tmp/g29-orch.log 2>&1; then
  ok "G-29 GP-143/144：编排引擎契约全绿（$(grep -c '✓' /tmp/g29-orch.log) 项，$(tail -1 /tmp/g29-orch.log)）"
else
  bad "G-29 GP-143/144 编排引擎契约（见 /tmp/g29-orch.log）"
fi
grep -q "@only：to=\[b2\] 只运行 b2" /tmp/g29-orch.log 2>/dev/null \
  && grep -q "@everyone：无 to 时全员执行" /tmp/g29-orch.log 2>/dev/null \
  && grep -q "预算护栏：7 成员 → too_many_responders" /tmp/g29-orch.log 2>/dev/null \
  && grep -q "超时护栏：b2 悬挂" /tmp/g29-orch.log 2>/dev/null \
  && grep -q "上下文隔离：每个 responder 收到自己的 bot_id/name/job" /tmp/g29-orch.log 2>/dev/null \
  && ok "G-29 GP-143/144：@only/@everyone/预算/超时/递归/幂等/非成员/上下文隔离全绿" \
  || bad "G-29 GP-143 guards missing"
# 注意：这里原来是 `grep -q "A\|B"` —— BRE 里的 `\|` 只有 GNU grep 认，
# macOS 自带的是 BSD grep，会把 `\|` 当字面量，于是这条永远不匹配（假红）。
if grep -q "失败回执如实带原因" /tmp/g29-orch.log 2>/dev/null \
  || grep -q "缺 key 的 responder → 1/2 partial" /tmp/g29-orch.log 2>/dev/null; then
  if grep -q "收齐时如实 2/2 partial=false" /tmp/g29-orch.log 2>/dev/null; then
    ok "G-29 诚实性：失败算 partial、收齐才算完成（不伪造 final_report）"
  else
    bad "G-29 honesty missing"
  fi
else
  bad "G-29 honesty missing"
fi
grep -q "rooms.json 坏掉时写侧 fail closed" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "渲染层区分「空群」与「读不到」" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "rooms:list 与 rooms-changed 都带 ok 标志" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "三个群回合事件" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "内核 effect 循环同样 fail closed" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "目录里群已消失" /tmp/g29-probe.log 2>/dev/null \
  && grep -q "坏存储：roomsStoreStatus 如实报 unreadable" /tmp/g29-orch.log 2>/dev/null \
  && ok "G-29 GP-146：存储故障诚实（读不到≠没有群 / 坏存储上写侧拒绝，不覆盖历史）" \
  || bad "G-29 GP-146 store-honesty missing"

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
  && ok "G-33 GP-M33：底部账户条 → 8 项 popup（版本更新收进「设置 → 更新」；移动版并进「移动端远程控制」，手机只有一个入口）" \
  || bad "G-33 account popup missing"
grep -q "送达状态：存储 → ✓、回合收尾 → ✓✓ 绿色" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：用户气泡送达状态 ✓ → ✓✓ 绿色" \
  || bad "G-33 delivery status missing"
grep -q "首个 delta 前显示三点动效" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：助手思考三点 typing indicator（DOM 节点，非 innerHTML）" \
  || bad "G-33 typing indicator missing"
grep -q "Composer 发送按钮：28px 圆形" /tmp/g33-probe.log 2>/dev/null \
  && ok "G-33 GP-M33：Composer 发送按钮 → 28px 圆形 ↑ 图标" \
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
grep -q "两项（用量 / 添加账户）通过 open settings anchor" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：两项真实落点（用量→usage / 添加账户→profile）" \
  || bad "G-34 anchor wiring missing"
grep -q "update-status / usage / profile 三个锚点在 SETTINGS_ANCHOR_TAB 已注册" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：锚点在 SETTINGS_ANCHOR_TAB 已注册" \
  || bad "G-34 anchor registry missing"
grep -q "手机：账户弹层只留「移动端远程控制」一个入口" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：手机只留一个入口（装哪份 / 怎么连写在弹窗里，旧 pairing 深链落到弹窗）" \
  || bad "G-34 mobile landing missing"
grep -q "SETTINGS_ANCHOR_TAB 不再把 pairing 指到不存在的「手机」页签" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：锚点表不再指向已删除的「设置 → 手机」页签" \
  || bad "G-34 stale phone anchor missing"
grep -q "支持 / 退出登录 两项：中文占位文案" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：两项走本地化 callout（非静默 no-op）" \
  || bad "G-34 placeholder missing"
grep -q "handler 都收口：先关 popup 再走短语" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 GP-M34：handler 都关 popup，不挡设置页" \
  || bad "G-34 popup close missing"
grep -q "负向对照：抹掉 anchor=usage 短语" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 负向对照：抹掉 anchor 短语 → 断言翻假（非恒真）" \
  || bad "G-34 negative control missing"
grep -q "负向对照：抹掉 pairing 深链的接住逻辑" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 负向对照：抹掉 pairing 深链的接住逻辑 → 落地断言翻假（非恒真）" \
  || bad "G-34 mobile negative control missing"
grep -q "负向对照：抹掉「怎么连」文案" /tmp/g34-probe.log 2>/dev/null \
  && ok "G-34 负向对照：抹掉弹窗里「怎么连」文案 → 文案断言翻假（非恒真）" \
  || bad "G-34 mc copy negative control missing"

echo "== G-35 键盘快捷键面板（M35：Cmd/Ctrl+K 搜索 + Cmd/Ctrl+/ 快捷键表）=="
if timeout 900 node scripts/prove_m35_hotkeys.js > /tmp/g35-probe.log 2>&1; then
  ok "G-35 快捷键契约全绿（$(grep -c '✓' /tmp/g35-probe.log) 项，$(tail -1 /tmp/g35-probe.log)）"
else
  bad "G-35 快捷键契约（见 /tmp/g35-probe.log）"
fi
grep -q "wireAccelerators：新增 Cmd/Ctrl+K（搜索）与 Cmd/Ctrl+/（快捷键表）" /tmp/g35-probe.log 2>/dev/null \
  && ok "G-35 GP-M35：wireAccelerators 接入 K / 两条新绑定" \
  || bad "G-35 accelerators missing"
grep -q "会话搜索仍由 setSessionSearchOpen 单一入口揭出" /tmp/g35-probe.log 2>/dev/null \
  && ok "G-35 GP-M35：Cmd/Ctrl+K 复用既有搜索入口（setSessionSearchOpen），不造第二份状态" \
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
grep -q "#account-popup 锚在触发元素上方（absolute）" /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：账户弹层锚在触发元素上方 + z-index: 4x（不被 #agents overflow 裁剪）" \
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
grep -q 'approvalRulesTitle" → 已本地化' /tmp/g37-probe.log 2>/dev/null \
  && grep -q 'accountSection" → 已本地化' /tmp/g37-probe.log 2>/dev/null \
  && ok "G-37 GP-M37：approvalRulesTitle / accountSection 已本地化（原 autoReview 项已被这两条取代）" \
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
grep -q "sess-row:hover 背景色带" /tmp/g39-probe.log 2>/dev/null \
  && ok "G-39 GP-M39：sess-row hover 整行色带（参考图无位移）" \
  || bad "G-39 sess-row hover missing"
grep -q "sess-row 是圆角色带、行间无分隔线" /tmp/g39-probe.log 2>/dev/null \
  && ok "G-39 GP-M39：sess-row 圆角色带、行间无分隔线（参考图形状）" \
  || bad "G-39 sess-row shape missing"
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
grep -q "user 气泡：四角同值 18px" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 GP-M42：user 气泡四角同值 18px（--radius-user，Target v2 已去掉尾角）" \
  || bad "G-42 user tail missing"
grep -q "assistant 气泡：var(--bot-bubble)" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 GP-M42：assistant 气泡 bot-bubble + 左上尾角" \
  || bad "G-42 assistant tail missing"
grep -q "连续 assistant 行 margin-top 收紧" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 GP-M42：连续 assistant 回合收紧行距，形成同一条对话流节奏" \
  || bad "G-42 grouping missing"
# 头像这一项原本也在 G-42 的同一句话里；按参考图重锚（850259e）后探针把它拆成
# 独立断言，锚点必须跟着拆，否则这句话永远查不到、门禁常年假红。
grep -q "assistant 头像圆点已移除" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 GP-M42：assistant 头像圆点按参考图移除（原「隐藏重复头像」的现役等价断言）" \
  || bad "G-42 avatar removal anchor missing"
grep -q "M20 用户胶囊正则仍匹配" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 M20 回归护栏：用户胶囊正则仍匹配" \
  || bad "G-42 M20 regression"
grep -q "负向对照：抹掉 #log max-width" /tmp/g42-probe.log 2>/dev/null \
  && ok "G-42 负向对照：抹掉 #log max-width → 居中列断言翻假（非恒真）" \
  || bad "G-42 negative control"

echo "== G-43 Settings 面板精修（M43：分段 tab 条 + sticky 头部）=="
if timeout 900 node scripts/prove_m43_settings.js > /tmp/g43-probe.log 2>&1; then
  ok "G-43 M43 设置面板契约全绿（$(grep -c '✓' /tmp/g43-probe.log) 项，$(tail -1 /tmp/g43-probe.log)）"
else
  bad "G-43 M43 设置面板契约（见 /tmp/g43-probe.log）"
fi
grep -q "#settings-tabs 分段控件容器" /tmp/g43-probe.log 2>/dev/null \
  && ok "G-43 GP-M43：#settings-tabs 分段控件（inline-flex + 浅底 + 999px）" \
  || bad "G-43 segmented tabs missing"
grep -q "sheet 头部 sticky" /tmp/g43-probe.log 2>/dev/null \
  && ok "G-43 GP-M43：sheet 头部 sticky（滚动时标题常驻）" \
  || bad "G-43 sticky head missing"
grep -q "HTML #settings-tabs 无 inline style" /tmp/g43-probe.log 2>/dev/null \
  && ok "G-43 GP-M43：HTML 无 inline style，CSS 分段控件不被覆盖" \
  || bad "G-43 inline style leak"
grep -q "M42 消息流满列宽 + M20 用户胶囊契约保持" /tmp/g43-probe.log 2>/dev/null \
  && ok "G-43 回归护栏：M42 满列宽 + M20 用户胶囊契约保持" \
  || bad "G-43 regression"
grep -q "负向对照：抹掉分段样式" /tmp/g43-probe.log 2>/dev/null \
  && ok "G-43 负向对照：抹掉分段样式 → 容器断言翻假（非恒真）" \
  || bad "G-43 negative control"

echo "== G-44 Header active 高亮修复（M44：dead border-color → 实心填充）=="
if timeout 900 node scripts/prove_m44_header.js > /tmp/g44-probe.log 2>&1; then
  ok "G-44 M44 header 契约全绿（$(grep -c '✓' /tmp/g44-probe.log) 项，$(tail -1 /tmp/g44-probe.log)）"
else
  bad "G-44 M44 header 契约（见 /tmp/g44-probe.log）"
fi
grep -q "实心 accent 填充" /tmp/g44-probe.log 2>/dev/null \
  && ok "G-44 GP-M44：header 按钮 active 改实心 accent 填充（修 dead border-color）" \
  || bad "G-44 active fill missing"
grep -q "#header-actions button:active scale(0.96)" /tmp/g44-probe.log 2>/dev/null \
  && ok "G-44 GP-M44：header 按钮 :active scale(0.96) 与 composer 节奏一致" \
  || bad "G-44 header press missing"
grep -q "reduced-motion 下 #header-actions" /tmp/g44-probe.log 2>/dev/null \
  && ok "G-44 GP-M44：reduced-motion 归零 header 按压位移" \
  || bad "G-44 rm header missing"
grep -q "把 rail open 状态回写 gp-panel-btn" /tmp/g44-probe.log 2>/dev/null \
  && ok "G-44 GP-M44：toggleComputerRail 把 open 状态回写 gp-panel-btn.active（CSS+JS 双端闭合）" \
  || bad "G-44 gp active sync missing"
grep -q "M20 回归护栏：#header-actions 仍 justify-content: flex-end" /tmp/g44-probe.log 2>/dev/null \
  && ok "G-44 M20 回归护栏：header-actions 对齐不破" \
  || bad "G-44 M20 regression"
grep -q "负向对照：塞回 dead border-color" /tmp/g44-probe.log 2>/dev/null \
  && ok "G-44 负向对照：塞回 dead border-color → active 断言翻假（非恒真）" \
  || bad "G-44 negative control"


echo
echo "== G-45 定时任务排程引擎（GP-153：「每天9点」必须真的落在 9 点）=="
if timeout 600 node scripts/prove_gp153_cron_next_due.js > /tmp/g45-probe.log 2>&1; then
  ok "G-45 排程引擎契约全绿（$(grep -c '✓' /tmp/g45-probe.log) 项，$(tail -1 /tmp/g45-probe.log)）"
else
  bad "G-45 排程引擎契约（见 /tmp/g45-probe.log）"
fi
grep -q "0 9 \* \* \*.*落在 Asia/Shanghai 的 09:00" /tmp/g45-probe.log \
  && grep -q "0 18 \* \* 1-5.*下一个工作日 18:00" /tmp/g45-probe.log \
  && ok "G-45 GP-153：5 字段 cron 按墙钟触发（每天 09:00 / 工作日 18:00），不再是 now+24h 兜底" \
  || bad "G-45 wall-clock scheduling missing"
grep -q "两个时区各自落在本地 09:00" /tmp/g45-probe.log \
  && ok "G-45 GP-153：排程读设置里的 Bot 时区（换时区 → UTC 时刻不同）" \
  || bad "G-45 timezone missing"
grep -q "cron_unsupported" /tmp/g45-probe.log \
  && grep -q "cron_unreachable" /tmp/g45-probe.log \
  && grep -q "无法解析的 cron 被如实拒绝" /tmp/g45-probe.log \
  && ok "G-45 GP-153 诚实拒绝：解析不了/永不触发的排程不落假 next_due（不假装已建）" \
  || bad "G-45 honest refusal missing"
grep -q "@every 30m" /tmp/g45-probe.log \
  && grep -q "CRON_TZ= 前缀按表达式自己的时区排程" /tmp/g45-probe.log \
  && ok "G-45 GP-153：跟上内核 CM-0402 的 @every / CRON_TZ= 写法" \
  || bad "G-45 kernel cron dialect missing"
grep -q "每 1 分钟仍被拒（interval_too_short）" /tmp/g45-probe.log \
  && ok "G-45 GP-138 回归：新解析没绕过 5 分钟下限" \
  || bad "G-45 GP-138 regression"
grep -q "负向对照：now+24h 兜底落在" /tmp/g45-probe.log \
  && ok "G-45 负向对照：now+24h 兜底会被 09:00 断言判假（断言非恒真）" \
  || bad "G-45 negative control missing"


echo "== G-46 Target v2 桌面行为门禁（单实例 / 干净退出 / 侧栏自适应 / 命令通道 / 群菜单 / token 对齐）=="
# 这一组是 a652416 带进来的六个真实 Electron 门禁。它们此前只被 report.md 提到、
# 不在任何聚合门禁里 —— 不在矩阵里的门禁等于没有门禁（下一轮改动没人会再跑它）。
# 先自证尺子（秒级，无 Electron），再逐个串行跑真实渲染，最后带一次负向对照。
if timeout 120 node scripts/prove_gate_proc_count.mjs > /tmp/g46-ruler.log 2>&1; then
  ok "G-46 尺子自证：实例/残留计数不被 pgrep 的 sh -c 污染（$(tail -1 /tmp/g46-ruler.log)）"
else
  bad "G-46 尺子自证（见 /tmp/g46-ruler.log）"
fi
grep -q "旧 execSync(pgrep -f UD) 数到" /tmp/g46-ruler.log \
  && ok "G-46 尺子负向对照：旧写法确实多算（修复前红，证明断言非恒真）" \
  || bad "G-46 ruler negative control missing"

if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g46_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g46_xvfb=(xvfb-run -a)
  fi
  for g in single_instance sidebar_adapt layout_target quit command_channel bot_group_menu token_parity; do
    log=/tmp/g46-$g.log
    pkill -9 -f "dist/[e]lectron" 2>/dev/null
    sleep 1
    if timeout 900 ${g46_xvfb[@]+"${g46_xvfb[@]}"} node "scripts/e2e_desktop_$g.mjs" >"$log" 2>&1; then
      ok "G-46 e2e_desktop_$g 全绿（$(grep -c '✓' "$log") 项，$(tail -1 "$log")）"
    else
      bad "G-46 e2e_desktop_${g}（见 ${log}；$(tail -1 "$log")）"
    fi
  done
  grep -q "S-02 同 UD 只活着一个主进程" /tmp/g46-single_instance.log 2>/dev/null \
    && grep -q "S-03 第一个实例窗口仍在前台" /tmp/g46-single_instance.log 2>/dev/null \
    && ok "G-46 单实例：同 UD 第二实例被锁挡住并唤起已有窗口（用户双击两次只开一个）" \
    || bad "G-46 single-instance contract missing"
  grep -q "Q-01 进程仍在运行" /tmp/g46-quit.log 2>/dev/null \
    && grep -q "Q-02 app.quit() 后进程真的退出" /tmp/g46-quit.log 2>/dev/null \
    && grep -q "Q-04 同一 user-data-dir 能再次启动" /tmp/g46-quit.log 2>/dev/null \
    && ok "G-46 退出：红叉仍收进托盘（产品意图），quit 真退出且锁释放可再启动" \
    || bad "G-46 quit contract missing"
  grep -q "C-09" /tmp/g46-command_channel.log 2>/dev/null \
    && grep -q "C-10" /tmp/g46-command_channel.log 2>/dev/null \
    && grep -q "C-11" /tmp/g46-command_channel.log 2>/dev/null \
    && ok "G-46 命令通道：静默操作不进气泡 / 一句话组队建群 / 回执说人话" \
    || bad "G-46 command-channel contract missing"
  grep -q "R-02 窄窗" /tmp/g46-sidebar_adapt.log 2>/dev/null \
    && grep -q "R-04 手动收起后" /tmp/g46-sidebar_adapt.log 2>/dev/null \
    && grep -q "R-05 收起态的重开条" /tmp/g46-sidebar_adapt.log 2>/dev/null \
    && ok "G-46 侧栏自适应：窄窗侧栏最多 200px、主列拿剩下的（480 也走通）；手动收起后主列拿满视口、重开条可见可点、放宽不会被自动展开" \
    || bad "G-46 sidebar adaptation missing"
  echo "  · G-46 侧栏尺子更正（本轮）：上游 9d89d17 删掉「按窗口宽度自动收起」（index.html:18788-18791 写明设计意图），"
  echo "    R-02/R-03 原来断的「窄→自动收起、宽→自动展开」测的是已不存在的设计（实测 ✗ R-02 窄窗下左侧栏未自动收起）；"
  echo "    现在钉 700/480 档「侧栏 ≤200px 且 main+agents==视口、无横向滚动」，并补 D-L-14：收起态重开条必须可见可点可回（layout-contract.md §3.2）"
  echo "    同一轮 e2e_desktop_layout_target 的 15 条红（PASS=7 FAIL=15）全来自同一把坏尺子："
  echo "    ✗ gate block — page.evaluate: ReferenceError: applySidebarCollapse is not defined（符号已被上游删除，"
  echo "    两处无条件调用一次就把整档 12 条断言打成红）+ narrow/*: main w=700 ≠ viewport 900（旧的 main==视口 合同）。"
  echo "    改成真实点击进两态、按 §3.2 重算期望后本轮实测 PASS=14 FAIL=0"
  # 负向对照：关掉单实例锁，门禁必须翻红（否则这一组是恒真的装饰品）
  log=/tmp/g46-neg-single.log
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
  sleep 1
  if NEG_CONTROL=1 timeout 900 ${g46_xvfb[@]+"${g46_xvfb[@]}"} node scripts/e2e_desktop_single_instance.mjs >"$log" 2>&1; then
    bad "G-46 负向对照失效：关掉单实例锁后门禁仍全绿（恒真断言）"
  else
    grep -q "S-02 同 UD 出现多个主进程" "$log" \
      && ok "G-46 负向对照：BITBOT_DISABLE_SINGLE_INSTANCE=1 → 门禁真的翻红（非恒真）" \
      || bad "G-46 负向对照跑红了，但红的不是 S-02（见 ${log}）"
  fi
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
else
  echo "  · skip：playwright-core / electron dist 缺失，G-46 的六个真实门禁未跑（SKIP ≠ PASS）"
fi
echo "  · G-46 说明：六个门禁均为真实 Electron（Xvfb）渲染断言；串行执行并逐个清场，避免并发 profile 互撞"


echo "== G-47 安卓移动端门禁（线路契约 / 机器身份 / 在线证据 / APK 真编译）=="
# 移动端不能只靠读源码。三块：真 HTTP + 真内核的线路门禁、真实 Electron 的花名册
# 渲染门禁、以及真编译 APK 再用 aapt 把包里的事实读回来的构建门禁。
if command -v moon >/dev/null 2>&1; then
  if timeout 900 node scripts/e2e_android_turn.mjs > /tmp/g47-turn.log 2>&1; then
    ok "G-47 e2e_android_turn 全绿（$(grep -c '✓' /tmp/g47-turn.log) 项，$(tail -1 /tmp/g47-turn.log)）"
  else
    bad "G-47 e2e_android_turn（见 /tmp/g47-turn.log；$(tail -1 /tmp/g47-turn.log)）"
  fi
  grep -q "AND-03 安卓 ListMachines → 200 + assistant + phone-android" /tmp/g47-turn.log \
    && grep -q "AND-05 安卓设备工具列到真机器上的" /tmp/g47-turn.log \
    && grep -q "AND-09 手机说过话" /tmp/g47-turn.log \
    && ok "G-47 线路契约：手机挂在自己那台机器上（phone-android）、设备工具非空、回合留下在线证据" \
    || bad "G-47 android turn contract anchors missing"
  if NEG_CONTROL=1 timeout 900 node scripts/e2e_android_turn.mjs > /tmp/g47-neg.log 2>&1; then
    bad "G-47 负向对照失效：退回旧机器 id + 假装全在线之后门禁仍全绿（恒真断言）"
  else
    grep -q "AND-03 内核认下的机器是 phone-android" /tmp/g47-neg.log \
      && grep -q "AND-11 过期证据不许显示在线" /tmp/g47-neg.log \
      && ok "G-47 负向对照：旧机器 id / 假装全在线 → 门禁真的翻红（非恒真）" \
      || bad "G-47 负向对照跑红了，但红的不是 AND-03/AND-11（见 /tmp/g47-neg.log）"
  fi
else
  echo "  · skip：moon 不在 PATH，G-47 线路门禁未跑（SKIP ≠ PASS）"
fi

if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g47_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g47_xvfb=(xvfb-run -a)
  fi
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
  sleep 1
  if timeout 900 ${g47_xvfb[@]+"${g47_xvfb[@]}"} node scripts/e2e_android_roster.v2.mjs > /tmp/g47-roster.log 2>&1; then
    ok "G-47 e2e_android_roster.v2 全绿（$(grep -c '✓' /tmp/g47-roster.log) 项，$(tail -1 /tmp/g47-roster.log)）"
  else
    bad "G-47 e2e_android_roster（见 /tmp/g47-roster.log；$(tail -1 /tmp/g47-roster.log)）"
  fi
  grep -q "AR-02 有证据的手机" /tmp/g47-roster.log \
    && grep -q "AR-03 没有证据的手机保持离线" /tmp/g47-roster.log \
    && grep -q "AR-05 对话里看得见在线回执" /tmp/g47-roster.log \
    && ok "G-47 花名册：在线只认 Host 证据，普通用户在对话里也看得见（工具轨是 dev-only）" \
    || bad "G-47 roster anchors missing"
  grep -q "AR-06 真 app 的内联 onTurn" /tmp/g47-roster.log \
    && grep -q "AR-07 手机在真 app 里点设备工具" /tmp/g47-roster.log \
    && ok "G-47 桌面 app 自己的 /v1/turn 也把手机挂到 phone-android（共享模块修好 ≠ 产品修好）" \
    || bad "G-47 app-path anchors missing"
  grep -q "AR-09 令牌原文不外泄" /tmp/g47-roster.log \
    && grep -q "AR-11 开关是真的" /tmp/g47-roster.log \
    && ok "G-47 手机配对：令牌原文不落到页面上，「允许手机连接」是真开关（放开能打通、收回打不通，桌面自己照常）" \
    || bad "G-47 pairing anchors missing"
  grep -q "AR-12 用户抄的就是 base" /tmp/g47-roster.log \
    && grep -q "AR-13 配对地址如实标注来源" /tmp/g47-roster.log \
    && grep -q "AR-14 复制地址按钮" /tmp/g47-roster.log \
    && grep -q "AR-15 配对新增两行都落在类型阶上" /tmp/g47-roster.log \
    && ok "G-47 配对地址契约：用户抄的那一行是手机要填的 base（不带 /v1/turn），网卡来源如实标注，复制按钮跟随真实内容，说明行字号走类型阶" \
    || bad "G-47 pairing-address anchors missing"
  # 尺子变更记录（本轮）：旧那份 e2e_android_roster.mjs 的导航 .settings-tab-btn[data-stab="phone"]
  # 已被上游 29e1725 删除，实测停在 AR-08（page.click Timeout 30000ms，PASS=8 FAIL=1），
  # AR-09..17 一条没跑到。v2 把配对系列接到「账户 → 移动端远程控制」弹窗；
  # AR-09/AR-12 改成钉各自真正保护的用户事实（理由与代码证据在 v2 注释里），
  # 被有意移除的「掩码令牌那一行 / dev-only 完整端点那一行」登记为 GP-203，不当绿也不当红。
  echo "  · G-47 尺子重接（本轮实测）：旧门停在 ✗ page.click: Timeout 30000ms（waiting for .settings-tab-btn[data-stab=\"phone\"]）"
  echo "    → v2 走 #account-avatar-btn → #ap-remote → #mobile-control-modal（本轮 $(grep -c '✓' /tmp/g47-roster.log) 项全绿）；旧门留在仓里作历史尺子，G-47 不再跑它"
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
else
  echo "  · skip：playwright-core / electron dist 缺失，G-47 花名册真实渲染门禁未跑（SKIP ≠ PASS）"
fi

if timeout 1800 node scripts/prove_android_build.mjs > /tmp/g47-build.log 2>&1; then
  if grep -q "SKIP=1" /tmp/g47-build.log; then
    echo "  · skip：$(grep -m1 'SKIP —' /tmp/g47-build.log)（SKIP ≠ PASS）"
  else
    ok "G-47 APK 真编译 + aapt 读回包里的事实（$(tail -1 /tmp/g47-build.log)）"
    grep -q "AB-03b 扫描前置齐" /tmp/g47-build.log \
      && ok "G-47 局域网扫描前置成立：清单声明了 ACCESS_NETWORK_STATE（aapt 从包里读回）+ 取本机地址那步兜住异常，摘任一条都翻红" \
      || bad "G-47 AB-03b anchor missing（扫描前置没被断言：真机上点「扫描」可能是崩，不是「没找到桌面」）"
    grep -q "AB-07 配对地址归一化单测真跑" /tmp/g47-build.log \
      && grep -q "AB-08 失败原因翻译层单测真跑" /tmp/g47-build.log \
      && grep -q "AB-09 配对 v1 纯逻辑单测真跑" /tmp/g47-build.log \
      && grep -q "AB-10 无写死默认局域网地址" /tmp/g47-build.log \
      && ok "G-47 手机端配对单测真在跑（未配对不回写死地址、失败码翻人话、发现/换码逻辑、AB-10 无写死 IP 且带负向对照）" \
      || bad "G-47 AB-07/08/09/10 anchor missing"
    grep -q "AB-11 设计系统落地" /tmp/g47-build.log \
      && ok "G-47 UI 设计系统真落地：ui/ 五个文件在、MainActivity 走 BitBotTheme（不是框架默认紫）、全 main 无「对标 Grok」文案、8 条 UI 用例在结果里、AB-11 带负向对照" \
      || bad "G-47 AB-11 anchor missing"
    grep -q "AB-12 窗口层落地" /tmp/g47-build.log \
      && ok "G-47 窗口层主题真落地：manifest 挂 @style/Theme.BitBot + adjustResize、values/ 与 values-night/ 三个窗口色与 Theme.kt 画布字面量一致、APK 资源表里有 style/Theme.BitBot、4 条窗口用例在结果里、AB-12 带负向对照" \
      || bad "G-47 AB-12 anchor missing"
    grep -q "AB-13 回执呈现落地" /tmp/g47-build.log \
      && ok "G-47 内核回放在手机上说人话：MainActivity 把 /v1/turn 回包交给 HostReply.display、8 个 fixture 校验为真内核回包、6 条摘要/屏幕用例在结果里（含「认不得的 kind 不许编摘要」）、AB-13 带负向对照" \
      || bad "G-47 AB-13 anchor missing"
    grep -q "AB-14 对话落盘落地" /tmp/g47-build.log \
      && ok "G-47 聊天记录活过转屏与重开：ChatHistoryStore 落在 filesDir（不是外部存储）且有界、onCreate 读回来并喂进首屏、用户那句（TurnCoordinator）与助手那句（MainActivity）都过落盘、「清空对话」在菜单里并接到 clearChat、manifest 没用 configChanges 遮 recreate、9 条用例（CP-01..05 真渲染 + HS-01..04 那一层的边界）在结果里、AB-14 带负向对照" \
      || bad "G-47 AB-14 anchor missing"
    grep -q "AB-15 草稿落地" /tmp/g47-build.log \
      && ok "G-47 没发出去的半稿也不许被转屏吃掉：chat-draft.txt 单独一个文件在 filesDir（空即删）、onCreate 读回、ON_PAUSE 存、输入同步、发送立刻清，3 条用例（DF-01..03）在结果里、AB-15 带四组负向对照" \
      || bad "G-47 AB-15 anchor missing"
    grep -q "AB-16 回合不再归某一屏管" /tmp/g47-build.log \
      && ok "G-47 还在路上的回信不跟着上一屏死：协程挪到进程级 TurnCoordinator（SupervisorJob + Main.immediate）、busy/delivery 由那一层管、落盘后 revision++ 让屏幕重读文件、转屏回来补问权限、发送走 submitTurn，5 条用例（TF-01..05）在结果里、AB-16 带七组负向对照" \
      || bad "G-47 AB-16 anchor missing"
    grep -q "AB-06 JVM 单测真跑：199 用例 0 失败" /tmp/g47-build.log \
      && ok "G-47 用例数如实涨到 199（对话落盘 +9、草稿 +3、在路上的回合 +5、A1-4 事件流 15 + 三语 16 + 渲染级 10、A2-3 设备身份 9 + 端上接线 7、A3-5 中转传输层 10、A3-6 回执四栏 3 + 连接方式文案 3），且 0 失败不是空跑" \
      || bad "G-47 AB-06 用例数与本轮不符（见 /tmp/g47-build.log）"
    grep -q "AB-18 A3-5 手机侧中转传输层接齐" /tmp/g47-build.log \
      && ok "G-47 跨网那一半补上了：手机侧会 AUTH/CONNECT/TUNNEL、隧道上能跑 HTTP（定长/chunked）、TurnBridge 直连失败才回落中转，RT-01..RT-10 十条真跑 0 失败（五组负向对照全抓到）" \
      || bad "G-47 AB-18 anchor missing（手机侧中转传输层没有锚点在矩阵里）"
    grep -q "AB-19 A3-6 跨网参数接通" /tmp/g47-build.log \
      && ok "G-47 跨网参数有来源了：配对回执四栏被解析（RT-11..13）、成功即落 prefs、回合后记真实路径（TS-01..03）、状态条优先显示「直连/中转 · Nms」（五组负向对照全抓到）" \
      || bad "G-47 AB-19 anchor missing（桌面下发→手机解析→界面显示这条路没有锚点在矩阵里）"
    grep -q "AB-17 A2-3 端上真会签名" /tmp/g47-build.log \
      && ok "G-47 AB-17 端上设备签名那一层被钉住：金标文件 + DI/DT 点名用例 + 三处生产接线锚点（五组负向对照全抓到）" \
      || bad "G-47 AB-17 anchor missing（端上真会签名这件事没有锚点在矩阵里）"
  fi
else
  bad "G-47 prove_android_build（见 /tmp/g47-build.log；$(tail -1 /tmp/g47-build.log)）"
fi
echo "  · G-47 修复前红（本轮真实输出）：旧屏没有设计系统 —— setContent { MaterialTheme {"
echo "    顶着框架默认紫 #6750A4；UiDesignSystemTest 六条在旧 MainActivity 上真渲染跑红："
echo "      T1 找不到含「未配对」的节点（界面上根本没有连接状态）"
echo "      T2 找不到 ContentDescription='发送'（发送是写着「发送」的方形文字键）"
echo "      T3 找到 Role=Button Text=[凭证]（顶栏两个裸文字按钮）"
echo "      T4 找到 Text=[对标 Grok 的国产助手 · Android Host]"
echo "      T5 找到 Text=[BITBOT_HOST_URL]（环境变量名当标签）"
echo "      T6 找到 Text=[你]（每条消息挂角色标签）"
echo "    另：RobolectricComposeSmokeTest 读出 MaterialTheme.colorScheme.primary=#6750A4，"
echo "        「框架默认主题被原样发布」这件事本身钉成一条可读数字"
echo "  · G-47 修复前红（窗口层，同一批用例跑在还没换 manifest theme 的树上，4 条全红）："
echo "      windowBackground expected:<-1> but was:<-328966>（#FFFAFAFA 框架灰白）"
echo "      statusBarColor   expected:<-1> but was:<-9079435>（#FF757575）"
echo "      navigationBarColor expected:<-1> but was:<8421504>（#FF808080）"
echo "      windowLightStatusBar 主题里解析不到 attr=16844000（framework 浅色主题没这个 attr）"
echo "  · G-47 修复前红（内核回执，HostReplySummaryTest 12 条里 11 条红，实现换成当天 App 真实行为后真跑）："
echo "      [machines_list] 还在往聊天里贴代码围栏：Host FFI results applied … - ok kind=machines_list …"
echo "      unavailable 就是不可用：Host FFI results applied … - ok kind=device_permission cmd=\`desk-1|camera|unavailable\`"
echo "      feed 还没接上、备案还是空的 —— 这两条残留必须看得见：… - ok kind=check_updates …"
echo "      展开必须还能看到内核原文：null；认不得的 kind 必须原样给出来 expected:<[unknown]> but was:<[normal]>"
echo "      （12 tests completed, 11 failed —— 手机上以前的助手行就是这坨内核转储）"
echo "  · G-47 修复前红（聊天记录，ChatThreadPersistenceTest 5 条在 HEAD 产品代码上真渲染跑红）："
echo "      CP01 Failed: assertExists. Reason: Expected exactly '1' node but could not find any"
echo "        node that satisfies: (Text + EditableText contains '转个身就该还在的一句话')（转个身，屏幕上 0 个）"
echo "      CP02 同一条消息节点找不到；首屏同时退回空态（三个建议键还在）"
echo "      CP03 filesDir 下 0 个条目 —— 那句话只活在内存里，重开必丢"
echo "      CP04 「还没有对话文件可查（CP-03 已红），这条不得当绿用」（不许拿没有文件当「没泄漏」）"
echo "      CP05 菜单里根本没有「清空对话」这一行"
echo "  · G-47 负向对照（本轮新写那一层自己也得能被证伪，四组逐个摘，一次只动一行）："
echo "      摘掉上盘侧 takeLast → HS02 红；坏 JSON 直接往外抛 → HS03 红；save 恒回 true → HS04 红；"
echo "      落盘顺手带上配对令牌 → CP04 红；四组各自 1 条翻红、其余仍绿，全部还原后两批全绿"
echo "  · G-47 修复前红（输入草稿，ChatDraftPersistenceTest 在 HEAD 产品代码上真渲染，最终这版断言）："
echo "      DF01 AssertionError: 转个身，打了半篇的稿子从输入框里消失了（读到「」）"
echo "      DF02 AssertionError: filesDir 下找不到含这半稿的文件 —— 转屏靠的是实例复用，"
echo "           真机旋转（新建实例）照样丢（filesDir 条目数 0）；3 tests completed, 2 failed"
echo "      （DF03 断的是本轮新增的「发送即清草稿」，修复前没有草稿落盘，不参与红，见对照 3。"
echo "       第一轮 DF01/DF03 用 assertTextEquals 写，输入框空时它会连 placeholder 一起比，"
echo "       DF03 在未实现代码上「红」了 —— 原因不对；改成读 EditableText 语义属性后重测才是这条）"
echo "  · G-47 AB-15 的四组负向对照（都在源码层面真换一遍，同一把尺子必须每个都抓到）："
echo "      去掉 onCreate 的 loadDraft / 去掉 ON_PAUSE 的存盘 / 去掉发送后的清草稿 /"
echo "      草稿改放 getExternalFilesDir —— 四种走偏各被点名，抓不到即 AB-15 判红"
echo "  · G-47 修复前红（还在路上的回合，TurnInFlightRecreationTest 在 HEAD 产品代码上真渲染 +"
echo "    真 socket 假桌面，与终版同一份断言，5 tests completed, 5 failed；JUnit XML 逐字原文见"
echo "    report.md §8.29②，下面五条按用例名给摘句）："
echo "      「转个身正在等回信这件事还得看得见」→ 屏幕上没有「正在想」（忙状态跟着上一屏死了）"
echo "      「转个身之后那封回信仍然要上屏」→ 假桌面=收到=1 已放信=是，屏幕上只剩用户那句"
echo "      「转个身之后那封回信还要留在盘上」→ 盘上只有 [{\"role\":\"user\",…}] 那一条"
echo "      「等回信的时候转个身再按发送不许把同一件事发两遍」→ 假桌面收到 2 封（只该 1 封）"
echo "      「消息留住了证据条也得不跟着丢」→ 回信这一条先红，证据条根本等不到"
echo "  · G-47 这一轮门禁自己差点骗过人的三个地方（都记进 AB-16 的注释了）："
echo "      假桌面按字符读 Content-Length —— 中文句子字节数≠字符数，假桌面自己卡死，"
echo "      四条红看起来像「产品没修好」；改成按字节读满 + 每条断言带 server.describe() 之后，"
echo "      「假桌面没放信」与「产品没接住」才分得开"
echo "      compose.waitUntil 走的是虚拟时钟，跨真 socket + 真文件的这一跳它看不见（30s 不绿、"
echo "      当场 dump 却两行都在）；改成墙钟轮询 + waitForIdle() 才是这条断言真正在等的东西"
echo "      「…再按发送不许把同一件事发两遍」第一版断「再按发送时键是关着的」，在 HEAD 上居然绿了"
echo "      （按下那一刻请求还没落地）；换成「数假桌面收到几封」才量到红 —— 恒真断言宁可不写"
echo "  · G-47 AB-16 的七组负向对照（源码层面真换一遍，同一把尺子必须每个都抓到）："
echo "      回合换回 rememberCoroutineScope / 落盘后不 revision++ / busy 退回 composition /"
echo "      证据条退回 composition / 屏幕不按 revision 重读 / 发送换回 scope.launch /"
echo "      权限不补问（静默吞掉）—— 七种走偏各被点名，抓不到即 AB-16 判红"
echo "  · G-47 本轮的取证边界（诚实）：Robolectric 的 recreate() 复用同一个 Activity 实例，"
echo "    所以这条门盯的不是「实例有没有换」而是「协程归谁管」—— HEAD 在同一个 JVM 里也会被"
echo "    取消组合拖死，那五条红不是靠实例复用蒙出来的；真机旋转是新建实例，「回合归进程管、"
echo "    屏幕只是文件的一个视图」这条归属仍要在设备上验一次；进程被系统杀掉时没回完的回合"
echo "    就是没回完（本轮不假装能续上），投递证据条（SendToUser:*）也只活在进程里"
echo "  · G-47 AB-14 的尺子这一轮也被收紧过一次（第一次跑门跑出来的红，不是事后修饰）："
echo "      负向对照 1「onCreate 不读回历史」原本抓不到 —— 断言写的是 chatStore.load()，"
echo "      而本轮 MainActivity 里它出现两次（onCreate 读回 + revision 重读），摘掉一处另一处"
echo "      仍把它喂饱；改成钉死 startupLines = runCatching { chatStore.load() } 并补一条"
echo "      「读回来还得喂进首屏」（addAll(startupLines)）才真量到 —— 能被两处喂饱的尺子不算尺子"
echo "  · G-47 AB-16 第一次跑门把**正确代码**判红了：整文件正则撞上 TurnCoordinator 的 KDoc，"
echo "    注释里引用 rememberCoroutineScope() 是这一层的来由，不该算走偏；改成剥掉注释再查代码"
echo "  · G-47 一条写明白的取证边界：Robolectric 的 recreate() 复用同一个 Activity 实例，"
echo "    「屏幕上的草稿是从盘上读的还是从实例字段留下的」在语义树里分不出来 —— 只挂字段也能"
echo "    让 DF01/DF02 绿，而真机旋转是新建实例、那种写法照样丢。所以这一跳由 AB-15 的源码锚点"
echo "    （onCreate 必须真调 loadDraft）+ 对照 1 承担，真机旋转仍是残留"
echo "  · G-47 UI 验证的边界（诚实）：JVM 验到的是 Compose 语义树 + 送进渲染器的颜色数值两层；"
echo "    captureToImage 在 Robolectric NATIVE 模式下 2000ms 超时，拿不到真像素 —— "
echo "    圆角/字距/阴影/动效观感与厂商 ROM 表现仍未验证，必须真机看；"
echo "    Robolectric 跑的是默认浅色配置，values-night 只能靠 AB-12 读资源文本并与 Theme.kt"
echo "    的 CanvasDark 字面量对齐，深色观感同样没在 JVM 上验过"
echo "  · G-47 残留（诚实）：无 KVM → emulator、真机 OS 权限弹窗、厂商商店签名（BITBOT_ANDROID_STORE_*）均未验证"
echo "  · G-47 残留（聊天记录这一层，诚实）：「转屏」在 JVM 上走 Activity.recreate()（同实例重走 onCreate，"
echo "    Compose 组合是新的），真机旋转 + 厂商 ROM 杀后台仍未在设备上验过；"
echo "    「进程被杀后重开」是全新实例，Robolectric 的语义树够不到第二个实例，那半边由"
echo "    CP-03（那句话确实在 filesDir 的文件里）承担，不是由屏幕上的节点承担；"
echo "    历史很长时 LazyColumn 只组合可见项，屏幕上的条数断言只覆盖首屏那一窗"
echo "    同一套边界也适用于本轮的草稿（DF-01..03）：ON_PAUSE 存盘在真机切后台/被回收那一刻"
echo "    是否真走到，只有设备上能验"

echo "== G-48 配对地址与在线证据的底层健壮性（纯 Node，不需要显示环境）=="
if timeout 300 node scripts/prove_pairing_lan_rank.mjs > /tmp/g48-lanrank.log 2>&1; then
  ok "G-48 配对地址挑哪个网卡：LR 全绿（$(tail -1 /tmp/g48-lanrank.log)）"
else
  bad "G-48 prove_pairing_lan_rank（见 /tmp/g48-lanrank.log；$(tail -1 /tmp/g48-lanrank.log)）"
fi
if timeout 300 node scripts/prove_presence_durability.mjs > /tmp/g48-presence.log 2>&1; then
  ok "G-48 多端在线证据扛得住并发与崩溃：PD 全绿（$(tail -1 /tmp/g48-presence.log)）"
else
  bad "G-48 prove_presence_durability（见 /tmp/g48-presence.log；$(tail -1 /tmp/g48-presence.log)）"
fi
echo "  · G-48 锚点：docker0 顶第一位=修复前红（旧顺序实测 172.17.0.1 第一）；"
echo "    并发丢证据=修复前红（12 并发只剩 10 行）；空窗读=修复前红（33 万次撞在截断窗口上）"
echo "  · G-48 新增两条红线（这轮矩阵偶发丢 2/12 条、子进程零报错，根因在这里）："
echo "    PD-06 活着的持锁者被按年龄抢锁=修复前红（等待方比持有方早 1002ms 进临界区）；"
echo "    PD-07 锁里没有持有者身份、释放时无法分辨是不是自己的锁=修复前红"
echo "  · G-48 残留（诚实）：只验到同机多进程并发与崩溃窗口；跨机器时钟漂移、只读文件系统、Windows 文件锁语义未覆盖"

echo "== G-49 一键配对（局域网发现 + 6 位配对码，pairing-v1）=="
if timeout 300 node scripts/prove_pairing_code.mjs > /tmp/g49-paircode.log 2>&1; then
  ok "G-49 配对码生命周期与真 HTTP 换令牌全绿（$(tail -1 /tmp/g49-paircode.log)）"
else
  bad "G-49 prove_pairing_code（见 /tmp/g49-paircode.log；$(tail -1 /tmp/g49-paircode.log)）"
fi
grep -q "PC-13" /tmp/g49-paircode.log \
  && grep -q "PC-18" /tmp/g49-paircode.log \
  && grep -q "PC-19" /tmp/g49-paircode.log \
  && ok "G-49 三条关键证据在：换到的令牌真能打通 /v1/turn（PC-13）、base_url 走网卡排序不给 docker0（PC-18）、LAN 未放开如实 409（PC-19）" \
  || bad "G-49 pairing-code anchors missing"
echo "  · G-49 锚点：discover/redeem 未实现时 404=修复前红；base_url 用枚举顺序第一个地址"
echo "    （装 Docker 的机器上就是 172.17.0.1，等于自动给用户抄错地址）=修复前红（PC-18）"
echo "  · G-49 残留（诚实）：手机端扫描/换令牌只到 JVM 集成测试（进程内真 HTTP 服务），没有真机 Wi-Fi 验证；"
echo "    多网卡机器上手机可能扫到另一台同名 Desktop；未配内网穿透，公网机器仍配不上"

echo "== G-50 交付报告的历史段落不能被吃掉 =="
if timeout 120 node scripts/prove_report_history_intact.mjs > /tmp/g50-report.log 2>&1; then
  ok "G-50 报告段落一节没少（$(tail -1 /tmp/g50-report.log)）"
else
  bad "G-50 prove_report_history_intact（见 /tmp/g50-report.log；$(tail -1 /tmp/g50-report.log)）"
fi
# 负向对照：复刻 227e4ed 事故（尾部整段被替换掉），这道门必须变红，否则它没有牙
head -n 250 docs/design/desktop-target/report.md > /tmp/g50-negative-report.md
if timeout 120 node scripts/prove_report_history_intact.mjs /tmp/g50-negative-report.md > /tmp/g50-neg.log 2>&1; then
  bad "G-50 负向对照没红：截断到 250 行的报告照样过门，说明这道门是假门"
else
  ok "G-50 负向对照真红：截断版被抓住（$(tail -1 /tmp/g50-neg.log)）"
fi
rm -f /tmp/g50-negative-report.md
grep -q "RH-06" /tmp/g50-report.log \
  && grep -q "RH-01" /tmp/g50-neg.log \
  && ok "G-50 锚点在：RH-06 专门盯「HEAD 里已提交的标题在当前文件消失」，这正是 227e4ed 事故的形状" \
  || bad "G-50 report-history anchors missing"
  grep -q "RH-07 两份过程文档" /tmp/g50-report.log \
    && ok "G-50 RH-07 在：范围从验收报告扩到 parity 清单 —— 这轮工作区又冒出一份陈旧快照，把 parity-gaps-next.md 从 168 行盖到 95 行（「〇、核心叙事」整段没了），只盯 report.md 抓不到第二份文档；负向对照真实跑红（PASS=6 FAIL=1）后才还原" \
    || bad "G-50 RH-07 anchor missing"
echo "  · G-50 修复前红（真实输出，跑在 227e4ed 那份被吃掉段落的 report.md 上）："
echo "    RH-01 缺 16 个标题、RH-05 实际 251 行，PASS=4 FAIL=2（exit=1）；恢复后 PASS=6 FAIL=0"
echo "  · G-50 残留（诚实）：门只核标题/编号/围栏/行数下限，标题不动而正文被逐段改写抓不到；"
echo "    pairing-v1.md 与 parity-gaps-next.md 暂未纳入同一道门"

echo "== G-51 国内渠道凭证不裸奔（掩码 + 字段级校验 + 同一屏下一步）=="
if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g51_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g51_xvfb=(xvfb-run -a)
  fi
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
  sleep 1
  if timeout 900 ${g51_xvfb[@]+"${g51_xvfb[@]}"} node scripts/e2e_desktop_cn_channel_guard.mjs > /tmp/g51-cnchan.log 2>&1; then
    ok "G-51 e2e_desktop_cn_channel_guard 全绿（$(grep -c '✓' /tmp/g51-cnchan.log) 项，$(tail -1 /tmp/g51-cnchan.log)）"
  else
    bad "G-51 e2e_desktop_cn_channel_guard（见 /tmp/g51-cnchan.log；$(tail -1 /tmp/g51-cnchan.log)）"
  fi
  grep -q "CN-01 钉钉 Webhook 默认掩码" /tmp/g51-cnchan.log \
    && grep -q "CN-03 勾了开启推送但没填 Webhook" /tmp/g51-cnchan.log \
    && grep -q "CN-05 有错时保存不可点" /tmp/g51-cnchan.log \
    && ok "G-51 三条红线在：带 access_token 的 URL 不再明文躺着、勾了开启缺字段当场点名、错误挡在写盘之前" \
    || bad "G-51 cn-channel anchors missing"
  grep -q "CN-06 卡内" /tmp/g51-cnchan.log \
    && grep -q "CN-08 未开启也写明" /tmp/g51-cnchan.log \
    && ok "G-51 手顺接上：填凭证的卡直接给出「去保存并试连」，未开启的渠道也如实交代" \
    || bad "G-51 next-step / state anchors missing"
  echo "  · G-51 修复前红（HEAD 产品代码真实输出）：PASS=0 FAIL=8 —— 8 条全红，"
  echo "    其中 CN-05 红在「有校验错误时保存并热加载照样能点」，CN-08 红在卡里根本没有状态行"
  echo "  · G-51 残留（诚实）：只验到「缺字段/明显不是地址」这一层，没验厂商格式细则；"
  echo "    「试连国内渠道」会真的发消息，门禁不敢碰，仍需在真群里人工验一次"
  echo "  · G-51 更正（§8.24）：这里原来还写着「钉钉加签密钥、飞书 encrypt_key/verification_token、"
  echo "    企微 callback_token 仍无输入框（要手改 .env.local）」—— 本轮已补上，见 G-52"
else
  echo "  · skip：缺 playwright-core 或 electron，G-51 未跑（SKIP ≠ PASS）"
fi

echo "== G-52 国内渠道加签 / 事件回调密钥能在界面上配（不再逼用户改 .env.local）=="
if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g52_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g52_xvfb=(xvfb-run -a)
  fi
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
  sleep 1
  if timeout 900 ${g52_xvfb[@]+"${g52_xvfb[@]}"} node scripts/e2e_desktop_cn_secret_inputs.mjs > /tmp/g52-cnsec.log 2>&1; then
    ok "G-52 e2e_desktop_cn_secret_inputs 全绿（$(grep -c '✓' /tmp/g52-cnsec.log) 项，$(tail -1 /tmp/g52-cnsec.log)）"
  else
    bad "G-52 e2e_desktop_cn_secret_inputs（见 /tmp/g52-cnsec.log；$(tail -1 /tmp/g52-cnsec.log)）"
  fi
  grep -q "CN-SEC-01 钉钉加签 / 飞书 Encrypt Key / 飞书 Verification Token / 企微 Callback Token 四个输入框都在" /tmp/g52-cnsec.log \
    && grep -q "CN-SEC-02 status 回读四个键" /tmp/g52-cnsec.log \
    && ok "G-52 读写两头接上：四个密钥栏在界面上建出来了，secrets:status 也真的回读它们（只给掩码）" \
    || bad "G-52 input/status anchors missing"
  grep -q "CN-SEC-03 已配置的密钥在卡里如实标出" /tmp/g52-cnsec.log \
    && grep -q "CN-SEC-04 四个密钥栏留空不报红" /tmp/g52-cnsec.log \
    && grep -q "CN-SEC-06 四个栏都带 data-secret-key" /tmp/g52-cnsec.log \
    && ok "G-52 三条边界在：已配置说得出尾号、可选字段不挡保存、值接得到写盘" \
    || bad "G-52 masked-state / optional / write-path anchors missing"
  echo "  · G-52 修复前红（同一轮实测）：PASS=1 FAIL=5 —— 四个 input 全部不存在、"
  echo "    secrets:status 不回读这四个键、密钥已在进程里卡里仍不说「已配置」；"
  echo "    当时唯一绿的 CN-SEC-04 是空断言（栏不存在→循环没跑），已补「栏必须存在否则判不过」"
  echo "  · G-52 顺带抓到的真问题：掩码必填栏（钉钉 Webhook）在磁盘已配置时被读成「空的」，"
  echo "    卡里报一句谎话还把「保存并热加载」按死 —— 现在空栏 + status present = 满足，"
  echo "    状态行写明「****尾号 已配置，无需重填」"
  echo "  · G-52 负向对照（断言非恒真）：把收集器选择器改成不存在的属性名、其余不动，"
  echo "    同一道门立刻 CN-SEC-06 翻红（PASS=5 FAIL=1），前五条仍绿 —— 它断的只有「值接不接得到写盘」"
  echo "  · G-52 残留（诚实）：本门不点真保存（.env.local 是固定路径，BITBOT_REPO_ROOT 隔离不到它），"
  echo "    所以「填进去的值真的落盘」只验到 data-secret-key + 页内收集器这一层，"
  echo "    最后一跳要在真机上人工验一次；四栏是否真能解掉厂商的验签，门禁不假设"
else
  echo "  · skip：缺 playwright-core 或 electron，G-52 未跑（SKIP ≠ PASS）"
fi

echo "== G-53 用户旅程验收门真的被跑（J1–J4 多 Bot 各岗 / P1–P12 自媒体日更真链）=="
# 这两道门写的是本项目的**验收标准本身**（「真实 Electron 里走不走得通」），可它们此前不在任何
# 聚合门里：`grep -rn "e2e_desktop_user_journeys\|e2e_desktop_creator_pipeline" scripts/*.sh`
# 在登记前是 0 命中 —— 门禁存在但没人跑，等于没有门禁；J/P 任何一条被改坏，矩阵照样全绿。
if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g53_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g53_xvfb=(xvfb-run -a)
  fi
  g53_run() {
    local name="$1" log="$2" tmo="$3"
    pkill -9 -f "dist/[e]lectron" 2>/dev/null
    sleep 1
    if timeout "$tmo" ${g53_xvfb[@]+"${g53_xvfb[@]}"} node "scripts/${name}.mjs" >"$log" 2>&1; then
      if grep -q "PASS=0 FAIL=0 SKIP=1" "$log"; then
        echo "  · skip：${name} 自报环境不足（$(grep -m1 'SKIP —' "$log" || echo '未给出原因')）— SKIP ≠ PASS"
        return 0
      fi
      ok "G-53 ${name} 全绿（$(grep -c '✓' "$log") 项，$(grep -m1 'PASS=' "$log")）"
    else
      bad "G-53 ${name}（见 ${log}；$(grep -m1 'PASS=' "$log" || tail -1 "$log")）"
      # 子日志不上传时，矩阵里只剩「PASS=29 FAIL=1」这种计数——等于知道红了却不知道红在哪。
      # 把失败断言原文和尾部现场直接搬进矩阵日志；artifact 也一并收这个文件。
      grep -n "✗" "$log" 2>/dev/null | head -10 | while IFS= read -r line; do
        echo "    ${line}"
      done
      tail -8 "$log" 2>/dev/null | while IFS= read -r line; do
        echo "    | ${line}"
      done
    fi
  }
  g53_run e2e_desktop_user_journeys /tmp/g53-journeys.log 900
  g53_run e2e_desktop_creator_pipeline /tmp/g53-creator.log 1200

  if [ -s /tmp/g53-journeys.log ]; then
    grep -q "J1 私聊可见区无调试行" /tmp/g53-journeys.log \
      && grep -q "同群也不共享人设" /tmp/g53-journeys.log \
      && grep -q "如实 partial 1/2" /tmp/g53-journeys.log \
      && grep -q "重启后仍是繁体" /tmp/g53-journeys.log \
      && ok "G-53 J 侧锚点在：私聊不串人设 / 同群各用各的职责 / 一个失败就如实 partial / 语言与 provider 切换都真生效" \
      || bad "G-53 journeys anchors missing（门跑了但关键红线没出现在输出里）"
  fi
  if [ -s /tmp/g53-creator.log ]; then
    grep -q "P2 一次布置、三个 Bot 分工跑完" /tmp/g53-creator.log \
      && grep -q "cron=0 9 \* \* \*" /tmp/g53-creator.log \
      && grep -q "P6 到期只备好草稿" /tmp/g53-creator.log \
      && grep -q "P7 批准后真的发出" /tmp/g53-creator.log \
      && ok "G-53 P 侧锚点在：三个岗真跑完 / 中文排程落成 09:00 墙钟 / 未批准不外发 / 批准后才真出信" \
      || bad "G-53 creator anchors missing（门跑了但日更链路的关键红线没出现在输出里）"
  fi
  if [ -s /tmp/g53-journeys.log ]; then
    grep -q "GP-52 受理未答：屏幕上真写了" /tmp/g53-journeys.log \
      && grep -q "GP-52 答上了的那笔不再刷" /tmp/g53-journeys.log \
      && grep -q "GP-52 被拒的那笔走「被拒」气泡" /tmp/g53-journeys.log \
      && ok "G-53 GP-52 那句话真在 Electron 屏幕上说得出来：受理未答才说排队、答上了不刷、被拒不混（§8.30 从源码锚点升级为渲染取证）" \
      || bad "G-53 GP-52 pending 渲染锚点缺失（门跑了但屏幕上那句话没出现）"
  fi
  if [ -s /tmp/g53-journeys.log ]; then
    if grep -q "GP-168 定时唤醒真的把挂账捡起重跑了" /tmp/g53-journeys.log \
       && grep -q "GP-168 到上限后群里看得见那句人话" /tmp/g53-journeys.log; then
      ok "G-53 GP-168 真 Electron 取证在：生产入口的定时唤醒把挂账捡起重跑、到上限那句人话落在群里（捡起不再只等下一次有人说话）"
    elif grep -q "GP-168 真唤醒取证" /tmp/g53-journeys.log; then
      echo "  · skip：GP-168 真 Electron 探针按边界条件没跑（数据根里有别人的挂账 / 可见 Bot 不足），SKIP ≠ PASS"
    else
      bad "G-53 journeys 里根本没有 GP-168 这条取证（门跑了却没测它）"
    fi
  fi
  echo "  · G-53 修复前红（结构性，不是产品数字）：这两道门在登记前 0 处被引用——"
  echo "    本轮把它们接进矩阵，并把 J 侧、P 侧的真实全绿第一次变成矩阵的一部分"
  echo "    （J 侧登记时 63 项，§8.30 加了 GP-52 三条渲染取证后实测 $(grep -m1 -o 'PASS=[0-9]*' /tmp/g53-journeys.log 2>/dev/null | sed 's/PASS=//' || echo '未跑') 项）"
  echo "  · G-53 说明：这两道门跑在仓库真实的 data/ 上，靠自己的快照-还原只回收本轮 GP155/UJ 前缀的行；"
  echo "    历史行、用户数据不动（矩阵跑完 git status 里 data/ 不该多出内容）"
  echo "  · G-53 残留（诚实）：G-53 自己不带负向对照（P5 拒绝过密排程、P7 未批准 no_grant 那类"
  echo "    「产品变宽松就会红」的断言算在门内部）；「定时推邮箱」验到的是 app 真生成一封带收件人"
  echo "    与稿件正文的信（host_mail_send 落 data/mail/sends），不是投递进真实邮箱 —— 真 SMTP 投递仍未验"
else
  echo "  · skip：缺 playwright-core 或 electron，G-53 未跑（SKIP ≠ PASS）"
fi

echo "== G-54 模型密钥粘错了当场说清楚（Bearer 头写法 / 界面自己的掩码 / 断行 / 没粘全）=="
if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g54_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g54_xvfb=(xvfb-run -a)
  fi
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
  sleep 1
  if timeout 900 ${g54_xvfb[@]+"${g54_xvfb[@]}"} node scripts/e2e_desktop_llm_key_paste_guard.mjs > /tmp/g54-lkkey.log 2>&1; then
    ok "G-54 e2e_desktop_llm_key_paste_guard 全绿（$(grep -c '✓' /tmp/g54-lkkey.log) 项，$(tail -1 /tmp/g54-lkkey.log)）"
  else
    bad "G-54 e2e_desktop_llm_key_paste_guard（见 /tmp/g54-lkkey.log；$(tail -1 /tmp/g54-lkkey.log)）"
  fi
  grep -q "LK-01 粘进 HTTP 头写法自动收成纯 key" /tmp/g54-lkkey.log \
    && grep -q "LK-02 粘到界面自己的掩码会当场点名并挡住保存" /tmp/g54-lkkey.log \
    && ok "G-54 归一化与拦错都在：Bearer 头写法收成纯 key（并写明清了什么）、粘到掩码当场拦住" \
    || bad "G-54 normalize / masked-paste anchors missing"
  grep -q "LK-04 正常的 sk-… 密钥 0 条红字" /tmp/g54-lkkey.log \
    && grep -q "LK-05 留空不报错" /tmp/g54-lkkey.log \
    && grep -q "LK-06 通义 / Kimi / 搜索 key 与主密钥同规则" /tmp/g54-lkkey.log \
    && ok "G-54 不变成新门槛：正常 key 不拦、留空＝不改动讲得明白、四把密钥同规则" \
    || bad "G-54 not-a-new-barrier anchors missing"
  echo "  · G-54 修复前红（同一轮实测）：PASS=2 FAIL=5 —— Bearer 头写法原样收下、"
  echo "    界面自己的掩码 ****3k7q 被当密钥、断行/中文/没粘全三条全无红字；"
  echo "    当时唯一两条绿（LK-04/LK-07）是空断言（根本没有校验，当然不报红）"
  echo "  · G-54 负向对照（两个方向都试）：摘掉校验（任何值都放行）→ LK-02/03/06 翻红 PASS=4 FAIL=3；"
  echo "    反过来让任何值都报错 → LK-04/05/07 翻红 PASS=2 FAIL=5（LK-02/03 也红，因为它们要的是说对原因）"
  echo "  · G-54 尺子更正（本轮）：上游把「留空＝不改动」从状态行移进输入框 placeholder"
  echo "    （index.html:8349-8371 写占位，i18n credKeyPhSaved :15752/:16550/:17348），"
  echo "    LK-05 原来只读 #sec-llm-mask 因此判红 —— 那是尺子在要求文案待在旧元素里。"
  echo "    现在状态行与占位符都读，「留空＝不改动」必须在其中一处出现，缺了照样红（三件事一件没减）"
  echo "  · G-54 残留（诚实）：本门不点真保存（.env.local 是固定路径，门禁不许碰用户真文件），"
  echo "    所以「归一化后的 key 真的写进去了」这一跳不在这里断；校验只拦本 app 说得清的形状"
  echo "    （掩码 / 内部空白 / 中文 / 过短），厂商格式与「这把 key 能不能用」仍要靠试连那一步；"
  echo "    其它包裹写法（尖括号 <sk-…>、引号）暂未归一，遇到再加，不加没测过的代码"
else
  echo "  · skip：缺 playwright-core 或 electron，G-54 未跑（SKIP ≠ PASS）"
fi

echo "== G-55 GP-166：pending 转交的下游真的有人接（捡起 / 幂等 / 有界重试）=="
# 根因和 G-53 同一类：prove_room_orchestrator.js 里那条 handoff 合同链此前**不在任何聚合门里**
# （登记前 grep -rn "prove_room_orchestrator" scripts/*.sh = 0 命中）——门禁存在但没人跑，
# R-01…R-10 随便改坏，矩阵照样全绿。这里把它接进来，并把「捡起」的接线锚在产品入口上。
node scripts/prove_room_orchestrator.js >/tmp/gp166-orch.log 2>&1
if [ $? -eq 0 ] && grep -q "fail=0" /tmp/gp166-orch.log; then
  ok "G-55 群编排真团队合同全绿（$(grep -c '✓' /tmp/gp166-orch.log) 项，$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp166-orch.log)）"
else
  bad "G-55 prove_room_orchestrator 未通过（见 /tmp/gp166-orch.log；$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp166-orch.log || tail -1 /tmp/gp166-orch.log)）"
fi
for gp166_a in "R-01 新一条群消息真的把 pending 的转交捡起重跑" \
               "R-02 同一笔凭据不重跑" \
               "R-03b 到上限就如实标 stuck" \
               "R-03c stuck 这件事在群转录里看得见" \
               "R-05 承接方已不在群里" \
               "R-06 坏凭据被如实跳过并计数" \
               "R-08 主群的回合不碰另一间的" \
               "R-09 新鲜 claim" \
               "R-10 claim 过期"; do
  if grep -q "✓ $gp166_a" /tmp/gp166-orch.log; then ok "G-55 锚点：$gp166_a"; else bad "G-55 锚点没跑绿：$gp166_a"; fi
done
# 接线锚 + 注入对照（一条尺子跑两次：真文件必须过、把入口摘掉的副本必须翻红 —— 恒真尺子不算尺子）
# 这里踩过一次坑：用 String.replace 只换得掉第一处引用，而入口在这个文件里有两处，
# 副本仍被判成「接着的」→ 第一次跑矩阵就是 397/1。摘东西要用 split/join 全量摘。
node -e '
const fs=require("fs");
const rd=fs.readFileSync("hosts/shared/room_dispatch.js","utf8");
const ps=fs.readFileSync("hosts/desktop/product_surface.js","utf8");
const html=fs.readFileSync("hosts/desktop/index.html","utf8");
const wired=(s)=>s.includes("surface.retryPendingHandoffs") && /handoff_retry:/.test(s);
const store=ps.includes("    retryPendingHandoffs,")
  && /HANDOFF_MAX_ATTEMPTS = 3/.test(ps)
  && ps.includes(String.raw`state === "answered" || state === "stuck"`)
  && ps.includes("handoff_stuck:");
const i18n=(html.match(/roomFailStuck:/g)||[]).length>=3 && html.includes(String.raw`key = "roomFailStuck"`);
const cut=rd.split("surface.retryPendingHandoffs").join("surface.handoffRetryEntryDisabled");
const real=wired(rd), mut=wired(cut);
if(!real||mut)console.error("注入对照：真文件接线="+real+" 摘掉入口的副本="+mut);
if(!store)console.error("store 侧终态/上限/卡住串锚点缺失");
if(!i18n)console.error("卡住那句话的三语 i18n 不齐");
process.exit(real&&!mut&&store&&i18n?0:1)' && ok "G-55 接线：唯一群回合入口挂着捡起（回包带 handoff_retry，摘掉就翻红）+ store 侧终态/上限/卡住串 + 那句话三语齐" || bad "G-55 wiring / 注入对照"

echo "== G-56 GP-168：定时唤醒那一班车也来捡挂账的转交（捡起不再只等下一次群回合）=="
# 和 G-55 同一个纪律：门写在 scripts/ 里但不接进聚合矩阵 = 没有门。
node scripts/prove_gp168_handoff_wake.js >/tmp/gp168-wake.log 2>&1
if [ $? -eq 0 ] && grep -q "fail=0" /tmp/gp168-wake.log; then
  ok "G-56 定时唤醒捡起合同全绿（$(grep -c '✓' /tmp/gp168-wake.log) 项，$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp168-wake.log)）"
else
  bad "G-56 prove_gp168_handoff_wake 未通过（见 /tmp/gp168-wake.log；$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp168-wake.log || tail -1 /tmp/gp168-wake.log)）"
fi
for gp168_a in "W-01 routine_tick 之后效果行带得出 handoff_retry（定时唤醒真的扫了挂账）" \
               "W-02 内核 nested_skipped 不算答上：挂账不得变 answered，群里不得出现「它答了」的行" \
               "W-03b stuck 在群转录里看得见（复用 bot_reply_error，不新增转录 kind）" \
               "W-04 stuck 是终态：再唤醒不再重跑、不再往群里刷行" \
               "W-06 单次唤醒最多捡 5 笔，剩下的如实报 pending（不是一次唤醒换来十次模型调用）" \
               "W-07b 交付的答案各归各群的转录（不写错房间）" \
               "W-09 {room} 模式仍只处理那间群：B 间的调用捡不走 A 间的挂账（新增 all_rooms 没改老语义）" \
               "W-10 没指定群也没开 all_rooms → 如实拒绝，不自作主张扫全部"; do
  if grep -q "✓ $gp168_a" /tmp/gp168-wake.log; then ok "G-56 锚点：$gp168_a"; else bad "G-56 锚点没跑绿：$gp168_a"; fi
done
# 真生产入口取证：CLI「tick routines」（= scripts/host_routine_daemon.sh 每一轮真的跑的命令行）。
# 只在这台机器的数据根里没有别人的挂账时才跑：捡起会写 attempts，绝不在用户真实任务上做取证。
gp56probe=""
rm -f /tmp/gp56-proof.json
if [ "$(ls data/agents/handoffs/*.json 2>/dev/null | wc -l)" -eq 0 ]; then
  node -e '
const fs=require("fs"),path=require("path");
const {createProductSurface}=require("./hosts/desktop/product_surface");
const ROOT=path.resolve("."),DATA=path.join(ROOT,"data"),out=process.argv[1];
const roomsP=path.join(DATA,"desktop","rooms.json");
const rooms=JSON.parse(fs.readFileSync(roomsP,"utf8"));
const ids=((JSON.parse(fs.readFileSync(path.join(DATA,"desktop","bots.json"),"utf8")).bots)||[]).filter((b)=>b&&b.hidden!==true&&b.id).map((b)=>b.id);
if(ids.length<2){console.error("数据根里不足两个可见 Bot");process.exit(3);}
const rid="gp56-probe-"+Date.now().toString(36);
rooms.rooms=rooms.rooms||[];
rooms.rooms.push({id:rid,title:"GP-168 探针群",members:[ids[0],ids[1]],transcript:[]});
fs.writeFileSync(roomsP,JSON.stringify(rooms,null,2));
const surface=createProductSurface(ROOT,{dataRoot:DATA});
(async()=>{
  const res=await surface.handoffTaskAsync({room:rid,from_bot:ids[0],to_bot:ids[1],task:"GP-168 探针：定时发文挂了的稿子"},{runResponderTurn:async()=>({ok:false,error:"provider down",text:"",artifacts:[]})});
  if(!(res&&res.ok===true&&res.pending===true)){console.error("探针挂账造不出来 "+JSON.stringify({ok:res&&res.ok,pending:res&&res.pending,error:res&&res.error}));process.exit(4);}
  const dir=path.join(DATA,"agents","handoffs");
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,"handoff-"+ids[1]+"-"+Date.now().toString(36)+"-gp56.json");
  fs.writeFileSync(file,JSON.stringify(Object.assign({},res,{inbox_path:"",path:file}),null,2));
  fs.writeFileSync(out,JSON.stringify({room:rid,file:file,bot:ids[1]})+"\n");
})().catch((e)=>{console.error("探针异常 "+String((e&&e.message)||e));process.exit(5);});
' /tmp/gp56-proof.json >/tmp/gp56-setup.log 2>&1 && gp56probe=1
  if [ "$gp56probe" = "1" ]; then
    BITBOT_NEST_DEPTH=1 timeout 180 node hosts/cli_host/run_turn.js "tick routines" >/tmp/gp56-tick.json 2>/dev/null
    node -e '
const fs=require("fs");
const info=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const lines=fs.readFileSync(process.argv[2],"utf8").trim().split("\n").filter((l)=>l.startsWith("{"));
const j=JSON.parse(lines[lines.length-1]);
const hr=(j.host_results||[]).find((h)=>h&&h.kind==="routine_tick")||{};
let payload={};try{payload=JSON.parse(hr.stdout||"{}");}catch(_){payload={};}
const retry=payload.handoff_retry||hr.handoff_retry||null;
const stub=JSON.parse(fs.readFileSync(info.file,"utf8"));
const f=[];
if(hr.ok!==true)f.push("routine_tick 这一轮没跑成");
if(!retry||retry.scope!=="all_rooms")f.push("唤醒回包不带 handoff_retry(all_rooms)");
if(!(Number(retry&&retry.scanned)>=1))f.push("scanned<1（没扫到探针挂账）");
if(!(Number(retry&&retry.attempted)>=1))f.push("attempted<1（挂账没被捡）");
if(stub.state==="answered")f.push("nested_skipped 被演成答上了");
if(!(Number(stub.attempts)>=1))f.push("attempts 没递增");
if(!/nested_skipped/.test(String(stub.last_error||"")))f.push("last_error 不是 nested_skipped："+stub.last_error);
if(f.length){console.error(f.join(" | "));process.exit(1);}
' /tmp/gp56-proof.json /tmp/gp56-tick.json >/tmp/gp56-assert.log 2>&1 \
      && ok "G-56 真生产入口：CLI「tick routines」把探针挂账捡起重跑（attempts 递增、last_error=nested_skipped、没演成答上）" \
      || bad "G-56 真生产入口取证未通过（见 /tmp/gp56-assert.log：$(tail -1 /tmp/gp56-assert.log)）"
  else
    echo "  · skip：探针挂账造不出来，G-56 真生产入口未跑（SKIP ≠ PASS，见 /tmp/gp56-setup.log）"
  fi
else
  echo "  · skip：数据根里已有非探针的转交挂账，不在用户的真实任务上做取证（SKIP ≠ PASS）"
fi
# 探针只清自己造的那间群和那份凭据，别人的房间与转录一行都不动
node -e '
const fs=require("fs"),path=require("path");
let info=null;try{info=JSON.parse(fs.readFileSync("/tmp/gp56-proof.json","utf8"));}catch(_){info=null;}
if(!info)process.exit(0);
const roomsP=path.resolve("data/desktop/rooms.json");
try{
  const rooms=JSON.parse(fs.readFileSync(roomsP,"utf8"));
  const before=(rooms.rooms||[]).length;
  rooms.rooms=(rooms.rooms||[]).filter((r)=>r&&r.id!==info.room);
  fs.writeFileSync(roomsP,JSON.stringify(rooms,null,2));
  if((rooms.rooms||[]).length!==before-1)console.error("探针房间删除数不为 1");
}catch(e){console.error("探针房间清理失败 "+String((e&&e.message)||e));}
try{fs.unlinkSync(info.file);}catch(_){}
' >/tmp/gp56-clean.log 2>&1 || bad "G-56 探针清理失败（见 /tmp/gp56-clean.log）"
# 接线锚 + 注入对照：真文件必须过、把班车挂载和 all_rooms 口径分别摘掉的副本必须翻红
node -e '
const fs=require("fs");
const ffi=fs.readFileSync("hosts/shared/host_ffi.js","utf8");
const cutBus=ffi.split("surface.retryPendingHandoffs").join("surface.handoffRetryEntryDisabled");
const bus=(s)=>s.includes("surface.retryPendingHandoffs")&&s.includes("routineRes.handoff_retry = hr")&&/kind === "routine_tick" \|\| kind === "routine_wake"/.test(s);
const cutDepth=ffi.split("ok: !!(out && out.ok !== false) && !out.nested_skipped,").join("ok: !!(out && out.ok !== false),");
const depth=(s)=>(s.match(/&& !out\.nested_skipped/g)||[]).length>=2;
const scope=fs.readFileSync("hosts/desktop/product_surface.js","utf8");
const cutScope=scope.split(String.raw`scope: roomId ? "single_room" : allRooms ? "all_rooms" : ""`).join(String.raw`scope: ""`);
const sc=(s)=>s.includes(String.raw`scope: roomId ? "single_room" : allRooms ? "all_rooms" : ""`)&&s.includes(String.raw`o.all_rooms === true`);
const real=bus(ffi)&&depth(ffi)&&sc(scope), mut=!bus(cutBus)&&!depth(cutDepth)&&!sc(cutScope);
if(!real)console.error("接线锚缺失：班车="+bus(ffi)+" 两处 nested_skipped 同口径="+depth(ffi)+" scope 口径="+sc(scope));
if(!mut)console.error("注入对照没翻红：班车="+bus(cutBus)+" 深度口径="+depth(cutDepth)+" scope="+sc(cutScope));
process.exit(real&&mut?0:1)' && ok "G-56 接线：唤醒班车挂着捡起 + 交接与群回合同一套 nested_skipped 口径 + scope 口径（三处各摘各的都翻红）" || bad "G-56 wiring / 注入对照"

echo "== G-57 GP-169：Box 打包清单的传递闭包（手机连电脑那条链此前在真机上是断的）=="
# HEAD 上的事实：prove_box_routine_sweep.js = pass=0 fail=2，Box 一起来就 MODULE_NOT_FOUND，
# 而聚合矩阵里没有任何一行跑过它（grep -rn "prove_box_routine_sweep" scripts/*.sh 只命中它自己的 .sh 壳）。
# 根因不是逻辑错，是 pack-box.sh 那份手写文件名清单没跟着 cn_inbound_server / host_ffi 的新 require 更新。
node scripts/prove_box_pack_closure.js >/tmp/gp169-closure.log 2>&1
if [ $? -eq 0 ] && grep -q "fail=0" /tmp/gp169-closure.log; then
  ok "G-57 打包清单闭包全绿（$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp169-closure.log)，shared 清单 $(grep -m1 -o 'shared=[0-9]*' /tmp/gp169-closure.log)）"
else
  bad "G-57 prove_box_pack_closure 未通过（见 /tmp/gp169-closure.log；$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp169-closure.log || tail -1 /tmp/gp169-closure.log)）"
fi
for gp169_a in "P-01 真入口的 require 闭包全在打包清单里" \
               "P-02 闭包里的每个相对依赖在仓库里真的存在" \
               "P-03 清单里没有仓库里不存在的幽灵条目" \
               "P-04 这次补上的三个模块在清单里（回归锚）"; do
  if grep -q "✓ $gp169_a" /tmp/gp169-closure.log; then ok "G-57 锚点：$gp169_a"; else bad "G-57 锚点没跑绿：$gp169_a"; fi
done
# GP-184 的两条新锚：尺子的视力（P-05）与这条链的三个名字（P-06）。
# 文案里带本轮实测的边数，所以按前缀锚，不逐字比数字。
if grep -q "✓ P-05 闭包真的走跨目录边" /tmp/gp169-closure.log; then
  ok "G-57 锚点：P-05 尺子确实走通了 \`../…\` 的边（$(grep -m1 -o '`\.\./…` 拼法走通 [0-9]* 条' /tmp/gp169-closure.log)）——老视力只认 ./x，T1-03 那次漏拷就是从它眼皮底下过去的"
else
  bad "G-57 锚点没跑绿：P-05（闭包退回只看 ./x，../shared/… 的漏拷看不见）"
fi
if grep -q "✓ P-06 GP-184 回归锚" /tmp/gp169-closure.log; then
  ok "G-57 锚点：P-06 event_mirror / event_mirror_ref 三个名字各在其位"
else
  bad "G-57 锚点没跑绿：P-06（event_mirror 这条链的名字缺位）"
fi
# 注入对照：把三个名字从清单里全量摘掉，在同一把尺子的副本上重跑 —— 必须翻红；
# 同一副本不改时也必须是绿，否则红是尺子坏而不是清单坏。
rm -rf /tmp/g57mut && mkdir -p /tmp/g57mut/scripts /tmp/g57mut/hosts
ln -s "$(pwd)/hosts/shared" /tmp/g57mut/hosts/shared
ln -s "$(pwd)/hosts/desktop" /tmp/g57mut/hosts/desktop
# 用 cp 而不是 ln：node 会把主模块的 symlink 解析成 realpath，
# 挂成软链时门里的 ROOT 会退回仓库本身 —— 第一次跑这条注入对照就是这么「假绿」的。
cp -f scripts/prove_box_pack_closure.js /tmp/g57mut/scripts/prove_box_pack_closure.js
node -e '
const fs=require("fs");
const src=fs.readFileSync("scripts/pack-box.sh","utf8");
let cut=src;
for(const n of ["desktop_pairing.js","lan_candidates.js","machine_presence.js"])cut=cut.split(" "+n).join("");
if(cut===src){console.error("清单里摘不出这三个名字（尺子的输入不对）");process.exit(3);}
fs.writeFileSync("/tmp/g57mut/scripts/pack-box.sh",cut);
fs.writeFileSync("/tmp/g57mut/scripts/pack-box.clean.sh",src);
' && node /tmp/g57mut/scripts/prove_box_pack_closure.js >/tmp/g57-mut.log 2>&1
mut_red=1
grep -q "fail=0" /tmp/g57-mut.log && mut_red=0
cp -f /tmp/g57mut/scripts/pack-box.clean.sh /tmp/g57mut/scripts/pack-box.sh
node /tmp/g57mut/scripts/prove_box_pack_closure.js >/tmp/g57-clean.log 2>&1 || mut_red=0
if [ "$mut_red" = "1" ]; then ok "G-57 注入对照：摘掉三个名字的清单副本翻红、原样副本仍绿"; else bad "G-57 注入对照没成立（见 /tmp/g57-mut.log /tmp/g57-clean.log）"; fi
# 真机取证：真的 pack 出一个 Box、真的把 Host 进程起来、真的用设备密钥走一遍手机审批链
if timeout 900 node scripts/prove_box_routine_sweep.js >/tmp/gp169-sweep.log 2>&1 && grep -q "fail=0" /tmp/gp169-sweep.log; then
  ok "G-57 真 Box 取证：打包→起进程→到点扫→手机拉待批→批准留痕→重复批准被拒（$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp169-sweep.log)）"
else
  bad "G-57 真 Box 取证未通过（见 /tmp/gp169-sweep.log；$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp169-sweep.log || tail -3 /tmp/gp169-sweep.log | tr '\n' ' ')）"
fi
# 打包那步的 require 自检要在取证日志里点名（pack-box.sh 收尾跑的
# scripts/check_box_requires.js）：它判的是「打出来的包里，每个 require 簇至少
# 一条候选指得到文件」——清单漏拷与「平铺包里写了 dev 专用的 ../shared/…」都在这
# 里现形，而闭包尺子（P-01/P-05）看的是源。缺这一行 = 尺子没跑，不算绿。
if grep -q "require 自检通过" /tmp/gp169-sweep.log; then
  ok "G-57 打包 require 自检真跑了：$(grep -m1 -o '[0-9]* 个 .js、[0-9]* 个 require 簇' /tmp/gp169-sweep.log)，每簇至少一条指得到文件"
else
  bad "G-57 打包 require 自检没在取证日志里出现（pack-box.sh 里那步被摘掉了？SKIP ≠ PASS）"
fi

echo "== G-61 事件日志底座（T1-01/T1-02 · docs/events.md）=="
# 状态从 JSON 快照迁到「可续订的日志」的前提是：seq 由存储层分配、幂等键去重、
# 崩溃不丢、delta 永不落库。这些是纯 Node（node:sqlite）的断言，不需要显示环境。
if node -e "require('node:sqlite')" 2>/dev/null; then
  if timeout 300 node scripts/prove_event_log.mjs > /tmp/g61-eventlog.log 2>&1; then
    ok "G-61 事件日志契约全绿（$(grep -c '^ok EL' /tmp/g61-eventlog.log) 项，$(grep -m1 -o 'pass [0-9]* / fail [0-9]*' /tmp/g61-eventlog.log || tail -2 /tmp/g61-eventlog.log | head -1)）"
  else
    bad "G-61 事件日志契约（见 /tmp/g61-eventlog.log；$(grep -m1 -o 'pass [0-9]* / fail [0-9]*' /tmp/g61-eventlog.log || tail -2 /tmp/g61-eventlog.log | head -1)）"
  fi
  grep -q '^ok EL-04' /tmp/g61-eventlog.log \
    && grep -q '^ok EL-07' /tmp/g61-eventlog.log \
    && ok "G-61 幂等与崩溃两头的锚点在：重复投递读回原 seq、kill -9 之后已提交事件仍可读" \
    || bad "G-61 idempotence / crash anchors missing"
  grep -q '^ok EL-05' /tmp/g61-eventlog.log \
    && grep -q '^ok EL-09' /tmp/g61-eventlog.log \
    && ok "G-61 两条「拒绝」都在：delta 不进事件表、比读侧新的库拒绝打开" \
    || bad "G-61 delta / version anchors missing"
  echo "  · G-61 负向对照（本轮实测，断言非恒真）：把 NEVER_PERSISTED 清空后同一道门"
  echo "    立刻 EL-05「本该抛错，却没有」翻红，汇总从 pass 10/fail 0 变 pass 7/fail 3；"
  echo "    还原后回到 10/0 —— delta 能落库就意味着状态不再只由 fold(events) 得到"
  echo "  · G-61 残留（诚实）：T1-04 读切换、T1-06 单写者还没接上（T1-03 双写由 G-62 盯）——"
  echo "    本门只证明「日志本身立得住」，不证明 product_surface 已经改读它"
else
  echo "  · skip：本机 node 没有 node:sqlite，G-61 未跑（SKIP ≠ PASS）"
fi

echo "== G-62 双写旁路（T1-03 · fold(events) 与 JSON 快照逐字段相等，docs/events.md §5.4）=="
# AC-T1-3 的原句是「逐字段相等」，所以这把尺子不比事件总数：20 个真实写入点每走一步
# 就把日志从头折一次、和磁盘上的三张面比；库里出现的每一类事件都要被真删并重放全部
# 步骤（缺一类就有一步跟不上），无法认领的变化当场红。开关关掉时必须一个文件都不多。
if node -e "require('node:sqlite')" 2>/dev/null; then
  if timeout 600 node scripts/prove_event_dual_write.mjs > /tmp/g62-dualwrite.log 2>&1; then
    ok "G-62 双写契约全绿（$(grep -c '^ok DW' /tmp/g62-dualwrite.log) 项，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g62-dualwrite.log)）"
  else
    bad "G-62 双写契约（见 /tmp/g62-dualwrite.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g62-dualwrite.log || tail -2 /tmp/g62-dualwrite.log | tr '\n' ' ')）"
  fi
  grep -q '^ok DW-02' /tmp/g62-dualwrite.log \
    && grep -q '^ok DW-03d' /tmp/g62-dualwrite.log \
    && ok "G-62 逐步对拍与「零漏账」都在：$(grep -m1 -o '清单上 [0-9]* 步' /tmp/g62-dualwrite.log)每步都真改了快照，0 处变化没人认领" \
    || bad "G-62 DW-02 / DW-03d 锚点缺失（逐步对拍或漏账断言没跑绿）"
  grep -q '^ok DW-04z' /tmp/g62-dualwrite.log \
    && ok "G-62 反向对照逐类真删在：$(grep -m1 -o '库里的 [0-9]* 类事件' /tmp/g62-dualwrite.log)删掉任何一类都有某一步 fold 跟不上（没有死词）" \
    || bad "G-62 DW-04 锚点缺失（逐类反向对照没跑绿，DW-02 可能恒真）"
  grep -q '^ok DW-05b' /tmp/g62-dualwrite.log \
    && grep -q '^ok DW-05c' /tmp/g62-dualwrite.log \
    && ok "G-62 幂等的两条决定都在：同一处转换真发生两次库里就两行（不发 idem_key），内容没变的重复写一条不派" \
    || bad "G-62 DW-05 锚点缺失（幂等口径没被断言）"
  grep -q '^ok DW-06' /tmp/g62-dualwrite.log \
    && grep -q '^ok DW-01a' /tmp/g62-dualwrite.log \
    && ok "G-62 两条「不改行为」都在：开关关掉一个 .sqlite 都不留；镜像开库失败时快照照常落盘且失败被说人话" \
    || bad "G-62 DW-01a / DW-06 锚点缺失（旁路的隔离性没被断言）"
  # DW-10：本门跑在有 node:sqlite 的 Node 上，看不见 Electron 里那颗 Node 20 的事实；
  # 接线第一天正是这件事把主进程打死（G-16 往后所有 Electron 门一起红）。
  grep -q '^ok DW-10a' /tmp/g62-dualwrite.log \
    && grep -q '^ok DW-10b' /tmp/g62-dualwrite.log \
    && grep -q '^ok DW-10z' /tmp/g62-dualwrite.log \
    && ok "G-62 老运行时三条都在：伪装成没有 node:sqlite 后，开关关着零加载零输出照常落盘、开着说一句「已降级为不写」，且对照证明伪装真生效" \
    || bad "G-62 DW-10 锚点缺失（没有 node:sqlite 的运行时能不能启动没被断言）"
  echo "  · G-62 与 Electron 的分工：DW-10 用 Module._load 伪装老运行时（机制），真开机由 G-16/G-46 的 Electron 门盯（产物）"
  echo "  · G-62 实测（本轮日志，不是设计意图）：$(grep -m1 -o '[0-9]* 条事件、seq 严格递增[^（]*' /tmp/g62-dualwrite.log)；kind 账 $(grep -m1 -o 'approval_decided=[0-9]*.*session_created=[0-9]*' /tmp/g62-dualwrite.log)"
  # 注入对照：把 diffStore 里那条 entity_order_changed 的派出摘掉（sessions.create 是
  # unshift，顺序没人记 = fold 必然和快照分道），同一道门必须指名 DW 翻红。
  rm -f /tmp/g62-mut.log /tmp/g62-clean.log
  cp -f hosts/shared/event_mirror.js /tmp/g62-target.bak
  node -e '
const fs=require("fs");
const p="hosts/shared/event_mirror.js";
const src=fs.readFileSync(p,"utf8");
const hit="events.push({ kind: \"entity_order_changed\", sessionId: \"system\", payload: { surface, ids: actualOrder } });";
if(!src.includes(hit)){console.error("event_mirror.js 里找不到 entity_order_changed 那条派出（注入的输入不对）");process.exit(3);}
fs.writeFileSync(p,src.split(hit).join("void actualOrder; /* G-62 注入：顺序没人认领 */"));
' && timeout 600 node scripts/prove_event_dual_write.mjs >/tmp/g62-mut.log 2>&1
  g62_caught=0
  grep -q '^FAIL DW-' /tmp/g62-mut.log && g62_caught=1
  cp -f /tmp/g62-target.bak hosts/shared/event_mirror.js
  timeout 600 node scripts/prove_event_dual_write.mjs >/tmp/g62-clean.log 2>&1 && grep -q 'FAIL=0' /tmp/g62-clean.log || g62_caught=0
  cmp -s /tmp/g62-target.bak hosts/shared/event_mirror.js || g62_caught=0
  [ "$g62_caught" = "1" ] && ok "G-62 注入对照：摘掉 entity_order_changed 的派出就翻红（顺序没人认领），恢复后仍绿且文件逐字还原" \
    || bad "G-62 注入对照没成立（见 /tmp/g62-mut.log /tmp/g62-clean.log）"
  echo "  · G-62 残留（诚实）：双写证明的是「日志记得下今天的 JSON」，不证明产品已改读它"
  echo "    （T1-04）、不再写 JSON（T1-05）、或同会话单写者（T1-06）；approvals.log.jsonl"
  echo "    与 bots/settings/routines 都不在这三张面里（docs/events.md §7）。"
else
  echo "  · skip：本机 node 没有 node:sqlite，G-62 未跑（SKIP ≠ PASS）"
fi

echo "== G-63 设置 → 凭证按「必填 / 选填」分区（GP-185）=="
# 这一屏以前的门只问「id 在不在」，从不管「在第几层、折叠没有」，所以烂布局能全绿。
# 本门把形状钉成契约，同时钉住真机门依赖的可见性底线（折叠不能吃掉 Playwright 要点的控件）。
if timeout 900 node scripts/prove_settings_credentials_zones.js > /tmp/g63-credzones.log 2>&1; then
  ok "G-63 凭证分区契约全绿（$(grep -c '✓ CL' /tmp/g63-credzones.log) 项，$(tail -1 /tmp/g63-credzones.log)）"
else
  bad "G-63 凭证分区契约（见 /tmp/g63-credzones.log；$(tail -1 /tmp/g63-credzones.log)）"
fi
grep -q 'CL-04 真机门按 visible 点的' /tmp/g63-credzones.log \
  && grep -q 'CL-10 负向对照' /tmp/g63-credzones.log \
  && ok "G-63 两条命门都在：可见性底线（明面上的控件数 $(grep -o 'CL-04 真机门按 visible 点的 [0-9]*' /tmp/g63-credzones.log | grep -o '[0-9]*$')）+ 每条断言都能被真实改动打翻（$(grep -o 'CL-10 负向对照 [0-9]*/[0-9]*' /tmp/g63-credzones.log)）" \
  || bad "G-63 CL-04 / CL-10 锚点缺失（可见性底线或反向对照没被断言）"
echo "  · G-63 实测（本轮日志）：分区卡 $(grep -o 'CL-01 恰好 [0-9]* 张' /tmp/g63-credzones.log | grep -o '[0-9]*') 张、折叠外输入 $(grep -o 'CL-02 折叠外输入 = [0-9]*' /tmp/g63-credzones.log | grep -o '[0-9]*$') 栏、这一屏行内字面字号/色 $(grep -o 'CL-08 这一屏 [0-9]* 处' /tmp/g63-credzones.log | grep -o '[0-9]*') 处（原来 6 处）"
echo "  · G-63 残留（诚实）：只断形状，不断观感；「保存并热加载」在真机上是否真把 Key 写进"
  echo "    .env.local 并热加载，仍由 G-51/G-52 与 e2e_desktop_llm_key_paste_guard 盯。"

echo "== G-58 常驻内核进程（T1-07 · 一行请求换一回合，替代每轮 spawn）=="
# 需求的 AC 是可数的：「群聊 3 Bot 进程创建 = 0；崩溃自动重启并标记在途回合」。
# 子门同时量常驻侧和「把常驻关掉」的对照侧，所以这里的锚点是两个方向都有数 ——
# 只有常驻侧的数，无法区分「省掉了 spawn」和「没数到 spawn」。
KR_LOG=/tmp/g58-kernel-resident.log
KR_BIN=_build/native/release/build/cmd/desktop_turn/desktop_turn.exe
if [ -x "$KR_BIN" ] || [ -x "${KR_BIN%.exe}" ]; then
  if timeout 480 node scripts/prove_kernel_resident.mjs >"$KR_LOG" 2>&1; then
    ok "G-58 常驻内核契约全绿（$(grep -c '^ok KR' "$KR_LOG") 项，$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' "$KR_LOG" || tail -2 "$KR_LOG" | head -1)）"
  else
    bad "G-58 常驻内核契约（见 ${KR_LOG}；$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' "$KR_LOG" || tail -2 "$KR_LOG" | head -1)）"
  fi
  # 摘数用 grep -o 抓「key=数字」，不用 cut -c：CJK 按字节切会切成半个字。
  grep -q '^ok KR-04' "$KR_LOG" \
    && ok "G-58 AC 原句在：群聊 3 Bot 稳态一轮 $(grep -o '进程创建=[0-9]*、Host spawn=[0-9]*、请求=[0-9]* 条' "$KR_LOG" | head -1)（$(grep -o 'returned=[0-9]*/[0-9]*' "$KR_LOG" | head -1)，回话内容另见下方残留说明）" \
    || bad "G-58 KR-04 anchor missing（群聊 3 Bot 稳态零进程创建没被断言）"
  grep -q '^ok KR-05' "$KR_LOG" \
    && ok "G-58 崩溃侧锚点在：$(grep -o 'reason=[a-z_]*, turn=[A-Za-z0-9-]*' "$KR_LOG" | head -1)，$(grep -o '重启计数=[0-9]*' "$KR_LOG" | head -1)" \
    || bad "G-58 KR-05 anchor missing（崩溃重启 + 在途回合点名没被断言）"
  grep -q '^ok KR-03' "$KR_LOG" \
    && grep -q '^ok KR-07' "$KR_LOG" \
    && ok "G-58 反向对照 + 语义不变都在：关常驻 $(grep -o '[0-9]* 次 spawn' "$KR_LOG" | head -1)，常驻侧 $(grep -o 'Host 侧 spawn=[0-9]*' "$KR_LOG" | head -1)；同一批 argv 两条路结果逐条相同" \
    || bad "G-58 对照锚点缺失（KR-03 反向对照 / KR-07 语义不变）"
  grep -q '^ok KR-06' "$KR_LOG" \
    && ok "G-58 旧内核兼容锚点在：不认 --serve 的二进制被如实判成 not_serving，不是 crashed，也不挂死" \
    || bad "G-58 KR-06 anchor missing（旧内核识别没被断言）"
  echo "  · G-58 实测（本轮日志，不是设计意图）：常驻 $(grep -o '池侧进程创建=[0-9]*' "$KR_LOG" | head -1)，同一个 pid 做完 $(grep -o '请求=[0-9]*' "$KR_LOG" | head -1) 条请求；对照关常驻 $(grep -o '[0-9]* 次 spawn' "$KR_LOG" | head -1)"
  grep -q '^ok KR-10' "$KR_LOG" \
    && ok "G-58 桌面默认锚点在：$(grep -o '默认值写在 createTurnRunner 之前' "$KR_LOG" | head -1)且退出钩子与回退口都在" \
    || bad "G-58 KR-10 anchor missing（桌面宿主的默认值/关停钩子/回退口没被断言）"
  grep -q '^ok KR-11' "$KR_LOG" \
    && ok "G-58 CLI 收尾锚点在：$(grep -o 'CLI 宿主开常驻跑完一轮：[0-9]*ms 自己退出' "$KR_LOG" | head -1)，$(grep -o 'serve 进程 [0-9]*→[0-9]*' "$KR_LOG" | head -1)；反向对照（同型进程删掉关池那一步）仍被量到不退" \
    || bad "G-58 KR-11 anchor missing（一次性 CLI 在常驻默认下必须自己退出、不留内核，这条没被断言）"
  echo "  · G-58 本轮补上的一条真账（GP-204 → KR-11）：矩阵此前每轮跑完都留下 3 个"
  echo "    「node hosts/cli_host/run_turn.js tick routines」+ 3 对 moon/desktop_turn --serve 内核（本机累计 9 + 18）。"
  echo "    根因不在门禁脚本：桌面把常驻设成默认（hosts/desktop/main.js:55），一次性 CLI 没有桌面那两级"
  echo "    before-quit/will-quit 钩子，打完那一行 JSON 不收池 → 进程永远不退（修复前实测：stdout 3683 字节、"
  echo "    回合 ok=true，跑到 45026ms 上限被 SIGKILL；daemon 因此卡死在第一轮 sweep）。"
  echo "    修在 hosts/cli_host/run_turn.js（收尾 + 8s 兜底强杀），修复后同一轮 91ms 自己退出、serve 残留 0→0；"
  echo "    long-lived 两轮 sweep 从「卡到 timeout」变成 380ms 跑完。不常驻那条路一个字节没动（94ms、resident=false）。"
  echo "  · G-58 残留（诚实）：桌面宿主现在**默认**走常驻（BITBOT_KERNEL_RESIDENT=0 可退回每轮 spawn），"
  echo "    但本门没有启动真 Electron 去数进程 —— KR-10 是结构锚点（默认值写在 runner 创建之前、"
  echo "    before-quit/will-quit 钩子都在），不是开机实测。「打包出去的 app 已经不每轮 spawn」"
  echo "    这一句改由真开机盖章：PA-08（node scripts/prove_pack_artifacts.mjs 起包里的 .app 跑完一轮，"
  echo "    读包内证据的 loop_trace.resident，并确认宿主退出后包内内核 0 残留）。"
  echo "    关掉常驻时旧路径一个字节都没变（旧客户端仍能连）。"
  echo "    另外回话内容不在本门断言范围内：本机没配供应商密钥时 responder 回合会如实失败，"
  echo "    门量的是「三条回合都落在同一批常驻进程上」这一件可数的事。"
else
  echo "  · skip：没有 release 内核二进制（${KR_BIN}），G-58 未跑（SKIP ≠ PASS）"
  echo "    先跑：moon build --target native --release"
fi

echo "== G-59 GP-170：装好的 App 自己就是唤醒源（不靠仓库里的 bash daemon）=="
# 断点自证：唤醒此前 100% 外包给 scripts/host_routine_daemon.sh（bash），
# 而 electron-builder 的 files 清单根本没有 scripts/ —— 装到用户机器上的 App
# 找不到它；Windows 也没有 /bin/bash。既有 Electron 门禁又都设
# BITBOT_ROUTINE_DAEMON_AUTOSTART=0，于是这条路径从来没被跑过。
node -e '
const fs=require("fs");
const pkg=require("./hosts/desktop/package.json");
const files=(pkg.build&&pkg.build.files)||[];
const shipsScripts=files.some(f=>typeof f==="string"&&/^scripts\//.test(f));
const main=fs.readFileSync("hosts/desktop/main.js","utf8");
const wantsShellScript=main.includes("scripts\", \"host_routine_daemon.sh");
process.exit(!shipsScripts&&wantsShellScript?0:1)' \
  && ok "G-59 断点自证：装机包不含 scripts/，而 daemon 唤醒路径正需要它（所以必须有进程内定时器）" \
  || bad "G-59 断点自证失败：package.json 已随包带 scripts/，或 main.js 不再依赖那份 shell 脚本 —— 先复核断点是否还存在"

gp170_xvfb=()
if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
  gp170_xvfb=(xvfb-run -a)
fi
# 空数组在 set -u 下 `"${arr[@]}"` 会直接 unbound 把整个矩阵带崩（macOS 没有
# xvfb-run 时必踩）；和上面几道门一样用 ${arr[@]+"${arr[@]}"} 展开。
gp170_run() { timeout 240 ${gp170_xvfb[@]+"${gp170_xvfb[@]}"} node scripts/e2e_desktop_sweep_timer.mjs >"$1" 2>&1; }

if gp170_run /tmp/gp170-sweep.log && grep -q "FAIL=0" /tmp/gp170-sweep.log; then
  ok "G-59 真 Electron：daemon 关闭时 App 自己扫 routine_tick（$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]* SKIP=[0-9]*' /tmp/gp170-sweep.log)）"
else
  bad "G-59 e2e_desktop_sweep_timer 未通过（见 /tmp/gp170-sweep.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]* SKIP=[0-9]*' /tmp/gp170-sweep.log || tail -3 /tmp/gp170-sweep.log | tr '\n' ' ')）"
fi
for gp170_a in "S-01 daemon 关闭时，App 自己会跑 routine_tick" \
                "S-02 payload: desktop_sweep=true" \
                "S-03 连续两轮 tick" \
                "S-04 每轮都带 handoff_retry" \
                "S-05 single-flight：每轮 started_at/ended_at 成对且不重叠" \
                "S-06 退出后不再产生新 tick"; do
  if grep -q "✓ $gp170_a" /tmp/gp170-sweep.log; then ok "G-59 锚点：$gp170_a"; else bad "G-59 锚点没跑绿：$gp170_a"; fi
done

# 注入对照（全量摘，不用 String.replace 的单次语义）：
#   A 摘掉两个 syncWakeSource 启动点 → S-01..S-05 必须红
#   B 摘掉 host_ffi 的 desktop_sweep 可选字段 → S-02 必须红
#   C 摘掉 sweep 行的 ended_at → S-05 必须红
#   D 把 handoff_retry 转述改成 null → S-04 必须红
# 每次摘完都从备份恢复并用 cmp 核对，避免把仓库留在变异态。
cp -f hosts/desktop/main.js /tmp/gp170-main.bak
cp -f hosts/shared/host_ffi.js /tmp/gp170-ffi.bak
gp170_restore() {
  cp -f /tmp/gp170-main.bak hosts/desktop/main.js
  cp -f /tmp/gp170-ffi.bak hosts/shared/host_ffi.js
  cmp -s /tmp/gp170-main.bak hosts/desktop/main.js \
    && cmp -s /tmp/gp170-ffi.bak hosts/shared/host_ffi.js
}

gp170_ok=1
# A
python3 - <<'PY' || gp170_ok=0
p="hosts/desktop/main.js"; s=open(p).read()
a=s.replace('  const wake = syncWakeSource();','  const wake = { wake_source: "mutated-off", interval_ms: 0 };')
b=a.replace('  syncWakeSource();','  /* mutated off */')
assert b!=s and "mutated-off" in b and b.count("/* mutated off */")>=2
open(p,"w").write(b)
PY
gp170_run /tmp/gp170-mut-a.log || true
grep -q "FAIL=5" /tmp/gp170-mut-a.log && ! grep -q "✓ S-01" /tmp/gp170-mut-a.log \
  || { gp170_ok=0; cp -f /tmp/gp170-mut-a.log /tmp/gp170-mut-a.kept; }
gp170_restore || gp170_ok=0
# B
python3 - <<'PY' || gp170_ok=0
p="hosts/shared/host_ffi.js"; s=open(p).read()
b=s.replace('      if (desktopSweep) wakeEntry.desktop_sweep = true;','      /* mutation: field removed */')
assert b!=s
open(p,"w").write(b)
PY
gp170_run /tmp/gp170-mut-b.log || true
grep -q "FAIL=1" /tmp/gp170-mut-b.log && ! grep -q "✓ S-02" /tmp/gp170-mut-b.log && grep -q "✓ S-01" /tmp/gp170-mut-b.log \
  || { gp170_ok=0; cp -f /tmp/gp170-mut-b.log /tmp/gp170-mut-b.kept; }
gp170_restore || gp170_ok=0
# C
python3 - <<'PY' || gp170_ok=0
p="hosts/desktop/main.js"; s=open(p).read()
b=s.replace('    row.ended_at = new Date().toISOString();','    /* mutation: no ended_at */')
assert b!=s
open(p,"w").write(b)
PY
gp170_run /tmp/gp170-mut-c.log || true
grep -q "FAIL=1" /tmp/gp170-mut-c.log && ! grep -q "✓ S-05" /tmp/gp170-mut-c.log && grep -q "✓ S-01" /tmp/gp170-mut-c.log \
  || { gp170_ok=0; cp -f /tmp/gp170-mut-c.log /tmp/gp170-mut-c.kept; }
gp170_restore || gp170_ok=0
# D
python3 - <<'PY' || gp170_ok=0
p="hosts/desktop/main.js"; s=open(p).read()
b=s.replace('    row.handoff_retry = (hit && hit.handoff_retry) || payload.handoff_retry || null;','    row.handoff_retry = null; /* mutation */')
assert b!=s
open(p,"w").write(b)
PY
gp170_run /tmp/gp170-mut-d.log || true
grep -q "FAIL=1" /tmp/gp170-mut-d.log && ! grep -q "✓ S-04" /tmp/gp170-mut-d.log && grep -q "✓ S-01" /tmp/gp170-mut-d.log \
  || { gp170_ok=0; cp -f /tmp/gp170-mut-d.log /tmp/gp170-mut-d.kept; }
gp170_restore || gp170_ok=0

[ "$gp170_ok" = "1" ] && ok "G-59 注入对照：摘启动点/S-01-05 红、摘字段/S-02 红、摘 ended_at/S-05 红、摘转述/S-04 红（四处各摘各的都翻红）" \
  || bad "G-59 注入对照没成立（保留件见 /tmp/gp170-mut-*.kept）"

echo "== G-60 GP-171：被提交的源码必须先是跑得动、能解析的源码（冲突标记事故 + bash 3.2 空数组的回归门）=="
# 事实：远端 a0ec929 把未解完冲突的工作树提交了上去 ——
#   hosts/desktop/product_surface.js 里 2 组 <<<<<<< / ======= / >>>>>>>
#   scripts/prove_room_orchestrator.js 里 1 组，还有一份重复的 noRunner
# 结果桌面 App 一 require 就 SyntaxError，编排门连启动都到不了；
# 而当时的矩阵全在「解析之后」执行，没有任何一条会看源码本身。
# 2026-10-30 又补了 I-04：同一类「门禁看不见」的破损是 shell 本身跑不动 ——
#   矩阵 G-59 的 gp170_xvfb、pack-box.sh 的 BUILD_FLAGS、三个 prove_*.sh 的 FLAGS
# 都在 `set -u` + bash 3.2 下炸空数组裸展开；`bash -n` 全绿，只有真走到那条分支才死。
node scripts/prove_repo_integrity.mjs >/tmp/gp171-integrity.log 2>&1
if [ $? -eq 0 ] && grep -q "fail=0" /tmp/gp171-integrity.log; then
  ok "G-60 仓库完整性门全绿（$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp171-integrity.log)；$(grep -o '列出 [0-9]* 个被跟踪文件' /tmp/gp171-integrity.log | head -1)；$(grep -o '[0-9]* 个文件' /tmp/gp171-integrity.log | tail -1)）"
else
  bad "G-60 prove_repo_integrity 未通过（见 /tmp/gp171-integrity.log；$(tail -2 /tmp/gp171-integrity.log | tr '\n' ' ')）"
fi
for gp171_a in "I-00 git ls-files" "I-01 被跟踪文件里没有冲突标记" "I-02 被跟踪的 .js/.mjs 全部通过 node --check" "I-03 负向/正向对照" "I-04 被跟踪的 .sh 没有" "I-05 空数组尺子对照" "I-05 行为对照"; do
  if grep -q "✓ $gp171_a" /tmp/gp171-integrity.log; then ok "G-60 锚点：$gp171_a"; else bad "G-60 锚点没跑绿：$gp171_a"; fi
done
# 注入对照：往一份真的被跟踪的源文件末尾塞一行冲突标记，同一把尺子必须翻红；
# 恢复后必须绿。用 cmp 核对，工作树不留变异态。
# 目标选一份被跟踪、但本门不执行的普通源码（别拿门禁脚本自己：塞标记会让它
# 连解析都过不了，日志里根本没有 I-01 那行，会把「尺子真的红」误判成「尺子没动」）。
cp -f hosts/desktop/paths.js /tmp/gp171-target.bak
printf '\n<<<<<<< HEAD\n' >> hosts/desktop/paths.js
node scripts/prove_repo_integrity.mjs >/tmp/gp171-mut.log 2>&1
mut_caught=0
grep -q "✗ I-01" /tmp/gp171-mut.log && mut_caught=1
cp -f /tmp/gp171-target.bak hosts/desktop/paths.js
node scripts/prove_repo_integrity.mjs >/tmp/gp171-clean.log 2>&1 && grep -q "fail=0" /tmp/gp171-clean.log || mut_caught=0
cmp -s /tmp/gp171-target.bak hosts/desktop/paths.js || mut_caught=0
[ "$mut_caught" = "1" ] && ok "G-60 注入对照：真塞一行冲突标记就翻红（I-01），恢复后仍绿" \
  || bad "G-60 注入对照没成立（见 /tmp/gp171-mut.log /tmp/gp171-clean.log）"
# I-04 的注入对照：把 pack-box.sh 里那条 `+` 惯用法还原成今天真实炸过的裸展开
# （`"${BUILD_FLAGS[@]}"`，debug profile 下数组为空），尺子必须指名道姓翻红。
rm -f /tmp/gp174-mut.log /tmp/gp174-clean.log
cp -f scripts/pack-box.sh /tmp/gp174-target.bak
node -e '
const fs=require("fs");
const p="scripts/pack-box.sh";
const src=fs.readFileSync(p,"utf8");
const cut=src.split("${BUILD_FLAGS[@]+\"${BUILD_FLAGS[@]}\"}").join("\"${BUILD_FLAGS[@]}\"");
if(cut===src){console.error("pack-box.sh 里找不到那条惯用法（尺子的输入不对）");process.exit(3);}
fs.writeFileSync(p,cut);
' && node scripts/prove_repo_integrity.mjs >/tmp/gp174-mut.log 2>&1
g174_caught=0
grep -q "✗ I-04" /tmp/gp174-mut.log && grep -q "pack-box.sh.*BUILD_FLAGS" /tmp/gp174-mut.log && g174_caught=1
cp -f /tmp/gp174-target.bak scripts/pack-box.sh
node scripts/prove_repo_integrity.mjs >/tmp/gp174-clean.log 2>&1 && grep -q "fail=0" /tmp/gp174-clean.log || g174_caught=0
cmp -s /tmp/gp174-target.bak scripts/pack-box.sh || g174_caught=0
[ "$g174_caught" = "1" ] && ok "G-60 注入对照（I-04）：把 BUILD_FLAGS 那条 + 惯用法改回裸展开就翻红、且指到 pack-box.sh 行号，恢复后仍绿" \
  || bad "G-60 I-04 注入对照没成立（见 /tmp/gp174-mut.log /tmp/gp174-clean.log）"

echo "== G-63 GP-185：多端通用逻辑只有一份（环境解析 / 递送词表 / 机器 id）=="
node scripts/prove_multihost_common.mjs >/tmp/gp185-mh.log 2>&1
if [ $? -eq 0 ] && grep -q "fail=0" /tmp/gp185-mh.log; then
  ok "G-63 多端通用逻辑门全绿（$(grep -m1 -o 'pass=[0-9]* fail=[0-9]*' /tmp/gp185-mh.log)）"
else
  bad "G-63 prove_multihost_common 未通过（见 /tmp/gp185-mh.log；$(tail -2 /tmp/gp185-mh.log | tr '\n' ' ')）"
fi
for gp185_a in "MC-00 三个回合入口都经由共享模块" "MC-01 .env.local 解析只有一份" "MC-02 残差词表只有一份" "MC-03 可递送 Host kind 清单" "MC-04 机器 id 默认值只有一份" "MC-05 桌面 / CLI / 手机端都走 run_moon_turn" "MC-06 进度分类只有 progress_protocol" "MC-07 尺子自检" "MC-08 行为等价" "MC-09 iOS/Android 残差键与 RESIDUAL_KEYS 同序"; do
  if grep -q "✓ $gp185_a" /tmp/gp185-mh.log; then ok "G-63 锚点：$gp185_a"; else bad "G-63 锚点没跑绿：$gp185_a"; fi
done
# 注入对照 A：把一份重复的 .env 解析塞回 mobile_host —— MC-01 必须指名翻红。
cp -f hosts/mobile_host/run.js /tmp/gp185-mobile.bak
python3 - <<'PY'
p = "hosts/mobile_host/run.js"
s = open(p).read()
s += '\n/* mutation: duplicate env parser */\n' + r'function legacyEnv(file) { for (const line of require("fs").readFileSync(file, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq > 0) process.env[t.slice(0, eq)] = t.slice(eq + 1); } }' + '\n'
open(p, "w").write(s)
PY
node scripts/prove_multihost_common.mjs >/tmp/gp185-mut-env.log 2>&1 || true
g185a=0
grep -q "✗ MC-01" /tmp/gp185-mut-env.log && grep -q "mobile_host/run.js" /tmp/gp185-mut-env.log && g185a=1
cp -f /tmp/gp185-mobile.bak hosts/mobile_host/run.js
node scripts/prove_multihost_common.mjs >/tmp/gp185-clean-a.log 2>&1 && grep -q "fail=0" /tmp/gp185-clean-a.log || g185a=0
cmp -s /tmp/gp185-mobile.bak hosts/mobile_host/run.js || g185a=0
[ "$g185a" = "1" ] && ok "G-63 注入对照（MC-01）：塞回一份 .env 解析就翻红、指到 mobile_host/run.js，恢复后仍绿" \
  || bad "G-63 MC-01 注入对照没成立（见 /tmp/gp185-mut-env.log /tmp/gp185-clean-a.log）"
# 注入对照 B：把 phone-android 写回 seedMachineId —— MC-04 必须翻红。
cp -f hosts/shared/cn_inbound_product_on_turn.js /tmp/gp185-inbound.bak
python3 - <<'PY'
p = "hosts/shared/cn_inbound_product_on_turn.js"
s = open(p).read()
s = s.replace('function seedMachineId(machineKind) {', 'function seedMachineId(machineKind) {\n  if (machineKind === "android") return "phone-android"; /* mutation */')
open(p, "w").write(s)
PY
node scripts/prove_multihost_common.mjs >/tmp/gp185-mut-id.log 2>&1 || true
g185b=0
grep -q "✗ MC-04" /tmp/gp185-mut-id.log && grep -q "cn_inbound_product_on_turn.js" /tmp/gp185-mut-id.log && g185b=1
cp -f /tmp/gp185-inbound.bak hosts/shared/cn_inbound_product_on_turn.js
node scripts/prove_multihost_common.mjs >/tmp/gp185-clean-b.log 2>&1 && grep -q "fail=0" /tmp/gp185-clean-b.log || g185b=0
cmp -s /tmp/gp185-inbound.bak hosts/shared/cn_inbound_product_on_turn.js || g185b=0
[ "$g185b" = "1" ] && ok "G-63 注入对照（MC-04）：把 phone-android 写回入站映射就翻红、指到 cn_inbound_product_on_turn.js，恢复后仍绿" \
  || bad "G-63 MC-04 注入对照没成立（见 /tmp/gp185-mut-id.log /tmp/gp185-clean-b.log）"
# 注入对照 C：从 iOS 壳删掉一个残差键 —— MC-09 必须翻红（chip 会少一枚、顺序也会漂）。
cp -f hosts/ios/BitBotHost/Sources/BitBotHost/SendToUserSurface.swift /tmp/gp185-ios.bak
python3 - <<'PY'
p = "hosts/ios/BitBotHost/Sources/BitBotHost/SendToUserSurface.swift"
s = open(p).read()
s = s.replace('      "signin_fill_residual",\n    ]', '      \n    ]', 1)
open(p, "w").write(s)
PY
node scripts/prove_multihost_common.mjs >/tmp/gp185-mut-native.log 2>&1 || true
g185c=0
grep -q "✗ MC-09" /tmp/gp185-mut-native.log && grep -q "iOS" /tmp/gp185-mut-native.log && g185c=1
cp -f /tmp/gp185-ios.bak hosts/ios/BitBotHost/Sources/BitBotHost/SendToUserSurface.swift
node scripts/prove_multihost_common.mjs >/tmp/gp185-clean-c.log 2>&1 && grep -q "fail=0" /tmp/gp185-clean-c.log || g185c=0
cmp -s /tmp/gp185-ios.bak hosts/ios/BitBotHost/Sources/BitBotHost/SendToUserSurface.swift || g185c=0
[ "$g185c" = "1" ] && ok "G-63 注入对照（MC-09）：从 iOS 壳删掉一枚残差键就翻红、指到 iOS，恢复后仍绿" \
  || bad "G-63 MC-09 注入对照没成立（见 /tmp/gp185-mut-native.log /tmp/gp185-clean-c.log）"

# G-64 GP-186：旧 smoke_desktop_turn.sh 重新接进矩阵。
# 它此前不在矩阵里，本机又因缺 ffmpeg / 文案过期 / 没有 provider 提前停 —— 停在哪
# 就没人知道后面还剩多少没验。现在：本地 LLM stub 替模型应答（产品链仍是真的），
# 环境没有的能力（ffmpeg/tesseract/真实窗口清单）逐行打 SKIP，绝不假绿。
echo "== G-64 GP-186：旧 smoke_desktop_turn.sh 重新接入矩阵 =="
g64_xvfb=()
if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
  g64_xvfb=(xvfb-run -a)
fi
if timeout 2400 ${g64_xvfb[@]+"${g64_xvfb[@]}"} bash scripts/smoke_desktop_turn.sh >/tmp/g64-turn-smoke.log 2>&1; then
  ok "G-64 旧 smoke_desktop_turn 跑完且零断言失败（$(grep -c '^SKIP:' /tmp/g64-turn-smoke.log) 行环境 SKIP，逐行可查）"
  for g64_a in "webhook_wake inbound turn ok" "desktop electron smoke turn ok" "computer_use payment_wall fixture ok" "computer_use payment_wall live charge ok"; do
    grep -q "$g64_a" /tmp/g64-turn-smoke.log && ok "G-64 锚点：$g64_a" || bad "G-64 锚点没出现：$g64_a"
  done
  grep '^SKIP:' /tmp/g64-turn-smoke.log | sed 's/^/    · /' || true
else
  bad "G-64 旧 smoke_desktop_turn 未通过（见 /tmp/g64-turn-smoke.log；$(tail -2 /tmp/g64-turn-smoke.log | tr '\n' ' ')）"
  # Actions 的运行日志对匿名读者不可读；把子日志的「最近一节 + 尾部 8 行」写成
  # 注解（::error），红在哪一步就能在 run 页面直接看到，不必再猜一次。
  g64_sec="$(grep -n '^==> ' /tmp/g64-turn-smoke.log | tail -1 || true)"
  [ -n "$g64_sec" ] && printf '::error title=g64-last-section::%s\n' "$g64_sec"
  while IFS= read -r g64_l; do
    printf '::error title=g64-turn-tail::%s\n' "$g64_l"
  done < <(tail -8 /tmp/g64-turn-smoke.log 2>/dev/null)
  # 矩阵日志本身在 Actions 里可下载；把子日志尾部 25 行贴进来，红在哪一步不用再猜。
  echo "  · /tmp/g64-turn-smoke.log 尾部 25 行："
  tail -25 /tmp/g64-turn-smoke.log 2>/dev/null | sed 's/^/    | /' || true
fi

echo "== G-65 读切换（T1-04 · BITBOT_EVENT_READ=1 时产品读事件日志，读不到诚实降级）=="
# AC-T1-4 的原话是「产品读路径改读事件」：T1-03 只证明 fold(events) == JSON，
# 这一门证明的是「产品读的时候读的就是 fold 结果」，且读模型坏了会说话、
# 会回退 JSON，绝不把半折叠状态或空态当真。
if node -e "require('node:sqlite')" 2>/dev/null; then
  if timeout 600 node scripts/prove_event_read_model.mjs > /tmp/g65-readmodel.log 2>&1; then
    ok "G-65 读切换契约全绿（$(grep -c '^ok RM' /tmp/g65-readmodel.log) 项，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g65-readmodel.log)）"
  else
    bad "G-65 读切换契约（见 /tmp/g65-readmodel.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g65-readmodel.log || tail -2 /tmp/g65-readmodel.log | tr '\n' ' ')）"
  fi
  grep -q '^ok RM-03' /tmp/g65-readmodel.log \
    && grep -q '^ok RM-04' /tmp/g65-readmodel.log \
    && ok "G-65 读等价与棘轮都在：READ=1 时 list/get/loadRooms/pendingApprovals 与 JSON 逐字段相等，且在读世界里继续写不漂移" \
    || bad "G-65 RM-03 / RM-04 锚点缺失（读等价或读写闭环没被断言）"
  grep -q '^ok RM-02' /tmp/g65-readmodel.log \
    && grep -q '^ok RM-06a' /tmp/g65-readmodel.log \
    && grep -q '^ok RM-06b' /tmp/g65-readmodel.log \
    && ok "G-65 三条降级路都在且都说话：没库（no_db）、库坏（垃圾字节）、fold 有 anomaly 都回退 JSON 并打一行说明" \
    || bad "G-65 降级锚点缺失（no_db / 坏库 / anomaly 三条路没被断言）"
  grep -q '^ok RM-05' /tmp/g65-readmodel.log \
    && grep -q '^ok RM-08' /tmp/g65-readmodel.log \
    && ok "G-65 缓存与老运行时都在：lastSeq 失效 + 深拷贝不污染；没有 node:sqlite 时 READ=1 也不炸" \
    || bad "G-65 RM-05 / RM-08 锚点缺失（缓存语义或老运行时启动没被断言）"
  echo "  · G-65 边界（诚实）：写侧照旧走 JSON+双写镜像，本门只换「读」；"
  echo "    T1-05 停写 JSON 之后，approvalDecide 的整文件重写与「首播种」路径才是下一道门。"
else
  echo "  · skip：本机 node 没有 node:sqlite，G-65 未跑（SKIP ≠ PASS）"
fi

echo "== G-66 停写 JSON（T1-05 · BITBOT_EVENT_ONLY=1 时事件库是三张面唯一真源）=="
# AC-T1-5 的原话是「停写 JSON」：EVENT_ONLY 下三张面 JSON 一个字节都不再被写，
# 事件库是唯一写路径与读真源。写失败必须喊出来——JSON 不再是备份，吞错 = 丢数据。
if node -e "require('node:sqlite')" 2>/dev/null; then
  if timeout 600 node scripts/prove_event_only.mjs > /tmp/g66-eventonly.log 2>&1; then
    ok "G-66 停写契约全绿（$(grep -c '^ok EO' /tmp/g66-eventonly.log) 项，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g66-eventonly.log)）"
  else
    # 红的时候把 FAIL 行与尾部 25 行贴进矩阵输出——子日志在 runner 的 /tmp 里，
    # 不贴出来红因就只能靠猜（上一轮就是吃的这个亏）。
    bad "G-66 停写契约（FAIL 行：$(grep '^FAIL' /tmp/g66-eventonly.log | tr '\n' ' | ' | head -c 400)）"
    echo "  · /tmp/g66-eventonly.log 尾部 25 行："
    tail -25 /tmp/g66-eventonly.log 2>/dev/null | sed 's/^/    | /' || true
    printf '::error title=g66-tail::%s\n' "$(tail -8 /tmp/g66-eventonly.log 2>/dev/null | tr '\n' ' ')"
  fi
  grep -q '^ok EO-01' /tmp/g66-eventonly.log \
    && grep -q '^ok EO-02' /tmp/g66-eventonly.log \
    && ok "G-66 停写与对照都在：三张面零落盘（bots.json/审计流水照常），同一串操作两个世界折叠同形" \
    || bad "G-66 EO-01 / EO-02 锚点缺失（停写或行为对照没被断言）"
  grep -q '^ok EO-03' /tmp/g66-eventonly.log \
    && grep -q '^ok EO-04' /tmp/g66-eventonly.log \
    && grep -q '^ok EO-05' /tmp/g66-eventonly.log \
    && ok "G-66 数据迁移三条都在：导入幂等（第二遍 0 新增）、遗留纯读不建库、首次写入自导入（基底+delta，无幽灵实体）" \
    || bad "G-66 EO-03/04/05 锚点缺失（导入幂等或遗留接管没被断言）"
  grep -q '^ok EO-06' /tmp/g66-eventonly.log \
    && grep -q '^ok EO-07' /tmp/g66-eventonly.log \
    && ok "G-66 两条 fail-loud 都在：库坏写入当场抛（对照双写吞错），老运行时 EVENT_ONLY 无可静默降级" \
    || bad "G-66 EO-06 / EO-07 锚点缺失（fail-loud 没被断言）"
  echo "  · G-66 与导入脚本的分工：scripts/import_json_to_events.mjs 是登机梯"
  echo "    （先导入再开 EVENT_ONLY）；EO-05 的自导入是没跑梯子的兜底，不是替代。"
else
  echo "  · skip：本机 node 没有 node:sqlite，G-66 未跑（SKIP ≠ PASS）"
fi

echo "== G-67 移动端远程控制弹窗（配对的主路：状态点 + 6 位码 + 复制链接）=="
if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g67_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g67_xvfb=(xvfb-run -a)
  fi
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
  sleep 1
  if timeout 900 ${g67_xvfb[@]+"${g67_xvfb[@]}"} node scripts/e2e_desktop_mobile_control.mjs > /tmp/g67-mobctl.log 2>&1; then
    ok "G-67 e2e_desktop_mobile_control 全绿（$(grep -c '✓' /tmp/g67-mobctl.log) 项，$(tail -1 /tmp/g67-mobctl.log)）"
  else
    bad "G-67 e2e_desktop_mobile_control（见 /tmp/g67-mobctl.log；$(tail -1 /tmp/g67-mobctl.log)）"
    grep -n "✗" /tmp/g67-mobctl.log 2>/dev/null | head -10 | while IFS= read -r line; do echo "    ${line}"; done
    tail -6 /tmp/g67-mobctl.log 2>/dev/null | while IFS= read -r line; do echo "    | ${line}"; done
  fi
  grep -q "MC-03 状态点 off→on 如实" /tmp/g67-mobctl.log \
    && grep -q "MC-04 生成" /tmp/g67-mobctl.log \
    && grep -q "MC-05 复制配对链接当场回显" /tmp/g67-mobctl.log \
    && ok "G-67 主路三条在：状态点如实（没放开不亮绿）、配对码生成/刷新/作废与 Host 同步、复制链接当场回显" \
    || bad "G-67 主路锚点缺失（状态点 / 配对码 / 复制链接没被断言到）"
  grep -q "MC-06 Esc 与遮罩都能关" /tmp/g67-mobctl.log \
    && grep -q "MC-07 只列钉钉" /tmp/g67-mobctl.log \
    && grep -q "MC-09 480×720" /tmp/g67-mobctl.log \
    && grep -q "MC-11 480×" /tmp/g67-mobctl.log \
    && ok "G-67 边界三条在：Esc 与遮罩都关得掉且焦点归还、渠道列只有真支持的三条且不叠弹窗、480 宽不破版且账户菜单点得到" \
    || bad "G-67 边界锚点缺失（关闭 / 渠道列 / 窄屏没被断言到）"
  echo "  · G-67 修复前红（HEAD 8ca2c5e 产品代码真实输出）：PASS=0 FAIL=10 —— 入口、弹窗、"
  echo "    状态点、渠道列全都不存在；能力（pairing-v1）早就在，缺的是这一屏的入口与实话"
  echo "  · G-67 第二道红（弹窗做完之后，480×693 实测）：PASS=9 FAIL=2 —— 账户弹层向上开，"
  echo "    ap-usage y=-161 / ap-remote y=-97 / ap-connect y=1，整片在屏外："
  echo "    窄窗口里点不到任何一项（不只新入口，设置/连接应用同样死）。横带内改 fixed 向下开才绿"
  echo "  · G-67 残留（诚实）：没有二维码 —— 现在仍靠「复制配对链接 / 手敲 6 位码」，"
  echo "    手机摄像头那条路是下一波（M 档）；这一屏也不做「远程操作当前工作区」，"
  echo "    那是新协议面（L 档），需要设计评审；国内渠道仍只到「去配置」，配置本身在 G-51/G-52"
  echo "  · G-67 已知边界：480 宽 ≤ 折叠断点(768) 时侧栏自动收起，账户入口要先 Ctrl/Cmd+B"
  echo "    展开才点得到 —— 横带本身要不要改成抽屉，仍是 §8.51 那条残留，不在本波范围内"
else
  echo "  · skip：缺 playwright-core 或 electron，G-67 未跑（SKIP ≠ PASS）"
fi

echo "== G-68 配对落地页 /pair（「复制配对链接」点开必须是一页纸）=="
if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g68_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g68_xvfb=(xvfb-run -a)
  fi
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
  sleep 1
  if timeout 900 ${g68_xvfb[@]+"${g68_xvfb[@]}"} node scripts/e2e_desktop_pair_page.mjs > /tmp/g68-pairpage.log 2>&1; then
    ok "G-68 e2e_desktop_pair_page 全绿（$(grep -c '✓' /tmp/g68-pairpage.log) 项，$(tail -1 /tmp/g68-pairpage.log)）"
  else
    bad "G-68 e2e_desktop_pair_page（见 /tmp/g68-pairpage.log；$(tail -1 /tmp/g68-pairpage.log)）"
    grep -n "✗" /tmp/g68-pairpage.log 2>/dev/null | head -10 | while IFS= read -r line; do echo "    ${line}"; done
    tail -6 /tmp/g68-pairpage.log 2>/dev/null | while IFS= read -r line; do echo "    | ${line}"; done
  fi
  grep -q "PP-01 GET /pair → 200 text/html" /tmp/g68-pairpage.log \
    && grep -q "PP-08 弹窗「复制配对链接」复制的是 /pair 页面" /tmp/g68-pairpage.log \
    && ok "G-68 主路两条在：/pair 真回页面（不是 JSON 404）、弹窗复制的确实是这一页" \
    || bad "G-68 主路锚点缺失（/pair 或复制链接没被断言到）"
  grep -q "PP-03 页面不含 64 位令牌" /tmp/g68-pairpage.log \
    && grep -q "PP-04 页面无表单、不碰 /v1/pair/redeem" /tmp/g68-pairpage.log \
    && grep -q "PP-10 页面带 noindex" /tmp/g68-pairpage.log \
    && ok "G-68 安全三条在：不含凭证、不是第二个 redeem 面、公网隧道下不缓存不索引" \
    || bad "G-68 安全锚点缺失（凭证 / redeem / 安全头没被断言到）"
  echo "  · G-68 修复前红（HEAD 0556e7a 产品代码真实输出）：PASS=1 FAIL=10 ——"
  echo "    GET /pair 与 GET / 都回 unknown_cn_inbound_route 的 JSON 404，"
  echo "    弹窗里那颗「复制配对链接」复制出来的是 http://25.4.80.50:41795（裸地址）"
  echo "  · G-68 顺带修的：未知路由 404 的 routes 清单过期（连 /v1/pair/* 都没列）——"
  echo "    现在列出 /pair、/v1/pair/discover、/v1/pair/redeem，不再教用户走错路"
  echo "  · G-68 残留（诚实）：这一页只是说明页，不能在浏览器里完成配对（故意不做 —— "
  echo "    谁在浏览器里输 6 位码，bearer 就落到那个浏览器里）；仍未做二维码（GP-192），"
  echo "    二维码要等手机端能扫码：Android 现在没有摄像头/扫码依赖，也没有 deep-link "
  echo "    intent-filter，系统相机扫出来的 URL 手机 App 接不住"
  echo "  · G-68 已知边界：页面显示主机名与端口，泄露面与既有的 /v1/pair/discover 同级；"
  echo "    走 cloudflared 公网隧道时全网可读（discover 今天已经是这样），故带 noindex/no-store"
else
  echo "  · skip：缺 playwright-core 或 electron，G-68 未跑（SKIP ≠ PASS）"
fi

echo "== G-69 发布链路的 tag 门禁与触发条件必须一致（路线 A · W1 / A0-1）=="
# 病不是「发布没做」，而是「做了但一辈子打不亮」：workflow 触发 `desktop-v*` 与 `v*`，
# 三处门禁却只认 startsWith(github.ref_name, 'v')，而远端唯一的真实 tag 是 desktop-v0.1.0
# —— 以 d 开头 ⇒ BITBOT_PUBLISH / REQUIRE_SIGN / REQUIRE_NOTARIZE 全为空，
# `--publish always` 那条已接好的路一次都没跑过，而 CI 显示是绿的（红被藏成了「没触发」）。
if timeout 120 node scripts/prove_release_tag_gate.mjs > /tmp/g69-releasetag.log 2>&1; then
  ok "G-69 发布 tag 门禁全绿（$(grep -c '^ok RT' /tmp/g69-releasetag.log) 项，$(tail -1 /tmp/g69-releasetag.log)）"
else
  bad "G-69 发布 tag 门禁（见 /tmp/g69-releasetag.log；$(tail -1 /tmp/g69-releasetag.log)）"
  grep '^FAIL' /tmp/g69-releasetag.log 2>/dev/null | head -5 | while IFS= read -r line; do echo "    ${line}"; done
fi
grep -q '^ok RT-03' /tmp/g69-releasetag.log 2>/dev/null \
  && grep -q '^ok RT-05' /tmp/g69-releasetag.log 2>/dev/null \
  && ok "G-69 一致性两条在：每个触发前缀都点亮三处门禁、真实 tag 名匹配自己声明的前缀" \
  || bad "G-69 一致性锚点缺失（RT-03/RT-05 没被断言到）"
grep -q '^ok RT-04' /tmp/g69-releasetag.log 2>/dev/null \
  && ok "G-69 尺子有牙：RT-04 负向对照（故意做坏的副本必须红）在" \
  || bad "G-69 负向对照缺失（这道门恒绿就没有意义）"
echo "  · G-69 修复前红（HEAD 29e1725 的 workflow 真实输出）：prove_release_tag_gate PASS=4 FAIL=1 ——"
echo "    FAIL RT-03 — desktop-v0.1.0: 只点亮 0/3 处门禁（PUBLISH=false, SIGN=false, NOTARIZE=false）"
echo "  · G-69 修的是判定不是尺子：把三处 startsWith 扩到同时认 'v' 与 'desktop-v'，"
echo "    没有靠改 tag 名绕病（那等于偷偷换约定）"
echo "  · G-69 后果写进注释：发布 tag 上现在凭据缺失就是 exit 1 硬失败（pack-desktop.sh:80-96），"
echo "    「绿但没签」不再可能；这时 CI 变红是对的，别为过门去掉那两个开关"
echo "  · G-69 残留（诚实）：真实 Release 从未跑过（secrets 未配）、OTA 未在真环境闭环、"
echo "    Windows/Linux 签名未接入 —— 这道门只钉「口径一致」，不声称发布已经通"

echo "== G-70 装机运行时真跑双写对账（路线 A · W1 / A0-3 · T1-03 的装机版证据）=="
# 这条以前**不在矩阵里**，所以「双写到底在真 Electron 里跑没跑」这件事 CI 从来看不见：
# G-62/G-65/G-66 跑的是宿主 node（v22 有 node:sqlite），而装机运行时是 Electron 内置 node。
# 33.4.11 时代真机门是 6/4（主进程自己报「已降级为不写」），这条红一直没人接。
if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g70_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g70_xvfb=(xvfb-run -a)
  fi
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
  sleep 1
  timeout 900 ${g70_xvfb[@]+"${g70_xvfb[@]}"} node scripts/e2e_desktop_event_dualwrite_live.mjs > /tmp/g70-dualwrite-live.log 2>&1
  # 这个脚本的 SKIP 走 exit 0（PASS=0 FAIL=0 SKIP=1），所以**不能拿退出码当绿** ——
  # 只认汇总行里的数字：SKIP 必须为 0 且 FAIL 必须为 0。
  g70_sum=$(grep -o 'PASS=[0-9]* FAIL=[0-9]* SKIP=[0-9]*' /tmp/g70-dualwrite-live.log | tail -1)
  if [ -z "$g70_sum" ]; then
    bad "G-70 真机双写对账没有汇总行（见 /tmp/g70-dualwrite-live.log；无汇总 = 中途死掉，不算跑过）"
    tail -8 /tmp/g70-dualwrite-live.log 2>/dev/null | while IFS= read -r line; do echo "    | ${line}"; done
  elif ! echo "$g70_sum" | grep -q 'FAIL=0 SKIP=0'; then
    bad "G-70 真机双写对账未达成（${g70_sum}；SKIP ≠ PASS）"
    grep -E '✗|SKIP' /tmp/g70-dualwrite-live.log 2>/dev/null | head -6 | while IFS= read -r line; do echo "    ${line}"; done
  else
    ok "G-70 真机双写对账全绿（${g70_sum}，$(grep -c '✓' /tmp/g70-dualwrite-live.log) 项打勾）"
  fi
  grep -q '✓ L-01' /tmp/g70-dualwrite-live.log 2>/dev/null \
    && grep -q '✓ L-02' /tmp/g70-dualwrite-live.log 2>/dev/null \
    && ok "G-70 装机运行时两条在：事件库真生成、主进程没报「已降级为不写」" \
    || bad "G-70 L-01/L-02 锚点缺失（装机运行时是否真写库没被断言到）"
  grep -q '✓ L-04' /tmp/g70-dualwrite-live.log 2>/dev/null \
    && grep -q '✓ L-05' /tmp/g70-dualwrite-live.log 2>/dev/null \
    && ok "G-70 对账两条在：fold(sessions)==快照、fold(rooms)==快照（真 Electron 写的库，不是宿主 node）" \
    || bad "G-70 fold 对账锚点缺失"
  echo "  · G-70 修复前红（Electron 33.4.11 实装，同一条命令真实输出）：PASS=6 FAIL=4 ——"
  echo "    ✗ L-02 主进程降级成了不写 —— [event-mirror] 已降级为不写：当前运行时没有内置"
  echo "      SQLite（node:sqlite，Node v20.18.3），而 BITBOT_EVENT_DUAL_WRITE 是开着的"
  echo "    ✗ L-01 事件库不存在 / ✗ L-03 事件库是空的 / ✗ L-04 fold 不等（长度 3 ≠ 0）"
  echo "  · G-70 修复动作只有一件：把实装对齐到 lockfile 已声明的 37.10.3（npm install，"
  echo "    未加 --ignore-scripts，二进制 113,835,126 字节真下载），**没改任何断言口径**"
  echo "  · G-70 修复后绿：PASS=10 FAIL=0 SKIP=0 —— 事件行数 14、L-03b 无重复投递、"
  echo "    L-04/L-05/L-06 三面逐字段相等、L-07 每个快照变化都有人认领"
  echo "  · G-70 残留（诚实，脚本自己在输出里说的）：审批面这次是**空对空**验证 ——"
  echo "    「delete bot」30 s 内没亮审批卡 → L-06 只证明「没写事件也没写快照」，不证明真审批能双写；"
  echo "    T1-03 的审批这条仍要另做（不是已交付）"
  echo "  · G-70 已知边界：宿主 node 22 有 node:sqlite ≠ 装机运行时也有；G-62/65/66 三条不能"
  echo "    代替这条，这条也不代替那三条"
else
  echo "  · skip：缺 playwright-core 或 electron，G-70 未跑（SKIP ≠ PASS）"
fi

echo "== G-71 门禁不许改写已跟踪文件（路线 A · W1 / A0-4 自检）=="
# 白名单（空格分隔）：留空。加一条就要在旁边写清为什么非改不可。
GATE_DIRTY_ALLOW=""
if ! command -v git >/dev/null 2>&1 || ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "  · skip：本机没有可用 git 仓库，G-71 未跑（SKIP ≠ PASS）"
else
  gate_dirty_tracked > /tmp/gate-dirty-now.txt
  g71_new=$(comm -13 "$GATE_DIRTY_BASELINE" /tmp/gate-dirty-now.txt)
  for f in $GATE_DIRTY_ALLOW; do g71_new=$(echo "$g71_new" | grep -v -x "$f" || true); done
  if [ -z "$(echo "$g71_new" | tr -d '[:space:]')" ]; then
    ok "G-71 跑完整套门之后没有新的已跟踪文件被改动（基线 $(wc -l < "$GATE_DIRTY_BASELINE" | tr -d ' ') 项，收尾 $(wc -l < /tmp/gate-dirty-now.txt | tr -d ' ') 项）"
  else
    bad "G-71 有已跟踪文件被本轮门禁改动了 —— 逐个看是「谁写的、该不该写」："
    echo "$g71_new" | while IFS= read -r f; do
      [ -n "$f" ] && echo "      · $f ($(git diff --numstat -- "$f" 2>/dev/null | awk '{print "+"$1" -"$2}'))"
    done
    echo "  · 为什么要判红不判黄：矩阵里的门应当只往 /tmp 和 data/ 写证据；"
    echo "    能改文档/图片的门 = 能把一次文件损坏（本轮 report.md 被截断）伪装成「跑过门的正常脏」。"
  fi
fi

echo "== G-72 跑完整套门之后，用户选的模型渠道还是他自己选的那个（A0-6）=="
g72_after=$(gate_llm_restore)
# 判据只看事实，不比对人类可读的说法：上一版把「开局没有、现在也没有」这一支漏在了
# 白名单外，于是矩阵自己造了一条假红（本轮 493/9 里就有它）。
# 收尾状态 == 开局状态 才算过：absent→absent，present→内容与快照逐字节相同。
if [ "$GATE_LLM_STATE_BEFORE" = "absent" ] && [ ! -f "$GATE_LLM_ACTIVE" ]; then
  ok "G-72 provider 状态归还：开局 absent → 收尾「${g72_after}」（用户没有 active.json，跑完也没有）"
elif [ "$GATE_LLM_STATE_BEFORE" = "present" ] && [ -f "$GATE_LLM_ACTIVE" ] \
  && cmp -s "$GATE_LLM_ACTIVE_SNAP" "$GATE_LLM_ACTIVE"; then
  ok "G-72 provider 状态归还：开局 present → 收尾「${g72_after}」（内容与开局快照逐字节一致）"
else
  bad "G-72 provider 状态没回到开局值（开局 $GATE_LLM_STATE_BEFORE → 收尾「${g72_after}」）——去看 $GATE_LLM_ACTIVE"
fi
echo "  · G-72 为什么必须有一道门：本轮上一轮跑被打断后，data/llm/active.json 留在 qwen，"
echo "    而 resolveLlmConfig()（host_ffi.js:5289）的优先级是「provider 自己的 env >"
echo "    active.json > 全局 BITBOT_LLM_*」—— 只 stub 全局那组的门于是敲向**真实公网**"
echo "    （Incorrect API key provided），G-16/18/19/28/64 六条门红得像产品坏了。"
echo "  · G-72 另一半意义：门禁不该替用户改大脑渠道。跑一次验收，用户下次打开 app 发现"
echo "    模型变了，这比红更糟。"
echo "  · G-72 残留（诚实）：这道门兜的是矩阵自己进出的一段；门被 SIGKILL 时靠 EXIT trap，"
echo "    kill -9 则连 trap 都没有 —— 那种情况下仍会留脏，需要下次开局读快照才能发现，"
echo "    而快照在 /tmp（重启即失）。真正把 stub 钉死要在各门里显式 pin provider，已记进 GP-201"

echo "== G-73 跨端事件流 SSE 路由（路线 A · W2 / A1-1 · hosts/shared/cn_inbound_server.js GET /v1/events）=="
if node -e "require('node:sqlite')" 2>/dev/null; then
  if timeout 120 node scripts/prove_cn_events_sse.js > /tmp/g73-cn-events.log 2>&1; then
    ok "G-73 SSE 事件流路由全绿（$(grep -c '^ok ' /tmp/g73-cn-events.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g73-cn-events.log)）"
  else
    bad "G-73 SSE 事件流路由（见 /tmp/g73-cn-events.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g73-cn-events.log || tail -2 /tmp/g73-cn-events.log | head -1)）"
  fi
  grep -q '^ok EV-1' /tmp/g73-cn-events.log \
    && grep -q '^ok EV-2' /tmp/g73-cn-events.log \
    && grep -q '^ok EV-3' /tmp/g73-cn-events.log \
    && ok "G-73 三条命门都在：无凭证→401、有凭证+有库→200/SSE/有序seq、无库→诚实503（不假装空流）" \
    || bad "G-73 EV-1/EV-2/EV-3 锚点缺失（鉴权或降级没被断言到）"
  echo "  · G-73 修复前红（路由未实现，真实输出）：PASS=1 FAIL=9 —— GET /v1/events 落到"
  echo "    unknown_cn_inbound_route 404，EV-1/2/3 全红（401/200/503 一个都没达成）；EV-4 在红态下是空过（404"
  echo "    没有 data: 行，快照为空这个判据被它顺手满足，不算真绿）。"
  echo "  · G-73 修复后绿：PASS=10 FAIL=0 —— 新增 GET /v1/events（SSE）只加路由不改任何既有响应体；"
  echo "    复用 event_log.readAfter 做游标；鉴权沿用设备密钥（B-4a），未鉴权一律 401；"
  echo "    无事件库（双写没开）走诚实 503 event_log_unavailable，不假装空流通过。"
  echo "  · G-73 更正（2026-11-02，§8.62）：这里原来写的「鉴权与 /v1/approvals 同一套设备密钥」在真机上是错的 ——"
  echo "    配对 /v1/pair/redeem 回给手机的只有共享 bearer turn_token，手机没有设备私钥 ⇒ GET /v1/events 一连就 401。"
  echo "    现在鉴权与 /v1/turn 完全同构（登记表空→bearer，非空→设备签名，两边一起 401），断言补到 EV-8（PASS=24 FAIL=0）。"
  echo "    取红原文的办法是把产品代码临时回退再跑同一命令：FAIL=6（EV-5 三红 + EV-8 三红），恢复后 24/0。"
  echo "  · G-73 残留（诚实）：这条路由在桌面生产路径上仍会 503，因为双写/镜像（event_mirror）"
  echo "    尚未接进 hosts/desktop/main.js —— 桌面进程里没有可读事件库句柄可注入。要让「手机看得见」"
  echo "    真的端到端，需要把 event_mirror 的读句柄接到 ensureCnInbound（W2 后续 A1-2/A1-4 或专门的接线片）。"
  echo "    本门只证明路由/鉴权/SSE 形态/游标这层，事件库内部契约由 G-61/G-62 守。"
else
  echo "  · skip：本机 node 没有 node:sqlite，G-73 未跑（SKIP ≠ PASS）"
fi

echo "== G-74 事件面最小集（路线 A · W2 / A1-2 · turn_started/progress/turn_ended 带 seq，且 A1-1 路由不再 503）=="
if node -e "require('node:sqlite')" 2>/dev/null; then
  if timeout 120 node scripts/prove_cn_turn_events.js > /tmp/g74-cn-turn.log 2>&1; then
    ok "G-74 回合事件桥全绿（$(grep -c '^ok ' /tmp/g74-cn-turn.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g74-cn-turn.log)）"
  else
    bad "G-74 回合事件桥（见 /tmp/g74-cn-turn.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g74-cn-turn.log || tail -2 /tmp/g74-cn-turn.log | head -1)）"
  fi
  grep -q '^ok EV-1' /tmp/g74-cn-turn.log \
    && grep -q '^ok EV-2' /tmp/g74-cn-turn.log \
    && grep -q '^ok EV-3' /tmp/g74-cn-turn.log \
    && grep -q '^ok EV-4' /tmp/g74-cn-turn.log \
    && grep -q '^ok EV-5' /tmp/g74-cn-turn.log \
    && grep -q '^ok EV-6' /tmp/g74-cn-turn.log \
    && grep -q '^ok EV-7' /tmp/g74-cn-turn.log \
    && grep -q '^ok EV-8' /tmp/g74-cn-turn.log \
    && ok "G-74 八条命门都在：桥存在 / 镜像带 emit / 日志含 turn_started·progress·turn_ended / seq 递增 / 路由读到句柄→200 且流出 turn_started" \
    || bad "G-74 EV-1..EV-8 锚点缺失（桥或路由接线没被断言到）"
  echo "  · G-74 修复前红（桥未实现，真实输出）：PASS=0 FAIL=8 —— turn_event_emitter 模块缺失、mirror.emit /"
  echo "    mirror.readHandle 都不存在，路由拿不到库继续 503；八条断言全红。"
  echo "  · G-74 修复后绿：PASS=8 FAIL=0 —— 新增 hosts/shared/turn_event_emitter.js（桥），event_mirror 句柄加 emit /"
  echo "    readHandle；main.js 在 bitbot:llm-stream（phase=start/end）与 onProgress 三处落 turn_started/progress/turn_ended，"
  echo "    并把镜像读句柄喂给 createCnInboundServer 的 eventLog —— A1-1 路由从「没库」变「读得到真库」。"
  echo "  · G-74 残留（诚实）：默认关（BITBOT_EVENT_DUAL_WRITE / BITBOT_EVENT_ONLY 都没开）时桥是 no-op、连库都不开，"
  echo "    路由继续诚实 503、零足迹 —— 这是「开关默认关」的铁律，不是缺陷。端上消费（Android/iOS 只读 SSE 订阅 + 进度 UI）"
  echo "    是 A1-4 的活，本门只证明事件真的落库且路由能读出来。"
else
  echo "  · skip：本机 node 没有 node:sqlite，G-74 未跑（SKIP ≠ PASS）"
fi

echo "== G-78 设备花名册数据层（路线 A · W3 / A2-5 · 名单读出 + 吊销落盘 + 最近活跃跟踪）=="
if timeout 120 node scripts/prove_cn_device_roster.js > /tmp/g78-roster.log 2>&1; then
  ok "G-78 设备花名册数据层全绿（$(grep -c '^ok ' /tmp/g78-roster.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g78-roster.log)）"
  grep -q 'EV-1 ' /tmp/g78-roster.log && grep -q 'EV-2 ' /tmp/g78-roster.log && grep -q 'EV-3 ' /tmp/g78-roster.log \
    && grep -q 'EV-4 ' /tmp/g78-roster.log && grep -q 'EV-5 ' /tmp/g78-roster.log && grep -q 'EV-6 ' /tmp/g78-roster.log \
    && ok "G-78 六条命门都在：模块存在 / listRoster 字段齐全含 revoked / 吊销落盘 / 吊销后反映 / touchDevice 落 last_seen / 异常输入不抛" \
    || bad "G-78 EV-1..EV-6 锚点缺失（花名册或 last_seen 接线没被断言到）"
  echo "  · G-78 修复前红（模块未实现，真实输出）：PASS=0 FAIL=6 —— device_roster 模块缺失、device_keys.touchDevice 未实现；六条断言全红。"
  echo "  · G-78 修复后绿：PASS=6 FAIL=0 —— 新增 hosts/shared/device_roster.js（listRoster / revokeInRoster），"
  echo "    device_keys 加 last_seen_at 透传与 touchDevice；main.js 挂 bitbot:devices:list / bitbot:devices:revoke，"
  echo "    preload 暴露 devices:{list,revoke}；cn_inbound_server 三处 verifyDeviceTurn 成功后落 last_seen_at；UI 在「移动端远程控制」弹窗加花名册卡。"
  echo "  · G-78 残留（诚实）：① 花名册 UI 渲染（MC-13）走真 Electron e2e，本机无显示会 SKIP，CI 有显示才实跑；"
  echo "    ② 最近活跃只由「设备密钥鉴权成功」触发（legacy turn-token 路径不记），每次落盘是一次轻量写；"
  echo "    ③ 取消登记（redeem 反向）不在本片范围，设备表只有「配对增」与「吊销（A2-2）」两条写路径。"
else
  bad "G-78 设备花名册数据层（见 /tmp/g78-roster.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g78-roster.log || tail -2 /tmp/g78-roster.log | head -1)）"
  echo "  · G-78 修复前红（模块未实现，真实输出）：PASS=0 FAIL=6"
  echo "  · G-78 残留（诚实）：见上"
fi

echo "== G-79 中转镜像（路线 A · W4 / A3-1 · 成员凭证签发 + Box 登记 + 盲转发 + 健康检查）=="
if timeout 120 node scripts/prove_cn_relay_image.js > /tmp/g79-relay.log 2>&1; then
  ok "G-79 中转镜像全绿（$(grep -c '^ok ' /tmp/g79-relay.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g79-relay.log)）"
  grep -q 'EV-1 ' /tmp/g79-relay.log && grep -q 'EV-2 ' /tmp/g79-relay.log && grep -q 'EV-3 ' /tmp/g79-relay.log \
    && grep -q 'EV-4 ' /tmp/g79-relay.log && grep -q 'EV-5 ' /tmp/g79-relay.log && grep -q 'EV-6 ' /tmp/g79-relay.log \
    && ok "G-79 六条命门都在：模块存在 / 成员凭证签发校验 / 健康检查 / Box 登记 / 盲转发透传 / 数据面不落明文" \
    || bad "G-79 EV-1..EV-6 锚点缺失（中继或盲转发没被断言到）"
  echo "  · G-79 修复前红（模块未实现，真实输出）：PASS=0 FAIL=6 —— relay_server / relay_keys 模块缺失；六条断言全红。"
  echo "  · G-79 修复后绿：PASS=6 FAIL=0 —— 新增 hosts/shared/relay/relay_server.js（控制面 AUTH→REGISTER/CONNECT + 盲 TCP 转发 + HTTP /healthz）、"
  echo "    hosts/shared/relay/relay_keys.js（HMAC 成员凭证签发/校验）、Dockerfile.relay（node:22-alpine 镜像，CMD 直起 relay_server.js）。"
  echo "  · G-79 残留（诚实）：① 转发模型锁定 TCP/TLS 透传，数据面结构性不碰内容（A3-2 内容不可见由架构保证，本门只证「不落明文」先手）；"
  echo "    ② 控制面 TLS 在镜像里由用户侧 cert 启用，门禁用明文控制面跑端到端转发（诚实：未在本门内起 TLS 控制面）；"
  echo "    ③ Box 自身 cn_inbound_server 仍是明文 HTTP（既有事实），relay 只搬运不新增暴露面；端到端业务 TLS 不在 A3-1；"
  echo "    ④ 中继节点身份用共享 relay-secret（非设备密钥），secret 泄露只影响中转准入、不碰业务内容。"
else
  bad "G-79 中转镜像（见 /tmp/g79-relay.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g79-relay.log || tail -2 /tmp/g79-relay.log | head -1)）"
  echo "  · G-79 修复前红（模块未实现，真实输出）：PASS=0 FAIL=6"
  echo "  · G-79 残留（诚实）：见上"
fi

echo "== G-80 中转内容不可见实证（路线 A · W4 / A3-2 · 日志含元数据但查无明文，反真空通过）=="
if timeout 120 node scripts/prove_cn_relay_invisible.js > /tmp/g80-invisible.log 2>&1; then
  ok "G-80 中转内容不可见实证全绿（$(grep -c '^ok ' /tmp/g80-invisible.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g80-invisible.log)）"
  grep -q 'EV-1 ' /tmp/g80-invisible.log && grep -q 'EV-2 ' /tmp/g80-invisible.log && grep -q 'EV-3 ' /tmp/g80-invisible.log \
    && grep -q 'EV-4 ' /tmp/g80-invisible.log && grep -q 'EV-5 ' /tmp/g80-invisible.log && grep -q 'EV-6 ' /tmp/g80-invisible.log \
    && ok "G-80 六条命门都在：getAuditLog 能力 / 成员凭证签发校验 / 日志存在且查无明文（反真空通过）/ 无旁路落盘文件含明文 / registry 仅含端点 / 不缓存 payload" \
    || bad "G-80 EV-1..EV-6 锚点缺失（审计日志或不可见实证没被断言到）"
  echo "  · G-80 修复前红（模块无日志能力，真实输出）：PASS=4 FAIL=2 —— relay_server 无 logFile/getAuditLog 支持，"
  echo "    EV-1（getAuditLog 能力）与 EV-3（日志存在且查无明文·反真空通过）红：日志面为空＝A3-1 的真空通过漏洞未封堵，"
  echo "    EV-2/EV-4/EV-5/EV-6 在红态仍绿（凭证基线 / 无文件可漏 / registry 干净 / 不缓存——这些本就成立，不靠日志）。"
  echo "  · G-80 修复后绿：PASS=6 FAIL=0 —— hosts/shared/relay/relay_server.js 加 logFile/verbose 选项 + log() 助手（只记 event/role/memberId/boxId/endpoint/bytes，"
  echo "    删防御 token/payload/body/attachment/secret 字段），AUTH/REGISTER/CONNECT 记元数据、openBox 关连接记 close(bytes>0)；getAuditLog() 暴露内存审计缓冲；"
  echo "    入口进程按 BITBOT_RELAY_LOGFILE / BITBOT_RELAY_VERBOSE 可选落盘。"
  echo "  · G-80 残留（诚实）：① 审计日志只记元数据，证明「看不见内容」靠日志面真实存在且查无明文（反真空通过），而非「没日志所以没明文」；"
  echo "    ② 端到端业务 TLS（客户端↔box 加密）不在本片，日志的 endpoint 是 box 可达地址而非密文；"
  echo "    ③ 日志文件落地本身是明文 JSON（仅元数据），部署侧须按 ADR 0014「云只见元数据与密文」约束其访问与留存；"
  echo "    ④ registry 仍仅内存、审计缓冲上限 10000 条循环覆盖，长周期部署需外部采集。"
else
  bad "G-80 中转内容不可见实证（见 /tmp/g80-invisible.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g80-invisible.log || tail -2 /tmp/g80-invisible.log | head -1)）"
  echo "  · G-80 修复前红（模块无日志能力，真实输出）：PASS=4 FAIL=2"
  echo "  · G-80 残留（诚实）：见上"
fi

echo "== G-81 连接策略（路线 A · W4 / A3-3 · 直连优先 + 失败回落中转 + 模式/延迟上报）=="
if timeout 120 node scripts/prove_cn_connection_strategy.js > /tmp/g81-strategy.log 2>&1; then
  ok "G-81 连接策略全绿（$(grep -c '^ok ' /tmp/g81-strategy.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g81-strategy.log)）"
  grep -q 'EV-1 ' /tmp/g81-strategy.log && grep -q 'EV-2 ' /tmp/g81-strategy.log && grep -q 'EV-3 ' /tmp/g81-strategy.log \
    && grep -q 'EV-4 ' /tmp/g81-strategy.log && grep -q 'EV-5 ' /tmp/g81-strategy.log && grep -q 'EV-6 ' /tmp/g81-strategy.log \
    && ok "G-81 六条命门都在：模块导出 / 直连可达即直连且不碰中转 / 直连不可达回落中转 / 多候选按序试 / 模式+延迟文案 / 全不可达诚实离线" \
    || bad "G-81 EV-1..EV-6 锚点缺失（连接策略或回落逻辑没被断言到）"
  echo "  · G-81 修复前红（模块未实现，真实输出）：PASS=0 FAIL=6 —— connection_strategy 模块缺失；六条断言全红。"
  echo "  · G-81 修复后绿：PASS=6 FAIL=0 —— 新增 hosts/shared/connection_strategy.js（resolveConnection 直连优先短路→"
  echo "    直连全失败且配了中转则回落 relay→全不可达回 mode=none；defaultProbe=net.connect+setTimeout；"
  echo "    describeMode 回「直连/中转 · Nms」三语）。EV-3 对回落逻辑变异敏感：去掉回落即变 mode=none 而转红。"
  echo "  · G-81 残留（诚实）：① 本门证的是共享纯逻辑（Node 真 socket），Android(Kotlin)/iOS(Swift) 客户端的"
  echo "    网络层接线与界面「直连/中转」渲染未接（本机无 Android SDK / gradle 缓存、网络 502，iOS 需 Xcode 模拟器）；"
  echo "    ② AC-T4-5「直连成功率 ≥95%」需真机统计样本，本门只证策略语义正确、不断言成功率；"
  echo "    ③ QUIC 打洞（T4b）不在本片，直连候选仍是 TCP 可达性探测（A3-1 中转为回落目标）。"
else
  bad "G-81 连接策略（见 /tmp/g81-strategy.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g81-strategy.log || tail -2 /tmp/g81-strategy.log | head -1)）"
  echo "  · G-81 修复前红（模块未实现，真实输出）：PASS=0 FAIL=6"
  echo "  · G-81 残留（诚实）：见上"
fi

echo "== G-82 配对回执带中转参数（路线 A · W4 / A3-6 · 桌面下发四栏 → 手机解析落 prefs → 界面显「直连/中转 · Nms」）=="
if timeout 120 node scripts/prove_pairing_relay_handoff.js > /tmp/g82-handoff.log 2>&1; then
  ok "G-82 配对回执中转参数全绿（$(grep -c '^  ✓ ' /tmp/g82-handoff.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g82-handoff.log)）"
  grep -q 'PH-01 ' /tmp/g82-handoff.log && grep -q 'PH-02 ' /tmp/g82-handoff.log && grep -q 'PH-03 ' /tmp/g82-handoff.log \
    && ok "G-82 三条命门都在：没配中转时回执形状一字不变（无 relay 键、turn_token/base_url 照旧）、配齐时四栏如实下发且 port 是数字、relay 里只有那四栏（不夹带配对令牌）" \
    || bad "G-82 PH-01..PH-03 锚点缺失（下发内容或形状约束没被断言到）"
  grep -q 'PH-04 ' /tmp/g82-handoff.log && grep -q '正控（配齐→下发）先过' /tmp/g82-handoff.log \
    && ok "G-82 半套配置一律不下发（缺 token / 缺 box / port 越界 / port 非数字 四种），且**先跑正控**：配齐必须真下发，否则这条在功能不存在时也会绿（真空通过）" \
    || bad "G-82 PH-04 锚点缺失或没有正控（半套结论可能是真空绿）"
  grep -q 'PH-05 ' /tmp/g82-handoff.log && grep -q '正控先过' /tmp/g82-handoff.log \
    && ok "G-82 失败路径不泄漏：错码 400 的回包里没有 relay（同样先正控，防真空通过）" \
    || bad "G-82 PH-05 锚点缺失或没有正控"
  echo "  · G-82 修复前红（cn_inbound_server 未下发，真实输出）：PASS=1 FAIL=4 ——"
  echo "    PH-02 '配了中转却没下发 relay（手机永远拿不到跨网参数）Response: {\"ok\":true,...'、"
  echo "    PH-03 'relay 只准有四栏' 报 (空)、PH-04 '正控失败：配齐也没下发 relay，下面四种半套的结论不算数'、"
  echo "    PH-05 '正控失败：……失败路径的结论不算数'。绿的只有 PH-01（反向对照：没配时形状不变本来就成立）。"
  echo "  · G-82 这门的两次自我修正也留原文：① PH-04/PH-05 第一版只有「不该出现」的断言，功能根本不存在时"
  echo "    四条半套 + 失败路径全绿 —— 那是真空通过，比没门禁更坏；各加一条正控（配齐必须先下发）后才变红。"
  echo "    ② PH-02 原来只比 host/box_id/client_token，漏了 port 的类型：服务端若把 port 当字符串发，"
  echo "    端上端口校验会判非法、手机会报一个查不出来的错；改成先断言 typeof 数字。"
  echo "  · G-82 修复后绿：PASS=5 FAIL=0 —— cn_inbound_server 的 redeem 成功回执改为「先建 redeemBody 再条件挂 relay」，"
  echo "    relay 只由 currentRelayHandoff() 产出：opts.relayHandoff（函数或对象都收）优先，未传时读"
  echo "    BITBOT_RELAY_HOST/PORT/BOX_ID/CLIENT_TOKEN；四栏有一栏不合法就整体回 null（半套不下发），"
  echo "    且该函数任何异常都被吞成 null ——「跨网没配好」不该把「配对」拖死。既有回执 10 个字段一个没动。"
  echo "  · G-82 手机侧同源证据（不在本门里，登记在此以免只看 JS 就以为通了）：Kotlin RT-11..RT-13 证"
  echo "    parseRelayHandoff 认得四栏 / 没配或坏 JSON 回 null / 半套不认；TS-01..TS-03 证连接方式文案"
  echo "    （直连/中转 · Nms 三语，含端上真实 locale「zh-CN」别名）。三条一起才等于「参数到了手机上」。"
  echo "  · G-82 残留（诚实）：① **SSE 长连接仍不走隧道** —— 跨网时回合走中转，但进度事件流还是诚实回退"
  echo "    （R-A3-5b 仍开）：TunnelHttp 只做了定长/chunked 的一次性响应，SSE 是「不结束的 chunked 流」，"
  echo "    要先把「隧道上读流 + 断线续订 + Last-Event-ID」设计清楚，这一刀没做，不许当已交付。"
  echo "    ② 手机侧仍无「手动填中转」入口，参数只能从配对回执来（配不上对就等于没配中转）。"
  echo "    ③ 真机跨网一次都没跑过（本机无 Android SDK/KVM）；同一台机器上桌面与手机都未走真中转网关。"
  echo "    ④ 桌面侧根本没把四栏读进来（只有 BITBOT_RELAY_* 环境变量，没设置面/没落地配置，R-A3-6d）、"
  echo "    也没以 box 角色连中转做 REGISTER（仓库只有服务端 + 测试用 registerBox，R-A3-6e）——"
  echo "    所以这一刀证的是「参数通路」，**不是「跨网通了」**：普通用户跑起来回执里不会有 relay。"
else
  bad "G-82 配对回执中转参数（见 /tmp/g82-handoff.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g82-handoff.log || tail -2 /tmp/g82-handoff.log | head -1)）"
  echo "  · G-82 修复前红（真实输出）：PASS=1 FAIL=4 —— PH-02/03/04/05 红，PH-01 绿（反向对照本来就成立）"
  echo "  · G-82 残留（诚实）：SSE 长连接仍未走隧道（R-A3-5b）、手机无手动填中转入口、真机跨网未跑"
fi

echo "== G-83 桌面自己挂上中转（路线 A · W4 / A3-7 · 配置 → 下发 → 登记：关 R-A3-6d/e）=="
if timeout 180 node scripts/prove_relay_box_registration.js > /tmp/g83-relay-box.log 2>&1; then
  ok "G-83 桌面挂中转全绿（$(grep -c '^  ✓ ' /tmp/g83-relay-box.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g83-relay-box.log)）"
  grep -q 'RB-01 ' /tmp/g83-relay-box.log && grep -q 'RB-11 ' /tmp/g83-relay-box.log && grep -q 'RB-03 ' /tmp/g83-relay-box.log \
    && ok "G-83 三条命门都在：没配时不下发也不登记、配齐时回执四栏与配置一致（正控，防「不该出现」真空绿）、AUTH+REGISTER 之后 registry 里真有这台盒子" \
    || bad "G-83 RB-01/RB-11/RB-03 锚点缺失（下发或登记没被断言到）"
  grep -q 'RB-04 ' /tmp/g83-relay-box.log && grep -q 'RB-05 ' /tmp/g83-relay-box.log \
    && ok "G-83 不是「登记了个名字」：client 角色 CONNECT 穿过隧道打到真 cn_inbound（200 OK）；错 box 凭证回 denied 且 registry 无此盒（先正控：好凭证能登记）" \
    || bad "G-83 RB-04/RB-05 锚点缺失（隧道是否真通、错凭证是否真拒，有一条没断言）"
  grep -q 'RB-06 ' /tmp/g83-relay-box.log && grep -q 'RB-07 ' /tmp/g83-relay-box.log && grep -q 'RB-08 ' /tmp/g83-relay-box.log \
    && ok "G-83 现场会踩的三种坑都钉住：半套配置一律当没配（不下发也不登记）、relay 重启后心跳把盒子带回来、审计日志有 register 但查无任何凭证原文" \
    || bad "G-83 RB-06/RB-07/RB-08 锚点缺失"
  grep -q 'RB-09 ' /tmp/g83-relay-box.log && grep -q 'RB-10 ' /tmp/g83-relay-box.log && grep -q 'RB-12 ' /tmp/g83-relay-box.log \
    && ok "G-83 接线也被钉住（模块绿≠产品会用）：四栏传入 / 服务端真读 / 拿住 started / 登记接 started / before-quit 停心跳；默认配置路径是 <repoRoot>/data/desktop/relay.json；装机包确实把新模块拷进 shared/" \
    || bad "G-83 RB-09/RB-10/RB-12 锚点缺失（模块与产品、源码与装机包之间的 join 没被断言）"
  echo "  · G-83 这一片是**新增能力**而不是修既有红，所以「修复前红」用**十一组负向对照**替代 —— 每摘掉一处锚点都必须被抓到"
  echo "    （逐个实跑，原文摘录）：① toHandoff 夹带 box_token → '✗ RB-02 下发给手机的必须正好四栏（不许夹带 box_token）— box_id,box_token,client_token,host,port'；"
  echo "    ② 半套也认 → RB-06 红；③ DENY 当成功 → '✗ RB-05 错凭证居然登记成功'；④ 摘掉 relayHandoff 传入 → '✗ RB-09 桌面接线缺了 1 处：四栏没接进 createCnInboundServer'；"
  echo "    ⑤ 退回 return cnInbound.start() → '✗ RB-09 ensureCnInbound 还是老写法'；⑥ 只摘 before-quit 里的 stop → '✗ RB-09 缺 1 处：before-quit 里没停心跳'；"
  echo "    ⑦ DEFAULT_REL 挪到 data/relay.json → '✗ RB-10 默认配置路径不是 data/desktop/relay.json'；⑧ 服务端读了 opts.relayHandoff 却恒回 null → '✗ RB-11 配了中转，回执里却没有 relay'；"
  echo "    ⑨ 心跳补丁残留（门禁自身崩）；⑩/⑪ 打包 filter 从 **/* 收窄成 *.js —— 第一次 RB-12 自己绿着（排除项 !**/*.map 里也有 **，是门的盲断言），"
  echo "    把包含项与排除项分开后才红：'✗ RB-12 shared 的包含项里没有递归通配 —— 新增的 relay/ 子目录进不了 asar'。"
  echo "  · G-83 最值钱的一条证据（第 ⑧ 组实测）：产品坏着，**RB-09 静态锚点照样是绿的** —— 它只证「这行代码在」，不证「这行代码有用」。"
  echo "    所以 RB-09 不能单独存在：必须有 RB-11（真 HTTP 兑换）与 RB-03..RB-05（真 socket）在同一门里，静态锚点只补那个 join。"
  echo "  · G-83 修复前红（RB-07 的形状被改过两次，原文留在这里）：第一版是真空通过 —— 客户端在**新 relay 启动之后**才 start()，"
  echo "    它那一次「立即登记」就把断言撑绿（实测 61ms/62ms 就回来）；改成「先跑在旧 relay 上确认登记成功 → 换新空 relay（反真空：确认为空）→ 等心跳带回来」后是 183ms。"
  echo "    第二版把 RB-08 连坐打红（'relay 没有记到任何 register 事件'）：重启换了新端口，而真实世界 relay 重启端口不变 —— 改成复用旧端口。"
  echo "  · G-83 残留（诚实）：① relay 的转发是**它自己拨**到 box 登记的 host:port，缺省 endpoint 只能是 127.0.0.1:<inbound 端口> ⇒"
  echo "    缺省 endpoint 只在「relay 与桌面同网络命名空间的宿主进程」下成立（容器桥接网络的 127.0.0.1 是容器自己，要显式写 endpoint）；"
  echo "    relay 在公网、桌面在 NAT 后面拨不进来 —— 这条已由下一片 A3-8 补上反向隧道（G-84 / §8.73），R-A3-6g 关闭；
    但**默认仍是 dial**，要用 reverse 必须在 relay.json 里显式写 "mode": "reverse"。② 没做桌面设置面：配置是手写 data/desktop/relay.json"
  echo "    （或 BITBOT_RELAY_* 环境变量），普通用户改不了 → R-A3-6h。③ box 凭证是明文落在本机 JSON 里的，"
  echo "    文件权限/钥匙串加密未做。④ 真机 + 真公网 relay 一次都没跑过（本机无 Android SDK/KVM），归 R-A2-1/R-A3-3b。"
  echo "  · G-83 一句话边界：这一刀让「桌面自己会读配置、会上线、会心跳」，**不等于跨网已经可用** —— SSE 仍不走隧道（R-A3-5b），"
  echo "    手机仍无手动填中转入口（R-A3-6a），真机/真公网仍是零（R-A3-6c）。"
  echo "  · G-83 本机全量矩阵复跑说明（诚实）：本机两跑在这条门上都是 12/0，但整本账不是绿的 ——"
  echo "    第一跑死在 G-70 的 bash 3.2 + set -u（\$g70_sum， 的中文标点被当成变量名，已统一改成花括号形式）；"
  echo "    第二跑 PASS=491 FAIL=27，27 条全落在宿主环境：safe-delete shim 累计 50 次删除后拦住 e2e 清理自建临时目录（21 条）、"
  echo "    沙箱拒绝读 prove_w3_device_trust.mjs（G-78）、Python 缺 PIL（G-64）、moon 内核打包失败（G-57）、"
  echo "    macOS pgrep 口径（G-46 尺子自证）、G-53 一条 DM 群上下文串味 —— 该条单独复跑 PASS=70 FAIL=0，坐实是并发污染而非产品红。**CI 才是权威**，见 report §8.72.8。"
else
  bad "G-83 桌面挂中转（见 /tmp/g83-relay-box.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g83-relay-box.log || tail -3 /tmp/g83-relay-box.log | head -1)）"
  echo "  · G-83 残留（诚实）：见上；这条红的常见原因：模块被删（RB-00）、relay 端口被占、或 main.js 接线被改回去（RB-09）"
fi

echo "== G-84 反向隧道：公网 relay 服务 NAT 后的桌面（路线 A · W4 / A3-8 · 关 R-A3-6g）=="
if timeout 240 node scripts/prove_relay_reverse_tunnel.js > /tmp/g84-reverse-tunnel.log 2>&1; then
  ok "G-84 反向隧道全绿（$(grep -c '^  ✓ ' /tmp/g84-reverse-tunnel.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g84-reverse-tunnel.log)）"
  grep -q 'RV-01 ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-05a ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-05c ' /tmp/g84-reverse-tunnel.log \
    && ok "G-84 反真空三件套都在：旧模式真打通（正控）、不可达端点真断（负向对照）、dialAttempts 真会动（否则「零主动拨」是恒 0 的真空绿）" \
    || bad "G-84 RV-01/RV-05a/RV-05c 锚点缺失（门的真/假都分不出来）"
  grep -q 'RV-03 ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-04 ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-05b ' /tmp/g84-reverse-tunnel.log \
    && ok "G-84 命门钉住：BIND 登记成 reverse 条目、phone → ACCEPT → box ATTACH → cn_inbound 真 200 OK、同一个不可达端点 dial 断而 reverse 通且 dialAttempts 不涨" \
    || bad "G-84 RV-03/RV-04/RV-05b 锚点缺失（「零主动拨且数据面端到端通」没被断言）"
  grep -q 'RV-06 ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-07 ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-08 ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-09 ' /tmp/g84-reverse-tunnel.log \
    && ok "G-84 现场会踩的坑都钉住：控制通道断 → 立刻 NOBOX（不卡死）、ACCEPT 无人接 3s 内 NOBOX、并发两条 stream 不串线、审计有 accept/attach 且查无凭证与明文" \
    || bad "G-84 RV-06/RV-07/RV-08/RV-09 锚点缺失"
  grep -q 'RV-10 ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-11 ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-12 ' /tmp/g84-reverse-tunnel.log && grep -q 'RV-13 ' /tmp/g84-reverse-tunnel.log \
    && ok "G-84 兼容与接线也在：旧 REGISTER 线协议仍 200 OK、手机端 TUNNEL 一行格式不变（零改动）、relay.json 写 reverse 真读得出且四栏不变、老配置不写 mode 仍回落 dial" \
    || bad "G-84 RV-10/RV-11/RV-12/RV-13 锚点缺失（向后兼容或配置接线没被断言）"
  echo "  · G-84 修复前红（最终门 RV-01..RV-13，把四个产品文件临时换成 A3-7 态跑，跑完逐字复原）：PASS=4 FAIL=11 ——"
  echo "    绿的是 RV-01/RV-05a/RV-10/RV-11 四条正控（门本身跑得起来）；红的是 RV-05c「没有 dialAttempts 计数器」、"
  echo "    RV-02「box 客户端没有进入 reverse 模式」、RV-03「registry 里这台盒子不是 reverse 条目」、RV-04「反向隧道没把请求送到 cn_inbound」、"
  echo "    RV-07「BIND 没拿到 BOUND — BADCMD」、RV-12/RV-13「配置面没接线」等。原文见 report.md §8.73.3。"
  echo "    门禁自身的第一次异常：'✗ 门禁自身异常：Error: read line timeout' —— 一次 write 发 AUTH+CONNECT 时 OK 与 TUNNEL 挤在同一个 TCP chunk，"
  echo "    旧 readLineFrom 每读一行就摘监听，第二行被永久吞掉。改成一条 socket 一个常驻行读取器后才跑出上面的干净红。"
  echo "  · G-84 修复过程中抓到的**真 bug**（不是门的问题）：首跑 PASS=11 FAIL=2，RV-04/RV-08 回 'HTTP/1.1 400 Bad Request'。"
  echo "    ATTACH 连接复用作数据面，relay 对它 AUTH 回的那行 OK 被盒子一路 pipe 进 cn_inbound，HTTP 服务把 OK 当请求行解析。"
  echo "    旧 REGISTER 是独立短连接，从没把控制应答混进数据面 —— 这个坑只在 reverse 出现，盒子端在建立 pipe 前先剥掉这一行才修好。"
  echo "  · G-84 十八组负向对照逐个实跑、逐组复原校验（原文见 report.md §8.73.4）：摘 dialAttempts、退回主动拨、kind 改 dial、"
  echo "    不断开不清表、不下发 ACCEPT、不回 TUNNEL、不记 accept 审计、审计夹带明文、label 夹空格、mode 恒 dial、streamId 固定、"
  echo "    不剥 OK 行、旧 REGISTER 回 BADREG、超时放宽到 8s、main.js 不传 mode / localEndpoint、配置 mode 恒 dial、toHandoff 夹带 mode。"
  echo "    第一版有 1 组真空：M02 把 reverse 条目改回 dial 却没给 host/port，openBox 拿 undefined 去 connect 直接把门带崩（'(no summary)'），"
  echo "    重做时补上合法但不可达的端点，让「退回主动拨」真的发生、门真的红，而不是崩 —— 门本身也加严：没有 PASS/FAIL 收尾行一律不算合格对照。"
  echo "  · G-84 残留（诚实）：① 本机同宿主造不出真 NAT，用不可达端点 192.0.2.1:1 等价建模；真公网 + 真 NAT 一次都没跑过 → R-A3-8a。"
  echo "    ② 默认仍是 dial，要用 reverse 必须手写 relay.json 的 \"mode\": \"reverse\"（无设置面，R-A3-6h）；运行中改配置仍不触发重登记（R-A3-6h）。"
  echo "    ③ reverse 控制长连接断线后按 2s 重连，这个重连路径本门未做断网注入实测；BIND 长连接没有应用层保活，靠 TCP keepalive/断线重连。"
  echo "    ④ 每条 stream 在盒子上要开两条出站连接（ATTACH + 本地 cn_inbound），并发上限、stream 泄漏与背压未做压测。⑤ 端到端业务 TLS 仍未做。"
  echo "    ⑥ 手机端协议零改动、APK 不需要重打；SSE 仍不走隧道（R-A3-5b），手机仍无手动填中转入口（R-A3-6a）。"
else
  bad "G-84 反向隧道（见 /tmp/g84-reverse-tunnel.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g84-reverse-tunnel.log || tail -3 /tmp/g84-reverse-tunnel.log | head -1)）"
  echo "  · G-84 残留（诚实）：见上；这条红的常见原因：BIND/ACCEPT/ATTACH 任一段被改回去、旧 REGISTER 路径被碰坏、或 relay.json 的 reverse 接线被摘掉"
fi

echo "== G-85 反向隧道活体检测与自愈（路线 A · W4 / A3-9 · 关 R-A3-8a 本机可做的那两条）=="
if timeout 240 node scripts/prove_relay_reverse_resilience.js > /tmp/g85-resilience.log 2>&1; then
  ok "G-85 活体检测与自愈全绿（$(grep -c '^  ✓ ' /tmp/g85-resilience.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g85-resilience.log)）"
  grep -q 'RR-01 ' /tmp/g85-resilience.log && grep -q 'RR-02 ' /tmp/g85-resilience.log \
    && ok "G-85 半开检测有反真空正控：只 BIND 不回 PONG 的假盒子被清、真盒子不被误踢（不是「谁都踢」），且 livenessEvictions 真会涨" \
    || bad "G-85 RR-01/RR-02 锚点缺失（半开检测或它的正控没被断言）"
  grep -q 'RR-03 ' /tmp/g85-resilience.log && grep -q 'RR-04 ' /tmp/g85-resilience.log \
    && ok "G-85 断网注入实测：relay 重启（端口不变）→ 盒子自动重连 → registry 回来 → 手机再 200 OK；box.stop() 之后不许偷偷重连" \
    || bad "G-85 RR-03/RR-04 锚点缺失（重连只写了逻辑没证过）"
  grep -q 'RR-05 ' /tmp/g85-resilience.log && grep -q 'RR-06 ' /tmp/g85-resilience.log \
    && ok "G-85 pending 窗口零驻留：灌 32KB canary 后 pendingBufferBytes=0、缓存空、审计查无明文；没人 ATTACH 仍明确 NOBOX 不卡死" \
    || bad "G-85 RR-05/RR-06 锚点缺失（用户态缓冲或数据面卡死没被断言）"
  grep -q 'RR-07 ' /tmp/g85-resilience.log && grep -q 'RR-08 ' /tmp/g85-resilience.log && grep -q 'RR-09 ' /tmp/g85-resilience.log \
    && ok "G-85 边界也在：旧 dial 仍 200 OK、审计有保活元数据且查无凭证与 canary、手机四栏不变（保活参数不外发）" \
    || bad "G-85 RR-07/RR-08/RR-09 锚点缺失"
  echo "  · G-85 修复前红（原文）：PASS=6 FAIL=3 —— 绿的是 RR-01/03/04/06/07/09（正控与既有能力），"
  echo "    红的是 '✗ RR-02 半开盒子没被清掉'、'✗ RR-05 没有 pendingBufferBytes 诊断'、'✗ RR-08 审计里没有保活元数据'。"
  echo "    门禁自己也修过一次：第一版 raw 连接没消费 AUTH 的 OK 行，RR-06 报 '✗ … 没拿到明确 NOBOX — OK'，"
  echo "    那是门读错了行不是产品红；改成写完 AUTH+CONNECT 先读掉 OK 再灌字节，才拿到干净红。"
  echo "  · G-85 十组负向对照逐个实跑、逐组复原校验、0 真空（原文见 report.md §8.74.4）：不装保活、阈值永不触发、"
  echo "    box 不回 PONG（反真空正控）、不 pause、摘 pendingSocketsPaused 诊断、不记 evictions、"
  echo "    不记超时审计、审计夹带 canary、摘 pendingBufferBytes 诊断、摘断线重连。"
  echo "    第一版 11 组里有 4 组真空，门自己被改硬过：① 「窗口结束时真盒子还在」看不出它中途被误踢又自动重连"
  echo "    ⇒ 改成数 livenessEvictions 差值必须恰好 1；② pendingBufferBytes=0 既可能是「内核缓冲持有」也可能是"
  echo "    「字节被读走丢了」⇒ 补 pendingSocketsPaused 断言；③ 摘掉手写 a.resume() 后门仍绿，"
  echo "    实测证明 pipe() 自己会 resume，那行是冗余的装饰性锚点，直接从产品里删掉；"
  echo "    ④ 「pending 分支改回累积」摘的是 pause 生效后不可达的兜底分支，门覆盖不到 —— 不算合格对照，"
  echo "    已从已验证锚点里移出，单列为已知盲区（见 report.md §8.74.6），不拿它凑数。"
  echo "  · G-85 残留（诚实）：① 「零驻留」指的是 **relay 用户态**不持有业务字节，pause 之后字节仍在 TCP/内核"
  echo "    接收缓冲里，不是端到端零驻留；大附件只会被对端背压挡住，不会被 relay 读进内存 —— 这个口径别读歪。"
  echo "    ② 保活默认 5s / 连续 2 次（约 10s 发现半开）是按经验定的，真 NAT 各厂商映射超时差异很大，没有实测调参。"
  echo "    ③ 每条 BIND 每周期记一条 ping 审计，盒子多时日志量未压测（内存缓冲有 10000 条上限）。"
  echo "    ④ stream 并发上限、stream 泄漏与背压仍未压测；真公网 relay + 真 NAT 桌面 + 蜂窝网手机仍零样本。"
  echo "    ⑤ 默认仍是 dial，要用 reverse 必须手写 relay.json 的 \"mode\": \"reverse\"（R-A3-6h）；"
  echo "    SSE 仍不走隧道（R-A3-5b），手机仍无手动填中转入口（R-A3-6a）。"
else
  bad "G-85 活体检测与自愈（见 /tmp/g85-resilience.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g85-resilience.log || tail -3 /tmp/g85-resilience.log | head -1)）"
  echo "  · G-85 残留（诚实）：见上；这条红的常见原因：PING/PONG 任一段被摘掉、pause/resume 不成对、或断线重连被改回去"
fi

echo "== G-86 真机验收前自检工具自证（路线 A · W4 / A3-10 · R-A3-8a 准备）=="
if timeout 180 node scripts/verify_real_device_readiness.js --self-test > /tmp/g86-readiness.log 2>&1; then
  ok "G-86 自检工具自证全绿（$(grep -c '^  ✓ ' /tmp/g86-readiness.log) 项，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g86-readiness.log)）"
  grep -q 'ST-01 ' /tmp/g86-readiness.log \
    && ok "G-86 反真空正控在：完整配置确实让自检 PASS=8 FAIL=0（不是「工具从来只会报红」）" \
    || bad "G-86 ST-01 正控缺失"
  grep -q 'ST-02 ' /tmp/g86-readiness.log && grep -q 'ST-03 ' /tmp/g86-readiness.log && grep -q 'ST-04 ' /tmp/g86-readiness.log \
    && ok "G-86 现场三大坑都钉住：没写 mode=reverse、两把钥匙混成一把、半套配置 —— 自检必须逐条报红" \
    || bad "G-86 ST-02/03/04 锚点缺失"
  grep -q 'ST-05 ' /tmp/g86-readiness.log && grep -q 'ST-06 ' /tmp/g86-readiness.log \
    && ok "G-86 钥匙一致性靠**真握手**：错 client_token 的 AUTH、错 box_token 的 BIND 都必须被抓到（不是静态字段比对）" \
    || bad "G-86 ST-05/ST-06 锚点缺失"
  grep -q 'ST-07 ' /tmp/g86-readiness.log && grep -q 'ST-08 ' /tmp/g86-readiness.log \
    && ok "G-86 可达性也钉住：relay 端口没监听、桌面入站没起，都要明确报红而不是 SKIP 当绿" \
    || bad "G-86 ST-07/ST-08 锚点缺失"
  echo "  · G-86 诚实边界（最容易误读的一条）：这里验的是**自检工具本身**，不是真机、不是跨网。"
  echo "    --self-test 自己起本地 relay + 临时配置，所以能挂 CI；默认模式要连真实 relay 和运行中的桌面 app，"
  echo "    CI 没有那两样，**故意不挂进总闸**。真公网 + 真 NAT + 蜂窝网手机那十条仍需人工逐条打勾，"
  echo "    见 docs/design/desktop-target/real-device-checklist.md §5。"
  echo "  · G-86 首跑抓到的真 bug：--self-test 用 spawnSync 起子进程，而 relay 与假桌面入站都跑在父进程事件循环里，"
  echo "    同步 spawn 把父进程整个阻塞 —— TCP 握手内核能完成、应用层永远没人应答，RD-06/07/08 全 timeout。"
  echo "    改成异步 spawn 后 8/8 全绿。留在这里免得以后又把「工具坏了」当成「产品坏了」。"
  echo "  · G-86 同时修了一份过时文档：旧 real-device-checklist.md 还写着「跨网不可用、Android relay 客户端没接」，"
  echo "    那是 A3-4 之前的状态。新清单按 A3-9 口径重写，并写明**配对必须先在同一 Wi-Fi 完成**"
  echo "    （redeemCode 仍是局域网 POST），拿到回执四栏后才能关 Wi-Fi 切蜂窝。"
else
  bad "G-86 自检工具自证（见 /tmp/g86-readiness.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g86-readiness.log || tail -3 /tmp/g86-readiness.log | head -1)）"
  echo "  · G-86 残留（诚实）：见上；这条红说明自检工具不可信，别拿它验真机"
fi

echo "== G-87 中转配置热生效（路线 A · W4 / A3-11 · 部分关 R-A3-6h）=="
if timeout 180 node scripts/prove_relay_config_hot_reload.js > /tmp/g87-hotreload.log 2>&1; then
  ok "G-87 配置热生效全绿（$(grep -c '^  ✓ ' /tmp/g87-hotreload.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g87-hotreload.log)）"
  grep -q 'RH-01 ' /tmp/g87-hotreload.log && grep -q 'RH-02 ' /tmp/g87-hotreload.log \
    && ok "G-87 反真空两件套在：配置齐时真 BIND 登记上（正控）、观察器定时器真在跑（不是门手动 check 出来的假象）" \
    || bad "G-87 RH-01/RH-02 锚点缺失"
  grep -q 'RH-04 ' /tmp/g87-hotreload.log && grep -q 'RH-05 ' /tmp/g87-hotreload.log && grep -q 'RH-06 ' /tmp/g87-hotreload.log && grep -q 'RH-07 ' /tmp/g87-hotreload.log \
    && ok "G-87 四类运行中变更都自动重登记：改 mode、换 box_token、删配置（停登记 + NOBOX）、从无到有（自己上线不用重启 app）" \
    || bad "G-87 RH-04/05/06/07 锚点缺失"
  grep -q 'RH-03 ' /tmp/g87-hotreload.log && grep -q 'RH-08 ' /tmp/g87-hotreload.log && grep -q 'RH-09 ' /tmp/g87-hotreload.log \
    && ok "G-87 不误伤也不空转：加空格不重登记（指纹用归一配置）、摘掉 onChange 时 registry 不变（注入对照）、stop() 之后不再触发" \
    || bad "G-87 RH-03/RH-08/RH-09 锚点缺失"
  grep -q 'RH-10 ' /tmp/g87-hotreload.log && grep -q 'RH-11 ' /tmp/g87-hotreload.log \
    && ok "G-87 模块绿≠产品会用：main.js 五处接线都在（require/启动/onChange 接登记/before-quit 停/入站关闭停），回执四栏仍现读且不含 box_token" \
    || bad "G-87 RH-10/RH-11 锚点缺失"
  echo "  · G-87 修复前红（最终门 + main.js 回退到 A3-10 态，观察器模块保留）：PASS=10 FAIL=1 ——"
  echo "    '✗ RH-10 桌面接线缺了 5 处：没 require 观察器模块；ensureCnInbound 没启动观察器；"
  echo "    onChange 没接到登记函数上；before-quit 没停观察器；入站关掉时没停观察器'。"
  echo "    其余十条全绿 ⇒ 这正是 A3-7 RB-09 那类最值钱的红：**模块能跑，但产品根本没接线**。"
  echo "  · G-87 十组负向对照逐个实跑、逐组复原校验、0 真空（原文见 report.md §8.76.4）："
  echo "    摘四处 main.js 接线、指纹恒不变、check 不回调、stop 不生效、指纹掺时间戳（加空格也触发）、"
  echo "    toHandoff 夹带 mode、回执恒回 null。另门内自带 RH-08 注入对照（空 onChange 时 registry 不变）。"
  echo "  · G-87 残留（诚实）：① 只解决「登记不热」，**没有设置界面**、box_token 仍明文落盘、"
  echo "    仍没做钥匙串/0600 ⇒ R-A3-6h 只是**部分关闭**。② 2s 轮询是折中：编辑器 rename 保存、"
  echo "    asar 路径都不适合 fs.watch，但轮询有最多 2s 生效延迟，不是瞬时。"
  echo "    ③ 指纹用归一后的配置对象，JSON 里加注释不是合法 JSON、会被当成没配（半套一律 null）。"
  echo "    ④ 真机/真公网仍是零样本；SSE 仍不走隧道（R-A3-5b）。"
else
  bad "G-87 配置热生效（见 /tmp/g87-hotreload.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g87-hotreload.log || tail -3 /tmp/g87-hotreload.log | head -1)）"
  echo "  · G-87 残留（诚实）：见上；这条红的常见原因：main.js 接线被摘、观察器回调没接登记、或四栏现读被改回恒 null"
fi

echo "== G-88 中转凭证落盘加固（路线 A · W4 / A3-12 · 关 R-A3-6h 的凭证明文半条）=="
if timeout 180 node scripts/prove_relay_secure_config.js > /tmp/g88-securecfg.log 2>&1; then
  ok "G-88 凭证加固全绿（$(grep -c '^  ✓ ' /tmp/g88-securecfg.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g88-securecfg.log)）"
  grep -q 'RS-01 ' /tmp/g88-securecfg.log && grep -q 'RS-04 ' /tmp/g88-securecfg.log \
    && ok "G-88 反真空正控在：旧手写明文 relay.json 继续读得出（向后兼容），安全格式 resolve 回的钥匙与签发值逐字相同" \
    || bad "G-88 RS-01/RS-04 锚点缺失"
  grep -q 'RS-02 ' /tmp/g88-securecfg.log && grep -q 'RS-03 ' /tmp/g88-securecfg.log \
    && ok "G-88 明文真的没了：relay.json 只留 *_token_ref 且 mode=0600，vault.json / vault.key 查无明文（AES-256-GCM）" \
    || bad "G-88 RS-02/RS-03 锚点缺失"
  grep -q 'RS-05 ' /tmp/g88-securecfg.log && grep -q 'RS-06 ' /tmp/g88-securecfg.log && grep -q 'RS-07 ' /tmp/g88-securecfg.log \
    && ok "G-88 边界也在：四栏仍正好四栏且不含 box_token、权限 644 只告警不拒绝读、半套/坏 JSON 一律 null" \
    || bad "G-88 RS-05/RS-06/RS-07 锚点缺失"
  grep -q 'RS-08 ' /tmp/g88-securecfg.log && grep -q 'RS-09 ' /tmp/g88-securecfg.log && grep -q 'RS-10 ' /tmp/g88-securecfg.log \
    && ok "G-88 不真空也不连坐：假 vault 取不到凭证时回 null、main.js 七处接线都在、RB-09/RV-12/RH-10 既有锚点一字未动" \
    || bad "G-88 RS-08/RS-09/RS-10 锚点缺失"
  echo "  · G-88 修复前红（最终门 + main.js 回退 A3-11 态，保留新模块）：运行时十条全绿、"
  echo "    只有 RS-09「桌面接线缺了 N 处」红 —— 与 A3-11 同型：模块能跑，产品没接线。"
  echo "    这一片是新增能力，按 A3-7 先例用「基线红 + 门内 RS-08 注入对照 + 十组负向对照」替代传统修复前红。"
  echo "  · G-88 十组负向对照逐个实跑、逐组复原校验（原文见 report.md §8.77.4）："
  echo "    摘 require / 摘 vault / 读口退回普通 load / 安全写入夹带明文（自检必须拦下）/"
  echo "    写文件用 0644 / resolve 为空编 dummy / toHandoff 夹带 box_token / 权限检查恒真 /"
  echo "    回执不走安全读口 / 半套也认。"
  echo "  · G-88 残留（诚实）：① vault 密钥仍在本机磁盘（不是 OS 钥匙串），防的是"
  echo "    「grep data/ 见明文 / 同机其他用户读走」，不防本机已被完全控制。② **没有设置界面**："
  echo "    安全写入只有 API，现场要把手写明文转成安全格式得跑一条命令（清单 §2.3）。"
  echo "    ③ 清单示例仍用旧明文格式（兼容），不主动转换就还是明文；④ 真机/真公网仍零样本。"
else
  bad "G-88 凭证加固（见 /tmp/g88-securecfg.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g88-securecfg.log || tail -3 /tmp/g88-securecfg.log | head -1)）"
  echo "  · G-88 残留（诚实）：见上；这条红的常见原因：安全写入把明文写回磁盘、vault 没接上、或四栏夹带 box_token"
fi

echo "== G-89 反向隧道 stream 并发上限与背压（路线 A · W4 / A3-13 · R-A3-8a 本机可做的那一半）=="
if timeout 180 node scripts/prove_relay_stream_backpressure.js > /tmp/g89-backpressure.log 2>&1; then
  ok "G-89 并发上限全绿（$(grep -c '^  ✓ ' /tmp/g89-backpressure.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g89-backpressure.log)）"
  grep -q 'BP-01 ' /tmp/g89-backpressure.log && grep -q 'BP-03 ' /tmp/g89-backpressure.log \
    && ok "G-89 反真空两件套在：上限内确实进 pending（不是「什么都拒」）、上限调大后 5 条全部进 pending" \
    || bad "G-89 BP-01/BP-03 锚点缺失"
  grep -q 'BP-02 ' /tmp/g89-backpressure.log && grep -q 'BP-04 ' /tmp/g89-backpressure.log \
    && ok "G-89 命门钉住：超限明确 NOBOX 且 pendingRejected 可观测、超时释放后新 CONNECT 还能进（动态上限而非一次性熔断、无 stream 泄漏）" \
    || bad "G-89 BP-02/BP-04 锚点缺失"
  grep -q 'BP-05 ' /tmp/g89-backpressure.log && grep -q 'BP-06 ' /tmp/g89-backpressure.log && grep -q 'BP-08 ' /tmp/g89-backpressure.log && grep -q 'BP-09 ' /tmp/g89-backpressure.log \
    && ok "G-89 边界也在：dialAttempts 全程 0、审计有 stream-reject 且查无凭证、旧 dial 仍 200 OK、上限按实例可配" \
    || bad "G-89 BP-05/06/08/09 锚点缺失"
  echo "  · G-89 修复前红（最终门 + relay_server.js 回退 A3-12 态）：PASS=4 FAIL=4 ——"
  echo "    '✗ BP-01 上限内的 CONNECT 没进 pending — activeStreams:5'、'✗ BP-02 超限的 CONNECT 没都拿到明确 NOBOX — 收到 NOBOX 的条数=0'、"
  echo "    '✗ BP-06 审计里没有 stream-reject 元数据'、'✗ BP-09 上限不是按实例配置的'。"
  echo "    第一版基线红是 3/5：BP-03 用 pendingRejected !== 0 判定，把「字段还不存在(undefined)」"
  echo "    也算成了「被拒」，门自己有水份；改成 > 0 后基线红变成干净的 4/4。"
  echo "  · G-89 七组负向对照逐个实跑、逐组复原校验、0 真空（原文见 report.md §8.78.4）："
  echo "    摘上限检查、上限恒不触发、摘 pendingRejected 计数、不记 stream-reject 审计、"
  echo "    超限直接断开不回 NOBOX、诊断摘掉两个计数、上限写成全局常量。"
  echo "  · G-89 残留（诚实）：① 默认 64 是经验值，没在真公网压过；② 上限只管**等 ATTACH 的 pending**，"
  echo "    已建立的 ATTACH 数据面连接数仍无上限；③ 只测了 5 条并发，不是压测；"
  echo "    ④ 真公网 + 真 NAT + 蜂窝网手机仍零样本（R-A3-8a 剩余）；⑤ SSE 仍不走隧道。"
else
  bad "G-89 并发上限（见 /tmp/g89-backpressure.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g89-backpressure.log || tail -3 /tmp/g89-backpressure.log | head -1)）"
  echo "  · G-89 残留（诚实）：见上；这条红的常见原因：上限检查被摘、拒绝没回 NOBOX、或放过了主动拨"
fi

echo "== G-90 桌面中转设置面（路线 A · W4 / A3-14 · 再部分关 R-A3-6h）=="
if timeout 180 node scripts/prove_relay_settings.js > /tmp/g90-settings.log 2>&1; then
  ok "G-90 设置面全绿（$(grep -c '^  ✓ ' /tmp/g90-settings.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g90-settings.log)）"
  grep -q 'RS2-01 ' /tmp/g90-settings.log && grep -q 'RS2-03 ' /tmp/g90-settings.log && grep -q 'RS2-04 ' /tmp/g90-settings.log \
    && ok "G-90 视图只回掩码：未配置说没配、保存后查无明文、只改地址时 token 留空沿用（不用每次重贴两把钥匙）" \
    || bad "G-90 RS2-01/03/04 锚点缺失"
  grep -q 'RS2-05 ' /tmp/g90-settings.log && grep -q 'RS2-06 ' /tmp/g90-settings.log && grep -q 'RS2-07 ' /tmp/g90-settings.log && grep -q 'RS2-08 ' /tmp/g90-settings.log \
    && ok "G-90 不撒谎：首次缺 token 明确拒绝、非法字段逐条挡住、关闭中转写 enabled:false、半套/坏 JSON 一律未配置" \
    || bad "G-90 RS2-05/06/07/08 锚点缺失"
  grep -q 'RS2-09 ' /tmp/g90-settings.log && grep -q 'RS2-10 ' /tmp/g90-settings.log && grep -q 'RS2-12 ' /tmp/g90-settings.log && grep -q 'RS2-13 ' /tmp/g90-settings.log \
    && ok "G-90 产品接线也在：preload 三通道 / main.js 三 handler / 保存后主动重登记；表单+密码框+13 个三语词条；新增 UI JS 可编译；IA 边界守住" \
    || bad "G-90 RS2-09/10/12/13 锚点缺失"
  echo "  · G-90 修复前红（门写完后产品 UI 一行沒接）：PASS=9 FAIL=2 —— 运行时八条全绿，"
  echo "    红的只有 'RS2-09 桌面接线缺了 9 处' 与 'RS2-10 HTML 缺元素'，正是「模块能用但产品没界面」。"
  echo "  · G-90 十一组负向对照逐个实跑、逐组复原校验、0 真空（原文见 report.md §8.79.4）。"
  echo "    其中 M03 第一版真空：摘掉 save handler 里的重登记后门仍绿 —— RS2-09 用 main.includes 全文搜，"
  echo "    被 disable handler 里同款调用撑绿（A3-7 RB-09 同型坑），改成切 saveBlock 再查才红。"
  echo "  · G-90 真机门也复跑过：e2e_desktop_mobile_control 首次 PASS=14 FAIL=1 ——"
  echo "    'MC-02 这一屏还摆着令牌控件 — mc-relay-box-token,mc-relay-client-token'。"
  echo "    这不是环境红也不是门误报：**产品 IA 冲突**，MC-02 硬要求手机配对弹窗零令牌控件（6 位码才是主路）。"
  echo "    改成「配对弹窗只留入口卡片、表单放独立 #relay-settings-modal」后 MC 15/0，并补 RS2-13 把边界钉在本门里。"
  echo "  · G-90 残留（诚实）：① **R-A3-6h 仍未整条关闭** —— OS 钥匙串没接，vault 密钥还在本机磁盘；"
  echo "    ② 设置面只做了中转这一段，没有统一的「设置」页重构；③ 独立弹窗走自带的 display/Esc，"
  echo "    没接项目的 sheet 栈（MC-06/12 只管配对弹窗，本机门已绿）；"
  echo "    ④ 三语文案是新增词条，未做真机切语言肉眼验收；⑤ 真机/真公网仍零样本。"
else
  bad "G-90 设置面（见 /tmp/g90-settings.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g90-settings.log || tail -3 /tmp/g90-settings.log | head -1)）"
  echo "  · G-90 残留（诚实）：见上；这条红的常见原因：preload/IPC 接线被摘、视图把明文回给渲染端、或表单被搬回配对弹窗"
fi

echo "== G-91 公网跨网接线（路线 A · W4 / A3-15 · 连接地址与下发地址分离）=="
if timeout 180 node scripts/prove_public_relay_setup.js > /tmp/g91-pubsetup.log 2>&1; then
  ok "G-91 公网接线全绿（$(grep -c '^  ✓ ' /tmp/g91-pubsetup.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g91-pubsetup.log)）"
  grep -q 'PU-01 ' /tmp/g91-pubsetup.log && grep -q 'PU-02 ' /tmp/g91-pubsetup.log \
    && ok "G-91 地址拆分成立：connect_host 读得出且老配置缺省为空；手机四栏仍是公网 host、形状一字不变、不夹带 connect_host/box_token" \
    || bad "G-91 PU-01/PU-02 锚点缺失"
  grep -q 'PU-03 ' /tmp/g91-pubsetup.log && grep -q 'PU-04 ' /tmp/g91-pubsetup.log && grep -q 'PU-05 ' /tmp/g91-pubsetup.log && grep -q 'PU-06 ' /tmp/g91-pubsetup.log \
    && ok "G-91 不脱钩：安全格式保留 connect_host 且无明文、设置面保存不丢它、真 socket 出站 BIND 成功、不可达公网端点确实连不上（证拆分必要）" \
    || bad "G-91 PU-03/04/05/06 锚点缺失"
  grep -q 'PU-07 ' /tmp/g91-pubsetup.log && grep -q 'PU-08 ' /tmp/g91-pubsetup.log && grep -q 'PU-09 ' /tmp/g91-pubsetup.log && grep -q 'PU-10 ' /tmp/g91-pubsetup.log && grep -q 'PU-11 ' /tmp/g91-pubsetup.log \
    && ok "G-91 部署与接线也在：setup 拒绝回环/私网 host、start 绑 0.0.0.0 且共用 secret、main.js 真用 connect_host、既有六处锚点未动、四个凭证文件全被 .gitignore 覆盖" \
    || bad "G-91 PU-07/08/09/10/11 锚点缺失"
  echo "  · G-91 修复前红（最终门 + 4 个既有文件回退 A3-14 态）：PASS=7 FAIL=4 ——"
  echo "    '✗ PU-01 connect_host 没读出来'、'✗ PU-03 安全格式不对'、'✗ PU-04 保存后 connect_host 丢了'、"
  echo "    '✗ PU-09 桌面没用 connect_host'。八组负向对照逐个实跑、0 真空（原文见 report.md §8.80.4）；"
  echo "    收口自查还抓到 relay-secret 未被 .gitignore 覆盖（会被误提交），补规则并加 PU-11 钉住。"
  echo "  · G-91 现场实测（真 relay + 真桌面 app，不是门造的桩）："
  echo "    [relay-box] reverse box=my-desktop -> 14.155.111.69:18766；relay /healthz boxes:1；"
  echo "    审计 connect→accept→attach→close 同一 streamId；隧道上 GET /v1/pair/discover → HTTP/1.1 200 OK + bitbot-desktop JSON。"
  echo "  · G-91 诚实边界：① 这证的是「手机够得到 relay 时整条链路通」，**不等于公网入口已存在** ——"
  echo "    本机网卡 10.201.107.104 在 NAT 后、无 UPnP/隧道工具，TCP 18766 是否映射需路由器侧配置；"
  echo "    桌面连自己的公网出口实测超时，正是 connect_host 拆分的原因。② 手机仍需**先同一 Wi-Fi 配对一次**"
  echo "    才能拿到四栏（redeem 只走局域网，R-A3-5b/R-A3-6a 未做） → 之后才能关 Wi-Fi 走蜂窝。"
  echo "    ③ 若 relay 部署在另一台公网机器，setup 要带 --connect-host <那台机器地址>，勿留 127.0.0.1。"
  echo "    ④ 真公网 + 真 NAT + 蜂窝网样本仍为零，R-A3-8a 未关闭。"
  echo "  · G-91 收口还修掉 A3-14 那跑 CI 的唯一真红（run 42029684165，PASS=576 FAIL=1）："
  echo "    '✗ G-89 BP-05/06/08/09 锚点缺失' —— 门把 BP-06/07 合并输出成 'BP-06/07'，"
  echo "    总闸按 'BP-06 ' grep 失配（斜杠不是空格）。拆成两条独立 ok 后门 9/0、四条 grep 全命中，"
  echo "    A3-13 七组负向对照重跑仍 0 真空。详见 report.md §8.80.7。"
else
  bad "G-91 公网接线（见 /tmp/g91-pubsetup.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g91-pubsetup.log || tail -3 /tmp/g91-pubsetup.log | head -1)）"
  echo "  · G-91 残留（诚实）：见上；这条红的常见原因：地址拆分被摘、四栏误用 connect_host、或部署脚本绑回 127.0.0.1"
fi

echo "== G-92 中转地址自检（路线 A · W4 / A3-16 · 两个地址为什么不一样）=="
if timeout 180 node scripts/prove_relay_host_audit.js > /tmp/g92-hostaudit.log 2>&1; then
  ok "G-92 地址自检全绿（$(grep -c '^  ✓ ' /tmp/g92-hostaudit.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g92-hostaudit.log)）"
  grep -q 'HA-01 ' /tmp/g92-hostaudit.log && grep -q 'HA-02 ' /tmp/g92-hostaudit.log && grep -q 'HA-03 ' /tmp/g92-hostaudit.log && grep -q 'HA-04 ' /tmp/g92-hostaudit.log \
    && ok "G-92 认得清：13 种地址分类、5 种写法归一；本机网卡私网与「别处捡来的私网」判成两回事" \
    || bad "G-92 HA-01/02/03/04 锚点缺失"
  grep -q 'HA-05 ' /tmp/g92-hostaudit.log && grep -q 'HA-06 ' /tmp/g92-hostaudit.log && grep -q 'HA-09 ' /tmp/g92-hostaudit.log \
    && ok "G-92 不判死：公网域名/本机公网出口 IP 只 warn；dial 同网部署的私网地址照存（准入只拦 reverse+error）" \
    || bad "G-92 HA-05/06/09 锚点缺失"
  grep -q 'HA-07 ' /tmp/g92-hostaudit.log && grep -q 'HA-08 ' /tmp/g92-hostaudit.log && grep -q 'HA-10 ' /tmp/g92-hostaudit.log \
    && ok "G-92 真拦得住：读视图带 audit、reverse+私网保存被拒且文件零改动、回执自检不过就 return null（不下发死地址）" \
    || bad "G-92 HA-07/08/10 锚点缺失"
  grep -q 'HA-11 ' /tmp/g92-hostaudit.log && grep -q 'HA-12 ' /tmp/g92-hostaudit.log && grep -q 'HA-13 ' /tmp/g92-hostaudit.log \
    && ok "G-92 界面也说人话：有审计行、码→词条表、灯跟随自检结果、11 词条 × 3 语齐、输出不含凭证" \
    || bad "G-92 HA-11/12/13 锚点缺失"
  echo "  · G-92 现场来由（用户报障，不是凭空造的用例）：配对那行显示 http://10.201.107.104:18765，"
  echo "    中转那行显示 192.168.1.5:18766 —— 两个地址本来就该不一样（一个是网卡现算的局域网地址，"
  echo "    一个是 relay.json 里手填的下发地址）；真正的病是 **192.168.1.5 既不在本机任何网段、也不是公网**，"
  echo "    而 A3-14 的设置面只校验「非空 + 端口范围」，于是它被写进配置、随回执发给手机，手机照着连、连不上。"
  echo "  · G-92 十三组负向对照逐个实跑、逐组复原校验、0 真空（原文见 report.md §8.81.4）。"
  echo "    其中 M05 第一版真空：把 if 块里的 return null 删掉门仍绿 —— HA-10 用 main.includes 全文搜，"
  echo "    被 catch 兜底那句 return null 撑绿；换成贪心正则后**又**跨过 if 右花括号吃到兜底那行，"
  echo "    最终改成按花括号切出 if 块区间再查才红（A3-7 RB-09 / A3-14 M03 同型坑，第三次踩）。"
  echo "  · G-92 诚实边界：① 判定只据 host 字面 + 本机网卡，**不做 DNS 解析、不探测端口** ——"
  echo "    域名 host 一律 warn 不是 ok，因为「解析得到」和「敲得开」这台机器说了不算；"
  echo "    ② 没有记录任何「曾经连通过」的历史，因此无法区分「配置错了」与「配置对但现在网络变了」；"
  echo "    ③ 现场 relay.json 里的 192.168.1.5 是历史残留，本刀没动它（改它需要用户真实公网地址），"
  echo "    现在的行为是：界面标红 + 回执扣下 relay 段，手机退回同网配对。"
else
  bad "G-92 地址自检（见 /tmp/g92-hostaudit.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g92-hostaudit.log || tail -3 /tmp/g92-hostaudit.log | head -1)）"
  echo "  · G-92 残留（诚实）：见上；这条红的常见原因：分类被改宽/改窄、准入闸被摘、界面灯回到「配了就绿」"
fi

echo "== G-93 跨网配对串（路线 A · W4 / A3-18 · 手机在蜂窝网下也能配第一次）=="
if timeout 180 node scripts/prove_relay_bootstrap.js > /tmp/g93-bootstrap.log 2>&1; then
  ok "G-93 配对串全绿（$(grep -c '^  ✓ ' /tmp/g93-bootstrap.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g93-bootstrap.log)）"
  grep -q 'RBI-02 ' /tmp/g93-bootstrap.log && grep -q 'RBI-03 ' /tmp/g93-bootstrap.log \
    && ok "G-93 真安全也真有用地拒绝：串里只有 client_token（box 那把不出门）、盘上是历史残留的死地址时拒绝生成而不是照着发" \
    || bad "G-93 RBI-02/03 锚点缺失"
  grep -q 'RBI-06 ' /tmp/g93-bootstrap.log && grep -q 'INJ-RBI_06 ' /tmp/g93-bootstrap.log \
    && ok "G-93 两端线格式逐字对齐：SCHEME 同一个字面量、键 h/p/b/t 两边都在、转义集 %&# 三个；改一边立刻被同一判据抓到" \
    || bad "G-93 RBI-06/INJ 锚点缺失"
  grep -q 'RBI-07 ' /tmp/g93-bootstrap.log && grep -q 'RBI-08 ' /tmp/g93-bootstrap.log \
    && ok "G-93 两端都接通：桌面 IPC/preload/按钮/复制、手机 PairingSheet→parse→走隧道 redeem（不拼直连 IP）" \
    || bad "G-93 RBI-07/08 锚点缺失"
  echo "  · G-93 现场来由（R-A3-6a 的死结）：redeemCode 只 POST 局域网地址，而中转四栏**只有配对成功后**才下发 ——"
  echo "    于是「在蜂窝网下配第一次」在结构上不可能，必须先回同一个 Wi-Fi 配一次。"
  echo "  · G-93 十一组负向对照里两组是**实跑**的：把 box_token 拼进串（改副本模块 → 真 require → 真生成，看串里有没有），"
  echo "    以及改 SCHEME/键名/丢一个转义字符（同一 measureWire 判据必须翻红）。"
  echo "  · G-93 诚实边界：① 本门**不执行 Kotlin**，两端对齐是字面量+键序列比对；解析行为由 RB-01..RB-06 承担（AB-21 点名）；"
  echo "    ② 真手机 + 真 relay 粘过去能不能用，仍是 R-A3-6a 的残留。"
else
  bad "G-93 跨网配对串（见 /tmp/g93-bootstrap.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g93-bootstrap.log || tail -3 /tmp/g93-bootstrap.log | head -1)）"
  echo "  · G-93 残留（诚实）：见上；这条红的常见原因：生成器把 box token 带出去了、自检被绕开照样生成、或手机侧改回直连 redeem"
fi

echo "== G-94 OS 钥匙串（路线 A · W4 / R-A3-6h · vault 密钥不再躺在本机磁盘）=="
if timeout 180 node scripts/prove_vault_keychain.js > /tmp/g94-vault.log 2>&1; then
  ok "G-94 钥匙串全绿（$(grep -c '^  ✓ ' /tmp/g94-vault.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g94-vault.log)）"
  grep -q 'VK-08 ' /tmp/g94-vault.log && grep -q 'VK-09 ' /tmp/g94-vault.log \
    && ok "G-94 迁移如实：file/明文 → os-keychain/迁移完成；后端不可用时 available=false（不假装已上钥匙串）" \
    || bad "G-94 VK-08/09 锚点缺失"
  grep -q 'VK-10 ' /tmp/g94-vault.log \
    && ok "G-94 算法没被换弱：仍是 aes-256-gcm + randomBytes(32)，密钥不进日志" \
    || bad "G-94 VK-10 锚点缺失"
  echo "  · G-94 残留（诚实）：解不开时**绝不自动重建**（宁可让用户重新配对，也不静默丢凭证）；"
  echo "    真机 Electron safeStorage 形态（macOS Keychain / Windows DPAPI）未逐一实跑，只验了注入 protector 这一层。"
else
  bad "G-94 钥匙串（见 /tmp/g94-vault.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g94-vault.log || tail -3 /tmp/g94-vault.log | head -1)）"
  echo "  · G-94 残留（诚实）：见上；这条红的常见原因：迁移把明文留下了、后端不可用时报可用、或算法被换弱"
fi

echo "== G-95 公网入口自动化（路线 A · W4 / R-A3-8a 部分 · 探测 + UPnP 映射）=="
if timeout 240 node scripts/prove_public_entry.js > /tmp/g95-public.log 2>&1; then
  ok "G-95 公网入口全绿（$(grep -c '^  ✓ ' /tmp/g95-public.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g95-public.log)）"
  grep -q 'PE-11 ' /tmp/g95-public.log && grep -q 'PE-12 ' /tmp/g95-public.log \
    && ok "G-95 不靠网络也说话：三个脚本 --help 退出 0、三条网络路径全带超时（探测失败如实报错，不编 IP）" \
    || bad "G-95 PE-11/12 锚点缺失"
  echo "  · G-95 残留（诚实）：本机出网探测在本机环境曾超时（api.ipify.org exit 28），UPnP 在运营商光猫/双 NAT 下仍可能不适用；"
  echo "    **真公网 relay + 真 NAT 桌面 + 蜂窝网手机样本依旧为零**，R-A3-8a 未关闭。"
else
  bad "G-95 公网入口（见 /tmp/g95-public.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g95-public.log || tail -3 /tmp/g95-public.log | head -1)）"
  echo "  · G-95 残留（诚实）：见上；这条红的常见原因：超时被摘（探测会挂住 CI）、或失败路径开始编造 IP"
fi

echo "== G-96 验收清单不许说反话（路线 A · 文档与代码一致性 · 改前红改后绿）=="
if timeout 120 node scripts/prove_checklist_freshness.js > /tmp/g96-checklist.log 2>&1; then
  ok "G-96 清单与代码事实一致（$(grep -c '^  ✓ ' /tmp/g96-checklist.log) 项断言，$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g96-checklist.log)）"
  grep -q 'INJ-CF ' /tmp/g96-checklist.log \
    && ok "G-96 判据有牙：六种旧说法（SSE 不走隧道 / APK 不用重打 / 必须同网配对 / 不是钥匙串 / 重启 app / R-A3-6h 未关）逐一注入全被抓到" \
    || bad "G-96 INJ-CF 注入对照缺失"
  # 反向证据：造一份「代码已做完、文档还写着没做」的清单，门必须真的红。
  # 不用 `git show HEAD:` —— 提交之后 HEAD 就是新版，那条对照会自己变绿/变红，
  # 门会跟着提交腐烂。这里现场合成，永远成立。
  {
    cat docs/design/desktop-target/real-device-checklist.md
    printf '\n当前 SSE 不走隧道，必然回退到整轮模式。\n'
    printf '\nA3-6 构建的 APK 已含全部能力，不用重打。\n'
    printf '\n铁律：配对必须先在同一个 Wi-Fi 完成。\n'
    printf '\n改完 relay.json 后请重启桌面 app 让配置生效。\n'
  } > /tmp/g96-stale.md 2>/dev/null
  if BITBOT_CHECKLIST_DOC=/tmp/g96-stale.md timeout 120 node scripts/prove_checklist_freshness.js > /tmp/g96-stale.log 2>&1; then
    bad "G-96 合成陈旧清单竟然也是绿的 —— 这道门拦不住陈旧，等于没门"
  else
    ok "G-96 改前红：合成陈旧清单报 $(grep -m1 -o 'FAIL=[0-9]*' /tmp/g96-stale.log)，四条旧说法逐条被抓到（对照不是摆设）"
  fi
  echo "  · G-96 诚实的边界：这是**词面**检查，不是语义检查。它只挡「明明做完了还写着没做」这一类具体陈旧说法，"
  echo "    不检查清单是否完整（漏一条验收项它看不出来），也不跑 Android、不碰真机。"
else
  bad "G-96 清单新鲜度（见 /tmp/g96-checklist.log；$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g96-checklist.log || tail -3 /tmp/g96-checklist.log | head -1)）"
  echo "  · G-96 残留（诚实）：见上；这条红的常见原因：代码补完了但清单还写着「没做/不走/不用重打」，"
  echo "    或有人把历史注记写进了正文（应放进 > 引用块或用 ~~删除线~~）"
fi

echo "== G-97 relay 诊断态现场可读 + 恒真判据被拆穿（DG-01..DG-12）=="
if timeout 180 node scripts/prove_relay_diagnostics.js > /tmp/g97-diag.log 2>&1; then
  ok "G-97 /diagnostics 现场可读且计数成对（$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g97-diag.log)）"
  grep -q 'DG-07 .*恒真对照被拆穿' /tmp/g97-diag.log \
    && ok "G-97 反真空：挂住 3 条死连接时 activeStreams 照样回基线、liveBridges 真涨到 3（旧 §5⑭ 判据确实证明不了任何事）" \
    || bad "G-97 DG-07 恒真对照证据缺失"
  grep -q 'DG-02 .*五组负向对照' /tmp/g97-diag.log \
    && ok "G-97 判据有牙：摘 close / 删字段 / 删 schema / 整包序列化 / reverse 不记账，五组注入全被抓到" \
    || bad "G-97 负向对照缺失"
else
  bad "G-97 relay 诊断门（见 /tmp/g97-diag.log；$(tail -3 /tmp/g97-diag.log | tr '\n' ' ')）"
fi

echo "== G-98 桌面/relay 侧一键自证工具本身可信（EV / ST --self-test）=="
if timeout 240 node scripts/verify_real_device_desktop_side.js --self-test > /tmp/g98-evidence.log 2>&1; then
  ok "G-98 一键判定工具自证全绿（$(grep -m1 -o 'self-test: PASS=[0-9]* FAIL=[0-9]*' /tmp/g98-evidence.log)）"
  grep -q 'ST-02 没跑过消息（真空绿）' /tmp/g98-evidence.log \
    && grep -q 'ST-04 liveBridges 不回基线' /tmp/g98-evidence.log \
    && ok "G-98 判据有牙：真空绿 / 连接泄漏 / 缺基线 / 审计夹带 token / 明文密钥 / 盒子离线 / 旧 relay 等九组负向逐条转红" \
    || bad "G-98 负向对照缺失（工具会把「没取到数」当绿）"
  grep -q 'ST-13 --out 落盘' /tmp/g98-evidence.log \
    && ok "G-98 产出可粘贴记录，且明确列出「手机侧仍需人工」的九条（不假装能判）" \
    || bad "G-98 记录产物 / 人工边界缺失"
else
  bad "G-98 一键判定工具自证（见 /tmp/g98-evidence.log；$(tail -3 /tmp/g98-evidence.log | tr '\n' ' ')）"
fi

echo "== G-99 桌面启动日志说人话（§5⑫ · errno / 真目标 / 收敛）=="
if timeout 180 node scripts/prove_relay_failure_copy.js > /tmp/g99-failure-copy.log 2>&1; then
  ok "G-99 启动失败日志说人话（$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g99-failure-copy.log)）"
  grep -q 'FC-10 真 socket' /tmp/g99-failure-copy.log \
    && ok "G-99 反真空：真连不可达端口拿到 ECONNREFUSED（不是从字符串猜的），且 detail.target 不是展示用的 endpoint" \
    || bad "G-99 FC-10 真 socket 证据缺失"
  grep -q 'FC-02 八组负向对照' /tmp/g99-failure-copy.log \
    && ok "G-99 判据有牙：吞 errno / 不提真目标 / 不收敛 / 恢复不清账 / 旧日志形状等八组注入全被抓到" \
    || bad "G-99 负向对照缺失"
else
  bad "G-99 启动日志门（见 /tmp/g99-failure-copy.log；$(tail -3 /tmp/g99-failure-copy.log | tr '\n' ' ')）"
fi

echo "== G-100 桌面端「能启动好」这件事本身有门（DS-01..DS-10）=="
if timeout 120 node scripts/prove_desktop_start.js > /tmp/g100-start.log 2>&1; then
  ok "G-100 启动脚本结构可信（$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g100-start.log)）"
  grep -q 'DS-02 七组负向对照' /tmp/g100-start.log \
    && ok "G-100 判据有牙：不剔变量 / 路径找错 / 不判活 / 走代理 / 无早退 / 静默降级 / 中文变量七组注入全被抓到" \
    || bad "G-100 负向对照缺失"
  grep -q 'DS-05 path.txt 解析落到真可执行文件' /tmp/g100-start.log \
    && ok "G-100 Electron 二进制路径落到真文件（macOS 布局不会找错）" \
    || bad "G-100 二进制路径证据缺失"
else
  bad "G-100 启动门（见 /tmp/g100-start.log；$(tail -3 /tmp/g100-start.log | tr '\n' ' ')）"
fi

echo "== G-101 页面简洁度：主区零输入框 + 二维码真能扫 + 三语齐 =="
# QR 门要调 macOS Vision（Swift 编译较慢），单独给足超时；Swift 不可用时它自己记红，不 SKIP 当绿。
if timeout 500 node scripts/prove_qr_code.js > /tmp/g101-qr.log 2>&1; then
  ok "G-101 二维码能被独立解码器真扫出原文（$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g101-qr.log)）"
else
  bad "G-101 二维码门（见 /tmp/g101-qr.log；$(tail -3 /tmp/g101-qr.log | tr '\n' ' ')）"
fi
if timeout 120 node scripts/prove_ui_simplicity.js > /tmp/g101-ui.log 2>&1; then
  ok "G-101 两个弹窗主区可见输入框 = 0、6 字段进折叠、三语键集合一致（$(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g101-ui.log)）"
  grep -q 'UI-01 移动端远程控制：主区可见输入框 = 0' /tmp/g101-ui.log \
    && grep -q 'UI-02 机器人管理：主区可见输入框 = 0' /tmp/g101-ui.log \
    && ok "G-101 简洁度核心判据成立：不再让用户各种输入去处理" \
    || bad "G-101 简洁度判据缺失"
else
  bad "G-101 UI 简洁度门（见 /tmp/g101-ui.log；$(tail -3 /tmp/g101-ui.log | tr '\n' ' ')）"
fi


if [ "$HAVE_ELECTRON_UI" = "1" ]; then
  g75_xvfb=()
  if ! { [ -n "${DISPLAY:-}" ] && [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; } && command -v xvfb-run >/dev/null 2>&1; then
    g75_xvfb=(xvfb-run -a)
  fi
  pkill -9 -f "dist/[e]lectron" 2>/dev/null
  sleep 1
  timeout 600 ${g75_xvfb[@]+"${g75_xvfb[@]}"} env ELECTRON_DISABLE_SANDBOX=1 node scripts/e2e_remote_progress_stream.mjs > /tmp/g75-remote-stream.log 2>&1
  if grep -q "^e2e_remote_progress_stream: PASS=9 FAIL=0 SKIP=0$" /tmp/g75-remote-stream.log; then
    ok "G-75 真 Electron 远程进度流全绿（9 项，$(tail -1 /tmp/g75-remote-stream.log)）"
  elif grep -q "SKIP=1" /tmp/g75-remote-stream.log; then
    echo "  · skip：$(grep -m1 'SKIP —' /tmp/g75-remote-stream.log || tail -1 /tmp/g75-remote-stream.log)（SKIP ≠ PASS）"
  else
    bad "G-75 e2e_remote_progress_stream（见 /tmp/g75-remote-stream.log；$(tail -1 /tmp/g75-remote-stream.log)）"
  fi
  grep -q "RP-02 配对手机用的那把 bearer" /tmp/g75-remote-stream.log \
    && grep -q "RP-03 手机这一轮的流里" /tmp/g75-remote-stream.log \
    && grep -q "RP-05 断线续订" /tmp/g75-remote-stream.log \
    && ok "G-75 三条命门都在：配对那把 bearer 订得到（不再 401）、手机这一轮真的落 progress、半程拔线带 Last-Event-ID 接上且零重复零缺失" \
    || bad "G-75 RP-02/RP-03/RP-05 锚点缺失（鉴权口径或续订没被断言到）"
  grep -q "RP-06 session 隔离" /tmp/g75-remote-stream.log \
    && grep -q "RP-07 /v1/turn 响应体一字未变" /tmp/g75-remote-stream.log \
    && grep -q "RP-08 对照成立" /tmp/g75-remote-stream.log \
    && ok "G-75 边界也钉住了：指定会话的流里不许有别的会话、/v1/turn 响应体 10 个字段一个没动、零 effect 的纯聊天也有进度" \
    || bad "G-75 RP-06/RP-07/RP-08 锚点缺失"
  grep -q "RP-09 连续第二轮真看得见" /tmp/g75-remote-stream.log \
    && ok "G-75 第二轮也钉住了：不带游标先订、再发回合（Android 的真实顺序），流里只许有本轮帧" \
    || bad "G-75 RP-09 锚点缺失（连续第二轮的可见性没被断言）"
  echo "  · G-75 修复前红（真实输出，三轮分开取的）："
  echo "    RP-02 ✗ 手机那把凭证订不到事件流：401 body={\"ok\":false,\"error\":\"no_devices_registered\"}；"
  echo "    RP-04 ✗ 回合里一个 progress 都没有 …… effects:0（单独回退 main.js 的 onTurn onProgress 后："
  echo "    RP-03 ✗ {\"kinds\":[\"turn_started\",\"turn_ended\"],\"seqs\":[6,7]}、RP-05 ✗ got:2、RP-08 ✗ cats:[]，整门 PASS=4 FAIL=4）"
  echo "    RP-09（本轮第四条，单变量回退：只把 cn_inbound_server.js 的游标默认档 if (!cursorGiven) 改成 if (false)，"
  echo "    其余一字未动）✗ 不带游标的新订阅里出现了上一轮（第二轮起用户就看不见实时进度了） —"
  echo "    {\"id1\":\"desktop-mvzhxg63-k9hp\",\"ids\":[\"desktop-mvzhxg63-k9hp\"],\"frames\":4}，整门 PASS=8 FAIL=1 SKIP=0。"
  echo "    同一条语义在 Node 层也各钉了一次（prove_cn_events_sse EV-9）：单变量回退后"
  echo "    ✗ EV-9 不带游标不许重放订阅之前的历史 — {\"ids\":[1,2,3],\"oldStart\":1,\"oldEnd\":2}，PASS=28 FAIL=1。"
  echo "  · G-75 修复后绿：PASS=9 FAIL=0 —— RP-03 一轮 9 帧 turn_started→7×progress→turn_ended（seq 6→14），"
  echo "    RP-04 progress 7 帧含 tool_activity，RP-05 半程拔断后从 seq=17 接上、合并 4 帧 == 整轮 4 帧、重复 0 缺失 0，"
  echo "    RP-09 不带游标订上后 4 帧全是本轮、首帧 turn_started、progress 2 帧。"
  echo "  · G-75 改了五处产品（都是可选/新增，不动既有契约）：/v1/events 鉴权与 /v1/turn 同构（cn_inbound_server.js）、"
  echo "    /v1/events 可选 ?session_id=（不传时行为一字不变）、/v1/events 不带游标时改为「从队尾起推实况」（要历史请显式带 from_seq，"
  echo "    门禁自己就是这么做的，EV-9/RP-09 的对照档仍在）、桌面 onTurn 补 onProgress（main.js）、"
  echo "    AgentLoop 的 llm 跳与它 dispatch 的真效果发进度（agent_loop_product_wire.js + run_moon_turn.js 传可选字段）。"
  echo "  · G-75 残留（诚实）：① 双写默认关（BITBOT_EVENT_DUAL_WRITE 没开）时这条流仍诚实 503，端上回退整轮 —— 部署侧策略；"
  echo "    ② /v1/turn 回执里的 host_results 不含 AgentLoop 内 dispatch 的工具效果（本门看到 effects:0 而流里有 tool_activity），"
  echo "    属既有响应体口径，按铁律没动，登记在 cross-end-roadmap-a.md；"
  echo "    ③ 跨设备的授权边界（谁能订哪个 session）没做，那是 W3「账号=设备」的活；"
  echo "    ④ 真机（Kotlin/Swift 客户端）侧的可见性：客户端接线由 G-77（AE-01..AE-16 结构门 + 166 条 JVM 单测，其中 9 条是渲染级：帧进 Compose 树、屏幕上有字）证到"
  echo "    「代码在渲染路径上、订阅被回合生命周期驱动、断线边界正确」为止，本门只证服务端到 SSE 帧为止；"
  echo "    手上没有真机（本机无 KVM），「用户真能在手机上看见」仍未被设备级证据确认 —— 见 cross-end-roadmap-a.md R-A1-4b。"
else
  echo "  · skip：缺 playwright-core 或 electron，G-75 未跑（SKIP ≠ PASS）"
fi

echo "== G-76 §5.7 进度链路真回合回归（GP-96/97/98 —— 此前这道门不在矩阵里，导致 AgentLoop 断进度没人发现）=="
if command -v moon >/dev/null 2>&1 || [ -x "$HOME/.moon/bin/moon" ]; then
  timeout 420 node scripts/prove_gp96_progress.js > /tmp/g76-gp96.log 2>&1
  if grep -q "32 passed, 0 failed" /tmp/g76-gp96.log; then
    ok "G-76 GP-96/97/98 全绿（$(grep -c '✓' /tmp/g76-gp96.log) 项，$(tail -1 /tmp/g76-gp96.log)）"
  else
    bad "G-76 prove_gp96_progress（见 /tmp/g76-gp96.log；$(tail -1 /tmp/g76-gp96.log)）"
  fi
  grep -q "纯聊天回合也有进度行" /tmp/g76-gp96.log \
    && grep -q "工具回合（真 effect 边界）成功" /tmp/g76-gp96.log \
    && grep -q "2×N 排序: 3 start + 3 done 一一对应" /tmp/g76-gp96.log \
    && ok "G-76 三条都在：模型跳可见、真工具边界可见、2×N 排序不再被 0 对恒真放过" \
    || bad "G-76 GP-96 锚点缺失"
  echo "  · G-76 为什么现在才接进矩阵（诚实）：这道门 30 条断言一直存在，但矩阵从没跑过它 —— "
  echo "    内核换成 AgentLoop 后，一次真实回合不再产生批量 effects，进度发射器一次都没被喂到，"
  echo "    本地跑出来的真实红是：'GP-97 event count' ✗ 0 rows、'GP-96 2×N 排序: 0 start + 0 done 一一对应' ✓（恒真的绿）、"
  echo "    'GP-96 total consistency' ✗ 空。三处产品接线补上后同一命令变 32 passed, 0 failed。"
  echo "  · G-76 修复的落点：hosts/shared/agent_loop_product_wire.js（llm 跳发 model_reply 的 start/done；"
  echo "    它 dispatch 的 web_fetch/send_mail 把 onProgress 带进 executeHostEffects）、"
  echo "    hosts/shared/run_moon_turn.js（createProductSession 多传 sessionId/onProgress 两个可选字段）。"
  echo "  · G-76 残留（诚实）：AgentLoop 的 Shell 产品工具在这个 wire 里仍是 Host 侧的模拟回执（'[product-shell] …'），"
  echo "    它不走 executeHostEffects ⇒ 没有真效果边界，也就不该有进度行 —— 这条按现状登记，不冒充已交付。"
else
  echo "  · skip：本机没有 moon 内核，G-76 的两段真回合断言跑不了（SKIP ≠ PASS）"
fi

echo "== G-77 A1-4 手机端事件流接线（结构门 AE-01..AE-17 + 15 把注入对照 + 167 条 JVM 单测）=="
if timeout 300 node scripts/prove_android_event_stream.mjs > /tmp/g77-android-sse.log 2>&1 \
   && grep -q "^prove_android_event_stream: PASS=32 FAIL=0$" /tmp/g77-android-sse.log; then
  ok "G-77 Android 事件流结构门全绿（$(tail -1 /tmp/g77-android-sse.log)）"
  grep -q "AE-08 订阅被回合生命周期驱动" /tmp/g77-android-sse.log \
    && grep -q "AE-09 进度真的走到界面" /tmp/g77-android-sse.log \
    && grep -q "AE-13 close() 不在调用线程上拆 socket" /tmp/g77-android-sse.log \
    && grep -q "INJ-AE_08 注入对照有牙" /tmp/g77-android-sse.log \
    && ok "G-77 三条命门都在，且都有牙：订阅真的被 submitTurn 发起/finally 关掉（删掉唯一调用点就翻红）、进度真的传到 ProgressRow（断链就翻红）、close 不拖界面线程（回到在调用线程上关 reader 就翻红）" \
    || bad "G-77 AE-08/AE-09/AE-13 或注入对照锚点缺失（这条门可能是摆设）"
  g77_inj=$(grep -c "注入对照有牙" /tmp/g77-android-sse.log)
  [ "$g77_inj" -ge 15 ] \
    && ok "G-77 注入对照 $g77_inj 把全部有效（每把都是「改坏副本 → 用同一判据重跑」，不是字符串自证）" \
    || bad "G-77 注入对照只有 $g77_inj 把（应 ≥ 15；恒真对照比没对照更危险）"
  echo "  · G-77 上一版门是坏的（本轮实测，不是风格不满）：把 TurnCoordinator 里唯一的"
  echo "    startEventStreamSubscription(machineKind) 调用点删干净、只留方法定义，旧门仍输出"
  echo "    prove_android_event_stream: PASS=12 FAIL=0 —— 而「代码写了但界面上碰不到」正是这门存在的唯一理由。"
  echo "    旧门的三条「注入对照」也只是「替换后的副本里不含那个字符串」，从没拿真判据跑过那份副本。"
  echo "  · G-77 本版第一次跑（对着已写对的产品）报 4 红，其中两条是门的错，都按「改强不改松」修："
  echo "    AE-06 {\"dumpsJson\":true} —— 判据没区分代码与注释，那串 optString(\"row\") 只在说明注释里；"
  echo "    修法是载入时统一剥注释（过时注释同样能把真 bug 撑绿），不是给判据开例外。"
  echo "    AE-09 {\"onCreatePasses\":false} —— 判据把传参钉在 onCreate 体内，实际在 private fun HomeShell() 里；"
  echo "    改成「谁调用 HomeScreen(，谁的函数体里必须同时有数据源和那条传参」，两把注入都能打回红。"
  echo "  · G-77 端上真跑的单测：$(grep -o 'AB-06 JVM 单测真跑：[0-9]* 用例 0 失败' /tmp/g47-build.log | tail -1)（本轮 167，A1-4 新增 EventStreamClientTest 15 + EventStreamMessagesTest 16 + EventStreamUiWiringTest 10；旧版那条恒真「解析测试」已删）"
  echo "  · G-77 修复的产品病（都是真机上会踩的）：① progressUpdate 收 String、coordinator 用 optString(\"row\")"
  echo "    ⇒ 手机上直接把 JSON 吐给用户；② currentLocale 从没被赋值 ⇒ zh-TW/en 文案是死代码，非简体设备上界面仍是简体；"
  echo "    ③ 我在 lifecycle 回调（界面线程）里 reader?.close()，与阻塞中的 SSE readLine() 抢 BufferedReader 读锁 —— "
  echo "    jstack 原文：java.io.BufferedReader.close → ReentrantLock.lock / EventStreamClient\$Subscription.close(EventStreamClient.kt:134)"
  echo "    / TurnCoordinator.stopEventStreamSubscription(TurnCoordinator.kt:248) / MainActivity.onCreate\$lambda\$4(MainActivity.kt:266)；"
  echo "    现改为只置标志 + 摘引用，拆解交守护线程，另加一条真 ServerSocket 的「close 不许阻塞调用线程」用例；"
  echo "    ④ 发送前 awaitStreamReady(3000) 把发送拖住 3 秒（连不上时更久）⇒ 已删等待，代价记为 R-A1-4a（极快回合可能少首帧）。"
  echo "  · G-77 本轮新加的是「帧 → 那一屏」的渲染级证据：EventStreamUiWiringTest 9 条 Robolectric 用例（ES-01..ES-08），"
  echo "    假桌面按服务端逐字形状（id:/event:/data:{seq,sessionId,turnId,kind,payload}）写真 SSE 帧，"
  echo "    再断 Compose 语义树上有那行字：简体「正在执行工具调用」、计数「1/7」、繁体「正在執行工具呼叫」、英文"
  echo "    「Running a tool」各说各的话；回合首尾两行都在；带 session_id=mobile-android；回合后 liveSse==0；"
  echo "    连发 12 帧不丢；503 时回退提示上屏。"
  echo "    单变量回退（唯一改动 = 删 MainActivity HomeShell() 里的 progressLines = progressLines,）真实红原文："
  echo "    tests=\"9\" failures=\"5\"，dump 为 progressLines=[回合开始（由 android 发起）, 1/7 正在执行工具调用] busy=true"
  echo "    假桌面=POST回合=1 SSE连接=1 在线=1 自身故障=无 —— 状态机里有、屏幕上没有；复原后 failures=\"0\"。"
  echo "    结构门同步 AE-16 + INJ-AE_16：把渲染级用例里「屏幕上要有那一行」的断言换成只读内部状态，AE-16 翻红"
  echo "    （PASS=27 → PASS=29，注入 12 → 13 把）。"
  echo "  · G-77 本轮两条「红是自己的错」都留了原文，且都按改强不改松处理：① Robolectric 默认 locale=en-US，"
  echo "    界面是 Running a tool 而我硬期望简体 → 显式钉 locale 并把三语各渲染各的变成断言；② 我的 fixture 帧外壳"
  echo "    写成顶层 turn_id/row，客户端读的是 data.turnId/data.payload → 照 sendEv 重写 frame()，教训写进代码注释。"
  echo "  · G-77 连发 12 帧那条是绿的 ⇒ 今天只有一条写线程，丢更新未被复现；不声称已修，登记为 R-A1-4c。"
  echo "  · G-77 本轮又照出一条真 bug（AE-17 + ES-09）：**回合落的会话与订阅的会话从来不是同一个** —— "
  echo "    TurnBridge 的 POST body 写死 session_id=android-app，订阅按服务端默认规则算出 mobile-android，"
  echo "    而服务端事件流是按会话过滤的（cn_inbound_server.js:1069-1072 → event_log.js:233 那条 SQL），"
  echo "    后果不是「少几帧」而是**一条都收不到**：手机发得出回合、进度那一屏永远是空的。"
  echo "    为什么上一版没照出来：fixture 把帧的 sessionId 写成测试自己的常量，等于把「回合落哪个会话」和"
  echo "    「订哪个会话」糊成同一件事 —— fixture 撑绿真 bug。修法是把假桌面改成照服务端推会话，红原文："
  echo "    tests=\"9\" failures=\"6\"（BUILD FAILED in 2m 21s），dump 一律是 progressLines=[] 假桌面=POST回合=1 "
  echo "    SSE连接=1 在线=1 本轮会话=android-app 订阅会话=mobile-android 被滤掉的帧=4 自身故障=无"
  echo "    （连发那条 被滤掉的帧=13）。修法是两边同源：TurnBridge.sessionFor(machineKind) 一处定义，"
  echo "    POST body、dev runner、订阅都走它；修后 tests=\"10\" failures=\"0\"、全量 167/0、门 32/0。"
  echo "    这条用例自己也有牙：把 TurnBridge 那一行退回写死的 android-app（其余不动）单跑渲染级 → "
  echo "    tests=\"10\" failures=\"7\"，dump 回合=android-app 订阅=mobile-android 被滤掉的帧=4；复原后 167/0。"
  echo "    门的 brittle 也留原文：AE-12 原本钉字面量 \"mobile-\"，产品换成函数后它红了 —— 改钉「值从哪来」，"
  echo "    INJ-AE_17 / INJ-AE_17b 两把注入仍能分别把「写死」与「两边各算一遍」打回红。"
  echo "  · G-77 残留（诚实）：这门只读 Kotlin 源码结构，不跑 Android 逻辑；本机无 KVM/真机，"
  echo "    「用户在真手机上能否看见进度」仍未被设备级证据确认（R-A1-4b）；W3 账号=设备未做，"
  echo "    sessionId 仍是 mobile-<machineKind> 约定值而非真账号会话。"
else
  bad "G-77 prove_android_event_stream（见 /tmp/g77-android-sse.log；$(tail -3 /tmp/g77-android-sse.log | tr '\n' ' ')）"
fi

echo "== G-78 W3 账号=设备（A2-1 配对即登记 / A2-2 热生效 / A2-4 地雷说人话 / A2-3 端上真会签名 + 11 把注入对照）=="
if timeout 900 node scripts/prove_w3_device_trust.mjs > /tmp/g78-w3-device.log 2>&1 \
   && grep -q "^prove_w3_device_trust: PASS=37 FAIL=0$" /tmp/g78-w3-device.log; then
  ok "G-78 W3 设备信任门全绿（$(tail -1 /tmp/g78-w3-device.log)）"
  grep -q "WD-01 配对即登记公钥" /tmp/g78-w3-device.log \
    && grep -q "id 由服务端派发" /tmp/g78-w3-device.log \
    && ok "G-78 A2-1：redeem 带 device_public_key 就登记，且设备 id 由服务端从公钥指纹派生（客户端自报的身份被无视 —— INJ-WD_01 把它照抄回去就翻红）" \
    || bad "G-78 A2-1 锚点缺失（配对即登记没被钉住）"
  grep -q "WD-03 加设备后 ≤30s 热生效" /tmp/g78-w3-device.log \
    && grep -q "WD-04 删设备后 ≤30s 热生效" /tmp/g78-w3-device.log \
    && grep -q "WD-07 配对成功 → 立刻签名下单通过" /tmp/g78-w3-device.log \
    && ok "G-78 A2-2：登记表改盘 ≤30s 生效（实测 2s），且「配对完立刻下单」零等待（自己写的盘必须立刻可见）" \
    || bad "G-78 A2-2 锚点缺失（吊销/登记仍要重启才成立）"
  grep -q "WD-05a 坏公钥被整体拒" /tmp/g78-w3-device.log \
    && grep -q "WD-06 同钥匙幂等" /tmp/g78-w3-device.log \
    && ok "G-78 A2-1 的边界：坏公钥/RSA 公钥整体拒（400，不发 bearer），同钥匙幂等一行、不同钥匙不同身份" \
    || bad "G-78 坏公钥或幂等锚点缺失"
  grep -q "WD-08a /v1/turn 的 401 会说人话" /tmp/g78-w3-device.log \
    && grep -q "WD-08b /v1/events 的 401 也会说人话" /tmp/g78-w3-device.log \
    && ok "G-78 A2-4：登记表非空时 bearer 的 401 带上 error_description / next_step（既有 error 取值一字未改）" \
    || bad "G-78 A2-4 锚点缺失（那颗地雷还是只回一串读不懂的码）"
  g78_inj=$(grep -c "注入对照有牙" /tmp/g78-w3-device.log)
  [ "$g78_inj" -ge 11 ] \
    && ok "G-78 注入对照 $g78_inj 把全部有牙（改坏的是产品副本，门一字不动；补丁对不上也算红）" \
    || bad "G-78 注入对照只有 $g78_inj 把（应 ≥ 11；跳过的对照比没有对照更危险）"
  grep -q "WD-10c 三条 payload 的签名逐字节相同" /tmp/g78-w3-device.log \
    && grep -q "WD-10d 反向对照有牙" /tmp/g78-w3-device.log \
    && grep -q "WD-10e 换 deviceId 验不过" /tmp/g78-w3-device.log \
    && ok "G-78 A2-3 金标：Node 现行 signingPayload 重算的公钥与三条签名，与已提交的端上金标逐字节相同；改一字节 / 换 deviceId 都验不过（INJ-WD_10 把约定里那行 nonce 删掉就翻红）" \
    || bad "G-78 A2-3 金标锚点缺失（跨语言约定没被钉住）"
  grep -q "WD-11a /v1/turn 按「实际要发出去的那串字节」签名并挂头" /tmp/g78-w3-device.log \
    && grep -q "WD-11b 事件流每次连接现签" /tmp/g78-w3-device.log \
    && grep -q "WD-11d redeem 发公钥" /tmp/g78-w3-device.log \
    && ok "G-78 A2-3 接线：回合、事件流、配对三条路真的挂了签名/上行公钥，身份只认服务端派发（INJ-WD_11 少挂一次头就翻红）" \
    || bad "G-78 A2-3 接线锚点缺失（会签的类 ≠ 发出去时真签了）"
  echo "  · G-78 修复前红（真实输出，逐字）：PASS=1 FAIL=9 —— WD-01 'device not found in store after redeem. Response: {\"ok\":true,...}'、"
  echo "    WD-03 'status=401 bad_signature'、WD-04 'device removed from disk but server still accepted signed turn after 31s. Last status: status=200'、"
  echo "    WD-05a 'status=200 ... 表里条数=0'、WD-06 '表里 0 行，应为 2 行'、WD-07 'status=401 {\"ok\":false,\"error\":\"bad_signature\"}'、"
  echo "    WD-08a/b '{\"ok\":false,\"error\":\"unauthorized\"}'。绿的只有 WD-02（反向对照：不带公钥时行为一字未变）。"
  echo "  · G-78 两处「第一版是错的」都留原文：① 重载原设计「先比 mtime、变了才重读」被实测否掉 —— 这块盘上两次写入"
  echo "    落在同一毫秒（statSync 的 mtimeMs 一模一样而文件大小从 26 变 124），WD-03 31s 不翻绿；改成到期就重读，"
  echo "    正确性不押在时钟精度上。② 坏公钥原回 200 + device.registered:false，看着更兼容，实际把失败推后："
  echo "    设备以为配对成功、拿着 bearer 走进「登记表非空 ⇒ 只认设备签名」那条雷；改成 400 整体拒、当场说清原因。"
  echo "  · G-78 门的两次自我修正也留原文：① WD-01 的公钥比对漏了 trim（服务端登记时 trim 是写入规范，"
  echo "    Node 导出的 PEM 结尾带 \\n）⇒ 同一把钥匙两次字符串不同，报 'registered public key should match — mismatch'，"
  echo "    那是门的 bug；修法是两处用同一条归一规则，不是放宽成「查得到就算」。② WD-06 原来先比行数再比 id，"
  echo "    于是「id 不含公钥指纹」这把红在「表里 1 行」上（报的是别的因）；改成先比身份再比行数，"
  echo "    INJ-WD_06a/06b/06c 三把注入各自打回各自的分支。"
  echo "  · G-78 残留（诚实）：服务端与端上的**代码**两侧都钉住了，但「用户在真机上配对一次、看到设备登记上、"
  echo "    之后发消息与看进度都带签名」这一条仍未在真机验证过 —— 本机无 KVM，起不了 emulator。"
  echo "    端上的运行时证据是 Robolectric + 真 ServerSocket（DT 那 7 条：请求真发出去、签名真按发出去的字节签）；"
  echo "    桌面对这些签名的验收证据是本门 WD-01..09（服务端真验）加 WD-10 金标（两边签的是同一串字节）。"
  echo "    三者合起来才等于「真机走通」，任何一条单独拿出来说都不算（登记为 R-A2-1）。"
  echo "    另一处已知代价：bearer 与设备签名**同挂**（桌面版本可能比手机旧，只认 bearer）——"
  echo "    登记表非空时桌面自己忽略 bearer，代价登记为 R-A2-2。"
else
  bad "G-78 prove_w3_device_trust（见 /tmp/g78-w3-device.log；$(tail -3 /tmp/g78-w3-device.log | tr '\n' ' ')）"
fi

echo
echo "== G-102 启动 Electron 必须给 app 路径（少了它弹的是 Electron 默认欢迎页）=="
node scripts/prove_electron_app_path.js >/tmp/g102-app-path.log 2>&1
if [ $? -eq 0 ]; then
  ok "G-102 $(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g102-app-path.log)（$(grep -o '扫到 [0-9]* 处 _electron.launch' /tmp/g102-app-path.log | head -1)）"
else
  bad "G-102 prove_electron_app_path（见 /tmp/g102-app-path.log；$(grep '✗' /tmp/g102-app-path.log | head -2 | tr '\n' ' ')）"
fi
for g102_a in "AP-00" "AP-01" "AP-02" "AP-03" "AP-05" "AP-04"; do
  if grep -q "✓ $g102_a" /tmp/g102-app-path.log; then ok "G-102 锚点：$g102_a"; else bad "G-102 锚点没跑绿：$g102_a"; fi
done
echo "  · G-102 为什么长出来：shot_bind_page.mjs 第一版启动 Electron 只写了 --no-sandbox 这类开关、没给 app 路径，"
echo "    Electron 就把自己的默认欢迎页（「Electron v37… To run a local app」）开出来。截图脚本 goto 之后照样截到图，"
echo "    所以所有门都是绿的 —— 但每跑一次桌面就闪一个默认窗口，脚本被中断时它还留在屏幕上（用户就是这么看到的）。"
echo "  · G-102 判据：Electron 的规则是「第一个不是 -- 开关的参数就是 app 路径」，按这条判，不猜语义；"
echo "    args 整个是变量时回文件找它的赋值再判一次，认不出赋值就如实标「靠跑起来看」，不假装验过。"

echo "== G-103 应用身份：菜单栏/Dock 必须叫 Bit Bot，不是 Electron =="
node scripts/prove_app_identity.js >/tmp/g103-app-identity.log 2>&1
if [ $? -eq 0 ]; then
  ok "G-103 $(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g103-app-identity.log)"
else
  bad "G-103 prove_app_identity（见 /tmp/g103-app-identity.log；$(grep '✗' /tmp/g103-app-identity.log | head -2 | tr '\n' ' ')）"
fi
for g103_a in "ID-01" "ID-03" "ID-04" "ID-04b" "ID-05" "ID-05b" "ID-06" "ID-06b" "ID-08" "ID-10" "ID-10b" "ID-14" "ID-14b" "ID-15" "ID-15b" "ID-16" "ID-16b" "ID-17" "ID-18"; do
  if grep -q "✓ $g103_a" /tmp/g103-app-identity.log; then ok "G-103 锚点：$g103_a"; else bad "G-103 锚点没跑绿：$g103_a"; fi
done
echo "  · G-103 为什么长出来：真机 screencapture 菜单栏第一项写的是 Electron。app.setName() 只管"
echo "    app.getName()/关于面板/⌘Q 条目，菜单栏那一格读的是**进程所在 bundle 的 CFBundleName**，"
echo "    dev 下跑的 Electron.app 永远写 Electron。同一张截图还带出三件事：中文界面配英文菜单、"
echo "    切语言菜单不跟着变（监听器在、渲染端从来不 send）、关于面板版本号是 Electron 的 37.x。"
echo "  · G-103 判据：① dev 应用包 plist 的 CFBundleName/DisplayName/Executable/版本必须等于"
echo "    package.json（真读 plutil，不猜）；② 菜单语言只有 en* 走英文；③ settings:set 收到"
echo "    language 就重建菜单。每条都配一个注入对照（改回旧实现必须判红），ID-10 只扫代码不扫注释。"
echo "  · G-103 后来补的一刀（ID-14..17）：光把包做出「名字对」不够，还得「点得开」。用户从 Finder"
echo "    双击 .app 时 Electron 拿不到 app 路径，开的是自带欢迎页（写着 To run a local app…），"
echo "    窗口标题还叫 Electron。所以包里必须有 Resources/app 指回真实应用目录（ID-14）；"
echo "    又因为这样启动时 app.isPackaged 会变成 true，dev 判定得改成 IS_DEV_BUILD（ID-16），"
echo "    三处行为分支（资源目录 / .env.local / 自动更新）跟着一起改（ID-17）；"
echo "    dev 也不再注册登录项，并把历史遗留的撤掉（ID-15）—— 登录项就是「不带参数拉起」的另一个来源。"

echo "== G-104 身份类文案在真渲染里对不对（含不刷新页面切语言）=="
node scripts/prove_identity_render.mjs >/tmp/g104-identity-render.log 2>&1
if [ $? -eq 0 ]; then
  ok "G-104 $(grep -m1 -o 'RR-0[0-9]' /tmp/g104-identity-render.log | head -1) … 全绿"
else
  bad "G-104 prove_identity_render（见 /tmp/g104-identity-render.log；$(grep '✗' /tmp/g104-identity-render.log | head -2 | tr '\n' ' ')）"
fi
for g104_a in "RR-00" "RR-01" "RR-02" "RR-03" "RR-04" "RR-04b" "RR-05" "RR-06" "RR-06b"; do
  if grep -q "✓ $g104_a" /tmp/g104-identity-render.log; then ok "G-104 锚点：$g104_a"; else bad "G-104 锚点没跑绿：$g104_a"; fi
done
echo "  · G-104 为什么长出来：进度行和内核 step 行是「事件到达时才取词」，静态扫描看不到；"
echo "    设置面板里换语言是**不刷新页面**的，不重刷就会留下上一种语言 —— 真机上「中文界面里"
echo "    挂着一行 Kernel continuing」就是这么来的。G-103 只能证明源码写对了，证明不了这一层。"
echo "  · G-104 判据：埋 window.__noReload 标记，切语言前后都还在 = 真的没刷新，此时的文案变化"
echo "    只能来自重刷；再切回中文，两行必须回来（单方向通过不算）。"

echo "== G-105 头像：一套配色 + 白字读得清（对比度可复算）=="
node scripts/prove_avatar_contrast.js >/tmp/g105-avatar.log 2>&1
if [ $? -eq 0 ]; then
  ok "G-105 $(grep -m1 -o 'PASS=[0-9]* FAIL=[0-9]*' /tmp/g105-avatar.log)（$(grep -o '白字对比度最低 [0-9.]*:1' /tmp/g105-avatar.log | head -1)）"
else
  bad "G-105 prove_avatar_contrast（见 /tmp/g105-avatar.log；$(grep '✗' /tmp/g105-avatar.log | head -2 | tr '\n' ' ')）"
fi
for g105_a in "AC-01" "AC-02" "AC-05" "AC-03" "AC-04" "AC-06" "AC-06b"; do
  if grep -q "✓ $g105_a" /tmp/g105-avatar.log; then ok "G-105 锚点：$g105_a"; else bad "G-105 锚点没跑绿：$g105_a"; fi
done
echo "  · G-105 为什么长出来：用户第一眼说「显示的图标感觉和也奇怪」。当时是六个随机几何字形"
echo "    + 五组随机圆角 + 十个高饱和采样色，一排头像像五个人拼的。改成「品牌 mark / 单字 +"
echo "    正圆 + 统一色调」之后要盯的是**代价**：统一色调靠压亮度，压过头白字就读不清了。"
echo "  · G-105 判据：AC-03 按 WCAG 公式逐色算白字对比度（15px/600 不算 large text，门槛 4.5:1），"
echo "    实测最低 4.53:1；AC-04 拿**未 toned 的采样原色**跑同一个判定，最低只有 2.03:1 ——"
echo "    这条反向对照证明 AC-03 的绿是 tone() 挣来的，不是本来就绿。"

echo "  · 收尾自清：$(purge_gate_fixtures)（本轮矩阵造的 Smoke 夹具不留在用户数据里；异常退出由 EXIT trap 兜）"

echo
echo "smoke_grok_desktop_parity: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
