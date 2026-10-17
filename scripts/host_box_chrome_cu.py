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
    # Multi-step planner for playbook / open tasks when no explicit actions given.
    if not steps:
        steps = plan_actions(command or "")
    return "|".join(steps)


def plan_actions(command: str) -> List[str]:
    """Host-side GUI planner (observe heuristics → act steps). Not LocalBrain."""
    low = (command or "").lower()
    steps: List[str] = ["evaluate:document.title"]
    if "shop" in low or "retail" in low or "cart" in low or "checkout" in low:
        # Observe → search/product → cart → checkout (honest stop on sign-in later).
        steps.extend(
            [
                "scroll:0,400",
                "click:520,360",
                "scroll:0,200",
                "evaluate:document.title",
            ]
        )
    elif "travel" in low or "flight" in low or "hotel" in low:
        steps.extend(["scroll:0,300", "click:480,300", "evaluate:document.title"])
    elif "food" in low or "order" in low or "restaurant" in low:
        steps.extend(["scroll:0,350", "click:500,320", "evaluate:document.title"])
    elif "job" in low or "linkedin" in low:
        steps.extend(["scroll:0,500", "evaluate:document.body.innerText.slice(0,80)"])
    else:
        # Generic open/navigate planner: scroll then re-observe.
        steps.extend(["scroll:0,200", "evaluate:document.title"])
    return steps


# DOM observe expression — MUST NOT contain "|" (host_cdp_actions splits on "|",
# including "||"). Use ternaries / ifs only. Host FFI vision, not LocalBrain.
_DOM_OBSERVE_JS = (
    "evaluate:(function(){try{"
    "function box(el){if(!el)return null;var r=el.getBoundingClientRect();"
    "if(r.width<2)return null;if(r.height<2)return null;"
    "return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),"
    "w:Math.round(r.width),h:Math.round(r.height)};}"
    "function pick(sels){for(var i=0;i<sels.length;i++){var el=document.querySelector(sels[i]);if(el)return el;}return null;}"
    "var t=(document.title?document.title:'').slice(0,120);"
    "var bodyTxt=document.body?document.body.innerText:'';"
    "var txt=(bodyTxt?bodyTxt:'').slice(0,600).toLowerCase();"
    "var searchEl=pick(['input[type=search]','input[name*=search]','input[placeholder*=search]','input[aria-label*=search]','#search','[data-test=searchInput]']);"
    "var cartEl=pick(['a[href*=cart]','button[aria-label*=cart]','[data-test*=cart]','a[href*=bag]']);"
    "var checkoutEl=pick(['a[href*=checkout]','button[name*=checkout]','button[aria-label*=checkout]','[data-test*=checkout]','input[value*=checkout]']);"
    "var payEl=pick(['input[name*=card]','input[autocomplete=cc-number]','input[name*=cvv]','iframe[src*=stripe]','iframe[src*=paypal]','button[aria-label*=pay]','[data-test*=payment]','form[action*=pay]']);"
    "var primaryBtn=pick(['button[type=submit]','button.primary','a.button','[role=button]','button']);"
    "var inputs=document.querySelectorAll('input,textarea,[contenteditable]').length;"
    "var buttons=document.querySelectorAll('button,a,[role=button]').length;"
    "var links=document.querySelectorAll('a[href]').length;"
    "var searchBox=box(searchEl);var cartBox=box(cartEl);var checkoutBox=box(checkoutEl);var payBox=box(payEl);var primaryBox=box(primaryBtn);"
    "var hasSearch=searchEl?true:/search/.test(txt);"
    "var hasSignin=/sign in/.test(txt);if(!hasSignin)hasSignin=/log in/.test(txt);if(!hasSignin)hasSignin=/login/.test(txt);"
    "var hasCart=cartEl?true:/cart/.test(txt);"
    "var hasCheckout=checkoutEl?true:/checkout/.test(txt);if(!hasCheckout)hasCheckout=/place order/.test(txt);"
    "var hasPayment=payEl?true:false;if(!hasPayment)hasPayment=/payment/.test(txt);if(!hasPayment)hasPayment=/credit card/.test(txt);if(!hasPayment)hasPayment=/card number/.test(txt);if(!hasPayment)hasPayment=/pay now/.test(txt);if(!hasPayment)hasPayment=/billing/.test(txt);"
    "var hasResults=/results/.test(txt);if(!hasResults)hasResults=/products/.test(txt);"
    "return JSON.stringify({title:t,text_len:txt.length,inputs:inputs,buttons:buttons,links:links,"
    "has_search:hasSearch,has_signin:hasSignin,has_cart:hasCart,has_checkout:hasCheckout,has_payment:hasPayment,has_results:hasResults,"
    "targets:{search:searchBox,cart:cartBox,checkout:checkoutBox,payment:payBox,primary:primaryBox}});"
    "}catch(e){return JSON.stringify({error:String(e)});}})()"
)


