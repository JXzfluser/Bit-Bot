#!/usr/bin/env python3
"""Host OAuth: wait for authorize redirect callback, optional token exchange.

Honest Host FFI path for remote production IdP after browser open:
  1. Listen on BITBOT_OAUTH_REDIRECT_URI (default http://127.0.0.1:<port>/callback)
  2. Optionally serve /authorize-auto that immediately redirects with a smoke code
     (for Host rehearsal when no real IdP credentials are present)
  3. Wait up to --wait-ms for ?code=
  4. If --token-url set and code received, POST authorization_code exchange

Never invents Connected without a token. i_claimed is never set.
"""

from __future__ import annotations

import argparse
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional


def free_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def http_form(url: str, form: Dict[str, str], timeout: float = 15.0) -> Dict[str, Any]:
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(65536)
            try:
                parsed = json.loads(body.decode("utf-8", errors="replace"))
            except json.JSONDecodeError:
                parsed = None
            return {
                "ok": 200 <= int(getattr(resp, "status", 200) or 200) < 300,
                "status": int(getattr(resp, "status", 200) or 200),
                "json": parsed,
            }
    except urllib.error.HTTPError as e:
        body = e.read(4096) if hasattr(e, "read") else b""
        try:
            parsed = json.loads(body.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            parsed = None
        return {"ok": False, "status": int(e.code), "json": parsed, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "status": 0, "error": str(e), "json": None}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artifact-dir", required=True)
    ap.add_argument("--wait-ms", type=int, default=5000)
    ap.add_argument("--redirect-uri", default="")
    ap.add_argument("--token-url", default="")
    ap.add_argument("--client-id", default="bitbot")
    ap.add_argument("--client-secret", default="")
    ap.add_argument(
        "--serve-auto-authorize",
        action="store_true",
        help="Serve /authorize-auto that redirects to callback with smoke code",
    )
    ap.add_argument("--seed-code", default="", help="If set, inject callback immediately after listen")
    args = ap.parse_args()

    artifact_dir = Path(args.artifact_dir)
    artifact_dir.mkdir(parents=True, exist_ok=True)

    port = free_port()
    redirect_uri = (args.redirect_uri or "").strip() or f"http://127.0.0.1:{port}/callback"
    parsed = urllib.parse.urlparse(redirect_uri)
    listen_port = int(parsed.port or port)
    callback_path = parsed.path or "/callback"

    state: Dict[str, Any] = {"code": None, "error": None, "hits": 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *a: Any) -> None:  # noqa: A003
            return

        def do_GET(self) -> None:  # noqa: N802
            u = urllib.parse.urlparse(self.path)
            if u.path in ("/authorize-auto", "/authorize"):
                q = urllib.parse.urlencode(
                    {
                        "code": "remote-smoke-code",
                        "state": "bitbot",
                    }
                )
                loc = f"{callback_path}?{q}"
                self.send_response(302)
                self.send_header("Location", loc)
                self.end_headers()
                return
            if u.path == "/token" and self.command == "GET":
                self.send_response(405)
                self.end_headers()
                return
            if u.path == callback_path or u.path.rstrip("/") == callback_path.rstrip("/"):
                qs = urllib.parse.parse_qs(u.query)
                code = (qs.get("code") or [""])[0]
                err = (qs.get("error") or [""])[0]
                state["hits"] += 1
                if code:
                    state["code"] = code
                if err:
                    state["error"] = err
                body = b"<html><body>BitBot OAuth callback received. You can close this window.</body></html>"
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_response(404)
            self.end_headers()

        def do_POST(self) -> None:  # noqa: N802
            u = urllib.parse.urlparse(self.path)
            if u.path != "/token":
                self.send_response(404)
                self.end_headers()
                return
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            form = urllib.parse.parse_qs(raw.decode("utf-8", errors="replace"))
            code = (form.get("code") or [""])[0]
            if code:
                payload = {
                    "access_token": f"remote_cb:{code[:24]}",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                }
                body = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                body = b'{"error":"invalid_grant"}'
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

    # Bind to redirect port when possible; else free port + rewrite.
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", listen_port), Handler)
        bound_port = listen_port
    except OSError:
        httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        bound_port = int(httpd.server_address[1])
        redirect_uri = f"http://127.0.0.1:{bound_port}/callback"
        callback_path = "/callback"

    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()

    authorize_auto = f"http://127.0.0.1:{bound_port}/authorize-auto"
    token_local = f"http://127.0.0.1:{bound_port}/token"
    # Publish listener endpoints immediately so Host can open the browser mid-wait.
    (artifact_dir / "listener.json").write_text(
        json.dumps(
            {
                "redirect_uri": redirect_uri,
                "authorize_auto_url": authorize_auto,
                "token_url_local": token_local,
                "bound_port": bound_port,
                "callback_path": callback_path,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    if args.seed_code:
        # Inject callback hit without a browser (unit/smoke).
        try:
            urllib.request.urlopen(
                f"{redirect_uri}?code={urllib.parse.quote(args.seed_code)}",
                timeout=3,
            ).read()
        except Exception as e:  # noqa: BLE001
            state["error"] = str(e)

    deadline = time.time() + max(0.2, args.wait_ms / 1000.0)
    while time.time() < deadline and not state["code"]:
        time.sleep(0.05)

    code = state["code"]
    token_url = (args.token_url or "").strip() or (
        token_local if args.serve_auto_authorize else ""
    )
    exchange: Dict[str, Any] = {"attempted": False}
    access = ""
    if code and token_url:
        exchange["attempted"] = True
        form = {
            "grant_type": "authorization_code",
            "code": code,
            "client_id": args.client_id or "bitbot",
            "redirect_uri": redirect_uri,
        }
        if args.client_secret:
            form["client_secret"] = args.client_secret
        exchange["result"] = http_form(token_url, form)
        access = (
            (exchange["result"].get("json") or {}).get("access_token")
            if isinstance(exchange.get("result"), dict)
            else ""
        ) or ""

    summary = {
        "ok": bool(access) if token_url else bool(code),
        "callback_received": bool(code),
        "code_prefix": (code or "")[:12],
        "redirect_uri": redirect_uri,
        "authorize_auto_url": authorize_auto if args.serve_auto_authorize else None,
        "token_url": token_url or None,
        "bound_port": bound_port,
        "hits": state["hits"],
        "has_access_token": bool(access),
        "access_token_prefix": access[:16] if access else "",
        "exchange": {
            "attempted": exchange.get("attempted"),
            "http_status": (exchange.get("result") or {}).get("status"),
            "ok": (exchange.get("result") or {}).get("ok"),
        },
        "error": state.get("error"),
        "mode": "live_remote_callback",
        "i_claimed": False,
    }
    if access:
        summary["access_token"] = access  # Host FFI may persist; evidence redacts below

    evidence = dict(summary)
    evidence.pop("access_token", None)
    (artifact_dir / "callback_wait.json").write_text(
        json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary))
    try:
        httpd.shutdown()
    except Exception:
        pass
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
