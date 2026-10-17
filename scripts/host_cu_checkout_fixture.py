#!/usr/bin/env python3
"""Serve a local shopping checkout HTML fixture for CU payment_wall deepen.

Usage:
  python3 scripts/host_cu_checkout_fixture.py --port 18767
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>BitBot Checkout Fixture</title></head>
<body>
  <h1>Checkout</h1>
  <p>Cart · Place order · Payment</p>
  <a href="/cart">Cart</a>
  <form action="/pay" method="post" id="pay-form">
    <label>Card number <input name="card" autocomplete="cc-number" placeholder="4111"></label>
    <label>CVV <input name="cvv"></label>
    <button type="submit" aria-label="pay now">Pay now</button>
  </form>
  <div data-test="payment">Billing</div>
</body></html>
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=18767)
    args = ap.parse_args()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *a) -> None:  # noqa: A003
            sys.stderr.write("[checkout-fixture] " + (fmt % a) + "\n")

        def do_GET(self) -> None:  # noqa: N802
            data = HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    httpd = HTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps({"ok": True, "port": args.port, "url": f"http://127.0.0.1:{args.port}/"}), flush=True)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
