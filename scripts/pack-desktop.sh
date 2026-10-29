#!/usr/bin/env bash
# Package Bit Bot Desktop (Electron) WITH the MoonBit kernel.
#
# What changed and why
# --------------------
# The kernel used to stay OUT of the bundle: the app shelled out to
# `moon run cmd/desktop_turn --target native` and therefore needed a MoonBit
# toolchain plus a source checkout on the target machine. On top of that,
# hosts/desktop/main.js probed for `moon.mod.json` (the real file is
# `moon.mod`) and fell back to a hard-coded developer path, so a packaged
# build had no way to find its own brain.
#
# Now we compile the kernel to a self-contained native binary and ship it in
# the app's resources:
#   * `moon build --target native` -> desktop_turn executable
#   * staged to hosts/desktop/resources/kernel/bin/
#   * electron-builder copies it to <resources>/kernel via extraResources
#   * hosts/desktop/paths.js resolves it, and the host runs it directly
#     (identical argv tail + identical BITBOT_FFI stdin/stdout protocol)
#
# Signing: source hosts/dist-signing/DESKTOP_SIGNING.env when BITBOT_DESKTOP_SIGN=1
# (certs still required; default path is unsigned dir for smoke).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$ROOT/hosts/desktop"
RESOURCES="$DESKTOP/resources"
export PATH="${HOME}/.moon/bin:${PATH}"

if ! command -v moon >/dev/null 2>&1; then
  echo "error: moon not found on PATH" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not found" >&2
  exit 1
fi

SIGN_ENV="$ROOT/hosts/dist-signing/DESKTOP_SIGNING.env"
if [[ "${BITBOT_DESKTOP_SIGN:-0}" == "1" && -f "$SIGN_ENV" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$SIGN_ENV"; set +a
  echo "[pack-desktop] BITBOT_DESKTOP_SIGN=1 — signing env loaded (certs must exist)"
else
  echo "[pack-desktop] unsigned pack (set BITBOT_DESKTOP_SIGN=1 + DESKTOP_SIGNING.env for signed)"
fi

# ---------------------------------------------------------------------------
# 0. 抹掉「已定义但为空」的签名 / 公证变量
#
# CI 里写 `CSC_LINK: ${{ secrets.MAC_CSC_LINK }}`，secret 不存在时这个变量仍然
# **被定义了**，值是空字符串。electron-builder 判的是 `cscLink != null`（真值判断
# 在它这里是失效的），于是拿 "" 进 importCertificate()：`path.resolve(currentDir,"")`
# 得到工程目录本身，stat 出来是个 directory，直接抛
#     InvalidConfigurationError: <repo>/hosts/desktop not a file
# —— 报错指向「工程目录不是文件」，和真正的因（没配证书）毫无关系，很容易被误读
# 成 extraResources 路径写错了。空值一律 unset，让它走「无身份 ⇒ 跳过签名」的
# 正常分支（本机手滑 `CSC_LINK=` 也一样受益）。
# ---------------------------------------------------------------------------
for _v in CSC_LINK CSC_KEY_PASSWORD WIN_CSC_LINK CSC_NAME \
          APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  _val="${!_v:-}"
  # 先 trim 再判空：空串和「只有空格/换行」都会触发上面那个假报错。
  if [[ -z "$(printf '%s' "$_val" | tr -d '[:space:]')" ]]; then
    if [[ -n "$_val" ]]; then
      echo "[pack-desktop] $_v is blank — treating as unset"
    fi
    unset "$_v"
  fi
done
unset _v _val

# ---------------------------------------------------------------------------
# 1. Build the kernel
# ---------------------------------------------------------------------------
BUILD_PROFILE="${BITBOT_KERNEL_BUILD:-release}"
BUILD_FLAGS=()
if [[ "$BUILD_PROFILE" == "release" ]]; then
  BUILD_FLAGS+=(--release)
fi

echo "[pack-desktop] building MoonBit kernel (profile=$BUILD_PROFILE)…"
# 展开空数组要加长度判断：macOS 自带 /bin/bash 是 3.2，在 `set -u` 下
# `"${ARR[@]}"` 对空数组会直接 "unbound variable" 退出（bash 4.4+ 才修掉）。
# CI 的 macos runner 上 `shell: bash` 同样是 3.2，所以这个判断两边都要。
build_kernel() {
  if [[ ${#BUILD_FLAGS[@]} -gt 0 ]]; then
    (cd "$ROOT" && moon build --target native "${BUILD_FLAGS[@]}")
  else
    (cd "$ROOT" && moon build --target native)
  fi
}

# AC-T0-3：缺原生工具链时必须「失败并说明原因」，不能只吐一行 error，
# 更不能继续往下产出半成品包。
if ! build_kernel; then
  echo "error: 内核编译失败（profile=$BUILD_PROFILE）—— 不产出半成品包。" >&2
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      echo "  Windows 需要 MSVC 生成工具（cl.exe / link.exe）：" >&2
      echo "    1) 装 Visual Studio Build Tools 2022 → 勾选「使用 C++ 的桌面开发」" >&2
      echo "    2) 从「Developer Command Prompt for VS 2022」里重跑本脚本" >&2
      echo "    3) 验证：\`where cl\` 和 \`where link\` 都要有输出" >&2
      echo "  绕行方案（CI 想绕开原生工具链时再评估）：--target wasm 的内核分支" >&2 ;;
    Darwin)
      echo "  macOS 需要 Xcode 命令行工具：\`xcode-select --install\`，然后 \`clang --version\` 自检" >&2 ;;
    Linux)
      echo "  Linux 需要 cc 链接器：\`sudo apt install build-essential\`（或对应发行版包）" >&2 ;;
  esac
  exit 1
fi

KERNEL_BIN_DIR="$ROOT/_build/native/$BUILD_PROFILE/build/cmd/desktop_turn"
KERNEL_BIN=""
for cand in "$KERNEL_BIN_DIR/desktop_turn" "$KERNEL_BIN_DIR/desktop_turn.exe"; do
  if [[ -x "$cand" ]]; then KERNEL_BIN="$cand"; break; fi
done
if [[ -z "$KERNEL_BIN" ]]; then
  echo "error: 内核编译没报错，但 $KERNEL_BIN_DIR 下没有 desktop_turn(.exe) —— 不产出半成品包。" >&2
  echo "  先确认 profile：BITBOT_KERNEL_BUILD=$BUILD_PROFILE（另一档是 debug），" >&2
  echo "  再确认产物目录：ls _build/native/$BUILD_PROFILE/build/cmd/desktop_turn" >&2
  echo "  若目录整体不存在，说明 moon 没为 native 目标产出可执行件（工具链/版本问题），" >&2
  echo "  用 \`moon build --target native --info\` 看真实报错。" >&2
  exit 1
fi
echo "[pack-desktop] kernel binary: $KERNEL_BIN"

# ---------------------------------------------------------------------------
# 2. Smoke the kernel before shipping it
#    A kernel that cannot answer a trivial turn must not reach a user.
# ---------------------------------------------------------------------------
echo "[pack-desktop] kernel smoke…"
KERNEL_SMOKE="$(
  "$KERNEL_BIN" "ListMachines" 2>/dev/null | head -1 || true
)"
if [[ -z "$KERNEL_SMOKE" ]]; then
  echo "error: kernel smoke produced no output" >&2
  exit 1
fi
case "$KERNEL_SMOKE" in
  *'"v":1'*) echo "[pack-desktop] kernel smoke OK (v:1 JSON)" ;;
  *)
    echo "error: kernel smoke output is not v:1 JSON: ${KERNEL_SMOKE:0:200}" >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# 3. Stage into the app resources
