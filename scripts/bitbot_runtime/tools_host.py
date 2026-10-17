"""REAL Host tools: Shell, Read, Write, ListDir, WebFetch, optional Screenshot."""
from __future__ import annotations

import os
import re
import shlex
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

WORKSPACE = Path(os.environ.get("BITBOT_WORKSPACE", "/workspace")).resolve()
SANDBOX = Path(os.environ.get("BITBOT_SANDBOX", "/tmp/bitbot-sandbox")).resolve()
SHELL_TIMEOUT_S = float(os.environ.get("BITBOT_SHELL_TIMEOUT", "30"))
FETCH_TIMEOUT_S = float(os.environ.get("BITBOT_FETCH_TIMEOUT", "20"))
MAX_READ_BYTES = int(os.environ.get("BITBOT_MAX_READ_BYTES", str(512 * 1024)))
MAX_FETCH_BYTES = int(os.environ.get("BITBOT_MAX_FETCH_BYTES", str(256 * 1024)))

# Irreversible / destructive shell patterns — refuse without running.
_DANGEROUS_PATTERNS = [
    re.compile(r"\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?/\s*$", re.I),
    re.compile(r"\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+/\s*", re.I),
    re.compile(r"\brm\s+-rf\s+/\b", re.I),
    re.compile(r"\brm\s+-fr\s+/\b", re.I),
    re.compile(r"\bmkfs\b", re.I),
    re.compile(r"\bdd\s+.*\bof=/dev/", re.I),
    re.compile(r":\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:", re.I),  # fork bomb
    re.compile(r"\bchmod\s+-R\s+777\s+/\b", re.I),
    re.compile(r"\b(shutdown|reboot|poweroff|halt)\b", re.I),
    re.compile(r">\s*/dev/sd[a-z]", re.I),
    re.compile(r"\bcurl\b.*\|\s*(ba)?sh\b", re.I),
    re.compile(r"\bwget\b.*\|\s*(ba)?sh\b", re.I),
]


def _tool_result(
    tool: str,
    ok: bool,
    output: str,
    *,
    detail: str = "",
    args: dict | None = None,
    refused: bool = False,
) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "tool": tool,
        "ok": ok,
        "output": output,
        "detail": detail or ("ok" if ok else "error"),
        "args": args or {},
        "refused": refused,
        "ts": time.time(),
    }


def is_dangerous_shell(command: str) -> str | None:
    cmd = (command or "").strip()
    if not cmd:
        return "empty command"
    for pat in _DANGEROUS_PATTERNS:
        if pat.search(cmd):
            return f"irreversible gate: refused pattern {pat.pattern!r}"
    # Extra: rm -rf with path that is workspace root or system roots
    tokens = shlex.split(cmd, posix=True) if _can_shlex(cmd) else cmd.split()
    if tokens and tokens[0] == "rm":
        flags = {t for t in tokens[1:] if t.startswith("-")}
        paths = [t for t in tokens[1:] if not t.startswith("-")]
        recursive = any("r" in f.lower().lstrip("-") for f in flags)
        force = any("f" in f.lower().lstrip("-") for f in flags)
        if recursive and force:
            for p in paths:
                if p in ("/", "/*", "/workspace", str(WORKSPACE), str(WORKSPACE) + "/"):
                    return f"irreversible gate: refused rm -rf {p}"
    return None


def _can_shlex(cmd: str) -> bool:
    try:
        shlex.split(cmd, posix=True)
        return True
    except ValueError:
        return False


def _allowed_roots() -> list[Path]:
    SANDBOX.mkdir(parents=True, exist_ok=True)
    return [WORKSPACE, SANDBOX]


def resolve_sandbox_path(raw: str, *, for_write: bool = False) -> Path:
    """Resolve path; must stay under /workspace or /tmp/bitbot-sandbox."""
    if not raw or not str(raw).strip():
        raise ValueError("path required")
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = (WORKSPACE / p).resolve()
    else:
        p = p.resolve()
    allowed = False
    for root in _allowed_roots():
        try:
            p.relative_to(root)
            allowed = True
            break
        except ValueError:
            continue
    if not allowed:
        raise PermissionError(
            f"path outside sandbox: {p} (allowed: {WORKSPACE}, {SANDBOX})"
        )
    return p


