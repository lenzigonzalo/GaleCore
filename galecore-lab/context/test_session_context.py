"""The real context entry point discovers coverage without another market request."""
import io
import json
import runpy
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from galecore_ai.capabilities.contracts import KNOWN_CAPABILITIES


class Output(io.StringIO):
    def reconfigure(self, **kwargs):
        pass


def context(listed):
    calls = []

    def start(args, **kwargs):
        command = args[4:]
        calls.append(command)
        if command == ["galecore", "list"]:
            data = listed
        elif command == ["clock"]:
            data = {"summary": "fixture", "now_ny": "2026-10-29T17:57:00-04:00"}
        else:
            data = {"data": []}
        return SimpleNamespace(returncode=0, communicate=lambda: (json.dumps(data), ""))

    output = Output()
    with patch("subprocess.Popen", side_effect=start), patch.object(sys, "stdout", output), \
            patch.object(sys, "stdin", io.StringIO('{"prompt":"Qué pasó hoy en el mercado?"}')), \
            patch.dict(sys.modules, {"concepto": SimpleNamespace(es_concepto=lambda *args: False)}):
        runpy.run_path(str(Path(__file__).with_name("session_context.py")))
    return output.getvalue(), calls


def test_map_uses_canonical_coverage_without_fetching_board():
    caps = [{"id": c.capability_id, "what": c.description} for c in KNOWN_CAPABILITIES]
    text, calls = context({"capabilities": caps})
    board = next(c for c in caps if c["id"] == "macro.board")
    assert board["what"] in text
    assert len(text) <= 6000
    assert calls.count(["galecore", "list"]) == 1
    assert not any("macro.board" in command for command in calls)
    # Only board coverage is expanded; unrelated descriptions do not inflate the context.
    quote = next(c for c in caps if c["id"] == "market_data.quote")
    assert quote["what"] not in text


@pytest.mark.parametrize("listed", [{}, {"capabilities": "bad"}, {"capabilities": [{}]}])
def test_invalid_listing_keeps_existing_fallback(listed):
    text, _ = context(listed)
    assert "[mapa de GaleCore] no disponible" in text


def test_missing_board_description_does_not_invent_coverage():
    text, _ = context({"capabilities": [{"id": "macro.board"}]})
    assert "- macro: board" in text
    assert "- macro.board:" not in text
