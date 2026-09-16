"""CLI subprocess tests — always JSON output, correct exit codes."""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest


def _run_cli(*args: str, stdin: str | None = None) -> tuple[int, dict]:
    """Run the CLI as a subprocess and return (exit_code, parsed_json)."""
    cmd = [sys.executable, "-B", "-m", "galecore_ai.adapters.cli", *args]
    env = {
        **os.environ,
        # An unreachable endpoint with a short timeout keeps the suite independent
        # of whether a real GaleCore is listening on the default port.
        "GALECORE_BASE_URL": os.environ.get("GALECORE_TEST_URL", "http://127.0.0.1:9"),
        "GALECORE_TIMEOUT_SECONDS": "2",
    }
    result = subprocess.run(  # noqa: PLW1510
        cmd,
        input=stdin,
        capture_output=True,
        text=True,
        timeout=30,
        env=env,
    )
    # stdout must always be valid JSON
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        pytest.fail(f"CLI stdout is not valid JSON:\n{result.stdout}\nstderr:\n{result.stderr}")
    return result.returncode, data


class TestCliPrepare:
    def test_prepare_without_galecore_fails_json(self):
        """prepare with no GaleCore running fails with JSON error."""
        code, data = _run_cli(
            "prepare", "--symbol", "SPY",
        )
        assert code != 0
        assert "error" in data

    def test_prepare_missing_symbol_produces_json(self):
        """Missing --symbol flag should produce JSON error on stdout."""
        code, data = _run_cli("prepare")
        assert code == 3  # VALIDATION_ERROR
        assert "error" in data
        assert "symbol" in data["error"].lower() or "argument" in data["error"].lower()

    def test_no_subcommand_produces_json(self):
        """No subcommand at all produces JSON error."""
        code, data = _run_cli()
        assert code == 3
        assert "error" in data


class TestCliAccept:
    def test_accept_malformed_json(self):
        """Malformed JSON input produces JSON error, exit code 3."""
        code, data = _run_cli("accept", stdin="not json at all")
        assert code == 3  # VALIDATION_ERROR
        assert "error" in data
        assert "Invalid JSON" in data["error"]

    def test_accept_missing_keys(self):
        """Missing run_id/interpretation produces JSON error."""
        code, data = _run_cli("accept", stdin='{"foo": "bar"}')
        assert code == 3
        assert "error" in data

    def test_accept_nonexistent_run_id(self):
        """Valid JSON with unknown run_id produces VALIDATION_ERROR."""
        payload = json.dumps({
            "run_id": "01a0a7bc-0fc3-7a41-9fcf-73ec491249c3",
            "interpretation": {
                "regime": "positive_gamma",
                "observations": ["test"],
                "evidence": [{"fact_path": "facts.net_gex", "claim": "test"}],
                "limitations": ["test"],
            },
        })
        code, data = _run_cli("accept", stdin=payload)
        assert code == 3  # VALIDATION_ERROR
        assert data.get("status") == "VALIDATION_ERROR" or "error" in data

    def test_accept_empty_stdin(self):
        """Empty stdin produces JSON error."""
        code, data = _run_cli("accept", stdin="")
        assert code != 0
        assert "error" in data

    def test_accept_array_input(self):
        """Array (not object) input produces JSON error."""
        code, data = _run_cli("accept", stdin="[1, 2, 3]")
        assert code == 3
        assert "error" in data
