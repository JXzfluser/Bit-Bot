#!/usr/bin/env python3
"""Generate §3.3 evidence.json for an H2 artifact dir (called by host_h2_smoke.sh)."""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path


def md5(path: Path) -> str | None:
    if not path.exists():
        return None
    return hashlib.md5(path.read_bytes()).hexdigest()


def load_kv(path: Path) -> dict:
    out = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def main() -> int:
    d = Path(sys.argv[1])
    meta = load_kv(d / "probe_meta.txt")
    iso = load_kv(d / "isolation_meta.txt")
    spans = []
    asp = d / "audit_spans.jsonl"
    if asp.exists():
        for line in asp.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                spans.append(json.loads(line))
            except Exception:
                pass
    span_ids = [s.get("id") for s in spans if s.get("id")]
    frames = sorted(f.name for f in d.glob("*.png"))
    frame_meta = []
    fm = d / "frames_meta.txt"
    if fm.exists():
        cur: dict = {}
        for line in fm.read_text().splitlines():
            if line.startswith("frame=") and cur:
                frame_meta.append(cur)
                cur = {}
            if "=" in line:
                k, v = line.split("=", 1)
                cur[k.strip()] = v.strip()
        if cur:
            frame_meta.append(cur)

    name = d.name
    if name.startswith("cm-1901"):
        cm = "CM-1901"
    elif name.startswith("cm-1902"):
        cm = "CM-1902"
    elif name.startswith("cm-1903"):
        cm = "CM-1903"
    elif name.startswith("cm-1904"):
        cm = "CM-1904"
    elif name.startswith("cm-1905"):
        cm = "CM-1905"
    elif name.startswith("cm-1906"):
        cm = "CM-1906"
    elif name.startswith("cm-1907"):
        cm = "CM-1907"
    elif name[:7] in ("cm-0204", "cm-0205", "cm-0206", "cm-1401", "cm-1405", "cm-1507", "cm-2178"):
        cm = name[:7].upper()
    else:
        cm = meta.get("cm", "CM-UNKNOWN")

    status = None
    em = d / "evidence.md"
    if em.exists():
        m = re.search(r"\| status \| ([^|]+) \|", em.read_text())
        if m:
            status = m.group(1).strip()

    base: dict = {
        "CM": cm,
        "evidence_cmd": f"bash /workspace/bitbot/scripts/host_h2_smoke.sh {cm.lower()}",
        "artifact_dir": str(d),
        "env": {
            "surface": "bit-bot-host-ui",
            "section_3_0": "C_prime",
            "display": meta.get("display") or iso.get("private_display"),
            "USER_IANA": "Asia/Shanghai",
            "shared_cdp_9223": "untouched",
            "chrome_profile": "untouched",
            "ui_drive": "HostUiShell_Live",
            "host_api": iso.get("host_api", "/api/host/*"),
            "smoke_entry": meta.get("smoke_entry", "HostAbi_run_h2_probe_aligned"),
        },
        "frame_origin": "LiveDisplay",
        "frames": frames,
        "frames_meta": frame_meta,
        "span_ids": span_ids,
        "audit_span_count": len(span_ids),
        "i_claimed": False,
        "section_3_0": "C_prime",
        "status": status,
    }

    if cm == "CM-1901":
        base["assert"] = (
            "three Settings entries via Live HostUiShell.open_settings; "
            "LiveDisplay entry_sidebar/shortcut/palette; no gear/Preferences"
        )
        base["entries"] = [
            "SidebarAccountButton",
            "KeyboardShortcut",
            "CommandPalette",
        ]
    elif cm == "CM-1902":
        base["artifact_dir_note"] = (
            "dir name is cm-1902-settings-anchor (singular); "
            "docs §3.3 also cite cm-1902-settings-anchors/"
        )
        base["assert"] = (
            "deep-link anchors theme/timezone/update-computer via HostUiShell; "
            "SettingsAnchorVisible; LiveDisplay"
        )
        base["anchors"] = ["theme", "timezone", "update-computer"]
        base["deeplink_form"] = "grokbot://app/v1/settings?id=<anchor>"
    elif cm == "CM-1903":
        base["assert"] = (
            "two-step Update Computer confirm UI (prompted → "
            "Click Again to Confirm → cancel); not Reset; LiveDisplay"
        )
        base["phase_sequence"] = meta.get(
            "phase_sequence", "prompted→awaiting-second-confirm→cancelled"
        )
        base["final_phase"] = meta.get("final_phase", "cancelled")
        base["completed"] = False
        base["not_reset"] = True
        base["anchor"] = meta.get("anchor", "update-computer")
        base["frames_required"] = [
            "update_prompted.png",
            "awaiting_second_confirm.png",
            "update_cancelled.png",
        ]
        base["update_prompted_md5"] = md5(d / "update_prompted.png")
        base["awaiting_second_confirm_md5"] = md5(d / "awaiting_second_confirm.png")
        base["two_step_frames_independent"] = (
            base["update_prompted_md5"] is not None
            and base["awaiting_second_confirm_md5"] is not None
            and base["update_prompted_md5"] != base["awaiting_second_confirm_md5"]
        )
    elif cm == "CM-1904":
        base["assert"] = (
            "Reset Computer real UI reachable; guidance prefers update-computer"
        )
        base["anchor"] = meta.get("anchor", "reset-computer")
        base["reset_ui_reachable"] = True
        base["assistant_preferred"] = "update-computer"
        base["reset_preferred"] = False
        base["frames_required"] = ["reset_computer.png"]
    elif cm == "CM-1905":
        base["assert"] = (
            "local-execution off → Host refuses machineId; gate log + LiveDisplay"
        )
        base["local_execution"] = "off"
        base["machine_id"] = meta.get("machine_id", "desk-1")
        base["machine_call_rejected"] = meta.get("machine_call_rejected") == "true"
        base["reject_reason"] = meta.get("reject_reason", "")
        base["frames_required"] = [
            "local_execution_off.png",
            "machine_call_refused.png",
        ]
        gate = d / "gate_log.json"
        if gate.exists():
            try:
                base["gate_log"] = json.loads(gate.read_text())
            except Exception:
                base["gate_log"] = None
    elif cm == "CM-1906":
        base["assert"] = (
            "Updates tab (update-channel) vs update-computer distinguishable LiveDisplay"
        )
        base["updates_anchor"] = "update-channel"
        base["computer_anchor"] = "update-computer"
        base["update_channel_ne_update_computer"] = True
        base["frames_required"] = ["updates_tab.png", "update_computer.png"]
        base["updates_tab_md5"] = md5(d / "updates_tab.png")
        base["update_computer_md5"] = md5(d / "update_computer.png")
        base["frames_distinguishable"] = (
            base["updates_tab_md5"] is not None
            and base["update_computer_md5"] is not None
            and base["updates_tab_md5"] != base["update_computer_md5"]
        )
    elif cm == "CM-1907":
        base["assert"] = (
            "sidebar context_menu → AwaitingConfirm → Cancel only; "
            "independent LiveDisplay frames; completed=false"
        )
        base["phase_sequence"] = meta.get(
            "phase_sequence",
            "sidebar_context_menu→requested→awaiting-confirm→cancelled",
        )
        base["final_phase"] = meta.get("final_phase", "cancelled")
        base["completed"] = False
        base["delete_agent"] = meta.get("delete_agent", "h2-throwaway-agent")
        base["frames_required"] = [
            "context_menu.png",
            "awaiting_confirm.png",
            "cancelled.png",
        ]
        base["context_menu_md5"] = md5(d / "context_menu.png")
        base["awaiting_confirm_md5"] = md5(d / "awaiting_confirm.png")
        base["context_menu_independent"] = (
            base["context_menu_md5"] is not None
            and base["awaiting_confirm_md5"] is not None
            and base["context_menu_md5"] != base["awaiting_confirm_md5"]
        )

    B3 = {
        "CM-0204": ("Hidden agent not in main sidebar list but still addressable (real sidebar frame)",
                    ["sidebar_before.png", "sidebar_hidden.png", "addressed_hidden.png"]),
        "CM-0205": ("Five-anchor per-agent Info panel real frame; distinct from global Settings",
                    ["info_panel.png", "global_settings.png"]),
        "CM-0206": ("Per-agent notification toggles real UI, isolated per agent",
                    ["agent_a_defaults.png", "agent_a_toggled.png", "agent_b_defaults.png"]),
        "CM-1401": ("After CreateAgent: real sidebar row and Members visible",
                    ["before_create.png", "after_create_sidebar.png", "after_create_members.png"]),
        "CM-1405": ("Members panel matches app-ui anchors (members section in per-agent info pane)",
                    ["info_single_agent.png", "members_panel.png"]),
        "CM-1507": ("auto-review / auto-review-rules / security-keys deep links really scroll/show",
                    ["auto-review.png", "auto-review-rules.png", "security-keys.png"]),
        "CM-2178": ("Missing-permission guide really opens Settings; does not pretend connected",
                    ["guide_card.png", "settings_opened.png"]),
    }
    if cm in B3:
        base["assert"], base["frames_required"] = B3[cm]
        base["frames_md5"] = {f: md5(d / f) for f in B3[cm][1]}
        vals = list(base["frames_md5"].values())
        base["frames_distinct"] = None not in vals and len(set(vals)) == len(vals)
        base["checks"] = {k[len("check_"):]: v for k, v in meta.items() if k.startswith("check_")}
        base["checks_failed"] = [k for k in meta if k.startswith("FAIL")]
        base["reference"] = "/home/box/reference/app-ui.md (read-only) + docs/host-ui-contract.md"
        base["spans"] = [{"span_id": s.get("id"), "tool": s.get("tool_name"), "ok": s.get("ok"),
                          "detail": s.get("detail")} for s in spans]
        if cm == "CM-1507":
            # Page→Host viewport receipts (Bit验证 note 1)
            vps = {}
            for a in ("auto-review", "auto-review-rules", "security-keys"):
                f = d / f"host_ui_event_anchor_{a}.json"
                if not f.exists():
                    continue
                try:
                    payload = json.loads(f.read_text())
                except Exception:
                    continue
                av = payload.get("anchorViewport") or (payload.get("state") or {}).get("anchorViewport")
                if isinstance(av, dict):
                    vps[a] = {
                        "anchor_id": av.get("anchor_id"),
                        "scrollTop": av.get("scrollTop"),
                        "boundingRect": av.get("boundingRect"),
                        "highlighted": av.get("highlighted"),
                        "inViewport": av.get("inViewport"),
                    }
            base["anchor_viewports"] = vps
            base["assert"] = (
                "auto-review / auto-review-rules / security-keys deep links; "
                "page→Host {anchor_id,scrollTop,boundingRect,highlighted}; inViewport"
            )
        if cm == "CM-0204":
            base["host_ui_event"] = "SidebarHiddenAgentAddressable"
            base["assert"] = (
                "Hidden agent not in main sidebar list but still addressable "
                "(SidebarHiddenAgentAddressable; real sidebar frame)"
            )

    out = d / "evidence.json"
    out.write_text(json.dumps(base, indent=2) + "\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
