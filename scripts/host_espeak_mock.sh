#!/usr/bin/env bash
# Injectable espeak mock for voice TTS residual smoke (BITBOT_ESPEAK_BIN).
# Parses espeak-like "-w <wav>" and writes a minimal RIFF/WAV. Never invents speech.
set -euo pipefail
LOG_DIR="${BITBOT_ESPEAK_MOCK_LOG_DIR:-/tmp/bitbot-espeak-mock}"
mkdir -p "$LOG_DIR"
echo "$*" >>"$LOG_DIR/invocations.log"

out=""
prev=""
for a in "$@"; do
  if [[ "$prev" == "-w" ]]; then
    out="$a"
  fi
  prev="$a"
done
if [[ -z "$out" ]]; then
  echo "host_espeak_mock: missing -w <wav>" >&2
  exit 2
fi
python3 - "$out" <<'PY'
import sys, struct
path = sys.argv[1]
# 16kHz mono 16-bit, ~0.05s of silence — valid WAV > 44 bytes.
rate, ch, bits, n = 16000, 1, 16, 800
data = b"\x00\x00" * n
byte_rate = rate * ch * bits // 8
block = ch * bits // 8
hdr = struct.pack(
    "<4sI4s4sIHHIIHH4sI",
    b"RIFF",
    36 + len(data),
    b"WAVE",
    b"fmt ",
    16,
    1,
    ch,
    rate,
    byte_rate,
    block,
    bits,
    b"data",
    len(data),
)
open(path, "wb").write(hdr + data)
print(path)
PY
echo "{\"ok\":true,\"mock\":true,\"wav\":\"$out\"}" >"$LOG_DIR/last-espeak.json"
exit 0
