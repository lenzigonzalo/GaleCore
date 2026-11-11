"""WS-0098 inc. 2: the limits in USD against the worst loss of the structure."""

import json

from galecore_ai.application.feasibility import assess, limits_usd


def spec(bet_pct, width=5, open_pct=3, per_trade_usd=300):
    return {"risk_limits": {"simulated_capital_usd": 10000, "max_risk_per_trade_pct": 3, "max_open_risk_pct": open_pct,
                            "max_loss_per_trade_usd": per_trade_usd, "max_bet_pct": bet_pct},
            "candidate_construction": {"legs": [
                {"side": "SELL", "strike_selection": {"method": "POINTS_FROM_ATM", "points_from_atm": -5}},
                {"side": "BUY", "strike_selection": {"method": "OFFSET_FROM_LEG", "from_leg": "x", "offset_points": -width}},
                {"side": "BUY", "strike_selection": {"method": "OFFSET_FROM_LEG", "from_leg": "y", "offset_points": width}}],
                "constraints": {"min_credit": 2.5}}}


def test_sandwich_1_3_0_needs_a_credit_of_4_91_for_a_9_usd_bet_cap():
    out = assess(spec(3))
    assert out["limites_usd"]["por_apuesta"] == 9 and out["limites_usd"]["riesgo_abierto"] == 300
    assert out["veredicto"] == "pasa"          # «nunca» only when the required credit reaches the width
    assert "con este tope (por apuesta, 9 USD) necesitás cobrar ≥ 4,91 por cada 5 de ancho (mínimo de la spec: 2,5)" in out["texto"]


def test_never_only_when_the_required_credit_reaches_the_width():
    out = assess(spec(0.001, per_trade_usd=300))     # a 0,003 USD bet cap: not even the whole width fits
    assert out["veredicto"] == "no puede entrar nunca"


def test_undeclared_limits_are_the_engines_100_percent_and_no_capital_means_none():
    only_capital = {"risk_limits": {"simulated_capital_usd": 10000}}
    assert limits_usd(only_capital) == {"capital": 10000.0, "por_operacion": 10000.0, "riesgo_abierto": 10000.0, "por_apuesta": 10000.0}
    assert limits_usd({"risk_limits": {"max_bet_pct": 3}})["por_apuesta"] is None
    only_open = {"risk_limits": {"simulated_capital_usd": 10000, "max_open_risk_pct": 3}}
    assert limits_usd(only_open)["por_apuesta"] == 300             # the bet is 100 % of the open risk allowed
    both = {"risk_limits": {"simulated_capital_usd": 10000, "max_risk_per_trade_pct": 3, "max_loss_per_trade_usd": 250}}
    assert limits_usd(both)["por_operacion"] == 250                # the lower of the two, like the engine


def test_sandwich_1_3_2_with_the_bet_cap_at_100_percent_passes():
    out = assess(spec(100))
    assert out["veredicto"] == "pasa" and out["credito_minimo"] == 2.0
    assert "necesitás cobrar ≥ 2 por cada 5 de ancho" in out["texto"]


def test_a_structure_inside_the_cap_even_without_credit_needs_none():
    assert assess(spec(100, width=2, per_trade_usd=300))["credito_minimo"] == 0.0


def test_no_width_is_listed_not_guessed():
    out = assess({"risk_limits": {"simulated_capital_usd": 10000, "max_bet_pct": 3}})
    assert out["veredicto"] is None and "no fija el ancho" in out["texto"]


def test_real_sandwich_versions_in_the_knowledge_base():
    import pathlib
    base = pathlib.Path(__file__).resolve().parents[4] / "knowledge" / "strategies" / "sandwich_spx_0dte_1345"
    if not base.is_dir():
        return
    credits = {v: assess(json.loads(json.loads((base / f"{v}.proposal.json").read_text("utf-8"))["spec_json"]))["credito_minimo"]
               for v in ("1.3.0", "1.3.2")}
    assert credits == {"1.3.0": 4.91, "1.3.2": 2.0}
