"""Turn engine: open_turn → optional tool loop → deliver → end_turn + persist/audit."""
from __future__ import annotations

import os
import time
import uuid
from typing import Any

from . import llm, persist, tools_host

MAX_TOOL_LOOPS = int(os.environ.get("BITBOT_MAX_TOOL_LOOPS", "4"))


def run_turn(user_text: str, agent_id: str = "demo-agent") -> dict[str, Any]:
    """Public entry: run one user turn to completion. Never pretends tools ran."""
    persist.ensure_data_dirs()
    aid = (agent_id or "demo-agent").strip() or "demo-agent"
    text = user_text if isinstance(user_text, str) else str(user_text)
    turn_id = str(uuid.uuid4())
    started = time.time()
    audit_spans: list[dict] = []
    tool_calls: list[dict] = []

    def emit(tool: str, ok: bool, detail: str, **extra) -> dict:
        span = {
            "id": str(uuid.uuid4()),
            "turn_id": turn_id,
            "agent_id": aid,
            "tool_name": tool,
            "ok": ok,
            "detail": detail,
            "ts": time.time(),
            "duration_ms": int(extra.pop("duration_ms", 0)),
            **extra,
        }
        audit_spans.append(span)
        persist.append_audit(span)
        return span

    emit("turn:open", True, f"open_turn agent={aid}")

    user_msg = {
        "id": f"msg-{uuid.uuid4().hex[:12]}",
        "role": "user",
        "text": text,
        "agent_id": aid,
        "ts": time.time(),
        "reactions": {},
    }

    mode = llm.detect_llm_mode()
    assistant_text = ""
    history = persist.load_chat(aid)

    try:
        if mode == "localbrain":
            lb = llm.localbrain_turn(text, run_tool=tools_host.dispatch)
            assistant_text = lb.get("text") or ""
            for tr in lb.get("tool_results") or []:
                tool_calls.append(tr)
                emit(
                    f"tool:{tr.get('tool')}",
                    bool(tr.get("ok")),
                    tr.get("detail") or ("ok" if tr.get("ok") else "error"),
                    artifact_path=(tr.get("args") or {}).get("path"),
                    refused=bool(tr.get("refused")),
                    output_excerpt=(tr.get("output") or "")[:500],
                )
        else:
            # API / Ollama: may ask LocalBrain-style tools first when user clearly wants tools
            intents = llm.parse_localbrain_intents(text)
            tool_notes: list[str] = []
            loops = 0
            while intents and loops < MAX_TOOL_LOOPS:
                loops += 1
                next_intents: list[dict] = []
                for spec in intents:
                    tr = tools_host.dispatch(spec["tool"], spec.get("args") or {})
                    tool_calls.append(tr)
                    emit(
                        f"tool:{tr.get('tool')}",
                        bool(tr.get("ok")),
                        tr.get("detail") or "",
                        refused=bool(tr.get("refused")),
                        output_excerpt=(tr.get("output") or "")[:500],
                    )
                    tool_notes.append(
                        f"{tr.get('tool')} ok={tr.get('ok')}: {(tr.get('output') or '')[:2000]}"
                    )
                intents = next_intents

            messages = []
            for m in history[-20:]:
                role = m.get("role") or "user"
                if role not in ("user", "assistant", "system"):
                    role = "user"
                messages.append({"role": role, "content": m.get("text") or ""})
            system = (
                "You are Bit Bot Host. Host owns real tools. "
                "If tool results are provided below, base your answer on them. "
                "Never invent tool output."
            )
            if tool_notes:
                system += "\n\nTool results from this turn:\n" + "\n---\n".join(tool_notes)
            messages.insert(0, {"role": "system", "content": system})
            messages.append({"role": "user", "content": text})
            try:
                comp = llm.chat_completion(messages)
                assistant_text = (comp.get("text") or "").strip()
                mode = comp.get("mode") or mode
            except Exception as e:
                # Fall back to LocalBrain so tools still surface
                emit("llm:error", False, str(e))
                lb = llm.localbrain_turn(text, run_tool=tools_host.dispatch)
                assistant_text = lb.get("text") or f"LLM error: {e}"
                mode = "localbrain"
                for tr in lb.get("tool_results") or []:
                    if tr not in tool_calls:
                        tool_calls.append(tr)
                        emit(
                            f"tool:{tr.get('tool')}",
                            bool(tr.get("ok")),
                            tr.get("detail") or "",
                            refused=bool(tr.get("refused")),
                            output_excerpt=(tr.get("output") or "")[:500],
                        )

            # If LLM returned empty but we have tool results, narrate them
            if not assistant_text and tool_notes:
                assistant_text = "\n\n".join(tool_notes)

    except Exception as e:
        assistant_text = f"Turn failed: {e}"
        emit("turn:error", False, str(e))

    if not assistant_text:
        assistant_text = "(no reply)"

    assistant_msg = {
        "id": f"msg-{uuid.uuid4().hex[:12]}",
        "role": "assistant",
        "text": assistant_text,
        "agent_id": aid,
        "ts": time.time(),
        "reactions": {},
        "llm_mode": mode,
        "turn_id": turn_id,
        "tool_call_ids": [t.get("id") for t in tool_calls],
    }

    merged = persist.append_chat_messages(aid, [user_msg, assistant_msg])
    duration_ms = int((time.time() - started) * 1000)
    emit(
        "turn:end",
        True,
        f"end_turn agent={aid} mode={mode} tools={len(tool_calls)}",
        duration_ms=duration_ms,
    )

    return {
        "turn_id": turn_id,
        "agent_id": aid,
        "llm_mode": mode,
        "assistant_text": assistant_text,
        "user_message": user_msg,
        "assistant_message": assistant_msg,
        "messages": merged,
        "tool_calls": tool_calls,
        "audit_spans": audit_spans,
        "duration_ms": duration_ms,
    }
