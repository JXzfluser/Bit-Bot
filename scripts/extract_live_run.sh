#!/usr/bin/env bash
# 把一次真 provider 实跑的隔离根里的**真实产物**提取到 /workspace/output。
# 用法：bash scripts/extract_live_run.sh <隔离根> [输出子目录名]
set -euo pipefail

GR="${1:?用法: extract_live_run.sh <隔离根> [输出子目录名]}"
NAME="${2:-live-run}"
OUT="/workspace/output/$NAME"

if [ ! -d "$GR" ]; then
  echo "找不到隔离根：$GR" >&2
  exit 1
fi

WS="$GR/data/workspace/自媒体内容团队"
if [ ! -d "$WS" ]; then
  echo "隔离根里没有团队工作区：$WS" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"

# 过程档案：每一棒交上来的东西
cp -r "$WS" "$OUT/team-workspace" 2>/dev/null || true

# 成品出口（可直接复制发出的那份）
if [ -d "$WS/05-publish" ]; then
  cp -r "$WS/05-publish" "$OUT/05-publish" 2>/dev/null || true
fi

# 群转录（团队内部对话 → 产出结果的完整过程）
python3 - "$GR" "$OUT" <<'PYEOF'
import json, os, sys
gr, out = sys.argv[1], sys.argv[2]
rooms_path = os.path.join(gr, "data", "desktop", "rooms.json")
try:
    with open(rooms_path, encoding="utf-8") as f:
        d = json.load(f)
except Exception as e:
    print("读 rooms.json 失败：%s" % e)
    sys.exit(0)
rooms = d.get("rooms") or []
os.makedirs(os.path.join(out, "transcript"), exist_ok=True)
for r in rooms:
    title = str(r.get("title") or r.get("id") or "room")
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in title)[:60]
    tx = r.get("transcript") or []
    lines = ["# 群：%s" % title, ""]
    for e in tx:
        kind = e.get("kind") or ""
        who = e.get("name") or e.get("bot") or e.get("role") or ""
        body = e.get("text") or e.get("content") or e.get("error") or ""
        if not isinstance(body, str):
            body = json.dumps(body, ensure_ascii=False)
        lines.append("## [%s] %s" % (kind, who))
        lines.append("")
        lines.append(body.strip())
        lines.append("")
    with open(os.path.join(out, "transcript", safe + ".md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("转录已导出：%s（%d 行）" % (safe, len(tx)))
PYEOF

# 模型调用记录（真实证据：调了多少次、用的什么模型）
if [ -f "$GR/data/llm/chats.jsonl" ]; then
  mkdir -p "$OUT/evidence"
  cp "$GR/data/llm/chats.jsonl" "$OUT/evidence/llm-chats.jsonl" 2>/dev/null || true
  wc -l < "$GR/data/llm/chats.jsonl" | xargs echo "模型调用次数："
fi

echo
echo "产物已提取到：$OUT"
find "$OUT" -type f | sed "s|$OUT|.|" | sort | head -40