#
# 文件名必须是 `desktop_turn`（Windows 上 `desktop_turn.exe`）：hosts/desktop/
# paths.js 的 resolveKernelBin 只认这两个 rel 路径。以前这里写的是
# `desktop_turn${KERNEL_BIN##*.}` —— moon 在 macOS 上产出的可执行文件叫
# `desktop_turn.exe`（后缀不是"Windows 专属"，moon 一律加），于是
# `${X##*.}` 取出 "exe"、拼成 `desktop_turnexe`，两个 rel 都不匹配：包里有内核，
# 但 app 找不到它，最后回退到 `moon run` —— 用户机器上根本没有 moon。
# ---------------------------------------------------------------------------
rm -rf "$RESOURCES/kernel"
mkdir -p "$RESOURCES/kernel/bin"
KERNEL_NAME="desktop_turn"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) KERNEL_NAME="desktop_turn.exe" ;;
esac
cp "$KERNEL_BIN" "$RESOURCES/kernel/bin/$KERNEL_NAME"
chmod +x "$RESOURCES/kernel/bin/$KERNEL_NAME"
echo "[pack-desktop] staged as bin/$KERNEL_NAME"

# The kernel resolves `data/...` relative to its cwd, which the host sets to
# the parent of the data root. Nothing else from the source tree is needed at
# runtime, so we deliberately do NOT ship moon.mod / cmd/ / the package dirs:
# shipping them would imply a toolchain is present, and it is not.
#
# 这里用「不加引号的 heredoc」直接展开变量，不再 `cat` 出一份占位符再 sed 替换。
# 原写法 `sed -i "s/…/" file` 在 BSD sed（GitHub macOS runner 就是）上会失败：
# BSD 把 s/…/ 当成 -i 的备份后缀，于是 file 被当作脚本、没有文件操作数，
# 报 "sed: -I or -i may not be used with stdin"。本机 sed 是 toybox，恰好接受
# GNU 写法，所以这个错只会在 CI 上现形 —— 干脆不用 sed。
cat > "$RESOURCES/kernel/README.txt" <<TXT
Bit Bot — bundled MoonBit kernel
===============================
bin/${KERNEL_NAME} is the compiled product brain.

It is a drop-in replacement for:
    moon run cmd/desktop_turn --target native -- <args>

Same argv tail, same stdout/stdin FFI line protocol:
  kernel writes  BITBOT_FFI <json>  to stdout
  host answers   one JSON line      on stdin

