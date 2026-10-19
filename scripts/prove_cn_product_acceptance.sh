#!/usr/bin/env bash
# Honest product acceptance gate for CN multi-end goal.
# Exits non-zero unless 真窗口/真模型/真渠道 residuals are closed.
# Never treats matrix U/I PASS, stubs, or draft channels as completion.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0
pass=0
note() { printf '%s\n' "$*"; }
ok() { pass=$((pass + 1)); note "PASS  $*"; }
bad() { fail=$((fail + 1)); note "FAIL  $*"; }

# Load Desktop secrets the same way the product Host does.
ENV_LOCAL="$ROOT/hosts/desktop/.env.local"
if [[ -f "$ENV_LOCAL" ]]; then
  # shellcheck disable=SC1090
  set -a
  # Parse KEY=VALUE without sourcing arbitrary shell.
  while IFS= read -r line || [[ -n "$line" ]]; do
    t="${line%%#*}"
    t="$(echo "$t" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$t" ]] && continue
    [[ "$t" != *=* ]] && continue
    k="${t%%=*}"
    v="${t#*=}"
    export "$k=$v"
  done <"$ENV_LOCAL"
  set +a
fi

note "== Bit Bot CN product acceptance (honest) =="

# P1 Desktop window path exists
if [[ -f "$ROOT/hosts/desktop/main.js" && -f "$ROOT/hosts/desktop/index.html" ]]; then
  ok "Desktop Electron shell present"
else
  bad "Desktop shell missing"
fi

if [[ -f "$ROOT/hosts/desktop/dist/Bit Bot-0.1.0.AppImage" ]] || \
   [[ -d "$ROOT/hosts/desktop/dist/linux-unpacked" ]]; then
  ok "Desktop Linux pack artifact present"
else
  bad "Desktop pack artifact missing (run npm run dist:linux)"
fi

