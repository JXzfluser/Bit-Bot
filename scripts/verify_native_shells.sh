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
need hosts/ios/BitBotHost/Sources/BitBotHost/SendToUserSurface.swift
need hosts/ios/BitBotHost/Sources/BitBotHost/ContentView.swift
need hosts/ios/BitBotHost/project.yml
need hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/TurnBridge.kt
need hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/MainActivity.kt
need hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/DevicePermissionHost.kt
need hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/SendToUserSurface.kt
need hosts/android/BitBotHost/app/build.gradle.kts
need hosts/android/BitBotHost/app/src/main/AndroidManifest.xml

# CM-0705: Android Host declares camera/mic; never pretend-granted in source.
# CHARTER Delivery: native SendToUser surfaces mirror shared JS helper kinds.
python3 - <<'PY'
from pathlib import Path
man = Path("hosts/android/BitBotHost/app/src/main/AndroidManifest.xml").read_text()
assert "android.permission.CAMERA" in man
kt = Path("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/DevicePermissionHost.kt").read_text()
assert "pretendGranted" in kt and "false" in kt
swift = Path("hosts/ios/BitBotHost/Sources/BitBotHost/DevicePermissionHost.swift").read_text()
assert "pretendGranted" in swift
ios_stu = Path("hosts/ios/BitBotHost/Sources/BitBotHost/SendToUserSurface.swift").read_text()
and_stu = Path("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/SendToUserSurface.kt").read_text()
ios_cv = Path("hosts/ios/BitBotHost/Sources/BitBotHost/ContentView.swift").read_text()
and_main = Path("hosts/android/BitBotHost/app/src/main/java/com/bitbot/host/MainActivity.kt").read_text()
assert "SendToUser" in ios_stu and "mcp_call" in ios_stu and "voice_relay" in ios_stu
assert "SendToUser" in and_stu and "mcp_call" in and_stu and "voice_relay" in and_stu
assert "attachments" in ios_stu and "pickAttachmentPath" in ios_stu
assert "attachments" in and_stu and "pickAttachmentPath" in and_stu
assert "SendToUser attachments" in ios_stu and "SendToUser attachments" in and_stu
# Recent product Host kinds mirrored on both native SendToUser surfaces.
for kind in (
    "screenshot",
    "check_updates",
    "auto_review_settings",
    "box_chrome_probe",
    "react_message",
    "render_markdown",
    "settings_open",
    # Multi-end parity with hosts/shared/send_to_user_surface.js
    "fs_list",
    "fs_read",
    "webfetch",
    "machines_list",
    "routine_schedule",
    "routine_list",
    "routine_fire",
    "routine_tick",
    "routine_pause",
    "routine_resume",
    "memory_update",
    "memory_recall",
):
    assert kind in ios_stu, kind
    assert kind in and_stu, kind
assert "channelDelivery" in ios_stu and "channel_delivery:in_app" in ios_stu
assert "channelDelivery" in and_stu and "channel_delivery:in_app" in and_stu
assert "oauthNeedsAuth" in ios_stu and 'NeedsAuth' in ios_stu
assert "oauthNeedsAuth" in and_stu and "NeedsAuth" in and_stu
shared = Path("hosts/shared/send_to_user_surface.js").read_text()
for kind in (
    "screenshot",
    "box_chrome_probe",
    "check_updates",
    "auto_review_settings",
    "fs_list",
    "webfetch",
    "machines_list",
    "routine_pause",
    "channel_delivery",
    "memory_update",
    "memory_recall",
    "oauthNeedsAuth",
):
    assert kind in shared, kind
