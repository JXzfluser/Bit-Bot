"""LLM provider chain: OpenAI-compatible API → Ollama → LocalBrain heuristic."""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from typing import Any, Callable

from . import persist, tools_host

ToolRunner = Callable[[str, dict], dict]

# Intent kind: tool | memory | routine | summarize
# Encoded as ordered specs so multi-step turns (fetch→summarize) stay linear.


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


# --- LocalBrain intent patterns (ZH + EN) ---

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
_URL_RE = re.compile(r"(https?://[^\s<>\"']+)", re.I)
_WRITE_RE = re.compile(
    r"(?:write|写入|写到|write\s+to)\s+(?:file\s+)?([^\s]+)\s+"
    r"(?:with|内容|content|说|为|:)?\s*(.*)",
    re.I | re.S,
)
_MEMORY_SET_RE = re.compile(
    r"(?:记住|remember(?:\s+that)?|save(?:\s+my)?(?:\s+name)?|"
    r"my\s+name\s+is|i\s+am\s+called)\s*(?:我叫|我是|that\s+)?(.+)",
    re.I,
)
_MEMORY_SET_NAME_RE = re.compile(
    r"(?:记住我叫|记住我是|我叫(?!什么)|我的名字是|"
    r"remember\s+(?:my\s+name\s+is|that\s+i(?:'m|\s+am)\s+)|"
    r"my\s+name\s+is)\s*[：:]?\s*(.+)",
    re.I,
)
_MEMORY_GET_RE = re.compile(
    r"(我叫什么|我的名字|what(?:'s|\s+is)\s+my\s+name|who\s+am\s+i|"
    r"recall\s+(?:my\s+)?(?:name|memory)|记住了我什么|memory\s+recall)",
    re.I,
)
_ROUTINE_LIST_RE = re.compile(
    r"(list\s+routines?|routines?\s+list|列出(?:例程|routines?)|有哪些例程|查看例程)",
    re.I,
)
_ROUTINE_CREATE_RE = re.compile(
    r"(?:create|add|新建|创建|添加)\s*(?:a\s+)?(?:routine|例程)\s*[：:]?\s*(.+)",
    re.I,
)
_SUMMARIZE_RE = re.compile(
    r"(summarize|summary|总结|摘要|概括)",
    re.I,
)
_WRITE_SAFE_ROOTS = ("/workspace/data", "/workspace/agent-tools", "data/", "agent-tools/")


