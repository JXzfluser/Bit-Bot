#!/usr/bin/env python3
"""Serve a local sign-in HTML fixture for CU blocked_on_signin username fill.

Usage:
  python3 scripts/host_cu_signin_fixture.py --port 18766
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>BitBot Sign In Fixture</title></head>
<body>
  <h1>Sign in</h1>
  <p>Log in to continue</p>
  <form id="login" action="/auth" method="post">
    <label>Email <input type="email" name="email" autocomplete="username" placeholder="you@example.com"></label>
    <label>Password <input type="password" name="password" autocomplete="current-password"></label>
    <button type="submit">Sign in</button>
  </form>
</body></html>
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18766)
    args = ap.parse_args()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *a) -> None:  # noqa: A003
            sys.stderr.write("[signin-fixture] " + (fmt % a) + "\n")

        def do_GET(self) -> None:  # noqa: N802
            data = HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    httpd = HTTPServer(("127.0.0.1", args.port), Handler)
    print(
        json.dumps(
            {"ok": True, "port": args.port, "url": f"http://127.0.0.1:{args.port}/"}
        ),
        flush=True,
    )
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
