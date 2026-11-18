#!/usr/bin/env bash
# B-1 — package Bit Bot into a BOX: one machine that stays on.
#
# What this is
# ------------
# A Box is a *machine*, not a SaaS account (the user's call): a headless Node
# process that runs the MoonBit kernel and answers turns from other machines
# (a phone, a desktop, 钉钉, 飞书). "The machine stays on" is the premise the
# daily-热点 scenario needs.
#
# The daemon already existed (`hosts/shared/cn_inbound_server.js`); this script
# is the *packaging* job: lay the tree out flat, ship the compiled kernel, and
# write a manifest saying what this machine is.
#
# Layout (flat, mirroring the packaged desktop app):
#
#   <box>/
#     bin/desktop_turn        the MoonBit kernel (native, self-contained)
#     product_surface.js      rooms/bots/transcript store  (root ⇒ host_ffi's
#     room_orchestrator.js     "flat packaged bundle" lookup finds it)
#     secret_protocol.js      token-shape rules
#     progress_protocol.js    progress policy
#     shared/*.js             the Host (one flat dir, no cross-dir requires)
#     data/                   runtime state (created on first run)
#     start.sh
#     manifest.json
#
# The Box holds NO device private keys: `data/host/devices.json` has public
# keys only (B-4a). Other machines prove who they are with their own key.
#
# Usage:
#   bash scripts/pack-box.sh [--out <dir>] [--profile release|debug]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.moon/bin:${PATH}"

OUT=""
PROFILE="${BITBOT_KERNEL_BUILD:-release}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
OUT="${OUT:-$ROOT/hosts/dist/box}"

if ! command -v moon >/dev/null 2>&1; then
  echo "error: moon not found on PATH" >&2
  exit 1
fi

BUILD_FLAGS=()
[[ "$PROFILE" == "release" ]] && BUILD_FLAGS+=(--release)

echo "[pack-box] building the MoonBit kernel (profile=$PROFILE)…"
# 空数组在 set -u + bash 3.2（macOS 自带 / CI mac runner）下会直接 unbound：
# debug profile 时 BUILD_FLAGS 就是空的。与 pack-desktop.sh 同一把尺子。
(cd "$ROOT" && moon build --target native ${BUILD_FLAGS[@]+"${BUILD_FLAGS[@]}"})

KERNEL_SRC="$ROOT/_build/native/$PROFILE/build/cmd/desktop_turn/desktop_turn"
[[ -x "$KERNEL_SRC" ]] || KERNEL_SRC="$ROOT/_build/native/$PROFILE/build/cmd/desktop_turn/desktop_turn.exe"
if [[ ! -f "$KERNEL_SRC" ]]; then
  echo "error: kernel binary not found after build" >&2
  exit 1
fi

echo "[pack-box] staging $OUT…"
rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/shared" "$OUT/data/host"

cp -f "$KERNEL_SRC" "$OUT/bin/desktop_turn"
chmod +x "$OUT/bin/desktop_turn"

# --- shared/ : the Host, one flat dir --------------------------------------
# 例外是 client_core/：fold 的口径在 KP-08 只留了一份（hosts/shared/client_core/reducer.js），
# event_mirror.js 直接 require 它。这张清单以前只会平铺，于是 Box 开机就
# MODULE_NOT_FOUND —— 桌面端有 asar 整目录拷贝看不见这个病，只有 Box 这条扁平链会犯。
# 现在清单允许带子路径的条目，循环自己建目录：包内的相对拼法和仓库里一模一样。
for f in agent_loop_ffi.js agent_loop_product_wire.js agent_loop_stream_stub.js \
         cn_inbound_product_on_turn.js cn_inbound_server.js device_keys.js \
         host_approval_gate.js host_ffi.js p0_security.js room_context.js \
         room_dispatch.js room_discretion.js room_runtime.js run_moon_turn.js \
         tool_policy.js turn_progress.js box_main.js routine_scheduler.js product_surface_ref.js machine_identity.js \
         desktop_pairing.js lan_candidates.js machine_presence.js kernel_server.js event_log.js event_mirror.js event_read_model.js host_env.js \
         effect_kinds.js remote_turn.js \
         client_core/reducer.js; do
  [[ -f "$ROOT/hosts/shared/$f" ]] || { echo "missing shared file: $f" >&2; exit 1; }
  mkdir -p "$(dirname "$OUT/shared/$f")"
  cp -f "$ROOT/hosts/shared/$f" "$OUT/shared/$f"
