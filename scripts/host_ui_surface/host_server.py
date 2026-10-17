#!/usr/bin/env python3
"""Bit Bot Host UI process (C′): static surface + HostUiShell Live HTTP API.

Smoke / Live adapter MUST drive UI via /api/host/* (HostUiShell methods),
NOT via CDP Runtime.evaluate of page JS (that is B / rejected for I).
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
LOCK = threading.Lock()
STATE = {
    "settingsOpen": False,
    "entry": None,
    "anchor": None,
    "deletePhase": None,
    "deleteAgent": None,
    "contextMenuOpen": False,
    "contextMenuAgent": None,
    "activeTab": "General",
    "updateComputerPhase": "idle",
    "updateComputerPrompt": None,
    "localExecutionEnabled": True,
    "lastMachineCall": None,
    "gateLog": [],
    # Batch-3 (CM-0204/0205/0206/1401/1405/2178)
    "agents": [
        {"id": "h2-throwaway-agent", "name": "H2 Throwaway Agent", "hidden": False},
        {"id": "demo-agent", "name": "Demo Agent", "hidden": False},
    ],
    "activeChat": None,
    "activeChatHidden": False,
    "infoPanel": {"open": False, "agentId": None, "view": None, "sections": [], "members": []},
    "notify": {},
    "permissionGuide": {"open": False, "kind": None, "namespace": None, "anchor": None,
                        "connected": False, "status": None, "followed": False},
    # H3 CM-0411 webhook panel
    "webhookPanel": {
        "open": False,
        "url": None,
        "key_present": False,
        "key_masked": None,
        "last_copy": None,
    },
    # H3 CM-0705 device permission card (Host gate; not OS dialog)
    "devicePermissionCard": {
        "open": False,
        "machine_id": None,
        "tool_name": None,
        "permission_label": None,
        "shown": False,
    },
    # H5 CM-2101 / 2128 — chat message + emoji reaction pill
    "chatMessages": [
        {
            "id": "msg-h5-1",
            "role": "assistant",
            "text": "H5 sample message for ReactToMessage pill.",
            "reactions": {},
        }
    ],
    "reactPill": {"message_id": None, "emoji": None, "visible": False},
    "endTurnLeftPill": False,
    # H5 CM-2103 math / mermaid render surface
    "mathMermaid": {
        "open": False,
        "math_tex": None,
        "math_rendered": False,
        "mermaid_src": None,
        "mermaid_rendered": False,
    },
    # H5 CM-2131 cursor-agent card
    "cursorAgentCard": {
        "open": False,
        "agent_id": None,
        "url": None,
        "shown": False,
    },
    "surface": "bit-bot-host-ui",
    "i_claimed": False,
    # CM-1507: page→Host DOM viewport receipt after render (scrollTop/boundingRect)
    "anchorViewport": None,
    "rev": 0,
}
EVENTS: list[dict] = []
AUDIT: list[dict] = []


def _push_event(kind: str, **payload):
    ev = {
        "id": str(uuid.uuid4()),
        "ts": time.time(),
        "kind": kind,
        **payload,
    }
    EVENTS.append(ev)
    return ev


def _audit(tool: str, ok: bool, detail: str, artifact_path: str | None = None):
    span = {
        "id": str(uuid.uuid4()),
        "tool_name": tool,
        "duration_ms": 0,
        "ok": ok,
        "detail": detail,
        "artifact_path": artifact_path,
        "ts": time.time(),
    }
    AUDIT.append(span)
    return span


def apply_open_settings(entry: str, anchor: str | None):
    with LOCK:
        STATE["settingsOpen"] = True
        STATE["infoPanel"] = dict(STATE["infoPanel"], open=False)
        STATE["entry"] = entry
        STATE["anchor"] = anchor
        if anchor:
            STATE["anchorViewport"] = None
        tab = _tab_for_anchor(anchor)
        if tab:
            STATE["activeTab"] = tab
        STATE["rev"] += 1
        _push_event(
            "SettingsOpened",
            entry=entry,
            anchor=anchor,
        )
        if anchor:
            _push_event("SettingsAnchorVisible", anchor=anchor)
        span = _audit(
            "host_ui:open_settings",
            True,
            f"SettingsOpened entry={entry} anchor={anchor or 'none'}",
        )
        return {"state": dict(STATE), "event_tail": EVENTS[-2:], "audit": span}


def _tab_for_anchor(anchor: str | None) -> str | None:
    if not anchor:
        return None
    computer = {"local-execution", "computers", "update-computer", "reset-computer"}
    updates = {"update-status", "update-channel", "automatic-updates"}
    if anchor in computer:
        return "Computer"
    if anchor in updates:
        return "Updates"
    billing = {"usage", "plan", "cancel-trial", "on-demand", "billing"}
    if anchor in billing:
        return "Usage & Billing"
    return "General"


def apply_anchor_visible(anchor: str):
    with LOCK:
        STATE["settingsOpen"] = True
        STATE["anchor"] = anchor
        # Invalidate prior page receipt; page will POST report_anchor_viewport after render
        STATE["anchorViewport"] = None
        tab = _tab_for_anchor(anchor)
        if tab:
            STATE["activeTab"] = tab
        # Clear Update Computer prompt when navigating to other anchors
        if anchor != "update-computer":
            if STATE.get("updateComputerPhase") not in (
                "prompted",
                "awaiting-second-confirm",
            ):
                STATE["updateComputerPhase"] = "idle"
                STATE["updateComputerPrompt"] = None
        STATE["rev"] += 1
        _push_event("SettingsAnchorVisible", anchor=anchor)
        span = _audit(
            "host_ui:settings_anchor_visible",
            True,
            f"SettingsAnchorVisible anchor={anchor}",
        )
        return {"state": dict(STATE), "event_tail": EVENTS[-1:], "audit": span}


def apply_open_sidebar_context_menu(agent_id: str):
    """Show sidebar agent context menu (pre-Delete). Distinct UI from confirm dialog."""
    with LOCK:
        STATE["contextMenuOpen"] = True
        STATE["contextMenuAgent"] = agent_id
        STATE["deleteAgent"] = agent_id
        # Confirm dialog must NOT be open yet
        STATE["deletePhase"] = None
        STATE["settingsOpen"] = False
        STATE["rev"] += 1
        _push_event(
            "SidebarContextMenuOpened",
            agent_id=agent_id,
            path="sidebar-context-menu",
        )
        span = _audit(
            "host_ui:open_sidebar_context_menu",
            True,
            f"context menu visible for agent={agent_id}",
        )
        return {"state": dict(STATE), "event_tail": EVENTS[-1:], "audit": span}


def apply_request_delete(agent_id: str):
    with LOCK:
        # Closing context menu as Delete is chosen → confirm dialog
        STATE["contextMenuOpen"] = False
        STATE["deleteAgent"] = agent_id
        STATE["deletePhase"] = "requested"
        STATE["rev"] += 1
        _push_event(
            "DeleteAgentPhaseChanged", agent_id=agent_id, phase="requested"
        )
        STATE["deletePhase"] = "awaiting-confirm"
        STATE["rev"] += 1
        _push_event(
            "DeleteAgentPhaseChanged",
            agent_id=agent_id,
            phase="awaiting-confirm",
        )
        span = _audit(
            "host_ui:request_delete_agent",
            True,
            f"AwaitingConfirm agent={agent_id}",
        )
        return {"state": dict(STATE), "event_tail": EVENTS[-2:], "audit": span}


def apply_cancel_delete(agent_id: str | None = None):
    with LOCK:
        aid = agent_id or STATE.get("deleteAgent") or ""
        if STATE.get("deletePhase") not in ("awaiting-confirm", "requested"):
            span = _audit(
                "host_ui:cancel_delete_agent",
                False,
                f"cancel only from AwaitingConfirm; got {STATE.get('deletePhase')}",
            )
            return {"error": "bad_phase", "state": dict(STATE), "audit": span}
        STATE["deletePhase"] = "cancelled"
        STATE["rev"] += 1
        _push_event(
            "DeleteAgentPhaseChanged", agent_id=aid, phase="cancelled"
        )
        span = _audit(
            "host_ui:cancel_delete_agent",
            True,
            f"Cancelled agent={aid} (never Completed)",
        )
        return {"state": dict(STATE), "event_tail": EVENTS[-1:], "audit": span}



def apply_request_update_computer():
    """CM-1903: open Update Computer UI at prompted (first step). Not Reset."""
    with LOCK:
        STATE["settingsOpen"] = True
        STATE["entry"] = STATE.get("entry") or "command-palette"
        STATE["anchor"] = "update-computer"
        STATE["activeTab"] = "Computer"
        STATE["updateComputerPhase"] = "prompted"
        STATE["updateComputerPrompt"] = "Update"
        STATE["rev"] += 1
        _push_event("SettingsOpened", entry=STATE["entry"], anchor="update-computer")
        _push_event("SettingsAnchorVisible", anchor="update-computer")
        _push_event("UpdateComputerPhaseChanged", phase="prompted")
        span = _audit(
            "host_ui:request_update_computer",
            True,
            "Update Computer prompted (not Reset); two-step required",
        )
        return {"state": dict(STATE), "event_tail": EVENTS[-3:], "audit": span}


def apply_confirm_update_computer_step():
    """CM-1903: first confirm → awaiting-second-confirm; second would complete."""
    with LOCK:
        phase = STATE.get("updateComputerPhase")
        if phase == "prompted":
            STATE["updateComputerPhase"] = "awaiting-second-confirm"
            STATE["updateComputerPrompt"] = "Click Again to Confirm"
            STATE["rev"] += 1
            _push_event(
                "UpdateComputerPhaseChanged", phase="awaiting-second-confirm"
            )
            span = _audit(
                "host_ui:confirm_update_computer_step",
                True,
                "awaiting-second-confirm (Click Again to Confirm)",
            )
            return {"state": dict(STATE), "event_tail": EVENTS[-1:], "audit": span}
        if phase == "awaiting-second-confirm":
            # Product path; smoke must cancel instead.
            STATE["updateComputerPhase"] = "completed"
            STATE["updateComputerPrompt"] = None
            STATE["rev"] += 1
            _push_event("UpdateComputerPhaseChanged", phase="completed")
            span = _audit(
                "host_ui:confirm_update_computer_step",
                True,
                "completed (smoke should prefer cancel)",
            )
            return {"state": dict(STATE), "event_tail": EVENTS[-1:], "audit": span}
        span = _audit(
            "host_ui:confirm_update_computer_step",
            False,
            f"bad phase {phase}",
        )
        return {"error": "bad_phase", "state": dict(STATE), "audit": span}


def apply_cancel_update_computer():
    with LOCK:
        phase = STATE.get("updateComputerPhase")
        if phase not in ("prompted", "awaiting-second-confirm"):
            span = _audit(
                "host_ui:cancel_update_computer",
                False,
                f"cancel only from prompted/awaiting-second-confirm; got {phase}",
            )
            return {"error": "bad_phase", "state": dict(STATE), "audit": span}
        STATE["updateComputerPhase"] = "cancelled"
        STATE["updateComputerPrompt"] = None
        STATE["rev"] += 1
        _push_event("UpdateComputerPhaseChanged", phase="cancelled")
        span = _audit(
            "host_ui:cancel_update_computer",
            True,
            "Cancelled Update Computer (never Completed on smoke)",
        )
        return {"state": dict(STATE), "event_tail": EVENTS[-1:], "audit": span}


def apply_open_reset_computer():
    """CM-1904: Reset Computer UI reachable; guidance still prefers Update."""
    with LOCK:
        STATE["settingsOpen"] = True
        STATE["entry"] = STATE.get("entry") or "command-palette"
        STATE["anchor"] = "reset-computer"
        STATE["activeTab"] = "Computer"
        STATE["updateComputerPhase"] = "idle"
        STATE["updateComputerPrompt"] = None
        STATE["rev"] += 1
        _push_event("SettingsOpened", entry=STATE["entry"], anchor="reset-computer")
        _push_event("SettingsAnchorVisible", anchor="reset-computer")
        span = _audit(
            "host_ui:open_reset_computer",
            True,
            "Reset Computer visible; not preferred vs update-computer",
        )
        return {"state": dict(STATE), "event_tail": EVENTS[-2:], "audit": span}


def apply_set_local_execution(enabled: bool):
    """CM-1905: toggle local-execution gate."""
    with LOCK:
        STATE["localExecutionEnabled"] = bool(enabled)
        STATE["settingsOpen"] = True
        STATE["entry"] = STATE.get("entry") or "command-palette"
        STATE["anchor"] = "local-execution"
        STATE["activeTab"] = "Computer"
        STATE["rev"] += 1
        _push_event("SettingsOpened", entry=STATE["entry"], anchor="local-execution")
        _push_event("SettingsAnchorVisible", anchor="local-execution")
        _push_event("LocalExecutionGateChanged", enabled=bool(enabled))
        STATE["gateLog"].append(
            {
                "ts": time.time(),
                "event": "gate_changed",
                "enabled": bool(enabled),
            }
        )
        span = _audit(
            "host_ui:set_local_execution",
            True,
            f"local-execution={'on' if enabled else 'off'}",
        )
        return {"state": dict(STATE), "event_tail": EVENTS[-3:], "audit": span}


def apply_try_machine_call(machine_id: str):
    """CM-1905: Host really refuses machineId when gate off."""
    with LOCK:
        mid = machine_id or "desk-1"
        if not STATE.get("localExecutionEnabled", True):
            entry = {
                "ts": time.time(),
                "event": "rejected_local_off",
                "machine_id": mid,
                "detail": "local-execution disabled: machine-targeted call rejected",
            }
            STATE["gateLog"].append(entry)
            STATE["lastMachineCall"] = {
                "machine_id": mid,
                "allowed": False,
                "reason": "local-execution-off",
            }
            STATE["rev"] += 1
            span = _audit(
                "host_ui:try_machine_call",
                False,
                f"rejected_local_off machine={mid}",
            )
            return {
                "ok": False,
                "rejected": True,
                "machine_id": mid,
                "error": "local-execution disabled: machine-targeted call rejected",
                "state": dict(STATE),
                "audit": span,
            }
        STATE["lastMachineCall"] = {
            "machine_id": mid,
            "allowed": True,
            "reason": None,
        }
        STATE["gateLog"].append(
            {"ts": time.time(), "event": "allowed", "machine_id": mid}
        )
        STATE["rev"] += 1
        span = _audit(
            "host_ui:try_machine_call",
            True,
            f"allowed machine={mid}",
        )
        return {
            "ok": True,
            "rejected": False,
            "machine_id": mid,
            "state": dict(STATE),
            "audit": span,
        }


INFO_SECTIONS = ["desktop-preview", "routines", "channels", "members", "gear-settings"]
NOTIFY_KEYS = ["notify.desktop", "notify.sound", "notify.mentions-only", "notify.routines", "notify.channels"]
NOTIFY_DEFAULTS = {"notify.desktop": True, "notify.sound": True, "notify.mentions-only": False,
                   "notify.routines": True, "notify.channels": True}


def _agent(aid):
    for a in STATE["agents"]:
        if a["id"] == aid:
            return a
    return None


def _sidebar_ids():
    return [a["id"] for a in STATE["agents"] if not a.get("hidden")]


def _close_overlays():
    STATE["contextMenuOpen"] = False
    STATE["deletePhase"] = None
    STATE["permissionGuide"] = dict(STATE["permissionGuide"], open=False)


def _notify_for(aid):
    cur = dict(NOTIFY_DEFAULTS)
    cur.update(STATE["notify"].get(aid, {}))
    return cur


def apply_set_agent_hidden(agent_id, name, hidden):
    with LOCK:
        a = _agent(agent_id)
        if a is None:
            a = {"id": agent_id, "name": name or agent_id, "hidden": False}
            STATE["agents"].append(a)
        a["hidden"] = bool(hidden)
        STATE["settingsOpen"] = False
        STATE["infoPanel"] = dict(STATE["infoPanel"], open=False)
        _close_overlays()
        STATE["rev"] += 1
        _push_event("SidebarListChanged", visible_ids=_sidebar_ids())
        span = _audit("host_ui:set_agent_hidden", True,
                      f"agent={agent_id} hidden={bool(hidden)} sidebar={_sidebar_ids()}")
        return {"state": dict(STATE), "sidebar_ids": _sidebar_ids(), "audit": span}


def apply_address_agent(agent_id):
    with LOCK:
        a = _agent(agent_id)
        if a is None:
            span = _audit("host_ui:address_agent", False, f"unknown agent={agent_id}")
            return {"error": "unknown_agent", "state": dict(STATE), "audit": span}
        STATE["activeChat"] = agent_id
        STATE["activeChatHidden"] = bool(a.get("hidden"))
        STATE["settingsOpen"] = False
        STATE["infoPanel"] = dict(STATE["infoPanel"], open=False)
        _close_overlays()
        STATE["rev"] += 1
        hidden = bool(a.get("hidden"))
        # §3.2: SidebarHiddenAgentAddressable (was AgentAddressed(hidden=true))
        if hidden:
            _push_event("SidebarHiddenAgentAddressable", agent_id=agent_id)
        span = _audit("host_ui:address_agent", True,
                      f"addressed agent={agent_id} hidden={hidden} in_sidebar={agent_id in _sidebar_ids()}"
                      + ("; event=SidebarHiddenAgentAddressable" if hidden else ""))
        return {"state": dict(STATE), "hidden": hidden,
                "in_sidebar": agent_id in _sidebar_ids(), "audit": span,
                "event": "SidebarHiddenAgentAddressable" if hidden else None}


def apply_open_info_panel(agent_id, view="panel", members=None, group=False):
    with LOCK:
        if not group and _agent(agent_id) is None:
            span = _audit("host_ui:open_info_panel", False, f"unknown agent={agent_id}")
            return {"error": "unknown_agent", "state": dict(STATE), "audit": span}
        STATE["settingsOpen"] = False   # Info pane ≠ global Settings
        _close_overlays()
        STATE["activeChat"] = agent_id
        STATE["activeChatHidden"] = False
        STATE["infoPanel"] = {"open": True, "agentId": agent_id, "view": view,
                              "sections": list(INFO_SECTIONS), "members": list(members or []),
                              "group": bool(group)}
        if view == "gear":
            STATE["infoPanel"]["notify"] = _notify_for(agent_id)
        STATE["rev"] += 1
        _push_event("InfoPanelOpened", agent_id=agent_id, sections=list(INFO_SECTIONS), view=view)
        if members:
            _push_event("MembersPanelVisible", group_id=agent_id, member_ids=list(members))
        span = _audit("host_ui:open_info_panel" if view == "panel" else "host_ui:open_agent_settings",
                      True, f"agent={agent_id} view={view} members={members or []} settingsOpen=False")
        return {"state": dict(STATE), "audit": span}


def apply_set_agent_notify(agent_id, toggle, value):
    with LOCK:
        if _agent(agent_id) is None or toggle not in NOTIFY_KEYS:
            span = _audit("host_ui:set_agent_notify", False, f"bad agent/toggle {agent_id}/{toggle}")
            return {"error": "bad_request", "state": dict(STATE), "audit": span}
        STATE["notify"].setdefault(agent_id, {})[toggle] = bool(value)
        if STATE["infoPanel"].get("open") and STATE["infoPanel"].get("agentId") == agent_id:
            STATE["infoPanel"]["notify"] = _notify_for(agent_id)
        STATE["rev"] += 1
        _push_event("AgentNotifyToggleChanged", agent_id=agent_id, toggle=toggle, value=bool(value))
        span = _audit("host_ui:set_agent_notify", True, f"agent={agent_id} {toggle}={bool(value)}")
        return {"state": dict(STATE), "notify": {a["id"]: _notify_for(a["id"]) for a in STATE["agents"]},
                "audit": span}


def apply_create_agent(agent_id, name):
    with LOCK:
        if not agent_id or _agent(agent_id) is not None:
            span = _audit("host_ui:create_agent", False, f"exists or empty: {agent_id}")
            return {"error": "agent_exists", "state": dict(STATE), "audit": span}
        STATE["agents"].append({"id": agent_id, "name": name or agent_id, "hidden": False})
        STATE["settingsOpen"] = False
        STATE["infoPanel"] = dict(STATE["infoPanel"], open=False)
        _close_overlays()
        STATE["rev"] += 1
        _push_event("AgentCreated", agent_id=agent_id)
        _push_event("SidebarListChanged", visible_ids=_sidebar_ids())
        span = _audit("host_ui:create_agent", True, f"created {agent_id}; sidebar={_sidebar_ids()}")
        return {"state": dict(STATE), "sidebar_ids": _sidebar_ids(), "audit": span}


PERM_ANCHOR = {"connector-needs-auth": "account", "connector-needs-grant": "account",
               "local-execution-disabled": "local-execution", "device-tool-permission": "computers"}


def apply_show_permission_guide(kind, namespace):
    with LOCK:
        anchor = PERM_ANCHOR.get(kind)
        if not anchor:
            span = _audit("host_ui:show_permission_guide", False, f"unknown kind {kind}")
            return {"error": "bad_kind", "state": dict(STATE), "audit": span}
        STATE["settingsOpen"] = False
        STATE["infoPanel"] = dict(STATE["infoPanel"], open=False)
        STATE["contextMenuOpen"] = False
        STATE["deletePhase"] = None
        STATE["permissionGuide"] = {"open": True, "kind": kind, "namespace": namespace, "anchor": anchor,
                                    "connected": False, "status": "Needs auth", "followed": False,
                                    "link": f"grokbot://app/v1/settings?id={anchor}"}
        STATE["rev"] += 1
        _push_event("PermissionGuideShown", perm_kind=kind, namespace=namespace, anchor=anchor,
                    pretends_connected=False)
        span = _audit("host_ui:show_permission_guide", True,
                      f"guide kind={kind} ns={namespace} anchor={anchor} connected=False")
        return {"state": dict(STATE), "audit": span}


def apply_follow_permission_guide():
    with LOCK:
        g = STATE["permissionGuide"]
        if not g.get("kind"):
            span = _audit("host_ui:follow_permission_guide", False, "no guide shown")
            return {"error": "no_guide", "state": dict(STATE), "audit": span}
        anchor = g["anchor"]
        STATE["permissionGuide"] = dict(g, open=False, followed=True, connected=False)
        STATE["settingsOpen"] = True
        STATE["entry"] = "sidebar-account-button"
        STATE["anchor"] = anchor
        STATE["activeTab"] = _tab_for_anchor(anchor)
        STATE["rev"] += 1
        _push_event("SettingsOpened", entry="sidebar-account-button", anchor=anchor, via="permission-guide")
        _push_event("SettingsAnchorVisible", anchor=anchor)
        span = _audit("host_ui:follow_permission_guide", True,
                      f"Settings opened at {anchor} via guide; connector still not connected")
        return {"state": dict(STATE), "audit": span}



def apply_report_anchor_viewport(payload: dict):
    """CM-1507: page reports DOM metrics after scroll/highlight (C′; not CDP)."""
    with LOCK:
        anchor_id = payload.get("anchor_id") or payload.get("anchor") or ""
        if not anchor_id:
            span = _audit("host_ui:report_anchor_viewport", False, "anchor_id required")
            return {"error": "anchor_id required", "state": dict(STATE), "audit": span}
        scroll_top = payload.get("scrollTop")
        bounding = payload.get("boundingRect") or {}
        highlighted = bool(payload.get("highlighted"))
        viewport = payload.get("viewport") or {}
        in_viewport = bool(payload.get("inViewport", False))
        report = {
            "anchor_id": anchor_id,
            "scrollTop": scroll_top,
            "boundingRect": {
                "x": bounding.get("x"),
                "y": bounding.get("y"),
                "width": bounding.get("width"),
                "height": bounding.get("height"),
                "top": bounding.get("top", bounding.get("y")),
                "left": bounding.get("left", bounding.get("x")),
                "bottom": bounding.get("bottom"),
                "right": bounding.get("right"),
            },
            "highlighted": highlighted,
            "viewport": viewport,
            "inViewport": in_viewport,
            "ts": time.time(),
        }
        STATE["anchorViewport"] = report
        # Do NOT bump rev — page poll would re-apply and re-report (loop).
        # Live adapter polls GET /state for anchorViewport directly.
        _push_event(
            "SettingsAnchorViewportReported",
            anchor_id=anchor_id,
            scrollTop=scroll_top,
            boundingRect=report["boundingRect"],
            highlighted=highlighted,
            inViewport=in_viewport,
        )
        span = _audit(
            "host_ui:report_anchor_viewport",
            True,
            f"anchor={anchor_id} scrollTop={scroll_top} highlighted={highlighted} "
            f"inViewport={in_viewport} rect={report['boundingRect']}",
        )
        return {"state": dict(STATE), "anchorViewport": report, "audit": span}





# --- H3 CM-0411 Webhook panel ---
WEBHOOK_KEY_STORE = {"key": "whsec_h3_opaque_do_not_tool_read"}


def apply_open_webhook_panel(url=None, key=None):
    with LOCK:
        url = url or "https://hooks.bitbot.local/v1/wh-h3-demo"
        if key:
            WEBHOOK_KEY_STORE["key"] = key
        masked = "whsec_••••••••••••"
        STATE["webhookPanel"] = {
            "open": True,
            "url": url,
            "key_present": True,
            "key_masked": masked,
            "last_copy": None,
        }
        STATE["settingsOpen"] = False
        STATE["infoPanel"] = dict(STATE["infoPanel"], open=False)
        STATE["rev"] += 1
        _push_event("WebhookPanelOpened", url=url, key_opaque=True)
        span = _audit("host_ui:open_webhook_panel", True, f"panel open url={url}; key opaque to tools")
        return {"state": dict(STATE), "audit": span}


def apply_user_copy_webhook(what: str):
    with LOCK:
        panel = STATE["webhookPanel"]
        if not panel.get("open"):
            span = _audit("host_ui:user_copy_webhook", False, "panel not open")
            return {"error": "panel_closed", "state": dict(STATE), "audit": span}
        if what == "url":
            value = panel["url"]
            receipt = f"copied_url:{value}"
        elif what == "key":
            value = WEBHOOK_KEY_STORE["key"]
            receipt = f"copied_key:len={len(value)}"
        else:
            span = _audit("host_ui:user_copy_webhook", False, f"bad what={what}")
            return {"error": "bad_what", "state": dict(STATE), "audit": span}
        STATE["webhookPanel"] = dict(
            panel,
            last_copy={"what": what, "ts": time.time(), "receipt": receipt, "ok": True},
        )
        STATE["rev"] += 1
        _push_event("WebhookPanelCopy", what=what, receipt=receipt)
        span = _audit("host_ui:user_copy_webhook", True, receipt)
        return {"state": dict(STATE), "copied": what, "value": value, "receipt": receipt, "audit": span}


def apply_assistant_tool_read_webhook_key():
    with LOCK:
        span = _audit(
            "host_ui:assistant_tool_read_webhook_key",
            False,
            "webhook key is opaque; assistant cannot tool-read key",
        )
        _push_event("WebhookToolReadKeyRejected", reason="opaque")
        return {
            "error": "opaque",
            "message": "webhook key is opaque; assistant cannot tool-read key",
            "rejected": True,
            "key": None,
            "audit": span,
            "state": dict(STATE),
        }


def apply_webhook_wake(event_id="evt-h3", summary="POST /hooks received"):
    with LOCK:
        key = WEBHOOK_KEY_STORE["key"]
        payload = f'<webhook_event id="{event_id}">{summary}</webhook_event>'
        leaks = key in payload
        span = _audit(
            "host_ui:webhook_wake",
            not leaks,
            f"wake payload; has_event_tag=True; leaks_key={leaks}",
        )
        _push_event("WebhookWake", event_id=event_id, leaks_key=leaks)
        return {
            "payload": payload,
            "has_webhook_event": True,
            "leaks_key": leaks,
            "audit": span,
            "state": dict(STATE),
        }


def apply_show_device_permission_card(machine_id, tool_name, permission_label="needs_permission"):
    with LOCK:
        shown = permission_label == "needs_permission"
        STATE["devicePermissionCard"] = {
            "open": shown,
            "machine_id": machine_id,
            "tool_name": tool_name,
            "permission_label": permission_label,
            "shown": shown,
        }
        STATE["rev"] += 1
        _push_event(
            "DevicePermissionCardShown",
            machine_id=machine_id,
            tool_name=tool_name,
            permission_label=permission_label,
            shown=shown,
        )
        span = _audit(
            "host_ui:show_device_permission_card",
            True,
            f"card shown={shown} mid={machine_id} tool={tool_name} perm={permission_label}",
        )
        return {"state": dict(STATE), "card": dict(STATE["devicePermissionCard"]), "audit": span}


def _find_message(message_id: str):
    for m in STATE["chatMessages"]:
        if m["id"] == message_id:
            return m
    return None


def apply_react_to_message(message_id: str, emoji: str, toggle: bool = True):
    """H5 CM-2101: show/toggle emoji reaction pill on a message via Host API."""
    with LOCK:
        mid = message_id or "msg-h5-1"
        emo = emoji or "👍"
        msg = _find_message(mid)
        if msg is None:
            msg = {
                "id": mid,
                "role": "assistant",
                "text": "H5 message",
                "reactions": {},
            }
            STATE["chatMessages"].append(msg)
        reactions = dict(msg.get("reactions") or {})
        if toggle and emo in reactions:
            del reactions[emo]
            visible = len(reactions) > 0
            active = next(iter(reactions), None)
        else:
            reactions[emo] = reactions.get(emo, 0) + 1
            visible = True
            active = emo
        msg["reactions"] = reactions
        STATE["reactPill"] = {
            "message_id": mid,
            "emoji": active,
            "visible": visible,
            "reactions": dict(reactions),
        }
        STATE["settingsOpen"] = False
        STATE["infoPanel"] = dict(STATE["infoPanel"], open=False)
        STATE["rev"] += 1
        _push_event(
            "ReactPillChanged",
            message_id=mid,
            emoji=active,
            visible=visible,
            reactions=dict(reactions),
        )
        span = _audit(
            "host_ui:react_to_message",
            True,
            f"pill message={mid} emoji={active} visible={visible}",
        )
        return {
            "state": dict(STATE),
            "pill": dict(STATE["reactPill"]),
            "audit": span,
        }


def apply_end_turn(leave_pill: bool = True):
    """H5 CM-2128: end_turn leaves reaction pill visible for LiveDisplay frame."""
    with LOCK:
        leave = bool(leave_pill)
        pill = STATE.get("reactPill") or {}
        if leave and not pill.get("visible"):
            mid = pill.get("message_id") or "msg-h5-1"
            emo = pill.get("emoji") or "🎉"
            msg = _find_message(mid)
            if msg is None:
                msg = {
                    "id": mid,
                    "role": "assistant",
                    "text": "H5 outbound react end_turn",
                    "reactions": {},
                }
                STATE["chatMessages"].append(msg)
            reactions = dict(msg.get("reactions") or {})
            reactions[emo] = reactions.get(emo, 0) + 1
            msg["reactions"] = reactions
            STATE["reactPill"] = {
                "message_id": mid,
                "emoji": emo,
                "visible": True,
                "reactions": dict(reactions),
            }
        STATE["endTurnLeftPill"] = leave and bool(
            (STATE.get("reactPill") or {}).get("visible")
        )
        STATE["rev"] += 1
        _push_event(
            "EndTurn",
            leave_pill=leave,
            pill_visible=bool((STATE.get("reactPill") or {}).get("visible")),
            emoji=(STATE.get("reactPill") or {}).get("emoji"),
        )
        span = _audit(
            "host_ui:end_turn",
            True,
            f"end_turn leave_pill={leave} pill_visible={STATE['endTurnLeftPill']}",
        )
        return {
            "state": dict(STATE),
            "end_turn_left_pill": STATE["endTurnLeftPill"],
            "pill": dict(STATE.get("reactPill") or {}),
            "audit": span,
        }


def apply_show_math_mermaid(math_tex: str | None = None, mermaid_src: str | None = None):
    """H5 CM-2103: Host surfaces math + mermaid (SVG fallback on page)."""
    with LOCK:
        math_tex = math_tex or r"E = mc^2"
        mermaid_src = mermaid_src or "flowchart LR; A-->B-->C"
        STATE["mathMermaid"] = {
            "open": True,
            "math_tex": math_tex,
            "math_rendered": True,
            "mermaid_src": mermaid_src,
            "mermaid_rendered": True,
        }
        STATE["settingsOpen"] = False
        STATE["rev"] += 1
        _push_event(
            "MathMermaidShown",
            math_tex=math_tex,
            mermaid_src=mermaid_src,
            math_rendered=True,
            mermaid_rendered=True,
        )
        span = _audit(
            "host_ui:show_math_mermaid",
            True,
            f"math+mermaid open tex={math_tex!r}",
        )
        return {
            "state": dict(STATE),
            "mathMermaid": dict(STATE["mathMermaid"]),
            "audit": span,
        }


def apply_show_cursor_agent_card(agent_id: str | None = None, url: str | None = None):
    """H5 CM-2131: show cursor-agent card with cloud agent URL (throwaway id)."""
    with LOCK:
        aid = agent_id or "h5-throwaway-agent"
        open_url = url or f"https://cursor.com/agents/{aid}"
        STATE["cursorAgentCard"] = {
            "open": True,
            "agent_id": aid,
            "url": open_url,
            "shown": True,
        }
        STATE["settingsOpen"] = False
        STATE["rev"] += 1
        _push_event(
            "CursorAgentCardShown",
            agent_id=aid,
            url=open_url,
            shown=True,
        )
        span = _audit(
            "host_ui:show_cursor_agent_card",
            True,
            f"card agent={aid} url={open_url}",
        )
        return {
            "state": dict(STATE),
            "card": dict(STATE["cursorAgentCard"]),
            "audit": span,
        }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _json(self, code: int, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        return json.loads(self.rfile.read(n).decode() or "{}")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/host/state":
            with LOCK:
                return self._json(200, dict(STATE))
        if path == "/api/host/events":
            with LOCK:
                return self._json(200, {"events": list(EVENTS)})
        if path == "/api/host/audit":
            with LOCK:
                return self._json(200, {"spans": list(AUDIT)})
        if path == "/api/host/health":
            return self._json(
                200,
                {
                    "ok": True,
                    "surface": "bit-bot-host-ui",
                    "mode": "C_prime",
                    "i_claimed": False,
                },
            )
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        data = self._read_json()
        # Live HostUiShell method surface (C′)
        if path == "/api/host/open_settings":
            entry = data.get("entry") or "sidebar-account-button"
            anchor = data.get("anchor")
            return self._json(200, apply_open_settings(entry, anchor))
        if path == "/api/host/notify_anchor_visible":
            anchor = data.get("anchor") or ""
            if not anchor:
                return self._json(400, {"error": "anchor required"})
            return self._json(200, apply_anchor_visible(anchor))
        if path == "/api/host/report_anchor_viewport":
            return self._json(200, apply_report_anchor_viewport(data))
        if path == "/api/host/open_sidebar_context_menu":
            agent_id = data.get("agent_id") or "h2-throwaway-agent"
            return self._json(200, apply_open_sidebar_context_menu(agent_id))
        if path == "/api/host/request_delete_agent":
            agent_id = data.get("agent_id") or "h2-throwaway-agent"
            return self._json(200, apply_request_delete(agent_id))
        if path == "/api/host/cancel_delete_agent":
            return self._json(
                200, apply_cancel_delete(data.get("agent_id"))
            )
        if path == "/api/host/confirm_delete_agent":
            # Available on Host API but smoke must use cancel only.
            return self._json(
                403,
                {
                    "error": "smoke_must_cancel_only",
                    "hint": "use /api/host/cancel_delete_agent",
                },
            )
        if path == "/api/host/request_update_computer":
            return self._json(200, apply_request_update_computer())
        if path == "/api/host/confirm_update_computer_step":
            return self._json(200, apply_confirm_update_computer_step())
        if path == "/api/host/cancel_update_computer":
            return self._json(200, apply_cancel_update_computer())
        if path == "/api/host/open_reset_computer":
            return self._json(200, apply_open_reset_computer())
        if path == "/api/host/set_local_execution":
            enabled = data.get("enabled")
            if enabled is None:
                return self._json(400, {"error": "enabled required"})
            return self._json(200, apply_set_local_execution(bool(enabled)))
        if path == "/api/host/set_agent_hidden":
            return self._json(200, apply_set_agent_hidden(
                data.get("agent_id") or "h2-hidden-agent", data.get("name"), bool(data.get("hidden", True))))
        if path == "/api/host/address_agent":
            return self._json(200, apply_address_agent(data.get("agent_id") or ""))
        if path == "/api/host/open_info_panel":
            return self._json(200, apply_open_info_panel(data.get("agent_id") or "", "panel"))
        if path == "/api/host/open_agent_settings":
            return self._json(200, apply_open_info_panel(data.get("agent_id") or "", "gear"))
        if path == "/api/host/set_agent_notify":
            return self._json(200, apply_set_agent_notify(
                data.get("agent_id") or "", data.get("toggle") or "", bool(data.get("value"))))
        if path == "/api/host/create_agent":
            return self._json(200, apply_create_agent(data.get("agent_id") or "", data.get("name")))
        if path == "/api/host/open_members_panel":
            members = data.get("member_ids") or []
            with LOCK:
                unknown = [m for m in members if _agent(m) is None]
            if unknown:
                return self._json(200, {"error": "unknown_member", "unknown": unknown})
            return self._json(200, apply_open_info_panel(
                data.get("group_id") or "h2-group", "panel", members=members, group=True))
        if path == "/api/host/show_permission_guide":
            return self._json(200, apply_show_permission_guide(
                data.get("kind") or "connector-needs-auth", data.get("namespace") or "user-Gmail"))
        if path == "/api/host/follow_permission_guide":
            return self._json(200, apply_follow_permission_guide())
        if path == "/api/host/try_machine_call":
            return self._json(
                200, apply_try_machine_call(data.get("machine_id") or "desk-1")
            )
        if path == "/api/host/open_webhook_panel":
            return self._json(200, apply_open_webhook_panel(data.get("url"), data.get("key")))
        if path == "/api/host/user_copy_webhook":
            return self._json(200, apply_user_copy_webhook(data.get("what") or "url"))
        if path == "/api/host/assistant_tool_read_webhook_key":
            return self._json(200, apply_assistant_tool_read_webhook_key())
        if path == "/api/host/webhook_wake":
            return self._json(200, apply_webhook_wake(
                data.get("event_id") or "evt-h3", data.get("summary") or "POST /hooks received"))
        if path == "/api/host/show_device_permission_card":
            return self._json(200, apply_show_device_permission_card(
                data.get("machine_id") or "phone-ios",
                data.get("tool_name") or "camera",
                data.get("permission_label") or "needs_permission"))
        if path == "/api/host/react_to_message":
            return self._json(200, apply_react_to_message(
                data.get("message_id") or "msg-h5-1",
                data.get("emoji") or "👍",
                bool(data.get("toggle", True)) if "toggle" in data else True,
            ))
        if path == "/api/host/end_turn":
            leave = data.get("leave_pill")
            if leave is None:
                leave = True
            return self._json(200, apply_end_turn(bool(leave)))
        if path == "/api/host/show_math_mermaid":
            return self._json(200, apply_show_math_mermaid(
                data.get("math_tex"), data.get("mermaid_src")))
        if path == "/api/host/show_cursor_agent_card":
            return self._json(200, apply_show_cursor_agent_card(
                data.get("agent_id"), data.get("url")))
        self._json(404, {"error": "unknown HostUiShell route", "path": path})


def main():
    import os

    port = int(os.environ.get("HOST_UI_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"bit-bot-host-ui C′ listening on 127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
