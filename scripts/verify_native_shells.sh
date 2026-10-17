#!/usr/bin/env bash
# Prove native iOS/Android Host project trees exist and share MoonBit brain.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

need() {
  local f="$1"
  if [[ ! -e "$f" ]]; then
    echo "missing: $f" >&2
    exit 1
  fi
  echo "ok: $f"
}

need hosts/ios/BitBotHost/Sources/BitBotHost/TurnBridge.swift
need hosts/ios/BitBotHost/Sources/BitBotHost/BitBotApp.swift
need hosts/ios/BitBotHost/Sources/BitBotHost/DevicePermissionHost.swift
need hosts/ios/BitBotHost/project.yml
need hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnBridge.kt
need hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/MainActivity.kt
need hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/DevicePermissionHost.kt
need hosts/android/BitBotHost/app/build.gradle.kts
need hosts/android/BitBotHost/app/src/main/AndroidManifest.xml

# CM-0705: Android Host declares camera/mic; never pretend-granted in source.
python3 - <<'PY'
from pathlib import Path
man = Path("hosts/android/BitBotHost/app/src/main/AndroidManifest.xml").read_text()
assert "android.permission.CAMERA" in man
kt = Path("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/DevicePermissionHost.kt").read_text()
assert "pretendGranted" in kt and "false" in kt
swift = Path("hosts/ios/BitBotHost/Sources/BitBotHost/DevicePermissionHost.swift").read_text()
assert "pretendGranted" in swift
print("native device_permission Host scaffolds ok")
PY

# mobile_host may append SendToUser / HostAbi trailer lines after turn JSON.
parse_turn_json() {
  local src="$1"
  python3 -c "
import json,sys
raw=open(sys.argv[1]).read().splitlines()
line=next((l for l in raw if l.strip().startswith('{')), '')
assert line, 'missing turn JSON'
d=json.loads(line)
print(json.dumps(d))
" "$src"
}

echo "==> iOS machine_kind via mobile_host (BitBotHost bridge target)"
node hosts/mobile_host/run.js --machine-kind ios --session-id ios-native-shell "ListMachines" \
  >/tmp/bitbot-ios-native.raw
parse_turn_json /tmp/bitbot-ios-native.raw >/tmp/bitbot-ios-native.json
python3 -c "import json;d=json.load(open('/tmp/bitbot-ios-native.json'));assert d.get('ok');assert d.get('machine_kind')=='ios';print('ios shell path ok')"
# CHARTER Delivery trailer should still be present on raw mobile_host output.
python3 -c "t=open('/tmp/bitbot-ios-native.raw').read();assert 'machine_kind=ios' in t;print('ios HostAbi trailer ok')"

echo "==> Android machine_kind via mobile_host (BitBotHost bridge target)"
node hosts/mobile_host/run.js --machine-kind android --session-id android-native-shell "device tools" \
  >/tmp/bitbot-android-native.raw
parse_turn_json /tmp/bitbot-android-native.raw >/tmp/bitbot-android-native.json
python3 -c "import json,os;d=json.load(open('/tmp/bitbot-android-native.json'));assert d.get('ok');assert d.get('machine_kind')=='android';assert d.get('intent')=='device_tools';h=next(x for x in d.get('host_results')or[] if x.get('kind')=='device_tools_list');p=__import__('json').loads(h['stdout']);assert p.get('pretend_granted') is False;assert os.path.isfile(p['path']);print('android shell path ok', 'tools', p.get('count'))"
python3 -c "t=open('/tmp/bitbot-android-native.raw').read();assert 'machine_kind=android' in t;assert 'SendToUser' in t or 'device_tools_list' in t;print('android HostAbi trailer ok')"

echo "OK: verify_native_shells.sh"
