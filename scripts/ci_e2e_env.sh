#!/usr/bin/env bash
# 装「真·用户旅程 e2e」需要的环境。
#
# 缘起（2026-11-21）：这批门禁之前**永远跑不了** —— 三道墙:
#   1. Electron 二进制从 GitHub releases 下不来（网络到不了）
#      ⇒ 走 npmmirror 的二进制镜像
#   2. xvfb / libgtk-3-0 装不上（apt 源不可达）
#      ⇒ 换 Debian 镜像源（deb822 格式在 sources.list.d/debian.sources）
#   3. 门禁把浏览器路径写死 ⇒ CI 上永远 SKIP
#      ⇒ 已在 scripts/lib/browser_env.js 里做成可配置
#
# 用法：bash scripts/ci_e2e_env.sh
# 幂等：已经齐了就不动。
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/hosts/desktop"

echo "== 1/3 Electron 二进制 =="
if [ -x "$DESKTOP_DIR/node_modules/electron/dist/electron" ]; then
  echo "  · 已有，跳过"
else
  echo "  · npm 装 electron + playwright-core"
  (cd "$DESKTOP_DIR" && npm install --no-save --no-audit --no-fund electron@45.4.1 playwright-core)
  echo "  · 补二进制（走 npmmirror 镜像，GitHub releases 到不了）"
  (cd "$DESKTOP_DIR" && ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://registry.npmmirror.com/-/binary/electron/}" node node_modules/electron/install.js)
fi
[ -x "$DESKTOP_DIR/node_modules/electron/dist/electron" ] \
  && echo "  ✅ electron 就位" \
  || echo "  ✗ electron 还是没有（下面会 SKIP，如实说）"

echo "== 2/3 系统库（xvfb / gtk / nss）=="
if command -v xvfb-run >/dev/null 2>&1 && ldd "$DESKTOP_DIR/node_modules/electron/dist/electron" 2>/dev/null | grep -q 'not found'; then
  echo "  · 需要装"
else
  echo "  · 已齐（或不依赖），跳过"
fi
if ! ldd "$DESKTOP_DIR/node_modules/electron/dist/electron" 2>/dev/null | grep -q 'not found'; then
  echo "  ✅ 共享库齐了"
else
  echo "  · 换 Debian 源（deb822 格式）"
  SRC=/etc/apt/sources.list.d/debian.sources
  if [ -f "$SRC" ]; then
    cp -n "$SRC" "$SRC.bak" 2>/dev/null || true
    cat > "$SRC" <<'EOF'
Types: deb
URIs: https://mirrors.aliyun.com/debian
Suites: bookworm bookworm-updates
Components: main contrib non-free non-free-firmware
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg

Types: deb
URIs: https://mirrors.aliyun.com/debian-security
Suites: bookworm-security
Components: main contrib non-free non-free-firmware
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
EOF
    apt-get update -qq && apt-get install -y -qq xvfb libgtk-3-0 libnss3 libasound2 libgbm1
  else
    echo "  · 没有 $SRC,请手工装：apt-get install -y xvfb libgtk-3-0 libnss3 libasound2 libgbm1"
  fi
fi

echo "== 3/3 冒烟 =="
if [ -x "$DESKTOP_DIR/node_modules/electron/dist/electron" ] && command -v xvfb-run >/dev/null 2>&1; then
  export PLAYWRIGHT_CORE_PATH="$DESKTOP_DIR/node_modules/playwright-core"
  export ELECTRON_DISABLE_SANDBOX=1
  timeout 600 xvfb-run -a node "$REPO_ROOT/scripts/e2e_desktop_layout_target.mjs" 2>&1 | tail -3
else
  echo "  · 环境不齐,跳过冒烟（SKIP ≠ PASS）"
fi

echo
echo "环境就绪后,跑这批门：bash scripts/ci_e2e_gates.sh"
