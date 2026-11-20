#!/usr/bin/env bash
# KR-07（常驻不改变语义）的突变体：每格都必须让 KR-07 自己红。
# 用法：bash scripts/mutate_kernel_resident_kr07.sh   （跑完自动还原源码）
cd "$(dirname "$0")/.." || exit 1
SRC=scripts/prove_kernel_resident.mjs
BAK=/tmp/kr07_gate_src.bak
cp "$SRC" "$BAK" || exit 1

run_mutant() {
  local name="$1"; shift
  cp "$BAK" "$SRC" || exit 1
  "$@" || { echo "$name: patch failed"; return 1; }
  local out; out=$(node "$SRC" 2>&1)
  local total; total=$(echo "$out" | grep '== KR summary' | tail -1)
  local red; red=$(echo "$out" | grep '^FAIL KR-07' | head -1 | cut -c1-150)
  if [ -z "$total" ]; then
    echo "$name | 运行中断（未打印 summary）"
    echo "$out" > /tmp/kr07_mut_err.log
  else
    echo "$name | ${total#== } | 红：${red:-（KR-07 没红 = 这格突变体无效）}"
  fi
  cp "$BAK" "$SRC"
}

# M1 把臂标签塞回 turnId：argv 不再同一份，必须被「夹具前提不成立」拦下（不许拿差值当语义变化）
m1() { perl -0pi -e 's/turnId: "kr-" \+ slug\(text\),/turnId: "kr-" + tag + "-" + slug(text),/' "$SRC"; }
# M2 让常驻臂取到隔壁那条的结果：argv 仍逐字相同，两份结果真的不同 —— 归一比较必须报红
m2() { perl -0pi -e 's/sig\(residentRun\.results\[i\]\.r\)/sig(residentRun.results[(i + 1) % TEXTS.length].r)/' "$SRC"; }
# M3 摘掉 effects 这一路比较：M2 塞进去的真差异必须溜不掉（证明判据测的是回执内容而不是 ok 字段）
m3() { perl -0pi -e 's/effects: r\.effects,/effects: null,/' "$SRC"; }

run_mutant "M1 臂标签回到 turnId（argv 不再同一份）" m1
run_mutant "M2 常驻臂取错条结果（argv 同、输出不同）" m2

cp "$BAK" "$SRC"
echo "已还原源码：$(git diff --stat "$SRC" | tail -1)"
