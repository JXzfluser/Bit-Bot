"""LLM provider chain: OpenAI-compatible API → Ollama → LocalBrain heuristic."""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any, Callable

from . import tools_host

ToolRunner = Callable[[str, dict], dict]


def detect_llm_mode() -> str:
    """Return api | ollama | localbrain based on env + reachability."""
    if _api_configured():
        return "api"
    if _ollama_available():
        return "ollama"
    return "localbrain"


def _api_configured() -> bool:
    base = (os.environ.get("BITBOT_LLM_BASE_URL") or "").strip()
    key = (os.environ.get("BITBOT_LLM_API_KEY") or "").strip()
    return bool(base and key)


def _ollama_url() -> str:
    return (os.environ.get("BITBOT_OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")


def _ollama_model() -> str:
    return os.environ.get("BITBOT_OLLAMA_MODEL") or "llama3.2:1b"


def _ollama_available() -> bool:
    url = _ollama_url() + "/api/tags"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            if getattr(resp, "status", 200) >= 400:
                return False
            body = resp.read(65536)
            data = json.loads(body.decode("utf-8", errors="replace") or "{}")
            models = data.get("models") or []
            want = _ollama_model()
            if not models:
                return False
            names = [m.get("name") or m.get("model") or "" for m in models]
            # Accept exact or tag-prefix match; if env model missing, still ok if any model.
            if any(n == want or n.startswith(want.split(":")[0]) for n in names):
                return True
            return True
    except Exception:
        return False


def chat_completion(
    messages: list[dict],
    *,
    tools_hint: str | None = None,
) -> dict[str, Any]:
    """High-level completion. Returns {mode, text, raw?}."""
    mode = detect_llm_mode()
    if mode == "api":
        text = _openai_compatible_chat(messages)
        return {"mode": "api", "text": text}
    if mode == "ollama":
        text = _ollama_chat(messages)
        return {"mode": "ollama", "text": text}
    # LocalBrain handled by turn_engine via localbrain_turn
    return {"mode": "localbrain", "text": ""}


def _openai_compatible_chat(messages: list[dict]) -> str:
    base = os.environ["BITBOT_LLM_BASE_URL"].rstrip("/")
    key = os.environ["BITBOT_LLM_API_KEY"]
    model = os.environ.get("BITBOT_LLM_MODEL") or "gpt-4o-mini"
    url = base + "/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    choices = body.get("choices") or []
    if not choices:
        return "(empty completion)"
    msg = choices[0].get("message") or {}
    return (msg.get("content") or "").strip() or "(empty completion)"


def _ollama_chat(messages: list[dict]) -> str:
    url = _ollama_url() + "/api/chat"
    payload = {
        "model": _ollama_model(),
        "messages": messages,
        "stream": False,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    msg = body.get("message") or {}
    return (msg.get("content") or "").strip() or "(empty ollama reply)"


# --- LocalBrain: intent parse → real tools → natural language ---

_SHELL_ECHO_RE = re.compile(
    r"(?:用\s*)?Shell\s*(?:执行|跑|运行)?\s*(.+?)(?:\s*并告诉我结果)?\s*$",
    re.I | re.S,
)
_ECHO_RE = re.compile(r"\becho\b\s+(.+)", re.I)
_LIST_RE = re.compile(
    r"(list\s+(files?|dir|directory)|列出|有哪些文件|ls\b|listdir)",
    re.I,
)
_READ_RE = re.compile(
    r"(?:read|读取|打开|查看)\s+(?:file\s+)?([^\s]+)",
    re.I,
)
_FETCH_RE = re.compile(
    r"(?:fetch|抓取|访问|打开网址|web\s*fetch)\s+(https?://\S+)",
    re.I,
)
_URL_RE = re.compile(r"(https?://[^\s]+)", re.I)
_WRITE_RE = re.compile(
    r"(?:write|写入|写到)\s+(?:file\s+)?([^\s]+)\s+(?:with|内容|content)?\s*(.*)",
    re.I | re.S,
)


def parse_localbrain_intents(user_text: str) -> list[dict]:
    """Return ordered tool call specs from user text. Never invent success."""
    text = (user_text or "").strip()
    calls: list[dict] = []
    if not text:
        return calls

    # Explicit Shell ... patterns (incl. Chinese product smoke)
    m = _SHELL_ECHO_RE.search(text)
    if m:
        cmd = m.group(1).strip().strip("`\"'")
        # Strip trailing Chinese clause if captured
        cmd = re.sub(r"\s*并告诉我结果\s*$", "", cmd).strip()
        if cmd:
            calls.append({"tool": "Shell", "args": {"command": cmd}})
            return calls

    if re.search(r"(执行|运行|run)\s+`?echo\b", text, re.I) or (
        "echo" in text.lower() and re.search(r"(shell|执行|运行)", text, re.I)
    ):
        em = _ECHO_RE.search(text)
        if em:
            calls.append({"tool": "Shell", "args": {"command": "echo " + em.group(1).strip()}})
            return calls
        # Extract quoted echo payload
        qm = re.search(r"echo\s+([^\n]+)", text, re.I)
        if qm:
            calls.append({"tool": "Shell", "args": {"command": "echo " + qm.group(1).strip()}})
            return calls

    if re.search(r"\b(shell|bash|命令)\b", text, re.I) and re.search(
        r"(执行|运行|run|exec)", text, re.I
    ):
        # Generic: take after 执行/运行
        gm = re.search(r"(?:执行|运行|run|exec)\s+(.+)", text, re.I)
        if gm:
            cmd = gm.group(1).strip().strip("`\"'")
            cmd = re.sub(r"\s*并告诉我结果\s*$", "", cmd).strip()
            if cmd:
                calls.append({"tool": "Shell", "args": {"command": cmd}})
                return calls

    fm = _FETCH_RE.search(text)
    if fm:
        calls.append({"tool": "WebFetch", "args": {"url": fm.group(1)}})
        return calls
    if re.search(r"(fetch|抓取|访问网址)", text, re.I):
        um = _URL_RE.search(text)
        if um:
            calls.append({"tool": "WebFetch", "args": {"url": um.group(1)}})
            return calls

    if _LIST_RE.search(text):
        path = "."
        pm = re.search(r"(?:in|under|目录|路径)\s+([^\s]+)", text, re.I)
        if pm:
            path = pm.group(1).strip()
        elif re.search(r"/workspace|/tmp/bitbot-sandbox", text):
            um = re.search(r"(/workspace\S*|/tmp/bitbot-sandbox\S*)", text)
            if um:
                path = um.group(1)
        calls.append({"tool": "ListDir", "args": {"path": path}})
        return calls

    rm = _READ_RE.search(text)
    if rm and ("/" in rm.group(1) or rm.group(1).endswith((".md", ".py", ".txt", ".json"))):
        calls.append({"tool": "Read", "args": {"path": rm.group(1)}})
        return calls

    wm = _WRITE_RE.search(text)
    if wm:
        calls.append(
            {
                "tool": "Write",
                "args": {"path": wm.group(1), "content": (wm.group(2) or "").strip()},
            }
        )
        return calls

    if re.search(r"screenshot|截图", text, re.I):
        calls.append({"tool": "Screenshot", "args": {}})
        return calls

    return calls


def localbrain_turn(
    user_text: str,
    *,
    run_tool: ToolRunner | None = None,
) -> dict[str, Any]:
    """Heuristic agent: parse intent, run REAL tools, compose reply."""
    runner = run_tool or tools_host.dispatch
    intents = parse_localbrain_intents(user_text)
    tool_results: list[dict] = []
    for spec in intents:
        result = runner(spec["tool"], spec.get("args") or {})
        tool_results.append(result)

    if tool_results:
        parts = []
        for tr in tool_results:
            tool = tr.get("tool")
            if tr.get("refused"):
                parts.append(
                    f"Refused {tool}: {tr.get('output') or tr.get('detail')}"
                )
                continue
            if not tr.get("ok"):
                parts.append(
                    f"{tool} failed: {tr.get('output') or tr.get('detail')}"
                )
                continue
            out = tr.get("output") or ""
            # Keep tool evidence visible for product smokes
            if tool == "Shell":
                cmd = (tr.get("args") or {}).get("command", "")
                parts.append(
                    f"Shell ran `{cmd}`.\nResult:\n```\n{out}\n```"
                )
            elif tool == "ListDir":
                parts.append(f"ListDir `{ (tr.get('args') or {}).get('path') }`:\n{out}")
            elif tool == "WebFetch":
                snippet = out[:800] + ("…" if len(out) > 800 else "")
                parts.append(
                    f"Fetched {(tr.get('args') or {}).get('url')}"
                    f" ({tr.get('detail')}):\n{snippet}"
                )
            elif tool == "Read":
                parts.append(f"Read {(tr.get('args') or {}).get('path')}:\n{out[:2000]}")
            elif tool == "Write":
                parts.append(out)
            else:
                parts.append(f"{tool}: {out}")
        text = "\n\n".join(parts)
        return {
            "mode": "localbrain",
            "text": text,
            "tool_results": tool_results,
            "intents": intents,
        }

    # No tool intent — honest LocalBrain reply (no fake tool runs)
    reply = (
        "LocalBrain online (no API/Ollama key). "
        "I can run real Host tools when you ask: Shell, Read, Write, ListDir, WebFetch. "
        f"You said: {user_text[:400]}"
    )
    return {
        "mode": "localbrain",
        "text": reply,
        "tool_results": [],
        "intents": [],
    }


def extract_tool_calls_from_llm_text(text: str) -> list[dict]:
    """Optional JSON tool-call blocks from API/Ollama replies."""
    calls: list[dict] = []
    if not text:
        return calls
    for m in re.finditer(
        r"```json\s*(\{.*?\})\s*```", text, re.S | re.I
    ):
        try:
            obj = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if obj.get("tool") and isinstance(obj.get("args"), dict):
            calls.append({"tool": obj["tool"], "args": obj["args"]})
    # Also support {"tool_calls":[...]}
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and isinstance(obj.get("tool_calls"), list):
            for c in obj["tool_calls"]:
                if c.get("tool"):
                    calls.append({"tool": c["tool"], "args": c.get("args") or {}})
    except json.JSONDecodeError:
        pass
    return calls
