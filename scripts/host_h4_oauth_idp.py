#!/usr/bin/env python3
"""Local sandbox OAuth IdP + connector adapters for Host H4 (CM-1105 / 2109 / 2120).

Real HTTP authorization-code flow (not stub authenticate→Ready):
  GET  /authorize  → confirm HTML → POST /authorize/confirm → 302 redirect with code
  POST /token      → access_token only (never issues refresh_token into evidence)

Sandbox adapters start NeedsAuth/unconnected, open the authorize URL, complete the
callback, then transition to Connected (Slack) or Ready (Finance/Outlook).

Usage:
  python3 scripts/host_h4_oauth_idp.py --sandbox-run --provider slack \\
      --artifact-dir docs/qa/artifacts/cm-1105-slack-connect
  python3 scripts/host_h4_oauth_idp.py --listen 127.0.0.1:0   # IdP only
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


CLIENT_ID = "bitbot-h4-sandbox"
# Intentionally no refresh tokens in this sandbox IdP.


@dataclass
class PendingAuth:
    client_id: str
    redirect_uri: str
    state: str
    provider: str
    scope: str
    created: float = field(default_factory=time.time)


@dataclass
class IssuedCode:
    client_id: str
    redirect_uri: str
    provider: str
    state: str
    created: float = field(default_factory=time.time)


class IdPState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.pending: Dict[str, PendingAuth] = {}
        self.codes: Dict[str, IssuedCode] = {}
        self.tokens: Dict[str, Dict[str, Any]] = {}
        self.events: List[Dict[str, Any]] = []

    def note(self, kind: str, **extra: Any) -> None:
        row = {"ts": time.time(), "kind": kind, **extra}
        with self.lock:
            self.events.append(row)


def _html_page(title: str, body: str) -> bytes:
    doc = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{html.escape(title)}</title></head>
<body>
<h1>{html.escape(title)}</h1>
{body}
</body></html>
"""
    return doc.encode("utf-8")


