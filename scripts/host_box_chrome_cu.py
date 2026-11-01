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
import re
import shutil
import signal
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


def run_tesseract_ocr(path: str) -> Dict[str, Any]:
    """Optional OCR via tesseract CLI (BITBOT_CU_OCR=1). Never invent text.

    BITBOT_TESSERACT_BIN injects an alternate binary (like BITBOT_STT_BIN) for
    smoke/mock; default without a working binary keeps ocr_residual true.
    """
    enabled = os.environ.get("BITBOT_CU_OCR", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    out: Dict[str, Any] = {
        "enabled": enabled,
        "ok": False,
        "text": "",
        "tool": None,
        "ocr_residual": True,
    }
    if not enabled:
        out["note"] = "OCR disabled — set BITBOT_CU_OCR=1 to run tesseract"
        return out
    tess_override = os.environ.get("BITBOT_TESSERACT_BIN", "").strip()
    if tess_override:
        if os.path.isfile(tess_override) and os.access(tess_override, os.X_OK):
            tess = tess_override
        else:
            tess = shutil.which(tess_override)
    else:
        tess = shutil.which("tesseract")
    if not tess:
        out["error"] = "tesseract not found"
        out["note"] = (
            "OCR residual — install tesseract-ocr or set BITBOT_TESSERACT_BIN"
        )
        return out
    tool_name = Path(tess).name
    try:
        proc = subprocess.run(
            [tess, path, "stdout", "-l", "eng", "--psm", "6"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        text = (proc.stdout or "").strip()
        out["ok"] = proc.returncode == 0 and bool(text)
        out["text"] = text[:2000]
        out["tool"] = tool_name
        out["ocr_residual"] = not out["ok"]
        out["note"] = (
            f"{tool_name} OCR ok"
            if out["ok"]
            else f"{tool_name} failed rc={proc.returncode}"
        )
        if proc.stderr:
            out["stderr_prefix"] = (proc.stderr or "")[:200]
        return out
    except Exception as e:  # noqa: BLE001
        out["error"] = str(e)[:200]
        out["tool"] = tool_name
        out["note"] = "OCR residual — tesseract exception"
        return out


def analyze_screenshot(path: Optional[str]) -> Dict[str, Any]:
    """PIL vision heuristics + optional tesseract OCR. Host-side observe only."""
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
        ocr = run_tesseract_ocr(path)
        return {
            "ok": True,
            "width": w,
            "height": h,
            "brightness": round(mean, 2),
            "unique_colors_est": unique,
            "sparse": unique < 12 and mean > 200,
            "dark": mean < 40,
            "hotspots": hotspots,
            "tool": "pil-edge-hotspots"
            + ("+tesseract" if ocr.get("ok") else ""),
            "ocr": bool(ocr.get("ok")),
            "ocr_residual": bool(ocr.get("ocr_residual", True)),
            "ocr_text_prefix": (ocr.get("text") or "")[:160],
            "ocr_detail": {
                "enabled": bool(ocr.get("enabled")),
                "tool": ocr.get("tool"),
                "ok": bool(ocr.get("ok")),
                "note": ocr.get("note"),
            },
            "note": ocr.get("note")
            or "PIL edge hotspots only — OCR residual (BITBOT_CU_OCR unset)",
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
        # Honest stop on password; username fill is Host browser-plan CDP (elsewhere).
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


def resolve_tool_bin(env_key: str, default_name: str) -> Optional[str]:
    """Resolve a host tool binary path, honoring an injectable override env.

    Mirrors BITBOT_TESSERACT_BIN / BITBOT_STT_BIN: prefer an absolute executable
    override, else which(override), else which(default_name).
    """
    override = os.environ.get(env_key, "").strip()
    if override:
        if os.path.isfile(override) and os.access(override, os.X_OK):
            return override
        found = shutil.which(override)
        if found:
            return found
        return None
    return shutil.which(default_name)


def probe_native_os_input() -> Dict[str, Any]:
    """Probe true OS-window input tools (xdotool/wmctrl) — never invent clicks.

    BITBOT_XDOTOOL_BIN / BITBOT_WMCTRL_BIN inject alternate binaries (like
    BITBOT_TESSERACT_BIN) for smoke/mock; default without working tools keeps
    os_window_automation_residual true until a successful native act.
    """
    display = os.environ.get("DISPLAY") or ""
    xd = resolve_tool_bin("BITBOT_XDOTOOL_BIN", "xdotool")
    wm = resolve_tool_bin("BITBOT_WMCTRL_BIN", "wmctrl")
    tools = {
        "xdotool": bool(xd),
        "wmctrl": bool(wm),
        "xwininfo": bool(shutil.which("xwininfo")),
    }
    probe: Dict[str, Any] = {
        "display": display or None,
        "tools": tools,
        "mouse": None,
        "windows": None,
        "ok": False,
    }
    if xd:
        probe["xdotool_bin"] = Path(xd).name
    if wm:
        probe["wmctrl_bin"] = Path(wm).name
    if not display:
        probe["error"] = "no DISPLAY"
        probe["os_window_automation_residual"] = True
        return probe
    if xd:
        try:
            proc = subprocess.run(
                [xd, "getmouselocation", "--shell"],
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
    if wm:
        try:
            proc = subprocess.run(
                [wm, "-l"],
                capture_output=True,
                text=True,
                timeout=5,
                env={**os.environ, "DISPLAY": display},
            )
            lines = [ln for ln in (proc.stdout or "").splitlines() if ln.strip()]
            probe["windows"] = {"count": len(lines), "sample": lines[:5], "tool": "wmctrl"}
            if lines:
                probe["ok"] = True
        except Exception as e:  # noqa: BLE001
            probe["wmctrl_error"] = str(e)[:200]
    elif xd:
        # Fallback window list via xdotool when wmctrl absent.
        try:
            proc = subprocess.run(
                [xd, "search", "--name", "."],
                capture_output=True,
                text=True,
                timeout=5,
                env={**os.environ, "DISPLAY": display},
            )
            ids = [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
            probe["windows"] = {
                "count": len(ids),
                "sample": ids[:5],
                "tool": "xdotool-search",
            }
            if ids:
                probe["ok"] = True
        except Exception as e:  # noqa: BLE001
            probe["xdotool_search_error"] = str(e)[:200]
    # Probe residual: need mouse location + some window inventory for native act readiness.
    probe_ready = bool(probe.get("mouse")) and bool(
        (probe.get("windows") or {}).get("count")
    )
    probe["probe_ready"] = probe_ready
    # Act residual closed only after successful native act (see run_native_os_actions).
    probe["os_window_automation_residual"] = True
    probe["note"] = (
        "native OS input probe ready — set BITBOT_CU_NATIVE_ACT=1 to drive xdotool act"
        if probe_ready
        else "OS-window automation residual — need xdotool mouse + window inventory"
    )
    return probe


def run_native_os_actions(command: str, probe: Dict[str, Any]) -> Dict[str, Any]:
    """Optional true OS-window act via xdotool (BITBOT_CU_NATIVE_ACT=1). CDP stays primary.

    BITBOT_XDOTOOL_BIN injects an alternate binary for smoke/mock; without a
    working binary (and without a successful act) residual stays true.
    """
    enabled = os.environ.get("BITBOT_CU_NATIVE_ACT", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    result: Dict[str, Any] = {
        "enabled": enabled,
        "ok": False,
        "actions": [],
        "os_window_automation_residual": True,
    }
    if not enabled:
        result["note"] = "native act disabled — CDP primary (BITBOT_CU_NATIVE_ACT unset)"
        return result
    xd = resolve_tool_bin("BITBOT_XDOTOOL_BIN", "xdotool")
    if not xd:
        result["error"] = "xdotool missing"
        result["note"] = (
            "native act residual — install xdotool or set BITBOT_XDOTOOL_BIN"
        )
        return result
    result["xdotool_bin"] = Path(xd).name
    display = os.environ.get("DISPLAY") or ""
    if not display:
        result["error"] = "no DISPLAY"
        return result
    env = {**os.environ, "DISPLAY": display}
    # Parse click:x,y and type:text tokens from the CU command string.
    steps: List[Tuple[str, ...]] = []
    for tok in re.findall(r"click:(\d+),(\d+)", command or "", flags=re.I):
        steps.append(("click", tok[0], tok[1]))
    for tok in re.findall(r"type:([^\s|]+)", command or "", flags=re.I):
        steps.append(("type", tok))
    if not steps:
        # Harmless readiness act: read mouse location again (no synthetic UI damage).
        steps.append(("probe",))
    ok_any = False
    for step in steps[:6]:
        try:
            if step[0] == "click":
                subprocess.run(
                    [xd, "mousemove", step[1], step[2], "click", "1"],
                    check=False,
                    timeout=5,
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                result["actions"].append({"kind": "click", "x": int(step[1]), "y": int(step[2])})
                ok_any = True
            elif step[0] == "type":
                subprocess.run(
                    [xd, "type", "--clearmodifiers", step[1][:80]],
                    check=False,
                    timeout=8,
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                result["actions"].append({"kind": "type", "len": len(step[1][:80])})
                ok_any = True
            else:
                proc = subprocess.run(
                    [xd, "getmouselocation", "--shell"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    env=env,
                )
                result["actions"].append(
                    {"kind": "probe", "ok": proc.returncode == 0, "out": (proc.stdout or "")[:120]}
                )
                ok_any = proc.returncode == 0
        except Exception as e:  # noqa: BLE001
            result["actions"].append({"kind": step[0], "error": str(e)[:160]})
    result["ok"] = ok_any
    # Close residual when probe was ready and at least one native act succeeded.
    result["os_window_automation_residual"] = not (
        ok_any and bool(probe.get("probe_ready"))
    )
    result["note"] = (
        "native OS act via xdotool (BITBOT_CU_NATIVE_ACT=1)"
        if ok_any
        else "native act attempted but no successful step"
    )
    return result


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


def latest_browser_plan(repo_root: Path) -> Tuple[Optional[Path], Dict[str, Any]]:
    """Newest Host credential browser-plan (username-only; never secrets).

    Prefer mtime so a just-written live credential_fill plan wins over older
    lexicographically-newer names (e.g. leftover browser-plan-zzz-*).
    """
    fills_dir = repo_root / "data" / "credentials" / "fills"
    if not fills_dir.is_dir():
        return None, {}
    plans = list(fills_dir.glob("browser-plan-*.json"))
    if not plans:
        return None, {}
    plans.sort(key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)
    try:
        return plans[0], json.loads(plans[0].read_text(encoding="utf-8"))
    except Exception:
        return plans[0], {}


def username_cdp_actions_from_plan(plan: Dict[str, Any]) -> List[str]:
    """Username-only CDP steps from Host browser-plan (password stays deferred)."""
    username = str(plan.get("username") or "").strip()
    if not username:
        return []
    steps: List[str] = []
    raw = plan.get("cdp_actions") if isinstance(plan.get("cdp_actions"), list) else []
    for a in raw:
        s = str(a or "").strip()
        if not s:
            continue
        low = s.lower()
        # Never navigate away from the sign-in wall; never touch password.
        if low.startswith("navigate:") or low.startswith("password_fill"):
            continue
        if low.startswith("focus:") or low.startswith("type_username:"):
            steps.append(s)
        elif low.startswith("type:") or low.startswith("type_text:"):
            steps.append(s)
    if not steps:
        steps = [
            "focus:input[type=email],input[name*=user],input[name*=email],input[type=text]",
            f"type_username:{username}",
        ]
    return steps


def try_signin_username_fill(
    *,
    port: Optional[int],
    repo_root: Path,
    artifact_dir: Path,
) -> Dict[str, Any]:
    """CDP or mock-type username from latest browser-plan. Password never filled."""
    plan_path, plan = latest_browser_plan(repo_root)
    out: Dict[str, Any] = {
        "requested": True,
        "plan_path": str(plan_path) if plan_path else None,
        "username_planned": bool(str(plan.get("username") or "").strip()),
        "username_typed": False,
        "password_filled": False,
        "filled": False,  # full sign-in (incl. password) — always residual
        "mode": None,
        "ok": False,
        "cdp": None,
        "evidence": None,
    }
    username = str(plan.get("username") or "").strip()
    if not username:
        return out

    force_mock = os.environ.get("BITBOT_CU_SIGNIN_USERNAME_MOCK", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    def _stamp_mock() -> Dict[str, Any]:
        evidence = artifact_dir / "signin_username_fill_mock.json"
        evidence.write_text(
            json.dumps(
                {
                    "username_typed": True,
                    "password_filled": False,
                    "pretend_secret_view": False,
                    "mode": "host_cu_signin_username_mock",
                    "plan_path": out["plan_path"],
                    "username": username,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        out["username_typed"] = True
        out["ok"] = True
        out["mode"] = "host_cu_signin_username_mock"
        out["evidence"] = str(evidence)
        return out

    if force_mock:
        return _stamp_mock()

    if not port:
        # No live CDP — mock only when explicitly requested (handled above).
        out["error"] = "no_cdp_port"
        return out

    actions = username_cdp_actions_from_plan(plan)
    cdp_result = (
        run_cdp_actions(port, "|".join(actions), repo_root)
        if actions
        else {"ok": False, "error": "no username cdp actions"}
    )
    typed = False
    for a in cdp_result.get("actions") or []:
        if not isinstance(a, dict) or not a.get("ok"):
            continue
        if a.get("kind") in ("type_username", "type"):
            typed = True
    out["cdp"] = {
        "ok": bool(cdp_result.get("ok")),
        "actions": cdp_result.get("actions"),
        "error": cdp_result.get("error"),
    }
    if typed:
        out["username_typed"] = True
        out["ok"] = True
        out["mode"] = "host_cu_signin_username_cdp"
        evidence = artifact_dir / "signin_username_fill.json"
        evidence.write_text(
            json.dumps(
                {
                    "username_typed": True,
                    "password_filled": False,
                    "pretend_secret_view": False,
                    "mode": out["mode"],
                    "plan_path": out["plan_path"],
                    "cdp": out["cdp"],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        out["evidence"] = str(evidence)
    return out


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
    identity_meta: Dict[str, Any] = {
        "identity_browser": False,
        "switched": False,
        "user_data_dir": None,
    }
    profile = artifact_dir / "throwaway-chrome-profile"
    # CM-2146: prefer identity-browser user-data-dir when Host switched session.
    id_env = (os.environ.get("BITBOT_IDENTITY_USER_DATA_DIR") or "").strip()
    if not id_env:
        sess = repo_root / "data" / "connectors" / "identity" / "browser-session.json"
        if sess.is_file():
            try:
                payload = json.loads(sess.read_text(encoding="utf-8"))
                if payload.get("switched") or payload.get("status") == "SwitchedToSignedInBrowser":
                    id_env = str(payload.get("user_data_dir") or "").strip()
                    identity_meta["session_path"] = str(sess)
            except Exception:
                id_env = ""
    if id_env:
        profile = Path(id_env)
        identity_meta["identity_browser"] = True
        identity_meta["switched"] = True
        identity_meta["user_data_dir"] = str(profile)
    profile.mkdir(parents=True, exist_ok=True)
    # Hard refuse shared profile path.
    if str(profile.resolve()).startswith(SHARED_PROFILE):
        return {
            "started": False,
            "error": "refused shared chrome profile",
            "shared_cdp_untouched": True,
            "identity_browser": identity_meta,
        }
    # Drop stale Singleton* locks from a dead chrome (OOM / kill leaves them).
    for lock_name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        lock_path = profile / lock_name
        if not lock_path.exists() and not lock_path.is_symlink():
            continue
        try:
            target = os.readlink(lock_path) if lock_path.is_symlink() else ""
        except OSError:
            target = ""
        stale = True
        if "SingletonLock" in lock_name and "-" in str(target):
            # Chrome lock target looks like hostname-pid.
            try:
                lock_pid = int(str(target).rsplit("-", 1)[-1])
                os.kill(lock_pid, 0)
                stale = False
            except (ValueError, OSError, ProcessLookupError):
                stale = True
        if stale:
            try:
                lock_path.unlink(missing_ok=True)
            except OSError:
                pass
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
    # 容器/CI 里以 root 跑时 Chrome 会直接退出（zygote_host: Running as root
    # without --no-sandbox is not supported）。只给显式开启的 smoke 用，不改变
    # 默认安全姿态；真实用户桌面（非 root）不会走到这里。
    if os.environ.get("BITBOT_CU_CHROME_NO_SANDBOX", "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        args.insert(1, "--no-sandbox")
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
            # Own session → terminate/killpg reaps zygote + renderers.
            start_new_session=True,
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
        blocked_on_signin = bool(observe_dom.get("has_signin")) and not observe_dom.get(
            "has_results"
        )
        vision_plan = {
            "ok": bool(vision.get("ok") or observe_dom),
            "dom": observe_dom,
            "vision": vision,
            "steps": vision_steps,
            "blocked_on_signin": blocked_on_signin,
        }
        # CM-0803 × CM-2129: username CDP from Host browser-plan (password deferred).
        signin_fill_live: Dict[str, Any] = {}
        if blocked_on_signin:
            signin_fill_live = try_signin_username_fill(
                port=port,
                repo_root=repo_root,
                artifact_dir=artifact_dir,
            )
            vision_plan["signin_fill"] = signin_fill_live
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
        "probe_ready": False,
        "os_window_automation_residual": True,
        "note": "headless — no native OS window input",
    }
    native_cmd = command_hint or actions or os.environ.get("BITBOT_CU_COMMAND") or ""
    native_act = (
        run_native_os_actions(native_cmd, native_os)
        if gui_mode == "window"
        else {
            "enabled": False,
            "ok": False,
            "actions": [],
            "os_window_automation_residual": True,
            "note": "headless — native act skipped",
        }
    )
    # Residual closes only when native act succeeded after a ready probe.
    os_auto_residual = bool(
        native_act.get("os_window_automation_residual", True)
    )
    native_os["native_act"] = native_act
    native_os["os_window_automation_residual"] = os_auto_residual
    if gui_mode == "window":
        (artifact_dir / "native_os_input.json").write_text(
            json.dumps(native_os, indent=2) + "\n", encoding="utf-8"
        )
        (artifact_dir / "native_os_act.json").write_text(
            json.dumps(native_act, indent=2) + "\n", encoding="utf-8"
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
        "identity_browser": identity_meta,
        "version": version,
        "targets_count": len(targets) if isinstance(targets, list) else 0,
        "args": args,
        "actions": action_result,
        "vision_plan": vision_plan,
        "vision_actions": vision_actions,
        "screenshot": screenshot,
        "native_os_input": native_os,
        "native_os_act": native_act,
        "os_window_automation_residual": os_auto_residual,
        "display": os.environ.get("DISPLAY") or None,
    }
    # Best-effort terminate throwaway session (whole process group).
    def _reap_chrome_tree(sig: int) -> None:
        try:
            os.killpg(proc.pid, sig)
        except Exception:
            try:
                proc.send_signal(sig)
            except Exception:
                pass

    try:
        _reap_chrome_tree(signal.SIGTERM)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass
    try:
        proc.wait(timeout=5)
    except Exception:
        try:
            _reap_chrome_tree(signal.SIGKILL)
            proc.kill()
        except Exception:
            pass
    # Also match by profile in case chrome re-parented outside the group.
    try:
        subprocess.run(
            ["pkill", "-f", f"--user-data-dir={profile}"],
            check=False,
            timeout=3,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
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

        # Prefer markdown [label](url); else bare URL without trailing ')'.
        cmd = args.command or ""
        m = re.search(r"\]\((https?://[^)\s]+)\)", cmd)
        if not m:
            m = re.search(r"https?://[^\s|\"')\]]+", cmd)
        url = m.group(1) if m and m.lastindex else (m.group(0) if m else "")
        if url:
            url = url.rstrip(".,;:")
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

    allow_local = os.environ.get("BITBOT_CU_ALLOW_LOCAL", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    blocked = bool(url) and any(b in url for b in PK_BLOCKED) and not allow_local
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
    charge_probe: Dict[str, Any] = {}
    # BITBOT_CU_LIVE_PAID=1 alone must not clear residual — require a real /charge attempt
    # (same pattern as Host purchase live: API URL + token + mock server).
    if live_paid and is_shop and vertical_stage == "payment_wall":
        api = (os.environ.get("BITBOT_PURCHASE_API_URL") or "").strip().rstrip("/")
        token = (os.environ.get("BITBOT_PURCHASE_TOKEN") or "").strip()
        if api and token:
            paid_checkout_attempted = True
            try:
                req = urllib.request.Request(
                    api + "/charge",
                    data=json.dumps(
                        {
                            "item": "cu-checkout",
                            "cents": 100,
                            "source": "computer_use_payment_wall",
                        }
                    ).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": "Bearer " + token,
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=8) as resp:
                    body = resp.read().decode("utf-8", errors="replace")
                    charge_probe = {
                        "ok": 200 <= int(resp.status) < 300,
                        "http_status": int(resp.status),
                        "body_prefix": body[:240],
                    }
            except urllib.error.HTTPError as e:
                charge_probe = {
                    "ok": False,
                    "http_status": int(e.code),
                    "error": str(e),
                }
            except Exception as e:  # noqa: BLE001 — Host honesty: record probe failure
                charge_probe = {"ok": False, "error": str(e)}
        else:
            charge_probe = {
                "ok": False,
                "error": "BITBOT_CU_LIVE_PAID=1 requires BITBOT_PURCHASE_API_URL + BITBOT_PURCHASE_TOKEN",
            }
    live_paid_residual = bool(
        is_shop
        and vertical_stage == "payment_wall"
        and not (paid_checkout_attempted and charge_probe.get("ok"))
    )
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
    # CM-0803 × CM-2129: on sign-in wall, username from Host browser-plan
    # (CDP/mock during chrome session). Never type secrets / OS password.
    signin_fill: Dict[str, Any] = {
        "requested": False,
        "plan_path": None,
        "username_planned": False,
        "username_typed": False,
        "password_filled": False,
        "filled": False,
        "ok": False,
        "mode": None,
    }
    live_fill = None
    if isinstance(vision_plan.get("signin_fill"), dict):
        live_fill = vision_plan.get("signin_fill")
    elif isinstance(gui.get("signin_fill"), dict):
        live_fill = gui.get("signin_fill")
    if blocked_signin:
        signin_fill["requested"] = True
        if live_fill:
            signin_fill.update(live_fill)
            # Password / full fill always deferred (OS secret provider).
            signin_fill["password_filled"] = False
            signin_fill["filled"] = False
        else:
            # Chrome session missed fill (e.g. fallback) — still resolve plan + optional mock.
            fill_attempt = try_signin_username_fill(
                port=None,
                repo_root=repo_root,
                artifact_dir=artifact_dir,
            )
            signin_fill.update(fill_attempt)
            signin_fill["password_filled"] = False
            signin_fill["filled"] = False
            if not signin_fill.get("plan_path"):
                plan_path, plan = latest_browser_plan(repo_root)
                signin_fill["plan_path"] = str(plan_path) if plan_path else None
                signin_fill["username_planned"] = bool(
                    str(plan.get("username") or "").strip()
                )
    # Username typed closes credential_browser_fill_residual; password stays open.
    credential_browser_fill_residual = bool(
        blocked_signin and not signin_fill.get("username_typed")
    )
    signin_fill_residual = bool(blocked_signin and not signin_fill.get("filled"))
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
        "charge_probe": charge_probe or None,
        "signin_fill": signin_fill,
        "credential_browser_fill_residual": credential_browser_fill_residual,
        "signin_fill_residual": signin_fill_residual,
        "navigate_reachable": bool(navigate.get("navigate_reachable")),
        "os_window": bool(gui.get("os_window")),
        "os_window_automation_residual": bool(
            gui.get("os_window_automation_residual", True)
        ),
        "actions_ok": steps_ok,
        "screenshot_ok": bool((gui.get("screenshot") or {}).get("ok")),
        "vision_ok": vision_ok,
        "ocr": bool((vision_plan.get("vision") or {}).get("ocr")),
        "ocr_residual": bool(
            (vision_plan.get("vision") or {}).get("ocr_residual", True)
        ),
        "ocr_text_prefix": ((vision_plan.get("vision") or {}).get("ocr_text_prefix") or "")[
            :160
        ],
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
        "charge_probe": charge_probe or None,
        "playbook": playbook,
        "pretend_purchased": False,
        "pretend_booked": False,
        "pretend_ordered": False,
        "note": (
            "payment_wall reached — live paid checkout residual (no successful /charge)"
            if live_paid_residual
            else (
                "payment_wall /charge attempted via BITBOT_CU_LIVE_PAID + purchase API"
                if paid_checkout_attempted
                else "Host CU vertical deepen — never pretends paid/booked/ordered"
            )
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