def shell(command: str, cwd: str | None = None) -> dict[str, Any]:
    reason = is_dangerous_shell(command)
    if reason:
        return _tool_result(
            "Shell",
            False,
            reason,
            detail=reason,
            args={"command": command, "cwd": cwd},
            refused=True,
        )
    work = WORKSPACE
    if cwd:
        try:
            work = resolve_sandbox_path(cwd)
        except (ValueError, PermissionError) as e:
            return _tool_result(
                "Shell",
                False,
                str(e),
                detail=str(e),
                args={"command": command, "cwd": cwd},
            )
    if not work.is_dir():
        return _tool_result(
            "Shell",
            False,
            f"cwd not a directory: {work}",
            args={"command": command, "cwd": str(work)},
        )
    try:
        proc = subprocess.run(
            command,
            shell=True,
            cwd=str(work),
            capture_output=True,
            text=True,
            timeout=SHELL_TIMEOUT_S,
            env={**os.environ, "PWD": str(work)},
        )
        out = (proc.stdout or "") + (
            ("\n" + proc.stderr) if proc.stderr else ""
        )
        out = out.strip("\n")
        ok = proc.returncode == 0
        return _tool_result(
            "Shell",
            ok,
            out if out else f"(exit {proc.returncode})",
            detail=f"exit={proc.returncode}",
            args={"command": command, "cwd": str(work)},
        )
    except subprocess.TimeoutExpired:
        return _tool_result(
            "Shell",
            False,
            f"timeout after {SHELL_TIMEOUT_S}s",
            args={"command": command, "cwd": str(work)},
        )
    except OSError as e:
        return _tool_result(
            "Shell",
            False,
            str(e),
            args={"command": command, "cwd": str(work)},
        )


def read_file(path: str, offset: int = 1, limit: int | None = None) -> dict[str, Any]:
    try:
        p = resolve_sandbox_path(path)
    except (ValueError, PermissionError) as e:
        return _tool_result("Read", False, str(e), args={"path": path})
    if not p.is_file():
        return _tool_result("Read", False, f"not a file: {p}", args={"path": str(p)})
    try:
        raw = p.read_bytes()
        if len(raw) > MAX_READ_BYTES:
            raw = raw[:MAX_READ_BYTES]
        text = raw.decode("utf-8", errors="replace")
        lines = text.splitlines()
        start = max(1, int(offset or 1))
        end = len(lines) + 1 if limit is None else start + max(0, int(limit))
        numbered = []
        for i, line in enumerate(lines, start=1):
            if i < start:
                continue
            if i >= end:
                break
            numbered.append(f"{i:>6}|{line}")
        body = "\n".join(numbered) if numbered else "(empty)"
        return _tool_result(
            "Read",
            True,
            body,
            detail=f"lines {start}-{min(end - 1, len(lines))} of {len(lines)}",
            args={"path": str(p), "offset": start, "limit": limit},
        )
    except OSError as e:
        return _tool_result("Read", False, str(e), args={"path": str(p)})


def write_file(path: str, content: str) -> dict[str, Any]:
    try:
        p = resolve_sandbox_path(path, for_write=True)
    except (ValueError, PermissionError) as e:
        return _tool_result("Write", False, str(e), args={"path": path})
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        data = content if isinstance(content, str) else str(content)
        p.write_text(data, encoding="utf-8")
        return _tool_result(
            "Write",
            True,
            f"wrote {len(data.encode('utf-8'))} bytes to {p}",
            args={"path": str(p), "bytes": len(data.encode("utf-8"))},
        )
    except OSError as e:
        return _tool_result("Write", False, str(e), args={"path": str(p)})


