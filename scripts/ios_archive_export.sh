#!/usr/bin/env bash
# Honest iOS archive/export — requires Darwin + BITBOT_IOS_TEAM_ID.
# Never pretends App Store upload succeeded without credentials.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$ROOT/hosts/ios/BitBotHost"
OUT="$ROOT/hosts/ios/dist"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "SKIP: iOS archive requires macOS (Darwin). Current: $(uname -s)"
  echo "residual: BITBOT_IOS_TEAM_ID + Xcode + xcodegen on a Mac"
  exit 0
fi

if [[ -z "${BITBOT_IOS_TEAM_ID:-}" ]]; then
  echo "FAIL: set BITBOT_IOS_TEAM_ID for signing/export" >&2
  exit 1
fi

command -v xcodegen >/dev/null || {
  echo "FAIL: xcodegen not installed (brew install xcodegen)" >&2
  exit 1
}
command -v xcodebuild >/dev/null || {
  echo "FAIL: xcodebuild missing" >&2
  exit 1
}

cd "$IOS"
xcodegen generate
mkdir -p "$OUT"
xcodebuild \
  -scheme BitBotHost \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/BitBotHost.xcarchive" \
  DEVELOPMENT_TEAM="$BITBOT_IOS_TEAM_ID" \
  archive

# Substitute team id into ExportOptions for this run
EXPORT_PLIST="$OUT/ExportOptions.plist"
sed "s/\$(BITBOT_IOS_TEAM_ID)/${BITBOT_IOS_TEAM_ID}/g" \
  "$IOS/ExportOptions.plist" >"$EXPORT_PLIST"

xcodebuild \
  -exportArchive \
  -archivePath "$OUT/BitBotHost.xcarchive" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  -exportPath "$OUT/export"

echo "OK: exported to $OUT/export (upload residual until App Store Connect creds)"
ls -la "$OUT/export" || true
