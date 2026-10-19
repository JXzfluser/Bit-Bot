#!/usr/bin/env bash
# Prepare iOS/Android Host store packaging trees (BitBotHost).
# MoonBit remains the product brain; this only stages Host shells + metadata.
# Actual App Store / Play signing requires developer certificates (still open).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/hosts/dist/mobile"
mkdir -p "$OUT/ios" "$OUT/android" "$OUT/meta"

need() {
  local f="$1"
  [[ -e "$f" ]] || { echo "missing: $f" >&2; exit 1; }
}

need "$ROOT/hosts/ios/BitBotHost/Sources/BitBotHost/TurnBridge.swift"
need "$ROOT/hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnBridge.kt"
need "$ROOT/hosts/mobile_host/run.js"

echo "[pack-mobile] staging BitBotHost trees…"
rm -rf "$OUT/ios/BitBotHost" "$OUT/android/BitBotHost"
cp -a "$ROOT/hosts/ios/BitBotHost" "$OUT/ios/"
cp -a "$ROOT/hosts/android/BitBotHost" "$OUT/android/"

cat >"$OUT/meta/store-packaging.json" <<EOF
{
  "v": 1,
  "brain": "cmd/desktop_turn",
  "host_bridge": "hosts/mobile_host/run.js",
  "machine_kinds": ["ios", "android"],
  "ios": {
    "project": "hosts/ios/BitBotHost",
    "bundle_id": "com.bitbot.host",
    "staged": "hosts/dist/mobile/ios/BitBotHost",
    "signing": "REQUIRED_APPLE_TEAM_CERT",
    "store": "App Store / TestFlight — open until signed"
  },
  "android": {
    "project": "hosts/android/BitBotHost",
    "application_id": "com.bitbot.host",
    "staged": "hosts/dist/mobile/android/BitBotHost",
    "signing": "REQUIRED_PLAY_OR_CN_UPLOAD_KEYSTORE",
    "store": "Play + 国内渠道 — open until signed",
    "product_flavors": ["universal", "huawei", "xiaomi", "honor", "oppo", "vivo"],
    "gradle_examples": [
      "./gradlew :app:assembleHuaweiRelease",
      "./gradlew :app:assembleXiaomiRelease",
      "./gradlew :app:assembleHonorRelease"
    ]
  },
  "verify": "bash scripts/verify_native_shells.sh"
}
EOF

cat >"$OUT/meta/SIGNING.md" <<'EOF'
# Mobile store signing (still open)

BitBotHost trees are staged under `hosts/dist/mobile/{ios,android}/`.
Desktop-first 本阶段可暂缓真机；渠道 flavors 已就绪。

## iOS
1. `xcodegen generate` in `BitBotHost` (or open in Xcode).
2. Set `BITBOT_REPO_ROOT` / embed `mobile_host` + moon runtime for device.
3. Configure Apple Team + Distribution certificate + App Store Connect app.
4. Archive → Upload to TestFlight / 公证.

## Android（Play + 国内渠道包）
1. Open `BitBotHost` in Android Studio.
2. Create upload keystore; export:
   - `BITBOT_ANDROID_STORE_FILE`
   - `BITBOT_ANDROID_STORE_PASSWORD`
   - `BITBOT_ANDROID_KEY_ALIAS`
   - `BITBOT_ANDROID_KEY_PASSWORD`
3. Product flavors（`store` dimension）:
   - `universal` / `huawei` / `xiaomi` / `honor` / `oppo` / `vivo`
4. Build examples:
   - `./gradlew :app:assembleHuaweiRelease`
   - `./gradlew :app:assembleXiaomiRelease`
   - `./gradlew :app:bundleUniversalRelease` → Play Console

MoonBit kernel stays the product brain; Host only executes FFI (ADR 0002/0005).
不假装已签名：无 keystore 时 release 回落 debug，meta 写明 signed=false。
EOF

# Prove bridge still works after staging
export BITBOT_REPO_ROOT="$ROOT"
bash "$ROOT/scripts/verify_native_shells.sh"

# Unsigned release archive (checksummed) — store submit still requires signing.
ARCHIVE_DIR="$OUT/archives"
mkdir -p "$ARCHIVE_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="$ARCHIVE_DIR/bitbot-mobile-unsigned-$STAMP.tar.gz"
tar -C "$OUT" -czf "$ARCHIVE" ios android meta
(
  cd "$ARCHIVE_DIR"
  sha256sum "$(basename "$ARCHIVE")" >"$(basename "$ARCHIVE").sha256"
)
cat >"$OUT/meta/unsigned-release.json" <<EOF
{
  "v": 1,
  "kind": "unsigned_mobile_host_bundle",
  "archive": "hosts/dist/mobile/archives/$(basename "$ARCHIVE")",
  "sha256_file": "hosts/dist/mobile/archives/$(basename "$ARCHIVE").sha256",
  "signed": false,
  "note": "App Store / Play signing still required before store submit"
}
EOF

echo "[pack-mobile] staged under hosts/dist/mobile/"
ls -la "$OUT" "$OUT/meta" "$ARCHIVE_DIR"
echo "OK: pack-mobile.sh (unsigned archive ready; signing still required for store submit)"
