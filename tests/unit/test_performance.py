"""WS-0011 (P1-03): performance against the profile, edge or luck, and the review of each close with its decision."""

from __future__ import annotations

from datetime import date, timedelta

from galecore_ai.application import performance, supervisor
from galecore_ai.contracts.profile import ProfileContent, ReferenceCapital
from tests.unit.test_knowledge import NOW, kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import research_ref, stored  # noqa: F401  (research_ref is a fixture)
from tests.unit.test_supervisor import IN_SESSION, position, reader

PROFILE = ProfileContent(
    objectives=["retorno anual buscado de 10 a 15 % sobre el capital de referencia"],
    reference_capital=ReferenceCapital(amount=10000.0, currency="USD"),
    max_drawdown="15 % del capital de referencia (1.500 USD)",
    risk_limits=["pérdida máxima por operación 5 % del capital de referencia (500 USD)",
                 "riesgo máximo sumado 50 % del capital de referencia (5.000 USD)"],
    minimum_return="8 % anual sobre el capital de referencia (800 USD)",
    edge_criterion="al menos 30 operaciones cerradas y un trimestre completo; resultado neto > 0",
)
CRIT = performance.criteria(PROFILE)


def trade(**kw):
    base = {"positionId": "p1", "specName": "s", "specVersion": "1.0.0", "legs": "SELL PUT 724 / BUY PUT 719",
            "entryAt": "2026-10-01T13:31:00Z", "exitAt": "2026-10-05T19:05:00Z", "daysHeld": 4.2,
            "entryCredit": 0.46, "maxRisk": 454.0, "exitReason": "TAKE_PROFIT", "realizedPnl": 23.0,
            "pnlPctOfMaxRisk": 5.1, "plan": {"takeProfitPnl": 23.0, "stopLossPnl": -92.0, "timeExitDte": 21},
            "gapToPlan": 0.0}
    return {**base, **kw}


def test_the_profile_numbers_are_read_from_its_words():
    assert CRIT["capital"] == 10000.0 and CRIT["objetivo_anual_pct"] == [10.0, 15.0]
    assert CRIT["minimo_anual_pct"] == 8.0 and CRIT["edge_min_cierres"] == 30 and CRIT["edge_min_dias"] == 90
    assert CRIT["perdida_max_operacion_usd"] == 500.0 and CRIT["drawdown_max_usd"] == 1500.0
    assert CRIT["no_leidos"] == []


def test_what_the_profile_does_not_say_is_listed_not_guessed():
    crit = performance.criteria(ProfileContent(objectives=["vender prima"]))
    assert crit["objetivo_anual_pct"] is None and crit["edge_min_cierres"] is None
    assert "objetivo (objectives)" in crit["no_leidos"] and "capital de referencia" in crit["no_leidos"]
    assert performance.criteria(None)["no_leidos"] == ["perfil: no hay perfil"]


def test_a_small_sample_is_anecdote_whatever_the_result():
    verdict = performance.edge({"positionsClosed": 2, "daysElapsed": 8.1, "realizedPnl": 45.0}, CRIT)
    assert verdict["muestra_suficiente"] is False
    assert "Sin edge demostrado" in verdict["conclusion"] and "2 de 30 cierres" in verdict["conclusion"]


def test_a_sufficient_sample_still_needs_costs_and_cash_before_claiming_edge():
    win = performance.edge({"positionsClosed": 31, "daysElapsed": 95, "realizedPnl": 300.0}, CRIT)
    loss = performance.edge({"positionsClosed": 31, "daysElapsed": 95, "realizedPnl": -10.0}, CRIT)
    assert win["muestra_suficiente"] and "compatible con edge" in win["conclusion"]
    assert "efectivo" in win["conclusion"] and "no hay edge" in loss["conclusion"]


def test_the_return_is_placed_against_minimum_and_objective_and_warns_on_short_windows():
    def read(annual, days=8.1, closed=2):
        return performance.against_objective({"annualizedReturnPct": annual, "daysElapsed": days,
                                              "positionsClosed": closed, "maxDrawdown": 300.0}, CRIT,
                                             sample_ok=closed >= 30)["lectura"]
    assert "en o por encima del objetivo" in read(25.0, 95, 31)
    assert read(25.0).startswith("Muestra corta") and "objetivo" not in read(25.0).split("ruido")[0]
    assert "entre la utilidad mínima y el objetivo" in read(9.0, 95, 31) and "ruido" not in read(9.0, 95, 31)
    assert "por debajo de la utilidad mínima" in read(3.0, 95, 31)
    out = performance.against_objective({"maxDrawdown": 300.0}, CRIT, sample_ok=False)
    assert out["drawdown_usado_pct"] == 20.0 and "Sin retorno medible" in out["lectura"]


