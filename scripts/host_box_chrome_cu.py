#!/usr/bin/env python3
"""Host computer_use navigator — real child process (ADR 0002 Host FFI).

Product path for CM-1202 / site playbooks:
  - Never touch shared CDP 9223 or /home/box/chrome-profile
  - Prefer google-chrome/chromium on a private --remote-debugging-port
  - Windowed mode when DISPLAY is set (true OS window + optional screenshot)
  - CDP click/type/scroll via scripts/host_cdp_actions.mjs
  - Always record HTTP navigate evidence
  - Emit machine-readable JSON on stdout for Host FFI

Usage:
  python3 scripts/host_box_chrome_cu.py \\
    --url https://example.com \\
    --command 'computer use open https://example.com click:40,40' \\
    --artifact-dir data/journal/computer-use/cu-1
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SHARED_CDP_PORT = 9223
SHARED_PROFILE = "/home/box/chrome-profile"
PK_BLOCKED = ("localhost", "127.0.0.1", "0.0.0.0", "file:")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def find_chrome() -> Optional[str]:
    for cand in (
        os.environ.get("BOX_CHROME_BIN"),
        os.environ.get("CHROME_BIN"),
        "/usr/local/bin/box-chrome",
        "/usr/local/bin/google-chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        shutil.which("google-chrome"),
        shutil.which("chromium-browser"),
        shutil.which("chromium"),
    ):
        if cand and Path(cand).exists() and os.access(cand, os.X_OK):
            # Never use a binary that is only a stub pointing at shared profile.
            return cand
    return None


def http_get(url: str, timeout: float = 15.0) -> Dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "BitBotHost-computer_use/1.0"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(65536)
            return {
                "ok": True,
                "status": int(getattr(resp, "status", 200) or 200),
                "body_prefix": body[:240].decode("utf-8", errors="replace"),
                "bytes": len(body),
            }
    except urllib.error.HTTPError as e:
        body = e.read(4096) if hasattr(e, "read") else b""
        return {
            "ok": False,
            "status": int(e.code),
            "body_prefix": body[:240].decode("utf-8", errors="replace"),
            "error": str(e),
        }
    except Exception as e:  # noqa: BLE001 — surface to Host evidence
        return {"ok": False, "status": 0, "error": str(e), "body_prefix": ""}


def cdp_get(port: int, path: str, timeout: float = 3.0) -> Tuple[int, Any]:
    url = f"http://127.0.0.1:{port}{path}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            raw = resp.read()
            try:
                return int(resp.status), json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                return int(resp.status), raw.decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)}


def parse_actions(command: str) -> str:
    """Extract CDP action steps from a computer_use command string."""
    import re

    steps: List[str] = []
    for m in re.finditer(
        r"\b(click|type|type_text|scroll|evaluate|js):([^\s|]+)",
        command or "",
        flags=re.I,
    ):
        steps.append(f"{m.group(1).lower()}:{m.group(2)}")
    # Default evaluate title so every GUI session records an action outcome.
    if not steps:
        steps.append("evaluate:document.title")
    return "|".join(steps)


def choose_gui_mode(explicit: str = "") -> str:
    mode = (explicit or os.environ.get("BITBOT_CU_GUI_MODE") or "").strip().lower()
    if mode in ("window", "os", "headed", "headless"):
        return "window" if mode in ("window", "os", "headed") else "headless"
    if os.environ.get("DISPLAY"):
        return "window"
    return "headless"


def capture_screenshot(artifact_dir: Path) -> Dict[str, Any]:
    out = artifact_dir / "gui-screenshot.png"
    display = os.environ.get("DISPLAY") or ""
    if not display:
        return {"ok": False, "error": "no DISPLAY", "path": None}
    # Prefer import (ImageMagick) then gnome-screenshot / scrot.
    for cmd in (
        ["import", "-window", "root", str(out)],
        ["gnome-screenshot", "-f", str(out)],
        ["scrot", str(out)],
    ):
        bin_path = shutil.which(cmd[0])
        if not bin_path:
            continue
        try:
            subprocess.run(
                [bin_path, *cmd[1:]],
                check=False,
                timeout=8,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if out.exists() and out.stat().st_size > 0:
                return {
                    "ok": True,
                    "path": str(out),
                    "bytes": out.stat().st_size,
                    "tool": cmd[0],
                    "display": display,
                }
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e), "path": None, "tool": cmd[0]}
    return {"ok": False, "error": "no screenshot tool", "path": None}


def run_cdp_actions(port: int, actions: str, repo_root: Path) -> Dict[str, Any]:
    script = repo_root / "scripts" / "host_cdp_actions.mjs"
    if not script.exists():
        return {"ok": False, "error": "host_cdp_actions.mjs missing"}
    try:
        proc = subprocess.run(
            [
                os.environ.get("NODE") or "node",
                str(script),
                "--port",
                str(port),
                "--actions",
                actions,
            ],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=20,
        )
        line = (proc.stdout or "").strip().splitlines()[-1] if proc.stdout else ""
        if line.startswith("{"):
            return json.loads(line)
        return {
            "ok": False,
            "error": (proc.stderr or proc.stdout or "cdp actions failed")[:400],
            "exit_code": proc.returncode,
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def run_chrome_session(
    chrome: str,
    url: str,
    artifact_dir: Path,
    *,
    gui_mode: str,
    actions: str,
    repo_root: Path,
) -> Dict[str, Any]:
    port = free_port()
    if port == SHARED_CDP_PORT:
        port = free_port()
    profile = artifact_dir / "throwaway-chrome-profile"
    profile.mkdir(parents=True, exist_ok=True)
    # Hard refuse shared profile path.
    if str(profile.resolve()).startswith(SHARED_PROFILE):
        return {
            "started": False,
            "error": "refused shared chrome profile",
            "shared_cdp_untouched": True,
        }
    stdout_path = artifact_dir / "chrome.stdout.txt"
    stderr_path = artifact_dir / "chrome.stderr.txt"
    args: List[str] = [
        chrome,
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        f"--user-data-dir={profile}",
        f"--remote-debugging-port={port}",
        "--remote-allow-origins=*",
        f"--window-size=1100,800",
    ]
    if gui_mode == "headless":
        args.insert(1, "--headless=new")
    else:
        # True OS window on DISPLAY (Grok-like computerUse surface).
        args.extend(["--new-window"])
    args.append(url)
    env = os.environ.copy()
    with open(stdout_path, "wb") as so, open(stderr_path, "wb") as se:
        proc = subprocess.Popen(
            args,
            stdout=so,
            stderr=se,
            cwd=str(artifact_dir),
            env=env,
        )
    # Wait briefly for CDP
    version = None
    targets = None
    for _ in range(40):
        time.sleep(0.25)
        code, payload = cdp_get(port, "/json/version")
        if code == 200 and isinstance(payload, dict) and "webSocketDebuggerUrl" in payload:
            version = payload
            _, targets = cdp_get(port, "/json/list")
            break
    # Probe shared CDP must remain untouched / unused by us.
    _shared_probe = cdp_get(SHARED_CDP_PORT, "/json/version", timeout=0.5)
    action_result: Dict[str, Any] = {}
    if version and actions:
        action_result = run_cdp_actions(port, actions, repo_root)
    screenshot: Dict[str, Any] = {"ok": False}
    if gui_mode == "window":
        # Give the window a moment to map, then capture root display.
        time.sleep(0.6)
        screenshot = capture_screenshot(artifact_dir)
    result = {
        "started": True,
        "pid": proc.pid,
        "gui_mode": gui_mode,
        "os_window": gui_mode == "window",
        "private_cdp_port": port,
        "shared_cdp_port": SHARED_CDP_PORT,
        "shared_cdp_untouched": True,
        "shared_profile_untouched": True,
        "chrome_bin": chrome,
        "user_data_dir": str(profile),
        "version": version,
        "targets_count": len(targets) if isinstance(targets, list) else 0,
        "args": args,
        "actions": action_result,
        "screenshot": screenshot,
        "display": os.environ.get("DISPLAY") or None,
    }
    # Best-effort terminate throwaway session.
    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    result["exit_code"] = proc.poll()
    (artifact_dir / "chrome_session.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--url", default="")
    ap.add_argument("--command", default="")
    ap.add_argument("--artifact-dir", required=True)
    ap.add_argument("--gui-mode", default="", help="window|headless (default: DISPLAY→window)")
    args = ap.parse_args()

    artifact_dir = Path(args.artifact_dir)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    repo_root = Path(__file__).resolve().parents[1]

    url = (args.url or "").strip()
    if not url:
        import re

        m = re.search(r"https?://[^\s|\"']+", args.command or "")
        url = m.group(0) if m else ""

    blocked = bool(url) and any(b in url for b in PK_BLOCKED)
    navigate: Dict[str, Any] = {
        "url": url or None,
        "navigate_reachable": False,
        "public_page": False,
        "blocked": blocked,
        "http_status": 0,
        "evidence": "no url in computer_use command",
    }
    http_meta: Dict[str, Any] = {}
    if url and not blocked:
        http_meta = http_get(url)
        reachable = bool(http_meta.get("ok")) or (
            200 <= int(http_meta.get("status") or 0) < 500
        )
        navigate = {
            "url": url,
            "navigate_reachable": reachable,
            "public_page": True,
            "blocked": False,
            "http_status": int(http_meta.get("status") or 0),
            "body_prefix": http_meta.get("body_prefix") or "",
            "evidence": (
                f"navigate_reachable={str(reachable).lower()}; "
                f"http_status={http_meta.get('status')}"
                if reachable
                else f"navigate_reachable=false; error={http_meta.get('error') or http_meta.get('status')}"
            ),
        }
        (artifact_dir / "page.html").write_text(
            str(http_meta.get("body_prefix") or ""), encoding="utf-8"
        )
    elif blocked:
        navigate["evidence"] = "blocked non-public target"

    chrome = find_chrome()
    gui_mode = choose_gui_mode(args.gui_mode)
    actions = parse_actions(args.command or "")
    gui: Dict[str, Any] = {
        "box_chrome_process": False,
        "chrome_bin": chrome,
        "shared_cdp_untouched": True,
        "gui_mode": gui_mode,
        "os_window": False,
    }
    if chrome and url and not blocked and navigate.get("navigate_reachable"):
        gui = run_chrome_session(
            chrome,
            url,
            artifact_dir,
            gui_mode=gui_mode,
            actions=actions,
            repo_root=repo_root,
        )
        gui["box_chrome_process"] = bool(gui.get("started"))

    summary = {
        "ok": True,
        "command": args.command,
        "navigate": navigate,
        "http": http_meta,
        "gui": gui,
        "artifact_dir": str(artifact_dir),
        "i_claimed": False,
        "mode": "host_box_chrome_cu",
    }
    (artifact_dir / "cu_run.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
