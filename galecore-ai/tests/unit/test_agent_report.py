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


def test_get_skill_sends_both_keys_and_404_says_it_is_not_yours_or_shared(env, monkeypatch):
    piece = {"kind": "skill", "key": "cierre", "content": "{}", "format": "json"}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET" and request.url.path == "/App/GaleCore/Agents/Skills/" + request.url.path.rsplit("/", 1)[1]
        assert request.headers["X-GaleCore-Agent-Key"] == AGENT_SECRET and request.headers["X-API-KEY"] == API_KEY
        return httpx.Response(200, json=piece) if request.url.path.endswith("/cierre") else httpx.Response(404, json={})

    monkeypatch.setattr(agent_report, "_transport", httpx.MockTransport(handler))
    kw = {"base_url": "http://localhost:7001", "api_key": API_KEY, "agent_secret": AGENT_SECRET}
    assert agent_report.get_skill(skill_key="cierre", **kw) == piece
    with pytest.raises(agent_report.AgentReportError, match="no existe o no es tuya ni compartida") as err:
        agent_report.get_skill(skill_key="otra", **kw)
    assert err.value.status == 404


def test_skill_run_in_the_cloud_reads_the_skill_with_the_agents_key(env, monkeypatch, capsys, tmp_path):
    import argparse

    from galecore_ai.application import skill_space
    monkeypatch.setenv(skill_space.CACHE_ENV, str(tmp_path / "cache"))
    monkeypatch.setattr(cli, "knowledge_dir", lambda: tmp_path / "kb")
    monkeypatch.setattr("galecore_ai.adapters.galecore_space.SpaceClient",
                        lambda *a, **k: pytest.fail("cloud run must not log in"))
    files = {"SKILL.md": "---\nname: Cierre\ndescription: x\n---\n", "scripts/c.py": "import json\nprint(json.dumps({'v': 7}))\n"}
    content, _ = skill_space.build_content(files)
    gets = []

    def handler(request: httpx.Request) -> httpx.Response:
        gets.append(request)
        if request.url.path.endswith("/cierre"):
            return httpx.Response(200, json={"kind": "skill", "key": "cierre", "format": "json", "content": content})
        return httpx.Response(404, json={"error": "x"})

    monkeypatch.setattr(agent_report, "_transport", httpx.MockTransport(handler))

    def run(skill):
        args = argparse.Namespace(skill_command="run", skill=skill, script="c.py", script_args=[], timeout=30)
        with pytest.raises(SystemExit) as stop:
            cli._cmd_skill(args)
        return stop.value.code, json.loads(capsys.readouterr().out)

    code, out = run("cierre")
    assert code == 0 and out["ok"] and out["result"] == {"v": 7} and out["source"] == "space"
    code, out = run("nada")
    assert code == 3 and out["ok"] is False and "no existe o no es tuya ni compartida" in out["error"]
    assert AGENT_SECRET not in json.dumps(out)


def test_get_skill_escapes_the_key_in_the_url(env, monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.raw_path.decode())
        return httpx.Response(200, json={})

    monkeypatch.setattr(agent_report, "_transport", httpx.MockTransport(handler))
    agent_report.get_skill(base_url="http://localhost:7001", api_key=API_KEY, agent_secret=AGENT_SECRET, skill_key="a/b?c#d")
    assert seen == ["/App/GaleCore/Agents/Skills/a%2Fb%3Fc%23d"]


def _result_file(tmp_path, data) -> str:
    f = tmp_path / "r.json"
    f.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
    return str(f)


def _skill_out(**salida):
    return {"ok": True, "skill": "cierre", "version": 2, "source": "space", "result": salida, "error": None}


def test_result_file_sends_result_and_valid_alerts(env, monkeypatch, capsys, tmp_path):
    fake = FakeGaleCore()
    avisos = [{"id": "ruptura-1", "titulo": "Rompió"}, {"id": "x" * 101, "titulo": "largo"}, {"id": "a"}, "mal"]
    path = _result_file(tmp_path, _skill_out(valores={"spy": 600}, avisos=avisos))
    code, _, _ = run(monkeypatch, capsys, ["a1", "--status", "ok", "--summary", "ok", "--result-file", path], fake)
    body = json.loads(fake.requests[0].content)
    assert code == 0 and body["status"] == "ok"
    assert body["result"]["skill"] == "cierre" and body["result"]["version"] == 2 and body["result"]["ok"] is True
    assert body["result"]["salida"]["valores"] == {"spy": 600}
    assert body["alerts"] == [{"id": "ruptura-1", "titulo": "Rompió"}]


def test_result_file_failed_skill_turns_ok_into_error_without_alerts(env, monkeypatch, capsys, tmp_path):
    fake = FakeGaleCore()
    path = _result_file(tmp_path, {"ok": False, "skill": "cierre", "version": 2, "result": {"avisos": [{"id": "a", "titulo": "b"}]},
                                   "error": "boom"})
    run(monkeypatch, capsys, ["a1", "--status", "ok", "--summary", "ok", "--result-file", path], fake)
    body = json.loads(fake.requests[0].content)
    assert body["status"] == "error" and body["result"]["ok"] is False and body["result"]["error"] == "boom"
    assert "alerts" not in body


@pytest.mark.parametrize("content", [None, "no es json", "[1]"])
def test_result_file_missing_or_not_json_still_reports(env, monkeypatch, capsys, tmp_path, content):
    fake = FakeGaleCore()
    path = str(tmp_path / "nada.json") if content is None else _result_file(tmp_path, content)
    run(monkeypatch, capsys, ["a1", "--status", "skipped", "--summary", "s", "--result-file", path], fake)
    body = json.loads(fake.requests[0].content)
    assert body["status"] == "skipped" and body["result"] == {"ok": False, "error": "sin resultado del cálculo"}


def test_result_file_too_big_is_not_sent(env, monkeypatch, capsys, tmp_path):
    fake = FakeGaleCore()
    path = _result_file(tmp_path, _skill_out(texto="x" * 60_000))
    code, _, _ = run(monkeypatch, capsys, ["a1", "--status", "ok", "--summary", "s", "--result-file", path], fake)
    assert code != 0 and fake.requests == []


def test_alerts_capped_at_ten(env, monkeypatch, capsys, tmp_path):
    fake = FakeGaleCore()
    path = _result_file(tmp_path, _skill_out(avisos=[{"id": f"i{n}", "titulo": "t"} for n in range(15)]))
    run(monkeypatch, capsys, ["a1", "--status", "ok", "--summary", "s", "--result-file", path], fake)
    assert len(json.loads(fake.requests[0].content)["alerts"]) == 10


def test_without_result_file_body_is_unchanged(env, monkeypatch, capsys):
    fake = FakeGaleCore()
    run(monkeypatch, capsys, ["a1", "--status", "ok", "--summary", "s"], fake)
    body = json.loads(fake.requests[0].content)
    assert "result" not in body and "alerts" not in body