# Win/mac pack artifacts — reported honestly when present; required on those hosts.
if ls "$ROOT"/hosts/desktop/dist/*win*.zip >/dev/null 2>&1 || \
   ls "$ROOT"/hosts/desktop/dist/*.exe >/dev/null 2>&1 || \
   [[ -d "$ROOT/hosts/desktop/dist/win-unpacked" ]]; then
  ok "Desktop Windows pack artifact present (code-sign residual until CSC_* / cert)"
elif [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "MSYS"* || "$(uname -s)" == CYGWIN* ]]; then
  bad "Desktop Windows pack missing on Windows host (npm run dist:win)"
else
  note "WARN Windows pack not in tree (npm run dist:win; sign residual)"
fi
if ls "$ROOT"/hosts/desktop/dist/*.dmg >/dev/null 2>&1 || \
   [[ -d "$ROOT/hosts/desktop/dist/mac" ]] || \
   [[ -d "$ROOT/hosts/desktop/dist/mac-arm64" ]]; then
  ok "Desktop macOS pack artifact present"
elif [[ "$(uname -s)" == "Darwin" ]]; then
  bad "Desktop macOS pack missing on Darwin (npm run dist:mac + notarize)"
else
  note "WARN macOS dmg/notarize residual (needs Darwin + APPLE_* creds)"
fi

# OTA updater module present (feed URL still a residual until configured)
if [[ -f "$ROOT/hosts/desktop/node_modules/electron-updater/package.json" ]] || \
   grep -q '"electron-updater"' "$ROOT/hosts/desktop/package.json" 2>/dev/null; then
  ok "Desktop electron-updater wired"
else
  bad "Desktop electron-updater missing"
fi

# P0 real model — require configured key AND successful live probe to DeepSeek (or configured base)
KEY="${BITBOT_LLM_API_KEY:-}"
BASE="${BITBOT_LLM_BASE_URL:-https://api.deepseek.com/v1}"
MODEL="${BITBOT_LLM_MODEL:-deepseek-chat}"
if [[ -z "$KEY" ]]; then
  bad "真模型: BITBOT_LLM_API_KEY not set (Settings → 产品凭证)"
else
  # Reject known stub keys
  if [[ "$KEY" == stub* || "$KEY" == test* || "$BASE" == *127.0.0.1* || "$BASE" == *localhost* ]]; then
    bad "真模型: key/base looks like local stub — not product DeepSeek"
  else
    code=$(curl -sS -o /tmp/bitbot-llm-probe.json -w '%{http_code}' \
      -X POST "$BASE/chat/completions" \
      -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" \
      -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}],\"max_tokens\":8}" \
      --connect-timeout 15 --max-time 60 || true)
    if [[ "$code" == "200" ]]; then
      ok "真模型: HTTP $code from $BASE model=$MODEL"
    else
      bad "真模型: HTTP ${code:-err} from $BASE (see /tmp/bitbot-llm-probe.json)"
    fi
  fi
fi

# CN inbound module present (local HTTP receiver; cloud still needs public URL)
if [[ -f "$ROOT/hosts/shared/cn_inbound_server.js" ]]; then
  if grep -q '/v1/turn' "$ROOT/hosts/shared/cn_inbound_server.js"; then
    ok "CN inbound + mobile /v1/turn shared-brain API present"
  else
    bad "CN inbound missing /v1/turn mobile pair API"
  fi
else
  bad "CN inbound server module missing"
fi

# P2 real CN channel — at least one live gate with non-local credential
cn_ok=0
if [[ "${BITBOT_DINGTALK_POST:-}" == "1" && -n "${BITBOT_DINGTALK_WEBHOOK:-}${BITBOT_DINGTALK_TOKEN:-}" ]]; then
  wh="${BITBOT_DINGTALK_WEBHOOK:-}"
  if [[ "$wh" == *127.0.0.1* || "$wh" == *localhost* ]]; then
    note "SKIP 钉钉 webhook is localhost stub"
  else
    cn_ok=1
    ok "真渠道门控: dingtalk POST armed with non-local cred"
  fi
fi
if [[ "${BITBOT_FEISHU_POST:-}" == "1" && -n "${BITBOT_FEISHU_TOKEN:-}" && -n "${BITBOT_FEISHU_CHAT_ID:-}" ]]; then
  if [[ "${BITBOT_FEISHU_API_BASE:-}" == *127.0.0.1* ]]; then
    note "SKIP 飞书 API base is localhost stub"
  else
    cn_ok=1
    ok "真渠道门控: feishu POST armed"
  fi
fi
if [[ "${BITBOT_WECOM_POST:-}" == "1" && -n "${BITBOT_WECOM_TOKEN:-}" && -n "${BITBOT_WECOM_TOUSER:-}" ]]; then
  if [[ "${BITBOT_WECOM_API_BASE:-}" == *127.0.0.1* ]]; then
    note "SKIP 企微 API base is localhost stub"
  else
    cn_ok=1
    ok "真渠道门控: wecom POST armed"
  fi
fi
if [[ "$cn_ok" -eq 0 ]]; then
  bad "真渠道: no non-stub 钉钉/飞书/企微 live gate"
fi

# P4 compliance artifacts (armed at runtime via Settings; file must exist)
if [[ -f "$ROOT/data/compliance/content-blocklist.txt" ]]; then
  ok "Content moderation blocklist file present"
else
  bad "Content moderation blocklist missing (data/compliance/content-blocklist.txt)"
fi
if [[ -f "$ROOT/data/routines/daemon-status.json" ]] && \
   grep -q '"long_lived": true' "$ROOT/data/routines/daemon-status.json" 2>/dev/null; then
  ok "Routine long-lived daemon armed (P3)"
else
  note "WARN P3 long-lived daemon not active in this session (Desktop autostart / --long-lived)"
fi

# Mobile APK residual honesty
if ls "$ROOT"/hosts/android/BitBotHost/app/build/outputs/apk/*/debug/*.apk >/dev/null 2>&1; then
  ok "Android CN flavor debug APKs built (device/store residual may remain)"
else
  note "WARN Android APKs not in tree (may be gitignored build/)"
fi

note "-- summary: pass=$pass fail=$fail --"
if [[ "$fail" -gt 0 ]]; then
  note "ACCEPTANCE: NOT MET (do not claim goal complete)"
  exit 1
fi
note "ACCEPTANCE: all gated checks passed"
exit 0