No MoonBit toolchain and no source tree are required at runtime.
Built on: $(uname -srm)
Profile: ${BUILD_PROFILE}
TXT

echo "[pack-desktop] staged kernel resources:"
ls -la "$RESOURCES/kernel/bin/"

# ---------------------------------------------------------------------------
# 4. Package the app
#
#   BITBOT_PACK_TARGET=dir   (默认) electron-builder --dir → dist/mac-*/…app
#                            只够本机冒烟，不能分发。
#   BITBOT_PACK_TARGET=dist  按 package.json 的 mac/win/linux target 出可分发物
#                            (mac: dmg + zip + latest-mac.yml)。CI 走这条。
#   BITBOT_PACK_ARCH          arm64 | x64 | 空(宿主架构)。CI 的 mac matrix 用它。
#   BITBOT_PACK_PLATFORM      mac | win | linux | 空(宿主平台)
#
# 为什么不在 CI 里另写一遍 electron-builder 调用：这一段的顺序（先 stage 内核再
# 打包）就是「包里必须有大脑」的保证，复制一份迟早漂移 —— 内核全白打就白打。
# ---------------------------------------------------------------------------
cd "$DESKTOP"
if [[ ! -d node_modules/electron ]]; then
  npm install
fi
if [[ ! -d node_modules/electron-builder ]]; then
  npm install --save-dev electron-builder@^25.1.8
fi

PACK_TARGET="${BITBOT_PACK_TARGET:-dir}"
EB_ARGS=()
if [[ -n "${BITBOT_PACK_PLATFORM:-}" ]]; then
  EB_ARGS+=("--${BITBOT_PACK_PLATFORM}")
fi
if [[ -n "${BITBOT_PACK_ARCH:-}" ]]; then
  EB_ARGS+=("--${BITBOT_PACK_ARCH}")
fi

if [[ "$PACK_TARGET" == "dist" ]]; then
  # --publish never: publish.url 是个占位域名，CI 不该去连它。
  echo "[pack-desktop] building distributable (target=dist, args: ${EB_ARGS[*]:-host defaults})…"
  if [[ ${#EB_ARGS[@]} -gt 0 ]]; then
    npx electron-builder "${EB_ARGS[@]}" --publish never
  else
    npx electron-builder --publish never
  fi
  echo "[pack-desktop] distributables under hosts/desktop/dist/"
  ls -la "$DESKTOP/dist" || true
  # T0-03 门禁：体积棘轮 + 内核真在包内 + 包内内核真能跑 + 语言包真被裁过。
  # 放在证据之前——门禁红的这一轮不该留下一份「看起来成功」的 evidence。
  echo "[pack-desktop] artifact gate…"
  node "$ROOT/scripts/prove_pack_artifacts.mjs"
else
  echo "[pack-desktop] building unpackaged dir via electron-builder…"
  npm run pack
  echo "[pack-desktop] output under hosts/desktop/dist/"
fi

# ---------------------------------------------------------------------------
# 5. Evidence (no secrets)
# ---------------------------------------------------------------------------
mkdir -p "$ROOT/data/tmp"
export BITBOT_PACK_TARGET_USED="$PACK_TARGET"
export BITBOT_PACK_ARCH_USED="${BITBOT_PACK_ARCH:-$(uname -m)}"
python3 - <<PY
import json, os, pathlib
root = pathlib.Path("$ROOT")
dist = root / "hosts" / "desktop" / "dist"
res = root / "hosts" / "desktop" / "resources" / "kernel"
entries = []
if dist.exists():
    for p in sorted(dist.rglob("*")):
        if p.is_file():
            entries.append({"path": str(p.relative_to(dist)), "bytes": p.stat().st_size})
kernel = []
if res.exists():
    for p in sorted(res.rglob("*")):
        if p.is_file():
            kernel.append({"path": str(p.relative_to(res)), "bytes": p.stat().st_size})
out = {
    "ok": dist.exists(),
    "signed": os.environ.get("BITBOT_DESKTOP_SIGN") == "1",
    "entries": entries[:40],
    "entry_count": len(entries),
    "kernel_bundled": bool(kernel),
    "kernel_files": kernel,
    "kernel_profile": "$BUILD_PROFILE",
    "pack_target": os.environ.get("BITBOT_PACK_TARGET_USED", "dir"),
    "pack_arch": os.environ.get("BITBOT_PACK_ARCH_USED", ""),
    # dist 里出现 dmg/zip 才算「可分发物」，--dir 只有 app 目录。
    "distributables": [
        e["path"] for e in entries
        if e["path"].endswith((".dmg", ".zip", ".exe", ".AppImage"))
    ],
    "note": "kernel shipped as a compiled native binary; no toolchain needed at runtime. "
            "store signing residual until CSC_LINK / Apple notarize creds present",
}
path = root / "data" / "tmp" / "desktop-pack-evidence.json"
path.write_text(json.dumps(out, indent=2) + "\n")
print("[pack-desktop] evidence", path, "entries", len(entries), "kernel_bundled", out["kernel_bundled"])
PY
