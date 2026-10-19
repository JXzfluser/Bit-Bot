#!/usr/bin/env python3
"""Local Twilio-style SMS inbound HTTP listener (inbound push path).

POST /sms/inbound → durable inbound under data/channels/
(same residual honesty as host_webhook_listen / host_slack_events_listen:
push closed, turn optional). Never echoes AuthToken / Authorization headers.
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


def write_inbound_sms(
    *,
    message_sid: str,
    from_addr: str,
    to_addr: str,
    body: str,
    inbound_token: str | None,
) -> dict:
    at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    dir_ = channels_dir()
    sms_dir = dir_ / "sms"
    sms_dir.mkdir(parents=True, exist_ok=True)
    ops = dir_ / "ops"
    ops.mkdir(parents=True, exist_ok=True)
    hooks = dir_ / "turn-hooks"
    hooks.mkdir(parents=True, exist_ok=True)
    text_prefix = body[:80]
    inbound_row = {
        "scheme": "sms",
        "id": message_sid,
        "from": from_addr,
        "to": to_addr,
        "text_len": len(body),
        "text_prefix": text_prefix,
        "mode": "live_sms_events_push",
        "event_id": message_sid,
        "at": at,
    }
    with (dir_ / "inbound.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(inbound_row) + "\n")
    with (sms_dir / "inbound.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(inbound_row) + "\n")

    snap = ops / f"sms-listen-{int(time.time() * 1000):x}.json"
    hook = hooks / f"hook-listen-{int(time.time() * 1000):x}.json"
    turn_prompt = f"SMS inbound: {from_addr} {text_prefix}".strip()[:400]
    hook_body = {
        "event_id": message_sid,
        "scheme": "sms",
        "from": from_addr,
        "to": to_addr,
        "text_prefix": text_prefix,
        "turn_prompt": turn_prompt,
        "status": "pending",
        "pretend_turn": False,
        "source": "sms_inbound_http",
        "at": at,
    }
    hook.write_text(json.dumps(hook_body, indent=2) + "\n", encoding="utf-8")
    with (dir_ / "pending-turns.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "scheme": "sms",
                    "event_id": message_sid,
                    "from": from_addr,
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
        "mode": "host_sms_listen",
        "pretend_wake": False,
        "event_id": message_sid,
        "scheme": "sms",
        "from": from_addr,
        "to": to_addr,
        "text_prefix": text_prefix,
        "has_sms_event": True,
        "token_leaked": False,
        "inbound_push_residual": False,
        "turn_hook": turn_hook,
        "inbound_turn_residual": inbound_turn_residual,
        "inbound": str(dir_ / "inbound.jsonl"),
        "at": at,
    }
    # Honesty: never persist AuthToken / Bearer; re-check serialized artifact.
    serialized = json.dumps(artifact)
    if _token_leaked(serialized, inbound_token):
        artifact["token_leaked"] = True
    snap.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    with (dir_ / "sms-events.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(
            json.dumps(
                {
                    "event_id": message_sid,
                    "from": from_addr,
                    "to": to_addr,
                    "path": str(snap),
                    "hook_path": str(hook),
                    "inbound_push_residual": False,
                    "inbound_turn_residual": inbound_turn_residual,
                    "token_leaked": artifact["token_leaked"],
                    "source": "sms_inbound_http",
                    "at": at,
                }
            )
            + "\n"
        )
    return {**artifact, "path": str(snap)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("[sms-listen] " + (fmt % args) + "\n")

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _parse_payload(self) -> dict:
        raw = self._read_body()
        ctype = (self.headers.get("Content-Type") or "").lower()
        if "application/json" in ctype:
            try:
                return json.loads(raw.decode("utf-8", errors="replace") or "{}")
            except json.JSONDecodeError:
                return {"raw": raw.decode("utf-8", errors="replace")[:400]}
        # Twilio-style application/x-www-form-urlencoded (default).
        try:
            form = parse_qs(raw.decode("utf-8", errors="replace"), keep_blank_values=True)
        except Exception:  # noqa: BLE001
            return {"raw": raw.decode("utf-8", errors="replace")[:400]}
        flat: dict = {}
        for k, vals in form.items():
            flat[k] = vals[0] if isinstance(vals, list) and vals else vals
        # Also accept JSON posted without Content-Type for smoke convenience.
        if not flat and raw.strip().startswith(b"{"):
            try:
                return json.loads(raw.decode("utf-8", errors="replace") or "{}")
            except json.JSONDecodeError:
                pass
        return flat

    def _json_response(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/sms/inbound", "/sms/inbound/", "/inbound", "/inbound/", "/"):
            self._json_response(404, {"ok": False, "error": "not found"})
            return
        payload = self._parse_payload()

        # Never echo AuthToken / Authorization / Account auth secrets.
        auth_hdr = self.headers.get("Authorization") or ""
        inbound_token = None
        for candidate in (
            payload.get("AuthToken"),
            payload.get("auth_token"),
            payload.get("token"),
            auth_hdr.replace("Bearer ", "").strip() if auth_hdr else None,
        ):
            if isinstance(candidate, str) and candidate.strip():
                inbound_token = candidate.strip()
                break

        message_sid = str(
            payload.get("MessageSid")
            or payload.get("SmsSid")
            or payload.get("SmsMessageSid")
            or payload.get("message_sid")
            or payload.get("id")
            or payload.get("event_id")
            or f"SM{int(time.time())}"
        )
        from_addr = str(payload.get("From") or payload.get("from") or "")
        to_addr = str(payload.get("To") or payload.get("to") or "")
        body = str(payload.get("Body") or payload.get("body") or payload.get("text") or "")[:400]

        artifact = write_inbound_sms(
            message_sid=message_sid,
            from_addr=from_addr,
            to_addr=to_addr,
            body=body,
            inbound_token=inbound_token,
        )
        # Never echo Authorization / AuthToken in the HTTP body.
        out = {
            "ok": True,
            "event_id": message_sid,
            "inbound_push_residual": False,
            "inbound_turn_residual": artifact.get("inbound_turn_residual", True),
            "has_sms_event": True,
            "path": artifact.get("path"),
            "token_leaked": bool(artifact.get("token_leaked")),
            "turn_hook": artifact.get("turn_hook"),
        }
        out_blob = json.dumps(out)
        if _token_leaked(out_blob, inbound_token):
            out = {
                "ok": True,
                "event_id": message_sid,
                "inbound_push_residual": False,
                "inbound_turn_residual": artifact.get("inbound_turn_residual", True),
                "has_sms_event": True,
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
            self._json_response(200, {"ok": True, "service": "bitbot-sms-listen"})
            return
        self._json_response(404, {"ok": False, "error": "not found"})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("BITBOT_SMS_LISTEN_PORT") or 18796),
    )
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()
    server = HTTPServer((args.host, args.port), Handler)
    sys.stderr.write(f"[sms-listen] listening on http://{args.host}:{args.port}/sms/inbound\n")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
