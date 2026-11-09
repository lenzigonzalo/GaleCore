"""El contexto de generación usa la misma skill canónica para todos los motores."""
import io
import json
import runpy
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest


class Output(io.StringIO):
    def reconfigure(self, **kwargs):
        pass


@pytest.mark.parametrize("provider", ["claude", "codex"])
@pytest.mark.parametrize("capability,skill", [
    ("html_board", "html-board"),
    ("regime_interpretation", "regime-analysis"),
])
def test_generation_context(provider, capability, skill):
    entry = {"capability": capability, "skill": f"skills/{skill}/SKILL.md", "score": 10}
    catalog = SimpleNamespace(returncode=0, stdout=json.dumps({"confident": True, "matches": [entry]}))
    output = Output()
    script = Path(__file__).with_name("match_request.py")
    canonical = script.parents[2] / "galecore-ai" / "config" / entry["skill"]
    with patch("subprocess.run", return_value=catalog), patch.object(sys, "stdout", output), \
            patch.object(sys, "stdin", io.StringIO('{"prompt":"armame un tablero de SPY"}')), \
            patch.dict("os.environ", {"GALECORE_HOST_PROVIDER": provider}), \
            patch.dict(sys.modules, {"concepto": SimpleNamespace(NOT_TICKERS=set(), es_concepto=lambda *a: False)}):
        runpy.run_path(str(script))
    text = output.getvalue()
    source = canonical.read_text(encoding="utf-8").strip()
    if capability == "html_board":
        assert source in text
        assert "prioridad sobre skills genéricas del host" in text
    else:
        assert "[cómo responder]" in text
        assert source not in text
        assert "[método completo de Tablero HTML]" not in text
