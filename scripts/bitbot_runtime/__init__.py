"""Bit Bot Host product runtime — Host owns LLM, FS, Shell, network, persistence."""
from __future__ import annotations

from .llm import detect_llm_mode
from .turn_engine import run_turn

__all__ = ["run_turn", "detect_llm_mode"]
