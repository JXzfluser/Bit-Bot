#!/usr/bin/env bash
# 对 #83/#84 墙钟死线 + 前缀续折 跑突变体：每个突变体必须至少让一条新判据红。
cd "$(dirname "$0")/.." || exit 1
SRC=hosts/shared/event_read_model.js
BAK=/tmp/rm_deadline_src.bak
cp "$SRC" "$BAK" || exit 1

run_mutant() {
  local name="$1"
  shift
  cp "$BAK" "$SRC" || exit 1
  "$@" || { echo "$name: patch failed"; return 1; }
  local out
  out=$(node scripts/prove_event_read_model.mjs 2>&1)
  local total
  total=$(echo "$out" | grep 'PASS=' | tail -1)
  local reds
  reds=$(echo "$out" | grep '^FAIL' | awk '{print $2}' | sort -u | tr '\n' ' ')
  if [ -z "$total" ]; then
    echo "$name | 运行中断（见 /tmp/mut_err.log） | 红项: ${reds:-（无）}"
    echo "$out" > /tmp/mut_err.log
  else
    echo "$name | $total | 红项: ${reds:-（无）}"
  fi
  cp "$BAK" "$SRC"
}

# 活锁突变体：截断前缀只在「游标比上次落盘点至少多 stride 行」时才落盘。
# 每趟只折得动 <stride 行时，游标永远不推进 = 活锁。
p1() { perl -0pi -e 's/if \(prefix && result\.cursor > slot\.persistedSeq &&/if (prefix \&\& result.cursor - slot.persistedSeq >= CHECKPOINT_STRIDE \&\&/' "$SRC"; }
p2() { perl -0pi -e 's/saveCheckpoint\(file, result\.cursor, prefix\)/saveCheckpoint(file, lastSeq, prefix)/' "$SRC"; }
p3() { perl -0pi -e 's/if \(result\.truncated\) \{/if (result.truncated \&\& false) {/' "$SRC"; }
p4() { perl -0pi -e 's/if \(deadline > 0 && elapsed\(\) >= deadline\)/if (false \&\& deadline > 0 \&\& elapsed() >= deadline)/' "$SRC"; }
p5() { perl -0pi -e 's/const FOLD_DEADLINE_MS = 250;/const FOLD_DEADLINE_MS = 0.001;/' "$SRC"; }

run_mutant "P1 截断前缀按 stride 才落盘（活锁）" p1
run_mutant "P2 截断前缀记到库 lastSeq（#83 原洞）" p2
run_mutant "P3 截断当看完（返回 ok:true）" p3
run_mutant "P4 墙钟护栏整个摘掉" p4
run_mutant "P5 默认死线调成 0.001ms（咬在日常量级）" p5

cp "$BAK" "$SRC"
echo "已还原源码：$(git diff --stat "$SRC" | tail -1)"
