#!/usr/bin/env bash
# Run every scripts/prove_* gate in a tree and print a stable one-line summary
# per gate, so two trees can be diffed for regressions.
#
# Resumable: gates already recorded in the output file are skipped, so a run
# interrupted by the sandbox can be continued without redoing the work.
#   bash scripts/prove_all.sh [output-file]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT}/scripts/lib/timeout_polyfill.sh"
cd "$ROOT"
export PATH="${HOME}/.moon/bin:${PATH}"
export BITBOT_KERNEL_BUILD="${BITBOT_KERNEL_BUILD:-debug}"

# A gate that is interrupted can leave its provider stub alive, holding the
# port. The next gate then fails with "stub not ready in 8s" and looks like a
# regression when it is not. Clean up whatever this run leaves behind.
cleanup_stubs() {
  pkill -f "dev_stubs/openai_compat_stub.js" >/dev/null 2>&1 || true
}
trap cleanup_stubs EXIT INT TERM

OUT="${1:-}"
if [[ -z "$OUT" ]]; then
  # No explicit path: use a fresh, tree-scoped file so a run NEVER inherits the
  # green results of an earlier run. The old default was a fixed
  # /tmp/prove_out.txt, so a previous run — possibly from another machine, another
  # checkout, or another code state — left "rc=0" lines behind and the next run
  # skipped those gates and reported green without ever executing them.
  OUT="$(mktemp "/tmp/prove_out.$(printf '%s' "$ROOT" | shasum | cut -c1-8).XXXXXX")"
  : >"$OUT"
else
  # Explicit path: keep the documented resumable behaviour, but only for the
  # SAME tree. A result file carried over from a different checkout describes a
  # different codebase, so inheriting it is exactly the false-green bug.
  header="# tree: $ROOT"
  existing="$(head -n 1 "$OUT" 2>/dev/null || true)"
  if [[ -f "$OUT" && -n "$existing" && "$existing" != "$header" ]]; then
    echo "prove_all: result file $OUT belongs to a different tree; starting fresh" >&2
    : >"$OUT"
  fi
fi

# The header must be the FIRST line, because that is what identifies the file's
# owning tree. Do not clobber it on a resumed run — that would wipe the results
# we are about to resume from.
header="# tree: $ROOT"
existing="$(head -n 1 "$OUT" 2>/dev/null || true)"
if [[ "$existing" != "$header" ]]; then
  printf '%s\n' "$header" >"$OUT"
fi

for f in scripts/prove_*; do
  [[ -f "$f" ]] || continue
  # Never recurse into this runner: it matches its own glob.
  [[ "$f" == "scripts/prove_all.sh" ]] && continue
  base="$(basename "$f")"
  if grep -qF "$base " "$OUT" 2>/dev/null; then
    continue
  fi
  case "$f" in
    *.sh)  runner=(bash "$f") ;;
    *.js|*.mjs) runner=(node "$f") ;;
    *) continue ;;
  esac
  out="$(timeout 600 "${runner[@]}" 2>&1)"
  rc=$?
  summary="$(printf '%s\n' "$out" | grep -oE 'pass=[0-9]+ fail=[0-9]+' | tail -1)"
  if [[ -z "$summary" ]]; then
    summary="$(printf '%s\n' "$out" | grep -ciE '^FAIL ' | sed 's/^/fails=/')"
  fi
  printf '%-46s rc=%-3s %s\n' "$base" "$rc" "$summary" | tee -a "$OUT"
done
