#!/usr/bin/env bash
# 一次性实验脚本（不进 CI）：验证「隔离数据根」到底能不能把内核那一半也关进笼子。
# 问题：KERNEL_CWD = dirname(DATA_ROOT)，而内核会把一部分路径按 cwd 相对写。
# 所以只设 BITBOT_DATA_ROOT 是**半隔离**：Host 写隔离根，内核可能还写真 data/。
# 本实验要回答：把隔离根放在 checkout 内(带 cmd/moon.mod/_build 软链)时，
# 一次真回合之后，落盘的是隔离根还是仓库真 data/。
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="$REPO/.gate-probe"

echo "== 实验前：真 data/ 指纹 =="
BEFORE_BOTS=$(md5sum "$REPO/data/desktop/bots.json" 2>/dev/null | cut -d' ' -f1)
BEFORE_COUNT=$(find "$REPO/data" -type f -newermt '-2 minutes' 2>/dev/null | wc -l)
echo "  bots.json md5 = $BEFORE_BOTS ; 近 2 分钟被改过的真 data 文件数 = $BEFORE_COUNT"

echo "== 铺隔离根 =="
rm -rf "$PROBE"
mkdir -p "$PROBE/data"
for l in cmd moon.mod moon.pkg; do ln -s "$REPO/$l" "$PROBE/$l" 2>/dev/null; done
ln -s "$REPO/_build" "$PROBE/_build" 2>/dev/null
# 拷一份 data/ 骨架（跟 e2e_desktop_creator_pipeline.mjs 同口径：跳 tmp 与 import-backup）
for name in $(ls "$REPO/data" 2>/dev/null); do
  case "$name" in tmp|import-backup-*) continue ;; esac
  cp -r "$REPO/data/$name" "$PROBE/data/" 2>/dev/null
done
echo "  隔离根 = $PROBE/data"

echo "== 跑一次真回合（cwd=$PROBE，BITBOT_DATA_ROOT=$PROBE/data） =="
cd "$PROBE" || exit 1
BITBOT_DATA_ROOT="$PROBE/data" \
BITBOT_KERNEL_BIN="$REPO/_build/native/debug/build/cmd/desktop_turn/desktop_turn.exe" \
  timeout 240 node "$REPO/hosts/cli_host/run_turn.js" "create bot ProbeBot job=probe" 2>&1 | tail -3

echo "== 实验后 =="
AFTER_BOTS=$(md5sum "$REPO/data/desktop/bots.json" 2>/dev/null | cut -d' ' -f1)
AFTER_COUNT=$(find "$REPO/data" -type f -newermt '-3 minutes' 2>/dev/null | wc -l)
PROBE_BOTS=$(md5sum "$PROBE/data/desktop/bots.json" 2>/dev/null | cut -d' ' -f1)
PROBE_BOTS2=$(md5sum "$PROBE/data/desktop/bots.json" 2>/dev/null | cut -d' ' -f1)
echo "  真 data/desktop/bots.json md5 = $AFTER_BOTS (实验前 $BEFORE_BOTS)"
echo "  隔离根 desktop/bots.json md5  = $PROBE_BOTS"
echo "  近 3 分钟被改过的真 data 文件数 = $AFTER_COUNT (实验前 $BEFORE_COUNT)"
echo
if [ "$BEFORE_BOTS" != "$AFTER_BOTS" ] || [ "$AFTER_COUNT" -gt "$BEFORE_COUNT" ]; then
  echo "结论：真 data/ 被改了 ⇒ 半隔离 ⇒ 隔离根必须连内核 cwd 一起关住。"
else
  echo "结论：真 data/ 未变 ⇒ 隔离生效。"
fi
echo "（隔离根留在 $PROBE，人工确认后可删）"
