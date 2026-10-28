"""Tests use this checkout's ``src``, also in worktrees whose installed package points elsewhere (GC-AI-0007).

``sys.path`` covers in-process imports; ``PYTHONPATH`` covers the CLI subprocesses some tests start.
"""

import os
import sys
from pathlib import Path

SRC = str(Path(__file__).resolve().parents[1] / "src")
sys.path.insert(0, SRC)
os.environ["PYTHONPATH"] = os.pathsep.join([SRC, *filter(None, [os.environ.get("PYTHONPATH")])])


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_session_cache(tmp_path, monkeypatch):
    """The API client caches its login token under %LOCALAPPDATA%: tests never read or write the real one."""
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "localappdata"))
