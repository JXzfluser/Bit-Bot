#!/usr/bin/env bash
# Injectable tesseract mock for CU OCR residual smoke (BITBOT_TESSERACT_BIN).
# Accepts tesseract-like args: <image> stdout -l eng --psm 6 → prints text to stdout.
set -euo pipefail
LOG_DIR="${BITBOT_TESSERACT_MOCK_LOG_DIR:-/tmp/bitbot-tesseract-mock}"
mkdir -p "$LOG_DIR"
echo "$*" >>"$LOG_DIR/invocations.log"
img="${1:-}"
if [[ -z "$img" || ! -f "$img" ]]; then
  echo "host_tesseract_mock: missing image" >&2
  exit 2
fi
echo "{\"ok\":true,\"mock\":true,\"image\":\"$img\"}" >"$LOG_DIR/last-ocr.json"
echo "mock ocr text from $(basename "$img")"
exit 0
