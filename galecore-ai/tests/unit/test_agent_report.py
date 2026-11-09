"""WS-0079: `agent report` manda la corrida de una rutina a la API (contra un GaleCore falso)."""

from __future__ import annotations

import io
import json
import sys

import httpx
import pytest

from galecore_ai.adapters import cli
from galecore_ai.application import agent_report

AGENT_SECRET = "gca_secreto-del-usuario"
API_KEY = "api-key-global"


class FakeGaleCore:
    def __init__(self, status: int = 200, body: dict | None = None):
        self.requests: list[httpx.Request] = []
        self.status = status
        self.body = body

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status == 200:
            sent = json.loads(request.content)
            return httpx.Response(200, json=self.body or {"id": "run-1", "agent_key": "oportunidades",
                                                          "status": sent["status"], "summary": sent["summary"]})
        return httpx.Response(self.status, json=self.body)


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("GALECORE_BASE_URL", "http://localhost:7001")
    monkeypatch.setenv("GALECORE_API_KEY", API_KEY)
    monkeypatch.setenv("GALECORE_AGENT_KEY", AGENT_SECRET)
    for name in ("GALECORE_TRIGGER_ID", "GALECORE_FIRED_AT", "LOCAL_VALIDATION", "GALECORE_ALLOWED_BASE_URL"):
        monkeypatch.delenv(name, raising=False)


def run(monkeypatch, capsys, argv, fake: FakeGaleCore | None = None):
    monkeypatch.setattr(agent_report, "_transport", httpx.MockTransport(fake) if fake else None)
    monkeypatch.setattr(sys, "argv", ["cli", "agent", "report", *argv])
    with pytest.raises(SystemExit) as exit_:
        cli.main()
    out = capsys.readouterr().out
    return exit_.value.code, json.loads(out), out


def test_success_sends_headers_and_body(env, monkeypatch, capsys):
    fake = FakeGaleCore()
    code, data, out = run(monkeypatch, capsys, ["oportunidades", "--status", "ok", "--summary", "Todo bien",
                                                "--reason-code", "sin_cambios", "--trigger-id", "trig_1",
                                                "--fired-at", "2026-11-09T13:00:00Z"], fake)
    assert code == 0 and data["status"] == "REPORTED" and data["run"]["id"] == "run-1"
    req = fake.requests[0]
    assert req.method == "POST" and req.url.path == "/App/GaleCore/Agents/oportunidades/Runs"
    assert req.headers["X-GaleCore-Agent-Key"] == AGENT_SECRET
    assert req.headers["X-API-KEY"] == API_KEY
    assert req.headers["Content-Type"] == "application/json"
    body = json.loads(req.content)
    assert body["status"] == "ok" and body["summary"] == "Todo bien" and body["reason_code"] == "sin_cambios"
    assert body["trigger_id"] == "trig_1" and body["fired_at"] == "2026-11-09T13:00:00Z"
    assert body["finished_at"]   # hora actual UTC cuando no se pasa
    assert AGENT_SECRET not in out and API_KEY not in out


def test_missing_agent_key_does_not_call_the_api(env, monkeypatch, capsys):
    monkeypatch.delenv("GALECORE_AGENT_KEY")
    fake = FakeGaleCore()
    code, data, _ = run(monkeypatch, capsys, ["x", "--status", "ok", "--summary", "hola"], fake)
    assert code == 3 and "GALECORE_AGENT_KEY" in data["error"] and fake.requests == []


@pytest.mark.parametrize("status,payload,code_expected", [
    (401, {"error": "Clave de agentes inválida", "code": "invalid_agent_key"}, "invalid_agent_key"),
    (404, {"error": "No existe el agente", "code": "agent_not_found"}, "agent_not_found"),
])
def test_api_errors_are_shown_with_nonzero_exit(env, monkeypatch, capsys, status, payload, code_expected):
    code, data, out = run(monkeypatch, capsys, ["x", "--status", "error", "--summary", "falló"],
                          FakeGaleCore(status, payload))
    assert code == 1 and payload["error"] in data["error"] and code_expected in data["error"]
    assert f"HTTP {status}" in data["error"] and AGENT_SECRET not in out and API_KEY not in out


def test_long_summary_is_cut_to_4000(env, monkeypatch, capsys):
    fake = FakeGaleCore()
    code, _, _ = run(monkeypatch, capsys, ["x", "--status", "ok", "--summary", "a" * 5000], fake)
    summary = json.loads(fake.requests[0].content)["summary"]
    assert code == 0 and len(summary) == 4000 and summary.endswith("…")


def test_summary_file_dash_reads_stdin(env, monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO("# Corrida\nñandú".encode()), encoding="utf-8"))
    fake = FakeGaleCore()
    code, _, _ = run(monkeypatch, capsys, ["x", "--status", "skipped", "--summary-file", "-"], fake)
    assert code == 0 and json.loads(fake.requests[0].content)["summary"] == "# Corrida\nñandú"


def test_summary_file_path(env, monkeypatch, capsys, tmp_path):
    f = tmp_path / "r.md"
    f.write_text("desde archivo", encoding="utf-8")
    fake = FakeGaleCore()
    code, _, _ = run(monkeypatch, capsys, ["x", "--status", "ok", "--summary-file", str(f)], fake)
    assert code == 0 and json.loads(fake.requests[0].content)["summary"] == "desde archivo"


def test_trigger_and_fired_at_default_from_env(env, monkeypatch, capsys):
    monkeypatch.setenv("GALECORE_TRIGGER_ID", "trig_env")
    monkeypatch.setenv("GALECORE_FIRED_AT", "2026-11-09T12:00:00+00:00")
    fake = FakeGaleCore()
    run(monkeypatch, capsys, ["x", "--status", "ok", "--summary", "s"], fake)
    body = json.loads(fake.requests[0].content)
    assert body["trigger_id"] == "trig_env" and body["fired_at"] == "2026-11-09T12:00:00+00:00"


def test_invalid_status_is_rejected(env, monkeypatch, capsys):
    fake = FakeGaleCore()
    code, data, _ = run(monkeypatch, capsys, ["x", "--status", "roto", "--summary", "s"], fake)
    assert code == 3 and "Argument error" in data["error"] and fake.requests == []


def test_invalid_fired_at_is_rejected(env, monkeypatch, capsys):
    fake = FakeGaleCore()
    code, data, _ = run(monkeypatch, capsys, ["x", "--status", "ok", "--summary", "s", "--fired-at", "ayer"], fake)
    assert code == 3 and "--fired-at" in data["error"] and fake.requests == []


def test_foreign_host_is_blocked(env, monkeypatch, capsys):
    monkeypatch.setenv("GALECORE_BASE_URL", "https://otro.example.com")
    fake = FakeGaleCore()
    code, data, _ = run(monkeypatch, capsys, ["x", "--status", "ok", "--summary", "s"], fake)
    assert code == 1 and "otro.example.com" in data["error"] and fake.requests == []
