#!/usr/bin/env python3
"""Local inbound webhook HTTP listener (BITBOT_WEBHOOK_LISTEN=1 path).

POST /hooks → durable wake artifact under data/routines/webhooks/
(same shape as Host webhook_wake turn effect). Never echoes panel key.
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


def webhook_dir() -> Path:
    d = REPO_ROOT / "data" / "routines" / "webhooks"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _execute_inbound_turn(hook: Path, hooks_dir: Path, turn_prompt: str, hook_body: dict) -> dict:
    """Same Host path as webhook_wake / runInboundTurnHook when BITBOT_INBOUND_TURN=1."""
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


def write_wake(event_id: str, summary: str) -> dict:
    at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    dir_ = webhook_dir()
    ops = dir_ / "ops"
    ops.mkdir(parents=True, exist_ok=True)
    hooks = dir_ / "turn-hooks"
    hooks.mkdir(parents=True, exist_ok=True)
    wake_payload = f'<webhook_event id="{event_id}">{summary}</webhook_event>'
    snap = ops / f"wake-listen-{int(time.time() * 1000):x}.json"
    hook = hooks / f"hook-listen-{int(time.time() * 1000):x}.json"
    turn_prompt = f"Webhook inbound: {summary}"[:400]
    hook_body = {
        "event_id": event_id,
        "summary": summary,
        "wake_payload": wake_payload,
        "turn_prompt": turn_prompt,
        "status": "pending",
        "pretend_turn": False,
        "source": "http_listen",
        "at": at,
    }
    hook.write_text(json.dumps(hook_body, indent=2) + "\n", encoding="utf-8")
    with (dir_ / "pending-turns.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "event_id": event_id,
                    "hook_path": str(hook),
                    "turn_prompt": turn_prompt,
                    "status": "pending",
                    "at": at,
                }
            )
            + "\n"
        )
    # BITBOT_INBOUND_TURN=1 → same Host run_turn path as webhook_wake; else residual stays true.
    turn_hook = _execute_inbound_turn(hook, hooks, turn_prompt, hook_body)
    inbound_turn_residual = (not turn_hook.get("turn_executed")) or (not turn_hook.get("turn_ok"))
    artifact = {
        "mode": "host_webhook_listen",
        "pretend_wake": False,
        "event_id": event_id,
        "summary": summary,
        "wake_payload": wake_payload,
        "has_webhook_event": True,
        "key_leaked": False,
        "inbound_push_residual": False,
        "turn_hook": turn_hook,
        "inbound_turn_residual": inbound_turn_residual,
        "at": at,
    }
    snap.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    with (dir_ / "wakes.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "event_id": event_id,
                    "summary": summary,
                    "path": str(snap),
                    "hook_path": str(hook),
                    "inbound_push_residual": False,
                    "inbound_turn_residual": inbound_turn_residual,
                    "source": "http_listen",
                    "at": at,
                }
            )
            + "\n"
        )
    (dir_ / "last_wake.txt").write_text(wake_payload + "\n", encoding="utf-8")
    return artifact


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("[webhook-listen] " + (fmt % args) + "\n")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8", errors="replace") or "{}")
        except json.JSONDecodeError:
            return {"raw": raw.decode("utf-8", errors="replace")[:400]}

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/hooks", "/hooks/", "/"):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'{"ok":false,"error":"not found"}\n')
            return
        payload = self._read_json()
        event_id = str(payload.get("id") or payload.get("event_id") or f"evt-{int(time.time())}")
        summary = str(
            payload.get("summary")
            or payload.get("body")
            or payload.get("text")
            or "POST /hooks received"
        )[:400]
        # Never persist inbound Authorization / X-Webhook-Key values.
        artifact = write_wake(event_id, summary)
        # Include snap path for smoke without leaking keys.
        snap_hint = None
        for p in sorted((webhook_dir() / "ops").glob("wake-listen-*.json"))[-1:]:
            snap_hint = str(p)
        out = {
            "ok": True,
            "event_id": event_id,
            "inbound_push_residual": False,
            "inbound_turn_residual": artifact.get("inbound_turn_residual", True),
            "has_webhook_event": True,
            "path": snap_hint,
            "key_leaked": False,
            "turn_hook": artifact.get("turn_hook"),
        }
        data = json.dumps(out).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path in ("/health", "/"):
            data = b'{"ok":true,"service":"bitbot-webhook-listen"}\n'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(404)
        self.end_headers()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=int(os.environ.get("BITBOT_WEBHOOK_LISTEN_PORT") or 18791))
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    server = HTTPServer((args.host, args.port), Handler)
    sys.stderr.write(f"[webhook-listen] listening on http://{args.host}:{args.port}/hooks\n")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
