#!/usr/bin/env python3
"""Local email push HTTP listener (Gmail Pub/Sub + Outlook-shaped).

POST /email/push → durable inbound under data/channels/
(same residual honesty as host_slack_events_listen: push closed, turn optional).
Never persists OAuth / access tokens from the push body or headers.
Claim-only (mail list pull) keeps inbound_push_residual true.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_TURN_JS = REPO_ROOT / "hosts" / "cli_host" / "run_turn.js"

# Secrets that must never land in durable artifacts or HTTP responses.
_SENSITIVE_KEYS = (
    "access_token",
    "refresh_token",
    "id_token",
    "oauth_token",
    "client_secret",
    "clientSecret",
    "clientState",
    "Authorization",
    "authorization",
    "Bearer",
    "token",
)


def channels_dir() -> Path:
    d = REPO_ROOT / "data" / "channels"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _execute_inbound_turn(hook: Path, hooks_dir: Path, turn_prompt: str, hook_body: dict) -> dict:
    """Same Host path as channel claim / Slack events listen when BITBOT_INBOUND_TURN=1."""
    turn_hook: dict = {
        "hooked": True,
        "hook_path": str(hook),
        "turn_executed": False,
        "turn_ok": False,
        "turn_path": None,
        "error": None,
    }
    if os.environ.get("BITBOT_INBOUND_TURN") != "1":
        return turn_hook

    turn_out = hooks_dir / f"turn-listen-{int(time.time() * 1000):x}.json"
    env = {**os.environ, "BITBOT_INBOUND_TURN": "0"}  # prevent recursive inbound loops
    try:
        proc = subprocess.run(
            ["node", str(RUN_TURN_JS), "--approved", turn_prompt],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=60,
            env=env,
        )
        stdout = (proc.stdout or "").strip()
        stderr = (proc.stderr or "").strip()
        if not stdout:
            turn_out.write_text(
                json.dumps({"ok": False, "error": "empty turn stdout", "stderr": stderr[:400]}, indent=2)
                + "\n",
                encoding="utf-8",
            )
            turn_ok = False
        else:
            turn_out.write_text(stdout + "\n", encoding="utf-8")
            try:
                turn_ok = bool(json.loads(stdout).get("ok"))
            except json.JSONDecodeError:
                turn_ok = False
        hook_body["status"] = "executed" if turn_ok else "failed"
        hook_body["turn_path"] = str(turn_out)
        if not turn_ok:
            hook_body["error"] = "inbound turn returned ok=false"
        hook.write_text(json.dumps(hook_body, indent=2) + "\n", encoding="utf-8")
        turn_hook = {
            "hooked": True,
            "hook_path": str(hook),
            "turn_executed": True,
            "turn_ok": turn_ok,
            "turn_path": str(turn_out),
            "error": None if turn_ok else "inbound turn returned ok=false",
        }
    except Exception as err:  # noqa: BLE001 — mirror host_ffi catch width
        err_msg = str(err)[:240]
        hook_body["status"] = "failed"
        hook_body["error"] = err_msg
        hook.write_text(json.dumps(hook_body, indent=2) + "\n", encoding="utf-8")
        turn_hook = {
            "hooked": True,
            "hook_path": str(hook),
            "turn_executed": True,
            "turn_ok": False,
            "turn_path": None,
            "error": err_msg,
        }
    return turn_hook


def _token_leaked(blob: str, *tokens: str | None) -> bool:
    for token in tokens:
        if token and token in blob:
            return True
    return False


def _collect_sensitive_strings(payload: dict, auth_header: str | None) -> list[str]:
    found: list[str] = []
    if auth_header:
        # Strip "Bearer " prefix for leak checks of the raw credential.
        raw = auth_header.strip()
        if raw.lower().startswith("bearer "):
            raw = raw[7:].strip()
        if raw:
            found.append(raw)
        found.append(auth_header.strip())

    def walk(obj: object) -> None:
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in _SENSITIVE_KEYS and isinstance(v, str) and v.strip():
                    found.append(v.strip())
                walk(v)
        elif isinstance(obj, list):
            for item in obj:
                walk(item)

    walk(payload)
    return found


def _decode_pubsub_data(data_b64: str) -> dict:
    try:
        pad = "=" * (-len(data_b64) % 4)
        raw = base64.urlsafe_b64decode(data_b64 + pad)
        return json.loads(raw.decode("utf-8", errors="replace") or "{}")
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return {}


def parse_email_push(payload: dict) -> dict:
    """Normalize Gmail Pub/Sub or Outlook Graph notification into inbound fields."""
    provider = "email"
    event_id = ""
    mailbox = ""
    subject = ""
    text = ""
    history_id = ""
    resource = ""
    change_type = ""

    # Gmail Pub/Sub push: { message: { data, messageId, ... }, subscription }
    msg = payload.get("message") if isinstance(payload.get("message"), dict) else None
    if msg is not None:
        provider = "gmail"
        event_id = str(msg.get("messageId") or msg.get("message_id") or payload.get("event_id") or "")
        data_obj = {}
        if isinstance(msg.get("data"), str) and msg.get("data"):
            data_obj = _decode_pubsub_data(msg["data"])
        elif isinstance(msg.get("data"), dict):
            data_obj = msg["data"]
        mailbox = str(
            data_obj.get("emailAddress")
            or data_obj.get("email")
            or payload.get("emailAddress")
            or payload.get("mailbox")
            or ""
        )
        history_id = str(data_obj.get("historyId") or data_obj.get("history_id") or "")
        subject = str(data_obj.get("subject") or payload.get("subject") or "")
        text = str(
            data_obj.get("snippet")
            or data_obj.get("text")
            or payload.get("summary")
            or payload.get("text")
            or subject
            or (f"gmail historyId={history_id}" if history_id else "gmail pubsub push")
        )
        if not event_id:
            event_id = f"gmail-{history_id or int(time.time())}"

    # Outlook / Microsoft Graph change notification: { value: [ { ... } ] }
    elif isinstance(payload.get("value"), list) and payload["value"]:
        provider = "outlook"
        first = payload["value"][0] if isinstance(payload["value"][0], dict) else {}
        resource_data = first.get("resourceData") if isinstance(first.get("resourceData"), dict) else {}
        event_id = str(
            first.get("subscriptionId")
            or resource_data.get("id")
            or payload.get("event_id")
            or f"outlook-{int(time.time())}"
        )
        resource = str(first.get("resource") or "")
        change_type = str(first.get("changeType") or "")
        mailbox = str(
            first.get("mailbox")
            or payload.get("mailbox")
            or payload.get("emailAddress")
            or ""
        )
        subject = str(
            resource_data.get("subject")
            or first.get("subject")
            or payload.get("subject")
            or ""
        )
        text = str(
            first.get("summary")
            or payload.get("summary")
            or payload.get("text")
            or subject
            or f"outlook {change_type} {resource}".strip()
            or "outlook graph push"
        )

    # Flat / smoke-friendly shape
    else:
        provider = str(payload.get("provider") or payload.get("scheme") or "email").lower()
        if provider not in ("gmail", "outlook", "email"):
            provider = "email"
        event_id = str(
            payload.get("event_id")
            or payload.get("id")
            or payload.get("messageId")
            or f"email-{int(time.time())}"
        )
        mailbox = str(
            payload.get("mailbox")
            or payload.get("emailAddress")
            or payload.get("email")
            or payload.get("to")
            or ""
        )
        subject = str(payload.get("subject") or "")
        text = str(payload.get("text") or payload.get("summary") or payload.get("snippet") or subject or "")
        history_id = str(payload.get("historyId") or payload.get("history_id") or "")
        resource = str(payload.get("resource") or "")
        change_type = str(payload.get("changeType") or "")

    text = text[:400]
    return {
        "provider": provider,
        "event_id": event_id,
        "mailbox": mailbox or "unknown@local",
        "subject": subject[:200],
        "text": text,
        "history_id": history_id,
        "resource": resource,
        "change_type": change_type,
    }


def write_inbound_event(
    *,
    provider: str,
    event_id: str,
    mailbox: str,
    subject: str,
    text: str,
    history_id: str,
    resource: str,
    change_type: str,
    sensitive_tokens: list[str],
) -> dict:
    at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    dir_ = channels_dir()
    ops = dir_ / "ops"
    ops.mkdir(parents=True, exist_ok=True)
    hooks = dir_ / "turn-hooks"
    hooks.mkdir(parents=True, exist_ok=True)
    text_prefix = text[:80]
    inbound_row = {
        "scheme": "email",
        "provider": provider,
        "mailbox": mailbox,
        "subject": subject[:120],
        "text_len": len(text),
        "text_prefix": text_prefix,
        "mode": "live_email_events_push",
        "event_id": event_id,
        "history_id": history_id or None,
        "resource": resource or None,
        "change_type": change_type or None,
        "at": at,
    }
    # Drop nulls for cleaner jsonl
    inbound_row = {k: v for k, v in inbound_row.items() if v is not None}
    with (dir_ / "inbound.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(inbound_row) + "\n")

    snap = ops / f"event-listen-{int(time.time() * 1000):x}.json"
    hook = hooks / f"hook-listen-{int(time.time() * 1000):x}.json"
    turn_prompt = f"Email Events inbound: {provider} {mailbox} {text_prefix}".strip()[:400]
    hook_body = {
        "event_id": event_id,
        "scheme": "email",
        "provider": provider,
        "mailbox": mailbox,
        "text_prefix": text_prefix,
        "turn_prompt": turn_prompt,
        "status": "pending",
        "pretend_turn": False,
        "source": "email_events_http",
        "at": at,
    }
    hook.write_text(json.dumps(hook_body, indent=2) + "\n", encoding="utf-8")
    with (dir_ / "pending-turns.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "scheme": "email",
                    "provider": provider,
                    "event_id": event_id,
                    "mailbox": mailbox,
                    "hook_path": str(hook),
                    "turn_prompt": turn_prompt,
                    "status": "pending",
                    "at": at,
                }
            )
            + "\n"
        )
    # BITBOT_INBOUND_TURN=1 → same Host run_turn path as Slack/webhook listen; else residual stays true.
    turn_hook = _execute_inbound_turn(hook, hooks, turn_prompt, hook_body)
    inbound_turn_residual = (not turn_hook.get("turn_executed")) or (not turn_hook.get("turn_ok"))
    artifact = {
        "mode": "host_email_events_listen",
        "pretend_wake": False,
        "event_id": event_id,
        "scheme": "email",
        "provider": provider,
        "mailbox": mailbox,
        "subject": subject[:120],
        "text_prefix": text_prefix,
        "has_email_event": True,
        "token_leaked": False,
        "inbound_push_residual": False,
        "turn_hook": turn_hook,
        "inbound_turn_residual": inbound_turn_residual,
        "inbound": str(dir_ / "inbound.jsonl"),
        "at": at,
    }
    # Honesty: never persist OAuth / access tokens; re-check serialized artifact.
    serialized = json.dumps(artifact)
    if _token_leaked(serialized, *sensitive_tokens):
        artifact["token_leaked"] = True
    snap.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    with (dir_ / "email-events.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "event_id": event_id,
                    "provider": provider,
                    "mailbox": mailbox,
                    "path": str(snap),
                    "hook_path": str(hook),
                    "inbound_push_residual": False,
                    "inbound_turn_residual": inbound_turn_residual,
                    "token_leaked": artifact["token_leaked"],
                    "source": "email_events_http",
                    "at": at,
                }
            )
            + "\n"
        )
    return {**artifact, "path": str(snap)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("[email-events-listen] " + (fmt % args) + "\n")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8", errors="replace") or "{}")
        except json.JSONDecodeError:
            return {"raw": raw.decode("utf-8", errors="replace")[:400]}

    def _json_response(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _text_response(self, code: int, body: str) -> None:
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/email/push", "/email/push/", "/push", "/push/", "/"):
            self._json_response(404, {"ok": False, "error": "not found"})
            return
        payload = self._read_json()

        # Outlook subscription validation may arrive as POST with validationToken.
        validation = payload.get("validationToken")
        if isinstance(validation, str) and validation:
            self._text_response(200, validation)
            return

        auth_header = self.headers.get("Authorization")
        sensitive = _collect_sensitive_strings(payload, auth_header)

        parsed = parse_email_push(payload)
        artifact = write_inbound_event(
            provider=parsed["provider"],
            event_id=parsed["event_id"],
            mailbox=parsed["mailbox"],
            subject=parsed["subject"],
            text=parsed["text"],
            history_id=parsed["history_id"],
            resource=parsed["resource"],
            change_type=parsed["change_type"],
            sensitive_tokens=sensitive,
        )
        # Never echo OAuth / access tokens in the HTTP body.
        out = {
            "ok": True,
            "event_id": parsed["event_id"],
            "provider": parsed["provider"],
            "inbound_push_residual": False,
            "inbound_turn_residual": artifact.get("inbound_turn_residual", True),
            "has_email_event": True,
            "path": artifact.get("path"),
            "token_leaked": bool(artifact.get("token_leaked")),
            "turn_hook": artifact.get("turn_hook"),
        }
        out_blob = json.dumps(out)
        if _token_leaked(out_blob, *sensitive):
            out = {
                "ok": True,
                "event_id": parsed["event_id"],
                "provider": parsed["provider"],
                "inbound_push_residual": False,
                "inbound_turn_residual": artifact.get("inbound_turn_residual", True),
                "has_email_event": True,
                "path": artifact.get("path"),
                "token_leaked": True,
                "turn_hook": {
                    "hooked": True,
                    "turn_executed": (artifact.get("turn_hook") or {}).get("turn_executed"),
                    "turn_ok": (artifact.get("turn_hook") or {}).get("turn_ok"),
                    "hook_path": (artifact.get("turn_hook") or {}).get("hook_path"),
                    "turn_path": (artifact.get("turn_hook") or {}).get("turn_path"),
                },
            }
        self._json_response(200, out)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        # Outlook Graph subscription validation handshake.
        qs = parse_qs(parsed.query or "")
        validation = (qs.get("validationToken") or [None])[0]
        if validation:
            self._text_response(200, validation)
            return
        if parsed.path in ("/health", "/", "/email/push", "/email/push/"):
            self._json_response(200, {"ok": True, "service": "bitbot-email-events-listen"})
            return
        self._json_response(404, {"ok": False, "error": "not found"})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("BITBOT_EMAIL_EVENTS_LISTEN_PORT") or 18799),
    )
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    server = HTTPServer((args.host, args.port), Handler)
    sys.stderr.write(
        f"[email-events-listen] listening on http://{args.host}:{args.port}/email/push\n"
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
