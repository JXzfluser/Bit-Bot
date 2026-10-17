"""Disk JSON persistence under /workspace/data/ with atomic writes."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

DATA_ROOT = Path(os.environ.get("BITBOT_DATA_ROOT", "/workspace/data")).resolve()
_LOCK = threading.Lock()

SUBDIRS = (
    "chats",
    "memory",
    "journal",
    "routines",
    "connectors",
    "audit",
)


def ensure_data_dirs(root: Path | None = None) -> Path:
    base = Path(root) if root is not None else DATA_ROOT
    base.mkdir(parents=True, exist_ok=True)
    for name in SUBDIRS:
        (base / name).mkdir(parents=True, exist_ok=True)
    return base


def atomic_write_json(path: Path, obj: Any) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, indent=2, sort_keys=True)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def read_json(path: Path, default: Any = None) -> Any:
    path = Path(path)
    if not path.is_file():
        return default
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return default


def chat_path(agent_id: str, root: Path | None = None) -> Path:
    base = Path(root) if root is not None else DATA_ROOT
    safe = _safe_id(agent_id)
    return base / "chats" / f"{safe}.json"


def memory_path(agent_id: str, root: Path | None = None) -> Path:
    base = Path(root) if root is not None else DATA_ROOT
    safe = _safe_id(agent_id)
    return base / "memory" / f"{safe}.json"


def journal_path(agent_id: str, root: Path | None = None) -> Path:
    base = Path(root) if root is not None else DATA_ROOT
    safe = _safe_id(agent_id)
    return base / "journal" / f"{safe}.json"


def routines_path(agent_id: str, root: Path | None = None) -> Path:
    base = Path(root) if root is not None else DATA_ROOT
    safe = _safe_id(agent_id)
    return base / "routines" / f"{safe}.json"


def connector_path(name: str, root: Path | None = None) -> Path:
    base = Path(root) if root is not None else DATA_ROOT
    safe = _safe_id(name)
    return base / "connectors" / f"{safe}.json"


def audit_path(root: Path | None = None) -> Path:
    base = Path(root) if root is not None else DATA_ROOT
    day = time.strftime("%Y%m%d", time.gmtime())
    return base / "audit" / f"{day}.jsonl"


def _safe_id(value: str) -> str:
    raw = (value or "default").strip() or "default"
    out = []
    for ch in raw:
        if ch.isalnum() or ch in ("-", "_", "."):
            out.append(ch)
        else:
            out.append("_")
    return "".join(out)[:120]


def _load_chat_unlocked(agent_id: str, root: Path | None = None) -> list[dict]:
    data = read_json(chat_path(agent_id, root), default={"messages": []})
    if isinstance(data, list):
        return list(data)
    msgs = data.get("messages") if isinstance(data, dict) else None
    return list(msgs) if isinstance(msgs, list) else []


def load_chat(agent_id: str, root: Path | None = None) -> list[dict]:
    with _LOCK:
        return _load_chat_unlocked(agent_id, root)


def save_chat(agent_id: str, messages: list[dict], root: Path | None = None) -> None:
    with _LOCK:
        atomic_write_json(
            chat_path(agent_id, root),
            {
                "agent_id": agent_id,
                "updated_at": time.time(),
                "messages": list(messages),
            },
        )


def append_chat_messages(
    agent_id: str, new_messages: list[dict], root: Path | None = None
) -> list[dict]:
    with _LOCK:
        existing = _load_chat_unlocked(agent_id, root)
        merged = existing + list(new_messages)
        atomic_write_json(
            chat_path(agent_id, root),
            {
                "agent_id": agent_id,
                "updated_at": time.time(),
                "messages": merged,
            },
        )
        return merged


def _load_memory_unlocked(agent_id: str, root: Path | None = None) -> dict:
    data = read_json(memory_path(agent_id, root), default={})
    return dict(data) if isinstance(data, dict) else {}


def load_memory(agent_id: str, root: Path | None = None) -> dict:
    with _LOCK:
        return _load_memory_unlocked(agent_id, root)


def save_memory(agent_id: str, profile: dict, root: Path | None = None) -> dict:
    with _LOCK:
        payload = {
            "agent_id": agent_id,
            "updated_at": time.time(),
            "profile": dict(profile.get("profile") or profile),
        }
        if "journal" in profile:
            payload["journal"] = profile["journal"]
        atomic_write_json(memory_path(agent_id, root), payload)
        return payload


def update_memory(
    agent_id: str, patch: dict, root: Path | None = None
) -> dict:
    with _LOCK:
        cur = _load_memory_unlocked(agent_id, root)
        profile = dict(cur.get("profile") or {})
        incoming = patch.get("profile") if isinstance(patch.get("profile"), dict) else patch
        if isinstance(incoming, dict):
            profile.update(incoming)
        payload = {
            "agent_id": agent_id,
            "updated_at": time.time(),
            "profile": profile,
        }
        if "journal" in cur:
            payload["journal"] = cur["journal"]
        if "journal" in patch:
            payload["journal"] = patch["journal"]
        atomic_write_json(memory_path(agent_id, root), payload)
        return payload


def _load_journal_unlocked(agent_id: str, root: Path | None = None) -> list:
    data = read_json(journal_path(agent_id, root), default={"entries": []})
    if isinstance(data, list):
        return list(data)
    entries = data.get("entries") if isinstance(data, dict) else None
    return list(entries) if isinstance(entries, list) else []


def load_journal(agent_id: str, root: Path | None = None) -> list:
    with _LOCK:
        return _load_journal_unlocked(agent_id, root)


def save_journal(agent_id: str, entries: list, root: Path | None = None) -> None:
    with _LOCK:
        atomic_write_json(
            journal_path(agent_id, root),
            {"agent_id": agent_id, "updated_at": time.time(), "entries": list(entries)},
        )


def append_journal_entry(
    agent_id: str, entry: dict, root: Path | None = None
) -> list:
    """Append one journal entry; used by chat memory round-trip."""
    with _LOCK:
        entries = _load_journal_unlocked(agent_id, root)
        item = dict(entry) if isinstance(entry, dict) else {"text": str(entry)}
        if "ts" not in item:
            item["ts"] = time.time()
        entries.append(item)
        atomic_write_json(
            journal_path(agent_id, root),
            {
                "agent_id": agent_id,
                "updated_at": time.time(),
                "entries": entries,
            },
        )
        return entries


def memory_profile(agent_id: str, root: Path | None = None) -> dict:
    """Profile dict only — chat/LocalBrain recall surface."""
    mem = load_memory(agent_id, root)
    profile = mem.get("profile") if isinstance(mem, dict) else {}
    return dict(profile) if isinstance(profile, dict) else {}


def load_routines(agent_id: str, root: Path | None = None) -> list:
    with _LOCK:
        data = read_json(routines_path(agent_id, root), default={"routines": []})
    if isinstance(data, list):
        return list(data)
    items = data.get("routines") if isinstance(data, dict) else None
    return list(items) if isinstance(items, list) else []


def save_routines(agent_id: str, routines: list, root: Path | None = None) -> None:
    with _LOCK:
        atomic_write_json(
            routines_path(agent_id, root),
            {
                "agent_id": agent_id,
                "updated_at": time.time(),
                "routines": list(routines),
            },
        )


def load_connector_state(name: str, root: Path | None = None) -> dict:
    with _LOCK:
        data = read_json(connector_path(name, root), default={})
    return dict(data) if isinstance(data, dict) else {}


def save_connector_state(name: str, state: dict, root: Path | None = None) -> dict:
    with _LOCK:
        payload = dict(state)
        payload["updated_at"] = time.time()
        atomic_write_json(connector_path(name, root), payload)
        return payload


def append_audit(span: dict, root: Path | None = None) -> None:
    path = audit_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(span, ensure_ascii=False)
    with _LOCK:
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
            fh.flush()


ensure_data_dirs()
