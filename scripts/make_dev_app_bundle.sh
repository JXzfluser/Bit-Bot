#!/usr/bin/env bash
# make_dev_app_bundle.sh — 给开发态造一个「身份是 Bit Bot」的 macOS 应用包。
#
# 为什么必须造：
#   `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .` 这条启动
#   路径能跑，但 macOS 菜单栏第一项、Dock 名称、⌘Q 里的应用名吃的是**进程所在
#   bundle 的 CFBundleName**，不是 `app.setName()`。main.js 顶层已经 set 过
#   `app.setName("Bit Bot")`（app.getName() 返回 Bit Bot，About 面板也对），
#   可菜单栏还是写 Electron —— 因为它读的是 Electron.app 的 Info.plist。
#   实测（2026-11-07，screencapture 菜单栏 0,0,1200,32）：
#     Electron.app 直接跑        → 菜单栏 "Electron Edit View Window Help"
#     本脚本产出的 Bit Bot.app   → 菜单栏 "Bit Bot File Edit View Window Help"
#   打包后的 dist/mac-arm64/Bit Bot.app 本来就没这个问题（electron-builder 写
#   productName），所以这脚本补的只是「开发/自测这条启动路径」。
#
# 做法（不碰 node_modules，全部写到 build/dev-app/，可随时 rm）：
#   ① ditto 整包复制 Electron.app（cp -R 在本机会在 default_app.asar 上撞
#      "Operation not permitted"，ditto 不会）；
#   ② PlistBuddy 改 6 个键：CFBundleName / CFBundleDisplayName /
#      CFBundleIdentifier / CFBundleExecutable / CFBundleShortVersionString /
#      CFBundleVersion —— 名字与版本都取 hosts/desktop/package.json（唯一真相）；
#   ③ 可执行文件同步改名（CFBundleExecutable 指谁，MacOS/ 下就得是谁）；
#   ④ 写完**读回来自检**，读不回期望值就算失败，不留一个半改的包。
#
# 不重签名：`codesign -dv` 显示官方 Electron.app 是 adhoc + "Info.plist=not
# bound" + "Sealed Resources=none"，即 Info.plist 不在签名封条里，改它不破坏签名。
# 实测改完能正常启动（本机 arm64）。
#
# 助手进程（Electron Helper (Renderer) 等）保留原名：改名要连它们自己的
# Info.plist 与 Framework 内部引用一起动，收益只是活动监视器里那一行，风险
# 是起不来。这一条写在 docs/design/desktop-target/report.md 的残留里。
#
# 用法：
#   bash scripts/make_dev_app_bundle.sh          # 幂等；已最新就秒回
#   bash scripts/make_dev_app_bundle.sh --force  # 强制重建
# 输出最后一行固定是 `DEV_APP=<路径>`，给 start-desktop.sh 取。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/hosts/desktop"
SRC="$DESKTOP/node_modules/electron/dist/Electron.app"
OUTDIR="$DESKTOP/build/dev-app"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[dev-app] 非 macOS：菜单栏身份由窗口管理器决定，本脚本不适用"
  exit 0
fi
if [[ ! -d "$SRC" ]]; then
  echo "error: 找不到 $SRC（先在 hosts/desktop 跑 npm install）" >&2
  exit 1
fi
if [[ ! -x /usr/libexec/PlistBuddy ]]; then
  echo "error: 没有 /usr/libexec/PlistBuddy（macOS 自带，缺失说明环境异常）" >&2
  exit 1
fi

# 三项都进 stamp：换 Electron 版本 / 改产品名 / 升版本号，任一变化就重建。
ELECTRON_VER="$(cd "$DESKTOP" && node -p "require('./node_modules/electron/package.json').version")"
PRODUCT="$(cd "$DESKTOP" && node -p "require('./package.json').productName || 'Bit Bot'")"
VERSION="$(cd "$DESKTOP" && node -p "require('./package.json').version")"
BUNDLE_ID="$(cd "$DESKTOP" && node -p "(require('./package.json').build||{}).appId || 'com.bitbot.desktop'")"
STAMP="electron=$ELECTRON_VER|product=$PRODUCT|version=$VERSION|id=$BUNDLE_ID"

APP="$OUTDIR/$PRODUCT.app"
EXE="$APP/Contents/MacOS/$PRODUCT"

if [[ "$FORCE" == "0" && -f "$OUTDIR/.stamp" && -x "$EXE" ]] \
   && [[ "$(cat "$OUTDIR/.stamp")" == "$STAMP" ]]; then
  echo "[dev-app] 已最新（${STAMP}）"
  echo "DEV_APP=$APP"
  exit 0
fi

# 中文全角括号紧邻变量时 bash 会把多字节首字节吃进变量名（实测报
# "VERSION?: unbound variable"），所以变量一律写 ${VAR}。
echo "[dev-app] 重建 ${PRODUCT}.app（electron ${ELECTRON_VER} / ${VERSION}）"
rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"
ditto "$SRC" "$APP"

P="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $PRODUCT" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $PRODUCT" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $PRODUCT" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$P"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$P"
mv "$APP/Contents/MacOS/Electron" "$EXE"

# 自检：PlistBuddy 的 Set 在键不存在时是 Add，键名拼错就静默多一个键，
# 所以这里逐项读回来对，不对就整体失败（不留下一个「看起来建好了」的包）。
fail=0
check() {
  local key="$1" want="$2" got
  got="$(/usr/libexec/PlistBuddy -c "Print :$key" "$P" 2>/dev/null || echo '<missing>')"
  if [[ "$got" != "$want" ]]; then
    echo "  ✗ $key 期望「$want」实际「$got」" >&2
    fail=1
  else
    echo "  ✓ $key = $got"
  fi
}
check CFBundleName "$PRODUCT"
check CFBundleDisplayName "$PRODUCT"
check CFBundleIdentifier "$BUNDLE_ID"
check CFBundleExecutable "$PRODUCT"
check CFBundleShortVersionString "$VERSION"
[[ -x "$EXE" ]] && echo "  ✓ 可执行文件 MacOS/$PRODUCT" || { echo "  ✗ 缺可执行文件" >&2; fail=1; }

if [[ "$fail" != "0" ]]; then
  echo "error: 应用包自检失败，删掉重来" >&2
  rm -rf "$OUTDIR"
  exit 1
fi

printf '%s' "$STAMP" > "$OUTDIR/.stamp"
echo "DEV_APP=$APP"
