#!/usr/bin/env bash
# Injectable git CLI mock for Host code_changes commit smoke (BITBOT_GIT_BIN).
# Never talks to a real repo index. Exercises Host add→commit→rev-parse path.
set -euo pipefail
LOG_DIR="${BITBOT_GIT_MOCK_LOG_DIR:-/tmp/bitbot-git-mock}"
mkdir -p "$LOG_DIR"
echo "$*" >>"$LOG_DIR/invocations.log"

cmd="${1:-}"
shift || true

# Stable mock SHA returned only when Host gated BITBOT_CODE_COMMIT=1 reaches rev-parse.
MOCK_SHA="${BITBOT_GIT_MOCK_SHA:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"

if [[ "$cmd" == "add" ]]; then
  printf '%s\n' "$@" >"$LOG_DIR/last-add.txt"
  echo '{"ok":true,"mock":true,"cmd":"add"}' >"$LOG_DIR/last-add.json"
  exit 0
fi

if [[ "$cmd" == "commit" ]]; then
  printf '%s\n' "$@" >"$LOG_DIR/last-commit-args.txt"
  echo "{\"ok\":true,\"mock\":true,\"cmd\":\"commit\",\"sha\":\"$MOCK_SHA\"}" \
    >"$LOG_DIR/last-commit.json"
  echo "[host_git_mock] commit $MOCK_SHA"
  exit 0
fi

if [[ "$cmd" == "rev-parse" ]]; then
  # Host asks for HEAD after gated commit — return mock SHA (never invent in Host JS).
  if [[ "${1:-}" == "HEAD" || "${1:-}" == "--verify" ]]; then
    echo "$MOCK_SHA"
    exit 0
  fi
  echo "$MOCK_SHA"
  exit 0
fi

echo "host_git_mock: unsupported args: $cmd $*" >&2
exit 2