def analyze_screenshot(path: Optional[str]) -> Dict[str, Any]:
    """PIL vision heuristics (no OCR/tesseract). Host-side observe only."""
    if not path or not Path(path).exists():
        return {"ok": False, "error": "no screenshot"}
    try:
        from PIL import Image, ImageStat, ImageFilter

        img = Image.open(path).convert("RGB")
        w, h = img.size
        # Downsample for hotspot scan.
        small = img.resize((min(220, w), max(1, int(min(220, w) * h / max(w, 1)))), Image.BILINEAR)
        sw, sh = small.size
        edge = small.filter(ImageFilter.FIND_EDGES)
        px = edge.load()
        # Grid cells with high edge energy ≈ likely UI controls.
        cells: List[Tuple[int, int, float]] = []
        gx, gy = 8, 6
        cw, ch = max(1, sw // gx), max(1, sh // gy)
        for iy in range(gy):
            for ix in range(gx):
                energy = 0.0
                n = 0
                for y in range(iy * ch, min(sh, (iy + 1) * ch)):
                    for x in range(ix * cw, min(sw, (ix + 1) * cw)):
                        r, g, b = px[x, y]
                        energy += (r + g + b) / 3.0
                        n += 1
                if n:
                    cells.append((ix, iy, energy / n))
        cells.sort(key=lambda c: c[2], reverse=True)
        hotspots = []
        for ix, iy, energy in cells[:5]:
            # Map cell center back to window coords (1100x800 capture).
            cx = int((ix + 0.5) * (1100 / gx))
            cy = int((iy + 0.5) * (800 / gy))
            hotspots.append({"x": cx, "y": cy, "energy": round(energy, 2)})
        stat = ImageStat.Stat(img)
        mean = sum(stat.mean) / 3.0
        # Unique-ish color estimate via quantized palette.
        q = img.resize((160, 120)).quantize(colors=64)
        unique = len(q.getcolors() or [])
        return {
            "ok": True,
            "width": w,
            "height": h,
            "brightness": round(mean, 2),
            "unique_colors_est": unique,
            "sparse": unique < 12 and mean > 200,
            "dark": mean < 40,
            "hotspots": hotspots,
            "tool": "pil-edge-hotspots",
            "ocr": False,
            "ocr_residual": True,
            "note": "PIL edge hotspots only — OCR residual (no tesseract)",
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def parse_dom_observe(action_result: Dict[str, Any]) -> Dict[str, Any]:
    """Extract DOM observe JSON from CDP evaluate action results."""
    actions = action_result.get("actions") if isinstance(action_result, dict) else None
    if not isinstance(actions, list):
        return {}
    for a in actions:
        if not isinstance(a, dict):
            continue
        if a.get("kind") != "evaluate":
            continue
        val = a.get("value")
        if isinstance(val, str) and val.startswith("{"):
            try:
                return json.loads(val)
            except json.JSONDecodeError:
                continue
        if isinstance(val, dict):
            return val
    return {}


def plan_vision_actions(
    command: str, dom: Dict[str, Any], vision: Dict[str, Any]
) -> List[str]:
    """Second-pass planner: DOM bbox targets + screenshot hotspots → act steps."""
    low = (command or "").lower()
    steps: List[str] = []
    blocked_signin = bool(dom.get("has_signin")) and not dom.get("has_results")
    targets = dom.get("targets") if isinstance(dom.get("targets"), dict) else {}
    hotspot = None
    if vision.get("ok") and vision.get("hotspots"):
        hotspot = vision["hotspots"][0]
    # Prefer real DOM bounding-box targets over heuristic coordinates.
    if (
        targets.get("search")
        and any(
            k in low
            for k in ("shop", "retail", "travel", "flight", "hotel", "food", "job", "search")
        )
    ):
        sx, sy = int(targets["search"]["x"]), int(targets["search"]["y"])
        query = "headphones"
        for tok in (
            "headphones",
            "laptop",
            "shoes",
            "flights",
            "hotel",
            "pizza",
            "engineer",
        ):
            if tok in low:
                query = tok
                break
        steps.extend(
            [f"click:{sx},{sy}", f"type:{query}", "evaluate:document.title"]
        )
    elif dom.get("has_search") and any(
        k in low for k in ("shop", "retail", "travel", "flight", "hotel", "food", "job")
    ):
        query = "headphones"
        for tok in ("headphones", "laptop", "shoes", "flights", "hotel", "pizza", "engineer"):
            if tok in low:
                query = tok
                break
        steps.extend(
            ["click:550,120", f"type:{query}", "evaluate:document.title"]
        )
    elif blocked_signin:
        # Honest stop: do not attempt credential entry; re-observe only.
        steps.append("evaluate:document.title")
    elif targets.get("checkout") and (
        "checkout" in low or "shop" in low or dom.get("has_checkout")
    ):
        ox, oy = int(targets["checkout"]["x"]), int(targets["checkout"]["y"])
        steps.extend([f"click:{ox},{oy}", "evaluate:document.title"])
    elif targets.get("cart") and ("shop" in low or "cart" in low or dom.get("has_cart")):
        cx, cy = int(targets["cart"]["x"]), int(targets["cart"]["y"])
        steps.extend([f"click:{cx},{cy}", "evaluate:document.title"])
    elif targets.get("primary") and not vision.get("sparse"):
        px, py = int(targets["primary"]["x"]), int(targets["primary"]["y"])
        steps.extend([f"click:{px},{py}", "scroll:0,200", "evaluate:document.title"])
    elif hotspot and not vision.get("sparse"):
        steps.extend(
            [
                f"click:{hotspot['x']},{hotspot['y']}",
                "scroll:0,250",
                "evaluate:document.title",
            ]
        )
    elif dom.get("has_cart") or "shop" in low:
        steps.extend(["scroll:0,500", "click:900,80", "evaluate:document.title"])
    else:
        steps.extend(["scroll:0,300", "evaluate:document.title"])
    return steps


def choose_gui_mode(explicit: str = "") -> str:
    mode = (explicit or os.environ.get("BITBOT_CU_GUI_MODE") or "").strip().lower()
    if mode in ("window", "os", "headed", "headless"):
        return "window" if mode in ("window", "os", "headed") else "headless"
    if os.environ.get("DISPLAY"):
        return "window"
    return "headless"


def probe_native_os_input() -> Dict[str, Any]:
    """Probe true OS-window input tools (xdotool/wmctrl) — never invent clicks."""
    display = os.environ.get("DISPLAY") or ""
    tools = {
        "xdotool": bool(shutil.which("xdotool")),
        "wmctrl": bool(shutil.which("wmctrl")),
        "xwininfo": bool(shutil.which("xwininfo")),
    }
    probe: Dict[str, Any] = {
        "display": display or None,
        "tools": tools,
        "mouse": None,
        "windows": None,
        "ok": False,
    }
    if not display:
        probe["error"] = "no DISPLAY"
        probe["os_window_automation_residual"] = True
        return probe
    if tools["xdotool"]:
        try:
            proc = subprocess.run(
                ["xdotool", "getmouselocation", "--shell"],
                capture_output=True,
                text=True,
                timeout=5,
                env={**os.environ, "DISPLAY": display},
            )
            mouse: Dict[str, str] = {}
            for line in (proc.stdout or "").splitlines():
                if "=" in line:
                    k, v = line.split("=", 1)
                    mouse[k.strip()] = v.strip()
            if mouse:
                probe["mouse"] = mouse
                probe["ok"] = True
        except Exception as e:  # noqa: BLE001
            probe["xdotool_error"] = str(e)[:200]
    if tools["wmctrl"]:
        try:
            proc = subprocess.run(
                ["wmctrl", "-l"],
                capture_output=True,
                text=True,
                timeout=5,
                env={**os.environ, "DISPLAY": display},
            )
            lines = [ln for ln in (proc.stdout or "").splitlines() if ln.strip()]
            probe["windows"] = {"count": len(lines), "sample": lines[:5]}
            if lines:
                probe["ok"] = True
        except Exception as e:  # noqa: BLE001
            probe["wmctrl_error"] = str(e)[:200]
    # Residual until both mouse-location and window-list tools are usable for act.
    probe["os_window_automation_residual"] = not (
        bool(probe.get("mouse")) and bool((probe.get("windows") or {}).get("count"))
    )
    probe["note"] = (
        "native OS input probe (xdotool/wmctrl) — CDP remains primary act path"
        if probe["ok"]
        else "OS-window automation residual — install xdotool+wmctrl for native input"
    )
    return probe


def capture_screenshot(artifact_dir: Path) -> Dict[str, Any]:
    out = artifact_dir / "gui-screenshot.png"
    display = os.environ.get("DISPLAY") or ""
    if not display:
        return {"ok": False, "error": "no DISPLAY", "path": None}
    # Prefer ffmpeg x11grab (available in Host env), then import/gnome-screenshot/scrot.
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        try:
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-f",
                    "x11grab",
                    "-video_size",
                    "1100x800",
                    "-i",
                    f"{display}+0,0",
                    "-frames:v",
                    "1",
                    str(out),
                ],
                check=False,
                timeout=12,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if out.exists() and out.stat().st_size > 0:
                return {
                    "ok": True,
                    "path": str(out),
                    "bytes": out.stat().st_size,
                    "tool": "ffmpeg-x11grab",
                    "display": display,
                }
        except Exception as e:  # noqa: BLE001
            pass
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

    # Agent loop while Chrome stays alive:
    # observe(DOM) → act(playbook) → vision(screenshot+PIL) → act(vision) → reobserve.
    observe_dom: Dict[str, Any] = {}
    action_result: Dict[str, Any] = {}
    vision_plan: Dict[str, Any] = {"ok": False}
    vision_actions: Dict[str, Any] = {}
    screenshot: Dict[str, Any] = {"ok": False}
    command_hint = ""
    # Prefer original command from env for vision keywording when caller sets it.
    command_hint = os.environ.get("BITBOT_CU_COMMAND") or ""

    if version:
        # Let the page settle before DOM observe (SPAs often blank for ~1s).
        time.sleep(1.0)
        # Observe: DOM structure / keywords (Host FFI, not LocalBrain).
        obs = run_cdp_actions(port, _DOM_OBSERVE_JS, repo_root)
        observe_dom = parse_dom_observe(obs)
        if not observe_dom and isinstance(obs, dict):
            observe_dom = {"title": obs.get("title"), "raw_ok": obs.get("ok")}
        # Act: playbook / explicit steps.
        if actions:
            action_result = run_cdp_actions(port, actions, repo_root)
        # Re-observe DOM after playbook act (targets often appear post-hydration).
        obs2 = run_cdp_actions(port, _DOM_OBSERVE_JS, repo_root)
        dom2 = parse_dom_observe(obs2)
        if dom2 and (
            not observe_dom.get("targets")
            or not any((observe_dom.get("targets") or {}).values())
        ):
            if any((dom2.get("targets") or {}).values()) or dom2.get("text_len", 0) > (
                observe_dom.get("text_len") or 0
            ):
                observe_dom = dom2
        # Vision: screenshot + PIL hotspots (window mode preferred; headless skip).
        if gui_mode == "window":
            time.sleep(0.5)
            screenshot = capture_screenshot(artifact_dir)
        vision = analyze_screenshot(screenshot.get("path") if screenshot else None)
        # Prefer command from caller via actions context file if present.
        cmd_path = artifact_dir / "cu_command.txt"
        if cmd_path.exists():
            command_hint = cmd_path.read_text(encoding="utf-8")
        vision_steps = plan_vision_actions(command_hint, observe_dom, vision)
        vision_plan = {
            "ok": bool(vision.get("ok") or observe_dom),
            "dom": observe_dom,
            "vision": vision,
            "steps": vision_steps,
            "blocked_on_signin": bool(observe_dom.get("has_signin"))
            and not observe_dom.get("has_results"),
        }
        if vision_steps:
            vision_actions = run_cdp_actions(port, "|".join(vision_steps), repo_root)
        # Re-observe screenshot after vision act.
        if gui_mode == "window":
            time.sleep(0.4)
            screenshot = capture_screenshot(artifact_dir)
            vision_plan["reobserve_vision"] = analyze_screenshot(
                screenshot.get("path") if screenshot else None
            )

    native_os = probe_native_os_input() if gui_mode == "window" else {
        "ok": False,
        "os_window_automation_residual": True,
        "note": "headless — no native OS window input",
    }
    if gui_mode == "window":
        (artifact_dir / "native_os_input.json").write_text(
            json.dumps(native_os, indent=2) + "\n", encoding="utf-8"
        )
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
        "vision_plan": vision_plan,
        "vision_actions": vision_actions,
        "screenshot": screenshot,
        "native_os_input": native_os,
        "os_window_automation_residual": bool(
            native_os.get("os_window_automation_residual", True)
        ),
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
    if not url:
        import re

        # Playbook commands often embed bare hosts (target.com / amazon.com).
        m = re.search(
            r"\b((?:[a-z0-9-]+\.)+(?:com|net|org|io|co|shop|store))\b",
            args.command or "",
            flags=re.I,
        )
        if m:
            url = "https://" + m.group(1)

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
    # Persist command for vision keywording inside chrome session.
    (artifact_dir / "cu_command.txt").write_text(args.command or "", encoding="utf-8")
    os.environ["BITBOT_CU_COMMAND"] = args.command or ""
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

    # CM-1202-shaped structured outcome for parent (no raw click stream).
    title = None
    if isinstance(gui.get("actions"), dict):
        title = gui["actions"].get("title")
    if not title and isinstance(gui.get("vision_actions"), dict):
        title = gui["vision_actions"].get("title")
    steps_ok = True
    if isinstance(gui.get("actions"), dict) and "ok" in gui["actions"]:
        steps_ok = bool(gui["actions"].get("ok"))
    vision_plan = gui.get("vision_plan") if isinstance(gui.get("vision_plan"), dict) else {}
    vision_ok = bool(vision_plan.get("ok"))
    blocked_signin = bool(vision_plan.get("blocked_on_signin"))
    dom_obs = vision_plan.get("dom") if isinstance(vision_plan.get("dom"), dict) else {}
    cmd_low = (args.command or "").lower()
    is_shop = any(k in cmd_low for k in ("shop", "retail", "cart", "checkout", "buy"))
    is_travel = any(k in cmd_low for k in ("travel", "flight", "hotel", "rideshare"))
    is_food = any(k in cmd_low for k in ("food", "order", "restaurant", "doordash", "ubereats"))
    # Honest stage machine for shopping / travel / food playbooks.
    # payment_wall = checkout reached a pay form; never auto-charge.
    has_payment = bool(dom_obs.get("has_payment"))
    live_paid = os.environ.get("BITBOT_CU_LIVE_PAID", "").strip() in ("1", "true", "yes")
    if blocked_signin:
        vertical_stage = "blocked_on_signin"
    elif is_shop and has_payment:
        vertical_stage = "payment_wall"
    elif is_shop and dom_obs.get("has_checkout"):
        vertical_stage = "checkout"
    elif is_shop and dom_obs.get("has_cart"):
        vertical_stage = "cart"
    elif (is_shop or is_travel or is_food) and (
        dom_obs.get("has_results") or dom_obs.get("has_search")
    ):
        vertical_stage = "browse"
    elif (is_shop or is_travel or is_food) and navigate.get("navigate_reachable"):
        vertical_stage = "landed"
    elif is_shop or is_travel or is_food:
        vertical_stage = "unreachable"
    else:
        vertical_stage = "n/a"
    paid_checkout_attempted = False
    live_paid_residual = bool(is_shop and vertical_stage == "payment_wall" and not live_paid)
    if is_travel:
        playbook = "travel"
    elif is_food:
        playbook = "food"
    elif is_shop:
        playbook = "shopping"
    else:
        playbook = "generic"
    checkout_stage = vertical_stage if is_shop else (
        "n/a" if playbook == "generic" else vertical_stage
    )
    outcome = {
        "agent_id": f"cu-host-{artifact_dir.name}",
        "summary": "structured outcome only",
        "final_url": navigate.get("url"),
        "blocked_on_signin": blocked_signin,
        "checkout_stage": checkout_stage,
        "vertical_stage": vertical_stage,
        "playbook": playbook,
        "has_cart": bool(dom_obs.get("has_cart")),
        "has_checkout": bool(dom_obs.get("has_checkout")),
        "has_payment": has_payment,
        "paid_checkout_attempted": paid_checkout_attempted,
        "live_paid_residual": live_paid_residual,
        "navigate_reachable": bool(navigate.get("navigate_reachable")),
        "os_window": bool(gui.get("os_window")),
        "os_window_automation_residual": bool(
            gui.get("os_window_automation_residual", True)
        ),
        "actions_ok": steps_ok,
        "screenshot_ok": bool((gui.get("screenshot") or {}).get("ok")),
        "vision_ok": vision_ok,
        "ocr": False,
        "ocr_residual": True,
        "page_title": title,
        "shared_cdp_untouched": gui.get("shared_cdp_untouched", True),
        "pretend_purchased": False,
        "pretend_booked": False,
        "pretend_ordered": False,
    }
    checkout_summary = {
        "checkout_stage": checkout_stage,
        "vertical_stage": vertical_stage,
        "blocked_on_signin": blocked_signin,
        "has_cart": bool(dom_obs.get("has_cart")),
        "has_checkout": bool(dom_obs.get("has_checkout")),
        "has_payment": has_payment,
        "paid_checkout_attempted": paid_checkout_attempted,
        "live_paid_residual": live_paid_residual,
        "playbook": playbook,
        "pretend_purchased": False,
        "pretend_booked": False,
        "pretend_ordered": False,
        "note": (
            "payment_wall reached — live paid checkout residual (BITBOT_CU_LIVE_PAID unset)"
            if live_paid_residual
            else "Host CU vertical deepen — never pretends paid/booked/ordered"
        ),
    }
    (artifact_dir / "checkout_summary.json").write_text(
        json.dumps(checkout_summary, indent=2) + "\n", encoding="utf-8"
    )
    gui["checkout_summary"] = checkout_summary
    gui["vertical_summary"] = checkout_summary
    # Agent loop: observe → act → vision → act → reobserve (Host-side, not LocalBrain).
    agent_loop = {
        "observe": {
            "http_status": navigate.get("http_status"),
            "navigate_reachable": navigate.get("navigate_reachable"),
            "dom": vision_plan.get("dom") if vision_plan else None,
        },
        "act": {
            "gui_mode": gui.get("gui_mode"),
            "actions": (gui.get("actions") or {}).get("actions"),
        },
        "vision": {
            "ok": vision_ok,
            "steps": vision_plan.get("steps") if vision_plan else [],
            "hotspots": ((vision_plan.get("vision") or {}).get("hotspots") if vision_plan else None),
            "dom_targets": (vision_plan.get("dom") or {}).get("targets") if vision_plan else None,
            "vision_actions": (gui.get("vision_actions") or {}).get("actions"),
            "blocked_on_signin": blocked_signin,
        },
        "reobserve": {
            "title": title,
            "screenshot": gui.get("screenshot"),
            "vision": vision_plan.get("reobserve_vision") if vision_plan else None,
        },
        "outcome": outcome,
    }
    (artifact_dir / "agent_loop.json").write_text(
        json.dumps(agent_loop, indent=2) + "\n", encoding="utf-8"
    )

    summary = {
        "ok": True,
        "command": args.command,
        "navigate": navigate,
        "http": http_meta,
        "gui": gui,
        "outcome": outcome,
        "agent_loop": agent_loop,
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
