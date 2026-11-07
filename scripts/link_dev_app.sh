#!/usr/bin/env bash
# 把「启动台 / 个人 Applications」里的 Bit Bot 指向仓库里的 dev-app（**软链，不是拷贝**）。
#
# 为什么需要这个脚本：
#   以前桌面上同时躺着三份 Bit Bot —— build/dev-app（软链回仓库，活代码）、
#   dist/mac-arm64（打包产物，代码封在 app.asar 里）、~/Applications 里一份
#   手工拷贝。三份 CFBundleIdentifier 全是 com.bitbot.desktop、名字都叫 Bit Bot、
#   版本都是 0.1.0，图标一模一样。用户点哪份跑哪份，于是出现「改完了怎么没变化」
#   —— 点开的是 10-22 那天的拷贝。
#
#   根治办法不是「记得每次都重新拷一份」，而是这个入口本身不持有代码：软链到
#   build/dev-app/Bit Bot.app，那边 Resources/app 又软链回 hosts/desktop。
#   两层软链，改动永远是最新的，不可能再出现「旧拷贝」。
#
# 用法：
#   bash scripts/link_dev_app.sh          # 建/刷新软链，顺带体检有没有别的副本
#   bash scripts/link_dev_app.sh --check  # 只体检，不动文件
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/hosts/desktop/build/dev-app/Bit Bot.app"
LINK="$HOME/Applications/Bit Bot.app"
MODE="${1:-link}"

if [[ ! -d "$BUNDLE" ]]; then
  echo "error: 没有 $BUNDLE" >&2
  echo "       先跑 bash scripts/make_dev_app_bundle.sh 生成开发包" >&2
  exit 1
fi

# 1) 体检：还有没有别的 Bit Bot 副本（同 bundle id，名字相同）
echo "== 现存的 Bit Bot 副本 =="
found_other=0
while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  real="$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
  if [[ -L "$p" ]]; then
    printf '  软链  %s → %s\n' "$p" "$(readlink "$p")"
    continue
  fi
  case "$real" in
    "$BUNDLE") printf '  开发包 %s（Resources/app 软链回仓库，活代码）\n' "$p" ;;
    *)
      found_other=1
      printf '  旧拷贝 %s  ← 会永远停在拷贝那天的代码，建议删\n' "$p"
      ;;
  esac
done < <(
  {
    [[ -e "$LINK" ]] && echo "$LINK"
    [[ -e "$BUNDLE" ]] && echo "$BUNDLE"
    [[ -e "$ROOT/hosts/desktop/dist/mac-arm64/Bit Bot.app" ]] && echo "$ROOT/hosts/desktop/dist/mac-arm64/Bit Bot.app"
    [[ -e "/Applications/Bit Bot.app" ]] && echo "/Applications/Bit Bot.app"
  } 2>/dev/null || true
)

# 2) 建/刷新软链
if [[ "$MODE" == "--check" ]]; then
  [[ "$found_other" == "0" ]] && echo "== 只有一份，且是活代码 =="
  exit 0
fi

mkdir -p "$HOME/Applications"
if [[ -L "$LINK" ]]; then
  ln -sfn "$BUNDLE" "$LINK"
  echo "== 已刷新软链：$LINK → $BUNDLE"
elif [[ -e "$LINK" ]]; then
  # 真目录：不删（可能是用户手工装的），只提示
  echo "error: $LINK 是一个真实的应用副本，不是软链。" >&2
  echo "       它永远不会跟着仓库更新。确认不要了就 trash 掉再跑一次这个脚本。" >&2
  exit 2
else
  ln -sfn "$BUNDLE" "$LINK"
  echo "== 已建软链：$LINK → $BUNDLE"
fi

echo "== 校验 =="
[[ "$(readlink "$LINK")" == "$BUNDLE" ]] && echo "  ✓ 入口指向开发包"
[[ -f "$BUNDLE/Contents/Resources/app/index.html" ]] && echo "  ✓ 开发包里的代码是软链，读到的是 $(stat -f '%Sm' "$BUNDLE/Contents/Resources/app/index.html") 那一版"
[[ "$found_other" == "0" ]] && echo "  ✓ 机器上没有别的 Bit Bot 拷贝"
