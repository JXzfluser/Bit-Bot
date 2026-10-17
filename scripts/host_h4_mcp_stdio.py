#!/usr/bin/env python3
"""Host H4 stdio JSON-RPC MCP server (real subprocess, not in-process fake).

Authority: docs/host-integration-interface-gaps.md §4 (CM-2163 / CM-2164).
Speaks MCP-style Content-Length framed JSON-RPC on stdin/stdout.
Audit spans go to stderr (and optional --audit-log file).

Tools:
  echo_body     — returns injected body length / echo marker (CM-2163 inject path)
  write_result  — writes large body under /workspace/agent-tools/ (CM-2164)

Usage (driven by host_h4_smoke.sh):
  python3 scripts/host_h4_mcp_stdio.py [--audit-log PATH] [--agent-tools-dir PATH]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, TextIO


PROTOCOL_VERSION = "2024-11-05"
SERVER_NAME = "bitbot-h4-mcp-stdio"
SERVER_VERSION = "0.1.0"

TOOLS = [
    {
        "name": "echo_body",
        "description": "Echo/ack an injected body (CM-2163 Host FS $file: inject).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "body": {"type": "string", "description": "Injected payload from Host FS"},
                "source_ref": {"type": "string", "description": "Original $file: ref"},
            },
            "required": ["body"],
        },
    },
    {
        "name": "write_result",
        "description": "Write large result to agent-tools and return path (CM-2164).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "body": {"type": "string"},
                "filename": {
                    "type": "string",
                    "description": "Basename under agent-tools (default h4-loopback-echo.txt)",
                },
                "write_to_file": {"type": "boolean", "default": True},
            },
            "required": ["body"],
        },
    },
]


class AuditLog:
    def __init__(self, path: Optional[Path]) -> None:
        self.path = path
        self._fh: Optional[TextIO] = None
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            self._fh = path.open("a", encoding="utf-8")

    def write(self, span: Dict[str, Any]) -> None:
        line = json.dumps(span, ensure_ascii=False)
        sys.stderr.write(line + "\n")
        sys.stderr.flush()
        if self._fh is not None:
            self._fh.write(line + "\n")
            self._fh.flush()

    def close(self) -> None:
        if self._fh is not None:
            self._fh.close()
            self._fh = None


def read_message(stdin: TextIO) -> Optional[Dict[str, Any]]:
    """Read one Content-Length framed JSON-RPC message, or newline-delimited JSON."""
    header_line = stdin.readline()
    if not header_line:
        return None
    header_line = header_line.rstrip("\r\n")
    if header_line.lower().startswith("content-length:"):
        length = int(header_line.split(":", 1)[1].strip())
        # Consume remaining headers until blank line
        while True:
            line = stdin.readline()
            if line in ("", "\n", "\r\n"):
                break
            if not line:
                return None
        body = stdin.read(length)
        if len(body) < length:
            return None
        return json.loads(body)
    # Newline-delimited JSON fallback (handy for smoke clients)
    try:
        return json.loads(header_line)
    except json.JSONDecodeError:
        # Maybe more Content-Length style without prior match — try accumulate
        return None


def write_message(stdout: TextIO, msg: Dict[str, Any]) -> None:
    body = json.dumps(msg, ensure_ascii=False)
    raw = body.encode("utf-8")
    stdout.write(f"Content-Length: {len(raw)}\r\n\r\n")
    stdout.write(body)
    stdout.flush()


def tool_result_text(text: str, is_error: bool = False) -> Dict[str, Any]:
    return {
        "content": [{"type": "text", "text": text}],
        "isError": is_error,
    }


class H4McpServer:
    def __init__(self, agent_tools_dir: Path, audit: AuditLog) -> None:
        self.agent_tools_dir = agent_tools_dir
        self.audit = audit
        self.initialized = False

    def handle(self, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        method = msg.get("method")
        msg_id = msg.get("id")
        params = msg.get("params") or {}

        if method == "initialize":
            self.initialized = True
            self._span("initialize", ok=True, detail="MCP initialize")
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                },
            }

        if method == "notifications/initialized" or method == "initialized":
            return None

        if method == "tools/list":
            self._span("tools/list", ok=True, detail=f"n={len(TOOLS)}")
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {"tools": TOOLS},
            }

        if method == "tools/call":
            name = params.get("name") or ""
            args = params.get("arguments") or {}
            result = self._call_tool(name, args)
            return {"jsonrpc": "2.0", "id": msg_id, "result": result}

        if method == "ping":
            return {"jsonrpc": "2.0", "id": msg_id, "result": {}}

        if msg_id is not None:
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            }
        return None

    def _call_tool(self, name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        if name == "echo_body":
            body = args.get("body")
            if not isinstance(body, str):
                self._span("tools/call", ok=False, detail="echo_body missing body", tool=name)
                return tool_result_text("error: body required", is_error=True)
            source_ref = args.get("source_ref") or ""
            span = {
                "tool": name,
                "injected_bytes": len(body.encode("utf-8")),
                "has_large_payload_marker": "LARGE_PAYLOAD_BEGIN" in body,
                "source_ref": source_ref,
            }
            self._span("tools/call", ok=True, detail="echo_body accepted inject", **span)
            ack = {
                "ok": True,
                "injected_bytes": len(body.encode("utf-8")),
                "has_large_payload_marker": "LARGE_PAYLOAD_BEGIN" in body,
                "source_ref": source_ref,
                "preview_head": body[:32],
                "preview_tail": body[-32:] if len(body) > 32 else body,
            }
            return tool_result_text(json.dumps(ack, ensure_ascii=False))

        if name == "write_result":
            body = args.get("body")
            if not isinstance(body, str):
                self._span("tools/call", ok=False, detail="write_result missing body", tool=name)
                return tool_result_text("error: body required", is_error=True)
            write_flag = args.get("write_to_file", True)
            if write_flag is False:
                self._span("tools/call", ok=False, detail="write_to_file=false refused", tool=name)
                return tool_result_text("error: write_to_file required", is_error=True)
            filename = args.get("filename") or "h4-loopback-echo.txt"
            filename = os.path.basename(str(filename))
            self.agent_tools_dir.mkdir(parents=True, exist_ok=True)
            out_path = self.agent_tools_dir / filename
            data = body.encode("utf-8")
            out_path.write_bytes(data)
            sha = hashlib.sha256(data).hexdigest()
            abs_path = str(out_path.resolve())
            # Prefer /workspace/... form when under workspace
            if abs_path.startswith("/workspace/"):
                returned_path = abs_path
            else:
                returned_path = abs_path
            meta = {
                "ok": True,
                "path": returned_path,
                "bytes": len(data),
                "sha256": sha,
            }
            self._span(
                "tools/call",
                ok=True,
                detail="write_result wrote agent-tools file",
                tool=name,
                path=returned_path,
                bytes=len(data),
                sha256=sha,
            )
            # Return path only — never the PAYLOAD body
            return tool_result_text(json.dumps(meta, ensure_ascii=False))

        self._span("tools/call", ok=False, detail=f"unknown tool {name}", tool=name)
        return tool_result_text(f"error: unknown tool {name}", is_error=True)

    def _span(self, method: str, ok: bool, detail: str = "", **extra: Any) -> None:
        span = {
            "id": str(uuid.uuid4()),
            "ts": time.time(),
            "server": SERVER_NAME,
            "method": method,
            "ok": ok,
            "detail": detail,
        }
        span.update(extra)
        self.audit.write(span)


def main() -> int:
    ap = argparse.ArgumentParser(description="Bit-Bot H4 stdio MCP server")
    ap.add_argument("--audit-log", type=Path, default=None)
    ap.add_argument(
        "--agent-tools-dir",
        type=Path,
        default=Path("/workspace/agent-tools"),
    )
    args = ap.parse_args()

    audit = AuditLog(args.audit_log)
    server = H4McpServer(args.agent_tools_dir, audit)
    audit.write(
        {
            "id": str(uuid.uuid4()),
            "ts": time.time(),
            "server": SERVER_NAME,
            "method": "boot",
            "ok": True,
            "detail": "stdio MCP server started",
            "pid": os.getpid(),
            "agent_tools_dir": str(args.agent_tools_dir),
        }
    )

    try:
        while True:
            msg = read_message(sys.stdin)
            if msg is None:
                break
            # notifications have no id
            if "method" in msg and "id" not in msg:
                server.handle(msg)
                continue
            resp = server.handle(msg)
            if resp is not None:
                write_message(sys.stdout, resp)
    finally:
        audit.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
