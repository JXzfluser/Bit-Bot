#!/usr/bin/env bash
# KB — kernel binary equivalence gate.
#
# A packaged Bit Bot ships the COMPILED kernel (desktop_turn) instead of
# requiring a MoonBit toolchain plus a source checkout. That is only safe if
# the binary behaves exactly like `moon run cmd/desktop_turn --target native`.
# This gate proves the equivalence on the product path instead of assuming it.
#
# It is NOT an I promotion and does not claim a packaged build is signed.
# It does not close AR-16 on its own — it proves the one thing that made
# "内核进 bundle" impossible before: the binary is a drop-in.
#
# Usage:
#   bash scripts/prove_kernel_binary.sh
#   BITBOT_KERNEL_BUILD=debug bash scripts/prove_kernel_binary.sh   # faster
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"

PROFILE="${BITBOT_KERNEL_BUILD:-release}"
FLAGS=()
if [[ "$PROFILE" == "release" ]]; then FLAGS+=(--release); fi

pass=0
fail=0
ok()   { printf 'ok %s — %s\n' "$1" "$2"; pass=$((pass+1)); }
bad()  { printf 'FAIL %s — %s\n' "$1" "$2"; fail=$((fail+1)); }

echo "== KB0 build the kernel (profile=$PROFILE) =="
if ! moon build --target native "${FLAGS[@]}" >/tmp/kb_build.log 2>&1; then
  echo "FAIL KB0 — kernel build failed"; tail -20 /tmp/kb_build.log; exit 1
fi
BIN_DIR="$ROOT/_build/native/$PROFILE/build/cmd/desktop_turn"
BIN=""
for c in "$BIN_DIR/desktop_turn" "$BIN_DIR/desktop_turn.exe"; do
  [[ -x "$c" ]] && BIN="$c" && break
done
if [[ -z "$BIN" ]]; then
  echo "FAIL KB0 — kernel binary missing under $BIN_DIR"; exit 1
fi
ok KB0 "kernel built: ${BIN#$ROOT/}"

# The binary must be self-contained: it must not need the source tree.
# We run it from /tmp so that a relative `moon.mod` / `cmd/` lookup would fail.
echo "== KB1 binary is self-contained (runs outside the source tree) =="
out="$(cd /tmp && "$BIN" "ListMachines" 2>/dev/null | head -1)"
if [[ "$out" == *'"v":1'* ]]; then
  ok KB1 "binary answered from /tmp (no source tree needed)"
else
  bad KB1 "binary produced no v:1 JSON outside the repo: ${out:0:160}"
fi

# --- equivalence ---------------------------------------------------------
# Both paths must produce the same product JSON for the same input.
# Volatile fields (turn ids, timestamps, generated ids) are normalised away.
norm() {
  python3 - "$1" <<'PY'
import json, re, sys
raw = open(sys.argv[1], encoding="utf-8").read().strip()
if not raw:
    print("__EMPTY__"); raise SystemExit
try:
    d = json.loads(raw)
except Exception:
    print("__NOTJSON__"); raise SystemExit
def scrub(o):
    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            if k in ("turn_id", "at", "created_at", "updated_at", "task_sig", "session_id"):
                out[k] = "<volatile>"
            else:
                out[k] = scrub(v)
        return out
    if isinstance(o, list):
        return [scrub(x) for x in o]
    if isinstance(o, str):
        return re.sub(r"\b[0-9a-f]{8,}\b", "<id>", o)
    return o
print(json.dumps(scrub(d), sort_keys=True, ensure_ascii=False))
PY
}

i=0
run_case() {
  local label="$1"; shift
  i=$((i+1))
  local a b
  a="$(mktemp)"; b="$(mktemp)"
  # stdin must be closed: turns that need Host FFI block reading the answer
  # line from stdin, and a closed stdin makes the stub answer with its
  # honest "stdin" error instead of hanging forever. Both sides get the
  # same treatment, so the comparison stays apples-to-apples.
  timeout 180 moon run cmd/desktop_turn --target native -- "$@" >"$a" 2>/dev/null </dev/null
  timeout 180 "$BIN" "$@" >"$b" 2>/dev/null </dev/null
  local na nb
  na="$(norm "$a")"; nb="$(norm "$b")"
  rm -f "$a" "$b"
  if [[ "$na" == "$nb" ]]; then
    ok "KB-eq-$i" "$label — moon run == binary"
  elif [[ "$na" == "__EMPTY__" || "$nb" == "__EMPTY__" ]]; then
    bad "KB-eq-$i" "$label — one side produced no output"
  else
    bad "KB-eq-$i" "$label — outputs differ"
    echo "    moon run : ${na:0:240}"
    echo "    binary   : ${nb:0:240}"
  fi
}

echo "== KB2 product-path equivalence (moon run vs compiled binary) =="
run_case "ListMachines"          "ListMachines"
run_case "ios machine context"   --machine-kind ios "ListMachines"
run_case "connectors status"     "list connectors"
run_case "claim inbox"           "claim inbox alpha"
run_case "create routine"        "create routine id=kb-r cron=@daily prompt=ping"
run_case "list routines"         "list routines"
run_case "load skill"            "load skill calendar sync"
run_case "voice start"           "voice start kb1"
run_case "mcp discover"          "mcp discover user-Gmail"

echo "== KB3 host plumbing sees the same kernel contract =="
# The host must be able to point at the binary instead of the toolchain.
node - <<'JS'
const { createTurnRunner } = require("./hosts/shared/run_moon_turn");
const path = require("path");
const fs = require("fs");
const root = path.resolve(".");
const profile = process.env.BITBOT_KERNEL_BUILD || "release";
const dir = path.join(root, "_build", "native", profile, "build", "cmd", "desktop_turn");
const bin = ["desktop_turn", "desktop_turn.exe"].map(n => path.join(dir, n)).find(p => fs.existsSync(p));
if (!bin) { console.log("FAIL KB3 — binary not found for host plumbing check"); process.exit(1); }
const runner = createTurnRunner(root, { kernelBin: bin });
if (!runner || typeof runner.runTurn !== "function") {
  console.log("FAIL KB3 — createTurnRunner did not return a runner"); process.exit(1);
}
console.log("ok KB3 — createTurnRunner accepted kernelBin and exposes runTurn");
JS
if [ $? -eq 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); fi

echo
echo "== KB summary: pass=$pass fail=$fail =="
if [ "$fail" -ne 0 ]; then
  echo "kernel binary equivalence FAILED — do not ship a bundle built on this"
  exit 1
fi
echo "kernel binary is a verified drop-in for 'moon run cmd/desktop_turn --target native'"
exit 0
