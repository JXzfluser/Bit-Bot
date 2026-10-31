#!/usr/bin/env bash
# PT — C-1 capability layer gate.
#
# Proves the product-tool path on the PRODUCT path: the compiled kernel
# binary (the artifact a packaged app ships) receives the tool catalog, the
# model asks for a product tool, the kernel dispatches it, and the effect
# comes out of the turn.
#
# It is NOT a model-quality promotion: the provider is a local stub. What it
# proves is that the tool path works — not that a real model would choose
# these tools.
#
# Usage:
#   bash scripts/prove_product_tools.sh
#   BITBOT_KERNEL_BUILD=debug bash scripts/prove_product_tools.sh   # faster
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"

PROFILE="${BITBOT_KERNEL_BUILD:-release}"
FLAGS=()
if [[ "$PROFILE" == "release" ]]; then FLAGS+=(--release); fi

echo "== PT0 build the kernel (profile=$PROFILE) =="
# BITBOT_KERNEL_BUILD!=release 时 FLAGS 是空数组，set -u + bash 3.2 下会 unbound。
if ! moon build --target native ${FLAGS[@]+"${FLAGS[@]}"} >/tmp/pt_build.log 2>&1; then
  echo "FAIL PT0 — kernel build failed"; tail -20 /tmp/pt_build.log; exit 1
fi
BIN_DIR="$ROOT/_build/native/$PROFILE/build/cmd/desktop_turn"
BIN=""
for c in "$BIN_DIR/desktop_turn" "$BIN_DIR/desktop_turn.exe"; do
  [[ -x "$c" ]] && BIN="$c" && break
done
if [[ -z "$BIN" ]]; then
  echo "FAIL PT0 — kernel binary missing under $BIN_DIR"; exit 1
fi
export BITBOT_KERNEL_BIN="$BIN"
echo "ok PT0 — kernel built: ${BIN#$ROOT/}"

echo "== PT1..PT5 product tool path (real kernel binary + stub provider) =="
node "$ROOT/scripts/prove_product_tools.js"
rc=$?
if [ $rc -ne 0 ]; then
  echo "FAIL PT — product tool path did not hold"
  exit 1
fi

echo
echo "== PT summary: the product tool path holds on the shipped kernel =="
exit 0