def parse_localbrain_intents(user_text: str) -> list[dict]:
    """Return ordered intent specs. Never invent success.

    Spec shapes:
      {"kind":"tool","tool":"Shell","args":{...}}
      {"kind":"memory","op":"update"|"recall","patch":{...}}
      {"kind":"routine","op":"list"|"create","name":...,"body":...}
      {"kind":"summarize","from":"fetch"}  # after a WebFetch in the same turn
    """
    text = (user_text or "").strip()
    calls: list[dict] = []
    if not text:
        return calls

    # Memory update (before bare "我叫" recall confusion)
    if _MEMORY_GET_RE.search(text) and not _MEMORY_SET_NAME_RE.search(text):
        # Pure recall unless also setting
        if not re.search(r"(记住|remember|my\s+name\s+is)", text, re.I):
            calls.append({"kind": "memory", "op": "recall", "patch": {}})
            return calls

    nm = _MEMORY_SET_NAME_RE.search(text)
    if nm or (
        re.search(r"(记住|remember)", text, re.I)
        and re.search(r"(叫|名字|name)", text, re.I)
    ):
        name = ""
        if nm:
            name = nm.group(1).strip().strip("。.!！\"'「」")
        else:
            m2 = _MEMORY_SET_RE.search(text)
            if m2:
                name = m2.group(1).strip().strip("。.!！\"'「」")
        # Strip trailing clauses like "并告诉我"
        name = re.split(r"[，,。]|并|然后|and\s+tell", name, maxsplit=1)[0].strip()
        if name:
            # Drop leading "我叫" leftovers
            name = re.sub(r"^(?:我叫|我是|that\s+)?", "", name, flags=re.I).strip()
            calls.append(
                {
                    "kind": "memory",
                    "op": "update",
                    "patch": {"name": name},
                }
            )
            if _MEMORY_GET_RE.search(text):
                calls.append({"kind": "memory", "op": "recall", "patch": {}})
            return calls

    if _MEMORY_GET_RE.search(text):
        calls.append({"kind": "memory", "op": "recall", "patch": {}})
        return calls

    # Generic profile key set: 记住 key=value / remember foo=bar
    km = re.search(
        r"(?:记住|remember|save)\s+([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*)\s*[=：:]\s*(.+)",
        text,
        re.I,
    )
    if km:
        key = km.group(1).strip()
        val = km.group(2).strip().strip("。.!！")
        if key.lower() not in ("my", "that", "me"):
            calls.append({"kind": "memory", "op": "update", "patch": {key: val}})
            return calls

    # Routines
    if _ROUTINE_LIST_RE.search(text):
        calls.append({"kind": "routine", "op": "list"})
        return calls
    rm = _ROUTINE_CREATE_RE.search(text)
    if rm:
        raw = rm.group(1).strip().strip("。.!！\"'")
        name, _, body = raw.partition(":")
        if not body:
            name, _, body = raw.partition("：")
        if not body:
            name, body = raw, ""
        calls.append(
            {
                "kind": "routine",
                "op": "create",
                "name": name.strip() or f"routine-{int(time.time())}",
                "body": body.strip(),
            }
        )
        return calls

    # Multi-step: fetch URL then summarize
    want_summary = bool(_SUMMARIZE_RE.search(text))
    url = None
    fm = _FETCH_RE.search(text)
    if fm:
        url = fm.group(1).rstrip(".,;)]}>\"'")
    elif re.search(r"(fetch|抓取|访问网址|打开|visit|get)", text, re.I) or want_summary:
        um = _URL_RE.search(text)
        if um:
            url = um.group(1).rstrip(".,;)]}>\"'")
    if url and (want_summary or re.search(r"(fetch|抓取|web\s*fetch|访问)", text, re.I)):
        calls.append({"kind": "tool", "tool": "WebFetch", "args": {"url": url}})
        if want_summary:
            calls.append({"kind": "summarize", "from": "fetch"})
        return calls
    if url and re.search(r"https?://", text, re.I) and want_summary:
        calls.append({"kind": "tool", "tool": "WebFetch", "args": {"url": url}})
        calls.append({"kind": "summarize", "from": "fetch"})
        return calls

    # Explicit Shell patterns (incl. Chinese product smoke)
    m = _SHELL_ECHO_RE.search(text)
    if m:
        cmd = m.group(1).strip().strip("`\"'")
        cmd = re.sub(r"\s*并告诉我结果\s*$", "", cmd).strip()
        if cmd:
            calls.append({"kind": "tool", "tool": "Shell", "args": {"command": cmd}})
            return calls

    if re.search(r"(执行|运行|run)\s+`?echo\b", text, re.I) or (
        "echo" in text.lower() and re.search(r"(shell|执行|运行)", text, re.I)
    ):
        em = _ECHO_RE.search(text)
        if em:
            calls.append(
                {
                    "kind": "tool",
                    "tool": "Shell",
                    "args": {"command": "echo " + em.group(1).strip()},
                }
            )
            return calls
        qm = re.search(r"echo\s+([^\n]+)", text, re.I)
        if qm:
            calls.append(
                {
                    "kind": "tool",
                    "tool": "Shell",
                    "args": {"command": "echo " + qm.group(1).strip()},
                }
            )
            return calls

    if re.search(r"\b(shell|bash|命令)\b", text, re.I) and re.search(
        r"(执行|运行|run|exec)", text, re.I
    ):
        gm = re.search(r"(?:执行|运行|run|exec)\s+(.+)", text, re.I)
        if gm:
            cmd = gm.group(1).strip().strip("`\"'")
            cmd = re.sub(r"\s*并告诉我结果\s*$", "", cmd).strip()
            if cmd:
                calls.append({"kind": "tool", "tool": "Shell", "args": {"command": cmd}})
                return calls

    fm = _FETCH_RE.search(text)
    if fm:
        calls.append(
            {
                "kind": "tool",
                "tool": "WebFetch",
                "args": {"url": fm.group(1).rstrip(".,;)]}>\"'")},
            }
        )
        return calls
    if re.search(r"(fetch|抓取|访问网址)", text, re.I):
        um = _URL_RE.search(text)
        if um:
            calls.append(
                {
                    "kind": "tool",
                    "tool": "WebFetch",
                    "args": {"url": um.group(1).rstrip(".,;)]}>\"'")},
                }
            )
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
        calls.append({"kind": "tool", "tool": "ListDir", "args": {"path": path}})
        return calls

    rm = _READ_RE.search(text)
    if rm and ("/" in rm.group(1) or rm.group(1).endswith((".md", ".py", ".txt", ".json"))):
        calls.append({"kind": "tool", "tool": "Read", "args": {"path": rm.group(1)}})
        return calls

    wm = _WRITE_RE.search(text)
    if wm:
        path = wm.group(1).strip().strip("'\"")
        content = (wm.group(2) or "").strip()
        # Prefer safe roots; rewrite bare names into /workspace/data/
        if not any(path.startswith(r) or path.startswith("./" + r) for r in _WRITE_SAFE_ROOTS):
            if "/" not in path or path.startswith("tmp/"):
                path = f"/workspace/data/{path.lstrip('./')}"
        calls.append(
            {
                "kind": "tool",
                "tool": "Write",
                "args": {"path": path, "content": content},
            }
        )
        return calls

    if re.search(r"screenshot|截图", text, re.I):
        calls.append({"kind": "tool", "tool": "Screenshot", "args": {}})
        return calls

    return calls


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._skip:
            return
        t = data.strip()
        if t:
            self._chunks.append(t)

    def text(self) -> str:
        return " ".join(self._chunks)


