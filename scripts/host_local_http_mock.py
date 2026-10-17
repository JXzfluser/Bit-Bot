#!/usr/bin/env python3
"""Tiny local HTTP mock for Host live residual smoke.

Usage:
  python3 scripts/host_local_http_mock.py --port 18765 --mode purchase
  python3 scripts/host_local_http_mock.py --port 18766 --mode meeting
  python3 scripts/host_local_http_mock.py --port 18768 --mode finance
  python3 scripts/host_local_http_mock.py --port 18769 --mode slack
  python3 scripts/host_local_http_mock.py --port 18770 --mode teams
  python3 scripts/host_local_http_mock.py --port 18771 --mode job
  python3 scripts/host_local_http_mock.py --port 18772 --mode x
  python3 scripts/host_local_http_mock.py --port 18773 --mode gmail
  python3 scripts/host_local_http_mock.py --port 18774 --mode cloud
  python3 scripts/host_local_http_mock.py --port 18775 --mode outlook
  python3 scripts/host_local_http_mock.py --port 18776 --mode calendar

Endpoints:
  purchase: POST /charge
  meeting:  POST /messages
  finance:  POST /tools/<name>
  slack:    POST /chat.postMessage
            POST /conversations.history
            POST /auth.test
            (BITBOT_SLACK_API_BASE=http://host:port)
  teams:    POST /chats/<id>/messages  (BITBOT_TEAMS_GRAPH_URL=http://host:port)
  job:      POST /jobs/search  (BITBOT_JOB_API_URL=http://host:port)
  x:        GET  /tweets/search/recent  (BITBOT_X_API_BASE=http://host:port)
  gmail:    POST /users/me/messages/send
            GET  /users/me/messages
            GET  /users/me/threads/<id>
            (BITBOT_GMAIL_API_BASE=http://host:port)
  cloud:    POST /agents  (BITBOT_CLOUD_API_URL=http://host:port)
  outlook:  POST /me/sendMail  (BITBOT_OUTLOOK_GRAPH_URL=http://host:port)
  calendar: POST /events  (BITBOT_CALENDAR_API_URL=http://host:port)
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument(
        "--mode",
        choices=(
            "purchase",
            "meeting",
            "finance",
            "slack",
            "teams",
            "job",
            "x",
            "gmail",
            "cloud",
            "outlook",
            "calendar",
        ),
        required=True,
    )
    ap.add_argument("--token", default="smoke-token")
    args = ap.parse_args()
    mode = args.mode
    expect = args.token

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *a) -> None:  # noqa: A003
            sys.stderr.write("[mock] " + (fmt % a) + "\n")

        def _auth_ok(self) -> bool:
            auth = self.headers.get("Authorization") or ""
            return auth.strip() == f"Bearer {expect}"

        def _json(self, code: int, obj: dict) -> None:
            data = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            path = self.path.split("?", 1)[0]
            ok_path = (
                (mode == "purchase" and path == "/charge")
                or (mode == "meeting" and path == "/messages")
                or (mode == "finance" and path.startswith("/tools/"))
                or (
                    mode == "slack"
                    and (
                        path.endswith("/chat.postMessage")
                        or path == "/chat.postMessage"
                        or path.endswith("/conversations.history")
                        or path == "/conversations.history"
                        or path.endswith("/auth.test")
                        or path == "/auth.test"
                    )
                )
                or (
                    mode == "teams"
                    and ("/chats/" in path and path.endswith("/messages"))
                )
                or (mode == "job" and path == "/jobs/search")
                or (mode == "gmail" and path.endswith("/users/me/messages/send"))
                or (mode == "cloud" and path == "/agents")
                or (mode == "outlook" and path.endswith("/me/sendMail"))
                or (mode == "calendar" and path == "/events")
            )
            if not ok_path:
                self._json(404, {"ok": False, "error": "not_found"})
                return
            if not self._auth_ok():
                self._json(401, {"ok": False, "error": "unauthorized"})
                return
            try:
                payload = json.loads(body.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                payload = {"raw": body.decode("utf-8", errors="replace")[:200]}
            if mode == "purchase":
                self._json(
                    200,
                    {
                        "ok": True,
                        "mode": mode,
                        "received": payload,
                        "charge_id": "mock-purchase-1",
                    },
                )
            elif mode == "meeting":
                self._json(
                    200,
                    {
                        "ok": True,
                        "mode": mode,
                        "received": payload,
                        "message_id": "mock-meeting-1",
                    },
                )
            elif mode == "finance":
                self._json(
                    200,
                    {
                        "ok": True,
                        "mode": mode,
                        "received": payload,
                        "balance": {"currency": "USD", "amount": 42.0},
                        "call_id": "mock-finance-1",
                    },
                )
            elif mode == "slack":
                if path.endswith("/auth.test") or path == "/auth.test":
                    self._json(
                        200,
                        {
                            "ok": True,
                            "url": "https://example.test/",
                            "team": "MockTeam",
                            "user": "bitbot_mock",
                            "team_id": "Tsmoke",
                            "user_id": "Usmoke",
                        },
                    )
                elif (
                    path.endswith("/conversations.history")
                    or path == "/conversations.history"
                ):
                    ch = payload.get("channel") or "Csmoke"
                    self._json(
                        200,
                        {
                            "ok": True,
                            "messages": [
                                {
                                    "type": "message",
                                    "user": "U_INBOUND",
                                    "text": f"live mock inbound for {ch}",
                                    "ts": "1710000000.000050",
                                },
                                {
                                    "type": "message",
                                    "user": "U_INBOUND",
                                    "text": "thread parent",
                                    "ts": "1710000000.000060",
                                    "thread_ts": "1710000000.000060",
                                },
                            ],
                            "has_more": False,
                        },
                    )
                else:
                    self._json(
                        200,
                        {
                            "ok": True,
                            "channel": payload.get("channel") or "Csmoke",
                            "ts": "1710000000.000200",
                            "message": {
                                "text": payload.get("text") or "",
                                "thread_ts": payload.get("thread_ts") or "",
                            },
                        },
                    )
            elif mode == "job":
                q = str(payload.get("query") or "role")
                self._json(
                    200,
                    {
                        "ok": True,
                        "jobs": [
                            {
                                "id": "job-live-1",
                                "title": f"{q} (live mock)",
                                "company": "Mock Employer",
                            },
                            {
                                "id": "job-live-2",
                                "title": f"{q} senior (live mock)",
                                "company": "Mock Employer",
                            },
                        ],
                    },
                )
            elif mode == "gmail":
                self._json(
                    200,
                    {
                        "id": "msg-mock-gmail-1",
                        "threadId": "t-invoice-1",
                        "labelIds": ["SENT"],
                    },
                )
            elif mode == "cloud":
                self._json(
                    200,
                    {
                        "ok": True,
                        "bc_id": payload.get("bc_id") or "bc-mock-cloud-1",
                        "status": "launched",
                        "url": "https://cursor.com/agents/bc-mock-cloud-1",
                    },
                )
            elif mode == "outlook":
                # Graph sendMail is typically 202 empty; return 202 + id for Host probes.
                self._json(
                    202,
                    {
                        "ok": True,
                        "id": "outlook-msg-mock-1",
                        "received": payload,
                    },
                )
            elif mode == "calendar":
                self._json(
                    200,
                    {
                        "ok": True,
                        "id": payload.get("id") or "cal-evt-mock-1",
                        "subject": payload.get("subject") or "",
                        "when": payload.get("when") or "",
                    },
                )
            else:  # teams
                self._json(
                    200,
                    {
                        "id": "mock-teams-msg-1",
                        "body": {
                            "content": payload.get("body", {}).get("content", "")
                        },
                    },
                )

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path
            if mode == "teams" and path.endswith("/me/chats"):
                if not self._auth_ok():
                    self._json(401, {"ok": False, "error": "unauthorized"})
                    return
                self._json(200, {"value": [{"id": "Tsmoke", "topic": "smoke"}]})
                return
            if mode == "x" and path.endswith("/tweets/search/recent"):
                if not self._auth_ok():
                    self._json(401, {"ok": False, "error": "unauthorized"})
                    return
                qs = parse_qs(parsed.query)
                q = (qs.get("query") or ["x"])[0]
                self._json(
                    200,
                    {
                        "data": [
                            {"id": "x-live-1", "text": f"live mock hit for {q}"},
                            {"id": "x-live-2", "text": f"second hit {q}"},
                        ],
                        "meta": {"result_count": 2},
                    },
                )
                return
            if mode == "gmail" and path.endswith("/users/me/messages"):
                if not self._auth_ok():
                    self._json(401, {"ok": False, "error": "unauthorized"})
                    return
                qs = parse_qs(parsed.query)
                q = (qs.get("q") or ["mail"])[0]
                self._json(
                    200,
                    {
                        "messages": [
                            {
                                "id": "m-live-1",
                                "threadId": "t-invoice-1",
                            },
                            {
                                "id": "m-live-2",
                                "threadId": "t-live-2",
                            },
                        ],
                        "resultSizeEstimate": 2,
                        "query": q,
                    },
                )
                return
            if mode == "gmail" and "/users/me/threads/" in path:
                if not self._auth_ok():
                    self._json(401, {"ok": False, "error": "unauthorized"})
                    return
                tid = path.rstrip("/").split("/")[-1]
                self._json(
                    200,
                    {
                        "id": tid,
                        "snippet": f"Live mock thread {tid}",
                        "historyId": "1",
                        "messages": [{"id": "m-live-1", "threadId": tid}],
                    },
                )
                return
            self._json(404, {"ok": False, "error": "not_found"})

    httpd = HTTPServer(("127.0.0.1", args.port), Handler)
    print(json.dumps({"ok": True, "port": args.port, "mode": mode}), flush=True)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
