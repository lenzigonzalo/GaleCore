"""WS-0023 (P1-PPa §B): declared rules against the controls that really run; the cap per bet is watched (alert)."""

from __future__ import annotations

import json

from galecore_ai.application import controls, supervisor
from tests.unit.fake_galecore import fake_checker, recorded
from tests.unit.test_capital import _Doc, _kb, exposure
from tests.unit.test_knowledge import kb  # noqa: F401  (kb is a fixture)
from tests.unit.test_strategy import research_ref, stored  # noqa: F401  (research_ref is a fixture)
from tests.unit.test_supervisor import IID, IN_SESSION, NAME, position


def _classify(doc, executed=None):
    """classify with a GaleCore that executes what the stored check says (or ``executed``) for this exact spec."""
    paths = list(doc.check.coverage if executed is None else executed)
    return controls.classify(doc, fake_checker(recorded("spy_prima_varianza_valid", executed_paths=paths,
                                                        content_hash=doc.spec_hash), pin_hash=True))


def test_rules_fall_in_three_classes_and_indispensables_decide_the_recommendation(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    out = _classify(doc)
    classes = {r["clase"] for r in out["reglas"]}
    assert classes <= {"ejecutada", "sólo declarada", "no aplica"} and "ejecutada" in classes
    by_id = {r["regla"]: r for r in out["reglas"]}
    for rule in doc.content.rules:
        expected = {"supported": "ejecutada", "unsupported": "sólo declarada"}.get(rule.runtime.status.value, "no aplica")
        assert by_id[rule.id]["clase"] == expected
    assert all(v["clase"] == "vigilada" for v in out["vigilancia_del_supervisor"])
    assert "tope por apuesta del perfil" not in {v["control"] for v in out["vigilancia_del_supervisor"]}
    state = {i["control"]: i["estado"] for i in out["indispensables"]}
    assert state["riesgo por operación"] == "ejecutado" and state["stop"] == "ejecutado"
    for absent in ("tope por apuesta", "freno por pérdida acumulada", "margen y capital simulado"):
        assert state[absent] == "no ejecutado por el runtime"      # the check says GaleCore did not execute them here
    assert out["recomendar_aprobacion"] is False
    assert "No se recomienda aprobar" in out["motivo"] and "freno por pérdida acumulada" in out["motivo"]


RISK = {"max_bet_pct": 30.0, "simulated_capital_usd": 10000.0,
        "loss_brakes": [{"period": "day", "max_loss_usd": 300.0, "basis": "realized_plus_open"}]}


def _declaring(doc, **risk):
    """The stored version as if its spec declared these risk_limits and GaleCore reported them executed."""
    spec = json.loads(doc.spec_json)
    spec["risk_limits"].update(risk)
    executed = {f"risk_limits.{k}[0].max_loss_usd" if k == "loss_brakes" else f"risk_limits.{k}": ["R1"]
                for k, v in risk.items() if v is not None}
    check = doc.check.model_copy(update={"coverage": {**doc.check.coverage, **executed}})
    return doc.model_copy(update={"spec_json": json.dumps(spec), "check": check})


def test_approval_is_recommended_when_everything_indispensable_runs_and_the_capital_is_the_designs(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    out = _classify(_declaring(doc, **RISK))
    assert {i["estado"] for i in out["indispensables"]} == {"ejecutado"}
    assert out["recomendar_aprobacion"] is True and out["monto_simulado_usd"] == 10000.0
    assert "capital de la spec es el monto simulado" in out["motivo"]


def test_a_missing_brake_or_bet_cap_is_not_recommended(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    out = _classify(_declaring(doc, **{**RISK, "loss_brakes": None}))
    assert out["recomendar_aprobacion"] is False and "freno por pérdida acumulada (no ejecutado" in out["motivo"]
    out = _classify(_declaring(doc, **{**RISK, "max_bet_pct": None}))
    assert out["recomendar_aprobacion"] is False and "tope por apuesta (no ejecutado" in out["motivo"]
    declared_only = _declaring(doc, **RISK)    # in the spec but GaleCore did not report it executed
    unexecuted = declared_only.check.model_copy(update={"coverage": doc.check.coverage})
    out = _classify(declared_only.model_copy(update={"check": unexecuted}))
    assert out["recomendar_aprobacion"] is False


def test_the_capital_of_the_spec_must_be_the_single_simulated_amount(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    out = _classify(_declaring(doc, **{**RISK, "simulated_capital_usd": 25000.0}))
    assert out["recomendar_aprobacion"] is False
    assert "25000 USD no es el monto simulado del diseño, 10000 USD" in out["motivo"]
    assert "margen y capital simulado" in {i["control"] for i in out["indispensables"]}
    out = _classify(_declaring(doc, **{**RISK, "simulated_capital_usd": None}))
    assert out["recomendar_aprobacion"] is False and "falta risk_limits.simulated_capital_usd" in out["motivo"]


def test_listing_unexecuted_rules_is_not_enough_to_recommend(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    out = _classify(doc)
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
    assert supervisor.scan(kb, _reader(doc.spec_hash, [position()], exposure()), IN_SESSION)["new"] == []
    from galecore_ai.contracts.strategy import StrategyLimits
    partial = _kb(_Doc(10000.0, limits=StrategyLimits(max_risk_per_trade_pct=5.0, max_open_risk_pct=50.0)))
    drafts, problems = supervisor.bet_limits(partial, lambda path: [])
    assert drafts == [] and any(p.startswith("tope por apuesta sin verificar") for p in problems)
    undeclared = _kb(_Doc(10000.0))                       # declares no limits at all: nothing to watch, no noise
    assert supervisor.bet_limits(undeclared, lambda path: []) == ([], [])


def test_a_bet_check_without_numbers_is_a_problem_not_a_crash(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    broken = {"limit": "bet:SPY bullish 2026-W46", "used": None, "max": 1500.0, "headroom": None, "ok": False}
    out = supervisor.scan(kb, _reader(doc.spec_hash, [position()], exposure(checks=[broken])), IN_SESSION)
    assert out["new"] == [] and any("no dio lo usado" in p for p in out["problems"])


# ── long_equity: the options-only indispensables do not apply (WS-0061) ──
def _equity_doc(max_loss=None, sizing_executed=True):
    import json
    from types import SimpleNamespace as NS
    spec = {"structure": {"default_structure": "long_equity", "allowed_strategies": ["long_equity"]},
            "candidate_construction": {"sizing": {"method": "FIXED", "fixed_contracts": 10}},
            "risk_limits": {"max_concurrent_positions": 1, "max_loss_per_trade_usd": max_loss}}
    paths = (["candidate_construction.sizing.fixed_contracts"] if sizing_executed else []) + [
        "risk_limits.max_concurrent_positions"]
    rule = NS(id="S1", block=NS(value="sizing"), runtime=NS(status=controls.RuntimeStatus.SUPPORTED, spec_paths=paths, note=""))
    return NS(spec_json=json.dumps(spec), content=NS(rules=[rule], simulated_amount_usd=10000), name="x", version="1",
              spec_hash="h", check=NS(coverage={p: ["S1"] for p in paths}))


def test_long_equity_risk_is_the_position_cost_and_stop_and_time_exit_are_not_indispensable():
    out = _classify(_equity_doc())
    state = {i["control"]: i["estado"] for i in out["indispensables"]}
    assert state["riesgo por operación"] == "ejecutado" and state["tope de posiciones abiertas"] == "ejecutado"
    assert "stop" not in state and "salida por tiempo" not in state
    assert state["freno por pérdida acumulada"] == "no ejecutado por el runtime"      # nothing declared in this spec
    assert out["recomendar_aprobacion"] is False and "stop" not in out["motivo"]
    watched = {v["control"] for v in out["vigilancia_del_supervisor"]}
    assert "cerca del stop" not in watched and "dato macro o FOMC antes del vencimiento" not in watched


def test_long_equity_risk_not_executed_when_the_runtime_does_not_size_it():
    out = _classify(_equity_doc(sizing_executed=False))
    assert {i["control"]: i["estado"] for i in out["indispensables"]}["riesgo por operación"] == "no ejecutado por el runtime"


def test_options_keep_their_indispensables(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    names = [i["control"] for i in _classify(doc)["indispensables"]]
    assert "stop" in names and "salida por tiempo" in names


def test_long_equity_sheet_speaks_of_stocks_not_of_options():
    from galecore_ai.application import strategy_sheet
    doc = _equity_doc()
    doc.content.limits = None
    spec = __import__("json").loads(doc.spec_json)
    spec["universe"] = {"symbols": ["AAPL"]}
    spec["exits"] = {"deterministic": {"metric_exit": {"metric_ref": "m", "operator": "LT", "threshold": {"value": 0}}}}
    doc.spec_json = __import__("json").dumps(spec)
    doc.content.management = []
    st = strategy_sheet.structures(doc, None)
    assert "10 por operación" in st["equity"] and "sin cadena de opciones" in st["equity"] and not st["missing"]
    r = strategy_sheet.risk(None, doc, None)
    assert "10 acciones × precio" in r["per_trade_note"]
    assert not any("pérdida máxima por operación" in m for m in r["missing"])


# ── the recommendation asks GaleCore again (WS-0062 review) ──
def test_the_recommendation_uses_what_the_running_galecore_executes_not_the_stored_coverage(kb, research_ref):  # noqa: F811
    doc, _ = stored(kb, research_ref)
    full = _declaring(doc, **RISK)
    assert _classify(full)["recomendar_aprobacion"] is True
    older = _classify(full, executed=doc.check.coverage)       # a runtime that stopped executing the brakes and the cap
    assert older["recomendar_aprobacion"] is False and "freno por pérdida acumulada (no ejecutado" in older["motivo"]


def test_without_a_confirmation_from_galecore_nothing_is_recommended(kb, research_ref):  # noqa: F811
    from galecore_ai.application.knowledge import KnowledgeError
    full = _declaring(stored(kb, research_ref)[0], **RISK)

    def down(spec_json):
        raise KnowledgeError("GaleCore no respondió en http://x")

    for out, why in [(controls.classify(full), "no se reverificó"),
                     (controls.classify(full, down), "no se pudo reverificar con GaleCore"),
                     (controls.classify(full, fake_checker(recorded("invalid"))), "GaleCore ya no acepta esta spec"),
                     (controls.classify(full, fake_checker(recorded("spy_prima_varianza_valid", content_hash="sha256:otra"), pin_hash=True)),
                      "su verificación no es de esta versión")]:
        assert out["recomendar_aprobacion"] is False and why in out["motivo"]
        assert out["motivo"].startswith("No se recomienda aprobar")
        assert "sin verificar" in {i["estado"] for i in out["indispensables"]}
