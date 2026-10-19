#!/usr/bin/env bash
# Injectable gh CLI mock for Host source_control smoke (BITBOT_GH_BIN).
# Never talks to GitHub. Exercises Host view→create / dry-run / gated create paths.
set -euo pipefail
LOG_DIR="${BITBOT_GH_MOCK_LOG_DIR:-/tmp/bitbot-gh-mock}"
mkdir -p "$LOG_DIR"
echo "$*" >>"$LOG_DIR/invocations.log"

cmd="${1:-}"
sub="${2:-}"
shift || true
shift || true

if [[ "$cmd" == "pr" && "$sub" == "view" ]]; then
  # Force create path by default (no existing PR).
  if [[ "${BITBOT_GH_MOCK_HAS_PR:-}" == "1" ]]; then
    echo '{"url":"https://example.test/pr/1","number":1,"state":"OPEN","title":"mock existing PR"}'
    exit 0
  fi
  echo "no pull requests found for branch" >&2
  exit 1
fi

if [[ "$cmd" == "pr" && "$sub" == "create" ]]; then
  dry=0
  for a in "$@"; do
    if [[ "$a" == "--dry-run" ]]; then dry=1; fi
  done
  if [[ "$dry" == "1" ]]; then
    echo "https://github.com/example/bitbot/pull/new/mock-dry-run"
    echo "Would create draft pull request (dry-run mock)"
    exit 0
  fi
  # Real create rehearsal — Host only reaches here when BITBOT_GH_PR_CREATE=1.
  echo "https://github.com/example/bitbot/pull/9001"
  echo '{"url":"https://github.com/example/bitbot/pull/9001","number":9001,"state":"OPEN","mock":true}' >"$LOG_DIR/last-create.json"
  exit 0
fi

echo "host_gh_mock: unsupported args: $cmd $sub $*" >&2
exit 2