def test_a_close_on_plan_has_nothing_to_learn_yet():
    r = performance.review_trade(trade(), CRIT, None, [], date(2026, 10, 6))
    assert r["diagnostico"] == "todavia_nada" and r["certeza"] == "sin_hallazgos"
    assert r["planeado_usd"] == 23.0 and r["ocurrido"] == "TAKE_PROFIT: +23 USD"


def test_a_stop_inside_the_plan_is_a_thesis_hypothesis_not_a_proven_cause():
    r = performance.review_trade(trade(exitReason="STOP_LOSS", realizedPnl=-92.0, gapToPlan=0.0), CRIT, None, [],
                                 date(2026, 10, 6))
    assert r["diagnostico"] == "tesis" and r["certeza"] == "hipotesis" and r["observado"] == []
    assert "compatible con la estrategia" in r["hipotesis"][0]


def test_a_stop_filled_worse_than_its_level_is_execution_observed():
    r = performance.review_trade(trade(exitReason="STOP_LOSS", realizedPnl=-120.0, gapToPlan=-28.0), CRIT, None, [],
                                 date(2026, 10, 6))
    assert r["diagnostico"] == "ejecucion" and r["certeza"] == "observado"
    assert "28 USD peor" in r["observado"][0]


def test_a_rule_of_the_profile_not_respected_is_rules_observed():
    big = performance.review_trade(trade(maxRisk=900.0), CRIT, None, [], date(2026, 10, 6))
    manual = performance.review_trade(trade(exitReason="MANUAL", gapToPlan=None), CRIT, None, [], date(2026, 10, 6))
    assert big["diagnostico"] == "reglas" and "500 USD" in big["observado"][0]
    assert manual["diagnostico"] == "reglas" and "MANUAL" in manual["observado"][0]
    kill = performance.review_trade(trade(exitReason="KILL_SWITCH", gapToPlan=None), CRIT, None, [], date(2026, 10, 6))
    assert kill["diagnostico"] == "todavia_nada" and "no un incumplimiento" in kill["observado"][0]


def test_the_decision_is_set_against_what_happened_and_a_due_review_is_flagged():
    decision = {"choice": "conforme", "words": "ok", "expected": "que cierre en el objetivo", "at": "2026-10-02",
                "review_by": "2026-10-05"}
    r = performance.review_trade(trade(), CRIT, decision, ["a1"], date(2026, 10, 6))
    assert r["decision"]["esperado"] == "que cierre en el objetivo"
    assert r["decision"]["ocurrido"] == "TAKE_PROFIT: +23 USD" and r["decision"]["revision_vencida"] is True
    due = performance.pending_reviews({"a1": decision, "a2": {**decision, "review_by": "2026-12-01"}},
                                      date(2026, 10, 6))
    assert [d["aviso"] for d in due] == ["a1"]


def test_report_reads_galecore_and_links_each_close_to_its_alert_and_decision(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    closed = position(status="CLOSED", exitReason="TAKE_PROFIT", exitDebit=0.23, realizedPnl=23.0,
                      exitAt=(IN_SESSION - timedelta(hours=1)).isoformat())
    supervisor.scan(kb, reader(doc.spec_hash, [closed]), IN_SESSION)
    [alert] = supervisor.alerts(kb)
    supervisor.decide(kb=kb, alert_id=alert.id, choice="conforme", words="conforme", prompt="conforme",
                      expected="cobrar la mitad del crédito", now=IN_SESSION)
    asked = []

    def read(path):
        asked.append(path)
        return {"asOf": IN_SESSION.isoformat(), "from": "w", "window": {"positionsClosed": 1, "realizedPnl": 23.0},
                "portfolio": {"positionsClosed": 3, "daysElapsed": 50.0, "openNotValued": 1},
                "strategies": [], "versions": [],
                "trades": [trade(positionId=closed["positionId"], exitAt=closed["exitAt"])]}

    out = performance.report(kb, read, since=IN_SESSION - timedelta(days=7), now=IN_SESSION)
    assert asked[0].startswith("/App/Runtime/Performance?spec=") and "&from=" in asked[0]
    assert out["ventana"]["realizedPnl"] == 23.0 and "acumulado" in out["alcance"] and "cierres desde" in out["alcance"]
    assert any("sin valuación" in f for f in out["faltantes"])
    assert any("no tiene operaciones" in f for f in out["faltantes"])   # the kb's strategy is not in GaleCore's answer
    [op] = out["operaciones"]
    assert op["avisos"] == [alert.id] and op["decision"]["esperado"] == "cobrar la mitad del crédito"
    assert out["edge"]["muestra_suficiente"] is False
    assert any("efectivo" in f for f in out["faltantes"]) and "antes de costos" in out["costos"]


def test_report_refuses_what_is_not_a_performance_report(kb):  # noqa: F811
    try:
        performance.report(kb, lambda path: [], now=NOW)
    except supervisor.SupervisorError as exc:
        assert "no es el informe" in str(exc)
    else:
        raise AssertionError("a list is not a performance report")