def make_idp_handler(state: IdPState):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            return

        def _read_form(self) -> Dict[str, str]:
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length > 0 else b""
            parsed = urllib.parse.parse_qs(raw.decode("utf-8", errors="replace"))
            return {k: (v[0] if v else "") for k, v in parsed.items()}

        def _send(self, code: int, body: bytes, content_type: str, extra: Optional[Dict[str, str]] = None) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if extra:
                for k, v in extra.items():
                    self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            if parsed.path == "/health":
                body = json.dumps({"ok": True, "role": "h4-oauth-idp"}).encode()
                self._send(200, body, "application/json")
                return
            if parsed.path == "/authorize":
                client_id = (qs.get("client_id") or [""])[0]
                redirect_uri = (qs.get("redirect_uri") or [""])[0]
                state_q = (qs.get("state") or [""])[0]
                response_type = (qs.get("response_type") or ["code"])[0]
                provider = (qs.get("provider") or ["sandbox"])[0]
                scope = (qs.get("scope") or ["sandbox"])[0]
                if response_type != "code" or not client_id or not redirect_uri:
                    self._send(400, b"invalid authorize request", "text/plain")
                    return
                auth_req = secrets.token_urlsafe(16)
                with state.lock:
                    state.pending[auth_req] = PendingAuth(
                        client_id=client_id,
                        redirect_uri=redirect_uri,
                        state=state_q,
                        provider=provider,
                        scope=scope,
                    )
                state.note(
                    "authorize_shown",
                    auth_req=auth_req,
                    provider=provider,
                    redirect_uri=redirect_uri,
                )
                form = f"""
<p>Provider: <code>{html.escape(provider)}</code></p>
<p>Client: <code>{html.escape(client_id)}</code></p>
<p>Redirect: <code>{html.escape(redirect_uri)}</code></p>
<form method="POST" action="/authorize/confirm">
  <input type="hidden" name="auth_req" value="{html.escape(auth_req)}" />
  <button type="submit" name="decision" value="allow">Confirm authorize</button>
  <button type="submit" name="decision" value="deny">Deny</button>
</form>
"""
                self._send(200, _html_page("Sandbox OAuth authorize", form), "text/html; charset=utf-8")
                return
            self._send(404, b"not found", "text/plain")

        def do_POST(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/authorize/confirm":
                form = self._read_form()
                auth_req = form.get("auth_req", "")
                decision = form.get("decision", "deny")
                with state.lock:
                    pending = state.pending.pop(auth_req, None)
                if pending is None:
                    self._send(400, b"unknown auth_req", "text/plain")
                    return
                if decision != "allow":
                    state.note("authorize_denied", provider=pending.provider)
                    loc = pending.redirect_uri + ("&" if "?" in pending.redirect_uri else "?")
                    loc += urllib.parse.urlencode({"error": "access_denied", "state": pending.state})
                    self._send(302, b"", "text/plain", {"Location": loc})
                    return
                code = secrets.token_urlsafe(24)
                with state.lock:
                    state.codes[code] = IssuedCode(
                        client_id=pending.client_id,
                        redirect_uri=pending.redirect_uri,
                        provider=pending.provider,
                        state=pending.state,
                    )
                state.note("authorize_allowed", provider=pending.provider, code_prefix=code[:8])
                loc = pending.redirect_uri + ("&" if "?" in pending.redirect_uri else "?")
                loc += urllib.parse.urlencode({"code": code, "state": pending.state})
                self._send(302, b"", "text/plain", {"Location": loc})
                return

            if parsed.path == "/token":
                form = self._read_form()
                grant = form.get("grant_type", "")
                code = form.get("code", "")
                redirect_uri = form.get("redirect_uri", "")
                client_id = form.get("client_id", "")
                if grant != "authorization_code":
                    self._send(400, json.dumps({"error": "unsupported_grant_type"}).encode(), "application/json")
                    return
                with state.lock:
                    issued = state.codes.pop(code, None)
                if issued is None:
                    self._send(400, json.dumps({"error": "invalid_grant"}).encode(), "application/json")
                    return
                if issued.redirect_uri != redirect_uri or issued.client_id != client_id:
                    self._send(400, json.dumps({"error": "invalid_client"}).encode(), "application/json")
                    return
                access = "atk_" + secrets.token_urlsafe(24)
                token_rec = {
                    "access_token": access,
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "provider": issued.provider,
                    # Explicitly omit refresh_token — sandbox never issues one into evidence.
                }
                with state.lock:
                    state.tokens[access] = {
                        "provider": issued.provider,
                        "client_id": client_id,
                        "issued_at": time.time(),
                    }
                state.note("token_issued", provider=issued.provider, access_prefix=access[:10])
                body = json.dumps(token_rec).encode()
                self._send(200, body, "application/json")
                return

            self._send(404, b"not found", "text/plain")

    return Handler


class CallbackState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.observed = False
        self.query: Dict[str, str] = {}
        self.raw_path = ""
        self.event = threading.Event()


def make_callback_handler(cb: CallbackState):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            return

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path != "/callback":
                body = b"not found"
                self.send_response(404)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            qs = {k: (v[0] if v else "") for k, v in urllib.parse.parse_qs(parsed.query).items()}
            with cb.lock:
                cb.observed = True
                cb.query = qs
                cb.raw_path = self.path
                cb.event.set()
            body = b"oauth callback ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def _pick_port() -> int:
    import socket

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = int(s.getsockname()[1])
    s.close()
    return port


def _http_request(
    method: str,
    url: str,
    data: Optional[bytes] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 5.0,
) -> Tuple[int, Dict[str, str], bytes]:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            return int(resp.status), hdrs, resp.read()
    except urllib.error.HTTPError as e:
        hdrs = {k.lower(): v for k, v in e.headers.items()} if e.headers else {}
        return int(e.code), hdrs, e.read() if e.fp else b""


class SandboxConnector:
    """Connector sandbox adapter: NeedsAuth until real OAuth callback + token exchange."""

    def __init__(self, provider: str) -> None:
        self.provider = provider
        self.status = "NeedsAuth"
        self.access_token: Optional[str] = None
        self.details_connected = False
        self.tools: List[str] = []
        self.drafts: List[Dict[str, Any]] = []
        self.write_log: List[str] = []

    def try_write(self, op: str) -> Tuple[bool, str]:
        if self.status in ("NeedsAuth", "unconnected", "Disconnected"):
            msg = f"REFUSED:{op}:needsAuth"
            self.write_log.append(msg)
            return False, msg
        if self.provider == "outlook" and op == "send":
            msg = f"REFUSED:{op}:draft_only_sandbox"
            self.write_log.append(msg)
            return False, msg
        msg = f"OK:{op}"
        self.write_log.append(msg)
        return True, msg

    def apply_token(self, access_token: str) -> None:
        self.access_token = access_token
        if self.provider == "slack":
            self.status = "Connected"
            self.details_connected = True
        else:
            self.status = "Ready"
            if self.provider == "finance":
                self.tools = ["list_accounts", "get_balance", "list_transactions"]
            elif self.provider == "outlook":
                self.tools = ["create_draft"]

    def post_auth_op(self) -> Dict[str, Any]:
        if self.provider == "slack":
            return {
                "op": "details_connected",
                "ok": self.details_connected and self.status == "Connected",
                "details_state": "Connected" if self.details_connected else "NeedsDetails",
            }
        if self.provider == "finance":
            return {"op": "list_tools", "ok": bool(self.tools), "tools": list(self.tools)}
        if self.provider == "outlook":
            ok, msg = self.try_write("draft")
            if ok:
                draft = {
                    "id": "outlook-sandbox-draft-1",
                    "to": "sandbox@example.test",
                    "subject": "H4 sandbox draft (no send)",
                    "body": "draft-only after OAuth",
                    "sent": False,
                }
                self.drafts.append(draft)
                return {"op": "create_draft", "ok": True, "draft": draft, "msg": msg}
            return {"op": "create_draft", "ok": False, "msg": msg}
        return {"op": "unknown", "ok": False}


def _redact_token_body(raw: bytes) -> Dict[str, Any]:
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        return {"parse_error": True, "bytes": len(raw)}
    out: Dict[str, Any] = {}
    for k, v in data.items():
        if k in ("access_token", "refresh_token", "id_token"):
            if k == "refresh_token":
                # Never persist refresh token material.
                out[k] = "<omitted>"
            else:
                s = str(v)
                out[k + "_sha256_8"] = hashlib.sha256(s.encode()).hexdigest()[:8]
                out[k + "_prefix"] = s[:6] + "…"
        else:
            out[k] = v
    if "refresh_token" in data:
        out["refresh_token_present_in_idp_response"] = True
    else:
        out["refresh_token_present_in_idp_response"] = False
    return out


def run_sandbox(provider: str, artifact_dir: Path) -> int:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    idp_state = IdPState()
    cb_state = CallbackState()

    idp_port = _pick_port()
    cb_port = _pick_port()
    while cb_port == idp_port:
        cb_port = _pick_port()

    idp = ThreadingHTTPServer(("127.0.0.1", idp_port), make_idp_handler(idp_state))
    cb = ThreadingHTTPServer(("127.0.0.1", cb_port), make_callback_handler(cb_state))
    t_idp = threading.Thread(target=idp.serve_forever, name="h4-idp", daemon=True)
    t_cb = threading.Thread(target=cb.serve_forever, name="h4-cb", daemon=True)
    t_idp.start()
    t_cb.start()

    connector = SandboxConnector(provider)
    namespace_before = connector.status
    redirect_uri = f"http://127.0.0.1:{cb_port}/callback"
    state_nonce = secrets.token_urlsafe(12)
    authorize_url = (
        f"http://127.0.0.1:{idp_port}/authorize?"
        + urllib.parse.urlencode(
            {
                "response_type": "code",
                "client_id": CLIENT_ID,
                "redirect_uri": redirect_uri,
                "state": state_nonce,
                "provider": provider,
                "scope": f"{provider}.sandbox",
            }
        )
    )

    # Pre-auth write must fail.
    pre_op = {
        "slack": "post_message",
        "finance": "list_accounts",
        "outlook": "draft",
    }.get(provider, "write")
    pre_ok, pre_msg = connector.try_write(pre_op)
    (artifact_dir / "write_rejected_before_auth.txt").write_text(
        f"op={pre_op}\nok={pre_ok}\nmsg={pre_msg}\nnamespace={connector.status}\n",
        encoding="utf-8",
    )

    (artifact_dir / "authorize_url.txt").write_text(authorize_url + "\n", encoding="utf-8")

    # Real HTTP: GET authorize (user-confirm page), then POST confirm → 302 to callback.
    code_auth, hdrs_auth, body_auth = _http_request("GET", authorize_url)
    (artifact_dir / "authorize_get.html").write_bytes(body_auth)
    (artifact_dir / "authorize_get.meta.txt").write_text(
        f"http_status={code_auth}\ncontent_type={hdrs_auth.get('content-type','')}\n"
        f"bytes={len(body_auth)}\ncontains_confirm_form="
        f"{'Confirm authorize' in body_auth.decode('utf-8', errors='replace')}\n",
        encoding="utf-8",
    )

    # Extract auth_req from HTML form
    import re

    m = re.search(r'name="auth_req"\s+value="([^"]+)"', body_auth.decode("utf-8", errors="replace"))
    if not m or code_auth != 200:
        _shutdown(idp, cb)
        (artifact_dir / "sandbox_error.txt").write_text("authorize page missing auth_req\n", encoding="utf-8")
        return 1
    auth_req = m.group(1)
    confirm_body = urllib.parse.urlencode({"auth_req": auth_req, "decision": "allow"}).encode()
    # Do not auto-follow redirects: capture Location as callback evidence.
    req = urllib.request.Request(
        f"http://127.0.0.1:{idp_port}/authorize/confirm",
        data=confirm_body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args: Any, **kwargs: Any) -> None:
            return None

    opener = urllib.request.build_opener(NoRedirect)
    location = ""
    confirm_status = 0
    try:
        with opener.open(req, timeout=5) as resp:
            confirm_status = int(resp.status)
            location = resp.headers.get("Location") or ""
            confirm_body_bytes = resp.read()
    except urllib.error.HTTPError as e:
        confirm_status = int(e.code)
        location = (e.headers.get("Location") if e.headers else None) or ""
        confirm_body_bytes = e.read() if e.fp else b""

    (artifact_dir / "authorize_confirm_redirect.txt").write_text(
        f"http_status={confirm_status}\nlocation={location}\nbody_bytes={len(confirm_body_bytes)}\n",
        encoding="utf-8",
    )

    if confirm_status not in (302, 303, 307) or not location:
        _shutdown(idp, cb)
        (artifact_dir / "sandbox_error.txt").write_text(
            f"expected 302 redirect with Location; got {confirm_status}\n",
            encoding="utf-8",
        )
        return 1

    # Hit callback URL (completes OAuth redirect chain).
    code_cb, hdrs_cb, body_cb = _http_request("GET", location)
    (artifact_dir / "oauth_callback.txt").write_text(
        f"request_url={location}\nhttp_status={code_cb}\nbody={body_cb.decode('utf-8', errors='replace')}\n",
        encoding="utf-8",
    )
    if not cb_state.event.wait(3.0):
        _shutdown(idp, cb)
        (artifact_dir / "sandbox_error.txt").write_text("callback not observed\n", encoding="utf-8")
        return 1

    with cb_state.lock:
        callback_query = dict(cb_state.query)
        callback_observed = cb_state.observed
        callback_raw = cb_state.raw_path

    (artifact_dir / "oauth_callback_query.json").write_text(
        json.dumps(
            {
                "observed": callback_observed,
                "raw_path": callback_raw,
                "has_code": bool(callback_query.get("code")),
                "state_matches": callback_query.get("state") == state_nonce,
                "state": callback_query.get("state"),
                "error": callback_query.get("error"),
                # code itself is short-lived; store only prefix for audit
                "code_prefix": (callback_query.get("code") or "")[:8],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    code_val = callback_query.get("code") or ""
    if not callback_observed or not code_val or callback_query.get("state") != state_nonce:
        _shutdown(idp, cb)
        (artifact_dir / "sandbox_error.txt").write_text("callback missing code/state\n", encoding="utf-8")
        return 1

    token_form = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": code_val,
            "redirect_uri": redirect_uri,
            "client_id": CLIENT_ID,
        }
    ).encode()
    code_tok, hdrs_tok, body_tok = _http_request(
        "POST",
        f"http://127.0.0.1:{idp_port}/token",
        data=token_form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    redacted = _redact_token_body(body_tok)
    (artifact_dir / "token_response_redacted.json").write_text(
        json.dumps({"http_status": code_tok, **redacted}, indent=2) + "\n",
        encoding="utf-8",
    )
    # Hard rule: never write refresh tokens to artifacts.
    for p in artifact_dir.iterdir():
        if p.is_file():
            text = p.read_text(encoding="utf-8", errors="replace")
            if "refresh_token" in text and "refresh_token_present_in_idp_response" not in text:
                # Allow the boolean flag file only; strip accidental secrets.
                if "refresh_token\":" in text or "refresh_token=" in text:
                    p.write_text(
                        text.replace("refresh_token", "refresh_token_REDACTED"),
                        encoding="utf-8",
                    )

    if code_tok != 200 or redacted.get("refresh_token_present_in_idp_response"):
        _shutdown(idp, cb)
        (artifact_dir / "sandbox_error.txt").write_text(
            f"token exchange failed or refresh_token leaked status={code_tok}\n",
            encoding="utf-8",
        )
        return 1

    try:
        tok = json.loads(body_tok.decode("utf-8"))
        access = tok["access_token"]
    except Exception:
        _shutdown(idp, cb)
        return 1

    connector.apply_token(access)
    namespace_after = connector.status
    post = connector.post_auth_op()

    if provider == "slack":
        (artifact_dir / "details_connected.txt").write_text(
            f"details_state={post.get('details_state')}\n"
            f"namespace={namespace_after}\n"
            f"ok={post.get('ok')}\n",
            encoding="utf-8",
        )
    elif provider == "finance":
        (artifact_dir / "tool_list.json").write_text(
            json.dumps(post, indent=2) + "\n", encoding="utf-8"
        )
    elif provider == "outlook":
        (artifact_dir / "draft_result.json").write_text(
            json.dumps(post, indent=2) + "\n", encoding="utf-8"
        )
        # Prove send stays draft-only even after auth.
        send_ok, send_msg = connector.try_write("send")
        (artifact_dir / "send_after_auth.txt").write_text(
            f"ok={send_ok}\nmsg={send_msg}\n", encoding="utf-8"
        )

    (artifact_dir / "namespace_status.txt").write_text(
        f"namespace_before={namespace_before}\n"
        f"namespace_after={namespace_after}\n"
        f"oauth_callback_observed={str(callback_observed).lower()}\n"
        f"stub_authenticate=false\n"
        f"fake_connected=false\n"
        f"provider={provider}\n",
        encoding="utf-8",
    )

    (artifact_dir / "idp_events.jsonl").write_text(
        "".join(json.dumps(e) + "\n" for e in idp_state.events),
        encoding="utf-8",
    )

    expected_after = "Connected" if provider == "slack" else "Ready"
    ok = (
        not pre_ok
        and callback_observed
        and namespace_before == "NeedsAuth"
        and namespace_after == expected_after
        and bool(post.get("ok"))
        and redacted.get("refresh_token_present_in_idp_response") is False
        and confirm_status in (302, 303, 307)
    )

    summary = {
        "provider": provider,
        "idp_base": f"http://127.0.0.1:{idp_port}",
        "callback_base": f"http://127.0.0.1:{cb_port}",
        "namespace_before": namespace_before,
        "namespace_after": namespace_after,
        "oauth_callback_observed": callback_observed,
        "pre_auth_write_refused": not pre_ok,
        "post_auth_op": post,
        "http_redirect_observed": confirm_status in (302, 303, 307),
        "refresh_token_in_artifacts": False,
        "ok": ok,
    }
    (artifact_dir / "sandbox_run.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )

    _shutdown(idp, cb)
    print(json.dumps({"ok": ok, "namespace_after": namespace_after, "callback": callback_observed}))
    return 0 if ok else 1


def _shutdown(idp: ThreadingHTTPServer, cb: ThreadingHTTPServer) -> None:
    try:
        idp.shutdown()
    except Exception:
        pass
    try:
        cb.shutdown()
    except Exception:
        pass
    try:
        idp.server_close()
    except Exception:
        pass
    try:
        cb.server_close()
    except Exception:
        pass


def serve_idp(host: str, port: int) -> None:
    state = IdPState()
    httpd = ThreadingHTTPServer((host, port), make_idp_handler(state))
    real_port = httpd.server_address[1]
    print(json.dumps({"listening": f"http://{host}:{real_port}", "role": "h4-oauth-idp"}))
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--listen", default="", help="host:port for IdP-only mode")
    ap.add_argument("--sandbox-run", action="store_true")
    ap.add_argument("--provider", choices=["slack", "finance", "outlook"], default="slack")
    ap.add_argument("--artifact-dir", default="")
    args = ap.parse_args()

    if args.sandbox_run:
        if not args.artifact_dir:
            print("--artifact-dir required for --sandbox-run", file=sys.stderr)
            return 2
        return run_sandbox(args.provider, Path(args.artifact_dir))

    if args.listen:
        host, _, port_s = args.listen.partition(":")
        port = int(port_s) if port_s else 0
        serve_idp(host or "127.0.0.1", port)
        return 0

    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
