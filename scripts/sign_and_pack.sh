#!/usr/bin/env bash
# Honest packaging/signing driver for Bit Bot Desktop + Android.
# Never pretends notarize/sign when credentials are missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0
note() { printf '%s\n' "$*"; }
ok() { note "OK  $*"; }
bad() { fail=$((fail + 1)); note "FAIL  $*"; }

TARGET="${1:-all}"

pack_linux() {
  note "== Desktop Linux =="
  (cd hosts/desktop && npm run dist:linux)
  if [[ -f "hosts/desktop/dist/Bit Bot-0.1.0.AppImage" ]]; then
    ok "AppImage present"
  else
    bad "AppImage missing"
  fi
}

pack_win() {
  note "== Desktop Windows (zip; NSIS needs wine) =="
  (cd hosts/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win zip)
  if ls hosts/desktop/dist/*win*.zip >/dev/null 2>&1; then
    ok "Windows zip present"
  else
    bad "Windows zip missing"
  fi
  if [[ -n "${CSC_LINK:-}${WIN_CSC_LINK:-}" ]]; then
    ok "Windows code-sign env present (CSC_*)"
  else
    note "WARN Windows code-sign residual — set CSC_LINK / CSC_KEY_PASSWORD"
  fi
}

pack_mac() {
  note "== Desktop macOS =="
  if [[ "$(uname -s)" != "Darwin" ]]; then
    note "SKIP macOS pack — not Darwin (needs Mac + APPLE_* for notarize)"
    return 0
  fi
  (cd hosts/desktop && npm run dist:mac)
  if [[ -z "${APPLE_ID:-}" || -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" || -z "${APPLE_TEAM_ID:-}" ]]; then
    note "WARN notarize residual — set APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID"
    if [[ "${BITBOT_REQUIRE_NOTARIZE:-}" == "1" ]]; then
      bad "BITBOT_REQUIRE_NOTARIZE=1 but Apple creds missing"
    fi
  else
    ok "Apple notarize credentials present"
  fi
}

pack_android() {
  note "== Android CN flavor release =="
  if [[ -z "${BITBOT_ANDROID_STORE_FILE:-}" || ! -f "${BITBOT_ANDROID_STORE_FILE}" ]]; then
    bad "BITBOT_ANDROID_STORE_FILE missing or not a file"
    return 0
  fi
  export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
  (
    cd hosts/android/BitBotHost
    ./gradlew assembleHuaweiRelease assembleXiaomiRelease assembleHonorRelease \
      assembleOppoRelease assembleVivoRelease assembleUniversalRelease
  )
  local n
  n=$(ls hosts/android/BitBotHost/app/build/outputs/apk/*/release/*.apk 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$n" -ge 1 ]]; then
    ok "Android release APKs: $n"
  else
    bad "No Android release APKs"
  fi
}

case "$TARGET" in
  linux) pack_linux ;;
  win|windows) pack_win ;;
  mac|macos) pack_mac ;;
  android) pack_android ;;
  all)
    pack_linux
    pack_win
    pack_mac
    pack_android
    ;;
  *)
    echo "usage: $0 [linux|win|mac|android|all]" >&2
    exit 2
    ;;
esac

note "-- sign_and_pack summary fail=$fail --"
exit "$fail"
