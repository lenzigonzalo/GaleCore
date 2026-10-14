"""WS-0023 (P1-PPa §B): declared rules against the controls that really run; the cap per bet is watched (alert)."""

from __future__ import annotations

from galecore_ai.application import controls, supervisor
from galecore_ai.application.profile import set_profile
from tests.unit.test_capital import LIMITS, exposure
from tests.unit.test_knowledge import HOST, NOW, kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import research_ref, stored  # noqa: F401  (research_ref is a fixture)
from tests.unit.test_supervisor import IID, IN_SESSION, NAME, position


def test_rules_fall_in_three_classes_and_indispensables_decide_the_recommendation(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    out = controls.classify(doc)
    classes = {r["clase"] for r in out["reglas"]}
    assert classes <= {"ejecutada", "sólo declarada", "no aplica"} and "ejecutada" in classes
    by_id = {r["regla"]: r for r in out["reglas"]}
    for rule in doc.content.rules:
        expected = {"supported": "ejecutada", "unsupported": "sólo declarada"}.get(rule.runtime.status.value, "no aplica")
        assert by_id[rule.id]["clase"] == expected
    assert all(v["clase"] == "vigilada" for v in out["vigilancia_del_supervisor"])
    state = {i["control"]: i["estado"] for i in out["indispensables"]}
    assert state["tope por apuesta"].startswith("vigilado (aviso, no bloquea")        # final state: watched, never «ejecutado»
    assert state["freno por pérdida acumulada"] == "no ejecutado por el runtime"
    assert out["recomendar_aprobacion"] is False
    assert "No se recomienda aprobar" in out["motivo"] and "tope por apuesta" in out["motivo"]


def test_listing_unexecuted_rules_is_not_enough_to_recommend(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    out = controls.classify(doc)
    executed = [i for i in out["indispensables"] if i["estado"] == "ejecutado"]
    assert len(executed) < len(out["indispensables"]) and not out["recomendar_aprobacion"]


def _reader(spec_hash, positions, exp):
    def read(path):
        if path.startswith("/Data/"):
            return {"data": []}
        if path == "/App/Runtime/Instances":
            return [{"instanceId": IID, "mode": "SHADOW", "lifecycleState": "RUNNING", "specName": NAME,
                     "versionHash": spec_hash}]
        if path.startswith("/App/Runtime/Exposure"):
            return exp
        assert path == f"/App/Runtime/Instances/{IID}/Positions"
        return positions
    return read


def test_a_bet_over_the_cap_is_one_alert_that_says_it_is_watched_not_blocked(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    set_profile(kb.profile, changes={"reference_capital": {"amount": 10000.0, "currency": "USD"},
                                     "risk_limits": LIMITS}, note="n", prompt="p", host=HOST, now=NOW)
    broken = {"limit": "bet:SPY bullish 2026-W46", "used": 1822.0, "max": 1500.0, "headroom": -322.0, "ok": False}
    exp = exposure(checks=[broken])
    out = supervisor.scan(kb, _reader(doc.spec_hash, [position()], exp), IN_SESSION)
    [alert] = [a for a in supervisor.alerts(kb) if a.kind.value == "bet_limit"]
    assert out["new"] == [alert.id] and out["problems"] == []
    assert alert.dato == {"apuesta": "SPY bullish 2026-W46", "usado_usd": 1822.0, "tope_usd": 1500.0,
                          "margen_usd": -322.0}
    assert "vigilado" in alert.regla and "no lo bloquea" in alert.regla
    assert "SHADOW" in alert.motivo and "no es exposición real" in alert.motivo     # simulado ≠ real (PRODUCT.md «Límites»)
    assert alert.options == ["aceptar", "revisar la exposición"]
    again = supervisor.scan(kb, _reader(doc.spec_hash, [position()], exp), IN_SESSION.replace(minute=5))
    assert again["new"] == []                                                   # once per bet


def test_a_bet_within_the_cap_is_quiet_and_incomplete_limits_are_unverified(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    set_profile(kb.profile, changes={"reference_capital": {"amount": 10000.0, "currency": "USD"},
                                     "risk_limits": LIMITS}, note="n", prompt="p", host=HOST, now=NOW)
    assert supervisor.scan(kb, _reader(doc.spec_hash, [position()], exposure()), IN_SESSION)["new"] == []
    set_profile(kb.profile, changes={"risk_limits": LIMITS[:2]}, note="n", prompt="p", host=HOST, now=NOW)
    out = supervisor.scan(kb, _reader(doc.spec_hash, [position()], exposure()), IN_SESSION.replace(minute=10))
    assert any(p.startswith("tope por apuesta sin verificar") for p in out["problems"])


def test_a_bet_check_without_numbers_is_a_problem_not_a_crash(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    set_profile(kb.profile, changes={"reference_capital": {"amount": 10000.0, "currency": "USD"},
                                     "risk_limits": LIMITS}, note="n", prompt="p", host=HOST, now=NOW)
    broken = {"limit": "bet:SPY bullish 2026-W46", "used": None, "max": 1500.0, "headroom": None, "ok": False}
    out = supervisor.scan(kb, _reader(doc.spec_hash, [position()], exposure(checks=[broken])), IN_SESSION)
    assert out["new"] == [] and any("no dio lo usado" in p for p in out["problems"])
