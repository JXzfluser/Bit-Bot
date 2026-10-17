#!/usr/bin/env python3
"""Tiny local HTTP mock for Host live residual smoke (purchase / meeting).

Usage:
  python3 scripts/host_local_http_mock.py --port 18765 --mode purchase
  python3 scripts/host_local_http_mock.py --port 18766 --mode meeting

Endpoints:
  purchase: POST /charge  Authorization: Bearer <token>
  meeting:  POST /messages Authorization: Bearer <token>
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument(
        "--mode", choices=("purchase", "meeting", "finance"), required=True
    )
    ap.add_argument("--token", default="smoke-token")
    args = ap.parse_args()
    mode = args.mode
    expect = args.token

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *a) -> None:  # noqa: A003
            sys.stderr.write("[mock] " + (fmt % a) + "\n")

        def _auth_ok(self) -> bool:
            auth = self.headers.get("Authorization") or ""
            return auth.strip() == f"Bearer {expect}"

        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            path = self.path.split("?", 1)[0]
            ok_path = (
                (mode == "purchase" and path == "/charge")
                or (mode == "meeting" and path == "/messages")
                or (mode == "finance" and path.startswith("/tools/"))
            )
            if not ok_path:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b'{"ok":false,"error":"not_found"}')
                return
            if not self._auth_ok():
                self.send_response(401)
                self.end_headers()
                self.wfile.write(b'{"ok":false,"error":"unauthorized"}')
                return
            try:
                payload = json.loads(body.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                payload = {"raw": body.decode("utf-8", errors="replace")[:200]}
            resp = {
                "ok": True,
                "mode": mode,
                "received": payload,
            }
            if mode == "purchase":
                resp["charge_id"] = "mock-purchase-1"
            elif mode == "meeting":
                resp["message_id"] = "mock-meeting-1"
            else:
                resp["balance"] = {"currency": "USD", "amount": 42.0}
                resp["call_id"] = "mock-finance-1"
            data = json.dumps(resp).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    httpd = HTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps({"ok": True, "port": args.port, "mode": mode}), flush=True)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
