#!/usr/bin/env python3
"""Thin stdio client for scripts/host_h4_mcp_stdio.py (subprocess MCP, not in-process).

Used by host_h4_smoke.sh for CM-2163 / CM-2164.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _encode(msg: Dict[str, Any]) -> bytes:
    body = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    return f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body


def _read_one(buf: bytearray) -> Optional[Dict[str, Any]]:
    sep = buf.find(b"\r\n\r\n")
    if sep < 0:
        return None
    header = buf[:sep].decode("ascii", errors="replace")
    length = None
    for line in header.split("\r\n"):
        if line.lower().startswith("content-length:"):
            length = int(line.split(":", 1)[1].strip())
    if length is None:
        # drop garbage line
        nl = buf.find(b"\n")
        if nl >= 0:
            del buf[: nl + 1]
        return None
    start = sep + 4
    if len(buf) < start + length:
        return None
    body = bytes(buf[start : start + length])
    del buf[: start + length]
    return json.loads(body.decode("utf-8"))


def mcp_session(
    server_py: Path,
    audit_log: Optional[Path],
    agent_tools_dir: Path,
    requests: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], str]:
    cmd = [sys.executable, str(server_py), "--agent-tools-dir", str(agent_tools_dir)]
    if audit_log is not None:
        cmd.extend(["--audit-log", str(audit_log)])
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert proc.stdin is not None and proc.stdout is not None and proc.stderr is not None

    # initialize + notifications/initialized + caller requests
    seq: List[Dict[str, Any]] = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "host_h4_smoke", "version": "0.1"},
            },
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
    ]
    next_id = 2
    for req in requests:
        r = dict(req)
        if "id" not in r:
            r["id"] = next_id
            next_id += 1
        seq.append(r)

    for msg in seq:
        proc.stdin.write(_encode(msg))
    proc.stdin.close()

    buf = bytearray()
    responses: List[Dict[str, Any]] = []
    # Read until process exits / EOF; collect JSON-RPC responses with id
    while True:
        chunk = proc.stdout.read(4096)
        if not chunk:
            break
        buf.extend(chunk)
        while True:
            msg = _read_one(buf)
            if msg is None:
                break
            if "id" in msg:
                responses.append(msg)

    stderr = proc.stderr.read().decode("utf-8", errors="replace")
    proc.wait(timeout=30)
    return responses, stderr


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", type=Path, required=True)
    ap.add_argument("--audit-log", type=Path, default=None)
    ap.add_argument("--agent-tools-dir", type=Path, default=Path("/workspace/agent-tools"))
    ap.add_argument("--out-json", type=Path, required=True)
    ap.add_argument("--stderr-out", type=Path, default=None)
    ap.add_argument(
        "--request-json",
        type=Path,
        required=True,
        help="JSON file: array of tools/list or tools/call request objects (without framing)",
    )
    args = ap.parse_args()

    requests = json.loads(args.request_json.read_text(encoding="utf-8"))
    if not isinstance(requests, list):
        raise SystemExit("request-json must be a JSON array")

    responses, stderr = mcp_session(
        args.server, args.audit_log, args.agent_tools_dir, requests
    )
    args.out_json.write_text(json.dumps(responses, indent=2) + "\n", encoding="utf-8")
    if args.stderr_out is not None:
        args.stderr_out.write_text(stderr, encoding="utf-8")
    print(json.dumps({"n_responses": len(responses), "ok": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