def list_dir(path: str = ".") -> dict[str, Any]:
    try:
        p = resolve_sandbox_path(path)
    except (ValueError, PermissionError) as e:
        return _tool_result("ListDir", False, str(e), args={"path": path})
    if not p.is_dir():
        return _tool_result("ListDir", False, f"not a directory: {p}", args={"path": str(p)})
    try:
        entries = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
        lines = []
        for e in entries[:500]:
            kind = "dir" if e.is_dir() else "file"
            lines.append(f"{kind}\t{e.name}")
        body = "\n".join(lines) if lines else "(empty directory)"
        return _tool_result(
            "ListDir",
            True,
            body,
            detail=f"{len(entries)} entries",
            args={"path": str(p)},
        )
    except OSError as e:
        return _tool_result("ListDir", False, str(e), args={"path": str(p)})


def web_fetch(url: str) -> dict[str, Any]:
    u = (url or "").strip()
    if not u:
        return _tool_result("WebFetch", False, "url required", args={"url": url})
    if not (u.startswith("http://") or u.startswith("https://")):
        return _tool_result(
            "WebFetch",
            False,
            "only http/https URLs allowed",
            args={"url": u},
        )
    # No credential bypass: do not attach Authorization from env.
    headers = {"User-Agent": "BitBotHost/1.0", "Accept": "*/*"}
    try:
        req = Request(u, headers=headers, method="GET")
        with urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
            status = getattr(resp, "status", 200)
            raw = resp.read(MAX_FETCH_BYTES + 1)
            truncated = len(raw) > MAX_FETCH_BYTES
            raw = raw[:MAX_FETCH_BYTES]
            text = raw.decode("utf-8", errors="replace")
            note = f"HTTP {status}" + (" (truncated)" if truncated else "")
            return _tool_result(
                "WebFetch",
                200 <= int(status) < 400,
                text,
                detail=note,
                args={"url": u, "status": status, "truncated": truncated},
            )
    except HTTPError as e:
        body = ""
        try:
            body = e.read(4096).decode("utf-8", errors="replace")
        except Exception:
            pass
        return _tool_result(
            "WebFetch",
            False,
            body or str(e),
            detail=f"HTTP {e.code}",
            args={"url": u, "status": e.code},
        )
    except (URLError, TimeoutError, OSError) as e:
        return _tool_result(
            "WebFetch",
            False,
            str(e),
            args={"url": u},
        )


def screenshot(path: str | None = None) -> dict[str, Any]:
    display = os.environ.get("DISPLAY")
    if not display:
        return _tool_result(
            "Screenshot",
            False,
            "DISPLAY not set; screenshot skipped",
            args={"display": None},
        )
    out = path or str(SANDBOX / f"shot-{int(time.time())}.png")
    try:
        p = resolve_sandbox_path(out, for_write=True)
    except (ValueError, PermissionError) as e:
        return _tool_result("Screenshot", False, str(e), args={"path": out})
    # Prefer importable or PATH tools; never fail the host if missing.
    for cmd in (
        ["import", "-window", "root", str(p)],
        ["scrot", str(p)],
        ["gnome-screenshot", "-f", str(p)],
    ):
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=15
            )
            if proc.returncode == 0 and p.is_file():
                return _tool_result(
                    "Screenshot",
                    True,
                    f"saved {p}",
                    args={"path": str(p), "display": display, "cmd": cmd[0]},
                )
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue
    return _tool_result(
        "Screenshot",
        False,
        "no screenshot tool available (import/scrot/gnome-screenshot)",
        args={"display": display, "path": str(p)},
    )


def dispatch(tool: str, args: dict | None = None) -> dict[str, Any]:
    args = args or {}
    name = (tool or "").strip()
    if name == "Shell":
        return shell(args.get("command") or args.get("cmd") or "", args.get("cwd"))
    if name == "Read":
        return read_file(
            args.get("path") or "",
            int(args.get("offset") or 1),
            args.get("limit"),
        )
    if name == "Write":
        return write_file(args.get("path") or "", args.get("content") or "")
    if name == "ListDir":
        return list_dir(args.get("path") or ".")
    if name == "WebFetch":
        return web_fetch(args.get("url") or "")
    if name == "Screenshot":
        return screenshot(args.get("path"))
    return _tool_result(name or "Unknown", False, f"unknown tool: {name}", args=args)
