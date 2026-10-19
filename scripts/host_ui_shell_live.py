#!/usr/bin/env python3
"""Live HostUiShell adapter (C′).

Invoked by host_h2_smoke.sh as the Host-process implementation of:
  open_settings / notify_anchor_visible / open_sidebar_context_menu /
  request_delete_agent / cancel_delete_agent /
  request_update_computer / confirm_update_computer_step / cancel_update_computer /
  open_reset_computer / set_local_execution / try_machine_call /
  set_agent_hidden / address_agent / open_info_panel / open_agent_settings /
  set_agent_notify / create_agent / open_members_panel /
  show_permission_guide / follow_permission_guide   (batch-3)

Drives Bit Bot Host UI via /api/host/* only. Never uses CDP page JS (B).
Mirrors box_host HostUiShell + run_h2_probe intent mapping.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def http_json(method: str, url: str, body: dict | None = None, timeout: float = 5.0):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n")


def append_audit(art_dir: Path, span: dict):
    path = art_dir / "audit_spans.jsonl"
    with path.open("a") as f:
        f.write(json.dumps(span) + "\n")


def wait_state(base: str, pred, timeout: float = 5.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = http_json("GET", f"{base}/api/host/state")
        if pred(last):
            return last
        time.sleep(0.1)
    return last


def cmd_open_settings(base: str, art: Path, entry: str, anchor: str | None):
    body = {"entry": entry}
    if anchor:
        body["anchor"] = anchor
    t0 = time.time()
    res = http_json("POST", f"{base}/api/host/open_settings", body)
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(
        base,
        lambda s: s.get("settingsOpen") and s.get("entry") == entry,
    )
    events = http_json("GET", f"{base}/api/host/events")
    write_json(art / f"host_ui_event_open_{entry}.json", {"result": res, "state": st, "events": events})
    print(json.dumps({"ok": True, "method": "open_settings", "entry": entry, "anchor": anchor, "state": st}))


def cmd_anchor(base: str, art: Path, anchor: str):
    # Deep-link path: open_settings with anchor then explicit visible notify.
    # CM-1507: wait for page→Host viewport receipt {anchor_id, scrollTop, boundingRect, highlighted}.
    t0 = time.time()
    res1 = http_json(
        "POST",
        f"{base}/api/host/open_settings",
        {"entry": "command-palette", "anchor": anchor},
    )
    res2 = http_json(
        "POST",
        f"{base}/api/host/notify_anchor_visible",
        {"anchor": anchor},
    )
    dt = int((time.time() - t0) * 1000)
    for res in (res1, res2):
        span = res.get("audit") or {}
        span["duration_ms"] = dt
        span["artifact_path"] = str(art)
        append_audit(art, span)

    def _viewport_ready(s):
        av = s.get("anchorViewport") or {}
        return (
            s.get("anchor") == anchor
            and av.get("anchor_id") == anchor
            and av.get("highlighted") is True
            and av.get("boundingRect") is not None
            and av.get("scrollTop") is not None
        )

    st = wait_state(base, _viewport_ready, timeout=6.0)
    events = http_json("GET", f"{base}/api/host/events")
    av = (st or {}).get("anchorViewport")
    write_json(
        art / f"host_ui_event_anchor_{anchor}.json",
        {"state": st, "events": events, "anchorViewport": av},
    )
    print(
        json.dumps(
            {
                "ok": True,
                "method": "notify_anchor_visible",
                "anchor": anchor,
                "state": st,
                "anchorViewport": av,
            }
        )
    )



def cmd_open_sidebar_context_menu(base: str, art: Path, agent_id: str):
    t0 = time.time()
    res = http_json(
        "POST",
        f"{base}/api/host/open_sidebar_context_menu",
        {"agent_id": agent_id},
    )
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(base, lambda s: s.get("contextMenuOpen") is True)
    events = http_json("GET", f"{base}/api/host/events")
    write_json(
        art / "host_ui_event_context_menu.json",
        {"result": res, "state": st, "events": events},
    )
    print(json.dumps({"ok": True, "method": "open_sidebar_context_menu", "state": st}))

def cmd_request_delete(base: str, art: Path, agent_id: str):
    t0 = time.time()
    res = http_json(
        "POST",
        f"{base}/api/host/request_delete_agent",
        {"agent_id": agent_id},
    )
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(base, lambda s: s.get("deletePhase") == "awaiting-confirm")
    events = http_json("GET", f"{base}/api/host/events")
    write_json(art / "host_ui_event_delete_request.json", {"result": res, "state": st, "events": events})
    print(json.dumps({"ok": True, "method": "request_delete_agent", "state": st}))


def cmd_cancel_delete(base: str, art: Path, agent_id: str):
    t0 = time.time()
    res = http_json(
        "POST",
        f"{base}/api/host/cancel_delete_agent",
        {"agent_id": agent_id},
    )
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(base, lambda s: s.get("deletePhase") == "cancelled")
    events = http_json("GET", f"{base}/api/host/events")
    write_json(art / "host_ui_event_delete_cancel.json", {"result": res, "state": st, "events": events})
    print(json.dumps({"ok": True, "method": "cancel_delete_agent", "state": st}))



def cmd_request_update_computer(base: str, art: Path):
    t0 = time.time()
    res = http_json("POST", f"{base}/api/host/request_update_computer", {})
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(base, lambda s: s.get("updateComputerPhase") == "prompted")
    events = http_json("GET", f"{base}/api/host/events")
    write_json(
        art / "host_ui_event_update_prompted.json",
        {"result": res, "state": st, "events": events},
    )
    print(json.dumps({"ok": True, "method": "request_update_computer", "state": st}))


def cmd_confirm_update_computer_step(base: str, art: Path):
    t0 = time.time()
    res = http_json("POST", f"{base}/api/host/confirm_update_computer_step", {})
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(
        base,
        lambda s: s.get("updateComputerPhase")
        in ("awaiting-second-confirm", "completed"),
    )
    events = http_json("GET", f"{base}/api/host/events")
    phase = (st or {}).get("updateComputerPhase")
    write_json(
        art / f"host_ui_event_update_{phase or 'step'}.json",
        {"result": res, "state": st, "events": events},
    )
    print(json.dumps({"ok": True, "method": "confirm_update_computer_step", "state": st}))


def cmd_cancel_update_computer(base: str, art: Path):
    t0 = time.time()
    res = http_json("POST", f"{base}/api/host/cancel_update_computer", {})
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(base, lambda s: s.get("updateComputerPhase") == "cancelled")
    events = http_json("GET", f"{base}/api/host/events")
    write_json(
        art / "host_ui_event_update_cancelled.json",
        {"result": res, "state": st, "events": events},
    )
    print(json.dumps({"ok": True, "method": "cancel_update_computer", "state": st}))


def cmd_open_reset_computer(base: str, art: Path):
    t0 = time.time()
    res = http_json("POST", f"{base}/api/host/open_reset_computer", {})
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(base, lambda s: s.get("anchor") == "reset-computer")
    events = http_json("GET", f"{base}/api/host/events")
    write_json(
        art / "host_ui_event_reset_computer.json",
        {"result": res, "state": st, "events": events},
    )
    print(json.dumps({"ok": True, "method": "open_reset_computer", "state": st}))


def cmd_set_local_execution(base: str, art: Path, enabled: bool):
    t0 = time.time()
    res = http_json(
        "POST", f"{base}/api/host/set_local_execution", {"enabled": enabled}
    )
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(
        base, lambda s: s.get("localExecutionEnabled") is enabled
    )
    events = http_json("GET", f"{base}/api/host/events")
    tag = "on" if enabled else "off"
    write_json(
        art / f"host_ui_event_local_execution_{tag}.json",
        {"result": res, "state": st, "events": events},
    )
    print(json.dumps({"ok": True, "method": "set_local_execution", "enabled": enabled, "state": st}))


def cmd_try_machine_call(base: str, art: Path, machine_id: str):
    t0 = time.time()
    res = http_json(
        "POST",
        f"{base}/api/host/try_machine_call",
        {"machine_id": machine_id},
    )
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    append_audit(art, span)
    st = wait_state(base, lambda s: s.get("lastMachineCall") is not None)
    events = http_json("GET", f"{base}/api/host/events")
    write_json(
        art / "host_ui_event_machine_call.json",
        {"result": res, "state": st, "events": events},
    )
    # Also write gate log excerpt for Bit验证
    gate = (st or {}).get("gateLog") or []
    write_json(art / "gate_log.json", {"gateLog": gate, "lastMachineCall": (st or {}).get("lastMachineCall")})
    print(json.dumps({"ok": True, "method": "try_machine_call", "result": res, "state": st}))


def cmd_generic(base: str, art: Path, method: str, body: dict, tag: str):
    """Batch-3 HostUiShell method → POST /api/host/<method>; audit span + event dump."""
    t0 = time.time()
    res = http_json("POST", f"{base}/api/host/{method}", body)
    dt = int((time.time() - t0) * 1000)
    span = res.get("audit") or {}
    span["duration_ms"] = dt
    span["artifact_path"] = str(art)
    span["method"] = method
    append_audit(art, span)
    want_rev = (res.get("state") or {}).get("rev")
    st = wait_state(base, lambda s: want_rev is None or s.get("rev", -1) >= want_rev)
    events = http_json("GET", f"{base}/api/host/events")
    write_json(art / f"host_ui_event_{tag}.json",
               {"method": method, "body": body, "result": res, "state": st, "events": events})
    # Intentional Host rejects (opaque key, etc.) carry rejected=True — still ok for smoke.
    ok = ("error" not in res) or bool(res.get("rejected"))
    print(json.dumps({"ok": ok, "method": method, "tag": tag, "span_id": span.get("id"), "rejected": bool(res.get("rejected"))}))
    if not ok:
        sys.exit(3)


def cmd_dump(base: str, art: Path):
    events = http_json("GET", f"{base}/api/host/events")
    spans = http_json("GET", f"{base}/api/host/audit")
    state = http_json("GET", f"{base}/api/host/state")
    write_json(art / "host_ui_events.json", events)
    write_json(art / "host_ui_audit.json", spans)
    write_json(art / "host_ui_state.json", state)
    print(json.dumps({"ok": True, "events": len(events.get("events", [])), "spans": len(spans.get("spans", []))}))


def main():
    ap = argparse.ArgumentParser(description="Live HostUiShell adapter (C′)")
    ap.add_argument("--base", required=True, help="http://127.0.0.1:<port>")
    ap.add_argument("--artifact-dir", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("open_settings")
    p1.add_argument("--entry", required=True)
    p1.add_argument("--anchor", default=None)

    p2 = sub.add_parser("notify_anchor_visible")
    p2.add_argument("--anchor", required=True)

    p3a = sub.add_parser("open_sidebar_context_menu")
    p3a.add_argument("--agent-id", default="h2-throwaway-agent")

    p3 = sub.add_parser("request_delete_agent")
    p3.add_argument("--agent-id", default="h2-throwaway-agent")

    p4 = sub.add_parser("cancel_delete_agent")
    p4.add_argument("--agent-id", default="h2-throwaway-agent")

    sub.add_parser("request_update_computer")
    sub.add_parser("confirm_update_computer_step")
    sub.add_parser("cancel_update_computer")
    sub.add_parser("open_reset_computer")

    p5 = sub.add_parser("set_local_execution")
    p5.add_argument("--enabled", required=True, choices=["true", "false", "on", "off", "1", "0"])

    p6 = sub.add_parser("try_machine_call")
    p6.add_argument("--machine-id", default="desk-1")

    for name in ["set_agent_hidden", "address_agent", "open_info_panel", "open_agent_settings",
                 "set_agent_notify", "create_agent", "open_members_panel",
                 "show_permission_guide", "follow_permission_guide"]:
        sp = sub.add_parser(name)
        sp.add_argument("--tag", default=name)
        sp.add_argument("--agent-id", default=None)
        sp.add_argument("--name", default=None)
        sp.add_argument("--hidden", default="true")
        sp.add_argument("--toggle", default=None)
        sp.add_argument("--value", default=None)
        sp.add_argument("--group-id", default=None)
        sp.add_argument("--member-ids", default="")
        sp.add_argument("--kind", default=None)
        sp.add_argument("--namespace", default=None)


    p_wh = sub.add_parser("open_webhook_panel")
    p_wh.add_argument("--url", default=None)
    p_wh.add_argument("--key", default=None)
    p_wh.add_argument("--tag", default="open_webhook_panel")
    p_whc = sub.add_parser("user_copy_webhook")
    p_whc.add_argument("--what", default="url", choices=["url", "key"])
    p_whc.add_argument("--tag", default="user_copy_webhook")
    p_wht = sub.add_parser("assistant_tool_read_webhook_key")
    p_wht.add_argument("--tag", default="assistant_tool_read_webhook_key")
    p_ww = sub.add_parser("webhook_wake")
    p_ww.add_argument("--event-id", default="evt-h3")
    p_ww.add_argument("--summary", default="POST /hooks received")
    p_ww.add_argument("--tag", default="webhook_wake")
    p_dpc = sub.add_parser("show_device_permission_card")
    p_dpc.add_argument("--machine-id", default="phone-ios")
    p_dpc.add_argument("--tool-name", default="camera")
    p_dpc.add_argument("--permission-label", default="needs_permission")
    p_dpc.add_argument("--tag", default="show_device_permission_card")

    # H5 CM-2101 / 2128 / 2103 / 2131
    p_react = sub.add_parser("react_to_message")
    p_react.add_argument("--message-id", default="msg-h5-1")
    p_react.add_argument("--emoji", default="👍")
    p_react.add_argument("--toggle", default="true")
    p_react.add_argument("--tag", default="react_to_message")
    p_et = sub.add_parser("end_turn")
    p_et.add_argument("--leave-pill", default="true")
    p_et.add_argument("--tag", default="end_turn")
    p_mm = sub.add_parser("show_math_mermaid")
    p_mm.add_argument("--math-tex", default=r"E = mc^2")
    p_mm.add_argument("--mermaid-src", default="flowchart LR; A-->B-->C")
    p_mm.add_argument("--tag", default="show_math_mermaid")
    p_ca = sub.add_parser("show_cursor_agent_card")
    p_ca.add_argument("--agent-id", default="h5-throwaway-agent")
    p_ca.add_argument("--url", default=None)
    p_ca.add_argument("--tag", default="show_cursor_agent_card")

    sub.add_parser("dump")

    args = ap.parse_args()
    art = Path(args.artifact_dir)
    art.mkdir(parents=True, exist_ok=True)
    try:
        http_json("GET", f"{args.base}/api/host/health")
    except Exception as e:
        print(f"Host UI unreachable: {e}", file=sys.stderr)
        sys.exit(2)

    if args.cmd == "open_settings":
        cmd_open_settings(args.base, art, args.entry, args.anchor)
    elif args.cmd == "notify_anchor_visible":
        cmd_anchor(args.base, art, args.anchor)
    elif args.cmd == "open_sidebar_context_menu":
        cmd_open_sidebar_context_menu(args.base, art, args.agent_id)
    elif args.cmd == "request_delete_agent":
        cmd_request_delete(args.base, art, args.agent_id)
    elif args.cmd == "cancel_delete_agent":
        cmd_cancel_delete(args.base, art, args.agent_id)
    elif args.cmd == "request_update_computer":
        cmd_request_update_computer(args.base, art)
    elif args.cmd == "confirm_update_computer_step":
        cmd_confirm_update_computer_step(args.base, art)
    elif args.cmd == "cancel_update_computer":
        cmd_cancel_update_computer(args.base, art)
    elif args.cmd == "open_reset_computer":
        cmd_open_reset_computer(args.base, art)
    elif args.cmd == "set_local_execution":
        en = args.enabled in ("true", "on", "1")
        cmd_set_local_execution(args.base, art, en)
    elif args.cmd == "try_machine_call":
        cmd_try_machine_call(args.base, art, args.machine_id)
    elif args.cmd in ("set_agent_hidden", "address_agent", "open_info_panel", "open_agent_settings",
                      "set_agent_notify", "create_agent", "open_members_panel",
                      "show_permission_guide", "follow_permission_guide",
                      "open_webhook_panel", "user_copy_webhook", "assistant_tool_read_webhook_key",
                      "webhook_wake", "show_device_permission_card",
                      "react_to_message", "end_turn", "show_math_mermaid",
                      "show_cursor_agent_card"):
        truthy = lambda v: str(v).lower() in ("true", "on", "1")
        body: dict = {}
        if getattr(args, "agent_id", None): body["agent_id"] = args.agent_id
        if getattr(args, "name", None): body["name"] = args.name
        if args.cmd == "set_agent_hidden": body["hidden"] = truthy(args.hidden)
        if args.cmd == "set_agent_notify":
            body["toggle"] = args.toggle
            body["value"] = truthy(args.value)
        if args.cmd == "open_members_panel":
            body["group_id"] = args.group_id or "h2-group"
            body["member_ids"] = [m for m in args.member_ids.split(",") if m]
        if args.cmd == "show_permission_guide":
            body["kind"] = args.kind or "connector-needs-auth"
            body["namespace"] = args.namespace or "user-Gmail"
        if args.cmd == "open_webhook_panel":
            if args.url: body["url"] = args.url
            if getattr(args, "key", None): body["key"] = args.key
        if args.cmd == "user_copy_webhook":
            body["what"] = args.what or "url"
        if args.cmd == "webhook_wake":
            body["event_id"] = args.event_id or "evt-h3"
            body["summary"] = args.summary or "POST /hooks received"
        if args.cmd == "show_device_permission_card":
            body["machine_id"] = args.machine_id or "phone-ios"
            body["tool_name"] = args.tool_name or "camera"
            body["permission_label"] = args.permission_label or "needs_permission"
        if args.cmd == "react_to_message":
            body["message_id"] = args.message_id or "msg-h5-1"
            body["emoji"] = args.emoji or "👍"
            body["toggle"] = truthy(args.toggle)
        if args.cmd == "end_turn":
            body["leave_pill"] = truthy(args.leave_pill)
        if args.cmd == "show_math_mermaid":
            body["math_tex"] = args.math_tex
            body["mermaid_src"] = args.mermaid_src
        if args.cmd == "show_cursor_agent_card":
            if args.url:
                body["url"] = args.url
        cmd_generic(args.base, art, args.cmd, body, args.tag)
    elif args.cmd == "dump":
        cmd_dump(args.base, art)


if __name__ == "__main__":
    main()