def extractive_summary(html_or_text: str, *, max_sentences: int = 4, max_chars: int = 900) -> str:
    """LocalBrain extractive summary: strip tags, take lead sentences by length/position."""
    raw = html_or_text or ""
    if "<" in raw and ">" in raw:
        parser = _TextExtractor()
        try:
            parser.feed(raw)
            text = parser.text()
        except Exception:
            text = re.sub(r"<[^>]+>", " ", raw)
    else:
        text = raw
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return "(empty page)"
    # Sentence split (EN + CN)
    parts = re.split(r"(?<=[。.!?？])\s+|\n+", text)
    parts = [p.strip() for p in parts if p and len(p.strip()) > 20]
    if not parts:
        return text[:max_chars] + ("…" if len(text) > max_chars else "")
    # Prefer earlier + denser sentences
    scored = []
    for i, p in enumerate(parts[:40]):
        score = (40 - i) + min(len(p), 200) / 50.0
        scored.append((score, p))
    scored.sort(key=lambda x: -x[0])
    chosen = [p for _, p in scored[:max_sentences]]
    # Restore document order
    ordered = [p for p in parts if p in chosen][:max_sentences]
    out = " ".join(ordered)
    if len(out) > max_chars:
        out = out[: max_chars - 1] + "…"
    return out


def _run_memory_op(agent_id: str, spec: dict) -> dict[str, Any]:
    op = spec.get("op") or "recall"
    if op == "update":
        patch = spec.get("patch") or {}
        mem = persist.update_memory(agent_id, patch)
        persist.append_journal_entry(
            agent_id,
            {
                "kind": "memory_update",
                "patch": patch,
                "ts": time.time(),
            },
        )
        profile = mem.get("profile") or {}
        return {
            "id": f"mem-{int(time.time() * 1000)}",
            "tool": "MemoryUpdate",
            "ok": True,
            "output": f"Remembered: {json.dumps(profile, ensure_ascii=False)}",
            "detail": "memory updated",
            "args": {"patch": patch, "profile": profile},
            "refused": False,
            "ts": time.time(),
        }
    mem = persist.load_memory(agent_id)
    profile = mem.get("profile") or {}
    journal = persist.load_journal(agent_id)
    name = profile.get("name")
    if name:
        out = f"你叫 {name} / Your name is {name}."
    elif profile:
        out = "Memory profile: " + json.dumps(profile, ensure_ascii=False)
    else:
        out = "还没有记住你的名字 / No name stored yet."
    if journal:
        last = journal[-3:]
        out += "\nRecent journal: " + json.dumps(last, ensure_ascii=False)
    return {
        "id": f"mem-{int(time.time() * 1000)}",
        "tool": "MemoryRecall",
        "ok": True,
        "output": out,
        "detail": "memory recalled",
        "args": {"profile": profile, "journal_len": len(journal)},
        "refused": False,
        "ts": time.time(),
    }


def _run_routine_op(agent_id: str, spec: dict) -> dict[str, Any]:
    op = spec.get("op") or "list"
    if op == "create":
        routines = persist.load_routines(agent_id)
        item = {
            "id": f"rtn-{int(time.time())}",
            "name": spec.get("name") or "untitled",
            "body": spec.get("body") or "",
            "created_at": time.time(),
        }
        routines.append(item)
        persist.save_routines(agent_id, routines)
        return {
            "id": item["id"],
            "tool": "RoutineCreate",
            "ok": True,
            "output": f"Created routine `{item['name']}` (id={item['id']})",
            "detail": "routine created",
            "args": item,
            "refused": False,
            "ts": time.time(),
        }
    routines = persist.load_routines(agent_id)
    if not routines:
        body = "(no routines yet)"
    else:
        lines = [
            f"- {r.get('name')}: {(r.get('body') or '')[:120]}" for r in routines
        ]
        body = "\n".join(lines)
    return {
        "id": f"rtn-list-{int(time.time())}",
        "tool": "RoutineList",
        "ok": True,
        "output": body,
        "detail": f"{len(routines)} routines",
        "args": {"count": len(routines)},
        "refused": False,
        "ts": time.time(),
    }


