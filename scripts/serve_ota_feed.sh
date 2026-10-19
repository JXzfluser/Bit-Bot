#!/usr/bin/env bash
# Serve hosts/desktop/dist as a generic electron-updater feed (latest*.yml + artifacts).
# Product path for local/LAN OTA proof — set BITBOT_UPDATE_FEED_URL to the printed URL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/hosts/desktop/dist"
PORT="${BITBOT_OTA_PORT:-18770}"
HOST="${BITBOT_OTA_HOST:-127.0.0.1}"

if [[ ! -d "$DIST" ]]; then
  echo "FAIL: missing $DIST — run npm run dist:linux / dist:win first" >&2
  exit 1
fi
if [[ ! -f "$DIST/latest-linux.yml" ]]; then
  echo "WARN: latest-linux.yml missing — Linux OTA metadata incomplete"
fi

cd "$DIST"
echo "OTA feed http://${HOST}:${PORT}/  (point BITBOT_OTA_FEED_URL here)"
echo "  latest-linux.yml → AppImage"
python3 - <<PY
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import os
host = os.environ.get("BITBOT_OTA_HOST", "127.0.0.1")
port = int(os.environ.get("BITBOT_OTA_PORT", "18770"))
class H(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()
    def log_message(self, fmt, *args):
        print("[ota-feed]", fmt % args)
httpd = ThreadingHTTPServer((host, port), H)
print(f"[ota-feed] serving {os.getcwd()} on http://{host}:{port}/")
httpd.serve_forever()
PY
