"""Production-shaped connector adapters (Slack / Gmail / Outlook / sandbox IdP).

Env tokens (absent → sandbox IdP path, not live):
  SLACK_BOT_TOKEN       — Slack Web API; without it mode=sandbox_idp
  BITBOT_SLACK_POST=1   — allow chat.postMessage (draft-first otherwise)
  SLACK_DEFAULT_CHANNEL — channel for optional posts
  data/connectors/gmail.json | outlook.json — OAuth access_token for email;
    without those files mode=sandbox_idp and Connected is disk-only
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

from . import persist

# Documented env / disk credentials. Absent → sandbox, never invent live.
CONNECTOR_ENV_DOCS = {
    "slack": {
        "env": ["SLACK_BOT_TOKEN", "BITBOT_SLACK_POST", "SLACK_DEFAULT_CHANNEL"],
        "required_for_live": ["SLACK_BOT_TOKEN"],
        "disk": "data/connectors/slack.json",
    },
    "gmail": {
        "env": [],
        "required_for_live": [],
        "disk": "data/connectors/gmail.json (access_token or oauth.access_token)",
    },
    "outlook": {
        "env": [],
        "required_for_live": [],
        "disk": "data/connectors/outlook.json (access_token or oauth.access_token)",
    },
}


def connector_status(name: str) -> dict[str, Any]:
    name = (name or "").strip().lower()
    if name == "slack":
        return slack_status()
    if name in ("gmail", "outlook"):
        return email_status(name)
    return sandbox_idp_status(name or "sandbox")


def connectors_status_report() -> dict[str, Any]:
    """Live vs sandbox snapshot for POST /api/host/connectors/status."""
    names = ("slack", "gmail", "outlook")
    connectors = {}
    for n in names:
        st = connector_status(n)
        connectors[n] = {
            "connector": n,
            "mode": st.get("mode"),
            "connected": bool(st.get("connected")),
            "live": st.get("mode") in ("live", "oauth_token_file"),
            "sandbox": st.get("mode") == "sandbox_idp",
            "detail": st.get("detail"),
            "docs": CONNECTOR_ENV_DOCS.get(n),
        }
    env_present = {
        "SLACK_BOT_TOKEN": bool((os.environ.get("SLACK_BOT_TOKEN") or "").strip()),
        "BITBOT_SLACK_POST": os.environ.get("BITBOT_SLACK_POST") == "1",
        "SLACK_DEFAULT_CHANNEL": bool(
            (os.environ.get("SLACK_DEFAULT_CHANNEL") or "").strip()
        ),
        "gmail_token_file": bool(
            persist.load_connector_state("gmail").get("access_token")
            or persist.load_connector_state("gmail").get("token")
            or (persist.load_connector_state("gmail").get("oauth") or {}).get(
                "access_token"
            )
        ),
        "outlook_token_file": bool(
            persist.load_connector_state("outlook").get("access_token")
            or persist.load_connector_state("outlook").get("token")
            or (persist.load_connector_state("outlook").get("oauth") or {}).get(
                "access_token"
            )
        ),
    }
    return {
        "ok": True,
        "connectors": connectors,
        "env": env_present,
        "note": (
            "Absent SLACK_BOT_TOKEN / Gmail-Outlook OAuth JSON → sandbox_idp; "
            "Connected may still be true from prior disk mark."
        ),
    }


def slack_status(*, draft_text: str | None = None, channel: str | None = None) -> dict[str, Any]:
    token = (os.environ.get("SLACK_BOT_TOKEN") or "").strip()
    state = persist.load_connector_state("slack")
    if not token:
        # Local sandbox IdP path — Connected state on disk when previously linked
        connected = bool(state.get("connected"))
        out = {
            "connector": "slack",
            "mode": "sandbox_idp",
            "connected": connected,
            "auth_test": None,
            "detail": state.get("detail") or "SLACK_BOT_TOKEN unset; sandbox IdP path",
        }
        if connected:
            persist.save_connector_state("slack", {**state, **out})
        return out

    auth = _slack_api("auth.test", token)
    ok = bool(auth.get("ok"))
    out: dict[str, Any] = {
        "connector": "slack",
        "mode": "live",
        "connected": ok,
        "auth_test": {
            "ok": ok,
            "team": auth.get("team"),
            "user": auth.get("user"),
            "error": auth.get("error"),
        },
        "detail": "auth.test ok" if ok else f"auth.test failed: {auth.get('error')}",
    }
    post_result = None
    if ok and draft_text:
        # Draft-first: store draft; only post if BITBOT_SLACK_POST=1
        draft = {
            "channel": channel or os.environ.get("SLACK_DEFAULT_CHANNEL") or "",
            "text": draft_text,
            "ts": time.time(),
            "posted": False,
        }
        if os.environ.get("BITBOT_SLACK_POST") == "1" and draft["channel"]:
            post_result = _slack_api(
                "chat.postMessage",
                token,
                {"channel": draft["channel"], "text": draft_text},
            )
            draft["posted"] = bool(post_result.get("ok"))
            draft["post_result"] = {
                "ok": post_result.get("ok"),
                "error": post_result.get("error"),
                "ts": post_result.get("ts"),
            }
        else:
            draft["posted"] = False
            draft["note"] = "draft-first; set BITBOT_SLACK_POST=1 to send"
        out["draft"] = draft
    persist.save_connector_state("slack", {**state, **out, "connected": ok})
    return out


def _slack_api(method: str, token: str, payload: dict | None = None) -> dict:
    url = f"https://slack.com/api/{method}"
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json; charset=utf-8",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "error": f"http_{e.code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def email_status(provider: str) -> dict[str, Any]:
    """Gmail/Outlook: use OAuth tokens in /workspace/data/connectors/*.json if present."""
    provider = provider.lower()
    path_key = provider
    state = persist.load_connector_state(path_key)
    token = (
        state.get("access_token")
        or state.get("token")
        or (state.get("oauth") or {}).get("access_token")
    )
    if token:
        out = {
            "connector": provider,
            "mode": "oauth_token_file",
            "connected": True,
            "detail": f"token present in data/connectors/{provider}.json",
            "has_refresh": bool(
                state.get("refresh_token")
                or (state.get("oauth") or {}).get("refresh_token")
            ),
        }
        persist.save_connector_state(path_key, {**state, **out})
        return out
    return sandbox_idp_status(provider)


def sandbox_idp_status(name: str) -> dict[str, Any]:
    """Local sandbox IdP path; persist Connected when marked linked."""
    state = persist.load_connector_state(name)
    connected = bool(state.get("connected"))
    out = {
        "connector": name,
        "mode": "sandbox_idp",
        "connected": connected,
        "detail": state.get("detail")
        or "no production OAuth token; sandbox IdP path (Connected stored on disk)",
    }
    persist.save_connector_state(name, {**state, **out})
    return out


def mark_sandbox_connected(name: str, connected: bool = True) -> dict[str, Any]:
    state = persist.load_connector_state(name)
    state.update(
        {
            "connector": name,
            "mode": "sandbox_idp",
            "connected": bool(connected),
            "detail": "sandbox IdP Connected" if connected else "sandbox IdP disconnected",
        }
    )
    return persist.save_connector_state(name, state)
