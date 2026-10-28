"""P1-01b (U-70): «analizá este aviso» — one model run from an alert, with the context the code gathered."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest

from galecore_ai.application import alert_analysis, supervisor, watch
from galecore_ai.application.knowledge import KnowledgeError
from galecore_ai.application.model_run import ModelReply
from tests.unit.test_knowledge import NOW, kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_space import galecore  # noqa: F401  (fixture)
from tests.unit.test_strategy import research_ref, stored  # noqa: F401  (research_ref is a fixture)
from tests.unit.test_supervisor import position
from tests.unit.test_supervisor import reader as runtime_reader
from tests.unit.test_watch import reader as market_reader

IN_SESSION = NOW.replace(hour=15)          # 11:00 New York, a Wednesday
GOOD = {"summary": "SPY quedó en 750, 10 puntos debajo del umbral de 760.",
        "detail": "El aviso saltó con SPY en 750. Ahora sigue en 750; el gamma cero está en 771.", "missing": []}
ADVICE = {**GOOD, "detail": "SPY está en 750. Conviene cerrar la posición antes del dato."}


class FakeClient:
    def __init__(self, *outputs):
        self.outputs, self.prompts = list(outputs), []

    def run(self, *, prompt, allowed, max_turns, schema, cwd, timeout_s, add_dir):
        self.prompts.append(prompt)
        assert allowed == [] and max_turns == alert_analysis.RUN.max_turns
        out = self.outputs.pop(0)
        if isinstance(out, str):
            return ModelReply(ok=False, error=out, model="claude-sonnet")
        return ModelReply(ok=True, structured=out, model="claude-sonnet", tokens={"input": 900, "output": 120})


@pytest.fixture(autouse=True)
def scratch(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))


def watch_alert(kb, mid=750.0):  # noqa: F811
    watch.add(kb, symbol="SPY", metric="price", condition="below", threshold=760.0, words="avisame si SPY baja a 760",
              prompt="avisame si SPY baja a 760", now=NOW)
    supervisor.scan(kb, market_reader(mid=mid, gex={"gammaZeroLevel": 771.1}), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    return alert


def run(kb, alert_id, client, read=None, at=IN_SESSION):  # noqa: F811
    return alert_analysis.analyze(kb, alert_id, read or market_reader(mid=750.0, gex={"gammaZeroLevel": 771.1}),
                                  client, requested_at=at, requested_by="monitor", prompt="analizá este aviso",
                                  now=at + timedelta(minutes=2))


def test_the_policy_picks_sonnet_for_reading_work():
    assert alert_analysis.RUN.model == "sonnet" and "reading → sonnet" in alert_analysis.RUN.route_reason()


def test_an_alert_is_analysed_with_the_context_the_code_gathered(kb):  # noqa: F811
    alert = watch_alert(kb)
    client = FakeClient(GOOD)
    a = run(kb, alert.id, client)
    assert a.status.value == "done" and a.summary == GOOD["summary"] and a.content_hash
    assert a.alert_hash == alert.content_hash and a.route and a.tokens == {"input": 900, "output": 120}
    ctx = a.context
    assert ctx["aviso"]["motivo"] == alert.motivo and ctx["ahora"]["precio de SPY"] == 750.0
    assert ctx["ahora"]["nivel gamma cero de SPY"] == 771.1 and ctx["ahora"]["IV rank de SPY"] == 16.5
    assert "posicion" not in ctx                      # a watch alert has no position
    assert alert.motivo in client.prompts[0] and "Aconsejar: nada de" in client.prompts[0]
    # GaleCore's GEX did not give the walls: declared, not invented
    assert "GaleCore no dio muro de calls de SPY" in a.missing
    # one done analysis per alert
    with pytest.raises(KnowledgeError, match="already has an analysis"):
        run(kb, alert.id, FakeClient(GOOD))


def test_advice_gets_one_correction_and_then_fails(kb):  # noqa: F811
    alert = watch_alert(kb)
    client = FakeClient(ADVICE, GOOD)
    assert run(kb, alert.id, client).status.value == "done"
    assert "advice addressed to the reader" in client.prompts[1] and "Conviene cerrar" in client.prompts[1]


def test_advice_twice_is_a_failed_analysis_that_can_be_asked_again(kb):  # noqa: F811
    alert = watch_alert(kb)
    a = run(kb, alert.id, FakeClient(ADVICE, ADVICE))
    assert a.status.value == "failed" and "salida rechazada" in a.error and a.summary == ""
    shown = alert_analysis.view(kb, [alert.id], IN_SESSION + timedelta(minutes=3))[alert.id]
    assert shown["status"] == "failed" and "salida rechazada" in shown["error"]
    later = IN_SESSION + timedelta(minutes=10)
    assert run(kb, alert.id, FakeClient(GOOD), at=later).status.value == "done"
    assert alert_analysis.view(kb, [alert.id], later)[alert.id]["status"] == "done"


def test_a_model_failure_and_a_galecore_failure_are_declared(kb):  # noqa: F811
    alert = watch_alert(kb)
    a = run(kb, alert.id, FakeClient("time cap reached (5 min)"),
            read=market_reader(fail_quote=True, gex={"gammaZeroLevel": 771.1}))
    assert a.status.value == "failed" and a.error == "time cap reached (5 min)"
    assert any("HTTP 502" in m for m in a.missing) and "precio de SPY" not in a.context["ahora"]


def test_a_position_alert_carries_the_position_and_the_strategys_rules(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    pos = position(maxRisk=960.0)
    runtime = runtime_reader(doc.spec_hash, [pos])
    supervisor.scan(kb, runtime, IN_SESSION)
    [alert] = supervisor.alerts(kb)
    market = market_reader(mid=777.8, gex={"gammaZeroLevel": 771.1, "callWall": 790.0, "putWall": 750.0})

    def read(path):
        return runtime(path) if path.startswith("/App/Runtime/") else market(path)

    a = run(kb, alert.id, FakeClient(GOOD), read=read)
    assert a.context["posicion"]["maxRisk"] == 960.0 and "legs" not in a.context["posicion"]
    rules = a.context["reglas_de_la_estrategia"]
    assert rules["ref"] == alert.strategy_ref and rules["risk_limits"] is not None
    assert a.missing == [] and "/App/Runtime/Instances/inst-1/Positions" in a.sources


def test_an_edited_analysis_is_integrity_failed(kb):  # noqa: F811
    alert = watch_alert(kb)
    run(kb, alert.id, FakeClient(GOOD))
    [path] = (kb.base / "supervision" / "analyses").glob("*.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    path.write_text(json.dumps({**data, "summary": "otra cosa"}), encoding="utf-8")
    with pytest.raises(KnowledgeError, match="INTEGRITY_FAILED"):
        alert_analysis.analyses(kb)


def test_advice_in_missing_is_refused_too(kb):  # noqa: F811
    assert alert_analysis.problems_of({**GOOD, "missing": ["Deberías cerrar la posición"]})


def test_an_unexpected_error_is_stored_as_a_failed_analysis(kb):  # noqa: F811
    alert = watch_alert(kb)

    class Broken:
        def run(self, **kw):
            raise RuntimeError("se cortó")

    a = run(kb, alert.id, Broken())
    assert a.status.value == "failed" and "RuntimeError: se cortó" in a.error
    assert alert_analysis.view(kb, [alert.id], IN_SESSION + timedelta(minutes=3))[alert.id]["status"] == "failed"
