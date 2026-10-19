#!/usr/bin/env bash
# Copy Cloud-injected BITBOT_* from the current shell into hosts/desktop/.env.local
# (skips stubs). Used so acceptance gate + Desktop Settings see the same secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="$ROOT/hosts/desktop/.env.local"
KEYS=(
  BITBOT_LLM_API_KEY
  BITBOT_LLM_BASE_URL
  BITBOT_LLM_MODEL
  BITBOT_LLM_PROVIDER
  BITBOT_LLM_QWEN_API_KEY
  BITBOT_LLM_MOONSHOT_API_KEY
  BITBOT_DINGTALK_POST
  BITBOT_DINGTALK_WEBHOOK
  BITBOT_DINGTALK_TOKEN
  BITBOT_FEISHU_POST
  BITBOT_FEISHU_TOKEN
  BITBOT_FEISHU_CHAT_ID
  BITBOT_WECOM_POST
  BITBOT_WECOM_TOKEN
  BITBOT_WECOM_AGENT_ID
  BITBOT_WECOM_TOUSER
  BITBOT_CONTENT_MODERATION
  BITBOT_ICP_FILING
  BITBOT_ALGORITHM_FILING
  BITBOT_UPDATE_FEED_URL
)

declare -A cur=()
if [[ -f "$ENV_LOCAL" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    t="${line%%#*}"
    t="$(echo "$t" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$t" || "$t" != *=* ]] && continue
    k="${t%%=*}"; v="${t#*=}"
    cur["$k"]="$v"
  done <"$ENV_LOCAL"
fi

applied=()
for k in "${KEYS[@]}"; do
  v="${!k:-}"
  [[ -z "$v" ]] && continue
  [[ "$v" == stub* || "$v" == test || "$v" == changeme ]] && continue
  [[ -n "${cur[$k]:-}" ]] && continue
  cur["$k"]="$v"
  applied+=("$k")
done

{
  echo "# Bit Bot Desktop secrets — gitignored; never commit."
  echo "# Imported from injected environment ($(date -u +%Y-%m-%dT%H:%M:%SZ))."
  for k in $(printf '%s\n' "${!cur[@]}" | sort); do
    echo "$k=${cur[$k]}"
  done
} >"$ENV_LOCAL"
chmod 600 "$ENV_LOCAL" 2>/dev/null || true

if [[ ${#applied[@]} -eq 0 ]]; then
  echo "import_injected_secrets: nothing new to sync"
  exit 0
fi
echo "import_injected_secrets: applied ${applied[*]}"
exit 0