done

# --- root/ : what the Host looks up one level up (flat bundle) ------------
# 包根 = 仓库 hosts/desktop 的那几个文件：平铺包里 host_ffi.js 用 ../<名字> 就能拿到
# （它找 failure_codes 的顺序是 ../desktop/… → ../../hosts/desktop/… → ../…，
# 平铺只有最后一档命中）。KP-03 尾账把这张码表接进了 Host 的产码路径，清单没跟着加，
# G-57 的闭包当场把它判红 —— 少这张表时 Box 上所有模型失败都只剩 llm_chat_failed，
# cancelled / provider_unconfigured 这些认得出的码在手机上就看不见了。
for f in product_surface.js sessions.js room_orchestrator.js secret_protocol.js progress_protocol.js event_mirror_ref.js failure_codes.js; do
  [[ -f "$ROOT/hosts/desktop/$f" ]] || { echo "missing desktop file: $f" >&2; exit 1; }
  cp -f "$ROOT/hosts/desktop/$f" "$OUT/$f"
done

# --- start.sh -------------------------------------------------------------
cat >"$OUT/start.sh" <<'SH'
#!/usr/bin/env bash
# Start this Box. Everything it needs is inside this directory.
set -euo pipefail
BOX="$(cd "$(dirname "$0")" && pwd)"
export BITBOT_KERNEL_BIN="$BOX/bin/desktop_turn"
export BITBOT_CN_INBOUND_PORT="${BITBOT_CN_INBOUND_PORT:-18765}"
export BITBOT_DEVICES_PATH="${BITBOT_DEVICES_PATH:-$BOX/data/host/devices.json}"
cd "$BOX"
exec node "$BOX/shared/box_main.js"
SH
chmod +x "$OUT/start.sh"

# --- 包内 require 自检 ----------------------------------------------------
# 上面那张允许清单是「人工同步」的：product_surface.js 加了一个
# require("../shared/event_mirror")，清单没跟着加，包照样打完，但 Box 一开机
# 构造 product surface 就抛 Cannot find module —— 手机拉待批只能拿到 503
# approval_queue_unavailable（GP-184 就是这么撞上的）。所以打包收尾把包内每个
# .js 的相对 require 逐个解析一遍：缺文件当场红，别让半台 Box 出厂。
node "$ROOT/scripts/check_box_requires.js" "$OUT"

# --- manifest -------------------------------------------------------------
cat >"$OUT/manifest.json" <<EOF
{
  "v": 1,
  "kind": "bitbot-box",
  "machine_id": "${BITBOT_BOX_MACHINE_ID:-box-local}",
  "machine_name": "${BITBOT_BOX_MACHINE_NAME:-Bit Bot Box}",
  "brain": "cmd/desktop_turn (MoonBit, native binary)",
  "kernel": "bin/desktop_turn",
  "host": "shared/box_main.js",
  "device_registry": "data/host/devices.json (PUBLIC KEYS ONLY)",
  "data_root": "data",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "profile": "$PROFILE",
  "notes": [
    "这台机器没有设备私钥 —— 别的机器用自己的密钥证明身份。",
    "登记设备: node scripts/device-keys.js init --kind mobile --name '我的手机'",
    "没有登记设备时回落共享 turn token(ADR 0008)。",
    "公网可达性(隧道/证书/渠道控制台配置)不在包内。"
  ]
}
EOF

echo "[pack-box] done → $OUT"
echo "[pack-box] start with: bash $OUT/start.sh"
echo "[pack-box] register a device with: node $ROOT/scripts/device-keys.js init --kind mobile --name '我的手机' --out $OUT/data/host/credentials"
