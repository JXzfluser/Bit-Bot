#!/usr/bin/env python3
"""Local meeting chat events HTTP listener (inbound push path).

POST /meeting/events → durable inbound under data/channels/
(same residual honesty as host_teams_events_listen: push closed, turn optional).
Never echoes meeting verification token / Authorization headers.
Claim-only (GET /messages) keeps inbound_push_residual true.
"""
from __future__ import annotations

import argparse
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


def channels_dir() -> Path:
    d = REPO_ROOT / "data" / "channels"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _execute_inbound_turn(hook: Path, hooks_dir: Path, turn_prompt: str, hook_body: dict) -> dict:
    """Same Host path as channel claim / Teams Events listen when BITBOT_INBOUND_TURN=1."""
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


def _token_leaked(blob: str, token: str | None) -> bool:
    if not token:
        return False
    return token in blob


def _meeting_from_resource(resource: str) -> str:
    # Resource shapes: meetings/{id}/messages/{mid} or /meetings('{id}')/messages('{mid}')
    parts = resource.replace("'", "/").replace("(", "/").replace(")", "/").split("/")
    for i, p in enumerate(parts):
        if p in ("meetings", "meeting") and i + 1 < len(parts) and parts[i + 1]:
            return parts[i + 1]
    return ""


def write_inbound_event(
    *,
    event_id: str,
    channel: str,
    user: str,
    text: str,
    message_id: str,
    inbound_token: str | None,
) -> dict:
    at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    dir_ = channels_dir()
    ops = dir_ / "ops"
    ops.mkdir(parents=True, exist_ok=True)
    hooks = dir_ / "turn-hooks"
    hooks.mkdir(parents=True, exist_ok=True)
    text_prefix = text[:80]
    inbound_row = {
        "scheme": "meeting_chat",
        "channel": channel,
        "id": message_id or event_id,
        "user": user,
        "text_len": len(text),
        "text_prefix": text_prefix,
        "mode": "live_meeting_events_push",
        "event_id": event_id,
        "at": at,
    }
    with (dir_ / "inbound.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(inbound_row) + "\n")

    snap = ops / f"event-listen-{int(time.time() * 1000):x}.json"
    hook = hooks / f"hook-listen-{int(time.time() * 1000):x}.json"
    turn_prompt = f"Meeting events inbound: {channel} {text_prefix}".strip()[:400]
    hook_body = {
        "event_id": event_id,
        "scheme": "meeting_chat",
        "channel": channel,
        "id": message_id or event_id,
        "text_prefix": text_prefix,
        "turn_prompt": turn_prompt,
        "status": "pending",
        "pretend_turn": False,
        "source": "meeting_events_http",
        "at": at,
    }
    hook.write_text(json.dumps(hook_body, indent=2) + "\n", encoding="utf-8")
    with (dir_ / "pending-turns.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "scheme": "meeting_chat",
                    "event_id": event_id,
                    "channel": channel,
                    "hook_path": str(hook),
                    "turn_prompt": turn_prompt,
                    "status": "pending",
                    "at": at,
                }
            )
            + "\n"
        )
    # BITBOT_INBOUND_TURN=1 → same Host run_turn path as Teams Events listen; else residual stays true.
    turn_hook = _execute_inbound_turn(hook, hooks, turn_prompt, hook_body)
    inbound_turn_residual = (not turn_hook.get("turn_executed")) or (not turn_hook.get("turn_ok"))
    artifact = {
        "mode": "host_meeting_events_listen",
        "pretend_wake": False,
        "event_id": event_id,
        "scheme": "meeting_chat",
        "channel": channel,
        "id": message_id or event_id,
        "user": user,
        "text_prefix": text_prefix,
        "has_meeting_event": True,
        "token_leaked": False,
        "inbound_push_residual": False,
        "turn_hook": turn_hook,
        "inbound_turn_residual": inbound_turn_residual,
        "inbound": str(dir_ / "inbound.jsonl"),
        "at": at,
    }
    # Honesty: never persist verification token; re-check serialized artifact.
    serialized = json.dumps(artifact)
    if _token_leaked(serialized, inbound_token):
        artifact["token_leaked"] = True
    snap.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    with (dir_ / "meeting-events.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "event_id": event_id,
                    "channel": channel,
                    "path": str(snap),
                    "hook_path": str(hook),
                    "inbound_push_residual": False,
                    "inbound_turn_residual": inbound_turn_residual,
                    "token_leaked": artifact["token_leaked"],
                    "source": "meeting_events_http",
                    "at": at,
                }
            )
            + "\n"
        )
    return {**artifact, "path": str(snap)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("[meeting-events-listen] " + (fmt % args) + "\n")

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

    def _text_response(self, code: int, text: str) -> None:
        data = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_validation(self) -> bool:
        """Subscription handshake: echo validationToken as plain text (never persist)."""
        qs = parse_qs(urlparse(self.path).query)
        tokens = qs.get("validationToken") or qs.get("validationtoken") or []
        if not tokens:
            return False
        self._text_response(200, tokens[0])
        return True

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in (
            "/meeting/events",
            "/meeting/events/",
            "/meetings/events",
            "/meetings/events/",
            "/",
        ):
            self._json_response(404, {"ok": False, "error": "not found"})
            return
        if self._handle_validation():
            return

        payload = self._read_json()
        # Prefer notification batch (`value[]`); fall back to flat smoke payload.
        note = {}
        values = payload.get("value")
        if isinstance(values, list) and values and isinstance(values[0], dict):
            note = values[0]
        resource_data = note.get("resourceData") if isinstance(note.get("resourceData"), dict) else {}

        inbound_token = (
            note.get("clientState")
            or payload.get("clientState")
            or payload.get("token")
        )
        if isinstance(inbound_token, str):
            inbound_token = inbound_token.strip() or None
        else:
            inbound_token = None

        resource = str(note.get("resource") or payload.get("resource") or "")
        channel = str(
            payload.get("channel")
            or payload.get("meeting_id")
            or note.get("meetingId")
            or _meeting_from_resource(resource)
            or "Munknown"
        )
        message_id = str(
            resource_data.get("id")
            or note.get("id")
            or payload.get("id")
            or payload.get("message_id")
            or ""
        )
        event_id = str(
            payload.get("event_id")
            or note.get("subscriptionId")
            or message_id
            or f"Mn-{int(time.time())}"
        )
        user = ""
        if payload.get("user"):
            user = str(payload.get("user"))
        elif isinstance(resource_data.get("from"), dict):
            from_user = (resource_data.get("from") or {}).get("user") or {}
            if isinstance(from_user, dict) and from_user.get("id"):
                user = str(from_user.get("id"))
        elif payload.get("from"):
            user = str(payload.get("from"))
        body = resource_data.get("body") if isinstance(resource_data.get("body"), dict) else {}
        text = str(
            payload.get("text")
            or payload.get("summary")
            or body.get("content")
            or note.get("text")
            or resource_data.get("text")
            or ""
        )[:400]

        artifact = write_inbound_event(
            event_id=event_id,
            channel=channel,
            user=user,
            text=text,
            message_id=message_id,
            inbound_token=inbound_token,
        )
        # Never echo Authorization / meeting verification token in the HTTP body.
        out = {
            "ok": True,
            "event_id": event_id,
            "inbound_push_residual": False,
            "inbound_turn_residual": artifact.get("inbound_turn_residual", True),
            "has_meeting_event": True,
            "path": artifact.get("path"),
            "token_leaked": bool(artifact.get("token_leaked")),
            "turn_hook": artifact.get("turn_hook"),
        }
        out_blob = json.dumps(out)
        if _token_leaked(out_blob, inbound_token):
            out["token_leaked"] = True
            # Strip any accidental leak by rebuilding without sensitive fields.
            out = {
                "ok": True,
                "event_id": event_id,
                "inbound_push_residual": False,
                "inbound_turn_residual": artifact.get("inbound_turn_residual", True),
                "has_meeting_event": True,
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
        if self._handle_validation():
            return
        if urlparse(self.path).path in ("/health", "/"):
            self._json_response(200, {"ok": True, "service": "bitbot-meeting-events-listen"})
            return
        self._json_response(404, {"ok": False, "error": "not found"})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("BITBOT_MEETING_EVENTS_LISTEN_PORT") or 18803),
    )
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    server = HTTPServer((args.host, args.port), Handler)
    sys.stderr.write(
        f"[meeting-events-listen] listening on http://{args.host}:{args.port}/meeting/events\n"
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