assert "pickAttachmentPath" in shared and "attachments" in shared
assert "SendToUser attachments" in shared
assert "channel_delivery:in_app" in shared
assert "oauth:NeedsAuth" in shared or 'NeedsAuth' in shared
assert "SendToUserSurface" in ios_cv and "SendToUserChipRow" in ios_cv
assert "SendToUserSurface" in and_main
# Multi-end product quick actions mirror Desktop Plugins/Media/Voice/Box + mail/commerce.
for needle in (
    "productActions",
    "list plugins",
    "get plugin plugin-slides",
    "generate image",
    "structured chart",
    "voice start",
    "box doctor",
    "box chrome probe",
    "make slides",
    "draft mail",
    "schedule meeting",
    "purchase item",
    "reply via slack:",
    "reply via teams:",
    "finance get_balance",
    "job search",
    "x search moonbit",
    "list workflows",
    "list credentials",
    "react message",
    "screenshot agent=executor",
    "check updates",
    "launch cloud agent",
    "list routines",
    "tick routines",
    "listdir docs",
    "webfetch https://example.com",
    "computer use open",
    "shell echo",
    "cold mail to=",
    "send on behalf to=",
    "claim inbox",
    "author skill name=",
    "export bot template id=",
    "device tools",
    "take photo",
    "record video",
    "create reminder id=desk-rem",
    "journal query hello",
    "copy to box machine=",
    "mcp discover",
    "mcp call user-Gmail.search_threads",
    "spawn subagent summarize inbox",
    "travel expedia.com",
    "order food doordash.com",
    "package install cowsay",
    "list agents",
    "hide agent research",
    "notify settings assistant=asst-alpha",
    "update computer",
    "shared box fs",
    "section post group=g1",
    "meeting chat body=stand-up",
    "learn from demo title=Checkout",
    "fill credential domain=login.example.test",
    "read mail t-invoice-1",
    "pause routine smoke-r",
    "resume routine smoke-r",
    "add section group=g1",
    "connect finance",
    "book flight google.com/flights",
    "journal date=2026-10-17",
    "personal slack dm owner=Uowner",
    "channel plan body=stay in chat only",
    "launch bare chrome",
    "install package npm left-pad@1.3.0",
    "open members group=group-1",
    "query journal from=2026-10-01",
    "connect gmail",
    "connect outlook",
    "list connectors",
    "setup slack",
    "identity browser",
    "box clock",
    "copy from box machine=",
    "voice relay",
    "voice end",
    "generate video",
    "open webhook panel",
    "copy webhook url",
    "auto review settings",
    "search mail Invoice",
    "fire routine desk-r",
    "shared memory put",
    "shared memory read",
    "open settings",
    "source control github",
    "source control create_pr",
    "load skill slides presentation",
    "install plugin plugin-slides",
    "uninstall plugin plugin-slides",
    "copy webhook key",
    "tool-read webhook key",
    "webhook wake id=",
    "members panel",
    "recall",
    "reset computer",
    "local execution off",
    "guide permission kind=needs-auth",
    "watch video",
    "shop target.com",
    "code changes README.mbt.md",
    "send to agent asst-parity",
    "set notify assistant=asst-alpha",
    "[inbound] reaction :+1:",
    "open agent info agent=agent-bit",
    "delete agent agent-bit",
    "confirm delete agent",
    "create routine id=desk-r",
    "create teammate id=",
    "room ",
    "deliver cloud artifact artifact=",
    "teams send tsmoke",
    "thread_ts=",
    "draft outlook mail",
    "claim rehearsal",
    "sandbox claim",
):
    assert needle in ios_cv, needle
    assert needle in and_main, needle
mobile = Path("hosts/mobile_host/run.js").read_text()
for kind in (
    "finance_call",
    "job_search",
    "workflow_list",
    "inbound_reaction",
    "slides_pptx",
    "cloud_agent_launch",
    "routine_schedule",
    "routine_tick",
    "shell",
    "fs_list",
    "fs_read",
    "webfetch",
    "computer_use",
    "shared_memory_put",
    "machines_list",
    "mail_claim_inbox",
    "device_tools_list",
    "journal_query",
    "skill_load",
    "copy_to_box",
    "copy_from_box",
    "subagent_run",
    "mcp_discover",
    "mcp_call",
    "package_install",
    "room_turn",
    "send_to_agent",
    "credential_fill",
    "routine_pause",
    "routine_resume",
    "journal_append",
):
    assert kind in mobile, kind
assert "receipt_path" in mobile and "skill_path" in mobile
print("native device_permission + SendToUser Host scaffolds ok")
print("native product quick actions (plugins/media/voice/box/mail/channels/cloud/routines/tools) ok")
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
