#!/usr/bin/env python3
"""Local Slack Events API HTTP listener (inbound push path).

POST /slack/events → durable inbound under data/channels/
(same residual honesty as host_webhook_listen: push closed, turn optional).
Never echoes Slack verification token / Authorization headers.
Claim-only (conversations.history) keeps inbound_push_residual true.
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
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[1]
RUN_TURN_JS = REPO_ROOT / "hosts" / "cli_host" / "run_turn.js"


def channels_dir() -> Path:
    d = REPO_ROOT / "data" / "channels"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _execute_inbound_turn(hook: Path, hooks_dir: Path, turn_prompt: str, hook_body: dict) -> dict:
    """Same Host path as channel claim / webhook listen when BITBOT_INBOUND_TURN=1."""
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


def write_inbound_event(
    *,
    event_id: str,
    channel: str,
    user: str,
    text: str,
    ts: str,
    thread_ts: str,
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
        "scheme": "slack",
        "channel": channel,
        "ts": ts,
        "thread_ts": thread_ts,
        "user": user,
        "text_len": len(text),
        "text_prefix": text_prefix,
        "mode": "live_slack_events_push",
        "event_id": event_id,
        "at": at,
    }
    with (dir_ / "inbound.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(inbound_row) + "\n")

    snap = ops / f"event-listen-{int(time.time() * 1000):x}.json"
    hook = hooks / f"hook-listen-{int(time.time() * 1000):x}.json"
    turn_prompt = f"Slack Events inbound: {channel} {text_prefix}".strip()[:400]
    hook_body = {
        "event_id": event_id,
        "scheme": "slack",
        "channel": channel,
        "ts": ts,
        "text_prefix": text_prefix,
        "turn_prompt": turn_prompt,
        "status": "pending",
        "pretend_turn": False,
        "source": "slack_events_http",
        "at": at,
    }
    hook.write_text(json.dumps(hook_body, indent=2) + "\n", encoding="utf-8")
    with (dir_ / "pending-turns.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "scheme": "slack",
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
    # BITBOT_INBOUND_TURN=1 → same Host run_turn path as webhook listen; else residual stays true.
    turn_hook = _execute_inbound_turn(hook, hooks, turn_prompt, hook_body)
    inbound_turn_residual = (not turn_hook.get("turn_executed")) or (not turn_hook.get("turn_ok"))
    artifact = {
        "mode": "host_slack_events_listen",
        "pretend_wake": False,
        "event_id": event_id,
        "scheme": "slack",
        "channel": channel,
        "ts": ts,
        "thread_ts": thread_ts,
        "user": user,
        "text_prefix": text_prefix,
        "has_slack_event": True,
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
    with (dir_ / "slack-events.jsonl").open("a", encoding="utf-8") as fh:
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
                    "source": "slack_events_http",
                    "at": at,
                }
            )
            + "\n"
        )
    return {**artifact, "path": str(snap)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("[slack-events-listen] " + (fmt % args) + "\n")

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

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/slack/events", "/slack/events/", "/events", "/events/", "/"):
            self._json_response(404, {"ok": False, "error": "not found"})
            return
        payload = self._read_json()
        # Slack url_verification challenge (do not persist token).
        if payload.get("type") == "url_verification":
            challenge = str(payload.get("challenge") or "")
            self._json_response(200, {"challenge": challenge})
            return

        inbound_token = payload.get("token")
        if isinstance(inbound_token, str):
            inbound_token = inbound_token.strip() or None
        else:
            inbound_token = None

        event = payload.get("event") if isinstance(payload.get("event"), dict) else {}
        event_id = str(
            payload.get("event_id")
            or payload.get("id")
            or event.get("event_ts")
            or event.get("ts")
            or f"Ev-{int(time.time())}"
        )
        channel = str(event.get("channel") or payload.get("channel") or "Cunknown")
        user = str(event.get("user") or payload.get("user") or "")
        text = str(event.get("text") or payload.get("text") or payload.get("summary") or "")[:400]
        ts = str(event.get("ts") or event.get("event_ts") or f"{time.time():.6f}")
        thread_ts = str(event.get("thread_ts") or "")

        artifact = write_inbound_event(
            event_id=event_id,
            channel=channel,
            user=user,
            text=text,
            ts=ts,
            thread_ts=thread_ts,
            inbound_token=inbound_token,
        )
        # Never echo Authorization / Slack token in the HTTP body.
        out = {
            "ok": True,
            "event_id": event_id,
            "inbound_push_residual": False,
            "inbound_turn_residual": artifact.get("inbound_turn_residual", True),
            "has_slack_event": True,
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
                "has_slack_event": True,
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
        if urlparse(self.path).path in ("/health", "/"):
            self._json_response(200, {"ok": True, "service": "bitbot-slack-events-listen"})
            return
        self._json_response(404, {"ok": False, "error": "not found"})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("BITBOT_SLACK_EVENTS_LISTEN_PORT") or 18792),
    )
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    server = HTTPServer((args.host, args.port), Handler)
    sys.stderr.write(
        f"[slack-events-listen] listening on http://{args.host}:{args.port}/slack/events\n"
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
