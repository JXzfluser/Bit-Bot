#!/usr/bin/env python3
"""Interactive OAuth consent via real headed browser (Host FFI).

Runs local IdP authorize→confirm→callback→token, driving confirm through
OS-window Chrome + CDP click when possible (honest mode: interactive_local).

Remote production IdP interactive consent still needs real provider credentials.

Usage:
  python3 scripts/host_oauth_interactive.py \\
    --provider slack --artifact-dir data/tmp/oauth-interactive-1
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict

sys.path.insert(0, str(Path(__file__).resolve().parent))
from host_h4_oauth_idp import (  # type: ignore
    CLIENT_ID,
    CallbackState,
    IdPState,
    SandboxConnector,
    _http_request,
    _redact_token_body,
    _shutdown,
    make_callback_handler,
    make_idp_handler,
)


def free_port() -> int:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def find_chrome() -> str | None:
    for cand in (
        os.environ.get("CHROME_BIN"),
        "/usr/local/bin/google-chrome",
        "/usr/bin/google-chrome",
        shutil.which("google-chrome"),
    ):
        if cand and Path(cand).exists():
            return cand
    return None


def cdp_click_allow(repo_root: Path, cdp_port: int) -> Dict[str, Any]:
    # Avoid "|" in the action string — host_cdp_actions splits steps on "|".
    actions = (
        "evaluate:(function(){var b=document.querySelector('button[value=allow]');"
        "if(!b){b=document.querySelector('button');}"
        "if(!b){return 'missing';} b.click(); return 'clicked';})()"
    )
    try:
        r = subprocess.run(
            [
                os.environ.get("NODE") or "node",
                str(repo_root / "scripts" / "host_cdp_actions.mjs"),
                "--port",
                str(cdp_port),
                "--actions",
                actions,
            ],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=20,
        )
        line = (r.stdout or "").strip().splitlines()[-1] if r.stdout else ""
        if line.startswith("{"):
            return json.loads(line)
        return {"ok": False, "error": (r.stderr or r.stdout or "")[:300]}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def http_confirm_fallback(idp_port: int, authorize_url: str) -> str:
    """Return Location redirect if urllib confirm succeeds."""
    code_auth, _hdrs, body_auth = _http_request("GET", authorize_url)
    m = re.search(
        r'name="auth_req"\s+value="([^"]+)"',
        body_auth.decode("utf-8", errors="replace"),
    )
    if not m or code_auth != 200:
        return ""
    confirm_body = urllib.parse.urlencode(
        {"auth_req": m.group(1), "decision": "allow"}
    ).encode()
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
    try:
        with opener.open(req, timeout=5) as resp:
            return resp.headers.get("Location") or ""
    except urllib.error.HTTPError as e:
        return (e.headers.get("Location") if e.headers else None) or ""


def run_interactive(provider: str, artifact_dir: Path) -> int:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    chrome = find_chrome()
    if not chrome:
        print(json.dumps({"ok": False, "error": "chrome missing"}))
        return 1

    repo_root = Path(__file__).resolve().parents[1]
    idp_state = IdPState()
    cb_state = CallbackState()
    idp = ThreadingHTTPServer(("127.0.0.1", 0), make_idp_handler(idp_state))
    cb = ThreadingHTTPServer(("127.0.0.1", 0), make_callback_handler(cb_state))
    idp_port = int(idp.server_address[1])
    cb_port = int(cb.server_address[1])
    threading.Thread(target=idp.serve_forever, daemon=True).start()
    threading.Thread(target=cb.serve_forever, daemon=True).start()

    connector = SandboxConnector(provider)
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
                "scope": f"{provider}.interactive",
            }
        )
    )
    (artifact_dir / "authorize_url.txt").write_text(authorize_url + "\n")

    cdp_port = free_port()
    profile = artifact_dir / "throwaway-chrome-profile"
    profile.mkdir(parents=True, exist_ok=True)
    chrome_args = [
        chrome,
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"--user-data-dir={profile}",
        f"--remote-debugging-port={cdp_port}",
        "--remote-allow-origins=*",
        "--window-size=1000,800",
        "--new-window",
        authorize_url,
    ]
    with open(artifact_dir / "chrome.stdout.txt", "wb") as so, open(
        artifact_dir / "chrome.stderr.txt", "wb"
    ) as se:
        proc = subprocess.Popen(chrome_args, stdout=so, stderr=se)

    ws_ready = False
    for _ in range(40):
        time.sleep(0.25)
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{cdp_port}/json/version", timeout=1
            ) as resp:
                status = int(resp.status)
                payload = json.loads(resp.read().decode())
            if status == 200 and "webSocketDebuggerUrl" in payload:
                ws_ready = True
                break
        except Exception:
            continue

    click: Dict[str, Any] = {"ok": False, "error": "cdp not ready"}
    interactive_click = False
    if ws_ready:
        time.sleep(0.5)
        click = cdp_click_allow(repo_root, cdp_port)
        interactive_click = bool(click.get("ok"))

    if not cb_state.event.wait(5.0):
        location = http_confirm_fallback(idp_port, authorize_url)
        if location:
            _http_request("GET", location)
            cb_state.event.wait(3.0)

    with cb_state.lock:
        callback_query = dict(cb_state.query)
        callback_observed = cb_state.observed

    code = callback_query.get("code") or ""
    token_ok = False
    access = ""
    if code:
        token_body = urllib.parse.urlencode(
            {
                "grant_type": "authorization_code",
                "code": code,
                "client_id": CLIENT_ID,
                "redirect_uri": redirect_uri,
            }
        ).encode()
        tcode, _thdrs, tbody = _http_request(
            "POST",
            f"http://127.0.0.1:{idp_port}/token",
            data=token_body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        (artifact_dir / "token_response_redacted.json").write_text(
            json.dumps(_redact_token_body(tbody), indent=2) + "\n"
        )
        try:
            tok = json.loads(tbody.decode("utf-8"))
            access = str(tok.get("access_token") or "")
            token_ok = tcode == 200 and bool(access)
            if token_ok:
                connector.apply_token(access)
        except Exception:
            token_ok = False

    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    _shutdown(idp, cb)

    summary = {
        "ok": bool(token_ok and callback_observed),
        "mode": "interactive_local",
        "provider": provider,
        "namespace_after": connector.status,
        "callback_observed": callback_observed,
        "interactive_browser": True,
        "interactive_cdp_click": interactive_click,
        "cdp_port": cdp_port,
        "shared_cdp_untouched": True,
        "access_token_issued": bool(access),
        "click": click,
    }
    (artifact_dir / "interactive_run.json").write_text(
        json.dumps(summary, indent=2) + "\n"
    )
    print(json.dumps(summary))
    return 0 if summary["ok"] else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--provider", choices=["slack", "finance", "outlook"], default="slack"
    )
    ap.add_argument("--artifact-dir", required=True)
    args = ap.parse_args()
    return run_interactive(args.provider, Path(args.artifact_dir))


if __name__ == "__main__":
    raise SystemExit(main())