def localbrain_turn(
    user_text: str,
    *,
    run_tool: ToolRunner | None = None,
    agent_id: str = "demo-agent",
) -> dict[str, Any]:
    """Heuristic agent: parse intent, run REAL tools / disk persist, compose reply."""
    runner = run_tool or tools_host.dispatch
    aid = (agent_id or "demo-agent").strip() or "demo-agent"
    intents = parse_localbrain_intents(user_text)
    tool_results: list[dict] = []
    last_fetch_text = ""

    for spec in intents:
        kind = spec.get("kind") or "tool"
        if kind == "memory":
            result = _run_memory_op(aid, spec)
            tool_results.append(result)
            continue
        if kind == "routine":
            result = _run_routine_op(aid, spec)
            tool_results.append(result)
            continue
        if kind == "summarize":
            summary = extractive_summary(last_fetch_text)
            result = {
                "id": f"sum-{int(time.time() * 1000)}",
                "tool": "Summarize",
                "ok": bool(last_fetch_text),
                "output": summary,
                "detail": "extractive LocalBrain summary",
                "args": {"from": spec.get("from"), "chars": len(last_fetch_text)},
                "refused": False,
                "ts": time.time(),
            }
            tool_results.append(result)
            continue
        # tool
        tool = spec.get("tool") or ""
        args = spec.get("args") or {}
        result = runner(tool, args)
        # Normalize legacy intents that omitted kind
        if "tool" not in result:
            result = dict(result)
        tool_results.append(result)
        if tool == "WebFetch" and result.get("ok"):
            last_fetch_text = result.get("output") or ""

    if tool_results:
        parts = []
        for tr in tool_results:
            tool = tr.get("tool")
            if tr.get("refused"):
                parts.append(f"Refused {tool}: {tr.get('output') or tr.get('detail')}")
                continue
            if not tr.get("ok"):
                parts.append(f"{tool} failed: {tr.get('output') or tr.get('detail')}")
                continue
            out = tr.get("output") or ""
            if tool == "Shell":
                cmd = (tr.get("args") or {}).get("command", "")
                parts.append(f"Shell ran `{cmd}`.\nResult:\n```\n{out}\n```")
            elif tool == "ListDir":
                parts.append(
                    f"ListDir `{(tr.get('args') or {}).get('path')}`:\n{out}"
                )
            elif tool == "WebFetch":
                snippet = out[:800] + ("…" if len(out) > 800 else "")
                parts.append(
                    f"Fetched {(tr.get('args') or {}).get('url')}"
                    f" ({tr.get('detail')}):\n{snippet}"
                )
            elif tool == "Summarize":
                parts.append(f"Summary:\n{out}")
            elif tool == "Read":
                parts.append(f"Read {(tr.get('args') or {}).get('path')}:\n{out[:2000]}")
            elif tool == "Write":
                parts.append(out)
            elif tool in ("MemoryUpdate", "MemoryRecall"):
                parts.append(out)
            elif tool in ("RoutineCreate", "RoutineList"):
                parts.append(f"{tool}:\n{out}")
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
    mem = persist.load_memory(aid)
    profile = mem.get("profile") or {}
    hint = ""
    if profile.get("name"):
        hint = f" I remember your name is {profile['name']}."
    reply = (
        "LocalBrain online (no API/Ollama key)."
        f"{hint} "
        "I can run real Host tools when you ask: Shell, Read, Write, ListDir, WebFetch; "
        "also memory (记住/我叫什么), routines, and fetch+summarize. "
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
    for m in re.finditer(r"```json\s*(\{.*?\})\s*```", text, re.S | re.I):
        try:
            obj = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if obj.get("tool") and isinstance(obj.get("args"), dict):
            calls.append({"tool": obj["tool"], "args": obj["args"]})
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and isinstance(obj.get("tool_calls"), list):
            for c in obj["tool_calls"]:
                if c.get("tool"):
                    calls.append({"tool": c["tool"], "args": c.get("args") or {}})
    except json.JSONDecodeError:
        pass
    return calls
